# Guildhall 0.11.0 Capability And Persona Calibration

**Status:** Proposed 0.11.0 internal spec
**Date:** 2026-06-13
**Audience:** Guildhall runtime, review, memory, external-agent bridge,
capability-boundary, and UI implementation work
**Related:** `internal/specs/2026-06-03-guildhall-0-11-deterministic-code-quality-signals.md`,
`internal/plans/archive/specs/2026-06-06-guildhall-0-11-iterative-work-campaigns.md`,
`internal/specs/archive/2026-05-22-guildhall-0-8-practices-deep-intake-worker-modes-and-personas.md`,
`internal/plans/archive/specs/2026-05-28-guildhall-0-10-agent-memory-bridge.md`,
`internal/evals/2026-06-04-llm-memory-context-evaluation.md`,
`internal/plans/archive/2026-06-02-guildhall-0-11-implementation-tracker.md`

**Source reference:** Microsoft's SkillOpt project treats natural-language
agent guidance as trainable external state through rollout evidence, bounded
text edits, and held-out validation gates:
<https://github.com/microsoft/SkillOpt> and
<https://arxiv.org/abs/2605.23904>.

## Problem

Guildhall already changes agent behavior through several text and policy
surfaces:

- persona principles and rubrics;
- reviewer prompts and advisory lenses;
- practice or mode guidance;
- capability-request wording and trigger policy;
- memory/context inclusion policy;
- external-agent bridge instructions;
- deterministic review and gate summaries.

Those surfaces improve today through human judgment, one-off fixes, and
post-incident edits. That is acceptable while the system is young, but it does
not scale. The same review miss, over-eager persona block, noisy capability
request, or stale memory inclusion rule can recur across tasks because
Guildhall has no first-class loop for saying:

1. this behavior failed on a concrete case;
2. here is a bounded guidance edit that should prevent the miss;
3. here is the held-out evidence that the edit improves behavior without
   breaking other cases;
4. here is the proposed adoption, rollback, and owner-review path.

The risk is not just weak prompts. The deeper risk is invisible prompt drift.
If agents silently rewrite their own personas or capabilities, Guildhall loses
the trust boundary it is supposed to provide. If every adjustment requires
manual policy writing, Guildhall loses the benefit of its own evidence record.

0.11 should introduce a controlled calibration loop for Guildhall's
skill-like surfaces without adopting "skills" as a product concept.

## Product Goal

Guildhall should support **capability and persona calibration**: a
validation-gated way to improve the text and policy artifacts that guide
agents, reviewers, capability requests, and external-agent context.

The owner-facing promise is:

> "Guildhall noticed this persona keeps blocking small local fixes for broad
> architecture reasons. It replayed the changed guidance against accepted and
> rejected review cases, found that the edit reduces false blocks without
> missing known risks, and staged the update for review."

The system should produce a proposed calibration artifact, not a silent prompt
mutation.

## Non-Goal: A Public Skills Feature

Guildhall should not expose a generic "skills marketplace" or ask users to
manage Markdown skills.

The useful idea from SkillOpt is the training discipline:

- collect scored rollouts;
- reflect on successful and failed cases;
- apply bounded add/delete/replace edits to a guidance artifact;
- accept only when held-out validation improves;
- deploy the resulting artifact without extra inference-time calls.

Guildhall's vocabulary should remain product-native:

- personas;
- practices;
- capabilities;
- review lenses;
- memory packets;
- external-agent instructions;
- calibration cases;
- owner-approved changes.

## SkillOpt Usability Assessment

SkillOpt is relevant enough that the spec should name it directly, not just
borrow the shape.

As of the 2026-06-13 source review, the Microsoft repository describes
SkillOpt as an installable Python package with:

