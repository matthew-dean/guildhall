# Guildhall Authority Inventory

Date: 2026-07-17
Branch inspected: `feature/narrative-harness-import-truth`
Repository: `/Users/matthew/git/oss/guildhall`

This is a read-only inventory of the current checkout. Line ranges below are
evidence observed on 2026-07-17 and should be rechecked after source edits.
The document describes what the code actually persists, reads, projects, or
reconstructs. It does not treat the intended architecture as implemented.

## Classification

- **Authoritative**: the current source of truth for a fact or control decision.
- **Projected**: a derived, revisioned read model that should be regenerated
  from an authority and should not invent a competing fact.
- **Historical**: retained evidence, activity, memory, diagnostics, or prior
  state that is not the current answer.
- **Compatibility**: an older shape or mirror retained for migration, import,
  export, or legacy projects. Compatibility data can still become a practical
  authority on an unpromoted project; that conditional behavior is called out.

## Executive finding

Guildhall has a real per-project SQLite boundary, but it is conditional rather
than universal. For promoted projects, `project-state.db` is the current
authority for the indexed work graph, selected scope, compact project summary,
Thread current state, current overlays, attention, diagnostics, repositories,
availability, memory health, and reconciliation records. For legacy or
partially migrated projects, JSON files and imported documents still supply
current facts and are sometimes reconstructed at read or write time.

The important problem is not simply that there are many files. The problem is
that several kinds of current state have more than one live representation:

1. The summary payload contains execution, runtime, owner-input, orientation,
   and plan data that are also stored in normalized SQLite tables.
2. Release membership exists both as normalized `release_membership` rows and
   as JSON arrays/mirrors on scope, queue, and work-item records.
3. Runtime detail, owner-input detail, delivery state, and stop control remain
   outside the project database while compact copies are stored inside it.
4. Saved summary/readiness calculations coexist with request-time and
   background recalculations over effective tasks.
5. Legacy compatibility readers still reconstruct scope or tasks from files
   even though the promoted path is intended to be database-backed.

Consequently, “everything reads through one data management layer” is true for
some promoted read surfaces, but false as a general invariant. The current
architecture still permits two authorities to disagree, even when one of them
is labeled a projection.

## 1. Persisted authorities and current stores

### 1.1 Machine and project registration

| Store | Classification | Facts it owns | Consuming surfaces | Evidence |
| --- | --- | --- | --- | --- |
| Global config and data directories, including settings, logs, sessions, tasks, and feedback roots | Authoritative | Machine-level Guildhall configuration and global storage locations | CLI configuration, session/task discovery, service startup, history allocation | [`src/sessions/paths.ts:25-56`](/Users/matthew/git/oss/guildhall/src/sessions/paths.ts:25) |
| `project-cache-registry.json` plus cache manifests and leases | Authoritative for registration and ownership metadata | Registered workspace paths, cache keys, allocation manifests, leases, and cache ownership | Project discovery, local-history allocation, cache census/pruning/health | [`src/sessions/project-cache-registry.ts:8-14`](/Users/matthew/git/oss/guildhall/src/sessions/project-cache-registry.ts:8), [`src/sessions/project-cache-registry.ts:353-538`](/Users/matthew/git/oss/guildhall/src/sessions/project-cache-registry.ts:353) |
| `fleet-state.sqlite` | Projected | Machine-level compact project shell: display metadata, health, summary payload, revision/freshness, and errors | `/api/service/projects`, `/api/service`, Projects home/fleet cards | [`src/sessions/fleet-state-database.ts:1-15`](/Users/matthew/git/oss/guildhall/src/sessions/fleet-state-database.ts:1), [`src/sessions/fleet-state-database.ts:171-200`](/Users/matthew/git/oss/guildhall/src/sessions/fleet-state-database.ts:171), [`src/sessions/fleet-state-database.ts:314-518`](/Users/matthew/git/oss/guildhall/src/sessions/fleet-state-database.ts:314) |
| `project-graph/registry.json` and `graphs/local.json` | Authoritative/draft for the separate project graph subsystem | Project relationships and dependency graph records | Project graph and structural-map/dependency views | [`src/runtime/project-graph.ts:458-535`](/Users/matthew/git/oss/guildhall/src/runtime/project-graph.ts:458) |

The project registry, project graph, and per-project state database are not the
same registration model. That may be an intentional separation of concerns,
but it is an important boundary: project existence and project product state
do not currently have one owner.

### 1.2 Per-project SQLite current-state database

The database is created at `project-state.db`, with schema version 32 and a
five-second SQLite busy timeout. The schema is broad enough to contain both
normalized current facts and cached presentations.

