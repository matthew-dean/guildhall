import { describe, expect, it } from 'vitest'

import {
  completionProofCanSettleUnmetAcceptanceCriteria,
  taskDoneButProofMissing,
} from '../proof-health.js'

function reviewedTask(criterion: Record<string, unknown>) {
  return {
    id: 'task-live-proof',
    title: 'Prove the live drafting model',
    status: 'done',
    acceptanceCriteria: [criterion],
    reviewVerdicts: [{
      verdict: 'approved',
      reasoning: 'acceptance-criteria-met: yes — all acceptance criteria are satisfied.',
      recordedAt: '2026-07-13T22:00:00.000Z',
    }],
  }
}

describe('proof health', () => {
  it('does not let review narration settle a command-backed criterion', () => {
    const task = reviewedTask({
      id: 'live-provider-proof',
      description: 'Run the DeepInfra model proof command and record the output.',
      verifiedBy: 'automated',
      met: false,
    })

    expect(completionProofCanSettleUnmetAcceptanceCriteria(task)).toBe(false)
    expect(taskDoneButProofMissing(task)).toBe(true)
  })

  it('still permits review-only criteria to settle from an approving review', () => {
    const task = reviewedTask({
      id: 'review-only-proof',
      description: 'The reviewer records the user-facing decision rationale.',
      verifiedBy: 'review',
      met: false,
    })

    expect(completionProofCanSettleUnmetAcceptanceCriteria(task)).toBe(true)
    expect(taskDoneButProofMissing(task)).toBe(false)
  })
})
