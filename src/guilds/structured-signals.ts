import type { Task } from '@guildhall/core'

export type StructuredSurface =
  | 'user_facing'
  | 'component'
  | 'api'
  | 'data'
  | 'security'
  | 'testing'
  | 'performance'
  | 'documentation'

const USER_FACING_DOMAINS = new Set([
  'content',
  'design',
  'docs',
  'documentation',
  'frontend',
  'marketing',
  'product',
  'ui',
  'ux',
  'web',
])

const COMPONENT_WORK_KINDS = new Set(['component', 'primitive', 'story'])
const API_DOMAINS = new Set(['api', 'backend', 'integration', 'runtime'])
const DATA_LANES = new Set(['api_contract', 'data_integrity', 'migration_safety', 'rollout_safety'])
const USER_FACING_LANES = ['ux_comprehension', 'copy_clarity', 'visual_design', 'accessibility']

export function hasReviewLane(task: Pick<Task, 'reviewRisk'>, ...lanes: string[]): boolean {
  const declared = new Set(task.reviewRisk?.lanes ?? [])
  return lanes.some(lane => declared.has(lane))
}

export function hasStructuredSurface(
  task: Pick<Task, 'domain' | 'workKind' | 'reviewRisk' | 'structuredSpec'>,
  surface: StructuredSurface,
): boolean {
  const domain = task.domain.trim().toLowerCase()
  const workKind = task.workKind
  const structured = task.structuredSpec
  const lanes = task.reviewRisk?.lanes ?? []

  switch (surface) {
    case 'user_facing':
      return USER_FACING_DOMAINS.has(domain) ||
        COMPONENT_WORK_KINDS.has(workKind ?? '') ||
        hasReviewLane(task, ...USER_FACING_LANES) ||
        Boolean(structured?.userFacingBehavior || structured?.visualInteractionNotes)
    case 'component':
      return COMPONENT_WORK_KINDS.has(workKind ?? '') ||
        hasReviewLane(task, 'ux_comprehension', 'visual_design', 'accessibility') ||
        Boolean(structured?.componentApiShape || structured?.visualInteractionNotes)
    case 'api':
      return API_DOMAINS.has(domain) ||
        hasReviewLane(task, 'api_contract') ||
        Boolean(structured?.contractSurfaceDeltas?.length)
    case 'data':
      return lanes.some(lane => DATA_LANES.has(lane)) ||
        Boolean(structured?.contractSurfaceDeltas?.length || structured?.dataModelSchemaChanges)
    case 'security':
      return hasReviewLane(task, 'security', 'privacy', 'evidence_privacy') ||
        Boolean(structured?.contractSurfaceDeltas?.some(delta => delta.breakingChange))
    case 'testing':
      return workKind === 'test' || workKind === 'verification' ||
        hasReviewLane(task, 'test_adequacy', 'migration_safety', 'release_risk')
    case 'performance':
      return hasReviewLane(task, 'performance', 'cost_control') ||
        Boolean(structured?.performanceReliabilitySecurity)
    case 'documentation':
      return domain === 'docs' || domain === 'documentation' ||
        hasReviewLane(task, 'docs_truth')
  }
}
