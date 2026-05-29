# Progress Log

This file is an append-only log of agent activity.
Read the most recent entries to understand current project state.
Agents append here via the log-progress tool.

---

### 🏁 MILESTONE — 2026-04-11T00:00:00Z
**Agent:** human | **Domain:** forge

Forge v0.1 scaffolded. Monorepo structure, all packages, agents, tools, gates, memory
system, JIT context builder, and orchestrator are in place. SPEC.md written with
acceptance criteria for v0.1. Tests written for @guildhall/core and @guildhall/tools.
Ready for pnpm install and first run.

---
## 2026-05-27T19:48:44.449Z MCP evidence for flow-audit

Condensed the public first-read docs path for source/0.9 and /versions/0.8.0: Start here is now first, the old Introduction is retitled Why Guildhall exists, Core concepts remains glossary support, and How Guildhall works is retitled/moved as How the work loop works under How it works. Verified with pnpm docs:check-copy, pnpm docs:build, and browser click-through of source and 0.8 docs CTAs/breadcrumbs.

source: codex-docs-review
## 2026-05-27T19:51:30.292Z MCP evidence for flow-audit

Follow-up docs header polish: the VitePress header version dropdown now labels itself with the selected docs line instead of the generic word Version. Browser preview verified current /guide/quick-start shows v0.8, /next/guide/quick-start shows v0.9, /versions/0.8.0 shows v0.8, and /versions/0.7.0 shows v0.7.

source: codex-docs-review
## 2026-05-28T22:41:27.720Z MCP evidence for milestone-20

Lane 1 Hermes comparison evidence pass: Guildhall smoke outputs rerun with token/cost/turn/command/latency fields; Hermes v2026.5.28/current-main temp installs checked; Hermes task run blocked because documented benchmark entrypoints are absent locally and provider/Modal credentials are unavailable. Details recorded in internal/benchmarks/hermes-comparison-2026-05-28.md.

source: codex

## 2026-05-29T15:08:54.000Z local evidence for guildhall-architecture-006

Fixed the misleading Guildhall 5/100 app-comparison result. The worker had created Pantry Pulse in the task worktree, but the comparator only graded the project root, so it produced no Guildhall screenshots and undercounted quality. `scripts/compare-hermes-quality.mjs` now discovers both legacy array and current versioned `.guildhall/TASKS.json` worktree paths, grades app artifacts from the actual source root, records whether output landed in the project root, and uses unique benchmark project ids to avoid rerun worktree collisions. Regenerated the old Guildhall app screenshot evidence and score from 5/100 to 87/100, with remaining penalties for worktree-only output and unclean exit. Verification: node --check, focused comparator/Hermes policy Vitest tests, and git diff --check passed.

source: codex
## 2026-05-28T22:43:03.756Z MCP evidence for task-pantry-pulse-live

Pantry Pulse Lane 2 live rerun did not create the app: live spec/design-system improved, but blueprint sanity rejected approved Markdown because structured acceptanceCriteria stayed empty; task sizing converted the app spec into a parent with unrelated analytics/documentation child. Report: internal/fixtures/app-spec-smoke/runs/2026-05-28-lane2-pantry-pulse-live/run-report.md

source: codex-lane2
## 2026-05-29T14:07:48.288Z MCP evidence for guildhall-architecture-006

Refined Pantry Pulse design-quality proof after live run exposed a generic blue accent despite warm-domestic palette prose. Added a format-agnostic palette token audit for CSS custom properties, Sass/Less variables, JS/TS token objects, JSON/YAML-like tokens, and similar token sources; updated Pantry Pulse completion boundary, proof checklist, recorded run, design-taste defaults, and live benchmark test so generic cool-blue/medical-blue primary accents fail unless accepted design decisions justify them. Verification: focused Vitest app-spec/design-taste tests passed; typecheck passed; git diff --check passed.

source: codex
## 2026-05-29T14:25:43.108Z MCP evidence for guildhall-architecture-006

Added a neutral quality-first Guildhall-vs-Hermes comparator script instead of depending on missing Hermes benchmark entrypoints. New `scripts/compare-hermes-quality.mjs` runs `guildhall task run-once` and `hermes -z` against the same prompt in separate projects, grades user-visible artifacts first, records token/cost telemetry secondarily, and writes JSON/Markdown reports. Added `benchmarks:compare:hermes-quality` package script and packaging-policy coverage to keep Hermes/dev comparator surfaces out of distributed Guildhall. Ran the comparator on 2026-05-29: deterministic file task scored Guildhall 100/100 and Hermes 100/100; Hermes was faster, Guildhall used its normal pressure-test/review/gate path. Pantry Pulse live run timed out at 15 minutes while still in progress after spec recovery and worker no-change passes, so it is not a design-quality pass yet. Verification: node --check, scripts/hermes-dev-policy.test.ts, pnpm typecheck, and git diff --check passed.

source: codex
## 2026-05-29T14:45:15.914Z MCP evidence for guildhall-architecture-006

Extended the neutral Hermes comparator with app-quality mode and screenshot proof. `scripts/compare-hermes-quality.mjs --mode app` now prompts both Guildhall and Hermes to build a dependency-free Pantry Pulse app, serves generated static apps, runs Playwright checks for browser load, heading, seeded items, expiring filter, Mark used behavior, captures desktop/mobile screenshots, audits warm domestic palette fit, and embeds screenshot refs in the Markdown report. Added package script `benchmarks:compare:hermes-app` and updated the Hermes runbook. Ran app comparison on 2026-05-29: Guildhall scored 5/100 because it reached worker execution but did not produce index.html before the 10-minute comparator timeout; Hermes scored 100/100 on deterministic checks and produced desktop/mobile screenshots. Manual visual note: Hermes result passes behavior/palette gates but still reads as a modest utility, not a strong app-store-caliber design. Verification: node --check, hermes dev policy test, and git diff --check passed.

source: codex
## 2026-05-29T14:49:57.111Z MCP evidence for guildhall-architecture-006

Split the Hermes app-quality comparator into two explicit benchmark shapes after clarifying that the previous Hermes screenshot run used a prompt with palette/quality constraints. `scripts/compare-hermes-quality.mjs` now distinguishes `--mode app-explicit` (explicit behavior/palette/accessibility/quality constraints, measuring instruction following) from `--mode app-infer` (sparse Pantry Pulse product idea, measuring design/product inference). Package scripts are now `benchmarks:compare:hermes-app-explicit` and `benchmarks:compare:hermes-app-infer`; runbook now labels the 2026-05-29 Hermes screenshots as explicit-brief evidence, not inference evidence. Verification: node --check, Hermes dev policy test, and git diff --check passed.

source: codex

## 2026-05-29T15:56:00.300Z local evidence for guildhall-architecture-006

Fixed the Pantry Pulse/Guildhall-vs-Hermes prompt-quality failures exposed by the app comparison audit. Worker context now infers `index.html` for dependency-free single-file web specs, preserves raw draft `design-system.yaml` as authoritative context when schema normalization fails, suppresses stale generic "New request" product briefs, and injects a compact frontend/UI design quality bar. Review packets now include Visual Evidence and explicitly block UI review approval when screenshots/live rendered proof are missing. Reviewer context-debug snapshots now include the formatted context so persona role guidance can be audited. The Visual Designer guild now reviews product-grade composition, realistic density, and rendered visual evidence instead of token compliance alone. Verification: focused Vitest pass over context builder, orchestrator, reviewer fan-out, guild registry, and persona reviewer tests passed (381 tests).

source: codex
