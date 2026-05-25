import { z } from 'zod'
import fs from 'node:fs/promises'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'

import { ReviewRiskLane } from './review-audit-store.js'

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
