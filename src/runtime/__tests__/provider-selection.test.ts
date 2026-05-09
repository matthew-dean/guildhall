import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { Buffer } from 'node:buffer'
import { selectApiClient, inferPreferredProvider } from '../provider-selection.js'
import { clearProviderClientPool } from '../provider-client-pool.js'

let tmpDir: string
let claudeCredPath: string
let codexCredPath: string
const CLEAN_ENV_KEYS = [
  'LLAMA_CPP_URL',
  'LM_STUDIO_BASE_URL',
  'GUILDHALL_PROVIDER',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
] as const
const savedEnv: Record<string, string | undefined> = {}

beforeEach(async () => {
  clearProviderClientPool()
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-provider-'))
  claudeCredPath = path.join(tmpDir, 'claude.json')
  codexCredPath = path.join(tmpDir, 'codex.json')
  for (const k of CLEAN_ENV_KEYS) {
    savedEnv[k] = process.env[k]
    delete process.env[k]
  }
})

afterEach(async () => {
  clearProviderClientPool()
  await fs.rm(tmpDir, { recursive: true, force: true })
  for (const k of CLEAN_ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
})

function writeClaudeCred(): Promise<void> {
  const cred = {
    claudeAiOauth: {
      accessToken: 'sk-test-access',
      refreshToken: 'sk-test-refresh',
      expiresAt: Date.now() + 60 * 60 * 1000,
    },
  }
  return fs.writeFile(claudeCredPath, JSON.stringify(cred), 'utf8')
}

function writeCodexCred(): Promise<void> {
  // Codex credentials: a JWT with the chatgpt account id claim, plus refresh
  // token. We fabricate a JWT payload with just the claim we need.
  const payload = {
    'https://api.openai.com/auth': { chatgpt_account_id: 'acct-test-1234' },
  }
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8')
    .toString('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
  const fakeJwt = `header.${encoded}.sig`
  const cred = {
    tokens: {
      access_token: fakeJwt,
      refresh_token: 'rt-test',
      account_id: 'acct-test-1234',
    },
  }
  return fs.writeFile(codexCredPath, JSON.stringify(cred), 'utf8')
}

describe('selectApiClient', () => {
  // ---------- Fallthrough to "none" ----------

  it('returns providerName="none" when no provider is configured', async () => {
    const result = await selectApiClient({
      claudeCredentialPath: claudeCredPath,
      codexCredentialPath: codexCredPath,
    })
    expect(result.providerName).toBe('none')
    expect(result.reason).toMatch(/No provider configured/i)
    expect(result.reason).toMatch(/claude login/)
    expect(result.reason).toMatch(/codex auth login/)
    expect(result.reason).toMatch(/LLAMA_CPP_URL/)
    expect(result.apiClient).toBeDefined()
  })

  it('the "none" client throws when streamMessage is actually called', async () => {
    const { apiClient } = await selectApiClient({
      claudeCredentialPath: claudeCredPath,
      codexCredentialPath: codexCredPath,
    })
    expect(() =>
      apiClient.streamMessage({
        model: 'm',
        messages: [],
        max_tokens: 1024,
        tools: [],
      }),
    ).toThrow(/provider not implemented/i)
  })

  // ---------- Resolution order ----------

  it('returns a ClaudeOauthClient when Claude credentials are present', async () => {
    await writeClaudeCred()
    const result = await selectApiClient({
      claudeCredentialPath: claudeCredPath,
      codexCredentialPath: codexCredPath,
    })
    expect(result.providerName).toBe('claude-oauth')
    expect(result.reason).toBeUndefined()
    expect(result.apiClient).toBeDefined()
  })

  it('falls through to Codex OAuth when Claude credentials missing but Codex present', async () => {
    await writeCodexCred()
    const result = await selectApiClient({
      claudeCredentialPath: claudeCredPath,
      codexCredentialPath: codexCredPath,
    })
    expect(result.providerName).toBe('codex-oauth')
    expect(result.apiClient).toBeDefined()
  })

  it('prefers Claude OAuth over Codex OAuth when both are available', async () => {
    await writeClaudeCred()
    await writeCodexCred()
    const result = await selectApiClient({
      claudeCredentialPath: claudeCredPath,
      codexCredentialPath: codexCredPath,
    })
    expect(result.providerName).toBe('claude-oauth')
  })

  it('falls through to llama.cpp when no OAuth creds but LLAMA_CPP_URL is set', async () => {
    process.env.LLAMA_CPP_URL = 'http://127.0.0.1:9999/v1'
    const result = await selectApiClient({
      claudeCredentialPath: claudeCredPath,
      codexCredentialPath: codexCredPath,
    })
    expect(result.providerName).toBe('llama-cpp')
    expect(result.reason).toMatch(/127\.0\.0\.1:9999/)
  })

  it('accepts an explicit llamaCppUrl option without env var', async () => {
    const result = await selectApiClient({
      claudeCredentialPath: claudeCredPath,
      codexCredentialPath: codexCredPath,
      llamaCppUrl: 'http://localhost:8080/v1',
    })
    expect(result.providerName).toBe('llama-cpp')
  })

  it('does NOT probe the network for llama.cpp when no URL is configured', async () => {
    // This is the opt-in contract — we must never hit the network in test
    // runs that don't mention llama.cpp.
    const result = await selectApiClient({
      claudeCredentialPath: claudeCredPath,
      codexCredentialPath: codexCredPath,
    })
    expect(result.providerName).toBe('none')
  })

  // ---------- Forced provider ----------

  it('honors the `provider` option to force Claude even when others are available', async () => {
    await writeClaudeCred()
    const result = await selectApiClient({
      provider: 'claude-oauth',
      claudeCredentialPath: claudeCredPath,
      codexCredentialPath: codexCredPath,
    })
    expect(result.providerName).toBe('claude-oauth')
  })

  it('fails with a clear reason when forced provider is unavailable', async () => {
    const result = await selectApiClient({
      provider: 'codex-oauth',
      claudeCredentialPath: claudeCredPath,
      codexCredentialPath: codexCredPath,
    })
    expect(result.providerName).toBe('none')
    expect(result.reason).toMatch(/codex-oauth forced but unavailable/i)
    expect(result.reason).toMatch(/codex auth login/)
  })

  it('reads GUILDHALL_PROVIDER env var as the forced provider', async () => {
    process.env.GUILDHALL_PROVIDER = 'llama-cpp'
    const result = await selectApiClient({
      claudeCredentialPath: claudeCredPath,
      codexCredentialPath: codexCredPath,
      llamaCppUrl: 'http://localhost:8080/v1',
    })
    expect(result.providerName).toBe('llama-cpp')
  })

  it('forced llama-cpp without a URL fails with a clear reason', async () => {
    const result = await selectApiClient({
      provider: 'llama-cpp',
      claudeCredentialPath: claudeCredPath,
      codexCredentialPath: codexCredPath,
    })
    expect(result.providerName).toBe('none')
    expect(result.reason).toMatch(/LLAMA_CPP_URL/)
  })

  // ---------- API-key providers ----------

  it('selects anthropic-api when an Anthropic API key is provided', async () => {
    const result = await selectApiClient({
      claudeCredentialPath: claudeCredPath,
      codexCredentialPath: codexCredPath,
      anthropicApiKey: 'sk-ant-test',
    })
    expect(result.providerName).toBe('anthropic-api')
    expect(result.reason).toMatch(/Anthropic API key/)
  })

  it('selects openai-api when an OpenAI API key is provided and no higher-priority provider is configured', async () => {
    const result = await selectApiClient({
      claudeCredentialPath: claudeCredPath,
      codexCredentialPath: codexCredPath,
      openaiApiKey: 'sk-openai-test',
    })
    expect(result.providerName).toBe('openai-api')
    expect(result.reason).toMatch(/OpenAI API key/)
  })

  it('reports the configured OpenAI-compatible base URL when one is provided', async () => {
    const result = await selectApiClient({
      claudeCredentialPath: claudeCredPath,
      codexCredentialPath: codexCredPath,
      openaiApiKey: 'sk-openai-test',
      openaiBaseUrl: 'https://integrate.api.nvidia.com/v1',
    })
    expect(result.providerName).toBe('openai-api')
    expect(result.reason).toMatch(/integrate\.api\.nvidia\.com/)
  })

  it('reuses the same OpenAI-compatible API client for equivalent runtime config', async () => {
    const a = await selectApiClient({
      claudeCredentialPath: claudeCredPath,
      codexCredentialPath: codexCredPath,
      openaiApiKey: 'sk-openai-test',
      openaiBaseUrl: 'https://integrate.api.nvidia.com/v1',
    })
    const b = await selectApiClient({
      claudeCredentialPath: claudeCredPath,
      codexCredentialPath: codexCredPath,
      openaiApiKey: 'sk-openai-test',
      openaiBaseUrl: 'https://integrate.api.nvidia.com/v1',
    })
    expect(a.providerName).toBe('openai-api')
    expect(a.apiClient).toBe(b.apiClient)
  })

  it('reuses the same local-server client for equivalent runtime config', async () => {
    const a = await selectApiClient({
      claudeCredentialPath: claudeCredPath,
      codexCredentialPath: codexCredPath,
      llamaCppUrl: 'http://localhost:1234/v1',
    })
    const b = await selectApiClient({
      claudeCredentialPath: claudeCredPath,
      codexCredentialPath: codexCredPath,
      llamaCppUrl: 'http://localhost:1234/v1',
    })
    expect(a.providerName).toBe('llama-cpp')
    expect(a.apiClient).toBe(b.apiClient)
  })

  it('does not pool Claude OAuth clients because they carry resumable session identity', async () => {
    await writeClaudeCred()
    const a = await selectApiClient({
      claudeCredentialPath: claudeCredPath,
      codexCredentialPath: codexCredPath,
    })
    const b = await selectApiClient({
      claudeCredentialPath: claudeCredPath,
      codexCredentialPath: codexCredPath,
    })
    expect(a.providerName).toBe('claude-oauth')
    expect(a.apiClient).not.toBe(b.apiClient)
  })

  it('reads ANTHROPIC_API_KEY from the environment', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-env'
    const result = await selectApiClient({
      claudeCredentialPath: claudeCredPath,
      codexCredentialPath: codexCredPath,
    })
    expect(result.providerName).toBe('anthropic-api')
  })

  it('prefers Claude OAuth over a pasted Anthropic API key when both exist', async () => {
    await writeClaudeCred()
    const result = await selectApiClient({
      claudeCredentialPath: claudeCredPath,
      codexCredentialPath: codexCredPath,
      anthropicApiKey: 'sk-ant-test',
    })
    expect(result.providerName).toBe('claude-oauth')
  })

  it('forced anthropic-api without a key fails with a clear reason', async () => {
    const result = await selectApiClient({
      provider: 'anthropic-api',
      claudeCredentialPath: claudeCredPath,
      codexCredentialPath: codexCredPath,
    })
    expect(result.providerName).toBe('none')
    expect(result.reason).toMatch(/anthropic-api forced/i)
    expect(result.reason).toMatch(/ANTHROPIC_API_KEY|dashboard/)
  })

  it('reads LM_STUDIO_BASE_URL as an alias for LLAMA_CPP_URL', async () => {
    process.env.LM_STUDIO_BASE_URL = 'http://127.0.0.1:1234/v1'
    const result = await selectApiClient({
      claudeCredentialPath: claudeCredPath,
      codexCredentialPath: codexCredPath,
    })
    expect(result.providerName).toBe('llama-cpp')
  })

  // ---------- preferredProvider (non-forcing) ----------

  it('honors preferredProvider when reachable (maps wire key "codex" → codex-oauth)', async () => {
    await writeClaudeCred()
    await writeCodexCred()
    const result = await selectApiClient({
      preferredProvider: 'codex',
      claudeCredentialPath: claudeCredPath,
      codexCredentialPath: codexCredPath,
    })
    expect(result.providerName).toBe('codex-oauth')
  })

  it('does not fall through to a paid provider when preferredProvider is unreachable by default', async () => {
    await writeClaudeCred()
    const result = await selectApiClient({
      preferredProvider: 'llama-cpp',
      claudeCredentialPath: claudeCredPath,
      codexCredentialPath: codexCredPath,
    })
    expect(result.providerName).toBe('none')
    expect(result.reason).toMatch(/Paid-provider fallback is disabled/)
  })

  it('falls through to the normal chain when paid-provider fallback is enabled', async () => {
    await writeClaudeCred()
    const result = await selectApiClient({
      preferredProvider: 'llama-cpp',
      allowPaidProviderFallback: true,
      claudeCredentialPath: claudeCredPath,
      codexCredentialPath: codexCredPath,
    })
    expect(result.providerName).toBe('claude-oauth')
  })

  it('preferredProvider=openai-api with key picks openai-api even when llama is also reachable', async () => {
    const result = await selectApiClient({
      preferredProvider: 'openai-api',
      claudeCredentialPath: claudeCredPath,
      codexCredentialPath: codexCredPath,
      openaiApiKey: 'sk-openai-test',
      llamaCppUrl: 'http://localhost:1234/v1',
    })
    expect(result.providerName).toBe('openai-api')
  })

  // ---------- Error propagation ----------

  it('propagates malformed Claude credentials as a parse error', async () => {
    await fs.writeFile(claudeCredPath, '{not valid json', 'utf8')
    await expect(
      selectApiClient({
        claudeCredentialPath: claudeCredPath,
        codexCredentialPath: codexCredPath,
      }),
    ).rejects.toThrow()
  })

  it('propagates malformed Codex credentials when Claude missing', async () => {
    await fs.writeFile(codexCredPath, '{not valid json', 'utf8')
    await expect(
      selectApiClient({
        claudeCredentialPath: claudeCredPath,
        codexCredentialPath: codexCredPath,
      }),
    ).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// inferPreferredProvider — model-id → provider inference
//
// Repro: a project configured qwen/qwen3.6-35b-a3b for every role but had no
// explicit preferredProvider. The normal resolution order picked Codex (the
// first reachable OAuth), which rejected the qwen model at the first API call
// and stuck the orchestrator in a user-message retry loop. The inference
// helper exists to let the orchestrator pre-populate preferredProvider when
// the configured models unambiguously point at one provider.
// ---------------------------------------------------------------------------

describe('inferPreferredProvider', () => {
  it('returns "llama-cpp" when every role is a known lm-studio catalog model', () => {
    const result = inferPreferredProvider({
      spec: 'qwen2.5-coder-32b-instruct',
      coordinator: 'qwen2.5-coder-32b-instruct',
      worker: 'qwen2.5-coder-32b-instruct',
      reviewer: 'qwen2.5-coder-14b-instruct',
      gateChecker: 'qwen2.5-coder-7b-instruct',
    })
    expect(result).toBe('llama-cpp')
  })

  it('returns "llama-cpp" for unlisted ids that heuristically look local (qwen/, deepseek/, llama/…)', () => {
    const result = inferPreferredProvider({
      spec: 'qwen/qwen3.6-35b-a3b',
      coordinator: 'qwen/qwen3.6-35b-a3b',
      worker: 'qwen/qwen3.6-35b-a3b',
      reviewer: 'qwen/qwen3.6-35b-a3b',
      gateChecker: 'qwen/qwen3.6-35b-a3b',
    })
    expect(result).toBe('llama-cpp')
  })

  it('returns "claude-oauth" when every role is a claude-* model', () => {
    const result = inferPreferredProvider({
      spec: 'claude-sonnet-4-6',
      coordinator: 'claude-sonnet-4-6',
      worker: 'claude-sonnet-4-6',
      reviewer: 'claude-haiku-4-5-20251001',
      gateChecker: 'claude-haiku-4-5-20251001',
    })
    expect(result).toBe('claude-oauth')
  })

  it('returns "openai-api" when every role is a gpt-* model', () => {
    const result = inferPreferredProvider({
      spec: 'gpt-4o',
      coordinator: 'gpt-4o',
      worker: 'gpt-4o',
      reviewer: 'gpt-4o-mini',
      gateChecker: 'gpt-4o-mini',
    })
    expect(result).toBe('openai-api')
  })

  it('returns undefined when roles disagree (mixed providers)', () => {
    const result = inferPreferredProvider({
      spec: 'claude-sonnet-4-6',
      coordinator: 'claude-sonnet-4-6',
      worker: 'qwen2.5-coder-32b-instruct',
      reviewer: 'claude-haiku-4-5-20251001',
      gateChecker: 'qwen2.5-coder-7b-instruct',
    })
    expect(result).toBeUndefined()
  })

  it('returns undefined when no role has a recognisable provider', () => {
    const result = inferPreferredProvider({
      spec: 'mystery-model',
      coordinator: 'mystery-model',
      worker: 'mystery-model',
      reviewer: 'mystery-model',
      gateChecker: 'mystery-model',
    })
    expect(result).toBeUndefined()
  })
})
