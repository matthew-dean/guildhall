# Guildhall 0.10 Proposal: Primitives and the Delivery Spine

**Status:** Proposed 0.10 product reframe  
**Date:** 2026-06-05  
**Related:** `internal/specs/2026-06-01-guildhall-0-10-state-machines-project-graph.md`, `internal/specs/2026-06-02-guildhall-contract-surfaces-project-graph.md`, `internal/specs/2026-06-03-guildhall-structure-user-facing-feature.md`  
**Scope:** Default user-facing task structure, worker context, task graph, primitive graph, navigation, docs, and tests  

## Thesis

Guildhall's default dependency model currently feels both too heavy and too
incomplete.

It is too heavy because the normal product experience exposes concepts such as
project graph, capability mapping, provider/consumer authority, contract
surfaces, and coordinator-to-coordinator handoffs before most users need them.
Those concepts can be real and tested while still being wrong for the default
mental model.

It is incomplete because workers still miss the structural context that matters
inside ordinary software projects. For example, a worker can be asked to build
`ContextMenu` without being forced to reason through `Menu`, `MenuItem`, focus
behavior, link/button rendering, visual states, Storybook proof, and how those
pieces support a Knit product need.

The default 0.10 model should become:

```text
Needs -> Delivery packages -> Tasks -> Dependencies -> Primitives -> Proof
```

Project graph and cross-project capability exchange should move behind an
advanced flag until a project truly has separate projects, separate ownership,
or external authority boundaries.

## What Changes

### Remove From The Default Experience

These concepts should not appear in ordinary navigation or owner-facing copy by
default:

- Structure tab as a top-level project surface.
- Capability mapping as the primary way to explain reusable work.
- Provider/consumer project authority as default language.
- Coordinator-to-coordinator handoff protocol as default language.
- Local project index and authority roots as default UI sections.
- Contract-surface jargon in normal task and overview surfaces.
- Design-system-specific framing as the general way to describe shared
  foundations.

These capabilities are not deleted. They become advanced mode material, enabled
only when the user or project needs true multi-project ownership, external
authority, or explicit cross-project delivery receipts.

Why remove them from default UI:

- They ask users to understand Guildhall's internal ontology before they can
  understand what work will happen next.
- They make one-project delivery streams, such as Looma + Knit, feel like
  distributed organization protocol problems.
- They make the app appear more complete than it is for worker context because
  the grand graph can exist while still failing to tell a worker which primitive
  governs the component being built.
- They blur the difference between implementation geography, product demand,
  ownership, and proof.

### Add To The Default Experience

Default projects get five plain concepts.

#### 1. Drivers

A driver is the source of product demand. It answers: "Whose need decides what
matters first?"

Drivers are not primarily folders. Folders are implementation geography. A
driver can have path hints, but its identity is demand.

Example:

```ts
deliveryDrivers: [
  {
    id: 'knit',
    label: 'Knit',
    role: 'primary',
    kind: 'product_surface',
    paths: ['./apps/knit'],
    domains: ['app', 'editor', 'ux'],
  },
  {
    id: 'looma',
    label: 'Looma',
    role: 'provider',
    kind: 'library',
    paths: ['./packages/looma'],
    domains: ['components', 'design-system'],
  },
]
```

Path hints must be project-root-relative and explicitly local, using `./`:

- good: `./packages/looma`
- avoid: `packages/looma`
- avoid: package-name-looking strings when the value is actually a path

Roles should stay small:

- `primary`: the main demand source for ordering work.
- `secondary`: important demand source that can raise priority but does not
  outrank primary by default.
- `provider`: the implementation supplier or reusable surface owner.
- `proof`: a verification or demonstration surface.
- `maintenance`: internal health, cleanup, or system quality.

Do not expose "tertiary" as user-facing vocabulary. It is a ranking ladder, not
a concept an agent or owner can reliably apply.

#### 2. Delivery Packages

A delivery package is the user-facing shape of work. It answers: "What are we
delivering?"

Delivery packages use task hierarchy:

- parent task: containing delivery package;
- child tasks: deliverable slices such as implementation, story, docs, tests,
  or verification;
