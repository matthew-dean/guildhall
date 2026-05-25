import { z } from 'zod'
import fs from 'node:fs/promises'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'

import { ReviewRiskLane } from './review-audit-store.js'
import type { ReviewAuditStore } from './review-audit-store.js'

export const CalibrationArtifact = z.object({
  id: z.string().min(1),
  kind: z.enum(['screenshot', 'dom_snapshot', 'copy_snippet', 'url', 'flow_steps', 'api_error', 'document_excerpt']),
  description: z.string().min(1),
  content: z.string().optional(),
  path: z.string().optional(),
  url: z.string().optional(),
})
export type CalibrationArtifact = z.infer<typeof CalibrationArtifact>

export const CalibrationKnownFinding = z.object({
  id: z.string().min(1),
  lane: ReviewRiskLane,
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  summary: z.string().min(1),
  impact: z.string().min(1),
  minimumUsefulFix: z.string().min(1),
  matchHints: z.array(z.string().min(1)).default([]),
})
export type CalibrationKnownFinding = z.infer<typeof CalibrationKnownFinding>

export const CalibrationFalsePositiveTrap = z.object({
  id: z.string().min(1),
  summary: z.string().min(1),
})
export type CalibrationFalsePositiveTrap = z.infer<typeof CalibrationFalsePositiveTrap>

export const CalibrationCase = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  domain: z.string().min(1),
  productType: z.string().min(1),
  surfaceType: z.string().min(1),
  userGoal: z.string().min(1),
  scenario: z.string().min(1),
  artifacts: z.array(CalibrationArtifact).default([]),
  reviewLanes: z.array(ReviewRiskLane).min(1),
  knownFindings: z.array(CalibrationKnownFinding).default([]),
  falsePositiveTraps: z.array(CalibrationFalsePositiveTrap).default([]),
  source: z.object({
    kind: z.enum(['synthetic', 'external_example', 'production_miss', 'support_report', 'incident']),
    citation: z.string().optional(),
    url: z.string().optional(),
  }),
  labelGovernance: z.object({
    labeledBy: z.string().min(1),
    labeledAt: z.string().min(1),
    reviewStatus: z.enum(['seed', 'reviewed', 'retired']),
  }),
  privacyClassification: z.enum(['public', 'internal', 'sensitive', 'secret']),
  negativeControl: z.boolean().default(false),
  stalenessPolicy: z.object({
    reviewAfter: z.string().min(1),
    reason: z.string().min(1),
  }),
})
export type CalibrationCase = z.infer<typeof CalibrationCase>

export interface CalibrationReviewPacket {
  caseId: string
  title: string
  domain: string
  productType: string
  surfaceType: string
  userGoal: string
  scenario: string
  reviewLanes: string[]
  artifacts: CalibrationArtifact[]
  source: CalibrationCase['source']
  privacyClassification: CalibrationCase['privacyClassification']
}

export interface CalibrationReviewerFinding {
  lane: z.infer<typeof ReviewRiskLane> | string
  severity: 'low' | 'medium' | 'high' | 'critical' | string
  summary: string
}

export type CalibrationOutcome = 'pass' | 'partial' | 'miss' | 'false_positive_heavy'

export interface CalibrationGrade {
  outcome: CalibrationOutcome
  matchedFindingIds: string[]
  missedFindingIds: string[]
  falsePositiveCount: number
}

export interface CalibrationFrontierRun {
  runId: string
  recipeId: string
  variantId: string
  changedVariable: 'baseline' | 'context' | 'model' | 'settings' | 'prompt' | 'multi_reviewer' | 'exploratory_multi'
  caseResults: CalibrationGrade[]
  estimatedTokens: number
  latencyMs: number
}

export interface CalibrationFrontierSummary {
  recommendedRunId: string | null
  runs: Array<CalibrationFrontierRun & {
    recall: number
    falsePositiveRate: number
    oneVariableChange: boolean
  }>
}

