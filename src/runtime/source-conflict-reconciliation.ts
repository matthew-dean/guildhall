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

  keepTask.releaseIds = [...new Set([...(keepTask.releaseIds ?? []), selectedReleaseId])]
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

  const releases = reconcileReleaseMembership({
    releases: input.queue.releases ?? [],
    selectedReleaseId,
    keepTaskId: keepTask.id,
    archiveTaskId: archivedTask.id,
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
  archiveTaskId: string
  now: string
}): ProjectRelease[] {
  const keepNodeId = `work:${input.keepTaskId}`
  const archivedNodeId = `work:${input.archiveTaskId}`
  return input.releases.map(release => {
    const nodeIds = new Set(release.nodeIds ?? [])
    const deferredNodeIds = new Set(release.deferredNodeIds ?? [])
    nodeIds.delete(archivedNodeId)
    deferredNodeIds.delete(archivedNodeId)
    deferredNodeIds.delete(keepNodeId)
    if (release.id === input.selectedReleaseId || nodeIds.has(keepNodeId)) {
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
