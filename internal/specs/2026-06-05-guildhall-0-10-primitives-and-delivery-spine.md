# Guildhall 0.10 Proposal: Primitives and the Delivery Spine

**Status:** Proposed 0.10 product reframe  
**Date:** 2026-06-05  
**Related:** `internal/specs/2026-06-01-guildhall-0-10-state-machines-project-graph.md`, `internal/specs/2026-06-02-guildhall-contract-surfaces-project-graph.md`, `internal/specs/2026-06-03-guildhall-structure-user-facing-feature.md`, `internal/specs/2026-06-05-guildhall-project-contract-governance.md`
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

Project graph and cross-project capability exchange should stay behind the
existing feature flag/internal surface until Guildhall has a proven product path
for projects with separate ownership or external authority boundaries.

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

These capabilities are not deleted, but they are not user-selectable advanced
options today. They remain feature-flagged/internal substrate while the default
product moves to a simpler project-local model.

Why remove them from default UI:

- They ask users to understand Guildhall's internal ontology before they can
  understand what work will happen next.
- They make one-project delivery streams, such as Looma + Knit, feel like
  distributed organization protocol problems.
- They make the app appear more complete than it is for worker context because
  the grand graph can exist while still failing to tell a worker which primitive
  the component depends on.
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

Guildhall derives consumers as the inverse view:

```text
ContextMenu uses MenuItem.
Therefore MenuItem is used by ContextMenu.
```

This inverse view should be derived, not manually maintained. The stored edge is
`usesPrimitives`.

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

Project contracts, contract pressure, schema versioning, and migration
mechanics are governed by
`internal/specs/2026-06-05-guildhall-project-contract-governance.md`. This
proposal defines the project-local delivery model and behavior that spec must
support, but it must not create one-off governance or migration rules for
primitives alone.

