/**
 * FR-24 / FR-25: the minimal git surface Guildhall needs.
 *
 * We deliberately don't pull in a JS git library — the operation set is tiny
 * (≤6 verbs) and shelling out to `git` keeps the code inspectable and avoids
 * another large dep. The interface exists so tests can inject an in-memory
 * fake without touching the filesystem.
 *
 * Real operational semantics: `NodeGitDriver` runs each command in the
 * project's repo, not inside a worktree — all worktree pathing is expressed
 * via `--git-dir` / absolute paths from the project root. The driver does not
 * cache state; callers pass every parameter explicitly so behavior is easy to
 * reason about across parallel dispatches.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import { resolveRuntimePath } from './path-utils.js'

const execFileP = promisify(execFile)
const GIT_BIN = process.env['GUILDHALL_GIT_BIN']?.trim() || '/usr/bin/git'
const GH_BIN = process.env['GUILDHALL_GH_BIN']?.trim() || 'gh'
const STALE_GIT_INDEX_LOCK_MS = 5_000

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

async function execGit(args: readonly string[], opts: { cwd: string; maxBuffer?: number }): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFileP(GIT_BIN, [...args], opts)
  } catch (err) {
    if (!err || typeof err !== 'object' || (err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    if (!fsSync.existsSync(opts.cwd)) {
      throw new Error(`Cannot run git because cwd does not exist: ${opts.cwd}`)
    }
    return await execFileP('/bin/sh', ['-lc', [shellQuote(GIT_BIN), ...args.map(shellQuote)].join(' ')], opts)
  }
}

async function execGh(args: readonly string[], opts: { cwd: string; maxBuffer?: number }): Promise<{ stdout: string; stderr: string }> {
  return await execFileP(GH_BIN, [...args], opts)
}

function errorDetail(err: unknown): string {
  if (err && typeof err === 'object') {
    const message = err instanceof Error ? err.message : String(err)
    const stderr = 'stderr' in err && typeof err.stderr === 'string' ? err.stderr : ''
    const stdout = 'stdout' in err && typeof err.stdout === 'string' ? err.stdout : ''
    return [message, stderr.trim(), stdout.trim()].filter(Boolean).join('\n')
  }
  return String(err)
}

export async function pruneStaleGitIndexLockFromError(
  detail: string,
  opts: { now?: number; staleAfterMs?: number } = {},
): Promise<boolean> {
  if (!detail.includes('index.lock')) return false
  const match = /Unable to create '([^']*index\.lock)'/.exec(detail)
  const lockPath = match?.[1]
  if (!lockPath || !path.isAbsolute(lockPath)) return false
  const normalized = path.normalize(lockPath)
  if (!normalized.endsWith(`${path.sep}index.lock`) || !normalized.includes(`${path.sep}.git${path.sep}`)) {
    return false
  }

  let stat: fsSync.Stats
  try {
    stat = await fs.stat(normalized)
  } catch {
    return false
  }
  const now = opts.now ?? Date.now()
  const staleAfterMs = opts.staleAfterMs ?? STALE_GIT_INDEX_LOCK_MS
  if (now - stat.mtimeMs < staleAfterMs) return false
  await fs.rm(normalized, { force: true })
  return true
}

function isIgnorableGuildhallStatePath(file: string): boolean {
  return (
    file === 'guildhall.yaml' ||
    // AGENTS.md is the managed Codex bridge file installed by Guildhall. Its
    // presence is agent configuration, not release work in the repository.
    file === 'AGENTS.md' ||
    file === 'memory' ||
    file.startsWith('memory/') ||
    file === '.guildhall' ||
    file.startsWith('.guildhall/')
  )
}

async function workingPathMatchesBranchTarget(
  gitRoot: string,
  branch: string,
  file: string,
): Promise<boolean> {
  const { stdout: treeEntry } = await execGit(['ls-tree', branch, '--', file], {
    cwd: gitRoot,
    maxBuffer: 1024 * 1024,
  })
  const entry = treeEntry.trim()
  if (!entry) {
    try {
      await fs.lstat(path.join(gitRoot, file))
      return false
    } catch (err) {
      return (err as NodeJS.ErrnoException).code === 'ENOENT'
    }
  }

  const [targetMode, , targetHash] = entry.split(/\s+/, 3)
  if (!targetMode || !targetHash || targetMode === '160000') return false

  let stat: Awaited<ReturnType<typeof fs.lstat>>
  try {
    stat = await fs.lstat(path.join(gitRoot, file))
  } catch {
    return false
  }
  const currentMode = stat.isSymbolicLink()
    ? '120000'
    : stat.isFile()
      ? (stat.mode & 0o111) !== 0 ? '100755' : '100644'
      : null
  if (currentMode !== targetMode) return false

  try {
    const { stdout: currentHash } = await execGit(['hash-object', '--', file], {
      cwd: gitRoot,
      maxBuffer: 1024 * 1024,
    })
    return currentHash.trim() === targetHash
  } catch {
    return false
  }
}

async function resolveGitTopLevel(repoRoot: string): Promise<string> {
  let cwd = resolveRuntimePath(repoRoot)
  while (!fsSync.existsSync(cwd)) {
    const parent = path.dirname(cwd)
    if (parent === cwd) {
      throw new Error(`Cannot resolve git root because no existing ancestor was found for: ${repoRoot}`)
    }
    cwd = parent
  }
  const { stdout } = await execGit(['rev-parse', '--show-toplevel'], {
    cwd,
  })
  return stdout.trim() || repoRoot
}

function isNotGitRepositoryError(err: unknown): boolean {
  const detail = errorDetail(err)
  return /not a git repository|cannot find git repository/i.test(detail)
}

async function gitRefSha(repoRoot: string, ref: string): Promise<string | null> {
  try {
    const { stdout } = await execGit(['rev-parse', '--verify', '--quiet', ref], { cwd: repoRoot })
    return stdout.trim() || null
  } catch {
    return null
  }
}

export interface CreateWorktreeOptions {
  worktreePath: string
  branch: string
  baseBranch: string
}

export interface AttachWorktreeOptions {
  worktreePath: string
  branch: string
}

export interface CheckpointDirtyWorkOptions {
  branch: string
  baseBranch: string
  commitMessage: string
}

export interface MergeResult {
  ok: boolean
  commitSha?: string
  detail?: string
  /** True when the failure was specifically a merge conflict. */
  conflict?: boolean
}

