---
title: Review calibration and failure corpus implementation plan
---

# Review calibration and failure corpus implementation plan

Date: 2026-05-25

## Status

Implemented for the 0.9.0 review-calibration slice. The current code includes
the corpus and recipe schemas, seed cases across UX and non-UX lanes, grading,
escaped-miss draft creation, persistence-backed audit records, task
`reviewRisk` projection, and required-artifact readiness checks.

## Source docs

- Design note:
  `internal/design-notes/ux-review-calibration-and-work-review-integration.md`
- Source notes:
  `internal/research/2026-05-25-ux-review-calibration-source-notes.md`
- Review effort and budget design:
  `internal/design-notes/review-effort-budget-and-calibration-harness.md`
- Persistence boundary design:
  `internal/design-notes/archive/persistence-system-boundary.md`
- Memory layout reference:
  `docs/reference/memory-layout.md`
- Existing zero-context script:
  `internal/plans/2026-05-24-zero-context-flow-user-testing.md`
- Live flow-audit evidence:
  `internal/audits/flow-audit.md`

## Thesis

Guildhall should evaluate reviewers the same way it evaluates workers: against
evidence. For UX and other review lanes, that means maintaining failure corpora,
running reviewer recipes against hidden expected findings, and letting the
Coordinator select review recipes that have actually caught similar issues.

This is not only a UX feature. UX is the first slice because the recent misses
are concrete and user-visible, but the same structure should support security,
accessibility, performance, API design, docs, migrations, and reliability.

## Goals

- Give the Coordinator a general workflow for routing risky work into calibrated
  review recipes.
- Create a reusable failure-corpus format with hidden answer keys.
- Add a small UX seed corpus grounded in external source categories, not only
  Guildhall-specific failures.
- Run reviewer recipes against calibration cases and persist results.
- Integrate required recipes into task shaping, worker handoff, reviewer fanout,
  and gate checks.
- Support one-variable-at-a-time bakeoffs when reviewers miss known findings.
- Provide the foundation for a review-effort lever, review budget, and planning
  corpus that balance all reviewer lanes by evidence instead of reviewer count.
- Ensure review plans, review results, calibration runs, frontier reports, and
  overrides use Guildhall's central persistence system instead of scattered
  direct file writes.
- Make plan-completeness review a calibrated lane so reviewers surface missing
  governance, privacy, cost, drift, rollout, and override concerns without a
  user having to ask for them.

## Non-goals

- Building a full UX research platform.
- Replacing human usability testing.
- Making all UX review release-blocking by default.
- Copying public example screenshots into the repo without clear rights.
- Tuning every model/provider combination before the first end-to-end slice.
- Solving every review lane in the first implementation.

## Workstream 1: Corpus model

Add a local corpus format for calibration cases.

Suggested initial location:

- `internal/calibration/cases/ux/*.yaml`
- `internal/calibration/artifacts/ux/...`
- `internal/calibration/results/...`

Long-term, Guildhall can promote this into project/system storage, but a repo
local internal format is enough to prove the loop.

Case fields:

- `id`
- `title`
- `domain`
- `productType`
- `surfaceType`
- `userGoal`
- `scenario`
- `artifacts`
- `reviewLanes`
- `knownFindings`
- `falsePositiveTraps`
- `severity`
- `source`
- `labelGovernance`
- `privacyClassification`
- `negativeControl`
- `stalenessPolicy`

Acceptance criteria:

- A case can be loaded and validated.
- Hidden findings are not included in the reviewer prompt.
- Cases can reference screenshots, DOM snapshots, copy snippets, URLs, or flow
  steps.
- Cases can be synthetic while preserving source metadata.

## Workstream 2: UX seed corpus

Create 10-15 seed cases, with three required for the first slice:

1. ambiguous primary action;
2. error without recovery;
3. cross-surface state contradiction.

Additional cases should cover:

- hidden safe path;
- late material disclosure;
- internal jargon in a user decision;
- form label depends on missing context;
- visual interference;
- cancellation asymmetry;
- confirmation without trust evidence;
- overloaded default screen;
- misleading progress/status;
- accessibility comprehension with no hover or keyboard-only navigation.

Acceptance criteria:

- At least three cases are not based on Guildhall.
- At least one case is non-visual or not a web app, such as CLI/docs/email/API
  error copy.
- Each case has expected findings with category, impact, severity, and minimum
  useful fix.
- Each case has a false-positive trap.
- The corpus includes negative controls where the correct useful finding is that
  there is no task-relevant problem.
- Each case records label provenance and privacy classification.

## Workstream 3: Reviewer recipe registry