- breadcrumbs: project, containing package, current task;
- child rollups: what remains inside the package.

Hierarchy is not execution order. It is delivery shape.

#### 3. Task Dependencies

Task dependencies are execution order. They answer: "What must be done before
this task can run?"

Task dependencies remain task ids:

```ts
task.dependsOn = ['task-menu-implementation']
```

If a queued task has unmet dependencies, it is blocked. If Guildhall is asked to
start it, Guildhall walks blockers recursively until it finds the first runnable
blocker.

#### 4. Primitives

A primitive is a foundational project piece that downstream work uses or must
respect.

Primitive is intentionally broader than design system. Design tokens and UI
atoms are primitives, but so are auth guards, API clients, data schemas,
permission policies, event buses, shared test harnesses, and runtime
conventions.

Example:

```ts
primitive: {
  id: 'menu-item',
  label: 'MenuItem',
  kind: 'ui_primitive',
  provider: 'looma',
  paths: ['./packages/looma/src/menu'],
  dependsOn: ['focus-manager', 'interactive-reset'],
  invariants: [
    'Can render as button or link.',
    'No default browser link styling leaks through.',
    'Hover, focus, and selected states are consistent.',
  ],
  proof: ['storybook', 'interaction-test'],
}
```

Primitives can depend on other primitives:

```text
interactive-reset -> focus-manager -> menu-item -> menu -> context-menu
```

This is a primitive graph, not a task graph. It describes structural context,
not execution work by itself.

Tasks can use primitives:

```ts
task.delivery = {
  driver: 'knit',
  provider: 'looma',
  usesPrimitives: ['menu', 'menu-item'],
  supports: ['task-knit-context-actions'],
}
```

Guildhall derives "governs" as the inverse view:

```text
ContextMenu uses MenuItem.
Therefore MenuItem governs ContextMenu.
```

`governs` should not be the primary manually maintained edge.

#### 5. Proof

Proof is how Guildhall knows the delivery is real.

Proof can be:

- Storybook stories;
- interaction tests;
- e2e tests;
- command gates;
- screenshots;
- contract tests;
- schema migration tests;
- API request/response checks;
- security regression checks;
- docs or release verification where appropriate.

Proof should attach to tasks and primitives. A primitive is "ready" only when
its required proof has been satisfied or explicitly waived.

## The Simple Data Shape

### Project Driver Registry

```ts
interface DeliveryDriver {
  id: string
  label: string
  role: 'primary' | 'secondary' | 'provider' | 'proof' | 'maintenance'
  kind?: string
  paths?: string[] // project-root-relative, `./` prefixed
  domains?: string[]
  description?: string
}
```

### Task Delivery Metadata

```ts
interface TaskDelivery {
  driver?: string
  provider?: string
  supports?: string[]
  usesPrimitives?: string[]
}
```

### Primitive Registry

```ts
interface Primitive {
  id: string
  label: string
  kind:
    | 'ui_primitive'
    | 'design_token'
    | 'api_primitive'
    | 'security_primitive'
    | 'data_primitive'
    | 'runtime_primitive'
    | 'test_primitive'
    | 'workflow_primitive'
    | string
  provider?: string
  paths?: string[] // project-root-relative, `./` prefixed
  dependsOn?: string[]
  invariants?: string[]
  proof?: string[]
  status?: 'unknown' | 'proposed' | 'ready' | 'needs_proof' | 'deprecated'
}
```

### Derived Views

Guildhall derives:

- primitive `governs` from task and primitive `usesPrimitives` references;
- blocked tasks from unmet task dependencies;
- structurally blocked tasks from unready primitive ancestors;
- "why this next" from driver priority plus dependency traversal;
- worker context from task, package, dependencies, primitives, proof, and
  relevant decisions.

## How This Simplifies The User Experience

### Before

A user sees Structure, capability assignment, contract surfaces, authority
roots, local projects, and handoff terminology. They still cannot tell why
Storybook is blocked, whether ContextMenu should use Menu, or whether MenuItem
was ever proven.

### After

A user sees:

```text
Knit needs ContextMenu.
ContextMenu is package T-001.
T-003 Storybook proof is blocked by T-002 Component implementation.
T-002 uses primitives: Menu, MenuItem, Overlay.
MenuItem still needs proof.
Guildhall will work on the first runnable blocker.
```

This is simpler because each concept answers one question:

- Driver: why this matters.
- Provider: where the implementation lives.
- Hierarchy: what delivery package this is part of.
- Dependencies: what runs first.
- Primitives: what foundational pieces constrain the work.
- Proof: how we know it is done.

## How Guildhall Communicates It

Guildhall should avoid internal nouns unless the user opens advanced mode.

### Overview

Overview should become the project command center.

It should show:

- primary driver;
- active delivery package;
- next runnable work;
- blocked chain;
- primitives that explain the current structural dependency;
- proof status;
- owner action if any.

Example copy:

> Knit is driving the current delivery. Guildhall will work on Component
> implementation because it unblocks Storybook proof for ContextMenu.

### Work

Work should own execution.

It should show:

- queued runnable tasks;
- blocked tasks;
- delivery packages;
- proof tasks;
- dependency chain;
- primitive-readiness blockers when relevant.

Work should make the distinction visible:

- Package: "ContextMenu"
- Execution: "Component implementation before Storybook proof"
- Primitive context: "Uses Menu and MenuItem"

### Task Drawer

Task drawer should explain one task's local graph.

Header breadcrumb:

```text
Looma + Knit / T-001 / T-003
```

Overview chips/rows:

- Driven by Knit;
- Provided by Looma;
- Kind: Story;
- Uses primitives: Menu, MenuItem;
- Blocked by: Component implementation;
- Supports: Context actions;
- Proof: Storybook.

Task links should show relationships, not duplicate hierarchy:

- Blocked by;
- Blocks;
- Uses primitives;
- Supports;
- Nested work when this is a delivery package.

### Thread

Thread should include a compact "Why this next?" explanation before starts,
approvals, or blocked decisions.

Example:

> Guildhall will start T-002 Component implementation because T-003 Storybook
> proof depends on it, and Storybook proof is required for T-001 ContextMenu,
> which serves Knit.

### Settings

Settings should own driver and primitive configuration.

Default settings should be simple:

- Primary driver;
- Providers;
- Primitive registry;
- path hints.

Advanced settings can expose:

- project graph;
- cross-project handoffs;
- capability assignment;
- external authority references.

## Project Shapes This Supports

### Looma + Knit UI Library And App

Drivers:

- primary: Knit app;
- provider: Looma component library;
- proof: Storybook.

Primitives:

- MenuItem;
- Menu;
- Overlay;
- Focus manager;
- design tokens.

Flow:

```text
Knit need -> ContextMenu package -> Component task -> Menu/MenuItem primitives -> Storybook/e2e proof
```

### SaaS App With API Client Layer

Drivers:

- primary: Admin dashboard;
- provider: API client package;
- secondary: public API contract.

Primitives:

- fetch wrapper;
- auth token refresh;
- error envelope;
- pagination model;
- query cache helper.

Flow:

```text
Dashboard feature -> frontend task uses api-client primitive -> API task proves envelope and auth behavior
```

### Security-Critical Product

Drivers:

- primary: customer workflow;
- provider: security policy layer;
- secondary: compliance.

Primitives:

- permission policy;
- auth guard;
- sanitizer;
- audit-log writer;
- secrets boundary.

Flow:

```text
Feature task -> uses permission primitive -> blocked until sanitizer and audit-log primitives are proven
```

### Data-Heavy Backend

Drivers:

- primary: reporting workflow;
- provider: data model;
- proof: migration/test harness.

Primitives:

- schema convention;
- repository layer;
- migration runner;
- fixture factory;
- transaction boundary.

Flow:

```text
Report feature -> depends on schema primitive -> migration proof -> repository task -> API endpoint
```

### Event-Driven System

Drivers:

- primary: workflow automation;
- provider: event bus/runtime;
- proof: replay tests.

Primitives:

- event envelope;
- idempotency key;
- retry policy;
- dead-letter handling;
- event replay harness.

Flow:

```text
Automation feature -> uses event envelope and retry primitives -> proof runs replay and idempotency tests
```

### CLI Or Developer Tool

Drivers:

- primary: user command workflow;
- provider: command framework;
- maintenance: help/docs quality.

Primitives:

- command parser;
- config loader;
- terminal output style;
- file write safety helper;
- fixture harness.

Flow:

```text
New command -> uses parser/config primitives -> proof covers help text, dry run, and file write safety
```

### Narrative Or Content Tool

Drivers:

- primary: writer workflow;
- provider: story-analysis engine;
- secondary: source/context truth.

Primitives:

- source citation model;
- continuity lens;
- voice/style guardrail;
- scene state model;
- evaluation harness.

Flow:

```text
Writing feature -> uses continuity and source primitives -> proof includes source-backed answer and regression eval
```

### Infrastructure Or Runtime Project

Drivers:

- primary: project runtime reliability;
- provider: supervisor/runtime;
- maintenance: install/start health.

Primitives:

- process supervisor;
- stale-server detector;
- port allocation;
- log reader;
- restart protocol.

Flow:

```text
Runtime feature -> uses supervisor primitive -> proof starts service, checks stale:false, and verifies browser route
```

## Relationship To Existing 0.10 Work

### Project Graph

Keep project graph as an advanced substrate for real cross-project authority.
Do not expose it as the default way to explain local delivery.

Use it when:

- another project owns the provider;
- consumer verification needs a receipt;
- a delivery moves across repos or project authorities;
- external tools such as Jira, Linear, or GitHub become authoritative nodes.

Do not use it when:

- one project contains both app and library work;
- the relationship is simply "this component uses that primitive";
- the user only needs to understand what Guildhall will do next.

### Contract Surfaces

Keep contract surfaces as advanced or generated context where useful. In the
default model, surface rules become primitive invariants and proof obligations.

Example:

- Advanced: `contractSurface: looma.component-api`
- Default: `primitive: MenuItem`, invariants, consumers, proof

### Coordinators

Coordinators should remain routing/adjudication helpers, not the source of
truth for driver identity.

Do not make "primary driver" equal "primary coordinator." A coordinator may own
a domain or driver, but the driver answers demand, while the coordinator
answers who adjudicates decisions.

### Design System

Design system is one primitive family, not the generalized concept. Guildhall
should avoid making design-system wording carry security, API, data, runtime,
or workflow structure.

## Worker Context Contract

When Guildhall starts a task, the worker context should include:

- current task and short display key;
- containing delivery package;
- primary driver and provider;
- direct task dependencies and blockers;
- primitive dependencies used by the task;
- primitive ancestors in dependency order;
- invariants for relevant primitives;
- proof obligations;
- existing proof status;
- known downstream consumers derived from `usesPrimitives`;
- "why this task now" explanation.

Example worker context:

```text
Why this now:
Knit is the primary driver. T-003 Storybook proof is blocked by T-002 Component
implementation. T-002 proves T-001 ContextMenu.

Primitive context:
ContextMenu uses Menu and MenuItem. MenuItem depends on Focus manager and
Interactive reset. Preserve these invariants:
- MenuItem can render as button or link.
- No default browser link styling leaks through.
- Hover, focus, and selected states are consistent.

Proof:
Add Storybook coverage and e2e interaction proof before marking the package
complete.
```

## Acceptance Criteria

- Default project navigation does not show Structure unless advanced mode is
  enabled.
- Overview explains the active delivery spine in user-facing language.
- Work separates delivery packages, runnable work, blocked work, and proof.
- Task drawer shows short task keys and local relationships without duplicating
  hierarchy.
- Task model supports driver/provider/supports/usesPrimitives.
- Primitive registry supports primitive-to-primitive dependencies.
- Guildhall derives primitive `governs` from inverse references.
- Worker context includes primitive ancestors and invariants for started tasks.
- Cross-project capability/project graph UI is documented as advanced mode.
- Public docs explain the default model without project graph jargon.

## Implementation Plan

### Task 1: Normalize Driver Paths And Delivery Metadata

Files:

- `src/core/task.ts`
- `src/web/lib/types.ts`
- task creation/update paths in `src/runtime` and `src/tools`
- tests near task queue and workspace import

Steps:

- [ ] Add `delivery.usesPrimitives?: string[]` to core and UI task types.
- [ ] Add a project driver registry type with `paths` normalized as `./`
  project-root-relative paths.
- [ ] Add a helper that normalizes path hints:
  - `packages/looma` -> `./packages/looma`;
  - `./packages/looma` stays unchanged;
  - absolute paths are rejected or converted only when inside the project root.
- [ ] Ensure split children inherit driver/provider/supports and keep
  `usesPrimitives` only when the parent or recommendation supplies it.
- [ ] Add tests for path normalization and split inheritance.

### Task 2: Add Primitive Registry Model

Files:

- new runtime primitive model module;
- project state migration or optional persisted project config;
- UI types.

Steps:

- [ ] Define `Primitive` with id, label, kind, provider, paths, dependsOn,
  invariants, proof, and status.
- [ ] Add parser/normalizer for primitive ids and primitive dependencies.
- [ ] Validate primitive dependency cycles and surface a clear warning instead
  of crashing.
- [ ] Add tests for primitive-to-primitive dependency ordering.

### Task 3: Derive Primitive Context

Files:

- new `src/runtime/primitives-context.ts`;
- runtime tests.

Steps:

- [ ] Given a task and primitive registry, expand `usesPrimitives` into the
  full primitive ancestor chain.
- [ ] Derive `governs` from tasks and primitives that reference a primitive.
- [ ] Return primitive readiness:
  - ready;
  - needs proof;
  - missing;
  - cycle warning.
- [ ] Add tests for:
  - ContextMenu uses Menu;
  - Menu depends on MenuItem;
  - MenuItem depends on Focus manager;
  - Guildhall returns the chain in dependency order.

### Task 4: Bridge Primitive Readiness To Task Blocking

Files:

- runtime queue picker/readiness helpers;
- task readiness tests.

Steps:

- [ ] If a task uses a primitive that is missing or not ready, mark it
  structurally blocked in presentation.
- [ ] Do not mutate `task.dependsOn` unless Guildhall creates or finds a task
  that proves the primitive.
- [ ] Add deterministic bridge behavior:
  - find existing proving task for primitive;
  - create suggested primitive-proof task only when no task exists and the
    missing primitive cannot be folded into the current task;
  - block downstream task on that proving task.
- [ ] Add tests for recursive primitive readiness and recursive task blocker
  traversal.

### Task 5: Rework Overview Around Delivery Spine

Files:

- `src/web/surfaces/project/ProjectOverviewTab.svelte`
- shared project action/summary model if needed
- overview tests.

Steps:

- [ ] Add a compact "Delivery spine" section.
- [ ] Show primary driver, active package, next runnable work, blocked chain,
  relevant primitives, and proof state.
- [ ] Remove or demote old Structure/capability language from Overview.
- [ ] Ensure the Overview "Do this next" explanation and Work queue use the
  same shared runtime summary.
- [ ] Add tests for a Looma + Knit fixture:
  - Knit driver;
  - ContextMenu package;
  - Storybook blocked by Component implementation;
  - Menu/MenuItem primitives listed as context.

### Task 6: Rework Work Around Shape, Order, And Proof

Files:

- `src/web/surfaces/project/WorkTab.svelte`
- `src/web/surfaces/project/WorkTreePreview.svelte`
- related tests.

Steps:

- [ ] Keep hierarchy as delivery shape.
- [ ] Keep dependencies as execution order.
- [ ] Add primitive context to blocked and task detail rows when relevant.
- [ ] Add proof grouping or proof labels for story/test/gate work.
- [ ] Ensure blocked filters include task blockers and structural primitive
  blockers.
- [ ] Add tests for queued vs blocked vs proof tasks.

### Task 7: Rework Task Drawer Communication

Files:

- `src/web/surfaces/TaskDrawer.svelte`
- `src/web/surfaces/drawer/OverviewTab.svelte`
- drawer tests.

Steps:

- [ ] Keep breadcrumb as project/package/current task with short keys.
- [ ] Add driver/provider/work kind/supports chips or rows.
- [ ] Add `Uses primitives` section.
- [ ] Add primitive proof/readiness summary.
- [ ] Keep `Blocked by` and `Blocks` as task relationships.
- [ ] Do not restore a separate "Parent path" section.

### Task 8: Rework Thread "Why This Next?"

Files:

- `src/web/surfaces/project/ThreadTab.svelte`
- thread tests.

Steps:

- [ ] Add compact "Why this next?" explanation to start/approval/blocker
  surfaces.
- [ ] Explain driver, blocker traversal, delivery package, and primitive
  context in one or two sentences.
- [ ] Include a correction path when Guildhall inferred the wrong driver,
  provider, primitive, or proof expectation.
- [ ] Add tests for the explanation text and correction action.

### Task 9: Hide And Reframe Advanced Structure

Files:

- `src/web/lib/feature-flags.ts`
- `src/web/surfaces/ProjectView.svelte`
- Structure page tests.

Steps:

- [ ] Keep advanced Structure hidden by default.
- [ ] Rename or document it internally as advanced project graph/capability
  mode.
- [ ] If enabled, copy should clearly say it is for multi-project ownership and
  handoffs, not normal local dependency work.
- [ ] Add tests that default nav hides Structure and advanced flag shows it.

### Task 10: Documentation

Files:

- public docs under `docs/` for default model;
- internal docs/specs for advanced graph;
- help topics if relevant.

Steps:

- [ ] Public docs: add "How Guildhall chooses work" using Needs -> Packages ->
  Tasks -> Dependencies -> Primitives -> Proof.
- [ ] Public docs: add "Primitives" explanation with UI, API, security, data,
  runtime, test, and workflow examples.
- [ ] Public docs: explain `./` project-relative path hints.
- [ ] Internal docs: mark project graph/capability exchange as advanced.
- [ ] Remove or rewrite public copy that implies users need to understand
  project graph, capability mapping, authority roots, or contract surfaces for
  ordinary use.

### Task 11: Migration And Compatibility

Files:

- migration module if persisted data changes;
- project config/task queue readers;
- tests.

Steps:

- [ ] Existing tasks without delivery metadata continue to load.
- [ ] Existing Structure/project-graph records remain untouched.
- [ ] Existing contract surfaces can be adapted into primitive invariants when
  shown in default mode, but are not deleted.
- [ ] Add migration warnings only when data cannot be interpreted safely.

### Task 12: End-To-End Proof

Validation projects:

- Looma + Knit;
- a backend/API fixture;
- a security/auth fixture;
- a data/migration fixture;
- a runtime/service fixture.

Steps:

- [ ] For Looma + Knit, prove:
  - Knit primary driver;
  - Looma provider;
  - ContextMenu delivery package;
  - Component implementation blocks Storybook proof;
  - Menu/MenuItem primitives appear in worker context.
- [ ] For each fixture, prove Overview, Work, Task Drawer, and Thread explain
  why Guildhall chooses the next task.
- [ ] Run focused Vitest suites, `pnpm typecheck`, `pnpm build`, and browser
  proof against a non-stale local server.

## Open Questions

- Should primitive readiness be manually set, derived only from proof, or both?
- Should `usesPrimitives` live under `delivery`, or should tasks have a
  top-level `primitives` field?
- Should primitive proof tasks be created automatically or only suggested until
  the user approves a new primitive?
- How much primitive inference should come from paths and imports versus
  explicit task/spec metadata?
- Should advanced contract surfaces generate primitives automatically for the
  default UI?

## Decision Recommendation

Adopt "Primitives" as the default structural concept.

Keep project graph, capability exchange, authority roots, and contract surfaces
as advanced concepts. They remain valuable for real cross-project authority, but
they should not be the default way Guildhall explains local software structure.

Ship the reframe incrementally:

1. hide advanced Structure by default;
2. add driver/provider/supports/short task keys;
3. add primitive registry and primitive dependency expansion;
4. update Overview/Work/Drawer/Thread communication;
5. update docs and worker context;
6. only then revisit whether advanced project graph should return to the main
   navigation for any class of users.
