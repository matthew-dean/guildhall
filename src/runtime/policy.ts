import type { AgentNote, ReviewVerdict } from '@guildhall/core'
import { reviewVerdictIsInfrastructureFailure } from './review-contract.js'

export const FAILURE_CLASSES = [
  'self_authored_verification_failure',
  'stale_context',
  'missing_target_evidence',
  'environment_unavailable',
  'provider_unavailable',
  'human_product_decision',
  'reviewer_infrastructure_noise',
  'dirty_checkout_owned',
  'dirty_checkout_external',
  'authoritative_command_unknown',
  'scope_boundary_unclear',
  'model_tool_use_failure',
  'review_packet_insufficient',
] as const

export type FailureClass = (typeof FAILURE_CLASSES)[number]

export const RECOVERY_PLAYBOOK_IDS = [
  'reread_focused_file',
  'rerun_authoritative_command',
  'repair_touched_file_failure',
  'refresh_stale_edit_target',
  'resume_from_checkpoint',
  'retry_current_task_context',
  'review_partial_diff',
  'rebootstrap_project',
  'package_owned_dirty_work',
  'ask_concrete_human_question',
  'route_to_review',
  'route_to_gate_check',
  'stop_with_external_setup_action',
] as const

export type RecoveryPlaybookId = (typeof RECOVERY_PLAYBOOK_IDS)[number]
export type PolicyConfidence = 'low' | 'medium' | 'high'
export type PolicyScope = 'task' | 'project' | 'system'

export interface EvidenceRef {
  kind: 'task' | 'verification' | 'tool_error' | 'review' | 'checkpoint'
  summary: string
  ref?: string
  links?: EvidenceLink[]
}

export interface EvidenceLink {
  kind: 'task' | 'local_history'
  label: string
  href?: string
  localHistoryRef?: string
}

export type PreferenceStrength = 'weak' | 'medium' | 'strong'
export type PreferenceRanking = 'ordered' | 'unordered'

export interface PreferenceItem {
  item: string
  strength?: PreferenceStrength
  exceptions?: string[]
}

export interface PreferenceSubject {
  domain: string
  area?: string
  item?: string
}

export interface PreferencePosition {
  prefer?: PreferenceItem[]
  avoid?: PreferenceItem[]
  ranking?: PreferenceRanking
}

export interface StructuredPreference {
  kind: 'preference'
  subject: PreferenceSubject
  position: PreferencePosition
}

export interface FailureClassification {
  class: FailureClass
  confidence: PolicyConfidence
  evidence: EvidenceRef[]
  scope: PolicyScope
  safePlaybooks: RecoveryPlaybookId[]
  needsHuman: boolean
  humanQuestion?: string
}

export interface RecoveryPlan {
  playbook: RecoveryPlaybookId
  reason: string
  allowedTools: string[]
  allowedPaths?: string[]
  command?: string
  maxTurns: number
  successSignals: string[]
  stopSignals: string[]
  auditRequired: boolean
}

export interface CommandEvidence {
  command: string
  passed: boolean
  summary?: string
  /** Stable files attached by the verification runner; prose is not parsed. */
  files?: readonly string[]
  observedAt?: string
}

export interface LastToolError {
  toolName: string
  message: string
  filePath?: string
}

export function recoveryAllowedToolsForPlaybook(playbook: RecoveryPlaybookId): string[] {
  switch (playbook) {
    case 'reread_focused_file':
      return ['read-file', 'write-checkpoint', 'raise-escalation']
    case 'rerun_authoritative_command':
    case 'package_owned_dirty_work':
      return ['run-shell-command', 'write-checkpoint', 'raise-escalation']
    case 'repair_touched_file_failure':
      return ['read-file', 'edit-file', 'run-shell-command', 'write-checkpoint', 'raise-escalation']
    case 'refresh_stale_edit_target':
      return ['read-file', 'edit-file', 'write-checkpoint', 'raise-escalation']
    case 'resume_from_checkpoint':
    case 'rebootstrap_project':
      return ['read-file', 'edit-file', 'run-shell-command', 'write-checkpoint', 'raise-escalation']
    case 'retry_current_task_context':
      return ['list-files', 'read-file', 'edit-file', 'write-file', 'run-shell-command', 'write-checkpoint', 'log-progress', 'update-task', 'raise-escalation']
    case 'review_partial_diff':
      return ['read-file', 'run-shell-command', 'write-checkpoint', 'raise-escalation']
    case 'route_to_review':
    case 'route_to_gate_check':
      return ['write-checkpoint', 'raise-escalation']
    case 'ask_concrete_human_question':
    case 'stop_with_external_setup_action':
      return ['raise-escalation']
  }
}

