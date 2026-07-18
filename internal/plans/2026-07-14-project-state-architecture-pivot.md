# Guildhall Project-State Architecture Pivot

**Status:** Active product pivot
**Date:** 2026-07-14
**Owner:** Guildhall implementation

## Decision

Pause the Narrative Harness MVP-completion drive until Guildhall can load,
summarize, and explain project state from a small, durable, synchronized read
model.

The active objective is:

> Redesign Guildhall's project-state architecture so project orientation,
> progress, release readiness, task status, proof state, and fleet summaries
> come from small, durable, synchronized read models rather than expensive
> request-time reconstruction. Validate the redesign against Narrative
> Harness, Looma + Knit, Jess, and Fair Labor License before resuming the
> Narrative Harness MVP-completion goal.

This is a product pivot, not a request to polish the current loading screen.
The current per-project hydration change is containment: it prevents one slow
project from blanking the fleet view while the model is repaired. It is not the
architectural solution and must be reviewed against this document before it is
treated as finished.

The fleet endpoint now follows the same boundary: `/api/service` is a
projection-backed summary read, while the old expensive payload is available
only through the explicit diagnostic request `/api/service?detail=true`. The
detail switch is a compatibility escape hatch for surfaces/tests that truly
need provider, migration, Git, inbox, thread, and history data; it is not a
valid dependency for the Projects page or any compact fleet read.

The compact fleet and activity paths now share that same projection-backed
action result. `/api/project/activity` is explicitly read-only: it may read a
bounded raw queue slice to label live in-flight work, but it cannot repair
stopped work or reconstruct historical state while polling.

The selected project shell now follows the same rule. The browser's default
project refresh uses `/api/project?compact=true`; Overview, Work, and Map use
the same endpoint with an explicit surface. The API now also makes that
projection the default for an unqualified `/api/project` request. `detail=true`
adds bounded saved inbox, memory-health, activity, and config sections to that
same projection; it does not select a second full-state reader. Only the
explicit `diagnostic=true` contract may reconstruct rich state or inspect live
repositories.

Existing installations are refreshed by the idempotent
`0.11.3/project-summary-approved-plan` and
`0.11.4/project-summary-approved-scope-selection` migrations. The projection
is rebuilt from the canonical task queue plus the already durable approved
workspace-plan snapshot; its selected release envelope is derived in memory
from approved release membership. These migrations do not rewrite task,
release, thread, evidence, or history records.

## Why This Pivot Exists

Guildhall currently asks a compact project card to carry the cost of a full
project reconstruction. A fleet read can invoke effective-task expansion,
provider/readiness work, inbox repair, thread projection, Git inspection, and
other history-derived calculations for every registered project before it
returns anything. That creates three failures at once:

1. The Projects page can be blank or show every project stuck at “still loading
   project state.”
2. A surface can display a state that another surface has not computed, or has
   computed differently.
3. A stale repair or historical record can override a newer proof or task
   transition, so the UI becomes an unreliable explanation of what Guildhall
   knows.

The user needs a fast, honest answer to three different questions:

- **Fleet:** What projects exist, and what is each one broadly doing?
- **Project:** What is the current scope, what has been completed, what is next,
  and what is blocking progress?
- **Detail/history:** What records, evidence, events, and documents support that
  answer?

Those questions must not share one expensive request path.

## What This Consolidates

This document supersedes competing implementation intentions. The earlier
documents are retained in `internal/plans/archive/` for archaeology only; they
are not active planning input:

- **Project spine / orientation:** becomes a read-model presentation of the
  project state. It is not a second hierarchy or a second intake database.
- **Project map / structure:** becomes a view over the same scope and work
  relations. It does not own progress or invent labels such as “MVP boundary.”
- **Task hierarchy / decomposition:** remains a flexible parent-child relation
  on work records. Feature, task, and step are presentation or planning roles,
  not three competing storage systems.
- **Release and current scope:** a release is an optional named scope container
  with work assignments. A project without releases remains valid; its current
  bounded scope is projected without manufacturing a user-visible release.
- **Closure:** is removed as a product domain. Git integration, verification,
  finished work, and release readiness are separate facts that may contribute
  to a release summary. “Closure” is not an intuitive user-facing object.
- **Threads and activity:** are historical evidence and live execution views,
  not the source of current project status.

The rule is simple: one fact, one owner; many projections, one interpretation.

Migration metadata follows the same rule. The migration ledger is historical
evidence about what the runner recorded, not the authority for whether a
physical read-model shape exists. Sessions-owned migration probes reconcile
the ledger against SQLite tables, columns, and derived-row completeness. A
missing ledger entry can be shown as reconciled; it cannot become a current
project blocker when the read model itself is present and valid.

The implementation rule is equally strict: one ordinary read boundary, many
thin presentation adapters. Runtime and UI code may format a sessions-owned
snapshot, but may not open SQLite, parse an intake artifact, expand effective
tasks, or manufacture synthetic work to fill a response. A static data-layer
guard rejects direct `node:sqlite`/`DatabaseSync` use outside the sessions
boundary and migration code. This makes the Release mismatch structurally
unrepresentable in ordinary reads rather than merely unlikely by convention.

### Contract Touch Decision

- Work id: `codex:single-current-state-read-boundary-2026-07-17`.
- Touched contracts: ordinary `/api/project` detail semantics, Release/map
  bounded read projection, delivery read projection ownership, and the
  runtime data-layer guardrail.
- Considered but not touched: explicit diagnostic routes, mutation/import
  writers, and the public shape of historical Thread/evidence endpoints.
- Required follow-up: migrate task-detail joins and remaining ordinary
  Thread/graph reads to revisioned sessions snapshots; add route tests that
  reject canonical reconstruction in ordinary GETs.
- Proof required: focused projection tests, route boundary tests, static
  direct-SQL guard, build/install stale-server proof, and cross-surface
  revision/agreement checks on real projects.
- Apply/revert behavior: code-only read-path changes plus rebuildable derived
  projections; no authoritative task/release/history rows are rewritten.

### Schema Migration Decision

- Persisted schema touched: existing SQLite `delivery_read_projection_*`
  derived tables and the existing compact project-state tables; no new
  authoritative entity schema in this slice.
- Change class: read-boundary consolidation and derived projection ownership.
- Existing data impact: none to task, release, evidence, or history facts;
  delivery rows remain rebuildable from the sessions-owned current state.
- Migration id: `0.13.3/delivery-read-projection` for the existing delivery
  tables; no additional migration for the adapter/guardrail changes.
- Safety: missing or stale derived reads fail closed with `requiresRefresh`;
  pre-promotion compatibility readers remain explicit and legacy-only.
- Compatibility reader: no ordinary runtime fallback from promoted SQLite to
  intake/TASKS/effective-task reconstruction.
- Fixtures/tests: phantom release-membership, bounded page, stale revision,
  detail-without-canonical-expansion, and direct-SQL guard cases.
- Rollback/revert: drop/rebuild derived delivery tables or revert adapters;
  current project facts remain intact.

## Target State Model

The implementation must first inventory the current records before changing
their shape. The target model has these bounded concerns:

### Authoritative current state

Guildhall-owned current project state is moving into the system-local
`project-state.db`. This is one normalized store, not a new product concept:
it is the storage layer for the project state described below. The database
will own the current row for each work item, scope, run, runtime snapshot,
owner-input/action snapshot, and current proof summary. Full narrative and
command history remains append-only detail outside the current-state tables.

`TASKS.json`, runtime JSON, owner-input JSON, and summary JSON are compatibility
artifacts during migration. They remain readable and are regenerated from the
current store where practical; they are not additional authorities. A direct
legacy-file edit is explicitly stale until the migration/rebuild command
imports it. This distinction is what prevents one read from quietly choosing
between several competing versions of “current.”

The initial database slice was schema version 3. The current source schema is
version 22 after additive migrations for compact card summaries, selected scope
rows, queue envelopes, current overlays, queue revisions, evacuation
provenance, per-task detail, and separate intake-plan storage:

- `work_items`: one row per current task's indexed card facts and structural
  relation; full task definitions are not stored in its current-state columns;
- `scopes`: one row per release/milestone/marker assignment envelope;
- `task_execution` and `task_workspace`: current task execution/workspace
  snapshots without inflating task definitions;
- `task_proof`: one latest proof row per task, while full evidence remains
  historical JSONL;
- `current_execution`, `current_runtime`, `owner_inputs`, and `repositories`:
  compact project-level current state;
- `project_summary`: one compact, generation-tagged summary payload;
- `work_item_detail`: one revision-matched compressed rich definition per
  current task, used only by explicit point/detail reads;
- `project_meta`: schema version, project ID, and monotonic project revision.

The first implementation briefly created a second key/value metadata table.
That table owned no fact and duplicated the database metadata, so opening an
older local database removes it. There is now one metadata row, not two
parallel places to ask what revision the project is on.

These rows are updated at the existing queue, runtime, evidence, owner-input,
and summary write boundaries. They do not add another projection beside the
database.

### Compatibility source records

- **Project:** identity, durable description, declared audience/purpose when
  known, repository references, and current scope selection.
- **Repository reference:** repository identity and connection metadata for one
  or more repositories; no assumption that a project is itself one Git repo.
- **Scope/release:** optional named scope with ordering, lifecycle, and assigned
  work IDs. “MVP” is only a name a user or document may provide.
- **Work item:** stable ID, canonical full title, description, parent ID,
  relation metadata, scope assignments, lifecycle state, and next action.
- **Execution run:** run identity, selected scope, mode, task transitions,
  ownership/approval requirements, and terminal state.
- **Evidence record:** durable command, verification, artifact, or external
  result tied to a work item and criterion, with timestamp and provenance.

### Read surfaces over the current store

- **Project summary:** a compact database row containing current scope, counts,
  completion, runnable/blocked/owner-input counts, next action, blockers,
  recent work, and `updatedAt`.
- **Fleet summary:** registered project identity plus the minimum project
  summary needed for the Projects page. It must be independently refreshable.
- **Release summary:** progress and readiness for one selected scope, derived
  from assigned work and current evidence.
- **Orientation/map projection:** the same scope, hierarchy, and provenance
  records arranged for visual navigation.

The Map projection is written as part of the same project-summary transaction.
It contains the navigable scope tree and source/proof labels, but omits the
duplicate full node lookup and task definitions. A compact Map GET may page
task identities from `work_items`; it must not read all task rows and rebuild a
tree just to answer the project-map question.

### Historical records

Thread events, run events, Git history, repair/audit records, and old evidence
remain inspectable history. They may explain a projection but do not silently
become a competing current state. Exploring conversation is the important
exception: its durable record is an **essential-history document**, rewritten
after every exchange by the configured `contextIndexer` model. It retains facts,
decisions, constraints, open questions, and next actions, not the full chat.
Raw transcript text is operational input to that rewrite only. It may exist in
memory while a turn is running, but it is not written as the durable project
record. Existing legacy transcript files are compacted in place by the project
state cleanup command; context-debug and provider traces remain separate,
bounded diagnostics and are never loaded for a normal project or fleet read.

### Storage technology decision

The current-state store is one SQLite file per project, opened through the
runtime's built-in `node:sqlite` `DatabaseSync` API. This is a deliberate
technology choice, not a rename for the existing JSON cache:

| Concern | Decision | Why |
| --- | --- | --- |
| Current project facts | SQLite tables with typed columns and indexes | Transactions, point reads, bounded scans, and one revision boundary are the core problem. JSON files cannot provide those without rebuilding a database in application code. |
| Irregular task/detail payloads | JSON text in the selected detail row | The full task shape is still flexible, but compact reads select only typed columns and never load `definition_json`. This keeps flexibility at the edge instead of making every list read pay for it. |
| Evidence and history | Existing JSONL/event records | Append-only, inspectable history is a good format for audit and export. It is not a good request-time current-state database, so latest proof/current execution rows are indexed in SQLite. |
| Project isolation | One local database per project | A broken or locked project cannot hold the fleet hostage; each project can be backed up, migrated, or rebuilt independently. The machine fleet database is a write-only, rebuildable acceleration artifact and is never a normal current-state read authority. |
| Git and provider state | Last-known repository rows plus operation results | Git, containers, and providers are external systems. A request must not scan them to render a card; their observations are recorded when an operation or inspection completes. |
| Intake conversation | Essential-history Markdown rewritten by `contextIndexer`; bounded local diagnostics only when explicitly requested | A full transcript grows forever, repeats itself, and forces agents and users to perform transcript archaeology. The existing context-indexer lane is the right cheap model boundary. |

Guildhall already depends on `@mastra/libsql` for the optional memory adapter.
That does not make it the right project-state engine: it is an async storage
adapter with a different ownership model, and using it here would couple core
project state to the memory subsystem while still requiring us to define the
same tables and revision rules. A server-backed or remote database would add
network availability, credentials, and another failure boundary to a local
desktop product without solving the modeling problem.

The runtime floor is now Node `22.12.0`, the first supported line for the
read-only `DatabaseSync` connections used here. The installed Node `24.11.1` runtime currently
reports SQLite as experimental, so Guildhall does not hide that warning or
pretend the dependency is settled forever. CI and installed-app smoke tests
must exercise the declared runtime, open a real project database, verify the
rollback journal mode and a transactional write/read, and fail clearly if `node:sqlite` is
missing. If the built-in API remains experimental when Guildhall is ready for
wide distribution, the replacement candidate is a deliberately evaluated
SQLite driver, not a return to JSON reconstruction.

The database uses SQLite's rollback journal (`journal_mode=DELETE`),
`synchronous=FULL`, a five-second busy timeout, and short `BEGIN IMMEDIATE`
transactions. Compact reads open SQLite in read-only mode, so a page load
cannot create directories, change pragmas, run DDL, or accidentally become a
writer. Unlike WAL, this choice does not create `-wal`/`-shm` sidecar files
when a read route opens the database. The workload is a local desktop app with
short writes and no distributed writer; simpler portable files and durable
writes are more valuable than WAL throughput here. Writes and migrations use
the writable connection, and the compact SQL projections explicitly omit the
large definition and payload columns; avoiding a parse is not enough if the
database driver has already copied the bytes into memory.

Write boundaries are batch-shaped. Replacing a task-runtime or workspace store
opens one database transaction and upserts the store's rows as a unit; it does
not open SQLite once per task or advance the project revision once per row.
Single-event proof, run, owner-input, and repository updates remain short
transactions because those operations already have one logical subject. The
filesystem JSON/JSONL write remains a compatibility/history publication step,
so a crash between that publication and the database commit is surfaced as
stale/reconcilable state rather than silently treated as a second authority.

Every derived field must declare its source, generation, and freshness. No read
path may “repair” persisted state as a side effect merely to render a card.

### Current-state/detail storage split

The current-state database must not become a second copy of every task spec.
`work_items` owns the indexed fields needed to answer current-state questions:
identity, title, status, hierarchy, scope membership, dependencies, source
references, and the bounded Work-card summary. The large, irregular task and
release records are stored once in the revision-matched system-local
`project-state/queue-details.json` sidecar. The sidecar is written only after
the SQLite snapshot commits and carries the committed project revision; a
reader uses it for an explicit detail request and falls back to the
compatibility queue only while an installation is crossing the migration.

This is a storage boundary, not another authority: SQLite owns current facts,
the sidecar owns full current detail, and `TASKS.json` remains a compatibility
import/export record until direct queue readers have crossed the same boundary.
New current-state rows write `{}` to the legacy `definition_json` column, and
the `0.12.16/project-state-detail-store` migration vacuums old duplicate
definition payloads. The next queue-reader migration must make `TASKS.json` a
compact export instead of leaving three full representations alive.

### Essential-history retention boundary

The old `append-exploring-transcript` name described an implementation that
appended every message forever. That was the wrong storage contract. The tool
name remains temporarily compatible so existing agents do not need a new
ceremony, but its behavior is now “record this message into essential history.”
The production agent receives a `contextIndexer` callback that rewrites the
prior compact record plus the new message into a bounded document. If that
provider call fails, a deterministic bounded compactor still rewrites the file;
it never falls back to appending raw text.

The cleanup boundary is explicit:

1. On every append, write only the compact essential-history document and an
   idempotency hash for the last accepted message.
2. On `guildhall memory clean-project-state --apply`, rewrite existing legacy
   exploring files through the same boundary and report before/after bytes.
3. Keep raw provider/session/context-debug material out of project-state reads;
   it is diagnostic evidence, not project memory. Session persistence now
   enforces the same boundary at its storage API: completed snapshots are
   bounded before writing, while only a pending tool-result tail can retain
   raw recovery context. `clean-project-state --apply` compacts existing
   completed snapshots in place and reports the preserved pending files.
4. Context-debug snapshots remain a separate short-lived diagnostic lane. They
   retain measurements, health, reasons, and retrieval handles only; prompt and
   formatted-context bodies are never persisted. The local manifest is the
   single diagnostic stream, with at most six records and three snapshots per
   non-terminal task, and a 512 KiB project-wide ledger budget. Cleanup removes
   diagnostics for terminal tasks and deletes the old duplicate persistence-event
   mirror. Context-debug is never loaded by normal project, fleet, map, or
   release reads.

Session snapshots also stop persisting the system prompt on new writes. The
prompt is assembled from the current runtime configuration when a session is
restored; retaining the old prompt in every snapshot duplicated tens of
kilobytes without adding durable project knowledge. The empty field remains
for compatibility with older readers, which still understand legacy snapshots
that contain a prompt.

This is a data-model correction, not just file compression: an exchange has
one durable semantic representation, while raw model traffic is temporary
transport detail.

### Memory boundary: deterministic by default, Mastra opt-in only

The previous memory implementation was worse than an over-eager read: the
ordinary packet path instantiated Mastra/libSQL but then selected candidates
from Guildhall's own deterministic event files. Mastra supplied health and
normalization metadata; it did not perform retrieval or compaction. That made
SQLite database creation pure overhead, and thousands of read/test paths left
behind databases and WAL files.

The default packet path is now deterministic and file-backed. It reads bounded
essential events, produces a bounded candidate packet, and creates no database
for a read. Mastra remains available only when a project or environment
explicitly opts in. Opt-in Mastra work must first prove real retrieval,
compaction, bounded storage, and a close/lifetime contract; merely instantiating
its adapter is not evidence of value. Read/path-resolution functions also must
not allocate local-history directories. Existing diagnostic data is a one-time
migration concern, not a runtime cleanup strategy.

### Anti-band-aid gate

Retention, compaction, and deletion are not fixes for an allocation or data-model
bug. Before adding any cleanup behavior, the implementation must pass this gate:

1. Reproduce the growth from a fresh temporary project and name the exact writer,
   database/table/file, and lifecycle that created it.
2. Make reads and path resolution side-effect free; make allocation happen only
   inside an explicit write or migration boundary, with a regression test.
3. Classify the bytes as current state, essential history, diagnostic evidence,
   or temporary transport. Every class gets one owner, one reader, and one
   lifetime. Raw transport cannot become durable by accident.
4. Measure the normal read path before and after the model change, including
   bytes parsed, files opened, databases created, and elapsed time. A smaller
   cleanup result is not proof of a cheaper model.
5. Only after the boundary is fixed may a one-time, allowlisted migration remove
   old residue. There is no general orphan-pruning feature whose job is to hide
   future leaks.

This gate applies to future storage work even when the immediate symptom is disk
growth, slow startup, or a bloated project card.

### Current-state write guardrail

No auxiliary writer may patch a few convenient fields into `project_summary`
and call it current. A task execution update, runtime update, proof result,
owner-input change, or repository inspection either goes through the shared
projection writer or marks the summary stale while retaining the authoritative
normalized row. A later explicit refresh recomputes all dependent scope,
readiness, action, and Map facts together. This prevents a proof counter or
run-status snippet from silently disagreeing with release readiness or the
project map.

### Architecture decision: current-state database, not a sidecar projection

The previous approach called `project-summary.json` a “projection” but left
`TASKS.json`, runtime stores, evidence ledgers, owner-input records, and Git
inspection as competing sources. That was the data house of cards. The new
boundary is:

1. A typed mutation opens `project-state.db`, acquires the project write lock,
   validates the candidate current state, updates affected normalized rows,
   computes the shared summary from that same candidate, and increments one
   project generation.
2. The transaction commits the current state once. Reads can therefore answer
   fleet, project, scope, work-row, and selected-task questions without
   reparsing every source file.
3. Compatibility JSON is published after the commit and can be rebuilt. A
   failure there is an explicit compatibility warning, not a reason to roll
   back already-committed current state.
4. Git, pushes, pull requests, worktrees, containers, and provider calls are
   external operations. They are represented as intent/result records and
   reconciled as sagas; they are not falsely included in a filesystem
   transaction they cannot participate in.

This is why the change is larger than pagination or an in-process cache. It
changes who owns current state, when it is computed, and what a read is
allowed to do. The database is the one current-state model; spine, map,
release, work, activity, and closure-free Git/history surfaces are queries or
presentations over it.

## Implementation Sequence

## Contract And Schema Decisions For The First Slice

**Contract Touch Decision — `codex:project-summary-projection-2026-07-14`**

- **Touched contracts:** the internal project-state read model and the
  server-side summary assembly that will consume it.
- **Considered but not touched:** public task schema, release schema, run
  protocol, owner-approval semantics, and the browser route contract.
- **Required follow-up:** move all summary consumers to the shared projection
  only after the write coverage inventory identifies their update boundaries.
- **Proof required:** projection unit tests, legacy-queue compatibility tests,
  API response agreement tests, and installed-app timing proof.
- **Apply/revert:** the first file is additive; consumers can fall back to the
  existing response while the projection is backfilled. Remove the file and
  its writer hook together if the schema is rejected.

**Schema Migration Decision — `0.11.0/project-summary-projection`**

- **Persisted schema touched:** version 2 of the system-local
  `project-state/project-summary.json`, next to the authoritative task queue.
- **Scope:** one compact, rebuildable read model per registered project.
- **Change class:** additive projection; no task-history rewrite and no
  user-visible release creation.
- **Existing data impact:** no existing records are deleted or rewritten. A
  missing or invalid projection is reported as unavailable/stale until an
  explicit rebuild path runs.
- **Migration:** `0.11.0/project-summary-projection` backfills from the
  normalized task queue and is idempotent. The projection records the source
  queue mtime so an out-of-band queue writer makes it explicitly stale.
- **Compatibility reader:** accepts legacy v1 files as stale and never treats
  them as current. Missing, stale, or malformed projections are reported as
  unavailable until this migration or an explicit rebuild runs.
- **Known boundary:** this projection owns task/scope facts and now carries
  compact execution/runtime snapshots. Evidence, task-runtime, owner-input,
  and repository writes are still being traced; unsupported changes mark the
  projection stale rather than pretending the queue-only facts are complete.
- **Rollback:** delete only the projection file and disable its reader; task
  queue, runtime, evidence, and history remain untouched.

**Schema Migration Decision — `0.12.0/project-state-database`**

- **Persisted schema touched:** schema version 3 of the system-local SQLite database
  `project-state.db` with normalized current-state tables for work, scopes,
  task execution/workspace, latest proof, project execution/runtime,
  owner-input, repositories, metadata, and the compact summary.
- **Authority:** this is the canonical current-state store for Guildhall-owned
  project facts. Existing `TASKS.json` and `project-summary.json` remain
  compatibility artifacts until their writers and readers are fully migrated.
- **Change class:** additive current-state storage with deterministic backfill;
  no task, release, evidence, thread, or Git history is deleted.
- **Existing data impact:** backfill reads the normalized queue and current
  summary, stores canonical task definitions in the work-item detail column,
  and creates indexed compact columns for inventory and relation reads. The
  compact SQL projections omit the definition column entirely; task detail
  selects it for one task. Runtime, workspace, and latest proof rows are
  populated at their existing write boundaries; historical ledgers are not
  loaded by fleet reads.
- **Migration:** `0.12.0/project-state-database` is idempotent for the initial
  database backfill. The follow-up
  `0.12.1/project-state-database-rollback-journal` upgrades already-created
  version 2 files from WAL to the rollback journal. The initial migration
  records source queue and workspace-goals freshness markers and drops the
  transient `state_meta` table from the first local implementation because it
  duplicated `project_meta` and owned no current fact.
- **Compatibility reader:** current summary readers prefer the database and
  return its explicit stale state; legacy JSON is used only when no database
  exists. A compatibility file edited outside the commit boundary is not
  silently treated as newer current state.
- **Proof provided/required:** atomic row and revision tests are provided;
  crash/concurrency tests, dual-read parity fixtures for NH, Looma + Knit,
  Jess, and Fair Labor License, migration idempotence, restart proof, and
  route-level evidence that summary reads do not parse evidence/history remain
  required before this migration is called complete.
- **Rollback:** remove or ignore `project-state.db` and rebuild the existing
  compatibility projection from legacy records. No task, release, or history
  rollback is required.

**Schema Migration Decision — `0.12.1/project-state-database-rollback-journal`**

- **Persisted schema touched:** SQLite journal mode and
  `project_meta.schema_version` in the existing system-local database.
- **Change class:** storage-engine migration only; no task, scope, evidence,
  thread, or Git record is rewritten.
- **Existing data impact:** SQLite converts the existing WAL-backed file to
  `journal_mode=DELETE`; read-only routes no longer create `-wal` or `-shm`
  sidecars. Current rows and the project revision are preserved by the
  rebuild.
- **Migration:** automatic, idempotent, and required only when a database has
  a schema version below 3.
- **Proof required:** old-WAL fixture, no-sidecar read-boundary test,
  installed four-project migration, journal-mode query, and restart parity.
- **Rollback:** rebuild from `TASKS.json` and the compatibility summary with
  the prior database implementation; source task/history records remain
  unchanged.

**Contract Touch Decision — `codex:project-summary-orientation-snapshot-2026-07-14`**

- **Touched contracts:** the durable project-summary read model, compact
  Overview/Work/Map orientation reads, and the explicit project-brief write
  boundary.
- **Considered but not touched:** task/release schemas, repository document
  contents, raw document history, full detail spine semantics, and user-owned
  briefing/approval requirements.
- **Required follow-up:** provide a visible orientation-refresh action wherever
  a project has document sources but no snapshot, then prove the four-project
  matrix reports source freshness consistently.
- **Proof provided:** compact-map regression changes a README after the
  snapshot and verifies the stored charter/source trail remains the response;
  stale legacy queue regression verifies compact spine continues to describe
  the last indexed release instead of recomputing it from the file.
- **Apply/revert:** remove the summary orientation field and its compact
  consumers together. Task/release records and source documents are untouched.

**Schema Migration Decision — `0.12.2/project-summary-orientation-snapshot`**

- **Persisted schema touched:** version 4 of the system-local
  `project-state/project-summary.json` compatibility export and its canonical
  `project_summary.payload_json` database row.
- **Change class:** additive, rebuildable orientation snapshot: charter,
  source-ref list, and refresh timestamp only.
- **Existing data impact:** no project document, task, release, or history is
  rewritten. The automatic migration reads the known brief/README candidates
  once, writes the snapshot, and records missing charter material honestly.
- **Compatibility reader:** version 1-3 projections are stale, never silently
  re-inferred during a product GET; the compact response keeps the last indexed
  scope/release facts while marking freshness stale.
- **Safety/rollback:** automatic and idempotent. Delete/rebuild only the
  summary projection if reverted; source documents and canonical task records
  remain intact.

**Schema Migration Decision — `0.12.4/project-summary-orientation-source-dedupe`**

- **Persisted schema touched:** existing version-4 orientation snapshot only.
- **Change class:** idempotent rebuild of a derived source-ref list; no source,
  task, release, or history record changes.
- **Existing data impact:** case-only aliases such as `README.md` and
  `readme.md` are collapsed to the first canonical physical document during
  the explicit refresh, so source counts and provenance cannot be inflated on
  case-insensitive filesystems.
- **Safety/rollback:** automatic and rebuildable from the same source set.

**Contract Touch Decision — `codex:project-summary-map-read-model-2026-07-14`**

- **Touched contracts:** version-5 project summary, compact Map response, and
  auxiliary current-state writer freshness semantics.
- **Considered but not touched:** task/release/evidence schemas, route names,
  the rich detail spine, and historical event storage.
- **Required follow-up:** move Work and Overview's remaining scope assembly to
  the same stored read model, then make every auxiliary mutation invoke one
  shared projection refresh rather than merely marking stale.
- **Proof provided:** focused read-boundary test confirms a compact Map uses a
  saved document snapshot; compact Map now selects the stored tree and a
  paged SQL inventory without calling the orientation builder. Database tests
  prove proof/runtime/execution writes retain their normalized row but cannot
  publish a partial summary as current.
- **Apply/revert:** remove the `orientationSpine` summary field and the Map
  fast path together. Rebuilding the summary restores the prior read contract;
  task, release, proof, and history records are unaffected.

**Schema Migration Decision — `0.12.5/project-summary-map-read-model`**

- **Persisted schema touched:** version 5 of the rebuildable
  `project_summary.payload_json` and its JSON compatibility export.
- **Change class:** additive compact orientation tree. It stores Map-needed
  hierarchy/provenance/progress facts while omitting raw task definitions and
  the duplicate full node lookup table.
- **Existing data impact:** the automatic migration rebuilds only the summary
  from the current indexed queue and prior orientation snapshot. It does not
  mutate tasks, releases, proofs, or history.
- **Required-before-run:** no. Missing/version-old state is stale and can be
  backfilled explicitly; it must not be recreated during a GET.
- **Safety/rollback:** automatic, idempotent, and reversible by rebuilding the
  summary. The compatibility reader treats prior versions as stale rather than
  silently manufacturing a current tree.

**Schema Migration Decision — `0.12.6/project-summary-map-source-budget`**

- **Persisted schema touched:** version 6 of the same rebuildable summary.
- **Change class:** payload-budget correction. Per-node source/task references
  are bounded to the links the Map can actually display; source provenance is
  still retained in the project-level source trail and detail records.
- **Existing data impact:** summary-only rebuild. No task, release, proof, or
  history record is rewritten.
- **Safety/rollback:** automatic and idempotent. Rebuild from the current
  normalized rows restores either representation without data loss.

**Schema Migration Decision — `0.12.7/project-summary-map-scope-budget`**

- **Persisted schema touched:** version 7 of the rebuildable summary.
- **Change class:** Map read-model budget. The stored Map contains a bounded
  current/later ledger plus durable total counts; Work remains the paged full
  ledger.
- **Existing data impact:** summary-only rebuild, with no task, release, proof,
  or history rewrite.
- **Safety/rollback:** automatic and idempotent. The view never infers total
  scope from the truncated rows, so a compact map cannot pretend it has shown
  the complete ledger.

**Contract Touch Decision — `codex:project-work-scope-read-model-2026-07-14`**

- **Touched contracts:** version-8 project summary, version-4 local
  `project-state.db`, and compact Overview, Work, and Map responses.
- **Considered but not touched:** canonical task/release/evidence records,
  history retention, route names, and the rich detail/Release read path.
- **Change:** selected-scope membership moves into normalized `work_scope`
  rows written atomically with `work_items` and the summary. Summary JSON
  keeps only the small shared orientation/map projection; it is not a second
  task ledger.
- **Required proof:** a current compact surface may read the saved summary,
  one bounded task page, or an explicit small task-id set. It may not reopen
  the full queue or rebuild scope/orientation. Stale state remains visibly
  stale; no partial write or GET may manufacture a current projection.
- **Proof provided:** database tests prove indexed inventory carries scope
  annotation without task definitions. GET boundary tests mutate README after
  the authoritative write and prove Overview, Work, and Map retain saved
  orientation; Work pagination proves one returned row while the durable scope
  total remains three.
- **Apply/revert:** `0.12.8` rebuilds only derived summary/database rows.
  Reverting removes the compact-route fast path and rebuilds the prior
  projection; task, release, proof, and history records remain unchanged.

**Schema Migration Decision — `0.12.8/project-work-scope-read-model`**

- **Persisted schema touched:** `project-state.db` version 4 adds
  `work_scope`; project-summary version 8 records this read-model generation.
- **Change class:** additive, rebuildable derived index. `work_scope` stores
  membership, handoff/block flags, and bounded source refs by task id. It owns
  no task or release fact.
- **Existing data impact:** the automatic migration rewrites only the
  normalized snapshot from the authoritative queue and orientation snapshot.
  No canonical task, release, proof, source document, or history row changes.
- **Required-before-run:** no. Older/missing state is honest stale state and
  takes the compatibility reader until an authorized backfill runs; a GET does
  not create or repair the table.
- **Safety/rollback:** automatic and idempotent. The table is replaced inside
  the same transaction as the queue snapshot, so summary, task rows, and scope
  membership cannot describe different revisions.

**Schema Migration Decision — `0.12.9/project-map-payload-budget`**

- **Persisted schema touched:** project-summary version 9 only.
- **Change class:** payload-budget correction. Map nodes retain identity,
  hierarchy, maturity/progress, and bounded provenance; repeated node prose,
  per-node proof detail, and unbounded source lists are not initial-map data.
- **Existing data impact:** summary-only rebuild. Full task descriptions and
  proof evidence remain in normalized task/detail records.
- **Safety/rollback:** automatic and idempotent. Rebuild from the same
  normalized snapshot restores the projection without rewriting task, release,
  proof, source, or history records.

**Schema Migration Decision — `0.12.10/project-map-navigator-node-budget`**

- **Persisted schema touched:** project-summary version 10 only.
- **Change class:** stricter navigator boundary. A Map node stores only the
  nested hierarchy, identity/title, visible maturity/progress, visibility kind,
  and one explicit task link. It does not duplicate source metadata, prose,
  proof details, parent links already represented by nesting, empty arrays, or
  zero counters.
- **Existing data impact:** summary-only rebuild. Source trail and proof
  contracts remain top-level Map facts; full task detail remains in the
  normalized task row and explicit detail route.
- **Safety/rollback:** automatic and idempotent. A v9 summary is intentionally
  stale until rebuilt, so a heavy node graph cannot be served as the current
  navigator.

**Schema Migration Decision — `0.12.11/project-live-state-consolidation`**

- **Persisted schema touched:** `project-state.db` version 5 adds typed rows
  for project availability, attention records, and reconciliation markers.
- **Change class:** consolidation of live, mutable project facts that were
  incorrectly stored as runtime-owned JSON side files.
- **Existing data impact:** legacy files remain compatibility input only. The
  next explicit pause/resume, attention mutation, or migration backfill writes
  the normalized row; a normal GET neither creates a database nor imports or
  deletes a legacy file.
- **Required-before-run:** no. A project with only a legacy file is read
  honestly through the data-layer compatibility reader until an explicit
  writer/migration crosses it to SQLite.
- **Safety/rollback:** additive and reversible. The old files are retained
  until an allowlisted cleanup migration has proven every registered project
  has a normalized replacement. No summary is marked current or stale merely
  because one of these independently-read live facts changes.

**Schema Migration Decision — `0.12.12/work-item-list-projection`**

- **Persisted schema touched:** `project-state.db` version 6 adds
  `work_items.summary_json`, a bounded Work/Overview card projection.
- **Change class:** replaces compact-route dependence on the full task
  definition or `TASKS.json` with a single explicit row shape. The full
  definition remains detail-only.
