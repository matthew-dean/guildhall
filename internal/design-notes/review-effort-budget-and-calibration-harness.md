---
title: Review effort, review budget, and calibration harness
---

# Review effort, review budget, and calibration harness

Date: 2026-05-25

## Status

Draft feature design for a 0.9.x planning slice.

## Related sources

- `internal/design-notes/ux-review-calibration-and-work-review-integration.md`
- `internal/plans/2026-05-25-review-calibration-and-failure-corpus.md`
- `internal/research/2026-05-25-ux-review-calibration-source-notes.md`
- `internal/design-notes/persistence-system-boundary.md`
- `docs/levers/reviewer-mode.md`
- `docs/levers/reviewer-fanout-policy.md`
- `internal/design-notes/disagreement-and-handoff.md`

## Thesis

Guildhall should not run every reviewer that might have something useful to
say. It should run the smallest review plan that covers the meaningful risks of
the task, then expand only when evidence says the task needs more attention.

The unit of planning is not a reviewer. The unit is a risk lane.

Reviewer agents are one way to cover a lane. Deterministic checks, required
artifacts, model-free validators, and human approval can also cover lanes. A
review plan is good when it covers the right lanes at the right depth for the
task's risk, cost, and release posture.

## Goals

- Add a first-class review-effort lever that behaves like a review equivalent
  of a reasoning-level selector.
- Add a task-local review plan and review budget that the Coordinator creates
  during task shaping.
- Test review planning across all reviewer lanes, not only UX.
- Test whether multi-lane reviewer bundles preserve quality or dilute it.
- Compare review-effort variants on quality, cost, latency, false positives,
  and escaped-risk coverage.
- Store review plans, reviewer results, frontier runs, overrides, compaction
  summaries, and evidence refs through Guildhall's central persistence system.
- Require review planners and reviewers to surface missing governance,
  privacy, rollout, cost, drift, override, and feedback-loop concerns without a
  user having to ask "anything else we're missing?"
- Give users a readable explanation of why Guildhall chose a review level and
  what it will spend that attention on.
- Keep public documentation human, concrete, and product-facing instead of
  exposing internal planning jargon.

## Non-goals

- Removing expert guild personas.
- Making every review plan model-heavy.
- Treating reviewer count as the quality metric.
- Blocking all tasks on all possible review lanes.
- Shipping public docs for unimplemented details before the feature exists.
- Letting the review-effort lever override mandatory high-stakes safety checks.

## Core concepts

### Risk lane

A risk lane is a kind of review concern that can be covered, skipped, or
deferred with evidence.

Initial lanes:

- `ux_comprehension`
- `copy_clarity`
- `visual_design`
- `accessibility`
- `security`
- `privacy`
- `api_contract`
- `data_integrity`
- `migration_safety`
- `test_adequacy`
- `performance`
- `docs_truth`
- `release_risk`
- `plan_completeness`
- `evidence_privacy`
- `calibration_governance`
- `cost_control`
- `rollout_safety`

Each lane declares:

- when it should be considered;
- what artifacts it needs;
- what deterministic checks can cover;
- what reviewer recipes can cover;
- whether it can be bundled with adjacent lanes;
- when it is release-blocking;
- known false-positive traps.

### Plan completeness lane

Every substantial feature plan should receive an explicit completeness pass. The
reviewer should not merely inspect what the plan already says; it should ask
what critical operating concern is absent.

For this review effort feature, a competent completeness pass should raise at
least these concerns without being prompted:

- ground-truth label governance for the calibration corpus;
- privacy, secrecy, and redaction for stored review evidence;
- real cost accounting beyond rough token estimates;
- reproducibility and model/provider drift;
- mandatory lanes that budget cannot suppress;
- human override and risk-acceptance workflow;
- negative controls so reviewers are not rewarded for always finding problems;
- production feedback loops from incidents, support, audits, and human misses;
- anti-review-theater scoring that penalizes volume without useful signal;
- rollout posture from advisory to blocking only after enough evidence.

The planning corpus should include cases where these omissions are hidden
expected findings. A planner or reviewer that fails to mention them should lose
calibration credit.

### Review recipe

A review recipe is a versioned reviewer prompt, context packet, model/settings
choice, artifact contract, and grading record for one or more risk lanes.

