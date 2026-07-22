import type { ReviewRiskProfile, Task, TaskPriority } from '@guildhall/core'
import type {
  ReviewBudget,
  ReviewEffort,
  ReviewAuditStore,
  ReviewAdvisoryLens,
  ReviewPlanRecord,
  ReviewRecipeRef,
  ReviewRiskLane,
} from './review-audit-store.js'
import { selectCalibrationRecipesForLanes } from './review-calibration.js'

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

const STRUCTURED_REVIEW_LANES = new Set<ReviewRiskLane>(ALL_LANES)

export interface BuildReviewPlanInput {
  task: Pick<Task, 'id' | 'title' | 'description' | 'priority' | 'spec' | 'acceptanceCriteria' | 'outOfScope' | 'notes'> & Partial<Pick<Task, 'status' | 'productBrief' | 'requestIntake' | 'taskKind' | 'workKind' | 'reviewRisk'>>
  changedFiles?: readonly string[]
  requestedEffort?: ReviewEffort
  requiredArtifacts?: readonly string[]
  deterministicChecks?: readonly string[]
  createdAt?: string
  createdBy?: string
  budgetOverride?: ReviewBudget
}

export interface EnsureTaskReviewPlanRecordedInput extends Omit<BuildReviewPlanInput, 'createdAt'> {
  store: Pick<ReviewAuditStore, 'readTaskReviewAudit' | 'saveReviewPlan' | 'appendReviewPlanEvent'>
  now?: () => Date
}

export interface EnsureTaskReviewPlanRecordedResult {
  recorded: boolean
  plan: ReviewPlanRecord
  reviewRisk: ReviewRiskProfile
}

export interface ReviewArtifactReadiness {
  ready: boolean
  missingArtifacts: string[]
  reason: string
}

export function buildReviewPlan(input: BuildReviewPlanInput): ReviewPlanRecord {
  const signals = detectReviewSignals(input)
  const effort = resolveReviewEffort({
    requestedEffort: input.requestedEffort,
    inferredEffort: inferEffort(input.task.priority, signals.selectedLanes),
  })
  const selectedLanes = trimLanesForEffort(signals.selectedLanes, effort)
  const budget = {
    ...(effort === 'custom' ? EFFORT_BUDGETS.thorough : EFFORT_BUDGETS[effort]),
    ...input.budgetOverride,
  }
  const requiredRecipes = selectRecipes(selectedLanes, effort)
  const advisoryLenses = selectAdvisoryLenses(input, signals, selectedLanes, effort)
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
        reason: signals.skippedReasons.get(lane) ?? 'No structured review-risk lane or observable changed-file signal selected this lane.',
      })),
    requiredRecipes,
    advisoryLenses,
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

export async function ensureTaskReviewPlanRecorded(
  input: EnsureTaskReviewPlanRecordedInput,
): Promise<EnsureTaskReviewPlanRecordedResult> {
  const existing = await input.store.readTaskReviewAudit(input.task.id)
  if (existing.plan) {
    const normalized = normalizeReviewPlanForTask(input, existing.plan.payload)
    if (normalized.changed) {
      await input.store.saveReviewPlan(normalized.plan)
      const checksChanged = input.deterministicChecks !== undefined &&
        JSON.stringify(existing.plan.payload.deterministicChecks) !== JSON.stringify(normalized.plan.deterministicChecks)
      await input.store.appendReviewPlanEvent({
        taskId: normalized.plan.taskId,
        kind: 'override',
        summary: checksChanged
          ? 'Refreshed stored review checks to the current task proof contract and removed any inapplicable review scope.'
          : 'Removed UI review artifacts from a stored plan after the task resolved to headless/no-UI proof.',
        lanes: normalized.plan.selectedLanes,
        recordedBy: input.createdBy ?? 'review-planner',
        recordedAt: (input.now?.() ?? new Date()).toISOString(),
      })
    }
    return {
      recorded: normalized.changed,
      plan: normalized.plan,
      reviewRisk: buildTaskReviewRiskProfile(normalized.plan),
    }
  }

  const plan = buildReviewPlan({
    ...input,
    createdAt: (input.now?.() ?? new Date()).toISOString(),
    createdBy: input.createdBy ?? 'review-planner',
  })
  await input.store.saveReviewPlan(plan)
  await input.store.appendReviewPlanEvent({
    taskId: plan.taskId,
    kind: 'created',
    summary: `Planned ${plan.effort} review across ${plan.selectedLanes.length} risk lane(s).`,
    lanes: plan.selectedLanes,
    recordedBy: plan.createdBy,
    recordedAt: plan.createdAt,
  })
  return {
    recorded: true,
    plan,
    reviewRisk: buildTaskReviewRiskProfile(plan),
  }
}

