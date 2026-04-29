import { defineTool } from '@guildhall/engine'
import { z } from 'zod'
import fs from 'node:fs/promises'
import {
  Escalation,
  EscalationReason,
  ProgressEntry,
  TaskQueue,
  type Task,
} from '@guildhall/core'
import { logProgress } from './memory-tools.js'
import { atomicWriteText } from '@guildhall/sessions'

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

export async function raiseEscalation(
  input: RaiseEscalationInput,
): Promise<RaiseEscalationResult> {
  try {
    const raw = await fs.readFile(input.tasksPath, 'utf-8')
    const queue = TaskQueue.parse(JSON.parse(raw))
    const task = queue.tasks.find((t) => t.id === input.taskId)
    if (!task) return { success: false, error: `Task ${input.taskId} not found` }

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
    "Raise a structured escalation on a task. This halts the task (sets status='blocked') and records a typed event to PROGRESS.md. Use this — not a plain note — whenever the task needs a human decision or cannot proceed autonomously.",
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
      task.status = input.nextStatus
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

/**
 * Returns true if the task has at least one unresolved escalation. Used by the
 * orchestrator to halt routing regardless of surface status.
 */
export function hasOpenEscalation(task: Task): boolean {
  return task.escalations.some((e) => !e.resolvedAt)
}
