import { defineTool } from '@guildhall/engine'
import { z } from 'zod'
import fs from 'node:fs/promises'
import { Task, TaskQueue, TaskStatus } from '@guildhall/core'
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
  taskId: z.string(),
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
  completedAt: z.string().optional(),
})

export type UpdateTaskInput = z.input<typeof updateTaskInputSchema>
export interface UpdateTaskResult {
  success: boolean
  error?: string
}

export async function updateTask(input: UpdateTaskInput): Promise<UpdateTaskResult> {
  try {
    const raw = await fs.readFile(input.tasksPath, 'utf-8')
    const queue = TaskQueue.parse(JSON.parse(raw))
    const task = queue.tasks.find((t) => t.id === input.taskId)
    if (!task) return { success: false, error: `Task ${input.taskId} not found` }

    if (input.status) task.status = input.status
    if (input.assignedTo !== undefined) task.assignedTo = input.assignedTo
    if (input.blockReason !== undefined) task.blockReason = input.blockReason
    if (input.humanJudgment !== undefined) task.humanJudgment = input.humanJudgment
    if (input.completedAt !== undefined) task.completedAt = input.completedAt
    if (input.note) {
      task.notes.push({ ...input.note, timestamp: new Date().toISOString() })
    }
    task.updatedAt = new Date().toISOString()
    queue.lastUpdated = new Date().toISOString()

    atomicWriteText(input.tasksPath, JSON.stringify(queue, null, 2) + '\n')
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export const updateTaskTool = defineTool({
  name: 'update-task',
  description:
    "Update a task's status. Optionally add an agent note. Use this to transition tasks through the lifecycle.",
  inputSchema: updateTaskInputSchema,
  jsonSchema: { type: 'object' },
  isReadOnly: () => false,
  execute: async (input) => {
    const result = await updateTask(input)
    return {
      output: result.success
        ? `Updated task ${input.taskId}`
        : `Error updating task ${input.taskId}: ${result.error ?? 'unknown'}`,
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
