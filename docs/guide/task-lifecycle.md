---
title: Task lifecycle
help_topic: guide.task_lifecycle
help_summary: |
  Tasks move through eight statuses: proposed → exploring → spec_review →
  ready → in_progress → review → gate_check → done. Terminal states are
  done, shelved, and blocked.
---

# Task lifecycle

Every active task in `./.guildhall/TASKS.json` has a `status` field that tracks
where it sits in the build pipeline. Statuses are enumerated in
`./src/core/task.ts` as `TaskStatus`.

The construction model is the friendly mental model; the status is the runtime
state. A task moves from idea, to blueprint, to worker slot, to trade work, to
inspection, to hard gates, to done.

## The eight statuses

| Status | Meaning | Who advances it |
|---|---|---|
| `proposed` | Raw ask, not yet surveyed or framed. | Coordinator evaluates; may promote to `exploring` or drop. |
| `exploring` | Site-survey and blueprint work: the spec agent gathers missing facts and questions. | User or spec agent promotes to `spec_review`. |
| `spec_review` | Blueprint is drafted; waiting for coordinator sign-off. | Coordinator approves → `ready`, or requests revision. |
| `ready` | Blueprint is approved and the task is waiting for a worker slot. | Coordinator dispatches -> `in_progress`. |
| `in_progress` | Trade work: a worker agent is implementing against the accepted blueprint. | Worker finishes → `review`, proposes a change order, or hits a blocker → `blocked`. |
| `review` | Inspection: one or more reviewers evaluate the work against the blueprint and project standards. | All reviewers pass → `gate_check`; any reviewer rejects → `in_progress` (revision) or `blocked`. |
| `gate_check` | Deterministic hard gates run (lint, typecheck, tests, custom). | All gates pass → `done`; any fail → `in_progress`. |
| `done` | Successful completion. Accepted work lands per `landing_strategy`. | Terminal. |

Terminal states:

- `done` — success.
- `shelved` — explicitly parked (user action or pre-rejection policy).
- `blocked` — max revisions exceeded or unresolvable blocker raised.

When a task reaches a terminal state, Guildhall seals it. The active queue stays
small, a compact durable task record lands under `./.guildhall/tasks/archive/`,
and full evidence such as notes, review verdicts, adjudications, gate history,
and issue details moves to local history under `~/.guildhall/data/projects/`.

## Git closure after done

`done` means the task passed its workflow. It does not automatically mean the
Git story is closed.

After work completes, Guildhall inspects the project or task worktree and shows
whether changes are dirty, committed only locally, missing an upstream, pushed,
in an open PR, merged, local-only, deferred, conflicted, or unknown. Current
work closure blocks on unresolved Git stories so a task cannot silently look
finished while its branch is still wandering around with a backpack.

Closure actions are controlled by the project's Git Story policy. Guildhall may
commit, push, or open a PR only when that policy allows it. The default is to
ask; if the project policy says `commit: auto`, completed task work can be
auto-committed with a Commit Story message. Local-only and deferred closures
need a reason so intentional leftovers do not look like forgotten ones.

See [Git Story Closure](./git-story-closure).

## Stage-appropriate spec fidelity

The [`spec_completeness`](../levers/spec-completeness) lever controls how complete a spec must be at each stage:

- `full_upfront` — spec must be complete before leaving `exploring`.
- `stage_appropriate` (default) — acceptance criteria by `ready`, test plan by `review`, etc.
- `emergent` — high tolerance for incomplete specs; coordinator fills gaps mid-task.

Even in `emergent` mode, progress leaves durable evidence. A transcript line
that says the agent will write the blueprint later is not enough, and raw
transcripts are not the committed project contract.

## Task size and splitting

Before a shaped task becomes normal worker fuel, Guildhall can estimate whether
it is a sane unit of work. It looks for multiple outcomes, too many surfaces,
cross-domain risk, migrations or release behavior, unclear checks, and other
signals that one task is doing the job of several.

Small work proceeds. Medium work can proceed with a warning. Large work gets
split recommendations. Epic work becomes containing work with linked child
tasks, so each worker pass and review stays understandable.

Containment is stored as explicit hierarchy links. It is not a task status.
If Guildhall opens an older project where hierarchy or task questions still use
legacy state, it asks you to apply the required migration before normal work
continues. That keeps the queue honest: runnable tasks are runnable, containing
work contains, and owner-input decisions live in their linked Thread sessions.

## Reframe before work starts

Reframe is for tasks whose shape is wrong before implementation has really
begun: stale imported notes, confusing wording, duplicate questions, or a broad
ask that belongs as a clearer spec or parent feature.

Once a task is in `in_progress`, `review`, or `gate_check`, Guildhall keeps the
work trace intact. At that point the safer move is a change order, follow-up,
pause, or normal revision path, not wiping the task back to intake.

## Revisions

When a reviewer rejects, the task returns to `in_progress` with the review
verdict attached. A revision counter increments. When it hits
[`max_revisions`](../levers/max-revisions), the task is marked `blocked` and
lands in the inbox with the reason it needs attention.

If review discovers that the plan itself was wrong, the next step is a change
order: what assumption changed, what evidence caused the change, and how scope
or sequencing changes.

## Review risk and required evidence

0.9 adds a review-risk profile to shaped work. Guildhall plans review lanes
from the task, changed files, priority, and project settings, then records the
recipes and evidence that should exist before reviewers accept the result.

For user-facing UI work, that can mean visual evidence. For API or migration
work, it can mean a contract or state-diff artifact. For release work, it can
mean rollout or smoke evidence. The goal is not to make every task heavy. It is
to make the amount of review match the risk, and to stop a task from reaching
done when the needed proof never existed.

Escaped misses become calibration records. If a reviewer missed something a
person later caught, Guildhall can turn that miss into a case for future review
recipes instead of treating it as a one-off embarrassment.

## Pre-rejection

A *pre-rejection* fires before work starts — e.g. a scope issue flagged at `spec_review`. The [`pre_rejection_policy`](../levers/pre-rejection-policy) lever controls what happens: terminal shelving, re-queueing with lower priority, or re-queueing with [rejection dampening](../levers/rejection-dampening).
