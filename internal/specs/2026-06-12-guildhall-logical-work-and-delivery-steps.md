# Guildhall Logical Work And Delivery Steps

**Status:** Implemented in local 0.10 project state
**Date:** 2026-06-12
**Audience:** Guildhall runtime, task lifecycle, project summary, Work UI,
Thread UI, drawer UI, and service-summary implementation work
**Related:**
`internal/specs/2026-05-27-guildhall-0-9-flexible-work-hierarchy-and-work-list.md`,
`internal/plans/2026-05-30-ready-state-and-decomposition-model.md`,
`internal/specs/2026-06-06-guildhall-0-11-iterative-work-campaigns.md`,
`internal/specs/2026-06-05-guildhall-0-10-primitives-and-delivery-spine.md`,
`src/core/task.ts`,
`src/runtime/work-hierarchy.ts`,
`src/runtime/task-decomposition.ts`,
`src/web/lib/work-hierarchy.ts`,
`src/web/surfaces/project/WorkTab.svelte`,
`src/web/surfaces/project/WorkTreePreview.svelte`,
`src/web/lib/TaskCard.svelte`,
`src/web/surfaces/TaskDrawer.svelte`,
`src/web/surfaces/drawer/OverviewTab.svelte`,
`src/web/surfaces/drawer/CurrentTab.svelte`,
`src/web/surfaces/drawer/JourneyTab.svelte`,
`src/web/lib/project-summary.ts`,
`src/web/lib/ProjectCard.svelte`

## Release Boundary

This spec should not over-protect shapes that only exist after the latest
shipped release. As of this planning pass, the local repo has a `v0.9.0` tag
and `package.json` is already on `0.10.0`, but there is no later release tag in
this checkout. Treat 0.10 and 0.11 work as local/in-progress product state
unless a later release artifact proves otherwise.

That matters for this proposal: if a post-0.9 local shape is wrong, prefer a
clear migration of registered local projects over compatibility scaffolding
that preserves a confused model. Compatibility is required for shipped 0.9
project data and for safe local migrations. It is not required for every
intermediate internal shape created while 0.10/0.11 is still in flight.

## Problem

Guildhall correctly moved toward splitting broad work into nested work. A raw
project request, rough thread input, or imported roadmap item should become a
small number of logical work units: features, components, controls, integration
points, setup lanes, verification lanes, or release lanes.

The over-pivot is that too many decomposition results become ordinary tasks in
the same flat visible pool. A logical work unit like "add the import review
flow" should be visible, countable, and manageable. Its internal obligations
-- implementation steps, demo/proof artifacts, checks, docs, migration notes,
review lanes, release notes, runtime proof, and completion handoff -- should
control progress and done state, but they should not all appear as first-class
todos in every Work list, project card count, fleet count, and board column.

The product needs more structure, not less:

- logical work items are the user-visible units of project management;
- delivery steps are quantifiable obligations underneath a logical item;
- parent/logical progress is derived from child work and delivery steps;
- global task counts count visible work, not every internal step;
- detail surfaces can expose the internal state without flooding primary work
  lists.

## Current Repo Shape

The repo already has most of the substrate, but the semantics are spread across
several layers.

- `src/core/task.ts` has `hierarchy`, `completionBoundary`,
  `definitionOfDone`, `proofPaths`, `completionHandoff`, `taskKind`,
  `workKind`, `decomposition`, and `sizePlan`.
- `src/runtime/work-hierarchy.ts` derives hierarchy rollups and
  `completionBoundaryStatus`.
- `src/web/lib/work-hierarchy.ts` is a lighter UI hierarchy model and does not
  expose the richer runtime rollups.
- `src/runtime/task-decomposition.ts` can produce child drafts for research,
  implementation, and verification.
- `src/tools/task-queue.ts` materializes split recommendations into child task
  records.
- `src/web/surfaces/project/WorkTab.svelte` has three work views: list, board,
  and columns.
- `src/web/surfaces/project/WorkTreePreview.svelte` renders a hierarchy
  browser and already warns when a broad ready task lacks child tasks or a
  decomposition proposal.
- `src/web/lib/TaskCard.svelte` is the compact task mini-card used by Work,
  Planner, and Coordinators.
