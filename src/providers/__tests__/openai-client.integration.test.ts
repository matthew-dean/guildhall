/**
 * Integration tests for OpenAICompatibleClient against a real local server
 * (llama.cpp / LM Studio / any OpenAI-compatible endpoint).
 *
 * These tests are opt-in: they only run when `LM_STUDIO_BASE_URL` or
 * `LLAMA_CPP_URL` is set. CI never has a model running, so the suite stays
 * silent there. To run locally:
 *
 *   LM_STUDIO_BASE_URL=http://127.0.0.1:1234/v1 \
 *     LM_STUDIO_MODEL=qwen3-4b \
 *     pnpm test src/providers/__tests__/openai-client.integration.test.ts
 *
 * A small/fast model is enough — the tests just need a live SSE stream and
 * (optionally) tool-call round-tripping. `LM_STUDIO_MODEL` defaults to
 * `unspecified`, which LM Studio's /v1/chat/completions accepts when only
 * one model is loaded.
 */

import { describe, expect, it } from 'vitest'

import type { ApiStreamEvent } from '@guildhall/engine'

import { OpenAICompatibleClient } from '../openai-client.js'

const BASE_URL = (
  process.env.LM_STUDIO_BASE_URL ??
  process.env.LLAMA_CPP_URL ??
  ''
).trim()
const MODEL = (process.env.LM_STUDIO_MODEL ?? 'unspecified').trim()
const TIMEOUT_MS = 60_000

describe.skipIf(!BASE_URL)('OpenAICompatibleClient (local server)', () => {
  it(
    'streams a real completion and terminates with message_complete',
    async () => {
      const client = new OpenAICompatibleClient({ baseUrl: BASE_URL })
      const events: ApiStreamEvent[] = []
      for await (const ev of client.streamMessage({
        model: MODEL,
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'Say the single word "pong" and nothing else.' }],
          },
        ],
        max_tokens: 32,
        tools: [],
      })) {
        events.push(ev)
      }

      const terminal = events.at(-1)
      expect(terminal?.type).toBe('message_complete')
      if (terminal?.type !== 'message_complete') return

      const textBlock = terminal.message.content.find((b) => b.type === 'text')
      expect(textBlock).toBeDefined()
      if (textBlock?.type === 'text') {
        expect(textBlock.text.toLowerCase()).toContain('pong')
      }
      expect(terminal.usage.output_tokens).toBeGreaterThan(0)
    },
    TIMEOUT_MS,
  )

  it(
    'round-trips a tool call when the model supports tool use',
    async () => {
      const client = new OpenAICompatibleClient({ baseUrl: BASE_URL })
      const events: ApiStreamEvent[] = []
      for await (const ev of client.streamMessage({
        model: MODEL,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Use the `get_time` tool. Do not reply with text.',
              },
            ],
          },
        ],
        max_tokens: 64,
        tools: [
          {
            name: 'get_time',
            description: 'Return the current server time as an ISO-8601 string.',
            input_schema: {
              type: 'object',
              properties: {},
              additionalProperties: false,
            },
          },
        ],
      })) {
        events.push(ev)
      }

      const terminal = events.at(-1)
      expect(terminal?.type).toBe('message_complete')
      if (terminal?.type !== 'message_complete') return

      // Not every local model will choose to call a tool; this test is
      // informational when it doesn't. We only fail hard if the wire protocol
      // breaks — the client should at least produce a valid terminal event.
      const toolBlocks = terminal.message.content.filter((b) => b.type === 'tool_use')
      if (toolBlocks.length > 0 && toolBlocks[0]?.type === 'tool_use') {
        expect(toolBlocks[0].name).toBe('get_time')
        expect(typeof toolBlocks[0].input).toBe('object')
      }
    },
    TIMEOUT_MS,
  )
})
