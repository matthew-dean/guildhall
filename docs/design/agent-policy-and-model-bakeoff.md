---
title: Agent policy, learning, and model bakeoff
---

# Agent policy, learning, and model bakeoff

**Status:** proposed for `0.6.0`

Guildhall has spent the `0.5.0` cycle proving that real projects can move from
draft/spec through worker execution, review, gates, and done. The proof is
valuable, but the path exposed a pattern: too many live failures required tiny
runtime patches after the fact.

This note combines three related `0.6.0` ideas into one system:

1. **Policy runtime:** first-class failure classification, recovery playbooks,
   and typed agent decision packets.
2. **Bounded improvisation:** agents get more room to solve blockers
   creatively, but only inside evidence, scope, verification, and audit
   guardrails.
3. **Compounding learning:** Guildhall learns after each task and routes those
   learnings to the right layer: project-specific memory/skills, user/global
   expectations, or Guildhall product improvements.

The goal is not to make Guildhall looser. The goal is to make it less brittle:
more capable of finding the next safe move when reality does not match the
happy path, and more likely to preserve that lesson for the next run.

## Current Problem

The current runtime is strong at deterministic validation once the expected
path is known. It is weaker when an agent reaches a decision point that is
obvious to a human but underspecified to the runtime.

Recent examples include:

- worker-authored type/import failures being escalated as human ambiguity
- stale `oldString` edits requiring a focused reread
- clean `exit 0` verification being treated as warning work
- reviewer fan-out producing infrastructure-noise dissent
- dirty checkout blockers surfacing as raw setup strings
- imported drafts needing human shaping before they become runnable work

Most of these are not fundamentally separate product concepts. They are
instances of a smaller set of decision-point classes.

The current failure mode is also non-compounding. Guildhall often survives a
specific blocker after a patch, but the next project still has to rediscover
adjacent truths. Good local lessons should become project memory or project
skills. Good broad lessons should become Guildhall system behavior. Those two
paths should stay separate.

## Product Thesis

Guildhall should run a "do, learn, improve" loop after meaningful work:

1. **Do:** complete the task, recover from bounded blockers, and produce an
   inspectable outcome.
2. **Learn:** reflect on what went well, what failed, what was specific to the
   project, and what generalizes.
3. **Improve:** persist the right improvement in the right place so future
   runs start smarter.

The Hermes Agent pattern is useful here: task execution followed by reflection,
memory, and reusable skill capture. Guildhall should go beyond that by making
the coordinator responsible for deciding where each improvement belongs:

- **Project improvement:** specific to this repository, workspace, task family,
  commands, domain, or workflow.
- **System improvement:** useful for the user across projects, or useful as a
  Guildhall product default.

That routing decision is the center of the `0.6.0` design.

## 0.5.x Track: Decision-Point Unblockers

This is table-stakes product behavior, not future architecture.

Guildhall should not dead-end when it already has enough evidence to make a
bounded recovery move. The near-term release line should keep adding targeted
fixes only when they satisfy one of these categories.

### 1. Honest Human Stops

A stop is acceptable only when the next human action is visible and concrete.

Required behavior:

- Thread names the actual blocker.
- The card says what the user can do next.
- The run status does not imply hidden activity.
- Draft/import queues stop as `awaiting_human`, not as fake paused work.

### 2. Self-Authored Repair

If verification fails in files the worker touched, Guildhall should keep the
worker in repair mode instead of asking the user to adjudicate.

Examples:

- missing local import
- duplicate helper
- type error in authored expression
- stale edit target after a failed `oldString`

### 3. Verification-Backed Continuation

When a task has durable verification evidence, recovery prompts should preserve
that evidence as the primary frame.

Required state:

- last authoritative command
- pass/fail result
- failing output excerpt
- touched files
- current working hypothesis
- safe next mutation surface

### 4. Review/Gate Audit Closure

If review advances a task despite advisory or procedural dissent, the audit
trail must record the advancing decision. A `done` task cannot leave the latest
review story looking like an unresolved `revise`.

### 5. Dirty Checkout Recovery

Dirty checkout states must be productized:

- if Guildhall created the dirty state, package it into a task branch when safe
- if the dirty state is outside Guildhall ownership, ask for commit/stash with
  a clear repo name
- never surface only a raw git/worktree setup string

## 0.6.0 Scope

`0.6.0` should make the above behavior systematic.

### In Scope

