/**
 * FR-24 / FR-25: real-git integration for NodeGitDriver.
 *
 * The InMemoryGitDriver unit tests cover contract shape; these tests cover
 * the shell-out path so a broken `git worktree add` or `git merge --ff-only`
 * argument set can't ship silently.
 *
 * Conventions:
 *   - Every test creates a throwaway repo under `os.tmpdir()` and cleans up.
 *   - Repos are seeded with `user.name` / `user.email` via `-c` so no global
 *     git config is required.
 *   - `push` / `openPullRequest` aren't exercised here — they need a real
 *     remote / `gh` auth. Their failure paths are covered in the unit tests.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { NodeGitDriver } from '../git-driver.js'

const execFileP = promisify(execFile)

async function git(
  repoRoot: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return await execFileP('git', args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.invalid',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.invalid',
    },
  })
}

/**
 * Spin up a fresh repo with a single commit on `main`. Returns the repo path.
 */
async function seedRepo(): Promise<string> {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-git-'))
  await git(repoRoot, ['init', '--initial-branch=main', '-q'])
  await git(repoRoot, ['config', 'user.name', 'Test'])
  await git(repoRoot, ['config', 'user.email', 'test@example.invalid'])
  await fs.writeFile(path.join(repoRoot, 'README.md'), '# Seed\n', 'utf-8')
  await git(repoRoot, ['add', 'README.md'])
  await git(repoRoot, ['commit', '-q', '-m', 'seed'])
  return repoRoot
}

let repoRoot: string

beforeEach(async () => {
  repoRoot = await seedRepo()
})

afterEach(async () => {
  await fs.rm(repoRoot, { recursive: true, force: true })
})

describe('NodeGitDriver.currentBranch', () => {
  it('returns the current branch name', async () => {
    const driver = new NodeGitDriver()
    expect(await driver.currentBranch(repoRoot)).toBe('main')
  })

  it('tracks a branch switch', async () => {
    await git(repoRoot, ['checkout', '-q', '-b', 'feature/x'])
    const driver = new NodeGitDriver()
    expect(await driver.currentBranch(repoRoot)).toBe('feature/x')
  })
})

describe('NodeGitDriver.createWorktree + removeWorktree', () => {
  it('creates a worktree at the requested path with a branch off baseBranch', async () => {
    const driver = new NodeGitDriver()
    const worktreePath = path.join(repoRoot, '.guildhall', 'worktrees', 't1')
    await driver.createWorktree(repoRoot, {
      worktreePath,
      branch: 'guildhall/task-t1',
      baseBranch: 'main',
    })

    // The worktree dir exists with the seed file checked out.
    const readme = await fs.readFile(path.join(worktreePath, 'README.md'), 'utf-8')
    expect(readme).toContain('Seed')

    // The branch is a real ref pointing at the same commit as main.
    const { stdout: list } = await git(repoRoot, ['worktree', 'list', '--porcelain'])
    expect(list).toContain(worktreePath)
    expect(list).toContain('branch refs/heads/guildhall/task-t1')
  })

  it('is idempotent on removeWorktree for missing paths', async () => {
    const driver = new NodeGitDriver()
    // Never created — removeWorktree must not throw.
    await expect(
      driver.removeWorktree(repoRoot, path.join(repoRoot, 'nope')),
    ).resolves.toBeUndefined()
  })

  it('removes a worktree it previously created', async () => {
    const driver = new NodeGitDriver()
    const worktreePath = path.join(repoRoot, '.guildhall', 'worktrees', 't2')
    await driver.createWorktree(repoRoot, {
      worktreePath,
      branch: 'guildhall/task-t2',
      baseBranch: 'main',
    })

    await driver.removeWorktree(repoRoot, worktreePath)
    await expect(fs.stat(worktreePath)).rejects.toThrow()
    const { stdout: list } = await git(repoRoot, ['worktree', 'list', '--porcelain'])
    expect(list).not.toContain(worktreePath)
  })
})

describe('NodeGitDriver.fastForwardMerge', () => {
  it('fast-forwards cleanly when the feature branch is ahead of base', async () => {
    const driver = new NodeGitDriver()
    const worktreePath = path.join(repoRoot, '.guildhall', 'worktrees', 'ff')
    await driver.createWorktree(repoRoot, {
      worktreePath,
      branch: 'ff-feature',
      baseBranch: 'main',
    })

    // Add a commit on the feature branch from inside the worktree.
    await fs.writeFile(path.join(worktreePath, 'feature.txt'), 'hello\n', 'utf-8')
    await git(worktreePath, ['add', 'feature.txt'])
    await git(worktreePath, ['commit', '-q', '-m', 'add feature'])

    const result = await driver.fastForwardMerge(repoRoot, 'ff-feature', 'main')
    expect(result.ok).toBe(true)
    expect(result.commitSha).toMatch(/^[0-9a-f]{40}$/)

    // main now contains feature.txt.
    const seeded = await fs.readFile(path.join(repoRoot, 'feature.txt'), 'utf-8')
    expect(seeded).toBe('hello\n')
  })

  it('returns ok:false with conflict=true when branches have diverged', async () => {
    const driver = new NodeGitDriver()
    const worktreePath = path.join(repoRoot, '.guildhall', 'worktrees', 'div')
    await driver.createWorktree(repoRoot, {
      worktreePath,
      branch: 'div-feature',
      baseBranch: 'main',
    })

    // Create divergence: commit on main AND on feature so ff is impossible.
    await fs.writeFile(path.join(repoRoot, 'main-only.txt'), 'm\n', 'utf-8')
    await git(repoRoot, ['add', 'main-only.txt'])
    await git(repoRoot, ['commit', '-q', '-m', 'main advance'])

    await fs.writeFile(path.join(worktreePath, 'feature.txt'), 'f\n', 'utf-8')
    await git(worktreePath, ['add', 'feature.txt'])
    await git(worktreePath, ['commit', '-q', '-m', 'feature advance'])

    const result = await driver.fastForwardMerge(repoRoot, 'div-feature', 'main')
    expect(result.ok).toBe(false)
    expect(result.conflict).toBe(true)
    expect(result.detail).toBeDefined()
  })
})

describe('NodeGitDriver.push', () => {
  it('returns ok:false with a detail when no origin remote is configured', async () => {
    const driver = new NodeGitDriver()
    const result = await driver.push(repoRoot, 'main')
    expect(result.ok).toBe(false)
    expect(result.detail).toBeDefined()
  })
})
