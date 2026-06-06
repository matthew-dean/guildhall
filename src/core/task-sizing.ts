import { z } from 'zod'

export const TaskSizeBand = z.enum(['tiny', 'small', 'medium', 'large', 'epic'])
export type TaskSizeBand = z.infer<typeof TaskSizeBand>

export const TaskSizeAction = z.enum([
  'proceed',
  'proceed_with_warning',
  'split_recommended',
  'split_required',
  'ask_clarifying_question',
])
export type TaskSizeAction = z.infer<typeof TaskSizeAction>

export const TaskSizeFactor = z.object({
  id: z.string(),
  label: z.string(),
  weight: z.number().int().nonnegative(),
  reason: z.string(),
})
export type TaskSizeFactor = z.infer<typeof TaskSizeFactor>

export const TaskSplitRecommendation = z.object({
  title: z.string(),
  reason: z.string(),
  dependsOn: z.array(z.string()).default([]),
  suggestedDomain: z.string().optional(),
  usesPrimitives: z.array(z.string()).optional(),
  provesPrimitives: z.array(z.string()).optional(),
  proofKind: z.string().optional(),
  createdTaskId: z.string().optional(),
})
export type TaskSplitRecommendation = z.infer<typeof TaskSplitRecommendation>

export const WorkUnit = z.object({
  id: z.string(),
  title: z.string(),
  deliverable: z.string(),
  rationale: z.string(),
  suggestedDomain: z.string().optional(),
  dependsOn: z.array(z.string()).default([]),
})
export type WorkUnit = z.infer<typeof WorkUnit>

export const WorkUnitAnalysis = z.object({
  summary: z.string(),
  units: z.array(WorkUnit).default([]),
  proofOnlyItems: z.array(z.string()).default([]),
  createdAt: z.string(),
  createdBy: z.string().default('coordinator-work-unit-analysis'),
})
export type WorkUnitAnalysis = z.infer<typeof WorkUnitAnalysis>

export const TaskSizePlan = z.object({
  taskId: z.string(),
  score: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(5), z.literal(8)]),
  band: TaskSizeBand,
  action: TaskSizeAction,
  factors: z.array(TaskSizeFactor).default([]),
  recommendedChildren: z.array(TaskSplitRecommendation).default([]),
  reviewBudgetHint: z.enum(['lean', 'balanced', 'thorough', 'release_critical']).optional(),
  reasons: z.array(z.string()).default([]),
  createdAt: z.string(),
  createdBy: z.string(),
})
export type TaskSizePlan = z.infer<typeof TaskSizePlan>

export interface BuildTaskSizePlanInput {
  task: {
    id: string
    title?: string
    description: string
    priority: 'critical' | 'high' | 'normal' | 'low'
    spec?: string
    acceptanceCriteria?: Array<{ description: string; [key: string]: unknown }>
    outOfScope?: string[]
    workUnitAnalysis?: WorkUnitAnalysis
  }
  changedFiles?: readonly string[]
  riskLanes?: readonly string[]
  createdAt?: string
  createdBy?: string
}

const UI_PATTERNS = /\b(ui|ux|screen|view|page|drawer|modal|form|button|settings|toolbar|dashboard|copy|docs?|browser)\b/i
const DATA_PATTERNS = /\b(database|migration|migrate|backfill|schema|subscription|stored|persistence|analytics|telemetry)\b/i
const API_PATTERNS = /\b(api|endpoint|route|webhook|contract|status code|admin)\b/i
const RELEASE_PATTERNS = /\b(release|rollout|flag|canary|deploy|launch|fallback)\b/i
const SECURITY_PATTERNS = /\b(auth|oauth|permission|privacy|pii|token|tenant|csrf|secret)\b/i

