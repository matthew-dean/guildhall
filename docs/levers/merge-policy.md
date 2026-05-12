---
title: landing_strategy
help_topic: lever.landing_strategy
help_summary: |
  What happens when a task completes. `cherry_pick_local` lands accepted
  commits onto the local landing branch; `cherry_pick_with_push` also pushes
  to origin; `manual_pr` opens a pull request and stops.
---

# `landing_strategy`

**Scope:** project • **Default:** `cherry_pick_local`

How a completed task's accepted commits land on the configured landing branch.

## Positions

| Position | Effect |
|---|---|
| `cherry_pick_local` | Cherry-pick the task branch's accepted commits onto the local landing branch. No push. Conflicts abort and surface as an escalation. |
| `cherry_pick_with_push` | Same as above, then `git push` the landing branch to origin. |
| `manual_pr` | Push the branch, open a PR via `gh pr create`, and stop. Human reviews and merges. |

## Notes

- Guildhall can also read a project-level `landingBranch` override from
  `.guildhall/config.yaml`. If unset, it lands onto whatever branch the repo
  is currently on when the orchestrator starts.
- Older files may still use the internal `merge_policy` key. Guildhall maps
  that forward for compatibility.

## Related

- `worktree_isolation` — how the branch was produced in the first place.
- `completion_approval` — whether a human must sign off before landing runs.
