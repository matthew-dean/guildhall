import {
  applyTransitionCommand,
  defineStateMachine,
  type TransitionCommandResult,
  type TransitionReceipt,
} from './state-machine.js'

export type BoundedChatMachineStatus =
  | 'active'
  | 'waiting_for_owner'
  | 'coordinator_review'
  | 'fulfilled'
  | 'blocked'
  | 'cancelled'

export type BoundedChatMachineEvent =
  | 'activate'
  | 'wait_for_owner'
  | 'submit_owner_response'
  | 'request_coordinator_review'
  | 'fulfill'
  | 'block'
  | 'cancel'

export interface BoundedChatTransitionContext {
  activeSubObjectiveId?: string | null
  ownerResponsePresent?: boolean
  closureSummary?: string | null
}

export type BoundedChatTransitionReceipt = TransitionReceipt<
  BoundedChatMachineStatus,
  BoundedChatMachineEvent
>

export const boundedChatMachine = defineStateMachine<
  BoundedChatMachineStatus,
  BoundedChatMachineEvent,
  BoundedChatTransitionContext
>({
  id: 'bounded-chat',
  version: 1,
  initial: 'active',
  terminal: ['fulfilled', 'blocked', 'cancelled'],
  states: {
    active: {
      on: {
        activate: { to: 'active' },
        wait_for_owner: { to: 'waiting_for_owner', require: ['activeSubObjectiveId'] },
        request_coordinator_review: { to: 'coordinator_review', require: ['activeSubObjectiveId'] },
        fulfill: { to: 'fulfilled', require: ['closureSummary'] },
        block: { to: 'blocked', require: ['closureSummary'] },
        cancel: { to: 'cancelled' },
      },
    },
    waiting_for_owner: {
      on: {
        submit_owner_response: {
          to: 'coordinator_review',
          require: ['activeSubObjectiveId', 'ownerResponsePresent'],
        },
        cancel: { to: 'cancelled' },
      },
    },
    coordinator_review: {
      on: {
        wait_for_owner: { to: 'waiting_for_owner', require: ['activeSubObjectiveId'] },
        request_coordinator_review: { to: 'coordinator_review', require: ['activeSubObjectiveId'] },
        fulfill: { to: 'fulfilled', require: ['closureSummary'] },
        block: { to: 'blocked', require: ['closureSummary'] },
        cancel: { to: 'cancelled' },
      },
    },
    fulfilled: { on: {} },
    blocked: { on: {} },
    cancelled: { on: {} },
  },
})

export interface ApplyBoundedChatTransitionInput {
  sessionId: string
  currentStatus: BoundedChatMachineStatus
  event: BoundedChatMachineEvent
  commandId: string
  priorReceipts: BoundedChatTransitionReceipt[]
  actor: string
  evidenceRefs: string[]
  now: string
  context: BoundedChatTransitionContext
}

export function applyBoundedChatTransition(
  input: ApplyBoundedChatTransitionInput,
): TransitionCommandResult<BoundedChatMachineStatus, BoundedChatMachineEvent> {
  return applyTransitionCommand(boundedChatMachine, {
    commandId: input.commandId,
    priorReceipts: input.priorReceipts,
    transition: {
      entityId: input.sessionId,
      currentState: input.currentStatus,
      event: input.event,
      actor: input.actor,
      evidenceRefs: input.evidenceRefs,
      now: input.now,
      context: input.context,
    },
  })
}
