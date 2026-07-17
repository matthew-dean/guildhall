import { describe, expect, it } from 'vitest'
import type { ApiMessageRequest, ApiStreamEvent, SupportsStreamingMessages } from '@guildhall/engine'
import { buildEssentialHistorySummarizer } from '../essential-history.js'

function clientReturning(summary: string, requests: ApiMessageRequest[]): SupportsStreamingMessages {
  return {
    async *streamMessage(request: ApiMessageRequest): AsyncIterable<ApiStreamEvent> {
      requests.push(request)
      yield {
        type: 'message_complete',
        message: { role: 'assistant', content: [{ type: 'text', text: summary }] },
        usage: { input_tokens: 1, output_tokens: 1 },
        stop_reason: 'end_turn',
      }
    },
  }
}

describe('buildEssentialHistorySummarizer', () => {
  it('uses the context-indexer model with a bounded no-tools summary request', async () => {
    const requests: ApiMessageRequest[] = []
    const summarize = buildEssentialHistorySummarizer({
      apiClient: clientReturning('- Accepted scope: CLI-first story proof.', requests),
      model: 'micro-model',
    })

    const result = await summarize({
      taskId: 'task-1',
      priorHistory: 'The old conversation had a lot of repeated process narration.',
      role: 'user',
      content: 'Keep the first MVP focused on a CLI-first proof.',
    })

    expect(result).toBe('- Accepted scope: CLI-first story proof.')
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      model: 'micro-model',
      max_tokens: 900,
      temperature: 0,
      tools: [],
    })
    expect(requests[0]?.system_prompt).toContain('Essential History')
  })

  it('returns null when the micro-model fails so the caller can use bounded compaction', async () => {
    const summarize = buildEssentialHistorySummarizer({
      apiClient: {
        async *streamMessage(): AsyncIterable<ApiStreamEvent> {
          throw new Error('provider unavailable')
        },
      },
      model: 'micro-model',
    })

    await expect(summarize({
      taskId: 'task-1',
      priorHistory: '',
      role: 'user',
      content: 'Keep the proof bounded.',
    })).resolves.toBeNull()
  })
})

