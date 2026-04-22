import { describe, expect, it } from 'vitest'

import {
  type ApiStreamEvent,
  HookEvent,
  type SupportsStreamingMessages,
} from '@guildhall/engine'
import type { ConversationMessage } from '@guildhall/protocol'

import {
  type CommandRunner,
  HookExecutor,
  HookRegistry,
  aggregatedBlocked,
  aggregatedReason,
  commandHookDefinitionSchema,
  fnmatch,
  hookDefinitionSchema,
  httpHookDefinitionSchema,
  promptHookDefinitionSchema,
  shellEscape,
} from '../index.js'

class ScriptedClient implements SupportsStreamingMessages {
  constructor(private readonly events: ApiStreamEvent[]) {}
  async *streamMessage(): AsyncIterable<ApiStreamEvent> {
    for (const ev of this.events) yield ev
  }
}

class ThrowingClient implements SupportsStreamingMessages {
  async *streamMessage(): AsyncIterable<ApiStreamEvent> {
    yield { type: 'text_delta', text: 'starting' }
    throw new Error('provider exploded')
  }
}

function assistantComplete(text: string): ApiStreamEvent {
  const msg: ConversationMessage = { role: 'assistant', content: [{ type: 'text', text }] }
  return {
    type: 'message_complete',
    message: msg,
    usage: { input_tokens: 0, output_tokens: 0 },
    stop_reason: 'end_turn',
  }
}

function makeExecutor(
  overrides: {
    registry?: HookRegistry
    client?: SupportsStreamingMessages
    runCommand?: CommandRunner
    cwd?: string
  } = {},
): { executor: HookExecutor; registry: HookRegistry } {
  const registry = overrides.registry ?? new HookRegistry()
  const client = overrides.client ?? new ScriptedClient([])
  const executor = new HookExecutor(
    registry,
    { cwd: overrides.cwd ?? '/tmp', apiClient: client, defaultModel: 'm' },
    overrides.runCommand ? { runCommand: overrides.runCommand } : undefined,
  )
  return { executor, registry }
}

describe('HookRegistry', () => {
  it('stores hooks by event and returns copies', () => {
    const registry = new HookRegistry()
    registry.register(HookEvent.PRE_TOOL_USE, {
      type: 'command',
      command: 'echo hi',
      timeout_seconds: 30,
      block_on_failure: false,
    })
    const first = registry.get(HookEvent.PRE_TOOL_USE)
    first.push({
      type: 'command',
      command: 'echo leaked',
      timeout_seconds: 30,
      block_on_failure: false,
    })
    expect(registry.get(HookEvent.PRE_TOOL_USE)).toHaveLength(1)
    expect(registry.get(HookEvent.POST_TOOL_USE)).toEqual([])
  })

  it('summary lists configured events', () => {
    const registry = new HookRegistry()
    registry.register(HookEvent.SESSION_START, {
      type: 'command',
      command: 'touch marker',
      timeout_seconds: 30,
      block_on_failure: false,
    })
    registry.register(HookEvent.PRE_TOOL_USE, {
      type: 'http',
      url: 'https://example.test/hook',
      headers: {},
      timeout_seconds: 30,
      block_on_failure: false,
      matcher: 'Edit',
    })
    const summary = registry.summary()
    expect(summary).toContain('session_start:')
    expect(summary).toContain('  - command: touch marker')
    expect(summary).toContain('pre_tool_use:')
    expect(summary).toContain('matcher=Edit')
    expect(summary).toContain('https://example.test/hook')
  })
})

describe('schemas', () => {
  it('parse default values for command hook', () => {
    const hook = commandHookDefinitionSchema.parse({ type: 'command', command: 'ls' })
    expect(hook.timeout_seconds).toBe(30)
    expect(hook.block_on_failure).toBe(false)
  })

  it('prompt hooks default to blocking on failure', () => {
    const hook = promptHookDefinitionSchema.parse({ type: 'prompt', prompt: 'is x true?' })
    expect(hook.block_on_failure).toBe(true)
  })

  it('discriminated union rejects unknown types', () => {
    const result = hookDefinitionSchema.safeParse({ type: 'never', command: 'x' })
    expect(result.success).toBe(false)
  })

  it('http hooks require a valid URL', () => {
    expect(httpHookDefinitionSchema.safeParse({ type: 'http', url: 'not-a-url' }).success).toBe(false)
    expect(httpHookDefinitionSchema.safeParse({ type: 'http', url: 'https://ok.test' }).success).toBe(true)
  })
})

describe('fnmatch', () => {
  it('supports star and bracket classes like python fnmatch', () => {
    expect(fnmatch('Edit', 'Ed*')).toBe(true)
    expect(fnmatch('Read', 'Ed*')).toBe(false)
    expect(fnmatch('ab', '[ab][ab]')).toBe(true)
    expect(fnmatch('ac', '[ab][ab]')).toBe(false)
    expect(fnmatch('anything', '*')).toBe(true)
  })
})

describe('shellEscape', () => {
  it('leaves safe strings unquoted', () => {
    expect(shellEscape('safe-string_123')).toBe('safe-string_123')
  })

  it('wraps unsafe strings in single quotes and escapes embedded quotes', () => {
    expect(shellEscape(`O'Brien`)).toBe(`'O'"'"'Brien'`)
    expect(shellEscape('a b')).toBe(`'a b'`)
    expect(shellEscape('')).toBe(`''`)
  })
})

