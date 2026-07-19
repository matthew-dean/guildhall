# Guildhall 0.11.0 Iterative Work Campaigns

**Status:** Proposed 0.11.0 internal spec
**Date:** 2026-06-06
**Audience:** Guildhall runtime, task lifecycle, project graph, review, memory,
and UI implementation work
**Related:** `SPEC.md`,
`internal/plans/archive/2026-06-01-guildhall-0-10-state-machines-project-graph.md`,
`internal/plans/archive/specs/2026-06-05-guildhall-0-10-primitives-and-delivery-spine.md`,
`internal/plans/archive/specs/2026-05-29-guildhall-0-10-structural-domain-intelligence.md`,
`internal/specs/2026-06-03-guildhall-0-11-deterministic-code-quality-signals.md`,
`internal/specs/2026-05-28-guildhall-0-10-agent-memory-bridge.md`,
`internal/plans/archive/2026-06-02-guildhall-0-11-implementation-tracker.md`

## Problem

Guildhall can already run work through a visible task lifecycle. It can loop
ticks, choose the next task, stop after one task, promote agent-proposed tasks,
split oversized work, run review and gates, and record durable evidence.

What it does not yet have is a first-class way to represent a repeated
improvement campaign:

1. choose one bounded experiment or refactor target;
2. run it as a normal Guildhall task;
3. compare the outcome against an evidence frontier;
4. keep, reshape, revert, or shelve the result;
5. create the next task from the outcome, backlog, or live findings;
6. repeat until a fixed stopping condition is reached.

Without a campaign primitive, this work falls back to a hand-maintained
`HANDOFF.md`, a long chat, or an implicit human loop. That can work for expert
operators, but it hides exactly the structure Guildhall is supposed to make
inspectable: what is the campaign trying to improve, what evidence counts, what
has already failed, why is the next task the next task, and when should the
system stop?

Jess core architecture work is the concrete fixture. Jess uses
`docs/future/core-architecture/HANDOFF.md` and related files to run
benchmark-leashed aggressive cutting: state one hypothesis, make one small
behavior-preserving cut, run focused tests and gates, measure the same
benchmark/profile before and after, keep or revert based on evidence, update
the tracker, then choose the next target. That pattern should become a
Guildhall-native campaign, not a bespoke markdown ritual.

## Product Goal

For 0.11.0, Guildhall should support **iterative work campaigns**: bounded,
evidence-driven loops that repeatedly create and complete normal Guildhall
tasks under explicit stop conditions.

The owner should be able to say:

> "Spend up to 10 attempts or 2 hours improving Less render performance. Use
> this benchmark and this handoff/backlog. Keep only patches that improve real
> runtime or reduce measured memory/object pressure without slowing runtime.
> Record failed experiments, then pick the next best target."

Guildhall should turn that into an inspectable campaign with a task queue,
selection policy, evidence frontier, run budget, acceptance policy, and final
summary.

## Existing Guildhall Substrate

This feature should compose with the existing system instead of replacing it.

### Orchestrator Run Loop

`Orchestrator.run()` already loops `tick()` until one of several stop reasons:
all terminal, awaiting human, blocked-only, dependency-blocked, idle limit, stop
requested, stop marker, max ticks, or one task. It also supports:

- `maxTicks`, which limits scheduler ticks;
- `stopAfterOneTask`, which runs one selected unit of work;
- `preferredTaskId`, which scopes the run to a selected task and its child
  closure;
- continuous mode in the service supervisor.

This is a scheduler loop, not yet a campaign loop. It answers "keep driving
the queue" but not "generate the next experiment from evidence until the
campaign budget is exhausted."

### Task Lifecycle

Guildhall already has the lifecycle needed for each iteration:

```text
proposed -> exploring -> spec_review -> ready -> in_progress -> review -> gate_check -> done
```

Terminal states are `done`, `shelved`, and `blocked`. Revisions are bounded by
`max_revisions`. Work that discovers the plan was wrong can use change orders,
follow-up tasks, normal revision, or shelving rather than erasing history.