Before any primitive, delivery, validation-evidence, or finished-work intake
shape becomes durable state, the implementation must include the Contract Touch
Decision and, when persisted schemas change, the Schema Migration Decision from
that governance spec.

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
  provesPrimitives?: string[]
  proofKind?: 'storybook' | 'interaction' | 'e2e' | 'unit' | 'build' | string
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
  source?: 'user' | 'import' | 'agent_discovery' | 'generated_from_contract'
  evidence?: string[]
}
```

### Derived Views

Guildhall derives:

- primitive consumers from task and primitive `usesPrimitives` references;
- primitive proving tasks from `delivery.provesPrimitives`;
- blocked tasks from unmet task dependencies;
- structurally blocked tasks from unready primitive ancestors;
- "why this next" from driver priority plus dependency traversal;
- worker context from task, package, dependencies, primitives, proof, and
  relevant decisions.

## How The Model Drives Guildhall Behavior

The default model should not only label work. It should drive what Guildhall
does next.

### Context Packets

Every runnable task should receive one context packet built from the shared
runtime summary. The packet should include:

- delivery intent: driver, provider, containing package, and what the task
  supports;
- execution order: direct blockers, recursive blocker chain, and why the
  current task is runnable now;
- primitive context: direct `usesPrimitives`, expanded primitive ancestors,
  invariants, paths, readiness, and known consumers;
- proof context: required proof, existing proof, and any primitives the task
  proves through `delivery.provesPrimitives`;
- correction hooks: the exact driver, provider, primitive, dependency, or proof
  assumption the user can fix if Guildhall inferred wrong.

No surface should assemble a separate local version of this packet. Overview,
Work, Thread, Task Drawer, queue picking, and worker launch should all consume
the same derived summary.

### Universal Agent Contract Strategy

Whenever Guildhall asks an agent for structured project state, the request
should use a contract-first flow:

1. Guildhall defines the expected result schema.
2. Guildhall gives the agent specific instructions for what evidence is allowed
   and what should be rejected.
3. The agent drafts a structured result.
4. The agent must call the matching validation tool before answering.
5. If validation fails, the agent fixes the result and validates again.
6. The agent returns the validator-normalized result, not the draft.
7. Guildhall stores the normalized result, validation outcome, and evidence.
8. Product surfaces render the stored result through shared summary builders.

This should apply to primitive setup, finished-work intake, task splitting, task
linking, proof plans, context packets, release readiness, owner-input
classification, and any future agent-produced structured state.

Contract pattern:

```ts
interface AgentContract<Result> {
  contractId: string
  instructions: string
  resultSchema: unknown
  validationTool: string
  evidencePolicy: string
  applyPolicy: 'auto_apply' | 'owner_review' | 'suggest_only'
}
```

Validation tools should return:

```ts
interface AgentContractValidation<Result> {
  valid: boolean
  normalized?: Result
  errors: ValidationIssue[]
  warnings: ValidationIssue[]
}
```

No agent-produced structured result should become authoritative project state
until the corresponding validator has accepted it or an owner explicitly
overrides the validator failure.

### Review Plan Integration

The existing review plan should treat agent contracts as review gates. Review
should not only inspect code changes; it should inspect the structured project
state the agent produced and the validator evidence that allowed it.

Review inputs:

- normalized contract result;
- validator errors and warnings;
- evidence attached to each accepted object;
- project-state diff before and after applying the result;
- runtime summary diff for next action, blockers, task links, primitive
  readiness, and worker context;
- proof artifacts created or referenced by the result.

Review checks:

- schema result was validated by the named tool before apply;
- warnings were either fixed, explicitly accepted, or routed to owner review;
- no duplicate primitive, task link, proof task, or context field was created;
- no agent-created primitive became `ready` without proof or explicit waiver;
- no UI surface displays a different next action, blocker chain, or primitive
  relationship than the shared summary;
- no feature-flagged cross-project/capability construct leaked into default
  project review.

Review actions should be contract-aware:

- accept normalized result;
- request agent rework with validator errors included;
- split out owner-review questions;
- merge duplicates;
- reject proposed primitives or links;
- attach additional evidence;
- record explicit override with reason.

For Looma + Knit, the review plan must show that ContextMenu's primitive links,
split children, proof tasks, worker context, and queue choice all came from the
same validated state.

### Apply, Reject, And Revert

Validated results still need an explicit apply model. Validation means the
result is well-formed and safe to consider; it does not mean every proposed
change should silently become project state.

Each contract result should produce a reviewable change set with these buckets:

- create primitive;
- update primitive;
- merge primitive;
- reject primitive candidate;
- add task link;
- remove task link;
- create proof task;
- mark observed proof;
- mark missing proof;
- add owner question;
- record waiver or override.

Apply rules:

- `auto_apply` can apply high-confidence, validator-clean changes that do not
  create new owner decisions or unblock downstream work without proof.
- `owner_review` stages the change set until the owner accepts, edits, merges,
  rejects, or waives individual items.
- `suggest_only` records the result as evidence and suggestions, but does not
  mutate project state.

Every applied change should record:

- source contract id;
- normalized result id;
- validator result id;
- evidence references;
- actor;
- timestamp;
- previous value when a value changed;
- owner override reason when relevant.

Revert rules:

- Reverting an applied contract result should remove created primitives, links,
  proof markers, future task suggestions, and owner questions that came only
  from that result.
- Revert should not delete items that were later edited, merged, proven, or
  referenced by other accepted results. Those cases should become owner-review
  conflicts.
- Merge should preserve aliases and evidence so future intake reuses the merged
  primitive instead of recreating the duplicate.
- Reject should keep a lightweight rejection record so agents do not propose the
  same primitive again without new evidence.

This apply/revert model should be shared by primitive setup, finished-work
intake, task splitting, task linking, and proof-plan contracts.

### Context Building Plan Integration

Context building should consume validated structured state in layers. The worker
packet should be deterministic and explainable.

Context build order:

1. Load project snapshot, task graph, primitive registry, driver registry, proof
   records, decisions, and validation evidence.
2. Normalize ids, display keys, paths, and driver/provider references.
3. Expand task hierarchy for delivery package context.
4. Expand `dependsOn` recursively for execution blockers.
5. Expand `usesPrimitives` recursively through primitive ancestors.
6. Resolve `provesPrimitives` into proving tasks and primitive readiness.
7. Select agent persona from work kind, proof kind, primitive kinds,
   driver/provider, and paths.
8. Build the context packet with "why this now", primitive invariants, proof
   obligations, relevant decisions, and correction hooks.
9. Cache the packet with the project summary so Overview, Work, Thread, Task
   Drawer, queue picking, and worker launch render the same facts.

Context builders should fail closed. If primitive registry validation fails, the
task can still be shown, but Guildhall should not use the invalid primitive
state to unblock work or launch an agent.

### Tool Surface Changes

Guildhall should add tools that support contract-first structured state and
remove or demote tools that encourage unvalidated narrative mutations.

New internal/runtime tools:

- `validate_agent_contract(contractId, result)`: generic schema/evidence
  validator for structured agent output.
- `apply_agent_contract_result(contractId, normalizedResult, applyPolicy)`:
  applies a validated result and records evidence.
- `validate_project_primitive_setup(projectId, result)`: specialized primitive
  setup validator.
- `validate_finished_work_intake(projectId, corpusRefs, result)`: validates
  project structure derived from external finished work.
- `build_task_context_packet(projectId, taskId)`: returns the shared worker/UI
  context packet.
- `derive_task_relationships(projectId, taskId)`: returns hierarchy,
  dependencies, supports, primitive-use, and primitive-proof links.
- `derive_queue_candidates(projectId, options)`: returns runnable and blocked
  work using task blockers and primitive-proof blockers.
- `plan_task_split(projectId, taskId)`: returns validated split children and
  links before applying them.

Changed tools:

- task create/update tools accept `delivery.usesPrimitives`,
  `delivery.provesPrimitives`, and `delivery.proofKind`;
- task split tools must return a validated split plan and clear satisfied split
  recommendations after applying children;
- task evidence tools should record contract validation output and primitive
  evidence;
- project summary/readiness tools should read context packets and derived
  relationships rather than recomputing local next-action logic.

Demoted or hidden from default flows:

- direct capability mapping and cross-project authority mutation tools;
- narrative-only "suggest links" tools that do not validate a structured link
  result;
- direct primitive-ready mutations without proof or explicit owner waiver;
- UI-only split actions that create children without validated links.

### MCP Surface Changes

The MCP bridge should expose the same validated, project-local model that the UI
uses. Raw file access is not enough for agents that need to plan safely.

New MCP resources:

- `guildhall://project/drivers`: project driver registry.
- `guildhall://project/primitives`: primitive registry with status, evidence,
  dependencies, consumers, and proving tasks.
- `guildhall://project/task-context/{taskId}`: shared context packet used by
  UI and worker launch.
- `guildhall://project/task-relationships/{taskId}`: hierarchy, blockers,
  supports, primitive-use, and primitive-proof links.
- `guildhall://project/agent-contracts`: available structured contracts,
  schemas, validation tools, and apply policies.
- `guildhall://project/validation-evidence`: validation results and owner
  overrides that affected project state.

