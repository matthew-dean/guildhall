# Guildhall Data-Layer Review

**Date:** 2026-07-17
**Scope:** Persistence choices only: project SQLite, JSON/JSONL, compressed detail, local history, and the machine fleet store.
**Active goal:** `internal/plans/2026-07-14-project-state-architecture-pivot.md:13-20`
**Artifact status:** Active implementation review. Code and proof updates are
recorded below; this document remains the audit ledger, not a second runtime
authority.

## Verdict

| Choice | Decision | Boundary |
| --- | --- | --- |
| Per-project SQLite | **Keep** | Canonical current-state store for typed current facts, revisions, indexes, and bounded projections. `node:sqlite` remains provisional until the runtime/driver gate passes. |
| JSON and JSONL | **Keep narrowly; remove as current authority** | Keep append-only evidence/history, exports, and migration inputs. Remove normal reads and writes that reconstruct current project state from `TASKS.json`, runtime JSON, owner-input JSON, or summary JSON. |
| Gzip detail | **Keep per-task; remove aggregate copies** | Keep `work_item_detail.payload_gzip` for explicit point/detail reads. Remove `queue_detail` and `queue-details.json(.gz)` after the one-time migration bridge has crossed every active project. |
| Local history | **Keep, with hard ownership and budgets** | Keep user-local essential history and bounded diagnostics outside the repository. Remove raw transcript/session transport from normal durable history and prevent read/path helpers from allocating storage. |
| Fleet DB | **Replace its role, do not make it authoritative** | A machine-level fleet index may remain only as a disposable, rebuildable summary cache. It must never own project facts or become the only route dependency. The active plan currently argues against a single fleet database as a failure domain (`...architecture-pivot.md:254-275`), so this is an explicit exception that still needs proof. |

The governing rule is one fact, one owner, many projections. The current project database implementation is aligned with that rule. The fleet database and compatibility detail paths are aligned only if they remain derived, bounded, and rebuildable.

## Evidence And Findings

### 1. Per-project SQLite: keep

The active plan assigns current work, scope, execution, runtime, owner-input, repository, proof-summary, and project-summary facts to `project-state.db`; compatibility files are not additional authorities (`internal/plans/2026-07-14-project-state-architecture-pivot.md:163-205`). The storage decision also explicitly selects one SQLite file per project to isolate a broken or locked project (`...architecture-pivot.md:254-275`).

The implementation has the right shape:

- compact SQL columns omit `definition_json` from list reads (`src/sessions/project-state-database.ts:1390-1403`);
- project writes use SQLite transactions and a single revision boundary (`src/sessions/project-state-database.ts:3256-3279`);
- compact reads use read-only connections, `journal_mode=DELETE`,
  `synchronous=FULL`, and a 250 ms read busy timeout; writes retain a
  five-second timeout (`src/sessions/project-state-database.ts`);
- the direct-SQL guard permits SQLite only in the sessions/migration boundary (`scripts/data-layer-guardrails.mjs:43-48`);
- the project database suite passed 69 tests in this review.

The remaining concern is operational, not conceptual. Built-in `node:sqlite` is still experimental in the supported installed runtime (`...architecture-pivot.md:277-285`). Also, `DatabaseSync` is synchronous. The existing fleet audit recorded serial synchronous project reads and a possible five-second event-loop delay behind the busy timeout (`internal/audits/2026-07-17-fleet-service-summary-performance.md:58-80`). That evidence predates or does not prove the current uncommitted `serve.ts` route shape, so it must not be treated as final proof.

**Required decision:** retain SQLite. Evaluate a maintained SQLite driver only if the declared runtime cannot provide a supported, durable `DatabaseSync` path. Do not return to JSON reconstruction as the fallback.

### 2. JSON and JSONL: keep as detail/history, remove as current state

The active plan correctly says `TASKS.json`, runtime JSON, owner-input JSON, and summary JSON are compatibility artifacts during migration, not authorities (`...architecture-pivot.md:172-177`). It also keeps JSONL/event records for append-only audit/export while indexing latest proof and current execution in SQLite (`...architecture-pivot.md:260-267`).

The code supports that split:

- JSONL reads are bounded to the retention window and writes enforce event/byte caps (`src/persistence/file-backed.ts:62-120`, `src/persistence/file-backed.ts:189-221`);
- active streams are capped at 512 events/256 KiB, archive at 5,000 events/5 MiB, debug at 128 events/256 KiB, and ephemeral at 64 KiB/24 hours (`src/persistence/types.ts:20-40`);
- current evidence reads are intended to come from a bounded SQLite projection, while the JSONL ledger remains historical detail (`src/sessions/project-state-database.ts:290-307`).

**Remove:** normal route-time queue reconstruction, parallel current-state JSON writers, and any new feature-owned managed JSON file. The data-layer guard now rejects direct managed-path I/O and direct SQLite access outside the boundary (`scripts/data-layer-guardrails.test.ts`).

**Retain:** JSON/JSONL for explicit migration, export, append-only evidence, and bounded diagnostic streams. Do not call a bounded JSON file a read model unless it has one named owner, revision/freshness metadata, a consumer, and a measured byte budget.

### 3. Gzip detail: keep point detail, remove aggregate duplication

Gzip is useful at the irregular-detail edge. The current implementation serializes per-task detail into `work_item_detail.payload_gzip` and decompresses it only for explicit rich reads (`src/sessions/project-state-database.ts:1292-1304`, `src/sessions/project-state-database.ts:2497-2511`). Tests prove a task detail read works without `queue_detail`, and that untouched task payloads are not rewritten during structural changes (`src/sessions/__tests__/project-state-database.test.ts:851-896`, `:1285-1320`).

The aggregate representation is different. `queue_detail` and the compressed filesystem sidecar are migration compatibility stores; current writes only emit the compressed sidecar when an explicit `compatibilityExport` is requested (`src/sessions/project-state-database.ts:2624-2629`, `:3256-3279`). The code already has an allowlisted removal path that checks per-task detail completeness before deleting `queue_detail` (`src/sessions/project-state-database.ts:4184-4198`).

**Remove:** aggregate `queue_detail`, `queue-details.json`, and `queue-details.json.gz` from promoted runtime state after the migration bridge is complete. Do not leave `compatibilityExport` as a routine writer. `TASKS.json` should become a compact export, not a third full representation.

**Gate:** across Narrative Harness, Looma + Knit, Jess, and Fair Labor License fixtures, record plain JSON bytes, gzip bytes, and point-read p50/p95. Keep per-task gzip only if it achieves at least 2:1 storage reduction on representative detail and keeps the explicit task-detail read within the existing 750 ms/512 KiB gate. Otherwise evaluate a lower compression level or an uncompressed point blob. Do not reintroduce a whole-queue blob to solve a point-read problem.

### 4. Local history: keep as a bounded, user-local evidence lane

The path boundary is correct: local history lives under the user data directory, while project state resolves under the project-local system state path (`src/sessions/local-history.ts:118-167`). Read/path helpers are pure; allocation happens through `ensureProjectLocalHistoryDir` and the explicit write boundary (`src/sessions/local-history.ts:136-151`). The tests cover placement, non-allocation on reads, temporary-project isolation, health reporting, and bounded heartbeats; all seven local-history tests passed (`src/sessions/__tests__/local-history.test.ts:35-157`).

Keep these separate lifetimes:

- essential-history Markdown: compact semantic facts, decisions, constraints, open questions, and next actions;
- JSONL/event records: append-only evidence with explicit retention;
- context-debug/provider/session material: bounded diagnostic evidence only, never normal project/fleet input;
- migration snapshots: rollback evidence, never current state.

**Remove:** raw transcript append semantics, repeated system prompts in completed snapshots, completed-task diagnostics, and any feature path that creates a local-history directory merely to read a value. The active plan records this boundary and a prior installed cleanup result of about 32 MiB of context-debug plus a 15.5 MiB duplicate mirror reduced to no completed-task diagnostics (`...architecture-pivot.md:331-390`, `:908-925`).

