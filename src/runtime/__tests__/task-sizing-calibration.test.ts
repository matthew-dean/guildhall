import path from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  gradeTaskSizingCase,
  loadTaskSizingCasesFromDirectory,
  recordTaskSizingFrontier,
  runTaskSizingFrontier,
} from '../task-sizing-calibration.js'
import { buildTaskSizePlan } from '@guildhall/core'

describe('task sizing calibration', () => {
  it('grades score/action decisions for one sizing case', () => {
    const sizingCase = {
      id: 'multi-outcome-launch',
      title: 'Multi-outcome launch',
      task: {
        id: 'task-launch',
        title: 'Launch billing and invite changes',
        description: 'Add billing settings, create an admin API endpoint, migrate subscription data, send invite emails, and document rollout.',
        priority: 'high' as const,
        changedFiles: ['src/web/Billing.svelte', 'src/api/admin/subscriptions.ts', 'migrations/subscriptions.sql'],
        riskLanes: ['ux_comprehension', 'api_contract', 'data_integrity', 'migration_safety', 'release_risk'],
        structuredSignals: {
          acceptanceCriteriaCount: 5,
          contractSurfaceCount: 0,
        },
      },
      expected: {
        minScore: 8 as const,
        action: 'decompose_before_execution' as const,
        requiredFactors: ['multiple_outcomes', 'migration_or_release'],
        minDecompositionChildren: 0,
      },
      labelGovernance: {
        labeledBy: 'task-sizing-calibration-test',
        labeledAt: '2026-05-25',
        reviewStatus: 'seed' as const,
      },
    }
    const plan = buildTaskSizePlan({
      task: {
        id: sizingCase.task.id,
        title: sizingCase.task.title,
        description: sizingCase.task.description,
        priority: sizingCase.task.priority,
        acceptanceCriteria: [],
        outOfScope: [],
        structuredSignals: {
          acceptanceCriteriaCount: 5,
          contractSurfaceCount: 0,
        },
      },
        changedFiles: sizingCase.task.changedFiles,
        riskLanes: sizingCase.task.riskLanes,
      createdAt: '2026-05-25T12:00:00.000Z',
    })

    expect(gradeTaskSizingCase(sizingCase, plan)).toMatchObject({
      outcome: 'pass',
      scoreMeetsMinimum: true,
      actionMatches: true,
      missingFactorIds: [],
      decompositionDraftsMeetMinimum: true,
    })
  })

  it('loads seed task sizing cases from nested folders', async () => {
    const cases = await loadTaskSizingCasesFromDirectory(
      path.join(process.cwd(), 'internal/calibration/task-sizing'),
    )

    expect(cases.map((sizingCase) => sizingCase.id)).toEqual(expect.arrayContaining([
      'single-copy-empty-state',
      'multi-outcome-launch-split',
      'small-but-high-risk-oauth-callback',
      'do-not-over-split-coherent-migration',
    ]))
  })

  it('runs a frontier and recommends the strictest passing variant when balanced misses a split-required case', async () => {
    const cases = await loadTaskSizingCasesFromDirectory(
      path.join(process.cwd(), 'internal/calibration/task-sizing'),
    )
    const frontier = runTaskSizingFrontier({
      cases,
      variants: [
        { variantId: 'balanced', strictness: 'balanced' },
        { variantId: 'split_sensitive', strictness: 'split_sensitive' },
      ],
    })

    expect(frontier.runs).toHaveLength(2)
    expect(frontier.runs.find((run) => run.variantId === 'balanced')?.caseMisses.length).toBeGreaterThan(0)
    expect(frontier.runs.find((run) => run.variantId === 'split_sensitive')).toMatchObject({
      qualityGate: 'pass',
    })
    expect(frontier.recommendedVariantId).toBe('split_sensitive')
  })

  it('records frontier summaries through the review audit store', async () => {
    const cases = await loadTaskSizingCasesFromDirectory(
      path.join(process.cwd(), 'internal/calibration/task-sizing'),
    )
    const saved: Array<{ runId: string; variantSet: string; variants: string[]; summary: string }> = []

    const result = await recordTaskSizingFrontier({
      cases,
      variants: [
        { variantId: 'balanced', strictness: 'balanced' },
        { variantId: 'split_sensitive', strictness: 'split_sensitive' },
      ],
      store: {
        async saveFrontierRun(record) {
          saved.push(record)
          return { payload: record } as never
        },
      },
      recordedBy: 'task-sizing-test',
      now: () => new Date('2026-05-25T12:00:00.000Z'),
    })

    expect(result.summary.recommendedVariantId).toBe('split_sensitive')
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({
      runId: 'task-sizing-frontier-2026-05-25t12-00-00-000z',
      variantSet: 'task-sizing-frontier',
      variants: ['balanced', 'split_sensitive'],
    })
    expect(saved[0]!.summary).toContain('Recommended task sizing variant')
  })
})