- **Existing data impact:** additive. The automatic migration rebuilds the
  normalized snapshot from the authoritative queue once; it does not rewrite
  task meaning, releases, proof, source records, or history.
- **Required-before-run:** no. An old database reads as a thin identity row
  until the explicit migration or next authoritative queue write populates the
  list projection; GET still never rebuilds it.
- **Safety/rollback:** schema is additive and the row summary is wholly
  derived. Rebuilding the snapshot recreates it; no cleanup is involved.

**Schema Migration Decision — `0.12.13/database-queue-envelope`**

- **Persisted schema touched:** `project-state.db` version 7 adds the singleton
  `queue_state` row (`version`, `last_updated`, `selected_release_id`). Task and
  release definitions already live in normalized rows; this supplies the
  metadata needed to read them as one full queue.
- **Change class:** additive detail-read boundary. It does not yet transfer
  mutation authority away from `TASKS.json`; that requires the queue writer and
  every normal writer to cross in the next phase.
- **Existing data impact:** automatic rebuild copies queue metadata and existing
  task/release definitions into SQLite. The compatibility file remains intact.
- **Required-before-run:** no. A pre-v7 database returns no database queue
  definition; the compatibility reader remains explicit until the migration or
  a normal snapshot write seeds it.
- **Safety/rollback:** entirely derived and rebuildable. No history or
  compatibility record is removed.

**Contract Touch Decision — `codex:task-detail-diagnostics-boundary-2026-07-14`**

- **Touched contracts:** `GET /api/project/task/:id` and the Task Drawer now
  treat task Thread turns, context-debug, raw exploring transcripts, and task
  event history as optional detail. `GET /api/project/task/:id/extras?include=...`
  is the explicit opt-in reader for those payloads.
- **Considered but not touched:** the transcript file format, essential-history
  compaction, task/release schemas, queue mutation authority, and diagnostic
  retention policy. This does not claim raw transcript storage has been
  eliminated; it prevents it from silently becoming normal navigation data.
- **Required follow-up:** replace the on-demand thread builder with a stored
  per-task activity projection, set and test an initial task-detail byte
  budget, then transfer diagnostic retention to its own bounded writer
  lifecycle.
- **Proof required:** a large transcript and task Thread must not appear in
  ordinary task detail, the Action/Transcript/Origin tabs must request only
  their selected detail, and stale/current queue compatibility behavior must
  remain explicit.
- **Apply/revert:** the old diagnostics remain readable through the opt-in
  route. Reverting the UI changes only restores the former payload shape; it
  does not rewrite, prune, or discard diagnostic records.

### Storage Admission Gate

This is a hard engineering gate for every future state-growth, cleanup, cache,
projection, transcript, or retention change. It exists specifically to prevent
"add a prune" from becoming an answer to an unowned writer.

1. **Name the fact and its owner.** A fact is written once by its authoritative
   boundary: queue/release records own planned work, SQLite owns normalized
   current task and scope rows, the project-summary projection owns small
   cross-surface state, and a bounded Map navigator owns only its nested
   orientation graph. A new record is rejected if it merely mirrors an owner
   that already exists.
2. **Name the read job and byte budget.** Every persisted projection must say
   which route consumes it, what it intentionally omits, its cardinality cap,
   and a measured response-size target. A field cannot enter an initial route
   because another screen might someday use it.
3. **Prove the lifecycle from an empty project.** Trace allocation, append,
   update, invalidation, refresh, and deletion. Read/path helpers are pure;
   only explicit writer commands allocate durable state. Tests must prove the
   normal read path creates neither directories, databases, sidecars, nor
   transcripts.
4. **Make inconsistency visible, never self-healing.** A source revision,
   summary revision, or projection version mismatch is `stale`; GET routes do
   not rebuild, repair, migrate, or delete. The one authoritative write or
   explicit migration refreshes every affected derived record together.
5. **Cleanup is last and one-time.** Only after the writer/read fix and a
   before/after measurement may an explicit, allowlisted migration remove old
   residue. It must report exactly what it would remove, preserve recovery
   evidence, and be removable itself. No periodic orphan prune, broad
   "retention" job, or startup cleanup is accepted as a correctness fix.

6. **Feature code may not own a project-state file.** A live project fact does
   not become legitimate merely because it is small. Availability, attention,
   acknowledgements, diagnostics, and similar state must have a typed row in
   the current-state store or be an explicitly bounded historical record. A
   feature module may ask the storage boundary for that fact; it may not join a
   local-history path, read a JSON file, create its parent directory, or add a
   private side-store. Compatibility readers are read-only and are removed by
   an explicit migration once every active project has crossed the new writer.

7. **A new guardrail must fail on the old behavior.** Before calling a storage
   problem fixed, add a deterministic fresh-project test that would have caught
   the original allocation or request-time reconstruction. Static checks also
   reject direct managed-path I/O in feature code. An allowlist is a temporary
   migration record with an owner and expiry, never a permanent escape hatch.

The required review questions are deliberately blunt: *What created these
bytes? Why did the normal read need them? Which single owner should answer the
user's question? What happens when the owner changes?* If those answers are
not concrete, the change stays in investigation rather than shipping another
storage feature.

**Contract Touch Decision — `codex:essential-history-retention-2026-07-14`**

- **Touched contracts:** the local exploring-history file format and the
  persistence semantics of `append-exploring-transcript`; the compatible tool
  name remains unchanged so existing agents do not take on a new action.
- **Considered but not touched:** task JSON, release JSON, project-state SQLite
  schema, public routes, evidence JSONL, and the user-facing task hierarchy.
- **Required follow-up:** cap and prune context-debug, provider traces, and
  full session snapshots as explicit diagnostics rather than project memory.
- **Proof provided:** the context-indexer request, bounded fallback,
  idempotency marker, and no-raw-scaffolding behavior have focused tests.
- **Apply/revert:** compact history can be rebuilt from current intake/task
  records; legacy readers remain available while cleanup is applied.

**Contract Touch Decision — `codex:session-and-memory-retention-2026-07-14`**

- **Touched contracts:** session snapshot persistence, completed-session
  compaction, pending tool-result recovery, the default memory substrate, and
  the local-history read/write allocation boundary.
- **Considered but not touched:** task/release schema, current project-state
  tables, public routes, and semantic memory content shape.
- **Required follow-up:** compact old context-debug/provider traces and inspect
  existing Mastra databases as migration data; do not add a general-purpose
  pruning feature to compensate for future allocation leaks.
- **Proof provided:** storage-boundary tests, old-snapshot cleanup tests,
  pending-tail preservation tests, and read-only Mastra thread-count proof.
- **Apply/revert:** completed snapshots are rewritten in place and can be
  rebuilt from task/intake state; pending snapshots are preserved. Existing
  opt-in Mastra records remain untouched. The default-substrate and path
  allocation changes are code-only and can be reverted without changing
  project records.

**Schema Migration Decision — `codex:session-and-memory-retention-2026-07-14`**

- **Persisted schema touched:** session JSON payloads and the default behavior
  of the system-local memory store; no project-state database tables.
- **Change class:** retention-boundary migration, deterministic-default
  substrate selection, and read-path allocation removal.
- **Existing data impact:** completed session messages may be compacted to one
  essential-history message; pending tool-result tails are retained. Existing
  Mastra databases are diagnostic/experimental data and are not loaded by the
  default packet path.
- **Migration id:** `0.12.3/session-essential-history-and-deterministic-memory-default`.
- **Compatibility reader:** old session payloads remain readable; the storage
  writer normalizes new and rewritten snapshots to the bounded shape.
- **Rollback:** restore old session files if needed; restoring Mastra as the
  default would be an explicit architectural decision requiring fresh
  retrieval/compaction proof.

**Schema Migration Decision — `codex:essential-history-retention-2026-07-14`**

- **Persisted schema touched:** user-local exploring Markdown only; the current
  SQLite project-state schema is unchanged.
- **Change class:** in-place format compaction, with no deletion of task,
  release, proof, or current-state rows.
- **Existing data impact:** new appends rewrite the durable file to essential
  history; `guildhall memory clean-project-state --apply` rewrites legacy raw
  exploring files and reports before/after bytes.
- **Compatibility reader:** canonical essential-history files are preferred;
  legacy full transcript files remain readable until the cleanup pass.
- **Rollback:** restore the local-history copy or legacy source file; no
  project-state database rollback is required.

**Contract Touch Decision — `codex:context-debug-retention-2026-07-14`**

- **Touched contracts:** context-debug record persistence, diagnostic snapshot
  contents, per-task retention, and the removal of the duplicate persistence
  event stream.
- **Considered but not touched:** task/release/project-state SQLite tables,
  project summary routes, task definitions, essential-history documents, and
  message-bearing memory records.
- **Required follow-up:** keep context-debug out of summary/read-model
  builders and preserve a bounded active-task diagnostic window in future
  runtime tests.
- **Proof provided:** context-debug tests prove prompt/context omission; the
  installed Narrative Harness cleanup reduced the local context-debug directory
  from about 32 MB plus a 15.5 MB duplicate mirror to no completed-task
  diagnostics, with no duplicate event files remaining.
- **Apply/revert:** the cleanup is explicit and task-state-aware; diagnostic
  files can be regenerated by a future active run, while current task/state
  records are untouched.

**Schema Migration Decision — `0.12.3/context-debug-retention-boundary`**

- **Persisted schema touched:** local context-debug JSONL records and Markdown
  snapshots; the old local persistence event mirror is retired.
- **Change class:** retention and payload-boundary migration; no current-state
  database table or task schema change.
- **Existing data impact:** prompt previews, formatted prompts, formatted
  context, repeated memory identifiers, and terminal-task diagnostics are
  removed. Recent non-terminal diagnostics retain counts and metadata only.
- **Compatibility reader:** old records remain parseable by the reader, while
  cleanup rewrites them to the compact record shape before normal use.
- **Rollback:** regenerate diagnostics from a new active run; no project-state
  or task data is deleted by this migration.

**Contract Touch Decision — `codex:project-summary-runtime-snapshots-2026-07-14`**

- **Touched contracts:** optional `execution` and `runtime` fields in the
  existing project summary projection, plus the existing runtime store and
  supervisor lifecycle write boundaries.
- **Considered but not touched:** task schema, evidence schema, release
  membership, owner-approval semantics, repository schema, and route names.
- **Required follow-up:** add compact proof, owner-input, and repository
  snapshots before treating the projection as a complete current-state read.
- **Proof provided:** projection preservation/update tests, runtime-store test,
  supervisor tests, build, and contract detector.
- **Apply/revert:** removing the optional fields and hooks leaves authoritative
  runtime/run records intact but restores stale summary behavior.

**Schema Migration Decision — `0.11.2/project-summary-projection-setup-state`**

- **Persisted schema touched:** the existing system-local
  `project-state/project-summary.json` projection only.
- **Scope:** refresh the derived next-action fields for projects whose only
  current task is still project intake or workspace import.
- **Change class:** idempotent projection refresh; no task, release, source,
  or history records are created, deleted, or rewritten.
- **Existing data impact:** seven registered projections were refreshed. Sparse
  projects now report `workspace_import_pending` or
  `project_intake_pending` instead of falsely reporting `all_terminal`.
- **Compatibility reader:** version 2 readers already accept the fields; the
  migration only rebuilds the projection from the normalized queue.
- **Tests/fixtures:** migration idempotence and setup-state projection tests,
  plus the four-project installed proof matrix.
- **Rollback:** delete or ignore the derived projection and rebuild it from the
  queue; authoritative project state is unchanged.

**Contract Touch Decision — `codex:project-summary-approved-plan-2026-07-14`**

- **Touched contracts:** the compact project-summary read model, its server
  summary payload, and the workspace-import approval write boundary.
- **Considered but not touched:** task records, release records, the importer
  document format, effective-task expansion, and full release readiness.
- **Required follow-up:** make compact spine and Release detail consume the
  same approved-plan scope identity before adding further scope labels.
- **Proof provided:** projection parsing, out-of-band freshness, migration
  idempotence, focused runtime tests, and the installed four-project proof
  matrix after refresh.
- **Apply/revert:** remove the projection field and refresh hook together;
  the durable workspace-goals snapshot and task queue remain intact.

**Schema Migration Decision — `0.11.3/project-summary-approved-plan`**

- **Persisted schema touched:** version 3 of the rebuildable system-local
  `project-state/project-summary.json` projection only.
- **Meaning:** `approvedPlan` is a compact, source-backed summary of the
  approved workspace intake: goals, milestones, current/later task IDs, and
  release membership. It is planning truth, not a user-visible release and
  not proof that the corresponding work is executable.
- **Existing data impact:** no authoritative task, release, or history records
  are rewritten. Projects without `workspace-goals.json` carry
  `approvedPlan: null`.
- **Freshness:** the projection records both task-queue mtime and
  `workspace-goals.json` mtime. An out-of-band change marks it stale until the
  explicit rebuild path runs.
- **Write boundary:** workspace-import approval writes the queue and approved
  plan, then refreshes the projection once after both durable writes complete.
- **Compatibility reader:** versions 1 and 2 are accepted only as stale; a
  version 3 projection is current only when both source mtimes match.
- **Rollback:** delete or ignore only `project-summary.json`; the source plan,
  task queue, releases, and history remain untouched.

**Schema Migration Decision — `0.11.4/project-summary-approved-scope-selection`**

- **Persisted schema touched:** the existing version 3 rebuildable
  `project-state/project-summary.json` projection only; no new authoritative
  field is introduced.
- **Meaning:** when approved intake assigns work to a named release, the
  projection may expose that release as the current read-model scope. This
  closes the gap between approved planning and the fast release summary; it
  does not promote detector candidates or create a release in `TASKS.json`.
- **Existing data impact:** all registered projections may be rebuilt, but
  canonical task, release, evidence, and history records remain unchanged.
- **Compatibility reader:** version 3 continues to expose `approvedPlan`;
  0.11.4 refreshes the derived `releaseSummary` envelope so compact fleet,
  project, spine, explicit spine detail, and Release readiness views can
  agree.
- **Proof:** migration coverage asserts selected-scope derivation and queue
  preservation; the installed matrix shows named-release selection for NH and
  Looma + Knit and honest `unreleased` state for Jess and Fair Labor License.
- **Rollback:** delete or ignore the rebuildable projection and regenerate it
  from the queue plus approved plan; no authoritative record needs restoring.

**Contract Touch Decision — `codex:project-shell-projection-surfaces-2026-07-14`**

- **Touched contracts:** the compact `/api/project` response, the optional
  `ProjectReleaseReadiness.completeness` / `checksLoaded` response metadata,
  and the project store's default hydration URL.
- **Considered but not touched:** authoritative task/release schemas, Thread
  turn storage, full release-readiness semantics, and the rich diagnostic
  response.
- **Required follow-up:** page or separately request the Work and Map
  inventories; migrate Releases, activity history, and task detail to bounded
  detail endpoints; add rendered API agreement checks.
- **Proof required:** compact endpoint contract tests, selected-scope filtering
  tests, installed timing/size proof, and viewport checks for Overview, Work,
  Map, and Thread.
- **Apply/revert:** removing `compact=true` from the project store restores the
  old rich hydration path without changing authoritative project records.

**Schema Migration Decision — `codex:project-shell-projection-surfaces-2026-07-14`**

- **Persisted schema touched:** none. `lastUpdated` is now retained by the
  normalized queue reader as an existing source marker; no new authoritative
  field is written.
- **Response change:** additive only. `completeness: scope` and
  `checksLoaded: false` make clear that fast project reads report task/scope
  completion, not repository/design-system/Git Story release verdicts.
- **Existing data impact:** none. Overview filters its response to selected
  scope and action-relevant tasks; Work and Map still return their current
  inventories until pagination is implemented.
- **Compatibility reader:** the rich response remains available, and legacy
  queue shapes continue through the normalized reader.
- **Rollback:** remove the compact route/store selection; no task, release, or
  historical record rollback is required.

**Schema Migration Decision — `codex:project-summary-scope-and-activity-2026-07-14`**

- **Persisted schema touched:** additive fields in version 2 of
  `project-state/project-summary.json`: `releaseSummary`, `counts.byStatus`,
  and bounded `inFlight` rows.
- **Meaning:** `releaseSummary.scopeMode` is `named_release` only when an
  authoritative release record is present; otherwise it is `unreleased`.
  `release` is `null` in that case. Guildhall does not manufacture a
  user-facing “current work” or “MVP” release.
- **Existing data impact:** no task, release, or history records are changed.
  Older projections are marked stale until the explicit
  `0.11.1/project-summary-projection-v2` backfill rebuilds the additive fields.
- **Compatibility reader:** stale or legacy projections fall back to the
  bounded compatibility path; they are never presented as current. Activity
  uses `byStatus` and `inFlight` only when those fields are current.
- **Proof required:** no-release and named-release projection fixtures,
  missing-proof progress fixtures, Activity polling tests, and cross-surface
  agreement tests.
- **Rollback:** delete the additive fields and ignore the projection version
  extension; authoritative queue and event records remain intact.

**Schema Migration Decision — `0.11.1/project-summary-projection-v2`**

- **Persisted schema touched:** only the rebuildable
  `project-state/project-summary.json` projection.
- **Change class:** idempotent read-model refresh after the projection gained
  release, proof, status-count, and in-flight fields.
- **Existing data impact:** the seven registered local projects were refreshed;
  task queues, releases, documents, evidence, and history were unchanged.
- **Compatibility reader:** missing, stale, or malformed projections remain
  explicitly unavailable; no GET route silently repairs them.
- **Proof:** migration idempotence test, focused runtime tests, installed
  `stale:false` check, and seven-project fleet parity with current summaries.
- **Rollback:** delete only the projection file and rebuild it from the
  authoritative queue using the prior projection reader.

**Schema Migration Decision — `0.11.0/project-summary-runtime-snapshots`**

- **Persisted schema touched:** additive optional `execution` and `runtime`
  fields in version 2 of `project-state/project-summary.json`.
- **Change class:** compatible projection extension; no authoritative record or
  task-history rewrite.
- **Existing data impact:** old projections remain readable with those fields
  absent. The next queue write preserves any available snapshots.
- **Migration:** no new backfill is required; runtime/run write boundaries
  populate the fields opportunistically. The existing projection migration
  remains the deterministic task/scope backfill.
- **Rollback:** ignore or remove the optional fields; task/runtime/run history
  remains unchanged.

### 1. Inventory before redesign

Produce a code-backed inventory of:

- every persisted project, task, scope/release, run, evidence, repository,
  thread, and Git record;
- every field that is authoritative versus computed;
- every request-time repair, scan, LLM/provider call, effective-task expansion,
  and history reconstruction;
- every duplicate calculation of status, progress, blockers, readiness, next
  action, or owner input.

The inventory must include call sites and measured cost, not only type names.
It becomes the basis for the schema and contract decisions required by
`AGENTS.md`.

### 2. Establish one current-state storage boundary

Reuse the existing project-state serializers and event ledgers for compatibility
and history, but stop using them as a request-time database. The first
acceptable current-state store is the existing Node 22 `node:sqlite`-backed
`project-state.db`, not a general cache or an event-sourcing framework. It must
have:

- schema version and project ID;
- one monotonic project generation and source revision;
- `updatedAt` and projection status;
- normalized work and scope rows with indexed lookup;
- deterministic rebuild capability from compatibility records;
- one transactional current-state write boundary;
- compatibility read/write behavior during migration;
- explicit stale/error status instead of an indefinite loading state.

### 3. Make writes commit current state

Centralize current-state commits at the existing write boundaries for project,
scope/release, work-item, run, evidence, and repository-operation changes. A
task transition, proof result, release assignment, or run start/stop must update
the affected normalized rows and summary in the same project transaction.

The update may be synchronous for small local writes or queued for larger
rebuilds, but the current-state store must expose generation, current,
rebuilding, or stale. Rebuilds are idempotent and never overwrite newer
authoritative data. Legacy JSON/JSONL publication is a compatibility step,
not a second commit.

### 4. Make reads boring

Fleet summary reads must use registered projects and their summary projections.
They must not perform:

- LLM/provider calls;
- Git scans or repository story generation;
- inbox repair or task mutation;
- full thread reconstruction;
- per-task effective-state expansion;
- broad history loading for a compact card.

Project detail loads the selected project's summary first, then requests work,
map, releases, activity, evidence, and task detail independently as needed.
One slow or malformed project must not prevent other projects from rendering.

### 5. Unify surfaces

API, Projects, Overview, Map, Work, Releases, Activity, and task detail must
consume the same shared summary/action model. A surface may choose different
layout and density, but it may not locally reinterpret readiness, blockers,
owner input, release progress, or “what next.”

The first parity slice now covers `/api/service`, `/api/service/projects`, and
`/api/project/activity`. The remaining project surfaces are still migration
work, not evidence that the architecture is finished.

The full canonical titles remain in data. Visual truncation is a presentation
concern only, never persistence or navigation.

### 6. Migrate without losing history

Add a compatibility reader for existing state, an explicit migration ID, and a
deterministic backfill for project and release summaries. Preserve task IDs,
titles, parent relations, scope assignments, run history, evidence, and thread
history. Do not repair historical records in place merely because a projection
now represents them more accurately.

Record the required `Schema Migration Decision` and `Contract Touch Decision`
before persisting the new shape. Include fixtures for fresh, legacy, partially
migrated, stale, running, blocked, deferred, and release-scoped projects.

## Product and Performance Acceptance

The pivot succeeds only when these are true in the real app, not merely in unit
tests:

- The fleet shell renders from registered projects immediately.
- Fleet summaries are independently loadable; one project cannot block another.
- The default `/api/service` request does not enter the full per-project
  reconstruction loop; callers needing that payload must opt into
  `/api/service?detail=true`.
- No summary read invokes an LLM, Git scan, inbox repair, full thread rebuild,
  or full effective-task expansion.
- Establish and record a cold/warm baseline, then meet a target of no more than
  250 ms for the registered-project shell, no more than 1 s for the complete
  fleet summary response on the current local project set, and no more than
  250 ms for a warm summary read. Detail/history may load separately.
- A project that cannot refresh reports “status unavailable” with a recoverable
  action; it never remains indefinitely at “still loading project state.”
- Save, task transition, proof, scope/release, run, and repository changes are
  visible in the relevant summary after the documented update boundary and
  survive restart.
- The same NH, Looma + Knit, Jess, and Fair Labor state produces the same
  current-scope, completion, blocker, next-action, and freshness facts across
  API, Projects, Overview, Map, Work, Releases, Activity, and task detail.
- Screenshots and geometry checks cover the active desktop viewport, a narrower
  desktop viewport, and mobile where applicable. No summary is communicated by
  a passive card that looks actionable without being actionable.

## Real-Project Proof Matrix

Use the projects as calibration data, not as decorative examples:

- **Narrative Harness:** rich nested work, proof evidence, optional release
  scope, running/blocked/deferred states, and the eventual headless/CLI MVP.
- **Looma + Knit:** multiple underlying repositories, current work mixed with
  repository follow-up, and the need to separate project identity from repo
  identity.
- **Jess:** an existing 1.0-era project whose next scope need not be called MVP;
  proves releases are named, optional, and not overfit to product shape.
- **Fair Labor License:** a thin-scope calibration case; proves honest sparse
  summaries and explicit unknowns without manufacturing a feature tree.

For each project, capture the authoritative API payload, projection payload,
and rendered result for the same timestamp. Record any information that Guildhall
cannot honestly show from current state as an intake gap, not an inference.

## Explicit Non-Goals During This Pivot

- Do not add another “spine,” “boundary,” “closure,” or parallel hierarchy.
- Do not polish the current Overview, Map, or Signals layout as a substitute for
  correct state ownership.
- Do not create more task-decomposition fallback recipes.
- Do not finish remaining Narrative Harness implementation tasks yet.
- Do not add user intake questions unless the real-project proof shows a
  specific missing fact that cannot be derived honestly.
- Do not build a second general-purpose database or event framework beside
  `project-state.db`.

## First Implementation Slice

The read-path inventory, timing harness, and first reusable persisted
projection are complete. The fleet and activity boundaries now read compact
state, and the old full fleet reconstruction has been deleted. The selected
project boundary is also bounded: the default shell and Overview/Work/Map
requests use compact state, while task detail and Release readiness are
separate deep reads.

The architectural slice is now the schema-versioned `project-state.db`, not
another endpoint optimization. Queue writes commit normalized work/scope
rows and the summary first. Runtime/workspace writes commit task execution
rows in one transaction per store replacement; evidence writes commit
latest-proof rows; supervisor/runtime writes
commit current run/runtime rows; owner-input writes commit current request
rows. Each write advances one project revision. Compatibility JSON is written
after that commit.

Still required before this pivot is complete:

- move compact fleet/project readers from summary JSON fields to direct
  database row reads where they currently still parse compatibility payloads;
- add crash/concurrency and dual-read parity fixtures for Narrative Harness,
  Looma + Knit, Jess, and Fair Labor License;
- migrate repository refreshes and approved scope writes into the same current
  state boundary, with external Git/container/provider operations represented
  as explicit intent/result records;
- prove cold/warm installed timings and cross-surface state agreement after a
  restart and after out-of-band legacy-file edits;
- delete or demote the remaining request-time repair/reconstruction paths once
  those proofs pass.

Narrative Harness MVP work resumes only after those model, migration,
performance, and agreement proofs pass.

## 2026-07-14 Progress And Archive Boundary

### Authority correction (supersedes the optimistic ownership claims below)

The inventory and real-project surface audit disproved part of the first
implementation story: `project-state.db` is a compact read model today, not
yet the current aggregate's sole authority. Normal full Project, Thread,
task-detail, repair, and orchestration paths still read `TASKS.json`,
runtime/workspace JSON, evidence JSONL, owner-input files, and runtime-control
files as live facts. No document below should be read as declaring those
transfers complete.

This changes the active implementation sequence and its acceptance gates:

1. **Queue authority transfer.** Add one transactional database queue API for
   replace, patch, release selection/membership, and task lookup. Convert
   `project-state-boundary`, intake, workspace importer, reintake,
   orchestrator, run-once, and task-transition writers to it. Then make full
   Project, Thread, and task detail consume it. `TASKS.json` becomes explicit
   compatibility import/export only after dual-read parity and recovery tests.
2. **Effective-state overlay transfer.** Make the already-modeled
   `task_execution`, `task_workspace`, and `task_proof` rows the current read
   source. Each writer atomically updates that row and appends bounded history;
   `effective-task` must stop scanning JSON/JSONL for ordinary current reads.
3. **Current-control transfer.** Put owner-input next state, supervisor
   execution lifecycle, runtime health, and stop intent behind transactional
   current-state reads. Existing files become recovery/diagnostic inputs, not
   normal status authority.
4. **Explicit detail contracts.** Release diagnostics and task detail may do
   bounded, opt-in evidence/Git inspection. They must receive a selected
   scope/task context from the shared aggregate and may not rebuild a project
   summary or Thread merely to fill an unrelated section.
5. **Agreement and budget gate.** Exercise all four real projects plus
   disposable stale/running/partial fixtures. API, Projects, Overview, Map,
   Work, Releases, Activity, and task detail must agree on selected scope,
   progress, blockers, next action, and freshness. Work's default page must
   meet an explicit byte cap; fast 100-row payloads are not accepted as a
   substitute.

The just-completed SQLite v6 list-row and stored-spine work is only a
precondition for item 1: it removes a compact-read escape hatch. It neither
changes queue ownership nor authorizes a cleanup/pruning feature.

The directly superseded planning material has been moved under
`internal/plans/archive/`, including the old project spine/orientation, map and
graph, release scope, task hierarchy/decomposition, delivery spine, logical
work/steps, iterative work campaigns, child-work planning, evidence-to-work
graph intake, and re-intake implementation plans. Those documents remain
searchable historical evidence, but they are no longer active instructions.

The archive boundary also now contains the completed or deferred flow
follow-ups, trust/completeness proposal, release-hardening matrix, memory
evaluation and implementation specs, the old project-graph contract proposal,
and the implemented contract-governance lane. These were moved because they
describe finished or superseded planning work, not because their evidence was
invalidated. The active folders are reserved for current implementation or
research owners.

The active model is therefore deliberately small:

- `project-state.db` owns the current project, repository, optional
  release/scope, work, run, runtime, owner-input, and latest-proof facts;
- compatibility JSON/JSONL owns import/export and historical detail during the
  migration, not a competing interpretation of current state;
- a generation-tagged project summary and indexed rows own the compact current
  read needed by fleet and project shell surfaces;
- orientation, map, release, work tree, execution, and historical activity are
  views or fields over that state, not new domains;
- Git Story and “Closure” are historical/detail language, not user-facing
  state concepts.

The current-state database now stores normalized work items, scopes, task
execution/workspace, latest proof, execution, runtime, owner-input, and
repository rows in addition to the compact summary. Supervisor start/stop/error
transitions, project runtime writes, task runtime/workspace writes, evidence
appends, and owner-input projection updates all have current-state write hooks.
Legacy files remain explicit compatibility/history boundaries until the parity
and restart proof is complete.

## Current Task Overlay Transfer

`task_execution`, `task_workspace`, and `task_proof` now form one explicit
current-task overlay. A point reader returns only those rows; it never opens
the runtime JSON stores or replays evidence JSONL. The normal task-history
builder remains separate because today it still derives reviewer summaries,
completion proof explanations, and checkpoints from historical evidence. That
is intentional: switching the drawer to the overlay before those facts are
materialized would make the response smaller by making it wrong.

Migration `0.12.14/task-current-overlay` imports existing runtime/workspace
records and one latest proof fact per known task into the existing database
tables. It leaves task definitions and every evidence JSONL byte unchanged.
Migration `0.12.15/task-current-overlay-reconcile` then enforces the actual
current-state invariant: overlay rows exist only for IDs in the current queue.
It deletes stale database overlays, never history records, and the queue
snapshot writer applies the same invariant on every later queue replacement.
After that migration, current-state consumers can use the overlay; explicit
history routes continue to use JSONL until a bounded per-task activity
projection owns the presentation facts they need. The effective-task reader
now consumes the database runtime/workspace point rows only after the project
has crossed an explicit authority marker. Before that promotion, it remains
compatibility-first; after promotion, it uses the database rows and does not
let stale JSON resurrect runtime/workspace fields. This is a compatibility
bridge during writer transfer, not permission for stale JSON to override a
current database row.

The first transfer bug found after migration was more basic: replacing a JSON
runtime or workspace store only upserted the rows that remained, so a cleared
record could survive forever in SQLite. The store boundary now replaces the
corresponding current table in one transaction; missing rows mean cleared
state. JSON remains a compatibility export, and JSONL remains history. The
replacement semantics and explicit writable-connection allocation remove
two concrete sources of current-state divergence before the remaining transition
writers move across the same boundary.

## Explicit Overlay Authority - 2026-07-14

The database file itself is not an authority signal. A project can have a
partially initialized or historically migrated `project-state.db` while its
legacy runtime/workspace files still contain the only complete current state.
Treating table existence as promotion would make a fast read wrong while
appearing healthy.

Schema version 10 adds `project_meta.task_overlay_authority` with the values
`legacy` and `database`. New and old databases remain `legacy` until the
automatic `0.12.21/task-overlay-authority` migration:

1. Reads the task IDs from the compatibility queue.
2. Reads runtime/workspace JSON through explicit legacy-only readers, never
   through the normal authority-aware readers.
3. Replaces the normalized current overlay rows and reconciles orphan IDs.
4. Promotes the marker to `database` in a transactional write.

Normal reads use the normalized overlay only after step 4. JSON continues to
be written as compatibility output during the transition, but a stale JSON
file cannot override a promoted database row. The migration is idempotent and
does not delete evidence history. This is the required pattern for the next
queue, owner-input, runtime-control, and repository authority transfers.

**Contract Touch Decision - `codex:task-overlay-authority-2026-07-14`**

- **Touched contracts:** task runtime/workspace current-state reader, effective
  task projection, migration import path, and project database metadata.
- **Considered but not touched:** task-definition fields, evidence-history
  records, release membership, owner-input schema, and public route shapes.
- **Required follow-up:** move all task transition writers behind the same
  database mutation boundary, then remove normal JSON/JSONL current reads.
- **Proof provided:** 57 focused tests including stale-compatibility and
  promotion/idempotence regressions; build and installed four-project proof
  remain required for this slice.
- **Apply/revert behavior:** authority promotion is reversible at the reader
  boundary; no legacy JSON or evidence history is deleted.

**Schema Migration Decision - `0.12.21/task-overlay-authority`**

- **Persisted schema touched:** `project_meta.task_overlay_authority` and the
  schema version marker in system-local `project-state.db`.
- **Change class:** additive authority metadata plus deterministic backfill;
  existing overlay rows are refreshed from the legacy current stores before
  promotion.
- **Compatibility reader:** legacy JSON remains the reader while the marker is
  `legacy`; promoted projects read normalized rows.
- **Existing data impact:** runtime/workspace/latest-proof current rows are
  refreshed; task definitions and evidence JSONL are untouched.
- **Rollback:** demote the marker to `legacy`; compatibility files remain
  available and all writes remain dual-written during the transition.

**Contract Touch Decision — `codex:task-current-overlay-2026-07-14`**

- **Touched contracts:** internal current-task read model, task-state writer
  ordering, and the automatic project migration ledger.
- **Considered but not touched:** task-definition schema, evidence-history
  schema, task-detail response, release/readiness semantics, and Thread.
- **Required follow-up:** materialize the historical presentation fields used
  by the drawer, then move its ordinary initial payload from the legacy
  effective-task builder to this overlay without dropping proof context.
- **Proof required:** database point-read, out-of-order latest-proof, and
  cleared-overlay replacement tests; idempotent four-project migration; and
  installed task-detail byte/latency evidence.
- **Apply/revert behavior:** migration only imports current projections; legacy
  JSON and JSONL remain untouched, so reverting the reader falls back without
  data loss.

**Schema Migration Decision — `0.12.14/task-current-overlay`**

- **Persisted schema touched:** no new table or column; existing
  `task_execution`, `task_workspace`, and `task_proof` rows are populated.
- **Change class and safety:** automatic, additive data backfill; latest proof
  is selected by recorded time so an out-of-order historical import cannot
  overwrite newer current state.
- **Compatibility/rollback:** JSON/JSONL remain readable detail and recovery
  records. The migration is idempotent and can be reverted by changing readers
  without deleting imported rows.

## 2026-07-14 Verified Boundary Slice

**Contract Touch Decision — `codex:default-project-projection-2026-07-14`**

- **Touched contract:** unqualified `GET /api/project` now returns the bounded
  projection; rich reconstruction is retained behind `detail=true`.
- **Considered but not touched:** task/detail schema, route names, project
  summary tables, and explicit surface payload fields.
- **Why:** a default route that can silently trigger readiness, Git, inbox,
  Thread, and history reconstruction is an unsafe API boundary for a desktop
  dashboard. The caller must opt into diagnostic cost.
- **Required proof:** read-boundary regression, explicit rich-route regression,
  installed byte/latency measurements, and browser shell refresh.
- **Apply/revert behavior:** query `detail=true` preserves the former rich
  contract for diagnostic consumers; reverting this selector restores the old
  default without changing persisted project records.

The first implementation slice now has a smaller, explicit runtime shape:

