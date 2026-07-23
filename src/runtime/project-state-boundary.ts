import { readManagedTextFileSync, writeManagedTextFileSync } from '@guildhall/persistence'
import {
  compactProjectStateQueueForCompatibility,
  getProjectSystemStatePath,
  projectStateDatabaseTaskSummary,
  readProjectStateDatabaseAuthoritySnapshotFromTasksPath,
  type ProjectStateDatabaseDiagnosticProjection,
  type ProjectStateDatabaseMemoryHealthProjection,
  type ProjectStateDatabaseAvailability,
  readProjectStateDatabaseCurrentState,
  readProjectStateDatabaseCurrentTasksWithRevision,
  readProjectStateDatabaseInventory,
  readProjectStateDatabaseMetadata,
  readProjectStateDatabaseProjectionState,
  readProjectStateDatabaseReadBundle,
  readProjectStateDatabaseSurfaceState,
  readProjectStateDatabaseShellState,
  readProjectStateDatabaseTaskDetailStateAtBoundary,
  readProjectStateDatabaseTaskEvidenceCurrentMany,
  readProjectStateDatabaseTaskEvidenceCurrentManyWithRevision,
  readTaskEvidencePage as readSessionTaskEvidencePage,
  readProjectStateDatabaseTaskPointWithRevision,
  readProjectStateDatabaseTaskPointsWithRevision,
  readProjectStateDatabaseRepository,
  readProjectStateDatabaseQueueDefinition,
  readProjectStateDatabaseQueueRevision,
  readProjectStateDatabaseTaskEvidenceAuthority,
  readProjectTaskQueueSyncWithRevision,
  readProjectTaskQueueSync as readProjectTaskQueueSyncFromDatabase,
  writeProjectStateDatabaseReleaseSelectionMutation,
  writeProjectStateDatabaseTaskBatchMutation,
  writeProjectStateDatabaseTaskMutation,
  type ProjectStateDatabaseTaskEvidenceRetentionInput,
  type ProjectStateDatabaseInventory,
  type ProjectStateDatabaseProjectionReadOptions,
  type ProjectStateDatabaseQueueDefinition,
  type ProjectStateDatabaseQueue,
  type ProjectStateDatabaseRepository,
  type ProjectStateDatabaseScopeRow,
  type ProjectStateDatabaseTask,
  type ProjectStateDatabaseTaskDetailReadOptions,
  type ProjectStateDatabaseTaskOverlay,
  type ProjectStateDatabaseTaskOverlayStores,
  type ProjectStateDatabaseTaskRelationships,
  type ProjectStateDatabaseSummary,
  type ProjectStateDatabaseSurfaceReadOptions,
  type ProjectStateDatabaseSurfaceState,
  type ProjectStateDatabaseTaskEvidenceCurrentManyRead,
} from '@guildhall/sessions'
import type {
  ProjectRelease,
  Task,
  TaskEvidenceEvent as TaskEvidenceEventRecord,
  TaskEvidenceKind,
} from '@guildhall/core'
import {
  PROJECT_SUMMARY_PROJECTION_VERSION,
  buildProjectSummaryProjectionFromIndexedState,
  projectSummaryScopeRowsFromIndexedState,
  prepareProjectSummaryProjectionFromUnknownQueue,
  readProjectSummaryProjection,
  writeProjectSummaryProjectionFromUnknownQueue,
  type ProjectSummaryProjection,
} from './project-summary-projection.js'
import { executionScopeRows, taskScopeNodeId, type ProjectScope } from './project-scope-projection.js'
import { buildEffectiveTask, buildEffectiveTasks } from './effective-task.js'
import { appendTaskEvidence, TASK_EVIDENCE_RETENTION } from './task-state-store.js'
import { recoverClippedTitle } from '@guildhall/shared'

function projectSummaryAtRuntimeVersion(
  summary: ProjectStateDatabaseSummary<ProjectSummaryProjection> | ProjectSummaryProjection,
): ProjectSummaryProjection {
  const payload = 'payload' in summary ? summary.payload : summary
  const version = payload && typeof payload === 'object'
    ? (payload as { version?: unknown }).version
    : undefined
  return {
    ...payload,
    freshness: typeof version !== 'number' || version === PROJECT_SUMMARY_PROJECTION_VERSION
      ? summary.freshness
      : 'stale',
  }
}

export const FORBIDDEN_PROJECT_TASK_FIELDS = [
  'assignedTo',
  'notes',
  'reviewVerdicts',
  'adjudications',
  'gateResults',
  'escalations',
  'agentIssues',
  'worktreePath',
  'branchName',
  'baseBranch',
  'doneSummaryBundle',
  'mergeRecord',
  'revisionCount',
  'retryWindow',
  'remediationAttempts',
  'workerRecovery',
  'handoffStep',
  'proofRecovery',
  'currentLifecycle',
  'shelveReason',
  // Effective-task read models carry these fields for consumers, but they
  // are never part of the authoritative task definition row.
  'runtime',
  'workspace',
  'evidence',
] as const

export type ForbiddenProjectTaskField = typeof FORBIDDEN_PROJECT_TASK_FIELDS[number]

/**
 * Test project-state presence at the authority boundary. A promoted project
 * may have no compatibility TASKS file; absence of its database queue is a
 * corruption/error condition, not a reason for a route to pretend the
 * project has no work.
 */
export function projectTaskStateExistsSync(tasksPath: string): boolean {
  const state = readProjectStateAuthorityAtBoundary(tasksPath)
  // Presence is a current-state database fact. A leftover TASKS.json is not
  // evidence that the application has readable work.
  return state.authority === 'database' && state.queueRevision !== null
}

export interface ProjectStateAuthorityReadModel {
  authority: 'database' | 'legacy'
  queueRevision: number | null
  projectRevision: number | null
}

/**
 * Shared source-selection boundary for runtime callers. The sessions layer
 * owns the atomic read; callers consume this result instead of independently
 * checking a promotion marker, queue existence, or revision.
 */
export function readProjectStateAuthorityAtBoundary(tasksPath: string): ProjectStateAuthorityReadModel {
  const snapshot = readProjectStateDatabaseAuthoritySnapshotFromTasksPath(tasksPath)
  if (!snapshot) return { authority: 'legacy', queueRevision: null, projectRevision: null }
  return snapshot
}

/**
 * The runtime read boundary for current project state.
 *
 * Queue definitions and summary projections are one state model: the queue
 * names the durable work, while the summary is the saved interpretation used
 * by compact and rich surfaces. Returning them together makes it explicit
 * when a caller is looking at a stale projection instead of silently letting
 * the caller invent a second interpretation.
 */
export interface ProjectCurrentStateReadModel {
  queue: unknown
  scopeRows: ProjectStateDatabaseScopeRow[]
  /** Selected execution scope derived from this same queue/scope snapshot. */
  scope: ProjectScope | null
  repositories: ProjectStateDatabaseRepository[]
  diagnostics: ProjectStateDatabaseDiagnosticProjection | null
  memoryHealth: ProjectStateDatabaseMemoryHealthProjection | null
  taskOverlays: ProjectStateDatabaseTaskOverlayStores | null
  summary: ProjectSummaryProjection | null
  authority: 'database' | 'legacy'
  queueRevision: number | null
  projectRevision: number | null
}

export interface ProjectCanonicalCurrentState {
  /** The persisted queue envelope and task definitions for this revision. */
  rawQueue: {
    tasks: Array<Record<string, unknown>>
    releases: ProjectRelease[]
    selectedReleaseId?: string
    lastUpdated?: string
  }
  /** Current overlays applied to the definitions by the shared runtime rule. */
  tasks: Task[]
  scopeRows: ProjectStateDatabaseScopeRow[]
  /** Selected execution scope derived from this same queue/scope snapshot. */
  scope: ProjectScope | null
  repositories: ProjectStateDatabaseRepository[]
  diagnostics: ProjectStateDatabaseDiagnosticProjection | null
  memoryHealth: ProjectStateDatabaseMemoryHealthProjection | null
  summary: ProjectSummaryProjection | null
  authority: 'database' | 'legacy'
  queueRevision: number | null
  projectRevision: number | null
}

/**
 * Saved Release/readiness state deliberately has no task collection. It is a
 * projection read model, not a rich queue snapshot with an empty task array.
 * Keeping the shapes distinct prevents an ordinary route from accidentally
 * expanding work just because it received a Release state object.
 */
export interface ProjectSavedReleaseReadModel {
  rawQueue: {
    releases: ProjectRelease[]
    selectedReleaseId?: string
    lastUpdated?: string
  }
  scopeRows: ProjectStateDatabaseScopeRow[]
  /** Canonical selected execution scope. Routes must not rebuild this locally. */
  scope: ProjectScope | null
  repositories: ProjectStateDatabaseRepository[]
  diagnostics: ProjectStateDatabaseDiagnosticProjection | null
  summary: ProjectSummaryProjection | null
  authority: 'database' | 'legacy'
  queueRevision: number | null
  projectRevision: number | null
}

export type ProjectReleaseReadModel = ProjectCanonicalCurrentState | ProjectSavedReleaseReadModel

function persistableRelease(release: ProjectRelease): ProjectRelease {
  const description = (release as ProjectRelease & { description?: string | null }).description
  return {
    ...release,
    nodeIds: [...(release.nodeIds ?? [])],
    deferredNodeIds: [...(release.deferredNodeIds ?? [])],
    ...(typeof description === 'string' ? { description } : { description: undefined }),
  }
}

function projectScopeFromSavedState(input: {
  releases: readonly ProjectRelease[]
  selectedReleaseId?: string
  summary: ProjectSummaryProjection | null
  scopeRows: readonly ProjectStateDatabaseScopeRow[]
}): ProjectScope | null {
  const selectedRelease = input.selectedReleaseId
    ? input.releases.find(release => release.id === input.selectedReleaseId) ?? null
    : null
  const savedScope = input.summary?.scope
  const id = selectedRelease?.id ?? savedScope?.id
  if (!id) return null

  // Release node lists are read from the normalized release_membership
  // relation by the sessions queue reader. That is the membership authority.
  // The route-facing scope, however, is the executable view of that
  // membership. It comes from the same saved revision's work_scope rows so a
  // release detail read cannot expose a parent and its materialized child as
  // two runnable units. The boundary owns both views; routes never choose.
  if (selectedRelease) {
    const hasSavedScopeRows = input.summary?.freshness === 'current' && input.scopeRows.length > 0
    const executionRows = hasSavedScopeRows
      ? executionScopeRows(input.scopeRows)
      : []
    if (!hasSavedScopeRows) {
      return {
        id,
        label: selectedRelease.label,
        kind: selectedRelease.kind as ProjectScope['kind'],
        source: (selectedRelease.source ?? 'inferred') as ProjectScope['source'],
        nodeIds: [...(selectedRelease.nodeIds ?? [])],
        deferredNodeIds: [...(selectedRelease.deferredNodeIds ?? [])],
        ...(selectedRelease.proofStyle ? { proofStyle: selectedRelease.proofStyle } : {}),
      }
    }
    return {
      id,
      label: selectedRelease.label,
      kind: selectedRelease.kind as ProjectScope['kind'],
      source: (selectedRelease.source ?? 'inferred') as ProjectScope['source'],
      nodeIds: executionRows
        .filter(row => row.scope === 'included')
        .map(row => taskScopeNodeId(row.taskId)),
      deferredNodeIds: executionRows
        .filter(row => row.scope === 'deferred')
        .map(row => taskScopeNodeId(row.taskId)),
      ...(selectedRelease.proofStyle ? { proofStyle: selectedRelease.proofStyle } : {}),
    }
  }

  const executionRows = input.summary?.freshness === 'current'
    ? executionScopeRows(input.scopeRows)
    : []
  return {
    id,
    label: savedScope?.label ?? id,
    kind: (savedScope?.kind ?? 'proposed_feature_set') as ProjectScope['kind'],
    source: (savedScope?.source ?? 'inferred') as ProjectScope['source'],
    nodeIds: executionRows
      .filter(row => row.scope === 'included')
      .map(row => taskScopeNodeId(row.taskId)),
    deferredNodeIds: executionRows
      .filter(row => row.scope === 'deferred')
      .map(row => taskScopeNodeId(row.taskId)),
    ...(savedScope?.proofStyle ? { proofStyle: savedScope.proofStyle } : {}),
  }
}