export interface LearningCandidate {
  id: string
  source: 'task' | 'blocker' | 'user_correction' | 'review' | 'gate' | 'model_eval'
  summary: string
  evidence: EvidenceRef[]
  proposedScope: 'project' | 'user_global' | 'guildhall_product'
  proposedDestination:
    | 'project_memory'
    | 'project_skill'
    | 'project_policy'
    | 'user_preference'
    | 'product_suggestion'
    | 'model_lane_recommendation'
    | 'task_audit_only'
  confidence: PolicyConfidence
  risk: 'low' | 'medium' | 'high'
  requiresApproval: boolean
  preference?: StructuredPreference
}

export interface AgentDecisionPacket {
  taskId: string
  role: 'spec' | 'worker' | 'reviewer' | 'gateChecker' | 'coordinator'
  classification?: FailureClassification
  evidence: EvidenceRef[]
  lastCommand?: CommandEvidence
  touchedFiles: string[]
  hypothesis?: string
  nextAction: string
  needsHuman: boolean
  humanQuestion?: string
  learningCandidates: LearningCandidate[]
}

export interface ClassifyAgentFailureInput {
  taskId: string
  blockReason?: string
  touchedFiles?: readonly string[]
  verification?: readonly CommandEvidence[]
  lastToolError?: LastToolError
  reviewVerdicts?: readonly ReviewVerdict[]
}

export type TaskAuditTarget = {
  id: string
  notes: AgentNote[]
}

export interface BuildAgentDecisionPacketInput {
  taskId: string
  role: AgentDecisionPacket['role']
  notes?: readonly AgentNote[]
  touchedFiles?: readonly string[]
  lastCommand?: CommandEvidence
}

export type RecoveryPlaybookAuditStatus = 'started' | 'succeeded' | 'failed'

export interface ResolveRecoveryPlanInput {
  taskId: string
  classification: FailureClassification
  touchedFiles?: readonly string[]
  verification?: readonly CommandEvidence[]
  notes?: readonly AgentNote[]
}

const DEFAULT_CLASSIFICATION: FailureClassification = {
  class: 'human_product_decision',
  confidence: 'low',
  evidence: [],
  scope: 'task',
  safePlaybooks: ['ask_concrete_human_question'],
  needsHuman: true,
  humanQuestion: 'Guildhall could not classify the blocker confidently. What should happen next?',
}