Campaign iterations should be normal tasks. They should not be a parallel,
special-purpose job type that bypasses review, gates, memory, or owner-visible
state.

### Agent-Originated Tasks

`propose-task` already creates `proposed` tasks with `origination: agent`,
`proposedBy`, `proposalRationale`, and a business envelope. Promotion is
governed by the domain `task_origination` lever:

- `human_only`: reject/shelve agent proposals;
- `agent_proposed_human_approved`: route proposal to human review;
- `agent_proposed_coordinator_approved`: route proposal to coordinator review;
- `agent_autonomous`: promote proposal to `ready`.

Campaigns need a narrower, campaign-scoped form of agent origination: an
iteration planner may propose the next task, but only inside the campaign's
objective, evidence policy, and budget.

### Task Decomposition And Child Closure

Guildhall can already split oversized work into parent/child tasks and run a
selected task through linked child work. A campaign should use this for known
queues and parent objectives:

- the campaign itself is a containing work item;
- each experiment/refactor pass is a child task;
- child task completion may unlock later child tasks;
- selected one-task runs can keep driving linked child closure when appropriate.

This is useful for a finite backlog, but a campaign also needs dynamic
generation after each child completes.

### Run Automation

Run automation can answer scoped questions, repair spec approval inputs,
approve eligible specs, resolve automation-compatible blockers, and record
improvement/design review notes when `run_automation` is fully automated.

Campaigns should not silently widen this. They need explicit automation
authority:

- can the campaign create the next iteration automatically?
- can it approve the next iteration automatically?
- can it keep or revert code automatically?
- can it spend tokens/time after negative results?
- which blockers must stop the campaign for owner review?

### Review, Gates, And Deterministic Quality

Campaign iterations should use existing review/gate machinery. Performance and
refactor campaigns additionally need comparison gates:

- focused correctness tests;
- baseline or changed-scope verification;
- benchmark/profile before/after evidence;
- deterministic quality findings;
- patch-shape rules such as "do not add broader machinery to delete one node."

The 0.11 deterministic code-quality signal lane should feed campaign
selection, not just task review.

## What Iterative Projects Need

Projects that improve through experimentation have needs that ordinary
single-task automation does not cover.

### Evidence Frontier

The project needs a current frontier: the best known measured state, the
accepted target metric, the last stable baseline, and the rejected experiments.

For performance work, this might include:

- benchmark command;
- profile command;
- baseline commit;
- median/p95 wall time;
- memory/object pressure;
- sample hot paths;
- acceptable noise threshold;
- known environmental caveats.

For refactoring work, this might include:

- node/family tracker;
- behavior fixtures;
- object-creation audit;
- public API guard;
- forbidden patch shapes;
- remaining debt list;
- proof that a removed abstraction stayed removed.

For product quality work, this might include:

- design-system finding trends;
- review miss classes;
- fixture pass rates;
- route/browser proof gaps;
- owner-facing confusion reports.

The frontier must be durable and update only when evidence supports it. A
campaign should never claim improvement from a single optimistic sample unless
the evidence policy says that is enough.

### Hypothesis Discipline

Each iteration needs a hypothesis before edits:

```text
Changing X should improve Y because Z evidence shows X is hot/expensive/wrong.
```

The hypothesis should appear in the task spec, worker context, and final
evidence record. This is what prevents an "optimization campaign" from becoming
ambient code churn.

### Keep, Revert, Reshape, Shelve

Experimentation is allowed to fail. A campaign needs explicit outcome states:

- `kept`: patch met evidence and normal task gates;
- `kept_without_speed_claim`: patch improved structure/correctness but did not
  prove a speed win;
- `reverted`: patch failed evidence or worsened runtime;
- `reshaped`: patch found a better smaller task or correctness blocker;
- `shelved`: idea was low-value, duplicate, not viable, or outside scope;
- `blocked_for_owner`: continuation requires human judgment.

These are campaign iteration outcomes, not replacements for task statuses.
The task may end `done` after reverting and recording a negative result if the
iteration's actual job was "test this hypothesis honestly."

