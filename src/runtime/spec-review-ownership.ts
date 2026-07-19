import type { Task } from '@guildhall/core'
import { validateSpecCompletionBoundary } from './spec-quality.js'

export function specReviewRequiresOwnerApproval(task: Pick<Task, 'id'> & Partial<Pick<Task, 'spec'>>): boolean {
  // A saved spec is a reviewable artifact even when it still needs cleanup.
  // “Needs repair” is a separate dispatch decision; conflating the two makes
  // Thread and release summaries hide the very spec the coordinator needs to
  // repair or the owner needs to review.
  if (!Object.prototype.hasOwnProperty.call(task, 'spec')) return true
  return typeof task.spec === 'string' && task.spec.trim().length > 0
}

export function specReviewNeedsRepair(task: Pick<Task, 'id'> & Partial<Pick<Task, 'spec' | 'acceptanceCriteria' | 'productBrief'>>): boolean {
  if (!Object.prototype.hasOwnProperty.call(task, 'spec')) return true
  if (typeof task.spec !== 'string' || task.spec.trim().length === 0) return true
  return !validateSpecCompletionBoundary(task as Task).ok
}
