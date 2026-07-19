# Release-Cycle Product Validation Goal

This replaces the earlier Narrative Harness completion goal. Narrative Harness
is the proving ground; it is not Guildhall's schema, its permanent backlog, or
the entire definition of product success.

## Copy/paste goal

> Make Guildhall trustworthy at the one job that matters most: taking a real
> project from visible source material to a bounded release, showing the truth
> clearly while the work is planned and executed, and preserving that truth
> when the release closes and later work begins.
>
> Use Narrative Harness as the first demanding validation project. Re-intake
> only from information already visible in Guildhall, shape one honest release
> or bounded scope, and take it through the complete cycle: source-backed
> orientation, capability and work planning, delegated approval, exact-scope
> Start/Resume, implementation and acceptance proof, review, release closure,
> and activation of later scope. The goal is to improve Guildhall through this
> cycle, not to pretend that a pile of NH tasks is the goal.
>
> Whenever the cycle exposes a wrong count, invented work, stale status,
> contradictory surface, unnecessary owner checkpoint, slow read, oversized
> history, or confusing action, treat it first as a Guildhall product or
> architecture defect. Find the shared authority that should own the behavior;
> fix that authority and its callers; migrate affected state; add a focused
> regression; and re-run the same release step. Do not make the validation pass
> with project-specific reshaping, read-time synthetic records, duplicate
> projections, permanent compatibility branches, manual database edits, or
> UI-only patches over incorrect state.
>
> Guildhall must remain flexible: releases are optional and may have arbitrary
> names; work can be assigned to a release later; a feature, task, or step may
> be decomposed again when the scope requires it; and a project never reaches a
> terminal "complete" state. Only a bounded release can close. Guildhall may
> reason about scope and schedule authorized work, but it may not approve the
> owner's decisions, broaden a selected scope, impersonate the owner, or claim
> completion without durable proof. Codex may perform those visible delegated
> owner actions during this validation.
>
> Finish only when the installed Guildhall product passes the release-cycle
> proof below. The deliverable is a smaller, clearer, more trustworthy
> Guildhall product whose state is easy to understand and whose release
> boundary is real. Narrative Harness is complete only to the extent needed to
> exercise the cycle and prove the product; its unimplemented future domain
> capabilities remain later project scope rather than hidden Guildhall work.

## Release-cycle proof

The same authoritative state must be visible through the API, CLI, project map,
overview, work, release, activity, and task detail. Each stage below is a gate,
not another parallel planning system:

1. **Source to shape**
   Registered visible sources produce a concise project purpose, capability
   chain, current/bounded scope, deferred scope, and source trails. Arbitrary
   prose bullets, transcript fragments, and architecture nouns do not become
   deliverables without reasoning. Guildhall asks only for information it
   cannot establish honestly.

2. **Shape to plan**
   The selected release or bounded scope contains real features and flexible
   work hierarchy. Every work item has an honest title, meaning, parentage,
   scope, status, and next action. Splitting creates actual child work and
   satisfies the parent's scope; it does not create phantom recommendations,
   fallback decompositions, or rewrite residue.

3. **Plan to authorized execution**
   Brief/spec approval is distinct from Guildhall's own planning judgment.
   Codex may provide the delegated approval during this run. Start and Resume
   consume exactly the selected release or bounded scope, leaving later and
   unassigned work alone.

4. **Execution to proof**
   Work advances through runnable, active, review, gate, and done states using
   durable implementation and acceptance evidence. Worker claims, checkboxes,
   transient transcripts, and stale projections are not completion proof. A
   failed gate remains visible until a newer authoritative pass settles it.

5. **Closure to later scope**
   The selected release closes only with durable proof. The project remains
   open. Adding or activating later scope reopens current project work without
   changing the closed release's history, counts, or evidence.

6. **Truth and orientation**
   The 1,000-foot project view shows the whole skeleton, scoped work, release
   membership, progress, deferred work, and current execution state. The
   closer overview shows what changed, what is happening now, what needs
   attention, and the next useful action. Detail views show the evidence needed
   to act. The user should not reconstruct these facts by scrolling through
   unrelated cards.

7. **Lean operation**
   Fleet reads load bounded summaries, not every project's task, thread, proof,
   inbox, and Git graph. Detail is on demand. Durable history keeps compact
   essential events and proof references; raw transcripts, context-debug
   payloads, and connection chatter are bounded operational evidence. Existing
   state is migrated and measured, and retired shapes are removed after the
   cutover.

## Completion criteria

The goal is complete only when all of the following are demonstrated against
the installed app, not inferred from source code:

- Narrative Harness has a source-backed, user-legible release or bounded scope.
- The selected scope can be approved, started, resumed, and consumed without
  leaking later or unassigned work.
- At least one real implementation path and one review/acceptance path reach
  release closure with durable proof.
- A deliberately introduced failure is visible, routes to the right next
  action, and clears everywhere after a newer passing proof.
- Later scope can be assigned or activated after closure without rewriting the
  closed release or manufacturing duplicate work.
- Map, Overview, Work, Release, Activity, task detail, CLI, and APIs agree on
  scope, counts, status, blockers, next action, and completion.
- A first-time user can identify the project skeleton, selected scope,
  progress, current activity, and next action from the appropriate first view.
- Fleet-read latency/payload and Narrative Harness history size are measured
  before and after; the result is materially bounded, not merely a faster
  wrapper around the same heavy model.
- Focused regressions, `pnpm lint:contracts`, `pnpm build`, installed-app
  restart proof, `/api/stale-server`, and desktop/mobile browser checks pass.

## Explicit boundaries

- NH's story-writing taxonomy is test data for Guildhall, not Guildhall's
  domain model.
- NH's future reviewers, genres, and drafting capabilities are not silently
  pulled into the current release just because they appear in source material.
- Releases are optional; "MVP" is not a universal Guildhall concept.
- Codex's delegated owner action is not Guildhall self-approval.
- A project is never terminally complete; release closure is the terminal event.
- Faster reads, prettier cards, or a renamed concept without a shared model
  change do not satisfy the goal.

## Defect protocol

For every release-cycle failure, record in `internal/audits/flow-audit.md`:

- the user's job and visible route;
- the authoritative state and the disagreeing surface;
- the shared owner of the behavior;
- the migration or cleanup for existing state;
- the focused regression and installed-app proof;
- the remaining risk, if any.

This keeps the validation loop pointed at Guildhall's product foundations
instead of turning Narrative Harness into an ever-growing excuse for more
special cases.