async function buildProjectCanonicalCurrentState(
  projectRoot: string,
  currentState: ProjectCurrentStateReadModel,
): Promise<ProjectCanonicalCurrentState> {
  const queueDefinition = currentState.queue as ProjectStateDatabaseQueueDefinition
  const rawQueue = {
    tasks: Array.isArray(queueDefinition.tasks) ? queueDefinition.tasks.map(task => ({ ...task })) : [],
    releases: Array.isArray(queueDefinition.releases)
      ? queueDefinition.releases.map(release => persistableRelease(release as unknown as ProjectRelease))
      : [],
    ...(typeof queueDefinition.selectedReleaseId === 'string'
      ? { selectedReleaseId: queueDefinition.selectedReleaseId }
      : {}),
    ...(typeof queueDefinition.lastUpdated === 'string'
      ? { lastUpdated: queueDefinition.lastUpdated }
      : {}),
  }
  const tasks = await buildEffectiveTasks(projectRoot, rawQueue.tasks as Task[], {
    evidence: 'current',
    databaseStores: currentState.taskOverlays,
    authority: currentState.authority,
  })
  return {
    rawQueue,
    tasks: tasks as unknown as Task[],
    scopeRows: currentState.scopeRows,
    scope: currentState.scope,
    repositories: currentState.repositories,
    diagnostics: currentState.diagnostics,
    memoryHealth: currentState.memoryHealth,
    summary: currentState.summary
      ? projectSummaryAtRuntimeVersion(currentState.summary)
      : null,
    authority: currentState.authority,
    queueRevision: currentState.queueRevision,
    projectRevision: currentState.projectRevision,
  }
}

/**
 * The sole rich current-state read boundary. Release/detail callers receive
 * the durable queue and its effective task overlay as one named snapshot;
 * they do not choose a queue source, derive task identities, or reopen an
 * intake artifact while rendering that snapshot.
 */
export async function readProjectCanonicalCurrentState(
  projectRoot: string,
): Promise<ProjectCanonicalCurrentState> {
  const currentState = readProjectCurrentStateModel(getProjectSystemStatePath(projectRoot, 'TASKS.json'))
  return buildProjectCanonicalCurrentState(projectRoot, currentState)
}

/**
 * Rich queue read for an explicit mutation workflow. Compact queue consumers
 * should use readProjectTaskQueue; import/intake workflows use this boundary
 * when they must see durable notes, merge evidence, and other effective task
 * state before deciding what to write next.
 */
export async function readProjectTaskQueueForRichMutation(
  projectRoot: string,
): Promise<unknown> {
  const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
  const currentState = readProjectCurrentStateModel(tasksPath)
  if (currentState.authority === 'database') {
    const current = await buildProjectCanonicalCurrentState(projectRoot, currentState)
    return {
      version: 1,
      ...current.rawQueue,
      tasks: current.tasks.map(task => ({ ...task })) as unknown as Array<Record<string, unknown>>,
    }
  }
  return readProjectTaskQueue(tasksPath)
}

/**
 * Read the saved project state needed by release/readiness surfaces without
 * expanding effective task overlays. This is a distinct read model, not a
 * route-level shortcut: ordinary release reads consume the same queue,
 * scope, diagnostic, summary, and revision snapshot as every other saved
 * surface, while live task/evidence inspection remains explicit.
 */
export function readProjectSavedReleaseState(projectRoot: string): ProjectSavedReleaseReadModel {
  const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
  // Release is a bounded view of the canonical current-state transaction. It
  // reads the durable queue definition, saved summary, scope rows, and
  // diagnostics from one bundle, then narrows that result for the route. It
  // never starts from an intake snapshot or a projection queue envelope.
  const bundle = readProjectStateDatabaseReadBundle<ProjectSummaryProjection>(tasksPath, {
    includeQueueDefinition: true,
    includeRepositories: true,
    includeDiagnostics: true,
  })
  const current = bundle?.queueDefinition
    ? {
        queue: bundle.queueDefinition,
        scopeRows: bundle.scopeRows,
        repositories: bundle.repositories,
        diagnostics: bundle.diagnostics,
        summary: bundle.summary,
        authority: bundle.authority,
        queueRevision: bundle.queueRevision,
        projectRevision: bundle.projectRevision,
      }
    : (() => {
        if (bundle?.authority === 'database') {
          throw new Error(`Authoritative saved Release projection is unavailable for ${tasksPath}; refresh the project projection first.`)
        }
        return readProjectCurrentStateModel(tasksPath)
      })()
  const queue = current.queue as Partial<ProjectStateDatabaseQueueDefinition>
  const releases = Array.isArray(queue.releases)
    ? queue.releases.map(release => persistableRelease(release as unknown as ProjectRelease))
    : []
  const summary = current.summary ? projectSummaryAtRuntimeVersion(current.summary) : null
  const scope = projectScopeFromSavedState({
    releases,
    selectedReleaseId: typeof queue.selectedReleaseId === 'string' ? queue.selectedReleaseId : undefined,
    summary,
    scopeRows: current.scopeRows,
  })
  return {
    rawQueue: {
      releases,
      ...(typeof queue.selectedReleaseId === 'string' ? { selectedReleaseId: queue.selectedReleaseId } : {}),
      ...(typeof queue.lastUpdated === 'string' ? { lastUpdated: queue.lastUpdated } : {}),
    },
    scopeRows: current.scopeRows,
    scope,
    repositories: current.repositories,
    diagnostics: current.diagnostics,
    summary,
    authority: 'authority' in current ? current.authority : 'database',
    queueRevision: current.queueRevision,
    projectRevision: current.projectRevision,
  }
}

/**
 * Select the Release read model once, at the shared boundary. Consumers must
 * pass the returned snapshot through; they cannot silently choose an intake
 * artifact, compatibility queue, or request-time task reconstruction while
 * formatting Release state.
 */
export async function readProjectReleaseState(
  projectRoot: string,
  options: { liveDiagnostics?: boolean } = {},
): Promise<ProjectReleaseReadModel> {
  return options.liveDiagnostics === true
    ? readProjectCanonicalCurrentState(projectRoot)
    : readProjectSavedReleaseState(projectRoot)
}

/** Read the bounded saved summary without refreshing or repairing it. */
export function readProjectSummaryAtBoundary(tasksPath: string): ProjectSummaryProjection | null {
  return readProjectSummaryProjection(tasksPath)
}

export interface ProjectSummaryShellReadModel {
  summary: ProjectSummaryProjection | null
  authority: 'database' | 'legacy'
  queueRevision: number | null
  projectRevision: number | null
}

/**
 * Read only the saved project shell through the sessions boundary. Fleet and
 * status-chip callers must use this instead of opening the summary file or a
 * compact inventory reader themselves. The file reader is an explicit
 * pre-promotion compatibility path; promoted projects fail closed when their
 * saved shell is missing.
 */
export function readProjectSummaryShellAtBoundary(projectRoot: string): ProjectSummaryShellReadModel {
  const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
  const saved = readProjectStateDatabaseShellState<ProjectSummaryProjection>(tasksPath, {
    includeOrientation: false,
    includeApprovedPlan: false,
  })
  if (saved) {
    return {
      summary: saved.summary
        ? {
            ...projectSummaryAtRuntimeVersion(saved.summary),
            orientationSpine: null,
          }
        : null,
      authority: saved.authority,
      queueRevision: saved.queueRevision,
      projectRevision: saved.projectRevision,
    }
  }
  const authority = readProjectStateAuthorityAtBoundary(tasksPath)
  if (authority.authority === 'database') {
    return {
      summary: null,
      authority: 'database',
      queueRevision: authority.queueRevision,
      projectRevision: authority.projectRevision,
    }
  }
  return {
    summary: readProjectSummaryProjection(tasksPath),
    authority: 'legacy',
    queueRevision: null,
    projectRevision: null,
  }
}

/** Read the full saved summary for a project without selecting a task source. */
export function readProjectSummaryForProjectAtBoundary(projectRoot: string): ProjectSummaryProjection | null {
  const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
  const saved = readProjectStateDatabaseShellState<ProjectSummaryProjection>(tasksPath, {
    includeOrientation: true,
    includeApprovedPlan: true,
  })
  if (saved) {
    return saved.summary
      ? projectSummaryAtRuntimeVersion(saved.summary)
      : null
  }
  if (readProjectStateAuthorityAtBoundary(tasksPath).authority === 'database') return null
  return readProjectSummaryProjection(tasksPath)
}

export interface ProjectCompactStateReadModel {
  queue: ProjectStateDatabaseQueue
  inventory: ProjectStateDatabaseInventory
  /** Optional selected task captured from the same compact snapshot. */
  selectedTask: ProjectStateDatabaseTask | null
  /** Selected execution scope from this same queue/scope snapshot. */
  scope: ProjectScope | null
  repositories: ProjectStateDatabaseRepository[]
  diagnostics: ProjectStateDatabaseDiagnosticProjection | null
  summary: ProjectSummaryProjection | null
  authority: 'database'
  queueRevision: number
  projectRevision: number
}

function compactStateFromDatabaseProjection(
  current: NonNullable<ReturnType<typeof readProjectStateDatabaseProjectionState<ProjectSummaryProjection>>>,
): ProjectCompactStateReadModel {
  const summary = current.summary ? projectSummaryAtRuntimeVersion(current.summary) : null
  return {
    queue: current.queue as ProjectStateDatabaseQueue,
    inventory: current.inventory,
    scope: projectScopeFromSavedState({
      releases: Array.isArray(current.queue.releases)
        ? current.queue.releases.map(release => persistableRelease(release as unknown as ProjectRelease))
        : [],
      selectedReleaseId: typeof current.queue.selectedReleaseId === 'string' ? current.queue.selectedReleaseId : undefined,
      summary,
      scopeRows: current.scopeRows,
    }),
    repositories: current.repositories,
    selectedTask: current.selectedTask,
    diagnostics: current.diagnostics,
    summary,
    authority: 'database',
    queueRevision: current.queueRevision,
    projectRevision: current.projectRevision,
  }
}

/**
 * One explicit snapshot for the full project map. The map is a detail view,
 * so it may request the bounded task definitions needed to render node
 * maturity, but it still reads queue, inventory, summary, and revisions from
 * one SQLite transaction. It must not assemble those pieces from legacy
 * files or independent route-level readers.
 */
export interface ProjectMapStateReadModel extends ProjectCompactStateReadModel {}

export function readProjectMapStateModel(tasksPath: string): ProjectMapStateReadModel | null {
  const current = readProjectStateDatabaseProjectionState<ProjectSummaryProjection>(tasksPath, {
    includeDefinitions: true,
  })
  if (!current) return null
  return compactStateFromDatabaseProjection(current)
}

/**
 * Compact project surfaces share one bounded SQLite snapshot. This is a
 * deliberate boundary: callers do not assemble a summary, release envelope,
 * and inventory page from separate reads that can observe different state.
 */
export function readProjectCompactStateModel(
  tasksPath: string,
  options: ProjectStateDatabaseProjectionReadOptions = {},
): ProjectCompactStateReadModel | null {
  const current = readProjectStateDatabaseProjectionState<ProjectSummaryProjection>(tasksPath, options)
  if (!current) return null
  return compactStateFromDatabaseProjection(current)
}

