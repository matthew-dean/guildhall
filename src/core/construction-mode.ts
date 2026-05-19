import type { Task } from './task.js'

export interface ConstructionModeTaskInput {
  status: Task['status']
  blocker?: string | undefined
}

export type ConstructionMode =
  | 'survey'
  | 'blueprint'
  | 'frame'
  | 'build'
  | 'inspect'
  | 'change_order'
  | 'punch_list'

export function constructionModeForTask(
  task: ConstructionModeTaskInput,
): ConstructionMode {
  if (task.status === 'blocked') {
    const blocker = task.blocker ?? ''
    if (/\b(spec|scope|assumption|plan|blueprint|decision|change order)\b/i.test(blocker)) {
      return 'change_order'
    }
    return 'inspect'
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
