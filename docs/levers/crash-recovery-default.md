---
title: crash_recovery_default
help_topic: lever.crash_recovery_default
help_summary: |
  Default action after an agent crash or stall. `prefer_resume` (default)
  reloads the session snapshot and continues; `prefer_restart_clean`
  discards the last turn and retries from the previous good state;
  `pause_for_review` stops and waits for a human.
---

# `crash_recovery_default`

**Scope:** domain • **Default:** `prefer_resume`

The fallback action when an agent crashes or is declared stuck by [`agent_health_strictness`](./agent-health-strictness).

## Positions

| Position | Behavior |
|---|---|
| `prefer_resume` | Reload the latest session snapshot and continue. Safe because sessions are atomic. |
| `prefer_restart_clean` | Roll back to the snapshot *before* the crashed turn and retry. Useful when the last turn left state corrupted. |
| `pause_for_review` | Move the task to `blocked` and surface in the inbox. No automatic recovery. |

## Interaction with `remediation_autonomy`

`crash_recovery_default` chooses *which* recovery to attempt; [`remediation_autonomy`](./remediation-autonomy) decides *whether the recovery needs approval*. Example: `crash_recovery_default: prefer_restart_clean` + `remediation_autonomy: confirm_destructive` means: "try restart-clean, but ask me before rolling back destructive state."
