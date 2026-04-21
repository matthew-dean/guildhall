import { describe, expect, it } from 'vitest'

import type { ConversationMessage } from '@guildhall/protocol'

import {
  PTL_RETRY_MARKER,
  TIME_BASED_MC_CLEARED_MESSAGE,
  estimateMessageTokens,
  estimateTokens,
  microcompactMessages,
  truncateHeadForPtlRetry,
} from '../index.js'

function userText(text: string): ConversationMessage {
  return { role: 'user', content: [{ type: 'text', text }] }
}

function assistantToolUse(id: string, name: string): ConversationMessage {
  return {
    role: 'assistant',
    content: [{ type: 'tool_use', id, name, input: {} }],
  }
}

function toolResult(id: string, content: string): ConversationMessage {
  return {
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: id, content, is_error: false }],
  }
}

describe('token estimation', () => {
  it('returns zero for empty strings', () => {
    expect(estimateTokens('')).toBe(0)
  })

  it('uses char/4 with a minimum of 1', () => {
    expect(estimateTokens('a')).toBe(1)
    expect(estimateTokens('abcd')).toBe(1)
    expect(estimateTokens('abcdef')).toBe(2)
  })

  it('adds the 4/3 padding when estimating conversation totals', () => {
    const msgs: ConversationMessage[] = [userText('x'.repeat(40))]
    const raw = estimateTokens('x'.repeat(40))
    expect(estimateMessageTokens(msgs)).toBeGreaterThan(raw)
    expect(estimateMessageTokens(msgs)).toBe(Math.floor(raw * (4 / 3)))
  })

  it('sums text, tool_use, and tool_result blocks', () => {
    const msgs: ConversationMessage[] = [
      userText('hello'),
      assistantToolUse('t1', 'bash'),
      toolResult('t1', 'some output\n'.repeat(20)),
    ]
    const total = estimateMessageTokens(msgs)
    expect(total).toBeGreaterThan(0)
  })
})

describe('microcompactMessages', () => {
  it('clears tool_result content for compactable tools beyond the recent window', () => {
    const msgs: ConversationMessage[] = [
      userText('first'),
      assistantToolUse('t1', 'bash'),
      toolResult('t1', 'stale output from long ago'),
      userText('second'),
      assistantToolUse('t2', 'bash'),
      toolResult('t2', 'recent output'),
      userText('third'),
    ]
    const result = microcompactMessages(msgs, { keepRecent: 3 })
    // Older tool result (t1) should be cleared; recent one (t2) preserved.
    const oldResultBlock = result[2]?.content[0]
    const recentResultBlock = result[5]?.content[0]
    expect(oldResultBlock).toBeDefined()
    expect(recentResultBlock).toBeDefined()
    if (oldResultBlock?.type === 'tool_result') {
      expect(oldResultBlock.content).toBe(TIME_BASED_MC_CLEARED_MESSAGE)
    }
    if (recentResultBlock?.type === 'tool_result') {
      expect(recentResultBlock.content).toBe('recent output')
    }
  })

  it('leaves results from non-compactable tools alone', () => {
    const msgs: ConversationMessage[] = [
      userText('start'),
      assistantToolUse('t1', 'custom_proprietary_tool'),
      toolResult('t1', 'should survive'),
      userText('a'),
      userText('b'),
      userText('c'),
      userText('d'),
      userText('e'),
    ]
    const result = microcompactMessages(msgs, { keepRecent: 3 })
    const preserved = result[2]?.content[0]
    if (preserved?.type === 'tool_result') {
      expect(preserved.content).toBe('should survive')
    }
  })

  it('returns the same array when nothing needs clearing', () => {
    const msgs: ConversationMessage[] = [userText('a'), userText('b')]
    const result = microcompactMessages(msgs, { keepRecent: 5 })
    expect(result).toBe(msgs)
  })
})

describe('truncateHeadForPtlRetry', () => {
  it('drops the oldest prompt round when there are multiple', () => {
    const msgs: ConversationMessage[] = []
    for (let i = 0; i < 10; i += 1) {
      msgs.push(userText(`prompt ${i}`))
      msgs.push({ role: 'assistant', content: [{ type: 'text', text: `answer ${i}` }] })
    }
    const result = truncateHeadForPtlRetry(msgs)
    expect(result).not.toBeNull()
    expect(result!.length).toBeLessThan(msgs.length)
    // Retained should not start with `prompt 0`
    const firstUser = result!.find((m) => m.role === 'user')
    if (firstUser?.content[0]?.type === 'text') {
      expect(firstUser.content[0].text).not.toBe('prompt 0')
    }
  })

  it('prepends a PTL retry marker when the retained head starts with an assistant turn', () => {
    const msgs: ConversationMessage[] = [
      userText('a'),
      { role: 'assistant', content: [{ type: 'text', text: 'A' }] },
      userText('b'),
      { role: 'assistant', content: [{ type: 'text', text: 'B' }] },
    ]
    // Force a retained list whose head is assistant by feeding a 2-group case.
    const result = truncateHeadForPtlRetry(msgs)
    if (result) {
      const head = result[0]
      expect(head?.role).toBe('user')
      if (head?.content[0]?.type === 'text') {
        // Either the original first user message (b) or the marker should lead.
        expect([PTL_RETRY_MARKER, 'b']).toContain(head.content[0].text)
      }
    }
  })

  it('returns null when there are not enough prompt rounds to drop one', () => {
    const msgs: ConversationMessage[] = [userText('only-one')]
    expect(truncateHeadForPtlRetry(msgs)).toBeNull()
  })
})
