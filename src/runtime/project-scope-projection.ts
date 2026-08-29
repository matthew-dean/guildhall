import { explicitTaskStructuralIdentity, type ProjectRelease, type Task, type TaskQueue, type TaskStatus } from '@guildhall/core'
import { taskDisplayLabel } from '@guildhall/shared'
import { deriveTaskWorkVisibility } from './work-visibility.js'
import { META_INTAKE_TASK_ID, WORKSPACE_IMPORT_TASK_ID } from './project-reserved-task-ids.js'
import { specReviewIsReadyForOwnerApproval, specReviewNeedsRepair } from './spec-review-ownership.js'
import { effectiveTaskStatus } from './effective-task.js'
import { taskDoneButProofMissingForScope } from './proof-health.js'
import { taskBlockerSummary } from './task-blocker-summary.js'
import { explicitMarkdownSourceRefsFromTask } from './task-source-refs.js'

export type ProjectScopeKind = 'release' | 'milestone' | 'proposed_feature_set'
export type ProjectScopeSource = 'owner_approved' | 'spec' | 'release_plan' | 'inferred'
export type ProjectScopeEligibilityReason = 'included' | 'included_ancestor' | 'included_prerequisite' | 'deferred' | 'no_scope'
export type ProjectScopeHierarchyRole = 'root' | 'parent' | 'child'
export type ProjectScopeHandoffState =
  | 'not_shaped'
  | 'spec_shaping'
  | 'brief_cleanup'
  | 'spec_review'
  | 'ready'
  | 'paused'
  | 'review'
  | 'deferred'
  | 'done'
  | 'blocked'

export interface ProjectScope {
  id: string
  label: string
  kind: ProjectScopeKind
  source: ProjectScopeSource
  nodeIds: string[]
  deferredNodeIds: string[]
  proofStyle?: 'script_only' | 'manual' | 'mixed' | 'unspecified'
}

/**
 * Public scope totals describe the owner-selected boundary. Scheduler rows can
 * collapse parent/child work into fewer runnable units, but that execution
 * view must never redefine how much work belongs to the release.
 */
export function projectScopeMembershipCounts(
  scope: Pick<ProjectScope, 'id' | 'nodeIds' | 'deferredNodeIds'> & { kind: string },
  releases: readonly ProjectRelease[],
): { taskCount: number; deferredTaskCount: number } {
  const release = scope.kind === 'release'
    ? releases.find(candidate => candidate.id === scope.id)
    : undefined
  return {
    taskCount: release?.nodeIds.length ?? scope.nodeIds.length,
    deferredTaskCount: release?.deferredNodeIds.length ?? scope.deferredNodeIds.length,
  }
}

type ProofScope = {
  id: string
  kind: string
}

export interface ProjectScopeRow {
  taskId: string
  title: string
  parentTaskId?: string
  scope: 'included' | 'deferred'
  countInProjectTotals: boolean
  eligibilityReason: ProjectScopeEligibilityReason
  hierarchyRole: ProjectScopeHierarchyRole
  status: TaskStatus
  handoffState: ProjectScopeHandoffState
  blocksStart: boolean
  blocksRelease: boolean
  humanBlocking: boolean
  proofBlocked: boolean
  dependencyBlocked?: boolean
  dependencyTaskIds?: string[]
  blockerSummary?: string
  sourceRefs: string[]
}

/**
 * A shaping boundary belongs to Guildhall's planning lane. It can prevent a
 * release from being complete without being an owner decision. Keeping this
 * predicate beside the scope row model prevents compact reads from treating
 * every release blocker as a human checkpoint.
 */
export function projectScopeRowNeedsOwnerInput(row: Pick<ProjectScopeRow, 'scope' | 'status' | 'handoffState' | 'humanBlocking'>): boolean {
  return row.scope === 'included' && row.humanBlocking && !projectScopeRowIsGuildhallShaping(row)
}

export function projectScopeRowIsGuildhallShaping(row: Pick<ProjectScopeRow, 'scope' | 'status' | 'handoffState'>): boolean {
  return row.scope === 'included' &&
    (row.handoffState === 'spec_shaping' || (
      row.handoffState === 'not_shaped' &&
      (row.status === 'exploring' || row.status === 'import_draft')
    ))
}

/**
 * Re-derive the three readiness flags when reading a compact persisted row.
 * Older snapshots stored shaping as `humanBlocking`; the current model keeps
 * that historical bit readable but repairs its meaning at the shared boundary
 * instead of letting stale flags leak into release summaries.
 */
export function normalizeProjectScopeRowReadModel(row: ProjectScopeRow): ProjectScopeRow {
  const humanBlocking = projectScopeRowIsGuildhallShaping(row)
    ? false
    : row.humanBlocking
  const dependencyBlocked = row.dependencyBlocked === true
  const canStartShaping = row.scope === 'included' && !dependencyBlocked && row.status === 'exploring' &&
    (row.handoffState === 'not_shaped' || row.handoffState === 'spec_shaping')
  const blocksStart = row.scope === 'included' && (
    row.proofBlocked ||
    dependencyBlocked ||
    row.handoffState === 'blocked' ||
    row.handoffState === 'brief_cleanup' ||
    (row.handoffState === 'spec_review' && humanBlocking) ||
    (row.handoffState === 'not_shaped' && !canStartShaping)
  )
  const blocksRelease = row.scope === 'included' && (
    row.proofBlocked ||
    row.handoffState === 'blocked' ||
    row.handoffState === 'brief_cleanup' ||
    row.handoffState === 'not_shaped' ||
    (row.handoffState === 'spec_review' && humanBlocking)
  )
  return { ...row, dependencyBlocked, humanBlocking, blocksStart, blocksRelease }
}

export interface ProjectScopeProjection {
  selectedScope: ProjectScope | null
  rows: ProjectScopeRow[]
  counts: {
    included: number
    deferred: number
    ready: number
    paused: number
    active: number
    done: number
    ownerBlocked: number
    proofBlocked: number
    humanBlocking: number
  }
  start: {
    canStart: boolean
    code?: string
    label: 'Start' | 'Resume' | 'Review' | 'Configure' | 'Answer in Thread'
    focusTaskId?: string
    focusTaskTitle?: string
    focusKind?: 'paused_work' | 'ready_work' | 'spec_review' | 'brief_cleanup' | 'blocked_work' | 'proof' | 'provider' | 'terminal' | 'setup' | 'owner_input' | 'owner_review'
    /** Exact selected-scope records behind an owner-review action. */
    reviewTaskIds?: string[]
    count?: number
    message: string
    actionHref: string
    executionScope?: {
      id: string
      label: string
      kind: ProjectScopeKind
      source: ProjectScopeSource
      taskCount: number
      deferredTaskCount: number
    }
  }
  release: {
    state: 'ready' | 'blocked' | 'active' | 'shaping' | 'unknown'
    blockers: Array<{ id: string; label: string; owningTaskId?: string; code?: string }>
  }
}

