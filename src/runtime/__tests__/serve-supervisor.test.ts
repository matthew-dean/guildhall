import { describe, expect, it, vi } from 'vitest'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { ResolvedConfig } from '@guildhall/config'
import { OrchestratorSupervisor } from '../serve-supervisor.js'
import { clearProviderClientPool, getOrCreateProviderClient, openAiCompatiblePoolKey } from '../provider-client-pool.js'
import type { ApiMessageRequest, ApiStreamEvent, SupportsStreamingMessages } from '@guildhall/engine'
import type { OrchestratorRunResult } from '../orchestrator.js'

const REQUEST: ApiMessageRequest = {
  model: 'test-model',
  messages: [],
  max_tokens: 64,
  tools: [],
}

const STOP_SUMMARY: OrchestratorRunResult = {
  ticks: 1,
  stopReason: 'max_ticks',
  stopMessage: 'Reached maxTicks (test).',
}

class RetryableFailureClient implements SupportsStreamingMessages {
  async *streamMessage(_request: ApiMessageRequest): AsyncIterable<ApiStreamEvent> {
    throw Object.assign(new Error('temporary outage'), { retryable: true })
  }
}

async function drain(client: SupportsStreamingMessages): Promise<void> {
  for await (const _event of client.streamMessage(REQUEST)) {
    // drain
  }
}

describe('OrchestratorSupervisor', () => {
  it('emits provider health changes and refreshes run status for matching pooled providers', async () => {
    clearProviderClientPool()
    const workspacePath = await mkdtemp(path.join(tmpdir(), 'guildhall-supervisor-'))
    const healthKey = openAiCompatiblePoolKey({
      provider: 'openai-api',
      baseUrl: 'https://integrate.api.nvidia.com/v1',
      apiKey: 'sk-openai-test',
    })
    const supervisor = new OrchestratorSupervisor({
      resolveConfig: () => ({ workspaceId: 'w', projectPath: workspacePath } as ResolvedConfig),
      runOrchestrator: async () => {
        await new Promise<void>(() => {})
        return STOP_SUMMARY
      },
    })
    const seen: string[] = []
    const off = supervisor.subscribe((event) => {
      const type = event.event?.type
      if (type === 'provider_health_changed') seen.push(type)
    })

    try {
      const run = supervisor.start({
        workspaceId: 'w',
        workspacePath,
        providerHealthKey: healthKey,
        providerStatus: {
          activeProvider: 'openai-api',
          activeProviderLabel: 'OpenAI-compatible API',
          fallback: false,
          selectedAt: new Date().toISOString(),
          health: null,
        },
      })
      const client = getOrCreateProviderClient(healthKey, undefined, () => new RetryableFailureClient())
      await expect(drain(client)).rejects.toThrow(/temporary outage/)
      await expect(drain(client)).rejects.toThrow(/temporary outage/)

      await vi.waitFor(() => expect(run.providerStatus?.health?.state).toBe('degraded'))
      expect(run.providerStatus?.health?.consecutiveFailures).toBe(2)
      expect(seen.length).toBeGreaterThan(0)
      expect(run.recentEvents.some((event) => event.event.type === 'provider_health_changed')).toBe(true)
    } finally {
      off()
      clearProviderClientPool()
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

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
        return { ...STOP_SUMMARY, stopReason: 'stop_requested', stopMessage: 'Stop requested.' }
      },
    })

    try {
      const run = supervisor.start({ workspaceId: 'w', workspacePath })
      await vi.waitFor(() => expect(seenSignal).toBeDefined())

      const stopped = await supervisor.stop('w', { waitMs: 500, reason: 'test' })

      expect(stopped).toBe(true)
      expect(seenSignal?.aborted).toBe(true)
      expect(run.status).toBe('stopped')
      await expect(access(path.join(workspacePath, 'memory', 'stop-requested.json'))).rejects.toThrow()
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
        return { ...STOP_SUMMARY, stopReason: 'one_task', stopMessage: 'stopAfterOneTask reached task.' }
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
      expect(run.stopSummary?.stopReason).toBe('one_task')
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  it('persists the orchestrator stop summary onto the run and stop event', async () => {
    const workspacePath = await mkdtemp(path.join(tmpdir(), 'guildhall-supervisor-'))
    const supervisor = new OrchestratorSupervisor({
      resolveConfig: () => ({ workspaceId: 'w', projectPath: workspacePath } as ResolvedConfig),
      runOrchestrator: async () => ({
        ticks: 3,
        stopReason: 'awaiting_human',
        stopMessage: 'No actionable tasks remain right now: 1 waiting on user answers and 0 awaiting approval.',
        idleSummary: {
          reason: 'awaiting_human',
          message: 'No actionable tasks remain right now: 1 waiting on user answers and 0 awaiting approval.',
          counts: {
            total: 1,
            actionable: 0,
            terminal: 0,
            done: 0,
            blocked: 0,
            shelved: 0,
            waitingOnUser: 1,
            awaitingApproval: 0,
            dependencyBlocked: 0,
            escalated: 0,
            active: 0,
            fresh: 0,
          },
        },
      }),
    })

    try {
      const run = supervisor.start({ workspaceId: 'w', workspacePath })
      await run.runPromise

      expect(run.stopSummary?.stopReason).toBe('awaiting_human')
      const stopEvent = run.recentEvents.find((event) => event.event.type === 'supervisor_stopped')
      expect(stopEvent?.event).toMatchObject({
        type: 'supervisor_stopped',
        reason: 'awaiting_human',
      })
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
        return STOP_SUMMARY
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

  it('trims persisted recent events so reconnect hydration stays bounded', async () => {
    const workspacePath = await mkdtemp(path.join(tmpdir(), 'guildhall-supervisor-'))
    const supervisor = new OrchestratorSupervisor({
      resolveConfig: () => ({ workspaceId: 'w', projectPath: workspacePath } as ResolvedConfig),
      runOrchestrator: async (_config, opts) => {
        for (let i = 0; i < 1205; i++) {
          await opts?.onBackendEvent?.({
            type: 'line_complete',
            task_id: `task-${i}`,
            message: `event ${i}`,
          })
        }
        return STOP_SUMMARY
      },
    })

    try {
      const run = supervisor.start({ workspaceId: 'w', workspacePath })
      await run.runPromise

      const raw = await readFile(path.join(workspacePath, 'memory', 'recent-events.jsonl'), 'utf8')
      const lines = raw.trim().split('\n')
      expect(lines.length).toBeLessThanOrEqual(1000)

      const freshSupervisor = new OrchestratorSupervisor({
        resolveConfig: () => ({ workspaceId: 'w', projectPath: workspacePath } as ResolvedConfig),
      })
      const recent = freshSupervisor.recent('w', 200, workspacePath)
      expect(recent).toHaveLength(200)
      expect(recent.some(ev => JSON.stringify(ev.event).includes('event 1204'))).toBe(true)
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })
})
