import { z } from 'zod'
import { TaskSizePlan, WorkUnitAnalysis } from './task-sizing.js'
import { StructuredSpec, StructuredSpecContractSurfaceDelta } from './structured-spec.js'
import { CompletionHandoff, ProofPath } from './task-proof.js'

// ---------------------------------------------------------------------------
// Task status lifecycle (FR-01)
//    proposed ─┐
// import_draft ┼→ exploring → spec_review → ready → in_progress → review → gate_check → done
//              │                                                   ↘ blocked
//              └─────────────────────────→ shelved (worker pre-rejection, FR-22)
//              └─────────────────────────→ archived / cancelled (retained or retired without execution)
//
// Origination:
//   - `exploring` — human-initiated via the Spec Agent intake (FR-12)
//   - `proposed`  — agent-initiated (FR-21); promotion path governed by lever
//                   `task_origination`
//
// Terminal / non-actionable states: `pending_pr`, `done`, `shelved`,
// `blocked`, `archived`, `cancelled`.
// ---------------------------------------------------------------------------

const TaskStatusValue = z.enum([
  'proposed',      // FR-21: agent-originated; awaiting promotion per lever `task_origination`
  'import_draft',  // Workspace-imported draft that still needs shaping before normal intake begins
  'exploring',     // Conversational intake — Spec Agent is building the spec with the user (FR-12)
  'spec_review',   // Spec drafted; awaiting owner approval before worker handoff
  'ready',         // Spec approved, ready for a worker to pick up
  'in_progress',   // Assigned to a worker agent
  'review',        // Worker done, awaiting reviewer agent
  'gate_check',    // Reviewer approved, running hard gates
  'pending_pr',    // FR-25 manual_pr: approved & pushed; awaiting external PR merge
  'done',          // All gates passed — terminal
  'shelved',       // FR-22: worker pre-rejected (no_op/not_viable/low_value/duplicate/spec_wrong) — terminal
  'blocked',       // Cannot proceed — escalation required — terminal
  'archived',      // Retained for audit/history but removed from active work
  'cancelled',     // Explicitly retired or superseded without execution
])

export const TaskStatus: z.ZodType<z.infer<typeof TaskStatusValue>, z.ZodTypeDef, unknown> = z.preprocess(
  (value) => value === 'pending' ? 'ready' : value,
  TaskStatusValue,
)
export type TaskStatus = z.infer<typeof TaskStatus>

export const TERMINAL_TASK_STATUSES = ['pending_pr', 'done', 'shelved', 'blocked', 'archived', 'cancelled'] as const

// FR-21: origination tracks who/what put the task on the board. Affects
// promotion routing (see lever `task_origination`) and audit trail.
export const TaskOrigination = z.enum(['human', 'agent', 'system'])
export type TaskOrigination = z.infer<typeof TaskOrigination>

// FR-22: structured pre-rejection codes. A worker may emit one of these
// during or after implementation; the task transitions to `shelved` (or
// requeues, depending on lever `pre_rejection_policy`).
export const PreRejectionCode = z.enum([
  'no_op',       // The task's success condition is already satisfied; nothing to do
  'not_viable',  // The approach described cannot work (technical or physical constraint)
  'low_value',   // The work is technically possible but yields little benefit
  'duplicate',   // Overlaps with another task already in flight or recently done
  'spec_wrong',  // The spec is self-contradictory or misunderstands the domain
])
export type PreRejectionCode = z.infer<typeof PreRejectionCode>

export const TaskPriority = z.enum(['critical', 'high', 'normal', 'low'])
export type TaskPriority = z.infer<typeof TaskPriority>

const ContractSurfaceKind = z.enum([
  'component_api',
  'http_api',
  'event_api',
  'mcp_api',
  'schema',
  'state_machine',
  'design_system',
  'domain_capability',
  'documentation',
  'other',
])

export const ContractSurfaceReviewPacket = z.object({
  id: z.string(),
  surface: z.object({
    id: z.string(),
    label: z.string(),
    kind: ContractSurfaceKind,
    authority: z.enum(['provider', 'shared', 'consumer']),
    scope: z.enum(['project', 'workspace', 'external_reference']),
    owningProject: z.object({
      id: z.string(),
      label: z.string(),
      path: z.string().optional(),
    }),
    domain: z.object({
      id: z.string(),
      label: z.string(),
      path: z.string().optional(),
    }).optional(),
  }),
  currentSpecRef: z.string(),
  knownConsumers: z.array(z.object({
    id: z.string(),
    label: z.string(),
    path: z.string().optional(),
  })).default([]),
  existingInvariants: z.array(z.object({
    id: z.string(),
    label: z.string(),
    rule: z.string(),
    proofObligations: z.array(z.string()).default([]),
  })).default([]),
  existingDecisions: z.array(z.object({
    id: z.string(),
    summary: z.string(),
    decidedAt: z.string(),
    decidedBy: z.string(),
    evidenceRefs: z.array(z.string()).default([]),
    invariantRefs: z.array(z.string()).optional(),
  })).default([]),
  siblingSpecRefs: z.array(z.string()).default([]),
  driftFindings: z.array(z.string()).default([]),
  currentDelta: StructuredSpecContractSurfaceDelta,
  proofObligations: z.array(z.string()).default([]),
  reviewFocus: z.array(z.string()).default([]),
})
export type ContractSurfaceReviewPacket = z.infer<typeof ContractSurfaceReviewPacket>

export const TaskHold = z.object({
  previousStatus: TaskStatus,
  reason: z.string().optional(),
  heldAt: z.string(),
  heldBy: z.string(),
})
export type TaskHold = z.infer<typeof TaskHold>

// FR-15: per-task permission mode override. Semantic ordering (narrowest →
// widest) is plan < default < full_auto. A per-task mode may only *narrow*
// the agent's baseline mode — it can never widen it. The orchestrator clamps
// at dispatch time; see GuildhallAgent.setPermissionMode for details.
export const TaskPermissionMode = z.enum(['default', 'plan', 'full_auto'])
export type TaskPermissionMode = z.infer<typeof TaskPermissionMode>

export const GateResult = z.object({
  gateId: z.string(),
  /** The exact command when this gate was command-backed. */
  command: z.string().optional(),
  type: z.enum(['hard', 'soft']),
  passed: z.boolean(),
  output: z.string().optional(),
  checkedAt: z.string(), // ISO timestamp
})
export type GateResult = z.infer<typeof GateResult>

export const AgentNote = z.object({
  agentId: z.string(),
  role: z.string(),
  content: z.string(),
  timestamp: z.string(), // ISO timestamp
})
export type AgentNote = z.infer<typeof AgentNote>

