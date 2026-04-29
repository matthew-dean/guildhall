import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { ApiStreamEvent } from '@guildhall/engine'

import { OpenAIApiError, OpenAICompatibleClient, stripThinkBlocks } from '../openai-client.js'

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

  it('passes an abort signal and reports timeout errors clearly', async () => {
    let signalSeen = false
    const fakeFetch = (async (_url: string, init?: RequestInit) => {
      signalSeen = init?.signal instanceof AbortSignal
      throw new DOMException('The operation timed out.', 'TimeoutError')
    }) as unknown as typeof fetch
    const client = new OpenAICompatibleClient({
      fetch: fakeFetch,
      requestTimeoutMs: 12_000,
    })

    let caught: unknown = null
    try {
      await collect(
        client.streamMessage({
          model: 'llama-3',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
          max_tokens: 64,
          tools: [],
        }),
      )
    } catch (err) {
      caught = err
    }

    expect(signalSeen).toBe(true)
    expect(caught).toBeInstanceOf(OpenAIApiError)
    if (caught instanceof OpenAIApiError) {
      expect(caught.message).toContain('timed out after 12s')
      expect(caught.retryable).toBe(false)
    }
  })

  it('honors an external abort signal without reporting it as a timeout', async () => {
    let signalSeen: AbortSignal | null = null
    const controller = new AbortController()
    const fakeFetch = (async (_url: string, init?: RequestInit) => {
      signalSeen = init?.signal instanceof AbortSignal ? init.signal : null
      controller.abort()
      throw new DOMException('Request aborted.', 'AbortError')
    }) as unknown as typeof fetch
    const client = new OpenAICompatibleClient({
      fetch: fakeFetch,
      requestTimeoutMs: 12_000,
    })

    let caught: unknown = null
    try {
      await collect(
        client.streamMessage({
          model: 'llama-3',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
          max_tokens: 64,
          tools: [],
          signal: controller.signal,
        }),
      )
    } catch (err) {
      caught = err
    }

    expect(signalSeen).toBeInstanceOf(AbortSignal)
    expect(caught).toBeInstanceOf(DOMException)
    expect((caught as DOMException).name).toBe('AbortError')
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

  it('accumulates reasoning_content deltas into a reasoning block', async () => {
    const frames = [
      dataFrame({
        choices: [{ delta: { reasoning_content: 'think ' }, finish_reason: null }],
      }),
      dataFrame({
        choices: [{ delta: { reasoning_content: 'harder' }, finish_reason: null }],
      }),
      dataFrame({ choices: [{ delta: { content: 'answer' }, finish_reason: 'stop' }] }),
      'data: [DONE]\n\n',
    ]
    const fakeFetch = (async () => sseResponse(frames)) as unknown as typeof fetch
    const client = new OpenAICompatibleClient({ fetch: fakeFetch })
    const events = await collect(
      client.streamMessage({
        model: 'qwen3-thinker',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'think about it' }] }],
        max_tokens: 64,
        tools: [],
      }),
    )
    const terminal = events.at(-1)!
    if (terminal.type !== 'message_complete') throw new Error('expected terminal')
    expect(terminal.message.content).toEqual([
      { type: 'reasoning', text: 'think harder' },
      { type: 'text', text: 'answer' },
    ])
    // reasoning must not be streamed to the user as text_delta
    const deltas = events.filter((e) => e.type === 'text_delta')
    expect(deltas.map((e) => (e as { text: string }).text).join('')).toBe('answer')
  })

  it('replays reasoning_content on the next request', async () => {
    const frames = [
      dataFrame({ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }),
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
        model: 'qwen3-thinker',
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'hi' }] },
          {
            role: 'assistant',
            content: [
              { type: 'reasoning', text: 'prior reasoning' },
              { type: 'text', text: 'prior answer' },
            ],
          },
          { role: 'user', content: [{ type: 'text', text: 'again' }] },
        ],
        max_tokens: 64,
        tools: [],
      }),
    )
    const messages = body?.messages as Array<Record<string, unknown>>
    const assistant = messages.find((m) => m.role === 'assistant')!
    expect(assistant.reasoning_content).toBe('prior reasoning')
    expect(assistant.content).toBe('prior answer')
  })

  it('emits reasoning_content="" on tool-call messages even without reasoning (Kimi quirk)', async () => {
    const frames = [
      dataFrame({ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }),
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
        model: 'kimi-k2.5',
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'do it' }] },
          {
            role: 'assistant',
            content: [{ type: 'tool_use', id: 'call_1', name: 'bash', input: { command: 'ls' } }],
          },
          {
            role: 'user',
            content: [
              { type: 'tool_result', tool_use_id: 'call_1', content: 'out', is_error: false },
            ],
          },
        ],
        max_tokens: 32,
        tools: [{ name: 'bash', description: '', input_schema: {} }],
      }),
    )
    const messages = body?.messages as Array<Record<string, unknown>>
    const assistant = messages.find((m) => m.role === 'assistant')!
    expect(assistant.reasoning_content).toBe('')
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

  // Repro for the LM-Studio/llama.cpp HTTP 400 we saw in t-minus-t: a tool
  // whose input_schema was the default `{ type: 'object' }` (no `properties`
  // key) made the local validator reject the whole request with `path:
  // [N, function, parameters, properties] required`. Every tool must serialize
  // into a `function.parameters` object whose `type` is `'object'` AND that
  // carries a `properties` object (empty is fine).
  it("serializes tools with no properties as `parameters: { type: 'object', properties: {} }`", async () => {
    let captured: Record<string, unknown> | undefined
    const fakeFetch = (async (_url: string, init?: RequestInit) => {
      captured = JSON.parse((init?.body as string) ?? '{}') as Record<string, unknown>
      return sseResponse([dataFrame({ choices: [{ delta: {}, finish_reason: 'stop' }] }), 'data: [DONE]\n\n'])
    }) as unknown as typeof fetch
    const client = new OpenAICompatibleClient({ fetch: fakeFetch })
    await collect(
      client.streamMessage({
        model: 'llama-3',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
        max_tokens: 64,
        tools: [
          { name: 'noargs', description: 'no args', input_schema: { type: 'object' } },
          { name: 'empty', description: 'empty schema', input_schema: {} },
          { name: 'oneArg', description: 'one', input_schema: { type: 'object', properties: { x: { type: 'string' } }, required: ['x'] } },
        ],
      }),
    )
    const tools = captured?.tools as Array<Record<string, unknown>>
    expect(tools).toHaveLength(3)
    for (const tool of tools) {
      const fn = tool.function as Record<string, unknown>
      const params = fn.parameters as Record<string, unknown>
      expect(params.type).toBe('object')
      expect(params.properties).toBeTypeOf('object')
      expect(params.properties).not.toBeNull()
    }
    // existing properties/required are preserved untouched
    const oneArgParams = (tools[2]!.function as Record<string, unknown>).parameters as Record<string, unknown>
    expect(oneArgParams.properties).toEqual({ x: { type: 'string' } })
    expect(oneArgParams.required).toEqual(['x'])
  })
})

