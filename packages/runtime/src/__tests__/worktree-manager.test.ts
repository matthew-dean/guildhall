import { describe, it, expect } from 'vitest'
import type { Task } from '@guildhall/core'
import {
  computeBranchName,
  computeWorktreePath,
  ensureWorktreeForDispatch,
  cleanupWorktreeForTerminal,
  DEFAULT_WORKTREE_ROOT_SEGMENT,
  worktreeRootFor,
} from '../worktree-manager.js'
import { InMemoryGitDriver } from '../git-driver.js'

function task(overrides: Partial<Task> = {}): Task {
  const now = '2026-04-22T00:00:00.000Z'
  return {
    id: 'task-1',
    title: 'x',
    description: '',
    domain: 'core',
    projectPath: '/repo',
    status: 'ready',
    priority: 'normal',
    acceptanceCriteria: [],
    outOfScope: [],
    dependsOn: [],
    notes: [],
    gateResults: [],
    reviewVerdicts: [],
    escalations: [],
    agentIssues: [],
    revisionCount: 0,
    remediationAttempts: 0,
    origination: 'human',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

describe('computeBranchName / computeWorktreePath', () => {
  it('per_task uses stable names across revisions', () => {
    const t = task({ id: 'abc/123', revisionCount: 2 })
    expect(computeBranchName(t, 'per_task')).toBe('guildhall/task-abc_123')
    expect(computeWorktreePath('/repo', t, 'per_task')).toBe(
      `/repo/${DEFAULT_WORKTREE_ROOT_SEGMENT}/abc_123`,
    )
  })

  it('per_attempt suffixes with the revision counter', () => {
    const t = task({ id: 'abc', revisionCount: 3 })
    expect(computeBranchName(t, 'per_attempt')).toBe(
      'guildhall/task-abc/attempt-3',
    )
    expect(computeWorktreePath('/repo', t, 'per_attempt')).toBe(
      `/repo/${DEFAULT_WORKTREE_ROOT_SEGMENT}/abc/attempt-3`,
    )
  })

  it('worktreeRootFor joins under .guildhall/worktrees', () => {
    expect(worktreeRootFor('/some/project')).toBe(
      `/some/project/${DEFAULT_WORKTREE_ROOT_SEGMENT}`,
    )
  })
})

describe('ensureWorktreeForDispatch', () => {
  it("returns the project path and created:false when mode is 'none'", async () => {
    const driver = new InMemoryGitDriver()
    const r = await ensureWorktreeForDispatch({
      task: task(),
      mode: 'none',
      projectPath: '/repo',
      baseBranch: 'main',
      gitDriver: driver,
    })
    expect(r.worktreePath).toBe('/repo')
    expect(r.created).toBe(false)
    expect(driver.state.createdWorktrees).toHaveLength(0)
  })

  it('creates a fresh worktree on first dispatch (per_task)', async () => {
    const driver = new InMemoryGitDriver()
    const r = await ensureWorktreeForDispatch({
      task: task({ id: 'abc' }),
      mode: 'per_task',
      projectPath: '/repo',
      baseBranch: 'main',
      gitDriver: driver,
    })
    expect(r.created).toBe(true)
    expect(r.branchName).toBe('guildhall/task-abc')
    expect(r.baseBranch).toBe('main')
    expect(driver.state.createdWorktrees).toHaveLength(1)
  })

  it('reuses an existing worktree when task already owns the expected one', async () => {
    const driver = new InMemoryGitDriver()
    const seeded = task({
      id: 'abc',
      worktreePath: '/repo/.guildhall/worktrees/abc',
      branchName: 'guildhall/task-abc',
      baseBranch: 'main',
    })
    const r = await ensureWorktreeForDispatch({
      task: seeded,
      mode: 'per_task',
      projectPath: '/repo',
      baseBranch: 'main',
      gitDriver: driver,
    })
    expect(r.created).toBe(false)
    expect(driver.state.createdWorktrees).toHaveLength(0)
  })

  it('creates a new per_attempt worktree when revision bumps', async () => {
    const driver = new InMemoryGitDriver()
    const seeded = task({
      id: 'abc',
      revisionCount: 1,
      worktreePath: '/repo/.guildhall/worktrees/abc/attempt-0',
      branchName: 'guildhall/task-abc/attempt-0',
      baseBranch: 'main',
    })
    const r = await ensureWorktreeForDispatch({
      task: seeded,
      mode: 'per_attempt',
      projectPath: '/repo',
      baseBranch: 'main',
      gitDriver: driver,
    })
    expect(r.created).toBe(true)
    expect(r.branchName).toBe('guildhall/task-abc/attempt-1')
  })
})

describe('cleanupWorktreeForTerminal', () => {
  it("is a no-op when mode is 'none'", async () => {
    const driver = new InMemoryGitDriver()
    await cleanupWorktreeForTerminal({
      task: task({ worktreePath: '/repo/x' }),
      mode: 'none',
      projectPath: '/repo',
      gitDriver: driver,
    })
    expect(driver.state.removedWorktrees).toHaveLength(0)
  })

  it('preserves the worktree when preserveForPendingPr is true', async () => {
    const driver = new InMemoryGitDriver()
    await cleanupWorktreeForTerminal({
      task: task({ worktreePath: '/repo/x' }),
      mode: 'per_task',
      projectPath: '/repo',
      gitDriver: driver,
      preserveForPendingPr: true,
    })
    expect(driver.state.removedWorktrees).toHaveLength(0)
  })

  it('removes the worktree when mode is active and task owns one', async () => {
    const driver = new InMemoryGitDriver()
    await cleanupWorktreeForTerminal({
      task: task({ worktreePath: '/repo/x' }),
      mode: 'per_task',
      projectPath: '/repo',
      gitDriver: driver,
    })
    expect(driver.state.removedWorktrees).toEqual(['/repo/x'])
  })
})
