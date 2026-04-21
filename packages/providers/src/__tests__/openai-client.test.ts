import { describe, expect, it } from 'vitest'

import type { ApiStreamEvent } from '@guildhall/engine'

import { OpenAICompatibleClient, stripThinkBlocks } from '../openai-client.js'

function sseResponse(frames: string[]): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame))
      controller.close()
    },
  })
  return new Response(stream, { status: 200 })
}

function dataFrame(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`
}

async function collect(stream: AsyncIterable<ApiStreamEvent>): Promise<ApiStreamEvent[]> {
  const out: ApiStreamEvent[] = []
  for await (const ev of stream) out.push(ev)
  return out
}

describe('OpenAICompatibleClient', () => {
  it('streams text deltas and returns the final assistant message', async () => {
    const frames = [
      dataFrame({ choices: [{ delta: { content: 'Hel' }, finish_reason: null }] }),
      dataFrame({ choices: [{ delta: { content: 'lo' }, finish_reason: null }] }),
      dataFrame({ choices: [{ delta: {}, finish_reason: 'stop' }] }),
      dataFrame({ usage: { prompt_tokens: 7, completion_tokens: 2 } }),
      'data: [DONE]\n\n',
    ]
    let captured: Record<string, unknown> | undefined
    const fakeFetch = (async (_url: string, init?: RequestInit) => {
      captured = JSON.parse((init?.body as string) ?? '{}') as Record<string, unknown>
      return sseResponse(frames)
    }) as unknown as typeof fetch
    const client = new OpenAICompatibleClient({ fetch: fakeFetch })
    const events = await collect(
      client.streamMessage({
        model: 'llama-3',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
        max_tokens: 64,
        tools: [],
      }),
    )
    expect(captured?.model).toBe('llama-3')
    expect(captured?.max_tokens).toBe(64)
    const deltas = events.filter((e) => e.type === 'text_delta')
    expect(deltas.map((e) => (e as { text: string }).text).join('')).toBe('Hello')
    const terminal = events.at(-1)
    expect(terminal?.type).toBe('message_complete')
    if (terminal?.type === 'message_complete') {
      expect(terminal.message.content[0]).toEqual({ type: 'text', text: 'Hello' })
      expect(terminal.usage).toEqual({ input_tokens: 7, output_tokens: 2 })
      expect(terminal.stop_reason).toBe('stop')
    }
  })

  it('reassembles streamed tool_calls into a tool_use block', async () => {
    const frames = [
      dataFrame({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_1',
                  function: { name: 'bash', arguments: '{"comma' },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      }),
      dataFrame({
        choices: [
          {
            delta: {
              tool_calls: [{ index: 0, function: { arguments: 'nd":"ls"}' } }],
            },
            finish_reason: null,
          },
        ],
      }),
      dataFrame({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
      'data: [DONE]\n\n',
    ]
    const fakeFetch = (async () => sseResponse(frames)) as unknown as typeof fetch
    const client = new OpenAICompatibleClient({ fetch: fakeFetch })
    const events = await collect(
      client.streamMessage({
        model: 'qwen-coder',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'run it' }] }],
        max_tokens: 32,
        tools: [{ name: 'bash', description: '', input_schema: {} }],
      }),
    )
    const terminal = events.at(-1)!
    if (terminal.type !== 'message_complete') throw new Error('expected terminal')
    const block = terminal.message.content[0]
    expect(block).toEqual({
      type: 'tool_use',
      id: 'call_1',
      name: 'bash',
      input: { command: 'ls' },
    })
  })

  it('uses max_completion_tokens for gpt-5/o1/o3/o4 models', async () => {
    const frames = [
      dataFrame({ choices: [{ delta: { content: 'x' }, finish_reason: 'stop' }] }),
      'data: [DONE]\n\n',
    ]
    let body: Record<string, unknown> | undefined
    const fakeFetch = (async (_url: string, init?: RequestInit) => {
      body = JSON.parse((init?.body as string) ?? '{}') as Record<string, unknown>
      return sseResponse(frames)
    }) as unknown as typeof fetch
    const client = new OpenAICompatibleClient({ fetch: fakeFetch })
    await collect(
      client.streamMessage({
        model: 'gpt-5-mini',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }],
        max_tokens: 128,
        tools: [],
      }),
    )
    expect(body).toHaveProperty('max_completion_tokens', 128)
    expect(body).not.toHaveProperty('max_tokens')
  })
})

describe('stripThinkBlocks', () => {
  it('removes fully closed <think> blocks', () => {
    expect(stripThinkBlocks('before<think>hidden</think>after')).toEqual(['beforeafter', ''])
  })

  it('holds back an unclosed <think>…', () => {
    const [visible, leftover] = stripThinkBlocks('ok<think>partial')
    expect(visible).toBe('ok')
    expect(leftover).toBe('<think>partial')
  })

  it('holds back a partial opening tag across chunk boundaries', () => {
    const [visible, leftover] = stripThinkBlocks('hello <thi')
    expect(visible).toBe('hello ')
    expect(leftover).toBe('<thi')
  })
})