- `/api/service` and `/api/service/projects` are projection-backed fleet reads.
- `/api/service?projectId=...` is the compact selected-project read.
- `/api/service?detail=true` is a bounded diagnostic fleet summary, not the old
  full reconstruction contract. It reads provider, migration, availability,
  check-in, and projection-backed work counts without rebuilding effective
  tasks, Git Story, inbox, Thread, or history for every project.
- `/api/project/activity` is read-only and shares the projection action result;
  polling no longer repairs stopped work.
- `/api/project?compact=true` is the default selected-project shell; explicit
  `surface=overview|work|map` requests use the same compact boundary.
- An unqualified `/api/project` request now uses the bounded projection too;
  rich reconstruction requires explicit `detail=true`. This prevents an
  accidental legacy call from reintroducing the multi-megabyte path.
- Compact Overview uses the selected-scope orientation preview and returns
  action-relevant tasks only. It does not ship the full orientation tree or
  every task record.
- Compact release data labels itself `completeness: scope` and
  `checksLoaded: false`; it cannot claim the full Release verdict until the
  separate Release detail surface loads repository, design-system, and Git
  Story checks.
- The old request-time fleet reconstruction was deleted rather than left as
  unreachable compatibility code.
- The shared task-queue write boundary preserves an existing `releases` and
  `selectedReleaseId` envelope when a repair only supplies task definitions.
  This prevents read-time cleanup from silently destroying the selected scope.

This is the first proof that the model is getting smaller: the fleet response
does not need to know how to reconstruct every detail surface, and repair code
cannot accidentally rewrite away release state. The compact helper uses the
queue-backed selected scope for row counts; the persisted projection's scope
field remains intentionally summary-only.

Verification on the installed artifact:

- `pnpm build` passed.
- `pnpm lint:contracts` passed.
- `git diff --check` passed.
- Runtime parity suite: 3 files, 191 tests passed.
- Queue-boundary and compatibility regression: 3 tests passed, including
  direct release-envelope preservation.
- UI/store suite: 3 files, 81 tests passed.
- `/api/stale-server` reported `stale:false` after `pnpm dev:install` and
  restart.
- Live timings: `/api/service/projects` 16 ms, `/api/service` 4 ms,
  `/api/service?detail=true` 79 ms, Narrative Harness activity 9 ms, all for
  seven registered projects on the local service.
- Live parity: Narrative Harness activity and selected-project service expose
  identical action models; its summary freshness is `current`.

The installed selected-project boundary was then rebuilt and measured again:

- `/api/service/projects`: 29 ms, 15,117 bytes, 7 projects.
- `/api/service`: 26 ms, 15,132 bytes, 7 projects.
- Narrative Harness `/api/project?compact=true`: 106 ms, 168,755 bytes;
  19 returned selected-scope tasks out of 168 total.
- Narrative Harness compact Overview: 81 ms, 168,755 bytes.
- Narrative Harness compact Work: 18 ms warm, 272,694 bytes; all 168 work
  items are still returned because Work is an inventory surface, but large
  criteria, work-unit, size-plan, and evidence arrays are reduced to row-level
  signals.
- Narrative Harness compact Map: 16 ms warm, 188,729 bytes; the map still
  returns its 9-root project tree, but task records are identity-only.
- `/api/stale-server`: `stale:false` after the final install/restart.

The next response-size pass tightened those inventory contracts without
changing the authoritative task model. Work now exposes canonical row identity,
source grounding, lifecycle/readiness signals, compact brief/spec markers,
criteria/work-unit counts, and the small proof summary needed by its current
rows. It does not embed full acceptance criteria, work-unit analysis, size
plans, or raw evidence; those belong to task detail. Map only needs task IDs,
titles, statuses, work kinds, and release membership to render its hierarchy,
so it no longer transports descriptions or proof payloads. A runtime contract
test proves both boundaries. This is a payload reduction, not yet pagination:
the next slice still needs explicit bounded inventory loading for very large
projects.

The Thread boundary was then moved onto the same compact projection. Its first
request no longer repairs stopped state, expands every effective task, or
loads the full release gate merely to render turns and navigation context. On
the installed Narrative Harness project it measured 70 ms and 98,315 bytes,
down from the earlier roughly 4,118 ms and 630,440 bytes. The response marks
the omitted repository, design-system, Git Story, inbox, and history checks;
those remain explicit detail/enrichment work. The asynchronous Thread extras
route now accepts the task IDs already present in the first response, so it
does not rebuild Thread a second time just to attach Git Story records. The
task-scoped installed enrichment measured 73 ms and 794 bytes.

This proves the selected shell is no longer waiting on the old readiness scan,
but it also proves that “fast” and “small” are separate requirements. Work and
Map are now the next storage/read-contract targets, not reasons to add more
data to the Overview response.

This does not complete the pivot. The remaining work is to page or bound Work
and Map inventories, give Release/activity/task detail their own explicit
contracts, and add compact proof, repository, task-runtime, and direct
owner-input invalidation fields.
The current warm Narrative Harness detail baseline is still about 2,267 ms for
Overview, 2,113 ms for Work, and 1,764 ms for Map, with readiness dominating
the server timing. Only after those slices pass the four-project proof matrix
can Narrative Harness MVP execution resume.

## 2026-07-14 Compact Spine Boundary

The selected-project spine now has an explicit two-level contract:

- `GET /api/project/spine` remains the proof-rich detail read for Release and
  diagnostic consumers. It may inspect effective task proof, repository state,
  and full readiness because the caller explicitly requested detail.
- `GET /api/project/spine?compact=true` is the routine orientation read. It
  uses the task queue and project-summary projection, returns scope-level
  readiness with `checksLoaded: false`, and does not run the full Start or Git
  Story inspection. Its UI consumers are Release's orientation header and the
  project-structure panel.

This distinction matters because “one model” does not mean “one payload.” It
means both payloads name the same state owner and declare which evidence they
have loaded. The compact response now carries `summary.approvedPlan`, a small
projection of the already approved intake. That field lets the fast shell say
“approved planning exists” without loading the full intake documents. When
approved release membership identifies a current release, the projection also
selects that named scope for compact summaries; the queue itself remains
untouched. The installed matrix now proves the fast fleet, project, compact
spine, explicit spine detail, and Release readiness summaries agree for
named-release projects while no-release projects stay unreleased. The
remaining architecture work is to bound Work/Map inventories and
historical/detail reads so these same compact facts do not pull large payloads
back into routine routes.

Installed four-project proof after the boundary change:

- Narrative Harness compact spine: 53 ms, 58,988 bytes, current named release
  `Stage 1: Headless Drafting And Evaluation MVP`; explicit compact project:
  39 ms, 88,164 bytes.
- Looma + Knit compact spine: 20 ms, 81,297 bytes, current named release
  `Stage 1: V1 Release Hardening`; explicit compact project: 24 ms, 97,029
  bytes.
- Jess compact spine: 7 ms, 4,474 bytes, no release or inferred work.
- Fair Labor License compact spine: 3 ms, 4,297 bytes, no release or
  inferred work.

The non-compact spine remains deliberately expensive detail: NH was 1,857 ms
and 553,782 bytes, while Looma + Knit was 1,299 ms and 625,755 bytes. That is
the next concrete performance boundary, not a reason to make the compact
projection richer until it becomes another full payload.

## 2026-07-14 Release-Membership Parity Regression

The first real-project parity pass caught a data-model overwrite in the
Narrative Harness release path. Compact project/spine showed 12 current tasks,
while explicit Release readiness showed 11 because import augmentation emitted
another record for the same release and replaced the queue record's `nodeIds`.
The missing task was a completed DeepInfra model-selection item already present
in the queue release envelope.

`releaseProjectionInputsForTasks()` now merges release records by ID, unions
`nodeIds` and `deferredNodeIds`, and preserves existing metadata when the later
record is only a partial import view. This is an evolution of the existing
release projection, not a new release model or persisted migration. The compact
scope reader also treats queue membership as authoritative per release once
that release has explicit assignments; approved-plan IDs may seed an empty
release envelope but cannot widen an assigned one. Focused API regressions prove
queue-backed membership survives approved import augmentation and stale plan
rows do not become executable scope.

The corrected precedence is persisted through migration
`0.11.5/project-summary-release-membership-authority`. This refreshes only the
rebuildable project summary, so compact project cards do not keep serving the
old 12-item release count after the shared scope rule has moved the release to
its queue-owned 11-item boundary.

**Contract Touch Decision — `codex:release-membership-merge-2026-07-14`**

- **Touched contracts:** internal release projection assembly used by compact
  and explicit project scope/readiness responses.
- **Considered but not touched:** `TASKS.json`, approved workspace-plan
  schema, release IDs, task hierarchy, summary projection schema, and Git or
  proof records.
- **Required follow-up:** replace the remaining independently recomputed
  selected-task and proof populations with the durable summary boundary.
- **Proof provided:** focused release-readiness regression passed; full build,
  contract detector, and installed four-project parity proof remain required
  before this pivot slice is complete.
- **Apply/revert:** this is code-only and can be reverted without changing
  persisted project data.

The Jess and Fair Labor License result is the important negative proof: a
detail GET no longer turns live document detectors into 131/174 phantom task
records. Their setup state remains visible as `workspace_import_pending`, so
the UI can explain what is missing without pretending the project already has
an execution backlog. The approved-plan projection now closes the storage gap
without rewriting task history, and 0.11.4 makes its selected scope agree with
compact release summaries. The next boundary is payload size: Work, Map, and
historical/detail routes still need bounded reads instead of pulling the whole
project graph into routine navigation.

## 2026-07-14 Storage-Format and Memory-Write Correction

The four-project storage pass found two concrete data-layer problems that the
compact API numbers alone would not reveal:

1. The Mastra adapter created an empty thread row while constructing a memory
   packet. Looma + Knit had 24,523 rows in `mastra_threads` and zero messages;
   Jess had 711 and Fair Labor License had 155. These were not memory history.
2. The revision-matched full task detail store was expanded JSON even though it
   is system-local lookup data. Narrative Harness used 1,367,823 bytes and
   Looma + Knit used 1,463,845 bytes for highly repetitive task/spec payloads.

The fixes are deliberately different because the causes are different:

- `createMastraMemoryCoreAdapter({ readOnly: true })` no longer calls
  `createThread`. The read path is now observational and cannot grow durable
  state. Migration `0.12.19/memory-empty-thread-shells` removes only rows with
  the exact Guildhall-generated title, null metadata, no message, no thread
  state, and no workflow snapshot. It then vacuums the one-time repair. A
  message-bearing-thread regression proves useful memory survives.
- The full detail sidecar is now written as
  `project-state/queue-details.json.gz`, with a reader fallback for old plain
  `queue-details.json` files. Migration
  `0.12.20/project-state-detail-compression` writes the compressed copy,
  fsyncs it, then removes the expanded compatibility copy. The JSON content is
  unchanged; only its storage format changes. A detail-reader regression
  decompresses and compares the real task definition.

Installed proof after applying both migrations to Narrative Harness, Looma +
Knit, Jess, and Fair Labor License:

| Project | Total before format pass | Total now | Full detail now | Compact response | Rich response |
| --- | ---: | ---: | ---: | ---: | ---: |
| Narrative Harness | 11,288,192 B | 10,039,704 B | 118,684 B | 45,491 B / 44 ms | 1,911,546 B / 3.25 s |
| Looma + Knit | 20,068,216 B | 18,656,919 B | 51,912 B | 50,580 B / 38 ms | 1,698,193 B / 6.43 s |
| Jess | 2,421,661 B | 2,421,733 B | 499 B | 6,521 B / 13 ms | 82,528 B / 3.22 s |
| Fair Labor License | 2,707,387 B | 2,707,483 B | 509 B | 6,867 B / 66 ms* | 56,758 B / 0.40 s |

`*` The Fair Labor compact sample ran while the rich probes were competing
for the same local service; isolated earlier compact reads were 5-8 ms. All
four rich responses remained 200, all compact responses remained 200, and
`/api/stale-server` reported `stale:false`.

The storage result is meaningful but not a victory lap. The SQLite current
state database now contains only bounded card fields for these projects;
`work_items.definition_json` totals 336 B for Narrative Harness and 668 B for
Looma + Knit, so the full task definitions are not still duplicated there.
The remaining large bytes are identifiable legacy/history records: codebase-map
history, old TASKS backups, progress snapshots, task review/evidence records,
and the SQLite page/index floor. Those need their own retention and ownership
decisions; deleting them blindly would repeat the modeling mistake.

**Contract Touch Decision - `codex:data-size-and-data-layer-2026-07-14`**

- **Touched contracts:** system-local Mastra adapter read/write semantics and
  the internal full task-detail sidecar format.
- **Considered but not touched:** task fields, release fields, public API
  routes, compact project summary shape, evidence JSONL, and repository data.
- **Required follow-up:** move remaining task transition writers to the same
  current-state boundary; define retention owners for codebase maps, backups,
  progress snapshots, review evidence, and provider diagnostics.
- **Proof provided:** 56 focused tests, `pnpm lint:data-layer`,
  `pnpm lint:contracts`, build/install/restart, four-project migrations, live
  compact/rich API probes, and stale-server proof.
- **Apply/revert:** both migrations are idempotent. The Mastra migration does
  not touch message-bearing rows. The detail migration preserves the original
  JSON bytes in compressed form and the reader still accepts the old format.

**Schema Migration Decision**

- **Persisted schema touched:** system-local Mastra thread rows and the
  system-local full task-detail sidecar filename/encoding.
- **Migration IDs:** `0.12.19/memory-empty-thread-shells` and
  `0.12.20/project-state-detail-compression`.
- **Existing data impact:** only empty generated Mastra shells are removed;
  full task detail is compressed without field-level rewriting. Message,
  state, workflow, task, release, evidence, and history records are retained.
- **Compatibility reader:** compressed detail is preferred, plain JSON remains
  readable until the project migration converts it.
- **Rollback:** restore a plain detail sidecar from the compressed bytes; do
  not recreate deleted empty shells. The read-only adapter prevents them from
  returning.

The pivot is therefore **partially successful**: ordinary project/fleet reads
are small and fast, and two sources of unbounded growth are closed. It is not
complete until the remaining history/backup payloads have explicit owners and
retention boundaries, normal task transitions write one authoritative current
state, and Work/Map/detail routes have installed byte and latency budgets.

## Installed Authority Promotion And Fleet Parity - 2026-07-14

The explicit authority boundary was built, migrated, and exercised against the
four real calibration projects. This is the first proof that the data model is
not merely carrying a second SQLite copy beside the old readers:

- Narrative Harness: schema 10, database overlay authority, 168 current work
  rows, 168 runtime rows, 35 workspace rows, 163 latest-proof rows.
- Looma + Knit: schema 10, database overlay authority, 334 current work rows,
  334 runtime rows, 39 workspace rows, 333 latest-proof rows.
- Jess: schema 10, database overlay authority, one explicit workspace-import
  task and no release.
- Fair Labor License: schema 10, database overlay authority, one explicit
  workspace-import task and no release.

The first run of this proof caught a real optional-release defect: Jess and
Fair Labor had `selectedReleaseId: null`, while the runtime queue schema
correctly models “no release” by omission. Summary rebuilds rejected the null
and the fleet projected false zeroes. The queue compatibility normalizer now
removes null optional release selectors, and migration
`0.12.22/current-summary-rebuild-after-authority` rebuilds any stale/failed
summary after promotion. Both migrations are idempotent; neither deletes
task definitions or evidence history.

Fresh installed samples after `pnpm build`, `pnpm dev:install`, service
restart, and automatic migration:

| Surface | Bytes | Time |
| --- | ---: | ---: |
| Fleet `/api/service` | 31,201 | 18 ms |
| Narrative Harness Overview | 48,634 | 6 ms |
| Narrative Harness Work | 121,740 | 6 ms |
| Looma + Knit Overview | 32,627 | 4 ms |
| Looma + Knit Work | 114,098 | 5 ms |
| Jess Overview | 6,960 | 6 ms |
| Fair Labor License Overview | 7,306 | 3 ms |

`/api/stale-server` reported `stale:false`. This is a strong result for the
normal shell path: it is now loading a small, current read model rather than
waiting for every project’s full task, history, Git, and diagnostic state.

It is not the finish line. The tested Narrative Harness task-detail response
now measured 462.8 KB, but that is still far larger than the shell and still
contains too much durable task history. The active history
directories also retain old backups, codebase-map history, progress snapshots,
review/evidence records, and provider diagnostics. Those are now named storage
owners to redesign, not an invitation to delete files. The next architectural
slice is to move queue/task-detail reads and remaining control/domain writers
onto the same authority boundary, then give history/detail explicit bounded
retention and paging contracts.

**Contract Touch Decision - `codex:overlay-authority-and-fleet-parity-2026-07-14`**

- **Touched contracts:** current task overlay authority, optional release queue
  normalization, migration detection/application, and compact fleet summary
  freshness.
- **Considered but not touched:** release requirement semantics, task IDs,
  evidence history schema, Git records, public route names, and UI copy.
- **Required follow-up:** queue authority transfer, current-control transfer,
  bounded task/detail/history responses, and rendered API/UI agreement proof.
- **Proof provided:** 57 focused tests before the optional-release repair, 46
  focused queue/summary/migration tests after it, build/install/restart,
  four-project migration, DB metadata/count inspection, compact API probes, and
  stale-server proof.
- **Apply/revert:** migrations are additive and idempotent; demoting authority
  returns readers to compatibility files without deleting them.

**Schema Migration Decision - `0.12.22/current-summary-rebuild-after-authority`**

- **Persisted schema touched:** no new fields; the migration rebuilds the
  existing summary rows/file after the authority transition.
- **Change class:** deterministic rebuild of a derived read model, automatic
  and idempotent.
- **Existing data impact:** no task, release, runtime, workspace, or evidence
  records are deleted or rewritten.
- **Compatibility/rollback:** rerun the summary projection from the current
  queue; authority and historical records are unaffected.

## Single Current-State Authority And Canonical Action - 2026-07-14

The marker introduced during the first overlay transfer was misnamed: it
governed more than task overlays. Schema version 11 renames it to
`project_meta.project_state_authority`, making the model explicit. Once
promoted, the database owns the current queue, scope, summary, execution,
runtime, owner-input, repository, availability, attention, and reconciliation
facts. Legacy JSON is an import/recovery format, not a second mutable model.

Migration `0.12.23/project-state-single-authority` verifies the database queue,
removes duplicate `TASKS.json` and `project-summary.json` files, and changes
the write boundary so they cannot return. Migration
`0.12.24/project-summary-action-model` backfills summary version 11 with the
canonical action model: primary action, focus task, href, tone, and run
control. Fleet and project surfaces now prefer this persisted result; legacy
summaries may still use the old builder only until migration completes.

**Contract Touch Decision - `codex:single-project-state-authority-2026-07-14`**

- **Touched contracts:** project database metadata, current queue read/write
  boundary, summary projection version, and migration ledger.
- **Considered but not touched:** task definitions, release membership,
  evidence history, raw transcripts, and public route names.
- **Required follow-up:** move remaining task transition writers and detail
  readers behind the database mutation/read APIs; eliminate UI fallbacks that
  re-rank paged inventory.
- **Proof provided:** schema rename on existing databases, duplicate-file
  migration, no-recreation write regression, canonical-action persistence,
  installed four-project migration/latency proof, and `/api/stale-server`
  freshness proof. Remaining detail/history bounds are intentionally open.
- **Apply/revert:** the old column is renamed in place; old files are removed
  only after a readable database queue is verified. A legacy project remains
  compatibility-first until explicit promotion.

**Schema Migration Decision - `0.12.23` and `0.12.24`**

- **Persisted schema touched:** `project_meta.project_state_authority` and
  summary payload version 11.
- **Existing data impact:** task definitions and history are retained; only
  duplicate current-state compatibility files are removed after verification.
- **Compatibility reader:** legacy files remain readable for projects whose
  authority marker is still `legacy`.
- **Rollback:** demote authority before restoring compatibility exports; the
  database and compressed detail store remain intact.

## Rich-Route Authority Transfer And First Retention Guardrail - 2026-07-14

The first authority promotion exposed a second split-brain boundary: compact
surfaces used the database, but several rich routes still called a file reader
that returned empty state when `TASKS.json` had been removed. The initial task
drawer also treated current detail and history as one payload. This pass makes
the queue reader itself authoritative and gives history an explicit loading
boundary.

- `readTasksFileNormalized` and `readTaskQueueFileNormalized` now read the
  revision-matched database detail store whenever
  `project_state_authority=database`; legacy JSON is only used by projects that
  have not been promoted.
- Rich project, activity, spine, release-readiness, project-graph, Git Story,
  delivery-spine, inbox, Thread, and task-detail routes inherit that reader.
- The task drawer's first response keeps current task/spec/proof summaries and
  loads evidence/history/review records from dedicated endpoints when their
  tabs are opened. This is a response-shape boundary, not history deletion.
- Codebase-map history is classified as rebuildable diagnostics and is capped
  at 256 KB or 128 recent records. Existing cleanup uses this same policy and
  reports bytes/records before and after.
- Project-state cleanup now derives active task IDs from the authoritative
  database after promotion, rather than treating an absent compatibility file
  as an empty project.

**Contract Touch Decision - `codex:rich-route-authority-and-history-boundary-2026-07-14`**

- **Touched contracts:** normalized serve queue readers, initial task-detail
  response and lazy history/review endpoints, and codebase-map diagnostic
  retention.
- **Considered but not touched:** task IDs, release semantics, evidence event
  schema, public route names, Git records, and UI wording.
- **Required follow-up:** bound progress/heartbeat/reviewer streams, classify
  migration snapshots with restore manifests, remove stale non-calibration
  projections, and prove all surfaces against the same installed state.
- **Proof provided:** 138 focused runtime tests, 53 TaskDrawer tests, build and
  installed route probes, and the promoted-project no-`TASKS.json` regression.
- **Apply/revert:** route changes are reader-only. The map-history cap is
  rebuildable diagnostic cache policy; its compaction reports the exact byte
  and record delta and can be disabled for a dry run.

**Schema Migration Decision - `0.12.25/rich-route-authority-and-diagnostic-ring`**

- **Persisted schema touched:** none for SQLite or task records; the existing
  JSONL diagnostic file is bounded in place and the existing detail sidecar is
  read through its authority marker.
- **Existing data impact:** current task/release/proof records remain intact;
  only rebuildable code-map diagnostics beyond the declared ring are eligible
  for compaction by the explicit cleanup command.
- **Compatibility reader:** legacy queue files remain supported while their
  project's authority is `legacy`; old task-detail JSON remains readable by
  the compressed sidecar reader.
- **Fixtures/tests:** promoted rich-route fixture, task-detail history-lazy
  fixture, code-map ring fixture, and the existing read-boundary suite.
- **Rollback:** dry-run the cleanup, restore the diagnostic JSONL from a
  separately retained copy if an investigation requires it, or leave the
  current ring untouched; no current project-state rollback is needed.

## Status Checkpoint - 2026-07-14

The first performance boundary is now real in the installed app, but the data
layer refactor is not complete. Compact fleet/project reads no longer wait for
all project history: the fleet index is about 31 KB and returns in roughly
5-24 ms; Narrative Harness Overview, Work, Map, and Activity are about 48.5 KB,
121.6 KB, 79.8 KB, and 5.5 KB, all returning in single-digit milliseconds in
the latest probe. The promoted database queue also feeds Activity after the
compatibility `TASKS.json` is removed.

The remaining problem is now measurable rather than amorphous. Narrative
Harness's rich detail route is still 1.9 MB / 1.5 s and the full spine is 552
KB / 408 ms. The four calibration history roots are approximately 11.7 MB NH,
20.3 MB Looma + Knit, 2.6 MB Jess, and 3.0 MB Fair Labor License. The largest
payloads are old task backups, code-map history, progress/heartbeat streams,
task evidence, and migration/evacuation material. Therefore the next work is
not another UI-level trim: each store needs a declared ownership class
(current state, bounded operational history, rebuildable diagnostic cache, or
archival/migration evidence), a retention and restore contract, and a
single-purpose reader. Only then should existing material be compacted.

**Current verification:** 205 focused runtime/UI tests pass; data-layer and
contract detectors pass; the installed artifact reports `stale:false`. No
large history root has been blindly pruned. The active goal remains open until
rich detail, progress/heartbeat, migration snapshot, and non-calibration
freshness boundaries are designed and proven.

The declared diagnostic/heartbeat cleanup has since been applied to the four
calibration projects. Their history roots now measure approximately 11.0 MB,
18.9 MB, 2.6 MB, and 3.0 MB respectively. Compared with the immediately
preceding 37.65 MB combined measurement, that is about 2.1 MB removed.
The compact API sizes and current-state counts remained unchanged after the
cleanup, and the installed artifact still reports `stale:false`. This is a
verified first reduction, not permission to delete the remaining large files:
the next pass must add provenance, digest, migration-id, restore verification,
and retention-window fields for migration/evacuation snapshots before those
stores are compacted.

## Migration Snapshot Provenance - 2026-07-14

Migration backups are rollback evidence, not an unclassified second copy of
current project state. The old writers created files named like
`TASKS.before-*.json` but did not record which migration created them, which
source bytes they captured, whether a later run silently reused a mismatched
file, or whether restoration had ever been verified. That made it impossible to
compact old backups responsibly.

The migration snapshot writer now creates an immutable backup plus a manifest
sidecar. The manifest records the migration id, source and snapshot paths,
byte counts, SHA-256 digests, capture verification, restore verification
status, and the fact that the artifact is retained for rollback review. An
existing snapshot is never overwritten. If its migration id or digest disagrees
with the new write, the migration fails loudly instead of generating another
ambiguous backup. Existing unmanifested snapshots can receive a compatibility
manifest, but are marked unverified when the current source has drifted.

The hierarchy, task-state, delivery-step, and execution-planning migrations now
use this writer and report both the backup and manifest through their affected
paths. This is the first step toward an evacuation/restore registry; it does
not yet authorize deleting old snapshots. Restore verification and retention
windows are still required before existing migration or evacuation material is
compacted.

**Contract Touch Decision - `codex:migration-snapshot-provenance-2026-07-14`**

- **Touched contracts:** project migration backup creation, migration result
  affected paths, and rollback artifact metadata.
- **Considered but not touched:** task ids, task/release records, SQLite
  current-state schema, public API routes, migration ordering, and restore
  semantics beyond the explicit unverified/verified field.
- **Required follow-up:** make evacuation snapshots use the same manifest,
  add restore verification that hashes the restored queue/detail state, and
  define retention classes and user-visible rollback affordances.
- **Proof required:** immutable snapshot tests, source-drift test, migration
  wrapper affected-path coverage, build, contract lint, and installed route
  proof after the writer changes.
- **Apply/revert:** the writer is backward-compatible for existing snapshots;
  reverting the code restores the old writer but does not alter existing
  snapshots. No old artifact is deleted by this change.

**Schema Migration Decision - `0.12.27/migration-snapshot-provenance`**

- **Persisted schema touched:** system-local migration backup sidecars named
  `<snapshot>.manifest.json`; no SQLite tables or canonical task fields.
- **Change class:** additive rollback-evidence metadata with immutable-write
  enforcement.
- **Existing data impact:** existing backup bytes are preserved. A legacy
  backup may receive one compatibility manifest when that migration is run;
  its capture flag is honest about source drift.
- **Migration id:** `0.12.27/migration-snapshot-provenance` for this contract;
  individual manifests retain the originating migration id.
- **Compatibility reader:** no reader depends on the sidecar yet; future
  restore tooling must treat a missing manifest as legacy/unverified and must
  not auto-delete it.
- **Fixtures/tests:** `src/runtime/__tests__/migration-snapshot.test.ts` and
  the existing migration suite cover immutable bytes, digest metadata, and
  source drift.
- **Owner-facing plan text:** the next cleanup may classify these files, but
  cannot compact them until restore verification and retention are implemented.
- **Rollback/revert:** remove only newly written manifests if a migration
  rollback requires it; never replace or rewrite an existing snapshot.

## Operational History Boundary - 2026-07-14

Heartbeats are operational liveness, not project memory. The old writer
appended Markdown forever, and cleanup could append moved heartbeat blocks while
also creating a complete pre-compaction progress snapshot. That was a storage
model defect: a maintenance operation could increase the number of durable
copies of the same operational stream.

The writer now stores only a bounded atomic ring of the latest 512 heartbeat
records or 256 KB, whichever is smaller. The explicit cleanup command applies
the identical policy to older files. Cleanup no longer creates a new complete
`PROGRESS.before-compaction.md` copy. Existing historical copies are retained
for now; removing them requires the archival/restore decision below rather than
an implicit prune.

**Contract Touch Decision - `codex:heartbeat-retention-boundary-2026-07-14`**

- **Touched contracts:** heartbeat write path, cleanup output metrics, and
  operational-history retention semantics.
- **Considered but not touched:** milestone/block/escalation progress records,
  task evidence, session snapshots, recent agent events, transcript content,
  SQLite current-state rows, and public API route shapes.
- **Required follow-up:** give each remaining operational/diagnostic store a
  writer-level bound before compacting existing files.
- **Proof provided:** 20 focused local-history/memory-tool/compaction tests;
  atomic writer and shared cleanup policy are covered by the same fixture.
- **Apply/revert:** the cleanup command remains explicit. A dry run reports
  before/after bytes and records; the prior bounded file can be restored if an
  investigation requires it.

**Schema Migration Decision - `0.12.26/heartbeat-retention-boundary`**

- **Persisted schema touched:** no SQLite schema or current project-state
  records; only the system-local heartbeat Markdown stream changes retention.
- **Change class:** backward-compatible bounded operational cache policy.
- **Existing data impact:** no existing files are deleted automatically; the
  explicit cleanup command may reduce only the declared heartbeat ring.
- **Compatibility reader:** existing Markdown heartbeat blocks remain readable;
  the new reader accepts the same heading format.
- **Rollback:** stop applying cleanup and restore a retained old heartbeat file;
  no current-state or task migration rollback is needed.

## Test Data Isolation and Fleet Inventory - 2026-07-14

The storage audit separated two problems that had been getting conflated:

1. The four active calibration projects contain about 31.4 MB of exact file
   bytes combined: Narrative Harness 9.2 MB, Looma + Knit 17.1 MB, Jess
   2.4 MB, and Fair Labor License 2.7 MB.
2. The whole local project cache occupies about 3.6 GB and contains 52,633
   project directories. Most of those directories are ephemeral
   `guildhall-*` or `forge-*` test roots, not registered projects.

The second number is a lifecycle/identity defect, not a reason to add a more
aggressive prune command. Tests were able to allocate under the real
`~/.guildhall/data/projects` root, and read paths had historically created
directories as a side effect. That made unowned test state indistinguishable
from registered project state and turned every broad test run into durable
residue.

`scripts/vitest-data-isolation.ts` now gives Vitest workers a temporary,
per-process `GUILDHALL_DATA_DIR` unless the caller explicitly supplies one.
Focused data-layer tests were run before and after this change: the real
project directory count remained exactly 52,633, and no new isolated temp
roots remained after the run. Stop-marker writes now create their parent
directory explicitly, so removing read-side effects does not break writes.

The active project bytes are not primarily task titles. The largest current
categories are migration/task backups, evacuation material, progress and
evidence records, code-map history, event/history logs, and SQLite files. The
largest single files include a 2.1 MB Looma task backup, a 1.1 MB evacuation
progress copy, and a 0.9 MB current-state database. This confirms that the
next reduction must come from ownership, retention, and detail boundaries,
not from another UI-only summary or a blind JSON minifier.

**Contract Touch Decision - `codex:test-data-isolation-and-fleet-inventory-2026-07-14`**

- **Touched contracts:** Vitest data-root setup and the stop-marker write
  boundary; no user-facing project-state API contract.
- **Considered but not touched:** registered-project identity, evacuation
  restore semantics, task/release records, current-state SQLite tables, and
  production retention policy.
- **Required follow-up:** define the registry as the owner of project-local
  storage, make every evacuation entry manifest-backed, and add a deliberate
  orphan-inspection/removal workflow that cannot confuse test residue with a
  live project.
- **Proof provided:** 27 focused stop-marker/storage tests, 22 focused
  data-isolation/decomposition tests, unchanged real project directory count,
  and zero remaining temporary isolation roots.
- **Apply/revert:** test isolation is process-local and reversible; it does
  not delete existing data. The write-path directory creation preserves the
  old behavior where it is actually required.

**Schema Migration Decision - `0.12.27/test-data-isolation-boundary`**

- **Persisted schema touched:** none. The change affects test process
  configuration and a filesystem write precondition only.
- **Change class:** lifecycle guardrail, not a project-data migration.
- **Existing data impact:** none; the 3.6 GB cache remains untouched pending
  registry-backed ownership and explicit retention decisions.
- **Rollback:** remove the Vitest setup file and its config entry if needed;
  no project-state restore is required.

## Evacuation Ownership and Bounded Detail - 2026-07-14

The first storage boundary is now a real two-phase operation. When repo-local
Guildhall state is evacuated, Guildhall hashes each source entry, copies it,
hashes the copy, verifies the source did not change during the copy, writes a
versioned `project-state-evacuation/manifest.json`, and only then removes the
source. A batch records source and snapshot paths, byte counts, SHA-256
digests, and restore status. Restore verifies every manifest entry before it
uses it, records the target digest after a successful restore, and refuses to
apply tampered manifest-backed state. Legacy evacuation material without a
manifest remains readable as an explicit compatibility path, but is not
treated as verified evidence.

Restore migrations are now marked as recheckable reconciliation migrations.
The migration ledger no longer makes them permanently disappear after the
first run: a later evacuation batch is detected and can be applied under the
same migration contract. Ordinary one-shot migrations retain their existing
ledger behavior.

The explicit project detail route also now respects the same read boundary as
the product UI. `/api/project?detail=true` is projection-backed, bounded, and
links to independent inbox, Thread, activity, release-readiness, Git, and
task-detail endpoints. The old aggregate reconstruction is available only as
`/api/project?diagnostic=true`; it is an intentional diagnostic escape hatch,
not a project card dependency. No production UI caller used the old detail
aggregate, so this removes a dangerous accidental path without deleting the
diagnostic capability.

**Contract Touch Decision - `codex:evacuation-ownership-and-bounded-detail-2026-07-14`**

- **Touched contracts:** project-state evacuation/restore behavior, migration
  reconciliation semantics, and the meaning of `GET /api/project?detail=true`.
- **Considered but not touched:** task/release record fields, SQLite current
  state tables, ordinary compact route shapes, dedicated inbox/Thread/Git
  endpoint payloads, and owner approval semantics.
- **Required follow-up:** add strict cursors/byte ceilings to the remaining
  historical endpoints and make their shared current summary fields come from
  the same projection revision.
- **Proof provided:** manifest round-trip and tamper tests, compaction and
  restore tests, later-evacuation recheck test, bounded detail API test, build,
  data-layer lint, contract lint, and installed runtime proof.
- **Apply/revert:** old aggregate behavior can still be reached with the
  explicit `diagnostic=true` query. Reverting the route change does not delete
  data; reverting evacuation code must preserve existing manifests and legacy
  fallback reads.

**Schema Migration Decision - `0.12.28/evacuation-manifest-and-detail-boundary`**

