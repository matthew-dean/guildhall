import { describe, expect, it, vi } from 'vitest'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { ResolvedConfig } from '@guildhall/config'
import { getProjectRecentEventsPath, getProjectSystemStatePath, promoteProjectStateDatabaseAuthority } from '@guildhall/sessions'
import { OrchestratorSupervisor, compactProjectRecentEvents, readPersistedEventPage, recoverOrphanedExecutionProjection } from '../serve-supervisor.js'
import { readProjectSummaryProjection, updateProjectSummaryProjection, writeProjectSummaryProjectionFromUnknownQueue } from '../project-summary-projection.js'
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
  it('persists only typed live worker ownership and clears it at lifecycle exit', async () => {
    const workspacePath = await mkdtemp(path.join(tmpdir(), 'guildhall-supervisor-active-task-'))
    let letWorkerStartContinue!: () => void
    let letWorkerFinish!: () => void
    const workerStart = new Promise<void>(resolve => { letWorkerStartContinue = resolve })
    const workerFinish = new Promise<void>(resolve => { letWorkerFinish = resolve })
    const supervisor = new OrchestratorSupervisor({
      resolveConfig: () => ({ workspaceId: 'active-task-project', projectPath: workspacePath } as ResolvedConfig),
      runOrchestrator: async (_config, options) => {
        await workerStart
        await options?.onBackendEvent?.({ type: 'agent_started', task_id: 'task-live', task_title: 'Prove live execution identity' })
        await options?.onBackendEvent?.({ type: 'task_transition', task_id: 'task-live', to_status: 'in_progress' })
        await workerFinish
        await options?.onBackendEvent?.({ type: 'agent_finished', task_id: 'task-live' })
        return STOP_SUMMARY
      },
    })
    try {
      const tasksPath = getProjectSystemStatePath(workspacePath, 'TASKS.json')
      writeProjectSummaryProjectionFromUnknownQueue(tasksPath, {
        projectId: 'active-task-project',
        queue: { version: 1, lastUpdated: '2026-07-23T00:00:00.000Z', tasks: [] },
      })
      promoteProjectStateDatabaseAuthority(workspacePath)

      const run = supervisor.start({
        workspaceId: 'active-task-project',
        workspacePath,
        initialActiveTask: {
          id: 'task-live',
          title: 'Prove live execution identity',
        },
      })
      // A named owner start stays oriented before a worker emits its first
      // lifecycle event.
      expect(supervisor.get('active-task-project')?.activeTaskId).toBe('task-live')
      expect(readProjectSummaryProjection(tasksPath)?.execution).toMatchObject({
        status: 'running',
        activeTaskId: 'task-live',
        activeTaskTitle: 'Prove live execution identity',
      })
      letWorkerStartContinue()
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(supervisor.get('active-task-project')?.activeTaskId).toBe('task-live')
      expect(supervisor.get('active-task-project')?.activeTaskTitle).toBe('Prove live execution identity')
      expect(readProjectSummaryProjection(tasksPath)?.execution).toMatchObject({
        status: 'running',
        activeTaskId: 'task-live',
        activeTaskTitle: 'Prove live execution identity',
      })

      letWorkerFinish()
      await run.runPromise
      expect(supervisor.get('active-task-project')?.activeTaskId).toBeUndefined()
      expect(supervisor.get('active-task-project')?.activeTaskTitle).toBeUndefined()
      expect(readProjectSummaryProjection(tasksPath)?.execution).toMatchObject({ status: 'stopped' })
      expect(readProjectSummaryProjection(tasksPath)?.execution).not.toHaveProperty('activeTaskId')
      expect(readProjectSummaryProjection(tasksPath)?.execution).not.toHaveProperty('activeTaskTitle')
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  it('recovers a durable run left behind by a crashed service process', async () => {
    const workspacePath = await mkdtemp(path.join(tmpdir(), 'guildhall-supervisor-recovery-'))
    try {
      const tasksPath = getProjectSystemStatePath(workspacePath, 'TASKS.json')
      writeProjectSummaryProjectionFromUnknownQueue(tasksPath, {
        projectId: 'recovery-project',
        queue: { version: 1, lastUpdated: '2026-07-17T00:00:00.000Z', tasks: [] },
      })
      promoteProjectStateDatabaseAuthority(workspacePath)
      updateProjectSummaryProjection(tasksPath, {
        execution: {
          status: 'running',
          mode: 'continuous',
          startedAt: '2026-07-17T00:00:00.000Z',
          updatedAt: '2026-07-17T00:01:00.000Z',
        },
      })

      expect(recoverOrphanedExecutionProjection(workspacePath, '2026-07-17T00:02:00.000Z')).toBe(true)
      expect(recoverOrphanedExecutionProjection(workspacePath, '2026-07-17T00:03:00.000Z')).toBe(false)

      expect(readProjectSummaryProjection(tasksPath)?.execution).toMatchObject({
        status: 'error',
        startedAt: '2026-07-17T00:00:00.000Z',
        stoppedAt: '2026-07-17T00:02:00.000Z',
        error: 'Guildhall recovered an interrupted run from a previous service process.',
      })
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  it('pages bounded durable activity newest-first', async () => {
    const workspacePath = await mkdtemp(path.join(tmpdir(), 'guildhall-supervisor-history-'))
    try {
      const file = getProjectRecentEventsPath(workspacePath)
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file, [1, 2, 3].map(index => JSON.stringify({
        at: `2026-07-14T00:00:0${index}.000Z`,
        workspaceId: 'history-project',
        event: { type: 'task_transition', task_id: `task-${index}`, message: 'x'.repeat(10_000) },
      })).join('\n') + '\n', 'utf8')

      const first = readPersistedEventPage(workspacePath, 'history-project', { limit: 2 })
      expect(first.events.map(event => (event.event as { task_id?: string }).task_id)).toEqual(['task-3', 'task-2'])
      expect(first).toMatchObject({ cursor: 0, limit: 2, total: 3, hasMore: true, nextCursor: 2 })

      const second = readPersistedEventPage(workspacePath, 'history-project', { limit: 2, cursor: first.nextCursor })
      expect(second.events.map(event => (event.event as { task_id?: string }).task_id)).toEqual(['task-1'])
      expect(second.hasMore).toBe(false)
      expect(JSON.stringify(first)).toContain('x'.repeat(10_000))
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  it('caps worst-case history pages and keeps the durable index payload-free', async () => {
    const workspacePath = await mkdtemp(path.join(tmpdir(), 'guildhall-supervisor-history-index-'))
    try {
      const file = getProjectRecentEventsPath(workspacePath)
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file, Array.from({ length: 1000 }, (_, index) => JSON.stringify({
        at: new Date(2026, 0, 1, 0, 0, index % 60).toISOString(),
        workspaceId: 'history-project',
        event: {
          type: 'task_transition',
          task_id: `task-${index}`,
          message: `synthetic retained history payload ${index} ${'x'.repeat(180)}`,
        },
      })).join('\n') + '\n', 'utf8')

      const requestedTooMuch = readPersistedEventPage(workspacePath, 'history-project', { limit: 1000 })
      expect(requestedTooMuch.limit).toBe(100)
      expect(requestedTooMuch.events).toHaveLength(100)
      expect(requestedTooMuch.total).toBe(1000)
      expect(requestedTooMuch.events[0]?.event).toMatchObject({ task_id: 'task-999' })

      const index = JSON.parse(await readFile(`${file}.index.json`, 'utf8')) as {
        records: Array<Record<string, unknown>>
      }
      expect(index.records).toHaveLength(1000)
      expect(JSON.stringify(index)).not.toContain('synthetic retained history payload')

      const deepPage = readPersistedEventPage(workspacePath, 'history-project', { cursor: 900, limit: 100 })
      expect(deepPage.events).toHaveLength(100)
      expect(deepPage.events[0]?.event).toMatchObject({ task_id: 'task-99' })
      expect(deepPage.events.at(-1)?.event).toMatchObject({ task_id: 'task-0' })
      expect(deepPage.hasMore).toBe(false)
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

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
    let seenWorkerTurnBudget: number | undefined
    const supervisor = new OrchestratorSupervisor({
      resolveConfig: () => ({ workspaceId: 'w', projectPath: workspacePath } as ResolvedConfig),
      runOrchestrator: async (_config, opts) => {
        seenStopAfterOneTask = opts?.stopAfterOneTask
        const budget = opts?.agentGenerateWallClockTimeoutMs
        if (budget && typeof budget === 'object') seenWorkerTurnBudget = budget.worker
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
      expect(seenWorkerTurnBudget).toBe(2 * 60 * 1000)
      expect(run.stopSummary?.stopReason).toBe('one_task')
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  it('clears prior execution residue when a new run starts', async () => {
    const workspacePath = await mkdtemp(path.join(tmpdir(), 'guildhall-supervisor-'))
    try {
      const tasksPath = getProjectSystemStatePath(workspacePath, 'TASKS.json')
      writeProjectSummaryProjectionFromUnknownQueue(tasksPath, {
        projectId: 'w',
        queue: { version: 1, lastUpdated: '2026-07-17T00:00:00.000Z', tasks: [] },
      })
      promoteProjectStateDatabaseAuthority(workspacePath)
      updateProjectSummaryProjection(tasksPath, {
        execution: {
          status: 'error',
          mode: 'one_task',
          startedAt: '2026-07-17T00:00:00.000Z',
          stoppedAt: '2026-07-17T00:01:00.000Z',
          stopRequestedAt: '2026-07-17T00:00:30.000Z',
          error: 'stale execution error',
          updatedAt: '2026-07-17T00:01:00.000Z',
        },
      })
      const supervisor = new OrchestratorSupervisor({
        resolveConfig: () => ({ workspaceId: 'w', projectPath: workspacePath } as ResolvedConfig),
        runOrchestrator: async (_config, opts) => {
          await new Promise<void>((resolve) => opts?.abortSignal?.addEventListener('abort', () => resolve(), { once: true }))
          return { ...STOP_SUMMARY, stopReason: 'stop_requested', stopMessage: 'Stop requested.' }
        },
      })

      const run = supervisor.start({ workspaceId: 'w', workspacePath })
      await vi.waitFor(() => {
        const execution = readProjectSummaryProjection(tasksPath)?.execution
        expect(execution?.status).toBe('running')
        expect(execution?.error).toBeUndefined()
        expect(execution?.stoppedAt).toBeUndefined()
        expect(execution?.stopRequestedAt).toBeUndefined()
      })
      await supervisor.stop('w', { waitMs: 500 })
      await run.runPromise
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
            draftReview: 0,
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

  it('can force-clear stale stopping state after the stop grace window expires', async () => {
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

      const stopped = await supervisor.stop('w', { waitMs: 1, reason: 'test' })
      expect(stopped).toBe(false)
      expect(run.status).toBe('stopping')

      const tooEarly = await supervisor.forceStopStaleStoppingRun('w', 30_000)
      expect(tooEarly).toBe(false)
      expect(run.status).toBe('stopping')

      run.stopRequestedAt = new Date(Date.now() - 31_000).toISOString()
      const forced = await supervisor.forceStopStaleStoppingRun('w', 30_000)
      expect(forced).toBe(true)
      expect(run.status).toBe('stopped')
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  it('trims persisted recent events so reconnect hydration stays bounded', async () => {
    const workspacePath = await mkdtemp(path.join(tmpdir(), 'guildhall-supervisor-'))
    process.env.GUILDHALL_DATA_DIR = path.join(workspacePath, '.guildhall-data')
    const supervisor = new OrchestratorSupervisor({
      resolveConfig: () => ({ workspaceId: 'w', projectPath: workspacePath } as ResolvedConfig),
      runOrchestrator: async (_config, opts) => {
        for (let i = 0; i < 1205; i++) {
          await opts?.onBackendEvent?.({
            type: 'line_complete',
            task_id: `task-${i}`,
            message: `event ${i}`,
            output: i === 1204 ? 'provider output that must not become durable reconnect history'.repeat(10_000) : undefined,
          })
        }
        return STOP_SUMMARY
      },
    })

    try {
      const run = supervisor.start({ workspaceId: 'w', workspacePath })
      await run.runPromise

      await expect(
        readFile(path.join(workspacePath, 'memory', 'recent-events.jsonl'), 'utf8'),
      ).rejects.toThrow()
      const raw = await readFile(getProjectRecentEventsPath(workspacePath), 'utf8')
      const lines = raw.trim().split('\n')
      expect(lines.length).toBeLessThanOrEqual(1000)
      expect(Buffer.byteLength(raw, 'utf8')).toBeLessThanOrEqual(512 * 1024)
      expect(raw).not.toContain('provider output that must not become durable reconnect history')

      const freshSupervisor = new OrchestratorSupervisor({
        resolveConfig: () => ({ workspaceId: 'w', projectPath: workspacePath } as ResolvedConfig),
      })
      const recent = freshSupervisor.recent('w', 200, workspacePath)
      expect(recent).toHaveLength(200)
      expect(recent.some(ev => JSON.stringify(ev.event).includes('event 1204'))).toBe(true)
    } finally {
      delete process.env.GUILDHALL_DATA_DIR
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  it('compacts legacy reconnect payloads at the explicit migration boundary', async () => {
    const workspacePath = await mkdtemp(path.join(tmpdir(), 'guildhall-supervisor-legacy-'))
    process.env.GUILDHALL_DATA_DIR = path.join(workspacePath, '.guildhall-data')
    const file = getProjectRecentEventsPath(workspacePath)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, Array.from({ length: 4 }, (_, index) => JSON.stringify({
      at: new Date(2026, 0, 1, 0, index).toISOString(),
      workspaceId: 'w',
      event: {
        type: 'tool_completed',
        task_id: `task-${index}`,
        output: 'legacy provider output '.repeat(40_000),
      },
    })).join('\n') + '\n', 'utf8')

    try {
      const result = compactProjectRecentEvents(workspacePath, { dryRun: false })
      const compacted = await readFile(file, 'utf8')
      expect(result.bytesBefore).toBeGreaterThan(512 * 1024)
      expect(result.bytesAfter).toBeLessThanOrEqual(512 * 1024)
      expect(compacted).not.toContain('legacy provider output')
    } finally {
      delete process.env.GUILDHALL_DATA_DIR
      await rm(workspacePath, { recursive: true, force: true })
    }
  })
})
