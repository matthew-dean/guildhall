import { z } from 'zod'

export const TaskSizeBand = z.enum(['tiny', 'small', 'medium', 'large', 'epic'])
export type TaskSizeBand = z.infer<typeof TaskSizeBand>

export const TaskSizeAction = z.enum([
  'proceed',
  'proceed_with_warning',
  'decompose_before_execution',
  'needs_scope_authority',
  // Legacy compatibility only. New sizing writes should not use these actions.
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
  /** Stable work-unit identity. Display wording is never an identity key. */
  identity: z.string().min(1).optional(),
  title: z.string(),
  reason: z.string(),
  dependsOn: z.array(z.string()).default([]),
  suggestedDomain: z.string().optional(),
  /** Explicit child lane; never infer this from the child's title. */
  suggestedTaskKind: z.enum([
    'app_spec',
    'feature_spec',
    'feature',
    'implementation',
    'component',
    'primitive',
    'story',
    'test',
    'setup',
    'research',
    'decision',
    'spike',
    'cleanup',
    'verification',
    'release',
    'learning',
  ]).optional(),
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
  /** Explicit child lane; prose remains display-only. */
  suggestedTaskKind: z.enum([
    'app_spec',
    'feature_spec',
    'feature',
    'implementation',
    'component',
    'primitive',
    'story',
    'test',
    'setup',
    'research',
    'decision',
    'spike',
    'cleanup',
    'verification',
    'release',
    'learning',
  ]).optional(),
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
  // Legacy compatibility only. New decomposition writes create execution-plan
  // actions and derive child drafts on demand instead of persisting suggestions.
  recommendedChildren: z.array(TaskSplitRecommendation).default([]),
  reviewBudgetHint: z.enum(['lean', 'balanced', 'thorough', 'release_critical']).optional(),
  reasons: z.array(z.string()).default([]),
  createdAt: z.string(),
  createdBy: z.string(),
})
export type TaskSizePlan = z.infer<typeof TaskSizePlan>

/**
 * Explicit sizing inputs for records that predate a full StructuredSpec.
 * These are data fields, not a second prose parser. They are useful for
 * imported work while the migration writes the canonical structured payload.
 */
export interface StructuredSizingSignals {
  acceptanceCriteriaCount?: number
  contractSurfaceCount?: number
  splitPolicy?: 'none' | 'conditional' | 'required'
}

export interface BuildTaskSizePlanInput {
  task: {
    id: string
    // Kept in the input shape for callers and audit output. Sizing deliberately
    // ignores title, description, spec, and free-form criterion descriptions.
    title?: string
    description: string
    priority: 'critical' | 'high' | 'normal' | 'low'
    spec?: string
    acceptanceCriteria?: Array<{ description: string; [key: string]: unknown }>
    outOfScope?: string[]
    workUnitAnalysis?: WorkUnitAnalysis
    structuredSignals?: StructuredSizingSignals
    structuredSpec?: {
      acceptanceCriteria?: readonly unknown[]
      contractSurfaceDeltas?: readonly unknown[]
      completionBoundary?: { splitPolicy?: string }
    }
  }
  changedFiles?: readonly string[]
  riskLanes?: readonly string[]
  createdAt?: string
  createdBy?: string
}

interface SizingSignals {
  acceptanceCriteriaCount: number
  contractSurfaceCount: number
  splitPolicy: StructuredSizingSignals['splitPolicy']
}

