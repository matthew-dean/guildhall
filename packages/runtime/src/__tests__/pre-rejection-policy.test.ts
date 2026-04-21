import { describe, expect, it } from 'vitest'

import { evaluatePreRejection } from '../pre-rejection-policy.js'
import type { DomainLevers, ProjectLevers } from '@guildhall/levers'

// ---------------------------------------------------------------------------
// Pure-policy tests for FR-22 pre_rejection_policy × rejection_dampening.
// The orchestrator-integration tests (in orchestrator.test.ts) verify the
// on-disk effects; these tests verify the policy math in isolation so
// regressions here surface as clear logic failures, not as diff-debugging
// through a whole tick.
// ---------------------------------------------------------------------------

function policy(
  position: DomainLevers['pre_rejection_policy']['position'],
): Pick<DomainLevers, 'pre_rejection_policy'> {
  return {
    pre_rejection_policy: {
      position,
      rationale: 'test',
      setAt: '2026-04-20T00:00:00Z',
      setBy: 'user-direct',
    },
  }
}

function damp(
  position: ProjectLevers['rejection_dampening']['position'],
): Pick<ProjectLevers, 'rejection_dampening'> {
  return {
    rejection_dampening: {
      position,
      rationale: 'test',
      setAt: '2026-04-20T00:00:00Z',
      setBy: 'user-direct',
    },
  }
}

describe('evaluatePreRejection — terminal_shelved', () => {
  it('keeps the task shelved regardless of dampening', () => {
    const decision = evaluatePreRejection({
      currentRequeueCount: 0,
      currentPriority: 'normal',
      domain: policy('terminal_shelved'),
      project: damp({ kind: 'off' }),
    })
    expect(decision.action.kind).toBe('keep_shelved')
    expect(decision.requeueCount).toBe(1)
  })

  it('still increments requeueCount so audit trails show the event', () => {
    const decision = evaluatePreRejection({
      currentRequeueCount: 4,
      currentPriority: 'normal',
      domain: policy('terminal_shelved'),
      project: damp({ kind: 'hard_suppress', after: 2 }),
    })
    expect(decision.action.kind).toBe('keep_shelved')
    expect(decision.requeueCount).toBe(5)
  })
})

describe('evaluatePreRejection — requeue_lower_priority', () => {
  it('steps priority down one notch and requeues', () => {
    const decision = evaluatePreRejection({
      currentRequeueCount: 0,
      currentPriority: 'high',
      domain: policy('requeue_lower_priority'),
      project: damp({ kind: 'off' }),
    })
    expect(decision.action.kind).toBe('requeue')
    if (decision.action.kind === 'requeue') {
      expect(decision.action.newPriority).toBe('normal')
    }
  })

  it('floors to low when already at low priority', () => {
    const decision = evaluatePreRejection({
      currentRequeueCount: 2,
      currentPriority: 'low',
      domain: policy('requeue_lower_priority'),
      project: damp({ kind: 'off' }),
    })
    if (decision.action.kind === 'requeue') {
      expect(decision.action.newPriority).toBe('low')
    }
  })

  it('ignores rejection_dampening', () => {
    // dampening only participates with requeue_with_dampening
    const decision = evaluatePreRejection({
      currentRequeueCount: 10,
      currentPriority: 'normal',
      domain: policy('requeue_lower_priority'),
      project: damp({ kind: 'hard_suppress', after: 1 }),
    })
    expect(decision.action.kind).toBe('requeue')
  })
})

describe('evaluatePreRejection — requeue_with_dampening × off', () => {
  it('requeues one notch down regardless of count', () => {
    const decision = evaluatePreRejection({
      currentRequeueCount: 99,
      currentPriority: 'critical',
      domain: policy('requeue_with_dampening'),
      project: damp({ kind: 'off' }),
    })
    expect(decision.action.kind).toBe('requeue')
    if (decision.action.kind === 'requeue') {
      expect(decision.action.newPriority).toBe('high')
    }
  })
})

describe('evaluatePreRejection — requeue_with_dampening × soft_penalty', () => {
  it('requeues one notch down while below threshold', () => {
    const decision = evaluatePreRejection({
      currentRequeueCount: 0,
      currentPriority: 'high',
      domain: policy('requeue_with_dampening'),
      project: damp({ kind: 'soft_penalty', after: 3 }),
    })
    // nextCount = 1 < after=3 → one notch down
    if (decision.action.kind === 'requeue') {
      expect(decision.action.newPriority).toBe('normal')
    }
  })

  it('floors to low once the threshold is reached', () => {
    const decision = evaluatePreRejection({
      currentRequeueCount: 2,
      currentPriority: 'high',
      domain: policy('requeue_with_dampening'),
      project: damp({ kind: 'soft_penalty', after: 3 }),
    })
    // nextCount = 3 >= after=3 → priority floored to low
    if (decision.action.kind === 'requeue') {
      expect(decision.action.newPriority).toBe('low')
    }
    expect(decision.requeueCount).toBe(3)
  })
})

describe('evaluatePreRejection — requeue_with_dampening × hard_suppress', () => {
  it('requeues while below threshold', () => {
    const decision = evaluatePreRejection({
      currentRequeueCount: 0,
      currentPriority: 'normal',
      domain: policy('requeue_with_dampening'),
      project: damp({ kind: 'hard_suppress', after: 2 }),
    })
    expect(decision.action.kind).toBe('requeue')
    expect(decision.requeueCount).toBe(1)
  })

  it('keeps shelved once threshold is hit', () => {
    const decision = evaluatePreRejection({
      currentRequeueCount: 1,
      currentPriority: 'normal',
      domain: policy('requeue_with_dampening'),
      project: damp({ kind: 'hard_suppress', after: 2 }),
    })
    // nextCount = 2 >= after=2 → suppress
    expect(decision.action.kind).toBe('keep_shelved')
    expect(decision.requeueCount).toBe(2)
  })

  it('keeps shelved on subsequent events past threshold', () => {
    const decision = evaluatePreRejection({
      currentRequeueCount: 10,
      currentPriority: 'low',
      domain: policy('requeue_with_dampening'),
      project: damp({ kind: 'hard_suppress', after: 2 }),
    })
    expect(decision.action.kind).toBe('keep_shelved')
  })
})

describe('evaluatePreRejection — decision audit fields', () => {
  it('records both lever positions on the decision', () => {
    const decision = evaluatePreRejection({
      currentRequeueCount: 0,
      currentPriority: 'normal',
      domain: policy('requeue_with_dampening'),
      project: damp({ kind: 'soft_penalty', after: 5 }),
    })
    expect(decision.domainLeverPosition).toBe('requeue_with_dampening')
    expect(decision.projectLeverPosition).toEqual({ kind: 'soft_penalty', after: 5 })
  })
})
