import { existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { projectStateDatabasePath } from './project-state-database.js'

/**
 * The delivery read projection is a persisted read model, not a second task
 * store. This module owns the only SQLite boundary for it. Runtime code gets
 * normalized rows from here and is not allowed to open the project database.
 */
export const DELIVERY_READ_PROJECTION_SCHEMA_VERSION = 1 as const

const META_TABLE = 'delivery_read_projection_meta'
const CANDIDATE_TABLE = 'delivery_read_projection_candidates'
const EDGE_TABLE = 'delivery_read_projection_edges'
const PRIMITIVE_TABLE = 'delivery_read_projection_primitives'

type JsonRecord = Record<string, unknown>

export interface DeliveryReadProjectionRevision {
  queueRevision: number
  projectRevision: number
  deliveryUpdatedAt: string | null
  refreshedAt: string
}

export interface DeliveryReadProjectionCurrentRevision {
  queueRevision: number
  projectRevision: number
  deliveryUpdatedAt: string | null
}

export type DeliveryReadProjectionMissingReason =
  | 'database_missing'
  | 'database_unavailable'
  | 'projection_missing'
  | 'projection_schema_mismatch'
  | 'source_state_missing'
  | 'delivery_model_unavailable'

export type DeliveryReadProjectionStaleReason =
  | 'queue_revision_changed'
  | 'project_revision_changed'
  | 'delivery_model_changed'

export interface DeliveryReadProjectionTaskRow {
  id: string
  title: string
  description: string | null
  status: string | null
  domain: string | null
  priority: string | null
  workKind: string | null
  parentId: string | null
  hierarchy: JsonRecord
  dependsOn: string[]
  releaseIds: string[]
  sourceRefs: string[]
  summary: JsonRecord
  updatedAt: string | null
  completedAt: string | null
}

export interface DeliveryReadProjectionCandidateRow {
  taskId: string
  rank: number
  payload: JsonRecord
}

export interface DeliveryReadProjectionPage<T, TCursor = { rank: number; taskId: string }> {
  rows: T[]
  hasMore: boolean
  nextCursor?: TCursor
}

export interface DeliveryReadProjectionPrimitiveRow {
  id: string
  payload: unknown
}

export type DeliveryReadProjectionEdgeRelation =
  | 'parent'
  | 'child'
  | 'direct_blocker'
  | 'recursive_blocker'
  | 'blocks'
  | 'breadcrumb'
  | 'supports'
  | 'primitive_use'
  | 'primitive_ancestor'
  | 'primitive_proof'
  | 'proving_task'

export interface DeliveryReadProjectionEdgeRow {
  sourceTaskId: string
  relation: DeliveryReadProjectionEdgeRelation
  targetId: string
  contextId: string | null
}

export interface DeliveryReadProjectionMeta {
  schemaVersion: number
  source: DeliveryReadProjectionRevision
  selectedReleaseId: string | null
  validation: JsonRecord
}

export interface DeliveryReadProjectionReadOptions {
  queue?: false | { limit?: number; after?: { rank: number; taskId: string } }
  taskId?: string
  primitiveLimit?: number
  primitiveAfter?: string
  /** Token from the explicitly selected saved delivery-model source. */
  deliveryModelUpdatedAt: string | null
}

export type DeliveryReadProjectionReadOptionsWithoutSource = Omit<DeliveryReadProjectionReadOptions, 'deliveryModelUpdatedAt'>

export interface DeliveryReadSavedModelSource<T> {
  model: T
  updatedAt: string | null
}

export type DeliveryReadSavedModelReader<T> = (projectRoot: string) => Promise<DeliveryReadSavedModelSource<T>>

export type DeliveryReadProjectionWithSavedModel<T> =
  | { model: T; snapshot: DeliveryReadProjectionSnapshot }
  | { model: null; snapshot: DeliveryReadProjectionSnapshotMissing }

export interface DeliveryReadProjectionSnapshotCurrent {
  status: 'current'
  freshness: 'current'
  source: DeliveryReadProjectionRevision
  current: DeliveryReadProjectionCurrentRevision
  meta: DeliveryReadProjectionMeta
  queue: DeliveryReadProjectionPage<DeliveryReadProjectionCandidateRow> | null
  primitives: DeliveryReadProjectionPage<DeliveryReadProjectionPrimitiveRow, string>
  taskRows: DeliveryReadProjectionTaskRow[]
  edges: DeliveryReadProjectionEdgeRow[]
}

export interface DeliveryReadProjectionSnapshotStale {
  status: 'stale'
  freshness: 'stale'
  reason: DeliveryReadProjectionStaleReason
  source: DeliveryReadProjectionRevision
  current: DeliveryReadProjectionCurrentRevision
}

export interface DeliveryReadProjectionSnapshotMissing {
  status: 'missing'
  freshness: 'missing'
  reason: DeliveryReadProjectionMissingReason
  detail?: string
}

export type DeliveryReadProjectionSnapshot =
  | DeliveryReadProjectionSnapshotCurrent
  | DeliveryReadProjectionSnapshotStale
  | DeliveryReadProjectionSnapshotMissing

export interface DeliveryReadProjectionRefreshInput {
  status: 'current' | 'missing'
  source?: DeliveryReadProjectionCurrentRevision
  selectedReleaseId?: string | null
  taskRows?: DeliveryReadProjectionTaskRow[]
  reason?: DeliveryReadProjectionMissingReason
}

export interface DeliveryReadProjectionWriteInput {
  source: DeliveryReadProjectionRevision
  selectedReleaseId: string | null
  validation: JsonRecord
  candidates: readonly DeliveryReadProjectionCandidateRow[]
  edges: readonly DeliveryReadProjectionEdgeRow[]
  primitives: readonly DeliveryReadProjectionPrimitiveRow[]
}

export interface DeliveryReadProjectionWriteResult {
  status: 'current' | 'missing'
  source?: DeliveryReadProjectionRevision
  reason?: DeliveryReadProjectionMissingReason
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function parseJson(value: unknown, fallback: unknown): unknown {
  if (typeof value !== 'string') return fallback
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

function parseRecord(value: unknown): JsonRecord {
  const parsed = parseJson(value, {})
  return isRecord(parsed) ? parsed : {}
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function stringArray(value: unknown): string[] {
  const parsed = typeof value === 'string' ? parseJson(value, []) : value
  if (!Array.isArray(parsed)) return []
  return [...new Set(parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0))]
}

function json(value: unknown): string {
  return JSON.stringify(value)
}

function clampLimit(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(100, Math.max(1, Math.trunc(value as number)))
}

function tableExists(database: DatabaseSync, table: string): boolean {
  return Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table))
}

function openDatabase(projectRoot: string, readOnly: boolean): DatabaseSync | null {
  const databasePath = projectStateDatabasePath(projectRoot)
  if (!existsSync(databasePath)) return null
  try {
    const database = new DatabaseSync(databasePath, { readOnly })
    database.exec('PRAGMA busy_timeout = 5000')
    return database
  } catch {
    return null
  }
}

function readSource(database: DatabaseSync): DeliveryReadProjectionCurrentRevision | null {
  if (!tableExists(database, 'project_meta') || !tableExists(database, 'queue_state')) return null
  const project = database.prepare('SELECT revision FROM project_meta WHERE id = 1').get() as JsonRecord | undefined
  const queue = database.prepare('SELECT revision, selected_release_id FROM queue_state WHERE id = 1').get() as JsonRecord | undefined
  if (!project || !queue) return null
  return {
    projectRevision: Number(project.revision ?? 0),
    queueRevision: Number(queue.revision ?? 0),
    deliveryUpdatedAt: null,
  }
}

function selectedReleaseId(database: DatabaseSync): string | null {
  const row = database.prepare('SELECT selected_release_id FROM queue_state WHERE id = 1').get() as JsonRecord | undefined
  return stringValue(row?.selected_release_id)
}

function deliveryRowColumns(): string {
  return `
    id, title, description, status, domain, priority, work_kind, parent_id,
    hierarchy_json, depends_on_json, release_ids_json, source_refs_json,
    summary_json, updated_at, completed_at
  `
}

function relationMap(
  database: DatabaseSync,
  table: 'task_dependencies' | 'release_membership',
  idColumn: string,
  valueColumn: string,
  taskIds: readonly string[],
): Map<string, string[]> {
  const values = new Map<string, string[]>()
  if (!tableExists(database, table) || taskIds.length === 0) return values
  const rows = database.prepare(`
    SELECT ${idColumn} AS task_id, ${valueColumn} AS value
    FROM ${table}
    WHERE ${idColumn} IN (${taskIds.map(() => '?').join(', ')})
    ORDER BY ${idColumn}, rowid
  `).all(...taskIds) as JsonRecord[]
  for (const row of rows) {
    const taskId = stringValue(row.task_id)
    const value = stringValue(row.value)
    if (!taskId || !value) continue
    const current = values.get(taskId) ?? []
    values.set(taskId, [...new Set([...current, value])])
  }
  return values
}

function normalizedRows(database: DatabaseSync, rows: JsonRecord[]): DeliveryReadProjectionTaskRow[] {
  const ids = rows.flatMap(row => stringValue(row.id) ? [String(row.id)] : [])
  const hasDependencies = tableExists(database, 'task_dependencies')
  const hasReleaseMembership = tableExists(database, 'release_membership')
  const dependencies = relationMap(database, 'task_dependencies', 'task_id', 'depends_on_task_id', ids)
  const releases = relationMap(database, 'release_membership', 'task_id', 'release_id', ids)
  return rows.flatMap(row => {
    const id = stringValue(row.id)
    if (!id) return []
    return [{
      id,
      title: String(row.title ?? id),
      description: stringValue(row.description),
      status: stringValue(row.status),
      domain: stringValue(row.domain),
      priority: stringValue(row.priority),
      workKind: stringValue(row.work_kind),
      parentId: stringValue(row.parent_id),
      hierarchy: parseRecord(row.hierarchy_json),
      // Once the normalized relation exists, an empty relation is a real
      // answer. JSON mirrors are migration input only, never an ordinary-read
      // fallback that can resurrect stale edges.
      dependsOn: hasDependencies ? dependencies.get(id) ?? [] : stringArray(row.depends_on_json),
      releaseIds: hasReleaseMembership ? releases.get(id) ?? [] : stringArray(row.release_ids_json),
      sourceRefs: stringArray(row.source_refs_json),
      summary: parseRecord(row.summary_json),
      updatedAt: stringValue(row.updated_at),
      completedAt: stringValue(row.completed_at),
    }]
  })
}

function readTaskRows(database: DatabaseSync, taskIds?: readonly string[]): DeliveryReadProjectionTaskRow[] {
  const rows = taskIds
    ? taskIds.length === 0
      ? []
      : database.prepare(`SELECT ${deliveryRowColumns()} FROM work_items WHERE id IN (${taskIds.map(() => '?').join(', ')})`).all(...taskIds)
    : database.prepare(`SELECT ${deliveryRowColumns()} FROM work_items ORDER BY rowid`).all()
  return normalizedRows(database, rows as JsonRecord[])
}

function readMeta(database: DatabaseSync): DeliveryReadProjectionMeta | null {
  if (!tableExists(database, META_TABLE)) return null
  const row = database.prepare(`
    SELECT schema_version, source_queue_revision, source_project_revision,
      source_delivery_updated_at, selected_release_id, validation_json, refreshed_at
    FROM ${META_TABLE}
    WHERE id = 1
  `).get() as JsonRecord | undefined
  if (!row) return null
  return {
    schemaVersion: Number(row.schema_version ?? 0),
    source: {
      queueRevision: Number(row.source_queue_revision ?? 0),
      projectRevision: Number(row.source_project_revision ?? 0),
      deliveryUpdatedAt: stringValue(row.source_delivery_updated_at),
      refreshedAt: String(row.refreshed_at ?? ''),
    },
    selectedReleaseId: stringValue(row.selected_release_id),
    validation: parseRecord(row.validation_json),
  }
}

function staleReason(
  source: DeliveryReadProjectionRevision,
  current: DeliveryReadProjectionCurrentRevision,
): DeliveryReadProjectionStaleReason | null {
  if (source.queueRevision !== current.queueRevision) return 'queue_revision_changed'
  if (source.projectRevision !== current.projectRevision) return 'project_revision_changed'
  if (source.deliveryUpdatedAt !== current.deliveryUpdatedAt) return 'delivery_model_changed'
  return null
}

function readCandidatePage(
  database: DatabaseSync,
  options: DeliveryReadProjectionReadOptions['queue'],
): DeliveryReadProjectionPage<DeliveryReadProjectionCandidateRow> {
  const queueOptions = options === false ? undefined : options
  const limit = clampLimit(queueOptions?.limit, 50)
  const after = queueOptions?.after
  const rows = after
    ? database.prepare(`
        SELECT task_id, rank, candidate_json
        FROM ${CANDIDATE_TABLE}
        WHERE rank > ? OR (rank = ? AND task_id > ?)
        ORDER BY rank, task_id
        LIMIT ?
      `).all(after.rank, after.rank, after.taskId, limit + 1)
    : database.prepare(`
        SELECT task_id, rank, candidate_json
        FROM ${CANDIDATE_TABLE}
        ORDER BY rank, task_id
        LIMIT ?
      `).all(limit + 1)
  const selected = (rows as JsonRecord[]).slice(0, limit)
  const items = selected.flatMap(row => {
    const taskId = stringValue(row.task_id)
    const payload = parseJson(row.candidate_json, null)
    return taskId && isRecord(payload)
      ? [{ taskId, rank: Number(row.rank ?? 0), payload }]
      : []
  })
  const hasMore = rows.length > limit
  const last = selected.at(-1)
  return {
    rows: items,
    hasMore,
    ...(hasMore && last?.task_id ? { nextCursor: { rank: Number(last.rank), taskId: String(last.task_id) } } : {}),
  }
}

function readPrimitivePage(
  database: DatabaseSync,
  limitValue: number | undefined,
  after: string | undefined,
): DeliveryReadProjectionPage<DeliveryReadProjectionPrimitiveRow, string> {
  const limit = clampLimit(limitValue, 100)
  const rows = after
    ? database.prepare(`
        SELECT primitive_id, payload_json
        FROM ${PRIMITIVE_TABLE}
        WHERE primitive_id > ?
        ORDER BY primitive_id
        LIMIT ?
      `).all(after, limit + 1)
    : database.prepare(`
        SELECT primitive_id, payload_json
        FROM ${PRIMITIVE_TABLE}
        ORDER BY primitive_id
        LIMIT ?
      `).all(limit + 1)
  const selected = (rows as JsonRecord[]).slice(0, limit)
  const items = selected.flatMap(row => {
    const id = stringValue(row.primitive_id)
    const payload = parseJson(row.payload_json, null)
    return id && payload !== null ? [{ id, payload }] : []
  })
  const hasMore = rows.length > limit
  const last = selected.at(-1)
  return { rows: items, hasMore, ...(hasMore && last?.primitive_id ? { nextCursor: String(last.primitive_id) } : {}) }
}

function readEdges(database: DatabaseSync, taskId: string): DeliveryReadProjectionEdgeRow[] {
  if (!tableExists(database, EDGE_TABLE)) return []
  const rows = database.prepare(`
    SELECT source_task_id, relation, target_id, context_id
    FROM ${EDGE_TABLE}
    WHERE source_task_id = ?
    ORDER BY relation, rowid
  `).all(taskId) as JsonRecord[]
  return rows.flatMap(row => {
    const sourceTaskId = stringValue(row.source_task_id)
    const relation = stringValue(row.relation)
    const targetId = stringValue(row.target_id)
    if (!sourceTaskId || !relation || !targetId) return []
    return [{ sourceTaskId, relation: relation as DeliveryReadProjectionEdgeRelation, targetId, contextId: stringValue(row.context_id) }]
  })
}

function projectionTables(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS ${META_TABLE} (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      schema_version INTEGER NOT NULL,
      source_queue_revision INTEGER NOT NULL,
      source_project_revision INTEGER NOT NULL,
      source_delivery_updated_at TEXT,
      selected_release_id TEXT,
      validation_json TEXT NOT NULL,
      refreshed_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ${CANDIDATE_TABLE} (
      task_id TEXT PRIMARY KEY,
      rank INTEGER NOT NULL,
      candidate_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS delivery_read_projection_candidates_rank_idx
      ON ${CANDIDATE_TABLE}(rank, task_id);
    CREATE TABLE IF NOT EXISTS ${EDGE_TABLE} (
      source_task_id TEXT NOT NULL,
      relation TEXT NOT NULL,
      target_id TEXT NOT NULL,
      context_id TEXT,
      PRIMARY KEY (source_task_id, relation, target_id, context_id)
    );
    CREATE INDEX IF NOT EXISTS delivery_read_projection_edges_target_idx
      ON ${EDGE_TABLE}(target_id, relation);
    CREATE TABLE IF NOT EXISTS ${PRIMITIVE_TABLE} (
      primitive_id TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL
    );
  `)
}

export function deliveryReadProjectionSchemaPresent(projectRoot: string): boolean {
  const database = openDatabase(projectRoot, true)
  if (!database) return false
  try {
    return [META_TABLE, CANDIDATE_TABLE, EDGE_TABLE, PRIMITIVE_TABLE].every(table => tableExists(database, table))
  } finally {
    database.close()
  }
}

export function ensureDeliveryReadProjectionSchema(projectRoot: string): boolean {
  const database = openDatabase(projectRoot, false)
  if (!database) return false
  try {
    projectionTables(database)
    return true
  } finally {
    database.close()
  }
}

export function readProjectDeliveryProjectionRefreshInput(projectRoot: string): DeliveryReadProjectionRefreshInput {
  const database = openDatabase(projectRoot, true)
  if (!database) {
    return { status: 'missing', reason: existsSync(projectStateDatabasePath(projectRoot)) ? 'database_unavailable' : 'database_missing' }
  }
  let inReadTransaction = false
  try {
    database.exec('BEGIN')
    inReadTransaction = true
    const source = readSource(database)
    if (!source) return { status: 'missing', reason: 'source_state_missing' }
    return {
      status: 'current',
      source,
      selectedReleaseId: selectedReleaseId(database),
      taskRows: readTaskRows(database),
    }
  } catch {
    return { status: 'missing', reason: 'database_unavailable' }
  } finally {
    if (inReadTransaction) {
      try { database.exec('COMMIT') } catch { /* preserve read result */ }
    }
    database.close()
  }
}

export function writeProjectDeliveryReadProjection(
  projectRoot: string,
  input: DeliveryReadProjectionWriteInput,
): DeliveryReadProjectionWriteResult {
  const database = openDatabase(projectRoot, false)
  if (!database) {
    return { status: 'missing', reason: existsSync(projectStateDatabasePath(projectRoot)) ? 'database_unavailable' : 'database_missing' }
  }
  try {
    projectionTables(database)
    database.exec('BEGIN')
    const current = readSource(database)
    if (!current) {
      database.exec('ROLLBACK')
      return { status: 'missing', reason: 'source_state_missing' }
    }
    if (current.queueRevision !== input.source.queueRevision || current.projectRevision !== input.source.projectRevision) {
      database.exec('ROLLBACK')
      return { status: 'missing', reason: 'source_state_missing' }
    }
    database.prepare(`DELETE FROM ${META_TABLE}`).run()
    database.prepare(`DELETE FROM ${CANDIDATE_TABLE}`).run()
    database.prepare(`DELETE FROM ${EDGE_TABLE}`).run()
    database.prepare(`DELETE FROM ${PRIMITIVE_TABLE}`).run()
    const insertCandidate = database.prepare(`INSERT INTO ${CANDIDATE_TABLE} (task_id, rank, candidate_json) VALUES (?, ?, ?)`)
    for (const candidate of input.candidates) insertCandidate.run(candidate.taskId, candidate.rank, json(candidate.payload))
    const insertEdge = database.prepare(`INSERT OR IGNORE INTO ${EDGE_TABLE} (source_task_id, relation, target_id, context_id) VALUES (?, ?, ?, ?)`)
    for (const edge of input.edges) insertEdge.run(edge.sourceTaskId, edge.relation, edge.targetId, edge.contextId)
    const insertPrimitive = database.prepare(`INSERT INTO ${PRIMITIVE_TABLE} (primitive_id, payload_json) VALUES (?, ?)`)
    for (const primitive of input.primitives) insertPrimitive.run(primitive.id, json(primitive.payload))
    database.prepare(`
      INSERT INTO ${META_TABLE} (
        id, schema_version, source_queue_revision, source_project_revision,
        source_delivery_updated_at, selected_release_id, validation_json, refreshed_at
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      DELIVERY_READ_PROJECTION_SCHEMA_VERSION,
      input.source.queueRevision,
      input.source.projectRevision,
      input.source.deliveryUpdatedAt,
      input.selectedReleaseId,
      json(input.validation),
      input.source.refreshedAt,
    )
    database.exec('COMMIT')
    return { status: 'current', source: input.source }
  } catch {
    try { database.exec('ROLLBACK') } catch { /* preserve projection failure */ }
    return { status: 'missing', reason: 'database_unavailable' }
  } finally {
    database.close()
  }
}

/**
 * Bind the saved delivery model and its revision token to the same named
 * sessions read boundary as the SQLite projection. The reader is injected so
 * the storage format remains owned by its persistence module; callers cannot
 * accidentally compare a model from one read with a projection from another.
 */
export async function readProjectDeliveryReadProjectionWithSavedModel<T>(
  projectRoot: string,
  options: DeliveryReadProjectionReadOptionsWithoutSource,
  readSavedModel: DeliveryReadSavedModelReader<T>,
): Promise<DeliveryReadProjectionWithSavedModel<T>> {
  try {
    const saved = await readSavedModel(projectRoot)
    const snapshot = readProjectDeliveryReadProjectionSnapshot(projectRoot, {
      ...options,
      deliveryModelUpdatedAt: saved.updatedAt,
    })
    return { model: saved.model, snapshot }
  } catch (error) {
    return {
      model: null,
      snapshot: {
        status: 'missing',
        freshness: 'missing',
        reason: 'delivery_model_unavailable',
        detail: error instanceof Error ? error.message : String(error),
      },
    }
  }
}

export type DeliveryReadProjectionRefreshSource<T> =
  | {
    status: 'current'
    model: T
    source: DeliveryReadProjectionCurrentRevision
    selectedReleaseId?: string | null
    taskRows: DeliveryReadProjectionTaskRow[]
  }
  | {
    status: 'missing'
    model: null
    reason?: DeliveryReadProjectionMissingReason
  }

export async function readProjectDeliveryProjectionRefreshSource<T>(
  projectRoot: string,
  readSavedModel: DeliveryReadSavedModelReader<T>,
): Promise<DeliveryReadProjectionRefreshSource<T>> {
  try {
    const saved = await readSavedModel(projectRoot)
    const input = readProjectDeliveryProjectionRefreshInput(projectRoot)
    return input.status === 'current'
      ? {
        status: 'current',
        model: saved.model,
        source: input.source!,
        selectedReleaseId: input.selectedReleaseId,
        taskRows: input.taskRows!,
      }
      : { status: 'missing', model: null, reason: input.reason }
  } catch {
    return { status: 'missing', model: null, reason: 'delivery_model_unavailable' }
  }
}

export function readProjectDeliveryReadProjectionSnapshot(
  projectRoot: string,
  options: DeliveryReadProjectionReadOptions,
): DeliveryReadProjectionSnapshot {
  const database = openDatabase(projectRoot, true)
  if (!database) {
    return {
      status: 'missing',
      freshness: 'missing',
      reason: existsSync(projectStateDatabasePath(projectRoot)) ? 'database_unavailable' : 'database_missing',
    }
  }
  let inReadTransaction = false
  try {
    database.exec('BEGIN')
    inReadTransaction = true
    const currentSource = readSource(database)
    if (!currentSource) return { status: 'missing', freshness: 'missing', reason: 'source_state_missing' }
    const meta = readMeta(database)
    if (!meta) return { status: 'missing', freshness: 'missing', reason: 'projection_missing' }
    if (meta.schemaVersion !== DELIVERY_READ_PROJECTION_SCHEMA_VERSION) {
      return { status: 'missing', freshness: 'missing', reason: 'projection_schema_mismatch' }
    }
    const source = meta.source
    const current = { ...currentSource, deliveryUpdatedAt: options.deliveryModelUpdatedAt }
    const reason = staleReason(source, current)
    if (reason) return { status: 'stale', freshness: 'stale', reason, source, current }
    const taskIds = options.taskId ? [options.taskId] : []
    const queue = options.queue === false ? null : readCandidatePage(database, options.queue)
    const candidateTaskIds = queue?.rows.map(row => row.taskId) ?? []
    const edges = options.taskId ? readEdges(database, options.taskId) : []
    const relatedTaskIds = edges
      .filter(edge => !edge.relation.startsWith('primitive_'))
      .map(edge => edge.targetId)
    const taskRows = readTaskRows(database, [...new Set([...taskIds, ...candidateTaskIds, ...relatedTaskIds])])
    return {
      status: 'current',
      freshness: 'current',
      source,
      current,
      meta,
      queue,
      primitives: readPrimitivePage(database, options.primitiveLimit, options.primitiveAfter),
      taskRows,
      edges,
    }
  } catch (error) {
    return { status: 'missing', freshness: 'missing', reason: 'database_unavailable', detail: error instanceof Error ? error.message : String(error) }
  } finally {
    if (inReadTransaction) {
      try { database.exec('COMMIT') } catch { /* preserve read result */ }
    }
    database.close()
  }
}
