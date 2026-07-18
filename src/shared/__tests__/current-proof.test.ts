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
})