- **Persisted schema touched:** additive
  `project-state-evacuation/manifest.json` batches and per-entry restore
  metadata; no task/release/SQLite columns were changed.
- **Change class:** additive migration provenance plus an API read-contract
  tightening. Existing unmanifested evacuation files remain compatible.
- **Existing data impact:** no existing state is deleted or rewritten by the
  manifest introduction. New evacuation writes are two-phase and manifest
  backed. Tampered manifest entries are blocked from restore.
- **Migration id:** `0.12.28/evacuation-manifest-and-detail-boundary` is the
  contract version; restore reconciliation is rechecked against new batches.
- **Compatibility reader:** missing manifests use the legacy read path and are
  reported as unverified; a manifest reader rejects malformed or tampered
  entries instead of silently consuming them.
- **Fixtures/tests:** `evacuation-manifest.test.ts`,
  `project-state-compaction.test.ts`, `migrations.test.ts`, and
  `serve-read-boundary.test.ts` cover the storage and route boundaries.
- **Owner-facing plan text:** old evacuation material is not eligible for
  deletion until it has a manifest or an explicit legacy retention decision.
- **Rollback/revert:** keep all snapshots; restore the prior route only if a
  diagnostic client requires it. No history rewrite is part of this change.

## Activity History Boundary - 2026-07-14

The normal project payload no longer carries `recentEvents`. That was the
right storage boundary but initially left Timeline dependent on a field that
the compact contract intentionally omits. The corrected model has two explicit
reads: `/api/project/events` is the live SSE stream, and
`/api/project/activity/history` is a bounded newest-first page over the
retained durable activity ring. Timeline loads the latter only when opened and
can request older pages with a cursor. It does not make the project overview
pay for historical activity, and opening Timeline does not reconstruct tasks,
Thread, Git Story, or repository diagnostics.

The history reader consumes at most the retained 512 KB event window and
returns at most 100 records per page. This is an explicit retained-history
contract, not an unbounded JSONL read disguised as a UI fetch. Live events
still arrive through SSE and are merged into the visible page.

**Contract Touch Decision - `codex:activity-history-boundary-2026-07-14`**

- **Touched contracts:** the project activity history route, Timeline initial
  load/older-page behavior, and the detail payload's endpoint directory.
- **Considered but not touched:** current task/release/projection records,
  live SSE event shape, inbox/Thread/Git Story payloads, and diagnostic mode.
- **Required follow-up:** apply the same bounded-page contract to inbox,
  Thread, Git Story, and any task evidence endpoint that can expose a large
  ledger; add shared projection revision fields where those surfaces repeat
  current summary facts.
- **Proof provided:** 31 focused supervisor/read-boundary/Timeline tests,
  including newest-first cursors and GET non-mutation.
- **Apply/revert:** the route is additive. Removing it restores the prior
  compact Timeline behavior but does not affect durable project state.

**Schema Migration Decision - `0.12.29/activity-history-boundary`**

- **Persisted schema touched:** none. The existing compact recent-event ring
  is read through a bounded page; no event rows or JSONL records are rewritten.
- **Change class:** additive API/read-contract boundary.
- **Existing data impact:** none. The existing writer's 512 KB / 1,000-record
  retention limit remains the source of truth.
- **Compatibility reader:** old clients may continue to use live SSE; new
  Timeline clients use the explicit history route when the compact payload
  does not include embedded events.
- **Rollback/revert:** route and UI changes can be reverted without a data
  migration or history rewrite.

## Task History Read Boundary - 2026-07-15

The task drawer must not make an apparently small history request replay every
JSONL evidence record into memory. `/api/project/task/:id/history` now reads
the evidence files as a stream, filters records while reading, and returns an
explicit oldest-first page. It retains only the requested cursor window and
uses a hard 256 KiB response/read budget with a 200-record maximum. The page
reports `total`, `bytes`, `maxBytes`, and `hasMore` so a client can tell the
difference between an empty history and a bounded page.

This is a read boundary only. It does not pretend to solve the larger storage
problem: task evidence JSONL is still an unbounded writer-owned history and
`buildEffectiveTask` still has compatibility paths that read it for rich task
semantics. The next storage change must give each evidence kind an explicit
retention and essential-summary policy, then migrate existing records only
after the current-state readers no longer depend on raw history.

**Contract Touch Decision - `codex:task-history-read-boundary-2026-07-15`**

- **Touched contracts:** task-history pagination metadata and the task drawer's
  on-demand history read.
- **Considered but not touched:** task current-state rows, latest proof
  projection, raw evidence record shape, review endpoint, and diagnostic mode.
- **Required follow-up:** replace raw evidence replay in current-state reads,
  define per-kind retention, and add a compact essential-history projection.
- **Proof provided:** the task-state-store page test proves oldest-first
  pagination stays under a byte ceiling; the task endpoint test proves the
  existing canonical note filtering and order remain stable.
- **Apply/revert:** additive reader change; removing the page reader restores
  the previous full-file route without changing persisted evidence.

**Schema Migration Decision - `0.12.30/task-history-read-boundary`**

- **Persisted schema touched:** none. Evidence JSONL remains unchanged and no
  history is deleted by this change.
- **Change class:** bounded read/API contract.
- **Existing data impact:** none; oversized historical lines are still read
  only when the requested page encounters them, so this is not being counted
  as history compaction.
- **Compatibility reader:** the existing full `readTaskEvidence` function
  remains for legacy orchestration paths until their current-state projections
  are complete.
- **Rollback/revert:** route and reader can be reverted without migration.

## Current Evidence Projection - 2026-07-15

The previous `task_proof` row was not a sufficient current-state model: it
remembered only the latest event of any kind, while `buildEffectiveTask`
replayed every evidence JSONL file to recover notes, gates, reviews, and open
entities. Schema 12 adds `task_evidence_current`, a bounded per-task
projection containing the latest current records by evidence kind. It is
updated in the same database transaction as the existing latest-proof row.

The projection keeps at most 16 current records per kind and 64 KiB per task.
If a current record is too large for that bound, the projection stores an
explicit summary marker while the historical JSONL record remains untouched.
The raw ledger is therefore history/detail, not an ordinary current-state
dependency. A new `evidence: 'current'` effective-task read mode consumes the
projection without opening the evidence files; the default rich mode remains
history-backed until parity work proves each caller can move safely.

This is deliberately a model change, not a pruning command. Existing history
is not deleted, and no current task is silently rewritten. The next slice is
to move release/readiness and other current-state consumers to this projection
or to the already-written project summary, then add parity checks for stale,
failed, proof-missing, and reopened tasks before any historical compaction.

**Contract Touch Decision - `codex:task-evidence-current-2026-07-15`**

- **Touched contracts:** SQLite schema 12, task-evidence write boundary,
  current evidence reader, and the explicit `evidence: 'current'` effective
  task read mode.
- **Considered but not touched:** raw JSONL event shape, rich task-detail
  behavior, task titles, release membership, and historical deletion.
- **Required follow-up:** route all ordinary current-state consumers through the
  current projection; prove parity before changing rich/detail readers; define
  per-kind historical retention after current readers no longer replay it.
- **Proof provided:** database overlay tests verify current records survive
  proof writes and queue replacement; effective-task tests delete the raw
  evidence directory and still build the current read successfully.
- **Apply/revert behavior:** schema creation is additive and idempotent. The
  current reader can be disabled while the raw history remains intact; the
  backfill migration never deletes the ledger.

**Schema Migration Decision - `0.12.31/task-evidence-current-projection`**

- **Persisted schema touched:** `task_evidence_current` and the schema version
  marker, plus its orphan-row reconciliation with current task IDs.
- **Scope:** project-local current-state database; raw task evidence remains a
  separate historical store.
- **Change class:** additive current read model with deterministic backfill.
- **Existing data impact:** existing JSONL is read once during explicit
  migration to seed the bounded projection; no event is deleted or rewritten.
- **Compatibility reader:** `readTaskEvidence` remains available for rich
  detail and legacy orchestration until parity gates are complete.
- **Fixtures/tests:** database overlay, current-mode effective-task, and
  migration suites cover fresh and existing state; the batch current-evidence
  reader is covered by the database suite; four real projects now have
  populated schema-12 projections.
- **Rollback/revert:** demote current consumers to the rich reader; leave the
  additive table and raw history in place for recovery.

The first attempted consumer move also exposed the remaining parity boundary:
the rich release-readiness route still depends on imported proof hints and
legacy completion fields that are not yet represented completely in the
current projection. That route remains history-backed until a parity fixture
proves the same result from current rows. The compact release-summary route is
already projection-only. The current reader itself now has a batch API, so the
eventual consumer move will not create one SQLite connection per task.

## Migration Ordering Correction - 2026-07-15

The first installed attempt exposed a real migration-model error: an earlier
database migration could open the writable database and advance its physical
schema marker before `0.12.31/task-evidence-current-projection` was detected.
That produced schema 12 with an empty `task_evidence_current` table. The
migration now uses its own applied ledger record as the proof that its data
backfill ran, rather than treating the physical schema number as proof of a
completed data transformation.

The regression test reproduces the ordering precisely: apply the database
creation migration first, confirm the current table is empty, then apply the
evidence migration and confirm the compact row is populated. The installed
artifact was rebuilt and applied to Narrative Harness, Looma + Knit, Jess, and
Fair Labor License. Their current-evidence row counts are 7, 43, 1, and 1;
the largest individual current payload remains below the 64 KiB per-task
bound. This is the kind of proof required for future schema changes: a schema
marker alone is not allowed to stand in for a completed projection backfill.

**Contract Touch Decision - `codex:task-evidence-migration-order-2026-07-15`**

- **Touched contracts:** built-in migration detection and the migration ledger
  as evidence of a completed data backfill.
- **Considered but not touched:** task evidence JSONL shape, current row shape,
  queue ownership, and history retention.
- **Required follow-up:** make future data migrations declare their own
  completion predicate or ledger-owned idempotence test instead of relying on
  a shared schema marker.
- **Proof provided:** full migrations test file passes (29 tests); all four
  installed project databases contain populated current-evidence rows after
  migration.
- **Apply/revert:** rerunning the migration is a no-op after its ledger record;
  reverting the detector does not delete current rows or raw history.

## Durable Memory Write Boundary - 2026-07-15

The memory event input may contain `content.text` or `content.json` because a
live caller may have richer material available. That does not make those
fields part of durable project memory. Before this change, `recordMemoryEvent`
spread the entire input into a JSONL event, creating another copy of task and
diagnostic payloads beside the task evidence and project database.

The persisted memory event is now schema version 2 and contains only the
bounded essential summary, source/provenance, metadata, and identity. Each
memory stream is also capped at 256 KiB at its write boundary. The reader
normalizes older event lines into the compact shape, so old data remains
compatible without keeping raw fields in ordinary retrieval results.

This is the first write-side guardrail for the memory layer. It does not claim
that a deterministic string clip is equivalent to a future micro-LLM summary;
the upstream caller still owns the meaning of `summary`. The durable boundary
prevents raw material from becoming a second permanent copy, and a later
explicit memory migration can re-summarize or remove old raw fields once all
readers have been audited.

**Contract Touch Decision - `codex:durable-memory-write-boundary-2026-07-15`**

- **Touched contracts:** durable memory event JSONL shape, memory retrieval
  result shape, and per-stream byte retention.
- **Considered but not touched:** task evidence JSONL, context-debug
  diagnostics, Mastra storage, memory model selection, and task titles.
- **Required follow-up:** audit every memory reader for assumptions about raw
  `text`/`json`; add an explicit historical migration after compatibility
  coverage proves those fields are no longer needed.
- **Proof provided:** memory-core tests prove schema-version-2 writes omit raw
  fields, old-shaped reads normalize to summaries, long summaries are bounded,
  and a stream stays under 256 KiB after repeated writes.
- **Apply/revert:** new writes use the compact shape immediately; existing
  files are read compatibly and are not rewritten or deleted by this change.

**Schema Migration Decision - `memory-event-v2-essential-summary`**

- **Persisted schema touched:** system-local memory JSONL event records.
- **Scope:** per-project/per-task memory streams under the system-local data
  directory; no repository-local files are changed.
- **Change class:** forward-compatible writer contract plus compatibility
  reader, with a bounded write-time history window.
- **Existing data impact:** none yet. Existing raw fields remain on disk until
  a separate migration proves all historical readers have moved to the compact
  event shape.
- **Compatibility reader:** `readMemoryEvents` returns schema-version-2
  compact events for both old and new lines.
- **Rollback/revert:** restore the old writer only if a verified consumer needs
  raw fields; no data deletion is required to revert.

## Durable Task Evidence Boundary - 2026-07-15

The task evidence ledger was not merely large; it was duplicating diagnostic
material into two authorities. A single failed gate could put a 225 KB command
transcript in `gate-results.jsonl` and copy the same payload into SQLite's
`task_proof` row. Long reviewer reasoning and agent notes had the same shape at
smaller scale. That made a historical detail store behave like a project-state
payload and made current-state writes expensive.

The durable boundary is now explicit and shared in `src/core/task-runtime.ts`:
`compactTaskEvidenceEvent` is applied before both JSONL and SQLite writes. It
retains the fields needed to identify and interpret evidence, bounds long text
by field, bounds nested values and arrays, and has a final 12 KiB payload
ceiling. Full command output is not a project fact; the durable record stores a
bounded excerpt and an explicit marker that the diagnostic text was not
retained. The caller still receives its original in-memory event, so a live
operation can report its result without making that report permanent state.

Existing projects are handled by the explicit project-state compaction path,
which now compacts legacy JSONL evidence and the `task_proof` /
`task_evidence_current` SQLite rows together. This is a content migration that
preserves each valid event as an essential bounded event; it is not orphan
pruning and it does not pretend that a file-size cap fixes an authority bug.
Malformed historical lines are left for forensic handling rather than silently
deleted.

**Contract Touch Decision - `codex:durable-task-evidence-boundary-2026-07-15`**

- **Touched contracts:** durable `TaskEvidenceEvent.payload` write semantics,
  SQLite latest-proof/current projections, and project-state compaction output.
- **Considered but not touched:** task status transitions, gate result shape,
  reviewer verdict meaning, task titles, and raw live command execution.
- **Required follow-up:** move ordinary current-state consumers from full
  history-backed effective-task expansion to the current projection; add a
  separate opt-in diagnostic store only if a real user workflow proves raw
  output is needed.
- **Proof provided:** six task-state tests and nine project-state-compaction
  tests pass; the new test writes a large gate failure and proves both JSONL
  and SQLite receive only the bounded payload.
- **Apply/revert:** new writes are bounded immediately; the explicit
  compaction command rewrites existing valid events atomically. Reverting the
  writer does not restore discarded diagnostics, which is intentional because
  those diagnostics were never part of the durable project-state contract.

**Schema Migration Decision - `task-evidence-essential-history-v1`**

- **Persisted schema touched:** task evidence JSONL payloads and existing
  SQLite `task_proof` / `task_evidence_current` payload JSON; no new database
  table is required.
- **Scope:** system-local task history and project-state database only.
- **Change class:** write-boundary contract plus explicit in-place content
  migration; no status or hierarchy migration.
- **Existing data impact:** valid historical records are transformed into
  bounded essential records; malformed lines remain untouched. The command
  reports bytes and record counts before and after.
- **Compatibility reader:** `readTaskEvidence` accepts both old and bounded
  records, while current reads continue using the SQLite projection.
- **Fixtures/tests:** task-state write-boundary, project-state compaction, and
  targeted TypeScript checks cover new and old evidence.
- **Rollback/revert:** the source change is reversible, but discarded raw
  diagnostic text is not reconstructed. Run the migration only after its
  before/after report is reviewed; no automatic historical rewrite occurs on a
  normal GET or project open.

## Real-Project Evidence - 2026-07-15

The explicit evidence migration was dry-run audited and then applied to
Narrative Harness, Looma + Knit, Jess, and Fair Labor License. The dry-run
reports were:

- Narrative Harness: 342 records compacted, task evidence `2,284,902 ->
  1,879,575` bytes; SQLite evidence `126,106 -> 99,156` bytes.
- Looma + Knit: 13 records compacted, task evidence `1,769,037 ->
  1,504,282` bytes; SQLite evidence `349,083 -> 342,931` bytes.
- Jess: no oversized evidence records.
- Fair Labor License: 7 records compacted, task evidence `29,977 -> 27,730`
  bytes.

The remaining project-history weight is now visibly elsewhere: migration
snapshots and evacuated repo-state copies, full codebase-map snapshots,
progress copies, task review packets/archive evidence, and the large global
population of old unregistered project-history directories. Those are not
being silently deleted under the label "cleanup." They are the next storage
model audit: recovery artifacts need a bounded, manifest-backed lifecycle, and
ephemeral/unregistered project runs need an explicit storage namespace and
retention policy instead of accumulating as if they were active projects.

Installed API proof after the migration (`stale:false`): compact project
routes remained 8-41 ms and 13-24 KB, release summary 17 ms / 934 bytes,
detail 54 ms / 20 KB. The explicit diagnostic route remained 0.61 s / 639 KB,
  which is acceptable only because it is opt-in and not part of fleet/project
  initial loading.

## SQLite Physical Reclamation Boundary - 2026-07-15

The evidence migration exposed a second data-layer distinction: compacting a
row changes logical content, but SQLite keeps the freed pages in the database
file for reuse. That is correct for SQLite's normal operation, but it means a
one-time migration can report smaller payloads while the project still pays
the old file-size cost. The current-state database is the right engine for
small indexed reads; it needs an explicit maintenance boundary after a
content migration, not request-time vacuuming.

`vacuumProjectStateDatabase` now runs only from the explicit project-state
compaction path, after evidence compaction has closed its transaction. Dry
runs report the current physical size without pretending to predict the
result. Applied runs record before/after file bytes and the fact that vacuum
ran. Ordinary project reads never open a missing database, create one, or
vacuum one.

**Contract Touch Decision - `codex:sqlite-physical-reclamation-2026-07-15`**

- **Touched contracts:** explicit compaction metrics and SQLite maintenance
  lifecycle.
- **Considered but not touched:** project summary shape, task/release schema,
  evidence meaning, and normal read routes.
- **Required follow-up:** measure physical database bytes after the four-real-
  project migration and keep recovery artifacts out of the current database.
- **Proof provided:** the database test creates and deletes large temporary
  rows, proves dry-run non-mutation, then proves the explicit vacuum reclaims
  physical pages. The focused database and compaction suites pass.
- **Apply/revert:** the maintenance operation is explicit and idempotent;
  removing the call leaves logical state intact and only restores SQLite's
  reusable free pages.

**Schema Migration Decision - `0.12.32/sqlite-physical-reclamation`**

- **Persisted schema touched:** no schema or row shape; only the physical
  SQLite file layout is reclaimed after an explicit migration.
- **Change class:** storage maintenance, not a data-model rewrite.
- **Existing data impact:** none beyond SQLite's own page reclamation; rows
  and indexes remain unchanged.
- **Compatibility reader:** all existing readers are unchanged.
- **Fixtures/tests:** `src/sessions/__tests__/project-state-database.test.ts`
  covers the dry-run and physical-size postconditions.
- **Rollback:** stop invoking the explicit vacuum; no data restore is needed.

## Initial Task Detail Read Model - 2026-07-15

The project shell and Work/Map inventory were already projection-backed, but
the first task drawer still called the rich `buildEffectiveTask` path. That
made a normal click on a task replay its complete evidence ledger even though
the response explicitly omitted history and linked to separate history,
review, evidence, and diagnostic endpoints.

The initial drawer now requests `evidence: 'current'`. It uses the SQLite
current evidence projection for the status facts needed to orient the user;
historical evidence remains behind the explicit detail routes. This removes a
contradictory boundary where the API claimed history was deferred while the
server loaded it before returning the drawer. The explicit evidence, review,
and history routes remain history-backed because they are genuinely detail
reads.

**Contract Touch Decision - `codex:task-drawer-current-read-2026-07-15`**

- **Touched contracts:** initial task-detail read behavior and its current
  evidence dependency.
- **Considered but not touched:** explicit evidence, review, history, file,
  context, transcript, and Git Story routes.
- **Required follow-up:** prove the same current-vs-history split for remaining
  project current-state consumers before compacting historical ledgers.
- **Proof provided:** focused task-detail and read-boundary tests pass for the
  initial drawer, and the current effective-task tests prove the raw evidence
  directory may be absent for current reads.
- **Apply/revert:** revert the single route to `evidence: 'full'` if a missing
  current projection is found; no persisted data changes are required.

**Schema Migration Decision - `0.12.33/task-drawer-current-read`**

- **Persisted schema touched:** none; the route consumes the existing schema
  12 current evidence projection.
- **Change class:** read-model consumer migration.
- **Existing data impact:** none.
- **Compatibility reader:** legacy projects continue through the existing
  compatibility path when no database authority/current projection exists.
- **Fixtures/tests:** initial drawer, history, and current effective-task
  tests cover the split.
- **Rollback:** route-only rollback to the rich reader.

## Current Inbox Read Model - 2026-07-15

The project shell no longer reconstructs every project, but opening a project
still loaded `/api/project/inbox` in the page shell. That endpoint was doing a
full `buildEffectiveTasks` expansion before returning a small list of owner
actions. This was a remaining ordinary-read violation: a compact inbox card
was paying for historical task evidence and runtime overlay replay.

The current task row now stores only the inbox facts needed to classify work:
whether it came from workspace import, whether its brief exists/is shaped/is
approved, how many acceptance criteria it has, and a bounded task-readiness
classification. The database-backed inbox reads those indexed rows directly.
The full effective-task path remains only for legacy projects that have not
crossed database authority. The inbox wizard receives count/boolean facts, not
synthetic task prose or the full task definition.

`0.12.34/task-current-inbox-summary` backfills the new summary shape from the
revision-matched detail store for existing database projects. It does not
rewrite task history, copy transcripts, or make the inbox an authority for
task state.

**Contract Touch Decision - `codex:task-current-inbox-summary-2026-07-15`**

- **Touched contracts:** the compact task summary row and the ordinary project
  inbox read path.
- **Considered but not touched:** task titles/descriptions, task hierarchy,
  task evidence history, review routes, and explicit inbox detail actions.
- **Required follow-up:** run the migration against the four calibration
  projects, measure inbox response timing, and move the remaining ordinary
  Thread/fleet-attention read paths to current projections.
- **Proof required:** the inbox must produce the same shaping/proof alerts
  from current summary rows as the legacy fixture path, while the server route
  must stop calling `buildEffectiveTasks` for database-authoritative projects.
- **Apply/revert:** the migration is additive to `summary_json`; rollback can
  remove the current-summary fields and restore the legacy inbox reader without
  deleting task definitions or history.

**Schema Migration Decision - `0.12.34/task-current-inbox-summary`**

- **Persisted schema touched:** `work_items.summary_json`; the database schema
  marker advances to 13 so old projects receive the current inbox facts.
- **Scope:** project current-state database only.
- **Change class:** additive current-read projection; no authority or task
  meaning changes.
- **Existing data impact:** one bounded summary object per task is rebuilt from
  the existing revision-matched detail store. No history is rewritten.
- **Compatibility reader:** legacy projects still use their existing effective
  task path until this migration is applied.
- **Fixtures/tests:** project-state database tests cover the stored summary;
  inbox fixtures cover the classification path; the migration is registered in
  the built-in idempotence evidence map.
- **Rollback/revert:** ignore the additive fields and use the legacy reader;
  the detail store and evidence ledger remain intact.

## Essential Current Evidence - 2026-07-15

The first current-evidence projection was still too much like a shortened
ledger: it retained up to 16 records per kind and allowed a 64 KiB per-task
row. On real Looma + Knit data, 43 rows occupied about 319 KiB, mostly old
escalation and note bodies that ordinary status reads did not need. That is a
data-model failure, not a vacuum problem.

Schema 14 changes the current projection into an essential digest. It keeps
the newest useful records by kind, deduplicated by their current identity, with
smaller limits for notes/events/merge records and bounded latest records for
proofs, reviews, escalations, and issues. Each payload is limited to 2 KiB and
each task's complete current-evidence row is limited to 12 KiB. The historical
JSONL evidence remains the detail source and is not rewritten or deleted.

`0.12.35/task-essential-current-evidence` performs this conversion for
existing database-authoritative projects and vacuums only after the content
change. Future writes apply the same digest policy at the SQLite boundary, so
the projection cannot grow back into a second history ledger.

**Contract Touch Decision - `codex:task-essential-current-evidence-2026-07-15`**

- **Touched contracts:** SQLite schema 14, current evidence projection shape,
  current effective-task reader, and the project-state compaction boundary.
- **Considered but not touched:** historical evidence JSONL, rich task detail,
  task titles/descriptions, review routes, and transcript retention.
- **Required follow-up:** move any remaining ordinary reader that needs more
  than this digest to an explicit detail/history endpoint; do not expand this
  projection to satisfy a rich view.
- **Proof provided:** project-state database and migration tests cover
  oversized rows, per-kind deduplication, bounded payloads, and schema 14;
  the installed migration has been applied to Narrative Harness, Looma +
  Knit, Jess, and Fair Labor License.
- **Apply/revert:** the migration is idempotent and additive to history;
  rollback can restore the prior current-reader policy from the untouched
  evidence ledger, but must not silently reintroduce the ledger-shaped row.

**Schema Migration Decision - `0.12.35/task-essential-current-evidence`**

- **Persisted schema touched:** `task_evidence_current` payload policy and
  schema marker 14.
- **Scope:** project-local current-state database only.
- **Change class:** bounded current-read projection migration.
- **Existing data impact:** current rows are deduplicated and reduced; the
  historical evidence source is preserved byte-for-byte.
- **Compatibility reader:** rich evidence readers still use the historical
  ledger; current readers use the essential digest.
- **Fixtures/tests:** 48 database and migration tests pass, including an
  oversized current-evidence row.
- **Rollback/revert:** stop using the digest for current reads and rebuild it
  from the history source; no historical record is deleted by this migration.

## Fleet Attention Read Boundary - 2026-07-15

`/api/fleet/attention` was an ordinary fleet read that rebuilt each project's
inbox and then loaded a full Thread projection for every registered project.
The fleet UI only displays attention items; it does not display Thread turns.
This made Thread history an invisible dependency of a fleet alert card and
created another path that could disagree with the project shell.

The route now uses the projection-backed service summary and the durable open
attention records for each project. It does no inbox, migration, Thread, or
history reconstruction. A service-start projector refreshes attention for
database-authoritative projects outside the request path; project inbox reads
remain a direct diagnostic/materialization path. Thread remains available
through the selected project's explicit Thread endpoint. This is a
read-boundary correction, not a loss of Thread data.

**Contract Touch Decision - `codex:fleet-attention-projection-read-2026-07-15`**

- **Touched contracts:** fleet attention's project summary source and its
  request-time work.
- **Considered but not touched:** inbox item semantics, Thread response shape,
  project Thread navigation, and historical Thread storage.
- **Required follow-up:** refresh the attention projection from every shared
  current-state write boundary, not only service startup and project inbox
  reads. Legacy projects must remain on their compatibility path until their
  database authority is explicit.
- **Proof required:** same visible groups and items after warmup, faster route
  timing, no Thread/inbox reconstruction in the fleet route, and explicit
  freshness behavior when a project has not yet materialized attention.
- **Apply/revert:** revert the route reader only; no project state or Thread
  history is changed.

## Current Scope Identity Boundary - 2026-07-15

The installed projection audit exposed a more serious issue than payload size:
Narrative Harness had seven live work items, while its approved workspace plan
still named an older task set. The old scope projection copied those stale IDs
into the selected release, classified every live item as deferred, and then
reported the empty release as complete. That is a broken authority boundary.

The current rule is now explicit. The work-item table owns live task identity.
An approved workspace plan may seed release membership only for task IDs that
exist in the live queue. Stale plan IDs are discarded from the projection; they
are not phantom work and do not become an implicit completion claim. When a
plan's task identities have all been replaced, live non-terminal work defaults
to the selected current release. Later scope still requires an explicit,
matching later assignment. This preserves the project rule that new work is
current unless it was deliberately segmented, while preventing an old intake
snapshot from controlling a new queue.

`0.12.36/project-summary-current-scope-authority` rebuilds the durable summary,
release definitions, and `work_scope` rows from that boundary. It is a
reconciliation migration: it rechecks after application so a later queue
refresh cannot leave stale release node IDs behind. It does not
rewrite task titles, task history, workspace prose, or evidence. The summary
projection version advances to 12 so old summaries cannot be treated as current.

**Contract Touch Decision - `codex:project-summary-current-scope-authority-2026-07-15`**

- **Touched contracts:** live queue identity, approved-plan-to-release projection,
  project summary release counts, and selected `work_scope` rows.
- **Considered but not touched:** task IDs, task definitions, workspace-goals
  history, evidence history, and release labels.
- **Required follow-up:** prove the same selected-release counts across API,
  Overview, Map, Work, and Releases for NH and Looma + Knit after migration.
- **Proof required:** stale plan IDs must never appear in current release node
  lists; replaced live work must not be deferred by an old plan; an empty
  selected scope must not be labeled complete; migration must be idempotent.
- **Apply/revert:** rerun the projection from the live queue and untouched
  workspace/history records. Reverting the projection code must not restore
  phantom IDs or delete the underlying records.

**Schema Migration Decision - `0.12.36/project-summary-current-scope-authority`**

- **Persisted schema touched:** project-summary projection version 12 and the
  existing `scopes`/`work_scope` current read models; no new table is added.
- **Scope:** project-local current-state database.
- **Change class:** authority-boundary correction and projection rebuild.
- **Existing data impact:** current summary/scope rows are recalculated from
  live work identities; task/history/evidence payloads are unchanged.
- **Compatibility reader:** legacy queue readers remain available for projects
  without database authority; version-11 summaries are stale until rebuilt.
- **Fixtures/tests:** projection tests cover fully stale plan identities and
  explicit queue-owned membership; migration idempotence is registered.
- **Rollback/revert:** rebuild from the live queue and approved plan under the
  prior reader only if needed; do not restore stale node IDs as authoritative.

## Authority-Aware Evacuation Restore - 2026-07-15

The first installed migration status check exposed a second authority bug.
The 0.10 evacuation migrations were still comparing the retained evacuation
copy with `project-state/TASKS.json`, even after the 0.12 single-authority
boundary intentionally removed that compatibility file. Every ordinary
migration run could therefore rediscover the same historical evacuation and
reapply restore work. That was repeated data churn, not useful recovery.

The restore reader now compares against the database queue whenever the
database exists, while retaining the JSON reader for legacy projects. A later
evacuation batch can still be imported through the existing write boundary and
will refresh the database summary; a retained evacuation copy by itself is
not treated as unfinished work. The evacuation evidence remains available for
explicit recovery and is not deleted as a cosmetic fix.

**Contract Touch Decision - `codex:authority-aware-evacuation-restore-2026-07-15`**

- **Touched contracts:** evacuation restore target selection and migration
  idempotence after database authority promotion.
- **Considered but not touched:** evacuation manifest retention, task history,
  archive deletion, database schema, and current task identity semantics.
- **Required follow-up:** split the remaining shared restore detector into
  task-restore, shaped-task, and archive-shaped-task signals so one missing
  category does not make three migrations appear blocked.
- **Proof required:** a database-authoritative project with no `TASKS.json`
  must not rediscover a completed evacuation; a genuinely later evacuated task
  must be imported once and then become clean.
- **Apply/revert:** restore reads the database queue or legacy queue according
  to the existing authority boundary. No evacuation material is deleted.

**Schema Migration Decision - authority-aware restore**

- **Persisted schema touched:** none. This changes migration detection and
  chooses the existing database queue as the restore target.
- **Scope:** project migration behavior for database-authoritative projects.
- **Change class:** compatibility reader and idempotence correction.
- **Existing data impact:** none for already-clean projects; a real later
  evacuation batch is merged through the existing queue write projection.
- **Compatibility reader:** legacy projects continue to read `TASKS.json`.
- **Fixtures/tests:** migration tests cover a removed compatibility file, a
  genuinely late evacuation batch, and the clean second run.
- **Rollback/revert:** restore the previous reader only for a legacy-only
  compatibility rollback; do not reintroduce `TASKS.json` as a second writer.

## Compact Summary and Orientation Boundary - 2026-07-15

The project shell and the project map answer different read questions. The
shell needs counts, action, readiness, release membership, and a short
description for fleet and Projects. The map needs the orientation tree and
source trail. Keeping both in one JSON payload made every shell read carry map
detail, even when the user never opened Map.

`0.12.37/project-summary-orientation-store` therefore keeps one projection
authority but separates its storage fields: `project_summary` owns the compact
current summary and `project_orientation` owns the current orientation/map
payload. The two rows are written in the same SQLite transaction and share the
same revision. This is one current-state model with two read shapes, not a
second project model or another source of truth. The full reader reattaches the
orientation for Map and existing detail routes; shell readers explicitly omit
it without querying or parsing the orientation row.

**Contract Touch Decision - `codex:project-summary-orientation-store-2026-07-15`**

- **Touched contracts:** project-state database schema version 15, compact
  summary serialization, orientation/map read shape, and fleet/project-shell
  read boundary.
- **Considered but not touched:** task identity, task detail, release
  membership, evidence history, Thread history, and UI-level project fields.
- **Required follow-up:** make attention and summary refreshes happen at the
  enclosing mutation boundary, then add cross-route state-agreement proof.
- **Proof required:** old inline orientation migrates without changing queue or
  history; full readers preserve Map behavior; shell readers omit orientation;
  the migration is idempotent; four real projects load through the installed
  service with `stale:false`.
- **Apply/revert:** migration reuses the canonical summary writer and only
  moves the current projection payload. Reverting code can read the split row
  through the compatibility full reader; it must not duplicate the map into a
  new writer or rewrite task/history records.

**Schema Migration Decision - `0.12.37/project-summary-orientation-store`**

- **Persisted schema touched:** adds `project_orientation` and advances the
  project-state database schema from 14 to 15; removes `orientationSpine` from
  the compact `project_summary` payload.
- **Scope:** project-local current-state database only.
- **Change class:** current read-model decomposition and payload boundary.
- **Existing data impact:** current orientation is moved from the summary row
  into the dedicated row; task queue, task detail, evidence, and history are
  untouched.
- **Migration id:** `0.12.37/project-summary-orientation-store`.
- **Compatibility reader:** full summary reads reattach the dedicated
  orientation row; legacy inline summaries remain readable until migration.
- **Fixtures/tests:** database storage, migration idempotence, and full/shell
  projection tests; installed proof covers Narrative Harness, Looma + Knit,
  Jess, and Fair Labor License.
- **Owner-facing plan text:** this is a performance and authority-boundary
  change, not a new user-visible planning concept.
- **Rollback/revert:** rerun the canonical writer from the existing current
  state. Do not restore compatibility files or copy orientation into another
  long-lived payload.

## Ephemeral Project Storage Boundary - 2026-07-15

The global project cache had accumulated approximately 52,633 directories and
135,633 files, totaling about 3.6 GB. The dominant names were temporary
benchmark, test, worktree, and fixture roots. This was not a reason to make a
janitor more aggressive: the placement rule itself promoted ephemeral roots to
the durable user cache.

