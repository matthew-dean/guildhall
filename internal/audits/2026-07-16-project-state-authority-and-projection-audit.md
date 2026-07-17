# Project-State Authority And Projection Audit

**Date:** 2026-07-16
**Status:** Active architecture audit
**Scope:** Current project state, compact and rich read boundaries, projection
freshness, history retention, and write synchronization

## Decision

Guildhall has one current-state authority for promoted projects:
`project-state.db`. The application may expose many read models, but no route
may invent a second current interpretation from intake, compatibility JSON,
history, or live repository inspection.

The important distinction is:

- **Authority** answers what is true now.
- **Projection** is a durable, revision-tagged interpretation of that truth.
- **Detail** is an on-demand bounded read of the authoritative current record.
- **History** explains how the current record came to be; it is not replayed to
  render a compact card.
- **Draft/provenance** describes what Guildhall has inferred or imported; it is
  never silently promoted into current work by a GET.

One transaction is required whenever a response combines facts that must agree
with one another. It is not necessary, or desirable, for every historical or
point-detail query to load the entire project.

## Current Records

| Record | Current authority | Projection/detail role | History or compatibility boundary |
| --- | --- | --- | --- |
| Project identity/config | Registered workspace/config | Fleet identity and route binding | Config files remain the user-editable source |
| Work item identity, title, status, hierarchy, dependencies | `work_items` | Fleet, Overview, Work, Map inventory | `work_item_detail` holds irregular full task detail |
| Rich task definition | Revision-matched `work_item_detail` | Explicit task/detail reads only | `TASKS.json` and old queue detail are migration/export inputs |
| Scope/release membership and blockers | `work_scope` plus `scopes` | Release, Map, Overview scope counts | Imported plan is provenance in `project_plan` |
| Queue envelope and selected release | `queue_state` | Shared release identity and revision | Queue detail is migration-only |
| Project counts, action, readiness, blockers, orientation | `project_summary` plus auxiliary orientation/plan rows | Fleet, Overview, Work, Map, compact Release | Freshness indicates projection lag; no request-time repair |
| Task execution/workspace overlays | `task_execution`, `task_workspace` | Current task status and work context | Legacy JSON is compatibility input only after promotion |
| Current proof | `task_proof`, `task_evidence_current` | Proof state and readiness | `task_evidence_history` is bounded historical detail |
| Project execution/runtime | `current_execution`, `current_runtime` | Running/stopped/health summaries | Supervisor events remain operational history |
| Owner input/action queue | `owner_inputs` | Current action and blockers | Prompt/response detail remains behind explicit routes |
| Repository observation | `repositories` | Last-known repository signal | Git inspection is an explicit write/diagnostic operation |
| Saved Git/readiness diagnostic | `project_diagnostics` | Bounded Release diagnostic snapshot, freshness, and source revision | Live Git/readiness inspection is explicit and never replaces saved state |
| Availability | `project_availability` | Paused/available state | Old availability files are migration input |
| Attention/inbox | `attention_records` | Current inbox projection | Resolution history remains historical attention detail |
| Current Thread | `current_thread` | Bounded live navigation context | Older turns require the explicit history route |
| Reconciliation | `project_reconciliations` | Current resolved capability state | Reconciliation history is not a fleet-read input |
| Live activity | Supervisor stream plus bounded persisted event page | Current in-flight signal and explicit history | Raw events are retained under explicit limits |
| Intake/detected work | `project_plan` and workspace-import draft | Provenance, draft, and source trail | Never current task identity unless materialized by a write |

## Shared Read Boundaries

| Surface | Required boundary | Allowed extra work |
| --- | --- | --- |
| Projects/fleet shell | Fleet summary projection | Registered-project metadata only |
| Overview/Work/Map compact | `readProjectCompactStateModel` | Bounded page and selected point read |
| Rich project/Spine/Release detail | `readProjectCurrentStateModel` plus saved diagnostic projection | Explicit live proof, repository, or design inspection only when requested |
| Release summary | Compact projection snapshot | No Git scan or task-detail expansion |
| Task detail | Normalized task point/detail read | Related task IDs and explicitly requested evidence |
| Thread | `current_thread` plus compact project projection | Historical turns only through `/thread/history` |
| Activity | Current summary plus bounded live stream | Historical event page only when requested |
| Intake/source trail | Explicit provenance/draft readers | May scan sources because that is the feature being requested |

The compact boundary reads queue envelope, release definitions, summary,
revisions, and one paged inventory inside one SQLite transaction. The rich
boundary reads the materialized queue, scope rows, summary, and revisions in
one transaction. Both fail closed for promoted projects when the materialized
database state is unavailable.

Release definitions are now read from `scopes` and retain one durable identity.
A summary is not allowed to add a missing release or infer a selected release.
It may align presentation fields on an existing release row because that is a
single shared boundary normalization, not a new record. A
selected-release/definition mismatch is an inconsistent persisted state to
repair at a write/projector boundary, not an opportunity for a route to
manufacture a third in-memory state.

## Derived-Field Ownership

These fields must be calculated in the shared projection writer and consumed
by every surface:

- total, done, unfinished, ready, active, blocked, deferred, and owner-input
  counts;
- selected scope and release identity;
- release progress and readiness state;
- proof freshness and proof blockers;
- current action, action label, focus task, and action destination;
- current blockers and their blocking domain;
- recent work and in-flight task summaries;
- orientation spine and scope-row summaries;
- projection freshness, source revision, and last-updated time.