// FR-26 / FR-27 / AC-18: every reviewer verdict is persisted on the task so
// the audit trail shows what was decided, by which path, when, and against
// which policy version. `reviewerPath` distinguishes LLM-run reviews from
// deterministic fallbacks — the load-bearing field for AC-18.
export const ReviewVerdict = z.object({
  verdict: z.enum(['approve', 'revise']),
  reviewerPath: z.enum(['llm', 'deterministic']),
  /**
   * One-line headline — what was decided and at a high level why. Suitable
   * for CLI / PROGRESS.md summaries.
   */
  reason: z.string(),
  /**
   * Full reasoning trace — for LLM reviews this is the per-AC + per-rubric
   * walk-through the reviewer agent wrote; for deterministic reviews it's
   * the signal-by-signal score breakdown. Optional because very old verdict
   * records (pre-reasoning field) won't have it.
   *
   * This is the load-bearing field for "reasoning is part of validation":
   * a coordinator auditing `reviewVerdicts` can reconstruct the *why*
   * without having to re-read scattered notes.
   */
  reasoning: z.string().optional(),
  // Deterministic path populates these; LLM path leaves them undefined.
  score: z.number().optional(),
  failingSignals: z.array(z.string()).default([]),
  // Populated when the deterministic path ran as a fallback after an LLM
  // outage — records the LLM error so the human auditing the trail can tell
  // a fallback from a deterministic-only run.
  llmError: z.string().optional(),
  recordedAt: z.string(), // ISO timestamp
  policyVersion: z.string().optional(),
})
export type ReviewVerdict = z.infer<typeof ReviewVerdict>

// Reviewer fan-out adjudication. When lever `reviewer_fanout_policy` is
// `coordinator_adjudicates_on_conflict` and the detector fires (same persona
// emits `revise` across two consecutive rounds with overlapping revision
// items), the owning coordinator issues a binding decision that supersedes
// the dissenting persona verdicts. The worker's next prompt is the scoped
// instructions only — never the raw conflict — so the worker cannot
// relitigate the call. See docs/disagreement-and-handoff.md §1.
export const AdjudicationRecord = z.object({
  /** Which review round produced the conflict (1-indexed). */
  round: z.number().int().positive(),
  /** What triggered the adjudication. */
  trigger: z.enum(['same_persona_repeat_dissent', 'explicit_request', 'policy_conflict']),
  /** Guild slugs whose revise verdicts this record resolves. */
  dissenters: z.array(z.string()).default([]),
  /** Guild slugs whose concerns won. */
  winningConcerns: z.array(z.string()).default([]),
  /** Guild slugs whose concerns were superseded. */
  supersededConcerns: z.array(z.string()).default([]),
  /** One-line headline for CLI / PROGRESS.md. */
  summary: z.string(),
  /** Full rationale — references spec, goal guardrails, and the dissent. */
  rationale: z.string(),
  /** Scoped instructions the worker sees on the next prompt. */
  scopeInstructions: z.array(z.string()).default([]),
  /** `coordinator` (per FR-02 domain owner) or `human` when escalated. */
  decidedBy: z.enum(['coordinator', 'human']),
  decidedAt: z.string(), // ISO timestamp
  policyVersion: z.string().optional(),
})
export type AdjudicationRecord = z.infer<typeof AdjudicationRecord>

// Sequential agent handoff within one task. Lets a task declare N engineer
// specialists who work in sequence on the same worktree. Each step picks one
// engineer by guild slug (e.g. frontend-engineer, backend-engineer); the
// orchestrator advances `task.handoffStep` after each step completes and
// only dispatches the normal reviewer fan-out after the final step.
//
// The worker writes a structured handoff note before transitioning to
// `review`; the orchestrator captures that note onto the completed
// `HandoffStep`, reverts status to `in_progress`, and picks the next
// engineer. See docs/disagreement-and-handoff.md §2.
export const HandoffStep = z.object({
  /** Guild slug (e.g. `frontend-engineer`, `backend-engineer`). */
  agent: z.string(),
  /** Optional list of acceptance-criteria ids this step owns. */
  scope: z.array(z.string()).default([]),
  /** Optional freeform extra instructions for this step only. */
  instructions: z.string().optional(),
  /** ISO timestamp captured when the step's worker handed off. */
  completedAt: z.string().optional(),
  /** Structured handoff note the step's worker left for the next. */
  handoffNote: z.string().optional(),
})
export type HandoffStep = z.infer<typeof HandoffStep>

// FR-10: Structured escalation events. An escalation halts a task until a human
// (or an automated resolver) records a resolution. The orchestrator treats a
// task with any open escalation as blocked and refuses to route it further.
export const EscalationReason = z.enum([
  'spec_ambiguous',            // Spec Agent couldn't disambiguate during intake
  'max_revisions_exceeded',    // Automated — raised by the orchestrator
  'human_judgment_required',   // Agent explicitly requested a human call
  'decision_required',         // A decision needs to be made before proceeding
  'gate_hard_failure',         // A hard gate cannot be made to pass
  'scope_boundary',            // Task crosses a coordinator's scope boundary
])
export type EscalationReason = z.infer<typeof EscalationReason>

export const ExternalBlockerStep = z.object({
  id: z.string(),
  title: z.string(),
  detail: z.string().optional(),
  owner: z.enum(['user', 'guildhall', 'external']).default('user'),
  status: z.enum(['todo', 'done', 'blocked']).default('todo'),
})
export type ExternalBlockerStep = z.infer<typeof ExternalBlockerStep>

export const Escalation = z.object({
  id: z.string(),                             // stable id, e.g. `esc-<taskId>-<n>`
  taskId: z.string(),
  agentId: z.string(),                        // Who raised it
  reason: EscalationReason,
  summary: z.string(),                        // Human-readable one-liner
  details: z.string().optional(),             // Full context for the human
  externalChecklist: z.array(ExternalBlockerStep).optional(),
  raisedAt: z.string(),                       // ISO timestamp
  resolvedAt: z.string().optional(),          // Set once resolved
  resolution: z.string().optional(),          // Human's response / decision
  resolvedBy: z.string().optional(),          // Who resolved it ('human' or agent id)
})
export type Escalation = z.infer<typeof Escalation>

// Product brief: the *why*-and-*for-whom* layer on a task, authored by the
// Spec Agent (or a human) alongside the technical spec. Tech spec answers
// "what will we build?"; brief answers "who is this for, how do we know it
// worked, and what should we NOT do?" Brief approval is orthogonal to spec
// approval — a task may have an approved brief before its spec is final, or
// may skip the brief entirely for purely infrastructural work.
// ---------------------------------------------------------------------------
// Legacy agent → user question parser.
//
// `task.openQuestions` was the pre-0.10 way to persist owner questions on a
// task. Normal task state must now route owner input through OwnerInputRequest
// records linked to bounded-chat sessions. Keep this schema for migrations and
// old-record readers only; do not add it back to the normal Task schema.
// ---------------------------------------------------------------------------

const AgentQuestionBase = {
  /** Stable id within the task — survives re-renders / re-asks. */
  id: z.string(),
  /** Which agent asked (spec-agent, coordinator, etc.). */
  askedBy: z.string(),
  askedAt: z.string(),
  /** Short topic label, e.g. "AlertDialog variants". */
  subject: z.string().optional(),
  /** Plain-language context that explains why the question matters. */
  description: z.string().optional(),
  /** Persisted-but-unsubmitted answer draft shown back to the user on reload. */
  draftAnswer: z.string().optional(),
  /** ISO timestamp when the user answered, or undefined if still open. */
  answeredAt: z.string().optional(),
  /** Free-text capture of the user's answer regardless of kind. */
  answer: z.string().optional(),
}

