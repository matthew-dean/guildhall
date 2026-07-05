# Guildhall Project Orientation Spine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan is intentionally internal product/architecture planning, not public documentation.

**Goal:** Make Guildhall answer the project orientation snapshot at any moment: what the project is for, what capabilities exist, what maturity each capability has reached, where current work is focused, what proof exists, and how close the selected bounded scope is to ready.

**Architecture:** Add a canonical Project Orientation Spine as a derived runtime/API model over existing Guildhall structures. It does not replace project structure, structural intake, task hierarchy, delivery steps, project graph internals, or release readiness; it unifies their owner-facing meaning and forces Overview, Work, Thread, Structure, and Release to render the same project skeleton at different zoom levels.

**Tech Stack:** TypeScript runtime builders, existing task/project persistence, existing structural map/project graph APIs, existing work hierarchy and delivery-step rollups, Svelte project surfaces, Vitest, rendered UI flow-audit checks, and installed-app browser proof.

## Implementation Status: 2026-06-15

Implemented in this slice:

- Pure runtime builder and tests for charter/scope rollup, default Current MVP
  semantics, maturity/proof states, source gaps, active pins, release blocker
  anchoring, source conflicts, and stable `work:{taskId}` node identity.
- Read-only charter inference from existing project `README.md` and
  `docs/index.md` content when no explicit charter exists, so the default
  Overview has a real purpose without forcing a new owner intake step.
- Scheduler eligibility guard so deferred work outside the selected bounded
  scope is not picked for ordinary unattended work unless explicitly targeted or
  required as an included dependency.
- `/api/project/spine`, main `/api/project` payload, and `/api/project/thread`
  now expose the derived spine.
- Overview now owns the 100-foot situation view inside the existing Overview
  information architecture, not as a new mockup block. The knowledge summary
  includes a selectable `Scope` card for selected bounded scope, included/later
  counts, proof/blocker state, and pinned work; the existing `Do this next`,
  delivery, work-mix, blocked-work, and project-map sections remain the
  surrounding structure. It must not literalize internal metaphors such as
  "State of the Union" in owner-facing copy.
- Work rows, Thread task-linked cards, and compact Thread rows render the
  orientation path from the shared spine.
- Structure and Release consume the same spine visibly instead of reconstructing
  scope/blocker context locally.
- Deterministic rendered UI assertion covers Overview, Work, Thread, Structure,
  and Release for Narrative Harness, Looma + Knit, Jess, and Fair Labor
  License.
- Installed-app proof at `localhost:7777` passed with `/api/stale-server`
  returning `stale:false`, desktop/narrow/mobile geometry checks, and manual
  orientation audit evidence recorded in `internal/audits/flow-audit.md`.
- `pnpm audit:project-spine` now makes the installed real-project calibration
  repeatable by reading `/api/service/projects` and `/api/project/spine` from
  the running app, then classifying each registered project as rich-progressed,
  thin-honest, thin-with-gaps, or needs-intake.
- Real-project calibration now uses Looma + Knit as the richer progressed-state
  proof case: installed API shows `299` included nodes, `292` roots, `5` pins,
  and `40` proof/grounding gaps. Jess and Fair Labor License remain honest
  thin-scope calibration projects until they have richer Guildhall task/artifact
  state.
- Verification passed: focused runtime/API/Overview/Work/Thread/Release/
  Structure suites (`196` tests), `pnpm typecheck`, `pnpm lint:contracts`, and
  `pnpm exec playwright test tests/rendered-ui/project-flow.spec.ts -g "project orientation spine agrees"`.

Still required before calling the whole plan complete:

- Follow-up: add a separate 1,000-foot Project Map / Scope Map view for the
  whole selected bounded scope: summary of all scoped work, all feature/slice
  skeleton rows, maturity rollups, proof coverage, deferred/later segmentation,
  and source gaps. Overview should link to that deeper map rather than trying
  to show the whole skeleton itself.
- Follow-up: projects with thin Guildhall state should prompt for narrow
  confirmation or richer intake only when that missing structure affects what
  Guildhall displays prominently, works on next, marks blocked, or treats as
  ready.

---

## Why This Exists

The failure mode is not that Guildhall lacks structure. Guildhall has several partial structures:

- repo structural map;
- project graph;
- delivery spine;
- task hierarchy;
- logical work and delivery steps;
- release readiness;
- proof paths and completion handoffs;
- threads and owner-input records;
- artifacts/specs/checklists.

The failure is that none of those structures currently answers the owner's orienting question:

> What is this project, what is its skeleton, where is each part in the planning/execution/proof lifecycle, and where is active agent work pinned right now?

The current Overview aggregates activity state. It does not show the whole project condensed into a stable, zoomable skeleton. The user still has to reconstruct the project from tasks, threads, release blockers, specs, and memory.

The Project Orientation Spine fixes that by becoming the shared read model for project orientation.

## Name And Boundary

Use the full name **Project Orientation Spine** in the spec and code comments until the boundary is obvious.

Avoid the shorter name **Project Spine** in implementation because it sounds like another structural graph. The load-bearing word is **Orientation**.

The Project Orientation Spine is:

- an owner-facing rollup/index over existing project structures;
- a scoped progress model for project goals, areas, features, slices, work, proof, and release readiness;
- the source of truth for compact project situation summaries;
- a navigation model that lets the user zoom from project to feature to slice to task/proof/thread.

The Project Orientation Spine is not:

- a second structural map;
- a second project graph;
- a replacement for task hierarchy;
- a new task lifecycle;
- a new artifact registry;
- a new release-readiness engine;
- a revival of the superseded local project graph spec.

## Difference From Existing Concepts

### Project Structure / Structure Tab

**Existing job:** Show the repo/project map: detected domains, packages, executable units, contract surfaces, setup state, cross-project handoffs, and structural-map review.

**Orientation Spine job:** Show the product/work skeleton: goals, audience, areas, features, slices, maturity states, pinned work, proof, and readiness distance for the selected bounded scope.

**Relationship:** Structure feeds the spine with implementation geography and domain evidence. The spine decides what that structure means to the project owner. A package can be part of several capabilities; a capability can span many packages.

**Example:** `packages/core` is structure. `Story intelligence packets are specced but not proven` is orientation.

### Structural Intake

**Existing job:** Inspect a repo, infer structural domains, executable units, package/workspace shape, Git authority roots, and memory scopes; ask the owner to accept or correct the map.

**Orientation Spine job:** Use accepted structural intake as evidence, but ask a different question: what project goals and capabilities does this evidence support, and what is their maturity?

**Relationship:** Structural intake remains the repo-discovery gate. Orientation intake becomes the product-planning gate. They can happen in the same flow, but they must produce separate outputs.

**Example:** Structural intake says "this project has Docusaurus docs and docs/specs." Orientation intake says "Stage 1 is a docs/spec/evaluation harness, with no UI implementation target yet."

### Task Hierarchy

**Existing job:** Represent containing work, child tasks, dependencies, rollups, and runnable leaf work.

**Orientation Spine job:** Place those tasks under the project skeleton and roll their states up into feature/slice maturity.

