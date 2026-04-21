import { Buffer } from 'node:buffer'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  CodexCredentialMissingError,
  extractChatgptAccountId,
  readCodexCredentials,
} from '../auth/codex-credentials.js'

let tempDir: string

beforeEach(async () => {
  tempDir = await fs.mkdtemp(join(tmpdir(), 'guildhall-codex-creds-'))
})
afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true })
})

function makeJwt(payload: Record<string, unknown>): string {
  const encode = (v: unknown) =>
    Buffer.from(JSON.stringify(v))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(payload)}.sig`
}

describe('extractChatgptAccountId', () => {
  it('pulls the chatgpt_account_id claim out of a JWT', () => {
    const jwt = makeJwt({
      'https://api.openai.com/auth': { chatgpt_account_id: 'acct_123' },
    })
    expect(extractChatgptAccountId(jwt)).toBe('acct_123')
  })

  it('returns null when the claim is missing', () => {
    const jwt = makeJwt({ sub: 'user_999' })
    expect(extractChatgptAccountId(jwt)).toBeNull()
  })

  it('returns null when the JWT is malformed', () => {
    expect(extractChatgptAccountId('not-a-jwt')).toBeNull()
  })
})

describe('readCodexCredentials', () => {
  it('loads tokens + account id from the upstream auth.json shape', async () => {
    const jwt = makeJwt({
      'https://api.openai.com/auth': { chatgpt_account_id: 'acct_abc' },
    })
    const path = join(tempDir, 'auth.json')
    await fs.writeFile(
      path,
      JSON.stringify({ tokens: { access_token: jwt, refresh_token: 'rt' } }),
    )
    const cred = await readCodexCredentials({ path })
    expect(cred).toEqual({
      accessToken: jwt,
      refreshToken: 'rt',
      chatgptAccountId: 'acct_abc',
    })
  })

  it('prefers an explicit account_id over the JWT claim', async () => {
    const jwt = makeJwt({
      'https://api.openai.com/auth': { chatgpt_account_id: 'jwt_account' },
    })
    const path = join(tempDir, 'auth.json')
    await fs.writeFile(
      path,
      JSON.stringify({
        tokens: { access_token: jwt, refresh_token: 'rt', account_id: 'explicit' },
      }),
    )
    const cred = await readCodexCredentials({ path })
    expect(cred.chatgptAccountId).toBe('explicit')
  })

  it('throws when the file is missing', async () => {
    await expect(
      readCodexCredentials({ path: join(tempDir, 'nope.json') }),
    ).rejects.toBeInstanceOf(CodexCredentialMissingError)
  })

  it('throws when tokens section is empty', async () => {
    const path = join(tempDir, 'auth.json')
    await fs.writeFile(path, JSON.stringify({ tokens: {} }))
    await expect(readCodexCredentials({ path })).rejects.toBeInstanceOf(
      CodexCredentialMissingError,
    )
  })
})