### Next-Task Selection

The next task can come from several sources:

- an explicit backlog or tracker;
- benchmark/profile hot paths;
- deterministic findings;
- reviewer follow-up ideas;
- worker self-critique;
- failed experiment notes;
- owner-supplied goals;
- project graph dependencies;
- external issue/task authority.

The campaign must rank candidates and explain why the selected next task won.
Candidate ranking should consider:

- expected impact;
- evidence confidence;
- blast radius;
- dependency order;
- novelty vs repeated failure;
- verification cost;
- fit within remaining budget;
- whether a prior experiment already rejected the same shape.

### Stop Conditions

Campaigns need stop conditions more meaningful than scheduler ticks.

Required stop condition types:

- `maxIterations`: number of completed iteration tasks;
- `maxWallClockMinutes`: elapsed wall-clock time;
- `maxTokenBudget`: aggregate model usage if available;
- `maxCostBudget`: provider-cost cap when pricing is known;
- `maxConsecutiveNegativeIterations`: stop after repeated no-win or reverted
  attempts;
- `targetReached`: measured metric hits a goal;
- `frontierStalled`: candidate selector cannot find a viable next task above a
  configured value threshold;
- `blocker`: a task blocks, asks a non-delegable question, or hits
  max revisions;
- `ownerStop`: explicit pause/stop marker.

The first 0.11 slice should support `maxIterations`, `maxWallClockMinutes`,
`maxConsecutiveNegativeIterations`, `blocker`, and `ownerStop`. Cost and token
budgets can use run summaries when available, but should not be the only
supported control.

### Memory And Negative Results

Negative results are part of the value. Campaign memory should preserve:

- tried hypothesis;
- patch shape;
- evidence commands;
- measured result;
- why it was reverted or kept;
- deletion/cleanup conditions;
- whether to retry later after another prerequisite lands.

This protects future agents from repeating failed experiments as if they were
new ideas. It also gives the owner a high-signal campaign summary.

## Proposed Model

### Campaign

```ts
type Campaign = {
  id: string
  title: string
  objective: string
  projectPath: string
  domain: string
  status: 'draft' | 'ready' | 'running' | 'paused' | 'complete' | 'blocked' | 'shelved'
  createdAt: string
  updatedAt: string
  ownerIntent: string
  rootTaskId?: string
  sourceRefs: CampaignSourceRef[]
  strategy: CampaignStrategy
  evidencePolicy: CampaignEvidencePolicy
  selectionPolicy: CampaignSelectionPolicy
  automationPolicy: CampaignAutomationPolicy
  stopPolicy: CampaignStopPolicy
  frontier: CampaignFrontier
  iterationIds: string[]
  summary?: CampaignSummary
}
```

Campaign state should live in system-local Guildhall state, not inside target
repos by default. Target repos may contain their own handoff/tracker files, but
Guildhall should reference them rather than assuming ownership.

### Campaign Source Reference

```ts
type CampaignSourceRef =
  | { kind: 'handoff_doc'; path: string; role: 'active_queue' | 'evidence_history' | 'patch_rules' }
  | { kind: 'tracker_doc'; path: string; role: 'candidate_backlog' | 'completion_matrix' }
  | { kind: 'benchmark'; command: string; role: 'before_after' | 'frontier' }
  | { kind: 'test_command'; command: string; role: 'focused' | 'baseline' | 'gate' }
  | { kind: 'deterministic_finding_query'; queryId: string; role: 'candidate_source' }
  | { kind: 'external_authority'; authorityId: string; role: 'issue_source' | 'status_sink' }
```

Jess example:

- `docs/future/core-architecture/HANDOFF.md`: active lane and gates;
- `AGGRESSIVE-CUTTING-REVIEW.md`: patch-shape rules;
- `PERFORMANCE-HANDOFF.md`: benchmark/profile protocol and evidence history;
- `NODE-REWRITE-TRACKER.md`: completion matrix and candidate backlog.

### Campaign Strategy