export const AgentQuestion = z.discriminatedUnion('kind', [
  // "Here's what I think you want — confirm or correct." Equivalent to the
  // current brief-approval surface. UI: Approve / Reply.
  z.object({
    ...AgentQuestionBase,
    kind: z.literal('confirm'),
    /** What the agent thinks is true; one statement. */
    restatement: z.string(),
  }),
  // Binary choice. UI: Yes / No / Reply.
  z.object({
    ...AgentQuestionBase,
    kind: z.literal('yesno'),
    prompt: z.string(),
  }),
  // Multiple choice with mandatory "Other..." escape hatch. UI: chip per choice
  // + free-text fallback.
  z.object({
    ...AgentQuestionBase,
    kind: z.literal('choice'),
    prompt: z.string(),
    /** Single-choice by default; multiple means checkbox-style selection. */
    selectionMode: z.enum(['single', 'multiple']).optional(),
    /** Must be 2..6 short labels. UI also surfaces an "Other..." textbox. */
    choices: z.array(z.string()).min(2).max(6),
  }),
  // Open-ended. UI: textarea + Send.
  z.object({
    ...AgentQuestionBase,
    kind: z.literal('text'),
    prompt: z.string(),
  }),
])
export type AgentQuestion = z.infer<typeof AgentQuestion>

function normalizeStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string')
      .map(item => item.trim())
      .filter(Boolean)
  }
  if (typeof value === 'string') {
    return value
      .split('\n')
      .map(item => item.trim())
      .map(item => item.replace(/^[*-]\s*/, '').trim())
      .filter(Boolean)
  }
  return []
}

function normalizeProductBriefInput(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const brief = value as Record<string, unknown>
  const userJob = typeof brief.userJob === 'string' ? brief.userJob.trim() : ''
  const successMetric =
    typeof brief.successMetric === 'string' && brief.successMetric.trim()
      ? brief.successMetric.trim()
      : typeof brief.successCriteria === 'string'
        ? brief.successCriteria.trim()
        : ''
  const whyItMattersNow =
    typeof brief.whyItMattersNow === 'string' && brief.whyItMattersNow.trim()
      ? brief.whyItMattersNow.trim()
      : successMetric || userJob
  const nonGoals = normalizeStringList(brief.nonGoals)
  const antiPatterns = normalizeStringList(brief.antiPatterns)
  const mergedNonGoals = Array.from(new Set([...nonGoals, ...antiPatterns]))
  return {
    ...brief,
    ...(userJob ? { userJob } : {}),
    ...(successMetric ? { successMetric } : {}),
    ...(whyItMattersNow ? { whyItMattersNow } : {}),
    nonGoals: mergedNonGoals,
    antiPatterns: mergedNonGoals,
  }
}

export const ProductBrief = z.preprocess(normalizeProductBriefInput, z.object({
  userJob: z.string(),                              // The user's job-to-be-done this task serves
  whyItMattersNow: z.string().optional(),           // Why this matters now / why the task exists
  successMetric: z.string(),                        // How we'll know it worked
  nonGoals: z.array(z.string()).optional(),         // Intentional boundary for this brief
  audience: z.string().optional(),                  // Who this is for when it matters to say it plainly
  usageContext: z.string().optional(),              // Where / when the user encounters this
  antiPatterns: z.array(z.string()).optional(),     // Legacy/UI alias for nonGoals
  rolloutPlan: z.string().optional(),               // Staging / flagging / migration notes
  brandInteractionNotes: z.string().optional(),     // Optional tone/visual interaction notes
  authoredBy: z.string().optional(),                // agent id or 'human'
  authoredAt: z.string().optional(),
  approvedBy: z.string().optional(),
  approvedAt: z.string().optional(),
}))
export type ProductBrief = z.infer<typeof ProductBrief>

// FR-31: structured agent-issue channel. Agents emit issues via the
// `report_issue` tool at any point during execution. Issues are NOT terminal
// — the agent continues working. The coordinator's remediation loop (FR-32)
// reads the open-issue list on its next tick and decides whether to intervene.
//
// Mapping to the FR-16 wire event `agent_issue`: the tool writes the entry
// to TASKS.json; the orchestrator surfaces a wire event on the next tick so
// subscribers see it without waiting for task status to change.
export const AgentIssueCode = z.enum([
  'stuck',                    // Agent has made no forward progress despite multiple attempts
  'tool_unavailable',         // A tool expected to be present is missing or permission-denied
  'context_exhausted',        // Injected context is insufficient; agent cannot proceed informatively
  'dependency_unreachable',   // An external system the task depends on is down / timing out
  'infinite_loop_suspected',  // Agent notices repeated state without progress
  'spec_incoherent',          // Spec contradicts itself or is incompatible with the codebase
  'unknown',                  // None of the above; the agent has a concern it cannot categorize
])
export type AgentIssueCode = z.infer<typeof AgentIssueCode>

export const AgentIssueSeverity = z.enum(['info', 'warn', 'critical'])
export type AgentIssueSeverity = z.infer<typeof AgentIssueSeverity>

export const AgentIssue = z.object({
  id: z.string(),                             // stable id, e.g. `iss-<taskId>-<n>`
  taskId: z.string(),
  agentId: z.string(),                        // Who raised it
  code: AgentIssueCode,
  severity: AgentIssueSeverity,
  detail: z.string(),                         // Concrete description of what the agent observed
  suggestedAction: z.string().optional(),     // Agent's own recommendation (advisory only)
  raisedAt: z.string(),                       // ISO timestamp
  // FR-16: the orchestrator sets this once it has emitted the wire event so
  // subsequent ticks don't re-broadcast. Open-issue semantics (for the
  // coordinator inbox) are driven by `resolvedAt`, not this flag.
  broadcast: z.boolean().default(false),
  resolvedAt: z.string().optional(),          // Set once the coordinator dispatches a remediation
  resolution: z.string().optional(),          // What the coordinator decided
  resolvedBy: z.string().optional(),          // Who resolved it
})
export type AgentIssue = z.infer<typeof AgentIssue>

// ---------------------------------------------------------------------------
// FR-33 Crash-safe task checkpointing
//
// A Checkpoint is the worker's durable "here's where I am" marker. It is
// written at tool boundaries (before destructive changes, after subprocess
// success, on explicit spec markers, before FR-19 compaction) to disk at
// `memory/tasks/<task-id>/checkpoint.json`. On orchestrator restart or
// agent-crash detection, any task in a non-terminal status without a live
// agent is a reclaim candidate; the coordinator's FR-32 remediation loop
// consumes the last durable checkpoint as an input.
//
// Stored per-task (singleton, overwritten on each write) — the progression
// of intents is already captured by PROGRESS.md and the event stream.
//
// `engineSessionId` is the thread back into FR-20 session persistence: the
// coordinator's `restart_from_checkpoint` action rehydrates the engine via
// that id and then continues from `nextPlannedAction`.
// ---------------------------------------------------------------------------
export const Checkpoint = z.object({
  taskId: z.string(),
  agentId: z.string(),
  // Monotonic step counter, scoped to this task's work. Starts at 1.
  step: z.number().int().positive(),
  // One-line human-readable description of the current intent. What the
  // agent was about to do / just did when it wrote the checkpoint.
  intent: z.string(),
  // Files the worker has touched during this task (absolute or
  // project-relative — the writer's convention). Used by FR-32 for the
  // artifact-retention decision.
  filesTouched: z.array(z.string()).default([]),
  // Optional: the git SHA of the last commit the worker made. Not required
  // — many checkpoints land mid-work before any commit exists.
  lastCommittedSha: z.string().optional(),
  // What the agent plans to do next — consumed by `restart_from_checkpoint`
  // to pick up where we left off.
  nextPlannedAction: z.string(),
  // FR-20: link into session persistence so the coordinator can rehydrate
  // engine state (history, tool-use cache, compaction bookmarks). Optional
  // because the first checkpoint may precede the first session snapshot.
  engineSessionId: z.string().optional(),
  // Durable resume context for long-running tasks. Captures the
  // task-local evidence and narrowing decisions that should survive
  // coordinator restarts so a resumed worker does not have to rediscover
  // them from scratch.
  resumeContext: z.object({
    verification: z.array(z.object({
      command: z.string(),
      passed: z.boolean(),
      observedAt: z.string(),
      summary: z.string().optional(),
    })).default([]),
    companionFiles: z.array(z.string()).default([]),
    workingHypothesis: z.string().optional(),
    safeNextMutationSurface: z.array(z.string()).default([]),
  }).optional(),
  writtenAt: z.string(), // ISO timestamp
})
export type Checkpoint = z.infer<typeof Checkpoint>

