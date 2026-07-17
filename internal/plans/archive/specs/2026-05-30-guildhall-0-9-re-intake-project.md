# Guildhall 0.9.0 Re-intake Project

## Status

Draft spec for review before implementation.

## Product Problem

Guildhall projects can accumulate tasks, cards, escalations, and recovery
states that reflect older Guildhall reasoning. After the intake, decomposition,
proof, and scheduling models improve, older project state can feel untrustworthy
even when it contains valuable evidence.

The user should not have to manually fight old cards one by one. Guildhall
needs a way to re-read the project with the current reasoning model, use the
existing task graph and progress as evidence, and propose a cleaner graph.

This is not a destructive reset. The right product concept is:

> Re-intake Project: re-read the project and propose a cleaner plan using what
> Guildhall knows now, without losing real progress.

## Goals

- Provide a project-level re-intake flow reachable from project settings.
- Treat current tasks, progress, and task history as evidence, not gospel.
- Produce a reviewable graph diff before any state-changing write.
- Preserve completed work and meaningful evidence.
- Reframe, merge, archive, or supersede weird old tasks instead of making the
  user clean them up manually.
- Reuse the evidence-to-work-graph planner for structured source evidence.
- Prove through tests that re-intake both:
  - breaks rich multi-deliverable evidence into implementation/integration
    tasks with dependencies;
  - does not split a genuinely single bounded edit.

## Non-goals

- Do not erase task history.
- Do not delete completed work.
- Do not auto-apply a re-intake plan without explicit user approval.
- Do not put this action on the main project screen or top toolbar.
- Do not make "reset" copy visible in the product UI.
- Do not rely on an LLM-only transcript as the source of truth for the diff.

## Placement

Put the entry point in **Project Settings → Memory**.

Reasoning:

- Re-intake is about how Guildhall understands the project, not provider setup
  or runtime readiness.
- Settings → Memory already owns project context, learned guidance, and what
  Guildhall thinks it knows.
- Settings → Facts is about discovered repo facts; re-intake uses facts but
  changes task memory, so Memory is the better home.
- Settings → Advanced would hide it too deeply and make it feel dangerous.

The Memory section should show a restrained panel:

- title: `Re-intake Project`
- body: `Re-read this project with the current Guildhall reasoning model and
  propose a cleaner task graph. Existing tasks and progress are used as
  evidence, not treated as final.`
- primary action: `Start re-intake`
- secondary link after a draft exists: `Review re-intake draft`

No toolbar button. No first-screen placement.

## User Flow

1. User opens Project Settings → Memory.
2. User clicks `Start re-intake`.
3. Guildhall creates or refreshes a reserved re-intake task/draft.
4. Guildhall reads current project evidence:
   - source files and structured docs;
   - current `TASKS.json`;
   - task notes, evidence, escalations, and completion summaries;
   - `PROGRESS.md`;
   - workspace import draft/history;
   - project brief, memory, decisions, facts, and codebase map when present.
5. Guildhall produces a re-intake draft diff.
6. User reviews the diff before applying.
7. User may apply all changes or apply selected groups.
8. Guildhall writes the approved changes to task state, preserving supersession
   links and evidence notes.

## Re-intake Draft Model

The draft is a proposed state transition, not a set of immediate writes.

```ts
interface ProjectReintakeDraft {
  id: string
  createdAt: string
  createdBy: 'project-reintake'
  status: 'draft' | 'applied' | 'dismissed'
  taskQueueFingerprint: string
  sources: ReintakeSourceSummary[]
  summary: {
    kept: number
    reframed: number
    merged: number
    archived: number
    created: number
    preservedDone: number
  }
  groups: ReintakeChangeGroup[]
}

interface ReintakeChangeGroup {
  id: string
  title: string
  rationale: string
  changes: ReintakeChange[]
}

type ReintakeChange =
  | KeepTaskChange
  | ReframeTaskChange
  | MergeTasksChange
  | ArchiveTaskChange
  | CreateTaskChange
  | PreserveProgressChange
```

Each change must include:

- affected task ids;
- proposed new task ids when applicable;
- before/after summary;
- source references;
- confidence: `high | medium | low`;
- risk: `low | medium | high`;
- reason written for a human reviewer.

## Re-intake Semantics

### Keep

Use when an existing task is still coherent, scoped, and supported by current
evidence. The task may still get minor metadata refreshes, such as proof paths,
but its identity and core title remain stable.

### Reframe

Use when an existing task points at real work but has stale wording, missing
acceptance criteria, missing proof, or the wrong status. The task id should be
preserved when the old task is the best-known handle, especially if the user
has linked to it.

Example:

- before: `Build AlertDialog primitive`, blocked with vague no-progress notes
- after: `Build AlertDialog`, `dependsOn`, acceptance criteria, proof paths,
  source evidence, and a linked Knit integration task

### Merge

Use when multiple old tasks describe the same deliverable or duplicate recovery
threads. The chosen surviving task keeps the clearest id/history. The merged
tasks become archived/superseded with links to the survivor.

### Archive

Use when a task is stale, contradicted by completed work, purely historical
noise, or no longer supported by current evidence. Archiving is not deletion.
Archived tasks keep history and a `supersededBy` or `archivedBecause` note.

### Create

Use when current evidence describes missing deliverables or integration work
not represented by any task. Created tasks must include dependencies and proof
contracts when the evidence supports them.

### Preserve Progress

Completed or partially completed work should become evidence for the new graph.
If a task is done, re-intake should not reopen it unless current evidence shows
the completion was false. Done work may become a dependency satisfied by
history.

## Evidence Ranking

Re-intake should rank evidence in this order:

1. Completed task evidence with concrete files, commands, screenshots, or gate
   results.
2. Current repo files and structured project artifacts.
3. Current task specs, acceptance criteria, and proof paths.
4. Task notes and transcripts.
5. Old blocked/escalated status labels.
6. Old inferred summaries with no durable proof.

Old task state matters, but it should not override stronger current evidence.

## Reuse Of Evidence-To-Work-Graph Intake

Re-intake should call `planEvidenceWorkGraph` for source evidence that describes
deliverables and relationships. That planner already covers:

- extracting deliverable units;
- preserving foundation/dependency relationships;
- creating implementation and integration tasks;
- generating proof contracts;
- reconciling vague existing tasks.

Re-intake should wrap this with project-state reconciliation:

- current `TASKS.json` becomes `existingTasks`;
- completed tasks become done dependencies or progress evidence;
- blocked tasks become candidates for reframe/archive;
- generated graph tasks become proposed create/reframe changes, not immediate
  task writes.

## Applying A Draft

Applying a re-intake draft should be explicit and auditable.

State changes:

- Reframed tasks preserve id and append a system note:
  `Re-intake reframed this task from <old title> because <reason>.`
- Merged tasks move to `shelved` or an archived-equivalent terminal state with
  `supersededBy`.
- Archived tasks keep notes and evidence.
- Created tasks enter `import_draft`. Even when the generated proof contract is
  strong, the user is approving a re-intake plan, not approving every new task
  spec for immediate worker dispatch.
- Done tasks remain done unless explicitly marked as false completion in the
  draft and approved by the user.

The apply endpoint should write one summary event to project progress:

`Project re-intake applied: X kept, Y reframed, Z created, N archived.`

## UI Design

### Settings → Memory Panel

The panel is compact and not alarming.

Primary empty state:

- `Re-intake Project`
- `Re-read this project with the current Guildhall reasoning model and propose
  a cleaner task graph.`
- Button: `Start re-intake`

After draft exists:

- status pill: `Draft ready`
- summary counts
- Button: `Review draft`
- secondary button: `Refresh draft`

After applied:

- status pill: `Applied`
- summary line with timestamp
- Button: `Review last re-intake`
- secondary button: `Start another re-intake`

### Review Surface

Use a dedicated project route:

`/projects/:id/settings/reintake`

The review page should show:

- summary counts;
- grouped changes;
- filters: `All`, `Creates`, `Reframes`, `Merges`, `Archives`, `Keeps`;
- per-change before/after;
- source references;
- confidence/risk;
- selectable groups;
- `Apply selected` button.

Do not overload the existing Workspace Import page. Workspace Import is about
first import or imported docs; Re-intake is about reconciling an already-lived
project.

## Runtime/API Design

New reserved task id:

`task-project-reintake`

New endpoints:

- `GET /api/project/reintake/status`
  - returns whether a draft exists, status, counts, timestamp.
- `POST /api/project/reintake/rerun`
  - creates or refreshes the draft.
- `GET /api/project/reintake/draft`
  - returns the reviewable draft.
- `POST /api/project/reintake/apply`
  - applies all or selected change groups.
- `POST /api/project/reintake/dismiss`
  - dismisses the current draft without changing tasks.

The reserved task is useful for history/thread continuity, but the draft file
should be the structured source for the UI:

`.guildhall/reintake-drafts/current.json`

or the system-local equivalent if the project uses externalized state.

`taskQueueFingerprint` should be a stable hash of the task queue at draft
creation time. Apply must compare it to the current queue hash and require a
refresh if the queue changed.

## Safety Rules

- No apply without explicit user action.
- No hard deletion.
- No reopening done tasks by default.
- No archiving tasks with unlanded worktree changes unless the draft calls this
  out as high risk.
