# Task Reframe And Recovery Repair

## Goal

Existing tasks must be able to benefit from the newer task-framing and human-input rules. A user should not be trapped inside old imported drafts, stale recovery packets, duplicate questions, or process-heavy blocker copy.

## Required Product Work

1. **Add a task action: `Reframe task...`.**
   - Available from the task drawer "More task actions" menu.
   - Opens a cancellable dialog before doing work. The dialog includes an
     optional "What to ask the coordinator" textbox so the user can add what is
     confusing, stale, wrong, or missing.
   - Reopens the task for a fresh spec/intake pass.
   - Preserves history and provenance, but invalidates stale user-facing brief/spec/blocker copy.
   - Injects a clear coordinator/spec instruction: rebuild the task from current project memory, source notes, resolved answers, current code state, and the original task origin.

2. **Add a recovery-specific explanation path: `Explain and choose next step`.**
   - Any recovery card must say what happened, what decision is needed, how the user can decide, and how to answer.
   - Internal phrases such as "authoritative verification", "checkpoint-touched files", "handoff packet", and acceptance-criteria IDs must not be the primary user-facing explanation.
   - If Guildhall can safely continue, the primary action should be a Guildhall action, not a vague owner decision.

3. **Add automatic stale-task repair eligibility.**
   - Existing tasks should be considered stale/reframeable when they contain old-style recovery copy, imported-roadmap fragments with no plain-language brief, duplicate unanswered questions, or opaque blocker/recovery states.
   - This must work project-wide later; the first slice can expose the per-task action and mark eligible tasks in UI/API.

4. **Add a coordinator instruction contract.**
   - When a reframe is requested, the coordinator/spec agent must produce a human-readable brief first.
   - It must explain any needed human input as an exact question with choices or a clear free-text answer shape.
   - It must not ask the user to inspect raw checkpoints, transcripts, gate packets, or internal task machinery to understand what to do.

## Current Slice

- Implement `POST /api/project/task/:id/reframe-task`.
- Add `Reframe task...` to the task drawer "More task actions" menu.
- Add the optional coordinator-note dialog before the reframe mutation.
- Fix the menu so it closes when clicking outside or pressing Escape.
- Add tests proving a blocked/opaque task is reopened to `exploring`, stale questions/escalations are superseded, old spec/acceptance fields are invalidated, and the transcript receives the reframe contract.
- Record this work in `internal/audits/flow-audit.md`.