export interface WorktreeSyncResult {
  ok: boolean
  /** True when the worktree branch changed or was checkpointed. */
  changed?: boolean
  commitSha?: string
  detail?: string
  /** True when the base update could not be applied without a conflict. */
  conflict?: boolean
  /** Git's exact unmerged paths when `conflict` is true. */
  conflictPaths?: string[]
  /** True when the worktree remains in Git's merge state for recovery. */
  mergeInProgress?: boolean
  /** Immutable refs observed with the sync attempt. */
  baseSha?: string | null
  headSha?: string | null
}

/** Current merge state from Git, not from agent narration or task copy. */
export interface WorktreeMergeState {
  mergeInProgress: boolean
  conflictPaths: string[]
  baseSha: string | null
  headSha: string | null
}

export interface PushResult {
  ok: boolean
  detail?: string
}

export interface PullRequestResult {
  ok: boolean
  url?: string
  state?: string
  mergeStateStatus?: string
  detail?: string
}

export interface CheckpointResult {
  ok: boolean
  commitSha?: string
  detail?: string
}

export interface GitStatusSummary {
  /** False when the path is a workspace/document scope rather than a Git repo. */
  repository?: boolean
  branch?: string
  upstream?: string
  ahead: number
  behind: number
  changedCount: number
  untrackedCount: number
  samplePaths: string[]
  clean: boolean
}

export interface GitDriver {
  /** Current branch name in the repo root (e.g. `main`, `master`). */
  currentBranch(repoRoot: string): Promise<string>
  /** True when the repo root has no uncommitted changes. */
  isClean(repoRoot: string): Promise<boolean>
  /** Read branch/upstream/dirty status without changing git state. */
  statusSummary(repoRoot: string): Promise<GitStatusSummary>
  /** Read local commits ahead of upstream. */
  localCommits(repoRoot: string, upstream: string): Promise<Array<{ sha: string; subject: string }>>
  /** Read HEAD for a repo or worktree. */
  headSha(repoRoot: string): Promise<string>
  /** True when `ancestorSha` is already contained by `descendantRef`. */
  isAncestor(repoRoot: string, ancestorSha: string, descendantRef: string): Promise<boolean>
  /** Read PR metadata for a branch, if the GitHub CLI can resolve one. */
  pullRequestForBranch(repoRoot: string, branch: string): Promise<PullRequestResult>
  /** Commit the current branch's dirty work without changing branches. */
  commitAll(repoRoot: string, message: string): Promise<CheckpointResult>
  /** Create a new worktree at `worktreePath` with a fresh branch off `baseBranch`. */
  createWorktree(repoRoot: string, opts: CreateWorktreeOptions): Promise<void>
  /** Attach an existing branch to a worktree path. */
  attachWorktree(repoRoot: string, opts: AttachWorktreeOptions): Promise<void>
  /**
   * Bring a reusable task worktree up to the current base branch. Dirty task
   * edits are checkpointed first; merge conflicts fail closed.
   */
  syncWorktreeWithBase(
    worktreePath: string,
    baseBranch: string,
    commitMessage: string,
  ): Promise<WorktreeSyncResult>
  /** Inspect whether a reusable worktree still has an active merge. */
  worktreeMergeState(worktreePath: string, baseBranch: string): Promise<WorktreeMergeState>
  /** Remove a worktree (and its branch ref). Safe to call on missing paths. */
  removeWorktree(repoRoot: string, worktreePath: string): Promise<void>
  /** Package dirty shared-checkout changes into a task branch commit. */
  checkpointDirtyWork(
    repoRoot: string,
    opts: CheckpointDirtyWorkOptions,
  ): Promise<CheckpointResult>
  /** Fast-forward merge `branch` into `baseBranch`. Non-ff → returned as `ok:false`. */
  fastForwardMerge(
    repoRoot: string,
    branch: string,
    baseBranch: string,
  ): Promise<MergeResult>
  /** Cherry-pick commits from `branch` onto `baseBranch` in commit order. */
  cherryPickBranch(
    repoRoot: string,
    branch: string,
    baseBranch: string,
  ): Promise<MergeResult>
  /** Push `branch` to `origin`. */
  push(repoRoot: string, branch: string): Promise<PushResult>
  /** Open a PR via `gh` CLI (or return `ok:false` with a graceful detail). */
  openPullRequest(
    repoRoot: string,
    opts: { branch: string; baseBranch: string; title: string; body?: string },
  ): Promise<PullRequestResult>
}

