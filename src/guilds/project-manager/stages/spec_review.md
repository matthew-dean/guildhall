# Stage: `spec_review`

The spec is drafted. Approval routing follows lever `task_origination` (human / coordinator / auto). The approver is judging *readiness to build*, not *quality of the final result*.

## What "good" looks like

- **Re-read the spec against acceptance criteria, not prose.** If the criteria are not individually verifiable, send it back — do not approve and hope.
- **Check envelope fit.** The task's `parentGoalId` must be populated and the proposed work must not punch through that goal's guardrails (FR-23). `business_envelope_strictness: strict` forces rejection; `advisory` means approver warns + proceeds; `off` skips.
- **Confirm `spec_completeness` is satisfied.** `full_upfront` demands summary + ACs + out-of-scope + tools + complexity *now*. `stage_appropriate` demands summary + ACs only. `emergent` demands just enough for the next agent.
- **Say no clearly.** Rejection produces a concrete reason persisted on the task; it feeds rejection-dampening (FR-26). Vague rejections teach nothing.

## How this stage is evaluated

- Approved specs transition to `ready` and enter the dispatch queue.
- Rejected specs either return to `exploring` (with notes) or are shelved with reason.
- Approval/rejection is persisted as a verdict record with `policyVersion`, so later policy changes can trigger re-evaluation.

## Handoff

- Approval: set status → `ready`, log a progress entry naming the approver.
- Rejection: set status → `exploring` or `shelved`, write the reason on the task, log an escalation entry if human review is needed.