**Gate:** on a fresh temporary project, compact/fleet/project GETs must create zero directories, databases, sidecars, or transcripts. Existing writers must stay within the declared limits: heartbeat 256 KiB/512 records (`src/sessions/local-history.ts:14-16`), generic active/debug JSONL 256 KiB, archive 5 MiB, ephemeral 64 KiB/24 hours (`src/persistence/types.ts:27-40`), and the project-wide context-debug budget in the active plan (`...architecture-pivot.md:342-361`). Health output must report total bytes, file count, and oldest transcript for cleanup verification.

One reader edge remains worth testing: an oversized or malformed newest JSONL line can trigger a full-file reread in the bounded-tail fallback (`src/persistence/file-backed.ts:77-95`). The writer limits make ordinary streams bounded, but the read gate should prove that legacy oversized files cannot turn a normal read into an unbounded parse.

### 5. Fleet DB: derived cache only, or replace it

The new store is deliberately small: one `fleet_summary_projection` row per project, a 16 KiB payload cap, a 1 KiB error cap, bounded pages, source revisions, stale/error/unavailable states, and a reader that never opens a project database (`src/sessions/fleet-state-database.ts:7-15`, `:177-200`, `:314-357`). Tests cover idempotence, paging, revision staleness, corruption isolation, payload limits, deletion, and pruning; all seven fleet-database tests passed (`src/sessions/__tests__/fleet-state-database.test.ts:50-165`).

That is good cache behavior. The normal fleet routes now read each project's
compact project-local summary directly; startup and projection writes may still
populate the fleet index, but a locked or corrupt fleet file cannot affect the
fleet card read. Project invalidations may mark cache rows stale, but those
rows are not consulted by current-state routes.

**Replace the role:** classify `fleet-state.sqlite` as a disposable machine cache. It may accelerate the fleet read, but it must have these properties before it is considered part of the active solution:

1. deleting the file and rebuilding from per-project SQLite loses no current fact;
2. a missing/corrupt/locked fleet file returns explicit unavailable/stale rows and does not reconstruct projects during the request;
3. a single project refresh failure affects one row, not a fleet-wide lock or transaction;
4. fleet writes are serialized or otherwise bounded, and do not hold a shared five-second synchronous lock in the request path;
5. the active architecture decision is amended to name this cache exception, because the current plan explicitly rejects a single fleet database as a cross-project failure domain (`...architecture-pivot.md:264-266`).

If those gates cannot be met, remove the fleet DB and read one compact summary row from each registered project database through a bounded async/concurrent boundary. Do not replace it with another unbounded JSON fleet cache.

## Performance And Storage Gates

The existing performance script supplies useful route budgets (`scripts/project-state-performance-audit.mjs:6-20`, `:163-192`):

| Read | Hard target |
| --- | --- |
| Fleet/service compact | <= 250 ms and <= 128 KiB; no loading/errors |
| Project compact | <= 500 ms and <= 256 KiB; no loading/errors |
| Attention | <= 250 ms and <= 256 KiB; no errors |
| Explicit service detail | <= 750 ms and <= 128 KiB; never used by the initial shell |
| Explicit task detail | <= 750 ms and <= 512 KiB |
| Explicit Thread | <= 1,000 ms and <= 512 KiB |

Before calling this pivot complete, run those checks against the installed artifact, cold and warm, at the four named validation projects plus the current registered-project roster. Record p50/p95, response bytes, files opened, databases opened/created, and bytes parsed. Add a locked-project case and a corrupt-projection case. The current fleet audit has useful installed measurements, including 23.18 ms/24,694 bytes for `/api/service/projects`, 4.68 ms/24,709 bytes for compact `/api/service`, and 74.97 ms/36,352 bytes for explicit detail (`internal/audits/2026-07-17-fleet-service-summary-performance.md:19-34`), but that audit also says `serve.ts` was concurrently owned (`:44-46`); rerun it after the current route settles.

Storage proof must additionally show:

- no `queue_detail` row and no `queue-details.*` sidecar after promoted-project cleanup;
- one `work_item_detail` payload per current task, with no full definition copied into compact rows;
- no `-wal`/`-shm` sidecars from compact reads and `journal_mode=DELETE` on writable project databases;
- no durable local-history allocation from a read-only path;
- fleet payloads <= 16 KiB and errors <= 1 KiB per row, with explicit prune/rebuild evidence;
- JSONL streams remain inside their retention caps and do not require a full-file parse to read the bounded window.

