import { describe, it, expect } from 'vitest'
import { buildHookExecutor } from '../hooks-loader.js'
import { HookEvent, type SupportsStreamingMessages } from '@guildhall/engine'
import type { ResolvedConfig } from '@guildhall/config'

const apiClient: SupportsStreamingMessages = {
  // Never actually called by these tests — hooks-loader only stores the ref.
  async *streamMessage() {
    throw new Error('unused')
  },
}

function baseConfig(hooks?: Record<string, unknown[]>): ResolvedConfig {
  const cfg: ResolvedConfig = {
    workspaceId: 'ws',
    workspaceName: 'Test',
    workspacePath: '/tmp/ws',
    projectPath: '/tmp/proj',
    memoryDir: '/tmp/ws/memory',
    models: {
      spec: 'm',
      coordinator: 'm',
      worker: 'm',
      reviewer: 'm',
      gateChecker: 'm',
    },
    coordinators: [],
    maxRevisions: 3,
    heartbeatInterval: 5,
    ignore: [],
    lmStudioUrl: 'http://localhost:1234/v1',
    servePort: 7777,
  }
  if (hooks) cfg.hooks = hooks
  return cfg
}

describe('buildHookExecutor', () => {
  it('returns undefined when config has no hooks', () => {
    expect(
      buildHookExecutor({ config: baseConfig(), apiClient, defaultModel: 'm' }),
    ).toBeUndefined()
  })

  it('returns undefined when the hooks record is present but empty', () => {
    expect(
      buildHookExecutor({ config: baseConfig({}), apiClient, defaultModel: 'm' }),
    ).toBeUndefined()
  })

  it('ignores unknown event keys and returns undefined when nothing registered', () => {
    const exec = buildHookExecutor({
      config: baseConfig({ bogus_event: [{ type: 'command', command: 'echo hi' }] }),
      apiClient,
      defaultModel: 'm',
    })
    expect(exec).toBeUndefined()
  })

  it('drops malformed hook definitions and registers valid ones', async () => {
    const exec = buildHookExecutor({
      config: baseConfig({
        [HookEvent.SESSION_START]: [
          { type: 'command', command: 'echo start' },
          { type: 'nonsense', command: 'ignored' }, // malformed — should be dropped
        ],
      }),
      apiClient,
      defaultModel: 'm',
    })
    expect(exec).toBeDefined()
  })

  it('registers a valid command hook on SESSION_START and routes through execute()', async () => {
    const exec = buildHookExecutor({
      config: baseConfig({
        [HookEvent.SESSION_START]: [
          { type: 'command', command: 'true', block_on_failure: false },
        ],
      }),
      apiClient,
      defaultModel: 'm',
    })
    expect(exec).toBeDefined()
    // block_on_failure=false on `true` → non-blocking success
    const result = await exec!.execute(HookEvent.SESSION_START, {
      event: HookEvent.SESSION_START,
    })
    expect(result.blocked).toBe(false)
  })
})
