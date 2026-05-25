import type { Task, TaskPriority } from '@guildhall/core'
import type {
  ReviewBudget,
  ReviewEffort,
  ReviewPlanRecord,
  ReviewRecipeRef,
  ReviewRiskLane,
} from './review-audit-store.js'

const ALL_LANES: ReviewRiskLane[] = [
  'ux_comprehension',
  'copy_clarity',
  'visual_design',
  'accessibility',
  'security',
  'privacy',
  'api_contract',
  'data_integrity',
  'migration_safety',
  'test_adequacy',
  'performance',
  'docs_truth',
  'release_risk',
  'plan_completeness',
  'evidence_privacy',
  'calibration_governance',
  'cost_control',
  'rollout_safety',
]

const EFFORT_RANK: Record<ReviewEffort, number> = {
  lean: 0,
  balanced: 1,
  thorough: 2,
  release_critical: 3,
  custom: 4,
}

const PRIORITY_EFFORT: Record<TaskPriority, ReviewEffort> = {
  low: 'lean',
  normal: 'balanced',
  high: 'thorough',
  critical: 'release_critical',
}

const EFFORT_BUDGETS: Record<Exclude<ReviewEffort, 'custom'>, ReviewBudget> = {
  lean: {
    maxReviewerAgents: 2,
    maxEstimatedTokens: 20000,
    maxWallClockMinutes: 8,
    maxRevisionLoops: 1,
  },
  balanced: {
    maxReviewerAgents: 4,
    maxEstimatedTokens: 45000,
    maxWallClockMinutes: 18,
    maxRevisionLoops: 2,
  },
  thorough: {
    maxReviewerAgents: 6,
    maxEstimatedTokens: 85000,
    maxWallClockMinutes: 35,
    maxRevisionLoops: 3,
  },
  release_critical: {
    maxReviewerAgents: 8,
    maxEstimatedTokens: 140000,
    maxWallClockMinutes: 60,
    maxRevisionLoops: 4,
  },
}

const LANE_PATTERNS: Array<{
  lane: ReviewRiskLane
  pattern: RegExp
  reason: string
}> = [
  {
    lane: 'ux_comprehension',
    pattern: /\b(ui|ux|screen|flow|journey|wizard|drawer|modal|button|form|empty state|onboarding|dashboard|browser|viewport)\b/i,
    reason: 'The task touches a user-facing interaction or screen.',
  },
  {
    lane: 'copy_clarity',
    pattern: /\b(copy|labels?|microcopy|message|error text|tooltips?|docs?|readme|guide|public docs|language|wording)\b/i,
    reason: 'The task changes wording that users or readers may rely on.',
  },
  {
    lane: 'visual_design',
    pattern: /\b(css|style|layout|spacing|color|icon|responsive|mobile|desktop|component|svelte|react|vue|tailwind)\b/i,
    reason: 'The task changes visual presentation or component layout.',
  },
  {
    lane: 'accessibility',
    pattern: /\b(a11y|accessibility|aria|keyboard|focus|screen reader|contrast|tab order|semantic)\b/i,
    reason: 'The task mentions accessibility-sensitive behavior.',
  },
  {
    lane: 'security',
    pattern: /\b(auth|authorization|authentication|permission|access token|api token|secret|session|csrf|xss|injection|sandbox|capability)\b/i,
    reason: 'The task touches trust, permissions, or attack surface.',
  },
  {
    lane: 'privacy',
    pattern: /\b(pii|privacy|personal data|email|phone|address|user data|telemetry|analytics|tracking|consent)\b/i,
    reason: 'The task may expose, store, or transmit user-sensitive data.',
  },
  {
    lane: 'api_contract',
    pattern: /\b(api|endpoint|route|request|response|schema|contract|webhook|graphql|rest|status code|backward compat)\b/i,
    reason: 'The task changes a boundary another caller may depend on.',
  },
  {
    lane: 'data_integrity',
    pattern: /\b(database|db|sql|mongo|postgres|redis|transaction|consistency|idempot|dedupe|cache|persist|persistence|stored state|project state)\b/i,
    reason: 'The task changes persisted or coordinated state.',
  },
  {
    lane: 'migration_safety',
    pattern: /\b(migration|migrate|backfill|schema change|roll forward|rollback|upgrade|compatibility)\b/i,
    reason: 'The task includes migration or compatibility risk.',
  },
  {
    lane: 'performance',
    pattern: /\b(perf|performance|latency|slow|timeout|memory|cpu|load|scale|concurrency|batch|n\+1|query)\b/i,
    reason: 'The task may change runtime cost or responsiveness.',
  },
  {
    lane: 'docs_truth',
    pattern: /\b(docs?|readme|guide|reference|release notes|changelog|help|public copy|vitepress)\b/i,
    reason: 'The task changes product documentation or help surfaces.',
  },
  {
    lane: 'release_risk',
    pattern: /\b(deploy|production|publish|package|installer|distribution|upgrade|rollout|launch)\b/i,
    reason: 'The task affects release, deployment, or distribution behavior.',
  },
  {
    lane: 'evidence_privacy',
    pattern: /\b(log|trace|audit|archive|evidence|recording|transcript|screenshot|prompt|conversation)\b/i,
    reason: 'The task records evidence that may need retention and redaction rules.',
  },
  {
    lane: 'calibration_governance',
    pattern: /\b(calibration|eval|benchmark|reviewer|review plan|model setting|prompt|rubric|agent)\b/i,
    reason: 'The task changes review, evaluation, or agent-governance behavior.',
  },
  {
    lane: 'cost_control',
    pattern: /\b(cost|token|budget|quota|rate limit|model|provider|llm)\b/i,
    reason: 'The task affects model, provider, or resource spending.',
  },
  {
    lane: 'rollout_safety',
    pattern: /\b(flag|feature flag|rollout|gradual|canary|beta|experiment|fallback|degrade)\b/i,
    reason: 'The task needs staged rollout or fallback thinking.',
  },
]

