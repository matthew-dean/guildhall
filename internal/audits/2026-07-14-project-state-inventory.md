# Project-State Inventory: Architecture Pivot Baseline

**Date:** 2026-07-14
**Status:** Phase 0 baseline; incomplete by design until the remaining writers
are traced
**Related pivot:** `internal/plans/2026-07-14-project-state-architecture-pivot.md`

## Model Pivot Update — 2026-07-14

The initial inventory correctly identified request-time reconstruction, but its
first target treatment still left `TASKS.json`, runtime ledgers, evidence
ledgers, owner-input files, and Git inspection as practical authorities. That
would make the database only a faster mirror. The implementation now has the
pieces of a current-state boundary, but promotion is explicit per project and
must not be inferred merely from the presence of a SQLite file.

Schema version 3 contains normalized rows for `work_items`, `scopes`,
`task_execution`, `task_workspace`, `task_proof`, `current_execution`,
`current_runtime`, `owner_inputs`, `repositories`, `project_meta`, and the
generation-tagged `project_summary`. Queue, runtime/workspace, evidence,
supervisor/runtime, and owner-input summary writes update that store. The JSON
and JSONL files remain compatibility exports or historical detail while the
migration is proven; they are no longer the thing compact reads are required
to rehydrate.

This changes the audit criteria: a route is not considered fast merely because
it returns a smaller payload. It must avoid parsing task-history ledgers,
effective-task expansion, Thread reconstruction, inbox repair, and live Git
inspection. It must read the current database revision and expose stale or
unknown state honestly when a source has not yet crossed its write boundary.
The remaining work is direct database consumption, crash/concurrency proof,
real-project parity, and removal of the old request-time reconstruction paths.

## Overlay Authority Guardrail - 2026-07-14

The first reader transfer exposed a dangerous migration edge: once a database
file existed, a reader could mistake empty or partially imported overlay tables
for authoritative state and silently ignore a newer compatibility JSON store.
That is not a performance optimization; it is data loss by interpretation.

Schema version 10 adds `project_meta.task_overlay_authority`, which starts as
`legacy`. Runtime/workspace readers and effective-task projection only use the
SQLite overlay after migration `0.12.21/task-overlay-authority` has imported
the legacy current stores and promoted the marker to `database`. Before that
promotion, legacy JSON remains the compatibility reader. After promotion,
JSON is write-through compatibility output and cannot override the database.

The importer calls explicit legacy readers so it cannot read the just-created
database and declare a no-op import. The focused regression covers promotion,
stale compatibility JSON after promotion, and migration idempotence. This
guardrail is now the acceptance condition for every future authority transfer:
presence of a projection is not evidence that the projection owns the fact.

## Authority Correction — 2026-07-14

The first implementation and this document initially overstated the transfer:
SQLite is **not yet** the sole current aggregate. Three independent audits
found that `TASKS.json`, runtime/workspace JSON, per-task evidence JSONL,
owner-input files, and runtime control files still act as current authorities
on full Project, Thread, task-detail, repair, and orchestration paths. SQLite
currently powers the compact shell, selected scope rows, and several live
controls; it must not be described as canonical beyond those completed
boundaries.

The remaining architecture is therefore not “keep adding projections.” It is
an authority migration in this order:

1. Define transactional SQLite queue/task mutation and detail-read APIs; route
   every normal task/release writer through them; make `TASKS.json` an explicit
   compatibility import/export, not a normal reader.
2. Move effective-task overlays (runtime, workspace, latest proof) to the
   existing typed SQLite rows; keep JSON/JSONL as bounded history and recovery,
   never as a current compact/detail input.
3. Move owner-input, runtime lifecycle, health, and stop intent behind one
   transactional current-control reader; demote their JSON files to recovery
   input.
4. Split diagnostic endpoints from summary endpoints. Deep Release and task
   diagnostics may inspect evidence/Git on demand, but no ordinary navigation
   route may construct a project-wide aggregate to render one answer.

This correction is a guardrail: no new optimization can call SQLite
“authoritative” until its writers and readers have crossed the relevant fact.
The audit also found live API disagreements today (for example, Narrative
Harness reports paused work in full Overview but proof-blocked work in compact
Overview/Thread). Those are architecture failures, not copy bugs, and the
shared aggregate migration must make such disagreement impossible.

## Live-State Consolidation — 2026-07-14

The audit found three deceptively small JSON side stores that violated the
same ownership rule as the oversized queue: project availability,
attention-history records, and project-understanding reconciliation markers.
They were not large enough to explain the multi-megabyte payloads, but they
were enough to preserve the bad pattern: runtime features invented private
current state beside the database.

Schema version 5 moves those facts into typed `project_availability`,
`attention_records`, and `project_reconciliations` tables. Reads open the
database read-only and may consult a legacy file only as compatibility input;
they never create a project directory, database, table, or import. Explicit
pause/resume and attention/reconciliation writes own allocation. Migration
`0.12.11/project-live-state-consolidation` is the only bulk import path and
does not delete the old files. A later, separately approved allowlisted
cleanup may remove a legacy file only after it has proved an equivalent
normalized row exists.

This is intentionally not a generic pruning system. The regression begins
with a fresh project, reads all three compatibility shapes, asserts that no
database exists, then runs the explicit migration and verifies the normalized
rows. That test would have caught the allocation-on-read defect that allowed
the 3.5 GB history residue to accumulate.

## Installed Compact-Route Proof — 2026-07-14

After applying `0.12.8` through `0.12.11` to all seven registered projects,
building, dev-installing, restarting, and checking `stale:false`, the compact
routes were measured with the installed service:

| Project | Overview | Work | Map |
| --- | ---: | ---: | ---: |
| Narrative Harness | 45,938 B / 35 ms | 72,373 B / 10 ms | 65,084 B / 5 ms |
| Looma + Knit | 32,257 B / 7 ms | 65,242 B / 8 ms | 57,574 B / 6 ms |
| Jess | 6,942 B / 7 ms | 6,603 B / 5 ms | 6,802 B / 5 ms |
| Fair Labor License | 7,288 B / 4 ms | 6,935 B / 3 ms | 7,148 B / 3 ms |

All responses were `fresh: current` and omitted the full project config.
Overview and Work contained no Map roots; Map alone returned its bounded
navigator hierarchy. This is route evidence, not a claim that every deep
detail path is solved. `/api/project/spine?compact`, rich Release detail,
task/Thread detail, and the Timeline/Activity ownership overlap remain
separate audit targets.

## Bounded Work-Row Proof — 2026-07-14

Schema version 6 adds `work_items.summary_json`: a deliberately bounded row
for Work and Overview. It stores list-card facts such as title, status,
scope/release membership, first acceptance signal, work-unit count, and the
presence of a spec. It does not load the full definition, acceptance records,
evidence, or transcripts into a compact response. Migration
`0.12.12/work-item-list-projection` rebuilt this derived row for all seven
registered projects and left task definitions intact.

Installed proof after build/install/restart (`stale:false`) showed selected
scope counts are identical across compact Overview, Work, and Map: Narrative
Harness 11, Looma+Knit 5, Jess none, Fair Labor License none. The compact
queries are fast (Narrative 26/15/7 ms; Looma 6/12/5 ms), but Work's 100-row
default is still 122 KB for Narrative Harness and 114 KB for Looma+Knit. That
is recorded as an open product/data budget failure; a stored row does not
justify returning too many rows by default.

## Database Queue Envelope — 2026-07-14

Schema version 7 adds the missing queue metadata row to the normalized task and
release tables: queue version, last update, and selected release. The new
detail-reader API returns the complete queue only on demand, from one SQLite
read boundary. Task detail now prefers it when the shared projection is
current, with the legacy file retained only for stale/missing compatibility.

This is deliberately a reader transfer, not an authority-complete claim. A
normal task/release mutation still publishes `TASKS.json` before rebuilding
SQLite, and effective task overlays still come from their legacy stores. The
next phase must reverse that writer ordering and make typed overlay rows the
normal readers before the compatibility queue can be demoted.

## Task Detail Diagnostics Boundary — 2026-07-14

Ordinary task detail no longer returns recent events, context-debug, or an
exploring transcript. Those are separately requested through the explicit
`/api/project/task/:id/extras?include=...` diagnostic route when a user opens
the relevant drawer tab. Task Thread turns now follow the same rule: opening a
task does not build a project-wide Thread; selecting Action requests the
selected task's turns explicitly. Regressions seed a large transcript and
prove it cannot inflate the initial detail payload. This is a transport
boundary, not a retention claim: raw diagnostic writers still need their own
lifecycle transfer and byte budgets before they can be considered healthy.

Installed proof confirms the boundary is not cosmetic: initial task detail
dropped from 1.09 MB to 19 KB for Jess, 134 KB to 6 KB for Fair Labor License,
and 70 KB to 14 KB for Looma + Knit. The same optional diagnostics remain
available from the explicit extras read. Narrative Harness is still 83 KB
because the selected full task definition alone is about 62 KB, making its
detail contract the next separate budget problem.