- `src/web/surfaces/drawer/OverviewTab.svelte` shows task links, split
  recommendations, child tasks, delivery context, review plan, and size.
- `src/web/surfaces/drawer/CurrentTab.svelte` shows active turn state and
  worker-handoff cleanup.
- `src/web/surfaces/drawer/JourneyTab.svelte` shows proof paths, gates, review,
  completion handoff, and done summaries.
- `src/web/lib/project-summary.ts` and `src/web/lib/ProjectCard.svelte` still
  summarize project work with raw task counts: total, active, draftReview,
  blocked, done, and shelved.

The missing model is a visibility and progress boundary between "work item the
user manages" and "delivery step/proof obligation that makes the work item
trustworthy."

## Vocabulary

**Logical work item**

A user-visible unit of work. It can be a feature, component, primitive,
integration, setup lane, verification lane, release lane, research/decision
lane, or campaign iteration. It can contain other logical work items.

Logical work items appear in primary work lists, project cards, Work columns,
board columns, overview "next work" rows, and global counts unless explicitly
hidden, done, or shelved.

**Containing work item**

A logical work item whose progress is primarily derived from children and
delivery obligations. It may or may not be directly runnable. It should not
pretend to be a leaf task.

**Runnable work item**

A logical work item that can be assigned to a worker/reviewer/gate loop as a
bounded unit.

**Delivery step**

A quantifiable step inside a logical work item. It tracks progress, proof, and
handoff requirements, but it is not necessarily a primary task card. Examples:

- make the product, code, config, or content change;
- add a demo or proof artifact;
- add/update tests;
- update docs or release notes;
- run runtime proof;
- record design-system review;
- run contract detector;
- finish completion handoff;
- verify migration behavior.

**Proof obligation**

A required evidence item that can be satisfied by a delivery step, proof path,
gate result, review artifact, or manual owner/external proof.

**Visible work count**

The count shown in fleet/project/work-list summary surfaces. It counts logical
work items whose `visibility` is `primary` or `supporting`, not every delivery
step.

**Delivery progress**

The derived progress state for a logical item:

```text
done delivery steps / required delivery steps,
blocked delivery steps,
missing proof obligations,
child logical-work rollup,
completion-boundary status
```

## Contract Touch Decision

- **Work id:** logical-work-and-delivery-steps-2026-06-12
- **Touched contracts:** task/work item model, project service summary,
  project detail payload, work hierarchy rollup, task drawer payload, Work UI
  count semantics, ProjectCard count semantics, Thread turn checklist semantics,
  split-child materialization semantics.
- **Contracts considered but not touched:** shipped 0.9 public docs voice,
  external Jira or Linear task authority, MCP resource names, worker-agent
  result contract.
- **Required follow-up:** add an additive schema for work visibility and
  delivery steps; centralize work rollups in runtime/API; update UI surfaces to
  consume shared rollups instead of local raw task counts.
- **Proof required:** unit tests for rollups/counts, service-summary payload
  tests, WorkTab/WorkTreePreview/TaskDrawer component tests, project-card count
  tests, and one fixture proving delivery steps affect parent progress without
  appearing as primary task cards.
- **Proof provided:** code-path inspection plus implementation across the
  planned runtime, migration, write-path, and UI surfaces:
  `src/runtime/work-progress.ts`, core task schema preservation for
  `workVisibility` / `deliverySteps`, `/api/service`, `/api/project`,
  `/api/project/task/:id`, project-card counts, Work surfaces, task mini-cards,
  Project Overview, WorkTreePreview, task drawer header, drawer Overview,
  Current, and Journey, Thread shaping copy, Inbox owner-held delivery-step
  treatment, migration `0.10.0/task-delivery-steps`, and split-child
  materialization that writes verification children as parent delivery-step
  metadata at creation time. Verification passed with the focused UI slice,
  the broader touched Vitest slice, `pnpm typecheck`, `pnpm lint:contracts`,
  and `git diff --check`.
- **Waivers:** no runtime contract or persisted schema is changed by this doc.
- **Owner-review items:** final labels for `primary`, `supporting`,
  `internal_step`, and whether "supporting" work appears in default Work list.
