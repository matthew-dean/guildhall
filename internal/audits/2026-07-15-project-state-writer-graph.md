# Project-State Writer Graph Audit

**Date:** 2026-07-15
**Scope:** `writeProjectTaskQueueWithSummary` and every production caller
**Question:** Which writes refresh the shared current-state projections, which
still replace the whole current queue, and which still repair state as part of
a request?

## Verdict

The current boundary is synchronized in one important sense: every call to
`writeProjectTaskQueueWithSummary` goes through the same summary projection
builder. That builder recalculates task counts, current scope, next action,
release readiness, blockers, recent work, in-flight work, and the compact
orientation spine.

It is not yet a fully mutation-oriented data layer. There are 47 production
queue call sites, and callers generally still construct a complete queue before
calling it; the matrix also records the improvement-review evidence writer as
an explicit non-queue path. The boundary now routes
safe promoted-project mutations through targeted transactions for one changed
task and release-envelope-only changes. Unsafe structural, legacy, import, and
repair cases still use the aggregate replacement, which deletes and reinserts
`work_items`, `scopes`, and `work_scope`, and rewrites every
`work_item_detail` row. The retired `queue_detail` blob is no longer written.

The boundary also does not refresh Inbox/attention. Owner-input mutations have
their own projection writer, while evidence, runtime, and workspace changes
usually only mark the summary stale. That is honest but does not yet satisfy
the target architecture's requirement that all current read models be
updated at their owning write boundary.

## Authoritative Evidence

| Finding | Evidence |
| --- | --- |
| Every queue writer refreshes one shared projection | [`project-state-boundary.ts:220`](/Users/matthew/git/oss/guildhall/src/runtime/project-state-boundary.ts:220) calls [`writeProjectSummaryProjectionFromUnknownQueue:539`](/Users/matthew/git/oss/guildhall/src/runtime/project-summary-projection.ts:539). |
| The shared projection calculates action, release readiness, blockers, and spine | [`project-summary-projection.ts:317`](/Users/matthew/git/oss/guildhall/src/runtime/project-summary-projection.ts:317), especially lines 328-394 and 433-436. |
| The compatibility write is a whole aggregate replacement | [`project-state-database.ts:1289`](/Users/matthew/git/oss/guildhall/src/sessions/project-state-database.ts:1289) deletes and reinserts current task/scope rows, then rewrites all point-detail rows at lines 1316-1422; eligible promoted single-task and release-selection changes now bypass it. |
| The aggregate queue blob itself is retired | [`project-state-database.ts:1438`](/Users/matthew/git/oss/guildhall/src/sessions/project-state-database.ts:1438) deletes `queue_detail` after each snapshot; the per-task rows are now the current rich-detail representation. |
| Summary-only updates do not rebuild task facts | [`project-summary-projection.ts:615`](/Users/matthew/git/oss/guildhall/src/runtime/project-summary-projection.ts:615) patches only execution, runtime, owner input, orientation, or freshness. |
| Evidence/runtime/workspace writers generally invalidate instead of refresh | [`project-summary-staleness.ts:16`](/Users/matthew/git/oss/guildhall/src/sessions/project-summary-staleness.ts:16) marks the summary stale and emits invalidation; it does not compute a new action/readiness projection. |
| Inbox/attention is a separate explicit projection | [`attention.ts:209`](/Users/matthew/git/oss/guildhall/src/runtime/attention.ts:209) reconciles attention records only when a caller supplies already-computed Inbox items. [`owner-input-store.ts:214`](/Users/matthew/git/oss/guildhall/src/runtime/owner-input-store.ts:214) refreshes the owner-input slice separately. |
| One explicit request path still repairs before writing | [`serve.ts:977`](/Users/matthew/git/oss/guildhall/src/runtime/serve.ts:977) mutates normalized tasks when `repair: true`; the path is used by [`serve.ts:1812`](/Users/matthew/git/oss/guildhall/src/runtime/serve.ts:1812) during the focused start recovery flow. |

## Projection Legend

`S/A/O/R` means the shared queue projection refreshes Summary, Action,
Orientation spine, and Release readiness/counts respectively. `O*` means the
spine is rebuilt, but the richer charter/orientation snapshot is only
re-inferred when the caller passes `projectRoot`; otherwise the prior snapshot
is carried forward. `I-` means no Inbox/attention refresh occurs in the writer
itself. `I+` means the caller has a separate owner-input/attention write after
or around the queue write. `X` means execution/runtime state is handled by a
separate overlay writer. `E` means evidence is handled by a separate evidence
writer.

Every row below names the caller-level mutation shape. A row that invokes the
shared writer may still take a targeted path when its promoted-project input
meets the boundary's CAS and changed-record invariants; otherwise it takes the
aggregate compatibility path. This distinction matters: changing the
boundary removed replacement cost for safe single-task and release-selection
changes, but callers still need direct mutation APIs to stop reconstructing
complete queues before they call the boundary.

## Mutation-shape classification

| Class | Count | Meaning |
| --- | ---: | --- |
| Single task/detail | 20 | One existing task card/detail changes; eligible for the targeted task transaction once companion evidence/attention writes are coordinated. |
| Structural batch | 3 | Task creation, split children, or meta-intake changes multiple identities/relationships; needs a delta transaction. |
| Release/scope | 3 | Release membership, selection, or scope repair; selection is targeted for promoted projects, structural membership remains aggregate. |
| Import/migration/recovery | 20 | Explicit full-state reconstruction with migration/revision/manifest guards; not normal task-transition traffic. |

## Complete Production Call-Site Matrix

