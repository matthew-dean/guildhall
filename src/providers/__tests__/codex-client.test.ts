import { describe, expect, it } from 'vitest'

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
        tools: [],
      }),
    )
    expect(capturedUrl).toBe('https://chatgpt.com/backend-api/codex/responses')
    const headers = (capturedInit as RequestInit | null)?.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer codex-at')
    expect(headers['chatgpt-account-id']).toBe('acct_123')
    expect(headers['OpenAI-Beta']).toBe('responses=experimental')

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
})