A persona can run a recipe, but the recipe is the calibrated unit. This prevents
"the UX reviewer" or "the security reviewer" from silently becoming a broad
generic reviewer with unclear quality.

### Review plan

A review plan is created during task shaping.

Example:

```yaml
reviewPlan:
  effort: balanced
  depth: targeted
  selectedLanes:
    - ux_comprehension
    - accessibility
    - data_integrity
  skippedLanes:
    - lane: performance
      reason: No runtime path or rendering behavior changed.
  requiredRecipes:
    - recipeId: ux-zero-context-comprehension
      version: v1
      lanes: [ux_comprehension, copy_clarity]
      blocking: high
    - recipeId: data-state-consistency
      version: v1
      lanes: [data_integrity]
      blocking: medium
  deterministicChecks:
    - typecheck
    - changed-interaction-accessibility-basics
  requiredArtifacts:
    - screenshot
    - interaction_trace
    - state_transition_trace
  budget:
    maxReviewerAgents: 4
    maxEstimatedTokens: 60000
    maxWallClockMinutes: 20
    maxRevisionLoops: 2
  aggregation:
    ux_comprehension: blocking_on_high
    accessibility: strict
    data_integrity: strict
```

The budget is not permission to drop required risk coverage. If a required lane
does not fit the budget, the Coordinator must expand the budget, downgrade with
an explicit rationale, or escalate.

### Review effort lever

Add a domain-scoped `review_effort` lever.

| Position | Behavior |
|---|---|
| `lean` | Favor speed. Use deterministic checks and only obvious high-risk lanes. |
| `balanced` | Recommended default. Use targeted calibrated lanes with bounded fanout. |
| `thorough` | Broader lane coverage, more artifacts, stricter aggregation. |
| `release_critical` | Expand budget before dropping required high-stakes lanes. |
| `custom` | Project-defined policy with explicit lane and budget rules. |

`review_effort` sets the planning posture. It does not replace
`reviewer_mode`, `reviewer_fanout_policy`, `completion_approval`, or
`max_revisions`; it informs their defaults for the specific task.

## System-level audibility and persistence

The review effort feature must preserve Guildhall's system-level auditability.
A later agent or user should be able to answer:

- why this task received this review effort;
- which risk lanes were selected, skipped, or downgraded;
- which budget limit mattered;
- which reviewer recipes ran, with which versions, models, and settings;
- what each reviewer found;
- what the Coordinator adjudicated;
- what was compacted, archived, or kept local;
- whether a later escaped miss changed the corpus or default policy.

This must not become copy-pasted file writes spread across planner, reviewer,
runner, UI, and CLI code. More broadly, review effort must not get a bespoke
storage layer. It should be a consumer of Guildhall's central persistence system.

### Current persistence shape

Guildhall already has several relevant persistence pieces:

- task evidence JSONL in local history, including review verdicts and
  adjudications;
- committed compact project state under `./.guildhall/`;
- project-local artifact registration;
- rich artifact persistence;
- lever storage with provenance;
- project-state compaction that moves bulky terminal-task evidence into local
  history and leaves compact committed references.

Those pieces are useful, but they should be unified behind one persistence
boundary. Runtime code that stores memory, logs, evidence, artifacts, state, or
archives should not decide paths independently.

### Required persistence boundary

Add or refactor a central persistence system before wiring runtime review
planning. Review effort may expose `ReviewAuditStore`, but that store must be a
domain facade over the central persistence layer, not another parallel storage
system.

Suggested responsibilities:

```ts
interface GuildhallPersistence {
  writeRecord<T>(input: WriteRecordInput<T>): Promise<PersistedRecord<T>>
  appendEvent<T>(input: AppendEventInput<T>): Promise<PersistedEvent<T>>
  readRecord<T>(ref: PersistenceRef): Promise<PersistedRecord<T> | null>
  saveArtifact(input: SaveArtifactInput): Promise<ArtifactRef>
  compact(scope: CompactionScope): Promise<CompactionSummary>
}

interface ReviewAuditStore {
  saveReviewPlan(input: SaveReviewPlanInput): Promise<ReviewPlanRecord>
  saveReviewerRun(input: SaveReviewerRunInput): Promise<ReviewerRunRecord>
  saveFrontierRun(input: SaveFrontierRunInput): Promise<FrontierRunRecord>
}
```