- `pip install skillopt`;
- a full training loop: rollout, reflect, aggregate, select, update, evaluate;
- multi-backend support for OpenAI, Azure, Claude, Qwen, and MiniMax;
- six built-in benchmarks;
- a deployable `best_skill.md` artifact;
- a WebUI dashboard;
- SkillOpt-Sleep plugins for Claude Code, Codex, and Copilot that mine local
  sessions, replay recurring tasks, validate held-out improvements, and stage
  adoption.

That means SkillOpt is **not merely a paper idea**. It is a usable external
tool for optimizing Markdown-style agent guidance when the caller can provide
tasks, rollouts, scores, and a target skill document.

It is **not usable as-is as Guildhall's product abstraction** for four reasons:

1. Guildhall's calibratable surfaces are not one generic skill file. They are
   persona definitions, review-planner policies, capability-request rules,
   memory/context inclusion policy, and external-agent bridge guidance.
2. Guildhall's acceptance boundary is broader than task score. A candidate can
   improve a benchmark and still be invalid if it widens authority, leaks
   sensitive context, increases missed blockers, or changes a contract without
   a decision record.
3. Guildhall needs target-version receipts, staged owner adoption, rollback,
   and Contract Touch / Schema Migration evidence. SkillOpt's `best_skill.md`
   is a useful output, but it is not enough project governance by itself.
4. Guildhall needs deterministic replay and scrubbed calibration cases before
   it should spend model calls on optimizer-assisted edits.

The right stance is therefore:

- **Use SkillOpt as an optional optimizer engine**, not as the owning model.
- **Adopt SkillOpt-Sleep ideas cautiously** for offline local-session mining,
  held-out validation, and staged review.
- **Build a Guildhall adapter first** so Guildhall can export target guidance,
  run or replay cases, evaluate candidate text, and convert a winning
  `best_skill.md`-style result into a typed calibration proposal.
- **Do not let SkillOpt write live Guildhall policy directly.**

## SkillOpt Source Audit Verdict

A source audit of `microsoft/SkillOpt` on 2026-06-13 found that the repository
has two separable reuse paths:

1. `skillopt_sleep/` is the closest reusable layer for Guildhall 0.11.
2. `skillopt/` is a heavier research/training framework that is useful for a
   later benchmark adapter.

The repository is MIT-licensed, so Guildhall can vendor or port small pieces if
needed, as long as copied source carries the required notice. Prefer referencing
or calling the upstream package first; port only after the adapter proves that
the Python dependency boundary is awkward.

### `skillopt_sleep/` Is The First Candidate

`skillopt_sleep` is mechanically close to Guildhall's calibration proposal
model. It has a deterministic mock backend, a compact backend protocol, a
train/validation/test split, a held-out validation gate, edit records, replay
results, reports, and staged adoption. Its tests also run without provider
credentials.

Directly useful source modules:

- `skillopt_sleep/types.py`: `TaskRecord`, `ReplayResult`, `EditRecord`,
  `SleepReport`.
- `skillopt_sleep/backend.py`: backend protocol plus `MockBackend` for
  deterministic proof.
- `skillopt_sleep/consolidate.py`: replay failures, ask for bounded edits,
  apply edits, and accept only if validation improves.
- `skillopt_sleep/gate.py`: pure held-out acceptance gate.
- `skillopt_sleep/mine.py`: deterministic task split and synthetic-task
  safeguards.
- `skillopt_sleep/replay.py`: replay loop and multi-objective reward shape.
- `skillopt_sleep/staging.py`: staged proposal/adoption pattern.

Guildhall should adapt those mechanics, not the default product assumptions:

- harvest from Guildhall calibration cases, review audit evidence, task
  outcomes, and capability-request decisions instead of Claude transcript
  folders;
- stage into Guildhall `CalibrationProposal` records and ignored run artifacts
  instead of `.skillopt-sleep/staging`;
- evaluate with Guildhall hard-fail metrics for privacy, authority, missed
  blockers, required artifacts, and contract/schema decisions;
- keep auto-adoption disabled;
- route all live writes through owner-reviewed adoption receipts.

