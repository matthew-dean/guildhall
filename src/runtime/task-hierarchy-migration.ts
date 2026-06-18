import fs from 'node:fs/promises'
import path from 'node:path'
import { atomicWriteText, getLegacyProjectStatePath } from '@guildhall/sessions'

export interface TaskHierarchyMigrationInput {
  projectRoot: string
  apply: boolean
  now?: string
}

export interface TaskHierarchyMigrationResult {
  changedTasks: string[]
  backupPath?: string
  affectedPaths: string[]
}

interface RawTask {
  id?: unknown
  status?: unknown
  parentGoalId?: unknown
  businessEnvelope?: { goalId?: unknown }
  hierarchy?: {
    parentId?: unknown
    childIds?: unknown
    order?: unknown
  }
  completionBoundary?: Record<string, unknown>
  taskReadiness?: Record<string, unknown>
  workKind?: unknown
  [key: string]: unknown
}

interface QueueShape {
  version?: unknown
  lastUpdated?: unknown
  tasks: RawTask[]
  [key: string]: unknown
}

const MIGRATION_ID = '0.10.0/task-hierarchy-links'
const TASKS_RELATIVE_PATH = '.guildhall/TASKS.json'

function tasksPath(projectRoot: string): string {
  return getLegacyProjectStatePath(projectRoot, 'TASKS.json')
}