Define review recipes independently from guild personas.

Initial recipe:

- `ux-zero-context-comprehension`

Later recipes:

- `ux-click-through-task-path`
- `ux-error-recovery`
- `ux-deceptive-design`
- `ux-accessibility-comprehension`
- `ux-cross-surface-consistency`

Recipe fields:

- id and version;
- lane;
- purpose;
- model and settings;
- prompt/rubric version;
- context packet spec;
- required artifacts;
- calibrated cases;
- detection rates;
- known weaknesses.

Acceptance criteria:

- Recipes are versioned.
- A recipe can declare required artifact kinds.
- A recipe can be selected from task `reviewRisk`.
- Results preserve the recipe id/version.

## Workstream 4: Calibration runner

Implement a command or internal tool that:

1. loads a calibration case;
2. loads a recipe;
3. builds the reviewer context packet without hidden findings;
4. runs the reviewer;
5. saves raw review output;
6. grades against hidden expected findings;
7. writes a structured result.

Acceptance criteria:

- The runner can execute the first three UX cases.
- Results record model, settings, prompt version, context version, and tools.
- The grader distinguishes pass, partial, miss, and false-positive-heavy.
- Result files are stable enough to compare across recipe variants.

## Workstream 5: One-variable bakeoff workflow

Add a Coordinator-facing workflow for misses:

1. Baseline recipe run.
2. Context-only variant.
3. Model-only variant.
4. Settings-only variant.
5. Prompt/rubric-only variant.
6. Multi-reviewer variant only after the previous runs explain the miss.

Acceptance criteria:

- A bakeoff plan declares the single changed variable.
- The runner rejects or warns on multi-variable comparisons unless explicitly
  marked exploratory.
- The summary identifies whether context, model, settings, or prompt most
  improved detection.

## Workstream 6: Task review-risk integration

Extend task shaping with `reviewRisk`.

Example:

```yaml
reviewRisk:
  lanes:
    - ux
  recipes:
    - recipeId: ux-zero-context-comprehension
      version: v1
      required: true
      releaseBlocking: true
      reason: The task changes a first-run decision screen.
  requiredArtifacts:
    - screenshot
    - route
    - userGoal
    - primaryAction
```

Acceptance criteria:

- Coordinator/Spec Agent can attach `reviewRisk`.
- Worker handoff includes required review artifacts.
- A task cannot move to review when required artifacts are absent, unless the
  Coordinator explicitly changes the recipe or records why the artifact cannot
  exist.

## Workstream 7: Reviewer fanout integration

At `review`, route required recipes into fanout.

Acceptance criteria:

- Recipe-backed reviewers persist normal `ReviewVerdict` records.
- Verdicts include recipe id/version, artifact refs, scores, and findings.
- Strict aggregation blocks when a required release-blocking recipe returns
  `revise`.
- Non-blocking observations can be persisted as follow-up ideas instead of
  bouncing a task.

## Workstream 8: Gate-check artifact contracts

At `gate_check`, deterministic checks enforce required artifacts and static UX
contracts.

Initial checks:

- required screenshot/DOM/route artifact exists;
- user-facing strings do not leak known internal tokens;
- primary actions have declared outcomes;
- semantic user-facing content is not stored as mechanical truncation;
- accessibility basics are present for changed interactions where static checks
  apply.

Acceptance criteria:

- Missing required review artifacts fail before `done`.
- Static failures produce actionable messages.
- Raw diagnostics stay available in evidence but are not user-facing default
  copy.

## Workstream 9: Escaped-miss loop

When a human or later audit finds a UX issue reviewers missed:

1. Create a calibration case from the escaped issue.
2. Run the recipe that should have caught it.
3. Run one-variable bakeoff variants.
4. Update the recipe only with evidence.
5. Link the escaped task, case, and calibration result.

Acceptance criteria:

- Escaped review issues have a first-class path into the corpus.
- The result records whether the miss was due to context, model, settings,
  prompt/rubric, missing deterministic check, or missing reviewer lane.

## Workstream 10: Review planning corpus

Add a corpus for testing whether the Coordinator chooses the right review depth
before reviewer agents run.

This corpus is separate from the reviewer recipe corpus:

- planning corpus: did Guildhall select the right lanes, artifacts,
  aggregation, and budget?
- recipe corpus: did a selected reviewer recipe catch the hidden finding?

Initial planning cases should include:

- low-risk false-positive cases, where over-review is the failure;
- hidden high-risk cases, where a small diff carries meaningful impact;
- multi-lane cases, such as UX plus security plus data consistency;
- budget-pressure cases, where the planner must choose the most valuable lanes;
- conflict cases, where review disagreement should trigger adjudication;
- escaped-miss cases, where a similar future task should expand review.

