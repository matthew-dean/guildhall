# Guildhall Future Architecture — Reusable Task Substrate, Delegation Engine, and Monorepo Split

## Status

Future architecture note. Explicitly post-`0.6.0`; not scheduled for immediate
implementation.

## Purpose

Guildhall is gradually inventing two things at once:

1. a product:
   - the guild hall UI
   - the coordinator-driven user journey
   - project setup, Thread, Work, Release, and Settings

2. a substrate:
   - task state
   - delegation and handoff
   - auditability
   - review and gate loops
   - human/agent question flow
   - planning and release shaping

Right now those are still heavily intertwined.

This note captures a future direction:

> Guildhall should eventually be able to split into a reusable headless
> project/task workflow substrate plus an opinionated Guildhall product layer
> on top.

The goal is not to start a large refactor now.
The goal is to clarify the architectural destination so current work can move
toward cleaner seams instead of deepening accidental coupling.

The near-term product work remains the `0.6.0` planning/release-shaping layer
inside Guildhall itself. This note describes what may be worth extracting only
after that layer is real and proven in the live product.

## Why this matters

There appears to be a real ecosystem gap around:

- headless project/task systems
- workflow engines readable by LLMs
- delegation-aware state machines
- durable human/agent handoff
- review and gate loops
- provenance and auditability

There are many tools that solve adjacent problems:

- queues
- kanban/task trackers
- workflow engines
- BPM systems
- job schedulers
- event-sourced backends

But there is not an obvious off-the-shelf JavaScript package that cleanly
provides:

- LLM-readable task state
- agent delegation
- review/gate/adjudication loops
- explicit human questions and approvals
- durable audit history
- enough product-agnostic structure to reuse across systems

Guildhall is already accumulating those behaviors.
If that continues, the system may be worth structuring as a reusable substrate,
not just as app-local glue.

## Problem

Today Guildhall’s boundaries are blurry.

The same codebase currently mixes:

- product language and UI concerns
- task schema and persistence
- planning logic
- orchestration / coordination logic
- provider/runtime execution
- audit/provenance mechanics

That creates several future risks:

1. **reuse risk**
   - the generic workflow parts are hard to lift into another product

2. **coupling risk**
   - changes to Thread or setup can accidentally tangle with task-state logic

3. **testing risk**
   - product behavior and workflow substrate behavior are not cleanly isolated

4. **naming risk**
   - product concepts and implementation concepts can drift apart

5. **refactor risk**
   - if Guildhall eventually wants published packages, the extraction cost
     becomes higher the longer the seams stay muddy

## Product thesis

Guildhall should eventually be understood as:

- **a guild hall product** built on
- **a reusable workflow substrate**

The product should remain opinionated:

- coordinator-centric
- persona-aware
- Thread-first
- reviewable in the browser
- optimized for unattended but inspectable progress

The substrate should remain headless:

- no assumption about Guildhall’s UI
- no requirement that consumers adopt the guild metaphor
- usable by another app, CLI, or service that wants the same workflow engine

## The future split

### Layer 1 — Workflow substrate

This is the reusable core.

It should own:

- task schema
- status transitions
- dependency representation
- release / phase grouping primitives
- delegation and claim semantics
- agent/human question and answer model
- review / gate / adjudication loops
- provenance / audit log model
- resumable run state
- storage interfaces

It should not know:

- how Thread cards look
- what tabs Guildhall has
- how the guild hall metaphor is rendered

### Layer 2 — Runtime and adapters

This is the execution bridge between the headless model and real environments.

It should own:

- provider integrations
- shell / file execution wrappers
- worktree management
- event streams
- persistence adapters
- registry / service lifecycle

It should translate:

- workflow intents
- into concrete runtime operations

### Layer 3 — Guildhall product

This is the opinionated app and experience.

It should own:

- project setup and onboarding
- Thread
- Work
- Release
- Settings
- personas / provenance screens
- product copy
- project-level defaults and opinions

It should consume the substrate, not reimplement it.

## Proposed package seams

This does not need to happen now, but the likely future package boundaries are:

### `@guildhall/task-core`

Owns:

- task schema
- task statuses
- transitions
- dependencies
- acceptance criteria structures
- human questions / approvals
- provenance model

Primary question:

> What is a task, and how can it legally move?

### `@guildhall/planning-core`

Owns:

- phase grouping
- release grouping
- active tranche selection
- priority + dependency-aware sequencing
- rationale generation for "why now vs later"

Primary question:

> Which work should be active now, and what belongs together?

### `@guildhall/delegation-core`

Owns:

- claim / handoff semantics
- worker/reviewer/gate/coordinator routing
- adjudication rules
- retry / revision / escalation rules
- human-vs-agent ownership signals

Primary question:

> Who owns the next move, and what happens when work changes hands?

### `@guildhall/audit-core`

Owns:

- event model
- transcript references
- provenance summaries
- contribution history
- state snapshots

Primary question:

> What happened, who did it, and what evidence supports that?

### `@guildhall/runtime`

Owns:

- provider runners
- shell/file adapters
- worktree lifecycle
- execution safety
- service supervision
- event broadcasting

Primary question:

> How does the workflow engine touch the real world safely?

### `@guildhall/storage`

Owns:

- file-backed project state
- registry persistence
- migration helpers
- optional DB adapters later

Primary question:

> Where does workflow state live, and how do we load/save it safely?

