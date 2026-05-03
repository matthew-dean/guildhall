import type { TaskStatus } from '@guildhall/core'
import type { DomainLevers, ProjectLevers } from '@guildhall/levers'

import type { PromotionAction } from './proposal-promotion.js'
import type { PreRejectionAction } from './pre-rejection-policy.js'

/**
 * The result of a single `Orchestrator.tick()` call.
 *
 * Lives in its own file so `wire-events.ts` can depend on it without
 * creating a cycle with `orchestrator.ts` (which carries the large
 * `Orchestrator` class and would otherwise drag the whole graph through
 * the type import).
 */
export type TickOutcome =
  | {
      kind: 'idle'
      consecutiveIdleTicks: number
      allDone: boolean
      summary?: {
        reason:
          | 'all_terminal'
          | 'awaiting_human'
          | 'blocked_only'
          | 'dependency_blocked'
          | 'no_eligible_tasks'
        message: string
        counts: {
          total: number
          actionable: number
          terminal: number
          done: number
          blocked: number
          shelved: number
          waitingOnUser: number
          awaitingApproval: number
          dependencyBlocked: number
          escalated: number
          active: number
          fresh: number
        }
      }
    }
  | {
      kind: 'processed'
      taskId: string
      agent: string
      beforeStatus: TaskStatus
      afterStatus: TaskStatus
      transitioned: boolean
      revisionCount: number
      waitingOnUser?: boolean
    }
  | { kind: 'blocked-max-revisions'; taskId: string; revisionCount: number }
  | { kind: 'no-coordinator'; taskId: string; domain: string }
  | { kind: 'agent-error'; taskId: string; agent: string; error: string }
  /** FR-10: an agent raised an escalation — task is halted until resolved. */
  | {
      kind: 'escalated'
      taskId: string
      agent: string
      reason: string
      escalationId: string
    }
  /**
   * FR-21: an agent-proposed task was evaluated against the `task_origination`
   * lever and moved to `ready` / `spec_review` / `shelved` accordingly. No LLM
   * invocation — the orchestrator applies a pure policy decision.
   */
  | {
      kind: 'proposal-decided'
      taskId: string
      actionKind: PromotionAction['kind']
      leverPosition: DomainLevers['task_origination']['position']
      newStatus: TaskStatus
    }
  /**
   * FR-22: a worker-shelved task was evaluated against `pre_rejection_policy`
   * and either kept shelved (terminal) or resurrected to `ready` with a
   * possibly-lowered priority. Like `proposal-decided`, no LLM is invoked.
   */
  | {
      kind: 'pre-rejection-applied'
      taskId: string
      actionKind: PreRejectionAction['kind']
      domainLeverPosition: DomainLevers['pre_rejection_policy']['position']
      projectLeverPosition: ProjectLevers['rejection_dampening']['position']
      newStatus: TaskStatus
      requeueCount: number
    }
  /**
   * FR-24: `concurrent_task_dispatch: fanout_N` ran multiple tasks in one
   * tick. Each sub-outcome is a regular `TickOutcome` (never another batch).
   * The serve layer fans these out to its SSE stream as if they were emitted
   * one-per-tick.
   */
  | { kind: 'batch'; outcomes: TickOutcome[] }
  /**
   * Structural-reliability halt: the project's `bootstrap` block is either
   * missing (`bootstrap_required`) or failed (`bootstrap_failed`). The
   * orchestrator refuses to dispatch any task until the human runs bootstrap
   * from the Ready page (POST /api/project/bootstrap/run).
   */
  | { kind: 'bootstrap-required'; reason: 'bootstrap_required' | 'bootstrap_failed'; pendingTaskCount: number }
