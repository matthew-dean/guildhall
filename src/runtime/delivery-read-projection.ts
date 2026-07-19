import { existsSync } from 'node:fs'
import type { Task } from '@guildhall/core'
import {
  DELIVERY_READ_PROJECTION_SCHEMA_VERSION as SESSION_DELIVERY_READ_PROJECTION_SCHEMA_VERSION,
  deliveryReadProjectionSchemaPresent,
  ensureDeliveryReadProjectionSchema,
  getProjectSystemStatePath,
  readProjectDeliveryProjectionRefreshSource,
  readProjectDeliveryReadProjectionWithSavedModel,
  writeProjectDeliveryReadProjection,
  type DeliveryReadProjectionCandidateRow,
  type DeliveryReadProjectionEdgeRow,
  type DeliveryReadProjectionPage,
  type DeliveryReadProjectionPrimitiveRow,
  type DeliveryReadProjectionReadOptions as SessionDeliveryReadProjectionReadOptions,
  type DeliveryReadProjectionSnapshot,
  type DeliveryReadProjectionTaskRow,
} from '@guildhall/sessions'
import { readProjectTaskQueue } from './project-state-boundary.js'
import {
  buildTaskContextPacket,
  deriveQueueCandidates,
  deriveTaskRelationships,
  listPrimitivesWithRelations,
  projectDeliveryModelPath,
  readProjectDeliveryModel,
  validateProjectDeliveryModel,
  type DeliveryModelValidation,
  type PrimitiveWithRelations,
  type ProjectDeliveryModel as ProjectDeliveryModelRecord,
  type QueueCandidate,
  type TaskContextPacket,
  type TaskRelationshipSummary,
} from './delivery-spine.js'

export const DELIVERY_READ_PROJECTION_SCHEMA_VERSION = SESSION_DELIVERY_READ_PROJECTION_SCHEMA_VERSION

type JsonRecord = Record<string, unknown>

export type DeliveryReadRevision = {
  queueRevision: number
  projectRevision: number
  deliveryUpdatedAt: string | null
  refreshedAt: string
}

export type DeliveryReadCurrentRevision = {
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

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0))]
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

function taskSummary(row: DeliveryReadProjectionTaskRow): DeliveryTaskSummary {
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
    hierarchy: Object.keys(row.hierarchy).length > 0 ? row.hierarchy : null,
    dependsOn: [...row.dependsOn],
    releaseIds: [...row.releaseIds],
    sourceRefs: [...row.sourceRefs],
    updatedAt: row.updatedAt,
    completedAt: row.completedAt,
    ...(delivery ? { delivery } : {}),
  }
}

function taskForDerivation(projectRoot: string, row: DeliveryReadProjectionTaskRow): Task {
  const summary = taskSummary(row)
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
      hierarchy: { ...(summary.hierarchy ?? {}), ...(summary.parentId ? { parentId: summary.parentId } : {}) },
    } : {}),
    ...(summary.releaseIds.length > 0 ? { releaseIds: [...summary.releaseIds] } : {}),
    ...(summary.sourceRefs.length > 0 ? { sourceRefs: [...summary.sourceRefs] } : {}),
    ...(summary.delivery ? { delivery: summary.delivery } : {}),
  } as unknown as Task
}

function compactCandidate(candidate: QueueCandidate): JsonRecord {
  return {
    runnable: candidate.runnable,
    executionBlockers: candidate.executionBlockers.map(blocker => ({ id: blocker.id, title: blocker.title, status: blocker.status ?? null })),
    structuralBlockers: candidate.structuralBlockers.map(primitive => ({ id: primitive.id, label: primitive.label, status: primitive.status })),
    suggestedPrimitiveProofTasks: candidate.suggestedPrimitiveProofTasks.map(suggested => ({
      primitiveId: suggested.primitiveId,
      primitiveLabel: suggested.primitiveLabel,
      title: suggested.title,
      reason: suggested.reason,
      delivery: suggested.delivery,
    })),
    rank: candidate.rank,
    why: candidate.why,
  }
}

type DeliveryEdgeRelation = import('@guildhall/sessions').DeliveryReadProjectionEdgeRelation
type DeliveryEdge = DeliveryReadProjectionEdgeRow

function edgeKey(edge: DeliveryEdge): string {
  return `${edge.sourceTaskId}\0${edge.relation}\0${edge.targetId}\0${edge.contextId ?? ''}`
}

