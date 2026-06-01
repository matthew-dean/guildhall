import { describe, expect, it } from 'vitest'
import {
  applyTransitionCommand,
  defineStateMachine,
  transition,
  transitionTable,
} from '../state-machine.js'

type DemoState = 'draft' | 'submitted' | 'approved' | 'closed'
type DemoEvent = 'submit' | 'approve' | 'close'

interface DemoContext {
  title?: string
  approvedBy?: string
  allowApproval?: boolean
}

const demoMachine = defineStateMachine<DemoState, DemoEvent, DemoContext>({
  id: 'demo',
  version: 1,
  initial: 'draft',
  terminal: ['approved', 'closed'],
  states: {
    draft: {
      on: {
        submit: { to: 'submitted', require: ['title'] },
        close: { to: 'closed' },
      },
    },
    submitted: {
      on: {
        approve: {
          to: 'approved',
          require: ['approvedBy'],
          guard: context => context.allowApproval
            ? { ok: true }
            : { ok: false, reason: 'approval_not_allowed' },
        },
        close: { to: 'closed' },
      },
    },
    approved: { on: {} },
    closed: { on: {} },
  },
})

describe('state machine primitive', () => {
  it('applies a legal transition and records an append-only receipt shape', () => {
    const result = transition(demoMachine, {
      entityId: 'entity-1',
      currentState: 'draft',
      event: 'submit',
      context: { title: 'Shape project graph' },
      actor: 'coordinator:consumer',
      evidenceRefs: ['request:req-1'],
      now: '2026-06-01T10:00:00.000Z',
    })

    expect(result).toEqual({
      kind: 'applied',
      nextState: 'submitted',
      receipt: {
        machineId: 'demo',
        machineVersion: 1,
        entityId: 'entity-1',
        from: 'draft',
        event: 'submit',
        to: 'submitted',
        actor: 'coordinator:consumer',
        evidenceRefs: ['request:req-1'],
        createdAt: '2026-06-01T10:00:00.000Z',
      },
    })
  })

  it('rejects missing required context without changing state', () => {
    const result = transition(demoMachine, {
      entityId: 'entity-1',
      currentState: 'draft',
      event: 'submit',
      context: {},
      actor: 'coordinator:consumer',
      evidenceRefs: [],
      now: '2026-06-01T10:00:00.000Z',
    })

    expect(result).toEqual({
      kind: 'rejected',
      currentState: 'draft',
      reason: 'missing_required_context',
      missing: ['title'],
    })
  })

  it('rejects events not allowed from the current state', () => {
    const result = transition(demoMachine, {
      entityId: 'entity-1',
      currentState: 'draft',
      event: 'approve',
      context: { approvedBy: 'human', allowApproval: true },
      actor: 'coordinator:provider',
      evidenceRefs: [],
      now: '2026-06-01T10:00:00.000Z',
    })

    expect(result).toEqual({
      kind: 'rejected',
      currentState: 'draft',
      reason: 'event_not_allowed',
    })
  })

  it('rejects outgoing transitions from terminal states', () => {
    const result = transition(demoMachine, {
      entityId: 'entity-1',
      currentState: 'approved',
      event: 'close',
      context: {},
      actor: 'coordinator:provider',
      evidenceRefs: [],
      now: '2026-06-01T10:00:00.000Z',
    })

    expect(result).toEqual({
      kind: 'rejected',
      currentState: 'approved',
      reason: 'terminal_state',
    })
  })

  it('uses pure guards for deterministic domain-specific rejection', () => {
    const result = transition(demoMachine, {
      entityId: 'entity-1',
      currentState: 'submitted',
      event: 'approve',
      context: { approvedBy: 'human', allowApproval: false },
      actor: 'coordinator:provider',
      evidenceRefs: ['review:req-1'],
      now: '2026-06-01T10:00:00.000Z',
    })

    expect(result).toEqual({
      kind: 'rejected',
      currentState: 'submitted',
      reason: 'approval_not_allowed',
    })
  })

  it('exposes the legal transition table without pseudo-state results', () => {
    expect(transitionTable(demoMachine)).toEqual([
      { from: 'draft', event: 'close', to: 'closed' },
      { from: 'draft', event: 'submit', to: 'submitted' },
      { from: 'submitted', event: 'approve', to: 'approved' },
      { from: 'submitted', event: 'close', to: 'closed' },
    ])
  })

  it('rejects invalid machine definitions at definition time', () => {
    expect(() => defineStateMachine({
      id: 'broken',
      version: 1,
      initial: 'missing',
      terminal: ['closed'],
      states: {
        draft: { on: { close: { to: 'closed' } } },
        closed: { on: {} },
      },
    } as any)).toThrow(/initial state "missing" is not defined/)

    expect(() => defineStateMachine({
      id: 'broken',
      version: 1,
      initial: 'draft',
      terminal: ['closed'],
      states: {
        draft: { on: { close: { to: 'missing' } } },
        closed: { on: {} },
      },
    } as any)).toThrow(/transition "draft" --close--> "missing" points to an unknown state/)
  })

  it('keeps idempotency replay in command handling, not pure transition results', () => {
    const first = applyTransitionCommand(demoMachine, {
      commandId: 'cmd-1',
      priorReceipts: [],
      transition: {
        entityId: 'entity-1',
        currentState: 'draft',
        event: 'submit',
        context: { title: 'Shape project graph' },
        actor: 'coordinator:consumer',
        evidenceRefs: ['request:req-1'],
        now: '2026-06-01T10:00:00.000Z',
      },
    })

    expect(first.kind).toBe('applied')
    if (first.kind !== 'applied') throw new Error('expected applied command')

    const replay = applyTransitionCommand(demoMachine, {
      commandId: 'cmd-1',
      priorReceipts: [first.receipt],
      transition: {
        entityId: 'entity-1',
        currentState: 'draft',
        event: 'submit',
        context: { title: 'Shape project graph' },
        actor: 'coordinator:consumer',
        evidenceRefs: ['request:req-1'],
        now: '2026-06-01T10:00:01.000Z',
      },
    })

    expect(replay).toEqual({
      kind: 'already_applied',
      receipt: first.receipt,
      currentState: 'submitted',
    })
  })
})
