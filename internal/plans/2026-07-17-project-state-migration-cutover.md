# Unified Project-State Migration Cutover

**Date:** 2026-07-17
**Status:** Cutover plan for the current branch
**Scope:** One system-local `project-state.db` per registered project, plus the machine-level fleet index
**Current branch evidence:** `feature/narrative-harness-import-truth` at `4067c9bd`; the worktree already contains the in-progress projection consolidation. This plan does not assume that unrelated dirty files are available for this cutover.

## Cutover invariant

Guildhall has one current-state authority: the normalized SQLite database opened
through the sessions boundary. A current fact is written once, under one project
revision, and every ordinary read consumes that revisioned snapshot or reports
stale/missing state. JSON and JSONL are one of:

- explicit migration input or compatibility export while a project is still
  unpromoted;
- bounded historical/detail storage; or
- diagnostic/transport data that is never loaded by a compact project or fleet
  read.

There must be no normal-runtime fallback from a promoted database to
`TASKS.json`, runtime/workspace JSON, legacy evidence, or a full request-time
reconstruction. A failed projection is stale or unavailable and is repaired by
the projector; it is not repaired as a side effect of a GET.

## Current model and ownership

`src/sessions/project-state-database.ts` currently opens schema version **32**
with rollback journaling, `synchronous=FULL`, and one monotonic revision in
`project_meta`. The tables below are the cutover contract.

| Boundary | Tables | Ownership rule |
| --- | --- | --- |
| Authority and queue envelope | `project_meta`, `queue_state` | `project_meta.project_state_authority` and the project revision select the source. `queue_state` owns version, selected release, last-updated time, and the execution/scope planning envelope. |
| Current work structure | `work_items`, `work_item_detail`, `task_dependencies`, `scopes`, `release_membership` | Indexed work facts, revision-matched task detail, dependency edges, release definitions, and release membership are database-owned. `release_membership` is the only release-to-task membership authority. |
| Current scope/read facts | `work_scope`, `project_summary`, `project_orientation`, `project_plan` | These are rebuildable projections or accepted-plan provenance. They are committed from the same queue snapshot and revision; they do not become competing writers. |
| Mutable task/project overlays | `task_execution`, `task_workspace`, `task_proof`, `task_evidence_current`, `current_execution`, `current_runtime`, `owner_inputs`, `repositories`, `project_availability`, `attention_records`, `project_reconciliations` | Each row family has one write boundary. Historical evidence and full execution history remain detail records, not current-state alternatives. |
| Saved read models | `current_thread`, `thread_history_state`, `thread_history`, `project_diagnostics`, `memory_health`, and the delivery projection tables (`delivery_read_projection_meta`, `delivery_read_projection_candidates`, `delivery_read_projection_edges`, `delivery_read_projection_primitives`) | These are bounded, revisioned projections. They may be missing or stale while refreshing, but they must never be rebuilt inside an ordinary read. |
| Projection operations | `projection_watermarks`, `projection_jobs` | These tables record obligations and freshness only. They do not own project facts and cannot make an old projection current. |
| Historical/detail boundary | compressed task-evidence ledgers and other existing JSONL/history records | Retain bounded history for inspection/export. The transitional `queue_detail` row is not a normal read source and must be empty after per-task detail is verified. |

The machine-level `fleet_summary_projection` table is a separate derived index.
It stores one bounded fleet card per registered project with the source project
and queue revisions. It consumes the project summary; it must not summarize raw
project state independently.

## Projection refresh triggers

Every authoritative mutation advances `project_meta.revision`, marks the saved
summary stale unless the mutation explicitly preserves it, records projection
jobs at that exact source revision, and emits an invalidation after commit.
The writer supplies the domain names; the scheduler coalesces them per project.

