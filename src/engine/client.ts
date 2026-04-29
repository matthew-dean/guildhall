/**
 * Ported from openharness/src/openharness/api/client.py (the provider-agnostic
 * contract — the concrete AnthropicApiClient wrapper is not ported here; the
 * concrete client will live in @guildhall/providers and adapt whatever SDK
 * we pick).
 * Upstream: https://github.com/HKUDS/OpenHarness (MIT)
 * Upstream SHA at port time: 559ba76f237db957a1a21453170df8500479dc7d
 *
 * Changes from upstream:
 *   - Python `Protocol` class → TypeScript interface
 *   - `@dataclass(frozen=True)` events → plain TS types
 *   - Union type for ApiStreamEvent uses a `type` tag so downstream code
 *     can switch exhaustively (upstream relied on isinstance)
 */

import type { ConversationMessage, UsageSnapshot } from '@guildhall/protocol'

export interface ApiMessageRequest {
  model: string
  messages: ConversationMessage[]
  system_prompt?: string
  max_tokens: number
  tools: Array<Record<string, unknown>>
  signal?: AbortSignal | undefined
}

export interface ApiTextDeltaEvent {
  type: 'text_delta'
  text: string
}

export interface ApiMessageCompleteEvent {
  type: 'message_complete'
  message: ConversationMessage
  usage: UsageSnapshot
  stop_reason?: string | null
}

export interface ApiRetryEvent {
  type: 'retry'
  message: string
  attempt: number
  max_attempts: number
  delay_seconds: number
}

export type ApiStreamEvent = ApiTextDeltaEvent | ApiMessageCompleteEvent | ApiRetryEvent

/**
 * Provider-agnostic streaming message contract. Any concrete provider
 * (Anthropic, OpenAI-compatible, LM Studio, etc.) implements this by
 * yielding text deltas followed by a single message_complete terminal event.
 */
export interface SupportsStreamingMessages {
  streamMessage(request: ApiMessageRequest): AsyncIterable<ApiStreamEvent>
}