Do not directly reuse these pieces in product runtime without an adapter:

- `ClaudeCliBackend` / `CodexCliBackend` command wrappers and path resolution;
- default `CLAUDE.md` and managed `SKILL.md` assumptions;
- generic feedback-phrase mining as the primary signal;
- `.skillopt-sleep` project-local writes;
- direct `adopt()` over live guidance files.

SkillOpt must be a **calibration-time tool**, not a user-runtime dependency.
It may run in maintainer workflows, local ignored experiments, CI-style
research jobs, or a one-off offline calibration harness. It must not be added
to Guildhall's main package dependencies, required by the service/UI/CLI
request path, installed into user projects, or required in the default runtime
image before a user can run Guildhall. Runtime Guildhall should only see the
resulting reviewed calibration proposal or adopted guidance text.

### `skillopt/` Is A Later Benchmark Path

The full `skillopt` package is useful when Guildhall wants an upstream-style
benchmark integration. Its main extension seam is `EnvAdapter`:

- `skillopt/envs/base.py`: environment adapter interface.
- `docs/guide/new-benchmark.md`: benchmark integration path.
- `skillopt/engine/trainer.py`: rollout, reflection, merge, rank, update, gate,
  and `best_skill.md` writing.
- `skillopt/optimizer/skill.py`: bounded Markdown edit application.
- `skillopt/evaluation/gate.py`: validation-gated acceptance.

That path is more expensive operationally because it pulls in the full Python
training stack, model backend configuration, benchmark registration, and
optimizer prompts. It is appropriate for a formal research spike or comparison
run, not the first product substrate.

### First 0.11 Spike

The first spike should prove SkillOpt reuse in the smallest no-write shape:

1. Generate a handful of scrubbed Guildhall calibration `TaskRecord`s from
   checked-in fixtures.
2. Call `skillopt_sleep.consolidate` through a local, optional Python shim or
   port the tiny gate/consolidation loop behind a TypeScript interface.
3. Use `MockBackend` or a Guildhall-specific backend first; provider-backed
   optimizer calls remain optional.
4. Write raw run output under ignored artifacts.
5. Convert an accepted candidate into a staged `CalibrationProposal`.
6. Compare the Guildhall acceptance result to the upstream gate on the same
   fixture so a later TypeScript port has a golden oracle.
7. Prove the Guildhall service, CLI, packaged app, and default runtime image do
   not require `skillopt`, Python package installation, or the prototype shim.

This avoids reinventing the training/gating loop while keeping Guildhall's
authority, memory, privacy, and contract governance as the source of truth.

## SkillOpt Adapter Shape

A SkillOpt adapter should be a replaceable backend behind Guildhall's
calibration proposal builder.

```ts
type SkillOptAdapterInput = {
  target: {
    id: string
    kind: CalibrationTargetKind
    currentText: string
    editableSections: string[]
  }
  cases: {
    train: CalibrationCase[]
    validation: CalibrationCase[]
    holdout: CalibrationCase[]
  }
  scoring: {
    command: string
    reportPath: string
    hardFailMetrics: string[]
  }
  budget: {
    maxEpochs: number
    maxOptimizerCalls: number
    maxChangedLines: number
    maxWallClockMinutes: number
  }
}

type SkillOptAdapterOutput = {
  candidateText: string
  patchSummary: string
  skillOptRunRef: string
  validationReportRef: string
  rawBestSkillRef?: string
}
```

The adapter should translate Guildhall cases into a SkillOpt environment or
SkillOpt-Sleep replay batch. SkillOpt may propose the candidate text, but
Guildhall must still run its own validation gates and create the final
`CalibrationProposal`.

The first adapter should be offline-only:

- no production request path depends on SkillOpt;
- generated reports land under ignored `artifacts/`;
- raw transcripts stay local or redacted;
- failures degrade to "no proposal created";
- owner-visible runtime behavior is unchanged until an adoption receipt exists.

