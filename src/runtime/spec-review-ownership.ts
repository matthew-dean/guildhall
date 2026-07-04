import type { Task } from '@guildhall/core'

export function specReviewRequiresOwnerApproval(_task: Pick<Task, 'id'>): boolean {
  return true
}
