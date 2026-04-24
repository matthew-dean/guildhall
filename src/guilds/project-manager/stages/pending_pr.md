# Stage: `pending_pr`

Under `merge_policy: manual_pr`, gates have passed, the branch is pushed, and a PR is open. The task is holding for external merge. No agent should be editing code in the worktree for this task.

## What "good" looks like

- **Treat the PR page as the source of truth.** Comments, review requests, CI status come from the forge, not from task notes.
- **Respond to PR feedback by opening a revision task.** Don't reopen the original task's `in_progress`. A new revision task scoped to the PR comments keeps the audit trail clean.
- **Watch for merge conflicts.** A conflict detected on the PR creates a `fixup` task parented to the original goal (FR-25) — don't resolve silently in the original worktree.
- **Local-only degradation is legal.** If push fails, the project drops to `local_only` mode (FR-29) with a PROGRESS.md entry. Reconnect on the next lifecycle event, not via a retry daemon.

## Handoff

- PR merged → task status advances to `done`, merge record persisted (from-branch, to-branch, strategy, commit sha).
- PR closed without merge → task → `shelved` with reason, verdict persisted.
