# Guildhall Execution-Planning Decomposition Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This is an internal architecture and product plan, not public documentation.

**Goal:** Replace "split recommendation" semantics with an execution-planning model where Guildhall automatically decomposes accepted work into correctly sized child work without asking the owner to approve ordinary LLM work sizing.

**Architecture:** Treat decomposition as an operational next action over a flexible work graph. Work hierarchy is the source of truth; split/action records are audit and orchestration records; UI surfaces derive parent state, progress, and visibility from the graph instead of rewriting parent task text or preserving stale recommendation arrays.

**Tech Stack:** TypeScript schemas in `src/core`, runtime builders and queue mutation in `src/runtime` and `src/tools`, shared work hierarchy/progress derivations, Svelte project surfaces, Vitest, rendered UI flow-audit checks, installed-app browser proof against real projects.

---

## Why This Exists

Guildhall currently has the right instinct but the wrong model language.

The product needs to break broad work into smaller work because LLM execution has a bounded context, proof, and review envelope. That is Guildhall doing its job. It is not a suggestion to the owner.

Current code still treats this as "recommended children":

- `TaskSizePlan.action` can be `split_recommended` or `split_required`.
- `TaskSizePlan.recommendedChildren` stores proposed child titles.
- `TaskSplitRecommendation.createdTaskId` optionally points to a materialized child task.
- `taskReadiness.recommendation` can separately say `split`.
- specs can contain live text such as "What must be split or blocked: X must still be split."
- coordinators then need settlement code to rewrite stale parent state once child tasks exist.

That model creates exactly the failure the owner noticed: Guildhall appears to patch stale data instead of deriving accurate state from the actual work graph.

The replacement model:

```text
Accepted work can be decomposed automatically.
Scope changes require owner authority.
Decomposition is an execution-planning next action, not a recommendation.
Parent state is derived from child work and delivery obligations.
Visibility controls which levels show in each view.
```

## Non-Negotiable Product Rules

1. **Ordinary splitting is not owner approval territory.**
   Guildhall may automatically split accepted work into smaller child work when that is necessary to give an LLM the right scope.

2. **Owner authority is about scope, not work sizing.**
   Ask the owner only when Guildhall would add, remove, defer, reprioritize, or reinterpret accepted scope; when goals conflict; or when external permission/access/risk is involved.

3. **Users can do what Guildhall can do.**
   The owner can manually split, merge, move, hide, show, defer, or reorder work, but those are editing affordances, not required approval checkpoints.

4. **No "recommendation" copy for required execution planning.**
   Owner-facing copy should say "Guildhall split this work" or "Guildhall is splitting this before continuing," not "Split recommended."

5. **Hierarchy is arbitrary depth.**
   A release can contain features, features can contain tasks, tasks can contain steps, and steps can split into smaller steps. Labels describe presentation and intent, not rigid schema limits.

6. **Visibility is separate from containment.**
   Some child work should be visible in the 1,000-foot map; some should only appear in Work; some should be hidden by default as internal delivery/proof steps. It is the same graph with different filters.

7. **No parent prose as live state.**
   A parent spec may describe the accepted completion boundary. It must not be the runtime source of truth for whether children already exist or whether a split is satisfied.

## Current Model Problems

### Duplicated Authority

The same idea currently appears in too many places:

- `sizePlan.action`
- `sizePlan.recommendedChildren`
- `taskReadiness.recommendation`
- `decomposition.action`
- `hierarchy.childIds`
- `deliverySteps`
- `spec`
- `structuredSpec.completionBoundary.whatMustBeSplitOrBlocked`

Only one thing should answer "is this decomposed enough to proceed?": a shared derived work-planning model over hierarchy and delivery obligations.

### Recommendation Semantics

`recommendedChildren` implies owner choice. That is wrong for execution sizing.

The actual state is one of:

- Guildhall plans to split.
- Guildhall is splitting.
- Guildhall split.
- Guildhall could not split because it lacks accepted scope/context.
- Guildhall needs owner authority because the next action would change scope.

None of those is "recommendation."

### Title-Based Reconciliation

