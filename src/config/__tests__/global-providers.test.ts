import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// Mock homedir so the global store lives under a per-test temp dir.
const TMP_HOME = join(tmpdir(), `guildhall-providers-test-${process.pid}`)
const TMP_GUILDHALL = join(TMP_HOME, '.guildhall')

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  return { ...actual, homedir: () => TMP_HOME }
})

const {
  readGlobalProviders,
  writeGlobalProviders,
  setProvider,
  removeProvider,
  markProviderVerified,
  resolveGlobalCredentials,
  migrateProjectProvidersToGlobal,
  globalProvidersPath,
} = await import('../global-providers.js')

describe('global providers store', () => {
  beforeEach(() => {
    mkdirSync(TMP_GUILDHALL, { recursive: true })
  })
  afterEach(() => {
    if (existsSync(TMP_GUILDHALL)) rmSync(TMP_GUILDHALL, { recursive: true, force: true })
  })

  it('readGlobalProviders returns empty default when file is missing', () => {
    const g = readGlobalProviders()
    expect(g.version).toBe(1)
    expect(g.providers).toEqual({})
  })

  it('setProvider persists an Anthropic key and survives round-trip', () => {
    setProvider('anthropic-api', { apiKey: 'sk-test-123' })
    const g = readGlobalProviders()
    expect(g.providers['anthropic-api']?.apiKey).toBe('sk-test-123')
  })

  it('setProvider preserves siblings — multi-provider is the common case', () => {
    setProvider('anthropic-api', { apiKey: 'a' })
    setProvider('openai-api', { apiKey: 'o', baseUrl: 'https://integrate.api.nvidia.com/v1' })
    setProvider('llama-cpp', { url: 'http://localhost:1234/v1' })
    const g = readGlobalProviders()
    expect(g.providers['anthropic-api']?.apiKey).toBe('a')
    expect(g.providers['openai-api']?.apiKey).toBe('o')
    expect(g.providers['openai-api']?.baseUrl).toBe('https://integrate.api.nvidia.com/v1')
    expect(g.providers['llama-cpp']?.url).toBe('http://localhost:1234/v1')
  })

  it('removeProvider is idempotent and leaves siblings intact', () => {
    setProvider('anthropic-api', { apiKey: 'a' })
    setProvider('openai-api', { apiKey: 'o' })
    removeProvider('anthropic-api')
    removeProvider('anthropic-api') // second call must not throw
    const g = readGlobalProviders()
    expect(g.providers['anthropic-api']).toBeUndefined()
    expect(g.providers['openai-api']?.apiKey).toBe('o')
  })

  it('markProviderVerified updates timestamp without clobbering credential material', () => {
    setProvider('anthropic-api', { apiKey: 'keep-me' })
    markProviderVerified('anthropic-api', '2026-04-24T12:00:00Z')
    const g = readGlobalProviders()
    expect(g.providers['anthropic-api']?.apiKey).toBe('keep-me')
    expect(g.providers['anthropic-api']?.verifiedAt).toBe('2026-04-24T12:00:00Z')
  })

  it('markProviderVerified for OAuth creates a bare entry (credential lives elsewhere)', () => {
    markProviderVerified('claude-oauth', '2026-04-24T12:00:00Z')
    const g = readGlobalProviders()
    expect(g.providers['claude-oauth']?.verifiedAt).toBe('2026-04-24T12:00:00Z')
  })

  it('markProviderVerified is a no-op for credentialed kinds with no material', () => {
    // We don't want "verified" floating without an apiKey — that would lie to
    // the UI about configured state.
    markProviderVerified('anthropic-api', '2026-04-24T12:00:00Z')
    const g = readGlobalProviders()
    expect(g.providers['anthropic-api']).toBeUndefined()
  })

  it('rejects malformed YAML with a clear path in the error', () => {
    mkdirSync(TMP_GUILDHALL, { recursive: true })
    writeFileSync(
      globalProvidersPath(),
      'version: 1\nproviders:\n  anthropic-api: {}\n', // missing apiKey
      'utf8',
    )
    expect(() => readGlobalProviders()).toThrow(/anthropic-api/)
  })

  it('writes provider file with 0600 perms — credentials must not be world-readable', () => {
    setProvider('anthropic-api', { apiKey: 'sensitive' })
    const mode = statSync(globalProvidersPath()).mode & 0o777
    // Some filesystems (FAT, certain CI containers) don't honor chmod; accept
    // any mode that isn't world-readable for 'other'.
    expect(mode & 0o004).toBe(0)
  })

  it('writes commented placeholder keys so the file documents the schema', () => {
    setProvider('llama-cpp', { url: 'http://minipc:1234/v1' })
    const raw = readFileSync(globalProvidersPath(), 'utf8')
    expect(raw).toMatch(/# anthropic-api:/)
    expect(raw).toMatch(/#   apiKey: "sk-ant-\.\.\."/)
    expect(raw).toMatch(/# openai-api:/)
    expect(raw).toMatch(/#   apiKey: "sk-\.\.\."/)
    expect(raw).toMatch(/#   baseUrl: "https:\/\/api\.openai\.com\/v1"/)
    expect(raw).toMatch(/llama-cpp:\n    url: "http:\/\/minipc:1234\/v1"/)
  })

  describe('resolveGlobalCredentials', () => {
    it('returns empty object when nothing configured and no env vars', () => {
      const r = resolveGlobalCredentials(readGlobalProviders(), {})
      expect(r).toEqual({})
    })

    it('reads from the global store when env vars are absent', () => {
      setProvider('anthropic-api', { apiKey: 'store-key' })
      setProvider('openai-api', { apiKey: 'openai-key', baseUrl: 'https://integrate.api.nvidia.com/v1' })
      setProvider('llama-cpp', { url: 'http://localhost:8080/v1' })
      const r = resolveGlobalCredentials(readGlobalProviders(), {})
      expect(r.anthropicApiKey).toBe('store-key')
      expect(r.openaiApiKey).toBe('openai-key')
      expect(r.openaiBaseUrl).toBe('https://integrate.api.nvidia.com/v1')
      expect(r.llamaCppUrl).toBe('http://localhost:8080/v1')
    })

    it('env vars override the stored values (precedence: env > store)', () => {
      setProvider('anthropic-api', { apiKey: 'store-key' })
      const r = resolveGlobalCredentials(readGlobalProviders(), {
        ANTHROPIC_API_KEY: 'env-key',
      })
      expect(r.anthropicApiKey).toBe('env-key')
    })

    it('treats whitespace-only env vars as unset (fallthrough to store)', () => {
      setProvider('anthropic-api', { apiKey: 'store-key' })
      const r = resolveGlobalCredentials(readGlobalProviders(), {
        ANTHROPIC_API_KEY: '   ',
      })
      expect(r.anthropicApiKey).toBe('store-key')
    })

    it('lets OPENAI_BASE_URL override the stored OpenAI-compatible base URL', () => {
      setProvider('openai-api', { apiKey: 'store-key', baseUrl: 'https://integrate.api.nvidia.com/v1' })
      const r = resolveGlobalCredentials(readGlobalProviders(), {
        OPENAI_BASE_URL: 'https://api.openai.com/v1',
      })
      expect(r.openaiApiKey).toBe('store-key')
      expect(r.openaiBaseUrl).toBe('https://api.openai.com/v1')
    })

    it('honors LM_STUDIO_BASE_URL as an alias for LLAMA_CPP_URL', () => {
      const r = resolveGlobalCredentials(readGlobalProviders(), {
        LM_STUDIO_BASE_URL: 'http://lmstudio:1234/v1',
      })
      expect(r.llamaCppUrl).toBe('http://lmstudio:1234/v1')
    })
  })

  // The migration moves API keys from each project's .guildhall/config.yaml
  // into the global store on first read. This protects users whose older
  // setups put an Anthropic key in a project config — after the migration,
  // a single global store is the source of truth and the project file no
  // longer carries secrets.
  describe('migrateProjectProvidersToGlobal', () => {
    it('moves anthropic + openai + lmStudioUrl from project config to global store', () => {
      const writes: Array<Record<string, unknown>> = []
      const report = migrateProjectProvidersToGlobal('/fake/project', {
        readProject: () => ({
          anthropicApiKey: 'proj-anthropic',
          openaiApiKey: 'proj-openai',
          lmStudioUrl: 'http://custom-llama:8080/v1',
        }),
        writeProject: (_p, patch) => {
          writes.push(patch)
        },
      })
      expect(report.movedAnthropic).toBe(true)
      expect(report.movedOpenAi).toBe(true)
      expect(report.movedLlamaUrl).toBe(true)
      // Global store now has the migrated values.
      const g = readGlobalProviders()
      expect(g.providers['anthropic-api']?.apiKey).toBe('proj-anthropic')
      expect(g.providers['openai-api']?.apiKey).toBe('proj-openai')
      expect(g.providers['llama-cpp']?.url).toBe('http://custom-llama:8080/v1')
      // Project was asked to strip the migrated keys.
      expect(writes.length).toBe(1)
      expect(writes[0]).toHaveProperty('anthropicApiKey', undefined)
      expect(writes[0]).toHaveProperty('openaiApiKey', undefined)
      expect(writes[0]).toHaveProperty('lmStudioUrl', undefined)
    })

    it('skips the default lmStudioUrl (http://localhost:1234/v1) so we do not migrate a schema default', () => {
      const writes: Array<Record<string, unknown>> = []
      const report = migrateProjectProvidersToGlobal('/fake/project', {
        readProject: () => ({
          lmStudioUrl: 'http://localhost:1234/v1',
        }),
        writeProject: (_p, patch) => {
          writes.push(patch)
        },
      })
      expect(report.movedLlamaUrl).toBe(false)
      expect(writes.length).toBe(0)
    })

    it('is a no-op when the project has no secrets (safe to call every read)', () => {
      const writes: Array<Record<string, unknown>> = []
      const report = migrateProjectProvidersToGlobal('/fake/project', {
        readProject: () => ({}),
        writeProject: (_p, patch) => {
          writes.push(patch)
        },
      })
      expect(report.movedAnthropic).toBe(false)
      expect(report.movedOpenAi).toBe(false)
      expect(report.movedLlamaUrl).toBe(false)
      expect(writes.length).toBe(0)
    })

    it('global value wins over project value when both are present', () => {
      setProvider('anthropic-api', { apiKey: 'global-existing' })
      const writes: Array<Record<string, unknown>> = []
      migrateProjectProvidersToGlobal('/fake/project', {
        readProject: () => ({ anthropicApiKey: 'proj-newer' }),
        writeProject: (_p, patch) => {
          writes.push(patch)
        },
      })
      const g = readGlobalProviders()
      // Global is unchanged; we do not overwrite an existing global value.
      expect(g.providers['anthropic-api']?.apiKey).toBe('global-existing')
      // But the project file is still cleaned up — no duplicate secret on
      // disk.
      expect(writes[0]).toHaveProperty('anthropicApiKey', undefined)
    })
  })
})
