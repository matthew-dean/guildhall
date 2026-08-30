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
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import type { Task } from '@guildhall/core'
import type { ProjectLevers } from '@guildhall/levers'
import type { GitDriver } from './git-driver.js'
import { resolveRuntimePath } from './path-utils.js'

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
    // Git refs cannot have both `guildhall/task-x` and descendants beneath
    // it. Keep attempt branches siblings so a fresh retry can follow a
    // landed per-task branch without a ref-namespace collision.
    return `guildhall/task-${safeId}-attempt-${worktreeAttemptNumber(task)}`
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
    return path.join(root, safeId, `attempt-${worktreeAttemptNumber(task)}`)
  }
  return path.join(root, safeId)
}

function worktreeAttemptNumber(task: Pick<Task, 'revisionCount'>): number {
  return Number.isInteger(task.revisionCount) && task.revisionCount >= 0
    ? task.revisionCount
    : 0
}

export interface EnsureWorktreeInput {
  task: Task
  mode: WorktreeMode
  projectId: string
  projectPath: string
  workspacePath?: string
  worktreeInclude?: string[]
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
  /** A Git-observed merge the worker must resolve before ordinary work. */
  mergeRecovery?: {
    baseBranch: string
    conflictPaths: string[]
    baseSha: string | null
    headSha: string | null
  }
}

export interface DiscardTaskWorktreeInput {
  task: Task
  mode: WorktreeMode
  projectId: string
  projectPath: string
  gitDriver: GitDriver
}

export class WorktreeSyncError extends Error {
  readonly code: 'task_worktree_sync' | 'task_worktree_sync_conflict'

  constructor(taskId: string, baseBranch: string, detail: string, conflict: boolean) {
    super(`Guildhall could not synchronize task worktree ${taskId} with ${baseBranch}: ${detail}`)
    this.name = 'WorktreeSyncError'
    this.code = conflict ? 'task_worktree_sync_conflict' : 'task_worktree_sync'
  }
}

/**
 * Idempotent per-dispatch worktree setup. Called before the worker agent runs.
 *
 * • `none`        → returns the project path unchanged; no git calls.
 * • `per_task`    → creates once, reuses across ticks; path + branch persisted
 *                   on the task by the caller.
 * • `per_attempt` → creates on first dispatch of each revision.
 *
 * This low-level allocator does not publish workspace ownership. Dispatch
 * callers use `ensureAndRegisterTaskWorkspace` so allocation and registration
 * are one recoverable operation.
 */
export async function ensureWorktreeForDispatch(
  input: EnsureWorktreeInput,
): Promise<EnsureWorktreeResult> {
  const { task, mode, projectId, projectPath, workspacePath, worktreeInclude, baseBranch, gitDriver } = input

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
    task.branchName === expectedBranch &&
    existsSync(resolveRuntimePath(task.worktreePath))
  ) {
    const existingWorktreePath = resolveRuntimePath(task.worktreePath)
    const mergeRecovery = await synchronizeReusableWorktree({
      task,
      worktreePath: existingWorktreePath,
      baseBranch: task.baseBranch ?? baseBranch,
      gitDriver,
    })
    if (mergeRecovery) {
      return {
        worktreePath: existingWorktreePath,
        branchName: expectedBranch,
        baseBranch: task.baseBranch ?? baseBranch,
        created: false,
        mergeRecovery,
      }
    }
    await pruneProjectRuntimeLinks({
      projectPath,
      worktreePath: existingWorktreePath,
    })
    await ensureWorkspaceSiblingLinks({
      workspacePath,
      projectPath,
      worktreePath: existingWorktreePath,
    })
    await copyWorktreeIncludeFiles({
      projectPath,
      worktreePath: existingWorktreePath,
      include: worktreeInclude ?? [],
    })
    return {
      worktreePath: existingWorktreePath,
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
    return compensateFailedWorktreeSetup({
      projectPath,
      worktreePath: expectedPath,
      gitDriver,
      setup: async () => {
        const mergeRecovery = await synchronizeReusableWorktree({
          task,
          worktreePath: expectedPath,
          baseBranch: task.baseBranch ?? baseBranch,
          gitDriver,
        })
        if (mergeRecovery) {
          return {
            worktreePath: expectedPath,
            branchName: expectedBranch,
            baseBranch: task.baseBranch ?? baseBranch,
            created: true,
            mergeRecovery,
          }
        }
        await prepareAllocatedWorktree({
          projectPath,
          workspacePath,
          worktreePath: expectedPath,
          worktreeInclude,
        })
        return {
          worktreePath: expectedPath,
          branchName: expectedBranch,
          baseBranch: task.baseBranch ?? baseBranch,
          created: true,
        }
      },
    })
  }

  await gitDriver.createWorktree(projectPath, {
    worktreePath: expectedPath,
    branch: expectedBranch,
    baseBranch,
  })
  return compensateFailedWorktreeSetup({
    projectPath,
    worktreePath: expectedPath,
    gitDriver,
    setup: async () => {
      await prepareAllocatedWorktree({
        projectPath,
        workspacePath,
        worktreePath: expectedPath,
        worktreeInclude,
      })
      return {
        worktreePath: expectedPath,
        branchName: expectedBranch,
        baseBranch,
        created: true,
      }
    },
  })
}

