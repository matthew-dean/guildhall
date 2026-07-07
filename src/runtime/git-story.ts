import { z } from 'zod'
import type { GitDriver, PullRequestResult } from './git-driver.js'
import { expandHomePath } from './path-utils.js'

export const GitStoryClosureState = z.enum([
  'clean',
  'dirty_uncommitted',
  'committed_local',
  'no_upstream',
  'pushed',
  'pr_open',
  'merged',
  'local_only',
  'deferred',
  'conflict',
  'unknown',
])

export type GitStoryClosureState = z.infer<typeof GitStoryClosureState>

export const GitStorySnapshot = z.object({
  state: GitStoryClosureState,
  repoRoot: z.string(),
  repoId: z.string().optional(),
  repoLabel: z.string().optional(),
  inspectedPath: z.string(),
  branch: z.string().optional(),
  upstream: z.string().optional(),
  ahead: z.number().int().nonnegative().default(0),
  behind: z.number().int().nonnegative().default(0),
  changedCount: z.number().int().nonnegative().default(0),
  untrackedCount: z.number().int().nonnegative().default(0),
  samplePaths: z.array(z.string()).default([]),
  localCommits: z.array(z.object({
    sha: z.string(),
    subject: z.string(),
  })).default([]),
  pr: z.object({
    url: z.string(),
    state: z.string().optional(),
    mergeStateStatus: z.string().optional(),
  }).optional(),
  taskId: z.string().optional(),
  taskTitle: z.string().optional(),
  worktreePath: z.string().optional(),
  mergeRecordResult: z.string().optional(),
  overrideReason: z.string().optional(),
  reason: z.string(),
  nextAction: z.string(),
  inspectedAt: z.string(),
})

export type GitStorySnapshot = z.infer<typeof GitStorySnapshot>

export interface GitStoryClassificationInput {
  changedCount: number
  untrackedCount: number
  ahead: number
  hasUpstream: boolean
  branch?: string
  upstream?: string
  prState?: string
  mergeRecordResult?: string
  override?: 'local_only' | 'deferred'
}

export function classifyGitStoryState(input: GitStoryClassificationInput): GitStoryClosureState {
  if (input.override === 'local_only') return 'local_only'
  if (input.override === 'deferred') return 'deferred'
  if (input.mergeRecordResult === 'conflict') return 'conflict'
  if (input.mergeRecordResult === 'skipped') return 'unknown'
  if (input.mergeRecordResult === 'pending_pr') return 'pr_open'
  if (input.changedCount > 0 || input.untrackedCount > 0) return 'dirty_uncommitted'
  if (input.mergeRecordResult === 'reconciled') return 'merged'
  if (!input.hasUpstream) return 'no_upstream'
  if (input.ahead > 0) return 'committed_local'
  if (input.mergeRecordResult === 'merged' || input.mergeRecordResult === 'pushed') return 'merged'
  if (input.prState && input.prState.toUpperCase() === 'OPEN') return 'pr_open'
  if (input.upstream && ['main', 'master', 'trunk'].includes(input.branch ?? '')) return 'clean'
  if (input.upstream) return 'pushed'
  return 'clean'
}

export function gitStoryStateLabel(state: GitStoryClosureState): string {
  switch (state) {
    case 'clean': return 'Clean'
    case 'dirty_uncommitted': return 'Dirty'
    case 'committed_local': return 'Unpushed'
    case 'no_upstream': return 'No upstream'
    case 'pushed': return 'Pushed'
    case 'pr_open': return 'PR open'
    case 'merged': return 'Merged'
    case 'local_only': return 'Local only'
    case 'deferred': return 'Deferred'
    case 'conflict': return 'Conflict'
    case 'unknown': return 'Unknown'
  }
}

