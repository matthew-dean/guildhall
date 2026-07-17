import { existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { projectStateDatabasePath } from '@guildhall/sessions'
import type { Task } from '@guildhall/core'
import {
  deriveQueueCandidates,
  deriveTaskRelationships,
  listPrimitivesWithRelations,
  ProjectDeliveryModel,
  projectDeliveryModelPath,
  readProjectDeliveryModel,
  validateProjectDeliveryModel,
  type DeliveryModelValidation,
  type PrimitiveWithRelations,
  type ProjectDeliveryModel as ProjectDeliveryModelRecord,
  type QueueCandidate,
  type TaskRelationshipSummary,
} from './delivery-spine.js'

export const DELIVERY_READ_PROJECTION_SCHEMA_VERSION = 1

const META_TABLE = 'delivery_read_projection_meta'
const CANDIDATE_TABLE = 'delivery_read_projection_candidates'
const EDGE_TABLE = 'delivery_read_projection_edges'
const PRIMITIVE_TABLE = 'delivery_read_projection_primitives'

const ACTIVE_CANDIDATE_STATUSES = [
  'ready',
  'in_progress',
  'review',
  'gate_check',
  'spec_review',
  'exploring',
  'blocked',
] as const

type JsonRecord = Record<string, unknown>

export interface DeliveryReadRevision {
  queueRevision: number
  projectRevision: number
  deliveryUpdatedAt: string | null
  refreshedAt: string
}

export interface DeliveryReadCurrentRevision {
  queueRevision: number
  projectRevision: number
  deliveryUpdatedAt: string | null
}

export type DeliveryReadMissingReason =
  | 'database_missing'
  | 'database_unavailable'
  | 'projection_missing'
  | 'projection_schema_mismatch'
  | 'source_state_missing'
  | 'delivery_model_unavailable'

export type DeliveryReadStaleReason =
  | 'queue_revision_changed'
  | 'project_revision_changed'
  | 'delivery_model_changed'

export interface DeliveryTaskSummary {
  id: string
  title: string
  description: string | null
  status: string | null
  domain: string | null
  priority: string | null
  workKind: string | null
  parentId: string | null
  hierarchy: JsonRecord | null
  dependsOn: string[]
  releaseIds: string[]
  sourceRefs: string[]
  updatedAt: string | null
  completedAt: string | null
  delivery?: {
    driver?: string
    provider?: string
    usesPrimitives: string[]
    provesPrimitives: string[]
    supports: string[]
    proofKind?: string
  }
}

export interface DeliveryTaskRef {
  id: string
  title: string
  status: string | null
}

export interface DeliveryPrimitiveRef {
  id: string
  label: string
  status: string
}

export interface DeliverySuggestedProofTask {
  primitiveId: string
  primitiveLabel: string
  title: string
  reason: string
  delivery: JsonRecord
}

export interface DeliveryReadCandidate {
  task: DeliveryTaskSummary
  runnable: boolean
  executionBlockers: DeliveryTaskRef[]
  structuralBlockers: DeliveryPrimitiveRef[]
  suggestedPrimitiveProofTasks: DeliverySuggestedProofTask[]
  rank: number
  why: string
}

export interface DeliveryQueueCursor {
  rank: number
  taskId: string
}

export interface DeliveryQueuePageOptions {
  limit?: number
  after?: DeliveryQueueCursor
}

export interface DeliveryQueuePage {
  runnable: DeliveryReadCandidate[]
  blocked: DeliveryReadCandidate[]
  firstRunnable?: DeliveryReadCandidate
  hasMore: boolean
  nextCursor?: DeliveryQueueCursor
}

export interface DeliveryPrimitivePage {
  primitives: PrimitiveWithRelations[]
  hasMore: boolean
  nextCursor?: string
}

export interface DeliveryReadTaskRelationships {
  hierarchy: {
    parent?: DeliveryTaskRef
    children: DeliveryTaskRef[]
    breadcrumbs: DeliveryTaskRef[]
  }
  dependencies: {
    directBlockers: DeliveryTaskRef[]
    recursiveBlockers: DeliveryTaskRef[]
    blocks: DeliveryTaskRef[]
  }
  supports: string[]
  primitiveUse: {
    direct: string[]
    ancestors: string[]
  }
  primitiveProof: {
    proves: string[]
    provingTasksByPrimitive: Record<string, DeliveryTaskRef[]>
  }
}

export interface DeliveryReadProjectionCurrent {
  status: 'current'
  freshness: 'current'
  source: DeliveryReadRevision
  model: ProjectDeliveryModelRecord
  validation: DeliveryModelValidation
  selectedReleaseId: string | null
  queue: DeliveryQueuePage | null
  primitives: DeliveryPrimitivePage
  task: DeliveryTaskSummary | null
  taskState: 'not_requested' | 'present' | 'missing'
  relationships: DeliveryReadTaskRelationships | null
}

export interface DeliveryReadProjectionStale {
  status: 'stale'
  freshness: 'stale'
  reason: DeliveryReadStaleReason
  source: DeliveryReadRevision
  current: DeliveryReadCurrentRevision
}

export interface DeliveryReadProjectionMissing {
  status: 'missing'
  freshness: 'missing'
  reason: DeliveryReadMissingReason
  detail?: string
}

export type DeliveryReadProjection =
  | DeliveryReadProjectionCurrent
  | DeliveryReadProjectionStale
  | DeliveryReadProjectionMissing

export interface DeliveryReadProjectionReadOptions {
  queue?: false | DeliveryQueuePageOptions
  taskId?: string
  primitiveLimit?: number
  primitiveAfter?: string
}

export interface DeliveryReadProjectionRefreshResult {
  status: 'current' | 'missing'
  source?: DeliveryReadRevision
  taskCount?: number
  candidateCount?: number
  edgeCount?: number
  primitiveCount?: number
  reason?: DeliveryReadMissingReason
}

type DeliveryEdgeRelation =
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

interface DeliveryEdge {
  sourceTaskId: string
  relation: DeliveryEdgeRelation
  targetId: string
  contextId: string | null
}

interface DeliveryMeta {
  schemaVersion: number
  source: DeliveryReadRevision
  selectedReleaseId: string | null
  validation: DeliveryModelValidation
}

interface CompactTaskRow extends JsonRecord {
  id: string
  title: string
  description: string | null
  status: string | null
  domain: string | null
  priority: string | null
  workKind: string | null
  parentId: string | null
  hierarchy: JsonRecord | null
  updatedAt: string | null
  completedAt: string | null
  summary: JsonRecord
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

function deliveryModelToken(projectRoot: string, model: ProjectDeliveryModelRecord): string | null {
  return existsSync(projectDeliveryModelPath(projectRoot)) ? model.updatedAt : null
}

function readDatabaseSource(database: DatabaseSync): DeliveryReadCurrentRevision | null {
  if (!tableExists(database, 'project_meta') || !tableExists(database, 'queue_state')) return null
  const project = database.prepare('SELECT revision FROM project_meta WHERE id = 1').get() as JsonRecord | undefined
  const queue = database.prepare('SELECT revision FROM queue_state WHERE id = 1').get() as JsonRecord | undefined
  if (!project || !queue) return null
  return {
    projectRevision: Number(project.revision ?? 0),
    queueRevision: Number(queue.revision ?? 0),
    deliveryUpdatedAt: null,
  }
}

function readSelectedReleaseId(database: DatabaseSync): string | null {
  const row = database.prepare('SELECT selected_release_id FROM queue_state WHERE id = 1').get() as JsonRecord | undefined
  return stringValue(row?.selected_release_id)
}

function compactDelivery(summary: JsonRecord): DeliveryTaskSummary['delivery'] | undefined {
  const raw = isRecord(summary.delivery) ? summary.delivery : null
  if (!raw) return undefined
  const delivery: NonNullable<DeliveryTaskSummary['delivery']> = {
    usesPrimitives: stringArray(raw.usesPrimitives),
    provesPrimitives: stringArray(raw.provesPrimitives),
    supports: stringArray(raw.supports),
  }
  const driver = stringValue(raw.driver)
  const provider = stringValue(raw.provider)
  const proofKind = stringValue(raw.proofKind)
  if (driver) delivery.driver = driver
  if (provider) delivery.provider = provider
  if (proofKind) delivery.proofKind = proofKind
  return delivery
}

function compactRow(row: JsonRecord): CompactTaskRow {
  return {
    ...row,
    id: String(row.id ?? ''),
    title: String(row.title ?? ''),
    description: stringValue(row.description),
    status: stringValue(row.status),
    domain: stringValue(row.domain),
    priority: stringValue(row.priority),
    workKind: stringValue(row.work_kind),
    parentId: stringValue(row.parent_id),
    hierarchy: parseRecord(row.hierarchy_json),
    updatedAt: stringValue(row.updated_at),
    completedAt: stringValue(row.completed_at),
    summary: parseRecord(row.summary_json),
  }
}

function taskSummary(
  row: CompactTaskRow,
  dependsOn: string[],
  releaseIds: string[],
): DeliveryTaskSummary {
  const delivery = compactDelivery(row.summary)
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    domain: row.domain,
    priority: row.priority,
    workKind: row.workKind,
    parentId: row.parentId,
    hierarchy: Object.keys(row.hierarchy ?? {}).length > 0 ? row.hierarchy : null,
    dependsOn,
    releaseIds,
    sourceRefs: stringArray(row.source_refs_json),
    updatedAt: row.updatedAt,
    completedAt: row.completedAt,
    ...(delivery ? { delivery } : {}),
  }
}

function taskForDerivation(
  projectRoot: string,
  row: CompactTaskRow,
  dependsOn: string[],
  releaseIds: string[],
): Task {
  const summary = taskSummary(row, dependsOn, releaseIds)
  return {
    id: summary.id,
    title: summary.title,
    description: summary.description ?? '',
    domain: summary.domain ?? 'general',
    projectPath: projectRoot,
    status: (summary.status ?? 'unknown') as Task['status'],
    priority: summary.priority ?? 'normal',
    acceptanceCriteria: [],
    outOfScope: [],
    dependsOn: summary.dependsOn,
    notes: [],
    gateResults: [],
    reviewVerdicts: [],
    adjudications: [],
    revisionCount: 0,
    remediationAttempts: 0,
    escalations: [],
    agentIssues: [],
    origination: 'agent_discovery',
    createdAt: summary.updatedAt ?? new Date(0).toISOString(),
    updatedAt: summary.updatedAt ?? new Date(0).toISOString(),
    ...(summary.workKind ? { workKind: summary.workKind } : {}),
    ...(summary.parentId || summary.hierarchy ? {
      hierarchy: {
        ...(summary.hierarchy ?? {}),
        ...(summary.parentId ? { parentId: summary.parentId } : {}),
      },
    } : {}),
    ...(summary.releaseIds.length > 0 ? { releaseIds: summary.releaseIds } : {}),
    ...(summary.sourceRefs.length > 0 ? { sourceRefs: summary.sourceRefs } : {}),
    ...(summary.delivery ? { delivery: summary.delivery } : {}),
  } as unknown as Task
}

function readCompactRows(database: DatabaseSync, taskIds?: readonly string[]): CompactTaskRow[] {
  const columns = `
    id, title, description, status, domain, priority, work_kind, parent_id,
    hierarchy_json, depends_on_json, release_ids_json, source_refs_json,
    summary_json, updated_at, completed_at
  `
  const rows = taskIds
    ? taskIds.length === 0
      ? []
      : database.prepare(`SELECT ${columns} FROM work_items WHERE id IN (${taskIds.map(() => '?').join(', ')})`).all(...taskIds)
    : database.prepare(`SELECT ${columns} FROM work_items ORDER BY rowid`).all()
  return (rows as JsonRecord[]).map(compactRow)
}

function readDependencyMap(database: DatabaseSync, taskIds?: readonly string[]): Map<string, string[]> {
  const dependencies = new Map<string, string[]>()
  if (!tableExists(database, 'task_dependencies')) return dependencies
  const rows = taskIds
    ? taskIds.length === 0
      ? []
      : database.prepare(`
          SELECT task_id, depends_on_task_id
          FROM task_dependencies
          WHERE task_id IN (${taskIds.map(() => '?').join(', ')})
          ORDER BY task_id, rowid
        `).all(...taskIds)
    : database.prepare('SELECT task_id, depends_on_task_id FROM task_dependencies ORDER BY task_id, rowid').all()
  for (const row of rows as JsonRecord[]) {
    const taskId = stringValue(row.task_id)
    const dependencyId = stringValue(row.depends_on_task_id)
    if (!taskId || !dependencyId) continue
    const values = dependencies.get(taskId) ?? []
    values.push(dependencyId)
    dependencies.set(taskId, [...new Set(values)])
  }
  return dependencies
}

function readReleaseMap(database: DatabaseSync, taskIds?: readonly string[]): Map<string, string[]> {
  const releases = new Map<string, string[]>()
  if (!tableExists(database, 'release_membership')) return releases
  const rows = taskIds
    ? taskIds.length === 0
      ? []
      : database.prepare(`
          SELECT task_id, release_id
          FROM release_membership
          WHERE task_id IN (${taskIds.map(() => '?').join(', ')})
          ORDER BY task_id, rowid
        `).all(...taskIds)
    : database.prepare('SELECT task_id, release_id FROM release_membership ORDER BY task_id, rowid').all()
  for (const row of rows as JsonRecord[]) {
    const taskId = stringValue(row.task_id)
    const releaseId = stringValue(row.release_id)
    if (!taskId || !releaseId) continue
    const values = releases.get(taskId) ?? []
    values.push(releaseId)
    releases.set(taskId, [...new Set(values)])
  }
  return releases
}

function taskSummariesFromRows(
  database: DatabaseSync,
  rows: readonly CompactTaskRow[],
): Map<string, DeliveryTaskSummary> {
  const ids = rows.map(row => row.id)
  const dependencies = readDependencyMap(database, ids)
  const releases = readReleaseMap(database, ids)
  return new Map(rows.map(row => [
    row.id,
    taskSummary(
      row,
      dependencies.get(row.id) ?? stringArray(row.depends_on_json),
      releases.get(row.id) ?? stringArray(row.release_ids_json),
    ),
  ]))
}

function taskMapForDerivation(
  projectRoot: string,
  database: DatabaseSync,
  rows: readonly CompactTaskRow[],
): Task[] {
  const dependencies = readDependencyMap(database)
  const releases = readReleaseMap(database)
  return rows.map(row => taskForDerivation(
    projectRoot,
    row,
    dependencies.get(row.id) ?? stringArray(row.depends_on_json),
    releases.get(row.id) ?? stringArray(row.release_ids_json),
  ))
}

function compactPrimitiveRef(primitive: PrimitiveWithRelations): DeliveryPrimitiveRef {
  return { id: primitive.id, label: primitive.label, status: primitive.status }
}

function compactCandidate(candidate: QueueCandidate): Omit<DeliveryReadCandidate, 'task'> {
  return {
    runnable: candidate.runnable,
    executionBlockers: candidate.executionBlockers.map(blocker => ({
      id: blocker.id,
      title: blocker.title,
      status: blocker.status ?? null,
    })),
    structuralBlockers: candidate.structuralBlockers.map(compactPrimitiveRef),
    suggestedPrimitiveProofTasks: candidate.suggestedPrimitiveProofTasks.map(suggested => ({
      primitiveId: suggested.primitiveId,
      primitiveLabel: suggested.primitiveLabel,
      title: suggested.title,
      reason: suggested.reason,
      delivery: suggested.delivery as unknown as JsonRecord,
    })),
    rank: candidate.rank,
    why: candidate.why,
  }
}

function edgeKey(edge: DeliveryEdge): string {
  return `${edge.sourceTaskId}\0${edge.relation}\0${edge.targetId}\0${edge.contextId ?? ''}`
}

function edgesForRelationship(relationship: TaskRelationshipSummary): DeliveryEdge[] {
  const edges: DeliveryEdge[] = []
  const add = (relation: DeliveryEdgeRelation, targetId: string, contextId: string | null = null): void => {
    if (!targetId) return
    edges.push({ sourceTaskId: relationship.task.id, relation, targetId, contextId })
  }
  if (relationship.hierarchy.parent) add('parent', relationship.hierarchy.parent.id)
  for (const child of relationship.hierarchy.children) add('child', child.id)
  for (const blocker of relationship.dependencies.directBlockers) add('direct_blocker', blocker.id)
  for (const blocker of relationship.dependencies.recursiveBlockers) add('recursive_blocker', blocker.id)
  for (const dependent of relationship.dependencies.blocks) add('blocks', dependent.id)
  for (const breadcrumb of relationship.hierarchy.breadcrumbs) add('breadcrumb', breadcrumb.id)
  for (const support of relationship.supports) add('supports', support)
  for (const primitive of relationship.primitiveUse.direct) add('primitive_use', primitive.id)
  for (const primitive of relationship.primitiveUse.ancestors) add('primitive_ancestor', primitive.id)
  for (const primitive of relationship.primitiveProof.proves) add('primitive_proof', primitive.id)
  for (const [primitiveId, provingTasks] of Object.entries(relationship.primitiveProof.provingTasksByPrimitive)) {
    for (const provingTask of provingTasks) add('proving_task', provingTask.id, primitiveId)
  }
  const unique = new Map(edges.map(edge => [edgeKey(edge), edge]))
  return [...unique.values()]
}

function createProjectionTables(database: DatabaseSync): void {
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

function readMeta(database: DatabaseSync): DeliveryMeta | null {
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
    validation: parseJson(row.validation_json, { valid: false, errors: [], warnings: [] }) as DeliveryModelValidation,
  }
}

function staleReason(
  source: DeliveryReadRevision,
  current: DeliveryReadCurrentRevision,
): DeliveryReadStaleReason | null {
  if (source.queueRevision !== current.queueRevision) return 'queue_revision_changed'
  if (source.projectRevision !== current.projectRevision) return 'project_revision_changed'
  if (source.deliveryUpdatedAt !== current.deliveryUpdatedAt) return 'delivery_model_changed'
  return null
}

function readTaskRowsByIds(
  database: DatabaseSync,
  taskIds: readonly string[],
): Map<string, DeliveryTaskSummary> {
  const rows = readCompactRows(database, taskIds)
  return taskSummariesFromRows(database, rows)
}

function taskRefMap(
  rows: ReadonlyMap<string, DeliveryTaskSummary>,
  ids: readonly string[],
): DeliveryTaskRef[] {
  return ids.flatMap(id => {
    const task = rows.get(id)
    return task ? [{ id: task.id, title: task.title, status: task.status }] : []
  })
}

function readEdges(database: DatabaseSync, taskId: string): DeliveryEdge[] {
  if (!tableExists(database, EDGE_TABLE)) return []
  const rows = database.prepare(`
    SELECT source_task_id, relation, target_id, context_id
    FROM ${EDGE_TABLE}
    WHERE source_task_id = ?
    ORDER BY relation, rowid
  `).all(taskId) as JsonRecord[]
  return rows.flatMap(row => {
    const relation = stringValue(row.relation)
    const sourceTaskId = stringValue(row.source_task_id)
    const targetId = stringValue(row.target_id)
    if (!sourceTaskId || !targetId || !relation) return []
    return [{
      sourceTaskId,
      relation: relation as DeliveryEdgeRelation,
      targetId,
      contextId: stringValue(row.context_id),
    }]
  })
}

function buildTaskRelationships(
  database: DatabaseSync,
  task: DeliveryTaskSummary,
): DeliveryReadTaskRelationships {
  const edges = readEdges(database, task.id)
  const taskIds = edges
    .filter(edge => !edge.relation.startsWith('primitive_') && edge.relation !== 'proving_task')
    .map(edge => edge.targetId)
  const taskRows = readTaskRowsByIds(database, [...new Set(taskIds)])
  const refs = (relation: DeliveryEdgeRelation): DeliveryTaskRef[] => taskRefMap(
    taskRows,
    edges.filter(edge => edge.relation === relation).map(edge => edge.targetId),
  )
  const primitiveIds = (relation: DeliveryEdgeRelation): string[] => [...new Set(
    edges.filter(edge => edge.relation === relation).map(edge => edge.targetId),
  )]
  const provingTasksByPrimitive: Record<string, DeliveryTaskRef[]> = {}
  for (const edge of edges.filter(edge => edge.relation === 'proving_task')) {
    const provingTask = taskRows.get(edge.targetId)
    if (!provingTask || !edge.contextId) continue
    ;(provingTasksByPrimitive[edge.contextId] ??= []).push({
      id: provingTask.id,
      title: provingTask.title,
      status: provingTask.status,
    })
  }
  const parent = refs('parent')[0]
  return {
    hierarchy: {
      ...(parent ? { parent } : {}),
      children: refs('child'),
      breadcrumbs: refs('breadcrumb'),
    },
    dependencies: {
      directBlockers: refs('direct_blocker'),
      recursiveBlockers: refs('recursive_blocker'),
      blocks: refs('blocks'),
    },
    supports: [...new Set(edges.filter(edge => edge.relation === 'supports').map(edge => edge.targetId))],
    primitiveUse: {
      direct: primitiveIds('primitive_use'),
      ancestors: primitiveIds('primitive_ancestor'),
    },
    primitiveProof: {
      proves: primitiveIds('primitive_proof'),
      provingTasksByPrimitive,
    },
  }
}

function readQueuePage(
  database: DatabaseSync,
  options: DeliveryQueuePageOptions = {},
): DeliveryQueuePage {
  const limit = clampLimit(options.limit, 50)
  const after = options.after
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
  const taskIds = selected.flatMap(row => stringValue(row.task_id) ? [String(row.task_id)] : [])
  const tasks = readTaskRowsByIds(database, taskIds)
  const candidates = selected.flatMap(row => {
    const taskId = stringValue(row.task_id)
    const task = taskId ? tasks.get(taskId) : null
    const payload = parseJson(row.candidate_json, null)
    if (!taskId || !task || !isRecord(payload)) return []
    return [{ task, ...payload } as DeliveryReadCandidate]
  })
  const runnable = candidates.filter(candidate => candidate.runnable)
  const blocked = candidates.filter(candidate => !candidate.runnable)
  const last = selected.at(-1)
  return {
    runnable,
    blocked,
    ...(runnable[0] ? { firstRunnable: runnable[0] } : {}),
    hasMore: rows.length > limit,
    ...(rows.length > limit && last
      ? { nextCursor: { rank: Number(last.rank), taskId: String(last.task_id) } }
      : {}),
  }
}

function readPrimitivePage(
  database: DatabaseSync,
  limitValue: number | undefined,
  after: string | undefined,
): DeliveryPrimitivePage {
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
  const primitives = selected.flatMap(row => {
    const payload = parseJson(row.payload_json, null)
    return isRecord(payload) ? [payload as unknown as PrimitiveWithRelations] : []
  })
  const hasMore = rows.length > limit
  const last = selected.at(-1)
  return {
    primitives,
    hasMore,
    ...(hasMore && last?.primitive_id ? { nextCursor: String(last.primitive_id) } : {}),
  }
}

function currentProjection(
  database: DatabaseSync,
  projectRoot: string,
  options: DeliveryReadProjectionReadOptions,
  model: ProjectDeliveryModelRecord,
  currentSource: DeliveryReadCurrentRevision,
): DeliveryReadProjectionCurrent | DeliveryReadProjectionStale | DeliveryReadProjectionMissing {
  const meta = readMeta(database)
  if (!meta) return { status: 'missing', freshness: 'missing', reason: 'projection_missing' }
  if (meta.schemaVersion !== DELIVERY_READ_PROJECTION_SCHEMA_VERSION) {
    return { status: 'missing', freshness: 'missing', reason: 'projection_schema_mismatch' }
  }
  const source: DeliveryReadRevision = {
    ...meta.source,
    deliveryUpdatedAt: meta.source.deliveryUpdatedAt,
  }
  const current = {
    ...currentSource,
    deliveryUpdatedAt: deliveryModelToken(projectRoot, model),
  }
  const reason = staleReason(source, current)
  if (reason) {
    return {
      status: 'stale',
      freshness: 'stale',
      reason,
      source,
      current,
    }
  }
  const taskRequested = options.taskId !== undefined
  const taskRows = taskRequested && options.taskId
    ? readTaskRowsByIds(database, [options.taskId])
    : new Map<string, DeliveryTaskSummary>()
  const task = options.taskId ? taskRows.get(options.taskId) ?? null : null
  const queue = options.queue === false ? null : readQueuePage(database, options.queue)
  return {
    status: 'current',
    freshness: 'current',
    source,
    model,
    validation: meta.validation,
    selectedReleaseId: meta.selectedReleaseId,
    queue,
    primitives: readPrimitivePage(database, options.primitiveLimit, options.primitiveAfter),
    task,
    taskState: !taskRequested ? 'not_requested' : task ? 'present' : 'missing',
    relationships: task ? buildTaskRelationships(database, task) : null,
  }
}

export async function readProjectDeliveryReadProjection(
  projectRoot: string,
  options: DeliveryReadProjectionReadOptions = {},
): Promise<DeliveryReadProjection> {
  const database = openDatabase(projectRoot, true)
  if (!database) {
    return {
      status: 'missing',
      freshness: 'missing',
      reason: existsSync(projectStateDatabasePath(projectRoot)) ? 'database_unavailable' : 'database_missing',
    }
  }
  try {
    const currentSource = readDatabaseSource(database)
    if (!currentSource) return { status: 'missing', freshness: 'missing', reason: 'source_state_missing' }
    let model: ProjectDeliveryModelRecord
    try {
      model = await readProjectDeliveryModel(projectRoot)
    } catch (error) {
      return {
        status: 'missing',
        freshness: 'missing',
        reason: 'delivery_model_unavailable',
        detail: error instanceof Error ? error.message : String(error),
      }
    }
    currentSource.deliveryUpdatedAt = deliveryModelToken(projectRoot, model)
    return currentProjection(database, projectRoot, options, model, currentSource)
  } finally {
    database.close()
  }
}

export function readProjectDeliveryTaskProjection(
  projectRoot: string,
  taskId: string,
): Promise<DeliveryReadProjection> {
  return readProjectDeliveryReadProjection(projectRoot, { queue: false, taskId })
}

export function readProjectDeliveryQueuePage(
  projectRoot: string,
  options: DeliveryQueuePageOptions = {},
): Promise<DeliveryReadProjection> {
  return readProjectDeliveryReadProjection(projectRoot, { queue: options })
}

export async function refreshProjectDeliveryReadProjection(
  projectRoot: string,
): Promise<DeliveryReadProjectionRefreshResult> {
  const database = openDatabase(projectRoot, false)
  if (!database) {
    return {
      status: 'missing',
      reason: existsSync(projectStateDatabasePath(projectRoot)) ? 'database_unavailable' : 'database_missing',
    }
  }
  try {
    const currentSource = readDatabaseSource(database)
    if (!currentSource) return { status: 'missing', reason: 'source_state_missing' }
    const model = await readProjectDeliveryModel(projectRoot)
    const source: DeliveryReadRevision = {
      ...currentSource,
      deliveryUpdatedAt: deliveryModelToken(projectRoot, model),
      refreshedAt: new Date().toISOString(),
    }
    const rows = readCompactRows(database)
    const tasks = taskMapForDerivation(projectRoot, database, rows)
    const candidateSummary = deriveQueueCandidates({ model, tasks })
    const candidates = [...candidateSummary.runnable, ...candidateSummary.blocked]
    const validation = validateProjectDeliveryModel({ model, tasks, projectRoot })
    const primitiveRelations = listPrimitivesWithRelations(model, tasks)
    const relationships = tasks.map(task => deriveTaskRelationships({ model, tasks, taskId: task.id }))
    const edges = relationships.flatMap(edgesForRelationship)

    createProjectionTables(database)
    database.exec('BEGIN')
    try {
      database.prepare(`DELETE FROM ${META_TABLE}`).run()
      database.prepare(`DELETE FROM ${CANDIDATE_TABLE}`).run()
      database.prepare(`DELETE FROM ${EDGE_TABLE}`).run()
      database.prepare(`DELETE FROM ${PRIMITIVE_TABLE}`).run()
      const insertCandidate = database.prepare(`
        INSERT INTO ${CANDIDATE_TABLE} (task_id, rank, candidate_json)
        VALUES (?, ?, ?)
      `)
      for (const candidate of candidates) {
        insertCandidate.run(candidate.task.id, candidate.rank, json(compactCandidate(candidate)))
      }
      const insertEdge = database.prepare(`
        INSERT OR IGNORE INTO ${EDGE_TABLE} (source_task_id, relation, target_id, context_id)
        VALUES (?, ?, ?, ?)
      `)
      for (const edge of edges) insertEdge.run(edge.sourceTaskId, edge.relation, edge.targetId, edge.contextId)
      const insertPrimitive = database.prepare(`
        INSERT INTO ${PRIMITIVE_TABLE} (primitive_id, payload_json)
        VALUES (?, ?)
      `)
      for (const primitive of primitiveRelations) insertPrimitive.run(primitive.id, json(primitive))
      database.prepare(`
        INSERT INTO ${META_TABLE} (
          id, schema_version, source_queue_revision, source_project_revision,
          source_delivery_updated_at, selected_release_id, validation_json, refreshed_at
        ) VALUES (1, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        DELIVERY_READ_PROJECTION_SCHEMA_VERSION,
        source.queueRevision,
        source.projectRevision,
        source.deliveryUpdatedAt,
        readSelectedReleaseId(database),
        json({ valid: validation.valid, errors: validation.errors, warnings: validation.warnings }),
        source.refreshedAt,
      )
      database.exec('COMMIT')
    } catch (error) {
      try {
        database.exec('ROLLBACK')
      } catch {
        // Preserve the original projection failure.
      }
      throw error
    }
    return {
      status: 'current',
      source,
      taskCount: rows.length,
      candidateCount: candidates.length,
      edgeCount: edges.length,
      primitiveCount: primitiveRelations.length,
    }
  } finally {
    database.close()
  }
}