const ACCEPTANCE_VERIFIERS = ['automated', 'review', 'human'] as const
const ACCEPTANCE_SOURCES = ['documented', 'inferred'] as const
const LEGACY_SCHEMA_TIMESTAMP = '1970-01-01T00:00:00.000Z'

function parseScenarioExpectationFromDescription(description: string): { scenario: string; expectation: string } {
  const normalized = description.trim().replace(/\s+/g, ' ')
  const gwtMatch = /^given\s+(.+?),\s*when\s+(.+?),\s*then\s+(.+)$/i.exec(normalized)
  if (gwtMatch) {
    return {
      scenario: `Given ${gwtMatch[1]!.trim()}, when ${gwtMatch[2]!.trim()}`,
      expectation: `Then ${gwtMatch[3]!.trim()}`,
    }
  }
  return { scenario: normalized, expectation: normalized }
}

function normalizeAcceptanceCriteria(input: unknown): unknown {
  if (typeof input === 'string') {
    const description = input.trim()
    if (!description) return input
    const normalizedScenarioExpectation = parseScenarioExpectationFromDescription(description)
    return {
      id: `legacy-${slugForLegacyAcceptanceCriterion(description)}`,
      description,
      scenario: normalizedScenarioExpectation.scenario,
      expectation: normalizedScenarioExpectation.expectation,
      verifiedBy: 'review',
    }
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input
  const criterion = input as Record<string, unknown>
  const verifiedBy = criterion.verifiedBy
  const rawDescription = typeof criterion.description === 'string'
    ? criterion.description.trim()
    : typeof criterion.text === 'string'
      ? criterion.text.trim()
      : ''
  const rawScenario = typeof criterion.scenario === 'string' ? criterion.scenario.trim() : ''
  const rawExpectation = typeof criterion.expectation === 'string' ? criterion.expectation.trim() : ''
  const normalizedDescription = rawDescription || (
    rawScenario && rawExpectation
      ? `${rawScenario} ${rawExpectation}`.trim()
      : rawScenario || rawExpectation
  )
  const normalizedScenarioExpectation = normalizedDescription
    ? parseScenarioExpectationFromDescription(normalizedDescription)
    : { scenario: rawScenario, expectation: rawExpectation }

  const baseCriterion = {
    ...criterion,
    id: typeof criterion.id === 'string' && criterion.id.trim()
      ? criterion.id.trim()
      : normalizedDescription
        ? `legacy-${slugForLegacyAcceptanceCriterion(normalizedDescription)}`
        : criterion.id,
    ...(normalizedDescription ? { description: normalizedDescription } : {}),
    ...(rawScenario ? { scenario: rawScenario } : normalizedScenarioExpectation.scenario ? { scenario: normalizedScenarioExpectation.scenario } : {}),
    ...(rawExpectation ? { expectation: rawExpectation } : normalizedScenarioExpectation.expectation ? { expectation: normalizedScenarioExpectation.expectation } : {}),
    verifiedBy: verifiedBy ?? 'review',
  }

  if (verifiedBy === undefined && typeof criterion.command === 'string' && criterion.command.trim()) {
    return { ...baseCriterion, verifiedBy: 'automated' }
  }
  if (typeof verifiedBy !== 'string') return baseCriterion
  if ((ACCEPTANCE_VERIFIERS as readonly string[]).includes(verifiedBy)) return baseCriterion

  const value = verifiedBy.trim()
  const looksLikeCommand = /\s|\/|^(pnpm|npm|yarn|bun|vitest|tsx|node|tsgo|tsc|cargo|go|pytest|python|make)\b/.test(value)
  return {
    ...baseCriterion,
    verifiedBy: looksLikeCommand ? 'automated' : 'review',
    ...(looksLikeCommand && typeof criterion.command !== 'string' ? { command: value } : {}),
  }
}

function slugForLegacyAcceptanceCriterion(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return slug || 'acceptance-criterion'
}

export const AcceptanceCriteria = z.preprocess(normalizeAcceptanceCriteria, z.object({
  id: z.string(),
  description: z.string(),
  scenario: z.string().optional(),
  expectation: z.string().optional(),
  // How to verify: 'automated' = shell command, 'review' = reviewer agent judgment
  verifiedBy: z.enum(ACCEPTANCE_VERIFIERS),
  source: z.enum(ACCEPTANCE_SOURCES).default('documented'),
  command: z.string().optional(), // for automated criteria
  // Command-backed proofs default to a zero exit. Negative fixtures must say
  // explicitly that a non-zero exit is the expected result.
  expectedExit: z.enum(['zero', 'non_zero']).optional(),
  expectedOutputIncludes: z.array(z.string()).optional(),
  evidenceHint: z.string().optional(),
  negativeCase: z.string().optional(),
  met: z.boolean().default(false),
  // Runtime proof projection fields. They remain on the parsed contract so a
  // bounded effective-task read can carry a stale/settled proof state without
  // losing the persisted acceptance claim during a point mutation.
  persistedMet: z.boolean().optional(),
  verificationState: z.enum(['verified', 'stale']).optional(),
  verificationSource: z.string().optional(),
  staleReason: z.string().optional(),
  staleGateId: z.string().optional(),
}))
export type AcceptanceCriteria = z.infer<typeof AcceptanceCriteria>

export const AcceptanceCriteriaProofState = z.object({
  state: z.string(),
  reason: z.string().optional(),
  staleMetCount: z.number().int().nonnegative().optional(),
  gateId: z.string().optional(),
  checkedAt: z.string().optional(),
})
export type AcceptanceCriteriaProofState = z.infer<typeof AcceptanceCriteriaProofState>

export const TaskRequestKind = z.enum([
  'task_spec',
  'project_question',
  'settings_proposal',
  'persona_practice_proposal',
  'repair_triage',
  'clarification',
])
export type TaskRequestKind = z.infer<typeof TaskRequestKind>

export const TaskRequest = z.object({
  id: z.string(),
  raw: z.string(),
  kind: TaskRequestKind,
  title: z.string(),
  routingSummary: z.string(),
  pressureTestRequired: z.boolean().default(true),
  createdAt: z.string(),
})
export type TaskRequest = z.infer<typeof TaskRequest>

export const WorkKind = z.enum([
  'app_spec',
  'feature_spec',
  'feature',
  'primitive',
  'component',
  'story',
  'test',
  'implementation',
  'setup',
  'verification',
  'release',
  'research',
  'decision',
  'cleanup',
  'learning',
])
export type WorkKind = z.infer<typeof WorkKind>

export const TaskDelivery = z.object({
  driver: z.string().optional(),
  provider: z.string().optional(),
  supports: z.array(z.string()).default([]),
  usesPrimitives: z.array(z.string()).default([]),
  provesPrimitives: z.array(z.string()).default([]),
  proofKind: z.string().optional(),
})
export type TaskDelivery = z.infer<typeof TaskDelivery>

export const WorkVisibilityKind = z.enum(['primary', 'supporting', 'internal_step', 'hidden'])
export type WorkVisibilityKind = z.infer<typeof WorkVisibilityKind>

export const WorkVisibility = z.object({
  kind: WorkVisibilityKind,
  label: z.string().optional(),
  countInProjectTotals: z.boolean().optional(),
})
export type WorkVisibility = z.infer<typeof WorkVisibility>

export const DeliveryStepKind = z.enum([
  'make_change',
  'verify',
  'document',
  'review',
  'decide',
  'coordinate',
  'release',
  'handoff',
  'external_action',
])
export type DeliveryStepKind = z.infer<typeof DeliveryStepKind>

export const DeliveryStepStatus = z.enum(['todo', 'active', 'blocked', 'done', 'waived'])
export type DeliveryStepStatus = z.infer<typeof DeliveryStepStatus>

export const DeliveryStep = z.object({
  id: z.string(),
  title: z.string(),
  kind: DeliveryStepKind,
  status: DeliveryStepStatus,
  required: z.boolean().default(true),
  blocksCompletion: z.boolean().default(true),
  sourceTaskId: z.string().optional(),
  evidenceChannel: z.string().optional(),
  toolLabel: z.string().optional(),
})
export type DeliveryStep = z.infer<typeof DeliveryStep>

export const WorkHierarchyRelation = z.enum([
  'contains',
  'decomposes',
  'proves',
  'reviews',
  'sets_up',
  'migrates',
])
export type WorkHierarchyRelation = z.infer<typeof WorkHierarchyRelation>

function normalizeWorkHierarchy(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input
  const record = input as Record<string, unknown>
  return {
    ...record,
    relation: record.relation === 'child' ? 'decomposes' : record.relation,
  }
}

export const WorkHierarchy = z.preprocess(normalizeWorkHierarchy, z.object({
  parentId: z.string().optional(),
  childIds: z.array(z.string()).default([]),
  order: z.number().default(0),
  depth: z.number().int().nonnegative().optional(),
  path: z.array(z.string()).optional(),
  relation: WorkHierarchyRelation.default('contains'),
}))
export type WorkHierarchy = Omit<z.infer<typeof WorkHierarchy>, 'relation'> & {
  relation?: WorkHierarchyRelation
}

export const ExecutionPlanActionType = z.enum([
  'split_work',
  'create_proof_work',
  'create_review_work',
  'create_setup_work',
  'create_migration_work',
  'change_visibility',
  'reorder_work',
  'merge_work',
])
export type ExecutionPlanActionType = z.infer<typeof ExecutionPlanActionType>

export const ExecutionPlanActionStatus = z.enum([
  'planned',
  'applying',
  'applied',
  'failed',
  'superseded',
])
export type ExecutionPlanActionStatus = z.infer<typeof ExecutionPlanActionStatus>

export const ExecutionPlanAction = z.object({
  id: z.string(),
  type: ExecutionPlanActionType,
  targetWorkId: z.string(),
  status: ExecutionPlanActionStatus,
  authority: z.literal('execution_planning'),
  rationale: z.string(),
  createdChildIds: z.array(z.string()).default([]),
  createdAt: z.string(),
  createdBy: z.string(),
  appliedAt: z.string().optional(),
  appliedBy: z.string().optional(),
  failureReason: z.string().optional(),
})
export type ExecutionPlanAction = z.infer<typeof ExecutionPlanAction>

export const ScopeAuthorityRequestType = z.enum([
  'add_scope',
  'drop_scope',
  'defer_scope',
  'change_release_boundary',
  'resolve_goal_conflict',
  'external_permission',
  'irreversible_operation',
])
export type ScopeAuthorityRequestType = z.infer<typeof ScopeAuthorityRequestType>

export const ScopeAuthorityRequest = z.object({
  id: z.string(),
  type: ScopeAuthorityRequestType,
  targetWorkId: z.string().optional(),
  status: z.enum(['open', 'answered', 'withdrawn']).default('open'),
  question: z.string(),
  whyItMatters: z.string(),
  options: z.array(z.object({
    id: z.string(),
    label: z.string(),
    consequence: z.string(),
  })).default([]),
  createdAt: z.string(),
  createdBy: z.string(),
  answeredAt: z.string().optional(),
  answeredBy: z.string().optional(),
  answer: z.string().optional(),
})
export type ScopeAuthorityRequest = z.infer<typeof ScopeAuthorityRequest>

export const WorkCompletionBoundary = z.object({
  summary: z.string(),
  requiredChildPolicy: z.enum(['all_required_done', 'selected_children_done', 'manual_handoff']),
  requiredChildIds: z.array(z.string()).optional(),
  proofPathRequired: z.boolean().default(false),
  handoffRequired: z.boolean().default(false),
  deferAllowed: z.boolean().default(false),
})
export type WorkCompletionBoundary = z.infer<typeof WorkCompletionBoundary>

export const BusinessEnvelope = z.object({
  goalId: z.string(),
})
export type BusinessEnvelope = z.infer<typeof BusinessEnvelope>

export const TaskKind = z.enum([
  'implementation',
  'research',
  'decision',
  'spike',
  'cleanup',
  'verification',
  'release',
  'learning',
])
export type TaskKind = z.infer<typeof TaskKind>

export const TaskReadinessDimensionId = z.enum([
  'outcome_clarity',
  'size',
  'proofability',
  'context_load',
  'dependency_risk',
  'uncertainty',
  'user_judgment_exposure',
])
export type TaskReadinessDimensionId = z.infer<typeof TaskReadinessDimensionId>

const TaskReadinessRecommendationValue = z.enum([
  'ready',
  'needs_one_question',
  'needs_research_spike',
  'requires_child_work',
  'shelve_defer',
])
export const TaskReadinessRecommendation: z.ZodType<
  z.infer<typeof TaskReadinessRecommendationValue>,
  z.ZodTypeDef,
  unknown
> = z.preprocess(
  (value) => value === 'split' ? 'requires_child_work' : value,
  TaskReadinessRecommendationValue,
)
export type TaskReadinessRecommendation = z.infer<typeof TaskReadinessRecommendation>

export const DefinitionOfDone = z.object({
  items: z.array(z.string()).default([]),
  evidenceRequired: z.array(z.string()).default([]),
  updatedAt: z.string().optional(),
  createdBy: z.string().default('task-readiness'),
})
export type DefinitionOfDone = z.infer<typeof DefinitionOfDone>

export const IfThenBlockerPlan = z.object({
  if: z.string(),
  then: z.string(),
  owner: z.enum(['guildhall', 'owner', 'external']).default('guildhall'),
  reason: z.string().optional(),
})
export type IfThenBlockerPlan = z.infer<typeof IfThenBlockerPlan>

export const ContextBudgetEstimate = z.object({
  estimatedTokens: z.number().int().nonnegative(),
  risk: z.enum(['low', 'medium', 'high']),
  fitsInOneWorkerBrief: z.boolean(),
  reasons: z.array(z.string()).default([]),
})
export type ContextBudgetEstimate = z.infer<typeof ContextBudgetEstimate>

export const TaskReadinessDimension = z.object({
  id: TaskReadinessDimensionId,
  status: z.enum(['ok', 'warn', 'blocked']),
  summary: z.string(),
  evidence: z.array(z.string()).default([]),
})
export type TaskReadinessDimension = z.infer<typeof TaskReadinessDimension>

export const TaskReadinessAssessment = z.object({
  taskKind: TaskKind,
  recommendation: TaskReadinessRecommendation,
  summary: z.string(),
  dimensions: z.array(TaskReadinessDimension),
  definitionOfDone: DefinitionOfDone,
  blockerPlans: z.array(IfThenBlockerPlan).default([]),
  contextBudget: ContextBudgetEstimate,
  openQuestion: z.object({
    prompt: z.string(),
    reason: z.string(),
  }).optional(),
  assessedAt: z.string(),
  assessedBy: z.string().default('coordinator-readiness'),
})
export type TaskReadinessAssessment = z.infer<typeof TaskReadinessAssessment>

export const ReviewRiskRecipe = z.object({
  recipeId: z.string(),
  version: z.string(),
  required: z.boolean().default(true),
  releaseBlocking: z.boolean().default(false),
  lanes: z.array(z.string()).default([]),
  requiredArtifacts: z.array(z.string()).default([]),
  reason: z.string(),
})
export type ReviewRiskRecipe = z.infer<typeof ReviewRiskRecipe>

export const ReviewRiskProfile = z.object({
  lanes: z.array(z.string()).default([]),
  recipes: z.array(ReviewRiskRecipe).default([]),
  requiredArtifacts: z.array(z.string()).default([]),
  artifactPolicy: z.enum(['advisory', 'required_before_review']).default('advisory'),
  assessedAt: z.string(),
  assessedBy: z.string().default('coordinator-review-planner'),
})
export type ReviewRiskProfile = z.infer<typeof ReviewRiskProfile>

export const TaskDecompositionReasonCode = z.enum([
  'too_broad',
  'unclear_outcome',
  'missing_proof_path',
  'too_much_context',
  'hidden_dependency',
  'product_judgment_required',
  'mixed_research_and_implementation',
])
export type TaskDecompositionReasonCode = z.infer<typeof TaskDecompositionReasonCode>

export const TaskDecompositionRecord = z.object({
  action: z.enum(['keep', 'ask_one_question', 'research_first', 'split', 'defer']),
  reasons: z.array(z.object({
    code: TaskDecompositionReasonCode,
    detail: z.string(),
  })).default([]),
  childDrafts: z.array(z.object({
    title: z.string(),
    kind: TaskKind,
    reason: z.string(),
    dependsOn: z.array(z.string()).default([]),
    definitionOfDone: DefinitionOfDone,
  })).default([]),
  createdAt: z.string(),
  createdBy: z.string().default('task-decomposition'),
})
export type TaskDecompositionRecord = z.infer<typeof TaskDecompositionRecord>

export const CoordinatorReflectionRecord = z.object({
  summary: z.string(),
  candidates: z.array(z.object({
    kind: z.enum(['practice', 'preference']),
    title: z.string(),
    rationale: z.string(),
    status: z.enum(['proposed', 'accepted', 'rejected']).default('proposed'),
  })).default([]),
  createdAt: z.string(),
  createdBy: z.string().default('coordinator-reflection'),
})
export type CoordinatorReflectionRecord = z.infer<typeof CoordinatorReflectionRecord>

export const RequestIntakeComponentKind = z.enum([
  'policy_decision',
  'documented_spec',
  'implementation',
  'verification',
  'data_model',
  'ui_surface',
  'api_contract',
  'release_plan',
])
export type RequestIntakeComponentKind = z.infer<typeof RequestIntakeComponentKind>

export const PressureTestDegree = z.enum(['automatic', 'guided', 'deep'])
export type PressureTestDegree = z.infer<typeof PressureTestDegree>

export const PressureTestCheck = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(['system-check', 'needs-owner-judgment']),
  reason: z.string(),
})
export type PressureTestCheck = z.infer<typeof PressureTestCheck>

