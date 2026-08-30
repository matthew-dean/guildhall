import { readManagedTextFileSync } from '@guildhall/persistence'
import { existsSync } from 'node:fs'
import {
  appendTaskEvidence,
  getProjectSystemStatePath,
  readProjectStateDatabaseCurrentAuthorityFromTasksPath,
  readProjectStateDatabaseQueueRevision,
  readTaskEvidence,
  readTaskRuntimeStore,
  upsertTaskRuntimeState,
} from '@guildhall/sessions'
import type { Task, TaskQueue } from '@guildhall/core'
import { AcceptanceCriteria, TaskQueue as TaskQueueSchema } from '@guildhall/core'
import { buildEffectiveTask } from './effective-task.js'
import {
  preserveRuntimeOverlayOnTaskQueueParse,
  readProjectTaskQueueForMutationSync,
  readProjectTaskQueueForRichMutation,
  writeProjectTaskQueue,
  writeProjectTaskQueueAtCurrentStateBoundary,
} from './project-state-boundary.js'
import { reconcileAcceptanceCriteriaFromCompletionProof, reviewAcceptanceCriteriaMissingApprovalIds } from './proof-health.js'
import { transitionTaskStatus } from './task-transition.js'

export interface StaleBlockerRepair {
  taskId: string
  previousStatus: string
  nextStatus: string
  reason: string
}

export interface StaleBlockerRepairResult {
  changed: boolean
  repairs: StaleBlockerRepair[]
}

export interface CompletionProofCriteriaRepair {
  taskId: string
  reconciledCount: number
  reason: string
}

export interface CompletionProofCriteriaRepairResult {
  changed: boolean
  repairs: CompletionProofCriteriaRepair[]
}

export interface StaleBlockerRepairOptions {
  /**
   * Keep typed recovery records intact for the orchestrator's specialized
   * handlers. Generic state repair must not consume the machine identity that
   * decides the next lane.
   */
  preserveTypedRecoveries?: boolean
}

const REVIEW_PARTIAL_DIFF_REPAIR_NOTE =
  'Auto-repaired stale model/tool-use blocker. Guildhall will review the saved partial diff instead of asking the owner to choose retry, narrowing, or provider switch.'

const GENERIC_STATE_REPAIR_NOTE =
  'Auto-repaired stale internal/tooling blocker. Guildhall will continue from this task’s own scope and current evidence instead of preserving an old cross-task/path guardrail as a human blocker.'

function expectedAssigneeForStatus(status: Task['status']): string | null {
  if (status === 'review') return 'reviewer-agent'
  if (status === 'exploring') return 'spec-agent'
  return null
}

function stateRepairNoteContent(status: Task['status']): string {
  return status === 'review' ? REVIEW_PARTIAL_DIFF_REPAIR_NOTE : GENERIC_STATE_REPAIR_NOTE
}

function taskHasUsableBlueprint(task: Task): boolean {
  return (
    typeof task.spec === 'string' &&
    task.spec.trim().length > 0 &&
    Array.isArray(task.acceptanceCriteria) &&
    task.acceptanceCriteria.length > 0
  )
}

function isHighConfidenceInternalBlocker(task: Task): boolean {
  return (task.escalations ?? []).some((escalation) =>
    !escalation.resolvedAt && Boolean(escalation.recoveryCode),
  )
}

function isResearchSpikeStuckInSpecReview(task: Task): boolean {
  return task.status === 'spec_review' && task.taskReadiness?.recommendation === 'needs_research_spike'
}

function unresolvedEscalationCount(task: Task): number {
  return (task.escalations ?? []).filter((escalation) => !escalation.resolvedAt).length
}

function resolveStaleEscalations(task: Task, now: string): void {
  for (const escalation of task.escalations ?? []) {
    if (escalation.resolvedAt) continue
    if (escalation.recoveryCode) {
      escalation.resolvedAt = now
      escalation.resolvedBy = 'system'
      escalation.resolution =
        'Auto-repaired as a stale internal/tooling blocker. Guildhall will resume from the task scope and current evidence instead of asking for a manual task-file edit.'
    }
  }
}

function nextStatusForRepairedTask(task: Task, opts: { dirtyWorkerTimeout?: boolean } = {}): Task['status'] {
  if (opts.dirtyWorkerTimeout) return 'review'
  if (task.taskReadiness?.recommendation === 'needs_research_spike') return 'exploring'
  if (taskHasUsableBlueprint(task)) return 'spec_review'
  if (task.productBrief || task.status === 'exploring' || task.status === 'blocked') return 'exploring'
  return task.status
}