| SQLite relation or relation family | Classification | Current fact or projection | Consuming surfaces | Evidence |
| --- | --- | --- | --- | --- |
| `project_meta` | Authoritative metadata | Project id, schema/revision timestamps, authority modes for project/task/evidence state | Authority boundary, migration and freshness checks, all DB-backed reads | [`src/sessions/project-state-database.ts:1438-1446`](/Users/matthew/git/oss/guildhall/src/sessions/project-state-database.ts:1438) |
| `work_items` | Authoritative for promoted indexed work identity | Task/feature identity, title, description, status, domain, priority, work kind, hierarchy, dependencies, release ids, source refs, summary, definition JSON, timestamps | Work list, map, release views, compact task reads, rich task reads, delivery projection | [`src/sessions/project-state-database.ts:1447-1466`](/Users/matthew/git/oss/guildhall/src/sessions/project-state-database.ts:1447) |
| `task_dependencies` | Authoritative relationship table | Normalized dependency edges | Work graph, task detail, scheduling/readiness | [`src/sessions/project-state-database.ts:1468-1474`](/Users/matthew/git/oss/guildhall/src/sessions/project-state-database.ts:1468) |
| `work_item_detail` | Projected/detail companion | Compressed rich task definition/detail | Task detail, rich task point, effective-task builder | [`src/sessions/project-state-database.ts:1475-1480`](/Users/matthew/git/oss/guildhall/src/sessions/project-state-database.ts:1475), [`src/runtime/project-state-boundary.ts:630-751`](/Users/matthew/git/oss/guildhall/src/runtime/project-state-boundary.ts:630) |
| `work_scope` | Authoritative current execution scope record | Selected scope/release, eligibility, hierarchy, handoff, start, release, human/proof blockers, counts, references | Overview, map, releases, start/readiness, work and delivery surfaces | [`src/sessions/project-state-database.ts:1482-1496`](/Users/matthew/git/oss/guildhall/src/sessions/project-state-database.ts:1482) |
| `scopes` | Authoritative scope definition envelope, with compatibility mirrors | Release/milestone/marker identity, name, status, definition, node-id arrays | Map and release views, scope selection, migration/presentation | [`src/sessions/project-state-database.ts:1514-1523`](/Users/matthew/git/oss/guildhall/src/sessions/project-state-database.ts:1514) |
| `release_membership` | Intended authoritative relationship | Normalized release-to-work membership | Scope selection, map, release work, readiness and task filtering | [`src/sessions/project-state-database.ts:1525-1533`](/Users/matthew/git/oss/guildhall/src/sessions/project-state-database.ts:1525), [`src/runtime/project-state-boundary.ts:205-268`](/Users/matthew/git/oss/guildhall/src/runtime/project-state-boundary.ts:205) |
| `queue_state` | Authoritative current queue envelope | Queue revision, selected release, execution actions, scope requests, queue revision | Queue reads/writes, start/resume, summary refresh, scheduling | [`src/sessions/project-state-database.ts:1497-1505`](/Users/matthew/git/oss/guildhall/src/sessions/project-state-database.ts:1497) |
| `project_summary` | Projected | Compact project summary, counts, scope summary, orientation, plan, release summary, runtime/execution/owner-input fields, next action, blockers, recent work, in-flight state | Project overview, project shell/detail, release readiness, fleet summary publication | [`src/sessions/project-state-database.ts:1534-1543`](/Users/matthew/git/oss/guildhall/src/sessions/project-state-database.ts:1534), [`src/runtime/project-summary-projection.ts:67-232`](/Users/matthew/git/oss/guildhall/src/runtime/project-summary-projection.ts:67) |
| `project_orientation` | Projected | Saved orientation/spine data | Overview, map, project spine/structure views | [`src/sessions/project-state-database.ts:1544-1549`](/Users/matthew/git/oss/guildhall/src/sessions/project-state-database.ts:1544), [`src/runtime/serve.ts:7342-7435`](/Users/matthew/git/oss/guildhall/src/runtime/serve.ts:7342) |
| `project_plan` | Compatibility/import projection | Latest imported planning provenance and approved-plan snapshot | Map/source trail, intake and migration views, summary orientation | [`src/sessions/project-state-database.ts:1579-1587`](/Users/matthew/git/oss/guildhall/src/sessions/project-state-database.ts:1579), [`src/runtime/project-summary-projection.ts:1314-1358`](/Users/matthew/git/oss/guildhall/src/runtime/project-summary-projection.ts:1314) |
| `current_thread`, `thread_history_state`, `thread_history` | Current projection plus historical store | Current Thread snapshot, history cursor/metadata, bounded turn history | Thread current view, Thread history page, activity/agent context | [`src/sessions/project-state-database.ts:1550-1578`](/Users/matthew/git/oss/guildhall/src/sessions/project-state-database.ts:1550), [`src/runtime/thread-read-projection.ts:51-121`](/Users/matthew/git/oss/guildhall/src/runtime/thread-read-projection.ts:51) |
| `task_execution`, `task_workspace` | Projected overlays | Current execution state, workspace/branch/runtime overlay for a task | Work, task detail, execution controls, effective task rendering | [`src/sessions/project-state-database.ts:1588-1597`](/Users/matthew/git/oss/guildhall/src/sessions/project-state-database.ts:1588), [`src/sessions/task-state-store.ts:249-293`](/Users/matthew/git/oss/guildhall/src/sessions/task-state-store.ts:249) |
| `task_proof`, `task_evidence_current` | Projected/current evidence | Current proof and compact validation evidence | Work readiness, delivery validation, Inbox, task detail | [`src/sessions/project-state-database.ts:1598-1609`](/Users/matthew/git/oss/guildhall/src/sessions/project-state-database.ts:1598), [`src/sessions/project-state-database.ts:6723-6748`](/Users/matthew/git/oss/guildhall/src/sessions/project-state-database.ts:6723) |
| `task_evidence_history` | Historical | Prior task evidence records | Evidence history, diagnostics, audit and migration tools | [`src/sessions/project-state-database.ts:1610-1621`](/Users/matthew/git/oss/guildhall/src/sessions/project-state-database.ts:1610) |
| `current_execution`, `current_runtime` | Projected compact operational state | Current supervisor/execution and runtime summaries | Overview, work, service status, execution controls, fleet publication | [`src/sessions/project-state-database.ts:1622-1640`](/Users/matthew/git/oss/guildhall/src/sessions/project-state-database.ts:1622), [`src/runtime/serve-supervisor.ts:560-572`](/Users/matthew/git/oss/guildhall/src/runtime/serve-supervisor.ts:560) |
| `owner_inputs` | Projected compact owner-input state | Current pending/resolved input summary and next owner-input state | Overview, Inbox, Thread, readiness and action surfaces | [`src/sessions/project-state-database.ts:1641-1649`](/Users/matthew/git/oss/guildhall/src/sessions/project-state-database.ts:1641), [`src/runtime/owner-input-store.ts:215-244`](/Users/matthew/git/oss/guildhall/src/runtime/owner-input-store.ts:215) |
| `repositories` | Projected observation | Last observed repository signature/Git state | Overview signals, diagnostics, release readiness, fleet status | [`src/sessions/project-state-database.ts:1650-1659`](/Users/matthew/git/oss/guildhall/src/sessions/project-state-database.ts:1650), [`src/runtime/serve.ts:1825-1875`](/Users/matthew/git/oss/guildhall/src/runtime/serve.ts:1825) |
| `project_diagnostics` | Projected diagnostic result | Saved blockers, Git/readiness diagnostics, freshness and diagnostic payload | Project overview, release readiness, diagnostic views | [`src/sessions/project-state-database.ts:1660-1668`](/Users/matthew/git/oss/guildhall/src/sessions/project-state-database.ts:1660) |
| `memory_health`, `project_availability` | Projected | Saved memory health and project availability/readiness | Overview, service/fleet cards, diagnostics | [`src/sessions/project-state-database.ts:1669-1684`](/Users/matthew/git/oss/guildhall/src/sessions/project-state-database.ts:1669) |
| `attention_records` | Projected | Materialized Inbox/attention items and revision/watermark | Inbox, overview needs-attention sections, fleet attention preview | [`src/sessions/project-state-database.ts:1685-1695`](/Users/matthew/git/oss/guildhall/src/sessions/project-state-database.ts:1685), [`src/runtime/attention-projection.ts:61-180`](/Users/matthew/git/oss/guildhall/src/runtime/attention-projection.ts:61) |
| `projection_watermarks`, `projection_jobs` | Projected control metadata | Domain freshness, invalidation, claims, retry state | Background projector, stale indicators, projection diagnostics | [`src/sessions/project-state-database.ts:1692-1711`](/Users/matthew/git/oss/guildhall/src/sessions/project-state-database.ts:1692) |
| `project_reconciliations` | Projected diagnostic/reconciliation state | Reconciliation results and repair status | Diagnostics and background reconciliation | [`src/sessions/project-state-database.ts:1712-1717`](/Users/matthew/git/oss/guildhall/src/sessions/project-state-database.ts:1712) |

