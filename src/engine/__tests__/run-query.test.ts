/**
 * Exercises runQuery end-to-end against a scripted fake provider + fake tools.
 * Upstream reference: openharness tests for engine/query.py.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

  it('nudges future-step planning prose even after an earlier tool call already ran', async () => {
    const registry = new ToolRegistry()
    let durableCalls = 0
    registry.register(
      defineTool({
        name: 'append-exploring-transcript',
        description: 'persists transcript text',
        inputSchema: z.object({ text: z.string() }),
        execute: async () => ({ output: 'persisted', is_error: false }),
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
      { message: assistantToolUse('append-exploring-transcript', { text: 'noted' }, 'toolu_1') },
      {
        message: assistantText(
          "I'll draft the spec now, move the task to spec_review, and log progress.",
        ),
      },
      { message: assistantToolUse('update-task', { status: 'spec_review' }, 'toolu_2') },
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
          noToolTurnNudge:
            'Take a concrete durable tool step now: update-task, update-product-brief, post-user-question, or raise-escalation.',
          noToolTurnNudgeLimit: 2,
        },
        messages,
      ),
    )

    expect(durableCalls).toBe(1)
    expect(events.some((event) =>
      event.type === 'status' &&
      event.message.includes('only narrated future steps without a tool call'),
    )).toBe(true)
    expect(messages).toContainEqual({
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'Take a concrete durable tool step now: update-task, update-product-brief, post-user-question, or raise-escalation.',
        },
      ],
    })
  })

  it('demands a handoff tool call after review-ready prose with verified evidence', async () => {
    const registry = new ToolRegistry()
    let checkpointCalls = 0
    registry.register(
      defineTool({
        name: 'write-checkpoint',
        description: 'writes a checkpoint',
        inputSchema: z.object({
          memoryDir: z.string(),
          tasksPath: z.string(),
          taskId: z.string(),
          agentId: z.string(),
          intent: z.string(),
          nextPlannedAction: z.string(),
          filesTouched: z.array(z.string()),
        }),
        execute: async () => {
          checkpointCalls += 1
          return { output: 'checkpoint written', is_error: false }
        },
      }),
    )
    const client = new ScriptedApiClient([
      {
        message: assistantText(
          "Implemented and verified from the specified files, and I've now got the concrete evidence needed for review. I still need one final pass through task-state tools to finish handoff exactly per process.",
        ),
      },
      {
        message: assistantToolUse('write-checkpoint', {
          taskId: 'task-1',
          agentId: 'worker-agent',
          intent: 'Review-ready handoff after focused verification.',
          nextPlannedAction: 'Append final handoff note and move to review.',
          filesTouched: ['/workspace/project/web/tests/unit/composables/use-presence.test.ts'],
        }),
      },
      { message: assistantText('done') },
    ])
    const messages: ConversationMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'go' }] },
    ]
    const toolMetadata: Record<string, unknown> = {
      review_handoff_evidence: {
        taskId: 'task-1',
        inspectedImplementationFile: true,
        changedOrVerified: true,
      },
    }
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
          maxTurns: 5,
          noToolTurnNudge: 'Take a concrete tool step now.',
          noToolTurnNudgeLimit: 2,
          toolMetadata,
        },
        messages,
      ),
    )

    expect(checkpointCalls).toBe(1)
    expect(events.some((e) =>
      e.type === 'status' &&
      e.message.includes('review-ready handoff prose without a task-state tool call'),
    )).toBe(true)
    const nudge = messages.find((m) =>
      m.role === 'user' &&
      Array.isArray(m.content) &&
      m.content.some((part) =>
        typeof part === 'object' &&
        part !== null &&
        'type' in part &&
        part.type === 'text' &&
        String(part.text).includes('verified implementation evidence'),
      ),
    )
  expect(nudge).toBeTruthy()
  })

  it('demands self-critique persistence after a worker writes structured self-critique prose without a tool call', async () => {
    const registry = new ToolRegistry()
    let updateCalls = 0
    registry.register(
      defineTool({
        name: 'update-task',
        description: 'persists task state',
        inputSchema: z.object({
          taskId: z.string(),
          status: z.string(),
          note: z.object({
            agentId: z.string(),
            role: z.string(),
            content: z.string(),
          }).optional(),
        }),
        execute: async () => {
          updateCalls += 1
          return { output: 'task updated', is_error: false }
        },
      }),
    )
    const client = new ScriptedApiClient([
      {
        message: assistantText(`**Self-critique:**
For each acceptance criterion:
- [ac-1]: Met — The intended file change is complete.

Minimum-scope check:
- Files changed: /workspace/project/packages/converter/src/index.ts
- Smallest useful change?: yes — the change stayed in one file.
- Anything to revert before review?: none

Review proof packet:
- Changed files / diff scope: /workspace/project/packages/converter/src/index.ts
- Verification commands passed: pnpm test passed
- Working hypothesis at handoff: The intended file change is complete and verified.
- Known gaps / follow-up: none

Out-of-scope changes introduced: none
Uncertainties: none`),
      },
      {
        message: assistantToolUse('update-task', {
          taskId: 'task-1',
          status: 'in_progress',
          note: {
            agentId: 'worker-agent',
            role: 'self-critique',
            content: '**Self-critique:** persisted.',
          },
        }, 'toolu_1'),
      },
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
          cwd: '/workspace/project',
          model: 'test',
          systemPrompt: '',
          maxTokens: 256,
          maxTurns: 5,
          noToolTurnNudge: 'Take a concrete tool step now.',
          noToolTurnNudgeLimit: 2,
          toolMetadata: {
            review_handoff_evidence: {
              taskId: 'task-1',
              inspectedImplementationFile: true,
              changedOrVerified: true,
            },
          },
        },
        messages,
      ),
    )

    expect(updateCalls).toBe(1)
    expect(events.some((e) =>
      e.type === 'status' &&
      e.message.includes('review-ready handoff prose without a task-state tool call'),
    )).toBe(true)
    expect(messages.some((message) =>
      message.role === 'user' &&
      message.content.some((block) =>
        block.type === 'text' &&
        block.text.includes('persist that exact self-critique now'),
      ),
    )).toBe(true)
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

  it('ends the turn after repeated intake-budget read-only refusals', async () => {
    const registry = new ToolRegistry()
    let readOnlyCalls = 0
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
    const client = new ScriptedApiClient([
      { message: assistantToolUse('read-file', { filePath: 'a.md' }, 'toolu_1') },
      { message: assistantToolUse('read-file', { filePath: 'b.md' }, 'toolu_2') },
      { message: assistantToolUse('read-file', { filePath: 'c.md' }, 'toolu_3') },
      { message: assistantToolUse('read-file', { filePath: 'd.md' }, 'toolu_4') },
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
    expect(events.some((event) =>
      event.type === 'status' &&
      event.message.includes('repeated intake-budget refusals'),
    )).toBe(true)
  })

  it('ends the turn when append-exploring-transcript is used alone after a durable-progress nudge', async () => {
    const registry = new ToolRegistry()
    registry.register(
      defineTool({
        name: 'read-file',
        description: 'reads a file',
        inputSchema: z.object({ filePath: z.string() }),
        isReadOnly: () => true,
        execute: async (input) => ({ output: `read ${input.filePath}`, is_error: false }),
      }),
    )
    registry.register(
      defineTool({
        name: 'append-exploring-transcript',
        description: 'persists transcript text',
        inputSchema: z.object({ text: z.string().optional() }),
        execute: async () => ({ output: 'persisted transcript', is_error: false }),
      }),
    )
    const client = new ScriptedApiClient([
      { message: assistantToolUse('read-file', { filePath: 'a.md' }, 'toolu_1') },
      { message: assistantToolUse('read-file', { filePath: 'b.md' }, 'toolu_2') },
      { message: assistantToolUse('read-file', { filePath: 'c.md' }, 'toolu_3') },
      { message: assistantToolUse('append-exploring-transcript', {}, 'toolu_4') },
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
          noProgressTurnNudgeLimit: 2,
          noProgressTurnThreshold: 2,
        },
        messages,
      ),
    )

    expect(events.some((event) =>
      event.type === 'status' &&
      event.message.includes('only appended the exploring transcript after a durable-progress nudge'),
    )).toBe(true)
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
    let reviewCalls = 0
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
      { message: assistantToolUse('update-task', { tasksPath: '/workspace/project/memory/TASKS.json', taskId: 'task-1', status: 'review' }) },
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
          toolMetadata: { current_task_id: 'task-1' },
        },
        messages,
      ),
    )
    const completed = events.find((e) =>
      e.type === 'tool_execution_completed' &&
      e.output.includes('Blocked transition to review'),
    )
    expect(reviewCalls).toBe(0)
    expect(completed?.type === 'tool_execution_completed' ? completed.is_error : false).toBe(true)
    expect(completed?.type === 'tool_execution_completed' ? completed.output : '').toContain('Blocked transition to review')
  })

  it('allows review handoff after source inspection, verification, and a structured self-critique note', async () => {
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
      {
        message: assistantToolUse(
          'update-task',
          {
            taskId: 'task-1',
            status: 'review',
            note: {
              agentId: 'worker-agent',
              role: 'self-critique',
              content: `**Self-critique:**
For each acceptance criterion:
- [ac-1]: Met — The implementation file was inspected and updated appropriately.

Minimum-scope check:
- Files changed: /workspace/project/packages/converter/src/index.ts
- Smallest useful change?: yes — no extra files changed.
- Anything to revert before review?: none

Review proof packet:
- Changed files / diff scope: /workspace/project/packages/converter/src/index.ts
- Verification commands passed: pnpm test passed
- Working hypothesis at handoff: The implementation file was inspected and verified.
- Known gaps / follow-up: none

Out-of-scope changes introduced: none
Uncertainties: none`,
            },
          },
          'update-1',
        ),
      },
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

  it('blocks review handoff when authoritative verification commands have not been durably proven', async () => {
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
        execute: async (input) => ({
          output: `${input.command} ok`,
          is_error: false,
          metadata: {
            success: true,
            exitCode: 0,
            executedCommand: input.command,
            usedAuthoritativeCommand: false,
          },
        }),
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
          return { output: 'updated', is_error: false }
        },
      }),
    )
    const client = new ScriptedApiClient([
      {
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'read-1',
              name: 'read-file',
              input: { filePath: '/workspace/project/knit/web/app/components/organisms/VersionHistoryDialog.vue' },
            },
          ],
        },
      },
      {
        message: assistantToolUse(
          'shell',
          {
            command: 'git status --short',
          },
          'shell-non-authoritative',
        ),
      },
      {
        message: assistantToolUse(
          'update-task',
          {
            taskId: 'task-verify',
            status: 'review',
            note: {
              agentId: 'worker-agent',
              role: 'self-critique',
              content: `**Self-critique:**
For each acceptance criterion:
- [ac-1]: Met — Added the missing diff action.
- [ac-7]: Met — Typecheck passes.
- [ac-8]: Met — Build succeeds.

Minimum-scope check:
- Files changed: /workspace/project/knit/web/app/components/organisms/VersionHistoryDialog.vue
- Smallest useful change?: yes
- Anything to revert before review?: none

Review proof packet:
- Changed files / diff scope: /workspace/project/knit/web/app/components/organisms/VersionHistoryDialog.vue
- Verification commands passed: pnpm --filter @knit-app typecheck passed; pnpm --filter @knit-app build passed
- Working hypothesis at handoff: The diff action work is complete and both authoritative commands passed.
- Known gaps / follow-up: none

Out-of-scope changes introduced: none
Uncertainties: none`,
            },
          },
          'update-verify',
        ),
      },
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
          maxTurns: 4,
          toolMetadata: {
            current_task_id: 'task-verify',
            current_task_verification_commands: [
              'pnpm --filter @knit-app typecheck',
              'pnpm --filter @knit-app build',
            ],
          },
        },
        [{ role: 'user', content: [{ type: 'text', text: 'go' }] }],
      ),
    )

    const completed = events.find((e) =>
      e.type === 'tool_execution_completed' &&
      e.output.includes('durable proof'),
    )
    expect(reviewCalls).toBe(0)
    expect(completed?.type === 'tool_execution_completed' ? completed.is_error : false).toBe(true)
    expect(completed?.type === 'tool_execution_completed' ? completed.output : '').toContain('durable proof')
    expect(completed?.type === 'tool_execution_completed' ? completed.output : '').toContain('pnpm --filter @knit-app typecheck')
    expect(completed?.type === 'tool_execution_completed' ? completed.output : '').toContain('pnpm --filter @knit-app build')
  })

  it('allows review handoff when the self-critique uses plain AC lines and a bold minimum-scope heading', async () => {
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
      { message: assistantToolUse('update-task', { taskId: 'task-1', status: 'in_progress' }, 'start-plain-ac') },
      {
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'read-plain-ac',
              name: 'read-file',
              input: { filePath: '/workspace/project/frontend/app/pages/login.vue' },
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
              id: 'shell-plain-ac',
              name: 'shell',
              input: { command: 'pnpm build' },
            },
          ],
        },
      },
      {
        message: assistantToolUse(
          'update-task',
          {
            taskId: 'task-1',
            status: 'review',
            note: {
              agentId: 'worker-agent',
              role: 'self-critique',
              content: `**Self-critique:**

AC-1 (Registration): Met - /register calls supabase.auth.signUp(), redirects to /register/success on success.
AC-2 (Email confirmation): Met - /auth/confirm reads token from query params, calls verifyOtp() with type email, shows success, redirects to /login after 1.5s.

**Minimum-scope check:**
- Files changed: none - all implementation was already present in the worktree from the previous agent session.
- Smallest useful change?: N/A - no changes needed.
- Anything to revert before review?: none.

**Review proof packet:**
- Changed files / diff scope: none - existing worktree implementation verified.
- Verification commands passed: pnpm build passed.
- Working hypothesis at handoff: Auth source inspection and build verification support review.
- Known gaps / follow-up: none.

**Out-of-scope changes introduced:** none.

**Uncertainties:** none - build passes, all criteria verified against source.`,
            },
          },
          'update-plain-ac',
        ),
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
          maxTurns: 6,
          toolMetadata: {},
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

  it('blocks review handoff after source inspection and verification when the self-critique is missing', async () => {
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
        message: assistantToolUse(
          'read-file',
          { filePath: '/workspace/project/packages/converter/src/index.ts' },
          'read-1',
        ),
      },
      { message: assistantToolUse('shell', { command: 'pnpm test' }, 'shell-1') },
      { message: assistantToolUse('update-task', { taskId: 'task-1', status: 'review' }, 'update-1') },
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
          maxTurns: 6,
          toolMetadata: {},
        },
        [{ role: 'user', content: [{ type: 'text', text: 'go' }] }],
      ),
    )
    const updateCompleted = events
      .filter((e) => e.type === 'tool_execution_completed')
      .at(-1)
    expect(called).toBe(true)
    expect(updateCompleted?.type === 'tool_execution_completed' ? updateCompleted.is_error : false).toBe(true)
    expect(updateCompleted?.type === 'tool_execution_completed' ? updateCompleted.output : '').toContain('structured self-critique')
  })

  it('blocks review handoff when the self-critique omits the review proof packet', async () => {
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
          return { output: 'updated', is_error: false }
        },
      }),
    )
    const client = new ScriptedApiClient([
      { message: assistantToolUse('update-task', { taskId: 'task-1', status: 'in_progress' }, 'start-proof') },
      {
        message: assistantToolUse(
          'read-file',
          { filePath: '/workspace/project/packages/converter/src/index.ts' },
          'read-proof',
        ),
      },
      { message: assistantToolUse('shell', { command: 'pnpm test' }, 'shell-proof') },
      {
        message: assistantToolUse(
          'update-task',
          {
            taskId: 'task-1',
            status: 'review',
            note: {
              agentId: 'worker-agent',
              role: 'self-critique',
              content: `**Self-critique:**
For each acceptance criterion:
- [ac-1]: Met — The implementation file was inspected and updated appropriately.

Minimum-scope check:
- Files changed: /workspace/project/packages/converter/src/index.ts
- Smallest useful change?: yes — no extra files changed.
- Anything to revert before review?: none

Out-of-scope changes introduced: none
Uncertainties: none`,
            },
          },
          'update-proof',
        ),
      },
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
          maxTurns: 6,
          toolMetadata: {},
        },
        [{ role: 'user', content: [{ type: 'text', text: 'go' }] }],
      ),
    )
    const completed = events.find((e) =>
      e.type === 'tool_execution_completed' &&
      e.output.includes('review proof packet'),
    )
    expect(reviewCalls).toBe(0)
    expect(completed?.type === 'tool_execution_completed' ? completed.is_error : false).toBe(true)
    expect(completed?.type === 'tool_execution_completed' ? completed.output : '').toContain('review proof packet')
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
      {
        message: assistantToolUse(
          'update-task',
          {
            taskId: 'task-1',
            status: 'review',
            note: {
              agentId: 'worker-agent',
              role: 'self-critique',
              content: `**Self-critique:**
For each acceptance criterion:
- [ac-1]: Met — The implementation change is verified.

Minimum-scope check:
- Files changed: /workspace/project/packages/converter/src/index.ts
- Smallest useful change?: yes — only the intended file was touched.
- Anything to revert before review?: none

Review proof packet:
- Changed files / diff scope: /workspace/project/packages/converter/src/index.ts
- Verification commands passed: pnpm test passed
- Working hypothesis at handoff: The implementation change is verified for task-1.
- Known gaps / follow-up: none

Out-of-scope changes introduced: none
Uncertainties: none`,
            },
          },
          'review-1',
        ),
      },
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
              content: `**Self-critique:**
AC-1 (Converter behavior): Met — The file change is complete.

**Minimal-scope check:**
- Files changed: /workspace/project/packages/converter/src/index.ts
- Smallest useful change?: yes — the diff stays local to the intended file.
- Anything to revert before review?: none

**Review proof packet:**
- Changed files / diff scope: /workspace/project/packages/converter/src/index.ts
- Verification commands passed: pnpm test passed
- Working hypothesis at handoff: The converter change is complete and verified.
- Known gaps / follow-up: none

Out-of-scope changes introduced: none
Uncertainties: none`,
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

  it('allows review handoff from checkpoint-scoped implementation evidence after a self-critique note is persisted', async () => {
    const registry = new ToolRegistry()
    let reviewCalls = 0
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
          'update-task',
          {
            taskId: 'task-1',
            status: 'in_progress',
            note: {
              agentId: 'worker-agent',
              role: 'self-critique',
              content: `**Self-critique:**\n\nAC-1 (Registration): Met — /register works.\n\nMinimum-scope check:\nFiles changed: frontend/app/pages/register.vue\nSmallest useful change?: yes — checkpoint already captures the touched auth files.\n\nReview proof packet:\n- Changed files / diff scope: frontend/app/pages/register.vue\n- Verification commands passed: pnpm build passed\n- Working hypothesis at handoff: The checkpointed auth file is verified and ready for review.\n- Known gaps / follow-up: none\n\nOut-of-scope changes introduced: none.\nUncertainties: none.`,
            },
          },
          'critique-checkpoint',
        ),
      },
      { message: assistantToolUse('update-task', { taskId: 'task-1', status: 'review' }, 'review-checkpoint') },
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
          maxTurns: 6,
          toolMetadata: {
            current_task_id: 'task-1',
            current_agent_id: 'worker-agent',
            current_task_checkpoint_files_touched: [
              'frontend/app/composables/useSupabase.ts',
              'frontend/app/pages/register.vue',
            ],
          },
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
              content: `**Self-critique:**
For each acceptance criterion:
- [ac-1]: Met — The implementation change is verified and ready for review.

Minimum-scope check:
- Files changed: /workspace/project/packages/converter/src/index.ts
- Smallest useful change?: yes — the change remains narrowly scoped.
- Anything to revert before review?: none

Review proof packet:
- Changed files / diff scope: /workspace/project/packages/converter/src/index.ts
- Verification commands passed: pnpm test passed
- Working hypothesis at handoff: The implementation change is verified and ready for review.
- Known gaps / follow-up: none

Out-of-scope changes introduced: none
Uncertainties: none`,
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

  it('allows review handoff for a resumed task when authoritative verification only exists in durable checkpoint history', async () => {
    const registry = new ToolRegistry()
    let reviewCalls = 0
    registry.register(
      defineTool({
        name: 'update-task',
        description: '',
        inputSchema: z.object({
          tasksPath: z.string().optional(),
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
          maxTurns: 4,
          toolMetadata: {
            current_task_id: 'task-1',
            current_task_has_review_proof_packet: true,
            review_handoff_evidence: {
              taskId: 'task-1',
              inspectedImplementationFile: false,
              changedOrVerified: false,
            },
            current_task_checkpoint_files_touched: [
              'frontend/app/pages/register.vue',
              'frontend/app/pages/register/success.vue',
            ],
            current_task_verification_commands: [
              'pnpm build',
              'tsc --noEmit --project frontend/tsconfig.json',
            ],
            current_task_verification_history: [
              {
                command: 'pnpm build',
                passed: true,
                observedAt: '2026-05-13T19:41:01.000Z',
              },
              {
                command: 'tsc --noEmit --project frontend/tsconfig.json',
                passed: true,
                observedAt: '2026-05-13T19:41:12.000Z',
              },
            ],
          },
        },
        [{ role: 'user', content: [{ type: 'text', text: 'go' }] }],
      ),
    )

    const completed = events.filter((e) => e.type === 'tool_execution_completed')
    expect(reviewCalls).toBe(1)
    expect(completed.at(-1)?.type === 'tool_execution_completed' ? completed.at(-1)?.is_error : true).toBe(false)
    expect(completed.at(-1)?.type === 'tool_execution_completed' ? completed.at(-1)?.output : '').toBe('updated')
  })

  it('stops cleanly after a worker hands a task off to review', async () => {
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
        execute: async () => ({ output: 'lint passed', is_error: false }),
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
      { message: assistantToolUse('shell', { command: 'pnpm lint' }, 'shell-1') },
      {
        message: assistantToolUse(
          'update-task',
          {
            taskId: 'task-1',
            status: 'in_progress',
            note: {
              agentId: 'worker-agent',
              role: 'worker',
              content: `**Self-critique:**
- ac-1: Met — The file change is complete.
- Minimum-scope check:
  - Files changed: /workspace/project/packages/converter/src/index.ts
  - Smallest useful change?: yes
  - Anything to revert before review?: none

Review proof packet:
- Changed files / diff scope: /workspace/project/packages/converter/src/index.ts
- Verification commands passed: pnpm lint passed
- Working hypothesis at handoff: The file change is complete and lint passed.
- Known gaps / follow-up: none`,
            },
          },
          'critique-1',
        ),
      },
      { message: assistantToolUse('update-task', { taskId: 'task-1', status: 'review' }, 'review-1') },
      { message: assistantText('Task completed and handed off to review.') },
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
          toolMetadata: {
            current_agent_id: 'worker-agent',
            current_task_id: 'task-1',
            current_task_likely_target_files: ['/workspace/project/packages/converter/src/index.ts'],
          },
        },
        [{ role: 'user', content: [{ type: 'text', text: 'go' }] }],
      ),
    )

    expect(reviewCalls).toBe(1)
    expect(events.some((e) =>
      e.type === 'status' &&
      e.message.includes('demanding one mutation-or-escalation tool call next'),
    )).toBe(false)
    expect(events.at(-1)?.type).toBe('assistant_turn_complete')
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

  it('hydrates and normalizes log-decision tool input', async () => {
    const registry = new ToolRegistry()
    let observedDecisionsPath = ''
    let observedEntry: Record<string, unknown> | null = null
    registry.register(
      defineTool({
        name: 'log-decision',
        description: '',
        inputSchema: z.object({
          decisionsPath: z.string(),
          entry: z.object({
            id: z.string(),
            timestamp: z.string(),
            agentId: z.string(),
            domain: z.string(),
            taskId: z.string().optional(),
            title: z.string(),
            context: z.string(),
            decision: z.string(),
            consequences: z.string(),
            overridesSoftGate: z.string().optional(),
          }),
        }),
        execute: async (input) => {
          observedDecisionsPath = input.decisionsPath
          observedEntry = input.entry as unknown as Record<string, unknown>
          return { output: 'logged', is_error: false }
        },
      }),
    )
    const client = new ScriptedApiClient([
      {
        message: assistantToolUse('log-decision', {
          entry: JSON.stringify({
            decision: 'Approve mobile real-device testing task as-is',
            consequences: 'Worker can continue with testing and fixes.',
          }),
        }),
      },
      { message: assistantText('ok') },
    ])

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
          toolMetadata: {
            current_agent_id: 'coordinator-knit',
            current_task_id: 'task-123',
            current_task_title: 'Mobile: test on real device (Safari iOS, Chrome Android)',
            current_task_domain: 'knit',
          },
        },
        [{ role: 'user', content: [{ type: 'text', text: 'go' }] }],
      ),
    )

    expect(observedDecisionsPath).toBe('/workspace/project/memory/DECISIONS.md')
    expect(observedEntry).not.toBeNull()
    expect(observedEntry?.['decision']).toBe('Approve mobile real-device testing task as-is')
    expect(observedEntry?.['consequences']).toBe('Worker can continue with testing and fixes.')
    expect(observedEntry?.['agentId']).toBe('coordinator-knit')
    expect(observedEntry?.['taskId']).toBe('task-123')
    expect(observedEntry?.['domain']).toBe('knit')
    expect(observedEntry?.['title']).toBe('Coordinator decision for Mobile: test on real device (Safari iOS, Chrome Android)')
    expect(observedEntry?.['context']).toContain('Task: Mobile: test on real device (Safari iOS, Chrome Android)')
    expect(typeof observedEntry?.['timestamp']).toBe('string')
    expect(typeof observedEntry?.['id']).toBe('string')
  })

  it('hydrates and normalizes log-progress tool input', async () => {
    const registry = new ToolRegistry()
    let observedProgressPath = ''
    let observedEntry: Record<string, unknown> | null = null
    registry.register(
      defineTool({
        name: 'log-progress',
        description: '',
        inputSchema: z.object({
          progressPath: z.string(),
          entry: z.object({
            timestamp: z.string(),
            agentId: z.string(),
            domain: z.string(),
            taskId: z.string().optional(),
            summary: z.string(),
            type: z.enum(['heartbeat', 'milestone', 'blocked', 'escalation']),
          }),
        }),
        execute: async (input) => {
          observedProgressPath = input.progressPath
          observedEntry = input.entry as unknown as Record<string, unknown>
          return { output: 'logged', is_error: false }
        },
      }),
    )
    const client = new ScriptedApiClient([
      {
        message: assistantToolUse('log-progress', {
          entry: JSON.stringify({
            summary: 'Coordinator clarified the next Looma decision.',
            type: 'milestone',
          }),
        }),
      },
      { message: assistantText('ok') },
    ])

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
          toolMetadata: {
            current_agent_id: 'coordinator-knit',
            current_task_id: 'task-456',
            current_task_domain: 'knit',
          },
        },
        [{ role: 'user', content: [{ type: 'text', text: 'go' }] }],
      ),
    )

    expect(observedProgressPath).toBe('/workspace/project/memory/PROGRESS.md')
    expect(observedEntry).toMatchObject({
      agentId: 'coordinator-knit',
      taskId: 'task-456',
      domain: 'knit',
      summary: 'Coordinator clarified the next Looma decision.',
      type: 'milestone',
    })
    expect(typeof observedEntry?.['timestamp']).toBe('string')
  })

  it('hydrates and normalizes raise-escalation tool input', async () => {
    const registry = new ToolRegistry()
    let observedInput: Record<string, unknown> | null = null
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
          details: z.string().optional(),
        }),
        execute: async (input) => {
          observedInput = input as unknown as Record<string, unknown>
          return { output: 'raised', is_error: false }
        },
      }),
    )
    const client = new ScriptedApiClient([
      {
        message: assistantToolUse('raise-escalation', {
          reason: 'decision_required',
          summary: 'Need a clear product call before continuing.',
          details: {
            options: ['ship only bugs', 'fix bugs and polish'],
            source: 'live Looma run',
          },
        }),
      },
      { message: assistantText('ok') },
    ])

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
          toolMetadata: {
            current_agent_id: 'coordinator-knit',
            current_task_id: 'task-789',
          },
        },
        [{ role: 'user', content: [{ type: 'text', text: 'go' }] }],
      ),
    )

    expect(observedInput).toMatchObject({
      tasksPath: '/workspace/project/memory/TASKS.json',
      progressPath: '/workspace/project/memory/PROGRESS.md',
      taskId: 'task-789',
      agentId: 'coordinator-knit',
      reason: 'decision_required',
      summary: 'Need a clear product call before continuing.',
    })
    expect(observedInput?.['details']).toContain('"source": "live Looma run"')
  })

  it('allows review handoff for verification-only tasks after durable verification evidence and self-critique', async () => {
    const registry = new ToolRegistry()
    let updateCalls = 0
    registry.register(
      defineTool({
        name: 'update-task',
        description: 'persists task state',
        inputSchema: z.object({
          tasksPath: z.string().optional(),
          taskId: z.string(),
          status: z.string(),
        }),
        execute: async () => {
          updateCalls += 1
          return { output: 'task updated', is_error: false, metadata: { taskId: 'task-mobile' } }
        },
      }),
    )
    const client = new ScriptedApiClient([
      {
        message: assistantToolUse('update-task', {
          taskId: 'task-mobile',
          status: 'review',
        }),
      },
      { message: assistantText('done') },
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
          maxTurns: 4,
          toolMetadata: {
            current_task_id: 'task-mobile',
            current_task_title: 'Mobile: test on real device (Safari iOS, Chrome Android)',
            current_task_spec_excerpt: 'Manual testing only. Visual/functional correctness only.',
            current_task_has_review_proof_packet: true,
            review_handoff_evidence: {
              taskId: 'task-mobile',
              inspectedImplementationFile: false,
              changedOrVerified: true,
            },
          },
        },
        [{ role: 'user', content: [{ type: 'text', text: 'go' }] }],
      ),
    )

    expect(updateCalls).toBe(1)
    expect(events.some((e) =>
      e.type === 'tool_execution_completed' &&
      e.output === 'task updated',
    )).toBe(true)
  })

  it('allows review handoff only after the authoritative verification command set succeeds', async () => {
    const registry = new ToolRegistry()
    let updateCalls = 0
    registry.register(
      defineTool({
        name: 'read-file',
        description: '',
        inputSchema: z.object({ filePath: z.string() }),
        isReadOnly: () => true,
        execute: async () => ({ output: 'template contents', is_error: false }),
      }),
    )
    registry.register(
      defineTool({
        name: 'shell',
        description: '',
        inputSchema: z.object({ command: z.string() }),
        isReadOnly: () => true,
        execute: async (input) => ({
          output: `${input.command} ok`,
          is_error: false,
          metadata: {
            success: true,
            exitCode: 0,
            executedCommand: input.command,
            usedAuthoritativeCommand: true,
          },
        }),
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
          updateCalls += 1
          return { output: 'updated', is_error: false }
        },
      }),
    )
    const client = new ScriptedApiClient([
      {
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'read-1',
              name: 'read-file',
              input: { filePath: '/workspace/project/knit/web/app/components/organisms/VersionHistoryDialog.vue' },
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
              input: { command: 'pnpm --filter @knit-app typecheck' },
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
              id: 'shell-2',
              name: 'shell',
              input: { command: 'pnpm --filter @knit-app build' },
            },
          ],
        },
      },
      {
        message: assistantToolUse(
          'update-task',
          {
            taskId: 'task-verify',
            status: 'review',
            note: {
              agentId: 'worker-agent',
              role: 'self-critique',
              content: `**Self-critique:**
For each acceptance criterion:
- [ac-1]: Met — Added the missing diff action.
- [ac-7]: Met — Typecheck passes.
- [ac-8]: Met — Build succeeds.

Minimum-scope check:
- Files changed: /workspace/project/knit/web/app/components/organisms/VersionHistoryDialog.vue
- Smallest useful change?: yes
- Anything to revert before review?: none

Review proof packet:
- Changed files / diff scope: /workspace/project/knit/web/app/components/organisms/VersionHistoryDialog.vue
- Verification commands passed: pnpm --filter @knit-app typecheck passed; pnpm --filter @knit-app build passed
- Working hypothesis at handoff: The diff action work is complete and both authoritative commands passed.
- Known gaps / follow-up: none

Out-of-scope changes introduced: none
Uncertainties: none`,
            },
          },
          'update-verify',
        ),
      },
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
          toolMetadata: {
            current_task_id: 'task-verify',
            current_task_verification_commands: [
              'pnpm --filter @knit-app typecheck',
              'pnpm --filter @knit-app build',
            ],
          },
        },
        [{ role: 'user', content: [{ type: 'text', text: 'go' }] }],
      ),
    )

    expect(updateCalls).toBe(1)
    expect(events.some((e) =>
      e.type === 'tool_execution_completed' &&
      e.output === 'updated',
    )).toBe(true)
  })

  it('treats an authority-mapped shell command as the canonical verification command for resumed handoff', async () => {
    const registry = new ToolRegistry()
    let updateCalls = 0
    registry.register(
      defineTool({
        name: 'shell',
        description: '',
        inputSchema: z.object({ command: z.string() }),
        isReadOnly: () => true,
        execute: async (input) => ({
          output: `${input.command} ok`,
          is_error: false,
          metadata: {
            success: true,
            exitCode: 0,
            executedCommand: 'tsc --noEmit --project frontend/tsconfig.json',
            usedAuthoritativeCommand: true,
          },
        }),
      }),
    )
    registry.register(
      defineTool({
        name: 'update-task',
        description: '',
        inputSchema: z.object({
          tasksPath: z.string().optional(),
          taskId: z.string(),
          status: z.string(),
          note: z.object({
            agentId: z.string(),
            role: z.string(),
            content: z.string(),
          }).optional(),
        }),
        execute: async (input) => {
          if (input.status === 'review') updateCalls += 1
          return { output: 'updated', is_error: false, metadata: { taskId: input.taskId } }
        },
      }),
    )

    const client = new ScriptedApiClient([
      { message: assistantToolUse('shell', { command: 'tsc --noEmit' }, 'shell-1') },
      {
        message: assistantToolUse(
          'update-task',
          {
            taskId: 'task-verify-alias',
            status: 'review',
            note: {
              agentId: 'worker-agent',
              role: 'self-critique',
              content: `**Self-critique:**
For each acceptance criterion:
- [ac-1]: Met — Verification passed.

Minimum-scope check:
- Files changed: /workspace/project/frontend/app/pages/register.vue
- Smallest useful change?: yes
- Anything to revert before review?: none

Review proof packet:
- Changed files / diff scope: /workspace/project/frontend/app/pages/register.vue
- Verification commands passed: tsc --noEmit --project frontend/tsconfig.json passed
- Working hypothesis at handoff: The authority-mapped verification command passed for the changed register page.
- Known gaps / follow-up: none`,
            },
          },
          'review-1',
        ),
      },
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
          maxTurns: 6,
          toolMetadata: {
            current_task_id: 'task-verify-alias',
            current_task_has_review_proof_packet: true,
            review_handoff_evidence: {
              taskId: 'task-verify-alias',
              inspectedImplementationFile: false,
              changedOrVerified: false,
            },
            current_task_checkpoint_files_touched: [
              'frontend/app/pages/register.vue',
            ],
            current_task_verification_commands: [
              'tsc --noEmit --project frontend/tsconfig.json',
            ],
          },
        },
        [{ role: 'user', content: [{ type: 'text', text: 'go' }] }],
      ),
    )

    expect(updateCalls).toBe(1)
    expect(events.some((e) =>
      e.type === 'tool_execution_completed' &&
      e.output === 'updated',
    )).toBe(true)
  })

  it('blocks review handoff when changed task files introduce a missing local import path', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'guildhall-missing-import-'))
    try {
      const taskRoot = join(tempRoot, 'knit')
      const sourceFile = join(taskRoot, 'web', 'app', 'components', 'organisms', 'VersionHistoryDialog.vue')
      mkdirSync(join(taskRoot, 'web', 'app', 'components', 'organisms'), { recursive: true })
      writeFileSync(
        sourceFile,
        [
          "<script setup lang=\"ts\">",
          "import LoomaButton from '@/components/atoms/LoomaButton.vue'",
          '</script>',
          '',
        ].join('\n'),
      )

      const registry = new ToolRegistry()
      let updateCalls = 0
      registry.register(
        defineTool({
          name: 'read-file',
          description: '',
          inputSchema: z.object({ filePath: z.string() }),
          isReadOnly: () => true,
          execute: async () => ({ output: 'source read', is_error: false }),
        }),
      )
      registry.register(
        defineTool({
          name: 'shell',
          description: '',
          inputSchema: z.object({ command: z.string() }),
          isReadOnly: () => true,
          execute: async (input) => ({
            output: `${input.command} ok`,
            is_error: false,
            metadata: {
              success: true,
              exitCode: 0,
              executedCommand: input.command,
              usedAuthoritativeCommand: true,
            },
          }),
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
            updateCalls += 1
            return { output: 'updated', is_error: false }
          },
        }),
      )
      const client = new ScriptedApiClient([
        {
          message: {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 'read-1',
                name: 'read-file',
                input: { filePath: sourceFile },
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
                input: { command: 'pnpm --filter @knit-app typecheck' },
              },
            ],
          },
        },
        {
          message: assistantToolUse(
            'update-task',
            {
              taskId: 'task-import-189j8he',
              status: 'review',
              note: {
                agentId: 'worker-agent',
                role: 'self-critique',
                content: `**Self-critique:**
For each acceptance criterion:
- [ac-1]: Met — Added the version diff controls.
- [ac-7]: Met — Typecheck passes.

Minimum-scope check:
- Files changed: ${sourceFile}
- Smallest useful change?: yes
- Anything to revert before review?: none

Out-of-scope changes introduced: none
Uncertainties: none`,
              },
            },
            'update-missing-import',
          ),
        },
        { message: assistantText('ok') },
      ])

      const events = await drain(
        runQuery(
          {
            apiClient: client,
            toolRegistry: registry,
            permissionChecker: autoChecker(),
            cwd: tempRoot,
            model: 'test',
            systemPrompt: '',
            maxTokens: 256,
            maxTurns: 8,
            toolMetadata: {
              current_task_id: 'task-import-189j8he',
              current_task_worktree_path: taskRoot,
              current_task_project_path: taskRoot,
              current_task_checkpoint_files_touched: [
                'web/app/components/organisms/VersionHistoryDialog.vue',
              ],
              current_task_verification_commands: [
                'pnpm --filter @knit-app typecheck',
              ],
            },
          },
          [{ role: 'user', content: [{ type: 'text', text: 'go' }] }],
        ),
      )

      const blocked = events.find((e) =>
        e.type === 'tool_execution_completed' &&
        e.output.includes('Missing import: "@/components/atoms/LoomaButton.vue"'),
      )
      expect(updateCalls).toBe(0)
      expect(blocked?.type === 'tool_execution_completed' ? blocked.is_error : false).toBe(true)
      expect(blocked?.type === 'tool_execution_completed' ? blocked.output : '').toContain('VersionHistoryDialog.vue')
      expect(blocked?.type === 'tool_execution_completed' ? blocked.output : '').toContain('LoomaButton.vue')
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
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

    expect(messages.some(message =>
      message.role === 'user' &&
      message.content.some(block =>
        block.type === 'text' &&
        block.text.includes('Do not repeat that exact tool call again.'),
      ),
    )).toBe(true)
  })

  it('immediately corrects an empty write-file call with a path-specific retry instruction', async () => {
    const registry = new ToolRegistry()
    registry.register(
      defineTool({
        name: 'write-file',
        description: '',
        inputSchema: z.object({
          filePath: z.string().optional(),
          content: z.string().optional(),
        }),
        execute: async () => ({
          output:
            'Error writing file: Missing filePath. If you are creating the new test file, call write-file with { filePath: "/workspace/project/tests/unit/composables/use-presence.test.ts", content: "..." }.',
          is_error: true,
        }),
      }),
    )
    const client = new ScriptedApiClient([
      { message: assistantToolUse('write-file', {}, 'toolu_1') },
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
          cwd: '/workspace/project',
          model: 'test',
          systemPrompt: '',
          maxTokens: 256,
          maxTurns: 4,
        },
        messages,
      ),
    )

    expect(messages.some(message =>
      message.role === 'user' &&
      message.content.some(block =>
        block.type === 'text' &&
        block.text.includes('Your very next response must be exactly one write-file tool call') &&
        block.text.includes('/workspace/project/tests/unit/composables/use-presence.test.ts'),
      ),
    )).toBe(true)
  })

  it('refuses more read-only exploration after the exact likely target file is confirmed missing', async () => {
    const registry = new ToolRegistry()
    registry.register(
      defineTool({
        name: 'read-file',
        description: '',
        inputSchema: z.object({ filePath: z.string() }),
        isReadOnly: () => true,
        execute: async (input) => ({
          output: `(file not found: ${input.filePath})`,
          is_error: true,
        }),
      }),
    )
    registry.register(
      defineTool({
        name: 'list-files',
        description: '',
        inputSchema: z.object({ dirPath: z.string() }),
        isReadOnly: () => true,
        execute: async () => ({
          output: 'composables/\ncomponents/\n',
          is_error: false,
        }),
      }),
    )
    const targetPath = '/workspace/project/web/tests/unit/composables/use-presence.test.ts'
    const client = new ScriptedApiClient([
      { message: assistantToolUse('read-file', { filePath: targetPath }, 'toolu_1') },
      { message: assistantToolUse('list-files', { dirPath: '/workspace/project/web/tests/unit' }, 'toolu_2') },
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
          cwd: '/workspace/project',
          model: 'test',
          systemPrompt: '',
          maxTokens: 256,
          maxTurns: 4,
          toolMetadata: {
            current_task_likely_target_files: [targetPath],
          },
        },
        messages,
      ),
    )

    expect(events.some(e =>
      e.type === 'status' &&
      e.message.includes('confirmed the exact likely target file is missing'),
    )).toBe(true)
    expect(messages.some(message =>
      message.role === 'user' &&
      message.content.some(block =>
        block.type === 'tool_result' &&
        block.is_error === true &&
        String(block.content).includes(`The likely target file does not exist yet at ${targetPath}`),
      ),
    )).toBe(true)
  })

  it('refuses read-only worker exploration when a checkpoint already names the next step', async () => {
    const registry = new ToolRegistry()
    registry.register(
      defineTool({
        name: 'grep',
        description: '',
        inputSchema: z.object({ pattern: z.string(), root: z.string() }),
        isReadOnly: () => true,
        execute: async () => ({
          output: '(no matches)',
          is_error: false,
        }),
      }),
    )
    registry.register(
      defineTool({
        name: 'read-file',
        description: '',
        inputSchema: z.object({ filePath: z.string() }),
        isReadOnly: () => true,
        execute: async () => ({
          output: 'export type Database = {}',
          is_error: false,
        }),
      }),
    )
    const client = new ScriptedApiClient([
      { message: assistantToolUse('grep', { pattern: 'type Workspace =', root: '/workspace/project' }, 'toolu_1') },
      { message: assistantToolUse('read-file', { filePath: '/workspace/project/web/app/types/supabase.ts' }, 'toolu_2') },
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
          cwd: '/workspace/project',
          model: 'test',
          systemPrompt: '',
          maxTokens: 256,
          maxTurns: 4,
          noProgressToolNames: ['shell', 'write-checkpoint'],
          noProgressTurnNudge: 'Make concrete implementation progress now.',
          noProgressTurnThreshold: 2,
          noProgressTurnNudgeLimit: 1,
          toolMetadata: {
            current_agent_id: 'worker-agent',
            current_task_checkpoint_next_action: 'Verify typecheck passes with the generated types',
            current_task_checkpoint_files_touched: [
              '/workspace/project/web/app/types/supabase.ts',
              '/workspace/project/web/app/composables/use-workspace.ts',
            ],
          },
        },
        messages,
      ),
    )

    expect(events.some(e =>
      e.type === 'status' &&
      e.message.includes('mutation checkpoint'),
    )).toBe(true)
    expect(messages.some(message =>
      message.role === 'user' &&
      message.content.some(block =>
        block.type === 'text' &&
        block.text.includes('The latest checkpoint already told you what to do next: Verify typecheck passes with the generated types.'),
      ),
    )).toBe(true)
  })

  it('uses worker-specific no-progress status messaging after repeated non-durable tool turns', async () => {
    const registry = new ToolRegistry()
    registry.register(
      defineTool({
        name: 'grep',
        description: '',
        inputSchema: z.object({ pattern: z.string(), root: z.string() }),
        isReadOnly: () => true,
        execute: async () => ({
          output: '(no matches)',
          is_error: false,
        }),
      }),
    )
    const client = new ScriptedApiClient([
      { message: assistantToolUse('grep', { pattern: 'foo', root: '/workspace/project' }, 'toolu_1') },
      { message: assistantToolUse('grep', { pattern: 'bar', root: '/workspace/project' }, 'toolu_2') },
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
          cwd: '/workspace/project',
          model: 'test',
          systemPrompt: '',
          maxTokens: 256,
          maxTurns: 4,
          noProgressToolNames: ['shell', 'write-checkpoint'],
          noProgressTurnNudge: 'Make concrete implementation progress now.',
          noProgressTurnThreshold: 2,
          noProgressTurnNudgeLimit: 1,
          toolMetadata: {
            current_agent_id: 'worker-agent',
          },
        },
        messages,
      ),
    )

    expect(events.some(e =>
      e.type === 'status' &&
      e.message === 'Assistant kept using non-durable steps without moving the implementation forward; asking it to mutate, verify, checkpoint, or escalate now.',
    )).toBe(true)
  })

  it('uses a strict handoff nudge instead of the generic no-progress nudge for worker review checkpoints', async () => {
    const registry = new ToolRegistry()
    registry.register(
      defineTool({
        name: 'todo-write',
        description: '',
        inputSchema: z.object({ content: z.string() }),
        isReadOnly: () => false,
        execute: async ({ content }) => ({
          output: `wrote ${String(content)}`,
          is_error: false,
        }),
      }),
    )
    const client = new ScriptedApiClient([
      { message: assistantToolUse('todo-write', { content: 'step 1' }, 'toolu_1') },
      { message: assistantToolUse('todo-write', { content: 'step 2' }, 'toolu_2') },
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
          cwd: '/workspace/project',
          model: 'test',
          systemPrompt: '',
          maxTokens: 256,
          maxTurns: 4,
          noProgressToolNames: ['shell', 'write-checkpoint', 'update-task'],
          noProgressTurnNudge: 'Make concrete implementation progress now.',
          noProgressTurnThreshold: 2,
          noProgressTurnNudgeLimit: 1,
          toolMetadata: {
            current_agent_id: 'worker-agent',
            current_task_id: 'task-012',
            current_task_checkpoint_next_action: "Set task status to 'review'",
          },
        },
        messages,
      ),
    )

    expect(messages.some(message =>
      message.role === 'user' &&
      message.content.some(block =>
        block.type === 'text' &&
        block.text.includes('Call update-task with { taskId: "task-012", status: "review", note: { agentId: "worker-agent", role: "self-critique", content: "**Self-critique:** ..." } } now.'),
      ),
    )).toBe(true)
  })

  it('allows checkpoint-scoped read-file follow-through when the checkpoint next action is exploratory', async () => {
    const registry = new ToolRegistry()
    registry.register(
      defineTool({
        name: 'read-file',
        description: '',
        inputSchema: z.object({ filePath: z.string() }),
        isReadOnly: () => true,
        execute: async ({ filePath }) => ({
          output: `contents of ${String(filePath)}`,
          is_error: false,
        }),
      }),
    )
    const touchedA = '/workspace/project/web/app/types/supabase.ts'
    const touchedB = '/workspace/project/web/app/composables/use-workspace.ts'
    const client = new ScriptedApiClient([
      { message: assistantToolUse('read-file', { filePath: touchedA }, 'toolu_1') },
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
          cwd: '/workspace/project',
          model: 'test',
          systemPrompt: '',
          maxTokens: 256,
          maxTurns: 3,
          noProgressToolNames: ['shell', 'write-checkpoint'],
          noProgressTurnNudge: 'Make concrete implementation progress now.',
          noProgressTurnThreshold: 2,
          noProgressTurnNudgeLimit: 1,
          toolMetadata: {
            current_agent_id: 'worker-agent',
            current_task_checkpoint_next_action: 'Search for ad-hoc DB-facing shapes to replace with generated types',
            current_task_checkpoint_files_touched: [
              'web/app/types/supabase.ts',
              'web/app/composables/use-workspace.ts',
            ],
          },
        },
        messages,
      ),
    )

    expect(events.some((e) =>
      e.type === 'tool_execution_completed' &&
      e.tool_name === 'read-file' &&
      String(e.output).includes(touchedA),
    )).toBe(true)
    expect(events.some((e) =>
      e.type === 'status' &&
      e.message.includes('checkpointed next action'),
    )).toBe(false)
  })

  it('allows checkpoint-scoped read-file follow-through when the file is read from the task project root', async () => {
    const registry = new ToolRegistry()
    registry.register(
      defineTool({
        name: 'read-file',
        description: '',
        inputSchema: z.object({ filePath: z.string() }),
        isReadOnly: () => true,
        execute: async ({ filePath }) => ({
          output: `contents of ${String(filePath)}`,
          is_error: false,
        }),
      }),
    )
    const projectRoot = '/workspace/project/knit'
    const worktreeRoot = '/workspace/project/knit/.guildhall/worktrees/task-012'
    const touchedRelative = 'web/app/types/supabase.ts'
    const client = new ScriptedApiClient([
      { message: assistantToolUse('read-file', { filePath: `${projectRoot}/${touchedRelative}` }, 'toolu_1') },
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
          cwd: '/workspace/project',
          model: 'test',
          systemPrompt: '',
          maxTokens: 256,
          maxTurns: 3,
          noProgressToolNames: ['shell', 'write-checkpoint'],
          noProgressTurnNudge: 'Make concrete implementation progress now.',
          noProgressTurnThreshold: 2,
          noProgressTurnNudgeLimit: 1,
          toolMetadata: {
            current_agent_id: 'worker-agent',
            current_task_project_path: projectRoot,
            current_task_worktree_path: worktreeRoot,
            current_task_checkpoint_next_action: 'Search for ad-hoc DB-facing shapes to replace with generated types',
            current_task_checkpoint_files_touched: [touchedRelative],
          },
        },
        messages,
      ),
    )

    expect(events.some((e) =>
      e.type === 'tool_execution_completed' &&
      e.tool_name === 'read-file' &&
      String(e.output).includes(`${projectRoot}/${touchedRelative}`),
    )).toBe(true)
    expect(events.some((e) =>
      e.type === 'status' &&
      e.message.includes('checkpointed next action'),
    )).toBe(false)
  })

  it('adds a strict exact-file nudge after broad checkpoint drift on an exploratory worker checkpoint', async () => {
    const registry = new ToolRegistry()
    registry.register(
      defineTool({
        name: 'grep',
        description: '',
        inputSchema: z.object({ pattern: z.string(), root: z.string() }),
        isReadOnly: () => true,
        execute: async () => ({
          output: '(no matches)',
          is_error: false,
        }),
      }),
    )
    const client = new ScriptedApiClient([
      { message: assistantToolUse('grep', { pattern: 'Row', root: '/workspace/project/knit' }, 'toolu_1') },
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
          cwd: '/workspace/project',
          model: 'test',
          systemPrompt: '',
          maxTokens: 256,
          maxTurns: 3,
          noProgressToolNames: ['shell', 'write-checkpoint'],
          noProgressTurnNudge: 'Make concrete implementation progress now.',
          noProgressTurnThreshold: 2,
          noProgressTurnNudgeLimit: 1,
          toolMetadata: {
            current_agent_id: 'worker-agent',
            current_task_project_path: '/workspace/project/knit',
            current_task_checkpoint_next_action: 'Search for ad-hoc DB-facing shapes to replace with generated types',
            current_task_checkpoint_files_touched: ['web/app/types/supabase.ts'],
          },
        },
        messages,
      ),
    )

    expect(events.some((e) =>
      e.type === 'status' &&
      e.message.includes('demanding one exact checkpoint-file read or escalation next'),
    )).toBe(true)
    expect(messages.some((message) =>
      message.role === 'user' &&
      message.content.some((block) =>
        block.type === 'text' &&
        block.text.includes('Your very next response must be exactly one tool call and no prose.') &&
        block.text.includes('read-file with { filePath: "web/app/types/supabase.ts" }'),
      ),
    )).toBe(true)
  })

  it('does not apply the generic intake-budget refusal to checkpoint-scoped worker reads after a durable-progress nudge', async () => {
    const registry = new ToolRegistry()
    registry.register(
      defineTool({
        name: 'read-file',
        description: '',
        inputSchema: z.object({ filePath: z.string() }),
        isReadOnly: () => true,
        execute: async ({ filePath }) => ({
          output: `contents of ${String(filePath)}`,
          is_error: false,
        }),
      }),
    )
    const touchedA = '/workspace/project/web/app/types/supabase.ts'
    const touchedB = '/workspace/project/web/app/composables/use-workspace.ts'
    const client = new ScriptedApiClient([
      { message: assistantToolUse('read-file', { filePath: touchedA }, 'toolu_1') },
      { message: assistantToolUse('read-file', { filePath: touchedB }, 'toolu_2') },
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
          cwd: '/workspace/project',
          model: 'test',
          systemPrompt: '',
          maxTokens: 256,
          maxTurns: 4,
          noProgressToolNames: ['shell', 'write-checkpoint'],
          noProgressTurnNudge: 'Make concrete implementation progress now.',
          noProgressTurnThreshold: 1,
          noProgressTurnNudgeLimit: 1,
          toolMetadata: {
            current_agent_id: 'worker-agent',
            current_task_checkpoint_next_action: 'Search for ad-hoc DB-facing shapes to replace with generated types',
            current_task_checkpoint_files_touched: [
              'web/app/types/supabase.ts',
              'web/app/composables/use-workspace.ts',
            ],
          },
        },
        messages,
      ),
    )

    expect(events.filter((e) =>
      e.type === 'tool_execution_completed' &&
      e.tool_name === 'read-file',
    )).toHaveLength(2)
    expect(messages.some((message) =>
      message.role === 'user' &&
      message.content.some((block) =>
        block.type === 'tool_result' &&
        String(block.content).includes('Research budget exhausted for this intake turn'),
      ),
    )).toBe(false)
  })

  it('demands an update-task self-critique tool call after handoff-checkpoint read drift', async () => {
    const registry = new ToolRegistry()
    registry.register(
      defineTool({
        name: 'read-file',
        description: '',
        inputSchema: z.object({ filePath: z.string() }),
        isReadOnly: () => true,
        execute: async ({ filePath }) => ({
          output: `contents of ${String(filePath)}`,
          is_error: false,
        }),
      }),
    )
    registry.register(
      defineTool({
        name: 'update-task',
        description: '',
        inputSchema: z.object({
          taskId: z.string(),
          status: z.string(),
          note: z.object({
            agentId: z.string(),
            role: z.string(),
            content: z.string(),
          }).optional(),
        }),
        execute: async () => ({
          output: 'updated',
          is_error: false,
        }),
      }),
    )
    const client = new ScriptedApiClient([
      {
        message: assistantToolUse(
          'read-file',
          { filePath: '/workspace/project/web/app/composables/use-workspace.ts' },
          'toolu_1',
        ),
      },
      {
        message: assistantToolUse(
          'update-task',
          {
            taskId: 'task-012',
            status: 'in_progress',
            note: {
              agentId: 'worker-agent',
              role: 'self-critique',
              content: '**Self-critique:** all acceptance criteria still hold.',
            },
          },
          'toolu_2',
        ),
      },
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
          cwd: '/workspace/project',
          model: 'test',
          systemPrompt: '',
          maxTokens: 256,
          maxTurns: 4,
          noProgressToolNames: ['shell', 'write-checkpoint'],
          noProgressTurnNudge: 'Make concrete implementation progress now.',
          noProgressTurnThreshold: 1,
          noProgressTurnNudgeLimit: 1,
          toolMetadata: {
            current_agent_id: 'worker-agent',
            current_task_id: 'task-012',
            current_task_checkpoint_next_action: 'Write self-critique addressing all acceptance criteria and out-of-scope types',
            current_task_checkpoint_files_touched: ['web/app/composables/use-workspace.ts'],
          },
        },
        messages,
      ),
    )

    expect(events.some((e) =>
      e.type === 'status' &&
      e.message.includes('demanding one self-critique persistence tool call or escalation next'),
    )).toBe(true)
    expect(messages.some((message) =>
      message.role === 'user' &&
      message.content.some((block) =>
        block.type === 'text' &&
        block.text.includes('Call update-task with { taskId: "task-012"') &&
        block.text.includes('role: "self-critique"'),
      ),
    )).toBe(true)
    expect(events.some((e) =>
      e.type === 'tool_execution_completed' &&
      e.tool_name === 'update-task' &&
      String(e.output).includes('updated'),
    )).toBe(true)
  })

  it('treats recovery checkpoints that say to refresh self-critique and hand off to review as handoff checkpoints, not exploratory ones', async () => {
    const registry = new ToolRegistry()
    registry.register(
      defineTool({
        name: 'read-file',
        description: '',
        inputSchema: z.object({ filePath: z.string() }),
        isReadOnly: () => true,
        execute: async ({ filePath }) => ({
          output: `contents of ${String(filePath)}`,
          is_error: false,
        }),
      }),
    )
    registry.register(
      defineTool({
        name: 'update-task',
        description: '',
        inputSchema: z.object({
          taskId: z.string(),
          status: z.string(),
          note: z.object({
            agentId: z.string(),
            role: z.string(),
            content: z.string(),
          }).optional(),
        }),
        execute: async () => ({
          output: 'updated',
          is_error: false,
        }),
      }),
    )
    const client = new ScriptedApiClient([
      {
        message: assistantToolUse(
          'read-file',
          { filePath: '/workspace/project/packages/converter/src/commentInserter.ts' },
          'toolu_1',
        ),
      },
      {
        message: assistantToolUse(
          'update-task',
          {
            taskId: 'task-012',
            status: 'in_progress',
            note: {
              agentId: 'worker-agent',
              role: 'self-critique',
              content: '**Self-critique:** all acceptance criteria still hold.',
            },
          },
          'toolu_2',
        ),
      },
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
          cwd: '/workspace/project',
          model: 'test',
          systemPrompt: '',
          maxTokens: 256,
          maxTurns: 4,
          noProgressToolNames: ['shell', 'write-checkpoint'],
          noProgressTurnNudge: 'Make concrete implementation progress now.',
          noProgressTurnThreshold: 1,
          noProgressTurnNudgeLimit: 1,
          toolMetadata: {
            current_agent_id: 'worker-agent',
            current_task_id: 'task-012',
            current_task_checkpoint_next_action: 'Resume from the recorded verification evidence, write or refresh the self-critique note, then hand off to review.',
            current_task_checkpoint_files_touched: [
              'packages/converter/src/features/functionDeclaration.ts',
              'packages/converter/src/features/variableDeclaration.ts',
            ],
          },
        },
        messages,
      ),
    )

    expect(events.some((e) =>
      e.type === 'status' &&
      e.message.includes('demanding one self-critique persistence tool call or escalation next'),
    )).toBe(true)
    expect(messages.some((message) =>
      message.role === 'user' &&
      message.content.some((block) =>
        block.type === 'text' &&
        block.text.includes('Call update-task with { taskId: "task-012"'),
      ),
    )).toBe(true)
    expect(messages.some((message) =>
      message.role === 'user' &&
      message.content.some((block) =>
        block.type === 'text' &&
        block.text.includes('If you must read first, only use read-file on the checkpoint-touched files'),
      ),
    )).toBe(false)
  })

  it('treats implementation-focused recovery checkpoints as mutation checkpoints even if they mention self-critique later', async () => {
    const registry = new ToolRegistry()
    registry.register(
      defineTool({
        name: 'read-file',
        description: '',
        inputSchema: z.object({ filePath: z.string() }),
        isReadOnly: () => true,
        execute: async ({ filePath }) => ({
          output: `contents of ${String(filePath)}`,
          is_error: false,
        }),
      }),
    )
    const client = new ScriptedApiClient([
      {
        message: assistantToolUse(
          'read-file',
          { filePath: '/workspace/project/packages/converter/src/jsdocHelpers.ts' },
          'toolu_mutation_cp',
        ),
      },
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
          cwd: '/workspace/project',
          model: 'test',
          systemPrompt: '',
          maxTokens: 256,
          maxTurns: 3,
          noProgressToolNames: ['shell', 'write-checkpoint'],
          noProgressTurnNudge: 'Make concrete implementation progress now.',
          noProgressTurnThreshold: 1,
          noProgressTurnNudgeLimit: 1,
          toolMetadata: {
            current_agent_id: 'worker-agent',
            current_task_id: 'task-012',
            current_task_checkpoint_next_action:
              'Resume from the recorded verification evidence, rerun the focused verification commands, and fix whatever still fails in the checkpoint-touched files before you write the structured self-critique.',
            current_task_checkpoint_files_touched: [
              'packages/converter/src/jsdocHelpers.ts',
              'packages/converter/src/typescriptToJsdoc.ts',
            ],
            current_task_verification_commands: [
              'cd packages/converter && pnpm vitest --run test/ts-to-jsdoc.test.ts',
              'cd packages/converter && pnpm vitest --run test/jsdoc-to-ts.test.ts',
            ],
          },
        },
        messages,
      ),
    )

    expect(events.some((e) =>
      e.type === 'status' &&
      e.message.includes('mutation checkpoint'),
    )).toBe(true)
    expect(events.some((e) =>
      e.type === 'status' &&
      e.message.includes('self-critique persistence tool call'),
    )).toBe(false)
    expect(messages.some((message) =>
      message.role === 'user' &&
      message.content.some((block) =>
        block.type === 'text' &&
        block.text.includes('call shell with exactly one of these authoritative commands') &&
        block.text.includes('cd packages/converter && pnpm vitest --run test/ts-to-jsdoc.test.ts'),
      ),
    )).toBe(true)
    expect(messages.some((message) =>
      message.role === 'user' &&
      message.content.some((block) =>
        block.type === 'text' &&
        !block.text.includes('Call update-task with { taskId: "task-012"'),
      ),
    )).toBe(true)
  })

  it('allows one checkpoint-scoped reread after a failed authoritative verification rerun', async () => {
    const registry = new ToolRegistry()
    registry.register(
      defineTool({
        name: 'read-file',
        description: '',
        inputSchema: z.object({ filePath: z.string() }),
        isReadOnly: () => true,
        execute: async ({ filePath }) => ({
          output: `contents of ${String(filePath)}`,
          is_error: false,
        }),
      }),
    )
    registry.register(
      defineTool({
        name: 'shell',
        description: '',
        inputSchema: z.object({ command: z.string() }),
        isReadOnly: () => true,
        execute: async () => ({
          output: 'failing focused verification output',
          is_error: true,
        }),
      }),
    )
    const projectRoot = '/workspace/project'
    const touchedRelative = 'packages/converter/src/commentInserter.ts'
    const client = new ScriptedApiClient([
      {
        message: assistantToolUse(
          'shell',
          { command: 'cd packages/converter && pnpm vitest --run test/ts-to-jsdoc.test.ts' },
          'toolu_shell',
        ),
      },
      {
        message: assistantToolUse(
          'read-file',
          { filePath: `${projectRoot}/${touchedRelative}` },
          'toolu_read',
        ),
      },
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
          cwd: projectRoot,
          model: 'test',
          systemPrompt: '',
          maxTokens: 256,
          maxTurns: 5,
          noProgressToolNames: ['shell', 'write-checkpoint'],
          noProgressTurnNudge: 'Make concrete implementation progress now.',
          noProgressTurnThreshold: 1,
          noProgressTurnNudgeLimit: 1,
          toolMetadata: {
            current_agent_id: 'worker-agent',
            current_task_id: 'task-012',
            current_task_project_path: projectRoot,
            current_task_checkpoint_next_action:
              'Resume from the active worktree diff, refresh focused verification, and keep the task in implementation until the focused checks are green.',
            current_task_checkpoint_files_touched: [
              touchedRelative,
              'packages/converter/src/features/variableDeclaration.ts',
            ],
            current_task_checkpoint_safe_mutation_surface: [
              touchedRelative,
              'packages/converter/src/features/variableDeclaration.ts',
            ],
            current_task_verification_commands: [
              'cd packages/converter && pnpm vitest --run test/ts-to-jsdoc.test.ts',
              'cd packages/converter && pnpm vitest --run test/jsdoc-to-ts.test.ts',
            ],
          },
        },
        messages,
      ),
    )

    expect(events.some((e) =>
      e.type === 'tool_execution_completed' &&
      e.tool_name === 'read-file' &&
      String(e.output).includes(`${projectRoot}/${touchedRelative}`) &&
      e.is_error === false,
    )).toBe(true)
    expect(events.some((e) =>
      e.type === 'status' &&
      e.message.includes('demanding one exact file mutation or escalation next'),
    )).toBe(false)
  })

  it('refuses a multi-file reread batch immediately after a failed authoritative verification rerun', async () => {
    const registry = new ToolRegistry()
    registry.register(
      defineTool({
        name: 'read-file',
        description: '',
        inputSchema: z.object({ filePath: z.string() }),
        isReadOnly: () => true,
        execute: async ({ filePath }) => ({
          output: `contents of ${String(filePath)}`,
          is_error: false,
        }),
      }),
    )
    registry.register(
      defineTool({
        name: 'shell',
        description: '',
        inputSchema: z.object({ command: z.string() }),
        isReadOnly: () => true,
        execute: async () => ({
          output: 'failing focused verification output',
          is_error: true,
        }),
      }),
    )
    const projectRoot = '/workspace/project'
    const sourcePath = `${projectRoot}/packages/converter/src/commentInserter.ts`
    const supportPath = `${projectRoot}/packages/converter/src/jsdocHelpers.ts`
    const client = new ScriptedApiClient([
      {
        message: assistantToolUse(
          'shell',
          { command: 'cd packages/converter && pnpm vitest --run test/ts-to-jsdoc.test.ts' },
          'toolu_shell',
        ),
      },
      {
        message: {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'toolu_read_1', name: 'read-file', input: { filePath: sourcePath } },
            { type: 'tool_use', id: 'toolu_read_2', name: 'read-file', input: { filePath: supportPath } },
          ],
        },
      },
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
          cwd: projectRoot,
          model: 'test',
          systemPrompt: '',
          maxTokens: 256,
          maxTurns: 5,
          noProgressToolNames: ['shell', 'write-checkpoint'],
          noProgressTurnNudge: 'Make concrete implementation progress now.',
          noProgressTurnThreshold: 1,
          noProgressTurnNudgeLimit: 1,
          toolMetadata: {
            current_agent_id: 'worker-agent',
            current_task_id: 'task-012',
            current_task_checkpoint_next_action:
              'Resume from the recorded verification evidence, rerun the focused verification commands, and fix whatever still fails in the checkpoint-touched files before you write the structured self-critique.',
            current_task_checkpoint_files_touched: [
              'packages/converter/src/commentInserter.ts',
              'packages/converter/src/jsdocHelpers.ts',
              'packages/converter/test/ts-to-jsdoc.test.ts',
            ],
            current_task_verification_commands: [
              'cd packages/converter && pnpm vitest --run test/ts-to-jsdoc.test.ts',
            ],
          },
        },
        messages,
      ),
    )

    expect(events.some((event) =>
      event.type === 'status' &&
      event.message.includes('mutation checkpoint'),
    )).toBe(true)
    expect(messages.some((message) =>
      message.role === 'user' &&
      message.content.some((block) =>
        block.type === 'tool_result' &&
        block.is_error === true &&
        typeof block.content === 'string' &&
        block.content.includes('Your very next response must be exactly one tool call and no prose.'),
      ),
    )).toBe(true)
    expect(messages.some((message) =>
      message.role === 'user' &&
      message.content.some((block) =>
        block.type === 'tool_result' &&
        typeof block.content === 'string' &&
        block.content.includes(`contents of ${sourcePath}`),
      ),
    )).toBe(false)
  })

  it('prefers the latest failed authoritative verification command in mutation-checkpoint nudges', async () => {
    const registry = new ToolRegistry()
    registry.register(
      defineTool({
        name: 'read-file',
        description: '',
        inputSchema: z.object({ filePath: z.string() }),
        isReadOnly: () => true,
        execute: async ({ filePath }) => ({
          output: `contents of ${String(filePath)}`,
          is_error: false,
        }),
      }),
    )
    const projectRoot = '/workspace/project'
    const client = new ScriptedApiClient([
      {
        message: assistantToolUse(
          'read-file',
          { filePath: `${projectRoot}/packages/converter/src/commentInserter.ts` },
          'toolu_read',
        ),
      },
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
          cwd: projectRoot,
          model: 'test',
          systemPrompt: '',
          maxTokens: 256,
          maxTurns: 4,
          noProgressToolNames: ['shell', 'write-checkpoint'],
          noProgressTurnNudge: 'Make concrete implementation progress now.',
          noProgressTurnThreshold: 1,
          noProgressTurnNudgeLimit: 1,
          toolMetadata: {
            current_agent_id: 'worker-agent',
            current_task_id: 'task-012',
            current_task_checkpoint_next_action:
              'Resume from the recorded verification evidence, rerun the focused verification commands, and fix whatever still fails in the checkpoint-touched files before you write the structured self-critique.',
            current_task_checkpoint_files_touched: [
              'packages/converter/src/commentInserter.ts',
            ],
            current_task_checkpoint_safe_mutation_surface: [
              'packages/converter/src/commentInserter.ts',
            ],
            current_task_verification_commands: [
              'pnpm run build',
              'cd packages/converter && pnpm vitest --run test/ts-to-jsdoc.test.ts',
              'pnpm run lint',
            ],
            current_task_verification_history: [
              {
                command: 'pnpm run build',
                passed: true,
                observedAt: '2026-05-14T14:00:00.000Z',
              },
              {
                command: 'cd packages/converter && pnpm vitest --run test/ts-to-jsdoc.test.ts',
                passed: false,
                observedAt: '2026-05-14T14:01:00.000Z',
              },
            ],
          },
        },
        messages,
      ),
    )

    expect(messages.some((message) =>
      message.role === 'user' &&
      message.content.some((block) =>
        block.type === 'text' &&
        block.text.includes('call shell with the last failing authoritative command first') &&
        block.text.includes('cd packages/converter && pnpm vitest --run test/ts-to-jsdoc.test.ts'),
      ),
    )).toBe(true)
  })

  it('demands an exact file mutation tool call after mutation-checkpoint read drift', async () => {
    const registry = new ToolRegistry()
    registry.register(
      defineTool({
        name: 'read-file',
        description: '',
        inputSchema: z.object({ filePath: z.string() }),
        isReadOnly: () => true,
        execute: async ({ filePath }) => ({
          output: `contents of ${String(filePath)}`,
          is_error: false,
        }),
      }),
    )
    registry.register(
      defineTool({
        name: 'edit-file',
        description: '',
        inputSchema: z.object({
          filePath: z.string(),
          oldString: z.string(),
          newString: z.string(),
        }),
        execute: async () => ({
          output: 'edited',
          is_error: false,
        }),
      }),
    )
    const client = new ScriptedApiClient([
      {
        message: assistantToolUse(
          'read-file',
          { filePath: '/workspace/project/web/app/composables/use-workspace.ts' },
          'toolu_1',
        ),
      },
      {
        message: assistantToolUse(
          'edit-file',
          {
            filePath: '/workspace/project/web/app/composables/use-workspace.ts',
            oldString: 'export interface WorkspaceMember {',
            newString: 'export type WorkspaceRole = "admin" | "editor" | "viewer" | null',
          },
          'toolu_2',
        ),
      },
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
          cwd: '/workspace/project',
          model: 'test',
          systemPrompt: '',
          maxTokens: 256,
          maxTurns: 4,
          noProgressToolNames: ['shell', 'write-checkpoint'],
          noProgressTurnNudge: 'Make concrete implementation progress now.',
          noProgressTurnThreshold: 1,
          noProgressTurnNudgeLimit: 1,
          toolMetadata: {
            current_agent_id: 'worker-agent',
            current_task_checkpoint_next_action: 'Remove unused types and finalize',
            current_task_checkpoint_files_touched: ['web/app/composables/use-workspace.ts'],
          },
        },
        messages,
      ),
    )

    expect(events.some((e) =>
      e.type === 'status' &&
      e.message.includes('demanding one exact file mutation or escalation next'),
    )).toBe(true)
    expect(messages.some((message) =>
      message.role === 'user' &&
      message.content.some((block) =>
        block.type === 'text' &&
        block.text.includes('Call edit-file on web/app/composables/use-workspace.ts now') &&
        block.text.includes('or call write-file if rewriting the full file is simpler'),
      ),
    )).toBe(true)
    expect(events.some((e) =>
      e.type === 'tool_execution_completed' &&
      e.tool_name === 'edit-file' &&
      String(e.output).includes('edited'),
    )).toBe(true)
  })

  it('uses the strict checkpoint mutation nudge when a worker diagnoses the bug but emits no tool call', async () => {
    const client = new ScriptedApiClient([
      {
        message: assistantText(
          'The failing test points at commentInserter.ts. Let me patch the insertion logic.',
        ),
      },
      { message: assistantText('done') },
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
          cwd: '/workspace/project',
          model: 'test',
          systemPrompt: '',
          maxTokens: 256,
          maxTurns: 4,
          noToolTurnNudge: 'Take the next concrete step now.',
          noToolTurnNudgeLimit: 1,
          toolMetadata: {
            current_agent_id: 'worker-agent',
            current_task_id: 'task-012',
            current_task_checkpoint_next_action:
              'Resume from the recorded verification evidence, rerun the focused verification commands, and fix whatever still fails in the checkpoint-touched files before you write the structured self-critique.',
            current_task_checkpoint_files_touched: [
              'packages/converter/src/commentInserter.ts',
              'packages/converter/src/features/variableDeclaration.ts',
            ],
            current_task_checkpoint_safe_mutation_surface: [
              'packages/converter/src/commentInserter.ts',
              'packages/converter/src/features/variableDeclaration.ts',
            ],
            current_task_verification_commands: [
              'cd packages/converter && pnpm vitest --run test/ts-to-jsdoc.test.ts',
              'cd packages/converter && pnpm vitest --run test/jsdoc-to-ts.test.ts',
            ],
          },
        },
        messages,
      ),
    )

    expect(events.some((e) =>
      e.type === 'status' &&
      e.message.includes('checkpoint-directed tool call'),
    )).toBe(true)
    expect(messages.some((message) =>
      message.role === 'user' &&
      message.content.some((block) =>
        block.type === 'text' &&
        block.text.includes('If you are rerunning verification first, call shell with exactly one of these authoritative commands') &&
        block.text.includes('packages/converter/src/commentInserter.ts'),
      ),
    )).toBe(true)
  })

  it('stops a checkpoint lane explicitly after repeated no-tool responses', async () => {
    const client = new ScriptedApiClient([
      {
        message: assistantText(
          'The failing test points at commentInserter.ts. Let me patch the insertion logic.',
        ),
      },
      {
        message: assistantText(
          'I still need to patch the insertion logic before rerunning verification.',
        ),
      },
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
          cwd: '/workspace/project',
          model: 'test',
          systemPrompt: '',
          maxTokens: 256,
          maxTurns: 4,
          noToolTurnNudge: 'Take the next concrete step now.',
          noToolTurnNudgeLimit: 1,
          toolMetadata: {
            current_agent_id: 'worker-agent',
            current_task_id: 'task-012',
            current_task_checkpoint_next_action:
              'Resume from the recorded verification evidence, rerun the focused verification commands, and fix whatever still fails in the checkpoint-touched files before you write the structured self-critique.',
            current_task_checkpoint_files_touched: [
              'packages/converter/src/commentInserter.ts',
              'packages/converter/src/features/variableDeclaration.ts',
            ],
            current_task_checkpoint_safe_mutation_surface: [
              'packages/converter/src/commentInserter.ts',
              'packages/converter/src/features/variableDeclaration.ts',
            ],
            current_task_verification_commands: [
              'cd packages/converter && pnpm vitest --run test/ts-to-jsdoc.test.ts',
            ],
          },
        },
        messages,
      ),
    )

    expect(client.requests).toHaveLength(2)
    expect(events.some((e) =>
      e.type === 'status' &&
      e.message.includes('checkpoint-directed tool call'),
    )).toBe(true)
    expect(events.some((e) =>
      e.type === 'status' &&
      e.message.includes('ending this turn so the coordinator can treat it as no progress'),
    )).toBe(true)
  })

  it('prefers the checkpoint safe mutation surface over raw touched-file order when nudging the next mutation', async () => {
    const registry = new ToolRegistry()
    registry.register(
      defineTool({
        name: 'read-file',
        description: '',
        inputSchema: z.object({ filePath: z.string() }),
        isReadOnly: () => true,
        execute: async ({ filePath }) => ({
          output: `contents of ${String(filePath)}`,
          is_error: false,
        }),
      }),
    )
    registry.register(
      defineTool({
        name: 'edit-file',
        description: '',
        inputSchema: z.object({
          filePath: z.string(),
          oldString: z.string(),
          newString: z.string(),
        }),
        execute: async () => ({
          output: 'edited',
          is_error: false,
        }),
      }),
    )
    const client = new ScriptedApiClient([
      {
        message: assistantToolUse(
          'read-file',
          { filePath: '/workspace/project/packages/converter/test/ts-to-jsdoc.test.ts' },
          'toolu_1',
        ),
      },
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
          cwd: '/workspace/project',
          model: 'test',
          systemPrompt: '',
          maxTokens: 256,
          maxTurns: 3,
          noProgressToolNames: ['shell', 'write-checkpoint'],
          noProgressTurnNudge: 'Make concrete implementation progress now.',
          noProgressTurnThreshold: 1,
          noProgressTurnNudgeLimit: 1,
          toolMetadata: {
            current_agent_id: 'worker-agent',
            current_task_checkpoint_next_action:
              'Resume from the recorded verification evidence, rerun the focused verification commands, and fix whatever still fails in the checkpoint-touched files before you write the structured self-critique.',
            current_task_checkpoint_files_touched: [
              '.gitignore',
              'package.json',
              'packages/converter/package.json',
              'packages/converter/src/commentInserter.ts',
              'packages/converter/src/features/functionDeclaration.ts',
              'packages/converter/test/ts-to-jsdoc.test.ts',
            ],
            current_task_checkpoint_safe_mutation_surface: [
              'packages/converter/test/ts-to-jsdoc.test.ts',
              'packages/converter/src/commentInserter.ts',
              'packages/converter/src/features/functionDeclaration.ts',
            ],
          },
        },
        messages,
      ),
    )

    expect(events.some((e) =>
      e.type === 'status' &&
      e.message.includes('mutation checkpoint'),
    )).toBe(true)
    expect(messages.some((message) =>
      message.content.some((block) =>
        (
          (block.type === 'text' && block.text.includes('Call edit-file on packages/converter/test/ts-to-jsdoc.test.ts now')) ||
          (block.type === 'tool_result' && typeof block.content === 'string' && block.content.includes('Call edit-file on packages/converter/test/ts-to-jsdoc.test.ts now'))
        ) &&
        !(
          (block.type === 'text' && block.text.includes('Call edit-file on .gitignore now')) ||
          (block.type === 'tool_result' && typeof block.content === 'string' && block.content.includes('Call edit-file on .gitignore now'))
        ),
      ),
    )).toBe(true)
  })

  it('allows one checkpoint-scoped read after an authoritative verification command fails in the same turn', async () => {
    const registry = new ToolRegistry()
    registry.register(
      defineTool({
        name: 'shell',
        description: '',
        inputSchema: z.object({ command: z.string(), timeoutMs: z.number().optional() }),
        isReadOnly: () => false,
        execute: async ({ command }) => ({
          output: `FAIL ${String(command)}`,
          is_error: true,
        }),
      }),
    )
    registry.register(
      defineTool({
        name: 'read-file',
        description: '',
        inputSchema: z.object({ filePath: z.string() }),
        isReadOnly: () => true,
        execute: async ({ filePath }) => ({
          output: `contents of ${String(filePath)}`,
          is_error: false,
        }),
      }),
    )
    const firstClient = new ScriptedApiClient([
      {
        message: assistantToolUse(
          'shell',
          {
            command: 'cd packages/converter && pnpm vitest --run test/ts-to-jsdoc.test.ts',
            timeoutMs: 60_000,
          },
          'toolu_verify',
        ),
      },
      {
        message: assistantToolUse(
          'read-file',
          { filePath: '/workspace/project/packages/converter/src/jsdocHelpers.ts' },
          'toolu_followthrough',
        ),
      },
      { message: assistantText('done') },
    ])
    const messages: ConversationMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'go' }] },
    ]

    await drain(
      runQuery(
        {
          apiClient: firstClient,
          toolRegistry: registry,
          permissionChecker: autoChecker(),
          cwd: '/workspace/project',
          model: 'test',
          systemPrompt: '',
          maxTokens: 256,
          maxTurns: 4,
          noProgressToolNames: ['shell', 'write-checkpoint'],
          noProgressTurnNudge: 'Make concrete implementation progress now.',
          noProgressTurnThreshold: 1,
          noProgressTurnNudgeLimit: 1,
          toolMetadata: {
            current_agent_id: 'worker-agent',
            current_task_id: 'task-012',
            current_task_checkpoint_next_action:
              'Resume from the recorded verification evidence, rerun the focused verification commands, and fix whatever still fails in the checkpoint-touched files before you write the structured self-critique.',
            current_task_checkpoint_files_touched: [
              'packages/converter/src/jsdocHelpers.ts',
              'packages/converter/src/typescriptToJsdoc.ts',
            ],
            current_task_verification_commands: [
              'cd packages/converter && pnpm vitest --run test/ts-to-jsdoc.test.ts',
              'cd packages/converter && pnpm vitest --run test/jsdoc-to-ts.test.ts',
            ],
          },
        },
        messages,
      ),
    )

    expect(messages.some((message) =>
      message.role === 'user' &&
      message.content.some((block) =>
        block.type === 'tool_result' &&
        typeof block.content === 'string' &&
        block.content.includes('contents of /workspace/project/packages/converter/src/jsdocHelpers.ts'),
      ),
    )).toBe(true)
    expect(messages.some((message) =>
      message.role === 'user' &&
      message.content.some((block) =>
        block.type === 'tool_result' &&
        typeof block.content === 'string' &&
        block.content.includes('The latest checkpoint already told you what to do next'),
      ),
    )).toBe(false)
  })

  it('refuses a second checkpoint-scoped read-only follow-through turn after authoritative verification fails', async () => {
    const registry = new ToolRegistry()
    registry.register(
      defineTool({
        name: 'shell',
        description: '',
        inputSchema: z.object({ command: z.string(), timeoutMs: z.number().optional() }),
        isReadOnly: () => false,
        execute: async ({ command }) => ({
          output: `FAIL ${String(command)}`,
          is_error: true,
        }),
      }),
    )
    registry.register(
      defineTool({
        name: 'read-file',
        description: '',
        inputSchema: z.object({ filePath: z.string() }),
        isReadOnly: () => true,
        execute: async ({ filePath }) => ({
          output: `contents of ${String(filePath)}`,
          is_error: false,
        }),
      }),
    )
    const client = new ScriptedApiClient([
      {
        message: assistantToolUse(
          'shell',
          {
            command: 'cd packages/converter && pnpm vitest --run test/ts-to-jsdoc.test.ts',
            timeoutMs: 60_000,
          },
          'toolu_verify_round2',
        ),
      },
      {
        message: assistantToolUse(
          'read-file',
          { filePath: '/workspace/project/packages/converter/src/jsdocHelpers.ts' },
          'toolu_src_round2',
        ),
      },
      {
        message: assistantToolUse(
          'read-file',
          { filePath: '/workspace/project/packages/converter/test/ts-to-jsdoc.test.ts' },
          'toolu_test_round2',
        ),
      },
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
          cwd: '/workspace/project',
          model: 'test',
          systemPrompt: '',
          maxTokens: 256,
          maxTurns: 5,
          noProgressToolNames: ['shell', 'write-checkpoint'],
          noProgressTurnNudge: 'Make concrete implementation progress now.',
          noProgressTurnThreshold: 1,
          noProgressTurnNudgeLimit: 1,
          toolMetadata: {
            current_agent_id: 'worker-agent',
            current_task_id: 'task-012',
            current_task_checkpoint_next_action:
              'Resume from the recorded verification evidence, rerun the focused verification commands, and fix whatever still fails in the checkpoint-touched files before you write the structured self-critique.',
            current_task_checkpoint_files_touched: [
              'packages/converter/src/jsdocHelpers.ts',
              'packages/converter/src/typescriptToJsdoc.ts',
              'packages/converter/test/ts-to-jsdoc.test.ts',
            ],
            current_task_verification_commands: [
              'cd packages/converter && pnpm vitest --run test/ts-to-jsdoc.test.ts',
              'cd packages/converter && pnpm vitest --run test/jsdoc-to-ts.test.ts',
            ],
          },
        },
        messages,
      ),
    )

    expect(messages.some((message) =>
      message.role === 'user' &&
      message.content.some((block) =>
        block.type === 'tool_result' &&
        typeof block.content === 'string' &&
        block.content.includes('contents of /workspace/project/packages/converter/src/jsdocHelpers.ts'),
      ),
    )).toBe(true)
    expect(messages.some((message) =>
      message.role === 'user' &&
      message.content.some((block) =>
        block.type === 'tool_result' &&
        typeof block.content === 'string' &&
        block.content.includes('contents of /workspace/project/packages/converter/test/ts-to-jsdoc.test.ts'),
      ),
    )).toBe(false)
    expect(messages.some((message) =>
      message.role === 'user' &&
      message.content.some((block) =>
        block.type === 'text' &&
        block.text.includes('Your very next response must be exactly one tool call and no prose.'),
      ),
    )).toBe(true)
  })

  it('advances a verification-backed checkpoint after a successful authoritative shell command', async () => {
    const registry = new ToolRegistry()
    registry.register(
      defineTool({
        name: 'shell',
        description: '',
        inputSchema: z.object({ command: z.string(), timeoutMs: z.number().optional() }),
        isReadOnly: () => false,
        execute: async ({ command }) => ({
          output: `PASS ${String(command)}`,
          is_error: false,
        }),
      }),
    )
    registry.register(
      defineTool({
        name: 'read-file',
        description: '',
        inputSchema: z.object({ filePath: z.string() }),
        isReadOnly: () => true,
        execute: async ({ filePath }) => ({
          output: `contents of ${String(filePath)}`,
          is_error: false,
        }),
      }),
    )
    const toolMetadata: Record<string, unknown> = {
      current_agent_id: 'worker-agent',
      current_task_id: 'task-012',
      current_task_checkpoint_next_action:
        'Resume from the recorded verification evidence, rerun the focused verification commands, and fix whatever still fails in the checkpoint-touched files before you write the structured self-critique.',
      current_task_checkpoint_files_touched: [
        'packages/converter/src/jsdocHelpers.ts',
        'packages/converter/test/ts-to-jsdoc.test.ts',
      ],
      current_task_verification_commands: [
        'cd packages/converter && pnpm vitest --run test/ts-to-jsdoc.test.ts',
      ],
    }
    const client = new ScriptedApiClient([
      {
        message: assistantToolUse(
          'shell',
          {
            command: 'cd packages/converter && pnpm vitest --run test/ts-to-jsdoc.test.ts',
            timeoutMs: 60_000,
          },
          'toolu_verify_success',
        ),
      },
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
          cwd: '/workspace/project',
          model: 'test',
          systemPrompt: '',
          maxTokens: 256,
          maxTurns: 5,
          noProgressToolNames: ['shell', 'write-checkpoint'],
          noProgressTurnNudge: 'Make concrete implementation progress now.',
          noProgressTurnThreshold: 1,
          noProgressTurnNudgeLimit: 1,
          toolMetadata,
        },
        messages,
      ),
    )

    expect(toolMetadata['current_task_checkpoint_next_action']).toBe(
      'Inspect the checkpoint-touched files against the verification result, then fix whatever still fails before you write the structured self-critique.',
    )

  })

  it('allows verification-backed likely-target reads on a resumed checkpoint before rerunning shell in the same turn', async () => {
    const registry = new ToolRegistry()
    registry.register(
      defineTool({
        name: 'read-file',
        description: '',
        inputSchema: z.object({ filePath: z.string() }),
        isReadOnly: () => true,
        execute: async ({ filePath }) => ({
          output: `contents of ${String(filePath)}`,
          is_error: false,
        }),
      }),
    )
    const client = new ScriptedApiClient([
      {
        message: assistantToolUse(
          'read-file',
          { filePath: '/workspace/project/packages/converter/src/features/featureRegistry.ts' },
          'toolu_supporting_target',
        ),
      },
      {
        message: assistantToolUse(
          'read-file',
          { filePath: '/workspace/project/packages/converter/src/commentPreserver.ts' },
          'toolu_supporting_target_2',
        ),
      },
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
          cwd: '/workspace/project',
          model: 'test',
          systemPrompt: '',
          maxTokens: 256,
          maxTurns: 4,
          noProgressToolNames: ['shell', 'write-checkpoint'],
          noProgressTurnNudge: 'Make concrete implementation progress now.',
          noProgressTurnThreshold: 1,
          noProgressTurnNudgeLimit: 1,
          toolMetadata: {
            current_agent_id: 'worker-agent',
            current_task_id: 'task-012',
            current_task_checkpoint_next_action:
              'Resume from the recorded verification evidence, rerun the focused verification commands, and fix whatever still fails in the checkpoint-touched files before you write the structured self-critique.',
            current_task_checkpoint_files_touched: [
              'packages/converter/src/jsdocHelpers.ts',
              'packages/converter/src/typescriptToJsdoc.ts',
            ],
            current_task_likely_target_files: [
              'packages/converter/src/typescriptToJsdoc.ts',
              'packages/converter/src/features/functionDeclaration.ts',
              'packages/converter/test/ts-to-jsdoc.test.ts',
            ],
            current_task_verification_commands: [
              'cd packages/converter && pnpm vitest --run test/ts-to-jsdoc.test.ts',
              'cd packages/converter && pnpm vitest --run test/jsdoc-to-ts.test.ts',
            ],
          },
        },
        messages,
      ),
    )

    expect(messages.some((message) =>
      message.role === 'user' &&
      message.content.some((block) =>
        block.type === 'tool_result' &&
        typeof block.content === 'string' &&
        block.content.includes('contents of /workspace/project/packages/converter/src/features/featureRegistry.ts'),
      ),
    )).toBe(true)
    expect(messages.some((message) =>
      message.role === 'user' &&
      message.content.some((block) =>
        block.type === 'tool_result' &&
        typeof block.content === 'string' &&
        block.content.includes('The latest checkpoint already told you what to do next'),
      ),
    )).toBe(false)
  })

  it('refuses more read-only exploration after an authoritative likely target file has already been inspected', async () => {
    const registry = new ToolRegistry()
    registry.register(
      defineTool({
        name: 'list-files',
        description: '',
        inputSchema: z.object({ dirPath: z.string() }),
        isReadOnly: () => true,
        execute: async () => ({
          output: 'composables/\ncomponents/\n',
          is_error: false,
        }),
      }),
    )
    const targetPath = '/workspace/project/web/tests/unit/composables/use-presence.test.ts'
    const client = new ScriptedApiClient([
      { message: assistantToolUse('list-files', { dirPath: '/workspace/project/web/tests/unit' }, 'toolu_0') },
      { message: assistantToolUse('list-files', { dirPath: '/workspace/project/web/tests/unit' }, 'toolu_1') },
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
          cwd: '/workspace/project',
          model: 'test',
          systemPrompt: '',
          maxTokens: 256,
          maxTurns: 4,
          noProgressToolNames: ['update-task'],
          noProgressTurnNudge: 'Stop researching and mutate the file now.',
          noProgressTurnNudgeLimit: 1,
          noProgressTurnThreshold: 1,
          toolMetadata: {
            current_task_likely_target_files: [targetPath],
            read_file_state: [
              {
                path: targetPath,
                span: 'lines 1-120',
                preview: 'import { describe } from vitest',
                timestamp: Date.now() / 1000,
              },
            ],
          },
        },
        messages,
      ),
    )

    expect(events.some(e =>
      e.type === 'status' &&
      e.message.includes('already inspected an authoritative likely target file'),
    )).toBe(true)
    expect(messages.some(message =>
      message.role === 'user' &&
      message.content.some(block =>
        block.type === 'tool_result' &&
        block.is_error === true &&
        String(block.content).includes(`You have already inspected an authoritative likely target file at ${targetPath}`),
      ),
    )).toBe(true)
  })

  it('ends the turn after repeated exact-target read-only refusals in the same worker pass', async () => {
    const registry = new ToolRegistry()
    registry.register(
      defineTool({
        name: 'list-files',
        description: '',
        inputSchema: z.object({ dirPath: z.string() }),
        isReadOnly: () => true,
        execute: async () => ({
          output: 'composables/\ncomponents/\n',
          is_error: false,
        }),
      }),
    )
    const targetPath = '/workspace/project/web/tests/unit/composables/use-presence.test.ts'
    const client = new ScriptedApiClient([
      { message: assistantToolUse('list-files', { dirPath: '/workspace/project/web/tests/unit' }, 'toolu_0') },
      { message: assistantToolUse('list-files', { dirPath: '/workspace/project/web/tests/unit' }, 'toolu_1') },
      { message: assistantToolUse('list-files', { dirPath: '/workspace/project/web/tests/unit' }, 'toolu_2') },
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
          maxTurns: 6,
          noProgressToolNames: ['update-task'],
          noProgressTurnNudge: 'Stop researching and mutate the file now.',
          noProgressTurnNudgeLimit: 1,
          noProgressTurnThreshold: 1,
          toolMetadata: {
            current_task_likely_target_files: [targetPath],
            read_file_state: [
              {
                path: targetPath,
                span: 'lines 1-120',
                preview: 'import { describe } from vitest',
                timestamp: Date.now() / 1000,
              },
            ],
          },
        },
        messages,
      ),
    )

    expect(events.some((e) =>
      e.type === 'status' &&
      e.message.includes('ending the turn so the orchestrator can treat this as no progress'),
    )).toBe(true)
    expect(client.requests).toHaveLength(3)
  })

  it('demands one concrete tool call after an authoritative likely target file has been inspected and allows verification or sibling target edits', async () => {
    const sourcePath = '/workspace/project/web/app/composables/use-presence.ts'
    const targetPath = '/workspace/project/web/tests/unit/composables/use-presence.test.ts'
    const client = new ScriptedApiClient([
      { message: assistantText('I see what is wrong with the test file.') },
      { message: assistantText('Still thinking.') },
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
          cwd: '/workspace/project',
          model: 'test',
          systemPrompt: '',
          maxTokens: 256,
          maxTurns: 3,
          noToolTurnNudge: 'Take a concrete tool step now.',
          noToolTurnNudgeLimit: 3,
          toolMetadata: {
            current_task_likely_target_files: [sourcePath, targetPath],
            read_file_state: [
              {
                path: targetPath,
                preview: 'broken test file',
              },
            ],
          },
        },
        messages,
      ),
    )

    expect(events.some((e) =>
      e.type === 'status' &&
      e.message.includes('demanding one mutation-or-escalation tool call next'),
    )).toBe(true)
    expect(messages.some((message) =>
      message.role === 'user' &&
      message.content.some((block) =>
        block.type === 'text' &&
        block.text.includes(`You already inspected an authoritative likely target file at ${targetPath}`) &&
        block.text.includes(sourcePath) &&
        block.text.includes('run a focused verification command tied to the file you just changed') &&
        block.text.includes('exactly one tool call and no prose'),
      ),
    )).toBe(true)
  })

  it('allows one scoped likely-target read pass after a stale handoff checkpoint before re-tightening', async () => {
    const registry = new ToolRegistry()
    registry.register(
      defineTool({
        name: 'read-file',
        description: 'reads a file',
        inputSchema: z.object({ filePath: z.string() }),
        isReadOnly: () => true,
        execute: async (input) => ({
          output: `read ${input.filePath}`,
          is_error: false,
        }),
      }),
    )
    const likelyTarget = '/workspace/project/packages/converter/src/typescriptToJsdoc.ts'
    const client = new ScriptedApiClient([
      { message: assistantToolUse('read-file', { filePath: likelyTarget }, 'toolu_0') },
      { message: assistantToolUse('read-file', { filePath: likelyTarget }, 'toolu_1') },
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
          cwd: '/workspace/project',
          model: 'test',
          systemPrompt: '',
          maxTokens: 256,
          maxTurns: 5,
          noProgressToolNames: ['update-task', 'write-checkpoint'],
          noProgressTurnThreshold: 1,
          noProgressTurnNudgeLimit: 1,
          toolMetadata: {
            current_agent_id: 'worker-agent',
            current_task_checkpoint_next_action: 'Transition task to review after verifying the implementation state.',
            current_task_likely_target_files: [likelyTarget],
            current_task_checkpoint_files_touched: [
              'packages/converter/test/ts-to-jsdoc.test.ts',
              'packages/converter/test/jsdoc-to-ts.test.ts',
            ],
          },
        },
        messages,
      ),
    )

    expect(events.some((e) =>
      e.type === 'tool_execution_completed' &&
      e.tool_name === 'read-file' &&
      e.is_error === false &&
      String(e.output).includes(likelyTarget),
    )).toBe(true)
  })

  it('can salvage a malformed write-file call via a focused repair turn', async () => {
    const registry = new ToolRegistry()
    let writtenFilePath = ''
    let writtenContent = ''
    registry.register(
      defineTool({
        name: 'write-file',
        description: '',
        inputSchema: z.object({
          filePath: z.string().optional(),
          content: z.string().optional(),
          path: z.string().optional(),
          text: z.string().optional(),
        }),
        execute: async (input) => {
          const filePath = input.filePath ?? input.path
          const content = input.content ?? input.text
          if (!filePath || !content) {
            return {
              output:
                'Error writing file: Missing filePath. If you are creating the new test file, call write-file with { filePath: "/workspace/project/tests/unit/composables/use-presence.test.ts", content: "..." }.',
              is_error: true,
            }
          }
          writtenFilePath = filePath
          writtenContent = content
          return { output: 'file written', is_error: false }
        },
      }),
    )
    const client = new ScriptedApiClient([
      { message: assistantToolUse('write-file', {}, 'toolu_1') },
      {
        message: assistantToolUse(
          'write-file',
          {
            path: '/workspace/project/tests/unit/composables/use-presence.test.ts',
            text: 'export const ok = true\\n',
          },
          'repair_1',
        ),
      },
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
          cwd: '/workspace/project',
          model: 'test',
          systemPrompt: '',
          maxTokens: 256,
          maxTurns: 4,
          toolMetadata: {
            current_task_title: 'Add unit coverage for use-presence lifecycle',
            current_task_spec_excerpt: 'Write a unit test file for usePresence.',
            current_task_project_path: '/workspace/project',
            last_assistant_text: 'Let me write the test file now.',
            last_assistant_reasoning: 'Need to write the new use-presence test file.',
          },
        },
        messages,
      ),
    )

    expect(events.some(e =>
      e.type === 'status' &&
      e.message.includes('attempting one focused write-file repair'),
    )).toBe(true)
    expect(JSON.stringify(client.requests[1])).toContain(
      '/workspace/project/tests/unit/composables/use-presence.test.ts',
    )
    expect(client.requests[1]?.max_tokens).toBe(256)
    expect(writtenFilePath).toBe('/workspace/project/tests/unit/composables/use-presence.test.ts')
    expect(writtenContent).toBe('export const ok = true\\n')
    expect(messages.some(message =>
      message.role === 'user' &&
      message.content.some(block =>
        block.type === 'tool_result' &&
        block.is_error === false &&
        block.content === 'file written',
      ),
    )).toBe(true)
  })

  it('includes exact missing-target and recent-read hints in write-file repair prompts', async () => {
    const registry = new ToolRegistry()
    registry.register(
      defineTool({
        name: 'write-file',
        description: '',
        inputSchema: z.object({
          filePath: z.string().optional(),
          content: z.string().optional(),
          path: z.string().optional(),
          text: z.string().optional(),
        }),
        execute: async (input) => {
          const filePath = input.filePath ?? input.path
          const content = input.content ?? input.text
          if (!filePath || !content) {
            return {
              output: 'Error writing file: Missing filePath. Missing content.',
              is_error: true,
            }
          }
          return { output: 'file written', is_error: false }
        },
      }),
    )
    const targetPath = '/workspace/project/web/tests/unit/composables/use-presence.test.ts'
    const referencePath = '/workspace/project/web/tests/unit/composables/use-workspace.test.ts'
    const client = new ScriptedApiClient([
      { message: assistantToolUse('write-file', {}, 'toolu_1') },
      {
        message: assistantToolUse(
          'write-file',
          {
            path: targetPath,
            text: 'export const ok = true\\n',
          },
          'repair_1',
        ),
      },
      { message: assistantText('done') },
    ])

    await drain(
      runQuery(
        {
          apiClient: client,
          toolRegistry: registry,
          permissionChecker: autoChecker(),
          cwd: '/workspace/project',
          model: 'test',
          systemPrompt: '',
          maxTokens: 512,
          maxTurns: 4,
          toolMetadata: {
            current_task_title: 'Add unit coverage for use-presence lifecycle',
            current_task_spec_excerpt: 'Write a unit test file for usePresence.',
            current_task_project_path: '/workspace/project',
            last_assistant_text: 'Let me rewrite the test file now.',
            last_assistant_reasoning: 'Use the existing composable test as the pattern.',
            current_missing_likely_target_file: targetPath,
            current_task_likely_target_files: [targetPath],
            read_file_state: [
              {
                path: referencePath,
                preview:
                  "import { mockNuxtImport } from '@nuxt/test-utils/runtime' | const mockDb: Record<string, unknown> = {}",
              },
            ],
          },
        },
        [{ role: 'user', content: [{ type: 'text', text: 'go' }] }],
      ),
    )

    const repairRequest = JSON.stringify(client.requests[1])
    expect(repairRequest).toContain(targetPath)
    expect(repairRequest).toContain(referencePath)
    expect(repairRequest).toContain('Recent file context')
  })

  it('can salvage a malformed edit-file call via a focused repair turn', async () => {
    const registry = new ToolRegistry()
    let writtenFilePath = ''
    let writtenContent = ''
    registry.register(
      defineTool({
        name: 'edit-file',
        description: 'edit a file',
        inputSchema: z.object({
          filePath: z.string(),
          oldString: z.string(),
          newString: z.string(),
        }),
        execute: async () => ({ output: 'should not reach raw edit execution', is_error: false }),
      }),
    )
    registry.register(
      defineTool({
        name: 'write-file',
        description: 'write a file',
        inputSchema: z.object({
          filePath: z.string(),
          content: z.string(),
        }),
        execute: async (input) => {
          writtenFilePath = input.filePath
          writtenContent = input.content
          return { output: 'file written', is_error: false }
        },
      }),
    )
    const client = new ScriptedApiClient([
      { message: assistantToolUse('edit-file', {}, 'toolu_1') },
      {
        message: assistantToolUse(
          'write-file',
          {
            filePath: '/workspace/project/web/tests/unit/composables/use-presence.test.ts',
            content: 'export const ok = true\\n',
          },
          'repair_1',
        ),
      },
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
          cwd: '/workspace/project',
          model: 'test',
          systemPrompt: '',
          maxTokens: 256,
          maxTurns: 4,
          toolMetadata: {
            current_task_title: 'Add unit tests for use-presence composable',
            current_task_spec_excerpt: 'Create the missing unit test file and cover presence subscriptions.',
            current_task_project_path: '/workspace/project',
            last_assistant_text: 'Now I have the full picture. Let me write the test file properly using mockNuxtImport.',
            last_assistant_reasoning: 'Need to replace the placeholder test file with a complete mocked unit test.',
          },
        },
        messages,
      ),
    )

    expect(events.some(e =>
      e.type === 'status' &&
      e.message.includes('attempting one focused file-edit repair'),
    )).toBe(true)
    expect(writtenFilePath).toBe('/workspace/project/web/tests/unit/composables/use-presence.test.ts')
    expect(writtenContent).toBe('export const ok = true\\n')
    expect(messages.some(message =>
      message.role === 'user' &&
      message.content.some(block =>
        block.type === 'tool_result' &&
        block.is_error === false &&
        block.content === 'file written',
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