- failure and blocker classifier
- typed recovery playbooks
- bounded improvisation policy
- post-task reflection packets
- project learning records
- project skill proposals
- user/global learning records
- Guildhall product suggestion records
- coordinator routing rules for learning placement
- inspection and reset/approval surfaces for learned behavior
- replay harness for model and policy evaluation
- release acceptance criteria proving the system improves future runs

### Out of Scope

- unreviewed self-modifying code
- silent global defaults learned from one project
- arbitrary agent autonomy without typed policy bounds
- replacing human review for high-impact decisions
- full marketplace-style skill publishing
- full long-term session search database in `0.6.0`
- automatic PR creation for product suggestions without user approval

## Core Concepts

### Bounded Improvisation

Agents should have permission to solve blockers creatively when deterministic
instructions are too narrow. That permission is bounded by a simple contract:

1. classify the blocker
2. name the evidence
3. choose one safe recovery playbook or ask the coordinator to choose
4. execute the smallest useful move
5. verify the move
6. emit an audit packet
7. propose a learning only if the lesson is durable

Improvisation is not:

- broad refactoring because the agent is stuck
- changing product scope without approval
- inventing new commands when authoritative commands exist
- looping through read-only exploration after the safe next file is known
- promoting one-off project quirks into global behavior

### Compounding Learning

Guildhall should learn from ordinary work, not from a separate training ritual.

Learning signals can come from:

- completed tasks
- blocked tasks
- false human escalations
- repeated user corrections
- reviewer/gate failures
- successful recovery playbooks
- repeated command or setup discoveries
- model lane failures or wins
- project-specific workflow patterns

Each learning must carry evidence, confidence, scope, and an owner.

### Project Improvement

Project improvements stay with the workspace or repository.

Examples:

- "For this Nuxt project, tests live under `web/tests`, not repo-root `tests`."
- "Use `cd web && pnpm typecheck` as the focused type gate for app changes."
- "Ignore `.guildhall/` bookkeeping when judging subrepo cleanliness."
- "This project prefers source-by-source import review."
- "The auth area needs the security reviewer before approval."

Project improvements can become:

- project memory records
- project policy settings
- project skill files
- coordinator concern refinements
- setup/bootstrap hints
- reusable verification command hints

### System Improvement

System improvements apply beyond the current project.

Examples:

- "When a worker authored a failing import, route to self-authored repair
  before asking the human."
- "When a user repeatedly asks for less implementation trivia, suppress
  component names in public docs by default."
- "When reviewers time out, mark it as infrastructure noise instead of a
  substantive rejection."
- "The worker lane needs a stronger tool-use model for edit-heavy tasks."

System improvements can become:

- user/global preference records
- Guildhall product suggestion records
- model lane recommendations
- default playbook changes
- release backlog items
- built-in skill candidates

### Coordinator Routing

The coordinator owns the routing decision after each reflection:

| Question | Destination |
| --- | --- |
| Is this only true for the current repo or workspace? | Project memory or project skill |
| Is this about how this user expects Guildhall to behave? | User/global preference |
| Is this a repeated product failure Guildhall should fix for everyone? | Product suggestion |
| Is this repeatable task logic with clear triggers and steps? | Skill proposal |
| Is this just a one-off observation? | Task audit only |
| Would applying this automatically increase risk? | Suggested record awaiting approval |

The coordinator must err toward narrower scope. Promotion from project to
system should require repeated evidence or explicit human approval.

## Policy Runtime Spec

### Failure Classifier

Introduce a structured classifier over agent failures and blocked states.

Initial classes:

- `self_authored_verification_failure`
- `stale_context`
- `missing_target_evidence`
- `environment_unavailable`
- `provider_unavailable`
- `human_product_decision`
- `reviewer_infrastructure_noise`
- `dirty_checkout_owned`
- `dirty_checkout_external`
- `authoritative_command_unknown`
- `scope_boundary_unclear`
- `model_tool_use_failure`
- `review_packet_insufficient`

Classifier inputs:

- task status and block reason
- latest checkpoint
- latest verification results
- touched files and diff scope
- recent tool calls
- reviewer verdicts
- gate-check output
- project policy
- resolved human decisions
- model/provider metadata

Classifier output:

```ts
type FailureClassification = {
  class: FailureClass
  confidence: 'low' | 'medium' | 'high'
  evidence: EvidenceRef[]
  scope: 'task' | 'project' | 'system'
  safePlaybooks: RecoveryPlaybookId[]
  needsHuman: boolean
  humanQuestion?: string
}
```

Acceptance criteria:

- Every blocked or no-progress worker path produces a classification before
  changing task state.