function isDirtyWorkerTimeoutBlocker(task: Task): boolean {
  return (task.escalations ?? []).some((escalation) =>
    !escalation.resolvedAt && escalation.recoveryCode === 'worker_timeout_likely_target',
  )
}

function hasReopenedReviewAfterSkippedLanding(task: Task): boolean {
  return task.status === 'blocked' &&
    task.recoveryCode === undefined &&
    task.mergeRecord?.result === 'skipped' &&
    unresolvedEscalationCount(task) === 0 &&
    (
      reviewAcceptanceCriteriaMissingApprovalIds(task).length > 0 ||
      task.doneSummaryBundle?.status === 'reopened'
    )
}

export function repairStaleBlockersInQueue(
  queue: TaskQueue,
  now = new Date().toISOString(),
  options: StaleBlockerRepairOptions = {},
): StaleBlockerRepairResult {
  const repairs: StaleBlockerRepair[] = []

  for (const task of queue.tasks) {
    if (hasReopenedReviewAfterSkippedLanding(task)) {
      const missingReviewCriteria = reviewAcceptanceCriteriaMissingApprovalIds(task)
      const previousStatus = task.status
      transitionTaskStatus({
        task,
        event: 'recover_to_review',
        actor: 'landing-review-recovery',
        evidenceRefs: missingReviewCriteria.length > 0
          ? missingReviewCriteria.map(criterionId => `criterion:${criterionId}`)
          : ['completion:reopened'],
        now,
      })
      task.assignedTo = 'reviewer-agent'
      task.blockReason = undefined
      task.notes = Array.isArray(task.notes) ? task.notes : []
      task.notes.push({
        agentId: 'system',
        role: 'state-repair',
        content:
          missingReviewCriteria.length > 0
            ? `Guildhall found saved implementation after a skipped landing attempt, but review still needs to approve ${missingReviewCriteria.join(', ')}. ` +
              'Returned the task to review instead of leaving a recovery blocker with no action.'
            : 'Guildhall found saved implementation after a skipped landing attempt, but its current completion was reopened. ' +
              'Returned the task to review instead of leaving a recovery blocker with no action.',
        timestamp: now,
      })
      task.updatedAt = now
      repairs.push({
        taskId: task.id,
        previousStatus,
        nextStatus: 'review',
        reason: 'missing_review_after_skipped_landing',
      })
      continue
    }
    const researchSpikeApproval = isResearchSpikeStuckInSpecReview(task)
    if (!researchSpikeApproval && !isHighConfidenceInternalBlocker(task)) continue
    const hasTypedRecovery = task.recoveryCode !== undefined ||
      task.escalations.some((escalation) => !escalation.resolvedAt && escalation.recoveryCode !== undefined)
    if (options.preserveTypedRecoveries && hasTypedRecovery) continue
    const beforeUnresolved = unresolvedEscalationCount(task)
    const previousStatus = task.status
    const dirtyWorkerTimeout = isDirtyWorkerTimeoutBlocker(task)
    const hasRecoveryEscalation = isHighConfidenceInternalBlocker(task)
    const recoveryCode = task.escalations?.find((escalation) => !escalation.resolvedAt)?.recoveryCode
    const repairReason = researchSpikeApproval
      ? 'research_spike_not_approval'
      : dirtyWorkerTimeout || recoveryCode === 'worker_turn_limit' || recoveryCode === 'worker_timeout_no_progress'
      ? 'model_tool_use_recovery_blocker'
      : 'stale_internal_tooling_blocker'

    resolveStaleEscalations(task, now)

    if (hasRecoveryEscalation) {
      task.blockReason = undefined
    }

    if (!researchSpikeApproval && beforeUnresolved > 0 && unresolvedEscalationCount(task) > 0) continue
    if (task.blockReason && task.status === 'blocked') continue

    const nextStatus = task.status === 'blocked' || researchSpikeApproval
      ? nextStatusForRepairedTask(task, { dirtyWorkerTimeout })
      : task.status

    if (task.status !== nextStatus) task.status = nextStatus
    task.assignedTo = expectedAssigneeForStatus(nextStatus)
    task.notes = Array.isArray(task.notes) ? task.notes : []
    task.notes.push({
      agentId: 'system',
      role: 'state-repair',
      content: stateRepairNoteContent(nextStatus),
      timestamp: now,
    })
    task.updatedAt = now
    repairs.push({
      taskId: task.id,
      previousStatus,
      nextStatus: task.status,
      reason: repairReason,
    })
  }

  if (repairs.length > 0) queue.lastUpdated = now
  return { changed: repairs.length > 0, repairs }
}

