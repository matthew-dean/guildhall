/**
 * Ported from openharness/src/openharness/api/codex_client.py
 * Upstream: https://github.com/HKUDS/OpenHarness (MIT)
 * Upstream SHA at port time: 559ba76f237db957a1a21453170df8500479dc7d
 *
 * Changes from upstream:
 *   - httpx.AsyncClient → native fetch + the shared SSE parser in sse.ts
 *   - Credential loading lives in auth/codex-credentials.ts; the client
 *     consumes a ready-made bearer/account pair (injectable for tests).
 *   - `platform.system()`/`platform.machine()` user-agent bits → `process.platform`/`process.arch`
 *   - Error translation is simplified to a single `CodexApiError` with a
 *     retryable flag; callers above the provider interface don't currently
 *     distinguish auth vs rate-limit.
 */

import {
  type ApiMessageRequest,
  type ApiStreamEvent,
  type SupportsStreamingMessages,
} from '@guildhall/engine'
import {
  type ContentBlock,
  type ConversationMessage,
  type UsageSnapshot,
  emptyUsage,
} from '@guildhall/protocol'

import {
  type CodexCredential,
  readCodexCredentials,
} from './auth/codex-credentials.js'
import { parseSseStream } from './sse.js'

const DEFAULT_CODEX_URL = 'https://chatgpt.com/backend-api/codex/responses'
const MAX_RETRIES = 3
const BASE_RETRY_DELAY_MS = 1_000
const MAX_RETRY_DELAY_MS = 30_000
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504])

export interface CodexClientOptions {
  credential?: CodexCredential
  loadCredential?: () => Promise<CodexCredential>
  baseUrl?: string
  fetch?: typeof fetch
  sessionId?: string
  maxRetries?: number
}

export class CodexApiError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
    public readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'CodexApiError'
  }
}

export class CodexClient implements SupportsStreamingMessages {
  private credential: CodexCredential | null
  private readonly loadCredential: () => Promise<CodexCredential>
  private readonly url: string
  private readonly fetchImpl: typeof fetch
  private readonly sessionId: string | null
  private readonly maxRetries: number

  constructor(opts: CodexClientOptions = {}) {
    this.credential = opts.credential ?? null
    this.loadCredential = opts.loadCredential ?? (() => readCodexCredentials())
    this.url = resolveCodexUrl(opts.baseUrl)
    this.fetchImpl = opts.fetch ?? fetch
    this.sessionId = opts.sessionId ?? null
    this.maxRetries = opts.maxRetries ?? MAX_RETRIES
  }

