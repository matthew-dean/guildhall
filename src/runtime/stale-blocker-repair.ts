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
import { TaskQueue as TaskQueueSchema } from '@guildhall/core'
import { buildEffectiveTask } from './effective-task.js'
import { readProjectTaskQueueForMutationSync, writeProjectTaskQueue } from './project-state-boundary.js'
import { reconcileAcceptanceCriteriaFromCompletionProof } from './proof-health.js'

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

const INTERNAL_TOOLING_BLOCKER =
  /tool (?:read|reads|layer|runtime|file\/write|file read\/write)|cross-task (?:tool )?guardrail|stale workspace path guardrail|tooling\/context routing|path mismatch|misrouted|intercepted|unrelated missing path|unrelated task file|different task worktree/i

const STALE_SOURCE_PATH_BLOCKER =
  /\b(?:missing|likely target|target file|stale source|source reference)\b/i

const BLUEPRINT_LANE =
  /\b(?:spec-agent|coordinator|blueprint|spec|planning lane)\b/i

const MUTATION_FORCED_ON_PLANNING =
  /\b(?:create|author|mutate|write)\b/i

const MODEL_TOOL_USE_RECOVERY_BLOCKER =
  /\b(?:stopped after hitting (?:its|the) turn limit|turn budget|usable tool call|model failed|failed to produce)\b/i

const DIRTY_WORKER_TIMEOUT_BLOCKER =
  /\bworker repeatedly hit (?:its|the) turn budget after saving partial work\b/i

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

function activeEscalationText(task: Task): string {
  return (task.escalations ?? [])
    .filter((escalation) => !escalation.resolvedAt)
    .map((escalation) => `${escalation.agentId}\n${escalation.reason}\n${escalation.summary ?? ''}\n${escalation.details ?? ''}`)
    .join('\n')
}

function blockerText(task: Task): string {
  return [task.blockReason ?? '', activeEscalationText(task)].join('\n')
}

function hasModelToolUseFailureClassification(task: Task): boolean {
  return (task.notes ?? []).some((note) => {
    if (note.role !== 'policy-classification') return false
    try {
      const parsed = JSON.parse(note.content) as Record<string, unknown>
      return parsed['class'] === 'model_tool_use_failure'
    } catch {
      return false
    }
  })
}

function isHighConfidenceInternalBlocker(task: Task): boolean {
  const text = blockerText(task)
  if (!text.trim()) return false

  if (INTERNAL_TOOLING_BLOCKER.test(text)) return true
  if (DIRTY_WORKER_TIMEOUT_BLOCKER.test(text)) return true
  if (hasModelToolUseFailureClassification(task) && MODEL_TOOL_USE_RECOVERY_BLOCKER.test(text)) return true

  return (
    BLUEPRINT_LANE.test(text) &&
    STALE_SOURCE_PATH_BLOCKER.test(text) &&
    MUTATION_FORCED_ON_PLANNING.test(text)
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
    const text = `${escalation.agentId}\n${escalation.reason}\n${escalation.summary ?? ''}\n${escalation.details ?? ''}`
    if (
      INTERNAL_TOOLING_BLOCKER.test(text) ||
      MODEL_TOOL_USE_RECOVERY_BLOCKER.test(text) ||
      (
        BLUEPRINT_LANE.test(text) &&
        STALE_SOURCE_PATH_BLOCKER.test(text) &&
        MUTATION_FORCED_ON_PLANNING.test(text)
      )
    ) {
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
  return DIRTY_WORKER_TIMEOUT_BLOCKER.test(blockerText(task))
}

export function repairStaleBlockersInQueue(
  queue: TaskQueue,
  now = new Date().toISOString(),
): StaleBlockerRepairResult {
  const repairs: StaleBlockerRepair[] = []

  for (const task of queue.tasks) {
    const researchSpikeApproval = isResearchSpikeStuckInSpecReview(task)
    if (!researchSpikeApproval && !isHighConfidenceInternalBlocker(task)) continue
    const beforeUnresolved = unresolvedEscalationCount(task)
    const previousStatus = task.status
    const dirtyWorkerTimeout = isDirtyWorkerTimeoutBlocker(task)
    const repairReason = researchSpikeApproval
      ? 'research_spike_not_approval'
      : dirtyWorkerTimeout || (hasModelToolUseFailureClassification(task) && MODEL_TOOL_USE_RECOVERY_BLOCKER.test(blockerText(task)))
      ? 'model_tool_use_recovery_blocker'
      : 'stale_internal_tooling_blocker'

    resolveStaleEscalations(task, now)

    const blockReasonLooksStale =
      typeof task.blockReason === 'string' &&
      (
        INTERNAL_TOOLING_BLOCKER.test(task.blockReason) ||
        DIRTY_WORKER_TIMEOUT_BLOCKER.test(task.blockReason) ||
        (
          hasModelToolUseFailureClassification(task) &&
          MODEL_TOOL_USE_RECOVERY_BLOCKER.test(task.blockReason)
        ) ||
        (
          BLUEPRINT_LANE.test(task.blockReason) &&
          STALE_SOURCE_PATH_BLOCKER.test(task.blockReason) &&
          MUTATION_FORCED_ON_PLANNING.test(task.blockReason)
        )
      )
    if (blockReasonLooksStale) task.blockReason = undefined

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
    task.acceptanceCriteria = candidate.acceptanceCriteria
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
  const result = repairStaleBlockersForProject(projectPath)
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
