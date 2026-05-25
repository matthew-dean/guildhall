import { defineTool } from '@guildhall/engine'
import { z } from 'zod'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  Escalation,
  EscalationReason,
  ProgressEntry,
  TaskQueue,
  type Task,
} from '@guildhall/core'
import { logProgress } from './memory-tools.js'
import { atomicWriteText, appendTaskEvidence, inferProjectRootFromMemoryDir } from '@guildhall/sessions'

// ---------------------------------------------------------------------------
// FR-10 Escalation protocol
//
// Escalations are first-class events, not free-form notes. Raising an escalation:
//   1. appends a structured Escalation entry to the task
//   2. flips the task to status `blocked` with blockReason = escalation summary
//   3. writes a typed progress entry (type: 'escalation') to PROGRESS.md
//
// Resolving an escalation:
//   1. marks the escalation as resolved (timestamp + resolution + resolver)
//   2. moves the task to the requested next status (usually back to where it was)
//   3. writes a progress entry (type: 'milestone') recording the resolution
//
// The orchestrator refuses to route a task with any unresolved escalation.
// ---------------------------------------------------------------------------

const TASKS_PATH_SCHEMA = z.string().describe('Absolute path to the TASKS.json file')
const PROGRESS_PATH_SCHEMA = z
  .string()
  .describe('Absolute path to PROGRESS.md (escalation is mirrored here)')

const raiseEscalationInputSchema = z.object({
  tasksPath: TASKS_PATH_SCHEMA,
  progressPath: PROGRESS_PATH_SCHEMA.optional(),
  taskId: z.string(),
  agentId: z.string(),
  reason: EscalationReason,
  summary: z.string(),
  details: z.string().optional(),
})

export type RaiseEscalationInput = z.input<typeof raiseEscalationInputSchema>
export interface RaiseEscalationResult {
  success: boolean
  escalationId?: string
  error?: string
}

function nextEscalationId(task: Task): string {
  return `esc-${task.id}-${task.escalations.length + 1}`
}

function looksLikeRoutineVerificationEscalation(input: RaiseEscalationInput): boolean {
  const text = `${input.reason}\n${input.summary}\n${input.details ?? ''}`
  return (
    /\bAC-\d+\b/i.test(text) &&
    /\b(?:evidence|verification|test result|gate)\b/i.test(text) &&
    /\b(?:pnpm|npm|yarn|bun|vitest|test|typecheck|build)\b/i.test(text)
  )
}

export async function raiseEscalation(
  input: RaiseEscalationInput,
): Promise<RaiseEscalationResult> {
  try {
    const raw = await fs.readFile(input.tasksPath, 'utf-8')
    const queue = TaskQueue.parse(JSON.parse(raw))
    const task = queue.tasks.find((t) => t.id === input.taskId)
    if (!task) return { success: false, error: `Task ${input.taskId} not found` }

    if (looksLikeRoutineVerificationEscalation(input)) {
      return {
        success: false,
        error:
          'Do not raise a human escalation for routine verification evidence. Run the focused check, save the result in the task proof packet or checkpoint, and continue. Escalate only if an external credential, environment outage, or product decision prevents Guildhall from running the check.',
      }
    }

    const now = new Date().toISOString()
    const escalation: Escalation = {
      id: nextEscalationId(task),
      taskId: task.id,
      agentId: input.agentId,
      reason: input.reason,
      summary: input.summary,
      raisedAt: now,
      ...(input.details !== undefined ? { details: input.details } : {}),
    }
    task.escalations.push(escalation)
    task.status = 'blocked'
    task.blockReason = `${input.reason}: ${input.summary}`
    task.updatedAt = now
    queue.lastUpdated = now

    atomicWriteText(input.tasksPath, JSON.stringify(queue, null, 2) + '\n')
    await appendTaskEvidence(
      inferProjectRootFromMemoryDir(path.dirname(input.tasksPath)),
      task.id,
      {
        id: escalation.id,
        kind: 'escalation',
        recordedAt: now,
        payload: escalation,
      },
    ).catch(() => undefined)

    if (input.progressPath) {
      const entry: ProgressEntry = {
        timestamp: now,
        agentId: input.agentId,
        domain: task.domain,
        taskId: task.id,
        summary: `ESCALATION [${input.reason}]: ${input.summary}`,
        type: 'escalation',
      }
      await logProgress({ progressPath: input.progressPath, entry })
    }

    return { success: true, escalationId: escalation.id }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export const raiseEscalationTool = defineTool({
  name: 'raise-escalation',
  description:
    "Raise a structured escalation on a task. This halts the task (sets status='blocked') and records a typed event to PROGRESS.md. Use this — not a plain note — only when the task truly needs the owner or an external system. Do not use it for routine verification, missing proof packets, acceptance-criteria evidence, test reruns, or internal gate bookkeeping that Guildhall can do itself.",
  inputSchema: raiseEscalationInputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      tasksPath: { type: 'string', description: 'Absolute path to TASKS.json' },
      progressPath: { type: 'string', description: 'Absolute path to PROGRESS.md' },
      taskId: { type: 'string' },
      agentId: { type: 'string' },
      reason: {
        type: 'string',
        enum: [
          'spec_ambiguous',
          'max_revisions_exceeded',
          'human_judgment_required',
          'decision_required',
          'gate_hard_failure',
          'scope_boundary',
        ],
      },
      summary: { type: 'string' },
      details: { type: 'string' },
    },
    required: ['taskId', 'agentId', 'reason', 'summary'],
  },
  isReadOnly: () => false,
  execute: async (input) => {
    const result = await raiseEscalation(input)
    return {
      output: result.success
        ? `Raised escalation ${result.escalationId} on ${input.taskId}`
        : `Error raising escalation on ${input.taskId}: ${result.error ?? 'unknown'}`,
      is_error: !result.success,
      metadata: result as unknown as Record<string, unknown>,
    }
  },
})