export function buildTaskSizePlan(input: BuildTaskSizePlanInput): TaskSizePlan {
  const files = uniqueNonEmpty(input.changedFiles ?? [])
  const lanes = uniqueNonEmpty(input.riskLanes ?? [])
  const signals = sizingSignals(input)
  // A persisted split boundary is an execution contract. Work-unit analysis
  // can explain the split, but it must never weaken that contract.
  if (signals.splitPolicy === 'required') {
    const createdAt = input.createdAt ?? new Date().toISOString()
    const semanticChildren = buildDecompositionChildDrafts(input)
    return TaskSizePlan.parse({
      taskId: input.task.id,
      score: 8,
      band: 'epic',
      action: 'decompose_before_execution',
      factors: [{
        id: 'explicit_split_boundary',
        label: 'Explicit split boundary',
        weight: 8,
        reason: 'The structured completion boundary requires this work to be decomposed before execution.',
      }],
      recommendedChildren: semanticChildren,
      reviewBudgetHint: 'release_critical',
      reasons: [
        'Task size score: 8.',
        'The structured completion boundary requires decomposition before execution.',
      ],
      createdAt,
      createdBy: input.createdBy ?? 'task-sizing',
    })
  }
  const semanticPlan = sizePlanFromWorkUnitAnalysis(input)
  if (semanticPlan) return semanticPlan

  const factors: TaskSizeFactor[] = []
  if (signals.acceptanceCriteriaCount >= 5) {
    factors.push({
      id: 'multiple_outcomes',
      label: 'Multiple acceptance obligations',
      weight: 1,
      reason: `${signals.acceptanceCriteriaCount} structured acceptance obligations are in scope.`,
    })
  }

  if (files.length >= 5) {
    factors.push({
      id: 'many_surfaces',
      label: 'Many changed surfaces',
      weight: 2,
      reason: `${files.length} changed-file surfaces are recorded in the work evidence.`,
    })
  } else if (files.length >= 3) {
    factors.push({
      id: 'several_surfaces',
      label: 'Several changed surfaces',
      weight: 1,
      reason: `${files.length} changed-file surfaces are recorded in the work evidence.`,
    })
  }

  if (lanes.length >= 5) {
    factors.push({
      id: 'many_risk_lanes',
      label: 'Many review lanes',
      weight: 2,
      reason: `${lanes.length} structured review lanes are attached to the work.`,
    })
  } else if (lanes.length >= 3) {
    factors.push({
      id: 'several_risk_lanes',
      label: 'Several review lanes',
      weight: 2,
      reason: `${lanes.length} structured review lanes are attached to the work.`,
    })
  }

  if (signals.contractSurfaceCount >= 3) {
    factors.push({
      id: 'many_contract_surfaces',
      label: 'Many contract surfaces',
      weight: 2,
      reason: `${signals.contractSurfaceCount} structured contract-surface deltas are declared.`,
    })
  } else if (signals.contractSurfaceCount >= 1) {
    factors.push({
      id: 'contract_surface',
      label: 'Contract surface',
      weight: 0,
      reason: `${signals.contractSurfaceCount} structured contract-surface delta is declared.`,
    })
  }

  if (hasPersistenceOrReleaseSurface(files)) {
    factors.push({
      id: 'migration_or_release',
      label: 'Persistence or release surface',
      weight: 1,
      reason: 'Changed-file evidence includes a migration, persistence, rollout, or release surface.',
    })
  }

  if (distinctObservedSurfaceKinds(files) >= 3) {
    factors.push({
      id: 'cross_domain_work',
      label: 'Cross-domain work',
      weight: 2,
      reason: 'Changed-file evidence spans at least three observable surface kinds.',
    })
  }

  if (signals.acceptanceCriteriaCount <= 1 && files.length <= 1 && lanes.length <= 1 && signals.contractSurfaceCount <= 1) {
    factors.push({
      id: 'narrow_verification',
      label: 'Narrow verification',
      weight: 1,
      reason: 'The structured contract names at most one acceptance obligation, one changed surface, and one review lane.',
    })
  }

  const rawWeight = factors.reduce((sum, factor) => sum + factor.weight, 0)
  const score = scoreForWeight(rawWeight, input.task.priority)
  const action = actionForScore(score)
  const band = bandForScore(score)
  return TaskSizePlan.parse({
    taskId: input.task.id,
    score,
    band,
    action,
    factors,
    recommendedChildren: [],
    reviewBudgetHint: score >= 8 ? 'release_critical' : score >= 5 ? 'thorough' : score >= 3 ? 'balanced' : 'lean',
    reasons: [
      `Task size score: ${score}.`,
      action === 'proceed'
        ? 'The structured work contract is small enough to work and review as one coherent unit.'
        : action === 'proceed_with_warning'
          ? 'The structured work contract can proceed, but reviewers should watch the declared risk surfaces.'
          : action === 'decompose_before_execution'
            ? 'The structured work contract is too large for one high-quality agent pass and Guildhall should decompose it before execution.'
            : 'The task needs scope authority before execution can proceed.',
    ],
    createdAt: input.createdAt ?? new Date().toISOString(),
    createdBy: input.createdBy ?? 'task-sizing',
  })
}

