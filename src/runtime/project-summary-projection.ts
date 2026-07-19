import { TaskQueue, type ProjectRelease, type Task, type TaskQueue as TaskQueueModel } from '@guildhall/core'
import { readManagedTextFileSync } from '@guildhall/persistence'
import {
  readProjectStateDatabaseAuthorityFromTasksPath,
  readProjectStateDatabaseAuthority,
  readProjectStateDatabaseCurrentAuthorityFromTasksPath,
  readProjectStateDatabaseCurrentAuthority,
  readProjectStateDatabaseProjectionState,
  readProjectStateDatabaseQueue,
  readProjectStateDatabaseSummary,
  readProjectStateDatabaseRevisionFromTasksPath,
  readProjectStateDatabaseQueueDefinitionForMigration,
  writeProjectStateDatabaseSummarySnapshot,
  updateProjectStateDatabaseSummaryAndCurrentState,
  writeProjectStateDatabaseSnapshot,
  type ProjectStateDatabaseScopeRow,
  type ProjectStateDatabaseTask,
  type ProjectStateDatabaseTaskEvidenceRetentionInput,
  type ProjectStateDatabaseTaskRuntime,
  type ProjectStateDatabaseTaskStatusRow,
} from '@guildhall/sessions'
import { dirname, join } from 'node:path'
import { statSync } from 'node:fs'

import {
  buildProjectScopeProjection,
  executionScopeRows,
  normalizeProjectScopeRowReadModel,
  projectScopeRowNeedsOwnerInput,
  summarizeProjectScopeRelease,
  summarizeProjectScopeOutsideWork,
  summarizeProjectScopeStart,
  type ProjectScope,
  type ProjectScopeProjection,
  type ProjectScopeRow,
} from './project-scope-projection.js'
import { inferProjectOrientationSnapshot, type ProjectOrientationSnapshot } from './project-orientation-snapshot.js'
import {
  buildProjectOrientationSpine,
  compactProjectOrientationSpineForMap,
  reconcileOrientationSpineWithReleaseTruth,
  type ProjectOrientationSpine,
} from './project-orientation-spine.js'
import { buildProjectActionModel, type ProjectActionModel } from './project-action-model.js'
import { normalizeLegacyTaskQueueForMigration } from './task-queue-migration.js'
import { stripLegacyRuntimeFields } from './effective-task.js'

export const PROJECT_SUMMARY_PROJECTION_VERSION = 17 as const
export const PROJECT_SUMMARY_PROJECTION_FILE = 'project-summary.json'
const LEGACY_PROJECT_SUMMARY_PROJECTION_VERSIONS = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])

export interface ProjectSummaryApprovedPlanRelease {
  id: string
  label: string
  kind: string
  state: string
  source: string
  currentTaskIds: string[]
  laterTaskIds: string[]
}

export interface ProjectSummaryApprovedPlan {
  source: 'workspace_import'
  recordedAt: string
  goalCount: number
  taskCount: number
  milestoneCount: number
  currentTaskCount: number
  laterTaskCount: number
  currentTaskIds: string[]
  laterTaskIds: string[]
  currentReleaseId: string | null
  releases: ProjectSummaryApprovedPlanRelease[]
}

export interface ProjectSummaryProjection {
  version: typeof PROJECT_SUMMARY_PROJECTION_VERSION
  projectId: string | null
  generatedAt: string
  freshness: 'current' | 'stale' | 'error'
  source: {
    taskQueueLastUpdated: string | null
    taskQueueMtimeMs: number | null
    workspaceGoalsMtimeMs: number | null
  }
  counts: {
    total: number
    active: number
    draftReview: number
    blocked: number
    done: number
    shelved: number
    included: number
    deferred: number
    ready: number
    paused: number
    ownerBlocked: number
    proofBlocked: number
    byStatus: Record<string, number>
  }
  scope: {
    id: string
    label: string
    kind: string
    source: string
    included: number
    deferred: number
    proofStyle?: 'script_only' | 'manual' | 'mixed' | 'unspecified'
  } | null
  orientation: ProjectOrientationSnapshot | null
  orientationSpine: ProjectOrientationSpine | null
  approvedPlan: ProjectSummaryApprovedPlan | null
  releaseSummary: ProjectSummaryReleaseSummary
  execution?: {
    status: 'running' | 'stopping' | 'stopped' | 'error' | string
    mode?: 'continuous' | 'one_task' | string
    startedAt?: string | null
    stoppedAt?: string | null
    stopRequestedAt?: string | null
    error?: string | null
    updatedAt: string
  }
  runtime?: {
    status: string
    health?: string | null
    lastActivityAt?: string | null
    updatedAt: string
  }
  ownerInput?: {
    openCount: number
    next?: {
      id: string
      label?: string
      prompt: string
      taskId?: string
      href?: string
    } | null
    updatedAt: string
  }
  nextAction: {
    code?: string
    label: ProjectScopeProjection['start']['label'] | 'Review project state'
    message: string
    count?: number
    focusTaskId?: string
    focusTaskTitle?: string
    focusKind?: string
  }
  blockers: Array<{
    id: string
    label: string
    owningTaskId?: string
  }>
  recentWork: Array<{
    taskId: string
    title: string
    status: string
    updatedAt: string | null
  }>
  inFlight: Array<{
    taskId: string
    title: string
    status: string
    domain: string
    updatedAt: string | null
  }>
  actionModel?: ProjectActionModel | null
  error?: string
}

export interface ProjectSummaryReleaseSummary {
  scopeMode: 'named_release' | 'unreleased' | 'unavailable'
  release: {
    id: string
    label: string
    kind: string
    state: string
    source: string
  } | null
  state: 'ready' | 'blocked' | 'active' | 'shaping' | 'unknown'
  counts: {
    total: number
    done: number
    unfinished: number
    ready: number
    active: number
    blocked: number
    deferred: number
    ownerBlocked: number
    proofBlocked: number
  }
  /** Mutually partitioned raw task statuses for the selected execution rows. */
  taskStatusCounts: Record<string, number>
  blockers: Array<{
    id: string
    label: string
    owningTaskId?: string
  }>
  updatedAt: string
}

type IndexedCurrentProof = {
  state: 'none' | 'needed' | 'partial' | 'proven'
  expectationCount: number
  verified: string[]
  missing: string[]
  hasExecutablePath?: boolean
}

function indexedCurrentProofForTask(task: ProjectStateDatabaseTask): IndexedCurrentProof | undefined {
  const currentSummary = isRecord(task.currentSummary) ? task.currentSummary : null
  const proof = currentSummary && isRecord(currentSummary.proof) ? currentSummary.proof : null
  if (!proof) return undefined
  const state = proof.state
  if (state !== 'none' && state !== 'needed' && state !== 'partial' && state !== 'proven') return undefined
  return {
    state,
    expectationCount: typeof proof.expectationCount === 'number' ? proof.expectationCount : 0,
    verified: Array.isArray(proof.verified) ? proof.verified.filter((value): value is string => typeof value === 'string') : [],
    missing: Array.isArray(proof.missing) ? proof.missing.filter((value): value is string => typeof value === 'string') : [],
    ...(proof.hasExecutablePath === true ? { hasExecutablePath: true } : {}),
  }
}

function indexedTaskHasCompletionProofGap(
  task: ProjectStateDatabaseTask,
  proof: IndexedCurrentProof | undefined,
): boolean {
  const status = String(task.status ?? '')
  if (status !== 'done' && status !== 'pending_pr') return false
  if (!proof) return false
  if (['needed', 'partial'].includes(proof.state)) return true
  // A compact point can legitimately say `none` while still carrying the
  // acceptance-criteria count. That is an unproven completed task, not a
  // task with no proof contract.
  return proof.state === 'none' && Number(task.currentSummary?.acceptanceCriteriaCount ?? 0) > 0
}

function indexedTaskCompletionChildren(
  task: ProjectStateDatabaseTask,
  tasksById: ReadonlyMap<string, ProjectStateDatabaseTask>,
): ProjectStateDatabaseTask[] {
  const childIds = new Set(
    [...tasksById.values()]
      .filter(candidate => candidate.parentId === task.id)
      .map(candidate => candidate.id),
  )
  const hierarchyChildIds = task.hierarchy?.childIds
  if (Array.isArray(hierarchyChildIds)) {
    for (const childId of hierarchyChildIds) {
      if (typeof childId === 'string' && tasksById.has(childId)) childIds.add(childId)
    }
  }
  return [...childIds]
    .map(childId => tasksById.get(childId))
    .filter((child): child is ProjectStateDatabaseTask => Boolean(child))
    .filter(child => indexedIsMaterializedExecutionChild(task, child))
    .filter(child => !['archived', 'cancelled', 'shelved'].includes(String(child.status ?? '')))
}

function indexedIsMaterializedExecutionChild(
  parent: ProjectStateDatabaseTask,
  child: ProjectStateDatabaseTask,
): boolean {
  const relation = isRecord(child.hierarchy) && child.hierarchy.relation === 'decomposes'
  return relation || child.id.startsWith(`${parent.id}-split-`)
}

/**
 * Indexed summaries carry enough graph and proof state to preserve the same
 * parent/child completion rule as the rich scope projection. A completed
 * parent is not a second proof obligation when every materialized child is
 * terminal and either proven or satisfied by its own children.
 */
function indexedTaskCompletionProofSatisfiedByLinkedChildren(
  task: ProjectStateDatabaseTask,
  tasksById: ReadonlyMap<string, ProjectStateDatabaseTask>,
  proofByTaskId: ReadonlyMap<string, IndexedCurrentProof>,
  visiting = new Set<string>(),
): boolean {
  if (visiting.has(task.id)) return false
  const children = indexedTaskCompletionChildren(task, tasksById)
  if (children.length === 0) return false
  const nextVisiting = new Set(visiting).add(task.id)
  return children.every(child => {
    const status = String(child.status ?? '')
    if (status !== 'done' && status !== 'pending_pr') return false
    if (!indexedTaskHasCompletionProofGap(child, proofByTaskId.get(child.id))) return true
    return indexedTaskCompletionProofSatisfiedByLinkedChildren(child, tasksById, proofByTaskId, nextVisiting)
  })
}

