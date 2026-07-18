import { EventEmitter } from 'node:events'
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import type { BackendEvent } from '@guildhall/backend-host'
import { resolveConfig } from '@guildhall/config'
import type { ResolvedConfig } from '@guildhall/config'
import { emitProjectSummaryInvalidation, getProjectRecentEventsPath, getProjectStateDir, getProjectSystemStatePath } from '@guildhall/sessions'
import { runOrchestrator } from './orchestrator.js'
import type { OrchestratorRunResult } from './orchestrator.js'
import { readProjectSummaryProjection, updateProjectSummaryProjection } from './project-summary-projection.js'
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
  /** When stop was requested; used to recover stale stopping state. */
  stopRequestedAt?: string
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
const PERSISTED_EVENT_BYTE_LIMIT = 512 * 1024
const PERSISTED_EVENT_READ_BYTES = PERSISTED_EVENT_BYTE_LIMIT
const PERSISTED_EVENT_TEXT_LIMIT = 600
const PERSISTED_EVENT_PAGE_LIMIT = 100
const PERSISTED_EVENT_INDEX_VERSION = 1
const PERSISTED_EVENT_INDEX_CHUNK_BYTES = 64 * 1024
const PERSISTED_EVENT_INDEX_MAX_LINE_BYTES = PERSISTED_EVENT_BYTE_LIMIT
// A worker turn must eventually hand control back to the orchestrator even
// when it keeps emitting tool events without changing durable task state.
const DEFAULT_WORKER_TURN_WALL_CLOCK_TIMEOUT_MS = 2 * 60 * 1000

type RunOrchestratorFn = typeof runOrchestrator
type ResolveConfigFn = (opts: { workspacePath: string }) => ResolvedConfig

function persistedEventPath(workspacePath: string): string {
  return getProjectRecentEventsPath(workspacePath)
}

function persistedEventIndexPath(file: string): string {
  return `${file}.index.json`
}

interface PersistedEventIndexRecord {
  offset: number
  bytes: number
  workspaceId: string
}

interface PersistedEventIndex {
  version: typeof PERSISTED_EVENT_INDEX_VERSION
  fileSize: number
  modifiedAt: number
  records: PersistedEventIndexRecord[]
}

function readPersistedEventIndex(file: string, expectedSize: number, expectedModifiedAt: number): PersistedEventIndex | null {
  try {
    const parsed = JSON.parse(readFileSync(persistedEventIndexPath(file), 'utf8')) as Partial<PersistedEventIndex>
    if (
      parsed.version !== PERSISTED_EVENT_INDEX_VERSION ||
      parsed.fileSize !== expectedSize ||
      parsed.modifiedAt !== expectedModifiedAt ||
      !Array.isArray(parsed.records)
    ) return null
    const records = parsed.records.filter((record): record is PersistedEventIndexRecord => (
      !!record &&
      typeof record === 'object' &&
      typeof record.offset === 'number' && Number.isSafeInteger(record.offset) && record.offset >= 0 &&
      typeof record.bytes === 'number' && Number.isSafeInteger(record.bytes) && record.bytes > 0 &&
      typeof record.workspaceId === 'string'
    ))
    return records.length === parsed.records.length
      ? { version: PERSISTED_EVENT_INDEX_VERSION, fileSize: expectedSize, modifiedAt: expectedModifiedAt, records }
      : null
  } catch {
    return null
  }
}

function invalidatePersistedEventIndex(file: string): void {
  try {
    unlinkSync(persistedEventIndexPath(file))
  } catch {
    /* The index is a rebuildable cache; it may not exist yet. */
  }
}

function persistPersistedEventIndex(file: string, index: PersistedEventIndex): void {
  const indexPath = persistedEventIndexPath(file)
  const temporaryPath = `${indexPath}.${process.pid}.tmp`
  writeFileSync(temporaryPath, JSON.stringify(index), 'utf8')
  renameSync(temporaryPath, indexPath)
}

