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
  AnthropicApiClient,
  ClaudeCredentialMissingError,
  ClaudeOauthClient,
  CodexClient,
  CodexCredentialMissingError,
  OpenAICompatibleClient,
  readClaudeCredentials,
  readCodexCredentials,
} from '@guildhall/providers'
import { notImplementedApiClient } from '@guildhall/agents'
import { findModel, type ModelAssignmentConfig } from '@guildhall/core'

export type ProviderName =
  | 'claude-oauth'
  | 'codex-oauth'
  | 'llama-cpp'
  | 'anthropic-api'
  | 'openai-api'
  | 'none'

/**
 * Canonical provider keys used on the wire (project config, settings UI).
 * We accept the shorter `'codex'` there and map it to the internal
 * `'codex-oauth'` ProviderName.
 */
export type PreferredProviderKey =
  | 'claude-oauth'
  | 'codex'
  | 'codex-oauth'
  | 'llama-cpp'
  | 'anthropic-api'
  | 'openai-api'

export function normalizePreferredProvider(key: PreferredProviderKey): ProviderName {
  if (key === 'codex') return 'codex-oauth'
  return key
}

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
   * Non-forcing preference (from `.guildhall/config.yaml`). If the named
   * provider is reachable we use it; otherwise we fall back through the
   * normal resolution chain. Accepts the wire-key `'codex'` (mapped to
   * `'codex-oauth'`) for convenience.
   */
  preferredProvider?: PreferredProviderKey
  /**
   * When a preferred provider is set but unavailable, allow falling back to
   * another paid/cloud provider. Defaults false so stale local preferences do
   * not silently spend money.
   */
  allowPaidProviderFallback?: boolean
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
   * llama.cpp / LM Studio base URL. When omitted we read `LLAMA_CPP_URL` /
   * `LM_STUDIO_BASE_URL` from the environment. If still unset, llama.cpp
   * is skipped (we do not probe).
   */
  llamaCppUrl?: string
  /**
   * Anthropic API key. Falls back to `ANTHROPIC_API_KEY`. Empty → skip.
   */
  anthropicApiKey?: string
  /**
   * OpenAI API key. Falls back to `OPENAI_API_KEY`. Empty → skip.
   */
  openaiApiKey?: string
}

export async function selectApiClient(
  opts: SelectApiClientOptions = {},
): Promise<SelectApiClientResult> {
  const forced = opts.provider ?? (process.env.GUILDHALL_PROVIDER as ProviderName | undefined)
  if (forced && forced !== 'none') {
    return selectForced(forced, opts)
  }

  // A non-forcing preference (from the setup wizard) gets first crack. If
  // unreachable we fall through to the normal detection order so the user is
  // not blocked by a stale preference when their environment changes.
  if (opts.preferredProvider) {
    const preferred = normalizePreferredProvider(opts.preferredProvider)
    const probe = await tryProvider(preferred, opts)
    if (probe.ok) return probe.result
    if (!opts.allowPaidProviderFallback) {
      const local = preferred === 'llama-cpp' ? { ok: false } as Probe : tryLlama(opts)
      if (local.ok) return local.result
      const reason =
        `${preferred} is preferred but unavailable. Paid-provider fallback is disabled; ` +
        'enable allowPaidProviderFallback in ~/.guildhall/config.yaml or this project\'s .guildhall/config.yaml to fall back to another cloud provider.'
      return {
        apiClient: notImplementedApiClient(reason),
        providerName: 'none',
        reason,
      }
    }
  }

  const claude = await tryClaude(opts)
  if (claude.ok) return claude.result

  const codex = await tryCodex(opts)
  if (codex.ok) return codex.result

  const anthropic = tryAnthropicApi(opts)
  if (anthropic.ok) return anthropic.result

  const openai = tryOpenAiApi(opts)
  if (openai.ok) return openai.result

  const llama = tryLlama(opts)
  if (llama.ok) return llama.result

  const reason =
    'No provider configured. Run `claude login` for Claude OAuth, `codex auth login` ' +
    'for Codex OAuth, paste an Anthropic or OpenAI API key in the dashboard, or set ' +
    'LLAMA_CPP_URL to point at a running llama.cpp / LM Studio server.'
  return {
    apiClient: notImplementedApiClient(reason),
    providerName: 'none',
    reason,
  }
}