## Completion Status

The storage-boundary proof run for this audit passed:

- `pnpm lint:data-layer`;
- `pnpm lint:contracts`;
- `git diff --check`;
- 154 focused tests in six files: data-layer guardrails, project-state database, fleet-state database, local history, file-backed persistence, and migrations.

The active data-layer goal is **not yet complete**. The remaining proof is the four-project parity matrix, installed-artifact rerun against the current `serve.ts`, compression measurements, fleet-cache deletion/rebuild proof, and the explicit decision on whether the machine fleet DB is an allowed derived-cache exception or should be removed.

## 2026-07-17 status refresh

The current branch has closed several of those gates, but not all of them:

- Installed fleet/service/project/Thread performance remains within budget:
  fleet `22.84 ms` and `30,838` bytes; Narrative Harness cold project
  `39.14 ms` and `51,932` bytes; no loading or error rows.
- The installed cross-surface agreement audit reports seven projects and
  `mismatchCount: 0`, including Narrative Harness, Looma + Knit, Jess, and
  Fair Labor License.
- The owner-input authority cutover is applied to the seven promoted projects.
- The release-membership mirror cutover is applied to the same fleet. NH now
  has zero task release-array mirrors, zero scope-array mirrors, and zero old
  membership fields in release definition envelopes; its normalized relation
  still contains 36 assignments.
- Cold startup is now observable separately from listener readiness. The
  installed service completed all seven bounded project refreshes in about
  `991 ms` with zero errors after the listener became ready.

The important caveat is that **route performance is fixed much further than
total stored history size**. A read-only census of Narrative Harness still
finds about `7.5 MB` of project-local state: a `916 KB` SQLite file, `1.3 MB`
of compressed task-evidence history, `944 KB` of task review/archive material,
and additional bounded event, migration, and backup records. Ordinary fleet
and project reads do not load those bodies, which is why the response budgets
pass, but the data layer is not yet “everything lean.” The next structural
work is to classify and retire stale migration backups/review transport and
to decide which historical ledgers deserve long-term retention, without
mistaking deletion of history for a current-state model fix.

## 2026-07-17 status refresh: current-state write boundary and cold refresh cut

Two additional architecture cuts are now installed and measured:

- Generic summary patches no longer write `current_execution` or
  `current_runtime`. Those rows are now written only through explicit
  current-state inputs or dedicated runtime writers; a regression proves an
  embedded stale summary value cannot overwrite a newer operational fact.
- An empty startup invalidation set no longer triggers default repository
  observation, rich effective-task expansion, or the second Git-backed
  diagnostic pass. Those remain explicit invalidation work.
- After rebuild/install/restart, the service listener was ready about `77 ms`
  after process start and all seven bounded project refreshes completed in
  about `419 ms`, with zero errors and `stale:false`.
- Installed performance remained within budget: fleet `26.28 ms`, service
  `2.73 ms`, Narrative Harness cold detail `53.88 ms`; the agreement audit
  remained at `mismatchCount: 0` across all seven registered projects.

This materially improves startup behavior and removes one real duplicate write
authority. It still does **not** close the model: runtime JSON/supervisor
control, broad watcher scans, compatibility reconstruction, fleet-cache
authority, and retention classification remain open architectural work.

## 2026-07-17 status refresh: runtime read authority

The runtime API now consumes the compact `current_runtime` projection through
the same project summary boundary used by Overview and fleet summaries. The
verbose `runtime/state.json` remains a detail/configuration source for mounts,
ports, container identity, health checks, and backend setup, but it no longer
gets to disagree about status, health status, or last activity for promoted
projects. Runtime writes publish the compact row before the detail file.

This closes one concrete duplicate read authority, with 15 focused runtime
store/API tests passing. It does not yet unify supervisor memory, stop intent,
or crash recovery; those remain the next operational-state slice.

The default freshness watcher has also been cut back: it no longer runs Git
status scans across every project and child repository on a five-second timer.
Repository observations remain explicit projection work. The optional watcher
signature hook stays available for deployments that intentionally opt into that
external observation, but the ordinary Guildhall service lifecycle no longer
pays for it.