| Source change | Domains/refreshes | Required result |
| --- | --- | --- |
| Queue, task, hierarchy, dependency, release, selected scope, or planning-envelope mutation | `queue`, `scope`, `release`; refresh summary/action, scope, release membership, compact task models, delivery, Thread, attention, diagnostics, memory health, and fleet | One transaction updates changed current rows and the queue revision. Unchanged detail rows keep their payload and receive only the new revision watermark. |
| Runtime, workspace, execution, proof, or current evidence update | `task-runtime`, `workspace`, `execution`, `runtime`, `evidence`; refresh the affected summary/status/scope, delivery, attention, diagnostics, and memory projections | The overlay/proof/current-evidence row commits before the derived refresh. Historical evidence is appended or compacted under its own retention policy. |
| Owner input, attention, reconciliation, or availability change | `owner-input`, `attention`, `reconciliation`, `availability`; refresh attention and any summary/action/readiness fields that depend on the change | Keyed row replacement preserves unchanged row identity. Reconciliation/attention writes must not cause a second inbox interpretation. |
| Repository observation, configuration, or external operation result | `repository`, `config`, or the relevant operation domain; refresh diagnostics and the affected project surface | Git, provider, container, and worktree inspection is recorded as a last-known observation. Compact reads do not rescan those systems. |
| Delivery mutation or contract apply/revert | `delivery`, usually with `attention`; refresh the revisioned delivery tables and affected current action/readiness | Delivery projection rows must carry the source project/queue revision and fail closed when the source snapshot is not available. |
| Thread/activity write | `thread`; refresh `current_thread` and the bounded paged history independently | A thread-only refresh must not invalidate the fleet card or wait for attention/diagnostic work. |
| Memory or context-diagnostic write | `memory`; refresh only bounded memory health/diagnostic state | Raw prompt/context bodies and unbounded transcripts stay outside ordinary project reads. |
| Another process changes a project or repository | freshness watcher emits `legacy`/`repository` invalidation | The watcher schedules the same projector path. It never reads the changed file as a hidden fallback. |

The current implementation details are intentional cutover behavior:

- `commitAuthoritativeMutation` records default obligations for `summary`,
  `attention`, `diagnostics`, and `memory`; the runtime maps the summary job to
  the queue refresh domain.
- `createProjectProjectionRefreshScheduler` waits 150 ms to coalesce writes,
  permits one refresh per project, defers a newer event while one is in flight,
  and allows one bounded retry.
- The projector claims at most 16 jobs, marks a domain current only at the
  completed source revision, and requeues when a newer revision committed during
  the read. Failed jobs retain bounded error text and remain observable.
- Fleet rows are marked stale at the invalidation boundary only for domains
  that affect the fleet summary, then republished after project projections
  commit. Thread, attention, memory, and diagnostics do not become a second
  fleet summarizer.

## Compatibility readers

Authority selection must use the same SQLite connection for
`project_state_authority`, `project_meta.revision`, and `queue_state.revision`.
The boundary is:

1. **Unpromoted/bootstrap project:** explicit migration/bootstrap code may read
   legacy `TASKS.json`, legacy runtime/workspace stores, legacy evidence, and
   file summaries in order to import them. This is the only normal path that may
   initialize a database from files.
2. **Promoted project:** runtime reads use the sessions boundary, including
   `readProjectStateDatabaseQueueDefinition`, compact inventory/detail readers,
   and the canonical current-state snapshot. A missing queue-detail row,
   corrupt database, or stale projection returns an explicit unavailable/stale
   result; it does not reopen legacy files.
3. **Migration-only conversion:** APIs named `ForMigration` and the explicit
   migration functions may read the old shape, verify it against the database,
   write normalized rows, and remove the source after verification. They must
   never be imported by an ordinary route or writer.
4. **Evidence:** pre-promotion readers may use legacy evidence. After
   `project_meta.task_evidence_authority` becomes `database` or `compressed`,
   current evidence and proof come from SQLite; historical detail comes from
   the bounded ledger. `allowLegacy` is migration/bootstrap compatibility, not
   a promoted runtime fallback.
5. **Compatibility summary files:** `project-summary-staleness.ts` leaves the
   old file untouched for promoted projects so it cannot masquerade as the
   current model. The file is never consulted to answer a promoted read.

All ordinary route modules must remain behind the shared state boundary. The
data-layer guard must continue to reject direct SQLite access and direct
aggregate-state reads outside the sessions/migration owners.

## Migration order

Run this per project under the project write lock with normal project writers
stopped. The existing `BUILT_IN_PROJECT_MIGRATIONS` order is the dependency
order; do not run the final IDs selectively on a partially prepared project.
The manual `0.9.0/runtime-backed-project` migration is a separate owner-health
decision and is not a reason to postpone this storage cutover.

### 1. Inventory and snapshot

- Enumerate every registered project and record authority, schema version,
  project/queue revisions, migration ledger, source file presence, task counts,
  release membership counts, byte sizes, and database integrity.
- Take an immutable migration snapshot and manifest before any destructive
  step. Include `project-state.db`, all legacy current-state files, the
  migration ledger, source hashes, byte counts, and the detected project
  revision. A missing or incomplete snapshot is a no-go.
- Parse the legacy queue and evidence sources before import. Record malformed
  inputs as blocked projects; do not convert parse failure into an empty queue.

