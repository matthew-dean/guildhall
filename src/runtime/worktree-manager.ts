/**
 * FR-24 worktree isolation. Pure-ish policy layer over a `GitDriver`:
 *
 *   • `resolveWorktreeMode` — read the lever position.
 *   • `computeBranchName`   — deterministic branch name per task / attempt.
 *   • `ensureWorktreeForDispatch` — idempotent allocate-or-reuse.
 *   • `cleanupWorktreeForTerminal` — teardown on task terminal.
 *
 * No background state; every function takes the `Task` + driver explicitly.
 */

import path from 'node:path'
import type { Task } from '@guildhall/core'
import type { ProjectLevers } from '@guildhall/levers'
import type { GitDriver } from './git-driver.js'

export type WorktreeMode = ProjectLevers['worktree_isolation']['position']

export function resolveWorktreeMode(project: ProjectLevers): WorktreeMode {
  return project.worktree_isolation.position
}

export const DEFAULT_WORKTREE_ROOT_SEGMENT = path.join('.guildhall', 'worktrees')

export function worktreeRootFor(projectPath: string): string {
  return path.join(projectPath, DEFAULT_WORKTREE_ROOT_SEGMENT)
}

/**
 * Deterministic branch name per (task, mode). `per_attempt` appends the
 * revision counter so retries get a fresh branch; `per_task` reuses the
 * original across revisions.
 */
export function computeBranchName(
  task: Task,
  mode: WorktreeMode,
): string {
  const safeId = task.id.replace(/[^A-Za-z0-9_-]/g, '_')
  if (mode === 'per_attempt') {
    return `guildhall/task-${safeId}/attempt-${task.revisionCount}`
  }
  return `guildhall/task-${safeId}`
}

export function computeWorktreePath(
  projectPath: string,
  task: Task,
  mode: WorktreeMode,
): string {
  const root = worktreeRootFor(projectPath)
  const safeId = task.id.replace(/[^A-Za-z0-9_-]/g, '_')
  if (mode === 'per_attempt') {
    return path.join(root, safeId, `attempt-${task.revisionCount}`)
  }
  return path.join(root, safeId)
}

export interface EnsureWorktreeInput {
  task: Task
  mode: WorktreeMode
  projectPath: string
  baseBranch: string
  gitDriver: GitDriver
}

export interface EnsureWorktreeResult {
  /** Active worktree path (absolute) for this dispatch. */
  worktreePath: string
  /** Branch name the worker operates on. */
  branchName: string
  /** Base branch the worktree was forked from. */
  baseBranch: string
  /** True when a worktree was created on this call (vs. reused). */
  created: boolean
}

/**
 * Idempotent per-dispatch worktree setup. Called before the worker agent runs.
 *
 * • `none`        → returns the project path unchanged; no git calls.
 * • `per_task`    → creates once, reuses across ticks; path + branch persisted
 *                   on the task by the caller.
 * • `per_attempt` → creates on first dispatch of each revision.
 *
 * The caller is responsible for persisting `worktreePath` / `branchName` /
 * `baseBranch` back onto the `Task` so subsequent reads (reviewer, gate
 * checker, merge) see the same paths.
 */
export async function ensureWorktreeForDispatch(
  input: EnsureWorktreeInput,
): Promise<EnsureWorktreeResult> {
  const { task, mode, projectPath, baseBranch, gitDriver } = input

  if (mode === 'none') {
    return {
      worktreePath: projectPath,
      branchName: task.branchName ?? baseBranch,
      baseBranch,
      created: false,
    }
  }

  const expectedBranch = computeBranchName(task, mode)
  const expectedPath = computeWorktreePath(projectPath, task, mode)

  // Reuse the existing worktree when the task already owns one and the
  // mode + branch line up (per_task across ticks, or per_attempt within the
  // same revision).
  if (
    task.worktreePath === expectedPath &&
    task.branchName === expectedBranch
  ) {
    return {
      worktreePath: expectedPath,
      branchName: expectedBranch,
      baseBranch: task.baseBranch ?? baseBranch,
      created: false,
    }
  }

  await gitDriver.createWorktree(projectPath, {
    worktreePath: expectedPath,
    branch: expectedBranch,
    baseBranch,
  })
  return {
    worktreePath: expectedPath,
    branchName: expectedBranch,
    baseBranch,
    created: true,
  }
}

export interface CleanupWorktreeInput {
  task: Task
  mode: WorktreeMode
  projectPath: string
  gitDriver: GitDriver
  /**
   * FR-25 manual_pr: when a task transitions to `pending_pr`, the branch must
   * stay alive until the human merges the PR externally. Callers pass `true`
   * for that case so the worktree is left in place.
   */
  preserveForPendingPr?: boolean
}

/**
 * Called on terminal transitions (`done`, `shelved`, `blocked`) to tear down
 * the worktree. No-op when mode is `none` or preservation is requested.
 */
export async function cleanupWorktreeForTerminal(
  input: CleanupWorktreeInput,
): Promise<void> {
  if (input.mode === 'none') return
  if (input.preserveForPendingPr) return
  if (!input.task.worktreePath) return
  await input.gitDriver.removeWorktree(input.projectPath, input.task.worktreePath)
}