  async *streamMessage(request: ApiMessageRequest): AsyncIterable<ApiStreamEvent> {
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        yield* this.streamOnce(request)
        return
      } catch (err) {
        const isLast = attempt === this.maxRetries
        if (isLast || !(err instanceof CodexApiError) || !err.retryable) throw err
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

  private async getCredential(): Promise<CodexCredential> {
    if (this.credential === null) this.credential = await this.loadCredential()
    return this.credential
  }

  private async *streamOnce(request: ApiMessageRequest): AsyncIterable<ApiStreamEvent> {
    const credential = await this.getCredential()
    const body = {
      model: request.model,
      store: false,
      stream: true,
      instructions: request.system_prompt && request.system_prompt.length > 0 ? request.system_prompt : 'You are Guildhall.',
      input: convertMessagesToCodex(request.messages),
      text: { verbosity: 'medium' },
      include: ['reasoning.encrypted_content'],
      tool_choice: 'auto',
      parallel_tool_calls: true,
      ...(request.tools.length > 0 ? { tools: convertToolsToCodex(request.tools) } : {}),
    }

    const headers: Record<string, string> = {
      authorization: `Bearer ${credential.accessToken}`,
      'chatgpt-account-id': credential.chatgptAccountId,
      originator: 'guildhall',
      'user-agent': `guildhall (${process.platform} ${process.arch})`,
      'OpenAI-Beta': 'responses=experimental',
      accept: 'text/event-stream',
      'content-type': 'application/json',
    }
    if (this.sessionId) headers.session_id = this.sessionId

    const res = await this.fetchImpl(this.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new CodexApiError(
        formatCodexError(res.status, text),
        res.status,
        RETRYABLE_STATUS.has(res.status),
      )
    }
    if (res.body == null) {
      throw new CodexApiError('Codex response had no body', null, false)
    }

    yield* consumeCodexSse(res.body)
  }
}

// -----------------------------------------------------------------------------
// URL / body / error helpers
// -----------------------------------------------------------------------------

function resolveCodexUrl(baseUrl: string | undefined): string {
  const trimmed = (baseUrl ?? '').trim()
  const accepted = trimmed.length > 0 && trimmed.includes('chatgpt.com/backend-api') ? trimmed : ''
  const raw = (accepted.length > 0 ? accepted : DEFAULT_CODEX_URL).replace(/\/+$/, '')
  if (raw.endsWith('/codex/responses')) return raw
  if (raw.endsWith('/codex')) return `${raw}/responses`
  return `${raw}/codex/responses`
}

interface CodexInputItem {
  role?: 'user' | 'assistant'
  type?: string
  content?: unknown
  call_id?: string
  id?: string
  name?: string
  arguments?: string
  output?: string
}

function convertMessagesToCodex(messages: ConversationMessage[]): CodexInputItem[] {
  const out: CodexInputItem[] = []
  for (const msg of messages) {
    if (msg.role === 'user') {
      const userContent: Array<Record<string, unknown>> = []
      for (const block of msg.content) {
        if (block.type === 'text' && block.text.trim().length > 0) {
          userContent.push({ type: 'input_text', text: block.text })
        } else if (block.type === 'image') {
          userContent.push({
            type: 'input_image',
            image_url: `data:${block.media_type};base64,${block.data}`,
          })
        }
      }
      if (userContent.length > 0) out.push({ role: 'user', content: userContent })
      for (const block of msg.content) {
        if (block.type === 'tool_result') {
          out.push({
            type: 'function_call_output',
            call_id: block.tool_use_id,
            output: block.content,
          })
        }
      }
      continue
    }

    const assistantText = msg.content
      .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
      .map((b) => b.text)
      .join('')
    if (assistantText.length > 0) {
      out.push({
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: assistantText, annotations: [] }],
      })
    }
    for (const block of msg.content) {
      if (block.type === 'tool_use') {
        out.push({
          type: 'function_call',
          id: `fc_${block.id.slice(0, 58)}`,
          call_id: block.id,
          name: block.name,
          arguments: JSON.stringify(block.input),
        })
      }
    }
  }
  return out
}

function convertToolsToCodex(tools: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return tools.map((tool) => ({
    type: 'function',
    name: tool.name,
    description: (tool.description as string | undefined) ?? '',
    parameters: normalizeToolParameters(
      tool.input_schema as Record<string, unknown> | undefined,
    ),
  }))
}

// The Codex Responses endpoint validates function schemas strictly: an object
// schema must include `properties`, even when the tool takes no arguments.
function normalizeToolParameters(
  raw: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const base: Record<string, unknown> =
    raw && typeof raw === 'object' ? { ...raw } : {}
  if (base.type == null) base.type = 'object'
  if (base.type === 'object' && (base.properties == null || typeof base.properties !== 'object')) {
    base.properties = {}
  }
  return base
}

function formatCodexError(status: number, payload: string): string {
  try {
    const parsed = JSON.parse(payload) as {
      error?: { message?: string }
      detail?: string
    }
    if (parsed.error?.message && parsed.error.message.trim().length > 0) return parsed.error.message
    if (typeof parsed.detail === 'string' && parsed.detail.trim().length > 0) return parsed.detail
  } catch {
    /* fall through */
  }
  const trimmed = payload.trim()
  if (trimmed.length > 0) return trimmed
  return `Codex request failed with status ${status}`
}

// -----------------------------------------------------------------------------
// SSE consumer
// -----------------------------------------------------------------------------

