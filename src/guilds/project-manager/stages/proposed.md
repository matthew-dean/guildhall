# Stage: `proposed`

An agent has put this task on the board (FR-21). It is waiting for promotion per lever `task_origination`. No worker should be building it yet.

## What "good" looks like

- **One sentence of outcome.** A proposing agent that cannot state the success condition in one sentence should not propose the task yet.
- **Parent goal set.** `parentGoalId` is populated and the proposal stays inside the parent goal's guardrails (FR-23). A free-floating proposal is an escalation signal, not a task.
- **Rationale names the trigger.** The proposing agent's `rationale` says *why now* — what log, what bug, what missing coverage made this worth proposing. Vague "this could be better" proposals feed rejection-dampening (FR-26) noise, not real work.
- **Duplicates checked.** Before writing the proposal, scan recent `shelved` and open proposals for shape-matches. Re-proposing a shape already rejected burns policy-version cycles.

## How this stage is evaluated

- Approver (human, coordinator, or auto — per `task_origination`) is judging *whether this belongs on the board*, not *how to build it*.
- A proposal that would route to `ready` under `agent_autonomous` must carry spec content sufficient for the governing `spec_completeness` lever — don't rely on a downstream agent to flesh it out if nothing triggers that.

## Handoff checklist

Before leaving a proposal:

- [ ] Summary ≤ 1 sentence, success condition explicit
- [ ] `parentGoalId` set; guardrails re-read
- [ ] Rationale cites the concrete trigger
- [ ] Shape-match scan done; not a known-rejected duplicate
- [ ] Suggested domain routing on the task, even if tentative
