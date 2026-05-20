import { describe, expect, it, vi } from 'vitest'

import type { ApiStreamEvent } from '@guildhall/engine'

import { CodexClient } from '../codex-client.js'

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

const testCred = {
  accessToken: 'codex-at',
  refreshToken: 'codex-rt',
  chatgptAccountId: 'acct_123',
}

describe('CodexClient', () => {
  it('streams output_text.delta and finalizes on response.completed', async () => {
    const frames = [
      dataFrame({ type: 'response.output_text.delta', delta: 'Hel' }),
      dataFrame({ type: 'response.output_text.delta', delta: 'lo' }),
      dataFrame({
        type: 'response.output_item.done',
        item: {
          type: 'message',
          content: [{ type: 'output_text', text: 'Hello' }],
        },
      }),
      dataFrame({
        type: 'response.completed',
        response: { status: 'completed', usage: { input_tokens: 5, output_tokens: 2 } },
      }),
    ]
    let capturedUrl: string | null = null
    let capturedInit: RequestInit | null = null
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      capturedUrl = url
      capturedInit = init ?? null
      return sseResponse(frames)
    }) as unknown as typeof fetch
    const client = new CodexClient({ credential: testCred, fetch: fakeFetch })
    const events = await collect(
      client.streamMessage({
        model: 'gpt-5-codex',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
        max_tokens: 256,
        temperature: 0.1,
        tools: [],
      }),
    )
    expect(capturedUrl).toBe('https://chatgpt.com/backend-api/codex/responses')
    const headers = (capturedInit as RequestInit | null)?.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer codex-at')
    expect(headers['chatgpt-account-id']).toBe('acct_123')
    expect(headers['OpenAI-Beta']).toBe('responses=experimental')
    if (!capturedInit) throw new Error('expected request init to be captured')
    const requestBody = (capturedInit as { body?: unknown }).body
    expect(JSON.parse(String(requestBody))?.temperature).toBeUndefined()

    const textDeltas = events.filter((e) => e.type === 'text_delta')
    expect(textDeltas.map((e) => (e as { text: string }).text).join('')).toBe('Hello')
    const terminal = events.at(-1)
    expect(terminal?.type).toBe('message_complete')
    if (terminal?.type === 'message_complete') {
      expect(terminal.message.content[0]).toEqual({ type: 'text', text: 'Hello' })
      expect(terminal.usage).toEqual({ input_tokens: 5, output_tokens: 2 })
      expect(terminal.stop_reason).toBe('stop')
    }
  })

  it('captures function_call items as tool_use blocks', async () => {
    const frames = [
      dataFrame({
        type: 'response.output_item.done',
        item: {
          type: 'function_call',
          call_id: 'call_42',
          name: 'bash',
          arguments: '{"command":"ls"}',
        },
      }),
      dataFrame({
        type: 'response.completed',
        response: { status: 'completed', usage: { input_tokens: 0, output_tokens: 0 } },
      }),
    ]
    const fakeFetch = (async () => sseResponse(frames)) as unknown as typeof fetch
    const client = new CodexClient({ credential: testCred, fetch: fakeFetch })
    const events = await collect(
      client.streamMessage({
        model: 'gpt-5-codex',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'run' }] }],
        max_tokens: 64,
        tools: [{ name: 'bash', description: '', input_schema: {} }],
      }),
    )
    const terminal = events.at(-1)!
    if (terminal.type !== 'message_complete') throw new Error('expected terminal')
    expect(terminal.message.content[0]).toEqual({
      type: 'tool_use',
      id: 'call_42',
      name: 'bash',
      input: { command: 'ls' },
    })
    expect(terminal.stop_reason).toBe('tool_use')
  })

  it("serializes tools with no properties as `parameters: { type: 'object', properties: {} }`", async () => {
    let captured: Record<string, unknown> | undefined
    const fakeFetch = (async (_url: string, init?: RequestInit) => {
      captured = JSON.parse((init?.body as string) ?? '{}') as Record<string, unknown>
      return sseResponse([
        dataFrame({
          type: 'response.completed',
          response: { status: 'completed', usage: { input_tokens: 0, output_tokens: 0 } },
        }),
      ])
    }) as unknown as typeof fetch
    const client = new CodexClient({ credential: testCred, fetch: fakeFetch })
    await collect(
      client.streamMessage({
        model: 'gpt-5.3-codex',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'run' }] }],
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
      const params = tool.parameters as Record<string, unknown>
      expect(params.type).toBe('object')
      expect(params.properties).toBeTypeOf('object')
      expect(params.properties).not.toBeNull()
    }
    expect((tools[2]!.parameters as Record<string, unknown>).properties).toEqual({ x: { type: 'string' } })
    expect((tools[2]!.parameters as Record<string, unknown>).required).toEqual(['x'])
  })

  it('throws on response.failed events', async () => {
    const frames = [
      dataFrame({
        type: 'response.failed',
        response: { error: { message: 'bad request', code: 'invalid_request' } },
      }),
    ]
    const fakeFetch = (async () => sseResponse(frames)) as unknown as typeof fetch
    const client = new CodexClient({ credential: testCred, fetch: fakeFetch })
    await expect(
      collect(
        client.streamMessage({
          model: 'gpt-5-codex',
          messages: [],
          max_tokens: 1,
          tools: [],
        }),
      ),
    ).rejects.toThrow(/bad request/)
  })

  it('serializes multimodal and tool-result conversation history for Codex responses', async () => {
    let captured: Record<string, unknown> | undefined
    const fakeFetch = (async (_url: string, init?: RequestInit) => {
      captured = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      return sseResponse([
        dataFrame({ type: 'response.output_text.delta', delta: 'ok' }),
        dataFrame({ type: 'response.completed', response: { status: 'incomplete' } }),
      ])
    }) as unknown as typeof fetch
    const client = new CodexClient({
      credential: testCred,
      fetch: fakeFetch,
      baseUrl: 'https://chatgpt.com/backend-api/codex',
      sessionId: 'session-1',
    })

    const events = await collect(client.streamMessage({
      model: 'gpt-5.3-codex',
      system_prompt: '',
      max_tokens: 64,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'look' },
            { type: 'image', media_type: 'image/png', data: 'abc123', source_path: 'screenshot.png' },
            { type: 'tool_result', tool_use_id: 'call_1', content: 'tool output', is_error: false },
          ],
        },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'I will call it.' },
            { type: 'tool_use', id: 'call_1', name: 'inspect', input: { path: 'file.ts' } },
          ],
        },
      ],
      tools: [],
    }))

    expect(captured?.instructions).toBe('You are Guildhall.')
    const input = captured?.input as Array<Record<string, unknown>>
    expect(input[0]).toMatchObject({
      role: 'user',
      content: [
        { type: 'input_text', text: 'look' },
        { type: 'input_image', image_url: 'data:image/png;base64,abc123' },
      ],
    })
    expect(input[1]).toEqual({
      type: 'function_call_output',
      call_id: 'call_1',
      output: 'tool output',
    })
    expect(input[2]).toMatchObject({
      type: 'message',
      role: 'assistant',
    })
    expect(input[3]).toMatchObject({
      type: 'function_call',
      call_id: 'call_1',
      name: 'inspect',
      arguments: '{"path":"file.ts"}',
    })
    const terminal = events.at(-1)
    expect(terminal?.type).toBe('message_complete')
    if (terminal?.type === 'message_complete') {
      expect(terminal.stop_reason).toBe('length')
    }
  })

  it('formats HTTP and stream errors with the server payload details', async () => {
    const errorFetch = (async () =>
      new Response(JSON.stringify({ detail: 'account locked' }), { status: 403 })) as unknown as typeof fetch
    const client = new CodexClient({ credential: testCred, fetch: errorFetch, maxRetries: 0 })

    await expect(collect(client.streamMessage({
      model: 'gpt-5.3-codex',
      messages: [],
      max_tokens: 1,
      tools: [],
    }))).rejects.toThrow('account locked')

    const streamFetch = (async () => sseResponse([
      dataFrame({ type: 'error', error: { message: 'bad stream', code: 'stream_error', request_id: 'req_1' } }),
    ])) as unknown as typeof fetch
    const streamClient = new CodexClient({ credential: testCred, fetch: streamFetch })
    await expect(collect(streamClient.streamMessage({
      model: 'gpt-5.3-codex',
      messages: [],
      max_tokens: 1,
      tools: [],
    }))).rejects.toThrow('bad stream (code=stream_error) [request_id=req_1]')
  })

  it('emits retry telemetry for retryable Codex HTTP failures', async () => {
    vi.useFakeTimers()
    try {
      let calls = 0
      const fakeFetch = (async () => {
        calls += 1
        if (calls === 1) return new Response('temporarily overloaded', { status: 503 })
        return sseResponse([
          dataFrame({ type: 'response.output_text.delta', delta: 'recovered' }),
          dataFrame({ type: 'response.completed', response: { status: 'completed' } }),
        ])
      }) as unknown as typeof fetch
      const client = new CodexClient({ credential: testCred, fetch: fakeFetch, maxRetries: 1 })
      const eventsPromise = collect(client.streamMessage({
        model: 'gpt-5.3-codex',
        messages: [],
        max_tokens: 1,
        tools: [],
      }))

      await vi.advanceTimersByTimeAsync(1_000)
      const events = await eventsPromise

      expect(calls).toBe(2)
      expect(events[0]).toMatchObject({
        type: 'retry',
        attempt: 1,
        max_attempts: 2,
        delay_seconds: 1,
      })
      expect(events.some(ev => ev.type === 'text_delta' && ev.text === 'recovered')).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})
