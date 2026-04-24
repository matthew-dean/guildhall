---
title: remediation_autonomy
help_topic: lever.remediation_autonomy
help_summary: |
  How much of a recovery action can run without human approval. `auto` runs
  anything; `confirm_destructive` (default) prompts before rm/reset/force;
  `confirm_all` prompts for every recovery; `pause_all_on_issue` stops the
  whole orchestrator on any issue.
---

# `remediation_autonomy`

**Scope:** project • **Default:** `confirm_destructive`

How autonomous the orchestrator can be when recovering from a stall, crash, or unexpected state.

## Positions

| Position | Behavior |
|---|---|
| `auto` | Execute recovery without prompting. Use with sandboxed worktrees only. |
| `confirm_destructive` | Prompt before destructive actions (`git reset --hard`, `rm -rf`, `push --force`, etc.). Non-destructive recovery proceeds. |
| `confirm_all` | Prompt before every recovery step. Slower but maximally safe. |
| `pause_all_on_issue` | Freeze the entire orchestrator at the first issue; no recovery until human resumes. |

## What counts as "destructive"

Defined in `src/runtime/remediation.ts`: any action that removes or overwrites uncommitted work, force-pushes, reverts merged commits, or deletes files outside a worktree-scoped path.

## Related

- [`agent_health_strictness`](./agent-health-strictness) — when recovery is *invoked*.
- [`crash_recovery_default`](./crash-recovery-default) — *which* recovery is chosen.