function scanPersistedEventIndex(file: string, fileSize: number, modifiedAt: number): PersistedEventIndex {
  const records: PersistedEventIndexRecord[] = []
  const fd = openSync(file, 'r')
  let fileOffset = 0
  let pending = Buffer.alloc(0)
  let pendingOffset = 0
  const chunk = Buffer.alloc(PERSISTED_EVENT_INDEX_CHUNK_BYTES)

  const acceptLine = (line: Buffer, offset: number, bytes: number): void => {
    if (line.length === 0 || line.length > PERSISTED_EVENT_INDEX_MAX_LINE_BYTES) return
    try {
      const parsed = JSON.parse(line.toString('utf8')) as Partial<SupervisorEvent>
      if (typeof parsed.workspaceId === 'string') {
        records.push({ offset, bytes, workspaceId: parsed.workspaceId })
      }
    } catch {
      /* skip malformed historical lines */
    }
  }

  const consumeCompleteLines = (): void => {
    let newline = pending.indexOf(0x0a)
    while (newline >= 0) {
      const line = pending.subarray(0, newline)
      acceptLine(line, pendingOffset, newline + 1)
      pending = pending.subarray(newline + 1)
      pendingOffset += newline + 1
      newline = pending.indexOf(0x0a)
    }
  }

  try {
    while (fileOffset < fileSize) {
      const chunkOffset = fileOffset
      const readBytes = readSync(fd, chunk, 0, Math.min(chunk.length, fileSize - fileOffset), fileOffset)
      if (readBytes <= 0) break
      if (pending.length === 0) pendingOffset = chunkOffset
      pending = pending.length === 0
        ? Buffer.from(chunk.subarray(0, readBytes))
        : Buffer.concat([pending, chunk.subarray(0, readBytes)])
      fileOffset += readBytes
      consumeCompleteLines()
      // A malformed or legacy oversized record must not make index creation
      // retain an unbounded line while waiting for its newline.
      if (pending.length > PERSISTED_EVENT_INDEX_MAX_LINE_BYTES) {
        const newline = pending.indexOf(0x0a)
        if (newline >= 0) {
          pending = pending.subarray(newline + 1)
          pendingOffset += newline + 1
        } else {
          pending = Buffer.alloc(0)
          pendingOffset = fileOffset
        }
      }
    }
    if (pending.length > 0) acceptLine(pending, pendingOffset, pending.length)
  } finally {
    closeSync(fd)
  }

  return { version: PERSISTED_EVENT_INDEX_VERSION, fileSize, modifiedAt, records }
}

function ensurePersistedEventIndex(file: string): PersistedEventIndex {
  const stats = statSync(file)
  const cached = readPersistedEventIndex(file, stats.size, stats.mtimeMs)
  if (cached) return cached
  const index = scanPersistedEventIndex(file, stats.size, stats.mtimeMs)
  try {
    persistPersistedEventIndex(file, index)
  } catch {
    // The index is an optimization. A read must remain useful if its cache
    // cannot be written (for example, a read-only history directory).
  }
  return index
}

function readIndexedPersistedEvent(file: string, record: PersistedEventIndexRecord): SupervisorEvent | null {
  const fd = openSync(file, 'r')
  try {
    const buffer = Buffer.alloc(record.bytes)
    const bytesRead = readSync(fd, buffer, 0, record.bytes, record.offset)
    if (bytesRead !== record.bytes) return null
    const line = buffer[record.bytes - 1] === 0x0a ? buffer.subarray(0, record.bytes - 1) : buffer
    const parsed = JSON.parse(line.toString('utf8')) as SupervisorEvent
    return parsed
  } catch {
    return null
  } finally {
    closeSync(fd)
  }
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
    const events: SupervisorEvent[] = []
    let cursor = 0
    while (events.length < limit) {
      const page = readPersistedEventPage(workspacePath, workspaceId, {
        cursor,
        limit: Math.min(PERSISTED_EVENT_PAGE_LIMIT, limit - events.length),
      })
      events.push(...page.events)
      if (!page.hasMore || page.nextCursor === undefined) break
      cursor = page.nextCursor
    }
    return events.reverse()
  } catch {
    return []
  }
}

