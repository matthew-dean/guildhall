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

## 2026-05-29T16:29:17.300Z local evidence for guildhall-architecture-006

Reran the explicit Pantry Pulse Guildhall-vs-Hermes app comparison after design-context fixes. Guildhall still did not reach app implementation: first rerun stopped at ready because task readiness marked the bounded app as split, second rerun stalled in spec recovery around external-browser validation and empty structured acceptance criteria. Fixed the exposed automation gaps: fully automated mode now replaces generic "verify whether <title> is already done" product briefs from the drafted spec, extracts structured acceptance criteria from the spec before approval, and the spec validator treats a local browser used only for proof as verification environment rather than an external runtime dependency. Also tightened Spec Agent guidance so audit-style brief wording quotes request labels and is not used for normal build requests. Verification: focused run-automation/intake/run-once/task-sizing/spec-agent tests passed, and git diff --check passed.

source: codex

## 2026-05-29T15:08:54.000Z local evidence for guildhall-architecture-006

Fixed the misleading Guildhall 5/100 app-comparison result. The worker had created Pantry Pulse in the task worktree, but the comparator only graded the project root, so it produced no Guildhall screenshots and undercounted quality. `scripts/compare-hermes-quality.mjs` now discovers both legacy array and current versioned `.guildhall/TASKS.json` worktree paths, grades app artifacts from the actual source root, records whether output landed in the project root, and uses unique benchmark project ids to avoid rerun worktree collisions. Regenerated the old Guildhall app screenshot evidence and score from 5/100 to 87/100, with remaining penalties for worktree-only output and unclean exit. Verification: node --check, focused comparator/Hermes policy Vitest tests, and git diff --check passed.

source: codex
## 2026-05-28T22:43:03.756Z MCP evidence for task-pantry-pulse-live

Pantry Pulse Lane 2 live rerun did not create the app: live spec/design-system improved, but blueprint sanity rejected approved Markdown because structured acceptanceCriteria stayed empty; task sizing converted the app spec into a parent with unrelated analytics/documentation child. Durable summary: internal/benchmarks/history/2026-05-29-pantry-pulse-live-proof.md

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

2026-05-29T16:55:20Z - Corrected run-once/intake title persistence: long requests now store semantic labels without ellipsis while preserving the full ask in description/product brief. Added tests for run-once, intake, fully automated spec synthesis, and product-brief fallback behavior.

2026-05-29T17:01:15Z - Added worker lifecycle recovery: dirty worker output plus a newly recorded self-critique now promotes to review even if the worker misses the status transition tool. This prevents Pantry Pulse-style runs from looping in in_progress after valid implementation evidence.

2026-05-29T17:30:20Z - Completed the efficiency/quality slice checklist: Hermes comparisons now launch Guildhall and Hermes in parallel and emit a phase/task-event timeline; bounded deterministic UI tasks get a lean profile with one taste/accessibility review before hard proof gates; worker handoff guidance now requires proof before first review, including UI rendered-state proof; New Request no longer asks the user for a title, and task titles can be edited later from the drawer without compacting the stored request. Verification: focused comparator/task-sizing/reviewer-fanout tests passed, focused intake/drawer/intake-runtime/serve-endpoint tests passed, and pnpm exec tsc --noEmit passed.
## 2026-05-29T17:41:34.714Z MCP evidence for flow-audit

Tied glass modal translucency to blur/saturate filtering for 0.9.0 UI polish. Added shared --glass-filter, --glass-modal-bg, and --glass-modal-filter tokens, moved base Modal and IntakeModal glass shells onto the modal tokens, added a regression in scripts/glass-design-system.test.ts, and recorded the result in artifact:flow-audit. Verification: pnpm vitest run scripts/glass-design-system.test.ts src/web/surfaces/__tests__/IntakeModal.svelte.test.ts --reporter=dot passed; pnpm typecheck passed.

source: codex
## 2026-05-29T17:43:30.273Z MCP evidence for flow-audit

Completed live verification for the glass modal invariant. After pnpm build still showed the active browser target serving stale CSS, refreshed the installed artifact with pnpm dev:install, restarted Guildhall with guildhall stop && guildhall start, and verified http://localhost:7777/projects/narrative-harness. Opening New request produced a translucent modal whose computed backdrop-filter was blur(22px) saturate(1.18).

source: codex

2026-05-30T03:20:00Z - Reframed the shell command write guard around the runtime boundary. Host-run compatibility mode still blocks obvious shell redirection/heredoc writes during task-scoped execution, but runtime-backed mode now allows project-local writes because the container is the write boundary; Guildhall global/state protection belongs in the runtime mount policy, not an in-container shell-string heuristic. Also fixed a false positive where JavaScript arrows/comparisons in `node -e` Playwright proof commands looked like redirects. Verification: focused shell/run-once/comparator Vitest tests passed, typecheck passed, and pnpm build passed.

2026-05-30T03:25:00Z - Ran same-model Pantry Pulse explicit app comparisons. DeepSeek V4 Flash on both harnesses: Guildhall 85/100, Hermes 60/100; Guildhall completed through review/gate/browser proof, while Hermes loaded but screenshot capture in the comparator failed and manual screenshots showed a washed-out, low-contrast result. Qwen/Qwen3.5-35B-A3B on both harnesses: Guildhall 100/100, Hermes 100/100; Guildhall was plain but functional, Hermes was more visually ambitious but showed layout/control polish issues. Evidence: internal/benchmarks/runs/2026-05-29-quality/pantry-pulse-same-model-deepseek-v4-flash-rerun2 and internal/benchmarks/runs/2026-05-29-quality/pantry-pulse-same-model-qwen-35b-a3b. Remaining gap: deterministic scoring still rewards functional compliance too much and needs stronger visual-quality gates for contrast, overlap, density, visible control affordance, and app-store-caliber composition.

