import {
  defineStateMachine,
  transition,
  type TransitionReceipt,
} from './state-machine.js'

export type ContractSurfaceState =
  | 'draft'
  | 'proposed'
  | 'accepted'
  | 'amended'
  | 'clarification_requested'
  | 'rejected'
  | 'deprecated'
  | 'superseded'

export type ContractSurfaceEvent =
  | 'propose_surface'
  | 'request_clarification'
  | 'accept_surface'
  | 'reject_surface'
  | 'propose_delta'
  | 'accept_delta'
  | 'reject_delta'
  | 'amend_invariant'
  | 'deprecate_surface'
  | 'supersede_surface'

export type ContractSurfaceTransitionReceipt = TransitionReceipt<ContractSurfaceState, ContractSurfaceEvent>

export interface ContractSurfaceTransitionContext {
  owningProjectId?: string
  domainId?: string
  consumerCount: number
  touchedSpecRef?: string
  evidenceRefs: readonly string[]
  consumerImpactNote?: string
  authorityDecisionRef?: string
}

export const contractSurfaceMachine = defineStateMachine<
  ContractSurfaceState,
  ContractSurfaceEvent,
  ContractSurfaceTransitionContext
>({
  id: 'contract-surface',
  version: 1,
  initial: 'draft',
  terminal: ['rejected', 'superseded'],
  states: {
    draft: {
      on: {
        propose_surface: { to: 'proposed', require: ['owningProjectId'] },
        reject_surface: { to: 'rejected' },
      },
    },
    proposed: {
      on: {
        request_clarification: { to: 'clarification_requested' },
        accept_surface: {
          to: 'accepted',
          guard: context => context.owningProjectId || context.domainId
            ? { ok: true }
            : { ok: false, reason: 'missing_surface_owner', missing: ['owningProjectId'] },
        },
        reject_surface: { to: 'rejected' },
      },
    },
    clarification_requested: {
      on: {
        propose_surface: { to: 'proposed', require: ['owningProjectId'] },
        reject_surface: { to: 'rejected' },
      },
    },
    accepted: {
      on: {
        propose_delta: { to: 'amended', require: ['touchedSpecRef'] },
        amend_invariant: { to: 'amended', require: ['touchedSpecRef'] },
        deprecate_surface: {
          to: 'deprecated',
          guard: migrationOrNoConsumerImpact,
        },
        supersede_surface: {
          to: 'superseded',
          guard: migrationOrNoConsumerImpact,
        },
      },
    },
    amended: {
      on: {
        accept_delta: {
          to: 'accepted',
          require: ['touchedSpecRef'],
          guard: context => context.evidenceRefs.length > 0
            ? { ok: true }
            : { ok: false, reason: 'missing_required_context', missing: ['evidenceRefs'] },
        },
        reject_delta: {
          to: 'accepted',
          require: ['touchedSpecRef'],
        },
        request_clarification: { to: 'clarification_requested' },
      },
    },
    deprecated: {
      on: {
        supersede_surface: {
          to: 'superseded',
          guard: migrationOrNoConsumerImpact,
        },
      },
    },
    rejected: { on: {} },
    superseded: { on: {} },
  },
})

export function transitionContractSurface(input: {
  entityId: string
  currentState: ContractSurfaceState
  event: ContractSurfaceEvent
  context: ContractSurfaceTransitionContext
  actor: string
  evidenceRefs: string[]
  now: string
}) {
  return transition(contractSurfaceMachine, input)
}

function migrationOrNoConsumerImpact(context: ContractSurfaceTransitionContext) {
  if (context.consumerCount === 0 || context.consumerImpactNote || context.authorityDecisionRef) return { ok: true as const }
  return {
    ok: false as const,
    reason: 'missing_consumer_impact_note',
    missing: ['consumerImpactNote'],
  }
}
