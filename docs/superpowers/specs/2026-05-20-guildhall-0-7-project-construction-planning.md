# Guildhall 0.7.0 — Project Construction Planning

## Status

Target specification for `0.7.0`.

## Purpose

Guildhall `0.6.0` turned construction language into runtime behavior: survey,
blueprint, frame, trade work, inspection, change orders, punch list, bounded
recovery, typed handoff evidence, and scoped learning.

`0.7.0` should close the next gap: Guildhall must be able to take an ambitious
product goal and shape it into a durable, inspectable construction plan before
it creates or dispatches implementation tasks.

The product voice should never be "this is too large." The product behavior
should be:

> This is a product construction job. Guildhall will map the work, identify the
> first livable slice, ask only the decisions that affect product intent, and
> turn the active slice into buildable tasks.

## Privacy And Example Policy

This spec intentionally avoids naming any private commercial product that may be
used to dogfood Guildhall. Public Guildhall docs and discoverable repo artifacts
should use generic scenarios:

- "large greenfield desktop app"
- "authoring tool"
- "design-heavy SaaS product"
- "data-heavy internal platform"
- "offline-first collaborative editor"

If a private product is used as a validation scenario, keep its details in local
test fixtures, private planning notes, or anonymized acceptance examples. Public
docs should describe the class of work, not the confidential business idea.

## Diagnosis

The current construction model has the right philosophy, but it is still missing
the user's visible floorplan.

### What 0.6.0 Already Has

- task-stage discipline
- construction-mode metadata
- blueprint sanity review
- durable artifact expectations
- scoped learning
- change-order language
- bounded recovery playbooks
- typed handoff packets
- compact Thread visibility

### What Still Fails

1. **The plan is not a first-class object.** The house metaphor exists, but the
   floorplan is distributed across task specs, notes, transcript history, and
   release language.
2. **Decomposition is task-local.** `exploring` can split one ask into child
   tasks, but Guildhall does not reliably create a product map for a large goal.
3. **The user must still supply too much structure.** The owner should not have
   to ask for vertical slices, active tranches, or dependency order by name.
4. **Execution can still look like queue chewing.** A backlog can contain valid
   tasks without making the active build sequence legible.
5. **Project phases are under-modeled.** `exploring`, `ready`, and `in_progress`
   are task states, not project construction layers.
6. **Task generation is not anchored strongly enough to slices.** Tasks should
   derive from a selected slice of product value, not from a loose list of
   plausible work.
7. **Change orders do not yet reshape the full plan.** A task can report a plan
   mismatch, but the higher-level construction plan is not always updated.

## Product Thesis

Guildhall should help the owner move from ambition to controlled execution.

The owner can bring a large product idea. Guildhall should respond by creating a
construction plan with:

- product goal
- known constraints
- product areas
- phases
- vertical slices
- dependencies
- active tranche
- required owner decisions
- inferred defaults
- buildable tasks
- verification strategy
- change-order history

This is not heavyweight PM software. It is the minimum durable structure that
lets Guildhall and the owner agree on what is being built now, what waits, and
why.

## User Experience Principles

1. **Never scold ambition.** Do not tell the owner the goal is too large. Shape
   it.
2. **Show the floorplan before the task queue.** Let the owner see areas,
   phases, and slices before they see dozens of tasks.
3. **Ask fewer, better questions.** Questions must block a decision that affects
   product intent, user value, data ownership, risk, budget, or release shape.
4. **Recommend defaults.** Guildhall should propose the first plan, not ask the
   owner to design the planning system.
5. **Make later work visible but inactive.** The owner should know the broader
   product shape without feeling every future task is urgent.
6. **Build one livable slice at a time.** Execution should proceed from active
   tranche to task specs to implementation.
7. **Treat plan changes as normal.** Change orders update the construction plan,
   not just a task note.

## Core Artifact: Construction Plan

Add a durable project-level artifact:

```yaml
version: 1
project:
  summary: "Build a serious offline-first authoring application"
  audience: "professional users"
  promise: "Create, edit, review, preview, and export work with confidence"
  constraints:
    - "offline-first editing"
    - "privacy-sensitive user content"

site:
  repoShape:
    root: "/path/to/project"
    packageManager: "pnpm"
    appFramework: "Tauri + Vue"
  hazards:
    - id: "private-content"
      summary: "Do not expose private product details in public docs"
  baselineVerification:
    - "pnpm typecheck"
    - "pnpm test"

areas:
  - id: "app-shell"
    name: "App Shell"
    purpose: "Create a navigable product frame"
    risk: "medium"
  - id: "local-storage"
    name: "Local Storage"
    purpose: "Save and reopen work without network"
    risk: "high"

phases:
  - id: "foundation"
    name: "Foundation"
    outcome: "The product can open, save, and navigate a local project"
    areaIds: ["app-shell", "local-storage"]
  - id: "first-livable-slice"
    name: "First Livable Slice"
    outcome: "A user can complete the first meaningful workflow"
    areaIds: ["app-shell", "editor", "local-storage"]

slices:
  - id: "create-write-reopen"
    phaseId: "foundation"
    title: "Create, write, save, reopen"
    userValue: "A user can trust the app with a small piece of real work"
    status: "active"
    areaIds: ["app-shell", "editor", "local-storage"]
    dependencies: []
    acceptance:
      - "Create a new local project"
      - "Edit content in the primary editor"
      - "Close and reopen without data loss"
    verification:
      - "typecheck"
      - "unit tests for persistence"
      - "browser/manual smoke for reopen flow"
    outOfScope:
      - "cloud sync"
      - "AI features"

activeTranche:
  sliceIds: ["create-write-reopen"]
  rationale: "Proves the product can be trusted with local work before adding intelligence or sync"

decisions:
  required:
    - id: "desktop-shell"
      question: "Should the first build target desktop only?"
      recommended: "yes"
      reason: "Offline/local guarantees are central to the first slice"
  inferred:
    - id: "component-layer"
      decision: "Use existing UI component stack where available"
      evidence: "Repo already depends on it"

tasks:
  generated:
    - id: "task-app-shell"
      sliceId: "create-write-reopen"
      title: "Build the local project shell"
      status: "proposed"

changeOrders: []
```

The exact storage format can be YAML, JSON, or project-local markdown with
structured blocks. The important product contract is that the plan is durable,
editable, reviewable, and used by the runtime.

## Storage Location

First implementation should store the construction plan under project memory:

- `memory/construction-plan.yaml`
- `memory/construction-plan.history.jsonl`

Later, this can move into a typed runtime store. The first slice should avoid a
large migration if project memory is enough.

## Public UI: Build Map

Add a project-level Build Map view or section.

The Build Map should show:

- project promise
- current phase
- active tranche
- product areas
- slices grouped by phase
- dependency edges
- owner decisions needed
- inferred decisions
- change orders
- generated tasks for the selected slice

It should not show:

- raw agent transcript
- every future task as equally urgent
- implementation internals unless expanded
- private validation scenario labels

### Suggested Layout

```text
Project Construction

Promise
  Build a serious offline-first authoring application...

Current Tranche
  Create, write, save, reopen
  Why now: proves local trust before sync or AI

Phases
  Foundation
    [active] Create, write, save, reopen
    [later] Import existing work
  First Livable Slice
    [blocked] Review and export loop

Areas
  App Shell      in active tranche
  Editor         in active tranche
  Local Storage  in active tranche
  Sync           later
  Intelligence   later

Decisions
  Needs owner: Desktop-only first build?
  Inferred: Use current component stack
```

The Build Map should be calm and compact. It is a planning surface, not a
Gantt-chart product.

## Thread Behavior

Thread should summarize plan changes without forcing the owner to read the full
Build Map.

Examples:

- "Guildhall mapped this as 6 product areas, 4 phases, and 9 candidate slices."
- "The active tranche is now `Create, write, save, reopen`."
- "3 tasks were generated from that slice."
- "A change order moved cloud sync out of Foundation because local durability is
  not proven yet."

Thread cards should link to the relevant plan section.

## Intake Behavior

When the owner gives a large product goal, the Spec Agent should enter
`construction-planning` behavior.

It should:

1. Survey repo and existing docs.
2. Produce a short "what Guildhall knows" summary.
3. Draft or update the construction plan.
4. Recommend product areas.
5. Recommend phases.
6. Recommend the first active tranche.
7. Ask only decisions that affect the plan.
8. Generate child tasks from the approved active slice.

