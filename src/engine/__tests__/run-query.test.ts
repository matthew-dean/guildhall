/**
 * Exercises runQuery end-to-end against a scripted fake provider + fake tools.
 * Upstream reference: openharness tests for engine/query.py.
 */

import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { PermissionChecker, PermissionMode, defaultPermissionSettings } from '../permissions.js'
import { MaxTurnsExceededError, runQuery } from '../run-query.js'
import { ToolRegistry, defineTool } from '../tools.js'
import { ScriptedApiClient } from './fake-client.js'

import type { ConversationMessage, StreamEvent } from '@guildhall/protocol'

function autoChecker() {
  return new PermissionChecker(defaultPermissionSettings(PermissionMode.FULL_AUTO))
}

function assistantText(text: string): ConversationMessage {
  return { role: 'assistant', content: [{ type: 'text', text }] }
}

function assistantToolUse(
  name: string,
  input: Record<string, unknown>,
  id = 'toolu_1',
): ConversationMessage {
  return { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] }
}

async function drain(gen: AsyncIterable<{ event: StreamEvent }>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = []
  for await (const y of gen) events.push(y.event)
  return events
}

describe('runQuery — single turn, no tools', () => {
  it('emits assistant_turn_complete and stops when no tool_uses', async () => {
    const client = new ScriptedApiClient([
      {
        textDeltas: ['Hel', 'lo!'],
        message: assistantText('Hello!'),
        usage: { input_tokens: 3, output_tokens: 2 },
      },
    ])
    const messages: ConversationMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'Say hi' }] },
    ]
    const events = await drain(
      runQuery(
        {
          apiClient: client,
          toolRegistry: new ToolRegistry(),
          permissionChecker: autoChecker(),
          cwd: '/tmp',
          model: 'test',
          systemPrompt: 'you are a test bot',
          maxTokens: 256,
          maxTurns: 4,
        },
        messages,
      ),
    )
    expect(events.map((e) => e.type)).toEqual([
      'assistant_text_delta',
      'assistant_text_delta',
      'assistant_turn_complete',
    ])
    // The assistant message was appended to the caller-owned messages array.
    expect(messages).toHaveLength(2)
    expect(messages[1]!.role).toBe('assistant')
  })
})

describe('runQuery — tool loop', () => {
  it('executes a tool call and feeds the result back to the model', async () => {
    const registry = new ToolRegistry()
    let called = false
    registry.register(
      defineTool({
        name: 'echo',
        description: 'returns its input',
        inputSchema: z.object({ value: z.string() }),
        execute: async (input) => {
          called = true
          return { output: `echoed: ${input.value}`, is_error: false }
        },
      }),
    )

    const client = new ScriptedApiClient([
      { message: assistantToolUse('echo', { value: 'hi' }) },
      { message: assistantText('done') },
    ])

    const messages: ConversationMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'go' }] },
    ]

    const events = await drain(
      runQuery(
        {
          apiClient: client,
          toolRegistry: registry,
          permissionChecker: autoChecker(),
          cwd: '/tmp',
          model: 'test',
          systemPrompt: '',
          maxTokens: 256,
          maxTurns: 4,
        },
        messages,
      ),
    )

    expect(called).toBe(true)
    expect(events.map((e) => e.type)).toEqual([
      'assistant_turn_complete',
      'tool_execution_started',
      'tool_execution_completed',
      'assistant_turn_complete',
    ])
    // user -> assistant(tool_use) -> user(tool_result) -> assistant(final text)
    expect(messages).toHaveLength(4)
    expect(messages[2]!.role).toBe('user')
    expect(messages[2]!.content[0]!.type).toBe('tool_result')
  })

  // Single-tool path propagates tool-execution throws upstream — we match that
  // behavior faithfully (upstream's _execute_tool_call doesn't try/except around
  // the tool body either). The concurrency test below covers the multi-tool
  // graceful-fallback path that uses Promise.allSettled.
  it('propagates a thrown single tool error', async () => {
    const registry = new ToolRegistry()
    registry.register(
      defineTool({
        name: 'boom',
        description: 'throws',
        inputSchema: z.object({}),
        execute: async () => {
          throw new Error('kaboom')
        },
      }),
    )
    const client = new ScriptedApiClient([
      { message: assistantToolUse('boom', {}) },
      { message: assistantText('unreachable') },
    ])
    const messages: ConversationMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'go' }] },
    ]
    await expect(async () => {
      for await (const _ of runQuery(
        {
          apiClient: client,
          toolRegistry: registry,
          permissionChecker: autoChecker(),
          cwd: '/tmp',
          model: 'test',
          systemPrompt: '',
          maxTokens: 256,
          maxTurns: 4,
        },
        messages,
      )) {
        void _
      }
    }).rejects.toThrow(/kaboom/)
  })
})

