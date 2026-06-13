import fs from 'node:fs/promises'
import path from 'node:path'
import { atomicWriteText, getProjectSystemStatePath } from '@guildhall/sessions'

export interface TaskDeliveryStepMigrationInput {
  projectRoot: string
  apply: boolean
}

export interface TaskDeliveryStepMigrationResult {
  changedTasks: string[]
  affectedPaths: string[]
  backupPath?: string
}

interface RawTask {
  id?: unknown
  title?: unknown
  status?: unknown
  workKind?: unknown
  workVisibility?: {
    kind?: unknown
    countInProjectTotals?: unknown
  }
  deliverySteps?: unknown
  hierarchy?: {
    parentId?: unknown
    childIds?: unknown
  }
  [key: string]: unknown
}

interface QueueShape {
  version?: unknown
  lastUpdated?: unknown
  tasks: RawTask[]
  [key: string]: unknown
}

const INTERNAL_STEP_WORK_KINDS = new Set(['test', 'verification'])
const TASKS_RELATIVE_PATH = '.guildhall/TASKS.json'

function tasksPath(projectRoot: string): string {
  return getProjectSystemStatePath(projectRoot, 'TASKS.json')
}

function backupPath(projectRoot: string): string {
  return path.join(path.dirname(tasksPath(projectRoot)), 'TASKS.before-0.10.0-task-delivery-steps.json')
}

function parseQueue(raw: string): QueueShape {
  const parsed = JSON.parse(raw) as unknown
  if (Array.isArray(parsed)) return { tasks: parsed as RawTask[] }
  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { tasks?: unknown }).tasks)) {
    return parsed as QueueShape
  }
  return { tasks: [] }
}

function taskId(task: RawTask): string | null {
  return typeof task.id === 'string' && task.id.trim() ? task.id : null
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function deliveryStatusForTask(status: unknown): 'todo' | 'active' | 'blocked' | 'done' | 'waived' {
  switch (status) {
    case 'done':
    case 'pending_pr':
      return 'done'
    case 'blocked':
      return 'blocked'
    case 'in_progress':
    case 'review':
    case 'gate_check':
      return 'active'
    case 'shelved':
      return 'waived'
    default:
      return 'todo'
  }
}

function hasDeliveryStepFor(parent: RawTask, childId: string): boolean {
  if (!Array.isArray(parent.deliverySteps)) return false
  return parent.deliverySteps.some((step) => {
    if (!step || typeof step !== 'object' || Array.isArray(step)) return false
    const record = step as { id?: unknown; sourceTaskId?: unknown }
    return record.id === `task:${childId}` || record.sourceTaskId === childId
  })
}

function cloneTask(task: RawTask): RawTask {
  return {
    ...task,
    hierarchy: task.hierarchy ? { ...task.hierarchy } : undefined,
    workVisibility: task.workVisibility ? { ...task.workVisibility } : undefined,
    deliverySteps: Array.isArray(task.deliverySteps)
      ? task.deliverySteps.map(step => step && typeof step === 'object' && !Array.isArray(step) ? { ...step } : step)
      : task.deliverySteps,
  }
}

export async function migrateTaskDeliveryStepState(
  input: TaskDeliveryStepMigrationInput,
): Promise<TaskDeliveryStepMigrationResult> {
  const file = tasksPath(input.projectRoot)
  let raw: string
  try {
    raw = await fs.readFile(file, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { changedTasks: [], affectedPaths: [] }
    }
    throw err
  }

  const queue = parseQueue(raw)
  const tasks = queue.tasks.map(cloneTask)
  const tasksById = new Map<string, RawTask>()
  for (const task of tasks) {
    const id = taskId(task)
    if (id) tasksById.set(id, task)
  }

  const changedTasks: string[] = []
  const markChanged = (id: string) => {
    if (!changedTasks.includes(id)) changedTasks.push(id)
  }

  for (const task of tasks) {
    const childId = taskId(task)
    if (!childId) continue
    const parentId = stringValue(task.hierarchy?.parentId)
    const workKind = stringValue(task.workKind)
    if (!parentId || !workKind || !INTERNAL_STEP_WORK_KINDS.has(workKind)) continue
    const parent = tasksById.get(parentId)
    if (!parent) continue

    const beforeChild = JSON.stringify(task)
    task.workVisibility = {
      ...(task.workVisibility ?? {}),
      kind: 'internal_step',
      countInProjectTotals: false,
    }
    if (JSON.stringify(task) !== beforeChild) markChanged(childId)

    if (!hasDeliveryStepFor(parent, childId)) {
      parent.deliverySteps = [
        ...(Array.isArray(parent.deliverySteps) ? parent.deliverySteps : []),
        {
          id: `task:${childId}`,
          title: stringValue(task.title) ?? childId,
          kind: 'verify',
          status: deliveryStatusForTask(task.status),
          required: true,
          blocksCompletion: true,
          sourceTaskId: childId,
        },
      ]
      markChanged(parentId)
    }
  }

  if (changedTasks.length === 0) return { changedTasks: [], affectedPaths: [] }

  const backup = backupPath(input.projectRoot)
  if (input.apply) {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(backup, raw, 'utf8').catch(() => undefined)
    await atomicWriteText(file, `${JSON.stringify({ ...queue, tasks }, null, 2)}\n`)
  }

  return {
    changedTasks,
    affectedPaths: [TASKS_RELATIVE_PATH, backup],
    backupPath: backup,
  }
}
