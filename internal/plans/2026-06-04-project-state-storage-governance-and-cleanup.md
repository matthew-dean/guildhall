# Project State Storage Governance And Cleanup Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. This is a corrective plan after the earlier task-state split was treated as complete while live projects continued to accumulate oversized project-local Guildhall state.

**Goal:** Keep real project checkouts clean by creating no project-local
Guildhall state by default. Any Git-visible Guildhall state must be an explicit
opt-in thin export with a named owner-facing purpose, not a fallback mirror and
not a place for runtime or evidence history.

The immediate failure is file sprawl and size. This plan is not primarily an
"agent memory quality" audit. It is a storage-boundary audit: what files
Guildhall writes, how large they get, which writers create them, what retention
rule justifies them, and whether they belong in the project checkout at all.

Run the broader replacement audit in
`internal/plans/2026-06-04-guildhall-architecture-replacement-audit.md` alongside
this cleanup work. That audit ranks each storage and architecture surface as
Keep, Thin, Replace, Kill, or Defer so cleanup does not accidentally preserve
bespoke substrate that should be replaced.

**Architecture:** Project-local `.guildhall/` is no longer assumed to be the primary shared-state mirror. Before building custom memory infrastructure, run `internal/plans/2026-06-04-llm-memory-context-evaluation-spike.md` to evaluate OSS LLM memory/context systems for durable memory extraction, compaction, and context packet assembly with system-local state as the default. Every writer that currently mutates `Task` records must eventually write through boundary helpers so migration cannot be undone by the next lifecycle tick, but the final memory/context backend and any optional repo-local manifest/export layer should follow the spike result.

**Tech Stack:** TypeScript, Zod, JSONL ledgers for append-only runtime events, compact JSON/YAML mirrors for shared project state, existing `@guildhall/sessions` local-history helpers, Vitest, CLI migration commands, and live-project cleanup verification.

---

## Current Failure

The earlier plan `internal/plans/2026-05-24-task-schema-runtime-evidence-split.md` correctly named the problem, but the implementation was incomplete. It added `src/runtime/task-state-store.ts`, `src/runtime/task-state-migration.ts`, `src/runtime/effective-task.ts`, and compaction helpers, but many active writers still mutate full `Task` objects and serialize them back to project-local `.guildhall/TASKS.json`.

That means the migration can strip old runtime/evidence fields, and then ordinary task lifecycle code can recreate those fields. Treating that as implemented was false.

For this audit, "not working" means project-local state sprawls across too many
files and grows too large:

- oversized project-local files;
- too many durable files with unclear ownership;
- append-only logs in the repo;
- generated maps and drafts stored as live project truth;
- migration backups left in checkouts;
- task records carrying repeated runtime evidence;
- writers that can recreate bloat after cleanup.

Live managed-project evidence on 2026-06-04:

| Project | `.guildhall` size | Main offenders |
| --- | ---: | --- |
| `/Users/matthew/git/oss/fair-labor-license` | 1.60 MB | `TASKS.json` 568 KB, migration backup 532 KB, `PROGRESS.md` 351 KB |
| `/Users/matthew/git/oss/looma-knit` | 2.59 MB | `PROGRESS.md` 1.05 MB, `TASKS.json` 524 KB, archived task 275 KB |
| `/Users/matthew/git/oss/jess` | 1.14 MB | `codebase-map.yaml` 644 KB, structural map accepted/draft 239 KB each |
| `/Users/matthew/git/oss/narrative-harness` | 387 KB | project-local task migration backup 97 KB, `TASKS.json` 95 KB |
| `/Users/matthew/git/oss/font-something` | 191 KB | `codebase-map.yaml` 102 KB |

Fair Labor License `TASKS.json` is especially clear: it has only 17 tasks, but embeds roughly 215 KB of `notes`, 120 KB of `reviewVerdicts`, 50 KB of `escalations`, 48 KB of `acceptanceCriteria`, and 38 KB of `spec` content.

## Evaluation Gate

Do not implement a custom Guildhall memory/context layer until the OSS memory/context evaluation spike is complete:

- Spike plan: `internal/plans/2026-06-04-llm-memory-context-evaluation-spike.md`
- Required outcome: choose whether Guildhall should integrate an existing system, adopt its patterns, or proceed with a minimal custom baseline.
- Mandatory evaluation dimensions: durable memory extraction, context packet assembly, compaction quality, temporal correctness, provenance, configurability, local-first operations, project-local cleanliness, cost/latency, and failure behavior.

The writer-boundary fix remains mandatory regardless of the spike result. The spike decides what sits behind that boundary.

Spike result on 2026-06-04, revised with the Mastra value gate on 2026-06-06:

- Evaluation: `internal/evals/2026-06-04-llm-memory-context-evaluation.md`
- Decision: adopt Mastra Memory / Observational Memory as the first memory
  substrate path because the value gate now proves real TypeScript-native
  Mastra integration, system-local libSQL storage, scoped thread/resource
  mapping, no repo-local writes, source-ref preservation, deterministic
  fallback, and a packet-quality win over the deterministic baseline.
- Graphiti disposition: explored and retired. Managed Python and local Kuzu
  could run, but the prototype did not produce enough Guildhall product value
  to justify keeping it on the roadmap.
- Storage policy: repo-local state is `off` by default. Thin repo state is an
  explicit opt-in export mode only.
- Prototype evidence: `pnpm memory:mastra:value-gate -- --out
  artifacts/memory-core-prototype/mastra-value-gate.json` writes an ignored
  report with `decision: "adopt"` and records `@mastra/core`,
  `@mastra/libsql`, and `@mastra/memory` versions. The gate instantiates real
  Mastra `Memory` against system-local libSQL storage and keeps all repo-local
  writes empty.
- Scope boundary: the selected memory system must not replace Guildhall's
  reasoning or top-level context policy. It can help with storage, compaction,
  retrieval, fact extraction, and provenance. Guildhall owns what context is
  included, what is omitted, and why it serves the active user request.
- Mastra implementation spec:
  `internal/specs/2026-06-06-mastra-based-memory-improvements.md`.

## Storage Principles

1. Project-local state is off by default.
   - A normal project owner should not see Guildhall runtime state or generated
     Guildhall files in their repo unless they explicitly opted into a shared
     manifest/export mode.
   - If a `.guildhall` file is tracked, the owner should be able to read it and understand why it belongs in Git.
   - Large operational history, generated corpora, backups, and raw model evidence fail this test.

2. Data stays project-local only by explicit mode.
   - **No repo state:** default for clean project checkouts.
   - **Thin manifest:** portable registration/config/artifact IDs only.
   - **Shared team manifest:** compact task/decision summaries only when the project opts in.
   - **Export snapshot:** deliberate handoff/debug/archive artifact, not live state.
   - Runtime logs, repeated review attempts, local worktree placement, transient blockers, command output, and raw context snapshots are not shared task truth.

3. Every retained data class needs a job and a budget.
   - If Guildhall cannot name the workflow that needs the data, it should not keep it.
   - If Guildhall needs the data only for debug or audit drill-down, store it
     system-locally; project-local pointers or summaries are allowed only in an
     explicit thin/export mode.

4. Compaction is a write-path invariant, not a cleanup chore.
   - Writers must emit no project-local records by default.
   - Writers may emit compact project-local records only when storage policy
     explicitly opts into thin/export state.
   - Migrations and `memory compact-project-state` are recovery tools, not the primary defense.

5. Generated intelligence must be resumable without being dumped into Git.
   - Codebase maps, structural maps, context-debug snapshots, and review plans can be regenerated or stored as local artifacts with hashes.
   - Thin/export mirrors, when explicitly enabled, should carry summary,
     freshness, input hash, generated-at timestamp, and a local-history
     reference when drill-down exists.

## Data Classification