The database boundary is real and useful. The problem is that the schema mixes
normalized facts, compact projections, detail blobs, compatibility mirrors,
and projection-control metadata in one database without eliminating the other
stores that still own or reconstruct some of the same facts.

## 2. Other current authorities outside `project-state.db`

These stores are not merely history. Each remains a live source for at least
one path, especially for legacy or partially promoted projects.

| Store or runtime state | Classification | What it owns or supplies | Consuming surfaces | Evidence |
| --- | --- | --- | --- | --- |
| Repo-local `.guildhall` configuration and planning files | Authoritative for source/project configuration on import, compatibility for promoted current state | Project registration hints, intake documents, imported plan/source material | Project registration, import, migration, source trail and orientation | [`src/runtime/project-summary-projection.ts:1314-1358`](/Users/matthew/git/oss/guildhall/src/runtime/project-summary-projection.ts:1314), [`src/sessions/local-history.ts:154-179`](/Users/matthew/git/oss/guildhall/src/sessions/local-history.ts:154) |
| Legacy `TASKS.json`/queue files | Authoritative for legacy projects; compatibility for promoted projects | Task queue and task hierarchy before promotion; compatibility export after promotion | Legacy queue reads/writes, import, migration, older work paths | [`src/runtime/serve.ts:947-1114`](/Users/matthew/git/oss/guildhall/src/runtime/serve.ts:947), [`src/runtime/project-state-boundary.ts:1659-1921`](/Users/matthew/git/oss/guildhall/src/runtime/project-state-boundary.ts:1659) |
| `workspace-goals.json` and imported approved-plan files | Authoritative/compatibility input for legacy scope; compatibility source after promotion | Current/later work grouping and release-like scope reconstruction | Intake, migration, legacy summary/scope preparation, map/source trail | [`src/runtime/project-summary-projection.ts:1541-1615`](/Users/matthew/git/oss/guildhall/src/runtime/project-summary-projection.ts:1541) |
| `runtime/state.json` | Authoritative operational detail for runtime/container state | Detailed backend/container state that is not represented in the compact DB row | Runtime/backend/service controls and diagnostics | [`src/runtime/project-runtime-store.ts:196-225`](/Users/matthew/git/oss/guildhall/src/runtime/project-runtime-store.ts:196) |
| In-memory supervisor `runs` and process registry | Authoritative while a process is live; historical only after events are persisted | Live run/process handles and live control state | Coordinator controls, start/resume/stop, streaming activity | [`src/runtime/serve-supervisor.ts:574-783`](/Users/matthew/git/oss/guildhall/src/runtime/serve-supervisor.ts:574), [`src/runtime/stop-requested.ts:88-91`](/Users/matthew/git/oss/guildhall/src/runtime/stop-requested.ts:88) |
| Stop-request marker under project local history | Authoritative current control signal | Whether a stop was requested across process boundaries | Supervisor stop behavior and run controls | [`src/runtime/stop-requested.ts:7-79`](/Users/matthew/git/oss/guildhall/src/runtime/stop-requested.ts:7) |
| Owner-input request/response JSON files | Authoritative detail and request history; DB is a compact current projection | Full prompt, answer, review state, and request records | Owner-input route, structural map, Thread context, projection refresh | [`src/runtime/owner-input-store.ts:63-257`](/Users/matthew/git/oss/guildhall/src/runtime/owner-input-store.ts:63) |
| Delivery-spine model in generic file-backed persistence | Authoritative delivery graph/model | Delivery candidates, validation, primitives, relations, and edges | Delivery queue, work/task detail, Inbox, map and delivery projections | [`src/runtime/delivery-spine.ts:12-21`](/Users/matthew/git/oss/guildhall/src/runtime/delivery-spine.ts:12), [`src/runtime/delivery-spine.ts:449-505`](/Users/matthew/git/oss/guildhall/src/runtime/delivery-spine.ts:449) |
| Project/user memory files: `memory-store.json`, `MEMORY.md`, `learning.json`, project skill memory | Authoritative memory inputs | Durable project/user lessons and memory records | Memory read/recall, context planning, memory-health projection | [`src/runtime/memory-store.ts:86-223`](/Users/matthew/git/oss/guildhall/src/runtime/memory-store.ts:86) |
| Deterministic memory event stream `events.jsonl` | Authoritative bounded memory event history | Current memory event stream and compacted memory events | Memory consolidation, memory health, audit | [`src/memory-core/data-access.ts:22-48`](/Users/matthew/git/oss/guildhall/src/memory-core/data-access.ts:22), [`src/memory-core/data-access.ts:405-497`](/Users/matthew/git/oss/guildhall/src/memory-core/data-access.ts:405) |
| Optional Mastra/LibSQL `guildhall-memory.db` | Compatibility/optional substrate | Empty or opt-in semantic memory database; not the active deterministic retrieval authority | Explicit migration/inspection and optional persistent adapter | [`src/memory-core/adapters/mastra.ts:27-103`](/Users/matthew/git/oss/guildhall/src/memory-core/adapters/mastra.ts:27), [`src/memory-core/data-access.ts:97-197`](/Users/matthew/git/oss/guildhall/src/memory-core/data-access.ts:97) |

The operational split is especially consequential: a supervisor can be live in
memory, have detailed state in `runtime/state.json`, have a stop marker in local
history, and expose a compact `current_execution` row. Those are related
representations, but they are not one transactionally owned control model.

## 3. Durable projections and their consuming surfaces

The following are read models, not independent product truths. They are useful
only if their source revision and freshness are explicit and every surface uses
the same builder.

