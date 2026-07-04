import type { Task } from '@guildhall/core'
import { buildWorkHierarchy, needsOwnerAction, workSubtreeIds } from './work-hierarchy.js'
import { deriveProjectWorkProgress } from './work-progress.js'
import { deriveTaskWorkVisibility } from './work-visibility.js'

export type WorkExecutionSummaryState =
  | 'ready'
  | 'running'
  | 'blocked'
  | 'needs_decomposition'
  | 'waiting_on_scope_authority'
  | 'complete'
  | 'deferred'

export interface WorkExecutionState {
  workId: string
  isContaining: boolean
  isRunnable: boolean
  runnableChildIds: string[]
  visibleChildIds: string[]
  internalChildIds: string[]
  blockedChildIds: string[]
  activeChildIds: string[]
  terminalChildIds: string[]
  requiredDeliveryTotal: number
  requiredDeliveryDone: number
  missingProofCount: number
  executionPlanning: {
    needsDecomposition: boolean
    pendingActionIds: string[]
    failedActionIds: string[]
    legacyRecommendationCount: number
  }
  scopeAuthority: {
    needsOwnerDecision: boolean
    requestIds: string[]
  }
  summaryState: WorkExecutionSummaryState
}

export interface ProjectWorkExecutionState {
  counts: {
    visibleTotal: number
    internalTotal: number
    runnableTotal: number
    needsDecomposition: number
    ownerDecisionTotal: number
  }
  byTaskId: Record<string, WorkExecutionState>
}

const ACTIVE_STATUSES = new Set(['ready', 'in_progress', 'review', 'gate_check', 'exploring', 'spec_review', 'proposed'])
const RUNNING_STATUSES = new Set(['in_progress', 'review', 'gate_check'])
const BLOCKED_STATUSES = new Set(['blocked'])
const TERMINAL_STATUSES = new Set(['done', 'pending_pr', 'shelved'])
const DONE_STATUSES = new Set(['done', 'pending_pr'])
const DEFERRED_STATUSES = new Set(['shelved'])
const DECOMPOSE_ACTIONS = new Set(['split_required', 'split_recommended', 'decompose_before_execution'])

export function deriveProjectWorkExecutionState(tasks: Task[]): ProjectWorkExecutionState {
  const progress = deriveProjectWorkProgress(tasks)
  const byTaskId: Record<string, WorkExecutionState> = {}
  const counts: ProjectWorkExecutionState['counts'] = {
    visibleTotal: 0,
    internalTotal: 0,
    runnableTotal: 0,
    needsDecomposition: 0,
    ownerDecisionTotal: 0,
  }

  for (const task of tasks) {
    const state = deriveWorkExecutionState(tasks, task.id)
    byTaskId[task.id] = state
    const visibility = progress.byTaskId[task.id]?.visibility ?? visibilityForTask(task, tasks)
    if (visibility.countInProjectTotals) counts.visibleTotal += 1
    if (visibility.kind === 'internal_step' || visibility.kind === 'hidden') counts.internalTotal += 1
    if (state.isRunnable) counts.runnableTotal += 1
    if (state.executionPlanning.needsDecomposition) counts.needsDecomposition += 1
    if (state.scopeAuthority.needsOwnerDecision) counts.ownerDecisionTotal += 1
  }

  return { counts, byTaskId }
}

export function deriveWorkExecutionState(tasks: Task[], workId: string): WorkExecutionState {
  const model = buildWorkHierarchy(tasks)
  const node = model.byId.get(workId)
  const task = node?.task ?? tasks.find(candidate => candidate.id === workId)
  if (!task) {
    return emptyState(workId)
  }

  const descendantIds = descendantsFor(tasks, workId)
  const descendants = descendantIds
    .map(id => model.byId.get(id)?.task ?? tasks.find(task => task.id === id))
    .filter((candidate): candidate is Task => Boolean(candidate))
  const visibleChildIds = descendants
    .filter(child => visibilityForTask(child, tasks).countInProjectTotals)
    .map(child => child.id)
  const internalChildIds = descendants
    .filter(child => {
      const visibility = visibilityForTask(child, tasks)
      return visibility.kind === 'internal_step' || visibility.kind === 'hidden' || !visibility.countInProjectTotals
    })
    .map(child => child.id)
  const blockedChildIds = descendants
    .filter(child => BLOCKED_STATUSES.has(child.status))
    .map(child => child.id)
  const activeChildIds = descendants
    .filter(child => ACTIVE_STATUSES.has(child.status) && !TERMINAL_STATUSES.has(child.status))
    .map(child => child.id)
  const terminalChildIds = descendants
    .filter(child => TERMINAL_STATUSES.has(child.status))
    .map(child => child.id)
  const legacyRecommendationCount = task.sizePlan?.recommendedChildren?.length ?? 0
  const isContaining = descendantIds.length > 0
  const needsDecomposition = !isContaining && DECOMPOSE_ACTIONS.has(task.sizePlan?.action ?? '')
  const scopeRequestIds = scopeAuthorityRequestIds(task)
  const needsOwnerDecision = needsOwnerAction(task) || scopeRequestIds.length > 0
  const childStates = descendants.map(child => deriveLeafRunnableState(tasks, child.id))
  const runnableChildIds = descendants
    .filter((child, index) => childStates[index])
    .map(child => child.id)
  const deliverySteps = task.deliverySteps ?? []
  const requiredDelivery = deliverySteps.filter(step => step.required !== false && step.blocksCompletion !== false)
  const requiredDeliveryDone = requiredDelivery.filter(step => step.status === 'done' || step.status === 'waived').length
  const blockedInternalProofCount = descendants.filter(child =>
    BLOCKED_STATUSES.has(child.status) &&
    (visibilityForTask(child, tasks).kind === 'internal_step' || child.workKind === 'verification' || child.workKind === 'test'),
  ).length
  const missingProofCount = blockedInternalProofCount + requiredDelivery.filter(step => step.status === 'blocked').length
  const isRunnable = deriveLeafRunnableState(tasks, task.id)

  return {
    workId,
    isContaining,
    isRunnable,
    runnableChildIds,
    visibleChildIds,
    internalChildIds,
    blockedChildIds,
    activeChildIds,
    terminalChildIds,
    requiredDeliveryTotal: requiredDelivery.length,
    requiredDeliveryDone,
    missingProofCount,
    executionPlanning: {
      needsDecomposition,
      pendingActionIds: [],
      failedActionIds: [],
      legacyRecommendationCount,
    },
    scopeAuthority: {
      needsOwnerDecision,
      requestIds: scopeRequestIds,
    },
    summaryState: summaryStateFor({
      task,
      needsDecomposition,
      needsOwnerDecision,
      blockedChildIds,
      activeChildIds,
      descendants,
    }),
  }
}

