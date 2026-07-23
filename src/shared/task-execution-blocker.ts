export interface TaskExecutionBlocker {
  source: 'proof_recovery' | 'task_block'
  reason: string
}

type TaskExecutionBlockerInput = {
  blockReason?: unknown
  proofRecovery?: { kind?: unknown; reason?: unknown } | null
  runtime?: { proofRecovery?: { kind?: unknown; reason?: unknown } | null } | null
}

/**
 * The current operational blocker is a small typed fact. Its reason is
 * display/evidence text only; precedence comes from the named source.
 */
export function taskExecutionBlocker(input: TaskExecutionBlockerInput): TaskExecutionBlocker | null {
  const proofRecovery = input.proofRecovery ?? input.runtime?.proofRecovery
  if (
    proofRecovery &&
    typeof proofRecovery.reason === 'string' &&
    proofRecovery.reason.trim().length > 0
  ) {
    return { source: 'proof_recovery', reason: proofRecovery.reason.trim() }
  }
  if (typeof input.blockReason === 'string' && input.blockReason.trim().length > 0) {
    return { source: 'task_block', reason: input.blockReason.trim() }
  }
  return null
}