### `@guildhall/app`

Owns:

- SPA
- CLI surface
- project shell
- setup wizard
- Thread/Work/Release/Facts/Settings UX

Primary question:

> How should Guildhall feel and behave as a product?

## Headless substrate requirements

If the substrate is ever extracted, it should satisfy these requirements.

### 1. LLM-readable state

The state model should be:

- concise
- explicit
- serializable
- understandable without hidden UI assumptions

An agent should be able to inspect a task or project payload and understand:

- current phase
- next owner
- blockers
- dependencies
- outstanding human questions
- current release/phase placement

### 2. Delegation as a first-class primitive

The substrate should not treat delegation as an app-specific side effect.

It should model:

- claim
- handoff
- review
- gate check
- escalation
- adjudication
- resume

as durable workflow concepts.

### 3. Auditability by default

The system should preserve:

- who changed state
- why it changed
- what evidence was cited
- what user input affected it
- what agent perspective or role was involved

This matters both for trust and for debugging unattended runs.

### 4. Human/agent coexistence

The workflow model must cleanly support:

- human-owned questions
- human approvals
- agent-owned next steps
- queued agent work
- paused/stopped service state

without forcing the UI to invent those semantics locally.

### 5. Multiple storage backends

Guildhall is file-backed today.
That is good for local-first use and debugging.

But a reusable substrate should not permanently assume:

- one file format
- one on-disk layout
- one deployment model

File-backed storage should remain a first-class adapter, not a dead-end.

## What should stay product-specific

Even after modularization, Guildhall should keep its own opinions.

These should remain in the app/product layer:

- guild metaphor
- coordinator persona framing
- Thread as the command surface
- card anatomy and ownership tones
- product copy
- setup journey
- persona provenance screens
- local-first service UX

That is important because the reusable substrate should not flatten Guildhall
into generic workflow middleware.

## Monorepo direction

If Guildhall eventually becomes a monorepo with published packages, the target
shape should be:

```text
packages/
  task-core/
  planning-core/
  delegation-core/
  audit-core/
  runtime/
  storage/
  app/
```

Potentially with:

```text
tools/
  cli/
  migrations/
examples/
  minimal-headless-runner/
  guildhall-local-app/
```

### Why a monorepo makes sense

- shared types stay coherent
- local refactors can cross package boundaries safely
- extraction can happen incrementally
- published packages can still evolve together

### Why not in `0.6.0`

Because the current risk is obvious:

- we could disappear into package architecture before proving the core product
  journey

Guildhall still needs stronger proof that it can:

- do more than one meaningful thing
- in sequence
- unattended
- with a user flow that makes sense

That work is higher priority than the monorepo split itself.

## Migration strategy

This should be a gradual extraction, not a flag-day rewrite.

### Phase 1 — Write toward seams

Do now:

- keep product language stable
- isolate planning logic from UI shaping logic
- isolate task transition helpers from surface rendering
- keep audit/provenance structures explicit

Goal:

- the future package seams become visible in the codebase even before packages
  exist

### Phase 2 — Extract internal modules

Later:

- move task-state logic behind clearer internal module boundaries
- separate planning/release shaping from execution/runtime concerns
- reduce direct SPA coupling to raw task file structure

Goal:

- internal modules become package-ready

### Phase 3 — Monorepo packaging

Later still:

- move stable internal modules into `packages/*`
- keep the Guildhall app consuming them
- add a minimal headless consumer as a proof that the split is real

Goal:

- prove that the substrate is genuinely reusable

### Phase 4 — External publishing

Only if it still makes sense:

- publish selected packages
- document the headless API
- support alternative consumers

Goal:

- turn the substrate into a real reusable platform, not just an internal code
  arrangement

## Risks

### 1. premature architecture

We could over-index on extraction before the user journey is reliable.

Mitigation:

- keep shipping product fixes first
- treat this note as a steering document, not an immediate roadmap

### 2. false genericity

We could extract abstractions that only look reusable because they still carry
Guildhall-specific assumptions.

Mitigation:

- require a headless example consumer before claiming the substrate is real

### 3. over-fragmentation

We could split too early into too many packages and make development slower.

Mitigation:

- extract only once module boundaries are already stable

### 4. naming churn

We could rename everything mechanically without improving the real seams.

Mitigation:

- prioritize semantic boundaries first
- let naming convergence follow the real architecture

## Non-goals

This note does **not** commit Guildhall to:

- an immediate monorepo migration
- publishing NPM packages soon
- replacing the file-backed local-first model now
- rewriting the current runtime around a generic workflow engine immediately
- deprioritizing current Thread/setup/execution flow fixes

## Recommendation

The near-term strategy should be:

1. keep proving the Guildhall product journey
2. build the planning/release-shaping layer cleanly
3. write current code toward reusable seams
4. revisit extraction once those seams are real

That means:

- **do not** start the monorepo split now
- **do** treat task state, planning, delegation, and auditability as future
  substrate boundaries starting now

## Success criteria for revisiting this

This architecture should be revisited once Guildhall can reliably demonstrate:

1. unattended multi-step progress across more than one task/state transition
2. coherent planning/release shaping above raw task execution
3. stable task/provenance semantics that are no longer changing every day
4. at least one internal module boundary that already feels extractable without
   heroics

At that point, modularization stops being speculative and becomes a natural
next step.
