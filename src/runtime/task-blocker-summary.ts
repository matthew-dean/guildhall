import type { Task } from '@guildhall/core'

type TaskLike = Pick<Task, 'blockReason'> & {
  proofRecovery?: { reason?: string }
  runtime?: { proofRecovery?: { reason?: string } }
}

function proofRecoveryReason(task: TaskLike): string {
  const runtimeReason = task.runtime?.proofRecovery?.reason?.trim()
  if (runtimeReason) return runtimeReason
  return task.proofRecovery?.reason?.trim() ?? ''
}

function ownerFacingProofRecoveryReason(reason: string): string {
  if (!reason) return ''
  if (/provider_missing:/i.test(reason)) return reason
  if (/\bcredentials?\b/i.test(reason) && /\bproof\b/i.test(reason)) {
    return 'Provider credentials are required before Guildhall can run the live proof.'
  }
  if (/missing (?:release )?proof evidence/i.test(reason)) {
    return 'Required proof evidence has not been attached yet.'
  }
  return reason
    .replace(/^Codex is acting as the owner for this calibration run\.\s*/i, '')
    .trim()
}

export function taskBlockerSummary(task: TaskLike): string {
  const blockReason = task.blockReason?.trim() ?? ''
  if (!/max_revisions_exceeded:/i.test(blockReason)) return blockReason

  const recoveryReason = proofRecoveryReason(task)
  return ownerFacingProofRecoveryReason(recoveryReason) || blockReason
}
