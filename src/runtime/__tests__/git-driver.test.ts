import { describe, it, expect } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { InMemoryGitDriver, NodeGitDriver } from '../git-driver.js'

const execFileP = promisify(execFile)

describe('InMemoryGitDriver', () => {
  it('records created worktrees and returns set currentBranch', async () => {
    const driver = new InMemoryGitDriver({ currentBranch: 'develop' })
    expect(await driver.currentBranch('/repo')).toBe('develop')
    await driver.createWorktree('/repo', {
      worktreePath: '/repo/.guildhall/worktrees/t1',
      branch: 'guildhall/task-t1',
      baseBranch: 'develop',
    })
    expect(driver.state.createdWorktrees).toHaveLength(1)
    expect(driver.state.createdWorktrees[0]).toMatchObject({
      worktreePath: '/repo/.guildhall/worktrees/t1',
      branch: 'guildhall/task-t1',
      baseBranch: 'develop',
    })
  })

  it('records removed worktrees', async () => {
    const driver = new InMemoryGitDriver()
    await driver.removeWorktree('/repo', '/repo/.guildhall/worktrees/t1')
    expect(driver.state.removedWorktrees).toEqual([
      '/repo/.guildhall/worktrees/t1',
    ])
  })

  it('defaults fastForwardMerge to ok:true with a synthetic commit sha', async () => {
    const driver = new InMemoryGitDriver()
    const r = await driver.fastForwardMerge('/repo', 'feature', 'main')
    expect(r.ok).toBe(true)
    expect(r.commitSha).toBe('inmem-1')
    expect(driver.state.merges).toHaveLength(1)
  })

  it('honors setNextMergeResult once, then returns to default', async () => {
    const driver = new InMemoryGitDriver()
    driver.setNextMergeResult({ ok: false, conflict: true, detail: 'boom' })
    const first = await driver.fastForwardMerge('/repo', 'f', 'm')
    expect(first).toMatchObject({ ok: false, conflict: true })
    const second = await driver.fastForwardMerge('/repo', 'f', 'm')
    expect(second.ok).toBe(true)
  })

  it('honors setNextPushResult and setNextPrResult', async () => {
    const driver = new InMemoryGitDriver()
    driver.setNextPushResult({ ok: false, detail: 'net down' })
    const p = await driver.push('/repo', 'feature')
    expect(p).toEqual({ ok: false, detail: 'net down' })

    driver.setNextPrResult({ ok: true, url: 'https://example.invalid/pr/42' })
    const pr = await driver.openPullRequest('/repo', {
      branch: 'feature',
      baseBranch: 'main',
      title: 't',
    })
    expect(pr).toEqual({ ok: true, url: 'https://example.invalid/pr/42' })
    expect(driver.state.prs).toHaveLength(1)
  })
})

describe('NodeGitDriver.isClean', () => {
  it('ignores untracked .guildhall runtime state when checking repo cleanliness', async () => {
    const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-git-driver-'))
    const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' }
    await execFileP('git', ['init'], { cwd: repo, env })
    await execFileP('git', ['config', 'user.email', 'codex@example.com'], { cwd: repo, env })
    await execFileP('git', ['config', 'user.name', 'Codex'], { cwd: repo, env })
    await fs.writeFile(path.join(repo, 'README.md'), 'hi\n')
    await execFileP('git', ['add', 'README.md'], { cwd: repo })
    await execFileP('git', ['commit', '-m', 'init'], { cwd: repo, env })
    await fs.mkdir(path.join(repo, '.guildhall', 'worktrees'), { recursive: true })
    await fs.writeFile(path.join(repo, '.guildhall', 'note.txt'), 'state\n')

    const driver = new NodeGitDriver()
    await expect(driver.isClean(repo)).resolves.toBe(true)

    await fs.writeFile(path.join(repo, 'real-change.txt'), 'nope\n')
    await expect(driver.isClean(repo)).resolves.toBe(false)
  })
})
