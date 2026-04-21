import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { bootstrapWorkspace } from '@guildhall/config'
import { buildServeApp } from '../serve.js'

// Integration tests for the Settings-page read-only endpoints:
//   GET /api/config/levers — flatten lever settings into the shape the UI
//   renders. Seeds agent-settings.yaml on first read, so a freshly bootstrapped
//   workspace is a valid test input.

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-serve-settings-'))
  bootstrapWorkspace(tmpDir, { name: 'Settings Test' })
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('GET /api/config/levers', () => {
  it('returns seeded project + default-domain levers with string-rendered positions', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request('http://localhost/api/config/levers'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { levers: Array<Record<string, any>> }
    expect(Array.isArray(body.levers)).toBe(true)
    expect(body.levers.length).toBeGreaterThan(0)

    // Every entry has scope, name, stringified position, rationale, setBy.
    for (const l of body.levers) {
      expect(typeof l.name).toBe('string')
      expect(typeof l.position).toBe('string')
      expect(typeof l.rationale).toBe('string')
      expect(typeof l.setBy).toBe('string')
      expect(['project', 'domain:default']).toContain(l.scope)
    }

    // Spot-check: concurrent_task_dispatch is a parameterized lever — the
    // renderer should emit "serial" (not "[object Object]").
    const concurrent = body.levers.find(l => l.name === 'concurrent_task_dispatch')
    expect(concurrent?.position).toBe('serial')

    // Spot-check: a plain-string lever renders as-is.
    const envelope = body.levers.find(l => l.name === 'business_envelope_strictness')
    expect(envelope?.position).toBe('advisory')

    // Seed provenance should be intact.
    expect(concurrent?.setBy).toBe('system-default')
  })

  it('seeds memory/agent-settings.yaml on first call if missing', async () => {
    const settingsPath = path.join(tmpDir, 'memory', 'agent-settings.yaml')
    await expect(fs.access(settingsPath)).rejects.toThrow()
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request('http://localhost/api/config/levers'))
    expect(res.status).toBe(200)
    await fs.access(settingsPath) // now exists
  })
})
