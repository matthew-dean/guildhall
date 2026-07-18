# Release-Cycle Product Validation Goal v2

This is the replacement goal for the earlier Narrative Harness completion
objective. Narrative Harness is the proving ground for Guildhall; finishing
NH is not, by itself, the product goal.

## Copy/paste goal

> Make Guildhall trustworthy at the complete release-cycle job: take a real
> project from information already visible in Guildhall to one honest,
> bounded release; show the plan and its current truth clearly; execute only
> that release; prove the work; close the release; and support later scope
> without corrupting what was already closed.
>
> Use Narrative Harness as the validation project. Re-intake only from its
> registered, visible sources. Shape one release or bounded scope, then drive
> it through the whole cycle: orientation, capability and work planning,
> delegated approval, exact-scope Start/Resume, implementation, review,
> durable proof, release closure, and later-scope activation. Treat the NH
> release as a test fixture for Guildhall's product quality, not as a reason
> to grow an unbounded NH backlog.
>
> Whenever this cycle exposes invented work, a wrong count, stale or
> contradictory state, an unnecessary owner checkpoint, a confusing action,
> a slow or oversized read, or evidence that cannot survive a restart, fix the
> shared Guildhall authority, model, projection, workflow, or UI component
> that owns the behavior. Migrate affected state, remove obsolete machinery,
> add a focused regression, and repeat the same release step. Do not pass the
> test with project-specific task edits, read-time synthetic records,
> duplicate business logic, permanent compatibility branches, manual
> database edits, or UI copy that hides incorrect state.
>
> Releases are optional and may have arbitrary names. Work may be assigned to
> a release later, and any work item may be decomposed again when its actual
> scope requires it. A project never becomes terminally complete; only a
> bounded release closes. Guildhall may reason about scope and schedule work,
> but it may not approve the owner's decisions, impersonate the owner,
> broaden the selected scope, or claim completion without durable proof.
> Codex may perform explicitly delegated owner actions during this validation
> run; that is separate from Guildhall self-approval.
>
> Finish when the installed Guildhall product passes the release-cycle proof
> below. The deliverable is a clearer, smaller, more truthful Guildhall
> product. Narrative Harness only needs the real capabilities required to
> exercise this cycle; unimplemented future NH capabilities remain later
> project scope.

## Release-cycle proof

The same authoritative state must be observable through the API, CLI, project
map, overview, work, release, activity, and task detail. Each item is a
behavioral gate, not a new planning system:

1. **Visible source to honest shape**
   Guildhall produces a concise purpose, audience, capability chain, current
   scope, deferred scope, and source trail from visible registered material.
   Arbitrary prose, transcript fragments, and architecture nouns do not
   become deliverables without reasoning. Guildhall asks only for facts it
   cannot establish honestly.

2. **Shape to release plan**
   The selected release contains real work with stable identity, parentage,
   scope, status, and next action. Splitting creates actual child work and
   satisfies the parent's scope; it does not create phantom recommendations,
   fallback decomposition, or rewrite residue.

3. **Authorized plan to exact execution**
   Brief/spec approval remains distinct from Guildhall's planning judgment.
   Codex may provide the delegated owner action for this run. Start and
   Resume consume exactly the selected release or bounded scope and leave
   later and unassigned work alone.

4. **Execution to durable proof**
   Work advances through runnable, active, review, gate, and done states using
   durable implementation and acceptance evidence. Worker claims, checkboxes,
   transient transcripts, and stale projections are not completion proof.

5. **Closure to later scope**
   A release closes only with durable proof. The project remains open. Adding
   or activating later scope makes current work active again without changing
   the closed release's identity, history, counts, or evidence.

6. **Truth at the right zoom**
   The project map shows the skeleton, release membership, scoped and deferred
   work, progress, and current execution state. Overview shows what changed,
   what is happening now, what needs attention, and the next useful action.
   Detail views show the evidence needed to act. The user should not have to
   reconstruct these facts from unrelated cards or a transcript.

7. **Lean operation**
   Fleet reads load bounded summaries, not every project's tasks, thread,
   proof, inbox, and Git graph. Detail is on demand. Durable history keeps
   compact essential events and proof references; raw transcripts,
   context-debug payloads, and connection chatter remain bounded operational
   evidence. Existing state is migrated and measured, and retired shapes are
   removed after cutover.

## Completion criteria

Claim success only after installed-app proof demonstrates all of these:

- Narrative Harness has a source-backed, user-legible selected release.
- The selected scope can be approved, started, resumed, and consumed without
  leaking later or unassigned work.
- At least one implementation path and one review/acceptance path reach
  release closure with durable proof.
- A deliberately introduced failure is visible, points to the right next
  action, and clears everywhere after newer passing proof.
- Later scope can be assigned or activated without rewriting the closed
  release or manufacturing duplicate work.
- Map, Overview, Work, Release, Activity, task detail, CLI, and APIs agree on
  scope, counts, status, blockers, next action, and completion.
- A first-time user can identify the project skeleton, selected scope,
  progress, current activity, and next action from the appropriate first view.
- Fleet-read latency/payload and NH history size are measured before and after;
  the result is materially bounded, not merely a faster wrapper around the
  same heavy model.
- Focused regressions, contract checks, build/install/restart proof,
  `/api/stale-server`, and desktop/mobile browser checks pass.

## Non-negotiable boundaries

- NH's story taxonomy is validation data, not Guildhall's domain model.
- "MVP" is not a universal Guildhall concept; releases and bounded scopes are
  the general model.
- Codex's delegated owner action is not Guildhall self-approval.
- A faster read, prettier card, renamed concept, or project-specific patch is
  not a product fix without a shared model/authority improvement and proof.
- The cycle is complete only when the installed product communicates the
  result; source access alone is not evidence of success.
