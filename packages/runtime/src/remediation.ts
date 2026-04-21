/**
 * FR-32 Coordinator remediation decision loop.
 *
 * This module is the pure-policy half: types, lever-based authorization, and
 * DECISIONS.md formatting. The "who decides what to do" half is a coordinator
 * agent invocation; that lives in the orchestrator (which already has the
 * agent set) and passes the `RemediationContext` assembled here as the
 * coordinator's prompt.
 *
 * The action menu is fixed by the spec:
 *   wait — do nothing, re-evaluate next tick
 *   restart_from_checkpoint — FR-33 checkpoint + FR-20 session rehydrate
 *   restart_clean — discard checkpoint, begin from the task spec
 *   replace_with_different_agent — reroute to another agent id
 *   shelve_task — terminal per FR-22
 *   pause_task_line — block dependents (no FR yet for "task line"; we
 *     write the decision and flip the task to blocked for now)
 *   escalate_to_human — raise an escalation via FR-10
 *
 * Authorization is lever-gated via `remediation_autonomy` — the coordinator
 * may CHOOSE any action from the menu, but whether it executes autonomously
 * vs. waits for human confirmation is the orchestrator's call, not the
 * coordinator's.
 */

import fs from 'node:fs/promises'
import {
  DecisionEntry,
  type AgentIssue,
  type Checkpoint,
  type Task,
} from '@guildhall/core'
import type { DomainLevers, ProjectLevers } from '@guildhall/levers'
import type { StallFlag } from './liveness.js'
import type { ReclaimCandidate } from '@guildhall/tools'

export type RemediationTriggerKind = 'stall' | 'issue' | 'crash'

export type RemediationTrigger =
  | { kind: 'stall'; taskId: string; agentId: string; flag: StallFlag }
  | { kind: 'issue'; taskId: string; agentId: string; issue: AgentIssue }
  | {
      kind: 'crash'
      taskId: string
      agentId: string
      candidate: ReclaimCandidate
    }

export const REMEDIATION_ACTIONS = [
  'wait',
  'restart_from_checkpoint',
  'restart_clean',
  'replace_with_different_agent',
  'shelve_task',
  'pause_task_line',
  'escalate_to_human',
] as const
export type RemediationActionKind = (typeof REMEDIATION_ACTIONS)[number]

/**
 * Actions that touch user-visible state in ways a human might want to
 * approve first. The `confirm_destructive` autonomy position gates these.
 *   - restart_clean discards the checkpoint (potentially lost work)
 *   - shelve_task is terminal
 *   - pause_task_line blocks dependent tasks
 * `restart_from_checkpoint` and `replace_with_different_agent` are NOT in
 * this set — they're recovery actions, not losses.
 */
export const DESTRUCTIVE_REMEDIATION_ACTIONS: ReadonlySet<RemediationActionKind> =
  new Set(['restart_clean', 'shelve_task', 'pause_task_line'])

export interface RemediationAction {
  kind: RemediationActionKind
  /** Coordinator's reasoning for choosing this action. Free text. */
  rationale: string
  /** Required when kind === 'replace_with_different_agent'. */
  replacementAgent?: string
}

/**
 * The full context handed to the coordinator agent. Per the spec:
 *   - Trigger type and payload
 *   - Recent event-stream density (last N events with timestamps)
 *   - Last durable checkpoint from FR-33
 *   - Artifact snapshot (worktree diff, partial outputs, uncommitted files)
 *   - Relevant lever state — crash_recovery_default, remediation_autonomy
 *   - Prior-attempt count on the same task and prior remediation decisions
 *
 * Fields marked optional are populated opportunistically — a crash that
 * happens before any checkpoint has no checkpoint, etc.
 */
export interface RemediationContext {
  trigger: RemediationTrigger
  taskId: string
  agentId: string
  checkpoint: Checkpoint | null
  /** Count of prior remediation decisions recorded against this task. */
  priorAttempts: number
  leverState: {
    remediationAutonomy: ProjectLevers['remediation_autonomy']['position']
    crashRecoveryDefault: DomainLevers['crash_recovery_default']['position']
    /** FR-30 strictness that produced the stall flag (if applicable). */
    agentHealthStrictness?: ProjectLevers['agent_health_strictness']['position']
  }
  recentEventDensity?: {
    windowMs: number
    count: number
  }
  artifactSnapshot?: {
    worktreeDiff?: string
    filesTouched?: string[]
    uncommittedPaths?: string[]
  }
  now: string
}

export type AuthorizationDecision =
  | { kind: 'autonomous' }
  | { kind: 'requires_confirm'; reason: string }
  | { kind: 'paused'; reason: string }

/**
 * Lever-gated authorization for a chosen remediation action. Called by the
 * orchestrator after the coordinator returns its decision.
 *
 * FR-33 override: if the associated reclaim candidate has `autoEscalate`
 * set (checkpoint older than 24h), we require human confirmation
 * regardless of the autonomy lever, per spec: "auto-escalated to human
 * review regardless of `remediation_autonomy`".
 */
export function authorizeAction(
  action: RemediationAction,
  autonomy: ProjectLevers['remediation_autonomy']['position'],
  trigger?: RemediationTrigger,
): AuthorizationDecision {
  if (trigger?.kind === 'crash' && trigger.candidate.autoEscalate) {
    return {
      kind: 'requires_confirm',
      reason:
        'FR-33 auto-escalation: checkpoint older than 24h requires human review regardless of remediation_autonomy',
    }
  }
  switch (autonomy) {
    case 'pause_all_on_issue':
      return {
        kind: 'paused',
        reason: 'remediation_autonomy=pause_all_on_issue — project frozen pending human review',
      }
    case 'confirm_all':
      return {
        kind: 'requires_confirm',
        reason: 'remediation_autonomy=confirm_all — every action requires human confirmation',
      }
    case 'confirm_destructive':
      if (DESTRUCTIVE_REMEDIATION_ACTIONS.has(action.kind)) {
        return {
          kind: 'requires_confirm',
          reason: `remediation_autonomy=confirm_destructive and action=${action.kind} is destructive`,
        }
      }
      return { kind: 'autonomous' }
    case 'auto':
      return { kind: 'autonomous' }
  }
}