The storage boundary now treats a project root under the operating system temp
directory as ephemeral when no explicit `GUILDHALL_DATA_DIR` is configured.
Its local history is placed under an OS-temp `guildhall-projects` root, where
normal OS cleanup and the owning run can dispose of it. Explicit data-dir
configuration still wins for tests, containers, and callers that deliberately
want deterministic persistence. Registered real workspaces remain in the
durable user project cache.

This is a placement rule, not a deletion pass. Existing cache entries are
untouched until a later manifest-backed cleanup can prove their ownership and
last-use state. New test/benchmark activity must stop adding durable project
directories before cleanup is considered safe.

**Contract Touch Decision - `codex:ephemeral-project-storage-boundary-2026-07-15`**

- **Touched contracts:** local-history placement for temporary project roots;
  durable cache growth boundary.
- **Considered but not touched:** project identity hashing, registered-workspace
  records, current-state SQLite schema, task/history retention, and existing
  cache contents.
- **Required follow-up:** add an ownership/lease manifest for durable cache
  entries and a read-only census plus explicitly authorized cleanup command.
- **Proof required:** reads do not create directories; unconfigured temp roots
  resolve outside the durable cache; explicit `GUILDHALL_DATA_DIR` remains
  deterministic; real registered projects keep their current placement.
- **Apply/revert:** placement is selected at the storage boundary. Reverting
  returns future temp writes to the previous location but does not delete or
  rewrite existing state.

**Schema Migration Decision - ephemeral placement**

- **Persisted schema touched:** none. This is a storage-placement contract,
  not a project-state schema migration.
- **Scope:** process-local history root selection for ephemeral project roots.
- **Change class:** lifecycle/ownership boundary.
- **Existing data impact:** none; the existing 3.6 GB cache is intentionally
  not pruned by this change.
- **Compatibility reader:** explicit `GUILDHALL_DATA_DIR` continues to route
  all project roots to the configured directory.
- **Fixtures/tests:** local-history tests cover non-allocating reads, explicit
  placement, and unconfigured temporary placement.
- **Rollback/revert:** revert the placement helper only; do not infer that
  reverting placement authorizes deletion of old cache entries.

## Attention Projection Write Boundary - 2026-07-15

Attention records are a current projection of already-computed Inbox items.
They are not allowed to discover Inbox state, replay task history, scan Git, or
invoke a model. `attention-projection.ts` now exposes that boundary explicitly:
`previewAttentionProjection` is read-only, while
`materializeAttentionProjection` is the named durable write. The existing
project Inbox builder uses the appropriate operation, and the migration POST
route refreshes attention after a successful migration write.

This is deliberately an integration step rather than a claim that every
mutation already calls the writer. The remaining write sites must be routed
through the same boundary or must mark the projection honestly stale. The
startup warmup remains a compatibility backstop, not the desired source of
freshness.

**Contract Touch Decision - `codex:attention-projection-write-boundary-2026-07-15`**

- **Touched contracts:** attention projection read versus materialize behavior,
  migration-write refresh behavior, and the shared Inbox-to-attention shape.
- **Considered but not touched:** Inbox discovery, task status authority,
  migration semantics, attention schema, and historical retention.
- **Required follow-up:** wire task/release/evidence/execution/repository
  mutation tails to the same materialize or stale-mark contract.
- **Proof required:** preview creates no database or attention row; materialize
  is idempotent; an empty computed Inbox resolves prior open records; migration
  writes refresh attention before the response returns.
- **Apply/revert:** the helper delegates to the existing attention writer and
  does not add a table. Reverting the integration leaves the prior startup
  warmup behavior; it must not create a second attention store.

**Schema Migration Decision - attention projection boundary**

- **Persisted schema touched:** none. Existing `attention_records` storage is
  reused unchanged.
- **Scope:** runtime write/read boundary only.
- **Change class:** authority and mutation-boundary clarification.
- **Existing data impact:** none except explicit refreshes reconcile existing
  records using the established identity and resolution rules.
- **Compatibility reader:** fleet reads continue to read the durable attention
  table; ordinary Inbox reads remain pure previews.
- **Fixtures/tests:** dedicated attention projection tests cover preview,
  materialize, idempotence, and resolution; installed migration proof remains
  required for real-project state agreement.
- **Rollback/revert:** remove the helper call sites while retaining the
  existing attention table and records.

## Cache Ownership and Census Boundary - 2026-07-15

The first cache census confirms the scale and the uncertainty separately:
`/Users/matthew/.guildhall/data/projects` is about 3.6 GB across 52,633
directories and 135,633 files; only seven entries are currently registered
durable workspaces, while 52,626 are unregistered unknown entries. That is
not evidence that 52,626 entries are disposable. It is evidence that the old
path-based storage model recorded no ownership or lifecycle contract.

The new registry records durable workspace ownership separately from
ephemeral run leases. Service startup registers known workspaces at an
explicit lifecycle boundary. A read-only `guildhall cache census` reports
`durable-registered`, `ephemeral-active`, `ephemeral-stale`, and
`unregistered-unknown`. The census has no delete mode and every entry reports
`deletion: not-authorized`. This makes the old cache inspectable without
turning uncertainty into data loss.

Temporary project roots now also resolve to an OS-temporary history root when
no explicit data directory is configured, so new tests and benchmarks stop
adding durable cache entries. Existing entries remain untouched until their
ownership and retention can be reconstructed or the user explicitly authorizes
an export-and-delete operation.

**Contract Touch Decision - `codex:project-cache-ownership-2026-07-15`**

- **Touched contracts:** cache lifecycle ownership, temporary placement, and
  the read-only census classification vocabulary.
- **Considered but not touched:** project identity hashing, project-local
  current-state SQLite tables, task/history records, and existing cache
  contents.
- **Required follow-up:** integrate leases with explicit benchmark/run
  lifecycles; add an evidence-backed export and separately authorized cleanup
  flow only after a census review.
- **Proof required:** service startup registers durable workspaces; temporary
  roots do not enter the durable cache; census is read-only; no unknown entry
  is marked safe to delete.
- **Apply/revert:** registry writes are additive and atomic. Reverting the
  integration stops new registrations but must not delete registry or cache
  records.

**Schema Migration Decision - `codex:project-cache-registry-v1`**

- **Persisted schema touched:** new global
  `data/project-cache-registry.json`; no project-state database schema.
- **Scope:** global cache ownership metadata and ephemeral run leases.
- **Change class:** new additive lifecycle schema, not a current project fact.
- **Existing data impact:** none. Existing cache entries remain unknown until
  independently classified; no implicit backfill or deletion is performed.
- **Migration id:** none; the registry is created lazily on the first explicit
  workspace registration or lease write.
- **Compatibility reader:** missing registry reads as empty; invalid versions
  fail closed for cleanup and are reported by census.
- **Fixtures/tests:** five registry tests cover ownership, leases, stale
  classification, read-only census, and empty-root non-allocation; installed
  proof reports seven durable registrations and 52,626 unknown entries.
- **Owner-facing plan text:** this is a guardrail for storage ownership, not a
  new project-planning concept.
- **Rollback/revert:** stop registry writes; retain the file and all caches for
  manual review. No rollback path authorizes deletion.

## Shared Projection Invalidation and Background Refresh - 2026-07-15

The write-boundary audit found that the data stores already knew when current
state became stale, but the signal stopped at the storage layer. Route-specific
refreshes and service startup therefore carried too much responsibility. A
new process-local invalidation bus now sits beside the existing stale marker:
database current-state writers emit one event after their SQLite transaction
has committed, and legacy/runtime/evidence writers use the same marker.

The service subscribes once, coalesces events per project for 150 ms, and
refreshes the durable project summary and attention projection in the
background. Fleet and project GETs do not subscribe, repair, scan, or rebuild;
they only read the stored projection. Startup warmup uses the same refresh
function, so it is now an initial materialization path rather than a second
projection algorithm.

This is intentionally a signal, not a second state store. The authoritative
write still commits first. The projection worker can fail without failing the
authoritative write; the summary remains visibly stale and a later write or
startup refresh retries it.

**Contract Touch Decision - `codex:project-summary-invalidation-2026-07-15`**

- **Touched contracts:** shared summary invalidation event, post-commit
  delivery timing, per-project refresh coalescing, and stale-on-failure
  behavior.
- **Considered but not touched:** task/evidence/release schemas, projection
  payload shape, request handlers, and historical retention.
- **Required follow-up:** measure refresh cost under high-frequency agent
  events; if queue materialization is still too expensive, build the summary
  from indexed current-state rows rather than adding more request-time repair.
- **Proof required:** event delivery occurs after the current call stack;
  listeners can unsubscribe; targeted writer tests remain green; installed
  service refreshes after a current-state write without a GET-triggered repair.
- **Apply/revert:** removing the subscriber leaves stale marking intact and
  does not change authoritative state; no second projection writer may be
  introduced as a rollback.

**Schema Migration Decision - `codex:project-summary-invalidation-2026-07-15`**

- **Persisted schema touched:** none. This is an in-process write-boundary
  signal over existing SQLite and JSON projection records.
- **Scope:** session/runtime coordination only.
- **Change class:** synchronization behavior, not a durable data shape.
- **Existing data impact:** none; existing stale/current values remain valid.
- **Migration id:** none.
- **Compatibility reader:** all existing readers continue to honor the stored
  `freshness` value; projects without a subscriber remain honestly stale.
- **Fixtures/tests:** invalidation bus timing/unsubscribe tests plus the
  project-state database, local-history, attention, and serve-boundary suites.
- **Owner-facing plan text:** this removes route-specific projection repair;
  it does not create an autonomous owner or bypass approval.
- **Rollback/revert:** unsubscribe the service listener; retain stale marking
  and all existing projections.

## Current-State Mutation Domains - 2026-07-15

The first invalidation seam carried only a project path and a free-form reason.
That was enough to prove delivery, but not enough to govern the model: a
revision change caused by availability, task runtime, proof, or reconciliation
was indistinguishable to the projection worker. The write audit also found
that availability and reconciliation rows were being committed without
advancing the project revision or notifying the refresh boundary.

The invalidation contract now carries the committed revision and a small
closed vocabulary of changed domains. The vocabulary is diagnostic and
refresh-routing metadata, not another persisted hierarchy. It lets the next
projection pass choose the smallest valid rebuild and lets tests prove that a
writer actually published the state it changed.

Availability and reconciliation writes now advance the same project revision
as the other authoritative current-state writes and emit after their SQLite
transaction commits. Availability conservatively invalidates the summary;
reconciliation advances the summary watermark without marking its payload
stale, because reconciliation only changes the attention projection.
Attention records remain a derived projection and do not emit their own
refresh event; otherwise materializing Inbox would recursively schedule itself.
A reconciliation event refreshes attention only, while the project summary
remains one revisioned current-state read model.

**Contract Touch Decision - `codex:project-state-mutation-domains-2026-07-15`**

- **Touched contracts:** in-process invalidation event shape, mutation-domain
  vocabulary, availability/reconciliation write publication, and scheduler
  event transport.
- **Considered but not touched:** task identity, release semantics, SQLite
  table shape, attention record schema, and historical retention.
- **Required follow-up:** use domain dependencies to select summary versus
  attention refresh work; add a durable cross-process freshness check for CLI
  and MCP writers.
- **Proof required:** database writers publish the new revision and domain
  after commit; the scheduler coalesces events without dropping projects; the
  installed service remains fresh after startup and route reads.
- **Apply/revert behavior:** removing the domain metadata leaves the existing
  stale marker and path-based invalidation behavior intact. It does not alter
  authoritative rows or delete any history.

**Schema Migration Decision - `codex:project-state-mutation-domains-2026-07-15`**

- **Persisted schema touched:** none. The existing `project_meta.revision` is
  reused; domains and delivery metadata are process-local.
- **Change class:** write-boundary synchronization contract.
- **Existing data impact:** none; no rows or history are rewritten.
- **Migration id:** none.
- **Compatibility reader:** readers continue to use the stored revision and
  freshness fields; older writers remain visible as stale through the existing
  compatibility marker.
- **Fixtures/tests:** invalidation, scheduler, and project-state database
  tests cover revision/domain publication and post-transaction delivery.
- **Owner-facing plan text:** this closes a state-synchronization hole; it does
  not grant Guildhall authority to bypass owner approval.
- **Rollback/revert:** remove domain metadata and retain the existing revision
  and stale-marker behavior.

## Cross-Process Projection Freshness - 2026-07-15

The in-process invalidation bus cannot receive writes made by a separate CLI,
MCP, coordinator, migration, or test process. That is an optimization gap, not
a reason to make every GET reconstruct state. The durable SQLite revision and
summary freshness already contain the information needed to detect the gap.

The service now has a bounded background watcher that reads only project
metadata and the summary watermark for registered workspaces. It compares the
last observed revision/freshness pair and schedules the normal coalesced
projection refresh when another process advances or invalidates a project.
The first sample establishes a baseline; it does not write or schedule work.
The watcher is lifecycle-owned by the service, uses an unref'd interval, and
is disposed during shutdown. Unknown external domains are deliberately routed
through the full refresh until their dependency is known.

This closes the cross-process synchronization hole without adding a second
event ledger, touching task history, or putting a repair in a request path.

**Contract Touch Decision - `codex:cross-process-projection-freshness-2026-07-15`**

- **Touched contracts:** compact project metadata read shape, service-owned
  freshness polling, and cross-process refresh scheduling.
- **Considered but not touched:** task/evidence schema, event history, cache
  cleanup, route payloads, and LLM/model behavior.
- **Required follow-up:** measure watcher overhead with a larger registered
  fleet and add a real separate-process mutation proof.
- **Proof required:** metadata reads do not allocate or repair; the first poll
  only baselines; an external revision or stale marker schedules one refresh;
  disposal stops polling; installed service remains fast and current.
- **Apply/revert behavior:** disabling the watcher leaves the durable stale
  marker and in-process bus intact. It does not change authoritative state.

**Schema Migration Decision - `codex:cross-process-projection-freshness-2026-07-15`**

- **Persisted schema touched:** none. Existing `project_meta.revision` and
  `project_summary.freshness/revision` are read as a compact watermark.
- **Change class:** cross-process synchronization and lifecycle behavior.
- **Existing data impact:** none.
- **Migration id:** none.
- **Compatibility reader:** old databases without a summary row simply do not
  produce a watcher event until their normal migration/materialization path.
- **Fixtures/tests:** metadata-read, watcher-baseline/change/disposal, and
  installed route/freshness tests.
- **Owner-facing plan text:** this lets Guildhall notice work from another
  process; it does not grant the service ownership or bypass owner approval.
- **Rollback/revert:** remove the watcher integration and retain all stored
  revision/freshness data.

## Overlay-aware current-state projection - 2026-07-15

The first background refresh implementation exposed a more serious correctness
problem: task-runtime, workspace, and evidence writers advanced the database
revision, but the refresh worker rebuilt from raw task definitions and then
marked the result current. That was faster than request-time reconstruction,
but it was not an honest projection.

The projection boundary now accepts two inputs with different ownership:

- the raw queue is retained as the detail-store input;
- a bounded set of current task facts, assembled from database overlays and
  current evidence, is used only to calculate counts, scope, readiness, the
  action model, and recent work.

This keeps the model small without smuggling runtime/evidence history back into
the task definition. It also makes the dependency explicit: an overlay write
cannot make a summary current unless the refresh actually reads the overlay.

MCP task reads and writes now cross the same canonical boundary. This is a
data-authority correction, not an MCP-specific workaround: external agents and
the dashboard must observe and mutate the same queue aggregate regardless of
whether a compatibility `TASKS.json` export exists.

The scheduler also re-reads the durable revision after refresh. If a separate
CLI, MCP, coordinator, or migration process committed during projection, the
newer revision is scheduled for one coalesced retry rather than being silently
overwritten by an older calculation.

**Contract Touch Decision - `codex:overlay-aware-current-projection-2026-07-15`**

- **Touched contracts:** projection calculation input, MCP queue read/write
  boundary, and post-refresh revision race handling.
- **Considered but not touched:** task identity, release membership, evidence
  ledger format, and project-state table schema.
- **Required follow-up:** prove a real mutation in a second process and finish
  routing every direct task writer through the same authority-aware boundary.
- **Proof required:** overlay-derived status is visible in the summary without
  polluting detail definitions; database-authoritative MCP reads work without a
  source queue file; a concurrent revision triggers a retry; installed fleet
  reads remain bounded.
- **Apply/revert behavior:** disabling overlay-aware calculation must leave the
  summary stale rather than claiming raw-definition truth is current. Removing
  the retry leaves the durable revision available for later refresh.

**Schema Migration Decision - `codex:overlay-aware-current-projection-2026-07-15`**

- **Persisted schema touched:** none. Existing `project_meta.revision`, task
  overlay tables, current evidence table, summary row, and detail store are
  reused.
- **Scope:** projection calculation and cross-process synchronization.
- **Change class:** derived-read-model correctness; no new authoritative fact.
- **Existing data impact:** none; raw definitions and historical evidence are
  preserved.
- **Migration id:** none.
- **Compatibility reader:** legacy projects continue to use their existing
  queue path until database authority is established; database projects use
  overlay/current-evidence reads.
- **Fixtures/tests:** projection separation, MCP database-only read, scheduler,
  watcher, summary, and installed fleet proofs.
- **Owner-facing plan text:** this makes the compact project state agree with
  current work without exposing the underlying history payload.
- **Rollback/revert:** retain the current detail store and mark summaries stale
  if a correct overlay projection cannot be produced; never fall back to a
  falsely current raw-only summary.

## Current verified position - 2026-07-15

The current-state layer is now materially healthier, but it is not finished:

- Current fleet reads are projection-backed and no longer wait for every
  project's full inbox, thread, Git Story, and history to build.
- The installed service proves 7/7 registered projects current with no loading
  cards; warm fleet shell reads are single-digit milliseconds on the current
  machine.
- Compact SQLite state for the four calibration projects is roughly 152-496 KB
  per database, with compressed queue detail roughly 0.5-17 KB. This is the
  data actually needed for current project state, not the whole history cache.
- The four project history roots are still roughly 2.4-17 MB, and the global
  cache is still about 3.6 GB. The history audit has not yet earned a deletion
  policy, so no “prune” command is being treated as a fix.
- Remaining gates before returning to Narrative Harness MVP execution are a
  real separate-process mutation proof, direct-writer inventory closure,
  essential-history retention/compaction at write time, and API/UI agreement
  tests across Projects, Overview, Map, Work, Releases, Activity, and task
  detail.

## Write-boundary retention and owner-input projection - 2026-07-15

This pass addresses the next layer of the data problem: even with compact
SQLite current state, historical stores can silently become the new source of
latency and disk growth if every append is permanent. The fix is a storage
contract, not a cleanup heuristic.

Generic persistence events are now bounded by placement. Active streams keep
the newest 512 events or 256 KB, archive streams keep the newest 5,000 events
or 5 MB, debug streams keep the newest 128 events or 256 KB, and ephemeral
streams keep the newest 64 events or 64 KB with a 24-hour age ceiling. Duplicate
event ids are idempotent. `listEvents` can return a bounded latest page, and
compaction rewrites the retained tail so old bytes do not remain in the event
file.

Task evidence uses the same principle with smaller domain-specific limits.
Notes and ordinary events retain at most 64 records/64 KB; gates, reviews,
adjudications, escalations, and agent issues retain at most 32 records/64 KB;
merge and Git Story records retain at most 16 records/32 KB. These are history
limits, not current-state limits: the latest bounded evidence still feeds the
SQLite current-evidence projection.

Owner input now has an explicit authority split. The JSON request and bounded
chat files are detail/history. SQLite `owner_inputs` is the compact open queue.
Each refresh replaces that queue in one transaction, so closed or cancelled
requests cannot linger as current blockers. The repair path uses the normal
task-write boundary and refreshes the same projection. A generic summary
freshness override exists only for this synchronization case: it restores
`current` if the summary was current before the owner-input replacement, while
preserving unrelated staleness.

**Contract Touch Decision - `codex:write-boundary-retention-owner-input-2026-07-15`**

- **Work id:** `codex:write-boundary-retention-owner-input-2026-07-15`.
- **Touched contracts:** persistence placement retention, event idempotency,
  task-evidence history bounds, owner-input current-queue replacement, repair
  write boundary, and explicit summary-freshness synchronization.
- **Considered but not touched:** task identity, release membership, raw
  transcript semantics, UI route payload shape, LLM model selection, and cache
  deletion policy.
- **Required follow-up:** move the remaining filesystem/SQLite dual writes
  behind an outbox or commit marker; add a separate-process mutation proof;
  build an evidence-backed migration for existing history and unknown cache
  entries.
- **Proof required:** new appends stay within policy; duplicate ids do not
  duplicate state; closed owner input disappears from the current queue;
  unrelated stale summaries remain stale; installed fleet reads remain
  projection-backed and bounded.
- **Proof provided:** 44 focused tests, lint/data/contract checks, successful
  build/install/restart, stale-server false, 7 current projects, 0 loading,
  and measured live route payload/timing above.
- **Apply/revert behavior:** reverting the policy code does not delete existing
  history. Reverting owner-input replacement would reintroduce stale current
  rows, so the compatibility reader must continue treating JSON status as the
  detail source until the replacement behavior is restored.

**Schema Migration Decision - `codex:write-boundary-retention-owner-input-2026-07-15`**

- **Persisted schema touched:** no new tables or columns. Existing event files,
  task-evidence JSONL, owner-input table, and summary row change write/read
  semantics only.
- **Scope:** bounded history and current-state projection correctness.
- **Change class:** persisted behavior/retention contract; not a schema shape
  migration.
- **Existing data impact:** existing bytes are preserved. New writes and
  explicit compaction are bounded; no automatic destructive cleanup runs.
- **Migration id:** none yet. A later cleanup migration must be manifest-based,
  reversible or exported, and separately verified against registered workspace
  ownership.
- **Compatibility reader:** existing JSON request/evidence/history files remain
  readable; current owner-input consumers use the replacement SQLite queue when
  the database exists and the existing JSON path otherwise.
- **Fixtures/tests:** persistence retention, task evidence retention, owner
  input projection/repair, project-state database, build, and installed route
  checks.
- **Owner-facing plan text:** current views read a small, bounded state model;
  detail/history is available on demand and is not loaded to render fleet
  cards.
- **Rollback/revert:** preserve all files, stop applying new retention, and
  keep the current projection reader. Do not delete history as part of rollback.

## Updated data-layer position - 2026-07-15

The architecture has crossed from “request-time performance patch” into a
real current-state/read-history split, but it is not done. The compact layer
is now small enough for fast fleet reads and its refreshes are revisioned and
overlay-aware. New event/evidence growth is bounded at write time. The old
history/cache mass remains because deleting it without ownership, export, and
rollback evidence would repeat the original modeling mistake in a different
form.

The remaining structural work is therefore explicit: make writes publish one
durable fact across current state and history, close every direct-writer seam,
integrate cache leases/ownership instead of guessing from directory names, and
prove the same state across the UI surfaces. Narrative Harness MVP scheduling
remains downstream of those proofs.

## SQLite bounded task evidence history - 2026-07-15

The task evidence boundary now has a real durable history model for projects
that have crossed to database authority. `task_evidence_history` stores the
compact essential event, keyed by `(task_id, kind, evidence_id)`, beside the
current proof and current-evidence projections. The append transaction updates
all three representations together and trims the per-kind newest tail using
the existing task-state retention policy. Repeating an evidence id is an
idempotent update, not a second historical row.

The reader has the same authority rule as runtime/workspace state. A database
authoritative project reads SQLite history and merges any pre-boundary JSONL by
event id for compatibility. A legacy project still reads its existing JSONL.
The fleet/current-state path never needs this history; task detail explicitly
opts into it. This is the first step that prevents the “compact projection plus
duplicate permanent transcript store” shape from continuing to grow.

**Contract Touch Decision - `codex:sqlite-task-evidence-history-2026-07-15`**

- **Work id:** `codex:sqlite-task-evidence-history-2026-07-15`.
- **Touched contracts:** task evidence append authority, task evidence detail
  read authority, event-id idempotency, bounded history retention, and project
  state database schema version.
- **Considered but not touched:** task identity, task hierarchy, release
  membership, current summary fields, raw transcript storage, and generic
  persistence event placement.
- **Required follow-up:** migrate existing JSONL only through an explicit
  manifest-backed operation; finish the direct-writer inventory; prove owner
  input projection recovery after an interrupted refresh. An outbox is not
  required while compatibility files remain detail-only.
- **Proof required:** new database-authoritative events produce no duplicate
  JSONL, SQLite history stays within the supplied retention policy, duplicate
  ids are idempotent, legacy history remains readable, and current summary
  invalidation happens after the transaction.
- **Proof provided:** focused task-state/project-state database/attention tests,
  data-layer and contract guardrails, and diff validation. Installed proof is
  still required after the final build/install cycle.
- **Apply/revert behavior:** reverting the writer leaves existing SQLite and
  JSONL intact; legacy readers remain available. Reverting the schema requires
  preserving the schema-16 database or exporting its history before downgrade.

**Schema Migration Decision - `codex:sqlite-task-evidence-history-2026-07-15`**

- **Persisted schema touched:** project-state SQLite schema version 16; added
  `task_evidence_history(task_id, kind, evidence_id, recorded_at, payload_json)`
  with a task/kind/time index.
- **Scope:** all database-authoritative project roots; legacy projects are
  unchanged until explicitly promoted.
- **Change class:** additive persisted read/history model.
- **Existing data impact:** writable database opens create the empty table and
  preserve all existing current rows, detail stores, and JSONL. New evidence is
  compacted before storage and bounded by the caller’s existing policy.
- **Migration id:** `project-state-db-16-task-evidence-history`.
- **Safety:** additive DDL only; no automatic history deletion, no blind cache
  cleanup, and no source-file removal.
- **Compatibility reader:** database history plus pre-boundary JSONL merged by
  evidence id; legacy JSONL-only projects continue unchanged.
- **Fixtures/tests:** schema metadata, append/read/page, retention, duplicate
  id, summary invalidation, and task-state authority tests.
- **Owner-facing plan text:** task detail can show a bounded essential history;
  project and fleet cards do not load it.
- **Rollback/revert:** keep schema 16 databases and use the compatibility
  reader; do not downgrade in place or delete the new table without an
  explicit export and rollback plan.

## Updated data-layer position - 2026-07-15, evidence history

The model now distinguishes three task-evidence responsibilities instead of
making one payload serve every surface: current proof for status, bounded
essential history for task detail, and raw operational diagnostics outside the
project-state read model. This removes the newly-written SQLite/JSONL
duplication for database-authoritative projects. It does not yet remove the
old history mass, and it does not make the filesystem compatibility path
crash-safe for the separate owner-input detail/projection pair. That pair is
recomputable and does not define a second current state. These are the next
architectural gates, not reasons to claim the existing cache can be pruned
heuristically.

## Overlay compatibility-writer removal - 2026-07-15

Runtime and workspace overlays now follow the same authority rule as task
evidence: after promotion, SQLite is the current-state writer and the legacy
JSON files are read-only compatibility artifacts. This matters because a
“dual-write for safety” is not safety when one write can succeed and the other
can fail; it creates two plausible truths and keeps payload growth alive.

Legacy projects still write JSON until they have a project-state database
authority marker. Existing compatibility files are preserved and are not
silently deleted. A later migration can remove or export them only after it
has a manifest, ownership proof, and rollback story.

## Installed verification after overlay cut - 2026-07-15

The final current-state writer change was rebuilt and installed. The running
service reports `stale:false`, with matching build mtimes. The live Projects
shell is 34,955 bytes for 7 projects, with no loading projects and no stale
summaries; warm reads in the verification probe were 2.8-7.1 ms. Fleet
attention remained 41,117 bytes.

This proves the refactor did not trade correctness for speed: the service is
reading the same compact projection after the writer cut. It does not prove
the global cache is small. That remains 3.6 GB / 52,633 entries, of which only
7 are registered and 52,626 are unknown. The next work must establish cache
ownership and a reversible migration manifest, not guess that directory names
are safe to delete.

## Memory technology correction - 2026-07-15

The cache footprint audit identified approximately 1.25 GB in 1,418
`guildhall-memory.db-wal` sidecars. The cause was not task text: the Mastra
LibSQL adapter was initialized on memory packet reads, but the packet then
constructed candidates from the deterministic source index and did not use
Mastra retrieval. The adapter also had no lifecycle close boundary.

The smallest correct correction is now in place:

1. Memory packet construction no longer initializes Mastra storage. If Mastra
   is configured, the packet explicitly reports that Mastra retrieval is not
   wired and uses the deterministic bounded source index.
2. The explicit Mastra adapter remains available for future real retrieval and
   exposes `close()`, which checkpoints and releases LibSQL resources.
3. The current task projection change makes bounded SQLite evidence the default
   for database-authoritative effective-task reads. Historical evidence is an
   explicit request.

This is a data-layer correction, not cache pruning. It prevents the observed
WAL recurrence and removes a false claim about which engine supplies memory.
Existing WALs and historical files remain untouched until the ownership and
rollback manifest exists.

**Contract Touch Decision - `codex:memory-packet-retrieval-boundary-2026-07-15`**

- **Work id:** `codex:memory-packet-retrieval-boundary-2026-07-15`.
- **Touched contracts:** memory packet adapter reporting, Mastra adapter
  lifecycle, current task evidence read default, and explicit historical-read
  semantics.
- **Considered but not touched:** task identity, release membership, project
  summary fields, memory event schema, and cache ownership records.
- **Required follow-up:** prove a real Mastra retrieval path before enabling it
  for packet reads; create a manifest-backed legacy cache migration; complete
  the direct-writer audit.
- **Proof required/provided:** normal packet reads do not create a memory DB or
  WAL; explicit adapters close; current reads avoid history; explicit history
  reads retain the detail tail. The memory-core, effective-task, and project
  state database suites pass these behaviors.
- **Apply/revert behavior:** code-only revert; no data deletion.

**Schema Migration Decision - `codex:memory-packet-retrieval-boundary-2026-07-15`**

- **Persisted schema touched:** none.
- **Scope/change class:** memory packet read/lifecycle and task current-read
  semantics; no persisted-shape migration.
- **Existing data impact/migration id:** none; no migration id.
- **Compatibility reader:** existing deterministic memory events, explicit
  Mastra adapter, SQLite current evidence, and bounded history remain readable.
- **Fixtures/tests/owner plan:** lifecycle/no-allocation and current-versus-
  history regressions; user-facing status stays projection-backed and history
  remains on demand.
- **Rollback:** preserve all existing files and revert code only. Never delete
  legacy WALs as part of rollback.

## Installed proof after memory boundary cut - 2026-07-15

The rebuilt/dev-installed artifact reports `stale:false` with matching build
mtimes. `/api/service/projects` is 34,955 bytes for 7 current projects with no
loading or stale summaries; five live probes measured 0.00-0.02 seconds.
`/api/fleet/attention` measured 0.01-0.06 seconds across five probes.

The cache still contains exactly 1,418 `guildhall-memory.db-wal` files and
remains 3.6 GB because existing artifacts were deliberately not deleted. The
count did not increase after the fresh service and route reads. That proves
the identified packet-read WAL recurrence is stopped. It does not yet prove
which legacy files can be removed; the manifest-backed cleanup gate remains
open.

## Migration writer authority cut - 2026-07-15

The task-state, task-question, and task-hierarchy migrations previously
serialized their repaired queue directly to `TASKS.json`. That was a data
authority defect: a migration could recreate a competing current-state file
after SQLite had become authoritative. They now reuse
`writeProjectTaskQueueWithSummary`, which already selects the legacy or
database-backed writer from the project authority marker and refreshes the
revisioned projections.

**Contract Touch Decision - `codex:migration-writer-authority-2026-07-15`**

- **Work id:** `codex:migration-writer-authority-2026-07-15`.
- **Touched contracts:** task queue migration output and the project-state
  authority boundary.
- **Considered but not touched:** task identity, release membership, evidence
  retention, recovery snapshot format, and legacy restore semantics.
- **Required follow-up:** classify recovery/evacuation writers one by one and
  add a second-process mutation proof before declaring the writer inventory
  complete.
- **Proof required/provided:** promoted projects must not regain an
  authoritative `TASKS.json`; six focused suites and 46 tests pass for the
  migration/boundary group.
- **Apply/revert behavior:** code-only revert; no compatibility file is
  deleted by this change.

**Schema Migration Decision - `codex:migration-writer-authority-2026-07-15`**

- **Persisted schema touched:** no new schema; existing schema 16 authority
  and revisioned detail boundaries are reused.
- **Scope/change class:** writer routing and migration behavior.
- **Existing data impact/migration id:** none; no automatic cleanup.
- **Compatibility reader:** legacy projects continue to use the JSON queue;
  promoted projects read SQLite current state and revision-matched details.
- **Fixtures/tests/owner plan:** migration ordering, hierarchy, queue
  compatibility, project-state boundary, migration, and freshness tests.
- **Rollback/revert:** revert code only; preserve all queue/detail files.

## Current-fact duplication correction - 2026-07-15

The current-state database audit found one more duplicate-authority seam inside
the new model itself. `execution` and `runtime` were stored in both
`project_summary.payload_json` and their dedicated singleton tables. An
overlay writer updated the table and invalidated the summary, but a summary
reader could still return the old embedded value. The result was a compact
model with two answers to the same question.

The dedicated `current_execution` and `current_runtime` rows are now the
authoritative values. Summary reads hydrate those fields from the rows, and
new summary writes omit them. This removes stale duplicate facts without
making fleet reads reconstruct a queue.

Owner input is intentionally one step behind this cut. Its SQLite table is
already the current open queue, but older databases may have only the compact
summary value until their request files are migrated. The summary value
therefore remains a compatibility fallback for now; new owner-input table
writes store only the navigation payload needed by the compact projection,
not the full request record. Removing that fallback is a separate migration
gate, not an opportunistic deletion during a reader fix.

**Contract Touch Decision - `codex:current-fact-authority-2026-07-15`**

- **Work id:** `codex:current-fact-authority-2026-07-15`.
- **Touched contracts:** current execution/runtime read authority, summary
  hydration, owner-input compact queue payload.
- **Considered but not touched:** task identity, release membership, task
  history, raw owner-input request files, and the fleet response shape.
- **Required follow-up:** migrate owner-input request files into the current
  queue, then remove the legacy summary fallback with an idempotence test.
- **Proof required:** an overlay mutation must be visible from a fresh summary
  read; the stored summary must not retain execution/runtime copies; owner
  input navigation must survive with a compact row; old summary-only state must
  remain readable until its migration runs.
- **Proof provided:** project-state database regression tests cover all four
  conditions except the full request-file migration, which remains open.
- **Apply/revert behavior:** code-only revert is safe; no existing summary,
  request, queue, or history file is deleted by this change.

**Schema Migration Decision - `codex:current-fact-authority-2026-07-15`**

- **Persisted schema touched:** existing `project_summary.payload_json` field
  semantics and `owner_inputs.payload_json` compaction; no table or column
  addition.
- **Scope/change class:** authority/read-model correction with a compatible
  payload reduction for newly written owner-input rows.
- **Existing data impact:** old owner-input payloads remain readable; only new
  writes are compact until the explicit request-file migration rewrites the
  current queue.
