/**
 * Ported from openharness/src/openharness/api/client.py (the OAuth path) —
 * the non-OAuth Anthropic path is dropped for now because our only concrete
 * provider for this repo is OAuth'd Claude Code.
 * Upstream: https://github.com/HKUDS/OpenHarness (MIT)
 * Upstream SHA at port time: 559ba76f237db957a1a21453170df8500479dc7d
 *
 * Changes from upstream:
 *   - No Anthropic SDK dependency — POST directly to /v1/messages?beta=true
 *     and consume the SSE stream ourselves
 *   - Beta headers come from a constant list rather than being assembled at
 *     every call
 *   - Credential lookup + refresh is pulled up to `loadValidClaudeCredential`
 *     in auth/claude-credentials.ts; this client only consumes a live token
 *   - Retry loop is preserved but uses setTimeout instead of asyncio.sleep
 */

import {
  type ApiMessageRequest,
  type ApiStreamEvent,
  type SupportsStreamingMessages,
} from '@guildhall/engine'
import {
  type ContentBlock,
  type ConversationMessage,
  emptyUsage,
  serializeContentBlock,
  type UsageSnapshot,
} from '@guildhall/protocol'

import {
  CLAUDE_OAUTH_CLIENT_ID,
  type ClaudeOauthCredential,
  isClaudeCredentialExpired,
  loadValidClaudeCredential,
  refreshClaudeOauthCredential,
} from './auth/claude-credentials.js'
import { parseSseStream } from './sse.js'

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages'
const CLAUDE_CODE_VERSION = '2.1.92'
const CLAUDE_COMMON_BETAS = [
  'interleaved-thinking-2025-05-14',
  'fine-grained-tool-streaming-2025-05-14',
]
const CLAUDE_OAUTH_ONLY_BETAS = ['claude-code-20250219', 'oauth-2025-04-20']

const MAX_RETRIES = 3
const BASE_RETRY_DELAY_MS = 1_000
const MAX_RETRY_DELAY_MS = 30_000
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 529])

export interface ClaudeOauthClientOptions {
  credential?: ClaudeOauthCredential
  /** Called on cold start if no credential was passed in. */
  loadCredential?: () => Promise<ClaudeOauthCredential>
  /** Called when the current credential is within 60s of expiry. */
  refresh?: (refreshToken: string) => Promise<ClaudeOauthCredential>
  /** Persist refreshed credentials back to disk. Defaults to off; CLI passes true. */
  persistOnRefresh?: boolean
  apiUrl?: string
  fetch?: typeof fetch
  /** Stable session id sent as X-Claude-Code-Session-Id. Generated if omitted. */
  sessionId?: string
  /** Claude Code version for the attribution/user-agent. */
  clientVersion?: string
  /** Max retry attempts on transient errors (default 3). */
  maxRetries?: number
}

export class ClaudeAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ClaudeAuthError'
  }
}

export class ClaudeApiError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
    public readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'ClaudeApiError'
  }
}

export class ClaudeOauthClient implements SupportsStreamingMessages {
  private credential: ClaudeOauthCredential | null
  private readonly loadCredential: () => Promise<ClaudeOauthCredential>
  private readonly refresh: (refreshToken: string) => Promise<ClaudeOauthCredential>
  private readonly persistOnRefresh: boolean
  private readonly apiUrl: string
  private readonly fetchImpl: typeof fetch
  private readonly sessionId: string
  private readonly clientVersion: string
  private readonly maxRetries: number

  constructor(opts: ClaudeOauthClientOptions = {}) {
    this.credential = opts.credential ?? null
    this.loadCredential =
      opts.loadCredential ?? (() => loadValidClaudeCredential({ persistOnRefresh: opts.persistOnRefresh ?? false }))
    this.refresh = opts.refresh ?? refreshClaudeOauthCredential
    this.persistOnRefresh = opts.persistOnRefresh ?? false
    this.apiUrl = opts.apiUrl ?? CLAUDE_API_URL
    this.fetchImpl = opts.fetch ?? fetch
    this.sessionId = opts.sessionId ?? crypto.randomUUID()
    this.clientVersion = opts.clientVersion ?? CLAUDE_CODE_VERSION
    this.maxRetries = opts.maxRetries ?? MAX_RETRIES
  }

