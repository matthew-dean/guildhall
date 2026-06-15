import { describe, expect, it, vi } from 'vitest'

import {
  findStaleGuildhallProcesses,
  parseGuildhallProcessList,
  stopStaleGuildhallProcesses,
} from '../stale-guildhall-processes.js'

describe('stale Guildhall process guardrail', () => {
  it('detects Guildhall MCP processes started before the current installed build', () => {
    const rows = [
      ' 101 Sat Jun  6 10:14:35 2026     /Users/matthew/.guildhall/app/0.10.0/runtime/node /Users/matthew/.guildhall/app/0.10.0/app/dist/cli.js mcp serve .',
      ' 202 Sat Jun  6 13:11:09 2026     /Users/matthew/.guildhall/app/0.10.0/runtime/node /Users/matthew/.guildhall/app/0.10.0/app/dist/cli.js serve-internal --port 7777',
      ' 303 Sat Jun  6 11:47:30 2026     /Applications/Codex.app/Contents/Resources/node kernel.js',
    ].join('\n')

    const processes = parseGuildhallProcessList(rows)
    const staleProcess = processes.find(process => process.pid === 101)
    if (!staleProcess) throw new Error('expected process fixture to parse')
    const stale = findStaleGuildhallProcesses(processes, {
      currentPid: 202,
      currentBuildMtimeMs: staleProcess.startedAtMs + 60_000,
    })

    expect(stale).toEqual([expect.objectContaining({
      pid: 101,
      mode: 'mcp',
      stale: true,
    })])
  })

  it('does not flag the current process or Guildhall processes started after the build', () => {
    const rows = [
      ' 202 Sat Jun  6 13:11:09 2026     /Users/matthew/.guildhall/app/0.10.0/runtime/node /Users/matthew/.guildhall/app/0.10.0/app/dist/cli.js serve-internal --port 7777',
      ' 404 Sat Jun  6 13:12:00 2026     /Users/matthew/.guildhall/app/0.10.0/runtime/node /Users/matthew/.guildhall/app/0.10.0/app/dist/cli.js mcp serve /repo',
    ].join('\n')

    const processes = parseGuildhallProcessList(rows)
    const siblingProcess = processes.find(process => process.pid === 404)
    if (!siblingProcess) throw new Error('expected process fixture to parse')
    const stale = findStaleGuildhallProcesses(processes, {
      currentPid: 202,
      currentBuildMtimeMs: siblingProcess.startedAtMs - 60_000,
    })

    expect(stale).toEqual([])
  })

  it('can terminate stale sibling processes through an injected kill function', async () => {
    const killProcess = vi.fn()
    const result = await stopStaleGuildhallProcesses({
      currentPid: 202,
      currentBuildMtimeMs: Date.parse('2026-06-06T20:00:00.000Z'),
      listProcesses: async () => [
        {
          pid: 101,
          startedAtMs: Date.parse('2026-06-06T17:14:35.000Z'),
          command: '/Users/matthew/.guildhall/app/0.10.0/app/dist/cli.js mcp serve .',
          mode: 'mcp',
          stale: false,
        },
      ],
      killProcess,
    })

    expect(result.stopped.map(process => process.pid)).toEqual([101])
    expect(killProcess).toHaveBeenCalledWith(101, 'SIGTERM')
  })

  it('force-kills stale siblings that survive TERM', async () => {
    const killProcess = vi.fn()
    const result = await stopStaleGuildhallProcesses({
      currentPid: 202,
      currentBuildMtimeMs: Date.parse('2026-06-06T20:00:00.000Z'),
      forceAfterMs: 0,
      listProcesses: async () => [
        {
          pid: 101,
          startedAtMs: Date.parse('2026-06-06T17:14:35.000Z'),
          command: '/Users/matthew/.guildhall/app/0.10.0/app/dist/cli.js mcp serve .',
          mode: 'mcp',
          stale: false,
        },
      ],
      isProcessAlive: () => true,
      killProcess,
    })

    expect(result.stopped.map(process => process.pid)).toEqual([101])
    expect(killProcess).toHaveBeenCalledWith(101, 'SIGTERM')
    expect(killProcess).toHaveBeenCalledWith(101, 'SIGKILL')
  })
})