export function nextActionForGitStory(state: GitStoryClosureState): string {
  switch (state) {
    case 'clean':
      return 'No repository follow-up needed.'
    case 'dirty_uncommitted':
      return 'Review the diff, then commit or mark the work local-only/deferred.'
    case 'committed_local':
      return 'Push the branch or open a PR according to this project policy.'
    case 'no_upstream':
      return 'Set an upstream branch or open a PR for this branch.'
    case 'pushed':
      return 'Open a PR or mark this pushed branch as the intended repository state.'
    case 'pr_open':
      return 'Review and merge the open PR when it is ready.'
    case 'merged':
      return 'No repository follow-up needed.'
    case 'local_only':
      return 'No release blocker; work is intentionally local.'
    case 'deferred':
      return 'No immediate action; repository follow-up was intentionally deferred.'
    case 'conflict':
      return 'Resolve the git conflict before calling this work closed.'
    case 'unknown':
      return 'Inspect git state manually; Guildhall could not read it.'
  }
}

export function reasonForGitStorySnapshot(input: {
  state: GitStoryClosureState
  changedCount: number
  untrackedCount: number
  ahead: number
  branch?: string
  upstream?: string
  pr?: PullRequestResult
  mergeRecordResult?: string
  overrideReason?: string
}): string {
  switch (input.state) {
    case 'dirty_uncommitted':
      return `${input.changedCount + input.untrackedCount} changed file${input.changedCount + input.untrackedCount === 1 ? '' : 's'} ${input.changedCount + input.untrackedCount === 1 ? 'is' : 'are'} not committed.`
    case 'committed_local':
      return `${input.branch ?? 'Branch'} has ${input.ahead} local commit${input.ahead === 1 ? '' : 's'} not pushed to ${input.upstream ?? 'upstream'}.`
    case 'no_upstream':
      return `${input.branch ?? 'Branch'} has no upstream branch, so Guildhall cannot compare or publish this work yet.`
    case 'pr_open':
      return input.pr?.url ? `Open PR: ${input.pr.url}` : 'An open PR exists for this branch.'
    case 'pushed':
      return `${input.branch ?? 'Branch'} is pushed to ${input.upstream ?? 'upstream'}.`
    case 'merged':
      if (input.mergeRecordResult === 'reconciled') return 'Task worktree HEAD is already contained in the project repository history.'
      return input.mergeRecordResult ? `Task merge record reports ${input.mergeRecordResult}.` : 'Work is merged.'
    case 'local_only':
      return input.overrideReason ? `Marked local-only: ${input.overrideReason}` : 'Marked local-only.'
    case 'deferred':
      return input.overrideReason ? `Deferred: ${input.overrideReason}` : 'Repository follow-up deferred.'
    case 'conflict':
      return 'A merge or landing conflict needs human attention.'
    case 'unknown':
      return input.mergeRecordResult === 'skipped'
        ? 'Task completed without an automatic merge record; inspect branch state.'
        : 'Guildhall could not inspect git state.'
    case 'clean':
      return 'No local changes or unpublished branch work detected.'
  }
}

export interface InspectGitStoryInput {
  repoRoot: string
  repoId?: string
  repoLabel?: string
  inspectedPath?: string
  task?: {
    id?: string
    title?: string
    worktreePath?: string
    mergeRecord?: { result?: string }
    gitStory?: {
      override?: 'local_only' | 'deferred'
      reason?: string
    }
  }
  inspectPr?: boolean
  now?: () => Date
}

