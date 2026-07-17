import { getProjectSystemStatePath } from '@guildhall/sessions'
import type {
  ProjectStateDatabaseInventory,
  ProjectStateDatabaseQueue,
  ProjectStateDatabaseTask,
} from '@guildhall/sessions'
import {
  readProjectCompactStateModel,
  readProjectStateAuthorityAtBoundary,
  type ProjectCompactStateReadModel,
} from './project-state-boundary.js'
import type { ProjectScope } from './project-scope-projection.js'
import type { ProjectSummaryProjection } from './project-summary-projection.js'

export const PROJECT_DETAIL_READ_PROJECTION_SCHEMA_VERSION = 1 as const
export const PROJECT_DETAIL_READ_PROJECTION_DEFAULT_LIMIT = 50 as const
export const PROJECT_DETAIL_READ_PROJECTION_MAX_LIMIT = 100 as const

export type ProjectDetailReadProjectionMissingReason =
  | 'project_state_not_promoted'
  | 'database_unavailable'
  | 'summary_missing'

export type ProjectDetailReadProjectionStaleReason = 'summary_stale'
export type ProjectDetailReadProjectionSelectedTaskState = 'not_requested' | 'present' | 'missing'

export interface ProjectDetailReadProjectionOptions {
  /** Zero-based page offset into the indexed task inventory. */
  offset?: number
  /** The requested page is always bounded, including when omitted. */
  limit?: number
  /** Read one compact task point from the same SQLite snapshot. */
  selectedTaskId?: string
}

export interface ProjectDetailReadProjectionRevisions {
  queue: number | null
  project: number | null
}

interface ProjectDetailReadProjectionPayload {
  queue: ProjectStateDatabaseQueue
  inventory: ProjectStateDatabaseInventory
  selectedTask: ProjectStateDatabaseTask | null
  selectedTaskId: string | null
  selectedTaskState: ProjectDetailReadProjectionSelectedTaskState
  scope: ProjectScope | null
  summary: ProjectSummaryProjection
  revisions: ProjectDetailReadProjectionRevisions
}

export interface ProjectDetailReadProjectionCurrent extends ProjectDetailReadProjectionPayload {
  schemaVersion: typeof PROJECT_DETAIL_READ_PROJECTION_SCHEMA_VERSION
  status: 'current'
  freshness: 'current'
  authority: 'database'
  requiresRefresh: false
}

export interface ProjectDetailReadProjectionStale extends ProjectDetailReadProjectionPayload {
  schemaVersion: typeof PROJECT_DETAIL_READ_PROJECTION_SCHEMA_VERSION
  status: 'stale'
  freshness: 'stale'
  authority: 'database'
  requiresRefresh: true
  reason: ProjectDetailReadProjectionStaleReason
  summary: ProjectSummaryProjection
}

export interface ProjectDetailReadProjectionMissing {
  schemaVersion: typeof PROJECT_DETAIL_READ_PROJECTION_SCHEMA_VERSION
  status: 'missing'
  freshness: 'missing'
  authority: 'database' | 'legacy'
  requiresRefresh: true
  reason: ProjectDetailReadProjectionMissingReason
  queue: ProjectStateDatabaseQueue | null
  inventory: ProjectStateDatabaseInventory | null
  selectedTask: ProjectStateDatabaseTask | null
  selectedTaskId: string | null
  selectedTaskState: ProjectDetailReadProjectionSelectedTaskState
  scope: ProjectScope | null
  summary: ProjectSummaryProjection | null
  revisions: ProjectDetailReadProjectionRevisions
}

export type ProjectDetailReadProjection =
  | ProjectDetailReadProjectionCurrent
  | ProjectDetailReadProjectionStale
  | ProjectDetailReadProjectionMissing

function boundedOffset(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value as number)) : 0
}

function boundedLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return PROJECT_DETAIL_READ_PROJECTION_DEFAULT_LIMIT
  return Math.min(PROJECT_DETAIL_READ_PROJECTION_MAX_LIMIT, Math.max(1, Math.trunc(value as number)))
}

