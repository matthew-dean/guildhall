import { describe, expect, it } from 'vitest'

import { summarizeCurrentProof } from '../current-proof.js'

describe('summarizeCurrentProof', () => {
  it('uses passed records on current proof paths instead of only top-level gates', () => {
    expect(summarizeCurrentProof({
      status: 'done',
      proofPaths: [
        {
          kind: 'review',
          title: 'Review the coherence boundary',
          status: 'verified',
          expectedEvidence: [{ id: 'boundary', required: true }],
          verificationRecords: [{ evidenceId: 'boundary', status: 'passed' }],
        },
        {
          kind: 'command',
          title: 'Run the focused proof',
          command: 'pnpm test -- focused',
          status: 'planned',
          expectedEvidence: [{ id: 'focused', required: true }],
          verificationRecords: [],
        },
      ],
    })).toEqual({
      state: 'partial',
      expectationCount: 2,
      verified: ['Review approved: Review the coherence boundary'],
      missing: ['Required proof evidence is missing for pnpm test -- focused.'],
    })
  })

  it('does not carry historical top-level proof into a reopened task with no contract', () => {
    expect(summarizeCurrentProof({
      status: 'spec_review',
      gateResults: [{ gateId: 'old-proof', passed: true }],
      proofPaths: [],
    })).toEqual({
      state: 'needed',
      expectationCount: 0,
      verified: [],
      missing: ['Current proof contract has not been attached yet.'],
    })
  })

  it('settles a current command path from its matching passed gate', () => {
    expect(summarizeCurrentProof({
      status: 'done',
      proofPaths: [{ kind: 'command', command: 'pnpm test -- current' }],
      gateResults: [{ gateId: 'pnpm test -- current', command: 'pnpm test -- current', passed: true }],
    })).toMatchObject({
      state: 'proven',
      verified: ['Proof passed: pnpm test -- current'],
      missing: [],
    })
  })

  it('settles a current review path from approved reviewer evidence', () => {
    expect(summarizeCurrentProof({
      status: 'done',
      proofPaths: [{
        kind: 'review',
        expectedEvidence: ['The reviewer catches elapsed-time changes.'],
      }],
      latestReviewerSummary: [
        '**Verdict:** Approved',
        'The reviewer catches elapsed-time changes.',
      ].join('\n'),
    })).toMatchObject({
      state: 'proven',
      verified: ['Reviewer proof: The reviewer catches elapsed-time changes.'],
      missing: [],
    })
  })
})