export function buildTaskSizePlan(input: BuildTaskSizePlanInput): TaskSizePlan {
  const text = inScopeTaskText(input.task)
  const files = [...new Set((input.changedFiles ?? []).map((file) => file.trim()).filter(Boolean))]
  const lanes = [...new Set((input.riskLanes ?? []).map((lane) => lane.trim()).filter(Boolean))]
  const factors: TaskSizeFactor[] = []
  const semanticPlan = sizePlanFromWorkUnitAnalysis(input)
  if (semanticPlan) return semanticPlan

  const outcomeCount = estimateOutcomeCount(text, input.task.acceptanceCriteria?.length ?? 0)
  if (isDeterministicSingleFileTask({
    text,
    files,
    acceptanceCount: input.task.acceptanceCriteria?.length ?? 0,
  })) {
    const createdAt = input.createdAt ?? new Date().toISOString()
    return TaskSizePlan.parse({
      taskId: input.task.id,
      score: 1,
      band: 'tiny',
      action: 'proceed',
      factors: [{
        id: 'deterministic_single_file',
        label: 'Deterministic single file',
        weight: 0,
        reason: 'The task creates one file with exact short content and a direct file/content proof.',
      }],
      recommendedChildren: [],
      reviewBudgetHint: 'lean',
      reasons: [
        'Task size score: 1.',
        'The task is deterministic, bounded to one file, and can be proven with a direct content check.',
      ],
      createdAt,
      createdBy: input.createdBy ?? 'task-sizing',
    })
  }
  if (isSingleFileLocalWebAppTask({ text, files })) {
    const createdAt = input.createdAt ?? new Date().toISOString()
    return TaskSizePlan.parse({
      taskId: input.task.id,
      score: 3,
      band: 'medium',
      action: 'proceed_with_warning',
      factors: [{
        id: 'single_file_web_app',
        label: 'Single-file local web app',
        weight: 1,
        reason: 'The app is bounded to one index.html file with no install or build step, so splitting would add coordination overhead instead of reducing delivery risk.',
      }],
      recommendedChildren: [],
      reviewBudgetHint: 'balanced',
      reasons: [
        'Task size score: 3.',
        'The task is a bounded single-file local web app. Proceed as one worker pass, with browser and visual review proof.',
      ],
      createdAt,
      createdBy: input.createdBy ?? 'task-sizing',
    })
  }

  if (outcomeCount >= 3) {
    factors.push({
      id: 'multiple_outcomes',
      label: 'Multiple outcomes',
      weight: 2,
      reason: `The task appears to contain ${outcomeCount} distinct outcomes.`,
    })
  }

  if (files.length >= 5) {
    factors.push({
      id: 'many_surfaces',
      label: 'Many files or surfaces',
      weight: 2,
      reason: `${files.length} likely files or surfaces are in scope.`,
    })
  } else if (files.length >= 3) {
    factors.push({
      id: 'several_surfaces',
      label: 'Several files or surfaces',
      weight: 1,
      reason: `${files.length} likely files or surfaces are in scope.`,
    })
  }

  if (lanes.length >= 5) {
    factors.push({
      id: 'many_risk_lanes',
      label: 'Many risk lanes',
      weight: 2,
      reason: `${lanes.length} review lanes are likely relevant.`,
    })
  } else if (lanes.length >= 3) {
    factors.push({
      id: 'several_risk_lanes',
      label: 'Several risk lanes',
      weight: 1,
      reason: `${lanes.length} review lanes are likely relevant.`,
    })
  }

  if (DATA_PATTERNS.test(text) || RELEASE_PATTERNS.test(text) || files.some((file) => /migration|schema|release|rollout/i.test(file))) {
    factors.push({
      id: 'migration_or_release',
      label: 'Migration or release risk',
      weight: 2,
      reason: 'The task mentions migration, persisted state, analytics, rollout, or release behavior.',
    })
  }

  const domainHits = [
    UI_PATTERNS.test(text) || files.some((file) => /\.(svelte|tsx|jsx|css)$/.test(file)),
    DATA_PATTERNS.test(text),
    API_PATTERNS.test(text) || files.some((file) => /api|route|endpoint/i.test(file)),
    SECURITY_PATTERNS.test(text),
  ].filter(Boolean).length
  if (domainHits >= 3) {
    factors.push({
      id: 'cross_domain_work',
      label: 'Cross-domain work',
      weight: 2,
      reason: 'The task crosses UI, API, data, security, or privacy boundaries.',
    })
  }

  if ((input.task.acceptanceCriteria?.length ?? 0) <= 1 && files.length <= 1 && lanes.length <= 1) {
    factors.push({
      id: 'narrow_verification',
      label: 'Narrow verification',
      weight: 1,
      reason: 'One main acceptance check and one likely surface keeps review focused.',
    })
  }

  const rawWeight = factors.reduce((sum, factor) => sum + factor.weight, 0)
  const score = scoreForWeight(rawWeight, input.task.priority)
  const action = actionForScore(score)
  const band = bandForScore(score)
  const recommendedChildren = action === 'split_recommended' || action === 'split_required'
    ? recommendChildren({ text, files, lanes })
    : []

  return TaskSizePlan.parse({
    taskId: input.task.id,
    score,
    band,
    action,
    factors,
    recommendedChildren,
    reviewBudgetHint: score >= 8 ? 'release_critical' : score >= 5 ? 'thorough' : score >= 3 ? 'balanced' : 'lean',
    reasons: [
      `Task size score: ${score}.`,
      action === 'proceed'
        ? 'The task is small enough to work and review as one coherent unit.'
        : action === 'proceed_with_warning'
          ? 'The task can proceed, but reviewers should watch for scope creep.'
          : action === 'split_recommended'
            ? 'The task is coherent but large enough that child tasks would likely improve quality.'
            : 'The task is too large for one high-quality agent pass and should become linked child tasks.',
    ],
    createdAt: input.createdAt ?? new Date().toISOString(),
    createdBy: input.createdBy ?? 'task-sizing',
  })
}

