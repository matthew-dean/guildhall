/**
 * FR-25 attempt-branch merge policy. Runs exactly once per `done` transition:
 *
 *   • `ff_only_local`      — fast-forward merge into baseBranch; no push.
 *   • `ff_only_with_push`  — fast-forward + push; on push failure, degrade to
 *                            local-only and emit FR-29 markers (PROGRESS.md +
 *                            memory/local-only).
 *   • `manual_pr`          — open a PR via `gh`, hold the task at `pending_pr`
 *                            until the human merges.
 *
 * Merge conflicts surface as a `fixup` task parented to the failing task's
 * goal so the coordinator can decide the next move on its next tick.
 */

import type { Task, TaskQueue, TaskStatus } from '@guildhall/core'
import type { ProjectLevers } from '@guildhall/levers'
import type { GitDriver } from './git-driver.js'
import { attemptRemoteSync } from './local-only-mode.js'

export type MergePolicy = ProjectLevers['merge_policy']['position']

export function resolveMergePolicy(project: ProjectLevers): MergePolicy {
  return project.merge_policy.position
}

export interface MergeRecord {
  fromBranch: string
  toBranch: string
  strategy: MergePolicy
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
  policy: MergePolicy
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
  /**
   * When non-null, the caller must append this task to the queue (a FR-25
   * fixup task parented to the failing merge's goal).
   */
  fixupTask?: Task
  /**
   * True when `ff_only_with_push` degraded to local-only. The orchestrator
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
    }
  }

  // Fast-forward merge path, used by both `ff_only_local` and `ff_only_with_push`.
  const merge = await gitDriver.fastForwardMerge(projectPath, fromBranch, toBranch)
  if (!merge.ok) {
    if (merge.conflict) {
      const fixup = buildFixupTask({
        originatingTask: task,
        fromBranch,
        toBranch,
        detail: merge.detail ?? 'fast-forward failed with conflict',
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
        fixupTask: fixup,
      }
    }
    return {
      record: {
        ...mergeBase,
        result: 'skipped',
        detail: merge.detail ?? 'fast-forward failed; no conflict recorded',
      },
      newStatus: 'blocked',
    }
  }

  if (policy === 'ff_only_local') {
    return {
      record: {
        ...mergeBase,
        result: 'merged',
        ...(merge.commitSha ? { commitSha: merge.commitSha } : {}),
      },
      newStatus: 'done',
    }
  }

  // ff_only_with_push: attempt the push through attemptRemoteSync so an
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
    revisionCount: 0,
    remediationAttempts: 0,
    escalations: [],
    agentIssues: [],
    origination: 'system',
    ...(parent.parentGoalId ? { parentGoalId: parent.parentGoalId } : {}),
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
