import { EventEmitter } from 'node:events'
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import type { BackendEvent } from '@guildhall/backend-host'
import { resolveConfig } from '@guildhall/config'
import type { ResolvedConfig } from '@guildhall/config'
import { runOrchestrator } from './orchestrator.js'
import type { OrchestratorRunResult } from './orchestrator.js'
import { subscribeProviderClientHealth, type ProviderClientHealthSnapshot } from './provider-client-pool.js'
import {
  ProcessRegistry,
  writeStopRequested,
  clearStopRequested,
} from './stop-requested.js'

// ---------------------------------------------------------------------------
// Serve-side orchestrator supervisor
//
// The `guildhall serve` process is a long-lived web server. When the user
// clicks "Start" in the dashboard, this supervisor boots an in-process
// orchestrator for that workspace, wires the orchestrator's `onBackendEvent`
// callback into an EventEmitter, and keeps a rolling log of recent events
// so the dashboard can show a history on reconnect.
//
// Only one orchestrator per workspace id at a time. Start is idempotent —
// calling start on an already-running workspace returns the running entry.
// ---------------------------------------------------------------------------

export interface WorkspaceRun {
  workspaceId: string
  startedAt: string
  stoppedAt?: string
  status: 'running' | 'stopping' | 'stopped' | 'error'
  error?: string
  /** Ring buffer of recent events for reconnect-hydration. */
  recentEvents: SupervisorEvent[]
  /** Orchestrator's own stop-signal handle; supervisor flips it on stop(). */
  stopSignal: { stopRequested: boolean }
  /** Interrupts an in-flight provider request while a tick is active. */
  abortController: AbortController
  /** The run() promise — resolves when the orchestrator loop exits. */
  runPromise: Promise<void>
  /**
   * FR-28: child processes this orchestrator owns (future out-of-process
   * workers per FR-24, hook subprocesses, etc.). Cleaned up on stop.
   */
  processRegistry: ProcessRegistry
  /** Absolute path to the workspace — so `stop()` can write the marker. */
  workspacePath: string
  /** Dashboard/CLI run mode for operator-visible posture. */
  mode: 'continuous' | 'one_task'
  stopSummary?: OrchestratorRunResult
  /** Provider selected by start preflight for this run. */
  providerStatus?: ProviderRunStatus
  providerHealthKey?: string
}

export interface ProviderRunStatus {
  health?: {
    pooled: boolean
    state: 'idle' | 'healthy' | 'degraded'
    lastUsedAt?: string
    lastSuccessAt?: string
    lastFailureAt?: string
    consecutiveFailures: number
    retryableFailures: number
    fatalFailures: number
    lastError?: string
  } | null
  decisions?: Array<{
    code: string
    severity: 'info' | 'warn' | 'error'
    basis: 'availability' | 'capability' | 'compatibility'
    message: string
  }>
  laneConcurrency?: {
    spec: {
      requested: number
      effective: number
      recommended: number | null
      clamped: boolean
    }
    worker: {
      requested: number
      effective: number
      recommended: number | null
      clamped: boolean
    }
    review: {
      requested: number
      effective: number
      recommended: number | null
      clamped: boolean
    }
    coordinator: {
      requested: number
      effective: number
      recommended: number | null
      clamped: boolean
    }
    reviewerFanout: {
      requested: number
      effective: number
      recommended: number | null
      clamped: boolean
    }
  }
  preferredCapabilities?: {
    streaming: boolean
    toolCalls: boolean
    resumableSessions: boolean
    reasoningSideChannel: 'none' | 'compatible'
    browserAppControl: boolean
    recommendedConcurrency: number
    localServer: boolean
  } | null
  preferredProvider?: string
  preferredProviderFamily?: string | null
  preferredProviderLabel?: string | null
  activeProvider: string
  activeCapabilities?: {
    streaming: boolean
    toolCalls: boolean
    resumableSessions: boolean
    reasoningSideChannel: 'none' | 'compatible'
    browserAppControl: boolean
    recommendedConcurrency: number
    localServer: boolean
  } | null
  activeProviderFamily?: string | null
  activeProviderLabel?: string | null
  warnings?: Array<{
    code: string
    severity: 'info' | 'warn' | 'error'
    message: string
  }>
  fallback: boolean
  allowPaidProviderFallback?: boolean
  selectedAt: string
  reason?: string
  activeModel?: string
  models?: ResolvedConfig['models']
}

