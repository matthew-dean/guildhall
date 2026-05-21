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
8. **Keep the machinery optional.** Construction planning should appear when it
   helps the owner understand a large or risky job. It should not become
   cognitive overhead for small tasks, direct fixes, or obvious follow-ups.

## Proportional Visibility

The construction plan should be available detail, not mandatory ceremony.

Guildhall should adapt the visible planning surface to the size and ambiguity of
the work:

| Work Shape | Default Experience | Construction Detail |
| --- | --- | --- |
| Tiny fix | normal task flow | hidden unless requested |
| Single clear feature | task spec + optional parent slice | collapsed summary |
| Feature family | lightweight area/slice grouping | visible in Work and drawer |
| Large product build | full construction plan | Build Map, active tranche, decisions |
| High-risk change | plan/checklist focused on risk | surfaced near affected action |

The owner should be able to ask for the Build Map or plan detail at any time,
but Guildhall should not force them to think about phases, slices, areas,
change orders, and perspective levels when the work does not need them.

Rules:

- no Build Map prompt for simple direct tasks unless the owner asks
- no construction-plan approval step for tiny fixes
- no extra navigation item if a project has no construction plan
- show only the at-a-glance summary when a plan exists but has no active owner
  decision
- collapse construction metadata inside task cards unless it explains "why now"
  or "why blocked"
- let users hide or minimize the construction summary band per project
- preserve direct commands such as "fix this bug" and "run this check"

The product should feel like it has a powerful planning layer behind the work,
not like the user must operate that layer before any work can happen.

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
    ownerGuilds: ["frontend-engineer", "visual-designer"]
  - id: "local-storage"
    name: "Local Storage"
    purpose: "Save and reopen work without network"
    risk: "high"
    ownerGuilds: ["backend-engineer", "test-engineer"]

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
      decision: "Use existing abstractions wherever a fitting primitive exists"
      evidence: "Repo already contains component, token, helper, module, service, schema, route, and test patterns"
      enforcement: "Spec, worker, and reviewer prompts should steer work toward shared primitives first. A one-off helper, class, file, module, button, chip, card, color, spacing rule, border radius, route, schema, or interaction treatment is a defect unless the task explicitly adds or extends a shared primitive."
      repetitionRule: "Two similar ideas should trigger an abstraction decision: reuse or extend an existing primitive, introduce the smallest shared primitive, or intentionally keep duplication because the pattern is not stable yet."

tasks:
  generated:
    - id: "task-app-shell"
      sliceId: "create-write-reopen"
      title: "Build the local project shell"
      status: "proposed"
      assignedRole: "frontend-engineer"
      workerStatus: "queued"

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

## Project Corpus Map

Workers should function like modern coding agents: they receive enough
architecture context to make the first good move, but Guildhall must not dump
the entire repository into every prompt.

This is a distinct 0.7.0 workstream. The existing context builder already
injects focused task memory, likely target files, checkpoints, recent progress,
and decisions. That is useful, but it is not the same thing as understanding
the codebase. Workers also need a durable map of "what already exists here,
what should be reused, and where to read next."

### Product Contract

Guildhall should create and maintain a project-local corpus map that lets
agents answer these questions without broad repo spelunking:

- What kind of project is this?
- What are the major areas/modules/packages?
- What shared primitives, helpers, services, schemas, tests, and conventions
  already exist?
- Which files are canonical entry points vs. leaf implementations?
- Which packages own which behaviors?
- Which existing abstraction should a worker reuse for this task?
- Which nearby files should the worker read if the summary is not enough?
- When is a new abstraction justified?

The corpus map is not a search index that copies every file into memory. It is
an architecture guide with references. It should point agents to the right
files, symbols, commands, and conventions, then let them open the supporting
files they actually need.

### Artifacts

0.7.0 should add durable project memory artifacts:

- `memory/codebase-map.yaml` — current summarized map
- `memory/codebase-map.history.jsonl` — append-only map refresh events
- `memory/codebase-map.stale.json` — optional stale/failed refresh state
- `memory/codebase-map.overrides.yaml` — optional human-authored corrections

The map should be valid structured data, but readable in a text editor. Human
overrides win over generated summaries and should never be overwritten by a
refresh.

Suggested top-level shape:

```yaml
version: 1
generatedAt: "2026-05-21T00:00:00.000Z"
project:
  root: "/path/to/project"
  languages: ["typescript", "svelte"]
  packageManagers: ["pnpm"]
  primaryFrameworks: ["svelte", "vite"]
  summary: "Guildhall is a local multi-agent project orchestration app..."

entrypoints:
  - kind: "cli"
    path: "src/cli.ts"
    summary: "Command dispatch and serve entrypoint."
  - kind: "web-app"
    path: "src/web/main.ts"
    summary: "Browser UI bootstrap."

areas:
  - id: "web-ui"
    title: "Web UI"
    summary: "Svelte project shell, task surfaces, settings, and workspace import."
    owns:
      - "src/web/**"
      - "packages/ui/**"
    canonicalFiles:
      - path: "src/web/lib/Button.svelte"
        symbols: ["Button"]
        summary: "Shared command button component. Use this for toolbar and form actions."
      - path: "packages/ui/src/components/FrameCard.svelte"
        symbols: ["FrameCard"]
        summary: "Shared framed card primitive for grouped content."
    conventions:
      - "Use shared Button variants before adding local button CSS."
      - "Use token variables for radius, color, and spacing."
    tests:
      - "src/web/surfaces/__tests__/*.test.ts"
      - "src/web/surfaces/project/__tests__/*.test.ts"

abstractions:
  - id: "button"
    title: "Command buttons"
    kind: "ui-component"
    canonicalPath: "src/web/lib/Button.svelte"
    useWhen:
      - "A user triggers an action from a toolbar, form, panel, or drawer."
    avoid:
      - "Do not add local button padding, radius, or neutral backgrounds."
    related:
      - "src/web/lib/StatusButton.svelte"
      - "src/web/tokens.css"

verification:
  commands:
    - "pnpm test <focused test file>"
    - "pnpm typecheck"
    - "pnpm build"
```

### What Gets Indexed

The first implementation should index enough to guide implementation, not
enough to recreate the repository.

Required inputs:

- package manifests and workspace definitions
- top-level README and repo-local agent guidance
- docs or memory files that describe architecture/conventions
- source tree shape from tracked and untracked non-ignored files
- exported symbols for TypeScript/JavaScript where cheap to parse
- Svelte/Vue/React component filenames, props, and obvious exports
- test file locations and naming patterns
- scripts and common verification commands
- route files, API handlers, CLI commands, schemas, and persistence modules
- design-system artifacts, UI tokens, and shared component primitives

Optional later inputs:

- dependency graph edges from imports
- TypeScript language-service symbol metadata
- ripgrep-derived symbol references
- recent git history to identify hot/canonical files
- reviewer decisions that mark a pattern canonical or forbidden

Excluded from the map:

- full file contents
- generated files unless they are the only source of truth
- vendored dependencies
- large fixtures and snapshots
- secrets and env files
- raw logs
- transcripts except for short decisions promoted into memory

### Context Budgeting

The context builder should treat the corpus map as a retrieval layer, not a
prompt blob.

Always include:

- project summary
- active task area if known
- likely target files
- matching shared abstractions
- matching conventions
- focused verification commands
- "read next" supporting files

Include only when relevant:

- neighboring area summaries
- design-system primitives for UI work
- persistence/schema conventions for data work
- route/API conventions for endpoint work
- packaging/build conventions for tooling work
- prior reviewer warnings for the same abstraction

Never include by default:

- every area in the project
- every symbol in a package
- full source excerpts
- long generated docs
- full transcripts

Hard budget targets:

- corpus context block: 1,500 to 4,000 characters by default
- max fallback block: 8,000 characters when task scope is genuinely unclear
- each file/abstraction summary: 1 to 4 sentences
- "read next" list: 3 to 8 files

### Relevance Decision Tree

When building context for a worker:

1. If the task names files, routes, components, commands, or packages, use
   those as the primary retrieval anchors.
2. Else if the task belongs to a construction slice, use the slice's area,
   product surface, and generated task metadata.
3. Else if the task domain/guild is clear, map the domain to corpus areas
   such as UI, runtime, CLI, docs, persistence, tests, or release.
4. Else use top-level project summary, entrypoints, and the smallest likely
   area set; instruct the worker to ask a focused map question before editing.
5. For each candidate file, include the nearest canonical abstraction before
   leaf files. Example: `Button.svelte` and tokens before a one-off toolbar
   surface.
6. If two or more similar concepts appear in the task or map, add an
   "abstraction decision" note that asks the worker to reuse, extend, or
   intentionally keep duplication.
7. If no map entry fits, include "no known abstraction found" explicitly so the
   worker knows this is an evidence gap, not permission to invent locally.

### Worker Tools

Agents should not need to parse the whole map manually. Add focused tools:

- `read-codebase-map` — returns the project summary, areas, and entrypoints.
- `query-codebase-map` — accepts text plus optional `area`, `kind`, `paths`,
  and returns ranked map entries.
- `find-existing-abstraction` — asks "what should I reuse for X?" and returns
  canonical files, use/avoid guidance, and supporting files.
- `read-supporting-context` — opens one map-referenced supporting file or a
  small group of companion files with an explicit reason.
- `record-corpus-note` — lets reviewers/coordinators promote a discovered
  convention or correction into map overrides.
- `refresh-codebase-map` — refreshes generated entries after imports, setup,
  or meaningful changes.

Tool responses should be short and structured. A worker asking about button
styling should get "use `src/web/lib/Button.svelte`, `StatusButton.svelte`,
and `src/web/tokens.css`" with one-paragraph rationale, not a pasted file.

### Worker Prompt Contract

Before editing, the worker must be able to name:

- the task's mapped area
- the likely target files
- the shared abstraction or convention it is reusing
- the supporting file it read when the summary was not enough
- whether the work creates a second similar concept

If it cannot name those from injected context, its first action should be a map
query or focused supporting-file read, not a broad `ls`/`rg` sweep and not a
new local implementation.

For implementation handoff, worker self-critique should include:

```text
Corpus fit:
- Area: <mapped area>
- Reused abstraction: <file/symbol or "none found">
- Supporting context read: <file(s)>
- New abstraction decision: <reuse / extend / add shared primitive / keep local because...>
```

### Spec Agent Contract

Specs should stop saying "make a button" or "add a helper" when the repo has a
known primitive. The spec agent should query the corpus map while drafting and
include a "Reuse / Extend" section:

```text
Reuse / Extend:
- Use `src/web/lib/Button.svelte` for command actions.
- Use `src/web/lib/StatusButton.svelte` for outlined state controls with
  count badges.
- Do not add local button padding/radius/color CSS in the surface.
- If the existing variant cannot express the needed state, extend `Button`
  first and consume that variant from the surface.
```

If the map is stale or absent, the spec should say that explicitly and add a
setup task to refresh or seed it before dispatching implementation work that
depends on local conventions.

### Reviewer Contract

Reviewers should inspect both behavior and corpus fit.

Required reviewer questions:

- Did the worker consult the corpus map or relevant injected map slice?
- Did the diff reuse the canonical abstraction named by the map?
- Did the worker invent a local helper/component/style where a shared one
  exists?
- Did the worker add a shared primitive when the task genuinely needed a new
  concept?
- Did repeated concepts become an explicit abstraction decision?
- Did the worker read enough supporting context to avoid guessing?

Review verdicts should use specific language:

