import { describe, expect, it } from 'vitest'
import { Task } from '@guildhall/core'

import {
  requestSpecReview,
  specReviewAuthority,
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
})