```ts
type CampaignStrategy =
  | {
      kind: 'benchmark_leashed_optimization'
      primaryMetric: string
      secondaryMetrics: string[]
      minimumWinPolicy: 'statistically_clear' | 'repeated_median_win' | 'memory_without_runtime_regression'
    }
  | {
      kind: 'refactor_queue'
      preservationPolicy: 'behavior_preserving' | 'contract_preserving'
      completionTrackerRequired: boolean
    }
  | {
      kind: 'quality_burn_down'
      findingClasses: string[]
      regressionBudget: 'zero_new_hard_gates' | 'no_net_increase' | 'trend_improves'
    }
  | {
      kind: 'custom'
      description: string
    }
```

The strategy chooses default evidence requirements, candidate ranking, and
iteration outcome labels. It does not bypass project/domain levers.

### Evidence Policy

```ts
type CampaignEvidencePolicy = {
  hypothesisRequired: boolean
  focusedChecks: string[]
  baselineChecks: string[]
  benchmarkChecks: string[]
  compareAgainst: 'previous_iteration' | 'frontier' | 'baseline_commit'
  acceptanceRule:
    | 'must_improve_primary_metric'
    | 'must_not_regress_primary_metric'
    | 'may_keep_structural_win_without_metric_claim'
  noiseThreshold?: {
    metric: string
    relativePercent?: number
    absoluteValue?: number
  }
  requireRevertOnFailedExperiment: boolean
  evidenceRecordPath?: string
}
```

Campaigns should default to conservative evidence:

- correctness checks must pass;
- benchmark claims need before/after comparison;
- performance-negative patches are reverted unless they fix correctness or
  explicitly reduce measured memory/object pressure without runtime regression;
- structural wins are allowed, but must not be narrated as speed wins.

### Selection Policy

```ts
type CampaignSelectionPolicy = {
  candidateSources: CampaignCandidateSource[]
  ranking: {
    impactWeight: number
    confidenceWeight: number
    verificationCostWeight: number
    blastRadiusWeight: number
    noveltyWeight: number
  }
  rejectIfRecentlyFailed: boolean
  requireDeletionConditionForBridgeDebt: boolean
  maxCandidateSpecSize: 'small' | 'medium'
}
```

The selector should produce a `CampaignCandidateDecision`:

```ts
type CampaignCandidateDecision = {
  selectedCandidateId?: string
  reason: string
  rejectedCandidates: Array<{
    candidateId: string
    reason: string
  }>
  nextTaskDraft?: {
    title: string
    description: string
    acceptanceCriteria: string[]
    outOfScope: string[]
    requiredEvidence: string[]
  }
}
```

This decision is the bridge between campaign reasoning and normal task
creation.

### Automation Policy

```ts
type CampaignAutomationPolicy = {
  createNextTask:
    | 'never'
    | 'propose_only'
    | 'coordinator_approved'
    | 'auto_ready_within_campaign'
  approveSpec:
    | 'use_domain_task_origination'
    | 'coordinator_approved_within_campaign'
    | 'auto_approve_bounded_iteration'
  keepOrRevertPatch:
    | 'worker_recommends_owner_decides'
    | 'coordinator_decides_from_evidence'
    | 'auto_revert_failed_experiment'
  allowContinuingAfterNegativeResult: boolean
  maxAutonomousIterationsBeforeSummary: number
}
```

Campaign automation is narrower than project automation. Even if the project
allows `fully_automated` run automation, a campaign may still require owner
approval for next-task creation or patch retention.

### Stop Policy

```ts
type CampaignStopPolicy = {
  maxIterations?: number
  maxWallClockMinutes?: number
  maxConsecutiveNegativeIterations?: number
  targetMetric?: {
    metric: string
    operator: '<=' | '>='
    value: number
  }
  stopWhenNoViableCandidate: boolean
  stopOnBlockedTask: boolean
  stopOnNonDelegableOwnerQuestion: boolean
}
```

Stop policy must be evaluated after each iteration and before creating the next
task. A campaign that hits a stop condition should summarize before exiting.

