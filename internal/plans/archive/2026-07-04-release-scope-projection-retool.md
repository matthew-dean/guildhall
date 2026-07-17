# Release Scope Projection Retool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Guildhall compute one canonical current-scope projection from task queue state, then reuse that projection for Start/Resume, release readiness, orientation spine, rendered fixtures, and UI proof.

**Architecture:** Keep persisted `TaskQueue` compatible for now, but stop letting every reader independently interpret `ProjectRelease.nodeIds`, `ProjectRelease.deferredNodeIds`, `Task.releaseIds`, and `Task.hierarchy`. Add a runtime read model that normalizes those fields into explicit included, deferred, materialized-child, runnable, paused, owner-blocked, proof-blocked, and source-backed rows. Product surfaces and orchestration preflight consume that read model instead of reconstructing scope state locally.

**Tech Stack:** TypeScript, Zod task queue model, Vitest, Playwright rendered-ui tests.

---

## Why This Is Necessary

The repeated churn is not only stale tests. The current data model allows multiple true-ish representations of the same scope:

- `ProjectRelease.nodeIds` says which work belongs to a release.
- `ProjectRelease.deferredNodeIds` says which work is later.
- `Task.releaseIds` can independently add tasks to a release.
- `Task.hierarchy.parentId` can make child work in-scope through an included parent.
- `Task.status`, `Task.spec`, `Task.acceptanceCriteria`, `productBrief`, and child status all affect whether the work is runnable, paused, blocked, or merely unfinished.

Today those fields are reinterpreted in multiple places:

- `selectedReleaseScopeForQueue()` in `src/runtime/orchestrator-picker.ts`
- `taskEligibleForSelectedScope()` and `buildProjectOrientationSpine()` in `src/runtime/project-orientation-spine.ts`
- `summarizeScopedReleaseWork()`, `startBlockerForTaskReadiness()`, `terminalStartState()`, and `/api/project` assembly in `src/runtime/serve.ts`
- rendered fixtures in `scripts/playwright-fixtures.mjs`
- UI tests that sometimes hard-code stale counts instead of proving API/UI agreement

This is why Narrative Harness could be correct in the installed app, stale in rendered fixtures, and asserted wrongly in Playwright at the same time.

## Target Model

Add one runtime read model:

```ts
export interface ProjectScopeProjection {
  selectedScope: OrientationScope | null
  rows: ProjectScopeRow[]
  counts: {
    included: number
    deferred: number
    ready: number
    paused: number
    active: number
    done: number
    ownerBlocked: number
    proofBlocked: number
    humanBlocking: number
  }
  start: {
    canStart: boolean
    code?: string
    label: 'Start' | 'Resume' | 'Review' | 'Configure'
    focusTaskId?: string
    focusTaskTitle?: string
    focusKind?: 'paused_work' | 'ready_work' | 'spec_review' | 'brief_cleanup' | 'provider' | 'terminal'
    message: string
    actionHref: string
  }
  release: {
    state: 'ready' | 'blocked' | 'active' | 'shaping' | 'unknown'
    blockers: Array<{ id: string; label: string; owningTaskId?: string }>
  }
}

export interface ProjectScopeRow {
  taskId: string
  title: string
  scope: 'included' | 'deferred'
  eligibilityReason: 'included' | 'included_ancestor' | 'included_prerequisite' | 'deferred'
  hierarchyRole: 'root' | 'parent' | 'child'
  status: TaskStatus
  handoffState: 'not_shaped' | 'brief_cleanup' | 'spec_review' | 'ready' | 'paused' | 'review' | 'done' | 'blocked'
  blocksStart: boolean
  blocksRelease: boolean
  humanBlocking: boolean
  sourceRefs: string[]
}
```

Important semantics:

- A release/scope is the completion unit. Projects are never globally complete.
- If releases are not explicitly defined, Guildhall may use an internal current-work scope, but it must not invent user-facing labels like `MVP boundary`.
- A child of an included parent is in-scope for execution and pins, but the projection must decide whether the parent or child counts in summary totals so every surface uses the same number.
- A ready task with spec plus acceptance criteria is worker-shaped work, not brief cleanup.
- A spec-review task is not automatically owner-blocked. It is owner-blocked only when the projection says owner review is actually required.
- Provider setup is a runtime preflight blocker, not a project-shape blocker. Tests that prove project orientation should seed provider state or assert provider state separately.

