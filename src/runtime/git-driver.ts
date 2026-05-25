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
import { resolveRuntimePath } from './path-utils.js'

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
    cwd: resolveRuntimePath(repoRoot),
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
  /** Read PR metadata for a branch, if the GitHub CLI can resolve one. */
  pullRequestForBranch(repoRoot: string, branch: string): Promise<PullRequestResult>
  /** Commit the current branch's dirty work without changing branches. */
  commitAll(repoRoot: string, message: string): Promise<CheckpointResult>
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
      cwd: resolveRuntimePath(repoRoot),
    })
    return stdout.trim()
  }

  async isClean(repoRoot: string): Promise<boolean> {
    return (await this.statusSummary(repoRoot)).clean
  }

  async statusSummary(repoRoot: string): Promise<GitStatusSummary> {
    const gitRoot = await resolveGitTopLevel(repoRoot)
    const { stdout } = await execFileP('git', ['status', '--porcelain=v1', '-b'], {
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
    const { stdout } = await execFileP('git', ['log', '--format=%H%x09%s', `${upstream}..HEAD`], {
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

  async pullRequestForBranch(repoRoot: string, branch: string): Promise<PullRequestResult> {
    try {
      const gitRoot = await resolveGitTopLevel(repoRoot)
      const { stdout } = await execFileP(
        'gh',
        ['pr', 'view', branch, '--json', 'url,state,mergeStateStatus'],
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
    try {
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
      if (!hasStagedChanges) return { ok: true }
      await execFileP('git', ['commit', '--no-verify', '-m', message], { cwd: gitRoot })
      const { stdout } = await execFileP('git', ['rev-parse', 'HEAD'], { cwd: gitRoot })
      return { ok: true, commitSha: stdout.trim() }
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : String(err) }
    }
  }

  async createWorktree(
    repoRoot: string,
    { worktreePath, branch, baseBranch }: CreateWorktreeOptions,
  ): Promise<void> {
    const resolvedRepoRoot = resolveRuntimePath(repoRoot)
    const resolvedWorktreePath = resolveRuntimePath(worktreePath)
    await fs.mkdir(path.dirname(resolvedWorktreePath), { recursive: true })
    try {
      await execFileP(
        'git',
        ['worktree', 'add', '-b', branch, resolvedWorktreePath, baseBranch],
        { cwd: resolvedRepoRoot },
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (!/already exists/i.test(message)) throw err
      await execFileP('git', ['worktree', 'add', resolvedWorktreePath, branch], {
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
    await fs.mkdir(path.dirname(resolvedWorktreePath), { recursive: true })
    await execFileP('git', ['worktree', 'add', resolvedWorktreePath, branch], {
      cwd: resolvedRepoRoot,
    })
  }

  async removeWorktree(repoRoot: string, worktreePath: string): Promise<void> {
    try {
      await execFileP('git', ['worktree', 'remove', '--force', resolveRuntimePath(worktreePath)], {
        cwd: resolveRuntimePath(repoRoot),
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
    const gitRoot = await resolveGitTopLevel(repoRoot)
    try {
      await execFileP('git', ['checkout', baseBranch], { cwd: gitRoot })
      await execFileP('git', ['merge', '--ff-only', branch], { cwd: gitRoot })
      const { stdout } = await execFileP('git', ['rev-parse', 'HEAD'], {
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
      await execFileP('git', ['checkout', baseBranch], { cwd: gitRoot })
      const { stdout } = await execFileP(
        'git',
        ['rev-list', '--reverse', `${baseBranch}..${branch}`],
        { cwd: gitRoot },
      )
      const commits = stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
      if (commits.length === 0) {
        const { stdout: head } = await execFileP('git', ['rev-parse', 'HEAD'], {
          cwd: gitRoot,
        })
        return { ok: true, commitSha: head.trim() }
      }

      const { stdout: changedStdout } = await execFileP(
        'git',
        ['diff', '--name-only', '-z', `${baseBranch}..${branch}`],
        { cwd: gitRoot, maxBuffer: 10 * 1024 * 1024 },
      )
      const meaningfulPaths = changedStdout
        .split('\0')
        .map((file) => file.trim())
        .filter(Boolean)
        .filter((file) => !isIgnorableGuildhallStatePath(file.replace(/\/$/, '')))

      if (meaningfulPaths.length > 0) {
        const diffArgs = ['diff', '--binary', `${baseBranch}..${branch}`, '--', ...meaningfulPaths]
        const { stdout: patch } = await execFileP('git', diffArgs, {
          cwd: gitRoot,
          maxBuffer: 50 * 1024 * 1024,
        })
        const patchPath = path.join(gitRoot, '.git', 'guildhall-cherry-pick.patch')
        await fs.writeFile(patchPath, patch, 'utf8')
        try {
          await execFileP('git', ['apply', '--check', patchPath], { cwd: gitRoot })
          await execFileP('git', ['apply', '--index', patchPath], { cwd: gitRoot })
        } finally {
          await fs.rm(patchPath, { force: true })
        }
        await execFileP(
          'git',
          ['commit', '--no-verify', '-m', `Guildhall: land ${branch}`],
          { cwd: gitRoot },
        )
      }
      const { stdout: head } = await execFileP('git', ['rev-parse', 'HEAD'], {
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
      await execFileP('git', ['push', 'origin', branch], { cwd: resolveRuntimePath(repoRoot) })
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
      const { stdout } = await execFileP('gh', args, { cwd: resolveRuntimePath(repoRoot) })
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
  pullRequests: Record<string, PullRequestResult>
  commits: Array<{ repoRoot: string; message: string; result: CheckpointResult }>
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
      statuses: {},
      localCommits: {},
      pullRequests: {},
      commits: [],
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
  setStatusSummary(repoRoot: string, summary: Partial<GitStatusSummary>): void {
    this.state.statuses[repoRoot] = {
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