export interface SupervisorEvent {
  /** ISO timestamp the supervisor observed this event at. */
  at: string
  workspaceId: string
  event: BackendEvent | SupervisorLifecycleEvent
}

/**
 * Events the supervisor itself emits (start / stop / error). Shaped like
 * BackendEvent's less-common fields so the dashboard renderer can treat
 * them uniformly.
 */
export interface SupervisorLifecycleEvent {
  type: 'supervisor_started' | 'supervisor_stopped' | 'supervisor_error' | 'provider_health_changed'
  message?: string
  reason?: string
  provider?: string
  health?: ProviderClientHealthSnapshot
}

const RECENT_EVENT_LIMIT = 200
const PERSISTED_EVENT_LINE_LIMIT = RECENT_EVENT_LIMIT * 5
const PERSISTED_EVENT_READ_BYTES = 512 * 1024
const PERSISTED_EVENT_FILE = 'recent-events.jsonl'

type RunOrchestratorFn = typeof runOrchestrator
type ResolveConfigFn = (opts: { workspacePath: string }) => ResolvedConfig

function persistedEventPath(workspacePath: string): string {
  return path.join(workspacePath, 'memory', PERSISTED_EVENT_FILE)
}

function readPersistedEventLines(file: string): string[] {
  const size = statSync(file).size
  if (size <= PERSISTED_EVENT_READ_BYTES) {
    return readFileSync(file, 'utf8').trim().split('\n').filter(Boolean)
  }

  const fd = openSync(file, 'r')
  try {
    const start = Math.max(0, size - PERSISTED_EVENT_READ_BYTES)
    const buffer = Buffer.alloc(size - start)
    readSync(fd, buffer, 0, buffer.length, start)
    const text = buffer.toString('utf8')
    const lines = text.split('\n').filter(Boolean)
    // If we started mid-line, discard the first partial record.
    return start > 0 ? lines.slice(1) : lines
  } finally {
    closeSync(fd)
  }
}

function readPersistedEvents(
  workspacePath: string | undefined,
  workspaceId: string,
  limit = RECENT_EVENT_LIMIT,
): SupervisorEvent[] {
  if (!workspacePath) return []
  const file = persistedEventPath(workspacePath)
  if (!existsSync(file)) return []
  try {
    const lines = readPersistedEventLines(file).slice(-limit * 2)
    const events: SupervisorEvent[] = []
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as SupervisorEvent
        if (parsed.workspaceId === workspaceId) events.push(parsed)
      } catch {
        /* skip malformed historical lines */
      }
    }
    return events.slice(-limit)
  } catch {
    return []
  }
}

function trimPersistedEvents(file: string): void {
  const lines = readPersistedEventLines(file)
  if (lines.length <= PERSISTED_EVENT_LINE_LIMIT) return
  writeFileSync(file, `${lines.slice(-PERSISTED_EVENT_LINE_LIMIT).join('\n')}\n`, 'utf8')
}

function writePersistedEvent(workspacePath: string, event: SupervisorEvent): void {
  try {
    const file = persistedEventPath(workspacePath)
    mkdirSync(path.dirname(file), { recursive: true })
    appendFileSync(file, `${JSON.stringify(event)}\n`, 'utf8')
    trimPersistedEvents(file)
  } catch {
    /* live UI should keep working even if persistence fails */
  }
}

export class OrchestratorSupervisor {
  private runs = new Map<string, WorkspaceRun>()
  private emitter = new EventEmitter()
  private readonly runOrchestratorImpl: RunOrchestratorFn
  private readonly resolveConfigImpl: ResolveConfigFn

