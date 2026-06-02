/**
 * FR-25 accepted-work landing. Runs exactly once per `done` transition:
 *
 *   • `cherry_pick_local`      — cherry-pick accepted commits into the landing
 *                                 branch locally; no push.
 *   • `cherry_pick_with_push`  — cherry-pick + push; on push failure, degrade
 *                                 to local-only and emit FR-29 markers
 *                                 (PROGRESS.md + memory/local-only).
 *   • `manual_pr`              — open a PR via `gh`, hold the task at
 *                                 `pending_pr` until the human merges.
 *
 * Merge conflicts surface as a `fixup` task parented to the failing task's
 * goal so the coordinator can decide the next move on its next tick.
 */

import type { Task, TaskQueue, TaskStatus } from '@guildhall/core'
import type { ProjectLevers } from '@guildhall/levers'
import type { GitDriver } from './git-driver.js'
import { attemptRemoteSync } from './local-only-mode.js'
import { applyTaskTransition, type TaskTransitionReceipt } from './task-transition.js'

export type LandingStrategy = ProjectLevers['landing_strategy']['position']

export function resolveLandingStrategy(project: ProjectLevers): LandingStrategy {
  return project.landing_strategy.position
}

export interface MergeRecord {
  fromBranch: string
  toBranch: string
  strategy: LandingStrategy
  result:
    | 'merged'
    | 'pushed'
    | 'push_failed_degraded'
    | 'pending_pr'
    | 'conflict'
    | 'skipped'
  commitSha?: string
  prUrl?: string
  mergedAt: string
  detail?: string
}

export interface DispatchMergeInput {
  task: Task
  policy: LandingStrategy
  projectPath: string
  memoryDir: string
  gitDriver: GitDriver
  now: string
}

export interface DispatchMergeResult {
  /** Record to persist on the task's `mergeRecord` field. */
  record: MergeRecord
  /**
   * Status the task should transition to:
   *   - `done` for a clean merge (the default terminal)
   *   - `pending_pr` when the PR path is taken and we're awaiting human merge
   *   - `blocked` when a conflict left the branch unmerged (a fixup task is
   *     also produced)
   */
  newStatus: TaskStatus
  transitionReceipt?: TaskTransitionReceipt
  /**
   * When non-null, the caller must append this task to the queue (a FR-25
   * fixup task parented to the failing merge's goal).
   */
  fixupTask?: Task
  /**
   * True when `cherry_pick_with_push` degraded to local-only. The orchestrator
   * caller uses this to produce a human-readable PROGRESS.md entry beyond
   * what `attemptRemoteSync` already writes.
   */
  degradedToLocal?: boolean
}

/**
 * Dispatch the merge for a task that just reached terminal-success. Callers
 * must skip calling this when `worktree_isolation === 'none'` — there is no
 * branch to merge. Policy/path logic is otherwise contained here.
 */
export async function dispatchMerge(
  input: DispatchMergeInput,
): Promise<DispatchMergeResult> {
  const { task, policy, projectPath, memoryDir, gitDriver, now } = input
  const fromBranch = task.branchName
  const toBranch = task.baseBranch
  if (!fromBranch || !toBranch) {
    return {
      record: {
        fromBranch: fromBranch ?? '<unknown>',
        toBranch: toBranch ?? '<unknown>',
        strategy: policy,
        result: 'skipped',
        mergedAt: now,
        detail: 'no branchName/baseBranch on task — merge skipped',
      },
      newStatus: 'done',
    }
  }

  const mergeBase = {
    fromBranch,
    toBranch,
    strategy: policy,
    mergedAt: now,
  } satisfies Pick<MergeRecord, 'fromBranch' | 'toBranch' | 'strategy' | 'mergedAt'>

  if (policy === 'manual_pr') {
    // Push the branch first so the PR has something to compare against. On
    // push failure fall back to local-only; the PR attempt still records its
    // failure, and the coordinator can retry once the network is back.
    const push = await gitDriver.push(projectPath, fromBranch)
    if (!push.ok) {
      return {
        record: {
          ...mergeBase,
          result: 'push_failed_degraded',
          detail: push.detail ?? 'push failed before PR creation',
        },
        newStatus: 'pending_pr',
        transitionReceipt: landingTransitionReceipt({
          task,
          event: 'await_pull_request',
          actor: 'merge-dispatcher',
          evidenceRefs: ['task:landing:pending-pr'],
          now,
        }),
        degradedToLocal: true,
      }
    }
    const pr = await gitDriver.openPullRequest(projectPath, {
      branch: fromBranch,
      baseBranch: toBranch,
      title: `[guildhall] ${task.title}`,
      body: task.spec ?? task.description,
    })
    return {
      record: {
        ...mergeBase,
        result: 'pending_pr',
        ...(pr.url ? { prUrl: pr.url } : {}),
        ...(pr.detail ? { detail: pr.detail } : {}),
      },
      newStatus: 'pending_pr',
      transitionReceipt: landingTransitionReceipt({
        task,
        event: 'await_pull_request',
        actor: 'merge-dispatcher',
        evidenceRefs: ['task:landing:pending-pr'],
        now,
      }),
    }
  }

  // Cherry-pick landing path, used by both local and push variants.
  const merge = await gitDriver.cherryPickBranch(projectPath, fromBranch, toBranch)
  if (!merge.ok) {
    if (merge.conflict) {
      const fixup = buildFixupTask({
        originatingTask: task,
        fromBranch,
        toBranch,
          detail: merge.detail ?? 'cherry-pick failed with conflict',
        now,
      })
      return {
        record: {
          ...mergeBase,
          result: 'conflict',
          detail: merge.detail ?? 'conflict',
        },
        // Conflict blocks the task — a fixup is queued separately.
        newStatus: 'blocked',
        transitionReceipt: landingTransitionReceipt({
          task,
          event: 'landing_failed',
          actor: 'merge-dispatcher',
          evidenceRefs: ['task:landing:conflict'],
          now,
        }),
        fixupTask: fixup,
      }
    }
    return {
      record: {
        ...mergeBase,
        result: 'skipped',
          detail: merge.detail ?? 'cherry-pick failed; no conflict recorded',
      },
      newStatus: 'blocked',
      transitionReceipt: landingTransitionReceipt({
        task,
        event: 'landing_failed',
        actor: 'merge-dispatcher',
        evidenceRefs: ['task:landing:failed'],
        now,
      }),
    }
  }

  if (policy === 'cherry_pick_local') {
    return {
      record: {
        ...mergeBase,
        result: 'merged',
        ...(merge.commitSha ? { commitSha: merge.commitSha } : {}),
      },
      newStatus: 'done',
    }
  }

  // cherry_pick_with_push: attempt the push through attemptRemoteSync so an
  // outage drops us into FR-29 local-only mode instead of failing the task.
  const sync = await attemptRemoteSync(
    memoryDir,
    async () => {
      const res = await gitDriver.push(projectPath, toBranch)
      if (!res.ok) throw new Error(res.detail ?? 'push failed')
    },
    { label: `merge push (${fromBranch} → ${toBranch})` },
  )
  if (sync.ok) {
    return {
      record: {
        ...mergeBase,
        result: 'pushed',
        ...(merge.commitSha ? { commitSha: merge.commitSha } : {}),
      },
      newStatus: 'done',
    }
  }
  return {
    record: {
      ...mergeBase,
      result: 'push_failed_degraded',
      ...(merge.commitSha ? { commitSha: merge.commitSha } : {}),
      detail: sync.error ?? 'push failed; local-only mode entered',
    },
    newStatus: 'done',
    degradedToLocal: true,
  }
}