## Storage technology review

The pivot is also a technology correction. The old system used JSON and JSONL
as if they were a database: each read reparsed files, rebuilt release
membership, reopened history ledgers, and repeatedly derived the same summary.
The new current-state boundary uses one local SQLite file per project through
Node's built-in `node:sqlite` API. SQLite supplies the missing transaction,
index, point-read, and bounded-scan semantics without adding a service or a
second remote authority. `@mastra/libsql` remains an adapter for the separate
memory subsystem; it is not being promoted into the project-state layer.

The format boundary is now explicit:

- SQLite typed columns own hot current facts and the generation-tagged summary.
- Small JSON text fields retain irregular full definitions and operation
  payloads only where detail reads need them; compact SQL projections omit
  those columns entirely.
- JSONL and other existing ledgers retain append-only evidence, audit history,
  and compatibility export value. They are never replayed to render a fleet
  card or compact project view.
- Git/provider/container observations are external operation results, stored
  as last-known repository state rather than queried during every page load.

The first implementation also exposed an accidental duplication: `state_meta`
and `project_meta` both described derived database metadata. `state_meta` has
been removed from the active schema and is dropped when an older local database
is opened; `project_meta` is the sole revision/schema row. This is a model
reduction, not a cosmetic cleanup.

The runtime floor is Node `22.12.0` because compact reads use read-only
`DatabaseSync` connections. The current local Node `24.11.1` runtime emits its official
experimental SQLite warning; that warning is recorded as a release risk and
must be covered by CI and installed-app startup proof. We will evaluate a
different SQLite driver only if the built-in API cannot meet the supported
runtime/distribution contract. We will not reintroduce request-time JSON
reconstruction to avoid making that decision.

The journal choice is intentionally conservative. WAL was tested against the
read-boundary contract and rejected for this local workload because a read-only
connection can create `-wal` and `-shm` sidecars. The database therefore uses
the rollback journal with `synchronous=FULL`; short writes and a five-second
busy timeout are enough for the single local service writer, while a read route
touches no durable companion files.

This is an evidence record for the project-state architecture pivot. It is not
another product model. It names the current boundaries and the places where
they currently get recombined too early.

## Fresh Installed Measurement and Authority Audit - 2026-07-15

The hot-read boundary is working in the installed artifact, but the data layer
is not finished. After `pnpm build`, `pnpm dev:install`, restart, and an exact
`/api/stale-server` check (`stale:false`), the current installed measurements
were:

| Read | Narrative Harness | Looma + Knit | Jess | Fair Labor License |
| --- | ---: | ---: | ---: | ---: |
| `/api/project?detail=true` | 55,907 B / 33 ms | 38,635 B / 79 ms | 28,190 B / 7 ms | 13,277 B / 4 ms |
| local active project bytes | 9,203,225 B | 17,098,245 B | 2,421,542 B | 2,707,014 B |
| current-state SQLite file | 778,240 B | 905,216 B | 147,456 B | 147,456 B |

`/api/service` is 30,965 bytes for seven registered projects. Narrative
Harness's compact project read is 55,907 bytes, while the explicitly named
`diagnostic=true` aggregate remains 1,919,766 bytes and about 1.7 seconds.
That gap is intentional and proves the normal route is no longer paying the
diagnostic cost. It does not prove the underlying model is small: the four
active project roots still total 31,430,026 bytes, and the whole local cache
is about 3.6 GB across 52,633 historical/test directories.

The largest active bytes are not the hot SQLite rows. They are old queue
snapshots and progress copies, task notes/review/gate ledgers, evacuation
copies, codebase-map history, and session/memory stores. For Narrative Harness,
the largest current files include a 778 KB database, 288 KB and 252 KB queue
snapshots, 239 KB of notes for one task, 163 KB of review verdicts, 261 KB of
code-map history, and 255 KB of recent events. Looma + Knit has a 2.1 MB queue
snapshot, a 1.3 MB queue snapshot, 1.1 MB of progress evacuation material,
and a 905 KB database. This is a retention and authority problem, not a gzip
problem.

The second audit pass found four remaining architectural violations:

1. Rich `buildEffectiveTask()` still reads the full task evidence JSONL by
   default even when database authority is active. Schema 12 now adds a
   bounded `task_evidence_current` reader, but ordinary release/readiness
   consumers have not been moved to it yet.
2. Rich Release readiness still reconstructs effective tasks, approved-plan
   augmentation, proof state, design-system state, and live repository state
   during a request. Thread, inbox, and Git Story have similar explicit-detail
   costs.
3. MCP, re-intake, and some generic session readers still have direct or
   existence-based compatibility paths that can bypass the authority marker.
4. Task evidence and reviewer-run histories remain unbounded writers. The new
   history page bounds one read, but it deliberately does not pretend to have
   compacted or re-modeled the stored history.

The correct status is therefore: **hot project reads are materially improved;
the current-state authority and history-retention refactor is still in
progress**. The next implementation slice must make current proof/runtime/
scope consumers read normalized projections directly, then define and verify
per-kind essential-history retention before any old bytes are removed.

## Narrative Harness payload audit — 2026-07-14

The `TASKS.json` source queue is 1,333,034 bytes (about 1.27 MiB), containing
168 task objects and no release records. The task objects themselves account
for about 1.10 MiB. This is not a transcript database disguised as a queue, but
it is still a bloated mixed record: one imported workspace task is about 41.7
KB because its inline spec is about 38.5 KB, and many imported tasks carry
20–35 KB combinations of specs, briefs, decomposition, readiness, proof, and
done-summary fields. Archived and historical work is mixed into the same
source queue as current work.

The separate local exploring transcript directory was about 288 KB. Its largest
file was the legacy `task-workspace-import` transcript at about 50.8 KB. The
larger local-history problem was raw diagnostics: Narrative Harness had about
32 MB of context-debug snapshots/ledgers and about 15 MB of persistence/event
data. That diagnostic mirror is now removed. Context-debug records retain only
recent compact manifests for non-terminal tasks, and completed-task diagnostics
are discarded during cleanup. None of this is required to render a project
card, work list, map, or fleet summary.

The first implementation response is now in the code boundary: durable
exploring history is rewritten as a bounded essential-history document by the
`contextIndexer` lane after each append, with deterministic bounded compaction
if the provider is unavailable. Session persistence applies the same rule at
the storage boundary, and `guildhall memory clean-project-state --apply` also
rewrites legacy exploring files plus completed session snapshots. Pending
tool-result tails are preserved for crash recovery. This removes raw
transcript scrollback from durable project memory. Context-debug is a separate
short-lived diagnostic cache: prompt/context bodies are never written, the
local manifest is the only durable diagnostic stream, and cleanup keeps at most
three snapshots and six manifests per non-terminal task. It is not loaded by
project/fleet summary reads.

New session snapshots no longer repeat the full system prompt. The prompt is
runtime configuration and is reconstructed by the caller; the legacy field is
kept empty on new writes so old readers remain compatible without carrying
another copy of the agent's instructions in every file.

The memory substrate finding was larger than the initial 13.5 MB Narrative
Harness database: ordinary packet construction instantiated Mastra/libSQL but
selected candidates from Guildhall's deterministic event files, so the
database was overhead rather than retrieval value. The default is now the
deterministic bounded packet path, which creates no database for reads. Mastra
is explicit opt-in until it proves that it performs real retrieval/compaction
and has a bounded lifetime. The 3.5 GB user-data residue also exposed a
separate allocation bug: local-history path resolution created directories on
reads and tests/worktrees were not isolated from the user data root.

## Live Timing Baseline

Against the installed service at `http://localhost:7777` on 2026-07-14:

| Request | Result | Time | Bytes |
| --- | --- | ---: | ---: |
| `GET /api/service/projects` | `200` | ~20 ms | 9,083 |
| `GET /api/service` | no response before 8 s timeout | >8 s | 0 |

The shell endpoint could return quickly because it reads registered projects,
the foreground run map, and raw task-queue counts. The full endpoint still
waits on the expensive project assembly path. At the time of measurement,
Narrative Harness also had an active run. That run was paused before continuing
the architecture work so the baseline would not keep changing underneath the
inventory.

This proves the failure is a request-graph problem, not merely a slow browser
render.

## Current Storage Boundaries

### Project identity and registration

**Owner:** workspace registry and project configuration.

**Used by:** project shell and service routes.

**Current facts:** registered projects can point to more than one underlying
repository; project identity is not equivalent to one Git repository.

**Target treatment:** authoritative project/repository references; compact
summary reads may use these without opening project history.

### Task definitions and scope membership

**Owner:** the per-project current-state database for managed current facts;
`TASKS.json` remains a compatibility import/export format during migration.

**Used by:** intake, orchestrator, task actions, work views, release/scope
projection, orientation, and service summaries.

**Current facts:** the queue can contain tasks plus release containers and a
selected release. Legacy bare-array queues are still supported. Task status,
parent/child hierarchy, release membership, deferred membership, specs, and
acceptance criteria participate in multiple interpretations.

