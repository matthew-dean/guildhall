import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { Buffer } from 'node:buffer'
import { selectApiClient } from '../provider-selection.js'

let tmpDir: string
let claudeCredPath: string
let codexCredPath: string
let savedLlamaUrl: string | undefined
let savedForcedProvider: string | undefined

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-provider-'))
  claudeCredPath = path.join(tmpDir, 'claude.json')
  codexCredPath = path.join(tmpDir, 'codex.json')
  savedLlamaUrl = process.env.LLAMA_CPP_URL
  savedForcedProvider = process.env.GUILDHALL_PROVIDER
  delete process.env.LLAMA_CPP_URL
  delete process.env.GUILDHALL_PROVIDER
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
  if (savedLlamaUrl === undefined) delete process.env.LLAMA_CPP_URL
  else process.env.LLAMA_CPP_URL = savedLlamaUrl
  if (savedForcedProvider === undefined) delete process.env.GUILDHALL_PROVIDER
  else process.env.GUILDHALL_PROVIDER = savedForcedProvider
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
