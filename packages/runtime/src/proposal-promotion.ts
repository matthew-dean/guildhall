/**
 * FR-21: Agent-originated task proposal promotion.
 *
 * When an agent creates a task in status `proposed`, the orchestrator (or a
 * coordinator during its tick) calls `evaluateProposal` to decide what
 * happens next, based on the `task_origination` lever for the task's domain.
 *
 * This module is pure — no I/O. It returns a decision; the caller applies
 * the resulting state transition and writes to TASKS.json / DECISIONS.md.
 */

import type { Task } from '@guildhall/core'
import type { DomainLevers } from '@guildhall/levers'

export type PromotionAction =
  /** Reject the proposal outright; move to `shelved` with a rejection reason. */
  | { kind: 'reject'; reason: string }
  /** Route to the human — move to `spec_review` for the user to approve. */
  | { kind: 'route_to_human'; targetStatus: 'spec_review' }
  /** Route to the owning coordinator — coordinator decides ready vs shelved. */
  | { kind: 'route_to_coordinator'; targetStatus: 'spec_review' }
  /** Auto-promote straight to `ready`. */
  | { kind: 'auto_promote'; targetStatus: 'ready' }

export interface PromotionDecision {
  action: PromotionAction
  rationale: string
  leverPosition: DomainLevers['task_origination']['position']
}

export interface EvaluateProposalInput {
  task: Pick<Task, 'id' | 'status' | 'origination' | 'proposedBy'>
  /** Domain-resolved levers (use `resolveDomainLevers` from @guildhall/levers). */
  levers: Pick<DomainLevers, 'task_origination'>
}

export class InvalidPromotionInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidPromotionInputError'
  }
}

export function evaluateProposal(input: EvaluateProposalInput): PromotionDecision {
  if (input.task.status !== 'proposed') {
    throw new InvalidPromotionInputError(
      `evaluateProposal only applies to tasks in status 'proposed'; got '${input.task.status}' for task ${input.task.id}`,
    )
  }
  if (input.task.origination !== 'agent') {
    throw new InvalidPromotionInputError(
      `evaluateProposal expects origination='agent'; got '${input.task.origination}' for task ${input.task.id}`,
    )
  }

  const position = input.levers.task_origination.position
  switch (position) {
    case 'human_only':
      return {
        action: {
          kind: 'reject',
          reason:
            'Lever task_origination=human_only: agents may not propose tasks in this domain. Route the request through the Spec Agent intake (FR-12) instead.',
        },
        rationale: 'human_only forbids agent-originated tasks',
        leverPosition: position,
      }
    case 'agent_proposed_human_approved':
      return {
        action: { kind: 'route_to_human', targetStatus: 'spec_review' },
        rationale: 'agent_proposed_human_approved routes proposals to human review via spec_review',
        leverPosition: position,
      }
    case 'agent_proposed_coordinator_approved':
      return {
        action: { kind: 'route_to_coordinator', targetStatus: 'spec_review' },
        rationale:
          'agent_proposed_coordinator_approved hands the proposal to the owning coordinator (expressed as a spec_review held by the coordinator, not the human)',
        leverPosition: position,
      }
    case 'agent_autonomous':
      return {
        action: { kind: 'auto_promote', targetStatus: 'ready' },
        rationale: 'agent_autonomous promotes proposals directly to ready',
        leverPosition: position,
      }
    default: {
      // TypeScript exhaustiveness — if a new position is added to the schema
      // without handling here, this line surfaces it at compile time.
      const _exhaustive: never = position
      throw new InvalidPromotionInputError(
        `Unhandled task_origination position: ${String(_exhaustive)}`,
      )
    }
  }
}
