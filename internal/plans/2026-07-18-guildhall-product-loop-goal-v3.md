# Guildhall Release-Cycle Product Goal

This is the current product-validation goal for the Narrative Harness work.
It supersedes the earlier goals that treated "finish the Narrative Harness
MVP" as the primary objective. Narrative Harness is the proving project. The
product deliverable is Guildhall.

## Copy/paste goal

> Improve Guildhall until it can take one real project from visible source
> material to a bounded release, show the truth at the right level of detail,
> execute only that release, prove the result, close it, and then make later
> work active without corrupting the closed history.
>
> Use Narrative Harness as a demanding real-project validation fixture. From
> information already visible in Guildhall, establish an honest project shape,
> select or define one meaningful named release, and drive that release
> through intake, shaping, decomposition, delegated owner authorization,
> exact-scope Start/Resume, implementation, review, durable proof, release
> closure, and later-scope activation.
>
> Treat every wrong count, invented work item, ambiguous hierarchy, stale
> projection, unnecessary owner checkpoint, generic verification command,
> scope leak, contradictory surface, slow read, oversized history, or
> misleading action exposed by that cycle as a Guildhall product defect first.
> Fix the shared model, authority, write path, projection, workflow, read
> boundary, or UI component that owns the behavior; migrate affected state;
> remove obsolete competing machinery; add focused regression coverage; and
> replay the same release step. Do not make the test pass with
> project-specific task edits, read-time synthetic records, duplicate
> business rules, fallback decomposition, permanent compatibility branches,
> manual database edits, or copy that hides incorrect state.
>
> Releases are optional and may have arbitrary names. A project never becomes
> terminally complete; only a bounded release can close. Guildhall may reason
> about scope, sequencing, decomposition, and proof, but it may not approve an
> owner's decision, impersonate the owner, broaden the selected scope, or
> claim completion without durable evidence. Codex may perform explicitly
> delegated owner actions during this validation run; that authority is
> separate from what Guildhall itself may do automatically.
>
> Finish when the installed Guildhall product closes one honest, non-empty
> Narrative Harness release and proves the complete loop below. The result
> must be smaller, clearer, faster, and more truthful. Narrative Harness work
> not required to exercise this release remains later project scope.

## What this goal is testing

The release cycle is an integration test for Guildhall's core product job:

```text
visible sources
  -> honest project shape
  -> selected release
  -> executable work tree
  -> current proof
  -> release closure
  -> later-scope activation
```

There is one authoritative project-state model. Project Map, Overview, Work,
Release, Activity, Thread, task detail, API, and CLI are views and actions over
that model. They may offer different zoom levels, but they may not invent
different scope, counts, readiness, blockers, next actions, or completion.

## Release-cycle gates

### 1. Visible sources become an honest shape

Guildhall must show, from registered material visible in Guildhall:

- the project's purpose and audience when known;
- the capability chain or skeleton that gives the work meaning;
- the selected release and its source;
- later, deferred, unassigned, and unknown work; and
- which claims are documented, inferred, or still unknown.

Arbitrary prose, architecture nouns, transcript fragments, and scraped bullets
do not become executable work without a bounded user outcome, ownership,
scope, and proof expectation. Missing information becomes a small, legible
Guildhall action, not a scavenger hunt for the user.

**Pass:** a first-time user can explain what the project is, what the selected
release contains, what is later, and what remains unknown without opening every
task or reading an agent transcript.

### 2. Shape becomes a real release plan

The selected release contains stable work identities, honest titles,
parentage, source references, membership, status, and next actions. A release
is a membership boundary, not a hard-coded concept such as MVP, Product Shape,
or Closure.

Decomposition creates real child work and records the relationship. It does
not create a recommendation for work Guildhall is already required to do,
rewrite parent prose to hide a weak model, or blend every item into generic
Research / Implement / Verify tasks. A feature, task, or step may be split
again when the actual scope requires it.

**Pass:** the release has a legible tree, correct membership, correct count
semantics, and an executable next action after a cold restart. Later and
unassigned work is visible but cannot enter the run silently.

### 3. Authorized plan becomes exact execution

Planning judgment, brief/spec shaping, owner authorization, worker execution,
review, and proof are distinct states. Codex may perform the delegated owner
action for this run. Guildhall must not convert its own planning confidence
into owner approval.

