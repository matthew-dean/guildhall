# Guildhall Release-Cycle Product Goal v4

This supersedes the earlier goals that treated "finish the Narrative Harness
MVP" as the product objective. Narrative Harness is the proving project. The
deliverable is a trustworthy Guildhall product.

## Copy/paste goal

> Make Guildhall trustworthy at its complete planning-to-release job: take one
> real project from information visible in Guildhall to one honest, bounded
> release; show the user what the project is, what that release contains, what
> is happening, and what is proven; execute only that release; close it with
> durable evidence; and activate later work without changing the truth of what
> was already closed.
>
> Use Narrative Harness as the demanding validation project. Re-intake only
> from its registered, visible sources. Establish one source-backed project
> shape, select or define one meaningful release or bounded scope, and drive
> that scope through orientation, planning, decomposition, delegated owner
> authorization, exact-scope Start/Resume, implementation, review, proof,
> release closure, and later-scope activation.
>
> Before advancing each stage, fix the Guildhall failure it exposes. Wrong
> counts, invented work, ambiguous hierarchy, stale projections, unnecessary
> owner checkpoints, generic proof, scope leaks, contradictory screens, slow
> reads, oversized history, silent stalls, and misleading actions are Guildhall
> product defects first. Repair the owning model, authority, write path,
> projection, workflow, read boundary, or shared UI component; migrate affected
> state; remove the competing path; add focused regression coverage; and replay
> the same stage. Do not pass by editing Narrative Harness tasks to fit the
> bug, manufacturing records on read, duplicating business rules, retaining
> permanent compatibility machinery, manually editing the database, or hiding
> uncertainty in copy.
>
> Releases are optional and may have arbitrary names. A project never becomes
> terminally complete; only a bounded release or scope can close. Guildhall
> may reason about scope, sequencing, decomposition, and proof, but it may not
> self-approve an owner decision, impersonate the owner, broaden the selected
> scope, or claim completion without current durable evidence. Codex may perform
> explicitly delegated owner actions during this validation run; that is
> separate from what Guildhall itself is allowed to do.
>
> Finish when the installed Guildhall product closes one honest, non-empty
> Narrative Harness release and passes the finite acceptance gates below. The
> result must be smaller, clearer, faster, and more truthful. NH work that is
> not required to exercise these gates remains later project scope.

## Product contract being proven

This is one loop over one authoritative project-state model:

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
views and actions over that model. They may provide different zoom levels, but
they may not invent different scope, counts, readiness, blockers, next actions,
or completion states.

Before release work advances, Guildhall must be able to name the single
authority for each of these facts:

- project purpose, audience, capability shape, and source claims;
- release membership and deferred or unassigned scope;
- task identity, hierarchy, status, and current action;
- proof contracts and review evidence;
- compact summaries, activity/history, and retained operational evidence.

If a fact has multiple write paths or read-time interpretations, that is a
failed product gate. Consolidate the authority before polishing the surface.

## Finite acceptance gates

### 0. Baseline and data boundary

Record installed startup time, fleet-summary latency and payload, detail-read
latency and payload, NH project-state size, and retained-history size. Trace
where each shared fact is written, summarized, and loaded. Identify duplicate
ledgers, synthetic read-time records, raw transcript retention, context-debug
retention, and compatibility readers that still affect current behavior.

**Pass:** a cold read can load bounded summaries without building every
project's tasks, inbox, thread, Git history, proof, or diagnostics. Detail is
on demand, and the same authoritative state powers every read.

### 1. Visible sources become an honest shape

Guildhall shows purpose and audience when known, a capability chain, source
trail, selected scope, later/deferred/unassigned work, progress, and unknowns.
Documented facts, inferences, and gaps are distinguishable. Arbitrary prose,
architecture nouns, transcript fragments, and scraped bullets do not become
executable work without bounded meaning, scope, ownership, and expected proof.

**Pass:** a first-time user can explain what the project is, what this release
contains, what is later, and what is unknown without reading raw documents or
opening every task.

### 2. Shape becomes a real release plan

The selected release has stable work identities, honest untruncated titles,
parentage, source references, membership, status, and next actions. Releases
are membership boundaries, not hard-coded concepts such as MVP, Product Shape,
or Closure.

