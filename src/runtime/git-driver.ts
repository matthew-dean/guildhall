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

export interface CreateWorktreeOptions {
  worktreePath: string
  branch: string
  baseBranch: string
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

export interface GitDriver {
  /** Current branch name in the repo root (e.g. `main`, `master`). */
  currentBranch(repoRoot: string): Promise<string>
  /** Create a new worktree at `worktreePath` with a fresh branch off `baseBranch`. */
  createWorktree(repoRoot: string, opts: CreateWorktreeOptions): Promise<void>
  /** Remove a worktree (and its branch ref). Safe to call on missing paths. */
  removeWorktree(repoRoot: string, worktreePath: string): Promise<void>
  /** Fast-forward merge `branch` into `baseBranch`. Non-ff → returned as `ok:false`. */
  fastForwardMerge(
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

  async createWorktree(
    repoRoot: string,
    { worktreePath, branch, baseBranch }: CreateWorktreeOptions,
  ): Promise<void> {
    await fs.mkdir(path.dirname(worktreePath), { recursive: true })
    await execFileP(
      'git',
      ['worktree', 'add', '-b', branch, worktreePath, baseBranch],
      { cwd: repoRoot },
    )
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
  removedWorktrees: string[]
  merges: { branch: string; baseBranch: string; result: MergeResult }[]
  pushes: { branch: string; result: PushResult }[]
  prs: { branch: string; baseBranch: string; title: string; result: PullRequestResult }[]
}

export interface InMemoryGitDriverOptions {
  currentBranch?: string
  /** If set, the next `fastForwardMerge` call returns this result then clears. */
  nextMergeResult?: MergeResult
  /** If set, the next `push` call returns this result then clears. */
  nextPushResult?: PushResult
  /** If set, the next `openPullRequest` call returns this result then clears. */
  nextPrResult?: PullRequestResult
}

export class InMemoryGitDriver implements GitDriver {
  readonly state: InMemoryGitDriverState
  private nextMerge: MergeResult | undefined
  private nextPush: PushResult | undefined
  private nextPr: PullRequestResult | undefined

  constructor(opts: InMemoryGitDriverOptions = {}) {
    this.state = {
      currentBranch: opts.currentBranch ?? 'main',
      createdWorktrees: [],
      removedWorktrees: [],
      merges: [],
      pushes: [],
      prs: [],
    }
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

  async currentBranch(_repoRoot: string): Promise<string> {
    return this.state.currentBranch
  }

  async createWorktree(
    _repoRoot: string,
    opts: CreateWorktreeOptions,
  ): Promise<void> {
    this.state.createdWorktrees.push({ ...opts })
  }

  async removeWorktree(_repoRoot: string, worktreePath: string): Promise<void> {
    this.state.removedWorktrees.push(worktreePath)
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
