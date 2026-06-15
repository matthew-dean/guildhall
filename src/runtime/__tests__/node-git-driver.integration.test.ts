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
      GIT_CONFIG_GLOBAL: '/dev/null',
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

  it('adopts an existing task branch instead of failing when the branch already exists', async () => {
    const driver = new NodeGitDriver()
    await git(repoRoot, ['checkout', '-q', '-b', 'guildhall/task-existing'])
    await fs.writeFile(path.join(repoRoot, 'feature.txt'), 'hello\n', 'utf8')
    await git(repoRoot, ['add', 'feature.txt'])
    await git(repoRoot, ['commit', '-q', '-m', 'checkpoint'])
    await git(repoRoot, ['checkout', '-q', 'main'])

    const worktreePath = path.join(repoRoot, '.guildhall', 'worktrees', 'existing')
    await driver.createWorktree(repoRoot, {
      worktreePath,
      branch: 'guildhall/task-existing',
      baseBranch: 'main',
    })

    const file = await fs.readFile(path.join(worktreePath, 'feature.txt'), 'utf8')
    expect(file).toBe('hello\n')
    const { stdout: list } = await git(repoRoot, ['worktree', 'list', '--porcelain'])
    expect(list).toContain(worktreePath)
    expect(list).toContain('branch refs/heads/guildhall/task-existing')
  })

  it('adopts an existing worktree path on the expected branch instead of failing', async () => {
    const driver = new NodeGitDriver()
    const worktreePath = path.join(repoRoot, '.guildhall', 'worktrees', 'already-there')
    await driver.createWorktree(repoRoot, {
      worktreePath,
      branch: 'guildhall/task-already-there',
      baseBranch: 'main',
    })

    await expect(
      driver.createWorktree(repoRoot, {
        worktreePath,
        branch: 'guildhall/task-already-there',
        baseBranch: 'main',
      }),
    ).resolves.toBeUndefined()

    const { stdout: branch } = await git(worktreePath, ['branch', '--show-current'])
    expect(branch.trim()).toBe('guildhall/task-already-there')
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

describe('NodeGitDriver.cherryPickBranch', () => {
  it('lands product files while ignoring Guildhall runtime state from the task branch', async () => {
    const driver = new NodeGitDriver()
    const worktreePath = path.join(repoRoot, '.guildhall', 'worktrees', 'landing')
    await driver.createWorktree(repoRoot, {
      worktreePath,
      branch: 'guildhall/task-landing',
      baseBranch: 'main',
    })

    await fs.mkdir(path.join(worktreePath, 'memory'), { recursive: true })
    await fs.writeFile(path.join(worktreePath, 'feature.txt'), 'accepted work\n', 'utf8')
    await fs.writeFile(path.join(worktreePath, 'guildhall.yaml'), 'name: task copy\n', 'utf8')
    await fs.writeFile(path.join(worktreePath, 'memory', 'TASKS.json'), '{"task":"branch"}\n', 'utf8')
    await git(worktreePath, ['add', 'feature.txt', 'guildhall.yaml', 'memory/TASKS.json'])
    await git(worktreePath, ['commit', '-q', '-m', 'task work'])

    await fs.mkdir(path.join(repoRoot, 'memory'), { recursive: true })
    await fs.writeFile(path.join(repoRoot, 'guildhall.yaml'), 'name: main runtime\n', 'utf8')
    await fs.writeFile(path.join(repoRoot, 'memory', 'TASKS.json'), '{"task":"main"}\n', 'utf8')

    const result = await driver.cherryPickBranch(repoRoot, 'guildhall/task-landing', 'main')

    expect(result.ok).toBe(true)
    await expect(fs.readFile(path.join(repoRoot, 'feature.txt'), 'utf8')).resolves.toBe('accepted work\n')
    await expect(fs.readFile(path.join(repoRoot, 'guildhall.yaml'), 'utf8')).resolves.toBe('name: main runtime\n')
    await expect(fs.readFile(path.join(repoRoot, 'memory', 'TASKS.json'), 'utf8')).resolves.toBe('{"task":"main"}\n')

    const { stdout: committedFiles } = await git(repoRoot, [
      'show',
      '--name-only',
      '--format=',
      'HEAD',
    ])
    expect(committedFiles).toContain('feature.txt')
    expect(committedFiles).not.toContain('guildhall.yaml')
    expect(committedFiles).not.toContain('memory/TASKS.json')
  })
})

describe('NodeGitDriver.checkpointDirtyWork', () => {
  it('packages product work without sweeping Guildhall runtime state into the task branch', async () => {
    const driver = new NodeGitDriver()
    await fs.mkdir(path.join(repoRoot, 'memory'), { recursive: true })
    await fs.writeFile(path.join(repoRoot, 'src.ts'), 'export const value = 1\n', 'utf8')
    await fs.writeFile(path.join(repoRoot, 'guildhall.yaml'), 'name: demo\n', 'utf8')
    await fs.writeFile(path.join(repoRoot, 'memory', 'TASKS.json'), '{"version":1,"tasks":[]}\n', 'utf8')

    const result = await driver.checkpointDirtyWork(repoRoot, {
      branch: 'guildhall/task-123',
      baseBranch: 'main',
      commitMessage: 'checkpoint',
    })

    expect(result.ok).toBe(true)
    expect(await driver.currentBranch(repoRoot)).toBe('main')

    const { stdout: branchFiles } = await git(repoRoot, [
      'show',
      '--name-only',
      '--format=',
      'guildhall/task-123',
    ])
    expect(branchFiles).toContain('src.ts')
    expect(branchFiles).not.toContain('memory/TASKS.json')
    expect(branchFiles).not.toContain('guildhall.yaml')

    const tasks = await fs.readFile(path.join(repoRoot, 'memory', 'TASKS.json'), 'utf8')
    const config = await fs.readFile(path.join(repoRoot, 'guildhall.yaml'), 'utf8')
    expect(tasks).toContain('"tasks":[]')
    expect(config).toContain('name: demo')
  })
})
