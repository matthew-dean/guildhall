import { describe, it, expect } from 'vitest'
import type {
  ApiMessageRequest,
  ApiStreamEvent,
  SupportsStreamingMessages,
} from '@guildhall/engine'
import type { ConversationMessage } from '@guildhall/protocol'
import { buildDefaultCompactor } from '../compactor-builder.js'

// A minimal stub client that always returns a short summary message. The
// actual summary text doesn't matter to the compactor wiring — we only care
// that the shortened history flows through buildPostCompactMessages and ends
// up shorter than what we fed in.
function makeStubClient(summary: string): SupportsStreamingMessages {
  return {
    async *streamMessage(req: ApiMessageRequest): AsyncIterable<ApiStreamEvent> {
      void req
      const message: ConversationMessage = {
        role: 'assistant',
        content: [{ type: 'text', text: summary }],
      }
      yield {
        type: 'message_complete',
        message,
        usage: { input_tokens: 100, output_tokens: 10 },
        stop_reason: 'end_turn',
      }
    },
  }
}

function makeConversation(count: number): ConversationMessage[] {
  const msgs: ConversationMessage[] = []
  for (let i = 0; i < count; i++) {
    const role: 'user' | 'assistant' = i % 2 === 0 ? 'user' : 'assistant'
    msgs.push({
      role,
      content: [{ type: 'text', text: `message ${i} — ${role} filler content` }],
    })
  }
  return msgs
}

describe('buildDefaultCompactor', () => {
  it('returns a shorter message list for a long conversation', async () => {
    const compactor = buildDefaultCompactor({
      apiClient: makeStubClient('summary of prior work'),
      model: 'claude-sonnet-4-6',
      preserveRecent: 2,
    })
    const input = makeConversation(20)
    const result = await compactor(input, 'prompt_too_long')
    expect(result).not.toBeNull()
    expect(result!.length).toBeLessThan(input.length)
  })

  it('returns null when the input is already within preserveRecent', async () => {
    const compactor = buildDefaultCompactor({
      apiClient: makeStubClient('summary of prior work'),
      model: 'claude-sonnet-4-6',
      preserveRecent: 20,
    })
    // Passthrough path inside compactConversation returns the same messages
    // plus a boundary/attachment decoration. The builder must detect the
    // no-shrink case and return null so the engine bails instead of looping.
    const input = makeConversation(4)
    const result = await compactor(input, 'prompt_too_long')
    expect(result).toBeNull()
  })

  it("returns null for reason='auto' when the threshold is not hit", async () => {
    // A short conversation never trips the model's auto-compact threshold, so
    // the proactive path should short-circuit without calling the LLM.
    let streamCalls = 0
    const client: SupportsStreamingMessages = {
      async *streamMessage(_req: ApiMessageRequest): AsyncIterable<ApiStreamEvent> {
        streamCalls += 1
        yield {
          type: 'message_complete',
          message: { role: 'assistant', content: [{ type: 'text', text: 'x' }] },
          usage: { input_tokens: 1, output_tokens: 1 },
          stop_reason: 'end_turn',
        }
      },
    }
    const compactor = buildDefaultCompactor({
      apiClient: client,
      model: 'claude-sonnet-4-6',
    })
    const input = makeConversation(4)
    const result = await compactor(input, 'auto')
    expect(result).toBeNull()
    expect(streamCalls).toBe(0)
  })

  it("compacts on reason='auto' when an explicit low threshold is hit", async () => {
    const compactor = buildDefaultCompactor({
      apiClient: makeStubClient('auto summary'),
      model: 'claude-sonnet-4-6',
      preserveRecent: 2,
      // Force the threshold to fire even on a small conversation.
      autoCompactThresholdTokens: 10,
      contextWindowTokens: 100,
    })
    const input = makeConversation(20)
    const result = await compactor(input, 'auto')
    expect(result).not.toBeNull()
    expect(result!.length).toBeLessThan(input.length)
  })
})