It must not:

- say "this is too large"
- ask the owner to manually decompose the whole product
- create dozens of ready tasks before a construction plan exists
- bury the plan in a transcript
- expose private product validation context in public docs

## Coordinator Behavior

The Coordinator owns the construction plan.

Responsibilities:

- keep the plan current
- select active tranche
- explain why active work is active
- move slices between phases
- generate tasks from slices
- pause slices when prerequisites fail
- record change orders
- retire completed slices
- prevent queue chewing outside the active tranche

The Coordinator should be able to answer:

- What are we building?
- What is the current phase?
- What is the current active slice?
- Why this slice now?
- What is blocked?
- What decision does the owner need to make?
- What changed since the last plan?

## Task Generation From Slices

Generated tasks must reference their parent slice.

Task fields should include:

- `constructionPlanId`
- `sliceId`
- `areaIds`
- `phaseId`
- `dependencyTaskIds`
- `sliceAcceptanceCriteria`
- `outOfScope`
- `verificationPlan`

The task spec can still be self-contained, but the runtime should preserve the
link so reviewers and later agents can inspect broader context.

## Active Tranche Rules

Only tasks in the active tranche should be dispatch-eligible by default.

Allowed exceptions:

- bug fix that blocks current tranche
- setup task needed by current tranche
- direct owner command
- small documentation/cleanup task that does not compete for build capacity
- urgent safety/security issue

If a task outside the active tranche becomes tempting, the Coordinator should
either:

- explain why it should wait
- promote its slice with rationale
- record a change order

## Change Orders

Change orders should update both the task and the construction plan.

Fields:

```yaml
id: "co-001"
createdAt: "2026-05-20T12:00:00Z"
source:
  taskId: "task-local-storage"
  agentId: "worker"
oldAssumption: "IndexedDB persistence is enough for desktop local storage"
newEvidence: "Tauri filesystem APIs are required for project archive export"
proposedChange: "Add local file adapter task before archive export"
impact:
  scope: "adds one foundation task"
  sequencing: "archive export waits"
  risk: "reduces data loss risk"
approval:
  required: false
  reason: "implementation detail within accepted local-first goal"
```

Change-order UI should show:

- old assumption
- new evidence
- impact
- whether owner approval is needed
- affected slices/tasks

## Decision Model

Decisions should be split into:

- **Owner decisions:** affect product intent, audience, budget, data ownership,
  privacy, UX direction, or release promise.
- **Coordinator decisions:** affect sequencing, tranche selection, inferred
  defaults, routine scope boundary.
- **Worker decisions:** affect implementation mechanics inside an accepted task.

Decision prompts should include:

- recommended option
- why it matters
- what happens if the owner does not answer now
- affected slices/tasks

## Confidentiality Controls

Guildhall should support private validation without leaking product specifics.

Rules:

- Public docs use anonymized product categories.
- Generated public specs should not include private project names unless the
  target repo itself is that project.
- Product suggestions emitted from private dogfood runs should redact project
  names, product category, and commercially sensitive features.
- Memory entries can store project-specific details inside that project, but
  cross-project/global learnings must generalize them.
- Build Map examples bundled with Guildhall should use fictional neutral apps.

This lets Guildhall be dogfooded on real ambitious work without turning its
public docs into a product leak.

## Runtime Changes

### 1. Construction Plan Store

Add a runtime module, likely `src/runtime/construction-plan.ts`.

Functions:

- `loadConstructionPlan(project): ConstructionPlan | null`
- `saveConstructionPlan(project, plan): void`
- `appendConstructionPlanEvent(project, event): void`
- `deriveConstructionSummary(plan): ConstructionSummary`
- `validateConstructionPlan(plan): ValidationResult`
- `selectActiveTranche(plan): ActiveTranche`
- `tasksForSlice(plan, sliceId): GeneratedTaskDraft[]`

### 2. Plan Event Log

Record plan mutations in `memory/construction-plan.history.jsonl`.

Event types:

- `plan_created`
- `plan_revised`
- `area_added`
- `phase_added`
- `slice_added`
- `slice_promoted`
- `slice_deferred`
- `active_tranche_selected`
- `task_generated`
- `change_order_recorded`
- `decision_recorded`
- `decision_resolved`

### 3. Task Schema Extensions