- **Apply/revert behavior:** future implementation can migrate registered local
  projects directly. It must preserve shipped 0.9 data well enough to migrate
  it, but it does not need to keep every post-0.9 intermediate shape alive as a
  long-term compatibility mode. Tasks without visibility fields default to
  primary logical work only as the read-time/migration fallback.

## Schema Migration Decision

- **Persisted schema touched:** task records now accept optional
  `workVisibility` and `deliverySteps`.
- **Scope:** canonicalize the current local model around logical work plus
  delivery steps.
- **Change class:** local-project migration with read-time fallback for shipped
  0.9-shaped records. Do not preserve post-0.9 intermediate shapes unless they
  remain useful after this model lands.
- **Existing data impact:** registered local projects should be migrated to the
  new canonical shape. During migration, runtime can derive
  `workVisibility.kind = "primary"` for normal legacy records and derive
  delivery steps from existing `definitionOfDone`, `proofPaths`,
  `reviewPlan.requiredArtifacts`, `gateResults`, `completionHandoff`, and
  `decomposition.childDrafts`. After migration, new code should write explicit
  visibility and delivery-step state instead of leaning on broad compatibility
  inference.
- **Migration id:** `0.10.0/task-delivery-steps`.
- **Safety:** the migration backs up local task state, deterministically marks
  existing `test` / `verification` child tasks as `internal_step`, and adds a
  semantic parent `deliverySteps` entry. It can hide local post-0.9
  delivery-only split children after proof, because those shapes have not
  shipped.
- **Required before run:** yes for projects whose stored work graph contains
  post-0.9 split/delivery shapes that would otherwise overcount work. Shipped
  0.9-shaped projects can be read and migrated before normal runs.
- **Compatibility reader:** yes, but as a migration bridge. The runtime API
  should compute rollups for un-migrated records long enough to migrate them,
  not as a permanent parallel model.
- **Fixtures:** broad feature with build/verify/document/proof steps; UI
  control with interactive-preview, automated-check, and runtime evidence
  channels;
  campaign parent with iteration children; current local split-required parent
  with materialized child tasks.
- **Tests:** parser/schema tests, migration tests, task-queue split
  materialization tests, work-progress rollup tests, service dashboard tests,
  WorkTab tests, ProjectCard tests, TaskCard tests, TaskDrawer/Overview tests.
- **Owner-facing plan text:** "Guildhall will keep the main work list focused
  on logical work. The proof checklist inside each item still controls whether
  it is done."
- **Rollback/revert behavior:** restore the backed-up local project state or
  rerun the inverse migration for registered projects. Do not add a permanent
  "old and new model" fork unless a shipped project data contract requires it.

## Proposed Model

Add an explicit visibility/progress layer to the existing Task model rather
than introducing separate Epic/Story/Subtask tables.

```ts
type WorkVisibilityKind =
  | 'primary'
  | 'supporting'
  | 'internal_step'
  | 'hidden'

type WorkVisibility = {
  kind: WorkVisibilityKind
  label?: string
  countInProjectTotals?: boolean
}

type DeliveryStepStatus =
  | 'todo'
  | 'active'
  | 'blocked'
  | 'done'
  | 'waived'

type DeliveryStepKind =
  | 'make_change'
  | 'verify'
  | 'document'
  | 'review'
  | 'decide'
  | 'coordinate'
  | 'release'
  | 'handoff'
  | 'external_action'

type DeliveryStep = {
  id: string
  title: string
  kind: DeliveryStepKind
  status: DeliveryStepStatus
  required: boolean
  blocksCompletion: boolean
  sourceTaskId?: string
  evidenceChannel?: string
  toolLabel?: string
}

type WorkProgressRollup = {
  visibleChildCount: number
  visibleChildDoneCount: number
  internalStepCount: number
  requiredStepCount: number
  doneStepCount: number
  blockedStepCount: number
  primaryState:
    | 'blocked'
    | 'active'
    | 'pending'
    | 'done'
}
```

The `kind` field is intentionally semantic. It should not encode a specific
test runner, documentation system, component explorer, browser automation tool,
hosting provider, or contract detector. Tool-specific details belong in
`evidenceChannel`, `toolLabel`, launch steps, proof paths, commands, URLs, or
artifact refs.

