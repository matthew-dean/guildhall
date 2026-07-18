import { existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'

import { getDataDir } from './paths.js'

export const FLEET_STATE_DATABASE_SCHEMA_VERSION = 1 as const
export const FLEET_STATE_DATABASE_FILE = 'fleet-state.sqlite' as const
export const FLEET_SUMMARY_PROJECTION_TABLE = 'fleet_summary_projection' as const
export const FLEET_SUMMARY_PAYLOAD_MAX_BYTES = 16 * 1024
export const FLEET_SUMMARY_ERROR_MAX_BYTES = 1 * 1024
export const FLEET_SUMMARY_READ_DEFAULT_LIMIT = 100
export const FLEET_SUMMARY_READ_MAX_LIMIT = 1_000

export type FleetSummaryProjectionState = 'current' | 'stale' | 'error' | 'unavailable'

export interface FleetSummaryProjectionSource {
  projectRevision: number | null
  queueRevision: number | null
}

export interface FleetSummaryProjectionWrite {
  projectId: string
  projectPath: string
  sourceProjectRevision: number | null
  sourceQueueRevision: number | null
  refreshedAt?: string
  state: FleetSummaryProjectionState
  payload?: unknown
  error?: string | null
}

export interface FleetSummaryProjectionStaleMark {
  projectId: string
  projectPath: string
  sourceProjectRevision?: number | null
  sourceQueueRevision?: number | null
  markedAt?: string
}

export interface FleetSummaryProjectionErrorMark extends FleetSummaryProjectionStaleMark {
  error: string
}

export type FleetSummaryProjectionInput = FleetSummaryProjectionWrite

export type FleetSummaryProjectionStaleReason =
  | 'project_revision_changed'
  | 'queue_revision_changed'
  | 'source_revision_changed'

export interface FleetSummaryProjection {
  schemaVersion: typeof FLEET_STATE_DATABASE_SCHEMA_VERSION
  projectId: string
  projectPath: string
  sourceProjectRevision: number | null
  sourceQueueRevision: number | null
  refreshedAt: string
  state: FleetSummaryProjectionState
  payload: unknown | null
  payloadBytes: number
  error: string | null
  staleReason?: FleetSummaryProjectionStaleReason
}

export interface FleetSummaryProjectionReadOptions {
  projectIds?: readonly string[]
  limit?: number
  currentRevisions?: FleetSummaryProjectionCurrentRevisions
}

export type FleetSummaryProjectionCurrentRevisions =
  | ReadonlyMap<string, Partial<FleetSummaryProjectionSource>>
  | Readonly<Record<string, Partial<FleetSummaryProjectionSource>>>

export interface FleetSummaryProjectionPage {
  rows: FleetSummaryProjection[]
  hasMore: boolean
  databaseError: string | null
}

interface FleetSummaryProjectionDatabaseRow {
  project_id?: unknown
  project_path?: unknown
  source_project_revision?: unknown
  source_queue_revision?: unknown
  refreshed_at?: unknown
  state?: unknown
  payload_json?: unknown
  payload_length?: unknown
  error_text?: unknown
}

const VALID_STATES = new Set<FleetSummaryProjectionState>([
  'current',
  'stale',
  'error',
  'unavailable',
])

export function fleetStateDatabasePath(): string {
  return join(getDataDir(), FLEET_STATE_DATABASE_FILE)
}

function boundedText(value: unknown, maxBytes: number): string | null {
  if (typeof value !== 'string') return null
  let result = value.trim()
  while (result && Buffer.byteLength(result, 'utf8') > maxBytes) {
    result = result.slice(0, -1)
  }
  return result || null
}

function errorMessage(error: unknown): string {
  return boundedText(error instanceof Error ? error.message : String(error), FLEET_SUMMARY_ERROR_MAX_BYTES)
    ?? 'Unknown fleet projection database error'
}

function validProjectId(value: string): string {
  const projectId = value.trim()
  if (!projectId) throw new TypeError('Fleet projection projectId must not be empty')
  return projectId
}

function validProjectPath(value: string): string {
  const projectPath = value.trim()
  if (!projectPath) throw new TypeError('Fleet projection projectPath must not be empty')
  return projectPath
}

function revision(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError('Fleet projection revisions must be non-negative safe integers or null')
  }
  return value
}

