# Guildhall 0.11.0 Implementation Tracker

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this tracker task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship deterministic quality signals, task-lifecycle cleanup, and
provider-guidance work that should not crowd the 0.10 operating-map release.

**Release boundary:** 0.11.0 starts after 0.10.0 proves bounded owner input,
project graph authority, contract surfaces, and the agent memory bridge. Do not
pull OpenRouter back into 0.10 unless the owner explicitly changes the release
boundary. External task authority is future deferred work, not a numbered
release prerequisite.

## Source Plans

- `internal/plans/2026-05-28-guildhall-0-11-openrouter-support.md`
- `internal/specs/2026-06-01-guildhall-0-10-state-machines-project-graph.md`
- `internal/specs/2026-06-03-guildhall-0-11-deterministic-code-quality-signals.md`
- `internal/specs/2026-06-06-guildhall-0-11-iterative-work-campaigns.md`
- `internal/specs/2026-06-13-guildhall-0-11-capability-persona-calibration.md`
- `internal/plans/2026-06-03-guildhall-0-11-deterministic-code-quality-implementation-plan.md`

## Feature Priority Order

1. **Deterministic Code Quality Signals.** This protects every later
   agent-authored 0.11 slice from code-organization, abstraction, duplication,
   layout, and design-system entropy. It should land first unless the owner
   explicitly re-centers 0.11 on provider setup.
2. **Iterative Work Campaigns.** This turns repeated performance,
   refactoring, quality-burn-down, and audit-closure work into a bounded,
   evidence-driven campaign loop rather than a hand-maintained prompt loop.
   It should build on deterministic quality signals and the 0.10 delivery
   spine, and it should use Jess-style benchmark-leashed work as the serious
   fixture.
3. **Capability And Persona Calibration.** This turns repeated review misses,
   false persona blocks, noisy capability requests, memory-context mistakes,
   and external-agent bridge failures into validation-gated guidance updates
   rather than silent prompt drift. It should evaluate SkillOpt as an optional
   optimizer engine behind a Guildhall-owned adapter, and it should build on
   deterministic quality signals, review calibration, memory-core boundaries,
   and iterative campaign mechanics before touching authority-sensitive
   targets.
4. **Task Lifecycle Migration.** This pays off the 0.10 state-machine and
   project-graph substrate by removing broad lifecycle cleanup from ad hoc task
   fields.
5. **OpenRouter Guided Setup.** This remains a valuable provider feature, but
   it should build on the deterministic quality substrate rather than preempt
   it.

## Milestone 1: Deterministic Code Quality Signals

**Purpose:** Reduce agent-authored wheel reinvention by turning guideline-backed
size, complexity, duplication, abstraction-fitness, legacy-syntax, layout,
dependency, dead-code, and design-system scans into normalized Guildhall
findings.

- [ ] Add durable quality guidelines, a deterministic finding model, and an
  analyzer registry that classifies findings as hard gates, review signals, or
  trend metrics based on the guideline each signal protects.
- [ ] Normalize existing `lint:design`, `lint:reductions`, and `lint:deps`
  outputs into the shared finding shape before adding new tools.
- [ ] Add duplication and abstraction-fitness signals that use reason-to-change
  and contract rules before recommending extraction.
- [ ] Add web design/layout signals for banned raw styles, data-bound component
  styling, grid-shaped flex usage, local primitive duplication, and package UI
  variant-budget violations.
- [ ] Add complexity, size, type/state, and dependency-architecture signals
  using stack-appropriate analyzers such as ESLint, jscpd/CPD, Knip, dependency
  graph metrics, Semgrep, ast-grep, or ecosystem-native tools.
- [ ] Feed deterministic findings into task shaping, worker context, review
  packets, run evidence, waiver receipts, project trend summaries, and
  toolchain-profile capability explanations.

## Milestone 2: Iterative Work Campaigns