Current settlement still falls back to matching child titles. That is inherently brittle. Child title changes should not break whether a parent split was fulfilled.

### Stale Parent Instructions

Parent tasks can keep text that says work "must still be split" after children exist. Recent settlement code patches this, but that is a compatibility repair, not the desired architecture.

### Rigid Mental Model Around Task Vs Step

Guildhall already has `hierarchy`, `deliverySteps`, `workKind`, `taskKind`, and `workVisibility`, but the model still sometimes treats "task" and "step" as separate conceptual worlds.

The real model should be:

```text
work node + kind + visibility + runnable/proof semantics
```

A step can become containing work if it needs decomposition.

## Target Vocabulary

### Work Node

The canonical persisted unit of work. It can represent a release, feature, task, step, proof obligation, research lane, migration lane, setup lane, or review lane.

Initial implementation can keep using `Task` records as the storage object. The product language should shift toward "work item" or "work node" in internal code and UI.

### Containing Work

A work node whose state is derived primarily from child work and delivery obligations. It may be visible in high-level maps and may not be directly runnable.

### Runnable Work

A work node with a bounded enough context/proof envelope for a worker/reviewer/gate loop.

### Internal Work

Child work used for proof, review, setup, migration, or implementation sequencing that should not inflate every project count or 1,000-foot view.

### Execution-Planning Action

An operational action Guildhall may take to make accepted work executable:

- split work;
- create proof step;
- create review step;
- convert internal step to visible child work;
- hide/show a child level;
- mark a child as deferred within the selected bounded scope only when the scope already allows that deferral.

### Scope-Authority Action

An action that needs owner authority because it changes what the project/release means:

- add new feature/scope;
- drop accepted feature/scope;
- defer accepted scope to a later release when the bounded scope did not already permit that;
- change release boundary;
- choose between conflicting product goals;
- grant external access/permission;
- perform irreversible owner-risky operations.

## Target Data Model

This plan is intentionally staged so current `Task` persistence can migrate safely. The target conceptual model is below.

### `WorkHierarchy`

Current:

```ts
export const WorkHierarchy = z.object({
  parentId: z.string().optional(),
  childIds: z.array(z.string()).default([]),
  order: z.number().int().optional(),
})
```

Change:

```ts
export const WorkHierarchy = z.object({
  parentId: z.string().optional(),
  childIds: z.array(z.string()).default([]),
  order: z.number().int().optional(),
  relation: z.enum([
    'contains',
    'decomposes',
    'proves',
    'reviews',
    'sets_up',
    'migrates',
  ]).default('contains'),
})
```

Purpose:

- preserve arbitrary-depth containment;
- let UI distinguish feature/task decomposition from proof/review/setup children;
- avoid separate hardcoded task-vs-step trees.

Migration:

- missing `relation` becomes `contains`;
- children created from split/decomposition become `decomposes`;
- children created as proof-only work become `proves`;
- existing `deliverySteps.sourceTaskId` can infer `proves` or `decomposes` based on kind.

### `WorkKind`

Current `workKind` exists but is not yet the canonical presentation selector.

Change the enum to support broad but non-rigid labels:

```ts
export const WorkKind = z.enum([
  'release',
  'capability',
  'feature',
  'task',
  'step',
  'proof',
  'review',
  'research',
  'setup',
  'migration',
  'docs',
  'decision',
])
```

Rules:

- `workKind` describes intent and presentation, not schema limits.
- Any `workKind` may have children.
- Any child may be visible or internal.
- Depth does not imply kind. A feature can contain features; a step can contain steps.

### `WorkVisibility`

Current work visibility exists but needs to become the display contract.

Target:

```ts
export const WorkVisibility = z.object({
  level: z.enum([
    'scope_map',
    'work_list',
    'drawer',
    'internal',
  ]).default('work_list'),
  hiddenByDefault: z.boolean().default(false),
  reason: z.string().optional(),
})
```

Display meaning:

- `scope_map`: appears in 1,000-foot Project Map / scoped skeleton.
- `work_list`: appears in ordinary Work views and can be selected/run.
- `drawer`: appears inside parent detail/proof/progress sections, not top-level lists.
- `internal`: normally hidden except debug/audit/detail views.

