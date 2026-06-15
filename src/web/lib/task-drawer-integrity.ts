import type { Escalation, Task, TaskSizePlan } from './types'

type RecommendedChild = NonNullable<TaskSizePlan['recommendedChildren']>[number]

const STOP_WORDS = new Set([
  'add',
  'admin',
  'api',
  'apply',
  'before',
  'boundary',
  'build',
  'checks',
  'clean',
  'contract',
  'create',
  'define',
  'draft',
  'editor',
  'flow',
  'guildhall',
  'implementation',
  'implement',
  'nested',
  'project',
  'review',
  'screens',
  'settings',
  'spec',
  'subscription',
  'task',
  'verify',
  'work',
  'workflow',
])

function words(value: string | undefined | null): string[] {
  return String(value ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word))
}

function taskContextWords(task: Task): Set<string> {
  return new Set(words([
    task.id,
    task.title,
    task.description,
    task.domain,
    task.spec,
    task.businessEnvelope?.goalId,
    ...(task.dependsOn ?? []),
  ].filter(Boolean).join(' ')))
}

function childWords(child: RecommendedChild): string[] {
  return words([
    child.title,
    child.reason,
    child.suggestedDomain,
    ...(child.dependsOn ?? []),
  ].filter(Boolean).join(' '))
}

function isProjectDerivedChild(child: RecommendedChild, context: Set<string>): boolean {
  if (child.createdTaskId) return true
  const overlap = childWords(child).filter((word) => context.has(word))
  return overlap.length >= 2
}

export function projectDerivedRecommendedChildren(task: Task): RecommendedChild[] {
  const children = task.sizePlan?.recommendedChildren ?? []
  if (children.length === 0) return []
  const context = taskContextWords(task)
  if (context.size === 0) return []
  return children.filter((child) => isProjectDerivedChild(child, context))
}

function hasText(value: string | undefined | null): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

export function hasStructuredAcceptanceCriteria(task: Task): boolean {
  return (
    (Array.isArray(task.acceptanceCriteria) && task.acceptanceCriteria.length > 0) ||
    (Array.isArray(task.structuredSpec?.acceptanceCriteria) && task.structuredSpec.acceptanceCriteria.length > 0)
  )
}

export function hasBriefSuccessTarget(task: Task): boolean {
  const brief = task.productBrief
  if (hasText(brief?.successMetric) || hasText(brief?.successCriteria)) return true
  return hasText(task.structuredSpec?.completionBoundary?.whatCountsAsDone)
}

export function specApprovalNeedsStructuredBrief(task: Task): boolean {
  return task.status === 'spec_review' && !hasBriefSuccessTarget(task) && !hasStructuredAcceptanceCriteria(task)
}

export function unresolvedCompletionEscalations(task: Task): Escalation[] {
  if (task.status !== 'done') return []
  return (task.escalations ?? []).filter((escalation) => !escalation.resolvedAt)
}