function edgesForRelationship(relationship: TaskRelationshipSummary): DeliveryEdge[] {
  const edges: DeliveryEdge[] = []
  const add = (relation: DeliveryEdgeRelation, targetId: string, contextId: string | null = null): void => {
    if (targetId) edges.push({ sourceTaskId: relationship.task.id, relation, targetId, contextId })
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
  return [...new Map(edges.map(edge => [edgeKey(edge), edge])).values()]
}

function refMap(rows: ReadonlyMap<string, DeliveryTaskSummary>, ids: readonly string[]): DeliveryTaskRef[] {
  return ids.flatMap(id => {
    const row = rows.get(id)
    return row ? [{ id: row.id, title: row.title, status: row.status }] : []
  })
}

function taskRelationships(
  edges: readonly DeliveryEdge[],
  rows: ReadonlyMap<string, DeliveryTaskSummary>,
  task: DeliveryTaskSummary,
): DeliveryReadTaskRelationships {
  const forRelation = (relation: DeliveryEdgeRelation) => edges.filter(edge => edge.relation === relation).map(edge => edge.targetId)
  const provingTasksByPrimitive: Record<string, DeliveryTaskRef[]> = {}
  for (const edge of edges.filter(edge => edge.relation === 'proving_task')) {
    const provingTask = rows.get(edge.targetId)
    if (provingTask && edge.contextId) (provingTasksByPrimitive[edge.contextId] ??= []).push({ id: provingTask.id, title: provingTask.title, status: provingTask.status })
  }
  const parent = refMap(rows, forRelation('parent'))[0]
  return {
    hierarchy: { ...(parent ? { parent } : {}), children: refMap(rows, forRelation('child')), breadcrumbs: refMap(rows, forRelation('breadcrumb')) },
    dependencies: {
      directBlockers: refMap(rows, forRelation('direct_blocker')),
      recursiveBlockers: refMap(rows, forRelation('recursive_blocker')),
      blocks: refMap(rows, forRelation('blocks')),
    },
    supports: [...new Set(forRelation('supports'))],
    primitiveUse: { direct: [...new Set(forRelation('primitive_use'))], ancestors: [...new Set(forRelation('primitive_ancestor'))] },
    primitiveProof: { proves: [...new Set(forRelation('primitive_proof'))], provingTasksByPrimitive },
  }
}

function queuePage(
  page: DeliveryReadProjectionPage<DeliveryReadProjectionCandidateRow> | null,
  rows: ReadonlyMap<string, DeliveryTaskSummary>,
): DeliveryQueuePage | null {
  if (!page) return null
  const candidates = page.rows.flatMap(row => {
    const task = rows.get(row.taskId)
    if (!task) return []
    const payload = row.payload
    return [{ task, ...payload } as DeliveryReadCandidate]
  })
  const runnable = candidates.filter(candidate => candidate.runnable)
  const blocked = candidates.filter(candidate => !candidate.runnable)
  return {
    runnable,
    blocked,
    ...(runnable[0] ? { firstRunnable: runnable[0] } : {}),
    hasMore: page.hasMore,
    ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
  }
}

function primitivePage(page: DeliveryReadProjectionPage<DeliveryReadProjectionPrimitiveRow, string>): DeliveryPrimitivePage {
  return {
    primitives: page.rows.flatMap(row => isRecord(row.payload) ? [row.payload as unknown as PrimitiveWithRelations] : []),
    hasMore: page.hasMore,
    ...(page.nextCursor ? { nextCursor: String(page.nextCursor) } : {}),
  }
}

function projectSnapshot(
  snapshot: DeliveryReadProjectionSnapshot,
  model: ProjectDeliveryModelRecord,
  options: DeliveryReadProjectionReadOptions,
): DeliveryReadProjection {
  if (snapshot.status !== 'current') return snapshot
  const summaries = new Map(snapshot.taskRows.map(row => [row.id, taskSummary(row)]))
  const task = options.taskId ? summaries.get(options.taskId) ?? null : null
  return {
    status: 'current',
    freshness: 'current',
    source: snapshot.source,
    model,
    validation: snapshot.meta.validation as unknown as DeliveryModelValidation,
    selectedReleaseId: snapshot.meta.selectedReleaseId,
    queue: queuePage(snapshot.queue, summaries),
    primitives: primitivePage(snapshot.primitives),
    task,
    taskState: !options.taskId ? 'not_requested' : task ? 'present' : 'missing',
    relationships: task ? taskRelationships(snapshot.edges, summaries, task) : null,
  }
}

function modelToken(projectRoot: string, model: ProjectDeliveryModelRecord): string | null {
  return existsSync(projectDeliveryModelPath(projectRoot)) ? model.updatedAt : null
}

/**
 * The saved delivery model is an explicit source input to the sessions DB
 * snapshot. Runtime does not merge it with arbitrary task state; sessions
 * compares its revision token with the persisted delivery projection.
 */
async function readSavedDeliveryModel(projectRoot: string): Promise<{ model: ProjectDeliveryModelRecord; updatedAt: string | null }> {
  const model = await readProjectDeliveryModel(projectRoot)
  return { model, updatedAt: modelToken(projectRoot, model) }
}

export function contextPacketFromDeliveryReadProjection(
  projection: DeliveryReadProjectionCurrent,
  projectRoot: string,
): TaskContextPacket | null {
  if (!projection.task || !projection.relationships) return null
  const primitiveById = new Map(projection.primitives.primitives.map(primitive => [primitive.id, primitive]))
  const primitiveRefs = (ids: readonly string[]): PrimitiveWithRelations[] => ids.flatMap(id => {
    const primitive = primitiveById.get(id)
    return primitive ? [primitive] : []
  })
  const task = {
    ...taskForDerivation(projectRoot, {
      ...projection.task,
      hierarchy: projection.task.hierarchy ?? {},
      dependsOn: projection.task.dependsOn,
      releaseIds: projection.task.releaseIds,
      sourceRefs: projection.task.sourceRefs,
      summary: projection.task.delivery ? { delivery: projection.task.delivery } : {},
      workKind: projection.task.workKind,
      parentId: projection.task.parentId,
    }),
  }
  const relationships: TaskRelationshipSummary = {
    task,
    hierarchy: {
      ...(projection.relationships.hierarchy.parent ? { parent: projection.relationships.hierarchy.parent as Pick<Task, 'id' | 'title' | 'status'> } : {}),
      children: projection.relationships.hierarchy.children as Array<Pick<Task, 'id' | 'title' | 'status'>>,
      breadcrumbs: projection.relationships.hierarchy.breadcrumbs as Array<Pick<Task, 'id' | 'title'>>,
    },
    dependencies: projection.relationships.dependencies as TaskRelationshipSummary['dependencies'],
    supports: [...projection.relationships.supports],
    primitiveUse: {
      direct: primitiveRefs(projection.relationships.primitiveUse.direct),
      ancestors: primitiveRefs(projection.relationships.primitiveUse.ancestors),
      blockers: primitiveRefs([...projection.relationships.primitiveUse.direct, ...projection.relationships.primitiveUse.ancestors])
        .filter(primitive => primitive.status !== 'ready' && primitive.status !== 'deprecated'),
    },
    primitiveProof: {
      proves: primitiveRefs(projection.relationships.primitiveProof.proves),
      provingTasksByPrimitive: Object.fromEntries(Object.entries(projection.relationships.primitiveProof.provingTasksByPrimitive)
        .map(([primitiveId, tasks]) => [primitiveId, tasks as Array<Pick<Task, 'id' | 'title' | 'status'>>])),
    },
  }
  return buildTaskContextPacket({ model: projection.model, tasks: [task], taskId: task.id, relationships })
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

export async function readProjectDeliveryReadProjection(
  projectRoot: string,
  options: DeliveryReadProjectionReadOptions = {},
): Promise<DeliveryReadProjection> {
  const result = await readProjectDeliveryReadProjectionWithSource(projectRoot, options)
  return result.projection
}

export async function readProjectDeliveryReadProjectionWithSource(
  projectRoot: string,
  options: DeliveryReadProjectionReadOptions = {},
): Promise<{ model: ProjectDeliveryModelRecord | null; projection: DeliveryReadProjection }> {
  const sessionOptions: Omit<SessionDeliveryReadProjectionReadOptions, 'deliveryModelUpdatedAt'> = {
    ...(options.queue !== undefined ? { queue: options.queue } : {}),
    ...(options.taskId ? { taskId: options.taskId } : {}),
    ...(options.primitiveLimit !== undefined ? { primitiveLimit: options.primitiveLimit } : {}),
    ...(options.primitiveAfter ? { primitiveAfter: options.primitiveAfter } : {}),
  }
  const result = await readProjectDeliveryReadProjectionWithSavedModel(
    projectRoot,
    sessionOptions,
    readSavedDeliveryModel,
  )
  return {
    model: result.model,
    projection: result.model === null ? result.snapshot : projectSnapshot(result.snapshot, result.model, options),
  }
}

export interface DeliveryReadProjectionWithAuthority {
  authority: 'database' | 'legacy'
  model: ProjectDeliveryModelRecord | null
  projection: DeliveryReadProjection | null
}

/**
 * Explicit pre-promotion compatibility read for delivery-only routes. The
 * route must not parse TASKS.json itself or choose a second queue authority;
 * promoted projects never call this because the saved delivery projection is
 * authoritative there.
 */
export async function readProjectDeliveryLegacyTasks(
  projectRoot: string,
): Promise<Array<Record<string, unknown>>> {
  const queue = await readProjectTaskQueue(getProjectSystemStatePath(projectRoot, 'TASKS.json'))
  if (!isRecord(queue) || !Array.isArray(queue.tasks)) return []
  return queue.tasks.filter(isRecord).map(task => ({ ...task }))
}

/**
 * Resolve delivery authority inside the named read boundary. A missing
 * project database is the only legacy case; a promoted database with a
 * missing, stale, or unavailable delivery projection stays authoritative and
 * must be reported to the caller instead of falling back to task files.
 */
export async function readProjectDeliveryReadProjectionWithAuthority(
  projectRoot: string,
  options: DeliveryReadProjectionReadOptions = {},
): Promise<DeliveryReadProjectionWithAuthority> {
  const result = await readProjectDeliveryReadProjectionWithSource(projectRoot, options)
  const isLegacy = result.projection.status === 'missing' && result.projection.reason === 'database_missing'
  return {
    authority: isLegacy ? 'legacy' : 'database',
    model: result.model,
    projection: isLegacy ? null : result.projection,
  }
}

/**
 * Task detail sometimes needs to distinguish an empty, not-yet-shaped
 * delivery model from a shaped model whose saved projection is missing. Keep
 * that distinction inside this boundary so serve never reads the model file
 * separately from the projection revision.
 */
export async function readProjectDeliveryTaskProjectionWithSource(
  projectRoot: string,
  taskId: string,
): Promise<{ model: ProjectDeliveryModelRecord | null; projection: DeliveryReadProjection }> {
  return readProjectDeliveryReadProjectionWithSource(projectRoot, { queue: false, taskId })
}

export function readProjectDeliveryTaskProjection(projectRoot: string, taskId: string): Promise<DeliveryReadProjection> {
  return readProjectDeliveryReadProjection(projectRoot, { queue: false, taskId })
}

export function readProjectDeliveryQueuePage(projectRoot: string, options: DeliveryQueuePageOptions = {}): Promise<DeliveryReadProjection> {
  return readProjectDeliveryReadProjection(projectRoot, { queue: options })
}

export async function refreshProjectDeliveryReadProjection(projectRoot: string): Promise<DeliveryReadProjectionRefreshResult> {
  const input = await readProjectDeliveryProjectionRefreshSource(projectRoot, readSavedDeliveryModel)
  if (input.status !== 'current') return { status: 'missing', reason: input.reason }
  if (!input.source || !input.taskRows || !input.model) return { status: 'missing', reason: 'source_state_missing' }
  const source: DeliveryReadRevision = { ...input.source, deliveryUpdatedAt: modelToken(projectRoot, input.model), refreshedAt: new Date().toISOString() }
  const tasks = input.taskRows.map(row => taskForDerivation(projectRoot, row))
  const candidateSummary = deriveQueueCandidates({ model: input.model, tasks })
  const candidates = [...candidateSummary.runnable, ...candidateSummary.blocked]
  const validation = validateProjectDeliveryModel({ model: input.model, tasks, projectRoot })
  const primitiveRelations = listPrimitivesWithRelations(input.model, tasks)
  const edges = tasks.flatMap(task => edgesForRelationship(deriveTaskRelationships({ model: input.model, tasks, taskId: task.id })))
  const written = writeProjectDeliveryReadProjection(projectRoot, {
    source,
    selectedReleaseId: input.selectedReleaseId ?? null,
    validation: { valid: validation.valid, errors: validation.errors, warnings: validation.warnings },
    candidates: candidates.map(candidate => ({ taskId: candidate.task.id, rank: candidate.rank, payload: compactCandidate(candidate) })),
    edges,
    primitives: primitiveRelations.map(primitive => ({ id: primitive.id, payload: primitive })),
  })
  if (written.status !== 'current') return { status: 'missing', reason: written.reason }
  return {
    status: 'current',
    source,
    taskCount: input.taskRows.length,
    candidateCount: candidates.length,
    edgeCount: edges.length,
    primitiveCount: primitiveRelations.length,
  }
}

export { deliveryReadProjectionSchemaPresent, ensureDeliveryReadProjectionSchema }
