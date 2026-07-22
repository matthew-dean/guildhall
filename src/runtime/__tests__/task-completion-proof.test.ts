import { describe, expect, it } from 'vitest'

import {
  classifyCompletionProof,
  recordedCompletionProofForTask,
} from '../task-completion-proof.js'

describe('task completion proof projection', () => {
  it('keeps passed gates from an older proof contract historical', () => {
    const recorded = recordedCompletionProofForTask({
      proofPaths: [{
        kind: 'command',
        id: 'task-proof-command',
        command: 'pnpm proof:context',
        expectedEvidence: [{ id: 'ac-1', required: true }],
        verificationRecords: [{ evidenceId: 'ac-1', status: 'passed' }],
      }],
      gateResults: [
        { gateId: 'ac-3', passed: true, checkedAt: '2026-07-21T05:22:40.651Z' },
        { gateId: 'ac-1', passed: true, checkedAt: '2026-07-21T22:31:54.140Z' },
      ],
    })

    expect(classifyCompletionProof(recorded, false)).toEqual({
      current: ['Gate passed: ac-1'],
      historical: ['Gate passed: ac-3'],
    })
  })

  it('does not let an approval sentence satisfy a current proof path', () => {
    const recorded = recordedCompletionProofForTask({
      proofPaths: [{
        kind: 'review',
        id: 'review-path',
        expectedEvidence: [{ id: 'world-state', required: true }],
      }],
      reviewVerdicts: [{
        verdict: 'approve',
        reviewerPath: 'llm',
        reasoning: 'The model used different prose but reached the same conclusion.',
        proofEvidenceIds: [],
      }],
    })

    expect(classifyCompletionProof(recorded, false)).toEqual({
      current: [],
      historical: ['Review approved: llm'],
    })
  })
})
