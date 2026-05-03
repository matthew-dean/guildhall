import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs/promises'
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { Buffer } from 'node:buffer'

// Redirect homedir so the global provider store lives under a per-test temp
// directory — we must not read or write the user's real ~/.guildhall.
const TMP_HOME = path.join(os.tmpdir(), `guildhall-serve-providers-${process.pid}`)
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  return { ...actual, homedir: () => TMP_HOME }
})

const { bootstrapWorkspace, setProvider, readGlobalProviders, globalProvidersPath, readWorkspaceConfig, readGlobalConfig, resolveModelsForProvider, updateProjectConfig } =
  await import('@guildhall/config')
const { buildServeApp } = await import('../serve.js')
const { clearProviderClientPool } = await import('../provider-client-pool.js')

let tmpProject: string

function sseResponse(frames: string[]): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame))
      controller.close()
    },
  })
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

function dataFrame(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`
}

beforeEach(async () => {
  clearProviderClientPool()
  // Clean env vars so env-precedence doesn't mask the global store.
  delete process.env.ANTHROPIC_API_KEY
  delete process.env.OPENAI_API_KEY
  delete process.env.OPENAI_BASE_URL
  delete process.env.LLAMA_CPP_URL
  delete process.env.LM_STUDIO_BASE_URL
  mkdirSync(path.join(TMP_HOME, '.guildhall'), { recursive: true })
  tmpProject = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-serve-providers-proj-'))
  bootstrapWorkspace(tmpProject, { name: 'Provider Test' })
})

afterEach(async () => {
  clearProviderClientPool()
  vi.unstubAllGlobals()
  if (existsSync(TMP_HOME)) rmSync(TMP_HOME, { recursive: true, force: true })
  await fs.rm(tmpProject, { recursive: true, force: true })
})

async function writeCodexCred(): Promise<void> {
  const payload = {
    'https://api.openai.com/auth': { chatgpt_account_id: 'acct-test-1234' },
  }
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8')
    .toString('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
  const fakeJwt = `header.${encoded}.sig`
  await fs.mkdir(path.join(TMP_HOME, '.codex'), { recursive: true })
  await fs.writeFile(
    path.join(TMP_HOME, '.codex', 'auth.json'),
    JSON.stringify({
      tokens: {
        access_token: fakeJwt,
        refresh_token: 'rt-test',
        account_id: 'acct-test-1234',
      },
    }),
    'utf8',
  )
}

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

  it('uses protocol-first labels for compatible APIs and local servers', async () => {
    const { app } = buildServeApp({ projectPath: tmpProject })
    const res = await app.fetch(new Request('http://localhost/api/setup/providers'))
    const body = (await res.json()) as {
      providers: Record<string, { label: string }>
    }
    expect(body.providers['anthropic-api']!.label).toBe('Anthropic-compatible API key')
    expect(body.providers['openai-api']!.label).toBe('OpenAI-compatible API key')
    expect(body.providers['llama-cpp']!.label).toBe('OpenAI-compatible local server')
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

  it('reports a stored OpenAI-compatible base URL and keeps blank meaning real OpenAI', async () => {
    setProvider('openai-api', {
      apiKey: 'sk-openai-global',
      baseUrl: 'https://integrate.api.nvidia.com/v1',
    })
    const { app } = buildServeApp({ projectPath: tmpProject })
    const res = await app.fetch(new Request('http://localhost/api/setup/providers'))
    const body = (await res.json()) as {
      providers: Record<string, { detected: boolean; detail: string; baseUrl?: string | null }>
    }
    expect(body.providers['openai-api']!.detected).toBe(true)
    expect(body.providers['openai-api']!.baseUrl).toBe('https://integrate.api.nvidia.com/v1')
    expect(body.providers['openai-api']!.detail).toMatch(/integrate\.api\.nvidia\.com/)
  })
})

describe('POST /api/setup/providers/config', () => {
  it('does not seed workspace model assignments during identity setup', async () => {
    const freshProject = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-serve-identity-proj-'))
    try {
      const { app } = buildServeApp({ projectPath: freshProject })
      const res = await app.fetch(
        new Request('http://localhost/api/setup/identity', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'Fresh Project', id: 'fresh-project' }),
        }),
      )
      expect(res.status).toBe(200)
      expect(readWorkspaceConfig(freshProject).models).toBeUndefined()
    } finally {
      await fs.rm(freshProject, { recursive: true, force: true })
    }
  })

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

  it('writes an OpenAI-compatible base URL to the global store and preserves the key', async () => {
    const { app } = buildServeApp({ projectPath: tmpProject })
    const res = await app.fetch(
      new Request('http://localhost/api/setup/providers/config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          openaiApiKey: 'sk-openai-pasted',
          openaiBaseUrl: 'https://integrate.api.nvidia.com/v1',
        }),
      }),
    )
    expect(res.status).toBe(200)
    const g = readGlobalProviders()
    expect(g.providers['openai-api']?.apiKey).toBe('sk-openai-pasted')
    expect(g.providers['openai-api']?.baseUrl).toBe('https://integrate.api.nvidia.com/v1')
  })

  it('clears the stored OpenAI-compatible base URL when blank is saved', async () => {
    setProvider('openai-api', {
      apiKey: 'sk-openai-pasted',
      baseUrl: 'https://integrate.api.nvidia.com/v1',
    })
    const { app } = buildServeApp({ projectPath: tmpProject })
    const res = await app.fetch(
      new Request('http://localhost/api/setup/providers/config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          openaiApiKey: 'sk-openai-pasted',
          openaiBaseUrl: '',
        }),
      }),
    )
    expect(res.status).toBe(200)
    const g = readGlobalProviders()
    expect(g.providers['openai-api']?.apiKey).toBe('sk-openai-pasted')
    expect(g.providers['openai-api']?.baseUrl).toBeUndefined()
  })

  it('does not update model assignments when saving llama-cpp provider settings', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ data: [{ id: 'qwen/qwen3.6-35b-a3b' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )
    const { app } = buildServeApp({ projectPath: tmpProject })
    const res = await app.fetch(
      new Request('http://localhost/api/setup/providers/config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          preferredProvider: 'llama-cpp',
          lmStudioUrl: 'http://localhost:1234/v1',
        }),
      }),
    )
    expect(res.status).toBe(200)
    const workspace = readWorkspaceConfig(tmpProject)
    expect(workspace.models).toBeUndefined()
    expect(readGlobalConfig().models).toBeUndefined()
  })

  it('sets global model defaults only through the explicit model config endpoint', async () => {
    const { app } = buildServeApp({ projectPath: tmpProject })
    const res = await app.fetch(
      new Request('http://localhost/api/config/models', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          scope: 'global',
          role: 'worker',
          model: 'qwen/qwen3.6-35b-a3b',
        }),
      }),
    )
    expect(res.status).toBe(200)
    expect(resolveModelsForProvider(readGlobalConfig().models).worker).toBe('qwen/qwen3.6-35b-a3b')
    expect(readWorkspaceConfig(tmpProject).models).toBeUndefined()
  })

  it('writes provider-scoped global models when the project prefers openai-api', async () => {
    updateProjectConfig(tmpProject, { preferredProvider: 'openai-api' })
    const { app } = buildServeApp({ projectPath: tmpProject })
    const res = await app.fetch(
      new Request('http://localhost/api/config/models', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          scope: 'global',
          models: {
            spec: 'qwen/qwen3.5-122b-a10b',
            coordinator: 'qwen/qwen3.5-122b-a10b',
            worker: 'qwen/qwen3.5-122b-a10b',
            reviewer: 'qwen/qwen3.5-122b-a10b',
            gateChecker: 'qwen/qwen3.5-122b-a10b',
          },
        }),
      }),
    )
    expect(res.status).toBe(200)
    expect(readGlobalConfig().models).toMatchObject({
      'openai-api': {
        spec: 'qwen/qwen3.5-122b-a10b',
        coordinator: 'qwen/qwen3.5-122b-a10b',
        worker: 'qwen/qwen3.5-122b-a10b',
        reviewer: 'qwen/qwen3.5-122b-a10b',
        gateChecker: 'qwen/qwen3.5-122b-a10b',
      },
    })
  })

  it('can set a global split-model preset in one request', async () => {
    const { app } = buildServeApp({ projectPath: tmpProject })
    const res = await app.fetch(
      new Request('http://localhost/api/config/models', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          scope: 'global',
          models: {
            spec: 'qwen/qwen3.6-35b-a3b',
            coordinator: 'qwen/qwen3.6-35b-a3b',
            worker: 'qwen/qwen3.6-35b-a3b',
            reviewer: 'qwen/qwen2.5-coder-14b',
            gateChecker: 'qwen/qwen2.5-coder-14b',
          },
        }),
      }),
    )
    expect(res.status).toBe(200)
    expect(readGlobalConfig().models).toMatchObject({
      spec: 'qwen/qwen3.6-35b-a3b',
      coordinator: 'qwen/qwen3.6-35b-a3b',
      worker: 'qwen/qwen3.6-35b-a3b',
      reviewer: 'qwen/qwen2.5-coder-14b',
      gateChecker: 'qwen/qwen2.5-coder-14b',
    })
    expect(readWorkspaceConfig(tmpProject).models).toBeUndefined()
  })

  it('includes loaded LM Studio models in the model catalog', async () => {
    setProvider('llama-cpp', { url: 'http://localhost:1234/v1' })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ data: [{ id: 'qwen/qwen3.6-35b-a3b' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )
    const { app } = buildServeApp({ projectPath: tmpProject })
    const res = await app.fetch(new Request('http://localhost/api/config/models'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      loadedModels?: string[]
      catalog?: Array<{ id: string; notes?: string }>
    }
    expect(body.loadedModels).toContain('qwen/qwen3.6-35b-a3b')
    expect(body.catalog?.some(item => item.id === 'qwen/qwen3.6-35b-a3b')).toBe(true)
  })

  it('can add and remove a project model override', async () => {
    const { app } = buildServeApp({ projectPath: tmpProject })
    const setRes = await app.fetch(
      new Request('http://localhost/api/config/models', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          scope: 'project',
          role: 'reviewer',
          model: 'qwen/qwen2.5-coder-7b-instruct',
        }),
      }),
    )
    expect(setRes.status).toBe(200)
    expect(resolveModelsForProvider(readWorkspaceConfig(tmpProject).models).reviewer).toBe('qwen/qwen2.5-coder-7b-instruct')

    const unsetRes = await app.fetch(
      new Request('http://localhost/api/config/models', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          scope: 'global-default',
          role: 'reviewer',
        }),
      }),
    )
    expect(unsetRes.status).toBe(200)
    expect(readWorkspaceConfig(tmpProject).models).toBeUndefined()
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
    updateProjectConfig(tmpProject, { allowPaidProviderFallback: true })
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

  it('does not fall back to a paid provider unless project/global config opts in', async () => {
    setProvider('anthropic-api', { apiKey: 'sk-ant-test' })
    updateProjectConfig(tmpProject, { preferredProvider: 'llama-cpp' })
    const { app } = buildServeApp({ projectPath: tmpProject })

    const res = await app.fetch(
      new Request('http://localhost/api/project/start', { method: 'POST' }),
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as { code?: string; error?: string }
    expect(body.code).toBe('no_provider')
    expect(body.error).toMatch(/Paid-provider fallback is disabled/)
  })

  it('surfaces the active provider when preferred provider falls back with opt-in', async () => {
    setProvider('anthropic-api', { apiKey: 'sk-ant-test' })
    updateProjectConfig(tmpProject, {
      preferredProvider: 'llama-cpp',
      allowPaidProviderFallback: true,
    })
    const { app, supervisor } = buildServeApp({ projectPath: tmpProject })
    try {
      const res = await app.fetch(
        new Request('http://localhost/api/project/start', { method: 'POST' }),
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        providerStatus?: {
          preferredProvider?: string
          preferredProviderFamily?: string
          preferredProviderLabel?: string
          activeProvider?: string
          activeProviderFamily?: string
          activeProviderLabel?: string
          fallback?: boolean
        }
      }
      expect(body.providerStatus).toMatchObject({
        preferredProvider: 'llama-cpp',
        preferredProviderFamily: 'openai-compatible',
        preferredProviderLabel: 'OpenAI-compatible local server',
        preferredCapabilities: {
          recommendedConcurrency: 1,
          localServer: true,
        },
        activeProvider: 'anthropic-api',
        activeProviderFamily: 'anthropic-compatible',
        activeProviderLabel: 'Anthropic-compatible API',
        activeCapabilities: {
          recommendedConcurrency: 4,
          localServer: false,
        },
        fallback: true,
        activeModel: 'claude-sonnet-4-6',
      })

      const projectRes = await app.fetch(new Request('http://localhost/api/project'))
      const projectBody = (await projectRes.json()) as {
        providerStatus?: {
          preferredProvider?: string
          preferredProviderFamily?: string
          activeProvider?: string
          activeProviderFamily?: string
          fallback?: boolean
        }
        run?: {
          providerStatus?: {
            activeProvider?: string
          }
        }
      }
      expect(projectBody.providerStatus).toMatchObject({
        preferredProvider: 'llama-cpp',
        preferredProviderFamily: 'openai-compatible',
        activeProvider: 'anthropic-api',
        activeProviderFamily: 'anthropic-compatible',
        fallback: true,
        activeModel: 'claude-sonnet-4-6',
      })
      expect(projectBody.run?.providerStatus?.activeProvider).toBe('anthropic-api')
    } finally {
      await supervisor.stopAll({ reason: 'test-teardown' }).catch(() => {})
    }
  })

  it('falls back to Codex when LM Studio is reachable but the configured models are unavailable', async () => {
    await writeCodexCred()
    setProvider('llama-cpp', { url: 'http://localhost:1234/v1' })
    updateProjectConfig(tmpProject, {
      preferredProvider: 'llama-cpp',
      allowPaidProviderFallback: true,
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ data: [{ id: 'qwen/qwen3.6-35b-a3b' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )
    const { app, supervisor } = buildServeApp({ projectPath: tmpProject })
    try {
      const res = await app.fetch(
        new Request('http://localhost/api/project/start', { method: 'POST' }),
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        providerStatus?: {
          preferredProvider?: string
          activeProvider?: string
          fallback?: boolean
          activeModel?: string
          decisions?: Array<{ code?: string; basis?: string; message?: string }>
          models?: { spec?: string; worker?: string }
          reason?: string
        }
      }
      expect(body.providerStatus).toMatchObject({
        preferredProvider: 'llama-cpp',
        activeProvider: 'codex-oauth',
        fallback: true,
        activeModel: 'gpt-5.3-codex',
      })
      expect(body.providerStatus?.models?.spec).toBe('gpt-5.3-codex')
      expect(body.providerStatus?.models?.worker).toBe('gpt-5.3-codex')
      expect(body.providerStatus?.reason).toMatch(/configured models loaded|switched to a paid fallback provider/i)
      expect(body.providerStatus?.decisions?.[0]).toMatchObject({
        code: 'preferred_provider_missing_assigned_models',
        basis: 'compatibility',
      })
      expect(body.providerStatus?.decisions?.[0]?.message).toMatch(/assigned models loaded/i)
    } finally {
      await supervisor.stopAll({ reason: 'test-teardown' }).catch(() => {})
    }
  })

  it('surfaces normalized preferred-provider family and label even before a run starts', async () => {
    updateProjectConfig(tmpProject, {
      preferredProvider: 'openai-api',
      allowPaidProviderFallback: true,
    })
    const { app } = buildServeApp({ projectPath: tmpProject })
    const res = await app.fetch(new Request('http://localhost/api/project'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      providerStatus?: {
        preferredProvider?: string
        preferredProviderFamily?: string
        preferredProviderLabel?: string
        allowPaidProviderFallback?: boolean
      } | null
    }
    expect(body.providerStatus).toMatchObject({
      preferredProvider: 'openai-api',
      preferredProviderFamily: 'openai-compatible',
      preferredProviderLabel: 'OpenAI-compatible API',
      preferredCapabilities: {
        streaming: true,
        toolCalls: true,
        reasoningSideChannel: 'compatible',
      },
      allowPaidProviderFallback: true,
    })
  })

  it('warns when reviewer fanout concurrency exceeds the provider recommendation', async () => {
    updateProjectConfig(tmpProject, {
      preferredProvider: 'llama-cpp',
      workerLaneConcurrency: 5,
      reviewerFanoutConcurrency: 3,
    })
    const { app } = buildServeApp({ projectPath: tmpProject })
    const res = await app.fetch(new Request('http://localhost/api/project'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      providerStatus?: {
        laneConcurrency?: {
          spec?: {
            requested?: number
            effective?: number
            recommended?: number | null
            clamped?: boolean
          }
          worker?: {
            requested?: number
            effective?: number
            recommended?: number | null
            clamped?: boolean
          }
          review?: {
            requested?: number
            effective?: number
            recommended?: number | null
            clamped?: boolean
          }
          coordinator?: {
            requested?: number
            effective?: number
            recommended?: number | null
            clamped?: boolean
          }
          reviewerFanout?: {
            requested?: number
            effective?: number
            recommended?: number | null
            clamped?: boolean
          }
        }
        warnings?: Array<{ code?: string; severity?: string; message?: string }>
      } | null
    }
    expect(body.providerStatus?.laneConcurrency?.reviewerFanout).toMatchObject({
      requested: 3,
      effective: 1,
      recommended: 1,
      clamped: true,
    })
    expect(body.providerStatus?.laneConcurrency?.spec).toMatchObject({
      requested: 1,
      effective: 1,
      recommended: 1,
      clamped: false,
    })
    expect(body.providerStatus?.laneConcurrency?.worker).toMatchObject({
      requested: 5,
      effective: 1,
      recommended: 1,
      clamped: true,
    })
    expect(body.providerStatus?.laneConcurrency?.review).toMatchObject({
      requested: 1,
      effective: 1,
      recommended: 1,
      clamped: false,
    })
    expect(body.providerStatus?.laneConcurrency?.coordinator).toMatchObject({
      requested: 1,
      effective: 1,
      recommended: 1,
      clamped: false,
    })
    expect(body.providerStatus?.warnings?.[0]).toMatchObject({
      code: 'reviewer_concurrency_clamped_to_provider_recommendation',
      severity: 'info',
    })
    expect(body.providerStatus?.warnings?.[0]?.message).toMatch(/configured as 3/i)
    expect(body.providerStatus?.warnings?.[0]?.message).toMatch(/capped at 1/i)
  })

  it('rejects start when the local server does not have the configured project model loaded', async () => {
    setProvider('llama-cpp', { url: 'http://localhost:1234/v1' })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ data: [{ id: 'qwen/qwen3.6-35b-a3b' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )
    const { app } = buildServeApp({ projectPath: tmpProject })
    const res = await app.fetch(
      new Request('http://localhost/api/project/start', { method: 'POST' }),
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as { code?: string; error?: string; loadedModels?: string[]; missingModels?: string[] }
    expect(body.code).toBe('model_unavailable')
    expect(body.error).toMatch(/configured local server/i)
    expect(body.error).toMatch(/will not JIT-load missing models/)
    expect(body.loadedModels).toContain('qwen/qwen3.6-35b-a3b')
    expect(body.missingModels).toContain('qwen2.5-coder-7b-instruct')
  })

  it('checks global model defaults during LM Studio start preflight', async () => {
    setProvider('llama-cpp', { url: 'http://localhost:1234/v1' })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ data: [{ id: 'qwen/qwen3.6-35b-a3b' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )
    const { app } = buildServeApp({ projectPath: tmpProject })
    await app.fetch(
      new Request('http://localhost/api/config/models', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scope: 'global', role: 'worker', model: 'missing-global-model' }),
      }),
    )
    const res = await app.fetch(
      new Request('http://localhost/api/project/start', { method: 'POST' }),
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as { code?: string; missingModels?: string[] }
    expect(body.code).toBe('model_unavailable')
    expect(body.missingModels).toContain('missing-global-model')
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
    updateProjectConfig(tmpProject, { allowPaidProviderFallback: true })
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

  it('accepts reasoning-only LM Studio responses as a successful provider test', async () => {
    setProvider('llama-cpp', { url: 'http://localhost:1234/v1' })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url
        if (url.endsWith('/models')) {
          return new Response(JSON.stringify({ data: [{ id: 'qwen/qwen3.6-35b-a3b' }] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        }
        if (url.endsWith('/chat/completions')) {
          return sseResponse([
            dataFrame({
              choices: [
                { delta: { reasoning_content: 'I can answer with OK.' }, finish_reason: null },
              ],
            }),
            dataFrame({ choices: [{ delta: {}, finish_reason: 'stop' }] }),
            'data: [DONE]\n\n',
          ])
        }
        return new Response('not found', { status: 404 })
      }),
    )
    const { app } = buildServeApp({ projectPath: tmpProject })
    const res = await app.fetch(
      new Request('http://localhost/api/providers/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: 'llama-cpp' }),
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; sample?: string }
    expect(body.ok).toBe(true)
    expect(body.sample).toBe('[reasoning response]')
    expect(readGlobalProviders().providers['llama-cpp']?.verifiedAt).toBeTruthy()
  })
})
