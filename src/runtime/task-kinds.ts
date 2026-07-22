import type { Task, TaskKind } from '@guildhall/core'

export const TASK_KINDS: readonly TaskKind[] = [
  'implementation',
  'research',
  'decision',
  'spike',
  'cleanup',
  'verification',
  'release',
  'learning',
]

export function taskKindFor(task: Task): TaskKind {
  if (task.taskKind && TASK_KINDS.includes(task.taskKind)) return task.taskKind
  switch (task.workKind) {
    case 'research':
    case 'decision':
    case 'cleanup':
    case 'verification':
    case 'release':
    case 'learning':
      return task.workKind
    case 'setup':
    case 'implementation':
      return 'implementation'
    case 'app_spec':
    case 'feature_spec':
    default:
      break
  }

  // A missing task kind is not an invitation to classify model prose. Intake
  // authors and migrations must provide a structured kind; implementation is
  // the safe compatibility default.
  return 'implementation'
}

export function readinessRequirementForKind(kind: TaskKind): string {
  switch (kind) {
    case 'research':
      return 'Research work needs a learning goal, evidence sources, output format, and unresolved-question boundary.'
    case 'decision':
      return 'Decision work needs options, tradeoffs, a named owner, and the point at which Guildhall must stop.'
    case 'spike':
      return 'Spike work needs a timebox, learning goal, and throwaway-versus-production boundary.'
    case 'verification':
      return 'Verification work needs the exact proof path, environment, expected evidence, and pass/fail boundary.'
    case 'release':
      return 'Release work needs artifact, rollout, rollback, docs, and publication boundaries.'
    case 'cleanup':
      return 'Cleanup work needs the safe removal boundary and regression proof.'
    case 'learning':
      return 'Learning work needs evidence, proposed memory or practice shape, and explicit approval before activation.'
    case 'implementation':
    default:
      return 'Implementation work needs clear outcome, acceptance criteria, proof path, dependencies, and Definition of Done.'
  }
}