**Purpose:** Turn repeated performance, refactoring, quality-burn-down, and
audit-closure work into bounded campaign loops that create normal Guildhall
tasks, compare outcomes against an evidence frontier, preserve negative
results, and stop on explicit budget or blocker conditions.

- [ ] Add a local campaign model with objective, source refs, strategy,
  evidence policy, selection policy, automation policy, stop policy, frontier,
  and iteration records.
- [ ] Add campaign intake that can draft a campaign from owner intent plus
  handoff docs, trackers, benchmark commands, deterministic finding queries, or
  external task authorities.
- [ ] Create/propose the first iteration as a normal Guildhall task while
  respecting domain `task_origination`, project `run_automation`, and the
  campaign's narrower automation policy.
- [ ] Classify completed iteration outcomes as kept, kept without metric claim,
  reverted, reshaped, shelved, or blocked for owner based on review, gates, and
  campaign evidence.
- [ ] Evaluate `maxIterations`, `maxWallClockMinutes`,
  `maxConsecutiveNegativeIterations`, blocked-task stop, and owner stop before
  creating the next iteration.
- [ ] Preserve negative experiment results and use them to rank or reject future
  candidates.
- [ ] Model the Jess core architecture handoff as the first serious fixture
  without moving Jess-owned handoff docs into Guildhall-owned state.
- [ ] Add owner-facing campaign UI for active iteration, remaining budget,
  latest evidence, next-candidate rationale, and pause/resume/stop controls.

## Milestone 3: Capability And Persona Calibration

**Purpose:** Improve Guildhall's skill-like guidance surfaces with
validation-gated proposals instead of silent prompt drift or hand-tuned
one-off edits.

- [ ] Add a calibration target registry for persona prompts/rubrics and review
  lane policy before authority-sensitive targets.
- [ ] Add scrubbed calibration case schemas for false persona blocks, missed
  risks, lane-selection misses, noisy capability requests, and memory inclusion
  mistakes.
- [ ] Add a baseline replay harness that can score current target behavior
  against checked-in fixture cases and ignored local reports.
- [ ] Add staged calibration proposals with bounded text diffs, train/validation
  case splits, safety scores, rollback receipts, and owner-review state.
- [ ] Add a SkillOpt source-reuse spike that starts with the
  `skillopt_sleep.consolidate`/gate path or a source-attributed port, exports
  one scrubbed persona or review-lane target, runs an offline no-write
  calibration batch, and imports the candidate as a staged proposal without
  giving SkillOpt live write authority or adding SkillOpt/Python package
  requirements to the user runtime.
- [ ] Hard-fail proposals that regress missed blockers, privacy, authority,
  required artifacts, or capability-boundary behavior.
- [ ] Add adoption and rollback paths that record target version hashes and
  never silently widen capability grants, memory inclusion, or external-agent
  write authority.
- [ ] Extend calibration to capability request policy, memory context policy,
  and external-agent bridge guidance only after persona/review-lane targets are
  proven.

## Milestone 4: Task Lifecycle Migration

**Purpose:** Move broad task lifecycle cleanup out of ad hoc status fields and
onto explicit node/linkage state machines after the 0.10 state-machine
substrate has proven itself.

- [ ] Define conversion scripts for legacy task status shapes that should become
  graph linkages or state-machine receipts.
- [ ] Migrate parent/child relationships into task hierarchy node links instead
  of treating parentage as a task state.
- [ ] Route task lifecycle writes through explicit transition helpers and
  receipts.
- [ ] Keep owner-facing labels separate from persisted lifecycle states.

## Milestone 5: OpenRouter Guided Setup

**Purpose:** Offer OpenRouter as a trustworthy hosted-provider setup path with
clear routing, attribution, privacy/cost posture, and recommendation evidence.

- [ ] Add named OpenRouter provider profile and request extras.
- [ ] Add role-aware presets and recommendation evidence thresholds.
- [ ] Add guided provider UI, browser proof, and listing-readiness packet.
- [ ] Update public provider docs only after the setup path is implemented and
  proven with live or fixture-backed evidence.