The persistence layer decides where each record belongs:

- compact task-facing summary in shared `.guildhall` state;
- full reviewer outputs, raw prompts, large artifacts, and harness runs in local
  history by default;
- durable user-approved policy or lever changes in shared project state;
- public or reusable internal docs only when explicitly authored as docs;
- source references from compact records to local evidence, with clear behavior
  if local evidence has been compacted or deleted.

### Persistence rules

- Runtime review code must call a domain store backed by central persistence
  rather than write new JSON, YAML, JSONL, or Markdown files directly.
- The same rule applies to memory, logs, events, artifacts, archives, decisions,
  task state, and generated documentation artifacts.
- Corpus fixtures and implementation docs may live in repo-local `internal/`
  paths, but runtime review evidence belongs in managed Guildhall state.
- Every stored record must include schema version, task id or run id, createdAt,
  creator/agent identity, source references, and relevant lever positions.
- Every generated review artifact must have a content hash and artifact refs.
- Every compaction step must preserve a compact conclusion and evidence
  references.
- Storage APIs must make the project-local/shared split explicit at call sites.
- Tests must fail if feature code writes directly to a managed Guildhall path
  instead of using a persistence-backed store.

### Records to persist

Minimum records:

- `ReviewPlanRecord`: selected lanes, skipped lanes, budget, effort position,
  reasons, required artifacts, and policy inputs.
- `ReviewPlanEvent`: later expansion, downgrade, override, adjudication, or
  escalation.
- `ReviewerRunRecord`: recipe id/version, lanes, model/settings, artifacts,
  raw output ref, parsed findings, cost/latency, and verdict.
- `PlanningCorpusRunRecord`: planning case id, variant, selected plan, grader
  scores, and failure notes.
- `FrontierRunRecord`: variant set, aggregate metrics, recommended default, and
  report artifacts.
- `EscapedMissRecord`: source task, missed lane, missed recipe/planner variant,
  human finding, new corpus case, and follow-up calibration action.

### Compaction behavior

Review audit data follows the existing memory-layout principle:

- active task: keep the current compact review plan and latest blocking results
  easy to render;
- terminal task: seal a compact review summary into committed project state;
- bulky evidence: move raw outputs, prompts, screenshots, full frontier reports,
  and large run artifacts into local history;
- deleted local evidence: retain source refs and say the full evidence is no
  longer available instead of pretending the compact summary is self-proving.

If the current persistence abstractions cannot do this cleanly, this feature
must include the refactor before adding review-plan persistence.

## Multi-lane reviewer bundles

One reviewer agent may cover multiple lanes only through an explicitly declared
bundle.

Good initial bundles:

- `ux_comprehension` + `copy_clarity`
- `accessibility` + keyboard/focus interaction basics
- `api_contract` + `docs_truth`
- `data_integrity` + `migration_safety`
- `performance` + frontend runtime risk

Bad bundles:

- "review everything";
- UX + security + migration safety + performance in one generic prompt;
- any bundle that has not been tested against cases for every lane it claims to
  cover;
- any high-stakes lane bundled so broadly that its expected findings become
  secondary.

Bundle quality must be measured. If a bundled reviewer misses findings that the
single-lane reviewers catch, the bundle should either be narrowed or used only
under `lean` and `balanced` where the risk is low enough.

## Planning corpus

The planning corpus tests whether the Coordinator chooses the right review plan.
It does not test whether a reviewer catches the final issue; that belongs to
the recipe corpus.

Case shape:

```yaml
id: review-plan-archive-project-001
title: Archive project action
taskBrief: Add an Archive Project action to the project menu.
diffSummary:
  - Adds a project menu action.
  - Adds archived state to API response.
  - Hides archived projects from the active list.
riskFacts:
  userFacing: true
  destructiveOrRecoverableStateChange: true
  permissionSensitive: true
  crossSurfaceState: true
expectedPlan:
  requiredLanes:
    - ux_comprehension
    - data_integrity
    - security
  optionalLanes:
    - copy_clarity
    - accessibility
  requiredArtifacts:
    - screenshot
    - state_transition_trace
  unacceptablePlans:
    - deterministic_only
    - single_generic_reviewer
    - drops_permissions_review
```