export interface ProjectScopeOutsideWorkSummary {
  count: number
  byStatus: Record<string, number>
}

export function summarizeProjectScopeOutsideWork(
  rows: readonly ProjectScopeRow[],
  selectedScope: ProjectScope | null,
): ProjectScopeOutsideWorkSummary {
  if (!selectedScope || selectedScope.id === 'current-work') return { count: 0, byStatus: {} }
  const byStatus: Record<string, number> = {}
  const deferredNodeIds = new Set(selectedScope.deferredNodeIds)
  for (const row of executionRows(rows)) {
    if (row.scope !== 'deferred') continue
    if (!deferredNodeIds.has(taskScopeNodeId(row.taskId))) continue
    if (['done', 'blocked', 'shelved', 'pending_pr', 'archived', 'cancelled'].includes(row.status)) continue
    byStatus[row.status] = (byStatus[row.status] ?? 0) + 1
  }
  return {
    count: Object.values(byStatus).reduce((sum, count) => sum + count, 0),
    byStatus,
  }
}

export interface BuildProjectScopeProjectionOptions {
  includedDependencyIds?: ReadonlySet<string>
  selectedScope?: ProjectScope | null
}

export interface ProjectScopeTaskInput {
  id: string
  status?: TaskStatus
  releaseIds?: readonly string[]
  proofForReleaseId?: string
  semanticKind?: string
  hierarchy?: { parentId?: string; childIds?: string[] }
}

export function taskScopeNodeId(taskId: string): string {
  return `work:${taskId}`
}

function isWorkspaceImportPreviewNodeId(nodeId: string): boolean {
  return nodeId.startsWith('work:workspace-import:')
}

export function releaseLabelFromId(id: string): string {
  const acronyms = new Set(['api', 'cli', 'mcp', 'mvp', 'nh', 'ui', 'ux'])
  return id
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(part => acronyms.has(part.toLowerCase()) ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || id
}

export function deriveReleaseContainersFromTaskMembership(
  tasks: readonly Task[],
  options: {
    existingReleases?: readonly ProjectRelease[]
    releaseIds?: readonly string[]
    releaseLabels?: ReadonlyMap<string, string>
    releaseStates?: ReadonlyMap<string, ProjectRelease['state']>
    releaseSources?: ReadonlyMap<string, ProjectRelease['source']>
    now?: string
  } = {},
): { releases: ProjectRelease[]; selectedReleaseId?: string } {
  const releaseIds = uniqueReleaseIds([
    ...(options.existingReleases ?? []).map(release => release.id),
    ...(options.releaseIds ?? []),
    ...tasks
      .filter(task => task.status !== 'archived' && task.status !== 'cancelled')
      .flatMap(task => task.releaseIds ?? []),
  ])
  if (releaseIds.length === 0) return { releases: [] }

  const existingById = new Map((options.existingReleases ?? []).map(release => [release.id, release] as const))
  const tasksById = new Map(tasks.map(task => [task.id, task] as const))
  const childIdsByParent = buildChildMap(tasks)
  const releases = releaseIds.map((releaseId): ProjectRelease => {
    const existing = existingById.get(releaseId)
    const nodeIds = new Set((existing?.nodeIds ?? []).filter(nodeId => !isWorkspaceImportPreviewNodeId(nodeId)))
    const deferredNodeIds = new Set((existing?.deferredNodeIds ?? []).filter(nodeId => !isWorkspaceImportPreviewNodeId(nodeId)))
    for (const task of tasks) {
      const nodeId = taskScopeNodeId(task.id)
      const listed = nodeIds.has(nodeId) || deferredNodeIds.has(nodeId)
      const assigned = task.releaseIds?.includes(releaseId) ?? false
      if (!listed && !assigned) continue
      if (task.status === 'archived' || task.status === 'cancelled') {
        nodeIds.delete(nodeId)
        deferredNodeIds.delete(nodeId)
        continue
      }
      if (task.status === 'shelved') {
        nodeIds.delete(nodeId)
        deferredNodeIds.add(nodeId)
      } else if (nodeIds.has(nodeId) || (assigned && !deferredNodeIds.has(nodeId))) {
        nodeIds.add(nodeId)
      }
    }
    expandMaterializedReleaseChildren({
      releaseId,
      nodeIds,
      deferredNodeIds,
      tasksById,
      childIdsByParent,
    })
    const label = options.releaseLabels?.get(releaseId) ?? existing?.label ?? releaseLabelFromId(releaseId)
    return {
      ...(existing ?? {
        id: releaseId,
        label,
        kind: 'release',
        state: 'active',
        source: 'inferred',
        proofStyle: 'unspecified',
      }),
      id: releaseId,
      label,
      state: options.releaseStates?.get(releaseId) ?? existing?.state ?? 'active',
      source: options.releaseSources?.get(releaseId) ?? existing?.source ?? 'inferred',
      nodeIds: [...nodeIds],
      deferredNodeIds: [...deferredNodeIds],
      ...(options.now ? { updatedAt: options.now, createdAt: existing?.createdAt ?? options.now } : {}),
    }
  })

  const selectedReleaseId =
    releases.find(release => tasks.some(task => releaseIncludesTask(release, task) && taskIsOpenCurrentScopeWork(task)))?.id ??
    releases[0]?.id
  return { releases, ...(selectedReleaseId ? { selectedReleaseId } : {}) }
}

function expandMaterializedReleaseChildren(input: {
  releaseId: string
  nodeIds: Set<string>
  deferredNodeIds: Set<string>
  tasksById: ReadonlyMap<string, Task>
  childIdsByParent: ReadonlyMap<string, string[]>
}): void {
  const scopedParentIds = [...input.nodeIds, ...input.deferredNodeIds]
    .map(nodeId => nodeId.replace(/^work:/, ''))
    .filter(taskId => input.childIdsByParent.has(taskId))
  for (const parentId of scopedParentIds) {
    const parent = input.tasksById.get(parentId)
    if (!parent) continue
    const childIds = input.childIdsByParent.get(parentId) ?? []
    const materializedChildren = childIds
      .map(childId => input.tasksById.get(childId))
      .filter((child): child is Task => Boolean(child))
      .filter(child => !['archived', 'cancelled'].includes(String(child.status ?? '')))
      .filter(child => isMaterializedExecutionChild(parent, child))
      .filter(child => deriveTaskWorkVisibility(child, parent).countInProjectTotals)
    if (materializedChildren.length === 0) continue

    input.nodeIds.delete(taskScopeNodeId(parentId))
    input.deferredNodeIds.delete(taskScopeNodeId(parentId))
    for (const child of materializedChildren) {
      const childNodeId = taskScopeNodeId(child.id)
      if (child.status === 'shelved') {
        input.nodeIds.delete(childNodeId)
        input.deferredNodeIds.add(childNodeId)
      } else {
        input.deferredNodeIds.delete(childNodeId)
        input.nodeIds.add(childNodeId)
      }
    }
  }
}

function isMaterializedExecutionChild(parent: Task, child: Task): boolean {
  return child.hierarchy?.relation === 'decomposes' || child.id.startsWith(`${parent.id}-split-`)
}

function uniqueReleaseIds(ids: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const rawId of ids) {
    const id = rawId.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    result.push(id)
  }
  return result
}