| Data class | Keep? | Format | Project-local budget | Reason |
| --- | --- | --- | ---: | --- |
| Task identity and status | Optional | system-local by default; compact repo manifest only in shared-team mode | 2 KB/task target when exported | Shared coordination truth only if the project opts into Git-visible task state. |
| Task spec | Optional | system-local by default; `specRef` or tracked spec only by opt-in | 12 KB/task warning when exported | Needed to resume work, but not necessarily in the repo. |
| Acceptance criteria | Optional | system-local by default; structured compact export by opt-in | 8 KB/task warning when exported | Needed to verify task completion. Repeated proof history is not AC. |
| Product brief | Optional | system-local by default; compact export by opt-in | 4 KB/task warning when exported | Needed to preserve why/scope, but can live in the selected memory/context backend. |
| Runtime counters and assignee | No, except open state summary | local runtime JSON plus compact projected fields where needed | N/A | Current assignment/retry state is local execution state, not portable task definition. |
| Notes | No | JSONL in task evidence store | Project-local: zero, except latest one-line summary when owner-facing | Repeated notes are audit detail and caused the largest bloat. |
| Review verdicts | No | JSONL in task evidence store | Project-local: zero | Needed for audit/reviewer UI, not for portable task definition. |
| Gate results / command output | No | JSONL with command, exit, truncated stdout/stderr, artifact refs | Project-local: zero | Full command output belongs in evidence drill-down. |
| Escalations | Split | open escalation summary in task/runtime; full lifecycle JSONL local | 1 KB/open escalation summary | Open blockers affect task truth; resolved history is evidence. |
| Adjudications | No | JSONL in task evidence store | Project-local: zero | Audit detail only. |
| Merge records / worktree paths | No | workspace/git state under local history | Project-local: zero | Machine-local and often stale. |
| `PROGRESS.md` | No by default | system-local events; optional compact export | 32 KB hard warning when exported | Append-only project-local progress caused real bloat. |
| Decisions | Optional curated export | system-local by default; compact ADR export by opt-in | 64 KB warning | Durable decisions can be shared, but not raw logs. |
| Memory | No by default | selected memory/context backend; optional thin summary export | 32 KB warning when exported | Shared learning should be distilled and provenance-linked. |
| Codebase map | No by default | selected memory/context backend or regenerable local artifact | 64 KB warning when exported | Full generated maps are large and regenerable. |
| Structural map | Optional accepted summary | system-local by default; accepted summary export by opt-in | 96 KB warning when exported | Accepted structure can guide agents; duplicate drafts do not belong in repo. |
| Migration backups | No | local history backup | Project-local: zero | Backups are safety artifacts, not project artifacts. |

## Required Code Changes After The Spike

### 1. Introduce a project-state boundary module

Create a focused module, likely `src/runtime/project-state-boundary.ts`, with these responsibilities:

- `stripRuntimeFields(task)` removes all fields that may not be serialized to project-local `TASKS.json`.
- `sanitizeTaskQueueForProjectWrite(queue)` applies that strip to every task and validates project-local budgets.
- `writeProjectTaskQueue(tasksPath, queue, options)` is the only allowed writer
  for task export files when thin repo state is explicitly enabled. In the
  default `off` mode, task queue writes must resolve to system-local state and
  must not create project-local `.guildhall/TASKS.json`.
- `appendTaskNote`, `appendReviewVerdict`, `appendGateResult`, `appendEscalation`, `appendAdjudication`, and `appendMergeRecord` route through the selected memory/context backend or the minimal Guildhall baseline, then update only compact open-state summaries.
- `assertProjectLocalStateBudget(projectRoot)` reports oversize files and forbidden fields.

The boundary module must be small enough that every direct writer can route through it without importing the orchestrator.

### 2. Replace direct `TASKS.json` serialization

Known offenders to migrate:

- `src/runtime/orchestrator.ts`: many `task.notes.push`, `t.reviewVerdicts.push`, `input.task.adjudications.push`, `t.gateResults.push`, then `atomicWriteText(this.tasksPath(), JSON.stringify(queue, null, 2))`.
- `src/tools/task-queue.ts`: `update-task` writes notes, gate results, assignment, spec, ACs, status.
- `src/tools/escalation.ts`: pushes `task.escalations` and mirrors to `PROGRESS.md`.
- `src/tools/report-issue.ts`: writes issue history into task records.
- `src/runtime/intake.ts`, `meta-intake.ts`, `workspace-importer.ts`, `run-once.ts`, `stale-blocker-repair.ts`, `task-decomposition.ts`, `policy.ts`, `improvement-review.ts`, and task action endpoints in `src/runtime/serve.ts`.