**Current risk:** legacy compatibility readers such as
`readTasksFileNormalized()` can still mutate or derive queue state while
reading it. Those paths are now explicitly outside the compact read boundary
and must be removed or restricted to migrations and write commands.

**Target treatment:** the current-state database owns normalized task/scope
rows; `TASKS.json` is imported/exported at an explicit compatibility boundary.
Normalization and migration happen at writes or migrations, never as a side
effect of a compact GET.

### Runtime and execution state

**Owner:** local-history runtime stores, orchestrator supervisor, and task
runtime/workspace stores.

**Used by:** task detail, Work, active-run controls, Git story, and live status.

**Current facts:** execution state is correctly conceptually separate from the
task definition, but service assembly mixes it into the fleet request.

**Target treatment:** execution state contributes a compact current run/task
summary. Full workspace and run history stays on demand.

### Proof and evidence

**Owner:** task evidence ledgers and task fields that still carry compatibility
projections.

**Used by:** proof health, effective task construction, release readiness,
task detail, and reviewer surfaces.

**Current facts:** evidence is timestamped and can prove a newer result than a
stale recovery marker. The runtime now has compatibility logic for that case,
but a fleet card should not need to reconstruct all evidence to know a count.

**Target treatment:** a compact latest-proof/current-proof status is projected
on evidence writes. Full command output, review history, and recovery history
remain historical detail.

### Memory, threads, and intake

**Owner:** memory store, bounded-chat/session state, pressure-test intake, and
thread projection.

**Used by:** Thread, inbox, project check-in, orientation provenance, and
question flows.

**Current risk:** these are valuable explanations but are not required to render
a registered-project card. Reconstructing them during `/api/service` makes
history a hidden dependency of fleet loading.

**Target treatment:** keep them as detail/history projections. The current
summary may carry only an explicit open-question or owner-input count/action
that was updated at the relevant write boundary.

### Git and repository state

**Owner:** Git story and repository/worktree stores.

**Current risk:** `buildProjectGitStorySummary()` inspects root and child
repositories and may inspect task workspaces. This is valid detail, but it is
not a fleet-card dependency.

**Target treatment:** repository references and last known compact status in the
summary; fresh Git inspection only on project detail or an explicit refresh.

## Request-Time Reconstruction Found

`GET /api/service` currently performs, per registered project, some or all of:

1. provider status and model/readiness inspection;
2. migration and project check-in summaries;
3. project start-readiness calculation;
4. normalized task queue read and effective-task expansion;
5. workspace-import draft augmentation;
6. selected-scope/release truth and work-progress derivation;
7. Git story inspection;
8. inbox snapshot construction;
9. thread projection reconstruction from snapshot, tasks, chat sessions,
   pressure-test intakes, check-in state, and recent events;
10. action-model construction from those results.

Several of those outputs are correct and useful. The architectural failure is
that they are all prerequisites for one response and can include repair or
inspection work. The endpoint has no durable “last known summary” boundary.

## Existing Reusable Pieces

The pivot should extend or compose these rather than create parallel concepts:

- `src/runtime/project-scope-projection.ts` for selected scope, included /
  deferred rows, counts, and release blockers;
- `src/runtime/project-state-boundary.ts` for task-definition write hygiene;
- `src/runtime/task-state-store.ts` for runtime state and evidence ledgers;
- `src/runtime/project-runtime-store.ts` for runtime-backed state;
- `src/runtime/project-orientation-spine.ts` for the existing orientation
  vocabulary and source provenance;
- `src/web/lib/project-summary.ts` for shared presentation of service summary
  results;
- `src/runtime/project-action-model.ts` for the canonical next-action decision;
- `@guildhall/sessions` atomic project-state helpers;
- `@guildhall/persistence` managed-file and evidence persistence.

The new projection must not become a second implementation of scope, action,
or completion math. It should receive those shared results or extract a small
pure builder that both the write path and detail path use.

## Immediate Architectural Findings

1. The current task queue is the smallest viable seed for a project summary,
   but it is not sufficient by itself for current proof, run, or owner-input
   state.
2. The existing runtime/evidence stores are the right place to retain detail,
   but no single update boundary currently marks the project summary dirty or
   refreshes it.
3. Request-time “repair” is still mixed with reading. That must be separated
   before a projection can be called authoritative.
4. Release/scope projection already exists and should become the completion
   authority for scoped work; no new “MVP boundary” abstraction is warranted.
5. The per-project hydration change is useful failure isolation, but it is not a
   substitute for a durable last-known summary and should not acquire more
   business logic.

## Real-Project Parity Failure — Narrative Harness

The first cross-surface parity pass against the installed Narrative Harness
project found a concrete disagreement in the selected release population:

- compact project and compact spine: 12 current tasks, 30 deferred, 9 done,
  9 proof-blocked;
- explicit Release readiness: 11 current tasks, 8 done, 3 unfinished, and no
  proof blockers in its totals;
- the missing compact task was a completed DeepInfra model-selection task that
  existed in the queue release envelope but was dropped when workspace-import
  release metadata was layered over the queue release.

This is not a presentation discrepancy. `releaseProjectionInputsForTasks()`
was replacing an existing release record with the later import record, which
discarded the queue's `nodeIds`. The runtime now merges release membership and
deferred membership by release ID. The compact scope reader also treats queue
membership as authoritative per release once the queue has explicit assignments;
approved-plan IDs can seed an empty release but cannot widen an assigned one.
The regression fixtures prove that approved import state cannot erase or widen
queue-backed current work.

The parity failure remains a calibration case: all surfaces must use the same
selected task IDs and then add detail-only blockers such as Git follow-up.
Fixing this overwrite bug does not yet make the projection authoritative for
proof, runtime, or repository state.

## Post-Pivot Boundary Check

After the first projection-backed boundary slice, the installed service was
rebuilt and measured again on 2026-07-14:

| Request | Result | Time | Bytes |
| --- | --- | ---: | ---: |
| `GET /api/service/projects` | `200` | 16 ms | 15,117 |
| `GET /api/service` | `200` | 4 ms | 15,132 |
| `GET /api/service?detail=true` | `200` | 79 ms | 28,470 |
| `GET /api/project/activity?projectId=narrative-harness` | `200` | 9 ms | 1,491 |

The service had seven registered projects. `/api/stale-server` reported
`stale:false`. Narrative Harness reported `summaryFreshness: current`, and
its activity action model matched the selected-project service action model.

The old full fleet reconstruction is deleted. The remaining `detail=true`
route is a bounded projection/provider/migration summary for diagnostics; it
is no longer allowed to rebuild effective tasks, Thread, Git Story, inbox, or
history for every registered project.

One model defect surfaced during parity testing: stopped-project shaping repair
constructed a task-only queue and dropped release metadata. The shared task
write boundary now preserves an existing release envelope when a repair does
not explicitly replace it. This is recorded as a data-model integrity fix, not
as a test-specific exception.

The baseline above is evidence for the fleet boundary only. It does not prove
that Overview, Map, Work, Releases, or task detail have stopped doing their own
request-time reconstruction.

The selected project surfaces still expose the remaining cost directly. Warm
Narrative Harness reads measured approximately 2,267 ms for Overview, 2,113 ms
for Work, and 1,764 ms for Map. Their `server-timing` headers put most of that
time in `readiness`, especially scope and release-review calculations. This is
the next sharp target: the shell can now appear promptly, but selected detail
must stop recomputing release readiness before it can render its durable
summary.

## Selected Project Projection Boundary

The installed artifact was rebuilt and re-measured after moving the browser's
default project hydration to `/api/project?compact=true`:

| Request | Result | Time | Bytes | Inventory |
| --- | --- | ---: | ---: | --- |
| `GET /api/service/projects` | `200` | 29 ms | 15,117 | 7 projects |
| `GET /api/service` | `200` | 26 ms | 15,132 | 7 projects |
| `GET /api/project?compact=true` | `200` | 106 ms | 168,755 | 19 of 168 tasks for NH shell |
| `GET /api/project?surface=overview&compact=true` | `200` | 81 ms | 168,755 | selected-scope preview |
| `GET /api/project?surface=work&compact=true` | `200` | 18 ms warm | 272,694 | 168 bounded work records |
| `GET /api/project?surface=map&compact=true` | `200` | 16 ms warm | 188,729 | 9 roots with identity-only task records |

The compact path has no `readiness` timing segment and its response declares
that release data is `completeness: scope` with `checksLoaded: false`. That is
an intentional contract: the shell can say what scoped work exists and what
the current action is without pretending it loaded repository, design-system,
Git Story, inbox, Thread, or history checks.

The first response-size audit caught and fixed a smaller version of the same
problem: Overview initially returned the full orientation tree and all 168
tasks even though the server was fast. The current Overview path uses the
selected-scope preview and action-relevant tasks only. A second pass now keeps
Work's row signals while removing full criteria/work-unit/size-plan/evidence
arrays, and reduces Map tasks to identity-only records. Work and Map still
return the full inventory; pagination or a bounded tree endpoint remains the
next step for very large projects.

