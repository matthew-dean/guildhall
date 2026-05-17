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
import fs from 'node:fs/promises'
import { homedir } from 'node:os'
import type { Task } from '@guildhall/core'
import type { ProjectLevers } from '@guildhall/levers'
import type { GitDriver } from './git-driver.js'

export type WorktreeMode = ProjectLevers['worktree_isolation']['position']

export function resolveWorktreeMode(project: ProjectLevers): WorktreeMode {
  return project.worktree_isolation.position
}

export const DEFAULT_WORKTREE_ROOT_SEGMENT = path.join('.guildhall', 'worktrees')
export const GLOBAL_WORKTREE_ROOT_SEGMENT = 'worktrees'

function guildhallHomeDir(): string {
  const override = process.env['GUILDHALL_CONFIG_DIR']?.trim()
  if (override) return override
  return path.join(homedir(), '.guildhall')
}

export function worktreeRootFor(projectId: string): string {
  return path.join(guildhallHomeDir(), GLOBAL_WORKTREE_ROOT_SEGMENT, projectId)
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
  projectId: string,
  task: Task,
  mode: WorktreeMode,
): string {
  const root = worktreeRootFor(projectId)
  const safeId = task.id.replace(/[^A-Za-z0-9_-]/g, '_')
  if (mode === 'per_attempt') {
    return path.join(root, safeId, `attempt-${task.revisionCount}`)
  }
  return path.join(root, safeId)
}

export interface EnsureWorktreeInput {
  task: Task
  mode: WorktreeMode
  projectId: string
  projectPath: string
  workspacePath?: string
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
  const { task, mode, projectId, projectPath, workspacePath, baseBranch, gitDriver } = input

  if (mode === 'none') {
    return {
      worktreePath: projectPath,
      branchName: task.branchName ?? baseBranch,
      baseBranch,
      created: false,
    }
  }

  const expectedBranch = computeBranchName(task, mode)
  const expectedPath = computeWorktreePath(projectId, task, mode)

  // Reuse the existing worktree when the task already owns one and the
  // branch line up (per_task across ticks, or per_attempt within the
  // same revision). This also preserves legacy repo-local worktree paths
  // until the task naturally exits.
  if (
    task.worktreePath &&
    task.branchName === expectedBranch
  ) {
    await pruneProjectRuntimeLinks({
      projectPath,
      worktreePath: task.worktreePath,
    })
    await ensureWorkspaceSiblingLinks({
      workspacePath,
      projectPath,
      worktreePath: task.worktreePath,
    })
    return {
      worktreePath: task.worktreePath,
      branchName: expectedBranch,
      baseBranch: task.baseBranch ?? baseBranch,
      created: false,
    }
  }

  if (task.branchName === expectedBranch) {
    await input.gitDriver.attachWorktree(projectPath, {
      worktreePath: expectedPath,
      branch: expectedBranch,
    })
    await pruneProjectRuntimeLinks({
      projectPath,
      worktreePath: expectedPath,
    })
    await ensureWorkspaceSiblingLinks({
      workspacePath,
      projectPath,
      worktreePath: expectedPath,
    })
    return {
      worktreePath: expectedPath,
      branchName: expectedBranch,
      baseBranch: task.baseBranch ?? baseBranch,
      created: true,
    }
  }

  await gitDriver.createWorktree(projectPath, {
    worktreePath: expectedPath,
    branch: expectedBranch,
    baseBranch,
  })
  await pruneProjectRuntimeLinks({
    projectPath,
    worktreePath: expectedPath,
  })
  await ensureWorkspaceSiblingLinks({
    workspacePath,
    projectPath,
    worktreePath: expectedPath,
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

interface EnsureWorkspaceSiblingLinksInput {
  workspacePath?: string
  projectPath: string
  worktreePath: string
}

interface PruneProjectRuntimeLinksInput {
  projectPath: string
  worktreePath: string
}

async function pruneProjectRuntimeLinks(
  input: PruneProjectRuntimeLinksInput,
): Promise<void> {
  const normalizedProject = path.resolve(input.projectPath)
  const normalizedWorktree = path.resolve(input.worktreePath)
  if (!(await exists(normalizedProject))) return
  await pruneDirSymlink(path.join(normalizedWorktree, 'node_modules'))

  const entries = await fs.readdir(normalizedProject, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (entry.name.startsWith('.')) continue
    const packageRoot = path.join(normalizedProject, entry.name)
    const hasPackageJson = await exists(path.join(packageRoot, 'package.json'))
    if (!hasPackageJson) continue
    await pruneDirSymlink(path.join(normalizedWorktree, entry.name, 'node_modules'))
  }
}

async function ensureWorkspaceSiblingLinks(
  input: EnsureWorkspaceSiblingLinksInput,
): Promise<void> {
  const workspacePath = input.workspacePath?.trim()
  if (!workspacePath) return
  const normalizedWorkspace = path.resolve(workspacePath)
  const normalizedProject = path.resolve(input.projectPath)
  if (path.dirname(normalizedProject) !== normalizedWorkspace) return

  const projectName = path.basename(normalizedProject)
  const worktreeRoot = path.dirname(input.worktreePath)
  await fs.mkdir(worktreeRoot, { recursive: true })
  const entries = await fs.readdir(normalizedWorkspace, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (entry.name.startsWith('.')) continue
    if (entry.name === projectName) continue
    const candidatePath = path.join(normalizedWorkspace, entry.name)
    const looksRelevant =
      (await exists(path.join(candidatePath, '.git'))) ||
      (await exists(path.join(candidatePath, 'package.json')))
    if (!looksRelevant) continue
    const linkPath = path.join(worktreeRoot, entry.name)
    const target = path.relative(worktreeRoot, candidatePath)
    const existing = await readSymlinkTarget(linkPath)
    if (existing === target) continue
    if (existing !== null) {
      await fs.unlink(linkPath)
    } else if (await exists(linkPath)) {
      continue
    }
    await fs.symlink(target, linkPath, 'dir')
  }
}

async function ensureDirSymlink(input: {
  sourcePath: string
  linkPath: string
}): Promise<void> {
  if (!(await exists(input.sourcePath))) return
  await fs.mkdir(path.dirname(input.linkPath), { recursive: true })
  const target = path.relative(path.dirname(input.linkPath), input.sourcePath)
  const existing = await readSymlinkTarget(input.linkPath)
  if (existing === target) return
  if (existing !== null) {
    await fs.unlink(input.linkPath)
  } else if (await exists(input.linkPath)) {
    return
  }
  await fs.symlink(target, input.linkPath, 'dir')
}

async function pruneDirSymlink(linkPath: string): Promise<void> {
  const existing = await readSymlinkTarget(linkPath)
  if (existing === null) return
  await fs.unlink(linkPath)
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function readSymlinkTarget(linkPath: string): Promise<string | null> {
  try {
    const stat = await fs.lstat(linkPath)
    if (!stat.isSymbolicLink()) return null
    return await fs.readlink(linkPath)
  } catch {
    return null
  }
}
