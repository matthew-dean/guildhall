import { defineTool } from '@guildhall/engine'
import { z } from 'zod'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  Checkpoint,
  TaskQueue,
  TERMINAL_TASK_STATUSES,
  type Task,
  type TaskStatus,
} from '@guildhall/core'

// ---------------------------------------------------------------------------
// FR-33 Crash-safe task checkpointing
//
// Writes a single durable `checkpoint.json` per task at
// `<memoryDir>/tasks/<task-id>/checkpoint.json`. One checkpoint per task
// (overwritten on each write) because the progression of intents is already
// captured elsewhere (PROGRESS.md, the FR-16 event stream). What we need at
// reclaim time is "what was true at the last safe point" — a single snapshot.
//
// Writes are atomic: write to `<file>.tmp` then rename. On crash mid-write,
// the previous checkpoint survives. The reader tolerates a stray `.tmp`
// sibling without failing the reclaim scan.
//
// The monotonic `step` counter is scoped to the task and auto-incremented
// when the tool is invoked without an explicit step — callers who want to
// override (e.g. resuming from step N mid-run) may pass it explicitly.
// ---------------------------------------------------------------------------

export const CHECKPOINT_FILENAME = 'checkpoint.json'
export const CHECKPOINTS_DIRNAME = 'tasks'

/** Resolve the directory that holds a task's checkpoint. */
export function checkpointDir(memoryDir: string, taskId: string): string {
  return path.join(memoryDir, CHECKPOINTS_DIRNAME, taskId)
}

/** Resolve the full path to a task's checkpoint file. */
export function checkpointPath(memoryDir: string, taskId: string): string {
  return path.join(checkpointDir(memoryDir, taskId), CHECKPOINT_FILENAME)
}

const TASKS_PATH_SCHEMA = z.string().describe('Absolute path to the TASKS.json file')
const MEMORY_DIR_SCHEMA = z
  .string()
  .describe(
    'Absolute path to the workspace memory/ directory. The checkpoint lands at <memoryDir>/tasks/<task-id>/checkpoint.json',
  )

const writeCheckpointInputSchema = z.object({
  tasksPath: TASKS_PATH_SCHEMA,
  memoryDir: MEMORY_DIR_SCHEMA,
  taskId: z.string(),
  agentId: z.string(),
  intent: z.string(),
  nextPlannedAction: z.string(),
  filesTouched: z.array(z.string()).default([]),
  lastCommittedSha: z.string().optional(),
  engineSessionId: z.string().optional(),
  // If omitted, the tool reads the existing checkpoint (if any) and
  // auto-increments. Explicit values are honored for e.g. resume flows.
  step: z.number().int().positive().optional(),
})

export type WriteCheckpointInput = z.input<typeof writeCheckpointInputSchema>
export interface WriteCheckpointResult {
  success: boolean
  step?: number
  path?: string
  error?: string
}

async function readExistingCheckpoint(
  memoryDir: string,
  taskId: string,
): Promise<Checkpoint | null> {
  try {
    const raw = await fs.readFile(checkpointPath(memoryDir, taskId), 'utf-8')
    return Checkpoint.parse(JSON.parse(raw))
  } catch {
    return null
  }
}

export async function writeCheckpoint(
  input: WriteCheckpointInput,
): Promise<WriteCheckpointResult> {
  try {
    const parsed = writeCheckpointInputSchema.parse(input)

    // Confirm the task exists on the queue. We don't need to mutate the queue,
    // but a checkpoint for an unknown task is a writer bug we'd rather catch
    // early than let reclaim detection trip over.
    const raw = await fs.readFile(parsed.tasksPath, 'utf-8')
    const queue = TaskQueue.parse(JSON.parse(raw))
    const task = queue.tasks.find((t) => t.id === parsed.taskId)
    if (!task) return { success: false, error: `Task ${parsed.taskId} not found` }

    let step = parsed.step
    if (step === undefined) {
      const existing = await readExistingCheckpoint(parsed.memoryDir, parsed.taskId)
      step = existing ? existing.step + 1 : 1
    }

    const checkpoint: Checkpoint = {
      taskId: parsed.taskId,
      agentId: parsed.agentId,
      step,
      intent: parsed.intent,
      filesTouched: parsed.filesTouched,
      nextPlannedAction: parsed.nextPlannedAction,
      writtenAt: new Date().toISOString(),
      ...(parsed.lastCommittedSha !== undefined
        ? { lastCommittedSha: parsed.lastCommittedSha }
        : {}),
      ...(parsed.engineSessionId !== undefined
        ? { engineSessionId: parsed.engineSessionId }
        : {}),
    }

    const dir = checkpointDir(parsed.memoryDir, parsed.taskId)
    await fs.mkdir(dir, { recursive: true })
    const file = checkpointPath(parsed.memoryDir, parsed.taskId)
    const tmp = `${file}.tmp`
    await fs.writeFile(tmp, JSON.stringify(checkpoint, null, 2), 'utf-8')
    await fs.rename(tmp, file)

    return { success: true, step, path: file }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export const writeCheckpointTool = defineTool({
  name: 'write-checkpoint',
  description:
    "Write a durable checkpoint for the current task. Call this at tool boundaries: before destructive filesystem changes, after subprocess success, on explicit checkpoint markers in the spec, and immediately before engine compaction. One checkpoint per task is persisted (overwritten on each call); the step counter auto-increments. On crash, the orchestrator uses this as input to the FR-32 remediation loop's restart_from_checkpoint decision.",
  inputSchema: writeCheckpointInputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      tasksPath: { type: 'string', description: 'Absolute path to TASKS.json' },
      memoryDir: { type: 'string', description: 'Absolute path to the workspace memory directory' },
      taskId: { type: 'string' },
      agentId: { type: 'string' },
      intent: { type: 'string' },
      nextPlannedAction: { type: 'string' },
      filesTouched: { type: 'array', items: { type: 'string' } },
      lastCommittedSha: { type: 'string' },
      engineSessionId: { type: 'string' },
      step: { type: 'number' },
    },
    required: ['taskId', 'agentId', 'intent', 'nextPlannedAction', 'filesTouched'],
  },
  isReadOnly: () => false,
  execute: async (input) => {
    const result = await writeCheckpoint(input)
    return {
      output: result.success
        ? `Wrote checkpoint step ${result.step} for ${input.taskId}`
        : `Error writing checkpoint for ${input.taskId}: ${result.error ?? 'unknown'}`,
      is_error: !result.success,
      metadata: result as unknown as Record<string, unknown>,
    }
  },
})