- Approve: "Fits corpus map: reused `Button` and tokens."
- Needs revision: "Parallel abstraction: local `.toolbar-btn` duplicates
  `Button` sizing."
- Change order: "Corpus map says provider settings are global, but product
  flow now needs project-scoped provider selection."

### Refresh Strategy

Map refresh should be cheap and incremental.

Refresh triggers:

- project setup/import completes
- package manifests change
- files are added/removed under source roots
- design-system files change
- reviewer records a corpus correction
- user manually asks to refresh

The refresh should:

- preserve human overrides
- mark stale sections instead of deleting uncertain entries immediately
- avoid blocking normal work if indexing fails
- log failures to `codebase-map.history.jsonl`
- surface "map stale" as a quiet warning in agent context and Settings, not as
  a loud blocker unless the task depends on a stale area

### UI Surface

The map should be available without becoming another mandatory dashboard.

Suggested locations:

- Settings -> Advanced -> Codebase map: status, last refresh, refresh action,
  stale areas, and human overrides
- Task drawer -> Context fit: mapped area, reused abstraction, read-next files
- Review drawer -> Corpus fit checklist
- Thread -> only when Guildhall needs the user to decide whether a pattern
  should become canonical

Small projects should not have to think about this. If the map contains only a
few entries, the UI should stay quiet and simply feed the right context to
agents.

### Failure Modes

Avoid these designs:

- dumping all file summaries into every worker prompt
- treating the map as always correct when recent changes contradict it
- making the user curate the map before Guildhall can run
- adding a vector database as the first implementation when structured files
  and targeted search are enough
- letting generated summaries override human corrections
- scoring relevance only by keyword overlap when routes/components/packages
  give stronger anchors
- asking workers to "follow existing patterns" without naming the patterns
  and the files that embody them

### Implementation Cut

For 0.7.0, build the smallest useful version:

- generate `memory/codebase-map.yaml` from manifests, file tree, docs, and
  obvious source symbols
- add a loader/query API with deterministic scoring
- inject a compact corpus slice into `buildContext`
- add worker/spec/reviewer prompt requirements around corpus fit
- add a read-only Settings status panel
- add unit tests for relevance selection and context budgeting

Do not build semantic embeddings, a live language-server daemon, or a rich map
editor in 0.7.0. Those can follow once the structured map proves useful.

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

## Visual Model And Perspective Levels

The construction plan needs more than one view. A user should be able to move
between the whole project, the current structure, the result being built, one
area, one slice, and one task without losing orientation.

Use the house metaphor internally, but translate it into product UI language.
These are perspective levels, not literal map zoom controls. The interface can
use tabs, grouped bands, filters, summary cards, and detail panels. It should
feel like changing lenses or drilling into a section, not like navigating a
canvas.

| Metaphor | Product Perspective | What It Answers | Primary Surface |
| --- | --- | --- | --- |
| Blueprint | Whole-plan perspective | What are we building, in what shape, and why? | Build Map |
| Frame | Structural perspective | What exists now versus later, and what holds it together? | Build Map + Work |
| Rendered house | Usability/readiness perspective | What would be usable if work stopped today? | Timeline + Release |
| Room | Product-area perspective | What belongs to this section, who owns it, and what is its state? | Build Map detail |
| Slice | User-value perspective | What is Guildhall actively trying to make usable? | Work + task drawer |
| Task | Work-unit perspective | What is one agent doing or waiting on? | Task drawer + Thread |

The user should never have to choose between "everything at once" and "one task card."
Every major surface should preserve both context and focus:

- Where am I in the whole plan?
- What is active now?
- What is waiting?
- Who or what is working?
- What needs me?
- What changed?

## Digestibility Rules

0.7 should make planning more legible, not denser.

Rules:

- show a one-screen summary before detailed lists
- use progressive disclosure for dependency details
- group by active tranche before status
- show later work as muted and collapsed by default
- show only the top owner decisions in Needs You
- avoid duplicating the same alert across Thread, Needs You, and Work
- make every dense view answer one primary question
- prefer counts and state chips over paragraphs
- keep "why now?" visible for active work
- keep "why not now?" available for queued/deferred work
- keep construction detail collapsed unless it changes the next action

Status language:

- **Now:** active tranche work that can run or is running
- **Next:** queued work in the active tranche
- **Later:** planned work outside the active tranche
- **Blocked:** cannot move until dependency, owner decision, gate, or provider
  issue is resolved
- **Done:** accepted into the plan's completed state

Do not make users infer these states from task status names alone.

## Build Map Perspective Model

Build Map is the broadest planning surface.

It should support these perspective levels:

### 1. Overview

Shows:

- project promise
- current phase
- active tranche
- at-a-glance counts:
  - `3 active tasks`
  - `2 needs you`
  - `5 queued next`
  - `12 later`
  - `1 blocked`
- phase progress
- top three risks or decisions

Purpose: answer "what is Guildhall building right now?"

### 2. Blueprint

Shows:

- all phases
- all product areas
- all slices
- dependency edges
- active tranche highlight
- deferred/later slices collapsed by phase

Purpose: answer "what is the shape of the whole job?"

### 3. Frame

Shows:

- active phase
- current and next slices
- dependency blockers
- which areas are touched
- which guild roles are expected

Purpose: answer "what is structurally holding this phase together?"

### 4. Rendered State

Shows:

- completed slices
- usable workflows
- unfinished but visible work
- release-readiness effect
- punch-list items

Purpose: answer "what would be livable if we stopped now?"

### 5. Area Detail

Shows one product area:

- purpose
- owner guilds
- slices touching this area
- current tasks
- known risks
- change orders
- verification requirements

Purpose: answer "what is happening in this room?"

### 6. Slice Detail

Shows one vertical slice:

- user value
- acceptance criteria
- task list
- dependencies
- now/next/later breakdown
- assigned workers or expected guild roles
- verification plan
- current blocker or next action

Purpose: answer "what does it take to make this section usable?"

### 7. Task Detail

Deep-links into the existing task drawer.

Purpose: answer "what is this specific worker/reviewer doing?"

## Surface Responsibilities

Each surface should own a different question.

| Surface | Primary Question | Should Show | Should Not Become |
| --- | --- | --- | --- |
| Thread | What is happening and what did Guildhall just need/tell me? | plan events, active work summaries, human prompts, live agent trouble | full roadmap |
| Needs You | What decision or action blocks progress? | owner decisions, approvals, blocked questions, risky change orders | notification dump |
| Work | What is now, next, later, blocked, and done? | active tranche tasks, queued slice work, worker assignments, status movement | raw backlog warehouse |
| Timeline | What changed over time? | tranche selection, task starts/finishes, change orders, decisions, gate outcomes | chat transcript |
| Build Map | What is the shape of the project? | phases, areas, slices, dependencies, active tranche, perspective levels | Gantt chart |
| Task Drawer | What is true about this unit? | parent slice, current worker/reviewer, ACs, evidence, history | project-wide plan |

## Thread Integration

Thread remains the command and narrative surface. It should not carry the full
plan, but it should make plan changes legible.

Thread should show compact cards for:

- construction plan drafted
- active tranche selected
- slice promoted/deferred
- tasks generated from a slice
- change order proposed or accepted
- owner decision requested
- worker blocked on slice dependency

Example cards:

```text
Build Map updated
Guildhall mapped this as 5 areas, 4 phases, and 8 slices.
Now: Create, write, save, reopen.
[Open Build Map]
```

```text
Active tranche
Create, write, save, reopen
3 tasks queued. Frontend Engineer starts with App Shell.
[View slice]
```

```text
Change order
Storage adapter must land before export preview.
Impact: moves Export Preview from Now to Next.
[Review change]
```