export interface ProjectCompactStateBoundaryReadModel {
  authority: 'database' | 'legacy'
  state: ProjectCompactStateReadModel | null
  queueRevision: number | null
  projectRevision: number | null
}

/**
 * Read compact project detail and authority from one sessions transaction.
 * Callers that need to distinguish a missing promoted projection from an
 * unpromoted project must use this result instead of probing authority and
 * then opening a second compact read.
 */
export function readProjectCompactStateAtBoundary(
  tasksPath: string,
  options: ProjectStateDatabaseProjectionReadOptions = {},
): ProjectCompactStateBoundaryReadModel {
  const bundle = readProjectStateDatabaseReadBundle<ProjectSummaryProjection>(tasksPath, {
    ...options,
    includeProjection: true,
    includeRepositories: true,
    includeDiagnostics: true,
  })
  if (bundle?.projection) {
    return {
      authority: bundle.authority,
      state: compactStateFromDatabaseProjection(bundle.projection),
      queueRevision: bundle.queueRevision,
      projectRevision: bundle.projectRevision,
    }
  }
  const authority = readProjectStateAuthorityAtBoundary(tasksPath)
  return {
    authority: authority.authority,
    state: null,
    queueRevision: authority.queueRevision,
    projectRevision: authority.projectRevision,
  }
}

/**
 * Shared ordinary project surface boundary. This is the only route-facing
 * adapter that joins compact work, Thread, Inbox, and availability. Each
 * optional field is still bounded, but all included fields are revision-joined
 * by the sessions transaction instead of being reopened independently.
 */
export interface ProjectSurfaceStateReadModel {
  authority: 'database' | 'legacy'
  compact: ProjectCompactStateReadModel | null
  summary: ProjectSummaryProjection | null
  thread: ProjectStateDatabaseSurfaceState['thread']
  attentionRecords: ProjectStateDatabaseSurfaceState['attentionRecords']
  attentionWatermark: ProjectStateDatabaseSurfaceState['attentionWatermark']
  memoryHealth: ProjectStateDatabaseSurfaceState['memoryHealth']
  availability: ProjectStateDatabaseSurfaceState['availability']
  queueRevision: number | null
  projectRevision: number | null
}

/**
 * Overview is a saved-orientation surface. It deliberately reads neither the
 * task inventory nor diagnostics: visible task cards are hydrated later by
 * their saved spine IDs and checked against these same revisions.
 */
export interface ProjectOverviewStateReadModel {
  authority: 'database' | 'legacy'
  summary: ProjectSummaryProjection | null
  /** Current normalized membership for the saved selected release only. */
  scope: ProjectScope | null
  availability: ProjectStateDatabaseSurfaceState['availability']
  queueRevision: number | null
  projectRevision: number | null
}

export function readProjectOverviewStateAtBoundary(
  projectRoot: string,
): ProjectOverviewStateReadModel | null {
  const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
  const current = readProjectStateDatabaseReadBundle<ProjectSummaryProjection>(
    tasksPath,
    {
      includeAvailability: true,
      includeScopeRows: true,
    },
  )
  if (!current) return null
  const summary = current.summary ? projectSummaryAtRuntimeVersion(current.summary) : null
  const releases = Array.isArray(summary?.orientationSpine?.releases)
    ? summary.orientationSpine.releases.map(release => persistableRelease(release as unknown as ProjectRelease))
    : []
  const selectedReleaseId = summary?.orientationSpine?.selectedRelease?.id
  return {
    authority: current.authority,
    summary,
    scope: projectScopeFromSavedState({
      releases,
      ...(selectedReleaseId ? { selectedReleaseId } : {}),
      summary,
      scopeRows: current.scopeRows,
    }),
    availability: current.availability,
    queueRevision: current.queueRevision,
    projectRevision: current.projectRevision,
  }
}

export function readProjectSurfaceStateAtBoundary(
  projectRoot: string,
  options: ProjectStateDatabaseSurfaceReadOptions = {},
): ProjectSurfaceStateReadModel | null {
  const current = readProjectStateDatabaseSurfaceState<ProjectSummaryProjection>(
    getProjectSystemStatePath(projectRoot, 'TASKS.json'),
    options,
  )
  if (!current) return null
  return {
    authority: current.authority,
    compact: current.projection ? compactStateFromDatabaseProjection(current.projection) : null,
    summary: current.summary ? projectSummaryAtRuntimeVersion(current.summary) : null,
    thread: current.thread,
    attentionRecords: current.attentionRecords,
    attentionWatermark: current.attentionWatermark,
    memoryHealth: current.memoryHealth,
    availability: current.availability,
    queueRevision: current.queueRevision,
    projectRevision: current.projectRevision,
  }
}

/**
 * Project graph reads need indexed task identities and compact review packets,
 * not full task definitions. Keeping this named boundary separate prevents a
 * graph route from quietly widening back into the map/detail reader.
 */
export interface ProjectGraphStateReadModel extends ProjectCompactStateReadModel {}

export function readProjectGraphStateModel(tasksPath: string): ProjectGraphStateReadModel | null {
  return readProjectCompactStateModel(tasksPath, { includeDefinitions: false })
}

export interface ProjectTaskDetailReadModel {
  queue: ProjectStateDatabaseQueue
  task: ProjectStateDatabaseTask
  /** Mutable task state captured by the same SQLite detail snapshot. */
  overlay: ProjectStateDatabaseTaskOverlay | null
  relationships: ProjectStateDatabaseTaskRelationships
  /** Related task points captured by the same SQLite detail snapshot. */
  relatedTasks: ProjectStateDatabaseTask[]
  scopeRows: ProjectStateDatabaseScopeRow[]
  availability: ProjectStateDatabaseAvailability | null
  /** Selected execution scope from this same task-detail snapshot. */
  scope: ProjectScope | null
  summary: ProjectSummaryProjection | null
  authority: 'database'
  queueRevision: number
  projectRevision: number
}

/**
 * Task detail shares the same current-state boundary as compact surfaces.
 * A drawer must not combine a task point, queue envelope, scope membership,
 * and summary from independent reads that can observe different revisions.
 */
export function readProjectTaskDetailState(
  tasksPath: string,
  taskId: string,
): ProjectTaskDetailReadModel | null {
  return readProjectTaskDetailStateAtBoundary(tasksPath, taskId)?.state ?? null
}

export interface ProjectTaskDetailBoundaryReadModel {
  authority: 'database' | 'legacy'
  state: ProjectTaskDetailReadModel | null
}

export interface ProjectTaskCurrentBoundaryReadModel {
  authority: 'database' | 'legacy'
  state: ProjectTaskDetailReadModel | null
  /** The current task after the same snapshot's normalized overlays are applied. */
  task: Record<string, unknown> | null
}

/**
 * Read task detail and choose the source in one sessions snapshot. A route
 * should use this when it needs to distinguish “task not found” from “legacy
 * project” without reopening the authority marker.
 */
export function readProjectTaskDetailStateAtBoundary(
  tasksPath: string,
  taskId: string,
  options: ProjectStateDatabaseTaskDetailReadOptions = {},
): ProjectTaskDetailBoundaryReadModel | null {
  const current = readProjectStateDatabaseTaskDetailStateAtBoundary<ProjectSummaryProjection>(tasksPath, taskId, options)
  if (!current) return { authority: 'legacy', state: null }
  if (current.authority !== 'database' || !current.state) {
    return { authority: current.authority, state: null }
  }
  const state = current.state
  const summary = state.summary
    ? { ...state.summary.payload, freshness: state.summary.freshness }
    : null
  return {
    authority: 'database',
    state: {
      queue: state.queue as ProjectStateDatabaseQueue,
      task: state.task,
      overlay: state.overlay,
      relationships: state.relationships,
      relatedTasks: state.relatedTasks,
      scopeRows: state.scopeRows,
      availability: state.availability,
      scope: projectScopeFromSavedState({
        releases: Array.isArray(state.queue.releases)
          ? state.queue.releases.map(release => persistableRelease(release as unknown as ProjectRelease))
          : [],
        selectedReleaseId: typeof state.queue.selectedReleaseId === 'string' ? state.queue.selectedReleaseId : undefined,
        summary,
        scopeRows: state.scopeRows,
      }),
      summary,
      authority: 'database',
      queueRevision: state.queueRevision,
      projectRevision: state.projectRevision,
    },
  }
}

/**
 * Read one current task through the same boundary used by task detail. The
 * route gets the point and its effective overlay as one value; it must not
 * reopen runtime/workspace/evidence stores and rebuild a competing task.
 * Legacy projects retain their explicit compatibility path, but promoted
 * projects have exactly one current-task assembly point.
 */
export async function readProjectTaskCurrentStateAtBoundary(
  projectRoot: string,
  taskId: string,
  options: ProjectStateDatabaseTaskDetailReadOptions = {},
): Promise<ProjectTaskCurrentBoundaryReadModel> {
  const detail = readProjectTaskDetailStateAtBoundary(
    getProjectSystemStatePath(projectRoot, 'TASKS.json'),
    taskId,
    options,
  )
  if (detail?.authority !== 'database' || !detail.state) {
    return {
      authority: detail?.authority ?? 'legacy',
      state: null,
      task: null,
    }
  }
  const point = projectTaskRecordFromDatabasePoint(detail.state.task)
  const task = await buildEffectiveTask(projectRoot, point as Task, {
    evidence: 'current',
    overlay: detail.state.overlay,
    authority: 'database',
  })
  return {
    authority: 'database',
    state: detail.state,
    task: task as Record<string, unknown>,
  }
}

/**
 * Convert one normalized database point into the task-shaped record expected
 * by explicit detail helpers. This is intentionally a point read: promoted
 * projects must not load the aggregate queue just to render one task tab.
 */
export function projectTaskRecordFromDatabasePoint(task: ProjectStateDatabaseTask): Record<string, unknown> {
  const indexed = task as unknown as Record<string, unknown>
  return {
    ...task.definition,
    id: task.id,
    title: task.title,
    ...(task.description !== null ? { description: task.description } : {}),
    ...(task.status !== null ? { status: task.status } : {}),
    ...(task.domain !== null ? { domain: task.domain } : {}),
    ...(task.priority !== null ? { priority: task.priority } : {}),
    ...(task.workKind !== null ? { workKind: task.workKind } : {}),
    ...(task.semanticKind !== null && task.semanticKind !== undefined ? { semanticKind: task.semanticKind } : {}),
    ...(task.hierarchy ? { hierarchy: task.hierarchy } : {}),
    ...(task.dependsOn.length > 0 ? { dependsOn: [...task.dependsOn] } : {}),
    ...(task.releaseIds.length > 0 ? { releaseIds: [...task.releaseIds] } : {}),
    ...(task.sourceRefs.length > 0 ? { sourceRefs: [...task.sourceRefs] } : {}),
    ...(isRecord(indexed.delivery) ? { delivery: indexed.delivery } : {}),
    ...(isRecord(indexed.currentSummary) ? { currentSummary: indexed.currentSummary } : {}),
    ...(isRecord(indexed.taskReadiness) ? { taskReadiness: indexed.taskReadiness } : {}),
    ...(task.updatedAt !== null ? { updatedAt: task.updatedAt } : {}),
    ...(task.completedAt !== null ? { completedAt: task.completedAt } : {}),
  }
}