**Relationship:** Task hierarchy remains the execution hierarchy. The spine uses task hierarchy to compute progress, but not every spine node is a task. A goal, audience, feature, or release objective may exist before there are runnable tasks.

**Example:** A feature can be `spec` or `needs_breakdown` before any child task exists. A task can be done while its parent feature remains `unproven`.

### Logical Work And Delivery Steps

**Existing job:** Keep primary work lists focused on logical work while delivery steps/proof obligations control done state.

**Orientation Spine job:** Aggregate delivery progress into owner-facing feature/slice states.

**Relationship:** Delivery steps remain inside work items. The spine summarizes them as maturity and proof coverage.

**Example:** A slice with implementation done, tests done, and browser proof missing is `built, proof_needed`, not simply "2/3 steps done" unless the user drills in.

### Delivery Spine / Primitives

**Existing job:** Project-local model of drivers, delivery packages, tasks, dependencies, primitives, and proof.

**Orientation Spine job:** Turn delivery-spine data into an owner-readable project situation snapshot and a zoomable navigation model.

**Relationship:** The Project Orientation Spine evolves the delivery spine by adding charter, capability tree, maturity rollups, and active work pins. It does not replace primitives, drivers, task dependencies, or proof.

**Example:** `MenuItem` as a primitive remains delivery-spine data. `Editing surface foundations are 70% proven; ContextMenu is blocked by MenuItem hover/focus proof` is orientation-spine output.

### Project Graph

**Existing job:** Internal or feature-flagged coordination graph for projects, domains, packages, delivery channels, external authorities, and cross-project dependency edges.

**Orientation Spine job:** Owner-facing project state for the current project.

**Relationship:** Do not revive the superseded local project graph plan. If project graph data is useful, read it as evidence through existing APIs. The spine is not the cross-project authority model.

**Example:** A provider/consumer dependency edge can appear as a blocker on a spine node. The spine does not own the edge lifecycle.

### Release Readiness

**Existing job:** Decide whether current work can close and what blocks release.

**Orientation Spine job:** Show release readiness as a rollup over the whole skeleton, with the blocking feature/slice/proof node named.

**Relationship:** Release readiness remains the release verdict engine. The spine adds navigability and context.

**Example:** Instead of "release blocked by incomplete briefs," Overview says "Release blocked: Story search has a spec draft but no approved brief; open that node."

### Threads

**Existing job:** Hold conversations, owner input, active questions, approvals, and history.

**Orientation Spine job:** Attach each thread to a project/area/feature/slice/task/proof node so discussion becomes grounded evidence instead of a flat activity stream.

**Relationship:** Threads stay the interaction record. The spine supplies their location in the project skeleton.

**Example:** A thread is not "stuff about anti-sameness"; it is "open decision on Feature: Anti-sameness safeguards / Slice: Review finding taxonomy."

## What This Evolves

This plan evolves:

- `internal/plans/2026-05-24-project-overview-and-nav-ia.md`: Overview becomes a 100-foot situation map powered by a shared spine model, not a widget dashboard or the full 1,000-foot project map.
- `internal/plans/2026-05-27-project-orientation-and-proof-paths.md`: Project orientation/proof paths become attached to a visible capability tree instead of floating as consequence/proof summaries.
- `internal/plans/2026-05-30-ready-state-and-decomposition-model.md`: `ready` and `needs_breakdown` become feature/slice maturity signals, not just Work UI labels.
- `internal/specs/2026-06-05-guildhall-0-10-primitives-and-delivery-spine.md`: delivery spine remains the project-local execution/proof substrate; orientation spine adds charter/capability/progress rollups above it.
- `internal/specs/2026-06-12-guildhall-logical-work-and-delivery-steps.md`: logical work and delivery steps become the source for progress rollups inside spine nodes.
- `internal/audits/flow-audit.md`: flow-audit gets a new required evidence lane proving the same spine state appears consistently across Overview, Structure, Work, Thread, Release, API, and visible cards.

## What This Supersedes

This plan supersedes these attempted product shapes as owner-facing orientation strategies:

- raw Overview activity aggregation as the default project orientation;
- task-count dashboards as the main answer to project progress;
- threads as the primary way to reconstruct project history;
- Structure tab as the place users must visit to understand the whole project;
- Release tab as the first place users learn whether a feature is proven;
- broad `ready` task labels for parent or unsliced work;
- local UI-only ranking of "what to do next" outside the shared summary/action model.

This plan does not supersede the underlying data systems unless a task explicitly migrates them.

## Why Prior Structural Attempts Failed

### 1. They Modeled The Repo More Than The Owner's Mental Model

Structural/domain intelligence explains packages, domains, executable units, and routing. That is necessary for agent work, but it does not tell the owner what the project is trying to become.

The spine succeeds only if its top node starts with project charter fields:

- goal;
- target audience;
- current release target;
- success definition;
- non-goals;
- known project stage.

Without those fields, the system will drift back to repo archaeology.

### 2. They Treated Activity As Orientation

Overview, Thread, and Timeline can show that work happened. That does not answer what is true now.

The spine is state-first, not event-first. Threads, activity, and artifacts are evidence attached to nodes.

### 3. They Had No Common Rollup Unit

Tasks roll up to tasks. Release readiness rolls up checks. Structural map rolls up repo domains. None of those rolls up goals -> areas -> features -> slices -> proof.

The spine introduces a common orientation unit: `OrientationNode`.

### 4. They Let Parent Work Pretend To Be Runnable

Narrative Harness exposed this: broad top-level work appeared ready even though it needed breakdown.

The spine makes maturity explicit:

```ts
type OrientationMaturity =
  | 'idea'
  | 'brief'
  | 'spec'
  | 'needs_breakdown'
  | 'sliced'
  | 'ready'
  | 'active'
  | 'review'
  | 'proof_needed'
  | 'proven'
  | 'done'
  | 'blocked'
  | 'deferred'
```

Only leaf runnable work can be `ready` for workers. Parent nodes derive maturity from children and proof.

### 5. They Did Not Pin Agent Work To The Skeleton

The owner needs to know where work is pinned now. A running task, blocked question, open review, or proof obligation must point to a node in the project skeleton.

The spine adds `activePins` as first-class output.

### 6. They Did Not Make Gaps Visible

If Guildhall cannot place a spec, task, thread, or artifact in the skeleton, that is not harmless. It is an orientation gap.

The spine creates explicit gap buckets:

- missing charter;
- unplaced task;
- unanchored thread;
- spec not indexed;
- feature without brief;
- spec without slices;
- done work without proof;
- release blocker without owning node.

## Information Acquisition Contract

The Project Orientation Spine is not allowed to become a new classification job
for the owner.

Guildhall must collect orientation information in this order:

1. **Read what already exists.**
2. **Infer conservatively from durable sources.**
3. **Show the inferred answer with provenance and confidence.**
4. **Ask the owner only for the smallest correction that changes behavior or
   meaning.**
5. **Persist only owner-authored or owner-approved orientation facts after a
   separate schema decision.**

This is part of the cognitive-load contract. The owner should experience the
spine as "Guildhall has prepared the map for me to inspect," not "Guildhall has
created another form I have to fill out before I can understand my project."

