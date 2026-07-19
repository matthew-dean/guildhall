/**
 * Endpoint tests for the wizard registry:
 *   GET  /api/project/wizards
 *   POST /api/project/wizards/:id/skip + /unskip
 *   POST /api/project/coordinators/seed
 *   GET/POST /api/project/brief
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { bootstrapWorkspace } from '@guildhall/config'
import { getProjectStateDir, getProjectSystemStatePath } from '@guildhall/sessions'
import { buildServeApp } from '../serve.js'
import { writeProjectTaskQueueWithSummary } from '../project-state-boundary.js'

let tmpDir: string
let dataDir: string
let projectId: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-serve-wizards-'))
  dataDir = path.join(os.tmpdir(), `guildhall-data-${path.basename(tmpDir)}`)
  process.env.GUILDHALL_DATA_DIR = dataDir
  projectId = bootstrapWorkspace(tmpDir, { name: 'Wizards Test' }).id ?? path.basename(tmpDir)
})

afterEach(async () => {
  delete process.env.GUILDHALL_DATA_DIR
  await fs.rm(dataDir, { recursive: true, force: true })
  await fs.rm(tmpDir, { recursive: true, force: true })
})

function projectUrl(route: string): string {
  const url = new URL(`http://localhost${route}`)
  url.searchParams.set('projectId', projectId)
  return url.toString()
}

async function applyStorageBoundaryMigration(app: ReturnType<typeof buildServeApp>['app']): Promise<void> {
  const res = await app.fetch(
    new Request(projectUrl('/api/project/migrations/apply'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        includePrompt: true,
        migrationId: '0.10.0/project-state-storage-boundary',
      }),
    }),
  )
  expect(res.status).toBe(200)
}

describe('GET /api/project/wizards', () => {
  it('returns onboard wizard with step statuses derived from on-disk facts', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/wizards')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      wizards: Array<{
        id: string
        totalSteps: number
        activeStepId: string | null
        steps: Array<{ id: string; status: string }>
      }>
    }
    const onboard = body.wizards.find(w => w.id === 'onboard')
    expect(onboard).toBeDefined()
    expect(onboard!.totalSteps).toBe(7)
    // Identity is done after bootstrapWorkspace — name/id are set.
    const identity = onboard!.steps.find(s => s.id === 'identity')
    expect(identity?.status).toBe('done')
    // Provider can be done on developer machines with OAuth credentials.
    const provider = onboard!.steps.find(s => s.id === 'provider')
    expect(['done', 'pending']).toContain(provider?.status)
  })

  it('reads the persisted summary shape without rebuilding project state', async () => {
    const tasksPath = getProjectSystemStatePath(tmpDir, 'TASKS.json')
    writeProjectTaskQueueWithSummary(tasksPath, {
      version: 1,
      lastUpdated: '2026-07-17T00:00:00.000Z',
      releases: [],
      tasks: [{
        id: 'task-summary-shape',
        title: 'Persisted summary task',
        status: 'ready',
        createdAt: '2026-07-17T00:00:00.000Z',
        updatedAt: '2026-07-17T00:00:00.000Z',
      }],
    }, { projectRoot: tmpDir })
    const { app } = buildServeApp({ projectPath: tmpDir })
    await applyStorageBoundaryMigration(app)

    const res = await app.fetch(new Request(projectUrl('/api/project/wizards')))
    expect(res.status).toBe(200)
    expect((await res.json()) as { wizards: unknown[] }).toMatchObject({
      wizards: expect.any(Array),
    })
  })
})

describe('POST /api/project/wizards/:id/skip', () => {
  it('marks a skippable step as skipped without creating project-local state', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/wizards/onboard/skip'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ stepId: 'direction' }),
      }),
    )
    expect(res.status).toBe(200)
    expect(existsSync(getProjectSystemStatePath(tmpDir, 'wizards.yaml'))).toBe(true)
    expect(existsSync(path.join(getProjectStateDir(tmpDir), 'wizards.yaml'))).toBe(false)

    // Next GET reflects the skip.
    const res2 = await app.fetch(new Request(projectUrl('/api/project/wizards')))
    const body = (await res2.json()) as {
      wizards: Array<{ steps: Array<{ id: string; status: string }> }>
    }
    const dir = body.wizards[0]!.steps.find(s => s.id === 'direction')
    expect(dir?.status).toBe('skipped')
  })

  it('rejects skipping a non-skippable step', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/wizards/onboard/skip'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ stepId: 'provider' }),
      }),
    )
    expect(res.status).toBe(400)
  })

  it('unskip removes the marker', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })
    await app.fetch(
      new Request(projectUrl('/api/project/wizards/onboard/skip'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ stepId: 'direction' }),
      }),
    )
    const res = await app.fetch(
      new Request(projectUrl('/api/project/wizards/onboard/unskip'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ stepId: 'direction' }),
      }),
    )
    expect(res.status).toBe(200)
    const res2 = await app.fetch(new Request(projectUrl('/api/project/wizards')))
    const body = (await res2.json()) as {
      wizards: Array<{ steps: Array<{ id: string; status: string }> }>
    }
    const dir = body.wizards[0]!.steps.find(s => s.id === 'direction')
    expect(dir?.status).toBe('pending')
  })
})

describe('POST /api/project/coordinators/seed', () => {
  it('appends requested archetype coordinators to guildhall.yaml', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/coordinators/seed'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ archetypes: ['tech', 'product'] }),
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; added: number }
    expect(body.ok).toBe(true)
    expect(body.added).toBe(2)

    // Onboard wizard's routing step should now be done.
    const res2 = await app.fetch(new Request(projectUrl('/api/project/wizards')))
    const wb = (await res2.json()) as {
      wizards: Array<{ steps: Array<{ id: string; status: string }> }>
    }
    const coord = wb.wizards[0]!.steps.find(s => s.id === 'routing')
    expect(coord?.status).toBe('done')
  })

  it('rejects empty archetype list', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/coordinators/seed'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ archetypes: [] }),
      }),
    )
    expect(res.status).toBe(400)
  })

  it('is idempotent — re-seeding with an existing id adds nothing', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })
    await app.fetch(
      new Request(projectUrl('/api/project/coordinators/seed'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ archetypes: ['tech'] }),
      }),
    )
    const res = await app.fetch(
      new Request(projectUrl('/api/project/coordinators/seed'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ archetypes: ['tech'] }),
      }),
    )
    const body = (await res.json()) as { added: number }
    expect(body.added).toBe(0)
  })
})

describe('GET /api/project/brief', () => {
  it('returns empty current + empty seeds when no README/ROADMAP', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/brief')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      current: string
      seed: { readme: string; roadmap: string[] }
    }
    expect(body.current).toBe('')
    expect(body.seed.readme).toBe('')
    expect(body.seed.roadmap).toEqual([])
  })

  it('seeds from README first non-heading paragraph and ROADMAP headings', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'README.md'),
      '# My Project\n\nThis is a project that does some things for users who need things done.\n\nMore details below.\n',
    )
    await fs.writeFile(
      path.join(tmpDir, 'ROADMAP.md'),
      '# Roadmap\n\n## Milestone 1\n\nbody\n\n## Milestone 2\n\nbody\n',
    )
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/brief')))
    const body = (await res.json()) as {
      seed: { readme: string; roadmap: string[] }
    }
    expect(body.seed.readme).toMatch(/project that does some things/i)
    expect(body.seed.roadmap).toContain('Milestone 1')
    expect(body.seed.roadmap).toContain('Milestone 2')
  })
})

describe('POST /api/project/brief', () => {
  it('writes project brief to system-local state without creating repo .guildhall state', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })
    await applyStorageBoundaryMigration(app)
    const res = await app.fetch(
      new Request(projectUrl('/api/project/brief'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          content:
            '# Project brief\n\n## Users\nIndie devs\n\n## Problem\nAgents need guardrails\n\n## Done when\nv0.3 ships',
        }),
      }),
    )
    expect(res.status).toBe(200)
    const briefPath = getProjectSystemStatePath(tmpDir, 'project-brief.md')
    expect(existsSync(briefPath)).toBe(true)
    expect(readFileSync(briefPath, 'utf8')).toMatch(/## Users/)
    expect(existsSync(path.join(getProjectStateDir(tmpDir), 'project-brief.md'))).toBe(false)

    // Onboard direction step flips to done.
    const res2 = await app.fetch(new Request(projectUrl('/api/project/wizards')))
    const wb = (await res2.json()) as {
      wizards: Array<{ steps: Array<{ id: string; status: string }> }>
    }
    const dir = wb.wizards[0]!.steps.find(s => s.id === 'direction')
    expect(dir?.status).toBe('done')
  })

  it('rejects thin content', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/brief'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: 'short' }),
      }),
    )
    expect(res.status).toBe(400)
  })
})
