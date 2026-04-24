# Stage: `done` (terminal)

All gates passed; merge completed per lever `merge_policy`. The task is terminal. No further edits happen under this task id.

## What "good" looks like

- **Milestone entry in PROGRESS.md** (FR-09) naming the task id, goal id, and key outcome.
- **Merge record persisted** on the task (from-branch, to-branch, strategy, commit sha, timestamp — FR-25).
- **Worktree cleanup per policy.** `worktree_isolation: per_task` cleans up on terminal; `per_attempt` may have already cleaned. The coordinator's retention call (keep / archive / delete) is per-incident, not on a lever.
- **Follow-ups are new tasks.** If the work surfaced a latent bug or doc gap, create a new `proposed` task with rationale. Do not reopen a `done` task.

## How this stage is evaluated

- Parent goal status updates if this was the last outstanding child task.
- Any downstream tasks that were `blocked` on this one are unblocked.