2026-05-30T04:20:00Z - Hardened comparator screenshot capture after the DeepSeek/Hermes run produced loadable HTML but no report screenshots. App screenshots are now captured immediately after browser load, before interaction checks can fail, click probes recover from non-clickable matched text, and browser/server cleanup runs from the `finally` path. Verification: focused comparator/shell/run-once Vitest tests passed, typecheck passed, node --check passed, and git diff --check passed.

2026-05-30T03:45:30Z - Added live role-by-model bakeoff support for model selection before full app benchmarks. `guildhall model-bakeoff --live` now runs provider-backed spec, worker, reviewer, gate, and context-indexer scenarios across candidate models, records pass/fail quality, false approvals/escalations, missed signals, wall time, token/cache usage, and estimated catalog cost. Added Nemotron 3 Nano Omni 30B A3B Reasoning as a DeepInfra challenger, shifted public open-model guidance toward DeepSeek V4 Flash for UI/product work while demoting Qwen lanes to mechanical/background or experimental use, and documented the live role comparison path. Real smoke: `node dist/cli.js model-bakeoff --live --provider openai-api --models deepseek-ai/DeepSeek-V4-Flash,nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning --roles reviewer,gate artifacts/model-bakeoff/live-role-deepseek-nemotron-smoke.json` produced Markdown/JSON under ignored `artifacts/model-bakeoff/`; DeepSeek passed reviewer+gate, Nemotron passed gate and was fast but missed reviewer visual-quality signals. Verification: focused model-bakeoff/CLI/model-catalog Vitest tests passed; pnpm exec tsc --noEmit passed; pnpm build passed; docs copy/help checks passed; git diff --check passed.

2026-05-30T03:49:22Z - Added two more DeepInfra challenger models to the 0.9 live bakeoff set: `nvidia/NVIDIA-Nemotron-3-Super-120B-A12B` as a low-cost larger Nemotron reasoning/tool-use candidate, and `XiaomiMiMo/MiMo-V2.5` as a cached-input multimodal agentic UI/product worker and reviewer candidate. Public open-model guidance now lists both as challengers, not defaults; MiMo stays out of recommended context-indexer roles until it beats GLM/DeepSeek in the semantic ladder. Verification: focused model-catalog/model-bakeoff/CLI Vitest tests passed; pnpm exec tsc --noEmit passed; docs copy/help checks passed; git diff --check passed.

2026-05-30T04:05:52Z - Ran the live role challenge across DeepSeek V4 Flash, Nemotron Nano, Nemotron Super, and MiMo V2.5 after fixing the bakeoff runner to launch independent model/scenario calls concurrently with default concurrency 200. The first run exposed an unfair worker packet, so the worker scenario now includes the accepted Pantry Pulse details it scores against; the matcher now tolerates simple singular/plural word-form differences. Final report: `artifacts/model-bakeoff/live-role-challenge-deepseek-nemotron-mimo-2026-05-30-rerun3.md` (ignored artifact). Result: Nemotron Nano won spec, worker, gate, and context-indexer on this role smoke; MiMo won reviewer by the current summary score; Nemotron Super was high quality when it passed but much slower. Verification: focused model-bakeoff Vitest tests passed; pnpm exec tsc --noEmit passed; pnpm build passed.

2026-05-30T21:14:42Z - Ran the real Pantry Pulse app comparison with `nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning` assigned to every Guildhall role and Hermes using the same model. Report: `internal/benchmarks/runs/2026-05-29-quality/pantry-pulse-same-model-nemotron-nano-rerun1/quality-comparison-report.md`. Result: Guildhall 14/100, Hermes 17/100, no screenshots, and no `index.html` from either harness. Guildhall timed out after repeated worker no-progress passes/escalation recovery; Hermes exited quickly after emitting a pseudo terminal call in stdout but did not create files. Also hardened `scripts/compare-hermes-quality.mjs` so future successful app runs copy each generated `index.html` into `app-artifacts/` with model, provider, harness/agent, source path, command, browser proof, palette audit, and repo commit metadata. Verification: comparator syntax check, focused comparator Vitest tests, and git diff --check passed.

