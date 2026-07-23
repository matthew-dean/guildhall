import { DatabaseSync } from 'node:sqlite'
import { gzipSync, gunzipSync } from 'node:zlib'
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { assertShippedReleaseMutation, compactTaskEvidenceEvent, compactTaskEvidencePayload, TaskEvidenceEvent } from '@guildhall/core'
import type { TaskEvidenceEvent as TaskEvidenceEventRecord } from '@guildhall/core'
import { ownerInputObjectiveLabel, summarizeCurrentProof, taskExecutionBlocker } from '@guildhall/shared'
import { ensureProjectLocalHistoryDir, getProjectLocalHistoryDir, getProjectSystemStatePath } from './local-history.js'
import { atomicWriteBytes, atomicWriteText } from './atomic.js'
import { emitProjectSummaryInvalidation, type ProjectStateDomain } from './project-summary-invalidation.js'

export const PROJECT_STATE_DATABASE_FILE = 'project-state.db'
/**
 * Schema Migration Decision - `0.13.0/project-projection-jobs`,
 * `0.13.0/project-diagnostics`, and `0.13.1/release-membership`:
 * add compact, coalesced job metadata plus one bounded diagnostic row. The
 * diagnostic row stores only the latest Git/readiness observation, its source
 * revision, and freshness metadata; it has no history or authority over
 * current project state. The release-membership migration adds the single
 * normalized release-to-task relation that replaces JSON membership mirrors.
 * It backfills from the last authoritative release envelope exactly once;
 * ordinary reads never union or choose between the old mirrors.
 */
/**
 * Schema Migration Decision - `0.13.3/project-memory-health-read-model`:
 * add one bounded, revisioned memory-health row. The row stores only the
 * latest compact health projection; memory-store records and context-debug
 * ledgers remain explicit source/detail data and are never read by ordinary
 * project GETs. Older databases receive an empty table on writable open and
 * the asynchronous memory projector populates it at the current revision.
 */
/**
 * Schema Migration Decision - `0.13.4/project-memory-health-obligation`:
 * schedule the memory-health projection for every authoritative current-state
 * revision and enqueue it once for databases upgraded from schema 31. This
 * closes the gap where a database could have the bounded table but no durable
 * obligation to populate it. No source/detail data changes and no compatibility
 * reader is needed; the projector owns the single read-model write.
 */
/**
 * Schema Migration Decision - `0.13.2/task-dependency-index`:
 * add the normalized `task_dependencies` relation and index so current task
 * detail can answer direct dependency and dependent questions without
 * scanning every work-item definition. Existing `depends_on_json` values are
 * backfilled when an older database opens; subsequent queue, batch, and point
 * mutations maintain the relation in the same transaction as the task write.
 */
/**
 * Schema Migration Decision - `0.12.47/project-thread-history-read-model`:
 * add the bounded `thread_history_state` metadata row and per-turn
 * `thread_history` table. History is written only alongside the existing
 * current-Thread projection boundary, capped at 2,000 sanitized turns, and
 * read with one page-sized SQL query. Existing task, chat, intake, approval,
 * and source-history records are unchanged; the migration creates empty
 * history tables and the next projection refresh populates them.
 */
/**
 * Schema Migration Decision - `0.13.7/historical-artifact-registry`: add a
 * metadata-only registry for user-local history, diagnostics, review
 * transport, migration rollback, and evacuation artifacts. Payloads remain in
 * their existing bounded files; the registry supplies one project-wide
 * ownership, byte-accounting, and lifecycle boundary without loading those
 * bodies into current-state reads.
 */
/**
 * Schema Migration Decision - `0.13.5/source-capability-authority`:
 * adapter-owned capabilities and task-to-capability bindings are normalized
 * here. Task detail JSON is hydrated for compatibility and stripped before
 * persistence. Existing prose/source claims are not backfilled because they
 * cannot author stable capability identities.
 */
export const PROJECT_STATE_DATABASE_SCHEMA_VERSION = 35
export const PROJECT_STATE_DATABASE_THREAD_HISTORY_MAX_TURNS = 2_000
export const PROJECT_STATE_DATABASE_THREAD_HISTORY_MAX_BYTES = 512 * 1024
export const PROJECT_STATE_DATABASE_DIAGNOSTIC_PROJECTION_DOMAIN = 'diagnostics'
export const PROJECT_STATE_DATABASE_MEMORY_HEALTH_PROJECTION_DOMAIN = 'memory'
export const PROJECT_STATE_DATABASE_DIAGNOSTIC_MAX_BLOCKERS = 12
export const PROJECT_STATE_DATABASE_DIAGNOSTIC_MAX_TEXT_LENGTH = 240
export const PROJECT_STATE_DATABASE_DIAGNOSTIC_MAX_BYTES = 32 * 1024
export const PROJECT_STATE_DETAIL_FILE = 'queue-details.json'
export const PROJECT_STATE_COMPRESSED_DETAIL_FILE = 'queue-details.json.gz'

type JsonRecord = Record<string, unknown>

export type ProjectStateDatabaseAuthority = 'legacy' | 'database'

/**
 * The source-selection token for current project state. Authority and its
 * revision belong together: callers must not decide which store to read from
 * using a marker read that is unrelated to the queue they then consume.
 */
export interface ProjectStateDatabaseAuthoritySnapshot {
  authority: ProjectStateDatabaseAuthority
  projectRevision: number
  queueRevision: number | null
}
export type ProjectStateDatabaseTaskEvidenceAuthority = 'legacy' | 'database' | 'compressed'

export interface ProjectStateDatabaseSnapshot {
  queue: unknown
  summary: unknown
  /** Current execution is written through its dedicated row, never from the summary payload. */
  execution?: ProjectStateDatabaseExecution
  /** Current runtime is written through its dedicated row, never from the summary payload. */
  runtime?: ProjectStateDatabaseRuntime
  scopeRows?: ProjectStateDatabaseScopeRow[]
  /**
   * Complete structured-adapter catalog snapshot. `undefined` preserves the
   * catalog for compatibility; an explicit empty array clears it atomically.
   */
  sourceCapabilities?: readonly ProjectStateDatabaseSourceCapability[]
  /** Replace normalized runtime rows in the same commit as the queue. */
  taskRuntimes?: readonly ProjectStateDatabaseTaskRuntime[]
  /** Replace normalized workspace rows in the same commit as the queue. */
  taskWorkspaces?: readonly ProjectStateDatabaseTaskRuntime[]
  /** Append bounded evidence in the same commit as the queue. */
  evidence?: readonly {
    event: TaskEvidenceEventRecord
    retention: ProjectStateDatabaseTaskEvidenceRetentionInput
  }[]
  /** Workspace root for first-write cache provenance; omitted by low-level migration callers. */
  projectRoot?: string
  /**
   * Explicit migration-only request to retain the retired compressed queue
   * sidecar while older conversion steps are still running. Normal writes
   * never create a second queue representation.
   */
  compatibilityExport?: 'full' | 'compact'
  /**
   * Queue replacement precondition. A value of null means the queue must not
   * exist yet; an omitted value preserves the legacy unconditional writer for
   * migration/bootstrap callers until they opt into compare-and-swap.
   */
  expectedQueueRevision?: number | null
  /** Derived domains to enqueue with this authoritative queue revision. */
  projectionDomains?: readonly string[]
}

/**
 * One current work-item mutation for a promoted project. The summary is
 * required because a task revision and its compact answer must commit
 * together; callers may not leave the database with a silently stale summary.
 */
export interface ProjectStateDatabaseTaskMutation {
  task: Record<string, unknown>
  summary: Record<string, unknown>
  expectedQueueRevision: number
  expectedProjectRevision: number
  lastUpdated?: string | null
  /** Omit to preserve the existing scope row; null removes it. */
  scopeRow?: ProjectStateDatabaseScopeRow | null
  /**
   * Derived scope rows changed by this point definition edit. A task brief or
   * hierarchy fact can change a parent/child's selected-scope handoff state,
   * so the normalized ledger may need more than the edited task's row.
   */
  scopeRows?: readonly ProjectStateDatabaseScopeRow[]
  /** Derived rows that disappeared during the same scope refresh. */
  removeScopeRowTaskIds?: readonly string[]
  /**
   * Evidence written with the task mutation. This keeps current task detail,
   * proof, and bounded evidence history under one SQLite transaction.
   */
  evidence?: readonly {
    event: TaskEvidenceEventRecord
    retention: ProjectStateDatabaseTaskEvidenceRetentionInput
  }[]
  /** Derived domains to enqueue with this authoritative project revision. */
  projectionDomains?: readonly string[]
}

/**
 * Change the selected release without replacing unrelated task definitions.
 * The summary and affected scope rows are supplied by the shared projection
 * builder so this transaction cannot invent a second release interpretation.
 */
export interface ProjectStateDatabaseReleaseSelectionMutation {
  releases: readonly JsonRecord[]
  selectedReleaseId: string
  summary: JsonRecord
  scopeRows: readonly ProjectStateDatabaseScopeRow[]
  expectedQueueRevision: number
  expectedProjectRevision: number
  lastUpdated?: string | null
  /** Derived domains to enqueue with this authoritative project revision. */
  projectionDomains?: readonly string[]
}

/**
 * Commit one structural current-state delta. The caller supplies only
 * changed/new task definitions, the affected relationship/scope rows, and an
 * optional queue envelope. Untouched task/detail rows remain in place. This
 * is the one normalized write boundary for hierarchy, dependency, release,
 * and planning-envelope changes.
 */
export interface ProjectStateDatabaseTaskBatchMutation {
  tasks: readonly JsonRecord[]
  removeTaskIds?: readonly string[]
  scopeRows?: readonly ProjectStateDatabaseScopeRow[]
  removeScopeRowTaskIds?: readonly string[]
  /** Upsert adapter-owned capabilities before validating task bindings. */
  sourceCapabilities?: readonly ProjectStateDatabaseSourceCapability[]
  releases?: readonly JsonRecord[]
  selectedReleaseId?: string | null
  executionPlanActions?: readonly JsonRecord[]
  scopeAuthorityRequests?: readonly JsonRecord[]
  evidence?: readonly {
    event: TaskEvidenceEventRecord
    retention: ProjectStateDatabaseTaskEvidenceRetentionInput
  }[]
  /** Replace runtime overlays in the same revision-guarded structural write. */
  taskRuntimes?: readonly ProjectStateDatabaseTaskRuntime[]
  summary: JsonRecord
  expectedQueueRevision: number
  expectedProjectRevision: number
  lastUpdated?: string | null
  /** Derived domains to enqueue with this authoritative project revision. */
  projectionDomains?: readonly string[]
}

export type ProjectStateDatabaseCapabilityState = 'planned' | 'retired'
export type ProjectStateDatabaseCapabilityRelation = 'plans' | 'implements' | 'integrates' | 'proves' | 'reviews'

/** Stable adapter-owned scope fact. Labels are display material, never identity. */
export interface ProjectStateDatabaseSourceCapability {
  id: string
  adapterId: string
  adapterSchemaVersion: number
  sourceRevision: string
  label: string
  state: ProjectStateDatabaseCapabilityState
  releaseIds: readonly string[]
  dependsOnCapabilityIds: readonly string[]
  evidenceRefs: readonly string[]
}

/** The one normalized relation allocating a capability to a work item. */
export interface ProjectStateDatabaseTaskCapabilityBinding {
  taskId: string
  capabilityId: string
  relation: ProjectStateDatabaseCapabilityRelation
}

/**
 * Refresh derived summary/scope rows without pretending the queue changed.
 * Queue replacement owns queue_state, indexed task detail, and the queue revision;
 * projection refresh owns only these read-model tables.
 */
export interface ProjectStateDatabaseSummarySnapshot {
  summary: unknown
  /**
   * The task-status and scope rows produced by one current projection pass.
   * Keeping them in one value makes it explicit that compact status and scope
   * are a pair, not independently authored summaries.
   */
  currentProjection?: ProjectStateDatabaseCurrentProjection
  /** @deprecated Use currentProjection for runtime projection writes. */
  scopeRows?: ProjectStateDatabaseScopeRow[]
  /**
   * Current status facts derived by the shared projection builder. These are
   * indexed beside scope rows so compact and rich reads share one current
   * status without copying evidence/detail payloads into the summary.
   */
  taskStatusRows?: readonly ProjectStateDatabaseTaskStatusRow[]
  /** Compare-and-swap guard for evidence/runtime writes that do not change the queue revision. */
  expectedProjectRevision?: number | null
  expectedQueueRevision?: number | null
}

export interface ProjectStateDatabaseCurrentProjection {
  taskStatusRows: readonly ProjectStateDatabaseTaskStatusRow[]
  scopeRows: readonly ProjectStateDatabaseScopeRow[]
}

export interface ProjectStateDatabaseTaskStatusRow {
  taskId: string
  status: string | null
  completedAt?: string | null
}

export interface ProjectStateDatabaseQueueRead {
  definition: ProjectStateDatabaseQueueDefinition
  revision: number
  projectRevision: number
}

/**
 * Derived membership for the selected project scope. It is written with the
 * queue snapshot so compact Work reads can annotate one indexed task page
 * without rebuilding scope from every work item.
 */
export interface ProjectStateDatabaseScopeRow {
  taskId: string
  /** Parent identity comes from the normalized work_items row, not a queue re-read. */
  parentTaskId?: string
  scope: 'included' | 'deferred'
  eligibilityReason: string
  hierarchyRole: string
  handoffState: string
  blocksStart: boolean
  blocksRelease: boolean
  humanBlocking: boolean
  /** Hidden child work can gate a release without inflating progress totals. */
  countInProjectTotals?: boolean
  proofBlocked?: boolean
  blockerSummary?: string
  sourceRefs: string[]
}

export type ProjectStateDatabaseReleaseDisposition = 'included' | 'deferred'

export interface ProjectStateDatabaseReleaseMembership {
  releaseId: string
  taskId: string
  disposition: ProjectStateDatabaseReleaseDisposition
}

/** One watermark for the normalized release-membership relation. */
export interface ProjectStateDatabaseReleaseMembershipState {
  membershipRevision: number
  projectRevision: number | null
  updatedAt: string | null
}

export interface ProjectStateDatabaseTaskRuntime {
  taskId: string
  updatedAt?: string
  payload: unknown
}

export interface ProjectStateDatabaseTaskProof {
  taskId: string
  kind: string
  recordedAt: string
  id?: string
  payload: unknown
}

/**
 * Structural input accepted from the existing task evidence retention policy.
 * The SQLite boundary owns no default policy, so callers cannot accidentally
 * create a second retention source.
 */
export interface ProjectStateDatabaseTaskEvidenceRetentionInput {
  maxRecords: number
  maxBytes: number
}

export interface ProjectStateDatabaseTaskEvidenceCurrentRecord {
  id: string
  recordedAt: string
  payload: JsonRecord
}

/**
 * Bounded current evidence facts for one task. This is not the evidence
 * ledger: it is the small projection ordinary status reads can use without
 * replaying JSONL. The ledger remains the historical/detail source.
 */
export interface ProjectStateDatabaseTaskEvidenceCurrent {
  taskId: string
  updatedAt: string
  version: 1
  byKind: Record<string, ProjectStateDatabaseTaskEvidenceCurrentRecord[]>
}

export interface ProjectStateDatabaseTaskEvidenceCurrentManyRead {
  records: Map<string, ProjectStateDatabaseTaskEvidenceCurrent>
  projectAuthority: ProjectStateDatabaseAuthority
  queueRevision: number | null
  projectRevision: number | null
}

/**
 * The small mutable part of a task. Task definitions and historical evidence
 * deliberately live outside this read: callers that need either must opt in.
 */
export interface ProjectStateDatabaseTaskOverlay {
  runtime?: ProjectStateDatabaseTaskRuntime
  workspace?: ProjectStateDatabaseTaskRuntime
  latestProof?: ProjectStateDatabaseTaskProof & { result: string | null }
  evidenceCurrent?: ProjectStateDatabaseTaskEvidenceCurrent
}

export interface ProjectStateDatabaseTaskOverlayStores {
  runtime: ProjectStateDatabaseTaskRuntime[]
  workspace: ProjectStateDatabaseTaskRuntime[]
  /** Bounded current evidence keyed by task; history is intentionally absent. */
  evidenceCurrent: Map<string, ProjectStateDatabaseTaskEvidenceCurrent>
}

export interface ProjectStateDatabaseExecution {
  status: string
  mode?: string | null
  startedAt?: string | null
  stoppedAt?: string | null
  stopRequestedAt?: string | null
  error?: string | null
  activeTaskId?: string | null
  activeTaskTitle?: string | null
  updatedAt: string
  payload?: unknown
}

export interface ProjectStateDatabaseRuntime {
  status: string
  health?: string | null
  lastActivityAt?: string | null
  updatedAt: string
  payload?: unknown
}

export interface ProjectStateDatabaseOwnerInput {
  id: string
  status: string
  prompt: string
  taskId?: string | null
  updatedAt: string
  payload?: unknown
}

export interface ProjectStateDatabaseRepository {
  id: string
  root: string
  branch?: string | null
  head?: string | null
  status?: string | null
  freshness: 'current' | 'stale' | 'unknown'
  inspectedAt?: string | null
  payload?: unknown
}

export interface ProjectStateDatabaseDiagnosticBlocker {
  id: string
  label: string
  state?: string
  reason?: string
  nextAction?: string
  repoId?: string
  taskId?: string
}

export interface ProjectStateDatabaseGitDiagnosticObservation {
  ready: boolean
  state: string
  blockerCount: number
  blockers: ProjectStateDatabaseDiagnosticBlocker[]
}

export interface ProjectStateDatabaseReadinessDiagnosticObservation {
  ready: boolean
  code: string | null
  message: string | null
  blockerCount: number
  unfinishedCount: number
  /** Bounded union of saved task, proof, repository, and checkout blockers. */
  blockers?: ProjectStateDatabaseDiagnosticBlocker[]
}

export type ProjectStateDatabaseDiagnosticFreshness = 'current' | 'stale'

export interface ProjectStateDatabaseDiagnosticProjectionSnapshot {
  sourceRevision: number
  freshness: ProjectStateDatabaseDiagnosticFreshness
  generatedAt: string
  git: ProjectStateDatabaseGitDiagnosticObservation | null
  readiness: ProjectStateDatabaseReadinessDiagnosticObservation | null
}

export interface ProjectStateDatabaseDiagnosticProjection extends ProjectStateDatabaseDiagnosticProjectionSnapshot {
  updatedAt: string
}

export interface ProjectStateDatabaseDiagnosticProjectionWriteOptions {
  updatedAt?: string
}

export interface ProjectStateDatabaseMemoryHealthProjection<T = unknown> {
  sourceRevision: number
  freshness: 'current' | 'stale'
  generatedAt: string
  payload: T
}

export interface ProjectStateDatabaseMetadata {
  schemaVersion: number
  revision: number
  updatedAt: string
  projectStateAuthority?: ProjectStateDatabaseAuthority
  taskEvidenceAuthority?: ProjectStateDatabaseTaskEvidenceAuthority
  summaryRevision?: number | null
  summaryFreshness?: 'current' | 'stale' | 'missing'
}

/**
 * One evidence read boundary. Historical evidence may live in a compact
 * detail store, but its project authority and revision are still captured
 * beside that choice so callers cannot mistake storage format for state
 * authority or join it to an unrelated project revision.
 */
export interface ProjectStateDatabaseTaskEvidenceBoundary {
  projectAuthority: 'database' | 'legacy'
  evidenceAuthority: ProjectStateDatabaseTaskEvidenceAuthority
  projectRevision: number | null
}

export interface ProjectStateDatabaseAvailability {
  status: 'active' | 'paused'
  pausedAt: string | null
  resumedAt: string | null
  reason?: string
}

export interface ProjectStateDatabaseAttentionRecord<T = unknown> {
  id: string
  status: string
  updatedAt: string
  payload: T
}

export interface ProjectStateDatabaseProjectionWatermark {
  domain: string
  sourceRevision: number
  refreshedAt: string
}

export type ProjectStateDatabaseProjectionJobStatus = 'pending' | 'running' | 'failed' | 'succeeded'

export interface ProjectStateDatabaseProjectionJob {
  id: number
  domain: string
  sourceRevision: number
  status: ProjectStateDatabaseProjectionJobStatus
  error: string | null
  attempts: number
  claimedAt: string | null
  lastAttemptAt: string | null
  completedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface ProjectStateDatabaseProjectionJobReadOptions {
  status?: ProjectStateDatabaseProjectionJobStatus | readonly ProjectStateDatabaseProjectionJobStatus[]
  limit?: number
}

export interface ProjectStateDatabaseProjectionJobWriteOptions {
  now?: string
  sourceRevision?: number
  error?: string | null
}

export interface ProjectStateDatabaseReconciliation<T = unknown> {
  capabilityId: string
  status: string
  resolvedAt: string
  payload: T
}

export type ProjectHistoricalArtifactKind =
  | 'essential_history'
  | 'context_debug'
  | 'review_transport'
  | 'migration_snapshot'
  | 'evacuation_batch'
  | 'other'

export type ProjectHistoricalArtifactRetentionClass =
  | 'essential'
  | 'diagnostic'
  | 'rollback'
  | 'archive'
  | 'unclassified'

export type ProjectHistoricalArtifactState =
  | 'active'
  | 'replaced'
  | 'pinned'
  | 'unclassified'

export interface ProjectHistoricalArtifact {
  artifactId: string
  kind: ProjectHistoricalArtifactKind
  owner: string
  logicalRef: string
  createdAt: string
  lastVerifiedAt: string | null
  bytes: number
  sha256: string | null
  retentionClass: ProjectHistoricalArtifactRetentionClass
  state: ProjectHistoricalArtifactState
  replacementRef: string | null
  sourceRevision: string | null
}

export interface ProjectHistoricalArtifactInput {
  artifactId: string
  kind: ProjectHistoricalArtifactKind
  owner: string
  logicalRef: string
  createdAt?: string
  lastVerifiedAt?: string | null
  bytes: number
  sha256?: string | null
  retentionClass: ProjectHistoricalArtifactRetentionClass
  state?: ProjectHistoricalArtifactState
  replacementRef?: string | null
  sourceRevision?: string | null
}

export interface ProjectHistoricalRetentionSummary {
  totalBytes: number
  totalArtifacts: number
  unclassifiedArtifacts: number
  byKind: Record<string, { artifacts: number; bytes: number }>
  byRetentionClass: Record<string, { artifacts: number; bytes: number }>
}

export interface ProjectStateDatabaseSummary<T = unknown> {
  payload: T
  freshness: 'current' | 'stale'
  generatedAt: string
  sourceQueueLastUpdated: string | null
}

/**
 * One read snapshot for current project state. Queue identity, scope
 * membership, and the saved summary are deliberately returned together so a
 * caller cannot mix projections from different database revisions.
 */
export interface ProjectStateDatabaseCurrentState<T = unknown> {
  queue: ProjectStateDatabaseQueueDefinition
  queueRevision: number
  projectRevision: number
  scopeRows: ProjectStateDatabaseScopeRow[]
  repositories: ProjectStateDatabaseRepository[]
  diagnostics: ProjectStateDatabaseDiagnosticProjection | null
  memoryHealth: ProjectStateDatabaseMemoryHealthProjection | null
  summary: ProjectStateDatabaseSummary<T> | null
  /** Mutable task overlays captured by the same SQLite read transaction. */
  taskOverlays: ProjectStateDatabaseTaskOverlayStores | null
}

/**
 * One bounded snapshot for compact project surfaces. The queue is only its
 * envelope; the paged inventory owns task rows so a list read never expands
 * into the full detail store.
 */
export interface ProjectStateDatabaseProjectionState<T = unknown> {
  queue: ProjectStateDatabaseQueue
  queueRevision: number
  projectRevision: number
  scopeRows: ProjectStateDatabaseScopeRow[]
  inventory: ProjectStateDatabaseInventory
  /** Optional selected task captured from the same SQLite snapshot. */
  selectedTask: ProjectStateDatabaseTask | null
  repositories: ProjectStateDatabaseRepository[]
  diagnostics: ProjectStateDatabaseDiagnosticProjection | null
  summary: ProjectStateDatabaseSummary<T> | null
}

/**
 * One bounded saved surface read. The individual fields are views for
 * different routes, but they are captured by the same SQLite snapshot and
 * therefore share one project/queue revision pair.
 */
export interface ProjectStateDatabaseSurfaceState<T = unknown> {
  /** Effective source authority captured with the queue/revision snapshot. */
  authority: 'database' | 'legacy'
  projection: ProjectStateDatabaseProjectionState<T> | null
  /** Saved compact summary captured even when the task projection is omitted. */
  summary: ProjectStateDatabaseSummary<T> | null
  taskDetail: ProjectStateDatabaseTaskDetailState<T> | null
  queueRevision: number | null
  projectRevision: number | null
  thread: ProjectStateDatabaseThreadSurfaceState<unknown> | null
  attentionRecords: ProjectStateDatabaseAttentionRecord<unknown>[] | null
  attentionWatermark: ProjectStateDatabaseProjectionWatermark | null
  memoryHealth: ProjectStateDatabaseMemoryHealthProjection | null
  availability: ProjectStateDatabaseAvailability | null
}

/**
 * One small project shell snapshot for fleet cards and status chips. Unlike a
 * compact surface read, this never opens the task inventory or detail index.
 * The summary, authority, and revisions still come from one SQLite
 * transaction, so a shell cannot accidentally select a second current-state
 * source just because it only needs counts.
 */
export interface ProjectStateDatabaseShellState<T = unknown> {
  authority: 'database' | 'legacy'
  summary: ProjectStateDatabaseSummary<T> | null
  queueRevision: number | null
  projectRevision: number | null
}

export interface ProjectStateDatabaseSurfaceReadOptions extends ProjectStateDatabaseProjectionReadOptions, ProjectStateDatabaseSummaryReadOptions {
  /** Omit the bounded task/summary projection for shell-only surfaces. */
  includeProjection?: boolean
  /** Include the saved current Thread row. */
  includeThread?: boolean
  /** Include saved Inbox/attention records and their freshness watermark. */
  includeAttention?: boolean
  /** Include saved project availability. */
  includeAvailability?: boolean
  /** Include the saved bounded memory-health projection. */
  includeMemoryHealth?: boolean
}

/**
 * The single current-state read primitive. Public readers below are named
 * views over this snapshot; they do not get to choose another source.
 *
 * Detail is opt-in because the same authority must serve fleet shells and
 * rich task/release reads without forcing every ordinary request to inflate
 * every task definition. The transaction and revision pair are shared even
 * when a view asks for only one bounded shape.
 */
export interface ProjectStateDatabaseReadBundle<T = unknown> {
  authority: 'database' | 'legacy'
  queueRevision: number | null
  projectRevision: number | null
  /** Small queue envelope: release definitions and selection, never task detail. */
  queue: ProjectStateDatabaseQueue | null
  queueDefinition: ProjectStateDatabaseQueueDefinition | null
  projection: ProjectStateDatabaseProjectionState<T> | null
  taskDetail: ProjectStateDatabaseTaskDetailState<T> | null
  scopeRows: ProjectStateDatabaseScopeRow[]
  repositories: ProjectStateDatabaseRepository[]
  diagnostics: ProjectStateDatabaseDiagnosticProjection | null
  memoryHealth: ProjectStateDatabaseMemoryHealthProjection | null
  summary: ProjectStateDatabaseSummary<T> | null
  /** Bounded current evidence for summary-selected work, when requested. */
  currentEvidence: Map<string, ProjectStateDatabaseTaskEvidenceCurrent> | null
  taskOverlays: ProjectStateDatabaseTaskOverlayStores | null
  thread: ProjectStateDatabaseThreadSurfaceState<unknown> | null
  attentionRecords: ProjectStateDatabaseAttentionRecord<unknown>[] | null
  attentionWatermark: ProjectStateDatabaseProjectionWatermark | null
  availability: ProjectStateDatabaseAvailability | null
}

export interface ProjectStateDatabaseReadBundleOptions extends ProjectStateDatabaseProjectionReadOptions, ProjectStateDatabaseSummaryReadOptions {
  includeQueueDefinition?: boolean
  includeProjection?: boolean
  includeTaskDetail?: boolean
  taskDetailId?: string
  includeTaskOverlays?: boolean
  includeRepositories?: boolean
  includeDiagnostics?: boolean
  includeThread?: boolean
  includeAttention?: boolean
  includeAvailability?: boolean
  includeCurrentEvidence?: boolean
  includeMemoryHealth?: boolean
  /** Include normalized scope membership without expanding the work inventory. */
  includeScopeRows?: boolean
  currentEvidenceTaskIds?: readonly string[]
}

/** One revisioned point/detail read for the task drawer and task APIs. */
export interface ProjectStateDatabaseTaskDetailState<T = unknown> {
  queue: ProjectStateDatabaseQueue
  task: ProjectStateDatabaseTask
  overlay: ProjectStateDatabaseTaskOverlay | null
  relationships: ProjectStateDatabaseTaskRelationships
  /** Related task points captured by the same transaction, when requested. */
  relatedTasks: ProjectStateDatabaseTask[]
  scopeRows: ProjectStateDatabaseScopeRow[]
  /** Availability captured from the same project revision as the task. */
  availability: ProjectStateDatabaseAvailability | null
  queueRevision: number
  projectRevision: number
  summary: ProjectStateDatabaseSummary<T> | null
}

/**
 * One task-detail read together with the source decision that produced it.
 * Route code must not perform a marker read and then reopen the database to
 * find the task; doing both creates a race where a missing task can be
 * explained by the wrong authority.
 */
export interface ProjectStateDatabaseTaskDetailBoundaryState<T = unknown> {
  authority: ProjectStateDatabaseAuthority
  state: ProjectStateDatabaseTaskDetailState<T> | null
}

/**
 * The bounded, durable read model for the ordinary Thread route. The payload
 * is intentionally opaque here: runtime owns Thread's shape, while SQLite
 * owns its current-state lifecycle and revision boundary.
 */
export interface ProjectStateDatabaseCurrentThread<T = unknown> {
  payload: T
  generatedAt: string
  sourceRevision: string | number
  sourceQueueRevision: number | null
  /** Optional historical page replacement in the same write transaction. */
  history?: ProjectStateDatabaseThreadHistoryWrite
}

/** One atomic read for Thread's current projection and freshness watermark. */
export interface ProjectStateDatabaseThreadSurfaceState<T = unknown> {
  thread: ProjectStateDatabaseCurrentThread<T> | null
  queueRevision: number | null
  projectRevision: number | null
}

/** One SQLite snapshot for a historical page and its current-state watermark. */
export interface ProjectStateDatabaseThreadHistorySurfaceState<T = unknown> {
  history: ProjectStateDatabaseThreadHistoryPage<T> | null
  surface: ProjectStateDatabaseThreadSurfaceState<unknown>
}

/** A bounded page from the explicit historical Thread projection. */
export interface ProjectStateDatabaseThreadHistoryPage<T = unknown> {
  turns: T[]
  offset: number
  limit: number
  total: number
  hasMore: boolean
  nextOffset?: number
  sourceRevision: string
  sourceQueueRevision: number | null
  generatedAt: string
  truncated: boolean
}

/** Input for replacing the historical Thread projection at a write boundary. */
export interface ProjectStateDatabaseThreadHistoryWrite<T = unknown> {
  turns: readonly T[]
  sourceRevision: number
  sourceQueueRevision: number | null
  generatedAt: string
  truncated: boolean
}

export interface ProjectStateDatabaseSummaryReadOptions {
  /** Include the project map/orientation projection in the result. */
  includeOrientation?: boolean
  /** Include the imported planning snapshot; fleet shells do not need it. */
  includeApprovedPlan?: boolean
}

export interface ProjectStateDatabaseTaskDetailReadOptions extends ProjectStateDatabaseSummaryReadOptions {
  /** Include the full compact task inventory only for an explicit diagnostic read. */
  includeAggregateTasks?: boolean
  /** Include bounded parent/child/dependency task points in this same snapshot. */
  includeRelatedTasks?: boolean
}

export interface ProjectStateDatabaseTask {
  id: string
  title: string
  description: string | null
  status: string | null
  domain: string | null
  priority: string | null
  workKind: string | null
  /** Stable semantic discriminator used by compact projections, never prose. */
  semanticKind?: string | null
  parentId: string | null
  hierarchy: JsonRecord | null
  dependsOn: string[]
  releaseIds: string[]
  sourceRefs: string[]
  updatedAt: string | null
  completedAt: string | null
  /** Bounded current-plan facts used by compact project projections. */
  currentSummary?: JsonRecord
  definition: JsonRecord
  scopeRow: ProjectStateDatabaseScopeRow | null
}

export interface ProjectStateDatabaseTaskPointRead {
  task: ProjectStateDatabaseTask
  overlay: ProjectStateDatabaseTaskOverlay | null
  revision: number
  projectRevision: number
  /** Authority selected on the same SQLite connection as the point read. */
  projectAuthority: ProjectStateDatabaseAuthority
}

/**
 * One bounded batch of explicit task points and the revisions that contain
 * them. The task list is intentionally point-shaped: it never reconstructs
 * the queue or consults a legacy source when an id is absent.
 */
export interface ProjectStateDatabaseTaskPointsRead {
  tasks: ProjectStateDatabaseTask[]
  queueRevision: number
  projectRevision: number
  /** Authority selected on the same SQLite connection as the point read. */
  projectAuthority: ProjectStateDatabaseAuthority
}

/** One bounded current-task read from the normalized project-state database. */
export interface ProjectStateDatabaseCurrentTasksRead {
  tasks: ProjectStateDatabaseTask[]
  overlays: Map<string, ProjectStateDatabaseTaskOverlay>
  queueRevision: number
  projectRevision: number
  projectAuthority: ProjectStateDatabaseAuthority
}

export interface ProjectStateDatabaseTaskRelationships {
  taskId: string
  parentId: string | null
  childIds: string[]
  dependsOnIds: string[]
  dependentIds: string[]
  scopeRow: ProjectStateDatabaseScopeRow | null
}

export interface ProjectStateDatabaseInventoryOptions {
  offset?: number
  limit?: number
  includeDefinitions?: boolean
}

export interface ProjectStateDatabaseProjectionReadOptions extends ProjectStateDatabaseInventoryOptions {
  /** Include this task point in the same transaction as the compact surface. */
  selectedTaskId?: string
}

export interface ProjectStateDatabaseInventory {
  tasks: ProjectStateDatabaseTask[]
  total: number
  offset: number
  limit: number | null
  hasMore: boolean
}

/**
 * Full current queue shape for detail readers. Unlike an inventory page, this
 * deliberately includes task definitions, but it is still a point read from
 * the database rather than a compatibility-file parse.
 */
export interface ProjectStateDatabaseQueueDefinition {
  version: number
  lastUpdated?: string
  selectedReleaseId?: string
  executionPlanActions?: JsonRecord[]
  scopeAuthorityRequests?: JsonRecord[]
  tasks: JsonRecord[]
  releases: JsonRecord[]
}

interface ProjectStateDatabaseDetailStore extends ProjectStateDatabaseQueueDefinition {
  detailStoreVersion: 1
  revision: number
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function json(value: unknown): string {
  return JSON.stringify(value ?? null)
}

function summaryStorageParts(summary: JsonRecord): {
  compact: JsonRecord
  /** undefined means preserve an existing orientation on a summary patch. */
  orientation: unknown | null | undefined
  /** undefined means preserve an existing source snapshot on a summary patch. */
  approvedPlan: unknown | null | undefined
} {
  const compact = { ...summary }
  const orientation = 'orientationSpine' in compact ? compact.orientationSpine : undefined
  delete compact.orientationSpine
  const approvedPlan = 'approvedPlan' in compact ? compact.approvedPlan : undefined
  delete compact.approvedPlan
  // These mutable facts have dedicated current-state tables. Keeping them in
  // the summary payload created two plausible truths after an overlay write.
  delete compact.execution
  delete compact.runtime
  // Owner-input migration is deliberately separate: older snapshots may only
  // have the compact summary queue, but current reads use owner_inputs once
  // the database schema is present. Migration code imports the old records.
  return { compact, orientation, approvedPlan }
}

function ownerInputProjectionIsAuthoritative(database: DatabaseSync): boolean {
  if (!tableExists(database, 'projection_watermarks')) return false
  return Boolean(database.prepare(`
    SELECT 1
    FROM projection_watermarks
    WHERE domain = 'owner-input'
  `).get())
}

function summaryStoragePartsForDatabase(database: DatabaseSync, summary: JsonRecord): {
  compact: JsonRecord
  orientation: unknown | null | undefined
  approvedPlan: unknown | null | undefined
} {
  const parts = summaryStorageParts(summary)
  // Older databases may have an owner-input summary with no normalized rows
  // yet. Preserve that fallback until the explicit projection cutover has
  // published the owner-input watermark. After that point the current queue
  // is the only owner of this fact, including an intentional empty queue.
  if (ownerInputProjectionIsAuthoritative(database)) delete parts.compact.ownerInput
  return parts
}

/**
 * A compact summary may report release totals only for the membership relation
 * it actually observed. Stamp that relation at the storage boundary, after
 * any normalized membership mutation in the surrounding transaction.
 */
function compactSummaryWithReleaseMembershipRevision(
  database: DatabaseSync,
  compact: JsonRecord,
): JsonRecord {
  const membershipState = readReleaseMembershipStateFromDatabase(database)
  if (!membershipState) {
    const { releaseMembershipRevision: _releaseMembershipRevision, ...withoutMembershipRevision } = compact
    return withoutMembershipRevision
  }
  return {
    ...compact,
    releaseMembershipRevision: membershipState.membershipRevision,
  }
}

function stripStoredOwnerInputSummary(database: DatabaseSync): void {
  const row = database.prepare('SELECT payload_json FROM project_summary WHERE id = 1').get() as JsonRecord | undefined
  if (!row) return
  const summary = parseJson<JsonRecord>(row.payload_json, {})
  const { compact } = summaryStoragePartsForDatabase(database, summary)
  database.prepare('UPDATE project_summary SET payload_json = ? WHERE id = 1').run(
    json(compactSummaryWithReleaseMembershipRevision(database, compact)),
  )
}

/**
 * Persist the independently stored orientation projection with explicit
 * patch semantics. Full snapshots may clear an omitted spine; partial
 * summary/task/release writes must preserve one they did not touch.
 */
function writeProjectOrientationProjection(
  database: DatabaseSync,
  orientation: unknown | null | undefined,
  generatedAt: string,
  revision: number,
  options: { preserveOmitted?: boolean } = {},
): void {
  if (orientation === undefined && options.preserveOmitted === true) return
  if (orientation === null || orientation === undefined) {
    database.prepare('DELETE FROM project_orientation').run()
    return
  }
  database.prepare(`
    INSERT INTO project_orientation (id, payload_json, generated_at, revision)
    VALUES (1, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      payload_json = excluded.payload_json,
      generated_at = excluded.generated_at,
      revision = excluded.revision
  `).run(json(orientation), generatedAt, revision)
}

function compactOwnerInputPayload(payload: unknown): JsonRecord {
  const record = isRecord(payload) ? payload : {}
  const target = isRecord(record.target) ? record.target : null
  const objective = isRecord(record.objective) ? record.objective : null
  const href = stringValue(target?.href)
  const boundedChatSessionId = stringValue(record.boundedChatSessionId)
  const label = stringValue(objective?.label)
  return {
    ...(href ? { target: { href } } : {}),
    ...(boundedChatSessionId ? { boundedChatSessionId } : {}),
    ...(label ? { label: ownerInputObjectiveLabel(label) } : {}),
  }
}

function serializedBytes(value: unknown): number {
  return Buffer.byteLength(json(value), 'utf8')
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function parseStoredJson<T>(value: unknown, label: string): T {
  if (typeof value !== 'string') throw new Error(`Corrupt normalized ${label}: payload is not JSON text`)
  try {
    return JSON.parse(value) as T
  } catch {
    throw new Error(`Corrupt normalized ${label}: invalid JSON payload`)
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function optionalSelectedReleaseId(value: unknown): { selectedReleaseId?: string } {
  const selectedReleaseId = stringValue(value)
  return selectedReleaseId ? { selectedReleaseId } : {}
}

function optionalJsonArray(value: unknown, key: 'executionPlanActions' | 'scopeAuthorityRequests'): Record<string, JsonRecord[]> {
  const parsed = parseJson<unknown>(value, [])
  return Array.isArray(parsed) && parsed.every(isRecord) && parsed.length > 0
    ? { [key]: parsed }
    : {}
}

function optionalLastUpdated(value: unknown): { lastUpdated?: string } {
  const lastUpdated = stringValue(value)
  return lastUpdated ? { lastUpdated } : {}
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}

function taskIdFromReleaseNodeId(value: string): string {
  return value.replace(/^work:/, '').trim()
}

function taskHasInternalReleaseContext(task: JsonRecord): boolean {
  const visibility = task.workVisibility
  return isRecord(visibility) && visibility.countInProjectTotals === false
}

function releaseMembershipFromDefinitions(releases: readonly JsonRecord[]): ProjectStateDatabaseReleaseMembership[] {
  const rows = new Map<string, ProjectStateDatabaseReleaseMembership>()
  for (const release of releases) {
    const releaseId = stringValue(release.id)
    if (!releaseId) continue
    for (const nodeId of stringArray(release.nodeIds)) {
      const taskId = taskIdFromReleaseNodeId(nodeId)
      if (!taskId) continue
      rows.set(`${releaseId}\0${taskId}`, { releaseId, taskId, disposition: 'included' })
    }
    for (const nodeId of stringArray(release.deferredNodeIds)) {
      const taskId = taskIdFromReleaseNodeId(nodeId)
      if (!taskId) continue
      const key = `${releaseId}\0${taskId}`
      if (!rows.has(key)) rows.set(key, { releaseId, taskId, disposition: 'deferred' })
    }
  }
  return [...rows.values()]
}

const EMPTY_RELEASE_MEMBERSHIP_JSON = '[]'

/**
 * The normalized relation is the only current membership authority. These
 * columns remain in the index for old databases and explicit migration reads,
 * but promoted writes must not create another current membership copy.
 */
function releaseMembershipStorageFields(release: JsonRecord): {
  nodeIdsJson: string
  deferredNodeIdsJson: string
  definitionJson: string
} {
  const {
    nodeIds: _nodeIds,
    deferredNodeIds: _deferredNodeIds,
    ...definition
  } = release
  return {
    nodeIdsJson: EMPTY_RELEASE_MEMBERSHIP_JSON,
    deferredNodeIdsJson: EMPTY_RELEASE_MEMBERSHIP_JSON,
    // New normalized rows do not retain a second membership envelope. Older
    // rows still carry those fields so the explicit migration can import them.
    definitionJson: json(definition),
  }
}

/**
 * Normalize an intake envelope before it becomes current state. A task-level
 * release ID is an explicit assignment even when an older intake writer did
 * not emit a release envelope. Materialize that assignment here, in the same
 * write transaction, so no later reader has to guess or discard it.
 */
function releaseDefinitionsWithTaskMembership(
  releases: readonly JsonRecord[],
  tasks: readonly JsonRecord[],
  options: { clearUnlistedTaskMembership?: boolean } = {},
): JsonRecord[] {
  const byId = new Map<string, JsonRecord>()
  for (const release of releases) {
    const id = stringValue(release.id)
    if (!id) continue
    byId.set(id, {
      ...release,
      nodeIds: stringArray(release.nodeIds),
      deferredNodeIds: stringArray(release.deferredNodeIds),
    })
  }

  for (const task of tasks) {
    const taskId = stringValue(task.id)
    if (!taskId) continue
    const nodeId = `work:${taskId}`
    // Internal steps can retain a release ID as execution context, but they
    // are not members of an active release's visible/project-total scope.
    // A shipped release is an immutable historical snapshot, so its existing
    // membership is preserved rather than rewritten during normalization.
    if (taskHasInternalReleaseContext(task)) {
      for (const release of byId.values()) {
        if (stringValue(release.state) === 'shipped') continue
        release.nodeIds = stringArray(release.nodeIds).filter(value => value !== nodeId)
        release.deferredNodeIds = stringArray(release.deferredNodeIds).filter(value => value !== nodeId)
      }
      continue
    }
    const status = stringValue(task.status)
    const terminal = status === 'archived' || status === 'cancelled'
    const deferred = status === 'shelved'
    const releaseIds = stringArray(task.releaseIds)
    // The supplied task definition is the complete membership statement for
    // this task when the caller is applying a task edit. A full intake
    // envelope may intentionally keep deferred membership in its release
    // definition while the task's legacy releaseIds array is empty.
    if (options.clearUnlistedTaskMembership === true) {
      for (const release of byId.values()) {
        if (stringValue(release.state) === 'shipped') continue
        release.nodeIds = stringArray(release.nodeIds).filter(value => value !== nodeId)
        release.deferredNodeIds = stringArray(release.deferredNodeIds).filter(value => value !== nodeId)
      }
    } else if (releaseIds.length > 0) {
      for (const release of byId.values()) {
        if (stringValue(release.state) === 'shipped') continue
        if (releaseIds.includes(String(release.id))) continue
        release.nodeIds = stringArray(release.nodeIds).filter(value => value !== nodeId)
        release.deferredNodeIds = stringArray(release.deferredNodeIds).filter(value => value !== nodeId)
      }
    }
    for (const releaseId of releaseIds) {
      let release = byId.get(releaseId)
      if (!release) {
        release = {
          id: releaseId,
          label: releaseId,
          kind: 'release',
          state: 'active',
          source: 'inferred',
          proofStyle: 'unspecified',
          nodeIds: [],
          deferredNodeIds: [],
        }
        byId.set(releaseId, release)
      }
      const nodeIds = stringArray(release.nodeIds)
      const deferredNodeIds = stringArray(release.deferredNodeIds)
      if (!terminal) {
        const preserveDeferredDisposition = options.clearUnlistedTaskMembership !== true && deferredNodeIds.includes(nodeId)
        ;(deferred || preserveDeferredDisposition ? deferredNodeIds : nodeIds).push(nodeId)
      }
      release.nodeIds = [...new Set(nodeIds)]
      release.deferredNodeIds = [...new Set(deferredNodeIds)]
    }
  }

  return [...byId.values()]
}

function syncNormalizedReleaseMembership(
  database: DatabaseSync,
  desired: readonly ProjectStateDatabaseReleaseMembership[],
): boolean {
  if (!tableExists(database, 'release_membership')) return false
  const current = database.prepare(`
    SELECT release_id, task_id, disposition
    FROM release_membership
    ORDER BY release_id, task_id
  `).all() as JsonRecord[]
  const currentKeys = current.map(row => `${row.release_id}\0${row.task_id}\0${row.disposition}`)
  const desiredKeys = desired
    .map(row => `${row.releaseId}\0${row.taskId}\0${row.disposition}`)
    .sort()
  const changed = currentKeys.length !== desiredKeys.length || currentKeys.some((key, index) => key !== desiredKeys[index])
  if (!changed) {
    // An intentionally empty relation is still a fact. Seed its first
    // watermark so optional-release projects never have to pretend that
    // "no release membership" means "no membership authority".
    if (!readReleaseMembershipStateFromDatabase(database)) markReleaseMembershipStatePending(database)
    return false
  }
  database.prepare('DELETE FROM release_membership').run()
  const insert = database.prepare(`
    INSERT INTO release_membership (release_id, task_id, disposition)
    VALUES (?, ?, ?)
  `)
  for (const row of desired) {
    insert.run(row.releaseId, row.taskId, row.disposition)
  }
  markReleaseMembershipStatePending(database)
  return true
}

function syncReleaseMembershipFromDefinitions(
  database: DatabaseSync,
  releases: readonly JsonRecord[],
): boolean {
  return syncNormalizedReleaseMembership(database, releaseMembershipFromDefinitions(releases))
}

function markReleaseMembershipStatePending(database: DatabaseSync): void {
  if (!tableExists(database, 'release_membership_state')) return
  database.prepare(`
    INSERT INTO release_membership_state (id, membership_revision, project_revision, updated_at)
    VALUES (1, 1, NULL, NULL)
    ON CONFLICT(id) DO UPDATE SET
      membership_revision = release_membership_state.membership_revision + 1,
      project_revision = NULL,
      updated_at = NULL
  `).run()
}

function finalizeReleaseMembershipState(
  database: DatabaseSync,
  projectRevision: number,
  updatedAt: string,
): void {
  if (!tableExists(database, 'release_membership_state')) return
  database.prepare(`
    UPDATE release_membership_state
    SET project_revision = ?, updated_at = ?
    WHERE id = 1 AND project_revision IS NULL
  `).run(projectRevision, updatedAt)
}

function readReleaseMembershipStateFromDatabase(
  database: DatabaseSync,
): ProjectStateDatabaseReleaseMembershipState | null {
  if (!tableExists(database, 'release_membership_state')) return null
  const row = database.prepare(`
    SELECT membership_revision, project_revision, updated_at
    FROM release_membership_state WHERE id = 1
  `).get() as JsonRecord | undefined
  if (!row || !Number.isInteger(Number(row.membership_revision))) return null
  return {
    membershipRevision: Number(row.membership_revision),
    projectRevision: Number.isInteger(Number(row.project_revision)) ? Number(row.project_revision) : null,
    updatedAt: stringValue(row.updated_at),
  }
}

function upsertReleaseDefinitions(database: DatabaseSync, releases: readonly JsonRecord[]): void {
  const upsert = database.prepare(`
    INSERT INTO scopes (
      id, label, kind, state, source, proof_style,
      node_ids_json, deferred_node_ids_json, definition_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      label = excluded.label,
      kind = excluded.kind,
      state = excluded.state,
      source = excluded.source,
      proof_style = excluded.proof_style,
      node_ids_json = excluded.node_ids_json,
      deferred_node_ids_json = excluded.deferred_node_ids_json,
      definition_json = excluded.definition_json
  `)
  for (const release of releases) {
    const id = stringValue(release.id)
    if (!id) continue
    const stored = releaseMembershipStorageFields(release)
    upsert.run(
      id,
      String(release.label ?? id),
      stringValue(release.kind),
      stringValue(release.state),
      stringValue(release.source),
      stringValue(release.proofStyle),
      stored.nodeIdsJson,
      stored.deferredNodeIdsJson,
      stored.definitionJson,
    )
  }
}

function readReleaseMembershipByRelease(database: DatabaseSync): Map<string, { included: string[]; deferred: string[] }> {
  const result = new Map<string, { included: string[]; deferred: string[] }>()
  if (!tableExists(database, 'release_membership')) return result
  const rows = database.prepare(`
    SELECT release_id, task_id, disposition
    FROM release_membership
    ORDER BY release_id, rowid
  `).all() as JsonRecord[]
  for (const row of rows) {
    const releaseId = stringValue(row.release_id)
    const taskId = stringValue(row.task_id)
    if (!releaseId || !taskId) continue
    const membership = result.get(releaseId) ?? { included: [], deferred: [] }
    if (row.disposition === 'deferred') membership.deferred.push(`work:${taskId}`)
    else membership.included.push(`work:${taskId}`)
    result.set(releaseId, membership)
  }
  return result
}

function readReleaseMembershipByTask(database: DatabaseSync): Map<string, string[]> {
  const result = new Map<string, string[]>()
  if (!tableExists(database, 'release_membership')) return result
  const rows = database.prepare(`
    SELECT release_id, task_id
    FROM release_membership
    ORDER BY task_id, release_id
  `).all() as JsonRecord[]
  for (const row of rows) {
    const releaseId = stringValue(row.release_id)
    const taskId = stringValue(row.task_id)
    if (!releaseId || !taskId) continue
    const releaseIds = result.get(taskId) ?? []
    releaseIds.push(releaseId)
    result.set(taskId, releaseIds)
  }
  return result
}

function applyReleaseMembershipToTaskRows(database: DatabaseSync, rows: JsonRecord[]): void {
  if (!tableExists(database, 'release_membership')) return
  const releaseIdsByTask = readReleaseMembershipByTask(database)
  for (const row of rows) {
    const taskId = stringValue(row.id)
    if (!taskId) continue
    // The work-item JSON array is retained only as a compact compatibility
    // field. Once the normalized table exists, an empty relation is still a
    // fact and must not fall back to the old array.
    row.release_ids_json = json(releaseIdsByTask.get(taskId) ?? [])
  }
}

function readTaskDependenciesByTask(
  database: DatabaseSync,
  taskIds?: readonly string[],
): Map<string, string[]> {
  const result = new Map<string, string[]>()
  if (!tableExists(database, 'task_dependencies')) return result
  const ids = taskIds ? [...new Set(taskIds.filter(Boolean))] : []
  if (taskIds && ids.length === 0) return result
  const where = ids.length > 0
    ? `WHERE task_id IN (${ids.map(() => '?').join(', ')})`
    : ''
  const rows = database.prepare(`
    SELECT task_id, depends_on_task_id
    FROM task_dependencies
    ${where}
    ORDER BY task_id, rowid
  `).all(...ids) as JsonRecord[]
  for (const row of rows) {
    const taskId = stringValue(row.task_id)
    const dependencyId = stringValue(row.depends_on_task_id)
    if (!taskId || !dependencyId) continue
    const dependencies = result.get(taskId) ?? []
    dependencies.push(dependencyId)
    result.set(taskId, dependencies)
  }
  return result
}

function applyTaskDependenciesToTaskRows(database: DatabaseSync, rows: JsonRecord[]): void {
  const dependencyIdsByTask = readTaskDependenciesByTask(database, rows.flatMap(row => {
    const taskId = stringValue(row.id)
    return taskId ? [taskId] : []
  }))
  for (const row of rows) {
    const taskId = stringValue(row.id)
    if (!taskId) continue
    // The normalized edge table is authoritative once it exists. An empty
    // relation is a real answer and must not resurrect the JSON mirror.
    row.depends_on_json = json(dependencyIdsByTask.get(taskId) ?? [])
  }
}

function releaseDefinitionsFromDatabase(database: DatabaseSync): JsonRecord[] {
  const membershipByRelease = readReleaseMembershipByRelease(database)
  return (database.prepare('SELECT definition_json FROM scopes ORDER BY id').all() as JsonRecord[])
    .map(row => parseJson<JsonRecord>(row.definition_json, {}))
    .filter(release => typeof release.id === 'string')
    .map(release => {
      const membership = membershipByRelease.get(String(release.id))
      return {
        ...release,
        nodeIds: membership?.included ?? [],
        deferredNodeIds: membership?.deferred ?? [],
      }
    })
}

function taskStatusesFromDatabase(database: DatabaseSync): JsonRecord[] {
  return (database.prepare('SELECT id, status FROM work_items').all() as JsonRecord[]).map(row => ({
    id: String(row.id),
    status: stringValue(row.status),
  }))
}

function shippedDeliveryStatusesFromDatabase(database: DatabaseSync): Map<string, string> {
  const statuses = new Map<string, string>()
  if (!tableExists(database, 'release_delivery_snapshot')) return statuses
  const rows = database.prepare('SELECT release_id, task_id, status FROM release_delivery_snapshot').all() as JsonRecord[]
  for (const row of rows) {
    const releaseId = stringValue(row.release_id)
    const taskId = stringValue(row.task_id)
    const status = stringValue(row.status)
    if (releaseId && taskId && status) statuses.set(`${releaseId}\0${taskId}`, status)
  }
  return statuses
}

function backfillShippedDeliverySnapshots(database: DatabaseSync): void {
  if (!tableExists(database, 'release_delivery_snapshot')) return
  const releases = releaseDefinitionsFromDatabase(database).filter(release => release.state === 'shipped')
  const statuses = new Map(taskStatusesFromDatabase(database).map(task => [String(task.id), stringValue(task.status)]))
  const completed = new Map((database.prepare('SELECT id, completed_at FROM work_items').all() as JsonRecord[]).map(row => [String(row.id), stringValue(row.completed_at)]))
  const insert = database.prepare(`INSERT OR IGNORE INTO release_delivery_snapshot (release_id, task_id, status, completed_at) VALUES (?, ?, ?, ?)`)
  for (const release of releases) {
    for (const nodeId of [...stringArray(release.nodeIds), ...stringArray(release.deferredNodeIds)]) {
      const taskId = taskIdFromReleaseNodeId(nodeId)
      if (!taskId) continue
      insert.run(String(release.id), taskId, statuses.get(taskId) ?? 'unknown', completed.get(taskId) ?? null)
    }
  }
}

function assertShippedReleaseWriteAllowed(
  database: DatabaseSync,
  nextReleases: readonly JsonRecord[],
  nextTasks: readonly JsonRecord[],
  options: { nextReleasesComplete?: boolean; nextTasksComplete?: boolean } = {},
): void {
  backfillShippedDeliverySnapshots(database)
  const shippedDeliveryStatuses = shippedDeliveryStatusesFromDatabase(database)
  assertShippedReleaseMutation({
    currentReleases: releaseDefinitionsFromDatabase(database).map(release => ({
      id: String(release.id),
      state: stringValue(release.state),
      nodeIds: stringArray(release.nodeIds),
      deferredNodeIds: stringArray(release.deferredNodeIds),
    })),
    nextReleases: nextReleases.map(release => ({
      id: String(release.id),
      state: stringValue(release.state),
      nodeIds: stringArray(release.nodeIds),
      deferredNodeIds: stringArray(release.deferredNodeIds),
    })),
    currentTasks: taskStatusesFromDatabase(database).map(task => ({
      id: String(task.id),
      status: stringValue(task.status),
    })),
    nextTasks: nextTasks.flatMap(task => {
      const id = stringValue(task.id)
      return id ? [{ id, status: stringValue(task.status) }] : []
    }),
    nextReleasesComplete: options.nextReleasesComplete,
    nextTasksComplete: options.nextTasksComplete,
    shippedDeliveryStatus: (releaseId, taskId) => shippedDeliveryStatuses.get(`${releaseId}\0${taskId}`),
  })
}

function queueRecord(queue: unknown): JsonRecord {
  return isRecord(queue) ? queue : { tasks: queue }
}

function queueTasks(queue: unknown): JsonRecord[] {
  const tasks = queueRecord(queue).tasks
  return Array.isArray(tasks) ? tasks.filter(isRecord) : []
}

function queueReleases(queue: unknown): JsonRecord[] {
  const releases = queueRecord(queue).releases
  return Array.isArray(releases) ? releases.filter(isRecord) : []
}

function sourceQueueLastUpdated(queue: unknown): string | null {
  return stringValue(queueRecord(queue).lastUpdated)
}

function sourceQueueMtimeMs(tasksPath: string): number | null {
  try {
    return statSync(tasksPath).mtimeMs
  } catch {
    return null
  }
}

function sourceWorkspaceGoalsMtimeMs(tasksPath: string): number | null {
  try {
    return statSync(join(dirname(tasksPath), 'workspace-goals.json')).mtimeMs
  } catch {
    return null
  }
}

function serializeProjectStateDetailStore(queue: unknown, revision: number): Buffer {
  const record = queueRecord(queue)
  const detailStore: ProjectStateDatabaseDetailStore = {
    detailStoreVersion: 1,
    revision,
    version: Number.isFinite(Number(record.version)) ? Number(record.version) : 1,
    ...optionalLastUpdated(sourceQueueLastUpdated(queue)),
    ...optionalSelectedReleaseId(record.selectedReleaseId),
    ...optionalJsonArray(record.executionPlanActions, 'executionPlanActions'),
    ...optionalJsonArray(record.scopeAuthorityRequests, 'scopeAuthorityRequests'),
    tasks: queueTasks(queue),
    releases: queueReleases(queue),
  }
  return gzipSync(Buffer.from(`${JSON.stringify(detailStore)}\n`, 'utf8'), { level: 9 })
}

function parseProjectStateDetailStore(bytes: Uint8Array, expectedRevision: number): ProjectStateDatabaseQueueDefinition | null {
  try {
    const parsed = JSON.parse(gunzipSync(Buffer.from(bytes)).toString('utf8')) as Partial<ProjectStateDatabaseDetailStore>
    if (
      parsed.detailStoreVersion !== 1 ||
      parsed.revision !== expectedRevision ||
      !Array.isArray(parsed.tasks) ||
      !Array.isArray(parsed.releases)
    ) return null
    return {
      version: typeof parsed.version === 'number' ? parsed.version : 1,
      ...optionalLastUpdated(parsed.lastUpdated),
      ...optionalSelectedReleaseId(parsed.selectedReleaseId),
      ...optionalJsonArray(parsed.executionPlanActions, 'executionPlanActions'),
      ...optionalJsonArray(parsed.scopeAuthorityRequests, 'scopeAuthorityRequests'),
      tasks: parsed.tasks.filter(isRecord),
      releases: parsed.releases.filter(isRecord),
    }
  } catch {
    return null
  }
}

function serializeWorkItemDetail(task: JsonRecord): Buffer {
  // Bindings are a normalized relation. Persisting this hydrated convenience
  // field here would reintroduce a second authority on every task edit.
  const { capabilityBindings: _capabilityBindings, ...detail } = task
  return gzipSync(Buffer.from(`${JSON.stringify(detail)}\n`, 'utf8'), { level: 9 })
}

function parseWorkItemDetail(value: unknown): JsonRecord | null {
  if (!(value instanceof Uint8Array)) return null
  try {
    const parsed = JSON.parse(gunzipSync(Buffer.from(value)).toString('utf8'))
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function compactContractSurfaceReviewPackets(value: unknown): JsonRecord[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(candidate => {
    if (!isRecord(candidate)) return []
    const surface = isRecord(candidate.surface) ? candidate.surface : null
    const delta = isRecord(candidate.currentDelta) ? candidate.currentDelta : null
    const id = stringValue(candidate.id)
    const currentSpecRef = stringValue(candidate.currentSpecRef)
    const summary = stringValue(delta?.summary)
    if (!surface || !id || !currentSpecRef || !summary) return []
    const surfaceSummary: JsonRecord = {}
    for (const key of ['id', 'label', 'kind', 'authority', 'scope'] as const) {
      if (surface[key] !== undefined) surfaceSummary[key] = surface[key]
    }
    for (const key of ['owningProject', 'domain'] as const) {
      if (isRecord(surface[key])) {
        const ref = surface[key] as JsonRecord
        surfaceSummary[key] = {
          ...(typeof ref.id === 'string' ? { id: ref.id } : {}),
          ...(typeof ref.label === 'string' ? { label: ref.label } : {}),
        }
      }
    }
    const compactRefs = (items: unknown): JsonRecord[] => Array.isArray(items)
      ? items.flatMap(item => {
          if (!isRecord(item) || typeof item.id !== 'string') return []
          return [{
            id: item.id,
            ...(typeof item.label === 'string' ? { label: item.label } : {}),
          }]
        })
      : []
    const compactInvariants = Array.isArray(candidate.existingInvariants)
      ? candidate.existingInvariants.flatMap(item => {
          if (!isRecord(item) || typeof item.id !== 'string') return []
          return [{
            id: item.id,
            ...(typeof item.label === 'string' ? { label: item.label } : {}),
            ...(typeof item.rule === 'string' ? { rule: item.rule } : {}),
          }]
        })
      : []
    const compactDecisions = Array.isArray(candidate.existingDecisions)
      ? candidate.existingDecisions.flatMap(item => {
          if (!isRecord(item) || typeof item.id !== 'string') return []
          return [{
            id: item.id,
            ...(typeof item.summary === 'string' ? { summary: item.summary } : {}),
            ...(typeof item.decidedAt === 'string' ? { decidedAt: item.decidedAt } : {}),
          }]
        })
      : []
    return [{
      id,
      surface: surfaceSummary,
      currentSpecRef,
      knownConsumers: compactRefs(candidate.knownConsumers),
      existingInvariants: compactInvariants,
      existingDecisions: compactDecisions,
      siblingSpecRefs: stringArray(candidate.siblingSpecRefs),
      driftFindings: stringArray(candidate.driftFindings),
      currentDelta: { summary },
      proofObligations: stringArray(candidate.proofObligations),
      reviewFocus: stringArray(candidate.reviewFocus),
    }]
  })
}

export function projectStateDatabasePath(projectRoot: string): string {
  return getProjectSystemStatePath(projectRoot, PROJECT_STATE_DATABASE_FILE)
}

export function projectStateDatabasePathFromTasksPath(tasksPath: string): string {
  return join(dirname(tasksPath), PROJECT_STATE_DATABASE_FILE)
}

export function projectStateDatabaseDetailPathFromTasksPath(tasksPath: string): string {
  return join(dirname(tasksPath), PROJECT_STATE_DETAIL_FILE)
}

export function projectStateDatabaseCompressedDetailPathFromTasksPath(tasksPath: string): string {
  return join(dirname(tasksPath), PROJECT_STATE_COMPRESSED_DETAIL_FILE)
}

const COMPACT_WORK_ITEM_COLUMNS = `
  id, title, description, status, domain, priority, work_kind, parent_id,
  hierarchy_json, depends_on_json, release_ids_json, source_refs_json,
  summary_json, updated_at, completed_at
`

const FULL_WORK_ITEM_COLUMNS = `${COMPACT_WORK_ITEM_COLUMNS}, definition_json`
const COMPACT_WORK_ITEM_SCOPED_COLUMNS = `
  work_items.id, work_items.title, work_items.status,
  work_items.domain, work_items.priority, work_items.work_kind, work_items.parent_id,
  work_items.hierarchy_json, work_items.depends_on_json, work_items.release_ids_json,
  work_items.source_refs_json, work_items.summary_json, work_items.updated_at, work_items.completed_at
`
const FULL_WORK_ITEM_SCOPED_COLUMNS = `${COMPACT_WORK_ITEM_SCOPED_COLUMNS}, work_items.definition_json`

// Writes may wait for another short transaction to finish. A compact read is
// different: it is one card in a fleet and must fail locally rather than hold
// the synchronous event loop while every later project waits on the same
// locked database.
const PROJECT_STATE_WRITE_BUSY_TIMEOUT_MS = 5_000
const PROJECT_STATE_READ_BUSY_TIMEOUT_MS = 250

function hasWorkScopeTable(database: DatabaseSync): boolean {
  return Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'work_scope'").get())
}

function workItemsWithScopeSelect(columns: string, includeScope: boolean): string {
  if (!includeScope) return `SELECT ${columns} FROM work_items`
  return `
    SELECT ${columns}, work_scope.scope AS scope_row_scope,
      work_scope.eligibility_reason AS scope_row_eligibility_reason,
      work_scope.hierarchy_role AS scope_row_hierarchy_role,
      work_scope.handoff_state AS scope_row_handoff_state,
      work_scope.blocks_start AS scope_row_blocks_start,
      work_scope.blocks_release AS scope_row_blocks_release,
      work_scope.human_blocking AS scope_row_human_blocking,
      work_scope.count_in_project_totals AS scope_row_count_in_project_totals,
      work_scope.proof_blocked AS scope_row_proof_blocked,
      work_scope.blocker_summary AS scope_row_blocker_summary,
      work_scope.source_refs_json AS scope_row_source_refs_json
    FROM work_items LEFT JOIN work_scope ON work_scope.task_id = work_items.id
  `
}

function openDatabase(databasePath: string, options: { readOnly?: boolean } = {}): DatabaseSync {
  const readOnly = options.readOnly === true
  if (!readOnly) mkdirSync(dirname(databasePath), { recursive: true })
  const database = new DatabaseSync(databasePath, { readOnly })
  database.exec(`PRAGMA busy_timeout = ${readOnly ? PROJECT_STATE_READ_BUSY_TIMEOUT_MS : PROJECT_STATE_WRITE_BUSY_TIMEOUT_MS};`)
  database.exec('PRAGMA foreign_keys = ON;')
  if (readOnly) return database
  // DELETE avoids read-created -wal/-shm sidecars. Project writes are short,
  // and FULL synchronous durability is more valuable here than WAL's
  // throughput profile.
  database.exec('PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL;')
  database.exec(`
    CREATE TABLE IF NOT EXISTS project_meta (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      project_id TEXT,
      schema_version INTEGER NOT NULL,
      revision INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      project_state_authority TEXT NOT NULL DEFAULT 'legacy',
      task_evidence_authority TEXT NOT NULL DEFAULT 'legacy'
      );
    CREATE TABLE IF NOT EXISTS work_items (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT,
      domain TEXT,
      priority TEXT,
      work_kind TEXT,
      parent_id TEXT,
      hierarchy_json TEXT,
      depends_on_json TEXT NOT NULL,
      release_ids_json TEXT NOT NULL,
      source_refs_json TEXT NOT NULL,
      summary_json TEXT NOT NULL DEFAULT '{}',
      definition_json TEXT NOT NULL,
      updated_at TEXT,
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS work_items_status_idx ON work_items(status);
    CREATE INDEX IF NOT EXISTS work_items_parent_idx ON work_items(parent_id);
    -- Dependency edges are current-state facts, not a JSON search problem.
    CREATE TABLE IF NOT EXISTS task_dependencies (
      task_id TEXT NOT NULL,
      depends_on_task_id TEXT NOT NULL,
      PRIMARY KEY (task_id, depends_on_task_id)
    );
    CREATE INDEX IF NOT EXISTS task_dependencies_dependency_idx
      ON task_dependencies(depends_on_task_id);
    -- Per-task detail keeps point reads independent from the compressed
    -- whole-queue compatibility/detail blob.
    CREATE TABLE IF NOT EXISTS work_item_detail (
      task_id TEXT PRIMARY KEY,
      revision INTEGER NOT NULL,
      payload_gzip BLOB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS work_scope (
      task_id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      eligibility_reason TEXT NOT NULL,
      hierarchy_role TEXT NOT NULL,
      handoff_state TEXT NOT NULL,
      blocks_start INTEGER NOT NULL,
      blocks_release INTEGER NOT NULL,
      human_blocking INTEGER NOT NULL,
      count_in_project_totals INTEGER NOT NULL DEFAULT 1,
      proof_blocked INTEGER NOT NULL DEFAULT 0,
      blocker_summary TEXT,
      source_refs_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS work_scope_scope_idx ON work_scope(scope);
    CREATE TABLE IF NOT EXISTS queue_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      version INTEGER NOT NULL,
      last_updated TEXT,
      selected_release_id TEXT,
      execution_plan_actions_json TEXT NOT NULL DEFAULT '[]',
      scope_authority_requests_json TEXT NOT NULL DEFAULT '[]',
      revision INTEGER NOT NULL DEFAULT 0
    );
    -- Retained only so an explicit migration can import older databases. The
    -- current model stores rich detail per work item and never reads or writes
    -- this aggregate row on a normal runtime path.
    CREATE TABLE IF NOT EXISTS queue_detail (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      revision INTEGER NOT NULL,
      payload_gzip BLOB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS scopes (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      kind TEXT,
      state TEXT,
      source TEXT,
      proof_style TEXT,
      node_ids_json TEXT NOT NULL,
      deferred_node_ids_json TEXT NOT NULL,
      definition_json TEXT NOT NULL
    );
    -- The only authoritative release-to-work membership relation. The node-id
    -- arrays on scopes and task JSON remain migration/presentation fields.
    CREATE TABLE IF NOT EXISTS release_membership (
      release_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      disposition TEXT NOT NULL CHECK (disposition IN ('included', 'deferred')),
      PRIMARY KEY (release_id, task_id)
    );
    CREATE INDEX IF NOT EXISTS release_membership_task_idx ON release_membership(task_id);
    -- Membership changes independently from evidence/runtime changes. This
    -- singleton lets a derived scope prove exactly which relation it used.
    CREATE TABLE IF NOT EXISTS release_membership_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      membership_revision INTEGER NOT NULL,
      project_revision INTEGER,
      updated_at TEXT
    );
    -- Structured adapters own capability identity. This table holds the
    -- source-derived scope fact; no Markdown or task prose can create a row.
    CREATE TABLE IF NOT EXISTS source_capabilities (
      capability_id TEXT PRIMARY KEY,
      adapter_id TEXT NOT NULL,
      adapter_schema_version INTEGER NOT NULL,
      source_revision TEXT NOT NULL,
      label TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('planned', 'retired')),
      release_ids_json TEXT NOT NULL,
      depends_on_capability_ids_json TEXT NOT NULL,
      evidence_refs_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS source_capabilities_adapter_idx
      ON source_capabilities(adapter_id, source_revision);
    -- Task JSON carries this relation only when hydrated for a compatibility
    -- reader. The relation below is the one durable allocation authority.
    CREATE TABLE IF NOT EXISTS task_capability_bindings (
      task_id TEXT NOT NULL,
      capability_id TEXT NOT NULL,
      relation TEXT NOT NULL CHECK (relation IN ('plans', 'implements', 'integrates', 'proves', 'reviews')),
      PRIMARY KEY (task_id, capability_id),
      FOREIGN KEY (task_id) REFERENCES work_items(id) ON DELETE CASCADE,
      FOREIGN KEY (capability_id) REFERENCES source_capabilities(capability_id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS task_capability_bindings_capability_idx
      ON task_capability_bindings(capability_id, relation);
    -- A shipped release owns an immutable delivery snapshot. Work definitions
    -- may later be scheduled again without rewriting historical delivery.
    CREATE TABLE IF NOT EXISTS release_delivery_snapshot (
      release_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      status TEXT NOT NULL,
      completed_at TEXT,
      PRIMARY KEY (release_id, task_id)
    );
    CREATE INDEX IF NOT EXISTS release_delivery_snapshot_task_idx ON release_delivery_snapshot(task_id);
    CREATE TABLE IF NOT EXISTS project_summary (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      payload_json TEXT NOT NULL,
      freshness TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 0,
      source_queue_last_updated TEXT,
      source_queue_mtime_ms REAL,
      source_workspace_goals_mtime_ms REAL
    );
    CREATE TABLE IF NOT EXISTS project_orientation (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      payload_json TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 0
    );
    -- One bounded current Thread projection. Historical turns live in the
    -- separate paged detail projection below.
    CREATE TABLE IF NOT EXISTS current_thread (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      payload_json TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      source_revision TEXT NOT NULL,
      source_queue_revision INTEGER,
      updated_at TEXT NOT NULL
    );
    -- Historical Thread turns are an explicit, bounded detail projection.
    -- Ordinary history reads page this table; they never rebuild Thread from
    -- tasks, chat sessions, or intake records.
    CREATE TABLE IF NOT EXISTS thread_history_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      source_revision TEXT NOT NULL,
      source_queue_revision INTEGER,
      generated_at TEXT NOT NULL,
      turn_count INTEGER NOT NULL,
      truncated INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS thread_history (
      turn_index INTEGER PRIMARY KEY,
      turn_id TEXT NOT NULL,
      turn_at TEXT NOT NULL,
      turn_status TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS thread_history_at_idx ON thread_history(turn_at DESC, turn_index DESC);
    -- Imported planning is provenance, not current execution state. Keep the
    -- latest accepted snapshot available for explicit detail views without
    -- embedding its task-id arrays in every compact summary read.
    CREATE TABLE IF NOT EXISTS project_plan (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      payload_json TEXT NOT NULL,
      recorded_at TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS task_execution (
      task_id TEXT PRIMARY KEY,
      updated_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS task_workspace (
      task_id TEXT PRIMARY KEY,
      updated_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS task_proof (
      task_id TEXT PRIMARY KEY,
      latest_kind TEXT NOT NULL,
      latest_recorded_at TEXT NOT NULL,
      result TEXT,
      payload_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS task_evidence_current (
      task_id TEXT PRIMARY KEY,
      updated_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );
    -- Additive detail history. Existing schema readers remain valid; writable
    -- opens create this table before the next transaction that uses it.
    CREATE TABLE IF NOT EXISTS task_evidence_history (
      task_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      evidence_id TEXT NOT NULL,
      recorded_at TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      PRIMARY KEY (task_id, kind, evidence_id)
    );
    CREATE INDEX IF NOT EXISTS task_evidence_history_task_kind_time_idx
      ON task_evidence_history(task_id, kind, recorded_at DESC, evidence_id DESC);
    CREATE TABLE IF NOT EXISTS current_execution (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      status TEXT NOT NULL,
      mode TEXT,
      started_at TEXT,
      stopped_at TEXT,
      stop_requested_at TEXT,
      error TEXT,
      updated_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS current_runtime (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      status TEXT NOT NULL,
      health TEXT,
      last_activity_at TEXT,
      updated_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS owner_inputs (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      task_id TEXT,
      prompt TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS owner_inputs_status_idx ON owner_inputs(status);
    CREATE TABLE IF NOT EXISTS repositories (
      id TEXT PRIMARY KEY,
      root TEXT NOT NULL,
      branch TEXT,
      head TEXT,
      status TEXT,
      freshness TEXT NOT NULL,
      inspected_at TEXT,
      payload_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS project_diagnostics (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      source_revision INTEGER NOT NULL,
      freshness TEXT NOT NULL CHECK (freshness IN ('current', 'stale')),
      generated_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      git_json TEXT,
      readiness_json TEXT
    );
    CREATE TABLE IF NOT EXISTS memory_health (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      source_revision INTEGER NOT NULL,
      freshness TEXT NOT NULL CHECK (freshness IN ('current', 'stale')),
      generated_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS project_availability (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      status TEXT NOT NULL,
      paused_at TEXT,
      resumed_at TEXT,
      reason TEXT,
      updated_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS attention_records (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS attention_records_status_idx ON attention_records(status);
    CREATE TABLE IF NOT EXISTS projection_watermarks (
      domain TEXT PRIMARY KEY,
      source_revision INTEGER NOT NULL,
      refreshed_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS projection_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      domain TEXT NOT NULL UNIQUE,
      source_revision INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'failed', 'succeeded')),
      error TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      claimed_at TEXT,
      last_attempt_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS projection_jobs_status_idx
      ON projection_jobs(status, source_revision, id);
    CREATE TABLE IF NOT EXISTS project_reconciliations (
      capability_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      resolved_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );
    -- Historical payloads stay in their bounded files. This metadata-only
    -- registry gives every retained artifact one owner, byte count, digest,
    -- and lifecycle without making history part of compact current reads.
    CREATE TABLE IF NOT EXISTS historical_artifacts (
      artifact_id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      owner TEXT NOT NULL,
      logical_ref TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_verified_at TEXT,
      bytes INTEGER NOT NULL CHECK (bytes >= 0),
      sha256 TEXT,
      retention_class TEXT NOT NULL,
      state TEXT NOT NULL,
      replacement_ref TEXT,
      source_revision TEXT
    );
    CREATE INDEX IF NOT EXISTS historical_artifacts_state_idx
      ON historical_artifacts(state, retention_class);
    CREATE INDEX IF NOT EXISTS historical_artifacts_kind_idx
      ON historical_artifacts(kind, created_at DESC);
  `)
  const previousSchemaVersion = Number((database.prepare('SELECT schema_version FROM project_meta WHERE id = 1').get() as JsonRecord | undefined)?.schema_version ?? 0)
  // Schema v2 briefly wrote duplicate derived metadata into state_meta. It
  // never owned a fact, so remove it when opening older local databases.
  database.exec('DROP TABLE IF EXISTS state_meta')
  const summaryColumns = database.prepare('PRAGMA table_info(project_summary)').all() as JsonRecord[]
  if (!summaryColumns.some(column => column.name === 'source_workspace_goals_mtime_ms')) {
    database.exec('ALTER TABLE project_summary ADD COLUMN source_workspace_goals_mtime_ms REAL')
  }
  if (!summaryColumns.some(column => column.name === 'revision')) {
    database.exec('ALTER TABLE project_summary ADD COLUMN revision INTEGER NOT NULL DEFAULT 0')
  }
  const workItemColumns = database.prepare('PRAGMA table_info(work_items)').all() as JsonRecord[]
  if (!workItemColumns.some(column => column.name === 'summary_json')) {
    database.exec("ALTER TABLE work_items ADD COLUMN summary_json TEXT NOT NULL DEFAULT '{}'")
  }
  const queueStateColumns = database.prepare('PRAGMA table_info(queue_state)').all() as JsonRecord[]
  if (!queueStateColumns.some(column => column.name === 'execution_plan_actions_json')) {
    database.exec("ALTER TABLE queue_state ADD COLUMN execution_plan_actions_json TEXT NOT NULL DEFAULT '[]'")
  }
  if (!queueStateColumns.some(column => column.name === 'scope_authority_requests_json')) {
    database.exec("ALTER TABLE queue_state ADD COLUMN scope_authority_requests_json TEXT NOT NULL DEFAULT '[]'")
  }
  if (!queueStateColumns.some(column => column.name === 'revision')) {
    database.exec('ALTER TABLE queue_state ADD COLUMN revision INTEGER NOT NULL DEFAULT 0')
  }
  const scopeColumns = database.prepare('PRAGMA table_info(work_scope)').all() as JsonRecord[]
  if (!scopeColumns.some(column => column.name === 'proof_blocked')) {
    database.exec('ALTER TABLE work_scope ADD COLUMN proof_blocked INTEGER NOT NULL DEFAULT 0')
  }
  if (!scopeColumns.some(column => column.name === 'count_in_project_totals')) {
    database.exec('ALTER TABLE work_scope ADD COLUMN count_in_project_totals INTEGER NOT NULL DEFAULT 1')
  }
  if (!scopeColumns.some(column => column.name === 'blocker_summary')) {
    database.exec('ALTER TABLE work_scope ADD COLUMN blocker_summary TEXT')
  }
  if (previousSchemaVersion > 0 && previousSchemaVersion < 30) {
    rebuildTaskDependencies(database)
  }
  const projectMetaColumns = database.prepare('PRAGMA table_info(project_meta)').all() as JsonRecord[]
  if (!projectMetaColumns.some(column => column.name === 'project_state_authority')) {
    if (projectMetaColumns.some(column => column.name === 'task_overlay_authority')) {
      database.exec('ALTER TABLE project_meta RENAME COLUMN task_overlay_authority TO project_state_authority')
    } else {
      database.exec("ALTER TABLE project_meta ADD COLUMN project_state_authority TEXT NOT NULL DEFAULT 'legacy'")
    }
  }
  const refreshedProjectMetaColumns = database.prepare('PRAGMA table_info(project_meta)').all() as JsonRecord[]
  if (!refreshedProjectMetaColumns.some(column => column.name === 'task_evidence_authority')) {
    database.exec("ALTER TABLE project_meta ADD COLUMN task_evidence_authority TEXT NOT NULL DEFAULT 'legacy'")
  }
  if (previousSchemaVersion > 0 && previousSchemaVersion < 8) {
    // Full task definitions were duplicated in SQLite while the compatibility
    // queue already carried the same detail. Clear only that duplicate; the
    // explicit queue-details sidecar is written by the snapshot boundary.
    database.prepare("UPDATE work_items SET definition_json = '{}'").run()
    database.exec('VACUUM')
  }
  if (previousSchemaVersion > 0 && previousSchemaVersion < 32) {
    const revision = currentRevision(database)
    if (revision > 0) {
      recordProjectionJobs(
        database,
        [PROJECT_STATE_DATABASE_MEMORY_HEALTH_PROJECTION_DOMAIN],
        revision,
        new Date().toISOString(),
      )
    }
  }
  database.prepare(`
    INSERT INTO project_meta (id, schema_version, revision, updated_at)
    VALUES (1, ?, 0, ?)
    ON CONFLICT(id) DO UPDATE SET schema_version = excluded.schema_version
  `).run(PROJECT_STATE_DATABASE_SCHEMA_VERSION, new Date().toISOString())
  return database
}

function transaction(database: DatabaseSync, work: () => void): void {
  database.exec('BEGIN IMMEDIATE')
  try {
    work()
    database.exec('COMMIT')
  } catch (error) {
    try {
      database.exec('ROLLBACK')
    } catch {
      // Preserve the original error if rollback itself cannot run.
    }
    throw error
  }
}

function bumpRevision(database: DatabaseSync, updatedAt: string): number {
  const current = database.prepare('SELECT revision FROM project_meta WHERE id = 1').get() as JsonRecord | undefined
  const revision = Number(current?.revision ?? 0) + 1
  database.prepare('UPDATE project_meta SET revision = ?, updated_at = ? WHERE id = 1').run(revision, updatedAt)
  return revision
}

function currentRevision(database: DatabaseSync): number {
  return Number((database.prepare('SELECT revision FROM project_meta WHERE id = 1').get() as JsonRecord | undefined)?.revision ?? 0)
}

const DEFAULT_AUTHORITATIVE_PROJECTION_DOMAINS = [
  'summary',
  'attention',
  PROJECT_STATE_DATABASE_DIAGNOSTIC_PROJECTION_DOMAIN,
  PROJECT_STATE_DATABASE_MEMORY_HEALTH_PROJECTION_DOMAIN,
] as const
const MAX_PROJECTION_JOB_ERROR_LENGTH = 500

interface ProjectStateDatabaseAuthoritativeMutationOptions {
  updatedAt: string
  domains: readonly ProjectStateDomain[]
  projectionDomains?: readonly string[]
  projectRoot?: string
  /** Queue/task mutations publish their summary in the same transaction. */
  summaryFreshness?: 'stale' | 'preserve'
}

function boundedProjectionJobError(error: string | null | undefined): string | null {
  if (error === null || error === undefined) return null
  const trimmed = error.trim()
  return trimmed.length <= MAX_PROJECTION_JOB_ERROR_LENGTH
    ? trimmed
    : `${trimmed.slice(0, MAX_PROJECTION_JOB_ERROR_LENGTH - 3)}...`
}

function normalizeProjectionDomains(domains: readonly string[]): string[] {
  const normalized = [...new Set(domains.map(domain => domain.trim()).filter(Boolean))]
  if (normalized.some(domain => domain.length > 128)) {
    throw new RangeError('Projection domains must be 128 characters or fewer')
  }
  return normalized
}

function projectionJobFromRow(row: JsonRecord): ProjectStateDatabaseProjectionJob {
  const status: ProjectStateDatabaseProjectionJobStatus =
    row.status === 'running' || row.status === 'failed' || row.status === 'succeeded'
      ? row.status
      : 'pending'
  return {
    id: Number(row.id),
    domain: String(row.domain),
    sourceRevision: Number(row.source_revision),
    status,
    error: row.error === null || row.error === undefined ? null : String(row.error),
    attempts: Number(row.attempts ?? 0),
    claimedAt: row.claimed_at === null || row.claimed_at === undefined ? null : String(row.claimed_at),
    lastAttemptAt: row.last_attempt_at === null || row.last_attempt_at === undefined ? null : String(row.last_attempt_at),
    completedAt: row.completed_at === null || row.completed_at === undefined ? null : String(row.completed_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

/** Queue only revision metadata; the projection payload stays in its owner. */
function recordProjectionJobs(
  database: DatabaseSync,
  domains: readonly string[],
  sourceRevision: number,
  now: string,
): void {
  if (!Number.isInteger(sourceRevision) || sourceRevision < 0) {
    throw new RangeError('Projection jobs require a non-negative integer source revision')
  }
  const normalizedDomains = normalizeProjectionDomains(domains)
  for (const domain of normalizedDomains) {
    const watermark = database.prepare(`
      SELECT source_revision
      FROM projection_watermarks
      WHERE domain = ?
    `).get(domain) as JsonRecord | undefined
    if (watermark && Number(watermark.source_revision) >= sourceRevision) continue

    const existing = database.prepare(`
      SELECT source_revision, status
      FROM projection_jobs
      WHERE domain = ?
    `).get(domain) as JsonRecord | undefined
    const existingRevision = existing ? Number(existing.source_revision) : null
    if (existingRevision !== null && existingRevision > sourceRevision) continue
    if (
      existingRevision === sourceRevision &&
      existing?.status === 'succeeded' &&
      watermark &&
      Number(watermark.source_revision) >= sourceRevision
    ) continue
    if (existingRevision === sourceRevision && existing?.status === 'pending') continue
    if (existingRevision === sourceRevision && existing?.status === 'running') continue

    database.prepare(`
      INSERT INTO projection_jobs (
        domain, source_revision, status, error, attempts, claimed_at,
        last_attempt_at, completed_at, created_at, updated_at
      ) VALUES (?, ?, 'pending', NULL, 0, NULL, NULL, NULL, ?, ?)
      ON CONFLICT(domain) DO UPDATE SET
        source_revision = excluded.source_revision,
        status = 'pending',
        error = NULL,
        attempts = 0,
        claimed_at = NULL,
        last_attempt_at = NULL,
        completed_at = NULL,
        updated_at = excluded.updated_at
    `).run(domain, sourceRevision, now, now)
  }
}

function commitAuthoritativeMutation(
  database: DatabaseSync,
  options: ProjectStateDatabaseAuthoritativeMutationOptions,
): number {
  const revision = bumpRevision(database, options.updatedAt)
  if (options.summaryFreshness !== 'preserve') {
    database.prepare("UPDATE project_summary SET freshness = 'stale', revision = ? WHERE id = 1").run(revision)
  }
  recordProjectionJobs(
    database,
    options.projectionDomains ?? DEFAULT_AUTHORITATIVE_PROJECTION_DOMAINS,
    revision,
    options.updatedAt,
  )
  if (options.projectRoot) {
    emitProjectSummaryInvalidation(options.projectRoot, 'database-current-state-write', {
      revision,
      domains: options.domains,
    })
  }
  return revision
}

function advancePreservedSummaryRevision(database: DatabaseSync, revision: number): void {
  // Owner-input rows are an auxiliary current-state projection. They change
  // what readiness says, but they do not invalidate queue-derived counts or
  // orientation. Keep the saved summary current while hydration supplies the
  // owner-input queue from its normalized table.
  database.prepare("UPDATE project_summary SET revision = ? WHERE id = 1 AND freshness = 'current'").run(revision)
}

function invalidateDerivedProjection(
  database: DatabaseSync,
  projectRoot: string,
  domains: readonly ProjectStateDomain[],
  projectionDomains: readonly string[],
  updatedAt: string,
): void {
  const revision = currentRevision(database)
  for (const domain of normalizeProjectionDomains(projectionDomains)) {
    database.prepare('DELETE FROM projection_watermarks WHERE domain = ?').run(domain)
    recordProjectionJobs(database, [domain], revision, updatedAt)
  }
  emitProjectSummaryInvalidation(projectRoot, 'database-derived-projection-write', {
    revision,
    domains,
  })
}

function markProjectionCurrent(
  database: DatabaseSync,
  domain: string,
  sourceRevision: number,
  refreshedAt: string,
): void {
  if (!Number.isInteger(sourceRevision) || sourceRevision < 0) {
    throw new RangeError('Projection watermarks require a non-negative integer source revision')
  }
  database.prepare(`
    INSERT INTO projection_watermarks (domain, source_revision, refreshed_at)
    VALUES (?, ?, ?)
    ON CONFLICT(domain) DO UPDATE SET
      source_revision = excluded.source_revision,
      refreshed_at = excluded.refreshed_at
    WHERE excluded.source_revision >= projection_watermarks.source_revision
  `).run(domain, sourceRevision, refreshedAt)
  database.prepare(`
    UPDATE projection_jobs
    SET status = 'succeeded',
        error = NULL,
        claimed_at = NULL,
        completed_at = ?,
        updated_at = ?
    WHERE domain = ? AND source_revision <= ?
  `).run(refreshedAt, refreshedAt, domain, sourceRevision)
}

function writeCurrentExecutionRow(database: DatabaseSync, execution: ProjectStateDatabaseExecution): void {
  database.prepare(`
    INSERT INTO current_execution (
      id, status, mode, started_at, stopped_at, stop_requested_at, error,
      updated_at, payload_json
    ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      mode = excluded.mode,
      started_at = excluded.started_at,
      stopped_at = excluded.stopped_at,
      stop_requested_at = excluded.stop_requested_at,
      error = excluded.error,
      updated_at = excluded.updated_at,
      payload_json = excluded.payload_json
  `).run(
    execution.status,
    execution.mode ?? null,
    execution.startedAt ?? null,
    execution.stoppedAt ?? null,
    execution.stopRequestedAt ?? null,
    execution.error ?? null,
    execution.updatedAt,
    json(execution.payload ?? execution),
  )
}

function writeCurrentRuntimeRow(database: DatabaseSync, runtime: ProjectStateDatabaseRuntime): void {
  database.prepare(`
    INSERT INTO current_runtime (
      id, status, health, last_activity_at, updated_at, payload_json
    ) VALUES (1, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      health = excluded.health,
      last_activity_at = excluded.last_activity_at,
      updated_at = excluded.updated_at,
      payload_json = excluded.payload_json
  `).run(
    runtime.status,
    runtime.health ?? null,
    runtime.lastActivityAt ?? null,
    runtime.updatedAt,
    json(runtime.payload ?? runtime),
  )
}

function hydrateSummaryFromAuxiliaryRows(database: DatabaseSync, summary: JsonRecord): JsonRecord {
  const next = { ...summary }

  if (tableExists(database, 'current_execution')) {
    const row = database.prepare(`
      SELECT status, mode, started_at, stopped_at, stop_requested_at, error,
        updated_at, payload_json
      FROM current_execution WHERE id = 1
    `).get() as JsonRecord | undefined
    if (row) {
      const payload = parseJson<JsonRecord>(row.payload_json, {})
      next.execution = {
        status: String(row.status ?? 'stopped'),
        ...(stringValue(row.mode) ? { mode: stringValue(row.mode) } : {}),
        ...(stringValue(row.started_at) ? { startedAt: stringValue(row.started_at) } : {}),
        ...(stringValue(row.stopped_at) ? { stoppedAt: stringValue(row.stopped_at) } : {}),
        ...(stringValue(row.stop_requested_at) ? { stopRequestedAt: stringValue(row.stop_requested_at) } : {}),
        ...(stringValue(row.error) ? { error: stringValue(row.error) } : {}),
        ...(stringValue(payload?.activeTaskId) ? { activeTaskId: stringValue(payload?.activeTaskId) } : {}),
        ...(stringValue(payload?.activeTaskTitle) ? { activeTaskTitle: stringValue(payload?.activeTaskTitle) } : {}),
        updatedAt: stringValue(row.updated_at) ?? '',
      }
    }
  }

  if (tableExists(database, 'current_runtime')) {
    const row = database.prepare(`
      SELECT status, health, last_activity_at, updated_at
      FROM current_runtime WHERE id = 1
    `).get() as JsonRecord | undefined
    if (row) {
      next.runtime = {
        status: String(row.status ?? 'unknown'),
        ...(stringValue(row.health) ? { health: stringValue(row.health) } : {}),
        ...(stringValue(row.last_activity_at) ? { lastActivityAt: stringValue(row.last_activity_at) } : {}),
        updatedAt: stringValue(row.updated_at) ?? '',
      }
    }
  }

  if (tableExists(database, 'owner_inputs')) {
    const rows = database.prepare(`
      SELECT id, status, task_id, prompt, updated_at, payload_json
      FROM owner_inputs
      -- coordinator_review means the owner already answered. It remains in
      -- the durable request table for Guildhall's internal follow-through,
      -- but it must not block project execution or present as owner work.
      WHERE status = 'waiting_for_owner'
      ORDER BY updated_at ASC, id ASC
    `).all() as JsonRecord[]
    const first = rows[0]
    const firstPayload = first ? parseJson<JsonRecord>(first.payload_json, {}) : null
    const target = firstPayload && isRecord(firstPayload.target) ? firstPayload.target : null
    const boundedChatSessionId = stringValue(firstPayload?.boundedChatSessionId)
    const updatedAt = rows.reduce(
      (latest, row) => stringValue(row.updated_at) && stringValue(row.updated_at)! > latest
        ? stringValue(row.updated_at)!
        : latest,
      stringValue((isRecord(next.ownerInput) ? next.ownerInput.updatedAt : null)) ?? '',
    )
    if (rows.length > 0 || isRecord(next.ownerInput) || ownerInputProjectionIsAuthoritative(database)) {
      next.ownerInput = {
        openCount: rows.length,
        next: first
          ? {
              id: String(first.id),
              ...(stringValue(firstPayload?.label) ? { label: stringValue(firstPayload?.label) } : {}),
              prompt: String(first.prompt ?? ''),
              ...(stringValue(first.task_id) ? { taskId: stringValue(first.task_id) } : {}),
              ...(stringValue(target?.href)
                ? { href: stringValue(target?.href) }
                : boundedChatSessionId
                  ? { href: `/thread?thread=${encodeURIComponent(boundedChatSessionId)}` }
                  : {}),
            }
          : null,
        updatedAt,
      }
    }
  }

  return next
}

function readProjectPlanSnapshot(database: DatabaseSync): unknown | null {
  if (!tableExists(database, 'project_plan')) return null
  const row = database.prepare('SELECT payload_json FROM project_plan WHERE id = 1').get() as JsonRecord | undefined
  return row?.payload_json === undefined ? null : parseJson<unknown>(row.payload_json, null)
}

function syncProjectPlanSnapshot(
  database: DatabaseSync,
  approvedPlan: unknown | null | undefined,
  recordedAt: string,
  revision: number,
): void {
  if (approvedPlan === undefined) return
  if (approvedPlan === null) {
    database.prepare('DELETE FROM project_plan').run()
    return
  }
  database.prepare(`
    INSERT INTO project_plan (id, payload_json, recorded_at, revision)
    VALUES (1, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      payload_json = excluded.payload_json,
      recorded_at = excluded.recorded_at,
      revision = excluded.revision
  `).run(json(approvedPlan), stringValue((approvedPlan as JsonRecord)?.recordedAt) ?? recordedAt, revision)
}

function taskFromRow(row: JsonRecord, includeDefinition = true): ProjectStateDatabaseTask {
  const summary = parseJson<JsonRecord>(row.summary_json, {})
  return {
    ...summary,
    id: String(row.id),
    title: String(row.title ?? ''),
    description: typeof row.description === 'string' ? row.description : null,
    status: typeof row.status === 'string' ? row.status : null,
    domain: typeof row.domain === 'string' ? row.domain : null,
    priority: typeof row.priority === 'string' ? row.priority : null,
    workKind: typeof row.work_kind === 'string' ? row.work_kind : null,
    parentId: typeof row.parent_id === 'string' ? row.parent_id : null,
    hierarchy: parseJson<JsonRecord | null>(row.hierarchy_json, null),
    dependsOn: parseJson<string[]>(row.depends_on_json, []),
    releaseIds: parseJson<string[]>(row.release_ids_json, []),
    sourceRefs: parseJson<string[]>(row.source_refs_json, []),
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : null,
    completedAt: typeof row.completed_at === 'string' ? row.completed_at : null,
    definition: includeDefinition ? parseJson<JsonRecord>(row.definition_json, {}) : {},
    scopeRow: scopeRowFromRow(row),
  }
}

const CAPABILITY_RELATIONS = new Set<ProjectStateDatabaseCapabilityRelation>([
  'plans', 'implements', 'integrates', 'proves', 'reviews',
])

function taskCapabilityBindingsFromTask(task: JsonRecord): ProjectStateDatabaseTaskCapabilityBinding[] | null {
  if (!('capabilityBindings' in task)) return null
  if (!Array.isArray(task.capabilityBindings)) {
    throw new Error(`Task ${stringValue(task.id) || '(unknown)'} has invalid capability bindings`)
  }
  const taskId = stringValue(task.id)
  if (!taskId) throw new Error('Capability bindings require a task id')
  const byCapability = new Map<string, ProjectStateDatabaseTaskCapabilityBinding>()
  for (const value of task.capabilityBindings) {
    if (!isRecord(value)) throw new Error(`Task ${taskId} has invalid capability binding`)
    const capabilityId = stringValue(value.capabilityId)
    const relation = stringValue(value.relation) as ProjectStateDatabaseCapabilityRelation | undefined
    if (!capabilityId || !relation || !CAPABILITY_RELATIONS.has(relation)) {
      throw new Error(`Task ${taskId} has invalid capability binding`)
    }
    if (byCapability.has(capabilityId)) {
      throw new Error(`Task ${taskId} binds capability ${capabilityId} more than once`)
    }
    byCapability.set(capabilityId, { taskId, capabilityId, relation })
  }
  return [...byCapability.values()].sort((left, right) => left.capabilityId.localeCompare(right.capabilityId))
}

function sourceCapabilityFromInput(input: ProjectStateDatabaseSourceCapability): ProjectStateDatabaseSourceCapability {
  const id = input.id.trim()
  const adapterId = input.adapterId.trim()
  const sourceRevision = input.sourceRevision.trim()
  const label = input.label.trim()
  if (!id || !adapterId || !sourceRevision || !label || !Number.isInteger(input.adapterSchemaVersion) || input.adapterSchemaVersion < 1) {
    throw new Error('Source capabilities require id, adapter identity, revision, label, and a positive schema version')
  }
  if (input.state !== 'planned' && input.state !== 'retired') {
    throw new Error(`Source capability ${id} has invalid state`)
  }
  return {
    id,
    adapterId,
    adapterSchemaVersion: input.adapterSchemaVersion,
    sourceRevision,
    label,
    state: input.state,
    releaseIds: [...new Set(input.releaseIds.map(value => value.trim()).filter(Boolean))].sort(),
    dependsOnCapabilityIds: [...new Set(input.dependsOnCapabilityIds.map(value => value.trim()).filter(Boolean))].sort(),
    evidenceRefs: [...new Set(input.evidenceRefs.map(value => value.trim()).filter(Boolean))].sort(),
  }
}

function upsertSourceCapabilities(
  database: DatabaseSync,
  inputs: readonly ProjectStateDatabaseSourceCapability[],
): void {
  const byId = new Map<string, ProjectStateDatabaseSourceCapability>()
  for (const input of inputs) {
    const capability = sourceCapabilityFromInput(input)
    if (byId.has(capability.id)) throw new Error(`Received duplicate source capability ${capability.id}`)
    byId.set(capability.id, capability)
  }
  const upsert = database.prepare(`
    INSERT INTO source_capabilities (
      capability_id, adapter_id, adapter_schema_version, source_revision,
      label, state, release_ids_json, depends_on_capability_ids_json, evidence_refs_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(capability_id) DO UPDATE SET
      adapter_id = excluded.adapter_id,
      adapter_schema_version = excluded.adapter_schema_version,
      source_revision = excluded.source_revision,
      label = excluded.label,
      state = excluded.state,
      release_ids_json = excluded.release_ids_json,
      depends_on_capability_ids_json = excluded.depends_on_capability_ids_json,
      evidence_refs_json = excluded.evidence_refs_json
  `)
  for (const capability of byId.values()) {
    upsert.run(
      capability.id,
      capability.adapterId,
      capability.adapterSchemaVersion,
      capability.sourceRevision,
      capability.label,
      capability.state,
      json(capability.releaseIds),
      json(capability.dependsOnCapabilityIds),
      json(capability.evidenceRefs),
    )
  }
}

function replaceSourceCapabilityCatalog(
  database: DatabaseSync,
  inputs: readonly ProjectStateDatabaseSourceCapability[],
): void {
  const capabilities = inputs.map(sourceCapabilityFromInput)
  const ids = new Set<string>()
  for (const capability of capabilities) {
    if (ids.has(capability.id)) throw new Error(`Received duplicate source capability ${capability.id}`)
    ids.add(capability.id)
  }
  // A source snapshot is explicit authority, so first remove the allocations
  // it supersedes, then replace source facts and let the same queue write
  // reallocate only the bindings carried by its task records.
  database.prepare('DELETE FROM task_capability_bindings').run()
  database.prepare('DELETE FROM source_capabilities').run()
  upsertSourceCapabilities(database, capabilities)
}

function syncTaskCapabilityBindings(
  database: DatabaseSync,
  tasks: readonly JsonRecord[],
  options: { replaceAll?: boolean } = {},
): void {
  if (options.replaceAll) database.prepare('DELETE FROM task_capability_bindings').run()
  const bindingsByTask = new Map<string, ProjectStateDatabaseTaskCapabilityBinding[]>()
  for (const task of tasks) {
    const bindings = taskCapabilityBindingsFromTask(task)
    if (bindings !== null) bindingsByTask.set(stringValue(task.id)!, bindings)
  }
  const knownCapabilityIds = new Set(
    (database.prepare('SELECT capability_id FROM source_capabilities').all() as JsonRecord[])
      .map(row => stringValue(row.capability_id))
      .filter((id): id is string => Boolean(id)),
  )
  const replaceTask = database.prepare('DELETE FROM task_capability_bindings WHERE task_id = ?')
  const insert = database.prepare(`
    INSERT INTO task_capability_bindings (task_id, capability_id, relation)
    VALUES (?, ?, ?)
  `)
  for (const [taskId, bindings] of bindingsByTask) {
    replaceTask.run(taskId)
    for (const binding of bindings) {
      if (!knownCapabilityIds.has(binding.capabilityId)) {
        throw new Error(`Task ${taskId} binds unknown source capability ${binding.capabilityId}`)
      }
      insert.run(binding.taskId, binding.capabilityId, binding.relation)
    }
  }
}

function readTaskCapabilityBindingsByTask(
  database: DatabaseSync,
  taskIds: readonly string[],
): Map<string, ProjectStateDatabaseTaskCapabilityBinding[]> {
  if (taskIds.length === 0 || !tableExists(database, 'task_capability_bindings')) return new Map()
  const rows = database.prepare(`
    SELECT task_id, capability_id, relation
    FROM task_capability_bindings
    WHERE task_id IN (${taskIds.map(() => '?').join(', ')})
    ORDER BY task_id, capability_id
  `).all(...taskIds) as JsonRecord[]
  const result = new Map<string, ProjectStateDatabaseTaskCapabilityBinding[]>()
  for (const row of rows) {
    const taskId = stringValue(row.task_id)
    const capabilityId = stringValue(row.capability_id)
    const relation = stringValue(row.relation) as ProjectStateDatabaseCapabilityRelation | undefined
    if (!taskId || !capabilityId || !relation || !CAPABILITY_RELATIONS.has(relation)) continue
    const bindings = result.get(taskId) ?? []
    bindings.push({ taskId, capabilityId, relation })
    result.set(taskId, bindings)
  }
  return result
}

function sourceCapabilityFromRow(row: JsonRecord): ProjectStateDatabaseSourceCapability | null {
  const id = stringValue(row.capability_id)
  const adapterId = stringValue(row.adapter_id)
  const sourceRevision = stringValue(row.source_revision)
  const label = stringValue(row.label)
  const state = stringValue(row.state) as ProjectStateDatabaseCapabilityState | undefined
  const adapterSchemaVersion = Number(row.adapter_schema_version)
  if (!id || !adapterId || !sourceRevision || !label || !Number.isInteger(adapterSchemaVersion) || adapterSchemaVersion < 1) return null
  if (state !== 'planned' && state !== 'retired') return null
  return {
    id,
    adapterId,
    adapterSchemaVersion,
    sourceRevision,
    label,
    state,
    releaseIds: parseJson<string[]>(row.release_ids_json, []),
    dependsOnCapabilityIds: parseJson<string[]>(row.depends_on_capability_ids_json, []),
    evidenceRefs: parseJson<string[]>(row.evidence_refs_json, []),
  }
}

/** Read the adapter-owned catalog without opening task detail or project history. */
export function readProjectStateDatabaseSourceCapabilities(
  tasksPath: string,
): ProjectStateDatabaseSourceCapability[] | null {
  const databasePath = projectStateDatabasePathFromTasksPath(tasksPath)
  try {
    statSync(databasePath)
  } catch {
    return null
  }
  const database = openDatabase(databasePath, { readOnly: true })
  try {
    if (!tableExists(database, 'source_capabilities')) return []
    return (database.prepare(`
      SELECT capability_id, adapter_id, adapter_schema_version, source_revision,
        label, state, release_ids_json, depends_on_capability_ids_json, evidence_refs_json
      FROM source_capabilities
      ORDER BY capability_id
    `).all() as JsonRecord[])
      .flatMap(row => {
        const capability = sourceCapabilityFromRow(row)
        return capability ? [capability] : []
      })
  } finally {
    database.close()
  }
}

/** Read exact task allocation facts without expanding task definition payloads. */
export function readProjectStateDatabaseTaskCapabilityBindings(
  tasksPath: string,
  taskIds: readonly string[],
): Map<string, ProjectStateDatabaseTaskCapabilityBinding[]> | null {
  const databasePath = projectStateDatabasePathFromTasksPath(tasksPath)
  try {
    statSync(databasePath)
  } catch {
    return null
  }
  const ids = [...new Set(taskIds.filter(id => id.trim().length > 0))].slice(0, 100)
  const database = openDatabase(databasePath, { readOnly: true })
  try {
    return readTaskCapabilityBindingsByTask(database, ids)
  } finally {
    database.close()
  }
}

function scopeRowFromRow(row: JsonRecord): ProjectStateDatabaseScopeRow | null {
  const scope = stringValue(row.scope_row_scope)
  if (scope !== 'included' && scope !== 'deferred') return null
  return {
    taskId: String(row.id),
    ...(typeof row.parent_id === 'string' && row.parent_id.length > 0 ? { parentTaskId: row.parent_id } : {}),
    scope,
    eligibilityReason: String(row.scope_row_eligibility_reason ?? ''),
    hierarchyRole: String(row.scope_row_hierarchy_role ?? ''),
    handoffState: String(row.scope_row_handoff_state ?? ''),
    blocksStart: Number(row.scope_row_blocks_start ?? 0) === 1,
    blocksRelease: Number(row.scope_row_blocks_release ?? 0) === 1,
    humanBlocking: Number(row.scope_row_human_blocking ?? 0) === 1,
    ...(Number(row.scope_row_count_in_project_totals ?? 1) === 0 ? { countInProjectTotals: false } : {}),
    proofBlocked: Number(row.scope_row_proof_blocked ?? 0) === 1,
    ...(typeof row.scope_row_blocker_summary === 'string' && row.scope_row_blocker_summary.trim()
      ? { blockerSummary: row.scope_row_blocker_summary }
      : {}),
    sourceRefs: parseJson<string[]>(row.scope_row_source_refs_json, []),
  }
}

function taskDependencyIdsFromRow(row: JsonRecord): string[] {
  return [...new Set(parseJson<string[]>(row.depends_on_json, []).filter(id => typeof id === 'string' && id.trim().length > 0))]
}

function rebuildTaskDependencies(database: DatabaseSync): void {
  if (!tableExists(database, 'task_dependencies')) return
  database.prepare('DELETE FROM task_dependencies').run()
  const insert = database.prepare('INSERT INTO task_dependencies (task_id, depends_on_task_id) VALUES (?, ?)')
  const rows = database.prepare('SELECT id, depends_on_json FROM work_items').all() as JsonRecord[]
  for (const row of rows) {
    const taskId = stringValue(row.id)
    if (!taskId) continue
    for (const dependencyId of taskDependencyIdsFromRow(row)) insert.run(taskId, dependencyId)
  }
}

function syncTaskDependencies(database: DatabaseSync, tasks: readonly JsonRecord[]): void {
  if (!tableExists(database, 'task_dependencies')) return
  const deleteTaskEdges = database.prepare('DELETE FROM task_dependencies WHERE task_id = ?')
  const insert = database.prepare('INSERT OR IGNORE INTO task_dependencies (task_id, depends_on_task_id) VALUES (?, ?)')
  for (const task of tasks) {
    const taskId = stringValue(task.id)
    if (!taskId) continue
    deleteTaskEdges.run(taskId)
    for (const dependencyId of stringArray(task.dependsOn)) insert.run(taskId, dependencyId)
  }
}

function deleteTaskDependencies(database: DatabaseSync, taskIds: readonly string[]): void {
  if (!tableExists(database, 'task_dependencies')) return
  const deleteEdges = database.prepare('DELETE FROM task_dependencies WHERE task_id = ? OR depends_on_task_id = ?')
  for (const taskId of taskIds) deleteEdges.run(taskId, taskId)
}

function readDependentTaskIds(database: DatabaseSync, taskId: string): string[] {
  if (!tableExists(database, 'task_dependencies')) return []
  const rows = database.prepare(`
    SELECT task_id
    FROM task_dependencies
    WHERE depends_on_task_id = ?
    ORDER BY rowid
  `).all(taskId) as JsonRecord[]
  return rows.flatMap(row => typeof row.task_id === 'string' ? [row.task_id] : [])
}

function readScopeRowsFromDatabase(database: DatabaseSync): ProjectStateDatabaseScopeRow[] {
  if (!hasWorkScopeTable(database)) return []
  const rows = database.prepare(`
    SELECT work_scope.task_id, work_items.parent_id,
      work_scope.scope, work_scope.eligibility_reason, work_scope.hierarchy_role,
      work_scope.handoff_state, work_scope.blocks_start, work_scope.blocks_release,
      work_scope.human_blocking, work_scope.count_in_project_totals,
      work_scope.proof_blocked, work_scope.blocker_summary, work_scope.source_refs_json
    FROM work_scope
    LEFT JOIN work_items ON work_items.id = work_scope.task_id
    ORDER BY work_scope.task_id
  `).all() as JsonRecord[]
  return rows.flatMap(row => {
    const parsed = scopeRowFromRow({
      id: row.task_id,
      parent_id: row.parent_id,
      scope_row_scope: row.scope,
      scope_row_eligibility_reason: row.eligibility_reason,
      scope_row_hierarchy_role: row.hierarchy_role,
      scope_row_handoff_state: row.handoff_state,
      scope_row_blocks_start: row.blocks_start,
      scope_row_blocks_release: row.blocks_release,
      scope_row_human_blocking: row.human_blocking,
      scope_row_count_in_project_totals: row.count_in_project_totals,
      scope_row_proof_blocked: row.proof_blocked,
      scope_row_blocker_summary: row.blocker_summary,
      scope_row_source_refs_json: row.source_refs_json,
    })
    return parsed ? [parsed] : []
  })
}

function scopeRowKey(row: ProjectStateDatabaseScopeRow): string {
  return JSON.stringify({
    taskId: row.taskId,
    scope: row.scope,
    eligibilityReason: row.eligibilityReason,
    hierarchyRole: row.hierarchyRole,
    handoffState: row.handoffState,
    blocksStart: row.blocksStart,
    blocksRelease: row.blocksRelease,
    humanBlocking: row.humanBlocking,
    countInProjectTotals: row.countInProjectTotals ?? true,
    proofBlocked: row.proofBlocked ?? false,
    blockerSummary: row.blockerSummary ?? null,
    sourceRefs: row.sourceRefs,
  })
}

/** Diff the derived scope index instead of churning unrelated rows. */
function syncProjectStateDatabaseScopeRows(
  database: DatabaseSync,
  rows: readonly ProjectStateDatabaseScopeRow[],
): void {
  const nextByTaskId = new Map(rows.map(row => [row.taskId, row]))
  const existingRows = database.prepare(`
    SELECT task_id, scope, eligibility_reason, hierarchy_role, handoff_state,
      blocks_start, blocks_release, human_blocking, count_in_project_totals, proof_blocked,
      blocker_summary, source_refs_json
    FROM work_scope
    ORDER BY task_id
  `).all() as JsonRecord[]
  const existingByTaskId = new Map(existingRows.flatMap(row => {
    const parsed = scopeRowFromRow({
      id: row.task_id,
      scope_row_scope: row.scope,
      scope_row_eligibility_reason: row.eligibility_reason,
      scope_row_hierarchy_role: row.hierarchy_role,
      scope_row_handoff_state: row.handoff_state,
      scope_row_blocks_start: row.blocks_start,
      scope_row_blocks_release: row.blocks_release,
      scope_row_human_blocking: row.human_blocking,
      scope_row_count_in_project_totals: row.count_in_project_totals,
      scope_row_proof_blocked: row.proof_blocked,
      scope_row_blocker_summary: row.blocker_summary,
      scope_row_source_refs_json: row.source_refs_json,
    })
    return parsed ? [[parsed.taskId, parsed] as const] : []
  }))
  for (const taskId of existingByTaskId.keys()) {
    if (!nextByTaskId.has(taskId)) database.prepare('DELETE FROM work_scope WHERE task_id = ?').run(taskId)
  }
  const upsert = database.prepare(`
    INSERT INTO work_scope (
      task_id, scope, eligibility_reason, hierarchy_role, handoff_state,
      blocks_start, blocks_release, human_blocking, count_in_project_totals, proof_blocked,
      blocker_summary, source_refs_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(task_id) DO UPDATE SET
      scope = excluded.scope,
      eligibility_reason = excluded.eligibility_reason,
      hierarchy_role = excluded.hierarchy_role,
      handoff_state = excluded.handoff_state,
      blocks_start = excluded.blocks_start,
      blocks_release = excluded.blocks_release,
      human_blocking = excluded.human_blocking,
      count_in_project_totals = excluded.count_in_project_totals,
      proof_blocked = excluded.proof_blocked,
      blocker_summary = excluded.blocker_summary,
      source_refs_json = excluded.source_refs_json
  `)
  for (const row of nextByTaskId.values()) {
    const existing = existingByTaskId.get(row.taskId)
    if (existing && scopeRowKey(existing) === scopeRowKey(row)) continue
    upsert.run(
      row.taskId,
      row.scope,
      row.eligibilityReason,
      row.hierarchyRole,
      row.handoffState,
      row.blocksStart ? 1 : 0,
      row.blocksRelease ? 1 : 0,
      row.humanBlocking ? 1 : 0,
      row.countInProjectTotals === false ? 0 : 1,
      row.proofBlocked ? 1 : 0,
      row.blockerSummary ?? null,
      json(row.sourceRefs),
    )
  }
}

function readQueueDetailsForRevision(
  tasksPath: string,
  revision: number,
  database?: DatabaseSync,
  options: { migration?: boolean } = {},
): ProjectStateDatabaseQueueDefinition | null {
  // An aggregate queue detail blob is a bootstrap/import bridge, never a
  // competing source once SQLite is promoted. A migration mutating promoted
  // state must begin with the same normalized task/release relation the
  // runtime reads, otherwise an old blob can attempt to rewrite a shipped
  // release snapshot.
  const databaseIsAuthoritative = Boolean(database && tableExists(database, 'project_meta') &&
    (database.prepare('SELECT project_state_authority FROM project_meta WHERE id = 1').get() as JsonRecord | undefined)
      ?.project_state_authority === 'database')
  if (options.migration && database && !databaseIsAuthoritative && tableExists(database, 'queue_detail')) {
    try {
      const row = database.prepare('SELECT revision, payload_gzip FROM queue_detail WHERE id = 1').get() as JsonRecord | undefined
      if (row && Number(row.revision) === revision && row.payload_gzip instanceof Uint8Array) {
        const details = parseProjectStateDetailStore(row.payload_gzip, revision)
        if (details) return details
      }
    } catch {
      // A migration may still import an older detail representation below.
    }
  }
  if (database) {
    const indexed = readQueueDefinitionFromWorkItemDetails(database, revision)
    if (indexed) return indexed
  }
  if (!options.migration) return null
  // Once the database is the project-state authority, a stale filesystem
  // detail file is not a compatibility source; it is a second mutable truth.
  // Fail closed and let the caller surface unavailable detail instead of
  // silently resurrecting an older queue from disk.
  if (database && tableExists(database, 'project_meta')) {
    const authority = database.prepare('SELECT project_state_authority FROM project_meta WHERE id = 1').get() as JsonRecord | undefined
    if (authority?.project_state_authority === 'database') return null
  }
  try {
    const compressedPath = projectStateDatabaseCompressedDetailPathFromTasksPath(tasksPath)
    const rawPath = projectStateDatabaseDetailPathFromTasksPath(tasksPath)
    const detailBytes = existsSync(compressedPath)
      ? gunzipSync(readFileSync(compressedPath))
      : readFileSync(rawPath)
    const parsed = JSON.parse(detailBytes.toString('utf8')) as Partial<ProjectStateDatabaseDetailStore>
    if (
      parsed.detailStoreVersion === 1 &&
      parsed.revision === revision &&
      Array.isArray(parsed.tasks) &&
      Array.isArray(parsed.releases)
    ) {
      return {
        version: typeof parsed.version === 'number' ? parsed.version : 1,
        ...optionalLastUpdated(parsed.lastUpdated),
        ...optionalSelectedReleaseId(parsed.selectedReleaseId),
        tasks: parsed.tasks.filter(isRecord),
        releases: parsed.releases.filter(isRecord),
      }
    }
  } catch {
    // Only an explicit migration import may inspect the old queue file.
  }

  try {
    const parsed = queueRecord(JSON.parse(readFileSync(tasksPath, 'utf8')))
    if (!Array.isArray(parsed.tasks) && !Array.isArray(parsed.releases)) return null
    return {
      version: Number.isFinite(Number(parsed.version)) ? Number(parsed.version) : 1,
      ...optionalLastUpdated(sourceQueueLastUpdated(parsed)),
      ...optionalSelectedReleaseId(parsed.selectedReleaseId),
      tasks: queueTasks(parsed),
      releases: queueReleases(parsed),
    }
  } catch {
    return null
  }
}

/**
 * Reconstruct an explicit rich queue read from the normalized current rows.
 * This is intentionally not used by compact surfaces: point and inventory
 * reads stay indexed. It exists so the old aggregate blob can be removed
 * without making rich mutation/detail readers depend on a second payload.
 */
function readQueueDefinitionFromWorkItemDetails(
  database: DatabaseSync,
  _revision: number,
): ProjectStateDatabaseQueueDefinition | null {
  if (!tableExists(database, 'work_item_detail') || !tableExists(database, 'queue_state') || !tableExists(database, 'scopes')) return null
  const queueState = database.prepare(`
    SELECT ${queueStateReadColumns(database, [
      'version', 'last_updated', 'selected_release_id',
      'execution_plan_actions_json', 'scope_authority_requests_json',
    ])}
    FROM queue_state WHERE id = 1
  `).get() as JsonRecord | undefined
  if (!queueState) return null
  // Queue order is semantic: hierarchy.childIds and callers that read the
  // rich queue expect the materialized insertion order, not “most recently
  // edited first”. The compact inventory may sort by freshness separately.
  const taskRows = database.prepare('SELECT id, updated_at, summary_json FROM work_items ORDER BY rowid').all() as JsonRecord[]
  const detailRows = database.prepare('SELECT task_id, revision, payload_gzip FROM work_item_detail').all() as JsonRecord[]
  if (detailRows.length !== taskRows.length) return null
  const summaryByTaskId = new Map(taskRows.map(row => [String(row.id), parseJson<JsonRecord>(row.summary_json, {})]))
  const byId = new Map<string, JsonRecord>()
  for (const row of detailRows) {
    const taskId = stringValue(row.task_id)
    // A queue revision can advance for a summary, scope, or release-selection
    // change. The detail row's revision is the last revision that changed
    // that task payload, so untouched rows are valid at the current queue
    // revision without a table-wide metadata rewrite.
    const detail = taskId ? parseWorkItemDetail(row.payload_gzip) : null
    if (!taskId || !detail) return null
    const summary = summaryByTaskId.get(taskId) ?? {}
    byId.set(taskId, isRecord(summary.currentSummary)
      ? { ...detail, currentSummary: summary.currentSummary }
      : detail)
  }
  if (byId.size !== taskRows.length || taskRows.some(row => !byId.has(String(row.id)))) return null
  const releaseIdsByTask = readReleaseMembershipByTask(database)
  const dependencyIdsByTask = readTaskDependenciesByTask(database)
  const capabilityBindingsByTask = readTaskCapabilityBindingsByTask(database, [...byId.keys()])
  for (const [taskId, task] of byId) {
    if (tableExists(database, 'release_membership')) {
      // A visible task's release IDs are normalized membership. Internal
      // work may carry a distinct typed execution context in its detail, but
      // it can never be reconstructed as visible release membership.
      task.releaseIds = taskHasInternalReleaseContext(task)
        ? []
        : releaseIdsByTask.get(taskId) ?? []
    }
    if (tableExists(database, 'task_dependencies')) task.dependsOn = dependencyIdsByTask.get(taskId) ?? []
    const bindings = capabilityBindingsByTask.get(taskId)
    if (bindings) task.capabilityBindings = bindings.map(({ capabilityId, relation }) => ({ capabilityId, relation }))
  }
  const releaseRows = releaseDefinitionsFromDatabase(database)
  return {
    version: Number.isFinite(Number(queueState.version)) ? Number(queueState.version) : 1,
    ...optionalLastUpdated(queueState.last_updated),
    ...optionalSelectedReleaseId(queueState.selected_release_id),
    ...optionalJsonArray(queueState.execution_plan_actions_json, 'executionPlanActions'),
    ...optionalJsonArray(queueState.scope_authority_requests_json, 'scopeAuthorityRequests'),
    tasks: taskRows.flatMap(row => {
      const taskId = String(row.id)
      const task = byId.get(taskId)
      return task ? [task] : []
    }),
    releases: releaseRows,
  }
}

function currentQueueRevision(database: DatabaseSync): number {
  const row = database.prepare('SELECT revision FROM queue_state WHERE id = 1').get() as JsonRecord | undefined
  return typeof row?.revision === 'number' ? row.revision : currentRevision(database)
}

function readWorkItemDetails(
  database: DatabaseSync,
  taskIds: readonly string[],
): Map<string, JsonRecord> {
  if (taskIds.length === 0 || !tableExists(database, 'work_item_detail')) return new Map()
  const rows = database.prepare(`
    SELECT task_id, revision, payload_gzip
    FROM work_item_detail
    WHERE task_id IN (${taskIds.map(() => '?').join(', ')})
  `).all(...taskIds) as JsonRecord[]
  return new Map(rows.flatMap(row => {
    const taskId = stringValue(row.task_id)
    const detail = taskId ? parseWorkItemDetail(row.payload_gzip) : null
    return taskId && detail ? [[taskId, detail] as const] : []
  }))
}

function attachWorkItemDetails(
  tasks: ProjectStateDatabaseTask[],
  database: DatabaseSync,
): ProjectStateDatabaseTask[] {
  const definitions = readWorkItemDetails(database, tasks.map(task => task.id))
  const bindingsByTask = readTaskCapabilityBindingsByTask(database, tasks.map(task => task.id))
  return tasks.map(task => ({
    ...task,
    definition: {
      ...(definitions.get(task.id) ?? {}),
      ...(bindingsByTask.has(task.id) ? {
        capabilityBindings: bindingsByTask.get(task.id)!.map(({ capabilityId, relation }) => ({ capabilityId, relation })),
      } : {}),
    },
  }))
}

/**
 * The Work list needs a small, stable task card, not the complete task
 * definition. Keep this projection intentionally shallow: detail-only prose,
 * evidence, transcripts, and acceptance records stay behind the task route.
 */
function workItemSummary(task: JsonRecord): JsonRecord {
  const summary: JsonRecord = {}
  const scalarKeys = [
    'id', 'title', 'description', 'orientationSummary', 'domain', 'status',
    'priority', 'revisionCount', 'updatedAt', 'completedAt', 'assignedTo',
    'importedDraft', 'requestKind', 'requestStage', 'workKind', 'semanticKind', 'workVisibility',
    'dependsOn', 'hierarchy', 'sourceRefs', 'blockReason',
    'recoveryCode', 'bootstrapRepairOwnership', 'persistedBlockReason', 'shelveReason', 'latestReviewerSummary',
    'terminalSummary', 'openQuestions', 'workerHandoff',
  ]
  for (const key of scalarKeys) {
    if (key in task) summary[key] = task[key]
  }
  const acceptanceCriteria = Array.isArray(task.acceptanceCriteria) ? task.acceptanceCriteria : []
  const acceptanceCriteriaCount = acceptanceCriteria.length
  if (acceptanceCriteria.length > 0) {
    summary.acceptanceCriteriaCount = acceptanceCriteria.length
    const first = acceptanceCriteria.find(item => isRecord(item) && typeof item.description === 'string')
    if (isRecord(first) && typeof first.description === 'string' && first.description.trim()) {
      summary.acceptanceCriteriaFirstDescription = first.description.trim()
    }
  }
  const units = isRecord(task.workUnitAnalysis) && Array.isArray(task.workUnitAnalysis.units)
    ? task.workUnitAnalysis.units
    : null
  if (units) summary.workUnitCount = units.length
  const delivery = isRecord(task.delivery) ? task.delivery : null
  if (delivery) {
    const compactDelivery: JsonRecord = {}
    for (const key of ['driver', 'provider']) {
      if (typeof delivery[key] === 'string' && delivery[key].trim()) compactDelivery[key] = delivery[key]
    }
    for (const key of ['usesPrimitives', 'provesPrimitives', 'supports']) {
      if (Array.isArray(delivery[key])) {
        const values = delivery[key].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        if (values.length > 0) compactDelivery[key] = values
      }
    }
    if (Object.keys(compactDelivery).length > 0) summary.delivery = compactDelivery
  }
  if (typeof task.spec === 'string' && task.spec.trim()) summary.spec = 'present'
  const contractSurfaceReviewPackets = compactContractSurfaceReviewPackets(task.contractSurfaceReviewPackets)
  if (contractSurfaceReviewPackets.length > 0) {
    summary.contractSurfaceReviewPackets = contractSurfaceReviewPackets
  }
  const brief = isRecord(task.productBrief) ? task.productBrief : null
  const userJob = typeof brief?.userJob === 'string' && brief.userJob.trim().length > 0
  const successMetric = (
    (typeof brief?.successMetric === 'string' && brief.successMetric.trim().length > 0) ||
    (typeof brief?.successCriteria === 'string' && brief.successCriteria.trim().length > 0)
  )
  const briefShape = Boolean(
    userJob ||
    successMetric ||
    (typeof brief?.whyItMattersNow === 'string' && brief.whyItMattersNow.trim().length > 0) ||
    (typeof brief?.rolloutPlan === 'string' && brief.rolloutPlan.trim().length > 0) ||
    (Array.isArray(brief?.nonGoals) && brief.nonGoals.length > 0) ||
    (Array.isArray(brief?.antiPatterns) && brief.antiPatterns.length > 0),
  )
  const imported = task.importedDraft === true ||
    (isRecord(task.requestIntake) && task.requestIntake.createdBy === 'workspace-importer') ||
    (isRecord(task.requestIntake) && Array.isArray(task.requestIntake.evidenceRefs) && task.requestIntake.evidenceRefs.some(ref => typeof ref === 'string' && /^import:/.test(ref))) ||
    (Array.isArray(task.sourceClaims) && task.sourceClaims.length > 0) ||
    (Array.isArray(task.notes) && task.notes.some(note => isRecord(note) && (
      note.role === 'importer' ||
      note.agentId === 'workspace-importer' ||
      note.agentId === 'workspace-importer-agent'
    )))
  const taskReadiness = isRecord(task.taskReadiness) && typeof task.taskReadiness.recommendation === 'string'
    ? {
        recommendation: task.taskReadiness.recommendation,
        ...(typeof task.taskReadiness.summary === 'string' ? { summary: task.taskReadiness.summary } : {}),
      }
    : null
  const sizePlanAction = isRecord(task.sizePlan) && typeof task.sizePlan.action === 'string'
    ? task.sizePlan.action
    : null
  const currentProof = currentProofSummary(task)
  const executionBlocker = taskExecutionBlocker(task)
  summary.currentSummary = {
    imported,
    brief: {
      present: brief !== null,
      shaped: briefShape,
      userJob,
      successMetric,
      approvedAt: typeof brief?.approvedAt === 'string' ? brief.approvedAt : null,
    },
    acceptanceCriteriaCount,
    proof: currentProof,
    ...(executionBlocker ? { executionBlocker } : {}),
    ...(taskReadiness ? { taskReadiness } : {}),
    ...(sizePlanAction ? { sizePlanAction } : {}),
  }
  return summary
}

/**
 * Keep only the current proof contract and a few bounded results in the task
 * index. Historical gates/reviews stay in evidence; compact surfaces need a
 * current answer without reopening the detail payload.
 */
function currentProofSummary(task: JsonRecord): JsonRecord {
  return summarizeCurrentProof(task) as unknown as JsonRecord
}

/** Build the compact indexed row for a task without persisting it. */
export function projectStateDatabaseTaskSummary(task: Record<string, unknown>): Record<string, unknown> {
  return workItemSummary(task)
}

/**
 * The compatibility TASKS file is an index, not a second task database. Full
 * definitions live in per-task work_item_detail rows for promoted projects;
 * each row records the last queue revision that changed its own payload.
 * queue_detail and queue-details.json are migration compatibility stores only
 * and are not written by the current schema.
 */
export function compactProjectStateQueueForCompatibility(queue: unknown): unknown {
  const record = queueRecord(queue)
  const compactReleases = queueReleases(queue).map(release => {
    const compact: JsonRecord = {}
    for (const key of ['id', 'label', 'kind', 'state', 'source', 'proofStyle', 'nodeIds', 'deferredNodeIds']) {
      if (key in release) compact[key] = release[key]
    }
    return compact
  })
  return {
    detailStoreVersion: 1,
    ...(typeof record.version === 'number' ? { version: record.version } : { version: 1 }),
    ...(typeof record.lastUpdated === 'string' ? { lastUpdated: record.lastUpdated } : {}),
    ...(typeof record.selectedReleaseId === 'string' ? { selectedReleaseId: record.selectedReleaseId } : {}),
    tasks: queueTasks(queue).map(workItemSummary),
    releases: compactReleases,
  }
}

function writeSnapshotToDatabase(
  database: DatabaseSync,
  tasksPath: string,
  snapshot: ProjectStateDatabaseSnapshot,
): number {
  const tasks = queueTasks(snapshot.queue)
  const releases = releaseDefinitionsWithTaskMembership(queueReleases(snapshot.queue), tasks)
  const scopeRows = snapshot.scopeRows ?? []
  validateScopeRowsAgainstTaskIds(scopeRows, tasks.map(task => String(task.id ?? '')))
  const summary = isRecord(snapshot.summary) ? snapshot.summary : {}
  const { compact: compactSummary, orientation, approvedPlan } = summaryStoragePartsForDatabase(database, summary)
  const lastUpdated = sourceQueueLastUpdated(snapshot.queue)
  const mtimeMs = sourceQueueMtimeMs(tasksPath)
  const goalsMtimeMs = sourceWorkspaceGoalsMtimeMs(tasksPath)
  const generatedAt = stringValue(summary.generatedAt) ?? new Date().toISOString()
  const projectId = stringValue(summary.projectId)
  let committedRevision = 0

  transaction(database, () => {
    if (snapshot.expectedQueueRevision !== undefined) {
      const currentQueue = database.prepare('SELECT revision FROM queue_state WHERE id = 1').get() as JsonRecord | undefined
      const actualRevision = currentQueue ? Number(currentQueue.revision ?? 0) : null
      if (actualRevision !== snapshot.expectedQueueRevision) {
        throw new Error(
          `Stale project queue replacement: expected revision ${snapshot.expectedQueueRevision ?? 'none'}, found ${actualRevision ?? 'none'}. Read the current queue and retry.`,
        )
      }
    }
    assertShippedReleaseWriteAllowed(database, releases, tasks)
    database.prepare('DELETE FROM work_items').run()
    database.prepare('DELETE FROM task_dependencies').run()
    database.prepare('DELETE FROM scopes').run()
    database.prepare('DELETE FROM work_scope').run()
    if (snapshot.sourceCapabilities !== undefined) {
      replaceSourceCapabilityCatalog(database, snapshot.sourceCapabilities)
    }

    const insertTask = database.prepare(`
      INSERT INTO work_items (
        id, title, description, status, domain, priority, work_kind, parent_id,
        hierarchy_json, depends_on_json, release_ids_json, source_refs_json,
        summary_json, definition_json, updated_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const task of tasks) {
      const hierarchy = isRecord(task.hierarchy) ? task.hierarchy : null
      insertTask.run(
        String(task.id ?? ''),
        String(task.title ?? ''),
        stringValue(task.description),
        stringValue(task.status),
        stringValue(task.domain),
        stringValue(task.priority),
        stringValue(task.workKind),
        stringValue(hierarchy?.parentId),
        json(hierarchy),
        json(stringArray(task.dependsOn)),
        EMPTY_RELEASE_MEMBERSHIP_JSON,
        json(stringArray(task.sourceRefs ?? task.references)),
        json(workItemSummary(task)),
        '{}',
        stringValue(task.updatedAt),
        stringValue(task.completedAt),
      )
    }
    syncTaskDependencies(database, tasks)
    syncTaskCapabilityBindings(database, tasks, { replaceAll: snapshot.sourceCapabilities !== undefined })
    deleteOrphanTaskOverlays(database, tasks.map(task => String(task.id ?? '')).filter(Boolean))

    const insertScope = database.prepare(`
      INSERT INTO scopes (
        id, label, kind, state, source, proof_style,
        node_ids_json, deferred_node_ids_json, definition_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const release of releases) {
      const stored = releaseMembershipStorageFields(release)
      insertScope.run(
        String(release.id ?? ''),
        String(release.label ?? release.id ?? ''),
        stringValue(release.kind),
        stringValue(release.state),
        stringValue(release.source),
        stringValue(release.proofStyle),
        stored.nodeIdsJson,
        stored.deferredNodeIdsJson,
        stored.definitionJson,
      )
    }
    syncReleaseMembershipFromDefinitions(database, releases)

    database.prepare(`
      INSERT INTO queue_state (
        id, version, last_updated, selected_release_id,
        execution_plan_actions_json, scope_authority_requests_json, revision
      )
      VALUES (1, ?, ?, ?, ?, ?, 0)
      ON CONFLICT(id) DO UPDATE SET
        version = excluded.version,
        last_updated = excluded.last_updated,
        selected_release_id = excluded.selected_release_id,
        execution_plan_actions_json = excluded.execution_plan_actions_json,
        scope_authority_requests_json = excluded.scope_authority_requests_json
    `).run(
      Number.isFinite(Number(queueRecord(snapshot.queue).version)) ? Number(queueRecord(snapshot.queue).version) : 1,
      lastUpdated,
      stringValue(queueRecord(snapshot.queue).selectedReleaseId),
      json(Array.isArray(queueRecord(snapshot.queue).executionPlanActions) ? queueRecord(snapshot.queue).executionPlanActions : []),
      json(Array.isArray(queueRecord(snapshot.queue).scopeAuthorityRequests) ? queueRecord(snapshot.queue).scopeAuthorityRequests : []),
    )

    const insertScopeRow = database.prepare(`
      INSERT INTO work_scope (
        task_id, scope, eligibility_reason, hierarchy_role, handoff_state,
        blocks_start, blocks_release, human_blocking, count_in_project_totals, proof_blocked,
        blocker_summary, source_refs_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const row of scopeRows) {
      insertScopeRow.run(
        row.taskId,
        row.scope,
        row.eligibilityReason,
        row.hierarchyRole,
        row.handoffState,
        row.blocksStart ? 1 : 0,
        row.blocksRelease ? 1 : 0,
        row.humanBlocking ? 1 : 0,
        row.countInProjectTotals === false ? 0 : 1,
        row.proofBlocked ? 1 : 0,
        row.blockerSummary ?? null,
        json(row.sourceRefs),
      )
    }

    database.prepare(`
      INSERT INTO project_summary (
        id, payload_json, freshness, generated_at,
        revision, source_queue_last_updated, source_queue_mtime_ms
        , source_workspace_goals_mtime_ms
      ) VALUES (1, ?, 'current', ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        payload_json = excluded.payload_json,
        freshness = excluded.freshness,
        generated_at = excluded.generated_at,
        revision = excluded.revision,
        source_queue_last_updated = excluded.source_queue_last_updated,
        source_queue_mtime_ms = excluded.source_queue_mtime_ms,
        source_workspace_goals_mtime_ms = excluded.source_workspace_goals_mtime_ms
    `).run(
      json(compactSummaryWithReleaseMembershipRevision(database, compactSummary)),
      generatedAt,
      currentRevision(database) + 1,
      lastUpdated,
      mtimeMs,
      goalsMtimeMs,
    )

    const revision = commitAuthoritativeMutation(database, {
      updatedAt: generatedAt,
      domains: ['queue'],
      projectionDomains: snapshot.projectionDomains,
      summaryFreshness: 'preserve',
    })
    finalizeReleaseMembershipState(database, revision, generatedAt)
    database.prepare('UPDATE queue_state SET revision = ? WHERE id = 1').run(revision)
    replaceWorkItemDetails(database, tasks, revision)
    database.prepare('UPDATE project_meta SET project_id = ? WHERE id = 1').run(projectId)
    syncProjectPlanSnapshot(database, approvedPlan, generatedAt, revision)
    writeProjectOrientationProjection(database, orientation, generatedAt, revision)
    if (snapshot.execution) writeCurrentExecutionRow(database, snapshot.execution)
    if (snapshot.runtime) writeCurrentRuntimeRow(database, snapshot.runtime)
    if (snapshot.taskRuntimes !== undefined) {
      replaceTaskOverlayRowsInDatabase(database, 'task_execution', snapshot.taskRuntimes)
    }
    if (snapshot.taskWorkspaces !== undefined) {
      replaceTaskOverlayRowsInDatabase(database, 'task_workspace', snapshot.taskWorkspaces)
    }
    for (const entry of snapshot.evidence ?? []) {
      const durable = compactTaskEvidenceEvent(TaskEvidenceEvent.parse({ ...entry.event }))
      const retention = validateTaskEvidenceRetention(entry.retention)
      upsertTaskProofAndCurrentEvidence(database, {
        id: durable.id,
        taskId: durable.taskId,
        kind: durable.kind,
        recordedAt: durable.recordedAt,
        payload: durable.payload,
      })
      appendTaskEvidenceHistory(database, durable, retention)
    }
    // Per-task detail rows are the only current rich-detail authority now.
    // Keep the table name readable for compatibility with older databases,
    // but never write another full-queue payload after schema 22.
    database.prepare('DELETE FROM queue_detail').run()
    markProjectionCurrent(database, 'summary', revision, generatedAt)
    committedRevision = revision
  })
  return committedRevision
}

function deleteOrphanTaskOverlays(database: DatabaseSync, taskIds: readonly string[]): void {
  const ids = [...new Set(taskIds)]
  for (const table of ['task_execution', 'task_workspace', 'task_proof', 'task_evidence_current']) {
    if (!tableExists(database, table)) continue
    if (ids.length === 0) database.prepare(`DELETE FROM ${table}`).run()
    else database.prepare(`DELETE FROM ${table} WHERE task_id NOT IN (${ids.map(() => '?').join(', ')})`).run(...ids)
  }
}

function replaceWorkItemDetails(
  database: DatabaseSync,
  tasks: readonly JsonRecord[],
  revision: number,
): void {
  database.prepare('DELETE FROM work_item_detail').run()
  const insert = database.prepare(`
    INSERT INTO work_item_detail (task_id, revision, payload_gzip)
    VALUES (?, ?, ?)
  `)
  for (const task of tasks) {
    const taskId = stringValue(task.id)
    if (taskId) insert.run(taskId, revision, serializeWorkItemDetail(task))
  }
}

export interface ProjectStateDatabaseWorkItemDetailMigrationResult {
  migrated: boolean
  revision: number | null
  taskCount: number
}

export interface ProjectStateDatabaseCompactReadModelMigrationResult {
  migrated: boolean
  revision: number | null
  taskCount: number
  packetTaskCount: number
}

export interface ProjectStateDatabaseStoredRequestTitleRepairResult {
  migrated: boolean
  revision: number | null
  repairedCount: number
  inspectedCount: number
  ambiguousCount: number
}

function completeStoredRequestTitle(detail: JsonRecord): string | null {
  const request = isRecord(detail.request) ? detail.request : null
  const currentTitle = stringValue(request?.title)
  const raw = stringValue(request?.raw)
  if (!request || !currentTitle?.endsWith('...') || !raw) return null
  const prefix = currentTitle.slice(0, -3).trim()
  const candidate = raw
    .split(/\r?\n/)
    .find(line => line.trim().length > 0)
    ?.replace(/\s+/g, ' ')
    .trim()
  if (!candidate || !prefix || !candidate.startsWith(prefix)) return null
  return candidate
}

/**
 * Repair the one illegal persisted representation this boundary can prove:
 * an ellipsis-suffixed request title whose complete first line is still in
 * the request raw text. Ambiguous records are intentionally left untouched.
 */
export function readProjectStateDatabaseStoredRequestTitleRepairStatus(projectRoot: string): {
  needed: boolean
  inspectedCount: number
  repairableCount: number
  ambiguousCount: number
} {
  const databasePath = projectStateDatabasePath(projectRoot)
  if (!existsSync(databasePath)) return { needed: false, inspectedCount: 0, repairableCount: 0, ambiguousCount: 0 }
  const database = openDatabase(databasePath, { readOnly: true })
  try {
    if (!tableExists(database, 'work_item_detail')) return { needed: false, inspectedCount: 0, repairableCount: 0, ambiguousCount: 0 }
    const rows = database.prepare('SELECT payload_gzip FROM work_item_detail ORDER BY rowid').all() as JsonRecord[]
    let inspectedCount = 0
    let repairableCount = 0
    let ambiguousCount = 0
    for (const row of rows) {
      const detail = parseWorkItemDetail(row.payload_gzip)
      const request = detail && isRecord(detail.request) ? detail.request : null
      if (!request || typeof request.title !== 'string' || !request.title.endsWith('...')) continue
      inspectedCount += 1
      if (detail && completeStoredRequestTitle(detail)) repairableCount += 1
      else ambiguousCount += 1
    }
    return {
      needed: repairableCount > 0,
      inspectedCount,
      repairableCount,
      ambiguousCount,
    }
  } finally {
    database.close()
  }
}

/** Repair provably cropped request titles in the authoritative detail index. */
export function repairProjectStateDatabaseStoredRequestTitles(
  projectRoot: string,
): ProjectStateDatabaseStoredRequestTitleRepairResult {
  const result: ProjectStateDatabaseStoredRequestTitleRepairResult = {
    migrated: false,
    revision: null,
    repairedCount: 0,
    inspectedCount: 0,
    ambiguousCount: 0,
  }
  withWritableDatabase(projectRoot, database => {
    if (!tableExists(database, 'work_item_detail')) return
    const rows = database.prepare('SELECT task_id, payload_gzip FROM work_item_detail ORDER BY rowid').all() as JsonRecord[]
    const update = database.prepare('UPDATE work_item_detail SET payload_gzip = ? WHERE task_id = ?')
    for (const row of rows) {
      const taskId = stringValue(row.task_id)
      const detail = parseWorkItemDetail(row.payload_gzip)
      const request = detail && isRecord(detail.request) ? detail.request : null
      if (!taskId || !request || typeof request.title !== 'string' || !request.title.endsWith('...')) continue
      result.inspectedCount += 1
      const title = detail ? completeStoredRequestTitle(detail) : null
      if (!title) {
        result.ambiguousCount += 1
        continue
      }
      const nextDetail = {
        ...detail,
        request: { ...request, title },
      }
      update.run(serializeWorkItemDetail(nextDetail), taskId)
      result.repairedCount += 1
    }
    if (result.repairedCount === 0) {
      result.revision = currentRevision(database)
      return
    }
    const updatedAt = new Date().toISOString()
    result.migrated = true
    result.revision = commitAuthoritativeMutation(database, {
      updatedAt,
      domains: ['queue'],
      projectRoot,
    })
  })
  return result
}

/**
 * Backfill compact task read models from the one authoritative detail index.
 * This is an explicit representation migration; ordinary reads never open
 * detail payloads to discover graph-only fields.
 */
export function migrateProjectStateDatabaseCompactReadModels(
  projectRoot: string,
): ProjectStateDatabaseCompactReadModelMigrationResult {
  const result: ProjectStateDatabaseCompactReadModelMigrationResult = {
    migrated: false,
    revision: null,
    taskCount: 0,
    packetTaskCount: 0,
  }
  withWritableDatabase(projectRoot, database => {
    if (!tableExists(database, 'work_items') || !tableExists(database, 'work_item_detail')) return
    const detailRows = database.prepare('SELECT task_id, payload_gzip FROM work_item_detail ORDER BY rowid').all() as JsonRecord[]
    const currentEvidence = currentEvidenceForTaskIds(
      database,
      detailRows.flatMap(row => {
        const taskId = stringValue(row.task_id)
        return taskId ? [taskId] : []
      }),
    )
    const update = database.prepare('UPDATE work_items SET summary_json = ? WHERE id = ?')
    let changed = false
    for (const row of detailRows) {
      const taskId = stringValue(row.task_id)
      const detail = parseWorkItemDetail(row.payload_gzip)
      if (!taskId || !detail) continue
      const evidence = currentEvidence.get(taskId)
      const nextSummary = workItemSummary({
        ...detail,
        ...(evidence ? { evidence: currentEvidenceEventsForTask(taskId, evidence) } : {}),
      })
      const current = database.prepare('SELECT summary_json FROM work_items WHERE id = ?').get(taskId) as JsonRecord | undefined
      if (!current || JSON.stringify(parseJson<JsonRecord>(current.summary_json, {})) === JSON.stringify(nextSummary)) continue
      update.run(json(nextSummary), taskId)
      changed = true
      result.migrated = true
      if (Array.isArray(nextSummary.contractSurfaceReviewPackets) && nextSummary.contractSurfaceReviewPackets.length > 0) {
        result.packetTaskCount += 1
      }
    }
    result.taskCount = detailRows.length
    if (!changed) {
      result.revision = currentRevision(database)
      return
    }
    const generatedAt = new Date().toISOString()
    const revision = commitAuthoritativeMutation(database, {
      updatedAt: generatedAt,
      domains: ['queue'],
      summaryFreshness: 'preserve',
    })
    database.prepare('UPDATE project_summary SET revision = ?, generated_at = ? WHERE id = 1').run(revision, generatedAt)
    result.revision = revision
  })
  return result
}

export interface ProjectStateDatabaseTaskSummaryRewriteResult {
  updatedCount: number
  revision: number | null
}

/**
 * Replace only bounded indexed task summaries after an effective-state
 * projection. Full definitions and evidence stay in their existing stores;
 * this writer exists so migrations do not reach around the database boundary
 * or leave the point-read index behind the shared task model.
 */
export function rewriteProjectStateDatabaseTaskSummaries(
  projectRoot: string,
  summaries: readonly { taskId: string; summary: Record<string, unknown> }[],
): ProjectStateDatabaseTaskSummaryRewriteResult {
  const result: ProjectStateDatabaseTaskSummaryRewriteResult = {
    updatedCount: 0,
    revision: null,
  }
  withWritableDatabase(projectRoot, database => {
    if (!tableExists(database, 'work_items')) return
    const update = database.prepare('UPDATE work_items SET summary_json = ? WHERE id = ?')
    for (const item of summaries) {
      const current = database.prepare('SELECT summary_json FROM work_items WHERE id = ?').get(item.taskId) as JsonRecord | undefined
      if (!current) continue
      if (JSON.stringify(parseJson<JsonRecord>(current.summary_json, {})) === JSON.stringify(item.summary)) continue
      update.run(json(item.summary), item.taskId)
      result.updatedCount += 1
    }
    if (result.updatedCount === 0) {
      result.revision = currentQueueRevision(database)
      return
    }
    const projectRevision = commitAuthoritativeMutation(database, {
      updatedAt: new Date().toISOString(),
      domains: ['queue'],
      summaryFreshness: 'preserve',
    })
    database.prepare('UPDATE project_summary SET revision = ?, generated_at = ? WHERE id = 1').run(
      projectRevision,
      new Date().toISOString(),
    )
    result.revision = currentQueueRevision(database)
  })
  return result
}

/**
 * Backfill the per-task detail index from the authoritative aggregate once.
 * This is a representation migration: queue identity, revisions, and
 * historical evidence remain unchanged.
 */
export function migrateProjectStateDatabaseWorkItemDetails(
  projectRoot: string,
): ProjectStateDatabaseWorkItemDetailMigrationResult {
  const result: ProjectStateDatabaseWorkItemDetailMigrationResult = {
    migrated: false,
    revision: null,
    taskCount: 0,
  }
  withWritableDatabase(projectRoot, database => {
    if (!tableExists(database, 'work_item_detail')) return
    const revision = currentQueueRevision(database)
    result.revision = revision
    const detail = readQueueDetailsForRevision(
      getProjectSystemStatePath(projectRoot, 'TASKS.json'),
      revision,
      database,
      { migration: true },
    )
    if (!detail) return
    const tasks = queueTasks(detail)
    const existingTotal = Number((database.prepare('SELECT COUNT(*) AS count FROM work_item_detail').get() as JsonRecord | undefined)?.count ?? 0)
    if (existingTotal === tasks.length) {
      result.taskCount = existingTotal
      return
    }
    replaceWorkItemDetails(database, tasks, revision)
    result.migrated = true
    result.taskCount = tasks.length
  })
  return result
}

export interface ProjectStateDatabaseReleaseMembershipMigrationResult {
  migrated: boolean
  membershipCount: number
  revision: number | null
}

export interface ProjectStateDatabaseReleaseMembershipMirrorRetirementResult {
  retired: boolean
  taskMirrorCount: number
  scopeMirrorCount: number
  revision: number | null
}

export interface ProjectStateDatabaseReleaseMembershipStatus {
  schemaPresent: boolean
  complete: boolean
  membershipCount: number
  expectedCount: number
}

export interface ProjectStateDatabaseCompactReadModelStatus {
  schemaPresent: boolean
  complete: boolean
  taskCount: number
  completeTaskCount: number
}

export interface ProjectStateDatabaseCurrentProofReadModelStatus {
  schemaPresent: boolean
  complete: boolean
  taskCount: number
  currentProofTaskCount: number
}

/**
 * Migration readiness is a fact about the physical current-state store, not
 * about whether an old ledger row happens to survive. These probes stay in
 * sessions so migration status and ordinary reads inspect the same database
 * authority rather than teaching runtime code a second schema vocabulary.
 */
export function readProjectStateDatabaseThreadHistoryStorePresent(projectRoot: string): boolean {
  const databasePath = projectStateDatabasePath(projectRoot)
  if (!existsSync(databasePath)) return false
  const database = openDatabase(databasePath, { readOnly: true })
  try {
    return tableExists(database, 'thread_history') && tableExists(database, 'thread_history_state')
  } finally {
    database.close()
  }
}

function desiredReleaseMembershipFromDatabase(database: DatabaseSync): ProjectStateDatabaseReleaseMembership[] {
  const releaseRows = database.prepare('SELECT definition_json FROM scopes ORDER BY id').all() as JsonRecord[]
  const releases = releaseRows
    .map(row => parseJson<JsonRecord>(row.definition_json, {}))
    .filter(release => typeof release.id === 'string')
  const desired = releaseMembershipFromDefinitions(releases)
  if (desired.length > 0) return desired
  const taskRows = database.prepare('SELECT id, status, release_ids_json FROM work_items').all() as JsonRecord[]
  for (const task of taskRows) {
    const taskId = stringValue(task.id)
    if (!taskId) continue
    const disposition = task.status === 'shelved' ? 'deferred' : 'included'
    for (const releaseId of parseJson<string[]>(task.release_ids_json, [])) {
      if (typeof releaseId === 'string' && releaseId.trim()) {
        desired.push({ releaseId, taskId, disposition })
      }
    }
  }
  return desired
}

export function readProjectStateDatabaseReleaseMembershipStatus(
  projectRoot: string,
): ProjectStateDatabaseReleaseMembershipStatus {
  const missing: ProjectStateDatabaseReleaseMembershipStatus = {
    schemaPresent: false,
    complete: false,
    membershipCount: 0,
    expectedCount: 0,
  }
  const databasePath = projectStateDatabasePath(projectRoot)
  if (!existsSync(databasePath)) return missing
  const database = openDatabase(databasePath, { readOnly: true })
  try {
    if (!tableExists(database, 'release_membership') || !tableExists(database, 'release_membership_state')) return missing
    const existing = database.prepare('SELECT release_id, task_id, disposition FROM release_membership').all() as JsonRecord[]
    // A populated normalized relation is already authoritative. Empty is
    // valid only when the current store has no release membership to import.
    const desired = desiredReleaseMembershipFromDatabase(database)
    const existingKey = new Set(existing.map(row => `${row.release_id}\0${row.task_id}\0${row.disposition}`))
    const desiredKey = new Set(desired.map(row => `${row.releaseId}\0${row.taskId}\0${row.disposition}`))
    const relationComplete = existingKey.size > 0
      ? desiredKey.size === 0 || (
          existingKey.size === desiredKey.size &&
          [...existingKey].every(key => desiredKey.has(key))
        )
      : desiredKey.size === 0
    return {
      schemaPresent: true,
      complete: relationComplete && readReleaseMembershipStateFromDatabase(database)?.projectRevision !== null,
      membershipCount: existing.length,
      expectedCount: desired.length,
    }
  } finally {
    database.close()
  }
}

export function readProjectStateDatabaseCompactReadModelStatus(
  projectRoot: string,
): ProjectStateDatabaseCompactReadModelStatus {
  const missing: ProjectStateDatabaseCompactReadModelStatus = {
    schemaPresent: false,
    complete: false,
    taskCount: 0,
    completeTaskCount: 0,
  }
  const databasePath = projectStateDatabasePath(projectRoot)
  if (!existsSync(databasePath)) return missing
  const database = openDatabase(databasePath, { readOnly: true })
  try {
    if (!tableExists(database, 'work_items') || !tableExists(database, 'work_item_detail') || !tableHasColumn(database, 'work_items', 'summary_json')) {
      return missing
    }
    const tasks = database.prepare('SELECT id, summary_json FROM work_items ORDER BY rowid').all() as JsonRecord[]
    const details = new Map(
      (database.prepare('SELECT task_id, payload_gzip FROM work_item_detail ORDER BY rowid').all() as JsonRecord[])
        .flatMap(row => {
          const taskId = stringValue(row.task_id)
          const detail = taskId ? parseWorkItemDetail(row.payload_gzip) : null
          return taskId && detail ? [[taskId, detail] as const] : []
        }),
    )
    let completeTaskCount = 0
    for (const task of tasks) {
      const id = stringValue(task.id)
      const detail = id ? details.get(id) : null
      const actual = parseJson<JsonRecord>(task.summary_json, {})
      if (detail && JSON.stringify(actual) === JSON.stringify(workItemSummary(detail))) completeTaskCount += 1
    }
    return {
      schemaPresent: true,
      complete: completeTaskCount === tasks.length,
      taskCount: tasks.length,
      completeTaskCount,
    }
  } finally {
    database.close()
  }
}

/**
 * Check the additive current-proof field against the authoritative task detail.
 * This runs only as a migration probe; ordinary project reads remain
 * index-only. Comparing the bounded sub-object catches old rows that have a
 * proof field with stale, history-derived semantics.
 */
export function readProjectStateDatabaseCurrentProofReadModelStatus(
  projectRoot: string,
): ProjectStateDatabaseCurrentProofReadModelStatus {
  const missing: ProjectStateDatabaseCurrentProofReadModelStatus = {
    schemaPresent: false,
    complete: false,
    taskCount: 0,
    currentProofTaskCount: 0,
  }
  const databasePath = projectStateDatabasePath(projectRoot)
  if (!existsSync(databasePath)) return missing
  const database = openDatabase(databasePath, { readOnly: true })
  try {
    if (!tableExists(database, 'work_items') || !tableExists(database, 'work_item_detail') || !tableHasColumn(database, 'work_items', 'summary_json')) {
      return missing
    }
    const rows = database.prepare('SELECT id, summary_json FROM work_items ORDER BY rowid').all() as JsonRecord[]
    const details = new Map(
      (database.prepare('SELECT task_id, payload_gzip FROM work_item_detail ORDER BY rowid').all() as JsonRecord[])
        .flatMap(row => {
          const taskId = stringValue(row.task_id)
          const detail = taskId ? parseWorkItemDetail(row.payload_gzip) : null
          return taskId && detail ? [[taskId, detail] as const] : []
        }),
    )
    const currentEvidence = currentEvidenceForTaskIds(database, [...details.keys()])
    let currentProofTaskCount = 0
    for (const row of rows) {
      const taskId = stringValue(row.id)
      const detail = taskId ? details.get(taskId) : null
      if (!detail) continue
      const summary = parseJson<JsonRecord>(row.summary_json, {})
      const currentSummary = isRecord(summary.currentSummary) ? summary.currentSummary : null
      const evidence = taskId ? currentEvidence.get(taskId) : undefined
      const expectedCurrentSummary = workItemSummary({
        ...detail,
        ...(evidence ? { evidence: currentEvidenceEventsForTask(taskId!, evidence) } : {}),
      }).currentSummary
      const actualProof = currentSummary?.proof
      const expectedProof = isRecord(expectedCurrentSummary) ? expectedCurrentSummary.proof : undefined
      if (JSON.stringify(actualProof) === JSON.stringify(expectedProof)) currentProofTaskCount += 1
    }
    return {
      schemaPresent: true,
      complete: currentProofTaskCount === rows.length,
      taskCount: rows.length,
      currentProofTaskCount,
    }
  } finally {
    database.close()
  }
}

/**
 * Promote release membership from the last queue envelope into its one
 * normalized relation. This is the only migration that is allowed to inspect
 * the old node-id mirrors; ordinary readers use release_membership only.
 */
export function migrateProjectStateDatabaseReleaseMembership(
  projectRoot: string,
): ProjectStateDatabaseReleaseMembershipMigrationResult {
  const result: ProjectStateDatabaseReleaseMembershipMigrationResult = {
    migrated: false,
    membershipCount: 0,
    revision: null,
  }
  withWritableDatabase(projectRoot, database => {
    if (!tableExists(database, 'release_membership')) return
    const existing = database.prepare('SELECT release_id, task_id, disposition FROM release_membership').all() as JsonRecord[]
    // A populated normalized relation is already the current authority. The
    // migration may import old mirrors into an empty relation, but it must
    // never overwrite a valid relation with intentionally empty compatibility
    // columns from a newer write.
    const desired = existing.length > 0
      ? existing.map(row => ({
          releaseId: String(row.release_id),
          taskId: String(row.task_id),
          disposition: String(row.disposition) as ProjectStateDatabaseReleaseMembership['disposition'],
        }))
      : desiredReleaseMembershipFromDatabase(database)
    result.membershipCount = desired.length
    const relationChanged = syncNormalizedReleaseMembership(database, desired)
    const state = readReleaseMembershipStateFromDatabase(database)
    if (!relationChanged && state?.projectRevision !== null) return
    const updatedAt = new Date().toISOString()
    result.revision = commitAuthoritativeMutation(database, {
      updatedAt,
      domains: ['queue'],
      projectionDomains: ['summary'],
      summaryFreshness: 'stale',
    })
    finalizeReleaseMembershipState(database, result.revision, updatedAt)
    result.migrated = true
  })
  return result
}

/**
 * Publish the normalized relation as the sole current membership authority
 * and remove the old JSON copies. This is deliberately separate from the
 * import migration: a populated relation must be verified before its mirrors
 * can be deleted, and a watermark makes that cutover observable.
 */
export function retireProjectStateDatabaseReleaseMembershipMirrors(
  projectRoot: string,
): ProjectStateDatabaseReleaseMembershipMirrorRetirementResult {
  const result: ProjectStateDatabaseReleaseMembershipMirrorRetirementResult = {
    retired: false,
    taskMirrorCount: 0,
    scopeMirrorCount: 0,
    revision: null,
  }
  withWritableDatabase(projectRoot, database => {
    if (!tableExists(database, 'release_membership')) return
    const relationCount = Number((database.prepare('SELECT COUNT(*) AS count FROM release_membership').get() as JsonRecord | undefined)?.count ?? 0)
    const desired = desiredReleaseMembershipFromDatabase(database)
    if (relationCount === 0 && desired.length > 0) {
      throw new Error('Release membership mirrors cannot be retired before the normalized relation is complete.')
    }

    result.taskMirrorCount = Number((database.prepare("SELECT COUNT(*) AS count FROM work_items WHERE release_ids_json <> '[]'").get() as JsonRecord | undefined)?.count ?? 0)
    const scopeRows = database.prepare('SELECT id, node_ids_json, deferred_node_ids_json, definition_json FROM scopes').all() as JsonRecord[]
    const scopeDefinitionsToUpdate = scopeRows.flatMap(row => {
      const definition = parseJson<JsonRecord>(row.definition_json, {})
      const hasDefinitionMembership = 'nodeIds' in definition || 'deferredNodeIds' in definition
      const hasColumnMembership = row.node_ids_json !== '[]' || row.deferred_node_ids_json !== '[]'
      return hasDefinitionMembership || hasColumnMembership
        ? [{ id: String(row.id), definition: releaseMembershipStorageFields(definition).definitionJson }]
        : []
    })
    result.scopeMirrorCount = scopeDefinitionsToUpdate.length
    const now = new Date().toISOString()
    const revision = result.taskMirrorCount > 0 || result.scopeMirrorCount > 0
      ? commitAuthoritativeMutation(database, {
          updatedAt: now,
          domains: ['queue'],
          projectionDomains: [],
          summaryFreshness: 'preserve',
        })
      : currentRevision(database)
    database.prepare("UPDATE work_items SET release_ids_json = '[]' WHERE release_ids_json <> '[]'").run()
    database.prepare("UPDATE scopes SET node_ids_json = '[]', deferred_node_ids_json = '[]' WHERE node_ids_json <> '[]' OR deferred_node_ids_json <> '[]'").run()
    const updateScopeDefinition = database.prepare('UPDATE scopes SET definition_json = ? WHERE id = ?')
    for (const row of scopeDefinitionsToUpdate) updateScopeDefinition.run(row.definition, row.id)
    markProjectionCurrent(database, 'release-membership', revision, now)
    result.retired = result.taskMirrorCount > 0 || result.scopeMirrorCount > 0
    result.revision = revision
  })
  return result
}

export function writeProjectStateDatabaseSnapshot(
  tasksPath: string,
  snapshot: ProjectStateDatabaseSnapshot,
): void {
  if (snapshot.projectRoot && !existsSync(projectStateDatabasePath(snapshot.projectRoot))) {
    ensureProjectLocalHistoryDir(snapshot.projectRoot)
  }
  const database = openDatabase(projectStateDatabasePathFromTasksPath(tasksPath))
  let revision = 0
  try {
    revision = writeSnapshotToDatabase(database, tasksPath, snapshot)
  } finally {
    database.close()
  }
  // Historical sidecars are an explicit migration bridge only. The normal
  // writer has one current-state representation: SQLite's indexed detail.
  if (snapshot.compatibilityExport) {
    atomicWriteBytes(
      projectStateDatabaseCompressedDetailPathFromTasksPath(tasksPath),
      snapshot.compatibilityExport === 'compact'
        ? serializeProjectStateDetailStore(compactProjectStateQueueForCompatibility(snapshot.queue), revision)
        : serializeProjectStateDetailStore(snapshot.queue, revision),
    )
  }
}

/**
 * Commit one task against the promoted SQLite current-state authority.
 *
 * This is intentionally narrower than writeProjectStateDatabaseSnapshot: it
 * updates one work item/detail payload and its changed derived scope rows. Existing
 * detail rows receive the new queue watermark without being decompressed or
 * rewritten so an explicit rich queue read still observes one coherent
 * revision after the transaction commits.
 */
export function writeProjectStateDatabaseTaskMutation(
  tasksPath: string,
  mutation: ProjectStateDatabaseTaskMutation,
): number {
  if (readProjectStateDatabaseAuthoritySnapshotFromTasksPath(tasksPath)?.authority !== 'database') {
    throw new Error('Targeted current-state mutations require database project-state authority')
  }
  const taskId = stringValue(mutation.task.id)
  if (!taskId) throw new Error('Targeted current-state mutations require a task id')
  if (!Number.isInteger(mutation.expectedQueueRevision) || mutation.expectedQueueRevision < 0) {
    throw new Error('Targeted current-state mutations require a non-negative integer queue revision')
  }
  if (!Number.isInteger(mutation.expectedProjectRevision) || mutation.expectedProjectRevision < 0) {
    throw new Error('Targeted current-state mutations require a non-negative integer project revision')
  }
  if (mutation.scopeRow !== undefined && mutation.scopeRow !== null && mutation.scopeRow.taskId !== taskId) {
    throw new Error(`Targeted current-state mutation scope row must belong to ${taskId}`)
  }
  if (mutation.scopeRow !== undefined && mutation.scopeRows !== undefined) {
    throw new Error('Targeted current-state mutations cannot use scopeRow and scopeRows together')
  }
  const database = openDatabase(projectStateDatabasePathFromTasksPath(tasksPath))
  let committedRevision = 0
  try {
    transaction(database, () => {
      const queueRow = database.prepare('SELECT revision, last_updated FROM queue_state WHERE id = 1').get() as JsonRecord | undefined
      const actualRevision = queueRow ? Number(queueRow.revision ?? 0) : null
      if (actualRevision !== mutation.expectedQueueRevision) {
        throw new Error(
          `Stale targeted project mutation: expected revision ${mutation.expectedQueueRevision}, found ${actualRevision ?? 'none'}. Read the current task and retry.`,
        )
      }
      const actualProjectRevision = currentRevision(database)
      if (actualProjectRevision !== mutation.expectedProjectRevision) {
        throw new Error(
          `Stale targeted project mutation: expected project revision ${mutation.expectedProjectRevision}, found ${actualProjectRevision}. Read the current project and retry.`,
        )
      }
      if (!tableExists(database, 'work_item_detail')) {
        throw new Error('Targeted current-state mutations require the per-task detail index')
      }
      const itemCount = Number((database.prepare('SELECT COUNT(*) AS count FROM work_items').get() as JsonRecord | undefined)?.count ?? 0)
      const detailCount = Number((database.prepare('SELECT COUNT(*) AS count FROM work_item_detail').get() as JsonRecord | undefined)?.count ?? 0)
      const missingDetail = database.prepare(`
        SELECT work_items.id
        FROM work_items
        LEFT JOIN work_item_detail ON work_item_detail.task_id = work_items.id
        WHERE work_item_detail.task_id IS NULL
        LIMIT 1
      `).get() as JsonRecord | undefined
      if (itemCount !== detailCount || missingDetail) {
        throw new Error(`Targeted current-state mutation refused: detail index is incomplete (${detailCount}/${itemCount})`)
      }
      if (!database.prepare('SELECT 1 FROM work_items WHERE id = ?').get(taskId)) {
        throw new Error(`Cannot mutate current work item ${taskId}: item not found`)
      }
      const normalizedReleases = releaseDefinitionsWithTaskMembership(
        releaseDefinitionsFromDatabase(database),
        [mutation.task],
        { clearUnlistedTaskMembership: true },
      )
      assertShippedReleaseWriteAllowed(database, normalizedReleases, [mutation.task], { nextTasksComplete: false })
      const generatedAt = stringValue(mutation.summary.generatedAt) ?? new Date().toISOString()
      const lastUpdated = mutation.lastUpdated ?? stringValue(mutation.task.updatedAt) ?? stringValue(queueRow?.last_updated)
      const { compact: compactSummary, orientation, approvedPlan } = summaryStoragePartsForDatabase(database, mutation.summary)
      const source = isRecord(mutation.summary.source) ? mutation.summary.source : null
    const revision = commitAuthoritativeMutation(database, {
      updatedAt: generatedAt,
      domains: ['queue'],
      projectionDomains: mutation.projectionDomains,
      summaryFreshness: 'preserve',
    })

      const updated = database.prepare(`
        UPDATE work_items SET
          title = ?, description = ?, status = ?, domain = ?, priority = ?,
          work_kind = ?, parent_id = ?, hierarchy_json = ?, depends_on_json = ?,
          release_ids_json = ?, source_refs_json = ?, summary_json = ?,
          definition_json = ?, updated_at = ?, completed_at = ?
        WHERE id = ?
      `).run(
        String(mutation.task.title ?? taskId),
        stringValue(mutation.task.description),
        stringValue(mutation.task.status),
        stringValue(mutation.task.domain),
        stringValue(mutation.task.priority),
        stringValue(mutation.task.workKind),
        stringValue(isRecord(mutation.task.hierarchy) ? mutation.task.hierarchy.parentId : undefined),
        json(isRecord(mutation.task.hierarchy) ? mutation.task.hierarchy : null),
        json(stringArray(mutation.task.dependsOn)),
        EMPTY_RELEASE_MEMBERSHIP_JSON,
        json(stringArray(mutation.task.sourceRefs ?? mutation.task.references)),
        json(workItemSummary(mutation.task)),
        '{}',
        stringValue(mutation.task.updatedAt),
        stringValue(mutation.task.completedAt),
        taskId,
      )
      if (Number(updated.changes ?? 0) !== 1) {
        throw new Error(`Cannot mutate current work item ${taskId}: item not found`)
      }
      syncTaskDependencies(database, [mutation.task])
      syncTaskCapabilityBindings(database, [mutation.task])

      // A task edit may legitimately assign or unassign the task from a
      // release. Normalize that relationship in this same transaction. The
      // task definition is the input; release_membership remains the only
      // persisted authority used by later reads.
      upsertReleaseDefinitions(database, normalizedReleases)
      syncReleaseMembershipFromDefinitions(database, normalizedReleases)
      finalizeReleaseMembershipState(database, revision, generatedAt)

      /*
       * Keep the existing snapshot-revision invariant for rich queue reads.
       * This changes only the small integer watermark for untouched rows; it
       * does not decompress or rewrite their detail payloads.
       */
      database.prepare(`
        INSERT INTO work_item_detail (
          task_id, revision, payload_gzip
        ) VALUES (?, ?, ?)
        ON CONFLICT(task_id) DO UPDATE SET
          revision = excluded.revision,
          payload_gzip = excluded.payload_gzip
      `).run(taskId, revision, serializeWorkItemDetail(mutation.task))

      /*
       * The work-item index stores parent/dependency indexes and compact task
       * fields. Release membership is normalized in release_membership and is
       * updated in this same transaction; scope is separate because it is a
       * derived selected-scope projection.
       */
      const scopeRows = mutation.scopeRows ?? (mutation.scopeRow === undefined
        ? []
        : mutation.scopeRow === null ? [] : [mutation.scopeRow])
      const scopeRowsByTaskId = new Map<string, ProjectStateDatabaseScopeRow>()
      for (const row of scopeRows) {
        if (scopeRowsByTaskId.has(row.taskId)) throw new Error(`Targeted current-state mutation received duplicate scope row ${row.taskId}`)
        if (!database.prepare('SELECT 1 FROM work_items WHERE id = ?').get(row.taskId)) {
          throw new Error(`Cannot scope unknown work item ${row.taskId}`)
        }
        scopeRowsByTaskId.set(row.taskId, row)
      }
      const removeScopeRowTaskIds = new Set(mutation.removeScopeRowTaskIds ?? [])
      if (mutation.scopeRow === null) removeScopeRowTaskIds.add(taskId)
      for (const scopeTaskId of removeScopeRowTaskIds) {
        if (scopeRowsByTaskId.has(scopeTaskId)) {
          throw new Error(`Targeted current-state mutation cannot replace and remove scope row ${scopeTaskId}`)
        }
        database.prepare('DELETE FROM work_scope WHERE task_id = ?').run(scopeTaskId)
      }
      if (scopeRowsByTaskId.size > 0) {
        const upsertScopeRow = database.prepare(`
            INSERT INTO work_scope (
              task_id, scope, eligibility_reason, hierarchy_role, handoff_state,
              blocks_start, blocks_release, human_blocking, count_in_project_totals, proof_blocked,
              blocker_summary, source_refs_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(task_id) DO UPDATE SET
              scope = excluded.scope,
              eligibility_reason = excluded.eligibility_reason,
              hierarchy_role = excluded.hierarchy_role,
              handoff_state = excluded.handoff_state,
              blocks_start = excluded.blocks_start,
              blocks_release = excluded.blocks_release,
              human_blocking = excluded.human_blocking,
              count_in_project_totals = excluded.count_in_project_totals,
              proof_blocked = excluded.proof_blocked,
              blocker_summary = excluded.blocker_summary,
              source_refs_json = excluded.source_refs_json
          `)
        for (const row of scopeRowsByTaskId.values()) {
          upsertScopeRow.run(
            row.taskId,
            row.scope,
            row.eligibilityReason,
            row.hierarchyRole,
            row.handoffState,
            row.blocksStart ? 1 : 0,
            row.blocksRelease ? 1 : 0,
            row.humanBlocking ? 1 : 0,
            row.countInProjectTotals === false ? 0 : 1,
            row.proofBlocked ? 1 : 0,
            row.blockerSummary ?? null,
            json(row.sourceRefs),
          )
        }
      }

      database.prepare('UPDATE queue_state SET last_updated = ?, revision = ? WHERE id = 1').run(lastUpdated, revision)
      const mtimeMs = sourceQueueMtimeMs(tasksPath)
      const goalsMtimeMs = sourceWorkspaceGoalsMtimeMs(tasksPath)
      database.prepare(`
        INSERT INTO project_summary (
          id, payload_json, freshness, generated_at,
          revision, source_queue_last_updated, source_queue_mtime_ms
          , source_workspace_goals_mtime_ms
        ) VALUES (1, ?, 'current', ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          payload_json = excluded.payload_json,
          freshness = excluded.freshness,
          generated_at = excluded.generated_at,
          revision = excluded.revision,
          source_queue_last_updated = excluded.source_queue_last_updated,
          source_queue_mtime_ms = excluded.source_queue_mtime_ms,
          source_workspace_goals_mtime_ms = excluded.source_workspace_goals_mtime_ms
      `).run(
        json(compactSummaryWithReleaseMembershipRevision(database, compactSummary)),
        generatedAt,
        revision,
        stringValue(source?.taskQueueLastUpdated) ?? stringValue(mutation.summary.sourceQueueLastUpdated) ?? lastUpdated,
        mtimeMs,
        goalsMtimeMs,
      )
      syncProjectPlanSnapshot(database, approvedPlan, generatedAt, revision)
      writeProjectOrientationProjection(database, orientation, generatedAt, revision, { preserveOmitted: true })
      for (const entry of mutation.evidence ?? []) {
        const durable = compactTaskEvidenceEvent(TaskEvidenceEvent.parse({ ...entry.event }))
        const retention = validateTaskEvidenceRetention(entry.retention)
        upsertTaskProofAndCurrentEvidence(database, {
          id: durable.id,
          taskId: durable.taskId,
          kind: durable.kind,
          recordedAt: durable.recordedAt,
          payload: durable.payload,
        })
        appendTaskEvidenceHistory(database, durable, retention)
      }
      markProjectionCurrent(database, 'summary', revision, generatedAt)
      committedRevision = revision
    })
  } finally {
    database.close()
  }
  return committedRevision
}

/**
 * Commit a release-envelope selection without rewriting task definitions.
 *
 * Release selection changes the project scope projection, so this advances
 * the same queue revision as a task mutation. Unchanged task detail payloads
 * keep their own content revision; they are not rewritten just because the
 * queue's summary or scope revision advanced.
 */
export function writeProjectStateDatabaseReleaseSelectionMutation(
  tasksPath: string,
  mutation: ProjectStateDatabaseReleaseSelectionMutation,
): number {
  if (readProjectStateDatabaseAuthoritySnapshotFromTasksPath(tasksPath)?.authority !== 'database') {
    throw new Error('Targeted release selection mutations require database project-state authority')
  }
  if (!Number.isInteger(mutation.expectedQueueRevision) || mutation.expectedQueueRevision < 0) {
    throw new Error('Targeted release selection mutations require a non-negative integer queue revision')
  }
  if (!Number.isInteger(mutation.expectedProjectRevision) || mutation.expectedProjectRevision < 0) {
    throw new Error('Targeted release selection mutations require a non-negative integer project revision')
  }
  if (!mutation.selectedReleaseId) throw new Error('Targeted release selection mutations require a selected release')

  const releases = mutation.releases.map(release => ({ ...release }))
  const releasesById = new Map<string, JsonRecord>()
  for (const release of releases) {
    const id = stringValue(release.id)
    if (!id) throw new Error('Targeted release selection mutations require release ids')
    if (releasesById.has(id)) throw new Error(`Targeted release selection mutations received duplicate release ${id}`)
    releasesById.set(id, release)
  }
  if (!releasesById.has(mutation.selectedReleaseId)) {
    throw new Error(`Cannot select release ${mutation.selectedReleaseId}: release not found in the current envelope`)
  }

  const scopeRowKey = (row: ProjectStateDatabaseScopeRow): string => JSON.stringify({
    taskId: row.taskId,
    scope: row.scope,
    eligibilityReason: row.eligibilityReason,
    hierarchyRole: row.hierarchyRole,
    handoffState: row.handoffState,
    blocksStart: row.blocksStart,
    blocksRelease: row.blocksRelease,
    humanBlocking: row.humanBlocking,
    proofBlocked: row.proofBlocked ?? false,
    blockerSummary: row.blockerSummary ?? null,
    sourceRefs: row.sourceRefs,
  })
  const scopeRowsByTaskId = new Map<string, ProjectStateDatabaseScopeRow>()
  for (const row of mutation.scopeRows) {
    if (scopeRowsByTaskId.has(row.taskId)) throw new Error(`Targeted release selection mutations received duplicate scope row ${row.taskId}`)
    scopeRowsByTaskId.set(row.taskId, row)
  }

  const database = openDatabase(projectStateDatabasePathFromTasksPath(tasksPath))
  let committedRevision = 0
  try {
    transaction(database, () => {
      const queueRow = database.prepare('SELECT revision, last_updated FROM queue_state WHERE id = 1').get() as JsonRecord | undefined
      const actualRevision = queueRow ? Number(queueRow.revision ?? 0) : null
      if (actualRevision !== mutation.expectedQueueRevision) {
        throw new Error(
          `Stale targeted release selection: expected revision ${mutation.expectedQueueRevision}, found ${actualRevision ?? 'none'}. Read the current project and retry.`,
        )
      }
      const actualProjectRevision = currentRevision(database)
      if (actualProjectRevision !== mutation.expectedProjectRevision) {
        throw new Error(
          `Stale targeted release selection: expected project revision ${mutation.expectedProjectRevision}, found ${actualProjectRevision}. Read the current project and retry.`,
        )
      }
      if (!tableExists(database, 'work_item_detail')) {
        throw new Error('Targeted release selection mutations require the per-task detail index')
      }
      assertShippedReleaseWriteAllowed(database, releases, [], { nextReleasesComplete: false, nextTasksComplete: false })

      const existingReleases = database.prepare('SELECT id, label, kind, state, source, proof_style, node_ids_json, deferred_node_ids_json, definition_json FROM scopes').all() as JsonRecord[]
      const existingReleasesById = new Map(existingReleases.map(row => [String(row.id), row]))
      for (const [id, release] of releasesById) {
        const existing = existingReleasesById.get(id)
        const stored = releaseMembershipStorageFields(release)
        const definitionJson = stored.definitionJson
        if (existing && existing.definition_json === definitionJson) continue
        database.prepare(`
          INSERT INTO scopes (
            id, label, kind, state, source, proof_style,
            node_ids_json, deferred_node_ids_json, definition_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            label = excluded.label,
            kind = excluded.kind,
            state = excluded.state,
            source = excluded.source,
            proof_style = excluded.proof_style,
            node_ids_json = excluded.node_ids_json,
            deferred_node_ids_json = excluded.deferred_node_ids_json,
            definition_json = excluded.definition_json
        `).run(
          id,
          String(release.label ?? id),
          stringValue(release.kind),
          stringValue(release.state),
          stringValue(release.source),
          stringValue(release.proofStyle),
          stored.nodeIdsJson,
          stored.deferredNodeIdsJson,
          definitionJson,
        )
      }
      syncReleaseMembershipFromDefinitions(database, releases)
      for (const id of existingReleasesById.keys()) {
        if (!releasesById.has(id)) database.prepare('DELETE FROM scopes WHERE id = ?').run(id)
      }

      const existingScopeRows = database.prepare(`
        SELECT task_id, scope, eligibility_reason, hierarchy_role, handoff_state,
          blocks_start, blocks_release, human_blocking, count_in_project_totals, proof_blocked,
          blocker_summary, source_refs_json
        FROM work_scope
      `).all() as JsonRecord[]
      const existingScopeRowsByTaskId = new Map(existingScopeRows.map(row => [String(row.task_id), {
        taskId: String(row.task_id),
        scope: row.scope,
        eligibilityReason: String(row.eligibility_reason ?? ''),
        hierarchyRole: String(row.hierarchy_role ?? ''),
        handoffState: String(row.handoff_state ?? ''),
        blocksStart: Number(row.blocks_start ?? 0) === 1,
        blocksRelease: Number(row.blocks_release ?? 0) === 1,
        humanBlocking: Number(row.human_blocking ?? 0) === 1,
        ...(Number(row.count_in_project_totals ?? 1) === 0 ? { countInProjectTotals: false } : {}),
        proofBlocked: Number(row.proof_blocked ?? 0) === 1,
        ...(typeof row.blocker_summary === 'string' && row.blocker_summary.trim()
          ? { blockerSummary: row.blocker_summary }
          : {}),
        sourceRefs: parseJson<string[]>(row.source_refs_json, []),
      } as ProjectStateDatabaseScopeRow]))
      for (const taskId of existingScopeRowsByTaskId.keys()) {
        if (!scopeRowsByTaskId.has(taskId)) database.prepare('DELETE FROM work_scope WHERE task_id = ?').run(taskId)
      }
      const upsertScopeRow = database.prepare(`
        INSERT INTO work_scope (
          task_id, scope, eligibility_reason, hierarchy_role, handoff_state,
          blocks_start, blocks_release, human_blocking, count_in_project_totals, proof_blocked,
          blocker_summary, source_refs_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(task_id) DO UPDATE SET
          scope = excluded.scope,
          eligibility_reason = excluded.eligibility_reason,
          hierarchy_role = excluded.hierarchy_role,
          handoff_state = excluded.handoff_state,
          blocks_start = excluded.blocks_start,
          blocks_release = excluded.blocks_release,
          human_blocking = excluded.human_blocking,
          count_in_project_totals = excluded.count_in_project_totals,
          proof_blocked = excluded.proof_blocked,
          blocker_summary = excluded.blocker_summary,
          source_refs_json = excluded.source_refs_json
      `)
      for (const row of scopeRowsByTaskId.values()) {
        if (existingScopeRowsByTaskId.get(row.taskId) && scopeRowKey(existingScopeRowsByTaskId.get(row.taskId)!) === scopeRowKey(row)) continue
        upsertScopeRow.run(
          row.taskId,
          row.scope,
          row.eligibilityReason,
          row.hierarchyRole,
          row.handoffState,
          row.blocksStart ? 1 : 0,
          row.blocksRelease ? 1 : 0,
          row.humanBlocking ? 1 : 0,
          row.countInProjectTotals === false ? 0 : 1,
          row.proofBlocked ? 1 : 0,
          row.blockerSummary ?? null,
          json(row.sourceRefs),
        )
      }

      const generatedAt = stringValue(mutation.summary.generatedAt) ?? new Date().toISOString()
      const lastUpdated = mutation.lastUpdated ?? stringValue(queueRow?.last_updated)
      const { compact: compactSummary, orientation, approvedPlan } = summaryStoragePartsForDatabase(database, mutation.summary)
      const source = isRecord(mutation.summary.source) ? mutation.summary.source : null
      const revision = commitAuthoritativeMutation(database, {
        updatedAt: generatedAt,
        domains: ['release'],
        projectionDomains: mutation.projectionDomains,
        summaryFreshness: 'preserve',
      })
      finalizeReleaseMembershipState(database, revision, generatedAt)
      database.prepare(`
        UPDATE queue_state
        SET selected_release_id = ?, last_updated = ?, revision = ?
        WHERE id = 1
      `).run(mutation.selectedReleaseId, lastUpdated, revision)
      database.prepare(`
        INSERT INTO project_summary (
          id, payload_json, freshness, generated_at,
          revision, source_queue_last_updated, source_queue_mtime_ms,
          source_workspace_goals_mtime_ms
        ) VALUES (1, ?, 'current', ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          payload_json = excluded.payload_json,
          freshness = excluded.freshness,
          generated_at = excluded.generated_at,
          revision = excluded.revision,
          source_queue_last_updated = excluded.source_queue_last_updated,
          source_queue_mtime_ms = excluded.source_queue_mtime_ms,
          source_workspace_goals_mtime_ms = excluded.source_workspace_goals_mtime_ms
      `).run(
        json(compactSummaryWithReleaseMembershipRevision(database, compactSummary)),
        generatedAt,
        revision,
        stringValue(source?.taskQueueLastUpdated) ?? stringValue(mutation.summary.sourceQueueLastUpdated) ?? lastUpdated,
        sourceQueueMtimeMs(tasksPath),
        sourceWorkspaceGoalsMtimeMs(tasksPath),
      )
      syncProjectPlanSnapshot(database, approvedPlan, generatedAt, revision)
      writeProjectOrientationProjection(database, orientation, generatedAt, revision, { preserveOmitted: true })
      markProjectionCurrent(database, 'summary', revision, generatedAt)
      committedRevision = revision
    })
  } finally {
    database.close()
  }
  return committedRevision
}

/** Commit a structural task delta without replacing unrelated current rows. */
export function writeProjectStateDatabaseTaskBatchMutation(
  tasksPath: string,
  mutation: ProjectStateDatabaseTaskBatchMutation,
): number {
  if (readProjectStateDatabaseAuthoritySnapshotFromTasksPath(tasksPath)?.authority !== 'database') {
    throw new Error('Targeted task batch mutations require database project-state authority')
  }
  if (!Number.isInteger(mutation.expectedQueueRevision) || mutation.expectedQueueRevision < 0) {
    throw new Error('Targeted task batch mutations require a non-negative integer queue revision')
  }
  if (!Number.isInteger(mutation.expectedProjectRevision) || mutation.expectedProjectRevision < 0) {
    throw new Error('Targeted task batch mutations require a non-negative integer project revision')
  }
  const changedTasks = mutation.tasks.map(task => ({ ...task }))
  const changedTaskIds = new Set<string>()
  for (const task of changedTasks) {
    const id = stringValue(task.id)
    if (!id) throw new Error('Targeted task batch mutations require task ids')
    if (changedTaskIds.has(id)) throw new Error(`Targeted task batch mutations received duplicate task ${id}`)
    changedTaskIds.add(id)
  }
  const removedTaskIds = [...new Set((mutation.removeTaskIds ?? []).filter(Boolean))]
  if (removedTaskIds.some(id => changedTaskIds.has(id))) {
    throw new Error('Targeted task batch mutations cannot update and remove the same task')
  }
  const hasEnvelopeMutation =
    mutation.releases !== undefined ||
    'selectedReleaseId' in mutation ||
    mutation.executionPlanActions !== undefined ||
    mutation.scopeAuthorityRequests !== undefined
  const hasCapabilityMutation = mutation.sourceCapabilities !== undefined
  if (changedTaskIds.size === 0 && removedTaskIds.length === 0 && !hasEnvelopeMutation && !hasCapabilityMutation && mutation.taskRuntimes === undefined) {
    throw new Error('Targeted task batch mutations require a task, runtime overlay, capability catalog, or queue-envelope change')
  }

  const database = openDatabase(projectStateDatabasePathFromTasksPath(tasksPath))
  let committedRevision = 0
  try {
    transaction(database, () => {
      const queueRow = database.prepare('SELECT revision, last_updated FROM queue_state WHERE id = 1').get() as JsonRecord | undefined
      const actualRevision = queueRow ? Number(queueRow.revision ?? 0) : null
      if (actualRevision !== mutation.expectedQueueRevision) {
        throw new Error(
          `Stale targeted task batch: expected revision ${mutation.expectedQueueRevision}, found ${actualRevision ?? 'none'}. Read the current project and retry.`,
        )
      }
      const actualProjectRevision = currentRevision(database)
      if (actualProjectRevision !== mutation.expectedProjectRevision) {
        throw new Error(
          `Stale targeted task batch: expected project revision ${mutation.expectedProjectRevision}, found ${actualProjectRevision}. Read the current project and retry.`,
        )
      }
      if (!tableExists(database, 'work_item_detail')) {
        throw new Error('Targeted task batch mutations require the per-task detail index')
      }
      const itemCount = Number((database.prepare('SELECT COUNT(*) AS count FROM work_items').get() as JsonRecord | undefined)?.count ?? 0)
      const detailCount = Number((database.prepare('SELECT COUNT(*) AS count FROM work_item_detail').get() as JsonRecord | undefined)?.count ?? 0)
      if (itemCount !== detailCount) {
        throw new Error(`Targeted task batch mutation refused: detail index is incomplete (${detailCount}/${itemCount})`)
      }
      if (mutation.sourceCapabilities !== undefined) {
        upsertSourceCapabilities(database, mutation.sourceCapabilities)
      }
      let normalizedReleaseDefinitions: JsonRecord[] | null = null
      if (mutation.releases !== undefined) {
        normalizedReleaseDefinitions = releaseDefinitionsWithTaskMembership(mutation.releases, changedTasks)
        const releasesById = new Map<string, JsonRecord>()
        for (const release of normalizedReleaseDefinitions) {
          const id = stringValue(release.id)
          if (!id) throw new Error('Targeted task batch mutations require release ids')
          if (releasesById.has(id)) throw new Error(`Targeted task batch mutations received duplicate release ${id}`)
          releasesById.set(id, { ...release })
        }
        const existingReleases = database.prepare('SELECT id, definition_json FROM scopes').all() as JsonRecord[]
        const existingReleaseIds = new Set(existingReleases.map(row => String(row.id)))
        const upsertRelease = database.prepare(`
          INSERT INTO scopes (
            id, label, kind, state, source, proof_style,
            node_ids_json, deferred_node_ids_json, definition_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            label = excluded.label,
            kind = excluded.kind,
            state = excluded.state,
            source = excluded.source,
            proof_style = excluded.proof_style,
            node_ids_json = excluded.node_ids_json,
            deferred_node_ids_json = excluded.deferred_node_ids_json,
            definition_json = excluded.definition_json
        `)
        for (const release of releasesById.values()) {
          const stored = releaseMembershipStorageFields(release)
          upsertRelease.run(
            String(release.id),
            String(release.label ?? release.id),
            stringValue(release.kind),
            stringValue(release.state),
            stringValue(release.source),
            stringValue(release.proofStyle),
            stored.nodeIdsJson,
            stored.deferredNodeIdsJson,
            stored.definitionJson,
          )
        }
        for (const id of existingReleaseIds) {
          if (!releasesById.has(id)) database.prepare('DELETE FROM scopes WHERE id = ?').run(id)
        }
      }
      const releaseMembershipAfterRemoval = (normalizedReleaseDefinitions ?? []).map(release => ({
        ...release,
        nodeIds: stringArray(release.nodeIds).filter(nodeId => !removedTaskIds.includes(nodeId.replace(/^work:/, ''))),
        deferredNodeIds: stringArray(release.deferredNodeIds).filter(nodeId => !removedTaskIds.includes(nodeId.replace(/^work:/, ''))),
      }))
      assertShippedReleaseWriteAllowed(database, releaseMembershipAfterRemoval, changedTasks, { nextTasksComplete: false })
      for (const taskId of removedTaskIds) {
        if (!database.prepare('SELECT 1 FROM work_items WHERE id = ?').get(taskId)) {
          throw new Error(`Cannot remove current work item ${taskId}: item not found`)
        }
      }

      const upsertTask = database.prepare(`
        INSERT INTO work_items (
          id, title, description, status, domain, priority, work_kind, parent_id,
          hierarchy_json, depends_on_json, release_ids_json, source_refs_json,
          summary_json, definition_json, updated_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          description = excluded.description,
          status = excluded.status,
          domain = excluded.domain,
          priority = excluded.priority,
          work_kind = excluded.work_kind,
          parent_id = excluded.parent_id,
          hierarchy_json = excluded.hierarchy_json,
          depends_on_json = excluded.depends_on_json,
          release_ids_json = excluded.release_ids_json,
          source_refs_json = excluded.source_refs_json,
          summary_json = excluded.summary_json,
          definition_json = excluded.definition_json,
          updated_at = excluded.updated_at,
          completed_at = excluded.completed_at
      `)
      for (const task of changedTasks) {
        const hierarchy = isRecord(task.hierarchy) ? task.hierarchy : null
        upsertTask.run(
          String(task.id),
          String(task.title ?? task.id),
          stringValue(task.description),
          stringValue(task.status),
          stringValue(task.domain),
          stringValue(task.priority),
          stringValue(task.workKind),
          stringValue(hierarchy?.parentId),
          json(hierarchy),
          json(stringArray(task.dependsOn)),
          EMPTY_RELEASE_MEMBERSHIP_JSON,
          json(stringArray(task.sourceRefs ?? task.references)),
          json(workItemSummary(task)),
          '{}',
          stringValue(task.updatedAt),
          stringValue(task.completedAt),
        )
      }
      syncTaskDependencies(database, changedTasks)
      normalizedReleaseDefinitions ??= releaseDefinitionsWithTaskMembership(
        releaseDefinitionsFromDatabase(database),
        changedTasks,
        { clearUnlistedTaskMembership: true },
      )
      upsertReleaseDefinitions(database, normalizedReleaseDefinitions)
      syncReleaseMembershipFromDefinitions(database, normalizedReleaseDefinitions)

      for (const taskId of removedTaskIds) {
        deleteTaskDependencies(database, [taskId])
        const deletedMembership = database.prepare('DELETE FROM release_membership WHERE task_id = ?').run(taskId)
        if (Number(deletedMembership.changes ?? 0) > 0) markReleaseMembershipStatePending(database)
        database.prepare('DELETE FROM work_scope WHERE task_id = ?').run(taskId)
        database.prepare('DELETE FROM work_item_detail WHERE task_id = ?').run(taskId)
        for (const table of ['task_execution', 'task_workspace', 'task_proof', 'task_evidence_current']) {
          if (tableExists(database, table)) database.prepare(`DELETE FROM ${table} WHERE task_id = ?`).run(taskId)
        }
        database.prepare('DELETE FROM work_items WHERE id = ?').run(taskId)
      }
      syncTaskCapabilityBindings(database, changedTasks)
      if (mutation.taskRuntimes !== undefined) {
        replaceTaskOverlayRowsInDatabase(database, 'task_execution', mutation.taskRuntimes)
      }

      const scopeRows = mutation.scopeRows ?? []
      const scopeRowsByTaskId = new Map<string, ProjectStateDatabaseScopeRow>()
      for (const row of scopeRows) {
        if (scopeRowsByTaskId.has(row.taskId)) throw new Error(`Targeted task batch mutations received duplicate scope row ${row.taskId}`)
        scopeRowsByTaskId.set(row.taskId, row)
        if (removedTaskIds.includes(row.taskId)) throw new Error(`Cannot scope removed work item ${row.taskId}`)
        if (!database.prepare('SELECT 1 FROM work_items WHERE id = ?').get(row.taskId)) {
          throw new Error(`Cannot scope unknown work item ${row.taskId}`)
        }
      }
      for (const taskId of mutation.removeScopeRowTaskIds ?? []) {
        if (removedTaskIds.includes(taskId)) continue
        database.prepare('DELETE FROM work_scope WHERE task_id = ?').run(taskId)
      }
      const upsertScopeRow = database.prepare(`
        INSERT INTO work_scope (
          task_id, scope, eligibility_reason, hierarchy_role, handoff_state,
          blocks_start, blocks_release, human_blocking, count_in_project_totals, proof_blocked,
          blocker_summary, source_refs_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(task_id) DO UPDATE SET
          scope = excluded.scope,
          eligibility_reason = excluded.eligibility_reason,
          hierarchy_role = excluded.hierarchy_role,
          handoff_state = excluded.handoff_state,
          blocks_start = excluded.blocks_start,
          blocks_release = excluded.blocks_release,
          human_blocking = excluded.human_blocking,
          count_in_project_totals = excluded.count_in_project_totals,
          proof_blocked = excluded.proof_blocked,
          blocker_summary = excluded.blocker_summary,
          source_refs_json = excluded.source_refs_json
      `)
      for (const row of scopeRowsByTaskId.values()) {
        upsertScopeRow.run(
          row.taskId,
          row.scope,
          row.eligibilityReason,
          row.hierarchyRole,
          row.handoffState,
          row.blocksStart ? 1 : 0,
          row.blocksRelease ? 1 : 0,
          row.humanBlocking ? 1 : 0,
          row.countInProjectTotals === false ? 0 : 1,
          row.proofBlocked ? 1 : 0,
          row.blockerSummary ?? null,
          json(row.sourceRefs),
        )
      }

      const generatedAt = stringValue(mutation.summary.generatedAt) ?? new Date().toISOString()
      const lastUpdated = mutation.lastUpdated ?? stringValue(queueRow?.last_updated)
      const { compact: compactSummary, orientation, approvedPlan } = summaryStoragePartsForDatabase(database, mutation.summary)
      const source = isRecord(mutation.summary.source) ? mutation.summary.source : null
      const revision = commitAuthoritativeMutation(database, {
        updatedAt: generatedAt,
        domains: ['queue'],
        projectionDomains: mutation.projectionDomains,
        summaryFreshness: 'preserve',
      })
      finalizeReleaseMembershipState(database, revision, generatedAt)
      const upsertDetail = database.prepare(`
        INSERT INTO work_item_detail (task_id, revision, payload_gzip)
        VALUES (?, ?, ?)
        ON CONFLICT(task_id) DO UPDATE SET
          revision = excluded.revision,
          payload_gzip = excluded.payload_gzip
      `)
      for (const task of changedTasks) {
        upsertDetail.run(String(task.id), revision, serializeWorkItemDetail(task))
      }
      const queueUpdates = ['last_updated = ?', 'revision = ?']
      const queueUpdateValues: (string | number | null)[] = [lastUpdated, revision]
      if ('selectedReleaseId' in mutation) {
        queueUpdates.push('selected_release_id = ?')
        queueUpdateValues.push(mutation.selectedReleaseId ?? null)
      }
      if (mutation.executionPlanActions !== undefined) {
        queueUpdates.push('execution_plan_actions_json = ?')
        queueUpdateValues.push(json(mutation.executionPlanActions))
      }
      if (mutation.scopeAuthorityRequests !== undefined) {
        queueUpdates.push('scope_authority_requests_json = ?')
        queueUpdateValues.push(json(mutation.scopeAuthorityRequests))
      }
      database.prepare(`UPDATE queue_state SET ${queueUpdates.join(', ')} WHERE id = 1`).run(...queueUpdateValues)
      database.prepare(`
        INSERT INTO project_summary (
          id, payload_json, freshness, generated_at,
          revision, source_queue_last_updated, source_queue_mtime_ms,
          source_workspace_goals_mtime_ms
        ) VALUES (1, ?, 'current', ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          payload_json = excluded.payload_json,
          freshness = excluded.freshness,
          generated_at = excluded.generated_at,
          revision = excluded.revision,
          source_queue_last_updated = excluded.source_queue_last_updated,
          source_queue_mtime_ms = excluded.source_queue_mtime_ms,
          source_workspace_goals_mtime_ms = excluded.source_workspace_goals_mtime_ms
      `).run(
        json(compactSummaryWithReleaseMembershipRevision(database, compactSummary)),
        generatedAt,
        revision,
        stringValue(source?.taskQueueLastUpdated) ?? stringValue(mutation.summary.sourceQueueLastUpdated) ?? lastUpdated,
        sourceQueueMtimeMs(tasksPath),
        sourceWorkspaceGoalsMtimeMs(tasksPath),
      )
      syncProjectPlanSnapshot(database, approvedPlan, generatedAt, revision)
      writeProjectOrientationProjection(database, orientation, generatedAt, revision, { preserveOmitted: true })
      for (const entry of mutation.evidence ?? []) {
        const durable = compactTaskEvidenceEvent(TaskEvidenceEvent.parse({ ...entry.event }))
        const retention = validateTaskEvidenceRetention(entry.retention)
        upsertTaskProofAndCurrentEvidence(database, {
          id: durable.id,
          taskId: durable.taskId,
          kind: durable.kind,
          recordedAt: durable.recordedAt,
          payload: durable.payload,
        })
        appendTaskEvidenceHistory(database, durable, retention)
      }
      markProjectionCurrent(database, 'summary', revision, generatedAt)
      committedRevision = revision
    })
  } finally {
    database.close()
  }
  return committedRevision
}

/**
 * Commit a derived project projection against the queue revision it read.
 * This is intentionally separate from writeProjectStateDatabaseSnapshot:
 * rebuilding a projection must never rewrite task definitions or advance the
 * queue watermark, especially while a compaction or worker mutation is in
 * flight.
 */
export function writeProjectStateDatabaseSummarySnapshot(
  tasksPath: string,
  snapshot: ProjectStateDatabaseSummarySnapshot,
): void {
  const databasePath = projectStateDatabasePathFromTasksPath(tasksPath)
  try {
    statSync(databasePath)
  } catch {
    return
  }
  const database = openDatabase(databasePath)
  try {
    transaction(database, () => {
      const queueRow = database.prepare('SELECT revision FROM queue_state WHERE id = 1').get() as JsonRecord | undefined
      const actualRevision = queueRow ? Number(queueRow.revision ?? 0) : null
      if (snapshot.expectedQueueRevision !== undefined && actualRevision !== snapshot.expectedQueueRevision) {
        throw new Error(
          `Stale project summary refresh: expected queue revision ${snapshot.expectedQueueRevision ?? 'none'}, found ${actualRevision ?? 'none'}.`,
        )
      }
      const actualProjectRevision = currentRevision(database)
      if (snapshot.expectedProjectRevision !== undefined && actualProjectRevision !== snapshot.expectedProjectRevision) {
        throw new Error(
          `Stale project summary refresh: expected project revision ${snapshot.expectedProjectRevision ?? 'none'}, found ${actualProjectRevision}.`,
        )
      }

      const summary = isRecord(snapshot.summary) ? snapshot.summary : {}
      const { compact: compactSummary, orientation, approvedPlan } = summaryStoragePartsForDatabase(database, summary)
      const source = isRecord(summary.source) ? summary.source : null
      const lastUpdated = stringValue(source?.taskQueueLastUpdated) ?? stringValue(summary.sourceQueueLastUpdated)
      const generatedAt = stringValue(summary.generatedAt) ?? new Date().toISOString()
      const revision = actualProjectRevision
      const mtimeMs = sourceQueueMtimeMs(tasksPath)
      const goalsMtimeMs = sourceWorkspaceGoalsMtimeMs(tasksPath)
      const currentProjection = snapshot.currentProjection ?? (
        snapshot.scopeRows || snapshot.taskStatusRows
          ? {
              scopeRows: snapshot.scopeRows ?? [],
              taskStatusRows: snapshot.taskStatusRows ?? [],
            }
          : null
      )
      if (currentProjection) validateCurrentProjectionRows(database, currentProjection)
      database.prepare(`
        INSERT INTO project_summary (
          id, payload_json, freshness, generated_at,
          revision, source_queue_last_updated, source_queue_mtime_ms,
          source_workspace_goals_mtime_ms
        ) VALUES (1, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          payload_json = excluded.payload_json,
          freshness = excluded.freshness,
          generated_at = excluded.generated_at,
          revision = excluded.revision,
          source_queue_last_updated = excluded.source_queue_last_updated,
          source_queue_mtime_ms = excluded.source_queue_mtime_ms,
          source_workspace_goals_mtime_ms = excluded.source_workspace_goals_mtime_ms
      `).run(
        json(compactSummaryWithReleaseMembershipRevision(database, compactSummary)),
        stringValue(summary.freshness) ?? 'current',
        generatedAt,
        revision,
        lastUpdated,
        mtimeMs,
        goalsMtimeMs,
      )

      syncProjectPlanSnapshot(database, approvedPlan, generatedAt, revision)

      if (currentProjection) {
        syncProjectStateDatabaseScopeRows(database, currentProjection.scopeRows)
      }

      if (currentProjection) {
        const updateStatus = database.prepare(`
          UPDATE work_items
          SET status = ?, completed_at = ?
          WHERE id = ?
        `)
        for (const row of currentProjection.taskStatusRows) {
          if (!row.taskId.trim()) continue
          updateStatus.run(row.status, row.completedAt ?? null, row.taskId)
        }
      }

      writeProjectOrientationProjection(database, orientation, generatedAt, revision, { preserveOmitted: true })
      markProjectionCurrent(database, 'summary', revision, generatedAt)
    })
  } finally {
    database.close()
  }
}

function validateCurrentProjectionRows(
  database: DatabaseSync,
  projection: ProjectStateDatabaseCurrentProjection,
): void {
  const taskIds = new Set<string>()
  const scopeIds = new Set<string>()
  const taskExists = database.prepare('SELECT 1 FROM work_items WHERE id = ?')
  for (const row of projection.taskStatusRows) {
    const taskId = row.taskId.trim()
    if (!taskId) throw new Error('Current projection contains an empty task status id.')
    if (taskIds.has(taskId)) throw new Error(`Current projection contains duplicate task status id ${taskId}.`)
    taskIds.add(taskId)
    if (!taskExists.get(taskId)) throw new Error(`Current projection references unknown task ${taskId}.`)
  }
  for (const row of projection.scopeRows) {
    const taskId = row.taskId.trim()
    if (!taskId) throw new Error('Current projection contains an empty scope row id.')
    if (scopeIds.has(taskId)) throw new Error(`Current projection contains duplicate scope row id ${taskId}.`)
    scopeIds.add(taskId)
    if (!taskExists.get(taskId)) throw new Error(`Current projection references unknown scope task ${taskId}.`)
  }
}

function validateScopeRowsAgainstTaskIds(
  rows: readonly ProjectStateDatabaseScopeRow[],
  taskIds: readonly string[],
): void {
  const knownTaskIds = new Set(taskIds.map(taskId => taskId.trim()).filter(Boolean))
  const seen = new Set<string>()
  for (const row of rows) {
    const taskId = row.taskId.trim()
    if (!taskId) throw new Error('Project scope contains an empty task id.')
    if (seen.has(taskId)) throw new Error(`Project scope contains duplicate task id ${taskId}.`)
    seen.add(taskId)
    if (!knownTaskIds.has(taskId)) {
      throw new Error(`Project scope references unknown task ${taskId}.`)
    }
  }
}

export interface ProjectStateDatabaseQueueDetailMigrationResult {
  migrated: boolean
  revision: number | null
  bytes: number
}

/** Remove the retired aggregate detail payload after indexed task detail is complete. */
export function clearProjectStateDatabaseQueueDetail(projectRoot: string): boolean {
  let cleared = false
  withWritableDatabase(projectRoot, database => {
    if (!tableExists(database, 'queue_detail')) return
    const existing = database.prepare('SELECT 1 FROM queue_detail WHERE id = 1').get()
    if (!existing) return
    if (!readQueueDefinitionFromWorkItemDetails(database, currentQueueRevision(database))) {
      throw new Error('Cannot remove aggregate queue detail before the per-task detail index is complete')
    }
    database.prepare('DELETE FROM queue_detail').run()
    cleared = true
  })
  if (cleared) vacuumProjectStateDatabase(projectRoot)
  return cleared
}

/**
 * Move an existing revision-matched sidecar into the transactional database
 * detail row. This is representation-only migration: it does not bump the
 * logical queue revision or rewrite task/history records.
 */
export function migrateProjectStateDatabaseQueueDetail(
  projectRoot: string,
): ProjectStateDatabaseQueueDetailMigrationResult {
  const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
  const result: ProjectStateDatabaseQueueDetailMigrationResult = {
    migrated: false,
    revision: null,
    bytes: 0,
  }
  withWritableDatabase(projectRoot, database => {
    if (!tableExists(database, 'queue_detail')) return
    if (database.prepare('SELECT 1 FROM queue_detail WHERE id = 1').get()) {
      result.revision = currentQueueRevision(database)
      return
    }
    const revision = currentQueueRevision(database)
    const details = readQueueDetailsForRevision(tasksPath, revision, database, { migration: true })
    if (!details) return
    const payload = serializeProjectStateDetailStore(details, revision)
    database.prepare('INSERT INTO queue_detail (id, revision, payload_gzip) VALUES (1, ?, ?)').run(revision, payload)
    result.migrated = true
    result.revision = revision
    result.bytes = payload.byteLength
  })
  return result
}

/** Read the current queue watermark without allocating or repairing storage. */
export function readProjectStateDatabaseQueueRevision(tasksPath: string): number | null {
  const databasePath = projectStateDatabasePathFromTasksPath(tasksPath)
  try {
    statSync(databasePath)
  } catch {
    return null
  }
  const database = openDatabase(databasePath, { readOnly: true })
  let inReadTransaction = false
  try {
    database.exec('BEGIN')
    inReadTransaction = true
    if (!tableExists(database, 'queue_state')) return null
    const row = database.prepare('SELECT revision FROM queue_state WHERE id = 1').get() as JsonRecord | undefined
    return row ? Number(row.revision ?? 0) : null
  } finally {
    if (inReadTransaction) {
      try {
        database.exec('COMMIT')
      } catch {
        try { database.exec('ROLLBACK') } catch { /* preserve the original read result/error */ }
      }
    }
    database.close()
  }
}

export interface ProjectStateDetailCompressionResult {
  sourcePath: string
  compressedPath: string
  bytesBefore: number
  bytesAfter: number
  removedSource: boolean
}

/** Convert the legacy plain-text detail sidecar without changing its JSON. */
export function compressProjectStateDetailStore(tasksPath: string): ProjectStateDetailCompressionResult | null {
  const sourcePath = projectStateDatabaseDetailPathFromTasksPath(tasksPath)
  const compressedPath = projectStateDatabaseCompressedDetailPathFromTasksPath(tasksPath)
  if (!existsSync(sourcePath)) return null
  const source = readFileSync(sourcePath)
  let parsed: Partial<ProjectStateDatabaseDetailStore>
  try {
    parsed = JSON.parse(source.toString('utf8')) as Partial<ProjectStateDatabaseDetailStore>
  } catch (error) {
    throw new Error(`Cannot compress invalid project detail store ${sourcePath}: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (parsed.detailStoreVersion !== 1 || !Array.isArray(parsed.tasks) || !Array.isArray(parsed.releases)) {
    throw new Error(`Cannot compress unrecognized project detail store ${sourcePath}.`)
  }
  const compressed = gzipSync(source, { level: 9 })
  atomicWriteBytes(compressedPath, compressed)
  // The compressed copy is written and fsynced before the compatibility copy
  // is removed, so an interrupted migration still leaves a readable source.
  unlinkSync(sourcePath)
  return {
    sourcePath,
    compressedPath,
    bytesBefore: source.byteLength,
    bytesAfter: compressed.byteLength,
    removedSource: true,
  }
}

export function readProjectStateDatabaseSummary<T = unknown>(
  tasksPath: string,
  options: ProjectStateDatabaseSummaryReadOptions = {},
): ProjectStateDatabaseSummary<T> | null {
  const databasePath = projectStateDatabasePathFromTasksPath(tasksPath)
  try {
    statSync(databasePath)
  } catch {
    return null
  }
  const database = openDatabase(databasePath, { readOnly: true })
  try {
    return readProjectStateDatabaseSummaryFromDatabase(database, tasksPath, options)
  } finally {
    database.close()
  }
}

/** Read the saved project shell without opening the task inventory. */
export function readProjectStateDatabaseShellState<T = unknown>(
  tasksPath: string,
  options: ProjectStateDatabaseSummaryReadOptions = {},
): ProjectStateDatabaseShellState<T> | null {
  const bundle = readProjectStateDatabaseReadBundle<T>(tasksPath, options)
  if (!bundle) return null
  return {
    authority: bundle.authority,
    summary: bundle.summary,
    queueRevision: bundle.queueRevision,
    projectRevision: bundle.projectRevision,
  }
}

function readProjectStateDatabaseSummaryFromDatabase<T = unknown>(
  database: DatabaseSync,
  tasksPath: string,
  options: ProjectStateDatabaseSummaryReadOptions = {},
): ProjectStateDatabaseSummary<T> | null {
  const row = database.prepare('SELECT payload_json, freshness, generated_at, revision, source_queue_last_updated, source_queue_mtime_ms, source_workspace_goals_mtime_ms FROM project_summary WHERE id = 1').get() as JsonRecord | undefined
  if (!row) return null
  // Resolve authority on this same SQLite connection before touching any
  // legacy source. A promoted read must not stat TASKS.json or
  // workspace-goals.json: those files are provenance/compatibility inputs, not
  // current-state dependencies.
  const authority = readProjectStateDatabaseEffectiveAuthorityFromDatabase(database)
  const storedMtime = typeof row.source_queue_mtime_ms === 'number' ? row.source_queue_mtime_ms : null
  const currentMtime = authority === 'database' ? null : sourceQueueMtimeMs(tasksPath)
  const storedGoalsMtime = typeof row.source_workspace_goals_mtime_ms === 'number' ? row.source_workspace_goals_mtime_ms : null
  const currentGoalsMtime = authority === 'database' ? null : sourceWorkspaceGoalsMtimeMs(tasksPath)
  // A materialized queue is the current-state authority even if a promotion
  // marker is still being finalized. Summary freshness must use the same
  // source-selection rule as queue, task, and evidence reads.
  const sourceChanged = authority === 'database'
    ? false
    : storedMtime !== currentMtime || storedGoalsMtime !== currentGoalsMtime
  const summaryRevision = Number(row.revision ?? 0)
  const databaseRevision = currentRevision(database)
  const storedSummary = hydrateSummaryFromAuxiliaryRows(
    database,
    parseJson<JsonRecord>(row.payload_json, {}),
  )
  const membershipState = readReleaseMembershipStateFromDatabase(database)
  const summaryMembershipRevision = Number(storedSummary.releaseMembershipRevision)
  const membershipMatches = membershipState !== null &&
    Number.isInteger(summaryMembershipRevision) &&
    summaryMembershipRevision === membershipState.membershipRevision
  if (options.includeApprovedPlan !== false && storedSummary.approvedPlan === undefined && tableExists(database, 'project_plan')) {
    storedSummary.approvedPlan = readProjectPlanSnapshot(database)
  }
  if (options.includeOrientation === false) {
    delete storedSummary.orientationSpine
  } else if (storedSummary.orientationSpine === undefined && tableExists(database, 'project_orientation')) {
    const orientationRow = database.prepare('SELECT payload_json FROM project_orientation WHERE id = 1').get() as JsonRecord | undefined
    if (orientationRow?.payload_json !== undefined) {
      storedSummary.orientationSpine = parseJson<unknown>(orientationRow.payload_json, null)
    }
  }
  return {
    payload: storedSummary as T,
    freshness: row.freshness === 'current' && !sourceChanged && summaryRevision === databaseRevision && membershipMatches
      ? 'current'
      : 'stale',
    generatedAt: String(row.generated_at ?? ''),
    sourceQueueLastUpdated: typeof row.source_queue_last_updated === 'string' && row.source_queue_last_updated.length > 0
      ? row.source_queue_last_updated
      : null,
  }
}

/**
 * Read the current queue, scope rows, and summary from one SQLite snapshot.
 * This is the only aggregate read boundary for promoted project state.
 */
export function readProjectStateDatabaseCurrentState<T = unknown>(
  tasksPath: string,
  options: ProjectStateDatabaseSummaryReadOptions = {},
): ProjectStateDatabaseCurrentState<T> | null {
  const bundle = readProjectStateDatabaseReadBundle<T>(tasksPath, {
    ...options,
    includeQueueDefinition: true,
    includeRepositories: true,
    includeDiagnostics: true,
    includeMemoryHealth: true,
    includeTaskOverlays: true,
  })
  if (!bundle?.queueDefinition) return null
  return {
    queue: bundle.queueDefinition,
    queueRevision: bundle.queueRevision ?? 0,
    projectRevision: bundle.projectRevision ?? 0,
    scopeRows: bundle.scopeRows,
    repositories: bundle.repositories,
    diagnostics: bundle.diagnostics,
    memoryHealth: bundle.memoryHealth,
    summary: bundle.summary,
    taskOverlays: bundle.taskOverlays,
  }
}

function readProjectStateDatabaseProjectionStateFromDatabase<T = unknown>(
  database: DatabaseSync,
  tasksPath: string,
  options: ProjectStateDatabaseProjectionReadOptions & ProjectStateDatabaseSummaryReadOptions = {},
): ProjectStateDatabaseProjectionState<T> | null {
  if (!tableExists(database, 'queue_state')) return null
  const queue = readProjectStateDatabaseQueueEnvelopeFromDatabase(database)
  if (!queue) return null
  const queueRevision = currentQueueRevision(database)
  const summary = readProjectStateDatabaseSummaryFromDatabase<T>(database, tasksPath, options)
  return {
    queue,
    queueRevision,
    projectRevision: currentRevision(database),
    scopeRows: readScopeRowsFromDatabase(database),
    inventory: readInventoryFromDatabase(database, options),
    selectedTask: options.selectedTaskId
      ? readTaskFromDatabase(database, options.selectedTaskId, options.includeDefinitions === true)
      : null,
    repositories: readProjectStateDatabaseRepositoriesFromDatabase(database),
    diagnostics: readProjectStateDatabaseDiagnosticProjectionFromDatabase(database),
    summary,
  }
}

function readOnlyProjectStateDatabase<T>(
  tasksPath: string,
  read: (database: DatabaseSync) => T,
): T | null {
  const databasePath = projectStateDatabasePathFromTasksPath(tasksPath)
  try {
    statSync(databasePath)
  } catch {
    return null
  }
  const database = openDatabase(databasePath, { readOnly: true })
  let inReadTransaction = false
  try {
    database.exec('BEGIN')
    inReadTransaction = true
    return read(database)
  } finally {
    if (inReadTransaction) {
      try {
        database.exec('COMMIT')
      } catch {
        try {
          database.exec('ROLLBACK')
        } catch {
          // Preserve the original read result/error.
        }
      }
    }
    database.close()
  }
}

/**
 * Read every current-state fact a route may use from one SQLite snapshot.
 * This is the only aggregate data-layer primitive; the public readers below
 * are projections of this result for compatibility and payload sizing.
 */
export function readProjectStateDatabaseReadBundle<T = unknown>(
  tasksPath: string,
  options: ProjectStateDatabaseReadBundleOptions = {},
): ProjectStateDatabaseReadBundle<T> | null {
  return readOnlyProjectStateDatabase(tasksPath, database => {
    const hasQueue = Boolean(
      tableExists(database, 'queue_state') &&
      database.prepare('SELECT 1 FROM queue_state WHERE id = 1').get(),
    )
    const authority = hasQueue
      ? 'database'
      : readProjectStateDatabaseAuthorityFromDatabase(database)
    const queueRevision = hasQueue ? currentQueueRevision(database) : null
    const projectRevision = tableExists(database, 'project_meta') ? currentRevision(database) : null
    const includeStructuredState = options.includeQueueDefinition === true ||
      options.includeProjection === true ||
      options.includeTaskOverlays === true ||
      options.includeRepositories === true ||
      options.includeDiagnostics === true ||
      options.includeScopeRows === true
    const queue = includeStructuredState && hasQueue
      ? readProjectStateDatabaseQueueEnvelopeFromDatabase(database)
      : null
    const queueDefinition = options.includeQueueDefinition === true && hasQueue && queueRevision !== null
      ? readQueueDetailsForRevision(tasksPath, queueRevision, database)
      : null
    const projection = options.includeProjection === true && hasQueue
      ? readProjectStateDatabaseProjectionStateFromDatabase<T>(database, tasksPath, options)
      : null
    const taskDetail = options.includeTaskDetail === true && hasQueue && options.taskDetailId
      ? readProjectStateDatabaseTaskDetailStateFromDatabase<T>(database, tasksPath, options.taskDetailId, options)
      : null
    const summary = readProjectStateDatabaseSummaryFromDatabase<T>(database, tasksPath, options)
    const requestedEvidenceIds = options.currentEvidenceTaskIds ?? summaryEvidenceTaskIds(summary?.payload)
    const currentEvidence = options.includeCurrentEvidence === true && hasQueue
      ? tableExists(database, 'task_evidence_current')
        ? currentEvidenceForTaskIds(database, requestedEvidenceIds)
        : authority === 'database'
          ? (() => { throw new Error('Normalized current task evidence is unavailable for promoted project') })()
          : new Map()
      : null
    return {
      authority,
      queueRevision,
      projectRevision,
      queue,
      queueDefinition,
      projection,
      taskDetail,
      scopeRows: includeStructuredState && hasQueue ? readScopeRowsFromDatabase(database) : [],
      repositories: options.includeRepositories === true && hasQueue
        ? readProjectStateDatabaseRepositoriesFromDatabase(database)
        : [],
      diagnostics: options.includeDiagnostics === true && hasQueue
        ? readProjectStateDatabaseDiagnosticProjectionFromDatabase(database)
        : null,
      memoryHealth: options.includeMemoryHealth === true && hasQueue
        ? readProjectStateDatabaseMemoryHealthFromDatabase(database)
        : null,
      summary,
      currentEvidence,
      taskOverlays: options.includeTaskOverlays === true && hasQueue
        ? readProjectStateDatabaseTaskOverlayStoresFromDatabase(database)
        : null,
      thread: options.includeThread === true && hasQueue
        ? readThreadSurfaceStateFromDatabase(database)
        : null,
      attentionRecords: options.includeAttention === true && hasQueue
        ? readProjectStateDatabaseAttentionRecordsFromDatabase(database)
        : null,
      attentionWatermark: options.includeAttention === true && hasQueue
        ? readProjectStateDatabaseProjectionWatermarkFromDatabase(database, 'attention')
        : null,
      availability: options.includeAvailability === true && hasQueue
        ? readProjectStateDatabaseAvailabilityFromDatabase(database)
        : null,
    }
  })
}

/**
 * Read the compact queue envelope, saved summary, and one bounded inventory
 * page from the same SQLite transaction. Compact surfaces must use this
 * instead of combining independent queue, summary, and inventory reads.
 */
export function readProjectStateDatabaseProjectionState<T = unknown>(
  tasksPath: string,
  options: ProjectStateDatabaseProjectionReadOptions & ProjectStateDatabaseSummaryReadOptions = {},
): ProjectStateDatabaseProjectionState<T> | null {
  return readProjectStateDatabaseReadBundle<T>(tasksPath, {
    ...options,
    includeProjection: true,
    includeRepositories: true,
    includeDiagnostics: true,
  })?.projection ?? null
}

/**
 * Read the saved project surface through one sessions-owned transaction.
 * Ordinary routes may choose a bounded view, but they cannot choose a second
 * authority for Thread, Inbox, availability, summary, or work membership.
 */
export function readProjectStateDatabaseSurfaceState<T = unknown>(
  tasksPath: string,
  options: ProjectStateDatabaseSurfaceReadOptions = {},
): ProjectStateDatabaseSurfaceState<T> | null {
  const bundle = readProjectStateDatabaseReadBundle<T>(tasksPath, {
    ...options,
    includeProjection: options.includeProjection !== false,
    includeRepositories: options.includeProjection !== false,
    includeDiagnostics: options.includeProjection !== false,
  })
  if (!bundle) return null
  return {
    authority: bundle.authority,
    projection: bundle.projection,
    summary: bundle.summary,
    taskDetail: bundle.taskDetail,
    queueRevision: bundle.queueRevision,
    projectRevision: bundle.projectRevision,
    thread: bundle.thread,
    attentionRecords: bundle.attentionRecords,
    attentionWatermark: bundle.attentionWatermark,
    memoryHealth: bundle.memoryHealth,
    availability: bundle.availability,
  }
}

/**
 * Read one task, its relationships, compact queue envelope, scope rows, and
 * saved summary from one bounded SQLite snapshot. The task definition is
 * loaded only for this explicit detail request; the queue remains compact.
 */
function readProjectStateDatabaseTaskDetailStateFromDatabase<T = unknown>(
  database: DatabaseSync,
  tasksPath: string,
  taskId: string,
  options: ProjectStateDatabaseTaskDetailReadOptions = {},
): ProjectStateDatabaseTaskDetailState<T> | null {
  if (!tableExists(database, 'queue_state')) return null
  const includeScope = hasWorkScopeTable(database)
  const row = database.prepare(`${workItemsWithScopeSelect('work_items.*', includeScope)} WHERE work_items.id = ?`)
    .get(taskId) as JsonRecord | undefined
  if (!row) return null
  applyReleaseMembershipToTaskRows(database, [row])
  applyTaskDependenciesToTaskRows(database, [row])
  const task = attachWorkItemDetails([taskFromRow(row, false)], database)[0]
  if (!task) return null
  const childRows = database.prepare('SELECT id FROM work_items WHERE parent_id = ? ORDER BY rowid').all(taskId) as JsonRecord[]
  const relationships: ProjectStateDatabaseTaskRelationships = {
    taskId,
    parentId: typeof row.parent_id === 'string' ? row.parent_id : null,
    childIds: childRows.flatMap(child => typeof child.id === 'string' ? [child.id] : []),
    // The normalized relation table has already been applied to `task`.
    // Reusing that result prevents the legacy JSON mirror from becoming a
    // second dependency authority inside this otherwise atomic read.
    dependsOnIds: [...task.dependsOn],
    dependentIds: readDependentTaskIds(database, taskId),
    scopeRow: scopeRowFromRow(row),
  }
  const relatedTaskIds = new Set<string>([
    ...(relationships.parentId ? [relationships.parentId] : []),
    ...relationships.childIds,
    ...relationships.dependsOnIds,
    ...relationships.dependentIds,
  ])
  if (options.includeRelatedTasks === true) {
    const sizePlan = isRecord(task.definition.sizePlan) ? task.definition.sizePlan : null
    const recommendations = Array.isArray(sizePlan?.recommendedChildren) ? sizePlan.recommendedChildren : []
    for (const recommendation of recommendations) {
      if (isRecord(recommendation) && typeof recommendation.createdTaskId === 'string') {
        relatedTaskIds.add(recommendation.createdTaskId)
      }
    }
  }
  relatedTaskIds.delete(taskId)
  const relatedRows = options.includeRelatedTasks === true && relatedTaskIds.size > 0
    ? database.prepare(`${workItemsWithScopeSelect('work_items.*', includeScope)} WHERE work_items.id IN (${[...relatedTaskIds].map(() => '?').join(', ')}) ORDER BY work_items.rowid`)
      .all(...relatedTaskIds) as JsonRecord[]
    : []
  applyReleaseMembershipToTaskRows(database, relatedRows)
  applyTaskDependenciesToTaskRows(database, relatedRows)
  const relatedTasks = attachWorkItemDetails(
    relatedRows.map(relatedRow => taskFromRow(relatedRow, false)),
    database,
  )
  const queueRevision = currentQueueRevision(database)
  return {
    queue: readTaskDetailQueueEnvelopeFromDatabase(database, options.includeAggregateTasks === true),
    task,
    overlay: readProjectStateDatabaseTaskOverlayFromDatabase(database, taskId),
    relationships,
    relatedTasks,
    scopeRows: readScopeRowsFromDatabase(database),
    availability: readProjectStateDatabaseAvailabilityFromDatabase(database),
    queueRevision,
    projectRevision: currentRevision(database),
    summary: readProjectStateDatabaseSummaryFromDatabase<T>(database, tasksPath, options),
  }
}

/** Read task detail and source authority from one SQLite snapshot. */
export function readProjectStateDatabaseTaskDetailStateAtBoundary<T = unknown>(
  tasksPath: string,
  taskId: string,
  options: ProjectStateDatabaseTaskDetailReadOptions = {},
): ProjectStateDatabaseTaskDetailBoundaryState<T> | null {
  const bundle = readProjectStateDatabaseReadBundle<T>(tasksPath, {
    ...options,
    includeTaskDetail: true,
    taskDetailId: taskId,
    includeAvailability: true,
  })
  if (!bundle) return null
  return {
    authority: bundle.authority,
    state: bundle.taskDetail,
  }
}

export function readProjectStateDatabaseTaskDetailState<T = unknown>(
  tasksPath: string,
  taskId: string,
  options: ProjectStateDatabaseTaskDetailReadOptions = {},
): ProjectStateDatabaseTaskDetailState<T> | null {
  return readProjectStateDatabaseTaskDetailStateAtBoundary<T>(tasksPath, taskId, options)?.state ?? null
}

/**
 * Read only the persisted current Thread projection. This is deliberately a
 * read-only probe: missing or stale state is reported as null/stale instead
 * of reconstructing Thread or creating a database as a side effect.
 */
export function readProjectStateDatabaseCurrentThread<T = unknown>(
  projectRoot: string,
): ProjectStateDatabaseCurrentThread<T> | null {
  const databasePath = projectStateDatabasePath(projectRoot)
  try {
    statSync(databasePath)
  } catch {
    return null
  }
  const database = openDatabase(databasePath, { readOnly: true })
  try {
    if (!tableExists(database, 'current_thread')) return null
    const row = database.prepare(`
      SELECT payload_json, generated_at, source_revision, source_queue_revision
      FROM current_thread
      WHERE id = 1
    `).get() as JsonRecord | undefined
    if (!row || typeof row.generated_at !== 'string' || typeof row.source_revision !== 'string') return null
    return {
      payload: parseJson<T>(row.payload_json, null as T),
      generatedAt: row.generated_at,
      sourceRevision: row.source_revision,
      sourceQueueRevision: Number.isFinite(Number(row.source_queue_revision))
        ? Number(row.source_queue_revision)
        : null,
    }
  } finally {
    database.close()
  }
}

function readThreadSurfaceStateFromDatabase<T = unknown>(
  database: DatabaseSync,
): ProjectStateDatabaseThreadSurfaceState<T> {
  const queueRevision = tableExists(database, 'queue_state') ? currentQueueRevision(database) : null
  const projectRevision = tableExists(database, 'project_meta') ? currentRevision(database) : null
  let thread: ProjectStateDatabaseCurrentThread<T> | null = null
  if (tableExists(database, 'current_thread')) {
    const row = database.prepare(`
      SELECT payload_json, generated_at, source_revision, source_queue_revision
      FROM current_thread
      WHERE id = 1
    `).get() as JsonRecord | undefined
    if (row && typeof row.generated_at === 'string' && typeof row.source_revision === 'string') {
      thread = {
        payload: parseJson<T>(row.payload_json, null as T),
        generatedAt: row.generated_at,
        sourceRevision: row.source_revision,
        sourceQueueRevision: Number.isFinite(Number(row.source_queue_revision))
          ? Number(row.source_queue_revision)
          : null,
      }
    }
  }
  return { thread, queueRevision, projectRevision }
}

/**
 * Read Thread's current projection and both project watermarks together.
 * Thread navigation must not compare a saved row from one revision with a
 * separately opened queue connection from another revision.
 */
export function readProjectStateDatabaseThreadSurfaceState<T = unknown>(
  projectRoot: string,
): ProjectStateDatabaseThreadSurfaceState<T> | null {
  const databasePath = projectStateDatabasePath(projectRoot)
  try {
    statSync(databasePath)
  } catch {
    return null
  }
  const database = openDatabase(databasePath, { readOnly: true })
  let inReadTransaction = false
  try {
    database.exec('BEGIN')
    inReadTransaction = true
    return readThreadSurfaceStateFromDatabase<T>(database)
  } finally {
    if (inReadTransaction) {
      try {
        database.exec('COMMIT')
      } catch {
        try {
          database.exec('ROLLBACK')
        } catch {
          // Preserve the original read result/error.
        }
      }
    }
    database.close()
  }
}

/** Persist the bounded current Thread projection at an explicit write boundary. */
export function writeProjectStateDatabaseCurrentThread<T>(
  projectRoot: string,
  input: ProjectStateDatabaseCurrentThread<T>,
): void {
  withWritableDatabase(projectRoot, database => {
    const sourceRevision = Number(input.sourceRevision)
    if (!Number.isInteger(sourceRevision) || sourceRevision < 0) {
      throw new Error('Current Thread writes require a numeric source project revision')
    }
    const actualProjectRevision = currentRevision(database)
    if (sourceRevision !== actualProjectRevision) {
      throw new Error(
        `Stale current Thread write: expected project revision ${sourceRevision}, found ${actualProjectRevision}. Read the current project and retry.`,
      )
    }
    const actualQueueRevision = tableExists(database, 'queue_state') ? currentQueueRevision(database) : null
    if (input.sourceQueueRevision !== null && input.sourceQueueRevision !== actualQueueRevision) {
      throw new Error(
        `Stale current Thread write: expected queue revision ${input.sourceQueueRevision}, found ${actualQueueRevision ?? 'none'}. Read the current queue and retry.`,
      )
    }
    if (input.history && (
      input.history.sourceRevision !== Number(input.sourceRevision) ||
      input.history.sourceQueueRevision !== input.sourceQueueRevision
    )) {
      throw new Error('Current Thread history must use the same project and queue revisions as the current projection')
    }
    const updatedAt = new Date().toISOString()
    database.prepare(`
      INSERT INTO current_thread (
        id, payload_json, generated_at, source_revision,
        source_queue_revision, updated_at
      ) VALUES (1, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        payload_json = excluded.payload_json,
        generated_at = excluded.generated_at,
        source_revision = excluded.source_revision,
        source_queue_revision = excluded.source_queue_revision,
        updated_at = excluded.updated_at
    `).run(
      json(input.payload),
      input.generatedAt,
      String(input.sourceRevision),
      input.sourceQueueRevision,
      updatedAt,
    )
    if (input.history) replaceProjectStateDatabaseThreadHistory(database, input.history)
  })
}

/** Create the current-thread table for an existing database during migration. */
export function ensureProjectStateDatabaseCurrentThreadStore(projectRoot: string): void {
  withWritableDatabase(projectRoot, () => {})
}

function replaceProjectStateDatabaseThreadHistory(
  database: DatabaseSync,
  input: ProjectStateDatabaseThreadHistoryWrite,
): void {
  const retained: Array<{ turn: unknown; payload: string }> = []
  let payloadBytes = 0
  for (let index = input.turns.length - 1; index >= 0; index -= 1) {
    const turn = input.turns[index]
    const payload = json(turn)
    const bytes = Buffer.byteLength(payload, 'utf8')
    if (bytes > PROJECT_STATE_DATABASE_THREAD_HISTORY_MAX_BYTES - payloadBytes) break
    retained.push({ turn, payload })
    payloadBytes += bytes
    if (retained.length >= PROJECT_STATE_DATABASE_THREAD_HISTORY_MAX_TURNS) break
  }
  retained.reverse()
  const truncated = input.truncated || retained.length < input.turns.length
  database.prepare('DELETE FROM thread_history').run()
  database.prepare('DELETE FROM thread_history_state').run()
  const insert = database.prepare(`
    INSERT INTO thread_history (turn_index, turn_id, turn_at, turn_status, payload_json)
    VALUES (?, ?, ?, ?, ?)
  `)
  retained.forEach(({ turn, payload }, index) => {
    const record = isRecord(turn) ? turn : {}
    insert.run(
      index,
      typeof record.id === 'string' ? record.id : `turn-${index}`,
      typeof record.at === 'string' ? record.at : input.generatedAt,
      typeof record.status === 'string' ? record.status : 'done',
      payload,
    )
  })
  database.prepare(`
    INSERT INTO thread_history_state (
      id, source_revision, source_queue_revision, generated_at, turn_count, truncated
    ) VALUES (1, ?, ?, ?, ?, ?)
  `).run(
    String(input.sourceRevision),
    input.sourceQueueRevision,
    input.generatedAt,
    retained.length,
    truncated ? 1 : 0,
  )
}

/**
 * Read one bounded page from the durable Thread history projection. A null
 * result means the database predates this projection; callers must report an
 * honest cache miss or run the explicit migration, never rebuild history in a
 * normal GET.
 */
function readThreadHistoryPageFromDatabase<T = unknown>(
  database: DatabaseSync,
  options: { offset?: number; limit?: number } = {},
): ProjectStateDatabaseThreadHistoryPage<T> | null {
  if (!tableExists(database, 'thread_history') || !tableExists(database, 'thread_history_state')) return null
  const state = database.prepare(`
    SELECT source_revision, source_queue_revision, generated_at, turn_count, truncated
    FROM thread_history_state
    WHERE id = 1
  `).get() as JsonRecord | undefined
  if (!state || typeof state.source_revision !== 'string' || typeof state.generated_at !== 'string') return null
  const requestedOffset = options.offset ?? 0
  const requestedLimit = options.limit ?? 50
  const offset = Number.isFinite(requestedOffset)
    ? Math.max(0, Math.floor(requestedOffset))
    : 0
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(100, Math.max(1, Math.floor(requestedLimit)))
    : 50
  const total = Math.max(0, Number(state.turn_count ?? 0))
  const sourceQueueRevision = state.source_queue_revision === null || state.source_queue_revision === undefined
    ? null
    : Number.isFinite(Number(state.source_queue_revision))
      ? Number(state.source_queue_revision)
      : null
  const rows = database.prepare(`
    SELECT payload_json
    FROM thread_history
    ORDER BY turn_index ASC
    LIMIT ? OFFSET ?
  `).all(limit, offset) as JsonRecord[]
  const turns = rows.map(row => parseJson<T>(row.payload_json, null as T))
  const hasMore = offset + turns.length < total
  return {
    turns,
    offset,
    limit,
    total,
    hasMore,
    ...(hasMore ? { nextOffset: offset + turns.length } : {}),
    sourceRevision: state.source_revision,
    sourceQueueRevision,
    generatedAt: state.generated_at,
    truncated: Number(state.truncated ?? 0) === 1,
  }
}

export function readProjectStateDatabaseThreadHistoryPage<T = unknown>(
  projectRoot: string,
  options: { offset?: number; limit?: number } = {},
): ProjectStateDatabaseThreadHistoryPage<T> | null {
  const databasePath = projectStateDatabasePath(projectRoot)
  try {
    statSync(databasePath)
  } catch {
    return null
  }
  const database = openDatabase(databasePath, { readOnly: true })
  try {
    return readThreadHistoryPageFromDatabase<T>(database, options)
  } finally {
    database.close()
  }
}

/** Read historical Thread detail and its freshness watermark atomically. */
export function readProjectStateDatabaseThreadHistorySurfaceState(
  projectRoot: string,
  options: { offset?: number; limit?: number } = {},
): ProjectStateDatabaseThreadHistorySurfaceState {
  const databasePath = projectStateDatabasePath(projectRoot)
  try {
    statSync(databasePath)
  } catch {
    return {
      history: null,
      surface: { thread: null, queueRevision: null, projectRevision: null },
    }
  }
  const database = openDatabase(databasePath, { readOnly: true })
  let inReadTransaction = false
  try {
    database.exec('BEGIN')
    inReadTransaction = true
    return {
      history: readThreadHistoryPageFromDatabase(database, options),
      surface: readThreadSurfaceStateFromDatabase(database),
    }
  } finally {
    if (inReadTransaction) {
      try {
        database.exec('COMMIT')
      } catch {
        try {
          database.exec('ROLLBACK')
        } catch {
          // Preserve the original read result/error.
        }
      }
    }
    database.close()
  }
}

/** Create the historical Thread tables for an existing database. */
export function ensureProjectStateDatabaseThreadHistoryStore(projectRoot: string): void {
  withWritableDatabase(projectRoot, () => {})
}

export interface ProjectStateDatabaseSummaryCurrentStatePatch {
  /** Explicit current execution fact; summary payloads cannot update this row. */
  execution?: ProjectStateDatabaseExecution
  /** Explicit current runtime fact; summary payloads cannot update this row. */
  runtime?: ProjectStateDatabaseRuntime
}

export function updateProjectStateDatabaseSummaryAndCurrentState(
  tasksPath: string,
  patch: (summary: JsonRecord) => {
    summary: JsonRecord
    currentState?: ProjectStateDatabaseSummaryCurrentStatePatch
  },
): void {
  const databasePath = projectStateDatabasePathFromTasksPath(tasksPath)
  try {
    statSync(databasePath)
  } catch {
    return
  }
  const database = openDatabase(databasePath)
  try {
    transaction(database, () => {
      const current = database.prepare('SELECT payload_json FROM project_summary WHERE id = 1').get() as JsonRecord | undefined
      if (!current) return
      const currentSummary = hydrateSummaryFromAuxiliaryRows(
        database,
        parseJson<JsonRecord>(current.payload_json, {}),
      )
      if (currentSummary.orientationSpine === undefined && tableExists(database, 'project_orientation')) {
        const orientationRow = database.prepare('SELECT payload_json FROM project_orientation WHERE id = 1').get() as JsonRecord | undefined
        if (orientationRow?.payload_json !== undefined) {
          currentSummary.orientationSpine = parseJson<unknown>(orientationRow.payload_json, null)
        }
      }
      const result = patch(currentSummary)
      const next = result.summary
      const { compact: compactSummary, orientation, approvedPlan } = summaryStoragePartsForDatabase(database, next)
      const updatedAt = stringValue(next.generatedAt) ?? new Date().toISOString()
      const revision = commitAuthoritativeMutation(database, {
        updatedAt,
        domains: ['queue'],
        summaryFreshness: 'preserve',
      })
      database.prepare('UPDATE project_summary SET payload_json = ?, generated_at = ?, freshness = ?, revision = ? WHERE id = 1')
        .run(
          json(compactSummaryWithReleaseMembershipRevision(database, compactSummary)),
          updatedAt,
          stringValue(next.freshness) ?? 'current',
          revision,
        )
      syncProjectPlanSnapshot(database, approvedPlan, updatedAt, revision)
      writeProjectOrientationProjection(database, orientation, updatedAt, revision, { preserveOmitted: true })
      if (result.currentState?.execution) writeCurrentExecutionRow(database, result.currentState.execution)
      if (result.currentState?.runtime) writeCurrentRuntimeRow(database, result.currentState.runtime)
      markProjectionCurrent(database, 'summary', revision, updatedAt)
    })
  } finally {
    database.close()
  }
}

/** Update compact summary facts only; dedicated current-state rows are untouched. */
export function updateProjectStateDatabaseSummary(
  tasksPath: string,
  patch: (summary: JsonRecord) => JsonRecord,
): void {
  updateProjectStateDatabaseSummaryAndCurrentState(tasksPath, currentSummary => ({
    summary: patch(currentSummary),
  }))
}

function withDatabase(projectRoot: string, work: (database: DatabaseSync) => void): void {
  const databasePath = projectStateDatabasePath(projectRoot)
  try {
    statSync(databasePath)
  } catch {
    return
  }
  const database = openDatabase(databasePath)
  try {
    transaction(database, () => work(database))
  } finally {
    database.close()
  }
}

/** Explicit writers may allocate the current-state database; readers may not. */
function withWritableDatabase(projectRoot: string, work: (database: DatabaseSync) => void): void {
  const databasePath = projectStateDatabasePath(projectRoot)
  if (!existsSync(databasePath)) ensureProjectLocalHistoryDir(projectRoot)
  const database = openDatabase(databasePath)
  try {
    transaction(database, () => work(database))
  } finally {
    database.close()
  }
}

const PROJECT_HISTORICAL_ARTIFACT_KINDS = new Set<ProjectHistoricalArtifactKind>([
  'essential_history',
  'context_debug',
  'review_transport',
  'migration_snapshot',
  'evacuation_batch',
  'other',
])
const PROJECT_HISTORICAL_RETENTION_CLASSES = new Set<ProjectHistoricalArtifactRetentionClass>([
  'essential',
  'diagnostic',
  'rollback',
  'archive',
  'unclassified',
])
const PROJECT_HISTORICAL_ARTIFACT_STATES = new Set<ProjectHistoricalArtifactState>([
  'active',
  'replaced',
  'pinned',
  'unclassified',
])

function historicalArtifactFromRow(row: JsonRecord): ProjectHistoricalArtifact {
  return {
    artifactId: String(row.artifact_id ?? ''),
    kind: String(row.kind ?? 'other') as ProjectHistoricalArtifactKind,
    owner: String(row.owner ?? ''),
    logicalRef: String(row.logical_ref ?? ''),
    createdAt: String(row.created_at ?? ''),
    lastVerifiedAt: row.last_verified_at === null || row.last_verified_at === undefined
      ? null
      : String(row.last_verified_at),
    bytes: Math.max(0, Number(row.bytes ?? 0)),
    sha256: row.sha256 === null || row.sha256 === undefined ? null : String(row.sha256),
    retentionClass: String(row.retention_class ?? 'unclassified') as ProjectHistoricalArtifactRetentionClass,
    state: String(row.state ?? 'unclassified') as ProjectHistoricalArtifactState,
    replacementRef: row.replacement_ref === null || row.replacement_ref === undefined
      ? null
      : String(row.replacement_ref),
    sourceRevision: row.source_revision === null || row.source_revision === undefined
      ? null
      : String(row.source_revision),
  }
}

function validateHistoricalArtifactInput(input: ProjectHistoricalArtifactInput): void {
  if (!input.artifactId.trim()) throw new Error('Historical artifact id must not be empty')
  if (!PROJECT_HISTORICAL_ARTIFACT_KINDS.has(input.kind)) throw new Error(`Unknown historical artifact kind: ${input.kind}`)
  if (!input.owner.trim()) throw new Error('Historical artifact owner must not be empty')
  if (!input.logicalRef.trim()) throw new Error('Historical artifact logical ref must not be empty')
  if (!Number.isSafeInteger(input.bytes) || input.bytes < 0) throw new Error('Historical artifact bytes must be a non-negative integer')
  if (!PROJECT_HISTORICAL_RETENTION_CLASSES.has(input.retentionClass)) throw new Error(`Unknown historical retention class: ${input.retentionClass}`)
  if (input.state !== undefined && !PROJECT_HISTORICAL_ARTIFACT_STATES.has(input.state)) throw new Error(`Unknown historical artifact state: ${input.state}`)
}

function readHistoricalArtifactFromDatabase(database: DatabaseSync, artifactId: string): ProjectHistoricalArtifact | null {
  if (!tableExists(database, 'historical_artifacts')) return null
  const row = database.prepare('SELECT * FROM historical_artifacts WHERE artifact_id = ?').get(artifactId) as JsonRecord | undefined
  return row ? historicalArtifactFromRow(row) : null
}

/** Register metadata for an existing historical payload; never stores its body. */
export function registerProjectHistoricalArtifact(
  projectRoot: string,
  input: ProjectHistoricalArtifactInput,
): ProjectHistoricalArtifact {
  validateHistoricalArtifactInput(input)
  const createdAt = input.createdAt ?? new Date().toISOString()
  withWritableDatabase(projectRoot, database => {
    database.prepare(`
      INSERT INTO historical_artifacts (
        artifact_id, kind, owner, logical_ref, created_at, last_verified_at,
        bytes, sha256, retention_class, state, replacement_ref, source_revision
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(artifact_id) DO UPDATE SET
        kind = excluded.kind,
        owner = excluded.owner,
        logical_ref = excluded.logical_ref,
        last_verified_at = excluded.last_verified_at,
        bytes = excluded.bytes,
        sha256 = excluded.sha256,
        retention_class = excluded.retention_class,
        state = excluded.state,
        replacement_ref = excluded.replacement_ref,
        source_revision = excluded.source_revision
    `).run(
      input.artifactId,
      input.kind,
      input.owner,
      input.logicalRef,
      createdAt,
      input.lastVerifiedAt ?? null,
      input.bytes,
      input.sha256 ?? null,
      input.retentionClass,
      input.state ?? 'active',
      input.replacementRef ?? null,
      input.sourceRevision ?? null,
    )
  })
  const artifact = readProjectHistoricalArtifact(projectRoot, input.artifactId)
  if (!artifact) throw new Error(`Historical artifact registration did not persist: ${input.artifactId}`)
  return artifact
}

/** Register history without allowing legacy writes to allocate current state. */
export function registerProjectHistoricalArtifactIfCurrent(
  projectRoot: string,
  input: ProjectHistoricalArtifactInput,
): ProjectHistoricalArtifact | null {
  if (readProjectStateDatabaseAuthoritySnapshot(projectRoot)?.authority !== 'database') return null
  return registerProjectHistoricalArtifact(projectRoot, input)
}

export function readProjectHistoricalArtifact(projectRoot: string, artifactId: string): ProjectHistoricalArtifact | null {
  const databasePath = projectStateDatabasePath(projectRoot)
  try {
    statSync(databasePath)
  } catch {
    return null
  }
  const database = openDatabase(databasePath, { readOnly: true })
  try {
    return readHistoricalArtifactFromDatabase(database, artifactId)
  } finally {
    database.close()
  }
}

export function readProjectHistoricalArtifacts(projectRoot: string): ProjectHistoricalArtifact[] | null {
  const databasePath = projectStateDatabasePath(projectRoot)
  try {
    statSync(databasePath)
  } catch {
    return null
  }
  const database = openDatabase(databasePath, { readOnly: true })
  try {
    if (!tableExists(database, 'historical_artifacts')) return []
    return (database.prepare('SELECT * FROM historical_artifacts ORDER BY created_at DESC, artifact_id').all() as JsonRecord[])
      .map(historicalArtifactFromRow)
  } finally {
    database.close()
  }
}

export function readProjectHistoricalRetentionSummary(projectRoot: string): ProjectHistoricalRetentionSummary | null {
  const artifacts = readProjectHistoricalArtifacts(projectRoot)
  if (artifacts === null) return null
  const summary: ProjectHistoricalRetentionSummary = {
    totalBytes: 0,
    totalArtifacts: artifacts.length,
    unclassifiedArtifacts: 0,
    byKind: {},
    byRetentionClass: {},
  }
  for (const artifact of artifacts) {
    summary.totalBytes += artifact.bytes
    if (artifact.state === 'unclassified' || artifact.retentionClass === 'unclassified') summary.unclassifiedArtifacts += 1
    const kind = summary.byKind[artifact.kind] ?? { artifacts: 0, bytes: 0 }
    kind.artifacts += 1
    kind.bytes += artifact.bytes
    summary.byKind[artifact.kind] = kind
    const retention = summary.byRetentionClass[artifact.retentionClass] ?? { artifacts: 0, bytes: 0 }
    retention.artifacts += 1
    retention.bytes += artifact.bytes
    summary.byRetentionClass[artifact.retentionClass] = retention
  }
  return summary
}

/** Mark a payload replaced; deletion remains a separate digest-verified operation. */
export function markProjectHistoricalArtifactReplaced(
  projectRoot: string,
  artifactId: string,
  replacementRef: string,
  lastVerifiedAt = new Date().toISOString(),
): boolean {
  if (!artifactId.trim()) throw new Error('Historical artifact id must not be empty')
  if (!replacementRef.trim()) throw new Error('Historical artifact replacement ref must not be empty')
  let changed = false
  withWritableDatabase(projectRoot, database => {
    const result = database.prepare(`
      UPDATE historical_artifacts
      SET state = 'replaced', replacement_ref = ?, last_verified_at = ?
      WHERE artifact_id = ?
    `).run(replacementRef, lastVerifiedAt, artifactId) as { changes?: number }
    changed = Number(result.changes ?? 0) > 0
  })
  return changed
}

function tableExists(database: DatabaseSync, table: string): boolean {
  return Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table))
}

function tableHasColumn(database: DatabaseSync, table: string, column: string): boolean {
  return (database.prepare(`PRAGMA table_info(${table})`).all() as JsonRecord[])
    .some(entry => entry.name === column)
}

function queueStateReadColumns(database: DatabaseSync, columns: readonly string[]): string {
  return columns.map(column =>
    tableHasColumn(database, 'queue_state', column)
      ? column
      : `NULL AS ${column}`,
  ).join(', ')
}

function legacyJson(projectRoot: string, filename: string): JsonRecord | null {
  try {
    const parsed = JSON.parse(readFileSync(join(getProjectLocalHistoryDir(projectRoot), filename), 'utf8'))
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** Compatibility probe for source intake that has not crossed the snapshot writer yet. */
export function hasProjectWorkspaceGoals(projectRoot: string): boolean {
  return legacyJson(projectRoot, 'project-state/workspace-goals.json') !== null
}

function readProjectStateDatabaseAvailabilityFromDatabase(
  database: DatabaseSync,
): ProjectStateDatabaseAvailability | null {
  if (!tableExists(database, 'project_availability')) return null
  const row = database.prepare('SELECT status, paused_at, resumed_at, reason, payload_json FROM project_availability WHERE id = 1').get() as JsonRecord | undefined
  if (!row) return null
  return {
    status: row.status === 'paused' ? 'paused' : 'active',
    pausedAt: stringValue(row.paused_at) ?? null,
    resumedAt: stringValue(row.resumed_at) ?? null,
    ...(stringValue(row.reason) ? { reason: stringValue(row.reason)! } : {}),
  }
}

export function readProjectStateDatabaseAvailability(projectRoot: string): ProjectStateDatabaseAvailability | null {
  const databasePath = projectStateDatabasePath(projectRoot)
  try {
    statSync(databasePath)
  } catch {
    return null
  }
  const database = openDatabase(databasePath, { readOnly: true })
  try {
    return readProjectStateDatabaseAvailabilityFromDatabase(database)
  } finally {
    database.close()
  }
}

function availabilityFromLegacy(projectRoot: string): ProjectStateDatabaseAvailability | null {
  const legacy = legacyJson(projectRoot, 'project-availability.json')
  if (!legacy) return null
  return {
    status: legacy.status === 'paused' ? 'paused' : 'active',
    pausedAt: stringValue(legacy.pausedAt) ?? null,
    resumedAt: stringValue(legacy.resumedAt) ?? null,
    ...(stringValue(legacy.reason) ? { reason: stringValue(legacy.reason)! } : {}),
  }
}

export function writeProjectStateDatabaseAvailability(
  projectRoot: string,
  input: ProjectStateDatabaseAvailability,
  updatedAt = new Date().toISOString(),
): void {
  withWritableDatabase(projectRoot, database => {
    database.prepare(`
      INSERT INTO project_availability (id, status, paused_at, resumed_at, reason, updated_at, payload_json)
      VALUES (1, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET status = excluded.status, paused_at = excluded.paused_at,
        resumed_at = excluded.resumed_at, reason = excluded.reason, updated_at = excluded.updated_at,
        payload_json = excluded.payload_json
    `).run(input.status, input.pausedAt, input.resumedAt, input.reason ?? null, updatedAt, json(input))
    commitAuthoritativeMutation(database, {
      updatedAt,
      domains: ['availability'],
      projectRoot,
    })
  })
}

function readProjectStateDatabaseAttentionRecordsFromDatabase<T = unknown>(
  database: DatabaseSync,
): ProjectStateDatabaseAttentionRecord<T>[] | null {
  if (!tableExists(database, 'attention_records')) return null
  const rows = database.prepare('SELECT id, status, updated_at, payload_json FROM attention_records ORDER BY updated_at DESC, id').all() as JsonRecord[]
  return rows.map(row => ({
    id: String(row.id),
    status: String(row.status),
    updatedAt: String(row.updated_at),
    payload: parseJson<T>(row.payload_json, {} as T),
  }))
}

export function readProjectStateDatabaseAttentionRecords<T = unknown>(projectRoot: string): ProjectStateDatabaseAttentionRecord<T>[] | null {
  const databasePath = projectStateDatabasePath(projectRoot)
  try {
    statSync(databasePath)
  } catch {
    return null
  }
  const database = openDatabase(databasePath, { readOnly: true })
  try {
    return readProjectStateDatabaseAttentionRecordsFromDatabase<T>(database)
  } finally {
    database.close()
  }
}

function readProjectStateDatabaseProjectionWatermarkFromDatabase(
  database: DatabaseSync,
  domain: string,
): ProjectStateDatabaseProjectionWatermark | null {
  if (!tableExists(database, 'projection_watermarks')) return null
  const row = database.prepare(`
    SELECT domain, source_revision, refreshed_at
    FROM projection_watermarks
    WHERE domain = ?
  `).get(domain) as JsonRecord | undefined
  if (!row || !Number.isFinite(Number(row.source_revision)) || typeof row.refreshed_at !== 'string') return null
  return {
    domain: String(row.domain ?? domain),
    sourceRevision: Number(row.source_revision),
    refreshedAt: row.refreshed_at,
  }
}

export function readProjectStateDatabaseProjectionWatermark(
  projectRoot: string,
  domain: string,
): ProjectStateDatabaseProjectionWatermark | null {
  const databasePath = projectStateDatabasePath(projectRoot)
  try {
    statSync(databasePath)
  } catch {
    return null
  }
  const database = openDatabase(databasePath, { readOnly: true })
  try {
    return readProjectStateDatabaseProjectionWatermarkFromDatabase(database, domain)
  } finally {
    database.close()
  }
}

function projectionJobStatuses(
  status: ProjectStateDatabaseProjectionJobReadOptions['status'],
): ProjectStateDatabaseProjectionJobStatus[] {
  const statuses = status === undefined ? ['pending'] : Array.isArray(status) ? [...status] : [status]
  return [...new Set(statuses)]
}

function projectionJobLimit(limit: number | undefined): number {
  if (limit === undefined) return 100
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError('Projection job limits must be positive integers')
  return limit
}

function readProjectionJobsFromDatabase(
  database: DatabaseSync,
  options: ProjectStateDatabaseProjectionJobReadOptions = {},
): ProjectStateDatabaseProjectionJob[] {
  if (!tableExists(database, 'projection_jobs')) return []
  const statuses = projectionJobStatuses(options.status)
  if (statuses.length === 0) return []
  const placeholders = statuses.map(() => '?').join(', ')
  const rows = database.prepare(`
    SELECT id, domain, source_revision, status, error, attempts, claimed_at,
      last_attempt_at, completed_at, created_at, updated_at
    FROM projection_jobs
    WHERE status IN (${placeholders})
      AND (
        status = 'succeeded' OR source_revision > COALESCE(
          (SELECT source_revision FROM projection_watermarks
           WHERE projection_watermarks.domain = projection_jobs.domain), -1
        )
      )
    ORDER BY source_revision ASC, id ASC
    LIMIT ?
  `).all(...statuses, projectionJobLimit(options.limit)) as JsonRecord[]
  return rows.map(projectionJobFromRow)
}

/** List pending projection metadata without allocating a missing database. */
export function listProjectStateDatabaseProjectionJobs(
  projectRoot: string,
  options: ProjectStateDatabaseProjectionJobReadOptions = {},
): ProjectStateDatabaseProjectionJob[] {
  const databasePath = projectStateDatabasePath(projectRoot)
  try {
    statSync(databasePath)
  } catch {
    return []
  }
  const database = openDatabase(databasePath, { readOnly: true })
  try {
    return readProjectionJobsFromDatabase(database, options)
  } finally {
    database.close()
  }
}

/**
 * Record only revision obligations. The caller can supply the committed
 * revision from a larger write; omitted revisions use the current database
 * revision for standalone callers.
 */
export function recordProjectStateDatabaseProjectionObligations(
  projectRoot: string,
  domains: readonly string[],
  options: ProjectStateDatabaseProjectionJobWriteOptions = {},
): void {
  withWritableDatabase(projectRoot, database => {
    const current = currentRevision(database)
    const sourceRevision = options.sourceRevision ?? current
    if (sourceRevision > current) {
      throw new RangeError('Projection obligation cannot be ahead of the current project revision')
    }
    recordProjectionJobs(
      database,
      domains,
      sourceRevision,
      options.now ?? new Date().toISOString(),
    )
  })
}

/** Claim pending jobs atomically; attempts count claims, not retries. */
export function claimProjectStateDatabaseProjectionJobs(
  projectRoot: string,
  options: { limit?: number; now?: string } = {},
): ProjectStateDatabaseProjectionJob[] {
  const claimed: ProjectStateDatabaseProjectionJob[] = []
  withDatabase(projectRoot, database => {
    if (!tableExists(database, 'projection_jobs')) return
    const now = options.now ?? new Date().toISOString()
    const pending = readProjectionJobsFromDatabase(database, { status: 'pending', limit: options.limit })
    const update = database.prepare(`
      UPDATE projection_jobs
      SET status = 'running',
          attempts = attempts + 1,
          claimed_at = ?,
          last_attempt_at = ?,
          updated_at = ?
      WHERE id = ? AND status = 'pending'
    `)
    for (const job of pending) {
      const result = update.run(now, now, now, job.id)
      if (Number(result.changes ?? 0) !== 1) continue
      const row = database.prepare(`
        SELECT id, domain, source_revision, status, error, attempts, claimed_at,
          last_attempt_at, completed_at, created_at, updated_at
        FROM projection_jobs WHERE id = ?
      `).get(job.id) as JsonRecord | undefined
      if (row) claimed.push(projectionJobFromRow(row))
    }
  })
  return claimed
}

/** Mark a claimed job failed while retaining its attempt and error metadata. */
export function failProjectStateDatabaseProjectionJob(
  projectRoot: string,
  job: number | string,
  error: string,
  now = new Date().toISOString(),
): ProjectStateDatabaseProjectionJob | null {
  let failed: ProjectStateDatabaseProjectionJob | null = null
  withDatabase(projectRoot, database => {
    if (!tableExists(database, 'projection_jobs')) return
    const column = typeof job === 'number' ? 'id' : 'domain'
    const result = database.prepare(`
      UPDATE projection_jobs
      SET status = 'failed', error = ?, claimed_at = NULL, updated_at = ?
      WHERE ${column} = ? AND status = 'running'
    `).run(boundedProjectionJobError(error), now, job)
    if (Number(result.changes ?? 0) !== 1) return
    const row = database.prepare(`
      SELECT id, domain, source_revision, status, error, attempts, claimed_at,
        last_attempt_at, completed_at, created_at, updated_at
      FROM projection_jobs WHERE ${column} = ?
    `).get(job) as JsonRecord | undefined
    failed = row ? projectionJobFromRow(row) : null
  })
  return failed
}

/** Put a failed or claimed job back in the pending queue. */
export function retryProjectStateDatabaseProjectionJob(
  projectRoot: string,
  job: number | string,
  options: ProjectStateDatabaseProjectionJobWriteOptions = {},
): ProjectStateDatabaseProjectionJob | null {
  let retried: ProjectStateDatabaseProjectionJob | null = null
  withDatabase(projectRoot, database => {
    if (!tableExists(database, 'projection_jobs')) return
    const column = typeof job === 'number' ? 'id' : 'domain'
    const result = database.prepare(`
      UPDATE projection_jobs
      SET status = 'pending',
          error = COALESCE(?, error),
          claimed_at = NULL,
          completed_at = NULL,
          updated_at = ?
      WHERE ${column} = ? AND status IN ('running', 'failed', 'pending')
    `).run(boundedProjectionJobError(options.error), options.now ?? new Date().toISOString(), job)
    if (Number(result.changes ?? 0) !== 1) return
    const row = database.prepare(`
      SELECT id, domain, source_revision, status, error, attempts, claimed_at,
        last_attempt_at, completed_at, created_at, updated_at
      FROM projection_jobs WHERE ${column} = ?
    `).get(job) as JsonRecord | undefined
    retried = row ? projectionJobFromRow(row) : null
  })
  return retried
}

/** Publish a projection watermark and complete any older obligation. */
export function markProjectStateDatabaseProjectionCurrent(
  projectRoot: string,
  domain: string,
  sourceRevision: number,
  refreshedAt = new Date().toISOString(),
): void {
  withWritableDatabase(projectRoot, database => {
    if (sourceRevision > currentRevision(database)) {
      throw new RangeError('Projection watermark cannot be ahead of the current project revision')
    }
    markProjectionCurrent(database, domain, sourceRevision, refreshedAt)
  })
}

function attentionFromLegacy<T>(projectRoot: string): ProjectStateDatabaseAttentionRecord<T>[] | null {
  const legacy = legacyJson(projectRoot, 'project-state/attention.json')
  const records = legacy?.records
  if (!Array.isArray(records)) return null
  return records.flatMap(record => {
    if (!isRecord(record) || typeof record.id !== 'string') return []
    return [{
      id: record.id,
      status: stringValue(record.status) ?? 'open',
      updatedAt: stringValue(record.updatedAt) ?? '',
      payload: record as T,
    }]
  })
}

export function replaceProjectStateDatabaseAttentionRecords<T extends { id: string; status: string; updatedAt?: string }>(
  projectRoot: string,
  records: readonly T[],
): void {
  withWritableDatabase(projectRoot, database => {
    const next = [...records]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(record => ({
        id: record.id,
        status: record.status,
        updatedAt: record.updatedAt ?? new Date().toISOString(),
        payloadJson: json(record),
      }))
    const existing = (database.prepare('SELECT id, status, updated_at, payload_json FROM attention_records ORDER BY id').all() as JsonRecord[])
      .map(row => ({
        id: String(row.id),
        status: String(row.status),
        updatedAt: String(row.updated_at),
        payloadJson: String(row.payload_json),
      }))
    if (JSON.stringify(existing) === JSON.stringify(next)) {
      markProjectionCurrent(database, 'attention', currentRevision(database), new Date().toISOString())
      return
    }
    const nextById = new Map(next.map(record => [record.id, record]))
    const existingById = new Map(existing.map(record => [record.id, record]))
    for (const record of existing) {
      if (!nextById.has(record.id)) database.prepare('DELETE FROM attention_records WHERE id = ?').run(record.id)
    }
    const upsert = database.prepare(`
      INSERT INTO attention_records (id, status, updated_at, payload_json)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        updated_at = excluded.updated_at,
        payload_json = excluded.payload_json
    `)
    for (const record of next) {
      const prior = existingById.get(record.id)
      if (prior &&
        prior.status === record.status &&
        prior.updatedAt === record.updatedAt &&
        prior.payloadJson === record.payloadJson) continue
      upsert.run(record.id, record.status, record.updatedAt, record.payloadJson)
    }
    const updatedAt = next.reduce((latest, record) => record.updatedAt > latest ? record.updatedAt : latest, new Date().toISOString())
    // Attention is itself a derived projection; materializing it must not
    // enqueue another attention refresh.
    emitProjectSummaryInvalidation(projectRoot, 'database-derived-projection-write', {
      revision: currentRevision(database),
      domains: ['attention'],
    })
    markProjectionCurrent(database, 'attention', currentRevision(database), updatedAt)
  })
}

export function readProjectStateDatabaseReconciliations<T = unknown>(projectRoot: string): ProjectStateDatabaseReconciliation<T>[] | null {
  const databasePath = projectStateDatabasePath(projectRoot)
  try {
    statSync(databasePath)
  } catch {
    return null
  }
  const database = openDatabase(databasePath, { readOnly: true })
  try {
    if (!tableExists(database, 'project_reconciliations')) return null
    const rows = database.prepare('SELECT capability_id, status, resolved_at, payload_json FROM project_reconciliations ORDER BY resolved_at DESC, capability_id').all() as JsonRecord[]
    return rows.map(row => ({
      capabilityId: String(row.capability_id),
      status: String(row.status),
      resolvedAt: String(row.resolved_at),
      payload: parseJson<T>(row.payload_json, {} as T),
    }))
  } finally {
    database.close()
  }
}

function reconciliationsFromLegacy<T>(projectRoot: string): ProjectStateDatabaseReconciliation<T>[] | null {
  const legacy = legacyJson(projectRoot, 'project-state/reconciliations.json')
  const records = legacy?.records
  if (!Array.isArray(records)) return null
  return records.flatMap(record => {
    if (!isRecord(record) || typeof record.capabilityId !== 'string') return []
    return [{
      capabilityId: record.capabilityId,
      status: stringValue(record.status) ?? 'resolved',
      resolvedAt: stringValue(record.resolvedAt) ?? '',
      payload: record as T,
    }]
  })
}

export function upsertProjectStateDatabaseReconciliations<T extends { capabilityId: string; status: string; resolvedAt: string }>(
  projectRoot: string,
  records: readonly T[],
): void {
  if (records.length === 0) return
  withWritableDatabase(projectRoot, database => {
    const upsert = database.prepare(`
      INSERT INTO project_reconciliations (capability_id, status, resolved_at, payload_json)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(capability_id) DO UPDATE SET status = excluded.status,
        resolved_at = excluded.resolved_at, payload_json = excluded.payload_json
    `)
    for (const record of records) upsert.run(record.capabilityId, record.status, record.resolvedAt, json(record))
    const updatedAt = records.reduce((latest, record) => record.resolvedAt > latest ? record.resolvedAt : latest, new Date().toISOString())
    invalidateDerivedProjection(database, projectRoot, ['reconciliation'], ['attention'], updatedAt)
    markProjectionCurrent(database, 'reconciliation', currentRevision(database), updatedAt)
  })
}

/** Explicit migration only. Normal live-state readers are database-only. */
export function migrateLegacyProjectLiveState(projectRoot: string): string[] {
  const availability = availabilityFromLegacy(projectRoot)
  const attention = attentionFromLegacy<JsonRecord>(projectRoot)
  const reconciliations = reconciliationsFromLegacy<JsonRecord>(projectRoot)
  if (!availability && attention === null && reconciliations === null) return []

  const migrated: string[] = []
  withWritableDatabase(projectRoot, database => {
    if (availability && !database.prepare('SELECT 1 FROM project_availability WHERE id = 1').get()) {
      database.prepare(`
        INSERT INTO project_availability (id, status, paused_at, resumed_at, reason, updated_at, payload_json)
        VALUES (1, ?, ?, ?, ?, ?, ?)
      `).run(
        availability.status,
        availability.pausedAt,
        availability.resumedAt,
        availability.reason ?? null,
        availability.pausedAt ?? availability.resumedAt ?? new Date().toISOString(),
        json(availability),
      )
      migrated.push('project-availability.json')
    }
    if (attention !== null && Number((database.prepare('SELECT COUNT(*) AS count FROM attention_records').get() as JsonRecord).count ?? 0) === 0) {
      const insert = database.prepare('INSERT INTO attention_records (id, status, updated_at, payload_json) VALUES (?, ?, ?, ?)')
      for (const record of attention) insert.run(record.id, record.status, record.updatedAt, json(record.payload))
      migrated.push('project-state/attention.json')
    }
    if (reconciliations !== null && Number((database.prepare('SELECT COUNT(*) AS count FROM project_reconciliations').get() as JsonRecord).count ?? 0) === 0) {
      const insert = database.prepare('INSERT INTO project_reconciliations (capability_id, status, resolved_at, payload_json) VALUES (?, ?, ?, ?)')
      for (const record of reconciliations) insert.run(record.capabilityId, record.status, record.resolvedAt, json(record.payload))
      migrated.push('project-state/reconciliations.json')
    }
    const domains: ProjectStateDomain[] = []
    if (migrated.includes('project-availability.json')) domains.push('availability')
    if (migrated.includes('project-state/attention.json')) domains.push('attention')
    if (migrated.includes('project-state/reconciliations.json')) domains.push('reconciliation')
    if (domains.length > 0) {
      const updatedAt = new Date().toISOString()
      if (domains.every(domain => domain === 'reconciliation' || domain === 'attention')) {
        if (domains.includes('reconciliation')) {
          invalidateDerivedProjection(database, projectRoot, domains, ['attention'], updatedAt)
          markProjectionCurrent(database, 'reconciliation', currentRevision(database), updatedAt)
        } else {
          emitProjectSummaryInvalidation(projectRoot, 'database-derived-projection-write', {
            revision: currentRevision(database),
            domains,
          })
        }
      } else {
        commitAuthoritativeMutation(database, {
          updatedAt,
          domains,
          projectRoot,
        })
      }
      if (domains.includes('attention')) {
        markProjectionCurrent(database, 'attention', currentRevision(database), updatedAt)
      }
    }
  })
  return migrated
}

export function hasLegacyProjectLiveState(projectRoot: string): boolean {
  return Boolean(
    availabilityFromLegacy(projectRoot) ||
    attentionFromLegacy(projectRoot) !== null ||
    reconciliationsFromLegacy(projectRoot) !== null,
  )
}

export function readProjectStateDatabaseMetadata(projectRoot: string): ProjectStateDatabaseMetadata | null {
  const databasePath = projectStateDatabasePath(projectRoot)
  try {
    statSync(databasePath)
  } catch {
    return null
  }
  const database = openDatabase(databasePath, { readOnly: true })
  try {
    const row = database.prepare('SELECT schema_version, revision, updated_at FROM project_meta WHERE id = 1').get() as JsonRecord | undefined
    if (!row) return null
    const projectMetaColumns = database.prepare('PRAGMA table_info(project_meta)').all() as JsonRecord[]
    const evidenceAuthority = projectMetaColumns.some(column => column.name === 'task_evidence_authority')
      ? (database.prepare('SELECT task_evidence_authority FROM project_meta WHERE id = 1').get() as JsonRecord | undefined)?.task_evidence_authority
      : undefined
    let projectStateAuthority: ProjectStateDatabaseAuthority | undefined
    try {
      const authorityRow = database.prepare('SELECT project_state_authority FROM project_meta WHERE id = 1').get() as JsonRecord | undefined
      projectStateAuthority = authorityRow?.project_state_authority === 'database' ? 'database' : 'legacy'
    } catch {
      // Schema 10 used the same fact under its transitional column name. Read
      // it for migration discovery; writable opens rename it to schema 12.
      try {
        const legacyRow = database.prepare('SELECT task_overlay_authority FROM project_meta WHERE id = 1').get() as JsonRecord | undefined
        projectStateAuthority = legacyRow?.task_overlay_authority === 'database' ? 'database' : 'legacy'
      } catch {
        projectStateAuthority = 'legacy'
      }
    }
    let summaryRevision: number | null = null
    let summaryFreshness: ProjectStateDatabaseMetadata['summaryFreshness'] = 'missing'
    if (tableExists(database, 'project_summary')) {
      const summaryRow = database.prepare('SELECT revision, freshness FROM project_summary WHERE id = 1').get() as JsonRecord | undefined
      if (summaryRow) {
        summaryRevision = Number(summaryRow.revision ?? 0)
        summaryFreshness = summaryRow.freshness === 'current' ? 'current' : 'stale'
      }
    }
    return {
      schemaVersion: Number(row.schema_version ?? 0),
      revision: Number(row.revision ?? 0),
      updatedAt: String(row.updated_at ?? ''),
      projectStateAuthority,
      taskEvidenceAuthority: evidenceAuthority === 'database'
        ? 'database'
        : evidenceAuthority === 'compressed'
          ? 'compressed'
          : 'legacy',
      summaryRevision,
      summaryFreshness,
    }
  } finally {
    database.close()
  }
}

export function readProjectStateDatabaseRevisionFromTasksPath(tasksPath: string): number | null {
  const databasePath = projectStateDatabasePathFromTasksPath(tasksPath)
  try {
    statSync(databasePath)
  } catch {
    return null
  }
  const database = openDatabase(databasePath, { readOnly: true })
  try {
    const row = database.prepare('SELECT revision FROM project_meta WHERE id = 1').get() as JsonRecord | undefined
    return row ? Number(row.revision ?? 0) : null
  } finally {
    database.close()
  }
}

/** Read only the release-membership watermark; this never opens task detail. */
export function readProjectStateDatabaseReleaseMembershipState(
  tasksPath: string,
): ProjectStateDatabaseReleaseMembershipState | null {
  const databasePath = projectStateDatabasePathFromTasksPath(tasksPath)
  try {
    statSync(databasePath)
  } catch {
    return null
  }
  const database = openDatabase(databasePath, { readOnly: true })
  try {
    return readReleaseMembershipStateFromDatabase(database)
  } finally {
    database.close()
  }
}

function readProjectStateDatabaseAuthorityFromDatabase(database: DatabaseSync): ProjectStateDatabaseAuthority {
  try {
    const row = database.prepare('SELECT project_state_authority FROM project_meta WHERE id = 1').get() as JsonRecord | undefined
    return row?.project_state_authority === 'database' ? 'database' : 'legacy'
  } catch {
    // Schema 10 used the same fact under its transitional column name. Read
    // it for migration discovery; writable opens rename it to schema 12.
    try {
      const row = database.prepare('SELECT task_overlay_authority FROM project_meta WHERE id = 1').get() as JsonRecord | undefined
      return row?.task_overlay_authority === 'database' ? 'database' : 'legacy'
    } catch {
      return 'legacy'
    }
  }
}

/**
 * Resolve the authority used by ordinary reads while staying on the same
 * SQLite connection as the projection they will consume. A materialized
 * queue row is the durable current-state boundary; the marker remains useful
 * only for an initialized database that has not materialized its queue yet.
 */
function readProjectStateDatabaseEffectiveAuthorityFromDatabase(
  database: DatabaseSync,
): ProjectStateDatabaseAuthority {
  if (tableExists(database, 'queue_state')) {
    const queue = database.prepare('SELECT id FROM queue_state WHERE id = 1').get() as JsonRecord | undefined
    if (queue) return 'database'
  }
  return readProjectStateDatabaseAuthorityFromDatabase(database)
}

function readProjectStateDatabaseTaskEvidenceAuthorityFromDatabase(
  database: DatabaseSync,
): ProjectStateDatabaseTaskEvidenceAuthority {
  const columns = database.prepare('PRAGMA table_info(project_meta)').all() as JsonRecord[]
  if (!columns.some(column => column.name === 'task_evidence_authority')) return 'legacy'
  const row = database.prepare('SELECT task_evidence_authority FROM project_meta WHERE id = 1').get() as JsonRecord | undefined
  if (row?.task_evidence_authority === 'database') return 'database'
  if (row?.task_evidence_authority === 'compressed') return 'compressed'
  return 'legacy'
}

function readProjectStateDatabaseAuthorityAtPath(databasePath: string): ProjectStateDatabaseAuthority | null {
  try {
    statSync(databasePath)
  } catch {
    return null
  }
  const database = openDatabase(databasePath, { readOnly: true })
  try {
    return readProjectStateDatabaseAuthorityFromDatabase(database)
  } finally {
    database.close()
  }
}

/**
 * Read source authority and both current-state watermarks from one SQLite
 * connection. This is the only runtime source-selection boundary. A caller
 * may still observe legacy state for an unpromoted project, but it cannot
 * combine a marker from one read with a queue revision from another.
 */
function readProjectStateDatabaseAuthoritySnapshotAtPath(
  databasePath: string,
): ProjectStateDatabaseAuthoritySnapshot | null {
  try {
    statSync(databasePath)
  } catch {
    return null
  }
  let database: DatabaseSync
  try {
    database = openDatabase(databasePath, { readOnly: true })
  } catch {
    // A present database is an attempted current-state store. Never reopen a
    // compatibility queue merely because that store is corrupt or locked.
    return { authority: 'database', projectRevision: 0, queueRevision: null }
  }
  try {
    let meta: JsonRecord | undefined
    try {
      meta = database.prepare('SELECT revision FROM project_meta WHERE id = 1').get() as JsonRecord | undefined
    } catch {
      return { authority: 'database', projectRevision: 0, queueRevision: null }
    }
    if (!meta) return { authority: 'database', projectRevision: 0, queueRevision: null }
    const queueRevision = tableExists(database, 'queue_state')
      ? (database.prepare('SELECT revision FROM queue_state WHERE id = 1').get() as JsonRecord | undefined)?.revision
      : undefined
    return {
      authority: readProjectStateDatabaseEffectiveAuthorityFromDatabase(database),
      projectRevision: Number(meta.revision ?? 0),
      queueRevision: queueRevision === undefined ? null : Number(queueRevision ?? 0),
    }
  } finally {
    database.close()
  }
}

export function readProjectStateDatabaseAuthoritySnapshotFromTasksPath(
  tasksPath: string,
): ProjectStateDatabaseAuthoritySnapshot | null {
  return readProjectStateDatabaseAuthoritySnapshotAtPath(projectStateDatabasePathFromTasksPath(tasksPath))
}

export function readProjectStateDatabaseAuthoritySnapshot(
  projectRoot: string,
): ProjectStateDatabaseAuthoritySnapshot | null {
  return readProjectStateDatabaseAuthoritySnapshotAtPath(projectStateDatabasePath(projectRoot))
}

/**
 * Migration-only access to the historical promotion marker. Runtime callers
 * must use the current-authority snapshot, whose populated queue is the
 * source-selection fact and cannot disagree with the detail read.
 */
export function readProjectStateDatabaseAuthorityFromTasksPath(
  tasksPath: string,
): ProjectStateDatabaseAuthority | null {
  return readProjectStateDatabaseAuthorityAtPath(projectStateDatabasePathFromTasksPath(tasksPath))
}

export function readProjectStateDatabaseAuthority(
  projectRoot: string,
): ProjectStateDatabaseAuthority | null {
  return readProjectStateDatabaseAuthorityAtPath(projectStateDatabasePath(projectRoot))
}

/**
 * Read the authority that owns current project state. A readable normalized
 * queue is authoritative even while the historical promotion marker is being
 * finalized; ordinary runtime stores must not split on that bookkeeping flag.
 */
export function readProjectStateDatabaseCurrentAuthorityFromTasksPath(
  tasksPath: string,
): ProjectStateDatabaseAuthority | null {
  return readProjectStateDatabaseAuthoritySnapshotFromTasksPath(tasksPath)?.authority ?? null
}

export function readProjectStateDatabaseCurrentAuthority(
  projectRoot: string,
): ProjectStateDatabaseAuthority | null {
  return readProjectStateDatabaseAuthoritySnapshot(projectRoot)?.authority ?? null
}

export function readProjectStateDatabaseTaskEvidenceAuthority(
  projectRoot: string,
): ProjectStateDatabaseTaskEvidenceAuthority | null {
  const databasePath = projectStateDatabasePath(projectRoot)
  try {
    statSync(databasePath)
  } catch {
    return null
  }
  const database = openDatabase(databasePath, { readOnly: true })
  try {
    return readProjectStateDatabaseTaskEvidenceAuthorityFromDatabase(database)
  } finally {
    database.close()
  }
}

/** Read project and evidence authority plus the project revision together. */
export function readProjectStateDatabaseTaskEvidenceBoundary(
  projectRoot: string,
): ProjectStateDatabaseTaskEvidenceBoundary | null {
  const databasePath = projectStateDatabasePath(projectRoot)
  try {
    statSync(databasePath)
  } catch {
    return null
  }
  const database = openDatabase(databasePath, { readOnly: true })
  let inReadTransaction = false
  try {
    database.exec('BEGIN')
    inReadTransaction = true
    const projectAuthority = readProjectStateDatabaseEffectiveAuthorityFromDatabase(database)
    return {
      projectAuthority,
      evidenceAuthority: readProjectStateDatabaseTaskEvidenceAuthorityFromDatabase(database),
      projectRevision: tableExists(database, 'project_meta') ? currentRevision(database) : null,
    }
  } finally {
    if (inReadTransaction) {
      try {
        database.exec('COMMIT')
      } catch {
        try {
          database.exec('ROLLBACK')
        } catch {
          // Preserve the original read result/error.
        }
      }
    }
    database.close()
  }
}

export function setProjectStateDatabaseTaskEvidenceAuthority(
  projectRoot: string,
  authority: ProjectStateDatabaseTaskEvidenceAuthority,
): void {
  withWritableDatabase(projectRoot, database => {
    database.prepare('UPDATE project_meta SET task_evidence_authority = ?, updated_at = ? WHERE id = 1')
      .run(authority, new Date().toISOString())
  })
}

/**
 * Switch historical evidence to its compact filesystem ledger and empty the
 * transitional SQLite copy in one transaction. The caller must verify the
 * compact ledger before invoking this boundary.
 */
export function compactProjectStateDatabaseTaskEvidenceHistory(projectRoot: string): void {
  const database = openDatabase(projectStateDatabasePath(projectRoot))
  try {
    transaction(database, () => {
      if (!tableExists(database, 'task_evidence_history')) {
        throw new Error('Cannot compact task evidence: SQLite history table is missing')
      }
      database.exec('DELETE FROM task_evidence_history')
      database.prepare('UPDATE project_meta SET task_evidence_authority = ?, updated_at = ? WHERE id = 1')
        .run('compressed', new Date().toISOString())
    })
    database.exec('VACUUM')
  } finally {
    database.close()
  }
}

/** Promote imported task overlays to the current-state read authority. */
export function promoteProjectStateDatabaseAuthority(projectRoot: string): void {
  withWritableDatabase(projectRoot, database => {
    const updatedAt = new Date().toISOString()
    const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
    const queueRevision = currentQueueRevision(database)
    const existingDetail = readQueueDetailsForRevision(tasksPath, queueRevision, database, { migration: true })
    if (existingDetail && tableExists(database, 'work_item_detail')) {
      const existingDetailCount = Number((database.prepare('SELECT COUNT(*) AS count FROM work_item_detail').get() as JsonRecord | undefined)?.count ?? 0)
      const existingTaskCount = queueTasks(existingDetail).length
      if (existingDetailCount !== existingTaskCount) {
        replaceWorkItemDetails(database, queueTasks(existingDetail), queueRevision)
      }
    }
    database.prepare("UPDATE project_meta SET project_state_authority = 'database', updated_at = ? WHERE id = 1").run(updatedAt)
    commitAuthoritativeMutation(database, {
      updatedAt,
      domains: ['config'],
      projectRoot,
    })
  })
}

export function upsertProjectStateDatabaseTaskRuntime(
  projectRoot: string,
  input: ProjectStateDatabaseTaskRuntime,
): void {
  upsertProjectStateDatabaseTaskRuntimes(projectRoot, [input])
}

export function upsertProjectStateDatabaseTaskRuntimes(
  projectRoot: string,
  inputs: ProjectStateDatabaseTaskRuntime[],
): void {
  if (inputs.length === 0) return
  withWritableDatabase(projectRoot, database => {
    const upsert = database.prepare(`
      INSERT INTO task_execution (task_id, updated_at, payload_json)
      VALUES (?, ?, ?)
      ON CONFLICT(task_id) DO UPDATE SET
        updated_at = excluded.updated_at,
        payload_json = excluded.payload_json
    `)
    for (const input of inputs) {
      upsert.run(input.taskId, input.updatedAt ?? new Date().toISOString(), json(input.payload))
    }
    const updatedAt = inputs.reduce((latest, input) => {
      const value = input.updatedAt ?? latest
      return value > latest ? value : latest
    }, new Date().toISOString())
    commitAuthoritativeMutation(database, {
      updatedAt,
      domains: ['task-runtime'],
      projectRoot,
    })
  })
}

type ProjectStateDatabaseTaskOverlayTable = 'task_execution' | 'task_workspace'

/**
 * Synchronize one mutable overlay without rewriting unchanged rows. The
 * public store API still accepts a complete snapshot, but the database write
 * is a row diff so a one-task runtime update does not churn every task's
 * payload or revision metadata.
 */
function replaceTaskOverlayRowsInDatabase(
  database: DatabaseSync,
  table: ProjectStateDatabaseTaskOverlayTable,
  inputs: readonly ProjectStateDatabaseTaskRuntime[],
): { changed: boolean; updatedAt: string } {
  const now = new Date().toISOString()
  const next = new Map(inputs.map(input => [input.taskId, {
    taskId: input.taskId,
    updatedAt: input.updatedAt ?? now,
    payloadJson: json(input.payload),
  }]))
  const existing = (database.prepare(`
    SELECT task_id, updated_at, payload_json
    FROM ${table}
  `).all() as JsonRecord[]).map(row => ({
    taskId: String(row.task_id),
    updatedAt: String(row.updated_at),
    payloadJson: String(row.payload_json),
  }))
  const existingById = new Map(existing.map(row => [row.taskId, row]))
  let changed = false

  for (const row of existing) {
    if (next.has(row.taskId)) continue
    database.prepare(`DELETE FROM ${table} WHERE task_id = ?`).run(row.taskId)
    changed = true
  }

  const upsert = database.prepare(`
    INSERT INTO ${table} (task_id, updated_at, payload_json)
    VALUES (?, ?, ?)
    ON CONFLICT(task_id) DO UPDATE SET
      updated_at = excluded.updated_at,
      payload_json = excluded.payload_json
  `)
  for (const input of next.values()) {
    const prior = existingById.get(input.taskId)
    if (prior && prior.updatedAt === input.updatedAt && prior.payloadJson === input.payloadJson) continue
    upsert.run(input.taskId, input.updatedAt, input.payloadJson)
    changed = true
  }
  const updatedAt = [...next.values()].reduce(
    (latest, input) => input.updatedAt > latest ? input.updatedAt : latest,
    now,
  )
  return { changed, updatedAt }
}

function syncProjectStateDatabaseTaskOverlay(
  projectRoot: string,
  table: ProjectStateDatabaseTaskOverlayTable,
  inputs: readonly ProjectStateDatabaseTaskRuntime[],
  domain: ProjectStateDomain,
): void {
  withWritableDatabase(projectRoot, database => {
    const result = replaceTaskOverlayRowsInDatabase(database, table, inputs)
    if (!result.changed) return
    commitAuthoritativeMutation(database, {
      updatedAt: result.updatedAt,
      domains: [domain],
      projectRoot,
    })
  })
}

/** Replace the mutable runtime overlay; missing rows mean the state was cleared. */
export function replaceProjectStateDatabaseTaskRuntimes(
  projectRoot: string,
  inputs: readonly ProjectStateDatabaseTaskRuntime[],
): void {
  syncProjectStateDatabaseTaskOverlay(projectRoot, 'task_execution', inputs, 'task-runtime')
}

export function upsertProjectStateDatabaseTaskWorkspace(
  projectRoot: string,
  input: ProjectStateDatabaseTaskRuntime,
): void {
  upsertProjectStateDatabaseTaskWorkspaces(projectRoot, [input])
}

export function upsertProjectStateDatabaseTaskWorkspaces(
  projectRoot: string,
  inputs: ProjectStateDatabaseTaskRuntime[],
): void {
  if (inputs.length === 0) return
  withWritableDatabase(projectRoot, database => {
    const upsert = database.prepare(`
      INSERT INTO task_workspace (task_id, updated_at, payload_json)
      VALUES (?, ?, ?)
      ON CONFLICT(task_id) DO UPDATE SET
        updated_at = excluded.updated_at,
        payload_json = excluded.payload_json
    `)
    for (const input of inputs) {
      upsert.run(input.taskId, input.updatedAt ?? new Date().toISOString(), json(input.payload))
    }
    const updatedAt = inputs.reduce((latest, input) => {
      const value = input.updatedAt ?? latest
      return value > latest ? value : latest
    }, new Date().toISOString())
    commitAuthoritativeMutation(database, {
      updatedAt,
      domains: ['workspace'],
      projectRoot,
    })
  })
}

/** Replace the mutable workspace overlay; missing rows mean the state was cleared. */
export function replaceProjectStateDatabaseTaskWorkspaces(
  projectRoot: string,
  inputs: readonly ProjectStateDatabaseTaskRuntime[],
): void {
  syncProjectStateDatabaseTaskOverlay(projectRoot, 'task_workspace', inputs, 'workspace')
}

export function upsertProjectStateDatabaseTaskProof(
  projectRoot: string,
  input: ProjectStateDatabaseTaskProof,
): void {
  upsertProjectStateDatabaseTaskProofs(projectRoot, [input])
}

function upsertTaskProofAndCurrentEvidence(
  database: DatabaseSync,
  input: ProjectStateDatabaseTaskProof,
): void {
  const payload = compactTaskEvidencePayload(
    input.kind as Parameters<typeof compactTaskEvidencePayload>[0],
    isRecord(input.payload) ? input.payload : {},
  )
  const result = typeof payload.passed === 'boolean' ? (payload.passed ? 'passed' : 'failed') : null
  database.prepare(`
    INSERT INTO task_proof (task_id, latest_kind, latest_recorded_at, result, payload_json)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(task_id) DO UPDATE SET
      latest_kind = excluded.latest_kind,
      latest_recorded_at = excluded.latest_recorded_at,
      result = excluded.result,
      payload_json = excluded.payload_json
    WHERE excluded.latest_recorded_at >= task_proof.latest_recorded_at
  `).run(input.taskId, input.kind, input.recordedAt, result, json(payload))
  upsertCurrentTaskEvidence(database, { ...input, payload })
}

export function upsertProjectStateDatabaseTaskProofs(
  projectRoot: string,
  inputs: readonly ProjectStateDatabaseTaskProof[],
): void {
  if (inputs.length === 0) return
  withWritableDatabase(projectRoot, database => {
    const compactedInputs = inputs.map(input => ({
      ...input,
      payload: compactTaskEvidencePayload(
        input.kind as Parameters<typeof compactTaskEvidencePayload>[0],
        isRecord(input.payload) ? input.payload : {},
      ),
    }))
    for (const input of compactedInputs) upsertTaskProofAndCurrentEvidence(database, input)
    // A proof row alone cannot recompute scoped readiness, blockers, or the
    // map. The runtime projection writer owns those facts; do not publish a
    // partial payload as if it were current.
    const updatedAt = compactedInputs.reduce((latest, input) => input.recordedAt > latest ? input.recordedAt : latest, new Date().toISOString())
    commitAuthoritativeMutation(database, {
      updatedAt,
      domains: ['evidence'],
      projectRoot,
    })
  })
}

// The task-state policy is the normal owner of these values. Keep an absolute
// ceiling here too so migration/repair callers cannot create an unbounded
// SQLite history that ordinary reads must materialize.
const MAX_TASK_EVIDENCE_HISTORY_RECORDS = 64
const MAX_TASK_EVIDENCE_HISTORY_BYTES = 64 * 1024

function validateTaskEvidenceRetention(
  retention: ProjectStateDatabaseTaskEvidenceRetentionInput,
): ProjectStateDatabaseTaskEvidenceRetentionInput {
  const maxRecords = Math.min(Math.trunc(retention.maxRecords), MAX_TASK_EVIDENCE_HISTORY_RECORDS)
  const maxBytes = Math.min(Math.trunc(retention.maxBytes), MAX_TASK_EVIDENCE_HISTORY_BYTES)
  if (!Number.isFinite(maxRecords) || maxRecords < 1 || !Number.isFinite(maxBytes) || maxBytes < 1) {
    throw new RangeError('Task evidence retention must have positive maxRecords and maxBytes')
  }
  return { maxRecords, maxBytes }
}

function historyRecordBytes(event: TaskEvidenceEventRecord): number {
  return Buffer.byteLength(`${JSON.stringify(event)}\n`, 'utf8')
}

function trimTaskEvidenceHistory(
  database: DatabaseSync,
  event: TaskEvidenceEventRecord,
  retention: ProjectStateDatabaseTaskEvidenceRetentionInput,
): void {
  const rows = database.prepare(`
    SELECT evidence_id, recorded_at, payload_json
    FROM task_evidence_history
    WHERE task_id = ? AND kind = ?
    ORDER BY recorded_at DESC, evidence_id DESC
  `).all(event.taskId, event.kind) as JsonRecord[]
  const retainedIds: string[] = []
  let bytes = 0
  for (const row of rows) {
    const evidenceId = stringValue(row.evidence_id)
    const recordedAt = stringValue(row.recorded_at)
    if (!evidenceId || !recordedAt) continue
    const candidate: TaskEvidenceEventRecord = {
      id: evidenceId,
      taskId: event.taskId,
      kind: event.kind,
      recordedAt,
      payload: parseJson<JsonRecord>(row.payload_json, {}),
    }
    const candidateBytes = historyRecordBytes(candidate)
    if (retainedIds.length >= retention.maxRecords) break
    // Keep one newest record even when a caller supplies a smaller byte budget;
    // this matches the existing bounded JSONL policy and preserves current proof.
    if (retainedIds.length > 0 && bytes + candidateBytes > retention.maxBytes) break
    retainedIds.push(evidenceId)
    bytes += candidateBytes
  }
  if (retainedIds.length === rows.length) return
  const placeholders = retainedIds.map(() => '?').join(', ')
  database.prepare(`
    DELETE FROM task_evidence_history
    WHERE task_id = ? AND kind = ? AND evidence_id NOT IN (${placeholders})
  `).run(event.taskId, event.kind, ...retainedIds)
}

function appendTaskEvidenceHistory(
  database: DatabaseSync,
  event: TaskEvidenceEventRecord,
  retention: ProjectStateDatabaseTaskEvidenceRetentionInput,
): void {
  database.prepare(`
    INSERT INTO task_evidence_history (task_id, kind, evidence_id, recorded_at, payload_json)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(task_id, kind, evidence_id) DO UPDATE SET
      recorded_at = excluded.recorded_at,
      payload_json = excluded.payload_json
  `).run(event.taskId, event.kind, event.id, event.recordedAt, json(event.payload))
  trimTaskEvidenceHistory(database, event, retention)
}

/**
 * Append one compact evidence record to proof, current evidence, and bounded
 * detail history in the same SQLite transaction. The retention argument is
 * intentionally supplied by the existing task evidence policy owner.
 */
export function appendProjectStateDatabaseTaskEvidence(
  projectRoot: string,
  event: TaskEvidenceEventRecord,
  retention: ProjectStateDatabaseTaskEvidenceRetentionInput,
): TaskEvidenceEventRecord {
  const durable = compactTaskEvidenceEvent(TaskEvidenceEvent.parse({ ...event }))
  const bounded = validateTaskEvidenceRetention(retention)
  withWritableDatabase(projectRoot, database => {
    upsertTaskProofAndCurrentEvidence(database, {
      id: durable.id,
      taskId: durable.taskId,
      kind: durable.kind,
      recordedAt: durable.recordedAt,
      payload: durable.payload,
    })
    appendTaskEvidenceHistory(database, durable, bounded)
    commitAuthoritativeMutation(database, {
      updatedAt: durable.recordedAt,
      domains: ['evidence'],
      // Evidence changes can alter proof blockers and release scope rows.
      // Mark this as an evidence projection so the projector reopens the
      // bounded current-evidence rows instead of taking the index-only path.
      projectionDomains: ['evidence'],
      projectRoot,
    })
  })
  return durable
}

/**
 * Import legacy evidence in one database transaction. The caller owns the
 * filesystem compatibility boundary; this function only establishes the
 * durable SQLite copy and leaves the authority marker unchanged.
 */
export function importProjectStateDatabaseTaskEvidence(
  projectRoot: string,
  events: readonly TaskEvidenceEventRecord[],
  retentionByKind: Readonly<Record<string, ProjectStateDatabaseTaskEvidenceRetentionInput>>,
): number {
  if (events.length === 0) return 0
  const compacted = events.map(event => {
    const durable = compactTaskEvidenceEvent(TaskEvidenceEvent.parse({ ...event }))
    const retention = retentionByKind[durable.kind]
    if (!retention) throw new Error(`Missing evidence retention policy for ${durable.kind}`)
    return { durable, retention: validateTaskEvidenceRetention(retention) }
  })
  withWritableDatabase(projectRoot, database => {
    for (const { durable, retention } of compacted) {
      upsertTaskProofAndCurrentEvidence(database, {
        id: durable.id,
        taskId: durable.taskId,
        kind: durable.kind,
        recordedAt: durable.recordedAt,
        payload: durable.payload,
      })
      appendTaskEvidenceHistory(database, durable, retention)
    }
    const updatedAt = compacted.reduce(
      (latest, { durable }) => durable.recordedAt > latest ? durable.recordedAt : latest,
      new Date().toISOString(),
    )
    commitAuthoritativeMutation(database, {
      updatedAt,
      domains: ['evidence'],
      projectRoot,
    })
  })
  return compacted.length
}

/**
 * Read bounded task evidence history without opening the legacy JSONL store.
 * A null result means this database predates the history table; an empty array
 * is a valid database-authoritative task with no retained history.
 */
export function readProjectStateDatabaseTaskEvidenceHistory(
  projectRoot: string,
  taskId: string,
  kind?: string,
): TaskEvidenceEventRecord[] | null {
  const databasePath = projectStateDatabasePath(projectRoot)
  try {
    statSync(databasePath)
  } catch {
    return null
  }
  const database = openDatabase(databasePath, { readOnly: true })
  try {
    if (!tableExists(database, 'task_evidence_history')) return null
    const rows = database.prepare(kind
      ? `
        SELECT task_id, kind, evidence_id, recorded_at, payload_json
        FROM task_evidence_history
        WHERE task_id = ? AND kind = ?
        ORDER BY recorded_at DESC, evidence_id DESC
        LIMIT ?
      `
      : `
        SELECT task_id, kind, evidence_id, recorded_at, payload_json
        FROM (
          SELECT task_id, kind, evidence_id, recorded_at, payload_json,
            ROW_NUMBER() OVER (
              PARTITION BY kind
              ORDER BY recorded_at DESC, evidence_id DESC
            ) AS kind_rank
          FROM task_evidence_history
          WHERE task_id = ?
        )
        WHERE kind_rank <= ?
        ORDER BY recorded_at DESC, evidence_id DESC
      `).all(...(kind
      ? [taskId, kind, MAX_TASK_EVIDENCE_HISTORY_RECORDS]
      : [taskId, MAX_TASK_EVIDENCE_HISTORY_RECORDS])) as JsonRecord[]
    return rows.flatMap(row => {
      const rowTaskId = stringValue(row.task_id)
      const rowKind = stringValue(row.kind)
      const id = stringValue(row.evidence_id)
      const recordedAt = stringValue(row.recorded_at)
      if (!rowTaskId || !rowKind || !id || !recordedAt) return []
      try {
        return [TaskEvidenceEvent.parse({
          id,
          taskId: rowTaskId,
          kind: rowKind,
          recordedAt,
          payload: parseJson<JsonRecord>(row.payload_json, {}),
        })]
      } catch {
        return []
      }
    }).sort((left, right) => left.recordedAt.localeCompare(right.recordedAt) || left.id.localeCompare(right.id))
  } finally {
    database.close()
  }
}

/** Read the complete bounded SQLite evidence ledger for a one-time migration. */
export function readProjectStateDatabaseTaskEvidenceHistoryAll(
  projectRoot: string,
): TaskEvidenceEventRecord[] | null {
  const databasePath = projectStateDatabasePath(projectRoot)
  try {
    statSync(databasePath)
  } catch {
    return null
  }
  const database = openDatabase(databasePath, { readOnly: true })
  try {
    if (!tableExists(database, 'task_evidence_history')) return null
    const rows = database.prepare(`
      SELECT task_id, kind, evidence_id, recorded_at, payload_json
      FROM task_evidence_history
      ORDER BY task_id ASC, kind ASC, recorded_at ASC, evidence_id ASC
    `).all() as JsonRecord[]
    return rows.flatMap(row => {
      const taskId = stringValue(row.task_id)
      const kind = stringValue(row.kind)
      const id = stringValue(row.evidence_id)
      const recordedAt = stringValue(row.recorded_at)
      if (!taskId || !kind || !id || !recordedAt) return []
      try {
        return [TaskEvidenceEvent.parse({
          id,
          taskId,
          kind,
          recordedAt,
          payload: parseJson<JsonRecord>(row.payload_json, {}),
        })]
      } catch {
        return []
      }
    })
  } finally {
    database.close()
  }
}

// Current state answers "what is true now?". It is not a miniaturized event
// ledger. Keep the latest useful facts per kind and leave the full sequence in
// the historical evidence files.
const CURRENT_EVIDENCE_MAX_BYTES = 12 * 1024
const CURRENT_EVIDENCE_PAYLOAD_MAX_BYTES = 2 * 1024

const CURRENT_EVIDENCE_KIND_LIMITS: Record<string, number> = {
  event: 1,
  // Keep the latest compact note for each operational source (worker,
  // reviewer, coordinator, ...). A single global latest note can hide the
  // reviewer decision behind a newer coordinator receipt and misroute work.
  note: 6,
  gate_result: 8,
  review_verdict: 8,
  adjudication: 4,
  escalation: 8,
  agent_issue: 8,
  merge_record: 1,
  completion_summary: 1,
  git_story: 2,
}

function currentEvidenceKindLimit(kind: string): number {
  return CURRENT_EVIDENCE_KIND_LIMITS[kind] ?? 2
}

function currentEvidenceIdentity(
  kind: string,
  payload: JsonRecord,
  recordedAt: string,
  fallbackId?: string,
): string {
  const identityKeys = kind === 'gate_result'
    ? ['gateId', 'command', 'name', 'id']
    : kind === 'review_verdict'
      ? ['reviewerId', 'reviewer', 'agentId', 'id']
      : kind === 'note'
        ? ['agentId', 'role']
      : ['id']
  for (const key of identityKeys) {
    const value = stringValue(payload[key])
    if (value) return `${kind}:${key}:${value}`
  }
  // Untagged notes have no reliable source identity. Collapse them to one
  // current note rather than allowing generic prose to grow the projection.
  if (kind === 'note') return 'note:unattributed'
  if (fallbackId) return `${kind}:event:${fallbackId}`
  return `${kind}:${recordedAt}`
}

function currentEvidenceRecord(input: ProjectStateDatabaseTaskProof): ProjectStateDatabaseTaskEvidenceCurrentRecord {
  const payload = isRecord(input.payload) ? input.payload : {}
  return {
    id: currentEvidenceIdentity(input.kind, payload, input.recordedAt, input.id),
    recordedAt: input.recordedAt,
    payload: compactCurrentEvidencePayload(input.kind, payload),
  }
}

function currentEvidenceEventsForTask(
  taskId: string,
  current: ProjectStateDatabaseTaskEvidenceCurrent,
): Array<{ kind: string; payload: JsonRecord }> {
  return Object.entries(current.byKind).flatMap(([kind, records]) => records.map(record => ({
    id: `${taskId}-current-${kind}-${record.id}`,
    taskId,
    kind,
    recordedAt: record.recordedAt,
    payload: record.payload,
  })))
}

/**
 * Keep the indexed task point's bounded proof answer in step with the
 * evidence transaction. The evidence table remains the source for current
 * proof details; `summary_json.currentSummary.proof` is only its small,
 * indexed read model and never contains the evidence history.
 */
function refreshIndexedTaskProofSummary(
  database: DatabaseSync,
  taskId: string,
  current: ProjectStateDatabaseTaskEvidenceCurrent,
): void {
  const detailRow = database.prepare(`
    SELECT work_items.summary_json, work_item_detail.payload_gzip
    FROM work_items
    LEFT JOIN work_item_detail ON work_item_detail.task_id = work_items.id
    WHERE work_items.id = ?
  `).get(taskId) as JsonRecord | undefined
  const detail = parseWorkItemDetail(detailRow?.payload_gzip)
  if (!detail) return
  const proof = summarizeCurrentProof({
    ...detail,
    evidence: currentEvidenceEventsForTask(taskId, current),
  })
  const summary = parseJson<JsonRecord>(detailRow?.summary_json, {})
  const currentSummary = isRecord(summary.currentSummary) ? summary.currentSummary : {}
  database.prepare('UPDATE work_items SET summary_json = ? WHERE id = ?').run(
    json({
      ...summary,
      currentSummary: {
        ...currentSummary,
        proof,
      },
    }),
    taskId,
  )
}

function compactCurrentEvidencePayload(kind: string, payload: JsonRecord): JsonRecord {
  const source = compactTaskEvidencePayload('event', payload)
  const keys = new Set([
    'id', 'taskId', 'kind', 'type', 'gateId', 'command', 'name', 'checkedAt',
    'reviewerId', 'reviewer', 'reviewerPath', 'decision', 'verdict', 'passed',
    'acceptedCriteriaIds', 'proofEvidenceIds', 'revisionItems', 'riskItems',
    'followUpItems', 'advisoryScores', 'failureCode',
    'recordedAt', 'timestamp', 'raisedAt', 'resolvedAt', 'status', 'reason', 'summary',
    'content', 'role', 'agentId', 'output', 'reasoning', 'score', 'failingSignals',
    'source', 'llmError', 'policyVersion', 'round', 'trigger', 'dissenters',
    'winningConcerns', 'supersededConcerns', 'rationale', 'scopeInstructions',
    'decidedBy', 'resolvedBy', 'resolution', 'mergedAt', 'branch',
    'fromBranch', 'toBranch', 'strategy', 'result', 'commit', 'commitSha',
    'prUrl', 'error', 'details', 'externalChecklist', 'completedAt', 'createdAt',
    'reopenedAt', 'reopenReason',
    'createdBy', 'retention', 'evidenceRefs',
    'recoveryCode',
    'structured',
    // Agent-issue evidence is current operational state, not a task
    // definition. Keep the fields needed to route and display it.
    'code', 'severity', 'detail', 'suggestedAction', 'broadcast',
  ])
  const selected = Object.fromEntries(Object.entries(source)
    .filter(([key, value]) => keys.has(key) && !(
      key === 'details' && typeof value === 'string' && value.length > 320
    ))
    .map(([key, value]) => [
      key,
      typeof value === 'string' && value.length > 640
        ? `${value.slice(0, 620)} [current evidence detail omitted]`
        : value,
    ]))
  if (serializedBytes(selected) <= CURRENT_EVIDENCE_PAYLOAD_MAX_BYTES) return selected

  const identityKeys = new Set([
    'id', 'taskId', 'kind', 'gateId', 'reviewerId', 'reviewer', 'decision',
    'verdict', 'passed', 'recordedAt', 'raisedAt', 'resolvedAt', 'status',
    'reason', 'summary', 'mergedAt', 'branch', 'commit', 'error',
    'recoveryCode',
  ])
  const compact = Object.fromEntries(Object.entries(selected)
    .filter(([key]) => identityKeys.has(key))
    .map(([key, value]) => [
      key,
      typeof value === 'string' && value.length > 256
        ? `${value.slice(0, 236)} [detail omitted]`
        : value,
    ]))
  if (serializedBytes(compact) <= CURRENT_EVIDENCE_PAYLOAD_MAX_BYTES) return compact
  return {
    ...Object.fromEntries(Object.entries(compact).filter(([key]) => [
      'id', 'taskId', 'gateId', 'reviewerId', 'decision', 'verdict',
      'passed', 'recordedAt', 'raisedAt', 'resolvedAt', 'status', 'summary',
      'recoveryCode',
    ].includes(key))),
    compacted: true,
    compactedKind: kind,
  }
}

export interface ProjectStateDatabaseEvidenceCompactionResult {
  taskProofRowsSeen: number
  taskProofRowsCompacted: number
  currentRowsSeen: number
  currentRowsCompacted: number
  bytesBefore: number
  bytesAfter: number
}

export interface ProjectStateDatabaseVacuumResult {
  databasePath: string
  bytesBefore: number
  bytesAfter: number
  vacuumed: boolean
}

/** Reclaim SQLite pages after an explicit content migration or compaction. */
export function vacuumProjectStateDatabase(
  projectRoot: string,
  options: { dryRun?: boolean } = {},
): ProjectStateDatabaseVacuumResult {
  const databasePath = projectStateDatabasePath(projectRoot)
  let bytesBefore = 0
  try {
    bytesBefore = statSync(databasePath).size
  } catch {
    return { databasePath, bytesBefore: 0, bytesAfter: 0, vacuumed: false }
  }
  if (options.dryRun === true) {
    return { databasePath, bytesBefore, bytesAfter: bytesBefore, vacuumed: false }
  }

  const database = openDatabase(databasePath)
  try {
    // VACUUM must run outside the transaction used by ordinary project-state
    // writes. This is an explicit maintenance boundary, never a read effect.
    database.exec('VACUUM')
  } finally {
    database.close()
  }
  let bytesAfter = bytesBefore
  try {
    bytesAfter = statSync(databasePath).size
  } catch {
    // Preserve the precondition evidence if another process removes the file
    // before the postcondition check.
  }
  return { databasePath, bytesBefore, bytesAfter, vacuumed: true }
}

/** Compact legacy proof payloads already copied into SQLite. */
export function compactProjectStateDatabaseEvidence(
  projectRoot: string,
  options: { dryRun?: boolean } = {},
): ProjectStateDatabaseEvidenceCompactionResult {
  const result: ProjectStateDatabaseEvidenceCompactionResult = {
    taskProofRowsSeen: 0,
    taskProofRowsCompacted: 0,
    currentRowsSeen: 0,
    currentRowsCompacted: 0,
    bytesBefore: 0,
    bytesAfter: 0,
  }
  withDatabase(projectRoot, database => {
    if (tableExists(database, 'task_proof')) {
      const rows = database.prepare(`
        SELECT task_id, latest_kind, payload_json
        FROM task_proof
      `).all() as JsonRecord[]
      const update = database.prepare('UPDATE task_proof SET payload_json = ? WHERE task_id = ?')
      for (const row of rows) {
        const taskId = stringValue(row.task_id)
        if (!taskId) continue
        const before = typeof row.payload_json === 'string' ? row.payload_json : '{}'
        const kind = stringValue(row.latest_kind) ?? 'event'
        const payload = compactTaskEvidencePayload(
          kind as Parameters<typeof compactTaskEvidencePayload>[0],
          parseJson<JsonRecord>(before, {}),
        )
        const after = json(payload)
        result.taskProofRowsSeen += 1
        result.bytesBefore += Buffer.byteLength(before, 'utf8')
        result.bytesAfter += Buffer.byteLength(after, 'utf8')
        if (after !== before) {
          result.taskProofRowsCompacted += 1
          if (options.dryRun !== true) update.run(after, taskId)
        }
      }
    }
    if (tableExists(database, 'task_evidence_current')) {
      const rows = database.prepare(`
        SELECT task_id, updated_at, payload_json
        FROM task_evidence_current
      `).all() as JsonRecord[]
      const update = database.prepare('UPDATE task_evidence_current SET payload_json = ? WHERE task_id = ?')
      for (const row of rows) {
        const taskId = stringValue(row.task_id)
        if (!taskId) continue
        const before = typeof row.payload_json === 'string' ? row.payload_json : '{}'
        const next = normalizeCurrentEvidence(
          taskId,
          stringValue(row.updated_at) ?? '',
          parseJson<JsonRecord>(before, {}),
        )
        const after = json(next)
        result.currentRowsSeen += 1
        result.bytesBefore += Buffer.byteLength(before, 'utf8')
        result.bytesAfter += Buffer.byteLength(after, 'utf8')
        if (after !== before) {
          result.currentRowsCompacted += 1
          if (options.dryRun !== true) update.run(after, taskId)
        }
      }
    }
  })
  return result
}

function normalizeCurrentEvidence(
  taskId: string,
  updatedAt: string,
  value: unknown,
): ProjectStateDatabaseTaskEvidenceCurrent {
  const record = isRecord(value) ? value : {}
  const rawByKind = isRecord(record.byKind) ? record.byKind : {}
  const byKind: Record<string, ProjectStateDatabaseTaskEvidenceCurrentRecord[]> = {}
  for (const [kind, entries] of Object.entries(rawByKind)) {
    if (!Array.isArray(entries)) continue
    const valid = entries.flatMap(entry => {
      if (!isRecord(entry) || typeof entry.recordedAt !== 'string' || !isRecord(entry.payload)) return []
      return [{
        id: typeof entry.id === 'string' && entry.id.startsWith(`${kind}:event:`)
          ? entry.id
          : currentEvidenceIdentity(kind, entry.payload, entry.recordedAt),
        recordedAt: entry.recordedAt,
        payload: compactCurrentEvidencePayload(kind, entry.payload),
      }]
    })
    const newestById = new Map(valid.map(entry => [entry.id, entry]))
    const newest = [...newestById.values()].sort((left, right) => right.recordedAt.localeCompare(left.recordedAt))
    if (newest.length > 0) byKind[kind] = newest.slice(0, currentEvidenceKindLimit(kind))
  }
  return trimCurrentEvidence({ taskId, updatedAt, version: 1, byKind })
}

function trimCurrentEvidence(value: ProjectStateDatabaseTaskEvidenceCurrent): ProjectStateDatabaseTaskEvidenceCurrent {
  let next: ProjectStateDatabaseTaskEvidenceCurrent = {
    ...value,
    byKind: Object.fromEntries(Object.entries(value.byKind).map(([kind, records]) => [
      kind,
      records
        .map(record => ({ ...record, payload: compactCurrentEvidencePayload(kind, record.payload) }))
        .slice(0, currentEvidenceKindLimit(kind)),
    ])),
  }
  if (Buffer.byteLength(json(next), 'utf8') <= CURRENT_EVIDENCE_MAX_BYTES) return next
  const byKind = Object.fromEntries(Object.entries(next.byKind).map(([kind, records]) => [kind, [...records]]))
  while (Buffer.byteLength(json({ ...next, byKind }), 'utf8') > CURRENT_EVIDENCE_MAX_BYTES) {
    const candidate = Object.entries(byKind)
      .filter(([, records]) => records.length > 1)
      .sort((left, right) => right[1].length - left[1].length)[0]
    if (!candidate) break
    candidate[1].pop()
  }
  return { ...next, byKind }
}

function currentEvidenceForTaskIds(
  database: DatabaseSync,
  taskIds: readonly string[],
): Map<string, ProjectStateDatabaseTaskEvidenceCurrent> {
  const ids = [...new Set(taskIds.filter(id => id.trim().length > 0))]
  if (ids.length === 0 || !tableExists(database, 'task_evidence_current')) return new Map()
  const placeholders = ids.map(() => '?').join(', ')
  const rows = database.prepare(`
    SELECT task_id, updated_at, payload_json
    FROM task_evidence_current
    WHERE task_id IN (${placeholders})
  `).all(...ids) as JsonRecord[]
  return new Map(rows.flatMap(row => {
    const taskId = stringValue(row.task_id)
    if (!taskId) return []
    return [[taskId, normalizeCurrentEvidence(
      taskId,
      stringValue(row.updated_at) ?? '',
      parseStoredJson<JsonRecord>(row.payload_json, `current evidence for task ${taskId}`),
    )] as const]
  }))
}

function summaryEvidenceTaskIds(value: unknown): string[] {
  if (!isRecord(value)) return []
  const ids = new Set<string>()
  for (const key of ['recentWork', 'inFlight']) {
    const records = value[key]
    if (!Array.isArray(records)) continue
    for (const record of records) {
      if (isRecord(record) && typeof record.taskId === 'string' && record.taskId.trim().length > 0) {
        ids.add(record.taskId)
      }
    }
  }
  return [...ids].slice(0, 100)
}

function upsertCurrentTaskEvidence(
  database: DatabaseSync,
  input: ProjectStateDatabaseTaskProof,
): void {
  const existing = tableExists(database, 'task_evidence_current')
    ? database.prepare('SELECT updated_at, payload_json FROM task_evidence_current WHERE task_id = ?').get(input.taskId) as JsonRecord | undefined
    : undefined
  const current = normalizeCurrentEvidence(input.taskId, input.recordedAt, parseJson(existing?.payload_json, {}))
  const record = currentEvidenceRecord(input)
  const entries = [...(current.byKind[input.kind] ?? []), record]
  const byId = new Map(entries.map(entry => [entry.id, entry]))
  const next = trimCurrentEvidence({
    taskId: input.taskId,
    updatedAt: input.recordedAt > current.updatedAt ? input.recordedAt : current.updatedAt,
    version: 1,
    byKind: {
      ...current.byKind,
      [input.kind]: [...byId.values()]
        .sort((left, right) => right.recordedAt.localeCompare(left.recordedAt))
        .slice(0, currentEvidenceKindLimit(input.kind)),
    },
  })
  refreshIndexedTaskProofSummary(database, input.taskId, next)
  database.prepare(`
    INSERT INTO task_evidence_current (task_id, updated_at, payload_json)
    VALUES (?, ?, ?)
    ON CONFLICT(task_id) DO UPDATE SET
      updated_at = excluded.updated_at,
      payload_json = excluded.payload_json
  `).run(input.taskId, next.updatedAt, json(next))
}

export function upsertProjectStateDatabaseExecution(
  projectRoot: string,
  input: ProjectStateDatabaseExecution,
): void {
  withDatabase(projectRoot, database => {
    database.prepare(`
      INSERT INTO current_execution (
        id, status, mode, started_at, stopped_at, stop_requested_at, error,
        updated_at, payload_json
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status, mode = excluded.mode, started_at = excluded.started_at,
        stopped_at = excluded.stopped_at, stop_requested_at = excluded.stop_requested_at,
        error = excluded.error, updated_at = excluded.updated_at,
        payload_json = excluded.payload_json
    `).run(input.status, input.mode ?? null, input.startedAt ?? null, input.stoppedAt ?? null, input.stopRequestedAt ?? null, input.error ?? null, input.updatedAt, json(input.payload ?? input))
    commitAuthoritativeMutation(database, {
      updatedAt: input.updatedAt,
      domains: ['execution'],
      projectRoot,
    })
  })
}

export function upsertProjectStateDatabaseRuntime(
  projectRoot: string,
  input: ProjectStateDatabaseRuntime,
): void {
  withDatabase(projectRoot, database => {
    database.prepare(`
      INSERT INTO current_runtime (id, status, health, last_activity_at, updated_at, payload_json)
      VALUES (1, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET status = excluded.status, health = excluded.health,
        last_activity_at = excluded.last_activity_at, updated_at = excluded.updated_at,
        payload_json = excluded.payload_json
    `).run(input.status, input.health ?? null, input.lastActivityAt ?? null, input.updatedAt, json(input.payload ?? input))
    commitAuthoritativeMutation(database, {
      updatedAt: input.updatedAt,
      domains: ['runtime'],
      projectRoot,
    })
  })
}

export function upsertProjectStateDatabaseOwnerInput(
  projectRoot: string,
  input: ProjectStateDatabaseOwnerInput,
): void {
  withDatabase(projectRoot, database => {
    database.prepare(`
      INSERT INTO owner_inputs (id, status, task_id, prompt, updated_at, payload_json)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET status = excluded.status, task_id = excluded.task_id,
        prompt = excluded.prompt, updated_at = excluded.updated_at, payload_json = excluded.payload_json
    `).run(input.id, input.status, input.taskId ?? null, input.prompt, input.updatedAt, json(compactOwnerInputPayload(input.payload ?? input)))
    const revision = commitAuthoritativeMutation(database, {
      updatedAt: input.updatedAt,
      domains: ['owner-input'],
      projectRoot,
      summaryFreshness: 'preserve',
    })
    markProjectionCurrent(database, 'owner-input', revision, input.updatedAt)
    advancePreservedSummaryRevision(database, revision)
    stripStoredOwnerInputSummary(database)
  })
}

/**
 * Replace the compact open owner-input queue in one transaction. The JSON
 * request files remain the detail/history source; this table is only the
 * current queue used by summaries and readiness reads.
 */
export function replaceProjectStateDatabaseOwnerInputs(
  projectRoot: string,
  inputs: readonly ProjectStateDatabaseOwnerInput[],
): void {
  withDatabase(projectRoot, database => {
    const next = [...inputs]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(input => ({
        id: input.id,
        status: input.status,
        taskId: input.taskId ?? null,
        prompt: input.prompt,
        updatedAt: input.updatedAt,
        payloadJson: json(compactOwnerInputPayload(input.payload ?? input)),
      }))
    const existing = (database.prepare('SELECT id, status, task_id, prompt, updated_at, payload_json FROM owner_inputs ORDER BY id').all() as JsonRecord[])
      .map(row => ({
        id: String(row.id),
        status: String(row.status),
        taskId: row.task_id === null ? null : String(row.task_id),
        prompt: String(row.prompt),
        updatedAt: String(row.updated_at),
        payloadJson: String(row.payload_json),
      }))
    const nextById = new Map(next.map(input => [input.id, input]))
    const existingById = new Map(existing.map(input => [input.id, input]))
    for (const input of existing) {
      if (!nextById.has(input.id)) database.prepare('DELETE FROM owner_inputs WHERE id = ?').run(input.id)
    }
    const upsert = database.prepare(`
      INSERT INTO owner_inputs (id, status, task_id, prompt, updated_at, payload_json)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        task_id = excluded.task_id,
        prompt = excluded.prompt,
        updated_at = excluded.updated_at,
        payload_json = excluded.payload_json
    `)
    for (const input of next) {
      const prior = existingById.get(input.id)
      if (prior &&
        prior.status === input.status &&
        prior.taskId === input.taskId &&
        prior.prompt === input.prompt &&
        prior.updatedAt === input.updatedAt &&
        prior.payloadJson === input.payloadJson) continue
      upsert.run(input.id, input.status, input.taskId, input.prompt, input.updatedAt, input.payloadJson)
    }
    const updatedAt = next.reduce((latest, input) => input.updatedAt > latest ? input.updatedAt : latest, new Date().toISOString())
    const revision = commitAuthoritativeMutation(database, {
      updatedAt,
      domains: ['owner-input'],
      projectRoot,
      summaryFreshness: 'preserve',
    })
    markProjectionCurrent(database, 'owner-input', revision, updatedAt)
    advancePreservedSummaryRevision(database, revision)
    stripStoredOwnerInputSummary(database)
  })
}

export function upsertProjectStateDatabaseRepository(
  projectRoot: string,
  input: ProjectStateDatabaseRepository,
): void {
  withDatabase(projectRoot, database => {
    database.prepare(`
      INSERT INTO repositories (id, root, branch, head, status, freshness, inspected_at, payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET root = excluded.root, branch = excluded.branch,
        head = excluded.head, status = excluded.status, freshness = excluded.freshness,
        inspected_at = excluded.inspected_at, payload_json = excluded.payload_json
    `).run(input.id, input.root, input.branch ?? null, input.head ?? null, input.status ?? null, input.freshness, input.inspectedAt ?? null, json(input.payload ?? input))
    commitAuthoritativeMutation(database, {
      updatedAt: input.inspectedAt ?? new Date().toISOString(),
      domains: ['repository'],
      projectRoot,
    })
  })
}

/**
 * Replace the bounded repository observation set in one transaction. Git is
 * inspected outside this module; this writer owns the durable current-state
 * boundary and advances the project revision once for the whole workspace.
 */
export function replaceProjectStateDatabaseRepositories(
  projectRoot: string,
  inputs: readonly ProjectStateDatabaseRepository[],
): void {
  withDatabase(projectRoot, database => {
    if (!tableExists(database, 'repositories')) return
    const next = [...inputs]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(input => ({
        id: input.id,
        root: input.root,
        branch: input.branch ?? null,
        head: input.head ?? null,
        status: input.status ?? null,
        freshness: input.freshness,
        inspectedAt: input.inspectedAt ?? null,
        payloadJson: json(input.payload ?? input),
      }))
    const existing = (database.prepare(`
      SELECT id, root, branch, head, status, freshness, inspected_at, payload_json
      FROM repositories ORDER BY id
    `).all() as JsonRecord[]).map(row => ({
      id: String(row.id),
      root: String(row.root),
      branch: row.branch === null ? null : String(row.branch),
      head: row.head === null ? null : String(row.head),
      status: row.status === null ? null : String(row.status),
      freshness: String(row.freshness),
      inspectedAt: row.inspected_at === null ? null : String(row.inspected_at),
      payloadJson: String(row.payload_json),
    }))
    const existingSemantic = existing.map(({ inspectedAt: _inspectedAt, ...repository }) => repository)
    const nextSemantic = next.map(({ inspectedAt: _inspectedAt, ...repository }) => repository)
    if (JSON.stringify(existingSemantic) === JSON.stringify(nextSemantic)) {
      // Observation time is freshness metadata, not a project-state fact. Keep
      // it current without advancing the shared revision or invalidating every
      // derived projection on every scheduler tick.
      const updateObservedAt = database.prepare('UPDATE repositories SET inspected_at = ? WHERE id = ?')
      for (const input of next) {
        const prior = existing.find(repository => repository.id === input.id)
        if (prior?.inspectedAt !== input.inspectedAt) {
          updateObservedAt.run(input.inspectedAt, input.id)
        }
      }
      return
    }

    database.prepare('DELETE FROM repositories').run()
    const insert = database.prepare(`
      INSERT INTO repositories (id, root, branch, head, status, freshness, inspected_at, payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const input of next) {
      insert.run(
        input.id,
        input.root,
        input.branch,
        input.head,
        input.status,
        input.freshness,
        input.inspectedAt,
        input.payloadJson,
      )
    }
    const updatedAt = next.reduce(
      (latest, input) => input.inspectedAt && input.inspectedAt > latest ? input.inspectedAt : latest,
      new Date().toISOString(),
    )
    commitAuthoritativeMutation(database, {
      updatedAt,
      domains: ['repository'],
      projectRoot,
    })
  })
}

function projectStateDatabaseRepositoryFromRow(row: JsonRecord): ProjectStateDatabaseRepository {
  return {
    id: String(row.id),
    root: String(row.root),
    ...(row.branch === null ? {} : { branch: String(row.branch) }),
    ...(row.head === null ? {} : { head: String(row.head) }),
    ...(row.status === null ? {} : { status: String(row.status) }),
    freshness: row.freshness === 'current' || row.freshness === 'stale' ? row.freshness : 'unknown',
    ...(row.inspected_at === null ? {} : { inspectedAt: String(row.inspected_at) }),
    payload: parseJson(row.payload_json, {}),
  }
}

function readProjectStateDatabaseRepositoriesFromDatabase(
  database: DatabaseSync,
): ProjectStateDatabaseRepository[] {
  if (!tableExists(database, 'repositories')) return []
  return (database.prepare(`
    SELECT id, root, branch, head, status, freshness, inspected_at, payload_json
    FROM repositories
    ORDER BY id
  `).all() as JsonRecord[]).map(projectStateDatabaseRepositoryFromRow)
}

/**
 * Read the bounded current repository snapshots without inspecting Git.
 * Missing tables are a normal compatibility state for pre-projection
 * databases, so the reader returns an empty list instead of creating state.
 */
function readProjectStateDatabaseRepositoriesAtPath(databasePath: string): ProjectStateDatabaseRepository[] {
  try {
    statSync(databasePath)
  } catch {
    return []
  }
  const database = openDatabase(databasePath, { readOnly: true })
  try {
    return readProjectStateDatabaseRepositoriesFromDatabase(database)
  } finally {
    database.close()
  }
}

export function readProjectStateDatabaseRepositories(projectRoot: string): ProjectStateDatabaseRepository[] {
  return readProjectStateDatabaseRepositoriesAtPath(projectStateDatabasePath(projectRoot))
}

export function readProjectStateDatabaseRepositoriesFromTasksPath(tasksPath: string): ProjectStateDatabaseRepository[] {
  return readProjectStateDatabaseRepositoriesAtPath(projectStateDatabasePathFromTasksPath(tasksPath))
}

/** Read one current repository snapshot by its stable projection id. */
export function readProjectStateDatabaseRepository(
  projectRoot: string,
  repositoryId: string,
): ProjectStateDatabaseRepository | null {
  const databasePath = projectStateDatabasePath(projectRoot)
  try {
    statSync(databasePath)
  } catch {
    return null
  }
  const database = openDatabase(databasePath, { readOnly: true })
  try {
    if (!tableExists(database, 'repositories')) return null
    const row = database.prepare(`
      SELECT id, root, branch, head, status, freshness, inspected_at, payload_json
      FROM repositories
      WHERE id = ?
    `).get(repositoryId) as JsonRecord | undefined
    return row ? projectStateDatabaseRepositoryFromRow(row) : null
  } finally {
    database.close()
  }
}

function boundedDiagnosticText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, PROJECT_STATE_DATABASE_DIAGNOSTIC_MAX_TEXT_LENGTH) : undefined
}

function boundedDiagnosticCount(value: unknown): number {
  const count = Number(value)
  if (!Number.isFinite(count) || count < 0) return 0
  return Math.min(Math.trunc(count), 1_000_000)
}

function normalizeDiagnosticBlocker(value: unknown): ProjectStateDatabaseDiagnosticBlocker | null {
  if (!isRecord(value)) return null
  const id = boundedDiagnosticText(value.id)
  const label = boundedDiagnosticText(value.label)
  if (!id || !label) return null
  const blocker: ProjectStateDatabaseDiagnosticBlocker = { id, label }
  const optionalFields = ['state', 'reason', 'nextAction', 'repoId', 'taskId'] as const
  for (const field of optionalFields) {
    const text = boundedDiagnosticText(value[field])
    if (text) blocker[field] = text
  }
  return blocker
}

function normalizeGitDiagnosticObservation(value: unknown): ProjectStateDatabaseGitDiagnosticObservation | null {
  if (!isRecord(value)) return null
  const blockers = Array.isArray(value.blockers)
    ? value.blockers.flatMap(item => {
        const blocker = normalizeDiagnosticBlocker(item)
        return blocker ? [blocker] : []
      }).slice(0, PROJECT_STATE_DATABASE_DIAGNOSTIC_MAX_BLOCKERS)
    : []
  return {
    ready: value.ready === true,
    state: boundedDiagnosticText(value.state) ?? 'unknown',
    blockerCount: boundedDiagnosticCount(value.blockerCount),
    blockers,
  }
}

function normalizeReadinessDiagnosticObservation(value: unknown): ProjectStateDatabaseReadinessDiagnosticObservation | null {
  if (!isRecord(value)) return null
  const blockers = Array.isArray(value.blockers)
    ? value.blockers.flatMap(item => {
        const blocker = normalizeDiagnosticBlocker(item)
        return blocker ? [blocker] : []
      }).slice(0, PROJECT_STATE_DATABASE_DIAGNOSTIC_MAX_BLOCKERS)
    : null
  return {
    ready: value.ready === true,
    code: boundedDiagnosticText(value.code) ?? null,
    message: boundedDiagnosticText(value.message) ?? null,
    blockerCount: boundedDiagnosticCount(value.blockerCount),
    unfinishedCount: boundedDiagnosticCount(value.unfinishedCount),
    ...(blockers !== null ? { blockers } : {}),
  }
}

function normalizeDiagnosticProjectionSnapshot(
  snapshot: ProjectStateDatabaseDiagnosticProjectionSnapshot,
): ProjectStateDatabaseDiagnosticProjectionSnapshot {
  if (!Number.isInteger(snapshot.sourceRevision) || snapshot.sourceRevision < 0) {
    throw new RangeError('Diagnostic projections require a non-negative integer source revision')
  }
  if (snapshot.freshness !== 'current' && snapshot.freshness !== 'stale') {
    throw new RangeError('Diagnostic projections require current or stale freshness')
  }
  const generatedAt = boundedDiagnosticText(snapshot.generatedAt)
  if (!generatedAt) throw new Error('Diagnostic projections require a generatedAt timestamp')
  const normalized: ProjectStateDatabaseDiagnosticProjectionSnapshot = {
    sourceRevision: snapshot.sourceRevision,
    freshness: snapshot.freshness,
    generatedAt,
    git: normalizeGitDiagnosticObservation(snapshot.git),
    readiness: normalizeReadinessDiagnosticObservation(snapshot.readiness),
  }
  if (serializedBytes(normalized) > PROJECT_STATE_DATABASE_DIAGNOSTIC_MAX_BYTES) {
    throw new RangeError('Diagnostic projection exceeds its bounded storage budget')
  }
  return normalized
}

function diagnosticProjectionFromRow(row: JsonRecord): ProjectStateDatabaseDiagnosticProjection | null {
  const sourceRevision = Number(row.source_revision)
  const updatedAt = boundedDiagnosticText(row.updated_at)
  const generatedAt = boundedDiagnosticText(row.generated_at)
  if (!Number.isInteger(sourceRevision) || sourceRevision < 0 || !updatedAt || !generatedAt) return null
  const freshness = row.freshness === 'current' || row.freshness === 'stale' ? row.freshness : null
  if (!freshness) return null
  const snapshot = normalizeDiagnosticProjectionSnapshot({
    sourceRevision,
    freshness,
    generatedAt,
    git: normalizeGitDiagnosticObservation(row.git_json === null ? null : parseJson<unknown>(row.git_json, null)),
    readiness: normalizeReadinessDiagnosticObservation(row.readiness_json === null ? null : parseJson<unknown>(row.readiness_json, null)),
  })
  return { ...snapshot, updatedAt }
}

/** Read the latest bounded Git/readiness diagnostic without inspecting the project. */
function readProjectStateDatabaseDiagnosticProjectionFromDatabase(
  database: DatabaseSync,
): ProjectStateDatabaseDiagnosticProjection | null {
  if (!tableExists(database, 'project_diagnostics')) return null
  const row = database.prepare(`
      SELECT source_revision, freshness, generated_at, updated_at, git_json, readiness_json
      FROM project_diagnostics
      WHERE id = 1
    `).get() as JsonRecord | undefined
  const projection = row ? diagnosticProjectionFromRow(row) : null
  if (!projection || projection.sourceRevision >= currentRevision(database)) return projection
  return { ...projection, freshness: 'stale' }
}

export function readProjectStateDatabaseDiagnosticProjection(
  projectRoot: string,
): ProjectStateDatabaseDiagnosticProjection | null {
  const databasePath = projectStateDatabasePath(projectRoot)
  try {
    statSync(databasePath)
  } catch {
    return null
  }
  const database = openDatabase(databasePath, { readOnly: true })
  try {
    return readProjectStateDatabaseDiagnosticProjectionFromDatabase(database)
  } finally {
    database.close()
  }
}

/** Persist one revision-matched diagnostic observation and its freshness. */
export function writeProjectStateDatabaseDiagnosticProjection(
  projectRoot: string,
  input: ProjectStateDatabaseDiagnosticProjectionSnapshot,
  options: ProjectStateDatabaseDiagnosticProjectionWriteOptions = {},
): boolean {
  const snapshot = normalizeDiagnosticProjectionSnapshot(input)
  let written = false
  withWritableDatabase(projectRoot, database => {
    const projectRevision = currentRevision(database)
    if (snapshot.sourceRevision > projectRevision) {
      throw new RangeError('Diagnostic projection cannot be ahead of the current project revision')
    }
    if (snapshot.freshness === 'current' && snapshot.sourceRevision !== projectRevision) {
      throw new RangeError('Current diagnostic projections must match the current project revision')
    }
    const existing = database.prepare(`
      SELECT source_revision, freshness
      FROM project_diagnostics
      WHERE id = 1
    `).get() as JsonRecord | undefined
    const existingRevision = existing ? Number(existing.source_revision) : null
    if (
      existingRevision !== null && (
        existingRevision > snapshot.sourceRevision ||
        (existingRevision === snapshot.sourceRevision && existing?.freshness === 'current' && snapshot.freshness === 'stale')
      )
    ) return

    const updatedAt = boundedDiagnosticText(options.updatedAt) ?? new Date().toISOString()
    database.prepare(`
      INSERT INTO project_diagnostics (
        id, source_revision, freshness, generated_at, updated_at, git_json, readiness_json
      ) VALUES (1, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        source_revision = excluded.source_revision,
        freshness = excluded.freshness,
        generated_at = excluded.generated_at,
        updated_at = excluded.updated_at,
        git_json = excluded.git_json,
        readiness_json = excluded.readiness_json
    `).run(
      snapshot.sourceRevision,
      snapshot.freshness,
      snapshot.generatedAt,
      updatedAt,
      snapshot.git === null ? null : json(snapshot.git),
      snapshot.readiness === null ? null : json(snapshot.readiness),
    )
    markProjectionCurrent(
      database,
      PROJECT_STATE_DATABASE_DIAGNOSTIC_PROJECTION_DOMAIN,
      snapshot.sourceRevision,
      updatedAt,
    )
    written = true
  })
  return written
}

function readProjectStateDatabaseMemoryHealthFromDatabase<T = unknown>(
  database: DatabaseSync,
): ProjectStateDatabaseMemoryHealthProjection<T> | null {
  if (!tableExists(database, 'memory_health')) return null
  const row = database.prepare(`
    SELECT source_revision, freshness, generated_at, payload_json
    FROM memory_health
    WHERE id = 1
  `).get() as JsonRecord | undefined
  if (!row) return null
  const sourceRevision = Number(row.source_revision)
  const generatedAt = typeof row.generated_at === 'string' ? row.generated_at : ''
  const freshness = row.freshness === 'current' || row.freshness === 'stale' ? row.freshness : null
  if (!Number.isInteger(sourceRevision) || sourceRevision < 0 || !generatedAt || !freshness) return null
  return {
    sourceRevision,
    freshness: sourceRevision < currentRevision(database) ? 'stale' : freshness,
    generatedAt,
    payload: parseJson<T>(row.payload_json, null as T),
  }
}

/** Read only the saved, bounded memory-health projection. */
export function readProjectStateDatabaseMemoryHealth<T = unknown>(
  projectRoot: string,
): ProjectStateDatabaseMemoryHealthProjection<T> | null {
  const databasePath = projectStateDatabasePath(projectRoot)
  try {
    statSync(databasePath)
  } catch {
    return null
  }
  const database = openDatabase(databasePath, { readOnly: true })
  try {
    return readProjectStateDatabaseMemoryHealthFromDatabase<T>(database)
  } finally {
    database.close()
  }
}

/** Persist one revision-matched memory-health observation. */
export function writeProjectStateDatabaseMemoryHealth<T = unknown>(
  projectRoot: string,
  input: ProjectStateDatabaseMemoryHealthProjection<T>,
): boolean {
  if (!Number.isInteger(input.sourceRevision) || input.sourceRevision < 0) {
    throw new RangeError('Memory-health projections require a non-negative source revision')
  }
  if (!input.generatedAt.trim()) throw new Error('Memory-health projections require a generatedAt timestamp')
  const payloadJson = json(input.payload)
  if (serializedBytes(input.payload) > 64 * 1024) {
    throw new RangeError('Memory-health projection exceeds its bounded storage budget')
  }
  let written = false
  withWritableDatabase(projectRoot, database => {
    const projectRevision = currentRevision(database)
    if (input.sourceRevision > projectRevision) {
      throw new RangeError('Memory-health projection cannot be ahead of the current project revision')
    }
    if (input.freshness === 'current' && input.sourceRevision !== projectRevision) {
      throw new RangeError('Current memory-health projections must match the current project revision')
    }
    const existing = database.prepare(`
      SELECT source_revision, freshness
      FROM memory_health
      WHERE id = 1
    `).get() as JsonRecord | undefined
    const existingRevision = existing ? Number(existing.source_revision) : null
    if (
      existingRevision !== null && (
        existingRevision > input.sourceRevision ||
        (existingRevision === input.sourceRevision && existing?.freshness === 'current' && input.freshness === 'stale')
      )
    ) return
    database.prepare(`
      INSERT INTO memory_health (id, source_revision, freshness, generated_at, payload_json)
      VALUES (1, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        source_revision = excluded.source_revision,
        freshness = excluded.freshness,
        generated_at = excluded.generated_at,
        payload_json = excluded.payload_json
    `).run(input.sourceRevision, input.freshness, input.generatedAt, payloadJson)
    markProjectionCurrent(
      database,
      PROJECT_STATE_DATABASE_MEMORY_HEALTH_PROJECTION_DOMAIN,
      input.sourceRevision,
      input.generatedAt,
    )
    written = true
  })
  return written
}

export function markProjectStateDatabaseStale(projectRoot: string): number | null {
  let revision: number | null = null
  withDatabase(projectRoot, database => {
    if (!tableExists(database, 'project_meta') || !tableExists(database, 'project_summary')) return
    const now = new Date().toISOString()
    revision = bumpRevision(database, now)
    database.prepare("UPDATE project_summary SET freshness = 'stale', revision = ? WHERE id = 1").run(revision)
    recordProjectionJobs(database, DEFAULT_AUTHORITATIVE_PROJECTION_DOMAINS, revision, now)
  })
  return revision
}

/**
 * Point-read the current task overlay without opening a compatibility JSON
 * store or replaying evidence history. `null` means this project has not
 * reached the database boundary yet; an empty object means it has no overlay.
 */
export function readProjectStateDatabaseTaskOverlay(
  projectRoot: string,
  taskId: string,
): ProjectStateDatabaseTaskOverlay | null {
  const databasePath = projectStateDatabasePath(projectRoot)
  try {
    statSync(databasePath)
  } catch {
    return null
  }
  const database = openDatabase(databasePath, { readOnly: true })
  try {
    return readProjectStateDatabaseTaskOverlayFromDatabase(database, taskId)
  } finally {
    database.close()
  }
}

/** Read every current overlay for one task from the caller's existing snapshot. */
function readProjectStateDatabaseTaskOverlayFromDatabase(
  database: DatabaseSync,
  taskId: string,
): ProjectStateDatabaseTaskOverlay | null {
  // A normalized queue is the current-state authority. Missing normalized
  // overlay tables mean this project has not crossed the boundary yet.
  if (!['task_execution', 'task_workspace', 'task_proof', 'task_evidence_current'].every(table => tableExists(database, table))) return null
  const runtime = database.prepare('SELECT updated_at, payload_json FROM task_execution WHERE task_id = ?').get(taskId) as JsonRecord | undefined
  const workspace = database.prepare('SELECT updated_at, payload_json FROM task_workspace WHERE task_id = ?').get(taskId) as JsonRecord | undefined
  const proof = database.prepare('SELECT latest_kind, latest_recorded_at, result, payload_json FROM task_proof WHERE task_id = ?').get(taskId) as JsonRecord | undefined
  const current = database.prepare('SELECT updated_at, payload_json FROM task_evidence_current WHERE task_id = ?').get(taskId) as JsonRecord | undefined
  return {
    ...(runtime ? {
      runtime: {
        taskId,
        updatedAt: stringValue(runtime.updated_at) ?? undefined,
        payload: parseStoredJson(runtime.payload_json, `runtime overlay for task ${taskId}`),
      },
    } : {}),
    ...(workspace ? {
      workspace: {
        taskId,
        updatedAt: stringValue(workspace.updated_at) ?? undefined,
        payload: parseStoredJson(workspace.payload_json, `workspace overlay for task ${taskId}`),
      },
    } : {}),
    ...(proof ? {
      latestProof: {
        taskId,
        kind: stringValue(proof.latest_kind) ?? 'event',
        recordedAt: stringValue(proof.latest_recorded_at) ?? '',
        result: stringValue(proof.result),
        payload: parseStoredJson(proof.payload_json, `proof overlay for task ${taskId}`),
      },
    } : {}),
    ...(current ? {
      evidenceCurrent: normalizeCurrentEvidence(
        taskId,
        stringValue(current.updated_at) ?? '',
        parseStoredJson(current.payload_json, `current evidence for task ${taskId}`),
      ),
    } : {}),
  }
}

export function readProjectStateDatabaseTaskEvidenceCurrent(
  projectRoot: string,
  taskId: string,
): ProjectStateDatabaseTaskEvidenceCurrent | null {
  const databasePath = projectStateDatabasePath(projectRoot)
  try {
    statSync(databasePath)
  } catch {
    return null
  }
  const database = openDatabase(databasePath, { readOnly: true })
  try {
    if (!tableExists(database, 'task_evidence_current')) {
      if (readProjectStateDatabaseAuthorityFromDatabase(database) === 'database') {
        throw new Error('Normalized current task evidence is unavailable for promoted project')
      }
      return null
    }
    const row = database.prepare('SELECT updated_at, payload_json FROM task_evidence_current WHERE task_id = ?').get(taskId) as JsonRecord | undefined
    if (!row) return null
    return normalizeCurrentEvidence(
      taskId,
      stringValue(row.updated_at) ?? '',
      parseStoredJson(row.payload_json, `current evidence for task ${taskId}`),
    )
  } finally {
    database.close()
  }
}

/** Read current evidence for many tasks with one read-only database handle. */
export function readProjectStateDatabaseTaskEvidenceCurrentManyWithRevision(
  projectRoot: string,
  taskIds: readonly string[],
): ProjectStateDatabaseTaskEvidenceCurrentManyRead | null {
  const ids = [...new Set(taskIds.filter(id => id.trim().length > 0))]
  const databasePath = projectStateDatabasePath(projectRoot)
  try {
    statSync(databasePath)
  } catch {
    return null
  }
  const database = openDatabase(databasePath, { readOnly: true })
  let inReadTransaction = false
  try {
    database.exec('BEGIN')
    inReadTransaction = true
    const projectAuthority = readProjectStateDatabaseEffectiveAuthorityFromDatabase(database)
    const queueRevision = tableExists(database, 'queue_state') ? currentQueueRevision(database) : null
    const projectRevision = tableExists(database, 'project_meta') ? currentRevision(database) : null
    if (!tableExists(database, 'task_evidence_current')) {
      if (projectAuthority === 'database') {
        throw new Error('Normalized current task evidence is unavailable for promoted project')
      }
      return { records: new Map(), projectAuthority, queueRevision, projectRevision }
    }
    const records = currentEvidenceForTaskIds(database, ids)
    return { records, projectAuthority, queueRevision, projectRevision }
  } finally {
    if (inReadTransaction) {
      try {
        database.exec('COMMIT')
      } catch {
        try { database.exec('ROLLBACK') } catch { /* preserve the original read result/error */ }
      }
    }
    database.close()
  }
}

export function readProjectStateDatabaseTaskEvidenceCurrentMany(
  projectRoot: string,
  taskIds: readonly string[],
): Map<string, ProjectStateDatabaseTaskEvidenceCurrent> | null {
  return readProjectStateDatabaseTaskEvidenceCurrentManyWithRevision(projectRoot, taskIds)?.records ?? null
}

function readProjectStateDatabaseTaskOverlayStoresFromDatabase(
  database: DatabaseSync,
): ProjectStateDatabaseTaskOverlayStores | null {
  // A normalized queue is the current-state authority. Do not gate the
  // overlay read on the historical promotion marker: during finalization it
  // may still say legacy even though every current row is already indexed.
  if (!tableExists(database, 'queue_state')) return null
  if (!['task_execution', 'task_workspace', 'task_evidence_current'].every(table => tableExists(database, table))) return null
  const read = (table: 'task_execution' | 'task_workspace'): ProjectStateDatabaseTaskRuntime[] =>
    (database.prepare(`SELECT task_id, updated_at, payload_json FROM ${table} ORDER BY task_id`).all() as JsonRecord[])
      .flatMap(row => {
        const taskId = stringValue(row.task_id)
        if (!taskId) return []
        return [{
          taskId,
          updatedAt: stringValue(row.updated_at) ?? undefined,
          payload: parseStoredJson(row.payload_json, `runtime/workspace overlay for task ${taskId}`),
        }]
      })
  const evidenceCurrent = new Map<string, ProjectStateDatabaseTaskEvidenceCurrent>()
  const evidenceRows = database.prepare(`
    SELECT task_id, updated_at, payload_json
    FROM task_evidence_current
    ORDER BY task_id
  `).all() as JsonRecord[]
  for (const row of evidenceRows) {
    const taskId = stringValue(row.task_id)
    if (!taskId) continue
    evidenceCurrent.set(taskId, normalizeCurrentEvidence(
      taskId,
      stringValue(row.updated_at) ?? '',
      parseStoredJson<JsonRecord>(row.payload_json, `current evidence for task ${taskId}`),
    ))
  }
  return {
    runtime: read('task_execution'),
    workspace: read('task_workspace'),
    evidenceCurrent,
  }
}

/**
 * Read all mutable task overlays from one database connection. A non-null
 * result means the project crossed the current-state database boundary, even
 * when either store is legitimately empty. Legacy JSON is then compatibility
 * output, not a competing current-state reader.
 */
export function readProjectStateDatabaseTaskOverlayStores(
  projectRoot: string,
): ProjectStateDatabaseTaskOverlayStores | null {
  const databasePath = projectStateDatabasePath(projectRoot)
  try {
    statSync(databasePath)
  } catch {
    return null
  }
  const database = openDatabase(databasePath, { readOnly: true })
  let inReadTransaction = false
  try {
    database.exec('BEGIN')
    inReadTransaction = true
    return readProjectStateDatabaseTaskOverlayStoresFromDatabase(database)
  } finally {
    if (inReadTransaction) {
      try {
        database.exec('COMMIT')
      } catch {
        try {
          database.exec('ROLLBACK')
        } catch {
          // Preserve the original read result/error.
        }
      }
    }
    database.close()
  }
}

/** Keep mutable current rows aligned with the queue; historical JSONL is untouched. */
export function reconcileProjectStateDatabaseTaskOverlays(
  projectRoot: string,
  taskIds: readonly string[],
): void {
  withDatabase(projectRoot, database => deleteOrphanTaskOverlays(database, taskIds))
}

export function readProjectStateDatabaseTaskPoint(
  tasksPath: string,
  taskId: string,
): ProjectStateDatabaseTask | null {
  return readProjectStateDatabaseTaskPointWithRevision(tasksPath, taskId)?.task ?? null
}

/** Read one rich task and its CAS revision from the same SQLite connection. */
export function readProjectStateDatabaseTaskPointWithRevision(
  tasksPath: string,
  taskId: string,
): ProjectStateDatabaseTaskPointRead | null {
  const databasePath = projectStateDatabasePathFromTasksPath(tasksPath)
  try {
    statSync(databasePath)
  } catch {
    return null
  }
  const database = openDatabase(databasePath, { readOnly: true })
  let inReadTransaction = false
  try {
    database.exec('BEGIN')
    inReadTransaction = true
    const row = database.prepare(`${workItemsWithScopeSelect('work_items.*', hasWorkScopeTable(database))} WHERE work_items.id = ?`)
      .get(taskId) as JsonRecord | undefined
    if (!row) return null
    applyReleaseMembershipToTaskRows(database, [row])
    applyTaskDependenciesToTaskRows(database, [row])
    const task = taskFromRow(row, false)
    const revision = currentQueueRevision(database)
    const projectRevision = currentRevision(database)
    return {
      task: attachWorkItemDetails([task], database)[0] ?? task,
      overlay: readProjectStateDatabaseTaskOverlayFromDatabase(database, taskId),
      revision,
      projectRevision,
      projectAuthority: readProjectStateDatabaseEffectiveAuthorityFromDatabase(database),
    }
  } finally {
    if (inReadTransaction) {
      try {
        database.exec('COMMIT')
      } catch {
        try { database.exec('ROLLBACK') } catch { /* preserve the original read result/error */ }
      }
    }
    database.close()
  }
}

/** Backwards-compatible name for the bounded one-task point read. */
export function readProjectStateDatabaseTask(
  tasksPath: string,
  taskId: string,
): ProjectStateDatabaseTask | null {
  return readProjectStateDatabaseTaskPoint(tasksPath, taskId)
}

export function readProjectStateDatabaseTaskRelationships(
  tasksPath: string,
  taskId: string,
): ProjectStateDatabaseTaskRelationships | null {
  const databasePath = projectStateDatabasePathFromTasksPath(tasksPath)
  try {
    statSync(databasePath)
  } catch {
    return null
  }
  const database = openDatabase(databasePath, { readOnly: true })
  try {
    const includeScope = hasWorkScopeTable(database)
    const row = database.prepare(`${workItemsWithScopeSelect('work_items.id, work_items.parent_id, work_items.depends_on_json', includeScope)} WHERE work_items.id = ?`)
      .get(taskId) as JsonRecord | undefined
    if (!row) return null
    applyTaskDependenciesToTaskRows(database, [row])
    const childRows = database.prepare('SELECT id FROM work_items WHERE parent_id = ? ORDER BY rowid').all(taskId) as JsonRecord[]
    return {
      taskId,
      parentId: typeof row.parent_id === 'string' ? row.parent_id : null,
      childIds: childRows.flatMap(child => typeof child.id === 'string' ? [child.id] : []),
      dependsOnIds: taskDependencyIdsFromRow(row),
      dependentIds: readDependentTaskIds(database, taskId),
      scopeRow: scopeRowFromRow(row),
    }
  } finally {
    database.close()
  }
}

export function readProjectStateDatabaseInventory(
  tasksPath: string,
  options: ProjectStateDatabaseInventoryOptions = {},
): ProjectStateDatabaseInventory | null {
  const databasePath = projectStateDatabasePathFromTasksPath(tasksPath)
  try {
    statSync(databasePath)
  } catch {
    return null
  }
  const offset = Math.max(0, options.offset ?? 0)
  const limit = options.limit && options.limit > 0 ? Math.min(100, options.limit) : null
  const database = openDatabase(databasePath, { readOnly: true })
  try {
    return readInventoryFromDatabase(database, options)
  } finally {
    database.close()
  }
}

function readInventoryFromDatabase(
  database: DatabaseSync,
  options: ProjectStateDatabaseInventoryOptions = {},
): ProjectStateDatabaseInventory {
  const offset = Math.max(0, options.offset ?? 0)
  const limit = options.limit && options.limit > 0 ? Math.min(100, options.limit) : null
  const total = Number((database.prepare('SELECT COUNT(*) AS count FROM work_items').get() as JsonRecord)?.count ?? 0)
  const columns = options.includeDefinitions === true ? FULL_WORK_ITEM_SCOPED_COLUMNS : COMPACT_WORK_ITEM_SCOPED_COLUMNS
  const scopeTableExists = hasWorkScopeTable(database)
  const scopeOrder = scopeTableExists
    ? "CASE work_scope.scope WHEN 'included' THEN 0 WHEN 'deferred' THEN 1 ELSE 2 END, "
    : ''
  const select = `${workItemsWithScopeSelect(columns, scopeTableExists)} ORDER BY ${scopeOrder}work_items.rowid`
  const rows = limit === null
    ? database.prepare(`${select} LIMIT -1 OFFSET ?`).all(offset)
    : database.prepare(`${select} LIMIT ? OFFSET ?`).all(limit, offset)
  const taskRows = rows as JsonRecord[]
  applyReleaseMembershipToTaskRows(database, taskRows)
  applyTaskDependenciesToTaskRows(database, taskRows)
  const tasks = taskRows.map(row => taskFromRow(row, false))
  const detailedTasks = options.includeDefinitions === true
    ? attachWorkItemDetails(tasks, database)
    : tasks
  return {
    tasks: detailedTasks,
    total,
    offset,
    limit,
    hasMore: limit !== null && offset + tasks.length < total,
  }
}

/** Read one task point while the caller's surrounding projection transaction is open. */
function readTaskFromDatabase(
  database: DatabaseSync,
  taskId: string,
  includeDefinitions: boolean,
): ProjectStateDatabaseTask | null {
  const row = database.prepare(`${workItemsWithScopeSelect(
    includeDefinitions ? FULL_WORK_ITEM_SCOPED_COLUMNS : COMPACT_WORK_ITEM_SCOPED_COLUMNS,
    hasWorkScopeTable(database),
  )} WHERE work_items.id = ?`).get(taskId) as JsonRecord | undefined
  if (!row) return null
  applyReleaseMembershipToTaskRows(database, [row])
  applyTaskDependenciesToTaskRows(database, [row])
  const task = taskFromRow(row, false)
  return includeDefinitions ? attachWorkItemDetails([task], database)[0] ?? task : task
}

/**
 * Read a bounded, explicit set of task points and its CAS revisions from one
 * SQLite read transaction. This is for related-task hydration: callers name
 * the ids they need, and the database returns only those rows in caller order.
 * Missing ids are omitted. There is deliberately no aggregate queue or legacy
 * fallback in this path.
 */
export function readProjectStateDatabaseTaskPointsWithRevision(
  tasksPath: string,
  taskIds: readonly string[],
  options: Pick<ProjectStateDatabaseInventoryOptions, 'includeDefinitions'> = {},
): ProjectStateDatabaseTaskPointsRead | null {
  const ids = [...new Set(taskIds.filter(id => id.trim().length > 0))].slice(0, 100)
  const databasePath = projectStateDatabasePathFromTasksPath(tasksPath)
  try {
    statSync(databasePath)
  } catch {
    return null
  }
  const database = openDatabase(databasePath, { readOnly: true })
  let inReadTransaction = false
  try {
    database.exec('BEGIN')
    inReadTransaction = true
    const hasQueue = Boolean(
      tableExists(database, 'queue_state') &&
      database.prepare('SELECT 1 FROM queue_state WHERE id = 1').get(),
    )
    if (!hasQueue) return null
    const tasks = ids.length === 0
      ? []
      : (() => {
        const columns = options.includeDefinitions === true ? FULL_WORK_ITEM_SCOPED_COLUMNS : COMPACT_WORK_ITEM_SCOPED_COLUMNS
        const taskRows = database.prepare(`${workItemsWithScopeSelect(columns, hasWorkScopeTable(database))} WHERE work_items.id IN (${ids.map(() => '?').join(', ')})`).all(...ids) as JsonRecord[]
        applyReleaseMembershipToTaskRows(database, taskRows)
        applyTaskDependenciesToTaskRows(database, taskRows)
        const rows = taskRows.map(row => taskFromRow(row, false))
        const detailedRows = options.includeDefinitions === true
          ? attachWorkItemDetails(rows, database)
          : rows
        const byId = new Map(detailedRows.map(row => [row.id, row]))
        return ids.flatMap(id => {
          const row = byId.get(id)
          return row ? [row] : []
        })
      })()
    return {
      tasks,
      queueRevision: currentQueueRevision(database),
      projectRevision: currentRevision(database),
      projectAuthority: readProjectStateDatabaseEffectiveAuthorityFromDatabase(database),
    }
  } finally {
    if (inReadTransaction) {
      try {
        database.exec('COMMIT')
      } catch {
        try {
          database.exec('ROLLBACK')
        } catch {
          // Preserve the original read result/error.
        }
      }
    }
    database.close()
  }
}

/**
 * Read explicit current task rows and their normalized overlays from one
 * SQLite read transaction. Missing ids are omitted and legacy state is never
 * consulted.
 */
export function readProjectStateDatabaseCurrentTasksWithRevision(
  tasksPath: string,
  taskIds: readonly string[],
  options: Pick<ProjectStateDatabaseInventoryOptions, 'includeDefinitions'> = {},
): ProjectStateDatabaseCurrentTasksRead | null {
  const ids = [...new Set(taskIds.filter(id => id.trim().length > 0))].slice(0, 100)
  const databasePath = projectStateDatabasePathFromTasksPath(tasksPath)
  try {
    statSync(databasePath)
  } catch {
    return null
  }
  const database = openDatabase(databasePath, { readOnly: true })
  let inReadTransaction = false
  try {
    database.exec('BEGIN')
    inReadTransaction = true
    const hasQueue = Boolean(
      tableExists(database, 'queue_state') &&
      database.prepare('SELECT 1 FROM queue_state WHERE id = 1').get(),
    )
    if (!hasQueue) return null
    if (!['task_execution', 'task_workspace', 'task_proof', 'task_evidence_current'].every(table => tableExists(database, table))) {
      return null
    }

    const columns = options.includeDefinitions === true ? FULL_WORK_ITEM_SCOPED_COLUMNS : COMPACT_WORK_ITEM_SCOPED_COLUMNS
    const taskRows = ids.length === 0
      ? []
      : database.prepare(`${workItemsWithScopeSelect(columns, hasWorkScopeTable(database))} WHERE work_items.id IN (${ids.map(() => '?').join(', ')})`)
        .all(...ids) as JsonRecord[]
    applyReleaseMembershipToTaskRows(database, taskRows)
    applyTaskDependenciesToTaskRows(database, taskRows)
    const rows = taskRows.map(row => taskFromRow(row, false))
    const detailedRows = options.includeDefinitions === true
      ? attachWorkItemDetails(rows, database)
      : rows
    const byId = new Map(detailedRows.map(task => [task.id, task]))
    const tasks = ids.flatMap(id => {
      const task = byId.get(id)
      return task ? [task] : []
    })
    const overlays = new Map<string, ProjectStateDatabaseTaskOverlay>()
    for (const task of tasks) {
      const overlay = readProjectStateDatabaseTaskOverlayFromDatabase(database, task.id)
      if (overlay === null) return null
      overlays.set(task.id, overlay)
    }
    return {
      tasks,
      overlays,
      queueRevision: currentQueueRevision(database),
      projectRevision: currentRevision(database),
      projectAuthority: readProjectStateDatabaseEffectiveAuthorityFromDatabase(database),
    }
  } finally {
    if (inReadTransaction) {
      try {
        database.exec('COMMIT')
      } catch {
        try {
          database.exec('ROLLBACK')
        } catch {
          // Preserve the original read result/error.
        }
      }
    }
    database.close()
  }
}

/** Read a small, explicit set of task identities without scanning the queue. */
export function readProjectStateDatabaseTasks(
  tasksPath: string,
  taskIds: readonly string[],
  options: Pick<ProjectStateDatabaseInventoryOptions, 'includeDefinitions'> = {},
): ProjectStateDatabaseTask[] | null {
  if (taskIds.length === 0) return []
  return readProjectStateDatabaseTaskPointsWithRevision(tasksPath, taskIds, options)?.tasks ?? null
}

export interface ProjectStateDatabaseQueue {
  version?: number
  lastUpdated?: string
  tasks: JsonRecord[]
  releases: JsonRecord[]
  selectedReleaseId?: string
  executionPlanActions?: JsonRecord[]
  scopeAuthorityRequests?: JsonRecord[]
}

function compactTaskFromRow(row: ProjectStateDatabaseTask): JsonRecord {
  const rowRecord = row as unknown as JsonRecord
  return {
    id: row.id,
    title: row.title,
    ...(row.description ? { description: row.description } : {}),
    ...(row.status ? { status: row.status } : {}),
    ...(row.domain ? { domain: row.domain } : {}),
    ...(row.priority ? { priority: row.priority } : {}),
    ...(row.workKind ? { workKind: row.workKind } : {}),
    ...(row.semanticKind ? { semanticKind: row.semanticKind } : {}),
    ...(row.parentId || row.hierarchy ? { hierarchy: { ...(row.hierarchy ?? {}), ...(row.parentId ? { parentId: row.parentId } : {}) } } : {}),
    ...(row.dependsOn.length > 0 ? { dependsOn: row.dependsOn } : {}),
    ...(row.releaseIds.length > 0 ? { releaseIds: row.releaseIds } : {}),
    ...(row.sourceRefs.length > 0 ? { sourceRefs: row.sourceRefs } : {}),
    ...(isRecord(rowRecord.delivery) ? { delivery: rowRecord.delivery } : {}),
    ...(isRecord(rowRecord.currentSummary) ? { currentSummary: rowRecord.currentSummary } : {}),
    ...(row.updatedAt ? { updatedAt: row.updatedAt } : {}),
    ...(row.completedAt ? { completedAt: row.completedAt } : {}),
  }
}

function readProjectStateDatabaseQueueEnvelopeFromDatabase(
  database: DatabaseSync,
): ProjectStateDatabaseQueue | null {
  const queueState = database.prepare(`
    SELECT ${queueStateReadColumns(database, [
      'version', 'last_updated', 'selected_release_id',
      'execution_plan_actions_json', 'scope_authority_requests_json',
    ])}
    FROM queue_state WHERE id = 1
  `).get() as JsonRecord | undefined
  if (!queueState) return null
  // Release identity and selection belong to the queue/scopes projection.
  // A summary is derived state and cannot fill a missing selection during a
  // read without becoming a second release authority.
  return {
    version: Number(queueState.version ?? 1),
    ...optionalLastUpdated(queueState.last_updated),
    tasks: [],
    releases: releaseDefinitionsFromDatabase(database),
    ...optionalSelectedReleaseId(stringValue(queueState.selected_release_id)),
    ...optionalJsonArray(queueState.execution_plan_actions_json, 'executionPlanActions'),
    ...optionalJsonArray(queueState.scope_authority_requests_json, 'scopeAuthorityRequests'),
  }
}

function readTaskDetailQueueEnvelopeFromDatabase(
  database: DatabaseSync,
  includeAggregateTasks: boolean,
): ProjectStateDatabaseQueue {
  const taskRows = includeAggregateTasks
    ? database.prepare(`SELECT ${COMPACT_WORK_ITEM_COLUMNS} FROM work_items ORDER BY rowid`).all() as JsonRecord[]
    : []
  if (includeAggregateTasks) {
    applyReleaseMembershipToTaskRows(database, taskRows)
    applyTaskDependenciesToTaskRows(database, taskRows)
  }
  const queue = readProjectStateDatabaseQueueEnvelopeFromDatabase(database)
  if (!queue) throw new Error('Current project-state queue envelope is unavailable.')
  return {
    ...queue,
    tasks: taskRows.map(row => compactTaskFromRow(taskFromRow(row, false))),
  }
}

function readCompactQueueFromDatabase(database: DatabaseSync): ProjectStateDatabaseQueue {
  return readTaskDetailQueueEnvelopeFromDatabase(database, true)
}

export function readProjectStateDatabaseQueue(tasksPath: string): ProjectStateDatabaseQueue | null {
  const databasePath = projectStateDatabasePathFromTasksPath(tasksPath)
  try {
    statSync(databasePath)
  } catch {
    return null
  }
  const database = openDatabase(databasePath, { readOnly: true })
  try {
    return readCompactQueueFromDatabase(database)
  } finally {
    database.close()
  }
}

/**
 * Explicit detail-reader boundary for the current task/release aggregate.
 * Callers must opt into this richer read; compact lists continue to use the
 * inventory functions above.
 */
export function readProjectStateDatabaseQueueDefinition(
  tasksPath: string,
): ProjectStateDatabaseQueueDefinition | null {
  return readProjectStateDatabaseQueueWithRevision(tasksPath)?.definition ?? null
}

/**
 * Read a pre-cutover queue only while an explicit migration is importing it.
 * Runtime callers must use readProjectStateDatabaseQueueDefinition, which
 * intentionally refuses aggregate blobs, sidecars, and TASKS.json.
 */
export function readProjectStateDatabaseQueueDefinitionForMigration(
  tasksPath: string,
): ProjectStateDatabaseQueueDefinition | null {
  return readProjectStateDatabaseQueueWithRevision(tasksPath, { migration: true })?.definition ?? null
}

/**
 * Read the writable queue and its compare-and-swap token from one database
 * connection. Callers that replace the whole queue must carry this token into
 * the write; a second read after queue construction would make the guard
 * meaningless.
 */
export function readProjectStateDatabaseQueueWithRevision(
  tasksPath: string,
  options: { migration?: boolean } = {},
): ProjectStateDatabaseQueueRead | null {
  const databasePath = projectStateDatabasePathFromTasksPath(tasksPath)
  try {
    statSync(databasePath)
  } catch {
    return null
  }
  const database = openDatabase(databasePath, { readOnly: true })
  let inReadTransaction = false
  try {
    database.exec('BEGIN')
    inReadTransaction = true
    if (!tableExists(database, 'queue_state')) return null
    const queue = database.prepare(`
      SELECT ${queueStateReadColumns(database, [
        'version', 'last_updated', 'selected_release_id',
        'execution_plan_actions_json', 'scope_authority_requests_json',
      ])}
      FROM queue_state WHERE id = 1
    `).get() as JsonRecord | undefined
    if (!queue) return null
    const revision = currentQueueRevision(database)
    const projectRevision = currentRevision(database)
    const details = readQueueDetailsForRevision(tasksPath, revision, database, options)
    if (details) return { definition: details, revision, projectRevision }
    if (!options.migration) return null
    const authority = database.prepare('SELECT project_state_authority FROM project_meta WHERE id = 1').get() as JsonRecord | undefined
    if (authority?.project_state_authority === 'database') {
      // A promoted project cannot safely reconstruct a writable queue from
      // compact index rows. Callers must surface the missing detail store and
      // repair it explicitly rather than silently dropping task fields.
      return null
    }
    const taskRows = database.prepare(`SELECT ${COMPACT_WORK_ITEM_COLUMNS} FROM work_items ORDER BY rowid`).all() as JsonRecord[]
    const releaseRows = releaseDefinitionsFromDatabase(database)
    return {
      definition: {
        version: Number(queue.version ?? 1),
        ...optionalLastUpdated(queue.last_updated),
        ...optionalSelectedReleaseId(queue.selected_release_id),
        ...optionalJsonArray(queue.execution_plan_actions_json, 'executionPlanActions'),
        ...optionalJsonArray(queue.scope_authority_requests_json, 'scopeAuthorityRequests'),
        tasks: taskRows.map(row => compactTaskFromRow(taskFromRow(row, false))).filter(task => typeof task.id === 'string'),
        releases: releaseRows,
      },
      revision,
      projectRevision,
    }
  } finally {
    if (inReadTransaction) {
      try {
        database.exec('COMMIT')
      } catch {
        try { database.exec('ROLLBACK') } catch { /* preserve the original read result/error */ }
      }
    }
    database.close()
  }
}

/**
 * Canonical queue reader for runtime and tool mutations. The current
 * application has one source of truth: the indexed SQLite detail store.
 * Historical queue formats are available only through the explicitly named
 * migration reader above.
 */
export function readProjectTaskQueueSync(tasksPath: string): unknown {
  const queue = readProjectStateDatabaseQueueDefinition(tasksPath)
  if (queue) return queue
  throw new Error(`Current project-state detail store is unavailable for ${tasksPath}; run the project-state migration before reading work.`)
}

/**
 * Queue read for callers that will replace the aggregate. A missing indexed
 * current-state database is a migration/corruption error, never a reason to
 * fall back to a historical file shape.
 */
export function readProjectTaskQueueSyncWithRevision(tasksPath: string): {
  queue: unknown
  revision: number | null
  projectRevision: number | null
} {
  const result = readProjectStateDatabaseQueueWithRevision(tasksPath)
  if (result) return { queue: result.definition, revision: result.revision, projectRevision: result.projectRevision }
  throw new Error(`Current project-state detail store is unavailable for ${tasksPath}; run the project-state migration before mutating work.`)
}