- Low-confidence classifications can only choose non-mutating playbooks or
  escalate with a concrete question.
- The classification is stored with the task event/audit trail.
- The UI can display a human-readable reason without exposing raw internals.

### Recovery Playbooks

Each class maps to bounded recovery playbooks.

Initial playbooks:

- `reread_focused_file`
- `rerun_authoritative_command`
- `repair_touched_file_failure`
- `refresh_stale_edit_target`
- `resume_from_checkpoint`
- `rebootstrap_project`
- `package_owned_dirty_work`
- `ask_concrete_human_question`
- `route_to_review`
- `route_to_gate_check`
- `stop_with_external_setup_action`

Playbook output:

```ts
type RecoveryPlan = {
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
```

Acceptance criteria:

- A playbook always states allowed tools, path bounds, and stop conditions.
- A playbook cannot broaden task scope unless the coordinator records an
  approved scope decision.
- A failed playbook either tries one narrower follow-up or raises a concrete
  escalation. It does not silently loop.
- Successful playbooks produce reflection input for the learning loop.

### Typed Agent Outputs

Agents should return typed packets for decision points instead of prose-only
justification.

Useful packet fields:

```ts
type AgentDecisionPacket = {
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
```

Acceptance criteria:

- Worker review handoff includes an `AgentDecisionPacket`.
- Review and gate-check stages can inspect the packet without asking the worker
  to restate its diff.
- A missing packet blocks review handoff unless deterministic evidence is
  sufficient to synthesize one.
- Packets are compact enough for future agents to read without replaying the
  whole transcript.

## Learning Runtime Spec

### Reflection Trigger

Run a reflection pass after:

- task reaches `done`
- task reaches `blocked`
- recovery playbook succeeds
- recovery playbook fails twice
- user rejects or corrects a Guildhall proposal
- coordinator records an adjudication decision
- model lane produces a tool-use/schema failure

The reflection pass should be cheap and mostly deterministic at first. It can
use a model only for summarizing candidate learnings into structured records.

### Learning Candidate

```ts
type LearningCandidate = {
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
  confidence: 'low' | 'medium' | 'high'
  risk: 'low' | 'medium' | 'high'
  requiresApproval: boolean
}
```

### Project Memory Record

```ts
type ProjectLearningRecord = {
  id: string
  projectId: string
  kind:
    | 'command'
    | 'path'
    | 'setup'
    | 'workflow'
    | 'review_policy'
    | 'domain_fact'
  summary: string
  appliesWhen: string[]
  evidence: EvidenceRef[]
  confidence: 'low' | 'medium' | 'high'
  status: 'suggested' | 'active' | 'dismissed'
  createdAt: string
  updatedAt: string
}
```

Acceptance criteria:

- Project learnings are inspectable in project settings.
- Project learnings can be reset or dismissed.
- Active project learnings are included in future coordinator/worker context
  only when their `appliesWhen` triggers match the current task.
- A project learning cannot automatically become a global learning.

### Project Skill Proposal

```ts
type ProjectSkillProposal = {
  id: string
  projectId: string
  name: string
  trigger: string
  steps: string[]
  evidence: EvidenceRef[]
  confidence: 'medium' | 'high'
  status: 'suggested' | 'active' | 'dismissed'
  writesFiles: boolean
  requiresApproval: boolean
}
```

Acceptance criteria:

- Skill proposals are created only for repeatable logic, not one-off facts.
- A proposed skill includes trigger, steps, and evidence.
- Activating a skill is explicit unless the skill is low-risk and project-only.
- Project skills are stored with the project, not silently installed globally.

### User/Global Preference Record

```ts
type UserLearningRecord = {
  id: string
  kind: 'style' | 'workflow' | 'approval' | 'evidence' | 'risk_tolerance'
  summary: string
  appliesAcrossProjects: boolean
  evidence: EvidenceRef[]
  confidence: 'low' | 'medium' | 'high'
  status: 'suggested' | 'active' | 'dismissed'
}
```

Acceptance criteria:

- User/global preferences require repeated evidence or explicit approval.
- They are visible outside a single project.
- They influence prompts and UI defaults without hiding the reason.
- The user can reset them.

### Guildhall Product Suggestion

```ts
type ProductSuggestionRecord = {
  id: string
  area: 'runtime' | 'ui' | 'docs' | 'providers' | 'skills' | 'review' | 'planning'
  problem: string
  evidence: EvidenceRef[]
  proposedChange: string
  affectedProjects: string[]
  severity: 'low' | 'medium' | 'high'
  status: 'draft' | 'accepted' | 'dismissed' | 'submitted'
}
```