describe('runQuery — concurrency', () => {
  it('runs two tool calls concurrently and emits interleaved events', async () => {
    const registry = new ToolRegistry()
    registry.register(
      defineTool({
        name: 'tool_a',
        description: '',
        inputSchema: z.object({}),
        execute: async () => ({ output: 'A', is_error: false }),
      }),
    )
    registry.register(
      defineTool({
        name: 'tool_b',
        description: '',
        inputSchema: z.object({}),
        execute: async () => {
          throw new Error('B failed')
        },
      }),
    )

    const client = new ScriptedApiClient([
      {
        message: {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'toolu_a', name: 'tool_a', input: {} },
            { type: 'tool_use', id: 'toolu_b', name: 'tool_b', input: {} },
          ],
        },
      },
      { message: assistantText('ok') },
    ])

    const messages: ConversationMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'go' }] },
    ]
    const events = await drain(
      runQuery(
        {
          apiClient: client,
          toolRegistry: registry,
          permissionChecker: autoChecker(),
          cwd: '/tmp',
          model: 'test',
          systemPrompt: '',
          maxTokens: 256,
          maxTurns: 4,
        },
        messages,
      ),
    )
    const completions = events.filter((e) => e.type === 'tool_execution_completed')
    expect(completions).toHaveLength(2)
    const byName = new Map(
      completions
        .filter((e): e is Extract<StreamEvent, { type: 'tool_execution_completed' }> => true)
        .map((e) => [e.tool_name, e.is_error]),
    )
    expect(byName.get('tool_a')).toBe(false)
    expect(byName.get('tool_b')).toBe(true)
    // Last user message holds both tool_result blocks, keeping Anthropic's
    // "every tool_use has a matching tool_result" invariant.
    const lastUser = messages[messages.length - 2]!
    expect(lastUser.role).toBe('user')
    expect(lastUser.content).toHaveLength(2)
  })
})

describe('runQuery — unknown tool + invalid input', () => {
  it('returns an error tool_result for unknown tools', async () => {
    const client = new ScriptedApiClient([
      { message: assistantToolUse('missing', {}) },
      { message: assistantText('ok') },
    ])
    const messages: ConversationMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'go' }] },
    ]
    const events = await drain(
      runQuery(
        {
          apiClient: client,
          toolRegistry: new ToolRegistry(),
          permissionChecker: autoChecker(),
          cwd: '/tmp',
          model: 'test',
          systemPrompt: '',
          maxTokens: 256,
          maxTurns: 4,
        },
        messages,
      ),
    )
    const completed = events.find((e) => e.type === 'tool_execution_completed')
    expect(completed?.type).toBe('tool_execution_completed')
    if (completed?.type === 'tool_execution_completed') {
      expect(completed.is_error).toBe(true)
      expect(completed.output).toContain('Unknown tool')
    }
  })

  it('returns an error tool_result for invalid input', async () => {
    const registry = new ToolRegistry()
    registry.register(
      defineTool({
        name: 'strict',
        description: '',
        inputSchema: z.object({ n: z.number() }),
        execute: async () => ({ output: 'ok', is_error: false }),
      }),
    )
    const client = new ScriptedApiClient([
      { message: assistantToolUse('strict', { n: 'not-a-number' }) },
      { message: assistantText('ok') },
    ])
    const messages: ConversationMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'go' }] },
    ]
    const events = await drain(
      runQuery(
        {
          apiClient: client,
          toolRegistry: registry,
          permissionChecker: autoChecker(),
          cwd: '/tmp',
          model: 'test',
          systemPrompt: '',
          maxTokens: 256,
          maxTurns: 4,
        },
        messages,
      ),
    )
    const completed = events.find((e) => e.type === 'tool_execution_completed')
    expect(completed?.type).toBe('tool_execution_completed')
    if (completed?.type === 'tool_execution_completed') {
      expect(completed.is_error).toBe(true)
      expect(completed.output).toContain('Invalid input')
    }
  })
})