Views may format these fields. They may not re-rank inbox items, re-derive
release scope, decide whether a blocker is owner input, or synthesize a task
from a plan/draft.

## Request-Time Work That Is Still Explicit

The following are intentionally not part of ordinary compact reads or ordinary
rich Release reads:

- live Git status, Git Story, provider health, and repository inspection (the
  saved bounded diagnostic snapshot is part of the normal rich read);
- full task effective-state expansion when a compact indexed row answers the
  question;
- Thread history reconstruction;
- inbox reconciliation and attention repair;
- workspace signal detection and intake decomposition;
- evidence/history replay;
- context-debug, transcript, and provider trace loading.

These operations may update their owning current projection after an explicit
write or diagnostic request. A GET may report `stale`, `missing`, or
`requiresRefresh`; it may not mutate state to hide the lag.

## Synchronization Invariants

1. Every current-state write advances `project_meta.revision` exactly once for
   its logical change.
2. Any projection that depends on the changed domain is marked stale with the
   same revision before the write boundary emits invalidation.
3. The invalidation event carries the committed revision when a database
   exists, allowing same-process scheduling and cross-process metadata watching
   to converge on the same watermark.
4. A projection refresh uses compare-and-swap against the source revision. A
   concurrent write leaves the projection stale and schedules a bounded retry.
5. A promoted read never consults a compatibility file or intake snapshot for
   current task identity, status, scope, release membership, or counts.
6. A legacy reader is allowed only inside an explicit migration or compatibility
   path and is never a fallback for a promoted current-state read.
7. Historical storage has explicit record and byte limits. Raw transcripts and
   context-debug payloads are operational evidence, not durable project state.

## Known Remaining Work

- Task detail now uses one revisioned database snapshot for the point,
  relationships, compact queue, scope rows, and summary. It still performs
  bounded post-read work for effective proof, delivery relationships, and
  context; those are explicit detail concerns, but should eventually be
  persisted or separately requested rather than rebuilt for the initial drawer.
- The main Thread surface now reads its current projection, queue revision, and
  project revision from one bounded database transaction before adding compact
  project navigation context. The remaining Thread history/extras routes still
  need the same point-read treatment, and navigation itself should eventually
  be included in that one response snapshot.
- Authority selection is now one shared runtime boundary. A normalized queue
  makes SQLite the effective current-state authority even while the historical
  promotion marker remains legacy bookkeeping; a promoted database with no
  queue fails closed. This removes the marker-vs-queue split that allowed two
  readers to disagree about whether current work existed.
- The projector is asynchronous by design. Endpoint-level tests still need to
  cover every write domain, failed refresh, concurrent write, and cross-process
  retry behavior.
- Some explicit start/readiness paths still perform broad preflight and intake
  analysis. They are not fleet reads, but their output must continue to be
  labeled as live preflight or draft state rather than current summary state.
- Summary patch updates now apply their patch inside the serialized database
  transaction, and summary projection refreshes capture their project
  watermark before building the potentially expensive projection.
- Targeted task, release-selection, and batch mutations now require both the
  queue revision and full project revision captured by their read boundary.
- The repository-wide TypeScript baseline still contains unrelated historical
  `serve.ts` errors. The touched data-layer modules are type-clean under the
  targeted check, and production build remains the installation gate.

## Proof Record

- Focused boundary/runtime proof: 201 tests across the task-detail,
  read-boundary, summary-projection, and normalized database suites.
- Installed service: `stale:false` after build, development installation, and
  restart.
- Real project agreement: 7 registered projects, including Narrative Harness,
  Looma + Knit, Jess, and Fair Labor License; 0 mismatches.
- Installed performance: fleet 27.22 ms / 25,261 bytes; all project, rich-task,
  and Thread reads within documented budgets; no loading/error responses.

## 2026-07-16 - Map read boundary and freshness honesty

The noncompact project spine no longer calls the canonical queue reader,
effective-task expansion, live start preflight, workspace-import detection,
charter inference, or release/Git detail checks. It now reads one normalized
map snapshot containing the queue envelope, materialized task inventory,
saved summary, and both revision watermarks. A stale map is still allowed to
show its last-known saved shape, but the response exposes `summaryFreshness`,
the source revisions, and `requiresRefresh`; it cannot silently claim that its
derived interpretation is current.

The owner-input projection also no longer restores `freshness: current` from
the summary it read before writing the normalized owner-input table. That
write advances the project revision and the summary remains stale until the
projection refresh has rebuilt all dependent facts.

- [x] Full spine reads through `readProjectMapStateModel`.
- [x] Map/spine response exposes the saved projection freshness and source
  watermarks.
- [x] Owner-input writes preserve stale state until the owning projector runs.
- [x] Boundary regression proof covers the map snapshot; 35 focused boundary
  and read-boundary tests pass.
- [ ] Remaining: persist and consume repository/readiness observations through
  the same projection refresh, then remove the remaining rich Release and
  task-detail request-time recomputation.

### Contract Touch Decision

- Work id: `codex:map-snapshot-freshness-2026-07-16`.
- Touched contracts: full spine read source, spine freshness metadata, and
  owner-input summary freshness semantics.
- Considered but not touched: task/release schema, repository schema, and
  compatibility file formats.
- Required follow-up: move live repository/readiness observations into their
  durable current projections and make rich detail routes consume them.
- Proof provided: production build, focused boundary/read-boundary tests,
  data-layer lint, and contract-touch lint.