function requestedTaskId(value: string | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function selectedTaskState(
  taskId: string | null,
  task: ProjectStateDatabaseTask | null,
): ProjectDetailReadProjectionSelectedTaskState {
  if (!taskId) return 'not_requested'
  return task ? 'present' : 'missing'
}

function missingProjection(input: {
  authority: 'database' | 'legacy'
  reason: ProjectDetailReadProjectionMissingReason
  revisions: ProjectDetailReadProjectionRevisions
  selectedTaskId: string | null
  state?: Partial<Pick<ProjectDetailReadProjectionMissing, 'queue' | 'inventory' | 'selectedTask' | 'scope' | 'summary'>>
}): ProjectDetailReadProjectionMissing {
  return {
    schemaVersion: PROJECT_DETAIL_READ_PROJECTION_SCHEMA_VERSION,
    status: 'missing',
    freshness: 'missing',
    authority: input.authority,
    requiresRefresh: true,
    reason: input.reason,
    queue: input.state?.queue ?? null,
    inventory: input.state?.inventory ?? null,
    selectedTask: input.state?.selectedTask ?? null,
    selectedTaskId: input.selectedTaskId,
    selectedTaskState: selectedTaskState(input.selectedTaskId, input.state?.selectedTask ?? null),
    scope: input.state?.scope ?? null,
    summary: input.state?.summary ?? null,
    revisions: input.revisions,
  }
}

function payloadFromCompactState(
  state: ProjectCompactStateReadModel,
  selectedTaskId: string | null,
): ProjectDetailReadProjectionPayload {
  return {
    queue: state.queue,
    inventory: state.inventory,
    selectedTask: state.selectedTask,
    selectedTaskId,
    selectedTaskState: selectedTaskState(selectedTaskId, state.selectedTask),
    scope: state.scope,
    summary: state.summary as ProjectSummaryProjection,
    revisions: {
      queue: state.queueRevision,
      project: state.projectRevision,
    },
  }
}

/**
 * Read the promoted project's bounded detail surface from one saved SQLite
 * snapshot. This adapter intentionally has no compatibility-file, repair,
 * Git, evidence, or aggregate-task path.
 */
export function readProjectDetailReadProjection(
  projectRoot: string,
  options: ProjectDetailReadProjectionOptions = {},
): ProjectDetailReadProjection {
  const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
  const authority = readProjectStateAuthorityAtBoundary(tasksPath)
  const selectedTaskId = requestedTaskId(options.selectedTaskId)
  const revisions = {
    queue: authority.queueRevision,
    project: authority.projectRevision,
  }

  let state: ProjectCompactStateReadModel | null
  try {
    state = readProjectCompactStateModel(tasksPath, {
      offset: boundedOffset(options.offset),
      limit: boundedLimit(options.limit),
      ...(selectedTaskId ? { selectedTaskId } : {}),
    })
  } catch {
    return missingProjection({
      authority: 'database',
      reason: 'database_unavailable',
      revisions,
      selectedTaskId,
    })
  }

  if (!state) {
    return missingProjection({
      authority: authority.authority,
      reason: authority.authority === 'database' ? 'database_unavailable' : 'project_state_not_promoted',
      revisions,
      selectedTaskId,
    })
  }

  if (!state.summary) {
    return missingProjection({
      authority: 'database',
      reason: 'summary_missing',
      revisions: { queue: state.queueRevision, project: state.projectRevision },
      selectedTaskId,
      state,
    })
  }

  const payload = payloadFromCompactState(state, selectedTaskId)
  if (state.summary.freshness !== 'current') {
    return {
      schemaVersion: PROJECT_DETAIL_READ_PROJECTION_SCHEMA_VERSION,
      status: 'stale',
      freshness: 'stale',
      authority: 'database',
      requiresRefresh: true,
      reason: 'summary_stale',
      ...payload,
    }
  }

  return {
    schemaVersion: PROJECT_DETAIL_READ_PROJECTION_SCHEMA_VERSION,
    status: 'current',
    freshness: 'current',
    authority: 'database',
    requiresRefresh: false,
    ...payload,
  }
}
