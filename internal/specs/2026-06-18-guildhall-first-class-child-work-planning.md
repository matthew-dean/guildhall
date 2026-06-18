# Guildhall First-Class Child Work Planning

**Status:** Proposed implementation follow-on from Narrative Harness import audit
**Date:** 2026-06-18
**Audience:** runtime, task model, workspace import, project map, Overview, Work, coordinator behavior
**Related:**
`internal/specs/2026-06-12-guildhall-logical-work-and-delivery-steps.md`,
`internal/specs/2026-06-03-guildhall-structure-user-facing-feature.md`,
`src/core/task.ts`,
`src/core/task-sizing.ts`,
`src/runtime/task-readiness.ts`,
`src/runtime/task-decomposition.ts`,
`src/runtime/workspace-import/sources/planning-docs.ts`,
`src/runtime/serve.ts`

## Why This Exists

Narrative Harness exposed the same structural failure from several angles:

- Guildhall imported real docs, but the visible project shape stayed amorphous.
- The system captured broad capability intent, then flattened it into generic task state.
- Coordinators treated splitting as advisory language instead of normal execution planning.
- Completion logic could declare the current scope "done enough" while spec-backed capability lanes still had no linked work.

That is not one bug. It is a contract problem between project structure, task shaping, orientation, and execution planning.

This spec fixes the contract.

## Core Principle

Nothing about work decomposition should be treated as a fallback or a polite recommendation.

If Guildhall can already tell that one saved work item actually contains multiple independently finishable units, Guildhall should represent that as planned child work in the canonical model.

The owner does not approve whether decomposition is conceptually allowed. Decomposition is part of Guildhall doing its own job well. The owner still approves project direction, release shape, and spec meaning. Those are different decisions.

## What This Evolves

This proposal evolves, not replaces, the good parts of earlier structure work:

- `2026-06-12-guildhall-logical-work-and-delivery-steps.md`
  - keep: logical work vs delivery-step distinction
  - evolve: replace "split recommendation" framing with first-class child-work planning
- `2026-06-03-guildhall-structure-user-facing-feature.md`
  - keep: project orientation as a product feature
  - evolve: make the visible spine derive from imported capability lanes plus explicit scoped work links
- current workspace-import shaping
  - keep: durable-doc import as the first source of truth
  - evolve: require explicit lane coverage for spec-backed capabilities before the project can present itself as complete

## What This Supersedes

The following ideas should be considered legacy and gradually removed:

- `taskReadiness.recommendation = "split"` as the semantic source of truth
- legacy `sizePlan.recommendedChildren` as a standing plan artifact
- any coordinator/UI copy that implies splitting is optional advice
- any completion logic that only counts imported task rows and ignores uncovered spec-backed capability lanes
- any decomposition flow that asks the owner whether Guildhall should split work at all

## Why Previous Structural Attempts Failed

They were trying to express several different truths with one blurry mechanism:

1. **Project structure**
   - What capabilities, specs, releases, and bounded scopes exist?

2. **Execution planning**
   - Which saved work items are runnable leaves, and which are containers that must resolve into child work first?

3. **Orientation**
   - What is the whole project skeleton?
   - What is in the current scoped release?
   - What is active now?
   - What is deferred?

4. **Owner decisions**
   - What requires product judgment?

Guildhall blurred those together, so broad tasks became pseudo-work, pseudo-summaries, and pseudo-plans all at once. That is why the UX kept feeling like a blob instead of a spine.

## Target Model

### 1. Capability spine

Imported docs produce durable capability lanes, not just generic context.

Examples:

- project charter / purpose / audience
- current bounded scope or release
- capability specs
- implementation roadmap deliverables
- current work items linked to those lanes

The capability spine is the 1,000-foot structure.

### 2. Scoped work graph

Saved work is explicitly partitioned into:

- current bounded scope
- later/deferred bounded scopes
- release-linked work when releases exist
- unassigned work only as a temporary import/intake problem, never as a stable resting place

The scoped work graph is the 100-foot planning view.

### 3. Execution-planning state

Every work item must be one of:

- runnable as one work item
- blocked by one missing question
- blocked by required research
- blocked because it requires child work
- deferred/shelved

This should be modeled as action/state, not recommendation rhetoric.

## Required Model Changes

### A. Replace split-as-recommendation with child-work-required semantics

Current:

- `taskReadiness.recommendation = "split"`

Target:

- canonical semantic value becomes `requires_child_work`
- legacy `"split"` values are read as compatibility input only
- all new writes use `requires_child_work`

Follow-on:

- rename the field from `recommendation` to `action` in a later additive migration
- keep read compatibility during migration

### B. Child-work plans should come from work-unit analysis or imported structure

