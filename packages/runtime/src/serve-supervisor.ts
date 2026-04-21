import { EventEmitter } from 'node:events'
import type { BackendEvent } from '@guildhall/backend-host'
import { resolveConfig } from '@guildhall/config'
import { runOrchestrator } from './orchestrator.js'

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
  /** The run() promise — resolves when the orchestrator loop exits. */
  runPromise: Promise<void>
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
  type: 'supervisor_started' | 'supervisor_stopped' | 'supervisor_error'
  message?: string
}

const RECENT_EVENT_LIMIT = 200

export class OrchestratorSupervisor {
  private runs = new Map<string, WorkspaceRun>()
  private emitter = new EventEmitter()

  constructor() {
    this.emitter.setMaxListeners(0)
  }

  /** Subscribe to all workspace events. Returns an unsubscribe function. */
  subscribe(listener: (ev: SupervisorEvent) => void): () => void {
    this.emitter.on('event', listener)
    return () => { this.emitter.off('event', listener) }
  }

  /** Snapshot of all runs (for GET /api/workspaces — "is it running?"). */
  list(): Array<Pick<WorkspaceRun, 'workspaceId' | 'startedAt' | 'stoppedAt' | 'status' | 'error'>> {
    return Array.from(this.runs.values()).map(r => ({
      workspaceId: r.workspaceId,
      startedAt: r.startedAt,
      ...(r.stoppedAt ? { stoppedAt: r.stoppedAt } : {}),
      status: r.status,
      ...(r.error ? { error: r.error } : {}),
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
  recent(workspaceId: string, limit = RECENT_EVENT_LIMIT): SupervisorEvent[] {
    const run = this.runs.get(workspaceId)
    if (!run) return []
    return run.recentEvents.slice(-limit)
  }

  /**
   * Boot an orchestrator for the given workspace. Idempotent: if one is
   * already running for this workspace id, returns the existing entry
   * without starting a second loop.
   */
  start(opts: { workspaceId: string; workspacePath: string }): WorkspaceRun {
    const existing = this.runs.get(opts.workspaceId)
    if (existing && (existing.status === 'running' || existing.status === 'stopping')) {
      return existing
    }

    const stopSignal = { stopRequested: false }
    const startedAt = new Date().toISOString()
    const run: WorkspaceRun = {
      workspaceId: opts.workspaceId,
      startedAt,
      status: 'running',
      recentEvents: [],
      stopSignal,
      runPromise: Promise.resolve(),
    }

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
      this.emitter.emit('event', supervisorEv)
    }

    recordAndEmit({ type: 'supervisor_started', message: `Orchestrator started for ${opts.workspaceId}` })

    run.runPromise = (async () => {
      try {
        const config = resolveConfig({ workspacePath: opts.workspacePath })
        await runOrchestrator(config, {
          onBackendEvent: (event) => { recordAndEmit(event) },
          stopSignal,
          tickDelayMs: 2000,
        })
        run.status = 'stopped'
        run.stoppedAt = new Date().toISOString()
        recordAndEmit({ type: 'supervisor_stopped' })
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
  async stop(workspaceId: string, waitMs = 30_000): Promise<boolean> {
    const run = this.runs.get(workspaceId)
    if (!run) return false
    if (run.status !== 'running') return true

    run.status = 'stopping'
    run.stopSignal.stopRequested = true

    const isTerminated = (): boolean => {
      const s: WorkspaceRun['status'] = run.status
      return s === 'stopped' || s === 'error'
    }

    const deadline = Date.now() + waitMs
    while (Date.now() < deadline) {
      if (isTerminated()) return true
      await new Promise(r => setTimeout(r, 250))
    }
    return isTerminated()
  }
}