## 2026-07-17 status refresh: fleet cache removed from normal reads

The normal fleet routes now read each project summary through the same compact
project-state boundary used by selected-project surfaces. The machine
`fleet-state.sqlite` file remains a bounded write-only acceleration artifact;
it is not a current-state authority and a contradictory cache row cannot change
the fleet response. A regression proves this with an intentionally false cache
payload. The remaining cache gate is explicit deletion/rebuild proof, not
another read-path fallback.

The project SQLite boundary also now uses a 250 ms busy timeout for read-only
connections while retaining 5 seconds for writes. This prevents a locked
project from stalling all synchronous fleet reads. Installed locked-project
timing evidence is still required before the performance gate is closed.

## 2026-07-17 status refresh: corrupt current state fails closed

If `project-state.db` exists but its metadata cannot be read, the shared
authority boundary now returns unavailable database authority rather than
falling through to `TASKS.json`. This closes the remaining promoted/legacy
fail-open path. A project with no database remains eligible for the explicit
legacy bootstrap reader; a present corrupt database requires recovery or
migration and cannot silently become a different project state.

## Historical payload registry

The project database now has a metadata-only `historical_artifacts` registry.
It is deliberately not a body store: it records ownership, logical reference,
size, digest, retention class, and lifecycle state for payloads that remain on
disk. Compact exploring history registers after writes only when the project
already has database authority, so legacy history cannot create a new current
state database as a side effect. The registry is additive and versioned as
`0.13.7/historical-artifact-registry`; current task and summary rows are
unchanged.

The remaining retention work is still structural: review transport and legacy
migration payloads need complete registry backfill, then cleanup must require a
matching digest and receipt. Unmanifested backups are not deleted merely
because a census found them.

## Installed cache rebuild proof

After the direct project-local read cut, the disposable fleet cache was copied
for recovery proof and removed from the installed data directory. The live
`/api/service/projects` route still returned all seven projects, with Narrative
Harness `summaryFreshness: current`, `projectStatusLoading: false`, and 37
current tasks while the cache file was absent. Restarting the installed service
recreated the cache; `/api/stale-server` then reported `stale:false`, seven
projects refreshed, and zero startup errors. The cache is therefore a
rebuildable write-only acceleration artifact, not a required read authority.

## Current gate status

The current installed proof closes the performance and read-authority gates:

- fleet 27.65 ms / 30,838 bytes;
- compact service 6.87 ms / 30,853 bytes;
- service detail 20.42 ms / 41,517 bytes;
- attention 7.27 ms / 35,742 bytes;
- cold project details 18.64-82.90 ms across the seven-project roster;
- rich task reads 28.10-47.90 ms and Thread reads 48.68-67.16 ms;
- agreement audit: seven projects, `mismatchCount: 0`.

The remaining gate is storage cleanup, not request-time reconstruction:
review transport and legacy migration payloads need registry backfill, and
cleanup must be digest-verified before any old backup is removed. The active
goal remains open until that retention boundary and its proof are complete.

## 2026-07-17 retention closeout

The retention gate described above is superseded by the completed maintenance
pass. This is the current result, not a new parallel storage model:

- the metadata-only historical registry is schema 33;
- all seven registered projects are classified with 457 artifacts and
  6,272,664 registered bytes, with zero `unclassified` rows;
- review transport and evacuation history are backfilled from bounded,
  explicitly named directories;
- legacy migration files are compressed and removed only after registry write,
  gzip round-trip, and digest verification;
- current-state reads do not consult these historical payloads, and the
  fleet cache remains write-only and rebuildable;
- the installed startup, performance, and cross-surface agreement proofs pass.

This closes the historical retention portion of the data-layer goal. The
remaining manual `0.9.0/runtime-backed-project` migration shown by project
status is an explicit owner-authorized project migration. It is not a second
current-state authority and does not block the lean read model. The next
architectural work, if pursued, should therefore target transition-state proof
(stale/running) or replace the synchronous per-project fleet loop with a
precomputed fleet projection; neither should be misreported as unfinished
historical cleanup.