describe('runQuery — permission mode default', () => {
  it('blocks mutating tools without a permissionPrompt', async () => {
    const registry = new ToolRegistry()
    registry.register(
      defineTool({
        name: 'write',
        description: '',
        inputSchema: z.object({}),
        isReadOnly: () => false,
        execute: async () => ({ output: 'did it', is_error: false }),
      }),
    )
    const client = new ScriptedApiClient([
      { message: assistantToolUse('write', {}) },
      { message: assistantText('ok') },
    ])
    const checker = new PermissionChecker(defaultPermissionSettings(PermissionMode.DEFAULT))
    const messages: ConversationMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'go' }] },
    ]
    const events = await drain(
      runQuery(
        {
          apiClient: client,
          toolRegistry: registry,
          permissionChecker: checker,
          cwd: '/tmp',
          model: 'test',
          systemPrompt: '',
          maxTokens: 256,
          maxTurns: 4,
        },
        messages,
      ),
    )
    const completed = events.find((e) => e.type === 'tool_execution_completed')
    expect(completed?.type).toBe('tool_execution_completed')
    if (completed?.type === 'tool_execution_completed') {
      expect(completed.is_error).toBe(true)
      expect(completed.output).toMatch(/require user confirmation/)
    }
  })

  it('runs mutating tools after the permissionPrompt confirms', async () => {
    const registry = new ToolRegistry()
    let ran = false
    registry.register(
      defineTool({
        name: 'write',
        description: '',
        inputSchema: z.object({}),
        isReadOnly: () => false,
        execute: async () => {
          ran = true
          return { output: 'did it', is_error: false }
        },
      }),
    )
    const client = new ScriptedApiClient([
      { message: assistantToolUse('write', {}) },
      { message: assistantText('ok') },
    ])
    const checker = new PermissionChecker(defaultPermissionSettings(PermissionMode.DEFAULT))
    const messages: ConversationMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'go' }] },
    ]
    const prompts: string[] = []
    await drain(
      runQuery(
        {
          apiClient: client,
          toolRegistry: registry,
          permissionChecker: checker,
          cwd: '/tmp',
          model: 'test',
          systemPrompt: '',
          maxTokens: 256,
          maxTurns: 4,
          permissionPrompt: async (name) => {
            prompts.push(name)
            return true
          },
        },
        messages,
      ),
    )
    expect(ran).toBe(true)
    expect(prompts).toEqual(['write'])
  })
})

describe('runQuery — maxTurns + empty assistant', () => {
  it('raises MaxTurnsExceeded when the model never stops requesting tools', async () => {
    const registry = new ToolRegistry()
    registry.register(
      defineTool({
        name: 't',
        description: '',
        inputSchema: z.object({}),
        execute: async () => ({ output: 'ok', is_error: false }),
      }),
    )
    const client = new ScriptedApiClient([
      { message: assistantToolUse('t', {}, 'toolu_1') },
      { message: assistantToolUse('t', {}, 'toolu_2') },
      { message: assistantToolUse('t', {}, 'toolu_3') },
    ])
    const messages: ConversationMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'go' }] },
    ]
    await expect(async () => {
      for await (const _ of runQuery(
        {
          apiClient: client,
          toolRegistry: registry,
          permissionChecker: autoChecker(),
          cwd: '/tmp',
          model: 'test',
          systemPrompt: '',
          maxTokens: 256,
          maxTurns: 2,
        },
        messages,
      )) {
        void _
      }
    }).rejects.toBeInstanceOf(MaxTurnsExceededError)
  })

  it('drops and errors on an empty assistant turn', async () => {
    const client = new ScriptedApiClient([
      { message: { role: 'assistant', content: [] } },
    ])
    const messages: ConversationMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'go' }] },
    ]
    const events = await drain(
      runQuery(
        {
          apiClient: client,
          toolRegistry: new ToolRegistry(),
          permissionChecker: autoChecker(),
          cwd: '/tmp',
          model: 'test',
          systemPrompt: '',
          maxTokens: 256,
          maxTurns: 4,
        },
        messages,
      ),
    )
    expect(events.map((e) => e.type)).toEqual(['error'])
  })
})