## Existing Guildhall Substrate

### Persona Reviewers

`src/agents/persona-reviewer.ts` builds a reviewer prompt from one
`GuildDefinition`: persona name, principles, rubric, task-local blocking rules,
output format, and read-only tools.

That prompt is already narrow and reviewable. It is a strong first target for
calibration because:

- reviewer outputs are structured;
- verdicts are persisted;
- owner-found misses and false blocks can become calibration cases;
- existing tests can replay persona behavior through deterministic or mocked
  runners before live LLM evaluation is added.

### Review Planner And Advisory Lenses

`src/runtime/review-planner.ts` already selects risk lanes, review effort,
budgets, deterministic checks, required artifacts, recipes, and advisory
lenses.

That is the right seam for deciding when a calibrated persona or advisory lens
should appear. Calibration should not mean "run more personas." It should make
lane selection more accurate, reduce noisy review pressure, and make selected
lenses better at the jobs they already own.

### Review Calibration Harness

Guildhall already has review-planning and task-sizing calibration surfaces.
They should become the local model for this feature:

- small YAML/fixture cases;
- explicit expected lanes or decisions;
- validators that can run without network calls;
- escaped-miss capture for human-found failures;
- report artifacts that explain what changed.

Capability/persona calibration should add to this family instead of creating a
parallel benchmark harness.

### Memory And Context Policy

The memory evaluation selected Mastra as a substrate while preserving a hard
rule: memory systems do not decide task truth, readiness, review, gates, or
final context inclusion. Guildhall owns those policies.

Calibration must follow the same boundary. It can suggest better inclusion
rules or evidence summaries, but it must not let a memory substrate rewrite
Guildhall's reasoning layer.

### Capability Requests

Capability expansion is already meant to be human-visible. Extra directory
access, credentials, host tools, and related authority should be requested as
visible owner decisions with approval, denial, and fallback paths.

Calibration can improve when those requests are raised and how they are
worded. It must not grant authority, widen host access, or normalize hidden
workarounds.

### External-Agent Bridge

The 0.11 agent memory bridge wants Codex, Claude Code, and similar tools to
attach to Guildhall state, read effective context, write back structured
evidence, and leave durable handoffs.

Those bridge instructions are also calibratable guidance. A failed external
agent run can produce evidence that the bridge prompt was too vague, too broad,
or missing a mandatory writeback step. Calibration can stage a bridge-guidance
edit, but adoption must stay reviewable because these instructions influence
outside tools.

## Calibration Targets

0.11 should support a narrow set of target kinds first.

```ts
type CalibrationTargetKind =
  | 'persona_prompt'
  | 'persona_rubric'
  | 'review_lane_policy'
  | 'advisory_lens'
  | 'practice_guidance'
  | 'capability_request_policy'
  | 'memory_context_policy'
  | 'external_agent_bridge_guidance'
```

Each target has:

- a stable id;
- owner and source file or registry reference;
- current version hash;
- allowed edit operations;
- validation suite;
- adoption authority;
- rollback behavior.

The first implementation should start with `persona_prompt`,
`persona_rubric`, and `review_lane_policy`. Capability requests and memory
context policy should follow after the governance path is proven.

## Calibration Case Model

Calibration should operate on cases, not vibes.

```ts
type CalibrationCase = {
  id: string
  targetKinds: CalibrationTargetKind[]
  source: 'owner_reported' | 'review_audit' | 'gate_failure' | 'escaped_miss' | 'fixture' | 'external_agent_session'
  taskRef?: string
  summary: string
  inputs: {
    taskTitle?: string
    taskDescription?: string
    changedFiles?: string[]
    acceptanceCriteria?: string[]
    nonGoals?: string[]
    evidenceRefs?: string[]
    priorPromptExcerptRefs?: string[]
  }
  expected: {
    verdict?: 'approve' | 'revise'
    selectedLanes?: string[]
    requiredArtifacts?: string[]
    capabilityRequest?: 'raise' | 'do_not_raise'
    memoryInclusion?: 'include' | 'omit' | 'summarize'
    rationale: string
  }
  privacy: {
    containsSensitiveData: boolean
    redactionState: 'clean' | 'redacted' | 'local_only'
  }
}
```

