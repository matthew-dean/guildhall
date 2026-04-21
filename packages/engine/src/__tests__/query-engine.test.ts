/**
 * Tests for QueryEngine — the stateful wrapper over runQuery.
 * Upstream reference: openharness tests for engine/query_engine.py.
 */

import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { PermissionChecker, PermissionMode, defaultPermissionSettings } from '../permissions.js'
import { QueryEngine } from '../query-engine.js'
import { ToolRegistry, defineTool } from '../tools.js'
import { ScriptedApiClient } from './fake-client.js'

import type { StreamEvent } from '@guildhall/protocol'

function autoChecker() {
  return new PermissionChecker(defaultPermissionSettings(PermissionMode.FULL_AUTO))
}

describe('QueryEngine.submitMessage', () => {
  it('appends the user message, streams the turn, and tracks usage', async () => {
    const client = new ScriptedApiClient([
      {
        message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
        usage: { input_tokens: 10, output_tokens: 2 },
      },
    ])
    const engine = new QueryEngine({
      apiClient: client,
      toolRegistry: new ToolRegistry(),
      permissionChecker: autoChecker(),
      cwd: '/tmp',
      model: 'test',
      systemPrompt: '',
    })
    const events: StreamEvent[] = []
    for await (const ev of engine.submitMessage('say hi')) events.push(ev)
    expect(events.some((e) => e.type === 'assistant_turn_complete')).toBe(true)
    expect(engine.messages).toHaveLength(2)
    expect(engine.messages[0]!.role).toBe('user')
    expect(engine.messages[1]!.role).toBe('assistant')
    expect(engine.totalUsage).toEqual({ input_tokens: 10, output_tokens: 2 })
  })

  it('accumulates usage across multiple submitMessage calls', async () => {
    const client = new ScriptedApiClient([
      {
        message: { role: 'assistant', content: [{ type: 'text', text: 'a' }] },
        usage: { input_tokens: 3, output_tokens: 1 },
      },
      {
        message: { role: 'assistant', content: [{ type: 'text', text: 'b' }] },
        usage: { input_tokens: 4, output_tokens: 2 },
      },
    ])
    const engine = new QueryEngine({
      apiClient: client,
      toolRegistry: new ToolRegistry(),
      permissionChecker: autoChecker(),
      cwd: '/tmp',
      model: 'test',
      systemPrompt: '',
    })
    for await (const _ of engine.submitMessage('one')) void _
    for await (const _ of engine.submitMessage('two')) void _
    expect(engine.totalUsage).toEqual({ input_tokens: 7, output_tokens: 3 })
  })
})

describe('QueryEngine.hasPendingContinuation', () => {
  it('returns false on an empty history', () => {
    const engine = new QueryEngine({
      apiClient: new ScriptedApiClient([]),
      toolRegistry: new ToolRegistry(),
      permissionChecker: autoChecker(),
      cwd: '/tmp',
      model: 'test',
      systemPrompt: '',
    })
    expect(engine.hasPendingContinuation()).toBe(false)
  })

  it('returns true when the tail is user(tool_result) following an assistant tool_use', () => {
    const engine = new QueryEngine({
      apiClient: new ScriptedApiClient([]),
      toolRegistry: new ToolRegistry(),
      permissionChecker: autoChecker(),
      cwd: '/tmp',
      model: 'test',
      systemPrompt: '',
    })
    engine.loadMessages([
      { role: 'user', content: [{ type: 'text', text: 'go' }] },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'toolu_1', name: 't', input: {} }],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok', is_error: false }],
      },
    ])
    expect(engine.hasPendingContinuation()).toBe(true)
  })

  it('returns false when the tail is a plain user text message', () => {
    const engine = new QueryEngine({
      apiClient: new ScriptedApiClient([]),
      toolRegistry: new ToolRegistry(),
      permissionChecker: autoChecker(),
      cwd: '/tmp',
      model: 'test',
      systemPrompt: '',
    })
    engine.loadMessages([{ role: 'user', content: [{ type: 'text', text: 'hi' }] }])
    expect(engine.hasPendingContinuation()).toBe(false)
  })
})