- Apply/revert behavior: runtime read/writer behavior only; no data migration
  or history rewrite.

### Schema Migration Decision

- Persisted schema touched: none.
- Change class: read-boundary consolidation and stale-state honesty.
- Existing data impact: no rows are rewritten; stale summaries remain visibly
  stale until the existing projector refreshes them.
- Migration id: not required.
- Compatibility reader: no new compatibility reader added.
- Rollback/revert: runtime-only revert; no stored-data rollback required.

This document is an authority audit and verification contract. It does not
introduce another project model.

## 2026-07-16 - No second current-state authority in diagnostic reads

The Release detail mismatch exposed two separate problems that must stay
separate in the architecture: task identity came from the normalized queue,
while Git Story was a live diagnostic observation. The detail route no longer
persists that observation as a side effect of GET, and the map/spine route no
longer tries to reproduce it. The saved projection remains the current-state
answer; live detail is labeled as a diagnostic answer with its own freshness
and consistency fields.

The sessions layer now also exposes repository reads by `TASKS.json` path as
well as project root, both delegating to the same database-path reader. This
closes a concrete path-shape escape hatch where a runtime summary could have
opened a phantom nested database instead of the project's database.

- [x] Git Story GETs remain read-only; explicit task Git Story actions are the
  only route-local Git observation writer in this area. The task-level Git
  Story diagnostic is covered by the same read-only regression guard.
- [x] Targeted task writes compare definition rows, not effective task cards
  with runtime/evidence overlays.
- [x] Ordinary targeted task writes can capture their queue CAS revision from
  the same current-state read when the caller does not supply one.
- [x] Repository readers use one sessions-layer path implementation.
- [x] Release-readiness, map, boundary, session, and read-only-route tests
  pass; the old tests that required live diagnostic blockers to rewrite the
  saved spine were updated to assert the new saved-vs-live contract.
- [ ] Remaining: move project-level live Git/readiness observations behind an
  explicit refresh writer and have the asynchronous projector consume them.

Installed proof after the task-level change: `stale:false`; seven-project
agreement audit reports zero mismatches; fleet projection read is 20.49 ms and
25,261 bytes with no loading or error responses.

### Contract Touch Decision

- Work id: `codex:no-second-current-state-authority-2026-07-16`.
- Touched contracts: repository read path selection, targeted mutation CAS
  behavior, diagnostic GET side-effect behavior, and saved-vs-live spine
  consistency expectations.
- Considered but not touched: persisted repository row shape and task/release
  schema.
- Required follow-up: add the project-level diagnostic refresh writer and
  durable projector retry boundary.
- Proof provided: focused runtime/session tests, data-layer lint, contract
  lint, and production build.
- Apply/revert behavior: runtime/read-boundary changes only; no data migration
  required.

### Schema Migration Decision

- Persisted schema touched: none.
- Change class: shared reader and read/write boundary consolidation.
- Existing data impact: no rows rewritten; live GET observations are no longer
  accidentally promoted into current state.
- Migration id: not required.
- Compatibility reader: no new compatibility reader; the path wrapper uses
  the existing SQLite database.
- Rollback/revert: runtime-only.

## 2026-07-16 - Release membership is now one normalized relation

The original Release mismatch was not only a route bug. The database
projection and Release detail had different membership inputs: one counted
materialized `work_items`, while the other reconstructed synthetic
`workspace-import:*` tasks from an intake snapshot. A shared helper would not
have been enough while `scopes.node_ids_json`, `work_items.release_ids_json`,
rich task detail, and summary projections could each act as an authority.

- [x] Added `release_membership(release_id, task_id, disposition)` as the
  normalized included/deferred relationship.
- [x] Release definitions, compact queue reads, task reads, and boundary
  scopes consume that relation after promotion; old JSON arrays are now
  migration/write input or presentation mirrors only.
- [x] Release-envelope writes update membership transactionally with release
  definitions. Task-only writes preserve membership and reject membership
  changes unless the release envelope is included in the same mutation.
- [x] Removed the ordinary-read fallback that restored old release arrays when
  the normalized relation was empty. Empty membership is now an actual empty
  relationship, not permission to read a second source.
- [x] Added `0.13.1/release-membership` and included it in the explicit
  project-state migration runner.
- [x] Focused state database, migration, boundary, Release, and read-boundary
  suites pass, including deferred-membership preservation and mutation guards.
- [ ] Full-suite and installed-fleet proofs still remain before this pivot is
  complete; those are the gates for deleting any further historical ordinary
  readers.

This is the structural DRY guarantee: routes may request a compact, detail,
or diagnostic read model, but none may choose its own release-membership
source or reconstruct a release from a scope-shaped object.

### Contract Touch Decision

- Work id: `codex:normalized-release-membership-2026-07-16`.
- Touched contracts: release/task membership, selected scope identity, compact
  queue reads, task detail reads, targeted task mutation behavior, and the
  explicit migration runner.
- Considered but not touched: release identity fields, task title/definition
  fields, evidence payloads, and the public release API shape.
- Required follow-up: migrate remaining historical fixture assumptions and
  prove all registered projects after installation.
- Proof provided: focused database/migration/boundary/Release suites and
  production compilation.
- Apply/revert behavior: apply the required membership migration before
  ordinary promoted reads; revert requires restoring the prior release reader
  and schema migration code, not hand-editing rows.

### Schema Migration Decision

- Persisted schema touched: SQLite schema v28, adding `release_membership`.
- Change class: normalized relationship-table addition with one-time backfill.
- Existing data impact: membership is backfilled from the last queue envelope;
  old arrays remain only as transitional write/migration material until the
  migration is applied.