The evidence-channel values are seed vocabulary, not a closed taxonomy. The
canonical contract is "what kind of evidence satisfies this step," while the
exact tool remains metadata. If a project proves work through a simulator,
design file, dataset snapshot, hosted preview, CLI command, hardware device, or
external dashboard, the model should not need a new top-level delivery kind.

Examples:

- a Storybook story is usually `kind: "verify"` with
  `evidenceChannel: "interactive_preview"` and `toolLabel: "Storybook"`;
- a Playwright route check is usually `kind: "verify"` with
  `evidenceChannel: "runtime_observation"` and `toolLabel: "Playwright"`;
- a contract detector run is usually `kind: "verify"` with
  `evidenceChannel: "contract_validation"`;
- a docs update is `kind: "document"` regardless of whether the target is
  VitePress, a README, a changelog, or a private internal spec.

Defaults:

- shipped 0.9 or unclassified local task: `primary`, counted, shown in default
  Work list and board until migration classifies it more specifically;
- containing work: usually `primary`, counted, shown, with progress rollup;
- visible child feature/component: `primary` or `supporting`, counted according
  to parent scope rules;
- proof-only/check/documentation split child: migrate to `internal_step` unless
  the owner needs to manage it independently;
- import draft: not counted as primary work until shaped;
- done/shelved: counted in historical totals only when the surface asks for
  history.

## Derivation Rules

Runtime should derive delivery progress from one shared builder, tentatively:

```text
src/runtime/work-progress.ts
```

Inputs:

- all tasks;
- one task id or project root;
- `hierarchy`;
- `completionBoundary`;
- `definitionOfDone`;
- `proofPaths`;
- `gateResults`;
- `reviewPlan`;
- `completionHandoff`;
- `decomposition`;
- `sizePlan`;
- `deliverySpine`;
- thread/inflight checklist state where available.

Outputs:

- per-task `workVisibility`;
- per-task `deliverySteps`;
- per-task `workProgressRollup`;
- project-level visible work counts;
- project-level delivery obligation counts.

Rules:

1. A task with children is not complete until its completion boundary and
   required child/step rollups are satisfied.
2. A task with `deliverySteps.required > done` cannot present as simply `Done`
   even if a child worker pass finished.
3. Internal delivery steps affect progress and blocking but do not appear in
   global task counts by default.
4. Dependency links stay separate from containment and delivery-step
   dependencies.
5. The runtime/API owns this derivation. UI components render the shared
   result and must not re-rank or reinterpret raw task records locally.

## UI Surface Changes

### Fleet / Projects Home

Files:

- `src/web/surfaces/ProjectsHome.svelte`
- `src/web/lib/project-summary.ts`
- `src/web/lib/ProjectCard.svelte`

Current behavior:

- project cards use `taskCounts.total`, `active`, `draftReview`, `blocked`,
  `done`, and `shelved`;
- copy says "task" for all counts;
- work mix bars represent raw task buckets.

Proposed behavior:

- project cards show visible logical work counts:
  - `12 work items`;
  - `3 moving`;
  - `2 need you`;
  - `1 blocked`;
  - `8 done`;
  - `17 delivery steps` only as secondary detail.
- work mix bars use visible logical work, not internal delivery steps.
- tooltip copy distinguishes "work items" from "delivery steps."
- `activityLabel`, `recentLabel`, and `nextLabel` should use the shared
  action/progress model rather than raw task totals.

Do not show:

- every check/documentation/proof delivery step as a project-card task count;
- "154 tasks" style totals when most records are internal proof steps.

### Project Overview

File:

- `src/web/surfaces/project/ProjectOverviewTab.svelte`

Current behavior:

- counts are derived from `detail.tasks`;
- `movingTasks`, `runPlanRows`, and `knowledgeCards` list tasks directly;
- proof paths are a separate small card.

Proposed behavior:

- "Work" knowledge card says visible work item totals.
- Add a compact delivery-progress line when meaningful:
  - `7 of 11 required delivery steps complete`;
  - `2 proof checks blocked`;
  - `1 owner setup step`.
