import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { ResolvedConfig } from '@guildhall/config'
import { OrchestratorSupervisor } from '../serve-supervisor.js'

describe('OrchestratorSupervisor', () => {
  it('aborts the in-flight orchestrator when stop is requested', async () => {
    const workspacePath = await mkdtemp(path.join(tmpdir(), 'guildhall-supervisor-'))
    let seenSignal: AbortSignal | undefined
    const supervisor = new OrchestratorSupervisor({
      resolveConfig: () => ({ workspaceId: 'w', projectPath: workspacePath } as ResolvedConfig),
      runOrchestrator: async (_config, opts) => {
        const signal = opts?.abortSignal
        if (!signal) throw new Error('expected abort signal')
        seenSignal = signal
        await new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => resolve(), { once: true })
        })
      },
    })

    try {
      const run = supervisor.start({ workspaceId: 'w', workspacePath })
      await vi.waitFor(() => expect(seenSignal).toBeDefined())

      const stopped = await supervisor.stop('w', { waitMs: 500, reason: 'test' })

      expect(stopped).toBe(true)
      expect(seenSignal?.aborted).toBe(true)
      expect(run.status).toBe('stopped')
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  it('passes one-task mode through to the orchestrator', async () => {
    const workspacePath = await mkdtemp(path.join(tmpdir(), 'guildhall-supervisor-'))
    let seenStopAfterOneTask: boolean | undefined
    const supervisor = new OrchestratorSupervisor({
      resolveConfig: () => ({ workspaceId: 'w', projectPath: workspacePath } as ResolvedConfig),
      runOrchestrator: async (_config, opts) => {
        seenStopAfterOneTask = opts?.stopAfterOneTask
      },
    })

    try {
      const run = supervisor.start({
        workspaceId: 'w',
        workspacePath,
        stopAfterOneTask: true,
      })
      await run.runPromise

      expect(run.mode).toBe('one_task')
      expect(seenStopAfterOneTask).toBe(true)
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  it('reports still-stopping runs as not stopped on repeated stop calls', async () => {
    const workspacePath = await mkdtemp(path.join(tmpdir(), 'guildhall-supervisor-'))
    const supervisor = new OrchestratorSupervisor({
      resolveConfig: () => ({ workspaceId: 'w', projectPath: workspacePath } as ResolvedConfig),
      runOrchestrator: async () => {
        await new Promise<void>(() => {})
      },
    })

    try {
      const run = supervisor.start({ workspaceId: 'w', workspacePath })

      const first = await supervisor.stop('w', { waitMs: 1, reason: 'test' })
      const second = await supervisor.stop('w', { waitMs: 1, reason: 'test-again' })

      expect(first).toBe(false)
      expect(second).toBe(false)
      expect(run.status).toBe('stopping')
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })
})