### Campaign Iteration

```ts
type CampaignIteration = {
  id: string
  campaignId: string
  sequence: number
  taskId: string
  candidateId: string
  hypothesis: string
  startedAt?: string
  completedAt?: string
  outcome:
    | 'pending'
    | 'kept'
    | 'kept_without_speed_claim'
    | 'reverted'
    | 'reshaped'
    | 'shelved'
    | 'blocked_for_owner'
  evidenceRefs: string[]
  measurements: CampaignMeasurement[]
  nextCandidateHints: string[]
  notes: string[]
}
```

Iterations point to normal Guildhall tasks. The campaign record owns
cross-iteration interpretation.

### Frontier

```ts
type CampaignFrontier = {
  baselineRef: string
  bestKnownMeasurements: CampaignMeasurement[]
  acceptedIterationIds: string[]
  rejectedExperimentIds: string[]
  unresolvedQuestions: string[]
  lastUpdatedAt: string
}
```

The frontier should be small enough to fit into worker context. Long logs and
raw profiles should be evidence refs, not inline prompt ballast.

## Runtime Behavior

### Starting A Campaign

Campaign intake should accept:

- a plain owner request;
- one or more source refs;
- optional stop limits;
- optional automation authority;
- optional strategy.

If the request names existing handoff/tracker files, Guildhall should inspect
them and draft the campaign from actual repo evidence. If the files disagree,
the campaign should preserve both as evidence and ask or escalate only when the
disagreement affects the first iteration.

Start flow:

1. Create campaign in `draft`.
2. Build a campaign brief from owner intent and source refs.
3. Identify evidence policy and stop policy.
4. Identify the first candidate.
5. Create a containing root task or bind to an existing parent task.
6. Create/propose the first iteration task.
7. Move campaign to `ready` or `running` depending on automation policy.

### Running A Campaign

After each scheduler tick or selected task closure, the campaign controller
checks whether an iteration reached terminal state. If so:

1. read the task's review/gate/evidence records;
2. classify the campaign iteration outcome;
3. update the frontier;
4. update source refs if the campaign owns a generated tracker;
5. evaluate stop policy;
6. create or propose the next iteration task if allowed.

The controller should run between normal orchestrator ticks. It should not
start a worker directly. It mutates campaign state and creates/promotes normal
tasks.

### Pausing And Resuming

Campaign pause should be distinct from project stop:

- pausing a campaign stops next-task creation;
- active tasks may continue or pause based on owner choice;
- resuming re-evaluates the source refs and frontier before creating more work.

If source files changed while paused, Guildhall should record a source refresh
event and explain whether the candidate order changed.

### Completing A Campaign

Completion requires a campaign summary:

- objective;
- stop condition reached;
- iterations completed;
- patches kept;
- patches reverted;
- benchmarks/tests run;
- best known frontier;
- negative results worth remembering;
- remaining candidates;
- suggested next campaign, if any.

This summary should be available in the UI and as a local artifact. It should
feed project memory, but only scoped facts should become durable memory.

## UI Behavior

0.11 should keep the UI modest. A campaign is not a new dashboard empire.

Required owner-facing surfaces:

- campaign row/card in the project work view;
- campaign detail drawer/page;
- current objective, active iteration, remaining budget, and latest evidence;
- next candidate and why it was selected;
- stop/pause/resume controls;
- final summary.

Owner-facing labels should avoid scheduler jargon:

- use "Campaign" or "Improvement run";
- use "Attempts" for completed iterations;
- use "Budget" for max attempts/time;
- use "Evidence frontier" only in advanced detail;
- use "Why this next" for candidate selection rationale.

The happy path should not expose every internal lever. Advanced controls can
show automation authority, stop policy, source refs, and raw evidence.

## Jess Fixture

Jess should be the first serious fixture because it exercises the hard parts:

- performance improvements can be negative;
- a patch may be structurally good without proving speed;
- handoff docs already define active work and evidence;
- trackers and source refs can drift;
- the right next task depends on benchmark/profile evidence;
- partial progress can be harmful if the queue asked for a full pass;
- runtime architecture constraints matter more than local style preferences.