function normalizePathForText(path: string): string {
  return path.trim().replace(/^\.\//, '')
}

function classifySelfAuthoredVerificationFailure(
  input: ClassifyAgentFailureInput,
): FailureClassification | null {
  const touchedFiles = (input.touchedFiles ?? []).map(normalizePathForText).filter(Boolean)
  if (touchedFiles.length === 0) return null

  const failedVerification = (input.verification ?? []).find((entry) => {
    if (entry.passed) return false
    return (entry.files ?? []).some((file) => touchedFiles.includes(normalizePathForText(file)))
  })
  if (!failedVerification) return null

  const mentionedFile = (failedVerification.files ?? [])
    .map(normalizePathForText)
    .find((file) => touchedFiles.includes(file))

  return {
    class: 'self_authored_verification_failure',
    confidence: 'high',
    evidence: [
      {
        kind: 'verification',
        summary: `Failed verification references touched file ${mentionedFile ?? touchedFiles[0]}.`,
        ref: failedVerification.command,
      },
    ],
    scope: 'task',
    safePlaybooks: ['repair_touched_file_failure', 'rerun_authoritative_command'],
    needsHuman: false,
  }
}

function classifyStaleEditTarget(input: ClassifyAgentFailureInput): FailureClassification | null {
  const error = input.lastToolError
  if (!error) return null
  if (error.toolName !== 'edit-file') return null
  if (!/oldString was not found/i.test(error.message)) return null

  const filePath = error.filePath ? normalizePathForText(error.filePath) : undefined
  const touchedFiles = (input.touchedFiles ?? []).map(normalizePathForText)
  const touched = filePath ? touchedFiles.includes(filePath) : false

  return {
    class: 'stale_context',
    confidence: touched ? 'high' : 'medium',
    evidence: [
      {
        kind: 'tool_error',
        summary: filePath
          ? `edit-file missed oldString in touched file ${filePath}.`
          : 'edit-file missed oldString in the current file.',
        ...(filePath ? { ref: filePath } : {}),
      },
    ],
    scope: 'task',
    safePlaybooks: ['refresh_stale_edit_target', 'reread_focused_file'],
    needsHuman: false,
  }
}

function reviewVerdictLooksLikeInfrastructureNoise(verdict: ReviewVerdict): boolean {
  return reviewVerdictIsInfrastructureFailure(verdict)
}

function classifyReviewerInfrastructureNoise(
  input: ClassifyAgentFailureInput,
): FailureClassification | null {
  const noisyVerdict = (input.reviewVerdicts ?? []).find(reviewVerdictLooksLikeInfrastructureNoise)
  if (!noisyVerdict) return null

  return {
    class: 'reviewer_infrastructure_noise',
    confidence: noisyVerdict.llmError ? 'medium' : 'low',
    evidence: [
      {
        kind: 'review',
        summary: 'Reviewer verdict contains infrastructure failure evidence.',
        ref: noisyVerdict.failureCode ?? noisyVerdict.reviewerId ?? noisyVerdict.recordedAt,
      },
    ],
    scope: 'task',
    safePlaybooks: ['route_to_review'],
    needsHuman: false,
  }
}

export function classifyAgentFailure(input: ClassifyAgentFailureInput): FailureClassification {
  return (
    classifySelfAuthoredVerificationFailure(input) ??
    classifyStaleEditTarget(input) ??
    classifyReviewerInfrastructureNoise(input) ??
    DEFAULT_CLASSIFICATION
  )
}

export function describeFailureClassification(classification: FailureClassification): string {
  switch (classification.class) {
    case 'self_authored_verification_failure':
      return 'Verification failed in files the worker already touched; Guildhall can keep this in focused repair.'
    case 'stale_context':
      return 'The agent tried to edit stale file contents; Guildhall should refresh the exact target before another mutation.'
    case 'reviewer_infrastructure_noise':
      return 'Review failed for infrastructure reasons, not because the task output was substantively rejected.'
    case 'dirty_checkout_owned':
      return 'Guildhall owns the dirty checkout state and should package or resume that work safely.'
    case 'dirty_checkout_external':
      return 'The checkout has external changes; Guildhall needs a concrete human commit or stash decision.'
    case 'environment_unavailable':
      return 'The task environment is unavailable, so recovery should focus on setup before implementation.'
    case 'provider_unavailable':
      return 'The model provider is unavailable, so Guildhall should preserve state and retry or switch lanes.'
    case 'missing_target_evidence':
      return 'Guildhall does not yet have enough target-file evidence to choose a safe mutation.'
    case 'authoritative_command_unknown':
      return 'Guildhall does not know the authoritative verification command for this task yet.'
    case 'scope_boundary_unclear':
      return 'The task scope is unclear enough that Guildhall should ask a focused scope question.'
    case 'model_tool_use_failure':
      return 'The model failed to produce a usable tool call, so Guildhall should use a bounded repair prompt.'
    case 'review_packet_insufficient':
      return 'The review handoff packet is incomplete, so Guildhall should collect durable proof before review.'
    case 'human_product_decision':
      return 'Guildhall needs a concrete human decision before it can continue safely.'
  }
}

export function appendFailureClassificationNote(
  task: TaskAuditTarget,
  classification: FailureClassification,
  input: {
    agentId: string
    timestamp: string
  },
): AgentNote {
  const note: AgentNote = {
    agentId: input.agentId,
    role: 'policy-classification',
    timestamp: input.timestamp,
    content: JSON.stringify({
      class: classification.class,
      confidence: classification.confidence,
      scope: classification.scope,
      needsHuman: classification.needsHuman,
      humanQuestion: classification.humanQuestion,
      safePlaybooks: classification.safePlaybooks,
      evidence: classification.evidence,
      summary: describeFailureClassification(classification),
    }),
  }
  task.notes.push(note)
  return note
}

function failedPlaybookAlreadyRecorded(
  notes: readonly AgentNote[] | undefined,
  playbook: RecoveryPlaybookId,
): boolean {
  return (notes ?? []).some((note) => {
    if (note.role !== 'recovery-playbook') return false
    try {
      const parsed = JSON.parse(note.content) as Record<string, unknown>
      return parsed['playbook'] === playbook && parsed['status'] === 'failed'
    } catch {
      return false
    }
  })
}

function concreteHumanQuestionPlan(reason: string): RecoveryPlan {
  return {
    playbook: 'ask_concrete_human_question',
    reason,
    allowedTools: ['raise-escalation'],
    maxTurns: 1,
    successSignals: ['human_answer_recorded'],
    stopSignals: ['human_question_required'],
    auditRequired: true,
  }
}

function latestFailedVerification(
  verification: readonly CommandEvidence[] | undefined,
): CommandEvidence | undefined {
  return [...(verification ?? [])].reverse().find((entry) => !entry.passed)
}

export function resolveRecoveryPlan(input: ResolveRecoveryPlanInput): RecoveryPlan {
  const firstPlaybook = input.classification.safePlaybooks[0]
  if (!firstPlaybook) {
    return concreteHumanQuestionPlan('No safe recovery playbook was available for this blocker.')
  }
  if (failedPlaybookAlreadyRecorded(input.notes, firstPlaybook)) {
    return concreteHumanQuestionPlan(
      `The ${firstPlaybook} recovery playbook already failed for this task; Guildhall needs a narrower human decision before another retry.`,
    )
  }

  const touchedFiles = [...(input.touchedFiles ?? [])]
  const failedVerification = latestFailedVerification(input.verification)

  switch (firstPlaybook) {
    case 'repair_touched_file_failure':
      return {
        playbook: firstPlaybook,
        reason:
          'Repair the failed verification in files the worker already touched before escalating to a human.',
        allowedTools: recoveryAllowedToolsForPlaybook(firstPlaybook),
        allowedPaths: touchedFiles,
        command: failedVerification?.command,
        maxTurns: 2,
        successSignals: ['focused_verification_passed', 'structured_self_critique_written'],
        stopSignals: ['same_playbook_failed', 'no_checkpoint_scoped_progress'],
        auditRequired: true,
      }
    case 'refresh_stale_edit_target':
      return {
        playbook: firstPlaybook,
        reason:
          'Refresh the exact stale edit target, then retry one focused mutation or escalate if the target is no longer valid.',
        allowedTools: recoveryAllowedToolsForPlaybook(firstPlaybook),
        allowedPaths: touchedFiles,
        maxTurns: 1,
        successSignals: ['fresh_target_read', 'focused_mutation_succeeded'],
        stopSignals: ['same_playbook_failed', 'target_no_longer_valid'],
        auditRequired: true,
      }
    case 'reread_focused_file':
      return {
        playbook: firstPlaybook,
        reason: 'Read only the focused file evidence needed for the next bounded action.',
        allowedTools: recoveryAllowedToolsForPlaybook(firstPlaybook),
        allowedPaths: touchedFiles,
        maxTurns: 1,
        successSignals: ['focused_file_read'],
        stopSignals: ['same_playbook_failed', 'broad_exploration_attempted'],
        auditRequired: true,
      }
    case 'resume_from_checkpoint':
    case 'retry_current_task_context':
    case 'rebootstrap_project':
      return {
        playbook: firstPlaybook,
        reason:
          firstPlaybook === 'resume_from_checkpoint'
            ? 'Resume from the durable checkpoint instead of rediscovering context.'
            : firstPlaybook === 'retry_current_task_context'
              ? 'Retry from the current task brief/spec because no durable checkpoint exists yet.'
            : 'Re-run the project bootstrap path before returning to implementation.',
        allowedTools: recoveryAllowedToolsForPlaybook(firstPlaybook),
        allowedPaths: touchedFiles,
        command: failedVerification?.command,
        maxTurns: firstPlaybook === 'retry_current_task_context' ? 1 : 2,
        successSignals: firstPlaybook === 'retry_current_task_context'
          ? ['visible_progress_or_checkpoint_written']
          : ['checkpoint_next_action_completed'],
        stopSignals: firstPlaybook === 'retry_current_task_context'
          ? ['same_playbook_failed', 'no_visible_progress_after_retry']
          : ['same_playbook_failed', 'checkpoint_invalid'],
        auditRequired: true,
      }
    case 'package_owned_dirty_work':
      return {
        playbook: firstPlaybook,
        reason: 'Package Guildhall-owned dirty checkout work into a durable task branch.',
        allowedTools: recoveryAllowedToolsForPlaybook(firstPlaybook),
        maxTurns: 1,
        successSignals: ['owned_dirty_work_packaged'],
        stopSignals: ['same_playbook_failed', 'external_changes_detected'],
        auditRequired: true,
      }
    case 'stop_with_external_setup_action':
      return {
        playbook: firstPlaybook,
        reason: 'Stop with an external setup action instead of mutating checkout state Guildhall does not own.',
        allowedTools: recoveryAllowedToolsForPlaybook(firstPlaybook),
        maxTurns: 1,
        successSignals: ['external_setup_action_recorded'],
        stopSignals: ['same_playbook_failed'],
        auditRequired: true,
      }
    case 'rerun_authoritative_command':
      return {
        playbook: firstPlaybook,
        reason: 'Rerun the authoritative verification command before making another recovery decision.',
        allowedTools: recoveryAllowedToolsForPlaybook(firstPlaybook),
        command: failedVerification?.command,
        maxTurns: 1,
        successSignals: ['authoritative_command_reran'],
        stopSignals: ['same_playbook_failed', 'authoritative_command_unknown'],
        auditRequired: true,
      }
    case 'route_to_review':
      return {
        playbook: firstPlaybook,
        reason: 'Route back to review after preserving the infrastructure-noise evidence.',
        allowedTools: recoveryAllowedToolsForPlaybook(firstPlaybook),
        maxTurns: 1,
        successSignals: ['review_rerouted'],
        stopSignals: ['same_playbook_failed'],
        auditRequired: true,
      }
    case 'review_partial_diff':
      return {
        playbook: firstPlaybook,
        reason: 'Review the saved partial diff and verification evidence before resuming implementation.',
        allowedTools: recoveryAllowedToolsForPlaybook(firstPlaybook),
        allowedPaths: touchedFiles,
        maxTurns: 1,
        successSignals: ['partial_diff_reviewed', 'review_rerouted'],
        stopSignals: ['same_playbook_failed'],
        auditRequired: true,
      }
    case 'route_to_gate_check':
      return {
        playbook: firstPlaybook,
        reason: 'Route to gate check with the existing evidence packet.',
        allowedTools: recoveryAllowedToolsForPlaybook(firstPlaybook),
        maxTurns: 1,
        successSignals: ['gate_check_rerouted'],
        stopSignals: ['same_playbook_failed'],
        auditRequired: true,
      }
    case 'ask_concrete_human_question':
      return concreteHumanQuestionPlan('The classifier selected a human decision playbook.')
  }
}

export function appendRecoveryPlaybookNote(
  task: TaskAuditTarget,
  plan: RecoveryPlan,
  input: {
    agentId: string
    timestamp: string
    status: RecoveryPlaybookAuditStatus
    summary?: string
  },
): AgentNote {
  const note: AgentNote = {
    agentId: input.agentId,
    role: 'recovery-playbook',
    timestamp: input.timestamp,
    content: JSON.stringify({
      status: input.status,
      playbook: plan.playbook,
      reason: plan.reason,
      allowedTools: plan.allowedTools,
      allowedPaths: plan.allowedPaths,
      command: plan.command,
      maxTurns: plan.maxTurns,
      successSignals: plan.successSignals,
      stopSignals: plan.stopSignals,
      summary:
        input.summary ??
        `Recovery playbook ${plan.playbook} ${input.status}; max ${plan.maxTurns} turn(s).`,
    }),
  }
  task.notes.push(note)
  return note
}

function isFailureClass(value: unknown): value is FailureClass {
  return typeof value === 'string' && (FAILURE_CLASSES as readonly string[]).includes(value)
}

function isPolicyConfidence(value: unknown): value is PolicyConfidence {
  return value === 'low' || value === 'medium' || value === 'high'
}

function isPolicyScope(value: unknown): value is PolicyScope {
  return value === 'task' || value === 'project' || value === 'system'
}

function isRecoveryPlaybookId(value: unknown): value is RecoveryPlaybookId {
  return typeof value === 'string' && (RECOVERY_PLAYBOOK_IDS as readonly string[]).includes(value)
}

function parseEvidenceRefs(value: unknown): EvidenceRef[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const record = entry as Record<string, unknown>
    if (typeof record['summary'] !== 'string') return []
    const kind = record['kind']
    if (
      kind !== 'task' &&
      kind !== 'verification' &&
      kind !== 'tool_error' &&
      kind !== 'review' &&
      kind !== 'checkpoint'
    ) {
      return []
    }
    return [
      {
        kind,
        summary: record['summary'],
        ...(typeof record['ref'] === 'string' ? { ref: record['ref'] } : {}),
      },
    ]
  })
}

