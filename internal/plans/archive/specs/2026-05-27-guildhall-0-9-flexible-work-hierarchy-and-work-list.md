# Flexible work hierarchy and work list

**Status:** 0.9.0 implementation spec

**Owner-facing problem:** Guildhall currently talks about "parent tasks" as if
that is a special category. That is too arbitrary. A user should be able to
drop a rough app idea, a feature idea, a release goal, or a tiny repair, and
Guildhall should shape it into whatever hierarchy makes the work trustworthy.

The model should feel closer to Jira's flexibility than to a hard-coded task
taxonomy: epics, stories, tasks, subtasks, verification items, and release work
are all variations of one work item concept. Guildhall can still infer kind,
scope, readiness, proof needs, and owner attention, but the hierarchy itself
should not require a separate data model for every label.

## Goals

- Represent app specs, feature specs, implementation work, setup work,
  verification work, and release work as one flexible work item model.
- Let any work item contain child work items, at arbitrary depth.
- Preserve dependencies separately from hierarchy. A child relationship says
  "this work is contained by that work"; it does not automatically mean
  "blocked by that work."
- Let Guildhall build the hierarchy automatically from rough intent.
- Give the work list smarter defaults: show what matters now, hide done work
  by default, make action-needed obvious, and keep nested work understandable.
- Remove owner-facing "Parent task" language unless discussing legacy data.

## Non-Goals

- Do not introduce separate persisted tables for Epic, Story, Task, Subtask,
  Feature, or App Spec in 0.9.0.
- Do not require the user to choose a hierarchy type before Guildhall can shape
  the work.
- Do not remove task compatibility fields in a breaking migration unless the
  migration path and UI compatibility are complete.
- Do not make hierarchy visually dominate the UI at the expense of current
  action.

## Vocabulary

- **Work item:** The single core model item. Existing `Task` records should
  evolve toward this meaning, even if the code type remains `Task` for 0.9.0.
- **Containing work item:** A work item whose primary purpose is to gather,
  sequence, or summarize child work.
- **Child work item:** A work item nested under another item.
- **Work kind:** A soft classification such as app spec, feature spec,
  implementation, setup, verification, release, research, decision, cleanup, or
  learning. Kind should guide prompts, filters, and UI; it should not define a
  separate table.
- **Completion boundary:** The explicit condition under which a work item can
  be called complete. For containing work, this includes child-work state plus
  any parent-level proof or handoff requirements.

## Current Smell To Remove

The current system has a `parent` task status and UI copy that says:

- "Parent task"
- "This task is the parent."
- "Guildhall will keep this as the parent task"
- "Child tasks"

This makes hierarchy sound like a special staging status rather than a normal
property of work. It also encourages agents to use a parent as a dead container
instead of a real work item with its own completion boundary, proof, and
handoff.

0.9.0 should keep compatibility with existing records, but owner-facing copy and
new model semantics should move to "containing work" and "nested work."

## Proposed Model Shape

The existing task record can evolve with additive fields first:

```ts
interface WorkHierarchy {
  parentId?: string
  childIds: string[]
  order: number
  depth?: number
  path?: string[]
}

type WorkKind =
  | 'app_spec'
  | 'feature_spec'
  | 'implementation'
  | 'setup'
  | 'verification'
  | 'release'
  | 'research'
  | 'decision'
  | 'cleanup'
  | 'learning'

interface WorkCompletionBoundary {
  summary: string
  requiredChildPolicy: 'all_required_done' | 'selected_children_done' | 'manual_handoff'
  requiredChildIds?: string[]
  proofPathRequired: boolean
  handoffRequired: boolean
  deferAllowed: boolean
}
```

Compatibility notes:

- Existing `parentGoalId` can be mapped into `hierarchy.parentId` or a
  hierarchy path reference.
- Existing recommended child records can remain as suggestions until
  materialized into actual child work items.
- Existing status `parent` should become a compatibility alias for a containing
  work item that is not directly runnable. New code should prefer an explicit
  runnable/readiness property over a `parent` status.

## State And Rollups

Each work item should expose rollups derived from its descendants:

- total child count;
- open child count;
- blocked child count;
- done child count;
- shelved/deferred child count;
- proof coverage;
- latest child update time;
- action-needed count;
- current blockers;
- completion-boundary state.

Rollups should be deterministic and testable. They should not depend on UI-only
grouping.

Containing work can be complete only when:

- its completion boundary is satisfied;
- required children are done or explicitly deferred;
- proof path and handoff requirements are satisfied;
- unresolved blockers are either cleared or recorded as accepted residual risk.

## Work List Behavior

The work list should default to current usefulness rather than raw status.

Default groups:

- **Needs you:** user decision, approval, capability grant, external setup, or
  non-delegable judgment.
- **Working:** active agent/runtime work.
- **Ready:** work Guildhall can start or continue.
- **Blocked:** blocked work that does not currently need an owner action, or
  where the next owner action is already captured elsewhere.
- **Planned:** containing or future work that is not directly runnable yet.
- **Done:** hidden by default.
- **Shelved:** hidden by default unless a filter is active.

Default filters:

- hide `done`;
- hide `shelved`;
- show current project scope;
- show children inline only when they are current/actionable or when the user
  expands the containing item.

Filter dimensions:

- status;
- action-needed owner: user, Guildhall, external;
- hierarchy scope: all, top-level only, descendants of selected item;
- work kind;
- domain/path;
- proof state;
- blocker type;
- runtime/proof availability;
- updated/completed time.

Sort rules:

1. active and needs-you work;
2. blocked work with concrete next action;
3. ready work;
4. recently updated planned/containing work;
5. done work by completion recency when shown;
6. shelved work by shelved recency when shown.

## UI Requirements

### Public Docs Requirement

0.9.0 public docs should include a reader-facing page or section about the
different ways to work with Guildhall. The page should make hierarchy feel like
an everyday workflow tool, not an internal data model.

The docs should cover at least these modes:

- **Whole-project mode:** drop in a broad project/app goal and let Guildhall
  shape the full hierarchy, run the work, and report completion.
- **Feature-at-a-time mode:** use the same `New request` intake to define one
  feature within an existing project. Guildhall pressure-tests it, splits it
  into nested work, and lets the owner run or automate just that feature or one
  of its child work items.
- **One focused work item:** open a specific card and start only that work item
  when the owner wants a bounded agent pass.
- **Setup or verification lane:** track owner-only setup, runtime proof, or
  verification as nested work without pretending it is the same as
  implementation.
- **Exploration/decision lane:** let Guildhall shape research or decisions
  before implementation exists.

The public wording should be plain and owner-facing. It should not ask the user
to choose "parent task" versus "task path." The promise is: start with a rough
request, let Guildhall shape the hierarchy, then decide whether to run the
whole project, one feature, or one specific work item.

Project work list:

- Show top-level containing work with compact child rollups.
- Show actionable descendants without forcing the user to expand every ancestor.
- Keep `done` hidden by default, with an obvious "Show done" control.
- Show hierarchy breadcrumbs on nested items.
- Show whether an item is runnable, waiting, blocked, or summarizing child work.

Task/work drawer:

- Rename "Task hierarchy" to "Work hierarchy" or similar.
- Replace "Parent task" with "Containing work."
- Replace "Child tasks" with "Nested work" or "Child work."
- Show parent breadcrumb, child rollups, completion boundary, and dependencies
  separately.
- Make it clear when work is not directly runnable because useful child work
  exists underneath.

Thread:

- When Guildhall splits or reshapes work, say what hierarchy it created and why.
- Avoid asking the user whether to use a "parent task path." Guildhall should
  decide and explain.

### Start Semantics

Every Start control must have an explicit scope.

Current UI risk: a Start button rendered on a task/work card can look like it
will start only that card, while the underlying project endpoint may start the
project run more broadly. 0.9.0 should make this contract unambiguous.

Required semantics:

- A top-level project Start button starts or resumes the project scheduler
  across eligible work.
- A Start button on a work item starts or resumes only that work item and the
  minimum required ancestor/descendant context. It must not silently pick up
  unrelated ready work.
- A Start button on a containing work item should clearly say whether it starts
  the next eligible child, all ready children in that container, or opens a
  scoped automation choice. The default should be conservative and explicit.
- A feature-level Start should run within that feature's subtree, not the entire
  project.
- Button labels, disabled text, and toast messages should name the scope, for
  example `Starting Link editor feature...` or `Started only this work item.`
- The API should expose the scope explicitly, rather than relying on an
  optional `taskId` body on a project-level endpoint whose name implies a whole
  project start.
- Tests should prove that scoped Start does not dispatch unrelated ready work.

## Agent Behavior

Intake and pressure-test logic should:

- infer whether the user's idea is an app-level, feature-level, or task-level
  item;
- create hierarchy when the work has different owners, proof boundaries,
  runtime needs, or review risks;
- avoid asking the user to choose hierarchy mechanics;
- ask only questions that change product intent, completion boundary, risk, or
  non-delegable decisions.

Spec and decomposition agents should:

- produce a completion boundary for containing work;
- define child work with clear purpose, owner, readiness, dependencies, and
  proof expectations;
- keep dependencies explicit and separate from containment;
- avoid creating dead containers that can never be completed.

Review/gate logic should:

- reject a containing item marked done when required children or proof are
  missing;
- allow explicit deferral when the completion boundary permits it;
- record residual risk in the completion handoff.

## Migration

0.9.0 should use an additive migration:

1. Read old records as-is.
2. Derive hierarchy fields from `parentGoalId`, parent status, and materialized
   child recommendations.
3. Preserve compatibility for old UI/API fields until the new UI is stable.
4. Stop writing owner-facing "parent task" language in new records.
5. Replace status-based parent semantics with hierarchy/readiness semantics.

## Test Plan

Runtime tests:

- arbitrary depth hierarchy read/write;
- parent/child rollups;
- dependency separate from containment;
- completion boundary rejects incomplete containing work;
- legacy `parentGoalId` compatibility;
- default work-list grouping hides done and shelved work.

Svelte tests:

- work list hides done by default and reveals it on request;
- nested work breadcrumbs render clearly;
- containing work shows child rollups and completion boundary;
- old split-required data renders as nested work, not "parent task" language.

Browser proof:

- Seed a project with at least three hierarchy levels:
  app spec -> feature spec -> implementation/proof work.
- Verify default list, filters, drawer, and thread copy.

## Release Acceptance

This spec is complete for 0.9.0 when a user can open the work list, understand
what matters now, expand nested work when needed, hide/reveal done work, and
see a containing work item finish only when its explicit completion boundary is
actually satisfied.
