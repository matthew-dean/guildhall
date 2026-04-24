---
title: completion_approval
help_topic: lever.completion_approval
help_summary: |
  Who or what must sign off before a task is marked `done`. `human_required`
  always asks; `coordinator_sufficient` (default) lets the coordinator
  approve after review; `gates_sufficient` auto-completes on green gates.
---

# `completion_approval`

**Scope:** domain • **Default:** `coordinator_sufficient`

What authority is required to mark a task `done`.

## Positions

| Position | Behavior |
|---|---|
| `human_required` | Task waits in `gate_check` until a human clicks Approve in the dashboard. |
| `coordinator_sufficient` | If all reviewer verdicts are pass, the coordinator approves automatically. |
| `gates_sufficient` | If all hard gates pass, the task completes with no further review. |

## Picking per-domain

Most teams use:

- `gates_sufficient` for pure refactors or test-coverage tasks.
- `coordinator_sufficient` for day-to-day feature work.
- `human_required` for anything touching production configs, auth, or migrations.

Because this lever is per-domain, you can set different strictness for UI vs infra work in the same workspace.