Cases should live under `internal/calibration/` when they are generic enough
for the repo. Raw project transcripts, screenshots, local machine paths,
provider errors, and sensitive owner context should stay in local history or
ignored artifacts with redacted case summaries checked in only when useful.

## Calibration Proposal Model

A calibration run should create a staged proposal:

```ts
type CalibrationProposal = {
  id: string
  targetKind: CalibrationTargetKind
  targetId: string
  targetVersionBefore: string
  proposedVersionHash: string
  editBudget: {
    maxChangedLines: number
    maxTokenDelta: number
    allowedOps: Array<'add' | 'delete' | 'replace'>
  }
  patchSummary: string
  changedSections: string[]
  trainingCases: string[]
  validationCases: string[]
  scores: {
    baseline: CalibrationScore
    candidate: CalibrationScore
  }
  decision: 'stage_for_owner' | 'auto_adopt_allowed' | 'reject' | 'needs_more_cases'
  risks: string[]
  rollback: {
    restoreTargetVersion: string
    revertCommand?: string
  }
}

type CalibrationScore = {
  total: number
  falseBlocks: number
  missedBlockers: number
  laneMisses: number
  capabilityOverreach: number
  requiredArtifactMisses: number
  privacyOrAuthorityViolations: number
}
```

The patch itself should be inspectable as text. Guildhall should show the
diff, the reason, the cases used, the validation result, and the rollback
path.

## Optimization Loop

The loop should be intentionally conservative.

1. **Harvest evidence.** Collect candidate cases from review audits, owner
   corrections, gate failures, escaped-miss reports, capability request
   decisions, and external-agent session writebacks.
2. **Select target.** Choose one guidance target and one failure family.
3. **Split cases.** Separate train, validation, and holdout sets. A proposal
   cannot validate on the same cases that motivated the edit.
4. **Propose bounded edits.** Allow only small add/delete/replace operations
   inside approved target sections.
5. **Run baseline and candidate.** Score both versions against validation
   cases with deterministic checks first, then optional live LLM replay when
   configured.
6. **Gate.** Reject candidates that improve the target metric while worsening
   authority, privacy, missed-blocker, or required-artifact safety.
7. **Stage.** Save the proposal for owner or maintainer review.
8. **Adopt.** Apply only through an explicit adoption action and record the
   proposal id, target version, evidence, and rollback receipt.
9. **Watch.** Keep adopted calibration under monitoring so new escaped misses
   can trigger revert or follow-up calibration.

## Validation Gates

Calibration should have a strict acceptance rule:

- no increase in known missed blockers;
- no increase in privacy or authority violations;
- no regression on required artifact selection;
- improved or equal held-out score;
- bounded text delta;
- no hidden changes to unrelated personas, practices, or capability policy;
- adoption receipt recorded before runtime use.

For persona prompts, the primary metric should be fewer task-local review
mistakes:

- fewer false blocks on small correct changes;
- fewer missed blockers on known risky changes;
- better anchoring to acceptance criteria, changed files, or stated non-goals;
- fewer broad architecture demands when the diff did not touch that surface.

For review lane policy, the primary metric should be lane and artifact
selection accuracy:

- select relevant lanes;
- omit irrelevant costly lanes;
- require the right evidence artifacts;
- keep effort budgets within configured bounds.

For capability request policy, the primary metric should be authority clarity:

- raise when extra access is truly needed;
- avoid raising when work can continue inside current authority;
- word the request boundary-first;
- preserve explicit approval, denial, and fallback paths.