- `movingTasks` should prefer logical items, with a one-line progress rollup:
  - `Import review flow`;
  - `3/5 delivery steps done · preview proof blocked`.
- `runPlanRows` should never show internal delivery steps unless an owner
  action or blocker makes the step the current decision.
- `primaryProofPaths` can stay, but should be tied to the selected logical item
  where possible.

### Work List

File:

- `src/web/surfaces/project/WorkTab.svelte`

Current behavior:

- filters and counts use `viewModel.tasks`;
- rows are task records;
- child count appears as "nested work";
- `taskSecondaryText` shows child counts, blockers, work kind, checkpoint, or
  description.

Proposed behavior:

- default list shows `primary` and selected `supporting` logical work.
- internal delivery steps are hidden from the default list.
- add a filter option for `Delivery steps` or a details toggle, not a default
  task-list mode.
- row secondary text for containing/logical work should prefer rollup:
  - `3/5 delivery steps done`;
  - `2 child items · 1 blocked`;
  - `Proof missing: runtime observation`;
  - `Needs you: approve external setup`.
- list header count changes from `N shown · M total` to:
  - `N work items shown · M visible total`;
  - optional secondary `K delivery steps tracked`.
- sorting by status uses `workProgressRollup.primaryState` first, raw task
  status second.

Do not:

- put every delivery step into the "Ready to run" list;
- count proof-only steps as queued tasks;
- let WorkTab compute its own delivery status from raw `proofPaths`.

### Work Columns / Hierarchy Preview

File:

- `src/web/surfaces/project/WorkTreePreview.svelte`

Current behavior:

- columns render roots, siblings, and child tasks;
- rollup is local and counts descendant tasks;
- empty child column says child tasks are missing.

Proposed behavior:

- rename column copy from "Child work" to "Contained work" for logical
  descendants.
- add a second compact section inside the selected item for delivery steps:
  - `Delivery checklist`;
  - `Build`, `Verify`, `Document`, `Review`, `Runtime proof`;
  - each with small status treatment.
- `rollupFor` should consume shared `workProgressRollup` instead of deriving
  from local descendant task counts.
- if a broad item has no logical children but does have delivery steps, the
  child column should not say "no child tasks" as a problem. It should say the
  item is a leaf with tracked delivery steps.
- if a broad item has neither logical children nor delivery steps, keep the
  "Review breakdown" pressure.

### Planner / Board

Files:

- `src/web/surfaces/project/PlannerTab.svelte`
- `src/web/lib/TaskCard.svelte`

Current behavior:

- each column counts task records;
- `TaskCard` is used as the mini-card;
- split/check/proof children can appear as ordinary cards.

Proposed behavior:

- board columns show logical work items only by default.
- `TaskCard` gets optional presentation fields from shared rollup:
  - `progressLabel`;
  - `progressTone`;
  - `deliverySummary`;
  - `childSummary`;
  - `visibilityKind`.
- for containing work, mini-card title remains the logical item and the summary
  line shows progress:
  - `Delivery: 3/5 done`;
  - `Nested: 2 open, 1 blocked`;
  - `Proof: runtime observation missing`.
- internal delivery steps should appear only when the board is scoped to a
  single logical item or when a step is blocked/owner-held.

### Task Drawer Shell

File:

- `src/web/surfaces/TaskDrawer.svelte`

Current behavior:

- drawer loads one task and passes task/detail data into tabs;
- actions include split, checklist rework, run, approve, hold, shelve, reframe.

Proposed behavior:

- drawer header should show logical item identity and rollup:
  - status chip from shared `primaryState`;
  - `3/5 delivery steps`;
  - `2 nested work items`;
  - `1 proof blocked`.
- if the opened record is an internal delivery step, drawer header should show
  its containing logical work and offer `Open containing work`.
- action buttons should name scope:
  - `Resume this work item`;
  - `Run next child`;
  - `Run delivery check`;
  - not generic `Run task` where scope is ambiguous.

### Drawer Overview

File:

- `src/web/surfaces/drawer/OverviewTab.svelte`

Current behavior:

- "Task links" mixes goal envelope, dependencies, delivery context, primitive
  use/proof, split callout, child tasks, recommended children, size, intake,
  checkpoint, and review plan.
