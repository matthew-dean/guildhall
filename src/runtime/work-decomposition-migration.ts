import fs from 'node:fs/promises'
import path from 'node:path'
import { getProjectMigrationSnapshotDir, getProjectSystemStatePath } from '@guildhall/sessions'
import { writeProjectTaskQueueWithSummary } from './project-state-boundary.js'
import { writeMigrationSnapshot } from './migration-snapshot.js'
import {
  assertLegacyCurrentStateMigrationAccess,
  legacyCurrentStateMigrationAvailable,
} from './runtime-compatibility.js'

export interface WorkDecompositionMigrationInput {
  projectRoot: string
  apply: boolean
  now?: string
}

export interface WorkDecompositionMigrationResult {
  changedTasks: string[]
  createdActions: string[]
  affectedPaths: string[]
  backupPath?: string
  manifestPath?: string
}

interface RawExecutionPlanAction {
  id?: unknown
  type?: unknown
  targetWorkId?: unknown
  status?: unknown
  createdChildIds?: unknown
  [key: string]: unknown
}

interface RawTask {
  id?: unknown
  title?: unknown
  hierarchy?: {
    parentId?: unknown
    childIds?: unknown
    order?: unknown
    relation?: unknown
  }
  sizePlan?: {
    action?: unknown
    recommendedChildren?: unknown
    [key: string]: unknown
  }
  [key: string]: unknown
}

interface QueueShape {
  version?: unknown
  lastUpdated?: unknown
  tasks: RawTask[]
  executionPlanActions?: RawExecutionPlanAction[]
  [key: string]: unknown
}

const MIGRATION_ID = '0.11.0/execution-planning-decomposition'
const TASKS_RELATIVE_PATH = '.guildhall/TASKS.json'

function tasksPath(projectRoot: string): string {
  return getProjectSystemStatePath(projectRoot, 'TASKS.json')
}

function backupPath(projectRoot: string): string {
  return path.join(
    getProjectMigrationSnapshotDir(projectRoot),
    'execution-planning-decomposition',
    'TASKS.before-0.11.0-execution-planning-decomposition.json',
  )
}

function parseQueue(raw: string): QueueShape {
  const parsed = JSON.parse(raw) as unknown
  if (Array.isArray(parsed)) return { tasks: parsed as RawTask[] }
  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { tasks?: unknown }).tasks)) {
    return parsed as QueueShape
  }
  throw new Error('Cannot migrate work decomposition: legacy TASKS.json does not contain a task queue.')
}

function taskId(task: RawTask): string | null {
  return typeof task.id === 'string' && task.id.trim() ? task.id.trim() : null
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : []
}

function legacySplitAction(action: unknown): boolean {
  return action === 'split_required' || action === 'split_recommended'
}

function recommendedChildren(task: RawTask): Array<{ createdTaskId?: unknown }> {
  return Array.isArray(task.sizePlan?.recommendedChildren)
    ? task.sizePlan.recommendedChildren as Array<{ createdTaskId?: unknown }>
    : []
}

function representedChildIds(task: RawTask, tasksById: Map<string, RawTask>): string[] {
  const ids = [
    ...stringArray(task.hierarchy?.childIds),
    ...recommendedChildren(task)
      .map(child => typeof child.createdTaskId === 'string' ? child.createdTaskId.trim() : '')
      .filter(Boolean),
  ]
  return [...new Set(ids)].filter(id => tasksById.has(id))
}

function actionExists(queue: QueueShape, targetWorkId: string, childIds: string[]): boolean {
  return (queue.executionPlanActions ?? []).some(action =>
    action.type === 'split_work' &&
    action.targetWorkId === targetWorkId &&
    Array.isArray(action.createdChildIds) &&
    sameStringSet(action.createdChildIds.filter((id): id is string => typeof id === 'string'), childIds),
  )
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false
  const rightSet = new Set(right)
  return left.every(value => rightSet.has(value))
}

function uniqueActionId(queue: QueueShape, taskId: string, status: 'applied' | 'failed'): string {
  const base = `${taskId}-decomposition-migration-${status}`
  const existingIds = new Set((queue.executionPlanActions ?? []).map(action => typeof action.id === 'string' ? action.id : ''))
  if (!existingIds.has(base)) return base
  let index = 2
  while (existingIds.has(`${base}-${index}`)) index += 1
  return `${base}-${index}`
}