2026-05-30T21:42:00Z - Added smaller deterministic live bakeoff suites so model comparison can separate worker tool-use, reviewer calibration, and context-indexer fit from the full Pantry Pulse app benchmark. `guildhall model-bakeoff --live` now accepts `--scenario-set default|worker-tool-use|reviewer-calibration|context-indexer-calibration`, records the selected suite in the JSON/Markdown report, and the built-in suites focus on exact file mutation/proof recovery, missing-proof plus weak-UI reviewer catches, and canonical primitive/current-source-of-truth context summaries. Verification: focused model-bakeoff and CLI Vitest tests passed; `pnpm exec tsc --noEmit`, `pnpm docs:check-help-sync`, and `git diff --check` passed.
2026-05-30T22:05:00Z - Wrote the neutral benchmark core spec to replace benchmark-shaped smoke stubs with a shared fixture/run/verification/scoring/evidence substrate. New spec: `internal/specs/2026-05-30-guildhall-0-9-neutral-benchmark-core.md`. It defines checked-in seed-directory fixtures, real `tblite` and `swe-local` lanes, a new `artifact-local` family, shared failure taxonomy, normalized evidence contracts, and phased implementation. Linked it from the existing 0.9 benchmark plan and the main 0.9 implementation tracker so future work has one canonical benchmark-core reference.
2026-05-30T22:32:00Z - Started implementing the neutral benchmark core. Added the implementation plan at `internal/plans/2026-05-30-guildhall-0-9-neutral-benchmark-core-implementation-plan.md`, converted benchmark fixture loading to disk-backed checked-in seed directories plus manifests, added the first `artifact-local` family and seed fixture, moved `tblite` smoke onto a checked-in seed project, and replaced the benchmark lane's noop command execution with a tiny local runtime backend so the command actually runs before verifier grading. Added focused tests for disk-backed fixtures, artifact-local execution, and CLI help coverage. Verification: `pnpm exec vitest run src/benchmarks/__tests__/benchmarks.test.ts src/runtime/__tests__/cli.test.ts --reporter=dot`, `pnpm exec tsc --noEmit`, and `git diff --check` passed.
2026-05-30T22:40:00Z - Continued the neutral benchmark core by making `swe-local` use the real `runGuildhallTaskOnce` seam instead of metadata-only pass records. Added a seeded SWE-local fixture with a tiny multi-file bug (`src/App.tsx` + `src/messages.ts`), a deterministic `pnpm test -- copy-fix` verifier, and runner support for a benchmark-scoped `runOnceImpl` override so tests can stub the run-once path while production runs use the real one. Verification: `pnpm exec vitest run src/benchmarks/__tests__/benchmarks.test.ts src/runtime/__tests__/cli.test.ts src/runtime/__tests__/run-once.test.ts --reporter=dot`, `pnpm exec tsc --noEmit`, and `git diff --check` passed.
2026-05-30T22:47:00Z - Hardened the normalized benchmark evidence model. `BenchmarkRunResult` now records per-run verifier outcomes and touched-file sets, `renderBenchmarkMarkdown` surfaces those fields in the report table, and the benchmark runner computes touched files by diffing each materialized project against its checked-in seed directory. Also fixed a small unrelated nullability mismatch in `src/runtime/serve.ts` so `tsc --noEmit` returns cleanly again. Verification: `pnpm exec vitest run src/benchmarks/__tests__/benchmarks.test.ts src/runtime/__tests__/cli.test.ts src/runtime/__tests__/run-once.test.ts --reporter=dot`, `pnpm exec tsc --noEmit`, and `git diff --check` passed.

2026-05-30T21:36:00Z - Removed the hidden DeepSeek model hard-pin from the live Pantry Pulse proof harness. `runFullyAutomatedPantryPulse` now builds its orchestrator options without provider/model assignment overrides, so the proof lane follows normal config resolution unless a caller explicitly overrides it. Added a focused regression in `src/runtime/__tests__/app-spec-smoke.test.ts` to keep the harness from quietly forcing one model family again. Verification: focused `app-spec-smoke` Vitest checks passed.
2026-05-31T20:28:00Z - Hardened bounded-chat proof for the first 0.10 intake slice. Project check-in bounded chat now has regression coverage for exhausting all planned root questions before closure, reusing the same active session when the owner comes back later, recording confused answers as discarded instead of durable guidance, persisting accepted answers/decisions/closure receipts to the saved bounded-chat file, and projecting a completed Thread turn after fulfillment so the chat does not disappear from the feed. Also widened New request coverage to assert stored request-intake data for release ideas, ordinary task asks, project questions, and ambiguous policy/spec requests. Verification: `pnpm vitest run src/runtime/__tests__/intake.test.ts src/runtime/__tests__/request-routing.test.ts src/runtime/__tests__/pressure-test-intake.test.ts src/runtime/__tests__/project-question-planner.test.ts src/runtime/__tests__/bounded-chat.test.ts src/runtime/__tests__/thread.test.ts src/runtime/__tests__/serve-intake.test.ts --reporter=dot` (161 passed) and `pnpm typecheck` passed.
## 2026-05-30T22:04:22.084Z MCP evidence for flow-audit

Ran a live 0.9 readiness walkthrough against Looma + Knit and Narrative Harness. Fixed owner-facing trust-copy regressions: project_understanding now says Update project understanding with Review findings, the topbar shows Host-run/Podman instead of generic Runtime, and Thread hides stale setup unknown-error when the project is host-run. Verified with 142 focused tests, typecheck, stale:false on a fresh serve-internal :7778 browser pass. Remaining blockers: package/service still present as v0.8.0, pnpm dev:install fails because packaged runtime node cannot load libnode.141.dylib, and high-pressure project headers remain crowded.

source: Codex browser walkthrough 2026-05-30
## 2026-05-30T22:12:03.118Z MCP evidence for flow-audit

Fixed the topbar overlap bug called out from the Looma + Knit screenshot. Root cause: status labels stayed expanded until 720px and .topbar-leading could overflow outside its grid track, so around 1024px it painted into New request / run actions. Patched ProjectView so labels collapse at 1080px, the status strip is width:100% inside its grid cell, and overflow scrolls internally. Verified ProjectView test red/green, 142 focused tests, typecheck, build, and fresh serve-internal :7778 browser measurements with no overlap across 1180..600px.

source: Codex browser walkthrough 2026-05-30
## 2026-05-30T22:23:01.852Z MCP evidence for artifact:flow-audit

