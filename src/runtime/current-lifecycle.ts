import type { Task } from '@guildhall/core'

export interface CurrentTaskLifecycle {
  reopenedAt: string
  status: 'exploring'
  source: 'rerun_spec'
}

/**
 * Current lifecycle is runtime-overlay state. Keep its projection boundary in
 * one place so execution, closure, and presentation cannot independently
 * reinterpret historical task definitions.
 */
export function currentLifecycleForTask(task: Task): CurrentTaskLifecycle | null {
  if (task.status !== 'exploring') return null
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