async function tryProvider(name: ProviderName, opts: SelectApiClientOptions): Promise<Probe> {
  switch (name) {
    case 'claude-oauth':
      return tryClaude(opts)
    case 'codex-oauth':
      return tryCodex(opts)
    case 'anthropic-api':
      return tryAnthropicApi(opts)
    case 'openai-api':
      return tryOpenAiApi(opts)
    case 'llama-cpp':
      return tryLlama(opts)
    default:
      return { ok: false }
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
  const url = (
    opts.llamaCppUrl ??
    process.env.LLAMA_CPP_URL ??
    process.env.LM_STUDIO_BASE_URL ??
    ''
  ).trim()
  if (url.length === 0) return { ok: false }
  const apiClient = new OpenAICompatibleClient({ baseUrl: url })
  return {
    ok: true,
    result: {
      apiClient,
      providerName: 'llama-cpp',
      reason: `llama.cpp/LM Studio at ${url}`,
    },
  }
}

function tryAnthropicApi(opts: SelectApiClientOptions): Probe {
  const key = (opts.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY ?? '').trim()
  if (key.length === 0) return { ok: false }
  const apiClient = new AnthropicApiClient({ apiKey: key })
  return {
    ok: true,
    result: {
      apiClient,
      providerName: 'anthropic-api',
      reason: 'Anthropic API key',
    },
  }
}

function tryOpenAiApi(opts: SelectApiClientOptions): Probe {
  const key = (opts.openaiApiKey ?? process.env.OPENAI_API_KEY ?? '').trim()
  if (key.length === 0) return { ok: false }
  const apiClient = new OpenAICompatibleClient({
    baseUrl: 'https://api.openai.com/v1',
    apiKey: key,
  })
  return {
    ok: true,
    result: {
      apiClient,
      providerName: 'openai-api',
      reason: 'OpenAI API key',
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
  if (forced === 'anthropic-api') {
    const probe = tryAnthropicApi(opts)
    if (probe.ok) return probe.result
    return failForced(
      'anthropic-api',
      'Anthropic API key missing. Paste one in the dashboard or set ANTHROPIC_API_KEY.',
    )
  }
  if (forced === 'openai-api') {
    const probe = tryOpenAiApi(opts)
    if (probe.ok) return probe.result
    return failForced(
      'openai-api',
      'OpenAI API key missing. Paste one in the dashboard or set OPENAI_API_KEY.',
    )
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

// ---------------------------------------------------------------------------
// Model-id → PreferredProviderKey inference
//
// A project's guildhall.yaml names models per role (spec, coordinator, worker,
// reviewer, gateChecker). If no explicit preferredProvider is set we infer one
// from those model ids so e.g. a project configured for local qwen doesn't
// silently fall through to Codex / Claude OAuth just because that credential
// happens to exist on the machine.
//
// Strategy: map each role's model id to a PreferredProviderKey. Return a
// single key only when every role agrees. Disagreement / unknowns → undefined,
// which leaves the normal resolution chain in charge.
// ---------------------------------------------------------------------------

function providerKeyForModelId(id: string): PreferredProviderKey | undefined {
  const catalog = findModel(id)
  if (catalog) {
    switch (catalog.provider) {
      case 'lm-studio':
        return 'llama-cpp'
      case 'anthropic':
        return 'claude-oauth'
      case 'openai':
        return 'openai-api'
      case 'google':
        return undefined
    }
  }
  const lower = id.toLowerCase()
  if (lower.startsWith('claude-')) return 'claude-oauth'
  if (/^(gpt-|o1-|o3-|o4-|chatgpt-)/.test(lower)) return 'openai-api'
  // Common local / open-weight families and huggingface-style slugs ("org/model").
  if (/^(qwen|deepseek|llama|mistral|mixtral|phi|gemma|hermes|solar|yi|command-r|codestral)/.test(lower)) {
    return 'llama-cpp'
  }
  if (lower.includes('/')) return 'llama-cpp'
  return undefined
}

/**
 * Infer a preferred provider from a role→model assignment. Returns a single
 * PreferredProviderKey iff every role maps to the same provider; otherwise
 * undefined (callers should leave preferredProvider unset and fall through to
 * the normal resolution chain).
 */
export function inferPreferredProvider(
  models: ModelAssignmentConfig,
): PreferredProviderKey | undefined {
  const keys: Array<PreferredProviderKey | undefined> = [
    providerKeyForModelId(models.spec),
    providerKeyForModelId(models.coordinator),
    providerKeyForModelId(models.worker),
    providerKeyForModelId(models.reviewer),
    providerKeyForModelId(models.gateChecker),
  ]
  const first = keys[0]
  if (!first) return undefined
  for (const k of keys) if (k !== first) return undefined
  return first
}