- **Migration id:** none yet. The owner-input fallback cannot be removed until
  the request-file migration has its own id and rollback proof.
- **Compatibility reader:** summary fallback plus table hydration; the table
  wins whenever current rows exist.
- **Fixtures/tests:** stale embedded execution/runtime regression, compact
  owner-input payload assertion, and existing owner-input projection tests.
- **Owner-facing plan text:** status reads show current execution/runtime and
  the next owner question without loading the full request or chat session.
- **Rollback/revert:** preserve all existing rows and files; revert code only.

## Fail-closed detail reads and writer audit - 2026-07-15

The direct-writer audit found a more dangerous failure than slow reads:
promoted projects could fall back from a missing revision-matched detail store
to compact SQLite index rows, or in one rebuild path to an empty queue. A
subsequent write could then erase rich task definitions while leaving the
project apparently healthy.

The detail boundary now fails closed for database-authoritative projects. A
missing detail store returns an unavailable result to summary backfill,
throws on canonical queue mutation, and stops state compaction. Legacy
projects retain their compatibility readers. This makes corruption visible
and repairable instead of silently manufacturing a smaller but false project.

The remaining writer audit is now classified rather than treated as one
generic “migration” problem:

- evacuation/restore and migration snapshots are historical/rollback stores;
- queue boundary writes are authoritative sinks, but need a full-detail and
  revision precondition before accepting arbitrary replacement queues;
- owner-input request JSON is detail authority and its SQLite queue is a
  recomputable current projection, so interruption recovery still needs a
  proof;
- workspace import, re-intake, thin compaction, and stale-blocker repair need
  database-detail reads after promotion and must not use missing compatibility
  files as an empty queue;
- runtime control JSON remains a separate control authority until its
  crash-consistency contract is proven.

**Contract Touch Decision - `codex:fail-closed-authoritative-detail-2026-07-15`**

- **Work id:** `codex:fail-closed-authoritative-detail-2026-07-15`.
- **Touched contracts:** promoted-project detail reads, summary backfill,
  canonical queue reads, release-envelope preservation, and compaction.
- **Considered but not touched:** task schema, release semantics, evacuation
  manifest format, runtime control schema, and compatibility-file deletion.
- **Required follow-up:** add an expected-revision/full-detail precondition to
  replacement writes and convert each unsafe writer in the audit to either a
  targeted mutation or an explicit historical operation.
- **Proof required:** missing detail must never become an empty queue or a
  compact writable approximation; legacy readers must retain compatibility.
- **Proof provided:** project-state database regression covers promoted detail
  loss and canonical queue failure; installed proof follows the next build.
- **Apply/revert behavior:** code-only revert; no source, detail, or history
  file is deleted.

**Schema Migration Decision - `codex:fail-closed-authoritative-detail-2026-07-15`**

- **Persisted schema touched:** none; this changes read/write failure
  semantics around the existing revisioned detail store.
- **Scope/change class:** safety boundary and corruption prevention.
- **Existing data impact/migration id:** none; missing detail is surfaced, not
  reconstructed or deleted.
- **Compatibility reader:** legacy projects can still read their queue file;
  promoted projects require the revision-matched detail artifact.
- **Fixtures/tests:** missing-detail database test, boundary release-envelope
  test, summary-backfill unavailable result, and compaction guard.
- **Owner-facing plan text:** a project can show “state unavailable” and a
  repair action; it must never show a falsely empty plan.
- **Rollback/revert:** preserve all files and revert code only.

## Compaction uses the authority-owned queue path - 2026-07-15

The first installed fail-closed audit caught an ownership mismatch in the
maintenance command itself: `compactProjectState` used the repository
`.guildhall/TASKS.json` path even for database-authoritative projects. The
project API remained healthy because it used the system-local database path,
but compaction could not inspect the same state. The command now selects its
queue path from the authority boundary: system-local detail for promoted
projects, repository state only for legacy projects. A regression covers a
stale repository copy beside a promoted system-local queue.

This is a useful model-level result: path selection is part of data authority,
not a convenience detail. A reader, writer, migration, and maintenance
operation must all resolve the same owner before they can be considered
consistent.

## 2026-07-15 - Queue mutation tokens and cache recurrence guard

The compact read model is now paired with an explicit whole-aggregate mutation
protocol. A caller that intends to replace a queue reads the authoritative
detail payload and queue revision together, edits that in-memory aggregate, and
passes the revision as the SQLite compare-and-swap precondition. The database
checks the token inside the same transaction before deleting/reinserting current
rows. This keeps a second process from silently erasing a newer queue.

The first migration slice covers the high-frequency agent/tool paths: task
add/update, escalations, issue reports, gate proof, and state compaction. The
promoted serve reader now fails closed when its detail store is unavailable; it
does not turn compact rows into an empty writable queue. Compaction also uses
the same authority-owned queue read and carries its revision into its write.

This is intentionally not declared complete. Remaining whole-queue writers are
being converted by class: serve mutation routes, owner-input repair,
re-intake/import, MCP replacement, migration/restore, and stale-blocker repair.
Each must either carry a mutation token or become a targeted current-state
mutation. Only after that inventory is clean will the boundary reject an
unconditional replacement for database-authoritative projects.

The cache-size audit now distinguishes hot state from historical residue. The
four registered calibration projects have 164-508 KB SQLite current-state
databases and 0.5-17.3 KB compressed queue detail, while their larger files are
queue backups, evacuated state, evidence, code-map history, and recent events.
The global cache is still about 3.6 GB, including about 1.19 GiB in 1,418 old
Mastra/LibSQL WAL sidecars. The ordinary packet path no longer initializes
Mastra storage, and test isolation prevents new test runs from targeting the
real cache. Cleanup is deferred until writer ownership and rollback retention
are explicit; deletion alone would hide the lifecycle failure.
## Queue detail authority correction

The first implementation still had a genuine dual-write seam: SQLite stored
the compact current-state index while `queue-details.json.gz` stored the full
queue. That was not an acceptable long-term model. A crash between those writes
could make the index and full definitions disagree by revision, and a reader
could not know which one was authoritative.

The current model is now:

- SQLite is the sole current-state authority for promoted projects.
- `work_item_detail` stores the revision-matched compressed task definitions;
  normalized `scopes` stores release definitions. There is no current
  aggregate task-detail blob.
- A queue replacement commits per-task detail, index, scope, queue envelope, and summary
  watermark in one transaction.
- `queue_detail` and the filesystem detail sidecar are compatibility stores for
  older migrations only. They are not written by the current schema after the
  per-task index is available.
- Missing or mismatched promoted per-task detail is an unavailable/corrupt
  state. It is never treated as an empty queue or silently repaired from a
  stale sidecar.

**Schema Migration Decision - `0.12.38/project-state-queue-detail-database`**

- **Persisted schema touched:** SQLite `queue_detail` table; project-state
  schema version 17.
- **Scope/change class:** representation migration inside the project current
  state; no task or release semantic change.
- **Existing data impact:** current revision-matched sidecars are compressed
  into the BLOB; evidence/history, backups, evacuation records, and task
  content are preserved. The migration does not delete a sidecar.
- **Migration safety:** automatic and idempotent. It refuses to invent detail
  when no revision-matched source exists.
- **Compatibility reader:** legacy projects may continue to use the sidecar;
  promoted projects read the BLOB and fail closed when it is unavailable.
- **Fixtures/tests:** database-only detail read, no-sidecar promoted write,
  migration ordering after schema creation, and missing-detail failure tests.
- **Owner-facing plan text:** a project can say that current plan detail is
  unavailable and offer repair; it cannot display a false empty plan.
- **Rollback/revert:** code rollback is safe while the compatibility sidecar
  remains. No source or historical artifact is removed by this migration.

The migration detector also treats a missing queue envelope or summary as
unfinished even when a runtime overlay has already created the SQLite schema.
That closes the bootstrap hole where schema presence was mistaken for usable
project state.

## Schema 23: indexed rich task detail, aggregate removal, and current Thread

The queue aggregate was a second copy of every task definition. It made point
reads expensive and made the SQLite database larger without owning a distinct
fact. Schema 23 keeps `work_item_detail(task_id, revision, payload_gzip)` as the
sole current rich task representation. Explicit queue/detail reads may scan
those rows and normalized `scopes`; shell and point reads never do.

**Schema Migration Decision - `0.12.43/project-state-per-task-detail-index`**

- **Persisted schema touched:** `work_item_detail`, schema version 22.
- **Change class:** additive representation migration; no task, release,
  evidence, or history semantics change.
- **Existing data impact:** one compressed detail row is backfilled for each
  current task from the revision-matched aggregate. No task or history record
  is deleted.
- **Safety/compatibility:** the index must match the queue revision and task
  count. Legacy projects can still use their source queue while migrating.
- **Proof:** migration and database tests read one task after aggregate detail
  is unavailable.

**Schema Migration Decision - `0.12.44/project-state-remove-aggregate-detail`**

- **Persisted schema touched:** retired `queue_detail` row and SQLite pages;
  schema version 22.
- **Change class:** duplicate-representation removal after verification.
- **Existing data impact:** only the duplicate aggregate BLOB is cleared;
  per-task detail, scopes, current rows, evidence, and history remain.
- **Safety/rollback:** removal fails closed unless every current task has a
  revision-matched detail row. The filesystem sidecar is never consulted after
  promotion. A code rollback can still read the empty compatibility table only
  if a future migration explicitly repopulates it from indexed detail.
- **Proof:** the focused suites pass 68/68 and prove rich reads remain intact
  after both aggregate and filesystem detail copies are absent.

**Installed proof:** after rebuilding/reinstalling the current artifact and
restarting the service, migrations `0.12.43` and `0.12.44` applied to all
seven registered projects. Every current database reports zero `queue_detail`
rows; Narrative Harness has 7 revision-matched detail rows and Looma + Knit
has 43. The fleet/project/rich-read performance gate passes with a 25.4 KB
fleet response, project shells under 48 KB, rich task responses under 34 KB,
and Thread responses under 120 KB. Historical backups, event/debug ledgers,
and evacuation snapshots remain intentionally untouched pending explicit
retention ownership.

**Schema Migration Decision - `0.12.45/project-current-thread-projection-store`**

- **Persisted schema touched:** SQLite `current_thread` row; schema version 23.
- **Change class:** additive bounded read-model storage; no task, release,
  evidence, or historical-thread semantics change.
- **Existing data impact:** none. The first projection refresh writes the
  bounded active/pending turns and a small completed window; historical turns
  remain in their existing source stores.
- **Writer hooks:** queue and evidence writes already enter the projection
  scheduler; bounded-chat and pressure-test saves emit the `thread` domain;
  wizard writes and supervisor events do the same. The scheduler coalesces
  these events and refreshes the row outside the request path.
- **Read contract:** `/api/project/thread` reads this row only and reports
  `currentThreadFreshness` as `missing`, `stale`, or `current`. It never calls
  `buildThread`. The full project diagnostic and task/thread extras consume the
  same current row or filter its current turns. `/api/project/thread/history`
  reads the durable paged history projection; the asynchronous projection
  writer is the only normal path that reconstructs historical turns.
- **Safety/rollback:** a missing or queue-revision-mismatched row is surfaced
  as missing/stale; it is not rebuilt during a read. Removing the row does not
  remove any source or history data.
- **Remaining limitation:** the background writer still uses `buildThread` to
  materialize current and historical context at each coalesced refresh. That
  work has moved out of ordinary reads, but a smaller source-native projector
  is still a later optimization.

**Contract Touch Decision - `codex:thread-history-page-read-model-2026-07-16`**

- **Work id:** Thread history architecture slice.
- **Touched contracts:** the `/api/project/thread/history` page and metadata
  response, the project SQLite history tables, and the existing current-Thread
  projection write boundary.
- **Considered but not touched:** Thread construction, current-Thread payload
  shape, task/chat/intake source schemas, owner approval semantics, and source
  history files.
- **Required proof:** history GET reads only the stored page; the page query is
  bounded; projection writes publish current and history with matching
  revisions; existing Thread behavior remains on the background writer.
- **Apply/revert behavior:** the migration is additive and creates empty tables;
  a cache miss reports `requiresRefresh` and does not backfill in a GET. Reverting
  the reader leaves source histories and the existing current projection intact.

**Schema Migration Decision - `0.12.47/project-thread-history-read-model`**

- **Persisted schema touched:** `thread_history_state`, `thread_history`, and
  project-state database schema version 29.
- **Scope/change class:** additive, bounded paged history read model. Retention
  is capped at 2,000 sanitized turns and 512 KiB of serialized payloads; reads
  are capped at 100 turns per page.
- **Existing data impact:** none. The automatic idempotent migration creates
  empty tables; the next asynchronous projection refresh populates them. Task,
  chat, intake, approval, and source-history data are not rewritten or deleted.
- **Compatibility reader:** missing or stale history returns page metadata with
  `historyFreshness` and `requiresRefresh`; normal GET never reconstructs Thread.
- **Proof and rollback:** focused projection, route, database, and migration
  tests cover atomic revision matching, retention, page limits, and source-file
  independence. Code rollback can ignore the additive tables without affecting
  the existing source stores.

## 2026-07-15 - Current Thread bounded-window correction

The first implementation of schema 23 moved Thread reconstruction out of
ordinary reads, but it still retained every pending turn. That made the read
model smaller than historical Thread while preserving the queue's entire
future in a single row. Looma + Knit exposed the error: 78 pending turns made
its current row 82 KB.

The current projection now has three explicit windows:

- the active turn, always;
- the first 12 pending turns, in queue order;
- the latest 8 completed turns.

Everything else remains available through the work inventory or the explicit
history route. This is a UI-oriented read model, not a second authority and
not a claim that later pending work no longer exists.

Installed/live proof after refreshing all seven registered workspaces:

| Project | Current Thread turns | Row bytes |
| --- | ---: | ---: |
| Looma + Knit | 21 | 17,677 |
| T-minus-t | 11 | 7,992 |
| Fair Labor License | 9 | 6,292 |
| Font something | 13 | 11,767 |
| Narrative Harness | 17 | 12,945 |
| Commerce project | 8 | 4,628 |
| Jess | 9 | 6,425 |

The installed performance gate passed on the rerun: all seven fleet/project
reads were current with no loading or error state; rich task reads ranged from
31 to 238 ms; Thread responses ranged from 8,393 to 53,426 bytes. The prior
Looma Thread response was 117,896 bytes. The current route still returns
bounded orientation/readiness context alongside the row, so a further split
is warranted only if Thread does not need that context on initial load.

## 2026-07-15 - Data-size truth and the remaining architecture gap

The current-state model is now small: the seven promoted SQLite files total
about 2.57 MiB, and their current Thread rows total 67,726 bytes. The durable
registered cache set is about 46.9 MB. The machine-wide cache is still 3.6 GB,
of which approximately 3.44 GB is in 52,626 unregistered project-shaped
directories. The largest categories are old `memory` directories (about 2.94
GB) and old `project-state` directories (about 436 MB).

That residue is not evidence that the current SQLite model is large, but it is
evidence that allocation ownership was historically absent. No generic prune
is allowed to stand in for the missing model. Before any deletion, every
persisted directory class must declare provenance, retention class, owner, and
whether it is current, recoverable, or temporary. Only then can a separately
allowlisted retention operation remove a record and leave an audit receipt.

The deeper refactor is still open. The writer graph found 47 production call
sites that all replace the complete current queue, even though the database
already stores normalized work-item and scope rows. The next implementation
slice must add revision-guarded targeted mutations for work-item definitions,
relationships, affected scope rows, and current summary. Whole-queue writes
then become explicit import/migration/restore operations rather than the
default path for a one-task edit. Rollback, evacuation, debug, and temporary
run data need the same explicit ownership treatment before the data layer can
be called complete.

## 2026-07-15 - Targeted task mutation API is the new integration boundary

The first mutation-oriented SQLite transaction now exists as
`writeProjectStateDatabaseTaskMutation`. It is intentionally strict: it only
accepts promoted database authority, requires a queue revision token, refuses
an incomplete per-task detail index, and requires the caller to supply the
summary that belongs to the changed task. One commit updates the task's
compact/indexed row, one compressed detail payload, an optional scope row, the
queue watermark, and the summary/orientation/auxiliary projections. Unchanged
detail payloads are not decompressed or rewritten; only their revision marker
advances so rich reads remain coherent.

Focused database proof passes: a second task's compressed payload remains
byte-identical, summary and scope state share the new revision, and a stale
writer is rejected before mutation. This is a model-level foothold, not the
end of the migration. The existing 47 callers still use full queue replacement
and must be moved by mutation class, beginning with one normal task transition.

## 2026-07-15 - Provenance before storage allocation

The data layer now has a concrete guard against creating new unowned durable
cache roots. The explicit local-history write boundary records the workspace
in the existing project-cache registry before allocating the root. Persistent
memory initialization and first SQLite current-state writes share that rule.
Unconfigured temporary projects are excluded and remain in the temporary
history root.

This changes the failure mode at the source: future writes cannot silently
grow another anonymous project-shaped directory. It does not pretend that the
old 3.44 GB residue is safe to remove. That residue remains an inventory of
unknown provenance until a separate evidence-backed classification exists.

The first-write path is intentionally cheap after allocation: registered
manifests are not rewritten on every write. It also preserves a compatibility
escape hatch for low-level migration callers that do not have a workspace
root. The next retention slice must add explicit storage classes and bounded
owners to durable subdirectories, then prove an allowlisted retention job on
fixtures before touching real residue.

## 2026-07-15 - First caller migration

The shared queue boundary now uses the targeted transaction for the safe
single-task case. It proves the changed-task set, release envelope, and scope
delta before committing. This means ordinary detail/status edits no longer
have to delete and reinsert every current task row when they leave the rest of
the indexed project state untouched.

The guard is deliberately conservative. Structural edits, release changes,
task additions/removals, and changes that affect multiple scope rows continue
through the aggregate writer until a batch mutation transaction exists. The
aggregate writer is therefore still a compatibility path in practice, but it
is no longer the only path for normal task edits.

## 2026-07-15 - One project memory stream

The active cache census exposed a remaining ownership mistake: memory events
were bounded independently per task/thread/agent scope, so a project with many
scopes could still accumulate a megabyte-scale `memory/events/` directory.
Memory is a project retrieval index, not a collection of independent history
archives. New events now live in one `memory/events.jsonl` stream with the
scope retained as an indexed event field and one 256 KiB project-wide budget.
Reads filter that stream by scope. Existing per-scope files remain readable
but are write-dead until the explicit consolidation migration runs.

The migration is intentionally separate from ordinary reads and writes. It
deduplicates old event IDs, keeps the newest records within the same project
budget, writes the single stream first, and removes only the old per-scope
files when `clean-project-state --apply` (or another explicit migration)
invokes it. It does not delete by directory name and does not become a
request-time repair.

**Contract Touch Decision - `codex:project-memory-single-stream-2026-07-15`**

- **Touched contracts:** memory event path for new writes, memory event reader
  compatibility, project-wide memory retention, and explicit consolidation
  reporting.
- **Considered but not touched:** memory event payload schema, task/release
  identity, current SQLite rows, Mastra storage, raw transcript files, and
  public API payloads.
- **Required follow-up:** run the consolidation against the four calibration
  projects after the installed migration path is proven; classify the
  remaining memory database and audit artifacts separately.
- **Proof required:** multiple scopes must stay within one project byte budget;
  old per-scope files must remain readable before migration and disappear only
  after an explicit apply; normal memory reads must not create a database or
  project-local files.
- **Proof provided:** `src/memory-core/__tests__/memory-core.test.ts` proves
  cross-scope bounding, legacy reads, dry-run preservation, and applied
  consolidation. The focused memory and compaction suites pass (32 tests),
  data-layer/contract lint passes, and the touched files are type-clean.
- **Apply/revert:** the reader continues accepting legacy per-scope files;
  reverting the writer keeps the compatibility reader valid. The migration
  writes the new stream before deleting old files, and the old files are not
  touched during a dry run.

**Schema Migration Decision - `0.12.46/project-memory-single-stream`**

- **Persisted schema touched:** system-local memory event file placement only;
  event records remain schema version 2.
- **Change class:** additive compatibility migration plus write-boundary
  consolidation; no task or current-state rewrite.
- **Existing data impact:** old per-scope files are read and deduplicated into
  the bounded project stream only during an explicit apply. No legacy file is
  removed by an ordinary read or by the new writer.
- **Migration id:** `0.12.46/project-memory-single-stream`.
- **Compatibility reader:** reads the new project stream and the requested
  legacy scope file, deduplicating by event ID.
- **Fixtures/tests:** memory-core cross-scope and legacy-consolidation tests.
- **Owner-facing plan text:** the cleanup report will show files scanned,
  records seen/retained, and bytes before/after; this is evidence for an
  allowlisted migration, not a generic prune result.
- **Rollback/revert:** keep legacy files until the explicit migration has
  written and verified the new stream; if an apply fails before removal, the
  compatibility reader remains authoritative for the old data. Reverting code
  does not require reconstructing the old files from the new stream.

## 2026-07-15 - Migration snapshots leave current project state

The storage census exposed a category error in the migration layer. Several
older migrations wrote full `TASKS.before-*` files into the same
`project-state` directory that contains current compatibility state. Those
files were not read by the compact project model, but their location made them
look authoritative and allowed ordinary state directories to grow. The
migration snapshot writer also kept the same bytes once in the raw snapshot
and once in the content-addressed rollback object.

New migration writers now place snapshots under the shared
`migration-snapshots/` local-history boundary. The raw snapshot is no longer
materialized for new writes. The manifest records the logical snapshot path,
digest, retention purpose, and `materialized: false`; the rollback object is
the single durable byte authority. Existing raw snapshots remain compatible
and are marked `materialized: true` until a verified cleanup migration checks
the manifest and rollback-object digest. Unmanifested legacy files remain
unknown and are not deleted by this change.

This is a recurrence fix, not a cosmetic relocation: current project state can
now be audited as current records, while rollback material has an explicit
owner and an independent retention boundary. The next slice is a dry-run and
apply operation that removes only manifest-backed materialized copies after
hash verification; it must leave unverified old backups untouched.

**Contract Touch Decision - `codex:migration-snapshot-single-authority-2026-07-15`**

- **Touched contracts:** migration snapshot placement, snapshot manifest
  metadata, migration result backup paths, and rollback-object ownership.
- **Considered but not touched:** task/release records, SQLite current-state
  tables, public API payloads, migration ordering, and restore semantics.
- **Required follow-up:** add a manifest-backed cleanup operation and a restore
  verification receipt; classify unmanifested historical snapshots as unknown.
- **Proof required:** new migration writes must not create a raw file in
  `project-state`; the rollback object must contain the source bytes; legacy
  materialized snapshots must remain readable; source drift must be reported.
- **Proof provided:** migration snapshot, hierarchy, task-state, execution
  planning, local-history, and migration suites pass (61 focused tests); data
  layer and contract detectors pass; the touched paths are type-clean.
- **Apply/revert:** compatibility readers and existing raw snapshots remain
  intact. Reverting the writer restores the old materialized behavior; no
  existing project snapshot is removed by this change.

**Schema Migration Decision - `0.12.47/migration-snapshot-single-authority`**

- **Persisted schema touched:** migration snapshot manifest version 1 gains
  `snapshot.materialized`; new snapshot files move from current project state
  to system-local `migration-snapshots/`.
- **Change class:** additive placement and manifest metadata change; no task,
  release, or SQLite current-state rewrite.
- **Existing data impact:** none during this release. Existing raw snapshots,
  including unmanifested legacy files, remain in place.
- **Compatibility reader:** `readMigrationSnapshotManifest` continues to
  locate the sidecar at the supplied logical snapshot path; legacy materialized
  snapshots remain valid, and rollback objects remain readable.
- **Fixtures/tests:** migration snapshot tests cover non-materialized new
  writes, idempotent source drift, and legacy materialized import; migration
  path tests cover all four writers.
- **Owner-facing plan text:** rollback evidence is separate from current
  project state and is eligible for cleanup only after digest and restore
  verification.
- **Rollback/revert:** old code can still read the existing raw snapshots;
  reverting does not require copying data back into current project state.

## 2026-07-15 - Four-project bounded cleanup proof

The explicit cleanup was applied to Narrative Harness, Looma + Knit, Jess, and
Fair Labor License after the new storage boundary was installed. The cleanup
consolidated legacy per-scope memory events into the project-wide bounded
stream, removed forbidden bulky task fields from current compatibility records,
and vacuumed SQLite where pages were reclaimable.

| Project | Memory stream | Snapshot bytes left unknown | SQLite |
| --- | ---: | ---: | ---: |
| Narrative Harness | 891,004 -> 261,926 B | 964,960 B | 618,496 B |
| Looma + Knit | 507,193 -> 261,272 B | 4,048,813 B | 966,656 -> 884,736 B |
| Jess | 0 B | 0 B | 208,896 B |
| Fair Labor License | 0 B | 0 B | 225,280 B |

The registered cache fell from about 46.9 MB to about 45.9 MB. The 5 NH and 4
Looma snapshot files were intentionally left in place because they have no
manifest/digest proof. This is the desired behavior: the cleanup produced a
measured reduction without pretending unowned historical data was safe.

Installed proof after the apply: `/api/stale-server` returned `stale:false`,
and `pnpm audit:project-state-performance` passed with a 25-28 ms fleet shell,
all seven projects current, no loading/error states, and all rich task/Thread
reads within their budgets.

## 2026-07-15 - Atomic gate proof on promoted projects

The next duplicated-state boundary was `run-gates`: it wrote gate results into
task definitions, proof-path records, and task evidence in separate operations.
That made `gateResults` both forbidden current-state payload and a second proof
authority, while a failed evidence write could be silently ignored.

Promoted projects now keep the task's proof-path detail, latest proof/current
evidence, and bounded evidence history in the existing SQLite mutation
transaction. The shared queue boundary receives the evidence inputs so the
tool does not open a second transaction or invent a parallel store. The legacy
path retains its compatibility export and file-backed history until promotion.

The default MCP project resource also no longer loads context-debug. Diagnostic
context remains available through its explicit resource; ordinary project
context therefore does not pay for or imply diagnostic history.

**Contract Touch Decision - `codex:atomic-gate-proof-2026-07-15`**

- **Touched contracts:** promoted task mutation input, SQLite current proof and
  bounded evidence history, run-gates persistence behavior, and the default MCP
  project resource.
- **Considered but not touched:** task schema version, proof-path vocabulary,
  legacy file layout, current summary payload shape, and Timeline/context
  resources.
- **Required follow-up:** migrate the next mutation class (runtime/evidence
  pairs) and make the remaining aggregate queue writer import/recovery-only.
- **Proof required:** promoted run-gates writes no `gateResults` into task
  detail, writes one current proof/history record, and advances the queue
  revision atomically; legacy persistence remains readable; default MCP project
  context does not include context-debug while the explicit context resource
  still does.
- **Proof provided:** the project-state database and run-gates suites pass
  (47 tests); MCP project-reader coverage asserts the diagnostic boundary.
- **Apply/revert:** the transaction is additive and uses existing tables. The
  legacy branch remains unchanged for non-promoted projects; reverting the
  caller keeps the old compatibility behavior without a data rewrite.

## 2026-07-15 - Targeted release selection and structural task deltas

The first caller migration exposed two different mutation shapes that should
not be forced through one generic queue replacement. Selecting a release
changes the current scope envelope and the selected-release pointer, but it
does not change task detail. Adding or splitting work changes a bounded set of
task records and their affected scope rows, but it does not need to rewrite
unrelated detail. Both are now explicit SQLite transactions behind the shared
project-state boundary.

The aggregate queue writer remains available for import, recovery, and mixed
mutations whose shape has not yet been proven. It is no longer the normal path
for a safe release selection, ordinary single-task edit, or a bounded
structural task delta. This is the model correction: the writer chooses a
transaction that matches the changed records instead of serializing the whole
project because the caller happened to hold a full compatibility export.

**Contract Touch Decision - `codex:targeted-release-selection-2026-07-15`**

- **Touched contracts:** release selection mutation, current scope ownership,
  shared queue revision/CAS, and summary/orientation projection updates.
- **Considered but not touched:** release schema, task detail payload,
  relationship records, public release API, and legacy `TASKS.json` export.
- **Required follow-up:** migrate relationship and attention/evidence
  mutations only after their changed-record boundaries are separately proven.
- **Proof required:** selected-release and scope changes commit atomically;
  task detail bytes remain unchanged; stale revisions are rejected; all shared
  projections agree after the write.
- **Proof provided:** project-state database and boundary tests cover the
  transaction, unchanged detail bytes, revision advancement, and the
  promoted shared-boundary route.
- **Apply/revert:** the legacy aggregate writer remains the compatibility
  fallback. Reverting the route does not require rewriting current data.

**Schema Migration Decision - `0.12.48/targeted-release-selection`**

- **Persisted schema touched:** none; existing `scopes`, `work_scope`,
  `work_item_detail`, `queue_state`, and projection tables are reused.
- **Change class:** write-path decomposition with CAS; no persisted schema
  migration.
- **Existing data impact:** none until a release selection is made; the
  mutation updates only the selected scope and its membership rows.
- **Compatibility reader:** existing SQLite readers and `TASKS.json` export.
- **Fixtures/tests:** release-selection transaction and shared-boundary tests.
- **Owner-facing plan text:** release selection is a bounded scope change,
  not a project-wide task rewrite.
- **Rollback/revert:** route fallback to the aggregate writer; no data copy is
  needed.

**Contract Touch Decision - `codex:targeted-structural-task-delta-2026-07-15`**

- **Touched contracts:** bounded task additions/edits/removals, affected scope
  rows, queue revision/CAS, and shared summary/orientation projection updates.
- **Considered but not touched:** release definitions/selection, relationship
  graph, evidence history, raw transcripts, and public task response shape.
- **Required follow-up:** give relationship changes their own delta contract;
  do not hide them inside a generic task batch.
- **Proof required:** new/split work and its parent commit atomically; untouched
  task detail payloads are not rewritten; release state remains unchanged;
  summary counts agree with the resulting detail index.
- **Proof provided:** project-state database and boundary tests cover a parent
  update plus child insertion, untouched detail bytes, and rich queue output.
- **Apply/revert:** unproven mixed edits remain on the aggregate compatibility
  path; reverting the targeted route does not require a data rewrite.

**Schema Migration Decision - `0.12.49/targeted-structural-task-delta`**

- **Persisted schema touched:** none; existing normalized work-item/detail and
  scope tables are reused.
- **Change class:** write-path decomposition with CAS; no persisted schema
  migration.
- **Existing data impact:** none until a structural task delta is applied; only
  changed/new tasks, explicit removals, and affected scope rows are touched.
- **Compatibility reader:** SQLite current-state reader and compatibility
  export continue to expose the same queue shape.
- **Fixtures/tests:** structural task-batch database and shared-boundary tests.
- **Owner-facing plan text:** a split is a task delta with explicit child
  records, not a request to rebuild every task in the project.
- **Rollback/revert:** leave the aggregate route available for mixed/import
  mutations; no existing records are deleted by the route change itself.

The remaining risk is explicit: the shared boundary still accepts callers that
arrive with a full queue, and targeted `WithSummary` paths still need a common
sanitization gate so forbidden diagnostic fields cannot re-enter current task
detail through a non-aggregate caller. Until those are addressed, this is a
measured reduction in write amplification, not the finished data-layer
redesign.

## 2026-07-15 - Reconnect history compatibility guard

The bounded reconnect-history compactor now preserves legacy scalar event
markers while compacting structured backend events. A migration fixture caught
that a line shaped like `{"event":"recent"}` was being rewritten as
`{"event":{}}`; the compactor now retains the scalar value (bounded by the
same text limit) instead of silently erasing it. This keeps the reduction
lossless for the legacy shape we still support and turns the failure into a
regression test rather than accepting unreadable history.

## 2026-07-15 - Retire unused Mastra substrate

The storage census found that every registered project had a
`guildhall-memory.db` containing only an empty Mastra/LibSQL schema. The
deterministic memory event stream is the active retrieval source; Mastra
retrieval is not wired into memory packets, so these databases were neither
current authority nor useful historical evidence. They were schema residue
created by an optional engine, not memory.

New read-only Mastra adapter construction now uses in-memory storage unless a
caller explicitly requests persistent storage. Write-mode automatic storage
remains durable for registered projects. A new migration retires an existing
database only after opening the known path, verifying every actual table is
empty, verifying all non-index objects are Mastra-owned, and rechecking under a
write lock. Any row, unknown object, or lock failure leaves the file in place.
The migration removes the database and SQLite sidecars only after that proof;
it is not an orphan-directory or age-based prune.

**Contract Touch Decision - `codex:unused-mastra-substrate-2026-07-15`**

- **Touched contracts:** Mastra adapter storage default, explicit empty
  substrate inspection, migration detection/apply result, and the boundary
  between deterministic memory authority and optional Mastra tooling.
- **Considered but not touched:** deterministic memory event schema, reviewed
  memory facts, task/release state, Mastra databases containing rows, and
  semantic/observational engine behavior when explicitly requested.
- **Required follow-up:** run the migration against the registered calibration
  projects and re-census; investigate any database that is not eligible rather
  than broadening the deletion rule.
- **Proof required:** implicit read-only construction creates no durable DB;
  empty known schema is retired; data-bearing and unknown-object DBs remain;
  current memory packets remain deterministic and source-backed.
- **Proof provided:** memory-core tests pass the three cases; migration
  definitions and the full migration suite remain green; real-project apply
  and post-apply census are still pending in this slice.
- **Apply/revert:** the migration is idempotent after the DB is absent. Revert
  restores the optional adapter code but does not recreate retired empty
  schemas. A data-bearing database is never touched by this migration.

**Schema Migration Decision - `0.12.50/memory-empty-mastra-substrate`**

- **Persisted schema touched:** no current project schema; system-local
  optional Mastra database files may be removed only when empty.
- **Change class:** explicit retirement of proven-unused substrate; no task,
  memory-event, release, or summary rewrite.
- **Existing data impact:** zero for eligible databases because all tables are
  empty; data-bearing or unexpected databases remain untouched.
- **Migration id:** `0.12.50/memory-empty-mastra-substrate`.
- **Compatibility reader:** deterministic memory reads remain unchanged;
  explicit persistent Mastra requests still create/read the optional engine.
- **Fixtures/tests:** `src/memory-core/__tests__/memory-core.test.ts` covers
  empty, data-bearing, and implicit-read cases; migration suite validates the
  built-in definition.
- **Owner-facing plan text:** the migration reports the exact empty substrate
  path and reclaimed bytes; it does not call the result orphaned.
- **Rollback/revert:** no data rollback is required for an empty schema. Any
  non-empty/unknown database is preserved as the compatibility boundary.

### Real-project apply proof

The installed migration was dry-run first, then applied with the Guildhall
service stopped to avoid an open optional-engine handle. It applied cleanly to
all seven registered projects: Narrative Harness, Looma + Knit, Jess, Fair
Labor License, T-minus T, Font Something, and Commerce Project. There were
zero failures, and a second migration plan reported no pending instance of
`0.12.50/memory-empty-mastra-substrate`.