Example campaign draft:

```yaml
title: Jess core architecture benchmark-leashed cutting
objective: Improve Less eval/render runtime by removing measured hot-path work
  while preserving behavior and avoiding routine eval-tree cloning.
strategy:
  kind: benchmark_leashed_optimization
  primaryMetric: benchmark.less wall time
  secondaryMetrics:
    - object allocation pressure
    - focused fixture pass rate
sourceRefs:
  - kind: handoff_doc
    path: docs/future/core-architecture/HANDOFF.md
    role: active_queue
  - kind: handoff_doc
    path: docs/future/core-architecture/AGGRESSIVE-CUTTING-REVIEW.md
    role: patch_rules
  - kind: handoff_doc
    path: docs/future/core-architecture/PERFORMANCE-HANDOFF.md
    role: evidence_history
  - kind: tracker_doc
    path: docs/future/core-architecture/NODE-REWRITE-TRACKER.md
    role: completion_matrix
stopPolicy:
  maxIterations: 10
  maxWallClockMinutes: 120
  maxConsecutiveNegativeIterations: 3
  stopWhenNoViableCandidate: true
  stopOnBlockedTask: true
automationPolicy:
  createNextTask: coordinator_approved
  approveSpec: coordinator_approved_within_campaign
  keepOrRevertPatch: coordinator_decides_from_evidence
  allowContinuingAfterNegativeResult: true
  maxAutonomousIterationsBeforeSummary: 3
```

Iteration task template:

```text
Hypothesis: [one sentence tied to measured evidence]

Scope:
- Touch only the named eval/render/lookup path.
- Preserve behavior.
- Avoid helper/wrapper growth unless required to delete measured work.

Required evidence:
- focused tests for the touched behavior;
- aggressive cutting review;
- changed baseline verification;
- before/after benchmark/profile comparison when making a speed claim;
- update campaign evidence with keep/revert decision.

Out of scope:
- broad architecture rewrites;
- syntax/semantic changes;
- performance claims from a single unpaired sample;
- lowering tests or baselines.
```

## Other Candidate Campaign Types

### Deterministic Quality Burn-Down

Use deterministic findings as the backlog. Each iteration removes one class of
finding or proves why it should be waived. Stop when hard gates are zero, trend
improves, or the owner-approved budget ends.

### UI Flow Audit Closure

Use `internal/audits/flow-audit.md` gaps as candidates. Each iteration closes
one live-proof gap, records DOM/API evidence, and updates the living audit.
Stop when the selected route family is covered or remaining gaps require owner
decision.

### Contract Governance Hardening

Use project contract surfaces and stale validation evidence as candidates. Each
iteration validates, repairs, or invalidates one contract surface. Stop when no
stale critical contracts remain.

### Provider Bakeoff Improvement

Use benchmark reports and model/provider failures as candidates. Each iteration
adjusts one provider profile, prompt contract, or fallback path. Stop when a
target pass rate/cost frontier is reached or repeated attempts are inconclusive.

## Integration Points

### Task Queue

Iteration tasks should carry:

- `campaignId`;
- `campaignIterationId`;
- `businessEnvelope.goalId` or equivalent project-graph linkage;
- hypothesis;
- required evidence;
- source refs;
- prior negative-result warnings.

If the task schema should not grow yet, these may start in structured task
notes or completion handoff records. The 0.11 implementation should eventually
give them typed fields.

### Project Graph And Delivery Spine

Campaigns should be graph-aware:

- source refs bind to project graph nodes;
- iteration tasks target graph nodes/domains;
- campaign root task can depend on prerequisite provider tasks;
- external issue/task authorities can mirror campaign status if configured.

### Memory

Campaign summaries should feed memory as scoped records:

- project-level campaign summary;
- domain-level accepted facts;
- source-ref-specific frontier updates;
- negative-result records with retry conditions.

Memory writes must preserve evidence refs and avoid over-generalizing one
project's performance result into a global rule.