Acceptance criteria:

- A planning case can declare required, optional, and unacceptable lanes.
- A planner run can be graded without requiring exact reviewer counts.
- The grader can distinguish missing critical coverage from acceptable budget
  trimming.
- Results record review-effort lever position, estimated cost, selected lanes,
  skipped lanes, and rationale.

## Workstream 10A: Central persistence boundary

Before runtime wiring, add or refactor the central persistence/archive interface
for all generated Guildhall state and evidence. Review effort should be the
first consumer of this boundary, not a special storage path.

This should build on the existing Guildhall split:

- compact shared project state under `./.guildhall/`;
- bulky or private local history under `~/.guildhall/data/projects/<project-hash>/`;
- task evidence JSONL for append-only records;
- artifact registry and rich artifact storage for review artifacts;
- compaction that seals terminal tasks into small committed records and moves
  full evidence to local history.

Required records:

- review plan;
- review plan events, such as budget expansion, downgrade, override,
  adjudication, and escalation;
- reviewer run records;
- planning corpus run records;
- frontier run records;
- escaped-miss links.

Acceptance criteria:

- Runtime review-planning, reviewer-run, and frontier-report code writes through
  domain stores backed by the central persistence system.
- The persistence system makes the shared-project/local-history/global/exported
  split explicit.
- Compact records include evidence refs instead of embedding raw bulky outputs.
- Full prompts, raw reviewer output, screenshots, and large reports stay local
  by default unless the user exports or promotes them.
- Compaction preserves a compact conclusion, source refs, and an honest "full
  evidence unavailable" state if local evidence is later removed.
- Tests cover that review-planning code does not write directly to managed
  storage paths.
- Tests or static checks cover that feature modules do not directly write
  managed Guildhall paths for task state, memory, logs, evidence, artifacts, or
  archives.
- The implementation removes or wraps any copy/paste persistence helper before
  it ships.

Future migration shape:

1. review audit proves the boundary with a new consumer;
2. task state and task evidence move next because review planning depends on
   task lifecycle and compaction;
3. memory, decisions, transcripts, and checkpoints move before autonomous
   recovery expands;
4. artifact, corpus-map, design-system, skill, lever, and config stores move as
   those surfaces receive feature work;
5. MCP, CLI, UI, and agent context builders converge on the same persistence
   reads after writes are centralized.

## Workstream 11: Review effort and budget

Introduce a domain-level `review_effort` lever and task-level review budget.

Recommended lever positions:

- `lean`;
- `balanced`;
- `thorough`;
- `release_critical`;
- `custom`.

The default should be `balanced` only after the planning corpus shows that it
captures high-severity lanes without excessive false positives.

Acceptance criteria:

- A task can carry a structured `reviewPlan`.
- The plan includes selected lanes, skipped lanes, required artifacts, recipes,
  deterministic checks, aggregation, and budget.
- Budget limits do not silently drop required lanes.
- If required coverage exceeds budget, the Coordinator records an expansion,
  downgrade rationale, or escalation.

## Workstream 12: Quality/cost frontier reports

Run the planning corpus under multiple lever and budget variants.

Metrics:

- high-severity lane recall;
- critical lane miss rate;
- false-positive lane rate;
- reviewer-agent count;
- estimated tokens;
- provider/model cost;
- retry count;
- parallelism used;
- wall-clock time;
- revision-loop count;
- adjudication count;
- human-escalation count;
- cost per high-severity finding.

Acceptance criteria:

- A frontier report compares `lean`, `balanced`, and `thorough`.
- The report recommends a default review-effort position with evidence.
- The report identifies cases where a reviewer bundle underperforms separate
  lane reviewers.
- The report is readable enough to support product decisions, not only test
  debugging.

## Workstream 12A: Governance, privacy, drift, and rollout controls

Add controls that keep the calibration system trustworthy.

Required pieces:

- **Label governance:** expected findings record author, approver, source
  evidence, disagreement notes, label version, and retirement criteria.
- **Privacy and redaction:** review artifacts, screenshots, prompts, raw model
  output, payloads, and source snippets receive sensitivity classification and
  redaction/export policy before persistence or sharing.
- **Reproducibility and drift:** calibration and frontier runs record recipe
  version, prompt/rubric version, context hash, artifact hash, grader version,
  model/provider id, settings, tool availability, timestamp, cost, and latency.
- **Mandatory lane policy:** budget can trim optional lanes but cannot silently
  suppress required security, data safety, accessibility, UX comprehension, or
  release-critical lanes when task facts make them mandatory.