export function buildTaskReviewRiskProfile(plan: ReviewPlanRecord): ReviewRiskProfile {
  const releaseBlockingThresholds = new Set(['high', 'strict'])
  return {
    lanes: [...plan.selectedLanes],
    recipes: plan.requiredRecipes.map((recipe) => ({
      recipeId: recipe.recipeId,
      version: recipe.version,
      required: recipe.required,
      releaseBlocking: recipe.required && releaseBlockingThresholds.has(recipe.blocking),
      lanes: [...recipe.lanes],
      requiredArtifacts: requiredArtifactsForRecipe(recipe, plan.requiredArtifacts),
      reason: `Covers ${recipe.lanes.join(', ') || 'declared review'} at ${recipe.blocking} blocking strength.`,
    })),
    requiredArtifacts: [...plan.requiredArtifacts],
    artifactPolicy: plan.requiredArtifacts.length > 0 ? 'required_before_review' : 'advisory',
    assessedAt: plan.createdAt,
    assessedBy: plan.createdBy,
  }
}

export function evaluateReviewArtifactReadiness(input: {
  reviewRisk: Pick<ReviewRiskProfile, 'requiredArtifacts' | 'artifactPolicy'> | null | undefined
  artifactRefs: readonly string[]
}): ReviewArtifactReadiness {
  const reviewRisk = input.reviewRisk
  if (!reviewRisk || reviewRisk.artifactPolicy !== 'required_before_review') {
    return {
      ready: true,
      missingArtifacts: [],
      reason: 'No blocking review artifact policy is declared.',
    }
  }
  const provided = new Set(input.artifactRefs)
  const missingArtifacts = reviewRisk.requiredArtifacts.filter((artifact) => !provided.has(artifact))
  return {
    ready: missingArtifacts.length === 0,
    missingArtifacts,
    reason: missingArtifacts.length === 0
      ? 'All required review artifacts are present.'
      : `Missing required review artifact(s): ${missingArtifacts.join(', ')}.`,
  }
}

function resolveReviewEffort(input: {
  requestedEffort?: ReviewEffort
  inferredEffort: ReviewEffort
}): ReviewEffort {
  if (!input.requestedEffort) return input.inferredEffort
  if (input.requestedEffort === 'custom') return 'custom'
  return EFFORT_RANK[input.inferredEffort] > EFFORT_RANK[input.requestedEffort]
    ? input.inferredEffort
    : input.requestedEffort
}