| Projection | Source/refresh boundary | Consuming surfaces | Evidence and current caveat |
| --- | --- | --- | --- |
| Project summary | `buildProjectSummaryProjection`, DB summary writer, background refresh | Overview, project detail, release readiness, fleet publication | [`src/runtime/project-summary-projection.ts:381-410`](/Users/matthew/git/oss/guildhall/src/runtime/project-summary-projection.ts:381), [`src/runtime/project-summary-projection.ts:900-930`](/Users/matthew/git/oss/guildhall/src/runtime/project-summary-projection.ts:900). The payload still duplicates auxiliary current rows. |
| Scope/release projection | `work_scope`, `scopes`, `release_membership`, summary scope builder | Project map, releases, overview work mix, start/readiness, work filtering | [`src/runtime/project-state-boundary.ts:205-268`](/Users/matthew/git/oss/guildhall/src/runtime/project-state-boundary.ts:205), [`src/runtime/project-summary-projection.ts:345-379`](/Users/matthew/git/oss/guildhall/src/runtime/project-summary-projection.ts:345). Legacy preparation can synthesize scope membership. |
| Orientation/spine projection | `project_orientation` and summary orientation payload | Overview, Project Map/Structure/Releases views | [`src/runtime/serve.ts:7342-7435`](/Users/matthew/git/oss/guildhall/src/runtime/serve.ts:7342). The same orientation also lives inside `project_summary`. |
| Current task point/detail boundary | `readProjectTaskCurrentRecordsAtBoundary`, indexed `work_items` and overlays, bounded effective-task enrichment | Work, task detail, task query route, release task detail | [`src/runtime/project-state-boundary.ts:984-1042`](/Users/matthew/git/oss/guildhall/src/runtime/project-state-boundary.ts:984), [`src/runtime/project-state-boundary.ts:1044-1316`](/Users/matthew/git/oss/guildhall/src/runtime/project-state-boundary.ts:1044). Rich paths can still expand all effective tasks. |
| Attention/Inbox | `attention_records` materialized by Inbox builder/reconciliation | Inbox, overview needs-attention, fleet attention preview | [`src/runtime/attention-projection.ts:61-180`](/Users/matthew/git/oss/guildhall/src/runtime/attention-projection.ts:61). A separate reader performs metadata and watermark reads rather than using one joined boundary. |
| Thread current/history | `current_thread` and bounded history tables | Thread, activity, task context | [`src/runtime/thread-read-projection.ts:51-121`](/Users/matthew/git/oss/guildhall/src/runtime/thread-read-projection.ts:51). This is one of the cleaner current/history separations. |
| Delivery read model | DB delivery projection refreshed from the delivery-spine model and task rows | Delivery queue, task detail, Work, Inbox, Map | [`src/sessions/delivery-read-projection.ts:500-612`](/Users/matthew/git/oss/guildhall/src/sessions/delivery-read-projection.ts:500), [`src/sessions/delivery-read-projection.ts:649-703`](/Users/matthew/git/oss/guildhall/src/sessions/delivery-read-projection.ts:649). The generic delivery model remains a separate source. |
| Repository observation | `repositories` rows refreshed from Git status/story inspection | Overview signals, diagnostics, release readiness, fleet state | [`src/runtime/serve.ts:1801-1875`](/Users/matthew/git/oss/guildhall/src/runtime/serve.ts:1801). It is saved, but its source scan is broad and can also be requested live. |
| Project diagnostics/readiness | `project_diagnostics` plus saved diagnostic summary | Overview, release readiness and diagnostic surfaces | [`src/runtime/serve.ts:15986-16440`](/Users/matthew/git/oss/guildhall/src/runtime/serve.ts:15986). The `live`/`diagnostic` path recomputes readiness and labels it request-time. |
| Memory health | `memory_health` from memory inspection | Overview, diagnostics, fleet/service status | [`src/sessions/project-state-database.ts:1669-1675`](/Users/matthew/git/oss/guildhall/src/sessions/project-state-database.ts:1669), [`src/runtime/serve.ts:1984-2008`](/Users/matthew/git/oss/guildhall/src/runtime/serve.ts:1984) |
| Fleet summary | `fleet-state.sqlite` | Projects page, fleet/service shell | [`internal/audits/2026-07-17-fleet-service-summary-performance.md:58-80`](/Users/matthew/git/oss/guildhall/internal/audits/2026-07-17-fleet-service-summary-performance.md:58). The projection is bounded, but the service route still performs synchronous per-project work. |
| Activity/event page | Supervisor recent event file and persisted bounded event page | Live activity, historical activity/timeline | [`src/runtime/serve-supervisor.ts:181-430`](/Users/matthew/git/oss/guildhall/src/runtime/serve-supervisor.ts:181) |

## 4. Historical, debug, and compatibility stores

These stores should not be treated as current project state. Some are bounded,
some are bounded only per file or operation, and some have no demonstrated
aggregate retention limit.

