import type { BackendEvent } from '@guildhall/backend-host'
import type { AgentIssue } from '@guildhall/core'

import type { TickOutcome } from './tick-outcome.js'

/**
 * FR-16: map an orchestrator TickOutcome to an OHJSON backend event.
 *
 * Returns null for outcomes that don't have a user-visible lifecycle event
 * (idle ticks). `processed` with no status change is also treated as a
 * no-op — the UI already sees the underlying engine stream events from the
 * agent turn itself, so emitting a redundant "still in_progress" transition
 * would just be noise.
 */
export function tickOutcomeToBackendEvent(outcome: TickOutcome): BackendEvent | null {
  switch (outcome.kind) {
    case 'idle':
      return null

    case 'processed':
      if (!outcome.transitioned) return null
      return {
        type: 'task_transition',
        task_id: outcome.taskId,
        from_status: outcome.beforeStatus,
        to_status: outcome.afterStatus,
        agent_name: outcome.agent,
        revision_count: outcome.revisionCount,
        transitioned: true,
      }

    case 'escalated':
      return {
        type: 'escalation_raised',
        task_id: outcome.taskId,
        agent_name: outcome.agent,
        reason: outcome.reason,
        escalation_id: outcome.escalationId,
      }

    case 'blocked-max-revisions':
      return {
        type: 'escalation_raised',
        task_id: outcome.taskId,
        reason: 'max_revisions_exceeded',
        revision_count: outcome.revisionCount,
      }

    case 'no-coordinator':
      return {
        type: 'error',
        message: `No coordinator for domain "${outcome.domain}" — task ${outcome.taskId} skipped.`,
        task_id: outcome.taskId,
      }

    case 'agent-error':
      return {
        type: 'error',
        message: `Agent ${outcome.agent} failed on ${outcome.taskId}: ${outcome.error}`,
        task_id: outcome.taskId,
        agent_name: outcome.agent,
      }

    case 'proposal-decided':
      // FR-21: promotions present as a task_transition so subscribers already
      // rendering transitions pick them up without a schema extension. The
      // decision kind + lever position ride in the reason field for audit.
      return {
        type: 'task_transition',
        task_id: outcome.taskId,
        from_status: 'proposed',
        to_status: outcome.newStatus,
        agent_name: 'proposal-promoter',
        transitioned: true,
        reason: `${outcome.actionKind} (lever=${String(outcome.leverPosition)})`,
      }

    case 'pre-rejection-applied':
      // FR-22: `keep_shelved` is a no-op lifecycle-wise (stays shelved). We
      // only surface a task_transition when the task is actually resurrected
      // so subscribers don't see spurious "shelved → shelved" events.
      if (outcome.actionKind === 'keep_shelved') return null
      return {
        type: 'task_transition',
        task_id: outcome.taskId,
        from_status: 'shelved',
        to_status: outcome.newStatus,
        agent_name: 'pre-rejection-policy',
        transitioned: true,
        reason:
          `${outcome.actionKind} (pre_rejection_policy=${String(outcome.domainLeverPosition)}, ` +
          `requeueCount=${outcome.requeueCount})`,
      }

    case 'batch':
      // FR-24: fanout outcomes are flattened in the run-loop before reaching
      // this mapper. A raw batch here means a caller passed us the envelope
      // itself — return null rather than emit a synthetic event.
      return null
  }
}

/**
 * FR-31: map an `AgentIssue` to an OHJSON `agent_issue` backend event. Unlike
 * TickOutcomes, issue broadcasts are a separate channel the orchestrator
 * emits alongside (not instead of) its main tick outcome each cycle — the
 * task stays on its current status so there is no lifecycle transition to
 * ride on. Subscribers observe issues via this event type and render them in
 * a sidebar / inbox; FR-32's remediation loop also consumes them.
 */
export function agentIssueToBackendEvent(issue: AgentIssue): BackendEvent {
  return {
    type: 'agent_issue',
    task_id: issue.taskId,
    agent_name: issue.agentId,
    issue_id: issue.id,
    code: issue.code,
    severity: issue.severity,
    reason: issue.detail,
  }
}
