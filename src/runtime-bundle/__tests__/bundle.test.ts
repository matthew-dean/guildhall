import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  HookEvent,
  PermissionChecker,
  PermissionMode,
  ToolRegistry,
  defaultPermissionSettings,
  type HookExecutor,
  type HookPayload,
} from '@guildhall/engine'
import type { ConversationMessage, StreamEvent } from '@guildhall/protocol'
import { loadSessionSnapshot, saveSessionSnapshot } from '@guildhall/sessions'

import {
  buildRuntime,
  closeRuntime,
  handleLine,
  resumePending,
  startRuntime,
} from '../bundle.js'
import { ScriptedApiClient } from './fake-client.js'

function autoChecker(): PermissionChecker {
  return new PermissionChecker(defaultPermissionSettings(PermissionMode.FULL_AUTO))
}

class RecordingHookExecutor implements HookExecutor {
  readonly events: Array<{ event: HookEvent; payload: HookPayload }> = []
  async execute(event: HookEvent, payload: HookPayload) {
    this.events.push({ event, payload })
    return { blocked: false }
  }
}

let tmpDataDir: string

beforeEach(() => {
  tmpDataDir = mkdtempSync(join(tmpdir(), 'guildhall-rb-'))
  process.env.GUILDHALL_DATA_DIR = tmpDataDir
  process.env.GUILDHALL_CONFIG_DIR = tmpDataDir
})

afterEach(() => {
  rmSync(tmpDataDir, { recursive: true, force: true })
  delete process.env.GUILDHALL_DATA_DIR
  delete process.env.GUILDHALL_CONFIG_DIR
})

describe('buildRuntime', () => {
  it('returns a bundle whose engine is ready to submit', async () => {
    const client = new ScriptedApiClient([
      {
        message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    ])
    const bundle = await buildRuntime({
      apiClient: client,
      cwd: tmpDataDir,
      model: 'test-model',
      systemPrompt: 'sys',
      toolRegistry: new ToolRegistry(),
      permissionChecker: autoChecker(),
    })
    expect(bundle.model).toBe('test-model')
    expect(bundle.systemPrompt).toBe('sys')
    expect(bundle.sessionId).toMatch(/^[0-9a-f]{12}$/)
    expect(bundle.engine.getModel()).toBe('test-model')
    expect(bundle.restored).toBe(false)
  })

  it('generates a stable sessionId honoring an override', async () => {
    const client = new ScriptedApiClient([])
    const bundle = await buildRuntime({
      apiClient: client,
      cwd: tmpDataDir,
      model: 'm',
      systemPrompt: '',
      toolRegistry: new ToolRegistry(),
      permissionChecker: autoChecker(),
      sessionId: 'abc123abc123',
    })
    expect(bundle.sessionId).toBe('abc123abc123')
  })

  it('restores messages from a prior snapshot by sessionId', async () => {
    const prior: ConversationMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'resumed' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'ack' }] },
    ]
    saveSessionSnapshot({
      cwd: tmpDataDir,
      model: 'prior-model',
      systemPrompt: 'prior-sys',
      messages: prior,
      usage: { input_tokens: 0, output_tokens: 0 },
      sessionId: 'deadbeefcafe',
    })
    const bundle = await buildRuntime({
      apiClient: new ScriptedApiClient([]),
      cwd: tmpDataDir,
      model: 'new-model',
      systemPrompt: 'new-sys',
      toolRegistry: new ToolRegistry(),
      permissionChecker: autoChecker(),
      restoreSessionId: 'deadbeefcafe',
    })
    expect(bundle.restored).toBe(true)
    expect(bundle.sessionId).toBe('deadbeefcafe')
    expect(bundle.engine.messages).toHaveLength(2)
    expect(bundle.engine.messages[0]!.role).toBe('user')
  })

  it('accepts restoreMessages directly without touching disk', async () => {
    const messages: ConversationMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
    ]
    const bundle = await buildRuntime({
      apiClient: new ScriptedApiClient([]),
      cwd: tmpDataDir,
      model: 'm',
      systemPrompt: '',
      toolRegistry: new ToolRegistry(),
      permissionChecker: autoChecker(),
      restoreMessages: messages,
    })
    expect(bundle.restored).toBe(true)
    expect(bundle.engine.messages).toHaveLength(1)
  })
})