describe('OpenAICompatibleClient retry behavior', () => {
  // Override global setTimeout so retry backoff resolves on the next tick
  // instead of waiting real seconds. We restore it in afterEach so only the
  // retry tests in this describe block are affected.
  const realSetTimeout = globalThis.setTimeout
  beforeEach(() => {
    globalThis.setTimeout = ((fn: () => void, _delay?: number) => {
      return realSetTimeout(fn, 0)
    }) as unknown as typeof globalThis.setTimeout
  })
  afterEach(() => {
    globalThis.setTimeout = realSetTimeout
  })

  function statusResponse(status: number, statusText = ''): Response {
    return new Response('upstream said no', { status, statusText })
  }

  it('retries on 429 and succeeds on the next attempt', async () => {
    let call = 0
    const fakeFetch = (async () => {
      call += 1
      if (call === 1) return statusResponse(429, 'Too Many Requests')
      return sseResponse([
        dataFrame({ choices: [{ delta: { content: 'hi' }, finish_reason: 'stop' }] }),
        'data: [DONE]\n\n',
      ])
    }) as unknown as typeof fetch

    const client = new OpenAICompatibleClient({ fetch: fakeFetch, maxRetries: 2 })
    const events = await collect(
      client.streamMessage({
        model: 'm',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
        max_tokens: 8,
        tools: [],
      }),
    )

    const retryEvent = events.find((e) => e.type === 'retry')
    expect(retryEvent).toBeDefined()
    if (retryEvent?.type === 'retry') {
      expect(retryEvent.attempt).toBe(1)
      expect(retryEvent.max_attempts).toBe(3)
    }
    expect(call).toBe(2)
    const terminal = events.at(-1)
    expect(terminal?.type).toBe('message_complete')
  })

  it('does not retry on a non-retryable 400', async () => {
    let call = 0
    const fakeFetch = (async () => {
      call += 1
      return statusResponse(400, 'Bad Request')
    }) as unknown as typeof fetch
    const client = new OpenAICompatibleClient({ fetch: fakeFetch, maxRetries: 3 })

    let caught: unknown = null
    try {
      await collect(
        client.streamMessage({
          model: 'm',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
          max_tokens: 8,
          tools: [],
        }),
      )
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(OpenAIApiError)
    if (caught instanceof OpenAIApiError) expect(caught.status).toBe(400)
    expect(call).toBe(1)
  })

  it('exhausts all retries and throws the last error', async () => {
    let call = 0
    const fakeFetch = (async () => {
      call += 1
      return statusResponse(503, 'Service Unavailable')
    }) as unknown as typeof fetch
    const client = new OpenAICompatibleClient({ fetch: fakeFetch, maxRetries: 2 })

    const events: ApiStreamEvent[] = []
    let caught: unknown = null
    try {
      for await (const ev of client.streamMessage({
        model: 'm',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
        max_tokens: 8,
        tools: [],
      })) {
        events.push(ev)
      }
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(OpenAIApiError)
    if (caught instanceof OpenAIApiError) expect(caught.status).toBe(503)
    expect(call).toBe(3)
    expect(events.filter((e) => e.type === 'retry')).toHaveLength(2)
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
