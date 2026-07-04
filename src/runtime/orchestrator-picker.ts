/**
 * Task selection for the orchestrator tick loop. Pulled out of
 * `orchestrator.ts` so the fanout dispatcher (FR-24) can share the same
 * priority/status ordering when picking multiple tasks per tick.
 *
 * Two public helpers:
 *
 *   • `pickNextTask(queue, domain?, exclude?)` — the classic single-task picker
 *     used by the serial tick path. Accepts an exclusion set so the fanout
 *     picker can iterate without duplicating logic.
 *   • `needsPreRejectionPolicy(task)` — helper used by both the picker and the
 *     tick routing switch so the "pure policy decisions come first" rule has
 *     one source of truth.
 */

import { type Task, type TaskQueue, type TaskStatus } from '@guildhall/core'
import { hasOpenEscalation } from '@guildhall/tools'
import { META_INTAKE_TASK_ID } from './meta-intake.js'
import { WORKSPACE_IMPORT_TASK_ID } from './workspace-importer.js'
import { taskHasUnansweredVisibleQuestion } from './question-visibility.js'
import { workSubtreeIds } from './work-hierarchy.js'
import { taskEligibleForSelectedScope, taskNodeId, type OrientationScope } from './project-orientation-spine.js'
import { selectedProjectScopeForQueue } from './project-scope-projection.js'
import { deriveWorkExecutionState } from './work-execution-state.js'

export type TaskLane = 'spec' | 'worker' | 'review' | 'coordinator'

export interface PickNextTaskOptions {
  scope?: OrientationScope | null
  includedDependencyIds?: ReadonlySet<string>
}

export function selectedReleaseScopeForQueue(queue: Pick<TaskQueue, 'tasks' | 'releases' | 'selectedReleaseId'>): OrientationScope | null {
  return selectedProjectScopeForQueue(queue)
}

export function selectedTaskScopeForQueue(
  queue: Pick<TaskQueue, 'tasks'>,
  membership: {
    currentTaskIds: string[]
    laterTaskIds: string[]
  } | null | undefined,
): OrientationScope | null {
  if (!membership) return null
  const currentTaskIds = membership.currentTaskIds
    .map(taskId => taskId.trim())
    .filter(Boolean)
  const laterTaskIds = membership.laterTaskIds
    .map(taskId => taskId.trim())
    .filter(Boolean)
  if (currentTaskIds.length === 0 && laterTaskIds.length === 0) return null

  const queueTaskIds = new Set(queue.tasks.map(task => task.id))
  const nodeIds = currentTaskIds
    .filter(taskId => queueTaskIds.has(taskId))
    .map(taskNodeId)
  const deferredNodeIds = laterTaskIds
    .filter(taskId => queueTaskIds.has(taskId))
    .map(taskNodeId)
  if (nodeIds.length === 0 && deferredNodeIds.length === 0) return null

  return {
    id: 'current-work',
    label: 'Current task scope',
    kind: 'proposed_feature_set',
    source: 'inferred',
    nodeIds,
    deferredNodeIds,
  }
}

function hasUnansweredOpenQuestion(task: Task): boolean {
  return taskHasUnansweredVisibleQuestion(task)
}

export function taskHasUnansweredOpenQuestion(task: Task): boolean {
  return hasUnansweredOpenQuestion(task)
}

export function specReviewRequiresOwnerApproval(task: Pick<Task, 'id'>): boolean {
  return task.id === META_INTAKE_TASK_ID || task.id === WORKSPACE_IMPORT_TASK_ID
}

function finishabilityAllowsDispatch(task: Task): boolean {
  return task.status !== 'ready' ||
    task.taskReadiness == null ||
    task.taskReadiness.recommendation === 'ready' ||
    task.taskReadiness.recommendation === 'needs_research_spike' ||
    hasCompleteWorkerHandoff(task)
}

function hasCompleteWorkerHandoff(task: Task): boolean {
  const brief = task.productBrief
  const approvedBrief = typeof brief?.approvedAt === 'string' && brief.approvedAt.trim().length > 0
  const spec = typeof task.spec === 'string' && task.spec.trim().length > 0
  const criteria = Array.isArray(task.acceptanceCriteria) && task.acceptanceCriteria.length > 0
  return approvedBrief && spec && criteria
}

function derivedExecutionAllowsDispatch(queue: TaskQueue, task: Task): boolean {
  return deriveWorkExecutionState(queue.tasks, task.id).isRunnable
}

/**
 * A worker-shelved task is "fresh" (needs `pre_rejection_policy` applied)
 * when its shelveReason records a worker pre-rejection the orchestrator has
 * not yet consulted the levers for.
 */
export function needsPreRejectionPolicy(task: Task): boolean {
  const r = task.shelveReason
  return (
    task.status === 'shelved' &&
    r != null &&
    r.source === 'worker_pre_rejection' &&
    !r.policyApplied
  )
}

export function laneForTask(task: Task): TaskLane | null {
  if (needsPreRejectionPolicy(task)) return 'coordinator'
  switch (task.status) {
    case 'proposed':
      return 'coordinator'
    case 'exploring':
    case 'spec_review':
      return 'spec'
    case 'ready':
    case 'in_progress':
      return 'worker'
    case 'review':
    case 'gate_check':
      return 'review'
    default:
      return null
  }
}

/**
 * A dependency edge means "this task cannot start until that task is done."
 * Missing dependencies are treated as unmet rather than silently ignored; the
 * planner/UI can surface that as a queue hygiene problem, but the runtime
 * should not dispatch blocked work.
 */