function taskIsOpenCurrentScopeWork(task: Task): boolean {
  return task.status !== 'done' &&
    task.status !== 'archived' &&
    task.status !== 'cancelled' &&
    task.status !== 'shelved'
}

function releaseIncludesTask(release: ProjectRelease, task: Task): boolean {
  const nodeId = taskScopeNodeId(task.id)
  return release.nodeIds.includes(nodeId) ||
    release.deferredNodeIds.includes(nodeId) ||
    (task.releaseIds?.includes(release.id) ?? false)
}

export function selectedProjectScopeForQueue(
  queue: Pick<TaskQueue, 'tasks' | 'releases' | 'selectedReleaseId'>,
): ProjectScope | null {
  // Task membership is evidence for an explicit intake/migration writer, not
  // permission for a read to manufacture a release container. Projects with
  // no named release intentionally use the unscoped current-work view.
  const releases = queue.releases ?? []
  if (releases.length === 0) return null
  const selectedReleaseId = queue.selectedReleaseId
  const release =
    releases.find(candidate => candidate.id === selectedReleaseId) ??
    releases.find(candidate => candidate.state === 'active') ??
    releases.find(candidate => candidate.state === 'planned') ??
    releases[0]
  if (!release) return null
  return releaseToProjectScope(release, queue.tasks)
}

export function releaseToProjectScope(release: ProjectRelease, tasks: readonly Task[]): ProjectScope {
  const nodeIds = new Set<string>((release.nodeIds ?? []).filter(nodeId => !isWorkspaceImportPreviewNodeId(nodeId)))
  const deferredNodeIds = new Set<string>((release.deferredNodeIds ?? []).filter(nodeId => !isWorkspaceImportPreviewNodeId(nodeId)))
  const hasMaterializedMembership = nodeIds.size > 0 || deferredNodeIds.size > 0
  for (const task of tasks) {
    const nodeId = taskScopeNodeId(task.id)
    const nodeWasIncluded = nodeIds.has(nodeId)
    const nodeWasDeferred = deferredNodeIds.has(nodeId)
    if (isProjectSetupTask(task.id)) {
      nodeIds.delete(nodeId)
      deferredNodeIds.delete(nodeId)
      continue
    }
    if (task.status === 'archived' || task.status === 'cancelled') {
      nodeIds.delete(nodeId)
      deferredNodeIds.delete(nodeId)
      continue
    }
    if (task.status === 'shelved') {
      nodeIds.delete(nodeId)
      if (nodeWasIncluded || nodeWasDeferred || task.releaseIds?.includes(release.id)) {
        deferredNodeIds.add(nodeId)
      }
      continue
    }
    const parent = task.hierarchy?.parentId
      ? tasks.find(candidate => candidate.id === task.hierarchy?.parentId) ?? null
      : null
    if (!deriveTaskWorkVisibility(task, parent).countInProjectTotals) {
      nodeIds.delete(nodeId)
      deferredNodeIds.delete(nodeId)
      continue
    }
    const taskReleaseIds = task.releaseIds ?? []
    if (taskReleaseIds.length === 0 && task.hierarchy?.parentId) continue
    if (taskReleaseIds.length === 0) continue
    if (
      hasMaterializedMembership &&
      taskHasMaterializedChildScope(task, nodeIds, deferredNodeIds)
    ) continue
    if (hasMaterializedMembership && taskStatusIsTerminalForMembership(task.status)) continue
    if (taskReleaseIds.includes(release.id)) {
      if (deferredNodeIds.has(nodeId)) {
        nodeIds.delete(nodeId)
        continue
      }
      nodeIds.add(nodeId)
    }
  }
  return {
    id: release.id,
    label: release.label,
    kind: release.kind === 'milestone' ? 'milestone' : release.kind === 'release' ? 'release' : 'proposed_feature_set',
    source: release.source,
    nodeIds: [...nodeIds],
    deferredNodeIds: [...deferredNodeIds],
    ...(release.proofStyle ? { proofStyle: release.proofStyle } : {}),
  }
}

export function taskScopeEligibility(
  task: ProjectScopeTaskInput,
  scope: ProjectScope | null | undefined,
  options: {
    includedDependencyIds?: ReadonlySet<string>
    tasksById?: ReadonlyMap<string, ProjectScopeTaskInput>
  } = {},
): { eligible: boolean; reason: ProjectScopeEligibilityReason } {
  if (!scope) {
    return task.status === 'shelved'
      ? { eligible: false, reason: 'deferred' }
      : { eligible: true, reason: 'no_scope' }
  }
  const nodeId = taskScopeNodeId(task.id)
  if (
    scope.kind === 'release' &&
    task.semanticKind === 'proof_setup' &&
    task.proofForReleaseId !== scope.id
  ) {
    // Proof setup is release-local executable work. A historical proof child
    // remains readable, but ancestor membership must not make it an active
    // blocker in a later release.
    return { eligible: false, reason: 'deferred' }
  }
  if (scope.nodeIds.includes(nodeId)) return { eligible: true, reason: 'included' }
  if (options.includedDependencyIds?.has(task.id)) return { eligible: true, reason: 'included_prerequisite' }
  if (scope.deferredNodeIds.includes(nodeId)) return { eligible: false, reason: 'deferred' }
  if (task.status === 'shelved') return { eligible: false, reason: 'deferred' }
  const childIds = task.hierarchy?.childIds ?? []
  if (childIds.some(childId => scope.nodeIds.includes(taskScopeNodeId(childId)))) {
    return { eligible: true, reason: 'included_ancestor' }
  }
  let parentId = task.hierarchy?.parentId?.trim() || null
  while (parentId) {
    const parentNodeId = taskScopeNodeId(parentId)
    if (scope.nodeIds.includes(parentNodeId)) return { eligible: true, reason: 'included_ancestor' }
    if (scope.deferredNodeIds.includes(parentNodeId)) return { eligible: false, reason: 'deferred' }
    parentId = options.tasksById?.get(parentId)?.hierarchy?.parentId?.trim() || null
  }
  if ((task.releaseIds?.length ?? 0) === 0) return { eligible: false, reason: 'deferred' }
  return { eligible: false, reason: 'deferred' }
}