export async function inspectGitStory(
  gitDriver: GitDriver,
  input: InspectGitStoryInput,
): Promise<GitStorySnapshot> {
  const rawInspectedPath = input.inspectedPath ?? input.task?.worktreePath ?? input.repoRoot
  const inspectedPath = expandHomePath(rawInspectedPath)
  const worktreePath = input.task?.worktreePath ? expandHomePath(input.task.worktreePath) : undefined
  const inspectedAt = (input.now?.() ?? new Date()).toISOString()
  try {
    const status = await gitDriver.statusSummary(inspectedPath)
    const localCommits =
      status.upstream
        ? await gitDriver.localCommits(inspectedPath, status.upstream).catch(() => [])
        : []
    const pr: PullRequestResult =
      input.inspectPr !== false && status.branch
        ? await gitDriver.pullRequestForBranch(inspectedPath, status.branch).catch(() => ({ ok: false }))
        : { ok: false }
    const prState = pr.ok ? pr.state : undefined
    const mergeRecordResult = input.task?.mergeRecord?.result
    const override = input.task?.gitStory?.override
    const overrideReason = input.task?.gitStory?.reason
    const state = classifyGitStoryState({
      changedCount: status.changedCount,
      untrackedCount: status.untrackedCount,
      ahead: status.ahead,
      hasUpstream: Boolean(status.upstream),
      branch: status.branch,
      upstream: status.upstream,
      prState,
      mergeRecordResult,
      override,
    })

    return GitStorySnapshot.parse({
      state,
      repoRoot: input.repoRoot,
      repoId: input.repoId,
      repoLabel: input.repoLabel,
      inspectedPath,
      branch: status.branch,
      upstream: status.upstream,
      ahead: status.ahead,
      behind: status.behind,
      changedCount: status.changedCount,
      untrackedCount: status.untrackedCount,
      samplePaths: status.samplePaths,
      localCommits,
      ...(pr.ok && pr.url ? { pr: { url: pr.url, state: pr.state, mergeStateStatus: pr.mergeStateStatus } } : {}),
      taskId: input.task?.id,
      taskTitle: input.task?.title,
      worktreePath,
      mergeRecordResult,
      overrideReason,
      reason: reasonForGitStorySnapshot({
        state,
        changedCount: status.changedCount,
        untrackedCount: status.untrackedCount,
        ahead: status.ahead,
        branch: status.branch,
        upstream: status.upstream,
        pr,
        mergeRecordResult,
        overrideReason,
      }),
      nextAction: nextActionForGitStory(state),
      inspectedAt,
    })
  } catch (err) {
    return GitStorySnapshot.parse({
      state: 'unknown',
      repoRoot: input.repoRoot,
      repoId: input.repoId,
      repoLabel: input.repoLabel,
      inspectedPath,
      reason: err instanceof Error ? err.message : String(err),
      nextAction: nextActionForGitStory('unknown'),
      inspectedAt,
      taskId: input.task?.id,
      taskTitle: input.task?.title,
      worktreePath,
    })
  }
}

export interface GitStoryBlocker {
  id: string
  label: string
  repoId?: string
  repoLabel?: string
  state: GitStoryClosureState
  reason: string
  nextAction: string
  taskId?: string
}

export interface GitStorySummary {
  ready: boolean
  state: GitStoryClosureState
  blockers: GitStoryBlocker[]
  snapshots: GitStorySnapshot[]
}

const STATE_SEVERITY: Record<GitStoryClosureState, number> = {
  conflict: 100,
  unknown: 90,
  dirty_uncommitted: 80,
  committed_local: 70,
  no_upstream: 60,
  pr_open: 50,
  deferred: 40,
  local_only: 30,
  pushed: 20,
  merged: 10,
  clean: 0,
}

const NON_BLOCKING_STATES = new Set<GitStoryClosureState>([
  'clean',
  'merged',
  'local_only',
  'deferred',
])

export function summarizeGitStories(snapshots: GitStorySnapshot[]): GitStorySummary {
  const state = snapshots
    .map((snapshot) => snapshot.state)
    .sort((a, b) => STATE_SEVERITY[b] - STATE_SEVERITY[a])[0] ?? 'clean'
  const blockers = snapshots
    .filter((snapshot) => !NON_BLOCKING_STATES.has(snapshot.state))
    .map((snapshot, index) => ({
      id: snapshot.taskId ? `task:${snapshot.taskId}` : `repo:${index}`,
      label: [
        snapshot.repoLabel,
        snapshot.taskTitle ?? snapshot.branch ?? snapshot.inspectedPath,
      ].filter(Boolean).join(': '),
      ...(snapshot.repoId ? { repoId: snapshot.repoId } : {}),
      ...(snapshot.repoLabel ? { repoLabel: snapshot.repoLabel } : {}),
      state: snapshot.state,
      reason: snapshot.reason,
      nextAction: snapshot.nextAction,
      ...(snapshot.taskId ? { taskId: snapshot.taskId } : {}),
    }))
  return {
    ready: blockers.length === 0,
    state,
    blockers,
    snapshots,
  }
}
