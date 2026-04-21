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
})
