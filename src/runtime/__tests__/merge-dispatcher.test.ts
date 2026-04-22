import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Task } from '@guildhall/core'
import { dispatchMerge, appendFixupTask } from '../merge-dispatcher.js'
import { InMemoryGitDriver } from '../git-driver.js'

let memoryDir: string

beforeEach(async () => {
  memoryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'merge-dispatch-'))
})

afterEach(async () => {
  await fs.rm(memoryDir, { recursive: true, force: true })
})

function task(overrides: Partial<Task> = {}): Task {
  const now = '2026-04-22T00:00:00.000Z'
  return {
    id: 'task-1',
    title: 'Add widget',
    description: 'd',
    domain: 'core',
    projectPath: '/repo',
    status: 'in_progress',
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
    branchName: 'guildhall/task-task-1',
    baseBranch: 'main',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

describe('dispatchMerge — ff_only_local', () => {
  it('fast-forward merges and marks newStatus=done', async () => {
    const driver = new InMemoryGitDriver()
    const r = await dispatchMerge({
      task: task(),
      policy: 'ff_only_local',
      projectPath: '/repo',
      memoryDir,
      gitDriver: driver,
      now: '2026-04-22T00:00:00.000Z',
    })
    expect(r.newStatus).toBe('done')
    expect(r.record.result).toBe('merged')
    expect(r.record.commitSha).toBe('inmem-1')
    expect(driver.state.merges).toHaveLength(1)
    expect(driver.state.pushes).toHaveLength(0)
  })

  it('emits a fixup task on conflict and blocks the original', async () => {
    const driver = new InMemoryGitDriver()
    driver.setNextMergeResult({ ok: false, conflict: true, detail: 'conflict in x.ts' })
    const r = await dispatchMerge({
      task: task({ id: 'parent', parentGoalId: 'goal-7' }),
      policy: 'ff_only_local',
      projectPath: '/repo',
      memoryDir,
      gitDriver: driver,
      now: '2026-04-22T00:00:00.000Z',
    })
    expect(r.newStatus).toBe('blocked')
    expect(r.record.result).toBe('conflict')
    expect(r.fixupTask).toBeDefined()
    expect(r.fixupTask!.status).toBe('ready')
    expect(r.fixupTask!.priority).toBe('high')
    expect(r.fixupTask!.dependsOn).toEqual(['parent'])
    expect(r.fixupTask!.parentGoalId).toBe('goal-7')
  })
})

describe('dispatchMerge — ff_only_with_push', () => {
  it('merges + pushes successfully and records result=pushed', async () => {
    const driver = new InMemoryGitDriver()
    const r = await dispatchMerge({
      task: task(),
      policy: 'ff_only_with_push',
      projectPath: '/repo',
      memoryDir,
      gitDriver: driver,
      now: '2026-04-22T00:00:00.000Z',
    })
    expect(r.newStatus).toBe('done')
    expect(r.record.result).toBe('pushed')
    expect(driver.state.pushes).toHaveLength(1)
  })

  it('degrades to local-only when push fails (FR-29)', async () => {
    const driver = new InMemoryGitDriver()
    driver.setNextPushResult({ ok: false, detail: 'network timeout' })
    const r = await dispatchMerge({
      task: task(),
      policy: 'ff_only_with_push',
      projectPath: '/repo',
      memoryDir,
      gitDriver: driver,
      now: '2026-04-22T00:00:00.000Z',
    })
    expect(r.newStatus).toBe('done')
    expect(r.record.result).toBe('push_failed_degraded')
    expect(r.degradedToLocal).toBe(true)
    // FR-29 side effect: local-only marker should now exist.
    const marker = path.join(memoryDir, 'local-only.json')
    const stat = await fs.stat(marker)
    expect(stat.isFile()).toBe(true)
  })
})

describe('dispatchMerge — manual_pr', () => {
  it('pushes and opens a PR; newStatus=pending_pr', async () => {
    const driver = new InMemoryGitDriver()
    const r = await dispatchMerge({
      task: task(),
      policy: 'manual_pr',
      projectPath: '/repo',
      memoryDir,
      gitDriver: driver,
      now: '2026-04-22T00:00:00.000Z',
    })
    expect(r.newStatus).toBe('pending_pr')
    expect(r.record.result).toBe('pending_pr')
    expect(r.record.prUrl).toBe('https://example.invalid/pr/1')
  })

  it('flags degradation when pre-PR push fails (but still marks pending_pr for retry)', async () => {
    const driver = new InMemoryGitDriver()
    driver.setNextPushResult({ ok: false, detail: 'offline' })
    const r = await dispatchMerge({
      task: task(),
      policy: 'manual_pr',
      projectPath: '/repo',
      memoryDir,
      gitDriver: driver,
      now: '2026-04-22T00:00:00.000Z',
    })
    expect(r.newStatus).toBe('pending_pr')
    expect(r.record.result).toBe('push_failed_degraded')
    expect(r.degradedToLocal).toBe(true)
    expect(driver.state.prs).toHaveLength(0)
  })
})

describe('dispatchMerge — defensive skips', () => {
  it('returns result=skipped when task has no branchName/baseBranch', async () => {
    const driver = new InMemoryGitDriver()
    const r = await dispatchMerge({
      task: task({ branchName: undefined, baseBranch: undefined }),
      policy: 'ff_only_local',
      projectPath: '/repo',
      memoryDir,
      gitDriver: driver,
      now: '2026-04-22T00:00:00.000Z',
    })
    expect(r.record.result).toBe('skipped')
    expect(r.newStatus).toBe('done')
  })
})

describe('appendFixupTask', () => {
  it('pushes the fixup onto the queue and bumps lastUpdated', () => {
    const queue = { version: 1 as const, lastUpdated: 'old', tasks: [] }
    const fixup = task({ id: 'fixup-1', priority: 'high' })
    const after = appendFixupTask(queue, fixup, 'new')
    expect(after.tasks).toHaveLength(1)
    expect(after.lastUpdated).toBe('new')
  })
})
