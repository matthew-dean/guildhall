import { describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  CalibrationCase,
  buildCalibrationCaseDraftFromEscapedMiss,
  buildCalibrationCorpusSummary,
  buildCalibrationReviewPacket,
  defaultReviewCalibrationRecipes,
  gradeCalibrationRun,
  loadCalibrationCasesFromDirectory,
  recordCalibrationCorpusValidation,
  selectCalibrationRecipesForLanes,
  summarizeCalibrationFrontier,
} from '../review-calibration.js'

const seedCase = {
  id: 'ambiguous-primary-action',
  title: 'Ambiguous primary action',
  domain: 'ux',
  productType: 'project-management',
  surfaceType: 'web-app',
  userGoal: 'Start the next safe task without understanding internal queue states.',
  scenario: 'A task card has two equally loud actions: Start and Resume, but only Resume is safe.',
  artifacts: [
    {
      id: 'task-card-copy',
      kind: 'copy_snippet',
      description: 'Visible card text.',
      content: 'Task ready. Start. Resume.',
    },
  ],
  reviewLanes: ['ux_comprehension', 'copy_clarity'],
  knownFindings: [
    {
      id: 'primary-action-ambiguity',
      lane: 'ux_comprehension',
      severity: 'high',
      summary: 'The card does not make the safe next action clear.',
      impact: 'A user can restart work instead of continuing the existing task.',
      minimumUsefulFix: 'Make Resume the only primary action and explain why.',
      matchHints: ['safe next action', 'primary action', 'resume'],
    },
  ],
  falsePositiveTraps: [
    {
      id: 'button-count',
      summary: 'Do not fail the case merely because there are two actions.',
    },
  ],
  source: {
    kind: 'synthetic',
    citation: 'Created for Guildhall calibration.',
  },
  labelGovernance: {
    labeledBy: 'product-review',
    labeledAt: '2026-05-25T12:00:00.000Z',
    reviewStatus: 'seed',
  },
  privacyClassification: 'public',
  negativeControl: false,
  stalenessPolicy: {
    reviewAfter: '2026-11-25',
    reason: 'Interaction conventions may change.',
  },
}