  constructor(opts: {
    runOrchestrator?: RunOrchestratorFn
    resolveConfig?: ResolveConfigFn
  } = {}) {
    this.emitter.setMaxListeners(0)
    this.runOrchestratorImpl = opts.runOrchestrator ?? runOrchestrator
    this.resolveConfigImpl = opts.resolveConfig ?? resolveConfig
    subscribeProviderClientHealth((event) => {
      for (const run of this.runs.values()) {
        if (run.providerHealthKey !== event.key) continue
        if (run.providerStatus) run.providerStatus.health = event.snapshot
        const supervisorEv: SupervisorEvent = {
          at: new Date().toISOString(),
          workspaceId: run.workspaceId,
          event: {
            type: 'provider_health_changed',
            message:
              `${run.providerStatus?.activeProviderLabel ?? run.providerStatus?.activeProvider ?? 'Provider'} is now ${event.snapshot.state}` +
              `${event.snapshot.lastError ? ` (${event.snapshot.lastError})` : ''}`,
            provider: run.providerStatus?.activeProvider,
            health: event.snapshot,
          },
        }
        run.recentEvents.push(supervisorEv)
        if (run.recentEvents.length > RECENT_EVENT_LIMIT) {
          run.recentEvents.splice(0, run.recentEvents.length - RECENT_EVENT_LIMIT)
        }
        writePersistedEvent(run.workspacePath, supervisorEv)
        this.emitter.emit('event', supervisorEv)
      }
    })
  }

  /** Subscribe to all workspace events. Returns an unsubscribe function. */
  subscribe(listener: (ev: SupervisorEvent) => void): () => void {
    this.emitter.on('event', listener)
    return () => { this.emitter.off('event', listener) }
  }

  /** Snapshot of all runs (for GET /api/workspaces — "is it running?"). */
  list(): Array<Pick<WorkspaceRun, 'workspaceId' | 'startedAt' | 'stoppedAt' | 'status' | 'error' | 'providerStatus' | 'stopSummary'>> {
    return Array.from(this.runs.values()).map(r => ({
      workspaceId: r.workspaceId,
      startedAt: r.startedAt,
      ...(r.stoppedAt ? { stoppedAt: r.stoppedAt } : {}),
      status: r.status,
      ...(r.error ? { error: r.error } : {}),
      ...(r.stopSummary ? { stopSummary: r.stopSummary } : {}),
      ...(r.providerStatus ? { providerStatus: r.providerStatus } : {}),
    }))
  }

  /** Detail for a single workspace. */
  get(workspaceId: string): WorkspaceRun | undefined {
    return this.runs.get(workspaceId)
  }

  /**
   * Recent events for a given workspace id. Dashboards call this on
   * reconnect so the user doesn't see an empty feed.
   */
  recent(workspaceId: string, limit = RECENT_EVENT_LIMIT, workspacePath?: string): SupervisorEvent[] {
    const run = this.runs.get(workspaceId)
    if (!run) return readPersistedEvents(workspacePath, workspaceId, limit)
    return run.recentEvents.slice(-limit)
  }

