# Targeted Work-Item Mutation Decision

**Date:** 2026-07-15
**Work id:** `codex:targeted-work-item-mutation-2026-07-15`

## Contract Touch Decision

- **Touched contracts:** the session database API
  `writeProjectStateDatabaseTaskMutation`; one current task definition and its
  normalized index row; the optional task scope row; the compact summary and
  orientation rows; and the queue compare-and-swap revision.
- **Considered but not touched:** task identity semantics, release definition
  rows, task history/evidence, runtime overlays, owner-input records, and the
  existing whole-queue writer.
- **Required follow-up:** route one safe high-frequency task transition through
  this API, then migrate the remaining normal task writers by mutation class.
  Keep import, migration, restore, and rollback paths on the aggregate writer
  until each has its own boundary decision.
- **Proof required:** the CAS must run inside the SQLite transaction; an item
  mutation must update definition, index, detail, relationships, optional
  scope, and summary together; stale or unknown targets must leave current
  rows unchanged.
- **Proof provided:** focused project-state database tests cover the atomic
  task/detail/index/scope/summary write, unchanged unrelated detail bytes,
  stale revision rejection, unknown-item rejection, and scope ownership.
- **Apply/revert:** this is code-only. Reverting the writer restores the
  aggregate path and does not delete current rows or compatibility state.

## Schema Migration Decision

- **Persisted schema touched:** no table or column is added. Existing
  `work_items`, `work_item_detail`, `work_scope`, `queue_state`,
  `project_summary`, and `project_orientation` rows are reused.
- **Scope/change class:** targeted current-state writer; the existing
  `work_item_detail.revision` remains the queue snapshot watermark. A targeted
  mutation updates the integer watermark for existing detail rows without
  decompressing or rewriting unrelated payloads, then replaces only the target
  payload. This preserves the current rich-queue reader invariant.
- **Existing data impact:** the target task's definition/index and any supplied
  scope row change; unrelated detail rows only receive the new integer
  watermark, and their compressed payload bytes remain stable.
- **Migration id:** none.
- **Compatibility reader:** legacy projects continue through the existing
  queue writer; database-authoritative projects require the per-task detail
  index and the targeted writer's revision precondition.
- **Fixtures/tests:** `src/sessions/__tests__/project-state-database.test.ts`
  covers the new boundary and existing queue/detail tests remain the
  compatibility proof.
- **Owner-facing plan text:** a normal one-task change can commit as one
  revision without replacing the whole queue, while the compact summary stays
  aligned with the committed task state.
- **Rollback/revert:** revert code only; preserve all database rows and
  compatibility files.