| # | Call site | Mutation represented | Aggregate replacement | Projection result | Remaining issue |
| ---: | --- | --- | :---: | --- | --- |
| 1 | [`mcp-server/server.ts:757`](/Users/matthew/git/oss/guildhall/src/mcp-server/server.ts:757) `writeTasks` | MCP task-queue replacement | Yes | `S/A/O/R`, `I-` | Revision is passed when available; no attention refresh. |
| 2 | [`evacuated-task-state-restore.ts:446`](/Users/matthew/git/oss/guildhall/src/runtime/evacuated-task-state-restore.ts:446) | Restore an evacuated queue | Yes | `S/A/O*/R`, `I-` | Restore has a separate evacuation manifest, but still rewrites the whole current queue. |
| 3 | [`improvement-review.ts:179`](/Users/matthew/git/oss/guildhall/src/runtime/improvement-review.ts:179) `appendTaskEvidence` | Persist bounded improvement-review note evidence | No | `E` | Does not rewrite the task definition or current task-detail row; legacy task notes remain readable for duplicate detection. |
| 4 | [`intake.ts:98`](/Users/matthew/git/oss/guildhall/src/runtime/intake.ts:98) `writeQueue` | Exploratory intake/task status and notes | Yes | `S/A/O*/R`, `I-` | No revision token; owner-input transitions are owned elsewhere. |
| 5 | [`meta-intake.ts:85`](/Users/matthew/git/oss/guildhall/src/runtime/meta-intake.ts:85) `writeQueue` | Bootstrap/meta-intake task creation and synthesis | Yes | `S/A/O*/R`, `I-` | No revision token; structural-map and owner-input writes happen in separate paths. |
| 6 | [`migrations.ts:235`](/Users/matthew/git/oss/guildhall/src/runtime/migrations.ts:235) `repairClippedTaskTitles` | Explicit title repair migration | Yes | `S/A/O*/R`, `I-` | Migration is an intentional repair, but it has no expected revision guard. |
| 7 | [`migrations.ts:305`](/Users/matthew/git/oss/guildhall/src/runtime/migrations.ts:305) `attachRecoveredCurrentScopeTasksToSelectedRelease` | Explicit release-membership repair migration | Yes | `S/A/O*/R`, `I-` | Same aggregate rewrite and no revision token. |
| 8 | [`migrations.ts:1653`](/Users/matthew/git/oss/guildhall/src/runtime/migrations.ts:1653) schema 0.12.17 | Queue-revision/detail-store migration | Yes | `S/A/O/R`, `I-` | Representation migration intentionally snapshots all tasks; this is safe only as a migration, not as a normal mutation pattern. |
| 9 | [`migrations.ts:1697`](/Users/matthew/git/oss/guildhall/src/runtime/migrations.ts:1697) schema 0.12.18 | Compact compatibility export migration | Yes | `S/A/O/R`, `I-` | Re-reads the complete rich queue to publish compatibility state. |
| 10 | [`owner-input-state-repair.ts:82`](/Users/matthew/git/oss/guildhall/src/runtime/owner-input-state-repair.ts:82) | Repair invalid/duplicate owner-input-linked task state | Yes | `S/A/O/R`, then `I+` at line 87 | Queue write and owner-input projection are two commits, so a crash can leave them temporarily out of sync. |
| 11 | [`project-reintake.ts:430`](/Users/matthew/git/oss/guildhall/src/runtime/project-reintake.ts:430) | Apply a selected re-intake change set and releases | Yes | `S/A/O*/R`, `I-` | Revision guarded, but it still replaces every task for a change set that may touch only a few. |
| 12 | [`project-state-boundary.ts:211`](/Users/matthew/git/oss/guildhall/src/runtime/project-state-boundary.ts:211) `writeProjectTaskQueue` | Sanitized compatibility wrapper | Yes | Delegates to shared `S/A/O/R`, `I-` | This wrapper sanitizes forbidden runtime/evidence fields, but direct callers of the `WithSummary` function bypass that sanitization. |
| 13 | [`project-state-compaction.ts:556`](/Users/matthew/git/oss/guildhall/src/runtime/project-state-compaction.ts:556) | Compact/archive task definitions | Yes | `S/A/O*/R`, `I-` | Compaction is maintenance, but current-state publishing still pays full replacement cost. |
| 14 | [`run-automation.ts:343`](/Users/matthew/git/oss/guildhall/src/runtime/run-automation.ts:343) `writeQueue` | Agent automation task transition/answer | Yes | `S/A/O*/R`, `I-` | Revision guarded; owner-input updates and essential history are separate writes. |
| 15 | [`run-once.ts:190`](/Users/matthew/git/oss/guildhall/src/runtime/run-once.ts:190) | Record a run-once note/status update | Yes | `S/A/O*/R`, `I-`, `E` before the write | Evidence is written separately, and its staleness invalidation can race with the queue snapshot. |
| 16 | [`serve.ts:1073`](/Users/matthew/git/oss/guildhall/src/runtime/serve.ts:1073) `readTasksFileNormalized` | Explicit normalization/repair of legacy task records | Yes | `S/A/O*/R`, `I-` | Request-time repair path; ordinary reads avoid it, but the helper can still perform a full rewrite. |
| 17 | [`serve.ts:1159`](/Users/matthew/git/oss/guildhall/src/runtime/serve.ts:1159) `writeTasksFilePreservingQueue` | Persist task-array-only mutation | Yes | `S/A/O*/R`, `I-` | Full queue is reconstructed merely to update task cards. |
| 18 | [`serve.ts:1198`](/Users/matthew/git/oss/guildhall/src/runtime/serve.ts:1198) `writeTaskQueueFilePreservingQueue` | Persist task + release envelope mutation | Yes | `S/A/O*/R`, `I-` | Same replacement path for release selection/reconciliation. |
| 19 | [`serve.ts:1225`](/Users/matthew/git/oss/guildhall/src/runtime/serve.ts:1225) `writeSelectedReleaseId` | Change selected release | **Targeted for promoted projects** | `S/A/O*/R`, `I-` | Legacy projects retain aggregate compatibility; promoted projects update the release envelope, affected scope rows, and revision watermark without rewriting task payloads. |
| 20 | [`serve.ts:1519`](/Users/matthew/git/oss/guildhall/src/runtime/serve.ts:1519) `repairStoppedRunPhantomActiveTasks` | Clear phantom worker claims after a stopped run | Yes | `S/A/O*/R`, `I-`, `X` around lines 1510-1514 | Repair expands effective tasks and then snapshots the entire queue. |
| 21 | [`serve.ts:1667`](/Users/matthew/git/oss/guildhall/src/runtime/serve.ts:1667) `repairLegacyNoCheckpointProviderRecoveryPlans` | Repair stale provider-recovery state | Yes | `S/A/O*/R`, `I-`, `X` | Explicit repair, but still whole-queue and not attention-aware. |
| 22 | [`serve.ts:1752`](/Users/matthew/git/oss/guildhall/src/runtime/serve.ts:1752) `repairImportedShapingExecutionState` | Clear execution overlays from imported shaping tasks | Yes | `S/A/O*/R`, `I-`, `X` | Effective-task expansion precedes the write; current execution is also written separately. |
| 23 | [`serve.ts:1802`](/Users/matthew/git/oss/guildhall/src/runtime/serve.ts:1802) `repairSpecTimeoutBlockedTask` | Reopen an owned spec-timeout blocker | Yes | `S/A/O*/R`, `I-`, `X` after line 1804 | Runtime cleanup after the summary write can mark the newly refreshed summary stale. |
| 24 | [`serve.ts:1830`](/Users/matthew/git/oss/guildhall/src/runtime/serve.ts:1830) `repairWeakRecoverySpecReviewTask` | Repair weak recovery/spec-review seed | Yes | `S/A/O*/R`, `I-` | It can call `readTaskQueueFileNormalized({repair:true})` first at line 1816, causing two aggregate replacements in one request. |
| 25 | [`serve.ts:12788`](/Users/matthew/git/oss/guildhall/src/runtime/serve.ts:12788) Git-story `commit` | Add a commit note to a task | Yes | `S/A/O*/R`, `I-` | Repository mutation itself has no repository projection refresh; only the task note is projected. |
| 26 | [`serve.ts:12838`](/Users/matthew/git/oss/guildhall/src/runtime/serve.ts:12838) Git-story `local-only`/`defer` | Record a Git-story override | Yes | `S/A/O*/R`, `I-` | A Git fact is stored inside a queue snapshot rather than a repository/run observation boundary. |
| 27 | [`serve.ts:13289`](/Users/matthew/git/oss/guildhall/src/runtime/serve.ts:13289) task action `update-dependencies` | Change task dependency edges | **Targeted structural delta for promoted projects** | `S/A/O*/R`, `I-` | The structural transaction updates the changed relationship and any affected derived scope rows; legacy projects retain the explicit import path. |
| 28 | [`serve.ts:13393`](/Users/matthew/git/oss/guildhall/src/runtime/serve.ts:13393) task action `retry-work` | Requeue/retry a task | Yes | `S/A/O*/R`, `I-` | May resume exploration afterward; queue and thread/owner-input state are separate commits. |
| 29 | [`serve.ts:13482`](/Users/matthew/git/oss/guildhall/src/runtime/serve.ts:13482) task action `create-split-children` | Materialize split children and update parent | **Targeted structural delta for safe promoted projects** | `S/A/O*/R`, `I-` | The shared transaction upserts changed/new task rows, relationship membership, queue envelope, and affected scope rows without touching unrelated detail. |
| 30 | [`serve.ts:13588`](/Users/matthew/git/oss/guildhall/src/runtime/serve.ts:13588) task action `approve-brief` | Approve a task brief and settle escalations | Yes | `S/A/O*/R`, `I-`, `X` after line 13590 | Runtime escalation cleanup after the queue commit can invalidate the refreshed summary. |
| 31 | [`serve.ts:13667`](/Users/matthew/git/oss/guildhall/src/runtime/serve.ts:13667) task action `mark-done` | Mark task done with proof | Yes | `S/A/O*/R`, `I-`, `E` before the write | Proof is also stored in evidence/current-proof tables; this call duplicates the task mutation boundary. |
| 32 | [`serve.ts:13709`](/Users/matthew/git/oss/guildhall/src/runtime/serve.ts:13709) task action `add-acceptance` | Add an acceptance criterion | Yes | `S/A/O*/R`, `I-` | A detail-only edit rebuilds the complete current task index. |
| 33 | [`serve.ts:13783`](/Users/matthew/git/oss/guildhall/src/runtime/serve.ts:13783) task action `update-brief` | Update product brief and acceptance | Yes | `S/A/O*/R`, `I-` | A spec/brief edit should update one work item plus affected scope rows. |
| 34 | [`serve.ts:13822`](/Users/matthew/git/oss/guildhall/src/runtime/serve.ts:13822) task action `answer-question` | Answer one task question | Yes | `S/A/O*/R`, `I+` after lines 13823-13833 | Owner-input submission is a second write boundary after the queue snapshot. |
| 35 | [`serve.ts:13865`](/Users/matthew/git/oss/guildhall/src/runtime/serve.ts:13865) task action `stage-answer` | Save a draft answer | Yes | `S/A/O*/R`, `I-` | Draft owner input changes task detail and summary but not the attention record. |
| 36 | [`serve.ts:13921`](/Users/matthew/git/oss/guildhall/src/runtime/serve.ts:13921) task action `answer-questions` | Batch-answer task questions | Yes | `S/A/O*/R`, `I+` after lines 13922-13934 | Queue, transcript, and owner-input receipts are separate commits. |
| 37 | [`serve.ts:14036`](/Users/matthew/git/oss/guildhall/src/runtime/serve.ts:14036) task action `hold`/`resume-hold`/`shelve`/`unshelve` | Change task availability | Yes | `S/A/O*/R`, `I-` | Availability is projected, but attention reconciliation is not. |
| 38 | [`task-delivery-step-migration.ts:183`](/Users/matthew/git/oss/guildhall/src/runtime/task-delivery-step-migration.ts:183) | Migrate delivery steps out of task shape | Yes | `S/A/O*/R`, `I-` | Migration has a snapshot/manifest, but publishing is still a full replacement. |
| 39 | [`task-hierarchy-migration.ts:251`](/Users/matthew/git/oss/guildhall/src/runtime/task-hierarchy-migration.ts:251) | Normalize parent/child hierarchy | Yes | `S/A/O/R`, `I-` | Correct migration boundary; not a model for normal hierarchy edits. |
| 40 | [`task-question-migration.ts:144`](/Users/matthew/git/oss/guildhall/src/runtime/task-question-migration.ts:144) | Convert legacy questions into owner-input sessions | Yes | `S/A/O/R`, `I+` during `createOwnerInputRequest` | Owner-input projection is written separately before the queue rewrite completes. |
| 41 | [`task-state-migration.ts:151`](/Users/matthew/git/oss/guildhall/src/runtime/task-state-migration.ts:151) | Move runtime/workspace/evidence fields out of tasks | Yes | `S/A/O/R`, `I-`, `X/E` before the write | This is the migration that proves the old task aggregate carried too much data. |
| 42 | [`work-decomposition-migration.ts:238`](/Users/matthew/git/oss/guildhall/src/runtime/work-decomposition-migration.ts:238) | Persist execution-plan decomposition | Yes | `S/A/O*/R`, `I-` | A decomposition batch should eventually use structural delta writes. |
| 43 | [`workspace-importer.ts:106`](/Users/matthew/git/oss/guildhall/src/runtime/workspace-importer.ts:106) | Seed/import a workspace task queue | Yes | `S/A/O*/R`, `I-` | No revision token; importer-derived owner input/attention is separate. |
| 44 | [`product-brief.ts:401`](/Users/matthew/git/oss/guildhall/src/tools/product-brief.ts:401) | Agent writes a product brief | Yes | `S/A/O*/R`, `I-` | Revision guarded; orientation charter is not re-inferred without `projectRoot`. |
| 45 | [`proposal.ts:96`](/Users/matthew/git/oss/guildhall/src/tools/proposal.ts:96) `proposeTask` | Add a proposed task | **Targeted batch for promoted projects** | `S/A/O*/R`, `I-` | A single new task can now be inserted without rewriting existing detail; proposal policy/inbox state is still refreshed separately. |
| 46 | [`proposal.ts:209`](/Users/matthew/git/oss/guildhall/src/tools/proposal.ts:209) `preRejectTask` | Shelve/reject a proposed task | Yes | `S/A/O*/R`, `I-` | Attention may continue to be derived from a separate inbox pass. |
| 47 | [`run-gates-tool.ts:128`](/Users/matthew/git/oss/guildhall/src/tools/run-gates-tool.ts:128) | Persist gate results and command-proof updates | Targeted for promoted projects; compatibility aggregate for legacy projects | `S/A/O*/R`, `I-`, `E` | Promoted projects now omit `gateResults` from task detail and commit bounded evidence in the targeted transaction; the legacy branch remains migration-only cleanup work. |