Migration:

- existing visible logical tasks default to `work_list`;
- containing features/project skeleton nodes default to `scope_map`;
- delivery/proof child tasks default to `drawer` or `internal`;
- current `shelved` duplicates remain hidden from normal action flow but visible in history.

### `ExecutionPlanAction`

Add an append-only action record. It is not a recommendation.

```ts
export const ExecutionPlanAction = z.object({
  id: z.string(),
  type: z.enum([
    'split_work',
    'create_proof_work',
    'create_review_work',
    'create_setup_work',
    'create_migration_work',
    'change_visibility',
    'reorder_work',
    'merge_work',
  ]),
  targetWorkId: z.string(),
  status: z.enum([
    'planned',
    'applying',
    'applied',
    'failed',
    'superseded',
  ]),
  authority: z.literal('execution_planning'),
  rationale: z.string(),
  createdChildIds: z.array(z.string()).default([]),
  createdAt: z.string(),
  createdBy: z.string(),
  appliedAt: z.string().optional(),
  appliedBy: z.string().optional(),
  failureReason: z.string().optional(),
})
```

Rules:

- `split_work` creates child work nodes.
- `createdChildIds` is audit output, not the source of truth. The hierarchy is the source of truth after apply.
- no `awaiting_approval` state for ordinary execution planning.
- failed actions route to coordinator recovery, not owner approval, unless the failure reason is actually a scope-authority problem.

### `ScopeAuthorityRequest`

Separate from execution planning.

```ts
export const ScopeAuthorityRequest = z.object({
  id: z.string(),
  type: z.enum([
    'add_scope',
    'drop_scope',
    'defer_scope',
    'change_release_boundary',
    'resolve_goal_conflict',
    'external_permission',
    'irreversible_operation',
  ]),
  targetWorkId: z.string().optional(),
  status: z.enum(['open', 'answered', 'withdrawn']),
  question: z.string(),
  whyItMatters: z.string(),
  options: z.array(z.object({
    id: z.string(),
    label: z.string(),
    consequence: z.string(),
  })).default([]),
  createdAt: z.string(),
  createdBy: z.string(),
  answeredAt: z.string().optional(),
  answeredBy: z.string().optional(),
  answer: z.string().optional(),
})
```

Rules:

- this is the only owner-checkpoint path for scope authority;
- no normal decomposition work should create this;
- UI language should be "Needs your decision" only for this class.

### Deprecate `TaskSizePlan.recommendedChildren`

Do not remove it immediately. Change its role:

```ts
// Legacy compatibility only. New code must not use this as runtime authority.
recommendedChildren: TaskSplitRecommendation[]
```

Replacement:

- `sizePlan` can still assess size/risk.
- if too broad, the coordinator creates an `ExecutionPlanAction(type: 'split_work')` and applies it.
- child work nodes are persisted directly.
- parent readiness is derived from `hierarchy`, child statuses, and delivery obligations.

Long-term shape:

```ts
export const TaskSizePlan = z.object({
  taskId: z.string(),
  score: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(5), z.literal(8)]),
  band: TaskSizeBand,
  action: z.enum([
    'proceed',
    'proceed_with_warning',
    'decompose_before_execution',
    'needs_scope_authority',
  ]),
  factors: z.array(TaskSizeFactor).default([]),
  reviewBudgetHint: z.enum(['lean', 'balanced', 'thorough', 'release_critical']).optional(),
  reasons: z.array(z.string()).default([]),
  createdAt: z.string(),
  createdBy: z.string(),
})
```

No child drafts live here.

### `TaskDecompositionRecord`

Current `decomposition` is closer to the desired concept but still draft-ish.

Change:

- keep as audit/readiness context;
- remove authority over child creation;
- link it to `ExecutionPlanAction.id` when it triggered actual decomposition;
- store reason codes and decomposition strategy, not child-task truth.

Target additions:

```ts
executionActionId?: string
strategy: 'split_visible_work' | 'split_internal_steps' | 'add_proof_work' | 'research_first'
```

### Parent Readiness Derived Model

Add a shared runtime selector:

```ts
deriveWorkExecutionState(queue, workId): WorkExecutionState
```

Shape:

```ts
interface WorkExecutionState {
  workId: string
  isContaining: boolean
  isRunnable: boolean
  runnableChildIds: string[]
  visibleChildIds: string[]
  internalChildIds: string[]
  blockedChildIds: string[]
  activeChildIds: string[]
  terminalChildIds: string[]
  requiredDeliveryTotal: number
  requiredDeliveryDone: number
  missingProofCount: number
  executionPlanning: {
    needsDecomposition: boolean
    pendingActionIds: string[]
    failedActionIds: string[]
  }
  scopeAuthority: {
    needsOwnerDecision: boolean
    requestIds: string[]
  }
  summaryState:
    | 'ready'
    | 'running'
    | 'blocked'
    | 'needs_decomposition'
    | 'waiting_on_scope_authority'
    | 'complete'
    | 'deferred'
}
```

All surfaces must consume this instead of recomputing:

- scheduler;
- Work list;
- Overview;
- Project Map;
- Thread;
- Release;
- task drawer;
- fleet/project cards.

## Runtime Behavior Changes

### Coordinator Decomposition

Current behavior:

```text
assess size -> store recommended children -> maybe materialize -> later settle stale parent
```

Target behavior:

```text
assess size -> if too broad, create/apply execution action -> child work exists -> parent state derives from child work
```

Rules:

- If work is too broad and accepted scope is clear, split immediately.
- If accepted scope is unclear, create/route scope-authority request only if the ambiguity changes product/release meaning.
- If the split fails because of model/tool/runtime issues, create a coordinator recovery task or retry action, not owner input.
- If a task/step has children, do not dispatch a worker to the parent unless the derived execution state says the parent itself is runnable.

### Scheduler

Current scheduler must avoid parent containers through local checks.

Target:

- scheduler asks `deriveWorkExecutionState`;
- picks runnable leaves or runnable containing nodes only;
- does not pick visible high-level scope rows if their work is represented by children;
- respects selected bounded scope and visibility filters;
- ignores hidden/internal work unless it is required to unblock visible accepted work.

### Scope Boundary

Default scope rule remains:

- new project work starts in Current MVP / selected bounded scope;
- later release/deferred segmentation affects scheduler eligibility;
- Guildhall may split accepted current-scope work internally;
- Guildhall may not silently move accepted current-scope work out of scope.

### Manual Owner Actions

Add user actions as mirrors of Guildhall capabilities:

- Split work;
- Merge selected child work;
- Move child to another parent;
- Change visibility;
- Reorder children;
- Mark as later/deferred;
- Promote internal step to visible work;
- Demote visible child to internal step.

Important: these are edit controls, not approval gates.

## UI And User Flow Changes

### Overview

Current risk:

- Overview can show action copy that implies user approval or false readiness.

Target:

- If Guildhall is decomposing: show "Guildhall is splitting work before continuing."
- If decomposition already happened: show "This scope is broken into N work items."
- If no runnable work remains in bounded scope: show closed-scope state.
- Do not show "Approve split" or "Split recommended."
- Do not show hidden/internal split steps as primary project progress unless they affect blockers/proof.

Overview sections:

- **Scope status:** selected bounded scope state.
- **Work mix:** visible work nodes by state.
- **Project map preview:** 1,000-foot visible skeleton only.
- **No runnable work:** runtime state when all visible scoped work is terminal/deferred.
- **Needs you:** only scope-authority/external-permission decisions.

### Project Map / 1,000-Foot View

Target:

- shows all scoped visible work nodes;
- groups by release/scope/capability/feature when known;
- shows rollups from child work;
- hides internal delivery steps by default;
- offers "Show internal execution steps" toggle;
- distinguishes automatic decomposition from owner-scope changes.

Rows:

```text
Current MVP
  Story intelligence packets       4/4 done
  Agent review harness             3/3 done
  CLI proof commands               2 done, 1 deferred
  UI editor                        Later / outside current scope
```

Actions:

- Split;
- Move to later;
- Promote/demote visibility;
- Open Work;
- Open Thread/decision only when owner authority is truly needed.

