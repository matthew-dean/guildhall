import type { TaskTurnLiveActivity } from './types.js'

interface TaskStateLike {
  taskStatus?: string
  importedDraft?: boolean
  liveAgent?: unknown
  activity?: TaskTurnLiveActivity[]
  checklist?: unknown
  phase?: string
}

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
