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
  it('passes the abort signal to the provider request', async () => {
    const controller = new AbortController()
    const client = new ScriptedApiClient([
      {
        message: assistantText('Hello!'),
      },
    ])
    const messages: ConversationMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'Say hi' }] },
    ]

    await drain(
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
          abortSignal: controller.signal,
        },
        messages,
      ),
    )

    expect(client.requests[0]?.signal).toBe(controller.signal)
  })

  it('turns an aborted provider request into a stop status instead of an API error', async () => {
    const controller = new AbortController()
    const client = new ScriptedApiClient([
      {
        message: assistantText('never reached'),
        throwBefore: new DOMException('Request aborted.', 'AbortError'),
      },
    ])
    controller.abort()
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
          abortSignal: controller.signal,
        },
        messages,
      ),
    )

    expect(events).toEqual([
      {
        type: 'status',
        message: 'Stop requested; canceling the active model call.',
      },
    ])
  })

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

  it('can nudge a plan-only assistant turn and continue to a tool call', async () => {
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
      { message: assistantText('I will inspect the files next.') },
      { message: assistantToolUse('echo', { value: 'now' }) },
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
          noToolTurnNudge: 'Take a concrete tool step now.',
          noToolTurnNudgeLimit: 1,
        },
        messages,
      ),
    )

    expect(called).toBe(true)
    expect(events.map((e) => e.type)).toEqual([
      'assistant_turn_complete',
      'status',
      'assistant_turn_complete',
      'tool_execution_started',
      'tool_execution_completed',
      'assistant_turn_complete',
    ])
    expect(messages[2]).toEqual({
      role: 'user',
      content: [{ type: 'text', text: 'Take a concrete tool step now.' }],
    })
  })

  it('preserves the last non-empty assistant text across a later tool-only turn', async () => {
    const registry = new ToolRegistry()
    let seenLastAssistantText = ''
    registry.register(
      defineTool({
        name: 'capture-last-assistant-text',
        description: 'captures metadata.last_assistant_text',
        inputSchema: z.object({}),
        execute: async (_input, ctx) => {
          seenLastAssistantText = String(ctx.metadata['last_assistant_text'] ?? '')
          return { output: 'captured', is_error: false }
        },
      }),
    )
    const client = new ScriptedApiClient([
      { message: assistantText('Pick one: happy path only, or error cases too?') },
      { message: assistantToolUse('capture-last-assistant-text', {}) },
      { message: assistantText('done') },
    ])
    const messages: ConversationMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'go' }] },
    ]
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
          noToolTurnNudge: 'Take a concrete tool step now.',
          noToolTurnNudgeLimit: 1,
          toolMetadata: {},
        },
        messages,
      ),
    )

    expect(seenLastAssistantText).toBe('Pick one: happy path only, or error cases too?')
  })

  it('does not nudge a final summary after a tool call has already run', async () => {
    const registry = new ToolRegistry()
    registry.register(
      defineTool({
        name: 'echo',
        description: 'returns its input',
        inputSchema: z.object({ value: z.string() }),
        execute: async (input) => ({ output: `echoed: ${input.value}`, is_error: false }),
      }),
    )
    const client = new ScriptedApiClient([
      { message: assistantToolUse('echo', { value: 'done' }) },
      { message: assistantText('All done.') },
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
          noToolTurnNudge: 'Take a concrete tool step now.',
          noToolTurnNudgeLimit: 3,
        },
        messages,
      ),
    )

    expect(events.map((e) => e.type)).toEqual([
      'assistant_turn_complete',
      'tool_execution_started',
      'tool_execution_completed',
      'assistant_turn_complete',
    ])
    expect(client.requests).toHaveLength(2)
    expect(messages.filter((m) => m.role === 'user')).toHaveLength(2)
  })

  it('nudges after repeated read-only tool turns and continues to a durable progress tool', async () => {
    const registry = new ToolRegistry()
    let readOnlyCalls = 0
    let durableCalls = 0
    registry.register(
      defineTool({
        name: 'read-file',
        description: 'reads a file',
        inputSchema: z.object({ filePath: z.string() }),
        execute: async (input) => {
          readOnlyCalls += 1
          return { output: `read ${input.filePath}`, is_error: false }
        },
      }),
    )
    registry.register(
      defineTool({
        name: 'update-task',
        description: 'writes the task spec',
        inputSchema: z.object({ status: z.string().optional() }),
        execute: async () => {
          durableCalls += 1
          return { output: 'task updated', is_error: false }
        },
      }),
    )
    const client = new ScriptedApiClient([
      { message: assistantToolUse('read-file', { filePath: 'a.md' }, 'toolu_1') },
      { message: assistantToolUse('read-file', { filePath: 'b.md' }, 'toolu_2') },
      { message: assistantToolUse('update-task', { status: 'spec_review' }, 'toolu_3') },
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
          maxTurns: 6,
          noProgressToolNames: ['update-task'],
          noProgressTurnNudge:
            'Stop researching and write the spec, ask the question, or escalate now.',
          noProgressTurnNudgeLimit: 1,
          noProgressTurnThreshold: 2,
        },
        messages,
      ),
    )

    expect(readOnlyCalls).toBe(2)
    expect(durableCalls).toBe(1)
    expect(events.map((e) => e.type)).toEqual([
      'assistant_turn_complete',
      'tool_execution_started',
      'tool_execution_completed',
      'assistant_turn_complete',
      'tool_execution_started',
      'tool_execution_completed',
      'status',
      'assistant_turn_complete',
      'tool_execution_started',
      'tool_execution_completed',
      'assistant_turn_complete',
    ])
    expect(messages[5]).toEqual({
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'Stop researching and write the spec, ask the question, or escalate now.',
        },
      ],
    })
  })

  it('refuses further read-only tool calls after a durable-progress nudge has already been issued', async () => {
    const registry = new ToolRegistry()
    let readOnlyCalls = 0
    let durableCalls = 0
    registry.register(
      defineTool({
        name: 'read-file',
        description: 'reads a file',
        inputSchema: z.object({ filePath: z.string() }),
        isReadOnly: () => true,
        execute: async (input) => {
          readOnlyCalls += 1
          return { output: `read ${input.filePath}`, is_error: false }
        },
      }),
    )
    registry.register(
      defineTool({
        name: 'update-task',
        description: 'writes the task spec',
        inputSchema: z.object({ status: z.string().optional() }),
        execute: async () => {
          durableCalls += 1
          return { output: 'task updated', is_error: false }
        },
      }),
    )
    const client = new ScriptedApiClient([
      { message: assistantToolUse('read-file', { filePath: 'a.md' }, 'toolu_1') },
      { message: assistantToolUse('read-file', { filePath: 'b.md' }, 'toolu_2') },
      { message: assistantToolUse('read-file', { filePath: 'c.md' }, 'toolu_3') },
      { message: assistantToolUse('update-task', { status: 'spec_review' }, 'toolu_4') },
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
          maxTurns: 8,
          noProgressToolNames: ['update-task'],
          noProgressTurnNudge:
            'Stop researching and write the spec, ask the question, or escalate now.',
          noProgressTurnNudgeLimit: 1,
          noProgressTurnThreshold: 2,
        },
        messages,
      ),
    )

    expect(readOnlyCalls).toBe(2)
    expect(durableCalls).toBe(1)
    expect(events.some((event) =>
      event.type === 'status' &&
      event.message.includes('refusing more read-only tool calls for this turn'),
    )).toBe(true)
    const rejectedRead = messages.find((message) =>
      message.role === 'user' &&
      Array.isArray(message.content) &&
      message.content.some((part) =>
        typeof part === 'object' &&
        part !== null &&
        'type' in part &&
        part.type === 'tool_result' &&
        String(part.content).includes('Research budget exhausted for this intake turn'),
      ),
    )
    expect(rejectedRead).toBeTruthy()
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

  it('hydrates project paths for task-state tools before validation', async () => {
    const registry = new ToolRegistry()
    let observedTasksPath = ''
    registry.register(
      defineTool({
        name: 'update-task',
        description: '',
        inputSchema: z.object({ tasksPath: z.string(), taskId: z.string().optional() }),
        execute: async (input) => {
          observedTasksPath = input.tasksPath
          return { output: 'updated', is_error: false }
        },
      }),
    )
    const client = new ScriptedApiClient([
      { message: assistantToolUse('update-task', { taskId: 'task-1' }) },
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
          cwd: '/workspace/project',
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
      expect(completed.is_error).toBe(false)
      expect(completed.output).toBe('updated')
    }
    expect(observedTasksPath).toBe('/workspace/project/memory/TASKS.json')
  })

  it('blocks worker-style review handoff without implementation evidence', async () => {
    const registry = new ToolRegistry()
    let called = false
    registry.register(
      defineTool({
        name: 'update-task',
        description: '',
        inputSchema: z.object({
          tasksPath: z.string(),
          taskId: z.string(),
          status: z.string(),
        }),
        execute: async () => {
          called = true
          return { output: 'updated', is_error: false }
        },
      }),
    )
    const client = new ScriptedApiClient([
      { message: assistantToolUse('update-task', { taskId: 'task-1', status: 'review' }) },
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
          cwd: '/workspace/project',
          model: 'test',
          systemPrompt: '',
          maxTokens: 256,
          maxTurns: 4,
        },
        messages,
      ),
    )
    const completed = events.find((e) => e.type === 'tool_execution_completed')
    expect(called).toBe(false)
    expect(completed?.type === 'tool_execution_completed' ? completed.is_error : false).toBe(true)
    expect(completed?.type === 'tool_execution_completed' ? completed.output : '').toContain('Blocked transition to review')
  })

  it('allows review handoff after source inspection and verification', async () => {
    const registry = new ToolRegistry()
    let called = false
    registry.register(
      defineTool({
        name: 'read-file',
        description: '',
        inputSchema: z.object({ filePath: z.string() }),
        isReadOnly: () => true,
        execute: async () => ({ output: 'export const x = 1', is_error: false }),
      }),
    )
    registry.register(
      defineTool({
        name: 'shell',
        description: '',
        inputSchema: z.object({ command: z.string() }),
        isReadOnly: () => true,
        execute: async () => ({ output: 'tests passed', is_error: false }),
      }),
    )
    registry.register(
      defineTool({
        name: 'update-task',
        description: '',
        inputSchema: z.object({
          tasksPath: z.string(),
          taskId: z.string(),
          status: z.string(),
        }),
        execute: async () => {
          called = true
          return { output: 'updated', is_error: false }
        },
      }),
    )
    const client = new ScriptedApiClient([
      { message: assistantToolUse('update-task', { taskId: 'task-1', status: 'in_progress' }, 'start-1') },
      {
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'read-1',
              name: 'read-file',
              input: { filePath: '/workspace/project/packages/converter/src/index.ts' },
            },
          ],
        },
      },
      {
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'shell-1',
              name: 'shell',
              input: { command: 'pnpm test' },
            },
          ],
        },
      },
      { message: assistantToolUse('update-task', { taskId: 'task-1', status: 'review' }, 'update-1') },
      { message: assistantText('ok') },
    ])
    const messages: ConversationMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'go' }] },
    ]
    const toolMetadata: Record<string, unknown> = {}
    const events = await drain(
      runQuery(
        {
          apiClient: client,
          toolRegistry: registry,
          permissionChecker: autoChecker(),
          cwd: '/workspace/project',
          model: 'test',
          systemPrompt: '',
          maxTokens: 256,
          maxTurns: 6,
          toolMetadata,
        },
        messages,
      ),
    )
    const updateCompleted = events
      .filter((e) => e.type === 'tool_execution_completed')
      .at(-1)
    expect(called).toBe(true)
    expect(updateCompleted?.type === 'tool_execution_completed' ? updateCompleted.is_error : true).toBe(false)
    expect(updateCompleted?.type === 'tool_execution_completed' ? updateCompleted.output : '').toBe('updated')
  })

  it('does not allow stale handoff evidence from a previous task', async () => {
    const registry = new ToolRegistry()
    let reviewCalls = 0
    registry.register(
      defineTool({
        name: 'read-file',
        description: '',
        inputSchema: z.object({ filePath: z.string() }),
        isReadOnly: () => true,
        execute: async () => ({ output: 'export const x = 1', is_error: false }),
      }),
    )
    registry.register(
      defineTool({
        name: 'shell',
        description: '',
        inputSchema: z.object({ command: z.string() }),
        isReadOnly: () => true,
        execute: async () => ({ output: 'tests passed', is_error: false }),
      }),
    )
    registry.register(
      defineTool({
        name: 'update-task',
        description: '',
        inputSchema: z.object({
          tasksPath: z.string(),
          taskId: z.string(),
          status: z.string(),
        }),
        execute: async (input) => {
          if (input.status === 'review') reviewCalls += 1
          return {
            output: 'updated',
            is_error: false,
            metadata: { success: true, taskId: input.taskId },
          }
        },
      }),
    )
    const client = new ScriptedApiClient([
      { message: assistantToolUse('update-task', { taskId: 'task-1', status: 'in_progress' }, 'start-1') },
      {
        message: assistantToolUse(
          'read-file',
          { filePath: '/workspace/project/packages/converter/src/index.ts' },
          'read-1',
        ),
      },
      { message: assistantToolUse('shell', { command: 'pnpm test' }, 'shell-1') },
      { message: assistantToolUse('update-task', { taskId: 'task-1', status: 'review' }, 'review-1') },
      { message: assistantToolUse('update-task', { taskId: 'task-2', status: 'in_progress' }, 'start-2') },
      { message: assistantToolUse('update-task', { taskId: 'task-2', status: 'review' }, 'review-2') },
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
          cwd: '/workspace/project',
          model: 'test',
          systemPrompt: '',
          maxTokens: 256,
          maxTurns: 8,
          toolMetadata: {},
        },
        messages,
      ),
    )
    const completed = events.filter((e) => e.type === 'tool_execution_completed')
    expect(reviewCalls).toBe(1)
    expect(completed.at(-1)?.type === 'tool_execution_completed' ? completed.at(-1)?.is_error : false).toBe(true)
    expect(completed.at(-1)?.type === 'tool_execution_completed' ? completed.at(-1)?.output : '').toContain('Blocked transition to review')
  })

  it('preserves handoff evidence when a worker writes self-critique before review', async () => {
    const registry = new ToolRegistry()
    let reviewCalls = 0
    registry.register(
      defineTool({
        name: 'read-file',
        description: '',
        inputSchema: z.object({ filePath: z.string() }),
        isReadOnly: () => true,
        execute: async () => ({ output: 'export const x = 1', is_error: false }),
      }),
    )
    registry.register(
      defineTool({
        name: 'shell',
        description: '',
        inputSchema: z.object({ command: z.string() }),
        isReadOnly: () => true,
        execute: async () => ({ output: 'tests passed', is_error: false }),
      }),
    )
    registry.register(
      defineTool({
        name: 'update-task',
        description: '',
        inputSchema: z.object({
          tasksPath: z.string(),
          taskId: z.string(),
          status: z.string(),
          note: z.object({
            agentId: z.string(),
            role: z.string(),
            content: z.string(),
          }).optional(),
        }),
        execute: async (input) => {
          if (input.status === 'review') reviewCalls += 1
          return {
            output: 'updated',
            is_error: false,
            metadata: { success: true, taskId: input.taskId },
          }
        },
      }),
    )
    const client = new ScriptedApiClient([
      { message: assistantToolUse('update-task', { taskId: 'task-1', status: 'in_progress' }, 'start-1') },
      {
        message: assistantToolUse(
          'read-file',
          { filePath: '/workspace/project/packages/converter/src/index.ts' },
          'read-1',
        ),
      },
      { message: assistantToolUse('shell', { command: 'pnpm test' }, 'shell-1') },
      {
        message: assistantToolUse(
          'update-task',
          {
            taskId: 'task-1',
            status: 'in_progress',
            note: {
              agentId: 'worker-agent',
              role: 'worker',
              content: 'Self-critique: all good.',
            },
          },
          'critique-1',
        ),
      },
      { message: assistantToolUse('update-task', { taskId: 'task-1', status: 'review' }, 'review-1') },
      { message: assistantText('ok') },
    ])
    const events = await drain(
      runQuery(
        {
          apiClient: client,
          toolRegistry: registry,
          permissionChecker: autoChecker(),
          cwd: '/workspace/project',
          model: 'test',
          systemPrompt: '',
          maxTokens: 256,
          maxTurns: 8,
          toolMetadata: {},
        },
        [{ role: 'user', content: [{ type: 'text', text: 'go' }] }],
      ),
    )
    const completed = events.filter((e) => e.type === 'tool_execution_completed')
    expect(reviewCalls).toBe(1)
    expect(completed.at(-1)?.type === 'tool_execution_completed' ? completed.at(-1)?.is_error : true).toBe(false)
    expect(completed.at(-1)?.type === 'tool_execution_completed' ? completed.at(-1)?.output : '').toBe('updated')
  })

  it('allows review handoff for a resumed in-progress task when current task metadata is seeded', async () => {
    const registry = new ToolRegistry()
    let reviewCalls = 0
    registry.register(
      defineTool({
        name: 'read-file',
        description: '',
        inputSchema: z.object({ filePath: z.string() }),
        isReadOnly: () => true,
        execute: async () => ({ output: 'export const x = 1', is_error: false }),
      }),
    )
    registry.register(
      defineTool({
        name: 'shell',
        description: '',
        inputSchema: z.object({ command: z.string() }),
        isReadOnly: () => true,
        execute: async () => ({ output: 'typecheck passed', is_error: false }),
      }),
    )
    registry.register(
      defineTool({
        name: 'update-task',
        description: '',
        inputSchema: z.object({
          tasksPath: z.string(),
          taskId: z.string(),
          status: z.string(),
          note: z.object({
            agentId: z.string(),
            role: z.string(),
            content: z.string(),
          }).optional(),
        }),
        execute: async (input) => {
          if (input.status === 'review') reviewCalls += 1
          return {
            output: 'updated',
            is_error: false,
            metadata: { success: true, taskId: input.taskId },
          }
        },
      }),
    )
    const client = new ScriptedApiClient([
      {
        message: assistantToolUse(
          'read-file',
          { filePath: '/workspace/project/packages/converter/src/index.ts' },
          'read-1',
        ),
      },
      { message: assistantToolUse('shell', { command: 'pnpm typecheck' }, 'shell-1') },
      {
        message: assistantToolUse(
          'update-task',
          {
            taskId: 'task-1',
            status: 'in_progress',
            note: {
              agentId: 'worker-agent',
              role: 'worker',
              content: 'Self-critique: verified and ready for review.',
            },
          },
          'critique-1',
        ),
      },
      { message: assistantToolUse('update-task', { taskId: 'task-1', status: 'review' }, 'review-1') },
      { message: assistantText('ok') },
    ])
    const events = await drain(
      runQuery(
        {
          apiClient: client,
          toolRegistry: registry,
          permissionChecker: autoChecker(),
          cwd: '/workspace/project',
          model: 'test',
          systemPrompt: '',
          maxTokens: 256,
          maxTurns: 8,
          toolMetadata: { current_task_id: 'task-1' },
        },
        [{ role: 'user', content: [{ type: 'text', text: 'go' }] }],
      ),
    )
    const completed = events.filter((e) => e.type === 'tool_execution_completed')
    expect(reviewCalls).toBe(1)
    expect(completed.at(-1)?.type === 'tool_execution_completed' ? completed.at(-1)?.is_error : true).toBe(false)
    expect(completed.at(-1)?.type === 'tool_execution_completed' ? completed.at(-1)?.output : '').toBe('updated')
  })

  it('replaces relative project paths for task-state tools', async () => {
    const registry = new ToolRegistry()
    let observedTasksPath = ''
    registry.register(
      defineTool({
        name: 'read-tasks',
        description: '',
        inputSchema: z.object({ tasksPath: z.string() }),
        isReadOnly: () => true,
        execute: async (input) => {
          observedTasksPath = input.tasksPath
          return { output: 'read', is_error: false }
        },
      }),
    )
    const client = new ScriptedApiClient([
      { message: assistantToolUse('read-tasks', { tasksPath: 'tasks.json' }) },
      { message: assistantText('ok') },
    ])
    const messages: ConversationMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'go' }] },
    ]
    await drain(
      runQuery(
        {
          apiClient: client,
          toolRegistry: registry,
          permissionChecker: autoChecker(),
          cwd: '/workspace/project',
          model: 'test',
          systemPrompt: '',
          maxTokens: 256,
          maxTurns: 4,
        },
        messages,
      ),
    )
    expect(observedTasksPath).toBe('/workspace/project/memory/TASKS.json')
  })

  it('replaces invented absolute project paths for task-state tools', async () => {
    const registry = new ToolRegistry()
    let observedTasksPath = ''
    registry.register(
      defineTool({
        name: 'raise-escalation',
        description: '',
        inputSchema: z.object({
          tasksPath: z.string(),
          progressPath: z.string(),
          taskId: z.string(),
          agentId: z.string(),
          reason: z.string(),
          summary: z.string(),
        }),
        execute: async (input) => {
          observedTasksPath = input.tasksPath
          return { output: input.progressPath, is_error: false }
        },
      }),
    )
    const client = new ScriptedApiClient([
      {
        message: assistantToolUse('raise-escalation', {
          tasksPath: '/workspace/TASKS.json',
          progressPath: '/workspace/PROGRESS.md',
          taskId: 'task-1',
          agentId: 'worker-agent',
          reason: 'decision_required',
          summary: 'Need a decision',
        }),
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
          cwd: '/workspace/project',
          model: 'test',
          systemPrompt: '',
          maxTokens: 256,
          maxTurns: 4,
        },
        messages,
      ),
    )
    const completed = events.find(e => e.type === 'tool_execution_completed')
    expect(observedTasksPath).toBe('/workspace/project/memory/TASKS.json')
    expect(completed?.type === 'tool_execution_completed' ? completed.output : '').toBe('/workspace/project/memory/PROGRESS.md')
  })

  it('hydrates project memoryDir for checkpoint tools', async () => {
    const registry = new ToolRegistry()
    let observedTasksPath = ''
    let observedMemoryDir = ''
    registry.register(
      defineTool({
        name: 'write-checkpoint',
        description: '',
        inputSchema: z.object({
          tasksPath: z.string(),
          memoryDir: z.string(),
          taskId: z.string(),
          agentId: z.string(),
          intent: z.string(),
          nextPlannedAction: z.string(),
          filesTouched: z.array(z.string()),
        }),
        execute: async (input) => {
          observedTasksPath = input.tasksPath
          observedMemoryDir = input.memoryDir
          return { output: 'checkpointed', is_error: false }
        },
      }),
    )
    const client = new ScriptedApiClient([
      {
        message: assistantToolUse('write-checkpoint', {
          taskId: 'task-1',
          agentId: 'worker-agent',
          intent: 'keep state',
          nextPlannedAction: 'run tests',
          filesTouched: [],
        }),
      },
      { message: assistantText('ok') },
    ])
    const messages: ConversationMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'go' }] },
    ]

    await drain(
      runQuery(
        {
          apiClient: client,
          toolRegistry: registry,
          permissionChecker: autoChecker(),
          cwd: '/workspace/project',
          model: 'test',
          systemPrompt: '',
          maxTokens: 256,
          maxTurns: 4,
        },
        messages,
      ),
    )

    expect(observedTasksPath).toBe('/workspace/project/memory/TASKS.json')
    expect(observedMemoryDir).toBe('/workspace/project/memory')
  })

  it('nudges the agent after repeating the same failed tool call', async () => {
    const registry = new ToolRegistry()
    registry.register(
      defineTool({
        name: 'shell',
        description: '',
        inputSchema: z.object({ command: z.string(), cwd: z.string() }),
        execute: async () => ({ output: 'module not found', is_error: true }),
      }),
    )
    const client = new ScriptedApiClient([
      { message: assistantToolUse('shell', { command: 'node test-conversion.ts', cwd: '/workspace/project' }, 'toolu_1') },
      { message: assistantToolUse('shell', { command: 'node test-conversion.ts', cwd: '/workspace/project' }, 'toolu_2') },
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
          cwd: '/workspace/project',
          model: 'test',
          systemPrompt: '',
          maxTokens: 256,
          maxTurns: 4,
        },
        messages,
      ),
    )

    expect(events.some(e =>
      e.type === 'status' &&
      e.message.includes('Repeated unproductive tool call detected'),
    )).toBe(true)
    expect(messages.some(message =>
      message.role === 'user' &&
      message.content.some(block =>
        block.type === 'text' &&
        block.text.includes('Do not repeat that exact tool call again.'),
      ),
    )).toBe(true)
  })

  it('nudges the agent after repeating the same no-match tool call', async () => {
    const registry = new ToolRegistry()
    registry.register(
      defineTool({
        name: 'tool-search',
        description: '',
        inputSchema: z.object({ query: z.string() }),
        isReadOnly: () => true,
        execute: async () => ({ output: '(no matches)', is_error: false }),
      }),
    )
    const client = new ScriptedApiClient([
      { message: assistantToolUse('tool-search', { query: '[agent]' }, 'toolu_1') },
      { message: assistantToolUse('tool-search', { query: '[agent]' }, 'toolu_2') },
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
          cwd: '/workspace/project',
          model: 'test',
          systemPrompt: '',
          maxTokens: 256,
          maxTurns: 4,
        },
        messages,
      ),
    )

    expect(events.some(e =>
      e.type === 'status' &&
      e.message.includes('Repeated unproductive tool call detected'),
    )).toBe(true)
    expect(messages.some(message =>
      message.role === 'user' &&
      message.content.some(block =>
        block.type === 'text' &&
        block.text.includes('returned no useful result'),
      ),
    )).toBe(true)
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