### Source Precedence

Every orientation field must carry source metadata. When sources disagree,
Guildhall must expose a conflict or correction prompt instead of blending them
into a confident sentence.

Use this precedence:

1. owner-approved orientation metadata;
2. workspace/project config that already encodes owner intent, such as council
   mandate, child project labels, and coordinator boundaries;
3. accepted release plan or selected bounded scope;
4. accepted specs, briefs, and implementation artifacts;
5. task hierarchy, logical work, delivery steps, proof paths, and completion
   handoffs;
6. release-readiness blockers and owner-input records;
7. accepted structural intake and project graph evidence;
8. project docs such as `README.md`, `docs/index.md`, product notes, roadmap
   files, and spec indexes;
9. title/description heuristics, always labeled `inferred`.

Lower-precedence sources can fill blanks. They cannot silently override a
higher-precedence source.

### Field Acquisition Map

| Spine information | First source | Fallback source | Owner interaction |
| --- | --- | --- | --- |
| Project purpose | Owner-approved charter or workspace council mandate | `README.md`, `docs/index.md`, product/spec overview docs, then coordinator mandate only when project-level sources are absent or weak | Ask to confirm or correct only when missing, conflicting, or behavior-affecting. |
| Target audience | Owner-approved charter | Product docs, README target/audience paragraphs, accepted briefs | Ask only if the inferred audience changes prioritization or proof expectations. |
| Success definition | Release plan or charter | Acceptance criteria, proof paths, done-summary handoffs | Ask only when the selected scope cannot define ready/proven. |
| Non-goals | Owner-approved charter or release plan | Out-of-scope fields in briefs/specs | Ask only when a proposed task conflicts with a likely non-goal. |
| Selected bounded scope | Owner-approved current release | Active release plan, accepted proposed feature set, current route context, then inferred Current MVP | Ask only when multiple plausible active scopes would change what Guildhall works on. |
| Included now | Selected bounded-scope node list | Known proposed work defaults into Current MVP | Ask only when Guildhall is about to defer work or include work against ambiguous evidence. |
| Deferred/later work | Owner-approved release segmentation | Release/spec labels, explicit future/backlog markers | Ask only when deferral would block normal unattended work. |
| Capability/feature tree | Accepted specs and artifacts | Task hierarchy, structural domains, docs/spec indexes, title clustering | Do not ask the owner to classify every item. Surface unplaced clusters as proposed corrections. |
| Slice/task placement | Task hierarchy and artifact refs | Title/description matching to feature nodes | Ask only for unplaced active work, release blockers, or high-impact proof gaps. |
| Maturity state | Task lifecycle, spec/brief presence, delivery steps, proof state | Artifact status and completion handoff evidence | No owner action unless state disagreement changes readiness. |
| Active pins | Running/review/blocked/proof-needed tasks and thread turns | Owner-input records and release blockers | No owner action; pins are observed runtime state. |
| Proof missing | Proof paths, completion handoffs, release readiness | Acceptance criteria and reviewer findings | Ask only when proof requirement itself is ambiguous. |
| What Start will work on | Scheduler eligibility over selected scope | Explicit owner-targeted request | Ask only when the requested action conflicts with selected/deferred scope. |
| Where to drill in | Stable node ids and task/thread/artifact refs | Best inferred node path | No owner action; unresolved destinations become placement gaps. |

### Acquisition Flow

When Guildhall builds the spine, it should follow this loop:

1. Load the project snapshot: config, tasks, logical work, delivery steps,
   threads, owner-input records, release readiness, artifacts, structural map,
   and project graph evidence.
2. Load lightweight project docs that commonly explain intent:
   `README.md`, `docs/index.md`, product overviews, roadmap files, and spec
   indexes.
3. Resolve the selected bounded scope using source precedence.
4. Place known work into the scope:
   - owner/plan-included work goes into `included`;
   - owner/plan-future work goes into `deferred`;
   - unsegmented known proposed work goes into the inferred `Current MVP`.
5. Build the capability tree from accepted specs/artifacts first, task
   hierarchy second, and structural/docs evidence third.
6. Attach pins, proof paths, blockers, thread turns, and owner-input records to
   the most specific node with a stable id.
7. Compute maturity/readiness from execution and proof state. Do not let broad
   parent work masquerade as runnable leaf work.
8. Emit gaps for missing, conflicting, stale, or unplaced evidence.
9. Render the compact orientation snapshot first, then detailed drill-down.

### Owner-Correction Rule

The owner should never be asked to build the spine from scratch.

Guildhall may ask for a correction only when all of these are true:

- existing sources are missing, conflicting, or too ambiguous;
- the answer would change what Guildhall displays prominently, works on next,
  marks as blocked, or treats as ready;
- Guildhall can phrase the correction as one small decision, not a broad
  taxonomy exercise.

Good correction prompts:

```text
I found two possible current scopes: MVP checkout launch and license docs. Which
one should Guildhall treat as active?
```

```text
I can place 7 of 8 active tasks under Story intelligence. Should "Hosted runs"
stay in Current MVP or move to Later?
```

Bad correction prompts:

```text
Please classify every task into a feature, slice, release, and maturity state.
```

```text
Please fill out the project charter before Guildhall can show an overview.
```

### Missing Data Behavior

Missing information should not collapse the whole orientation surface.

If a field is missing:

- show the best safe inferred answer when one exists;
- label it as inferred in the model;
- show a small `Needs grounding` gap in the UI;
- keep the rest of the orientation snapshot usable;
- defer owner correction until the missing fact affects action, readiness, or
  meaning.

For example, a project with tasks but no charter can still show:

```text
Current MVP: 8 included, 0 later
Current focus: Build first coherence reviewer MVP
Needs grounding: project purpose and target audience need confirmation
```

A project with docs but thin Guildhall task state can still show:

```text
Purpose: inferred from README
Current MVP: 1 included, 0 later
No active work is pinned in this scope
```

That is an honest thin map, not a failure. It becomes a failure only if
Guildhall hides the uncertainty, invents a rich feature tree, or asks the owner
to do broad manual classification work.

## Scoped Completeness

A project is never complete. A project is an ongoing container for goals,
releases, feature proposals, decisions, proof, and future work.

Only a bounded scope can be complete:

- a release;
- a milestone;
- a proposed feature set;
- a campaign;
- an area or feature under review;
- a proof pass.

That means the spine must never say:

```text
Narrative Harness is complete.
```

It can say:

```text
Stage 1 docs/spec/evaluation harness is ready.
```

or:

```text
The current proposed feature set is 5 of 8 features specced, 3 sliced, 1 active, and 0 proven.
```

If the owner adds a new feature proposal after a release is complete, the
project did not become "incomplete again." The previous release remains
complete, and the newly selected release/proposed feature set has its own
progress state.

Every progress statement must name its scope. If no scope is selected, Guildhall
should show an orientation gap:

```text
No release or proposed feature set is selected yet.
```

The default Overview scope should be chosen in this order:

1. owner-approved current release;
2. active release plan;
3. current proposed feature set from accepted specs/artifacts;
4. active area or feature when the route is already narrowed;
5. inferred project-wide orientation, visibly labeled as inferred and not
   described as complete/incomplete.

## Initial MVP And Deferred Scope Semantics

When a project starts, Guildhall should treat the known proposed feature set as
the current MVP by default.

That default matters because early projects are usually under-shaped. If the
owner has not yet separated work into later releases, Guildhall should not
silently decide that some visible feature is "future" just because it is large,
unclear, or less convenient. The initial stance is:

```text
Known proposed work belongs to the current MVP until the owner or accepted plan
segments it into a later scope.
```

Once work is segmented out of the current bounded scope, that segmentation must affect
what Guildhall works on.

Nodes outside the selected bounded scope should be treated as
deferred for normal unattended work:

- they can stay visible in the spine;
- they can appear in "Later" or "Deferred" groups;
- they can contribute to project orientation;
- they must not be picked by the coordinator for the current scope;
- they must not count against selected-scope readiness;
- they must not make the selected scope look blocked;
- they can become active only when the owner asks for that specific feature or
  changes the selected working scope.

This keeps two truths separate:

- the project may know about many future features;
- Guildhall is currently working one selected bounded scope.

The spine should make that boundary visible. Example:

```text
Current scope: MVP
Included: Character continuity, anti-sameness safeguards, packet debug report
Later: Collaborative editing, production UI, hosted runs
```

If the owner later says "work on collaborative editing," Guildhall can create a
targeted temporary bounded scope for that feature or switch the selected scope.
Until then, that feature stays deferred.

## Product Contract

At every project route, the owner should be able to answer:

1. What is this project for?
2. Who is it for?
3. What are the major areas/features?
4. What state is each feature in?
5. What is currently being worked?
6. What needs owner input?
7. What is blocked?
8. What is proven?
9. What is unproven?
10. Which bounded scope is this progress measured against?
11. Is that bounded scope ready, blocked, active, or still being shaped?
12. Which known features are included now and which are deferred?
13. Where do I click to zoom in?

If the UI cannot answer those questions, the route fails the orientation audit.

## Proposed Data Model

The first implementation should be a read model built from existing state. Persist only the owner-authored or owner-approved fields that cannot be reliably derived.

```ts
export interface ProjectOrientationSpine {
  projectId: string
  updatedAt: string
  scope: OrientationScope | null
  charter: ProjectOrientationCharter
  summary: ProjectOrientationSummary
  roots: OrientationNode[]
  activePins: OrientationPin[]
  gaps: OrientationGap[]
  release: OrientationReleaseSummary
  sourceHealth: OrientationSourceHealth
}

export interface ProjectOrientationCharter {
  goal: string | null
  targetAudience: string | null
  currentReleaseTarget: string | null
  successDefinition: string | null
  nonGoals: string[]
  source: 'owner_approved' | 'inferred' | 'missing'
}

export interface OrientationScope {
  id: string
  label: string
  kind: 'release' | 'milestone' | 'proposed_feature_set' | 'campaign' | 'area' | 'feature'
  source: 'owner_approved' | 'spec' | 'release_plan' | 'inferred'
  nodeIds: string[]
  deferredNodeIds: string[]
}

export interface OrientationNode {
  id: string
  parentId: string | null
  kind: 'project' | 'area' | 'feature' | 'slice' | 'work' | 'proof' | 'release'
  title: string
  summary: string
  maturity: OrientationMaturity
  progress: OrientationProgress
  proof: OrientationProofSummary
  ownerAction: OrientationOwnerAction | null
  blockers: OrientationBlocker[]
  refs: OrientationRefs
  children: OrientationNode[]
}

export interface OrientationProgress {
  scopeId: string | null
  total: number
  briefed: number
  specced: number
  sliced: number
  ready: number
  active: number
  proven: number
  done: number
  blocked: number
}

export interface OrientationRefs {
  taskIds: string[]
  threadIds: string[]
  artifactIds: string[]
  structuralDomainIds: string[]
  primitiveIds: string[]
  releaseCheckIds: string[]
}
```

## Source Precedence

Build the spine with explicit source precedence so it cannot become another pile of heuristic guesses.

1. Owner-approved charter/orientation metadata.
2. Accepted structured specs and artifacts.
3. Task hierarchy, logical work, delivery steps, proof paths, and completion handoffs.
4. Accepted structural map/project structure data.
5. Release-readiness API output.
6. Thread active questions and decisions.
7. Inferred fallback from titles/descriptions, always marked `inferred`.

Inferred nodes must be visibly different in the UI and must produce a gap when they affect release or next action.

## Design Review Findings To Close Before Implementation

This plan is directionally right, but it still has ways to fail while all the
current tests pass. Close these gaps before calling the feature done.

### 1. Rendering Agreement Is Not Owner Orientation

The plan currently proves that the same facts appear across routes. It also
needs to prove that those facts answer the owner's real questions quickly.

Add a comprehension fixture for each calibration project. A passing run must
answer these questions from Overview without opening raw Thread history:

- What is this project for?
- Who is it for?
- What bounded scope is Guildhall working now?
- Which features are included now?
- Which features are deferred?
- What is pinned right now?
- What is the top blocker?
- What proof is missing?
- Where do I click next?

If the test can only find those answers by reading task titles, raw transcript,
or activity logs, the feature fails.

### 2. Deferred Scope Must Affect Scheduling

Deferred scope cannot be only a label. The coordinator/orchestrator picker must
consume the selected bounded scope or a derived allowlist.

A deferred node must be scheduler-ineligible for normal unattended work unless:

- the owner explicitly asks for that feature;
- the selected bounded scope changes;
- the task is a required blocker for an included node and the spine records that
  dependency as an included prerequisite.

This needs runtime tests, not only Svelte tests.

### 3. Spine Nodes Need Stable Identity And Provenance

If node ids shift whenever titles change, or if a node cannot explain where it
came from, the spine will become another summary blob.

Every `OrientationNode` needs:

- stable id;
- source kind;
- source refs;
- confidence;
- inferred/owner-approved distinction;
- last refreshed timestamp;
- stale/conflict flags when source records disagree.

If two sources disagree, the spine should expose a gap or conflict. It must not
smooth over disagreement with a prettier sentence.

### 4. Narrative Harness Alone Is Not Enough Calibration

Narrative Harness is the main pain case, but the spine must work across at
least three shapes:

- Narrative Harness: docs/spec/evaluation harness, many conceptual features,
  little runtime proof.
- Jess: mature technical repo with structural domains, benchmarks, and deep
  implementation queues.
- Fair Labor License or another app: product/release/proof flow with owner
  setup, external services, and browser proof.

If it only works for Narrative Harness, it may overfit to docs/spec projects.

### 5. Correct Structure Can Still Be Too Much Work

The spine can be technically correct and still fail if the owner has to do too
much to understand it.

Previous attempts have repeatedly fallen into two traps:

- too many additional actions for the user to take;
- too much cognitive overhead before the user can understand the project
  meaningfully.