## Task 1: Add The Projection Builder

**Files:**
- Create: `src/runtime/project-scope-projection.ts`
- Test: `src/runtime/__tests__/project-scope-projection.test.ts`

- [x] **Step 1: Write tests for parent/child scope rows**

Add a test that creates a selected release with parent `task-contracts` in `nodeIds`, child `task-ground-truth` with `hierarchy.parentId = task-contracts`, parent status `ready`, child status `in_progress`, and asserts:

```ts
expect(projection.rows.find(row => row.taskId === 'task-ground-truth')).toMatchObject({
  scope: 'included',
  eligibilityReason: 'included_ancestor',
  hierarchyRole: 'child',
  handoffState: 'paused',
  blocksStart: false,
  humanBlocking: false,
})
expect(projection.counts.paused).toBe(1)
expect(projection.start).toMatchObject({
  canStart: true,
  code: 'paused_live_work',
  label: 'Resume',
  focusTaskId: 'task-ground-truth',
})
```

- [x] **Step 2: Write tests for spec-shaped ready work**

Add a ready task with `spec` and at least one `acceptanceCriteria` entry but a thin imported `productBrief`. Assert:

```ts
expect(row.handoffState).toBe('ready')
expect(row.blocksStart).toBe(false)
expect(row.humanBlocking).toBe(false)
expect(projection.release.blockers).toEqual([])
```

- [x] **Step 3: Write tests for genuinely thin ready work**

Add a ready task with no spec and no acceptance criteria. Assert:

```ts
expect(row.handoffState).toBe('brief_cleanup')
expect(row.blocksStart).toBe(true)
expect(row.humanBlocking).toBe(true)
expect(projection.start.focusKind).toBe('brief_cleanup')
```

- [x] **Step 4: Implement `buildProjectScopeProjection()`**

Move the shared pieces out of the current call sites:

- selected release resolution from `selectedReleaseScopeForQueue()`
- eligibility from `taskEligibleForSelectedScope()`
- handoff readiness from `isReadyForWorkerHandoffRecord()`
- materialized child rollup from the new `summarizeScopedReleaseWork()` helper

Keep wrappers in the old files temporarily so call sites can migrate incrementally.

Status 2026-07-04: `src/runtime/project-scope-projection.ts` now owns selected release scope resolution, task node ids, scope eligibility, scope rows, start summary, and release blockers. `project-orientation-spine.ts` and `orchestrator-picker.ts` keep their old exports as compatibility wrappers.

- [x] **Step 5: Run projection tests**

Run:

```bash
CI=true /opt/homebrew/bin/pnpm exec vitest run src/runtime/__tests__/project-scope-projection.test.ts
```

Expected: all projection tests pass.

Proof 2026-07-04: `CI=true /opt/homebrew/bin/pnpm exec vitest run src/runtime/__tests__/project-scope-projection.test.ts` passed.

## Task 2: Replace Start And Release Readiness Local Logic

**Files:**
- Modify: `src/runtime/serve.ts`
- Test: `src/runtime/__tests__/serve-settings.test.ts`
- Test: `src/runtime/__tests__/serve-release-readiness.test.ts`

- [x] **Step 1: Route `startBlockerForTaskReadiness()` through `ProjectScopeProjection.start`**

Keep provider, migration, and owner-input preflights outside the projection. Replace task-specific brief/spec/paused logic with the projection result.

Status 2026-07-04: selected release/current-scope task readiness now uses `ProjectScopeProjection.start`. Import-draft shaping remains owned by the import-draft preflight because it is a distinct workflow blocker, not generic scoped task readiness.

- [x] **Step 2: Route `summarizeScopedReleaseWork()` through projection rows**

Release blockers should come from `row.blocksRelease` and `row.humanBlocking`, not independent status/brief/spec checks.

Status 2026-07-04: scoped task membership, human blocking count, and release blockers now come from projection rows/release summary. Legacy arrays remain populated for compatibility while API consumers migrate.

- [x] **Step 3: Preserve existing API shape**

Do not change `/api/project` or `/api/project/release-readiness` response shapes in this task. Populate existing fields from the projection so UI stays compatible.

Status 2026-07-04: no public response fields were renamed or removed in this slice.