// ---------------------------------------------------------------------------
// Context assembly
// ---------------------------------------------------------------------------

export interface BuildContextInput {
  trigger: RemediationTrigger
  task: Task
  levers: {
    remediationAutonomy: ProjectLevers['remediation_autonomy']['position']
    crashRecoveryDefault: DomainLevers['crash_recovery_default']['position']
    agentHealthStrictness?: ProjectLevers['agent_health_strictness']['position']
  }
  checkpoint: Checkpoint | null
  priorAttempts: number
  now?: string
  recentEventDensity?: { windowMs: number; count: number }
  artifactSnapshot?: {
    worktreeDiff?: string
    filesTouched?: string[]
    uncommittedPaths?: string[]
  }
}

export function buildRemediationContext(input: BuildContextInput): RemediationContext {
  return {
    trigger: input.trigger,
    taskId: input.task.id,
    agentId: input.trigger.agentId,
    checkpoint: input.checkpoint,
    priorAttempts: input.priorAttempts,
    leverState: {
      remediationAutonomy: input.levers.remediationAutonomy,
      crashRecoveryDefault: input.levers.crashRecoveryDefault,
      ...(input.levers.agentHealthStrictness !== undefined
        ? { agentHealthStrictness: input.levers.agentHealthStrictness }
        : {}),
    },
    ...(input.recentEventDensity !== undefined
      ? { recentEventDensity: input.recentEventDensity }
      : {}),
    ...(input.artifactSnapshot !== undefined
      ? { artifactSnapshot: input.artifactSnapshot }
      : {}),
    now: input.now ?? new Date().toISOString(),
  }
}

// ---------------------------------------------------------------------------
// DECISIONS.md recording
// ---------------------------------------------------------------------------

export interface RecordRemediationDecisionInput {
  decisionsPath: string
  context: RemediationContext
  action: RemediationAction
  authorization: AuthorizationDecision
  /** e.g. the id of the coordinator agent that chose the action. */
  decidedBy: string
  domain: string
  decisionId?: string
}

/**
 * Append a DECISIONS.md entry matching AC-24: trigger type, full input
 * context (event density, checkpoint, artifact snapshot, lever state,
 * prior-attempt count), chosen action, and rationale.
 */
export async function recordRemediationDecision(
  input: RecordRemediationDecisionInput,
): Promise<void> {
  const { context, action, authorization, decidedBy, domain } = input
  const id =
    input.decisionId ??
    `rem-${context.taskId}-${context.priorAttempts + 1}-${context.trigger.kind}`

  const contextSummary = [
    `trigger=${context.trigger.kind}`,
    `task=${context.taskId}`,
    `agent=${context.agentId}`,
    `prior_attempts=${context.priorAttempts}`,
    `checkpoint=${context.checkpoint ? `step ${context.checkpoint.step} (${context.checkpoint.writtenAt})` : 'none'}`,
    context.recentEventDensity
      ? `event_density=${context.recentEventDensity.count}/${context.recentEventDensity.windowMs}ms`
      : 'event_density=unknown',
    context.artifactSnapshot?.filesTouched?.length
      ? `files_touched=${context.artifactSnapshot.filesTouched.length}`
      : 'files_touched=0',
    `levers=[remediation_autonomy=${context.leverState.remediationAutonomy}, crash_recovery_default=${context.leverState.crashRecoveryDefault}${context.leverState.agentHealthStrictness ? `, agent_health_strictness=${context.leverState.agentHealthStrictness}` : ''}]`,
  ].join('; ')

  const authorizationText =
    authorization.kind === 'autonomous'
      ? 'autonomous — executed immediately'
      : authorization.kind === 'requires_confirm'
        ? `requires human confirmation — ${authorization.reason}`
        : `paused — ${authorization.reason}`

  const entry: DecisionEntry = {
    id,
    timestamp: context.now,
    agentId: decidedBy,
    domain,
    taskId: context.taskId,
    title: `Remediation: ${action.kind} (${context.trigger.kind} trigger)`,
    context: contextSummary,
    decision: `${action.kind}${action.replacementAgent ? ` → ${action.replacementAgent}` : ''}. Rationale: ${action.rationale}`,
    consequences: authorizationText,
  }

  const block = [
    `\n## [${entry.id}] ${entry.title}`,
    `**Date:** ${entry.timestamp}`,
    `**Agent:** ${entry.agentId} (${entry.domain})`,
    `**Task:** ${entry.taskId}`,
    '',
    `**Context:** ${entry.context}`,
    '',
    `**Decision:** ${entry.decision}`,
    '',
    `**Consequences:** ${entry.consequences}`,
    '',
    '---',
  ].join('\n')

  await fs.appendFile(input.decisionsPath, block, 'utf-8')
}

/**
 * True when the action kind would alter task state. Matches the
 * `confirm_destructive` gate. Exported so the orchestrator can UI-label
 * proposed actions before execution.
 */
export function isDestructiveAction(kind: RemediationActionKind): boolean {
  return DESTRUCTIVE_REMEDIATION_ACTIONS.has(kind)
}