### Work List

Target:

- default list shows `scope_map` and `work_list` visibility where actionable;
- internal/proof/review children appear as nested detail, not flat top-level clutter;
- "Split" action is available on every work node;
- if Guildhall split a row, show a compact child count and derived state;
- parent rows with children are containers unless explicitly runnable.

Copy:

- "Split into smaller work"
- "Guildhall split this into 3 work items"
- "3 internal proof steps"
- "Show internal steps"

Forbidden:

- "Recommended split"
- "Approve split"
- "Parent task needs split" when children already exist.

### Task Drawer

Target:

- Overview tab shows derived execution state:
  - containing/runnable;
  - visible children;
  - internal children;
  - required delivery/proof state;
  - execution actions history.
- Spec tab shows accepted completion boundary only, not live split satisfaction.
- Work tab shows runnable child queue and internal steps.
- Journey tab shows decomposition actions as audit events.

Actions:

- Split now;
- Merge/reorganize;
- Change visibility;
- Promote internal step;
- Demote to internal step;
- Defer to later scope only through scope-aware flow.

### Thread

Target:

- Thread should not ask the owner to approve normal splits.
- If a user asks "what is happening?", Thread can say:
  "Guildhall split the broad item into 4 smaller work items and is running the first one."
- If owner authority is needed, Thread asks a real product/scope question, not a decomposition question.

Examples:

Good:

```text
Guildhall split "Build project orientation" into Overview, Project Map,
scope scheduling, and proof audit work. It is running Overview now.
```

Good owner question:

```text
Should UI editor work be part of Current MVP, or moved to Later?
This changes what Guildhall is allowed to work on next.
```

Bad:

```text
Approve this split before Guildhall continues.
```

### Release / Scope Readiness

Target:

- release completeness derives from scoped visible work and required internal obligations;
- project itself is never "complete," selected bounded scope/release can be complete;
- adding future features makes a new release/scope incomplete without changing prior release completion.

Display:

- "Current MVP: closed"
- "Release 0.2: planned"
- "Later: 5 deferred work items"

### Global/Fleet Views

Target:

- visible work counts do not inflate from hidden internal execution steps;
- blocked counts include internal blockers only when they block visible accepted work;
- needs-you counts only include scope-authority/external-permission questions.

## Implementation Plan

### Phase 1: Add Derived Execution State Without Breaking Current Data

**Files:**

- Create: `src/runtime/work-execution-state.ts`
- Test: `src/runtime/__tests__/work-execution-state.test.ts`
- Modify: `src/runtime/work-hierarchy.ts`
- Modify: `src/runtime/work-progress.ts`

**Current status, 2026-06-17:** initial read model is implemented in
`src/runtime/work-execution-state.ts` and covered by focused unit tests. The
orchestrator picker now uses the derived runnable state so legacy split-required
parents with real children do not get dispatched as runnable work, and broad
undecomposed work is withheld from execution. The read model now reuses
`workSubtreeIds` for arbitrary-depth traversal and `deriveProjectWorkProgress`
for shared project visibility counts while keeping execution-specific runnable
and authority rules in the execution-state layer.

- [x] Add tests proving arbitrary-depth decomposition:
  - feature -> task -> step -> sub-step;
  - parent state derives from children;
  - internal children do not inflate visible counts;
  - blocked internal proof step blocks parent proof readiness but not owner authority.

- [x] Implement `deriveWorkExecutionState(queue, workId)`.

- [x] Reuse existing `workSubtreeIds` and `deriveWorkProgress` where possible.

- [x] Keep legacy `sizePlan.recommendedChildren` out of the derived authority path.

### Phase 2: Add Execution Action Records

**Files:**

- Modify: `src/core/task.ts`
- Create: `src/runtime/execution-plan-actions.ts`
- Test: `src/runtime/__tests__/execution-plan-actions.test.ts`
- Modify: `src/tools/task-queue.ts`

