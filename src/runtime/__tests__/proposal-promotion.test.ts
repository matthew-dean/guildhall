import { describe, it, expect } from 'vitest'
import type { Task } from '@guildhall/core'
import type { DomainLevers } from '@guildhall/levers'

import {
  InvalidPromotionInputError,
  evaluateProposal,
} from '../proposal-promotion.js'

function makeProposedTask(overrides: Partial<Task> = {}): Pick<
  Task,
  'id' | 'status' | 'origination' | 'proposedBy'
> {
  return {
    id: 't-1',
    status: 'proposed',
    origination: 'agent',
    proposedBy: 'worker:looma',
    ...overrides,
  }
}

function leverAt(
  position: DomainLevers['task_origination']['position'],
): Pick<DomainLevers, 'task_origination'> {
  return {
    task_origination: {
      position,
      rationale: 'test',
      setAt: '2026-04-20T00:00:00.000Z',
      setBy: 'system-default',
    },
  }
}

describe('evaluateProposal', () => {
  it('rejects proposals when task_origination=human_only', () => {
    const decision = evaluateProposal({
      task: makeProposedTask(),
      levers: leverAt('human_only'),
    })
    expect(decision.action.kind).toBe('reject')
    if (decision.action.kind === 'reject') {
      expect(decision.action.reason).toMatch(/human_only/)
      expect(decision.action.reason).toMatch(/Spec Agent/)
    }
    expect(decision.leverPosition).toBe('human_only')
  })

  it('routes proposals to human under agent_proposed_human_approved', () => {
    const decision = evaluateProposal({
      task: makeProposedTask(),
      levers: leverAt('agent_proposed_human_approved'),
    })
    expect(decision.action).toEqual({
      kind: 'route_to_human',
      targetStatus: 'spec_review',
    })
  })

  it('routes proposals to coordinator under agent_proposed_coordinator_approved', () => {
    const decision = evaluateProposal({
      task: makeProposedTask(),
      levers: leverAt('agent_proposed_coordinator_approved'),
    })
    expect(decision.action).toEqual({
      kind: 'route_to_coordinator',
      targetStatus: 'spec_review',
    })
  })

  it('auto-promotes proposals under agent_autonomous', () => {
    const decision = evaluateProposal({
      task: makeProposedTask(),
      levers: leverAt('agent_autonomous'),
    })
    expect(decision.action).toEqual({ kind: 'auto_promote', targetStatus: 'ready' })
    expect(decision.leverPosition).toBe('agent_autonomous')
  })

  it('includes the lever position on every decision for auditability', () => {
    for (const pos of [
      'human_only',
      'agent_proposed_human_approved',
      'agent_proposed_coordinator_approved',
      'agent_autonomous',
    ] as const) {
      const decision = evaluateProposal({
        task: makeProposedTask(),
        levers: leverAt(pos),
      })
      expect(decision.leverPosition).toBe(pos)
      expect(decision.rationale.length).toBeGreaterThan(0)
    }
  })

  it('refuses tasks not in proposed status', () => {
    expect(() =>
      evaluateProposal({
        task: makeProposedTask({ status: 'ready' }),
        levers: leverAt('agent_autonomous'),
      }),
    ).toThrow(InvalidPromotionInputError)
  })

  it('refuses tasks not originated by an agent', () => {
    expect(() =>
      evaluateProposal({
        task: makeProposedTask({ origination: 'human' }),
        levers: leverAt('agent_autonomous'),
      }),
    ).toThrow(InvalidPromotionInputError)
  })
})