## Inventory Payload Boundary

The user job is simple: opening Work or Map should show a usable project
inventory quickly, while opening a task should provide the full record only for
that task. The previous compact route still serialized rich task arrays into
every Work and Map response, so the server was no longer the main bottleneck
but the browser still paid for data it could not display at once.

The read contract is now explicit:

- Work receives canonical title/description, hierarchy, source grounding,
  lifecycle and action signals, compact brief/spec/readiness markers, counts
  for acceptance criteria and work units, and the small completion-proof
  summary its rows render.
- Map receives only task identity, title, status, work kind, and release
  membership. Its orientation projection owns the hierarchy and source trail.
- Full criteria, work-unit analysis, size plans, raw evidence, and other rich
  task fields remain available through task detail; they are not duplicated in
  inventory payloads.

This is a compatible response projection over the existing authoritative task
queue. No task, release, or project record is rewritten. The focused runtime
contract test proves that Work preserves row-level counts and markers while
omitting rich arrays, and that Map omits descriptive/proof fields entirely.
The installed Narrative Harness proof measured warm Work at 18 ms / 272,694
bytes and Map at 16 ms / 188,729 bytes. The remaining limitation is explicit:
all inventory rows are still returned, so large-project paging/bounded loading
is still required.

## Thread Projection Boundary

The Thread route was another hidden full-state dependency. Before the pivot it
performed stopped-state repair, effective-task expansion, full release
readiness, and orientation reconstruction before returning the transcript. The
compact Thread response now consumes the same projection-backed scope and
action model as the project shell. Full repository, design-system, and Git
Story checks remain on explicit detail routes and are labeled as omitted from
the fast response.

Installed Narrative Harness proof after the route change:

| Request | Result | Time | Bytes | Read model |
| --- | --- | ---: | ---: | --- |
| `GET /api/project/thread` | `200` | 70 ms | 98,315 | turns + compact scope/navigation |
| `GET /api/project/thread/extras?taskIds=task-009` | `200` | 73 ms | 794 | task-scoped Git Story enrichment |

The 70 ms Thread result is down from the earlier 4,118 ms / 630,440 byte
request. The extras route is now passed the task IDs already returned by the
first response, so it no longer reconstructs Thread to discover them.

## Next Evidence Slice

Before adding a new persisted file, trace and classify all writes to:

- `TASKS.json` and release selection;
- task runtime/workspace state;
- task evidence ledgers;
- run status and repository state;
- owner-input/inbox state;
- project registry and configuration.

For each write, record whether it must synchronously update a summary, mark it
stale for an asynchronous rebuild, or leave it out of the compact summary.
Then add one projection fixture per real project shape: Narrative Harness,
Looma + Knit, Jess, and Fair Labor License.

## Writer Boundary Update — 2026-07-14

The first pass routed these current task-queue writers through the existing
summary boundary: workspace import, project re-intake, improvement review,
product brief, proposal promotion/rejection, command-gate results, owner-input
repair, task-delivery migration, work-decomposition migration, project-state
compaction, and evacuated-task restore. They now commit normalized rows and the
summary in `project-state.db`; the queue and `project-summary.json` are
refreshed as compatibility exports beside it.

This does not close the inventory. The following remain separate sources that
can change what a complete summary should say without changing `TASKS.json`:

- task runtime/workspace/evidence ledgers;
- owner-input and bounded-chat records;
- active run/supervisor state;
- repository/worktree/Git state;
- delivery and project-graph records.

The next slice must finish direct database reads and explicit external
operation/result records. Until that exists, the database must expose its
limited freshness honestly rather than pretending every detail source is
already current.

## Source Freshness Update — 2026-07-14

The first explicit current-state write boundary now exists without adding
another state model or persisted source registry:

- task runtime and task workspace writes update normalized current rows and
  retain the full JSON store as detail. A whole-store replacement uses one
  SQLite transaction, rather than one database open/revision per task;
- evidence ledger appends update one latest-proof row per task and retain the
  full ledger as history;
- runtime-command evidence appends mark it stale;
- owner-input creation and response transitions update compact owner-input
  state; direct repair and bounded-chat writes still need a reliable boundary;
- project-runtime state writes update `current_runtime`;
- supervisor start, stop-request, stop, and error transitions update
  `current_execution`;
- the existing task/scope write boundary rebuilds the projection as current.

This is a deliberate transitional contract. Bounded-chat saves still lack a
reliable project-root parameter and remain an interface-design gap rather than
being guessed from hashed local-history paths. The next step is to move compact
readers onto the normalized rows and add crash/concurrency and real-project
parity proof; stale is still the honest visible state when a legacy source has
changed outside a recognized write boundary.

## Compact Execution Snapshot Update — 2026-07-14

The existing projection now carries optional execution and runtime snapshots.
Supervisor lifecycle writes update run status, timestamps, and errors; project
runtime-store writes update runtime status, health, and last activity. Queue
rebuilds preserve those snapshots. This removes two request-time reads from the
compact summary without introducing a second authoritative run or runtime
store.

Task runtime/evidence, direct owner-input repair, bounded-chat, and repository
sources remain explicitly incomplete in the compact projection. The supported
owner-input creation/response path now projects an open count and next question;
unsupported paths remain stale-marker or detail-only behavior and must not be
presented as a complete project state.

## Single Current-State Authority - 2026-07-14

Schema version 12 replaces the overly narrow `task_overlay_authority` name with
`project_state_authority`. The marker covers the entire current-state model:
queue rows, scope rows, summaries, execution, runtime, owner-input,
repositories, availability, attention, and reconciliation state. Schema 12
also stores a bounded per-task evidence-current projection beside the
latest-proof compatibility row. It is current-state data, not a second
history ledger; raw JSONL remains the explicit detail source until parity and
retention migrations are complete.

After promotion, `TASKS.json` and `project-summary.json` are legacy read inputs
only. Migration `0.12.23/project-state-single-authority` removes those
duplicate current-state files after verifying that the database queue is
readable; current-state writes cannot recreate them. Migration
`0.12.24/project-summary-action-model` then stores the canonical primary action
and focus result in the summary so compact surfaces do not independently
re-rank paged task slices.

## Installed Authority Proof - 2026-07-14

The fresh installed artifact was applied to the four calibration projects.
Each database is now schema 12 with `project_state_authority: database`;
`TASKS.json` and `project-summary.json` are absent from the promoted
project-state directories, while `queue-details.json.gz` remains readable.
The canonical action model is persisted in the database summary and is visible
in `/api/service` for all four projects.

The current shell measurements are 48.5 KB for Narrative Harness Overview,
32.5 KB for Looma + Knit Overview, 6.9 KB for Jess Overview, and 7.3 KB for
Fair Labor License Overview. Narrative Harness Work is 121.6 KB and Looma +
Knit Work is 114.0 KB. These are read-model results, not a claim that rich
task detail or history is bounded yet.

The remaining largest active files are explicit storage owners rather than
anonymous payload: NH has 865 KB of codebase-map history and a 778 KB DB;
Looma has a 2.1 MB task backup, 1.6 MB codebase-map history, and a 1.1 MB
evacuated progress snapshot; Jess has a 659 KB full codebase map; Fair Labor
has a 582 KB repo-local `state/TASKS.json`. The next reduction must establish
retention/ownership rules before removing any of them.

## Installed Data-Layer Recheck - 2026-07-15

The rebuilt installed artifact is now schema 12 with a populated
`task_evidence_current` projection in all four calibration projects. Current
row counts are Narrative Harness 7, Looma + Knit 43, Jess 1, and Fair Labor
License 1. The largest current payload is below the 64 KiB per-task bound;
raw JSONL history remains unchanged.

The hot-path measurements are now smaller than the earlier shell snapshot:

- fleet `/api/service`: 23.8 KB, 25 ms;
- Narrative Harness compact overview: 13.2 KB, 7 ms;
- Looma + Knit compact overview: 23.5 KB, 3 ms;
- Jess compact overview: 7.2 KB, 6 ms;
- Fair Labor License compact overview: 7.6 KB, 4 ms;
- saved release summaries: 0.6-0.9 KB, 1-3 ms.

The active local-history roots are still approximately 8.7 MB for Narrative
Harness, 16.3 MB for Looma + Knit, 2.3 MB for Jess, and 2.6 MB for Fair Labor
License. That is not a solved storage problem: most of the remaining bytes are
bounded databases, task evidence/history, code-map history, backups, and
evacuation artifacts. The 52,633 historical local-history directories remain
untouched until ownership and retention rules are proven; deleting them now
would hide the old directory-allocation bug rather than demonstrate that the
new write boundaries prevent recurrence.

## 2026-07-15 - Size attribution and mutation-token boundary

The current registered project caches are not primarily large because of the
active queue detail. Their current authoritative artifacts are small:

- Narrative Harness: 9.6 MB total; `project-state.db` 274 KB;
  `queue-details.json.gz` 15.9 KB.
- Looma + Knit: 17 MB total; `project-state.db` 508 KB;
  `queue-details.json.gz` 17.3 KB.
