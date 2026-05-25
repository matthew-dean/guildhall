import type { Task, TaskTurnLiveActivity } from './types.js'

interface TaskStateLike {
  taskStatus?: string
  importedDraft?: boolean
  liveAgent?: unknown
  activity?: TaskTurnLiveActivity[]
  checklist?: unknown
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

export function isQueuedSpecRevision(turn: TaskStateLike): boolean {
  return (
    turn.taskStatus === 'exploring' &&
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

export function hasApprovedProductBrief(task: Pick<TaskSpecLike, 'productBrief'>): boolean {
  return Boolean(
    task.productBrief &&
    typeof task.productBrief === 'object' &&
    typeof task.productBrief.approvedAt === 'string' &&
    task.productBrief.approvedAt.trim().length > 0,
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
  return hasApprovedProductBrief(task) && hasSpecDraftContent(task)
}

export function needsWorkerHandoffSpecCleanup(task: Pick<Task, 'status'> & TaskSpecLike): boolean {
  return task.status === 'ready' && !isCompleteForWorkerHandoff(task)
}

export function workerHandoffStatus(task: Pick<Task, 'status'> & TaskSpecLike): string | undefined {
  if (needsWorkerHandoffSpecCleanup(task)) return 'needs_spec_cleanup'
  return task.status
}
