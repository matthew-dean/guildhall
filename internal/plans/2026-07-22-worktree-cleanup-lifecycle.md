# Worktree Cleanup Lifecycle

## Contract Touch Decision

- Work id: durable Guildhall-owned worktree cleanup.
- Touched contracts: `GitDriver.removeWorktree`, terminal task lifecycle, and
  the normalized task workspace overlay.
- Considered but not touched: task-definition schema, release scope, branch
  retention, and raw transcript storage. Cleanup state is derived from the
  existing task status, merge record, and workspace overlay rather than a new
  parallel task model.
- Required follow-up: remove a successfully cleaned task's workspace overlay;
  reconcile completed tasks with stale workspace records on later ticks.
- Proof required: a completed-and-merged task is removed both on its original
  terminal transition and after a prior cleanup failure; pending PR and
  blocked work remain retained.
- Apply/revert: apply removes only Guildhall-created worktrees with durable
  merge evidence. Reverting restores the previous best-effort behavior; it
  cannot recreate worktrees already removed.

## Schema Migration Decision

- Persisted schema considered: `TaskWorkspaceState` and task runtime state.
- Decision: no schema change. The existing workspace record is the durable
  retry marker while removal is pending; successful cleanup clears that
  record. Eligibility remains typed task state (`status=done` and a merged
  `mergeRecord`).
- Existing data impact: historical completed tasks with a stale workspace
  record are reconciled on an ordinary orchestrator tick. Blocked, shelved,
  and pending-PR tasks are not force-cleaned.
- Compatibility and rollback: existing readers continue to read the same
  workspace fields. No migration or compatibility reader is required.

## Lifecycle

1. A task worktree remains while work is active or a PR is awaiting external
   merge.
2. Once Guildhall has durable merged landing evidence, it removes the
   Guildhall-owned worktree and clears its workspace overlay.
3. If removal fails, the overlay remains, so the next tick retries the same
   cleanup without inventing another state authority.
4. Blocked and shelved worktrees are retained for recovery. They are never
   discarded merely because a status changed.