/** Read one task definition without opening the aggregate current queue. */
export function readProjectTaskRecordAtBoundary(tasksPath: string, taskId: string): Record<string, unknown> | null {
  const point = readProjectStateDatabaseTaskPointWithRevision(tasksPath, taskId)
  if (point?.projectAuthority === 'database') return projectTaskRecordFromDatabasePoint(point.task)
  if (!point) return null
  // A database can be populated before promotion. It is migration/bootstrap
  // material, not a second current-state authority, so runtime reads stay on
  // the compatibility queue until the explicit promotion boundary flips.
  const queue = readProjectTaskQueueSync(tasksPath) as { tasks?: unknown[] }
  return (Array.isArray(queue.tasks) ? queue.tasks : [])
    .find((task): task is Record<string, unknown> => (
      typeof task === 'object' && task !== null && !Array.isArray(task) &&
      (task as { id?: unknown }).id === taskId
    )) ?? null
}

/**
 * Read current evidence through the project boundary. Progress and other
 * saved surfaces consume this compact evidence projection; they do not open
 * the task-event store or choose a second evidence source themselves.
 */
export function readProjectCurrentTaskEvidenceAtBoundary(
  projectRoot: string,
  taskIds: readonly string[],
): ReturnType<typeof readProjectStateDatabaseTaskEvidenceCurrentMany> {
  return readProjectStateDatabaseTaskEvidenceCurrentMany(projectRoot, [...new Set(taskIds)].slice(0, 100))
}

export function readProjectCurrentTaskEvidenceWithRevisionAtBoundary(
  projectRoot: string,
  taskIds: readonly string[],
): ProjectStateDatabaseTaskEvidenceCurrentManyRead | null {
  return readProjectStateDatabaseTaskEvidenceCurrentManyWithRevision(projectRoot, [...new Set(taskIds)].slice(0, 100))
}

/**
 * Progress is a compact view over the same summary/evidence snapshot. The
 * sessions reader derives its bounded evidence IDs from that summary inside
 * one transaction, so Progress no longer reads a shell and then reopens the
 * database for evidence.
 */
export function readProjectProgressStateAtBoundary(projectRoot: string): {
  summary: ProjectSummaryProjection | null
  currentEvidence: Map<string, import('@guildhall/sessions').ProjectStateDatabaseTaskEvidenceCurrent>
  authority: 'database' | 'legacy'
  queueRevision: number | null
  projectRevision: number | null
} | null {
  const bundle = readProjectStateDatabaseReadBundle<ProjectSummaryProjection>(
    getProjectSystemStatePath(projectRoot, 'TASKS.json'),
    {
      includeOrientation: false,
      includeApprovedPlan: false,
      includeCurrentEvidence: true,
    },
  )
  if (!bundle) return null
  return {
    summary: bundle.summary
      ? { ...bundle.summary.payload, freshness: bundle.summary.freshness }
      : null,
    currentEvidence: bundle.currentEvidence ?? new Map(),
    authority: bundle.authority,
    queueRevision: bundle.queueRevision,
    projectRevision: bundle.projectRevision,
  }
}

/** Read bounded evidence history through the named task-detail boundary. */
export function readProjectTaskEvidencePageAtBoundary(
  projectRoot: string,
  taskId: string,
  options?: Parameters<typeof readSessionTaskEvidencePage>[2],
): ReturnType<typeof readSessionTaskEvidencePage> {
  return readSessionTaskEvidencePage(projectRoot, taskId, options)
}

/** Read one saved repository projection without inspecting the checkout. */
export function readProjectRepositoryProjectionAtBoundary(
  projectRoot: string,
  projectionId: string,
): ReturnType<typeof readProjectStateDatabaseRepository> {
  return readProjectStateDatabaseRepository(projectRoot, projectionId)
}

export function readProjectProjectionMetadataAtBoundary(projectRoot: string) {
  return readProjectStateDatabaseMetadata(projectRoot)
}

export interface ProjectMemoryHealthSourceReadModel {
  authority: 'database' | 'legacy'
  queueRevision: number | null
  projectRevision: number | null
  taskIds: string[]
}

/**
 * Read only the bounded source facts needed by the asynchronous memory
 * projector. This keeps its revision and task-id selection on the same
 * sessions snapshot as every other promoted project read.
 */
export function readProjectMemoryHealthSourceAtBoundary(
  tasksPath: string,
): ProjectMemoryHealthSourceReadModel | null {
  const bundle = readProjectStateDatabaseReadBundle(tasksPath, {
    includeProjection: true,
    limit: 12,
  })
  if (!bundle?.projection) return null
  return {
    authority: bundle.authority,
    queueRevision: bundle.queueRevision,
    projectRevision: bundle.projectRevision,
    taskIds: bundle.projection.inventory.tasks
      .map(task => task.id)
      .filter((taskId): taskId is string => typeof taskId === 'string' && taskId.trim().length > 0),
  }
}

export function readProjectTaskQueueAtBoundaryWithRevision(tasksPath: string): {
  definition: unknown
  revision: number | null
  projectRevision: number | null
} {
  const current = readProjectTaskQueueForMutationSync(tasksPath)
  return {
    definition: current.queue,
    revision: current.expectedQueueRevision,
    projectRevision: current.expectedProjectRevision,
  }
}

/** Read an explicit task set without scanning the aggregate queue. */
export function readProjectTaskRecordsAtBoundary(
  tasksPath: string,
  taskIds: readonly string[],
): Array<Record<string, unknown>> {
  return readProjectTaskRecordsAtBoundaryWithRevision(tasksPath, taskIds, { includeDefinitions: true }).records
}

export interface ProjectTaskRecordsAtBoundaryRead {
  records: Array<Record<string, unknown>>
  /** Database points are retained for callers that need typed indexed rows. */
  taskPoints?: ProjectStateDatabaseTask[]
  queueRevision: number | null
  projectRevision: number | null
}

export interface ProjectTaskCurrentRecordsAtBoundaryRead extends ProjectTaskRecordsAtBoundaryRead {
  authority: 'database' | 'legacy'
  /** The same bounded task records after normalized current overlays apply. */
  effectiveRecords: Array<Record<string, unknown>>
}

export class ProjectStateRevisionMismatchError extends Error {
  readonly code = 'project_state_revision_mismatch'

  constructor(
    readonly expected: { queue: number; project: number },
    readonly actual: { queue: number | null; project: number | null },
  ) {
    super('Project state changed while loading this surface. Retry the read against one current snapshot.')
    this.name = 'ProjectStateRevisionMismatchError'
  }
}

/**
 * Read explicit task points and retain the revisions that contained them.
 * A caller that already read a compact snapshot can compare these revisions
 * before combining the points with that snapshot. This keeps a route from
 * accidentally producing a response assembled across two project states.
 */
export function readProjectTaskRecordsAtBoundaryWithRevision(
  tasksPath: string,
  taskIds: readonly string[],
  options: { includeDefinitions?: boolean } = {},
): ProjectTaskRecordsAtBoundaryRead {
  const ids = [...new Set(taskIds.filter(id => id.trim().length > 0))].slice(0, 100)
  if (ids.length === 0) {
    const authority = readProjectStateAuthorityAtBoundary(tasksPath)
    return {
      records: [],
      queueRevision: authority.queueRevision,
      projectRevision: authority.projectRevision,
    }
  }
  const points = readProjectStateDatabaseTaskPointsWithRevision(tasksPath, ids, {
    includeDefinitions: options.includeDefinitions === true,
  })
  if (points?.projectAuthority === 'database') {
    return {
      records: points.tasks.map(projectTaskRecordFromDatabasePoint),
      taskPoints: points.tasks,
      queueRevision: points.queueRevision,
      projectRevision: points.projectRevision,
    }
  }
  if (!points && readProjectStateAuthorityAtBoundary(tasksPath).authority === 'database') {
    throw new Error(`Authoritative current task state is unavailable for ${tasksPath}`)
  }
  // A database file may exist before promotion. Preserve the explicit
  // compatibility branch, but do not let its authority decision leak into a
  // promoted point read: the point reader already captured that decision.
  const queue = readProjectTaskQueueSync(tasksPath) as { tasks?: unknown[] }
  const wanted = new Set(ids)
  return {
    records: (Array.isArray(queue.tasks) ? queue.tasks : [])
      .filter((task): task is Record<string, unknown> => (
        typeof task === 'object' && task !== null && !Array.isArray(task) &&
        typeof (task as { id?: unknown }).id === 'string' &&
        wanted.has((task as { id: string }).id)
      ))
      .map(task => ({ ...task })),
    queueRevision: null,
    projectRevision: null,
  }
}

/**
 * Read and normalize an explicit task set through one current-state
 * boundary. Promoted projects get task points, overlays, and revisions from
 * one SQLite transaction. Legacy projects use the explicit compatibility
 * adapter and never masquerade as promoted state.
 */
export async function readProjectTaskCurrentRecordsAtBoundary(
  projectRoot: string,
  taskIds: readonly string[],
  options: { includeDefinitions?: boolean } = {},
): Promise<ProjectTaskCurrentRecordsAtBoundaryRead> {
  const ids = [...new Set(taskIds.filter(id => id.trim().length > 0))].slice(0, 100)
  const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
  const current = readProjectStateDatabaseCurrentTasksWithRevision(tasksPath, ids, {
    includeDefinitions: options.includeDefinitions === true,
  })
  if (current) {
    const records = current.tasks.map(projectTaskRecordFromDatabasePoint)
    const runtime = [] as ProjectStateDatabaseTaskOverlayStores['runtime']
    const workspace = [] as ProjectStateDatabaseTaskOverlayStores['workspace']
    const evidenceCurrent = new Map<string, NonNullable<ProjectStateDatabaseTaskOverlay['evidenceCurrent']>>()
    for (const task of current.tasks) {
      const overlay = current.overlays.get(task.id)
      if (!overlay) throw new Error(`Normalized current task state is unavailable for promoted task ${task.id}`)
      if (overlay.runtime) runtime.push(overlay.runtime)
      if (overlay.workspace) workspace.push(overlay.workspace)
      if (overlay.evidenceCurrent) evidenceCurrent.set(task.id, overlay.evidenceCurrent)
    }
    const effective = await buildEffectiveTasks(projectRoot, records as Task[], {
      evidence: 'current',
      databaseStores: { runtime, workspace, evidenceCurrent },
      authority: 'database',
    })
    return {
      records,
      taskPoints: current.tasks,
      effectiveRecords: effective as Array<Record<string, unknown>>,
      authority: 'database',
      queueRevision: current.queueRevision,
      projectRevision: current.projectRevision,
    }
  }
  if (readProjectStateAuthorityAtBoundary(tasksPath).authority === 'database') {
    throw new Error(`Authoritative current task state is unavailable for ${tasksPath}`)
  }
  const legacy = readProjectTaskRecordsAtBoundaryWithRevision(tasksPath, ids, {
    includeDefinitions: options.includeDefinitions === true,
  })
  const effective = await buildEffectiveTasks(projectRoot, legacy.records as Task[], {
    evidence: 'current',
    databaseStores: null,
    authority: 'legacy',
  })
  return {
    ...legacy,
    effectiveRecords: effective as Array<Record<string, unknown>>,
    authority: 'legacy',
  }
}

export function readProjectCurrentStateModel(tasksPath: string): ProjectCurrentStateReadModel {
  const current = readProjectStateDatabaseCurrentState<ProjectSummaryProjection>(tasksPath)
  if (!current) {
    const authority = readProjectStateAuthorityAtBoundary(tasksPath)
    if (authority.authority !== 'database') {
      return {
        queue: { version: 1, tasks: [], releases: [] },
        scopeRows: [],
        scope: null,
        repositories: [],
        diagnostics: null,
        memoryHealth: null,
        taskOverlays: null,
        summary: readProjectSummaryProjection(tasksPath),
        authority: 'legacy',
        queueRevision: null,
        projectRevision: null,
      }
    }
    throw new Error(`Authoritative project detail store is unavailable for ${tasksPath}; run the project-state migration first.`)
  }
  const summary = current.summary
    ? { ...current.summary.payload, freshness: current.summary.freshness }
    : null
  const queue = current.queue as ProjectStateDatabaseQueueDefinition
  const releases = Array.isArray(queue.releases)
    ? queue.releases.map(release => persistableRelease(release as unknown as ProjectRelease))
    : []
  return {
    queue: current.queue,
    scopeRows: current.scopeRows,
    scope: projectScopeFromSavedState({
      releases,
      selectedReleaseId: typeof queue.selectedReleaseId === 'string' ? queue.selectedReleaseId : undefined,
      summary,
      scopeRows: current.scopeRows,
    }),
    repositories: current.repositories,
    diagnostics: current.diagnostics,
    memoryHealth: current.memoryHealth,
    taskOverlays: current.taskOverlays,
    summary,
    authority: 'database',
    queueRevision: current.queueRevision,
    projectRevision: current.projectRevision,
  }
}

