# Guildhall 0.11.0 Deterministic Code Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship deterministic code-quality signals that make Guildhall protect
good code organization, abstraction, duplication, layout, type/state, and
design-system practices before agents write or review code.

**Source spec:**
`internal/specs/2026-06-03-guildhall-0-11-deterministic-code-quality-signals.md`

**Release priority:** Priority 1 for 0.11.0. This feature should land before
OpenRouter guided setup because it improves the quality floor for every later
agent-authored 0.11 slice.

## Product Shape

Guildhall should not run a pile of scanners and call that judgment. It should
ship a guideline-first signal system:

1. Durable quality guidelines define what good means and why.
2. Analyzer rules attach findings to those guideline ids.
3. Findings are classified as hard gates, review signals, or trend metrics.
4. Task shaping uses the active guideline set before work starts.
5. Worker context names the relevant rules and commands.
6. Review packets include findings, review questions, waivers, and baseline
   deltas.
7. Project health tracks trend movement without pretending every trend is a
   blocker.

## Non-Goals

- Do not make a generic "run every lint tool" feature.
- Do not block work because a historical file already has old debt.
- Do not treat duplication, size, or complexity as automatically bad.
- Do not add broad external SaaS dependencies as required gates.
- Do not create public docs until the runtime behavior is implemented and
  proven.

## Acceptance Bar

The feature is ready when Guildhall can:

- store durable quality guidelines with ids, reasons, review questions, and
  default outcomes;
- normalize existing `lint:design`, `lint:reductions`, and `lint:deps` results
  into one finding shape;
- distinguish repo-baseline debt from new/touched-code regressions;
- add at least one implemented signal for each first-release family:
  design-system, dependency architecture, reduction guardrails, duplication,
  abstraction fitness, layout semantics, size, and complexity;
- feed findings into task shaping, worker context, review packets, task/run
  evidence, and trend summaries;
- support explicit waivers with reason, owner/source, scope, and optional
  expiry;
- prove that duplication findings ask "same reason to change?" before
  recommending extraction;
- prove that grid-shaped flex findings are review signals unless the project
  config promotes them;
- keep `pnpm lint:design`, `pnpm lint:reductions`, `pnpm lint:deps`,
  `pnpm typecheck`, and focused tests passing.

## Milestone 0: Baseline Inventory

**Purpose:** Ground the implementation in the existing Guildhall review/gate
surfaces instead of adding another detached script.

- [ ] Inventory current deterministic sources:
  `scripts/design-token-audit.mjs`, `scripts/reduction-guardrails.mjs`,
  `.dependency-cruiser.cjs`, review planner checks, gate runner behavior, task
  evidence writes, and project summary surfaces.
- [ ] Record which existing outputs are hard gates today and which are advisory.
- [ ] Identify the exact runtime files that build worker context, review
  packets, task evidence, and project summaries.
- [ ] Add focused tests that capture current behavior before changing output
  shape.
- [ ] Acceptance proof: a short internal audit note or tracker entry names the
  current sources, output shapes, and integration points.

## Milestone 1: Guideline Registry

**Purpose:** Make rules policy-backed before any analyzer result can influence
task or review behavior.

- [ ] Add a runtime guideline model with:
  - `id`
  - `principle`
  - `why`
  - `goodWhen`
  - `badWhen`
  - `reviewQuestion`
  - `defaultOutcome`
  - `findingFamilies`
  - `source`
- [ ] Seed the first durable guideline registry from the source spec:
  - one reason to change beats one shape to share;
  - abstractions need a contract, not just callers;
  - namespaces should explain ownership;
  - boundaries should be directional;
  - types and state should make invalid states hard;
  - UI surfaces compose roles;
  - layout should match geometry;
  - complexity should have a domain name.
- [ ] Add project config hooks so a project can disable, downgrade, promote, or
  extend guidelines without editing Guildhall runtime code.
- [ ] Add tests for guideline lookup, unknown guideline ids, override behavior,
  and stable serialization.
- [ ] Acceptance proof: unit tests demonstrate that every deterministic finding
  must carry a known guideline id unless it is explicitly marked experimental.

## Milestone 2: Finding Model And Normalizer

**Purpose:** Give every tool one common evidence format.

- [ ] Add `DeterministicFinding` with:
  - `id`
  - `guidelineId`
  - `tool`
  - `family`
  - `severity`
  - `confidence`
  - `scope`
  - `path`
  - `line`
  - `subject`
  - `message`
  - `reviewQuestion`
  - `evidence`
  - `suggestedAction`
  - `waiver`
- [ ] Add a deterministic finding normalizer that can ingest:
  - structured JSON outputs;
  - line-based script output;
  - dependency-cruiser JSON output;
  - explicitly configured custom findings.
- [ ] Add scope classification:
  - `new-code`
  - `touched-code`
  - `repo-baseline`
  - `generated`
  - `fixture`
- [ ] Add stable finding ids based on guideline, tool, path, subject, signature,
  and normalized evidence.
