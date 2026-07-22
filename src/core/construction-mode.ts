import type { Task } from './task.js'

export interface ConstructionModeTaskInput {
  status: Task['status']
  blockerKind?: ConstructionBlockerKind | undefined
}

export type ConstructionMode =
  | 'survey'
  | 'blueprint'
  | 'frame'
  | 'build'
  | 'inspect'
  | 'change_order'
  | 'punch_list'

export type ConstructionBlockerKind = 'change_order' | 'execution_failure'

export function constructionBlockerKindForEscalationReason(reason: string | undefined): ConstructionBlockerKind {
  return reason === 'spec_ambiguous' ||
    reason === 'scope_boundary' ||
    reason === 'decision_required' ||
    reason === 'human_judgment_required'
    ? 'change_order'
    : 'execution_failure'
}

export function constructionModeForTask(
  task: ConstructionModeTaskInput,
): ConstructionMode {
  if (task.status === 'blocked') {
    return task.blockerKind === 'change_order' ? 'change_order' : 'inspect'
  }

  switch (task.status) {
    case 'proposed':
      return 'survey'
    case 'exploring':
    case 'spec_review':
      return 'blueprint'
    case 'ready':
      return 'frame'
    case 'in_progress':
      return 'build'
    case 'review':
    case 'gate_check':
      return 'inspect'
    case 'done':
    case 'shelved':
    case 'pending_pr':
      return 'punch_list'
    default:
      return 'survey'
  }
}
