import type { Task } from '@guildhall/core'
import { validateSpecCompletionBoundary } from './spec-quality.js'

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

export function specReviewNeedsRepair(task: Pick<Task, 'id'> & Partial<Pick<Task, 'spec' | 'structuredSpec' | 'acceptanceCriteria' | 'productBrief'>>): boolean {
  if (!task.structuredSpec && !task.spec) return true
  return !validateSpecCompletionBoundary(task as Task).ok
}