Resolved the 0.9.0 Looma + Knit trust blockers found in browser walkthrough: package/app now present as v0.9.0, macOS dev install copies the packaged runtime node's @rpath dylib and launch-agent install succeeds, the installed service reports stale:false from /Users/matthew/.guildhall/app/0.9.0/app/dist/cli.js, and in-app browser verification showed Update project understanding / Review findings copy, no missing-repo-evidence wording, no setup unknown-error, compatibility-mode runtime truth, and no topbar overlap across 1180-600px widths. Focused regression suite passed with 151 tests; full pnpm typecheck remains blocked by separate dirty benchmark fixture deletion/import drift.

source: codex:trust-blocker-fix
## 2026-05-30T22:27:59.378Z MCP evidence for artifact:flow-audit

Fixed and recorded the Narrative Harness stale question-card remediation: context-summary choice cards like "Key context from what I've read:" are now classified as operational receipts instead of owner questions; the matching Narrative Harness author-voice-loop-mvp stale cards were answered/resolved with bug-clearance notes; focused visibility/post-user-question tests passed after failing first.

source: codex
## 2026-05-30T22:30:42.781Z MCP evidence for artifact:flow-audit

Applied the follow-up topbar critique from the Looma + Knit settings/ready screenshot: the project topbar now keeps navigation and deliberate commands only. Ordinary host-run runtime mode, stuck-work count, inbox count, and disabled Waiting on answer state no longer render as topbar buttons; the existing answer banner remains the primary next-step surface. Verified with ProjectView regression tests (33 passed), focused 0.9 trust regression suite (152 passed), pnpm dev:install, stale:false from /Users/matthew/.guildhall/app/0.9.0/app/dist/cli.js, and browser inspection showing the wide topbar reduced to Projects, New request, and overflow with no Host-run/Stuck/Needs you/Waiting on answer header controls.

source: codex:topbar-declutter
## 2026-05-30T22:34:31.215Z MCP evidence for guildhall-architecture-006

Fixed the Looma + Knit Facts Environment trust gap: `/api/project/facts` now treats `kind: workspace` roots as council shells and returns child project environment contracts from `projects[]`/child bootstrap data. The Facts UI renders Looma and Knit separately with their package managers and gates instead of presenting root `no package.json` detection as both projects' truth. Verification: focused serve-settings/FactsTab Vitest suite passed with 47 tests; `pnpm typecheck` passed.

source: codex
## 2026-05-30T22:35:10.727Z MCP evidence for artifact:flow-audit

Audited registered projects for stale bug-produced question cards after the Narrative Harness fix. The scan covered Looma + Knit, t-minus-t, Fair Labor License, Font Something, Narrative Harness, Commerce Project, and the Guildhall checkout state. One additional stale open card was found in Font Something (`import-model-rust-outline-extension`): a research-budget/context summary still present as an unanswered open question. It was answered with an explicit bug-clearance note, the existing attention history gained resolution detail, and Font Something PROGRESS.md records the cleanup.

source: codex
## 2026-05-30T22:39:23.796Z MCP evidence for artifact:flow-audit

Restored the primary run/action slot after topbar decluttering. The Looma + Knit owner-input state now keeps a visible disabled Answer first button in the toolbar instead of removing the run control or showing Waiting on answer; the answer banner remains the active navigation to Thread. Verified with a failing ProjectView regression first, then ProjectView tests (33 passed), focused trust suite (152 passed), pnpm dev:install, stale:false from the installed 0.9.0 service, and browser inspection showing wide toolbar buttons: Projects, New request, disabled Answer first, overflow.

source: codex:run-slot-restore
## 2026-05-30T22:45:00.000Z MCP evidence for artifact:flow-audit

Strengthened the neutral benchmark core for 0.9.0. `tblite` and `swe-local` now load all checked-in fixture directories in their subset instead of a single hardcoded case, with second smoke fixtures added for JSON flag repair and helper-copy repair. Benchmark results and markdown reports now include expected scope, missing expected files, and unexpected touched files so over-editing becomes visible instead of hidden behind a passing verifier. Focused benchmark, CLI, and run-once suites passed; benchmark tests now materialize fixture repos in temp directories instead of leaving `.guildhall/benchmark-fixtures` litter in the repo.

source: codex:neutral-benchmark-core-scope-fit
## 2026-05-30T22:49:00.000Z MCP evidence for artifact:flow-audit

Extended the neutral benchmark core again. `artifact-local` now supports deterministic apply commands, has a second smoke fixture, and benchmark scoring can demote verifier-green runs to `false_success`/`inconclusive` when the touched-file scope misses required files or edits extra ones. The new artifact-local overreach fixture proves that path, and the existing SWE-local stale-label fixture now surfaces as a false-success instead of a clean pass because it fixes copy in the wrong file. Verified with focused benchmark suite, focused benchmark CLI help test, run-once tests, typecheck, and diff-check. A broader full `cli.test.ts` sweep still has an unrelated pre-existing task-sizing assertion failure (`recommendedVariantId` null in the task-sizing corpus test).

source: codex:neutral-benchmark-false-success-guard
## 2026-05-30T22:59:00.000Z MCP evidence for artifact:flow-audit

Added weighted benchmark quality scoring to the neutral benchmark core. Benchmark results now carry a `qualityScore` computed from fixture `scoringWeights` plus normalized metric contributions, and benchmark summaries now report scoreable-result count and average quality. `tblite`, `swe-local`, and `artifact-local` fixture manifests now weight scope-sensitive metrics (`expected_file_coverage`, `false_success_guard`, and where relevant `over_editing`) so verifier-green overreach shows up both categorically and numerically. Verified with the benchmark suite, focused benchmark CLI-help slice, run-once tests, and diff-check. Full `tsc --noEmit` is currently blocked by unrelated existing runtime type errors in `context-builder.ts`, `design-lens-review.ts`, `orchestrator.ts`, and `request-intake.ts`.

