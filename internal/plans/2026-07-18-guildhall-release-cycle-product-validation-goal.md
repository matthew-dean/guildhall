# Guildhall Product Validation Goal: One Trustworthy Release Cycle

This replaces the earlier Narrative Harness completion objective. Narrative
Harness is the proving project and release-cycle fixture. It is not the
product deliverable, Guildhall's schema, or an invitation to grow an
unbounded project backlog.

## Copy/paste goal

> Make Guildhall a lean, coherent, trustworthy planning and release-execution
> product by proving its core job through one real release cycle.
>
> Use Narrative Harness as the demanding validation project. Establish one
> source-backed release or bounded scope from information visible in Guildhall,
> show the user its shape and current truth, take that exact scope through
> planning, authorized execution, durable proof, and closure, then activate a
> later scope without changing the meaning of the closed work.
>
> Before advancing the cycle, repair the Guildhall product failures it
> exposes. A wrong count, invented deliverable, ambiguous hierarchy, stale
> projection, unnecessary owner checkpoint, generic proof command, scope leak,
> contradictory surface, slow read, oversized history, or misleading action
> is first treated as a shared Guildhall model, authority, workflow, read
> boundary, or design-system defect. Fix the owning layer, migrate affected
> state, remove obsolete parallel machinery, add a regression, and replay the
> same release step. Do not pass the test with project-specific edits,
> read-time synthetic records, duplicate business rules, fallback
> decomposition, permanent compatibility readers, manual database edits, or
> copy that hides uncertainty.
>
> Releases are optional and may have arbitrary names. A project never becomes
> terminally complete; only a bounded release or scope can close. Work may be
> assigned to a release later, and any work item may be decomposed again when
> its actual scope requires it. Guildhall may reason about scope, sequencing,
> decomposition, and proof work, but it may not self-approve an owner decision,
> impersonate the owner, broaden the selected scope, or claim completion
> without durable evidence. Codex may perform explicitly delegated owner
> actions during this validation run; that authority is separate from what
> Guildhall itself is allowed to do.
>
> Finish when the installed Guildhall product passes the finite acceptance
> gates below. The outcome is a smaller, clearer, faster, more truthful
> Guildhall product. Narrative Harness only needs the source-backed work
> required to exercise those gates; unrelated future project capabilities stay
> later scope.

## What is being validated

This is one product loop over one authoritative project-state model:

```text
visible sources
  -> honest project shape
  -> selected release or bounded scope
  -> executable work
  -> current proof
  -> release closure
  -> later-scope activation
```

Map, Overview, Work, Release, Activity, task detail, API, and CLI are views or
actions over that model. They must not independently invent scope, readiness,
progress, blockers, next actions, or completion.

## Finite acceptance gates

### Gate 0: Baseline and authority

- Record the current installed-app behavior, fleet-read latency, payload size,
  Narrative Harness state size, and retained-history size.
- Inventory the authoritative write path, saved summary path, detail path, and
  any competing read-time reconstruction or compatibility machinery.
- Name the persisted contracts touched by the work and record contract/schema
  migration decisions before changing them.
- Define one explicit owner for each shared concept: project shape, scope,
  release membership, task state, proof, next action, summary, and history.

Pass condition: we can point to where each fact is written, where its compact
summary is read, and what evidence would prove the read is fresh. If we cannot,
repair the data boundary before doing more feature work.

### Gate 1: Source becomes honest shape

- Guildhall shows purpose, audience when known, capability chain, source trail,
  current/bounded scope, deferred scope, progress, and unresolved questions.
- The UI distinguishes documented facts, Guildhall inferences, and unknowns.
- Imperative-looking prose, transcript fragments, architecture nouns, and
  arbitrary bullets do not become deliverables without bounded meaning.
- Missing information becomes a small, understandable Guildhall action rather
  than a scavenger hunt for the user.

Pass condition: a first-time user can explain what the project is, what is in
the selected scope, what is later, and what remains unknown from the project
view without reading raw documents or opening every task.

### Gate 2: Shape becomes a bounded release plan

- Work has stable identity, honest title, kind, parentage, source references,
  scope, status, and next action.
- Releases are membership boundaries, not hard-coded concepts such as MVP,
  Product Shape, or Closure. No release is manufactured merely because a
  project has work.
- Decomposition creates real child work and records the relationship. A parent
  is complete with respect to that split when its required children satisfy the
  parent contract; it does not need stale recommendations or rewritten prose.
- Later and unassigned work is visible but cannot enter the selected run
  silently.

Pass condition: the selected release or bounded scope has a legible tree,
correct membership, correct counts, and a runnable next action, all surviving
restart through the same saved state.

### Gate 3: Authorized plan becomes exact execution

- Brief/spec shaping, Guildhall planning judgment, owner authorization, and
  worker execution remain distinct states.
- Codex may perform the delegated owner action for this run. Guildhall does not
  treat its own confidence as owner approval.
