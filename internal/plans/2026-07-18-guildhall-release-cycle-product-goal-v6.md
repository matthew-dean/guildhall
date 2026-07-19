# Guildhall Product Goal: Prove One Release Loop

This replaces the earlier Narrative Harness completion goals. Narrative
Harness is the first real project used to validate Guildhall; it is not the
definition of Guildhall's product scope.

## Copy/paste goal

> Make Guildhall a clear, lean, trustworthy planning and release-execution
> product by taking one real project through one complete release loop.
>
> Use Narrative Harness as the proving project. From information visible in
> Guildhall, establish an honest project shape, select or define one
> meaningful release or bounded scope, and show exactly what belongs in it and
> what is later. Take that exact scope through planning, delegated owner
> authorization, Start/Resume, implementation, review, durable proof, and
> release closure. Then activate later work and prove that the earlier release
> remains closed, unchanged, and findable.
>
> Treat every failure in this loop as a Guildhall defect first: wrong scope,
> invented work, bad decomposition, contradictory status, stale projection,
> unnecessary owner checkpoint, generic proof, scope leak, slow read, oversized
> history, silent stall, or confusing action. Repair the owning model, write
> path, projection, workflow, read boundary, or shared UI component; migrate
> affected state; remove competing machinery; add a focused regression; and
> replay the same step. Do not make the proving project fit a bug, manufacture
> records during reads, duplicate business rules, preserve fallback behavior,
> or hide uncertainty in copy.
>
> Releases are optional and may have arbitrary names. A project never becomes
> terminally complete; only a bounded release can close. Guildhall may reason
> about scope, sequencing, decomposition, and proof, but it may not approve an
> owner's decision, impersonate the owner, broaden a selected scope, or claim
> completion without current durable evidence. Codex may perform explicitly
> delegated owner actions during this validation; that is separate from what
> Guildhall itself is allowed to automate.
>
> Finish when the installed Guildhall product passes the release-loop gates
> below. The result should be a smaller, faster, more understandable product.
> Narrative Harness work that is not needed to exercise these gates remains
> later project scope rather than becoming accidental Guildhall scope.

## What this proves

The product must support one loop over one authoritative project-state model:

```text
visible sources
  -> project shape
  -> selected release or bounded scope
  -> executable work
  -> current proof
  -> release closure
  -> later-scope activation
```

Map, Overview, Work, Release, Activity, Thread, task detail, API, and CLI are
views or actions over that model. They may provide different zoom levels, but
they must not invent different scope, counts, readiness, blockers, next
actions, proof, or completion states.

## Finite release-loop gates

1. **Orient:** A new user can identify the project's purpose, capability chain,
   active release, later work, unknowns, and source trail without opening every
   task. Guildhall asks only for facts it cannot establish honestly.
2. **Bound:** The selected release has stable, complete work identities,
   hierarchy, membership, status, ownership, next action, and proof contracts.
   Deferred or unassigned work is visible and cannot enter execution silently.
3. **Authorize:** Brief/spec approval remains an explicit owner action. Codex
   may carry out that delegated action for this run. Guildhall's confidence is
   not owner approval.
4. **Execute:** Start and Resume consume only the selected release or bounded
   scope. Every run has one durable current item, checkpoint, next action, and
   bounded context. A stall is an honest actionable state.
5. **Prove:** Included work closes only with current project-backed evidence.
   Worker claims, checkboxes, generic commands, stale projections, and raw
   transcripts do not count as proof.
6. **Close:** The release becomes complete only when all included work and its
   proof are complete. The project remains open.
7. **Continue:** Activating later scope changes the active work without
   reopening, rewriting, duplicating, or changing the counts and evidence of
   the closed release.
8. **Communicate:** API, CLI, installed UI, and a cold restart agree on the
   same state. The 1,000-foot view explains the whole bounded shape; the
   100-foot view explains what is happening now; detail views explain proof.
9. **Stay lean:** Fleet reads use saved bounded summaries, detail is on demand,
   and raw transcripts/debug payloads are bounded operational evidence rather
   than permanent project state.

## How to work the goal

At each gate, record the user's job, reproduce the behavior in the installed
route and authoritative API/CLI, identify the single owner of the fact, repair
that owner, test the cross-surface contract, rebuild/install/restart, and replay
the gate. A problem that does not prevent this finite loop becomes later
Guildhall work; it does not expand the proving release indefinitely.

The validation must include one deliberate proof failure and recovery, one
pause/resume, one restart, and one later-scope activation. The release is not
considered proven until those cases agree across API, CLI, UI, and restart.

## Explicit non-goals

- Completing every future Narrative Harness capability.
- Making releases mandatory or imposing universal names such as MVP.
- Adding another parallel spine, map, task tree, closure model, or summary
  ledger.
- Letting Guildhall impersonate the owner or manufacture approval.
- Keeping compatibility or fallback machinery merely to preserve bad shapes.