Decomposition creates real child work and records the relationship. A parent
does not need stale recommendations or rewritten prose to appear correct. Any
work item may be split again when its actual scope requires it, including a
step that needs smaller steps.

**Pass:** the selected release has a legible executable tree and correct
counts; later and unassigned work is visible but cannot enter the run silently.

### 3. Authorized plan becomes exact execution

Planning judgment, brief/spec shaping, delegated owner authorization, worker
execution, review, and proof remain distinct. Codex may perform the explicitly
delegated owner action in this validation. Guildhall may not convert its own
confidence into approval.

Start and Resume consume only the selected release or bounded scope. Every
active run has a durable current task, checkpoint, next action, and bounded
worker context. A worker that cannot progress reaches a visible terminal or
recoverable state with a reason and action; it does not remain silently active.

**Pass:** the selected scope starts, pauses, resumes, and restarts without
scope leakage, contradictory run state, or user work that Guildhall itself can
reason about.

### 4. Execution becomes current durable proof

Every included item has a concrete project-backed proof contract: command,
artifact, browser check, or review result with an expected outcome. A generic
build is not proof for a script-only task. Worker prose, checkboxes, transient
transcripts, and stale projections are not completion evidence.

**Pass:** deliberately invalidate one proof, see one owning item and next
action across every surface, record newer passing evidence, and see the state
clear after refresh and restart.

### 5. A release closes, then later scope works

A release closes only when every included item satisfies its current proof
contract. Closure is durable and visible. The project remains open. Assigning
or activating later work makes that scope active without reopening, rewriting,
duplicating, or changing the closed release's identity, counts, history, or
evidence.

**Pass:** one release closes, later scope is activated, and both truths survive
API, CLI, UI, and restart.

### 6. The product communicates the truth at the right zoom

The 1,000-foot Project Map shows the skeleton, selected release/scope, all
scoped and deferred work, progress, and state distribution. The 100-foot
Overview shows what changed, what is happening now, what needs attention, and
the next useful action. Work and task detail show why an item is next and where
its proof lives.

All surfaces use shared summary/action data and shared layout components.
Buttons lead to the exact item they name. Stored titles are never cropped;
only visual presentation may shorten them. Passive information is not styled
like an action, and desktop/mobile layouts remain readable without trapped
whitespace or metadata walls.

**Pass:** a first-time user can orient without a cognitive scavenger hunt, and
a tester can follow every primary action to the exact state it names.

### 7. The product is lean enough to trust

Fleet reads use bounded saved summaries. Raw transcripts, context-debug bodies,
connection chatter, and duplicate event payloads are bounded operational
evidence, not permanent project-state data. Existing oversized state is
cleaned after the retention boundary is live. Detail reads load only the
requested detail through the same authority boundary.

**Pass:** installed startup, fleet reads, detail reads, NH state size, and
retained history meet recorded budgets, and the same release truth survives
compaction and restart.

## Repair loop

For every failed gate:

1. Reproduce it through the installed route and authoritative API or CLI.
2. Record the user's job, visible consequence, and disagreeing surfaces.
3. Identify the single owning state, write path, projection, or component.
4. Record contract/schema decisions and migrate existing state if needed.
5. Delete or retire the competing path instead of adding another interpreter.
6. Add a focused regression and cross-surface assertion.
7. Build, install, restart, verify `/api/stale-server`, and replay the gate.

Failures that do not block this finite cycle become later Guildhall work. They
do not silently expand the NH release or create another parallel planning
system.

## Completion evidence

Claim success only when installed-app evidence demonstrates:

- one source-backed, user-legible NH release is selected;
- the selected scope is shaped, authorized by delegated Codex action, started,
  resumed, consumed, reviewed, proven, and closed;
- one deliberately introduced proof failure is surfaced and then cleared;
- later scope activates without corrupting the closed release;
- Map, Overview, Work, Release, Activity, Thread, task detail, API, and CLI
  agree on scope, counts, status, blockers, next action, proof, and closure;
- fleet/detail performance, state size, retained history, desktop UI, and
  mobile UI meet their recorded budgets; and
- focused regressions, contract/data-layer checks, build/install/restart, and
  freshness verification pass.

This is a product-validation finish line, not a claim that Narrative Harness
has no future work.
