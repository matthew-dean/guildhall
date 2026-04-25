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
import { buildServeApp } from '../serve.js'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-serve-wizards-'))
  bootstrapWorkspace(tmpDir, { name: 'Wizards Test' })
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('GET /api/project/wizards', () => {
  it('returns onboard wizard with step statuses derived from on-disk facts', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request('http://localhost/api/project/wizards'))
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
    // Provider is not yet configured in tmp.
    const provider = onboard!.steps.find(s => s.id === 'provider')
    expect(provider?.status).toBe('pending')
  })
})

describe('POST /api/project/wizards/:id/skip', () => {
  it('marks a skippable step as skipped and writes memory/wizards.yaml', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request('http://localhost/api/project/wizards/onboard/skip', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ stepId: 'direction' }),
      }),
    )
    expect(res.status).toBe(200)
    expect(existsSync(path.join(tmpDir, 'memory', 'wizards.yaml'))).toBe(true)

    // Next GET reflects the skip.
    const res2 = await app.fetch(new Request('http://localhost/api/project/wizards'))
    const body = (await res2.json()) as {
      wizards: Array<{ steps: Array<{ id: string; status: string }> }>
    }
    const dir = body.wizards[0]!.steps.find(s => s.id === 'direction')
    expect(dir?.status).toBe('skipped')
  })

  it('rejects skipping a non-skippable step', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request('http://localhost/api/project/wizards/onboard/skip', {
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
      new Request('http://localhost/api/project/wizards/onboard/skip', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ stepId: 'direction' }),
      }),
    )
    const res = await app.fetch(
      new Request('http://localhost/api/project/wizards/onboard/unskip', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ stepId: 'direction' }),
      }),
    )
    expect(res.status).toBe(200)
    const res2 = await app.fetch(new Request('http://localhost/api/project/wizards'))
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
      new Request('http://localhost/api/project/coordinators/seed', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ archetypes: ['tech', 'product'] }),
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; added: number }
    expect(body.ok).toBe(true)
    expect(body.added).toBe(2)

    // Onboard wizard's coordinator step should now be done.
    const res2 = await app.fetch(new Request('http://localhost/api/project/wizards'))
    const wb = (await res2.json()) as {
      wizards: Array<{ steps: Array<{ id: string; status: string }> }>
    }
    const coord = wb.wizards[0]!.steps.find(s => s.id === 'coordinator')
    expect(coord?.status).toBe('done')
  })

  it('rejects empty archetype list', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request('http://localhost/api/project/coordinators/seed', {
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
      new Request('http://localhost/api/project/coordinators/seed', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ archetypes: ['tech'] }),
      }),
    )
    const res = await app.fetch(
      new Request('http://localhost/api/project/coordinators/seed', {
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
    const res = await app.fetch(new Request('http://localhost/api/project/brief'))
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
    const res = await app.fetch(new Request('http://localhost/api/project/brief'))
    const body = (await res.json()) as {
      seed: { readme: string; roadmap: string[] }
    }
    expect(body.seed.readme).toMatch(/project that does some things/i)
    expect(body.seed.roadmap).toContain('Milestone 1')
    expect(body.seed.roadmap).toContain('Milestone 2')
  })
})

describe('POST /api/project/brief', () => {
  it('writes memory/project-brief.md when content is substantive', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request('http://localhost/api/project/brief', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          content:
            '# Project brief\n\n## Users\nIndie devs\n\n## Problem\nAgents need guardrails\n\n## Done when\nv0.3 ships',
        }),
      }),
    )
    expect(res.status).toBe(200)
    const briefPath = path.join(tmpDir, 'memory', 'project-brief.md')
    expect(existsSync(briefPath)).toBe(true)
    expect(readFileSync(briefPath, 'utf8')).toMatch(/## Users/)

    // Onboard direction step flips to done.
    const res2 = await app.fetch(new Request('http://localhost/api/project/wizards'))
    const wb = (await res2.json()) as {
      wizards: Array<{ steps: Array<{ id: string; status: string }> }>
    }
    const dir = wb.wizards[0]!.steps.find(s => s.id === 'direction')
    expect(dir?.status).toBe('done')
  })

  it('rejects thin content', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request('http://localhost/api/project/brief', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: 'short' }),
      }),
    )
    expect(res.status).toBe(400)
  })
})