- [ ] Add tests for duplicate finding collapse, stable ids, severity downgrade,
  baseline classification, and generated/fixture suppression.
- [ ] Acceptance proof: existing Guildhall scripts can be represented as
  findings without changing their command-line behavior yet.

## Milestone 3: Existing Gate Adapters

**Purpose:** Bring current Guildhall checks into the new model before adding new
tools.

- [ ] Adapt `lint:design` output into design-system and layout findings.
- [ ] Adapt `lint:reductions` output into boundary/state/regression findings.
- [ ] Adapt `lint:deps` output into dependency architecture findings.
- [ ] Preserve current hard-gate behavior for these commands while adding
  structured evidence.
- [ ] Add tests proving old pass/fail semantics remain unchanged.
- [ ] Acceptance proof: running the three existing lint commands produces the
  same CLI result and a normalized finding report.

## Milestone 4: Duplication Signals With A Reason-To-Change Rule

**Purpose:** Add duplicate detection without forcing bad abstractions.

- [ ] Choose the first duplication detector:
  - preferred: `jscpd` for JS/TS/Svelte/Markdown support;
  - fallback: PMD CPD or a local normalized text detector if dependency cost is
    too high.
- [ ] Add configuration for production paths, generated paths, fixture paths,
  threshold size, and ignored stable boilerplate.
- [ ] Normalize duplication results into findings tied to Guideline 1.
- [ ] Include review questions in every duplication finding:
  - "Do these copies change for the same reason?"
  - "Would a bug fix need to land in every copy?"
  - "Is this a governed contract?"
- [ ] Add hard-gate promotion only for governed-contract duplication, not for
  ordinary similar code.
- [ ] Add tests with:
  - welcome duplication across diverging domains;
  - blocked duplication for validation/state/design-system rules;
  - generated/fixture suppression;
  - divergence-after-copy review signal.
- [ ] Acceptance proof: duplication findings never recommend extraction without
  carrying the reason-to-change review question.

## Milestone 5: Abstraction Fitness Signals

**Purpose:** Catch bad shared abstractions and missing contracts without
punishing intentional small local code.

- [ ] Add low-fan-in abstraction scans for new exported helpers/components with
  one production caller.
- [ ] Add generic-name scans for `utils`, `helpers`, `common`, `shared`, `base`,
  `misc`, broad `models`, and broad `types` modules.
- [ ] Add component variant-budget scans for governed package UI primitives.
- [ ] Add dependency graph signals for shared modules that import feature/surface
  code.
- [ ] Add tests for:
  - welcome single-use local helper;
  - review-signal single-use exported abstraction;
  - hard-gate package UI variant-budget violation;
  - generic module name with clear contract exception;
  - shared code importing feature code.
- [ ] Acceptance proof: abstraction findings ask what invariant the abstraction
  protects and distinguish local helper extraction from shared-contract claims.

## Milestone 6: Layout And Design-System Signals

**Purpose:** Turn the existing anti-sprawl policy into role-aware findings.

- [ ] Add or extend a Svelte/CSS classifier that labels files/components as:
  `surface`, `layout`, `primitive`, `data-bound`, `store`, `fixture`,
  `generated`, or `test`.
- [ ] Extend `lint:design` to report guideline ids and review questions.
- [ ] Add grid-shaped flex review signals:
  - flex parent with fixed/equal child widths;
  - flex parent with dashboard/panel/repeated-row class names;
  - flex wrapping used for multi-column panel structure;
  - repeated child classes that define column widths.
- [ ] Keep flex allowed for inline controls, icon/text alignment, chips,
  toolbars, and wrapped/flowing item groups where row and column gaps matter.
- [ ] Add hard gates for:
  - `float` and `clear` outside compatibility paths;
  - new raw governed style values in data-bound components;
  - duplicate canonical primitive jobs over the accepted threshold;
  - package UI variant-axis violations.
- [ ] Add tests for grid-shaped flex signal classification, data-bound style
  hard gates, surface layout glue allowances, and fixture/generated suppression.
- [ ] Acceptance proof: a data-bound component adding raw local typography
  blocks, while a chip row using flex does not.

## Milestone 7: Size, Complexity, And Type/State Signals

**Purpose:** Add general-purpose maintainability signals that map to real code
organization guidelines.

- [ ] Add ESLint or equivalent AST-based checks for function complexity, max
  statements, and max depth in JS/TS paths.
- [ ] Add component size budgets for Svelte:
  - script lines;
  - template nodes;
  - style lines;
  - exported props;
  - store/fetch bindings.
- [ ] Add type/state checks for explicit `any`, unchecked `JSON.parse`, direct
  writes to guarded state fields, boolean clusters, and permissive default
  branches in core state paths.
- [ ] Keep high complexity as a review signal by default unless it appears in
  surface glue or bypasses a known runtime owner.
- [ ] Add tests for domain-owned complex modules that remain allowed and surface
  complexity that triggers review.
- [ ] Acceptance proof: findings distinguish "complex parser/state machine with
  tests" from "complex UI surface reinterpreting shared runtime state."