export interface PersistedEventPage {
  events: SupervisorEvent[]
  cursor: number
  limit: number
  total: number
  hasMore: boolean
  nextCursor?: number
}

/**
 * Read the bounded durable activity history without touching project state.
 * The cursor is an offset from newest to oldest within the retained history;
 * the retention byte/line caps are deliberately part of this contract.
 */
export function readPersistedEventPage(
  workspacePath: string | undefined,
  workspaceId: string,
  options: { cursor?: number; limit?: number } = {},
): PersistedEventPage {
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? PERSISTED_EVENT_PAGE_LIMIT), 1), PERSISTED_EVENT_PAGE_LIMIT)
  const cursor = Math.max(Math.trunc(options.cursor ?? 0), 0)
  if (!workspacePath) return { events: [], cursor, limit, total: 0, hasMore: false }
  const file = persistedEventPath(workspacePath)
  if (!existsSync(file)) return { events: [], cursor, limit, total: 0, hasMore: false }
  try {
    const index = ensurePersistedEventIndex(file)
    const matchingRecords = index.records.filter(record => record.workspaceId === workspaceId)
    const page: SupervisorEvent[] = []
    for (let pageOffset = 0; pageOffset < limit; pageOffset += 1) {
      const record = matchingRecords[matchingRecords.length - 1 - cursor - pageOffset]
      if (!record) break
      const event = readIndexedPersistedEvent(file, record)
      if (event) page.push(event)
    }
    const recordsInPage = Math.min(limit, Math.max(0, matchingRecords.length - cursor))
    const hasMore = cursor + recordsInPage < matchingRecords.length
    return {
      events: page,
      cursor,
      limit,
      total: matchingRecords.length,
      hasMore,
      ...(hasMore ? { nextCursor: cursor + recordsInPage } : {}),
    }
  } catch {
    return { events: [], cursor, limit, total: 0, hasMore: false }
  }
}

function boundedEventText(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined
  return value.length <= PERSISTED_EVENT_TEXT_LIMIT
    ? value
    : `${value.slice(0, PERSISTED_EVENT_TEXT_LIMIT)}...`
}

/**
 * Persisted reconnect history is a summary stream. The live EventEmitter
 * still receives the complete event; durable history does not retain tool
 * payloads, snapshots, or command output that can grow without bound.
 */
function compactPersistedEvent(event: unknown): unknown {
  // Keep legacy scalar markers readable while still bounding their size.
  // Older migrations wrote simple values such as {"event":"recent"}.
  if (typeof event === 'string') return boundedEventText(event)
  if (!event || typeof event !== 'object' || Array.isArray(event)) return event
  const source = event as Record<string, unknown>
  const compact: Record<string, unknown> = { type: source.type }
  for (const key of [
    'task_id', 'from_status', 'to_status', 'agent_name', 'agentName',
    'tool_name', 'is_error', 'compact_phase', 'compact_trigger', 'attempt',
    'compact_checkpoint', 'plan_mode', 'escalation_id', 'issue_id', 'code',
    'severity', 'provider', 'reason',
  ]) {
    const value = source[key]
    if (value !== undefined && value !== null) compact[key] = value
  }
  for (const key of ['message', 'error']) {
    const value = boundedEventText(source[key])
    if (value) compact[key] = value
  }
  if (source.health && typeof source.health === 'object' && !Array.isArray(source.health)) {
    const health = source.health as Record<string, unknown>
    compact.health = {
      ...(typeof health.state === 'string' ? { state: health.state } : {}),
      ...(typeof health.consecutiveFailures === 'number' ? { consecutiveFailures: health.consecutiveFailures } : {}),
      ...(typeof health.retryableFailures === 'number' ? { retryableFailures: health.retryableFailures } : {}),
      ...(typeof health.lastSuccessAt === 'string' ? { lastSuccessAt: health.lastSuccessAt } : {}),
      ...(typeof health.lastFailureAt === 'string' ? { lastFailureAt: health.lastFailureAt } : {}),
    }
  }
  return compact
}