function landingTransitionReceipt(input: {
  task: Task
  event: 'await_pull_request' | 'landing_failed'
  actor: string
  evidenceRefs: string[]
  now: string
}): TaskTransitionReceipt {
  const result = applyTaskTransition(input)
  if (result.kind === 'rejected') {
    throw new Error(
      `Task ${input.task.id} cannot ${input.event.replaceAll('_', ' ')} from ${input.task.status}: ${result.reason}`,
    )
  }
  return {
    ...result.receipt,
    machineId: 'task-lifecycle',
  }
}

// ---------------------------------------------------------------------------
// Fixup task helper
// ---------------------------------------------------------------------------

function buildFixupTask(opts: {
  originatingTask: Task
  fromBranch: string
  toBranch: string
  detail: string
  now: string
}): Task {
  const parent = opts.originatingTask
  return {
    id: `${parent.id}-fixup-${parent.revisionCount + 1}`,
    title: `Fixup merge conflict: ${parent.title}`,
    description:
      `Merging \`${opts.fromBranch}\` into \`${opts.toBranch}\` failed with a conflict.\n\n` +
      `Resolve the conflict, rebase the branch, and re-run the merge. Detail:\n\n` +
      `\`\`\`\n${opts.detail}\n\`\`\``,
    domain: parent.domain,
    projectPath: parent.projectPath,
    status: 'ready',
    priority: 'high',
    acceptanceCriteria: [],
    outOfScope: [],
    dependsOn: [parent.id],
    notes: [],
    gateResults: [],
    reviewVerdicts: [],
    adjudications: [],
    revisionCount: 0,
    remediationAttempts: 0,
    escalations: [],
    agentIssues: [],
    origination: 'system',
    ...(parent.businessEnvelope ? { businessEnvelope: parent.businessEnvelope } : {}),
    createdAt: opts.now,
    updatedAt: opts.now,
  }
}

/**
 * Append a fixup task to the queue (in place). Returns the mutated queue for
 * chaining; callers still need to persist it.
 */
export function appendFixupTask(queue: TaskQueue, fixup: Task, now: string): TaskQueue {
  queue.tasks.push(fixup)
  queue.lastUpdated = now
  return queue
}

export function shelveSupersededFixupTasks(
  queue: TaskQueue,
  parentTaskId: string,
  now: string,
): number {
  let shelved = 0
  for (const task of queue.tasks) {
    if (!task.id.startsWith(`${parentTaskId}-fixup-`)) continue
    if (task.status === 'done' || task.status === 'shelved') continue
    const transitionResult = applyTaskTransition({
      task,
      event: 'shelve',
      actor: 'merge-dispatcher',
      evidenceRefs: [`task:${parentTaskId}:landed`],
      now,
    })
    if (transitionResult.kind !== 'applied') continue
    task.status = transitionResult.nextState
    task.assignedTo = null
    task.blockReason = undefined
    task.shelveReason = {
      code: 'duplicate',
      detail:
        `Superseded because source task ${parentTaskId} landed successfully after the fixup was created.`,
      rejectedBy: 'system:merge-dispatcher',
      rejectedAt: now,
      source: 'proposal_policy',
      policyApplied: true,
    }
    task.updatedAt = now
    shelved += 1
  }
  if (shelved > 0) queue.lastUpdated = now
  return shelved
}