source: codex:neutral-benchmark-quality-score
## 2026-05-30T23:02:00.000Z MCP evidence for artifact:flow-audit

Added benchmark report consumers for the new quality-score layer. Benchmark results now persist a per-metric `qualityBreakdown`, report helpers can rank results by `qualityScore`, and markdown output includes a `Quality why` column that leads with the weakest signals first so false-success and over-editing penalties are visible without re-deriving the math. Verified with the benchmark suite, focused benchmark CLI-help slice, run-once tests, and diff-check.

source: codex:neutral-benchmark-quality-consumers
## 2026-05-30T22:44:37.327Z MCP evidence for artifact:flow-audit

Fixed the confusing owner-question affordances on Looma + Knit Overview. The disabled toolbar prerequisite now says Blocked instead of action-like Answer first. The hero Needs you status is now a button with visible Open Thread → copy and routes to /projects/looma-knit/thread. Pending owner-question inbox items use explicit Answer question copy, and Needs you rows show a visible action cue. Verified focused ProjectView/Overview tests (44 passed), broader trust suite (154 passed), pnpm dev:install, stale:false from installed 0.9.0 service, and live browser click from the hero Needs you card to /projects/looma-knit/thread.

source: codex:question-navigation-fix
## 2026-05-30T23:00:01.122Z MCP evidence for artifact:flow-audit

Audited and removed high-risk prose keyword inference that produced unrelated Narrative Harness split cards. Deterministic task sizing no longer auto-materializes children; request intake/routing, envelope guardrails, design lens routing, visual-proof classification, design-feedback classification, git-log import, and guild applicability now avoid task-prose keyword classification. Repaired Narrative Harness author-voice-loop-mvp by removing the two unrelated child tasks and restoring spec_review with no recommended children. Verified focused tests (189 passed), pnpm build, dev install/restart, stale:false, and browser proof that the task UI no longer shows the bogus admin/analytics cards or question-missing state.

source: codex

## 2026-05-31T00:40:00.000Z MCP evidence for artifact:flow-audit

Repaired semantic split sizing and the worker handoff recovery exposed by the live artifact-local benchmark. Tasks now carry `workUnitAnalysis`, spec/coordinator prompts require semantic deliverable counting, and task sizing uses that structured analysis so proof/Definition-of-Done bullets do not become fake child tasks. The orchestrator also auto-promotes fresh verified worker proof packets to review when the worker writes the self-critique but forgets the status transition. Live proof: `node dist/cli.js benchmarks run artifact-local --subset smoke --automation fully-automated --output-dir internal/benchmarks/runs/2026-05-30-live/artifact-local-semantic-work-units-rerun` passed 2/2 with average quality 100; report `internal/benchmarks/runs/2026-05-30-live/artifact-local-semantic-work-units-rerun/artifact-local-cfc84d57-242d-4310-b0c8-710e1e1e2f92.md`.

Verification: focused task-sizing/task-decomposition/task-queue/orchestrator tests passed, `pnpm exec tsc --noEmit` passed, `pnpm build` passed, and `git diff --check` passed.

source: codex:semantic-work-unit-split-fix

## 2026-05-31T01:30:00.000Z MCP evidence for artifact:flow-audit

Ran the live artifact-local benchmark specifically for process-cost and false-proof friction. The semantic split fix held, but the run exposed three sticky quality/cost problems: benchmark summaries hid per-run automation repairs, generated out-of-scope/review boilerplate triggered extra design/improvement-review lanes on tiny file patches, and the gate path could accept narrated worker/gate-checker proof even when `RELEASE_NOTES.md` was unchanged. Fixed the first two and added an orchestrator-owned acceptance-command gate pre-pass so command-backed ACs are decided by observed process exits before model narration. Diagnostic rerun `artifact-local-process-cost-rerun4` was intentionally stopped after the new gate bounced false proof twice; remaining sticky issue is worker/tool-use reliability on tiny edit tasks, plus generated `git diff` commands need to ignore Guildhall's own `.guildhall` state.

Evidence: focused benchmark/improvement/design/orchestrator/task-sizing/task-decomposition/task-queue tests passed with 36 selected tests; `pnpm build` passed. Live diagnostic showed tick 5 and tick 8 bouncing `gate_check -> in_progress` via `acceptance-command-gates` instead of falsely completing an unchanged file.

source: codex:benchmark-process-cost-and-false-proof-audit

## 2026-05-31T02:35:00.000Z MCP evidence for artifact:flow-audit

Tightened the sticky benchmark fixes after a fresh live run showed the worker could still narrate completion, write fake hard gate results into TASKS.json, and move to review without touching the target file. Workers can no longer author hard gate results or mark command-backed automated ACs as met through update-task; command-backed facts must come from observed gates. Review now rejects command-backed worker handoffs with likely target files but no project-file diff before any reviewer can approve them. Lean command-backed tasks skip qualitative review and go straight to command gates, and git-diff acceptance gates ignore Guildhall-owned `.guildhall` bookkeeping. The worker prompt now tells exact tiny artifact edits to edit/write the target first instead of proving the pre-mutation failure.

Evidence: focused agent/benchmark/improvement/design/orchestrator/task-sizing/task-decomposition/task-queue tests passed with 43 selected tests; `pnpm build` passed; `git diff --check` passed.