function sizePlanFromWorkUnitAnalysis(input: BuildTaskSizePlanInput): TaskSizePlan | null {
  const analysis = input.task.workUnitAnalysis
  if (!analysis || analysis.units.length === 0) return null
  const createdAt = input.createdAt ?? new Date().toISOString()
  const units = analysis.units
  if (units.length === 1) {
    return TaskSizePlan.parse({
      taskId: input.task.id,
      score: 1,
      band: 'tiny',
      action: 'proceed',
      factors: [{
        id: 'semantic_single_deliverable',
        label: 'Semantic single deliverable',
        weight: 0,
        reason: analysis.summary,
      }],
      recommendedChildren: [],
      reviewBudgetHint: 'lean',
      reasons: [
        'Task size score: 1.',
        `Semantic work-unit analysis found one deliverable: ${units[0]!.deliverable}`,
        ...(analysis.proofOnlyItems.length > 0
          ? [`Proof-only items stay with the deliverable: ${analysis.proofOnlyItems.join('; ')}`]
          : []),
      ],
      createdAt,
      createdBy: input.createdBy ?? 'task-sizing',
    })
  }

  const score = units.length >= 5 ? 8 : units.length >= 3 ? 5 : 3
  const recommendedChildren = units.map((unit) => ({
    title: unit.title,
    reason: unit.rationale || unit.deliverable,
    dependsOn: unit.dependsOn,
    ...(unit.suggestedDomain ? { suggestedDomain: unit.suggestedDomain } : {}),
  }))
  return TaskSizePlan.parse({
    taskId: input.task.id,
    score,
    band: bandForScore(score),
    action: actionForScore(score),
    factors: [{
      id: 'semantic_work_units',
      label: 'Semantic work units',
      weight: Math.min(6, units.length),
      reason: analysis.summary,
    }],
    recommendedChildren,
    reviewBudgetHint: score >= 8 ? 'release_critical' : score >= 5 ? 'thorough' : 'balanced',
    reasons: [
      `Task size score: ${score}.`,
      `Semantic work-unit analysis found ${units.length} independently deliverable units.`,
    ],
    createdAt,
    createdBy: input.createdBy ?? 'task-sizing',
  })
}