function indexedTaskProofBlocked(
  task: ProjectStateDatabaseTask,
  proof: IndexedCurrentProof | undefined,
  tasksById: ReadonlyMap<string, ProjectStateDatabaseTask>,
  proofByTaskId: ReadonlyMap<string, IndexedCurrentProof>,
): boolean {
  if (indexedTaskCompletionProofSatisfiedByLinkedChildren(task, tasksById, proofByTaskId)) return false
  return indexedTaskHasCompletionProofGap(task, proof)
}

export function applyOwnerInputToStartReadiness(
  start: ReturnType<typeof summarizeProjectScopeStart>,
  ownerInput: ProjectSummaryProjection['ownerInput'] | null | undefined,
): ReturnType<typeof summarizeProjectScopeStart> {
  if (!ownerInput || ownerInput.openCount <= 0) return start
  const label = ownerInput.next?.label?.trim() || ownerInput.next?.taskId || 'This decision'
  const count = ownerInput.openCount
  return {
    ...start,
    canStart: false,
    code: 'owner_input_required',
    label: 'Answer in Thread',
    message: count === 1
      ? `${label} needs your answer before work can continue`
      : `${count} owner decisions need your answer before work can continue`,
    actionHref: ownerInput.next?.href ?? '/thread',
    ...(ownerInput.next?.taskId ? { focusTaskId: ownerInput.next.taskId } : {}),
    focusKind: 'owner_input',
    count,
  } as ReturnType<typeof summarizeProjectScopeStart>
}

export interface ProjectSummaryProjectionInput {
  projectId?: string | null
  projectRoot?: string
  queue: TaskQueueModel
  /** Current overlay/evidence facts used for derived counts and readiness. */
  projectionTasks?: TaskQueueModel['tasks']
  generatedAt?: string
  taskQueueMtimeMs?: number | null
  workspaceGoalsMtimeMs?: number | null
  approvedPlan?: ProjectSummaryApprovedPlan | null
  orientation?: ProjectOrientationSnapshot | null
  execution?: ProjectSummaryProjection['execution']
  runtime?: ProjectSummaryProjection['runtime']
  ownerInput?: ProjectSummaryProjection['ownerInput']
  expectedQueueRevision?: number | null
  /** Promoted projects read current scope only from normalized SQLite rows. */
  currentStateAuthority?: 'database' | 'legacy'
  /** Migration-only request to preserve the retired queue sidecar. */
  compatibilityExport?: 'full' | 'compact'
}

export function projectSummaryProjectionPath(tasksPath: string): string {
  return join(dirname(tasksPath), PROJECT_SUMMARY_PROJECTION_FILE)
}

/**
 * Give the compact read model the release envelope already described by an
 * approved plan. This is an in-memory projection only: the queue remains the
 * authoritative execution record and is never mutated here.
 */
export function queueForProjectSummaryScope(
  queue: TaskQueueModel,
  approvedPlan: ProjectSummaryApprovedPlan | null | undefined,
): TaskQueueModel {
  if (!approvedPlan || approvedPlan.releases.length === 0) return queue
  const currentTaskIds = new Set(
    queue.tasks
      .filter(task => !['archived', 'cancelled'].includes(String(task.status ?? '')))
      .map(task => task.id),
  )
  const planTaskIds = new Set([...approvedPlan.currentTaskIds, ...approvedPlan.laterTaskIds])
  const knownPlanTaskIds = new Set([...planTaskIds].filter(taskId => currentTaskIds.has(taskId)))
  const knownCurrentTaskIds = new Set(approvedPlan.currentTaskIds.filter(taskId => currentTaskIds.has(taskId)))
  const knownLaterTaskIds = new Set(approvedPlan.laterTaskIds.filter(taskId => currentTaskIds.has(taskId)))
  // An approved plan can seed a release before the queue has materialized its
  // assignments. Once the queue has explicit membership, keep that membership
  // authoritative; otherwise a stale plan row can silently become runnable.
  const queueOwnsReleaseMembership = (releaseId: string): boolean =>
    (queue.releases ?? []).some(release => release.id === releaseId && [
      ...(release.nodeIds ?? []),
      ...(release.deferredNodeIds ?? []),
    ].some(nodeId => currentTaskIds.has(nodeId.replace(/^work:/, '')))) ||
    queue.tasks.some(task => currentTaskIds.has(task.id) && task.releaseIds?.includes(releaseId) === true)
  const currentReleaseId = approvedPlan.currentReleaseId ??
    approvedPlan.releases.find(release => release.currentTaskIds.some(taskId => knownCurrentTaskIds.has(taskId)))?.id ??
    null
  // Workspace import plans are snapshots, not a second task identity system.
  // If an intake refresh replaced task IDs, keep real queue work current and
  // discard phantom plan references instead of turning the project into an
  // apparently complete release with zero included work.
  const unassignedCurrentTaskIds = [...currentTaskIds].filter(taskId =>
    !knownPlanTaskIds.has(taskId) &&
    !knownLaterTaskIds.has(taskId) &&
    queue.tasks.find(task => task.id === taskId)?.status !== 'shelved',
  )
  const existingById = new Map((queue.releases ?? []).map(release => [release.id, release]))
  const planReleases: ProjectRelease[] = approvedPlan.releases.map(release => {
    const existing = existingById.get(release.id)
    const kind: ProjectRelease['kind'] = release.kind === 'milestone' ? 'milestone' : 'release'
    const source: ProjectRelease['source'] = release.source === 'release_plan' ||
      release.source === 'spec' || release.source === 'inferred'
      ? release.source
      : 'owner_approved'
    const state: ProjectRelease['state'] = release.state === 'planned'
      ? 'planned'
      : release.state === 'completed'
        ? 'shipped'
        : release.state === 'archived'
          ? 'deferred'
          : release.state === 'ready' || release.state === 'shipped' || release.state === 'deferred'
            ? release.state
            : 'active'
    return {
      ...(existing ?? {
        id: release.id,
        label: release.label,
        kind,
        state,
        source,
        proofStyle: 'unspecified',
        nodeIds: [],
        deferredNodeIds: [],
      }),
      id: release.id,
      label: existing?.label ?? release.label,
      kind: existing?.kind ?? kind,
      state: existing?.state ?? state,
      source: existing?.source ?? source,
      nodeIds: [
        ...(existing?.nodeIds ?? []).filter(nodeId => currentTaskIds.has(nodeId.replace(/^work:/, ''))),
        ...(queueOwnsReleaseMembership(release.id)
          ? []
          : release.currentTaskIds
              .filter(taskId => currentTaskIds.has(taskId))
              .map(taskId => `work:${taskId}`)),
        ...(queueOwnsReleaseMembership(release.id) || release.id !== currentReleaseId
          ? []
          : unassignedCurrentTaskIds.map(taskId => `work:${taskId}`)),
      ].filter((nodeId, index, all) => all.indexOf(nodeId) === index),
      deferredNodeIds: [
        ...(existing?.deferredNodeIds ?? []).filter(nodeId => currentTaskIds.has(nodeId.replace(/^work:/, ''))),
        ...(queueOwnsReleaseMembership(release.id)
          ? []
          : release.laterTaskIds
              .filter(taskId => currentTaskIds.has(taskId))
              .map(taskId => `work:${taskId}`)),
      ].filter((nodeId, index, all) => all.indexOf(nodeId) === index),
    }
  })
  const releases = [
    ...planReleases,
    ...(queue.releases ?? []).filter(release => !planReleases.some(candidate => candidate.id === release.id)),
  ]
  return {
    ...queue,
    releases,
    ...(queue.selectedReleaseId || !approvedPlan.currentReleaseId
      ? {}
      : { selectedReleaseId: approvedPlan.currentReleaseId }),
  }
}

/**
 * The normalized work-scope table is the durable detail read model. Keep the
 * complete selected-scope ledger out of the summary JSON so Work can page
 * task rows without asking a GET to rebuild scope from the whole queue.
 */
export function projectSummaryScopeRowsForQueue(
  queue: TaskQueueModel,
  approvedPlan: ProjectSummaryApprovedPlan | null | undefined,
  projectionTasks?: TaskQueueModel['tasks'],
  options: { currentStateAuthority?: 'database' | 'legacy' } = {},
): ProjectStateDatabaseScopeRow[] {
  const projectionQueue = projectionTasks ? { ...queue, tasks: projectionTasks } : queue
  const scopeQueue = options.currentStateAuthority === 'database'
    ? projectionQueue
    : queueForProjectSummaryScope(projectionQueue, approvedPlan)
  const scopeProjection = buildProjectScopeProjection(scopeQueue)
  // Persist the complete membership graph. Execution rows are a derived view
  // that may replace a parent with an active child; dropping the parent here
  // would make Release/Map lose the actual selected-scope envelope.
  return scopeProjection.rows.map(row => ({
    taskId: row.taskId,
    ...(row.parentTaskId ? { parentTaskId: row.parentTaskId } : {}),
    scope: row.scope,
    ...(row.countInProjectTotals === false ? { countInProjectTotals: false } : {}),
    eligibilityReason: row.eligibilityReason,
    hierarchyRole: row.hierarchyRole,
    handoffState: row.handoffState,
    blocksStart: row.blocksStart,
    blocksRelease: row.blocksRelease,
    humanBlocking: row.humanBlocking,
    proofBlocked: row.proofBlocked,
    ...(row.blockerSummary ? { blockerSummary: row.blockerSummary } : {}),
    sourceRefs: [...row.sourceRefs],
  }))
}