Every replacement must preserve UI behavior through `buildEffectiveTask()` or a successor projection, but normal lifecycle ticks must not create project-local task state. For explicit thin/export projects, the exported task file must stay clean after every lifecycle tick.

### 3. Redesign `PROGRESS.md`

`PROGRESS.md` cannot remain an infinite append-only runtime log. Replace it with:

- local JSONL event ledger: `getProjectLocalHistoryDir(projectRoot)/progress/events.jsonl`;
- optional thin/export mirror: `.guildhall/progress-summary.json` or a short
  `PROGRESS.md` generated from the last important entries only when storage
  policy opts in;
- retention rule for explicit exports: only owner-visible milestones, open
  blockers, and latest release-summary entries appear in project-local progress,
  capped by count and bytes.

Heartbeat, repeated escalation churn, model errors, retries, and debug entries go local-only.

### 4. Make migration idempotent and complete

The existing `migrateTaskState()` extracts task evidence but is incomplete because writers recreate the fields. The new migration must:

- run after writer fixes are in place;
- store backups only under local history;
- delete project-local `TASKS.before-*` backup files after confirming local backup exists;
- rewrite task archive files as compact summaries;
- compact or replace `PROGRESS.md`;
- compact generated `codebase-map.yaml` and structural-map drafts;
- update `.gitignore` so future local backups and generated bulk stay out of Git;
- emit a machine-readable report with before/after byte counts and forbidden-field counts.

### 5. Add hard regression gates

Add tests that fail if project-local bloat is recreated:

- unit test for `sanitizeTaskQueueForProjectWrite()` with FLL-shaped tasks containing 70 verdicts and 60 notes.
- integration test that runs a representative task lifecycle tick and asserts `.guildhall/TASKS.json` has no forbidden fields.
- escalation test that raises/resolves an escalation and asserts full lifecycle is in local JSONL while project-local task only carries open blocker summary.
- progress test that logs many milestones/heartbeats and asserts project-local progress remains capped.
- fixture test using Fair Labor License style data, Looma+Knit style progress, Jess style codebase map, and Narrative Harness style migration backup.
- CLI cleanup test that runs dry-run then apply and checks exact before/after byte budgets.

### 6. Add visible cleanup commands and proof

Add or harden CLI commands:

```sh
guildhall memory audit-project-state <project>
guildhall memory clean-project-state <project> --apply
guildhall memory clean-project-state --all --apply
```

The audit command must print:

- total `.guildhall` bytes;
- project-local tracked bytes;
- top oversized files;
- forbidden task fields by count and bytes;
- generated/bulk candidates;
- exact cleanup actions that would run.

The apply command must print:

- local backup path;
- every project-local file changed or removed;
- before/after byte counts;
- forbidden fields remaining;
- whether runtime/evidence projection still reconstructs task drawer state.

## Cleanup Targets

Run dry-run and apply cleanup against these current managed projects:

1. `/Users/matthew/git/oss/fair-labor-license`
2. `/Users/matthew/git/oss/looma-knit`
3. `/Users/matthew/git/oss/narrative-harness`
4. `/Users/matthew/git/oss/jess`
5. `/Users/matthew/git/oss/font-something`
6. `/Users/matthew/git/oss/t-minus-t`
7. `/Users/matthew/git/oss/commerce-project`
8. `/Users/matthew/git/oss/guildhall`

Do not clean with ad hoc scripts unless the CLI path itself is being proven. If an emergency manual cleanup is required, record exactly why the CLI could not do it and add a failing test first.

## Acceptance Criteria

- A fresh task lifecycle cannot create project-local Guildhall state by default.
- For explicit thin/export projects, a fresh task lifecycle cannot write
  `notes`, `reviewVerdicts`, `adjudications`, `gateResults`, resolved
  `escalations`, resolved `agentIssues`, `worktreePath`, `branchName`,
  `baseBranch`, `mergeRecord`, `revisionCount`, `retryWindow`, or
  `remediationAttempts` into project-local `.guildhall/TASKS.json`.
- Fair Labor License has no project-local `.guildhall/TASKS.json` by default;
  if explicitly exported, the export is compact and runtime evidence is still
  readable through effective-task projection.