  /**
   * Boot an orchestrator for the given workspace. Idempotent: if one is
   * already running for this workspace id, returns the existing entry
   * without starting a second loop.
   */
  start(opts: {
    workspaceId: string
    workspacePath: string
    stopAfterOneTask?: boolean
    providerStatus?: ProviderRunStatus
    providerHealthKey?: string
    providerOverride?: string
    modelAssignmentOverride?: ResolvedConfig['models']
  }): WorkspaceRun {
    const existing = this.runs.get(opts.workspaceId)
    if (existing && (existing.status === 'running' || existing.status === 'stopping')) {
      return existing
    }

    const stopSignal = { stopRequested: false }
    const abortController = new AbortController()
    const startedAt = new Date().toISOString()
    const run: WorkspaceRun = {
      workspaceId: opts.workspaceId,
      startedAt,
      status: 'running',
      recentEvents: readPersistedEvents(opts.workspacePath, opts.workspaceId, RECENT_EVENT_LIMIT),
      stopSignal,
      abortController,
      runPromise: Promise.resolve(),
      processRegistry: new ProcessRegistry(),
      workspacePath: opts.workspacePath,
      mode: opts.stopAfterOneTask ? 'one_task' : 'continuous',
      ...(opts.providerStatus ? { providerStatus: opts.providerStatus } : {}),
      ...(opts.providerHealthKey ? { providerHealthKey: opts.providerHealthKey } : {}),
    }
    // Clear any stale marker from a previous run so a brand-new orchestrator
    // doesn't stop on its first tick.
    const memoryDir = path.join(opts.workspacePath, 'memory')
    void clearStopRequested(memoryDir)

    const recordAndEmit = (event: BackendEvent | SupervisorLifecycleEvent): void => {
      const supervisorEv: SupervisorEvent = {
        at: new Date().toISOString(),
        workspaceId: opts.workspaceId,
        event,
      }
      run.recentEvents.push(supervisorEv)
      if (run.recentEvents.length > RECENT_EVENT_LIMIT) {
        run.recentEvents.splice(0, run.recentEvents.length - RECENT_EVENT_LIMIT)
      }
      writePersistedEvent(opts.workspacePath, supervisorEv)
      this.emitter.emit('event', supervisorEv)
    }

    recordAndEmit({ type: 'supervisor_started', message: `Orchestrator started for ${opts.workspaceId}` })

    run.runPromise = (async () => {
      try {
        const config = this.resolveConfigImpl({ workspacePath: opts.workspacePath })
        const result = await this.runOrchestratorImpl(config, {
          onBackendEvent: (event) => { recordAndEmit(event) },
          stopSignal,
          abortSignal: abortController.signal,
          tickDelayMs: 2000,
          ...(opts.providerOverride ? { providerOverride: opts.providerOverride } : {}),
          ...(opts.modelAssignmentOverride ? { modelAssignmentOverride: opts.modelAssignmentOverride } : {}),
          ...(opts.stopAfterOneTask ? { stopAfterOneTask: true } : {}),
        })
        run.stopSummary = result
        run.status = 'stopped'
        run.stoppedAt = new Date().toISOString()
        recordAndEmit({
          type: 'supervisor_stopped',
          reason: result.stopReason,
          message: result.stopMessage,
        })
      } catch (err) {
        run.status = 'error'
        run.error = err instanceof Error ? err.message : String(err)
        run.stoppedAt = new Date().toISOString()
        recordAndEmit({ type: 'supervisor_error', message: run.error })
      }
    })()

    this.runs.set(opts.workspaceId, run)
    return run
  }

  /**
   * Request a graceful stop. Sets the stop signal; the orchestrator loop
   * honors it between ticks. Resolves when the run has fully stopped.
   */
  async stop(
    workspaceId: string,
    opts: { waitMs?: number; reason?: string } = {},
  ): Promise<boolean> {
    const waitMs = opts.waitMs ?? 30_000
    const run = this.runs.get(workspaceId)
    if (!run) return false
    if (run.status === 'stopped' || run.status === 'error') return true
    if (run.status === 'stopping') return false

    run.status = 'stopping'
    run.stopSignal.stopRequested = true
    run.abortController.abort(new DOMException('Stop requested.', 'AbortError'))

    // FR-28: also write the on-disk marker so external observers (a sibling
    // CLI process, a container orchestrator) see the stop request even if
    // they missed the in-memory flag flip.
    void writeStopRequested(path.join(run.workspacePath, 'memory'), {
      requestedAt: new Date().toISOString(),
      requestedBy: 'supervisor',
      ...(opts.reason ? { reason: opts.reason } : {}),
    })

    const isTerminated = (): boolean => {
      const s: WorkspaceRun['status'] = run.status
      return s === 'stopped' || s === 'error'
    }

    const deadline = Date.now() + waitMs
    while (Date.now() < deadline) {
      if (isTerminated()) break
      await new Promise(r => setTimeout(r, 250))
    }

    // Tick drained (or timed out); either way, tear down registered children.
    await run.processRegistry.shutdownAll()

    // Clear the marker on clean exit so the next start() doesn't see it.
    if (isTerminated()) {
      await clearStopRequested(path.join(run.workspacePath, 'memory'))
    }

    return isTerminated()
  }

  /**
   * Stop every running workspace and tear down child processes. Used by
   * the SIGINT/SIGTERM handler in `runServe` — the host is shutting down,
   * so we don't care about leaving individual supervisors runnable.
   */
  async stopAll(opts: { waitMs?: number; reason?: string } = {}): Promise<void> {
    const ids = Array.from(this.runs.keys())
    await Promise.all(ids.map((id) => this.stop(id, opts)))
  }
}
