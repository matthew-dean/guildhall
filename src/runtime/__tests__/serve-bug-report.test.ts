import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { bootstrapWorkspace } from '@guildhall/config'
import { TaskQueue } from '@guildhall/core'
import { buildServeApp } from '../serve.js'

// Integration tests for POST /api/project/bug-report — the dashboard's
// "report a bug" intake. A bug report is a human-filed `proposed` task, not
// an exploring one, so it jumps past the spec-agent conversation.

let tmpDir: string
let tasksPath: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-bug-'))
  bootstrapWorkspace(tmpDir, {
    name: 'Bug Test',
    coordinators: [
      {
        id: 'looma',
        name: 'UI Coordinator',
        domain: 'looma',
        path: 'packages/ui',
        mandate: '',
        concerns: [],
        autonomousDecisions: [],
        escalationTriggers: [],
      },
      {
        id: 'api',
        name: 'API Coordinator',
        domain: 'api',
        path: 'packages/server',
        mandate: '',
        concerns: [],
        autonomousDecisions: [],
        escalationTriggers: [],
      },
    ],
  })
  tasksPath = path.join(tmpDir, 'memory', 'TASKS.json')
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

async function readQueue(): Promise<TaskQueue> {
  const raw = await fs.readFile(tasksPath, 'utf-8')
  const parsed = JSON.parse(raw)
  if (Array.isArray(parsed)) {
    return { version: 1, lastUpdated: new Date().toISOString(), tasks: parsed }
  }
  return TaskQueue.parse(parsed)
}

describe('POST /api/project/bug-report', () => {
  it('creates a proposed task with priority=high and routes to the first coordinator by default', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request('http://localhost/api/project/bug-report', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Button crashes on hover',
        body: 'Clicking the ghost button throws a TypeError.',
      }),
    }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { taskId: string }
    expect(body.taskId).toBe('task-001')
    const queue = await readQueue()
    const task = queue.tasks[0]!
    expect(task.status).toBe('proposed')
    expect(task.priority).toBe('high')
    expect(task.title.startsWith('Bug: ')).toBe(true)
    expect(task.domain).toBe('looma') // first coordinator
  })

  it('routes by stack-trace top frame when no domain is given', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request('http://localhost/api/project/bug-report', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: '500 on login',
        body: 'The login endpoint returns 500.',
        stackTrace: 'Error: x\n    at foo (packages/server/src/auth.ts:42:3)',
      }),
    }))
    expect(res.status).toBe(200)
    const queue = await readQueue()
    expect(queue.tasks[0]!.domain).toBe('api')
  })

  it('respects an explicit domain override', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })
    await app.fetch(new Request('http://localhost/api/project/bug-report', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'A bug',
        body: 'details',
        domain: 'api',
        stackTrace: 'at packages/ui/foo.ts:1:1', // would route to looma, overridden
      }),
    }))
    const queue = await readQueue()
    expect(queue.tasks[0]!.domain).toBe('api')
  })

  it('rejects a report with no title', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request('http://localhost/api/project/bug-report', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'only body' }),
    }))
    expect(res.status).toBe(400)
  })

  it('rejects a report with no body', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request('http://localhost/api/project/bug-report', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'only title' }),
    }))
    expect(res.status).toBe(400)
  })

  it('rejects a report when the workspace has no coordinators', async () => {
    // Fresh workspace with zero coordinators.
    const emptyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-bug-empty-'))
    try {
      bootstrapWorkspace(emptyDir, { name: 'No Coords' })
      const { app } = buildServeApp({ projectPath: emptyDir })
      const res = await app.fetch(new Request('http://localhost/api/project/bug-report', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 't', body: 'b' }),
      }))
      expect(res.status).toBe(400)
      const j = (await res.json()) as { error: string }
      expect(j.error).toMatch(/no coordinators/i)
    } finally {
      await fs.rm(emptyDir, { recursive: true, force: true })
    }
  })
})
