/**
 * FR-21 agent-originated proposals + FR-22 worker pre-rejection.
 *
 * `proposeTask` — creates a new task in status `proposed` with origination
 * set to `agent`. Intended for coordinators, workers, and spec agents to
 * flag work they think is worth doing. Promotion to `ready` / `spec_review`
 * / `shelved` is decided separately by the orchestrator via
 * `evaluateProposal` (in @guildhall/runtime) against the domain's
 * `task_origination` lever.
 *
 * `preRejectTask` — moves a task to `shelved` with a structured rejection
 * code (no_op / not_viable / low_value / duplicate / spec_wrong). Pre-
 * rejection is a distinct path from the reviewer revision loop: it skips
 * the reviewer and does not increment revisionCount (FR-22). Downstream
 * requeue vs terminal behavior is decided by the orchestrator against the
 * `pre_rejection_policy` lever; this helper writes the terminal form of
 * the decision, and the orchestrator may subsequently resurrect the task
 * to `ready` at lower priority per the lever.
 */

import { defineTool } from '@guildhall/engine'
import { z } from 'zod'
import fs from 'node:fs/promises'
import { Task, TaskQueue, PreRejectionCode } from '@guildhall/core'
import { atomicWriteText } from '@guildhall/sessions'

const TASKS_PATH_SCHEMA = z.string().describe('Absolute path to the TASKS.json file')

// ---------------------------------------------------------------------------
// proposeTask
// ---------------------------------------------------------------------------

const proposeTaskInputSchema = z.object({
  tasksPath: TASKS_PATH_SCHEMA,
  proposal: z.object({
    id: z.string(),
    title: z.string(),
    description: z.string(),
    domain: z.string(),
    projectPath: z.string(),
    priority: z.enum(['critical', 'high', 'normal', 'low']).default('normal'),
    /** Agent id that is proposing this task. */
    proposedBy: z.string(),
    /** Why the proposing agent thinks this is worth doing. */
    rationale: z.string(),
    /** FR-23 — parent goal this proposal contributes to. */
    parentGoalId: z.string().optional(),
    /** Optional success condition / one-line acceptance. */
    successCondition: z.string().optional(),
  }),
})

export type ProposeTaskInput = z.input<typeof proposeTaskInputSchema>
export interface ProposeTaskResult {
  success: boolean
  taskId?: string
  error?: string
}

export async function proposeTask(input: ProposeTaskInput): Promise<ProposeTaskResult> {
  try {
    const parsed = proposeTaskInputSchema.parse(input)
    const raw = await fs.readFile(parsed.tasksPath, 'utf-8')
    const queue = TaskQueue.parse(JSON.parse(raw))

    if (queue.tasks.some((t) => t.id === parsed.proposal.id)) {
      return { success: false, error: `Task id ${parsed.proposal.id} already exists` }
    }

    const now = new Date().toISOString()
    const proposed = Task.parse({
      id: parsed.proposal.id,
      title: parsed.proposal.title,
      description: parsed.proposal.description,
      domain: parsed.proposal.domain,
      projectPath: parsed.proposal.projectPath,
      status: 'proposed',
      priority: parsed.proposal.priority,
      spec: parsed.proposal.successCondition,
      origination: 'agent',
      proposedBy: parsed.proposal.proposedBy,
      proposalRationale: parsed.proposal.rationale,
      parentGoalId: parsed.proposal.parentGoalId,
      createdAt: now,
      updatedAt: now,
    })

    queue.tasks.push(proposed)
    queue.lastUpdated = now
    atomicWriteText(parsed.tasksPath, JSON.stringify(queue, null, 2) + '\n')
    return { success: true, taskId: proposed.id }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export const proposeTaskTool = defineTool({
  name: 'propose-task',
  description:
    'Propose a new task (FR-21). Creates a task in `proposed` status originated by an agent. ' +
    'The orchestrator decides whether the proposal is auto-approved, routed for human/coordinator ' +
    'review, or rejected, based on the domain\'s `task_origination` lever. Use this when you ' +
    'notice work that should be done but is not on the queue.',
  inputSchema: proposeTaskInputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      tasksPath: { type: 'string' },
      proposal: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          domain: { type: 'string' },
          projectPath: { type: 'string' },
          priority: {
            type: 'string',
            enum: ['critical', 'high', 'normal', 'low'],
          },
          proposedBy: { type: 'string' },
          rationale: { type: 'string' },
          parentGoalId: { type: 'string' },
          successCondition: { type: 'string' },
        },
        required: ['id', 'title', 'description', 'domain', 'projectPath', 'proposedBy', 'rationale'],
      },
    },
    required: ['tasksPath', 'proposal'],
  },
  isReadOnly: () => false,
  execute: async (input) => {
    const result = await proposeTask(input)
    return {
      output: result.success
        ? `Proposed task ${result.taskId}`
        : `Error proposing task: ${result.error ?? 'unknown'}`,
      is_error: !result.success,
      metadata: result as unknown as Record<string, unknown>,
    }
  },
})