Acceptance criteria:

- Product suggestions do not change runtime behavior by themselves.
- They can be exported or converted into a GitHub issue only after human
  approval.
- Suggestions include evidence and affected surfaces.
- The builder-facing view can group repeated suggestions by product area.

## Guardrails

### Quality Guardrails

- Keep autonomous moves scoped to the task and active playbook.
- Preserve authoritative verification evidence across recovery and reflection.
- Require approval before increasing autonomy or globalizing a behavior.
- Make every learned behavior inspectable and reversible.
- Record why a learning was applied on a later run.
- Prefer deterministic classification where confidence is high.
- Use model classification only when schema repair or ambiguity needs it.

### Anti-Patterns

- Do not add a giant everyday settings dashboard.
- Do not let every task produce a new skill file.
- Do not let project facts pollute global user behavior.
- Do not let user style preferences rewrite project policy.
- Do not let product suggestions masquerade as active product behavior.
- Do not let reflection reopen completed work unless it found a concrete
  regression.

## Model Bakeoff

Model choice should be measured against Guildhall-shaped work, not vibes.

DeepInfra cost matters here. A model like `Qwen/Qwen3.6-35B-A3B` can be
reasonable per input token but expensive across output-heavy recovery loops.
Guildhall should learn which model belongs in each lane.

### Candidate Lanes

- **Spec/intake:** cheap long-context model with good summarization
- **Schema repair/classification:** very cheap small model
- **Worker:** strongest tool-use/code model that passes replay tasks
- **Reviewer:** cheap model plus deterministic fallback
- **Coordinator:** stronger model only for real adjudication
- **Gate checker:** deterministic first, model only for malformed summaries
- **Reflection:** cheap summarizer/classifier with strict schema validation

### Replay Set

Start with the historical failures from the `0.5.0` flow audit:

- imported draft shaping into a runnable task
- dirty checkout before worktree creation
- failed typecheck in touched files
- stale `oldString`
- warning-only `exit 0`
- reviewer fan-out infrastructure noise
- no-tool worker turn after checkpoint
- draft queue awaiting human shaping
- false source-file escalation after test-only progress
- post-handoff empty reviewer turn
- model tool call with missing mutation fields
- repeated read-only turns after exact target discovery

Each model run should record:

- task outcome
- tool count
- false human escalations
- false approvals
- wall time
- input/output tokens
- estimated cost
- successful playbooks
- failed playbooks
- learning candidates emitted
- final audit packet quality

Acceptance criteria:

- A model lane recommendation is based on replay evidence, not preference.
- Costs are measured per completed task and per recovery loop.
- The bakeoff can compare deterministic fallback plus cheap model against a
  stronger model doing the full lane.
- Failed model runs become product suggestions or lane recommendations, not
  silent anecdotes.

## Implementation Plan

### Phase 1: Policy Schema and Audit Packets

Goal: make decision points typed before changing behavior.

Files likely touched:

- `src/runtime/orchestrator.ts`
- `src/runtime/run-query.ts`
- `src/runtime/context-builder.ts`
- `src/runtime/learning.ts`
- `src/agents/worker-agent.ts`
- `src/agents/coordinator-agent.ts`
- `src/agents/reviewer-agent.ts`
- `src/agents/gate-checker-agent.ts`
- `src/runtime/__tests__/orchestrator.test.ts`
- `src/runtime/__tests__/learning.test.ts`

Todos:

- [x] Add `FailureClass`, `FailureClassification`, `RecoveryPlan`,
  `AgentDecisionPacket`, and `LearningCandidate` types.
- [x] Add fixture builders for command evidence, touched files, review verdicts,
  and checkpoint evidence.
- [x] Add failing tests for self-authored verification failure classification.
- [x] Add failing tests for stale edit target classification after
  `oldString was not found`.
- [x] Add failing tests for reviewer infrastructure-noise classification.
- [x] Add minimal deterministic classifier implementation.
- [x] Store classification output in task audit/progress metadata.
- [x] Render a compact classification reason in Thread/blocker summaries.
- [x] Ensure existing review handoff tests still pass with synthesized packets.

Acceptance criteria:

- Existing deterministic recovery paths still behave the same.
- New classification metadata appears in tests for at least three failure
  classes.
- No user-facing text shows raw schema names unless the surface is diagnostic.
- Review handoff has a packet or a deterministic packet synthesis path.