export function buildProjectScopeProjection(
  queue: Pick<TaskQueue, 'tasks' | 'releases' | 'selectedReleaseId'> &
    Partial<Pick<TaskQueue, 'version' | 'lastUpdated'>>,
  options: BuildProjectScopeProjectionOptions = {},
): ProjectScopeProjection {
  // All scope consumers receive the same current task status before any
  // hierarchy, release, proof, or next-action rule runs. Persisted rows are a
  // cache of this projection; they are never a second status authority.
  const currentTasks = queue.tasks.map(currentTaskForProjection)
  const selectedScope = normalizeSelectedScope(
    'selectedScope' in options ? options.selectedScope ?? null : selectedProjectScopeForQueue({ ...queue, tasks: currentTasks }),
    currentTasks,
  )
  const tasksById = new Map(currentTasks.map(task => [task.id, task] as const))
  const childIdsByParent = buildChildMap(currentTasks)
  const requiresScriptProof = selectedScope?.proofStyle === 'script_only'
  const suppressedProofTaskIds = duplicateProofMissingTaskIds(currentTasks, selectedScope, tasksById, requiresScriptProof)
  const rows = currentTasks
    .map(task => buildScopeRow(task, {
      selectedScope,
      tasksById,
      childIdsByParent,
      suppressedProofTaskIds,
      requiresScriptProof,
      includedDependencyIds: options.includedDependencyIds,
    }))
    .filter((row): row is ProjectScopeRow => Boolean(row))
  const counts = summarizeExecutionScopeRows(rows)
  const setupTask = currentTasks.find(task =>
    isProjectSetupTask(task.id) &&
    !['done', 'pending_pr', 'archived', 'cancelled'].includes(String(task.status ?? '')),
  )
  return {
    selectedScope,
    rows,
    counts,
    start: summarizeProjectScopeStart(rows, selectedScope, setupTask),
    release: summarizeProjectScopeRelease(rows),
  }
}

/**
 * A containing task stops being a second proof obligation once every linked
 * decomposition child has closed with its own proof. This is deliberately
 * derived from the task graph rather than by rewriting the parent's
 * acceptance criteria: the parent remains the durable product boundary and
 * the children satisfy the work it contains.
 */
export function taskCompletionProofSatisfiedByLinkedChildren(
  task: Task,
  tasks: readonly Task[],
  proofStyle: 'script_only' | 'manual' | 'mixed' | 'unspecified' | null | undefined,
  selectedScope?: ProofScope | null,
): boolean {
  const tasksById = new Map(tasks.map(candidate => [candidate.id, candidate] as const))
  const childIdsByParent = buildChildMap(tasks)
  return taskCompletionProofSatisfiedByLinkedChildrenAtIndex(
    task,
    tasksById,
    childIdsByParent,
    proofStyle,
    selectedScope,
    new Set<string>(),
  )
}

function proofChildBelongsToSelectedScope(
  child: Task,
  selectedScope: ProofScope | null | undefined,
): boolean {
  // A proof child created for a later release is a new executable boundary;
  // historical proof children must not keep the current parent blocked (or
  // satisfy it) through ancestor membership alone.
  if (!selectedScope || selectedScope.kind !== 'release' || child.semanticKind !== 'proof_setup') return true
  return child.proofForReleaseId === selectedScope.id
}

function currentTaskForProjection(task: Task): Task {
  const status = effectiveTaskStatus(task)
  return status && status !== task.status
    ? { ...task, status: status as TaskStatus }
    : task
}

function normalizeSelectedScope(scope: ProjectScope | null, tasks: readonly Task[]): ProjectScope | null {
  if (!scope) return null
  const nodeIds = new Set(scope.nodeIds)
  const deferredNodeIds = new Set(scope.deferredNodeIds)
  const hasMaterializedMembership = nodeIds.size > 0 || deferredNodeIds.size > 0
  const tasksById = new Map(tasks.map(task => [task.id, task] as const))
  const childIdsByParent = buildChildMap(tasks)
  for (const nodeId of [...nodeIds]) {
    if (isWorkspaceImportPreviewNodeId(nodeId)) nodeIds.delete(nodeId)
  }
  for (const nodeId of [...deferredNodeIds]) {
    if (isWorkspaceImportPreviewNodeId(nodeId)) deferredNodeIds.delete(nodeId)
  }
  for (const task of tasks) {
    const nodeId = taskScopeNodeId(task.id)
    const nodeWasIncluded = nodeIds.has(nodeId)
    const nodeWasDeferred = deferredNodeIds.has(nodeId)
    if (isProjectSetupTask(task.id)) {
      nodeIds.delete(nodeId)
      deferredNodeIds.delete(nodeId)
      continue
    }
    if (task.status === 'archived' || task.status === 'cancelled') {
      nodeIds.delete(nodeId)
      deferredNodeIds.delete(nodeId)
      continue
    }
    if (task.status === 'shelved') {
      nodeIds.delete(nodeId)
      if (nodeWasIncluded || nodeWasDeferred || task.releaseIds?.includes(scope.id)) {
        deferredNodeIds.add(nodeId)
      }
      continue
    }
    const parent = task.hierarchy?.parentId ? tasksById.get(task.hierarchy.parentId) ?? null : null
    if (!deriveTaskWorkVisibility(task, parent).countInProjectTotals) {
      // Internal steps may remain in the task graph for shaping and proof
      // review, but they can never be release membership or progress totals.
      nodeIds.delete(nodeId)
      deferredNodeIds.delete(nodeId)
      continue
    }
    if (
      task.releaseIds?.includes(scope.id) &&
      (
        !hasMaterializedMembership ||
        (
          !taskStatusIsTerminalForMembership(task.status) &&
          !taskHasMaterializedChildScope(task, nodeIds, deferredNodeIds)
        )
      )
    ) {
      if (!deriveTaskWorkVisibility(task, parent).countInProjectTotals) {
        nodeIds.delete(nodeId)
        deferredNodeIds.delete(nodeId)
        continue
      }
      if (deferredNodeIds.has(nodeId)) {
        nodeIds.delete(nodeId)
        continue
      }
      nodeIds.add(nodeId)
      continue
    }
    if (scope.kind === 'release') continue
    if ((task.releaseIds?.length ?? 0) > 0 || task.hierarchy?.parentId || !taskIsOpenCurrentScopeWork(task)) continue
    if (!deferredNodeIds.has(nodeId)) nodeIds.add(nodeId)
  }
  expandMaterializedReleaseChildren({
    releaseId: scope.id,
    nodeIds,
    deferredNodeIds,
    tasksById,
    childIdsByParent,
  })
  return {
    ...scope,
    nodeIds: [...nodeIds],
    deferredNodeIds: [...deferredNodeIds],
  }
}