- Migration id: `0.13.1/release-membership`.
- Safety: required before ordinary promoted reads can claim current release
  membership.
- Compatibility reader: none for ordinary reads; old node-id arrays are read
  only by the migration and explicit snapshot writers.
- Fixtures/tests: migration backfill, normalized empty reads, deferred-row
  preservation, targeted mutation rejection, and cross-surface agreement.
- Owner-facing plan text: apply the project-state migration; refresh a project
  whose release membership is unavailable instead of silently reconstructing it.
- Rollback/revert: stop ordinary reads, restore the prior application build,
  and restore from the database backup before rerunning the migration; do not
  merge old arrays back into the relation during a normal request.

## 2026-07-16 - Release scope now has one canonical execution envelope

The installed agreement audit exposed the exact class of mismatch this pivot is
meant to eliminate: Looma + Knit's saved release summary counted 16 execution
units, while the Release detail scope contained the split parent as an extra
17th node. The data was not merely stale; the normalized scope read model had
lost the parent relationship needed to apply the shared representative-row
rule without reopening the queue.

- [x] Normalized scope reads now join `work_scope` to the authoritative
  `work_items.parent_id`, so the hierarchy relationship is available from the
  same SQLite snapshot as scope state.
- [x] `executionScopeRows` is generic over the normalized row shape and is now
  the single representative-row rule for both summary counts and Release
  membership.
- [x] Release `nodeIds` and scope `nodeIds` are produced from that same
  execution envelope; they cannot disagree because one route happened to read
  raw release membership while another read projected rows.
- [x] The full membership graph remains in normalized `scopeRows` for Map and
  structural views; execution membership is an explicit derived view, not a
  second authority.
- [x] Added regression coverage for parent relationships and the active
  planning representative case.
- [x] Rebuilt, reinstalled, restarted, and verified `stale:false`.
- [x] Installed agreement audit passes for all 7 projects with `mismatchCount: 0`.
- [x] Installed performance audit passes: fleet 179.96 ms / 25,261 bytes; all
  cold, warm, rich-task, and Thread reads remain within budget.

This is the stronger DRY guarantee: a surface can choose a named read model,
but it cannot choose its own release membership math. If a parent/child rule
changes, the normalized projection helper changes once and every surface sees
the same result.

### Contract Touch Decision

- Work id: `codex:canonical-release-execution-envelope-2026-07-16`.
- Touched contracts: normalized scope read rows now expose `parentTaskId`;
  Release `release.nodeIds` and `scope.nodeIds` share execution semantics.
- Considered but not touched: SQLite table shape, release identity fields,
  task definition fields, and the full membership graph contract.
- Required follow-up: keep Map/structural consumers on full `scopeRows` and
  keep release/progress consumers on `executionScopeRows`.
- Proof provided: focused Release/settings suites, sessions boundary suite,
  installed agreement/performance/spine audits, build, and freshness check.
- Apply/revert behavior: read-model contract correction; no data rewrite.

### Schema Migration Decision

- Persisted schema touched: none. `parentTaskId` is read from the existing
  `work_items.parent_id` column while the existing `work_scope` table remains
  unchanged.
- Change class: normalized read-model enrichment and shared projection reuse.
- Existing data impact: no rows rewritten; existing promoted projects gain the
  relationship at read time from already-authoritative rows.
- Migration id: not required.
- Compatibility reader: none added.
- Rollback/revert: runtime-only.

Installed verification after this boundary change:

- `/api/stale-server` reports `stale:false` for the freshly installed bundle.
- `pnpm audit:project-state-agreement` passes for all 7 registered projects,
  including Narrative Harness, Looma + Knit, Jess, and Fair Labor License,
  with `mismatchCount: 0`.
- `pnpm audit:project-state-performance` passes at 28.29 ms / 25,261 bytes
  for the fleet; all cold, warm, rich-task, and Thread reads pass their
  budgets with current, non-loading responses.
- `pnpm audit:project-spine` passes and shows the real project classes and
  selected release/scope state rather than a synthetic universal MVP label.
- The full suite is not yet green: 13 files / 96 tests still assume retired
  filesystem queue exports or pre-projection request-time behavior. Those
  failures are recorded as migration/test-boundary work, not hidden as a
  passing architecture proof.

## 2026-07-16 - Durable diagnostics complete the single read model

The remaining live-read boundary is now explicit and bounded. Ordinary Release
detail reads the same canonical current-state snapshot as Summary, Work, Map,
and Thread, then reads the saved diagnostic observation from the same SQLite
state database. Git Story and repository/readiness scans run only in the
asynchronous diagnostic projector or after an explicit `live=true` inspection
request. A GET cannot manufacture a competing release, task, or diagnostic
authority.

- [x] Added SQLite schema v27 `project_diagnostics`, containing only bounded
  revision-tagged Git/readiness observations rather than task definitions,
  snapshots, or transcripts.
- [x] Added the `diagnostics` projection job to the same coalesced writer/job
  lifecycle as Summary and Attention.
- [x] Enforced revision matching: a current diagnostic row must equal the
  current project revision; older observations are labeled stale and cannot
  overwrite a newer current row.
- [x] Bound diagnostic blockers/text/serialized bytes, so repository inspection
  cannot recreate the former large payload in the project-state database.
- [x] Moved the projector callback inside the application boundary that owns
  `buildProjectReleaseReadinessPayload`; the scheduler no longer reaches into
  route-local builders or assembles a second state model.