The spine must therefore optimize for instant orientation, not maximum exposed
structure. The first screen should answer the most important questions without
requiring the owner to scroll through a long tree, open several drawers, inspect
Thread history, or learn a new ontology.

This is a hard product requirement:

```text
The AI should do the synthesis work. The owner should not have to operate the
spine like a filing system just to understand the project.
```

The spine should add depth, but the owner should feel less burden, not more.

## Verification Ladder

This feature is successful only if it passes all layers below.

### Layer 1: Pure Model Truth

Tests must prove:

- project-level completeness is impossible;
- bounded-scope readiness is possible;
- default MVP includes all known proposed work;
- segmented future work is deferred;
- deferred work does not block selected-scope readiness;
- selected-scope blockers point to owning nodes;
- broad unsliced parent work becomes `needs_breakdown`;
- done work without proof becomes `proof_needed`;
- unanchored source records become gaps;
- conflicting source records become conflicts;
- inferred data stays labeled as inferred.

### Layer 2: Runtime Enforcement

Tests must prove:

- coordinator selection excludes deferred nodes for unattended current-scope work;
- an explicit owner request can target a deferred feature without changing the
  whole scope;
- changing selected bounded scope changes what work becomes eligible;
- a deferred prerequisite can be pulled into scope only when an included node
  depends on it and the dependency is visible.

### Layer 3: API Agreement

Tests must prove `/api/project/spine`, `/api/project`, `/api/project/inbox`,
`/api/project/release-readiness`, and project graph/structure payloads do not
contradict each other about:

- selected bounded scope;
- active pins;
- deferred counts;
- top blockers;
- owner-input state;
- release/proof readiness.

### Layer 4: UI Comprehension

Rendered UI tests must prove the owner can answer the comprehension fixture
questions from Overview, then verify drill-down links to Work, Thread,
Structure, and Release.

The test should fail if Overview is merely a pile of cards with the right words
but no coherent hierarchy.

It should also fail if the answer requires unnecessary interaction. For the
default desktop viewport, Overview must answer the core questions in the first
screenful or with one obvious primary expansion. Mobile may stack content, but
the top of the page must still provide a compact orientation snapshot before the
longer tree.

Core first-screen questions:

- What is this project?
- What bounded scope is active?
- What is included now?
- What is deferred?
- What is pinned?
- What is blocking readiness?
- What should happen next?

If a user must click across tabs, open multiple disclosures, or scroll through
raw lists to answer those, the UI fails.

### Layer 5: Live Installed Proof

Installed-app proof must run against `localhost:7777`, confirm `stale:false`,
and capture evidence for:

- desktop;
- narrower desktop;
- mobile;
- no clipped content;
- no hidden horizontal overflow except named scroll regions;
- stable top action;
- route agreement across Overview, Work, Thread, Structure, and Release.

### Layer 6: Owner-Facing Evaluation

Before calling the feature done, run a manual orientation audit using the
calibration prompts below and record answers in `internal/audits/flow-audit.md`.

Prompts:

```text
In 30 seconds, what is this project for?
What bounded scope is Guildhall working?
What is included now?
What is deferred?
What is pinned right now?
What is blocking readiness?
What proof is missing?
What would Guildhall work on if I press Start?
What would Guildhall not work on unless I ask?
Where do I click to inspect the active feature?
```

If a skilled owner still has to reconstruct answers from raw task/thread
history, the implementation is not done.

## Simplicity And Cognitive-Load Bar

The Project Orientation Spine must make Guildhall feel simpler than it does
today.

### Default View Rule

Overview should start with a compact orientation snapshot, not a complete tree.

The default visible order should be:

1. one-sentence project purpose;
2. selected bounded scope;
3. included/deferred summary;
4. pinned now;
5. top blocker or proof gap;
6. one recommended next action.

The detailed capability tree comes after that summary. The tree supports zooming
in; it should not be the price of understanding the project.

### Action Burden Rule

Do not turn orientation into a new checklist for the owner.

The first implementation should avoid adding required owner actions unless the
action resolves a real ambiguity:

- approve or correct inferred charter;
- choose or change bounded scope;
- place genuinely unanchored work;
- resolve conflicting source truth.

Do not ask the owner to manually classify every task, thread, feature, slice, or
proof path just so the spine can exist. Infer conservatively, show confidence,
and surface only the highest-value corrections.

### AI Synthesis Rule

AI agents should prepare the orientation, not ask the owner to build it.

When data is missing or conflicting, Guildhall should present a proposed answer:

```text
Guildhall thinks the current MVP is Character continuity, anti-sameness, and
packet debug reports. Production UI appears later. Confirm or adjust?
```

Avoid empty forms like:

```text
Define project areas.
Add features.
Assign each task to a release.
Choose maturity for every node.
```

### Disclosure Rule

Progressive disclosure is allowed only when the collapsed state is meaningful.

Bad collapsed state:

```text
7 features
```

Good collapsed state:

```text
MVP: 3 included, 2 active, 1 blocked by missing proof. 4 later.
```

Every collapsed section should carry enough meaning that the owner can decide
whether to open it.

### Cognitive-Load Regression Tests

Rendered UI and manual audit should prove:

- the Overview first screen has a compact orientation snapshot;
- the first screen does not start with raw counts, raw tasks, or a giant tree;
- the user can answer the core first-screen questions without opening Thread;
- no more than one primary next action is presented at the top;
- secondary actions are grouped under clear sections;
- deferred work is visible but not competing with current-scope action;
- missing information appears as a small number of proposed corrections, not a
  blank setup chore list.

If the implementation makes the user do more planning administration than they
do today, the feature fails.

## Implementation Tasks

### Task 1: Write Spine Contract Tests

**Files:**
- Create: `src/runtime/__tests__/project-orientation-spine.test.ts`
- Create: `src/runtime/project-orientation-spine.ts`

- [ ] **Step 1: Add a failing test for charter plus capability rollup**

Create `src/runtime/__tests__/project-orientation-spine.test.ts` with:

