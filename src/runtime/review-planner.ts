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

const LANE_PATTERNS: Array<{
  lane: ReviewRiskLane
  pattern: RegExp
  reason: string
}> = [
  {
    lane: 'ux_comprehension',
    pattern: /\b(ui|ux|screen|flow|journey|wizard|drawer|modal|button|split button|menu button|form|control|combobox|typeahead|autocomplete|select|dropdown|long list|empty state|onboarding|dashboard|browser|viewport)\b/i,
    reason: 'The task touches a user-facing interaction or screen.',
  },
  {
    lane: 'copy_clarity',
    pattern: /\b(copy|labels?|microcopy|message|error text|tooltips?|docs?|readme|guide|public docs|language|wording)\b/i,
    reason: 'The task changes wording that users or readers may rely on.',
  },
  {
    lane: 'visual_design',
    pattern: /\b(css|style|layout|spacing|color|icon|responsive|mobile|desktop|component|design system|design-system|ui library|component library|primitive|variant|props?|tokens?|svelte|react|vue|tailwind)\b/i,
    reason: 'The task changes visual presentation or component layout.',
  },
  {
    lane: 'accessibility',
    pattern: /\b(a11y|accessibility|aria|keyboard|focus|focus state|screen reader|contrast|tab order|semantic|semantics|tap target|hit target|overlap|overlaps|overlapping|reachable|controls?|combobox|typeahead|autocomplete|select|dropdown|listbox|menu button|split button|disclosure|radio|checkbox|switch|tabs?|segmented)\b/i,
    reason: 'The task mentions accessibility-sensitive behavior.',
  },
  {
    lane: 'security',
    pattern: /\b(auth|authenticated|oauth|authorization|authentication|permission|access token|api token|secret|session|csrf|xss|injection|sandbox|capability|tenant|workspace export|tenant boundary|ownership boundary)\b/i,
    reason: 'The task touches trust, permissions, or attack surface.',
  },
  {
    lane: 'privacy',
    pattern: /\b(pii|privacy|personal data|email|phone|address|user data|workspace data|tenant data|telemetry|analytics|tracking|consent|redact|redaction|support transcript|transcript snippet)\b/i,
    reason: 'The task may expose, store, or transmit user-sensitive data.',
  },
  {
    lane: 'api_contract',
    pattern: /\b(api|endpoint|route|request|response|schema|contract|webhook|graphql|rest|status code|backward compat)\b/i,
    reason: 'The task changes a boundary another caller may depend on.',
  },
  {
    lane: 'data_integrity',
    pattern: /\b(database|db|sql|mongo|postgres|redis|transaction|consistency|idempot|dedupe|cache|persist|persistence|stored state|project state|workspace data|tenant data|analytics events|side effects|evidence records|transcript snippets|support transcripts)\b/i,
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
    pattern: /\b(docs?|readme|guide|reference|release notes|changelog|help|public copy|vitepress|status code|schema)\b/i,
    reason: 'The task changes product documentation or help surfaces.',
  },
  {
    lane: 'release_risk',
    pattern: /\b(deploy|production|publish|package|installer|distribution|upgrade|rollout|launch)\b/i,
    reason: 'The task affects release, deployment, or distribution behavior.',
  },
  {
    lane: 'evidence_privacy',
    pattern: /\b(log|trace|audit|archive|evidence|recording|transcript|screenshot|prompt|conversation|telemetry|analytics)\b/i,
    reason: 'The task records evidence that may need retention and redaction rules.',
  },
  {
    lane: 'calibration_governance',
    pattern: /\b(calibration|eval|benchmark|reviewer|review plan|review planner|model setting|prompt|rubric|agent)\b/i,
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

const UI_REVIEW_LANES = new Set<ReviewRiskLane>([
  'ux_comprehension',
  'visual_design',
  'accessibility',
])

const UI_REVIEW_CHECKS = new Set([
  'browser-or-screenshot-evidence',
  'design-system-control-reference-check',
  'style-sprawl-regression-scan',
  'shared-primitive-opportunity-scan',
])

const FRONTEND_FILE_RE = /\.(svelte|tsx?|jsx?|css|scss|html)$/
const HEADLESS_ONLY_RE = /\b(no-ui|no ui|without (?:a )?(?:completed )?(?:product )?ui|without ui|no frontend|without a frontend|do not (?:add|implement|create|build|ship) (?:a |the )?(?:product )?ui|don't (?:add|implement|create|build|ship) (?:a |the )?(?:product )?ui|headless only|script-only|script only|cli-first|command-line only)\b/i
const HEADLESS_PROOF_RE = /\b(headless|script-only|script only|cli|command-line|no-ui|no ui)\b/i
const POSITIVE_UI_RE = /\b(ui|ux|screen|flow|journey|wizard|drawer|modal|button|split button|menu button|form|control|combobox|typeahead|autocomplete|select|dropdown|long list|empty state|onboarding|dashboard|browser|viewport)\b/i

export interface BuildReviewPlanInput {
  task: Pick<Task, 'id' | 'title' | 'description' | 'priority' | 'spec' | 'acceptanceCriteria' | 'outOfScope' | 'notes'> & Partial<Pick<Task, 'status' | 'productBrief'>>
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
        reason: signals.skippedReasons.get(lane) ?? 'No signal in task text, file hints, or requested effort.',
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
  const text = reviewSignalText(input)
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

  if (/\b(design system|design-system|ui library|component library|primitive|split button|menu button|layout control|variant|props?|control choice|when to use|combobox|typeahead|autocomplete|long list|select list|dropdown)\b/i.test(text)) {
    selected.add('ux_comprehension')
    selected.add('visual_design')
    selected.add('accessibility')
    reasons.push('Design-system control selection needs reviewer context for component intent, variants, layout ownership, anti-sprawl extraction opportunities, findability, and accessible semantics.')
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

  if (isHeadlessOnlyTask(input, text)) {
    for (const lane of UI_REVIEW_LANES) selected.delete(lane)
    for (const lane of UI_REVIEW_LANES) {
      skippedReasons.set(lane, 'Task declares headless/no-UI proof and has no frontend changed-file hint.')
    }
    reasons.push('Headless/no-UI proof scope removes product UI review lanes and visual evidence requirements.')
  }

  return {
    selectedLanes: ALL_LANES.filter((lane) => selected.has(lane)),
    reasons,
    skippedReasons,
    text,
  }
}

function reviewSignalText(input: BuildReviewPlanInput): string {
  return [
    input.task.title,
    input.task.description,
    input.task.spec ?? '',
    input.task.productBrief?.userJob ?? '',
    input.task.productBrief?.whyItMattersNow ?? '',
    ...(input.task.productBrief?.nonGoals ?? []),
    ...(input.task.productBrief?.antiPatterns ?? []),
    ...(input.task.acceptanceCriteria ?? []).map((criterion) => criterion.description),
    ...(input.task.outOfScope ?? []),
    ...(input.task.notes ?? []).map((note) => note.content),
    ...(input.changedFiles ?? []),
  ].join('\n')
}

function hasFrontendChangedFile(input: BuildReviewPlanInput): boolean {
  return (input.changedFiles ?? []).some((file) => FRONTEND_FILE_RE.test(file))
}

function isHeadlessOnlyTask(input: BuildReviewPlanInput, text = reviewSignalText(input)): boolean {
  if (hasFrontendChangedFile(input)) return false
  if (HEADLESS_ONLY_RE.test(text)) return true
  if (!HEADLESS_PROOF_RE.test(text)) return false
  const withoutNegatedUi = text
    .replace(/\bno-ui\b/gi, '')
    .replace(/\bno ui\b/gi, '')
    .replace(/\bwithout (?:a )?(?:completed )?(?:product )?ui\b/gi, '')
    .replace(/\bwithout ui\b/gi, '')
    .replace(/\bno frontend\b/gi, '')
    .replace(/\bwithout a frontend\b/gi, '')
  return !POSITIVE_UI_RE.test(withoutNegatedUi)
}

export function normalizeReviewPlanForTask(
  input: BuildReviewPlanInput,
  plan: ReviewPlanRecord,
): { changed: boolean; plan: ReviewPlanRecord } {
  const headless = isHeadlessOnlyTask(input)
  const selectedLanes = headless
    ? plan.selectedLanes.filter((lane) => !UI_REVIEW_LANES.has(lane))
    : plan.selectedLanes
  const deterministicChecks = input.deterministicChecks
    ? [...input.deterministicChecks]
    : plan.deterministicChecks
  const changed =
    selectedLanes.length !== plan.selectedLanes.length ||
    (headless && plan.requiredArtifacts.includes('visual-evidence')) ||
    JSON.stringify(deterministicChecks) !== JSON.stringify(plan.deterministicChecks)
  if (!changed) return { changed: false, plan }
  const aggregation = headless
    ? Object.fromEntries(
        Object.entries(plan.aggregation).filter(([lane]) => !UI_REVIEW_LANES.has(lane as ReviewRiskLane)),
      ) as ReviewPlanRecord['aggregation']
    : plan.aggregation
  return {
    changed: true,
    plan: {
      ...plan,
      selectedLanes,
      skippedLanes: headless
        ? [
            ...plan.skippedLanes.filter((entry) => !UI_REVIEW_LANES.has(entry.lane)),
            ...[...UI_REVIEW_LANES].map((lane) => ({
              lane,
              reason: 'Task declares headless/no-UI proof and has no frontend changed-file hint.',
            })),
          ]
        : plan.skippedLanes,
      requiredRecipes: headless
        ? plan.requiredRecipes
            .map((recipe) => ({
              ...recipe,
              lanes: recipe.lanes.filter((lane) => !UI_REVIEW_LANES.has(lane)),
            }))
            .filter((recipe) => recipe.lanes.length > 0)
        : plan.requiredRecipes,
      deterministicChecks: headless
        ? deterministicChecks.filter((check) => !UI_REVIEW_CHECKS.has(check))
        : deterministicChecks,
      requiredArtifacts: headless
        ? plan.requiredArtifacts.filter((artifact) => artifact !== 'visual-evidence')
        : plan.requiredArtifacts,
      aggregation,
      reasons: [
        ...plan.reasons,
        'Headless/no-UI proof scope removes product UI review lanes and visual evidence requirements.',
      ],
    },
  }
}

function selectAdvisoryLenses(
  input: BuildReviewPlanInput,
  signals: { text: string },
  lanes: readonly ReviewRiskLane[],
  effort: ReviewEffort,
): ReviewAdvisoryLens[] {
  const selected: ReviewAdvisoryLens[] = []
  const add = (lens: ReviewAdvisoryLens['lens'], reason: string) => {
    if (selected.some((candidate) => candidate.lens === lens)) return
    selected.push({ lens, reason, blocking: 'advisory' })
  }
  const laneSet = new Set(lanes)
  const text = signals.text
  const isSpecShaping = ['exploring', 'spec_review', 'proposed'].includes(input.task.status ?? '')
  const isAmbiguous = /\b(ambiguous|unclear|rough|shape|spec|boundary|acceptance criteria|proof path|what should|not sure)\b/i.test(text)
  const isHighRisk = effort === 'thorough' || effort === 'release_critical'
  const isReaderOrUserFacing =
    laneSet.has('ux_comprehension') ||
    laneSet.has('copy_clarity') ||
    laneSet.has('docs_truth')
  const asksForFutureOpportunity = /\b(future|follow-up|opportunit|roadmap|explor|later|next phase)\b/i.test(text)

  if (isSpecShaping || isAmbiguous || isReaderOrUserFacing) {
    add('first_principles', 'Check the real user job, task boundary, and simplest useful shape before implementation.')
  }
  if (isAmbiguous || isHighRisk) {
    add('contrarian', 'Pressure-test fragile assumptions and false consensus before the plan is accepted.')
  }

  add('executor', 'Keep the recommendation tied to the smallest runnable and provable next move.')

  if (isReaderOrUserFacing) {
    add('outsider', 'Read the result like a new user or reader who does not know Guildhall internals.')
  }
  if (asksForFutureOpportunity) {
    add('expansionist', 'Capture adjacent opportunities as non-blocking follow-up instead of expanding this task.')
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
