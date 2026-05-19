import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { bootstrapWorkspace } from '@guildhall/config'
import { TaskQueue } from '@guildhall/core'
import { buildServeApp } from '../serve.js'

let tmpDir: string
let tasksPath: string
let projectId: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-intake-'))
  projectId = bootstrapWorkspace(tmpDir, {
    name: 'Intake Test',
    coordinators: [
      {
        id: 'knit',
        name: 'Knit Coordinator',
        domain: 'knit',
        path: 'knit',
        mandate: '',
        concerns: [],
        autonomousDecisions: [],
        escalationTriggers: [],
      },
      {
        id: 'looma',
        name: 'Looma Coordinator',
        domain: 'looma',
        path: 'looma',
        mandate: '',
        concerns: [],
        autonomousDecisions: [],
        escalationTriggers: [],
      },
    ],
  }).id ?? path.basename(tmpDir)
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

function projectUrl(route: string): string {
  const url = new URL(`http://localhost${route}`)
  url.searchParams.set('projectId', projectId)
  return url.toString()
}

describe('POST /api/project/intake', () => {
  it('rejects empty intake asks before creating a task', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/intake'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ask: '   ' }),
    }))
    expect(res.status).toBe(400)
    const body = await res.json() as { error?: string }
    expect(body.error).toContain('Missing "ask"')

    const queue = await readQueue()
    expect(queue.tasks).toEqual([])
  })

  it('rejects intake when the project has no inferred coordinator domains yet', async () => {
    const bareDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-intake-bare-'))
    try {
      const bareProjectId = bootstrapWorkspace(bareDir, {
        name: 'Bare Intake',
        coordinators: [],
      }).id ?? path.basename(bareDir)
      const url = new URL('http://localhost/api/project/intake')
      url.searchParams.set('projectId', bareProjectId)

      const { app } = buildServeApp({ projectPath: bareDir })
      const res = await app.fetch(new Request(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ask: 'Add starter tasks' }),
      }))

      expect(res.status).toBe(400)
      const body = await res.json() as { error?: string }
      expect(body.error).toContain('run repo inspection first')
    } finally {
      await fs.rm(bareDir, { recursive: true, force: true })
    }
  })

  it('uses the matching coordinator subproject for the requested domain', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/intake'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ask: 'Finish the auth callback redirect',
        domain: 'knit',
      }),
    }))
    expect(res.status).toBe(200)
    const queue = await readQueue()
    expect(queue.tasks[0]?.domain).toBe('knit')
    expect(queue.tasks[0]?.projectPath).toBe(path.join(tmpDir, 'knit'))
  })

  it('falls back to the first coordinator and its subproject path when domain is omitted', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/intake'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ask: 'Do the next thing',
      }),
    }))
    expect(res.status).toBe(200)
    const queue = await readQueue()
    expect(queue.tasks[0]?.domain).toBe('knit')
    expect(queue.tasks[0]?.projectPath).toBe(path.join(tmpDir, 'knit'))
  })
})
