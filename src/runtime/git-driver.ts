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

const execFileP = promisify(execFile)

function isIgnorableGuildhallStatePath(file: string): boolean {
  return (
    file === 'guildhall.yaml' ||
    file === 'memory' ||
    file.startsWith('memory/') ||
    file === '.guildhall' ||
    file.startsWith('.guildhall/')
  )
}

async function resolveGitTopLevel(repoRoot: string): Promise<string> {
  const { stdout } = await execFileP('git', ['rev-parse', '--show-toplevel'], {
    cwd: repoRoot,
  })
  return stdout.trim() || repoRoot
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

export interface PushResult {
  ok: boolean
  detail?: string
}

export interface PullRequestResult {
  ok: boolean
  url?: string
  detail?: string
}

export interface CheckpointResult {
  ok: boolean
  commitSha?: string
  detail?: string
}

export interface GitDriver {
  /** Current branch name in the repo root (e.g. `main`, `master`). */
  currentBranch(repoRoot: string): Promise<string>
  /** True when the repo root has no uncommitted changes. */
  isClean(repoRoot: string): Promise<boolean>
  /** Create a new worktree at `worktreePath` with a fresh branch off `baseBranch`. */
  createWorktree(repoRoot: string, opts: CreateWorktreeOptions): Promise<void>
  /** Attach an existing branch to a worktree path. */
  attachWorktree(repoRoot: string, opts: AttachWorktreeOptions): Promise<void>
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
    const { stdout } = await execFileP('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: repoRoot,
    })
    return stdout.trim()
  }

  async isClean(repoRoot: string): Promise<boolean> {
    const gitRoot = await resolveGitTopLevel(repoRoot)
    const { stdout } = await execFileP('git', ['status', '--porcelain'], {
      cwd: gitRoot,
    })
    const lines = stdout
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line) => line.trim().length > 0)
    const meaningful = lines.filter((line) => {
      const file = line.slice(3).trim()
      return !isIgnorableGuildhallStatePath(file.replace(/\/$/, ''))
    })
    return meaningful.length === 0
  }

  async createWorktree(
    repoRoot: string,
    { worktreePath, branch, baseBranch }: CreateWorktreeOptions,
  ): Promise<void> {
    await fs.mkdir(path.dirname(worktreePath), { recursive: true })
    try {
      await execFileP(
        'git',
        ['worktree', 'add', '-b', branch, worktreePath, baseBranch],
        { cwd: repoRoot },
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (!/already exists/i.test(message)) throw err
      await execFileP('git', ['worktree', 'add', worktreePath, branch], {
        cwd: repoRoot,
      })
    }
  }

  async attachWorktree(
    repoRoot: string,
    { worktreePath, branch }: AttachWorktreeOptions,
  ): Promise<void> {
    await fs.mkdir(path.dirname(worktreePath), { recursive: true })
    await execFileP('git', ['worktree', 'add', worktreePath, branch], {
      cwd: repoRoot,
    })
  }

  async removeWorktree(repoRoot: string, worktreePath: string): Promise<void> {
    try {
      await execFileP('git', ['worktree', 'remove', '--force', worktreePath], {
        cwd: repoRoot,
      })
    } catch {
      // Already gone, or never created — either way, nothing to clean up.
    }
  }

  async checkpointDirtyWork(
    repoRoot: string,
    { branch, baseBranch, commitMessage }: CheckpointDirtyWorkOptions,
  ): Promise<CheckpointResult> {
    const gitRoot = await resolveGitTopLevel(repoRoot)
    try {
      let branchExists = false
      try {
        await execFileP('git', ['rev-parse', '--verify', branch], { cwd: gitRoot })
        branchExists = true
      } catch {
        branchExists = false
      }

      if (branchExists) {
        await execFileP('git', ['checkout', branch], { cwd: gitRoot })
      } else {
        await execFileP('git', ['checkout', '-b', branch], { cwd: gitRoot })
      }

      await execFileP('git', ['add', '-A'], { cwd: gitRoot })
      await execFileP(
        'git',
        ['reset', '--quiet', 'HEAD', '--', '.guildhall', 'memory', 'guildhall.yaml'],
        { cwd: gitRoot },
      )
      let hasStagedChanges = true
      try {
        await execFileP('git', ['diff', '--cached', '--quiet'], { cwd: gitRoot })
        hasStagedChanges = false
      } catch {
        hasStagedChanges = true
      }
      if (!hasStagedChanges) {
        await execFileP('git', ['checkout', baseBranch], { cwd: gitRoot })
        return { ok: true }
      }
      await execFileP('git', ['commit', '--no-verify', '-m', commitMessage], {
        cwd: gitRoot,
      })
      const { stdout } = await execFileP('git', ['rev-parse', 'HEAD'], {
        cwd: gitRoot,
      })
      await execFileP('git', ['checkout', baseBranch], { cwd: gitRoot })
      return { ok: true, commitSha: stdout.trim() }
    } catch (err) {
      try {
        await execFileP('git', ['checkout', baseBranch], { cwd: gitRoot })
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
    try {
      await execFileP('git', ['checkout', baseBranch], { cwd: repoRoot })
      await execFileP('git', ['merge', '--ff-only', branch], { cwd: repoRoot })
      const { stdout } = await execFileP('git', ['rev-parse', 'HEAD'], {
        cwd: repoRoot,
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
    try {
      await execFileP('git', ['checkout', baseBranch], { cwd: repoRoot })
      const { stdout } = await execFileP(
        'git',
        ['rev-list', '--reverse', `${baseBranch}..${branch}`],
        { cwd: repoRoot },
      )
      const commits = stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
      if (commits.length > 0) {
        await execFileP('git', ['cherry-pick', ...commits], { cwd: repoRoot })
      }
      const { stdout: head } = await execFileP('git', ['rev-parse', 'HEAD'], {
        cwd: repoRoot,
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
      await execFileP('git', ['push', 'origin', branch], { cwd: repoRoot })
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
      const { stdout } = await execFileP('gh', args, { cwd: repoRoot })
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

// ---------------------------------------------------------------------------
// InMemoryGitDriver — for tests. Records every call, plus a few controllable
// failure knobs so merge/push behavior can be scripted per scenario.
// ---------------------------------------------------------------------------

export interface InMemoryGitDriverState {
  currentBranch: string
  createdWorktrees: CreateWorktreeOptions[]
  attachedWorktrees: AttachWorktreeOptions[]
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
}

export class InMemoryGitDriver implements GitDriver {
  readonly state: InMemoryGitDriverState
  private clean: boolean
  private nextMerge: MergeResult | undefined
  private nextPush: PushResult | undefined
  private nextPr: PullRequestResult | undefined

  constructor(opts: InMemoryGitDriverOptions = {}) {
    this.state = {
      currentBranch: opts.currentBranch ?? 'main',
      createdWorktrees: [],
      attachedWorktrees: [],
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
  setClean(clean: boolean): void {
    this.clean = clean
  }

  async currentBranch(_repoRoot: string): Promise<string> {
    return this.state.currentBranch
  }

  async isClean(_repoRoot: string): Promise<boolean> {
    return this.clean
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
