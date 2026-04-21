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

describe('POST /api/project/task/:id/approve-spec', () => {
  it('transitions an exploring task with a spec to spec_review and records the approvalNote', async () => {
    await seedTask('task-1', { status: 'exploring', spec: 'drafted spec body' })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request('http://localhost/api/project/task/task-1/approve-spec', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ approvalNote: 'Looks great, ship it' }),
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.ok).toBe(true)
    expect(body.status).toBe('spec_review')

    const raw = await fs.readFile(path.join(memoryDir, 'TASKS.json'), 'utf8')
    const q = JSON.parse(raw)
    expect(q.tasks[0].status).toBe('spec_review')
    expect(q.tasks[0].notes?.at(-1)?.content).toMatch(/ship it/i)
  })

  it('rejects approve-spec when the task has no drafted spec yet', async () => {
    await seedTask('task-1', { status: 'exploring' })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request('http://localhost/api/project/task/task-1/approve-spec', { method: 'POST' }),
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, any>
    expect(body.error).toMatch(/spec/i)
  })

  it('rejects approve-spec on a task that is not in exploring', async () => {
    await seedTask('task-1', { status: 'in_progress', spec: 'irrelevant' })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request('http://localhost/api/project/task/task-1/approve-spec', { method: 'POST' }),
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, any>
    expect(body.error).toMatch(/exploring/i)
  })
})

describe('POST /api/project/task/:id/resume', () => {
  it('appends a human follow-up message to the exploring transcript', async () => {
    await seedTask('task-1', { status: 'exploring' })
    // The transcript file is created on first append; resumeExploring does
    // the write, we just verify the end state.
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request('http://localhost/api/project/task/task-1/resume', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'One more requirement: respect DOM ordering.' }),
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.ok).toBe(true)
    const transcript = await fs.readFile(
      path.join(memoryDir, 'exploring', 'task-1.md'),
      'utf8',
    )
    expect(transcript).toMatch(/respect DOM ordering/)
  })

  it('rejects resume with neither a message nor an escalation resolution', async () => {
    await seedTask('task-1', { status: 'exploring' })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request('http://localhost/api/project/task/task-1/resume', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, any>
    expect(body.error).toMatch(/message|escalation/i)
  })

  it('rejects resume on an unknown task', async () => {
    await seedTask('task-1', { status: 'exploring' })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request('http://localhost/api/project/task/missing/resume', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'hi' }),
      }),
    )
    expect(res.status).toBe(400)
  })
})

describe('POST /api/project/task/:id/unshelve', () => {
  it('clears shelveReason and returns a shelved task to proposed', async () => {
    await seedTask('task-1', {
      status: 'shelved',
      shelveReason: {
        code: 'not_viable',
        detail: 'was shelved by a worker',
        rejectedBy: 'agent:worker-1',
        rejectedAt: new Date().toISOString(),
        source: 'worker_pre_rejection',
        policyApplied: true,
        requeueCount: 0,
      },
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request('http://localhost/api/project/task/task-1/unshelve', { method: 'POST' }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.ok).toBe(true)
    expect(body.status).toBe('proposed')

    const raw = await fs.readFile(path.join(memoryDir, 'TASKS.json'), 'utf8')
    const q = JSON.parse(raw)
    expect(q.tasks[0].status).toBe('proposed')
    expect(q.tasks[0].shelveReason).toBeUndefined()
    expect(q.tasks[0].notes?.at(-1)?.content).toMatch(/unshelved/i)
  })

  it('rejects unshelve on a non-shelved task', async () => {
    await seedTask('task-1', { status: 'in_progress' })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request('http://localhost/api/project/task/task-1/unshelve', { method: 'POST' }),
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, any>
    expect(body.error).toMatch(/not shelved/i)
  })
})

describe('POST /api/project/task/:id/resolve-escalation', () => {
  it('resolves an open escalation and unblocks the task', async () => {
    await seedTask('task-1', {
      status: 'blocked',
      blockReason: 'Escalation raised',
      escalations: [
        {
          id: 'esc-1',
          taskId: 'task-1',
          reason: 'scope_boundary',
          summary: 'Unclear if this should touch the auth layer',
          details: 'The proposed change crosses into the auth package',
          agentId: 'agent:worker-1',
          raisedAt: new Date().toISOString(),
        },
      ],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request('http://localhost/api/project/task/task-1/resolve-escalation', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          escalationId: 'esc-1',
          resolution: 'Proceed — auth layer is in scope',
          nextStatus: 'in_progress',
        }),
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.ok).toBe(true)

    const raw = await fs.readFile(path.join(memoryDir, 'TASKS.json'), 'utf8')
    const q = JSON.parse(raw)
    const task = q.tasks[0]
    expect(task.status).toBe('in_progress')
    expect(task.escalations[0].resolvedAt).toBeTruthy()
    expect(task.escalations[0].resolution).toMatch(/Proceed/)
    expect(task.blockReason).toBeUndefined()
  })

  it('requires both escalationId and resolution', async () => {
    await seedTask('task-1', { status: 'blocked' })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const resNoId = await app.fetch(
      new Request('http://localhost/api/project/task/task-1/resolve-escalation', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ resolution: 'fine' }),
      }),
    )
    expect(resNoId.status).toBe(400)

    const resNoReason = await app.fetch(
      new Request('http://localhost/api/project/task/task-1/resolve-escalation', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ escalationId: 'esc-1' }),
      }),
    )
    expect(resNoReason.status).toBe(400)
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