- Fair Labor License project-local migration backup `TASKS.before-0.10.0-task-hierarchy-links.json` is removed from the project checkout after a local-history backup is verified.
- Looma+Knit `PROGRESS.md` no longer carries a 1 MB append-only history in the project checkout.
- Jess generated `codebase-map.yaml` and structural-map draft duplication are compacted or moved according to generated-artifact policy.
- `guildhall memory audit-project-state --all` reports no project-local
  Guildhall state for default/off projects and zero forbidden task fields for
  explicitly thin/exported task files.
- Focused tests pass, `pnpm typecheck` passes, and the cleanup report is committed or attached as internal evidence.

## Contract Touch Decision: Project-State Boundary Cleanup Slice

Work id: `2026-06-06-project-state-boundary-cleanup`.

Touched contracts:

- `guildhall.yaml` storage policy gains `storage.repoState: off | thin`;
- project-local `.guildhall/TASKS.json` cleanup shape;
- project-local state evacuation behavior for projects that do not opt into
  thin repo state;
- system-local migration ledger placement;
- system-local runtime compatibility marker placement;
- explicit thin repo-state manifest shape for bare continuation;
- project-local progress/codebase-map compaction reports;
- `guildhall memory audit-project-state` and
  `guildhall memory clean-project-state` CLI output;
- local-history task evidence backup format for removed project-local runtime
  and evidence fields.

Contracts considered but not touched:

- task lifecycle state machine;
- runtime task/evidence projection readers;
- release-readiness API;
- public docs.

Required follow-up:

- migrate remaining direct writers to `writeProjectTaskQueue()` so the cleanup
  boundary is enforced on every future write, not only by cleanup commands;
- add writer-specific tests for orchestrator, task-queue tools, escalations,
  and project action endpoints as those paths are migrated.

Proof required:

- red/green unit tests for active-task sanitization;
- compaction integration test proving removed evidence is backed up locally;
- CLI dry-run/apply proof on managed projects;
- `pnpm lint:contracts`, `pnpm lint:data-layer`, `pnpm typecheck`, focused
  tests, and build.

Proof provided:

- 2026-06-13 task-queue writer-boundary slice: `updateTask()` and
  `addTask()` now write through `writeProjectTaskQueue()` instead of direct
  JSON serialization, so tool-driven task mutations cannot preserve or
  recreate forbidden project-local task fields in persisted `TASKS.json`.
  Focused red/green proof:
  `pnpm exec vitest run src/tools/__tests__/task-queue.test.ts -t "persists updates through the project-state boundary" --reporter=dot`.
  Follow-up proof:
  `pnpm exec vitest run src/tools/__tests__/task-queue.test.ts --reporter=dot`,
  `pnpm exec vitest run src/runtime/__tests__/project-state-boundary.test.ts src/runtime/__tests__/project-state-compaction.test.ts --reporter=dot`,
  `pnpm exec vitest run scripts/data-layer-guardrails.test.ts --reporter=dot`,
  and `pnpm typecheck`.
- 2026-06-06 red/green boundary coverage:
  `src/runtime/__tests__/project-state-boundary.test.ts`,
  `src/runtime/__tests__/project-state-compaction.test.ts`, and
  `src/runtime/__tests__/task-state-migration.test.ts`.
- 2026-06-06 CLI dry-run/apply proof across managed projects:
  `fair-labor-license` forbidden task fields `8 -> 0`, `looma-knit`
  `462 -> 0`, `jess` `16 -> 0`, `narrative-harness` `82 -> 0`,
  `font-something` `51 -> 0`, `t-minus-t` `16 -> 0`,
  `commerce-project` `0 -> 0`, and `guildhall` `30 -> 0`.
- 2026-06-06 post-apply direct scan across those eight projects found
  `forbiddenFields=0` for each project and 70
  `project-state-boundary-evidence.json` local-history backups written under
  machine-local Guildhall storage.
- 2026-06-06 live app proof: `guildhall start` served the installed build,
  `/api/stale-server` returned `stale:false`, and the in-app browser rendered
  `/projects/jess/overview` and `/projects/looma-knit/overview` as connected
  overview pages after the cleanup.