describe('startRuntime / closeRuntime', () => {
  it('fires SESSION_START and SESSION_END hooks with cwd', async () => {
    const hooks = new RecordingHookExecutor()
    const bundle = await buildRuntime({
      apiClient: new ScriptedApiClient([]),
      cwd: tmpDataDir,
      model: 'm',
      systemPrompt: '',
      toolRegistry: new ToolRegistry(),
      permissionChecker: autoChecker(),
      hookExecutor: hooks,
    })
    await startRuntime(bundle)
    await closeRuntime(bundle)
    expect(hooks.events.map((e) => e.event)).toEqual([
      HookEvent.SESSION_START,
      HookEvent.SESSION_END,
    ])
    expect(hooks.events[0]!.payload.cwd).toBe(bundle.cwd)
  })

  it('tolerates a missing hookExecutor', async () => {
    const bundle = await buildRuntime({
      apiClient: new ScriptedApiClient([]),
      cwd: tmpDataDir,
      model: 'm',
      systemPrompt: '',
      toolRegistry: new ToolRegistry(),
      permissionChecker: autoChecker(),
    })
    await expect(startRuntime(bundle)).resolves.toBeUndefined()
    await expect(closeRuntime(bundle)).resolves.toBeUndefined()
  })
})

describe('handleLine', () => {
  it('streams events and persists a session snapshot', async () => {
    const client = new ScriptedApiClient([
      {
        textDeltas: ['Hel', 'lo'],
        message: { role: 'assistant', content: [{ type: 'text', text: 'Hello' }] },
        usage: { input_tokens: 3, output_tokens: 2 },
      },
    ])
    const bundle = await buildRuntime({
      apiClient: client,
      cwd: tmpDataDir,
      model: 'm',
      systemPrompt: 'sys',
      toolRegistry: new ToolRegistry(),
      permissionChecker: autoChecker(),
    })
    const events: StreamEvent[] = []
    await handleLine(bundle, 'hi', {
      onEvent: async (ev) => {
        events.push(ev)
      },
    })
    expect(events.some((e) => e.type === 'assistant_turn_complete')).toBe(true)
    const snap = loadSessionSnapshot(tmpDataDir)
    expect(snap).not.toBeNull()
    expect(snap!.messages).toHaveLength(2)
    expect(snap!.session_id).toBe(bundle.sessionId)
    expect(snap!.model).toBe('m')
    expect(snap!.system_prompt).toBe('sys')
    expect(bundle.engine.totalUsage).toEqual({ input_tokens: 3, output_tokens: 2 })
  })

  it('persists the snapshot even when onEvent is omitted', async () => {
    const client = new ScriptedApiClient([
      { message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } },
    ])
    const bundle = await buildRuntime({
      apiClient: client,
      cwd: tmpDataDir,
      model: 'm',
      systemPrompt: '',
      toolRegistry: new ToolRegistry(),
      permissionChecker: autoChecker(),
    })
    await handleLine(bundle, 'go')
    const snap = loadSessionSnapshot(tmpDataDir)
    expect(snap!.messages).toHaveLength(2)
  })
})