## Tests Added

The data-layer boundary now has a regression test that writes a queue through
the shared writer and verifies that the same commit produces the current
summary, selected scope, next action, release summary, and orientation spine.
This is intentionally a boundary test rather than a UI test: it protects the
contract that all future mutation-specific writers must preserve.

The test does **not** claim that the aggregate replacement has been solved. It
guards the current behavior while the next refactor introduces mutation APIs
for task facts, hierarchy/scope membership, and queue selection. The database
suite now also proves that release selection preserves every task detail blob.

## Next Architectural Refactor

The next safe shape is not another wrapper around the aggregate writer. It is a
small set of transactionally coordinated mutation operations:

1. `upsertWorkItemCurrent` for one or a batch of changed task cards and detail
   rows.
2. `writeTaskBatchDelta` for additions/removals plus changed task/detail rows;
   the first implementation now covers safe structural additions and split
   children without changing release membership.
3. `replaceWorkItemRelationships` for parent/dependency/release membership
   deltas. The existing structural batch transaction now owns this boundary,
   including the queue envelope, so a second relationship writer is not needed.
4. `replaceProjectScopeRows` for only affected scope rows. The structural
   transaction now writes only the changed derived rows.
5. `refreshProjectCurrentSummary` that reads indexed current rows and writes
   only summary/orientation/action fields at the same source revision.
