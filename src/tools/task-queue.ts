import { defineTool } from '@guildhall/engine'
import { z } from 'zod'
import fs from 'node:fs/promises'
import { AcceptanceCriteria, GateResult, Task, TaskQueue, TaskStatus, parseAcceptanceCriteriaFromSpec } from '@guildhall/core'
import { atomicWriteText } from '@guildhall/sessions'

const TASKS_PATH_SCHEMA = z.string().describe('Absolute path to the TASKS.json file')

const readTasksInputSchema = z.object({ tasksPath: TASKS_PATH_SCHEMA })
export type ReadTasksInput = z.input<typeof readTasksInputSchema>
export interface ReadTasksResult {
  queue: z.infer<typeof TaskQueue> | null
  error?: string
}

export async function readTasks(input: ReadTasksInput): Promise<ReadTasksResult> {
  try {
    const raw = await fs.readFile(input.tasksPath, 'utf-8')
    return { queue: TaskQueue.parse(JSON.parse(raw)) }
  } catch (err) {
    return { queue: null, error: String(err) }
  }
}

export const readTasksTool = defineTool({
  name: 'read-tasks',
  description:
    'Read the full task queue. Always call this at the start of any coordination or work session to get current state.',
  inputSchema: readTasksInputSchema,
  jsonSchema: {
    type: 'object',
    properties: { tasksPath: { type: 'string' } },
    required: ['tasksPath'],
  },
  isReadOnly: () => true,
  execute: async (input) => {
    const result = await readTasks(input)
    if (!result.queue) {
      return {
        output: `Error reading tasks: ${result.error ?? 'unknown'}`,
        is_error: true,
        metadata: result as unknown as Record<string, unknown>,
      }
    }
    return {
      output: JSON.stringify(result.queue, null, 2),
      is_error: false,
      metadata: result as unknown as Record<string, unknown>,
    }
  },
})

const updateTaskInputSchema = z.object({
  tasksPath: TASKS_PATH_SCHEMA,
  taskId: z.string().optional(),
  title: z.string().optional(),
  status: TaskStatus.optional(),
  assignedTo: z.string().optional(),
  note: z
    .object({
      agentId: z.string(),
      role: z.string(),
      content: z.string(),
    })
    .optional(),
  blockReason: z.string().optional(),
  humanJudgment: z.string().optional(),
  spec: z.string().optional(),
  acceptanceCriteria: z.array(AcceptanceCriteria).optional(),
  gateResults: z.array(GateResult).optional(),
  completedAt: z.string().optional(),
})

export type UpdateTaskInput = z.input<typeof updateTaskInputSchema>
export interface UpdateTaskResult {
  success: boolean
  taskId?: string
  error?: string
}

function inferMetadataTaskId(metadata: Record<string, unknown> = {}): string | null {
  const taskId = metadata['current_task_id']
  return typeof taskId === 'string' && taskId.trim().length > 0 ? taskId.trim() : null
}

