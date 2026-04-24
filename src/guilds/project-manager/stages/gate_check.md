# Stage: `gate_check`

Hard gates run. These are shell commands that must exit 0 (FR-05). Pass/fail is boolean and recorded on the task — no partial credit, no vibes.

## What "good" looks like

- **Run every registered gate.** Skipping a gate requires a human override with a DECISIONS.md entry. Never silently skip.
- **Persist every result.** `{command, exit code, truncated stdout/stderr, timestamp}` on the task. The audit trail is non-negotiable (FR-05, NFR-03).
- **Respect timeouts.** The default TS monorepo registry uses 1–3 min timeouts per gate; a hang is a failure, not a "just wait longer."
- **Don't mutate code from this stage.** Gate check is observation. Fixing a failure belongs in `in_progress`.

## How this stage is evaluated

- All gates green → `done` and the merge path (FR-25) runs per lever `merge_policy`.
- Any gate red → task returns to `in_progress` (or `blocked` if at `max_revisions`); the failing gate's output is surfaced to the worker's next prompt.

## Handoff

- Pass: status → `done` (or `pending_pr` under `merge_policy: manual_pr`). Trigger merge-dispatcher.
- Fail: status → `in_progress` with gate output appended to task notes. Increment `revisionCount`.
