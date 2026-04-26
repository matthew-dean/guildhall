/**
 * Ported from openharness/src/openharness/api/openai_client.py
 * Upstream: https://github.com/HKUDS/OpenHarness (MIT)
 * Upstream SHA at port time: 559ba76f237db957a1a21453170df8500479dc7d
 *
 * Changes from upstream:
 *   - No OpenAI SDK dependency — POST /v1/chat/completions with native fetch
 *     and consume the SSE stream via the shared sse.ts parser
 *   - Model-specific `max_completion_tokens` swap for gpt-5/o1/o3/o4 stays
 *   - `<think>…</think>` stripping is preserved since llama.cpp can be
 *     fronting any model including ones that emit inline reasoning
 *   - Reasoning-content carryover: upstream stashes raw reasoning on
 *     `msg._reasoning` and replays it as `reasoning_content` on the next
 *     request. We materialize it as a first-class `reasoning` content
 *     block (see protocol/messages.ts) so it survives session save/restore
 *     instead of living in out-of-band attribute state.
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

import { parseSseStream } from './sse.js'

const DEFAULT_BASE_URL = 'http://127.0.0.1:8080/v1'
const MAX_RETRIES = 3
const BASE_RETRY_DELAY_MS = 1_000
const MAX_RETRY_DELAY_MS = 30_000
const DEFAULT_REQUEST_TIMEOUT_MS = 300_000
const RETRYABLE_STATUS = new Set([429, 500, 502, 503])
const MAX_COMPLETION_TOKEN_PREFIXES = ['gpt-5', 'o1', 'o3', 'o4']

export interface OpenAICompatibleClientOptions {
  /** Defaults to `http://127.0.0.1:8080/v1` for llama.cpp's default port. */
  baseUrl?: string
  /** llama.cpp ignores this; pass anything non-empty. Real OpenAI needs a key. */
  apiKey?: string
  fetch?: typeof fetch
  maxRetries?: number
  requestTimeoutMs?: number
}

export class OpenAIApiError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
    public readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'OpenAIApiError'
  }
}

export class OpenAICompatibleClient implements SupportsStreamingMessages {
  private readonly baseUrl: string
  private readonly apiKey: string
  private readonly fetchImpl: typeof fetch
  private readonly maxRetries: number
  private readonly requestTimeoutMs: number

  constructor(opts: OpenAICompatibleClientOptions = {}) {
    this.baseUrl = normalizeBaseUrl(opts.baseUrl) ?? DEFAULT_BASE_URL
    this.apiKey = opts.apiKey ?? 'local'
    this.fetchImpl = opts.fetch ?? fetch
    this.maxRetries = opts.maxRetries ?? MAX_RETRIES
    this.requestTimeoutMs = opts.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  }

  async *streamMessage(request: ApiMessageRequest): AsyncIterable<ApiStreamEvent> {
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        yield* this.streamOnce(request)
        return
      } catch (err) {
        const isLast = attempt === this.maxRetries
        if (isLast || !(err instanceof OpenAIApiError) || !err.retryable) throw err
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

  private async *streamOnce(request: ApiMessageRequest): AsyncIterable<ApiStreamEvent> {
    const openaiMessages = convertMessagesToOpenAI(request.messages, request.system_prompt)
    const tools = request.tools.length > 0 ? convertToolsToOpenAI(request.tools) : null

    const body: Record<string, unknown> = {
      model: request.model,
      messages: openaiMessages,
      stream: true,
      ...tokenLimitFieldFor(request.model, request.max_tokens),
    }
    if (tools) {
      body.tools = tools
    } else {
      body.stream_options = { include_usage: true }
    }

    let res: Response
    try {
      res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
          accept: 'text/event-stream',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      })
    } catch (err) {
      if (isAbortError(err)) {
        throw new OpenAIApiError(
          `OpenAI-compatible API timed out after ${Math.round(this.requestTimeoutMs / 1000)}s`,
          null,
          false,
        )
      }
      throw err
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new OpenAIApiError(
        `OpenAI-compatible API HTTP ${res.status}: ${text || res.statusText}`,
        res.status,
        RETRYABLE_STATUS.has(res.status),
      )
    }
    if (res.body == null) {
      throw new OpenAIApiError('OpenAI-compatible API returned no body', null, false)
    }

    yield* consumeOpenAiSse(res.body)
  }
}

function isAbortError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  return err.name === 'AbortError' || err.name === 'TimeoutError'
}

// -----------------------------------------------------------------------------
// Message conversion (Anthropic-shaped → OpenAI chat format)
// -----------------------------------------------------------------------------

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string | Array<Record<string, unknown>> | null
  tool_call_id?: string
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
  reasoning_content?: string
}