- [x] Added a cheap repository signature watcher for external Git changes;
  those changes enqueue a repository/diagnostic refresh instead of making
  project list or Release GETs scan Git.
- [x] Preserved request-time Git/readiness inspection only as explicit
  `?live=true` diagnostics, with saved release/scope/count fields unchanged.

### Contract Touch Decision

- Work id: `codex:durable-diagnostic-projection-2026-07-16`.
- Touched contracts: Release detail diagnostic freshness, saved-vs-live
  diagnostic semantics, projection job domains, and project revision
  consistency.
- Considered but not touched: task/release definition fields, repository
  snapshot payloads, raw transcript storage, and the ordinary project summary
  contract.
- Required follow-up: continue deleting remaining request-time rich reads that
  are not explicitly diagnostic; add an owner-visible refresh affordance only
  if live inspection becomes a supported product action rather than an audit
  tool.
- Proof required: schema tests, Release regression suite, build/lint, installed
  stale-server proof, agreement audit, and performance audit.
- Proof provided: 4 diagnostic tests, 52 database tests, 22 projection/runtime
  tests, 77 Release tests, production build, `pnpm lint:contracts`,
  `git diff --check`, installed `stale:false`, 7-project agreement with zero
  mismatches, and fleet performance at 27.22 ms / 25,261 bytes.
- Apply/revert behavior: schema open adds the bounded diagnostic table and
  projection job domain; authoritative task/release data is untouched. A
  revert removes only the diagnostic read path/table and leaves current state
  intact.

### Schema Migration Decision

- Persisted schema touched: additive SQLite `project_diagnostics` table and
  schema version `27`; the existing `projection_jobs` lifecycle gains the
  `diagnostics` domain.
- Change class: derived diagnostic projection; no canonical task, release,
  repository, evidence, transcript, or history payload migration.
- Existing data impact: old databases open through the additive schema path;
  their diagnostic row is absent until the asynchronous projector computes it.
  No historical raw diagnostic payload is imported.
- Migration id: `project-state/27-diagnostic-projection`.
- Safety: writes require a non-negative revision, current rows must match the
  project revision, and payloads are bounded to the diagnostic storage budget.
- Compatibility reader: none; the ordinary read boundary returns `missing` or
  `stale` rather than reconstructing a legacy diagnostic shape.
- Fixtures/tests: project diagnostics, projection jobs, freshness watcher,
  Release, read-boundary, dashboard, Thread, and performance/agreement audits.
- Owner-facing plan text: Release detail shows the latest saved observation;
  live inspection is an explicit diagnostic request and cannot silently replace
  the saved project state.
- Rollback/revert behavior: stop scheduling the diagnostics domain and remove
  only the derived table; queue/release/task authority remains readable.

## 2026-07-16 - Projection obligations are durable, not process-local

The shared current-state boundary is now backed by a small SQLite obligation
queue. An authoritative write records only `(domain, source revision, status,
attempt metadata, bounded error)` in the same transaction as the write. The
refresh process claims those rows, publishes a watermark when its projection
is committed, and records failure instead of silently dropping the work.
Repeated writes coalesce to the newest revision, so this is synchronization
metadata rather than another payload store.

- [x] Added metadata-only `projection_jobs` rows with monotonic source
  revisions and one row per derived domain.
- [x] Added atomic claim, bounded failure, retry, and completion operations.
- [x] Wired the service projector to claim obligations before refreshing and
  mark claimed work failed if refresh throws.
- [x] Kept scheduler retries and durable job retries separate: the scheduler
  handles transient process timing, while SQLite preserves the obligation
  across process restarts.
- [x] Added regression coverage for coalescing, claim/fail/retry/complete,
  bounded errors, and runtime-write obligation creation.
- [ ] Remaining: move project-level live Git/readiness observations behind an
  explicit refresh writer so the durable jobs can own those observations too.

### Contract Touch Decision

- Work id: `codex:durable-projection-obligations-2026-07-16`.
- Touched contracts: projection refresh lifecycle, freshness watermarks, and
  failure visibility.
- Considered but not touched: task/release payload shapes and raw event
  history retention.
- Required follow-up: persist named project diagnostic observations rather
  than deriving them in Release detail GET.
- Proof provided: focused SQLite/session and refresh-scheduler tests, build,
  and contract lint.
- Apply/revert behavior: queued metadata is additive; deleting a job row does
  not delete authoritative current state, and a refresh can recreate it from
  the next authoritative write.

### Schema Migration Decision

- Persisted schema touched: additive SQLite `projection_jobs` table; schema
  version `26`.
- Change class: additive derived synchronization metadata; no authoritative
  task, release, repository, or evidence rows are rewritten.
- Existing data impact: old databases create an empty job table on open; no
  payload backfill is required because the next write or explicit refresh
  records the current revision obligation.
- Migration id: schema-open additive migration, no separate project data
  migration.
- Compatibility reader: none; missing job rows mean “no queued obligation,”
  never “reconstruct current state during a GET.”
- Fixtures/tests: `project-projection-jobs.test.ts`, project-state database
  suite, and refresh scheduler tests.
- Owner-facing plan text: stale summaries expose freshness and refresh state;
  they are not silently replaced by a request-time rebuild.
- Rollback/revert: drop only `projection_jobs` and its index; authoritative
  rows remain intact, and the next write recreates the table/obligation.