function backupPath(projectRoot: string): string {
  return getLegacyProjectStatePath(projectRoot, 'TASKS.before-0.10.0-task-hierarchy-links.json')
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

function legacyHierarchyParentId(rawGoalId: unknown, tasksById: Map<string, RawTask>, selfId: string): string | null {
  if (typeof rawGoalId !== 'string') return null
  const trimmed = rawGoalId.trim()
  if (!trimmed.startsWith('goal-task-')) return null
  const legacy = trimmed.replace(/^goal-/, '')
  if (legacy !== selfId && tasksById.has(legacy)) return legacy
  const withoutTaskPrefix = legacy.replace(/^task-/, '')
  if (withoutTaskPrefix !== selfId && tasksById.has(withoutTaskPrefix)) return withoutTaskPrefix
  return null
}

function isSelfHierarchyGoal(rawGoalId: unknown, selfId: string): boolean {
  if (typeof rawGoalId !== 'string') return false
  return rawGoalId.trim() === `goal-task-${selfId}` || rawGoalId.trim() === `goal-${selfId}`
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function sortChildIds(ids: Iterable<string>, tasksById: Map<string, RawTask>): string[] {
  return [...new Set(ids)].sort((left, right) => {
    const leftOrder = Number((tasksById.get(left)?.hierarchy?.order ?? 0))
    const rightOrder = Number((tasksById.get(right)?.hierarchy?.order ?? 0))
    if (Number.isFinite(leftOrder) && Number.isFinite(rightOrder) && leftOrder !== rightOrder) return leftOrder - rightOrder
    return left.localeCompare(right)
  })
}

function ensureNoCycles(tasks: RawTask[]): void {
  const byId = new Map<string, RawTask>()
  for (const task of tasks) {
    const id = taskId(task)
    if (id) byId.set(id, task)
  }

  const visiting = new Set<string>()
  const visited = new Set<string>()

  const visit = (id: string) => {
    if (visited.has(id)) return
    if (visiting.has(id)) throw new Error(`Task hierarchy cycle detected at ${id}`)
    visiting.add(id)
    const task = byId.get(id)
    const childIds = stringArray(task?.hierarchy?.childIds)
    for (const childId of childIds) {
      if (byId.has(childId)) visit(childId)
    }
    visiting.delete(id)
    visited.add(id)
  }

  for (const id of byId.keys()) visit(id)
}

export async function migrateTaskHierarchyState(
  input: TaskHierarchyMigrationInput,
): Promise<TaskHierarchyMigrationResult> {
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
  const originalTasksByIndex = queue.tasks
  const tasks = originalTasksByIndex.map(task => ({ ...task, hierarchy: task.hierarchy ? { ...task.hierarchy } : undefined }))
  const tasksById = new Map<string, RawTask>()
  for (const task of tasks) {
    const id = taskId(task)
    if (id) tasksById.set(id, task)
  }

  const childIdsByParent = new Map<string, Set<string>>()
  const legacyParentByChild = new Map<string, string>()

  for (const task of tasks) {
    const id = taskId(task)
    if (!id) continue

    const explicitParentId = typeof task.hierarchy?.parentId === 'string' ? task.hierarchy.parentId.trim() : ''
    if (explicitParentId && explicitParentId !== id && tasksById.has(explicitParentId)) {
      if (!childIdsByParent.has(explicitParentId)) childIdsByParent.set(explicitParentId, new Set())
      childIdsByParent.get(explicitParentId)?.add(id)
    }

    for (const childId of stringArray(task.hierarchy?.childIds)) {
      if (childId !== id && tasksById.has(childId)) {
        if (!childIdsByParent.has(id)) childIdsByParent.set(id, new Set())
        childIdsByParent.get(id)?.add(childId)
      }
    }

    const legacyParentId = legacyHierarchyParentId(task.parentGoalId, tasksById, id)
    if (legacyParentId) {
      legacyParentByChild.set(id, legacyParentId)
      if (!childIdsByParent.has(legacyParentId)) childIdsByParent.set(legacyParentId, new Set())
      childIdsByParent.get(legacyParentId)?.add(id)
    }
  }

  const changedTasks: string[] = []
  const markChanged = (id: string) => {
    if (!changedTasks.includes(id)) changedTasks.push(id)
  }

  for (const task of tasks) {
    const id = taskId(task)
    if (!id) continue
    const before = JSON.stringify(task)

    const childIds = sortChildIds(childIdsByParent.get(id) ?? [], tasksById)
    const legacyParentId = legacyParentByChild.get(id)
    const wasParentStatus = task.status === 'parent'
    const hasSelfHierarchyGoal = isSelfHierarchyGoal(task.parentGoalId, id)

    if (legacyParentId) {
      task.hierarchy = {
        ...(task.hierarchy ?? {}),
        parentId: legacyParentId,
        order: typeof task.hierarchy?.order === 'number' ? task.hierarchy.order : childIdsByParent.get(legacyParentId)?.size ?? 0,
        childIds: stringArray(task.hierarchy?.childIds),
      }
      delete task.parentGoalId
    } else if (typeof task.parentGoalId === 'string' && task.parentGoalId.trim() && !hasSelfHierarchyGoal) {
      task.businessEnvelope = {
        ...(task.businessEnvelope ?? {}),
        goalId: typeof task.businessEnvelope?.goalId === 'string' ? task.businessEnvelope.goalId : task.parentGoalId.trim(),
      }
      delete task.parentGoalId
    }

    if (wasParentStatus || childIds.length > 0) {
      if (wasParentStatus) task.status = 'ready'
      task.hierarchy = {
        ...(task.hierarchy ?? {}),
        childIds,
      }
      task.workKind = task.workKind ?? 'feature_spec'
      task.taskReadiness = {
        ...(task.taskReadiness ?? {}),
        recommendation: 'requires_child_work',
      }
      task.completionBoundary = {
        summary: task.completionBoundary?.summary ?? 'Containing work is complete when required child work is done.',
        requiredChildPolicy: task.completionBoundary?.requiredChildPolicy ?? 'all_required_done',
        requiredChildIds: Array.isArray(task.completionBoundary?.requiredChildIds)
          ? task.completionBoundary.requiredChildIds
          : [],
        proofPathRequired: task.completionBoundary?.proofPathRequired ?? false,
        handoffRequired: task.completionBoundary?.handoffRequired ?? false,
        deferAllowed: task.completionBoundary?.deferAllowed ?? false,
      }
    }

    if (hasSelfHierarchyGoal) delete task.parentGoalId

    if (JSON.stringify(task) !== before) markChanged(id)
  }

  ensureNoCycles(tasks)

  if (changedTasks.length === 0) return { changedTasks: [], affectedPaths: [] }

  const affectedPaths = [TASKS_RELATIVE_PATH]
  const backup = backupPath(input.projectRoot)

  if (input.apply) {
    await fs.mkdir(path.dirname(backup), { recursive: true })
    try {
      await fs.writeFile(backup, raw, { encoding: 'utf8', flag: 'wx' })
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    }
    const rewritten = Array.isArray(JSON.parse(raw))
      ? tasks
      : { ...queue, lastUpdated: input.now ?? new Date().toISOString(), tasks }
    atomicWriteText(file, `${JSON.stringify(rewritten, null, 2)}\n`)
    affectedPaths.push(path.relative(input.projectRoot, backup))
  }

  return {
    changedTasks,
    ...(input.apply ? { backupPath: backup } : {}),
    affectedPaths,
  }
}

export { MIGRATION_ID as TASK_HIERARCHY_MIGRATION_ID }