export async function updateTask(
  input: UpdateTaskInput,
  metadata: Record<string, unknown> = {},
): Promise<UpdateTaskResult> {
  try {
    const raw = await fs.readFile(input.tasksPath, 'utf-8')
    const queue = TaskQueue.parse(JSON.parse(raw))
    const taskId = input.taskId ?? inferMetadataTaskId(metadata) ?? inferSingleActiveTaskId(queue)
    if (!taskId) {
      return {
        success: false,
        error: 'Missing taskId (or metadata.current_task_id) and could not infer a single active task',
      }
    }
    const task = queue.tasks.find((t) => t.id === taskId)
    if (!task) return { success: false, taskId, error: `Task ${taskId} not found` }

    if (!hasTaskMutation(input)) {
      return {
        success: false,
        taskId,
        error:
          'No task mutation provided. Set at least one of title, status, assignedTo, note, blockReason, humanJudgment, spec, acceptanceCriteria, gateResults, or completedAt.',
      }
    }

    if (input.title !== undefined) task.title = input.title
    const explicitStatus = input.status ? TaskStatus.parse(input.status) : undefined
    if (explicitStatus) task.status = explicitStatus
    if (input.assignedTo !== undefined) {
      if (input.assignedTo.trim() === '') delete task.assignedTo
      else task.assignedTo = input.assignedTo
    }
    if (input.blockReason !== undefined && input.blockReason.trim() !== '') task.blockReason = input.blockReason
    if (input.humanJudgment !== undefined && input.humanJudgment.trim() !== '') task.humanJudgment = input.humanJudgment
    if (input.spec !== undefined && input.spec.trim() !== '') {
      task.spec = input.spec
      if (task.acceptanceCriteria.length === 0) {
        const derivedCriteria = parseAcceptanceCriteriaFromSpec(input.spec)
        if (derivedCriteria.length > 0) task.acceptanceCriteria = derivedCriteria
      }
    }
    if (
      input.status === undefined &&
      input.spec !== undefined &&
      input.spec.trim() !== '' &&
      task.status === 'exploring'
    ) {
      task.status = 'spec_review'
    }
    normalizeAssignmentForStatus(task, {
      explicitAssignedTo: input.assignedTo !== undefined,
      explicitStatus,
    })
    if (input.acceptanceCriteria !== undefined && input.acceptanceCriteria.length > 0) {
      task.acceptanceCriteria = z.array(AcceptanceCriteria).parse(input.acceptanceCriteria)
    }
    if (input.gateResults !== undefined && input.gateResults.length > 0) {
      task.gateResults = z.array(GateResult).parse(input.gateResults)
    }
    if (input.completedAt !== undefined && input.completedAt.trim() !== '') task.completedAt = input.completedAt
    if (input.note) {
      task.notes.push({ ...input.note, timestamp: new Date().toISOString() })
    }
    task.updatedAt = new Date().toISOString()
    queue.lastUpdated = new Date().toISOString()

    atomicWriteText(input.tasksPath, JSON.stringify(queue, null, 2) + '\n')
    return { success: true, taskId }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

function normalizeAssignmentForStatus(
  task: z.infer<typeof Task>,
  opts: { explicitAssignedTo: boolean; explicitStatus?: z.infer<typeof TaskStatus> },
): void {
  if (opts.explicitAssignedTo) return

  switch (task.status) {
    case 'in_progress':
      task.assignedTo = 'worker-agent'
      return
    case 'review':
      task.assignedTo = 'reviewer-agent'
      return
    case 'gate_check':
      task.assignedTo = 'gate-checker-agent'
      return
    case 'ready':
    case 'spec_review':
    case 'exploring':
    case 'proposed':
    case 'pending_pr':
    case 'done':
    case 'shelved':
    case 'blocked':
      if (opts.explicitStatus) delete task.assignedTo
      return
  }
}

function hasTaskMutation(input: UpdateTaskInput): boolean {
  return input.title !== undefined ||
    input.status !== undefined ||
    input.assignedTo !== undefined ||
    input.note !== undefined ||
    input.blockReason !== undefined ||
    input.humanJudgment !== undefined ||
    input.spec !== undefined ||
    input.acceptanceCriteria !== undefined ||
    input.gateResults !== undefined ||
    input.completedAt !== undefined
}

function inferSingleActiveTaskId(queue: z.infer<typeof TaskQueue>): string | null {
  const candidates = queue.tasks.filter((t) =>
    ['in_progress', 'review', 'gate_check', 'spec_review'].includes(t.status),
  )
  return candidates.length === 1 ? candidates[0]!.id : null
}

export const updateTaskTool = defineTool({
  name: 'update-task',
  description:
    "Update a task's title, status, spec, acceptance criteria, assignment, or notes. Use this to transition tasks through the lifecycle.",
  inputSchema: updateTaskInputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      tasksPath: { type: 'string', description: 'Absolute path to TASKS.json' },
      taskId: { type: 'string', description: 'Task id. Omit only when exactly one task is active.' },
      title: { type: 'string' },
      status: {
        type: 'string',
        enum: [
          'proposed',
          'exploring',
          'spec_review',
          'ready',
          'in_progress',
          'review',
          'gate_check',
          'pending_pr',
          'done',
          'shelved',
          'blocked',
        ],
      },
      assignedTo: { type: 'string' },
      note: {
        type: 'object',
        properties: {
          agentId: { type: 'string' },
          role: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['agentId', 'role', 'content'],
      },
      blockReason: { type: 'string' },
      humanJudgment: { type: 'string' },
      spec: { type: 'string' },
      acceptanceCriteria: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            description: { type: 'string' },
            verifiedBy: { type: 'string', enum: ['automated', 'review', 'human'] },
            command: { type: 'string' },
            met: { type: 'boolean' },
          },
          required: ['id', 'description', 'verifiedBy'],
        },
      },
      gateResults: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            gateId: { type: 'string' },
            type: { type: 'string', enum: ['hard', 'soft'] },
            passed: { type: 'boolean' },
            output: { type: 'string' },
            checkedAt: { type: 'string', description: 'ISO timestamp when the gate ran' },
          },
          required: ['gateId', 'type', 'passed', 'checkedAt'],
        },
      },
      completedAt: { type: 'string', description: 'ISO timestamp when the task completed' },
    },
    required: ['tasksPath'],
  },
  isReadOnly: () => false,
  execute: async (input, ctx = {}) => {
    const result = await updateTask(input, (ctx as { metadata?: Record<string, unknown> }).metadata ?? {})
    return {
      output: result.success
        ? `Updated task ${result.taskId ?? input.taskId ?? '(inferred task)'}`
        : `Error updating task ${input.taskId ?? '(missing taskId)'}: ${result.error ?? 'unknown'}`,
      is_error: !result.success,
      metadata: result as unknown as Record<string, unknown>,
    }
  },
})

const addTaskInputSchema = z.object({
  tasksPath: TASKS_PATH_SCHEMA,
  task: Task.omit({ notes: true, gateResults: true, revisionCount: true }),
})

export type AddTaskInput = z.input<typeof addTaskInputSchema>
export interface AddTaskResult {
  success: boolean
  taskId?: string
  error?: string
}

export async function addTask(input: AddTaskInput): Promise<AddTaskResult> {
  try {
    const raw = await fs.readFile(input.tasksPath, 'utf-8')
    const queue = TaskQueue.parse(JSON.parse(raw))
    const newTask = Task.parse({
      ...input.task,
      notes: [],
      gateResults: [],
      revisionCount: 0,
    })
    queue.tasks.push(newTask)
    queue.lastUpdated = new Date().toISOString()
    atomicWriteText(input.tasksPath, JSON.stringify(queue, null, 2) + '\n')
    return { success: true, taskId: newTask.id }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export const addTaskTool = defineTool({
  name: 'add-task',
  description: 'Add a new task to the task queue. Used by coordinators and spec agents to create work items.',
  inputSchema: addTaskInputSchema,
  jsonSchema: { type: 'object' },
  isReadOnly: () => false,
  execute: async (input) => {
    const result = await addTask(input)
    return {
      output: result.success
        ? `Added task ${result.taskId}`
        : `Error adding task: ${result.error ?? 'unknown'}`,
      is_error: !result.success,
      metadata: result as unknown as Record<string, unknown>,
    }
  },
})