Thread should avoid repeating every task state transition. It should narrate
meaningful plan movement and live interruptions.

## Needs You Integration

Needs You should be the narrowest possible owner-action surface.

Show only:

- required owner decisions
- spec/tranche approvals when policy requires them
- change orders that affect product intent, risk, budget, privacy, or release
  promise
- unresolved questions blocking active tranche work
- failed setup/provider/readiness states blocking the active tranche

Each item should include:

- decision title
- affected slice or phase
- recommended option
- why Guildhall cannot safely infer it
- what happens if the owner defers
- primary action
- secondary action to inspect context

Example:

```text
Needs you
Target first release surface?
Affects: First Livable Slice
Recommendation: Desktop app first
Why: local/offline behavior is the trust foundation.
[Approve] [Choose differently] [Inspect slice]
```

Needs You should not include informational plan updates. Those belong in Thread
or Timeline.

## Work Integration

Work should become the day-to-day execution surface for the construction plan.

Default grouping:

1. **Now** — active tranche tasks in progress or ready to start
2. **Next** — queued active-tranche tasks waiting on dependencies or capacity
3. **Blocked** — tasks blocked by decision, dependency, provider, review, or
   gate
4. **Later** — planned slices outside active tranche, collapsed by default
5. **Done** — completed tasks/slices, compact by default

Work cards should show:

- parent slice
- current task status
- assigned worker or expected guild role
- reviewer/gate state when relevant
- dependency count
- "why now" or "why waiting"
- next action if blocked

Worker visibility:

- show active worker agent when running
- show expected guild role before assignment
- show reviewer role during review
- show capacity/slot if concurrency matters
- show "waiting for worker" separately from "blocked"

The Work view should make it obvious when Guildhall is making progress versus
merely accumulating cards.

## Timeline Integration

Timeline should be the chronological audit of meaningful construction movement.

Events to show:

- plan drafted
- active tranche selected
- slice promoted/deferred
- owner decision recorded
- task generated
- worker assigned
- reviewer assigned
- task completed
- gate passed/failed
- change order proposed/accepted/rejected
- punch-list item created/resolved

Timeline should support filters:

- all
- decisions
- active tranche
- change orders
- worker activity
- gates/release

Timeline should not be a transcript. It should be a project history that helps
the owner understand how the plan evolved.

## At-A-Glance Summary Band

The project shell should have a compact construction summary band when a
construction plan exists.

Suggested fields:

- current phase
- active slice/tranche
- now count
- needs you count
- blocked count
- active worker count
- next milestone

Example:

```text
Foundation · Create, write, save, reopen
Now 3 · Needs you 1 · Blocked 0 · Workers 2 · Next: Local persistence proof
```

This summary should link to Build Map and filter Work to the active tranche.

## Overwhelm Prevention

Do not surface every dimension at once.

Defaults:

- Build Map opens in Overview, not full Blueprint
- Work opens to Now/Next, with Later collapsed
- Needs You shows only actionable blockers
- Thread shows significant plan events, not every state mutation
- Timeline defaults to active tranche events
- Task drawer starts at Now or Spec, not full transcript

Density limits:

- no more than three top risks in Overview
- no more than five visible owner decisions before grouping
- no more than seven visible slices before phase grouping collapses
- no more than one primary CTA per card
- never show both a task card and its full transcript in the same default view

The product should feel like it is revealing structure on demand, not dumping
the project database into the user's lap.

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
- route simple bug fixes, chores, or direct manual tasks through full
  construction planning
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
12. Small/direct tasks continue through the lightweight task flow without forcing
    the owner to manage a Build Map.
13. Verification covers typecheck, unit tests, docs build, and at least one
    scenario test for ambitious-product intake.

## Non-Goals

- Do not build a full Jira/Gantt/roadmap suite.
- Do not require every small task to have a construction plan.
- Do not make construction planning visible by default when it adds no
  immediate user value.
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