function refreshedAt(value: string | undefined): string {
  const result = value?.trim()
  return result || new Date().toISOString()
}

function serializePayload(value: unknown): { json: string; bytes: number; error: string | null } {
  let serialized: string | undefined
  try {
    serialized = JSON.stringify(value === undefined ? null : value)
  } catch (error) {
    return {
      json: 'null',
      bytes: Buffer.byteLength('null', 'utf8'),
      error: `Fleet summary payload is not serializable: ${errorMessage(error)}`,
    }
  }
  if (serialized === undefined) serialized = 'null'
  const bytes = Buffer.byteLength(serialized, 'utf8')
  if (bytes <= FLEET_SUMMARY_PAYLOAD_MAX_BYTES) return { json: serialized, bytes, error: null }
  return {
    json: 'null',
    bytes: Buffer.byteLength('null', 'utf8'),
    error: `Fleet summary payload exceeds ${FLEET_SUMMARY_PAYLOAD_MAX_BYTES} bytes`,
  }
}

function appendError(existing: string | null, next: string | null): string | null {
  if (!existing) return next
  if (!next) return existing
  return boundedText(`${existing}; ${next}`, FLEET_SUMMARY_ERROR_MAX_BYTES)
}

function openDatabase(readOnly: boolean): DatabaseSync {
  const database = new DatabaseSync(fleetStateDatabasePath(), { readOnly })
  database.exec('PRAGMA busy_timeout = 5000')
  return database
}

function ensureSchema(database: DatabaseSync): void {
  const versionRow = database.prepare('PRAGMA user_version').get() as { user_version?: unknown } | undefined
  const version = Number(versionRow?.user_version ?? 0)
  if (version > FLEET_STATE_DATABASE_SCHEMA_VERSION) {
    throw new Error(`Unsupported fleet state database schema version: ${version}`)
  }
  database.exec(`
    CREATE TABLE IF NOT EXISTS ${FLEET_SUMMARY_PROJECTION_TABLE} (
      project_id TEXT PRIMARY KEY,
      project_path TEXT NOT NULL,
      source_project_revision INTEGER,
      source_queue_revision INTEGER,
      refreshed_at TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('current', 'stale', 'error', 'unavailable')),
      payload_json TEXT NOT NULL,
      error_text TEXT
    );
    CREATE INDEX IF NOT EXISTS fleet_summary_projection_state_idx
      ON ${FLEET_SUMMARY_PROJECTION_TABLE}(state, project_id);
  `)
  if (version !== FLEET_STATE_DATABASE_SCHEMA_VERSION) {
    database.exec(`PRAGMA user_version = ${FLEET_STATE_DATABASE_SCHEMA_VERSION}`)
  }
}

/** Create the machine-level derived store without reading any project state. */
export function ensureFleetStateDatabase(): string {
  const database = openDatabase(false)
  try {
    ensureSchema(database)
    return fleetStateDatabasePath()
  } finally {
    database.close()
  }
}

export const bootstrapFleetStateDatabase = ensureFleetStateDatabase

function normalizeProjectIds(projectIds: readonly string[] | undefined): string[] | undefined {
  if (!projectIds) return undefined
  return [...new Set(projectIds.map(validProjectId))].slice(0, FLEET_SUMMARY_READ_MAX_LIMIT)
}

function readLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return FLEET_SUMMARY_READ_DEFAULT_LIMIT
  return Math.min(FLEET_SUMMARY_READ_MAX_LIMIT, Math.max(1, Math.trunc(value as number)))
}