export function buildProjectSummaryProjection(
  input: ProjectSummaryProjectionInput,
): ProjectSummaryProjection {
  const generatedAt = input.generatedAt ?? new Date().toISOString()
  const approvedPlan = input.approvedPlan ?? null
  const projectionQueue = input.projectionTasks ? { ...input.queue, tasks: input.projectionTasks } : input.queue
  const currentStateAuthority = input.currentStateAuthority ?? (
    input.projectRoot && readProjectStateDatabaseCurrentAuthority(input.projectRoot) === 'database' ? 'database' : 'legacy'
  )
  const scopeQueue = currentStateAuthority === 'database'
    ? projectionQueue
    : queueForProjectSummaryScope(projectionQueue, approvedPlan)
  const scopeProjection = buildProjectScopeProjection(scopeQueue)
  const tasks = projectionQueue.tasks
  const rawCounts = summarizeRawTaskCounts(tasks)
  const selectedScope = scopeProjection.selectedScope
  const releaseSummary = buildReleaseSummary({
    queue: scopeQueue,
    scopeProjection,
    generatedAt,
  })
  const start = applyOwnerInputToStartReadiness(scopeProjection.start, input.ownerInput)
  const orientationSpine = compactProjectOrientationSpineForMap(buildProjectOrientationSpine({
    projectId: input.projectId ?? '',
    now: generatedAt,
    charter: input.orientation?.charter ?? null,
    selectedReleaseId: scopeQueue.selectedReleaseId,
    releases: scopeQueue.releases,
    tasks: scopeQueue.tasks,
    scopeProjection,
    startReadiness: start,
    releaseReadiness: { blockers: scopeProjection.release.blockers },
    runStatus: input.execution?.status ?? 'stopped',
    runMode: input.execution?.mode,
    sourceRefs: input.orientation?.sourceRefs ?? [],
  }))
  const recentWork = recentWorkForTasks(tasks)
  const nextAction = {
    ...(start.code ? { code: start.code } : {}),
    label: start.label,
    message: start.message,
    ...(typeof start.count === 'number' ? { count: start.count } : {}),
    ...(start.focusTaskId ? { focusTaskId: start.focusTaskId } : {}),
    ...(start.focusTaskTitle ? { focusTaskTitle: start.focusTaskTitle } : {}),
    ...(start.focusKind ? { focusKind: start.focusKind } : {}),
  }
  const startReadiness = {
    canStart: start.canStart,
    ...(nextAction.code ? { code: nextAction.code } : {}),
    message: nextAction.message,
    ...(start.focusTaskId ? { focusTaskId: start.focusTaskId } : {}),
    ...(start.focusTaskTitle ? { focusTaskTitle: start.focusTaskTitle } : {}),
    ...(start.focusKind ? { focusKind: start.focusKind } : {}),
    ...(typeof start.count === 'number' ? { count: start.count } : {}),
    executionScope: selectedScope
      ? {
          id: selectedScope.id,
          label: selectedScope.label,
          kind: selectedScope.kind,
          source: selectedScope.source,
          taskCount: scopeProjection.counts.included,
          deferredTaskCount: scopeProjection.counts.deferred,
        }
      : undefined,
  }
  const actionModel = buildProjectActionModel({
    startReadiness,
    ownerInput: input.ownerInput && input.ownerInput.openCount > 0
      ? {
          active: true,
          label: 'Answer in Thread',
          detail: input.ownerInput.next?.prompt ?? 'Open the thread to answer the current question.',
          href: input.ownerInput.next?.href ?? '/thread',
        }
      : null,
    runStatus: input.execution?.status ?? 'stopped',
    runMode: input.execution?.mode,
    tasks: [
      ...(nextAction.focusTaskId
        ? [{
            id: nextAction.focusTaskId,
            title: nextAction.focusTaskTitle ?? nextAction.focusTaskId,
            status: nextAction.code === 'ready_work' ? 'ready' : 'blocked',
          }]
        : []),
      ...recentWork.map(task => ({ id: task.taskId, title: task.title, status: task.status })),
    ].filter((task, index, all) => all.findIndex(candidate => candidate.id === task.id) === index),
  })

  return {
    version: PROJECT_SUMMARY_PROJECTION_VERSION,
    projectId: input.projectId ?? null,
    generatedAt,
    freshness: 'current',
    source: {
      taskQueueLastUpdated: input.queue.lastUpdated ?? null,
      taskQueueMtimeMs: input.taskQueueMtimeMs ?? null,
      workspaceGoalsMtimeMs: input.workspaceGoalsMtimeMs ?? null,
    },
    counts: {
      ...rawCounts,
      included: scopeProjection.counts.included,
      deferred: scopeProjection.counts.deferred,
      ready: scopeProjection.counts.ready,
      paused: scopeProjection.counts.paused,
      ownerBlocked: scopeProjection.counts.ownerBlocked,
      proofBlocked: scopeProjection.counts.proofBlocked,
    },
    scope: selectedScope
      ? {
          id: selectedScope.id,
          label: selectedScope.label,
          kind: selectedScope.kind,
          source: selectedScope.source,
          included: scopeProjection.counts.included,
          deferred: scopeProjection.counts.deferred,
          ...(selectedScope.proofStyle ? { proofStyle: selectedScope.proofStyle } : {}),
        }
      : null,
    orientation: input.orientation ?? null,
    orientationSpine,
    approvedPlan,
    releaseSummary,
    ...(input.execution ? { execution: input.execution } : {}),
    ...(input.runtime ? { runtime: input.runtime } : {}),
    ...(input.ownerInput ? { ownerInput: input.ownerInput } : {}),
    nextAction,
    blockers: scopeProjection.release.blockers,
    recentWork,
    inFlight: inFlightForTasks(tasks),
    actionModel,
  }
}

type IndexedSummaryScopeRow = Omit<ProjectStateDatabaseScopeRow, 'parentTaskId'> & {
  title: string
  parentTaskId: string | null
  status: string
}

function taskStatusCounts(rows: readonly { status?: unknown }[]): Record<string, number> {
  return rows.reduce<Record<string, number>>((counts, row) => {
    const status = typeof row.status === 'string' && row.status.trim() ? row.status : 'unknown'
    counts[status] = (counts[status] ?? 0) + 1
    return counts
  }, {})
}

function indexedExecutionRows(rows: readonly IndexedSummaryScopeRow[]): IndexedSummaryScopeRow[] {
  return executionScopeRows(indexedScopeRowsAsProjectScopeRows(rows)) as unknown as IndexedSummaryScopeRow[]
}

function indexedScopeRowsAsProjectScopeRows(rows: readonly IndexedSummaryScopeRow[]): ProjectScopeRow[] {
  return rows.map(row => normalizeProjectScopeRowReadModel({
    ...row,
    parentTaskId: row.parentTaskId ?? undefined,
    status: row.status as ProjectScopeRow['status'],
    eligibilityReason: row.eligibilityReason as ProjectScopeRow['eligibilityReason'],
    hierarchyRole: row.hierarchyRole as ProjectScopeRow['hierarchyRole'],
    handoffState: row.handoffState as ProjectScopeRow['handoffState'],
  } as unknown as ProjectScopeRow))
}

function indexedScopeSource(value: unknown): ProjectScope['source'] {
  return value === 'owner_approved' || value === 'spec' || value === 'release_plan' || value === 'inferred'
    ? value
    : 'inferred'
}