  async *streamMessage(request: ApiMessageRequest): AsyncIterable<ApiStreamEvent> {
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        yield* this.streamOnce(request)
        return
      } catch (err) {
        const isLast = attempt === this.maxRetries
        if (isLast || !(err instanceof ClaudeApiError) || !err.retryable) throw err
        const delay = Math.min(MAX_RETRY_DELAY_MS, BASE_RETRY_DELAY_MS * 2 ** attempt)
        yield {
          type: 'retry',
          message: err.message,
          attempt: attempt + 1,
          max_attempts: this.maxRetries + 1,
          delay_seconds: delay / 1000,
        }
        await sleep(delay)
      }
    }
  }

  private async getCredential(): Promise<ClaudeOauthCredential> {
    if (this.credential === null) {
      this.credential = await this.loadCredential()
    } else if (isClaudeCredentialExpired(this.credential)) {
      this.credential = await this.refresh(this.credential.refreshToken)
    }
    return this.credential
  }

  private async *streamOnce(request: ApiMessageRequest): AsyncIterable<ApiStreamEvent> {
    const credential = await this.getCredential()

    const body = buildRequestBody(request, {
      sessionId: this.sessionId,
      clientVersion: this.clientVersion,
    })

    const res = await this.fetchImpl(this.apiUrl, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${credential.accessToken}`,
        'content-type': 'application/json',
        accept: 'text/event-stream',
        'anthropic-version': '2023-06-01',
        'anthropic-beta': [...CLAUDE_COMMON_BETAS, ...CLAUDE_OAUTH_ONLY_BETAS].join(','),
        'user-agent': `claude-cli/${this.clientVersion} (external, cli)`,
        'x-app': 'cli',
        'X-Claude-Code-Session-Id': this.sessionId,
        'x-client-request-id': crypto.randomUUID(),
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      const retryable = RETRYABLE_STATUS.has(res.status)
      if (res.status === 401 || res.status === 403) {
        throw new ClaudeAuthError(`Claude OAuth rejected (${res.status}): ${text}`)
      }
      throw new ClaudeApiError(
        `Claude API HTTP ${res.status}: ${text || res.statusText}`,
        res.status,
        retryable,
      )
    }
    if (res.body == null) {
      throw new ClaudeApiError('Claude API returned no response body', null, false)
    }

    yield* consumeAnthropicSse(res.body, { clientId: CLAUDE_OAUTH_CLIENT_ID })
  }
}

// -----------------------------------------------------------------------------
// Request body assembly
// -----------------------------------------------------------------------------

function buildRequestBody(
  request: ApiMessageRequest,
  ctx: { sessionId: string; clientVersion: string },
): Record<string, unknown> {
  const attribution = `x-anthropic-billing-header: cc_version=${ctx.clientVersion}; cc_entrypoint=cli;`
  const system =
    request.system_prompt && request.system_prompt.length > 0
      ? `${attribution}\n${request.system_prompt}`
      : attribution

  return {
    model: request.model,
    max_tokens: request.max_tokens,
    stream: true,
    system,
    messages: request.messages.map((m) => ({
      role: m.role,
      content: m.content.map(serializeContentBlock),
    })),
    tools: request.tools,
    metadata: {
      user_id: JSON.stringify({
        device_id: 'guildhall',
        session_id: ctx.sessionId,
        account_uuid: '',
      }),
    },
  }
}

// -----------------------------------------------------------------------------
// SSE consumer for Anthropic's /v1/messages stream
// -----------------------------------------------------------------------------

interface BuilderBlock {
  type: 'text' | 'tool_use'
  text?: string
  id?: string
  name?: string
  inputJson?: string
}

async function* consumeAnthropicSse(
  body: ReadableStream<Uint8Array>,
  _ctx: { clientId: string },
): AsyncIterable<ApiStreamEvent> {
  const blocks: BuilderBlock[] = []
  let stopReason: string | null = null
  const usage: UsageSnapshot = { ...emptyUsage }

  for await (const sse of parseSseStream(body)) {
    if (sse.event === 'ping') continue
    if (sse.data === '[DONE]') break
    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(sse.data) as Record<string, unknown>
    } catch {
      continue
    }
    const evType = (sse.event ?? (payload.type as string | undefined)) ?? ''
    switch (evType) {
      case 'message_start': {
        const msg = payload.message as { usage?: { input_tokens?: number } } | undefined
        if (msg?.usage?.input_tokens != null) usage.input_tokens = msg.usage.input_tokens
        break
      }
      case 'content_block_start': {
        const block = payload.content_block as
          | { type: string; text?: string; id?: string; name?: string; input?: unknown }
          | undefined
        const idx = Number(payload.index ?? blocks.length)
        if (block?.type === 'text') {
          blocks[idx] = { type: 'text', text: block.text ?? '' }
        } else if (block?.type === 'tool_use') {
          blocks[idx] = {
            type: 'tool_use',
            id: block.id ?? '',
            name: block.name ?? '',
            inputJson: '',
          }
        }
        break
      }
      case 'content_block_delta': {
        const delta = payload.delta as
          | { type: string; text?: string; partial_json?: string }
          | undefined
        const idx = Number(payload.index ?? 0)
        const slot = blocks[idx]
        if (!slot || !delta) break
        if (delta.type === 'text_delta' && slot.type === 'text') {
          const text = delta.text ?? ''
          slot.text = (slot.text ?? '') + text
          if (text) yield { type: 'text_delta', text }
        } else if (delta.type === 'input_json_delta' && slot.type === 'tool_use') {
          slot.inputJson = (slot.inputJson ?? '') + (delta.partial_json ?? '')
        }
        break
      }
      case 'content_block_stop':
        break
      case 'message_delta': {
        const delta = payload.delta as { stop_reason?: string } | undefined
        const outUsage = payload.usage as { output_tokens?: number } | undefined
        if (delta?.stop_reason) stopReason = delta.stop_reason
        if (outUsage?.output_tokens != null) usage.output_tokens = outUsage.output_tokens
        break
      }
      case 'message_stop':
        break
      case 'error': {
        const err = payload.error as { message?: string; type?: string } | undefined
        throw new ClaudeApiError(
          `Claude API stream error: ${err?.message ?? 'unknown'}`,
          null,
          err?.type === 'overloaded_error',
        )
      }
      default:
        break
    }
  }

  const content: ContentBlock[] = []
  for (const block of blocks) {
    if (!block) continue
    if (block.type === 'text') {
      content.push({ type: 'text', text: block.text ?? '' })
    } else if (block.type === 'tool_use') {
      let input: Record<string, unknown> = {}
      const raw = block.inputJson ?? ''
      if (raw.length > 0) {
        try {
          const parsed = JSON.parse(raw)
          if (parsed && typeof parsed === 'object') input = parsed as Record<string, unknown>
        } catch {
          // Leave input as {} — the engine's Zod schema will surface the parse error.
        }
      }
      content.push({
        type: 'tool_use',
        id: block.id ?? '',
        name: block.name ?? '',
        input,
      })
    }
  }

  const message: ConversationMessage = { role: 'assistant', content }
  yield {
    type: 'message_complete',
    message,
    usage,
    ...(stopReason !== null ? { stop_reason: stopReason } : {}),
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