function taskHasMaterializedChildScope(
  task: Pick<Task, 'hierarchy'>,
  nodeIds: ReadonlySet<string>,
  deferredNodeIds: ReadonlySet<string>,
): boolean {
  return (task.hierarchy?.childIds ?? []).some(childId => {
    const nodeId = taskScopeNodeId(childId)
    return nodeIds.has(nodeId) || deferredNodeIds.has(nodeId)
  })
}

function taskStatusIsTerminalForMembership(status: Task['status'] | undefined): boolean {
  return status === 'done' || status === 'pending_pr'
}

function buildScopeRow(
  task: Task,
  input: {
    selectedScope: ProjectScope | null
    tasksById: ReadonlyMap<string, Task>
    childIdsByParent: ReadonlyMap<string, string[]>
    suppressedProofTaskIds: ReadonlySet<string>
    requiresScriptProof: boolean
    includedDependencyIds?: ReadonlySet<string>
  },
): ProjectScopeRow | null {
  if (isProjectSetupTask(task.id) || task.status === 'archived' || task.status === 'cancelled') return null
  const parent = task.hierarchy?.parentId ? input.tasksById.get(task.hierarchy.parentId) ?? null : null
  const visibility = deriveTaskWorkVisibility(task, parent)
  if (!visibility.countInProjectTotals && !parent) return null
  const eligibility = taskScopeEligibility(task, input.selectedScope, {
    tasksById: input.tasksById,
    includedDependencyIds: input.includedDependencyIds,
  })
  const scope = eligibility.eligible ? 'included' : 'deferred'
  const role = hierarchyRoleFor(task, input.childIdsByParent)
  const handoffState = handoffStateForTask(task, {
    scope,
    tasksById: input.tasksById,
    childIdsByParent: input.childIdsByParent,
    selectedScope: input.selectedScope,
  })
  const proofBlocked = completionProofBlockedForTask(
    task,
    input.suppressedProofTaskIds,
    input.requiresScriptProof,
    input.tasksById,
    input.childIdsByParent,
    input.selectedScope,
  )
  const humanBlocking = proofBlocked ? false : humanBlockingFor(task, handoffState, scope)
  const dependencyTaskIds = (task.dependsOn ?? []).filter(dependencyId => {
    const dependency = input.tasksById.get(dependencyId)
    return !dependency || (effectiveTaskStatus(dependency) ?? dependency.status) !== 'done'
  })
  const dependencyBlocked = scope === 'included' && dependencyTaskIds.length > 0
  return normalizeProjectScopeRowReadModel({
    taskId: task.id,
    title: taskDisplayLabel(task, task.id),
    ...(parent ? { parentTaskId: parent.id } : {}),
    scope,
    countInProjectTotals: visibility.countInProjectTotals,
    eligibilityReason: eligibility.reason,
    hierarchyRole: role,
    status: task.status,
    handoffState,
    blocksStart: scope === 'included' && humanBlocking,
    blocksRelease: scope === 'included' && (humanBlocking || handoffState === 'blocked' || proofBlocked),
    humanBlocking,
    proofBlocked,
    dependencyBlocked,
    ...(dependencyTaskIds.length > 0 ? { dependencyTaskIds } : {}),
    ...(handoffState === 'blocked'
      ? { blockerSummary: proofBlocked ? 'Completion proof is missing or stale.' : blockerSummaryForTask(task) }
      : {}),
    sourceRefs: sourceRefsForTask(task),
  })
}

function buildChildMap(tasks: readonly Task[]): Map<string, string[]> {
  const tasksById = new Set(tasks.map(task => task.id))
  const childIdsByParent = new Map<string, Set<string>>()
  const addChild = (parentId: string, childId: string) => {
    const set = childIdsByParent.get(parentId) ?? new Set<string>()
    set.add(childId)
    childIdsByParent.set(parentId, set)
  }
  for (const task of tasks) {
    for (const childId of task.hierarchy?.childIds ?? []) {
      if (tasksById.has(childId)) addChild(task.id, childId)
    }
    const parentId = task.hierarchy?.parentId?.trim()
    if (parentId && tasksById.has(parentId)) addChild(parentId, task.id)
  }
  return new Map([...childIdsByParent].map(([parentId, childIds]) => [parentId, [...childIds]]))
}

function hierarchyRoleFor(task: Task, childIdsByParent: ReadonlyMap<string, string[]>): ProjectScopeHierarchyRole {
  if (task.hierarchy?.parentId) return 'child'
  return (task.hierarchy?.childIds?.length ?? 0) > 0 || (childIdsByParent.get(task.id)?.length ?? 0) > 0
    ? 'parent'
    : 'root'
}

function handoffStateForTask(
  task: Task,
  input: {
    scope: 'included' | 'deferred'
    tasksById: ReadonlyMap<string, Task>
    childIdsByParent: ReadonlyMap<string, string[]>
    selectedScope: ProjectScope | null
  },
): ProjectScopeHandoffState {
  if (input.scope === 'deferred') return 'deferred'
  const status = effectiveTaskStatus(task) ?? task.status
  if (status === 'shelved') return 'deferred'
  if (status === 'blocked') return 'blocked'
  if (status === 'done' || status === 'pending_pr') return 'done'
  if (status === 'in_progress') return 'paused'
  if (status === 'review' || status === 'gate_check') return 'review'
  if (status === 'spec_review') {
    return specReviewNeedsRepair(task) ? 'spec_shaping' : 'spec_review'
  }
  if (status === 'exploring' && productBriefRequiresOwnerApproval(task) && !hasSpecDraft(task)) {
    return 'brief_cleanup'
  }
  if (status === 'exploring' && hasApprovedCompleteBrief(task) && !hasSpecDraft(task)) return 'spec_shaping'
  if (status === 'ready') {
    if (isReadyForWorkerHandoff(task) || hasInScopeMaterializedChildWork(task, input)) return 'ready'
    return 'brief_cleanup'
  }
  return 'not_shaped'
}

function completionProofBlockedForTask(
  task: Task,
  suppressedProofTaskIds: ReadonlySet<string>,
  requiresScriptProof: boolean,
  tasksById: ReadonlyMap<string, Task>,
  childIdsByParent: ReadonlyMap<string, string[]>,
  selectedScope: ProjectScope | null,
): boolean {
  const status = effectiveTaskStatus(task) ?? task.status
  const proofStyle = requiresScriptProof ? 'script_only' as const : undefined
  return !suppressedProofTaskIds.has(task.id) &&
    (status === 'done' || status === 'pending_pr') &&
    taskDoneButProofMissingForScope(task, proofStyle) &&
    !taskCompletionProofSatisfiedByLinkedChildrenAtIndex(
      task,
      tasksById,
      childIdsByParent,
      proofStyle,
      selectedScope,
      new Set<string>(),
    )
}

