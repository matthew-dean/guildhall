import {
  defineStateMachine,
  transition,
  type TransitionReceipt,
} from './state-machine.js'
import type {
  CapabilityRequest,
  CapabilityRequestStatus,
  CapabilityRequestTransitionEvent,
} from './capability-request-types.js'

export type CapabilityRequestEvent = CapabilityRequestTransitionEvent
export type CapabilityRequestTransitionReceipt = TransitionReceipt<CapabilityRequestStatus, CapabilityRequestEvent> & {
  machineId: 'capability-request'
}

export const capabilityRequestMachine = defineStateMachine<CapabilityRequestStatus, CapabilityRequestEvent, CapabilityRequest>({
  id: 'capability-request',
  version: 1,
  initial: 'pending',
  terminal: ['denied', 'revoked'],
  states: {
    pending: {
      on: {
        approve: { to: 'approved' },
        deny: { to: 'denied' },
        block: { to: 'blocked' },
      },
    },
    blocked: {
      on: {
        approve: { to: 'approved' },
        deny: { to: 'denied' },
      },
    },
    approved: {
      on: {
        revoke: { to: 'revoked' },
      },
    },
    denied: { on: {} },
    revoked: { on: {} },
  },
})

export function applyCapabilityRequestTransition(input: {
  request: CapabilityRequest
  event: CapabilityRequestEvent
  actor: string
  evidenceRefs?: string[]
  now: string
}): CapabilityRequestTransitionReceipt {
  const result = transition(capabilityRequestMachine, {
    entityId: input.request.id,
    currentState: input.request.status,
    event: input.event,
    context: input.request,
    actor: input.actor,
    evidenceRefs: input.evidenceRefs ?? [],
    now: input.now,
  })
  if (result.kind === 'rejected') {
    throw new Error(`Capability request ${input.request.id} cannot ${input.event} from ${input.request.status}: ${result.reason}`)
  }
  return {
    ...result.receipt,
    machineId: 'capability-request',
  }
}
