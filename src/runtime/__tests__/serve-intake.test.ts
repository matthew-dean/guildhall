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

describe('GET /api/project/source-note', () => {
  it('returns a project-scoped source note for in-app preview', async () => {
    await fs.mkdir(path.join(tmpDir, 'docs'), { recursive: true })
    await fs.writeFile(path.join(tmpDir, 'docs', 'PROJECT_STATE.md'), '# Project state\n\nKnown facts.')
    const { app } = buildServeApp({ projectPath: tmpDir })

    const res = await app.fetch(new Request(projectUrl('/api/project/source-note?path=docs%2FPROJECT_STATE.md')))

    expect(res.status).toBe(200)
    const body = await res.json() as { displayPath?: string; content?: string; truncated?: boolean }
    expect(body.displayPath).toBe('docs/PROJECT_STATE.md')
    expect(body.content).toContain('# Project state')
    expect(body.content).toContain('Known facts.')
    expect(body.truncated).toBe(false)
  })

  it('rejects source note paths outside the current project', async () => {
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-source-outside-'))
    try {
      const outsidePath = path.join(outsideDir, 'secret.md')
      await fs.writeFile(outsidePath, 'not part of this project')
      const { app } = buildServeApp({ projectPath: tmpDir })

      const url = projectUrl(`/api/project/source-note?path=${encodeURIComponent(outsidePath)}`)
      const res = await app.fetch(new Request(url))

      expect(res.status).toBe(403)
      const body = await res.json() as { error?: string }
      expect(body.error).toContain('inside the project')
    } finally {
      await fs.rm(outsideDir, { recursive: true, force: true })
    }
  })

  it('rejects source note symlinks that escape the current project', async () => {
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-source-symlink-'))
    try {
      const outsidePath = path.join(outsideDir, 'secret.md')
      await fs.writeFile(outsidePath, 'not part of this project')
      await fs.mkdir(path.join(tmpDir, 'docs'), { recursive: true })
      await fs.symlink(outsidePath, path.join(tmpDir, 'docs', 'linked-secret.md'))
      const { app } = buildServeApp({ projectPath: tmpDir })

      const res = await app.fetch(new Request(projectUrl('/api/project/source-note?path=docs%2Flinked-secret.md')))

      expect(res.status).toBe(403)
      const body = await res.json() as { error?: string }
      expect(body.error).toContain('inside the project')
    } finally {
      await fs.rm(outsideDir, { recursive: true, force: true })
    }
  })
})
