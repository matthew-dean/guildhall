import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  getProjectSystemStatePath,
  promoteProjectStateDatabaseAuthority,
  writeProjectStateDatabaseSnapshot,
} from '@guildhall/sessions'
import { migrateTaskDeliveryStepState } from '../task-delivery-step-migration.js'

let root: string

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-delivery-step-migration-'))
  await fs.mkdir(path.join(root, '.guildhall'), { recursive: true })
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

async function writeTasks(queue: unknown): Promise<string> {
  const file = getProjectSystemStatePath(root, 'TASKS.json')
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, `${JSON.stringify(queue, null, 2)}\n`, 'utf8')
  return file
}

describe('task delivery step migration', () => {
  it('marks verification children as internal delivery steps', async () => {
    await writeTasks({
      version: 1,
      lastUpdated: '2026-07-15T12:00:00.000Z',
      tasks: [
        { id: 'parent', title: 'Parent', status: 'ready', deliverySteps: [] },
        {
          id: 'child',
          title: 'Verify parent',
          status: 'ready',
          workKind: 'verification',
          hierarchy: { parentId: 'parent' },
        },
      ],
    })

    const result = await migrateTaskDeliveryStepState({ projectRoot: root, apply: true })
    expect(result.changedTasks).toEqual(['child', 'parent'])

    const raw = JSON.parse(await fs.readFile(getProjectSystemStatePath(root, 'TASKS.json'), 'utf8')) as any
    expect(raw.tasks.find((task: any) => task.id === 'child').workVisibility).toEqual({
      kind: 'internal_step',
      countInProjectTotals: false,
    })
    expect(raw.tasks.find((task: any) => task.id === 'parent').deliverySteps).toEqual([
      expect.objectContaining({ id: 'task:child', sourceTaskId: 'child', blocksCompletion: true }),
    ])
  })

  it('does not inspect or apply legacy delivery state after SQLite promotion', async () => {
    const tasksPath = await writeTasks({ version: 1, tasks: [{ id: 'legacy-task' }] })
    await writeProjectStateDatabaseSnapshot(tasksPath, {
      projectRoot: root,
      queue: {
        version: 1,
        lastUpdated: '2026-07-15T12:00:00.000Z',
        tasks: [{ id: 'canonical-task', title: 'Canonical task', status: 'ready' }],
      },
      summary: { projectId: 'delivery-test', generatedAt: '2026-07-15T12:00:00.000Z' },
    })
    promoteProjectStateDatabaseAuthority(root)

    await expect(migrateTaskDeliveryStepState({ projectRoot: root, apply: false }))
      .resolves.toEqual({ changedTasks: [], affectedPaths: [] })
    await expect(migrateTaskDeliveryStepState({ projectRoot: root, apply: true }))
      .rejects.toThrow(/SQLite already owns current project state/)
  })

  it('rejects malformed legacy queue data instead of treating it as empty', async () => {
    await writeTasks({ tasks: 'not-a-list' })

    await expect(migrateTaskDeliveryStepState({ projectRoot: root, apply: false }))
      .rejects.toThrow(/does not contain a task queue/)
  })
})