function detectReviewSignals(input: BuildReviewPlanInput): {
  selectedLanes: ReviewRiskLane[]
  reasons: string[]
  skippedReasons: Map<ReviewRiskLane, string>
  text: string
} {
  const selected = new Set<ReviewRiskLane>(['test_adequacy', 'plan_completeness'])
  const reasons = [
    'Always include test adequacy and plan completeness; model wording cannot change the review baseline.',
  ]
  const skippedReasons = new Map<ReviewRiskLane, string>()

  const declaredLanes = (input.task.reviewRisk?.lanes ?? [])
    .filter((lane): lane is ReviewRiskLane => STRUCTURED_REVIEW_LANES.has(lane as ReviewRiskLane))
  for (const lane of declaredLanes) selected.add(lane)
  if (declaredLanes.length > 0) {
    reasons.push(`Review lanes came from the structured review-risk declaration: ${declaredLanes.join(', ')}.`)
  } else {
    reasons.push('No structured review-risk lanes were declared; Guildhall will not infer them from prose.')
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

  for (const lane of ALL_LANES) {
    if (!selected.has(lane)) {
      skippedReasons.set(lane, declaredLanes.length > 0
        ? 'The structured review-risk declaration did not include this lane.'
        : 'No structured review-risk declaration or observable changed-file signal selected this lane.')
    }
  }

  return {
    selectedLanes: ALL_LANES.filter((lane) => selected.has(lane)),
    reasons,
    skippedReasons,
    text: '',
  }
}

export function normalizeReviewPlanForTask(
  input: BuildReviewPlanInput,
  plan: ReviewPlanRecord,
): { changed: boolean; plan: ReviewPlanRecord } {
  const deterministicChecks = input.deterministicChecks
    ? [...input.deterministicChecks]
    : plan.deterministicChecks
  const changed =
    JSON.stringify(deterministicChecks) !== JSON.stringify(plan.deterministicChecks)
  if (!changed) return { changed: false, plan }
  return {
    changed: true,
    plan: {
      ...plan,
      deterministicChecks,
    },
  }
}

function selectAdvisoryLenses(
  input: BuildReviewPlanInput,
  _signals: { text: string },
  lanes: readonly ReviewRiskLane[],
  effort: ReviewEffort,
): ReviewAdvisoryLens[] {
  const selected: ReviewAdvisoryLens[] = []
  const add = (lens: ReviewAdvisoryLens['lens'], reason: string) => {
    if (selected.some((candidate) => candidate.lens === lens)) return
    selected.push({ lens, reason, blocking: 'advisory' })
  }
  const laneSet = new Set(lanes)
  const isSpecShaping = ['exploring', 'spec_review', 'proposed'].includes(input.task.status ?? '')
  const intake = input.task.requestIntake
  const isAmbiguous = Boolean(
    intake?.ownerDecisionNeeded ||
    (intake?.missingInformation?.length ?? 0) > 0 ||
    intake?.recommendedNextAction === 'ask_clarifying_question',
  )
  const isHighRisk = effort === 'thorough' || effort === 'release_critical'
  const isReaderOrUserFacing =
    laneSet.has('ux_comprehension') ||
    laneSet.has('copy_clarity') ||
    laneSet.has('docs_truth')
  const isExploratory = input.task.taskKind === 'research' || input.task.taskKind === 'spike' || input.task.workKind === 'research'

  if (isSpecShaping || isAmbiguous || isReaderOrUserFacing || isExploratory) {
    add('first_principles', 'Check the real user job, task boundary, and simplest useful shape before implementation.')
  }
  if (isAmbiguous || isHighRisk || isExploratory) {
    add('contrarian', 'Pressure-test fragile assumptions and false consensus before the plan is accepted.')
  }

  add('executor', 'Keep the recommendation tied to the smallest runnable and provable next move.')

  if (isReaderOrUserFacing) {
    add('outsider', 'Read the result like a new user or reader who does not know Guildhall internals.')
  }
  return selected
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
      calibrationRecipeIds: selectCalibrationRecipesForLanes(
        recipe.lanes.filter((lane) => laneSet.has(lane)),
      ).map((calibrationRecipe) => calibrationRecipe.id),
    } satisfies ReviewRecipeRef))
  return eligible.length > 0 ? eligible : [{
    recipeId: 'quality-performance-release',
    version: 'v1',
    lanes: ['test_adequacy'],
    blocking: 'medium',
    required: true,
    calibrationRecipeIds: [],
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
    checks.add('design-system-control-reference-check')
    checks.add('style-sprawl-regression-scan')
    checks.add('shared-primitive-opportunity-scan')
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

function requiredArtifactsForRecipe(
  recipe: ReviewRecipeRef,
  planRequiredArtifacts: readonly string[],
): string[] {
  const artifacts = new Set<string>()
  if (recipe.lanes.some((lane) => ['ux_comprehension', 'visual_design', 'accessibility'].includes(lane))) {
    artifacts.add('visual-evidence')
  }
  if (recipe.lanes.some((lane) => ['api_contract', 'data_integrity', 'migration_safety'].includes(lane))) {
    artifacts.add('contract-or-state-diff')
  }
  for (const artifact of planRequiredArtifacts) {
    if (
      artifact === 'implementation-summary' ||
      artifact === 'verification-evidence' ||
      artifacts.has(artifact)
    ) {
      artifacts.add(artifact)
    }
  }
  return [...artifacts]
}