export function failureClassificationFromNote(
  note: AgentNote,
): (FailureClassification & { summary?: string }) | null {
  if (note.role !== 'policy-classification') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(note.content)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const record = parsed as Record<string, unknown>
  if (!isFailureClass(record['class'])) return null
  if (!isPolicyConfidence(record['confidence'])) return null
  if (!isPolicyScope(record['scope'])) return null

  const safePlaybooks = Array.isArray(record['safePlaybooks'])
    ? record['safePlaybooks'].filter(isRecoveryPlaybookId)
    : []

  return {
    class: record['class'],
    confidence: record['confidence'],
    scope: record['scope'],
    needsHuman: record['needsHuman'] === true,
    ...(typeof record['humanQuestion'] === 'string'
      ? { humanQuestion: record['humanQuestion'] }
      : {}),
    safePlaybooks,
    evidence: parseEvidenceRefs(record['evidence']),
    ...(typeof record['summary'] === 'string' ? { summary: record['summary'] } : {}),
  }
}

export function latestFailureClassificationFromNotes(
  notes: readonly AgentNote[] = [],
): (FailureClassification & { summary?: string }) | null {
  for (let index = notes.length - 1; index >= 0; index -= 1) {
    const classification = failureClassificationFromNote(notes[index]!)
    if (classification) return classification
  }
  return null
}

