import type { Task, TaskTurnLiveActivity } from './types.js'

interface TaskStateLike {
  taskStatus?: string
  status?: string
  importedDraft?: boolean
  liveAgent?: unknown
  activity?: TaskTurnLiveActivity[]
  checklist?: unknown
  shapingBlockers?: Array<{ code?: string; summary?: string }>
  taskReadiness?: { recommendation?: unknown }
  workerHandoff?: {
    ready?: unknown
    cleanupNeeded?: unknown
  }
  phase?: string
}

interface ChecklistLike {
  doneCount?: unknown
  totalSteps?: unknown
}

type TaskSpecLike = Pick<Task, 'spec' | 'acceptanceCriteria' | 'productBrief'>

export function hasFailureActivity(turn: Pick<TaskStateLike, 'activity'>): boolean {
  return (turn.activity ?? []).some(item =>
    item.tone === 'danger' ||
    /failed|timed out|empty assistant|error/i.test(item.label),
  )
}

export function hasDurableProgressActivity(turn: Pick<TaskStateLike, 'activity'>): boolean {
  return (turn.activity ?? []).some(item =>
    item.tone === 'ok' ||
    /write file|wrote |checkpoint|committed|changed/i.test(item.label),
  )
}

export function needsRecovery(turn: TaskStateLike): boolean {
  return (
    !turn.liveAgent &&
    turn.taskStatus === 'in_progress' &&
    hasFailureActivity(turn) &&
    hasDurableProgressActivity(turn)
  )
}

export function isImportedDraftShaping(turn: TaskStateLike): boolean {
  return !turn.liveAgent && Boolean(turn.importedDraft) && turn.taskStatus === 'exploring'
}

export function needsSourceRecoveryShaping(turn: TaskStateLike): boolean {
  const status = turn.taskStatus ?? turn.status
  if (turn.liveAgent || status !== 'exploring') return false
  if ((turn.shapingBlockers ?? []).some(blocker => blocker.code === 'source_recovery')) return true
  return turn.taskReadiness?.recommendation === 'needs_research_spike'
}

export function isQueuedSpecRevision(turn: TaskStateLike): boolean {
  if (needsSourceRecoveryShaping(turn)) return false
  return (
    (turn.taskStatus === 'exploring' || turn.taskStatus === 'spec_review') &&
    !turn.importedDraft &&
    !turn.liveAgent &&
    !turn.checklist &&
    turn.phase === 'spec'
  )
}

export function hasIncompleteTaskChecklist(turn: Pick<TaskStateLike, 'checklist'>): boolean {
  const checklist = turn.checklist as ChecklistLike | undefined
  if (!checklist || typeof checklist !== 'object') return false
  const doneCount = Number(checklist.doneCount)
  const totalSteps = Number(checklist.totalSteps)
  return Number.isFinite(doneCount) && Number.isFinite(totalSteps) && totalSteps > 0 && doneCount < totalSteps
}

type WorkerHandoffTurnLike = Pick<TaskStateLike, 'taskStatus' | 'checklist' | 'workerHandoff'>

function needsWorkerHandoffTurnCleanup(
  turn: Pick<TaskStateLike, 'taskStatus' | 'checklist' | 'workerHandoff'>,
): boolean {
  if (turn.taskStatus !== 'ready') return false
  if (hasIncompleteTaskChecklist(turn)) return true
  const handoff = turn.workerHandoff
  if (!handoff || typeof handoff !== 'object') return false
  return handoff.cleanupNeeded === true || handoff.ready === false
}

export function hasApprovedProductBrief(task: Pick<TaskSpecLike, 'productBrief'>): boolean {
  return Boolean(
    task.productBrief &&
    typeof task.productBrief === 'object' &&
    typeof task.productBrief.approvedAt === 'string' &&
    task.productBrief.approvedAt.trim().length > 0,
  )
}

function hasCompleteProductBrief(task: Pick<TaskSpecLike, 'productBrief'>): boolean {
  const brief = task.productBrief
  if (!brief || typeof brief !== 'object') return false
  const nonGoals = Array.isArray(brief.nonGoals) ? brief.nonGoals.filter(Boolean) : []
  const antiPatterns = Array.isArray(brief.antiPatterns) ? brief.antiPatterns.filter(Boolean) : []
  return Boolean(
    typeof brief.userJob === 'string' &&
    brief.userJob.trim().length > 0 &&
    typeof brief.whyItMattersNow === 'string' &&
    brief.whyItMattersNow.trim().length > 0 &&
    typeof brief.successMetric === 'string' &&
    brief.successMetric.trim().length > 0 &&
    (nonGoals.length > 0 || antiPatterns.length > 0),
  )
}

export function hasSpecDraftContent(task: Pick<TaskSpecLike, 'spec' | 'acceptanceCriteria'>): boolean {
  return (
    typeof task.spec === 'string' &&
    task.spec.trim().length > 0 &&
    Array.isArray(task.acceptanceCriteria) &&
    task.acceptanceCriteria.length > 0
  )
}

export function isCompleteForWorkerHandoff(task: TaskSpecLike): boolean {
  return hasApprovedProductBrief(task) && hasCompleteProductBrief(task) && hasSpecDraftContent(task)
}

export function needsWorkerHandoffSpecCleanup(task: (Pick<Task, 'status'> & TaskSpecLike) | WorkerHandoffTurnLike): boolean {
  if ('taskStatus' in task || 'workerHandoff' in task || 'checklist' in task) {
    return needsWorkerHandoffTurnCleanup(task as WorkerHandoffTurnLike)
  }
  return task.status === 'ready' && !isCompleteForWorkerHandoff(task)
}

export function workerHandoffStatus(task: Pick<Task, 'status'> & TaskSpecLike): string | undefined {
  if (needsWorkerHandoffSpecCleanup(task)) return 'needs_spec_cleanup'
  return task.status
}

export function effectiveWorkStatus(task: Pick<Task, 'status'> & TaskSpecLike, running = false): string | undefined {
  const handoffStatus = workerHandoffStatus(task)
  if (handoffStatus === 'needs_spec_cleanup') return handoffStatus
  if (!running) {
    if (task.status === 'in_progress') return 'paused'
    if (task.status === 'review') return 'review_waiting'
    if (task.status === 'gate_check') return 'gates_waiting'
  }
  return task.status
}

export function isWorkerRunnableStatus(task: Pick<Task, 'status'> & TaskSpecLike): boolean {
  if (task.status === 'ready') return isCompleteForWorkerHandoff(task)
  return ['proposed', 'exploring', 'in_progress', 'review', 'gate_check'].includes(task.status ?? '')
}
