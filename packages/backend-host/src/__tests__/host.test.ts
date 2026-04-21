import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { z } from 'zod'

import {
  PermissionChecker,
  PermissionMode,
  ToolRegistry,
  defaultPermissionSettings,
  defineTool,
  type ApiMessageRequest,
  type ApiStreamEvent,
  type SupportsStreamingMessages,
} from '@guildhall/engine'
import type {
  ConversationMessage,
  UsageSnapshot,
} from '@guildhall/protocol'
import { buildRuntime } from '@guildhall/runtime-bundle'

import {
  OHJSON_PREFIX,
  ReactBackendHost,
  encodeBackendEvent,
  parseFrontendRequest,
  type BackendEvent,
  type FrontendRequest,
} from '../index.js'

// ---------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------

interface ScriptedTurn {
  textDeltas?: string[]
  message: ConversationMessage
  usage?: UsageSnapshot
}

class ScriptedApiClient implements SupportsStreamingMessages {
  private index = 0
  readonly requests: ApiMessageRequest[] = []
  constructor(private readonly script: ScriptedTurn[]) {}
  async *streamMessage(request: ApiMessageRequest): AsyncIterable<ApiStreamEvent> {
    this.requests.push(request)
    const turn = this.script[this.index]
    if (!turn) throw new Error('script exhausted')
    this.index += 1
    for (const d of turn.textDeltas ?? []) yield { type: 'text_delta', text: d }
    yield {
      type: 'message_complete',
      message: turn.message,
      usage: turn.usage ?? { input_tokens: 0, output_tokens: 0 },
      stop_reason: null,
    }
  }
}

class InputChannel {
  private pending: Array<{ resolve: (val: IteratorResult<string>) => void }> = []
  private buffered: string[] = []
  private closed = false

  send(line: string): void {
    const waiter = this.pending.shift()
    if (waiter) waiter.resolve({ value: line, done: false })
    else this.buffered.push(line)
  }
  close(): void {
    this.closed = true
    while (this.pending.length > 0) {
      this.pending.shift()!.resolve({ value: undefined, done: true })
    }
  }
  [Symbol.asyncIterator](): AsyncIterator<string> {
    return {
      next: () => {
        const buffered = this.buffered.shift()
        if (buffered !== undefined) {
          return Promise.resolve({ value: buffered, done: false })
        }
        if (this.closed) {
          return Promise.resolve({ value: undefined, done: true })
        }
        return new Promise<IteratorResult<string>>((resolve) => {
          this.pending.push({ resolve })
        })
      },
    }
  }
}

function autoChecker(): PermissionChecker {
  return new PermissionChecker(defaultPermissionSettings(PermissionMode.FULL_AUTO))
}

function parseEmitted(line: string): BackendEvent {
  expect(line.startsWith(OHJSON_PREFIX)).toBe(true)
  const json = line.slice(OHJSON_PREFIX.length).replace(/\n$/, '')
  return JSON.parse(json) as BackendEvent
}

function sendRequest(input: InputChannel, req: FrontendRequest): void {
  input.send(OHJSON_PREFIX + JSON.stringify(req) + '\n')
}

// ---------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------

let tmpDataDir: string

beforeEach(() => {
  tmpDataDir = mkdtempSync(join(tmpdir(), 'guildhall-bh-'))
  process.env.GUILDHALL_DATA_DIR = tmpDataDir
  process.env.GUILDHALL_CONFIG_DIR = tmpDataDir
})

afterEach(() => {
  rmSync(tmpDataDir, { recursive: true, force: true })
  delete process.env.GUILDHALL_DATA_DIR
  delete process.env.GUILDHALL_CONFIG_DIR
})

// ---------------------------------------------------------------------
// Wire schema
// ---------------------------------------------------------------------

describe('wire schema', () => {
  it('round-trips a BackendEvent through encode/decode', () => {
    const evt: BackendEvent = { type: 'assistant_delta', message: 'hi' }
    const encoded = encodeBackendEvent(evt)
    expect(encoded.startsWith(OHJSON_PREFIX)).toBe(true)
    expect(encoded.endsWith('\n')).toBe(true)
    const back = JSON.parse(encoded.slice(OHJSON_PREFIX.length).trim()) as BackendEvent
    expect(back).toEqual(evt)
  })

  it('parses an OHJSON-prefixed frontend request', () => {
    const raw = OHJSON_PREFIX + JSON.stringify({ type: 'submit_line', line: 'hi' })
    const req = parseFrontendRequest(raw)
    expect(req.type).toBe('submit_line')
    expect(req.line).toBe('hi')
  })

  it('tolerates a bare JSON frontend request (no prefix)', () => {
    const req = parseFrontendRequest('{"type":"shutdown"}')
    expect(req.type).toBe('shutdown')
  })

  it('throws on invalid JSON', () => {
    expect(() => parseFrontendRequest('not json')).toThrow()
  })

  it('throws on schema mismatch', () => {
    expect(() => parseFrontendRequest('{"type":"nope"}')).toThrow()
  })
})

