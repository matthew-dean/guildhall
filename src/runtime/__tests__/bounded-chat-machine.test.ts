import { describe, expect, it } from 'vitest'
import { applyBoundedChatTransition, boundedChatMachine } from '../bounded-chat-machine.js'
import { transitionTable } from '../state-machine.js'

const now = '2026-06-01T12:00:00.000Z'

describe('bounded chat state machine', () => {
  it('documents the allowed lifecycle table', () => {
    expect(transitionTable(boundedChatMachine)).toContainEqual({
      from: 'waiting_for_owner',
      event: 'submit_owner_response',
      to: 'coordinator_review',
    })
    expect(transitionTable(boundedChatMachine)).toContainEqual({
      from: 'coordinator_review',
      event: 'wait_for_owner',
      to: 'waiting_for_owner',
    })
  })

  it('applies transitions with receipts and rejects illegal transitions', () => {
    const applied = applyBoundedChatTransition({
      sessionId: 'chat-1',
      currentStatus: 'waiting_for_owner',
      event: 'submit_owner_response',
      commandId: 'response-1',
      priorReceipts: [],
      actor: 'owner',
      evidenceRefs: ['response:1'],
      now,
      context: { activeSubObjectiveId: 'q1', ownerResponsePresent: true },
    })

    expect(applied.kind).toBe('applied')
    if (applied.kind !== 'applied') throw new Error('expected applied')
    expect(applied.nextState).toBe('coordinator_review')
    expect(applied.receipt).toMatchObject({
      machineId: 'bounded-chat',
      entityId: 'chat-1',
      commandId: 'response-1',
      from: 'waiting_for_owner',
      event: 'submit_owner_response',
      to: 'coordinator_review',
    })

    const rejected = applyBoundedChatTransition({
      sessionId: 'chat-1',
      currentStatus: 'fulfilled',
      event: 'submit_owner_response',
      commandId: 'response-2',
      priorReceipts: [],
      actor: 'owner',
      evidenceRefs: [],
      now,
      context: { activeSubObjectiveId: 'q1', ownerResponsePresent: true },
    })
    expect(rejected).toMatchObject({ kind: 'rejected', reason: 'terminal_state' })
  })

  it('returns already_applied for repeated command ids', () => {
    const first = applyBoundedChatTransition({
      sessionId: 'chat-1',
      currentStatus: 'waiting_for_owner',
      event: 'submit_owner_response',
      commandId: 'response-1',
      priorReceipts: [],
      actor: 'owner',
      evidenceRefs: [],
      now,
      context: { activeSubObjectiveId: 'q1', ownerResponsePresent: true },
    })
    if (first.kind !== 'applied') throw new Error('expected first transition to apply')

    const second = applyBoundedChatTransition({
      sessionId: 'chat-1',
      currentStatus: 'coordinator_review',
      event: 'submit_owner_response',
      commandId: 'response-1',
      priorReceipts: [first.receipt],
      actor: 'owner',
      evidenceRefs: [],
      now,
      context: { activeSubObjectiveId: 'q1', ownerResponsePresent: true },
    })

    expect(second).toMatchObject({
      kind: 'already_applied',
      currentState: 'coordinator_review',
      receipt: first.receipt,
    })
  })
})
