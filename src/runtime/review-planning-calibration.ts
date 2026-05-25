import fs from 'node:fs/promises'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import type { TaskPriority } from '@guildhall/core'

import { buildReviewPlan } from './review-planner.js'
import {
  ReviewRiskLane,
  type ReviewAuditStore,
  type ReviewEffort,
  type ReviewPlanRecord,
} from './review-audit-store.js'

const TaskPrioritySchema = z.enum(['low', 'normal', 'high', 'critical'])

export const ReviewRecipeBundleMetadata = z.object({
  recipeId: z.string().min(1),
  lanes: z.array(ReviewRiskLane).min(1),
  canSplit: z.boolean(),
  highStakes: z.boolean(),
  splitInto: z.array(z.string().min(1)).default([]),
  evidenceRequiredBeforeBundling: z.array(z.string().min(1)).default([]),
})
export type ReviewRecipeBundleMetadata = z.infer<typeof ReviewRecipeBundleMetadata>

export const defaultReviewRecipeBundles: ReviewRecipeBundleMetadata[] = [
  {
    recipeId: 'product-ux-zero-context',
    lanes: ['ux_comprehension', 'copy_clarity', 'visual_design', 'accessibility'],
    canSplit: true,
    highStakes: false,
    splitInto: ['ux_comprehension', 'copy_clarity', 'visual_design', 'accessibility'],
    evidenceRequiredBeforeBundling: ['planning corpus coverage for every bundled lane'],
  },
  {
    recipeId: 'security-privacy-boundary',
    lanes: ['security', 'privacy', 'evidence_privacy'],
    canSplit: true,
    highStakes: true,
    splitInto: ['security', 'privacy', 'evidence_privacy'],
    evidenceRequiredBeforeBundling: ['security and privacy cases pass independently before bundling'],
  },
  {
    recipeId: 'api-data-migration-contract',
    lanes: ['api_contract', 'data_integrity', 'migration_safety'],
    canSplit: true,
    highStakes: true,
    splitInto: ['api_contract', 'data_integrity', 'migration_safety'],
    evidenceRequiredBeforeBundling: ['API, data, and migration cases each preserve strict aggregation'],
  },
  {
    recipeId: 'quality-performance-release',
    lanes: ['test_adequacy', 'performance', 'release_risk', 'rollout_safety'],
    canSplit: true,
    highStakes: false,
    splitInto: ['test_adequacy', 'performance', 'release_risk', 'rollout_safety'],
    evidenceRequiredBeforeBundling: ['performance and rollout misses stay below the frontier threshold'],
  },
  {
    recipeId: 'docs-truth-and-plan',
    lanes: ['docs_truth', 'plan_completeness'],
    canSplit: true,
    highStakes: false,
    splitInto: ['docs_truth', 'plan_completeness'],
    evidenceRequiredBeforeBundling: ['docs truth cases do not degrade into tone-only feedback'],
  },
]

export type ReviewRecipeBundleMode =
  | 'default_bundles'
  | 'split_ux_copy'

export const ReviewPlanningCalibrationCase = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  task: z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    description: z.string().default(''),
    priority: TaskPrioritySchema,
    changedFiles: z.array(z.string().min(1)).default([]),
  }),
  expected: z.object({
    requiredLanes: z.array(ReviewRiskLane).default([]),
    forbiddenLanes: z.array(ReviewRiskLane).default([]),
    requiredArtifacts: z.array(z.string().min(1)).default([]),
    deterministicChecks: z.array(z.string().min(1)).default([]),
    strictLanes: z.array(ReviewRiskLane).default([]),
    minEffort: z.enum(['lean', 'balanced', 'thorough', 'release_critical']).optional(),
    maxReviewerAgents: z.number().int().min(1).optional(),
  }),
  labelGovernance: z.object({
    labeledBy: z.string().min(1),
    labeledAt: z.string().min(1),
    reviewStatus: z.enum(['seed', 'reviewed', 'retired']),
  }),
})
export type ReviewPlanningCalibrationCase = z.infer<typeof ReviewPlanningCalibrationCase>