The registered cache changed from **45,897,373 B (43.77 MiB)** to
**42,824,872 B (40.84 MiB)**, a reduction of **3,072,501 B**. All seven
`guildhall-memory.db` files are absent; current project-state SQLite remains
**2,609,152 B (2.49 MiB)** in total. After restart, `/api/stale-server`
reported `stale:false` and `pnpm audit:project-state-performance` passed:
fleet **35.83 ms / 25,412 B**, all seven projects current, no loading/errors,
and every cold, warm, rich-task, and current-Thread read within budget.

### Post-cleanup census and performance proof

The explicit bounded project-state cleanup was then applied to the remaining
three calibrated projects: T-minus T, Font Something, and Commerce Project.
The operation compacted session snapshots, context-debug ledgers, reconnect
events, and task evidence; sanitized forbidden diagnostic fields from current
task records; and vacuumed SQLite where safe. It did not remove unverified
migration or evacuation payloads.

The registered project-cache set is now **27,982,508 B (26.69 MiB)**, down
**17,914,865 B (39.0%)** from the 45,897,373-byte baseline. Current-state
SQLite remains **2,609,152 B (2.49 MiB)** across all seven projects. The
largest remaining registered files are explainable historical or compatibility
owners: Looma's legacy task snapshots and progress exports, Font's full
codebase map, and Narrative Harness's compatibility backups. They are not
request-time project-state inputs.

The global cache directory still contains **3,463,239,374 B (3.30 GiB)** in
52,633 directories. **52,626** are unregistered and there are no active cache
leases in the census. These are historical/test residues without an ownership
manifest, so the current migration deliberately leaves them untouched. This
is a data-ownership problem to solve with an explicit, provenance-checked
retirement operation, not a generic age-based prune.

Installed proof after the cleanup: `/api/stale-server` reported `stale:false`.
The project-state performance audit passed with fleet load at **34.27 ms /
25,412 B** for seven projects; cold project reads were **13.85–47.51 ms**,
rich reads **21.04–202.14 ms**, and current-Thread reads **4.55–20.61 ms**.
All projects were current with no loading or error states.

## 2026-07-15 - Persistence boundary rejects hidden weight

The file-backed persistence layer had two remaining ways to recreate the
problem: every event read loaded the entire JSONL stream before applying its
retention policy, and `writeRecord` accepted an arbitrarily large payload even
when it was classified as active/debug/ephemeral state. Both behaviors made a
bounded model depend on caller discipline.

Event reads now take a bounded tail sized to the selected retention policy and
discard a partial first JSONL line before parsing. This keeps legacy oversized
streams readable without loading their discarded prefix. Durable records now
have envelope-inclusive byte limits matching their retention class; an
oversized write fails with an instruction to store bulky evidence as an
artifact or compact summary. Nothing is silently truncated.

**Contract Touch Decision - `codex:persistence-size-boundary-2026-07-15`**

- **Touched contracts:** file-backed event read behavior, durable record write
  acceptance, retention-class byte budgets, and the artifact-vs-record
  storage boundary.
- **Considered but not touched:** task/release schemas, SQLite current-state
  tables, existing artifact contents, and historical files already on disk.
- **Required follow-up:** add an explicit provenance-checked retirement path
  for unknown global cache directories; do not make this writer change delete
  old data.
- **Proof required:** oversized records are rejected, oversized legacy event
  streams return only the retained tail, normal event deduplication remains
  correct, and lint/contract checks pass.
- **Proof provided:** `src/persistence/__tests__/file-backed.test.ts` passes
  eight tests covering the new limits, legacy tail read, deduplication, and
  artifact resolution; `pnpm lint:data-layer`, `pnpm lint:contracts`, and
  `git diff --check` pass.
- **Apply/revert:** callers that need to retain large raw evidence must use an
  artifact or an explicit archive class; reverting the guard restores the old
  unbounded write risk and requires no data migration.

**Schema Migration Decision - `0.12.51/persistence-size-boundary`**

- **Persisted schema touched:** none; this changes acceptance and read limits
  for existing file-backed persistence envelopes.
- **Change class:** runtime boundary hardening; no rewrite of existing records.
- **Existing data impact:** oversized legacy event files are read from their
  retention-sized tail; existing records remain on disk until an explicit
  owner-verifiable migration handles them.
- **Migration id:** `0.12.51/persistence-size-boundary` (contract version,
  not an automatic data rewrite).
- **Compatibility reader:** JSONL parsing and record schemas remain unchanged;
  only the discarded prefix outside the declared retention window is skipped.
- **Fixtures/tests:** file-backed persistence tests cover both new rejection
  and old oversized-stream compatibility.
- **Owner-facing plan text:** large evidence belongs in an artifact or compact
  summary, not a project-state record.
- **Rollback/revert:** code-only revert; no persisted data is deleted.

### Installed proof after the boundary change

The fresh build was installed and the service restarted. `/api/stale-server`
reported `stale:false`. The project-state performance audit passed with fleet
load at **25.50 ms / 25,412 B** for seven projects; cold reads were
**8.42–29.79 ms**, rich reads **32.37–359.96 ms**, and current-Thread reads
**5.40–25.70 ms**. All projects were current with no loading or error states.

## 2026-07-15 - Repository state leaves the initial task read

- **User job:** opening a task should show the saved work and current Guildhall
  state immediately; it should not run `git status`, inspect worktrees, or
  rebuild repository closure merely because the drawer opened.
- **Finding:** the SQLite `repositories` table already existed, but only had a
  writer and no read path. The initial task-detail endpoint still called
  `gitStoryForTaskIfUseful`, so a cold task read could spend seconds in Git
  inspection even though the response was only a small drawer payload.
- **Change:** the existing repository table becomes the current repository
  snapshot projection. Explicit `/git-story` reads refresh the projection;
  ordinary task detail reads consume a cached task snapshot or the saved
  compatibility value, and expose the explicit refresh link instead of doing
  live inspection. The Origin tab requests that refresh only when opened.
- **Why this is a data-model change:** repository state is now treated as a
  current projection with an inspection timestamp and freshness boundary,
  rather than an incidental side effect of rendering task detail. No second
  Git Story model or task-definition rewrite is introduced.

**Contract Touch Decision - `codex:repository-projection-read-boundary-2026-07-15`**

- **Touched contracts:** current repository projection reads/writes, task
  detail payload omission of live Git inspection, explicit task Git Story
  refresh, and Origin-tab loading behavior.
- **Considered but not touched:** Git classification rules, merge/closure
  actions, task history, task definitions, release readiness semantics, and
  the historical Git Story endpoint shape.
- **Required follow-up:** wire external repository-change invalidation and
  migrate project/release readiness to consume the same cached repository
  projection without silently treating stale snapshots as current.
- **Proof required:** initial task reads do not invoke Git; explicit refresh
  stores and returns the snapshot; the Origin tab still exposes live state;
  task detail latency remains within the documented budget.
- **Proof provided:** pending implementation and focused runtime/UI tests in
  this change set; installed performance proof will be rerun after build.
- **Apply/revert:** reader/refresh code is reversible without task-history
  migration. Existing task `gitStory` fields remain compatibility values; no
  data is deleted.

**Schema Migration Decision - `0.12.52/repository-projection-read-boundary`**

- **Persisted schema touched:** existing SQLite `repositories` table only;
  no new table or column is required.
- **Change class:** activate an existing current-state projection and add a
  compatibility reader; explicit refreshes may add bounded repository rows.
- **Existing data impact:** none for task definitions or history. Rows are
  current snapshots with inspection timestamps, not copied transcripts.
- **Migration id:** `0.12.52/repository-projection-read-boundary`.
- **Compatibility reader:** missing projection rows fall back to the saved
  task-level Git Story value or an explicit live refresh; ordinary reads never
  manufacture a row by scanning Git.
- **Fixtures/tests:** repository database point-read tests, task endpoint
  boundary tests, and drawer Origin-tab lazy-load tests.
- **Owner-facing plan text:** “Repository state was last inspected at …”; a
  stale or missing snapshot is explicit rather than presented as fresh.
- **Rollback/revert:** keep the table and rows; restoring the old reader would
  reintroduce request-time Git work but would not require data rewriting.

### Installed proof after the repository read boundary

- Fresh `pnpm build && pnpm dev:install` completed; `guildhall stop &&
  guildhall start` installed the current artifact and `/api/stale-server`
  reported `stale:false`.
- The installed performance audit passed: fleet **38.04 ms / 25,412 B**;
  cold project reads **16.64–47.33 ms**; warm reads **4.22–22.76 ms**;
  rich task reads **27.15–31.41 ms**; and current Thread reads
  **5.33–30.85 ms**. All seven projects were current with no loading/errors.
- A direct initial task read measured about **10 ms** for representative
  Looma, Font, and Narrative Harness tasks. A live Font Git Story refresh took
  **460 ms**, then persisted a snapshot whose state and inspection timestamp
  appeared in the next ordinary task read.
- The focused database and drawer/runtime checks passed **114 tests**. The
  broad `serve-task-endpoints` file still has unrelated dirty-fixture and
  migration-contract failures; those remain evidence to triage, not reasons
  to weaken this boundary.

## 2026-07-15 - Improvement review stops mutating task definitions

- **User job:** Guildhall may record a bounded advisory review while work is
  active, but opening or rewriting a task must not duplicate that advisory
  state inside the task definition.
- **Finding:** `reviewInProcessWorkForGuildhallImprovements` read tasks, added
  generated notes to `task.notes`, and rewrote the queue. That made a runtime
  observation part of the current task payload and forced the summary writer
  to touch the task-detail store for information that does not define the work.
- **Change:** the lane now appends one bounded `note` evidence event with a
  stable id. It does not update `task.updatedAt`, rewrite `TASKS.json`, or
  rewrite the SQLite task-detail row. Duplicate detection checks both legacy
  task notes and the bounded evidence reader during compatibility transition.
- **Why this matters:** task definitions remain the source for accepted work;
  runtime/advisory history remains in the existing evidence store. The change
  removes one concrete dual-write path instead of adding another projection.

**Contract Touch Decision - `codex:improvement-review-evidence-boundary-2026-07-15`**

- **Touched contracts:** improvement-review persistence, duplicate detection,
  and task-detail write behavior.
- **Considered but not touched:** Task schema, evidence kinds, evidence
  retention limits, summary math, design-lens findings, and UI payload shape.
- **Required follow-up:** audit the remaining direct queue writers and convert
  each runtime/evidence mutation to the same separated boundary.
- **Proof required:** the lane must be idempotent, bounded, leave task
  definitions unchanged, and work for both legacy and database authority.
- **Proof provided:** focused improvement-review suite passes 6 tests;
  data-layer and contract guardrails pass. Database-authority coverage remains
  part of the next mutation-boundary test slice.
- **Apply/revert:** code-only revert; evidence records remain valid and can be
  read by the compatibility projection.

**Schema Migration Decision - `0.12.53/improvement-review-evidence-boundary`**

- **Persisted schema touched:** none; the existing `note` evidence kind is
  reused.
- **Change class:** writer-routing change with no record rewrite.
- **Existing data impact:** legacy generated notes remain readable; new notes
  stop enlarging task definitions.
- **Migration id:** `0.12.53/improvement-review-evidence-boundary`.
- **Compatibility reader:** effective-task continues to project note evidence
  into the legacy task-shaped response when a detail surface explicitly asks
  for it.
- **Fixtures/tests:** `src/runtime/__tests__/improvement-review.test.ts`.
- **Owner-facing plan text:** advisory review history is separate from the
  work definition and is bounded like other task evidence.
- **Rollback/revert:** restoring the old writer would reintroduce duplication;
  no data migration is needed to revert the code.

### Installed proof and current size baseline

- Fresh `pnpm build`, `pnpm dev:install`, and `guildhall stop && guildhall
  start` completed. `/api/stale-server` reported `stale:false` for the
  installed artifact.
- `pnpm audit:project-state-performance` passed for all seven registered
  projects: fleet **24.89 ms / 25,411 B**; cold project reads
  **7.81–33.91 ms**; rich task reads **25.51–29.52 ms**; and current Thread
  reads **4.39–25.04 ms**. No project reported loading or error state.
- The durable registered cache is **27,986,604 B (26.69 MiB)**. The current
  project-state SQLite files total **2,613,248 B (2.49 MiB)**. This measures
  the state the app actually needs for current reads, not raw transcript/debug
  history.
- The cache root is still **3,463,243,470 B (3.23 GiB)**, including **52,626
  unregistered/unknown entries**. Those entries were not deleted: provenance
  must be established before cleanup. This is an explicit remaining storage
  problem, not a claimed success.
- Full repository typecheck remains red in broad pre-existing importer,
  task-contract, transition, and test-fixture surfaces. The touched
  project-state paths have no filtered type errors; build, focused tests,
  data-layer lint, contract lint, and installed runtime proof pass.

## 2026-07-15 - Overlay snapshots synchronize by row diff

The runtime and workspace stores still expose a complete-snapshot API to
legacy callers, but the SQLite writer no longer implements that API as
`DELETE everything; INSERT everything`. It compares the incoming rows with
the existing `task_execution` or `task_workspace` rows, updates only changed
tasks, removes only disappeared tasks, and leaves the project revision alone
when the snapshot is identical. A one-task runtime update therefore does not
rewrite unrelated task payloads or create a false summary invalidation.

**Contract Touch Decision - `codex:overlay-diff-sync-2026-07-15`**

- **Touched contracts:** runtime/workspace overlay persistence semantics and
  revision invalidation behavior.
- **Considered but not touched:** overlay payload shape, task identity,
  evidence retention, queue definitions, and public API names.
- **Required follow-up:** migrate direct runtime writers that still model a
  whole-store snapshot when they can express a point update.
- **Proof provided:** database regression coverage proves an untouched runtime
  row remains byte-identical and a changed row advances the project revision
  once; existing task-state coverage remains green.
- **Apply/revert:** the snapshot API remains compatible; reverting restores
  the old write implementation without a data migration.

**Schema Migration Decision - `codex:overlay-diff-sync-2026-07-15`**

- **Persisted schema touched:** none.
- **Change class:** write-path behavior only.
- **Existing data impact:** none; current overlay rows are read as-is.
- **Compatibility reader:** unchanged database and legacy-file readers.
- **Rollback/revert:** code-only rollback; no persisted conversion required.

### Installed proof after the improvement-review boundary

- Fresh `pnpm build` and `pnpm dev:install` completed; `guildhall stop &&
  guildhall start` installed the current artifact and `/api/stale-server`
  reported `stale:false`.
- The installed project-state audit passed: fleet **27.58 ms / 25,412 B**;
  cold project reads **10.22–36.58 ms**; rich task reads **25.60–80.63 ms**;
  and current Thread reads **5.24–25.04 ms**. All seven projects were
  current with no loading or error states.

## 2026-07-15 - Point mutations use indexed summaries and task-local detail revisions

The first ordinary task-detail mutation, `add-acceptance`, now uses a
promoted-project point transaction. It reads one task detail and the queue CAS
revision from SQLite, projects the changed compact task row and shared summary
from `work_items`, `work_scope`, the release envelope, and the existing compact
summary, then commits the detail, index, scope, and summary atomically. It does
not open the other task definitions, replay transcripts, or reconstruct a full
queue. Legacy and incomplete-index projects retain the explicit compatibility
writer.

The transaction exposed a deeper data-model defect: `work_item_detail.revision`
had been treated as if every detail row needed the newest queue revision. That
forced each point mutation and release-selection change to update every detail
row even when no payload changed. The field now means “last queue revision that
changed this task payload”; the queue revision remains the CAS/read-model
watermark. Rich reads accept the current set of per-task detail rows, so
untouched payloads and their metadata stay untouched.

**Contract Touch Decision - `codex:indexed-point-mutation-2026-07-15`**

- **Touched contracts:** promoted task-detail mutation routing, indexed summary
  reconstruction, scope proof/blocker facts, and the meaning of the per-task
  detail revision field.
- **Considered but not touched:** task identity, release vocabulary, evidence
  retention, runtime overlays, public endpoint names, and historical transcripts.
- **Required follow-up:** migrate the remaining ordinary task writers and
  coordinate evidence/attention updates at the same logical mutation boundary.
- **Proof required:** one-task edits must preserve untouched detail bytes;
  indexed summary facts must match the full projection; stale CAS writers must
  fail before partial writes; release-only changes must not touch detail rows.
- **Proof provided:** focused endpoint, boundary, database, and summary parity
  tests pass; the data-layer guardrail passes. Installed proof is pending the
  next build/install cycle.
- **Apply/revert:** promoted projects use the point path when its invariants
  hold; legacy/incomplete-index projects fall through to compatibility. No
  persisted conversion is needed to revert routing.

**Schema Migration Decision - `codex:indexed-point-mutation-2026-07-15`**

- **Persisted schema touched:** existing `work_scope` gains the additive
  `proof_blocked` and nullable `blocker_summary` columns; `work_item_detail`
  keeps its existing `revision` column but changes its documented meaning from
  queue-wide snapshot revision to task-payload revision.
- **Change class:** additive read-model fields plus a reader-compatible
  revision-semantics correction; no task/history rewrite is required.
- **Existing data impact:** old detail rows remain valid. Existing databases
  receive safe defaults for the two scope columns; the next summary refresh
  repopulates them from current scope facts.
- **Compatibility reader:** older detail rows are accepted when their task row
  exists; queue and summary revisions still guard current-state mutations.
- **Fixtures/tests:** SQLite schema tests, promoted point-mutation tests,
  indexed/full summary parity, endpoint acceptance tests, and untouched-payload
  assertions.
- **Owner-facing plan text:** a task’s saved detail is separate from the
  project’s current summary revision; changing scope does not rewrite task
  prose.
- **Rollback/revert:** route writes back to the aggregate compatibility writer;
  no data deletion or detail conversion is needed.

## 2026-07-15 - Explicit current-state cutover migration

The migration path now has a named finish line instead of allowing historical
current-state formats to live indefinitely. `0.13.0/project-state-finalize`
verifies SQLite authority, a complete per-task detail index, and a current
summary before removing `TASKS.json`, the aggregate/sidecar queue-detail
payloads, and the old filesystem summary projection. The migration is
available through `pnpm migrate:project-state`; `--dry-run` prints the plan,
and normal execution first applies earlier migrations before explicitly
applying this required cutover.

The important boundary is now enforced in code: one-time migration code may
understand historical files so it can convert them, but ordinary current-state
readers do not use those files as a second mutable authority. Queue reads use
indexed SQLite detail only; summary reads use the SQLite projection only. The
old queue normalizer and summary-sidecar parser are named migration modules and
are reachable only from migration/backfill or explicit repair code. A missing
current row fails closed with a migration error instead of silently reviving a
historical payload.

**Contract Touch Decision - `codex:project-state-final-cutover-2026-07-15`**

- **Touched contracts:** project migration command behavior, current-state
  authority boundary, and removal of duplicate current-state files.
- **Considered but not touched:** task payload shape, release vocabulary,
  historical evidence retention, transcript history, and runtime overlays.
- **Required follow-up:** keep adding migration-boundary tests when a new
  persisted projection is introduced; do not add a normal-read fallback for a
  retired shape.
- **Proof provided:** the migration suite verifies the deletion gate,
  idempotence, SQLite queue readability after deletion, and the existing
  authority/detail-index tests remain green.
- **Apply/revert:** the migration is intentionally destructive only to
  duplicate current-state files; rollback is a code rollback plus restoration
  from the existing migration snapshot if a project fails verification.

**Schema Migration Decision - `codex:project-state-final-cutover-2026-07-15`**

- **Persisted schema touched:** no new columns; the migration consumes the
  existing SQLite authority, task-detail index, and summary tables.
- **Change class:** representation cutover and deletion of duplicate current
  state, not a task/history rewrite.
- **Existing data impact:** historical evidence and bounded operational
  streams remain; only current-state duplicates are removed after verification.
- **Migration id:** `0.13.0/project-state-finalize`.
- **Compatibility reader:** the old queue and summary readers are explicitly
  migration-only. Post-cutover reads use SQLite and do not consult the files
  they imported.
- **Fixtures/tests:** finalization migration test, idempotence assertion,
  queue read after file deletion, migration script dry-run path.
- **Rollback/revert:** do not restore old runtime fallback behavior as a
  permanent design; use the recorded migration snapshot if a failed cutover
  needs data recovery.

## 2026-07-15 - Migration-only historical-shape boundary

The migration path is now testable independently of the application read path.
`pnpm migrate:project-state --dry-run` reports the required final cutover, and
`pnpm migrate:project-state --all` applies earlier migrations before running
`0.13.0/project-state-finalize` explicitly. The final migration verifies the
SQLite metadata, queue envelope, every indexed task definition, and current
summary before removing duplicate `TASKS.json`, queue-detail, and
`project-summary.json` files.

The application no longer “supports” those old shapes. `readProjectTaskQueue*`,
`readProjectSummaryProjection`, fleet shells, task drawers, release summaries,
and ordinary writers all cross the current SQLite boundary. Historical queue
normalization, summary-sidecar import, and pre-cutover detail reads are named
and isolated as migration-only operations. Repair code that must recover a
pre-cutover project performs an explicit raw import and immediately writes the
current model; it is not a GET-time fallback.

This distinction matters for the data model, not just code cleanliness. A
fallback makes the same project have two possible truths and hides incomplete
migrations until a request happens to hit the old file. The current contract
has one answer: SQLite is the current state; historical files are inputs to a
one-time conversion or rollback snapshot. Missing indexed detail is an
actionable migration failure, not an invitation to rebuild state from a stale
blob.

**Schema Migration Decision - `codex:strict-current-read-boundary-2026-07-15`**

- **Persisted schema touched:** current project queue/detail/summary authority;
  no new persisted fields.
- **Change class:** reader-boundary removal plus explicit migration import.
- **Existing data impact:** projects that have crossed `0.13.0` are unchanged;
  pre-cutover projects must run the migration before normal reads. Historical
  evidence, bounded Thread history, and rollback snapshots remain separate.
- **Migration id:** `0.13.0/project-state-finalize`.
- **Compatibility reader:** only `readProjectStateDatabaseQueueDefinitionForMigration`,
  `readProjectSummaryProjectionForMigration`, and explicit maintenance/repair
  imports may read retired files.
- **Fixtures/tests:** strict summary-sidecar rejection, strict queue-detail
  rejection, finalization deletion/idempotence, and the focused database/runtime
  suite.
- **Rollback/revert:** restore from the evacuation manifest or rerun the
  migration against an uncut project; do not reintroduce request-time fallback.

## 2026-07-17 - Current orientation API excludes intake authority

The Release mismatch exposed a narrower version of the same architectural
failure: even after current work moved behind SQLite, the shared orientation
builder still advertised an input shape that could combine materialized work
with an intake draft. That made the forbidden combination look like a normal
supported operation, even though the current-state wrapper discarded the draft
at runtime.

The wrapper now accepts `Omit<BuildProjectOrientationSpineInput,
'workspaceImportDraft'>`. Current project, Release, Map, Work, and start-state
calculations can only receive current task/release/scope data from the project
state boundary. Explicit workspace import remains draft-aware, but it is a
separate intake operation and cannot be passed through the current-state
builder. The three route call sites that attempted to load a draft before
release selection or source-conflict reconciliation were removed; they were
dead request-time reconstruction, not a valid source of current truth.

This is the intended DRY guarantee: one data-management layer owns current
identity, membership, counts, and scope; views choose a read shape, not a data
source. A route may still request a named live diagnostic, but it cannot merge
diagnostic or intake candidates into current task identity. The existing
intake-only Release regression proves the visible behavior, and the narrowed
input type prevents this particular authority violation from returning through
the shared wrapper.

**Contract Touch Decision - `codex:current-orientation-boundary-excludes-intake-2026-07-17`**

- **Touched contracts:** internal current-orientation builder input and route
  callers for release selection and source-conflict reconciliation.
- **Considered but not touched:** explicit workspace-import draft schema,
  public Release response shape, and persisted task/release records.
- **Required follow-up:** migrate remaining ordinary runtime readers to the
  same project-state boundary and remove dead draft construction from runtime
  modules once explicit intake owns it.
- **Proof provided:** 180 focused orientation/read-boundary/release tests,
  including the intake-only Release mismatch fixture.
- **Apply/revert:** code-only revert; no persisted data changes.

**Schema Migration Decision - `codex:current-orientation-boundary-excludes-intake-2026-07-17`**

- **Persisted schema touched:** none.
- **Change class:** type/API boundary tightening.
- **Existing data impact:** none; intake drafts remain available to the explicit
  import flow and current materialized records are unchanged.
- **Migration id:** not required.
- **Compatibility reader:** no new reader; current reads continue through the
  existing project-state boundary.
- **Rollback/revert:** restore the wider input type and removed arguments; no
  database rollback is needed.

## 2026-07-17 - Fleet shell consumes one projection request

The fleet audit found a client-side data-boundary violation even though the
server already exposed a compact fleet projection. `ProjectsHome` loaded the
lightweight project list and then fanned out into one richer `/api/service`
request per project, using a two-worker queue and a 12-second timeout. That
made the UI wait for data it did not need and made a project with a slow or
broken detail read hold the fleet shell hostage.

`ProjectsHome` now uses `/api/service/projects` for initial load, background
polling, and action refreshes. Rich project state remains an explicit project
route. This is a product-level application of the same authority rule: the
fleet surface chooses the fleet projection; it does not assemble its own
summary by joining a registry row to per-project detail responses.

**Contract Touch Decision - `codex:fleet-shell-single-projection-read-2026-07-17`**

- **Touched contracts:** ProjectsHome fleet refresh behavior and the existing
  lightweight `/api/service/projects` response.
- **Considered but not touched:** project detail payloads, project-store detail
  hydration, server fleet summary fields, and diagnostic/history routes.
- **Required follow-up:** introduce the same explicit summary-only versus
  inventory/detail split inside project and Release routes.
- **Proof provided:** 21 ProjectsHome tests, production build, installed
  restart, and live shell inspection with seven projects and no loading/error
  entries.
- **Apply/revert:** client-only revert; no persisted data changes.

**Schema Migration Decision - `codex:fleet-shell-single-projection-read-2026-07-17`**

- **Persisted schema touched:** none.
- **Change class:** client read-path consolidation.
- **Existing data impact:** none; existing fleet projection data is reused.
- **Migration id:** not required.
- **Compatibility reader:** `/api/service?projectId=...` remains available for
  explicit detail callers, never as the fleet-shell fallback.
- **Rollback/revert:** restore the old client hydration loop; no data rollback.

## 2026-07-17 - Saved Release is a read model over one snapshot

The first saved-Release reader still had the wrong shape internally: it
returned an object with no task array, but it reached that shape by loading the
full aggregate task/detail model and then throwing most of it away. That was a
performance optimization at the route boundary, not a real data-model fix.

The sessions layer now exposes a purpose-built saved Release snapshot. It reads
the compact queue envelope, normalized release/scope membership, saved summary,
repositories, diagnostics, and revision watermarks in one transaction. It does
not open task detail blobs, task overlays, evidence, or Git state. The runtime
boundary converts the storage wrapper into the product read model once; the
route only formats it.

This is the DRY rule made concrete: read models may be different, but their
facts come from one state-management layer and one revision snapshot. A route
cannot decide to manufacture current work from intake, cannot choose a second
release identity, and cannot silently upgrade a summary request into a detail
read. Explicit live diagnostics and explicit intake remain separate operations.

The release formatter now gets release identity from the durable queue/scopes
envelope and counts/readiness from the saved summary projection. That handles
older projections that omitted copied release metadata without inventing a
release or its membership.

**Contract Touch Decision - `codex:saved-release-single-snapshot-2026-07-17`**

- **Touched contracts:** sessions saved-Release read model, project-state
  boundary summary normalization, and saved Release response formatting.
- **Considered but not touched:** rich task detail, intake drafts, live Git
  diagnostics, delivery state, and public Release URL/field names.
- **Required follow-up:** migrate remaining ordinary project/detail readers to
  explicit summary, inventory, point-detail, or diagnostic readers. The next
  architecture pass must remove request-time reconstruction from delivery and
  Thread paths too.
- **Proof provided:** 16 project-state-boundary tests, 32 read-boundary tests,
  79 release-readiness tests, data-layer lint, and the regression that caught
  the incomplete release projection.
- **Apply/revert:** code-only revert; no persisted rows are rewritten.

**Schema Migration Decision - `codex:saved-release-single-snapshot-2026-07-17`**

- **Persisted schema touched:** none. Existing queue, scope, membership,
  summary, repository, diagnostic, and revision tables are reused.
- **Change class:** read-model consolidation; no migration required.
- **Existing data impact:** none. Older summary rows remain readable because
  release identity comes from the durable envelope.
- **Migration id:** not required.
- **Compatibility reader:** promoted projects use the saved snapshot reader;
  legacy compatibility remains only before current-state cutover.
- **Fixtures/tests:** saved Release no-expansion, release identity, and
  current-state boundary regressions.
- **Rollback/revert:** code-only revert; no data rollback.

## 2026-07-17 - Delivery becomes a saved revisioned read model

The compact delivery boundary was necessary but insufficient: it made routes
share indexed task rows while still deriving queue ranking and relationship
facts in each request. The delivery read projection finishes that boundary.

Promoted projects now have one saved delivery projection in the same SQLite
database as current project state. It stores queue candidate ranks, bounded
task summaries, primitive relations, and relationship edges. Every projection
records the queue revision, project revision, delivery-model timestamp, and
refresh time that produced it. The route layer reads this typed projection;
it does not choose between SQLite, an intake snapshot, and a task file.

Projection refresh runs in the asynchronous projector after task, release,
delivery, evidence, runtime, workspace, reconciliation, or diagnostic changes.
GET routes return a clear missing/stale response while refresh is pending.
That makes the old Release failure structurally unrepresentable on ordinary
paths: a route can use a different named view, but it cannot invent a second
current-state source.

**Contract Touch Decision - `codex:delivery-read-projection-2026-07-17`**

- **Touched contracts:** delivery-spine/queue freshness, task relationship and
  context-packet reads, projection refresh, and source revision watermarks.
- **Considered but not touched:** rich task detail, Release readiness counts,
  live Git diagnostics, and pre-promotion task-file reads.
- **Required follow-up:** remove remaining compatibility-file reads from
  delivery mutation helpers and include projection freshness in the project
  delivery summary.
- **Proof provided:** projection tests, 35 read-boundary tests, lints, and
  whitespace validation.
- **Apply/revert:** derived tables can be dropped and rebuilt; ordinary reads
  fail closed while they are unavailable.

**Schema Migration Decision - `codex:delivery-read-projection-2026-07-17`**

- **Persisted schema touched:** additive SQLite delivery projection tables for
  metadata, candidates, edges, and primitive relations.
- **Change class:** additive derived projection with internal schema version;
  refresh creates tables idempotently and replaces one complete snapshot in a
  transaction.
- **Existing data impact:** authoritative task, release, and evidence rows are
  unchanged.
- **Migration id:** `0.13.3/delivery-read-projection` creates the derived
  tables idempotently before the asynchronous projector populates their rows.
- **Safety:** missing/stale reads are explicit and the async projector rebuilds
  from authoritative state.
- **Compatibility reader:** legacy delivery calculation is allowed only for
  unpromoted projects.
- **Fixtures/tests:** bounded projection pages, stale revision, relationship
  point read, and promoted route boundary fixtures.
- **Rollback/revert:** remove derived tables or revert the reader; source state
  is unaffected.

## 2026-07-17 - Delivery enters through the compact state boundary

The first delivery step removes a direct source divergence. Promoted
delivery-spine, queue, task-relationship, and context-packet routes now read
compact indexed task rows from the same project-state boundary used by the
graph. They no longer hydrate the full task-definition store or call the
aggregate SQLite queue reader during ordinary requests.

This is deliberately not being counted as the finished delivery migration.
The routes still derive relationships and runnable ranking in request code.
The next step is a saved delivery projection keyed by the same project-state
revision, with explicit `current`, `stale`, and `missing` states. A normal GET
will read that projection or tell the caller to refresh; it will not reconstruct
delivery facts from another source.

**Contract Touch Decision - `codex:delivery-compact-boundary-2026-07-17`**

- **Touched contracts:** `readProjectDeliveryTasks`, compact indexed task rows
  supplied to delivery routes, and delivery/context route boundaries.
- **Considered but not touched:** delivery projection tables, runnable
  ranking, normalized relationship projections, and legacy compatibility reads.
- **Required follow-up:** implement the revisioned delivery projection and make
  ordinary delivery routes consume it without request-time queue derivation.
- **Proof provided:** 35 read-boundary tests, delivery endpoint coverage,
  data-layer lint, and whitespace validation.
- **Apply/revert:** code-only revert; no persisted data change.

**Schema Migration Decision - `codex:delivery-compact-boundary-2026-07-17`**

- **Persisted schema touched:** none; existing compact summaries are reused.
- **Change class:** read-path and authority-boundary tightening.
- **Existing data impact:** none; promoted delivery reads stop widening into
  task definitions.
- **Migration id:** not required for this intermediate step.
- **Compatibility reader:** legacy task-file reads remain explicit and are
  selected only before current-state promotion.
- **Fixtures/tests:** compact delivery route boundary and task endpoint tests.
- **Rollback/revert:** code-only revert; no data rollback.

## 2026-07-17 - Promoted reads fail closed on missing projections

The saved Release boundary now checks authority before selecting a reader. A
promoted project cannot fall through to the old aggregate current-state reader
when its saved projection is missing. That would make the new data model
optional precisely when it is unhealthy, and would allow a retired queue/detail
shape to become a hidden second authority again.

Only projects that have not crossed the current-state cutover may use the
explicit legacy reader. A promoted project instead reports that its saved
projection must be refreshed or migrated. The failure is intentionally loud and
repairable; it does not fabricate a partial Release answer.

**Contract Touch Decision - `codex:promoted-release-read-fail-closed-2026-07-17`**

- **Touched contracts:** promoted saved Release boundary and projection
  unavailable error behavior.
- **Considered but not touched:** legacy reads, migration imports, public
  Release fields, and rich diagnostics.
- **Required follow-up:** apply the same no-fallback rule to every promoted
  project route that still selects an aggregate reader after a projection miss.
- **Proof provided:** boundary regression for a promoted database with a
  deleted `queue_state` row.
- **Apply/revert:** code-only revert; no persisted data change.

**Schema Migration Decision - `codex:promoted-release-read-fail-closed-2026-07-17`**

- **Persisted schema touched:** none.
- **Change class:** authority and failure-mode tightening.
- **Existing data impact:** promoted projects with missing projections expose a
  repairable error rather than silently reading a retired source.
- **Migration id:** not required.
- **Compatibility reader:** legacy-only, selected only after the authority
  boundary proves the project is not promoted.
- **Rollback/revert:** code-only revert; no data rollback.

## 2026-07-17 - One compact graph projection, one task authority

The Release mismatch exposed the exact failure mode this plan is intended to
eliminate: one route manufactured work from an intake snapshot while another
read materialized SQLite rows. The durable fix is structural. Routes may ask
for different read models, but every current-state fact must come through a
named sessions/runtime boundary over one revisioned snapshot. A route must not
choose between sources or silently widen a compact read into rich detail.