- owner-facing copy still says "Child tasks" in places.

Proposed behavior:

- split "Task links" into clearer sections:
  - `Work hierarchy`: containing work, contained logical work, breadcrumbs;
  - `Dependencies`: blocked by / blocks;
  - `Delivery checklist`: internal delivery steps and proof obligations;
  - `Primitive and contract context`: primitives used/proved/blocking;
  - `Split recommendation`: only when logical child work is missing.
- rename "Child tasks" to "Contained work" or "Nested work" for logical items.
- use "Delivery checklist" for internal steps. Do not call these child tasks.
- recommended split children should be classified before display:
  - logical child candidates go under `Work to create`;
  - proof/check/documentation-only candidates go under `Delivery steps to create`.
- a logical item with complete delivery steps should show why the parent is
  complete or what proof is still missing.

### Drawer Current

File:

- `src/web/surfaces/drawer/CurrentTab.svelte`

Current behavior:

- shows current active Thread turns, worker-handoff cleanup, recovery, and
  task-level run actions;
- turn checklist exists for inflight/shaping state.

Proposed behavior:

- current tab should show the single current decision/action for the logical
  work item.
- if an internal delivery step is blocking completion, show it as the current
  step:
  - `Runtime proof is blocked`;
  - `Documentation step is still missing`;
  - `Owner setup step is waiting`.
- the current action should still route to Thread for questions/approval and
  to Spec/Journey for evidence review.
- local turn checklists can remain, but they should feed the shared delivery
  progress builder instead of becoming a second private progress model.

### Drawer Journey

File:

- `src/web/surfaces/drawer/JourneyTab.svelte`

Current behavior:

- fixed journey: Planned, Worker pass, Reviewed, Verified, Finished;
- proof paths and verification records are shown under Verified.

Proposed behavior:

- Journey should remain the narrative summary, not the main checklist editor.
- add a compact "Delivery completed" section near the top or under Finished:
  - required steps completed;
  - proof obligations satisfied;
  - skipped/not-applicable steps with reasons;
  - residual risk.
- proof path rendering stays here, but proof path status also feeds the shared
  delivery rollup.

### Thread

File:

- `src/web/surfaces/project/ThreadTab.svelte`

Current behavior:

- Thread renders setup, request, brief approval, spec review, agent questions,
  inflight cards, bounded chat, and owner input turns.
- inflight turns can include a checklist.

Proposed behavior:

- when Guildhall shapes work, Thread says whether it created logical work,
  delivery steps, or both:
  - `Created 3 work items and 8 delivery steps`;
  - `Kept checks/docs/proof inside the import review item so the Work list stays
    focused.`
- Thread should not post every delivery step as its own turn unless that step
  needs owner input, is blocked, or is actively being run.
- brief/spec review should show delivery obligations as part of "what done
  means," not as a flat task list.

### Inbox / Needs You

Files:

- `src/web/surfaces/project/InboxTab.svelte`
- `src/web/surfaces/project/NeedsYouTab.svelte`

Current behavior:

- inbox items are separate from task cards and can route into task drawers.

Proposed behavior:

- owner-held delivery steps appear here when they require owner action:
  - external setup;
  - product decision;
  - manual proof;
  - capability grant;
  - contract-result review.
- inbox item copy should name the logical work item and the specific step:
  - `Import review flow: runtime proof needs a target URL`;
  - not `task-import-review-runtime-proof blocked`.

## Visibility Matrix

| Surface | Show logical work? | Show delivery steps? | Count delivery steps? |
| --- | --- | --- | --- |
| ProjectsHome project card | Yes | Summary only | No |
| Project Overview | Yes | Summary and blockers | No |
| Work list default | Yes | No, unless blocking/owner-held | No |
| Work list delivery filter | Scoped logical item or all | Yes | Separate delivery count |
| Work columns | Yes | Inside selected item | Separate delivery count |
| Planner board | Yes | No, unless scoped/blocked | No |
| Task mini-card | Yes | One-line rollup | No |
| Task drawer header | Yes | Compact rollup | Separate delivery count |
| Drawer Overview | Yes | Full checklist | Separate delivery count |
| Drawer Current | Current logical item | Current blocking/active step | Separate delivery count |
| Drawer Journey | Yes | Completed proof/history | Separate delivery count |
| Thread | Current interaction | Only active/owner/blocking steps | No |
| Inbox / Needs You | Owner-relevant work | Owner-held steps | No |