function indexedProofStyle(value: unknown): ProjectScope['proofStyle'] | undefined {
  return value === 'script_only' || value === 'manual' || value === 'mixed' || value === 'unspecified'
    ? value
    : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function indexedStartReadiness(
  rows: readonly IndexedSummaryScopeRow[],
  releases: readonly Record<string, unknown>[],
  selectedReleaseId: string | null,
  tasks: readonly ProjectStateDatabaseTask[],
): ProjectScopeProjection['start'] {
  const setupTask = tasks.find(task =>
    ['task-meta-intake', 'task-workspace-import'].includes(task.id) &&
    !['done', 'pending_pr', 'archived', 'cancelled'].includes(String(task.status ?? '')),
  )
  const selectedRelease = releases.find(release => release.id === selectedReleaseId)
  const selectedScope = selectedRelease
    ? {
        id: selectedReleaseId ?? String(selectedRelease.id),
        label: String(selectedRelease.label ?? selectedRelease.id),
        kind: selectedRelease.kind === 'milestone' ? 'milestone' as const : 'release' as const,
        source: indexedScopeSource(selectedRelease.source),
        nodeIds: Array.isArray(selectedRelease.nodeIds)
          ? selectedRelease.nodeIds.filter((value): value is string => typeof value === 'string')
          : [],
        deferredNodeIds: Array.isArray(selectedRelease.deferredNodeIds)
          ? selectedRelease.deferredNodeIds.filter((value): value is string => typeof value === 'string')
          : [],
        ...(indexedProofStyle(selectedRelease.proofStyle)
          ? { proofStyle: indexedProofStyle(selectedRelease.proofStyle) }
          : {}),
      }
    : null
  return summarizeProjectScopeStart(
    rows as unknown as ProjectScopeRow[],
    selectedScope,
    setupTask as Pick<Task, 'id' | 'title' | 'status'> | undefined,
  )
}

function indexedActionTasks(
  tasks: readonly ProjectStateDatabaseTask[],
  rowsByTaskId: ReadonlyMap<string, IndexedSummaryScopeRow>,
): Parameters<typeof buildProjectActionModel>[0]['tasks'] {
  return tasks.map(task => {
    const taskRecord = task as unknown as Record<string, unknown>
    const currentSummary: Record<string, unknown> = isRecord(taskRecord.currentSummary) ? taskRecord.currentSummary : {}
    const briefSummary: Record<string, unknown> = isRecord(currentSummary.brief) ? currentSummary.brief : {}
    const acceptanceCount = Number(currentSummary.acceptanceCriteriaCount ?? taskRecord.acceptanceCriteriaCount ?? 0)
    const row = rowsByTaskId.get(task.id)
    return {
      id: task.id,
      title: task.title,
      description: task.description ?? undefined,
      status: task.status ?? undefined,
      updatedAt: task.updatedAt ?? undefined,
      dependsOn: task.dependsOn,
      blockReason: typeof taskRecord.blockReason === 'string' ? taskRecord.blockReason : undefined,
      hierarchy: task.hierarchy ? {
        parentId: typeof task.hierarchy.parentId === 'string' ? task.hierarchy.parentId : undefined,
        childIds: Array.isArray(task.hierarchy.childIds) ? task.hierarchy.childIds.filter((id): id is string => typeof id === 'string') : undefined,
      } : undefined,
      needsBriefCleanup: row?.handoffState === 'brief_cleanup' || row?.handoffState === 'not_shaped',
      spec: taskRecord.spec === 'present' || row?.handoffState === 'ready' ? 'indexed-present' : undefined,
      acceptanceCriteria: Array.from({ length: Number.isFinite(acceptanceCount) ? acceptanceCount : 0 }, () => ({})),
      productBrief: briefSummary.present
        ? {
            approvedAt: typeof briefSummary.approvedAt === 'string' ? briefSummary.approvedAt : undefined,
            userJob: briefSummary.userJob ? 'indexed-present' : undefined,
            whyItMattersNow: briefSummary.shaped ? 'indexed-present' : undefined,
            successMetric: briefSummary.successMetric ? 'indexed-present' : undefined,
            nonGoals: briefSummary.shaped ? ['indexed-present'] : undefined,
          }
        : undefined,
    }
  })
}

/**
 * Refresh the project summary from compact indexed rows only. This is the
 * normal post-mutation path for detail changes: it never opens task detail
 * blobs, reconstructs a queue, reads transcripts, or invokes an LLM.
 */
export function buildProjectSummaryProjectionFromIndexedState(
  tasksPath: string,
  input: {
    projectId?: string | null
    generatedAt?: string
    sourceQueueLastUpdated?: string | null
    taskOverrides?: readonly ProjectStateDatabaseTask[]
    scopeRowOverrides?: readonly (ProjectStateDatabaseScopeRow | null)[]
  },
): ProjectSummaryProjection | null {
  const current = readProjectStateDatabaseProjectionState<ProjectSummaryProjection>(tasksPath, {
    includeDefinitions: false,
  })
  if (!current?.summary) return null
  const base = current.summary.payload
  const generatedAt = input.generatedAt ?? new Date().toISOString()
  // Indexed refreshes cannot rebuild the rich orientation tree, but that is
  // not a reason to skip the compact summary. Promoted projects can predate
  // the spine; their counts, release state, action model, and scope rows are
  // still fully derivable from the indexed queue/points and must be refreshed
  // through this same boundary.
  const inventory = current.inventory
  const queue = current.queue
  const releases = queue.releases as readonly Record<string, unknown>[]
  const selectedReleaseId = queue.selectedReleaseId ?? null
  const taskOverrides = new Map((input.taskOverrides ?? []).map(task => [task.id, task]))
  const tasks = inventory.tasks.map(task => taskOverrides.get(task.id) ?? task)
  const tasksById = new Map(tasks.map(task => [task.id, task]))
  const scopeRowOverrides = new Map(
    (input.scopeRowOverrides ?? []).map(row => [row?.taskId ?? '', row]),
  )
  const rawIndexedRows: IndexedSummaryScopeRow[] = tasks.flatMap<IndexedSummaryScopeRow>(task => {
    const row = scopeRowOverrides.has(task.id) ? scopeRowOverrides.get(task.id) ?? null : task.scopeRow
    return row
      ? [{
          ...row,
          title: task.title,
          parentTaskId: task.parentId,
          status: task.status ?? 'unknown',
        } satisfies IndexedSummaryScopeRow]
      : []
  })
  const indexedRows: IndexedSummaryScopeRow[] = rawIndexedRows.map(row =>
    indexedScopeRowsAsProjectScopeRows([row])[0] as unknown as IndexedSummaryScopeRow,
  )
  const currentProofByTaskId = new Map<string, IndexedCurrentProof>(
    tasks.flatMap(task => {
      const proof = indexedCurrentProofForTask(task)
      return proof ? [[task.id, proof] as const] : []
    }),
  )
  // Indexed task points carry the compact proof summary, not the rich
  // completion payload. Apply that summary to the same scope-row authority
  // used by Release/Overview so a task detail read cannot say "proof needed"
  // while the saved release projection counts the task as releasable. The
  // persisted scope bit is only a cache: evidence can update the proof point
  // without rewriting every derived row, so never let that older bit override
  // the current indexed proof answer.
  const rows = indexedRows.map(row => {
    const indexedTask = tasksById.get(row.taskId)
    const explicitRow = scopeRowOverrides.get(row.taskId)
    const indexedProofGap = indexedTask
      ? indexedTaskProofBlocked(indexedTask, currentProofByTaskId.get(row.taskId), tasksById, currentProofByTaskId)
      : false
    const proofBlocked = currentProofByTaskId.has(row.taskId)
      ? indexedProofGap
      : Boolean(explicitRow?.proofBlocked ?? row.proofBlocked)
    // Scope rows are persisted projections, not a second source of proof
    // truth. Re-normalize their release flags from the current compact task
    // point so an old proof blocker cannot survive after a linked child closes.
    return indexedScopeRowsAsProjectScopeRows([{
      ...row,
      proofBlocked,
      ...(proofBlocked ? { blockerSummary: 'Completion proof is missing or stale.' } : {}),
    }])[0] as unknown as IndexedSummaryScopeRow
  })
  const rowsByTaskId = new Map(rows.map(row => [row.taskId, row]))
  const executionRows = indexedExecutionRows(rows)
  const includedRows = executionRows.filter(row => row.scope === 'included')
  const deferredRows = executionRows.filter(row => row.scope === 'deferred')
  const start = applyOwnerInputToStartReadiness(
    indexedStartReadiness(rows, releases, selectedReleaseId, tasks),
    base.ownerInput,
  )
  const nextAction: ProjectSummaryProjection['nextAction'] = {
    ...(start.code ? { code: start.code } : {}),
    label: start.label,
    message: start.message,
    ...(typeof start.count === 'number' ? { count: start.count } : {}),
    ...(start.focusTaskId ? { focusTaskId: start.focusTaskId } : {}),
    ...(start.focusTaskTitle ? { focusTaskTitle: start.focusTaskTitle } : {}),
    ...(start.focusKind ? { focusKind: start.focusKind } : {}),
  }
  const selectedReleaseRow = releases.find(release => release.id === selectedReleaseId) ?? null
  // The saved summary is the current release read model. Preserve its
  // metadata while refreshing counts from indexed rows so a read cannot
  // rename a release merely because a lower-level scope row carries a
  // normalized display label.
  const priorRelease = base.releaseSummary?.release
  const selectedRelease = selectedReleaseRow && priorRelease?.id === selectedReleaseRow.id
    ? { ...selectedReleaseRow, ...priorRelease }
    : selectedReleaseRow
  const indexedRelease = summarizeProjectScopeRelease(indexedScopeRowsAsProjectScopeRows(rows))
  const taskReleaseBlockers = indexedRelease.blockers
  const releaseExecutionRows = includedRows.filter(row => row.hierarchyRole !== 'parent' || !includedRows.some(child => child.parentTaskId === row.taskId))
  const releaseSummary: ProjectSummaryReleaseSummary = {
    scopeMode: selectedRelease ? 'named_release' : 'unreleased',
    release: selectedRelease
      ? {
          id: String(selectedRelease.id),
          label: String(selectedRelease.label ?? selectedRelease.id),
          kind: String(selectedRelease.kind ?? 'release'),
          state: String(selectedRelease.state ?? 'active'),
          source: String(selectedRelease.source ?? 'inferred'),
        }
      : null,
    state: indexedRelease.state,
    counts: {
      total: releaseExecutionRows.length,
      done: releaseExecutionRows.filter(row => row.handoffState === 'done').length,
      unfinished: releaseExecutionRows.filter(row => row.handoffState !== 'done').length,
      ready: releaseExecutionRows.filter(row => row.handoffState === 'ready').length,
      active: releaseExecutionRows.filter(row => ['paused', 'review'].includes(row.handoffState)).length,
      blocked: releaseExecutionRows.filter(row => row.blocksRelease).length,
      deferred: deferredRows.length,
      ownerBlocked: releaseExecutionRows.filter(row => projectScopeRowNeedsOwnerInput({
        scope: row.scope,
        status: row.status as ProjectScopeRow['status'],
        handoffState: row.handoffState as ProjectScopeRow['handoffState'],
        humanBlocking: row.humanBlocking,
      })).length,
      proofBlocked: releaseExecutionRows.filter(row => row.proofBlocked).length,
    },
    taskStatusCounts: taskStatusCounts(releaseExecutionRows),
    blockers: taskReleaseBlockers,
    updatedAt: generatedAt,
  }
  const rawCounts = summarizeRawTaskCounts(tasks)
  const actionModel = buildProjectActionModel({
    startReadiness: {
      canStart: start.canStart,
      ...(start.code ? { code: start.code } : {}),
      message: start.message,
      ...(start.focusTaskId ? { focusTaskId: start.focusTaskId } : {}),
      ...(start.focusTaskTitle ? { focusTaskTitle: start.focusTaskTitle } : {}),
      ...(start.focusKind ? { focusKind: start.focusKind } : {}),
      ...(start.count ? { count: start.count } : {}),
      executionScope: selectedRelease
        ? {
            id: String(selectedRelease.id),
            label: String(selectedRelease.label ?? selectedRelease.id),
            kind: String(selectedRelease.kind ?? 'release'),
            source: typeof selectedRelease.source === 'string' ? selectedRelease.source : undefined,
            taskCount: includedRows.length,
            deferredTaskCount: deferredRows.length,
          }
        : undefined,
    },
    ownerInput: base.ownerInput && base.ownerInput.openCount > 0
      ? {
          active: true,
          label: 'Answer in Thread',
          detail: base.ownerInput.next?.prompt ?? 'Open the thread to answer the current question.',
          href: base.ownerInput.next?.href ?? '/thread',
        }
      : null,
    runStatus: base.execution?.status ?? 'stopped',
    tasks: indexedActionTasks(tasks, rowsByTaskId),
  })
  const scope = selectedRelease
    ? {
        id: String(selectedRelease.id),
        label: String(selectedRelease.label ?? selectedRelease.id),
        kind: String(selectedRelease.kind ?? 'release'),
        source: indexedScopeSource(selectedRelease.source),
        included: includedRows.length,
        deferred: deferredRows.length,
        ...(indexedProofStyle(selectedRelease.proofStyle)
          ? { proofStyle: indexedProofStyle(selectedRelease.proofStyle) }
          : {}),
      }
    : null
  const currentOrientationSpine = synchronizeIndexedOrientationSpine(base.orientationSpine, {
    generatedAt,
    releaseSummary,
    rows,
    nextAction,
    currentProofByTaskId,
  })
  return {
    ...base,
    version: PROJECT_SUMMARY_PROJECTION_VERSION,
    projectId: input.projectId ?? base.projectId,
    generatedAt,
    freshness: 'current',
    source: {
      ...base.source,
      taskQueueLastUpdated: input.sourceQueueLastUpdated ?? base.source.taskQueueLastUpdated,
    },
    counts: {
      ...rawCounts,
      included: includedRows.length,
      deferred: deferredRows.length,
      ready: includedRows.filter(row => row.handoffState === 'ready').length,
      paused: includedRows.filter(row => row.handoffState === 'paused').length,
      ownerBlocked: includedRows.filter(row => projectScopeRowNeedsOwnerInput({
        scope: row.scope,
        status: row.status as ProjectScopeRow['status'],
        handoffState: row.handoffState as ProjectScopeRow['handoffState'],
        humanBlocking: row.humanBlocking,
      })).length,
      proofBlocked: includedRows.filter(row => row.proofBlocked).length,
    },
    scope,
    orientationSpine: currentOrientationSpine,
    releaseSummary,
    nextAction,
    blockers: taskReleaseBlockers,
    recentWork: recentWorkForTasks(tasks.map(task => ({
      id: task.id,
      title: task.title,
      status: task.status,
      ...(task.updatedAt ? { updatedAt: task.updatedAt } : {}),
    }))),
    inFlight: inFlightForTasks(tasks.map(task => ({
      id: task.id,
      title: task.title,
      status: task.status,
      domain: task.domain ?? undefined,
      ...(task.updatedAt ? { updatedAt: task.updatedAt } : {}),
    }))),
    actionModel,
  }
}

/**
 * Indexed refreshes do not reopen task detail blobs, so they cannot rebuild
 * every rich orientation node. They can, however, update the release-level
 * facts that every compact surface is required to share. Keeping this small
 * synchronization here prevents the stored spine from becoming a second
 * status authority when evidence refreshes the summary projection.
 */
function synchronizeIndexedOrientationSpine(
  spine: ProjectSummaryProjection['orientationSpine'],
  input: {
    generatedAt: string
    releaseSummary: ProjectSummaryReleaseSummary
    rows: readonly IndexedSummaryScopeRow[]
    nextAction: ProjectSummaryProjection['nextAction']
    currentProofByTaskId: ReadonlyMap<string, IndexedCurrentProof>
  },
): ProjectSummaryProjection['orientationSpine'] {
  if (!spine) return null
  const blockers = input.releaseSummary.blockers.map(blocker => ({
    id: blocker.id,
    label: blocker.label,
    ...(blocker.owningTaskId ? { owningNodeId: `work:${blocker.owningTaskId}` } : {}),
  }))
  const releaseId = input.releaseSummary.release?.id ?? spine.selectedRelease?.id ?? null
  const releasePatch = input.releaseSummary.release
  const patchRelease = (release: (typeof spine.releases)[number]): (typeof spine.releases)[number] => release.id === releaseId
    ? {
        ...release,
        ...(releasePatch
          ? {
              label: releasePatch.label,
              kind: releasePatch.kind === 'milestone' ? 'milestone' as const : release.kind,
              source: releasePatch.source as typeof release.source,
            }
          : {}),
        state: input.releaseSummary.state,
      } as (typeof spine.releases)[number]
    : release
  const selectedRelease = (spine.selectedRelease && spine.selectedRelease.id === releaseId
    ? {
        ...spine.selectedRelease,
        ...(releasePatch
          ? {
              label: releasePatch.label,
              kind: releasePatch.kind === 'milestone' ? 'milestone' as const : spine.selectedRelease.kind,
              source: releasePatch.source as typeof spine.selectedRelease.source,
            }
          : {}),
        state: input.releaseSummary.state,
      }
    : spine.selectedRelease) as typeof spine.selectedRelease
  const rowById = new Map(input.rows.map(row => [row.taskId, row]))
  const scopeRows = spine.scopeRows.map(row => {
    const current = rowById.get(row.taskId)
    if (!current) return row
    return {
      ...row,
      scope: current.scope,
      status: current.status,
      handoffState: current.handoffState,
      blocksStart: current.blocksStart,
      blocksRelease: current.blocksRelease,
      humanBlocking: current.humanBlocking,
    }
  })
  const counts = input.releaseSummary.counts
  const label = input.releaseSummary.release?.label ?? spine.summary.selectedScopeLabel ?? 'Current scope'
  const selectedScope = (spine.selectedTaskScope ?? spine.scope) as ProjectScope | null
  const outsideWork = summarizeProjectScopeOutsideWork(input.rows as unknown as ProjectScopeRow[], selectedScope)
  const progress = {
    ...spine.summary.progress,
    scopeId: releaseId,
    total: counts.total + counts.deferred,
    done: counts.done,
    ready: counts.ready,
    active: counts.active,
    blocked: counts.blocked,
    deferred: counts.deferred,
    // A terminal task is not necessarily proven: script-only and review
    // releases can keep a done row blocked until the required evidence lands.
    proven: Math.max(0, counts.done - counts.proofBlocked),
  }
  const headline = input.releaseSummary.state === 'ready'
    ? `${label} is complete.`
    : input.releaseSummary.state === 'blocked'
      ? `${label} needs attention.`
      : `${label} is in progress.`
  const patchNode = (node: ProjectOrientationSpine['roots'][number]): ProjectOrientationSpine['roots'][number] => {
    const taskId = node.id.startsWith('work:') ? node.id.slice('work:'.length) : null
    const currentProof = taskId ? input.currentProofByTaskId.get(taskId) : undefined
    return {
      ...node,
      ...(currentProof
        ? {
            proof: {
              ...node.proof,
              state: currentProof.state,
              expectationCount: currentProof.expectationCount,
              verified: currentProof.verified,
              missing: currentProof.missing,
            },
          }
        : {}),
      children: node.children.map(patchNode),
    }
  }
  const proofContracts = spine.proofContracts.map(contract => {
    const taskId = contract.nodeId.startsWith('work:') ? contract.nodeId.slice('work:'.length) : null
    const currentProof = taskId ? input.currentProofByTaskId.get(taskId) : undefined
    if (!currentProof) return contract
    return {
      ...contract,
      state: currentProof.state,
      verified: currentProof.verified,
      missing: currentProof.missing.length > 0
        ? currentProof.missing
        : currentProof.state === 'proven' ? [] : contract.missing,
    }
  })
  return reconcileOrientationSpineWithReleaseTruth({
    ...spine,
    updatedAt: input.generatedAt,
    selectedRelease,
    releases: spine.releases.map(patchRelease),
    summary: {
      ...spine.summary,
      headline,
      selectedReleaseLabel: input.releaseSummary.release?.label ?? spine.summary.selectedReleaseLabel,
      selectedScopeLabel: label,
      includedCount: counts.total,
      includedWorkCount: counts.total,
      deferredCount: counts.deferred,
      deferredWorkCount: counts.deferred,
      topBlocker: input.nextAction.code === 'all_terminal' && outsideWork.count > 0
        ? input.nextAction.message
        : blockers[0]?.label ?? null,
      nextAction: input.nextAction.message,
      progress,
    },
    scopeRows,
    scopeRowCounts: {
      included: input.rows.filter(row => row.scope === 'included').length,
      deferred: input.rows.filter(row => row.scope === 'deferred').length,
    },
    release: {
      state: input.releaseSummary.state,
      blockers,
    },
    proofContracts,
    roots: spine.roots.map(patchNode),
    },
    {
      state: input.releaseSummary.state,
      counts: {
        total: counts.total,
        done: counts.done,
        unfinished: counts.unfinished,
        deferred: counts.deferred,
        proofBlocked: counts.proofBlocked,
      },
      blockers,
    },
  )
}

/**
 * Publish the compact summary from normalized current rows without opening
 * task detail blobs. This is the normal promoted-project refresh boundary;
 * queue reconstruction remains an explicit migration/detail operation.
 */
export function writeProjectSummaryProjectionFromIndexedState(
  tasksPath: string,
  input: Parameters<typeof buildProjectSummaryProjectionFromIndexedState>[1] & {
    expectedQueueRevision?: number | null
    expectedProjectRevision?: number | null
  },
): ProjectSummaryProjection | null {
  // Capture the source watermark before the potentially expensive projection
  // build. Reading it afterward would let a concurrent write become the
  // refresh token for a projection that was built from older rows.
  const capturedProjectRevision = input.expectedProjectRevision ?? readProjectStateDatabaseRevisionFromTasksPath(tasksPath)
  const projection = buildProjectSummaryProjectionFromIndexedState(tasksPath, input)
  if (!projection) return null
  const expectedProjectRevision = capturedProjectRevision
  const indexedState = readProjectStateDatabaseProjectionState(tasksPath, {
    includeDefinitions: false,
  })
  const taskById = new Map([
    ...(indexedState?.inventory.tasks ?? []),
    ...(input.taskOverrides ?? []),
  ].map(task => [task.id, task]))
  const currentProofByTaskId = new Map<string, IndexedCurrentProof>(
    [...taskById.values()].flatMap(task => {
      const proof = indexedCurrentProofForTask(task)
      return proof ? [[task.id, proof] as const] : []
    }),
  )
  const persistedScopeRows = (input.scopeRowOverrides
    ? input.scopeRowOverrides.filter(
        (row): row is ProjectStateDatabaseScopeRow => row !== null,
      )
    : indexedState?.scopeRows ?? [])
    .map(row => {
      const task = taskById.get(row.taskId)
      const proof = task ? indexedCurrentProofForTask(task) : undefined
      const proofBlocked = indexedTaskProofBlocked(task!, proof, taskById, currentProofByTaskId) ||
        (!proof && !currentProofByTaskId.has(task!.id) && Boolean(row.proofBlocked))
      const normalized = normalizeProjectScopeRowReadModel({
        ...row,
        title: task?.title ?? row.taskId,
        status: task?.status ?? 'unknown',
        ...(task?.parentId ? { parentTaskId: task.parentId } : {}),
        proofBlocked,
      } as unknown as ProjectScopeRow)
      const {
        title: _title,
        status: _status,
        parentTaskId,
        ...scopeRow
      } = normalized as ProjectScopeRow & { title?: string; status?: string; parentTaskId?: string | null }
      return {
        ...scopeRow,
        ...(parentTaskId ? { parentTaskId } : {}),
      } satisfies ProjectStateDatabaseScopeRow
    })
  const scopeRowSnapshot = (row: ProjectStateDatabaseScopeRow): string => JSON.stringify({
    taskId: row.taskId,
    parentTaskId: row.parentTaskId ?? null,
    scope: row.scope,
    eligibilityReason: row.eligibilityReason,
    hierarchyRole: row.hierarchyRole,
    handoffState: row.handoffState,
    blocksStart: row.blocksStart,
    blocksRelease: row.blocksRelease,
    humanBlocking: row.humanBlocking,
    countInProjectTotals: row.countInProjectTotals !== false,
    proofBlocked: row.proofBlocked === true,
    blockerSummary: row.blockerSummary ?? null,
    sourceRefs: row.sourceRefs,
  })
  const savedScopeRows = indexedState?.scopeRows ?? []
  const scopeRowsChanged = persistedScopeRows.length !== savedScopeRows.length ||
    persistedScopeRows.some((row, index) => scopeRowSnapshot(row) !== scopeRowSnapshot(savedScopeRows[index]!))
  const taskStatusRows = [...taskById.values()].map(task => ({
    taskId: task.id,
    status: task.status ?? null,
    completedAt: task.completedAt ?? null,
  }))
  const currentProjection = scopeRowsChanged
    ? {
        // Indexed proof refreshes must publish the corrected scope rows as
        // well as the compact summary. Otherwise Release/Overview can be
        // current while Work still reads a stale proof_blocked bit.
        scopeRows: persistedScopeRows,
        taskStatusRows: input.taskOverrides ? taskStatusRows : [],
      }
    : undefined
  const statusProjection = !scopeRowsChanged && input.taskOverrides
    ? { taskStatusRows }
    : {}
  const snapshotProjection = currentProjection
    ? { currentProjection }
    : statusProjection
  /*
   * Indexed proof refreshes must publish the corrected scope rows as well as
   * the compact summary. Otherwise Release/Overview can be current while
   * Work still reads a stale proof_blocked bit from work_scope.
   */
  writeProjectStateDatabaseSummarySnapshot(tasksPath, {
    summary: projection,
    ...snapshotProjection,
    ...(input.expectedQueueRevision !== undefined && input.expectedQueueRevision !== null
      ? { expectedQueueRevision: input.expectedQueueRevision }
      : {}),
    ...(expectedProjectRevision !== null ? { expectedProjectRevision } : {}),
  })
  return projection
}

export function buildProjectSummaryProjectionError(input: {
  projectId?: string | null
  taskQueueLastUpdated?: string | null
  taskQueueMtimeMs?: number | null
  workspaceGoalsMtimeMs?: number | null
  approvedPlan?: ProjectSummaryApprovedPlan | null
  orientation?: ProjectOrientationSnapshot | null
  error: unknown
  generatedAt?: string
  execution?: ProjectSummaryProjection['execution']
  runtime?: ProjectSummaryProjection['runtime']
  ownerInput?: ProjectSummaryProjection['ownerInput']
}): ProjectSummaryProjection {
  return {
    version: PROJECT_SUMMARY_PROJECTION_VERSION,
    projectId: input.projectId ?? null,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    freshness: 'error',
    source: {
      taskQueueLastUpdated: input.taskQueueLastUpdated ?? null,
      taskQueueMtimeMs: input.taskQueueMtimeMs ?? null,
      workspaceGoalsMtimeMs: input.workspaceGoalsMtimeMs ?? null,
    },
    counts: {
      total: 0,
      active: 0,
      draftReview: 0,
      blocked: 0,
      done: 0,
      shelved: 0,
      included: 0,
      deferred: 0,
      ready: 0,
      paused: 0,
      ownerBlocked: 0,
      proofBlocked: 0,
      byStatus: {},
    },
    scope: null,
    orientation: input.orientation ?? null,
    orientationSpine: null,
    approvedPlan: input.approvedPlan ?? null,
    releaseSummary: {
      scopeMode: 'unavailable',
      release: null,
      state: 'unknown',
      counts: {
        total: 0,
        done: 0,
        unfinished: 0,
        ready: 0,
        active: 0,
        blocked: 0,
        deferred: 0,
        ownerBlocked: 0,
        proofBlocked: 0,
      },
      taskStatusCounts: {},
      blockers: [],
      updatedAt: input.generatedAt ?? new Date().toISOString(),
    },
    ...(input.execution ? { execution: input.execution } : {}),
    ...(input.runtime ? { runtime: input.runtime } : {}),
    ...(input.ownerInput ? { ownerInput: input.ownerInput } : {}),
    nextAction: {
      code: 'summary_unavailable',
      label: 'Review project state',
      message: 'The project summary could not be refreshed from its task state.',
    },
    blockers: [],
    recentWork: [],
    inFlight: [],
    error: input.error instanceof Error ? input.error.message : String(input.error),
  }
}

export function writeProjectSummaryProjection(
  tasksPath: string,
  input: ProjectSummaryProjectionInput,
): ProjectSummaryProjection {
  const currentStateAuthority = input.currentStateAuthority ?? (
    readProjectStateDatabaseCurrentAuthorityFromTasksPath(tasksPath) === 'database' ? 'database' : 'legacy'
  )
  const projection = buildProjectSummaryProjection({
    ...input,
    currentStateAuthority,
    taskQueueMtimeMs: input.taskQueueMtimeMs ?? taskQueueMtimeMs(tasksPath),
    workspaceGoalsMtimeMs: input.workspaceGoalsMtimeMs ?? workspaceGoalsMtimeMs(tasksPath),
    approvedPlan: input.approvedPlan ?? readApprovedPlan(tasksPath),
  })
  writeProjectStateDatabaseSnapshot(tasksPath, {
    queue: input.queue,
    summary: projection,
    ...(input.execution ? { execution: input.execution } : {}),
    ...(input.runtime ? { runtime: input.runtime } : {}),
    ...(input.projectRoot ? { projectRoot: input.projectRoot } : {}),
    scopeRows: projectSummaryScopeRowsForQueue(input.queue, projection.approvedPlan, input.projectionTasks, {
      currentStateAuthority,
    }),
    ...(input.expectedQueueRevision !== undefined && input.expectedQueueRevision !== null
      ? { expectedQueueRevision: input.expectedQueueRevision }
      : {}),
    ...(input.compatibilityExport ? { compatibilityExport: input.compatibilityExport } : {}),
  })
  return projection
}

export interface PreparedProjectSummaryProjection {
  projection: ProjectSummaryProjection
  parsedQueue: TaskQueueModel | null
  detailQueue: unknown
  scopeRows?: ProjectStateDatabaseScopeRow[]
}

/**
 * Build the current summary and affected scope rows without committing them.
 * Queue mutation boundaries use this to choose a targeted transaction instead
 * of rebuilding the whole current-state store first.
 */
export function prepareProjectSummaryProjectionFromUnknownQueue(
  tasksPath: string,
  input: {
    projectId?: string | null
    projectRoot?: string
    queue: unknown
    projectionTasks?: TaskQueueModel['tasks']
    generatedAt?: string
    /** Migration-only seed for importing the historical summary export. */
    existingSummary?: ProjectSummaryProjection | null
    /** Migration-only request to preserve the retired queue sidecar. */
    compatibilityExport?: 'full' | 'compact'
    /** The shared boundary already removed evidence/runtime-owned fields. */
    taskDefinitionsAlreadySanitized?: boolean
  },
): PreparedProjectSummaryProjection {
  // This writer is the single compatibility boundary for queue-shaped input.
  // Normalize legacy records before validation so one old evidence/runtime
  // field cannot make the entire current scope disappear from SQLite.
  const normalizedQueue = normalizeLegacyTaskQueueForMigration(input.queue)
  const databaseAuthority = readProjectStateDatabaseCurrentAuthorityFromTasksPath(tasksPath) === 'database'
  const validationQueue = databaseAuthority && isRecord(normalizedQueue) && Array.isArray(normalizedQueue.tasks)
    ? {
        ...normalizedQueue,
        tasks: normalizedQueue.tasks.map(task => isRecord(task) ? stripLegacyRuntimeFields(task) : task),
      }
    : normalizedQueue
  const parsed = TaskQueue.safeParse(validationQueue)
  const sourceMtimeMs = taskQueueMtimeMs(tasksPath)
  const goalsMtimeMs = workspaceGoalsMtimeMs(tasksPath)
  const approvedPlan = readApprovedPlan(tasksPath)
  const existingSummary = input.existingSummary ?? readProjectSummaryProjection(tasksPath)
  const supplemental = existingProjectionFields(tasksPath, input.existingSummary)
  const orientation = input.projectRoot
    ? inferProjectOrientationSnapshot(input.projectRoot)
    : supplemental.orientation ?? null
  // A write must project the queue it is about to commit. Re-reading the
  // previous database inventory here can retain scope rows for deleted tasks
  // (or miss newly added tasks) while the incoming queue is already current.
  // Callers with a deliberately richer task-point projection may still supply
  // it explicitly; otherwise the parsed queue is the single write authority.
  const projectionTasks = input.projectionTasks ?? (
    parsed.success ? parsed.data.tasks : undefined
  )
  const projection = parsed.success
    ? buildProjectSummaryProjection({
        projectId: input.projectId ?? existingSummary?.projectId,
        queue: parsed.data,
        generatedAt: input.generatedAt,
        taskQueueMtimeMs: sourceMtimeMs,
        workspaceGoalsMtimeMs: goalsMtimeMs,
        approvedPlan,
        currentStateAuthority: databaseAuthority ? 'database' : 'legacy',
        projectionTasks,
        ...supplemental,
        orientation,
      })
    : buildProjectSummaryProjectionError({
        projectId: input.projectId ?? existingSummary?.projectId,
        error: parsed.error,
        generatedAt: input.generatedAt,
        taskQueueMtimeMs: sourceMtimeMs,
        workspaceGoalsMtimeMs: goalsMtimeMs,
        approvedPlan,
        ...supplemental,
        orientation,
      })
  const detailQueue = parsed.success
    ? (databaseAuthority
      ? (
        input.taskDefinitionsAlreadySanitized
          ? input.queue as TaskQueueModel
          : input.compatibilityExport === undefined
            ? {
                ...parsed.data,
                tasks: parsed.data.tasks.map(task => stripLegacyRuntimeFields(task as unknown as Record<string, unknown>)),
              } as TaskQueueModel
            : parsed.data
        )
      : queueForProjectSummaryScope(
        input.taskDefinitionsAlreadySanitized
          ? input.queue as TaskQueueModel
          : parsed.data,
        projection.approvedPlan,
      ))
    : null
  const scopeRows = detailQueue
    ? projectSummaryScopeRowsForQueue(detailQueue, projection.approvedPlan, projectionTasks, {
        currentStateAuthority: databaseAuthority ? 'database' : 'legacy',
      })
    : undefined
  return {
    projection,
    parsedQueue: parsed.success ? parsed.data : null,
    detailQueue: detailQueue ?? input.queue,
    ...(scopeRows ? { scopeRows } : {}),
  }
}

export function writeProjectSummaryProjectionFromUnknownQueue(
  tasksPath: string,
  input: {
    projectId?: string | null
    projectRoot?: string
    queue: unknown
    projectionTasks?: TaskQueueModel['tasks']
    generatedAt?: string
    expectedQueueRevision?: number | null
    expectedProjectRevision?: number | null
    /** Migration-only request to retain the retired queue export. */
    compatibilityExport?: 'full' | 'compact'
    /** Refresh a promoted read model without rewriting queue definitions. */
    queueCommit?: boolean
    /** Migration-only seed for importing the historical summary export. */
    existingSummary?: ProjectSummaryProjection | null
    /** The shared boundary already removed evidence/runtime-owned fields. */
    taskDefinitionsAlreadySanitized?: boolean
    /** Optional normalized overlays/evidence for one atomic queue commit. */
    taskRuntimes?: readonly ProjectStateDatabaseTaskRuntime[]
    taskWorkspaces?: readonly ProjectStateDatabaseTaskRuntime[]
    evidence?: readonly {
      event: import('@guildhall/core').TaskEvidenceEvent
      retention: ProjectStateDatabaseTaskEvidenceRetentionInput
    }[]
  },
): ProjectSummaryProjection {
  // The queue/effective-task projection may expand many records. Its CAS
  // token belongs to the read that began that work, not to a later read after
  // the projection has already been built.
  const capturedProjectRevision = input.expectedProjectRevision ?? readProjectStateDatabaseRevisionFromTasksPath(tasksPath)
  const prepared = prepareProjectSummaryProjectionFromUnknownQueue(tasksPath, input)
  const { projection, detailQueue, scopeRows } = prepared
  const databaseAuthority = readProjectStateDatabaseCurrentAuthorityFromTasksPath(tasksPath) === 'database'
  if (input.queueCommit === false && databaseAuthority) {
    const expectedProjectRevision = capturedProjectRevision
    const taskStatusRows = input.projectionTasks
      ? input.projectionTasks.map(task => ({
          taskId: task.id,
          status: task.status ?? null,
          completedAt: task.completedAt ?? null,
        } satisfies ProjectStateDatabaseTaskStatusRow))
      : undefined
    writeProjectStateDatabaseSummarySnapshot(tasksPath, {
      summary: projection,
      ...(scopeRows && taskStatusRows
        ? { currentProjection: { scopeRows, taskStatusRows } }
        : {
            ...(scopeRows ? { scopeRows } : {}),
            ...(taskStatusRows ? { taskStatusRows } : {}),
          }),
      ...(input.expectedQueueRevision !== undefined && input.expectedQueueRevision !== null
        ? { expectedQueueRevision: input.expectedQueueRevision }
        : {}),
      ...(expectedProjectRevision !== null ? { expectedProjectRevision } : {}),
    })
  } else {
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: detailQueue,
      summary: projection,
      ...(projection.execution ? { execution: projection.execution } : {}),
      ...(projection.runtime ? { runtime: projection.runtime } : {}),
      ...(input.projectRoot ? { projectRoot: input.projectRoot } : {}),
      ...(scopeRows ? { scopeRows } : {}),
      ...(input.compatibilityExport ? { compatibilityExport: input.compatibilityExport } : {}),
      ...(input.taskRuntimes !== undefined ? { taskRuntimes: input.taskRuntimes } : {}),
      ...(input.taskWorkspaces !== undefined ? { taskWorkspaces: input.taskWorkspaces } : {}),
      ...(input.evidence !== undefined ? { evidence: input.evidence } : {}),
      ...(input.expectedQueueRevision !== undefined && input.expectedQueueRevision !== null
        ? { expectedQueueRevision: input.expectedQueueRevision }
        : {}),
    })
  }
  return projection
}