- Start and Resume consume only the selected release or bounded scope.
- Missing proof setup, missing context, undersized work, and similar planning
  gaps become bounded Guildhall work that can be advanced; they are not falsely
  presented as human blockers when no external access is required.
- A worker cannot run without a usable blueprint, bounded context, and a
  concrete next action.

Pass condition: a run can be started, paused, resumed, and restarted without
  crossing the release boundary or requiring the user to perform Guildhall's
  own reasoning work.

### Gate 4: Execution becomes durable proof

- Implementation, review, acceptance, and release readiness remain distinct.
- Every completion claim points to a current proof contract: a concrete
  project-backed command, artifact, browser check, or review evidence with an
  expected result.
- Generic commands such as bare `pnpm test` are setup work, not proof.
- A stale or failed proof is visible, actionable, and remains unresolved until
  newer authoritative evidence settles it.
- Evidence is compact and durable. Raw transcripts are not completion proof.

Pass condition: deliberately invalidate one completion proof, observe the same
blocker and next action on every surface, record passing evidence, and observe
the blocker clear everywhere after refresh/restart.

### Gate 5: Closure and later scope are real

- A selected release closes only when every included item satisfies its current
  proof contract and the closure is durable.
- The project remains open after release closure.
- Assigning or activating later work does not reopen, rewrite, duplicate, or
  alter the completed release's identity, history, counts, or evidence.
- Switching the selected release changes execution boundaries and summaries
  without changing historical release truth.

Pass condition: one release is closed, a later scope is activated, and both
states remain correct through API, CLI, UI, and restart.

### Gate 6: The product communicates the truth at the right zoom

- The 1,000-foot project view shows the skeleton: purpose, capability shape,
  selected release/scope, all scoped work, deferred work, progress, and state
  distribution.
- The 100-foot overview shows the current situation: what changed, what is
  happening now, what needs attention, and the next useful action.
- Work and task detail explain why an item is next, what it needs, and where
  proof lives.
- Buttons lead to the exact item they name. Stored titles are never cropped;
  only visual presentation may shorten them.
- The views use shared layout and data components, preserve readable text on
  desktop/mobile, and avoid passive card clutter, trapped whitespace, and
  ambiguous selected-looking treatments.

Pass condition: a first-time user can orient without a cognitive scavenger
hunt, and a tester can follow every primary action to the exact state it names.

### Gate 7: The product is lean enough to trust

- Fleet/project-list reads use bounded saved summaries and do not build every
  project's task detail, inbox repair, thread projection, Git Story, or raw
  diagnostics before rendering cards.
- Detail is loaded on demand. Every read uses the same authoritative state
  boundary rather than manufacturing synthetic records.
- Durable history retains essential facts, decisions, evidence references, and
  next actions. Raw transcripts, context-debug payloads, connection chatter,
  and duplicate ledgers are bounded operational evidence and are cleaned from
  existing state after the new retention boundary is in place.
- Startup latency, payload size, state size, and history size are measured
  before and after. A faster shell over the same heavy model does not pass.

Pass condition: installed startup and fleet reads meet the recorded budget, the
Narrative Harness data is materially smaller, and API/CLI/UI state still agree
after compaction and restart.

## Repair loop

For every escaped failure:

1. Reproduce it through the installed app and the authoritative API or CLI.
2. Record the user job, route, disagreeing surface, and visible consequence.
3. Identify the single owning state, write, projection, or component boundary.
4. Record contract/schema decisions and migrate existing data when needed.
5. Simplify or delete the old path; do not add a second interpretation.
6. Add a focused test and a cross-surface regression.
7. Rebuild, install, restart, verify `/api/stale-server`, and replay the same
   gate.

## Completion evidence

Claim success only when the installed product demonstrates all of the following:

- One source-backed Narrative Harness release or bounded scope is legible to a
  first-time user.
- The selected scope is shaped, authorized by the delegated Codex operator,
  started, resumed, consumed, proven, and closed without later-scope leakage.
- One deliberately introduced proof failure is correctly surfaced and clears
  after the right evidence is recorded.
- Later scope activates without corrupting the closed release.
- Map, Overview, Work, Release, Activity, task detail, API, and CLI agree on
  scope, counts, status, blockers, next action, and completion.
- Fleet and project reads use the lean authoritative model and compact history.
- Focused regressions, contract/data-layer checks, build/install/restart,
  stale-server verification, API/CLI checks, and desktop/mobile checks pass.

## Explicit stop rule

This goal is finite. Stop after the completion evidence passes and record any
unrelated product opportunities as later work. Stop early only for a genuine
external access requirement, such as a credential or login Codex cannot
perform. Missing proof, bad decomposition, stale state, contradictory UI, slow
reads, malformed current data, and unclear Guildhall behavior are product work
inside this goal, not blockers to hand back to the user.
