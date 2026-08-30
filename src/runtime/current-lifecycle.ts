import type { Task } from '@guildhall/core'

export interface CurrentTaskLifecycle {
  reopenedAt: string
  status: 'exploring'
  source: 'rerun_spec'
}

type CheckpointWithTimestamp = {
  writtenAt?: unknown
}

/**
 * Reads the durable lifecycle marker without making a claim about the task's
 * current execution status. A reframe remains the boundary for current
 * presentation after the spec advances beyond `exploring`.
 */
export function currentLifecycleBoundaryForTask(task: Task): CurrentTaskLifecycle | null {
  const state = task as Task & {
    currentLifecycle?: unknown
    runtime?: { currentLifecycle?: unknown }
  }
  const value = state.currentLifecycle ?? state.runtime?.currentLifecycle
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const lifecycle = value as Partial<CurrentTaskLifecycle>
  return typeof lifecycle.reopenedAt === 'string' &&
    lifecycle.status === 'exploring' &&
    lifecycle.source === 'rerun_spec'
    ? lifecycle as CurrentTaskLifecycle
    : null
}

/**
 * Checkpoints are progress for a specific execution attempt. A reframe starts
 * a new task lifecycle, so a checkpoint from before that boundary is history
 * and must not become the normal drawer's apparent live state.
 */
export function checkpointBelongsToCurrentTaskLifecycle(
  task: Task,
  checkpoint: CheckpointWithTimestamp | null | undefined,
): boolean {
  if (!checkpoint) return false
  const lifecycle = currentLifecycleBoundaryForTask(task)
  if (!lifecycle) return true
  const reopenedAt = Date.parse(lifecycle.reopenedAt)
  const writtenAt = typeof checkpoint.writtenAt === 'string'
    ? Date.parse(checkpoint.writtenAt)
    : Number.NaN
  // A normal current-state surface fails closed when it cannot establish that
  // a checkpoint belongs to the current lifecycle. Evidence remains retained.
  return Number.isFinite(reopenedAt) && Number.isFinite(writtenAt) && writtenAt >= reopenedAt
}

/**
 * Current lifecycle is runtime-overlay state. Keep its projection boundary in
 * one place so execution, closure, and presentation cannot independently
 * reinterpret historical task definitions.
 */
export function currentLifecycleForTask(task: Task): CurrentTaskLifecycle | null {
  if (task.status !== 'exploring') return null
  return currentLifecycleBoundaryForTask(task)
}