## Milestone 8: Task Shaping And Worker Context

**Purpose:** Use signals before agents write code.

- [ ] Teach task shaping to select guideline families from task type, likely
  target files, changed files, and project toolchain profile.
- [ ] Add worker context sections that name:
  - relevant guidelines;
  - hard gates;
  - review signals;
  - commands to run;
  - known baseline debt that should not be worsened.
- [ ] Ensure UI/design tasks include design-system and layout guidelines.
- [ ] Ensure runtime/task-lifecycle tasks include state, boundary, dependency,
  and type/state guidelines.
- [ ] Ensure shared-helper/component tasks include duplication and abstraction
  guidelines.
- [ ] Acceptance proof: generated worker packets for representative tasks carry
  concise guideline-specific context, not generic "write good code" prose.

## Milestone 9: Review Packets, Evidence, And Waivers

**Purpose:** Make deterministic findings usable in review without turning them
into naive pass/fail truth.

- [ ] Add finding groups to review packets:
  - blockers;
  - review signals;
  - trend deltas;
  - unchanged baseline debt;
  - active waivers.
- [ ] Add waiver receipts with guideline id, finding id, reason, owner/source,
  path/scope, and optional expiry.
- [ ] Add policy that waivers can downgrade or suppress findings only inside
  their declared scope.
- [ ] Add run/task evidence writes for finding reports and waiver receipts.
- [ ] Add tests for scoped waivers, expired waivers, unrelated baseline debt,
  and review packet grouping.
- [ ] Acceptance proof: review packets show "why this matters" and the review
  question for non-blocking findings.

## Milestone 10: Project Health And Trend Summaries

**Purpose:** Let Guildhall show drift and improvement without making every
metric a blocker.

- [ ] Add project-level trend summaries for:
  - design-system baseline burn-down;
  - duplicate percentage on new/touched code;
  - suspicious grid-shaped-flex count;
  - largest touched components;
  - average callers per shared export;
  - local CSS lines by component role;
  - waiver count and age.
- [ ] Keep trend summaries out of hard gates unless a project explicitly
  promotes them.
- [ ] Add UI/API fields only through shared runtime summary builders, not local
  view math.
- [ ] Add tests that Overview, review packets, and task evidence consume the
  same shared trend model.
- [ ] Acceptance proof: two surfaces cannot disagree about deterministic quality
  summary state because they render the same shared runtime result.

## Milestone 11: External Toolchain Profiles

**Purpose:** Make the feature general-purpose across languages without forcing
every project onto Guildhall's JS/Svelte defaults.

- [ ] Add toolchain-profile detection for JS/TS/Svelte, Python, Go, Rust, Java,
  and generic unknown projects.
- [ ] Map ecosystem-specific tools to the shared guideline families:
  - ESLint / typescript-eslint;
  - Stylelint;
  - dependency-cruiser;
  - jscpd or CPD;
  - Knip;
  - Semgrep;
  - ast-grep;
  - ecosystem-native tools when present.
- [ ] Treat unavailable tools as capability findings, not project failures.
- [ ] Add project config to choose commands, disable tools, and set severity
  promotion/demotion rules.
- [ ] Add tests for absent tools, custom commands, unsupported project types,
  and multiple language roots.
- [ ] Acceptance proof: Guildhall can explain which signals it can and cannot
  produce for a project before running work.

## Milestone 12: End-To-End Proof

**Purpose:** Prove the feature reduces wheel reinvention in Guildhall itself.

- [ ] Add a fixture or test project with intentional:
  - welcome duplication;
  - bad duplicate validation logic;
  - premature shared helper;
  - generic `utils` module;
  - data-bound raw styles;
  - grid-shaped flex layout;
  - high-complexity surface logic;
  - domain-owned complex state machine.
- [ ] Run task shaping, worker context generation, analyzer execution, review
  packet generation, waiver handling, and project health summary against the
  fixture.
- [ ] Add browser/API proof for the owner-facing summary if UI surfaces are
  touched.
- [ ] Update the source spec with any corrected rules discovered during proof.
- [ ] Acceptance proof: the fixture demonstrates that Guildhall blocks clear
  regressions, asks useful questions for judgment-heavy findings, and does not
  force extraction for welcome duplication.

## First Implementation Slice

Start here:

1. Milestone 0 inventory.
2. Milestone 1 guideline registry.
3. Milestone 2 finding model.
4. Milestone 3 adapters for existing checks.

This first slice gives Guildhall a policy-backed finding substrate without
adding new external tools yet. The next slice can then add duplication and
abstraction signals without confusing "tool installed" with "rule understood."

## Verification Commands

Use focused commands as implementation expands, but each landed slice should at
minimum run:

```sh
pnpm vitest run <focused-runtime-and-script-tests> --reporter=dot
pnpm lint:design
pnpm lint:reductions
pnpm lint:deps
pnpm typecheck
git diff --check
```

If UI summaries or review surfaces change, also run the relevant Svelte tests
and browser/API proof against the active test project named in
`artifact:flow-audit`.