- [x] **Step 4: Run focused runtime tests**

Run:

```bash
CI=true /opt/homebrew/bin/pnpm exec vitest run src/runtime/__tests__/serve-settings.test.ts -t "brief cleanup|ready tasks with a spec|selected release|paused_live_work"
CI=true /opt/homebrew/bin/pnpm exec vitest run src/runtime/__tests__/serve-release-readiness.test.ts
```

Expected: all focused tests pass without duplicating readiness rules in `serve.ts`.

Proof 2026-07-04: focused `serve-settings`, `serve-release-readiness`, `orchestrator-picker`, and `project-scope-projection` tests passed for selected-release, paused-live-work, ready-spec, and brief-cleanup paths.

## Task 3: Make Orientation Spine Consume Projection

**Files:**
- Modify: `src/runtime/project-orientation-spine.ts`
- Modify: `src/runtime/serve.ts`
- Test: `src/runtime/__tests__/project-orientation-spine.test.ts`

- [x] **Step 1: Add optional `scopeProjection` input to `buildProjectOrientationSpine()`**

The spine should render summary counts, active pins, top blocker, release blockers, and current/deferred rows from the projection when provided.

- [x] **Step 2: Remove duplicated status counting from orientation summary when projection exists**

Summary fields that must come from projection:

- `includedWorkCount`
- `deferredWorkCount`
- `pinnedNow`
- `topBlocker`
- `nextAction`
- `progress.ready`
- `progress.active`
- `progress.blocked`
- `release.blockers`

Status 2026-07-04: the spine accepts `scopeProjection`. When present, summary progress and release blockers/state come from projection counts and projection blockers instead of stale release-readiness input.

- [x] **Step 3: Add regression tests for Narrative Harness Stage 1**

Use the same parent/child and ready/spec-shaped fixture as Task 1. Assert:

```ts
expect(spine.summary.selectedReleaseLabel).toBe('Stage 1: Fixture And Evaluation Harness')
expect(spine.summary.includedWorkCount).toBe(6)
expect(spine.summary.pinnedNow).toContain('Shape fixture and expected-record ground truth')
expect(spine.summary.topBlocker).toBeNull()
expect(spine.release.blockers).toEqual([])
```

Proof 2026-07-04: `project-orientation-spine.test.ts` now proves a stale parent brief-cleanup release blocker is ignored when the projection says the Stage 1 child is paused and the release has no blockers.

## Task 4: Make Fixtures And UI Proof Projection-Based

**Files:**
- Modify: `scripts/playwright-fixtures.mjs`
- Modify: `tests/rendered-ui/project-flow.spec.ts`
- Modify: `tests/rendered-ui/flow-audit-assertions.ts`

- [x] **Step 1: Keep rendered fixtures aligned with projection semantics**

The Narrative Harness fixture must seed:

- selected release `Stage 1: Fixture And Evaluation Harness`
- six current release work items
- deferred later work
- parent `Define fixture...` with materialized child `Shape fixture...`
- child status `in_progress`
- fake provider state in `.playwright-fixtures/home/.guildhall` so provider setup does not mask project communication tests

Status 2026-07-04: rendered Narrative Harness fixtures now seed the selected
Stage 1 release, current/deferred work, materialized child work, and provider
state needed for orientation proof.

- [ ] **Step 2: Extend rendered assertion helper**

Add a helper that fetches `/api/project`, then asserts Overview, Map, Release, and Work render the same selected scope, counts, run-control label, pinned task, blocker state, and source trail.

- [x] **Step 3: Replace hard-coded stale blocker assertions**

Tests should assert exact values only when they are part of the fixture contract, such as `includedWorkCount: 6`. Counts that may vary with later fixture expansion, like deferred work, should be read from the API and verified in the UI.

Status 2026-07-04: the rendered proof now asserts projection-backed visible
state instead of the stale parent brief-cleanup blocker.

- [x] **Step 4: Run rendered proof**

Run:

```bash
CI=true /opt/homebrew/bin/pnpm exec playwright test tests/rendered-ui/project-flow.spec.ts -g "Narrative Harness overview and map show"
```

Expected: pass, with the UI showing Stage 1, six work items in view, deferred count from API, Resume, `Shape fixture and expected-record ground truth`, implementation-roadmap source trail, and no fake spec-review or brief-cleanup blocker.

