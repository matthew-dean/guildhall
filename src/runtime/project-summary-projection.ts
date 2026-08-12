import { TaskQueue, type ProjectRelease, type Task, type TaskQueue as TaskQueueModel } from '@guildhall/core'
import { readManagedTextFileSync, stableJson } from '@guildhall/persistence'
import {
  readProjectStateDatabaseAuthorityFromTasksPath,
  readProjectStateDatabaseAuthority,
  readProjectStateDatabaseCurrentAuthorityFromTasksPath,
  readProjectStateDatabaseCurrentAuthority,
  readProjectStateDatabaseProjectionState,
  readProjectStateDatabaseQueue,
  readProjectStateDatabaseReleaseMembership,
  readProjectStateDatabaseReleaseMembershipState,
  readProjectStateDatabaseSourceCapabilities,
  readProjectStateDatabaseSummary,
  readProjectStateDatabaseRevisionFromTasksPath,
  readProjectStateDatabaseQueueDefinitionForMigration,
  readProjectStateDatabaseQueueRevision,
  writeProjectStateDatabaseSummarySnapshot,
  updateProjectStateDatabaseSummaryAndCurrentState,
  writeProjectStateDatabaseSnapshot,
  type ProjectStateDatabaseScopeRow,
  type ProjectStateDatabaseSourceCapability,
  type ProjectStateDatabaseTask,
  type ProjectStateDatabaseTaskEvidenceRetentionInput,
  type ProjectStateDatabaseAvailability,
  type ProjectStateDatabaseTaskRuntime,
  type ProjectStateDatabaseTaskStatusRow,
  type ProjectStateDatabaseStateResolutionSnapshot,
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
  type OrientationReleaseState,
  type OrientationReleaseTruth,
  type OrientationPin,
  type OrientationWorkspaceImportDraftContext,
  type ProjectOrientationSpine,
} from './project-orientation-spine.js'
import { buildProjectActionModel, type ProjectActionModel } from './project-action-model.js'
import {
  applyProjectActionModelPrimaryAction,
  applyRuntimeExecutionToProjectDecision,
  buildProjectDecisionProjection,
  projectDecisionStartReadiness,
  resolveRegisteredProjectStateClaimSet,
  type ProjectDecisionProjection,
  type ProjectDecisionTaskRef,
  type ProjectStateClaim,
} from './project-decision-projection.js'
import { normalizeLegacyTaskQueueForMigration } from './task-queue-migration.js'
import { stripLegacyRuntimeFields } from './effective-task.js'
import { specReviewRequiresOwnerApproval } from './spec-review-ownership.js'