export interface CalibrationCorpusSummary {
  caseCount: number
  recipeIds: string[]
  knownFindingCount: number
  falsePositiveTrapCount: number
  negativeControlCount: number
  laneCoverage: Record<string, number>
  missingCaseIds: string[]
  orphanCaseIds: string[]
}

export const ReviewCalibrationRecipe = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  lanes: z.array(ReviewRiskLane).min(1),
  purpose: z.string().min(1),
  contextPacket: z.enum([
    'zero_context_artifacts_only',
    'click_path_artifacts',
    'cross_surface_artifacts',
  ]),
  promptVersion: z.string().min(1),
  requiredArtifactKinds: z.array(CalibrationArtifact.shape.kind).default([]),
  calibratedCaseIds: z.array(z.string().min(1)).default([]),
  knownWeaknesses: z.array(z.string().min(1)).default([]),
})
export type ReviewCalibrationRecipe = z.infer<typeof ReviewCalibrationRecipe>

export const defaultReviewCalibrationRecipes: ReviewCalibrationRecipe[] = [
  {
    id: 'ux-zero-context-comprehension',
    version: 'v1',
    lanes: ['ux_comprehension', 'copy_clarity'],
    purpose: 'Check whether a reviewer can identify the user goal, safe next action, and confusing copy from artifacts alone.',
    contextPacket: 'zero_context_artifacts_only',
    promptVersion: 'ux-zero-context-v1',
    requiredArtifactKinds: ['copy_snippet'],
    calibratedCaseIds: ['ambiguous-primary-action', 'clear-retry-negative-control'],
    knownWeaknesses: ['May under-detect cross-surface contradictions without multiple artifacts.'],
  },
  {
    id: 'ux-error-recovery',
    version: 'v1',
    lanes: ['ux_comprehension', 'copy_clarity'],
    purpose: 'Check whether failure states explain cause, preserve progress, and name a recovery path.',
    contextPacket: 'zero_context_artifacts_only',
    promptVersion: 'ux-error-recovery-v1',
    requiredArtifactKinds: ['copy_snippet', 'flow_steps'],
    calibratedCaseIds: ['error-without-recovery', 'clear-retry-negative-control'],
    knownWeaknesses: ['Can over-prescribe copy length unless negative controls are included.'],
  },
  {
    id: 'ux-cross-surface-consistency',
    version: 'v1',
    lanes: ['ux_comprehension', 'copy_clarity'],
    purpose: 'Check whether surfaces agree on ownership, state, and the next action.',
    contextPacket: 'cross_surface_artifacts',
    promptVersion: 'ux-cross-surface-v1',
    requiredArtifactKinds: ['copy_snippet', 'screenshot'],
    calibratedCaseIds: ['cross-surface-state-contradiction'],
    knownWeaknesses: ['Needs at least two surface artifacts to be meaningful.'],
  },
]

export function buildCalibrationReviewPacket(calibrationCase: CalibrationCase): CalibrationReviewPacket {
  return {
    caseId: calibrationCase.id,
    title: calibrationCase.title,
    domain: calibrationCase.domain,
    productType: calibrationCase.productType,
    surfaceType: calibrationCase.surfaceType,
    userGoal: calibrationCase.userGoal,
    scenario: calibrationCase.scenario,
    reviewLanes: [...calibrationCase.reviewLanes],
    artifacts: calibrationCase.artifacts.map((artifact) => ({ ...artifact })),
    source: { ...calibrationCase.source },
    privacyClassification: calibrationCase.privacyClassification,
  }
}

export function selectCalibrationRecipesForLanes(
  lanes: Array<z.infer<typeof ReviewRiskLane> | string>,
  recipes: readonly ReviewCalibrationRecipe[] = defaultReviewCalibrationRecipes,
): ReviewCalibrationRecipe[] {
  const laneSet = new Set(lanes)
  return recipes.filter((recipe) => recipe.lanes.some((lane) => laneSet.has(lane)))
}

