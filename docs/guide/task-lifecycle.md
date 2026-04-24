---
title: Task lifecycle
help_topic: guide.task_lifecycle
help_summary: |
  Tasks move through eight statuses: proposed → exploring → spec_review →
  ready → in_progress → review → gate_check → done. Terminal states are
  done, shelved, and blocked.
---

# Task lifecycle

Every task in `memory/TASKS.json` has a `status` field that tracks where it sits in the pipeline. Statuses are enumerated in `src/core/task.ts` as `TaskStatus`.

## The eight statuses

| Status | Meaning | Who advances it |
|---|---|---|
| `proposed` | Raw ask, not yet explored. | Coordinator evaluates; may promote to `exploring` or drop. |
| `exploring` | Spec Agent is interviewing the user to refine the task. | User or spec agent promotes to `spec_review`. |
| `spec_review` | Spec is drafted; waiting for coordinator sign-off. | Coordinator approves → `ready`, or requests revision. |
| `ready` | Spec is approved and the task is waiting for a worker slot. | Orchestrator dispatches → `in_progress`. |
| `in_progress` | A worker agent is doing the work. | Worker finishes → `review`, or hits a blocker → `blocked`. |
| `review` | One or more reviewers evaluate the work. | All reviewers pass → `gate_check`; any reviewer rejects → `in_progress` (revision) or `blocked`. |
| `gate_check` | Deterministic hard gates run (lint, typecheck, tests, custom). | All gates pass → `done`; any fail → `in_progress`. |
| `done` | Successful completion. Worktree merged per `merge_policy`. | Terminal. |

Terminal states:

- `done` — success.
- `shelved` — explicitly parked (user action or pre-rejection policy).
- `blocked` — max revisions exceeded or unresolvable blocker raised.

## Stage-appropriate spec fidelity

The [`spec_completeness`](../levers/spec-completeness) lever controls how complete a spec must be at each stage:

- `full_upfront` — spec must be complete before leaving `exploring`.
- `stage_appropriate` (default) — acceptance criteria by `ready`, test plan by `review`, etc.
- `emergent` — high tolerance for incomplete specs; coordinator fills gaps mid-task.

## Revisions

When a reviewer rejects, the task returns to `in_progress` with the review verdict attached. A revision counter increments. When it hits [`max_revisions`](../levers/max-revisions), the task is marked `blocked` and surfaces in the coordinator inbox for human intervention.

## Pre-rejection

A *pre-rejection* fires before work starts — e.g. a scope issue flagged at `spec_review`. The [`pre_rejection_policy`](../levers/pre-rejection-policy) lever controls what happens: terminal shelving, re-queueing with lower priority, or re-queueing with [rejection dampening](../levers/rejection-dampening).