| Store | Classification | Retention/behavior | Consumers | Evidence |
| --- | --- | --- | --- | --- |
| Legacy `queue-details.json` and compressed form | Compatibility | Explicitly migration-only; normal runtime should not read/write it | Migration and compatibility tooling | [`src/sessions/project-state-database.ts:66-67`](/Users/matthew/git/oss/guildhall/src/sessions/project-state-database.ts:66), [`src/sessions/project-state-database.ts:1506-1513`](/Users/matthew/git/oss/guildhall/src/sessions/project-state-database.ts:1506) |
| Legacy `project-summary.json` | Compatibility | Read only by migration reader; promoted DB path is authoritative | Migration/backfill and legacy compatibility | [`src/runtime/project-summary-projection.ts:1314-1358`](/Users/matthew/git/oss/guildhall/src/runtime/project-summary-projection.ts:1314) |
| Legacy task runtime/workspace/evidence JSON/JSONL | Compatibility/historical | Used by legacy authority; promoted writes prefer DB and retain compatibility output where configured | Migration, legacy effective-task reads, evidence history | [`src/sessions/task-state-store.ts:41-75`](/Users/matthew/git/oss/guildhall/src/sessions/task-state-store.ts:41), [`src/sessions/task-state-store.ts:249-293`](/Users/matthew/git/oss/guildhall/src/sessions/task-state-store.ts:249), [`src/sessions/task-state-store.ts:1137-1175`](/Users/matthew/git/oss/guildhall/src/sessions/task-state-store.ts:1137) |
| Transcript files under local-history | Historical/debug | Per-task transcript artifacts; not an intended permanent project-state payload | Exploration/debug and explicit cleanup/migration | [`src/sessions/local-history.ts:181-239`](/Users/matthew/git/oss/guildhall/src/sessions/local-history.ts:181) |
| Essential-history file | Historical/compact memory | Bounded 6 KB summary and 12 KB input; intended durable representation of intake conversation state | Context planning and memory compaction | [`src/runtime/essential-history.ts:5-74`](/Users/matthew/git/oss/guildhall/src/runtime/essential-history.ts:5) |
| Session snapshots and `latest.json` | Historical/compatibility | Messages are compacted before save; snapshots are listed by scanning the snapshot directory | Session recovery, session listing, task/thread context | [`src/sessions/storage.ts:109-264`](/Users/matthew/git/oss/guildhall/src/sessions/storage.ts:109), [`src/sessions/storage.ts:446-505`](/Users/matthew/git/oss/guildhall/src/sessions/storage.ts:446) |
| Supervisor recent events and persisted activity | Historical operational stream | In-memory cap 200; persisted cap 1000 lines/512 KB; page size 100; event text cap 600 chars | Live activity and timeline/history views | [`src/runtime/serve-supervisor.ts:181-189`](/Users/matthew/git/oss/guildhall/src/runtime/serve-supervisor.ts:181), [`src/runtime/serve-supervisor.ts:194-430`](/Users/matthew/git/oss/guildhall/src/runtime/serve-supervisor.ts:194), [`src/runtime/serve-supervisor.ts:487-557`](/Users/matthew/git/oss/guildhall/src/runtime/serve-supervisor.ts:487) |
| Context-debug snapshots and `context-debug.jsonl` | Historical/debug evidence | Snapshot/ledger compaction is threshold-driven; records can be large until compaction | Explicit diagnostics, context observability, debugging | [`src/runtime/context-observability.ts:551-635`](/Users/matthew/git/oss/guildhall/src/runtime/context-observability.ts:551), [`src/runtime/context-observability.ts:757-825`](/Users/matthew/git/oss/guildhall/src/runtime/context-observability.ts:757) |
| Local-history heartbeat | Historical/operational | Bounded to 256 KB/512 records, but append rewrites the file | Progress/status diagnostics and cleanup | [`src/sessions/local-history.ts:14-16`](/Users/matthew/git/oss/guildhall/src/sessions/local-history.ts:14), [`src/sessions/local-history.ts:53-63`](/Users/matthew/git/oss/guildhall/src/sessions/local-history.ts:53) |
| Migration snapshots, archive evidence, codebase-map history | Historical/migration | Created and removed by explicit compaction/migration routines, not normal current reads | Migration and cleanup tooling | [`src/runtime/project-state-compaction.ts:794-812`](/Users/matthew/git/oss/guildhall/src/runtime/project-state-compaction.ts:794) |
| Memory audit reports | Historical/debug | Timestamped JSON reports; no aggregate retention cap is evident in the writer | Memory inspection/audit tooling | [`src/memory-core/data-access.ts:485-497`](/Users/matthew/git/oss/guildhall/src/memory-core/data-access.ts:485) |

The absence of an aggregate cap for memory audit reports is a concrete
retention gap. The context-debug system has compaction, but this inventory does
not establish that its total footprint is small before compaction runs.

## 5. Request-time repairs, scans, and reconstruction

“Request-time” includes work performed synchronously by a route or read helper.
Background projector work is listed here when it repeats the same broad scan or
reconstruction, because it still demonstrates that the model is not serving a
small authoritative read model.

| Code path | Classification | What it does | Surface or caller | Evidence |
| --- | --- | --- | --- | --- |
| `readTasksFileNormalized(..., { repair: true })` | Compatibility repair | Reads queue, normalizes imported drafts, fixes status/ownership contradictions, and writes the entire queue with a summary | Legacy queue reads and repair paths in `serve.ts` | [`src/runtime/serve.ts:947-1043`](/Users/matthew/git/oss/guildhall/src/runtime/serve.ts:947) |
| `buildInbox` | Compatibility/source-discovery reconstruction | Reads task/plan files, scans repository anchors, derives proof-missing items, wizard/spec-fill work, and agent-settings levers | Inbox projector and background attention materialization | [`src/runtime/inbox.ts:385-675`](/Users/matthew/git/oss/guildhall/src/runtime/inbox.ts:385), [`src/runtime/serve.ts:2040-2047`](/Users/matthew/git/oss/guildhall/src/runtime/serve.ts:2040) |
| `prepareProjectSummaryProjectionFromUnknownQueue` | Compatibility/write-time reconstruction | Parses an unknown queue, reads plan and orientation inputs, reads source mtimes, and builds summary/scope | Targeted mutation preparation, legacy writes and migration | [`src/runtime/project-summary-projection.ts:1070-1228`](/Users/matthew/git/oss/guildhall/src/runtime/project-summary-projection.ts:1070), [`src/runtime/project-state-boundary.ts:1237-1305`](/Users/matthew/git/oss/guildhall/src/runtime/project-state-boundary.ts:1237) |
| `buildEffectiveTasks` | Rich read-time expansion | Expands all task definitions with runtime, workspace, evidence, and proof overlays when a compact indexed read is insufficient | Rich project detail, task detail, legacy compatibility, some background refreshes | [`src/runtime/effective-task.ts:345-384`](/Users/matthew/git/oss/guildhall/src/runtime/effective-task.ts:345), [`src/runtime/project-state-boundary.ts:270-305`](/Users/matthew/git/oss/guildhall/src/runtime/project-state-boundary.ts:270) |
| Live `buildProjectReleaseReadinessPayload` branch | Request-time diagnostic recomputation | Re-runs scope readiness, blockers, proof, Git/repository follow-up, design-system and codebase checks, then compares against saved state | Live/diagnostic project and release-readiness routes | [`src/runtime/serve.ts:15986-16440`](/Users/matthew/git/oss/guildhall/src/runtime/serve.ts:15986) |
| `readProjectRepositorySignature` | Request/background repository scan | Reads workspace config/child projects and runs `git status --porcelain` for root and children | Repository observation, freshness watcher, diagnostics | [`src/runtime/serve.ts:1801-1823`](/Users/matthew/git/oss/guildhall/src/runtime/serve.ts:1801) |
| `refreshProjectRepositoryObservation` | Background repository scan | Inspects Git story/status and writes repository projection rows | Projection refresh and diagnostic publication | [`src/runtime/serve.ts:1825-1875`](/Users/matthew/git/oss/guildhall/src/runtime/serve.ts:1825) |
| Freshness watcher | Background fleet-wide scan | Polls all roots, compares DB metadata and optional repository signatures, and schedules projection work; default interval is 1000 ms | Serve lifecycle and projection scheduler | [`src/runtime/project-projection-freshness-watcher.ts:5-101`](/Users/matthew/git/oss/guildhall/src/runtime/project-projection-freshness-watcher.ts:5), [`src/runtime/serve.ts:17859-17861`](/Users/matthew/git/oss/guildhall/src/runtime/serve.ts:17859) |
| Local-history health | Diagnostic recursive scan | Walks project history files and sums file count/bytes | Diagnostics, health and cleanup surfaces | [`src/sessions/local-history.ts:242-288`](/Users/matthew/git/oss/guildhall/src/sessions/local-history.ts:242) |
| Session snapshot listing | Historical directory scan | Reads/readdir/stat/JSON for all snapshot candidates before applying the bounded result | Session listing and recovery UI/CLI | [`src/sessions/storage.ts:477-505`](/Users/matthew/git/oss/guildhall/src/sessions/storage.ts:477) |
| Memory event consolidation/append | Historical maintenance scan | Reads the bounded event stream, consolidates legacy per-scope files, and rewrites the retained tail | Memory write/consolidation and migration | [`src/memory-core/data-access.ts:332-416`](/Users/matthew/git/oss/guildhall/src/memory-core/data-access.ts:332), [`src/memory-core/data-access.ts:418-483`](/Users/matthew/git/oss/guildhall/src/memory-core/data-access.ts:418) |
| Project graph query | Compatibility/discovery scan | Re-reads graph registry and discovers local graph projects/dependency edges | Graph and structural-map views | [`src/runtime/project-graph.ts:494-535`](/Users/matthew/git/oss/guildhall/src/runtime/project-graph.ts:494) |
| Projection refresh coordinator | Background repair/rebuild | Coalesces domain invalidations, claims jobs, refreshes repositories, summaries, memory, delivery, diagnostics, Thread, Inbox, and fleet publication | Serve background projector | [`src/runtime/project-projection-refresh.ts:38-153`](/Users/matthew/git/oss/guildhall/src/runtime/project-projection-refresh.ts:38), [`src/runtime/serve.ts:1877-2084`](/Users/matthew/git/oss/guildhall/src/runtime/serve.ts:1877) |

