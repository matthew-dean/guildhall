import type { Task } from '@guildhall/core'
import { hasOpenEscalation } from '@guildhall/tools'

export interface WorkRollup {
  totalChildren: number
  totalDescendants: number
  openChildren: number
  blockedChildren: number
  doneChildren: number
  shelvedChildren: number
  actionNeededChildren: number
}

export interface WorkHierarchyNode {
  id: string
  task: Task
  parentId: string | null
  childIds: string[]
  dependencyIds: string[]
  breadcrumb: Array<{ id: string; title: string }>
  depth: number
  isContainingWork: boolean
  rollup: WorkRollup
}

export interface WorkHierarchyModel {
  byId: Map<string, WorkHierarchyNode>
  roots: WorkHierarchyNode[]
}

export interface CompletionBoundaryStatus {
  satisfied: boolean
  missing: string[]
}

export interface WorkListGroup {
  key: 'needs_you' | 'working' | 'ready' | 'blocked' | 'planned' | 'done' | 'shelved'
  label: string
  items: Task[]
}

const TERMINAL = new Set(['done', 'shelved', 'blocked', 'pending_pr'])

function taskTitle(task: Task): string {
  return task.title?.trim() || task.id
}

function legacyParentTaskId(task: Task): string | null {
  const raw = task.parentGoalId?.trim()
  if (!raw?.startsWith('goal-task-')) return null
  return raw.replace(/^goal-/, '')
}

function explicitParentId(task: Task): string | null {
  return task.hierarchy?.parentId?.trim() || null
}

function parentIdForTask(task: Task, tasksById: Map<string, Task>): string | null {
  const explicit = explicitParentId(task)
  if (explicit) return tasksById.has(explicit) ? explicit : null
  const legacy = legacyParentTaskId(task)
  if (!legacy || legacy === task.id) return null
  if (tasksById.has(legacy)) return legacy
  const withoutTaskPrefix = legacy.replace(/^task-/, '')
  if (withoutTaskPrefix !== task.id && tasksById.has(withoutTaskPrefix)) return withoutTaskPrefix
  return null
}

function directChildIds(task: Task, tasks: Task[], tasksById: Map<string, Task>): string[] {
  const ids = new Set<string>()
  for (const childId of task.hierarchy?.childIds ?? []) {
    if (tasksById.has(childId) && childId !== task.id) ids.add(childId)
  }
  for (const candidate of tasks) {
    if (candidate.id === task.id) continue
    if (parentIdForTask(candidate, tasksById) === task.id) ids.add(candidate.id)
  }
  return [...ids].sort((left, right) => {
    const leftTask = tasksById.get(left)
    const rightTask = tasksById.get(right)
    const orderDelta = (leftTask?.hierarchy?.order ?? 0) - (rightTask?.hierarchy?.order ?? 0)
    if (orderDelta !== 0) return orderDelta
    return left.localeCompare(right)
  })
}

function emptyRollup(): WorkRollup {
  return {
    totalChildren: 0,
    totalDescendants: 0,
    openChildren: 0,
    blockedChildren: 0,
    doneChildren: 0,
    shelvedChildren: 0,
    actionNeededChildren: 0,
  }
}

function mergeRollup(base: WorkRollup, child: WorkHierarchyNode): WorkRollup {
  const status = child.task.status
  return {
    totalChildren: base.totalChildren + 1,
    totalDescendants: base.totalDescendants + 1 + child.rollup.totalDescendants,
    openChildren: base.openChildren + (status === 'done' || status === 'pending_pr' || status === 'shelved' ? 0 : 1) + child.rollup.openChildren,
    blockedChildren: base.blockedChildren + (status === 'blocked' ? 1 : 0) + child.rollup.blockedChildren,
    doneChildren: base.doneChildren + (status === 'done' || status === 'pending_pr' ? 1 : 0) + child.rollup.doneChildren,
    shelvedChildren: base.shelvedChildren + (status === 'shelved' ? 1 : 0) + child.rollup.shelvedChildren,
    actionNeededChildren: base.actionNeededChildren + (needsOwnerAction(child.task) ? 1 : 0) + child.rollup.actionNeededChildren,
  }
}