function currentRevisionFor(
  currentRevisions: FleetSummaryProjectionCurrentRevisions | undefined,
  projectId: string,
): Partial<FleetSummaryProjectionSource> | undefined {
  if (!currentRevisions) return undefined
  if (typeof (currentRevisions as ReadonlyMap<string, Partial<FleetSummaryProjectionSource>>).get === 'function') {
    return (currentRevisions as ReadonlyMap<string, Partial<FleetSummaryProjectionSource>>).get(projectId)
  }
  return (currentRevisions as Readonly<Record<string, Partial<FleetSummaryProjectionSource>>>)[projectId]
}

function readRevision(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

function staleReason(
  source: FleetSummaryProjectionSource,
  current: Partial<FleetSummaryProjectionSource> | undefined,
): FleetSummaryProjectionStaleReason | undefined {
  if (!current) return undefined
  const projectChanged = current.projectRevision !== undefined
    && source.projectRevision !== current.projectRevision
  const queueChanged = current.queueRevision !== undefined
    && source.queueRevision !== current.queueRevision
  if (projectChanged && queueChanged) return 'source_revision_changed'
  if (projectChanged) return 'project_revision_changed'
  if (queueChanged) return 'queue_revision_changed'
  return undefined
}

function decodeRow(
  row: FleetSummaryProjectionDatabaseRow,
  currentRevisions: FleetSummaryProjectionCurrentRevisions | undefined,
): FleetSummaryProjection | null {
  const projectId = typeof row.project_id === 'string' ? row.project_id : null
  if (!projectId) return null

  const projectPath = typeof row.project_path === 'string' ? row.project_path : ''
  const source = {
    projectRevision: readRevision(row.source_project_revision),
    queueRevision: readRevision(row.source_queue_revision),
  }
  const storedState = typeof row.state === 'string' && VALID_STATES.has(row.state as FleetSummaryProjectionState)
    ? row.state as FleetSummaryProjectionState
    : 'error'
  const rawPayload = typeof row.payload_json === 'string' ? row.payload_json : 'null'
  const payloadLength = Number(row.payload_length ?? 0)
  const payloadTooLarge = payloadLength > FLEET_SUMMARY_PAYLOAD_MAX_BYTES
  const payloadBytes = payloadTooLarge
    ? FLEET_SUMMARY_PAYLOAD_MAX_BYTES + 1
    : Buffer.byteLength(rawPayload, 'utf8')
  let payload: unknown | null = null
  let payloadError: string | null = null
  if (payloadTooLarge) {
    payloadError = `Fleet summary payload exceeds ${FLEET_SUMMARY_PAYLOAD_MAX_BYTES} bytes`
  } else {
    try {
      payload = JSON.parse(rawPayload)
    } catch {
      payloadError = 'Fleet summary payload JSON is corrupt'
    }
  }
  const sourceError = storedState === 'error' && row.state !== 'error'
    ? 'Fleet summary row has an invalid state'
    : null
  const error = appendError(
    boundedText(row.error_text, FLEET_SUMMARY_ERROR_MAX_BYTES),
    appendError(sourceError, payloadError),
  )
  const revisionStaleReason = staleReason(source, currentRevisionFor(currentRevisions, projectId))
  const effectiveState = error || revisionStaleReason
    ? error ? 'error' : storedState === 'current' ? 'stale' : storedState
    : storedState

  return {
    schemaVersion: FLEET_STATE_DATABASE_SCHEMA_VERSION,
    projectId,
    projectPath,
    sourceProjectRevision: source.projectRevision,
    sourceQueueRevision: source.queueRevision,
    refreshedAt: typeof row.refreshed_at === 'string' ? row.refreshed_at : '',
    state: effectiveState,
    payload,
    payloadBytes,
    error,
    ...(revisionStaleReason && effectiveState === 'stale' ? { staleReason: revisionStaleReason } : {}),
  }
}

/** Read a bounded page from the derived fleet store; never opens a project DB. */
export function readFleetSummaryProjectionPage(
  options: FleetSummaryProjectionReadOptions = {},
): FleetSummaryProjectionPage {
  const projectIds = normalizeProjectIds(options.projectIds)
  if (projectIds?.length === 0) return { rows: [], hasMore: false, databaseError: null }
  const limit = readLimit(options.limit)
  const databasePath = fleetStateDatabasePath()
  if (!existsSync(databasePath)) return { rows: [], hasMore: false, databaseError: null }

  let database: DatabaseSync | undefined
  try {
    database = openDatabase(true)
    const where = projectIds ? `WHERE project_id IN (${projectIds.map(() => '?').join(', ')})` : ''
    const rows = database.prepare(`
      SELECT project_id, substr(project_path, 1, 4096) AS project_path,
        source_project_revision, source_queue_revision, refreshed_at, state,
        substr(payload_json, 1, ?) AS payload_json,
        length(payload_json) AS payload_length,
        substr(error_text, 1, ?) AS error_text
      FROM ${FLEET_SUMMARY_PROJECTION_TABLE}
      ${where}
      ORDER BY project_id
      LIMIT ?
    `).all(
      FLEET_SUMMARY_PAYLOAD_MAX_BYTES + 1,
      FLEET_SUMMARY_ERROR_MAX_BYTES,
      ...projectIds ?? [],
      limit + 1,
    ) as FleetSummaryProjectionDatabaseRow[]
    const selected = rows.slice(0, limit)
    return {
      rows: selected.flatMap(row => {
        const decoded = decodeRow(row, options.currentRevisions)
        return decoded ? [decoded] : []
      }),
      hasMore: rows.length > limit,
      databaseError: null,
    }
  } catch (error) {
    return { rows: [], hasMore: false, databaseError: errorMessage(error) }
  } finally {
    database?.close()
  }
}

export function readFleetSummaryProjection(
  projectId: string,
  options: Omit<FleetSummaryProjectionReadOptions, 'projectIds' | 'limit'> = {},
): FleetSummaryProjection | null {
  return readFleetSummaryProjectionPage({ ...options, projectIds: [validProjectId(projectId)], limit: 1 }).rows[0] ?? null
}

/** Persist one already-computed fleet shell. This function never discovers project state. */
export function upsertFleetSummaryProjection(input: FleetSummaryProjectionWrite): FleetSummaryProjection {
  const projectId = validProjectId(input.projectId)
  const projectPath = validProjectPath(input.projectPath)
  const payload = serializePayload(input.payload)
  const payloadError = payload.error
  const error = appendError(boundedText(input.error, FLEET_SUMMARY_ERROR_MAX_BYTES), payloadError)
  const database = openDatabase(false)
  try {
    ensureSchema(database)
    database.prepare(`
      INSERT INTO ${FLEET_SUMMARY_PROJECTION_TABLE} (
        project_id, project_path, source_project_revision, source_queue_revision,
        refreshed_at, state, payload_json, error_text
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id) DO UPDATE SET
        project_path = excluded.project_path,
        source_project_revision = excluded.source_project_revision,
        source_queue_revision = excluded.source_queue_revision,
        refreshed_at = excluded.refreshed_at,
        state = excluded.state,
        payload_json = excluded.payload_json,
        error_text = excluded.error_text
    `).run(
      projectId,
      projectPath,
      revision(input.sourceProjectRevision),
      revision(input.sourceQueueRevision),
      refreshedAt(input.refreshedAt),
      payloadError ? 'error' : input.state,
      payload.json,
      error,
    )
  } finally {
    database.close()
  }
  return readFleetSummaryProjection(projectId)!
}

/** Mark a cached row stale without opening or reconstructing the project. */
export function markFleetSummaryProjectionStale(input: FleetSummaryProjectionStaleMark): void {
  const projectId = validProjectId(input.projectId)
  const projectPath = validProjectPath(input.projectPath)
  const database = openDatabase(false)
  try {
    ensureSchema(database)
    database.prepare(`
      INSERT INTO ${FLEET_SUMMARY_PROJECTION_TABLE} (
        project_id, project_path, source_project_revision, source_queue_revision,
        refreshed_at, state, payload_json, error_text
      ) VALUES (?, ?, ?, ?, ?, 'stale', 'null', NULL)
      ON CONFLICT(project_id) DO UPDATE SET
        project_path = excluded.project_path,
        source_project_revision = COALESCE(excluded.source_project_revision, ${FLEET_SUMMARY_PROJECTION_TABLE}.source_project_revision),
        source_queue_revision = COALESCE(excluded.source_queue_revision, ${FLEET_SUMMARY_PROJECTION_TABLE}.source_queue_revision),
        refreshed_at = excluded.refreshed_at,
        state = 'stale',
        error_text = NULL
    `).run(
      projectId,
      projectPath,
      revision(input.sourceProjectRevision),
      revision(input.sourceQueueRevision),
      refreshedAt(input.markedAt),
    )
  } finally {
    database.close()
  }
}

/** Record a failed background refresh while retaining the last good payload. */
export function markFleetSummaryProjectionError(input: FleetSummaryProjectionErrorMark): void {
  const projectId = validProjectId(input.projectId)
  const projectPath = validProjectPath(input.projectPath)
  const database = openDatabase(false)
  try {
    ensureSchema(database)
    database.prepare(`
      INSERT INTO ${FLEET_SUMMARY_PROJECTION_TABLE} (
        project_id, project_path, source_project_revision, source_queue_revision,
        refreshed_at, state, payload_json, error_text
      ) VALUES (?, ?, ?, ?, ?, 'error', 'null', ?)
      ON CONFLICT(project_id) DO UPDATE SET
        project_path = excluded.project_path,
        source_project_revision = COALESCE(excluded.source_project_revision, ${FLEET_SUMMARY_PROJECTION_TABLE}.source_project_revision),
        source_queue_revision = COALESCE(excluded.source_queue_revision, ${FLEET_SUMMARY_PROJECTION_TABLE}.source_queue_revision),
        refreshed_at = excluded.refreshed_at,
        state = 'error',
        error_text = excluded.error_text
    `).run(
      projectId,
      projectPath,
      revision(input.sourceProjectRevision),
      revision(input.sourceQueueRevision),
      refreshedAt(input.markedAt),
      boundedText(input.error, FLEET_SUMMARY_ERROR_MAX_BYTES) ?? 'Fleet summary refresh failed',
    )
  } finally {
    database.close()
  }
}

/** Mark all rows stale on service startup until the asynchronous refresh proves them current. */
export function markAllFleetSummaryProjectionsStale(): number {
  const databasePath = fleetStateDatabasePath()
  if (!existsSync(databasePath)) return 0
  const database = openDatabase(false)
  try {
    ensureSchema(database)
    const result = database.prepare(`
      UPDATE ${FLEET_SUMMARY_PROJECTION_TABLE}
      SET state = 'stale', refreshed_at = ?
      WHERE state = 'current'
    `).run(new Date().toISOString())
    return Number(result.changes ?? 0)
  } finally {
    database.close()
  }
}

export function deleteFleetSummaryProjection(projectId: string): boolean {
  const databasePath = fleetStateDatabasePath()
  if (!existsSync(databasePath)) return false
  const database = openDatabase(false)
  try {
    ensureSchema(database)
    const result = database.prepare(`DELETE FROM ${FLEET_SUMMARY_PROJECTION_TABLE} WHERE project_id = ?`).run(validProjectId(projectId))
    return Number(result.changes ?? 0) > 0
  } finally {
    database.close()
  }
}

/** Remove rows not present in the current machine registration snapshot. */
export function pruneFleetSummaryProjections(keepProjectIds: readonly string[]): number {
  const databasePath = fleetStateDatabasePath()
  if (!existsSync(databasePath)) return 0
  const keep = [...new Set(keepProjectIds.map(validProjectId))]
  const database = openDatabase(false)
  try {
    ensureSchema(database)
    const result = keep.length === 0
      ? database.prepare(`DELETE FROM ${FLEET_SUMMARY_PROJECTION_TABLE}`).run()
      : database.prepare(`
          DELETE FROM ${FLEET_SUMMARY_PROJECTION_TABLE}
          WHERE project_id NOT IN (${keep.map(() => '?').join(', ')})
        `).run(...keep)
    return Number(result.changes ?? 0)
  } finally {
    database.close()
  }
}