describe('QueryEngine — tool loop integration', () => {
  it('runs a tool through the engine and appends result to history', async () => {
    const registry = new ToolRegistry()
    registry.register(
      defineTool({
        name: 'sum',
        description: '',
        inputSchema: z.object({ a: z.number(), b: z.number() }),
        execute: async (input) => ({ output: String(input.a + input.b), is_error: false }),
      }),
    )
    const client = new ScriptedApiClient([
      {
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'toolu_sum', name: 'sum', input: { a: 2, b: 3 } }],
        },
      },
      { message: { role: 'assistant', content: [{ type: 'text', text: '5' }] } },
    ])
    const engine = new QueryEngine({
      apiClient: client,
      toolRegistry: registry,
      permissionChecker: autoChecker(),
      cwd: '/tmp',
      model: 'test',
      systemPrompt: '',
    })
    for await (const _ of engine.submitMessage('add 2 and 3')) void _
    const msgs = engine.messages
    expect(msgs).toHaveLength(4)
    const last = msgs[msgs.length - 1]!
    expect(last.role).toBe('assistant')
    expect(last.content[0]!.type).toBe('text')
    const toolResult = msgs[2]!.content[0]!
    expect(toolResult.type).toBe('tool_result')
    if (toolResult.type === 'tool_result') expect(toolResult.content).toBe('5')
  })
})

describe('QueryEngine reactive compaction (FR-19)', () => {
  it('invokes the compactor when a turn fails with prompt-too-long, then retries', async () => {
    // Turn 1 throws prompt-too-long; turn 2 succeeds. The compactor must be
    // called between them with the current history and return a shorter list
    // so the loop retries instead of bubbling the error out.
    const client = new ScriptedApiClient([
      {
        message: { role: 'assistant', content: [{ type: 'text', text: '' }] },
        throwBefore: new Error('prompt is too long for the context window'),
      },
      {
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'after compaction' }],
        },
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    ])
    let compactorCalls = 0
    const engine = new QueryEngine({
      apiClient: client,
      toolRegistry: new ToolRegistry(),
      permissionChecker: autoChecker(),
      cwd: '/tmp',
      model: 'test',
      systemPrompt: '',
      compactor: async (messages, reason) => {
        compactorCalls += 1
        expect(reason).toBe('prompt_too_long')
        // Return a strictly shorter history so the engine retries the turn.
        return messages.slice(1)
      },
    })
    // Prime history with a turn so the compactor can actually drop something.
    engine.loadMessages([
      { role: 'user', content: [{ type: 'text', text: 'old turn' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'old reply' }] },
    ])
    for await (const _ of engine.submitMessage('big prompt')) void _
    expect(compactorCalls).toBe(1)
    const last = engine.messages[engine.messages.length - 1]!
    expect(last.role).toBe('assistant')
    // The final assistant text should come from the second scripted turn.
    const block = last.content[0]!
    expect(block.type).toBe('text')
    if (block.type === 'text') expect(block.text).toBe('after compaction')
  })

  it('does not invoke the compactor on unrelated errors', async () => {
    const client = new ScriptedApiClient([
      {
        message: { role: 'assistant', content: [{ type: 'text', text: '' }] },
        throwBefore: new Error('some unrelated 500 from upstream'),
      },
    ])
    let compactorCalls = 0
    const engine = new QueryEngine({
      apiClient: client,
      toolRegistry: new ToolRegistry(),
      permissionChecker: autoChecker(),
      cwd: '/tmp',
      model: 'test',
      systemPrompt: '',
      compactor: async () => {
        compactorCalls += 1
        return null
      },
    })
    // runQuery yields an error event rather than throwing, so we just drain.
    for await (const _ of engine.submitMessage('hi')) void _
    expect(compactorCalls).toBe(0)
  })
})
