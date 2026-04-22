import { defineTool } from '@guildhall/engine'
import { z } from 'zod'
import fs from 'node:fs/promises'
import {
  AgentIssue,
  AgentIssueCode,
  AgentIssueSeverity,
  ProgressEntry,
  TaskQueue,
  type Task,
} from '@guildhall/core'
import { logProgress } from './memory-tools.js'

// ---------------------------------------------------------------------------
// FR-31 Agent-issue channel
//
// `report_issue` is the counterpart to `raise-escalation`: where an escalation
// halts the task pending a human decision, an issue is a structured signal
// the agent emits *while continuing to work*. The coordinator's next tick
// (FR-32) reads the open-issue list and decides whether to intervene.
//
// Issues live on `Task.agentIssues[]`. A fresh issue has `broadcast=false`
// so the orchestrator can emit a single `agent_issue` wire event (FR-16) the
// next time it sees the task, then flip broadcast=true to avoid re-firing.
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

function nextIssueId(task: Task): string {
  return `iss-${task.id}-${task.agentIssues.length + 1}`
}

export async function reportIssue(input: ReportIssueInput): Promise<ReportIssueResult> {
  try {
    const parsed = reportIssueInputSchema.parse(input)
    const raw = await fs.readFile(parsed.tasksPath, 'utf-8')
    const queue = TaskQueue.parse(JSON.parse(raw))
    const task = queue.tasks.find((t) => t.id === parsed.taskId)
    if (!task) return { success: false, error: `Task ${parsed.taskId} not found` }

    const now = new Date().toISOString()
    const issue: AgentIssue = {
      id: nextIssueId(task),
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
    task.agentIssues.push(issue)
    // FR-31: issues do NOT change status — the task stays on its current track
    // until the coordinator's remediation loop acts on it.
    task.updatedAt = now
    queue.lastUpdated = now

    await fs.writeFile(parsed.tasksPath, JSON.stringify(queue, null, 2), 'utf-8')

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
    const raw = await fs.readFile(parsed.tasksPath, 'utf-8')
    const queue = TaskQueue.parse(JSON.parse(raw))
    const task = queue.tasks.find((t) => t.id === parsed.taskId)
    if (!task) return { success: false, error: `Task ${parsed.taskId} not found` }

    const issue = task.agentIssues.find((i) => i.id === parsed.issueId)
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
    issue.resolvedAt = now
    issue.resolution = parsed.resolution
    issue.resolvedBy = parsed.resolvedBy
    task.updatedAt = now
    queue.lastUpdated = now

    await fs.writeFile(parsed.tasksPath, JSON.stringify(queue, null, 2), 'utf-8')
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