- Jess: 2.5 MB total; `project-state.db` 164 KB;
  `queue-details.json.gz` 494 bytes.
- Fair Labor License: 2.9 MB total; `project-state.db` 164 KB;
  `queue-details.json.gz` 505 bytes.

The largest remaining registered-project files are historical copies and
bounded evidence, not the hot-path task index: Narrative Harness has several
250-288 KB queue backups plus 262 KB of code-map history and 256 KB of recent
events; Looma + Knit has a 2.1 MB queue backup, a 1.3 MB migration backup, a
1.1 MB evacuated progress file, and a 778 KB evacuation backup. The next size
cut is therefore a retention/ownership migration for historical artifacts,
not another fleet-read optimization.

The mutation boundary now exposes `readProjectTaskQueueForMutationSync`, which
returns the full authoritative queue and its queue revision from one database
read. Task add/update, escalation, issue, gate-proof, and project-state
compaction writers pass that revision into the SQLite transaction. A stale
whole-queue replacement is rejected before current rows are deleted. Promoted
serve reads also fail closed when full detail is missing instead of returning
an empty or compactly reconstructed writable queue.

The remaining writer inventory is deliberately open: project serve mutation
routes, owner-input repair, re-intake/import, migration restore, and MCP
replacement paths still need explicit token migration or conversion to targeted
mutations. The CAS option is not yet mandatory for every database-authoritative
writer. No historical cache deletion is justified until that writer inventory
and an explicit retention/rollback policy are complete.

The cache census remains 3.6 GB with 1,418 `guildhall-memory.db-wal` files,
about 1.19 GiB of WAL sidecars. A fresh installed service and route reads did
not increase the count. Vitest now overrides a shell-level data directory that
points at the real user cache, preventing test processes from writing there;
old unknown directories remain untouched pending ownership proof.

## Current Data-Layer Recheck - 2026-07-15

The current architecture audit now measures project state at schema 16. The
SQLite database is the current authority for promoted projects, with compact
current rows, bounded task evidence history, and a revision-matched detail
artifact for full queue definitions. Effective-task reads use current rows by
default; history, evidence, and review routes opt into retained detail.

The installed fleet shell is 34,955 bytes for 7 projects, with 0 loading
projects and 7 current summaries. Warm `/api/service/projects` reads measured
0.00-0.02 seconds and `/api/fleet/attention` measured 0.01-0.06 seconds in
the latest five-probe run. The global cache remains about 3.6 GB with 1,418
memory WAL sidecars, but the count did not increase after a fresh installed
service and route reads. Existing bytes remain intentionally untouched.

The latest writer audit also routes task-state, task-question, and
task-hierarchy migrations through the queue authority boundary. Recovery and
evacuation writers remain separately classified work because restore behavior
must preserve its own rollback contract. This is progress toward one writer,
not permission to call the historical cache healthy yet.

## Current Verified Inventory - memory storage boundary - 2026-07-15

The cache size audit found a concrete recurrence source rather than merely a
large history directory. `/Users/matthew/.guildhall/data/projects` is still
about 3.6 GB, but approximately 1.25 GB of that is 1,418
`guildhall-memory.db-wal` files, almost all around 900 KiB. Those files are
LibSQL WAL sidecars, not project task definitions or durable project facts.

The packet builder was initializing a Mastra LibSQL store on a configured
Mastra read, then building its candidates from the deterministic source index
without using the Mastra store for retrieval. That made the memory technology
choice both expensive and semantically misleading. The packet boundary now
does not initialize Mastra storage at all: it reports that retrieval is not
wired and uses the deterministic source index. The explicit Mastra adapter
remains available for a future retrieval implementation and now has an
explicit close operation that checkpoints and releases LibSQL resources.

This stops new packet reads from creating the WAL recurrence. It does not
delete the existing 1.25 GB of WALs or any other cache entry. Existing cache
cleanup remains a separate manifest/ownership operation; deleting those files
without proving which process/project owns them would still be papering over
the lifecycle bug.

The current-state task read boundary also changed in the same verification
window. Database-authoritative `buildEffectiveTask` and `buildEffectiveTasks`
now use bounded SQLite current evidence by default. Full bounded history is
only requested explicitly by historical evidence/review/detail routes. The
focused regression proves that normal reads expose the current projection
while an explicit historical read retains the detail tail.

## Contract Touch Decision - `codex:memory-packet-retrieval-boundary-2026-07-15`

- **Work id:** `codex:memory-packet-retrieval-boundary-2026-07-15`.
- **Touched contracts:** memory packet adapter reporting, Mastra adapter
  lifecycle, current task evidence read default, and explicit historical-read
  semantics.
- **Considered but not touched:** task identity, release membership, project
  summary fields, memory event schema, and existing cache ownership records.
- **Required follow-up:** implement a real Mastra retrieval proof before
  making Mastra the packet adapter; inventory and manifest legacy WAL/cache
  artifacts before any cleanup; finish direct current-state writer audit.
- **Proof required:** normal packet reads do not create a memory database or
  WAL; explicit adapter callers can close storage; current task reads avoid
  history; explicit detail reads preserve retained history.
- **Proof provided:** memory-core suite, effective-task suite, project-state
  database suite, and the new no-Mastra-allocation/default-current regressions.
- **Apply/revert behavior:** reverting the packet boundary can reintroduce
  LibSQL allocation but does not delete current data. Reverting the task read
  default restores the old heavier read behavior but preserves the current
  projection and explicit history path.

## Schema Migration Decision - `codex:memory-packet-retrieval-boundary-2026-07-15`

- **Persisted schema touched:** none. The change removes an unused read-time
  database initialization and adds a runtime close method to an adapter.
- **Scope:** memory packet construction and database-authoritative task reads.
- **Change class:** read/lifecycle contract change; no persisted-shape
  migration.
- **Existing data impact:** none. Existing memory databases, WAL sidecars,
  JSONL, and task history are preserved.
- **Migration id:** none.
- **Compatibility reader:** deterministic memory events and the existing
  explicit Mastra adapter remain readable; packet output remains bounded.
- **Fixtures/tests:** memory-core lifecycle/no-allocation tests and effective
  task current-versus-history tests.
- **Owner-facing plan text:** project and task status reads use small current
  facts; memory history and explicit adapter diagnostics remain on demand.
- **Rollback/revert:** preserve existing files and revert only the read/lifecycle
  code. Do not remove WALs as part of rollback.

## 2026-07-15 - Writer audit and fail-closed correction

The writer audit found that the remaining risk is not only bytes. Several
maintenance paths still assumed that a compatibility `TASKS.json` was a safe
source after database promotion. The most dangerous case was a missing detail
store being represented as compact index rows or an empty queue and then
written back over authoritative state.

The current correction makes promoted detail reads fail closed. Canonical
queue reads throw when the revision-matched detail store is unavailable;
summary backfill returns an unavailable projection; release-envelope
preservation and state compaction refuse to continue. This protects data
integrity before any cleanup or migration can be trusted.

The audit leaves these writer classes explicitly open: replacement writes need
an expected-revision/full-detail precondition; owner-input request files need
an interruption-recovery proof; workspace import, re-intake, thin compaction,
and stale-blocker repair need database-detail reads after promotion; runtime
control JSON needs a crash-consistency decision. Evacuation manifests and
migration snapshots remain historical rollback artifacts, not current-state
sources.

## 2026-07-15 - Installed calibration dry runs after path correction

The fail-closed compaction guard initially exposed that compaction itself was
asking for the repository `.guildhall/TASKS.json` path while promoted projects
owned their queue in system-local storage. The path is now selected from the
same authority boundary as the database reader, and the installed dry runs
complete for all four calibration projects.

Read-only results:

- Narrative Harness: 49 essential-history files / 99,743 bytes; 16 session
  snapshots / 168,929 bytes; task evidence 1,879,575 -> 1,614,774 bytes if
  compacted; SQLite 274,432 bytes; recent events 1,000 records / 255,645
  bytes.
- Looma + Knit: 65 essential-history files / 222,864 bytes; 11 session
  snapshots / 146,053 bytes; task evidence 1,504,282 -> 1,498,763 bytes;
  SQLite 495,616 bytes; recent events 71 / 13,773 bytes.
- Jess: 2 essential-history files / 12,333 bytes; 5 session snapshots /
  57,358 bytes; task evidence 6,702 bytes; SQLite 163,840 bytes; recent
  events 798 / 146,798 bytes.
- Fair Labor License: 14 essential-history files / 31,798 bytes; 10 session
  snapshots / 127,431 bytes; task evidence 27,730 bytes; SQLite 163,840
  bytes; recent events 82 / 17,884 bytes.

All four runs were dry-run only. No legacy history, compatibility file, or
unknown cache directory was deleted.

## Installed Data-Layer Recheck - 2026-07-15

The rebuilt installed artifact is now schema 12 with a populated
`task_evidence_current` projection in all four calibration projects. Current
row counts are Narrative Harness 7, Looma + Knit 43, Jess 1, and Fair Labor
License 1. The largest current payload is below the 64 KiB per-task bound;
raw JSONL history remains unchanged.