**Current status, 2026-06-17:** `ExecutionPlanAction` exists as an additive
project-level task-queue field with legacy-queue defaulting. A first
`applyExecutionPlanAction` helper applies `split_work` transactionally from
explicit child drafts, records `createdChildIds` as audit output, sets
decomposition hierarchy relations, and leaves hierarchy as the source of truth.
Remaining action work is Phase 3: connect real coordinator write paths to
action creation/application instead of writing recommendation children.

- [x] Add `ExecutionPlanAction` schema.

- [x] Store execution actions append-only on the target work node or in project-level action log. Prefer project-level if multiple work nodes need one action transaction.

- [x] Add helper:

```ts
applyExecutionPlanAction(queue, actionId)
```

- [x] Implement `split_work` action:
  - create child work nodes;
  - assign `hierarchy.parentId`;
  - set `hierarchy.relation`;
  - set `workKind`;
  - set `workVisibility`;
  - mark action `applied`;
  - record created child ids for audit only.

### Phase 3: Replace Split Recommendation Write Paths

**Files:**

- Modify: `src/core/task-sizing.ts`
- Modify: `src/runtime/task-decomposition.ts`
- Modify: `src/runtime/intake.ts`
- Modify: `src/tools/task-queue.ts`
- Modify: `src/runtime/orchestrator.ts`

**Current status, 2026-06-17:** new task sizing writes
`decompose_before_execution` for broad work and no longer stores child drafts in
`recommendedChildren`. Decomposition child drafts are generated on demand for
execution-planning application, legacy split materialization records an applied
`split_work` execution action, and created child hierarchy links are tagged as
`decomposes`. Old `recommendedChildren` data remains readable for legacy queues.

- [x] Change `TaskSizePlan.action` decisions:
  - `split_required` -> `decompose_before_execution`;
  - `split_recommended` -> remove for new writes;
  - `ask_clarifying_question` only for true scope ambiguity.

- [x] Stop writing new `recommendedChildren` for ordinary decomposition.

- [x] Convert decomposition child drafts into `ExecutionPlanAction(type: 'split_work')`.

- [x] Apply execution-planning split automatically when accepted scope is clear.

- [x] Leave compatibility reader for old `recommendedChildren`.

- [x] Add migration test showing old records still load and derive correct state.

### Phase 4: Separate Scope Authority From Execution Planning

**Files:**

- Create: `src/runtime/scope-authority.ts`
- Test: `src/runtime/__tests__/scope-authority.test.ts`
- Modify: `src/runtime/orchestrator.ts`
- Modify: `src/runtime/project-action-model.ts`
- Modify: `src/web/lib/project-attention.ts`

**Current status, 2026-06-17:** `ScopeAuthorityRequest` exists as an additive
task-queue field with legacy defaults. `scope-authority.ts` classifies
execution-planning actions separately from scope-authority actions, and the
shared project action model surfaces open scope-authority requests as
owner-input actions without using decomposition language.

- [x] Add scope-authority classifier.

- [x] Add tests:
  - splitting broad work does not create owner input;
  - adding new feature scope creates owner input;
  - moving current MVP work to Later creates owner input unless user explicitly asked;
  - external credential/access creates owner input.

- [x] Ensure `Needs you` counts only real owner-authority decisions.

### Phase 5: Scheduler Uses Derived Execution State

**Files:**

- Modify: `src/runtime/orchestrator-picker.ts`
- Modify: `src/runtime/orchestrator.ts`
- Test: `src/runtime/__tests__/orchestrator-picker.test.ts`
- Test: `src/runtime/__tests__/orchestrator.test.ts`

**Current status, 2026-06-17:** `pickNextTask` uses
`deriveWorkExecutionState` for runnable eligibility. Focused tests cover
legacy split parents with real children, broad undecomposed work, arbitrary
depth, selected bounded scope, and hidden/internal visibility.

- [x] Scheduler skips containing work when runnable children exist.

- [x] Scheduler may select a containing work node only when derived state says it is runnable.

- [x] Scheduler handles arbitrary-depth child selection.

- [x] Scheduler respects visibility and selected bounded scope.

### Phase 6: UI Copy And Actions

**Files:**