describe('runQuery — reactive compaction', () => {
  it('calls the compactor on prompt-too-long and retries the turn', async () => {
    const client = new ScriptedApiClient([
      { message: assistantText(''), throwBefore: new Error('Prompt too long') },
      {
        message: assistantText('ok now'),
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    ])
    const messages: ConversationMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'a' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'A' }] },
      { role: 'user', content: [{ type: 'text', text: 'b' }] },
    ]
    let compactCalls = 0
    const events = await drain(
      runQuery(
        {
          apiClient: client,
          toolRegistry: new ToolRegistry(),
          permissionChecker: autoChecker(),
          cwd: '/tmp',
          model: 'test',
          systemPrompt: '',
          maxTokens: 256,
          maxTurns: 4,
          compactor: async (msgs, reason) => {
            // Ignore the proactive 'auto' ping each turn; only count reactive
            // retries triggered by the scripted prompt-too-long failure.
            if (reason === 'auto') return null
            compactCalls += 1
            return msgs.slice(-1)
          },
        },
        messages,
      ),
    )
    expect(compactCalls).toBe(1)
    // Sequence: status (compacting), assistant_turn_complete (second-try success)
    expect(events.map((e) => e.type)).toEqual(['status', 'assistant_turn_complete'])
  })

  it('surfaces an unrecoverable error when no compactor is provided', async () => {
    const client = new ScriptedApiClient([
      { message: assistantText(''), throwBefore: new Error('Prompt too long') },
    ])
    const messages: ConversationMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'go' }] },
    ]
    const events = await drain(
      runQuery(
        {
          apiClient: client,
          toolRegistry: new ToolRegistry(),
          permissionChecker: autoChecker(),
          cwd: '/tmp',
          model: 'test',
          systemPrompt: '',
          maxTokens: 256,
          maxTurns: 4,
        },
        messages,
      ),
    )
    const types = events.map((e) => e.type)
    expect(types).toContain('status')
    expect(types).toContain('error')
    const err = events.find((e) => e.type === 'error')
    if (err?.type === 'error') {
      expect(err.message).toContain('compaction')
      expect(err.recoverable).toBe(false)
    }
  })
})

describe('runQuery — stream errors', () => {
  it('yields a network ErrorEvent on connection failure', async () => {
    const client = new ScriptedApiClient([
      { message: assistantText(''), throwBefore: new Error('Connection refused') },
    ])
    const messages: ConversationMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'go' }] },
    ]
    const events = await drain(
      runQuery(
        {
          apiClient: client,
          toolRegistry: new ToolRegistry(),
          permissionChecker: autoChecker(),
          cwd: '/tmp',
          model: 'test',
          systemPrompt: '',
          maxTokens: 256,
          maxTurns: 4,
        },
        messages,
      ),
    )
    expect(events).toHaveLength(1)
    const err = events[0]!
    expect(err.type).toBe('error')
    if (err.type === 'error') expect(err.message).toContain('Network error')
  })
})

