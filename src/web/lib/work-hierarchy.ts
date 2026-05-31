import type { Task } from './types.js'

export interface WorkHierarchyNode {
  id: string
  task: Task
  parentId: string | null
  childIds: string[]
  breadcrumb: Array<{ id: string; title: string }>
  depth: number
}

export interface WorkHierarchyModel {
  byId: Map<string, WorkHierarchyNode>
}

function taskTitle(task: Task): string {
  return task.title?.trim() || task.id
}

function legacyParentTaskId(task: Task): string | null {
  const raw = task.parentGoalId?.trim()
  if (!raw?.startsWith('goal-task-')) return null
  return raw.replace(/^goal-/, '')
}

function parentIdForTask(task: Task, tasksById: Map<string, Task>): string | null {
  const explicit = task.hierarchy?.parentId?.trim()
  if (explicit && tasksById.has(explicit)) return explicit
  const legacy = legacyParentTaskId(task)
  if (!legacy || legacy === task.id) return null
  if (tasksById.has(legacy)) return legacy
  const withoutTaskPrefix = legacy.replace(/^task-/, '')
  if (withoutTaskPrefix !== task.id && tasksById.has(withoutTaskPrefix)) return withoutTaskPrefix
  return null
}

export function buildWorkHierarchy(tasks: Task[]): WorkHierarchyModel {
  const tasksById = new Map(tasks.map(task => [task.id, task]))
  const childIdsByParent = new Map<string, string[]>()
  for (const task of tasks) {
    childIdsByParent.set(task.id, [
      ...(task.hierarchy?.childIds ?? []).filter(id => id !== task.id && tasksById.has(id)),
      ...tasks
        .filter(candidate => candidate.id !== task.id && parentIdForTask(candidate, tasksById) === task.id)
        .map(candidate => candidate.id),
    ].filter((id, index, all) => all.indexOf(id) === index))
  }

  const byId = new Map<string, WorkHierarchyNode>()
  const buildNode = (task: Task, ancestry: string[] = []): WorkHierarchyNode => {
    const cached = byId.get(task.id)
    if (cached) return cached
    const node: WorkHierarchyNode = {
      id: task.id,
      task,
      parentId: parentIdForTask(task, tasksById),
      childIds: childIdsByParent.get(task.id) ?? [],
      breadcrumb: [...ancestry, task.id].map(id => {
        const crumb = tasksById.get(id)
        return { id, title: crumb ? taskTitle(crumb) : id }
      }),
      depth: ancestry.length,
    }
    byId.set(task.id, node)
    for (const childId of node.childIds) {
      const child = tasksById.get(childId)
      if (child) buildNode(child, [...ancestry, task.id])
    }
    return node
  }

  for (const task of tasks) {
    if (!parentIdForTask(task, tasksById)) buildNode(task)
  }
  for (const task of tasks) buildNode(task)
  return { byId }
}

export function nestedWorkCountLabel(count: number): string {
  return `${count} nested work ${count === 1 ? 'item' : 'items'}`
}

export function workKindLabel(kind: string | undefined): string {
  if (!kind) return ''
  return kind
    .replace(/_/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase())
    .replace(/\bApp Spec\b/, 'App spec')
    .replace(/\bFeature Spec\b/, 'Feature spec')
}