export interface ForbiddenProjectTaskFieldFinding {
  taskId: string
  field: ForbiddenProjectTaskField
  bytes: number
}

export interface SanitizedTaskResult {
  task: unknown
  removedFields: ForbiddenProjectTaskField[]
  removedEvidence: Partial<Record<ForbiddenProjectTaskField, unknown>>
  removedEvidenceBytes: number
}

export interface SanitizedTaskQueueResult {
  queue: unknown
  taskDefinitionsRewritten: number
  removedEvidenceBytes: number
  removedByTask: Array<{ taskId: string; removedFields: ForbiddenProjectTaskField[]; removedEvidence: Record<string, unknown> }>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>
}

function serializedBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8')
}

function taskId(task: unknown): string {
  return isRecord(task) && typeof task.id === 'string' && task.id.length > 0 ? task.id : 'unknown'
}

function queueTasks(queue: unknown): unknown[] {
  if (Array.isArray(queue)) return queue
  if (isRecord(queue) && Array.isArray(queue.tasks)) return queue.tasks
  return []
}

function queueReleases(queue: unknown): unknown[] {
  if (isRecord(queue) && Array.isArray(queue.releases)) return queue.releases
  return []
}

function queueSelectedReleaseId(queue: unknown): unknown {
  return isRecord(queue) ? queue.selectedReleaseId : undefined
}

function queueEnvelopeList(queue: unknown, key: 'executionPlanActions' | 'scopeAuthorityRequests'): unknown[] {
  return isRecord(queue) && Array.isArray(queue[key]) ? queue[key] : []
}

/**
 * Current-state writes receive already-shaped task definitions in normal
 * runtime use. Keep the targeted detector tolerant of the small skeletal
 * queues used by bootstrap/import callers without making those callers a
 * second runtime schema: projection-only defaults are never persisted.
 */
function queueForProjection(queue: unknown): unknown {
  if (!isRecord(queue) || !Array.isArray(queue.tasks)) return queue
  const queueUpdatedAt = typeof queue.lastUpdated === 'string' ? queue.lastUpdated : '1970-01-01T00:00:00.000Z'
  return {
    ...queue,
    tasks: queue.tasks.map(task => {
      if (!isRecord(task)) return task
      const createdAt = typeof task.createdAt === 'string' ? task.createdAt : queueUpdatedAt
      return {
        ...task,
        createdAt,
        updatedAt: typeof task.updatedAt === 'string' ? task.updatedAt : createdAt,
      }
    }),
  }
}

function taskRecordById(queue: unknown): Map<string, Record<string, unknown>> {
  return new Map(queueTasks(queue)
    .filter(isRecord)
    .flatMap(task => typeof task.id === 'string' && task.id.length > 0 ? [[task.id, task] as const] : []))
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function sameCanonicalQueue(left: unknown, right: unknown): boolean {
  const leftTasks = taskRecordById(left)
  const rightTasks = taskRecordById(right)
  if (leftTasks.size !== rightTasks.size) return false
  for (const [id, task] of leftTasks) {
    if (!sameJson(task, rightTasks.get(id))) return false
  }
  return sameJson(queueReleases(left), queueReleases(right)) &&
    sameJson(queueSelectedReleaseId(left), queueSelectedReleaseId(right)) &&
    sameJson(queueEnvelopeList(left, 'executionPlanActions'), queueEnvelopeList(right, 'executionPlanActions')) &&
    sameJson(queueEnvelopeList(left, 'scopeAuthorityRequests'), queueEnvelopeList(right, 'scopeAuthorityRequests'))
}

function hasMeaningfulForbiddenField(value: unknown): boolean {
  if (value === undefined || value === null) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  if (isRecord(value)) return Object.keys(value).length > 0
  return true
}

/**
 * A promoted aggregate caller must not smuggle evidence/runtime changes
 * through the definition writer. It also must not omit a legacy-owned field
 * while replacing the queue, because sanitizing that omission would silently
 * erase the only remaining copy. Callers must use the point/evidence/runtime
 * boundaries instead.
 */
function assertNoPromotedForbiddenTaskChanges(
  tasksPath: string,
  queue: unknown,
): void {
  // The rich queue reader deliberately merges compact runtime summaries into
  // each task card. Compare against the indexed definition rows instead; a
  // runtime-only revisionCount or assignment is not a definition omission.
  const currentDefinitions = readProjectStateDatabaseInventory(tasksPath, { includeDefinitions: true })?.tasks ?? []
  const currentTasks = new Map(currentDefinitions.map(task => [task.id, task.definition]))
  for (const nextTask of queueTasks(queue)) {
    if (!isRecord(nextTask) || typeof nextTask.id !== 'string') continue
    const currentTask = currentTasks.get(nextTask.id)
    if (!currentTask) continue
    for (const field of FORBIDDEN_PROJECT_TASK_FIELDS) {
      const currentHas = hasMeaningfulForbiddenField(currentTask[field])
      const nextHas = hasMeaningfulForbiddenField(nextTask[field])
      if (currentHas !== nextHas || (currentHas && !sameJson(currentTask[field], nextTask[field]))) {
        throw new Error(
          `Promoted aggregate queue replacement cannot change evidence/runtime-owned field ${field} on ${nextTask.id}; use a normalized point mutation or evidence/runtime writer.`,
        )
      }
    }
  }
}

function scopeRowByTaskId(rows: readonly ProjectStateDatabaseScopeRow[] | undefined): Map<string, ProjectStateDatabaseScopeRow> {
  return new Map((rows ?? []).map(row => [row.taskId, row]))
}

/**
 * Use the normalized task transaction only when the caller changed one task,
 * kept release selection/definitions intact, and did not cause another scope
 * row to change. Anything structural falls through to the explicit aggregate
 * import/migration/recovery writer.
 */
function writeTargetedTaskMutationIfSafe(
  tasksPath: string,
  queue: unknown,
  options: {
    projectId?: string | null
    projectRoot?: string
    expectedQueueRevision?: number | null
    taskEvidence?: readonly {
      event: TaskEvidenceEventRecord
      retention: ProjectStateDatabaseTaskEvidenceRetentionInput
    }[]
  },
): boolean {
  if (readProjectStateAuthorityAtBoundary(tasksPath).authority !== 'database') return false

  const current = readProjectTaskQueueSyncWithRevision(tasksPath)
  const expectedQueueRevision = options.expectedQueueRevision ?? current.revision
  if (typeof expectedQueueRevision !== 'number' || !Number.isInteger(expectedQueueRevision) || expectedQueueRevision < 0) return false
  const expectedProjectRevision = current.projectRevision
  if (typeof expectedProjectRevision !== 'number' || !Number.isInteger(expectedProjectRevision) || expectedProjectRevision < 0) return false
  const currentQueue = readProjectStateDatabaseQueueDefinition(tasksPath) ?? current.queue
  const currentTasks = taskRecordById(currentQueue)
  const nextTasks = taskRecordById(queue)
  if (currentTasks.size === 0 || currentTasks.size !== nextTasks.size) return false
  if ([...currentTasks.keys()].some(id => !nextTasks.has(id))) return false
  if (!sameJson(queueReleases(currentQueue), queueReleases(queue))) return false
  if (!sameJson(queueSelectedReleaseId(currentQueue), queueSelectedReleaseId(queue))) return false
  if (!sameJson(queueEnvelopeList(currentQueue, 'executionPlanActions'), queueEnvelopeList(queue, 'executionPlanActions'))) return false
  if (!sameJson(queueEnvelopeList(currentQueue, 'scopeAuthorityRequests'), queueEnvelopeList(queue, 'scopeAuthorityRequests'))) return false

  const changedTaskIds = [...currentTasks.keys()].filter(id => !sameJson(currentTasks.get(id), nextTasks.get(id)))
  if (changedTaskIds.length !== 1) return false
  const changedTaskId = changedTaskIds[0]
  if (!changedTaskId) return false

  const inventory = readProjectStateDatabaseInventory(tasksPath, { includeDefinitions: false })
  if (!inventory) return false
  const currentScope = new Map(inventory.tasks.map(task => [task.id, task.scopeRow]))
  const projectionQueue = queueForProjection(queue)
  const prepared = prepareProjectSummaryProjectionFromUnknownQueue(tasksPath, {
    projectId: options.projectId,
    projectRoot: options.projectRoot,
    queue: projectionQueue,
    projectionTasks: isRecord(projectionQueue) && Array.isArray(projectionQueue.tasks)
      ? projectionQueue.tasks as Task[]
      : undefined,
  })
  if (!prepared.parsedQueue || !prepared.scopeRows) return false
  const nextScope = scopeRowByTaskId(prepared.scopeRows)
  const scopeIds = new Set([...currentScope.keys(), ...nextScope.keys()])
  const changedScopeIds = [...scopeIds].filter(id => !sameJson(currentScope.get(id) ?? null, nextScope.get(id) ?? null))
  if (changedScopeIds.some(id => id !== changedTaskId)) return false

  const nextTask = nextTasks.get(changedTaskId)
  if (!nextTask) return false
  const scopeRow = nextScope.get(changedTaskId) ?? null
  const lastUpdated = isRecord(queue) && typeof queue.lastUpdated === 'string' ? queue.lastUpdated : null
  writeProjectStateDatabaseTaskMutation(tasksPath, {
    task: nextTask,
    summary: prepared.projection as unknown as Record<string, unknown>,
    expectedQueueRevision,
    expectedProjectRevision,
    lastUpdated,
    scopeRow,
    evidence: options.taskEvidence,
  })
  return true
}

export interface PromotedTaskDetailMutationOptions {
  projectId?: string | null
  projectRoot?: string
  /** Override the derived scope row only for a deliberately external scope change. */
  scopeRow?: ProjectStateDatabaseScopeRow | null
  mutate: (task: Record<string, unknown>) => Record<string, unknown> | null
}

/**
 * Apply one ordinary task-detail edit without reconstructing the queue. The
 * target definition and its CAS token come from one database read; the
 * compact task index and summary are projected from indexed rows with only
 * that task overridden; the database mutation commits all three atomically.
 */
function writePromotedTaskDetailMutationOnce(
  tasksPath: string,
  taskId: string,
  options: PromotedTaskDetailMutationOptions,
): { committedRevision: number; task: Record<string, unknown> } | null {
  if (readProjectStateAuthorityAtBoundary(tasksPath).authority !== 'database') return null
  const point = readProjectStateDatabaseTaskPointWithRevision(tasksPath, taskId)
  if (!point) return null
  // Detail rows from older promoted projects can still contain overlay fields.
  // Remove them before handing the task to a definition mutator so an ordinary
  // edit cannot copy stale runtime state back into the canonical definition.
  // A promoted task is allowed to have an intentionally sparse detail payload:
  // the indexed row still owns its identity and plan fields. Build the
  // mutator's input from the whole point so a sparse detail row remains
  // editable instead of being treated as a missing task.
  const indexedDefinitionFields = {
    id: point.task.id,
    title: point.task.title,
    ...(point.task.description !== null ? { description: point.task.description } : {}),
    ...(point.task.status !== null ? { status: point.task.status } : {}),
    ...(point.task.domain !== null ? { domain: point.task.domain } : {}),
    ...(point.task.priority !== null ? { priority: point.task.priority } : {}),
    ...(point.task.workKind !== null ? { workKind: point.task.workKind } : {}),
    ...(point.task.hierarchy ? { hierarchy: point.task.hierarchy } : {}),
    ...(point.task.dependsOn.length > 0 ? { dependsOn: [...point.task.dependsOn] } : {}),
    ...(point.task.releaseIds.length > 0 ? { releaseIds: [...point.task.releaseIds] } : {}),
    ...(point.task.sourceRefs.length > 0 ? { sourceRefs: [...point.task.sourceRefs] } : {}),
    ...(point.task.updatedAt !== null ? { updatedAt: point.task.updatedAt } : {}),
    ...(point.task.completedAt !== null ? { completedAt: point.task.completedAt } : {}),
  }
  const currentDefinition = sanitizeTaskForProjectWrite(
    { ...indexedDefinitionFields, ...point.task.definition },
  ).task as Record<string, unknown>
  // Completion summaries are historical state, not live assignment/runtime
  // state. Preserve an existing summary through an ordinary point edit so a
  // reopen clears current `completedAt` without erasing the reason/history
  // that explains the reopen.
  if (isRecord(point.task.definition) && 'doneSummaryBundle' in point.task.definition) {
    currentDefinition.doneSummaryBundle = point.task.definition.doneSummaryBundle
  }
  const mutatedTask = options.mutate({ ...currentDefinition })
  if (!mutatedTask) return null
  // A point mutation must never add or change runtime/evidence ownership in
  // the task definition. Runtime/evidence writers own those fields.
  const changedForbiddenField = FORBIDDEN_PROJECT_TASK_FIELDS.some(field =>
    field in mutatedTask && !sameJson(mutatedTask[field], currentDefinition[field]),
  )
  if (changedForbiddenField) return null
  const nextTask = sanitizeTaskForProjectWrite(mutatedTask).task as Record<string, unknown>
  if ('doneSummaryBundle' in currentDefinition && !('doneSummaryBundle' in nextTask)) {
    nextTask.doneSummaryBundle = currentDefinition.doneSummaryBundle
  }
  nextTask.id = taskId
  const compact = projectStateDatabaseTaskSummary(nextTask)
  const nextIndexedTask = {
    ...point.task,
    ...compact,
    id: taskId,
    title: String(nextTask.title ?? point.task.title),
    description: typeof nextTask.description === 'string' ? nextTask.description : point.task.description,
    status: typeof nextTask.status === 'string' ? nextTask.status : point.task.status,
    domain: typeof nextTask.domain === 'string' ? nextTask.domain : point.task.domain,
    workKind: typeof nextTask.workKind === 'string' ? nextTask.workKind : point.task.workKind,
    parentId: isRecord(nextTask.hierarchy) && typeof nextTask.hierarchy.parentId === 'string'
      ? nextTask.hierarchy.parentId
      : point.task.parentId,
    hierarchy: isRecord(nextTask.hierarchy) ? nextTask.hierarchy : point.task.hierarchy,
    dependsOn: Array.isArray(nextTask.dependsOn)
      ? nextTask.dependsOn.filter((value): value is string => typeof value === 'string')
      : point.task.dependsOn,
    releaseIds: Array.isArray(nextTask.releaseIds)
      ? nextTask.releaseIds.filter((value): value is string => typeof value === 'string')
      : point.task.releaseIds,
    updatedAt: typeof nextTask.updatedAt === 'string' ? nextTask.updatedAt : point.task.updatedAt,
    // An explicit `undefined` is a deletion, not permission to resurrect the
    // old indexed value. Historical completion belongs in evidence; the
    // current index must reflect the mutation exactly.
    completedAt: Object.prototype.hasOwnProperty.call(nextTask, 'completedAt')
      ? (typeof nextTask.completedAt === 'string' ? nextTask.completedAt : null)
      : point.task.completedAt,
  }
  const refreshedScopeRows = options.scopeRow === undefined
    ? projectSummaryScopeRowsFromIndexedState(tasksPath, { taskOverrides: [nextIndexedTask] })
    : null
  if (options.scopeRow === undefined && !refreshedScopeRows) return null
  const nextScopeRows = refreshedScopeRows ?? [options.scopeRow].filter(
    (row): row is ProjectStateDatabaseScopeRow => row !== null,
  )
  const existingScopeRows = readProjectStateDatabaseInventory(tasksPath, { includeDefinitions: false })?.tasks
    .flatMap(task => task.scopeRow ? [task.scopeRow] : []) ?? []
  const existingScopeByTaskId = scopeRowByTaskId(existingScopeRows)
  const nextScopeByTaskId = scopeRowByTaskId(nextScopeRows)
  const scopeRowsEqual = (left: ProjectStateDatabaseScopeRow | undefined, right: ProjectStateDatabaseScopeRow | undefined) =>
    sameJson(left ?? null, right ?? null)
  const changedScopeRows = nextScopeRows.filter(row => !scopeRowsEqual(existingScopeByTaskId.get(row.taskId), row))
  const removeScopeRowTaskIds = [...existingScopeByTaskId.keys()]
    .filter(scopeTaskId => !nextScopeByTaskId.has(scopeTaskId))
  const generatedAt = typeof nextTask.updatedAt === 'string' ? nextTask.updatedAt : new Date().toISOString()
  const summary = buildProjectSummaryProjectionFromIndexedState(tasksPath, {
    projectId: options.projectId,
    generatedAt,
    sourceQueueLastUpdated: generatedAt,
    taskOverrides: [nextIndexedTask],
    scopeRowOverrides: nextScopeRows,
  })
  if (!summary) return null
  const committedRevision = writeProjectStateDatabaseTaskMutation(tasksPath, {
    task: nextTask,
    summary: summary as unknown as Record<string, unknown>,
    expectedQueueRevision: point.revision,
    expectedProjectRevision: point.projectRevision,
    lastUpdated: generatedAt,
    scopeRows: changedScopeRows,
    removeScopeRowTaskIds,
  })
  return { committedRevision, task: nextTask }
}

function isStalePromotedTaskDetailMutation(error: unknown): boolean {
  return error instanceof Error
    && /^Stale targeted project mutation: expected (?:project )?revision \d+, found \d+\./.test(error.message)
}

/**
 * Commit an ordinary task edit against the current promoted project state.
 *
 * The point read and summary projection happen before SQLite can begin its
 * write transaction, so another process may commit runtime evidence in that
 * small interval. Rebase this pure definition mutation on the fresh canonical
 * point instead of making a caller retry an entire orchestration tick.
 */
export function writePromotedTaskDetailMutation(
  tasksPath: string,
  taskId: string,
  options: PromotedTaskDetailMutationOptions,
): { committedRevision: number; task: Record<string, unknown> } | null {
  const maxAttempts = 3
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return writePromotedTaskDetailMutationOnce(tasksPath, taskId, options)
    } catch (error) {
      if (!isStalePromotedTaskDetailMutation(error) || attempt === maxAttempts - 1) throw error
    }
  }
  return null
}

