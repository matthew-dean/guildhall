/**
 * Display-string maps for escalation enums. Keeps backend schema codes out
 * of the UI.
 *
 * Source of truth for the enum values is src/core/task.ts:EscalationReason.
 * Keep in sync.
 */
import { labelForIdentifier } from './identifier-labels.js'

export type EscalationReasonCode =
  | 'spec_ambiguous'
  | 'max_revisions_exceeded'
  | 'human_judgment_required'
  | 'decision_required'
  | 'gate_hard_failure'
  | 'scope_boundary'

const REASON_LABEL: Record<EscalationReasonCode, string> = {
  spec_ambiguous: 'Spec unclear',
  max_revisions_exceeded: 'Too many revisions',
  human_judgment_required: 'Needs human call',
  decision_required: 'Decision needed',
  gate_hard_failure: 'Gate failed',
  scope_boundary: 'Out of scope',
}

export function escalationReasonLabel(code: string | undefined | null): string {
  if (!code) return 'Unknown'
  return REASON_LABEL[code as EscalationReasonCode] ?? labelForIdentifier('status', code).label
}

/**
 * Agent-id → role display name. Matches the worker/reviewer/spec/gate-checker
 * roles wired into the orchestrator. Unknown ids pass through unchanged.
 */
const ROLE_LABEL: Record<string, string> = {
  'coordinator': 'Coordinator',
  'worker-agent': 'Worker',
  'spec-agent': 'Spec author',
  'reviewer-agent': 'Reviewer',
  'gate-checker': 'Gate checker',
  'gate-checker-agent': 'Gate checker',
  'coordinator-agent': 'Coordinator',
  human: 'Human',
}

export function roleLabel(agentId: string | undefined | null): string {
  if (!agentId) return 'Unknown'
  return ROLE_LABEL[agentId] ?? labelForIdentifier('agent', agentId).label
}

const ROLE_BLURB: Record<string, string> = {
  'worker-agent': 'Runs the implementation work on a task.',
  'spec-agent': 'Drafts the product brief and spec from the task title.',
  'reviewer-agent': 'Reviews completed work against acceptance criteria.',
  'gate-checker': 'Runs lint, typecheck, build, and test gates after the worker finishes.',
  'coordinator-agent': 'Plans sequencing across tasks and resolves conflicts.',
  human: 'You.',
}

export function roleBlurb(agentId: string | undefined | null): string {
  if (!agentId) return ''
  return ROLE_BLURB[agentId] ?? ''
}

export type EscalationAction = {
  label: string
  nextStatus: 'ready' | 'gate_check' | 'in_progress' | 'exploring' | 'spec_review' | 'review'
  resolution: string
}

export type EscalationRecoveryCopy = {
  headline: string
  detail: string
}

export function escalationRecoveryCopy(
  escalation: {
    summary?: string | undefined
    details?: string | undefined
    agentId?: string | undefined
  } | undefined | null,
): EscalationRecoveryCopy {
  const text = `${escalation?.summary ?? ''}\n${escalation?.details ?? ''}`
  if (/no visible progress|made no visible progress|no saved (?:spec|draft)|no durable (?:draft|update)/i.test(text)) {
    return {
      headline: 'Guildhall found context but did not save the next draft.',
      detail: 'The transcript may contain useful observations. Retry from those notes or resolve the blocker after reviewing them.',
    }
  }
  const role = roleLabel(escalation?.agentId)
  return {
    headline: escalation?.summary ?? 'This task needs attention.',
    detail: role === 'Unknown'
      ? 'Open the task to review the blocker and choose the next step.'
      : `${role} needs a recovery decision before this task can continue.`,
  }
}

export function escalationPrimaryAction(
  escalation: {
    reason?: string | undefined
    agentId?: string | undefined
    summary?: string | undefined
    details?: string | undefined
  } | undefined | null,
): EscalationAction {
  const reason = escalation?.reason ?? ''
  const agentId = escalation?.agentId ?? ''
  const text = `${escalation?.summary ?? ''}\n${escalation?.details ?? ''}`
  if (reason === 'gate_hard_failure') {
    return {
      label: 'Retry gates',
      nextStatus: 'gate_check',
      resolution: 'Retrying gates after addressing the failure.',
    }
  }
  if (agentId === 'worker-agent' && /turn limit|maximum turn/i.test(text)) {
    return {
      label: 'Resume worker',
      nextStatus: 'in_progress',
      resolution: 'Resume the worker with the current spec and continue from the last attempt.',
    }
  }
  if (reason === 'spec_ambiguous') {
    return {
      label: 'Rework spec',
      nextStatus: 'exploring',
      resolution: 'Reopening intake so the spec can be clarified.',
    }
  }
  if (reason === 'human_judgment_required' && agentId === 'spec-agent') {
    return {
      label: 'Retry spec from transcript',
      nextStatus: 'exploring',
      resolution: 'Retry intake from the useful transcript notes and save a durable draft before continuing.',
    }
  }
  return {
    label: 'Resume task',
    nextStatus: 'ready',
    resolution: 'Resolved by human; continue from the coordinator.',
  }
}