export function buildWorkHierarchy(tasks: Task[]): WorkHierarchyModel {
  const tasksById = new Map(tasks.map(task => [task.id, task]))
  const childIdsByParent = new Map<string, string[]>()
  for (const task of tasks) {
    childIdsByParent.set(task.id, directChildIds(task, tasks, tasksById))
  }

  const byId = new Map<string, WorkHierarchyNode>()
  const visiting = new Set<string>()

  const buildNode = (task: Task, ancestry: string[] = []): WorkHierarchyNode => {
    const cached = byId.get(task.id)
    if (cached) return cached
    if (visiting.has(task.id)) {
      return {
        id: task.id,
        task,
        parentId: parentIdForTask(task, tasksById),
        childIds: [],
        dependencyIds: task.dependsOn ?? [],
        breadcrumb: [...ancestry, task.id].map(id => {
          const crumb = tasksById.get(id)
          return { id, title: crumb ? taskTitle(crumb) : id }
        }),
        depth: ancestry.length,
        isContainingWork: task.status === 'parent',
        rollup: emptyRollup(),
      }
    }
    visiting.add(task.id)
    const childIds = childIdsByParent.get(task.id) ?? []
    const childNodes = childIds
      .map(id => tasksById.get(id))
      .filter((child): child is Task => Boolean(child))
      .map(child => buildNode(child, [...ancestry, task.id]))
    const rollup = childNodes.reduce(mergeRollup, emptyRollup())
    const node: WorkHierarchyNode = {
      id: task.id,
      task,
      parentId: parentIdForTask(task, tasksById),
      childIds,
      dependencyIds: task.dependsOn ?? [],
      breadcrumb: [...ancestry, task.id].map(id => {
        const crumb = tasksById.get(id)
        return { id, title: crumb ? taskTitle(crumb) : id }
      }),
      depth: ancestry.length,
      isContainingWork: childIds.length > 0 || task.status === 'parent' || task.workKind === 'app_spec' || task.workKind === 'feature_spec',
      rollup,
    }
    visiting.delete(task.id)
    byId.set(task.id, node)
    return node
  }

  for (const task of tasks) buildNode(task)
  const roots = tasks
    .map(task => byId.get(task.id))
    .filter((node): node is WorkHierarchyNode => node !== undefined && !node.parentId)
  return { byId, roots }
}

export function workSubtreeIds(tasks: Task[], rootId: string): string[] {
  const model = buildWorkHierarchy(tasks)
  const seen = new Set<string>()
  const result: string[] = []
  const visit = (id: string) => {
    if (seen.has(id)) return
    const node = model.byId.get(id)
    if (!node) return
    seen.add(id)
    result.push(id)
    for (const childId of node.childIds) visit(childId)
  }
  visit(rootId)
  return result
}

export function completionBoundaryStatus(tasks: Task[], taskId: string): CompletionBoundaryStatus {
  const task = tasks.find(candidate => candidate.id === taskId)
  if (!task?.completionBoundary) return { satisfied: true, missing: [] }
  const model = buildWorkHierarchy(tasks)
  const node = model.byId.get(taskId)
  const boundary = task.completionBoundary
  const childIds = boundary.requiredChildPolicy === 'selected_children_done'
    ? boundary.requiredChildIds ?? []
    : node?.childIds ?? []
  const missing: string[] = []
  for (const childId of childIds) {
    const child = tasks.find(candidate => candidate.id === childId)
    if (!child) {
      missing.push(`${childId} is missing`)
      continue
    }
    if (child.status !== 'done' && child.status !== 'pending_pr') {
      missing.push(`${childId} is ${child.status}`)
    }
  }
  return { satisfied: missing.length === 0, missing }
}

export function needsOwnerAction(task: Task): boolean {
  return hasOpenEscalation(task) || Boolean(task.openQuestions?.some(question => !question.answeredAt))
}

function groupKey(task: Task): WorkListGroup['key'] {
  if (needsOwnerAction(task)) return 'needs_you'
  if (['in_progress', 'review', 'gate_check'].includes(task.status)) return 'working'
  if (task.status === 'ready') return 'ready'
  if (task.status === 'blocked') return 'blocked'
  if (task.status === 'done' || task.status === 'pending_pr') return 'done'
  if (task.status === 'shelved') return 'shelved'
  return 'planned'
}

const GROUP_LABELS: Record<WorkListGroup['key'], string> = {
  needs_you: 'Needs you',
  working: 'Working',
  ready: 'Ready',
  blocked: 'Blocked',
  planned: 'Planned',
  done: 'Done',
  shelved: 'Shelved',
}

export function workListGroups(tasks: Task[], options: { showDone?: boolean; showShelved?: boolean } = {}): WorkListGroup[] {
  const buckets = new Map<WorkListGroup['key'], Task[]>()
  for (const task of tasks) {
    const key = groupKey(task)
    if (key === 'done' && !options.showDone) continue
    if (key === 'shelved' && !options.showShelved) continue
    buckets.set(key, [...(buckets.get(key) ?? []), task])
  }
  return (['needs_you', 'working', 'ready', 'blocked', 'planned', 'done', 'shelved'] as const)
    .map(key => ({ key, label: GROUP_LABELS[key], items: buckets.get(key) ?? [] }))
    .filter(group => group.items.length > 0)
}