function trimPersistedEvents(file: string): void {
  const size = statSync(file).size
  const lines = readPersistedEventLines(file)
  if (size <= PERSISTED_EVENT_BYTE_LIMIT && lines.length <= PERSISTED_EVENT_LINE_LIMIT) return
  writeFileSync(file, compactPersistedEventContent(lines), 'utf8')
  invalidatePersistedEventIndex(file)
}

function compactPersistedEventContent(lines: readonly string[]): string {
  const compacted: string[] = []
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as SupervisorEvent
      compacted.push(JSON.stringify({ ...parsed, event: compactPersistedEvent(parsed.event) }))
    } catch {
      // Preserve malformed historical lines until the explicit migration can
      // report them; they still participate in the byte budget below.
      compacted.push(line)
    }
  }
  const kept: string[] = []
  let bytes = 0
  for (let index = compacted.length - 1; index >= 0 && kept.length < PERSISTED_EVENT_LINE_LIMIT; index -= 1) {
    const line = compacted[index]
    if (!line) continue
    const lineBytes = Buffer.byteLength(line, 'utf8') + 1
    if (lineBytes > PERSISTED_EVENT_BYTE_LIMIT) continue
    if (bytes + lineBytes > PERSISTED_EVENT_BYTE_LIMIT) break
    kept.unshift(line)
    bytes += lineBytes
  }
  return kept.length > 0 ? `${kept.join('\n')}\n` : ''
}

export interface RecentEventCompactionResult {
  bytesBefore: number
  bytesAfter: number
  recordsCompacted: number
}

/** Explicit migration boundary for legacy oversized reconnect history. */
export function compactProjectRecentEvents(
  workspacePath: string,
  options: { dryRun?: boolean } = {},
): RecentEventCompactionResult {
  const file = persistedEventPath(workspacePath)
  if (!existsSync(file)) return { bytesBefore: 0, bytesAfter: 0, recordsCompacted: 0 }
  const bytesBefore = statSync(file).size
  const lines = readPersistedEventLines(file)
  const content = compactPersistedEventContent(lines)
  if (options.dryRun !== true && content !== readFileSync(file, 'utf8')) {
    writeFileSync(file, content, 'utf8')
    invalidatePersistedEventIndex(file)
  }
  return {
    bytesBefore,
    bytesAfter: Buffer.byteLength(content, 'utf8'),
    recordsCompacted: lines.length,
  }
}

function writePersistedEvent(workspacePath: string, event: SupervisorEvent): void {
  try {
    const file = persistedEventPath(workspacePath)
    mkdirSync(path.dirname(file), { recursive: true })
    appendFileSync(file, `${JSON.stringify({ ...event, event: compactPersistedEvent(event.event) })}\n`, 'utf8')
    invalidatePersistedEventIndex(file)
    trimPersistedEvents(file)
  } catch {
    /* live UI should keep working even if persistence fails */
  }
}

function updateExecutionProjection(run: Pick<WorkspaceRun, 'workspacePath' | 'status' | 'mode' | 'startedAt' | 'stoppedAt' | 'stopRequestedAt' | 'error'>, updatedAt: string): void {
  updateProjectSummaryProjection(getProjectSystemStatePath(run.workspacePath, 'TASKS.json'), {
    execution: {
      status: run.status,
      mode: run.mode,
      startedAt: run.startedAt,
      stoppedAt: run.stoppedAt ?? null,
      stopRequestedAt: run.stopRequestedAt ?? null,
      error: run.error ?? null,
      updatedAt,
    },
  })
}