### Transition proof refresh

The focused fleet read-model suite now covers the missing transition behavior:
an execution write marks the shared summary stale on every fleet surface, and a
bounded refresh restores one current summary carrying `execution.status:
running` and the shared Pause control. This is 26 passing focused tests across
fleet isolation, compaction, migration snapshots, and review transport.

The remaining evidence item is deliberately narrower than another architecture
rewrite: capture the same transition on one registered real project, restore its
original execution row, and rerun the agreement audit. The test must leave no
running marker or revision behind.

## Unified-layer cutover refresh

The current-state boundary is now behaviorally closed for the exercised read
surfaces. Promoted projects do not fall back to `TASKS.json` when their saved
orientation projection is missing; they return an explicit unavailable/refresh
state. The compatibility writer normalizes legacy queue records before compact
validation and strips runtime-only completion bundles from the promoted
definition check, so malformed historical detail cannot make the saved scope
disappear.

The evidence boundary also stopped silently dropping bounded records that fail
the newest runtime schema. Current proof recovery, escalations, and review
records remain visible; active proof recovery wins over stale historical
approval. Detail responses retain only a bounded semantic review-proof line,
while full review/history payloads stay behind explicit endpoints.

Current proof:

- release readiness: 80/80;
- unified boundary/fleet/thread/summary/effective-task suites: 116/116;
- installed service: `stale:false`, seven projects refreshed, zero errors;
- installed performance: fleet 103.92 ms / 30.8 KB, service 44.92 ms,
  detail 151.14 ms, cold project reads 96.65-266.42 ms, rich task reads
  66.96-165.06 ms;
- installed agreement: seven projects, `mismatchCount: 0`;
- data-layer lint, contract lint, diff check, and production build: pass.

This closes the behavioral read-model gate. It does not close the repository
type-safety gate: `pnpm typecheck` still reports the older fixture and
production-contract backlog (notably required `Task.references`/
`sourceClaims`, terminal `archived`/`cancelled` states, and several narrowed
projection types). The architecture should not be called fully complete until
that backlog is either repaired or explicitly reduced through a deliberate
contract decision.

## 2026-07-17 final unified-layer pass

The last discovered current-state loss was repaired at the owner boundary.
Bounded completion summaries now travel as `completion_summary` evidence,
rather than being stripped from definitions and then guessed back from merge
state. This is a data-model correction: one current evidence owner now feeds
the importer, effective-task projection, Work, Release, and task detail.

Evidence:

- `pnpm lint:data-layer`, `pnpm lint:contracts`, and `git diff --check` pass.
- Production build passes and UI typecheck passes.
- The focused unified suite passes 303/303 tests.
- The migration suite passes 13 selected tests, including the completion
  evidence path.
- `tsgo` has 0 non-test source errors; 481 remaining errors are in existing
  tests/fixtures that still construct pre-current Task shapes. They remain
  visible as a follow-up rather than being hidden by weakening the canonical
  model.

This closes the current-state data-boundary gate for the exercised surfaces.
The remaining repository-wide type backlog is test-contract maintenance, not
another runtime authority or request-time reconstruction path.

## 2026-07-17 storage cleanup follow-up

The first post-cutover disk check found that the active project-state model was
small, but Guildhall-owned generated worktrees and historical installs still
occupied 24 GB. This was not acceptable as a clean result.

- Removed generated `node_modules` trees from Guildhall-managed worktrees while
  preserving their source files and Git branches.
- Bounded the two append-only service logs to their newest 50 MB each.
- Removed obsolete embedded runtime installs and changed `scripts/install.sh`
  to retain only the active versioned install after a successful install.
- Re-measured: `~/.guildhall` is 3.4 GB; active project data is 59 MB; app
  runtime is 338 MB; logs are 100 MB.
- The remaining 2.7 GB is a preserved Font model-checkpoint worktree for the
  still-exploratory `import-model-rust-outline-extension` task. It is not raw
  transcript, current-state, or persistence-ledger data and was intentionally
  left intact because it is authored task artifact content.

This closes the accidental Guildhall-state bloat, but does not claim that
large authored model artifacts should be deleted without a project decision.