- Modify: `src/web/surfaces/project/ProjectOverviewTab.svelte`
- Modify: `src/web/surfaces/project/ProjectMapTab.svelte`
- Modify: `src/web/surfaces/project/WorkTab.svelte`
- Modify: `src/web/surfaces/TaskDrawer.svelte`
- Modify: `src/web/surfaces/project/ThreadTab.svelte`
- Modify: `src/web/surfaces/project/ReleaseTab.svelte`
- Tests in matching `__tests__` files.

**Current status, 2026-06-17:** drawer and journey copy now frame legacy split
records as decomposition/execution-planning state. TaskDrawer exposes "Split
into smaller work" for manual decomposition. Project Map carries orientation
node visibility and includes a "Show internal steps" toggle so internal proof
work stays out of the 1,000-foot view by default. Scope-authority requests
surface as owner decisions through the shared project action model.

- [x] Replace "split recommended" copy with operational action/status copy.

- [x] Add "Split" action where the owner can manually decompose work.

- [x] Add "Show internal steps" toggle.

- [x] Add visibility controls in drawer or map detail.

- [x] Ensure no normal split flow asks for owner approval.

- [x] Ensure owner decisions only appear for scope-authority actions.

### Phase 7: Migration And Cleanup

**Files:**

- Create: `src/runtime/work-decomposition-migration.ts`
- Modify: `src/runtime/migrations.ts`
- Test: `src/runtime/__tests__/migrations.test.ts`
- Update: `internal/audits/flow-audit.md`

**Current status, 2026-06-17:** migration
`0.11.0/execution-planning-decomposition` is registered as a required,
prompt-safety migration. Materialized legacy split data becomes authoritative
hierarchy plus an applied `split_work` execution-planning action. Unmaterialized
legacy child drafts do not become owner input and do not get silently applied;
they become failed execution-planning recovery records so the coordinator can
regenerate decomposition from accepted scope.

- [x] Migrate legacy `recommendedChildren.createdTaskId` into hierarchy/action audit.

- [x] Apply legacy decomposition actions only when represented children prove accepted scope is clear.

- [x] Otherwise create coordinator recovery, not owner approval.

- [x] Mark `recommendedChildren` compatibility-only.

- [x] Add audit note for before/after behavior on Narrative Harness and Looma + Knit.

## Required Tests

### Unit Tests

- `work-execution-state.test.ts`
  - arbitrary depth;
  - visibility filters;
  - parent state derivation;
  - internal blocker rollup;
  - no recommendation authority.

- `execution-plan-actions.test.ts`
  - split creates children;
  - action is applied atomically;
  - created child ids are audit output;
  - failed action does not mutate partial hierarchy.

- `scope-authority.test.ts`
  - normal split is not owner input;
  - scope changes are owner input;
  - deferral boundary is respected.

- `orchestrator-picker.test.ts`
  - runnable leaves selected;
  - containers skipped;
  - arbitrary depth selected;
  - selected bounded scope respected.

### Component Tests

- Overview all-terminal and decomposition-in-progress states.
- Project Map visible/internal toggle.
- Work list split/manual visibility actions.
- Task drawer execution history and child rollup.
- Thread owner-input distinction.
- Release scoped completion with internal proof obligations.

### Rendered UI / Browser Proof

Use installed app proof:

```sh
pnpm build
pnpm dev:install
guildhall stop && guildhall start
curl -s http://localhost:7777/api/stale-server
```

Then verify:

- Narrative Harness closed MVP stays closed with 11 done / 3 shelved;
- no split recommendation copy appears;
- no owner approval appears for decomposition;
- Project Map can show visible scoped skeleton and internal steps separately;
- Work can manually split a work item;
- Overview/Fleet counts do not inflate when an internal step is added.

## Copy Rules

Allowed:

- "Guildhall split this into 4 smaller work items."
- "Guildhall is splitting this before continuing."
- "This item contains 4 child work items."
- "Show internal execution steps."
- "Split manually."
- "Move to Later."
- "This changes the selected scope and needs your decision."

Forbidden:

- "Split recommended."
- "Approve split."
- "Recommendation accepted."
- "Parent task needs split" when child work exists.
- "Needs you" for ordinary execution planning.

## Contract Touch Decision

