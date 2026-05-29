import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { bootstrapWorkspace } from '@guildhall/config'
import { TaskQueue } from '@guildhall/core'
import { getProjectStateDir } from '@guildhall/sessions'
import { buildServeApp } from '../serve.js'

let tmpDir: string
let dataDir: string
let tasksPath: string
let projectId: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-intake-'))
  dataDir = path.join(os.tmpdir(), `guildhall-data-${path.basename(tmpDir)}`)
  process.env.GUILDHALL_DATA_DIR = dataDir
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
  tasksPath = path.join(getProjectStateDir(tmpDir), 'TASKS.json')
})

afterEach(async () => {
  delete process.env.GUILDHALL_DATA_DIR
  await fs.rm(dataDir, { recursive: true, force: true })
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

describe('POST /api/project/request', () => {
  it('starts pressure-test intake for release ideas', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'README.md'),
      '# Intake Test\n\nGuildhall should turn rough owner intent into complete, verifiable work without offloading routine decisions.',
      'utf-8',
    )
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/request'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ask: 'For 0.8.0, pressure-test intake is my top priority.' }),
    }))

    expect(res.status).toBe(200)
    const body = await res.json() as {
      routedActions?: Array<{ kind?: string; intakeTarget?: { type?: string; pressureTestRequired?: boolean } }>
      pressureTestIntake?: {
        status?: string
        activeDomainId?: string
        pendingQuestion?: { evidence?: string[] }
      }
    }
    expect(body.routedActions?.[0]).toMatchObject({
      kind: 'pressure_test_intake',
      intakeTarget: { type: 'release', pressureTestRequired: true },
    })
    expect(body.pressureTestIntake).toMatchObject({
      status: 'active',
      activeDomainId: 'product-goals',
    })
    expect(body.pressureTestIntake?.pendingQuestion?.evidence?.some(evidence =>
      evidence.includes('README.md:') &&
      evidence.includes('rough owner intent') &&
      evidence.includes('verifiable work'),
    )).toBe(true)
  })

  it('preserves ordinary task intake behavior', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/request'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ask: 'Add a loading spinner to Providers.' }),
    }))

    expect(res.status).toBe(200)
    const body = await res.json() as {
      routedActions?: Array<{ kind?: string }>
      taskId?: string
    }
    expect(body.routedActions?.[0]?.kind).toBe('task_spec')
    expect(body.taskId).toMatch(/^task-/)
    const queue = await readQueue()
    expect(queue.tasks[0]?.request).toMatchObject({
      kind: 'task_spec',
      raw: 'Add a loading spinner to Providers.',
      routingSummary: 'Routed to Task Intake',
      pressureTestRequired: true,
    })
    expect(queue.tasks[0]?.requestIntake?.pressureTestSummary).toMatchObject({
      systemOwned: true,
      degree: 'automatic',
      qualityBar: expect.stringContaining('trustworthy'),
    })
    expect(queue.tasks[0]?.requestIntake?.pressureTestSummary?.checks.map(check => check.id)).toContain('verification')
    expect(queue.tasks[0]?.requestIntake?.pressureTestSummary?.checks.map(check => check.id)).toContain('review-lenses')
  })

  it('keeps project questions visible as routed project-question requests', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/request'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ask: 'What commands should I run before release?' }),
    }))

    expect(res.status).toBe(200)
    const body = await res.json() as {
      routedActions?: Array<{ kind?: string; safety?: string; intakeTarget?: { nextStep?: string } }>
      taskId?: string
    }
    expect(body.routedActions?.[0]).toMatchObject({
      kind: 'project_question',
      safety: 'read-only',
      intakeTarget: { nextStep: 'answer-question' },
    })
    expect(body.taskId).toMatch(/^task-/)
    const queue = await readQueue()
    expect(queue.tasks[0]?.request).toMatchObject({
      kind: 'project_question',
      raw: 'What commands should I run before release?',
      routingSummary: 'Routed to Project Question',
    })
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

  it('renders directory source references as a bounded tree preview', async () => {
    await fs.mkdir(path.join(tmpDir, 'supabase', 'migrations'), { recursive: true })
    await fs.writeFile(path.join(tmpDir, 'supabase', 'migrations', '001_initial.sql'), 'create table profiles(id uuid);')
    await fs.writeFile(path.join(tmpDir, 'supabase', 'migrations', '002_indexes.sql'), 'create index profiles_id_idx on profiles(id);')
    const { app } = buildServeApp({ projectPath: tmpDir })

    const res = await app.fetch(new Request(projectUrl('/api/project/source-note?path=supabase%2Fmigrations')))

    expect(res.status).toBe(200)
    const body = await res.json() as { kind?: string; displayPath?: string; content?: string; truncated?: boolean }
    expect(body.kind).toBe('directory')
    expect(body.displayPath).toBe('supabase/migrations')
    expect(body.content).toContain('# Directory: supabase/migrations')
    expect(body.content).toContain('- 001_initial.sql')
    expect(body.content).toContain('- 002_indexes.sql')
    expect(body.truncated).toBe(false)
  })

  it('recovers moved source references by dropping stale leading path segments', async () => {
    await fs.mkdir(path.join(tmpDir, 'supabase', 'migrations'), { recursive: true })
    await fs.writeFile(path.join(tmpDir, 'supabase', 'migrations', '001_initial.sql'), 'create table profiles(id uuid);')
    const { app } = buildServeApp({ projectPath: tmpDir })

    const res = await app.fetch(new Request(projectUrl('/api/project/source-note?path=database%2Fsupabase%2Fmigrations')))

    expect(res.status).toBe(200)
    const body = await res.json() as { displayPath?: string; content?: string; kind?: string }
    expect(body.kind).toBe('directory')
    expect(body.displayPath).toBe('supabase/migrations')
    expect(body.content).toContain('Requested path: `database/supabase/migrations`')
    expect(body.content).toContain('Resolved current path: `supabase/migrations`')
  })

  it('returns a helpful missing-source preview with nearby files instead of a dead 404', async () => {
    await fs.mkdir(path.join(tmpDir, 'frontend', 'app', 'composables'), { recursive: true })
    await fs.writeFile(path.join(tmpDir, 'frontend', 'app', 'composables', 'useSupabase.ts'), 'export const useSupabase = () => null')
    const { app } = buildServeApp({ projectPath: tmpDir })

    const res = await app.fetch(new Request(projectUrl('/api/project/source-note?path=frontend%2Fapp%2Fcomposables%2FuseAuth.ts')))

    expect(res.status).toBe(200)
    const body = await res.json() as { missing?: boolean; displayPath?: string; content?: string }
    expect(body.missing).toBe(true)
    expect(body.displayPath).toBe('frontend/app/composables/useAuth.ts')
    expect(body.content).toContain('# Source not found: useAuth.ts')
    expect(body.content).toContain('- useSupabase.ts')
  })

  it('wraps code files in a language fence so previews render as code', async () => {
    await fs.mkdir(path.join(tmpDir, 'frontend', 'app', 'composables'), { recursive: true })
    await fs.writeFile(path.join(tmpDir, 'frontend', 'app', 'composables', 'useSupabase.ts'), 'export const useSupabase = () => null')
    const { app } = buildServeApp({ projectPath: tmpDir })

    const res = await app.fetch(new Request(projectUrl('/api/project/source-note?path=frontend%2Fapp%2Fcomposables%2FuseSupabase.ts')))

    expect(res.status).toBe(200)
    const body = await res.json() as { content?: string }
    expect(body.content).toContain('# File: frontend/app/composables/useSupabase.ts')
    expect(body.content).toContain('```ts')
    expect(body.content).toContain('export const useSupabase')
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