function isDeterministicSingleFileTask(input: {
  text: string
  files: readonly string[]
  acceptanceCount: number
}): boolean {
  if (input.files.length > 1) return false
  const text = input.text
  if (!/\b(?:create|write|add)\s+(?:a\s+|one\s+|single\s+)?file\b/i.test(text)) return false
  if (!/\b(?:named|called|at|path)\s+[`'"]?[\w./-]+\.[\w-]+[`'"]?/i.test(text)) return false
  if (!/\b(?:containing|content(?:s)?\s+(?:is|are)|with(?:\s+content)?)\s+exactly\b/i.test(text)) return false
  if (input.acceptanceCount > 3) return false
  const exactContent = /exactly\s+(?:the\s+string\s+)?[`'"]([^`'"\n]{1,200})[`'"]|exactly\s+([A-Z0-9_./:-]{1,200})(?:[.\s]|$)/i.exec(text)
  if (!exactContent) return false
  const domainRiskText = text
    .split('\n')
    .filter((line) => !/\b(no|not|without|none|nothing|out of scope)\b/i.test(line))
    .join('\n')
  return !(
    UI_PATTERNS.test(domainRiskText) ||
    DATA_PATTERNS.test(domainRiskText) ||
    API_PATTERNS.test(domainRiskText) ||
    RELEASE_PATTERNS.test(domainRiskText) ||
    SECURITY_PATTERNS.test(domainRiskText)
  )
}

function isSingleFileLocalWebAppTask(input: {
  text: string
  files: readonly string[]
}): boolean {
  if (input.files.length > 1) return false
  if (input.files.length === 1 && !/(^|\/)index\.html$/i.test(input.files[0] ?? '')) return false
  const text = input.text
  const asksForWebApp =
    /\b(?:build|create|implement|scaffold)\b/i.test(text) &&
    /\b(?:web app|single-page|browser app|app)\b/i.test(text)
  const singleFile =
    /\bsingle file\b/i.test(text) ||
    /\bindex\.html\b/i.test(text) ||
    input.files.some(file => /(^|\/)index\.html$/i.test(file))
  const dependencyFree =
    /\bdependency-free\b/i.test(text) ||
    /\bplain html\b/i.test(text) ||
    /\bno (?:npm|install|build step|dev server)\b/i.test(text) ||
    /\bdo not require npm install\b/i.test(text)
  const excludesNativeOrService =
    !/\b(?:ios|android|react native|swiftui|electron|backend service|api server|database|migration)\b/i.test(text)
  return asksForWebApp && singleFile && dependencyFree && excludesNativeOrService
}

function taskText(task: BuildTaskSizePlanInput['task']): string {
  return [
    task.title,
    task.description,
    task.spec,
    ...(task.acceptanceCriteria ?? []).map((criterion) => criterion.description),
    ...(task.outOfScope ?? []),
  ].filter(Boolean).join('\n')
}

function inScopeTaskText(task: BuildTaskSizePlanInput['task']): string {
  return stripOutOfScopeSections([
    task.title,
    task.description,
    task.spec,
    ...(task.acceptanceCriteria ?? []).map((criterion) => criterion.description),
  ].filter(Boolean).join('\n'))
}

function stripOutOfScopeSections(text: string): string {
  const kept: string[] = []
  let skippingOutOfScope = false
  for (const line of text.split('\n')) {
    if (/^#{2,3}\s+Out of Scope\s*$/i.test(line.trim())) {
      skippingOutOfScope = true
      continue
    }
    if (skippingOutOfScope && /^#{2,3}\s+/.test(line.trim())) {
      skippingOutOfScope = false
    }
    if (skippingOutOfScope) continue
    if (/^\s*[-*]\s+(?:no|not|without|out of scope)\b/i.test(line)) continue
    kept.push(line)
  }
  return kept.join('\n')
}

function estimateOutcomeCount(text: string, acceptanceCount: number): number {
  const verbs = text.match(/\b(add|create|update|migrate|document|ship|launch|implement|wire|build|remove|replace)\b/gi)?.length ?? 0
  const connectorSplits = text.split(/\b(?:and|plus|also)\b|[;,]/i).filter((part) => part.trim().length > 12).length
  return Math.max(acceptanceCount, Math.min(6, Math.max(1, verbs, connectorSplits)))
}

function scoreForWeight(weight: number, priority: BuildTaskSizePlanInput['task']['priority']): TaskSizePlan['score'] {
  const adjusted = priority === 'critical' || priority === 'high' ? weight + 1 : weight
  if (adjusted >= 7) return 8
  if (adjusted >= 4) return 5
  if (adjusted >= 2) return 3
  if (adjusted >= 1) return 2
  return 1
}

function bandForScore(score: TaskSizePlan['score']): TaskSizeBand {
  if (score === 1) return 'tiny'
  if (score === 2) return 'small'
  if (score === 3) return 'medium'
  if (score === 5) return 'large'
  return 'epic'
}

function actionForScore(score: TaskSizePlan['score']): TaskSizeAction {
  if (score <= 2) return 'proceed'
  if (score === 3) return 'proceed_with_warning'
  if (score === 5) return 'split_recommended'
  return 'split_required'
}

function recommendChildren(input: { text: string; files: readonly string[]; lanes: readonly string[] }): TaskSplitRecommendation[] {
  const children: TaskSplitRecommendation[] = []
  const add = (title: string, reason: string, suggestedDomain?: string) => {
    if (!children.some((child) => child.title === title)) children.push({ title, reason, suggestedDomain, dependsOn: [] })
  }

  if (/billing|subscription/i.test(input.text) || input.files.some((file) => /billing|subscription/i.test(file))) {
    add('Implement the billing settings workflow', 'Keep the user-facing workflow small enough for UX review.', 'frontend')
  }
  if (API_PATTERNS.test(input.text) || input.files.some((file) => /api|route|endpoint/i.test(file))) {
    add('Add the admin subscription API contract', 'Separate API compatibility and security review from UI work.', 'backend')
  }
  if (/migration|migrate|backfill|schema/i.test(input.text) || input.files.some((file) => /migration|schema/i.test(file))) {
    add('Migrate existing workspace subscription data', 'Give data safety, rollback, and idempotency their own verification loop.', 'data')
  }
  if (/invite|email/i.test(input.text) || input.files.some((file) => /invite|email/i.test(file))) {
    add('Implement invite email delivery', 'Keep messaging, delivery, and privacy review focused.', 'backend')
  }
  if (/analytics|telemetry|docs?|rollout/i.test(input.text) || input.lanes.includes('release_risk')) {
    add('Update analytics documentation and rollout evidence', 'Keep docs truth and rollout evidence separate from implementation.', 'docs')
  }

  if (children.length === 0) {
    add('Extract the first independently verifiable outcome', 'Start with the smallest user-visible or system-visible outcome.', undefined)
    add('Extract the second independently verifiable outcome', 'Link this child after the first task proves its boundary.', undefined)
  }
  return children
}
