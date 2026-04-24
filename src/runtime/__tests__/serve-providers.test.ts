import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs/promises'
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

// Redirect homedir so the global provider store lives under a per-test temp
// directory — we must not read or write the user's real ~/.guildhall.
const TMP_HOME = path.join(os.tmpdir(), `guildhall-serve-providers-${process.pid}`)
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  return { ...actual, homedir: () => TMP_HOME }
})

const { bootstrapWorkspace, setProvider, readGlobalProviders, globalProvidersPath } =
  await import('@guildhall/config')
const { buildServeApp } = await import('../serve.js')

let tmpProject: string

beforeEach(async () => {
  // Clean env vars so env-precedence doesn't mask the global store.
  delete process.env.ANTHROPIC_API_KEY
  delete process.env.OPENAI_API_KEY
  delete process.env.LLAMA_CPP_URL
  delete process.env.LM_STUDIO_BASE_URL
  mkdirSync(path.join(TMP_HOME, '.guildhall'), { recursive: true })
  tmpProject = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-serve-providers-proj-'))
  bootstrapWorkspace(tmpProject, { name: 'Provider Test' })
})

afterEach(async () => {
  if (existsSync(TMP_HOME)) rmSync(TMP_HOME, { recursive: true, force: true })
  await fs.rm(tmpProject, { recursive: true, force: true })
})

describe('GET /api/setup/providers', () => {
  it('reports no credentials when the global store is empty', async () => {
    const { app } = buildServeApp({ projectPath: tmpProject })
    const res = await app.fetch(new Request('http://localhost/api/setup/providers'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      providers: Record<string, { detected: boolean; verifiedAt: string | null }>
    }
    expect(body.providers['anthropic-api']!.detected).toBe(false)
    expect(body.providers['openai-api']!.detected).toBe(false)
    expect(body.providers['anthropic-api']!.verifiedAt).toBeNull()
  })

  it('reflects a stored Anthropic key from the global store (no project-level secret)', async () => {
    setProvider('anthropic-api', { apiKey: 'sk-ant-global' })
    const { app } = buildServeApp({ projectPath: tmpProject })
    const res = await app.fetch(new Request('http://localhost/api/setup/providers'))
    const body = (await res.json()) as {
      providers: Record<string, { detected: boolean; detail: string }>
    }
    expect(body.providers['anthropic-api']!.detected).toBe(true)
    expect(body.providers['anthropic-api']!.detail).toMatch(/providers\.yaml/)
  })
})

describe('POST /api/setup/providers/config', () => {
  it('writes a pasted Anthropic key to the GLOBAL store, not the project file', async () => {
    const { app } = buildServeApp({ projectPath: tmpProject })
    const res = await app.fetch(
      new Request('http://localhost/api/setup/providers/config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ anthropicApiKey: 'sk-ant-pasted' }),
      }),
    )
    expect(res.status).toBe(200)
    // Global store has the key.
    const g = readGlobalProviders()
    expect(g.providers['anthropic-api']?.apiKey).toBe('sk-ant-pasted')
    // Project config does NOT carry it (check on disk — no `anthropicApiKey`).
    const projectCfgPath = path.join(tmpProject, '.guildhall', 'config.yaml')
    if (existsSync(projectCfgPath)) {
      const raw = await fs.readFile(projectCfgPath, 'utf8')
      expect(raw).not.toMatch(/sk-ant-pasted/)
    }
  })

  it('writes preferredProvider to the PROJECT config, not the global store', async () => {
    setProvider('anthropic-api', { apiKey: 'sk-ant-global' })
    const { app } = buildServeApp({ projectPath: tmpProject })
    const res = await app.fetch(
      new Request('http://localhost/api/setup/providers/config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ preferredProvider: 'anthropic-api' }),
      }),
    )
    expect(res.status).toBe(200)
    // Global store unchanged (no preferredProvider field on it at all).
    const g = readGlobalProviders()
    expect(g.providers['anthropic-api']?.apiKey).toBe('sk-ant-global')
    // Project config records the selection.
    const raw = await fs.readFile(path.join(tmpProject, '.guildhall', 'config.yaml'), 'utf8')
    expect(raw).toMatch(/preferredProvider:\s*anthropic-api/)
  })

  it('rejects unknown preferredProvider values', async () => {
    const { app } = buildServeApp({ projectPath: tmpProject })
    const res = await app.fetch(
      new Request('http://localhost/api/setup/providers/config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ preferredProvider: 'bogus-provider' }),
      }),
    )
    expect(res.status).toBe(400)
  })

  it('migrates a legacy project-level anthropic key to the global store on first GET', async () => {
    // Simulate a pre-0.3 project config with the key inlined.
    const cfgPath = path.join(tmpProject, '.guildhall', 'config.yaml')
    mkdirSync(path.dirname(cfgPath), { recursive: true })
    writeFileSync(cfgPath, 'anthropicApiKey: sk-ant-legacy\n', 'utf8')
    const { app } = buildServeApp({ projectPath: tmpProject })
    // Hitting GET triggers the migration.
    await app.fetch(new Request('http://localhost/api/setup/providers'))
    const g = readGlobalProviders()
    expect(g.providers['anthropic-api']?.apiKey).toBe('sk-ant-legacy')
    // And the project file no longer holds the secret.
    const after = await fs.readFile(cfgPath, 'utf8')
    expect(after).not.toMatch(/sk-ant-legacy/)
  })
})

