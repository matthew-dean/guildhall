# Guildhall 0.11.0 Implementation Tracker

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this tracker task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship deterministic quality signals, task-lifecycle cleanup, and
provider-guidance work that should not crowd the 0.10 operating-map release.

**Release boundary:** 0.11.0 starts after 0.10.0 proves bounded owner input,
project graph authority, contract surfaces, external task authority, and the
agent memory bridge. Do not pull OpenRouter back into 0.10 unless the owner
explicitly changes the release boundary.

## Source Plans

- `internal/plans/2026-05-28-guildhall-0-11-openrouter-support.md`
- `internal/specs/2026-06-01-guildhall-0-10-state-machines-project-graph.md`
- `internal/specs/2026-06-03-guildhall-0-11-deterministic-code-quality-signals.md`
- `internal/plans/2026-06-03-guildhall-0-11-deterministic-code-quality-implementation-plan.md`

## Feature Priority Order

1. **Deterministic Code Quality Signals.** This protects every later
   agent-authored 0.11 slice from code-organization, abstraction, duplication,
   layout, and design-system entropy. It should land first unless the owner
   explicitly re-centers 0.11 on provider setup.
2. **Task Lifecycle Migration.** This pays off the 0.10 state-machine and
   project-graph substrate by removing broad lifecycle cleanup from ad hoc task
   fields.
3. **OpenRouter Guided Setup.** This remains a valuable provider feature, but
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

## Milestone 2: Task Lifecycle Migration

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

## Milestone 3: OpenRouter Guided Setup

**Purpose:** Offer OpenRouter as a trustworthy hosted-provider setup path with
clear routing, attribution, privacy/cost posture, and recommendation evidence.

- [ ] Add named OpenRouter provider profile and request extras.
- [ ] Add role-aware presets and recommendation evidence thresholds.
- [ ] Add guided provider UI, browser proof, and listing-readiness packet.
- [ ] Update public provider docs only after the setup path is implemented and
  proven with live or fixture-backed evidence.
