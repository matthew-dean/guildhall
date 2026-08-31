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
| `per_task` | One isolated task workspace per task. Created when work begins and kept until the work has actually landed or been intentionally cleaned up. |
| `per_attempt` | Fresh worktree per revision attempt. This is a niche escape hatch, not the main recommended mode. |

## Worktree paths

New isolated task workspaces live under Guildhall's user-local data root
instead of inside the repo:

```text
~/.guildhall/worktrees/<project-id>/<task-id>
```

That keeps runtime sandboxes out of normal repo status and editor trees.

## Related levers

- [`concurrent_task_dispatch`](./concurrent-task-dispatch) — fanout requires at least `per_task`.
- [`landing_strategy`](./merge-policy) — determines what happens when a worktree's accepted commits land.

## When to change it

`per_task` is the normal recommended mode once you want isolation. `per_attempt`
is intentionally more niche.
