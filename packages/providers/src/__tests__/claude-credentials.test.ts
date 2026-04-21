import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  ClaudeCredentialMissingError,
  isClaudeCredentialExpired,
  readClaudeCredentials,
  refreshClaudeOauthCredential,
  writeClaudeCredentials,
} from '../auth/claude-credentials.js'

let tempDir: string

beforeEach(async () => {
  tempDir = await fs.mkdtemp(join(tmpdir(), 'guildhall-claude-creds-'))
})
afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true })
})

describe('readClaudeCredentials', () => {
  it('reads the upstream credential shape', async () => {
    const path = join(tempDir, 'creds.json')
    await fs.writeFile(
      path,
      JSON.stringify({
        claudeAiOauth: {
          accessToken: 'at',
          refreshToken: 'rt',
          expiresAt: 1000,
          scopes: ['user:profile'],
          subscriptionType: 'pro',
        },
      }),
    )
    const cred = await readClaudeCredentials({ path })
    expect(cred).toEqual({
      accessToken: 'at',
      refreshToken: 'rt',
      expiresAt: 1000,
      scopes: ['user:profile'],
      subscriptionType: 'pro',
    })
  })

  it('throws ClaudeCredentialMissingError when the file is missing', async () => {
    await expect(
      readClaudeCredentials({ path: join(tempDir, 'nope.json') }),
    ).rejects.toBeInstanceOf(ClaudeCredentialMissingError)
  })

  it('throws ClaudeCredentialMissingError when the payload is malformed', async () => {
    const path = join(tempDir, 'bad.json')
    await fs.writeFile(path, JSON.stringify({ claudeAiOauth: { accessToken: 'only' } }))
    await expect(readClaudeCredentials({ path })).rejects.toBeInstanceOf(
      ClaudeCredentialMissingError,
    )
  })
})

describe('isClaudeCredentialExpired', () => {
  it('is true when expiresAt is in the past', () => {
    expect(
      isClaudeCredentialExpired(
        { accessToken: 'a', refreshToken: 'r', expiresAt: 500 },
        1000,
      ),
    ).toBe(true)
  })
  it('is true when expiresAt is within the 60s skew', () => {
    const now = 1_000_000
    expect(
      isClaudeCredentialExpired(
        { accessToken: 'a', refreshToken: 'r', expiresAt: now + 30_000 },
        now,
      ),
    ).toBe(true)
  })
  it('is false when expiresAt is safely in the future', () => {
    const now = 1_000_000
    expect(
      isClaudeCredentialExpired(
        { accessToken: 'a', refreshToken: 'r', expiresAt: now + 5 * 60_000 },
        now,
      ),
    ).toBe(false)
  })
})

describe('refreshClaudeOauthCredential', () => {
  it('POSTs to the first endpoint and returns the new credential', async () => {
    const calls: string[] = []
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      calls.push(url)
      const body = JSON.parse((init?.body as string) ?? '{}') as {
        refresh_token?: string
        client_id?: string
      }
      expect(body.refresh_token).toBe('rt')
      expect(body.client_id).toBe('9d1c250a-e61b-44d9-88ed-5944d1962f5e')
      return new Response(
        JSON.stringify({
          access_token: 'new-at',
          refresh_token: 'new-rt',
          expires_in: 3600,
          scope: 'user:profile user:inference',
        }),
        { status: 200 },
      )
    }) as unknown as typeof fetch
    const cred = await refreshClaudeOauthCredential('rt', { fetch: fakeFetch })
    expect(cred.accessToken).toBe('new-at')
    expect(cred.refreshToken).toBe('new-rt')
    expect(cred.expiresAt).toBeGreaterThan(Date.now())
    expect(cred.scopes).toEqual(['user:profile', 'user:inference'])
    expect(calls).toHaveLength(1)
  })

  it('falls back to the second endpoint when the first returns non-2xx', async () => {
    const calls: string[] = []
    const fakeFetch = (async (url: string) => {
      calls.push(url)
      if (calls.length === 1) return new Response('boom', { status: 500 })
      return new Response(
        JSON.stringify({
          access_token: 'fallback-at',
          refresh_token: 'fallback-rt',
          expires_in: 100,
        }),
        { status: 200 },
      )
    }) as unknown as typeof fetch
    const cred = await refreshClaudeOauthCredential('rt', { fetch: fakeFetch })
    expect(cred.accessToken).toBe('fallback-at')
    expect(calls).toHaveLength(2)
  })
})

describe('writeClaudeCredentials round-trip', () => {
  it('writes and re-reads the same credential', async () => {
    const path = join(tempDir, 'nested', 'creds.json')
    const original = {
      accessToken: 'at',
      refreshToken: 'rt',
      expiresAt: Date.now() + 10_000,
    }
    await writeClaudeCredentials(original, { path })
    const reloaded = await readClaudeCredentials({ path })
    expect(reloaded).toEqual(original)
  })
})