New MCP tools:

- `guildhall.validate_agent_contract`
- `guildhall.apply_agent_contract_result`
- `guildhall.validate_project_primitive_setup`
- `guildhall.validate_finished_work_intake`
- `guildhall.apply_finished_work_intake`
- `guildhall.propose_project_primitives`
- `guildhall.apply_project_primitive_setup`
- `guildhall.build_task_context_packet`
- `guildhall.plan_task_split`
- `guildhall.apply_task_split`
- `guildhall.derive_queue_candidates`

Changed MCP tools/resources:

- `guildhall://project/tasks` includes display keys, delivery metadata,
  primitive links, proving links, and derived blocker status.
- `guildhall.append_task_evidence` accepts contract validation evidence and
  primitive evidence references.
- task update tools validate primitive references before persisting them.
- artifact reads can include contract ids so agents know which schema governs
  the requested output.

Removed from default MCP guidance:

- asking agents to inspect raw `.guildhall` files to infer next action when a
  derived resource exists;
- using capability request/project graph resources for ordinary local primitive
  and task dependency work;
- accepting freeform task-link recommendations without a validation pass.

### Agent Persona Selection

Personas should be derived from the task context, not manually assigned as a
parallel taxonomy.

- `workKind: 'primitive'` or `delivery.provesPrimitives` selects a primitive
  hardening persona: preserve invariants, prove reusable behavior, and look for
  downstream consumers before changing APIs.
- `workKind: 'component'` with UI primitives selects a component delivery
  persona: compose existing primitives, avoid style sprawl, and add story/proof
  tasks when missing.
- `workKind: 'story'` or `proofKind: 'storybook'` selects a proof persona:
  demonstrate states and interactions, and verify it exercises the package and
  relevant primitives.
- Security, API, data, runtime, and workflow primitive kinds add domain
  guardrails to the persona, such as auth invariants, schema migration proof, or
  service-start proof.

This keeps personas simple: Guildhall chooses a starting posture from work kind,
proof kind, primitive kinds, driver, provider, and paths. The user should not
need to maintain a persona graph.

### Deterministic Task Splitting

When a task is too broad or a split is recommended, Guildhall should split by
delivery shape and proof obligations:

- keep the parent as the delivery package when the parent represents a feature
  or component deliverable;
- create implementation tasks for the provider path and inherited driver;
- create proof tasks for each required proof kind;
- create primitive-proof tasks only when a used primitive is missing readiness
  proof and cannot be folded into the current implementation;
- inherit `driver`, `provider`, and `supports` from the package;
- copy `usesPrimitives` only when the child consumes those primitives;
- set `provesPrimitives` only on the task whose acceptance proof makes that
  primitive ready.

Splitting should immediately create task links:

- parent-child links for delivery hierarchy;
- `dependsOn` links for execution order;
- `supports` links for why the child exists;
- `usesPrimitives` links for structural context;
- `provesPrimitives` links for primitive readiness.

After splitting, the parent should no longer say "split recommended" unless
there is another explicit, unsatisfied split recommendation.

### Deterministic Linking And Queue Picking

Guildhall should treat task links as operational, not decorative.

- If task A `dependsOn` task B, A is blocked until B is complete.
- If task A uses primitive P and P is not ready, A is structurally blocked.
- If an existing task proves P, Guildhall links A to that proving task through
  `dependsOn`.
- If no proving task exists, Guildhall creates or suggests one based on the
  current approval policy, then links A to it.
- When asked to start queued work, Guildhall recursively walks blockers until
  it finds the first runnable blocker under the active driver.
- If multiple runnable tasks exist, Guildhall ranks by driver priority, shortest
  blocker chain, proof needed to complete a package, then existing queue order.

The UI should show these same links in plain language: `Blocked by`, `Blocks`,
`Supports`, `Uses primitives`, and `Proves primitives`.

### Agent Primitive Discovery And Creation

There are two different creation paths:

- project primitive setup: Guildhall creates a known primitive set for a given
  project from owner input, import data, paths, and project goals;
- finished-work intake: Guildhall derives primitives, delivery packages,
  proof, and links from work that was completed outside Guildhall;
- opportunistic discovery: agents propose new primitives when task execution
  reveals a missing shared structure.

Project primitive setup and finished-work intake are the primary paths.
Opportunistic discovery is a fallback, and it needs tighter guardrails.
Guildhall should not let agents quietly invent a large hidden ontology.

### Project Primitive Setup

When a project is created, imported, or reframed around a driver, Guildhall
should produce a project-local primitive registry before agents start serious
delivery work.

Inputs:

- project target paths, such as `./packages/looma` and `./packages/knit`;
- delivery drivers and providers;
- imported tasks and split recommendations;
- package manifests, route maps, Storybook stories, tests, exports, and public
  APIs when available;
- owner-provided concepts, such as "Looma provides primitives for Knit";
- existing docs or contract surfaces when the feature-flagged/internal project
  graph surface is enabled.

Setup steps:

1. Identify provider areas from driver/provider paths.
2. Scan exported or centralized pieces in those areas:
   - UI components and tokens;
   - API clients and schemas;
   - auth/security guards;
   - runtime supervisors and service helpers;
   - test harnesses and fixture builders;
   - workflow conventions.
3. Group candidates by reusable invariant, not by folder alone.
4. Normalize primitive ids and paths.
5. Create proposed project primitives with kind, provider, paths, invariants,
   required proof, source, and evidence.
