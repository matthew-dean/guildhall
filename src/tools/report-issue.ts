import { appendManagedTextFile, readManagedTextFile, readManagedTextFileSync, writeManagedTextFile } from '@guildhall/persistence'
import { defineTool } from '@guildhall/engine'
import { z } from 'zod'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  AgentIssue,
  AgentIssueCode,
  AgentIssueSeverity,
  type TaskEvidenceEvent,
  ProgressEntry,
  TaskQueue,
  type Task,
} from '@guildhall/core'
import { logProgress } from './memory-tools.js'
import {
  appendTaskEvidence,
  inferProjectRootFromMemoryDir,
  readTaskEvidence,
  upsertTaskRuntimeState,
} from '@guildhall/sessions'
import { writeProjectTaskQueue } from '../runtime/project-state-boundary.js'

// ---------------------------------------------------------------------------
// FR-31 Agent-issue channel
//
// `report_issue` is the counterpart to `raise-escalation`: where an escalation
// halts the task pending a human decision, an issue is a structured signal
// the agent emits *while continuing to work*. The coordinator's next tick
// (FR-32) reads the open-issue list and decides whether to intervene.
//
// New issues live in task evidence/runtime state; legacy `Task.agentIssues[]`
// is still read for old project records. A fresh issue has `broadcast=false`
// so the orchestrator can emit a single `agent_issue` wire event (FR-16), then
// record a broadcasted evidence update to avoid re-firing.
//
// Unlike escalations, issues do NOT change the task's status field.
// ---------------------------------------------------------------------------

const TASKS_PATH_SCHEMA = z.string().describe('Absolute path to the TASKS.json file')
const PROGRESS_PATH_SCHEMA = z
  .string()
  .describe('Absolute path to PROGRESS.md (issue is mirrored here)')

const reportIssueInputSchema = z.object({
  tasksPath: TASKS_PATH_SCHEMA,
  progressPath: PROGRESS_PATH_SCHEMA.optional(),
  taskId: z.string(),
  agentId: z.string(),
  code: AgentIssueCode,
  severity: AgentIssueSeverity.default('warn'),
  detail: z.string().describe('What the agent observed — concrete, not abstract'),
  suggestedAction: z
    .string()
    .optional()
    .describe(
      "Agent's own recommendation for what to do next. Advisory only — the coordinator ultimately decides.",
    ),
})

export type ReportIssueInput = z.input<typeof reportIssueInputSchema>
export interface ReportIssueResult {
  success: boolean
  issueId?: string
  error?: string
}

function issuePayload(event: TaskEvidenceEvent): AgentIssue | null {
  const parsed = AgentIssue.safeParse(event.payload)
  return parsed.success ? parsed.data : null
}

function issueNumber(taskId: string, issueId: string): number {
  const escapedTaskId = taskId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`^iss-${escapedTaskId}-(\\d+)$`).exec(issueId)
  return match ? Number(match[1]) : 0
}

function nextIssueId(task: Task, evidence: TaskEvidenceEvent[]): string {
  const maxLegacy = task.agentIssues.reduce((max, issue) => Math.max(max, issueNumber(task.id, issue.id)), 0)
  const maxEvidence = evidence.reduce((max, event) => {
    const issue = issuePayload(event)
    return issue ? Math.max(max, issueNumber(task.id, issue.id)) : max
  }, 0)
  return `iss-${task.id}-${Math.max(maxLegacy, maxEvidence) + 1}`
}

function latestIssuesById(task: Task, evidence: TaskEvidenceEvent[]): Map<string, AgentIssue> {
  const issues = new Map<string, AgentIssue>()
  for (const issue of task.agentIssues) issues.set(issue.id, issue)
  for (const event of evidence) {
    const issue = issuePayload(event)
    if (issue) issues.set(issue.id, issue)
  }
  return issues
}

function openIssueIds(task: Task, evidence: TaskEvidenceEvent[]): string[] {
  return [...latestIssuesById(task, evidence).values()]
    .filter((issue) => !issue.resolvedAt)
    .map((issue) => issue.id)
}

