import { describe, expect, it } from 'vitest'
import { Task } from '@guildhall/core'

import {
  requestSpecReview,
  specReviewAuthority,
  specReviewIsReadyForOwnerApproval,
  specReviewRequiresOwnerApproval,
} from '../spec-review-ownership.js'

function task() {
  return Task.parse({
    id: 'task-review',
    title: 'Review authority',
    description: 'Confirm the review handoff owner.',
    domain: 'test',
    projectPath: '/tmp/project',
    status: 'exploring',
    priority: 'normal',
    dependsOn: [],
    outOfScope: [],
    acceptanceCriteria: [],
    notes: [],
    gateResults: [],
    reviewVerdicts: [],
    adjudications: [],
    escalations: [],
    agentIssues: [],
    revisionCount: 0,
    remediationAttempts: 0,
    origination: 'human',
    createdAt: '2026-07-23T12:00:00.000Z',
    updatedAt: '2026-07-23T12:00:00.000Z',
  })
}

describe('spec review ownership', () => {
  it('keeps legacy review work conservatively owner-gated', () => {
    expect(specReviewAuthority({ id: 'legacy-review' })).toBe('owner')
    expect(specReviewRequiresOwnerApproval({ id: 'legacy-review' })).toBe(true)
  })

  it('records coordinator review as a typed gate rather than inferring from status', () => {
    const candidate = task()
    requestSpecReview(candidate, {
      authority: 'coordinator',
      requestedAt: '2026-07-23T12:01:00.000Z',
      requestedBy: 'proposal-promoter',
      reason: 'proposal_promotion',
    })

    expect(candidate.status).toBe('spec_review')
    expect(candidate.specReviewGate).toEqual({
      authority: 'coordinator',
      requestedAt: '2026-07-23T12:01:00.000Z',
      requestedBy: 'proposal-promoter',
      reason: 'proposal_promotion',
    })
    expect(specReviewRequiresOwnerApproval(candidate)).toBe(false)
  })

  it('requires a complete durable spec before exposing an owner approval', () => {
    const candidate = task()
    requestSpecReview(candidate, {
      authority: 'owner',
      requestedAt: '2026-07-23T12:01:00.000Z',
      requestedBy: 'spec-agent',
      reason: 'spec_handoff',
    })

    expect(specReviewRequiresOwnerApproval(candidate)).toBe(true)
    expect(specReviewIsReadyForOwnerApproval(candidate)).toBe(false)

    candidate.productBrief = {
      userJob: 'Review a bounded implementation plan.',
      successMetric: 'The task has a complete owner-reviewable contract.',
      nonGoals: ['Do not start implementation during review.'],
      authoredBy: 'spec-agent',
    }
    candidate.structuredSpec = {
      whatThisIs: 'A bounded implementation plan.',
      problemContext: 'The task needs an explicit completion contract.',
      goals: ['Provide a reviewable implementation plan.'],
      nonGoals: ['Do not start implementation during review.'],
      proposedDesign: 'Use the existing project boundary.',
      keyDecisions: ['Keep the scope bounded.'],
      acceptanceCriteria: [{
        scenario: 'Given the owner opens the review',
        expectation: 'The completion contract is visible.',
        verificationMode: 'review',
      }],
      verification: ['Review the contract before approval.'],
      completionBoundary: {
        productOutcome: 'The owner can approve a complete plan.',
        whatGuildhallCanCompleteInCode: 'Record the implementation contract.',
        externalDependencies: 'None.',
        ownerOnlySetup: 'None.',
        verificationEnvironment: 'The registered project.',
        whatCountsAsDone: 'The complete contract is available for review.',
        whatMustBeSplitOrBlocked: 'Split only independent work.',
        splitPolicy: 'conditional',
      },
    }
    candidate.acceptanceCriteria = [{
      id: 'ac-1',
      description: 'The completion contract is visible.',
      verifiedBy: 'review',
      source: 'inferred',
      met: false,
    }]

    expect(specReviewIsReadyForOwnerApproval(candidate)).toBe(true)
  })
})
