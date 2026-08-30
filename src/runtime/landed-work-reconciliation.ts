import type { Task } from '@guildhall/core'

import type { GitDriver } from './git-driver.js'
import type { LandingStrategy } from './merge-dispatcher.js'
import { resolveRuntimePath } from './path-utils.js'
import { transitionTaskStatus } from './task-transition.js'

/**
 * Reconcile implementation that a delegated owner already landed directly.
 * Landing is not completion: required review and command proof stay intact.
 */
export async function reconcileExternallyLandedWorkToReview(input: {
  task: Task
  projectRoot: string
  landingStrategy: LandingStrategy
  gitDriver: GitDriver
  now: string
}): Promise<boolean> {
  const { task } = input
  if (!isExternallyLandedWorkCandidate(task)) return false

  // The shared predicate establishes these values. Keep the operational
  // boundary explicit because TypeScript cannot infer that from a boolean.
  const worktreePath = resolveRuntimePath(task.worktreePath!)
  const branchName = task.branchName!
  const baseBranch = task.baseBranch!
  const worktreeStatus = await input.gitDriver.statusSummary(worktreePath).catch(() => null)
  const taskHead = worktreeStatus?.clean
    ? await input.gitDriver.headSha(worktreePath).catch(() => null)
    : null
  const landed = taskHead
    ? await input.gitDriver.isAncestor(input.projectRoot, taskHead, baseBranch).catch(() => false)
    : false
  if (!landed || !taskHead) return false

  transitionTaskStatus({
    task,
    event: 'request_review',
    actor: 'landing-reconciliation',
    evidenceRefs: ['task:git-story:externally-landed'],
    now: input.now,
  })
  task.assignedTo = 'reviewer-agent'
  task.mergeRecord = {
    fromBranch: branchName,
    toBranch: baseBranch,
    strategy: input.landingStrategy,
    result: 'merged',
    commitSha: taskHead,
    mergedAt: input.now,
    detail: 'Guildhall reconciled a clean task worktree already contained in the landing branch.',
  }
  delete task.blockReason
  task.notes.push({
    agentId: 'landing-reconciliation',
    role: 'git-story',
    content:
      'Guildhall found this task already landed in the project branch. It moved the task to review so verification can finish without another worker pass.',
    timestamp: input.now,
  })
  task.updatedAt = input.now
  return true
}

/**
 * This deliberately does not examine acceptance or proof status. A clean
 * worktree commit contained in the landing branch is durable evidence that
 * implementation has landed; review is where Guildhall settles remaining
 * criteria and proof.
 */
export function isExternallyLandedWorkCandidate(task: Task): boolean {
  return task.status === 'in_progress' &&
    Boolean(task.worktreePath?.trim()) &&
    Boolean(task.branchName?.trim()) &&
    Boolean(task.baseBranch?.trim()) &&
    !task.mergeRecord
}