The ordinary promoted compact project route is substantially better than the
old “load every project and rebuild everything” path: it uses the saved surface
boundary. The remaining scans above are nevertheless architectural evidence of
why freshness, diagnostics, imports, and legacy projects can still become
expensive or disagree with saved state.

## 6. Duplicated summary and state calculations

These are the highest-confidence cases where the same user-facing concept is
calculated or stored more than once.

### 6.1 Saved progress versus `workProgressFromProjectSummaryProjection`

The canonical summary builder computes scope counts, release summaries,
readiness, blockers, next action, recent work, and in-flight state in
`project-summary-projection.ts:381-410` and `project-summary-projection.ts:900-930`.
The serve layer then has `workProgressFromProjectSummaryProjection`, which
rebuilds selected-scope counts by reconstructing scope rows and execution rows
from the task queue. That helper is not merely formatting the saved result; it
can produce another count path.

Evidence: [`src/runtime/serve.ts:2520-2587`](/Users/matthew/git/oss/guildhall/src/runtime/serve.ts:2520),
[`src/runtime/serve.ts:2750-3016`](/Users/matthew/git/oss/guildhall/src/runtime/serve.ts:2750).

### 6.2 Saved readiness versus live diagnostic readiness

The ordinary project/release paths use saved summary and diagnostic rows. The
live/diagnostic branch calls `summarizeScopedReleaseWork`, redoes proof and
blocker calculations, inspects repository/design-system/codebase state, and
compares dynamic output with saved output. This is an explicit diagnostic mode,
not an accidental fallback, but it is still a second implementation of the
project readiness answer and exposes `stateConsistency` when the answers differ.

Evidence: [`src/runtime/serve.ts:15986-16440`](/Users/matthew/git/oss/guildhall/src/runtime/serve.ts:15986),
including the saved/dynamic comparison and `freshness: "request_time"` path.

### 6.3 Summary payload versus normalized auxiliary rows

`project_summary.payload` includes execution, runtime, and owner-input fields.
The same compact current facts are also stored in `current_execution`,
`current_runtime`, and `owner_inputs`. `syncSummaryAuxiliaryRows` writes the
auxiliary rows from the summary, while `hydrateSummaryFromAuxiliaryRows` reads
them back into the summary. This is a two-way synchronization mechanism, not a
single fact owner.

Evidence: [`src/sessions/project-state-database.ts:1996-2105`](/Users/matthew/git/oss/guildhall/src/sessions/project-state-database.ts:1996),
[`src/sessions/project-state-database.ts:5010-5050`](/Users/matthew/git/oss/guildhall/src/sessions/project-state-database.ts:5010).

### 6.4 Summary orientation/plan versus `project_orientation`/`project_plan`

The summary payload contains `orientation` and `approvedPlan`, while dedicated
tables store orientation and imported plan rows. Summary patching writes both
representations. This makes it possible for a summary payload and the direct
orientation/plan reader to diverge unless the transaction and revision checks
are perfect.

Evidence: [`src/sessions/project-state-database.ts:1534-1587`](/Users/matthew/git/oss/guildhall/src/sessions/project-state-database.ts:1534),
[`src/sessions/project-state-database.ts:5022-5045`](/Users/matthew/git/oss/guildhall/src/sessions/project-state-database.ts:5022).

### 6.5 Normalized release membership versus JSON membership mirrors

`release_membership` is the normalized relationship, but `scopes.node_ids_json`,
queue release envelopes, and `work_items.release_ids_json` still retain arrays.
The boundary normalizes the relationship for promoted reads, while import,
migration, and compatibility paths continue to inspect the arrays. This is a
model duplication rather than a presentation-only duplication.