describe('HookExecutor.execute (engine interface)', () => {
  it('returns unblocked when no hooks are registered', async () => {
    const { executor } = makeExecutor()
    const result = await executor.execute(HookEvent.PRE_TOOL_USE, { event: 'pre_tool_use' })
    expect(result).toEqual({ blocked: false })
  })

  it('matcher filters hooks by tool_name', async () => {
    const registry = new HookRegistry()
    registry.register(HookEvent.PRE_TOOL_USE, {
      type: 'command',
      command: 'false',
      timeout_seconds: 30,
      block_on_failure: true,
      matcher: 'NeverMatches',
    })
    const { executor } = makeExecutor({
      registry,
      runCommand: async () => ({ exitCode: 1, stdout: '', stderr: '' }),
    })
    const result = await executor.execute(HookEvent.PRE_TOOL_USE, {
      event: 'pre_tool_use',
      tool_name: 'Edit',
    })
    expect(result.blocked).toBe(false)
  })

  it('command hook injects $ARGUMENTS and reports success', async () => {
    const registry = new HookRegistry()
    registry.register(HookEvent.PRE_TOOL_USE, {
      type: 'command',
      command: 'echo $ARGUMENTS',
      timeout_seconds: 30,
      block_on_failure: false,
    })
    let observedCommand = ''
    const { executor } = makeExecutor({
      registry,
      runCommand: async (command) => {
        observedCommand = command
        return { exitCode: 0, stdout: 'done', stderr: '' }
      },
    })
    const agg = await executor.executeAll(HookEvent.PRE_TOOL_USE, {
      event: 'pre_tool_use',
      tool_name: 'Edit',
    })
    expect(agg.results).toHaveLength(1)
    expect(agg.results[0]?.success).toBe(true)
    expect(agg.results[0]?.output).toBe('done')
    expect(observedCommand.startsWith('echo ')).toBe(true)
    // The injected payload should be shell-quoted JSON.
    expect(observedCommand).toContain('tool_name')
  })

  it('command hook blocks when it fails and block_on_failure is set', async () => {
    const registry = new HookRegistry()
    registry.register(HookEvent.PRE_TOOL_USE, {
      type: 'command',
      command: 'exit 1',
      timeout_seconds: 30,
      block_on_failure: true,
    })
    const { executor } = makeExecutor({
      registry,
      runCommand: async () => ({ exitCode: 1, stdout: '', stderr: 'bad' }),
    })
    const result = await executor.execute(HookEvent.PRE_TOOL_USE, { event: 'pre_tool_use' })
    expect(result.blocked).toBe(true)
    expect(result.reason).toContain('bad')
  })

  it('command hook timeout surfaces a timeout reason', async () => {
    const registry = new HookRegistry()
    registry.register(HookEvent.PRE_TOOL_USE, {
      type: 'command',
      command: 'sleep 99',
      timeout_seconds: 1,
      block_on_failure: true,
    })
    const { executor } = makeExecutor({
      registry,
      runCommand: async () => {
        throw new Error('__timeout__')
      },
    })
    const result = await executor.execute(HookEvent.PRE_TOOL_USE, { event: 'pre_tool_use' })
    expect(result.blocked).toBe(true)
    expect(result.reason).toContain('timed out')
  })

  it('prompt hook parses JSON ok response and does not block', async () => {
    const registry = new HookRegistry()
    registry.register(HookEvent.PRE_TOOL_USE, {
      type: 'prompt',
      prompt: 'is this safe?',
      timeout_seconds: 30,
      block_on_failure: true,
    })
    const client = new ScriptedClient([assistantComplete('{"ok": true}')])
    const { executor } = makeExecutor({ registry, client })
    const result = await executor.execute(HookEvent.PRE_TOOL_USE, { event: 'pre_tool_use' })
    expect(result.blocked).toBe(false)
  })

  it('prompt hook blocks on structured rejection with reason', async () => {
    const registry = new HookRegistry()
    registry.register(HookEvent.PRE_TOOL_USE, {
      type: 'prompt',
      prompt: 'is this safe?',
      timeout_seconds: 30,
      block_on_failure: true,
    })
    const client = new ScriptedClient([assistantComplete('{"ok": false, "reason": "denied"}')])
    const { executor } = makeExecutor({ registry, client })
    const result = await executor.execute(HookEvent.PRE_TOOL_USE, { event: 'pre_tool_use' })
    expect(result.blocked).toBe(true)
    expect(result.reason).toBe('denied')
  })

  it('prompt hook treats plain "ok" text as passing', async () => {
    const registry = new HookRegistry()
    registry.register(HookEvent.PRE_TOOL_USE, {
      type: 'prompt',
      prompt: '?',
      timeout_seconds: 30,
      block_on_failure: true,
    })
    const client = new ScriptedClient([assistantComplete('ok')])
    const { executor } = makeExecutor({ registry, client })
    const agg = await executor.executeAll(HookEvent.PRE_TOOL_USE, { event: 'pre_tool_use' })
    expect(agg.results[0]?.success).toBe(true)
    expect(aggregatedBlocked(agg)).toBe(false)
  })

  it('prompt hook handles provider errors as blocked failures', async () => {
    const registry = new HookRegistry()
    registry.register(HookEvent.PRE_TOOL_USE, {
      type: 'prompt',
      prompt: '?',
      timeout_seconds: 30,
      block_on_failure: true,
    })
    const { executor } = makeExecutor({ registry, client: new ThrowingClient() })
    const agg = await executor.executeAll(HookEvent.PRE_TOOL_USE, { event: 'pre_tool_use' })
    expect(agg.results[0]?.success).toBe(false)
    expect(aggregatedBlocked(agg)).toBe(true)
    expect(aggregatedReason(agg)).toContain('provider exploded')
  })
})
