---
title: worktree_isolation
help_topic: lever.worktree_isolation
help_summary: |
  Per-task git worktrees — `none` runs directly in the repo, `per_task`
  gives each task its own worktree, `per_attempt` adds a fresh worktree for
  every revision attempt. Needed for fanout.
---

# `worktree_isolation`

**Scope:** project • **Default:** `none`

Whether workers run in their own git worktree.

## Positions

| Position | Effect |
|---|---|
| `none` | All workers share the main working tree. Only viable when `concurrent_task_dispatch` is `serial`. |
| `per_task` | One worktree per task, created at `ready`, torn down on terminal status. |
| `per_attempt` | Fresh worktree per revision attempt — pristine starting state for every retry. |

## Worktree paths

Under the project's `.guildhall/worktrees/` directory. Each worktree gets a friendly slug (e.g. `.claude/worktrees/gentle-newton-a7c9d2`).

## Related levers

- [`concurrent_task_dispatch`](./concurrent-task-dispatch) — fanout requires at least `per_task`.
- [`merge_policy`](./merge-policy) — determines what happens when a worktree's branch lands.

## When to change it

`per_task` is a good default once you fan out. `per_attempt` is overkill for most projects but helpful when revisions tend to leave the filesystem in a confusing state (e.g. partially-generated builds).