Guildhall should not invent a generic "Research / Implement / Verify" trio just because a task is broad.

Allowed sources for child-work planning:

- explicit `workUnitAnalysis.units`
- imported roadmap deliverables
- imported spec-backed capability lanes that are clearly separate work units
- deterministic carry-forward from already materialized linked child work

Not allowed:

- placeholder split suggestions with no semantic source
- broad owner-facing questions about whether Guildhall should split work

### C. Completion/start readiness must require lane coverage

If current docs say the scoped project contains six capability lanes and only three have linked work, Guildhall must say the import is structurally incomplete.

It must not:

- start as if the project is runnable end to end
- report release/MVP completion
- hide uncovered capability lanes behind generic summary prose

### D. Releases and bounded scopes remain first-class, but optional

Projects do not need named releases.

Rules:

- if no releases exist, current work defaults to one implicit bounded scope
- when releases do exist, current execution only consumes work for the selected/current release
- later release work must remain visible in the spine but inactive in Start/Resume behavior
- adding a release later must not force destructive rewrites of already-shaped work

That means the model may keep an internal scope container even when the user has not explicitly named a release yet, as long as the UI does not force release concepts where they do not belong.

## Required Runtime Changes

### Workspace import

- keep importing spec docs as capability lanes
- keep importing roadmap deliverables as capability lanes
- detect uncovered spec-backed lanes and block readiness
- when possible, infer domain/group from surrounding docs and linked scoped work

### Task shaping

- write `requires_child_work` instead of `split`
- write child-work planning only from semantic sources
- when linked child work already exists, settle the parent automatically and remove stale split language from the parent summary/spec

### Migration/compatibility

- read legacy `"split"` as `requires_child_work`
- keep legacy `recommendedChildren` only as migration evidence
- migrate represented old split records into execution-plan actions
- never re-elevate legacy placeholder children into authoritative plan truth

## Required UI Changes

### Overview

Overview is not the project map. It is the live status cockpit.

It should answer, instantly:

- what bounded scope are we in?
- how much scoped work exists?
- what is active now?
- what is blocked?
- what changed or needs refresh?

It should not try to display the full skeleton inline.

### Project Map

Project Map is the 1,000-foot view.

It should show:

- capability lanes
- scope/release membership
- which lanes have linked work
- which lanes are inferred vs confirmed
- uncovered lanes as first-class warnings

The map should let the user move work between Now and Later when needed, using existing selectable-card/list primitives rather than bespoke boxes.

### Work view

Work should reflect execution truth:

- runnable leaf work
- containing work that requires child work
- active work
- blocked work

If Overview says "Open work" on the next runnable item, Work should select and scroll to that same item.

## Owner Flow Changes

The owner can still do everything Guildhall can do manually, but Guildhall should not ask for decomposition permission.

Owner choices remain valid for:

- selecting or creating bounded scopes/releases
- moving features between Now and Later
- approving spec meaning when the project direction changes
- answering genuine product/risk questions

Guildhall-owned choices:

- split broad work into child work
- settle parents whose child work already exists
- block readiness when imported structure is under-covered
- keep current execution within the selected bounded scope

## How We Will Know This Works

### Narrative Harness proof standard

Narrative Harness should prove all of these at once:

1. Docs import produces a recognizable skeleton
2. The skeleton exposes major system lanes, not just a list of task rows
3. Current scoped work is visibly smaller than the full project skeleton
4. Missing capability coverage blocks completion/start truthfully
5. Resume only works against current bounded scope

### Concrete verification

1. API proof
   - `workspace-import/draft` exposes capability lanes from roadmap + specs
   - `/api/project` exposes readiness blocked on uncovered capability lanes
   - orientation spine roots/children show actual project skeleton

2. Rendered/browser proof
   - Overview communicates bounded-scope status without blob-like info dump
   - Project Map communicates the full skeleton at a glance
   - Work shows which items are runnable leaves vs containing work
   - no clipped titles, trapped whitespace, or passive sections that look clickable

3. Regression tests
   - legacy `"split"` records parse as `requires_child_work`
   - shaping never invents generic child work when no semantic units exist
   - parent settlement rewrites stale split language automatically
   - uncovered spec-backed lanes block readiness

## Success Criteria

This work succeeds when a real project like Narrative Harness lets a user answer all of these in under a minute, without repo spelunking:

- What is this project trying to build?
- What is the current bounded scope?
- What is in scope now versus later?
- What capabilities/spec lanes exist?
- Which lanes have shaped work and which do not?
- What is running right now?
- Why is the project not ready, if it is not ready?

If Guildhall still needs the user to infer the skeleton from scattered task cards and prose summaries, this work is not done.