Planning corpus categories:

- low-risk false-positive cases, where over-review is the failure;
- hidden high-risk cases, where a small diff carries high user or data impact;
- multi-lane cases, where quality depends on covering several unrelated risks;
- budget-pressure cases, where the planner must select the most valuable lanes;
- conflict cases, where reviewer disagreement should trigger adjudication;
- escaped-miss cases, where future similar tasks should expand review.

## Recipe corpus

The recipe corpus tests whether selected reviewers are good enough.

Each lane gets hidden expected findings, false-positive traps, and source
metadata. UX starts first, but the same structure must support accessibility,
security, data integrity, docs truth, API contracts, migrations, performance,
and release risk.

The harness records:

- recipe id and version;
- model and settings;
- context packet version;
- artifacts supplied;
- expected findings found, partially found, and missed;
- false positives;
- severity alignment;
- recommendation quality;
- cost and latency.

## Budget frontier evaluation

The harness should run the same planning corpus under multiple lever variants:

```yaml
variants:
  - review_effort: lean
  - review_effort: balanced
  - review_effort: thorough
  - review_effort: release_critical
  - balanced_max_reviewers_3
  - balanced_max_reviewers_5
  - balanced_bundled_ux_copy
  - balanced_split_ux_copy
```

Metrics:

- high-severity lane recall;
- critical lane miss rate;
- false-positive lane rate;
- average reviewer-agent count;
- average estimated tokens;
- provider/model cost;
- retry count;
- parallelism used;
- wall-clock time;
- revision-loop count;
- adjudication count;
- human-escalation count;
- escaped-defect risk proxy;
- cost per high-severity finding.

The output should identify the recommended default by evidence:

```yaml
recommendedDefault: balanced
reason:
  - Captures most high-severity lanes.
  - Avoids the largest false-positive jump from thorough.
  - Keeps average reviewer-agent count near three without capping high-risk tasks.
```

## Governance and safety controls

The harness needs governance, not only mechanics.

### Ground truth and labeling

Calibration cases need trusted expected findings. Each case should record:

- who authored the hidden findings;
- who approved or reviewed them;
- disagreement notes;
- source evidence;
- label version;
- retirement criteria when a label becomes stale or overfit.

The corpus should support disputed labels. A disputed case should remain useful
for analysis, but it should not drive default lever recommendations until the
dispute is resolved or explicitly accepted.

### Evidence privacy and redaction

Review evidence can include screenshots, prompts, raw model output, source code,
API payloads, customer-like data, secrets, and proprietary business context.

Before storing or exporting evidence, the persistence layer should know:

- sensitivity class;
- redaction status;
- whether raw evidence can be committed, kept local, or exported;
- whether a screenshot or payload needs secret scanning;
- whether a compact summary can safely travel with the project.

The review harness should prefer synthetic or redacted cases when source
material comes from public examples, customer systems, or private product data.

### Reproducibility and drift

Every calibration or frontier run should record:

- recipe version;
- prompt/rubric version;
- context packet hash;
- artifact hash;
- grader version;
- model and provider identifier;
- model settings;
- tool availability;
- timestamp;
- cost and latency;
- whether the provider/model version is pinned, floating, or unknown.

Reports should distinguish a recipe improvement from a provider/model drift.

### Mandatory lane policy

Budget may reduce optional coverage. It must not suppress mandatory lanes.

Examples:

- permission-sensitive work requires security/authorization review;
- destructive or irreversible data work requires data safety/recovery review;
- public user-flow changes require at least basic UX comprehension review;
- changed interactive UI requires accessibility coverage;
- release-critical work cannot use `lean` to avoid required lanes.

When mandatory coverage exceeds the budget, the Coordinator expands the budget,
records a risk-acceptance override, or escalates.

### Human override and risk acceptance

Users may override a review plan or ship despite a finding, but the system
should store:

- who accepted the risk;
- what lane or finding was skipped;
- the reviewer-stated risk if accepted as-is;
- whether the override is one-time or policy-changing;
- whether the override should create a future calibration case.

### Negative controls and anti-review-theater scoring

The corpus needs cases where the correct answer is "no meaningful issue." This
prevents reviewers from looking good by always saying `revise`.