6. Link imported tasks to the primitives they use or prove.
7. Create or suggest missing proof tasks for primitives that block active
   delivery.
8. Show the owner a short review surface:
   - keep;
   - rename;
   - merge duplicate;
   - mark not a primitive;
   - add proof expectation.

For Looma + Knit, this setup should produce a small local registry like:

```text
Primitive: MenuItem
Provider: Looma
Paths: ./packages/looma/...
Invariants: renders as button/link, consistent hover/focus/selected treatment,
no default link styling leak
Proof: Storybook states, interaction test

Primitive: Menu
Provider: Looma
Uses primitives: MenuItem, Focus manager
Proof: keyboard/navigation interaction test

Primitive: ContextMenu
Provider: Looma
Uses primitives: Menu
Proof: Storybook/e2e proof for Knit usage
```

The setup output should be project-local. It should not require cross-project
capability mapping, remote authorities, or coordinator-to-coordinator handoffs.

### Finished-Work Intake

Guildhall also needs to learn from work that was finished outside Guildhall:
existing repos, merged PRs, changelogs, tickets, release notes, Storybook
stories, test suites, architecture docs, and owner-provided summaries.

This intake is retrospective. It should not pretend the external work was
planned or executed by Guildhall. Its job is to reconstruct the project-local
delivery model that future Guildhall agents should respect.

Inputs:

- git history, merged PR descriptions, commits, and changed files;
- existing source exports, routes, schemas, components, services, and helpers;
- Storybook stories, e2e tests, unit tests, snapshots, and CI/build scripts;
- changelogs, release notes, ADRs, docs, and issue tracker references;
- owner notes about what shipped and why.

The finished-work intake should derive:

- delivery packages that already exist;
- primitives that the finished work established or relied on;
- primitive dependencies and consumers;
- proof that already exists;
- missing proof that should block future assumptions;
- task links Guildhall should create for future work, without fabricating past
  execution history.

The output should distinguish retrospective truth from future work:

- `alreadyShipped`: delivery package or primitive exists in the codebase;
- `proofObserved`: proof exists and is linked as evidence;
- `proofMissing`: primitive appears to exist, but Guildhall has not found proof;
- `futureTaskSuggested`: Guildhall should create a new task to add proof,
  harden a primitive, or clean up a discovered gap.

Finished-work intake should never mark something ready only because it exists in
code. It needs proof evidence, owner waiver, or a proposed proof task.

#### Finished-Work Intake Contract

When Guildhall asks an agent to derive project structure from external finished
work, it should use a separate structured contract.

Agent instruction:

```text
Given the finished external work corpus, reconstruct the project-local delivery
model Guildhall should use going forward. Do not claim Guildhall executed the
work. Return shipped packages, primitives, proof evidence, missing proof, and
future task suggestions. Validate the result before answering.
```

Required agent output:

```ts
interface FinishedWorkIntakeResult {
  shippedPackages: ShippedPackageProposal[]
  primitives: PrimitiveProposal[]
  taskLinks: PrimitiveTaskLinkProposal[]
  observedProof: ObservedProof[]
  missingProof: MissingProof[]
  futureTasks: FutureTaskSuggestion[]
  rejectedCandidates: RejectedPrimitiveCandidate[]
  questions: PrimitiveSetupQuestion[]
}

interface ShippedPackageProposal {
  id: string
  label: string
  driver?: string
  provider?: string
  paths: string[]
  evidence: PrimitiveEvidence[]
}

interface ObservedProof {
  targetId: string // primitive id or shipped package id
  targetKind: 'primitive' | 'package'
  proofKind: 'storybook' | 'interaction' | 'e2e' | 'unit' | 'build' | 'doc' | string
  evidence: PrimitiveEvidence[]
  confidence: 'high' | 'medium' | 'low'
}

interface MissingProof {
  targetId: string
  targetKind: 'primitive' | 'package'
  expectedProof: string[]
  reason: string
}

interface FutureTaskSuggestion {
  title: string
  reason: string
  workKind: 'primitive' | 'component' | 'story' | 'test' | 'maintenance' | string
  usesPrimitives?: string[]
  provesPrimitives?: string[]
  acceptance: string[]
  evidence: PrimitiveEvidence[]
}
```

Required tool:

```ts
validate_finished_work_intake({
  projectId: string
  corpusRefs: string[]
  result: FinishedWorkIntakeResult
})
```

Accepted finished-work intake should be applied in order:

1. record shipped packages as existing delivery context, not completed
   Guildhall tasks;
2. merge or create primitive registry entries;
3. attach observed proof evidence;
4. mark missing proof as `needs_proof`;
5. create or suggest future tasks only for unresolved gaps;
6. recompute context packets, primitive readiness, and queue order;
7. show an owner review summary that separates "observed external work" from
   "Guildhall should do next."

Validation should reject intake that fabricates tasks as completed by
Guildhall, marks code-only primitives ready without proof, or fails to provide
corpus references for claimed shipped work.

#### Agent Primitive Setup Contract

When Guildhall asks an agent to create primitives for a project, it should ask
for a structured response, not a narrative recommendation.

Agent instruction:

```text
Given the project paths, drivers, imported tasks, and available code/docs,
return the primitive registry entries and task links needed for this project.
Only include primitives with observable invariants and proof expectations.
Prefer reusing existing primitives over creating duplicates.
Return valid JSON matching the requested schema.
```

Required agent output:

```ts
interface ProjectPrimitiveSetupResult {
  primitives: PrimitiveProposal[]
  taskLinks: PrimitiveTaskLinkProposal[]
  proofTasks: PrimitiveProofTaskProposal[]
  rejectedCandidates: RejectedPrimitiveCandidate[]
  questions: PrimitiveSetupQuestion[]
}

interface PrimitiveProposal {
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
  paths: string[] // project-root-relative, `./` prefixed
  dependsOn: string[]
  invariants: string[]
  proof: string[]
  source: 'user' | 'import' | 'agent_discovery' | 'generated_from_contract'
  evidence: PrimitiveEvidence[]
  confidence: 'high' | 'medium' | 'low'
}

interface PrimitiveEvidence {
  kind: 'path' | 'task' | 'test' | 'storybook' | 'doc' | 'owner_input'
  ref: string
  note: string
}

interface PrimitiveTaskLinkProposal {
  taskId: string
  usesPrimitives?: string[]
  provesPrimitives?: string[]
  reason: string
  evidence: PrimitiveEvidence[]
}

interface PrimitiveProofTaskProposal {
  title: string
  primitiveIds: string[]
  proofKind: 'storybook' | 'interaction' | 'e2e' | 'unit' | 'build' | string
  dependsOn?: string[]
  acceptance: string[]
  reason: string
}

interface RejectedPrimitiveCandidate {
  label: string
  reason:
    | 'duplicate'
    | 'one_off'
    | 'folder_without_invariant'
    | 'too_broad'
    | 'insufficient_evidence'
    | string
  evidence?: PrimitiveEvidence[]
}

interface PrimitiveSetupQuestion {
  question: string
  blocksCreationOf?: string[]
  defaultAction: 'skip' | 'propose_low_confidence' | 'merge_with_existing'
}
```

#### Required Validation Tool Call

Agents must validate the setup result before returning it to Guildhall. The
agent may draft internally, but the final answer is invalid unless it has passed
the schema validator.

Required tool:

```ts
validate_project_primitive_setup({
  projectId: string
  result: ProjectPrimitiveSetupResult
})
```

Validation response:

```ts
interface PrimitiveSetupValidationResult {
  valid: boolean
  normalized?: ProjectPrimitiveSetupResult
  errors: Array<{
    path: string
    code:
      | 'missing_required_field'
      | 'invalid_path'
      | 'duplicate_primitive'
      | 'unknown_primitive_reference'
      | 'untestable_invariant'
      | 'proof_without_acceptance'
      | 'insufficient_evidence'
      | 'cycle'
      | string
    message: string
  }>
  warnings: Array<{
    path: string
    code:
      | 'low_confidence'
      | 'broad_candidate'
      | 'missing_optional_proof'
      | 'owner_review_recommended'
      | string
    message: string
  }>
}
```

Agent response rule:

- If `valid: false`, the agent must fix the result and call
  `validate_project_primitive_setup` again.
- The agent may return low-confidence proposals only if validation passes and
  the proposal is marked for owner review.
- The agent's final answer to Guildhall must include the validator-normalized
  result, not the pre-validation draft.
- Guildhall should record the validation result with the task evidence so later
  agents can see why the primitive set was accepted.

Guildhall should reject or downgrade the agent output when:

- a primitive has no `paths`, no owner input, and no linked task evidence;
- an invariant cannot be observed or tested;
- `paths` are not normalized with `./`;
- a proposed primitive duplicates an existing primitive by path, id, or label;
- `usesPrimitives` points at a primitive not present in the registry;
- `provesPrimitives` appears without a matching proof expectation;
- a proof task has no acceptance criteria;
- the result contains only broad categories instead of concrete primitives.

Accepted setup results should be applied in order:

1. merge or create primitive registry entries;
2. add task `usesPrimitives` links;
3. add task `provesPrimitives` links;
4. create or suggest proof tasks;
5. recompute readiness, blockers, context packets, and queue order;
6. show a concise review summary to the owner.

### Opportunistic Primitive Discovery

Agents can propose a primitive when they find a reusable structural rule that
affects more than the current task. Valid discovery signals include:

- repeated imports or composition around the same module, component, API client,
  schema, guard, runtime helper, or test harness;
- acceptance criteria that refer to shared behavior, such as "all menu items"
  or "all authenticated requests";
- failing proof that belongs to a reusable piece rather than only the current
  feature;
- a task that cannot be completed without preserving a shared invariant;
- an explicit owner correction that says a task should use, prove, or depend on
  a primitive.

Agents should not create a primitive when the item is only a one-off feature
detail, a vague domain label, a folder name with no invariant, or a speculative
abstraction that has no proof obligation.

Primitive creation should be a deterministic proposal flow:

1. Search existing primitives by id, label, path, provider, and aliases.
2. If a match exists, link the task with `usesPrimitives` or
   `provesPrimitives` instead of creating a duplicate.
3. If no match exists, create a `proposed` primitive with:
   - normalized id and label;
   - kind;
   - provider;
   - `./`-prefixed paths when known;
   - invariants written as observable rules;
   - required proof;
   - source and evidence references.
4. Attach the primitive to the current task only through explicit metadata:
   `usesPrimitives` for consumption, `provesPrimitives` for readiness proof.
5. If the primitive would block current work, find or create the proving task
   before marking downstream work runnable.
6. Surface the proposal in UI as "New primitive proposed" with accept, edit,
   merge, or dismiss actions.

Some primitives can be auto-created when confidence is high and the blast radius
is small: for example, a split recommendation that explicitly names a missing
primitive and includes a proving task. Cross-cutting security, data, API, and
runtime primitives should default to proposed-until-approved unless the user has
enabled auto-creation for that project.