describe('resumePending', () => {
  it('calls continuePending and persists when tail is pending tool_result', async () => {
    const client = new ScriptedApiClient([
      {
        message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    ])
    const bundle = await buildRuntime({
      apiClient: client,
      cwd: tmpDataDir,
      model: 'm',
      systemPrompt: '',
      toolRegistry: new ToolRegistry(),
      permissionChecker: autoChecker(),
      restoreMessages: [
        { role: 'user', content: [{ type: 'text', text: 'go' }] },
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'toolu_1', name: 't', input: {} }],
        },
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok', is_error: false }],
        },
      ],
    })
    expect(bundle.engine.hasPendingContinuation()).toBe(true)
    const events: StreamEvent[] = []
    const resumed = await resumePending(bundle, {
      onEvent: async (ev) => {
        events.push(ev)
      },
    })
    expect(resumed).toBe(true)
    expect(events.some((e) => e.type === 'assistant_turn_complete')).toBe(true)
    const snap = loadSessionSnapshot(tmpDataDir)
    expect(snap!.messages.at(-1)!.role).toBe('assistant')
    expect(client.requests).toHaveLength(1)
  })

  it('returns false and does not stream when no pending continuation', async () => {
    const client = new ScriptedApiClient([])
    const bundle = await buildRuntime({
      apiClient: client,
      cwd: tmpDataDir,
      model: 'm',
      systemPrompt: '',
      toolRegistry: new ToolRegistry(),
      permissionChecker: autoChecker(),
    })
    const resumed = await resumePending(bundle)
    expect(resumed).toBe(false)
    expect(client.requests).toHaveLength(0)
  })
})

/**
 * AC-11 / FR-20: mid-turn resume after simulated crash.
 *
 * Scenario: a worker executed a tool but crashed before the model saw the
 * tool_result. On restart the orchestrator reloads the session by id from
 * disk and calls resumePending to continue the turn — no user prompt is
 * resent, the engine continues from the pending tool_result tail.
 */
describe('AC-11: mid-turn resume after simulated crash', () => {
  it('rehydrates a session with a pending tool_result from disk and continues the turn', async () => {
    const sessionId = 'aaaabbbbcccc'
    const pendingMessages: ConversationMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'do the thing' }] },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'toolu_42', name: 'shell', input: { cmd: 'ls' } }],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'toolu_42', content: 'file1\nfile2', is_error: false },
        ],
      },
    ]

    // Pre-crash: persist the mid-turn state.
    saveSessionSnapshot({
      cwd: tmpDataDir,
      model: 'resume-model',
      systemPrompt: 'resume-sys',
      messages: pendingMessages,
      usage: { input_tokens: 5, output_tokens: 3 },
      sessionId,
    })

    // Post-crash: a fresh runtime reloads the snapshot by sessionId and
    // resumePending sends exactly one request (the continuation), not a new
    // user turn.
    const client = new ScriptedApiClient([
      {
        message: { role: 'assistant', content: [{ type: 'text', text: 'saw your files' }] },
        usage: { input_tokens: 2, output_tokens: 4 },
      },
    ])
    const bundle = await buildRuntime({
      apiClient: client,
      cwd: tmpDataDir,
      model: 'resume-model',
      systemPrompt: 'resume-sys',
      toolRegistry: new ToolRegistry(),
      permissionChecker: autoChecker(),
      restoreSessionId: sessionId,
    })
    expect(bundle.restored).toBe(true)
    expect(bundle.sessionId).toBe(sessionId)
    expect(bundle.engine.hasPendingContinuation()).toBe(true)

    const events: StreamEvent[] = []
    const resumed = await resumePending(bundle, {
      onEvent: async (ev) => {
        events.push(ev)
      },
    })
    expect(resumed).toBe(true)
    expect(events.some((e) => e.type === 'assistant_turn_complete')).toBe(true)
    expect(client.requests).toHaveLength(1)

    // Turn completed: the persisted snapshot now carries the continuation
    // reply, and the engine's hasPendingContinuation flag cleared.
    expect(bundle.engine.hasPendingContinuation()).toBe(false)
    const snap = loadSessionSnapshot(tmpDataDir)
    expect(snap).not.toBeNull()
    expect(snap!.session_id).toBe(sessionId)
    expect(snap!.messages.at(-1)!.role).toBe('assistant')
    expect(snap!.messages).toHaveLength(4)
  })
})