Evidence: [`src/sessions/project-state-database.ts:1447-1464`](/Users/matthew/git/oss/guildhall/src/sessions/project-state-database.ts:1447),
[`src/sessions/project-state-database.ts:1514-1533`](/Users/matthew/git/oss/guildhall/src/sessions/project-state-database.ts:1514),
[`src/runtime/project-state-boundary.ts:205-268`](/Users/matthew/git/oss/guildhall/src/runtime/project-state-boundary.ts:205).

### 6.6 Owner-input JSON versus `owner_inputs`

The owner-input store lists and parses every JSON request, then writes the
compact `owner_inputs` projection and summary patch. Some routes still read
the JSON request files directly. The JSON is valid detail/history, but current
pending/resolved state is therefore not exclusively read from the DB.

Evidence: [`src/runtime/owner-input-store.ts:134-244`](/Users/matthew/git/oss/guildhall/src/runtime/owner-input-store.ts:134),
with direct route consumers found in `src/runtime/serve.ts:10593` and
`src/runtime/structural-map.ts:1333-1363`.

### 6.7 Runtime JSON/supervisor state versus compact execution/runtime rows

Detailed runtime state is written to `runtime/state.json`; live supervisor state
is held in memory and represented in bounded activity events; compact copies are
written to `current_runtime` and `current_execution`. The three forms have
different lifetimes and update paths. No single transaction owns the complete
runtime/control state.

Evidence: [`src/runtime/project-runtime-store.ts:196-225`](/Users/matthew/git/oss/guildhall/src/runtime/project-runtime-store.ts:196),
[`src/runtime/serve-supervisor.ts:560-783`](/Users/matthew/git/oss/guildhall/src/runtime/serve-supervisor.ts:560),
[`src/runtime/stop-requested.ts:7-91`](/Users/matthew/git/oss/guildhall/src/runtime/stop-requested.ts:7).

### 6.8 Full effective-task derivation versus indexed task state

The promoted DB contains indexed current task rows and overlays, but rich paths
still call `buildEffectiveTasks` to materialize a complete effective task set.
Some background refreshes also expand all tasks after invalidation. The indexed
model is therefore not yet sufficient for every shared summary/read path.

Evidence: [`src/runtime/effective-task.ts:345-384`](/Users/matthew/git/oss/guildhall/src/runtime/effective-task.ts:345),
[`src/runtime/serve.ts:1956-1981`](/Users/matthew/git/oss/guildhall/src/runtime/serve.ts:1956),
[`src/runtime/project-state-boundary.ts:270-305`](/Users/matthew/git/oss/guildhall/src/runtime/project-state-boundary.ts:270).

### 6.9 Freshness and projection ownership

Summary patches call `commitAuthoritativeMutation` with `domains: ['queue']`
even when the patch is changing summary/auxiliary state. That can make queue
freshness and invalidation metadata stand in for several different domains.
This is not just naming: it can cause broad or incorrect refresh behavior.

Evidence: [`src/sessions/project-state-database.ts:5010-5050`](/Users/matthew/git/oss/guildhall/src/sessions/project-state-database.ts:5010).

## 7. Relationship to the preceding audits

The previous documents are useful constraints, but they are not proof that the
target architecture is complete.

- The 2026-07-14 inventory correctly identified the earlier state as a mixed
  system in which task JSON, runtime ledgers, evidence, owner-input files, and
  Git acted as practical authorities. The current branch has moved more of
  those facts into SQLite, but the compatibility/current split still exists.
  See [`internal/audits/2026-07-14-project-state-inventory.md:8-111`](/Users/matthew/git/oss/guildhall/internal/audits/2026-07-14-project-state-inventory.md:8).
- The 2026-07-15 writer-graph audit found that the shared writer exists but
  aggregate replacement, separate attention/evidence/runtime writes, and
  explicit repair paths remain. The current code still shows those seams.
  See [`internal/audits/2026-07-15-project-state-writer-graph.md:9-44`](/Users/matthew/git/oss/guildhall/internal/audits/2026-07-15-project-state-writer-graph.md:9).
- The 2026-07-16 authority/projection audit describes the intended one-current-
  authority contract and the desired read boundaries. It also explicitly lists
  remaining request-time diagnostics, effective-task expansion, and incomplete
  projector tests. This inventory confirms those are still visible in code.
  See [`internal/audits/2026-07-16-project-state-authority-and-projection-audit.md:8-134`](/Users/matthew/git/oss/guildhall/internal/audits/2026-07-16-project-state-authority-and-projection-audit.md:8).
- The 2026-07-17 fleet audit proves that the fleet projection itself is bounded,
  while the service route still does synchronous per-project work and can wait
  on SQLite's five-second busy timeout. This is a read-path performance gap,
  not evidence that the underlying authority model is finished.
  See [`internal/audits/2026-07-17-fleet-service-summary-performance.md:58-80`](/Users/matthew/git/oss/guildhall/internal/audits/2026-07-17-fleet-service-summary-performance.md:58).

## 8. High-confidence gaps blocking the active data-layer goal

These are the gaps I can prove from the current code. They are ordered by
architectural leverage, not by UI visibility.

### P0: No complete single owner for all current facts

The promoted database is the current owner for the indexed work graph and many
compact read models, but runtime detail, live process control, stop state,
owner-input detail, delivery model, memory inputs, Git observation, project
registration, and project graph state remain outside it. Some of those should
remain separate domains, but the code does not yet express a clear authority
contract and transaction boundary for each domain. Compact copies are currently
written beside source files, allowing disagreement by construction.

Evidence: the database schema [`src/sessions/project-state-database.ts:1438-1717`](/Users/matthew/git/oss/guildhall/src/sessions/project-state-database.ts:1438),
the runtime/owner/delivery stores [`src/runtime/project-runtime-store.ts:196-225`](/Users/matthew/git/oss/guildhall/src/runtime/project-runtime-store.ts:196),
[`src/runtime/owner-input-store.ts:63-244`](/Users/matthew/git/oss/guildhall/src/runtime/owner-input-store.ts:63),
[`src/runtime/delivery-spine.ts:449-505`](/Users/matthew/git/oss/guildhall/src/runtime/delivery-spine.ts:449).

### P0: Summary state has multiple writable representations

The summary payload and auxiliary tables are synchronized in both directions,
and summary patches use a queue domain even when they update non-queue facts.
This is the clearest data-model reason that state can drift or require repair.