6. `refreshAttentionProjection` when the mutation changes an owner-facing
   question, blocker, migration, or proof condition.

Each operation must carry the queue/source revision it read. A queue writer
should become a migration/import compatibility path, not the default API for
every task transition. The remaining work is coordinating attention refreshes
with these transactions and moving explicit repair/import callers off the
aggregate path; adding more compatibility branches would deepen the current
aggregate model.

## Targeted mutation boundary added - 2026-07-15

`writeProjectStateDatabaseTaskMutation` now provides the first real targeted
transaction for promoted projects. It requires the queue revision read with
the task, updates one `work_items` row and one `work_item_detail` payload,
updates or removes one `work_scope` row when requested, advances the queue
watermark, and commits the supplied summary/orientation/auxiliary rows at the
same revision. It refuses legacy authority, incomplete detail indexes, and
stale compare-and-swap tokens.

The transaction advances the revision marker on unchanged detail rows without
decompressing or rewriting their payloads. That preserves the explicit rich
queue reader's coherent revision contract while avoiding the old delete-and-
reinsert of every task definition.

Focused proof in `src/sessions/__tests__/project-state-database.test.ts` covers
the unchanged-payload guarantee, summary/scope atomicity, and stale-writer
rejection. The shared boundary now routes release-envelope-only changes through
the targeted transaction for promoted projects. This does not yet migrate the
remaining aggregate callers. The next integration slice should move one
structural task batch through a delta API rather than adding an adapter that
reconstructs the whole queue first.

## Targeted release selection - 2026-07-15

Release selection is now modeled as a project-envelope mutation, not a task
queue replacement. The shared boundary detects unchanged task definitions and
uses `writeProjectStateDatabaseReleaseSelectionMutation` for promoted projects.
That transaction updates only changed release definitions, selected-release
state, changed/removed `work_scope` rows, the summary/read-model rows, and the
revision watermark. It advances unchanged detail-row revisions for coherent
rich reads but does not rewrite their compressed payloads. Legacy projects
continue through the compatibility writer.

**Contract Touch Decision - `codex:targeted-release-selection-2026-07-15`**

- **Touched contracts:** shared queue-writer routing, selected-release
  persistence semantics, current scope/summary atomicity, and stale-write
  rejection.
- **Considered but not touched:** task identity/detail schema, release
  vocabulary, public release API response shape, and legacy file authority.
- **Required follow-up:** migrate structural task batches and attention refresh
  as separate mutation classes.
- **Proof required:** selected-release changes must preserve all task detail
  payload bytes, update affected scope rows, advance one revision, and reject a
  stale writer without partial release/summary state.
- **Proof provided:** the project-state database suite passes the targeted
  release-selection test; the shared boundary and data-layer/contract checks
  pass.
- **Apply/revert:** promoted projects use the new transaction; legacy projects
  retain the existing aggregate compatibility path. Reverting the routing does
  not require a data rewrite.

**Schema Migration Decision - `0.12.48/targeted-release-selection`**

- **Persisted schema touched:** none; existing `scopes`, `queue_state`,
  `work_scope`, `work_item_detail`, and summary tables are reused.
- **Change class:** write-path semantics only.
- **Existing data impact:** no migration or history rewrite.
- **Compatibility reader:** unchanged; the indexed queue reader observes the
  new revision and selected-release value.
- **Fixtures/tests:** targeted database and shared-boundary suites.
- **Owner-facing plan text:** release selection is a scope projection change,
  not a task rewrite.
- **Rollback/revert:** route the boundary back to the aggregate writer; no
  persisted data conversion is required.

## Targeted structural task delta - 2026-07-15

The shared boundary now also routes promoted projects with task additions or
multiple changed task identities through `writeProjectStateDatabaseTaskBatchMutation`.
The transaction upserts only the changed/new `work_items` and detail rows,
updates only affected scope rows, removes explicitly requested task/scope
identities, advances unchanged detail-row revision watermarks, and commits the
summary at the same revision. It refuses release-envelope changes so a future
relationship/release delta cannot be smuggled into a generic task batch.

