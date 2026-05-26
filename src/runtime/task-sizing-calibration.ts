import fs from 'node:fs/promises'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import {
  TaskSizeAction,
  TaskSizePlan,
  buildTaskSizePlan,
  type TaskPriority,
} from '@guildhall/core'
import type { ReviewAuditStore } from './review-audit-store.js'

const TaskPrioritySchema = z.enum(['low', 'normal', 'high', 'critical'])

export const TaskSizingCalibrationCase = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  task: z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    description: z.string().default(''),
    priority: TaskPrioritySchema,
    changedFiles: z.array(z.string().min(1)).default([]),
    riskLanes: z.array(z.string().min(1)).default([]),
  }),
  expected: z.object({
    minScore: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(5), z.literal(8)]),
    action: TaskSizeAction,
    requiredFactors: z.array(z.string().min(1)).default([]),
    minRecommendedChildren: z.number().int().nonnegative().default(0),
  }),
  labelGovernance: z.object({
    labeledBy: z.string().min(1),
    labeledAt: z.string().min(1),
    reviewStatus: z.enum(['seed', 'reviewed', 'retired']),
  }),
})
export type TaskSizingCalibrationCase = z.infer<typeof TaskSizingCalibrationCase>

export type TaskSizingOutcome = 'pass' | 'partial' | 'miss'
export type TaskSizingStrictness = 'balanced' | 'split_sensitive'

export interface TaskSizingGrade {
  outcome: TaskSizingOutcome
  scoreMeetsMinimum: boolean
  actionMatches: boolean
  missingFactorIds: string[]
  recommendedChildrenMeetMinimum: boolean
}

export interface TaskSizingFrontierVariant {
  variantId: string
  strictness: TaskSizingStrictness
}

export interface TaskSizingFrontierRun {
  variantId: string
  strictness: TaskSizingStrictness
  caseCount: number
  passCount: number
  partialCount: number
  missCount: number
  qualityGate: 'pass' | 'fail'
  caseMisses: Array<{
    caseId: string
    outcome: TaskSizingOutcome
    expectedAction: TaskSizeAction
    actualAction: TaskSizeAction
    missingFactorIds: string[]
  }>
}

export interface TaskSizingFrontierSummary {
  recommendedVariantId: string | null
  runs: TaskSizingFrontierRun[]
}

export async function recordTaskSizingFrontier(input: {
  cases: readonly TaskSizingCalibrationCase[]
  variants: readonly TaskSizingFrontierVariant[]
  store: Pick<ReviewAuditStore, 'saveFrontierRun'>
  recordedBy?: string
  now?: () => Date
}) {
  const summary = runTaskSizingFrontier(input)
  const recordedAt = (input.now?.() ?? new Date()).toISOString()
  const runId = `task-sizing-frontier-${slugRunId(recordedAt)}`
  const record = await input.store.saveFrontierRun({
    runId,
    variantSet: 'task-sizing-frontier',
    variants: input.variants.map((variant) => variant.variantId),
    metrics: {
      recommendedVariantId: summary.recommendedVariantId,
      runs: summary.runs,
    },
    summary: [
      `Recommended task sizing variant: ${summary.recommendedVariantId ?? 'none'}.`,
      ...summary.runs.map((run) =>
        `${run.variantId}: ${run.passCount}/${run.caseCount} pass, ${run.caseMisses.length} miss${run.caseMisses.length === 1 ? '' : 'es'}, gate ${run.qualityGate}.`,
      ),
    ].join('\n'),
    recordedAt,
    recordedBy: input.recordedBy ?? 'task-sizing-calibration',
  })
  return { summary, record }
}

export function gradeTaskSizingCase(
  sizingCase: TaskSizingCalibrationCase,
  plan: TaskSizePlan,
): TaskSizingGrade {
  const parsedCase = TaskSizingCalibrationCase.parse(sizingCase)
  const parsedPlan = TaskSizePlan.parse(plan)
  const factorIds = new Set(parsedPlan.factors.map((factor) => factor.id))
  const missingFactorIds = parsedCase.expected.requiredFactors.filter((id) => !factorIds.has(id))
  const scoreMeetsMinimum = parsedPlan.score >= parsedCase.expected.minScore
  const actionMatches = parsedPlan.action === parsedCase.expected.action
  const recommendedChildrenMeetMinimum =
    parsedPlan.recommendedChildren.length >= parsedCase.expected.minRecommendedChildren
  const severeMiss = !scoreMeetsMinimum || !actionMatches
  const anyMiss = severeMiss || missingFactorIds.length > 0 || !recommendedChildrenMeetMinimum

  return {
    outcome: !anyMiss ? 'pass' : severeMiss ? 'miss' : 'partial',
    scoreMeetsMinimum,
    actionMatches,
    missingFactorIds,
    recommendedChildrenMeetMinimum,
  }
}

export function runTaskSizingFrontier(input: {
  cases: readonly TaskSizingCalibrationCase[]
  variants: readonly TaskSizingFrontierVariant[]
}): TaskSizingFrontierSummary {
  const runs = input.variants.map((variant) => {
    const grades = input.cases.map((sizingCase) => {
      const parsed = TaskSizingCalibrationCase.parse(sizingCase)
      const plan = buildTaskSizePlan({
        task: {
          id: parsed.task.id,
          title: parsed.task.title,
          description: parsed.task.description,
          priority: parsed.task.priority as TaskPriority,
          acceptanceCriteria: [],
          outOfScope: [],
        },
        changedFiles: variant.strictness === 'split_sensitive' ? parsed.task.changedFiles : [],
        riskLanes: variant.strictness === 'split_sensitive' ? parsed.task.riskLanes : [],
      })
      return { sizingCase: parsed, plan, grade: gradeTaskSizingCase(parsed, plan) }
    })
    const passCount = grades.filter((item) => item.grade.outcome === 'pass').length
    const partialCount = grades.filter((item) => item.grade.outcome === 'partial').length
    const missCount = grades.filter((item) => item.grade.outcome === 'miss').length
    const caseMisses = grades
      .filter((item) => item.grade.outcome !== 'pass')
      .map((item) => ({
        caseId: item.sizingCase.id,
        outcome: item.grade.outcome,
        expectedAction: item.sizingCase.expected.action,
        actualAction: item.plan.action,
        missingFactorIds: item.grade.missingFactorIds,
      }))

    return {
      variantId: variant.variantId,
      strictness: variant.strictness,
      caseCount: grades.length,
      passCount,
      partialCount,
      missCount,
      qualityGate: caseMisses.length === 0 ? 'pass' : 'fail',
      caseMisses,
    } satisfies TaskSizingFrontierRun
  })

  const passing = runs.filter((run) => run.qualityGate === 'pass')
  return {
    recommendedVariantId: passing[0]?.variantId ?? null,
    runs,
  }
}

export async function loadTaskSizingCasesFromDirectory(dir: string): Promise<TaskSizingCalibrationCase[]> {
  const files = await walkYamlFiles(dir)
  const cases: TaskSizingCalibrationCase[] = []
  for (const file of files) {
    const parsed = parseYaml(await fs.readFile(file, 'utf8'))
    cases.push(TaskSizingCalibrationCase.parse(parsed))
  }
  return cases.sort((a, b) => a.id.localeCompare(b.id))
}

async function walkYamlFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...await walkYamlFiles(full))
    else if (entry.isFile() && /\.ya?ml$/i.test(entry.name)) files.push(full)
  }
  return files
}

function slugRunId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}
