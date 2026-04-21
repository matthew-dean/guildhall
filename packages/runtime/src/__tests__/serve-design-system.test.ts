import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import yaml from 'js-yaml'
import { bootstrapWorkspace } from '@guildhall/config'
import { DesignSystem } from '@guildhall/core'
import { buildServeApp } from '../serve.js'

// Integration tests for the project-scoped design-system endpoints:
//   GET  /api/project/design-system          → { designSystem: null } on fresh workspaces
//   POST /api/project/design-system          → author/revise; drops approval on material change
//   POST /api/project/design-system/approve  → stamps approvedBy='human' + approvedAt

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-serve-ds-'))
  bootstrapWorkspace(tmpDir, { name: 'DS Test' })
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

async function readDS(): Promise<DesignSystem> {
  const raw = await fs.readFile(path.join(tmpDir, 'memory', 'design-system.yaml'), 'utf-8')
  return DesignSystem.parse(yaml.load(raw) ?? {})
}

describe('GET /api/project/design-system', () => {
  it('returns null when no design system has been drafted', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request('http://localhost/api/project/design-system'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { designSystem: unknown }
    expect(body.designSystem).toBeNull()
  })

  it('returns the current design system + a summary once drafted', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })
    await app.fetch(new Request('http://localhost/api/project/design-system', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tokens: {
          color: [{ name: 'primary', value: '#0ea5e9' }],
          spacing: [],
          typography: [],
          radius: [],
          shadow: [],
        },
        primitives: [{ name: 'Button', usage: 'primary action' }],
        copyVoice: { tone: 'warm', bannedTerms: [], preferredTerms: [], examples: [] },
        authoredBy: 'agent:spec-agent',
      }),
    }))
    const res = await app.fetch(new Request('http://localhost/api/project/design-system'))
    const body = (await res.json()) as { designSystem: DesignSystem; summary: string }
    expect(body.designSystem.tokens.color[0]!.name).toBe('primary')
    expect(body.summary).toMatch(/Button/)
    expect(body.summary).toMatch(/tone=warm/)
  })
})

describe('POST /api/project/design-system/approve', () => {
  it('returns 400 when nothing has been drafted yet', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request('http://localhost/api/project/design-system/approve', {
      method: 'POST',
    }))
    expect(res.status).toBe(400)
  })

  it('stamps approvedBy + approvedAt on the on-disk YAML', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })
    const seed = await app.fetch(new Request('http://localhost/api/project/design-system', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tokens: {
          color: [{ name: 'primary', value: '#0ea5e9' }],
          spacing: [],
          typography: [],
          radius: [],
          shadow: [],
        },
        primitives: [],
        copyVoice: { tone: 'plain', bannedTerms: [], preferredTerms: [], examples: [] },
        authoredBy: 'agent:spec-agent',
      }),
    }))
    const seedBody = await seed.json()
    expect(seedBody).toMatchObject({ ok: true })
    const r = await app.fetch(new Request('http://localhost/api/project/design-system/approve', {
      method: 'POST',
    }))
    expect(r.status).toBe(200)
    const ds = await readDS()
    expect(ds.approvedBy).toBe('human')
    expect(ds.approvedAt).toBeDefined()
  })

  it('re-authoring with a different material surface drops the prior approval', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })
    const payload = (primaryColor: string) => ({
      tokens: {
        color: [{ name: 'primary', value: primaryColor }],
        spacing: [],
        typography: [],
        radius: [],
        shadow: [],
      },
      primitives: [],
      copyVoice: { tone: 'plain', bannedTerms: [], preferredTerms: [], examples: [] },
      authoredBy: 'agent:spec-agent',
    })
    await app.fetch(new Request('http://localhost/api/project/design-system', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload('#0ea5e9')),
    }))
    await app.fetch(new Request('http://localhost/api/project/design-system/approve', {
      method: 'POST',
    }))
    await app.fetch(new Request('http://localhost/api/project/design-system', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload('#ff0000')),
    }))
    const ds = await readDS()
    expect(ds.approvedBy).toBeUndefined()
    expect(ds.approvedAt).toBeUndefined()
  })
})