export const PressureTestSummary = z.object({
  systemOwned: z.boolean(),
  degree: PressureTestDegree,
  qualityBar: z.string(),
  ownerQuestionPolicy: z.string(),
  checks: z.array(PressureTestCheck),
})
export type PressureTestSummary = z.infer<typeof PressureTestSummary>

const DEFAULT_PRESSURE_TEST_SUMMARY: PressureTestSummary = {
  systemOwned: true,
  degree: 'automatic',
  qualityBar: 'Apply enough pressure to make this task trustworthy without asking the owner to choose a process.',
  ownerQuestionPolicy: 'Only ask when the answer could change product intent, quality bar, risk tolerance, release boundary, or a tradeoff the repo cannot decide on its own.',
  checks: [
    {
      id: 'owner-intent',
      title: 'Owner intent',
      status: 'system-check',
      reason: 'Guildhall infers intent from the request and project evidence unless owner judgment would change the work.',
    },
    {
      id: 'verification',
      title: 'Verification',
      status: 'system-check',
      reason: 'Guildhall must identify how this work can be proven before implementation starts.',
    },
  ],
}

function normalizeRequestIntake(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input
  const record = input as Record<string, unknown>
  return {
    ...record,
    intent: typeof record.intent === 'string' ? record.intent : 'implementation',
    recommendedNextAction: typeof record.recommendedNextAction === 'string'
      ? record.recommendedNextAction
      : 'proceed_to_implementation_spec',
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : LEGACY_SCHEMA_TIMESTAMP,
    createdBy: typeof record.createdBy === 'string' ? record.createdBy : 'legacy-import',
  }
}