### Phase 2: Bounded Recovery Playbooks

Goal: replace scattered one-off recovery rules with explicit playbooks.

Files likely touched:

- `src/runtime/orchestrator.ts`
- `src/runtime/run-query.ts`
- `src/engine/run-query.ts`
- `src/engine/tool-carryover.ts`
- `src/runtime/__tests__/orchestrator.test.ts`
- `src/runtime/__tests__/run-query.test.ts`

Todos:

- [x] Add the `RecoveryPlaybookId` enum and `RecoveryPlan` resolver.
- [x] Move focused reread behavior into `reread_focused_file`.
- [x] Move stale edit recovery into `refresh_stale_edit_target`.
- [x] Move failed touched-file verification repair into
  `repair_touched_file_failure`.
- [x] Move checkpoint continuation into `resume_from_checkpoint`.
- [x] Move dirty checkout ownership handling into `package_owned_dirty_work`
  and `stop_with_external_setup_action`.
- [x] Add a per-playbook max-turn counter.
- [x] Add stop-signal handling so a failed playbook cannot loop silently.
- [x] Add audit entries whenever a playbook starts, succeeds, or fails.

Acceptance criteria:

- A worker cannot do broad read-only exploration while a focused playbook is
  active.
- A playbook failure either picks one narrower follow-up or raises a concrete
  human question.
- Thread can explain which recovery path Guildhall is trying.
- Existing 0.5.x regression tests for recovery lanes still pass.

### Phase 3: Reflection and Learning Candidate Routing

Goal: collect useful lessons after real work and route them to the right layer.

Files likely touched:

- `src/runtime/learning.ts`
- `src/runtime/orchestrator.ts`
- `src/runtime/serve.ts`
- `src/tools/agent-settings-tool.ts`
- `src/agents/coordinator-agent.ts`
- `src/runtime/__tests__/learning.test.ts`
- `src/runtime/__tests__/serve-settings.test.ts`

Todos:

- [x] Add reflection trigger points for done, blocked, playbook success,
  playbook failure, user correction, and model lane failure.
- [x] Add `LearningCandidate` persistence as suggested records.
- [x] Add coordinator routing rules for `project_memory`, `project_skill`,
  `user_preference`, `product_suggestion`, and `task_audit_only`.
- [x] Add tests proving project-only path facts stay project-scoped.
- [x] Add tests proving repeated user style corrections can become a suggested
  user/global preference.
- [x] Add tests proving product suggestions do not change runtime behavior.
- [x] Add confidence and approval rules.
- [x] Add reset/dismiss support for suggested learnings.

Acceptance criteria:

- A completed task can produce zero or more learning candidates without making
  the UI noisy.
- Project-specific facts never become global without repeated evidence or
  explicit approval.
- Product suggestions are inert until accepted/submitted by a human.
- Learning records include evidence and can be inspected.

### Phase 4: Project Skills and Project Policy Application

Goal: make repeatable project lessons executable without polluting global skill
state.

Files likely touched:

- `src/skills/index.ts`
- `src/skills/project-skills.ts`
- `src/config/resolve.ts`
- `src/config/schemas.ts`
- `src/runtime/context-builder.ts`
- `src/skills/__tests__/skills.test.ts`
- `src/runtime/__tests__/context-builder.test.ts`
- `src/config/__tests__/schemas.test.ts`

Project skills are project-scoped procedural memory, not global assistant
skills. Global skills describe durable ways Guildhall should help the user or
operate across workspaces; project skills capture repeatable task logic that is
only valid inside one workspace's memory directory. They remain suggested until
activated, can be dismissed, and enter worker context only when the workspace
explicitly enables project-local skills and the current task matches their
trigger keywords.

Todos:

- [x] Define the project skill proposal schema.
- [x] Add project-local skill loading behind an explicit project setting.
- [x] Add trigger matching so project skills enter context only when relevant.
- [x] Add approval flow for activating suggested project skills.
- [x] Add tests proving project skills do not load globally.
- [x] Add tests proving dismissed skills stay dismissed.
- [x] Add context-builder tests for relevant project skill injection.
- [x] Add docs text explaining project skills versus global skills.

Acceptance criteria:

- Project skills are inspectable, trigger-scoped, and reversible.
- Activating a project skill requires approval unless the risk is low and the
  scope is project-only.
- A project skill cannot affect a different workspace.
- The worker sees only relevant project skills, not the whole project memory.

### Phase 5: User and Builder Inspection Surfaces

Goal: make learning visible without turning the main workflow into settings.