Installed proof after the one-snapshot read-boundary change:
`/api/stale-server` reports `stale:false`; the agreement audit passes for 7
registered projects with `mismatchCount: 0`; the performance audit passes the
fleet at 33.11 ms / 25,261 bytes and all cold, warm, rich-task, and Thread
budgets.

## 2026-07-16 - One current-state read transaction for repository facts

The remaining “same data layer” gap was narrower than a new model but still
architecturally real: the rich serve path had its own canonical-state wrapper,
and indexed summary refresh read queue, inventory, summary, and repositories
through separate sessions calls. That left room for a caller to combine facts
from different revisions even though each individual call used SQLite.

The shared boundary now owns the rich queue-plus-effective-task snapshot.
Promoted reads do not derive release containers from task membership, and
queue selection is sourced only from the durable queue envelope. The existing
compact SQLite snapshot now includes bounded repository rows alongside queue,
inventory, and summary. Repository blocker projection consumes those rows
from that snapshot rather than reopening the database through a second reader.

- [x] Rich current-state reads use `readProjectCanonicalCurrentState`.
- [x] Promoted reads do not manufacture release containers.
- [x] Summary selection cannot fill in a missing queue selection.
- [x] Indexed summary refresh receives repositories from the same projection
  snapshot as its task rows.
- [x] 91 focused session/boundary/summary tests, build, and both advisory
  lints pass.
- [ ] Remaining: explicit project-level diagnostic refresh writer and rich
  detail consumption of the resulting saved observation.

### Contract Touch Decision

- Work id: `codex:single-current-state-read-2026-07-16`.
- Touched contracts: canonical rich read ownership, queue selection authority,
  and projection snapshot composition.
- Considered but not touched: persisted task/release/repository shapes and
  historical evidence storage.
- Required follow-up: give live repository/readiness inspection a named write
  boundary and define exactly which detail fields are saved versus live.
- Proof provided: focused tests, production build, data-layer lint, and
  contract-touch lint.
- Apply/revert behavior: runtime/read-boundary only; no data migration.

### Schema Migration Decision

- Persisted schema touched: none. Existing repository rows are read through
  the existing snapshot transaction.
- Change class: read-model consolidation.
- Existing data impact: no rows rewritten; reads stop deriving or borrowing
  current release state.
- Migration id: not required.
- Compatibility reader: no new compatibility reader.
- Rollback/revert: runtime-only.

## 2026-07-16 - No read-time release reconstruction

The release mismatch is now guarded at the authority boundary rather than
only in the Release route. Current reads use persisted `scopes` and
`queue_state`; task membership and derived summaries cannot create or select a
release in memory.

- [x] Removed route-level release union/defaulting from current reads.
- [x] Removed selected-release fallback from task membership.
- [x] Removed summary fallback for compact queue selection and metadata.
- [x] Added regression coverage for task-only IDs and summary/queue drift.
- [ ] Remaining: durable saved diagnostic projection and retryable refresh
  jobs for live repository/proof observations.

Proof: 162 focused tests passed; production build, data-layer lint, and
contract-touch lint passed; installed app reports `stale:false`; agreement
audit passes for 7 projects with `mismatchCount: 0`; performance audit passes
with fleet 26.3 ms / 25,260 bytes and all cold, warm, rich-task, and Thread
budgets.

## 2026-07-16 - Durable projection obligations and saved rich orientation

- [x] The noncompact spine and rich project detail routes consume the saved
  orientation projection; they no longer rebuild scope/release/readiness from
  task membership during a GET.
- [x] The saved orientation tree is expanded into a node lookup only as a
  mechanical response adapter; it does not create or select project state.
- [x] Workspace config is resolved during explicit orientation intake/refresh,
  so council/coordinator charter facts are persisted rather than discovered
  opportunistically by a route.
- [x] SQLite authoritative writes enqueue coalesced projection obligations;
  refresh claims, failure metadata, retry, and completion are durable and
  bounded.
- [x] Thread freshness compares both project and queue revisions, and Activity
  serves the last saved projection rather than rebuilding a stale queue.
- [ ] Remaining: make project-level Git/readiness observations a named durable
  diagnostic projection; Release detail currently returns them only under its
  explicitly separate `diagnostics` field.

### Contract Touch Decision

- Work id: `codex:saved-rich-orientation-and-projection-jobs-2026-07-16`.
- Touched contracts: `/api/project/spine`, rich `/api/project` orientation,
  Release saved-vs-diagnostic fields, Thread freshness, and projection job
  lifecycle.
- Considered but not touched: task/release definition shapes, raw transcript
  storage, and compatibility readers.
- Required follow-up: persist bounded Git/readiness diagnostic snapshots and
  expose their own source revision/freshness in Release detail.
- Proof provided: focused spine/boundary/session/refresh tests, `pnpm build`,
  `pnpm lint:contracts`, and the installed freshness/agreement/performance
  audits after final integration.
- Apply/revert behavior: stale projections remain readable as last-known
  state with freshness; no GET mutates authoritative project data.

### Schema Migration Decision

- Persisted schema touched: additive SQLite `projection_jobs` table and index;
  schema version `26`.
- Change class: derived synchronization metadata; no task, release,
  repository, evidence, or transcript payload migration.
- Existing data impact: old databases open with no queued obligations; the
  next authoritative write or explicit refresh records one.
- Migration id: schema-open additive migration, no compatibility reader.
- Fixtures/tests: project projection jobs, project-state database, refresh
  scheduler, Thread refresh, spine, Release, and read-boundary suites.