The hot-path measurements are now smaller than the earlier shell snapshot:

- fleet `/api/service`: 23.8 KB, 25 ms;
- Narrative Harness compact overview: 13.2 KB, 7 ms;
- Looma + Knit compact overview: 23.5 KB, 3 ms;
- Jess compact overview: 7.2 KB, 6 ms;
- Fair Labor License compact overview: 7.6 KB, 4 ms;
- saved release summaries: 0.6-0.9 KB, 1-3 ms.

The active local-history roots are still approximately 8.7 MB for Narrative
Harness, 16.3 MB for Looma + Knit, 2.3 MB for Jess, and 2.6 MB for Fair Labor
License. That is not a solved storage problem: most of the remaining bytes are
bounded databases, task evidence/history, code-map history, backups, and
evacuation artifacts. The 52,633 historical local-history directories remain
untouched until ownership and retention rules are proven; deleting them now
would hide the old directory-allocation bug rather than demonstrate that the
new write boundaries prevent recurrence.
## 2026-07-15 - Queue detail moved into the SQLite authority

The revision-matched full queue detail is now stored in SQLite as a compressed
`queue_detail` BLOB (schema version 17). A queue replacement commits the compact
work rows, scope rows, queue envelope, summary watermark, and full detail in one
SQLite transaction. Promoted projects no longer maintain a second mutable
`queue-details.json.gz` authority; the sidecar remains readable only for legacy
projects and for migration input.

This is a model correction, not a cleanup trick. Before this change, a crash
could commit the compact database projection and fail before the filesystem
detail sidecar, leaving two revisions that could not be trusted. The new
representation has one current-state commit and makes the sidecar a
compatibility artifact instead of a peer database.

The migration id is
`0.12.38/project-state-queue-detail-database`. It is representation-only: it
preserves task definitions, releases, evidence history, and queue revision. It
backfills only when the current sidecar matches the database watermark. Reads
from the promoted authority fail closed if that BLOB is absent or mismatched;
they do not reconstruct a writable queue from compact rows.

The migration bootstrap also now checks for a real queue envelope and summary,
not only SQLite schema version. This prevents runtime overlay writes from
creating a schema-shaped database that makes the queue migration appear
complete before the queue itself exists.

Proof: the project-state database, migration, and summary suites pass 79/79;
the database suite includes removal of the sidecar before a promoted read and
verifies that a promoted write does not recreate it. The remaining data-layer
work is writer ownership and retention policy, not another parallel detail
format.

## Evidence cutover concurrency correction - 2026-07-15

The first compressed-ledger implementation exposed a cross-store race: a
writer could commit current proof between the SQLite migration snapshot and
the history-table delete, and concurrent gzip read-modify-write appends could
overwrite one another. That made the byte reduction insufficient evidence of
data safety.

The correction uses one project-scoped lock file for evidence appends and both
authority migrations. Compressed appends write the bounded detail event first,
then update the SQLite current-proof projection; event ids are idempotent. The
compression migration builds and verifies a temporary ledger, publishes it as
one directory replacement, then empties SQLite. It refuses to interpret a
missing SQLite history table as an empty ledger, rejects unexpected target
records, preserves `compressed` in metadata, and prevents the legacy migration
from regressing authority after a partial cutover.

- **Contract Touch Decision:** work `0.12.42/task-evidence-history-cutover`
  touches the task-evidence write/read and migration boundary. Event shape,
  current-proof shape, public history paging, and task/release contracts are
  unchanged. Proof is concurrent append coverage, missing-table fail-closed
  coverage, focused migration/task-store suites, and installed route proof.
- **Schema Migration Decision:** persisted schema touched: existing
  `project_meta.task_evidence_authority` and compressed local-history ledger;
  no new database schema. Change class: cross-store ownership and recovery
  semantics. Migration id: none beyond `0.12.42`; this is a correction to its
  writer boundary. Compatibility readers preserve legacy/database/compressed
  states. Rollback is marker-preserving: do not delete the compressed ledger;
  restore a prior authority only after its source is verified.
- **Proof:** 43 focused migration/task-store tests pass, including 24
  concurrent compressed appends and a missing-history-table failure. The
  installed service remains current with zero fleet loading/errors; rebuild and
  restart proof is still required after this source correction.

## 2026-07-15 - Activity polling now uses the summary shell

- **Finding:** Activity already had projected counts, release state, and
  in-flight work available, but still loaded the full orientation payload and
  scanned every task on every poll. The projection was advisory rather than
  authoritative for a frequently polled surface.
- **Change:** current Activity reads now use `readProjectSummaryShellProjection`
  and return `projection.counts` plus `projection.inFlight`, merging only
  bounded live supervisor-event labels. Queue/detail reads remain solely for
  stale, missing, or legacy projects.
- **Proof:** a current Activity read succeeds after `TASKS.json`,
  `queue_detail`, and `work_items` are unavailable. Focused Activity and read
  boundary tests pass.
- **Contract Touch Decision:** work `0.12.43/activity-summary-shell-reader`
  changes only the Activity read path. Its response shape, action model, and
  current-status semantics are unchanged. The full orientation tree remains
  available to explicit structure/map reads.
- **Schema Migration Decision:** no persisted schema changes. The reader now
  consumes existing `project_summary` fields and treats queue detail as a
  compatibility fallback only.
- **Status:** complete for Activity. Release readiness, Thread, Inbox, and Git
  Story still need the same reader-transfer treatment.

## 2026-07-15 - Temporary Mastra memory must not allocate durable databases

- **Finding:** the durable cache contains 52,633 historical project-shaped
  directories. The largest repeated payload is `memory/guildhall-memory.db`;
  across old ephemeral/test roots those files account for approximately 1.58
  GB. They are generally empty Mastra schemas with one or two empty Guildhall
  thread shells, not task text or useful project history.
- **Root cause:** the Mastra adapter allocated a disk-backed LibSQL schema for
  any project root that requested it, including temporary roots. The adapter is
  not the active memory-packet reader, so these writes provided no current
  product value.
- **Change:** `createMastraMemoryCoreAdapter` now selects `file::memory:` for
  temporary roots by default. Disk-backed storage remains available for real
  project roots and through an explicit `storage: 'persistent'` choice.
- **Proof:** memory-core and local-history suites pass 24/24, including an
  assertion that an automatic Mastra adapter on a temporary root leaves no
  database in the Guildhall data directory. This prevents recurrence; old
  unregistered cache directories have not been deleted in this step.
- **Contract Touch Decision:** work `0.12.44/ephemeral-mastra-storage`
  changes the adapter allocation policy and health feature reporting. Memory
  event shape, deterministic packet behavior, and explicit persistent adapter
  behavior are unchanged.
- **Schema Migration Decision:** no project schema migration. The change only
  affects whether a temporary adapter opens a persistent LibSQL file; existing
  persistent databases remain readable.
- **Status:** complete for the allocation boundary. A separately authorized,
  ownership-aware cache reclamation pass remains necessary to reduce the
  already accumulated 3.6 GB on disk.

## 2026-07-15 - Installed proof refresh for the current data-layer slice

The rebuilt artifact was installed and the background service was restarted.
`/api/stale-server` reports `stale:false`. The fleet route returns seven
registered projects with zero loading/error entries.

Current measured route payloads for Narrative Harness:

- `/api/service/projects`: 34,955 bytes in about 8 ms
- `/api/service`: 7,201 bytes in about 2 ms
- overview: 22,974 bytes in about 7 ms
- current Activity: 2,829 bytes in about 10 ms
- Activity history: 25,903 bytes in about 2 ms
- compact spine: 16,169 bytes in about 6 ms
- full spine: 376,745 bytes in about 192 ms; this remains an explicit rich
  structure read, not a fleet or ordinary overview payload

The four calibration projects' registered durable cache entries total about
29.73 MiB: Narrative Harness 8.5 MiB, Looma + Knit 16 MiB, Jess 2.4 MiB,
and Fair Labor License 2.5 MiB. Their current-state SQLite databases total
about 1.64 MiB; the remaining bytes are bounded compressed detail/evidence
and session/history material.

The machine-wide project cache is still 3,796,600 KiB across 52,633
directories, including 1,619,046,400 bytes across 5,229 Mastra database
files. No old cache data was deleted: this measurement confirms the
ownership/reclamation problem remains open rather than hiding it behind a
cleanup command.

The Activity reader and temporary-Mastra allocation fixes are now installed,
and focused regressions pass. Repository-wide typecheck remains red from
pre-existing task/release/import contract drift; the new database and memory
files introduce no remaining filtered type errors.

- **Status:** Activity read transfer and temporary allocation boundary complete;
  rich-reader transfer, cache ownership/reclamation, and repository-wide type
  cleanup remain open.

## 2026-07-15 - Attention projection freshness is now explicit

- **Finding:** `attention_records` was durable, but the Inbox route could not
  tell whether those rows described the latest project revision. It therefore
  rediscovered task state even when a current attention projection already
  existed.
