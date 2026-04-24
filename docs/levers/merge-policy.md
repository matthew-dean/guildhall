---
title: merge_policy
help_topic: lever.merge_policy
help_summary: |
  What happens when a task completes. `ff_only_local` fast-forwards into
  main locally; `ff_only_with_push` also pushes to origin; `manual_pr`
  opens a pull request and stops.
---

# `merge_policy`

**Scope:** project • **Default:** `ff_only_local`

How a completed task's worktree branch lands in `main`.

## Positions

| Position | Effect |
|---|---|
| `ff_only_local` | Fast-forward merge into local `main`. No push. Conflicts abort and surface as an escalation. |
| `ff_only_with_push` | Same as above, then `git push` to origin. |
| `manual_pr` | Push the branch, open a PR via `gh pr create`, and stop. Human reviews and merges. |

## Non-fast-forwardable branches

When a merge would require a real merge commit (not a fast-forward), the task is marked `blocked` with a "needs rebase" escalation. Workers don't do rebases silently — you're always the one to resolve divergent history.

## Related

- `worktree_isolation` — how the branch was produced in the first place.
- `completion_approval` — whether a human must sign off before the merge runs.