The first verified callers are the one-new-task proposal shape and the
parent-plus-children split shape through the shared writer boundary. Existing
single-task changes continue to use the narrower task transaction. Import,
migration, recovery, and unsafe relationship changes remain aggregate by
design until their own contracts are explicit.

**Contract Touch Decision - `codex:targeted-structural-task-delta-2026-07-15`**

- **Touched contracts:** shared queue-writer dispatch, structural task delta
  semantics, explicit task/scope removal, revision coherence, and promoted
  current-detail ownership.
- **Considered but not touched:** release definition/selection, dependency
  graph semantics, attention projection, task evidence, and legacy file writes.
- **Required follow-up:** introduce a relationship/release membership delta
  transaction and coordinate attention/evidence writes before migrating those
  callers.
- **Proof required:** unchanged task detail bytes survive a multi-task delta;
  new tasks become readable; affected scope rows agree; stale writers fail
  before partial writes; release envelope stays unchanged.
- **Proof provided:** database and shared-boundary suites pass the structural
  delta tests; data-layer lint, contract lint, and diff checks pass.
- **Apply/revert:** promoted projects use the targeted batch only when its
  invariants hold; unsafe/legacy cases retain aggregate compatibility. No
  persisted conversion is needed to revert the dispatch.

**Schema Migration Decision - `0.12.49/targeted-structural-task-delta`**

- **Persisted schema touched:** none; existing normalized task, detail, scope,
  summary, and revision tables are reused.
- **Change class:** write-path semantics only.
- **Existing data impact:** no migration, history rewrite, or task identity
  conversion.
- **Compatibility reader:** unchanged indexed queue/detail readers.
- **Fixtures/tests:** targeted database and shared-boundary structural delta
  tests.
- **Owner-facing plan text:** structural additions update only their changed
  records; release and relationship changes remain separate decisions.
- **Rollback/revert:** route the boundary back to aggregate compatibility with
  no data rewrite.

## Final current-state write boundary - 2026-07-15

The ordinary project-state writer no longer manufactures the retired full
queue sidecar or `project-summary.json`. A normal write commits the normalized
SQLite current-state model only: indexed work rows, per-task compressed detail,
scope rows, summary, orientation, and the selected release envelope. Runtime
queue readers fail closed when that current detail is absent.

The only remaining historical-shape writes are explicit migration requests:
`fullCompatibility` and `compactCompatibility`. They exist so the ordered
migration runner can finish converting a project that still has an old file;
they are not reachable from ordinary intake, execution, review, or summary
refresh writes. The final migration verifies the database before removing
those files, including old live-state/runtime/workspace JSON.

Bootstrap readers now prefer the database whenever a queue revision exists.
Only a project with no current queue revision may be read from an initial
source file while it is being imported. Once the first current-state write
lands, subsequent reads cannot silently return the old file.

**Contract Touch Decision - `codex:current-state-single-writer-2026-07-15`**

- **Touched contracts:** normal queue writes, summary writes, bootstrap queue
  reads, and explicit migration compatibility output.
- **Considered but not touched:** task identity/detail schema, release
  vocabulary, evidence retention, and public route response shapes.
- **Required follow-up:** migrate remaining broad aggregate callers into their
  own point/batch mutation contracts; do not add another compatibility branch.
- **Proof required:** ordinary writes create no queue or summary sidecar;
  current reads use SQLite; explicit migration fixtures can still import and
  then remove old files.
- **Proof provided:** project-state database, boundary, summary, and migration
  suites pass (107 tests); data-layer lint, contract lint, and diff checks pass.
- **Apply/revert:** no data rewrite is required to revert code, but restoring
  historical writes would intentionally reintroduce duplicate state and is
  therefore not an acceptable rollback target.

**Schema Migration Decision - `0.13.0/current-state-single-writer`**

- **Persisted schema touched:** none; existing normalized tables and
  per-task detail rows are reused.
- **Change class:** writer/read-boundary behavior.
- **Existing data impact:** historical files are imported by the ordered
  migration and removed only after verification; new writes stop creating
  them.
- **Migration id:** `0.13.0/project-state-finalize`.
- **Compatibility reader:** explicit `ForMigration` APIs only; no normal
  runtime fallback.
- **Fixtures/tests:** final-cutover migration fixture plus focused database,
  boundary, and summary suites.
- **Owner-facing plan text:** run `pnpm migrate:project-state --all` after a
  build to convert and finalize registered projects.
- **Rollback/revert:** restore from the migration snapshot/manifest if the
  verification gate fails; do not revive a second current-state writer.

## Recorded-cutover cleanup correction - 2026-07-15

The first finalization implementation could be recorded as applied before a
later build expanded its cleanup list to include availability, attention,
reconciliation, and task-runtime compatibility files. Because migration
status is deliberately idempotent, the recorded finalization then would not
run again, leaving those files behind even though SQLite was already the
authority. This was a migration-versioning defect, not a reason to make the
normal runtime read those files again.

Migration `0.13.0/project-state-legacy-live-file-cleanup` is the explicit
repair boundary. It applies only to SQLite-authoritative projects, detects
only the retired files that still exist, removes them idempotently, and leaves
the already-applied finalization record untouched.

**Contract Touch Decision - `codex:recorded-cutover-cleanup-2026-07-15`**

- **Touched contracts:** migration detection/idempotence and the retired
  current-state file boundary.
- **Considered but not touched:** normal project-state readers/writers,
  runtime route shapes, task identity, and evidence retention.
- **Required follow-up:** keep the cleanup migration in the idempotent migration
  plan so newly registered or restored projects cannot reintroduce retired
  current-state files.
- **Proof required:** a fixture with finalization already recorded and legacy
  live-state files recreated must apply the cleanup migration once, remove all
  files, and remain a no-op on the second run.
- **Proof provided:** focused migration regression test added; the cleanup
  migration was run across all seven registered projects with zero failures,
  followed by a fresh installed-service and fleet-performance proof.
- **Apply/revert:** remove only the retired files after SQLite authority is
  verified; do not restore them as runtime fallbacks.

**Schema Migration Decision - `0.13.0/project-state-legacy-live-file-cleanup`**

- **Persisted schema touched:** no SQLite table changes; cleanup targets only
  retired compatibility files.
- **Change class:** required migration repair for already-recorded cutovers.
- **Existing data impact:** deletes only `TASKS.json`, task-detail sidecars,
  project-summary, availability, attention, reconciliation, and task-runtime
  compatibility files after database authority is confirmed.
