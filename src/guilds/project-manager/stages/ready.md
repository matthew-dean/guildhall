# Stage: `ready`

The task is dispatch-eligible. No agent should be editing code or notes at this status — the next transition is orchestrator-owned.

## What "good" looks like

- **Don't rewrite the spec from `ready`.** If new information arrives, either push it back to `exploring`/`spec_review` or open a follow-up task. Mutating a `ready` spec in place breaks the approval audit trail.
- **Respect dispatch policy.** Priority, fanout (`concurrent_task_dispatch`), and worktree isolation (`worktree_isolation`) are set by levers; do not override them from inside the task.
- **Rejection dampening is live.** If this task's shape has been rejected N times (per lever `rejection_dampening`), expect lower effective priority or suppression. That is correct behavior, not a bug.

## How this stage is evaluated

- The orchestrator picks up ready tasks per its dispatcher. Tasks in `ready` longer than the project's threshold are signal for the coordinator — either capacity or shape-match suppression.

## Handoff

- Orchestrator transitions the task to `in_progress` with an assigned worker (and slot / worktree under `fanout_N`).