Add optional fields to tasks:

```ts
construction?: {
  planId: string
  phaseId?: string
  sliceId?: string
  areaIds?: string[]
  generatedFrom?: 'construction_plan' | 'import' | 'manual'
}
```

Keep optional fields backward-compatible. Existing tasks should not need
migration.

### 4. Intake Routing

Add detection for large product construction asks.

Signals:

- user asks to build a product, app, platform, editor, service, or tool
- request includes many product areas or workflows
- repo has little implementation but substantial specs/docs
- imported docs contain roadmap/architecture/product strategy
- task would naturally generate multiple slices

Detection outcome:

- route to construction planning before normal task spec drafting
- create/update construction plan
- do not dispatch implementation until an active tranche exists

### 5. Active Tranche Dispatch Filter

Update dispatcher logic so active-tranche tasks are preferred and non-tranche
tasks are suppressed unless an exception applies.

The suppression should be explainable:

- `not_in_active_tranche`
- `blocked_by_slice_dependency`
- `waiting_for_owner_decision`
- `deferred_by_construction_plan`

### 6. Change Order Integration

When a worker, reviewer, or gate raises `scope_boundary`, `spec_wrong`,
`dependency_missing`, or similar findings, the Coordinator should be able to
convert the finding into a construction-plan change order.

### 7. Build Map API

Add project-scoped endpoints:

- `GET /api/project/construction-plan`
- `POST /api/project/construction-plan/draft`
- `POST /api/project/construction-plan/approve`
- `POST /api/project/construction-plan/select-active-tranche`
- `POST /api/project/construction-plan/decision/:id`
- `POST /api/project/construction-plan/change-order/:id/approve`
- `POST /api/project/construction-plan/generate-tasks`

First slice may implement only read, draft, approve, and generate-tasks if the
full mutation surface is too large.

## UI Changes

### Build Map View

Add a Build Map route under the project shell.

Minimum sections:

- project promise
- current phase
- active tranche
- product areas
- phase/slice list
- decisions
- generated tasks
- change orders

### Work View Integration

Work view should group tasks by:

- active tranche
- later slices
- blocked by construction decision
- unrelated/manual tasks

### Thread Integration

Thread should show compact plan events with links to Build Map.

### Task Drawer Integration

Task drawer should show:

- parent slice
- parent phase
- product area
- slice acceptance criteria
- why this task is active now
- change orders affecting the task

## Agent Prompt Changes

### Spec Agent

Add rules:

- detect product-construction asks
- draft a construction plan before child tasks
- produce product areas, phases, slices, and active tranche
- ask only decisions that materially affect the plan
- use anonymized public examples in Guildhall docs

### Coordinator

Add rules:

- own the construction plan
- select active tranche
- prevent dispatch outside the tranche without reason
- turn plan-affecting discoveries into change orders
- keep later work visible but inactive

### Worker

Add rules:

- read parent slice context before implementation
- report when task work contradicts slice assumptions
- do not expand task scope to complete the whole slice unless assigned

### Reviewer

Add rules:

- inspect task against both task acceptance and parent slice intent
- distinguish task-local failure from slice-plan failure
- recommend change order when slice assumptions are wrong

## Implementation Phases

### Phase 1 — Artifact And Read API

Goal: Guildhall can store and display a construction plan.

Changes:

- define `ConstructionPlan` TypeScript types
- add loader/saver
- add history event log
- add validation tests
- add read endpoint
- add a basic Build Map read-only UI

Acceptance:

- a project with `memory/construction-plan.yaml` shows Build Map
- invalid plans show actionable validation messages
- no existing project breaks without a plan

### Phase 2 — Construction Intake Draft

Goal: Guildhall can draft a plan from a large goal.

Changes:

- add construction-intake detection
- add prompt instructions for plan drafting
- add draft endpoint
- add approval flow
- add Thread summary card

Acceptance:

- large product ask creates a draft plan, not a pile of tasks
- owner can approve or revise the plan
- generated public copy is generic and does not leak private validation examples

### Phase 3 — Active Tranche And Task Generation

Goal: Guildhall can turn an approved active slice into tasks.

Changes:

- add active tranche selection
- generate task drafts from selected slice
- attach construction metadata to tasks
- update Work grouping
- update dispatcher preference/suppression

