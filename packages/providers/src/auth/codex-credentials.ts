/**
 * Ported from openharness/src/openharness/auth/external.py (Codex parts).
 * Upstream: https://github.com/HKUDS/OpenHarness (MIT)
 * Upstream SHA at port time: 559ba76f237db957a1a21453170df8500479dc7d
 *
 * Changes from upstream:
 *   - Read only — refresh flow for the Codex ChatGPT-backed token is not
 *     documented publicly and upstream defers to the Codex CLI for renewal,
 *     so we do the same. If the access token is expired we surface an error
 *     telling the user to run `codex auth login`.
 *   - JWT decoding is native — we parse the payload manually rather than
 *     pulling in a jwt lib, since we only need one unverified claim.
 */

import { Buffer } from 'node:buffer'
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const DEFAULT_CODEX_CREDENTIAL_PATH = join(homedir(), '.codex', 'auth.json')
const CHATGPT_ACCOUNT_CLAIM = 'https://api.openai.com/auth'

export interface CodexCredential {
  accessToken: string
  refreshToken: string
  chatgptAccountId: string
}

export class CodexCredentialMissingError extends Error {
  constructor(path: string) {
    super(
      `No Codex credentials found at ${path}. Run \`codex auth login\` (or set CODEX_CREDENTIALS_PATH).`,
    )
    this.name = 'CodexCredentialMissingError'
  }
}

export interface ReadCodexCredentialOptions {
  path?: string
}

export async function readCodexCredentials(
  opts: ReadCodexCredentialOptions = {},
): Promise<CodexCredential> {
  const path = opts.path ?? process.env.CODEX_CREDENTIALS_PATH ?? DEFAULT_CODEX_CREDENTIAL_PATH
  let raw: string
  try {
    raw = await fs.readFile(path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      throw new CodexCredentialMissingError(path)
    }
    throw err
  }
  const parsed = JSON.parse(raw) as {
    tokens?: { access_token?: string; refresh_token?: string; account_id?: string }
  }
  const tokens = parsed.tokens
  if (!tokens?.access_token || !tokens.refresh_token) {
    throw new CodexCredentialMissingError(path)
  }
  const accountId =
    tokens.account_id ?? extractChatgptAccountId(tokens.access_token) ?? undefined
  if (!accountId) {
    throw new CodexCredentialMissingError(path)
  }
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    chatgptAccountId: accountId,
  }
}

/**
 * Decode the JWT payload (no signature verification — we're just pulling a
 * claim the Codex backend needs) and extract the chatgpt_account_id.
 */
export function extractChatgptAccountId(jwt: string): string | null {
  const parts = jwt.split('.')
  if (parts.length < 2) return null
  const payloadPart = parts[1]
  if (!payloadPart) return null
  try {
    const padded = payloadPart.padEnd(payloadPart.length + ((4 - (payloadPart.length % 4)) % 4), '=')
    const decoded = Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(
      'utf8',
    )
    const payload = JSON.parse(decoded) as Record<string, unknown>
    const auth = payload[CHATGPT_ACCOUNT_CLAIM] as { chatgpt_account_id?: string } | undefined
    return auth?.chatgpt_account_id ?? null
  } catch {
    return null
  }
}
