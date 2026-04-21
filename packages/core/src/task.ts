import { z } from 'zod'

// ---------------------------------------------------------------------------
// Task status lifecycle (FR-01)
//    proposed ─┐
//    exploring ┼→ spec_review → ready → in_progress → review → gate_check → done
//              │                                                ↘ blocked
//              └─────────────────────────→ shelved (worker pre-rejection, FR-22)
//
// Origination:
//   - `exploring` — human-initiated via the Spec Agent intake (FR-12)
//   - `proposed`  — agent-initiated (FR-21); promotion path governed by lever
//                   `task_origination`
//
// Terminal states: `done`, `shelved`, `blocked`.
// ---------------------------------------------------------------------------

export const TaskStatus = z.enum([
  'proposed',      // FR-21: agent-originated; awaiting promotion per lever `task_origination`
  'exploring',     // Conversational intake — Spec Agent is building the spec with the user (FR-12)
  'spec_review',   // Spec drafted; awaiting human or coordinator approval
  'ready',         // Spec approved, ready for a worker to pick up
  'in_progress',   // Assigned to a worker agent
  'review',        // Worker done, awaiting reviewer agent
  'gate_check',    // Reviewer approved, running hard gates
  'done',          // All gates passed — terminal
  'shelved',       // FR-22: worker pre-rejected (no_op/not_viable/low_value/duplicate/spec_wrong) — terminal
  'blocked',       // Cannot proceed — escalation required — terminal
])
export type TaskStatus = z.infer<typeof TaskStatus>

export const TERMINAL_TASK_STATUSES = ['done', 'shelved', 'blocked'] as const

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

// FR-15: per-task permission mode override. Semantic ordering (narrowest →
// widest) is plan < default < full_auto. A per-task mode may only *narrow*
// the agent's baseline mode — it can never widen it. The orchestrator clamps
// at dispatch time; see GuildhallAgent.setPermissionMode for details.
export const TaskPermissionMode = z.enum(['default', 'plan', 'full_auto'])
export type TaskPermissionMode = z.infer<typeof TaskPermissionMode>

export const GateResult = z.object({
  gateId: z.string(),
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

export const Escalation = z.object({
  id: z.string(),                             // stable id, e.g. `esc-<taskId>-<n>`
  taskId: z.string(),
  agentId: z.string(),                        // Who raised it
  reason: EscalationReason,
  summary: z.string(),                        // Human-readable one-liner
  details: z.string().optional(),             // Full context for the human
  raisedAt: z.string(),                       // ISO timestamp
  resolvedAt: z.string().optional(),          // Set once resolved
  resolution: z.string().optional(),          // Human's response / decision
  resolvedBy: z.string().optional(),          // Who resolved it ('human' or agent id)
})
export type Escalation = z.infer<typeof Escalation>

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
  writtenAt: z.string(), // ISO timestamp
})
export type Checkpoint = z.infer<typeof Checkpoint>

export const AcceptanceCriteria = z.object({
  id: z.string(),
  description: z.string(),
  // How to verify: 'automated' = shell command, 'review' = reviewer agent judgment
  verifiedBy: z.enum(['automated', 'review', 'human']),
  command: z.string().optional(), // for automated criteria
  met: z.boolean().default(false),
})
export type AcceptanceCriteria = z.infer<typeof AcceptanceCriteria>

export const Task = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),

  // Which coordinator domain owns this task
  domain: z.string(),

  // Which project directory this task operates on (absolute path)
  projectPath: z.string(),

  status: TaskStatus,
  priority: TaskPriority.default('normal'),

  // Set by Spec Agent before implementation begins
  spec: z.string().optional(),
  acceptanceCriteria: z.array(AcceptanceCriteria).default([]),

  // Scope boundaries — what this task explicitly will NOT do
  outOfScope: z.array(z.string()).default([]),

  // Task that must be done before this one can start
  dependsOn: z.array(z.string()).default([]),

  // Which agent is currently working on this
  assignedTo: z.string().optional(),

  // Running notes from all agents involved
  notes: z.array(AgentNote).default([]),

  // Gate results accumulated during gate_check phase
  gateResults: z.array(GateResult).default([]),

  // How many times this task has been sent back for revision
  revisionCount: z.number().default(0),

  // FR-32: count of coordinator remediation decisions recorded against this
  // task. Used as input to the *next* remediation context so the coordinator
  // can see the trend ("this is the 4th time we've been here"). Incremented
  // by the orchestrator on `recordRemediationDecision`.
  remediationAttempts: z.number().int().nonnegative().default(0),

  // If blocked: why
  blockReason: z.string().optional(),

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
  parentGoalId: z.string().optional(),        // FR-23 business envelope — tasks carry a goalId

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
  shelveReason: z
    .object({
      code: PreRejectionCode,
      detail: z.string(),
      rejectedBy: z.string(), // agent id (or `system:*`) that recorded the shelve
      rejectedAt: z.string(), // ISO timestamp
      source: z
        .enum(['worker_pre_rejection', 'proposal_policy'])
        .default('worker_pre_rejection'),
      policyApplied: z.boolean().default(false),
      requeueCount: z.number().int().nonnegative().default(0),
    })
    .optional(),

  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().optional(),
})
export type Task = z.infer<typeof Task>

export const TaskQueue = z.object({
  version: z.number().default(1),
  lastUpdated: z.string(),
  tasks: z.array(Task),
})
export type TaskQueue = z.infer<typeof TaskQueue>