// ---------------------------------------------------------------------------
// NodeGitDriver — real impl, shells out to `git` + `gh`.
// ---------------------------------------------------------------------------

export class NodeGitDriver implements GitDriver {
  async currentBranch(repoRoot: string): Promise<string> {
    const { stdout } = await execGit(['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: resolveRuntimePath(repoRoot),
    })
    return stdout.trim()
  }

  async isClean(repoRoot: string): Promise<boolean> {
    return (await this.statusSummary(repoRoot)).clean
  }

  async statusSummary(repoRoot: string): Promise<GitStatusSummary> {
    let gitRoot: string
    try {
      gitRoot = await resolveGitTopLevel(repoRoot)
    } catch (err) {
      if (!isNotGitRepositoryError(err)) throw err
      return {
        repository: false,
        ahead: 0,
        behind: 0,
        changedCount: 0,
        untrackedCount: 0,
        samplePaths: [],
        clean: true,
      }
    }
    const { stdout } = await execGit(['status', '--porcelain=v1', '-b'], {
      cwd: gitRoot,
    })
    const rawLines = stdout
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line) => line.trim().length > 0)
    const header = rawLines.find((line) => line.startsWith('## '))
    const parsedHeader = parseStatusHeader(header)
    const meaningful = rawLines.filter((line) => {
      if (line.startsWith('## ')) return false
      const file = line.slice(3).trim().replace(/^"|"$/g, '')
      return !isIgnorableGuildhallStatePath(file.replace(/\/$/, ''))
    })
    return {
      repository: true,
      branch: parsedHeader.branch,
      upstream: parsedHeader.upstream,
      ahead: parsedHeader.ahead,
      behind: parsedHeader.behind,
      changedCount: meaningful.filter((line) => !line.startsWith('??')).length,
      untrackedCount: meaningful.filter((line) => line.startsWith('??')).length,
      samplePaths: meaningful.map((line) => line.slice(3).trim().replace(/^"|"$/g, '')).slice(0, 10),
      clean: meaningful.length === 0,
    }
  }

  async localCommits(repoRoot: string, upstream: string): Promise<Array<{ sha: string; subject: string }>> {
    const gitRoot = await resolveGitTopLevel(repoRoot)
      const { stdout } = await execGit(['log', '--format=%H%x09%s', `${upstream}..HEAD`], {
      cwd: gitRoot,
    })
    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [sha = '', ...subjectParts] = line.split('\t')
        return { sha, subject: subjectParts.join('\t') }
      })
      .filter((commit) => commit.sha.length > 0)
  }

  async headSha(repoRoot: string): Promise<string> {
    const gitRoot = await resolveGitTopLevel(repoRoot)
    const { stdout } = await execGit(['rev-parse', 'HEAD'], { cwd: gitRoot })
    return stdout.trim()
  }

  async isAncestor(repoRoot: string, ancestorSha: string, descendantRef: string): Promise<boolean> {
    const gitRoot = await resolveGitTopLevel(repoRoot)
    try {
      await execGit(['merge-base', '--is-ancestor', ancestorSha, descendantRef], { cwd: gitRoot })
      return true
    } catch {
      return false
    }
  }

  async pullRequestForBranch(repoRoot: string, branch: string): Promise<PullRequestResult> {
    try {
      const gitRoot = await resolveGitTopLevel(repoRoot)
      const { stdout } = await execGh(['pr', 'view', branch, '--json', 'url,state,mergeStateStatus'],
        { cwd: gitRoot },
      )
      const parsed = JSON.parse(stdout) as { url?: string; state?: string; mergeStateStatus?: string }
      return {
        ok: Boolean(parsed.url),
        url: parsed.url,
        state: parsed.state,
        mergeStateStatus: parsed.mergeStateStatus,
      }
    } catch (err) {
      return {
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
      }
    }
  }

  async commitAll(repoRoot: string, message: string): Promise<CheckpointResult> {
    const gitRoot = await resolveGitTopLevel(repoRoot)
    const runCommit = async (): Promise<CheckpointResult> => {
      await execGit(['add', '-A'], { cwd: gitRoot })
      await execGit(['reset', '--quiet', 'HEAD', '--', '.guildhall', 'memory', 'guildhall.yaml'],
        { cwd: gitRoot },
      )
      let hasStagedChanges = true
      try {
        await execGit(['diff', '--cached', '--quiet'], { cwd: gitRoot })
        hasStagedChanges = false
      } catch {
        hasStagedChanges = true
      }
      if (!hasStagedChanges) return { ok: true }
      await execGit(['commit', '--no-verify', '-m', message], { cwd: gitRoot })
      const { stdout } = await execGit(['rev-parse', 'HEAD'], { cwd: gitRoot })
      return { ok: true, commitSha: stdout.trim() }
    }
    try {
      return await runCommit()
    } catch (err) {
      const detail = errorDetail(err)
      if (await pruneStaleGitIndexLockFromError(detail)) {
        try {
          const retry = await runCommit()
          return {
            ...retry,
            detail: retry.detail
              ? `${retry.detail}\nRecovered from stale git index lock and retried commit.`
              : 'Recovered from stale git index lock and retried commit.',
          }
        } catch (retryErr) {
          return { ok: false, detail: errorDetail(retryErr) }
        }
      }
      return { ok: false, detail }
    }
  }

  async createWorktree(
    repoRoot: string,
    { worktreePath, branch, baseBranch }: CreateWorktreeOptions,
  ): Promise<void> {
    const resolvedRepoRoot = resolveRuntimePath(repoRoot)
    const resolvedWorktreePath = resolveRuntimePath(worktreePath)
    if (await existingWorktreeMatchesBranch(resolvedWorktreePath, branch)) return
    await fs.mkdir(path.dirname(resolvedWorktreePath), { recursive: true })
    try {
      await execGit(['worktree', 'add', '-b', branch, resolvedWorktreePath, baseBranch],
        { cwd: resolvedRepoRoot },
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (!/already exists/i.test(message)) throw err
      if (await existingWorktreeMatchesBranch(resolvedWorktreePath, branch)) return
      await execGit(['worktree', 'add', resolvedWorktreePath, branch], {
        cwd: resolvedRepoRoot,
      })
    }
  }

  async attachWorktree(
    repoRoot: string,
    { worktreePath, branch }: AttachWorktreeOptions,
  ): Promise<void> {
    const resolvedRepoRoot = resolveRuntimePath(repoRoot)
    const resolvedWorktreePath = resolveRuntimePath(worktreePath)
    if (await existingWorktreeMatchesBranch(resolvedWorktreePath, branch)) return
    await fs.mkdir(path.dirname(resolvedWorktreePath), { recursive: true })
    await execGit(['worktree', 'add', resolvedWorktreePath, branch], {
      cwd: resolvedRepoRoot,
    })
  }

  async syncWorktreeWithBase(
    worktreePath: string,
    baseBranch: string,
    commitMessage: string,
  ): Promise<WorktreeSyncResult> {
    const resolvedWorktreePath = resolveRuntimePath(worktreePath)
    let checkpoint: CheckpointResult | undefined
    try {
      const status = await this.statusSummary(resolvedWorktreePath)
      if (!status.clean) {
        checkpoint = await this.commitAll(resolvedWorktreePath, commitMessage)
        if (!checkpoint.ok) return checkpoint
      }
      await execGit(['merge', '--no-edit', baseBranch], { cwd: resolvedWorktreePath })
      const { stdout } = await execGit(['rev-parse', 'HEAD'], { cwd: resolvedWorktreePath })
      return {
        ok: true,
        changed: Boolean(checkpoint?.commitSha),
        ...(checkpoint?.commitSha ? { commitSha: checkpoint.commitSha } : {}),
        ...(checkpoint?.detail ? { detail: checkpoint.detail } : {}),
        ...(stdout.trim() ? { detail: [checkpoint?.detail, `Synchronized with ${baseBranch} at ${stdout.trim()}.`].filter(Boolean).join(' ') } : {}),
      }
    } catch (err) {
      const detail = errorDetail(err)
      const conflict = /conflict|automatic merge failed|not something we can merge/i.test(detail)
      if (conflict) {
        const mergeState = await this.worktreeMergeState(resolvedWorktreePath, baseBranch).catch(() => ({
          mergeInProgress: true,
          conflictPaths: [],
          baseSha: null,
          headSha: null,
        }))
        // Leave the merge intact. Its exact conflict state is the canonical
        // recovery input for the worker; aborting would turn it into prose.
        return {
          ok: false,
          detail,
          conflict: true,
          conflictPaths: mergeState.conflictPaths,
          mergeInProgress: mergeState.mergeInProgress,
          baseSha: mergeState.baseSha,
          headSha: mergeState.headSha,
        }
      }
      try {
        await execGit(['merge', '--abort'], { cwd: resolvedWorktreePath })
      } catch {
        // Best effort: the original task branch remains the authority, but
        // the caller must still stop because the base was not synchronized.
      }
      return {
        ok: false,
        detail,
      }
    }
  }

  async worktreeMergeState(worktreePath: string, baseBranch: string): Promise<WorktreeMergeState> {
    const resolvedWorktreePath = resolveRuntimePath(worktreePath)
    const { stdout: conflictOutput } = await execGit(
      ['diff', '--name-only', '--diff-filter=U', '-z'],
      { cwd: resolvedWorktreePath },
    )
    let mergeInProgress = false
    try {
      await execGit(['rev-parse', '--verify', '--quiet', 'MERGE_HEAD'], {
        cwd: resolvedWorktreePath,
      })
      mergeInProgress = true
    } catch {
      // `MERGE_HEAD` is absent after the recovery commit finishes.
    }
    return {
      mergeInProgress,
      conflictPaths: conflictOutput.split('\0').filter(Boolean).sort(),
      baseSha: await gitRefSha(resolvedWorktreePath, baseBranch),
      headSha: await gitRefSha(resolvedWorktreePath, 'HEAD'),
    }
  }

  async removeWorktree(repoRoot: string, worktreePath: string): Promise<void> {
    const resolvedWorktreePath = resolveRuntimePath(worktreePath)
    if (!fsSync.existsSync(resolvedWorktreePath)) return
    await execGit(['worktree', 'remove', '--force', resolvedWorktreePath], {
      cwd: resolveRuntimePath(repoRoot),
    })
  }

  async checkpointDirtyWork(
    repoRoot: string,
    { branch, baseBranch, commitMessage }: CheckpointDirtyWorkOptions,
  ): Promise<CheckpointResult> {
    const gitRoot = await resolveGitTopLevel(repoRoot)
    let taskBranchCheckedOut = false
    let sharedChangesStashed = false
    let sharedChangesApplied = false
    try {
      let branchExists = false
      try {
        await execGit(['rev-parse', '--verify', branch], { cwd: gitRoot })
        branchExists = true
      } catch {
        branchExists = false
      }

      if (branchExists) {
        const { stdout: currentBranchOutput } = await execGit(['branch', '--show-current'], { cwd: gitRoot })
        const currentBranch = currentBranchOutput.trim()
        // An existing task branch may contain an earlier checkpoint. Preserve
        // the shared checkout before switching to it; otherwise Git correctly
        // refuses to overwrite newer edits that differ from that checkpoint.
        if (currentBranch !== branch) {
          await execGit(
            ['stash', 'push', '--include-untracked', '--message', `Guildhall checkpoint for ${branch}`],
            { cwd: gitRoot },
          )
          sharedChangesStashed = true
        }
        await execGit(['checkout', branch], { cwd: gitRoot })
      } else {
        await execGit(['checkout', '-b', branch], { cwd: gitRoot })
      }
      taskBranchCheckedOut = true

      if (sharedChangesStashed) {
        const stashRef = 'stash@{0}'
        // Apply the shared checkout's final file state, not a three-way merge
        // against the older task branch. This is a checkpoint operation: the
        // current shared edits are authoritative and should not be rejected
        // merely because the reused branch has an earlier version of a file.
        const { stdout: changedTrackedOutput } = await execGit(
          ['diff', '--name-only', '-z', `${stashRef}^1`, stashRef, '--'],
          { cwd: gitRoot },
        )
        const changedTrackedPaths = changedTrackedOutput.split('\0').filter(Boolean)
        const { stdout: deletedTrackedOutput } = await execGit(
          ['diff', '--diff-filter=D', '--name-only', '-z', `${stashRef}^1`, stashRef, '--'],
          { cwd: gitRoot },
        )
        const deletedTrackedPaths = deletedTrackedOutput.split('\0').filter(Boolean)
        if (deletedTrackedPaths.length > 0) {
          await execGit(['rm', '-f', '--', ...deletedTrackedPaths], { cwd: gitRoot })
        }
        const restoredTrackedPaths = changedTrackedPaths.filter(pathname => !deletedTrackedPaths.includes(pathname))
        if (restoredTrackedPaths.length > 0) {
          await execGit(['checkout', stashRef, '--', ...restoredTrackedPaths], { cwd: gitRoot })
        }
        let hasUntrackedParent = false
        try {
          await execGit(['rev-parse', '--verify', `${stashRef}^3`], { cwd: gitRoot })
          const { stdout: untrackedPathsOutput } = await execGit(
            ['ls-tree', '-r', '--name-only', `${stashRef}^3`],
            { cwd: gitRoot },
          )
          const untrackedPaths = untrackedPathsOutput.split('\n').filter(Boolean)
          hasUntrackedParent = untrackedPaths.length > 0
          if (hasUntrackedParent) {
            await execGit(['checkout', `${stashRef}^3`, '--', ...untrackedPaths], { cwd: gitRoot })
          }
        } catch (err) {
          // Stashes without untracked files have no third parent.
          if (hasUntrackedParent) throw err
        }
        await execGit(['stash', 'drop', stashRef], { cwd: gitRoot })
        sharedChangesApplied = true
      }

      await execGit(['add', '-A'], { cwd: gitRoot })
      await execGit(['reset', '--quiet', 'HEAD', '--', '.guildhall', 'memory', 'guildhall.yaml'],
        { cwd: gitRoot },
      )
      let hasStagedChanges = true
      try {
        await execGit(['diff', '--cached', '--quiet'], { cwd: gitRoot })
        hasStagedChanges = false
      } catch {
        hasStagedChanges = true
      }
      if (!hasStagedChanges) {
        await execGit(['checkout', baseBranch], { cwd: gitRoot })
        return { ok: true }
      }
      await execGit(['commit', '--no-verify', '-m', commitMessage], {
        cwd: gitRoot,
      })
      const { stdout } = await execGit(['rev-parse', 'HEAD'], {
        cwd: gitRoot,
      })
      await execGit(['checkout', baseBranch], { cwd: gitRoot })
      return { ok: true, commitSha: stdout.trim() }
    } catch (err) {
      // If applying the stash or committing the task branch failed, leave the
      // shared edits recoverable in a stash before returning to the landing
      // branch. Never turn a failed checkpoint into data loss.
      if (taskBranchCheckedOut && sharedChangesApplied) {
        try {
          await execGit(
            ['stash', 'push', '--include-untracked', '--message', `Guildhall failed checkpoint for ${branch}`],
            { cwd: gitRoot },
          )
        } catch {
          // The original error remains authoritative; checkout below is best effort.
        }
      }
      try {
        await execGit(['checkout', baseBranch], { cwd: gitRoot })
      } catch {
        // Best-effort recovery only.
      }
      return {
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
      }
    }
  }

  async fastForwardMerge(
    repoRoot: string,
    branch: string,
    baseBranch: string,
  ): Promise<MergeResult> {
    const gitRoot = await resolveGitTopLevel(repoRoot)
    try {
      await execGit(['checkout', baseBranch], { cwd: gitRoot })
      await execGit(['merge', '--ff-only', branch], { cwd: gitRoot })
      const { stdout } = await execGit(['rev-parse', 'HEAD'], {
        cwd: gitRoot,
      })
      return { ok: true, commitSha: stdout.trim() }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const conflict = /not possible to fast-forward|conflict/i.test(message)
      return { ok: false, detail: message, conflict }
    }
  }

  async cherryPickBranch(
    repoRoot: string,
    branch: string,
    baseBranch: string,
  ): Promise<MergeResult> {
    const gitRoot = await resolveGitTopLevel(repoRoot)
    try {
      await execGit(['checkout', baseBranch], { cwd: gitRoot })
      const { stdout } = await execGit(['rev-list', '--reverse', `${baseBranch}..${branch}`],
        { cwd: gitRoot },
      )
      const commits = stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
      if (commits.length === 0) {
        const { stdout: head } = await execGit(['rev-parse', 'HEAD'], {
          cwd: gitRoot,
        })
        return { ok: true, commitSha: head.trim() }
      }

      const { stdout: changedStdout } = await execGit(['diff', '--name-only', '-z', `${baseBranch}..${branch}`],
        { cwd: gitRoot, maxBuffer: 10 * 1024 * 1024 },
      )
      const candidatePaths = changedStdout
        .split('\0')
        .map((file) => file.trim())
        .filter(Boolean)
        .filter((file) => !isIgnorableGuildhallStatePath(file.replace(/\/$/, '')))
      const meaningfulPaths: string[] = []
      for (const file of candidatePaths) {
        if (!await workingPathMatchesBranchTarget(gitRoot, branch, file)) {
          meaningfulPaths.push(file)
        }
      }

      if (meaningfulPaths.length > 0) {
        const diffArgs = ['diff', '--binary', `${baseBranch}..${branch}`, '--', ...meaningfulPaths]
        const { stdout: patch } = await execGit(diffArgs, {
          cwd: gitRoot,
          maxBuffer: 50 * 1024 * 1024,
        })
        const patchPath = path.join(gitRoot, '.git', 'guildhall-cherry-pick.patch')
        await fs.writeFile(patchPath, patch, 'utf8')
        try {
          await execGit(['apply', '--check', patchPath], { cwd: gitRoot })
          await execGit(['apply', '--index', patchPath], { cwd: gitRoot })
        } finally {
          await fs.rm(patchPath, { force: true })
        }
        await execGit(['commit', '--no-verify', '-m', `Guildhall: land ${branch}`],
          { cwd: gitRoot },
        )
      }
      const { stdout: head } = await execGit(['rev-parse', 'HEAD'], {
        cwd: gitRoot,
      })
      return { ok: true, commitSha: head.trim() }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const conflict = /cherry-pick failed|after resolving the conflicts|conflict/i.test(message)
      return { ok: false, detail: message, conflict }
    }
  }

  async push(repoRoot: string, branch: string): Promise<PushResult> {
    try {
      await execGit(['push', 'origin', branch], { cwd: resolveRuntimePath(repoRoot) })
      return { ok: true }
    } catch (err) {
      return {
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
      }
    }
  }

  async openPullRequest(
    repoRoot: string,
    opts: { branch: string; baseBranch: string; title: string; body?: string },
  ): Promise<PullRequestResult> {
    try {
      const args = [
        'pr',
        'create',
        '--head',
        opts.branch,
        '--base',
        opts.baseBranch,
        '--title',
        opts.title,
        '--body',
        opts.body ?? '',
      ]
      const { stdout } = await execGh(args, { cwd: resolveRuntimePath(repoRoot) })
      const urlLine = stdout.trim().split('\n').find((l) => l.startsWith('http'))
      return urlLine ? { ok: true, url: urlLine } : { ok: true }
    } catch (err) {
      return {
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
      }
    }
  }
}

