import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { bootstrapWorkspace } from '@guildhall/config'
import { buildServeApp } from '../serve.js'

// Integration tests for the v0.2 UI endpoints:
//   GET  /api/project/task/:id        — per-task detail powering the drawer
//   POST /api/project/task/:id/pause  — human override → blocked
//   POST /api/project/task/:id/shelve — human override → shelved
//   GET  /api/project/activity        — summary for the persistent chip

let tmpDir: string
let memoryDir: string

async function seedTask(id: string, overrides: Record<string, any> = {}): Promise<void> {
  const tasksPath = path.join(memoryDir, 'TASKS.json')
  const queue = {
    version: 1,
    lastUpdated: new Date().toISOString(),
    tasks: [
      {
        id,
        title: 'Seeded task for tests',
        description: 'A test task',
        domain: 'looma',
        projectPath: tmpDir,
        status: 'in_progress',
        priority: 'normal',
        revisionCount: 0,
        remediationAttempts: 0,
        origination: 'human',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...overrides,
      },
    ],
  }
  await fs.writeFile(tasksPath, JSON.stringify(queue, null, 2), 'utf8')
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-serve-tasks-'))
  bootstrapWorkspace(tmpDir, { name: 'Task Endpoints Test' })
  memoryDir = path.join(tmpDir, 'memory')
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('GET /api/project/task/:id', () => {
  it('returns the task body + (empty) recent events for a seeded task', async () => {
    await seedTask('task-1')
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request('http://localhost/api/project/task/task-1'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.task?.id).toBe('task-1')
    expect(body.task?.status).toBe('in_progress')
    expect(Array.isArray(body.recentEvents)).toBe(true)
  })

  it('returns 404 when task id is unknown', async () => {
    await seedTask('task-1')
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request('http://localhost/api/project/task/missing'))
    expect(res.status).toBe(404)
  })
})

describe('POST /api/project/task/:id/pause|shelve', () => {
  it('pause transitions the task to blocked with a blockReason and note', async () => {
    await seedTask('task-1')
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request('http://localhost/api/project/task/task-1/pause', { method: 'POST' }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.ok).toBe(true)
    expect(body.status).toBe('blocked')

    // Verify disk state.
    const raw = await fs.readFile(path.join(memoryDir, 'TASKS.json'), 'utf8')
    const q = JSON.parse(raw)
    expect(q.tasks[0].status).toBe('blocked')
    expect(q.tasks[0].blockReason).toMatch(/dashboard/i)
    expect(q.tasks[0].notes?.at(-1)?.agentId).toBe('system:human')
  })

  it('shelve transitions to shelved with a shelveReason record', async () => {
    await seedTask('task-1')
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request('http://localhost/api/project/task/task-1/shelve', { method: 'POST' }),
    )
    expect(res.status).toBe(200)
    const raw = await fs.readFile(path.join(memoryDir, 'TASKS.json'), 'utf8')
    const q = JSON.parse(raw)
    expect(q.tasks[0].status).toBe('shelved')
    expect(q.tasks[0].shelveReason?.rejectedBy).toBe('system:human')
  })

  it('rejects pause on a done task', async () => {
    await seedTask('task-1', { status: 'done' })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request('http://localhost/api/project/task/task-1/pause', { method: 'POST' }),
    )
    expect(res.status).toBe(400)
  })

  it('rejects unknown actions', async () => {
    await seedTask('task-1')
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request('http://localhost/api/project/task/task-1/nuke', { method: 'POST' }),
    )
    expect(res.status).toBe(400)
  })
})

describe('GET /api/project/activity', () => {
  it('summarizes counts and in-flight tasks', async () => {
    const tasksPath = path.join(memoryDir, 'TASKS.json')
    const now = new Date().toISOString()
    const queue = {
      version: 1,
      lastUpdated: now,
      tasks: [
        { id: 't1', title: 'One', description: '', domain: 'd', projectPath: tmpDir, status: 'in_progress', priority: 'normal', revisionCount: 0, remediationAttempts: 0, origination: 'human', createdAt: now, updatedAt: now },
        { id: 't2', title: 'Two', description: '', domain: 'd', projectPath: tmpDir, status: 'review', priority: 'normal', revisionCount: 0, remediationAttempts: 0, origination: 'human', createdAt: now, updatedAt: now },
        { id: 't3', title: 'Done one', description: '', domain: 'd', projectPath: tmpDir, status: 'done', priority: 'normal', revisionCount: 0, remediationAttempts: 0, origination: 'human', createdAt: now, updatedAt: now },
      ],
    }
    await fs.writeFile(tasksPath, JSON.stringify(queue, null, 2), 'utf8')

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request('http://localhost/api/project/activity'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.counts.in_progress).toBe(1)
    expect(body.counts.review).toBe(1)
    expect(body.counts.done).toBe(1)
    expect(body.inFlight).toHaveLength(2)
    expect(body.inFlight.map((t: any) => t.id).sort()).toEqual(['t1', 't2'])
  })

  it('returns empty summary when no tasks file exists yet', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request('http://localhost/api/project/activity'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.inFlight).toEqual([])
  })
})