/**
 * A supervisor is intentionally in-memory, so a process crash can leave a
 * durable execution row claiming that a run is still live. Recover that state
 * at the explicit service-start boundary, before fleet shells are published.
 * Ordinary summary reads remain read-only and no compatibility file is
 * rewritten.
 */
export function recoverOrphanedExecutionProjection(
  workspacePath: string,
  now = new Date().toISOString(),
): boolean {
  const tasksPath = getProjectSystemStatePath(workspacePath, 'TASKS.json')
  const projection = readProjectSummaryProjection(tasksPath)
  if (!projection) return false
  const execution = projection.execution
  if (!execution || (execution.status !== 'running' && execution.status !== 'stopping')) return false
  const message = execution.status === 'stopping'
    ? 'Guildhall recovered an interrupted stop from a previous service process.'
    : 'Guildhall recovered an interrupted run from a previous service process.'
  updateProjectSummaryProjection(tasksPath, {
    execution: {
      status: 'error',
      ...(execution.mode ? { mode: execution.mode } : {}),
      ...(execution.startedAt ? { startedAt: execution.startedAt } : {}),
      ...(execution.stopRequestedAt ? { stopRequestedAt: execution.stopRequestedAt } : {}),
      stoppedAt: now,
      error: message,
      updatedAt: now,
    },
  })
  return true
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
        emitProjectSummaryInvalidation(run.workspacePath, 'supervisor-event', { domains: ['thread'] })
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

  async forceStopStaleStoppingRun(workspaceId: string, staleMs = 30_000): Promise<boolean> {
    const run = this.runs.get(workspaceId)
    if (!run || run.status !== 'stopping') return false
    const requestedAtMs = run.stopRequestedAt ? Date.parse(run.stopRequestedAt) : Number.NaN
    if (!Number.isFinite(requestedAtMs) || Date.now() - requestedAtMs < staleMs) return false
    await run.processRegistry.shutdownAll()
    run.status = 'stopped'
    run.stoppedAt = new Date().toISOString()
    updateExecutionProjection(run, run.stoppedAt)
    await clearStopRequested(getProjectStateDir(run.workspacePath))
    return true
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
    preferredTaskId?: string
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
    const memoryDir = getProjectStateDir(opts.workspacePath)
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
      emitProjectSummaryInvalidation(opts.workspacePath, 'supervisor-event', { domains: ['thread'] })
      if (event.type === 'supervisor_started' || event.type === 'supervisor_stopped' || event.type === 'supervisor_error') {
        updateExecutionProjection(run, supervisorEv.at)
      }
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
          agentGenerateWallClockTimeoutMs: {
            worker: DEFAULT_WORKER_TURN_WALL_CLOCK_TIMEOUT_MS,
          },
          ...(opts.providerOverride ? { providerOverride: opts.providerOverride } : {}),
          ...(opts.modelAssignmentOverride ? { modelAssignmentOverride: opts.modelAssignmentOverride } : {}),
          ...(opts.stopAfterOneTask ? { stopAfterOneTask: true } : {}),
          ...(opts.preferredTaskId ? { preferredTaskId: opts.preferredTaskId } : {}),
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
    run.stopRequestedAt = new Date().toISOString()
    updateExecutionProjection(run, run.stopRequestedAt)
    run.stopSignal.stopRequested = true
    run.abortController.abort(new DOMException('Stop requested.', 'AbortError'))

    // FR-28: also write the on-disk marker so external observers (a sibling
    // CLI process, a container orchestrator) see the stop request even if
    // they missed the in-memory flag flip.
    void writeStopRequested(getProjectStateDir(run.workspacePath), {
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
      await clearStopRequested(getProjectStateDir(run.workspacePath))
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
