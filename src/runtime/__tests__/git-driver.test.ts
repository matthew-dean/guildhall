import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { NodeGitDriver, pruneStaleGitIndexLockFromError } from '../git-driver.js'

const execFileP = promisify(execFile)

let tmpDir: string
let repoRoot: string
let subdir: string

async function git(args: string[], cwd = repoRoot): Promise<string> {
  const { stdout } = await execFileP('git', args, { cwd })
  return stdout.trim()
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-git-driver-'))
  repoRoot = path.join(tmpDir, 'repo')
  subdir = path.join(repoRoot, 'frontend')
  await fs.mkdir(subdir, { recursive: true })
  try {
    await execFileP('git', ['init', '-b', 'main'], { cwd: repoRoot })
  } catch {
    await execFileP('git', ['init'], { cwd: repoRoot })
    await execFileP('git', ['checkout', '-b', 'main'], { cwd: repoRoot })
  }
  await execFileP('git', ['config', 'user.name', 'Guildhall Test'], { cwd: repoRoot })
  await execFileP('git', ['config', 'user.email', 'guildhall-test@example.com'], { cwd: repoRoot })
  await fs.writeFile(path.join(subdir, 'app.ts'), 'export const ready = true\n', 'utf8')
  await git(['add', '.'], repoRoot)
  await git(['commit', '--no-verify', '-m', 'init'], repoRoot)
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('NodeGitDriver', () => {
  it('prunes stale git index locks from git error output', async () => {
    const lockPath = path.join(repoRoot, '.git', 'worktrees', 'task-a', 'index.lock')
    await fs.mkdir(path.dirname(lockPath), { recursive: true })
    await fs.writeFile(lockPath, '', 'utf8')
    const staleTime = new Date(Date.now() - 60_000)
    await fs.utimes(lockPath, staleTime, staleTime)

    const pruned = await pruneStaleGitIndexLockFromError(
      `fatal: Unable to create '${lockPath}': File exists.`,
    )

    expect(pruned).toBe(true)
    await expect(fs.stat(lockPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('keeps fresh git index locks in place', async () => {
    const lockPath = path.join(repoRoot, '.git', 'worktrees', 'task-a', 'index.lock')
    await fs.mkdir(path.dirname(lockPath), { recursive: true })
    await fs.writeFile(lockPath, '', 'utf8')

    const pruned = await pruneStaleGitIndexLockFromError(
      `fatal: Unable to create '${lockPath}': File exists.`,
    )

    expect(pruned).toBe(false)
    await expect(fs.stat(lockPath)).resolves.toBeTruthy()
  })

  it('treats repo-root Guildhall state as ignorable when checking cleanliness from a subdirectory project path', async () => {
    const driver = new NodeGitDriver()
    await fs.mkdir(path.join(repoRoot, 'memory'), { recursive: true })
    await fs.mkdir(path.join(repoRoot, '.guildhall'), { recursive: true })
    await fs.writeFile(path.join(repoRoot, 'memory', 'TASKS.json'), '{"tasks":[]}\n', 'utf8')
    await fs.writeFile(path.join(repoRoot, 'guildhall.yaml'), 'workspace: test\n', 'utf8')

    await expect(driver.isClean(subdir)).resolves.toBe(true)
  })

  it('resolves git status from the nearest existing ancestor when a task path will be created by the worker', async () => {
    const driver = new NodeGitDriver()
    const futureTaskPath = path.join(subdir, 'server', 'api', 'stripe')

    await expect(driver.statusSummary(futureTaskPath)).resolves.toMatchObject({
      clean: true,
      branch: 'main',
    })
  })

  it('checkpoints real shared-checkout edits from a subdirectory project path without committing Guildhall state files', async () => {
    const driver = new NodeGitDriver()
    await fs.writeFile(path.join(subdir, 'app.ts'), 'export const ready = false\n', 'utf8')
    await fs.mkdir(path.join(repoRoot, 'memory'), { recursive: true })
    await fs.writeFile(path.join(repoRoot, 'memory', 'TASKS.json'), '{"tasks":[1]}\n', 'utf8')

    const result = await driver.checkpointDirtyWork(subdir, {
      branch: 'guildhall/task-a',
      baseBranch: 'main',
      commitMessage: 'checkpoint shared checkout work',
    })

    expect(result.ok).toBe(true)
    const committedFiles = await git(['show', '--name-only', '--pretty=format:', 'HEAD'], repoRoot)
    expect(committedFiles).toContain('frontend/app.ts')
    expect(committedFiles).not.toContain('memory/TASKS.json')
  })
})
