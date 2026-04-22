import { describe, it, expect } from 'vitest'
import { InMemoryGitDriver } from '../git-driver.js'

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