- **Model change:** schema version 19 adds one reusable
  `projection_watermarks` table. A projection records the authoritative
  project revision it was built from; a reader treats a missing or mismatched
  watermark as a cache miss rather than presenting stale rows as current.
- **Reader change:** `/api/project/inbox` reads the current attention
  projection directly. Only stale, missing, legacy, or unwatermarked projects
  use the compatibility discovery path. The projection refresh writer marks
  the attention domain current after materializing it.
- **Proof:** the database test verifies idempotent attention writes publish a
  matching watermark, and the read-boundary test serves Inbox after
  `TASKS.json`, `queue_detail`, and `work_items` are unavailable.
- **Contract Touch Decision:** work `0.12.45/attention-projection-watermark`
  changes only the internal projection freshness contract and Inbox read
  boundary. Inbox item shapes and dismissal behavior are unchanged.
- **Schema Migration Decision:** persisted schema touched: SQLite
  `projection_watermarks`, additive schema version 19. Existing databases
  create the table on the next writable open; missing rows remain a safe
  compatibility miss. No task or attention history is rewritten. Rollback is
  the compatibility discovery path.
- **Status:** complete for Inbox current-state reads. Release detail, Thread,
  Git Story, and old-cache ownership still require follow-up.

## 2026-07-15 - Inbox history is on demand, not part of the project shell

- **Finding:** even after Inbox moved to a current projection, the compatible
  response still returned 65 historical attention records by default. The
  Narrative Harness response was about 45 KiB, which was too much for a shell
  alert check.
- **Change:** `/api/project/inbox` now returns current items and blockers by
  default. `includeHistory=true` is the explicit history read. Overview and
  Do This Next request `includeHistory=false`; the Inbox view requests history
  when it is actually opened.
- **Proof:** current Inbox and Do This Next UI tests pass, and the server
  boundary still preserves the history response for explicit callers. This
  keeps the existing history UI while removing its payload from ordinary
  project navigation.
- **Installed measurement:** after rebuild/restart, current Inbox is 2,897
  bytes in about 2 ms; explicit history remains 45,215 bytes in about 2 ms.
- **Status:** complete for the Inbox shell payload. History remains bounded
  but is still intentionally retained for the explicit Inbox view.

## 2026-07-15 - Live current state is small; migration archives are the next storage boundary

- **Finding:** the four registered project caches total about 29.7 MiB, but
  their authoritative `project-state.db` files total only about 1.64 MiB.
  Narrative Harness is about 8.6 MiB overall with a 578 KiB database;
  Looma + Knit is about 16 MiB overall with a 770 KiB database; Jess is about
  2.5 MiB with a 176 KiB database; Fair Labor License is about 2.6 MiB with
  a 193 KiB database. The live current-state tables are small and bounded.
- **Finding:** the remaining registered-project bytes are mostly migration
  rollback material, evacuated project-state copies, bounded evidence, and
  codebase/history artifacts. Looma + Knit still has multi-megabyte
  `TASKS.before-*` snapshots in `project-state`; Narrative Harness has several
  250-287 KiB rollback snapshots. These files are not loaded by compact fleet,
  Overview, Activity, or Inbox reads, but they are still part of the durable
  cache and are not an acceptable long-term data model.
- **Finding:** the machine-wide cache remains approximately 3.6 GiB across
  52,633 project-shaped directories. About 1.62 GiB is in 5,229 historical
  `guildhall-memory.db` files, mostly empty Mastra schemas left by the old
  adapter/read path. The cache census correctly reports these as
  `unregistered-unknown`; it does not authorize deletion.
- **Root cause boundary:** old migration writers and the old Mastra adapter
  treated rollback/debug material as ordinary durable project history. The
  current Mastra allocation fix prevents new temporary roots from creating
  durable databases, and read-only memory paths no longer create Mastra
  threads. That is recurrence prevention, not reclamation of the old bytes.
- **Required model change:** migration rollback snapshots need an explicit,
  reviewable retention owner separate from current project state; temporary
  runs need an explicit ephemeral allocation boundary; and every cache entry
  needs provenance before any old data can be considered reclaimable. An
  unregistered cache directory remains unknown, never implicitly “orphaned.”
- **Status:** current-state data layer and ordinary read paths are materially
  smaller and faster. Historical cache ownership/reclamation and migration
  archive retention remain open. No old cache data was deleted in this audit.

## 2026-07-15 - Imported planning is no longer compact current state

- **Finding:** `approvedPlan` was still embedded in `project_summary`, even
  though it is a snapshot of accepted intake and current release/task
  membership is already represented by `scopes` and `work_scope`.
- **Model change:** schema version 20 adds `project_plan` as the source/intake
  snapshot store. Summary writes move the accepted plan there; the compact
  summary payload no longer carries its task-id arrays. Full summary reads
  hydrate the plan for compatibility, while fleet/project shells explicitly
  omit it.
- **Authority rule:** `project_plan` explains what was accepted at intake; it
  does not select executable work. Live `scopes`, `work_items`, and
  `work_scope` own current release membership and eligibility.
- **Migration:** `0.12.39/project-plan-source-store` reuses the existing
  summary writer to move old embedded plans without rewriting task or history
  records. The compatibility reader still understands old databases.
- **Proof:** the database test verifies that the compact summary row omits
  `approvedPlan`, the dedicated plan row is present, full reads preserve the
  field, and shell reads omit it. Focused database, migration, and summary
  projection tests pass.
- **Status:** implementation and focused proof complete; installed four-project
  migration and cross-surface verification remain next.

## 2026-07-15 - Rich task reads no longer duplicate the whole queue

- **Finding:** the per-task detail index removed the drawer's need to
  decompress the aggregate queue, but the aggregate `queue_detail` BLOB still
  duplicated every task definition for promoted projects.
- **Model change:** schema version 22 keeps one revision-matched compressed
  payload per current work item in `work_item_detail`. Explicit rich queue
  reads reconstruct from those rows plus normalized scope definitions; compact
  reads continue to use typed `work_items` and indexed inventory rows.
- **Compatibility:** `queue_detail` and `queue-details.json` remain readable
  only as migration compatibility stores. Current queue writes clear the old
  aggregate row and do not create a new one. The filesystem sidecar remains
  forbidden after database promotion.
- **Migration:** `0.12.44/project-state-remove-aggregate-detail` clears the
  duplicate SQLite aggregate only after a revision-matched per-task index is
  complete, then vacuums the database. If the index is incomplete, migration
  fails closed rather than deleting the only rich copy.
- **Proof:** focused database and migration suites pass 68/68, including
  point reads after the aggregate row and compatibility sidecar are absent.
- **Status:** source implementation and focused proof complete; installed
  migration and live rich-route byte measurements remain next.

## 2026-07-15 - Promoted queue reads fail closed instead of reviving sidecars

- **Finding:** the queue-detail reader still had a compatibility escape hatch
  after a project had been promoted to SQLite authority. If its SQLite
  `queue_detail` row was missing, it could read an old compressed
  `queue-details.json.gz` sidecar with the same revision. That created two
  mutable current-state truths and could make a partial database write look
  successful.
- **Authority rule:** once `project_meta.project_state_authority` is
  `database`, the filesystem queue-detail sidecar is not a fallback. A missing
  or unreadable SQLite detail row produces unavailable state and lets the
  caller surface the repair boundary. Only legacy projects without database
  authority may use the sidecar compatibility path.
- **Proof:** the focused database suite deletes the authoritative SQLite
  detail row, leaves a stale compressed sidecar in place, and verifies that a
  promoted read returns no queue definition. The database and summary suites
  pass 51/51; data-layer, contract, and diff checks pass.
- **Why this matters:** this is a data-model correction, not cleanup. The
  reader now respects one current-state owner instead of trying to make two
  stores appear synchronized by accident.
- **Status:** code and focused proof complete; installed artifact proof is
  complete. After `pnpm build`, `pnpm dev:install`, and a service restart,
  `/api/stale-server` reports `stale:false`; the fleet shell returns all seven
  projects with zero loading/errors, Narrative Harness compact project state is
  20,417 bytes, current Inbox is 2,193 bytes, and Activity is 2,829 bytes.
  Migration `0.12.39/project-plan-source-store` is applied to Narrative
  Harness and the other registered projects. The separate rollback/evacuation
  ownership lane remains open.

## 2026-07-15 - Project-state performance budgets are executable

- **Change:** `scripts/project-state-performance-audit.mjs` measures the
  fleet shell and all registered project shells in parallel for cold and warm
  passes. It fails on loading/error states, oversized responses, or latency
  above the documented budgets. The command is
  `pnpm audit:project-state-performance`.
- **Budgets:** fleet shell <= 250 ms and 128 KiB; each project shell <= 500 ms
  and 256 KiB. These are shell budgets, not permission to truncate explicit
  rich detail.
- **Installed proof:** the fleet shell was 27.51 ms and 25,402 bytes for
  seven projects. Cold parallel project reads ranged from 8.83 to 32.77 ms;
  warm reads ranged from 4.78 to 23.56 ms. Every project was current with
  zero loading/errors, and both passes succeeded.