## Human Review Boundary

The default adoption mode should be staged review, not automatic adoption.

Automatic adoption may be allowed only for narrow local wording changes where:

- the target is not an authority, privacy, or schema boundary;
- the proposal changes no more than a small configured text budget;
- all held-out cases improve or tie;
- no safety metric regresses;
- the owner or maintainer has enabled automatic adoption for that target.

Authority-affecting targets always need human review:

- capability request policy;
- external-agent bridge guidance that changes write permissions or evidence
  writeback expectations;
- memory context policy that changes inclusion of sensitive records;
- review/gate policy that can block or unblock work.

## Contract Touch Decision

Work id: `spec:2026-06-13-capability-persona-calibration`.

Touched contracts: none by this spec-only change.

Contracts considered but not touched:

- persona prompt construction;
- review lane and advisory-lens selection;
- calibration case storage;
- capability request state machine;
- memory context inclusion policy;
- external-agent bridge instructions;
- MCP resource and tool signatures.

Required follow-up: any implementation that persists calibration cases,
calibration proposals, target versions, adoption receipts, or rollback records
must record a concrete Contract Touch Decision and, if persisted schema changes
land, a Schema Migration Decision.

Proof required for implementation: schema tests, calibration fixture tests,
baseline-vs-candidate validation report, authority/privacy regression cases,
review-planner regressions, and rollback proof.

Proof provided by this spec: repo-context review only; no runtime contract is
changed.

Waivers: no advisory detector run is required for this spec-only note because
it proposes future contracts without changing contract-owning code.

Owner-review items: decide whether calibration proposals can ever auto-adopt,
and if so which target kinds are eligible.

Apply/revert behavior: revert this spec and tracker reference to remove the
proposal from 0.11 planning.

## Schema Migration Decision

Persisted schema touched: none by this spec-only change.

Future persisted schema candidates:

- `CalibrationCase`;
- `CalibrationProposal`;
- `CalibrationTarget`;
- `CalibrationAdoptionReceipt`;
- calibration report artifacts;
- target version registry.

Scope: system-local by default, with optional checked-in fixture cases under
`internal/calibration/` only when scrubbed and reusable.

Change class: future additive schema.

Existing data impact: none for this spec. Future implementation must read
existing review audits, task records, memory records, and capability-request
records without rewriting them.

Migration id: none for this spec.

Safety: future adoption should be staged and reversible.

Required before run: no for this spec; future calibration execution requires a
target registry and validation suite.

Compatibility reader: future readers should tolerate missing calibration state
and report "no calibration proposals" rather than blocking normal review.

Fixtures: initial fixtures should include at least one false-block persona
case, one missed-risk case, one review-lane selection case, one noisy
capability request case, and one memory inclusion case.

Tests: implementation should add targeted unit tests before runtime adoption.

Owner-facing plan text: calibration proposals should read as "Guildhall found a
repeatable behavior adjustment and staged it with proof," not as "the agent
rewrote itself."

Rollback/revert behavior: restore prior target text by version hash and mark
the proposal reverted.

## Storage And Privacy

Calibration data should follow the memory-core boundary:

- bulky transcripts and raw LLM outputs stay system-local or ignored;
- checked-in cases must be small, scrubbed, and reusable;
- proposal reports can reference local evidence by source ref without copying
  sensitive content;
- owner-specific preferences must not become global guidance without explicit
  approval;
- rejected edits should be kept as compact negative evidence, not copied into
  every future prompt.

This is especially important for capability and external-agent cases. A prompt
that mentions a missing credential, private path, or customer context must not
become a public fixture by accident.

## UI Shape

Do not add a new top-level navigation area for calibration in the first slice.

Surface calibration where the owner is already looking:

- Review detail: "This looks like a calibration case" action.
- Settings / Advanced: staged calibration proposals and target versions.
- Capability request detail: "Request wording/trigger was noisy" action.
- External-agent session detail: "Bridge guidance missed a writeback" action.
- Review calibration developer tooling: CLI report and fixture validation.