function convertMessagesToOpenAI(
  messages: ConversationMessage[],
  systemPrompt?: string,
): OpenAIMessage[] {
  const out: OpenAIMessage[] = []
  if (systemPrompt && systemPrompt.length > 0) {
    out.push({ role: 'system', content: systemPrompt })
  }
  for (const msg of messages) {
    if (msg.role === 'assistant') {
      out.push(convertAssistantMessage(msg))
      continue
    }

    const toolResults = msg.content.filter((b): b is Extract<ContentBlock, { type: 'tool_result' }> => b.type === 'tool_result')
    const userBlocks = msg.content.filter((b): b is Extract<ContentBlock, { type: 'text' | 'image' }> => b.type === 'text' || b.type === 'image')

    for (const tr of toolResults) {
      out.push({ role: 'tool', tool_call_id: tr.tool_use_id, content: tr.content })
    }
    if (userBlocks.length > 0) {
      const content = convertUserContent(userBlocks)
      if (typeof content === 'string') {
        if (content.trim().length > 0) out.push({ role: 'user', content })
      } else if (content.length > 0) {
        out.push({ role: 'user', content })
      }
    }
    if (toolResults.length === 0 && userBlocks.length === 0) {
      out.push({ role: 'user', content: '' })
    }
  }
  return out
}

function convertUserContent(
  blocks: Array<Extract<ContentBlock, { type: 'text' | 'image' }>>,
): string | Array<Record<string, unknown>> {
  const hasImage = blocks.some((b) => b.type === 'image')
  if (!hasImage) {
    return blocks
      .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
      .map((b) => b.text)
      .join('')
  }
  const content: Array<Record<string, unknown>> = []
  for (const block of blocks) {
    if (block.type === 'text' && block.text.length > 0) {
      content.push({ type: 'text', text: block.text })
    } else if (block.type === 'image') {
      content.push({
        type: 'image_url',
        image_url: { url: `data:${block.media_type};base64,${block.data}` },
      })
    }
  }
  return content
}

function convertAssistantMessage(msg: ConversationMessage): OpenAIMessage {
  const textParts = msg.content
    .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
  const reasoningParts = msg.content
    .filter((b): b is Extract<ContentBlock, { type: 'reasoning' }> => b.type === 'reasoning')
    .map((b) => b.text)
  const toolUses = msg.content.filter((b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use')
  const content = textParts.join('')
  const reasoning = reasoningParts.join('')

  const out: OpenAIMessage = { role: 'assistant', content: content.length > 0 ? content : null }
  // Thinking models (Qwen3, o1/o3, Kimi k2.5) require reasoning_content to be
  // replayed so they can continue thinking coherently; Kimi in particular
  // requires an empty string on tool-call messages even when no reasoning
  // was captured.
  if (reasoning.length > 0) {
    out.reasoning_content = reasoning
  } else if (toolUses.length > 0) {
    out.reasoning_content = ''
  }
  if (toolUses.length > 0) {
    out.tool_calls = toolUses.map((tu) => ({
      id: tu.id,
      type: 'function',
      function: { name: tu.name, arguments: JSON.stringify(tu.input) },
    }))
  }
  return out
}

function convertToolsToOpenAI(
  tools: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: (tool.description as string | undefined) ?? '',
      parameters: normalizeToolParameters(
        tool.input_schema as Record<string, unknown> | undefined,
      ),
    },
  }))
}

// LM Studio and llama.cpp validate tool schemas strictly: a `parameters`
// object whose type is 'object' MUST carry a `properties` object, even when
// the tool takes no arguments. Anthropic's API is lenient about the missing
// field, so the bug is invisible on Claude but fatal on local runs. Normalize
// here so every outgoing call has a well-formed parameters block.
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

function tokenLimitFieldFor(model: string, maxTokens: number): Record<string, number> {
  let normalized = model.trim().toLowerCase()
  if (normalized.includes('/')) {
    const parts = normalized.split('/')
    normalized = parts[parts.length - 1] ?? normalized
  }
  if (MAX_COMPLETION_TOKEN_PREFIXES.some((p) => normalized.startsWith(p))) {
    return { max_completion_tokens: maxTokens }
  }
  return { max_tokens: maxTokens }
}

function normalizeBaseUrl(baseUrl: string | undefined): string | null {
  if (!baseUrl) return null
  const trimmed = baseUrl.trim()
  if (trimmed.length === 0) return null
  try {
    const url = new URL(trimmed)
    const path = url.pathname.replace(/\/+$/, '') || '/v1'
    return `${url.origin}${path}${url.search}${url.hash}`
  } catch {
    return trimmed.replace(/\/+$/, '')
  }
}

