/**
 * Display-string maps for escalation enums. Keeps backend schema codes out
 * of the UI.
 *
 * Source of truth for the enum values is src/core/task.ts:EscalationReason.
 * Keep in sync.
 */
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
  return REASON_LABEL[code as EscalationReasonCode] ?? code
}

/**
 * Agent-id → role display name. Matches the worker/reviewer/spec/gate-checker
 * roles wired into the orchestrator. Unknown ids pass through unchanged.
 */
const ROLE_LABEL: Record<string, string> = {
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
  return ROLE_LABEL[agentId] ?? agentId
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
  return {
    label: 'Resume task',
    nextStatus: 'ready',
    resolution: 'Resolved by human; continue from the coordinator.',
  }
}
