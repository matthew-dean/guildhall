import type { Task } from '@guildhall/core'

type TaskLike = Pick<Task, 'blockReason'> & {
  proofRecovery?: { kind?: unknown; reason?: unknown }
  runtime?: { proofRecovery?: { kind?: unknown; reason?: unknown } }
}

export function taskBlockerSummary(task: TaskLike): string {
  const proofRecovery = task.proofRecovery ?? task.runtime?.proofRecovery
  if (
    proofRecovery?.kind === 'proof' &&
    typeof proofRecovery.reason === 'string' &&
    proofRecovery.reason.trim().length > 0
  ) {
    return proofRecovery.reason.trim()
  }
  return task.blockReason?.trim() ?? ''
}