export function buildCalibrationCorpusSummary(
  cases: readonly CalibrationCase[],
  recipes: readonly ReviewCalibrationRecipe[] = defaultReviewCalibrationRecipes,
): CalibrationCorpusSummary {
  const caseIds = new Set(cases.map((calibrationCase) => calibrationCase.id))
  const calibratedCaseIds = new Set(recipes.flatMap((recipe) => recipe.calibratedCaseIds))
  const laneCoverage: Record<string, number> = {}
  for (const calibrationCase of cases) {
    for (const lane of calibrationCase.reviewLanes) {
      laneCoverage[lane] = (laneCoverage[lane] ?? 0) + 1
    }
  }

  return {
    caseCount: cases.length,
    recipeIds: recipes.map((recipe) => recipe.id),
    knownFindingCount: cases.reduce((total, calibrationCase) => total + calibrationCase.knownFindings.length, 0),
    falsePositiveTrapCount: cases.reduce((total, calibrationCase) => total + calibrationCase.falsePositiveTraps.length, 0),
    negativeControlCount: cases.filter((calibrationCase) => calibrationCase.knownFindings.length === 0).length,
    laneCoverage,
    missingCaseIds: [...calibratedCaseIds].filter((caseId) => !caseIds.has(caseId)).sort(),
    orphanCaseIds: [...caseIds].filter((caseId) => !calibratedCaseIds.has(caseId)).sort(),
  }
}

export async function recordCalibrationCorpusValidation(input: {
  casesDir: string
  store: Pick<ReviewAuditStore, 'saveFrontierRun'>
  recipes?: readonly ReviewCalibrationRecipe[]
  recordedBy: string
  now?: () => Date
}): Promise<{
  summary: CalibrationCorpusSummary
  record: Awaited<ReturnType<Pick<ReviewAuditStore, 'saveFrontierRun'>['saveFrontierRun']>>
}> {
  const cases = await loadCalibrationCasesFromDirectory(input.casesDir)
  const recipes = input.recipes ?? defaultReviewCalibrationRecipes
  const summary = buildCalibrationCorpusSummary(cases, recipes)
  const recordedAt = (input.now?.() ?? new Date()).toISOString()

  const record = await input.store.saveFrontierRun({
    runId: `review-calibration-corpus-${slugRunId(recordedAt)}`,
    variantSet: 'review-calibration-corpus',
    variants: summary.recipeIds,
    metrics: {
      caseCount: summary.caseCount,
      knownFindingCount: summary.knownFindingCount,
      falsePositiveTrapCount: summary.falsePositiveTrapCount,
      negativeControlCount: summary.negativeControlCount,
      laneCoverage: summary.laneCoverage,
      missingCaseIds: summary.missingCaseIds,
      orphanCaseIds: summary.orphanCaseIds,
    },
    summary: renderCalibrationCorpusSummary(summary),
    recordedAt,
    recordedBy: input.recordedBy,
  })

  return { summary, record }
}

export function gradeCalibrationRun(input: {
  case: CalibrationCase
  reviewerFindings: CalibrationReviewerFinding[]
}): CalibrationGrade {
  if (input.case.negativeControl) {
    const falsePositiveCount = input.reviewerFindings.length
    return {
      outcome: falsePositiveCount === 0 ? 'pass' : 'false_positive_heavy',
      matchedFindingIds: [],
      missedFindingIds: [],
      falsePositiveCount,
    }
  }

  const matchedFindingIds: string[] = []
  const matchedReviewerIndexes = new Set<number>()
  for (const finding of input.case.knownFindings) {
    const matchedIndex = input.reviewerFindings.findIndex((reviewerFinding, index) =>
      !matchedReviewerIndexes.has(index) && reviewerFindingMatches(finding, reviewerFinding),
    )
    if (matchedIndex >= 0) {
      matchedFindingIds.push(finding.id)
      matchedReviewerIndexes.add(matchedIndex)
    }
  }

  const missedFindingIds = input.case.knownFindings
    .filter((finding) => !matchedFindingIds.includes(finding.id))
    .map((finding) => finding.id)
  const falsePositiveCount = Math.max(0, input.reviewerFindings.length - matchedReviewerIndexes.size)

  return {
    outcome: outcomeFor({
      matchedCount: matchedFindingIds.length,
      expectedCount: input.case.knownFindings.length,
      falsePositiveCount,
    }),
    matchedFindingIds,
    missedFindingIds,
    falsePositiveCount,
  }
}