/**
 * Use the normalized release-envelope transaction when task definitions are
 * unchanged. Release selection may change every task's scope classification,
 * but it must not rewrite every task/detail payload to do so.
 */
function writeTargetedReleaseSelectionIfSafe(
  tasksPath: string,
  queue: unknown,
  options: {
    projectId?: string | null
    projectRoot?: string
    expectedQueueRevision?: number | null
  },
): boolean {
  if (readProjectStateAuthorityAtBoundary(tasksPath).authority !== 'database') return false

  const current = readProjectTaskQueueSyncWithRevision(tasksPath)
  const expectedQueueRevision = options.expectedQueueRevision ?? current.revision
  if (typeof expectedQueueRevision !== 'number' || !Number.isInteger(expectedQueueRevision) || expectedQueueRevision < 0) return false
  const expectedProjectRevision = current.projectRevision
  if (typeof expectedProjectRevision !== 'number' || !Number.isInteger(expectedProjectRevision) || expectedProjectRevision < 0) return false
  const currentQueue = readProjectStateDatabaseQueueDefinition(tasksPath) ?? current.queue
  const currentTasks = taskRecordById(currentQueue)
  const nextTasks = taskRecordById(queue)
  if (currentTasks.size !== nextTasks.size || [...currentTasks.keys()].some(id => !nextTasks.has(id))) return false
  if ([...currentTasks.keys()].some(id => !sameJson(currentTasks.get(id), nextTasks.get(id)))) return false
  if (!sameJson(queueEnvelopeList(currentQueue, 'executionPlanActions'), queueEnvelopeList(queue, 'executionPlanActions'))) return false
  if (!sameJson(queueEnvelopeList(currentQueue, 'scopeAuthorityRequests'), queueEnvelopeList(queue, 'scopeAuthorityRequests'))) return false
  if (!isRecord(queue) || typeof queue.selectedReleaseId !== 'string' || queue.selectedReleaseId.length === 0) return false
  if (sameJson(queueReleases(currentQueue), queueReleases(queue)) && queue.selectedReleaseId === queueSelectedReleaseId(currentQueue)) return false

  const prepared = prepareProjectSummaryProjectionFromUnknownQueue(tasksPath, {
    projectId: options.projectId,
    projectRoot: options.projectRoot,
    queue: queueForProjection(queue),
  })
  if (!prepared.parsedQueue || !prepared.scopeRows) return false
  writeProjectStateDatabaseReleaseSelectionMutation(tasksPath, {
    releases: queueReleases(queue).filter(isRecord),
    selectedReleaseId: queue.selectedReleaseId,
    summary: prepared.projection as unknown as Record<string, unknown>,
    scopeRows: prepared.scopeRows,
    expectedQueueRevision,
    expectedProjectRevision,
    lastUpdated: typeof queue.lastUpdated === 'string' ? queue.lastUpdated : null,
  })
  return true
}

/**
 * Route structural deltas through the indexed store. A dependency or parent
 * edit may change several derived scope rows even when only one definition
 * changed, so the delta includes those rows in the same CAS transaction.
 */
