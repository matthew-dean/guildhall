# Guildhall 0.6.0 — Project Planning, Release Shaping, and Coordinator Language

## Status

Proposed for `0.6.0`.

## Purpose

Guildhall is getting better at moving one task forward, but it still lacks a
strong project-level planning layer.

Today the system can:

- infer repo structure
- generate or import many tasks
- prioritize locally by phase and severity
- dispatch work

But it still does not reliably answer:

- what belongs in the next release?
- what should wait?
- which tasks are foundational versus follow-up?
- which tasks are grouped into the same phase or shipping milestone?
- what should Guildhall keep doing unattended versus what needs review first?

This feature batch gives Guildhall a real planning layer above raw task
execution and standardizes the system’s public language around one term:
**Coordinator**.

The package/monorepo extraction story is deliberately later. For the longer
arc, see [Guildhall Future Architecture — Reusable Task Substrate, Delegation
Engine, and Monorepo Split](./2026-05-11-guildhall-future-task-substrate-and-monorepo-architecture.md).

## Problem

Right now Guildhall behaves too much like:

- a queue that keeps taking the next runnable task

and not enough like:

- a guild of experts working through a coherent plan

That creates three product problems:

1. a large task set can feel unordered even when many tasks are valid
2. unattended progress is hard to trust because the system is not clearly
   shaping work into phases or releases before execution
3. the language is inconsistent:
   - some surfaces say `Coordinator`
   - others say `Orchestrator`
   - users are forced to infer whether those are different things

If Guildhall is supposed to feel like a real guild hall, not a generic agent
runner, it needs:

- a visible planning model
- a clearer release/phase story
- one stable name for the coordinating layer

## Product thesis

Guildhall should separate:

1. **Planning**
   - what matters now
   - what belongs together
   - what is blocked on prerequisites
   - what should ship in the next tranche

2. **Execution**
   - drafting
   - review
   - implementation
   - gate checks
   - landing accepted work

The same coordinating layer should own both, but the planning pass should come
first.

The user-facing mental model should be:

> The coordinator shapes the project into phases and releases, then Guildhall
> works through the current tranche until it is blocked or done.

## Naming decision

### Canonical term

Use **Coordinator** as the canonical term across product surfaces and product
documentation.

### Why

`Coordinator` fits the guild metaphor:

- it sounds like a role inside a guild of experts
- it matches the existing persona-first product direction
- it feels like a collaborator, not infrastructure

`Orchestrator` sounds like infrastructure:

- process manager
- scheduler
- runtime engine

That word is still acceptable as an implementation detail in code and legacy
module names during migration, but it should not be treated as a second
user-facing concept.

### Rule

The destination is one name, not a permanent split:

- **product UI**: `Coordinator`
- **product docs**: `Coordinator`
- **runtime/API explanations shown to users**: `Coordinator`
- **implementation names**: should converge toward `Coordinator` too

For `0.6.0`, it is acceptable to leave some internal `orchestrator`
symbols/module names in place as migration debt where a full rename would be
disruptive. But that is temporary debt, not a product principle.

### Non-goal

This feature does **not** require an all-at-once repo-wide rename of every
`orchestrator` symbol in one pass. It does require:

- one public term now
- no new user-facing `orchestrator` language
- a follow-on cleanup path that keeps collapsing internal naming debt over time

## Scope

### In for `0.6.0`

1. project planning / release shaping model
2. phase and release grouping primitives
3. coordinator-owned active tranche selection
4. basic release and phase visibility in the UI
5. public terminology cleanup to `Coordinator`

### Out for `0.6.0`

1. full Jira-style roadmap tooling
2. gantt views or calendar planning
3. automatic due-date prediction
4. multi-release burndown analytics
5. a large PM-only surface before the underlying planning behavior is real
6. splitting Guildhall into published packages or a monorepo substrate layer
   during this release cycle

## Feature 1 — Planning layer

### Goal

Before Guildhall dispatches a bunch of worker work, it should shape the backlog
into a more meaningful structure.

### Planning concepts

The coordinator should be able to classify tasks into:

- **Setup**
- **Foundation**
- **Active release**
- **Later release**
- **Polish / follow-up**
- **Blocked by prerequisite**

The exact visible labels may evolve, but the important behavior is:

- not every task is equally eligible for immediate execution
- the coordinator should promote a smaller active tranche from the larger
  backlog

### Inputs

The planning pass should use:

- task status
- task priority
- repo structure / routing slices
- explicit dependencies
- imported provenance
- project brief / direction
- release notes or existing roadmap artifacts when present

### Output

The planning pass should produce:

- phase assignment
- release bucket assignment when meaningful
- whether the task is currently in the active tranche
- rationale for why it is active now versus later

## Feature 2 — Release shaping

### Goal

Guildhall should be able to answer:

- “What is the next meaningful release?”
- “What needs to land before this can ship?”
- “What can happen in parallel?”

### Behavior

The coordinator should be able to create a lightweight release shape such as:

- `0.1 Foundation`
- `0.2 Core onboarding`
- `0.3 Auth hardening`

This does **not** need to be a heavyweight PM artifact.

For `0.6.0`, release shaping can be:

- inferred first
- lightly editable
- visible in Release / Work / Thread summaries

### Acceptance bar

By `0.6.0`, Guildhall should be able to:

1. group tasks into at least one current tranche and one later tranche
2. explain why a task is active now
3. show release/phase grouping in a way a user can follow
4. avoid simply chewing through all tasks in creation order

## Feature 3 — Active tranche selection

### Goal

Worker execution should happen against a smaller planned slice, not against the
entire lifetime backlog.

### Rule

The coordinator should:

1. inspect the larger backlog
2. promote a bounded set of tasks into the active tranche
3. let execution work from that tranche
4. refresh the tranche when:
   - a prerequisite lands
   - a release shape changes
   - active work is exhausted
   - new high-priority work arrives

### Why this matters

This is one of the core requirements for “leave Guildhall running for 24
hours” trust. The system should not just keep consuming the next valid task;
it should keep consuming the next valid task **inside a sensible plan**.

## UI changes

### Thread

Thread should remain the primary flow surface, but it should become clearer
about planning state:

- whether the coordinator is planning
- whether the current task is in the active tranche
- whether a task is waiting for a prerequisite or a later release

Thread should not become a giant planning board.

### Work

Work should show the backlog as:

- active now
- later
- blocked
- done

If release groups exist, they should be visible there first.

### Release

Release should stop being mostly narrative and should instead show:

- current release shape
- what is already complete
- what remains
- what is blocked

### Settings

Settings can expose planning defaults or policies later, but `0.6.0` should
not start by making the user configure release machinery.

## Runtime changes

### New planning pass

Introduce a coordinator-owned planning pass that can:

- inspect runnable tasks
- detect dependencies or missing foundation work
- assign phase / tranche metadata
- reorder active work based on that metadata

### Task selection

Current task picking is too local. The selection logic should prefer:

1. active in-flight work
2. active tranche work
3. higher priority within that tranche
4. only then fallback queue order

### Persistence

Planning metadata should persist with the project, not live only in memory.

Likely homes:

- `TASKS.json` per-task fields
- a lightweight release/phase state file if needed

## Migration / rollout

### Phase 1

- terminology cleanup to `Coordinator`
- add planning metadata shape
- keep current picker behavior, but let the coordinator annotate tasks

### Phase 2

- active tranche selection influences runnable task picking
- release/phase visibility appears in Work/Release

### Phase 3

- stronger unattended progression through multiple planned steps
- clearer completion and release truth

## Risks

1. **Fake planning**
   - the UI might show phases/releases before the runtime actually respects
     them

2. **Over-management**
   - the planning layer could become heavy and bureaucratic

3. **Naming drift continues**
   - if docs/UI/runtime messages keep mixing terms, users still infer two
     concepts

4. **Planning without proof**
   - Guildhall may group tasks nicely but still fail to complete them

## Success criteria

`0.6.0` is successful if:

1. a project with many tasks no longer feels like an undifferentiated queue
2. the coordinator can explain why work is active now versus later
3. users can see at least a lightweight release/phase shape
4. unattended execution works through multiple planned steps, not just one
   isolated task handoff
5. product surfaces stop mixing `Coordinator` and `Orchestrator`

## Open questions

1. How explicit should dependency modeling be in `0.6.0`?
2. Should release grouping be auto-inferred only, or lightly editable?
3. Should Release and Work share one underlying planning model or present
   tailored summaries over the same state?
4. When should a high-priority interruption preempt the active tranche?

## Recommendation

Slate this for `0.6.0`.

Do the naming cleanup first, then wire the planning layer into selection
behavior, then expose release/phase truth in Work and Release.