- Owner-facing plan text: stale state is labeled and refreshed; it is never
  silently replaced by a second request-time interpretation.
- Rollback/revert: remove only the job table/index; authoritative state is
  preserved.

## 2026-07-16 - Installed proof of one current-state authority

The running installed app now proves the distinction that was previously
missing: compact and rich surfaces read the same durable current-state
projection, while explicitly live checks are labeled as diagnostics and cannot
overwrite it during a GET.

- `pnpm audit:project-state-agreement` passed for 7 registered projects,
  including Narrative Harness, Looma + Knit, Jess, and Fair Labor License,
  with `mismatchCount: 0` for every project.
- `pnpm audit:project-state-performance` passed with a 25.74 ms fleet shell
  read and 25,261 bytes. Every cold and warm project summary was current,
  non-loading, and error-free; rich task and Thread reads also passed their
  budgets. The largest measured cold project summary was 49,199 bytes and the
  largest measured Thread response was 53,528 bytes.
- `pnpm vitest run src/runtime/__tests__/serve-release-readiness.test.ts`
  passed all 76 tests, including regression coverage that prevents
  unmaterialized intake rows from inflating a release or project spine.
- `pnpm build`, `pnpm lint:contracts`, and `git diff --check` passed. The
  installed server reports `stale:false` after the build/install/restart
  sequence.

This makes the original Release mismatch impossible for the ordinary saved
current-state fields: the route cannot manufacture a second task or release
projection and still pass the agreement audit. The remaining boundary is
deliberate and visible: project-level Git/readiness inspection is still a
request-time `diagnostics` payload. It is not allowed to mutate or replace the
saved summary. The next architectural step is to persist that bounded
diagnostic observation behind the same projection-job writer, after which rich
detail can be a read of named saved projections rather than a live inspection.

## 2026-07-16 - Read boundaries cannot disagree about release identity

The Release mismatch exposed a deeper failure mode than one bad adapter: a
route could read a durable queue, read a durable summary, and then merge them
with summary identity taking precedence. That was still two authorities inside
one request, even though both inputs came from SQLite.

- [x] `readProjectSavedReleaseState` now owns the saved queue/scope/summary/
  diagnostic/revision snapshot used by ordinary Release reads.
- [x] The selected release ID and release identity come only from the durable
  queue envelope and persisted release definition. Summary state may project
  status, but cannot select, rename, or manufacture a release.
- [x] Saved scope identity follows the selected queue release when one exists;
  an unnamed current-work scope remains a summary projection rather than an
  invented release container.
- [x] Start blockers for imported work and meta-intake reads now consume the
  canonical current-state boundary rather than reopening a second queue path.
- [x] Regression coverage proves ordinary saved Release reads have no task
  expansion and no synthetic release/task identity path.
- [ ] Remaining: migrate stale test fixtures that still inspect retired
  `TASKS.json` exports after database authority promotion; those fixtures are
  not valid proof of the current read contract.

### Contract Touch Decision

- Work id: `codex:release-identity-at-current-state-boundary-2026-07-16`.
- Touched contracts: ordinary Release identity/selection, saved scope identity,
  and start/meta-intake read authority.
- Considered but not touched: ProjectRelease schema, release persistence, and
  historical transcript/evidence retention.
- Required follow-up: convert remaining legacy fixture helpers to use the
  canonical boundary, then run the full suite without historical-file reads.
- Proof provided: Release suite, boundary suite, progress suite, Thread
  refresh suite, build, data-layer lint, and contract-touch lint.
- Apply/revert behavior: runtime read-boundary behavior only; no persisted
  data rewrite.

### Schema Migration Decision

- Persisted schema touched: none.
- Change class: read-authority consolidation and route dependency removal.
- Existing data impact: ordinary reads stop allowing summary identity to
  override queue identity; no rows are rewritten.
- Migration id: not required.
- Compatibility reader: none added. Legacy queue access remains limited to
  explicit migration/bootstrap paths.
- Rollback/revert: runtime-only.

## 2026-07-16 - Diagnostic blockers cannot leak into saved Release state

The installed agreement audit caught one final authority leak after the
queue/summary identity fix: ordinary Release detail was publishing a hybrid
blocker list made from the saved task summary plus saved Git/readiness
diagnostics. That made repository follow-up look like release task work on one
surface even though the compact summary correctly excluded it.

- [x] Top-level `releaseBlockers`, completion, totals, and verdict now read only
  from the saved release summary.
- [x] Git/repository follow-up remains visible under the explicitly diagnostic
  `diagnostics.releaseBlockers` and `diagnostics.gitStory` fields.
- [x] Added regression coverage proving the two fields remain distinct.
- [x] Rebuilt, reinstalled, restarted, and verified the installed server with
  `stale:false`.
- [x] Agreement audit passes for 7 projects with `mismatchCount: 0`.
- [x] Performance audit passes: 41.96 ms fleet shell, 25,261 bytes, all cold,
  warm, rich-task, and Thread reads within budget.

This is the intended DRY boundary: different views may ask for compact,
saved-rich, or explicit-live representations, but they cannot invent a new
meaning for the same saved release state. The remaining full-suite failures are
legacy fixture helpers that still read retired `TASKS.json` exports after
promotion; they must be migrated before the full suite is an honest proof of
the new authority model.

### Contract Touch Decision

- Work id: `codex:diagnostic-blocker-authority-2026-07-16`.
- Touched contracts: ordinary Release blocker semantics and diagnostic blocker
  semantics.
