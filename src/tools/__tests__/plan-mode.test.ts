import { describe, it, expect } from 'vitest'

import {
  PermissionChecker,
  PermissionMode,
  QueryEngine,
  ToolRegistry,
  defaultPermissionSettings,
} from '@guildhall/engine'
import { ScriptedApiClient } from '../../engine/__tests__/fake-client.js'
import { enterPlanModeTool, exitPlanModeTool } from '../plan-mode.js'

describe('enterPlanModeTool.execute', () => {
  it('calls the set_permission_mode callback with "plan"', async () => {
    let captured: string | null = null
    const metadata: Record<string, unknown> = {
      set_permission_mode: (mode: string) => {
        captured = mode
      },
    }
    const result = await enterPlanModeTool.execute(
      {},
      { cwd: '/tmp', metadata },
    )
    expect(result.is_error).toBe(false)
    expect(captured).toBe('plan')
    expect(metadata['permission_mode']).toBe('plan')
    expect(result.output).toContain('plan')
  })

  it('falls back to metadata-only when no callback is threaded', async () => {
    const metadata: Record<string, unknown> = {}
    const result = await enterPlanModeTool.execute(
      {},
      { cwd: '/tmp', metadata },
    )
    expect(result.is_error).toBe(false)
    expect(metadata['permission_mode']).toBe('plan')
    expect(result.output).toMatch(/not swapped/)
  })
})

describe('exitPlanModeTool.execute', () => {
  it('calls the set_permission_mode callback with "default"', async () => {
    let captured: string | null = null
    const metadata: Record<string, unknown> = {
      set_permission_mode: (mode: string) => {
        captured = mode
      },
    }
    const result = await exitPlanModeTool.execute(
      {},
      { cwd: '/tmp', metadata },
    )
    expect(result.is_error).toBe(false)
    expect(captured).toBe('default')
    expect(metadata['permission_mode']).toBe('default')
  })

  it('falls back to metadata-only when no callback is threaded', async () => {
    const metadata: Record<string, unknown> = {}
    const result = await exitPlanModeTool.execute(
      {},
      { cwd: '/tmp', metadata },
    )
    expect(result.is_error).toBe(false)
    expect(metadata['permission_mode']).toBe('default')
  })
})

describe('plan-mode tools + QueryEngine integration', () => {
  it('swaps the engine permission checker when the tool fires', async () => {
    const engine = new QueryEngine({
      apiClient: new ScriptedApiClient([]),
      toolRegistry: new ToolRegistry(),
      permissionChecker: new PermissionChecker(
        defaultPermissionSettings(PermissionMode.FULL_AUTO),
      ),
      cwd: '/tmp',
      model: 'test',
      systemPrompt: '',
    })

    const beforeMutating = engine['permissionChecker'].evaluate('write-file', {
      isReadOnly: false,
      filePath: '/tmp/x.txt',
    })
    expect(beforeMutating.allowed).toBe(true)

    const metadata = engine.getToolMetadata()
    const setMode = metadata['set_permission_mode'] as (m: string) => void
    expect(typeof setMode).toBe('function')

    await enterPlanModeTool.execute({}, { cwd: '/tmp', metadata })

    const afterPlan = engine['permissionChecker'].evaluate('write-file', {
      isReadOnly: false,
      filePath: '/tmp/x.txt',
    })
    expect(afterPlan.allowed).toBe(false)
    expect(afterPlan.reason).toMatch(/[Pp]lan mode/)

    await exitPlanModeTool.execute({}, { cwd: '/tmp', metadata })

    const afterExit = engine['permissionChecker'].evaluate('read-file', {
      isReadOnly: true,
      filePath: '/tmp/x.txt',
    })
    expect(afterExit.allowed).toBe(true)
  })
})