source: codex:sticky-benchmark-false-proof-hardening

## 2026-05-31T03:20:00.000Z local evidence for artifact:flow-audit

Reran the full artifact-local smoke benchmark after sticky command-gate hardening. The run first exposed and fixed three real harness bugs: piped `git diff | grep` acceptance commands put `.guildhall` exclusions after the pipe, command gates ran against the project checkout instead of the active task worktree, and command-gated `done` transitions cleaned up worktrees before landing accepted work back into the project. Final report: `internal/benchmarks/runs/2026-05-30-live/artifact-local-full-rerun-after-command-gate-landing-fix/artifact-local-79f7665d-3abd-46e5-8139-6f53076ccab7.md`.

Result: 2/2 passed, 0 false successes, average quality 100. Remaining efficiency issue: both tiny artifact fixtures still needed one automation-blocker recovery in spec shaping before completion.

source: codex:artifact-local-command-gate-landing-proof
## 2026-05-31T14:35:21.225Z MCP evidence for artifact:flow-audit

Added internal 0.10 bounded-chat feature spec covering two-role conversation/coordinator architecture, bounded context policy, intake flow, New request flow, memory policy, UI states, test plan, and release bar. Updated flow-audit with a checked entry pointing to internal/plans/2026-05-31-guildhall-0-10-bounded-chat.md.

source: codex:bounded-chat-spec
## 2026-05-31T14:37:08.996Z MCP evidence for artifact:flow-audit

Updated the 0.10 bounded-chat spec and flow-audit entry to make the UI replacement explicit: async-style Thread deep-intake question cards should become one actionable bounded-chat notification per objective across Overview/Inbox/Thread/task detail, and New request should open the bounded-chat surface directly. Recommended the 0.10 UI as a route-backed modal overlay that can expand to full-screen for narrow or long sessions.

source: codex:bounded-chat-ui-clarification
## 2026-05-31T14:42:03.587Z MCP evidence for artifact:flow-audit

Expanded the 0.10 bounded-chat spec with a Replacement Map and Recovery/Blocker Resolution section. Bounded chat is now defined as the standard pattern whenever Guildhall needs more information, permission, judgment, prioritization, or owner help, including complex blocker resolution through retry, revised scope, shelving, prerequisite task, capability request, or blocked outcomes.

source: codex:bounded-chat-owner-input-scope
## 2026-05-31T14:43:01.359Z MCP evidence for artifact:flow-audit

Updated the 0.10 bounded-chat spec to capture UI simplification: when one blocker or owner-input situation has several possible human resolution actions, surfaces should prefer one bounded-chat entry point over a dense button cluster. Added label guidance such as Resolve blocker, Choose next step, Shape request, Answer project questions, and Review options.

source: codex:bounded-chat-button-simplification
## 2026-05-31T19:59:51.000Z MCP evidence for artifact:flow-audit

Started 0.10.0 implementation on branch `0.10.0` by adding a canonical tracker at `internal/plans/2026-05-31-guildhall-0-10-implementation-tracker.md`, linking it from `internal/README.md`, and landing the first bounded-chat runtime-contract slice in `src/runtime/bounded-chat.ts`. The new runtime is file-backed, schema-checked, and intentionally narrow: it persists bounded-chat sessions, serves the next visible prompt, records user responses into a coordinator-review state, applies validated coordinator actions, keeps close actions idempotent, and rejects stale writes. Focused coverage in `src/runtime/__tests__/bounded-chat.test.ts` proves session creation, prompt retrieval, response submission, follow-up reopening, fulfilled closure receipt, blocked receipt, idempotent replay, and stale-write rejection. Verification: `pnpm vitest run src/runtime/__tests__/bounded-chat.test.ts --reporter=dot` passed with 6 tests and `pnpm typecheck` passed.

source: codex:bounded-chat-runtime-contract
## 2026-05-31T20:07:45.000Z MCP evidence for artifact:flow-audit

Extended the first bounded-chat implementation slice into a real project-check-in path. Added `src/runtime/bounded-chat-project-check-in.ts` to reuse the existing project-question planner through bounded-chat sessions, updated `/api/project/project-check-in` to start bounded chat instead of a new pressure-test intake, added `/api/project/bounded-chat/:id` and `/api/project/bounded-chat/:id/answer`, and taught `buildThread` plus `summarizeProjectCheckIn` to treat active project-check-in bounded chats as the current owner-input flow. Thread still renders the existing question-card UI for this path, but the backing state and answer endpoint are now bounded-chat-based. Verification: `pnpm vitest run src/runtime/__tests__/bounded-chat.test.ts src/runtime/__tests__/thread.test.ts src/runtime/__tests__/serve-intake.test.ts --reporter=dot` passed with 77 tests, and `pnpm typecheck` passed.
2026-05-31T20:39:00Z - Added the first bounded-chat New request clarification path. Ambiguous policy/spec asks from `/api/project/request` now create `new_request` bounded-chat sessions instead of immediately creating exploring tasks with lingering open-question cards. Answering that bounded chat creates the shaped exploring task with resolved request-intake state, closes the session with a receipt, and Thread now projects both active and completed New request bounded chats. Verification: `pnpm vitest run src/runtime/__tests__/intake.test.ts src/runtime/__tests__/request-routing.test.ts src/runtime/__tests__/pressure-test-intake.test.ts src/runtime/__tests__/project-question-planner.test.ts src/runtime/__tests__/bounded-chat.test.ts src/runtime/__tests__/thread.test.ts src/runtime/__tests__/serve-intake.test.ts --reporter=dot` (165 passed) and `pnpm typecheck` passed.