// -----------------------------------------------------------------------------
// SSE consumer for OpenAI chat-completions streams
// -----------------------------------------------------------------------------

interface ToolCallAccumulator {
  id: string
  name: string
  arguments: string
}

async function* consumeOpenAiSse(
  body: ReadableStream<Uint8Array>,
): AsyncIterable<ApiStreamEvent> {
  let collectedContent = ''
  let collectedReasoning = ''
  const toolCalls: Map<number, ToolCallAccumulator> = new Map()
  let finishReason: string | null = null
  const usage: UsageSnapshot = { ...emptyUsage }
  let thinkBuf = ''

  for await (const sse of parseSseStream(body)) {
    if (sse.data === '[DONE]') break
    let chunk: {
      choices?: Array<{
        delta?: {
          content?: string
          reasoning_content?: string
          tool_calls?: Array<{
            index: number
            id?: string
            function?: { name?: string; arguments?: string }
          }>
        }
        finish_reason?: string | null
      }>
      usage?: { prompt_tokens?: number; completion_tokens?: number }
    }
    try {
      chunk = JSON.parse(sse.data)
    } catch {
      continue
    }

    if (chunk.usage) {
      usage.input_tokens = chunk.usage.prompt_tokens ?? usage.input_tokens
      usage.output_tokens = chunk.usage.completion_tokens ?? usage.output_tokens
    }

    const choice = chunk.choices?.[0]
    if (!choice) continue

    if (choice.finish_reason) finishReason = choice.finish_reason

    const delta = choice.delta
    if (!delta) continue

    if (delta.reasoning_content) {
      collectedReasoning += delta.reasoning_content
    }

    if (delta.content) {
      thinkBuf += delta.content
      const [visible, leftover] = stripThinkBlocks(thinkBuf)
      thinkBuf = leftover
      if (visible.length > 0) {
        collectedContent += visible
        yield { type: 'text_delta', text: visible }
      }
    }

    if (delta.tool_calls) {
      for (const tcDelta of delta.tool_calls) {
        const idx = tcDelta.index
        let entry = toolCalls.get(idx)
        if (!entry) {
          entry = { id: tcDelta.id ?? '', name: '', arguments: '' }
          toolCalls.set(idx, entry)
        }
        if (tcDelta.id) entry.id = tcDelta.id
        if (tcDelta.function?.name) entry.name = tcDelta.function.name
        if (tcDelta.function?.arguments) entry.arguments += tcDelta.function.arguments
      }
    }
  }

  const content: ContentBlock[] = []
  // Reasoning comes first so replayed messages present thinking → text → tool_use
  // in the same order the model emitted it.
  if (collectedReasoning.length > 0) {
    content.push({ type: 'reasoning', text: collectedReasoning })
  }
  if (collectedContent.length > 0) content.push({ type: 'text', text: collectedContent })
  for (const idx of [...toolCalls.keys()].sort((a, b) => a - b)) {
    const tc = toolCalls.get(idx)!
    if (!tc.name) continue
    let input: Record<string, unknown> = {}
    if (tc.arguments.length > 0) {
      try {
        const parsed = JSON.parse(tc.arguments)
        if (parsed && typeof parsed === 'object') input = parsed as Record<string, unknown>
      } catch {
        /* leave {} */
      }
    }
    content.push({ type: 'tool_use', id: tc.id, name: tc.name, input })
  }

  const message: ConversationMessage = { role: 'assistant', content }
  yield {
    type: 'message_complete',
    message,
    usage,
    ...(finishReason !== null ? { stop_reason: finishReason } : {}),
  }
}

// -----------------------------------------------------------------------------
// <think> block stripping (handles tags split across chunks)
// -----------------------------------------------------------------------------

const THINK_RE = /<think>[\s\S]*?<\/think>/g
const THINK_OPEN_TAG = '<think>'

export function stripThinkBlocks(buf: string): [string, string] {
  const cleaned = buf.replace(THINK_RE, '')
  const openIdx = cleaned.indexOf(THINK_OPEN_TAG)
  if (openIdx !== -1) return [cleaned.slice(0, openIdx), cleaned.slice(openIdx)]

  const maxPrefix = Math.min(cleaned.length, THINK_OPEN_TAG.length - 1)
  for (let prefixLen = maxPrefix; prefixLen > 0; prefixLen -= 1) {
    if (THINK_OPEN_TAG.startsWith(cleaned.slice(cleaned.length - prefixLen))) {
      return [cleaned.slice(0, cleaned.length - prefixLen), cleaned.slice(cleaned.length - prefixLen)]
    }
  }
  return [cleaned, '']
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