The project graph was still violating the performance side of that rule. It
loaded the full map definition set to discover contract-review packets. The
packet summaries now live in the existing indexed task summary projection, and
the graph route uses a compact graph boundary. Full definitions are now
reserved for point/detail and explicit diagnostic workflows.

Migration `0.13.2/compact-task-read-models` backfills the compact packets from
the authoritative per-task detail index. Subsequent task writes compute the
same summary in the existing write transaction, so the graph cannot drift into
a second packet authority.

**Contract Touch Decision - `codex:graph-compact-read-model-2026-07-17`**

- **Touched contracts:** indexed task summary payload, graph read boundary,
  and project-graph packet discovery.
- **Considered but not touched:** rich task detail, Release readiness,
  contract-surface registry files, and live diagnostics.
- **Required follow-up:** apply the same typed boundary discipline to delivery,
  Thread, memory, and context-debug; detect ordinary full-definition reads.
- **Proof provided:** focused migration/boundary/read-boundary suites and
  data-layer/contract lint.
- **Apply/revert:** idempotent read-model migration; code revert is safe.

**Schema Migration Decision - `codex:graph-compact-read-model-2026-07-17`**

- **Persisted schema touched:** existing `work_items.summary_json` payload;
  no new table or alternate authority.
- **Change class:** required compact read-model backfill and write projection.
- **Existing data impact:** summaries are recomputed from per-task detail;
  task definitions and history remain unchanged.
- **Migration id:** `0.13.2/compact-task-read-models`.
- **Compatibility reader:** no ordinary graph fallback; legacy remains only
  before current-state promotion.
- **Fixtures/tests:** packet backfill, idempotence, and graph read-boundary
  coverage.
- **Rollback/revert:** code rollback is safe; additive compact fields can
  remain in existing rows.

## 2026-07-17 - Thread extras are saved-state-only by default

Thread was still making an ordinary request to inspect Git for every task
mentioned in its turns. That violated the same data-management rule as the
old Release mismatch: the visible surface silently chose a live external
source instead of a saved projection. Ordinary Thread extras now returns an
explicit saved envelope with `requiresRefresh: true` and a diagnostic link.
Only `diagnostic=true` or `live=true` may inspect the checkout.

This is intentionally a small cut while the task-level Git snapshot projection
is still being designed. It removes the hidden cost and tells the UI the truth;
it does not pretend the saved task Git story already exists.

**Contract Touch Decision - `codex:thread-extras-saved-boundary-2026-07-17`**

- **Touched contracts:** Thread extras freshness/diagnostic response and live
  Git inspection gating.
- **Considered but not touched:** current Thread, history, project Git Story,
  and task Git Story diagnostic response.
- **Required follow-up:** add a task-level saved Git snapshot projection if
  Thread should show task stories without a refresh.
- **Proof provided:** ordinary extras Git-spy regression and existing explicit
  diagnostic Git Story tests.
- **Apply/revert:** code-only revert; no persisted data changes.

**Schema Migration Decision - `codex:thread-extras-saved-boundary-2026-07-17`**

- **Persisted schema touched:** none.
- **Change class:** read-path and freshness-contract tightening.
- **Existing data impact:** none; the route stops doing implicit live work.
- **Migration id:** not required.
- **Compatibility reader:** `diagnostic=true` remains the explicit live path.
- **Rollback/revert:** code-only revert; no data rollback.

## Project detail is a named bounded read model

The project detail boundary now owns the compact inventory contract: one saved
SQLite snapshot supplies the queue envelope, indexed task page, selected task
point, selected scope, summary, and revisions. Compact Overview, Work, and Map
format that result instead of each assembling the same facts independently.

This matters because “same data layer” does not mean one giant response object.
It means one authoritative write boundary and named read models over the same
revisioned state. A Release view, project graph, delivery queue, or detail page
may ask for different fields, but none may manufacture a current task from an
intake document when the authoritative task projection says otherwise.

The boundary also makes failure honest: stale saved state is labeled stale;
missing promoted state requests refresh/migration; only pre-promotion projects
may use compatibility readers. There is no ordinary-read repair or fallback
to a second source.

That is an invariant, not a style preference. An ordinary route is not allowed
to select a queue, intake snapshot, task file, or derived projection itself.
It asks a named boundary for a read model carrying its source revision. If a
bounded follow-up point read is unavoidable, the boundary returns its revision
too and the route must reject a mismatch rather than join the rows. The route
module is statically barred from the aggregate task reader. This is what makes
the old Release failure impossible to recreate through a promoted project’s
ordinary route: a different current-state source is no longer an available
input to that route, and a different revision is not an acceptable response.

The Release mismatch is now a permanent route-level calibration case, not just
a unit test for a projection helper. It puts an intake-only task into the
saved workspace-goals snapshot and verifies that the actual Release readiness
endpoint reports only the materialized task count, scope, and blockers. The
unused parallel Release adapter was removed so a future route cannot quietly
adopt a second Release read model that the product does not use.

The migration runner was tightened alongside this work. A projector may create
derived tables idempotently before the migration command runs, but that cannot
make the migration disappear. The ledger records the schema transition after
an idempotent apply, so schema presence and migration history cannot drift into
two competing notions of what happened.

Proof currently includes 5 project-detail projection tests, 35 read-boundary
tests, the combined migration/delivery/read-boundary suite, installed
`stale:false` verification, all seven registered projects passing the payload
and latency budgets, and zero project-state agreement mismatches. Rich task
detail, memory, and context-debug still need the same treatment.

## The architectural test is one data boundary

The answer to “should the Release mismatch have been possible?” is yes: in a
finished design, an ordinary route cannot make that mistake. DRY is not merely
sharing helper names. It means the sessions layer owns source selection,
revision capture, normalized membership, and read-model joins. A route receives
a named bounded snapshot and cannot choose between an intake document, a
compatibility queue, and SQLite rows.

This turn closes that rule for task detail as well. The task drawer now asks
the sessions boundary for authority, task detail, relationships, overlays,
availability, summary, and revisions together. It no longer probes authority,
opens a second task reader, and probes authority again to classify a missing
task. The remaining delivery projection is intentionally a separate derived
read model, but it is sessions-owned and revisioned against the same current
SQLite source. Its joins are the next explicit boundary to finish before the
architecture can be called complete.

The test for success is therefore stronger than “the counts match today”:
writers update the authoritative tables and enqueue projection work in one
transaction; readers enter through one sessions boundary; response shapes may
differ, but they carry the source revision and cannot manufacture current work
from an unrelated artifact. A new route that bypasses this boundary should be
a guardrail failure, not a code-review convention.

## Persisted labels are part of the same authority

The same rule applies below the route boundary. A task detail payload is not a
second place where a display label may quietly become a different fact. The
`0.13.4/stored-request-title-integrity` migration repairs the one provable
historical violation found in Narrative Harness: a nested request title ending
in `...` while its complete first line remains in `request.raw`. It updates
that nested value inside `work_item_detail` through the sessions writer,
advances the authoritative revision, and enqueues the normal projection work.
It does not overwrite the canonical task title, raw request, or history. When
the raw text cannot prove the missing suffix, it leaves the row untouched and
counts it as ambiguous. This is the correct shape of a repair: a bounded
write in the authoritative data layer, not a UI recovery trick.

## Delivery projections follow the same rule

Delivery is a derived read model, so it may have a different bounded payload,
but it is not a second authority. The delivery boundary now returns its
authority, saved delivery model, and projection together. An absent project
database is the only legacy case. Once SQLite is promoted, a missing or stale
delivery projection is an honest refresh/unavailable state; the route cannot
quietly re-derive delivery facts from task files. Task detail also rejects a
delivery projection captured at a different project revision. This is the
practical meaning of DRY here: one source decision, one revision contract, and
named projections behind sessions-owned readers.

## Current Status And Remaining Work - 2026-07-17

The latest delivery/task-boundary slice is complete as a read-boundary cut,
not as completion of the whole architecture pivot. The historical entries
above remain the detailed evidence record.

- [x] Ordinary project surfaces, Thread navigation, Inbox/fleet attention,
  Release, graph, task detail, and delivery routes now enter named
  sessions/runtime boundaries over revisioned saved state.
- [x] Promoted Release, delivery, and task-detail paths fail closed on missing
  or stale projections instead of falling through to retired current-state
  readers.
- [x] Delivery authority and task-detail/delivery revision agreement are
  checked inside the read boundary.
- [x] Installed proof includes `stale:false`, seven-project agreement with
  zero mismatches, performance budgets, and 159 focused delivery/read/task
  tests. The latest audit record still reports six unrelated failures in the
  full Release fixture file, so this is not a clean full-suite closeout.
- [ ] Finish the remaining ordinary-route source audit, especially rich
  diagnostic/history joins, memory/context-debug reads, and any task-level
  Git Story join that would need a saved projection.
- [ ] Keep Thread task Git stories behind an explicit saved snapshot or
  refresh/diagnostic path; the current saved-state-only behavior is an honest
  intermediate boundary, not the finished task Git Story model.
- [ ] Re-run browser Overview/Work/Map geometry and cross-surface proof after
  the remaining history/detail boundaries land. API agreement and performance
  proof do not establish UI proof.
- [ ] Do not call the pivot complete until ordinary routes have named,
  revision-carrying boundaries and the remaining verification debt is either
  resolved or explicitly classified.

### Contract Touch Decision

- Work id: `codex:project-state-architecture-status-rollup-2026-07-17`.
- Touched contracts: none. This is a documentation-only status reconciliation.
- Considered but not touched: runtime routes, read-model payloads, task/release
  entities, delivery projections, and diagnostic/history contracts.
- Required follow-up: keep the implementation and proof obligations in the
  owning historical entries above; do not treat this roll-up as implementation
  proof.
- Proof required: none for this documentation update; existing installed and
  focused proof remains the source evidence, with the open gaps listed above.
- Apply/revert behavior: append-only documentation change; remove this section
  without changing source or persisted project state.

### Schema Migration Decision

- Persisted schema touched: none.
- Change class: documentation/status reconciliation only.
- Existing data impact: none.
- Migration id: not required.
- Compatibility reader: unchanged.
- Fixtures/tests: unchanged; the cited verification debt remains explicit.
- Rollback/revert: remove this appended section only.

## 2026-07-17 - One authority means one source-selection boundary

The Release mismatch is now treated as an architectural impossibility for
promoted ordinary reads, not as a bug to catch after the fact. The sessions
layer owns the source decision, normalized release membership, scope rows,
summary projection, and revision token. Runtime routes request named read
models from that boundary and may format them, but may not select among
`TASKS.json`, intake snapshots, compatibility queues, or SQLite rows.

- [x] Release detail and Release summary consume the same saved surface
  transaction and the same project/queue revisions.
- [x] Intake-only `workspace-import:*` identities remain provenance and cannot
  become current Release membership during a GET.
- [x] Task detail, bounded task evidence/history/review, activity, progress,
  and fleet shell reads carry the same authority/revision discipline.
- [x] Runtime guardrails reject direct route access to aggregate task,
  summary, history, attention, and SQLite readers.
- [x] Release ghost-task regression proves divergent intake data cannot change
  materialized Release totals or scope nodes.
- [ ] Finish the remaining explicit diagnostic joins: context-debug bounds,
  retained-memory reads, task-level Git Story snapshots, and browser proof.

This is the DRY rule that matters: different UI payloads are allowed, but
different current-state authorities are not. A named projection is a view over
one revisioned state model, not a new interpretation of the project.

### Contract Touch Decision

- Work id: `codex:single-authority-read-boundary-2026-07-17`.
- Touched contracts: sessions surface/task-detail boundaries, Release read
  model authority and revisions, bounded task evidence/history/review payloads,
  and route data-layer guardrails.
- Considered but not touched: persisted task/release entity shape, normalized
  `release_membership` schema, delivery table shape, and explicit live
  diagnostic payloads.
- Required follow-up: move the remaining rich diagnostic joins behind named
  bounded session readers and retain revision checks at every cross-projection
  join.
- Proof required: focused boundary/route suites, data-layer and contract
  lint, production build, installed stale-server proof, fleet agreement, and
  performance audits.
- Proof provided: those checks pass for the current slice; browser and rich
  diagnostic coverage remain explicitly open above.
- Apply/revert behavior: runtime/read-boundary code can be reverted without a
  persisted-state rollback; the existing release-membership migration remains
  the authoritative data-shape transition.

### Schema Migration Decision

- Persisted schema touched: none by this read-boundary slice.
- Change class: source-selection and revision-contract consolidation.
- Existing data impact: none; reads stop manufacturing current task rows from
  intake evidence.
- Migration id: not required.
- Compatibility reader: pre-promotion bootstrap reads remain explicit; no new
  historical-shape reader is permitted for promoted ordinary routes.
- Fixtures/tests: Release ghost membership, promoted task detail, bounded task
  history/review, shell boundary, and route guardrail fixtures.
- Owner-facing plan text: missing promoted projections report refresh or
  unavailable state instead of silently choosing another source.
- Rollback/revert: code-only revert for the reader changes; no data rollback.

## 2026-07-17 - Effective authority is shared by current and detail reads

The evidence-history refinement exposed a useful test of the architecture. A
database can have a materialized `queue_state` row before the historical
promotion marker is finalized. That is not a second project state; it is a
partially completed promotion. Therefore the same effective-authority helper
now reads the queue row and marker on one SQLite connection, and both current
project reads and task-history reads use that result. The marker is migration
bookkeeping, not an alternate runtime authority.

Task history may still be stored in a bounded compressed ledger for size
reasons. That is a detail-storage choice, not a source of current task or
Release identity. The history response carries `projectAuthority` and the
project revision so a caller cannot join compressed detail to an unrelated
current-state snapshot.

- [x] Queue-present / marker-legacy regression proves evidence reads fail closed
  for legacy files instead of silently selecting them.
- [x] Compressed evidence responses identify both detail storage and project
  authority, with the project revision attached.
- [x] Evidence writes select their destination from one boundary read rather
  than independently probing current and evidence authorities.
- [x] Release summary and detail expose the same authority, revisions,
  materialized membership, and readiness state; raw Release lifecycle metadata
  is no longer confused with saved scope readiness in one route.
- [ ] Apply the same single-boundary pattern to remaining rich diagnostic and
  task Git Story readers before calling the model migration complete.

### Contract Touch Decision

- Work id: `codex:effective-authority-boundary-2026-07-17`.
- Touched contracts: `TaskEvidencePage` now exposes project authority and
  project revision when a database boundary exists; the sessions evidence
  boundary owns source selection for the page and write paths.
- Considered but not touched: persisted task/release entities and the
  compressed history file format. Compression remains detail retention, not
  current-state modeling.
- Required follow-up: carry the same authority/revision contract through the
  remaining diagnostic detail readers.
- Proof provided: task-state boundary regression, 15 task-state tests, 129
  task endpoint/state tests, data-layer lint, and contract lint.
- Apply/revert behavior: code-only reader contract change; no persisted
  rollback is required.

### Schema Migration Decision

- Persisted schema touched: none.
- Change class: read/write source-selection consolidation.
- Existing data impact: promoted ordinary reads stop treating legacy evidence
  files as a current source when a normalized queue already exists.
- Migration id: not required; existing evidence migration and compression
  migrations remain the only writers of history-shape transitions.
- Compatibility reader: legacy evidence remains available only to explicit
  pre-promotion/bootstrap or migration paths; ordinary promoted reads fail
  closed when migration is incomplete.
- Fixtures/tests: queue-present / marker-legacy evidence boundary fixture and
  compressed-history authority/revision assertions.
- Rollback/revert: code-only revert; no data rollback.

## 2026-07-17 - Diagnostic overlays cannot choose current-state identity

The project Git Story diagnostic had a smaller version of the Release bug: it
was explicitly allowed to inspect Git, but it also reopened `TASKS.json` to
discover which task records to inspect. That made “diagnostic” an accidental
second data-management path. The route now starts from the same canonical
current-state boundary as Release and uses Git only as an overlay. The task
Git Story tab uses the bounded task-point boundary and carries its source
revision as well.

The rule is intentionally simple:

> A diagnostic read may add observations; it may not select, invent, or
> replace current project entities.

- [x] Project Git Story diagnostics use the canonical current-state queue.
- [x] Task Git Story diagnostics use the bounded task-point boundary.
- [x] Both payloads identify the project revision they inspected.
- [x] Regression tests prove the live diagnostic contract has revision data.
- [ ] Apply the same rule to context-debug, retained-memory health, and the
  remaining rich task-detail joins.

### Contract Touch Decision

- Work id: `codex:diagnostic-overlay-boundary-2026-07-17`.
- Touched contracts: project/task Git Story diagnostic payloads now expose
  `sourceRevision` and `projectRevision` when current state is revisioned.
- Considered but not touched: Git Story snapshot schema and persisted task or
  repository records.
- Required follow-up: retain the diagnostic label and keep live Git separate
  from saved project state; move remaining diagnostic sources behind named
  bounded readers.
- Proof provided: `serve-read-boundary.test.ts` live Git Story assertions and
  data-layer/contract lint.
- Apply/revert behavior: code-only read-contract change; no data rollback.

### Schema Migration Decision

- Persisted schema touched: none.
- Change class: read-boundary consolidation.
- Existing data impact: none; diagnostic reads inspect the same task identity
  that ordinary current-state reads expose.
- Migration id: not required.
- Compatibility reader: pre-promotion current-state compatibility remains
  inside the project read boundary only.
- Fixtures/tests: project and task live Git Story boundary fixtures.
- Rollback/revert: code-only revert.

## 2026-07-17 - Start readiness consumes one snapshot

The Release mismatch exposed a broader DRY failure: `projectStartReadiness`
had already loaded the canonical queue, effective task overlays, and selected
scope, but several subordinate blockers reopened project state and rebuilt
scope selection. That allowed one Start request to make multiple answers from
one project revision, even when each individual reader looked reasonable.

The start path now passes a `StartStateSnapshot` through terminal detection,
materialized-work detection, paused-work detection, workspace coverage,
orientation shaping, selected-Release review, import-draft review, task
readiness, and ready-status checks. The snapshot is queue definition + current
effective tasks + selected scope; `null` scope is preserved as an intentional
answer. A helper may still perform an explicit external workspace-document
check, but it cannot replace the project state with an intake snapshot.

- [x] Start blockers consume the caller's canonical state when it is present.
- [x] Promoted-project helpers load the canonical boundary only when called
  independently, never after receiving the complete snapshot.
- [x] Legacy compatibility remains isolated to unpromoted projects.
- [x] Start/Release regression suites remain green after consolidation.
- [ ] Add a direct call-count regression proving one promoted Start request
  does not reopen the queue for each blocker.

### Contract Touch Decision

- Work id: `codex:start-readiness-one-snapshot-2026-07-17`.
- Touched contracts: internal start-readiness composition; no public response
  field was renamed or removed.
- Considered but not touched: task/release persistence, workspace import
  detection, and provider readiness semantics.
- Required follow-up: add instrumentation-backed call-count proof and finish
  the remaining rich diagnostic readers.
- Proof provided: `serve-release-readiness.test.ts` 80/80,
  `serve-read-boundary.test.ts` 39/39, `pnpm lint:data-layer`,
  `pnpm lint:contracts`, and `git diff --check`.
- Apply/revert behavior: code-only read-path change; no persisted rewrite.

### Schema Migration Decision

- Persisted schema touched: none.
- Change class: in-memory read composition and authority consolidation.
- Existing data impact: none; the same durable queue, overlays, and scope are
  used, with fewer request-time rereads.
- Migration id: not required.
- Compatibility reader: unchanged and confined to the legacy branch.
- Fixtures/tests: start readiness, Release lifecycle/readiness, and boundary
  agreement suites.
- Rollback/revert: code-only revert.

## 2026-07-17 - Read models may differ; current-state authority may not

The Release/Map failure made the boundary rule concrete. “DRY” does not mean
every endpoint returns one giant object. It means every endpoint gets its
entities, relationships, and revision from the same sessions-owned snapshot,
then projects only the fields its surface needs. A route may omit delivery
detail, task evidence, Git observations, or map nodes; omission is not
permission to reopen an intake file or manufacture a replacement entity.

The model now makes two related distinctions explicit:

- **Release lifecycle** is the persisted Release record (`active`, `ready`,
  and so on). A request-time Git observation cannot rewrite it.
- **Release readiness** is the derived current-state verdict and diagnostics.
  It can say a lifecycle-active Release is not ready because repository proof
  is missing, without changing the Release record.

This prevents a different kind of two-authority bug: one route treating a
derived readiness verdict as lifecycle state while another route reads the
durable Release definition. Both now read the same Release definition and
expose readiness separately.

The Map crash was the corresponding optional-detail bug. Map deliberately
does not load the delivery model, but the rich diagnostic branch still passed
`null` into a validator that requires a model. Optional detail is now modeled
as absent at the boundary and skipped by its validator; it cannot make the
authoritative project spine unavailable.

- [x] Release summary and detail use the same named saved read boundary.
- [x] Release identity/lifecycle comes from the persisted queue definition;
  readiness comes from the summary/diagnostic projection.
- [x] Rich Map diagnostics can omit delivery detail without throwing.
- [x] Regression coverage proves Overview, Work, and Map share the same
  current spine and blocker, and Release summary/detail agree on membership,
  revisions, and lifecycle identity.
- [ ] Finish the remaining rich diagnostic joins behind equivalent named
  session readers, then repeat installed browser proof.

### Contract Touch Decision

- Work id: `codex:read-model-shape-over-one-authority-2026-07-17`.
- Touched contracts: Release detail/summary response semantics for lifecycle
  versus readiness; rich project Map behavior when delivery detail is omitted;
  compact Map task identity omission of empty provenance arrays.
- Considered but not touched: persisted Release/task schema, delivery schema,
  and readiness calculation rules.
- Required follow-up: make all remaining rich diagnostic inputs explicit
  optional bounded projections and retain revision checks for every join.
- Proof provided: `serve-release-readiness.test.ts` 80/80, focused boundary
  suite, `pnpm lint:data-layer`, `pnpm lint:contracts`, and `git diff --check`.
- Apply/revert behavior: code-only read/response contract change; no data
  rollback.

### Schema Migration Decision

- Persisted schema touched: none.
- Change class: response-shape and source-boundary consolidation.
- Existing data impact: none; existing Release lifecycle values remain
  unchanged and readiness remains derived from saved projections.
- Migration id: not required.
- Compatibility reader: unchanged; pre-promotion reads remain inside the
  shared boundary and promoted reads still fail closed when projections are
  unavailable.
- Fixtures/tests: Release summary/detail agreement, diagnostic Git follow-up,
  Map/Work bounded inventory, and Overview/Work/Map blocker agreement.
- Owner-facing plan text: a Release may be lifecycle-active while its
  readiness verdict is blocked; the UI must show the readiness explanation,
  not silently rewrite the lifecycle record.
- Rollback/revert: code-only revert; no persisted-state rewrite.

## 2026-07-17 - Task detail no longer has a second current-state read

The remaining task-detail exception was not harmless duplication. The drawer
read the selected task and its relationship IDs from one transaction, then
reopened the database to fetch parent/child/dependency task records. That was
revision-checked, but it still made two reads the normal architecture and
left room for a future caller to forget the check. The detail boundary now has
an explicit `includeRelatedTasks` option. When requested, the sessions layer
loads bounded related task points, normalized Release membership, normalized
dependencies, and detail payloads in the same read transaction as the
selected task and returns them with the same revision.

The task-detail relationship payload also now uses `task.dependsOn` after the
normalized dependency table has been applied. It never parses
`depends_on_json` for the relationship view. An old JSON mirror can therefore
be present for migration purposes without changing the current relationship
answer.

This is the stronger DRY rule:

> One data-layer snapshot may expose many bounded shapes. A route may omit or
> format fields, but it may not reopen current entities to complete a shape.

That does not require one giant response or one query for history, Git, and
diagnostics. Those are explicit bounded projections with their own source
revision. It does require every ordinary current-state entity and relation to
come from the named sessions boundary, never from an intake artifact or
compatibility mirror.

- [x] Promoted task detail gets related task points from its selected-task
  snapshot when the drawer requests them.
- [x] Task-detail relationships use normalized dependencies, including an
  explicitly empty relation.
- [x] Existing task endpoint and boundary suites prove the drawer contract.
- [ ] Move current evidence into the same optional bundle field for the
  Progress route; its current secondary read remains revision-guarded.

### Contract Touch Decision

- Work id: `codex:task-detail-one-snapshot-2026-07-17`.
- Touched contracts: task-detail boundary option and related-task response
  assembly; normalized dependency relation semantics.
- Considered but not touched: task IDs, Release membership schema, evidence
  retention, and delivery projection storage.
- Required follow-up: bundle current evidence for Progress and finish the
  remaining bounded diagnostic joins.
- Proof provided: project-state database 64/64, boundary 16/16, task endpoint
  115/115, read-boundary 40/40, data-layer lint, contract lint, and diff check.
- Apply/revert behavior: code-only read-boundary change; no persisted rewrite.

### Schema Migration Decision

- Persisted schema touched: none.
- Change class: read transaction composition and normalized relation authority.
- Existing data impact: none; promoted reads stop consulting the dependency
  JSON mirror for task-detail relationships.
- Migration id: not required.
- Compatibility reader: legacy JSON remains migration/bootstrap input only.
- Fixtures/tests: normalized dependency regression and promoted task-detail
  related-task response.
- Rollback/revert: code-only; do not restore JSON fallback without a new
  authority decision and parity proof.

## 2026-07-17 - One sessions snapshot is the only aggregate read primitive

The earlier boundary work removed the Release ghost-task symptom, but the
implementation still exposed four independent aggregate readers inside the
sessions package: shell, projection, surface, and full current state. They all
used SQLite, but that was not enough. A future caller could still add another
reader and accidentally join a queue envelope from one snapshot to a summary
or relationship from another.

The sessions layer now has one `readProjectStateDatabaseReadBundle` primitive.
It opens one read transaction, selects the effective current-state authority,
captures the queue/project revisions, and fills only the explicitly requested
bounded views. The existing reader names remain as compatibility adapters for
their payload shapes, but they are projections of that bundle rather than
separate data authorities. A shell is therefore a small view over the same
model, not a different model.

This is the DRY rule in implementation form:

> Routes may narrow or format one revisioned bundle. They may not choose a
> queue, intake snapshot, relationship table, summary file, or JSON mirror.

The bundle also fixed two smaller forms of the same problem. Summary
freshness now uses the effective queue authority rather than migration-marker
state, and ordinary dependency/release reads treat normalized relations as
authoritative even when the relation is empty. A stale `depends_on_json` or
`release_ids_json` mirror can no longer resurrect an edge that the normalized
model removed. JSON remains available only to explicit migration/write paths.

Progress now carries the project/evidence revision pair and returns a refresh
response on a mismatch instead of combining an old summary with new evidence.
Queue and task point CAS readers now use an explicit SQLite read transaction,
so their revision token actually describes the rows they returned.

- [x] Shell, projection, surface, and full current-state reads are thin views
  over one sessions-owned read bundle.
- [x] Effective authority and summary freshness share the same source rule.
- [x] Normalized dependency/release relations suppress stale JSON mirrors.
- [x] Progress compares summary and current-evidence project revisions.
- [x] Queue/task point revision readers are transaction-backed.
- [x] Move task-detail related-task hydration into the same optional bundle
  fields for ordinary routes that previously used a secondary read.
- [x] Move current evidence into the same optional bundle field for the
  Progress route; its current secondary read is removed.

### Contract Touch Decision

- Work id: `codex:aggregate-read-bundle-2026-07-17`.
- Touched contracts: sessions aggregate read boundary, authority/revision
  selection, normalized relationship read semantics, Progress revision
  metadata and mismatch response.
- Considered but not touched: task/release entity IDs, persisted relation
  tables, delivery projection schema, and historical evidence retention.
- Required follow-up: add current-evidence fields to the bundle, then finish
  the remaining bounded diagnostic joins.
- Proof required: sessions/boundary/Release suites, normalized-edge regression,
  data-layer and contract lint, production build, and installed service proof.
- Proof provided: sessions 64/64, boundary 16/16, read-boundary 40/40,
  Release 80/80, and delivery 6/6; `pnpm build`,
  `pnpm lint:data-layer`, `pnpm lint:contracts`, and diff check.
- Apply/revert behavior: code-only read-contract change; no persisted rollback.

### Schema Migration Decision

- Persisted schema touched: none; existing normalized dependency and Release
  membership tables become stricter ordinary-read authorities.
- Change class: read-authority consolidation and transaction boundary repair.
- Existing data impact: promoted reads stop using stale JSON relationship
  mirrors; migration readers continue to parse those mirrors when backfilling.
- Migration id: not required for this code-only read change.
- Compatibility reader: JSON relationship fields remain explicit migration
  input only; no promoted ordinary route may use them as a fallback.
- Fixtures/tests: one-bundle revision agreement, Release ghost membership,
  normalized empty-dependency regression, Progress mismatch contract, and the
  existing migration suite.
- Owner-facing plan text: a relationship removed from the normalized plan is
  removed, even if an old compatibility copy still mentions it.
- Rollback/revert: code-only revert; do not restore JSON fallback behavior
  without a migration decision and parity proof.

## 2026-07-17 - Release and Start cannot select a second current-state authority

The Release mismatch was the concrete proof that “all readers use SQLite” was
not yet a strong enough rule. Release detail was selecting a projection-shaped
queue envelope while another path reconstructed synthetic `workspace-import:*`
tasks from an intake snapshot. The durable SQLite projection counted only
materialized work. Those paths could disagree because the boundary still
allowed a route to choose which wrapper it wanted before formatting the answer.

The rule is now structural:

> A current-state read starts with one sessions-owned bundle. Every route-facing
> view is a narrowing of that bundle. No route may create current task identity,
> membership, status, owner-input state, or scope from intake, legacy JSON, or
> a second point read.

Release saved reads now request the durable queue definition directly from
`readProjectStateDatabaseReadBundle`, rather than starting from the compact
projection queue envelope. The rich canonical reader and the saved Release
reader therefore both derive Release identity, normalized membership, scope
rows, summary, diagnostics, and revision metadata from the same data-layer
primitive. Intake remains provenance; it cannot manufacture a task on GET.

Start readiness receives the same captured effective tasks, authority, scope,
and owner-input summary. Effective-task projection no longer reopens the
authority decision when a caller already supplied it. The recoverable blocked
task check also uses the captured effective task instead of rebuilding it.
The old workspace-import coverage checker is now explicitly limited to legacy
compatibility reads. Promoted projects do not reread `workspace-goals`, scan
docs, or materialize an import draft during a Start/readiness decision; that
information must be produced by the asynchronous projection refresh that
creates the saved summary.

This is why the fix is more than a Release patch: a future Release, Overview,
Map, Work, or Start route cannot reproduce the original mismatch without
deliberately bypassing the sessions bundle contract. The compatibility readers
remain for pre-promotion migration only and fail closed when a promoted
project's durable queue detail is unavailable.

- [x] Release saved reads use the canonical queue definition from the bundle.
- [x] Release intake-ghost regression remains green at both boundary and HTTP
  route levels.
- [x] Canonical effective-task callers pass captured authority and overlays.
- [x] Promoted Start readiness uses owner-input state from the captured summary.
- [x] Promoted Start readiness does not run the legacy workspace-import scan or
  write an import draft during a read.
- [x] Promoted task detail receives its effective current task from the named
  task-state boundary; route code no longer assembles point plus overlay.
- [ ] Move the legacy workspace-import coverage algorithm into the asynchronous
  projection refresh and persist a bounded coverage result for explicit
  diagnostics.

### DRY authority invariant

The release mismatch exposed a class of bug that should be impossible in the
finished architecture, not merely unlikely. A route must never be able to ask
for a queue from one source, a task overlay from another, and intake-derived
work from a third source. That is now enforced at two levels:

1. The sessions layer owns the SQLite read bundle and its revision boundary.
2. The runtime boundary owns route-facing adapters such as the saved Release
   read and the current task read. These adapters return complete, named read
   models, rather than exposing raw pieces for routes to recombine.

The new `readProjectTaskCurrentStateAtBoundary` adapter applies a promoted
task's normalized overlay with the authority captured by the same detail read.
The task route can still use the explicit legacy compatibility branch, but it
cannot accidentally reopen promoted task authority while formatting a drawer.
Static data-layer guardrails also reject direct SQLite reads, aggregate task
reads, raw history/attention reads, and intake-only task records in ordinary
route code. This is the intended failure mode: a future bypass should fail a
guardrail test before it becomes another UI mismatch.

### Contract Touch Decision

- Work id: `codex:single-current-state-authority-2026-07-17`.
- Touched contracts: saved Release read source, Start readiness source
  provenance, effective-task authority options, and promoted-project behavior
  when workspace-import coverage is not yet projected.
- Considered but not touched: task/release IDs, intake schema, normalized
  membership tables, and historical evidence retention.
- Required follow-up: project workspace-import coverage asynchronously and expose
  its freshness/revision in the saved diagnostic projection.
- Proof provided: project-state boundary 16/16, read-boundary 40/40, Release
  readiness 80/80, effective-task 19/19, build, data-layer lint, contract lint,
  and diff check.
- Apply/revert behavior: code-only read-boundary change; compatibility data is
  not rewritten by a GET or Start decision.

### Schema Migration Decision

- Persisted schema touched: none.
- Change class: current-read authority consolidation and compatibility-path
  narrowing.
- Existing data impact: promoted reads stop consulting intake and legacy
  workspace-import state as a source of current task identity; legacy data is
  retained for the migration/projection worker.
- Migration id: not required for this read-only change.
- Compatibility reader: legacy workspace-import coverage remains only for
  pre-promotion projects; promoted projects fail closed or use the saved
  projection state.
- Fixtures/tests: Release ghost-task membership, missing promoted detail,
  current authority, effective-task overlay, and Start/read-boundary suites.
- Owner-facing plan text: Release counts and Start decisions describe the
  materialized current plan, not an uncommitted intake hypothesis.
- Rollback/revert: code-only revert; do not restore request-time intake scans
  for promoted projects without a new authority decision and projection proof.

### Bounded current-task batch boundary

The Release mismatch principle now applies to rich project cards too. A
promoted surface cannot read an indexed task point and then independently
reopen its runtime/workspace/evidence state. The sessions layer provides one
bounded task-point-plus-overlay snapshot, and the runtime boundary applies it
in one batch with one captured revision pair. The legacy adapter is selected
only when the normalized current queue is absent.

This is intentionally a read-model change, not another task schema. It makes
the route incapable of manufacturing a second promoted interpretation of a
task while keeping the existing compact and historical payload boundaries.

### 2026-07-17 atomic read-boundary follow-up

The authority inventory found one remaining way to assemble a mixed answer:
the bounded project-detail adapter probed authority and then opened a second
compact read. `readProjectCompactStateAtBoundary` now returns authority,
revisions, and the compact payload from the same sessions bundle. The static
guard also rejects any new `readProjectStateDatabase*` call in ordinary route
code and rejects legacy queue readers inside the ordinary Release builder.

This is the architectural standard going forward: route code may narrow a
named read model for presentation, but it may not select, probe, or recombine
its sources. Import, migration, history, and live diagnostics remain explicit
source lanes; they are not alternate current-state readers.
