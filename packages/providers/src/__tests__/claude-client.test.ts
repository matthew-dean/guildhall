import { describe, expect, it } from 'vitest'

import type { ApiStreamEvent } from '@guildhall/engine'

import { ClaudeOauthClient } from '../claude-client.js'

function sseResponse(frames: string[]): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame))
      controller.close()
    },
  })
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

function makeFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

async function collect(stream: AsyncIterable<ApiStreamEvent>): Promise<ApiStreamEvent[]> {
  const out: ApiStreamEvent[] = []
  for await (const ev of stream) out.push(ev)
  return out
}

describe('ClaudeOauthClient', () => {
  it('streams text deltas and yields a final assistant message with usage', async () => {
    const frames = [
      makeFrame('message_start', { type: 'message_start', message: { usage: { input_tokens: 12 } } }),
      makeFrame('content_block_start', {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      }),
      makeFrame('content_block_delta', {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Hello' },
      }),
      makeFrame('content_block_delta', {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: ' world' },
      }),
      makeFrame('content_block_stop', { type: 'content_block_stop', index: 0 }),
      makeFrame('message_delta', {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { output_tokens: 3 },
      }),
      makeFrame('message_stop', { type: 'message_stop' }),
    ]
    let captured: RequestInit | undefined
    const fakeFetch = (async (_url: string, init?: RequestInit) => {
      captured = init
      return sseResponse(frames)
    }) as unknown as typeof fetch

    const client = new ClaudeOauthClient({
      credential: {
        accessToken: 'at',
        refreshToken: 'rt',
        expiresAt: Date.now() + 3_600_000,
      },
      fetch: fakeFetch,
    })
    const events = await collect(
      client.streamMessage({
        model: 'claude-sonnet-4-6',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
        max_tokens: 256,
        tools: [],
      }),
    )
    const textDeltas = events.filter((e) => e.type === 'text_delta')
    expect(textDeltas.map((e) => (e as { text: string }).text).join('')).toBe('Hello world')
    const terminal = events.at(-1)
    expect(terminal?.type).toBe('message_complete')
    if (terminal?.type === 'message_complete') {
      expect(terminal.message.role).toBe('assistant')
      expect(terminal.message.content[0]).toEqual({ type: 'text', text: 'Hello world' })
      expect(terminal.usage).toEqual({ input_tokens: 12, output_tokens: 3 })
      expect(terminal.stop_reason).toBe('end_turn')
    }
    const headers = captured?.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer at')
    expect(headers['anthropic-beta']).toContain('oauth-2025-04-20')
  })

  it('reassembles tool_use blocks from input_json_delta frames', async () => {
    const frames = [
      makeFrame('message_start', { type: 'message_start', message: { usage: { input_tokens: 1 } } }),
      makeFrame('content_block_start', {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'toolu_1', name: 'bash', input: {} },
      }),
      makeFrame('content_block_delta', {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"command"' },
      }),
      makeFrame('content_block_delta', {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: ':"ls"}' },
      }),
      makeFrame('content_block_stop', { type: 'content_block_stop', index: 0 }),
      makeFrame('message_delta', {
        type: 'message_delta',
        delta: { stop_reason: 'tool_use' },
        usage: { output_tokens: 5 },
      }),
    ]
    const fakeFetch = (async () => sseResponse(frames)) as unknown as typeof fetch
    const client = new ClaudeOauthClient({
      credential: { accessToken: 'at', refreshToken: 'rt', expiresAt: Date.now() + 3_600_000 },
      fetch: fakeFetch,
    })
    const events = await collect(
      client.streamMessage({
        model: 'claude-sonnet-4-6',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'run ls' }] }],
        max_tokens: 256,
        tools: [],
      }),
    )
    const terminal = events.at(-1)!
    if (terminal.type !== 'message_complete') throw new Error('expected terminal')
    const block = terminal.message.content[0]
    expect(block).toEqual({ type: 'tool_use', id: 'toolu_1', name: 'bash', input: { command: 'ls' } })
  })

  it('emits a retry event before throwing on HTTP 500', async () => {
    let calls = 0
    const fakeFetch = (async () => {
      calls += 1
      return new Response('boom', { status: 500 })
    }) as unknown as typeof fetch
    const client = new ClaudeOauthClient({
      credential: { accessToken: 'at', refreshToken: 'rt', expiresAt: Date.now() + 3_600_000 },
      fetch: fakeFetch,
      maxRetries: 1,
    })
    const events: ApiStreamEvent[] = []
    let threw: unknown = null
    try {
      for await (const ev of client.streamMessage({
        model: 'claude-sonnet-4-6',
        messages: [],
        max_tokens: 1,
        tools: [],
      })) {
        events.push(ev)
        // break after the retry to keep the test fast
        if (ev.type === 'retry') {
          // let it loop one more time and then fail
        }
      }
    } catch (err) {
      threw = err
    }
    expect(calls).toBe(2)
    expect(events.some((e) => e.type === 'retry')).toBe(true)
    expect(threw).toBeInstanceOf(Error)
  })
})