export function repairStaleBlockersForProject(projectPath: string): StaleBlockerRepairResult {
  const tasksPath = getProjectSystemStatePath(projectPath, 'TASKS.json')
  const queueRead = readQueueForRepair(tasksPath)
  if (!queueRead) return { changed: false, repairs: [] }
  const rawQueue = queueRead.queue
  const queue = TaskQueueSchema.parse(rawQueue)
  const result = repairStaleBlockersInQueue(queue)
  if (result.changed) {
    writeProjectTaskQueue(tasksPath, queue, { expectedQueueRevision: queueRead.expectedQueueRevision })
  }
  return result
}

export function repairCompletionProofCriteriaInQueue(queue: TaskQueue, now = new Date().toISOString()): CompletionProofCriteriaRepairResult {
  const repairs: CompletionProofCriteriaRepair[] = []
  for (const task of queue.tasks) {
    const result = reconcileAcceptanceCriteriaFromCompletionProof(task, now)
    if (!result.changed) continue
    repairs.push({
      taskId: task.id,
      reconciledCount: result.reconciledCount,
      reason: result.reason,
    })
  }
  if (repairs.length > 0) queue.lastUpdated = now
  return { changed: repairs.length > 0, repairs }
}

export function repairCompletionProofCriteriaForProject(projectPath: string): CompletionProofCriteriaRepairResult {
  const tasksPath = getProjectSystemStatePath(projectPath, 'TASKS.json')
  const queueRead = readQueueForRepair(tasksPath)
  if (!queueRead) return { changed: false, repairs: [] }
  const rawQueue = queueRead.queue
  const queue = TaskQueueSchema.parse(rawQueue)
  const result = repairCompletionProofCriteriaInQueue(queue)
  if (result.changed) {
    writeProjectTaskQueue(tasksPath, queue, { expectedQueueRevision: queueRead.expectedQueueRevision })
  }
  return result
}

export async function repairCompletionProofCriteriaForProjectWithEvidence(projectPath: string): Promise<CompletionProofCriteriaRepairResult> {
  const tasksPath = getProjectSystemStatePath(projectPath, 'TASKS.json')
  const now = new Date().toISOString()
  const queueRead = readQueueForRepair(tasksPath)
  if (!queueRead) return { changed: false, repairs: [] }
  const rawQueue = queueRead.queue
  const queue = TaskQueueSchema.parse(rawQueue)
  const repairs: CompletionProofCriteriaRepair[] = []

  for (const task of queue.tasks) {
  const effectiveTask = await buildEffectiveTask(projectPath, task, { evidence: 'full' })
  const candidate = {
    ...task,
    evidence: effectiveTask.evidence,
      ...(Array.isArray(effectiveTask.reviewVerdicts) ? { reviewVerdicts: effectiveTask.reviewVerdicts } : {}),
      ...(Array.isArray(effectiveTask.notes) ? { notes: effectiveTask.notes } : {}),
      ...(Array.isArray(effectiveTask.gateResults) ? { gateResults: effectiveTask.gateResults } : {}),
      ...(effectiveTask.doneSummaryBundle ? { doneSummaryBundle: effectiveTask.doneSummaryBundle } : {}),
    } as Task
    const result = reconcileAcceptanceCriteriaFromCompletionProof(candidate, now)
    if (!result.changed) continue
    task.acceptanceCriteria = AcceptanceCriteria.array().parse(candidate.acceptanceCriteria)
    task.updatedAt = now
    repairs.push({
      taskId: task.id,
      reconciledCount: result.reconciledCount,
      reason: result.reason,
    })
  }

  if (repairs.length > 0) {
    queue.lastUpdated = now
    writeProjectTaskQueue(tasksPath, queue, { expectedQueueRevision: queueRead.expectedQueueRevision })
  }
  return { changed: repairs.length > 0, repairs }
}

