# Stage: `in_progress`

A Worker Agent is executing this task. The spec is the contract. The goal is the smallest change that satisfies every acceptance criterion, with honest self-critique before handoff.

## What "good" looks like

- **Read before writing.** Read MEMORY.md, the spec, and every source file you intend to modify. No proposed edit to code you haven't read.
- **Smallest change that satisfies the ACs.** No refactors, renames, or "while I'm here" improvements outside the scope. Three similar lines beats a premature abstraction.
- **Prefer edit-file over write-file.** Rewriting a whole file clobbers context and makes review harder. Targeted edits also make the revision loop (FR-04) cheaper.
- **Checkpoint at tool boundaries.** Before destructive FS changes, after subprocess success, on explicit checkpoint markers — write `memory/tasks/<task-id>/checkpoint.json` (FR-33). This is what makes crash recovery (FR-32) possible.
- **Emit issues, don't swallow them.** If stuck, call `report_issue` (FR-31). Multiple open issues are fine — they surface in the coordinator's inbox without halting your turn.
- **Respect the slot.** Under `fanout_N` with `runtime_isolation: slot_allocation` your `GUILDHALL_SLOT` / `GUILDHALL_PORT_BASE` are the contract with the project's build scripts. Do not pick ports or DB names outside your slot's range.
- **Pre-reject cleanly when it applies.** If the task turns out to be `no_op` / `not_viable` / `low_value` / `duplicate` / `spec_wrong`, emit a pre-rejection (FR-22) instead of forcing a bad implementation. Pre-rejection skips the reviewer and does NOT count against `max_revisions`.

## Sub-stages

1. **Spec re-read + context scan.** Confirm the spec is still coherent with current code.
2. **Local plan (internal).** A short step list keyed to file paths and ACs. No need to publish it unless the spec asks.
3. **Incremental implementation.** Build → typecheck → test after each meaningful change.
4. **Checkpoint writes** at tool boundaries (FR-33).
5. **Self-critique** (required — FR-11) before handoff.

## Self-critique requirements (FR-11)

Structured note on the task, covering:
- Each acceptance criterion individually: met / not met / partial — one-sentence reason.
- Out-of-scope changes introduced (state `none` explicitly if so).
- Uncertainties the reviewer should double-check.

Lying about a failed criterion costs a full revision cycle. Honesty is faster.

## How this stage is evaluated

- Reviewer (per `reviewer_mode`) in the next stage evaluates against the same ACs you self-critiqued.
- Hard gates run after review. A worker who claims "done" while `pnpm typecheck` fails is creating rework.

## Handoff

- Set status → `review`.
- Log a heartbeat progress entry (title + file count touched is enough).
- Ensure the latest checkpoint reflects the final `files_touched[]`.