Proof 2026-07-04: `CI=true /opt/homebrew/bin/pnpm exec playwright test tests/rendered-ui/project-flow.spec.ts -g "Narrative Harness overview and map show"` passed before the installed-app proof pass.

## Task 5: Installed-App Narrative Harness Proof

**Files:**
- Modify: `internal/audits/flow-audit.md`

- [x] **Step 1: Install and restart**

Run:

```bash
/opt/homebrew/bin/pnpm build
/opt/homebrew/bin/pnpm dev:install
guildhall stop
guildhall start
curl -s http://localhost:7777/api/stale-server
```

Expected: `stale:false`.

Proof 2026-07-04: build, install, stop/start passed and
`/api/stale-server` returned `stale:false` for PID `3980`.

- [x] **Step 2: Query live Narrative Harness state**

Run:

```bash
curl -s 'http://localhost:7777/api/project?projectId=narrative-harness' | jq '{startReadiness, runControl:.actionModel.runControl, summary:.orientationSpine.summary, release:.orientationSpine.release}'
curl -s 'http://localhost:7777/api/project/release-readiness?projectId=narrative-harness' | jq '{ready, statusCounts, incompleteBriefs, unapprovedBriefs, totals}'
```

Expected:

- `startReadiness.code` is `paused_live_work` or another projection-backed state that matches visible work.
- `runControl.label` matches the visible Overview/Work action.
- false brief/spec-review blockers are absent.
- release readiness blocker counts match projection rows.

Proof 2026-07-04: live `/api/project?projectId=narrative-harness` returned
`startReadiness.code:"paused_live_work"`, `runControl.label:"Resume"`, selected
release `Stage 1: Fixture And Evaluation Harness`, `includedWorkCount:6`,
`deferredWorkCount:8`, `progress.active:1`, `topBlocker:null`,
`release.state:"active"`, and zero orientation release blockers. Live
`/api/project/release-readiness?projectId=narrative-harness` returned
`ready:false` with six unfinished ready tasks and zero human/brief/spec
blockers, proving the distinction between ready-to-run and ready-to-close.

- [x] **Step 3: Run browser or rendered UI proof**

Prefer in-app browser screenshots when available. If the browser tool times out, use rendered Playwright screenshots and explicitly record that limitation.

Proof 2026-07-04: installed-app Playwright proof at
`/projects/narrative-harness/map` confirmed visible `Project map`, `Stage 1:
Fixture And Evaluation Harness`, `Scope ledger`, the scoped task `Define
fixture, expected-record, prototype-run, and evaluation schemas.`, and `Source
trail`.

- [x] **Step 4: Update flow audit**

Record:

- API proof
- UI proof route(s)
- what a user can understand without repo access
- remaining gaps
- whether the projection model is fully adopted or only partially adopted

## Self-Review

This plan intentionally did not persist a new schema first. The immediate
failure mode was inconsistent interpretation of existing persisted fields, so
the first move was a canonical read model.

That is no longer enough as the whole solution. Live proof caught
`ProjectScopeProjection.release.state` using `ready` to mean runnable unfinished
work while `/api/project/release-readiness.ready` meant closeable release. That
is exactly the kind of sync pressure that comes from a model that stores scope
membership across `ProjectRelease.nodeIds`, `ProjectRelease.deferredNodeIds`,
`Task.releaseIds`, hierarchy links, task status, and side-channel git/design
checks, then asks every surface to reconstruct "what is current" and "can it
close."

The next architecture step should be a persisted scope membership and execution
boundary model:

- `Scope` remains optional/user-facing. A project can have no named releases,
  one active release, many future releases, milestones, or arbitrary markers.
- Each scope has explicit membership rows: work id, included/deferred role,
  reason/source, user-facing visibility, and whether descendants are included.
- Task hierarchy remains pure containment. It should not double as release
  membership, execution eligibility, or progress semantics.
- Execution state remains derived from task/runtime evidence, but the selected
  execution boundary should point at a scope and produce `readyToRun` separately
  from `readyToClose`.
- Release/closure readiness should consume the same membership rows plus
  closure gates; it should not reinterpret raw task fields.

Until that migration exists, `ProjectScopeProjection` is the compatibility
read model and the only acceptable place to reconcile legacy fields.
