# Stage: `review`

The Reviewer Agent (implementation per lever `reviewer_mode`) evaluates the worker's output against the spec. Review is a gate, not a critique exercise — the verdict is pass, revise, or escalate, with reasons persisted.

## What "good" looks like

- **Score acceptance criteria independently.** Each AC gets its own verdict (met / not met / partial) with a concrete pointer (file:line or test name). No aggregate "looks good."
- **Run the soft-gate rubric (§3).** Weighted: acceptance-criteria-met (1.0), no-scope-creep (0.8), conventions-followed (0.7), no-regressions (1.0), documented (0.6). Default pass threshold is 80% weighted.
- **Read the self-critique, then challenge it.** If the worker flagged uncertainty on an AC, verify it first. If the worker claimed an AC met but the change doesn't touch that path, that is a failure.
- **Deterministic fallback is real.** Under `reviewer_mode: llm_with_deterministic_fallback`, LLM timeout / budget / provider outage → rubric-based verdict from gate outputs and AC coverage. The verdict record names the path taken (FR-27).
- **Scope discipline.** Out-of-scope changes that the worker failed to flag are a revision, not a soft pass. Pretending they weren't there teaches the wrong lesson.

## How this stage is evaluated

- Pass → `gate_check`.
- Fail → back to `in_progress` with *specific, actionable* feedback. Increment `revisionCount`. At `max_revisions` the task goes `blocked` and escalates (FR-10).
- Reviewer's feedback is the worker's prompt next turn — be precise. "Improve tests" is not feedback; "Add a test that asserts the 401 path in auth.ts::handleLogin for expired tokens" is.
- Pre-rejections from the worker (FR-22) skip this stage entirely.

## Handoff

- Pass: status → `gate_check`, verdict record persisted (path, rubric scores, reasons).
- Fail: status → `in_progress`, revision notes appended, `revisionCount` incremented.
- Coordinator override of a soft-gate failure requires a DECISIONS.md entry.