describe('runQuery — proactive auto-compact', () => {
  it("invokes the compactor with reason='auto' before each model turn", async () => {
    // Two scripted turns: the first emits a tool use so the loop rolls into a
    // second turn. The compactor should be called once before each API call
    // (so twice in total for this scenario) with reason='auto'.
    const registry = new ToolRegistry()
    registry.register(
      defineTool<{ value: string }>({
        name: 'echo',
        description: 'echoes',
        inputSchema: z.object({ value: z.string() }),
        jsonSchema: {
          type: 'object',
          properties: { value: { type: 'string' } },
          required: ['value'],
        },
        execute: async ({ value }) => ({ output: value, is_error: false }),
      }),
    )
    const client = new ScriptedApiClient([
      {
        message: assistantToolUse('echo', { value: 'hi' }),
        usage: { input_tokens: 1, output_tokens: 1 },
      },
      {
        message: assistantText('done'),
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    ])
    const messages: ConversationMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'go' }] },
    ]
    const autoCalls: number[] = []
    await drain(
      runQuery(
        {
          apiClient: client,
          toolRegistry: registry,
          permissionChecker: autoChecker(),
          cwd: '/tmp',
          model: 'test',
          systemPrompt: '',
          maxTokens: 256,
          maxTurns: 4,
          compactor: async (msgs, reason) => {
            if (reason === 'auto') autoCalls.push(msgs.length)
            return null
          },
        },
        messages,
      ),
    )
    // One 'auto' call per turn; two turns fired because the first was a tool call.
    expect(autoCalls.length).toBe(2)
  })

  it("replaces the in-memory history when proactive compaction returns a shorter list", async () => {
    const client = new ScriptedApiClient([
      {
        message: assistantText('ok'),
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    ])
    const messages: ConversationMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'old-1' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'old-A' }] },
      { role: 'user', content: [{ type: 'text', text: 'old-2' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'old-B' }] },
      { role: 'user', content: [{ type: 'text', text: 'current' }] },
    ]
    await drain(
      runQuery(
        {
          apiClient: client,
          toolRegistry: new ToolRegistry(),
          permissionChecker: autoChecker(),
          cwd: '/tmp',
          model: 'test',
          systemPrompt: '',
          maxTokens: 256,
          maxTurns: 4,
          compactor: async (msgs, reason) => {
            if (reason !== 'auto') return null
            // Drop everything but the most recent user turn to simulate a
            // successful auto-compact. The engine should splice this in-place.
            return msgs.slice(-1)
          },
        },
        messages,
      ),
    )
    // The caller-owned array should now reflect the compacted history plus
    // the new assistant turn appended by the loop.
    expect(messages.length).toBe(2)
    expect(messages[0]!.role).toBe('user')
    const firstBlock = messages[0]!.content[0]!
    if (firstBlock.type === 'text') expect(firstBlock.text).toBe('current')
    expect(messages[1]!.role).toBe('assistant')
  })

  it("does nothing when the compactor returns null on 'auto'", async () => {
    const client = new ScriptedApiClient([
      {
        message: assistantText('ok'),
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    ])
    const beforeLen = 3
    const messages: ConversationMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'a' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'A' }] },
      { role: 'user', content: [{ type: 'text', text: 'b' }] },
    ]
    await drain(
      runQuery(
        {
          apiClient: client,
          toolRegistry: new ToolRegistry(),
          permissionChecker: autoChecker(),
          cwd: '/tmp',
          model: 'test',
          systemPrompt: '',
          maxTokens: 256,
          maxTurns: 4,
          compactor: async () => null,
        },
        messages,
      ),
    )
    // History preserved (+ 1 for the newly appended assistant reply).
    expect(messages.length).toBe(beforeLen + 1)
  })

  it("ignores a proactive compaction result that isn't strictly shorter", async () => {
    const client = new ScriptedApiClient([
      {
        message: assistantText('ok'),
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    ])
    const messages: ConversationMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'a' }] },
      { role: 'user', content: [{ type: 'text', text: 'b' }] },
    ]
    await drain(
      runQuery(
        {
          apiClient: client,
          toolRegistry: new ToolRegistry(),
          permissionChecker: autoChecker(),
          cwd: '/tmp',
          model: 'test',
          systemPrompt: '',
          maxTokens: 256,
          maxTurns: 4,
          // Returns an array of the same length — should be ignored.
          compactor: async (msgs) => [...msgs],
        },
        messages,
      ),
    )
    // Original 2 user messages plus the appended assistant reply.
    expect(messages.length).toBe(3)
  })
})