const RECIPE_CATALOG: Array<{
  recipeId: string
  lanes: ReviewRiskLane[]
  minEffort: ReviewEffort
}> = [
  {
    recipeId: 'product-ux-zero-context',
    lanes: ['ux_comprehension', 'copy_clarity', 'visual_design', 'accessibility'],
    minEffort: 'balanced',
  },
  {
    recipeId: 'security-privacy-boundary',
    lanes: ['security', 'privacy', 'evidence_privacy'],
    minEffort: 'balanced',
  },
  {
    recipeId: 'api-data-migration-contract',
    lanes: ['api_contract', 'data_integrity', 'migration_safety'],
    minEffort: 'balanced',
  },
  {
    recipeId: 'quality-performance-release',
    lanes: ['test_adequacy', 'performance', 'release_risk', 'rollout_safety'],
    minEffort: 'lean',
  },
  {
    recipeId: 'docs-truth-and-plan',
    lanes: ['docs_truth', 'plan_completeness'],
    minEffort: 'lean',
  },
  {
    recipeId: 'agent-calibration-cost',
    lanes: ['calibration_governance', 'cost_control'],
    minEffort: 'balanced',
  },
]

export interface BuildReviewPlanInput {
  task: Pick<Task, 'id' | 'title' | 'description' | 'priority' | 'spec' | 'acceptanceCriteria' | 'outOfScope' | 'notes'>
  changedFiles?: readonly string[]
  requestedEffort?: ReviewEffort
  requiredArtifacts?: readonly string[]
  deterministicChecks?: readonly string[]
  createdAt?: string
  createdBy?: string
  budgetOverride?: ReviewBudget
}