/**
 * Update compact non-queue state without rebuilding task/scope facts. The
 * existing freshness value is preserved: a task/evidence writer may already
 * have marked the projection stale, and a runtime update must not erase that
 * honest signal.
 */
export function updateProjectSummaryProjection(
  tasksPath: string,
  patch: {
    freshness?: ProjectSummaryProjection['freshness']
    execution?: Partial<NonNullable<ProjectSummaryProjection['execution']>>
    runtime?: Partial<NonNullable<ProjectSummaryProjection['runtime']>>
    ownerInput?: Partial<NonNullable<ProjectSummaryProjection['ownerInput']>>
    orientation?: ProjectOrientationSnapshot | null
  },
): ProjectSummaryProjection | null {
  const now = new Date().toISOString()
  let next: ProjectSummaryProjection | null = null
  updateProjectStateDatabaseSummaryAndCurrentState(tasksPath, currentSummary => {
    const current = currentSummary as unknown as ProjectSummaryProjection
    next = {
      ...current,
      generatedAt: now,
      ...(patch.freshness ? { freshness: patch.freshness } : {}),
      ...(patch.execution
        ? {
            execution: {
              ...(current.execution ?? { status: 'stopped' }),
              ...patch.execution,
              updatedAt: patch.execution.updatedAt ?? now,
            },
          }
        : {}),
      ...(patch.runtime
        ? {
            runtime: {
              ...(current.runtime ?? { status: 'unknown' }),
              ...patch.runtime,
              updatedAt: patch.runtime.updatedAt ?? now,
            },
          }
        : {}),
      ...(patch.ownerInput
        ? {
            ownerInput: {
              ...(current.ownerInput ?? { openCount: 0 }),
              ...patch.ownerInput,
              updatedAt: patch.ownerInput.updatedAt ?? now,
            },
          }
        : {}),
      ...(patch.orientation !== undefined ? { orientation: patch.orientation } : {}),
    }
    return {
      summary: next as unknown as Record<string, unknown>,
      currentState: {
        ...(patch.execution && next.execution
          ? { execution: next.execution }
          : {}),
        ...(patch.runtime && next.runtime
          ? { runtime: next.runtime }
          : {}),
      },
    }
  })
  return next
}

