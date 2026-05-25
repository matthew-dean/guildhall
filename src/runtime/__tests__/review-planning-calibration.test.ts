import { describe, expect, it } from 'vitest'
import path from 'node:path'

import {
  gradeReviewPlanningCase,
  loadReviewPlanningCasesFromDirectory,
  runReviewPlanningFrontier,
  recordReviewPlanningFrontier,
} from '../review-planning-calibration.js'
import { buildReviewPlan } from '../review-planner.js'

describe('review planning calibration', () => {
  it('grades lane, artifact, aggregation, and budget decisions for one planning case', () => {
    const plan = buildReviewPlan({
      task: {
        id: 'task-security-export',
        title: 'Add account export endpoint',
        description: 'Create an API route that exports workspace database data after checking auth token permissions.',
        priority: 'normal',
        acceptanceCriteria: [],
        outOfScope: [],
        notes: [],
      },
      changedFiles: ['src/api/export.ts'],
      requestedEffort: 'balanced',
      createdAt: '2026-05-25T12:00:00.000Z',
    })

    const grade = gradeReviewPlanningCase({
      id: 'security-export-planning',
      title: 'Security export planning',
      task: {
        id: 'task-security-export',
        title: 'Add account export endpoint',
        description: 'Create an API route that exports workspace database data after checking auth token permissions.',
        priority: 'normal',
        changedFiles: ['src/api/export.ts'],
      },
      expected: {
        requiredLanes: ['security', 'api_contract', 'data_integrity', 'test_adequacy'],
        forbiddenLanes: [],
        requiredArtifacts: ['contract-or-state-diff'],
        deterministicChecks: [],
        strictLanes: ['security', 'api_contract', 'data_integrity'],
        maxReviewerAgents: 6,
      },
      labelGovernance: {
        labeledBy: 'review-calibration-seed',
        labeledAt: '2026-05-25',
        reviewStatus: 'seed',
      },
    }, plan)

    expect(grade.outcome).toBe('pass')
    expect(grade.missedLaneIds).toEqual([])
    expect(grade.missingArtifactIds).toEqual([])
    expect(grade.aggregationMisses).toEqual([])
    expect(grade.budgetWithinLimit).toBe(true)
  })

  it('loads seed planning cases from nested folders', async () => {
    const cases = await loadReviewPlanningCasesFromDirectory(
      path.join(process.cwd(), 'internal/calibration/planning'),
    )

    expect(cases.length).toBeGreaterThanOrEqual(4)
    expect(cases.map((planningCase) => planningCase.id)).toEqual(expect.arrayContaining([
      'ux-settings-review-effort',
      'security-tenant-export-plan',
      'docs-install-command-plan',
      'performance-unbounded-query-plan',
    ]))
  })

  it('runs review effort frontier variants over the planning corpus', async () => {
    const cases = await loadReviewPlanningCasesFromDirectory(
      path.join(process.cwd(), 'internal/calibration/planning'),
    )
    const frontier = runReviewPlanningFrontier({
      cases,
      variants: [
        { variantId: 'lean', reviewEffort: 'lean' },
        { variantId: 'balanced', reviewEffort: 'balanced' },
        { variantId: 'thorough', reviewEffort: 'thorough' },
      ],
    })

    expect(frontier.runs).toHaveLength(3)
    expect(frontier.runs.find((run) => run.variantId === 'balanced')).toMatchObject({
      caseCount: cases.length,
      oneVariableChange: true,
    })
    expect(frontier.recommendedVariantId).toBeTruthy()
  })

  it('records planning frontier summaries through the review audit store', async () => {
    const cases = await loadReviewPlanningCasesFromDirectory(
      path.join(process.cwd(), 'internal/calibration/planning'),
    )
    const saved: Array<{ runId: string; variantSet: string; variants: string[]; summary: string }> = []

    const result = await recordReviewPlanningFrontier({
      cases,
      variants: [
        { variantId: 'balanced', reviewEffort: 'balanced' },
        { variantId: 'thorough', reviewEffort: 'thorough' },
      ],
      store: {
        async saveFrontierRun(record) {
          saved.push(record)
          return { payload: record } as never
        },
      },
      recordedBy: 'planning-calibration-test',
      now: () => new Date('2026-05-25T12:00:00.000Z'),
    })

    expect(result.summary.recommendedVariantId).toBeTruthy()
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({
      runId: 'review-planning-frontier-2026-05-25t12-00-00-000z',
      variantSet: 'review-planning-frontier',
      variants: ['balanced', 'thorough'],
    })
    expect(saved[0]!.summary).toContain('Recommended review planning variant')
  })
})