### Primitive Creation Guardrails

Every agent-created primitive must satisfy these guardrails before it can move
from `proposed` to `ready`:

- it has at least one concrete path, explicit owner-provided rule, or linked
  task as evidence;
- its invariants are testable or inspectable, not abstract slogans;
- its required proof is named before downstream work is unblocked;
- it has no duplicate primitive with the same path, label, or role;
- primitive dependency cycles are rejected or shown as warnings;
- it records whether it was created by user input, import, agent discovery, or
  contract generation;
- it does not replace task dependencies. It can create or suggest task
  dependencies only through proving tasks.

When an agent proposes a primitive during testing, Guildhall should attach the
test failure, screenshot, code path, or browser/API evidence that caused the
proposal. That gives the owner and later workers a reason to trust or reject it.

### Proving Agents Create Primitives Successfully

The feature is not done merely because primitives can be stored. Guildhall has
to prove agents create the right primitives, link them correctly, and avoid
sprawl.

Required validation:

- fixtures where an agent should discover a primitive:
  - Looma + Knit: ContextMenu uses Menu/MenuItem;
  - API: frontend work uses an API client/envelope primitive;
  - security: a feature uses permission and sanitizer primitives;
  - data: a report depends on schema and migration primitives;
  - runtime: service work uses supervisor/stale-server primitives.
- negative fixtures where an agent should not create a primitive:
  - one-off feature copy;
  - folder-only labels with no invariant;
  - duplicate primitive with the same path;
  - broad domain nouns such as "frontend" or "backend" with no proof.
- deterministic tests proving:
  - existing primitive reuse wins over duplicate creation;
  - `usesPrimitives` does not imply readiness;
  - `provesPrimitives` derives readiness only after proof passes or is waived;
  - missing primitive proof creates or suggests a proving task;
  - downstream tasks stay blocked until the proving task completes;
  - split children receive only the primitive metadata they actually need.
- UI/browser proof showing:
  - proposed primitives are visible and editable;
  - task links show `Uses primitives` and `Proves primitives`;
  - queue state changes when a primitive proving task completes;
  - the worker context contains the primitive evidence and invariants.

Guildhall should also keep deterministic regression checks for primitive
creation quality. These are internal test/review checks, not product analytics.
They should warn when a run creates many primitives without proof, creates
duplicate path coverage, or creates primitives that no task uses or proves.

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

Guildhall should avoid internal nouns in the default product experience.

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

### Review Inbox

Review Inbox should own contract result review. It should avoid inventing a new
visual system if existing list, table, drawer, badge, button, checkbox, and
details components can express the flow.

Views:

- Pending contract results;
- Owner questions;
- Proposed primitives;
- Proposed task links;
- Proof gaps;
- Finished-work intake;
- Rejected/merged history.

Each pending result row should show:

- source: primitive setup, finished-work intake, split plan, link plan, proof
  plan, or context packet;
- validator state: valid, valid with warnings, failed;
- apply policy: auto apply, owner review, or suggest only;
- affected objects count;
- blocker impact: whether accepting it unblocks queued work;
- evidence count;
- primary action.

Result detail should group changes into review buckets:

- `Keep`: accept the proposed primitive, link, proof marker, or shipped package;
- `Edit`: change label, kind, paths, invariants, proof, or task link target;
- `Merge`: combine with an existing primitive and keep aliases/evidence;
- `Needs proof`: accept the primitive but keep it blocked until proof exists;
- `Not a primitive`: reject the candidate and store the rejection reason;
- `Future task`: create or suggest follow-up work for missing proof or cleanup;
- `Owner question`: answer, defer, or route the question back into the agent
  contract.

Controls should be ordinary product controls:

- checkboxes for selecting multiple proposed changes;
- segmented filters for result type and validation state;
- icon buttons for merge, reject, revert, and evidence details;
- text inputs for renaming/editing labels and paths;
- inline validation messages when edits break the schema;
- drawer details for evidence, normalized JSON, and project-state diff.

Review Inbox should not show raw schema names first. It should lead with the
plain project effect:

```text
3 primitives proposed from finished work.
2 links will affect the next queued task.
1 proof gap will keep ContextMenu blocked.
```

The task drawer can show local review items for the current task, but bulk
accept/merge/reject belongs in Review Inbox.

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

Feature-flagged/internal settings can expose:

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

Keep project graph as feature-flagged/internal substrate for real cross-project
authority. Do not expose it as the default way to explain local delivery.

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

Keep contract surfaces as feature-flagged/internal or generated context where
useful. In the default model, surface rules become primitive invariants and
proof obligations.

Example:

- Feature-flagged/internal: `contractSurface: looma.component-api`
- Default: `primitive: MenuItem`, invariants, consumers, proof

Primitives are project contracts in the default model. A primitive can be a code
unit, but it can also be a behavior rule, design invariant, schema convention,
runtime convention, proof expectation, or workflow rule. When work pressures a
primitive, Guildhall should use project contract governance to decide whether
the work should comply with the primitive, add proof, update the primitive, walk
parent contracts, or ask the owner.

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
- selected agent persona and the fields that caused that selection;
- direct task dependencies and blockers;
- primitive dependencies used by the task;
- primitive ancestors in dependency order;
- invariants for relevant primitives;
- proof obligations;
- existing proof status;
- primitives this task proves through `delivery.provesPrimitives`;
- known downstream consumers derived from `usesPrimitives`;
- "why this task now" explanation.

Example worker context:

```text
Why this now:
Knit is the primary driver. T-003 Storybook proof is blocked by T-002 Component
implementation. T-002 proves T-001 ContextMenu.

Agent posture:
Component delivery. Compose Looma primitives before adding new UI behavior.

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

- Default project navigation does not show Structure unless the existing
  feature flag is enabled.
- Overview explains the active delivery spine in user-facing language.
- Work separates delivery packages, runnable work, blocked work, and proof.
- Task drawer shows short task keys and local relationships without duplicating
  hierarchy.
- Task model supports driver/provider/supports/usesPrimitives/provesPrimitives.
- Primitive registry supports primitive-to-primitive dependencies.
- Guildhall derives primitive consumers from inverse references.
- Worker context includes selected persona, primitive ancestors, invariants, and
  proof obligations for started tasks.
- Splitting creates hierarchy, dependency, support, primitive-use, and
  primitive-proof links deterministically.
- Queue picking walks task blockers and primitive-proof blockers recursively.
- Agent-produced structured project state is accepted only through a schema
  contract, validation tool call, normalized result, and stored evidence.
- Finished work completed outside Guildhall can be ingested into shipped
  packages, primitives, observed proof, missing proof, and future task
  suggestions without fabricating completed Guildhall tasks.
- Cross-project capability/project graph UI is documented as
  feature-flagged/internal, not a default user option.
- Public docs explain the default model without project graph jargon.

## Implementation Plan

### Task 1: Normalize Driver Paths And Delivery Metadata

Files:

- `src/core/task.ts`
- `src/web/lib/types.ts`
- task creation/update paths in `src/runtime` and `src/tools`
- tests near task queue and workspace import

Steps:

- [ ] Add the Contract Touch Decision required by
  `internal/specs/2026-06-05-guildhall-project-contract-governance.md`.
- [ ] Add a Schema Migration Decision from that same spec when implementation
  persists new primitive, delivery, validation-evidence, or finished-work intake
  shapes.
- [ ] Add `delivery.usesPrimitives?: string[]`,
  `delivery.provesPrimitives?: string[]`, and `delivery.proofKind?: string` to
  core and UI task types.
- [ ] Add a project driver registry type with `paths` normalized as `./`
  project-root-relative paths.
- [ ] Add a helper that normalizes path hints:
  - `packages/looma` -> `./packages/looma`;
  - `./packages/looma` stays unchanged;
  - absolute paths are rejected or converted only when inside the project root.
- [ ] Ensure split children inherit driver/provider/supports and keep
  `usesPrimitives` only when the parent or recommendation supplies it.
- [ ] Ensure proof children set `proofKind` and `provesPrimitives` when their
  acceptance proof makes a primitive ready.
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
- [ ] Derive primitive consumers from tasks and primitives that reference a
  primitive.
- [ ] Derive primitive proving tasks from `delivery.provesPrimitives`.
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

### Task 5: Build Shared Context Packet And Persona Selector

Files:

- shared runtime summary/context builder;
- worker launch path;
- Overview, Work, Thread, and Task Drawer summary consumers;
- context/persona tests.

Steps:

- [ ] Build one derived context packet for each task from driver, provider,
  package, task blockers, primitive context, proof state, and correction hooks.
- [ ] Add a deterministic persona selector using work kind, proof kind,
  primitive kinds, driver, provider, and paths.
- [ ] Ensure worker launch receives the same context packet shown in UI.
- [ ] Ensure Overview, Work, Thread, and Task Drawer render fields from the
  shared packet instead of rebuilding local summaries.
- [ ] Add tests for component delivery, primitive hardening, Storybook proof,
  security primitive, data primitive, and runtime primitive personas.

### Task 6: Add Agent Contract Validation Infrastructure

Files:

- agent contract schema utilities;
- validation tool registry;
- task evidence/apply path;
- contract change-set and revert helpers;
- tests for validator retry and normalized-result application.

Steps:

- [ ] Define a reusable agent contract type with instructions, result schema,
  validation tool, evidence policy, and apply policy.
- [ ] Add a validator result type with normalized output, errors, and warnings.
- [ ] Require structured agent jobs to validate before returning authoritative
  results.
- [ ] Store validation results and evidence with the task or project state
  change.
- [ ] Convert validated results into reviewable change sets with apply, reject,
  merge, and revert operations.
- [ ] Record source contract id, normalized result id, validator id, evidence,
  actor, timestamp, previous values, and override reasons for applied changes.
- [ ] Add tests proving invalid structured output is rejected, valid normalized
  output is applied, owner override is explicit, and revert does not delete
  later-edited or shared state.

### Task 7: Add Finished-Work Intake

Files:

- intake contract schemas;
- corpus reader/summary helpers;
- finished-work apply path;
- intake validation tests.

Steps:

- [ ] Add `FinishedWorkIntakeResult` schema and validator.
- [ ] Add corpus references for commits, PRs, docs, tests, Storybook, source
  paths, and owner notes.
- [ ] Apply shipped packages as existing delivery context, not completed
  Guildhall tasks.
- [ ] Merge derived primitives with the primitive registry.
- [ ] Attach observed proof and mark missing proof as `needs_proof`.
- [ ] Create or suggest future tasks for unresolved gaps.
- [ ] Add tests proving intake does not fabricate completed Guildhall tasks,
  does not mark code-only primitives ready, and does not accept claims without
  corpus evidence.

### Task 8: Wire Contracts Into Review And Context Builders

Files:

- review plan/runtime summary builders;
- Review Inbox surface and detail drawer;
- task context packet builder;
- project summary/readiness model;
- review and context tests.

Steps:

- [ ] Add review inputs for normalized contract results, validator warnings,
  evidence, project-state diffs, runtime summary diffs, and proof artifacts.
- [ ] Add review actions for accept, rework, owner-review questions, merge
  duplicate, reject, attach evidence, and explicit override.
- [ ] Add Review Inbox views for pending contract results, owner questions,
  proposed primitives, proposed links, proof gaps, finished-work intake, and
  rejected/merged history.
- [ ] Add review detail buckets for keep, edit, merge, needs proof, not a
  primitive, future task, and owner question.
- [ ] Use existing list, table, drawer, badge, button, checkbox, segmented
  filter, text input, and inline validation primitives where possible.
- [ ] Build task context packets from validated project state in deterministic
  layer order.
- [ ] Cache context packets with the shared project summary.
- [ ] Ensure invalid primitive or contract state cannot unblock work or launch
  an agent.
- [ ] Add tests proving UI surfaces, queue picking, and worker launch consume
  the same packet.

### Task 9: Update Tool Surface For Contract-First Work

Files:

- task create/update tools;
- task split/apply tools;
- queue/readiness tools;
- tool tests.

Steps:

- [ ] Add generic contract validation/apply helpers.
- [ ] Add project primitive setup validation/apply helpers.
- [ ] Add finished-work intake validation/apply helpers.
- [ ] Extend task create/update with primitive-use, primitive-proof, and proof
  kind validation.
- [ ] Make split tools return and apply validated split plans.
- [ ] Demote narrative-only link/split outputs that lack validation.
- [ ] Add tests for validator failures, owner override, split apply, and
  primitive reference validation.

### Task 10: Update MCP Surface For Derived Project State

Files:

- MCP resources and tools;
- MCP bridge tests;
- docs for MCP resources.

Steps:

- [ ] Add resources for drivers, primitives, task context, task relationships,
  agent contracts, and validation evidence.
- [ ] Add tools for contract validation/apply, primitive setup, task context,
  finished-work intake, split planning/apply, and queue derivation.
- [ ] Extend tasks resource with display keys, delivery metadata, primitive
  links, proving links, and derived blocker status.
- [ ] Extend task evidence tools to accept validation and primitive evidence.
- [ ] Update MCP guidance to prefer derived resources over raw `.guildhall`
  inference.
- [ ] Add MCP smoke tests proving an agent can read context, validate a
  primitive setup result, apply it, and observe updated queue candidates.

### Task 11: Make Splitting And Linking Operational

Files:

- task split planner;
- task creation/update tools;
- task relationship summary builder;
- queue picker tests.

Steps:

- [ ] Split delivery packages into implementation, proof, and primitive-proof
  children based on the task recommendation and primitive readiness.
- [ ] Create parent-child links for hierarchy and `dependsOn` links for
  execution order during the split.
- [ ] Create `supports`, `usesPrimitives`, and `provesPrimitives` metadata on
  the correct children during the split.
- [ ] Clear stale "split recommended" presentation once the recommendation has
  produced linked children.
- [ ] Teach queue picking to recurse through task blockers and primitive-proof
  blockers under the active driver.
- [ ] Add tests proving a ContextMenu package splits into component,
  Storybook/e2e proof, and MenuItem proof work when needed.

### Task 12: Rework Overview Around Delivery Spine

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

### Task 13: Rework Work Around Shape, Order, And Proof

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

### Task 14: Rework Task Drawer Communication

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

### Task 15: Rework Thread "Why This Next?"

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

### Task 16: Hide And Reframe Feature-Flagged Structure

Files:

- `src/web/lib/feature-flags.ts`
- `src/web/surfaces/ProjectView.svelte`
- Structure page tests.

Steps:

- [ ] Keep Structure hidden by default behind the existing feature flag.
- [ ] Rename or document it internally as feature-flagged project
  graph/capability substrate.
- [ ] If enabled, copy should clearly say it is for multi-project ownership and
  handoffs, not normal local dependency work.
- [ ] Add tests that default nav hides Structure and the feature flag shows it.

### Task 17: Documentation

Files:

- public docs under `docs/` for default model;
- internal docs/specs for feature-flagged project graph;
- help topics if relevant.

Steps:

- [ ] Public docs: add "How Guildhall chooses work" using Needs -> Packages ->
  Tasks -> Dependencies -> Primitives -> Proof.
- [ ] Public docs: add "Primitives" explanation with UI, API, security, data,
  runtime, test, and workflow examples.
- [ ] Public docs: explain `./` project-relative path hints.
- [ ] Internal docs: mark project graph/capability exchange as
  feature-flagged/internal.
- [ ] Remove or rewrite public copy that implies users need to understand
  project graph, capability mapping, authority roots, or contract surfaces for
  ordinary use.

### Task 18: Migration And Compatibility

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

### Task 19: End-To-End Proof

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
- Should feature-flagged/internal contract surfaces generate primitives
  automatically for the default UI?

## Decision Recommendation

Adopt "Primitives" as the default structural concept.

Keep project graph, capability exchange, authority roots, and contract surfaces
as feature-flagged/internal concepts. They may remain valuable for real
cross-project authority, but they should not be the default way Guildhall
explains local software structure.

Ship the reframe incrementally:

1. hide Structure behind the existing feature flag;
2. add driver/provider/supports/short task keys;
3. add primitive registry and primitive dependency expansion;
4. update Overview/Work/Drawer/Thread communication;
5. update docs and worker context;
6. only then decide whether project graph should ever become a user-visible
   option again.