function existingProjectionFields(
  tasksPath: string,
  seed?: ProjectSummaryProjection | null,
): Pick<ProjectSummaryProjectionInput, 'execution' | 'runtime' | 'ownerInput' | 'orientation'> {
  const existing = seed ?? readProjectSummaryProjection(tasksPath)
  return {
    ...(existing?.execution ? { execution: existing.execution } : {}),
    ...(existing?.runtime ? { runtime: existing.runtime } : {}),
    ...(existing?.ownerInput ? { ownerInput: existing.ownerInput } : {}),
    ...(existing?.orientation ? { orientation: existing.orientation } : {}),
  }
}

export function readProjectSummaryProjection(tasksPath: string): ProjectSummaryProjection | null {
  const databaseSummary = readProjectStateDatabaseSummary<ProjectSummaryProjection>(tasksPath)
  if (databaseSummary) {
    return {
      ...databaseSummary.payload,
      freshness: databaseSummary.payload.version === PROJECT_SUMMARY_PROJECTION_VERSION
        ? databaseSummary.freshness
        : 'stale',
    }
  }
  return null
}

/**
 * Import-only reader for the pre-SQLite summary export. Runtime surfaces must
 * use readProjectSummaryProjection so an absent current projection is visible
 * instead of being silently reconstructed from historical data.
 */