const resolveEscalationInputSchema = z.object({
  tasksPath: TASKS_PATH_SCHEMA,
  progressPath: PROGRESS_PATH_SCHEMA.optional(),
  taskId: z.string(),
  escalationId: z.string(),
  resolution: z.string(),
  resolvedBy: z.string().default('human'),
  nextStatus: z
    .enum([
      'exploring',
      'spec_review',
      'ready',
      'in_progress',
      'review',
      'gate_check',
    ])
    .describe('Status to return the task to once unblocked'),
})

export type ResolveEscalationInput = z.input<typeof resolveEscalationInputSchema>
export interface ResolveEscalationResult {
  success: boolean
  error?: string
}

function normalizeAssignmentForResolvedStatus(task: Task, nextStatus: z.infer<typeof resolveEscalationInputSchema>['nextStatus']): void {
  task.status = nextStatus
  switch (nextStatus) {
    case 'in_progress':
      task.assignedTo = 'worker-agent'
      return
    case 'review':
      task.assignedTo = 'reviewer-agent'
      return
    case 'gate_check':
      task.assignedTo = 'gate-checker-agent'
      return
    case 'exploring':
    case 'spec_review':
    case 'ready':
      delete task.assignedTo
      return
  }
}

function supportsRetryWindow(status: Task['status']): boolean {
  return status === 'in_progress' || status === 'review' || status === 'gate_check'
}

export function ensureRetryWindow(task: Task): boolean {
  const latestResolvedRetry = latestResolvedRetryEscalationAt(task)
  if (!latestResolvedRetry) return false
  if (!supportsRetryWindow(task.status)) return false

  if (task.retryWindow?.startedAt === latestResolvedRetry) return false
  task.retryWindow = {
    startedAt: latestResolvedRetry,
    baseRevisionCount: task.revisionCount,
  }
  return true
}

export function currentRevisionCycleCount(task: Pick<Task, 'status' | 'revisionCount' | 'retryWindow' | 'escalations'>): number {
  const latestResolvedRetry = latestResolvedRetryEscalationAt(task as Task)
  if (!latestResolvedRetry || !supportsRetryWindow(task.status as Task['status'])) {
    return task.revisionCount
  }
  if (task.retryWindow?.startedAt === latestResolvedRetry) {
    return Math.max(0, task.revisionCount - task.retryWindow.baseRevisionCount)
  }
  // Legacy self-heal: once a retry was explicitly approved by a human, do not
  // let historical revision debt immediately re-block the task before we have
  // established a fresh retry window in persisted task state.
  return 0
}