- **Migration id:** `0.13.0/project-state-legacy-live-file-cleanup`.
- **Compatibility reader:** none in normal runtime; migration-only detection
  checks file existence.
- **Fixtures/tests:** recorded-cutover regression in `migrations.test.ts`.
- **Owner-facing plan text:** run `pnpm migrate:project-state --all` after a
  build; it will clean projects whose earlier cutover was already recorded.
- **Rollback/revert:** restore from the migration snapshot/manifest only if a
  verification failure identifies a bad deletion; do not re-enable legacy
  readers.

## Queue-envelope and strict overlay follow-through - 2026-07-15

The queue envelope is now part of the normalized current-state database model,
not an accidental property of a compatibility export. `queue_state` schema
version 25 stores `executionPlanActions` and `scopeAuthorityRequests` beside
release selection. Targeted task and batch mutations refuse the narrow path
when either envelope changes, so planning-state edits cannot be silently lost.

Promoted effective-task reads also stop at the SQLite boundary when an overlay
row is absent: they no longer reopen the old runtime/workspace JSON stores.
That prevents a partially migrated project from showing a second answer while
the migration gate is supposed to fail closed.

The compaction command retains one explicit bootstrap path for a project that
has not yet been promoted. It writes that project's configured thin queue
directly; once promotion occurs, normal writes and reads use SQLite only. This
is a migration boundary, not a normal-runtime fallback.

**Contract Touch Decision - `codex:queue-envelope-and-strict-overlay-2026-07-15`**

- **Touched contracts:** queue envelope preservation, targeted mutation routing,
  promoted effective-task reads, and pre-promotion compaction output.
- **Considered but not touched:** public release/task response shapes, task
  identity, and historical evidence APIs.
- **Required follow-up:** coordinate attention refreshes with the structural
  transaction and move explicit repair/import callers off the aggregate path;
  do not add another aggregate writer.
- **Proof required:** envelope changes must force the aggregate/structural path
  rather than lose planning state; missing promoted overlays must not revive
  legacy files; thin bootstrap compaction must still remove bulky fields.
- **Proof provided:** focused queue, database, effective-task, and compaction
  tests pass; build, data-layer lint, contract lint, and diff checks pass.
- **Apply/revert:** promoted projects keep the normalized database contract;
  reverting code must not restore legacy reads or duplicate current state.

**Schema Migration Decision - `0.13.0/project-state-queue-envelope-v25`**

- **Persisted schema touched:** SQLite `queue_state`, adding
  `execution_plan_actions_json` and `scope_authority_requests_json`.
- **Change class:** additive current-state schema migration with empty-array
  defaults; no task/detail payload rewrite.
- **Existing data impact:** existing promoted projects retain their queue,
  release, and task rows; absent envelope values read as empty arrays.
- **Migration id:** schema version 25 is applied by the database `ensureSchema`
  boundary before current reads/writes; the project cutover script remains the
  required file-state migration.
- **Compatibility reader:** none for normal promoted reads; the migration
  writer can import an old queue once and writes the normalized envelope.
- **Fixtures/tests:** `project-state-database`, shared-boundary, task-queue,
  and migration suites.
- **Owner-facing plan text:** planning actions and scope-authority requests are
  current queue envelope state and survive task-only writes without duplicating
  the full queue.
- **Rollback/revert:** code rollback leaves additive columns harmless; restoring
  a snapshot restores the prior queue envelope, but legacy duplicate files are
  not reintroduced as a runtime source.

## Structural relationship delta and projection row diff - 2026-07-15

The indexed task-batch transaction is now the shared structural boundary. It
can commit changed task definitions, parent/dependency/release membership,
release definitions, selected release, planning envelopes, and affected
derived scope rows under one queue-revision CAS. It does not decompress or
rewrite untouched `work_item_detail` rows. A queue-envelope-only change is
valid; it advances current state without manufacturing a fake task mutation.

Attention and owner-input replacement also use keyed row diffs. They delete
only rows that disappeared and upsert only changed rows, preserving row
identity and avoiding a table-wide rewrite for every projection refresh.

**Contract Touch Decision - `codex:structural-relationship-delta-2026-07-15`**

- **Touched contracts:** structural task mutation, relationship membership,
  queue envelope, affected scope rows, attention row replacement, and
  owner-input row replacement.
- **Considered but not touched:** public task/route response shapes, task
  identity, evidence retention policy, and historical transcript storage.
- **Required follow-up:** coordinate attention refresh with structural writes
  when an Inbox item changes, then retire the remaining explicit repair/import
  aggregate callers after their migrations are verified.
- **Proof required:** dependency or parent edits must not rewrite unrelated
  detail payloads; envelope-only changes must survive; unchanged attention and
  owner-input rows must not be deleted/reinserted.
- **Proof provided:** focused database and boundary suites pass **52/52** for
  the targeted relationship slice and **239/239** across the full focused
  migration/database/boundary suite. Build, data-layer lint, contract lint,
  diff check, and the previously installed fleet audit pass.
- **Apply/revert:** promoted projects use the normalized structural transaction;
  legacy projects remain behind the explicit migration boundary. Reverting
  code must not restore normal-runtime reads from retired files.

## Final promoted-writer guard and bounded repair cleanup - 2026-07-15

The promoted aggregate writer now checks the incoming queue against the current
SQLite detail before sanitization. If a caller changes or omits an
evidence/runtime-owned field, the write fails explicitly instead of silently
dropping notes, proof, ownership, workspace, or escalation state. Normal
point, structural-batch, release-envelope, and evidence writers remain the
allowed boundaries.

Git Story commit and local/deferred decisions now use the task point plus
bounded `git_story` evidence. MCP contract apply/revert now applies only the
delivery delta to existing normalized task points and refuses an unpromoted
project instead of rewriting a legacy queue. Three unreferenced repair
routines that still carried aggregate queue writes were deleted. The two
start-time recovery repairs that remain are point/evidence writes when the
project is promoted.

The pre-promotion writer still preserves the bootstrap queue envelope from the
configured queue file. That is the only ordinary file write left: it exists so
intake can be opened before promotion. After promotion, the file is not read
or written by normal runtime paths.

**Contract Touch Decision - `codex:promoted-writer-guard-and-repair-cleanup-2026-07-15`**

- **Touched contracts:** promoted aggregate write rejection, Git Story evidence,
  MCP delivery-delta application, start-time recovery mutation, and bootstrap
  queue-envelope preservation.