function sizingSignals(input: BuildTaskSizePlanInput): SizingSignals {
  const explicit = input.task.structuredSignals
  const spec = input.task.structuredSpec
  return {
    acceptanceCriteriaCount: explicit?.acceptanceCriteriaCount ?? spec?.acceptanceCriteria?.length ?? input.task.acceptanceCriteria?.length ?? 0,
    contractSurfaceCount: explicit?.contractSurfaceCount ?? spec?.contractSurfaceDeltas?.length ?? 0,
    splitPolicy: explicit?.splitPolicy ?? normalizeSplitPolicy(spec?.completionBoundary?.splitPolicy),
  }
}

function normalizeSplitPolicy(value: string | undefined): StructuredSizingSignals['splitPolicy'] {
  return value === 'none' || value === 'conditional' || value === 'required' ? value : undefined
}

function uniqueNonEmpty(values: readonly string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))]
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
    recommendedChildren: [],
    reviewBudgetHint: score >= 8 ? 'release_critical' : score >= 5 ? 'thorough' : 'balanced',
    reasons: [
      `Task size score: ${score}.`,
      `Semantic work-unit analysis found ${units.length} independently deliverable units.`,
    ],
    createdAt,
    createdBy: input.createdBy ?? 'task-sizing',
  })
}

function hasPersistenceOrReleaseSurface(files: readonly string[]): boolean {
  return files.some((file) => /(^|\/)(migrations?|persistence|database|db|releases?|rollout)(\/|\.|$)/i.test(file))
}

function distinctObservedSurfaceKinds(files: readonly string[]): number {
  const kinds = new Set<string>()
  for (const file of files) {
    if (/\.(svelte|tsx|jsx|css|html)$/i.test(file)) kinds.add('ui')
    if (/(^|\/)(api|routes?|endpoints?)(\/|\.|$)/i.test(file)) kinds.add('api')
    if (/(^|\/)(migrations?|persistence|database|db|schema)(\/|\.|$)/i.test(file)) kinds.add('data')
    if (/(^|\/)(docs?|internal)(\/|\.|$)/i.test(file)) kinds.add('docs')
    if (/\.(test|spec)\.[^.]+$/i.test(file) || /(^|\/)(test|tests|fixtures)(\/|\.|$)/i.test(file)) kinds.add('verification')
  }
  return kinds.size
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
  return 'decompose_before_execution'
}

export function buildDecompositionChildDrafts(input: BuildTaskSizePlanInput): TaskSplitRecommendation[] {
  const analysis = input.task.workUnitAnalysis
  if (analysis?.units.length) {
    return analysis.units.map((unit) => ({
      identity: unit.id,
      title: unit.title,
      reason: unit.rationale || unit.deliverable,
      dependsOn: unit.dependsOn,
      ...(unit.suggestedDomain ? { suggestedDomain: unit.suggestedDomain } : {}),
      ...(unit.suggestedTaskKind ? { suggestedTaskKind: unit.suggestedTaskKind } : {}),
    }))
  }
  return []
}