// ---------------------------------------------------------------------
// Host lifecycle
// ---------------------------------------------------------------------

describe('ReactBackendHost', () => {
  async function buildHost(
    apiClient: SupportsStreamingMessages,
    extra: Partial<ConstructorParameters<typeof ReactBackendHost>[0]> = {},
  ) {
    const bundle = await buildRuntime({
      apiClient,
      cwd: tmpDataDir,
      model: 'test-model',
      systemPrompt: 'sys',
      toolRegistry: new ToolRegistry(),
      permissionChecker: autoChecker(),
    })
    const input = new InputChannel()
    const emitted: string[] = []
    const host = new ReactBackendHost({
      bundle,
      input,
      output: (line) => {
        emitted.push(line)
      },
      ...extra,
    })
    return { host, input, emitted, bundle }
  }

  it('emits ready + line_complete + shutdown on a simple submit_line session', async () => {
    const client = new ScriptedApiClient([
      {
        textDeltas: ['He', 'llo'],
        message: { role: 'assistant', content: [{ type: 'text', text: 'Hello' }] },
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    ])
    const { host, input, emitted } = await buildHost(client, {
      readyCommands: ['/help'],
      readyState: { model: 'test-model' },
    })
    const runPromise = host.run()
    await waitForEvent(emitted, 'ready')
    sendRequest(input, { type: 'submit_line', line: 'hi' })
    await waitForEvent(emitted, 'assistant_complete')
    sendRequest(input, { type: 'shutdown' })
    const code = await runPromise
    expect(code).toBe(0)

    const types = emitted.map((l) => parseEmitted(l).type)
    expect(types[0]).toBe('ready')
    expect(types).toContain('transcript_item')
    expect(types).toContain('assistant_delta')
    expect(types).toContain('assistant_complete')
    expect(types).toContain('line_complete')
    expect(types).toContain('shutdown')
  })

  it('serializes tool_started/tool_completed events with tool_name metadata', async () => {
    const client = new ScriptedApiClient([
      {
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'toolu_1', name: 'fake_tool', input: { x: 1 } }],
        },
        usage: { input_tokens: 0, output_tokens: 0 },
      },
      {
        message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    ])
    const registry = new ToolRegistry()
    registry.register(
      defineTool({
        name: 'fake_tool',
        description: 'a fake tool',
        inputSchema: z.object({ x: z.number() }),
        execute: async () => ({ output: 'ok', is_error: false }),
      }),
    )
    const bundle = await buildRuntime({
      apiClient: client,
      cwd: tmpDataDir,
      model: 'm',
      systemPrompt: '',
      toolRegistry: registry,
      permissionChecker: autoChecker(),
    })
    const input = new InputChannel()
    const emitted: string[] = []
    const host = new ReactBackendHost({
      bundle,
      input,
      output: (line) => {
        emitted.push(line)
      },
    })
    const runPromise = host.run()
    sendRequest(input, { type: 'submit_line', line: 'use tool' })
    await waitForEvent(emitted, 'assistant_complete')
    sendRequest(input, { type: 'shutdown' })
    await runPromise

    const events = emitted.map((l) => parseEmitted(l))
    const toolStarted = events.find((e) => e.type === 'tool_started')
    expect(toolStarted).toBeDefined()
    expect(toolStarted!.tool_name).toBe('fake_tool')
    expect(toolStarted!.tool_input).toEqual({ x: 1 })
    const toolCompleted = events.find((e) => e.type === 'tool_completed')
    expect(toolCompleted).toBeDefined()
    expect(toolCompleted!.tool_name).toBe('fake_tool')
    expect(toolCompleted!.output).toBe('ok')
  })

  it('emits todo_update when TodoWrite tool runs with structured todos', async () => {
    const client = new ScriptedApiClient([
      {
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_2',
              name: 'TodoWrite',
              input: {
                todos: [
                  { content: 'first step', status: 'completed' },
                  { content: 'second step', status: 'pending' },
                ],
              },
            },
          ],
        },
        usage: { input_tokens: 0, output_tokens: 0 },
      },
      {
        message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    ])
    const registry = new ToolRegistry()
    registry.register(
      defineTool({
        name: 'TodoWrite',
        description: 'todos',
        inputSchema: z.object({ todos: z.array(z.record(z.unknown())) }),
        execute: async () => ({ output: 'updated', is_error: false }),
      }),
    )
    const bundle = await buildRuntime({
      apiClient: client,
      cwd: tmpDataDir,
      model: 'm',
      systemPrompt: '',
      toolRegistry: registry,
      permissionChecker: autoChecker(),
    })
    const input = new InputChannel()
    const emitted: string[] = []
    const host = new ReactBackendHost({
      bundle,
      input,
      output: (line) => {
        emitted.push(line)
      },
    })
    const runPromise = host.run()
    sendRequest(input, { type: 'submit_line', line: 'plan' })
    await waitForEvent(emitted, 'assistant_complete')
    sendRequest(input, { type: 'shutdown' })
    await runPromise

    const events = emitted.map((l) => parseEmitted(l))
    const todo = events.find((e) => e.type === 'todo_update')
    expect(todo).toBeDefined()
    expect(todo!.todo_markdown).toContain('- [x] first step')
    expect(todo!.todo_markdown).toContain('- [ ] second step')
  })

  it('routes permission_response to the bundle askPermission promise', async () => {
    const client = new ScriptedApiClient([])
    const { host, input, emitted } = await buildHost(client)
    const runPromise = host.run()

    // Wait for ready before asking a permission
    await waitForEvent(emitted, 'ready')
    const answer = host.askPermission('bash', 'rm -rf /tmp/x')
    const modalReq = await waitForEvent(emitted, 'modal_request')
    const requestId = String((modalReq.modal as Record<string, unknown>).request_id)
    expect(typeof requestId).toBe('string')
    sendRequest(input, {
      type: 'permission_response',
      request_id: requestId,
      allowed: true,
    })
    await expect(answer).resolves.toBe(true)
    sendRequest(input, { type: 'shutdown' })
    await runPromise
  })

  it('routes question_response to askQuestion', async () => {
    const client = new ScriptedApiClient([])
    const { host, input, emitted } = await buildHost(client)
    const runPromise = host.run()
    await waitForEvent(emitted, 'ready')
    const answer = host.askQuestion('what?')
    const modalReq = await waitForEvent(emitted, 'modal_request')
    const requestId = String((modalReq.modal as Record<string, unknown>).request_id)
    sendRequest(input, {
      type: 'question_response',
      request_id: requestId,
      answer: 'forty-two',
    })
    await expect(answer).resolves.toBe('forty-two')
    sendRequest(input, { type: 'shutdown' })
    await runPromise
  })

  it('emits an error for unknown request types', async () => {
    const client = new ScriptedApiClient([])
    const { host, input, emitted } = await buildHost(client)
    const runPromise = host.run()
    await waitForEvent(emitted, 'ready')
    // Unknown via "bare" request — submit it manually
    input.send(
      OHJSON_PREFIX +
        JSON.stringify({ type: 'select_command', command: 'model' }) +
        '\n',
    )
    await waitForEvent(emitted, 'error')
    sendRequest(input, { type: 'shutdown' })
    await runPromise
    const errors = emitted
      .map((l) => parseEmitted(l))
      .filter((e) => e.type === 'error')
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0]!.message).toMatch(/select commands not wired/)
  })

  it('honors onSubmitLine short-circuit', async () => {
    const client = new ScriptedApiClient([])
    const { host, input, emitted } = await buildHost(client, {
      onSubmitLine: async (line) => {
        if (line.startsWith('/')) return { handled: true }
        return { handled: false }
      },
    })
    const runPromise = host.run()
    await waitForEvent(emitted, 'ready')
    sendRequest(input, { type: 'submit_line', line: '/noop' })
    await waitForEvent(emitted, 'line_complete')
    sendRequest(input, { type: 'shutdown' })
    await runPromise
    // No assistant_* events because the line was short-circuited
    const events = emitted.map((l) => parseEmitted(l))
    expect(events.some((e) => e.type === 'assistant_delta')).toBe(false)
    expect(events.some((e) => e.type === 'assistant_complete')).toBe(false)
  })

  it('dispatches select_command and apply_select_command through SelectCommandHandler', async () => {
    const client = new ScriptedApiClient([])
    const select = {
      seen: [] as Array<{ kind: string; command: string; value?: string }>,
      handleSelect: async (command: string) => {
        select.seen.push({ kind: 'handle', command })
      },
      applySelect: async (command: string, value: string) => {
        select.seen.push({ kind: 'apply', command, value })
        return { line: '', shouldContinue: true }
      },
    }
    const { host, input, emitted } = await buildHost(client, {
      selectHandler: select,
    })
    const runPromise = host.run()
    await waitForEvent(emitted, 'ready')
    sendRequest(input, { type: 'select_command', command: 'provider' })
    sendRequest(input, {
      type: 'apply_select_command',
      command: 'provider',
      value: 'claude',
    })
    // Give a tick for the queue to drain both.
    await new Promise((r) => setTimeout(r, 20))
    sendRequest(input, { type: 'shutdown' })
    await runPromise
    expect(select.seen).toEqual([
      { kind: 'handle', command: 'provider' },
      { kind: 'apply', command: 'provider', value: 'claude' },
    ])
  })
})

async function waitForEvent(emitted: string[], type: string): Promise<BackendEvent> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    for (const line of emitted) {
      const evt = parseEmitted(line)
      if (evt.type === type) return evt
    }
    await new Promise((r) => setTimeout(r, 5))
  }
  throw new Error(`Timed out waiting for ${type}; got: ${emitted.map((l) => parseEmitted(l).type).join(', ')}`)
}