### MCP

MCP should expose campaign read/write operations after the local model exists:

- list campaigns;
- read campaign;
- start campaign;
- pause/resume campaign;
- propose next iteration;
- record iteration evidence;
- summarize campaign.

External agents should be able to work inside a campaign without scraping local
markdown files when Guildhall already has the campaign state.

## Acceptance Criteria

1. Guildhall can create a campaign record from owner intent plus source refs.
2. A campaign can create or propose a first normal Guildhall task.
3. A completed iteration updates campaign state with hypothesis, outcome,
   evidence refs, and measurements.
4. Stop policy is evaluated before another iteration task is created.
5. `maxIterations`, `maxWallClockMinutes`, `maxConsecutiveNegativeIterations`,
   blocked-task stop, and owner stop are supported.
6. Campaign-scoped automation cannot exceed both project/domain levers and the
   campaign automation policy.
7. Negative experiment results are preserved and influence candidate selection.
8. A final campaign summary is generated when the campaign stops or completes.
9. Jess can be modeled as a campaign without moving its handoff docs into
   Guildhall-owned state.
10. The UI can show active iteration, remaining budget, latest evidence, next
    candidate rationale, and pause/resume/stop controls.

## Non-Goals For The First 0.11 Slice

- Replacing normal Guildhall task lifecycle.
- Running workers outside `Orchestrator.tick()`.
- Automatically rewriting project-owned handoff docs unless the campaign
  explicitly owns a generated artifact.
- Global infinite agents with no owner-visible budget.
- Universal statistical benchmarking.
- Automatic force-push, merge, or release behavior.
- Treating every follow-up idea as campaign-worthy.
- Public docs or marketing copy before the internal model is implemented.

## Implementation Slices

### Slice 1: Local Campaign Model

- Add campaign schemas and local persistence.
- Add campaign creation from an owner prompt and source refs.
- Add a read-only summary command/API.
- No automatic task creation yet.

### Slice 2: First Iteration Task Creation

- Add campaign candidate decision model.
- Create/propose the first iteration task through existing task creation paths.
- Link the iteration to a normal task.
- Respect `task_origination` and campaign automation policy.

### Slice 3: Iteration Outcome Intake

- Detect terminal iteration tasks.
- Classify outcome from review/gate/evidence records.
- Update frontier and negative-result memory.
- Generate a campaign event log.

### Slice 4: Stop Policy And Next-Task Loop

- Evaluate stop policy after each completed iteration.
- Generate/propose the next task when allowed.
- Stop cleanly with summary when budget or blocker conditions trigger.

### Slice 5: Jess Fixture

- Model the Jess core architecture handoff as a campaign.
- Use source refs rather than moving Jess docs.
- Run fixture tests around candidate selection, negative result preservation,
  and stop conditions.

### Slice 6: Owner-Facing UI

- Add campaign list/detail affordances in the project work view.
- Show active iteration, remaining budget, latest evidence, and next candidate.
- Add pause/resume/stop controls.

### Slice 7: MCP Surface

- Expose campaign read/write operations after the local UI/API path is stable.
- Ensure external agents can retrieve scoped campaign context and record
  evidence without direct file scraping.

## Open Questions

1. Should campaign records live beside task queue state, project graph state, or
   a new campaign-specific store under Guildhall home?
2. Should `campaignId` become a first-class `Task` field in 0.11, or start as
   structured notes until the task lifecycle migration lands?
3. Should campaign summaries update source handoff docs automatically when the
   source doc is project-owned and explicitly marked writable?
4. Should wall-clock budget count only active worker time or total elapsed time
   since campaign start? The first slice should use total elapsed time because
   it is deterministic and owner-legible.
5. Should cost/token budgets be hard stop conditions in 0.11 or advisory until
   provider usage accounting is more uniform?

## Design Principle

An iterative campaign is not an infinite prompt loop with a nicer label. It is
a visible contract for repeated work: one objective, one evidence frontier,
bounded authority, normal task lifecycle, durable negative results, and an
honest stop condition.