Start and Resume consume only the selected release. A focused action may run
one selected item, while a release action may consume the selected release,
but neither may cross into later, deferred, or unassigned work. Every active
run has a durable current task, checkpoint, and next action.

**Pass:** the selected release can be started, paused, resumed, and restarted
without scope leakage, contradictory run state, or a user being asked to do
Guildhall's own reasoning work.

### 4. Execution becomes current, durable proof

Each included item has a concrete proof contract: a project-backed command,
artifact, browser check, or review result with an expected outcome. A generic
project build is not automatically proof for a script-only task. Worker prose,
checkboxes, transient transcripts, and stale projections are not completion
evidence.

A failed proof, missing proof, or worker with no durable progress remains
visible and actionable. It must not become an indefinite silent run or a false
human blocker when Guildhall can repair the planning or verification boundary.

**Pass:** deliberately invalidate one proof, see the same owning item and next
action everywhere, restore it with newer authoritative evidence, and see the
state clear after refresh and restart.

### 5. A release closes, then later scope works

A release closes only when every included item satisfies its current proof
contract. Closure is durable and visible. The project remains open.

After closure, assign or activate later work. The project becomes active for
that later scope without reopening, rewriting, duplicating, or changing the
closed release's identity, counts, history, or evidence.

**Pass:** one real release is closed, later scope is activated, and both truths
survive API, CLI, UI, and restart.

### 6. The product orients the user instantly

The 1,000-foot Project Map answers: what is this project, what is its skeleton,
which release is selected, how much work is in it, what is later, and where is
the work distributed by state?

The 100-foot Overview answers: what changed, what is happening now, what needs
attention, and what is the next useful action?

Work and task detail answer: what exactly can I do, why is it next, and where
is the proof?

All three views use shared summary/action data and shared layout components.
Buttons lead to the exact item they name. Stored titles are never cropped;
only their visual presentation may shorten them. Passive information is not
styled like an action, and cards do not create trapped whitespace or an
unreadable wall of metadata.

**Pass:** a first-time user can orient without a cognitive scavenger hunt, and
a tester can follow every primary action to the exact state it names on
desktop and mobile.

### 7. The underlying product is lean

Fleet and project-list reads use bounded saved summaries. They do not build
every project's task detail, inbox repair, thread projection, Git history, raw
transcript, or context-debug payload before rendering a card. Detail loads on
demand through the same authority boundary.

Durable history retains essential decisions, state transitions, proof
references, and next actions. Raw conversations and diagnostics are bounded
operational evidence, not permanent project-state payloads. Existing oversized
history is cleaned after the new retention boundary is live. A faster shell
over the same heavy model does not pass.

**Pass:** installed startup and fleet/detail reads meet the recorded budgets,
Narrative Harness state is materially smaller, and the same release truth
survives compaction and restart.

## Repair loop

For every failure that falsifies a gate:

1. Reproduce it through the installed route and authoritative API or CLI.
2. Record the user's job, disagreeing surfaces, and visible consequence.
3. Identify the single owning state, write path, projection, or component.
4. Record the contract/schema decision and migrate existing state if needed.
5. Delete or retire the competing path instead of adding another interpreter.
6. Add a focused regression and a cross-surface assertion.
7. Rebuild, install, restart, verify `/api/stale-server`, and replay the gate.

Defects outside these gates become later Guildhall work. They do not silently
expand the Narrative Harness release or create another parallel planning doc.

## Completion evidence

Claim success only when installed-app evidence demonstrates all of the
following:

- one source-backed, user-legible Narrative Harness release is selected;
- the selected scope is shaped, authorized by the delegated Codex operator,
  started, resumed, consumed, reviewed, proven, and closed;
- one deliberately introduced proof failure is surfaced and then cleared;
- later scope activates without corrupting the closed release;
- Map, Overview, Work, Release, Activity, Thread, task detail, API, and CLI
  agree on scope, counts, status, blockers, next action, proof, and closure;
- fleet reads, detail reads, retained history, desktop UI, and mobile UI meet
  their recorded budgets and checks; and
- focused regressions, contract/data-layer checks, build/install/restart, and
  freshness verification pass.

This is the finish line for the product-validation goal. It is not a claim
that Narrative Harness itself has no future work.