async function prepareAllocatedWorktree(input: {
  projectPath: string
  workspacePath?: string
  worktreePath: string
  worktreeInclude?: string[]
}): Promise<void> {
  await pruneProjectRuntimeLinks(input)
  await ensureWorkspaceSiblingLinks(input)
  await copyWorktreeIncludeFiles({
    projectPath: input.projectPath,
    worktreePath: input.worktreePath,
    include: input.worktreeInclude ?? [],
  })
}

async function compensateFailedWorktreeSetup<T>(input: {
  projectPath: string
  worktreePath: string
  gitDriver: GitDriver
  setup: () => Promise<T>
}): Promise<T> {
  try {
    return await input.setup()
  } catch (setupError) {
    try {
      await input.gitDriver.removeWorktree(input.projectPath, input.worktreePath)
    } catch (cleanupError) {
      throw new AggregateError(
        [setupError, cleanupError],
        `Guildhall worktree setup failed and cleanup could not remove ${input.worktreePath}`,
      )
    }
    throw setupError
  }
}

export interface CleanupWorktreeInput {
  task: Task
  mode: WorktreeMode
  /** Stable workspace identity used to prove the checkout is Guildhall-owned. */
  projectId: string
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
 * Called after successfully landed work reaches `done` to tear down the
 * worktree. No-op when mode is `none` or preservation is requested.
 */
export async function cleanupWorktreeForTerminal(
  input: CleanupWorktreeInput,
): Promise<void> {
  if (input.mode === 'none') return
  if (input.preserveForPendingPr) return
  if (!input.task.worktreePath) return
  const worktreePath = resolveRuntimePath(input.task.worktreePath)
  const ownedRoots = [
    path.resolve(worktreeRootFor(input.projectId)),
    path.resolve(input.projectPath, DEFAULT_WORKTREE_ROOT_SEGMENT),
  ]
  if (!ownedRoots.some((ownedRoot) => isDescendantPath(ownedRoot, worktreePath))) {
    throw new Error(`Refusing to remove non-Guildhall worktree for ${input.task.id}: ${worktreePath}`)
  }
  await input.gitDriver.removeWorktree(input.projectPath, worktreePath)
}

/**
 * Drop a Guildhall-owned disposable task sandbox so the next dispatch starts
 * from the configured base. Callers must establish that no in-scope task
 * progress is present before using this recovery boundary.
 */
export async function discardTaskWorktreeForRecovery(
  input: DiscardTaskWorktreeInput,
): Promise<boolean> {
  if (input.mode === 'none' || !input.task.worktreePath?.trim()) return false
  const worktreePath = resolveRuntimePath(input.task.worktreePath)
  const ownedRoots = [
    path.resolve(worktreeRootFor(input.projectId)),
    path.resolve(input.projectPath, DEFAULT_WORKTREE_ROOT_SEGMENT),
  ]
  if (!ownedRoots.some((ownedRoot) => isDescendantPath(ownedRoot, worktreePath))) {
    throw new Error(`Refusing to discard non-Guildhall worktree for ${input.task.id}: ${worktreePath}`)
  }
  const branchName = input.task.branchName ?? computeBranchName(input.task, input.mode)
  if (!branchName.startsWith('guildhall/task-')) {
    throw new Error(`Refusing to discard non-Guildhall task branch for ${input.task.id}: ${branchName}`)
  }
  await input.gitDriver.removeWorktree(input.projectPath, worktreePath)
  await input.gitDriver.deleteBranch(input.projectPath, branchName)
  return true
}

function isDescendantPath(root: string, candidate: string): boolean {
  const relativePath = path.relative(root, candidate)
  return relativePath !== ''
    && relativePath !== '..'
    && !relativePath.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relativePath)
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

interface CopyWorktreeIncludeFilesInput {
  projectPath: string
  worktreePath: string
  include: string[]
}

async function copyWorktreeIncludeFiles(
  input: CopyWorktreeIncludeFilesInput,
): Promise<void> {
  if (input.include.length === 0) return
  const projectRoot = path.resolve(input.projectPath)
  const worktreeRoot = path.resolve(input.worktreePath)
  for (const rawPattern of input.include) {
    const normalized = normalizeWorktreeIncludePattern(rawPattern)
    if (!normalized) continue
    if (normalized.endsWith('/**')) {
      const dir = normalized.slice(0, -3)
      await copyWorktreeIncludePath({ projectRoot, worktreeRoot, relativePath: dir })
      continue
    }
    if (normalized.includes('*')) {
      const matches = await findWorktreeIncludeMatches(projectRoot, normalized)
      for (const relativePath of matches) {
        await copyWorktreeIncludePath({ projectRoot, worktreeRoot, relativePath })
      }
      continue
    }
    await copyWorktreeIncludePath({ projectRoot, worktreeRoot, relativePath: normalized })
  }
}

async function synchronizeReusableWorktree(input: {
  task: Task
  worktreePath: string
  baseBranch: string
  gitDriver: GitDriver
}): Promise<EnsureWorktreeResult['mergeRecovery'] | undefined> {
  const result = await input.gitDriver.syncWorktreeWithBase(
    input.worktreePath,
    input.baseBranch,
    `Guildhall: checkpoint task work before synchronizing ${input.task.id}`,
  )
  if (result.ok) return undefined
  if (result.conflict === true && result.mergeInProgress === true && (result.conflictPaths?.length ?? 0) > 0) {
    return {
      baseBranch: input.baseBranch,
      conflictPaths: [...result.conflictPaths!].sort(),
      baseSha: result.baseSha ?? null,
      headSha: result.headSha ?? null,
    }
  }
  const detail = result.detail ?? 'unknown worktree synchronization error'
  throw new WorktreeSyncError(input.task.id, input.baseBranch, detail, result.conflict === true)
}

function normalizeWorktreeIncludePattern(rawPattern: string): string | null {
  const trimmed = rawPattern.trim().replace(/^\/+/, '')
  if (!trimmed) return null
  const normalized = path.posix.normalize(trimmed.replace(/\\/g, '/'))
  if (
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    path.isAbsolute(normalized)
  ) {
    return null
  }
  return normalized
}

async function copyWorktreeIncludePath(input: {
  projectRoot: string
  worktreeRoot: string
  relativePath: string
}): Promise<void> {
  const sourcePath = path.resolve(input.projectRoot, input.relativePath)
  const targetPath = path.resolve(input.worktreeRoot, input.relativePath)
  if (!isPathInside(input.projectRoot, sourcePath)) return
  if (!isPathInside(input.worktreeRoot, targetPath)) return
  let stat
  try {
    stat = await fs.lstat(sourcePath)
  } catch {
    return
  }
  if (stat.isSymbolicLink()) return
  if (!stat.isFile() && !stat.isDirectory()) return
  await fs.mkdir(path.dirname(targetPath), { recursive: true })
  await fs.cp(sourcePath, targetPath, {
    recursive: stat.isDirectory(),
    force: true,
    errorOnExist: false,
    dereference: false,
  })
}

async function findWorktreeIncludeMatches(
  projectRoot: string,
  pattern: string,
): Promise<string[]> {
  const matcher = globPatternToRegExp(pattern)
  const matches: string[] = []
  const skipDirs = new Set(['.git', '.guildhall', 'node_modules', 'dist', 'build', 'coverage'])
  const queue = ['']
  while (queue.length > 0) {
    const relativeDir = queue.shift() ?? ''
    const absoluteDir = path.join(projectRoot, relativeDir)
    let entries
    try {
      entries = await fs.readdir(absoluteDir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const relativePath = path.posix.join(relativeDir.split(path.sep).join('/'), entry.name)
      if (entry.isDirectory()) {
        if (skipDirs.has(entry.name)) continue
        queue.push(path.join(relativeDir, entry.name))
        continue
      }
      if (entry.isFile() && matcher.test(relativePath)) {
        matches.push(relativePath)
      }
    }
  }
  return matches
}

function globPatternToRegExp(pattern: string): RegExp {
  let source = '^'
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i] ?? ''
    const next = pattern[i + 1]
    if (char === '*' && next === '*') {
      source += '.*'
      i += 1
    } else if (char === '*') {
      source += '[^/]*'
    } else {
      source += escapeRegExp(char)
    }
  }
  source += '$'
  return new RegExp(source)
}

function escapeRegExp(char: string): string {
  return /[|\\{}()[\]^$+*?.]/.test(char) ? `\\${char}` : char
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
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