export async function repairStaleBlockersForProjectWithRuntime(projectPath: string): Promise<StaleBlockerRepairResult> {
  const tasksPath = getProjectSystemStatePath(projectPath, 'TASKS.json')
  const rawQueue = await readProjectTaskQueueForRichMutation(projectPath)
  const queue = preserveRuntimeOverlayOnTaskQueueParse(rawQueue, TaskQueueSchema.parse(rawQueue))
  const result = repairStaleBlockersInQueue(queue)
  if (result.changed) {
    await writeProjectTaskQueueAtCurrentStateBoundary(tasksPath, queue, { projectRoot: projectPath })
  }
  const now = new Date().toISOString()
  for (const repair of result.repairs) {
    const assignedTo = expectedAssigneeForStatus(repair.nextStatus as Task['status'])
    await upsertTaskRuntimeState(projectPath, repair.taskId, {
      assignedTo,
      openEscalationIds: [],
    })
    await appendStateRepairEvidence(projectPath, repair.taskId, repair.nextStatus as Task['status'], now)
  }
  await reconcileAlreadyRepairedRuntimeState(projectPath)
  return result
}

async function appendStateRepairEvidence(
  projectPath: string,
  taskId: string,
  status: Task['status'],
  timestamp: string,
): Promise<void> {
  const content = stateRepairNoteContent(status)
  const existing = await readTaskEvidence(projectPath, taskId, { kind: 'note' })
  if (existing.some(event => {
    const payload = event.payload as Record<string, unknown>
    return payload['role'] === 'state-repair' && payload['content'] === content
  })) return

  await appendTaskEvidence(projectPath, taskId, {
    id: `note-${taskId}-${timestamp.replace(/[^0-9A-Za-z]/g, '')}-state-repair`,
    kind: 'note',
    recordedAt: timestamp,
    payload: {
      agentId: 'system',
      role: 'state-repair',
      content,
      timestamp,
    },
  })
}

async function reconcileAlreadyRepairedRuntimeState(projectPath: string): Promise<void> {
  const tasksPath = getProjectSystemStatePath(projectPath, 'TASKS.json')
  const queueRead = readQueueForRepair(tasksPath)
  if (!queueRead) return
  const rawQueue = queueRead.queue
  const queue = TaskQueueSchema.parse(rawQueue)
  const runtimeStore = await readTaskRuntimeStore(projectPath)

  for (const task of queue.tasks) {
    if (task.status !== 'review' && task.status !== 'exploring') continue
    const expectedAssignee = expectedAssigneeForStatus(task.status)
    const runtime = runtimeStore.tasks[task.id]
    if (runtime?.assignedTo === expectedAssignee) continue
    await upsertTaskRuntimeState(projectPath, task.id, {
      assignedTo: expectedAssignee,
      openEscalationIds: [],
    })
    await appendStateRepairEvidence(projectPath, task.id, task.status, new Date().toISOString())
  }
}

function readQueueForRepair(tasksPath: string): {
  queue: unknown
  expectedQueueRevision: number | null
} | null {
  try {
    return readProjectTaskQueueForMutationSync(tasksPath)
  } catch (error) {
    let authority: 'legacy' | 'database' | null
    try {
      authority = readProjectStateDatabaseCurrentAuthorityFromTasksPath(tasksPath)
    } catch {
      throw projectStateMigrationRequiredError(tasksPath, error)
    }
    if (authority === 'database') throw projectStateMigrationRequiredError(tasksPath, error)
    let queueRevision: number | null
    try {
      queueRevision = readProjectStateDatabaseQueueRevision(tasksPath)
    } catch {
      throw projectStateMigrationRequiredError(tasksPath, error)
    }
    if (queueRevision !== null) throw projectStateMigrationRequiredError(tasksPath, error)
    if (!existsSync(tasksPath)) return null
    // This is an explicit repair/migration boundary, not a normal runtime
    // reader. Import the pre-database queue only to seed the current store.
    return {
      queue: JSON.parse(readManagedTextFileSync(tasksPath, 'utf8')) as unknown,
      expectedQueueRevision: null,
    }
  }
}

function projectStateMigrationRequiredError(tasksPath: string, cause: unknown): Error {
  const detail = cause instanceof Error ? cause.message : String(cause)
  return new Error(`Project-state migration required before repairing current task state for ${tasksPath}. ${detail}`)
}