### 2. Prepare the normalized database

Apply the existing automatic migrations in runner order through the pre-cutover
read-model work: database creation and rollback journal; orientation/map/scope
and work-list projections; live-state consolidation and queue envelope; task
overlays; queue/detail revisions and compact compatibility export; current
status/action/evidence/inbox/scope/orientation/plan stores; per-task detail;
Thread stores; and evidence authority/compression.

The important dependency is: import the queue and all current overlays first,
then promote `project_meta.project_state_authority` to `database`, then rebuild
the summary and projections from the promoted snapshot. No source file is
deleted merely because the database exists.

### 3. Verify the authority boundary

Before finalization, require all of the following for the project:

- `project-state.db` opens at schema version 32 and passes `PRAGMA
  integrity_check`;
- `project_meta.project_state_authority = 'database'` and the authority,
  project revision, and queue revision were read together;
- `work_items` count equals the queue task count and every task has a
  non-empty `work_item_detail` row at the matching queue revision;
- current overlays, current proof, evidence authority, release definitions,
  and selected scope are present or explicitly empty by contract;
- `project_summary.freshness = 'current'`, its revision is not behind the
  committed queue revision, and its counts/action/scope come from that same
  snapshot;
- no current-state write path still creates `TASKS.json`, full queue detail, or
  `project-summary.json` as a second authority.

### 4. Execute the final cutover tranche

Run the existing migrations in this exact order after the preparation phase:

1. `0.13.0/project-state-finalize`: verify the SQLite queue/detail index and
   current summary, clear the duplicate aggregate `queue_detail` row, then
   remove the legacy current-state files only after those checks pass.
2. `0.13.0/project-state-legacy-live-file-cleanup`: recheck and remove files
   left behind when an earlier build already recorded finalization. It is
   idempotent and migration-only.
3. `0.13.0/project-summary-effective-state-realignment` and
   `0.13.1/project-current-status-projection`: rebuild summary, status, and
   scope from current effective evidence without reopening compatibility files.
4. `0.13.1/release-membership`: normalize release-to-task membership into the
   single `release_membership` relation.
5. `0.13.2/compact-task-read-models`: backfill compact graph/list task facts
   from per-task detail without hydrating definitions in list reads.
6. `0.13.3/delivery-read-projection`: create the delivery projection schema;
   the projector then populates revisioned rows.
7. `0.13.4/stored-request-title-integrity`: repair only titles provably
   cropped by source text; leave ambiguous records visible for review.
8. `0.13.5/owner-input-current-authority`: publish the normalized owner-input
   queue and remove its summary duplicate after the authority watermark.
9. `0.13.6/release-membership-current-authority`: remove task release arrays,
   scope membership arrays, and old definition-envelope membership fields
   after the normalized release relation is verified.

### 5. Refresh and publish

After the migration ledger records the project cutover, run one explicit
projection refresh. Wait for all required domains to reach the cutover or a
newer project revision with `succeeded` status. Publish the fleet row only
after the project summary, attention, Thread, diagnostics, memory, and delivery
projections have committed. Repeat this for all registered projects, then prune
fleet rows for projects no longer registered.

## Legacy file retirement

The final cleanup allowlist is the exact list in `legacyCurrentStateFiles` in
`src/runtime/migrations.ts`:

- the system-local `TASKS.json` compatibility queue;
- `queue-details.json` and `queue-details.json.gz` compatibility/detail
  sidecars;
- `project-summary.json`;
- `project-availability.json`;
- `attention.json`;
- `reconciliations.json`;
- the legacy runtime state path and task workspace state path.

Retirement rules:

- delete only the allowlisted current-state files after the authority gate;
- leave migration ledgers, rollback snapshots, project plans, bounded evidence
  history, Thread history, memory history, diagnostics, and user artifacts
  intact;
- do not delete historical evidence merely because current proof is now in
  SQLite. The `0.12.41`/`0.12.42` evidence migrations remove only verified
  legacy source records and retain the bounded historical owner;
- keep `queue_detail` physically available only as a schema compatibility
  shell if required by older databases, but require zero rows after
  `0.12.44`/finalization;
- if any new write recreates a retired file, fail the cutover gate and fix the
  writer boundary. Do not add a reader to hide the regression.

## Rollback and recovery

Rollback is snapshot-based and whole-project, never a merge between the new
database and old files.

- **Before deletion:** abort the project, leave legacy files in place, mark
  failed migration/projection work in the ledger, and repair or rerun from the
  same snapshot. No authority downgrade is needed for a non-destructive retry.