- **Human override and risk acceptance:** overrides record who accepted the
  risk, what lane/finding was skipped, risk if accepted as-is, scope, and whether
  it creates a future calibration case.
- **Anti-review-theater scoring:** reviewers are penalized for false positives,
  broad non-task-local blockers, and finding volume without useful severity.
- **Production feedback loop:** audits, incidents, support reports, bug reports,
  telemetry patterns, customer feedback, and review disagreements can become
  candidate corpus cases.
- **Rollout posture:** new lanes start advisory, then move to required-artifact,
  high-severity blocking, or strict blocking only after evidence supports it.

Acceptance criteria:

- A reviewer/planner is graded down when it omits obvious governance, privacy,
  cost, drift, rollout, or override risks from a substantial plan.
- At least five planning corpus cases include hidden expected findings about
  missing system-level concerns rather than direct product defects.
- Negative controls are part of every lane's calibration set before that lane
  can become blocking by default.
- Frontier reports include cost and drift metadata, not just quality scores.
- Mandatory-lane policy is testable separately from reviewer count and budget.
- Public docs explain risk acceptance and review effort without exposing
  internal calibration machinery.

## Workstream 12B: Operating model and review health

Define how calibrated review stays healthy after it ships.

Required pieces:

- lane ownership responsibilities;
- corpus stewardship responsibilities;
- persistence/audit ownership responsibilities;
- release-owner promotion and rollback responsibilities;
- review health dashboard metrics;
- calibration cadence;
- lane promotion reports;
- rollback path for noisy or unsafe reviewers.

Minimum health metrics:

- high-severity recall by lane;
- false-positive rate by lane;
- negative-control pass rate;
- cost and latency;
- blocking rate;
- override acceptance rate;
- escaped-miss count and age;
- stale or disputed label count;
- current lane posture, such as advisory, blocking-on-high, strict, or disabled.

Acceptance criteria:

- A lane cannot move from advisory to blocking without a promotion report.
- A promoted lane has an explicit rollback plan.
- Review health is inspectable without reading raw calibration result files.
- The system can identify stale or disputed corpus labels.
- The Coordinator can explain why a lane is advisory, blocking, disabled, or
  rolled back.

## Workstream 12C: Pitfall prevention tests

Add tests and review cases for likely failure modes.

Required pitfall cases:

- persistence migration tries to become a big-bang rewrite;
- review effort overblocks a low-risk task;
- `lean` effort attempts to skip a mandatory lane;
- reviewer finds many low-value issues but misses the expected high-severity
  issue;
- negative-control case where the right answer is no task-relevant problem;
- planning case with two valid review plans and one unacceptable omission;
- private evidence case that requires redaction/local-only storage;
- model/provider drift case where quality changes without recipe changes;
- stale label case that should be retired or disputed;
- public-doc draft that promises unshipped harness behavior;
- UI case where review details overwhelm the task decision;
- emergency demotion or human risk-acceptance path.

Acceptance criteria:

- Pitfall cases are part of the planning corpus or recipe corpus, not only a
  prose checklist.
- The harness reports when a variant improves quality by overblocking or
  increasing false positives.
- Persistence migration tests include dry-run, idempotence, before/after counts,
  source refs, and legacy-render compatibility.
- Review UI copy is tested for summary-first behavior.
- Emergency demotion preserves audit history and does not disable deterministic
  gates.

## Workstream 13: Documentation

Documentation must be part of the feature, not cleanup after implementation.

Internal documentation:

- design note for review effort, budget, and calibration harness;
- implementation plan updates;
- corpus authoring guide;
- runner output examples;
- persistence/audit record examples and compaction behavior;
- label governance, privacy classification, and negative-control authoring
  rules;
- review-health dashboard and lane-promotion report examples;
- guidance for converting escaped misses into planning or recipe cases.

Public documentation, once the feature ships:

- explain review effort in `docs/guide` in terms of what the user sees and
  chooses;
- add `docs/levers/review-effort.md` only when the lever exists;
- update onboarding/levers docs to mention the recommended default;
- update task lifecycle docs to show how a task receives a review plan.
- update reference docs to explain where review summaries and full evidence
  live.

Public copy rules:

- Say "Guildhall spends more review time when a task touches users, data,
  permissions, or a release."
- Do not expose raw internal terms like "risk-lane frontier evaluation" unless
  they are in an advanced/reference section.
- Use examples of real tasks.
- Explain what was checked, what was skipped, and why.
- Explain that compact review summaries travel with the project, while bulky
  raw evidence usually stays local.
- Keep each lever option's helper text short enough for Settings UI.