- No changing task ids for reframes when a stable id already exists.
- No applying if the current task file has changed since the draft was created;
  require refresh.
- No applying while Guildhall is actively running the project.

## Test Plan

### Pure Planner Tests

Already started in
`src/runtime/__tests__/evidence-work-graph-intake.test.ts`.

Keep and extend:

- rich Looma/Knit evidence becomes implementation plus integration graph;
- backend/data fixture proves behavior is not UI-component-specific;
- vague old task gets reconciled instead of duplicated;
- single bounded edit fixture remains one task.

Add a single-edit fixture:

```md
# Bug note

The settings footer says "Host-run" but should say "Runs on host" in
src/web/surfaces/project/SettingsTab.svelte.
```

Expected:

- one task;
- no generated child/integration task;
- no dependency graph unless explicit evidence requires one.

### Re-intake Planner Tests

New test file:

`src/runtime/__tests__/project-reintake.test.ts`

Cases:

1. **Treats tasks as evidence, not gospel**
   - Input: a blocked vague task plus structured source evidence.
   - Expected: draft proposes `reframe`, not keep-as-is.

2. **Preserves completed work**
   - Input: completed `Dialog` task with proof, source evidence says
     `AlertDialog` builds on `Dialog`.
   - Expected: `Dialog` is preserved as progress; `AlertDialog` depends on the
     completed evidence but does not recreate `Dialog`.

3. **Archives stale task noise**
   - Input: old blocked task with no source support and no durable evidence.
   - Expected: draft proposes archive with clear reason.

4. **Merges duplicate recovery cards**
   - Input: two blocked tasks both about project discovery/re-indexing.
   - Expected: one survivor and one superseded task.

5. **Does not split a single bounded edit**
   - Input: one supported copy/code edit.
   - Expected: one reframe/keep/create change, no child graph.

6. **Creates integration work when evidence names a consuming surface**
   - Input: Looma source evidence plus Knit consumer surface.
   - Expected: implementation task plus Knit integration task, with dependency.

### Apply Tests

Extend or add:

`src/runtime/__tests__/project-reintake-apply.test.ts`

Cases:

1. Applying a reframe preserves task id and appends a re-intake note.
2. Applying a merge marks duplicates superseded and links to survivor.
3. Applying an archive never deletes the task.
4. Applying created tasks preserves `dependsOn`, acceptance criteria, proof
   paths, domain, and project path.
5. Applying fails if `TASKS.json` changed since draft creation.
6. Applying fails while project run status is active.

### API Tests

Extend:

`src/runtime/__tests__/serve-settings.test.ts`

Cases:

1. `POST /api/project/reintake/rerun` creates a draft and reserved task.
2. `GET /api/project/reintake/draft` returns grouped changes.
3. `POST /api/project/reintake/apply` applies selected groups only.
4. `POST /api/project/reintake/dismiss` leaves tasks untouched.
5. endpoints return a useful error when project is uninitialized.

### UI Tests

Extend:

`src/web/surfaces/project/__tests__/SettingsTab.svelte.test.ts`

Cases:

1. Settings → Memory shows `Re-intake Project`.
2. Clicking `Start re-intake` calls `/api/project/reintake/rerun`.
3. Draft-ready state shows counts and `Review draft`.
4. The route `/settings/reintake` renders grouped changes.
5. `Apply selected` posts selected group ids.
6. The UI copy never says `reset`.

### Scheduler Respect Tests

Existing scheduling already respects `dependsOn`; keep a direct regression
where a re-intake-created integration task has higher priority than its
implementation dependency.

Expected:

- before implementation done: picker chooses implementation;
- after implementation done: picker chooses integration.

## Implementation Slices

1. Add pure `project-reintake` planner types and tests.
2. Teach planner to consume tasks/progress/source evidence and produce draft
   changes.
3. Add draft persistence and API endpoints.
4. Add apply logic with safety checks.
5. Add Settings → Memory entry point and review route.
6. Add browser/UI verification against Looma + Knit.
7. Run project re-intake on Looma + Knit and verify the real proposed graph
   fixes the old weird cards before calling the feature done.

## Acceptance Criteria

- User can start Re-intake Project from Settings → Memory.
- Guildhall produces a reviewable draft, not an immediate mutation.
- The draft treats existing tasks and progress as evidence, not gospel.
- Applying preserves history and never deletes tasks.
- Multi-deliverable evidence becomes a dependency-aware graph.
- A single bounded edit remains one task.
- Downstream integration work is not schedulable before generated
  implementation dependencies are done.
- Looma + Knit can be re-intaken and produces understandable proposed changes.