- Considered but not touched: task/release persistence schemas and diagnostic
  storage schema.
- Required follow-up: migrate legacy fixture readers and rerun the full suite.
- Proof provided: Release regression suite, agreement audit, performance audit,
  build, installed freshness check, and contract/data-layer lints.
- Apply/revert behavior: runtime read-model separation only; no data rewrite.

### Schema Migration Decision

- Persisted schema touched: none.
- Change class: read-model authority separation.
- Existing data impact: none; saved rows are unchanged.
- Migration id: not required.
- Compatibility reader: none added.
- Rollback/revert: runtime-only.

## 2026-07-16 - Current authority is a data-layer fact, not a marker lookup

The Release mismatch had one more layer underneath it. The database queue was
already readable and authoritative, but some rich import/intake callers still
consulted the historical `project_state_authority` promotion marker. That
allowed a single request to read task definitions from one source, evidence
from another, and stale compatibility JSON for a third. A DRY data layer must
make that combination impossible for ordinary code.

- [x] Added the sessions-layer current-authority snapshot: a populated
  normalized `queue_state` row establishes the current source together with
  its project and queue revisions; the historical marker remains migration
  bookkeeping only.
- [x] Added the named `readProjectTaskQueueForRichMutation` boundary for
  explicit import/intake mutations that need effective task evidence. Compact
  consumers continue to read the small definition/projection model.
- [x] Routed importer, intake, meta-intake, effective-task, task-state,
  runtime, MCP, and tool callers through current-authority reads and the shared
  boundary. No ordinary caller chooses between SQLite and compatibility files.
- [x] Added a guardrail that rejects historical-authority readers outside
  migration/projection implementation modules.
- [x] Added regression coverage with a deliberately stale historical marker
  and stale compatibility `TASKS.json`; the rich read still returns the durable
  SQLite definition and evidence note.
- [x] Workspace importer suite passes 90/90; boundary suite passes 15/15.
- [ ] Remaining: migrate the broader full-suite fixture population and any
  remaining migration-only callers into explicit named migration APIs; the
  production read/write path no longer needs the historical marker.

### Contract Touch Decision

- Work id: `codex:current-authority-single-data-layer-2026-07-16`.
- Touched contracts: current-state source selection, rich mutation reads, and
  task evidence visibility after database promotion.
- Considered but not touched: task/release schemas, evidence payload schema,
  and the historical migration marker itself.
- Required follow-up: keep new ordinary callers on the current-authority
  boundary and finish migrating legacy test fixtures.
- Proof provided: stale-marker boundary regression, full workspace-importer
  suite, data-layer guardrail, focused runtime suites, build, and installed
  agreement/performance audits.
- Apply/revert behavior: runtime source-selection consolidation; no data rewrite
  or history rewrite.

### Schema Migration Decision

- Persisted schema touched: none; existing `queue_state`, evidence, and task
  definition tables are reused.
- Change class: data-layer authority/read-boundary correction.
- Existing data impact: promoted projects now consistently read normalized
  definitions and overlays even if migration bookkeeping is stale; no rows are
  rewritten.
- Migration id: not required.
- Compatibility reader: retained only for unpromoted/bootstrap and explicit
  migration paths.
- Rollback/revert: revert runtime boundary changes; no persisted rollback is
  needed.

## 2026-07-16 - One authority means alternate reads are structurally bounded

The Release mismatch was not acceptable DRY architecture. A shared helper
would have reduced duplication, but it would still have allowed a route to
combine a durable task projection with a request-time task reconstruction. The
current boundary is stronger:

- SQLite normalized rows are the only promoted current-state authority.
- A serialized write boundary commits work-item identity, scope/release
  membership, overlays, and the invalidation watermark together.
- Compact, rich, Release, Map, Overview, Start, and Thread reads consume named
  snapshots from that authority. They may differ in payload size, but not in
  task identity, release membership, disposition, or status counts.
- `project_summary`, `project_diagnostics`, and the orientation snapshot are
  projections with explicit owners and revisions. They are not alternate
  stores that may repair or expand current work on a GET.
- Intake drafts, import snapshots, compatibility JSON, Git inspection, and
  history are explicit provenance, migration, diagnostic, or historical
  boundaries. They cannot become current work without a write that
  materializes normalized rows.

This is the distinction between DRY code and a DRY data model: the former
shares functions; the latter removes the possibility of two current answers.
The remaining legitimate variation is read shape and freshness, not source of
truth. A live diagnostic can be more recent than its saved projection, but it
is labeled live and cannot silently replace the saved release state.

### Final installed proof

- `pnpm audit:project-state-agreement`: 7 registered projects, required
  Narrative Harness, Looma + Knit, Jess, and Fair Labor License present;
  `mismatchCount: 0`; pass.
- `pnpm audit:project-state-performance`: fleet 27.14 ms / 20,899 bytes;
  every cold, warm, rich-task, and Thread read within budget, current, and
  free of loading/error responses.
- `pnpm audit:project-spine`: all seven projects rendered from saved state;
  no request-time task reconstruction was needed for the compact project
  surface.
- `pnpm build`, `pnpm dev:install`, restart, and `/api/stale-server` all
  passed; installed artifact reports `stale:false`.
- Focused Release/settings/summary projection proof: 231 tests passed.

The repository-wide `pnpm typecheck` still reports a broad historical
contract backlog in tests and legacy adapters; production build and the
focused authority tests are the current installation gate. That backlog is not
used as a second production state reader.
