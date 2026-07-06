import type { ProjectRelease, Task, TaskQueue, TaskStatus } from '@guildhall/core'
import { taskDisplayLabel } from '../shared/task-display-label.js'
import { deriveTaskWorkVisibility } from './work-visibility.js'
import { META_INTAKE_TASK_ID } from './meta-intake.js'
import { WORKSPACE_IMPORT_TASK_ID } from './workspace-importer.js'
import { specReviewRequiresOwnerApproval } from './spec-review-ownership.js'
import { taskHasRecordedCompletionProof } from './task-completion-proof.js'

export type ProjectScopeKind = 'release' | 'milestone' | 'proposed_feature_set'
export type ProjectScopeSource = 'owner_approved' | 'spec' | 'release_plan' | 'inferred'
export type ProjectScopeEligibilityReason = 'included' | 'included_ancestor' | 'included_prerequisite' | 'deferred' | 'no_scope'
export type ProjectScopeHierarchyRole = 'root' | 'parent' | 'child'
export type ProjectScopeHandoffState =
  | 'not_shaped'
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
}

export interface ProjectScopeRow {
  taskId: string
  title: string
  parentTaskId?: string
  scope: 'included' | 'deferred'
  eligibilityReason: ProjectScopeEligibilityReason
  hierarchyRole: ProjectScopeHierarchyRole
  status: TaskStatus
  handoffState: ProjectScopeHandoffState
  blocksStart: boolean
  blocksRelease: boolean
  humanBlocking: boolean
  sourceRefs: string[]
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
    label: 'Start' | 'Resume' | 'Review' | 'Configure'
    focusTaskId?: string
    focusTaskTitle?: string
    focusKind?: 'paused_work' | 'ready_work' | 'spec_review' | 'brief_cleanup' | 'provider' | 'terminal'
    count?: number
    message: string
    actionHref: string
  }
  release: {
    state: 'ready' | 'blocked' | 'active' | 'shaping' | 'unknown'
    blockers: Array<{ id: string; label: string; owningTaskId?: string }>
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
  hierarchy?: { parentId?: string; childIds?: string[] }
}

export function taskScopeNodeId(taskId: string): string {
  return `work:${taskId}`
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
    const nodeIds = new Set(existing?.nodeIds ?? [])
    const deferredNodeIds = new Set(existing?.deferredNodeIds ?? [])
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
      } else if (assigned || listed) {
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
  const derived = (queue.releases ?? []).length > 0
    ? null
    : deriveReleaseContainersFromTaskMembership(queue.tasks)
  const releases = derived?.releases ?? queue.releases ?? []
  if (releases.length === 0) return null
  const selectedReleaseId = queue.selectedReleaseId ?? derived?.selectedReleaseId
  const release =
    releases.find(candidate => candidate.id === selectedReleaseId) ??
    releases.find(candidate => candidate.state === 'active') ??
    releases.find(candidate => candidate.state === 'planned') ??
    releases[0]
  if (!release) return null
  return releaseToProjectScope(release, queue.tasks)
}