export function readProjectSummaryProjectionForMigration(tasksPath: string): ProjectSummaryProjection | null {
  const current = readProjectSummaryProjection(tasksPath)
  if (current) return current
  try {
    const parsed = JSON.parse(readManagedTextFileSync(projectSummaryProjectionPath(tasksPath), 'utf8')) as Record<string, unknown> & {
      version?: unknown
      source?: { taskQueueMtimeMs?: unknown; workspaceGoalsMtimeMs?: unknown }
    }
    if (typeof parsed.version !== 'number' ||
      (parsed.version !== PROJECT_SUMMARY_PROJECTION_VERSION && !LEGACY_PROJECT_SUMMARY_PROJECTION_VERSIONS.has(parsed.version))) {
      return null
    }
    if (LEGACY_PROJECT_SUMMARY_PROJECTION_VERSIONS.has(parsed.version)) {
      return { ...parsed, freshness: 'stale' } as unknown as ProjectSummaryProjection
    }
    const recordedMtimeMs = parsed.source?.taskQueueMtimeMs
    const currentMtimeMs = taskQueueMtimeMs(tasksPath)
    const sourceMatches = recordedMtimeMs === null && currentMtimeMs === null
      ? true
      : typeof recordedMtimeMs === 'number' && currentMtimeMs !== null && recordedMtimeMs === currentMtimeMs
    const recordedGoalsMtimeMs = parsed.source?.workspaceGoalsMtimeMs
    const currentGoalsMtimeMs = workspaceGoalsMtimeMs(tasksPath)
    const planSourceMatches = recordedGoalsMtimeMs === null && currentGoalsMtimeMs === null
      ? true
      : typeof recordedGoalsMtimeMs === 'number' && currentGoalsMtimeMs !== null && recordedGoalsMtimeMs === currentGoalsMtimeMs
    const hasCurrentCompactState = Boolean(parsed.counts && typeof parsed.counts === 'object' && !Array.isArray(parsed.counts) &&
      'byStatus' in parsed.counts && Array.isArray(parsed.inFlight) &&
      parsed.releaseSummary && typeof parsed.releaseSummary === 'object' && !Array.isArray(parsed.releaseSummary) &&
      'approvedPlan' in parsed &&
      'taskStatusCounts' in parsed.releaseSummary &&
      parsed.releaseSummary.taskStatusCounts &&
      typeof parsed.releaseSummary.taskStatusCounts === 'object' &&
      !Array.isArray(parsed.releaseSummary.taskStatusCounts))
    if (!hasCurrentCompactState) {
      return { ...parsed, freshness: 'stale' } as unknown as ProjectSummaryProjection
    }
    if (!sourceMatches || !planSourceMatches) {
      return { ...parsed, freshness: 'stale' } as ProjectSummaryProjection
    }
    return parsed as unknown as ProjectSummaryProjection
  } catch {
    return null
  }
}

/**
 * Fleet and project shells do not need the map tree. Keep that read separate
 * from the full projection reader so a compact card never loads map detail
 * just to show counts, scope, and the next action.
 */
export function readProjectSummaryShellProjection(tasksPath: string): ProjectSummaryProjection | null {
  try {
    const databaseSummary = readProjectStateDatabaseSummary<ProjectSummaryProjection>(tasksPath, {
      includeOrientation: false,
      includeApprovedPlan: false,
    })
    if (databaseSummary) {
      return {
        ...databaseSummary.payload,
        orientationSpine: null,
        freshness: databaseSummary.payload.version === PROJECT_SUMMARY_PROJECTION_VERSION
          ? databaseSummary.freshness
          : 'stale',
      }
    }
  } catch {
    // A corrupt or locked project stays visible as unavailable; it cannot fail the fleet shell.
  }
  return null
}