export const RequestIntake = z.preprocess(normalizeRequestIntake, z.object({
  intent: z.enum([
    'spec_only',
    'implementation',
    'ambiguous_spec_or_implementation',
    'question_or_research',
  ]),
  recommendedNextAction: z.enum([
    'ask_clarifying_question',
    'draft_spec',
    'create_linked_feature_plan',
    'proceed_to_implementation_spec',
  ]),
  ambiguity: z.string().optional(),
  componentStack: z.array(z.object({
    kind: RequestIntakeComponentKind,
    title: z.string(),
    role: z.string(),
  })).default([]),
  assumptions: z.array(z.string()).default([]),
  missingInformation: z.array(z.string()).default([]),
  ownerDecisionNeeded: z.string().optional(),
  whyOwnerDecisionMatters: z.string().optional(),
  evidenceRefs: z.array(z.string()).default([]),
  pressureTestSummary: PressureTestSummary.default(DEFAULT_PRESSURE_TEST_SUMMARY),
  clarifyingQuestions: z.array(z.string()).default([]),
  createdAt: z.string(),
  createdBy: z.string(),
}))
export type RequestIntake = z.infer<typeof RequestIntake>

export const TaskSourceClaim = z.object({
  source: z.string(),
  title: z.string(),
  evidence: z.string(),
  references: z.array(z.string()).default([]),
  role: z.enum(['capability', 'reference', 'brief_input']).optional(),
  structure: z.enum(['record', 'note']).optional(),
  scopeHint: z.enum(['current', 'later']).optional(),
  releaseId: z.string().optional(),
  releaseLabel: z.string().optional(),
  confidence: z.enum(['high', 'medium', 'low']).default('medium'),
  linkedTaskHints: z.array(z.string()).default([]),
})
export type TaskSourceClaim = z.infer<typeof TaskSourceClaim>