export type ReviewPlanningOutcome = 'pass' | 'partial' | 'miss'

export interface ReviewPlanningGrade {
  outcome: ReviewPlanningOutcome
  matchedLaneIds: ReviewRiskLane[]
  missedLaneIds: ReviewRiskLane[]
  falsePositiveLaneIds: ReviewRiskLane[]
  missingArtifactIds: string[]
  missingCheckIds: string[]
  aggregationMisses: ReviewRiskLane[]
  budgetWithinLimit: boolean
}

export interface ReviewPlanningFrontierVariant {
  variantId: string
  reviewEffort: Exclude<ReviewEffort, 'custom'>
  recipeBundleMode?: ReviewRecipeBundleMode
}

export interface ReviewPlanningFrontierRun {
  variantId: string
  reviewEffort: Exclude<ReviewEffort, 'custom'>
  caseCount: number
  passCount: number
  partialCount: number
  missCount: number
  laneRecall: number
  falsePositiveLaneRate: number
  averageReviewerAgents: number
  averageReviewerGroups: number
  recipeBundleMode: ReviewRecipeBundleMode
  oneVariableChange: boolean
  qualityGate: 'pass' | 'fail'
  laneMissCounts: Record<string, number>
  highStakesLaneMissCounts: Record<string, number>
  missingArtifactCounts: Record<string, number>
  missingCheckCounts: Record<string, number>
  caseMisses: Array<{
    caseId: string
    outcome: ReviewPlanningOutcome
    missedLaneIds: ReviewRiskLane[]
    missingArtifactIds: string[]
    missingCheckIds: string[]
    aggregationMisses: ReviewRiskLane[]
  }>
}

export interface ReviewPlanningFrontierSummary {
  recommendedVariantId: string | null
  runs: ReviewPlanningFrontierRun[]
}

export function gradeReviewPlanningCase(
  planningCase: ReviewPlanningCalibrationCase,
  plan: ReviewPlanRecord,
): ReviewPlanningGrade {
  const parsedCase = ReviewPlanningCalibrationCase.parse(planningCase)
  const selected = new Set(plan.selectedLanes)
  const required = parsedCase.expected.requiredLanes
  const matchedLaneIds = required.filter((lane) => selected.has(lane))
  const missedLaneIds = required.filter((lane) => !selected.has(lane))
  const falsePositiveLaneIds = parsedCase.expected.forbiddenLanes.filter((lane) => selected.has(lane))
  const missingArtifactIds = parsedCase.expected.requiredArtifacts.filter((artifact) =>
    !plan.requiredArtifacts.includes(artifact),
  )
  const missingCheckIds = parsedCase.expected.deterministicChecks.filter((check) =>
    !plan.deterministicChecks.includes(check),
  )
  const aggregationMisses = parsedCase.expected.strictLanes.filter((lane) =>
    plan.aggregation[lane] !== 'strict',
  )
  const budgetWithinLimit = parsedCase.expected.maxReviewerAgents === undefined ||
    (plan.budget.maxReviewerAgents ?? Number.POSITIVE_INFINITY) <= parsedCase.expected.maxReviewerAgents

  const severeMiss = missedLaneIds.length > 0 || aggregationMisses.length > 0
  const anyMiss = severeMiss ||
    falsePositiveLaneIds.length > 0 ||
    missingArtifactIds.length > 0 ||
    missingCheckIds.length > 0 ||
    !budgetWithinLimit

  return {
    outcome: !anyMiss ? 'pass' : matchedLaneIds.length > 0 && !severeMiss ? 'partial' : 'miss',
    matchedLaneIds,
    missedLaneIds,
    falsePositiveLaneIds,
    missingArtifactIds,
    missingCheckIds,
    aggregationMisses,
    budgetWithinLimit,
  }
}