The UI should answer:

- what behavior changed;
- why Guildhall thinks the change is useful;
- which cases prove it;
- what risks remain;
- how to adopt or reject;
- how to revert.

It should not ask the user to understand optimizer terminology, epochs,
learning rates, or skill files.

## Implementation Slices

### Slice 1: Target Registry And Case Format

- Add a calibration target registry for persona prompt/rubric and review lane
  policy targets.
- Add checked-in fixture case schemas under `internal/calibration/`.
- Add validators that prove cases are scrubbed, typed, and attached to target
  kinds.

### Slice 2: Baseline Replay

- Build a deterministic replay harness that runs existing target behavior
  against cases and produces a baseline report.
- Start with review lane policy and mocked persona verdict parsing before
  enabling live LLM replay.
- Store reports under ignored artifacts.

### Slice 3: Proposal Drafting

- Add a proposal builder that accepts a bounded patch and scores it against
  validation cases.
- The first version can require the patch to be supplied by a maintainer or
  agent, rather than integrating an optimizer model.
- Reject proposals that exceed edit budgets or regress safety metrics.

### Slice 4: Staged Adoption

- Add proposal storage, owner review, adoption receipts, and rollback.
- Apply adopted changes through normal repo edits or system-local target
  overrides, depending on the target kind.
- Record the adoption in project evidence when tied to an active task.

### Slice 5: Optimizer-Assisted Drafts

- Add optional optimizer-assisted patch drafting after deterministic replay and
  adoption paths are proven.
- Add a SkillOpt adapter spike that can export one persona or review-lane
  target, run a tiny scrubbed calibration batch through the
  `skillopt_sleep.consolidate`/gate path or a source-attributed port, and
  import the resulting candidate as a staged `CalibrationProposal`.
- Keep the optimizer model and SkillOpt execution behind an explicit
  provider/cost setting.
- Require the same Guildhall validation gate as manual proposals.
- Store SkillOpt run logs, staged reports, and raw `best_skill.md`-style
  candidates under ignored artifacts unless a scrubbed summary is intentionally
  checked in.

### Slice 6: Capability And Memory Targets

- Extend target kinds to capability request policy, memory context inclusion,
  and external-agent bridge guidance.
- Require authority/privacy safety cases before these targets can produce
  adoptable proposals.

## Open Questions

1. Should auto-adoption exist at all for text-only persona/rubric changes, or
   should every calibration proposal require owner or maintainer approval?
2. Should adopted guidance live as repo edits, system-local overrides, or both?
3. Should external-agent bridge guidance be calibrated per project, per owner,
   or globally?
4. What is the minimum case count before a proposal can be staged as more than
   an experiment?
5. After the no-write `skillopt_sleep` spike, should Guildhall keep SkillOpt as
   a Python subprocess dependency, vendor selected MIT-licensed pieces, or port
   the gate/consolidation loop to TypeScript with upstream attribution?
6. Should Guildhall maintain its own minimal text-edit optimizer as a fallback
   when SkillOpt is unavailable, or is manual proposal drafting enough for the
   first 0.11 slice?

## Acceptance Criteria

- Calibration is framed as Guildhall-native capability/persona improvement, not
  a public "skills" feature.
- The first implementation can validate persona and review-lane guidance
  without changing model weights or adding inference-time calls.
- The spec explicitly distinguishes SkillOpt's usable external optimizer pieces
  from the Guildhall adapter/governance work needed before adoption.
- Calibration proposals are staged with diffs, cases, scores, risks, and
  rollback behavior.
- Authority, privacy, and missed-blocker regressions hard-fail proposals.
- Memory and capability-request calibration cannot silently widen access or
  context inclusion.
- The 0.11 tracker links this spec so it is discoverable in release planning.
