import { describe, expect, it } from 'vitest'
import type { Task } from '@guildhall/core'
import type {
  PersistedEvent,
  PersistedRecord,
  PersistencePlacement,
} from '@guildhall/persistence'

import {
  buildReviewPlan,
  buildTaskReviewRiskProfile,
  ensureTaskReviewPlanRecorded,
  evaluateReviewArtifactReadiness,
} from '../review-planner.js'
import type {
  ReviewAuditStore,
  ReviewPlanEvent,
  ReviewPlanRecord,
} from '../review-audit-store.js'

const auditPlacement: PersistencePlacement = {
  scope: 'shared_project',
  retention: 'active',
  visibility: 'internal_audit',
  commitPolicy: 'committed',
}

function persistedPlan(plan: ReviewPlanRecord): PersistedRecord<ReviewPlanRecord> {
  return {
    schema: { name: 'review-plan', version: 1 },
    ref: {
      scope: 'shared_project',
      collection: 'review-plans',
      id: plan.taskId,
      path: '/tmp/review-plan.json',
    },
    placement: auditPlacement,
    provenance: {
      createdAt: plan.createdAt,
      updatedAt: plan.createdAt,
      createdBy: plan.createdBy,
      sourceRefs: [],
    },
    contentHash: 'hash',
    payload: plan,
  }
}

function persistedPlanEvent(event: ReviewPlanEvent): PersistedEvent<ReviewPlanEvent> {
  return {
    schema: { name: 'review-plan-event', version: 1 },
    ref: {
      scope: 'shared_project',
      collection: 'review-plan-events',
      id: 'event-1',
      path: '/tmp/event.jsonl',
    },
    eventId: 'event-1',
    recordedAt: event.recordedAt,
    recordedBy: event.recordedBy,
    placement: auditPlacement,
    sourceRefs: [],
    contentHash: 'hash',
    payload: event,
  }
}

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
    expect(plan.requiredRecipes.find((recipe) => recipe.recipeId === 'product-ux-zero-context')).toMatchObject({
      calibrationRecipeIds: expect.arrayContaining([
        'ux-zero-context-comprehension',
        'ux-error-recovery',
        'ux-cross-surface-consistency',
      ]),
    })
    expect(plan.deterministicChecks).toContain('browser-or-screenshot-evidence')
    expect(plan.deterministicChecks).toContain('design-system-control-reference-check')
    expect(plan.deterministicChecks).toContain('style-sprawl-regression-scan')
    expect(plan.deterministicChecks).toContain('shared-primitive-opportunity-scan')
    expect(plan.requiredArtifacts).toContain('visual-evidence')
    expect(plan.budget.maxReviewerAgents).toBeGreaterThan(3)
  })

  it('brings design-system control-choice work into generic UX, visual, and accessibility review', () => {
    const plan = buildReviewPlan({
      task: task({
        title: 'Make the project UI library agent-ready',
        description: 'Document when to use split buttons, variants, props, and layout controls so agents choose from the design system instead of adding margins or bespoke wrapper styles.',
      }),
      changedFiles: [
        'packages/ui/src/components/SplitButton.tsx',
        'packages/ui/docs/controls.md',
      ],
      createdAt: '2026-05-25T12:00:00.000Z',
    })

    expect(plan.selectedLanes).toEqual(expect.arrayContaining([
      'ux_comprehension',
      'visual_design',
      'accessibility',
      'test_adequacy',
      'plan_completeness',
    ]))
    expect(plan.requiredRecipes.map((recipe) => recipe.recipeId)).toContain('product-ux-zero-context')
    expect(plan.deterministicChecks).toEqual(expect.arrayContaining([
      'browser-or-screenshot-evidence',
      'design-system-control-reference-check',
      'style-sprawl-regression-scan',
      'shared-primitive-opportunity-scan',
    ]))
    expect(plan.reasons).toContain('Design-system control selection needs reviewer context for component intent, variants, layout ownership, anti-sprawl extraction opportunities, findability, and accessible semantics.')
  })

  it('flags long select-list work for control-choice review', () => {
    const plan = buildReviewPlan({
      task: task({
        title: 'Replace long country select with typeahead',
        description: 'The form currently uses a huge dropdown. Prefer a combobox/autocomplete affordance so people can type to complete long option lists.',
      }),
      changedFiles: ['src/components/CountrySelect.tsx'],
      createdAt: '2026-05-25T12:00:00.000Z',
    })

    expect(plan.selectedLanes).toEqual(expect.arrayContaining([
      'ux_comprehension',
      'visual_design',
      'accessibility',
    ]))
    expect(plan.deterministicChecks).toContain('design-system-control-reference-check')
    expect(plan.deterministicChecks).toContain('style-sprawl-regression-scan')
    expect(plan.reasons).toContain('Design-system control selection needs reviewer context for component intent, variants, layout ownership, anti-sprawl extraction opportunities, findability, and accessible semantics.')
  })

  it('projects review plans into task review-risk profiles with artifact gates', () => {
    const plan = buildReviewPlan({
      task: task({
        title: 'Improve setup wizard empty state',
        description: 'The browser setup flow has confusing labels and missing keyboard focus behavior.',
      }),
      changedFiles: ['src/web/surfaces/SetupWizard.svelte'],
      createdAt: '2026-05-25T12:00:00.000Z',
      createdBy: 'coordinator-review-planner',
    })

    const profile = buildTaskReviewRiskProfile(plan)

    expect(profile).toMatchObject({
      lanes: expect.arrayContaining(['ux_comprehension', 'visual_design', 'accessibility']),
      requiredArtifacts: expect.arrayContaining([
        'implementation-summary',
        'verification-evidence',
        'visual-evidence',
      ]),
      artifactPolicy: 'required_before_review',
      assessedAt: '2026-05-25T12:00:00.000Z',
      assessedBy: 'coordinator-review-planner',
    })
    expect(profile.recipes.find((recipe) => recipe.recipeId === 'product-ux-zero-context')).toMatchObject({
      required: true,
      releaseBlocking: true,
      requiredArtifacts: expect.arrayContaining(['visual-evidence']),
      reason: expect.stringContaining('ux_comprehension'),
    })

    expect(evaluateReviewArtifactReadiness({
      reviewRisk: profile,
      artifactRefs: ['implementation-summary', 'verification-evidence'],
    })).toMatchObject({
      ready: false,
      missingArtifacts: ['visual-evidence'],
    })
    expect(evaluateReviewArtifactReadiness({
      reviewRisk: profile,
      artifactRefs: ['implementation-summary', 'verification-evidence', 'visual-evidence'],
    })).toMatchObject({
      ready: true,
      missingArtifacts: [],
    })
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

  it('treats requested review effort as a floor, not a cap on safety-sensitive work', () => {
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
      requestedEffort: 'balanced',
      createdAt: '2026-05-25T12:00:00.000Z',
    })

    expect(plan.effort).toBe('release_critical')
    expect(plan.depth).toBe('release_critical')
    expect(plan.budget.maxReviewerAgents).toBe(8)
    expect(plan.aggregation.security).toBe('strict')
  })

  it('adds a small set of advisory reasoning lenses for rough spec shaping', () => {
    const plan = buildReviewPlan({
      task: task({
        status: 'spec_review',
        title: 'Shape a rough product idea into first runnable work',
        description: 'The request is ambiguous and needs a spec, task boundary, acceptance criteria, and proof path before implementation.',
      }),
      createdAt: '2026-05-25T12:00:00.000Z',
    })

    expect(plan.advisoryLenses.map((lens) => lens.lens)).toEqual([
      'first_principles',
      'contrarian',
      'executor',
    ])
    expect(plan.advisoryLenses.every((lens) => lens.blocking === 'advisory')).toBe(true)
  })

  it('keeps outsider and expansionist lenses constrained to matching work', () => {
    const plan = buildReviewPlan({
      task: task({
        title: 'Improve public docs onboarding copy',
        description: 'Make the guide easier for a brand new reader and note one future follow-up opportunity without expanding this task.',
      }),
      changedFiles: ['docs/guide/index.md'],
      createdAt: '2026-05-25T12:00:00.000Z',
    })

    expect(plan.advisoryLenses.map((lens) => lens.lens)).toEqual([
      'first_principles',
      'executor',
      'outsider',
      'expansionist',
    ])
    expect(plan.advisoryLenses.find((lens) => lens.lens === 'expansionist')).toMatchObject({
      blocking: 'advisory',
    })
  })
})