## API And Runtime Changes

Add shared runtime builders and expose their results through existing payloads.

1. Add `src/runtime/work-progress.ts`.
2. Extend project detail payloads with:

```ts
type ProjectWorkProgress = {
  counts: {
    visibleTotal: number
    visibleActive: number
    visibleBlocked: number
    visibleDone: number
    visibleShelved: number
    deliveryTotal: number
    deliveryRequired: number
    deliveryDone: number
    deliveryBlocked: number
    deliveryNeedsOwner: number
  }
  byTaskId: Record<string, {
    visibility: WorkVisibility
    rollup: WorkProgressRollup
    deliverySteps: DeliveryStep[]
  }>
}
```

3. Keep legacy `taskCounts` only as a temporary migration/read fallback, and
   make `project-summary.ts` prefer `workProgress.counts`.
4. Extend `/api/project/task/:id` drawer payload with the selected task's
   visibility, delivery steps, and rollup.
5. Replace `src/web/lib/work-hierarchy.ts` local rollup math with a UI adapter
   over runtime/API rollups. The UI adapter can still build breadcrumbs and
   column paths locally.

## Implementation Slices

### Slice 1: Read-only derived progress

- Build `work-progress.ts`.
- Derive visibility defaults from current task fields.
- Derive delivery steps from existing `definitionOfDone`, `proofPaths`,
  `reviewPlan.requiredArtifacts`, `gateResults`, `completionHandoff`, and
  checklist state where available.
- Add tests using existing task fixtures.
- No persisted schema changes in this slice; the purpose is to prove the
  migration classifier and UI contract before rewriting local project state.

### Slice 2: Service and project summary counts

- Add `workProgress` to service/project detail payloads.
- Update `project-summary.ts` and `ProjectCard.svelte` copy to use visible
  work counts.
- Keep `taskCounts` fallback only for pre-migration reads.
- Add service dashboard tests.

### Slice 3: Work surfaces

- Update `WorkTab.svelte`, `WorkTreePreview.svelte`, `PlannerTab.svelte`, and
  `TaskCard.svelte` to render logical work first and delivery rollups second.
- Add a scoped delivery-step filter/detail treatment.
- Add component tests for hiding internal steps from default counts.

### Slice 4: Drawer surfaces

- Update drawer header, `OverviewTab`, `CurrentTab`, and `JourneyTab`.
- Split hierarchy/dependencies/delivery checklist sections.
- Rename remaining owner-facing "Child tasks" copy where it means logical
  containment.
- Add tests for a logical UI control with internal check/document/proof steps.

### Slice 5: Persisted delivery steps

- Add `workVisibility` and `deliverySteps` schemas after read-only derivation
  proves useful.
- Add a local-project migration and backup/restore path.
- Update decomposition/materialization so check/document/proof recommendations can
  become delivery steps instead of visible child tasks when appropriate.

## Acceptance Criteria

- Project cards count visible logical work items, not internal delivery steps.
- Work list default hides internal delivery steps while still showing parent
  progress.
- A logical task cannot show complete if required delivery steps or proof
  obligations are incomplete.
- Drawer Overview shows contained work separately from delivery checklist.
- Thread shaping copy names how many logical items and delivery steps were
  created.
- Projects without new fields render well enough to migrate safely.
- Tests cover current split-child records, new derived delivery steps, and the
  no-overcount project-card case.

## Open Questions

- Should `supporting` logical work count in project totals by default, or only
  inside its containing item?
- Should proof/check/documentation split children be migrated into delivery steps, or
  only classified as internal-step tasks at read time?
- Should delivery steps have their own URLs, or only anchors inside the
  containing work drawer?
- Should a blocked internal delivery step appear in the Work list automatically,
  or only in Inbox/Needs You and the containing drawer?
- What is the owner-facing label: "delivery steps", "completion checklist",
  "proof checklist", or "delivery checklist"?