export const ProjectReleaseKind = z.enum(['release', 'milestone', 'marker', 'current_work'])
export type ProjectReleaseKind = z.infer<typeof ProjectReleaseKind>

export const ProjectReleaseState = z.enum(['planned', 'active', 'ready', 'shipped', 'deferred'])
export type ProjectReleaseState = z.infer<typeof ProjectReleaseState>

export const ProjectReleaseSource = z.enum(['owner_approved', 'spec', 'release_plan', 'inferred'])
export type ProjectReleaseSource = z.infer<typeof ProjectReleaseSource>

export const ProjectReleaseProofStyle = z.enum(['script_only', 'manual', 'mixed', 'unspecified'])
export type ProjectReleaseProofStyle = z.infer<typeof ProjectReleaseProofStyle>

export const ProjectRelease = z.object({
  id: z.string(),
  label: z.string(),
  kind: ProjectReleaseKind.default('release'),
  state: ProjectReleaseState.default('active'),
  source: ProjectReleaseSource.default('inferred'),
  description: z.preprocess(value => value === null ? undefined : value, z.string().optional()),
  nodeIds: z.array(z.string()).default([]),
  deferredNodeIds: z.array(z.string()).default([]),
  proofStyle: ProjectReleaseProofStyle.default('unspecified'),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
})
export type ProjectRelease = z.infer<typeof ProjectRelease>