export function buildAgentDecisionPacket(
  input: BuildAgentDecisionPacketInput,
): AgentDecisionPacket {
  const classification = latestFailureClassificationFromNotes(input.notes)
  return {
    taskId: input.taskId,
    role: input.role,
    ...(classification ? { classification } : {}),
    evidence: classification?.evidence ?? [],
    ...(input.lastCommand ? { lastCommand: input.lastCommand } : {}),
    touchedFiles: [...(input.touchedFiles ?? [])],
    nextAction: classification?.needsHuman
      ? (classification.humanQuestion ?? 'Ask a concrete human question before continuing.')
      : classification?.safePlaybooks.length
        ? `Use policy playbook(s): ${classification.safePlaybooks.join(', ')}.`
        : 'Continue from the current task state.',
    needsHuman: classification?.needsHuman ?? false,
    ...(classification?.humanQuestion ? { humanQuestion: classification.humanQuestion } : {}),
    learningCandidates: [],
  }
}

export function renderAgentDecisionPacket(packet: AgentDecisionPacket): string[] {
  const classification = packet.classification
  if (!classification) return ['- No policy classification recorded.']
  const summary =
    'summary' in classification && typeof classification.summary === 'string'
      ? classification.summary
      : describeFailureClassification(classification)
  const evidence =
    classification.evidence.length > 0
      ? classification.evidence.map((item) => `  - ${item.kind}: ${item.summary}${item.ref ? ` (${item.ref})` : ''}`)
      : ['  - none recorded']
  return [
    `- Class: ${classification.class}`,
    `- Confidence: ${classification.confidence}`,
    `- Scope: ${classification.scope}`,
    `- Summary: ${summary}`,
    classification.safePlaybooks.length > 0
      ? `- Safe playbooks: ${classification.safePlaybooks.join(', ')}`
      : '- Safe playbooks: none recorded',
    `- Needs human: ${classification.needsHuman ? 'yes' : 'no'}`,
    `- Next action: ${packet.nextAction}`,
    '- Evidence:',
    ...evidence,
  ]
}