```ts
import { describe, expect, it } from 'vitest'
import { buildProjectOrientationSpine } from '../project-orientation-spine.js'

describe('buildProjectOrientationSpine', () => {
  it('builds a scoped state-of-the-union spine from charter, release scope, work hierarchy, and proof', () => {
    const spine = buildProjectOrientationSpine({
      projectId: 'narrative-harness',
      now: '2026-06-15T12:00:00.000Z',
      charter: {
        goal: 'Build a fiction-first evaluation and reasoning harness.',
        targetAudience: 'Authors and agent builders working on long-form fiction.',
        currentReleaseTarget: 'Stage 1 docs/spec/evaluation harness.',
        successDefinition: 'Specs are indexed, sliced, and tied to proof paths.',
        nonGoals: ['Production UI'],
        source: 'owner_approved',
      },
      scope: {
        id: 'stage-1',
        label: 'Stage 1 docs/spec/evaluation harness',
        kind: 'release',
        source: 'owner_approved',
        nodeIds: ['work:task-anti-sameness'],
      },
      tasks: [
        {
          id: 'task-anti-sameness',
          title: 'Anti-sameness safeguards',
          status: 'ready',
          workKind: 'feature_spec',
          productBrief: { approvedAt: '2026-06-10T00:00:00.000Z' },
          spec: 'Define repeated-scene and voice-flattening safeguards.',
          acceptanceCriteria: [{ id: 'AC-1', description: 'Spec indexed.' }],
          proofPaths: [],
          hierarchy: { childIds: ['task-finding-taxonomy'] },
        },
        {
          id: 'task-finding-taxonomy',
          title: 'Finding taxonomy',
          status: 'done',
          parentId: 'task-anti-sameness',
          hierarchy: { parentId: 'task-anti-sameness' },
          completionHandoff: {
            summary: 'Finding taxonomy is documented.',
            whatChanged: ['Added taxonomy spec.'],
            whatCanBeDoneNow: ['Reviewer contracts can reference weighted findings.'],
            howToProveIt: ['Open docs/specs and confirm taxonomy entry.'],
            verified: ['docs build passed'],
            notVerified: ['No prototype run yet'],
            remainingRisks: ['Needs fixture proof'],
          },
        },
      ],
      threads: [],
      releaseReadiness: {
        verdict: 'blocked',
        blockers: [{ id: 'proof:anti-sameness', label: 'Anti-sameness has no prototype proof.' }],
      },
      structuralMap: null,
    })

    expect(spine.charter.goal).toContain('fiction-first')
    expect(spine.scope?.label).toBe('Stage 1 docs/spec/evaluation harness')
    expect(spine.summary.headline).toBe('Stage 1 docs/spec/evaluation harness is blocked on proof.')
    expect(spine.summary.progress.specced).toBe(1)
    expect(spine.summary.progress.proven).toBe(0)
    expect(spine.roots[0]?.title).toBe('Anti-sameness safeguards')
    expect(spine.roots[0]?.maturity).toBe('proof_needed')
    expect(spine.release.blockers[0]?.owningNodeId).toBe('work:task-anti-sameness')
  })
})
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run:

```sh
pnpm vitest run src/runtime/__tests__/project-orientation-spine.test.ts --reporter=dot
```

Expected: fail because `src/runtime/project-orientation-spine.ts` or `buildProjectOrientationSpine` does not exist.

### Task 2: Implement The Pure Spine Builder

**Files:**
- Modify: `src/runtime/project-orientation-spine.ts`
- Test: `src/runtime/__tests__/project-orientation-spine.test.ts`

- [ ] **Step 1: Add the minimal exported types and builder**

Implement `ProjectOrientationSpine`, `OrientationNode`, `OrientationMaturity`, and `buildProjectOrientationSpine(input)`.

Rules:

- Do not persist anything in this task.
- Do not mutate task records.
- Use existing task hierarchy semantics where possible.
- Parent feature nodes derive maturity from children and proof.
- Release blockers must try to attach to a node; unattached blockers become gaps.

- [ ] **Step 2: Run the focused test**

Run:

```sh
pnpm vitest run src/runtime/__tests__/project-orientation-spine.test.ts --reporter=dot
```

Expected: pass.

### Task 3: Add Gap Detection Tests

**Files:**
- Modify: `src/runtime/__tests__/project-orientation-spine.test.ts`
- Modify: `src/runtime/project-orientation-spine.ts`

- [ ] **Step 1: Add tests for unanchored and inferred state**

Add cases proving:

- missing charter produces `missing_charter`;
- broad ready parent without children/proposal produces `needs_breakdown`;
- thread without task/spine reference produces `unanchored_thread`;
- release blocker without owning node produces `unanchored_release_blocker`;
- inferred nodes carry `source: 'inferred'`.
- nodes outside the selected bounded scope are `deferred` and are excluded from selected-scope readiness.
- source conflicts produce a visible `source_conflict` gap instead of being silently resolved.
- every node has stable id, source refs, confidence, and freshness metadata.

- [ ] **Step 2: Implement gap detection**

Implement deterministic gap detection in the builder. Use conservative matching only. If unsure, create a gap instead of pretending the model knows.

- [ ] **Step 3: Run the tests**

Run:

```sh
pnpm vitest run src/runtime/__tests__/project-orientation-spine.test.ts --reporter=dot
```

Expected: pass.

### Task 4: Expose `/api/project/spine`

**Files:**
- Modify: `src/runtime/serve-dashboard.ts`
- Modify: `src/runtime/__tests__/serve-dashboard.test.ts`
- Modify: `src/runtime/project-orientation-spine.ts`

- [ ] **Step 1: Add an API test**

Add a service test that requests:

```text
/api/project/spine?projectId=narrative-harness
```

Assert that the response includes:

- `charter`;
- `scope`;
- `summary`;
- `roots`;
- `activePins`;
- `gaps`;
- `release`;
- `sourceHealth`.

- [ ] **Step 2: Wire the endpoint**

Build the spine from the same project detail state used by Overview, Work, Thread, Structure, and Release.

- [ ] **Step 3: Run focused API tests**

Run:

```sh
pnpm vitest run src/runtime/__tests__/serve-dashboard.test.ts -t "project spine" --reporter=dot
```

Expected: pass.

### Task 4.5: Enforce Selected Scope In Scheduling

**Files:**
- Modify: `src/runtime/orchestrator-picker.ts`
- Modify: `src/runtime/__tests__/orchestrator-picker.test.ts`
- Modify: `src/runtime/project-orientation-spine.ts`

- [ ] **Step 1: Add scheduler tests for deferred work**

Add tests proving:

- a ready task outside `scope.nodeIds` is not picked for normal unattended work;
- an owner-targeted deferred feature can be picked when the request explicitly names it;
- changing selected bounded scope changes the eligible task set;
- a deferred prerequisite can be selected only when an included node depends on it and the dependency is shown in the spine.

- [ ] **Step 2: Implement scheduler filtering through the shared model**

Do not duplicate scope math in the picker. The picker should consume a derived
eligibility result from the spine builder or a shared runtime helper.

- [ ] **Step 3: Run focused scheduler tests**

Run:

```sh
pnpm vitest run src/runtime/__tests__/orchestrator-picker.test.ts -t "bounded scope" --reporter=dot
```

Expected: pass.

### Task 5: Rebuild Overview Around The Spine

**Files:**
- Modify: `src/web/surfaces/project/ProjectOverviewTab.svelte`
- Modify: `src/web/surfaces/project/__tests__/ProjectOverviewTab.svelte.test.ts`
- Modify: `src/web/lib/project-summary.ts` if fleet cards need the same headline.

- [x] **Step 1: Add component tests for scoped orientation in existing Overview sections**

Tests must prove Overview renders:

- selected bounded scope;
- included-now and deferred-later counts;
- maturity counts;
- active pins;
- top release blocker;
- gaps.
- no standalone injected orientation/mockup section;
- no more than one primary top action.

- [x] **Step 2: Render spine-aware Overview through existing sections**

Overview must compose the orientation spine into:

1. the existing project header and live ticker;
2. the existing knowledge summary band, with `Scope` as a selectable summary
   card;
3. the existing `Do this next` card as the only primary action;
4. delivery/work/proof/project-map sections for deeper drill-down.
2. selected bounded scope;
3. included-now and deferred-later summary;
4. scoped progress strip;
5. active work pins;
6. capability tree;
7. release/proof blockers;
8. gaps.

Existing widgets can remain only if they serve those sections.

The detailed capability tree must not precede the compact orientation snapshot.
The user should not need to understand the whole tree before knowing what is
happening.

- [ ] **Step 3: Run Overview tests**

Run:

```sh
pnpm vitest run src/web/surfaces/project/__tests__/ProjectOverviewTab.svelte.test.ts --reporter=dot
```

Expected: pass.

### Task 6: Anchor Threads And Work To Spine Nodes

**Files:**
- Modify: `src/runtime/project-orientation-spine.ts`
- Modify: `src/web/surfaces/project/ThreadTab.svelte`
- Modify: `src/web/surfaces/project/WorkTab.svelte`
- Modify: `src/web/surfaces/project/__tests__/ThreadTab.svelte.test.ts`
- Modify: `src/web/surfaces/project/__tests__/WorkTab.svelte.test.ts`

- [ ] **Step 1: Add UI tests for anchoring**

Tests must prove:

- a thread with a task id shows its feature/slice path;
- a Work item shows its spine path;
- deferred work outside the selected bounded scope is not shown as coordinator-runnable current work;
- unanchored threads/tasks are labeled as placement gaps, not hidden.

- [x] **Step 2: Render spine paths**

Use compact breadcrumb text:

```text
Story intelligence / Anti-sameness safeguards / Finding taxonomy
```

Do not add a new sidebar or dense graph UI in this task.

- [x] **Step 3: Run focused tests**

Run:

```sh
pnpm vitest run src/web/surfaces/project/__tests__/ThreadTab.svelte.test.ts src/web/surfaces/project/__tests__/WorkTab.svelte.test.ts --reporter=dot
```

Expected: pass.

### Task 7: Make Release And Structure Consume The Same Spine

**Files:**
- Modify: `src/web/surfaces/project/ReleaseTab.svelte`
- Modify: `src/web/surfaces/project/structure/ProjectStructurePanel.svelte`
- Modify: `src/web/surfaces/project/__tests__/ReleaseTab.svelte.test.ts`
- Modify: `src/web/surfaces/project/structure/__tests__/ProjectStructurePanel.svelte.test.ts`

- [x] **Step 1: Add cross-surface agreement tests**

Tests must prove the same blocker/node appears in:

- Overview top release blocker;
- Release blocking checks;
- Structure related domain/project-map context.

- [x] **Step 2: Render spine references**

Release should link blockers back to spine nodes. Structure should show when structural domains support a feature/slice instead of making the domain itself the project plan.

- [x] **Step 3: Run focused tests**

Run:

```sh
pnpm vitest run src/web/surfaces/project/__tests__/ReleaseTab.svelte.test.ts src/web/surfaces/project/structure/__tests__/ProjectStructurePanel.svelte.test.ts --reporter=dot
```

Expected: pass.

### Task 8: Add Flow-Audit Deterministic Checks

**Files:**
- Modify: `tests/rendered-ui/flow-audit-assertions.ts`
- Modify: `tests/rendered-ui/project-flow.spec.ts`
- Modify: `internal/audits/flow-audit.md`

- [x] **Step 1: Add an assertion helper**

Add `expectProjectOrientationSpineAgreement(page, expected)` to verify:

- Overview headline;
- selected bounded-scope label;
- deferred count;
- active pin count;
- top blocker;
- Work/Thread anchor label;
- Release blocker node.
- the `What would Guildhall work on if I press Start?` answer excludes deferred work.
- the first screen contains purpose, active bounded scope, included/deferred
  summary, pinned work, top blocker, and one recommended next action.
- there is no top-level pile of competing primary actions.

- [x] **Step 2: Add Narrative Harness as calibration route**

Add or update a fixture route for:

```text
/projects/narrative-harness/overview
```

The test must fail if Overview can only show task/activity snippets and cannot show charter plus capability maturity.

Add at least two more calibration fixtures before closing the task:

```text
/projects/jess/overview
/projects/fair-labor-license/overview
```

The Jess fixture should prove technical/structural-domain orientation. The Fair
Labor License fixture should prove app/release/external-proof orientation.

- [x] **Step 3: Update flow-audit**

Add a checklist item under active gaps:

```markdown
- [ ] Project Orientation Spine: prove Narrative Harness can show charter, selected bounded scope, capability tree, maturity states, active pins, gaps, and release blocker agreement across Overview, Work, Thread, Structure, and Release. Project progress must never be framed as project completeness; only the selected bounded scope can be ready/complete.
```

- [x] **Step 4: Run rendered UI tests**

Run:

```sh
pnpm test:rendered-ui -- tests/rendered-ui/project-flow.spec.ts
```

Expected: pass after implementation.

### Task 9: Installed-App Proof

**Files:**
- No source edits unless the proof finds a bug.
- Update: `internal/audits/flow-audit.md` with evidence after proof.

- [x] **Step 1: Build and install**

Run:

```sh
pnpm build
pnpm dev:install
guildhall stop
guildhall start
```

- [x] **Step 2: Confirm freshness**

Run:

```sh
curl -s http://localhost:7777/api/stale-server
```

Expected: JSON includes `"stale":false`.

- [x] **Step 3: Browser proof**

Use Browser against:

```text
http://localhost:7777/projects/narrative-harness/overview
http://localhost:7777/projects/narrative-harness/work
http://localhost:7777/projects/narrative-harness/thread
http://localhost:7777/projects/narrative-harness/structure
http://localhost:7777/projects/narrative-harness/release
```

Verify desktop, narrower desktop, and mobile viewports. Content must not clip; any horizontal overflow must be inside a named scroll region.

### Task 10: Manual Orientation Audit

**Files:**
- Modify: `internal/audits/flow-audit.md`

- [x] **Step 1: Run the calibration prompts**

For Narrative Harness, Jess, and Fair Labor License, answer the Layer 6 prompts
from the installed app without reading raw task/thread history.

Also record the interaction count:

- answers available with no cross-tab navigation;
- answers available without raw Thread history;
- first-screen answers available on desktop;
- mobile answers available before the detailed tree;
- no more than one primary top action.

- [x] **Step 2: Record pass/fail evidence**

Record exact route, viewport, API endpoint, visible answer, and any gap in
`internal/audits/flow-audit.md`.

- [x] **Step 3: Fix or defer failures honestly**

Do not mark the feature complete if Narrative Harness still fails the
orientation audit. For non-primary calibration projects, either fix the issue or
record the exact deferred blocker and why it does not invalidate the first
release of this feature.

## Kill Criteria

Stop and redesign instead of continuing implementation if any of these happen:

- the spine becomes a separate persisted hierarchy before the read model proves value;
- Svelte components reimplement scope/readiness/deferred math locally;
- coordinator selection can still pick deferred work in normal unattended mode;
- Overview cannot answer the comprehension prompts without raw history;
- source conflicts are hidden behind confident prose;
- the first screen is a raw tree, raw task list, or raw dashboard instead of a
  compact orientation snapshot;
- the user must perform several setup/classification actions before the spine is
  useful;
- the top of Overview presents multiple competing primary actions;
- route agreement passes only because tests assert generic labels instead of
  exact node ids and blockers;
- Narrative Harness still feels like a list of activity rather than a project
  orientation snapshot.

## Knock-It-Out Bar

The implementation is excellent only if an owner can open Narrative Harness and
say, without asking Codex to reconstruct context:

```text
I know what this project is.
I know what bounded scope Guildhall is working.
I know what is included now and what is later.
I know where agent work is pinned.
I know what is blocked.
I know what proof is missing.
I know what pressing Start will and will not do.
I can drill into the right feature without reading history.
```

Anything less is not the feature; it is another dashboard.

## Contract Touch Decision

- **Work id:** project-orientation-spine-2026-06-15
- **Touched contracts:** project detail API, project summary/action model, coordinator work eligibility, Overview route contract, Work/Thread/Structure/Release route agreement, task-to-thread/artifact reference interpretation.
- **Contracts considered but not touched by this planning doc:** persisted task schema, structural-map schema, project graph registry, artifact registry, release-readiness verdict schema, MCP resource names.
- **Required follow-up:** implementation must decide whether charter/orientation metadata is persisted. If persisted, record a Schema Migration Decision before writing project state.
- **Proof required:** pure builder tests, scheduler eligibility tests, API tests, route/component agreement tests, rendered UI flow-audit assertion, installed-app browser proof against Narrative Harness, and manual orientation audit across Narrative Harness, Jess, and Fair Labor License.
- **Proof provided by this doc:** none; this is a planning artifact.
- **Waivers:** no runtime or persisted schema is changed by this document.
- **Owner-review items:** confirm the term "Project Orientation Spine"; confirm whether charter fields can be inferred initially or must be owner-approved before display; confirm whether Narrative Harness is the first calibration project; confirm the first supported scope kinds are `release` and `proposed_feature_set`.
- **Apply/revert behavior:** first implementation should be read-model only. If later persisted metadata lands, provide a migration backup and read-time fallback.

## Contract Touch Decision: Overview Release Readiness Card

- **Work id:** overview-release-readiness-card-2026-07-05
- **Touched contracts:** `/api/project` project detail read model now includes optional `releaseReadiness`, reusing the existing `/api/project/release-readiness` payload shape; `ProjectDetail` web type includes the same optional field; Project Overview renders that field with existing card/list primitives.
- **Contracts considered but not touched:** persisted task queue schema, release schema, workspace child-project schema, git-story snapshot schema, `/api/project/release-readiness` route shape, Start/Resume scheduling contracts.
- **Required follow-up:** reconcile release-readiness scoped-task accounting for materialized child work; the existing release-readiness suite still exposes two scope-accounting failures unrelated to the Overview card.
- **Proof required:** project detail exposes child-repo-aware release readiness for a non-git envelope; Overview shows the selected release/scope, done/unfinished/needs-you/git blocker counts, and named child repo blockers without interpreting the root folder as the git repo.
- **Proof provided:** `ProjectOverviewTab.svelte.test.ts` covers current release readiness with Looma/Knit blockers; `serve-release-readiness.test.ts` covers project detail release readiness for a non-git envelope with child repos; live Looma + Knit `/api/project` reports `repoIds: looma, knit`; installed browser proof shows the Overview card on desktop and mobile with no horizontal overflow.
- **Waivers:** no persisted migration is needed because the new field is optional and derived at read time.
- **Owner-review items:** confirm whether Overview should show two git blockers or a denser grouped repo summary when blocker lists are long.
- **Apply/revert behavior:** remove `releaseReadiness` from project detail and the Overview card; `/api/project/release-readiness` remains unchanged.

## Schema Migration Decision

No schema migration is approved by this document.

Implementation may add a read-only builder and API without migration. Before persisting any of these fields:

- project charter;
- orientation node ids;
- spine node references on tasks/threads/artifacts;
- owner-approved feature/slice tree;
- release target metadata;

the implementation must add a separate Schema Migration Decision with:

- persisted schema touched;
- migration id;
- existing data impact;
- compatibility reader;
- fixtures;
- tests;
- owner-facing plan text;
- rollback/revert behavior.

## Acceptance Criteria

- The same scoped project orientation snapshot is available from `/api/project/spine`.
- Narrative Harness Overview can show goal, target audience, selected bounded scope, capability tree, maturity states, active pins, proof gaps, and top blocker without reading raw threads.
- Work, Thread, Structure, and Release agree with Overview about active pins and blockers.
- Progress language never claims project completeness. It names the bounded release, milestone, campaign, feature, area, or proposed feature set being measured.
- A completed release can remain complete after new future features are proposed; the new proposal creates a new incomplete scope, not an incomplete project.
- At project start, known proposed work defaults into the MVP/current proposed feature set until an owner-approved plan segments it later.
- Work segmented outside the selected bounded scope is visible but deferred; the coordinator must not pick it for normal current-scope work unless the owner asks for that feature or changes the active scope.
- Coordinator/orchestrator tests prove deferred work is scheduler-ineligible for normal unattended work.
- Every node exposes stable identity, provenance, confidence, and freshness; source disagreement creates visible conflicts instead of confident prose.
- Narrative Harness, Jess, and Fair Labor License all pass the manual orientation audit, or non-primary failures are explicitly recorded with a bounded follow-up.
- Overview answers the Knock-It-Out Bar questions without raw task/thread history.
- Overview answers the core first-screen questions without cross-tab navigation,
  raw Thread history, or multiple required clicks.
- The top of Overview presents one recommended next action, with secondary
  actions grouped below the orientation snapshot.
- The feature reduces owner work: missing or conflicting orientation appears as
  a small number of proposed corrections, not a broad manual classification task.
- Broad unsliced work cannot appear simply as worker-ready at the orientation level.
- Unanchored tasks, threads, artifacts, or release blockers become visible gaps.
- The implementation does not revive the superseded local project graph plan.
- The implementation does not duplicate release readiness or task lifecycle logic locally in Svelte components.
- Flow-audit includes a Project Orientation Spine checklist item and deterministic rendered UI assertion.
- Installed app at `localhost:7777` proves `stale:false` and renders the Narrative Harness orientation without clipping at required viewports.

## Self-Review

- This plan distinguishes orientation from structure, structural intake, task hierarchy, delivery spine, project graph, release readiness, and threads.
- This plan states which prior approaches it evolves and which owner-facing strategies it supersedes.
- This plan explains why prior structural attempts failed: repo-first modeling, activity-as-orientation, missing common rollup unit, broad ready labels, unpinned work, and invisible gaps.
- This plan starts read-only and requires a separate schema migration decision before persistence.
- This plan uses Narrative Harness as a calibration project because that is where the user's disorientation is concrete.
- This plan adds Jess and Fair Labor License as anti-overfitting calibration projects.
- This plan verifies runtime scheduling, not only UI labels.
- This plan defines kill criteria and a manual orientation audit before completion.
- This plan avoids placeholders and avoids treating raw task counts as product meaning.