export async function resolveEscalation(
  input: ResolveEscalationInput,
): Promise<ResolveEscalationResult> {
  try {
    const raw = await fs.readFile(input.tasksPath, 'utf-8')
    const queue = TaskQueue.parse(JSON.parse(raw))
    const task = queue.tasks.find((t) => t.id === input.taskId)
    if (!task) return { success: false, error: `Task ${input.taskId} not found` }

    const esc = task.escalations.find((e) => e.id === input.escalationId)
    if (!esc) {
      return {
        success: false,
        error: `Escalation ${input.escalationId} not found on ${input.taskId}`,
      }
    }
    if (esc.resolvedAt) {
      return {
        success: false,
        error: `Escalation ${input.escalationId} already resolved at ${esc.resolvedAt}`,
      }
    }

    const now = new Date().toISOString()
    esc.resolvedAt = now
    esc.resolution = input.resolution
    esc.resolvedBy = input.resolvedBy ?? 'human'

    const stillOpen = task.escalations.some((e) => !e.resolvedAt)
    if (!stillOpen) {
      normalizeAssignmentForResolvedStatus(task, input.nextStatus)
      if (esc.reason === 'max_revisions_exceeded') ensureRetryWindow(task)
      delete task.blockReason
    }
    task.updatedAt = now
    queue.lastUpdated = now

    atomicWriteText(input.tasksPath, JSON.stringify(queue, null, 2) + '\n')

    if (input.progressPath) {
      const entry: ProgressEntry = {
        timestamp: now,
        agentId: input.resolvedBy ?? 'human',
        domain: task.domain,
        taskId: task.id,
        summary: stillOpen
          ? `Escalation ${esc.id} resolved (${task.escalations.filter((e) => !e.resolvedAt).length} still open): ${input.resolution}`
          : `Escalation ${esc.id} resolved; task returning to ${input.nextStatus}: ${input.resolution}`,
        type: 'milestone',
      }
      await logProgress({ progressPath: input.progressPath, entry })
    }

    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export const resolveEscalationTool = defineTool({
  name: 'resolve-escalation',
  description:
    'Resolve an open escalation and unblock the task. If no escalations remain open on the task, its status is set to `nextStatus`. Typically invoked by a human or an orchestrator-level resolver.',
  inputSchema: resolveEscalationInputSchema,
  jsonSchema: { type: 'object' },
  isReadOnly: () => false,
  execute: async (input) => {
    const result = await resolveEscalation(input)
    return {
      output: result.success
        ? `Resolved escalation ${input.escalationId}`
        : `Error resolving escalation ${input.escalationId}: ${result.error ?? 'unknown'}`,
      is_error: !result.success,
      metadata: result as unknown as Record<string, unknown>,
    }
  },
})

type TaskEscalation = Task['escalations'][number]

export function isEscalationActive(task: Task, escalation: TaskEscalation): boolean {
  if (escalation.resolvedAt) return false
  if (task.status === 'blocked') return true

  const raisedAt = Date.parse(escalation.raisedAt)
  const updatedAt = Date.parse(task.updatedAt)
  if (Number.isFinite(raisedAt) && Number.isFinite(updatedAt) && updatedAt > raisedAt) {
    return false
  }

  return true
}

export function activeEscalations(task: Task): TaskEscalation[] {
  const escalations = Array.isArray(task.escalations) ? task.escalations : []
  return escalations.filter((escalation) => isEscalationActive(task, escalation))
}

export function resolveSupersededEscalations(
  task: Task,
  opts: {
    now?: string
    resolvedBy?: string
    resolution?: string
  } = {},
): string[] {
  const now = opts.now ?? task.updatedAt
  const resolvedBy = opts.resolvedBy ?? 'system'
  const resolution =
    opts.resolution ??
    `Superseded after task continued in ${task.status}.`

  const resolvedIds: string[] = []
  for (const escalation of Array.isArray(task.escalations) ? task.escalations : []) {
    if (escalation.resolvedAt) continue
    if (isEscalationActive(task, escalation)) continue
    escalation.resolvedAt = now
    escalation.resolvedBy = resolvedBy
    escalation.resolution = resolution
    resolvedIds.push(escalation.id)
  }

  if (resolvedIds.length > 0 && activeEscalations(task).length === 0) {
    delete task.blockReason
  }

  return resolvedIds
}

export function latestResolvedRetryEscalationAt(task: Task): string | null {
  const resolved = (Array.isArray(task.escalations) ? task.escalations : [])
    .filter(
      (escalation) =>
        escalation.reason === 'max_revisions_exceeded' &&
        typeof escalation.resolvedAt === 'string' &&
        escalation.resolvedAt.trim().length > 0,
    )
    .sort((a, b) => Date.parse(b.resolvedAt ?? '') - Date.parse(a.resolvedAt ?? ''))
  return resolved[0]?.resolvedAt ?? null
}

/**
 * Returns true if the task has at least one unresolved escalation. Used by the
 * orchestrator to halt routing regardless of surface status.
 */
export function hasOpenEscalation(task: Task): boolean {
  return activeEscalations(task).length > 0
}
