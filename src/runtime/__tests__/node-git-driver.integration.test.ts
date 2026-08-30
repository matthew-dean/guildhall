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

describe('NodeGitDriver.syncWorktreeWithBase', () => {
  it('checkpoints reusable task edits and merges the current base branch', async () => {
    const driver = new NodeGitDriver()
    const worktreePath = path.join(repoRoot, '.guildhall', 'worktrees', 'sync')
    await driver.createWorktree(repoRoot, {
      worktreePath,
      branch: 'guildhall/task-sync',
      baseBranch: 'main',
    })

    await fs.writeFile(path.join(repoRoot, 'base-latest.txt'), 'base\n', 'utf-8')
    await git(repoRoot, ['add', 'base-latest.txt'])
    await git(repoRoot, ['commit', '-q', '-m', 'advance base'])
    await fs.writeFile(path.join(worktreePath, 'task-edit.txt'), 'task\n', 'utf-8')

    const result = await driver.syncWorktreeWithBase(
      worktreePath,
      'main',
      'Guildhall: checkpoint task work before synchronizing task-sync',
    )

    expect(result.ok).toBe(true)
    expect(result.changed).toBe(true)
    await expect(fs.readFile(path.join(worktreePath, 'base-latest.txt'), 'utf-8')).resolves.toBe('base\n')
    await expect(fs.readFile(path.join(worktreePath, 'task-edit.txt'), 'utf-8')).resolves.toBe('task\n')
  })

  it('fails closed on a synchronization conflict', async () => {
    const driver = new NodeGitDriver()
    const worktreePath = path.join(repoRoot, '.guildhall', 'worktrees', 'sync-conflict')
    await driver.createWorktree(repoRoot, {
      worktreePath,
      branch: 'guildhall/task-sync-conflict',
      baseBranch: 'main',
    })

    await fs.writeFile(path.join(repoRoot, 'README.md'), '# Main\n', 'utf-8')
    await git(repoRoot, ['add', 'README.md'])
    await git(repoRoot, ['commit', '-q', '-m', 'conflicting base change'])
    await fs.writeFile(path.join(worktreePath, 'README.md'), '# Task\n', 'utf-8')
    await git(worktreePath, ['add', 'README.md'])
    await git(worktreePath, ['commit', '-q', '-m', 'conflicting task change'])

    const result = await driver.syncWorktreeWithBase(
      worktreePath,
      'main',
      'Guildhall: checkpoint task work before synchronizing task-sync-conflict',
    )

    expect(result.ok).toBe(false)
    expect(result.conflict).toBe(true)
    expect(result.mergeInProgress).toBe(true)
    expect(result.conflictPaths).toEqual(['README.md'])
    await expect(driver.worktreeMergeState(worktreePath, 'main')).resolves.toMatchObject({
      mergeInProgress: true,
      conflictPaths: ['README.md'],
    })
  })

  it('retains a proof-task conflict for typed worker recovery instead of silently choosing a side', async () => {
    const driver = new NodeGitDriver()
    const worktreePath = path.join(repoRoot, '.guildhall', 'worktrees', 'proof-sync-conflict')
    await driver.createWorktree(repoRoot, {
      worktreePath,
      branch: 'guildhall/task-proof-sync-conflict',
      baseBranch: 'main',
    })

    await fs.writeFile(path.join(repoRoot, 'README.md'), '# Main\n', 'utf-8')
    await git(repoRoot, ['add', 'README.md'])
    await git(repoRoot, ['commit', '-q', '-m', 'proof base change'])
    await fs.writeFile(path.join(worktreePath, 'README.md'), '# Task proof\n', 'utf-8')
    await git(worktreePath, ['add', 'README.md'])
    await git(worktreePath, ['commit', '-q', '-m', 'proof task change'])

    const result = await driver.syncWorktreeWithBase(
      worktreePath,
      'main',
      'Guildhall: checkpoint proof task before synchronizing',
    )

    expect(result).toMatchObject({
      ok: false,
      conflict: true,
      mergeInProgress: true,
      conflictPaths: ['README.md'],
    })
    await expect(driver.worktreeMergeState(worktreePath, 'main')).resolves.toMatchObject({
      mergeInProgress: true,
      conflictPaths: ['README.md'],
    })
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

  it('sets an upstream when publishing a branch for the first time', async () => {
    const remoteRoot = path.join(repoRoot, 'origin.git')
    await git(repoRoot, ['init', '--bare', '-q', remoteRoot])
    await git(repoRoot, ['remote', 'add', 'origin', remoteRoot])
    await git(repoRoot, ['checkout', '-q', '-b', 'guildhall/task-publish'])
    await fs.writeFile(path.join(repoRoot, 'published.txt'), 'ready\n', 'utf8')
    await git(repoRoot, ['add', 'published.txt'])
    await git(repoRoot, ['commit', '-q', '-m', 'ready to publish'])

    const result = await new NodeGitDriver().push(repoRoot, 'guildhall/task-publish')

    expect(result).toEqual({ ok: true })
    expect((await git(repoRoot, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'])).stdout.trim())
      .toBe('origin/guildhall/task-publish')
  })
})

describe('NodeGitDriver.cherryPickBranch', () => {
  it('removes a stale index lock and retries the failed Git command before landing task work', async () => {
    const driver = new NodeGitDriver()
    const worktreePath = path.join(repoRoot, '.guildhall', 'worktrees', 'stale-index-lock')
    await driver.createWorktree(repoRoot, {
      worktreePath,
      branch: 'guildhall/task-stale-index-lock',
      baseBranch: 'main',
    })
    await fs.writeFile(path.join(worktreePath, 'landed.txt'), 'landed\n', 'utf8')
    await git(worktreePath, ['add', 'landed.txt'])
    await git(worktreePath, ['commit', '-q', '-m', 'task work'])

    const lockPath = path.join(repoRoot, '.git', 'index.lock')
    await fs.writeFile(lockPath, '', 'utf8')
    const staleAt = new Date(Date.now() - 60_000)
    await fs.utimes(lockPath, staleAt, staleAt)

    const result = await driver.cherryPickBranch(repoRoot, 'guildhall/task-stale-index-lock', 'main')

    expect(result.ok).toBe(true)
    await expect(fs.readFile(path.join(repoRoot, 'landed.txt'), 'utf8')).resolves.toBe('landed\n')
    await expect(fs.stat(lockPath)).rejects.toThrow()
  })

  it('lands the remaining task delta when owner checkout paths already match the branch target', async () => {
    const driver = new NodeGitDriver()
    await fs.writeFile(path.join(repoRoot, 'package-lock.json'), '{"lock":true}\n', 'utf8')
    await git(repoRoot, ['add', 'package-lock.json'])
    await git(repoRoot, ['commit', '-q', '-m', 'add lockfile'])

    const worktreePath = path.join(repoRoot, '.guildhall', 'worktrees', 'matching-owner-paths')
    await driver.createWorktree(repoRoot, {
      worktreePath,
      branch: 'guildhall/task-matching-owner-paths',
      baseBranch: 'main',
    })
    const fixturePath = path.join('fixtures', 'run.json')
    await fs.rm(path.join(worktreePath, 'package-lock.json'))
    await fs.mkdir(path.join(worktreePath, 'fixtures'), { recursive: true })
    await fs.writeFile(path.join(worktreePath, fixturePath), '{"ok":true}\n', 'utf8')
    await fs.writeFile(path.join(worktreePath, 'feature.txt'), 'land me\n', 'utf8')
    await git(worktreePath, ['add', '-A'])
    await git(worktreePath, ['commit', '-q', '-m', 'task work'])

    await fs.rm(path.join(repoRoot, 'package-lock.json'))
    await fs.mkdir(path.join(repoRoot, 'fixtures'), { recursive: true })
    await fs.writeFile(path.join(repoRoot, fixturePath), '{"ok":true}\n', 'utf8')

    const result = await driver.cherryPickBranch(
      repoRoot,
      'guildhall/task-matching-owner-paths',
      'main',
    )

    expect(result.ok).toBe(true)
    await expect(fs.readFile(path.join(repoRoot, 'feature.txt'), 'utf8')).resolves.toBe('land me\n')
    await expect(fs.readFile(path.join(repoRoot, fixturePath), 'utf8')).resolves.toBe('{"ok":true}\n')
    await expect(fs.stat(path.join(repoRoot, 'package-lock.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    const { stdout: status } = await git(repoRoot, ['status', '--short'])
    expect(status).toContain(' D package-lock.json')
    expect(status).toContain('?? fixtures/')
    const { stdout: committedFiles } = await git(repoRoot, ['show', '--name-only', '--format=', 'HEAD'])
    expect(committedFiles).toContain('feature.txt')
    expect(committedFiles).not.toContain('package-lock.json')
    expect(committedFiles).not.toContain(fixturePath)
  })

  it('does not land an executable-mode change already present in the owner checkout', async () => {
    const driver = new NodeGitDriver()
    const scriptPath = path.join(repoRoot, 'release.sh')
    await fs.writeFile(scriptPath, '#!/bin/sh\necho base\n', 'utf8')
    await git(repoRoot, ['add', 'release.sh'])
    await git(repoRoot, ['commit', '-q', '-m', 'add release script'])

    const worktreePath = path.join(repoRoot, '.guildhall', 'worktrees', 'matching-owner-mode')
    await driver.createWorktree(repoRoot, {
      worktreePath,
      branch: 'guildhall/task-matching-owner-mode',
      baseBranch: 'main',
    })
    await fs.chmod(path.join(worktreePath, 'release.sh'), 0o755)
    await fs.writeFile(path.join(worktreePath, 'feature.txt'), 'land me\n', 'utf8')
    await git(worktreePath, ['add', 'release.sh', 'feature.txt'])
    await git(worktreePath, ['commit', '-q', '-m', 'task work'])

    await fs.chmod(scriptPath, 0o755)
    const result = await driver.cherryPickBranch(
      repoRoot,
      'guildhall/task-matching-owner-mode',
      'main',
    )

    expect(result.ok).toBe(true)
    const { stdout: committedFiles } = await git(repoRoot, ['show', '--name-only', '--format=', 'HEAD'])
    expect(committedFiles).toContain('feature.txt')
    expect(committedFiles).not.toContain('release.sh')
    expect((await fs.stat(scriptPath)).mode & 0o100).toBe(0o100)
  })

  it('lands an executable-mode change when the owner checkout has only a group execute bit', async () => {
    const driver = new NodeGitDriver()
    const scriptPath = path.join(repoRoot, 'release.sh')
    await fs.writeFile(scriptPath, '#!/bin/sh\necho base\n', 'utf8')
    await git(repoRoot, ['add', 'release.sh'])
    await git(repoRoot, ['commit', '-q', '-m', 'add release script'])

    const worktreePath = path.join(repoRoot, '.guildhall', 'worktrees', 'owner-mode-mismatch')
    await driver.createWorktree(repoRoot, {
      worktreePath,
      branch: 'guildhall/task-owner-mode-mismatch',
      baseBranch: 'main',
    })
    await fs.chmod(path.join(worktreePath, 'release.sh'), 0o755)
    await git(worktreePath, ['add', 'release.sh'])
    await git(worktreePath, ['commit', '-q', '-m', 'make script executable'])

    await fs.chmod(scriptPath, 0o654)
    const result = await driver.cherryPickBranch(
      repoRoot,
      'guildhall/task-owner-mode-mismatch',
      'main',
    )

    expect(result.ok).toBe(true)
    const { stdout: committedFiles } = await git(repoRoot, ['show', '--name-only', '--format=', 'HEAD'])
    expect(committedFiles).toContain('release.sh')
    expect((await fs.stat(scriptPath)).mode & 0o100).toBe(0o100)
  })

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

  it('preserves leading and trailing whitespace in NUL-delimited Git paths', async () => {
    const driver = new NodeGitDriver()
    const worktreePath = path.join(repoRoot, '.guildhall', 'worktrees', 'whitespace-path')
    await driver.createWorktree(repoRoot, {
      worktreePath,
      branch: 'guildhall/task-whitespace-path',
      baseBranch: 'main',
    })
    const unusualPath = ' leading-and-trailing.txt '
    await fs.writeFile(path.join(worktreePath, unusualPath), 'preserve exact path\n', 'utf8')
    await git(worktreePath, ['add', unusualPath])
    await git(worktreePath, ['commit', '-q', '-m', 'add exact whitespace path'])

    const result = await driver.cherryPickBranch(repoRoot, 'guildhall/task-whitespace-path', 'main')

    expect(result.ok).toBe(true)
    await expect(fs.readFile(path.join(repoRoot, unusualPath), 'utf8')).resolves.toBe('preserve exact path\n')
    const { stdout: committedFiles } = await git(repoRoot, ['show', '--name-only', '--format=', 'HEAD'])
    expect(committedFiles).toContain(unusualPath)
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

  it('preserves newer shared-checkout edits when reusing an existing task branch', async () => {
    const driver = new NodeGitDriver()
    const sourcePath = path.join(repoRoot, 'src.ts')
    await fs.writeFile(sourcePath, 'export const value = 0\n', 'utf8')
    await git(repoRoot, ['add', 'src.ts'])
    await git(repoRoot, ['commit', '-q', '-m', 'add source'])

    await fs.writeFile(sourcePath, 'export const value = 1\n', 'utf8')
    const first = await driver.checkpointDirtyWork(repoRoot, {
      branch: 'guildhall/task-reused',
      baseBranch: 'main',
      commitMessage: 'first checkpoint',
    })
    expect(first.ok).toBe(true)

    await fs.writeFile(sourcePath, 'export const value = 2\n', 'utf8')
    const second = await driver.checkpointDirtyWork(repoRoot, {
      branch: 'guildhall/task-reused',
      baseBranch: 'main',
      commitMessage: 'second checkpoint',
    })

    expect(second.ok).toBe(true)
    expect(await driver.currentBranch(repoRoot)).toBe('main')
    const { stdout: taskBranchSource } = await git(repoRoot, ['show', 'guildhall/task-reused:src.ts'])
    expect(taskBranchSource.trim()).toBe('export const value = 2')
    expect(await fs.readFile(sourcePath, 'utf8')).toBe('export const value = 0\n')
    await expect(driver.isClean(repoRoot)).resolves.toBe(true)
  })
})
