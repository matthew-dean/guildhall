/**
 * Provider selection for the orchestrator.
 *
 * Resolution order (first hit wins):
 *   1. Explicit `provider` option (if given) — select that provider or fail
 *      with a clear reason.
 *   2. `GUILDHALL_PROVIDER` environment variable — same as (1).
 *   3. Claude OAuth — if `~/.claude/.credentials.json` (or the configured
 *      path) contains a valid credential.
 *   4. Codex OAuth — if `~/.codex/auth.json` contains a valid credential.
 *   5. llama.cpp — if `LLAMA_CPP_URL` is set OR a reachable server is
 *      detected at the default local URL (opt-in; we do NOT probe the
 *      network unless the user opted in via env var, to avoid surprising
 *      test runs).
 *   6. Otherwise → `none` + reason.
 *
 * A missing credential is always a normal "provider not configured" state —
 * never a thrown error. Malformed credential files DO throw, because that
 * indicates corruption the user needs to fix.
 */

import type { SupportsStreamingMessages } from '@guildhall/engine'
import {
  ClaudeCredentialMissingError,
  ClaudeOauthClient,
  CodexClient,
  CodexCredentialMissingError,
  OpenAICompatibleClient,
  readClaudeCredentials,
  readCodexCredentials,
} from '@guildhall/providers'
import { notImplementedApiClient } from '@guildhall/agents'

export type ProviderName = 'claude-oauth' | 'codex-oauth' | 'llama-cpp' | 'none'

export interface SelectApiClientResult {
  apiClient: SupportsStreamingMessages
  /** Short name of the selected provider, for logs / banners. */
  providerName: ProviderName
  /**
   * When `providerName === 'none'` this explains why (e.g. no credentials
   * found) so the caller can surface it to the user. Also populated on
   * success with a short banner string (e.g. the llama.cpp URL).
   */
  reason?: string
}

export interface SelectApiClientOptions {
  /**
   * Force a specific provider. When set, the normal resolution order is
   * skipped and the named provider is loaded or the call fails.
   */
  provider?: ProviderName
  /**
   * Override the Claude credential path. Primarily used by tests. When
   * omitted we defer to the provider's default (env → ~/.claude/.credentials.json).
   */
  claudeCredentialPath?: string
  /**
   * Override the Codex credential path. Primarily used by tests. When
   * omitted we defer to the provider's default (env → ~/.codex/auth.json).
   */
  codexCredentialPath?: string
  /**
   * llama.cpp base URL. When omitted we read `LLAMA_CPP_URL` from the
   * environment. If still unset, llama.cpp is skipped (we do not probe).
   */
  llamaCppUrl?: string
}

export async function selectApiClient(
  opts: SelectApiClientOptions = {},
): Promise<SelectApiClientResult> {
  const forced = opts.provider ?? (process.env.GUILDHALL_PROVIDER as ProviderName | undefined)
  if (forced && forced !== 'none') {
    return selectForced(forced, opts)
  }

  const claude = await tryClaude(opts)
  if (claude.ok) return claude.result

  const codex = await tryCodex(opts)
  if (codex.ok) return codex.result

  const llama = tryLlama(opts)
  if (llama.ok) return llama.result

  const reason =
    'No provider configured. Run `claude login` for Claude OAuth, `codex auth login` ' +
    'for Codex OAuth, or set LLAMA_CPP_URL to point at a running llama.cpp server.'
  return {
    apiClient: notImplementedApiClient(reason),
    providerName: 'none',
    reason,
  }
}

// ---------------------------------------------------------------------------
// Per-provider probes
// ---------------------------------------------------------------------------

type Probe =
  | { ok: true; result: SelectApiClientResult }
  | { ok: false }

async function tryClaude(opts: SelectApiClientOptions): Promise<Probe> {
  try {
    const credential = await readClaudeCredentials(
      opts.claudeCredentialPath ? { path: opts.claudeCredentialPath } : {},
    )
    const apiClient = new ClaudeOauthClient({
      credential,
      persistOnRefresh: true,
    })
    return { ok: true, result: { apiClient, providerName: 'claude-oauth' } }
  } catch (err) {
    if (err instanceof ClaudeCredentialMissingError) return { ok: false }
    throw err
  }
}

async function tryCodex(opts: SelectApiClientOptions): Promise<Probe> {
  try {
    const credential = await readCodexCredentials(
      opts.codexCredentialPath ? { path: opts.codexCredentialPath } : {},
    )
    const apiClient = new CodexClient({ credential })
    return { ok: true, result: { apiClient, providerName: 'codex-oauth' } }
  } catch (err) {
    if (err instanceof CodexCredentialMissingError) return { ok: false }
    throw err
  }
}

function tryLlama(opts: SelectApiClientOptions): Probe {
  const url = (opts.llamaCppUrl ?? process.env.LLAMA_CPP_URL ?? '').trim()
  if (url.length === 0) return { ok: false }
  const apiClient = new OpenAICompatibleClient({ baseUrl: url })
  return {
    ok: true,
    result: {
      apiClient,
      providerName: 'llama-cpp',
      reason: `llama.cpp at ${url}`,
    },
  }
}

async function selectForced(
  forced: ProviderName,
  opts: SelectApiClientOptions,
): Promise<SelectApiClientResult> {
  if (forced === 'claude-oauth') {
    const probe = await tryClaude(opts)
    if (probe.ok) return probe.result
    return failForced('claude-oauth', 'Claude OAuth credential missing. Run `claude login`.')
  }
  if (forced === 'codex-oauth') {
    const probe = await tryCodex(opts)
    if (probe.ok) return probe.result
    return failForced('codex-oauth', 'Codex OAuth credential missing. Run `codex auth login`.')
  }
  if (forced === 'llama-cpp') {
    const probe = tryLlama(opts)
    if (probe.ok) return probe.result
    return failForced(
      'llama-cpp',
      'llama.cpp selected but no URL provided. Set LLAMA_CPP_URL or pass llamaCppUrl.',
    )
  }
  return failForced('none', `Unknown provider "${String(forced)}".`)
}

function failForced(forced: ProviderName, reason: string): SelectApiClientResult {
  return {
    apiClient: notImplementedApiClient(`${forced}: ${reason}`),
    providerName: 'none',
    reason: `${forced} forced but unavailable — ${reason}`,
  }
}