Evidence: [`src/sessions/project-state-database.ts:1996-2105`](/Users/matthew/git/oss/guildhall/src/sessions/project-state-database.ts:1996),
[`src/sessions/project-state-database.ts:5010-5050`](/Users/matthew/git/oss/guildhall/src/sessions/project-state-database.ts:5010).

### P0: Shared read surfaces still have competing computation paths

Saved summary/readiness, live diagnostics, `workProgressFromProjectSummaryProjection`,
`summarizeScopedReleaseWork`, and full effective-task derivation can answer the
same user question from different inputs. The application can therefore show a
saved answer, a dynamic answer, and a task-derived answer without one explicit
authority deciding which is product truth.

Evidence: [`src/runtime/project-summary-projection.ts:381-410`](/Users/matthew/git/oss/guildhall/src/runtime/project-summary-projection.ts:381),
[`src/runtime/serve.ts:2520-2587`](/Users/matthew/git/oss/guildhall/src/runtime/serve.ts:2520),
[`src/runtime/serve.ts:15986-16440`](/Users/matthew/git/oss/guildhall/src/runtime/serve.ts:15986).

### P1: Fleet loading is projected but still not fully read-model driven

The fleet database is bounded and separates malformed projects, but the service
route still performs synchronous per-project work. The audited implementation
also retains a five-second SQLite busy timeout that can delay a fleet response.
This leaves the Projects page vulnerable to the same “wait for every project”
shape the new architecture is intended to remove.

Evidence: [`internal/audits/2026-07-17-fleet-service-summary-performance.md:58-80`](/Users/matthew/git/oss/guildhall/internal/audits/2026-07-17-fleet-service-summary-performance.md:58),
[`src/sessions/project-state-database.ts:1427-1436`](/Users/matthew/git/oss/guildhall/src/sessions/project-state-database.ts:1427).

### P1: Freshness polling performs broad repository scans

The watcher polls every project and can run `git status --porcelain` over the
root and child repositories. This is useful for freshness, but it is not a
small state lookup and is wired into the normal serve lifecycle.

Evidence: [`src/runtime/project-projection-freshness-watcher.ts:28-101`](/Users/matthew/git/oss/guildhall/src/runtime/project-projection-freshness-watcher.ts:28),
[`src/runtime/serve.ts:1801-1823`](/Users/matthew/git/oss/guildhall/src/runtime/serve.ts:1801),
[`src/runtime/serve.ts:17859-17861`](/Users/matthew/git/oss/guildhall/src/runtime/serve.ts:17859).

### P1: Inbox and owner-input projection still scan source files broadly

Inbox building reads task/plan/settings sources and repository anchors, while
owner-input refresh lists and parses all owner-input JSON files. The result is
materialized, but the source-to-projection path is still a broad scan rather
than an incremental fact update.

Evidence: [`src/runtime/inbox.ts:385-675`](/Users/matthew/git/oss/guildhall/src/runtime/inbox.ts:385),
[`src/runtime/owner-input-store.ts:134-244`](/Users/matthew/git/oss/guildhall/src/runtime/owner-input-store.ts:134).

### P1: Runtime control is not transactionally unified

Live supervisor state, runtime JSON, stop marker, persisted activity, and
compact DB execution/runtime rows have separate update lifecycles. A crash or
interleaving write can leave the controls and the visible summary at different
points in time.

Evidence: [`src/runtime/serve-supervisor.ts:181-189`](/Users/matthew/git/oss/guildhall/src/runtime/serve-supervisor.ts:181),
[`src/runtime/serve-supervisor.ts:560-783`](/Users/matthew/git/oss/guildhall/src/runtime/serve-supervisor.ts:560),
[`src/runtime/project-runtime-store.ts:196-225`](/Users/matthew/git/oss/guildhall/src/runtime/project-runtime-store.ts:196),
[`src/runtime/stop-requested.ts:7-91`](/Users/matthew/git/oss/guildhall/src/runtime/stop-requested.ts:7).

### P1: Compatibility paths are still capable of manufacturing current scope

`queueForProjectSummaryScope` and `readApprovedPlan` reconstruct scope/release
membership from approved workspace plan data for legacy/pre-migration paths.
The promoted path preserves database-owned membership, but the existence of
this reconstruction means the same project concept still has two construction
rules.

Evidence: [`src/runtime/project-summary-projection.ts:238-343`](/Users/matthew/git/oss/guildhall/src/runtime/project-summary-projection.ts:238),
[`src/runtime/project-summary-projection.ts:1541-1615`](/Users/matthew/git/oss/guildhall/src/runtime/project-summary-projection.ts:1541).

### P1: Projected detail is not always read atomically with authority metadata

The promoted detail adapter reads authority metadata and then compact state in
separate calls. The main surface boundary has a joined transaction, but this
adapter can observe different revisions if a write lands between those reads.

Evidence: [`src/runtime/project-detail-read-projection.ts:160-234`](/Users/matthew/git/oss/guildhall/src/runtime/project-detail-read-projection.ts:160).

### P2: Historical retention is unevenly governed

Several stores have explicit caps, but memory audit reports have no demonstrated
aggregate cap, context-debug retention depends on compaction, and local-history
health itself recursively scans the entire tree. The system therefore has good
per-stream bounds in places without one global retention contract.

Evidence: [`src/memory-core/data-access.ts:485-497`](/Users/matthew/git/oss/guildhall/src/memory-core/data-access.ts:485),
[`src/runtime/context-observability.ts:757-825`](/Users/matthew/git/oss/guildhall/src/runtime/context-observability.ts:757),
[`src/sessions/local-history.ts:242-288`](/Users/matthew/git/oss/guildhall/src/sessions/local-history.ts:242).

### P2: Projection coordination tests and migration completion are incomplete

The preceding authority audit explicitly records incomplete async projector
endpoint tests, remaining effective-task/detail work, and unfinished migration
cleanup. The current code still has compatibility readers, mirrors, and
request-time reconstruction paths described above.

Evidence: [`internal/audits/2026-07-16-project-state-authority-and-projection-audit.md:136-166`](/Users/matthew/git/oss/guildhall/internal/audits/2026-07-16-project-state-authority-and-projection-audit.md:136).

## Bottom line

The right next architectural move is not another route-level optimization or a
new summary card. It is to make every current fact have one explicit owner,
make every projection consume that owner through one read/write boundary, and
make compatibility readers migration-only for promoted projects. The current
SQLite database is a strong foundation for that move, but the inventory proves
that it is not yet the universal authority and that summary/readiness state is
still duplicated in code and storage.