export function buildReviewPlan(input: BuildReviewPlanInput): ReviewPlanRecord {
  const signals = detectReviewSignals(input)
  const effort = input.requestedEffort ?? inferEffort(input.task.priority, signals.selectedLanes)
  const selectedLanes = trimLanesForEffort(signals.selectedLanes, effort)
  const budget = {
    ...(effort === 'custom' ? EFFORT_BUDGETS.thorough : EFFORT_BUDGETS[effort]),
    ...input.budgetOverride,
  }
  const requiredRecipes = selectRecipes(selectedLanes, effort)
  const aggregation = Object.fromEntries(selectedLanes.map((lane) => [
    lane,
    blockingPolicyForLane(lane, effort),
  ])) as ReviewPlanRecord['aggregation']

  return {
    taskId: input.task.id,
    effort,
    depth: depthForEffort(effort),
    selectedLanes,
    skippedLanes: ALL_LANES
      .filter((lane) => !selectedLanes.includes(lane))
      .map((lane) => ({
        lane,
        reason: signals.skippedReasons.get(lane) ?? 'No signal in task text, file hints, or requested effort.',
      })),
    requiredRecipes,
    deterministicChecks: [...(input.deterministicChecks ?? defaultDeterministicChecks(selectedLanes))],
    requiredArtifacts: [...(input.requiredArtifacts ?? defaultRequiredArtifacts(selectedLanes))],
    budget,
    aggregation,
    reasons: [
      ...signals.reasons,
      `Review effort: ${effort}.`,
      `Reviewer budget: up to ${budget.maxReviewerAgents ?? 'unbounded'} grouped reviewer agent(s).`,
    ],
    createdAt: input.createdAt ?? new Date().toISOString(),
    createdBy: input.createdBy ?? 'review-planner',
  }
}

function detectReviewSignals(input: BuildReviewPlanInput): {
  selectedLanes: ReviewRiskLane[]
  reasons: string[]
  skippedReasons: Map<ReviewRiskLane, string>
} {
  const text = [
    input.task.title,
    input.task.description,
    input.task.spec ?? '',
    ...(input.task.acceptanceCriteria ?? []).map((criterion) => criterion.description),
    ...(input.task.outOfScope ?? []),
    ...(input.task.notes ?? []).map((note) => note.content),
    ...(input.changedFiles ?? []),
  ].join('\n')
  const selected = new Set<ReviewRiskLane>(['test_adequacy', 'plan_completeness'])
  const reasons = [
    'Always include test adequacy and plan completeness so work-review quality does not depend only on detected keywords.',
  ]
  const skippedReasons = new Map<ReviewRiskLane, string>()

  for (const candidate of LANE_PATTERNS) {
    if (candidate.pattern.test(text)) {
      selected.add(candidate.lane)
      reasons.push(candidate.reason)
    } else {
      skippedReasons.set(candidate.lane, 'No matching signal found in task text or changed-file hints.')
    }
  }

  if ((input.changedFiles ?? []).some((file) => /\.(svelte|tsx?|jsx?|css|scss|html)$/.test(file))) {
    selected.add('visual_design')
    selected.add('ux_comprehension')
    reasons.push('Changed-file hints include frontend or style files.')
  }
  if ((input.changedFiles ?? []).some((file) => /(^|\/)(migrations?|schema|models?)\b|\.sql$/i.test(file))) {
    selected.add('data_integrity')
    selected.add('migration_safety')
    reasons.push('Changed-file hints include schema, model, or migration paths.')
  }
  if ((input.changedFiles ?? []).some((file) => /(^|\/)(api|routes?|controllers?|handlers?)\b/i.test(file))) {
    selected.add('api_contract')
    reasons.push('Changed-file hints include API or route-owned code.')
  }

  return {
    selectedLanes: ALL_LANES.filter((lane) => selected.has(lane)),
    reasons,
    skippedReasons,
  }
}

function inferEffort(priority: TaskPriority, lanes: readonly ReviewRiskLane[]): ReviewEffort {
  let effort = PRIORITY_EFFORT[priority]
  const raiseTo = (candidate: ReviewEffort) => {
    if (EFFORT_RANK[candidate] > EFFORT_RANK[effort]) effort = candidate
  }
  if (lanes.some((lane) => ['security', 'privacy', 'migration_safety', 'data_integrity'].includes(lane))) {
    raiseTo('thorough')
  }
  if (lanes.some((lane) => ['release_risk', 'rollout_safety'].includes(lane))) {
    raiseTo('thorough')
  }
  if (priority === 'critical' && lanes.some((lane) => ['security', 'privacy', 'migration_safety', 'release_risk'].includes(lane))) {
    raiseTo('release_critical')
  }
  return effort
}

