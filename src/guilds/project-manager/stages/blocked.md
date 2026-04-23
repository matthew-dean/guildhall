# Stage: `blocked` (terminal-until-resolved)

Escalation halted this task (FR-10). Reasons: spec ambiguous, `max_revisions` exceeded, decision requires human judgment, checkpoint older than 24h. Human (or escalation-empowered coordinator) must resolve before the task re-enters the pipeline.

## What "good" looks like

- **The escalation entry is actionable.** PROGRESS.md entry (type `escalation`) states: what the blocker is, what was tried, what decision is needed, who can unblock. Vague "stuck" is not an escalation.
- **State is preserved, not discarded.** Checkpoint, worktree, and notes stay intact so the resolver has the full picture. Destructive cleanup waits for the resolution decision (FR-32 per-incident call, not a lever).
- **No silent auto-retry.** Agents must NOT re-attempt a blocked task without a recorded resolution. That's what caused the block in the first place.

## How this stage is evaluated

- Resolution records a DECISIONS.md entry (trigger, inputs, chosen action, rationale — FR-32) and transitions the task to a non-terminal status (`in_progress`, `ready`, or `exploring`) or a different terminal (`shelved`, `done` via override).
- `remediation_autonomy: pause_all_on_issue` freezes the whole project until human review; other positions scope the pause to the single task.

## Handoff

- Resolver writes the decision, updates the task status, and logs an unblock progress entry.
- If the block was systemic (same shape across multiple tasks), consider a `policyVersion` bump or a lever adjustment rather than unblocking N tasks individually.