Files likely touched:

- `src/runtime/serve.ts`
- `src/web/surfaces/project/SettingsTab.svelte`
- `src/web/surfaces/ProjectView.svelte`
- `src/runtime/__tests__/serve-settings.test.ts`
- `docs/reference/agent-settings.md`
- `docs/reference/http-api.md`
- `docs/reference/memory-layout.md`

Todos:

- [x] Add API endpoints for listing project learnings, user preferences, skill
  proposals, and product suggestions.
- [x] Add actions for accept, dismiss, reset, and make-project-wide where
  applicable.
- [x] Add a quiet project settings section for active/suggested learnings.
- [x] Add a builder-facing diagnostic view for product suggestions.
- [x] Add UI copy that explains learned behavior in product terms.
- [x] Add endpoint tests for each mutation.
- [x] Add docs for where records live and how to reset them.

Acceptance criteria:

- Normal task flow does not gain a new noisy approval step for every learning.
- The user can inspect why Guildhall changed a default.
- The user can undo learned behavior.
- Product suggestions are visible to builders but do not distract normal
  project operation.

### Phase 6: Model Bakeoff Harness

Goal: measure policy/runtime behavior and model lane quality with replayable
evidence.

Files likely touched:

- `src/runtime/model-bakeoff.ts`
- `src/runtime/__tests__/model-bakeoff.test.ts`
- `scripts/`
- `docs/design/agent-policy-and-model-bakeoff.md`

Todos:

- [ ] Define replay scenario metadata.
- [ ] Add replay fixtures for the historical 0.5.0 failure set.
- [ ] Record outcome, tool count, cost, false escalations, false approvals,
  playbook success, and packet quality.
- [ ] Add a deterministic baseline lane.
- [ ] Add CLI or script entrypoint for running bakeoff scenarios.
- [ ] Add report output grouped by lane.
- [ ] Add tests for report aggregation.

Acceptance criteria:

- A model recommendation references replay results.
- The harness can compare at least two model configurations plus deterministic
  fallback.
- Failed replay runs become structured evidence for product suggestions or
  model lane recommendations.
- Cost is visible per completed task and per recovery loop.

### Phase 7: End-to-End Proof on a Real Project

Goal: prove the loop compounds on a real Guildhall workflow.

Target project:

- `/Users/matthew/git/oss/looma-knit` unless the active test project changes

Proof steps:

- [ ] Run a task that hits a known recoverable blocker.
- [ ] Confirm Guildhall classifies the blocker.
- [ ] Confirm Guildhall chooses a bounded playbook.
- [ ] Confirm the agent repairs or stops with a concrete human question.
- [ ] Complete or intentionally block the task.
- [ ] Confirm reflection emits the right learning candidate.
- [ ] Confirm the coordinator routes it to project memory, project skill,
  user/global preference, product suggestion, or task audit only.
- [ ] Confirm a future run uses the approved project learning or skill.
- [ ] Confirm the user can inspect and reset the learning.
- [ ] Record the result in `docs/web-ui/flow-audit.md`.

Acceptance criteria:

- At least one project-specific learning improves a later run in the same
  project.
- At least one product suggestion is created without changing behavior
  automatically.
- A future agent can understand the proof from the flow audit without reading
  the full chat transcript.
- The main UI remains calmer than a raw transcript or giant settings surface.

## Release Acceptance Criteria

`0.6.0` can claim this feature when:

- [ ] every worker blocked/no-progress transition has a failure classification
- [ ] at least five recovery paths are implemented as named playbooks
- [ ] review handoff includes a typed decision packet
- [ ] done/blocked/playbook outcomes can trigger reflection
- [ ] coordinator routing separates project, user/global, and product learnings
- [ ] project learning records can be inspected, accepted/dismissed, and reset
- [ ] project skill proposals are trigger-scoped and project-local
- [ ] product suggestions are inert until approved
- [ ] model bakeoff reports include cost, outcome, false escalations, and
  packet quality
- [ ] a real project proof shows a learning improving a future run
- [ ] docs explain the difference between bounded improvisation and unbounded
  autonomy

## Decision

Do not hold `0.5.x` for the full policy and learning runtime. Do hold each
release for decision points that still dead-end the current product.

The split is:

- `0.5.x`: fix known decision-point dead ends as product bugs.
- `0.6.0`: build classifier, playbooks, typed packets, bounded improvisation,
  reflection, project/system learning routing, and model bakeoff so future
  failures become evidence for policy improvement instead of another bespoke
  guard.
