/**
 * Ported from openharness tests around engine/messages.py
 * Upstream: https://github.com/HKUDS/OpenHarness (MIT)
 */

import { describe, expect, it } from 'vitest'

import {
  contentBlockSchema,
  conversationMessageSchema,
  isEffectivelyEmpty,
  messageText,
  messageToolUses,
  sanitizeConversationMessages,
  serializeContentBlock,
  toApiParam,
  toolUseBlockSchema,
  userMessageFromText,
  type ConversationMessage,
  type ToolUseBlock,
} from '../messages.js'

describe('content block schema', () => {
  it('discriminates text blocks by type', () => {
    const parsed = contentBlockSchema.parse({ type: 'text', text: 'hello' })
    expect(parsed.type).toBe('text')
    if (parsed.type === 'text') expect(parsed.text).toBe('hello')
  })

  it('discriminates tool_use blocks and auto-fills id', () => {
    const parsed = contentBlockSchema.parse({ type: 'tool_use', name: 'shell' })
    expect(parsed.type).toBe('tool_use')
    if (parsed.type === 'tool_use') {
      expect(parsed.id).toMatch(/^toolu_[0-9a-f]{32}$/)
      expect(parsed.input).toEqual({})
    }
  })

  it('auto-generated tool_use ids are unique', () => {
    const a = toolUseBlockSchema.parse({ type: 'tool_use', name: 'shell' })
    const b = toolUseBlockSchema.parse({ type: 'tool_use', name: 'shell' })
    expect(a.id).not.toBe(b.id)
  })

  it('tool_result blocks default is_error to false', () => {
    const parsed = contentBlockSchema.parse({
      type: 'tool_result',
      tool_use_id: 'toolu_x',
      content: 'ok',
    })
    expect(parsed.type).toBe('tool_result')
    if (parsed.type === 'tool_result') expect(parsed.is_error).toBe(false)
  })

  it('rejects unknown block types', () => {
    expect(() => contentBlockSchema.parse({ type: 'bogus' })).toThrow()
  })
})

describe('conversation message schema', () => {
  it('normalizes null content to an empty array', () => {
    const parsed = conversationMessageSchema.parse({ role: 'user', content: null })
    expect(parsed.content).toEqual([])
  })

  it('defaults content to an empty array when omitted', () => {
    const parsed = conversationMessageSchema.parse({ role: 'assistant' })
    expect(parsed.content).toEqual([])
  })

  it('userMessageFromText constructs a valid user message', () => {
    const msg = userMessageFromText('hello world')
    const parsed = conversationMessageSchema.parse(msg)
    expect(parsed.role).toBe('user')
    expect(messageText(parsed)).toBe('hello world')
  })
})

describe('accessors', () => {
  it('messageText concatenates only text blocks', () => {
    const msg: ConversationMessage = {
      role: 'assistant',
      content: [
        { type: 'text', text: 'hello ' },
        { type: 'tool_use', id: 'toolu_1', name: 'x', input: {} },
        { type: 'text', text: 'world' },
      ],
    }
    expect(messageText(msg)).toBe('hello world')
  })

  it('messageToolUses returns only tool_use blocks', () => {
    const msg: ConversationMessage = {
      role: 'assistant',
      content: [
        { type: 'text', text: 'hi' },
        { type: 'tool_use', id: 'toolu_1', name: 'x', input: {} },
        { type: 'tool_use', id: 'toolu_2', name: 'y', input: { a: 1 } },
      ],
    }
    const uses = messageToolUses(msg)
    expect(uses).toHaveLength(2)
    expect(uses[0]!.name).toBe('x')
    expect(uses[1]!.input).toEqual({ a: 1 })
  })

  it('isEffectivelyEmpty treats whitespace-only text as empty', () => {
    expect(
      isEffectivelyEmpty({ role: 'assistant', content: [{ type: 'text', text: '   \n' }] }),
    ).toBe(true)
  })

  it('isEffectivelyEmpty treats any non-text block as non-empty', () => {
    expect(
      isEffectivelyEmpty({
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'toolu_1', name: 'x', input: {} }],
      }),
    ).toBe(false)
  })
})

describe('serialization', () => {
  it('serializes text blocks', () => {
    expect(serializeContentBlock({ type: 'text', text: 'hi' })).toEqual({
      type: 'text',
      text: 'hi',
    })
  })

  it('serializes image blocks with nested source', () => {
    expect(
      serializeContentBlock({
        type: 'image',
        media_type: 'image/png',
        data: 'base64data',
        source_path: '/tmp/x.png',
      }),
    ).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'base64data' },
    })
  })

  it('serializes tool_use blocks flat', () => {
    expect(
      serializeContentBlock({
        type: 'tool_use',
        id: 'toolu_x',
        name: 'shell',
        input: { cmd: 'ls' },
      }),
    ).toEqual({ type: 'tool_use', id: 'toolu_x', name: 'shell', input: { cmd: 'ls' } })
  })

  it('toApiParam shapes the full provider payload', () => {
    const msg = userMessageFromText('hi')
    expect(toApiParam(msg)).toEqual({
      role: 'user',
      content: [{ type: 'text', text: 'hi' }],
    })
  })
})

describe('sanitizeConversationMessages', () => {
  it('drops empty assistant messages', () => {
    const msgs: ConversationMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      { role: 'assistant', content: [] },
    ]
    expect(sanitizeConversationMessages(msgs)).toHaveLength(1)
  })

  it('drops assistant tool_use with no matching user tool_result tail', () => {
    const msgs: ConversationMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'toolu_1', name: 'x', input: {} }],
      },
    ]
    const out = sanitizeConversationMessages(msgs)
    expect(out).toHaveLength(1)
    expect(out[0]!.role).toBe('user')
  })

  it('keeps a matched tool_use / tool_result pair', () => {
    const tu: ToolUseBlock = { type: 'tool_use', id: 'toolu_1', name: 'x', input: {} }
    const msgs: ConversationMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      { role: 'assistant', content: [tu] },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok', is_error: false }],
      },
    ]
    expect(sanitizeConversationMessages(msgs)).toHaveLength(3)
  })

  it('strips orphaned tool_result blocks from a user message', () => {
    const msgs: ConversationMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'hi' },
          {
            type: 'tool_result',
            tool_use_id: 'toolu_dangling',
            content: 'ok',
            is_error: false,
          },
        ],
      },
    ]
    const out = sanitizeConversationMessages(msgs)
    expect(out).toHaveLength(1)
    expect(out[0]!.content).toEqual([{ type: 'text', text: 'hi' }])
  })

  it('drops a user message that had only an orphaned tool_result', () => {
    const msgs: ConversationMessage[] = [
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_dangling',
            content: 'ok',
            is_error: false,
          },
        ],
      },
    ]
    expect(sanitizeConversationMessages(msgs)).toEqual([])
  })
})