export function dependenciesSatisfied(queue: TaskQueue, task: Task): boolean {
  if (task.dependsOn.length === 0) return true
  return task.dependsOn.every((dependencyId) => {
    const dependency = queue.tasks.find((candidate) => candidate.id === dependencyId)
    return dependency?.status === 'done'
  })
}

function taskById(queue: TaskQueue, taskId: string): Task | undefined {
  return queue.tasks.find((candidate) => candidate.id === taskId)
}

/**
 * Highest-priority actionable task.
 *
 * The picker intentionally favors active work before fresh work: once a task
 * has entered implementation/review/gates, the outer loop keeps driving that
 * task toward a terminal state instead of claiming something new. This is the
 * small "one-task finisher" rule borrowed from Ralph/Beads-style workflows.
 */
export function pickNextTask(
  queue: TaskQueue,
  domain?: string,
  exclude?: ReadonlySet<string>,
  lane?: TaskLane,
  preferredTaskId?: string,
  options: PickNextTaskOptions = {},
): Task | undefined {
  const priority = ['critical', 'high', 'normal', 'low'] as const
  const scopedIds = preferredTaskId
    ? new Set(workSubtreeIds(queue.tasks, preferredTaskId))
    : null
  const explicitTargetIds = scopedIds ?? new Set<string>()
  const tasksById = new Map(queue.tasks.map(task => [task.id, task] as const))
  const isExcluded = exclude
    ? (t: Task) => exclude.has(t.id)
    : (_t: Task) => false
  const matchesScope = scopedIds
    ? (t: Task) => scopedIds.has(t.id)
    : (_t: Task) => true
  const matchesLane = lane
    ? (t: Task) => laneForTask(t) === lane
    : (_t: Task) => true
  const matchesOrientationScope = (task: Task): boolean =>
    taskEligibleForSelectedScope(task, options.scope, {
      explicitTaskId: explicitTargetIds.has(task.id) ? task.id : undefined,
      includedDependencyIds: options.includedDependencyIds,
      tasksById,
    }).eligible
  const matchesStatusSlot = (
    task: Task,
    status: TaskStatus,
    priorityLevel: (typeof priority)[number],
    opts: { respectScope?: boolean } = {},
  ): boolean =>
    task.status === status &&
    finishabilityAllowsDispatch(task) &&
    derivedExecutionAllowsDispatch(queue, task) &&
    !(task.status === 'spec_review' && Boolean(task.spec?.trim()) && specReviewRequiresOwnerApproval(task)) &&
    !((task.status === 'exploring' || task.status === 'spec_review') && hasUnansweredOpenQuestion(task)) &&
    matchesLane(task) &&
    task.priority === priorityLevel &&
    (!domain || task.domain === domain) &&
    (opts.respectScope === false || matchesScope(task)) &&
    matchesOrientationScope(task) &&
    dependenciesSatisfied(queue, task) &&
    !hasOpenEscalation(task) &&
    !isExcluded(task)

  const firstRunnableBlocker = (task: Task, seen = new Set<string>([task.id])): Task | undefined => {
    for (const dependencyId of task.dependsOn ?? []) {
      const dependency = taskById(queue, dependencyId)
      if (!dependency || dependency.status === 'done' || seen.has(dependency.id)) continue
      seen.add(dependency.id)

      const deeper = firstRunnableBlocker(dependency, seen)
      if (deeper) return deeper

      for (const status of [...activeStatuses, ...freshStatuses]) {
        for (const p of priority) {
          if (matchesStatusSlot(dependency, status, p, { respectScope: false })) return dependency
        }
      }
    }
    return undefined
  }

  // FR-22: worker-shelved tasks pending `pre_rejection_policy` are serviced
  // first — they're cheap (no LLM) and keeping the board clear of unresolved
  // policy decisions beats adding work before deciding whether to drop the
  // prior one.
  for (const p of priority) {
    const task = queue.tasks.find(
      (t) =>
        needsPreRejectionPolicy(t) &&
        matchesLane(t) &&
        t.priority === p &&
        (!domain || t.domain === domain) &&
        matchesScope(t) &&
        matchesOrientationScope(t) &&
        !hasOpenEscalation(t) &&
        !isExcluded(t),
    )
    if (task) return task
  }

  const activeStatuses: TaskStatus[] = [
    'gate_check',
    'review',
    'in_progress',
  ]

  const freshStatuses: TaskStatus[] = [
    // FR-21: proposals are cheapest to service (pure lever decision, no LLM)
    // so they lead fresh-work intake after already-active work is cleared.
    'proposed',
    'exploring',
    'spec_review',
    'ready',
  ]

  if (preferredTaskId) {
    const preferred = queue.tasks.find((task) => task.id === preferredTaskId)
    if (preferred) {
      const runnableBlocker = firstRunnableBlocker(preferred)
      if (runnableBlocker) return runnableBlocker
      for (const status of [...activeStatuses, ...freshStatuses]) {
        for (const p of priority) {
          if (matchesStatusSlot(preferred, status, p)) return preferred
        }
      }
    }
    if (scopedIds?.size) {
      for (const status of [...activeStatuses, ...freshStatuses]) {
        for (const p of priority) {
          const task = queue.tasks.find(
            (t) => t.id !== preferredTaskId && matchesStatusSlot(t, status, p),
          )
          if (task) return task
        }
      }
    }
    return undefined
  }

  for (const status of [...activeStatuses, ...freshStatuses]) {
    for (const p of priority) {
      const task = queue.tasks.find(
        (t) => matchesStatusSlot(t, status, p),
      )
      if (task) return task
    }
  }
  return undefined
}