async function existingWorktreeMatchesBranch(
  worktreePath: string,
  branch: string,
): Promise<boolean> {
  try {
    const stat = await fs.stat(worktreePath)
    if (!stat.isDirectory()) return false
    const { stdout } = await execGit(['branch', '--show-current'], {
      cwd: worktreePath,
    })
    return stdout.trim() === branch
  } catch {
    return false
  }
}

function parseStatusHeader(header: string | undefined): {
  branch?: string
  upstream?: string
  ahead: number
  behind: number
} {
  if (!header) return { ahead: 0, behind: 0 }
  const withoutPrefix = header.replace(/^##\s+/, '')
  const [branchPart, trackingPart = ''] = withoutPrefix.split('...')
  const branch = branchPart && branchPart !== 'HEAD (no branch)' ? branchPart : undefined
  if (!trackingPart) return { branch, ahead: 0, behind: 0 }
  const upstream = trackingPart.replace(/\s+\[.*\]$/, '').trim() || undefined
  const aheadMatch = trackingPart.match(/ahead\s+(\d+)/)
  const behindMatch = trackingPart.match(/behind\s+(\d+)/)
  return {
    branch,
    upstream,
    ahead: aheadMatch ? Number(aheadMatch[1]) : 0,
    behind: behindMatch ? Number(behindMatch[1]) : 0,
  }
}

// ---------------------------------------------------------------------------
// InMemoryGitDriver — for tests. Records every call, plus a few controllable
// failure knobs so merge/push behavior can be scripted per scenario.
// ---------------------------------------------------------------------------

export interface InMemoryGitDriverState {
  currentBranch: string
  statuses: Record<string, GitStatusSummary>
  localCommits: Record<string, Array<{ sha: string; subject: string }>>
  headShas: Record<string, string>
  ancestors: Record<string, boolean>
  pullRequests: Record<string, PullRequestResult>
  commits: Array<{ repoRoot: string; message: string; result: CheckpointResult }>
  createdWorktrees: CreateWorktreeOptions[]
  attachedWorktrees: AttachWorktreeOptions[]
  worktreeSyncs: Array<{ worktreePath: string; baseBranch: string; commitMessage: string; result: WorktreeSyncResult }>
  checkpoints: Array<CheckpointDirtyWorkOptions & { result: CheckpointResult }>
  removedWorktrees: string[]
  merges: { branch: string; baseBranch: string; result: MergeResult }[]
  cherryPicks: { branch: string; baseBranch: string; result: MergeResult }[]
  pushes: { branch: string; result: PushResult }[]
  prs: { branch: string; baseBranch: string; title: string; result: PullRequestResult }[]
}

export interface InMemoryGitDriverOptions {
  currentBranch?: string
  clean?: boolean
  /** If set, the next `fastForwardMerge` call returns this result then clears. */
  nextMergeResult?: MergeResult
  /** If set, the next `push` call returns this result then clears. */
  nextPushResult?: PushResult
  /** If set, the next `openPullRequest` call returns this result then clears. */
  nextPrResult?: PullRequestResult
  /** If set, the next task-worktree synchronization returns this result. */
  nextWorktreeSyncResult?: WorktreeSyncResult
  nextWorktreeMergeState?: WorktreeMergeState
}

export class InMemoryGitDriver implements GitDriver {
  readonly state: InMemoryGitDriverState
  private clean: boolean
  private nextMerge: MergeResult | undefined
  private nextPush: PushResult | undefined
  private nextPr: PullRequestResult | undefined
  private nextWorktreeSync: WorktreeSyncResult | undefined
  private nextWorktreeMerge: WorktreeMergeState | undefined

  constructor(opts: InMemoryGitDriverOptions = {}) {
    this.state = {
      currentBranch: opts.currentBranch ?? 'main',
      statuses: {},
      localCommits: {},
      headShas: {},
      ancestors: {},
      pullRequests: {},
      commits: [],
      createdWorktrees: [],
      attachedWorktrees: [],
      worktreeSyncs: [],
      checkpoints: [],
      removedWorktrees: [],
      merges: [],
      cherryPicks: [],
      pushes: [],
      prs: [],
    }
    this.clean = opts.clean ?? true
    this.nextMerge = opts.nextMergeResult
    this.nextPush = opts.nextPushResult
    this.nextPr = opts.nextPrResult
    this.nextWorktreeSync = opts.nextWorktreeSyncResult
    this.nextWorktreeMerge = opts.nextWorktreeMergeState
  }

  /** Seed the next merge outcome; clears after one call. */
  setNextMergeResult(r: MergeResult): void {
    this.nextMerge = r
  }
  setNextPushResult(r: PushResult): void {
    this.nextPush = r
  }
  setNextPrResult(r: PullRequestResult): void {
    this.nextPr = r
  }
  setNextWorktreeSyncResult(r: WorktreeSyncResult): void {
    this.nextWorktreeSync = r
  }
  setNextWorktreeMergeState(state: WorktreeMergeState): void {
    this.nextWorktreeMerge = state
  }
  setClean(clean: boolean): void {
    this.clean = clean
  }
  setStatusSummary(repoRoot: string, summary: Partial<GitStatusSummary>): void {
    this.state.statuses[repoRoot] = {
      ...(summary.repository === false ? { repository: false } : { repository: true }),
      branch: summary.branch ?? this.state.currentBranch,
      upstream: summary.upstream,
      ahead: summary.ahead ?? 0,
      behind: summary.behind ?? 0,
      changedCount: summary.changedCount ?? 0,
      untrackedCount: summary.untrackedCount ?? 0,
      samplePaths: summary.samplePaths ?? [],
      clean: summary.clean ?? ((summary.changedCount ?? 0) + (summary.untrackedCount ?? 0) === 0),
    }
  }
  setLocalCommits(repoRoot: string, commits: Array<{ sha: string; subject: string }>): void {
    this.state.localCommits[repoRoot] = commits
  }
  setHeadSha(repoRoot: string, sha: string): void {
    this.state.headShas[repoRoot] = sha
  }
  setAncestor(repoRoot: string, ancestorSha: string, descendantRef: string, value: boolean): void {
    this.state.ancestors[`${repoRoot}\0${ancestorSha}\0${descendantRef}`] = value
  }
  setPullRequest(repoRoot: string, result: PullRequestResult): void {
    this.state.pullRequests[repoRoot] = result
  }

  async currentBranch(_repoRoot: string): Promise<string> {
    return this.state.currentBranch
  }

  async isClean(_repoRoot: string): Promise<boolean> {
    return this.clean
  }

  async statusSummary(repoRoot: string): Promise<GitStatusSummary> {
    return this.state.statuses[repoRoot] ?? {
      repository: true,
      branch: this.state.currentBranch,
      upstream: 'origin/main',
      ahead: 0,
      behind: 0,
      changedCount: this.clean ? 0 : 1,
      untrackedCount: 0,
      samplePaths: this.clean ? [] : ['changed.ts'],
      clean: this.clean,
    }
  }

  async localCommits(repoRoot: string, _upstream: string): Promise<Array<{ sha: string; subject: string }>> {
    return this.state.localCommits[repoRoot] ?? []
  }

  async headSha(repoRoot: string): Promise<string> {
    return this.state.headShas[repoRoot] ?? 'HEAD'
  }

  async isAncestor(repoRoot: string, ancestorSha: string, descendantRef: string): Promise<boolean> {
    return this.state.ancestors[`${repoRoot}\0${ancestorSha}\0${descendantRef}`] ?? false
  }

  async pullRequestForBranch(repoRoot: string, _branch: string): Promise<PullRequestResult> {
    return this.state.pullRequests[repoRoot] ?? { ok: false }
  }

  async commitAll(repoRoot: string, message: string): Promise<CheckpointResult> {
    const result: CheckpointResult = {
      ok: true,
      commitSha: `commit-${this.state.commits.length + 1}`,
    }
    this.state.commits.push({ repoRoot, message, result })
    this.clean = true
    const existing = this.state.statuses[repoRoot]
    this.state.statuses[repoRoot] = {
      branch: existing?.branch ?? this.state.currentBranch,
      upstream: existing?.upstream,
      ahead: existing?.ahead ?? 1,
      behind: existing?.behind ?? 0,
      changedCount: 0,
      untrackedCount: 0,
      samplePaths: [],
      clean: true,
    }
    return result
  }

  async createWorktree(
    _repoRoot: string,
    opts: CreateWorktreeOptions,
  ): Promise<void> {
    this.state.createdWorktrees.push({ ...opts })
  }

  async attachWorktree(
    _repoRoot: string,
    opts: AttachWorktreeOptions,
  ): Promise<void> {
    this.state.attachedWorktrees.push({ ...opts })
  }

  async syncWorktreeWithBase(
    worktreePath: string,
    baseBranch: string,
    commitMessage: string,
  ): Promise<WorktreeSyncResult> {
    const result = this.nextWorktreeSync ?? { ok: true, changed: false }
    this.nextWorktreeSync = undefined
    this.state.worktreeSyncs.push({ worktreePath, baseBranch, commitMessage, result })
    return result
  }

  async worktreeMergeState(_worktreePath: string, _baseBranch: string): Promise<WorktreeMergeState> {
    return this.nextWorktreeMerge ?? {
      mergeInProgress: false,
      conflictPaths: [],
      baseSha: 'base',
      headSha: 'head',
    }
  }

  async removeWorktree(_repoRoot: string, worktreePath: string): Promise<void> {
    this.state.removedWorktrees.push(worktreePath)
  }

  async checkpointDirtyWork(
    _repoRoot: string,
    opts: CheckpointDirtyWorkOptions,
  ): Promise<CheckpointResult> {
    const result: CheckpointResult = {
      ok: true,
      commitSha: `checkpoint-${this.state.checkpoints.length + 1}`,
    }
    this.state.checkpoints.push({ ...opts, result })
    this.clean = true
    this.state.currentBranch = opts.baseBranch
    return result
  }

  async fastForwardMerge(
    _repoRoot: string,
    branch: string,
    baseBranch: string,
  ): Promise<MergeResult> {
    const result = this.nextMerge ?? {
      ok: true,
      commitSha: `inmem-${this.state.merges.length + 1}`,
    }
    this.nextMerge = undefined
    this.state.merges.push({ branch, baseBranch, result })
    return result
  }

  async cherryPickBranch(
    _repoRoot: string,
    branch: string,
    baseBranch: string,
  ): Promise<MergeResult> {
    const result =
      this.nextMerge ??
      ({
        ok: true,
        commitSha: `inmem-${this.state.cherryPicks.length + 1}`,
      } satisfies MergeResult)
    this.nextMerge = undefined
    this.state.cherryPicks.push({ branch, baseBranch, result })
    return result
  }

  async push(_repoRoot: string, branch: string): Promise<PushResult> {
    const result = this.nextPush ?? { ok: true }
    this.nextPush = undefined
    this.state.pushes.push({ branch, result })
    return result
  }

  async openPullRequest(
    _repoRoot: string,
    opts: { branch: string; baseBranch: string; title: string; body?: string },
  ): Promise<PullRequestResult> {
    const result = this.nextPr ?? {
      ok: true,
      url: `https://example.invalid/pr/${this.state.prs.length + 1}`,
    }
    this.nextPr = undefined
    this.state.prs.push({
      branch: opts.branch,
      baseBranch: opts.baseBranch,
      title: opts.title,
      result,
    })
    return result
  }
}