async function* consumeCodexSse(
  body: ReadableStream<Uint8Array>,
): AsyncIterable<ApiStreamEvent> {
  const content: ContentBlock[] = []
  const deltaParts: string[] = []
  let completedResponse: Record<string, unknown> | null = null

  for await (const sse of parseSseStream(body)) {
    if (sse.data === '[DONE]') break
    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(sse.data) as Record<string, unknown>
    } catch {
      continue
    }
    const evType = payload.type as string | undefined
    if (evType === 'response.output_text.delta') {
      const delta = payload.delta
      if (typeof delta === 'string' && delta.length > 0) {
        deltaParts.push(delta)
        yield { type: 'text_delta', text: delta }
      }
    } else if (evType === 'response.output_item.done') {
      const item = payload.item as Record<string, unknown> | undefined
      if (!item) continue
      if (item.type === 'message') {
        const raw = item.content
        let text = ''
        if (Array.isArray(raw)) {
          const parts: string[] = []
          for (const block of raw as Array<Record<string, unknown>>) {
            if (block.type === 'output_text') parts.push(String(block.text ?? ''))
            else if (block.type === 'refusal') parts.push(String(block.refusal ?? ''))
          }
          text = parts.join('')
        }
        if (text.length > 0) content.push({ type: 'text', text })
      } else if (item.type === 'function_call') {
        const callId = item.call_id
        const name = item.name
        const args = item.arguments
        let parsedArgs: Record<string, unknown> = {}
        if (typeof args === 'string' && args.length > 0) {
          try {
            const obj = JSON.parse(args)
            if (obj && typeof obj === 'object') parsedArgs = obj as Record<string, unknown>
          } catch {
            /* keep {} */
          }
        }
        if (typeof callId === 'string' && callId.length > 0 && typeof name === 'string' && name.length > 0) {
          content.push({ type: 'tool_use', id: callId, name, input: parsedArgs })
        }
      }
    } else if (evType === 'response.completed') {
      const r = payload.response
      if (r && typeof r === 'object') completedResponse = r as Record<string, unknown>
    } else if (evType === 'response.failed') {
      const r = (payload.response as Record<string, unknown> | undefined) ?? payload
      throw new CodexApiError(formatCodexStreamError(r, 'Codex response failed'), null, false)
    } else if (evType === 'error') {
      throw new CodexApiError(formatCodexStreamError(payload, 'Codex error'), null, false)
    }
  }

  if (deltaParts.length > 0 && !content.some((b) => b.type === 'text')) {
    content.unshift({ type: 'text', text: deltaParts.join('') })
  }

  const hasToolCalls = content.some((b) => b.type === 'tool_use')
  const usage = usageFromResponse(completedResponse)
  const stopReason = stopReasonFromResponse(completedResponse, hasToolCalls)
  const message: ConversationMessage = { role: 'assistant', content }
  yield {
    type: 'message_complete',
    message,
    usage,
    ...(stopReason !== null ? { stop_reason: stopReason } : {}),
  }
}

function usageFromResponse(r: Record<string, unknown> | null): UsageSnapshot {
  if (!r) return { ...emptyUsage }
  const usage = r.usage as { input_tokens?: number; output_tokens?: number } | undefined
  if (!usage) return { ...emptyUsage }
  return {
    input_tokens: usage.input_tokens ?? 0,
    output_tokens: usage.output_tokens ?? 0,
  }
}

function stopReasonFromResponse(
  r: Record<string, unknown> | null,
  hasToolCalls: boolean,
): string | null {
  if (!r) return null
  const status = r.status as string | undefined
  if (hasToolCalls && status === 'completed') return 'tool_use'
  if (status === 'completed') return 'stop'
  if (status === 'incomplete') return 'length'
  if (status === 'failed' || status === 'cancelled') return 'error'
  return null
}

function formatCodexStreamError(
  source: Record<string, unknown>,
  fallback: string,
): string {
  const errField = source.error
  const payload =
    errField && typeof errField === 'object' ? (errField as Record<string, unknown>) : source
  const message = payload.message as string | undefined
  const code = payload.code as string | undefined
  const requestId =
    (payload.request_id as string | undefined) ?? (source.request_id as string | undefined)

  const parts: string[] = []
  if (message && message.trim().length > 0) parts.push(message.trim())
  else if (code && code.trim().length > 0) parts.push(code.trim())
  else parts.push(fallback)

  if (code && code.trim().length > 0) parts.push(`(code=${code.trim()})`)
  if (requestId && requestId.trim().length > 0) parts.push(`[request_id=${requestId.trim()}]`)
  return parts.join(' ')
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