- 2026-06-06 correction: non-opt-in cleanup no longer writes a compact
  repo-local mirror. `storage.repoState: off` evacuates the whole `.guildhall`
  directory into machine-local history and removes it from the project
  checkout. `storage.repoState: thin` is required before migration cleanup may
  leave Git-visible state behind, and that state is only a bare continuation
  packet: current artifact ids, compact active tasks, and open-escalation count.
  Thin state carries no historical memory, progress log, runtime evidence, or
  project-state evacuation references.

Waivers:

- this slice does not delete product evidence; removed project-local task
  runtime/evidence payloads are written under local history before the compact
  project-local task file is written.

## Schema Migration Decision: Project-State Boundary Cleanup Slice

Persisted schema touched:

- `guildhall.yaml` gains optional `storage.repoState`, defaulting to `off`;
- project-local `.guildhall/TASKS.json` may replace forbidden runtime/evidence
  arrays with compact `openEscalations` summaries only when
  `storage.repoState: thin`;
- project-local `.guildhall/project-state-manifest.json` may exist only when
  `storage.repoState: thin`, and it contains current active shape sufficient
  for bare continuation by another agent;
- project-local `.guildhall` is removed after system-local evacuation when
  `storage.repoState: off`;
- project migration ledger records move from `.guildhall/migrations.json` to
  system-local local-history storage;
- runtime compatibility write markers move from `.guildhall/runtime.json` to
  system-local local-history storage, with legacy read fallback;
- local-history task evidence gains `project-state-boundary-evidence.json`.

Scope:

- per project;
- cleanup command and boundary helper only in this slice.

Change class:

- backward-compatible cleanup/compaction;
- additive local-history evidence backup.

Existing data impact:

- opted-in thin-state projects lose project-local runtime/evidence fields after
  cleanup, with full removed payload preserved in local history and only the
  current active shape retained in the repo;
- non-opt-in projects have their entire `.guildhall` directory evacuated to
  local history and removed instead of rewritten;
- terminal task archive behavior remains the existing compaction path only for
  thin-state projects.

Migration id:

- `2026-06-06-project-state-boundary-cleanup`;
- built-in migration: `0.10.0/project-state-storage-boundary`.

Safety:

- dry-run is default for audit/legacy compact command;
- apply mode reports repo-state mode, evacuated paths, before/after bytes,
  forbidden fields, and local-history backup path;
- unrelated project source files are not touched.

Compatibility reader:

- existing project readers still see task identity/status/spec fields in
  `.guildhall/TASKS.json` only for projects that opt into thin repo state;
- non-opt-in project readers must use system-local data after evacuation;
- full drill-down evidence is available from local history.

Fixtures/tests:

- `src/runtime/__tests__/project-state-boundary.test.ts`;
- `src/runtime/__tests__/project-state-compaction.test.ts`;
- `src/runtime/__tests__/task-state-migration.test.ts`.

## Non-Goals

- Do not delete evidence. Move or compact it with verifiable local-history backups.
- Do not pretend machine-local storage alone solves organization. Local stores must have typed formats, retention budgets, and drill-down pointers.
- Do not make public docs about internal storage unless a user-facing docs page is separately requested.
- Do not rewrite unrelated project source files while cleaning `.guildhall` state.

## Execution Order

1. Turn the Mastra value-gate prototype into the Guildhall memory-core substrate
   with typed scopes, source refs, deterministic fallback, and system-local
   storage by default.
2. Run the architecture replacement audit and confirm Keep/Thin/Replace/Kill/Defer
   rankings for storage and memory/context substrate surfaces.
3. Add pass/fail gates for Mastra provenance, latency, context size, fallback,
   no repo-local writes, and retrieval quality against the deterministic
   Guildhall baseline.
4. Add failing writer-boundary tests.
5. Implement project-state boundary writer helpers.
6. Migrate direct writers to the helpers.
7. Redesign progress logging and project-local progress summary.
8. Harden migration/cleanup CLI and reports.
9. Run cleanup dry-runs on all target projects.
10. Apply cleanup project by project, preserving dirty source work and unrelated user edits.
11. Verify effective task projection and UI/API summaries still work.
12. Record before/after evidence in `artifact:flow-audit` and the cleanup report.
