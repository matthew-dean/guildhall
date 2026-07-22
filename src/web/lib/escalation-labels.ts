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

export type EscalationUserGuidance = {
  title: string
  detail: string
  nextStep: string
  actionOwner: 'guildhall' | 'user'
  technicalNote?: string
}

function stripInternalAcceptanceIds(text: string): string {
  return text
    .replace(/\bAC-\d+\b/gi, 'acceptance-criteria')
    .replace(/\s+/g, ' ')
    .trim()
}

type EscalationRecoveryCode =
  | 'worker_turn_limit'
  | 'worker_timeout_likely_target'
  | 'worker_timeout_no_progress'
  | 'spec_no_progress'
  | 'worker_no_progress'
  | 'self_authored_verification'
  | 'stale_gate_failure'

type EscalationHandling = 'owner_required' | 'guildhall_recovery' | 'external_dependency'

type EscalationDisplayInput = {
  summary?: string | undefined
  details?: string | undefined
  agentId?: string | undefined
  reason?: string | undefined
  recoveryCode?: EscalationRecoveryCode | string | undefined
  handling?: EscalationHandling | string | undefined
}

function isWorkerRecoveryCode(code: string | undefined): boolean {
  return code === 'worker_turn_limit' ||
    code === 'worker_timeout_likely_target' ||
    code === 'worker_timeout_no_progress' ||
    code === 'worker_no_progress'
}

export function escalationUserGuidance(
  escalation: EscalationDisplayInput | undefined | null,
): EscalationUserGuidance {
  const details = escalation?.details ?? ''
  if (escalation?.recoveryCode === 'self_authored_verification') {
    return {
      title: 'One missing check needs to run.',
      detail: 'This is not asking you to prove anything. The task needs a saved verification result before it can be marked finished.',
      nextStep: 'Use the recovery action on this card. The task will resume, run or refresh the relevant tests, save the result, and continue. Only add the result yourself if you already ran the check outside the app.',
      actionOwner: 'guildhall',
    }
  }

  if (escalation?.handling === 'external_dependency') {
    return {
      title: 'The project build is failing outside this task.',
      detail: 'The task was verified, but the failure appears to come from nearby workspace code rather than the focused files for this work.',
      nextStep: 'Decide how to handle that mismatch: use Reframe task if the task itself is unclear, fix the unrelated build first if it is real project debt, or retry gates after the build issue is addressed.',
      actionOwner: 'user',
    }
  }

  if (escalation?.reason === 'gate_hard_failure') {
    return {
      title: 'Gate checks can be retried.',
      detail: 'The task is waiting on automated verification. If the underlying issue has been addressed, this blocker can be closed and the gates can run again.',
      nextStep: 'Use Retry gates to close this blocker and run the gate-check step again.',
      actionOwner: 'guildhall',
    }
  }

  if (escalation?.agentId === 'worker-agent' && isWorkerRecoveryCode(escalation.recoveryCode)) {
    return {
      title: 'Worker execution can be retried.',
      detail: 'The last worker attempt stalled before it finished useful work. This is an automatic recovery step, not something you need to solve by hand.',
      nextStep: 'Use Retry worker to close this blocker and try again. Use Reframe task only if the task itself is wrong, too broad, or unclear.',
      actionOwner: 'guildhall',
    }
  }

  if (escalation?.agentId === 'spec-agent' && escalation.recoveryCode === 'spec_no_progress') {
    return {
      title: 'Spec shaping can be retried.',
      detail: 'The spec lane stalled before saving the next useful draft. This is not a project decision you need to solve by hand.',
      nextStep: 'Use Retry spec to close this blocker and shape the task again from the transcript. Use Reframe task if the task is too broad or pointed at the wrong work.',
      actionOwner: 'guildhall',
    }
  }

  const recovery = escalationRecoveryCopy(escalation)
  return {
    title: recovery.headline,
    detail: recovery.detail,
    nextStep: 'Choose the action that matches what you know: resume if the task can continue, rework the spec if the brief is unclear, or mark it resolved only if you already handled the blocker outside the app.',
    actionOwner: 'user',
    technicalNote: details ? stripInternalAcceptanceIds(details) : undefined,
  }
}

export function escalationRecoveryCopy(
  escalation: EscalationDisplayInput | undefined | null,
): EscalationRecoveryCopy {
  if (escalation?.recoveryCode === 'worker_no_progress' ||
      escalation?.recoveryCode === 'spec_no_progress') {
    return {
      headline: 'Context was found, but the next draft was not saved.',
      detail: 'The transcript may contain useful observations. Retry from those notes or resolve the blocker after reviewing them.',
    }
  }
  if (escalation?.agentId === 'spec-agent' && escalation.recoveryCode === 'spec_no_progress') {
    return {
      headline: 'Spec shaping stopped before saving the next draft.',
      detail: 'Retry from the transcript notes, or reframe the task if the request is too broad.',
    }
  }
  const role = roleLabel(escalation?.agentId)
  return {
    headline: escalation?.summary ?? 'This task needs attention.',
    detail: role === 'Unknown'
      ? 'Review the blocker and choose the next step.'
      : `${role} needs a recovery decision before this task can continue.`,
  }
}

export function escalationPrimaryAction(
  escalation: EscalationDisplayInput | undefined | null,
): EscalationAction {
  const reason = escalation?.reason ?? ''
  const agentId = escalation?.agentId ?? ''
  if (escalation?.recoveryCode === 'self_authored_verification') {
    return {
      label: 'Run the missing check',
      nextStatus: 'ready',
      resolution: 'Resume the task so the missing verification check can run, save the result, and continue.',
    }
  }
  if (reason === 'gate_hard_failure') {
    return {
      label: 'Retry gates',
      nextStatus: 'gate_check',
      resolution: 'Retrying gates after addressing the failure.',
    }
  }
  if (agentId === 'worker-agent' && isWorkerRecoveryCode(escalation?.recoveryCode)) {
    return {
      label: 'Retry worker',
      nextStatus: 'in_progress',
      resolution: 'Retry the worker with the current task brief and continue from the last attempt.',
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