2026-05-31T17:31:00-07:00 - Landed the first `Threads + Needs you` transition slice for 0.10. Runtime inbox classification now explicitly splits thread-owned items from alert-owned items, `/api/project/inbox` only returns alert/history rows for the narrowed `Needs you` surface, the project rail now labels the conversation surface `Threads`, and `Needs you` renders as compact utility panels with a direct `Open Threads` handoff for active conversations. Verification: `pnpm vitest run src/runtime/__tests__/inbox.test.ts src/runtime/__tests__/serve-settings.test.ts src/runtime/__tests__/thread.test.ts src/web/surfaces/project/__tests__/InboxTab.svelte.test.ts src/web/surfaces/__tests__/ProjectView.svelte.test.ts src/web/surfaces/__tests__/DoThisNext.svelte.test.ts --reporter=dot` (207 passed) and `pnpm typecheck` passed.

2026-05-31T17:36:00-07:00 - Widened bounded-chat New request intake so ordinary task-like asks now start as `new_request` bounded-chat threads instead of creating exploring tasks immediately. `POST /api/project/request` still sends release-style asks through pressure-test intake, but task-like asks now open a shaping prompt first and only create the task after the owner records the requirements/acceptance/test-plan guidance. Also updated the 0.10 Threads plan to distinguish `outcome` threads from open-ended `conversation` threads. Verification: `pnpm vitest run src/runtime/__tests__/serve-intake.test.ts src/runtime/__tests__/bounded-chat.test.ts src/runtime/__tests__/thread.test.ts src/web/surfaces/__tests__/IntakeModal.svelte.test.ts --reporter=dot` (95 passed) and `pnpm typecheck` passed.

2026-05-31T17:41:00-07:00 - Tightened the bounded-chat entry path so starting a `New thread` now routes the app directly into `Threads` after `/api/project/request` succeeds, and the existing `guildhall:request-created` event now carries the bounded-chat id for the next threads-model pass. This keeps the modal aligned with the new “thread first” intake flow instead of posting and leaving the user in place. Verification: `pnpm vitest run src/web/surfaces/__tests__/IntakeModal.svelte.test.ts src/runtime/__tests__/serve-intake.test.ts src/web/surfaces/project/__tests__/ThreadTab.svelte.test.ts --reporter=dot` (80 passed) and `pnpm typecheck` passed.

2026-05-31T18:59:00-07:00 - Tightened the first real `Threads` navigation model and loader behavior. `ThreadTab` now keeps a compact list/detail back-stack instead of collapsing into one stacked column, `ProjectView` swaps its leading topbar action from `Projects` to `Threads` while a compact thread detail is selected, the project-nav hamburger hides in compact thread detail so only one navigation layer is exposed at a time, and thread content now renders from `/api/project/thread` without waiting for runtime/dev-server/capability side-loaders to finish. Verification: focused shell/thread regressions passed (`pnpm vitest run src/web/surfaces/__tests__/Header.svelte.test.ts src/web/surfaces/__tests__/ProjectView.svelte.test.ts src/web/surfaces/project/__tests__/ThreadTab.svelte.test.ts -t "compact|project nav|docks the selected active shaping turn above the composer controls|routes free-form agent questions through the shared thread composer|opens spec change requests in the shared thread composer|renders thread content before runtime side-loaders finish" --reporter=dot` -> 8 passed), `pnpm typecheck` passed, `pnpm build` passed, `/api/stale-server` returned `stale:false` from the direct local service on `http://127.0.0.1:7842`, and live browser verification confirmed the compact navigation swap (`Open project navigation` in list view, `Back to Threads` in detail view).
2026-05-31T21:10:00-07:00 - Landed the first runtime performance split for the 0.10 Threads model. Thread projection now has async cached file reads for snapshot/session state, `buildSnapshotAsync` can use `.guildhall/tasks/index.json` for hot-path task counts, `buildThread` accepts preloaded tasks/bounded-chat/pressure-test state instead of re-reading disk internally, and the serve layer now splits `/api/project/thread` into a fast core payload plus best-effort `/api/project/thread/extras` hydration for per-task git-story data. `ThreadTab` follows that split by rendering the core thread immediately and merging extras later without blocking the shell. Verification: focused `wizards`, `thread`, and `ThreadTab` regressions passed (`pnpm vitest run src/runtime/__tests__/wizards.test.ts src/runtime/__tests__/thread.test.ts src/web/surfaces/project/__tests__/ThreadTab.svelte.test.ts -t "buildSnapshotAsync prefers tasks/index.json for task counts on the hot path|prefers preloaded thread state over re-reading current disk projections|renders thread content before runtime side-loaders finish" --reporter=dot` -> 3 passed), `pnpm typecheck` passed, and `pnpm build` passed. Known follow-up: the full `ThreadTab` suite still has many pre-existing selector/DOM-assumption failures from the broader two-column/docked-thread overhaul and needs its own cleanup pass.

source: codex:bounded-chat-project-check-in-adapter
## 2026-05-31T15:43:50.908Z MCP evidence for guildhall-automation-007