export const PROJECT_SUMMARY_PROJECTION_VERSION = 32 as const
export const PROJECT_SUMMARY_PROJECTION_FILE = 'project-summary.json'
const LEGACY_PROJECT_SUMMARY_PROJECTION_VERSIONS = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31])

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
  /**
   * The normalized release-membership relation revision used to build this
   * summary. The SQLite read boundary compares it with the current relation
   * before exposing release-derived state as current.
   */
  releaseMembershipRevision?: number
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
  /**
   * Small, source-backed records that describe the project independently of
   * executable work. They are persisted with the shared summary so Map does
   * not reopen a workspace-import scan on every request.
   */
  documentedStructure: OrientationWorkspaceImportDraftContext[]
  /**
   * Compact, revision-aligned status of the adapter-owned source catalog.
   * Consumers use this instead of independently reading or interpreting
   * source documents when explaining whether scope can be scheduled.
   */
  sourceCapabilityCatalog: ProjectSummarySourceCapabilityCatalog
  orientationSpine: ProjectOrientationSpine | null
  approvedPlan: ProjectSummaryApprovedPlan | null
  releaseSummary: ProjectSummaryReleaseSummary
  /** The sole compact authority for execution, release, and primary-action decisions. */
  decision: ProjectDecisionProjection
  execution?: {
    status: 'running' | 'stopping' | 'stopped' | 'error' | string
    mode?: 'continuous' | 'one_task' | string
    startedAt?: string | null
    stoppedAt?: string | null
    stopRequestedAt?: string | null
    error?: string | null
    /** The task currently held by a live supervisor worker, if any. */
    activeTaskId?: string | null
    /** Typed display identity paired with `activeTaskId`; never parsed from prose. */
    activeTaskTitle?: string | null
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
  ownerReview?: {
    openCount: number
    /** Ordered, selected-scope membership behind the owner-review count. */
    taskIds: string[]
    next?: {
      taskId: string
      label?: string
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
    code?: string
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

function withPersistedReleaseMembershipRevision(
  tasksPath: string,
  projection: ProjectSummaryProjection,
): ProjectSummaryProjection {
  const membershipState = readProjectStateDatabaseReleaseMembershipState(tasksPath)
  return membershipState
    ? { ...projection, releaseMembershipRevision: membershipState.membershipRevision }
    : projection
}

/**
 * Older summary writers may have persisted an action model after its decision
 * packet. Normalize that bounded pair at the shared summary boundary so every
 * promoted reader receives one primary action without reopening task detail.
 */
export function synchronizeProjectSummaryDecision(
  summary: ProjectSummaryProjection,
): ProjectSummaryProjection {
  if (!summary.decision || typeof summary.decision !== 'object') return summary
  const lifecycleState = summary.releaseSummary?.release?.state
  const decisionWithLifecycle = lifecycleState && (
    summary.decision.release.lifecycleState !== lifecycleState ||
    (lifecycleState === 'shipped' && (
      summary.decision.primaryAction.kind !== 'none' ||
      summary.decision.primaryAction.reasonCode !== 'release_shipped'
    ))
  )
    ? {
      ...summary.decision,
      release: { ...summary.decision.release, lifecycleState },
      ...(lifecycleState === 'shipped'
        ? { primaryAction: { kind: 'none' as const, reasonCode: 'release_shipped' } }
        : {}),
    }
    : summary.decision
  const decision = applyProjectActionModelPrimaryAction(decisionWithLifecycle, summary.actionModel?.primaryAction)
  return decision === summary.decision ? summary : { ...summary, decision }
}

export interface ProjectSummarySourceCapabilityCatalog {
  availability: 'unavailable' | 'empty' | 'ready'
  total: number
  planned: number
  retired: number
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
    code?: string
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
  proofStyle: ProjectScope['proofStyle'] | undefined,
): boolean {
  const status = String(task.status ?? '')
  if (status !== 'done' && status !== 'pending_pr') return false
  // The bounded current-proof point is the compact proof authority. Calling
  // rich-task helpers here would inspect fields such as proofPaths that are
  // intentionally absent from indexed rows and turn a proven task back into a
  // blocker merely because its full definition was not opened.
  if (!proof) return proofStyle === 'script_only'
  if (['needed', 'partial'].includes(proof.state)) return true
  // A compact point can legitimately say `none` while still carrying the
  // acceptance-criteria count. That is an unproven completed task, not a
  // task with no proof contract.
  if (proof.state === 'none' && Number(task.currentSummary?.acceptanceCriteriaCount ?? 0) > 0) return true
  return proof.state === 'none' && proofStyle === 'script_only' && proof.hasExecutablePath !== true
}

function indexedTaskCompletionChildren(
  task: ProjectStateDatabaseTask,
  tasksById: ReadonlyMap<string, ProjectStateDatabaseTask>,
  selectedReleaseId: string | null,
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
    .filter(child => indexedProofChildBelongsToSelectedRelease(child, selectedReleaseId))
    .filter(child => !['archived', 'cancelled', 'shelved'].includes(String(child.status ?? '')))
}

/**
 * A proof setup child is a release-local execution fact. Parent membership can
 * legitimately span releases, but an older proof child must not satisfy or
 * block a later release. This compact rule mirrors the rich scope projection
 * using only typed semantic kind and normalized release membership.
 */
function indexedProofChildBelongsToSelectedRelease(
  child: ProjectStateDatabaseTask,
  selectedReleaseId: string | null,
): boolean {
  if (!selectedReleaseId || child.semanticKind !== 'proof_setup') return true
  return child.proofForReleaseId === selectedReleaseId
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
  selectedReleaseId: string | null,
  proofStyle: ProjectScope['proofStyle'] | undefined,
  visiting = new Set<string>(),
): boolean {
  if (visiting.has(task.id)) return false
  const children = indexedTaskCompletionChildren(task, tasksById, selectedReleaseId)
  if (children.length === 0) return false
  const nextVisiting = new Set(visiting).add(task.id)
  return children.every(child => {
    const status = String(child.status ?? '')
    if (status !== 'done' && status !== 'pending_pr') return false
    if (!indexedTaskHasCompletionProofGap(child, proofByTaskId.get(child.id), proofStyle)) return true
    return indexedTaskCompletionProofSatisfiedByLinkedChildren(child, tasksById, proofByTaskId, selectedReleaseId, proofStyle, nextVisiting)
  })
}

function indexedTaskProofBlocked(
  task: ProjectStateDatabaseTask,
  proof: IndexedCurrentProof | undefined,
  tasksById: ReadonlyMap<string, ProjectStateDatabaseTask>,
  proofByTaskId: ReadonlyMap<string, IndexedCurrentProof>,
  selectedReleaseId: string | null,
  proofStyle: ProjectScope['proofStyle'] | undefined,
): boolean {
  if (indexedTaskCompletionProofSatisfiedByLinkedChildren(task, tasksById, proofByTaskId, selectedReleaseId, proofStyle)) return false
  return indexedTaskHasCompletionProofGap(task, proof, proofStyle)
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

function ownerReviewForScope(
  rows: readonly ProjectScopeRow[],
  tasks: readonly Task[],
  generatedAt: string,
): NonNullable<ProjectSummaryProjection['ownerReview']> {
  const tasksById = new Map(tasks.map(task => [task.id, task]))
  const pending = executionScopeRows(rows)
    .filter(row => row.scope === 'included' && !row.dependencyBlocked)
    .flatMap(row => {
      const task = tasksById.get(row.taskId)
      return task?.status === 'spec_review' && specReviewRequiresOwnerApproval(task) ? [task] : []
    })
  const next = pending[0]
  return {
    openCount: pending.length,
    taskIds: pending.map(task => task.id),
    ...(next ? {
      next: {
        taskId: next.id,
        label: next.title,
        href: `/work?task=${encodeURIComponent(next.id)}`,
      },
    } : {}),
    updatedAt: generatedAt,
  }
}

function canonicalDecisionTaskRefs(
  tasks: readonly { id: string; title: string; updatedAt?: string | null }[],
  projectRevision?: number | null,
): ProjectDecisionTaskRef[] {
  return tasks
    .filter(task => task.id.trim().length > 0 && task.title.trim().length > 0)
    .map(task => ({
      taskId: task.id,
      displayTitle: task.title,
      ...(projectRevision !== undefined && projectRevision !== null ? { taskRevision: projectRevision } : {}),
    }))
}

function applyOwnerReviewToStartReadiness(
  start: ReturnType<typeof summarizeProjectScopeStart>,
  ownerReview: ProjectSummaryProjection['ownerReview'] | null | undefined,
): ReturnType<typeof summarizeProjectScopeStart> {
  if (!ownerReview || ownerReview.openCount <= 0) return start
  const label = ownerReview.next?.label?.trim() || ownerReview.next?.taskId || 'This spec'
  const count = ownerReview.openCount
  return {
    ...start,
    canStart: false,
    code: 'owner_review_required',
    label: 'Review',
    message: count === 1
      ? `${label} is ready for your review before work can continue`
      : `${count} specs are ready for your review before work can continue`,
    actionHref: ownerReview.next?.href ?? '/work',
    ...(ownerReview.next?.taskId ? { focusTaskId: ownerReview.next.taskId } : {}),
    ...(ownerReview.next?.label?.trim() ? { focusTaskTitle: ownerReview.next.label.trim() } : {}),
    focusKind: 'owner_review',
    ...(ownerReview.taskIds.length > 0 ? { reviewTaskIds: [...ownerReview.taskIds] } : {}),
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
  documentedStructure?: OrientationWorkspaceImportDraftContext[]
  /** Structured source authority captured with this summary revision. */
  sourceCapabilities?: readonly ProjectStateDatabaseSourceCapability[] | null
  execution?: ProjectSummaryProjection['execution']
  runtime?: ProjectSummaryProjection['runtime']
  ownerInput?: ProjectSummaryProjection['ownerInput']
  ownerReview?: ProjectSummaryProjection['ownerReview']
  expectedQueueRevision?: number | null
  /** Promoted projects read current scope only from normalized SQLite rows. */
  currentStateAuthority?: 'database' | 'legacy'
  /** Migration-only request to preserve the retired queue sidecar. */
  compatibilityExport?: 'full' | 'compact'
}

function summarizeSourceCapabilityCatalog(
  capabilities: readonly ProjectStateDatabaseSourceCapability[] | null | undefined,
): ProjectSummarySourceCapabilityCatalog {
  if (capabilities === null || capabilities === undefined) {
    return { availability: 'unavailable', total: 0, planned: 0, retired: 0 }
  }
  const planned = capabilities.filter(capability => capability.state === 'planned').length
  const retired = capabilities.filter(capability => capability.state === 'retired').length
  return {
    availability: capabilities.length === 0 ? 'empty' : 'ready',
    total: capabilities.length,
    planned,
    retired,
  }
}

export function projectSummaryProjectionPath(tasksPath: string): string {
  return join(dirname(tasksPath), PROJECT_SUMMARY_PROJECTION_FILE)
}

export type ApprovedPlanReleaseMembershipConflict = {
  releaseId: string
  taskId: string
  existing: 'included' | 'deferred'
  proposed: 'included' | 'deferred'
}

/**
 * Prepare an accepted plan for one atomic release-membership write. This does
 * not invent tasks from plan text. Explicit opposite dispositions become
 * typed conflicts instead of a silent overwrite.
 */
export function materializeApprovedPlanReleaseMembership(
  queue: TaskQueueModel,
  approvedPlan: ProjectSummaryApprovedPlan | null | undefined,
): { queue: TaskQueueModel; changed: boolean; conflicts: ApprovedPlanReleaseMembershipConflict[] } {
  if (!approvedPlan || approvedPlan.releases.length === 0) return { queue, changed: false, conflicts: [] }
  const taskIds = new Set(queue.tasks.map(task => task.id))
  const existingById = new Map((queue.releases ?? []).map(release => [release.id, release]))
  const conflicts: ApprovedPlanReleaseMembershipConflict[] = []
  let changed = false
  const planReleases: ProjectRelease[] = approvedPlan.releases.map(release => {
    const existing = existingById.get(release.id)
    const kind: ProjectRelease['kind'] = release.kind === 'milestone' ? 'milestone' : 'release'
    const source: ProjectRelease['source'] = release.source === 'release_plan' || release.source === 'spec' || release.source === 'inferred'
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
    const included = new Set(existing?.nodeIds ?? [])
    const deferred = new Set(existing?.deferredNodeIds ?? [])
    const existingHasMaterializedMembership = included.size > 0 || deferred.size > 0
    const add = (taskId: string, disposition: 'included' | 'deferred') => {
      if (!taskIds.has(taskId)) return
      // An accepted-plan snapshot may outlive the release it originally
      // described. Once that release is shipped, normalized membership is
      // historical fact: the snapshot cannot reopen or expand it. Current
      // work must already be attached to an active release through the
      // canonical membership relation.
      if (existing?.state === 'shipped') return
      const nodeId = `work:${taskId}`
      const target = disposition === 'included' ? included : deferred
      const opposite = disposition === 'included' ? deferred : included
      if (opposite.has(nodeId)) {
        if (existingHasMaterializedMembership) return
        conflicts.push({
          releaseId: release.id,
          taskId,
          existing: disposition === 'included' ? 'deferred' : 'included',
          proposed: disposition,
        })
      } else if (!target.has(nodeId) && !existingHasMaterializedMembership) {
        target.add(nodeId)
        changed = true
      }
    }
    for (const taskId of release.currentTaskIds) add(taskId, 'included')
    for (const taskId of release.laterTaskIds) add(taskId, 'deferred')
    const materialized: ProjectRelease = {
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
      nodeIds: [...included],
      deferredNodeIds: [...deferred],
    }
    if (!existing || JSON.stringify(existing.nodeIds ?? []) !== JSON.stringify(materialized.nodeIds) ||
      JSON.stringify(existing.deferredNodeIds ?? []) !== JSON.stringify(materialized.deferredNodeIds)) changed = true
    return materialized
  })
  const releases = [
    ...planReleases,
    ...(queue.releases ?? []).filter(release => !planReleases.some(candidate => candidate.id === release.id)),
  ]
  const selectedReleaseId = queue.selectedReleaseId || approvedPlan.currentReleaseId || undefined
  if (selectedReleaseId !== queue.selectedReleaseId) changed = true
  return {
    queue: { ...queue, releases, ...(selectedReleaseId ? { selectedReleaseId } : {}) },
    changed,
    conflicts,
  }
}

/** Legacy read compatibility only; promoted readers do not use this overlay. */
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
  const queueOwnsReleaseMembership = (releaseId: string): boolean =>
    (queue.releases ?? []).some(release => release.id === releaseId && [
      ...(release.nodeIds ?? []),
      ...(release.deferredNodeIds ?? []),
    ].some(nodeId => currentTaskIds.has(nodeId.replace(/^work:/, '')))) ||
    queue.tasks.some(task => currentTaskIds.has(task.id) && task.releaseIds?.includes(releaseId) === true)
  const currentReleaseId = approvedPlan.currentReleaseId ??
    approvedPlan.releases.find(release => release.currentTaskIds.some(taskId => knownCurrentTaskIds.has(taskId)))?.id ??
    null
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
    dependencyBlocked: row.dependencyBlocked === true,
    ...(row.dependencyTaskIds?.length
      ? { dependencyTaskIds: [...row.dependencyTaskIds] }
      : {}),
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
  const ownerReview = input.ownerReview ?? ownerReviewForScope(scopeProjection.rows, tasks, generatedAt)
  const start = applyOwnerInputToStartReadiness(
    applyOwnerReviewToStartReadiness(scopeProjection.start, ownerReview),
    input.ownerInput,
  )
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
    ...(input.documentedStructure?.length
      ? {
          workspaceImportDraft: {
            tasks: [],
            contexts: input.documentedStructure,
            source: {
              kind: 'import',
              refs: input.documentedStructure.flatMap(context => context.refs ?? []).slice(0, 24),
              confidence: 'medium',
              freshness: 'fresh',
              inferred: false,
              refreshedAt: generatedAt,
            },
          },
        }
      : {}),
  }))
  const sourceCapabilityCatalog = summarizeSourceCapabilityCatalog(input.sourceCapabilities)
  const recentWork = recentWorkForTasks(tasks)
  const initialDecision = buildProjectDecisionProjection({
    generatedAt,
    start,
    release: {
      ...releaseSummary,
      ...(releaseSummary.release?.state ? { lifecycleState: releaseSummary.release.state } : {}),
    },
    ownerInput: input.ownerInput,
    ownerReview,
    runStatus: input.execution?.status ?? 'stopped',
    runtimeExecution: input.execution,
    canonicalTaskRefs: canonicalDecisionTaskRefs(tasks),
  })
  // Start readiness remains an execution fact. The summary action is what a
  // person should do next, so a finished release must not surface the stale
  // "no runnable work" transport message as though more work were expected.
  const releaseReadyForReview =
    releaseSummary.state === 'ready' &&
    start.code === 'all_terminal' &&
    releaseSummary.release?.state !== 'shipped'
  const decisionStart = projectDecisionStartReadiness(initialDecision)
  const nextAction: ProjectSummaryProjection['nextAction'] = releaseReadyForReview
    ? {
        code: 'release_ready',
        label: 'Review project state' as const,
        message: 'Review completed scope.',
      }
    : {
        ...(decisionStart.code ? { code: decisionStart.code } : {}),
        label: start.label,
        message: start.message,
        ...(typeof start.count === 'number' ? { count: start.count } : {}),
        ...(decisionStart.focusTaskId ? { focusTaskId: decisionStart.focusTaskId } : {}),
        ...(decisionStart.focusTaskTitle ? { focusTaskTitle: decisionStart.focusTaskTitle } : {}),
        ...(decisionStart.focusKind ? { focusKind: decisionStart.focusKind } : {}),
      }
  const startReadiness = {
    ...decisionStart,
    ...(nextAction.code ? { code: nextAction.code } : {}),
    message: nextAction.message,
    ...(typeof decisionStart.count === 'number' ? { count: decisionStart.count } : {}),
    ...(ownerReview?.taskIds.length ? { reviewTaskIds: [...ownerReview.taskIds] } : {}),
    executionScope: selectedScope
      ? {
          id: selectedScope.id,
          label: selectedScope.label,
          kind: selectedScope.kind,
          source: selectedScope.source,
          taskCount: releaseSummary.counts.total,
          deferredTaskCount: releaseSummary.counts.deferred,
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
    summaryTasks: tasks,
  })
  const decision = applyProjectActionModelPrimaryAction(initialDecision, actionModel.primaryAction)

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
          included: releaseSummary.counts.total,
          deferred: releaseSummary.counts.deferred,
          ...(selectedScope.proofStyle ? { proofStyle: selectedScope.proofStyle } : {}),
        }
      : null,
    orientation: input.orientation ?? null,
    documentedStructure: (input.documentedStructure ?? []).map(context => ({
      ...context,
      ...(context.refs ? { refs: [...context.refs] } : {}),
      ...(context.releaseIds ? { releaseIds: [...context.releaseIds] } : {}),
      ...(context.linkedTaskHints ? { linkedTaskHints: [...context.linkedTaskHints] } : {}),
    })),
    sourceCapabilityCatalog,
    orientationSpine,
    approvedPlan,
    releaseSummary,
    decision,
    ...(input.execution ? { execution: input.execution } : {}),
    ...(input.runtime ? { runtime: input.runtime } : {}),
    ...(input.ownerInput ? { ownerInput: input.ownerInput } : {}),
    ownerReview,
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

/**
 * Scope is a compact read model, but its handoff rules still need to know
 * whether a task has a complete approved brief or executable spec. Recreate
 * only those typed facts from the indexed summary; detail prose and runtime
 * history deliberately stay out of this projection path.
 */
function indexedTaskForScopeProjection(task: ProjectStateDatabaseTask): Task {
  const record = task as unknown as Record<string, unknown>
  const currentSummary = isRecord(record.currentSummary) ? record.currentSummary : {}
  const brief = isRecord(currentSummary.brief) ? currentSummary.brief : {}
  const executionBlocker = isRecord(currentSummary.executionBlocker) &&
    typeof currentSummary.executionBlocker.reason === 'string' &&
    currentSummary.executionBlocker.reason.trim()
    ? currentSummary.executionBlocker.reason.trim()
    : undefined
  const specReviewAuthority = currentSummary.specReviewAuthority === 'owner' || currentSummary.specReviewAuthority === 'coordinator'
    ? currentSummary.specReviewAuthority
    : undefined
  const acceptanceCriteriaCount = Number(currentSummary.acceptanceCriteriaCount ?? record.acceptanceCriteriaCount ?? 0)
  const hasBrief = brief.present === true
  const hasShapedBrief = brief.shaped === true
  const approvedAt = typeof brief.approvedAt === 'string' && brief.approvedAt.trim()
    ? brief.approvedAt
    : undefined
  const hierarchy = task.hierarchy || task.parentId
    ? { ...(task.hierarchy ?? {}), ...(task.parentId ? { parentId: task.parentId } : {}) }
    : undefined
  return {
    id: task.id,
    title: task.title,
    ...(task.description ? { description: task.description } : {}),
    ...(task.status ? { status: task.status } : {}),
    ...(task.domain ? { domain: task.domain } : {}),
    ...(task.priority ? { priority: task.priority } : {}),
    ...(task.workKind ? { workKind: task.workKind } : {}),
    ...(task.semanticKind ? { semanticKind: task.semanticKind } : {}),
    ...(task.proofForReleaseId ? { proofForReleaseId: task.proofForReleaseId } : {}),
    ...(hierarchy ? { hierarchy } : {}),
    ...(task.dependsOn.length > 0 ? { dependsOn: task.dependsOn } : {}),
    ...(task.releaseIds.length > 0 ? { releaseIds: task.releaseIds } : {}),
    ...(task.sourceRefs.length > 0 ? { references: task.sourceRefs } : {}),
    ...(executionBlocker ? { blockReason: executionBlocker } : {}),
    ...(task.status === 'spec_review' && specReviewAuthority
      ? { specReviewGate: { authority: specReviewAuthority } }
      : {}),
    ...(record.spec === 'present' ? { spec: 'indexed-present' } : {}),
    ...(acceptanceCriteriaCount > 0
      ? { acceptanceCriteria: Array.from({ length: acceptanceCriteriaCount }, (_, index) => ({
          id: `indexed-${task.id}-${index}`,
          description: 'Indexed acceptance criterion.',
        })) }
      : {}),
    ...(hasBrief
      ? { productBrief: {
          ...(approvedAt ? { approvedAt } : {}),
          ...(brief.userJob === true ? { userJob: 'indexed-present' } : {}),
          ...(hasShapedBrief ? { whyItMattersNow: 'indexed-present' } : {}),
          ...(brief.successMetric === true ? { successMetric: 'indexed-present' } : {}),
          ...(hasShapedBrief ? { nonGoals: ['indexed-present'] } : {}),
        } }
      : {}),
  } as Task
}

function rebuildScopeRowsFromIndexedState(
  queue: { releases: readonly Record<string, unknown>[]; selectedReleaseId: string | null },
  approvedPlan: ProjectSummaryApprovedPlan | null | undefined,
  tasks: readonly ProjectStateDatabaseTask[],
  savedScopeRows: readonly ProjectStateDatabaseScopeRow[],
): ProjectStateDatabaseScopeRow[] {
  const selectedProofStyle = selectedReleaseProofStyle(queue.releases, queue.selectedReleaseId)
  const taskById = new Map(tasks.map(task => [task.id, task]))
  const proofByTaskId = new Map<string, IndexedCurrentProof>(
    tasks.flatMap(task => {
      const proof = indexedCurrentProofForTask(task)
      return proof ? [[task.id, proof] as const] : []
    }),
  )
  const savedRowsByTaskId = new Map(savedScopeRows.map(row => [row.taskId, row]))
  const derivedRows = projectSummaryScopeRowsForQueue({
    version: 1,
    lastUpdated: new Date(0).toISOString(),
    tasks: tasks.map(indexedTaskForScopeProjection),
    releases: queue.releases as ProjectRelease[],
    ...(queue.selectedReleaseId ? { selectedReleaseId: queue.selectedReleaseId } : {}),
  }, approvedPlan, undefined, { currentStateAuthority: 'database' })
  return derivedRows.map(row => {
    const task = taskById.get(row.taskId)
    const proof = task ? indexedCurrentProofForTask(task) : undefined
    const saved = savedRowsByTaskId.get(row.taskId)
    const proofBlocked = task
      ? indexedTaskProofBlocked(task, proof, taskById, proofByTaskId, queue.selectedReleaseId, selectedProofStyle)
      : (saved?.proofBlocked ?? row.proofBlocked)
    return {
      ...row,
      proofBlocked,
      ...(proofBlocked ? { blockerSummary: 'Completion proof is missing or stale.' } : {}),
    }
  })
}

/**
 * Rebuild the selected-scope ledger from compact indexed rows. This is used
 * after a point task-definition mutation: all affected hierarchy rows update
 * together, while unrelated rich task details remain unopened.
 */
export function projectSummaryScopeRowsFromIndexedState(
  tasksPath: string,
  input: { taskOverrides?: readonly ProjectStateDatabaseTask[] } = {},
): ProjectStateDatabaseScopeRow[] | null {
  const current = readProjectStateDatabaseProjectionState<ProjectSummaryProjection>(tasksPath, {
    includeDefinitions: false,
  })
  if (!current?.summary) return null
  const overrides = new Map((input.taskOverrides ?? []).map(task => [task.id, task]))
  const tasks = current.inventory.tasks.map(task => overrides.get(task.id) ?? task)
  return rebuildScopeRowsFromIndexedState({
    releases: current.queue.releases,
    selectedReleaseId: current.queue.selectedReleaseId ?? null,
  }, current.summary.payload.approvedPlan, tasks, current.scopeRows)
}

function indexedProofStyle(value: unknown): ProjectScope['proofStyle'] | undefined {
  return value === 'script_only' || value === 'manual' || value === 'mixed' || value === 'unspecified'
    ? value
    : undefined
}

function selectedReleaseProofStyle(
  releases: readonly Record<string, unknown>[],
  selectedReleaseId: string | null,
): ProjectScope['proofStyle'] | undefined {
  if (!selectedReleaseId) return undefined
  return indexedProofStyle(releases.find(release => release.id === selectedReleaseId)?.proofStyle)
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
    const approvedBriefNeedsSpec = Boolean(
      briefSummary.present &&
      typeof briefSummary.approvedAt === 'string' &&
      briefSummary.approvedAt.trim().length > 0 &&
      briefSummary.shaped &&
      task.status === 'exploring' &&
      taskRecord.spec !== 'present',
    )
    return {
      id: task.id,
      title: task.title,
      description: task.description ?? undefined,
      status: task.status ?? undefined,
      updatedAt: task.updatedAt ?? undefined,
      dependsOn: task.dependsOn,
      blockReason: typeof taskRecord.blockReason === 'string' ? taskRecord.blockReason : undefined,
      recoveryCode: typeof taskRecord.recoveryCode === 'string' ? taskRecord.recoveryCode : undefined,
      hierarchy: task.hierarchy ? {
        parentId: typeof task.hierarchy.parentId === 'string' ? task.hierarchy.parentId : undefined,
        childIds: Array.isArray(task.hierarchy.childIds) ? task.hierarchy.childIds.filter((id): id is string => typeof id === 'string') : undefined,
      } : undefined,
      needsBriefCleanup: row?.handoffState === 'brief_cleanup' ||
        (row?.handoffState === 'not_shaped' && !approvedBriefNeedsSpec),
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
  const baseSource = base.source && typeof base.source === 'object' && !Array.isArray(base.source)
    ? base.source
    : {
        taskQueueLastUpdated: null,
        taskQueueMtimeMs: null,
        workspaceGoalsMtimeMs: null,
      }
  const sourceCapabilityCatalog = summarizeSourceCapabilityCatalog(readProjectStateDatabaseSourceCapabilities(tasksPath))
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
  const selectedProofStyle = selectedReleaseProofStyle(releases, selectedReleaseId)
  const taskOverrides = new Map((input.taskOverrides ?? []).map(task => [task.id, task]))
  const tasks = inventory.tasks.map(task => taskOverrides.get(task.id) ?? task)
  const tasksById = new Map(tasks.map(task => [task.id, task]))
  const rebuiltScopeRows = rebuildScopeRowsFromIndexedState({
    releases,
    selectedReleaseId,
  }, base.approvedPlan, tasks, current.scopeRows)
  const rebuiltScopeRowsByTaskId = new Map(rebuiltScopeRows.map(row => [row.taskId, row]))
  const scopeRowOverrides = new Map(
    (input.scopeRowOverrides ?? []).map(row => [row?.taskId ?? '', row]),
  )
  const rawIndexedRows: IndexedSummaryScopeRow[] = tasks.flatMap<IndexedSummaryScopeRow>(task => {
    const row = scopeRowOverrides.has(task.id)
      ? scopeRowOverrides.get(task.id) ?? null
      : rebuiltScopeRowsByTaskId.get(task.id) ?? task.scopeRow
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
      ? indexedTaskProofBlocked(indexedTask, currentProofByTaskId.get(row.taskId), tasksById, currentProofByTaskId, selectedReleaseId, selectedProofStyle)
      : false
    const proofBlocked = indexedTask
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
  const ownerReview = ownerReviewForScope(
    indexedScopeRowsAsProjectScopeRows(rows),
    tasks.map(indexedTaskForScopeProjection),
    generatedAt,
  )
  // A question is a direct decision request. Keep its precedence over an
  // available review identical to the shared decision packet.
  const start = applyOwnerInputToStartReadiness(
    applyOwnerReviewToStartReadiness(
      indexedStartReadiness(rows, releases, selectedReleaseId, tasks),
      ownerReview,
    ),
    base.ownerInput,
  )
  let nextAction: ProjectSummaryProjection['nextAction'] = {
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
  const canonicalReleaseMembership = selectedReleaseId
    ? readProjectStateDatabaseReleaseMembership(tasksPath, selectedReleaseId)
    : null
  const selectedReleaseTaskIds = selectedRelease
    ? releaseMembershipTaskIds(selectedRelease, 'nodeIds')
    : []
  const releaseMemberTaskIds = canonicalReleaseMembership
    ? new Set(canonicalReleaseMembership.included)
    : selectedReleaseTaskIds.length > 0
    ? new Set(selectedReleaseTaskIds)
    : selectedReleaseId
    ? new Set(rows
        .filter(row => row.scope === 'included' && tasksById.get(row.taskId)?.releaseIds.includes(selectedReleaseId))
        .map(row => row.taskId))
    : new Set<string>()
  const releaseMembershipRows = releaseMemberTaskIds.size > 0
    ? rows.filter(row => releaseMemberTaskIds.has(row.taskId))
    : selectedRelease ? rowsForReleaseMembership(rows, selectedRelease, 'nodeIds') : []
  const releaseExecutionRows = releaseMembershipRows.length > 0
    ? releaseMembershipRows
    : includedRows
      .filter(row => row.countInProjectTotals !== false)
      .filter(row => row.hierarchyRole !== 'parent' || !includedRows.some(child =>
        child.parentTaskId === row.taskId && child.countInProjectTotals !== false,
      ))
  const releaseIncluded = selectedRelease
    ? (releaseMemberTaskIds.size || selectedReleaseTaskIds.length)
    : releaseExecutionRows.length
  const releaseDeferred = deferredRows.length
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
      total: releaseIncluded,
      done: releaseExecutionRows.filter(row => row.handoffState === 'done').length,
      unfinished: Math.max(0, releaseIncluded - releaseExecutionRows.filter(row => row.handoffState === 'done').length),
      ready: releaseExecutionRows.filter(row => row.handoffState === 'ready').length,
      active: releaseExecutionRows.filter(row => ['paused', 'review'].includes(row.handoffState)).length,
      blocked: releaseExecutionRows.filter(row => row.blocksRelease).length,
      deferred: releaseDeferred,
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
  const initialDecision = buildProjectDecisionProjection({
    projectRevision: current.projectRevision,
    queueRevision: current.queueRevision,
    generatedAt,
    start,
    release: {
      ...releaseSummary,
      ...(releaseSummary.release?.state ? { lifecycleState: releaseSummary.release.state } : {}),
    },
    ownerInput: base.ownerInput,
    ownerReview,
    runStatus: base.execution?.status ?? 'stopped',
    runtimeExecution: base.execution,
    canonicalTaskRefs: canonicalDecisionTaskRefs(tasks, current.projectRevision),
  })
  const decisionStart = projectDecisionStartReadiness(initialDecision)
  nextAction = {
    ...nextAction,
    ...(decisionStart.code ? { code: decisionStart.code } : {}),
    message: decisionStart.message ?? nextAction.message,
    ...(decisionStart.focusTaskId ? { focusTaskId: decisionStart.focusTaskId } : {}),
    ...(decisionStart.focusTaskTitle ? { focusTaskTitle: decisionStart.focusTaskTitle } : {}),
    ...(decisionStart.focusKind ? { focusKind: decisionStart.focusKind } : {}),
    ...(typeof decisionStart.count === 'number' ? { count: decisionStart.count } : {}),
    ...(ownerReview?.taskIds.length ? { reviewTaskIds: [...ownerReview.taskIds] } : {}),
  }
  if (
    releaseSummary.state === 'ready' &&
    start.code === 'all_terminal' &&
    releaseSummary.release?.state !== 'shipped'
  ) {
    nextAction = {
      code: 'release_ready',
      label: 'Review project state',
      message: 'Review completed scope.',
    }
  }
  const rawCounts = summarizeRawTaskCounts(tasks)
  const actionModel = buildProjectActionModel({
    startReadiness: {
      ...decisionStart,
      ...(nextAction.code ? { code: nextAction.code } : {}),
      message: nextAction.message,
      ...(nextAction.focusTaskId ? { focusTaskId: nextAction.focusTaskId } : {}),
      ...(nextAction.focusTaskTitle ? { focusTaskTitle: nextAction.focusTaskTitle } : {}),
      ...(nextAction.focusKind ? { focusKind: nextAction.focusKind } : {}),
      ...(nextAction.count ? { count: nextAction.count } : {}),
      executionScope: selectedRelease
        ? {
            id: String(selectedRelease.id),
            label: String(selectedRelease.label ?? selectedRelease.id),
            kind: String(selectedRelease.kind ?? 'release'),
            source: typeof selectedRelease.source === 'string' ? selectedRelease.source : undefined,
            taskCount: releaseSummary.counts.total,
            deferredTaskCount: releaseSummary.counts.deferred,
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
    summaryTasks: indexedActionTasks(tasks, rowsByTaskId),
  })
  const decision = applyProjectActionModelPrimaryAction(initialDecision, actionModel.primaryAction)
  const scope = selectedRelease
    ? {
        id: String(selectedRelease.id),
        label: String(selectedRelease.label ?? selectedRelease.id),
        kind: String(selectedRelease.kind ?? 'release'),
        source: indexedScopeSource(selectedRelease.source),
        included: releaseSummary.counts.total,
        deferred: releaseSummary.counts.deferred,
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
    // The action model may refine a stale execution focus to the task that
    // can actually continue. Keep the persisted orientation pin on that same
    // shared decision instead of preserving the downstream task it replaced.
    focus: decision.execution.focus,
    currentProofByTaskId,
  })
  return {
    ...base,
    version: PROJECT_SUMMARY_PROJECTION_VERSION,
    projectId: input.projectId ?? base.projectId,
    generatedAt,
    freshness: 'current',
    source: {
      ...baseSource,
      taskQueueLastUpdated: input.sourceQueueLastUpdated ?? baseSource.taskQueueLastUpdated,
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
    sourceCapabilityCatalog,
    orientationSpine: currentOrientationSpine,
    releaseSummary,
    decision,
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
    ownerReview,
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
    focus?: ProjectDecisionTaskRef
    currentProofByTaskId: ReadonlyMap<string, IndexedCurrentProof>
  },
): ProjectSummaryProjection['orientationSpine'] {
  if (!spine) return null
  const blockers = input.releaseSummary.blockers.map(blocker => ({
    id: blocker.id,
    label: blocker.label,
    ...(blocker.code ? { code: blocker.code } : {}),
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
        // A release record's lifecycle is durable. `releaseSummary.state` is
        // current readiness and belongs on the release summary, not in the
        // historical release record rendered by Map or Release.
        state: releasePatch?.state as OrientationReleaseState ?? release.state,
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
        state: releasePatch?.state as OrientationReleaseState ?? spine.selectedRelease.state,
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
      dependencyBlocked: current.dependencyBlocked === true,
      ...(current.dependencyTaskIds?.length
        ? { dependencyTaskIds: [...current.dependencyTaskIds] }
        : {}),
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
  const focusPinKind: OrientationPin['kind'] = input.nextAction.focusKind === 'proof'
    ? 'proof'
    : input.nextAction.focusKind === 'spec_review'
      ? 'review'
      : input.nextAction.code === 'ready_work' || input.nextAction.code === 'paused_live_work'
        ? 'active_work'
        : 'owner_input'
  const activePins = input.focus
    ? [
        ...spine.activePins.filter(pin => !pin.id.startsWith('start-focus:')),
        {
          id: `start-focus:${input.focus.taskId}`,
          nodeId: `work:${input.focus.taskId}`,
          label: input.focus.displayTitle,
          kind: focusPinKind,
          href: `/work?task=${encodeURIComponent(input.focus.taskId)}`,
        },
      ]
    : spine.activePins
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
      topBlocker: input.nextAction.code === 'all_terminal'
        ? input.nextAction.message
        : blockers[0]?.label ?? null,
      nextAction: input.nextAction.message,
      pinnedNow: input.focus ? [input.focus.displayTitle] : spine.summary.pinnedNow,
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
    activePins,
    roots: spine.roots.map(patchNode),
    },
    {
    state: input.releaseSummary.state,
      ...(releasePatch?.state ? { lifecycleState: releasePatch.state as OrientationReleaseTruth['lifecycleState'] } : {}),
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

function canonicalDecisionClaimId(
  projectRevision: number,
  subject: { kind: string; id: string },
  field: string,
): string {
  return `canonical:${projectRevision}:${subject.kind}:${subject.id}:${field}`
}

/**
 * Materialize only the compact facts which the shared decision packet needs.
 * Task/release/runtime rows remain canonical; this ledger makes it explicit
 * which revision and registered facts produced a cross-surface action.
 */
export function canonicalDecisionStateResolution(input: {
  projectId: string | null
  projectRevision: number
  queueRevision: number | null
  selectedReleaseId: string | null
  decision: ProjectDecisionProjection
  generatedAt: string
  releaseSummary?: ProjectSummaryReleaseSummary | null
  releaseMembershipTaskIds?: readonly string[]
}): ProjectStateDatabaseStateResolutionSnapshot {
  // The decision is authoritative only for the revision that produced its
  // registered claims. Projection builders may start from an older compact
  // summary, so bind the payload itself here instead of trusting a copied
  // revision token from that input.
  const decision: ProjectDecisionProjection = {
    ...input.decision,
    projectRevision: input.projectRevision,
    queueRevision: input.queueRevision,
    generatedAt: input.generatedAt,
  }
  const project = { kind: 'project', id: input.projectId ?? 'unknown-project' }
  const claim = <T>(subject: ProjectStateClaim['subject'], field: ProjectStateClaim['field'], value: T): ProjectStateClaim<T> => ({
    id: canonicalDecisionClaimId(input.projectRevision, subject, field),
    projectRevision: input.projectRevision,
    subject,
    field,
    value,
    authority: 'canonical_mutation',
    actor: 'project-state-boundary',
    observedAt: input.generatedAt,
    evidenceRefs: [],
  })
  const focus = decision.planExecution?.focus ?? decision.execution.focus
  const claims: ProjectStateClaim[] = [
    claim(project, 'project.selectedReleaseId', input.selectedReleaseId),
    claim(project, 'project.executionFocus', focus
      ? { taskId: focus.taskId, taskRevision: focus.taskRevision ?? input.projectRevision }
      : null),
    claim(project, 'project.executionEligibility', {
      state: input.decision.planExecution?.state ?? input.decision.execution.state,
      code: input.decision.planExecution?.code ?? input.decision.execution.code,
      primaryAction: decision.primaryAction,
    }),
  ]
  if (input.selectedReleaseId && input.releaseSummary?.release?.id === input.selectedReleaseId) {
    const release = { kind: 'release', id: input.selectedReleaseId }
    const summary = input.releaseSummary
    claims.push(
      claim(release, 'release.lifecycleState', summary.release!.state),
      claim(release, 'release.membershipTaskIds', [...new Set(input.releaseMembershipTaskIds ?? [])].sort()),
      claim(release, 'release.readiness', {
        state: summary.state,
        counts: summary.counts,
        blockerTaskIds: summary.blockers
          .map(blocker => blocker.owningTaskId ?? blocker.id)
          .filter((taskId): taskId is string => Boolean(taskId))
          .sort(),
      }),
    )
  }
  const resolution = resolveRegisteredProjectStateClaimSet({
    projectRevision: input.projectRevision,
    claims,
  })
  const disagreements = resolution.disagreements.map(disagreement => ({
    id: disagreement.id,
    subject: disagreement.subject,
    field: disagreement.field,
    canonicalClaimIds: disagreement.canonicalClaimIds,
    contradictoryClaimIds: disagreement.contradictoryClaimIds,
    state: disagreement.state,
    reconciliation: disagreement.reconciliation,
  }))
  const fingerprint = stableJson({
    claims,
    resolved: resolution.resolved,
    rejected: resolution.rejected,
    disagreements,
    decision,
  })
  return {
    projectRevision: input.projectRevision,
    queueRevision: input.queueRevision,
    generatedAt: input.generatedAt,
    claims,
    disagreements,
    decision,
    fingerprint,
  }
}

function canonicalReleaseMembershipTaskIds(projection: Pick<ProjectSummaryProjection, 'orientationSpine'>): string[] {
  return [...new Set((projection.orientationSpine?.selectedRelease?.nodeIds ?? [])
    .map(nodeId => nodeId.startsWith('work:') ? nodeId.slice('work:'.length) : nodeId)
    .filter(Boolean))]
    .sort()
}

function releaseMembershipTaskIds(release: unknown, field: 'nodeIds' | 'deferredNodeIds'): string[] {
  if (!release || typeof release !== 'object' || Array.isArray(release)) return []
  return stringArray((release as Record<string, unknown>)[field])
    .map(nodeId => nodeId.startsWith('work:') ? nodeId.slice('work:'.length) : nodeId)
    .filter(Boolean)
}

function rowsForReleaseMembership<T extends { taskId: string }>(
  rows: readonly T[],
  release: unknown,
  field: 'nodeIds' | 'deferredNodeIds',
): T[] {
  const taskIds = new Set(releaseMembershipTaskIds(release, field))
  if (taskIds.size === 0) return []
  return rows.filter(row => taskIds.has(row.taskId))
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
  const selectedProofStyle = selectedReleaseProofStyle(
    indexedState?.queue.releases ?? [],
    indexedState?.queue.selectedReleaseId ?? null,
  )
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
      const proofBlocked = indexedTaskProofBlocked(task!, proof, taskById, currentProofByTaskId, indexedState?.queue.selectedReleaseId ?? null, selectedProofStyle) ||
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
    dependencyBlocked: row.dependencyBlocked === true,
    dependencyTaskIds: row.dependencyTaskIds ?? [],
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
  const stateResolution = expectedProjectRevision === null
    ? undefined
    : canonicalDecisionStateResolution({
        projectId: projection.projectId,
        projectRevision: expectedProjectRevision,
        queueRevision: indexedState?.queueRevision ?? null,
        selectedReleaseId: indexedState?.queue.selectedReleaseId ?? null,
        decision: projection.decision,
        generatedAt: projection.generatedAt,
        releaseSummary: projection.releaseSummary,
        releaseMembershipTaskIds: canonicalReleaseMembershipTaskIds(projection),
      })
  /*
   * Indexed proof refreshes must publish the corrected scope rows as well as
   * the compact summary. Otherwise Release/Overview can be current while
   * Work still reads a stale proof_blocked bit from work_scope.
   */
  writeProjectStateDatabaseSummarySnapshot(tasksPath, {
    summary: projection,
    ...snapshotProjection,
    ...(stateResolution ? { stateResolution } : {}),
    ...(input.expectedQueueRevision !== undefined && input.expectedQueueRevision !== null
      ? { expectedQueueRevision: input.expectedQueueRevision }
      : {}),
    ...(expectedProjectRevision !== null ? { expectedProjectRevision } : {}),
  })
  return withPersistedReleaseMembershipRevision(tasksPath, projection)
}

export function buildProjectSummaryProjectionError(input: {
  projectId?: string | null
  taskQueueLastUpdated?: string | null
  taskQueueMtimeMs?: number | null
  workspaceGoalsMtimeMs?: number | null
  approvedPlan?: ProjectSummaryApprovedPlan | null
  orientation?: ProjectOrientationSnapshot | null
  documentedStructure?: OrientationWorkspaceImportDraftContext[]
  sourceCapabilities?: readonly ProjectStateDatabaseSourceCapability[] | null
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
    documentedStructure: (input.documentedStructure ?? []).map(context => ({
      ...context,
      ...(context.refs ? { refs: [...context.refs] } : {}),
      ...(context.releaseIds ? { releaseIds: [...context.releaseIds] } : {}),
      ...(context.linkedTaskHints ? { linkedTaskHints: [...context.linkedTaskHints] } : {}),
    })),
    sourceCapabilityCatalog: summarizeSourceCapabilityCatalog(input.sourceCapabilities),
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
    decision: buildProjectDecisionProjection({
      generatedAt: input.generatedAt ?? new Date().toISOString(),
      start: {
        canStart: false,
        code: 'summary_unavailable',
        message: 'The project summary could not be refreshed from its task state.',
      },
      release: {
        scopeMode: 'unavailable',
        release: null,
        state: 'unknown',
        blockers: [],
      },
      ownerInput: input.ownerInput,
      runStatus: input.execution?.status ?? 'stopped',
    }),
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
  const canonicalQueueRecord = currentStateAuthority === 'database'
    ? readProjectStateDatabaseQueueDefinitionForMigration(tasksPath)
    : null
  if (currentStateAuthority === 'database' && canonicalQueueRecord === null) {
    throw new Error('Cannot refresh a promoted project summary without the canonical queue definition.')
  }
  const canonicalQueue = canonicalQueueRecord === null
    ? null
    : normalizeLegacyTaskQueueForMigration(canonicalQueueRecord)
  const capturedProjectRevision = currentStateAuthority === 'database'
    ? readProjectStateDatabaseRevisionFromTasksPath(tasksPath)
    : null
  const projection = buildProjectSummaryProjection({
    ...input,
    ...(canonicalQueue !== null ? { queue: canonicalQueue as TaskQueueModel } : {}),
    currentStateAuthority,
    taskQueueMtimeMs: input.taskQueueMtimeMs ?? taskQueueMtimeMs(tasksPath),
    workspaceGoalsMtimeMs: input.workspaceGoalsMtimeMs ?? workspaceGoalsMtimeMs(tasksPath),
    approvedPlan: input.approvedPlan ?? readApprovedPlan(tasksPath),
    sourceCapabilities: input.sourceCapabilities ?? readProjectStateDatabaseSourceCapabilities(tasksPath),
  })
  const projectedQueue = canonicalQueue !== null
    ? canonicalQueue as unknown as TaskQueueModel
    : input.queue
  const scopeRows = projectSummaryScopeRowsForQueue(projectedQueue, projection.approvedPlan, input.projectionTasks, {
    currentStateAuthority,
  })
  const stateResolution = capturedProjectRevision === null
    ? undefined
    : canonicalDecisionStateResolution({
        projectId: projection.projectId,
        projectRevision: capturedProjectRevision,
        queueRevision: readProjectStateDatabaseQueueRevision(tasksPath),
        selectedReleaseId: (canonicalQueue as { selectedReleaseId?: string } | null)?.selectedReleaseId ?? null,
        decision: projection.decision,
        generatedAt: projection.generatedAt,
        releaseSummary: projection.releaseSummary,
        releaseMembershipTaskIds: canonicalReleaseMembershipTaskIds(projection),
      })
  if (currentStateAuthority === 'database') {
    writeProjectStateDatabaseSummarySnapshot(tasksPath, {
      summary: projection,
      scopeRows,
      ...(stateResolution ? { stateResolution } : {}),
      ...(input.expectedQueueRevision !== undefined && input.expectedQueueRevision !== null
        ? { expectedQueueRevision: input.expectedQueueRevision }
        : {}),
      ...(capturedProjectRevision !== null
        ? { expectedProjectRevision: capturedProjectRevision }
        : {}),
    })
  } else {
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: projectedQueue,
      summary: projection,
      ...(input.execution ? { execution: input.execution } : {}),
      ...(input.runtime ? { runtime: input.runtime } : {}),
      ...(input.projectRoot ? { projectRoot: input.projectRoot } : {}),
      scopeRows,
      ...(input.expectedQueueRevision !== undefined && input.expectedQueueRevision !== null
        ? { expectedQueueRevision: input.expectedQueueRevision }
        : {}),
      ...(input.compatibilityExport ? { compatibilityExport: input.compatibilityExport } : {}),
    })
  }
  return withPersistedReleaseMembershipRevision(tasksPath, projection)
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
    /** Compact source-backed project skeleton, never a raw intake scan. */
    documentedStructure?: OrientationWorkspaceImportDraftContext[]
    sourceCapabilities?: readonly ProjectStateDatabaseSourceCapability[] | null
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
        documentedStructure: input.documentedStructure ?? supplemental.documentedStructure,
        sourceCapabilities: input.sourceCapabilities ?? readProjectStateDatabaseSourceCapabilities(tasksPath),
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
        documentedStructure: input.documentedStructure ?? supplemental.documentedStructure,
        sourceCapabilities: input.sourceCapabilities ?? readProjectStateDatabaseSourceCapabilities(tasksPath),
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
    /** Compact source-backed project skeleton, never a raw intake scan. */
    documentedStructure?: OrientationWorkspaceImportDraftContext[]
    generatedAt?: string
    expectedQueueRevision?: number | null
    expectedProjectRevision?: number | null
    /** Migration-only request to retain the retired queue export. */
    compatibilityExport?: 'full' | 'compact'
    /**
     * Explicit structural queue commit. Promoted projects default to a
     * summary-only refresh so an incidental projection cannot rewrite a
     * release relation.
     */
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
  const databaseAuthority = readProjectStateDatabaseCurrentAuthorityFromTasksPath(tasksPath) === 'database'
  const canonicalQueueRecord = databaseAuthority && input.queueCommit !== true
    ? readProjectStateDatabaseQueueDefinitionForMigration(tasksPath)
    : null
  if (databaseAuthority && input.queueCommit !== true && canonicalQueueRecord === null) {
    throw new Error('Cannot refresh a promoted project summary without the canonical queue definition.')
  }
  const canonicalQueue = canonicalQueueRecord === null
    ? null
    : normalizeLegacyTaskQueueForMigration(canonicalQueueRecord)
  const prepared = prepareProjectSummaryProjectionFromUnknownQueue(tasksPath, {
    ...input,
    ...(canonicalQueue !== null ? { queue: canonicalQueue } : {}),
  })
  const { projection, detailQueue, scopeRows } = prepared
  if (databaseAuthority && input.queueCommit !== true) {
    const expectedProjectRevision = capturedProjectRevision
    const stateResolution = expectedProjectRevision === null
      ? undefined
      : canonicalDecisionStateResolution({
          projectId: projection.projectId,
          projectRevision: expectedProjectRevision,
          queueRevision: readProjectStateDatabaseQueueRevision(tasksPath),
          selectedReleaseId: (canonicalQueue as { selectedReleaseId?: string } | null)?.selectedReleaseId ?? null,
          decision: projection.decision,
          generatedAt: projection.generatedAt,
          releaseSummary: projection.releaseSummary,
          releaseMembershipTaskIds: canonicalReleaseMembershipTaskIds(projection),
        })
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
      ...(stateResolution ? { stateResolution } : {}),
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
  return withPersistedReleaseMembershipRevision(tasksPath, projection)
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
    availability?: ProjectStateDatabaseAvailability
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
    if (patch.execution && next.decision && next.execution) {
      next.decision = applyRuntimeExecutionToProjectDecision(next.decision, next.execution)
    }
    const resolvedNext = next
    if (!resolvedNext) throw new Error('Project summary update did not produce a projection.')
    return {
      summary: resolvedNext as unknown as Record<string, unknown>,
      currentState: {
        ...(patch.execution && next.execution
          ? { execution: next.execution }
          : {}),
        ...(patch.runtime && next.runtime
          ? { runtime: next.runtime }
          : {}),
        ...(patch.availability ? { availability: patch.availability } : {}),
        stateResolution: ({ projectRevision, queueRevision, generatedAt }) =>
          canonicalDecisionStateResolution({
            projectId: resolvedNext.projectId,
            projectRevision,
            queueRevision,
            selectedReleaseId: resolvedNext.releaseSummary.release?.id ?? null,
            decision: resolvedNext.decision,
            generatedAt,
            releaseSummary: resolvedNext.releaseSummary,
            releaseMembershipTaskIds: canonicalReleaseMembershipTaskIds(resolvedNext),
          }),
      },
    }
  })
  return next
}

function existingProjectionFields(
  tasksPath: string,
  seed?: ProjectSummaryProjection | null,
): Pick<ProjectSummaryProjectionInput, 'execution' | 'runtime' | 'ownerInput' | 'orientation' | 'documentedStructure'> {
  const existing = seed ?? readProjectSummaryProjection(tasksPath)
  return {
    ...(existing?.execution ? { execution: existing.execution } : {}),
    ...(existing?.runtime ? { runtime: existing.runtime } : {}),
    ...(existing?.ownerInput ? { ownerInput: existing.ownerInput } : {}),
    ...(existing?.orientation ? { orientation: existing.orientation } : {}),
    ...(existing?.documentedStructure?.length ? { documentedStructure: existing.documentedStructure } : {}),
  }
}

export function readProjectSummaryProjection(tasksPath: string): ProjectSummaryProjection | null {
  const databaseSummary = readProjectStateDatabaseSummary<ProjectSummaryProjection>(tasksPath)
  if (databaseSummary) {
    const summary = synchronizeProjectSummaryDecision(databaseSummary.payload)
    return {
      ...summary,
      freshness: projectSummaryProjectionIsCurrent(summary)
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
    if (LEGACY_PROJECT_SUMMARY_PROJECTION_VERSIONS.has(parsed.version) || !projectSummaryProjectionIsCurrent(parsed)) {
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
      const summary = synchronizeProjectSummaryDecision(databaseSummary.payload)
      return {
        ...summary,
        orientationSpine: null,
        freshness: projectSummaryProjectionIsCurrent(summary)
          ? databaseSummary.freshness
          : 'stale',
      }
    }
  } catch {
    // A corrupt or locked project stays visible as unavailable; it cannot fail the fleet shell.
  }
  return null
}

/**
 * A matching version alone is not enough. Derived projection fields can be
 * introduced by a partial writer or a failed upgrade; a summary without the
 * shared decision packet must refresh instead of presenting old caches as
 * current project state.
 */
export function projectSummaryProjectionIsCurrent(value: Pick<ProjectSummaryProjection, 'version' | 'decision' | 'sourceCapabilityCatalog'> | Record<string, unknown>): boolean {
  if (value.version !== PROJECT_SUMMARY_PROJECTION_VERSION) return false
  const decision = value.decision
  const sourceCapabilityCatalog = value.sourceCapabilityCatalog
  const decisionExecution = decision && typeof decision === 'object' && !Array.isArray(decision)
    ? (decision as { execution?: unknown }).execution
    : null
  const focusIsAtomic = !decisionExecution || typeof decisionExecution !== 'object' || Array.isArray(decisionExecution)
    ? false
    : (() => {
        const execution = decisionExecution as { focusTaskId?: unknown; focusTaskTitle?: unknown; focus?: unknown }
        if (typeof execution.focusTaskId !== 'string' || !execution.focusTaskId.trim()) return true
        if (!execution.focus || typeof execution.focus !== 'object' || Array.isArray(execution.focus)) return false
        const focus = execution.focus as { taskId?: unknown; displayTitle?: unknown }
        return focus.taskId === execution.focusTaskId &&
          typeof focus.displayTitle === 'string' && focus.displayTitle.trim().length > 0 &&
          (typeof execution.focusTaskTitle !== 'string' || focus.displayTitle === execution.focusTaskTitle)
      })()
  return Boolean(
    decision &&
    typeof decision === 'object' &&
    !Array.isArray(decision) &&
    (decision as { version?: unknown }).version === 1 &&
    (decision as { planExecution?: unknown }).planExecution &&
    typeof (decision as { planExecution?: unknown }).planExecution === 'object' &&
    !Array.isArray((decision as { planExecution?: unknown }).planExecution) &&
    typeof ((decision as { planExecution?: { state?: unknown } }).planExecution?.state) === 'string' &&
    typeof ((decision as { planExecution?: { code?: unknown } }).planExecution?.code) === 'string' &&
    focusIsAtomic &&
    sourceCapabilityCatalog &&
    typeof sourceCapabilityCatalog === 'object' &&
    !Array.isArray(sourceCapabilityCatalog) &&
    ['unavailable', 'empty', 'ready'].includes((sourceCapabilityCatalog as { availability?: unknown }).availability as string),
  )
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
  if (databaseAuthority) {
    const canonicalQueue = readProjectStateDatabaseQueueDefinitionForMigration(tasksPath)
    if (!canonicalQueue) {
      return buildProjectSummaryProjectionError({
        projectId: input.projectId,
        error: new Error('The authoritative project detail store is unavailable; no queue was rebuilt.'),
        generatedAt: input.now,
      })
    }
    const normalizedCanonicalQueue = normalizeLegacyTaskQueueForMigration(canonicalQueue, input.now ?? new Date().toISOString())
    const parsedCanonicalQueue = TaskQueue.safeParse(normalizedCanonicalQueue)
    if (parsedCanonicalQueue.success) {
      return writeProjectSummaryProjectionFromUnknownQueue(tasksPath, {
        projectId: input.projectId,
        projectRoot: input.projectRoot,
        queue: parsedCanonicalQueue.data,
        generatedAt: input.now,
        queueCommit: false,
        existingSummary: historicalSummary,
      })
    }
    const indexed = writeProjectSummaryProjectionFromIndexedState(tasksPath, {
      projectId: input.projectId,
      generatedAt: input.now,
    })
    if (indexed) return indexed
    return buildProjectSummaryProjectionError({
      projectId: input.projectId,
      error: new Error('The authoritative project index is unavailable; no queue was rebuilt.'),
      generatedAt: input.now,
    })
  }
  try {
    raw = readProjectStateDatabaseQueueDefinitionForMigration(tasksPath)
    raw ??= JSON.parse(readManagedTextFileSync(tasksPath, 'utf8'))
  } catch (error) {
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
  const release = input.scopeProjection.selectedScope
    ? (input.queue.releases ?? []).find(candidate => candidate.id === input.scopeProjection.selectedScope?.id) ?? null
    : null
  const rows = input.scopeProjection.rows.filter(row => row.scope === 'included')
  const releaseRows = release ? rowsForReleaseMembership(rows, release, 'nodeIds') : []
  const executionRows = releaseRows.length > 0 ? releaseRows : executionScopeRows(rows)
  const included = release
    ? releaseMembershipTaskIds(release, 'nodeIds').length
    : executionRows.length
  const done = executionRows.filter(row => row.handoffState === 'done').length
  const deferred = input.scopeProjection.counts.deferred
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
      deferred,
      ownerBlocked: executionRows.filter(row => projectScopeRowNeedsOwnerInput(row)).length,
      proofBlocked: executionRows.filter(row => row.proofBlocked).length,
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
