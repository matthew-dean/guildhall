import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  DETERMINISTIC_BASELINE_LANE,
  aggregateBakeoffReport,
  historicalFailureScenarios,
  learningCandidatesFromBakeoffReport,
  renderBakeoffMarkdown,
  runModelBakeoff,
} from '../model-bakeoff.js'

const root = path.resolve(__dirname, '../../..')

describe('model bakeoff harness', () => {
  it('defines replay metadata for the historical 0.5.0 failure set', () => {
    expect(historicalFailureScenarios.length).toBeGreaterThanOrEqual(12)
    expect(historicalFailureScenarios.map((scenario) => scenario.id)).toEqual(
      expect.arrayContaining([
        'dirty-checkout-before-worktree',
        'stale-old-string',
        'reviewer-infrastructure-noise',
        'repeated-read-only-turns-after-target-discovery',
      ]),
    )
    expect(historicalFailureScenarios[0]).toMatchObject({
      origin: '0.5.0-flow-audit',
      expectedSignals: expect.any(Array),
    })
  })

  it('aggregates lane reports with outcome, cost, false decisions, playbooks, and packet quality', () => {
    const scenarios = historicalFailureScenarios.slice(0, 2)
    const report = aggregateBakeoffReport({
      scenarios,
      lanes: [
        DETERMINISTIC_BASELINE_LANE,
        { id: 'cheap-reviewer', label: 'Cheap reviewer', kind: 'model', model: 'small-reviewer' },
        { id: 'strong-worker', label: 'Strong worker', kind: 'model', model: 'large-worker' },
      ],
      runs: [
        {
          scenarioId: scenarios[0]!.id,
          laneId: 'deterministic-baseline',
          outcome: 'pass',
          toolCount: 2,
          wallTimeMs: 50,
          inputTokens: 0,
          outputTokens: 0,
          estimatedCostUsd: 0,
          falseEscalations: 0,
          falseApprovals: 0,
          playbookSuccesses: 1,
          playbookFailures: 0,
          packetQuality: 0.8,
        },
        {
          scenarioId: scenarios[1]!.id,
          laneId: 'deterministic-baseline',
          outcome: 'fail',
          toolCount: 1,
          wallTimeMs: 30,
          inputTokens: 0,
          outputTokens: 0,
          estimatedCostUsd: 0,
          falseEscalations: 1,
          falseApprovals: 0,
          playbookSuccesses: 0,
          playbookFailures: 1,
          packetQuality: 0.3,
        },
        {
          scenarioId: scenarios[0]!.id,
          laneId: 'cheap-reviewer',
          outcome: 'pass',
          toolCount: 3,
          wallTimeMs: 120,
          inputTokens: 2000,
          outputTokens: 500,
          estimatedCostUsd: 0.012,
          falseEscalations: 0,
          falseApprovals: 0,
          playbookSuccesses: 1,
          playbookFailures: 0,
          packetQuality: 0.9,
        },
        {
          scenarioId: scenarios[1]!.id,
          laneId: 'cheap-reviewer',
          outcome: 'pass',
          toolCount: 4,
          wallTimeMs: 140,
          inputTokens: 2100,
          outputTokens: 600,
          estimatedCostUsd: 0.014,
          falseEscalations: 0,
          falseApprovals: 0,
          playbookSuccesses: 1,
          playbookFailures: 0,
          packetQuality: 0.7,
        },
        {
          scenarioId: scenarios[0]!.id,
          laneId: 'strong-worker',
          outcome: 'pass',
          toolCount: 5,
          wallTimeMs: 300,
          inputTokens: 5000,
          outputTokens: 1500,
          estimatedCostUsd: 0.09,
          falseEscalations: 0,
          falseApprovals: 0,
          playbookSuccesses: 1,
          playbookFailures: 0,
          packetQuality: 0.95,
        },
      ],
    })

    expect(report.scenarioCount).toBe(2)
    expect(report.lanes.map((lane) => lane.laneId)).toEqual([
      'deterministic-baseline',
      'cheap-reviewer',
      'strong-worker',
    ])
    expect(report.lanes[0]).toMatchObject({
      completedTasks: 1,
      failedTasks: 1,
      totalEstimatedCostUsd: 0,
      costPerCompletedTaskUsd: 0,
      falseEscalations: 1,
      falseApprovals: 0,
      recoveryLoops: 2,
      costPerRecoveryLoopUsd: 0,
      playbookSuccessRate: 0.5,
      averagePacketQuality: 0.55,
    })
    expect(report.lanes[1]).toMatchObject({
      completedTasks: 2,
      failedTasks: 0,
      totalEstimatedCostUsd: 0.026,
      costPerCompletedTaskUsd: 0.013,
      playbookSuccessRate: 1,
    })
    expect(report.recommendation).toContain('cheap-reviewer')
    expect(report.recommendation).toContain('2/2')
  })

  it('turns failed replay runs into product suggestions and model lane recommendations', () => {
    const scenario = historicalFailureScenarios.find((candidate) => candidate.id === 'stale-old-string')!
    const report = aggregateBakeoffReport({
      scenarios: [scenario],
      lanes: [
        { id: 'cheap-reviewer', label: 'Cheap reviewer', kind: 'model', model: 'small-reviewer' },
      ],
      runs: [
        {
          scenarioId: scenario.id,
          laneId: 'cheap-reviewer',
          outcome: 'fail',
          toolCount: 4,
          wallTimeMs: 100,
          inputTokens: 1600,
          outputTokens: 400,
          estimatedCostUsd: 0.02,
          falseEscalations: 1,
          falseApprovals: 1,
          playbookSuccesses: 0,
          playbookFailures: 1,
          packetQuality: 0.2,
        },
      ],
    })

    const candidates = learningCandidatesFromBakeoffReport(report)
    expect(candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'bakeoff-cheap-reviewer-model-lane',
          proposedDestination: 'model_lane_recommendation',
          proposedScope: 'user_global',
        }),
        expect.objectContaining({
          id: 'bakeoff-cheap-reviewer-product',
          proposedDestination: 'product_suggestion',
          proposedScope: 'guildhall_product',
        }),
      ]),
    )
  })

  it('can run fixtures through a deterministic baseline plus model lanes', () => {
    const report = runModelBakeoff({
      scenarios: historicalFailureScenarios.slice(0, 3),
      lanes: [
        DETERMINISTIC_BASELINE_LANE,
        { id: 'cheap-reviewer', label: 'Cheap reviewer', kind: 'model', model: 'small-reviewer' },
        { id: 'strong-worker', label: 'Strong worker', kind: 'model', model: 'large-worker' },
      ],
    })

    expect(report.lanes).toHaveLength(3)
    expect(report.runs).toHaveLength(9)
    expect(report.lanes.every((lane) => lane.costPerRecoveryLoopUsd !== null)).toBe(true)
  })

  it('renders a markdown report with cost and packet-quality columns', () => {
    const report = runModelBakeoff({
      generatedAt: '2026-05-19T20:00:00.000Z',
      scenarios: historicalFailureScenarios.slice(0, 1),
      lanes: [
        DETERMINISTIC_BASELINE_LANE,
        { id: 'strong-worker', label: 'Strong worker', kind: 'model', model: 'large-worker' },
      ],
    })

    expect(renderBakeoffMarkdown(report)).toContain('# Guildhall Model Bakeoff')
    expect(renderBakeoffMarkdown(report)).toContain('Generated: 2026-05-19T20:00:00.000Z')
    expect(renderBakeoffMarkdown(report)).toContain('deterministic-baseline | 0/1 | 1')
    expect(renderBakeoffMarkdown(report)).toContain('strong-worker | 1/1 | 0')
    expect(renderBakeoffMarkdown(report)).toContain('| Lane | Completed | Failed | False escalations')
  })
})

describe('model bakeoff script', () => {
  it('is exposed as a package script with a node entrypoint', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }
    const script = fs.readFileSync(path.join(root, 'scripts', 'model-bakeoff.mjs'), 'utf8')

    expect(manifest.scripts['model:bakeoff']).toContain('scripts/model-bakeoff.mjs')
    expect(script).toContain('runModelBakeoff')
    expect(script).toContain('model-bakeoff-report.json')
  })
})