Reviewer scoring should penalize:

- finding volume without useful severity;
- broad non-task-local feedback;
- repeated low-value blockers;
- false positives on negative controls;
- missing the expected "nothing meaningful here" answer.

### Production feedback loop

Escaped misses should come from more than direct human correction:

- later audits;
- bug reports;
- support tickets;
- incidents;
- customer feedback;
- telemetry or repeated recovery paths;
- release retrospectives;
- reviewer disagreement patterns.

The Coordinator should classify whether the miss belongs in the planning
corpus, recipe corpus, deterministic gates, model/settings bakeoff, or public
documentation.

### Rollout posture

New review lanes should start advisory unless the lane is safety-critical or
already calibrated well enough to block work. Promotion path:

1. advisory;
2. advisory with required artifacts;
3. blocking only on high-severity findings;
4. strict blocking for mandatory lanes in high-risk domains.

Promotion should require corpus evidence, negative-control performance, and
acceptable cost.

## Operating model

The review system needs an owner loop, not only a runner.

### Ownership

Each calibrated lane should have an owner role, even if the owner is initially
the Coordinator:

- lane owner: maintains recipe quality, corpus coverage, and promotion posture;
- corpus steward: reviews labels, negative controls, staleness, and source
  diversity;
- persistence owner: keeps audit records, compaction, and evidence refs healthy;
- release owner: decides when a lane can move from advisory to blocking for a
  release or domain.

For small projects these roles can collapse into one person or Coordinator, but
the responsibilities should remain distinct in the audit trail.

### Health dashboard

Guildhall should expose review health before asking users to trust stricter
review modes.

Minimum dashboard metrics:

- high-severity recall by lane;
- false-positive rate by lane;
- negative-control pass rate;
- average review cost and latency;
- blocking rate;
- accepted override rate;
- escaped-miss count and age;
- stale or disputed label count;
- recipe versions promoted, rolled back, or retired;
- lanes currently advisory, blocking-on-high, strict, or disabled.

The dashboard should answer: is this lane helping enough to justify its cost and
authority?

### Calibration cadence

Recommended cadence:

- per escaped miss: create or update a corpus case;
- per recipe change: run targeted calibration and negative controls;
- weekly or per release branch: run the frontier suite for active lanes;
- monthly or per major model/provider change: run drift checks;
- before promotion to blocking: require a promotion report with metrics,
  examples, known weaknesses, and rollback plan.

### Rollback

Every lane promotion needs a rollback path. If a recipe starts blocking too much
or missing too much, Guildhall should be able to:

- demote it to advisory;
- pin to a previous recipe version;
- disable one reviewer bundle while keeping single-lane reviewers;
- keep deterministic gates running while pausing model review;
- preserve the audit trail explaining the rollback.

## Pitfalls and prevention

### Big-bang persistence rewrite

Pitfall: review effort becomes blocked behind a total rewrite of all storage.

Prevention: ship the central persistence boundary and guardrail first, then make
review audit the first new consumer. Migrate existing stores in phases. Existing
rendered files can stay stable while domain stores begin delegating placement,
provenance, compaction, and evidence refs to persistence.

### Calibration theater

Pitfall: the harness produces impressive-looking scores that do not predict real
review quality.

Prevention: include escaped misses, negative controls, source-diverse cases,
false-positive scoring, and production feedback. Require a lane promotion report
with examples and known weaknesses before blocking use.

### Reviewer volume masquerading as quality

Pitfall: reviewers get rewarded for producing many findings or conservative
`revise` verdicts.

Prevention: score useful high-severity recall, false positives, task-locality,
and negative-control performance. Track cost per useful finding, not finding
count.

### Corpus monoculture

Pitfall: cases overfit to Guildhall, one product type, one author's taste, or one
model's blind spots.

Prevention: require product-domain diversity, label review, synthetic
reconstructions of public examples, and stale-label retirement before marking a
recipe calibrated.

### Hidden privacy leak

Pitfall: screenshots, prompts, payloads, raw model output, or source snippets are
stored or exported with secrets or private product data.

Prevention: require sensitivity classification and redaction/export policy at
persistence time. Keep raw evidence local by default. Add secret scanning for
stored artifacts where feasible.

### Mandatory lanes quietly skipped