// ---------------------------------------------------------------------------
// preRejectTask (FR-22)
// ---------------------------------------------------------------------------

const preRejectTaskInputSchema = z.object({
  tasksPath: TASKS_PATH_SCHEMA,
  taskId: z.string(),
  code: PreRejectionCode,
  detail: z.string(),
  rejectedBy: z.string().describe('Agent id that is pre-rejecting the task'),
})

export type PreRejectTaskInput = z.input<typeof preRejectTaskInputSchema>
export interface PreRejectTaskResult {
  success: boolean
  error?: string
}

export async function preRejectTask(input: PreRejectTaskInput): Promise<PreRejectTaskResult> {
  try {
    const parsed = preRejectTaskInputSchema.parse(input)
    const raw = await fs.readFile(parsed.tasksPath, 'utf-8')
    const queue = TaskQueue.parse(JSON.parse(raw))
    const idx = queue.tasks.findIndex((t) => t.id === parsed.taskId)
    if (idx === -1) return { success: false, error: `Task ${parsed.taskId} not found` }

    const task = queue.tasks[idx]!
    if (task.status === 'done' || task.status === 'shelved' || task.status === 'blocked') {
      return {
        success: false,
        error: `Task ${parsed.taskId} is already terminal (${task.status}); cannot pre-reject`,
      }
    }

    const now = new Date().toISOString()
    queue.tasks[idx] = {
      ...task,
      status: 'shelved',
      shelveReason: {
        code: parsed.code,
        detail: parsed.detail,
        rejectedBy: parsed.rejectedBy,
        rejectedAt: now,
        source: 'worker_pre_rejection',
        policyApplied: false,
        requeueCount: task.shelveReason?.requeueCount ?? 0,
      },
      updatedAt: now,
      completedAt: now,
    }
    queue.lastUpdated = now
    atomicWriteText(parsed.tasksPath, JSON.stringify(queue, null, 2) + '\n')
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export const preRejectTaskTool = defineTool({
  name: 'pre-reject-task',
  description:
    'Pre-reject a task (FR-22). Emits a structured rejection with one of: no_op, not_viable, ' +
    'low_value, duplicate, spec_wrong. Skips the reviewer and does not increment revisionCount. ' +
    'Use this when you realize the work is not worth doing, cannot be done, or overlaps with ' +
    'work already in flight.',
  inputSchema: preRejectTaskInputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      tasksPath: { type: 'string' },
      taskId: { type: 'string' },
      code: {
        type: 'string',
        enum: ['no_op', 'not_viable', 'low_value', 'duplicate', 'spec_wrong'],
      },
      detail: { type: 'string' },
      rejectedBy: { type: 'string' },
    },
    required: ['tasksPath', 'taskId', 'code', 'detail', 'rejectedBy'],
  },
  isReadOnly: () => false,
  execute: async (input) => {
    const result = await preRejectTask(input)
    return {
      output: result.success
        ? `Pre-rejected task ${input.taskId} (${input.code})`
        : `Error pre-rejecting task: ${result.error ?? 'unknown'}`,
      is_error: !result.success,
      metadata: result as unknown as Record<string, unknown>,
    }
  },
})