- **Considered but not touched:** public task route shapes, evidence kinds,
  release identity, task identity, and historical evidence APIs.
- **Required follow-up:** finish the bounded Current Thread refresh and run the
  installed fleet proof after the worker changes land.
- **Proof required:** evidence-owned fields survive contract apply/revert;
  aggregate callers cannot erase them; promoted start recovery does not need a
  legacy queue; bootstrap release selection remains intact.
- **Proof provided:** MCP plus boundary suites pass 15/15; source build,
  data-layer lint, contract lint, and diff check pass.
- **Apply/revert:** the normalized database remains authoritative. Reverting
  this code must not restore a normal-runtime queue-file reader or writer.

**Schema Migration Decision - `codex:promoted-writer-guard-and-repair-cleanup-2026-07-15`**

- **Persisted schema touched:** no new tables or columns. The change consumes
  the existing per-task detail, task-evidence, runtime, workspace, and Git Story
  projection tables established by the current project-state migrations.
- **Change class:** write-routing and invariant hardening; no data rewrite is
  needed before running because the final project-state migration already
  removes duplicate live files and the evidence boundary compacts new writes.
- **Existing data impact:** promoted detail remains intact; contract changes
  update only the changed task point. New Git Story and recovery facts enter
  bounded evidence/current projections.
- **Migration id:** none; this is a post-cutover invariant over the existing
  schema. The required cutover remains `0.13.0/project-state-finalize`.
- **Compatibility reader:** none in normal runtime. Legacy queue support is
  limited to explicit migration/bootstrap paths.
- **Fixtures/tests:** `src/mcp-server/__tests__/server.test.ts` and
  `src/runtime/__tests__/project-state-boundary.test.ts` cover the new guard.
- **Owner-facing plan text:** a promoted project must use point, structural,
  release, evidence, or runtime actions; a whole-queue replacement is not a
  supported current-state operation.
- **Rollback/revert:** preserve SQLite state and migration snapshots; do not
  recreate retired queue files as a second source of truth.

## Multi-lane promoted writer and retention completion pass - 2026-07-15

Four bounded implementation lanes were run in parallel against the remaining
writer graph:

- **Execution writers:** `run-once` and `run-automation` now use normalized
  task-point, evidence, runtime, and structural boundaries after promotion.
  Queue reconstruction remains an explicit pre-promotion/bootstrap operation.
- **Repair and proof writers:** owner-input repair writes current task state
  through the point/evidence path; proof recovery is cleared by fresh proof
  evidence rather than by reopening and rewriting a whole task queue.
- **Memory and history:** session snapshots now persist a bounded essential
  history with only a bounded crash-recovery tail; `latest.json` is a pointer,
  not a second full snapshot. Memory events use one bounded project stream and
  the empty Mastra substrate/thread-shell cleanup is guarded by schema/data
  inspection.
- **Database boundary:** the normalized project-state database and its focused
  tests were rechecked alongside the writer lanes. Normal reads do not revive
  retired current-state JSON files.

The final memory boundary review removed the remaining normal-read merge of
legacy per-scope memory files. `consolidateProjectMemoryEvents` can still read
those files only as an explicit migration input, write the bounded project
stream, and remove the old files. A normal `readMemoryEvents` call now reads
only the current stream; the regression proves a legacy file is invisible
until the explicit migration runs.

**Contract Touch Decision - `codex:multi-lane-promoted-writers-and-retention-2026-07-15`**

- **Touched contracts:** promoted runtime mutation routing, owner-input repair,
  proof-recovery clearing, session snapshot retention, memory event storage,
  and historical per-scope memory migration.
- **Considered but not touched:** public task identity/status names, release
  identity, current project summary response shape, and the external MCP
  contract shape.
- **Required follow-up:** audit any remaining intentionally migration-only
  readers and remove their command aliases once the next clean-data fixture
  migration has been proven; do not add a normal-runtime compatibility reader.
- **Proof required:** promoted writes must not rewrite full queue/detail blobs;
  raw session/history payloads must be bounded; old memory files must not be
  reopened by normal reads; existing evidence and current summaries must remain
  visible.
- **Proof provided:** 9 runtime-writer tests, 14 repair/proof tests, 22
  memory-core tests, 20 session/history tests, and 106 database/migration/
  boundary/automation/MCP tests passed in focused runs. Build, data-layer
  lint, contract lint, and diff checks passed.
- **Apply/revert:** current promoted state remains SQLite plus bounded evidence;
  revert through migration snapshots only. Do not restore old queue/history
  files as live sources.

**Schema Migration Decision - `codex:multi-lane-promoted-writers-and-retention-2026-07-15`**

- **Persisted schema touched:** session snapshot payload retention, bounded
  project memory event stream, and existing normalized task/evidence/runtime
  projections; no new current task hierarchy was introduced.
- **Change class:** post-cutover write routing and bounded-retention hardening,
  plus one explicit memory-stream consolidation migration.
- **Existing data impact:** old session snapshots can be compacted in place;
  old per-scope memory events are consolidated into the bounded stream; empty
  Mastra-only databases/thread shells are retired only after guarded inspection.
- **Migration id:** project-state cutover remains
  `0.13.0/project-state-finalize`; memory consolidation is an explicit
  command-level operation and is not a normal-read compatibility path.
- **Compatibility reader:** none in normal current-state or memory reads;
  historical files are accepted only by their explicit migration functions.
- **Fixtures/tests:** memory-core, session storage/history, project-state
  database, migration, boundary, automation, owner-input, proof-health, and
  MCP suites listed above.
- **Owner-facing plan text:** run the project-state migration first, then run
  the explicit memory/history cleanup on registered projects; clean projects
  should have one current source for each projection.
- **Rollback/revert:** use migration snapshots/manifest for current-state
  recovery; never recreate historical files as a second live authority.

## 2026-07-15 - Bootstrap CAS and strict historical boundaries

- **Root cause found:** pre-promotion queue writes were passing a `null`
  revision token into the SQLite projection writer. The database correctly
  interpreted that as an expected revision and rejected the first write. The
  shared boundary now omits CAS when no revision exists and captures an
  existing bootstrap projection revision when one does exist.
- **Current-state rule:** promoted projects read and mutate normalized SQLite
  projections. A promoted read must not silently reopen `TASKS.json`,
  `PROGRESS.md`, or per-scope evidence/history files after a projection error.
  Those paths are migration inputs only and must fail explicitly when ordinary
  reads encounter an un-migrated legacy shape.