Live installed-app audit for Looma + Knit (`projectId=looma-knit`) verified `/api/stale-server` as `stale:false`, opened `/projects/looma-knit/settings/reintake`, found no existing draft, refreshed re-intake via the project API after the section page exposed only a 404 state, and got draft `reintake-20260531T15381` with 14 sources scanned but 0 groups/0 reframes/0 creates/0 archives. The top recovery item `task-import-gh97p0` was reframed through the UI, then the remaining 36 stale imported blockers were reframed through the same `/api/project/task/:id/reframe-task` action endpoint. API readiness moved to `canStart:true`; a one-task start returned HTTP 200 and ran `task-import-1y7kmp6`, then stopped after one tick with `agent-error` because the spec agent timed out after 120000ms of inactivity and left all 39 tasks in `exploring`. Flow finding: re-intake cleanup cleared the owner blocker, but the Re-intake section lacks an obvious start/refresh affordance when no draft exists, and Looma + Knit is now runnable but not yet trustworthy for forward progress because the spec-agent durable-progress timeout remains.

source: Codex live Looma + Knit re-intake audit 2026-05-31
## 2026-06-01T23:12:15.694Z MCP evidence for task-9

Implemented Task 9 minimal task transition boundary in commit ceacfd4d. Added src/runtime/task-transition.ts backed by state-machine.ts, focused task-transition tests, routed deterministic hot paths through the boundary, updated Task 9 plan evidence, and verified with focused vitest suite: 384 tests passed. pnpm typecheck is currently blocked by concurrent Inbox/attention/serve type errors outside Worker B scope.

source: codex-worker-b
## 2026-06-01T23:26:45.952Z MCP evidence for task-10

Committed Task 10 fixture quarantine: moved app-spec-smoke and release-proof-matrix runtime modules from src/runtime to internal/fixtures, updated tests, added a guard against restoring those shipping runtime paths, and recorded test/lint evidence in internal/plans/2026-06-01-guildhall-cognitive-overhead-reduction.md.

source: codex-worker-c
## 2026-06-03T12:38:14.507Z MCP evidence for 0.10.0/task-open-questions-to-bounded-chat

Completed Milestone 1 bounded-chat owner-facing readiness slice: New request now opens bounded-chat sessions for all non-pressure-test routes, pure project questions close as conversation receipts without task drafts, task-like asks create tasks only after owner shaping, and Thread renders bounded-chat state through a dedicated conversation panel instead of the legacy question-card branch. Verification: focused bounded-chat/thread/request/serve/UI suites passed with 251 tests; pnpm typecheck:ui and pnpm lint:design passed; pnpm typecheck still fails on unrelated contract-surface schema/type drift in src/runtime/context-builder.ts and src/runtime/intake.ts.

source: codex:bounded-chat-completion

## 2026-06-03T12:46:00.000Z MCP evidence for 0.10.0/readiness-integration

Completed the 0.10 readiness integration pass. Milestone 1 bounded Thread
conversation behavior, Milestone 4 external task authority packet/write gating,
Milestone 5 external-agent memory bridge MCP/CLI exposure, Milestone 6 contract
surface packets/corpus/Structure/context, and Milestone 7 docs/screenshots/live
proof are now integrated on `feature/cognitive-overhead-reduction`.
Verification: `pnpm typecheck` passed; focused combined Vitest suite passed
with 360 tests; `pnpm lint:design` passed; `node scripts/reduction-guardrails.mjs`
passed; `pnpm build` passed; `git diff --check` passed; `pnpm dev:install`
completed; service restart reported `/api/stale-server` as `stale:false`; live
browser proof on Narrative Harness Thread and Structure showed no raw
`invalid_type` / `taskReadiness` schema JSON and placed contract surfaces in
Structure. Screenshots captured under `docs/assets/ui-audit/0-10-0/`.

source: codex:0.10-readiness-integration
## 2026-06-03T13:23:51.852Z MCP evidence for 0.10.0/readiness-integration

Task drawer/release integrity slice landed in isolated worktree feature/flow-audit-task-drawer-integrity. Regression coverage added for Narrative Harness canned split suppression, Font Something incomplete spec-review approval qualification, and Fair Labor License completed-task unresolved escalation hygiene. Verification passed: pnpm vitest run src/web/surfaces/__tests__/TaskDrawer.svelte.test.ts src/web/surfaces/project/__tests__/ReleaseTab.svelte.test.ts --reporter=dot (57 tests) and pnpm typecheck.

source: worker:flow-audit-task-drawer-integrity

## 2026-06-03T13:32:45.000Z MCP evidence for 0.10.0/readiness-integration

Merged the remaining 2026-06-03 flow-audit worktree fixes into the main worktree: shared project action model and cached service/project payload reuse, bounded-chat focus routing, task drawer integrity checks, and 0.10 project graph/structure clarity. Verification passed after merge: focused Vitest suites for action model, DoThisNext, ProjectOverviewTab, ProjectView, project-summary, TaskDrawer, ReleaseTab, ProjectStructurePanel, SettingsTab structure, Thread runtime, and ThreadTab; `pnpm typecheck`; `git diff --check`; `pnpm build`; `pnpm dev:install`; service restart; and `/api/stale-server` returned `stale:false` on pid `6339`.

source: codex:flow-audit-merged-integration
## 2026-06-04T17:39:03.509Z MCP evidence for artifact:flow-audit

Tightened ProjectView rail preview behavior so hover expansion no longer shifts the item under the pointer: nav item icons now keep the same left anchor across collapsed/preview/expanded rail states, collapsed preview keeps the rail header compact, and active rail subnav stays hidden during preview so rows below do not move. Added a focused ProjectView regression assertion that preview does not mount .rail-subs. Verification: git diff --check passed for ProjectView and its test; focused Vitest collection is currently blocked by an unrelated deleted src/web/surfaces/project/structure/StructuralMapReviewPanel.svelte import in the dirty worktree.

source: codex:rail-preview-stability
