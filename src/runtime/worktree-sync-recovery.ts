import type { Task } from '@guildhall/core'
import { transitionTaskStatus } from './task-transition.js'

const LEGACY_WORKTREE_SYNC_RECOVERY_CODES = new Set([
  'task_worktree_sync',
  'task_worktree_sync_conflict',
])

export function isLegacyWorktreeSyncRecovery(task: Pick<Task, 'recoveryCode'>): boolean {
  return LEGACY_WORKTREE_SYNC_RECOVERY_CODES.has(task.recoveryCode ?? '')
}

/**
 * Older runtimes persisted a normal Git merge as a human-facing blocker.
 * The recovery code itself is the durable classification; its message is
 * historical evidence only. Reopen the task so dispatch can observe Git and
 * replace this legacy state with a typed workspace recovery when needed.
 */
export function reopenLegacyWorktreeSyncRecovery(task: Task, now: string): boolean {
  if (task.status !== 'blocked' || !isLegacyWorktreeSyncRecovery(task)) return false
  const recoveryCode = task.recoveryCode
  transitionTaskStatus({
    task,
    event: 'recover_to_in_progress',
    actor: 'worktree-sync-recovery',
    evidenceRefs: ['task:worktree-sync:legacy-recovery-reopened'],
    now,
  })
  task.assignedTo = 'worker-agent'
  task.blockReason = undefined
  task.recoveryCode = undefined
  task.notes.push({
    agentId: 'coordinator',
    role: 'recovery',
    structured: {
      event: 'worktree_sync_recovery_reopened',
      recoveryCode,
    },
    content:
      'Guildhall reopened a legacy worktree synchronization stop. Dispatch will inspect the worktree through Git and either record the active merge as typed recovery state or continue normal synchronization.',
    timestamp: now,
  })
  task.updatedAt = now
  return true
}