function markChildRelations(childIds: string[], tasksById: Map<string, RawTask>): void {
  for (const childId of childIds) {
    const child = tasksById.get(childId)
    if (!child) continue
    child.hierarchy = {
      ...(child.hierarchy ?? {}),
      relation: child.hierarchy?.relation ?? 'decomposes',
    }
  }
}

export async function migrateWorkDecompositionState(
  input: WorkDecompositionMigrationInput,
): Promise<WorkDecompositionMigrationResult> {
  if (!legacyCurrentStateMigrationAvailable(input.projectRoot)) {
    if (input.apply) assertLegacyCurrentStateMigrationAccess(input.projectRoot, MIGRATION_ID)
    return { changedTasks: [], createdActions: [], affectedPaths: [] }
  }
  const file = tasksPath(input.projectRoot)
  let raw: string
  try {
    raw = await fs.readFile(file, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { changedTasks: [], createdActions: [], affectedPaths: [] }
    }
    throw err
  }

  const queue = parseQueue(raw)
  queue.executionPlanActions ??= []
  const tasksById = new Map<string, RawTask>()
  for (const task of queue.tasks) {
    const id = taskId(task)
    if (id) tasksById.set(id, task)
  }

  const changedTasks: string[] = []
  const createdActions: string[] = []
  const now = input.now ?? new Date().toISOString()

  for (const task of queue.tasks) {
    const id = taskId(task)
    if (!id || !legacySplitAction(task.sizePlan?.action)) continue
    const childIds = representedChildIds(task, tasksById)
    const recommendations = recommendedChildren(task)
    if (childIds.length > 0) {
      markChildRelations(childIds, tasksById)
      task.hierarchy = {
        ...(task.hierarchy ?? {}),
        childIds,
        relation: task.hierarchy?.relation ?? 'contains',
      }
      if (!actionExists(queue, id, childIds)) {
        const actionId = uniqueActionId(queue, id, 'applied')
        queue.executionPlanActions.push({
          id: actionId,
          type: 'split_work',
          targetWorkId: id,
          status: 'applied',
          authority: 'execution_planning',
          rationale: 'Migrated legacy split recommendations into execution-planning action audit.',
          createdChildIds: childIds,
          createdAt: now,
          createdBy: MIGRATION_ID,
          appliedAt: now,
          appliedBy: MIGRATION_ID,
        })
        createdActions.push(actionId)
      }
      changedTasks.push(id, ...childIds)
      continue
    }
    if (recommendations.length > 0 && !actionExists(queue, id, [])) {
      const actionId = uniqueActionId(queue, id, 'failed')
      queue.executionPlanActions.push({
        id: actionId,
        type: 'split_work',
        targetWorkId: id,
        status: 'failed',
        authority: 'execution_planning',
        rationale: 'Legacy split recommendations need coordinator recovery before child work can be created.',
        createdChildIds: [],
        createdAt: now,
        createdBy: MIGRATION_ID,
        appliedAt: now,
        appliedBy: MIGRATION_ID,
        failureReason: 'Unmaterialized legacy recommendation drafts are compatibility data only; coordinator must regenerate decomposition from accepted scope.',
      })
      createdActions.push(actionId)
      changedTasks.push(id)
    }
  }

  const uniqueChangedTasks = [...new Set(changedTasks)]
  if (createdActions.length === 0 && uniqueChangedTasks.length === 0) {
    return { changedTasks: [], createdActions: [], affectedPaths: [] }
  }
  if (!input.apply) {
    return {
      changedTasks: uniqueChangedTasks,
      createdActions,
      affectedPaths: [TASKS_RELATIVE_PATH],
    }
  }

  const backup = backupPath(input.projectRoot)
  const snapshot = await writeMigrationSnapshot({
    projectRoot: input.projectRoot,
    migrationId: MIGRATION_ID,
    sourcePath: file,
    snapshotPath: backup,
    sourceBytes: raw,
    now,
  })
  writeProjectTaskQueueWithSummary(file, {
    ...queue,
    tasks: queue.tasks,
    executionPlanActions: queue.executionPlanActions,
  }, {
    projectId: path.basename(input.projectRoot),
    fullCompatibility: true,
  })
  return {
    changedTasks: uniqueChangedTasks,
    createdActions,
    affectedPaths: [TASKS_RELATIVE_PATH, backup, snapshot.manifestPath],
    backupPath: backup,
    manifestPath: snapshot.manifestPath,
  }
}