function duplicateProofMissingTaskIds(
  tasks: readonly Task[],
  selectedScope: ProjectScope | null,
  tasksById: ReadonlyMap<string, Task>,
  requiresScriptProof: boolean,
): Set<string> {
  const scopedTasks = tasks.filter(task => taskScopeEligibility(task, selectedScope, { tasksById }).eligible)
  const blockedScopedTasks = scopedTasks.filter(task => (effectiveTaskStatus(task) ?? task.status) === 'blocked')
  const result = new Set<string>()
  for (const task of scopedTasks) {
    const status = effectiveTaskStatus(task) ?? task.status
    if (status !== 'done' || !taskDoneButProofMissingForScope(task, requiresScriptProof ? 'script_only' : undefined)) continue
    if (taskCompletionProofSatisfiedByLinkedChildren(task, tasks, requiresScriptProof ? 'script_only' : undefined, selectedScope)) continue
    const duplicateOwner = blockedScopedTasks.find(blocked =>
      blocked.id !== task.id &&
      explicitTaskStructuralIdentity(blocked) !== null &&
      explicitTaskStructuralIdentity(blocked) === explicitTaskStructuralIdentity(task),
    )
    if (duplicateOwner) result.add(task.id)
  }
  return result
}

function taskCompletionProofSatisfiedByLinkedChildrenAtIndex(
  task: Task,
  tasksById: ReadonlyMap<string, Task>,
  childIdsByParent: ReadonlyMap<string, string[]>,
  proofStyle: 'script_only' | 'manual' | 'mixed' | 'unspecified' | null | undefined,
  selectedScope: ProofScope | null | undefined,
  visiting: Set<string>,
): boolean {
  if (visiting.has(task.id)) return false
  visiting.add(task.id)
  const childIds = childIdsByParent.get(task.id) ?? []
  const children = childIds
    .map(childId => tasksById.get(childId))
    .filter((child): child is Task => Boolean(child))
    .filter(child => isMaterializedExecutionChild(task, child))
    .filter(child => proofChildBelongsToSelectedScope(child, selectedScope))
    .filter(child => !['archived', 'cancelled'].includes(String(child.status ?? '')))
  if (children.length === 0) return false
  return children.every(child => {
    const status = effectiveTaskStatus(child) ?? child.status
    if (status !== 'done' && status !== 'pending_pr') return false
    if (!taskDoneButProofMissingForScope(child, proofStyle)) return true
    return taskCompletionProofSatisfiedByLinkedChildrenAtIndex(
      child,
      tasksById,
      childIdsByParent,
      proofStyle,
      selectedScope,
      new Set(visiting),
    )
  })
}

function hasInScopeMaterializedChildWork(
  task: Task,
  input: {
    tasksById: ReadonlyMap<string, Task>
    childIdsByParent: ReadonlyMap<string, string[]>
    selectedScope: ProjectScope | null
  },
): boolean {
  return (input.childIdsByParent.get(task.id) ?? [])
    .map(childId => input.tasksById.get(childId))
    .some((child): child is Task => {
      if (!child || ['archived', 'cancelled', 'shelved'].includes(child.status)) return false
      return taskScopeEligibility(child, input.selectedScope, { tasksById: input.tasksById }).eligible
    })
}

function humanBlockingFor(task: Task, handoffState: ProjectScopeHandoffState, scope: 'included' | 'deferred'): boolean {
  if (scope === 'deferred') return false
  // Imported and actively exploring work belongs to Guildhall's planning lane.
  // A proposed task is different: it still represents an owner decision about
  // whether that candidate belongs in the plan.
  if (handoffState === 'spec_shaping') return false
  if (handoffState === 'not_shaped' && (task.status === 'exploring' || task.status === 'import_draft')) return false
  if (handoffState === 'not_shaped') return true
  if (handoffState === 'brief_cleanup' || handoffState === 'blocked') return true
  return handoffState === 'spec_review' && specReviewIsReadyForOwnerApproval(task)
}

function blockerSummaryForTask(task: Task): string {
  const blockReason = taskBlockerSummary(task)
  if (blockReason) return blockReason
  const openEscalation = (task.escalations ?? [])
    .filter(escalation => !escalation.resolvedAt)
    .slice()
    .sort((left, right) => (right.raisedAt ?? '').localeCompare(left.raisedAt ?? ''))[0]
  return openEscalation?.summary?.trim() || 'Blocked before unattended work can run.'
}

function isProjectSetupTask(taskId: string): boolean {
  return taskId === META_INTAKE_TASK_ID || taskId === WORKSPACE_IMPORT_TASK_ID
}

function isReadyForWorkerHandoff(task: Task): boolean {
  return hasSpecDraft(task) || hasApprovedCompleteBrief(task)
}

function hasSpecDraft(task: Task): boolean {
  return Boolean(task.spec?.trim()) && Array.isArray(task.acceptanceCriteria) && task.acceptanceCriteria.length > 0
}

function hasApprovedCompleteBrief(task: Task): boolean {
  const brief = task.productBrief
  if (!brief?.approvedAt) return false
  return hasCompleteBrief(task)
}

function hasCompleteBrief(task: Task): boolean {
  const brief = task.productBrief
  if (!brief) return false
  return Boolean(
    brief.userJob?.trim() &&
    brief.whyItMattersNow?.trim() &&
    brief.successMetric?.trim() &&
    ((brief.nonGoals?.length ?? 0) > 0 || (brief.antiPatterns?.length ?? 0) > 0),
  )
}

function productBriefRequiresOwnerApproval(task: Task): boolean {
  return hasCompleteBrief(task) &&
    !task.productBrief?.approvedAt &&
    task.productBrief?.authoredBy !== 'coordinator-recovery' &&
    task.taskReadiness?.recommendation !== 'needs_research_spike'
}

function sourceRefsForTask(task: Task): string[] {
  const refs = [
    ...(task.references ?? []),
    ...((task.sourceClaims ?? []).flatMap(claim => claim.references ?? [])),
    ...explicitMarkdownSourceRefsFromTask(task),
  ].filter(ref => ref.trim().length > 0)
  return refs.length > 0 ? refs : [`task:${task.id}`]
}

export function summarizeExecutionScopeRows(rows: readonly ProjectScopeRow[]): ProjectScopeProjection['counts'] {
  const counted = executionRows(rows)
  const included = counted.filter(row => row.scope === 'included')
  return {
    included: included.length,
    deferred: counted.filter(row => row.scope === 'deferred').length,
    ready: included.filter(row => row.handoffState === 'ready').length,
    paused: included.filter(row => row.handoffState === 'paused').length,
    active: included.filter(row => row.handoffState === 'paused' || row.handoffState === 'review').length,
    done: included.filter(row => row.handoffState === 'done').length,
    ownerBlocked: included.filter(projectScopeRowNeedsOwnerInput).length,
    proofBlocked: included.filter(row => row.proofBlocked).length,
    humanBlocking: included.filter(projectScopeRowNeedsOwnerInput).length,
  }
}