function writeTargetedTaskBatchMutationIfSafe(
  tasksPath: string,
  queue: unknown,
  options: {
    projectId?: string | null
    projectRoot?: string
    expectedQueueRevision?: number | null
    taskEvidence?: readonly {
      event: TaskEvidenceEventRecord
      retention: ProjectStateDatabaseTaskEvidenceRetentionInput
    }[]
  },
): boolean {
  if (readProjectStateAuthorityAtBoundary(tasksPath).authority !== 'database') return false
  const current = readProjectTaskQueueSyncWithRevision(tasksPath)
  const expectedQueueRevision = options.expectedQueueRevision ?? current.revision
  if (typeof expectedQueueRevision !== 'number' || !Number.isInteger(expectedQueueRevision) || expectedQueueRevision < 0) return false
  const expectedProjectRevision = current.projectRevision
  if (typeof expectedProjectRevision !== 'number' || !Number.isInteger(expectedProjectRevision) || expectedProjectRevision < 0) return false
  const currentQueue = readProjectStateDatabaseQueueDefinition(tasksPath) ?? current.queue
  const currentTasks = taskRecordById(currentQueue)
  const nextTasks = taskRecordById(queue)
  if (currentTasks.size === 0 && nextTasks.size === 0) return false

  const removedTaskIds = [...currentTasks.keys()].filter(id => !nextTasks.has(id))
  const addedTaskIds = [...nextTasks.keys()].filter(id => !currentTasks.has(id))
  const changedTaskIds = [...currentTasks.keys()].filter(id => nextTasks.has(id) && !sameJson(currentTasks.get(id), nextTasks.get(id)))
  const affectedTaskIds = new Set([...removedTaskIds, ...addedTaskIds, ...changedTaskIds])
  const envelopeChanged =
    !sameJson(queueReleases(currentQueue), queueReleases(queue)) ||
    !sameJson(queueSelectedReleaseId(currentQueue), queueSelectedReleaseId(queue)) ||
    !sameJson(queueEnvelopeList(currentQueue, 'executionPlanActions'), queueEnvelopeList(queue, 'executionPlanActions')) ||
    !sameJson(queueEnvelopeList(currentQueue, 'scopeAuthorityRequests'), queueEnvelopeList(queue, 'scopeAuthorityRequests'))
  if (affectedTaskIds.size === 0 && !envelopeChanged) return false

  const inventory = readProjectStateDatabaseInventory(tasksPath, { includeDefinitions: false })
  if (!inventory) return false
  const currentScope = new Map(inventory.tasks.map(task => [task.id, task.scopeRow]))
  const projectionQueue = queueForProjection(queue)
  const prepared = prepareProjectSummaryProjectionFromUnknownQueue(tasksPath, {
    projectId: options.projectId,
    projectRoot: options.projectRoot,
    queue: projectionQueue,
    projectionTasks: isRecord(projectionQueue) && Array.isArray(projectionQueue.tasks)
      ? projectionQueue.tasks as Task[]
      : undefined,
  })
  if (!prepared.parsedQueue || !prepared.scopeRows) return false
  const nextScope = scopeRowByTaskId(prepared.scopeRows)
  const scopeIds = new Set([...currentScope.keys(), ...nextScope.keys()])
  const changedScopeIds = [...scopeIds].filter(id => !sameJson(currentScope.get(id) ?? null, nextScope.get(id) ?? null))
  const scopeMutationIds = new Set([...affectedTaskIds, ...changedScopeIds])

  writeProjectStateDatabaseTaskBatchMutation(tasksPath, {
    tasks: [...affectedTaskIds].flatMap(id => {
      const task = nextTasks.get(id)
      return task ? [task] : []
    }),
    removeTaskIds: removedTaskIds,
    scopeRows: [...scopeMutationIds].flatMap(id => {
      const row = nextScope.get(id)
      return row ? [row] : []
    }),
    removeScopeRowTaskIds: [...changedScopeIds].filter(id => currentScope.has(id) && !nextScope.has(id)),
    ...(isRecord(queue) && Array.isArray(queue.releases)
      ? { releases: queue.releases.filter(isRecord) }
      : {}),
    ...(isRecord(queue) && 'selectedReleaseId' in queue
      ? { selectedReleaseId: typeof queue.selectedReleaseId === 'string' ? queue.selectedReleaseId : null }
      : {}),
    ...(isRecord(queue) && Array.isArray(queue.executionPlanActions)
      ? { executionPlanActions: queue.executionPlanActions.filter(isRecord) }
      : {}),
    ...(isRecord(queue) && Array.isArray(queue.scopeAuthorityRequests)
      ? { scopeAuthorityRequests: queue.scopeAuthorityRequests.filter(isRecord) }
      : {}),
    ...(options.taskEvidence ? { evidence: options.taskEvidence } : {}),
    summary: prepared.projection as unknown as Record<string, unknown>,
    expectedQueueRevision,
    expectedProjectRevision,
    lastUpdated: isRecord(queue) && typeof queue.lastUpdated === 'string' ? queue.lastUpdated : null,
  })
  return true
}

function preserveProjectQueueEnvelope(tasksPath: string, queue: unknown, allowMigrationFile: boolean): unknown {
  if (!isRecord(queue)) return queue
  const hasCompleteQueueEnvelope = [
    'releases',
    'selectedReleaseId',
    'executionPlanActions',
    'scopeAuthorityRequests',
  ].every(key => key in queue)
  if (hasCompleteQueueEnvelope) return queue
  try {
    const databaseAuthority = readProjectStateAuthorityAtBoundary(tasksPath).authority === 'database'
    const databaseQueue = readProjectStateDatabaseQueueDefinition(tasksPath)
    if (databaseAuthority && databaseQueue === null) {
      throw new Error(`Cannot preserve release envelope: authoritative detail store is unavailable for ${tasksPath}`)
    }
    const existing = databaseQueue ?? (
      (!databaseAuthority || allowMigrationFile)
        ? JSON.parse(readManagedTextFileSync(tasksPath, 'utf8')) as unknown
        : null
    )
    if (!isRecord(existing)) return queue
    return {
      ...queue,
      // Preserve only envelope fields the caller did not supply. A structural
      // mutation may intentionally change releases or selection while omitting
      // unrelated envelope fields; overlaying every existing field here would
      // silently undo that mutation before the normalized transaction sees it.
      ...(!('releases' in queue) && Array.isArray(existing.releases) ? { releases: existing.releases } : {}),
      ...(!('selectedReleaseId' in queue) && 'selectedReleaseId' in existing
        ? { selectedReleaseId: existing.selectedReleaseId }
        : {}),
      ...(!('executionPlanActions' in queue) && Array.isArray(existing.executionPlanActions)
        ? { executionPlanActions: existing.executionPlanActions }
        : {}),
      ...(!('scopeAuthorityRequests' in queue) && Array.isArray(existing.scopeAuthorityRequests)
        ? { scopeAuthorityRequests: existing.scopeAuthorityRequests }
        : {}),
    }
  } catch (error) {
    if (readProjectStateAuthorityAtBoundary(tasksPath).authority === 'database') throw error
    return queue
  }
}

function compactOpenEscalations(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return []
  return value
    .filter(item => isRecord(item) && !isResolvedEscalation(item))
    .map(item => {
      const compact: Record<string, unknown> = {}
      for (const field of ['id', 'status', 'title', 'summary', 'question', 'createdAt', 'updatedAt'] as const) {
        if (item[field] !== undefined) compact[field] = item[field]
      }
      return compact
    })
}

function isResolvedEscalation(value: Record<string, unknown>): boolean {
  const status = typeof value.status === 'string' ? value.status.toLowerCase() : ''
  return status === 'resolved' || status === 'closed' || status === 'dismissed' || typeof value.resolvedAt === 'string'
}

export function sanitizeTaskForProjectWrite(task: unknown): SanitizedTaskResult {
  if (!isRecord(task)) {
    return { task, removedFields: [], removedEvidence: {}, removedEvidenceBytes: 0 }
  }
  const next = cloneRecord(task)
  const removedFields: ForbiddenProjectTaskField[] = []
  const removedEvidence: Partial<Record<ForbiddenProjectTaskField, unknown>> = {}

  const request = isRecord(next.request) ? next.request : null
  const titleSource = typeof next.description === 'string'
    ? next.description
    : typeof request?.raw === 'string'
      ? request.raw
      : undefined
  const recoveredTitle = recoverClippedTitle(
    typeof next.title === 'string' ? next.title : undefined,
    titleSource,
  )
  if (recoveredTitle && recoveredTitle !== next.title) next.title = recoveredTitle
  const recoveredRequestTitle = recoverClippedTitle(
    typeof request?.title === 'string' ? request.title : undefined,
    titleSource,
  )
  if (request && recoveredRequestTitle && recoveredRequestTitle !== request.title) {
    next.request = { ...request, title: recoveredRequestTitle }
  }

  for (const field of FORBIDDEN_PROJECT_TASK_FIELDS) {
    if (!(field in next)) continue
    removedFields.push(field)
    removedEvidence[field] = next[field]
    if (field === 'escalations') {
      const openEscalations = compactOpenEscalations(next[field])
      if (openEscalations.length > 0) next.openEscalations = openEscalations
    }
    delete next[field]
  }

  return {
    task: next,
    removedFields,
    removedEvidence,
    removedEvidenceBytes: serializedBytes(removedEvidence),
  }
}

export function sanitizeTaskQueueForProjectWrite(queue: unknown): SanitizedTaskQueueResult {
  const originalTasks = queueTasks(queue)
  const removedByTask: SanitizedTaskQueueResult['removedByTask'] = []
  let removedEvidenceBytes = 0
  let taskDefinitionsRewritten = 0
  const tasks = originalTasks.map(task => {
    const result = sanitizeTaskForProjectWrite(task)
    if (result.removedFields.length > 0) {
      taskDefinitionsRewritten += 1
      removedEvidenceBytes += result.removedEvidenceBytes
      removedByTask.push({
        taskId: taskId(task),
        removedFields: result.removedFields,
        removedEvidence: result.removedEvidence as Record<string, unknown>,
      })
    }
    return result.task
  })

  const sanitizedQueue = Array.isArray(queue)
    ? tasks
    : isRecord(queue)
      ? { ...queue, tasks }
      : queue

  return {
    queue: sanitizedQueue,
    taskDefinitionsRewritten,
    removedEvidenceBytes,
    removedByTask,
  }
}

export function findForbiddenProjectTaskFields(queue: unknown): ForbiddenProjectTaskFieldFinding[] {
  return queueTasks(queue).flatMap(task => {
    if (!isRecord(task)) return []
    return FORBIDDEN_PROJECT_TASK_FIELDS
      .filter(field => field in task)
      .map(field => ({
        taskId: taskId(task),
        field,
        bytes: serializedBytes(task[field]),
      }))
  })
}

export function writeProjectTaskQueue(
  tasksPath: string,
  queue: unknown,
  options: { projectId?: string | null; projectRoot?: string; expectedQueueRevision?: number | null } = {},
): SanitizedTaskQueueResult {
  const result = sanitizeTaskQueueForProjectWrite(queue)
  writeProjectTaskQueueWithSummary(tasksPath, result.queue, {
    ...options,
    taskDefinitionsAlreadySanitized: true,
  })
  return result
}

const PROMOTED_EVIDENCE_FIELDS: Readonly<Record<string, TaskEvidenceKind>> = {
  notes: 'note',
  gateResults: 'gate_result',
  reviewVerdicts: 'review_verdict',
  adjudications: 'adjudication',
  escalations: 'escalation',
  agentIssues: 'agent_issue',
  mergeRecord: 'merge_record',
  doneSummaryBundle: 'completion_summary',
}

/**
 * The one bridge for bootstrap/import callers that still have a rich Task
 * object in hand. Promoted projects persist definition fields, runtime and
 * workspace overlays, and bounded evidence through their owners; they never
 * hand the rich object to the aggregate definition writer.
 */
