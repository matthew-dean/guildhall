export interface ReleaseMutationSnapshot {
  id: string
  state?: string | null
  nodeIds?: readonly string[]
  deferredNodeIds?: readonly string[]
}

export interface ReleaseTaskStatusSnapshot {
  id: string
  status?: string | null
}

function normalizedIds(values: readonly string[] | undefined): string[] {
  return [...new Set(values ?? [])].sort()
}

function sameIds(left: readonly string[] | undefined, right: readonly string[] | undefined): boolean {
  const normalizedLeft = normalizedIds(left)
  const normalizedRight = normalizedIds(right)
  return normalizedLeft.length === normalizedRight.length && normalizedLeft.every((value, index) => value === normalizedRight[index])
}

function taskIdFromNodeId(nodeId: string): string | null {
  return nodeId.startsWith('work:') ? nodeId.slice('work:'.length) || null : null
}

/**
 * A shipped release is an immutable delivery boundary. New work belongs in a
 * later release; reopening completed work belongs in a follow-up release.
 * Keeping this invariant at the current-state write boundary prevents every
 * read surface from having to guess whether a shipped release was reopened.
 */
export function assertShippedReleaseMutation(input: {
  currentReleases: readonly ReleaseMutationSnapshot[]
  nextReleases: readonly ReleaseMutationSnapshot[]
  currentTasks: readonly ReleaseTaskStatusSnapshot[]
  nextTasks: readonly ReleaseTaskStatusSnapshot[]
  nextReleasesComplete?: boolean
  nextTasksComplete?: boolean
  /** Immutable shipped-delivery status keyed by release and task. */
  shippedDeliveryStatus?: (releaseId: string, taskId: string) => string | undefined
}): void {
  const nextReleasesById = input.nextReleasesComplete === false
    ? new Map(input.currentReleases.map(release => [release.id, release]))
    : new Map<string, ReleaseMutationSnapshot>()
  for (const release of input.nextReleases) nextReleasesById.set(release.id, release)
  const currentTasksById = new Map(input.currentTasks.map(task => [task.id, task]))
  const nextTasksById = input.nextTasksComplete === false
    ? new Map(input.currentTasks.map(task => [task.id, task]))
    : new Map<string, ReleaseTaskStatusSnapshot>()
  for (const task of input.nextTasks) nextTasksById.set(task.id, task)

  for (const currentRelease of input.currentReleases) {
    if (currentRelease.state !== 'shipped') continue
    const nextRelease = nextReleasesById.get(currentRelease.id)
    if (!nextRelease) {
      throw new Error(`Cannot remove shipped release ${currentRelease.id}; shipped release records are immutable.`)
    }
    if (nextRelease.state !== 'shipped') {
      throw new Error(`Cannot change shipped release ${currentRelease.id} lifecycle; create a new release for new work.`)
    }
    if (!sameIds(currentRelease.nodeIds, nextRelease.nodeIds) || !sameIds(currentRelease.deferredNodeIds, nextRelease.deferredNodeIds)) {
      throw new Error(`Cannot change membership of shipped release ${currentRelease.id}; create a new release for new work.`)
    }

    for (const nodeId of normalizedIds(currentRelease.nodeIds)) {
      const taskId = taskIdFromNodeId(nodeId)
      if (!taskId) continue
      const currentTask = currentTasksById.get(taskId)
      const nextTask = nextTasksById.get(taskId)
      if (!nextTask && input.nextTasksComplete !== false) {
        throw new Error(`Cannot remove work ${taskId} from shipped release ${currentRelease.id}; shipped release records are immutable.`)
      }
      const shippedStatus = input.shippedDeliveryStatus?.(currentRelease.id, taskId)
      // Once captured, a delivery snapshot is the shipped release's immutable
      // completion record. The global task may legitimately be scheduled by a
      // later active release.
      if (shippedStatus === undefined && currentTask?.status === 'done' && nextTask && nextTask.status !== 'done') {
        throw new Error(`Cannot reopen completed work ${taskId} in shipped release ${currentRelease.id}; create a new release for new work.`)
      }
    }
  }
}
