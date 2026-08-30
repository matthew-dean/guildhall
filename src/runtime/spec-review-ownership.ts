import { assessSpecCompletionBoundary, type Task } from '@guildhall/core'

export type SpecReviewAuthority = NonNullable<Task['specReviewGate']>['authority']

/**
 * Legacy review rows did not record who owns their decision. Preserve their
 * conservative owner gate until the review-gate migration records a typed
 * authority. New review handoffs must use `requestSpecReview` below.
 */
export function specReviewAuthority(task: Pick<Task, 'id'> & Partial<Pick<Task, 'specReviewGate'>>): SpecReviewAuthority {
  return task.specReviewGate?.authority ?? 'owner'
}

export function specReviewRequiresOwnerApproval(task: Pick<Task, 'id'> & Partial<Pick<Task, 'specReviewGate'>>): boolean {
  return specReviewAuthority(task) === 'owner'
}

/**
 * Owner authority alone is not enough to present an approval. A review gate
 * can survive from legacy state while its durable planning contract still
 * needs Guildhall to repair it.
 */
type SpecReviewTask = Pick<Task, 'id'> & Partial<Pick<Task, 'specReviewGate' | 'spec' | 'structuredSpec' | 'acceptanceCriteria' | 'productBrief'>> & {
  currentSummary?: { specReviewReadyForOwnerApproval?: unknown }
}

export function specReviewIsReadyForOwnerApproval(
  task: SpecReviewTask,
): boolean {
  return specReviewRequiresOwnerApproval(task) && !specReviewNeedsRepair(task)
}

export function requestSpecReview(
  task: Task,
  input: {
    authority: SpecReviewAuthority
    requestedAt: string
    requestedBy: string
    reason?: NonNullable<Task['specReviewGate']>['reason']
  },
): void {
  task.status = 'spec_review'
  task.specReviewGate = {
    authority: input.authority,
    requestedAt: input.requestedAt,
    requestedBy: input.requestedBy,
    reason: input.reason ?? 'spec_handoff',
  }
}

export function specReviewNeedsRepair(task: SpecReviewTask): boolean {
  if (typeof task.currentSummary?.specReviewReadyForOwnerApproval === 'boolean') {
    return !task.currentSummary.specReviewReadyForOwnerApproval
  }
  if (!task.structuredSpec && !task.spec) return true
  return !assessSpecCompletionBoundary(task).ok
}