export function runReviewPlanningFrontier(input: {
  cases: readonly ReviewPlanningCalibrationCase[]
  variants: readonly ReviewPlanningFrontierVariant[]
}): ReviewPlanningFrontierSummary {
  const runs = input.variants.map((variant) => {
    const grades: ReviewPlanningGrade[] = []
    const reviewerAgentCounts: number[] = []
    for (const planningCase of input.cases) {
      const plan = buildReviewPlan({
        task: {
          id: planningCase.task.id,
          title: planningCase.task.title,
          description: planningCase.task.description,
          priority: planningCase.task.priority as TaskPriority,
          acceptanceCriteria: [],
          outOfScope: [],
          notes: [],
        },
        changedFiles: planningCase.task.changedFiles,
        requestedEffort: variant.reviewEffort,
      })
      grades.push(gradeReviewPlanningCase(planningCase, plan))
      reviewerAgentCounts.push(plan.budget.maxReviewerAgents ?? 0)
    }

    const expectedLaneCount = Math.max(
      1,
      input.cases.reduce((total, planningCase) => total + planningCase.expected.requiredLanes.length, 0),
    )
    const matchedLaneCount = grades.reduce((total, grade) => total + grade.matchedLaneIds.length, 0)
    const falsePositiveLaneCount = grades.reduce((total, grade) => total + grade.falsePositiveLaneIds.length, 0)

    const recipeBundleMode = variant.recipeBundleMode ?? 'default_bundles'
    const laneMissCounts = countBy(grades.flatMap((grade) => grade.missedLaneIds))
    const highStakesLaneMissCounts = countBy(
      grades.flatMap((grade) => grade.missedLaneIds.filter((lane) => HIGH_STAKES_LANES.has(lane))),
    )
    const missingArtifactCounts = countBy(grades.flatMap((grade) => grade.missingArtifactIds))
    const missingCheckCounts = countBy(grades.flatMap((grade) => grade.missingCheckIds))
    const missCount = grades.filter((grade) => grade.outcome === 'miss').length
    const caseMisses = grades.flatMap((grade, index) => {
      if (
        grade.outcome === 'pass' &&
        grade.missedLaneIds.length === 0 &&
        grade.missingArtifactIds.length === 0 &&
        grade.missingCheckIds.length === 0 &&
        grade.aggregationMisses.length === 0
      ) {
        return []
      }
      return [{
        caseId: input.cases[index]!.id,
        outcome: grade.outcome,
        missedLaneIds: grade.missedLaneIds,
        missingArtifactIds: grade.missingArtifactIds,
        missingCheckIds: grade.missingCheckIds,
        aggregationMisses: grade.aggregationMisses,
      }]
    })
    const qualityGate = missCount === 0 &&
      Object.keys(highStakesLaneMissCounts).length === 0 &&
      average(reviewerAgentCounts) > 0
      ? 'pass'
      : 'fail'

    return {
      variantId: variant.variantId,
      reviewEffort: variant.reviewEffort,
      caseCount: input.cases.length,
      passCount: grades.filter((grade) => grade.outcome === 'pass').length,
      partialCount: grades.filter((grade) => grade.outcome === 'partial').length,
      missCount,
      laneRecall: matchedLaneCount / expectedLaneCount,
      falsePositiveLaneRate: falsePositiveLaneCount / expectedLaneCount,
      averageReviewerAgents: average(reviewerAgentCounts),
      averageReviewerGroups: average(input.cases.map((planningCase) =>
        estimateReviewerGroups(planningCase.expected.requiredLanes, recipeBundleMode),
      )),
      recipeBundleMode,
      oneVariableChange: true,
      qualityGate,
      laneMissCounts,
      highStakesLaneMissCounts,
      missingArtifactCounts,
      missingCheckCounts,
      caseMisses,
    } satisfies ReviewPlanningFrontierRun
  })

  const recommended = [...runs].sort((a, b) => {
    if (a.qualityGate !== b.qualityGate) return a.qualityGate === 'pass' ? -1 : 1
    const quality = (b.laneRecall - b.falsePositiveLaneRate) - (a.laneRecall - a.falsePositiveLaneRate)
    if (Math.abs(quality) > 0.0001) return quality
    return a.averageReviewerAgents - b.averageReviewerAgents
  })[0]

  return {
    recommendedVariantId: recommended?.variantId ?? null,
    runs,
  }
}

