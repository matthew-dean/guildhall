import { describe, expect, it } from 'vitest'
import type { GuildDefinition } from '@guildhall/guilds'
import type { ReviewPlanRecord } from '../review-audit-store.js'
import { selectReviewersForPlan } from '../reviewer-fanout.js'

function guild(slug: string): GuildDefinition {
  return {
    slug,
    name: slug,
    blurb: slug,
    role: 'specialist',
    principles: slug,
    rubric: [{ id: `${slug}-review`, question: 'Review?', weight: 1 }],
    deterministicChecks: [],
    applicable: () => true,
  }
}

function plan(overrides: Partial<ReviewPlanRecord> = {}): ReviewPlanRecord {
  return {
    taskId: 'task-1',
    effort: 'balanced',
    depth: 'standard',
    selectedLanes: ['ux_comprehension', 'copy_clarity', 'test_adequacy'],
    skippedLanes: [],
    requiredRecipes: [],
    advisoryLenses: [],
    deterministicChecks: [],
    requiredArtifacts: [],
    budget: { maxReviewerAgents: 2 },
    aggregation: {},
    reasons: [],
    createdAt: '2026-05-25T12:00:00.000Z',
    createdBy: 'test',
    ...overrides,
  }
}

describe('selectReviewersForPlan', () => {
  it('caps reviewer personas to the plan budget while preserving lane coverage', () => {
    const selected = selectReviewersForPlan([
      guild('project-manager'),
      guild('component-designer'),
      guild('copywriter'),
      guild('security-engineer'),
      guild('test-engineer'),
    ], plan())

    expect(selected.map((persona) => persona.slug)).toEqual([
      'component-designer',
      'copywriter',
    ])
  })

  it('keeps all applicable reviewers when the plan has no agent cap', () => {
    const personas = [
      guild('project-manager'),
      guild('component-designer'),
      guild('copywriter'),
    ]

    expect(selectReviewersForPlan(personas, plan({ budget: {} })).map((persona) => persona.slug)).toEqual([
      'project-manager',
      'component-designer',
      'copywriter',
    ])
  })
})