type ExecutionScopeRowLike = {
  taskId: string
  scope: 'included' | 'deferred'
  countInProjectTotals?: boolean
  parentTaskId?: string
  handoffState: string
  hierarchyRole: string
}

export function executionScopeRows<T extends ExecutionScopeRowLike>(rows: readonly T[]): T[] {
  const visibleChildParentIds = new Set(
    rows
      .filter(row => row.parentTaskId && row.countInProjectTotals !== false)
      .map(row => row.parentTaskId!),
  )
  const activePlanningChildParentIds = new Set(
    rows
      .filter(row => row.parentTaskId && row.countInProjectTotals === false && row.handoffState !== 'done' && row.handoffState !== 'deferred')
      .map(row => row.parentTaskId!),
  )
  return rows.filter(row =>
    (row.countInProjectTotals !== false || (
      row.parentTaskId !== undefined &&
      row.handoffState !== 'done' &&
      row.handoffState !== 'deferred'
    )) &&
    (row.hierarchyRole !== 'parent' || !(
      visibleChildParentIds.has(row.taskId) ||
      activePlanningChildParentIds.has(row.taskId)
    )),
  )
}

const executionRows = executionScopeRows

export function summarizeProjectScopeStart(
  rows: readonly ProjectScopeRow[],
  selectedScope: ProjectScope | null,
  setupTask?: Pick<Task, 'id' | 'title' | 'status'>,
): ProjectScopeProjection['start'] {
  const included = executionRows(rows).filter(row => row.scope === 'included')
  const paused = included.find(row => row.handoffState === 'paused')
  if (paused) {
    return {
      canStart: true,
      code: 'paused_live_work',
      label: 'Resume',
      focusTaskId: paused.taskId,
      focusTaskTitle: paused.title,
      focusKind: 'paused_work',
      message: `"${paused.title}" is paused in live work. Resume continues from that pinned task.`,
      actionHref: `/work?task=${encodeURIComponent(paused.taskId)}`,
    }
  }
  // An exploring task is already in Guildhall's shaping lane. Let Start run
  // that agent work before unrelated ready work. It is the live continuation
  // of the selected scope, not merely another candidate in a task ranking.
  const shapingWork = included.find(row => !row.dependencyBlocked && (
    row.handoffState === 'spec_shaping' ||
    (row.status === 'exploring' && row.handoffState === 'not_shaped')
  ))
  if (shapingWork) {
    return {
      canStart: true,
      code: 'ready_work',
      label: 'Start',
      focusTaskId: shapingWork.taskId,
      focusTaskTitle: shapingWork.title,
      focusKind: 'ready_work',
      message: shapingWork.status === 'spec_review'
        ? `Guildhall will repair the spec for "${shapingWork.title}" before asking for your review.`
        : shapingWork.handoffState === 'spec_shaping'
          ? `Guildhall is shaping a source-backed spec for "${shapingWork.title}".`
        : `Guildhall is shaping "${shapingWork.title}" from the visible project sources.`,
      actionHref: `/work?task=${encodeURIComponent(shapingWork.taskId)}`,
    }
  }
  const briefReview = included.find(row =>
    !row.dependencyBlocked &&
    row.status === 'exploring' &&
    row.handoffState === 'brief_cleanup' &&
    row.humanBlocking,
  )
  if (briefReview) {
    return {
      canStart: false,
      code: 'owner_input_required',
      label: 'Review',
      focusTaskId: briefReview.taskId,
      focusTaskTitle: briefReview.title,
      focusKind: 'brief_cleanup',
      message: `"${briefReview.title}" has a drafted brief ready for review. Approve it or request changes before Guildhall continues shaping.`,
      actionHref: `/thread?thread=${encodeURIComponent(`task:${briefReview.taskId}`)}`,
    }
  }
  const ready = included.find(row => !row.dependencyBlocked && row.handoffState === 'ready')
  if (ready) {
    return {
      canStart: true,
      code: 'ready_work',
      label: 'Start',
      focusTaskId: ready.taskId,
      focusTaskTitle: ready.title,
      focusKind: 'ready_work',
      message: `"${ready.title}" is ready to run.`,
      actionHref: `/work?task=${encodeURIComponent(ready.taskId)}`,
    }
  }
  const specWork = included.find(row => !row.dependencyBlocked && row.handoffState === 'spec_review' && !row.humanBlocking)
  if (specWork) {
    return {
      canStart: true,
      code: 'ready_work',
      label: 'Start',
      focusTaskId: specWork.taskId,
      focusTaskTitle: specWork.title,
      focusKind: 'ready_work',
      message: `"${specWork.title}" is ready for spec work.`,
      actionHref: `/work?task=${encodeURIComponent(specWork.taskId)}`,
    }
  }
  // Review work is already executable. Do not send the owner to a later task
  // which is only waiting on that review.
  const reviewWork = included.find(row => !row.dependencyBlocked && row.handoffState === 'review')
  if (reviewWork) {
    return {
      canStart: true,
      code: 'ready_work',
      label: 'Start',
      focusTaskId: reviewWork.taskId,
      focusTaskTitle: reviewWork.title,
      focusKind: 'ready_work',
      message: `"${reviewWork.title}" is ready to continue review.`,
      actionHref: `/work?task=${encodeURIComponent(reviewWork.taskId)}`,
    }
  }
  const blocked = included.find(row => row.handoffState === 'blocked' || row.dependencyBlocked)
  if (blocked) {
    const dependencyReview = blocked.dependencyTaskIds
      ?.map(taskId => included.find(row => row.taskId === taskId))
      .find(row => row && !row.dependencyBlocked && row.handoffState === 'spec_review' && row.humanBlocking)
    if (dependencyReview) {
      return {
        canStart: false,
        code: 'no_unattended_progress',
        label: 'Review',
        focusTaskId: dependencyReview.taskId,
        focusTaskTitle: dependencyReview.title,
        focusKind: 'spec_review',
        count: 1,
        message: `"${dependencyReview.title}" is waiting for review before work can start.`,
        actionHref: `/thread?thread=${encodeURIComponent(`task:${dependencyReview.taskId}`)}`,
      }
    }
    const count = included.filter(row => row.handoffState === 'blocked' || row.dependencyBlocked).length
    const dependencyTitle = blocked.dependencyTaskIds?.[0]
      ? included.find(row => row.taskId === blocked.dependencyTaskIds?.[0])?.title ?? blocked.dependencyTaskIds[0]
      : null
    const reason = blocked.blockerSummary?.trim() || (dependencyTitle ? `waiting for "${dependencyTitle}"` : '')
    return {
      canStart: false,
      code: 'no_unattended_progress',
      label: 'Review',
      focusTaskId: blocked.taskId,
      focusTaskTitle: blocked.title,
      focusKind: 'blocked_work',
      count,
      message: count === 1
        ? `"${blocked.title}" is blocked before unattended work can run${reason ? `: ${reason}` : '.'}`
        : `${count} work items are blocked before unattended work can run. Start with "${blocked.title}".`,
      actionHref: `/work?task=${encodeURIComponent(blocked.taskId)}`,
    }
  }
  const proofBlocked = included.find(row => row.proofBlocked)
  if (proofBlocked) {
    const count = included.filter(row => row.proofBlocked).length
    return {
      canStart: false,
      code: 'proof_evidence_missing',
      label: 'Review',
      focusTaskId: proofBlocked.taskId,
      focusTaskTitle: proofBlocked.title,
      focusKind: 'proof',
      count,
      message: count === 1
        ? `"${proofBlocked.title}" is complete but its completion proof is missing or stale.`
        : `${count} completed work items are missing current completion proof. Start with "${proofBlocked.title}".`,
      actionHref: `/work?task=${encodeURIComponent(proofBlocked.taskId)}`,
    }
  }
  const briefCleanup = included.find(row => row.handoffState === 'brief_cleanup' || row.handoffState === 'not_shaped')
  if (briefCleanup) {
    const count = included.filter(row => row.handoffState === 'brief_cleanup' || row.handoffState === 'not_shaped').length
    return {
      canStart: false,
      code: 'no_unattended_progress',
      label: 'Review',
      focusTaskId: briefCleanup.taskId,
      focusTaskTitle: briefCleanup.title,
      focusKind: 'brief_cleanup',
      count,
      message: count === 1
        ? `"${briefCleanup.title}" needs a clearer brief before unattended work can run.`
        : `${count} tasks still need fuller briefs before unattended work can run. Start with "${briefCleanup.title}".`,
      actionHref: `/work?task=${encodeURIComponent(briefCleanup.taskId)}`,
    }
  }
  const specReview = included.find(row => !row.dependencyBlocked && row.handoffState === 'spec_review' && row.humanBlocking)
  if (specReview) {
    const count = included.filter(row => !row.dependencyBlocked && row.handoffState === 'spec_review' && row.humanBlocking).length
    return {
      canStart: false,
      code: 'no_unattended_progress',
      label: 'Review',
      focusTaskId: specReview.taskId,
      focusTaskTitle: specReview.title,
      focusKind: 'spec_review',
      count,
      message: count === 1
        ? `"${specReview.title}" is waiting for review before work can start.`
        : `${count} specs are waiting for review before work can start. Start with "${specReview.title}".`,
      actionHref: `/thread?thread=${encodeURIComponent(`task:${specReview.taskId}`)}`,
    }
  }
  if (setupTask) {
    const isWorkspaceImport = setupTask.id === WORKSPACE_IMPORT_TASK_ID
    const title = taskDisplayLabel(setupTask, setupTask.id)
    return {
      canStart: false,
      code: isWorkspaceImport ? 'workspace_import_pending' : 'project_intake_pending',
      label: 'Configure',
      focusTaskId: setupTask.id,
      focusTaskTitle: title,
      focusKind: 'setup',
      message: isWorkspaceImport
        ? 'Review the project documents and confirm the current scope before running work.'
        : 'Finish the project intake before running work.',
      actionHref: isWorkspaceImport ? '/workspace-import' : '/setup',
    }
  }
  const scopeLabel = selectedScope?.label ?? 'Current work'
  const outsideWork = summarizeProjectScopeOutsideWork(rows, selectedScope)
  if (outsideWork.count > 0) {
    return {
      canStart: false,
      code: 'all_terminal',
      label: 'Review',
      focusKind: 'terminal',
      // Start is bounded to the selected release. Work assigned to a later
      // scope is orientation information, not a reason to change the action
      // or imply that Start will cross the release boundary.
      message: `${scopeLabel} has no runnable work remaining.`,
      actionHref: '/work',
    }
  }
  return {
    canStart: false,
    code: 'all_terminal',
    label: 'Review',
    focusKind: 'terminal',
    message: `${scopeLabel} has no runnable work remaining.`,
    actionHref: '/work',
  }
}