export function summarizeCalibrationFrontier(runs: CalibrationFrontierRun[]): CalibrationFrontierSummary {
  const scored = runs.map((run) => {
    const expectedCount = run.caseResults.reduce(
      (total, result) => total + result.matchedFindingIds.length + result.missedFindingIds.length,
      0,
    )
    const matchedCount = run.caseResults.reduce((total, result) => total + result.matchedFindingIds.length, 0)
    const falsePositiveCount = run.caseResults.reduce((total, result) => total + result.falsePositiveCount, 0)
    const findingCount = Math.max(1, expectedCount)
    return {
      ...run,
      recall: expectedCount === 0 ? 1 : matchedCount / expectedCount,
      falsePositiveRate: falsePositiveCount / findingCount,
      oneVariableChange: run.changedVariable !== 'exploratory_multi',
    }
  })

  const recommended = [...scored]
    .filter((run) => run.oneVariableChange)
    .sort((a, b) => {
      const qualityDelta = (b.recall - b.falsePositiveRate) - (a.recall - a.falsePositiveRate)
      if (Math.abs(qualityDelta) > 0.0001) return qualityDelta
      if (a.estimatedTokens !== b.estimatedTokens) return a.estimatedTokens - b.estimatedTokens
      return a.latencyMs - b.latencyMs
    })[0]

  return {
    recommendedRunId: recommended?.runId ?? null,
    runs: scored,
  }
}

export async function loadCalibrationCasesFromDirectory(directory: string): Promise<CalibrationCase[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true })
  const cases: CalibrationCase[] = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    if (!/\.(ya?ml|json)$/i.test(entry.name)) continue
    const filePath = path.join(directory, entry.name)
    const raw = await fs.readFile(filePath, 'utf8')
    const parsed = /\.json$/i.test(entry.name) ? JSON.parse(raw) : parseYaml(raw)
    cases.push(CalibrationCase.parse(parsed))
  }
  return cases.sort((a, b) => a.id.localeCompare(b.id))
}

function renderCalibrationCorpusSummary(summary: CalibrationCorpusSummary): string {
  const coverage = Object.entries(summary.laneCoverage)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([lane, count]) => `${lane}: ${count}`)
    .join(', ')
  const status = summary.missingCaseIds.length === 0
    ? 'All default calibration recipe case references resolve.'
    : `Missing calibration cases: ${summary.missingCaseIds.join(', ')}.`
  return [
    `${summary.caseCount} calibration case(s), ${summary.knownFindingCount} known finding(s), ${summary.negativeControlCount} negative control(s).`,
    `Lane coverage: ${coverage || 'none'}.`,
    status,
  ].join(' ')
}

function slugRunId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function outcomeFor(input: {
  matchedCount: number
  expectedCount: number
  falsePositiveCount: number
}): CalibrationOutcome {
  if (input.falsePositiveCount >= 2) return 'false_positive_heavy'
  if (input.expectedCount === 0) return input.falsePositiveCount === 0 ? 'pass' : 'false_positive_heavy'
  if (input.matchedCount === input.expectedCount) return 'pass'
  if (input.matchedCount > 0) return 'partial'
  return 'miss'
}

function reviewerFindingMatches(
  knownFinding: CalibrationKnownFinding,
  reviewerFinding: CalibrationReviewerFinding,
): boolean {
  const text = normalize(`${reviewerFinding.summary} ${reviewerFinding.lane}`)
  if (normalize(reviewerFinding.lane).includes(normalize(knownFinding.lane))) return true
  return knownFinding.matchHints.some((hint) => text.includes(normalize(hint)))
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
}