export function projectSummaryProjectionNeedsBackfill(tasksPath: string): boolean {
  return readProjectSummaryProjectionForMigration(tasksPath)?.freshness !== 'current'
}

export function backfillProjectSummaryProjection(
  tasksPath: string,
  input: { projectId?: string | null; projectRoot?: string; now?: string } = {},
): ProjectSummaryProjection {
  let raw: unknown
  const historicalSummary = readProjectSummaryProjectionForMigration(tasksPath)
  const databaseAuthority = readProjectStateDatabaseAuthorityFromTasksPath(tasksPath) === 'database'
  try {
    raw = readProjectStateDatabaseQueueDefinitionForMigration(tasksPath)
    if (raw === null && databaseAuthority) {
      return buildProjectSummaryProjectionError({
        projectId: input.projectId,
        error: new Error('The authoritative project detail store is unavailable; no queue was rebuilt.'),
        generatedAt: input.now,
      })
    }
    raw ??= JSON.parse(readManagedTextFileSync(tasksPath, 'utf8'))
  } catch (error) {
    if (databaseAuthority) {
      return buildProjectSummaryProjectionError({
        projectId: input.projectId,
        error,
        generatedAt: input.now,
      })
    }
    return writeProjectSummaryProjectionFromUnknownQueue(tasksPath, {
      projectId: input.projectId,
      projectRoot: input.projectRoot,
      queue: { version: 1, lastUpdated: input.now ?? new Date().toISOString(), tasks: [] },
      generatedAt: input.now,
      existingSummary: historicalSummary,
    })
  }
  const normalized = normalizeLegacyTaskQueueForMigration(raw, input.now ?? new Date().toISOString())
  return writeProjectSummaryProjectionFromUnknownQueue(tasksPath, {
    projectId: input.projectId,
    projectRoot: input.projectRoot,
    queue: normalized,
    generatedAt: input.now,
    existingSummary: historicalSummary,
  })
}

function summarizeRawTaskCounts(tasks: readonly { status?: unknown }[]): ProjectSummaryProjection['counts'] {
  let active = 0
  let draftReview = 0
  let blocked = 0
  let done = 0
  let shelved = 0
  const byStatus: Record<string, number> = {}
  for (const task of tasks) {
    const status = typeof task.status === 'string' ? task.status : ''
    byStatus[status || 'unknown'] = (byStatus[status || 'unknown'] ?? 0) + 1
    if (status === 'done') done++
    else if (status === 'blocked') blocked++
    else if (status === 'shelved') shelved++
    else if (status === 'import_draft') draftReview++
    else active++
  }
  return {
    total: tasks.length,
    active,
    draftReview,
    blocked,
    done,
    shelved,
    included: 0,
    deferred: 0,
    ready: 0,
    paused: 0,
    ownerBlocked: 0,
    proofBlocked: 0,
    byStatus,
  }
}

function inFlightForTasks(
  tasks: readonly { id: string; title: string; status?: unknown; domain?: string; updatedAt?: string }[],
): ProjectSummaryProjection['inFlight'] {
  return [...tasks]
    .filter(task => ['in_progress', 'review', 'gate_check', 'spec_review', 'exploring'].includes(String(task.status ?? '')))
    .sort((left, right) => String(right.updatedAt ?? '').localeCompare(String(left.updatedAt ?? '')))
    .slice(0, 5)
    .map(task => ({
      taskId: task.id,
      title: task.title,
      status: typeof task.status === 'string' ? task.status : 'unknown',
      domain: typeof task.domain === 'string' ? task.domain : '',
      updatedAt: typeof task.updatedAt === 'string' ? task.updatedAt : null,
    }))
}

function buildReleaseSummary(input: {
  queue: TaskQueueModel
  scopeProjection: ReturnType<typeof buildProjectScopeProjection>
  generatedAt: string
}): ProjectSummaryReleaseSummary {
  const rows = input.scopeProjection.rows.filter(row => row.scope === 'included')
  const executionRows = executionScopeRows(rows)
  const included = executionRows.length
  const done = executionRows.filter(row => row.handoffState === 'done').length
  const release = input.scopeProjection.selectedScope
    ? (input.queue.releases ?? []).find(candidate => candidate.id === input.scopeProjection.selectedScope?.id) ?? null
    : null
  const releaseMetadata = release
    ? {
        id: release.id,
        label: release.label,
        kind: release.kind,
        state: release.state,
        source: release.source,
      }
    : null
  return {
    scopeMode: input.scopeProjection.selectedScope ? 'named_release' : 'unreleased',
    release: releaseMetadata,
    state: input.scopeProjection.release.state,
    counts: {
      total: included,
      done,
      unfinished: Math.max(0, included - done),
      ready: executionRows.filter(row => row.handoffState === 'ready').length,
      active: executionRows.filter(row => row.handoffState === 'paused' || row.handoffState === 'review').length,
      // "Blocked" in a selected scope means work that prevents the scope
      // from progressing, not only tasks whose literal status is blocked.
      // Brief/spec gaps and missing proof are just as material to readiness.
      blocked: executionRows.filter(row => row.blocksRelease).length,
      deferred: input.scopeProjection.counts.deferred,
      ownerBlocked: input.scopeProjection.counts.ownerBlocked,
      proofBlocked: input.scopeProjection.counts.proofBlocked,
    },
    taskStatusCounts: taskStatusCounts(executionRows),
    blockers: input.scopeProjection.release.blockers,
    updatedAt: input.generatedAt,
  }
}

function recentWorkForTasks(
  tasks: readonly { id: string; title: string; status?: unknown; updatedAt?: string }[],
): ProjectSummaryProjection['recentWork'] {
  return [...tasks]
    .filter(task => task.status !== 'archived' && task.status !== 'cancelled')
    .sort((left, right) => String(right.updatedAt ?? '').localeCompare(String(left.updatedAt ?? '')))
    .slice(0, 5)
    .map(task => ({
      taskId: task.id,
      title: task.title,
      status: typeof task.status === 'string' ? task.status : 'unknown',
      updatedAt: typeof task.updatedAt === 'string' ? task.updatedAt : null,
    }))
}

function taskQueueMtimeMs(tasksPath: string): number | null {
  try {
    return statSync(tasksPath).mtimeMs
  } catch {
    return null
  }
}

function workspaceGoalsMtimeMs(tasksPath: string): number | null {
  // Once SQLite owns current project state, workspace-goals.json is intake
  // provenance only. Do not let its mtime participate in ordinary summary
  // freshness or turn a stale planning snapshot into live release state.
  if (readProjectStateDatabaseCurrentAuthorityFromTasksPath(tasksPath) === 'database') return null
  try {
    return statSync(join(dirname(tasksPath), 'workspace-goals.json')).mtimeMs
  } catch {
    return null
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : []
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is Record<string, unknown> =>
        Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry),
      )
    : []
}

export function readApprovedPlan(tasksPath: string): ProjectSummaryApprovedPlan | null {
  if (readProjectStateDatabaseCurrentAuthorityFromTasksPath(tasksPath) === 'database') {
    // Promoted reads use the imported plan snapshot already stored in the
    // database. The workspace-goals file is a migration/intake input, never a
    // second current-state authority.
    return readProjectStateDatabaseSummary<ProjectSummaryProjection>(tasksPath)?.payload.approvedPlan ?? null
  }
  try {
    const raw = JSON.parse(readManagedTextFileSync(join(dirname(tasksPath), 'workspace-goals.json'), 'utf8')) as Record<string, unknown>
    if (typeof raw.recordedAt !== 'string') return null
    const goals = recordArray(raw.goals)
    const tasks = recordArray(raw.tasks).filter(task => typeof task.id === 'string' && task.id.trim().length > 0)
    const milestones = recordArray(raw.milestones)
    const taskIds = tasks.map(task => String(task.id))
    const taskIdSet = new Set(taskIds)
    const approved = raw.approved && typeof raw.approved === 'object' && !Array.isArray(raw.approved)
      ? raw.approved as Record<string, unknown>
      : null
    const approvedCurrentIds = stringArray(approved?.currentTaskIds).filter(id => taskIdSet.has(id))
    const approvedLaterIds = stringArray(approved?.laterTaskIds).filter(id => taskIdSet.has(id))
    const currentTaskIds = approvedCurrentIds.length > 0 || approvedLaterIds.length > 0
      ? approvedCurrentIds
      : tasks.filter(task => task.scope !== 'later').map(task => String(task.id))
    const laterTaskIds = approvedCurrentIds.length > 0 || approvedLaterIds.length > 0
      ? approvedLaterIds
      : tasks.filter(task => task.scope === 'later').map(task => String(task.id))
    const currentSet = new Set(currentTaskIds)
    const laterSet = new Set(laterTaskIds)
    const releaseRows = new Map<string, ProjectSummaryApprovedPlanRelease>()
    for (const release of recordArray(raw.releases)) {
      if (typeof release.id !== 'string' || !release.id.trim() || typeof release.label !== 'string') continue
      releaseRows.set(release.id, {
        id: release.id,
        label: release.label,
        kind: typeof release.kind === 'string' ? release.kind : 'release',
        state: typeof release.state === 'string' ? release.state : 'active',
        source: typeof release.source === 'string' ? release.source : 'owner_approved',
        currentTaskIds: [],
        laterTaskIds: [],
      })
    }
    for (const task of tasks) {
      const taskId = String(task.id)
      for (const releaseId of stringArray(task.releaseIds)) {
        const release = releaseRows.get(releaseId) ?? {
          id: releaseId,
          label: releaseId,
          kind: 'release',
          state: 'active',
          source: 'owner_approved',
          currentTaskIds: [],
          laterTaskIds: [],
        }
        if (currentSet.has(taskId)) release.currentTaskIds.push(taskId)
        else if (laterSet.has(taskId)) release.laterTaskIds.push(taskId)
        releaseRows.set(releaseId, release)
      }
    }
    const releases = [...releaseRows.values()]
    return {
      source: 'workspace_import',
      recordedAt: raw.recordedAt,
      goalCount: goals.length,
      taskCount: taskIds.length,
      milestoneCount: milestones.length,
      currentTaskCount: currentTaskIds.length,
      laterTaskCount: laterTaskIds.length,
      currentTaskIds,
      laterTaskIds,
      currentReleaseId: releases.find(release => release.currentTaskIds.length > 0)?.id ?? null,
      releases,
    }
  } catch {
    return null
  }
}