/**
 * Read the most recent checkpoint for a task, or null if none exists.
 * Used by the FR-32 coordinator and by `findReclaimCandidates`.
 */
export async function readCheckpoint(
  memoryDir: string,
  taskId: string,
): Promise<Checkpoint | null> {
  return readExistingCheckpoint(memoryDir, taskId)
}

/**
 * Delete a checkpoint after the coordinator has chosen `restart_clean`.
 * Idempotent — missing files are silently tolerated. Does not remove the
 * parent `tasks/<task-id>/` directory because other per-task artifacts may
 * live there in future FRs.
 */
export async function clearCheckpoint(
  memoryDir: string,
  taskId: string,
): Promise<void> {
  const file = checkpointPath(memoryDir, taskId)
  try {
    await fs.unlink(file)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
  // Also clean up a stray mid-write tmp if one survived a crash.
  try {
    await fs.unlink(`${file}.tmp`)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
}

// ---------------------------------------------------------------------------
// Reclaim-candidate detection (pure policy)
//
// The orchestrator calls `findReclaimCandidates` on startup and (per the
// spec) on agent-crash detection. The result is the input to FR-32.
// ---------------------------------------------------------------------------

export interface ReclaimCandidate {
  task: Task
  /** May be null — task went non-terminal without ever writing a checkpoint. */
  checkpoint: Checkpoint | null
  /**
   * FR-33 auto-escalation trigger: a checkpoint older than 24h with no live
   * agent is auto-escalated to human review regardless of
   * `remediation_autonomy`. `null` when there is no checkpoint at all (in
   * which case staleness can't be computed from disk).
   */
  ageMs: number | null
  /** `true` when the checkpoint (or lack thereof) warrants auto-escalation. */
  autoEscalate: boolean
}

export const RECLAIM_AUTO_ESCALATE_MS = 24 * 60 * 60 * 1000 // 24 hours

/**
 * Given a task queue snapshot and the set of agent ids currently registered
 * as live (e.g. from `LivenessTracker.snapshot()`), return any tasks that
 * look stranded: non-terminal, not `ready`/`proposed` (those are waiting to
 * be picked up — not stranded), and assigned to an agent that is no longer
 * live.
 *
 * Pure — does not touch disk. The checkpoint for each candidate must be
 * loaded separately via `readCheckpoint`.
 */
const QUEUE_STATUSES: ReadonlySet<TaskStatus> = new Set<TaskStatus>([
  'proposed',
  'exploring',
  'spec_review',
  'ready',
])
const TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set<TaskStatus>(
  TERMINAL_TASK_STATUSES,
)

export function findReclaimTasks(
  queue: { tasks: Task[] },
  liveAgentIds: Iterable<string>,
): Task[] {
  const live = new Set(liveAgentIds)
  return queue.tasks.filter((t) => {
    // Terminal tasks stay terminal; queue statuses don't expect a live agent.
    if (TERMINAL_STATUSES.has(t.status)) return false
    if (QUEUE_STATUSES.has(t.status)) return false
    // `in_progress` / `review` / `gate_check` expect a live agent. If the
    // task has no assignee or the assignee is not in the live set, it's a
    // reclaim candidate.
    if (!t.assignedTo) return true
    return !live.has(t.assignedTo)
  })
}

/**
 * Load checkpoints for a list of reclaim-candidate tasks and annotate each
 * with age + auto-escalate decision. Used by the orchestrator's startup
 * reclaim scan before handing off to FR-32.
 */
export async function loadReclaimCandidates(
  memoryDir: string,
  tasks: Task[],
  nowMs: number = Date.now(),
): Promise<ReclaimCandidate[]> {
  const out: ReclaimCandidate[] = []
  for (const task of tasks) {
    const checkpoint = await readCheckpoint(memoryDir, task.id)
    let ageMs: number | null = null
    let autoEscalate = false
    if (checkpoint) {
      ageMs = nowMs - Date.parse(checkpoint.writtenAt)
      autoEscalate = ageMs >= RECLAIM_AUTO_ESCALATE_MS
    }
    out.push({ task, checkpoint, ageMs, autoEscalate })
  }
  return out
}
