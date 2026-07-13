import type { ProjectRelease, Task, TaskQueue } from '@guildhall/core'

export interface ApplySourceConflictReconciliationInput {
  queue: Pick<TaskQueue, 'tasks' | 'releases' | 'selectedReleaseId'>
  selectedReleaseId?: string
  keepTaskId: string
  archiveTaskId: string
  now: string
  actor: string
}

export interface SourceConflictReconciliationResult {
  tasks: Task[]
  releases: ProjectRelease[]
  selectedReleaseId?: string
  keepTask: Task
  archivedTask: Task
}

export function applySourceConflictReconciliation(
  input: ApplySourceConflictReconciliationInput,
): SourceConflictReconciliationResult {
  const selectedReleaseId = input.selectedReleaseId ?? input.queue.selectedReleaseId
  if (!selectedReleaseId) throw new Error('A selected release or current scope is required to resolve this source conflict.')
  if (input.keepTaskId === input.archiveTaskId) throw new Error('Choose two different tasks to reconcile.')

  const tasks = input.queue.tasks.map(task => ({
    ...task,
    releaseIds: [...(task.releaseIds ?? [])],
    notes: [...(task.notes ?? [])],
  }))
  const keepTask = tasks.find(task => task.id === input.keepTaskId)
  const archivedTask = tasks.find(task => task.id === input.archiveTaskId)
  if (!keepTask) throw new Error(`Task not found: ${input.keepTaskId}`)
  if (!archivedTask) throw new Error(`Task not found: ${input.archiveTaskId}`)

  const promoteToSelectedRelease = conflictTouchesSelectedRelease({
    releases: input.queue.releases ?? [],
    selectedReleaseId,
    keepTask,
    archivedTask,
  })
  if (promoteToSelectedRelease) {
    keepTask.releaseIds = [...new Set([...(keepTask.releaseIds ?? []), selectedReleaseId])]
  }
  keepTask.updatedAt = input.now
  keepTask.notes.push({
    agentId: 'scope-reconciliation',
    role: 'system',
    content: `"${keepTask.title}" was kept as the source of truth for ${selectedReleaseId}; "${archivedTask.title}" was archived as the superseded duplicate.`,
    timestamp: input.now,
  })

  archivedTask.status = 'archived'
  archivedTask.releaseIds = []
  archivedTask.updatedAt = input.now
  archivedTask.notes.push({
    agentId: 'scope-reconciliation',
    role: 'system',
    content: `Archived as a superseded duplicate of "${keepTask.title}" for ${selectedReleaseId}.`,
    timestamp: input.now,
  })
  const archivedParentIds = archiveSupersededParentIfSettled({
    tasks,
    archivedTask,
    keepTask,
    selectedReleaseId,
    now: input.now,
  })

  const releases = reconcileReleaseMembership({
    releases: input.queue.releases ?? [],
    selectedReleaseId,
    keepTaskId: keepTask.id,
    archiveTaskIds: [archivedTask.id, ...archivedParentIds],
    promoteToSelectedRelease,
    now: input.now,
  })

  return {
    tasks,
    releases,
    selectedReleaseId,
    keepTask,
    archivedTask,
  }
}

function reconcileReleaseMembership(input: {
  releases: readonly ProjectRelease[]
  selectedReleaseId: string
  keepTaskId: string
  archiveTaskIds: string[]
  promoteToSelectedRelease: boolean
  now: string
}): ProjectRelease[] {
  const keepNodeId = `work:${input.keepTaskId}`
  const archivedNodeIds = new Set(input.archiveTaskIds.map(taskId => `work:${taskId}`))
  return input.releases.map(release => {
    const nodeIds = new Set(release.nodeIds ?? [])
    const deferredNodeIds = new Set(release.deferredNodeIds ?? [])
    for (const archivedNodeId of archivedNodeIds) {
      nodeIds.delete(archivedNodeId)
      deferredNodeIds.delete(archivedNodeId)
    }
    if (nodeIds.has(keepNodeId) || (release.id === input.selectedReleaseId && input.promoteToSelectedRelease)) {
      deferredNodeIds.delete(keepNodeId)
    }
    if ((release.id === input.selectedReleaseId && input.promoteToSelectedRelease) || nodeIds.has(keepNodeId)) {
      nodeIds.add(keepNodeId)
    }
    return {
      ...release,
      nodeIds: [...nodeIds],
      deferredNodeIds: [...deferredNodeIds],
      updatedAt: input.now,
    }
  })
}

function conflictTouchesSelectedRelease(input: {
  releases: readonly ProjectRelease[]
  selectedReleaseId: string
  keepTask: Task
  archivedTask: Task
}): boolean {
  if (input.keepTask.releaseIds?.includes(input.selectedReleaseId)) return true
  if (input.archivedTask.releaseIds?.includes(input.selectedReleaseId)) return true
  const selectedRelease = input.releases.find(release => release.id === input.selectedReleaseId)
  if (!selectedRelease) return false
  const nodeIds = new Set([...(selectedRelease.nodeIds ?? []), ...(selectedRelease.deferredNodeIds ?? [])])
  return nodeIds.has(`work:${input.keepTask.id}`) || nodeIds.has(`work:${input.archivedTask.id}`)
}

function archiveSupersededParentIfSettled(input: {
  tasks: Task[]
  archivedTask: Task
  keepTask: Task
  selectedReleaseId: string
  now: string
}): string[] {
  const parentId = input.archivedTask.hierarchy?.parentId?.trim()
  if (!parentId) return []
  const parent = input.tasks.find(task => task.id === parentId)
  if (!parent || parent.status !== 'done') return []
  const childIds = new Set([
    ...(parent.hierarchy?.childIds ?? []),
    ...input.tasks
      .filter(task => task.hierarchy?.parentId === parent.id)
      .map(task => task.id),
  ])
  if (childIds.size === 0) return []
  const allChildrenArchived = [...childIds]
    .map(childId => input.tasks.find(task => task.id === childId))
    .every(child => child?.status === 'archived' || child?.status === 'cancelled')
  if (!allChildrenArchived) return []
  parent.status = 'archived'
  parent.releaseIds = []
  parent.updatedAt = input.now
  parent.notes = [...(parent.notes ?? []), {
    agentId: 'scope-reconciliation',
    role: 'system',
    content: `Archived because all split children were superseded by current-scope source-of-truth work, including "${input.keepTask.title}" for ${input.selectedReleaseId}.`,
    timestamp: input.now,
  }]
  return [parent.id]
}
