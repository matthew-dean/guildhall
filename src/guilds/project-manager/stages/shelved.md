# Stage: `shelved` (terminal)

Task was pre-rejected by a worker (FR-22) or rejected at `spec_review`/`proposed`. Terminal. The task is off the active board but its shape is remembered for rejection-dampening (FR-26).

## What "good" looks like

- **Reason is structured, not freeform.** One of `no_op` / `not_viable` / `low_value` / `duplicate` / `spec_wrong` (worker pre-rejection) plus a one-line human-readable detail.
- **No `revisionCount` increment.** Pre-rejection is not a failed review.
- **Shape-match key recorded.** `(goalId, normalized summary, proposing agent role)` plus `policyVersion`. This is what `rejection_dampening` consumes.
- **`decision` log entry + `pre_rejection` wire event** emitted for observability (FR-22).

## How this stage is evaluated

- On orchestrator startup, rejections whose `policyVersion` differs from current are re-evaluated (FR-26). Resurrected tasks return to `proposed`.
- Under `pre_rejection_policy: requeue_lower_priority`, the task comes back at lower priority instead of shelving — this stage is skipped.

## What NOT to do

- Do not re-propose a shelved shape without a `policyVersion` bump. The dampening system will suppress it, and the noise wastes cycles.