describe('review calibration cases', () => {
  it('validates a calibration case with hidden expected findings', () => {
    const parsed = CalibrationCase.parse(seedCase)

    expect(parsed.knownFindings[0]!.severity).toBe('high')
    expect(parsed.falsePositiveTraps[0]!.id).toBe('button-count')
  })

  it('builds a reviewer packet without leaking hidden findings or false-positive traps', () => {
    const reviewPacket = buildCalibrationReviewPacket(CalibrationCase.parse(seedCase))
    const serialized = JSON.stringify(reviewPacket)

    expect(reviewPacket.caseId).toBe('ambiguous-primary-action')
    expect(reviewPacket.reviewLanes).toEqual(['ux_comprehension', 'copy_clarity'])
    expect(serialized).toContain('Task ready. Start. Resume.')
    expect(serialized).not.toContain('primary-action-ambiguity')
    expect(serialized).not.toContain('minimumUsefulFix')
    expect(serialized).not.toContain('button-count')
  })

  it('grades reviewer findings as pass, partial, miss, and false-positive-heavy', () => {
    const calibrationCase = CalibrationCase.parse(seedCase)

    expect(gradeCalibrationRun({
      case: calibrationCase,
      reviewerFindings: [{
        lane: 'ux_comprehension',
        severity: 'high',
        summary: 'The safe next action is unclear because Start and Resume compete.',
      }],
    })).toMatchObject({
      outcome: 'pass',
      matchedFindingIds: ['primary-action-ambiguity'],
      missedFindingIds: [],
      falsePositiveCount: 0,
    })

    expect(gradeCalibrationRun({
      case: calibrationCase,
      reviewerFindings: [{
        lane: 'copy_clarity',
        severity: 'medium',
        summary: 'The labels could be shorter.',
      }],
    })).toMatchObject({
      outcome: 'miss',
      matchedFindingIds: [],
      missedFindingIds: ['primary-action-ambiguity'],
    })

    expect(gradeCalibrationRun({
      case: calibrationCase,
      reviewerFindings: [
        {
          lane: 'ux_comprehension',
          severity: 'medium',
          summary: 'Resume should be more prominent.',
        },
        {
          lane: 'visual_design',
          severity: 'low',
          summary: 'The card uses too much blue.',
        },
        {
          lane: 'performance',
          severity: 'low',
          summary: 'This might be slow.',
        },
      ],
    })).toMatchObject({
      outcome: 'false_positive_heavy',
      matchedFindingIds: ['primary-action-ambiguity'],
      falsePositiveCount: 2,
    })
  })

  it('treats negative-control cases as pass only when reviewers avoid findings', () => {
    const negative = CalibrationCase.parse({
      ...seedCase,
      id: 'clear-primary-action-control',
      negativeControl: true,
      knownFindings: [],
      falsePositiveTraps: [{
        id: 'invented-ambiguity',
        summary: 'Do not invent ambiguity when one action is primary and explained.',
      }],
    })

    expect(gradeCalibrationRun({ case: negative, reviewerFindings: [] })).toMatchObject({
      outcome: 'pass',
      falsePositiveCount: 0,
    })
    expect(gradeCalibrationRun({
      case: negative,
      reviewerFindings: [{
        lane: 'ux_comprehension',
        severity: 'low',
        summary: 'There may be too much explanation.',
      }],
    })).toMatchObject({
      outcome: 'false_positive_heavy',
      falsePositiveCount: 1,
    })
  })

  it('summarizes a quality/cost frontier across recipe variants', () => {
    const frontier = summarizeCalibrationFrontier([
      {
        runId: 'baseline',
        recipeId: 'ux-zero-context-comprehension',
        variantId: 'baseline',
        changedVariable: 'baseline',
        caseResults: [
          { outcome: 'miss', matchedFindingIds: [], missedFindingIds: ['a'], falsePositiveCount: 0 },
          { outcome: 'pass', matchedFindingIds: ['b'], missedFindingIds: [], falsePositiveCount: 0 },
        ],
        estimatedTokens: 10000,
        latencyMs: 12000,
      },
      {
        runId: 'context-only',
        recipeId: 'ux-zero-context-comprehension',
        variantId: 'context-expanded',
        changedVariable: 'context',
        caseResults: [
          { outcome: 'pass', matchedFindingIds: ['a'], missedFindingIds: [], falsePositiveCount: 0 },
          { outcome: 'pass', matchedFindingIds: ['b'], missedFindingIds: [], falsePositiveCount: 0 },
        ],
        estimatedTokens: 15000,
        latencyMs: 14000,
      },
      {
        runId: 'messy',
        recipeId: 'ux-zero-context-comprehension',
        variantId: 'model-plus-prompt',
        changedVariable: 'exploratory_multi',
        caseResults: [
          { outcome: 'pass', matchedFindingIds: ['a'], missedFindingIds: [], falsePositiveCount: 3 },
        ],
        estimatedTokens: 8000,
        latencyMs: 9000,
      },
    ])

    expect(frontier.recommendedRunId).toBe('context-only')
    expect(frontier.runs[1]).toMatchObject({
      recall: 1,
      falsePositiveRate: 0,
      oneVariableChange: true,
    })
    expect(frontier.runs[2]).toMatchObject({
      oneVariableChange: false,
    })
  })

  it('loads calibration cases from a directory of yaml and json files', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-review-calibration-'))
    try {
      await fs.writeFile(
        path.join(tmp, 'case-a.yaml'),
        [
          'id: yaml-case',
          'title: YAML case',
          'domain: ux',
          'productType: docs',
          'surfaceType: docs-page',
          'userGoal: Understand the next step.',
          'scenario: The page says continue but not where.',
          'artifacts: []',
          'reviewLanes: [ux_comprehension]',
          'knownFindings: []',
          'falsePositiveTraps: []',
          'source:',
          '  kind: synthetic',
          'labelGovernance:',
          '  labeledBy: test',
          '  labeledAt: 2026-05-25T12:00:00.000Z',
          '  reviewStatus: seed',
          'privacyClassification: public',
          'negativeControl: true',
          'stalenessPolicy:',
          '  reviewAfter: 2026-11-25',
          '  reason: fixture',
        ].join('\n'),
        'utf8',
      )
      await fs.writeFile(
        path.join(tmp, 'case-b.json'),
        JSON.stringify({ ...seedCase, id: 'json-case' }, null, 2),
        'utf8',
      )
      await fs.writeFile(path.join(tmp, 'notes.txt'), 'ignored', 'utf8')

      const cases = await loadCalibrationCasesFromDirectory(tmp)

      expect(cases.map((item) => item.id)).toEqual(['json-case', 'yaml-case'])
    } finally {
      await fs.rm(tmp, { recursive: true, force: true })
    }
  })

  it('loads nested calibration corpus directories so cases are not UX-only', async () => {
    const cases = await loadCalibrationCasesFromDirectory(
      path.resolve('internal/calibration/cases'),
    )

    expect(cases.length).toBeGreaterThanOrEqual(8)
    expect(cases.flatMap((item) => item.reviewLanes)).toEqual(expect.arrayContaining([
      'ux_comprehension',
      'accessibility',
      'security',
      'api_contract',
      'data_integrity',
      'performance',
      'docs_truth',
    ]))
    expect(new Set(cases.map((item) => item.productType)).size).toBeGreaterThan(3)
  })

  it('ships a small UX seed corpus with hidden findings and at least one negative control', async () => {
    const cases = await loadCalibrationCasesFromDirectory(
      path.resolve('internal/calibration/cases/ux'),
    )

    expect(cases.length).toBeGreaterThanOrEqual(4)
    expect(cases.some((item) => item.negativeControl)).toBe(true)
    expect(cases.some((item) => item.source.kind === 'external_example')).toBe(true)
    expect(cases.every((item) => item.knownFindings.length > 0 || item.negativeControl)).toBe(true)
    expect(cases.flatMap((item) => item.reviewLanes)).toEqual(expect.arrayContaining([
      'ux_comprehension',
      'copy_clarity',
    ]))
  })

  it('selects versioned calibration recipes by risk lane and required artifacts', () => {
    expect(defaultReviewCalibrationRecipes.map((recipe) => recipe.id)).toEqual(
      expect.arrayContaining([
        'ux-zero-context-comprehension',
        'ux-error-recovery',
        'ux-cross-surface-consistency',
      ]),
    )

    const selected = selectCalibrationRecipesForLanes([
      'ux_comprehension',
      'copy_clarity',
    ])

    expect(selected.map((recipe) => recipe.id)).toEqual(expect.arrayContaining([
      'ux-zero-context-comprehension',
      'ux-error-recovery',
      'ux-cross-surface-consistency',
    ]))
    expect(selected[0]).toMatchObject({
      version: 'v1',
      contextPacket: 'zero_context_artifacts_only',
      calibratedCaseIds: expect.arrayContaining(['ambiguous-primary-action']),
    })
    expect(selected.flatMap((recipe) => recipe.requiredArtifactKinds)).toEqual(
      expect.arrayContaining(['copy_snippet']),
    )

    const crossDomain = selectCalibrationRecipesForLanes([
      'security',
      'api_contract',
      'performance',
      'docs_truth',
    ])
    expect(crossDomain.map((recipe) => recipe.id)).toEqual(expect.arrayContaining([
      'security-tenant-boundary',
      'api-compatibility-contract',
      'performance-critical-path',
      'docs-truth-quickstart',
    ]))
  })

  it('builds a valid calibration-case draft from an escaped review miss', () => {
    const draft = buildCalibrationCaseDraftFromEscapedMiss({
      miss: {
        taskId: 'task-123',
        missedLane: 'ux_comprehension',
        missedByRecipe: 'product-ux-zero-context',
        humanFinding: 'The reviewer missed that the primary setup action was ambiguous.',
        nextCalibrationAction: 'create_case',
        recordedAt: '2026-05-25T12:05:00.000Z',
        recordedBy: 'calibration:test',
      },
      title: 'Ambiguous setup primary action escaped review',
      scenario: 'A user-facing setup card reached review even though the safe next action was unclear.',
      labeledBy: 'calibration:test',
      labeledAt: '2026-05-25T12:10:00.000Z',
      reviewAfter: '2026-11-25',
    })

    expect(CalibrationCase.parse(draft)).toMatchObject({
      id: 'escaped-task-123-ux-comprehension',
      title: 'Ambiguous setup primary action escaped review',
      reviewLanes: ['ux_comprehension'],
      source: {
        kind: 'production_miss',
        citation: 'Escaped review miss for task task-123.',
      },
      labelGovernance: {
        labeledBy: 'calibration:test',
        labeledAt: '2026-05-25T12:10:00.000Z',
        reviewStatus: 'seed',
      },
      privacyClassification: 'internal',
      knownFindings: [{
        id: 'escaped-task-123-ux-comprehension-finding',
        lane: 'ux_comprehension',
        severity: 'high',
        summary: 'The reviewer missed that the primary setup action was ambiguous.',
      }],
    })
    expect(draft.knownFindings[0]!.matchHints).toEqual([
      'primary setup action',
      'ambiguous',
    ])
    expect(draft.falsePositiveTraps[0]!.summary).toContain('Do not fail this case only because')
  })

  it('summarizes corpus coverage and records validation through the review audit store facade', async () => {
    const casesDir = path.resolve(process.cwd(), 'internal/calibration/cases')
    const cases = await loadCalibrationCasesFromDirectory(casesDir)
    const summary = buildCalibrationCorpusSummary(cases)

    expect(summary.caseCount).toBeGreaterThanOrEqual(4)
    expect(summary.knownFindingCount).toBeGreaterThan(0)
    expect(summary.negativeControlCount).toBeGreaterThan(0)
    expect(summary.missingCaseIds).toEqual([])
    expect(summary.recipeIds).toEqual(expect.arrayContaining([
      'ux-zero-context-comprehension',
      'ux-error-recovery',
      'ux-cross-surface-consistency',
    ]))

    const frontierRuns: unknown[] = []
    const recorded = await recordCalibrationCorpusValidation({
      casesDir,
      store: {
        async saveFrontierRun(run) {
          frontierRuns.push(run)
          return {
            payload: run,
          } as never
        },
      },
      recordedBy: 'calibration:test',
      now: () => new Date('2026-05-25T12:00:00.000Z'),
    })

    expect(frontierRuns).toHaveLength(1)
    expect(recorded.summary.missingCaseIds).toEqual([])
    expect(frontierRuns[0]).toMatchObject({
      runId: 'review-calibration-corpus-2026-05-25t12-00-00-000z',
      variantSet: 'review-calibration-corpus',
      variants: [
        'ux-zero-context-comprehension',
        'ux-error-recovery',
        'ux-cross-surface-consistency',
        'accessibility-keyboard-path',
        'security-tenant-boundary',
        'api-compatibility-contract',
        'data-idempotent-side-effects',
        'performance-critical-path',
        'docs-truth-quickstart',
      ],
      recordedBy: 'calibration:test',
    })
  })
})