function deriveLeafRunnableState(tasks: Task[], workId: string): boolean {
  const task = tasks.find(candidate => candidate.id === workId)
  if (!task) return false
  if (descendantsFor(tasks, workId).length > 0) return false
  if (DECOMPOSE_ACTIONS.has(task.sizePlan?.action ?? '')) return false
  const visibility = visibilityForTask(task, tasks)
  if (visibility.kind === 'hidden') return false
  if (visibility.kind === 'internal_step' && !task.hierarchy?.parentId) return false
  if (!visibility.countInProjectTotals && visibility.kind !== 'internal_step') return false
  return ACTIVE_STATUSES.has(task.status) && !BLOCKED_STATUSES.has(task.status) && !TERMINAL_STATUSES.has(task.status)
}

function descendantsFor(tasks: Task[], workId: string): string[] {
  return workSubtreeIds(tasks, workId).filter(id => id !== workId)
}

function visibilityForTask(task: Task, tasks: Task[]): { kind: 'primary' | 'supporting' | 'internal_step' | 'hidden'; countInProjectTotals: boolean } {
  const parentId = task.hierarchy?.parentId?.trim() || null
  const parent = parentId ? tasks.find(candidate => candidate.id === parentId) ?? null : null
  return deriveTaskWorkVisibility(task, parent)
}

function scopeAuthorityRequestIds(task: Task): string[] {
  const raw = (task as unknown as { scopeAuthorityRequests?: Array<{ id?: unknown; status?: unknown }> }).scopeAuthorityRequests
  if (!Array.isArray(raw)) return []
  return raw
    .filter(request => request && request.status !== 'answered' && request.status !== 'withdrawn')
    .map(request => typeof request.id === 'string' && request.id.trim() ? request.id.trim() : null)
    .filter((id): id is string => Boolean(id))
}

function summaryStateFor(input: {
  task: Task
  needsDecomposition: boolean
  needsOwnerDecision: boolean
  blockedChildIds: string[]
  activeChildIds: string[]
  descendants: Task[]
}): WorkExecutionSummaryState {
  if (input.needsOwnerDecision) return 'waiting_on_scope_authority'
  if (input.needsDecomposition) return 'needs_decomposition'
  if (BLOCKED_STATUSES.has(input.task.status) || input.blockedChildIds.length > 0) return 'blocked'
  if (RUNNING_STATUSES.has(input.task.status) || input.activeChildIds.some(id => {
    const child = input.descendants.find(task => task.id === id)
    return child ? RUNNING_STATUSES.has(child.status) : false
  })) return 'running'
  if (DEFERRED_STATUSES.has(input.task.status)) return 'deferred'
  if (
    DONE_STATUSES.has(input.task.status) &&
    input.descendants.every(child => DONE_STATUSES.has(child.status) || DEFERRED_STATUSES.has(child.status))
  ) {
    return 'complete'
  }
  return 'ready'
}

function emptyState(workId: string): WorkExecutionState {
  return {
    workId,
    isContaining: false,
    isRunnable: false,
    runnableChildIds: [],
    visibleChildIds: [],
    internalChildIds: [],
    blockedChildIds: [],
    activeChildIds: [],
    terminalChildIds: [],
    requiredDeliveryTotal: 0,
    requiredDeliveryDone: 0,
    missingProofCount: 0,
    executionPlanning: {
      needsDecomposition: false,
      pendingActionIds: [],
      failedActionIds: [],
      legacyRecommendationCount: 0,
    },
    scopeAuthority: {
      needsOwnerDecision: false,
      requestIds: [],
    },
    summaryState: 'ready',
  }
}