export async function recordReviewPlanningFrontier(input: {
  cases: readonly ReviewPlanningCalibrationCase[]
  variants: readonly ReviewPlanningFrontierVariant[]
  store: Pick<ReviewAuditStore, 'saveFrontierRun'>
  recordedBy: string
  now?: () => Date
}): Promise<{
  summary: ReviewPlanningFrontierSummary
  record: Awaited<ReturnType<Pick<ReviewAuditStore, 'saveFrontierRun'>['saveFrontierRun']>>
}> {
  const summary = runReviewPlanningFrontier({
    cases: input.cases,
    variants: input.variants,
  })
  const recordedAt = (input.now?.() ?? new Date()).toISOString()
  const recommended = summary.runs.find((run) => run.variantId === summary.recommendedVariantId)
  const record = await input.store.saveFrontierRun({
    runId: `review-planning-frontier-${slugRunId(recordedAt)}`,
    variantSet: 'review-planning-frontier',
    variants: input.variants.map((variant) => variant.variantId),
    recommendedDefault: recommended?.reviewEffort,
    metrics: {
      caseCount: input.cases.length,
      runs: summary.runs,
    },
    summary: renderReviewPlanningFrontierSummary(summary),
    recordedAt,
    recordedBy: input.recordedBy,
  })
  return { summary, record }
}

export async function loadReviewPlanningCasesFromDirectory(
  directory: string,
): Promise<ReviewPlanningCalibrationCase[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true })
  const cases: ReviewPlanningCalibrationCase[] = []
  for (const entry of entries) {
    const filePath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      cases.push(...await loadReviewPlanningCasesFromDirectory(filePath))
      continue
    }
    if (!entry.isFile() || !/\.(ya?ml|json)$/i.test(entry.name)) continue
    const raw = await fs.readFile(filePath, 'utf8')
    const parsed = /\.json$/i.test(entry.name) ? JSON.parse(raw) : parseYaml(raw)
    cases.push(ReviewPlanningCalibrationCase.parse(parsed))
  }
  return cases.sort((a, b) => a.id.localeCompare(b.id))
}

function average(values: readonly number[]): number {
  if (values.length === 0) return 0
  return values.reduce((total, value) => total + value, 0) / values.length
}

const HIGH_STAKES_LANES = new Set<ReviewRiskLane>([
  'security',
  'privacy',
  'api_contract',
  'data_integrity',
  'migration_safety',
  'evidence_privacy',
  'release_risk',
  'rollout_safety',
])

function countBy(values: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1
  return counts
}

function estimateReviewerGroups(
  lanes: readonly z.infer<typeof ReviewRiskLane>[],
  mode: ReviewRecipeBundleMode,
): number {
  if (mode === 'split_ux_copy') {
    const uxLanes = new Set(['ux_comprehension', 'copy_clarity', 'visual_design', 'accessibility'])
    const splitUxCount = lanes.filter((lane) => uxLanes.has(lane)).length
    const nonUxCount = countDefaultBundles(lanes.filter((lane) => !uxLanes.has(lane)))
    return splitUxCount + nonUxCount
  }
  return countDefaultBundles(lanes)
}

function countDefaultBundles(lanes: readonly z.infer<typeof ReviewRiskLane>[]): number {
  const remaining = new Set(lanes)
  let groups = 0
  for (const bundle of defaultReviewRecipeBundles) {
    if (bundle.lanes.some((lane) => remaining.has(lane))) {
      groups += 1
      for (const lane of bundle.lanes) remaining.delete(lane)
    }
  }
  return groups + remaining.size
}

function renderReviewPlanningFrontierSummary(summary: ReviewPlanningFrontierSummary): string {
  const recommended = summary.recommendedVariantId ?? 'none'
  const runs = summary.runs
    .map((run) =>
      `${run.variantId}: recall ${formatPercent(run.laneRecall)}, ` +
      `${run.passCount}/${run.caseCount} pass, gate ${run.qualityGate}, ` +
      `avg reviewers ${run.averageReviewerAgents.toFixed(1)}`,
    )
    .join('; ')
  return `Recommended review planning variant: ${recommended}. ${runs}`
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}

function slugRunId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}