export async function writeProjectTaskQueueAtCurrentStateBoundary(
  tasksPath: string,
  queue: unknown,
  options: {
    projectId?: string | null
    projectRoot?: string
    expectedQueueRevision?: number | null
  } = {},
): Promise<void> {
  const wasDatabaseAuthority = readProjectStateAuthorityAtBoundary(tasksPath).authority === 'database'
  if (!options.projectRoot) {
    if (wasDatabaseAuthority) {
      throw new Error('Promoted rich task writes require projectRoot for normalized state stores')
    }
    writeProjectTaskQueueWithSummary(tasksPath, queue, options)
    return
  }

  const originalTasks = queueTasks(queue).filter(isRecord)
  const sanitized = sanitizeTaskQueueForProjectWrite(queue)
  const evidenceAuthority = readProjectStateDatabaseTaskEvidenceAuthority(options.projectRoot)

  const runtimeOverlays: Array<{ taskId: string; updatedAt: string; payload: Record<string, unknown> }> = []
  const workspaceOverlays: Array<{ taskId: string; updatedAt: string; payload: Record<string, unknown> }> = []
  const evidence: Array<{
    event: TaskEvidenceEventRecord
    retention: ProjectStateDatabaseTaskEvidenceRetentionInput
  }> = []
  for (const task of originalTasks) {
    const id = typeof task.id === 'string' ? task.id : ''
    if (!id) continue
    const updatedAt = typeof task.updatedAt === 'string' ? task.updatedAt : new Date().toISOString()
    const runtime: Record<string, unknown> = {}
    if (typeof task.assignedTo === 'string' || task.assignedTo === null) runtime.assignedTo = task.assignedTo
    if (typeof task.revisionCount === 'number' && task.revisionCount > 0) runtime.revisionCount = task.revisionCount
    if (isRecord(task.retryWindow)) runtime.retryWindow = task.retryWindow
    if (typeof task.remediationAttempts === 'number' && task.remediationAttempts > 0) runtime.remediationAttempts = task.remediationAttempts
    if (isRecord(task.workerRecovery)) runtime.workerRecovery = task.workerRecovery
    if (typeof task.handoffStep === 'number' && task.handoffStep > 0) runtime.handoffStep = task.handoffStep
    if (isRecord(task.proofRecovery)) runtime.proofRecovery = task.proofRecovery
    if (isRecord(task.currentLifecycle)) runtime.currentLifecycle = task.currentLifecycle
    if (isRecord(task.shelveReason)) runtime.shelveReason = task.shelveReason
    if (Array.isArray(task.escalations)) {
      const ids = task.escalations
        .filter(isRecord)
        .filter(value => !value.resolvedAt)
        .map(value => value.id)
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
      runtime.openEscalationIds = ids
    }
    if (Array.isArray(task.agentIssues)) {
      const ids = task.agentIssues
        .filter(isRecord)
        .filter(value => !value.resolvedAt)
        .map(value => value.id)
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
      runtime.openIssueIds = ids
    }
    if (Object.keys(runtime).length > 0) {
      runtimeOverlays.push({
        taskId: id,
        updatedAt,
        payload: { taskId: id, ...runtime, updatedAt },
      })
    }

    const workspace: Record<string, unknown> = {}
    for (const field of ['worktreePath', 'branchName', 'baseBranch', 'mode', 'createdAt']) {
      if (typeof task[field] === 'string') workspace[field] = task[field]
    }
    if (Object.keys(workspace).length > 0) {
      workspaceOverlays.push({
        taskId: id,
        updatedAt,
        payload: { taskId: id, ...workspace, updatedAt },
      })
    }

  }

  for (const task of originalTasks) {
    const id = typeof task.id === 'string' ? task.id : ''
    if (!id) continue
    const updatedAt = typeof task.updatedAt === 'string' ? task.updatedAt : new Date().toISOString()

    for (const [field, kind] of Object.entries(PROMOTED_EVIDENCE_FIELDS)) {
      const value = task[field]
      const records = Array.isArray(value) ? value : [value]
      for (const [index, record] of records.entries()) {
        if (!isRecord(record)) continue
        const recordedAt = typeof record.timestamp === 'string'
          ? record.timestamp
          : typeof record.recordedAt === 'string'
            ? record.recordedAt
            : updatedAt
        const rawId = typeof record.id === 'string' && record.id.length > 0 ? record.id : null
        evidence.push({
          event: {
            id: rawId ?? `${id}-${kind}-${recordedAt.replace(/[^0-9A-Za-z]/g, '')}-${index + 1}`,
            taskId: id,
            kind,
            recordedAt,
            payload: record,
          },
          retention: TASK_EVIDENCE_RETENTION[kind],
        })
      }
    }
  }
  // Queue definitions, mutable overlays, and bounded evidence are one
  // re-intake mutation. The state writer commits them together; a reader can
  // never observe a new queue with old runtime/evidence rows.
  writeProjectTaskQueueWithSummary(tasksPath, wasDatabaseAuthority ? sanitized.queue : queue, {
    ...options,
    ...(wasDatabaseAuthority ? { taskDefinitionsAlreadySanitized: true } : {}),
    taskRuntimes: runtimeOverlays,
    taskWorkspaces: workspaceOverlays,
    ...(evidenceAuthority === 'compressed' ? {} : { taskEvidence: evidence }),
  })
  // Compressed evidence is a detail-only ledger and cannot participate in the
  // SQLite queue transaction. It still has one owner: use its canonical writer
  // after the current-state commit rather than leaving a second evidence shape.
  if (evidenceAuthority === 'compressed') {
    for (const entry of evidence) {
      await appendTaskEvidence(options.projectRoot, entry.event.taskId, entry.event)
    }
  }
}

/**
 * Persist a queue without changing its task shape, then refresh the compact
 * current-state projection. Intake and dashboard mutations use this boundary
 * until their runtime/evidence writes have been fully separated.
 */
export function writeProjectTaskQueueWithSummary(
  tasksPath: string,
  queue: unknown,
  options: {
    projectId?: string | null
    projectRoot?: string
    /** Migration-only request to emit the retired compact TASKS export. */
    compactCompatibility?: boolean
    /** Migration-only request to emit a full transitional queue export. */
    fullCompatibility?: boolean
    /** Internal marker for the sanitizer-owned normal writer. */
    taskDefinitionsAlreadySanitized?: boolean
    expectedQueueRevision?: number | null
    taskEvidence?: readonly {
      event: TaskEvidenceEventRecord
      retention: ProjectStateDatabaseTaskEvidenceRetentionInput
    }[]
    taskRuntimes?: readonly { taskId: string; updatedAt?: string; payload: unknown }[]
    taskWorkspaces?: readonly { taskId: string; updatedAt?: string; payload: unknown }[]
  } = {},
): void {
  const compatibilityExport = options.fullCompatibility === true
    ? 'full' as const
    : options.compactCompatibility === true
      ? 'compact' as const
      : undefined
  const databaseAuthority = readProjectStateAuthorityAtBoundary(tasksPath).authority === 'database'
  const hasAtomicExtras = options.taskRuntimes !== undefined || options.taskWorkspaces !== undefined || options.taskEvidence !== undefined
  if (databaseAuthority && compatibilityExport === undefined && !hasAtomicExtras) {
    // The public sanitizer calls this function with an explicit marker after
    // removing retired fields. Direct aggregate callers must be checked first
    // so a newly supplied runtime/evidence field cannot disappear silently.
    if (!options.taskDefinitionsAlreadySanitized) assertNoPromotedForbiddenTaskChanges(tasksPath, queue)
  }
  // Compare and persist the definition-owned shape. The normal queue reader
  // may have merged runtime/evidence summaries onto each task card; those
  // overlays are not an aggregate definition mutation.
  const currentQueue = databaseAuthority && compatibilityExport === undefined
    ? (options.taskDefinitionsAlreadySanitized ? queue : sanitizeTaskQueueForProjectWrite(queue).queue)
    : queue
  // Once SQLite owns current state, every normal writer must pass through the
  // same definition/evidence split. The lower-level writer remains available
  // for migration/bootstrap input, but it cannot resurrect retired fields in
  // a promoted project's current task definitions.
  const persistedQueue = preserveProjectQueueEnvelope(tasksPath, currentQueue, compatibilityExport !== undefined)
  if (databaseAuthority && !hasAtomicExtras && writeTargetedReleaseSelectionIfSafe(tasksPath, persistedQueue, options)) return
  if (databaseAuthority && !hasAtomicExtras && writeTargetedTaskBatchMutationIfSafe(tasksPath, persistedQueue, options)) return
  if (databaseAuthority && !hasAtomicExtras && writeTargetedTaskMutationIfSafe(tasksPath, persistedQueue, options)) return
  if (databaseAuthority && compatibilityExport === undefined && !hasAtomicExtras) {
    const currentQueue = readProjectStateDatabaseQueueDefinition(tasksPath)
    if (currentQueue && sameCanonicalQueue(currentQueue, persistedQueue)) return
    throw new Error(
      `Promoted project state cannot use aggregate queue replacement for ${tasksPath}; use a normalized task, structural batch, release-envelope, or explicit migration write.`,
    )
  }
  // Runtime reads never consult this file. It is emitted only while an
  // explicitly named migration is still converting an older project.
  if (!databaseAuthority && compatibilityExport !== undefined) {
    const compatibilityQueue = options.fullCompatibility === true
      ? persistedQueue
      : options.compactCompatibility === true
        ? compactProjectStateQueueForCompatibility(persistedQueue)
        : persistedQueue
    writeManagedTextFileSync(tasksPath, `${JSON.stringify(compatibilityQueue, null, 2)}\n`)
  } else if (!databaseAuthority) {
    // A pre-promotion project still needs one bootstrap queue file so intake
    // can be re-opened before the normalized database becomes authoritative.
    // Once promoted, this branch is unreachable and SQLite is the only writer.
    writeManagedTextFileSync(tasksPath, `${JSON.stringify(persistedQueue, null, 2)}\n`)
  }
  // Keep the compact current-state read model beside the canonical queue. This
  // is deliberately limited to task/scope facts; runtime and history remain in
  // their own stores and are loaded by detail views.
  writeProjectSummaryProjectionFromUnknownQueue(tasksPath, {
    queue: persistedQueue,
    projectId: options.projectId,
    projectRoot: options.projectRoot,
    ...(options.expectedQueueRevision !== undefined && options.expectedQueueRevision !== null
      ? { expectedQueueRevision: options.expectedQueueRevision }
      : {}),
    ...(options.taskEvidence !== undefined ? { evidence: options.taskEvidence } : {}),
    ...(options.taskRuntimes !== undefined ? { taskRuntimes: options.taskRuntimes } : {}),
    ...(options.taskWorkspaces !== undefined ? { taskWorkspaces: options.taskWorkspaces } : {}),
    ...(options.taskDefinitionsAlreadySanitized ? { taskDefinitionsAlreadySanitized: true } : {}),
    ...(compatibilityExport ? { compatibilityExport } : {}),
  })
}

export async function readProjectTaskQueue(tasksPath: string): Promise<unknown> {
  return readProjectTaskQueueSync(tasksPath)
}

export function readProjectTaskQueueSync(tasksPath: string): unknown {
  if (readProjectStateAuthorityAtBoundary(tasksPath).authority !== 'database') {
    // A project before authority promotion has one legitimate current source:
    // its bootstrap queue file. This is not a post-cutover compatibility
    // reader; once SQLite is authoritative, this branch is unreachable.
    return queueShapeForRuntime(JSON.parse(readManagedTextFileSync(tasksPath, 'utf8')))
  }
  return queueShapeForRuntime(readProjectTaskQueueSyncFromDatabase(tasksPath))
}

export interface ProjectTaskQueueMutationRead {
  queue: unknown
  expectedQueueRevision: number | null
  expectedProjectRevision: number | null
}

/**
 * Read a queue together with the revision that authorizes replacing it. The
 * token is captured beside the authoritative detail read, so callers cannot
 * accidentally compare a stale queue against a newer, unrelated read.
 */
export function readProjectTaskQueueForMutationSync(tasksPath: string): ProjectTaskQueueMutationRead {
  if (readProjectStateAuthorityAtBoundary(tasksPath).authority !== 'database') {
    return {
      queue: readProjectTaskQueueSync(tasksPath),
      // A bootstrap snapshot can exist before SQLite becomes authoritative.
      // Once it does, aggregate replacements still need its CAS watermark.
      expectedQueueRevision: readProjectStateDatabaseQueueRevision(tasksPath),
      expectedProjectRevision: null,
    }
  }
  const result = readProjectTaskQueueSyncWithRevision(tasksPath)
  return {
    queue: queueShapeForRuntime(result.queue),
    expectedQueueRevision: result.revision,
    expectedProjectRevision: result.projectRevision,
  }
}

function queueShapeForRuntime(value: unknown): unknown {
  if (!isRecord(value) || value.selectedReleaseId !== null) return value
  const { selectedReleaseId: _selectedReleaseId, ...queue } = value
  return queue
}
