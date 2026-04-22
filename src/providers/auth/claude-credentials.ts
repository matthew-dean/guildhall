/**
 * Ported from openharness/src/openharness/auth/external.py (Claude OAuth parts).
 * Upstream: https://github.com/HKUDS/OpenHarness (MIT)
 * Upstream SHA at port time: 559ba76f237db957a1a21453170df8500479dc7d
 *
 * Changes from upstream:
 *   - Python `requests` + `keyring` → native `fetch` + file-backed credential
 *     store only. macOS-keychain binding is deferred; most Claude Code users
 *     have the file-backed credentials already.
 *   - Upstream `default_binding_for_provider` chose file vs keychain based on
 *     `sys.platform`; we always read `~/.claude/.credentials.json` in this
 *     pass. If neither file nor an explicit override is present the caller
 *     gets a typed error telling them how to authenticate.
 *   - Pydantic models → plain TS types.
 */

import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const CLAUDE_OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'
export const CLAUDE_OAUTH_TOKEN_ENDPOINTS = [
  'https://platform.claude.com/v1/oauth/token',
  'https://console.anthropic.com/v1/oauth/token',
] as const

const CREDENTIAL_EXPIRY_SKEW_MS = 60_000
const DEFAULT_CREDENTIAL_PATH = join(homedir(), '.claude', '.credentials.json')

export interface ClaudeOauthCredential {
  accessToken: string
  refreshToken: string
  /** Unix ms; matches upstream file format (`expiresAt`). */
  expiresAt: number
  scopes?: string[]
  subscriptionType?: string
}

export class ClaudeCredentialMissingError extends Error {
  constructor(path: string) {
    super(
      `No Claude OAuth credentials found at ${path}. Run \`claude auth login\` (or set CLAUDE_CREDENTIALS_PATH).`,
    )
    this.name = 'ClaudeCredentialMissingError'
  }
}

export class ClaudeCredentialRefreshError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ClaudeCredentialRefreshError'
  }
}

export interface ReadClaudeCredentialOptions {
  path?: string
}

/**
 * Load Claude OAuth credentials from `~/.claude/.credentials.json`. The
 * schema upstream writes is:
 *   { "claudeAiOauth": { "accessToken", "refreshToken", "expiresAt", "scopes"?, "subscriptionType"? } }
 */
export async function readClaudeCredentials(
  opts: ReadClaudeCredentialOptions = {},
): Promise<ClaudeOauthCredential> {
  const path = opts.path ?? process.env.CLAUDE_CREDENTIALS_PATH ?? DEFAULT_CREDENTIAL_PATH
  let raw: string
  try {
    raw = await fs.readFile(path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      throw new ClaudeCredentialMissingError(path)
    }
    throw err
  }
  const parsed = JSON.parse(raw) as { claudeAiOauth?: Partial<ClaudeOauthCredential> }
  const cred = parsed.claudeAiOauth
  if (!cred || !cred.accessToken || !cred.refreshToken || typeof cred.expiresAt !== 'number') {
    throw new ClaudeCredentialMissingError(path)
  }
  return {
    accessToken: cred.accessToken,
    refreshToken: cred.refreshToken,
    expiresAt: cred.expiresAt,
    ...(cred.scopes ? { scopes: cred.scopes } : {}),
    ...(cred.subscriptionType ? { subscriptionType: cred.subscriptionType } : {}),
  }
}

export function isClaudeCredentialExpired(
  cred: ClaudeOauthCredential,
  now: number = Date.now(),
): boolean {
  return cred.expiresAt <= now + CREDENTIAL_EXPIRY_SKEW_MS
}

export interface RefreshClaudeOauthOptions {
  fetch?: typeof fetch
  endpoints?: readonly string[]
  clientId?: string
}

/**
 * POST the refresh token to Claude's OAuth endpoints. Upstream tries
 * platform.claude.com first, falls back to console.anthropic.com.
 */
export async function refreshClaudeOauthCredential(
  refreshToken: string,
  opts: RefreshClaudeOauthOptions = {},
): Promise<ClaudeOauthCredential> {
  const f = opts.fetch ?? fetch
  const endpoints = opts.endpoints ?? CLAUDE_OAUTH_TOKEN_ENDPOINTS
  const clientId = opts.clientId ?? CLAUDE_OAUTH_CLIENT_ID

  const errors: string[] = []
  for (const endpoint of endpoints) {
    try {
      const res = await f(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: clientId,
        }),
      })
      if (!res.ok) {
        errors.push(`${endpoint}: HTTP ${res.status}`)
        continue
      }
      const data = (await res.json()) as {
        access_token?: string
        refresh_token?: string
        expires_in?: number
        scope?: string
      }
      if (!data.access_token || !data.refresh_token || typeof data.expires_in !== 'number') {
        errors.push(`${endpoint}: malformed token response`)
        continue
      }
      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: Date.now() + data.expires_in * 1000,
        ...(data.scope ? { scopes: data.scope.split(' ') } : {}),
      }
    } catch (err) {
      errors.push(`${endpoint}: ${(err as Error).message}`)
    }
  }
  throw new ClaudeCredentialRefreshError(
    `Failed to refresh Claude OAuth token: ${errors.join('; ')}`,
  )
}

export interface WriteClaudeCredentialOptions {
  path?: string
}

export async function writeClaudeCredentials(
  cred: ClaudeOauthCredential,
  opts: WriteClaudeCredentialOptions = {},
): Promise<void> {
  const path = opts.path ?? process.env.CLAUDE_CREDENTIALS_PATH ?? DEFAULT_CREDENTIAL_PATH
  const payload = { claudeAiOauth: cred }
  await fs.mkdir(join(path, '..'), { recursive: true })
  await fs.writeFile(path, JSON.stringify(payload, null, 2), { mode: 0o600 })
}

/**
 * Returns a valid access token, refreshing in place if the stored one is
 * near expiry. The returned credential is the one that should be used for
 * the next request; callers may optionally persist it.
 */
export async function loadValidClaudeCredential(
  opts: ReadClaudeCredentialOptions & { persistOnRefresh?: boolean } = {},
): Promise<ClaudeOauthCredential> {
  const cred = await readClaudeCredentials(opts)
  if (!isClaudeCredentialExpired(cred)) return cred
  const refreshed = await refreshClaudeOauthCredential(cred.refreshToken)
  if (opts.persistOnRefresh) {
    await writeClaudeCredentials(refreshed, opts)
  }
  return refreshed
}