- **After deletion but before acceptance:** stop the service, restore the exact
  pre-cutover file/database/ledger set from the migration manifest, and rerun
  integrity and count checks. Restore the ledger with the snapshot rather than
  editing an `applied` record by hand.
- **Projection-only failure:** retain SQLite current state, mark the affected
  job failed/stale, retry from its source revision, and let a newer committed
  revision supersede it. Do not recreate legacy files as a recovery shortcut.
- **Code rollback requiring legacy readers:** restore the complete pre-cutover
  snapshot, including the database and ledger, before running old code. A
  partially restored legacy file beside a promoted database is not a supported
  state.
- **External systems:** Git, providers, containers, and worktrees are not part
  of the SQLite transaction. Rollback restores their saved observations and
  derived rows only; it does not pretend to undo an external operation.

Every rollback must produce a new evidence record containing project ID,
source/target revisions, restored paths, manifest hash, integrity result, and
the reason for aborting.

## Measurable go/no-go gates

### Storage and consistency

For every registered project, the cutover report must show:

- exactly one current `project-state.db`; `project_meta` authority is
  `database`; `PRAGMA integrity_check` is `ok`;
- queue task count = `work_items` count = non-empty `work_item_detail` count;
  no orphan dependency, scope, membership, overlay, or proof rows;
- `release_membership` agrees with release definitions and `work_scope`; no
  surface may derive a second membership list from legacy arrays;
- `project_summary`, required projection watermarks, and the fleet row point to
  the same or newer source revision; there are zero pending/failed projection
  jobs at acceptance;
- zero retired current-state files from the allowlist, zero `queue_detail`
  rows, and zero compact-read sidecars recreated after a clean read pass;
- before/after bytes are recorded separately for current state, retained
  history, diagnostics, snapshots, and retired files. Retired current-state
  bytes must be zero; bounded stores must remain within their existing limits,
  including Thread history at 2,000 turns/512 KiB and diagnostic projection at
  32 KiB;
- a read-only compact/fleet pass creates no directory, database, journal, or
  sidecar. Prove this with filesystem entries and the data-layer guard tests,
  not only endpoint success.

### Runtime and performance

Run the installed artifact after `pnpm build`, `pnpm dev:install`, and
`guildhall stop && guildhall start`; `/api/stale-server` must report
`stale:false`. Run cold and warm passes of
`scripts/project-state-performance-audit.mjs` and require these limits:

| Read | Time | Response |
| --- | ---: | ---: |
| `/api/service/projects` | <= 250 ms | <= 128 KiB |
| `/api/service` | <= 250 ms | <= 128 KiB |
| `/api/service?detail=true` | <= 750 ms | <= 128 KiB |
| `/api/fleet/attention` | <= 250 ms | <= 256 KiB |
| compact `/api/project` | <= 500 ms | <= 256 KiB |
| rich task detail | <= 750 ms | <= 512 KiB |
| Thread | <= 1,000 ms | <= 512 KiB |

All required projects must have no loading/error markers, and the agreement
audit must show identical selected release, scope membership, counts, blocker,
next-action, authority, and revision state across fleet, Overview, Work, Map,
Thread, Release, and activity surfaces.

The current audit still finds synchronous per-project SQLite reads in the
server fleet loops. That is a known residual risk, not proof that the model is
wrong. The cutover remains no-go if the cold/warm limits fail, if a locked
project blocks the fleet beyond the limits, or if p95 over repeated runs
regresses from the listed budgets. The audit must report project-local failure
containment separately from aggregate latency.

## Evidence required to close the cutover

- migration dry-run and apply reports for every registered project;
- snapshot/manifest hashes and before/after storage report;
- focused migration, database, projection refresh, read-boundary, and
  data-layer guard tests;
- installed build, stale-server, cold/warm performance, and project-state
  agreement output;
- a final `git diff --check` and a status check proving this plan is the only
  artifact changed by this scoped documentation task.

## 2026-07-17 retention closeout

This section supersedes the earlier open retention gate. The implementation
and installed proof now establish the following cutover boundary:

- project-state schema 33 is the only current-state database authority;
- `historical_artifacts` is metadata-only and records ownership, logical path,
  byte count, digest, retention class, and lifecycle state;
- review transport, migration snapshots, and evacuation history are registered
  at their write boundary and backfilled from known legacy locations;
- unmanifested migration payloads are archived with gzip only after a registry
  write and two digest checks, then the source is removed;
