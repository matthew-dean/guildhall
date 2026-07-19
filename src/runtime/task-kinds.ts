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

  const text = taskText(task)
  // "Evaluate" is an output/review verb in many implementation tasks (for
  // example, generate and evaluate a synopsis). It is not enough evidence to
  // route work into a research lane; keep research classification tied to an
  // explicit discovery/comparison request.
  if (/\b(research|investigate|compare|survey|explore)\b/i.test(text)) return 'research'
  if (/\b(decide|decision|choose|policy|tradeoffs?|approve|judgment)\b/i.test(task.title ?? '')) return 'decision'
  if (/\b(implement|build|create|add|wire|change|migrate|ship)\b/i.test(text)) return 'implementation'
  if (/\b(decide|decision|choose|policy|tradeoffs?|approve|judgment)\b/i.test(text)) return 'decision'
  if (/\b(spike|prototype|proof of concept|poc)\b/i.test(text)) return 'spike'
  if (/\b(cleanup|refactor|remove|tidy|archive)\b/i.test(text)) return 'cleanup'
  if (/\b(verify|verification|test plan|browser proof|proof path)\b/i.test(text)) return 'verification'
  if (/\b(release|publish|ship|changelog|migration guide)\b/i.test(text)) return 'release'
  if (/\b(learn|memory|preference|practice|playbook)\b/i.test(text)) return 'learning'
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

function taskText(task: Task): string {
  return [
    task.title,
    task.description,
    task.spec,
    task.request?.raw,
    task.requestIntake?.ambiguity,
    ...(task.acceptanceCriteria ?? []).map(ac => ac.description),
  ].filter(Boolean).join('\n')
}