Pitfall: `lean` effort or a low reviewer budget suppresses security, data safety,
accessibility, or release-critical review.

Prevention: mandatory-lane policy lives outside budget. If required coverage
does not fit, the Coordinator expands budget, records a risk-acceptance override,
or escalates.

### Overblocking real work

Pitfall: the system becomes so cautious that routine tasks loop or stall.

Prevention: new lanes start advisory. Blocking begins with high-severity findings
only. Broad non-task-local feedback becomes follow-up. Max revision loops and
coordinator adjudication remain active.

### Flaky or non-reproducible calibration

Pitfall: frontier reports change because provider behavior, model aliases, tool
availability, or context changed.

Prevention: record model/provider identifiers, settings, tool availability,
prompt/context/artifact/grader hashes, cost, latency, and timestamp. Mark
floating model aliases as drift-prone.

### Planner learns to game the grader

Pitfall: the planner optimizes for exact expected lane lists instead of good
risk reasoning.

Prevention: grade coverage and unacceptable omissions rather than exact reviewer
counts. Include multiple valid plans, budget-pressure cases, and rationale
quality.

### Static guardrail false confidence

Pitfall: import-boundary or path-write scans miss indirect writes, generated
helpers, or new managed paths.

Prevention: combine static scans with domain-store tests, migration tests, and
runtime persistence audit events. Keep an explicit managed-path registry.

### UI overwhelm

Pitfall: users see a matrix of lanes, recipes, budgets, scores, and artifacts
instead of an understandable review decision.

Prevention: task UI shows the plain-language summary first: review level, what
was checked, what was skipped, why, and what blocked. Advanced audit details are
drill-down.

### Public docs promise too early

Pitfall: public docs describe harnesses, metrics, or lever behavior before the
feature actually exists.

Prevention: internal docs lead. Public docs land only with shipped behavior and
use concrete user-facing language.

### No emergency path

Pitfall: a broken reviewer or persistence bug blocks urgent work.

Prevention: allow auditable temporary demotion, reviewer disablement, or human
risk acceptance. Keep deterministic gates separate so model review can be paused
without losing basic safety checks.

### Migration data loss

Pitfall: moving existing state into persistence loses task evidence, breaks MCP
reads, or changes Git-visible files unexpectedly.

Prevention: make migrations idempotent, dry-runnable, and reversible where
possible. Verify before/after counts, hashes, source refs, and rendered legacy
file compatibility.

## Runtime workflow

1. Coordinator classifies the task's risk facts.
2. `review_effort` selects the starting posture.
3. Planner emits a `reviewPlan`.
4. Worker receives required artifacts and review contracts.
5. Worker cannot mark the task ready for review while required artifacts are
   missing, unless the Coordinator changes the plan.
6. Reviewer fanout runs selected recipes, not every applicable persona.
7. Aggregator blocks only on required lane failures.
8. Coordinator adjudicates conflicts using existing fanout policy mechanics.
9. Review audit records are written through the central persistence system.
10. Escaped misses become planning or recipe corpus cases.
11. Periodic frontier reports recommend default lever settings.

## Management UI

The task UI should show the review plan as a small explanation, not a wall of
settings.

User-facing shape:

- "Guildhall is using balanced review for this task."
- "It will check user comprehension, state consistency, and permissions."
- "It is skipping performance review because no runtime path changed."
- "This should take about three reviewer passes."
- "You can make this lighter or stricter before review starts."

Detailed audit shape:

- selected lanes;
- skipped lanes and rationale;
- required artifacts;
- selected recipes and versions;
- budget;
- aggregation policy by lane;
- reviewer verdicts;
- adjudication records;
- calibration confidence;
- overrides and provenance;
- compact/local evidence refs and compaction status.

## Documentation plan

Documentation must land in stages so the public docs only promise behavior that
exists.

### Internal planning documentation

Update internal docs first:

- this design note;
- the review calibration implementation plan;
- 0.9 planning tracker;
- source notes for the research and calibration evidence;
- persistence, storage, and compaction contract for review audit records;
- flow-audit checklist when implementation starts.

Internal docs can use precise terms like risk lane, recipe corpus, frontier
evaluation, and escaped-miss loop because they are for builders.

### Public conceptual documentation

When the feature ships, add or update public docs under `docs/guide`:

- `docs/guide/reviews.md` or a section in `docs/guide/how-guildhall-works.md`;
- `docs/guide/onboarding-and-levers.md`;
- `docs/guide/task-lifecycle.md`.

Public docs should explain the user experience:

- Guildhall chooses a review level for each task.
- Small safe tasks move quickly.
- Riskier tasks get deeper review.
- You can change the default review effort.
- The task page explains what Guildhall checked and why.

Avoid public phrasing like:

- "Coordinator emits `reviewPlan` with risk lanes."
- "Reviewer fanout executes recipe-backed lane coverage."
- "Budget frontier evaluation tunes default lever posture."

Prefer:

- "Guildhall spends more review time when the work can hurt users, data, trust,
  or a release."
- "For a simple internal cleanup, it may only run checks. For a risky product
  change, it asks the right specialists to look."
- "You can choose a lighter or stricter review style, and Guildhall will still
  call out risks it thinks you should not skip."

### Public lever documentation

Add `docs/levers/review-effort.md` only when the lever exists.

Readable public copy:

```md
# `review_effort`

`review_effort` controls how much attention Guildhall spends reviewing work in
this project area.

Use `balanced` for most projects. Guildhall will keep routine work moving, but
it will slow down when a task touches user decisions, permissions, data, or a
release path.
```

The lever page should include:

- positions in plain language;
- when to use each one;
- examples of tasks that become deeper reviews;
- what the lever does not override;
- how to inspect why a task got its review plan.

### Public UI copy

The Settings UI should not expose the whole matrix by default.

Recommended labels:

- Lean
- Balanced
- Thorough
- Release critical
- Custom

Helper copy:

- Lean: "Move faster on routine work. Guildhall still stops for obvious
  high-risk changes."
- Balanced: "Recommended. Keeps normal tasks moving and adds specialist review
  when the task touches users, data, permissions, or releases."
- Thorough: "Spend more review time before work is accepted."
- Release critical: "Use the strictest review posture for changes that could
  affect customers, data, security, or a launch."
- Custom: "Use project-specific review rules."

### Public task-page copy

The task page should say what happened in ordinary language:

- "Balanced review selected"
- "Checked: user flow, state consistency, permissions"
- "Skipped: performance, because this task did not change runtime behavior"
- "Required before review: screenshot, state transition trace"
- "Blocked by: permissions review found a missing authorization check"

### Documentation acceptance criteria

- Internal docs describe the data model, corpus, runner, and frontier metrics.
- Public docs explain the feature without requiring the reader to understand
  agents, fanout, or calibration internals.
- Public examples use real tasks, not abstract policy language.
- Public copy names what the user sees, chooses, trusts, or changes.
- Public docs do not promise the harness, metrics, or lever before they ship.
- Public docs link to lever reference only after `review_effort` exists.
- Settings UI copy has at most one short paragraph of helper text per option.
- Reference docs explain where review summaries live and when full evidence is
  kept local.

## Open questions

- Should `review_effort` be a domain lever only, or also support one-task
  temporary overrides?
- Should the planning harness be run in CI for changed recipes, or as an
  explicit calibration command only?
- What minimum evidence is required before `balanced` can bundle two lanes into
  one reviewer?
- How should user overrides be represented when Guildhall believes a skipped
  lane is unsafe?
- Should frontier reports be repo-local artifacts, Guildhall project artifacts,
  or both?
- Where should the central persistence boundary live, and which existing domain
  stores should be migrated first?
- Which review records are safe to commit by default, and which must always stay
  local unless the user exports them?

## First implementation slice

1. Add or refactor the central persistence system that routes compact summaries,
   full evidence, artifacts, logs, memory, archives, and compaction references.
2. Add the `review_effort` lever definition as internal schema only.
3. Add `ReviewPlan` and `ReviewBudget` types.
4. Add a planning corpus format with 15-20 seed cases across UX,
   accessibility, security, data, docs, API, and performance.
5. Add a planner runner that grades lane selection, artifacts, aggregation, and
   budget decisions.
6. Add recipe bundle metadata.
7. Run frontier variants for `lean`, `balanced`, and `thorough`.
8. Use the report to choose the recommended default.
9. Only then write public docs for the shipped lever and task-page behavior.