describe('ensureTaskReviewPlanRecorded', () => {
  it('stores a new review plan and creation event once', async () => {
    const savedPlans: ReviewPlanRecord[] = []
    const savedEvents: ReviewPlanEvent[] = []
    const store: Pick<ReviewAuditStore, 'readTaskReviewAudit' | 'saveReviewPlan' | 'appendReviewPlanEvent'> = {
      async readTaskReviewAudit() {
        return {
          plan: null,
          events: [],
          reviewerRuns: [],
          escapedMisses: [],
        }
      },
      async saveReviewPlan(plan) {
        const saved = plan as ReviewPlanRecord
        savedPlans.push(saved)
        return persistedPlan(saved)
      },
      async appendReviewPlanEvent(event) {
        const saved = event as ReviewPlanEvent
        savedEvents.push(saved)
        return persistedPlanEvent(saved)
      },
    }

    const result = await ensureTaskReviewPlanRecorded({
      store,
      task: task({
        title: 'Fix confusing setup wizard labels',
        description: 'Update browser flow copy and focus behavior.',
      }),
      changedFiles: ['src/web/surfaces/SetupWizard.svelte'],
      createdBy: 'coordinator:test',
      now: () => new Date('2026-05-25T12:00:00.000Z'),
    })

    expect(result.recorded).toBe(true)
    expect(result.reviewRisk.requiredArtifacts).toContain('visual-evidence')
    expect(result.reviewRisk.artifactPolicy).toBe('required_before_review')
    expect(savedPlans).toHaveLength(1)
    expect(savedEvents).toHaveLength(1)
    expect(savedEvents[0]!.kind).toBe('created')
    expect(savedEvents[0]!.lanes).toEqual(result.plan.selectedLanes)
    expect(result.plan.createdAt).toBe('2026-05-25T12:00:00.000Z')
  })

  it('does not overwrite an existing review plan', async () => {
    const existing = buildReviewPlan({
      task: task({ title: 'Existing plan' }),
      createdAt: '2026-05-25T11:00:00.000Z',
    })
    let writes = 0
    const store: Pick<ReviewAuditStore, 'readTaskReviewAudit' | 'saveReviewPlan' | 'appendReviewPlanEvent'> = {
      async readTaskReviewAudit() {
        return {
          plan: persistedPlan(existing),
          events: [],
          reviewerRuns: [],
          escapedMisses: [],
        }
      },
      async saveReviewPlan() {
        writes += 1
        throw new Error('unexpected save')
      },
      async appendReviewPlanEvent() {
        writes += 1
        throw new Error('unexpected event')
      },
    }

    const result = await ensureTaskReviewPlanRecorded({
      store,
      task: task({ title: 'Existing plan' }),
    })

    expect(result.recorded).toBe(false)
    expect(result.plan.createdAt).toBe('2026-05-25T11:00:00.000Z')
    expect(writes).toBe(0)
  })
})
