import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  getProjectSystemStatePath,
  promoteProjectStateDatabaseAuthority,
  writeProjectStateDatabaseSnapshot,
} from '@guildhall/sessions'
import { migrateWorkDecompositionState } from '../work-decomposition-migration.js'

let root: string

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-work-decomposition-'))
  await fs.mkdir(path.join(root, '.guildhall'), { recursive: true })
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

async function writeTasks(queue: unknown): Promise<void> {
  const file = getProjectSystemStatePath(root, 'TASKS.json')
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, `${JSON.stringify(queue, null, 2)}\n`, 'utf8')
}

async function readTasks(): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(getProjectSystemStatePath(root, 'TASKS.json'), 'utf8')) as Record<string, unknown>
}

describe('work decomposition migration', () => {
  it('migrates materialized legacy split recommendations into execution action audit', async () => {
    await writeTasks({
      version: 1,
      lastUpdated: '2026-06-17T00:00:00.000Z',
      tasks: [
        {
          id: 'parent',
          title: 'Parent',
          hierarchy: { childIds: ['child-a'] },
          sizePlan: {
            action: 'split_required',
            recommendedChildren: [{ title: 'Child A', reason: 'Legacy child.', createdTaskId: 'child-a' }],
          },
        },
        { id: 'child-a', title: 'Child A', hierarchy: { parentId: 'parent' } },
      ],
    })

    const dryRun = await migrateWorkDecompositionState({
      projectRoot: root,
      apply: false,
      now: '2026-06-17T00:00:00.000Z',
    })
    expect(dryRun.changedTasks).toEqual(['parent', 'child-a'])
    expect(dryRun.createdActions).toEqual(['parent-decomposition-migration-applied'])

    const applied = await migrateWorkDecompositionState({
      projectRoot: root,
      apply: true,
      now: '2026-06-17T00:00:00.000Z',
    })
    expect(applied.backupPath).toContain('TASKS.before-0.11.0-execution-planning-decomposition.json')
    expect(applied.manifestPath).toBe(`${applied.backupPath}.manifest.json`)
    await expect(fs.readFile(applied.manifestPath!, 'utf8')).resolves.toContain('0.11.0/execution-planning-decomposition')

    const raw = await readTasks()
    expect(raw.executionPlanActions).toEqual([
      expect.objectContaining({
        id: 'parent-decomposition-migration-applied',
        type: 'split_work',
        targetWorkId: 'parent',
        status: 'applied',
        authority: 'execution_planning',
        createdChildIds: ['child-a'],
      }),
    ])
    const tasks = raw.tasks as Array<{ id: string; hierarchy?: { relation?: string } }>
    expect(tasks.find(task => task.id === 'parent')?.hierarchy?.relation).toBe('contains')
    expect(tasks.find(task => task.id === 'child-a')?.hierarchy?.relation).toBe('decomposes')
  })

  it('routes unmaterialized legacy recommendations to coordinator recovery, not owner input', async () => {
    await writeTasks({
      version: 1,
      lastUpdated: '2026-06-17T00:00:00.000Z',
      tasks: [
        {
          id: 'parent',
          title: 'Parent',
          sizePlan: {
            action: 'split_recommended',
            recommendedChildren: [{ title: 'Child A', reason: 'Legacy child.' }],
          },
        },
      ],
    })

    await migrateWorkDecompositionState({
      projectRoot: root,
      apply: true,
      now: '2026-06-17T00:00:00.000Z',
    })

    const raw = await readTasks()
    expect(raw.scopeAuthorityRequests).toBeUndefined()
    expect(raw.executionPlanActions).toEqual([
      expect.objectContaining({
        id: 'parent-decomposition-migration-failed',
        type: 'split_work',
        status: 'failed',
        authority: 'execution_planning',
        createdChildIds: [],
        failureReason: expect.stringContaining('coordinator must regenerate decomposition'),
      }),
    ])
  })

  it('does not inspect or apply legacy decomposition state after SQLite promotion', async () => {
    await writeTasks({ version: 1, lastUpdated: '2026-07-15T12:00:00.000Z', tasks: [{ id: 'legacy-task' }] })
    const tasksPath = getProjectSystemStatePath(root, 'TASKS.json')
    await writeProjectStateDatabaseSnapshot(tasksPath, {
      projectRoot: root,
      queue: {
        version: 1,
        lastUpdated: '2026-07-15T12:00:00.000Z',
        tasks: [{ id: 'canonical-task', title: 'Canonical task', status: 'ready' }],
      },
      summary: { projectId: 'decomposition-test', generatedAt: '2026-07-15T12:00:00.000Z' },
    })
    promoteProjectStateDatabaseAuthority(root)

    await expect(migrateWorkDecompositionState({ projectRoot: root, apply: false }))
      .resolves.toEqual({ changedTasks: [], createdActions: [], affectedPaths: [] })
    await expect(migrateWorkDecompositionState({ projectRoot: root, apply: true }))
      .rejects.toThrow(/SQLite already owns current project state/)
  })

  it('rejects malformed legacy queue data instead of treating it as empty', async () => {
    await writeTasks({ tasks: 'not-a-list' })

    await expect(migrateWorkDecompositionState({ projectRoot: root, apply: false }))
      .rejects.toThrow(/does not contain a task queue/)
  })
})