- **Status:** complete as a regression gate. Rich task, Thread, Release,
  Git Story, and historical-storage lanes remain open.

## 2026-07-15 - Schema 22 installed proof

The installed artifact now passes the richer performance gate, not only the
fleet shell gate. After rebuilding and restarting the service, the fleet
response was 25,402 bytes in 23 ms for seven projects. Cold project shells
ranged from 7,583 to 47,897 bytes and 7.8 to 26.9 ms; all seven were current
with no loading or error state. Explicit rich task reads ranged from 4,438 to
33,634 bytes and 37.8 to 318.4 ms. Thread reads ranged from 8,825 to 119,587
bytes and 23.7 to 59.1 ms. The gate is `pnpm audit:project-state-performance`.

Migrations `0.12.43/project-state-per-task-detail-index` and
`0.12.44/project-state-remove-aggregate-detail` applied successfully to every
registered project. The current database census is:

| Project | DB bytes | Work items | Rich detail bytes | Aggregate rows |
| --- | ---: | ---: | ---: | ---: |
| Looma + Knit | 860,160 | 43 | 72,515 | 0 |
| Narrative Harness | 598,016 | 7 | 19,022 | 0 |
| Font something | 225,280 | 6 | 5,504 | 0 |
| Fair Labor License | 212,992 | 1 | 423 | 0 |
| T-minus-t | 204,800 | 2 | 2,160 | 0 |
| Commerce project | 196,608 | 0 | 0 | 0 |
| Jess | 196,608 | 1 | 413 | 0 |

The database total is about 2.38 MiB across seven projects. The current rich
task representation is now one revisioned compressed row per task plus
normalized scope rows; `queue_detail` is empty. The larger per-project cache
totals are not current task state: they include old `TASKS.before-*` backups,
evacuation snapshots, recent event ledgers, codebase-map history, and some
context-debug/transcript material. That residue is measured, not deleted.
The next data-layer step is a provenance-backed retention owner for each
class, not a generic orphan-pruning command.

## 2026-07-15 - Bounded current Thread proof and residue split

The first current Thread projection was still too permissive: it retained all
pending turns, which made Looma + Knit serialize 78 pending turns into an
82,127-byte current row. The projection now keeps the active turn, the first
12 pending turns, and the latest eight completed turns. Older completed turns
remain behind `/api/project/thread/history`; later pending work remains in the
work inventory. This is a current-read model, not a second task queue.

After refreshing the seven registered projects through the shared projection
writer, current Thread rows are:

| Project | Turns | Current row bytes |
| --- | ---: | ---: |
| Looma + Knit | 21 | 17,677 |
| T-minus-t | 11 | 7,992 |
| Fair Labor License | 9 | 6,292 |
| Font something | 13 | 11,767 |
| Narrative Harness | 17 | 12,945 |
| Commerce project | 8 | 4,628 |
| Jess | 9 | 6,425 |

The installed performance gate now passes for all seven projects: fleet
25,411 bytes / 39 ms, project shells 5-47 ms, rich task reads 31-238 ms on
the rerun, and Thread responses 8,393-53,426 bytes. No project reported
loading or error state. This is materially smaller than the prior Looma
Thread response of 117,896 bytes, but the route still includes orientation and
readiness context; that context is the next candidate for a further split if
the UI does not require it on initial Thread load.

The machine cache remains 3.6 GB. The registered seven-workspace set is about
46.9 MB; the current SQLite files total about 2.57 MiB, and the current Thread
rows total 67,726 bytes. The remaining approximately 3.44 GB belongs to
52,626 unregistered project-shaped directories, dominated by about 2.94 GB of
old `memory` directories and about 436 MB of old `project-state` directories.
These are not safe to delete by name alone: they lack a complete ownership
record and may include historical fixtures or recoverable evidence. The
correct next step is to make every persisted directory carry provenance,
retention class, and owner at allocation time; only then can an allowlisted
retention job remove data with a proof trail. Until that exists, no generic
prune is considered a data-model fix.

The writer audit remains open: 47 production callers still use a full queue
replacement transaction, even though the current rows are normalized. The
next architectural change is revision-guarded targeted mutations for work-item
definitions, relationships, scope rows, and current summary, followed by
explicit ownership for rollback, evacuation, debug, and temporary-run data.

## 2026-07-15 - First-write provenance guard

The allocation boundary now records durable cache provenance before a new
project history root is created. `ensureProjectLocalHistoryDir` registers the
workspace only when the project is durable or has an explicitly configured
data directory; unconfigured temporary projects continue to use the temporary
history root without entering the durable registry. Memory-store
initialization and first SQLite current-state writes use the same boundary.

This is deliberately a prevention guard, not a cleanup operation. It does not
classify or delete the approximately 3.44 GB of old unregistered directories.
Existing registered manifests are not rewritten on every write, and low-level
migration callers that do not know the workspace root remain explicit
compatibility paths. The remaining retention work is to give each durable
subdirectory class its own owner and bounded policy before any deletion is
authorized.

Focused proof: local-history, memory-core, cache-registry, and project-state
database suites pass (71 tests). The database test also verifies that a
first current-state write records the workspace manifest.

## 2026-07-15 - First production-path targeted mutation

The shared `writeProjectTaskQueueWithSummary` boundary now selects the
targeted SQLite transaction when it can prove all of the following: promoted
database authority, a revision token, exactly one changed task, unchanged
release definitions/selection, and no scope-row changes outside that task.
It prepares the same summary and scope projection before committing, so the
task detail, indexed task row, affected scope row, queue watermark, and shared
summary advance together.

Structural edits, task additions/removals, release changes, and mutations that
change multiple scope rows still use the full snapshot writer. That is
intentional: a fast path that silently leaves neighboring scope rows stale
would recreate the data-model problem in a smaller transaction.

Focused cross-layer proof passes (100 tests). The remaining migration is to
move multi-row structural changes to an explicit batch mutation API and make
the full snapshot writer import/migration/recovery-only.

## 2026-07-15 - Project-wide memory event ownership

The registered Narrative Harness cache currently contains about 1.2 MB under
`memory/events`, despite each individual scope stream having a 256 KiB cap.
That is a data-shape failure: per-scope bounds multiplied with the number of
task/thread/agent scopes and made the project-wide memory index grow without a
project budget.

New writes now use one system-local `memory/events.jsonl` stream with the
scope retained in each schema-v2 event. The writer enforces one 256 KiB
project-wide bound; reads filter the stream by scope. Existing per-scope
streams remain a compatibility read source but are write-dead. The explicit
consolidation path deduplicates IDs, writes the bounded stream first, and only
then removes old per-scope files when applied.

Proof: cross-scope writes, legacy reads, dry-run preservation, and applied
consolidation are covered by the memory-core suite; 20 memory-core tests and
12 project-state compaction tests pass. This reduces future growth at the
writer/model boundary. Existing cache residue is not deleted by this change.

## 2026-07-15 - Gate proof no longer duplicates promoted task state

`run-gates` was a concrete data-layer bypass: one execution wrote raw
`gateResults` into task definitions, updated proof paths, then appended task
evidence in a separate operation. The promoted path now sends proof events
through the existing targeted SQLite task mutation, where task detail, current
proof, bounded history, scope, summary, and queue revision commit together.
The legacy project path keeps its compatibility export until promotion.

The promoted regression proves that task detail has no `gateResults`, current
evidence and detail history each contain the gate result, and the revision
advances. This is a model fix rather than a retention pass: one proof authority
owns the current fact, with bounded history as the optional detail layer.

The ordinary MCP project resource also stopped reading the latest context-debug
record. Context-debug remains behind the explicit context resource, preventing
diagnostic data from crossing the default project-read boundary.

## 2026-07-15 - Migration snapshot storage boundary

The migration census confirmed that full `TASKS.before-*` and `TASKS.backup-*`
files are historical rollback material, not current project state. New
migration writers now place them under the shared system-local
`migration-snapshots/` boundary and retain one content-addressed rollback
object plus a manifest. New writes do not create a second raw snapshot file;
the manifest records whether a legacy snapshot is still materialized.

This does not classify existing unmanifested files as safe. The registered
cache still contains old snapshots in `project-state`, especially Looma + Knit
and Narrative Harness. They remain untouched until a manifest-backed digest
and restore verification can prove that removing the raw copy preserves the
rollback object. Current-state SQLite remains the only authority for live task
and summary reads.

The explicit cleanup was then applied to Narrative Harness, Looma + Knit, Jess,
and Fair Labor License. It reduced the two non-empty project memory streams by
about 875 KB in total and vacuumed Looma's database from 966,656 to 884,736
bytes. The registered cache fell from about 46.9 MB to about 45.9 MB. Five
Narrative Harness snapshot files (964,960 bytes) and four Looma snapshot files
(4,048,813 bytes) remain unverified and were not removed. The cleanup is
therefore evidence of bounded retention working, not a generic prune policy.
