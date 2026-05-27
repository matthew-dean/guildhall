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

function inferEvidenceArea(text: string): string {
  if (/\bauth|email confirmation|profile management|login|signup\b/i.test(text)) return 'auth'
  if (/\bcss|style|visual|layout\b/i.test(text)) return 'UI'
  if (/\bapi|endpoint|request|response\b/i.test(text)) return 'API'
  return 'this task'
}

function hasInternalRecoveryLanguage(text: string): boolean {
  return /authoritative|checkpoint-touched|worktree|AC-\d+|handoff packet|coordinator scoped|bounded repair|policy read|human_judgment_required|spec_ambiguous|gate_hard_failure/i.test(text)
}

export function escalationUserGuidance(
  escalation: {
    summary?: string | undefined
    details?: string | undefined
    agentId?: string | undefined
    reason?: string | undefined
  } | undefined | null,
): EscalationUserGuidance {
  const summary = escalation?.summary ?? ''
  const details = escalation?.details ?? ''
  const text = `${summary}\n${details}`
  if (/\bAC-\d+\b/i.test(text) && /\bevidence\b/i.test(text)) {
    const area = inferEvidenceArea(text)
    return {
      title: 'Guildhall needs to run one missing check.',
      detail: `This is not asking you to prove anything. The ${area} task needs a saved frontend test result before Guildhall can mark it finished.`,
      nextStep: 'Use the Guildhall action on this card. Guildhall will resume the task, run or refresh the relevant tests, save the result, and continue. Only add the result yourself if you already ran the check outside Guildhall.',
      actionOwner: 'guildhall',
    }
  }

  if (/authoritative verification|upstream workspace build failure|checkpoint-touched|task worktree/i.test(text)) {
    return {
      title: 'The project build is failing outside this task.',
      detail: 'Guildhall tried to verify the task, but the failure appears to come from nearby workspace code rather than the focused files for this work.',
      nextStep: 'Decide how to handle that mismatch: use Reframe task if the task itself is unclear, fix the unrelated build first if it is real project debt, or retry gates after the build issue is addressed.',
      actionOwner: 'user',
    }
  }

  if (
    escalation?.agentId === 'worker-agent' &&
    /timed out|turn limit|maximum turn|no visible progress|model provider|provider unavailable|local model/i.test(text)
  ) {
    return {
      title: 'Guildhall can retry the worker.',
      detail: 'The last worker attempt stalled before it finished useful work. This is a Guildhall recovery step, not something you need to solve by hand.',
      nextStep: 'Use Retry worker to close this blocker and let Guildhall try again. Use Reframe task only if the task itself is wrong, too broad, or unclear.',
      actionOwner: 'guildhall',
    }
  }

  const recovery = escalationRecoveryCopy(escalation)
  const hasSpecificRecovery = /no visible progress|made no visible progress|no saved (?:spec|draft)|no durable (?:draft|update)/i.test(text)
  return {
    title: hasSpecificRecovery ? recovery.headline : 'This task needs a recovery decision.',
    detail: hasSpecificRecovery ? recovery.detail : recovery.headline,
    nextStep: 'Choose the action that matches what you know: resume Guildhall if it can continue, rework the spec if the brief is unclear, or mark it resolved only if you already handled the blocker outside Guildhall.',
    actionOwner: 'user',
    technicalNote: details && !hasInternalRecoveryLanguage(details) ? stripInternalAcceptanceIds(details) : undefined,
  }
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
      ? 'Review the blocker and choose the next step.'
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
  if (/\bAC-\d+\b/i.test(text) && /\bevidence\b/i.test(text)) {
    return {
      label: 'Let Guildhall run the check',
      nextStatus: 'ready',
      resolution: 'Resume the task so Guildhall can run the missing verification check, save the result, and continue.',
    }
  }
  if (reason === 'gate_hard_failure') {
    return {
      label: 'Retry gates',
      nextStatus: 'gate_check',
      resolution: 'Retrying gates after addressing the failure.',
    }
  }
  if (
    agentId === 'worker-agent' &&
    /turn limit|maximum turn|timed out|no visible progress|made no visible progress|model provider|provider unavailable|local model/i.test(text)
  ) {
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