export function summarizeProjectScopeRelease(rows: readonly ProjectScopeRow[]): ProjectScopeProjection['release'] {
  // Internal steps can be executable without becoming visible release work.
  // The parent product task remains the release boundary and carries any
  // proof debt; otherwise a recovery child would inflate totals or make a
  // release appear to regress from completed to unfinished.
  const included = executionRows(rows)
    .filter(row => row.scope === 'included' && row.countInProjectTotals !== false)
  const blockers = included
    .filter(row => row.blocksRelease)
    .map(row => ({
      id: row.taskId,
      owningTaskId: row.taskId,
      label: blockerLabelFor(row),
      code: blockerCodeFor(row),
    }))
  if (blockers.length > 0) {
    const shapingOnly = blockers.every(blocker => {
      const row = included.find(candidate => candidate.taskId === blocker.owningTaskId)
      return row ? projectScopeRowIsGuildhallShaping(row) : false
    })
    return { state: shapingOnly ? 'shaping' : 'blocked', blockers }
  }
  if (included.length === 0) return { state: 'unknown', blockers: [] }
  if (included.every(row => row.handoffState === 'done')) return { state: 'ready', blockers: [] }
  if (included.some(row => row.handoffState === 'not_shaped' || row.handoffState === 'spec_shaping' || row.handoffState === 'brief_cleanup')) return { state: 'shaping', blockers: [] }
  if (included.some(row => row.handoffState === 'ready' || row.handoffState === 'paused' || row.handoffState === 'review' || row.handoffState === 'spec_review')) {
    return { state: 'active', blockers: [] }
  }
  return { state: 'unknown', blockers: [] }
}

function blockerLabelFor(row: ProjectScopeRow): string {
  const title = row.title.replace(/[.!?]+$/, '')
  if (row.proofBlocked) return `${title}: completion proof is missing or stale.`
  if (row.handoffState === 'spec_shaping') return `${title}: Guildhall is shaping a source-backed spec.`
  if (row.handoffState === 'brief_cleanup' || row.handoffState === 'not_shaped') {
    return `${title}: needs a clearer brief before unattended work can run.`
  }
  if (row.handoffState === 'spec_review') return `${title}: waiting for review before work can start.`
  if (row.handoffState === 'blocked') return `${title}: ${row.blockerSummary ?? 'blocked.'}`
  return `${title}: needs attention.`
}

function blockerCodeFor(row: ProjectScopeRow): string {
  if (row.proofBlocked) return 'proof_evidence_missing'
  if (row.handoffState === 'spec_shaping') return 'source_backed_spec_shaping'
  if (row.handoffState === 'brief_cleanup' || row.handoffState === 'not_shaped') return 'imported_scope_shaping'
  if (row.handoffState === 'spec_review') return 'spec_review_required'
  if (row.handoffState === 'blocked') return 'blocked'
  return 'attention'
}