export async function reportIssue(input: ReportIssueInput): Promise<ReportIssueResult> {
  try {
    const parsed = reportIssueInputSchema.parse(input)
    const raw = await readManagedTextFile(parsed.tasksPath, 'utf-8')
    const queue = TaskQueue.parse(JSON.parse(raw))
    const task = queue.tasks.find((t) => t.id === parsed.taskId)
    if (!task) return { success: false, error: `Task ${parsed.taskId} not found` }

    const projectRoot = inferProjectRootFromMemoryDir(path.dirname(parsed.tasksPath))
    const existingIssueEvidence = await readTaskEvidence(projectRoot, task.id, { kind: 'agent_issue' })
    const now = new Date().toISOString()
    const issue: AgentIssue = {
      id: nextIssueId(task, existingIssueEvidence),
      taskId: task.id,
      agentId: parsed.agentId,
      code: parsed.code,
      severity: parsed.severity,
      detail: parsed.detail,
      raisedAt: now,
      broadcast: false,
      ...(parsed.suggestedAction !== undefined
        ? { suggestedAction: parsed.suggestedAction }
        : {}),
    }
    // FR-31: issues do NOT change status — the task stays on its current track
    // until the coordinator's remediation loop acts on it.
    task.updatedAt = now
    queue.lastUpdated = now

    writeProjectTaskQueue(parsed.tasksPath, queue)
    await appendTaskEvidence(
      projectRoot,
      task.id,
      {
        id: issue.id,
        kind: 'agent_issue',
        recordedAt: now,
        payload: issue,
      },
    )
    await upsertTaskRuntimeState(projectRoot, task.id, {
      openIssueIds: openIssueIds(task, [
        ...existingIssueEvidence,
        {
          id: issue.id,
          taskId: task.id,
          kind: 'agent_issue',
          recordedAt: now,
          payload: issue,
        },
      ]),
      updatedAt: now,
    })

    if (parsed.progressPath) {
      const entry: ProgressEntry = {
        timestamp: now,
        agentId: parsed.agentId,
        domain: task.domain,
        taskId: task.id,
        summary: `ISSUE [${parsed.severity}/${parsed.code}]: ${parsed.detail}`,
        // FR-31: issues are informational — `heartbeat` keeps them out of the
        // `blocked` bucket in the human-facing PROGRESS.md.
        type: 'heartbeat',
      }
      await logProgress({ progressPath: parsed.progressPath, entry })
    }

    return { success: true, issueId: issue.id }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export const reportIssueTool = defineTool({
  name: 'report-issue',
  description:
    "Emit a structured agent-issue signal without halting the task. Use this when you notice something worth a coordinator's attention (stuck, tool missing, context thin, dependency down, infinite loop suspected, spec incoherent) but you can keep working. For anything that should BLOCK the task, use raise-escalation instead.",
  inputSchema: reportIssueInputSchema,
  jsonSchema: { type: 'object' },
  isReadOnly: () => false,
  execute: async (input) => {
    const result = await reportIssue(input)
    return {
      output: result.success
        ? `Reported issue ${result.issueId} on ${input.taskId}`
        : `Error reporting issue on ${input.taskId}: ${result.error ?? 'unknown'}`,
      is_error: !result.success,
      metadata: result as unknown as Record<string, unknown>,
    }
  },
})

// ---------------------------------------------------------------------------
// resolveIssue — called by the coordinator's remediation loop (FR-32).
// Marks an open issue as handled with a record of the remediation decision.
// Does not change task status by itself; the caller decides separately.
// ---------------------------------------------------------------------------

const resolveIssueInputSchema = z.object({
  tasksPath: TASKS_PATH_SCHEMA,
  taskId: z.string(),
  issueId: z.string(),
  resolution: z.string().describe('One-line record of what was decided / done'),
  resolvedBy: z.string().describe('Who resolved it (coordinator id or "human")'),
})

export type ResolveIssueInput = z.input<typeof resolveIssueInputSchema>
export interface ResolveIssueResult {
  success: boolean
  error?: string
}

export async function resolveIssue(input: ResolveIssueInput): Promise<ResolveIssueResult> {
  try {
    const parsed = resolveIssueInputSchema.parse(input)
    const raw = await readManagedTextFile(parsed.tasksPath, 'utf-8')
    const queue = TaskQueue.parse(JSON.parse(raw))
    const task = queue.tasks.find((t) => t.id === parsed.taskId)
    if (!task) return { success: false, error: `Task ${parsed.taskId} not found` }

    const projectRoot = inferProjectRootFromMemoryDir(path.dirname(parsed.tasksPath))
    const existingIssueEvidence = await readTaskEvidence(projectRoot, task.id, { kind: 'agent_issue' })
    const issue = latestIssuesById(task, existingIssueEvidence).get(parsed.issueId)
    if (!issue) {
      return {
        success: false,
        error: `Issue ${parsed.issueId} not found on ${parsed.taskId}`,
      }
    }
    if (issue.resolvedAt) {
      return {
        success: false,
        error: `Issue ${parsed.issueId} already resolved at ${issue.resolvedAt}`,
      }
    }

    const now = new Date().toISOString()
    const resolvedIssue: AgentIssue = {
      ...issue,
      resolvedAt: now,
      resolution: parsed.resolution,
      resolvedBy: parsed.resolvedBy,
    }
    task.updatedAt = now
    queue.lastUpdated = now

    writeProjectTaskQueue(parsed.tasksPath, queue)
    await appendTaskEvidence(projectRoot, task.id, {
      id: `${resolvedIssue.id}-resolved-${now.replace(/[^0-9A-Za-z]/g, '')}`,
      kind: 'agent_issue',
      recordedAt: now,
      payload: resolvedIssue,
    })
    await upsertTaskRuntimeState(projectRoot, task.id, {
      openIssueIds: openIssueIds(task, [
        ...existingIssueEvidence,
        {
          id: `${resolvedIssue.id}-resolved-${now.replace(/[^0-9A-Za-z]/g, '')}`,
          taskId: task.id,
          kind: 'agent_issue',
          recordedAt: now,
          payload: resolvedIssue,
        },
      ]),
      updatedAt: now,
    })
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

/** Returns all unresolved issues on a task, in raisedAt order. Drives the coordinator inbox. */
export function openIssues(task: Task): AgentIssue[] {
  return task.agentIssues.filter((i) => !i.resolvedAt)
}

/** Returns unresolved, not-yet-broadcast issues. The orchestrator uses this to decide which FR-16 `agent_issue` events to emit each tick. */
export function pendingBroadcastIssues(task: Task): AgentIssue[] {
  return task.agentIssues.filter((i) => !i.broadcast && !i.resolvedAt)
}