- **Touched contracts:** pre-promotion queue CAS, promoted task evidence and
  runtime overlay reads, project progress/evidence access, and fixture setup for
  promoted runtime/e2e tests.
- **Considered but not touched:** public task IDs/statuses, release identity,
  current summary response shape, and the external MCP contract shape.
- **Schema Migration Decision - `codex:strict-historical-boundaries-2026-07-15`:**
  persisted current-state authority remains the normalized project database;
  legacy queue/progress/evidence files remain readable only by explicit
  migration code. Existing projects require the current-state migration before
  ordinary reads; no compatibility reader is allowed after promotion. Fixtures
  now seed the normalized projections and apply the migration boundary rather
  than depending on historical files.
- **Proof:** report-issue contract **15/15**, task-state and migration
  **48/48**, project-boundary/summary **45/45**, tool CAS **84/84**, and the
  fixture regression **1 passed / 3 skipped**. The full repository run is
  materially improved but not green: **330 files passed, 34 failed; 4,531
  tests passed, 424 failed**. Remaining failures are legacy fixture/readiness
  and Thread expectations, not permission to restore historical fallbacks.
- **Rollback/revert:** use the migration snapshot/manifest. Never restore
  `TASKS.json`, `PROGRESS.md`, or legacy evidence files as a second live
  authority.

## 2026-07-15 - Explicit transcript compaction boundary

- **Change:** ordinary exploring-history reads now open only the canonical
  user-local compact history file. The old repo-local `memory/exploring` path
  is no longer a read fallback, so raw conversation cannot silently re-enter
  the live context model.
- **Change:** the explicit legacy-memory migration compacts copied exploring
  histories immediately into essential-history documents. This makes the
  cleanup path do the actual data reduction instead of merely relocating raw
  files.
- **Proof:** exploring-history and memory-migration suites pass **23/23**;
  migrated histories contain the essential-history header and retain only the
  bounded compact body. `pnpm migrate:project-state --all` completed across
  all seven registered projects with **0 failed migrations**; the only pending
  item is the manual runtime-backed transition.
- **Schema Migration Decision - `codex:essential-history-read-boundary-2026-07-15`:**
  persisted transcript history keeps the canonical compact file and treats
  legacy repo-local transcripts as explicit migration input only. The change
  is a reader-boundary removal plus bounded migration compaction; no normal
  read may revive raw transcript shape.
- **Remaining:** the broad endpoint/orchestrator fixture corpus still has
  stale expectations around compact queue rows versus rich task detail. Those
  tests must be migrated or deleted; production must not regain aggregate
  queue compatibility to satisfy them.

## 2026-07-15 - Cache ownership root cause and one-time residue cleanup

- **Root cause found:** temporary test projects that supplied a custom
  `GUILDHALL_DATA_DIR` were classified as durable when their project root was
  ephemeral. Every test run could therefore allocate a user-cache project
  directory and register it as if it were a real workspace. This was a cache
  ownership bug, not an acceptable steady-state need for pruning.
- **Change:** durable cache registration now depends only on the project-root
  lifecycle: ephemeral project roots never register durable history/cache
  state. Explicit allocation is still available at the write boundary for
  tests and isolated callers, but it cannot pollute the durable registry.
- **Remediation:** after the ownership fix, the one-time cleanup removed only
  cache roots absent from the registry. It preserved all seven registered
  workspaces and their seven allocation manifests. The cache fell from
  **3.6 GB / 52,633 roots** to **31 MB / 7 roots**.
- **Proof:** local-history regression coverage passes **7/7**; registry and
  manifest counts agree after cleanup. This is a root-cause correction plus
  bounded remediation, not a recurring prune job hiding an allocation bug.
- **Schema Migration Decision - `codex:ephemeral-cache-ownership-2026-07-15`:**
  persisted cache registry semantics are tightened without changing project
  state schema. Existing unregistered cache roots are disposable remediation
  input; registered workspace roots are retained. No compatibility reader or
  new durable state shape is introduced. Rollback is limited to restoring the
  seven registered roots from their allocation manifests if required.

## 2026-07-15 - Normal current-state writer migration slice

**Contract Touch Decision - `codex:normal-current-writer-migration-2026-07-15`**

- **Touched contracts:** existing promoted task-definition mutation,
  task-runtime overlay, task-evidence, and aggregate queue boundaries in
  `src/tools/product-brief.ts`, `src/tools/proposal.ts`,
  `src/tools/run-gates-tool.ts`, and `src/tools/task-queue.ts`.
- **Considered but not touched:** public task identity/status contracts,
  release-selection semantics, persisted table/column definitions, and the
  broad intake/meta-intake writers. Proposal creation, task addition, split
  materialization, and release-envelope changes remain structural queue work.
- **Required follow-up:** migrate the one-task intake and meta-intake paths by
  mutation class; retain aggregate writes for imports, migrations, restores,
  bootstrap, and genuine structural queue changes.
- **Proof required:** promoted one-task writes must use the point boundary;
  runtime assignment and notes/gates must use their dedicated writers;
  promoted-state forbidden-field guards must remain active; structural and
  legacy/bootstrap aggregate paths must keep their existing behavior.
- **Proof provided:** the four migrated tool test files pass **87/87**; the
  six-file focused run passes **175/176**, with the pre-existing intake
  recovery-spec failure recorded in the task report; `pnpm lint:data-layer`
  passes. No promoted fallback to aggregate replacement was added.
- **Apply/revert:** code-only writer routing. Reverting this slice restores
  the prior aggregate path without deleting normalized rows or evidence.

**Schema Migration Decision - `codex:normal-current-writer-migration-2026-07-15`**

- **Persisted schema touched:** none. Existing task-definition, summary,
  runtime, and evidence rows are reused; no table or column is added.
- **Scope/change class:** normal current-state write routing only; no data
  migration is required before run.
- **Existing data impact:** promoted single-task definitions update one point;
  runtime and evidence update their own rows. Structural queue and legacy
  bootstrap writes retain their existing aggregate behavior.
- **Migration id:** none.
- **Compatibility reader:** none added. Promoted reads and guards are
  unchanged; aggregate legacy handling is a write path only.
- **Fixtures/tests:** the four migrated tool test files exercise promoted
  point/runtime/evidence routing; intake and meta-intake fixtures remain the
  follow-up surface.
- **Owner-facing plan text:** one-task edits update the task point and keep
  overlays/evidence separate; queue replacement remains for structural work.
- **Rollback/revert:** revert code only; preserve normalized state and use the
  existing explicit migration snapshot/rollback procedures if data recovery is
  ever required.
