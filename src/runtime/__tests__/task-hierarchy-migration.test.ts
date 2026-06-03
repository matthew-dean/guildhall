import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { migrateTaskHierarchyState } from '../task-hierarchy-migration.js'

const now = '2026-06-01T12:00:00.000Z'

async function projectWithTasks(tasks: unknown[]) {
  const root = await mkdtemp(path.join(tmpdir(), 'guildhall-hierarchy-'))
  const state = path.join(root, '.guildhall')
  await writeFile(path.join(root, 'guildhall.yaml'), 'name: Demo\n')
  await mkdir(state, { recursive: true })
  await writeFile(path.join(state, 'TASKS.json'), JSON.stringify({ version: 1, lastUpdated: now, tasks }, null, 2))
  return root
}

describe('task hierarchy migration', () => {
  it('rewrites parent status and parentGoalId containment into explicit hierarchy links', async () => {
    const root = await projectWithTasks([
      taskRecord({ id: 'feature-shell', title: 'Feature shell', description: 'Container', status: 'parent', parentGoalId: 'goal-task-feature-shell' }),
      taskRecord({ id: 'child-a', title: 'Child A', description: 'Do A', status: 'ready', parentGoalId: 'goal-task-feature-shell' }),
      taskRecord({ id: 'child-b', title: 'Child B', description: 'Do B', status: 'blocked', parentGoalId: 'goal-task-feature-shell' }),
    ])

    const dryRun = await migrateTaskHierarchyState({ projectRoot: root, apply: false, now })
    expect(dryRun.changedTasks).toEqual(['feature-shell', 'child-a', 'child-b'])

    const applied = await migrateTaskHierarchyState({ projectRoot: root, apply: true, now })
    expect(applied.changedTasks).toEqual(['feature-shell', 'child-a', 'child-b'])
    expect(applied.backupPath).toBe(path.join(root, '.guildhall', 'TASKS.before-0.10.0-task-hierarchy-links.json'))

    const raw = JSON.parse(await readFile(path.join(root, '.guildhall', 'TASKS.json'), 'utf8'))
    const feature = raw.tasks.find((task: { id: string }) => task.id === 'feature-shell')
    const childA = raw.tasks.find((task: { id: string }) => task.id === 'child-a')
    const childB = raw.tasks.find((task: { id: string }) => task.id === 'child-b')

    expect(feature.status).toBe('ready')
    expect(feature.parentGoalId).toBeUndefined()
    expect(feature.hierarchy.childIds).toEqual(['child-a', 'child-b'])
    expect(feature.taskReadiness.recommendation).toBe('split')
    expect(feature.completionBoundary.requiredChildPolicy).toBe('all_required_done')
    expect(childA.parentGoalId).toBeUndefined()
    expect(childA.hierarchy.parentId).toBe('feature-shell')
    expect(childB.parentGoalId).toBeUndefined()
    expect(childB.hierarchy.parentId).toBe('feature-shell')
  })

  it('moves non-hierarchy parentGoalId into businessEnvelope.goalId', async () => {
    const root = await projectWithTasks([
      taskRecord({ id: 'task-a', parentGoalId: 'goal-platform-resilience' }),
    ])

    const applied = await migrateTaskHierarchyState({ projectRoot: root, apply: true, now })
    expect(applied.changedTasks).toEqual(['task-a'])

    const raw = JSON.parse(await readFile(path.join(root, '.guildhall', 'TASKS.json'), 'utf8'))
    expect(raw.tasks[0].parentGoalId).toBeUndefined()
    expect(raw.tasks[0].businessEnvelope.goalId).toBe('goal-platform-resilience')
  })

  it('is idempotent after the first apply', async () => {
    const root = await projectWithTasks([
      taskRecord({ id: 'feature-shell', title: 'Feature shell', description: 'Container', status: 'parent', parentGoalId: 'goal-task-feature-shell' }),
      taskRecord({ id: 'child-a', title: 'Child A', description: 'Do A', status: 'ready', parentGoalId: 'goal-task-feature-shell' }),
    ])
    await migrateTaskHierarchyState({ projectRoot: root, apply: true, now })
    const second = await migrateTaskHierarchyState({ projectRoot: root, apply: true, now })
    expect(second.changedTasks).toEqual([])
  })

  it('rejects explicit hierarchy cycles before writing', async () => {
    const root = await projectWithTasks([
      taskRecord({ id: 'a', hierarchy: { parentId: 'b', childIds: ['b'], order: 0 } }),
      taskRecord({ id: 'b', hierarchy: { parentId: 'a', childIds: ['a'], order: 0 } }),
    ])

    await expect(migrateTaskHierarchyState({ projectRoot: root, apply: true, now }))
      .rejects
      .toThrow(/cycle/i)
  })
})

function taskRecord(overrides: Record<string, unknown>) {
  return {
    id: 'task-1',
    title: 'Task',
    description: 'Task description.',
    domain: 'product',
    projectPath: '/repo/demo',
    status: 'ready',
    priority: 'normal',
    notes: [],
    dependsOn: [],
    ...overrides,
  }
}