function trimLanesForEffort(lanes: readonly ReviewRiskLane[], effort: ReviewEffort): ReviewRiskLane[] {
  if (effort !== 'lean') return [...lanes]
  const leanAllowed = new Set<ReviewRiskLane>([
    'test_adequacy',
    'plan_completeness',
    'docs_truth',
    'copy_clarity',
    'api_contract',
  ])
  return lanes.filter((lane) => leanAllowed.has(lane))
}

function selectRecipes(lanes: readonly ReviewRiskLane[], effort: ReviewEffort): ReviewRecipeRef[] {
  const laneSet = new Set(lanes)
  const eligible = RECIPE_CATALOG
    .filter((recipe) =>
      recipe.lanes.some((lane) => laneSet.has(lane)) &&
      (effort === 'custom' || EFFORT_RANK[recipe.minEffort] <= EFFORT_RANK[effort]),
    )
    .map((recipe) => ({
      recipeId: recipe.recipeId,
      version: 'v1',
      lanes: recipe.lanes.filter((lane) => laneSet.has(lane)),
      blocking: recipeBlockingForEffort(effort),
      required: true,
    } satisfies ReviewRecipeRef))
  return eligible.length > 0 ? eligible : [{
    recipeId: 'quality-performance-release',
    version: 'v1',
    lanes: ['test_adequacy'],
    blocking: 'medium',
    required: true,
  }]
}

function blockingPolicyForLane(
  lane: ReviewRiskLane,
  effort: ReviewEffort,
): 'advisory' | 'blocking_on_high' | 'strict' {
  if (effort === 'lean' && lane !== 'test_adequacy') return 'advisory'
  if (effort === 'release_critical') return 'strict'
  if (['security', 'privacy', 'data_integrity', 'migration_safety', 'api_contract'].includes(lane)) {
    return 'strict'
  }
  return 'blocking_on_high'
}

function recipeBlockingForEffort(effort: ReviewEffort): ReviewRecipeRef['blocking'] {
  if (effort === 'release_critical') return 'strict'
  if (effort === 'lean') return 'medium'
  return 'high'
}

function depthForEffort(effort: ReviewEffort): ReviewPlanRecord['depth'] {
  switch (effort) {
    case 'lean':
      return 'minimal'
    case 'balanced':
      return 'standard'
    case 'thorough':
      return 'deep'
    case 'release_critical':
      return 'release_critical'
    case 'custom':
      return 'targeted'
  }
}

function defaultDeterministicChecks(lanes: readonly ReviewRiskLane[]): string[] {
  const checks = new Set(['required-verification-commands', 'changed-file-scope'])
  if (lanes.some((lane) => ['ux_comprehension', 'visual_design', 'accessibility'].includes(lane))) {
    checks.add('browser-or-screenshot-evidence')
  }
  if (lanes.includes('docs_truth')) checks.add('public-doc-copy-boundary')
  if (lanes.some((lane) => ['security', 'privacy', 'evidence_privacy'].includes(lane))) {
    checks.add('secret-and-sensitive-evidence-scan')
  }
  return [...checks]
}

function defaultRequiredArtifacts(lanes: readonly ReviewRiskLane[]): string[] {
  const artifacts = new Set(['implementation-summary', 'verification-evidence'])
  if (lanes.some((lane) => ['ux_comprehension', 'visual_design', 'accessibility'].includes(lane))) {
    artifacts.add('visual-evidence')
  }
  if (lanes.some((lane) => ['api_contract', 'data_integrity', 'migration_safety'].includes(lane))) {
    artifacts.add('contract-or-state-diff')
  }
  if (lanes.some((lane) => ['calibration_governance', 'cost_control'].includes(lane))) {
    artifacts.add('review-variant-comparison')
  }
  return [...artifacts]
}