export const Task = z.object({
  id: z.string(),
  displayKey: z.string().optional(),
  title: z.string(),
  description: z.string().default('Task'),

  // Which coordinator domain owns this task
  domain: z.string().default('general'),

  // Which project directory this task operates on (absolute path)
  projectPath: z.preprocess(
    (value) => typeof value === 'string' && value.trim().length > 0 ? value : '.',
    z.string(),
  ),

  // The user-facing New request that produced this task, when it came through
  // request routing instead of direct legacy intake.
  request: TaskRequest.optional(),
  requestIntake: RequestIntake.optional(),
  references: z.array(z.string()).default([]),
  sourceClaims: z.array(TaskSourceClaim).default([]),

  status: TaskStatus,
  priority: TaskPriority.default('normal'),

  // Set by Spec Agent before implementation begins
  spec: z.string().optional(),
  structuredSpec: StructuredSpec.optional(),
  contractSurfaceReviewPackets: z.array(ContractSurfaceReviewPacket).optional(),
  acceptanceCriteria: z.array(AcceptanceCriteria).default([]),
  acceptanceCriteriaProofState: AcceptanceCriteriaProofState.optional(),

  // Product brief: the *why* layer of a task — user job, success metric,
  // anti-patterns, rollout plan. Authored by the Spec Agent alongside the
  // technical spec; approved by the human independently of spec approval.
  productBrief: ProductBrief.optional(),

  // Scope boundaries — what this task explicitly will NOT do
  outOfScope: z.array(z.string()).default([]),

  // Task that must be done before this one can start
  dependsOn: z.array(z.string()).default([]),

  // Which agent is currently working on this
  assignedTo: z.string().nullable().optional(),

  // Running notes from all agents involved
  notes: z.array(AgentNote).default([]),

  // Gate results accumulated during gate_check phase
  gateResults: z.array(GateResult).default([]),

  // FR-26 / FR-27: append-only audit trail of reviewer verdicts. Every pass
  // through the `review` status appends one entry — `reviewerPath` records
  // whether the LLM reviewer ran or the deterministic fallback (AC-18).
  // Under fan-out, one entry per applicable persona per round.
  reviewVerdicts: z.array(ReviewVerdict).default([]),

  // Coordinator adjudication records when the `coordinator_adjudicates_on_
  // conflict` policy fires. Append-only; each entry supersedes the dissent
  // it resolves. See docs/disagreement-and-handoff.md §1.
  adjudications: z.array(AdjudicationRecord).default([]),

  // Sequential engineer handoff (§2 of docs/disagreement-and-handoff.md).
  // When set, the orchestrator picks one engineer per step instead of
  // calling `pickPrimaryEngineer`. Each step completes with a handoff note
  // that the next step's engineer reads; only the final step's completion
  // triggers the normal reviewer fan-out.
  handoffSequence: z.array(HandoffStep).optional(),
  /** Index of the currently-active step in `handoffSequence` (0-based). */
  handoffStep: z.number().int().nonnegative().optional(),

  // How many times this task has been sent back for revision
  revisionCount: z.number().default(0),

  // When a human resolves a max-revisions escalation and explicitly retries
  // the task, we preserve the historical raw `revisionCount` for audit but
  // start a fresh counting window for future auto-block decisions.
  retryWindow: z
    .object({
      startedAt: z.string(),
      baseRevisionCount: z.number().int().nonnegative(),
    })
    .optional(),

  // FR-32: count of coordinator remediation decisions recorded against this
  // task. Used as input to the *next* remediation context so the coordinator
  // can see the trend ("this is the 4th time we've been here"). Incremented
  // by the orchestrator on `recordRemediationDecision`.
  remediationAttempts: z.number().int().nonnegative().default(0),

  // If blocked: why. Some older task snapshots persisted `null`; normalize
  // that to missing so loading legacy queues does not crash a run.
  blockReason: z.preprocess(
    (value) => value == null ? undefined : value,
    z.string().optional(),
  ),
  hold: TaskHold.optional(),

  // FR-15: per-task permission mode override. When set, the orchestrator
  // tells the dispatched agent to clamp its QueryEngine permission checker to
  // this mode for the duration of the tick. May only narrow the agent's
  // baseline — never widen.
  permissionMode: TaskPermissionMode.optional(),

  // FR-10: structured escalation events. The orchestrator treats any task with
  // an unresolved escalation as halted regardless of its current status.
  escalations: z.array(Escalation).default([]),

  // FR-31: structured agent-issue events. Unlike escalations, issues do NOT
  // halt the task — the agent continues working and the coordinator decides
  // remediation on its next tick. An unresolved issue with broadcast=false
  // is pending wire-event emission; with broadcast=true it is awaiting
  // coordinator remediation.
  agentIssues: z.array(AgentIssue).default([]),

  // Escalation: if human judgment was requested, record it here
  humanJudgment: z.string().optional(),

  // FR-21: origination + proposal fields. Populated on task creation; immutable
  // afterward. `proposedBy` and `proposalRationale` are only meaningful when
  // origination === 'agent' (and status began at `proposed`).
  origination: TaskOrigination.default('human'),
  proposedBy: z.string().optional(),          // agent id that proposed the task
  proposalRationale: z.string().optional(),   // why the proposing agent thinks this is worth doing
  delivery: TaskDelivery.optional(),
  workVisibility: WorkVisibility.optional(),
  deliverySteps: z.array(DeliveryStep).optional(),
  businessEnvelope: BusinessEnvelope.optional(),
  workKind: WorkKind.optional(),
  releaseIds: z.array(z.string()).default([]),
  // Work containment is represented by hierarchy links, never by task status.
  // Required migration 0.10.0/task-hierarchy-links converts old status: parent
  // records before normal runtime paths parse task queues.
  hierarchy: WorkHierarchy.optional(),
  completionBoundary: WorkCompletionBoundary.optional(),
  taskKind: TaskKind.optional(),
  taskReadiness: TaskReadinessAssessment.optional(),
  reviewRisk: ReviewRiskProfile.optional(),
  definitionOfDone: DefinitionOfDone.optional(),
  blockerPlans: z.array(IfThenBlockerPlan).optional(),
  contextBudget: ContextBudgetEstimate.optional(),
  decomposition: TaskDecompositionRecord.optional(),
  coordinatorReflections: z.array(CoordinatorReflectionRecord).optional(),
  workUnitAnalysis: WorkUnitAnalysis.optional(),

  // Task sizing asks whether this is a good-sized unit of work for one agent
  // implementation/review loop. Large scores should be split into linked child
  // tasks rather than quietly expanding the worker's blast radius.
  sizePlan: TaskSizePlan.optional(),

  doneSummaryBundle: z
    .object({
      taskId: z.string(),
      status: z.string(),
      completedAt: z.string().optional(),
      reopenedAt: z.string().optional(),
      reopenReason: z.string().optional(),
      summary: z.object({
        journey: z.string(),
        decision: z.string(),
        evidence: z.string(),
        learningCandidates: z.array(z.string()).default([]),
        openResidue: z.string(),
      }),
      retention: z.object({
        transcriptPrimaryArtifact: z.boolean(),
        compactedFullTranscript: z.boolean(),
        fullEvidenceAvailable: z.boolean(),
      }),
      evidenceRefs: z.array(z.object({
        scope: z.string(),
        collection: z.string(),
        id: z.string(),
        path: z.string(),
        hash: z.string().optional(),
        contentType: z.string().optional(),
      })).default([]),
      createdAt: z.string(),
      createdBy: z.string(),
    })
    .optional(),

  // Proof paths and completion handoffs are public task artifacts generated by
  // the 0.9 finishability flow. Runtime owns their detailed schemas; core keeps
  // these fields permissive so older queues and UI payloads can carry them.
  proofPaths: z.array(z.union([
    ProofPath,
    z.object({}).passthrough(),
  ])).optional(),
  completionHandoff: z.union([
    CompletionHandoff,
    z.object({ id: z.string().optional(), taskId: z.string().optional() }).passthrough(),
  ]).optional(),

  // FR-22: recorded when a worker pre-rejects the task, or when the
  // orchestrator shelves a task per a policy decision (e.g. FR-21 human_only).
  //
  // `source` distinguishes the two origins so the orchestrator's
  // `pre_rejection_policy` loop only touches worker-originated shelves and
  // leaves policy-rejected proposals truly terminal.
  //
  // `policyApplied` prevents re-processing on every tick — the orchestrator
  // sets it to `true` after consulting `pre_rejection_policy`, whether the
  // decision was to keep the task shelved or to resurrect it.
  //
  // `requeueCount` tracks how many times this task has been pre-rejected and
  // requeued; the `rejection_dampening` lever reads it to decide when
  // `requeue_with_dampening` should stop requeuing and let the task stay
  // shelved as "suppressed."
  shelveReason: z.preprocess((value) => {
    if (!value || typeof value !== 'object') return value
    const sourceRecord = value as Record<string, unknown>
    const normalizedSource =
      sourceRecord.source === 'policy' ? 'proposal_policy' : sourceRecord.source
    return {
      ...sourceRecord,
      source: normalizedSource,
      detail:
        typeof sourceRecord.detail === 'string' && sourceRecord.detail.trim().length > 0
          ? sourceRecord.detail
          : 'Legacy shelve record preserved for compatibility.',
      rejectedBy:
        typeof sourceRecord.rejectedBy === 'string' && sourceRecord.rejectedBy.trim().length > 0
          ? sourceRecord.rejectedBy
          : normalizedSource === 'proposal_policy'
            ? 'system:proposal-policy'
            : 'system:legacy-shelve',
      rejectedAt:
        typeof sourceRecord.rejectedAt === 'string' && sourceRecord.rejectedAt.trim().length > 0
          ? sourceRecord.rejectedAt
          : '1970-01-01T00:00:00.000Z',
    }
  }, z
    .object({
      code: PreRejectionCode,
      detail: z.string(),
      rejectedBy: z.string(), // agent id (or `system:*`) that recorded the shelve
      rejectedAt: z.string(), // ISO timestamp
      source: z
        .enum(['worker_pre_rejection', 'proposal_policy'])
        .optional(),
      policyApplied: z.boolean().optional(),
      requeueCount: z.number().int().nonnegative().optional(),
    }))
    .optional(),

  // FR-24: set when `worktree_isolation != none` on dispatch. Persisted so
  // subsequent ticks (retries, revisions) can reuse (per_task) or rebuild
  // (per_attempt). Absent when isolation is off.
  worktreePath: z.string().optional(),
  branchName: z.string().optional(),
  baseBranch: z.string().optional(),

  // FR-25: set after the merge dispatcher runs on `done`. Records the strategy
  // taken, outcome, and any PR URL so the audit trail is complete. Exactly one
  // record per terminal merge attempt.
  mergeRecord: z
    .object({
      fromBranch: z.string(),
      toBranch: z.string(),
      strategy: z.enum([
        'cherry_pick_local',
        'cherry_pick_with_push',
        'manual_pr',
        // Deprecated compatibility values.
        'ff_only_local',
        'ff_only_with_push',
      ]),
      result: z.enum([
        'merged',
        'pushed',
        'push_failed_degraded',
        'pending_pr',
        'conflict',
        'skipped',
      ]),
      commitSha: z.string().optional(),
      prUrl: z.string().optional(),
      mergedAt: z.string(),
      detail: z.string().optional(),
    })
    .optional(),

  gitStory: z
    .object({
      override: z.enum(['local_only', 'deferred']).optional(),
      reason: z.string().optional(),
      recordedAt: z.string().optional(),
      recordedBy: z.string().optional(),
    })
    .optional(),

  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().optional(),
})
type ParsedTask = z.infer<typeof Task>
export type Task = Omit<ParsedTask, 'hierarchy' | 'releaseIds'> & {
  hierarchy?: WorkHierarchy
  releaseIds?: string[]
  /**
   * @deprecated Legacy pre-0.10 raw field. The normal Task schema no longer
   * accepts or writes task-local owner questions; use OwnerInputRequest records
   * linked to bounded-chat sessions instead.
   */
  openQuestions?: AgentQuestion[]
}

export const TaskQueue = z.object({
  version: z.number().default(1),
  lastUpdated: z.string().default(LEGACY_SCHEMA_TIMESTAMP),
  tasks: z.array(Task),
  executionPlanActions: z.array(ExecutionPlanAction).default([]),
  scopeAuthorityRequests: z.array(ScopeAuthorityRequest).default([]),
  releases: z.array(ProjectRelease).default([]),
  selectedReleaseId: z.string().optional(),
})
export type TaskQueue = Omit<z.infer<typeof TaskQueue>, 'tasks' | 'executionPlanActions' | 'scopeAuthorityRequests' | 'releases'> & {
  tasks: Task[]
  executionPlanActions?: ExecutionPlanAction[]
  scopeAuthorityRequests?: ScopeAuthorityRequest[]
  releases?: ProjectRelease[]
}
