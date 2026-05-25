import { describe, expect, it } from 'vitest'
import type { Task } from '@guildhall/core'

import { buildReviewPlan } from '../review-planner.js'

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    title: 'Task',
    description: '',
    domain: 'product',
    projectPath: '/workspace/project',
    status: 'review',
    priority: 'normal',
    acceptanceCriteria: [],
    outOfScope: [],
    dependsOn: [],
    notes: [],
    gateResults: [],
    reviewVerdicts: [],
    adjudications: [],
    escalations: [],
    agentIssues: [],
    revisionCount: 0,
    remediationAttempts: 0,
    origination: 'human',
    createdAt: '2026-05-25T00:00:00.000Z',
    updatedAt: '2026-05-25T00:00:00.000Z',
    ...overrides,
  }
}

describe('buildReviewPlan', () => {
  it('keeps small docs work lean while still checking plan and test adequacy', () => {
    const plan = buildReviewPlan({
      task: task({
        priority: 'low',
        title: 'Clarify release-note wording',
        description: 'Update the public docs copy for the changelog.',
      }),
      createdAt: '2026-05-25T12:00:00.000Z',
    })

    expect(plan.effort).toBe('lean')
    expect(plan.depth).toBe('minimal')
    expect(plan.selectedLanes).toEqual([
      'copy_clarity',
      'test_adequacy',
      'docs_truth',
      'plan_completeness',
    ])
    expect(plan.budget.maxReviewerAgents).toBe(2)
    expect(plan.aggregation.docs_truth).toBe('advisory')
  })

  it('plans grouped UX review when frontend files and user-facing flow text are present', () => {
    const plan = buildReviewPlan({
      task: task({
        title: 'Improve setup wizard empty state',
        description: 'The browser setup flow has confusing labels and missing keyboard focus behavior.',
      }),
      changedFiles: [
        'src/web/surfaces/SetupWizard.svelte',
        'src/web/surfaces/setup-wizard.css',
      ],
      createdAt: '2026-05-25T12:00:00.000Z',
    })

    expect(plan.effort).toBe('balanced')
    expect(plan.selectedLanes).toEqual(expect.arrayContaining([
      'ux_comprehension',
      'copy_clarity',
      'visual_design',
      'accessibility',
      'test_adequacy',
    ]))
    expect(plan.requiredRecipes.map((recipe) => recipe.recipeId)).toContain('product-ux-zero-context')
    expect(plan.deterministicChecks).toContain('browser-or-screenshot-evidence')
    expect(plan.requiredArtifacts).toContain('visual-evidence')
    expect(plan.budget.maxReviewerAgents).toBeGreaterThan(3)
  })

  it('escalates critical auth migration work to release-critical depth and strict aggregation', () => {
    const plan = buildReviewPlan({
      task: task({
        priority: 'critical',
        title: 'Migrate account permission model',
        description: 'Change the auth API schema, migrate database rows, and preserve rollout fallback.',
      }),
      changedFiles: [
        'src/api/accounts.ts',
        'migrations/20260525-permissions.sql',
      ],
      createdAt: '2026-05-25T12:00:00.000Z',
    })

    expect(plan.effort).toBe('release_critical')
    expect(plan.depth).toBe('release_critical')
    expect(plan.selectedLanes).toEqual(expect.arrayContaining([
      'security',
      'api_contract',
      'data_integrity',
      'migration_safety',
      'release_risk',
      'rollout_safety',
    ]))
    expect(plan.aggregation.security).toBe('strict')
    expect(plan.aggregation.migration_safety).toBe('strict')
    expect(plan.budget.maxReviewerAgents).toBe(8)
  })

  it('allows an explicit custom review budget without losing detected lanes', () => {
    const plan = buildReviewPlan({
      task: task({
        title: 'Tune model-review budget',
        description: 'Adjust reviewer model settings, token budget, and calibration prompts.',
      }),
      requestedEffort: 'custom',
      budgetOverride: {
        maxReviewerAgents: 5,
        maxEstimatedTokens: 64000,
      },
      createdAt: '2026-05-25T12:00:00.000Z',
      createdBy: 'coordinator:test',
    })

    expect(plan.effort).toBe('custom')
    expect(plan.depth).toBe('targeted')
    expect(plan.createdBy).toBe('coordinator:test')
    expect(plan.budget.maxReviewerAgents).toBe(5)
    expect(plan.budget.maxEstimatedTokens).toBe(64000)
    expect(plan.selectedLanes).toEqual(expect.arrayContaining([
      'calibration_governance',
      'cost_control',
      'plan_completeness',
      'test_adequacy',
    ]))
    expect(plan.skippedLanes.some((entry) => entry.lane === 'security')).toBe(true)
  })
})