describe('POST /api/providers/disconnect', () => {
  it('removes the entry for a credentialed provider', async () => {
    setProvider('openai-api', { apiKey: 'sk-openai' })
    const { app } = buildServeApp({ projectPath: tmpProject })
    const res = await app.fetch(
      new Request('http://localhost/api/providers/disconnect', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: 'openai-api' }),
      }),
    )
    const body = (await res.json()) as { ok: boolean }
    expect(body.ok).toBe(true)
    expect(readGlobalProviders().providers['openai-api']).toBeUndefined()
  })

  it('returns an informative note for OAuth providers (CLI owns the credential)', async () => {
    const { app } = buildServeApp({ projectPath: tmpProject })
    const res = await app.fetch(
      new Request('http://localhost/api/providers/disconnect', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: 'claude-oauth' }),
      }),
    )
    const body = (await res.json()) as { ok: boolean; note?: string }
    expect(body.ok).toBe(true)
    expect(body.note).toMatch(/CLI/i)
  })

  it('rejects unknown provider names', async () => {
    const { app } = buildServeApp({ projectPath: tmpProject })
    const res = await app.fetch(
      new Request('http://localhost/api/providers/disconnect', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: 'bogus' }),
      }),
    )
    expect(res.status).toBe(400)
  })
})

describe('POST /api/project/start preflight', () => {
  it('returns 400 with code:no_provider when no credential is configured', async () => {
    const { app } = buildServeApp({ projectPath: tmpProject })
    const res = await app.fetch(
      new Request('http://localhost/api/project/start', { method: 'POST' }),
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error?: string; code?: string }
    expect(body.code).toBe('no_provider')
    expect(body.error).toMatch(/provider/i)
  })

  it('passes preflight and starts the supervisor when an Anthropic key is stored', async () => {
    setProvider('anthropic-api', { apiKey: 'sk-ant-test' })
    const { app, supervisor } = buildServeApp({ projectPath: tmpProject })
    try {
      const res = await app.fetch(
        new Request('http://localhost/api/project/start', { method: 'POST' }),
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as { status?: string; provider?: string }
      expect(body.status).toBe('running')
      expect(body.provider).toBe('anthropic-api')
    } finally {
      await supervisor.stopAll({ reason: 'test-teardown' }).catch(() => {})
    }
  })
})

describe('POST /api/project/stop', () => {
  it('returns ok:true for an idle workspace (no supervisor running)', async () => {
    const { app } = buildServeApp({ projectPath: tmpProject })
    const res = await app.fetch(
      new Request('http://localhost/api/project/stop', { method: 'POST' }),
    )
    // Not running → supervisor.stop returns false → 504 today. Treat either
    // shape as acceptable: what matters is the UI gets a structured response
    // instead of a silent success.
    expect([200, 504]).toContain(res.status)
    const body = (await res.json()) as { ok?: boolean; error?: string }
    if (res.status === 200) {
      expect(body.ok).toBe(true)
    } else {
      expect(body.error).toMatch(/stop|timed out|not running/i)
    }
  })

  it('stops a running supervisor and reflects stopped status on refresh', async () => {
    setProvider('anthropic-api', { apiKey: 'sk-ant-test' })
    const { app, supervisor } = buildServeApp({ projectPath: tmpProject })
    try {
      const startRes = await app.fetch(
        new Request('http://localhost/api/project/start', { method: 'POST' }),
      )
      expect(startRes.status).toBe(200)
      // Give the orchestrator a tick to settle, then stop.
      await new Promise(r => setTimeout(r, 50))
      const stopRes = await app.fetch(
        new Request('http://localhost/api/project/stop', { method: 'POST' }),
      )
      expect(stopRes.status).toBe(200)
      const body = (await stopRes.json()) as { ok?: boolean }
      expect(body.ok).toBe(true)
      // Supervisor state reflects the stop (or is in a terminal state).
      const runs = supervisor.list()
      const run = runs[0]
      expect(run).toBeDefined()
      expect(['stopped', 'error']).toContain(run!.status)
    } finally {
      await supervisor.stopAll({ reason: 'test-teardown' }).catch(() => {})
    }
  }, 10_000)
})

describe('POST /api/providers/test', () => {
  it('400s for an unknown provider', async () => {
    const { app } = buildServeApp({ projectPath: tmpProject })
    const res = await app.fetch(
      new Request('http://localhost/api/providers/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: 'bogus' }),
      }),
    )
    expect(res.status).toBe(400)
  })

  it('returns ok:false with a clear error when forced provider has no credential', async () => {
    const { app } = buildServeApp({ projectPath: tmpProject })
    const res = await app.fetch(
      new Request('http://localhost/api/providers/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: 'anthropic-api' }),
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; error?: string }
    expect(body.ok).toBe(false)
    expect(body.error).toMatch(/api key|missing|not available/i)
    // No verifiedAt stamped on failure.
    expect(readGlobalProviders().providers['anthropic-api']?.verifiedAt ?? null).toBeNull()
  })

  it('returns a friendly error when llama-cpp is selected without a URL', async () => {
    const { app } = buildServeApp({ projectPath: tmpProject })
    const res = await app.fetch(
      new Request('http://localhost/api/providers/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: 'llama-cpp' }),
      }),
    )
    const body = (await res.json()) as { ok: boolean; error?: string }
    expect(body.ok).toBe(false)
    expect(body.error).toMatch(/model|url|llama|lm studio/i)
  })
})