- all seven registered projects report zero unclassified historical artifacts;
- installed startup, bounded read performance, and cross-surface agreement all
  pass after the maintenance run.

### Final schema and contract decisions

- **Schema Migration Decision:** `0.13.7/historical-artifact-registry` is an
  additive metadata index. It does not add payload bodies to SQLite, change
  current task/release rows, or create a second current-state authority.
- **Contract Touch Decision:** historical writer registration, cleanup output,
  and compaction result fields are the touched contracts. Current-state task,
  release, summary, and fleet read contracts were considered and remain
  project-state-boundary-owned.
- **Cleanup safety:** no source is deleted from a census alone. A source must
  have a stable digest, a registry record, a verified archive or replacement,
  and a successful round-trip integrity check.
- **Rollback:** retained archives and registry metadata are sufficient to
  identify and verify restoration. No compatibility reader is reintroduced as
  an ordinary current-state fallback.

### Closeout evidence

The final maintenance run registered 457 artifacts totaling 6,272,664 bytes
across seven project databases, with zero unclassified rows. Narrative Harness
legacy migration storage fell from 964,960 to 97,851 bytes; Looma + Knit fell
from 4,048,813 to 226,946 bytes. The installed service reports `stale:false`,
refreshes all seven projects without errors, passes every performance budget,
and the agreement audit reports `mismatchCount: 0`.

### Transition-state follow-up

The shared read model is also covered through stale and running transitions in
`fleet-read-model-isolation.test.ts`: the authoritative execution write first
makes all fleet surfaces stale, then the projection refresh makes all of them
current with the same running execution state and Pause control. A live
registered-project transition capture remains a final evidence task. It must
use a snapshot/restore wrapper and prove clean restoration; it is not a reason
to add another state authority or to leave a project running.

## 2026-07-17 completion-evidence boundary repair

The remaining completion-state inconsistency found during the final gate was
not a UI bug. `doneSummaryBundle` is a bounded completion artifact, but the
promoted definition writer stripped it as if it were disposable runtime data.
That meant a refresh could see a merged task but lose the earlier durable
completion time, producing different completion state depending on which
surface had last read the task.

- [x] Added `completion_summary` to the existing task-evidence contract.
- [x] Promoted queue writes move `doneSummaryBundle` through the evidence owner;
  it is not duplicated into current task definitions.
- [x] Current evidence keeps one compact completion summary per task, bounded by
  the existing evidence payload and current-row budgets.
- [x] Effective-task reconstructs the task-shaped completion field from that
  one evidence record, so importer, Work, Release, and task detail share it.
- [x] Added an automatic migration that imports still-present compatibility
  completion summaries into current evidence before final current-state cleanup.
- [x] The regression proving an earlier completion time survives status drift
  passes, along with the nine-file unified boundary suite (303 tests).

### Contract Touch Decision

- Work id: `codex:completion-summary-evidence-2026-07-17`.
- Touched contracts: `TaskEvidenceKind`, evidence retention/current projection,
  the promoted queue bridge, and effective-task reconstruction.
- Considered but not touched: task identity, release membership, summary
  counts, raw transcript storage, and the SQLite table layout.
- Required follow-up: run the compatibility migration for projects that still
  retain a full legacy queue, then verify the installed service and agreement
  audits.
- Proof required: completion timestamp regression, evidence/current-row
  reconstruction, migration idempotence, focused boundary suite, build, and
  installed proof.
- Apply/revert behavior: the new kind uses existing bounded evidence owners;
  reverting the behavior would reintroduce completion state loss and is not a
  valid compatibility fallback.

### Schema Migration Decision

- Persisted schema touched: the logical evidence vocabulary and existing
  `task_evidence_history`/`task_evidence_current` payloads; no SQLite table or
  column is added.
- Scope: promoted task completion evidence.
- Change class: additive logical record kind plus one-time data migration.
- Existing data impact: old completion bundles are imported only from the
  explicit compatibility queue during migration; raw transcripts are never
  imported.
- Migration id: `0.13.8/task-completion-summary-evidence`.
- Compatibility reader: none on ordinary reads; `effective-task` reads the
  normalized current evidence projection only for database-authoritative
  projects.
- Fixtures/tests: workspace-importer durable-completion regression, migration
  suite, and the unified boundary suite.
- Owner-facing plan text: completion summaries remain visible as essential
  completion proof, while full task evidence/history stays behind detail reads.
- Rollback: stop the migration before applying it; do not remove current
  evidence or restore task-definition duplication.
