import fs from 'node:fs/promises'
import path from 'node:path'
import { getProjectMigrationSnapshotDir, getProjectSystemStatePath } from '@guildhall/sessions'
import { writeProjectTaskQueueWithSummary } from './project-state-boundary.js'
import { writeMigrationSnapshot } from './migration-snapshot.js'
import {
  assertLegacyCurrentStateMigrationAccess,
  legacyCurrentStateMigrationAvailable,
} from './runtime-compatibility.js'

export interface TaskDeliveryStepMigrationInput {
  projectRoot: string
  apply: boolean
}

export interface TaskDeliveryStepMigrationResult {
  changedTasks: string[]
  affectedPaths: string[]
  backupPath?: string
  manifestPath?: string
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
  return path.join(
    getProjectMigrationSnapshotDir(projectRoot),
    'task-delivery-steps',
    'TASKS.before-0.10.0-task-delivery-steps.json',
  )
}

function parseQueue(raw: string): QueueShape {
  const parsed = JSON.parse(raw) as unknown
  if (Array.isArray(parsed)) return { tasks: parsed as RawTask[] }
  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { tasks?: unknown }).tasks)) {
    return parsed as QueueShape
  }
  throw new Error('Cannot migrate task delivery steps: legacy TASKS.json does not contain a task queue.')
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
  if (!legacyCurrentStateMigrationAvailable(input.projectRoot)) {
    if (input.apply) assertLegacyCurrentStateMigrationAccess(input.projectRoot, '0.10.0/task-delivery-steps')
    return { changedTasks: [], affectedPaths: [] }
  }
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
  let manifestPath: string | undefined
  if (input.apply) {
    const snapshot = await writeMigrationSnapshot({
      projectRoot: input.projectRoot,
      migrationId: '0.10.0/task-delivery-steps',
      sourcePath: file,
      snapshotPath: backup,
      sourceBytes: raw,
    })
    manifestPath = snapshot.manifestPath
    writeProjectTaskQueueWithSummary(file, { ...queue, tasks }, {
      projectId: path.basename(input.projectRoot),
      fullCompatibility: true,
    })
  }

  return {
    changedTasks,
    affectedPaths: input.apply
      ? [TASKS_RELATIVE_PATH, backup, manifestPath as string]
      : [TASKS_RELATIVE_PATH],
    ...(input.apply ? { backupPath: backup, manifestPath } : {}),
  }
}