Acceptance:

- tasks generated from a slice reference that slice
- dispatcher prefers active-tranche tasks
- non-tranche tasks show a clear suppressed/deferred reason

### Phase 4 — Change Orders And Plan Repair

Goal: plan-affecting discoveries update the plan.

Changes:

- add change-order type and UI
- convert relevant escalations into change-order drafts
- support owner/coordinator approval rules
- update affected slices/tasks when change orders land

Acceptance:

- a worker can report a wrong assumption
- Coordinator records a change order
- Build Map shows old assumption, new evidence, and impact
- affected tasks show the change-order context

### Phase 5 — Release/Phase View Polish

Goal: Guildhall feels like it is building through a coherent release, not just
managing one plan file.

Changes:

- phase progress indicators
- tranche completion state
- release readiness tie-in
- punch-list generation from incomplete slice acceptance
- docs and release note updates

Acceptance:

- owner can answer "what is Guildhall building now?"
- owner can answer "what waits?"
- owner can answer "what changed?"
- release view reflects tranche status

## Acceptance Criteria For 0.7.0

1. Guildhall creates or loads a durable construction plan for ambitious product
   work.
2. The plan contains product areas, phases, slices, active tranche, decisions,
   tasks, and change orders.
3. Large product asks route through construction planning before task generation.
4. The UI exposes a Build Map that is useful without reading transcripts.
5. The Coordinator selects and explains the active tranche.
6. Tasks generated from slices preserve construction metadata.
7. Dispatcher prioritizes active-tranche work and explains suppression of later
   work.
8. Workers and reviewers can trigger change-order updates to the plan.
9. Owner questions are tied to affected plan decisions.
10. Public Guildhall docs and examples do not reveal private dogfood product
    details.
11. Existing projects without construction plans continue to work.
12. Verification covers typecheck, unit tests, docs build, and at least one
    scenario test for ambitious-product intake.

## Non-Goals

- Do not build a full Jira/Gantt/roadmap suite.
- Do not require every small task to have a construction plan.
- Do not block direct manual tasks when the owner explicitly asks for them.
- Do not expose private dogfood products in bundled examples.
- Do not force the owner to approve every coordinator sequencing decision.
- Do not implement full multi-release analytics in 0.7.0.

## Scenario Tests

Use anonymized fixtures.

### Scenario 1: New Product From Existing Specs

Input:

- repo contains product strategy docs
- user asks Guildhall to start building the app

Expected:

- Guildhall drafts construction plan
- plan has at least 4 areas and 3 slices
- active tranche is a small user-visible workflow
- no implementation tasks are dispatched until tranche approval

### Scenario 2: Large Ask In Existing App

Input:

- repo has established app structure
- user asks for a major new feature family

Expected:

- Guildhall creates a feature-level construction plan
- tasks link to parent slice
- dispatcher selects active slice tasks first

### Scenario 3: Plan-Affecting Discovery

Input:

- worker discovers accepted storage assumption is wrong

Expected:

- worker raises change-order-style escalation
- Coordinator records change order
- affected slice sequencing updates
- owner is asked only if product intent or risk changes

### Scenario 4: Confidential Dogfood Redaction

Input:

- internal validation uses a private product fixture

Expected:

- public docs use generic product labels
- product suggestions redact private names and sensitive features
- cross-project learning generalizes the lesson

## Verification Plan

Minimum commands:

- `pnpm typecheck`
- `pnpm test`
- `pnpm docs:build`
- `pnpm docs:check-help-sync`

Focused tests:

- construction plan loader/saver
- construction plan validation
- active tranche selection
- task generation from slice
- dispatcher suppression reasons
- change-order event logging
- construction-intake detection
- redaction/generalization for product suggestions

## Open Questions

1. Should `memory/construction-plan.yaml` be user-editable, or should the UI be
   the primary editor?
2. Should one project have exactly one active construction plan, or can it have
   multiple feature-level plans?
3. Should active tranche approval be explicit by default, or inferred from owner
   approval of the draft plan?
4. How much of the Build Map belongs in Thread versus a dedicated route?
5. Should construction plan history be append-only forever, or compacted with
   checkpoints?
6. Which fields should be promoted into `TASKS.json` versus resolved by joining
   against the construction plan at runtime?