export function releaseToProjectScope(release: ProjectRelease, tasks: readonly Task[]): ProjectScope {
  const nodeIds = new Set<string>(release.nodeIds ?? [])
  const deferredNodeIds = new Set<string>(release.deferredNodeIds ?? [])
  for (const task of tasks) {
    const nodeId = taskScopeNodeId(task.id)
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
      if (task.releaseIds?.includes(release.id) || deferredNodeIds.has(nodeId)) deferredNodeIds.add(nodeId)
      continue
    }
    const taskReleaseIds = task.releaseIds ?? []
    if (taskReleaseIds.length === 0 && task.hierarchy?.parentId) continue
    if (taskReleaseIds.length === 0) continue
    if (taskReleaseIds.includes(release.id)) {
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
  if (!scope) return { eligible: true, reason: 'no_scope' }
  const nodeId = taskScopeNodeId(task.id)
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
  queue: Pick<TaskQueue, 'tasks' | 'releases' | 'selectedReleaseId'>,
  options: BuildProjectScopeProjectionOptions = {},
): ProjectScopeProjection {
  const selectedScope = normalizeSelectedScope(
    'selectedScope' in options ? options.selectedScope ?? null : selectedProjectScopeForQueue(queue),
    queue.tasks,
  )
  const tasksById = new Map(queue.tasks.map(task => [task.id, task] as const))
  const childIdsByParent = buildChildMap(queue.tasks)
  const rows = queue.tasks
    .map(task => buildScopeRow(task, {
      selectedScope,
      tasksById,
      childIdsByParent,
      includedDependencyIds: options.includedDependencyIds,
    }))
    .filter((row): row is ProjectScopeRow => Boolean(row))
  const counts = summarizeRows(rows)
  return {
    selectedScope,
    rows,
    counts,
    start: summarizeStart(rows, selectedScope),
    release: summarizeRelease(rows),
  }
}

function normalizeSelectedScope(scope: ProjectScope | null, tasks: readonly Task[]): ProjectScope | null {
  if (!scope) return null
  const nodeIds = new Set(scope.nodeIds)
  const deferredNodeIds = new Set(scope.deferredNodeIds)
  const tasksById = new Map(tasks.map(task => [task.id, task] as const))
  const childIdsByParent = buildChildMap(tasks)
  const dropMaterializedImportPreview = (nodeId: string): boolean => {
    const syntheticPrefix = 'work:workspace-import:'
    return nodeId.startsWith(syntheticPrefix) && tasksById.has(nodeId.slice(syntheticPrefix.length))
  }
  for (const nodeId of [...nodeIds]) {
    if (dropMaterializedImportPreview(nodeId)) nodeIds.delete(nodeId)
  }
  for (const nodeId of [...deferredNodeIds]) {
    if (dropMaterializedImportPreview(nodeId)) deferredNodeIds.delete(nodeId)
  }
  for (const task of tasks) {
    const nodeId = taskScopeNodeId(task.id)
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
      if (deferredNodeIds.has(nodeId)) deferredNodeIds.add(nodeId)
      continue
    }
    const parent = task.hierarchy?.parentId ? tasksById.get(task.hierarchy.parentId) ?? null : null
    if (task.releaseIds?.includes(scope.id)) {
      if (!deriveTaskWorkVisibility(task, parent).countInProjectTotals) {
        nodeIds.delete(nodeId)
        deferredNodeIds.delete(nodeId)
        continue
      }
      nodeIds.add(nodeId)
      continue
    }
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

function buildScopeRow(
  task: Task,
  input: {
    selectedScope: ProjectScope | null
    tasksById: ReadonlyMap<string, Task>
    childIdsByParent: ReadonlyMap<string, string[]>
    includedDependencyIds?: ReadonlySet<string>
  },
): ProjectScopeRow | null {
  if (isProjectSetupTask(task.id) || task.status === 'archived' || task.status === 'cancelled') return null
  const parent = task.hierarchy?.parentId ? input.tasksById.get(task.hierarchy.parentId) ?? null : null
  if (!deriveTaskWorkVisibility(task, parent).countInProjectTotals) return null
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
  const humanBlocking = humanBlockingFor(task, handoffState, scope)
  return {
    taskId: task.id,
    title: taskDisplayLabel(task, task.id),
    ...(parent ? { parentTaskId: parent.id } : {}),
    scope,
    eligibilityReason: eligibility.reason,
    hierarchyRole: role,
    status: task.status,
    handoffState,
    blocksStart: scope === 'included' && humanBlocking,
    blocksRelease: scope === 'included' && (humanBlocking || handoffState === 'blocked'),
    humanBlocking,
    sourceRefs: sourceRefsForTask(task),
  }
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
  if (task.status === 'shelved') return 'deferred'
  if (taskHasRecordedCompletionProof(task)) return 'done'
  if (task.status === 'blocked') return 'blocked'
  if (task.status === 'done' || task.status === 'pending_pr') return 'done'
  if (task.status === 'in_progress') return 'paused'
  if (task.status === 'review' || task.status === 'gate_check') return 'review'
  if (task.status === 'spec_review') return 'spec_review'
  if (task.status === 'ready') {
    if (isReadyForWorkerHandoff(task) || hasInScopeMaterializedChildWork(task, input)) return 'ready'
    return 'brief_cleanup'
  }
  return 'not_shaped'
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
  if (handoffState === 'brief_cleanup' || handoffState === 'not_shaped' || handoffState === 'blocked') return true
  return handoffState === 'spec_review' && specReviewRequiresOwnerApproval(task)
}

function isProjectSetupTask(taskId: string): boolean {
  return taskId === META_INTAKE_TASK_ID || taskId === WORKSPACE_IMPORT_TASK_ID
}

function isReadyForWorkerHandoff(task: Task): boolean {
  return hasSpecDraft(task) || hasApprovedCompleteBrief(task)
}

function hasSpecDraft(task: Task): boolean {
  return Boolean(task.spec?.trim()) && task.acceptanceCriteria.length > 0
}

function hasApprovedCompleteBrief(task: Task): boolean {
  const brief = task.productBrief
  if (!brief?.approvedAt) return false
  return Boolean(
    brief.userJob?.trim() &&
    brief.whyItMattersNow?.trim() &&
    brief.successMetric?.trim() &&
    ((brief.nonGoals?.length ?? 0) > 0 || (brief.antiPatterns?.length ?? 0) > 0),
  )
}

function sourceRefsForTask(task: Task): string[] {
  const refs = task.references?.filter(ref => ref.trim().length > 0) ?? []
  return refs.length > 0 ? refs : [`task:${task.id}`]
}

function summarizeRows(rows: readonly ProjectScopeRow[]): ProjectScopeProjection['counts'] {
  const included = executionRows(rows).filter(row => row.scope === 'included')
  return {
    included: included.length,
    deferred: executionRows(rows).filter(row => row.scope === 'deferred').length,
    ready: included.filter(row => row.handoffState === 'ready').length,
    paused: included.filter(row => row.handoffState === 'paused').length,
    active: included.filter(row => row.handoffState === 'paused' || row.handoffState === 'review').length,
    done: included.filter(row => row.handoffState === 'done').length,
    ownerBlocked: included.filter(row => row.humanBlocking).length,
    proofBlocked: 0,
    humanBlocking: included.filter(row => row.humanBlocking).length,
  }
}

export function executionScopeRows(rows: readonly ProjectScopeRow[]): ProjectScopeRow[] {
  const visibleChildParentIds = new Set(
    rows
      .filter(row => row.parentTaskId && row.scope === 'included')
      .map(row => row.parentTaskId!),
  )
  return rows.filter(row => row.hierarchyRole !== 'parent' || !visibleChildParentIds.has(row.taskId))
}

const executionRows = executionScopeRows

function summarizeStart(rows: readonly ProjectScopeRow[], selectedScope: ProjectScope | null): ProjectScopeProjection['start'] {
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
  const ready = included.find(row => row.handoffState === 'ready')
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
  const specWork = included.find(row => row.handoffState === 'spec_review' && !row.humanBlocking)
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
  const specReview = included.find(row => row.handoffState === 'spec_review' && row.humanBlocking)
  if (specReview) {
    const count = included.filter(row => row.handoffState === 'spec_review' && row.humanBlocking).length
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
  const scopeLabel = selectedScope?.label ?? 'Current work'
  return {
    canStart: false,
    code: 'all_terminal',
    label: 'Review',
    focusKind: 'terminal',
    message: `${scopeLabel} has no runnable work remaining.`,
    actionHref: '/work',
  }
}

function summarizeRelease(rows: readonly ProjectScopeRow[]): ProjectScopeProjection['release'] {
  const included = executionRows(rows).filter(row => row.scope === 'included')
  const blockers = executionRows(rows)
    .filter(row => row.scope === 'included' && row.blocksRelease)
    .map(row => ({
      id: row.taskId,
      owningTaskId: row.taskId,
      label: blockerLabelFor(row),
    }))
  if (blockers.length > 0) return { state: 'blocked', blockers }
  if (included.length === 0) return { state: 'unknown', blockers: [] }
  if (included.every(row => row.handoffState === 'done')) return { state: 'ready', blockers: [] }
  if (included.some(row => row.handoffState === 'not_shaped' || row.handoffState === 'brief_cleanup')) return { state: 'shaping', blockers: [] }
  if (included.some(row => row.handoffState === 'ready' || row.handoffState === 'paused' || row.handoffState === 'review' || row.handoffState === 'spec_review')) {
    return { state: 'active', blockers: [] }
  }
  return { state: 'unknown', blockers: [] }
}

function blockerLabelFor(row: ProjectScopeRow): string {
  const title = row.title.replace(/[.!?]+$/, '')
  if (row.handoffState === 'brief_cleanup' || row.handoffState === 'not_shaped') {
    return `${title}: needs a clearer brief before unattended work can run.`
  }
  if (row.handoffState === 'spec_review') return `${title}: waiting for review before work can start.`
  if (row.handoffState === 'blocked') return `${title}: blocked.`
  return `${title}: needs attention.`
}
