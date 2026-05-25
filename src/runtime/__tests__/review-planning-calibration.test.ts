import { describe, expect, it } from 'vitest'
import path from 'node:path'

import {
  defaultReviewRecipeBundles,
  gradeReviewPlanningCase,
  loadReviewPlanningCasesFromDirectory,
  runReviewPlanningFrontier,
  recordReviewPlanningFrontier,
  type ReviewPlanningCalibrationCase,
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

    expect(cases.length).toBeGreaterThanOrEqual(20)
    expect(cases.map((planningCase) => planningCase.id)).toEqual(expect.arrayContaining([
      'ux-settings-review-effort',
      'accessibility-keyboard-modal-plan',
      'accessibility-contrast-token-plan',
      'visual-responsive-toolbar-plan',
      'security-tenant-export-plan',
      'security-oauth-callback-csrf-plan',
      'privacy-telemetry-consent-plan',
      'privacy-support-evidence-redaction-plan',
      'api-status-compatibility-plan',
      'data-idempotent-retry-plan',
      'migration-backfill-rollback-plan',
      'docs-install-command-plan',
      'performance-unbounded-query-plan',
      'evidence-redaction-plan',
      'cost-model-budget-plan',
      'cost-provider-rate-limit-plan',
      'calibration-prompt-change-plan',
      'plan-completeness-handoff-plan',
      'release-rollout-fallback-plan',
      'release-feature-flag-fallback-plan',
    ]))
  })

  it('declares reviewer bundle metadata before frontier variants use it', () => {
    expect(defaultReviewRecipeBundles.map((bundle) => bundle.recipeId)).toEqual(expect.arrayContaining([
      'product-ux-zero-context',
      'security-privacy-boundary',
      'api-data-migration-contract',
    ]))
    expect(defaultReviewRecipeBundles.find((bundle) => bundle.recipeId === 'product-ux-zero-context')).toMatchObject({
      lanes: ['ux_comprehension', 'copy_clarity', 'visual_design', 'accessibility'],
      canSplit: true,
      highStakes: false,
    })
    expect(defaultReviewRecipeBundles.find((bundle) => bundle.recipeId === 'security-privacy-boundary')).toMatchObject({
      highStakes: true,
    })
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
        { variantId: 'balanced_split_ux_copy', reviewEffort: 'balanced', recipeBundleMode: 'split_ux_copy' },
      ],
    })

    expect(frontier.runs).toHaveLength(4)
    const balancedRun = frontier.runs.find((run) => run.variantId === 'balanced')
    expect(balancedRun).toMatchObject({
      caseCount: cases.length,
      oneVariableChange: true,
    })
    expect(balancedRun?.caseMisses).toEqual([])
    expect(balancedRun?.highStakesLaneMissCounts).toEqual({})
    expect(frontier.runs.find((run) => run.variantId === 'balanced_split_ux_copy')).toMatchObject({
      recipeBundleMode: 'split_ux_copy',
      oneVariableChange: true,
    })
    expect(frontier.recommendedVariantId).toBeTruthy()
  })

  it('reports lane-level frontier diagnostics and excludes variants below the quality gate', () => {
    const cases: ReviewPlanningCalibrationCase[] = [{
      id: 'missed-ux-planning',
      title: 'Missed UX planning',
      task: {
        id: 'task-missed-ux-planning',
        title: 'Add a settings control',
        description: 'Add a new control to the project settings screen.',
        priority: 'low' as const,
        changedFiles: ['src/web/surfaces/project/SettingsTab.svelte'],
      },
      expected: {
        requiredLanes: ['ux_comprehension', 'visual_design', 'test_adequacy'],
        forbiddenLanes: [],
        requiredArtifacts: ['visual-evidence'],
        deterministicChecks: ['browser-or-screenshot-evidence'],
        strictLanes: [],
        maxReviewerAgents: 6,
      },
      labelGovernance: {
        labeledBy: 'review-calibration-test',
        labeledAt: '2026-05-25',
        reviewStatus: 'seed' as const,
      },
    }]

    const frontier = runReviewPlanningFrontier({
      cases,
      variants: [
        { variantId: 'lean', reviewEffort: 'lean' },
        { variantId: 'balanced', reviewEffort: 'balanced' },
      ],
    })

    expect(frontier.runs.find((run) => run.variantId === 'lean')).toMatchObject({
      qualityGate: 'fail',
      laneMissCounts: {
        ux_comprehension: 1,
        visual_design: 1,
      },
      caseMisses: [{
        caseId: 'missed-ux-planning',
        missedLaneIds: ['ux_comprehension', 'visual_design'],
      }],
    })
    expect(frontier.runs.find((run) => run.variantId === 'balanced')).toMatchObject({
      qualityGate: 'pass',
      laneMissCounts: {},
    })
    expect(frontier.recommendedVariantId).toBe('balanced')
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