- **Work id:** execution-planning-decomposition-2026-06-17
- **Touched contracts:** task/work schema, task sizing, task decomposition, task queue mutation, orchestrator scheduling, project action model, owner-input model, Work UI, Overview UI, Project Map UI, Thread UI, Release readiness, project/fleet count semantics.
- **Contracts considered but not touched:** external Jira/Linear authority, public docs, MCP resource names unless payload shape exposes new fields, model provider configuration.
- **Required follow-up:** add explicit schema migration and compatibility reader for existing `recommendedChildren`; update rendered UI flow audit; run installed-app proof against real projects.
- **Proof required:** unit/component/rendered/installed proofs listed above.
- **Owner-review items:** confirm final owner-facing labels for `scope_map`, `work_list`, `drawer`, and `internal`; confirm whether "work item" or "work" is preferred in public UI copy.
- **Apply/revert behavior:** additive first; do not delete legacy fields until migration proof and installed-app proof pass on registered projects.

## Schema Migration Decision

- **Persisted schema touched:** `Task`, `WorkHierarchy`, `WorkVisibility`, `TaskSizePlan`, `TaskDecompositionRecord`, new execution action records, new scope-authority request records.
- **Scope:** local project state plus system-local Guildhall state where project task queues are stored.
- **Change class:** additive plus legacy deprecation.
- **Existing data impact:** old `recommendedChildren` remains readable; existing hierarchy continues to load; missing visibility/relation fields get safe defaults.
- **Migration id:** `0.11.0/execution-planning-decomposition`.
- **Safety:** dry-run required; backup task state before apply; reject cycles before writing.
- **Required before run:** compatibility reader can run without migration; full write-path change requires migration or on-load normalization.
- **Compatibility reader:** old `split_required` and `recommendedChildren` derive into execution state without owner input.
- **Fixtures:** old parent with materialized children; old parent with unmaterialized recommendations; arbitrary-depth step split; internal proof child; deferred later-scope child.
- **Tests:** migration, execution state, scheduler, UI, installed app.
- **Owner-facing plan text:** "Guildhall is updating how it represents decomposed work so broad items show as containing work and smaller execution steps do not clutter project counts."
- **Rollback:** restore backup task state and disable new write path behind a runtime feature flag until migration is repaired.

## Success Criteria

This work is successful when:

- no new code writes `recommendedChildren` for ordinary decomposition;
- no UI says "recommended split" or asks owner approval for ordinary split work;
- broad accepted work automatically decomposes before LLM execution;
- parent readiness/progress derives from children;
- arbitrary-depth child work is supported;
- internal steps are hidden from high-level views by default;
- visible counts remain stable when internal execution steps are added;
- owner input appears only for real scope authority or external permission;
- Narrative Harness, Looma + Knit, Jess, and Fair Labor License installed-app checks still orient truthfully.

## Risks

- **Risk:** over-generalized graph model makes simple tasks harder to read.
  **Mitigation:** keep default UI simple; hide internal nodes; derive plain labels.

- **Risk:** migration accidentally turns old recommendations into new scope.
  **Mitigation:** only materialize legacy recommendations automatically when parent scope is accepted and no child hierarchy exists; otherwise create coordinator recovery.

- **Risk:** internal proof steps disappear from accountability.
  **Mitigation:** drawer/proof/release surfaces always include required internal obligations even when hidden from primary counts.

- **Risk:** owner loses control.
  **Mitigation:** add manual split/merge/move/visibility controls; preserve scope-authority prompts for product decisions.

- **Risk:** scheduler runs hidden work unexpectedly.
  **Mitigation:** scheduler may run hidden/internal work only when it is required to satisfy visible accepted work in the current bounded scope.

## Implementation Order

1. Build the derived execution state read model.
2. Add execution action records.
3. Convert new decomposition writes to actions plus child work.
4. Separate scope authority from execution planning.
5. Move scheduler to the derived model.
6. Update UI copy and manual controls.
7. Add migration and remove legacy write authority.
8. Run installed-app proof on real projects.

Do not start by deleting legacy fields. The first successful version should make the new model authoritative while old fields remain readable.