Acceptance criteria:

- Public docs are written in a user-facing voice, not agent instructions.
- Internal docs preserve the technical model and calibration method.
- Public docs do not promise unshipped harness behavior.
- Every new public page answers: when should I change this, and what will I see
  happen?

## Milestones

### Milestone 1: Manual corpus proof

- Case schema.
- Three UX cases.
- One recipe.
- Manual runner script or command.
- Human-readable results.

### Milestone 2: Review-risk proof

- `reviewRisk` shape on tasks.
- Required artifact checks.
- Recipe result persisted as `ReviewVerdict`.
- One real task can require `ux-zero-context-comprehension`.

### Milestone 3: Calibration loop proof

- One missed case.
- Baseline and one context-only variant.
- Summary showing what changed and whether detection improved.

### Milestone 4: Multi-lane foundation

- Add at least one non-UX lane seed, likely security or accessibility.
- Prove the corpus/recipe/result model works outside UX.

### Milestone 5: Review planning proof

- Central persistence boundary or refactor.
- Planning corpus with at least 15 cases across multiple lanes.
- `review_effort` draft positions evaluated against the planning corpus.
- First quality/cost frontier report.
- Internal documentation for writing and grading planning cases.

### Milestone 6: Public docs proof

- Draft public guide copy for review effort behind the feature branch.
- Draft lever reference for `review_effort` once the lever exists.
- Task-page copy examples for selected, skipped, and expanded review lanes.
- Reference copy for the compact-project/local-evidence audit split.

## Release criteria

- A task that changes a risky user-facing flow can declare UX review risk.
- The worker sees and satisfies required artifact obligations before review.
- Reviewer fanout can run a calibrated UX recipe.
- Gate checks can block missing artifacts.
- Missed review findings can become calibration cases.
- Documentation explains how to change one variable at a time when tuning
  context/model/settings/prompt.
- Plan-completeness review can identify missing governance, privacy, cost,
  drift, rollout, mandatory-lane, and override concerns without user prompting.
- The Coordinator can produce a review plan that covers all required lanes
  without relying on a fixed reviewer-count cap.
- A frontier report supports the recommended default review-effort setting.
- Review plans and reviewer outputs are auditable through the central
  persistence system, with compact project summaries and local full-evidence
  refs.
- Calibration cases include label provenance, negative controls, privacy
  classification, and reproducibility metadata.
- Lane promotion, health monitoring, and rollback are defined before any new
  review lane becomes broadly blocking.
- Public documentation explains review effort in human terms before release.

## Risks

- Corpus cases become too Guildhall-specific.
- Reviewer recipes overfit small examples.
- False positives make UX review feel performative.
- Screenshots become stale and expensive to maintain.
- Source examples create licensing ambiguity if copied too directly.
- Model bakeoffs become noisy unless variables are isolated.
- Review effort becomes another confusing knob unless the product explains it
  as a simple review-depth choice.
- Public docs overexpose internal calibration machinery.
- Persistence spreads through copy/pasted path helpers and becomes hard to
  compact, migrate, expose through MCP, or reason about.
- The harness rewards reviewers for saying more instead of saying the right
  thing.
- Hidden expected findings become stale, disputed, or overfit.
- Raw evidence stores secrets, customer-like data, or proprietary context
  without classification.
- Model/provider drift makes quality changes look like recipe improvements.
- Blocking lanes ship without ownership, health metrics, or rollback.
- The implementation tries to solve every persistence migration before proving
  the review-audit path.
- Planner/reviewer tests overfit exact expected lane lists instead of evaluating
  risk coverage.
- UI and docs expose the internal matrix instead of a readable review decision.

## Mitigations

- Require product-domain diversity before marking a recipe calibrated.
- Store synthetic reconstructions for public examples, with source metadata.
- Track false positives as seriously as misses.
- Prefer small, focused artifacts over whole-app screenshots.
- Version recipes and context packets.
- Keep the first slice narrow enough to verify end to end.
- Treat reviewer count as a budget symptom, not the quality target.
- Make centralized persistence a prerequisite for runtime wiring.
- Require negative controls and anti-review-theater scoring before a lane can
  become blocking.
- Require label provenance, privacy classification, and reproducibility metadata
  for every calibration run.
- Roll out new lanes advisory-first unless they cover a mandatory safety lane
  with enough evidence.
- Require lane promotion reports and rollback plans before broad blocking use.
- Add pitfall cases to the harness before making `review_effort` broadly
  available.
- Write public docs from the user's point of view: what Guildhall checks, why it
  slowed down or moved quickly, and how to change the default.
