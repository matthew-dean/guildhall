# Guildhall Contract Surfaces and Surface Review Packets

**Status:** proposed follow-on spec for the 0.10 project graph line
**Date:** 2026-06-02
**Related:** `internal/specs/2026-06-01-guildhall-0-10-state-machines-project-graph.md`

## Goal

Add contract surfaces to Guildhall's authority-aware project graph so
individual specs can reason about, consume, and update the shared contracts
they touch.

The first product behavior is a surface review packet during spec approval. A
spec that changes a component library, API, schema, state machine, MCP tool,
design system, or domain capability should not be reviewed in isolation. It
should be reviewed against the central contract for that surface: sibling specs,
existing invariants, known decisions, changed rules, affected consumers, and
proof obligations.

This should be a project graph extension, not a separate "spec graph" subsystem.

## Product Thesis

Developers do not design a component library one component at a time. They
reason about the whole surface: prop names, composition rules, slot-versus-prop
choices, variant vocabulary, event naming, accessibility guarantees, migration
rules, and proof expectations.

The same is true for APIs, event contracts, state-machine lifecycles, MCP
resources, design tokens, and domain capabilities. Individual endpoint or task
specs matter, but the durable quality comes from the shared contract that makes
the individual pieces feel coherent.

Guildhall already has the right substrate:

- a structured spec flow for individual work;
- structural analysis for packages, domains, executable units, and authority
  roots;
- a local-first project graph that can model domain authority and
  provider/consumer edges;
- a deterministic state-machine primitive with receipts;
- design-system governance that treats tokens and component variants as
  contracts instead of taste.

Contract surfaces connect those pieces. Specs become contract deltas. The
project graph records where the contract lives, who owns it, who consumes it,
and what receipts prove that a proposed delta was accepted.

## Prior Art To Synthesize

Guildhall should synthesize useful prior art without copying any one method
wholesale.

- Strategic DDD bounded contexts and context maps are useful because they treat
  language, model meaning, and ownership boundaries as first-class. Context
  Mapper's bounded-context docs show contexts connected through maps rather than
  flattened into one global model:
  <https://contextmapper.org/docs/bounded-context/>.
- Requirements traceability is useful because it links requirements forward to
  design, implementation, tests, and verification. Guildhall should treat a
  surface rule as traceable to the specs, decisions, code, tests, and receipts
  that changed it. A practical traceability guide frames this as connecting
  requirements to design decisions and acceptance tests:
  <https://www.hhs.gov/sites/default/files/ocio/eplc/EPLC%20Archive%20Documents/24%20-%20Requirements%20Traceability%20Matrix/eplc_requirements_traceability_practices_guide.pdf>.
- Design Structure Matrix work is useful because it models many interacting
  elements compactly, which fits "which specs/components/endpoints mutually
  constrain this surface?" See Browning's review of DSM for decomposition and
  integration problems:
  <https://bibbase.org/network/publication/browning-applyingthedesignstructurematrixtosystemdecompositionandintegrationproblemsareviewandnewdirections-2001>.
- Feature-Oriented Domain Analysis is useful because it separates commonality
  and variability across related systems. Guildhall can use the same lens to
  detect when specs are really part of one reusable contract surface instead of
  isolated work. The SEI FODA report is the historical anchor:
  <https://www.sei.cmu.edu/library/feature-oriented-domain-analysis-foda-feasibility-study/>.
- OpenAPI and AsyncAPI are useful examples of machine-readable API surfaces.
  Guildhall should ingest them as contract-surface sources when present, not
  replace them. OpenAPI describes HTTP APIs in a standard form:
  <https://spec.openapis.org/oas/latest>. AsyncAPI describes message-driven
  APIs in a protocol-agnostic format:
  <https://www.asyncapi.com/docs/reference/specification/v3.0.0>.
- The W3C Design Tokens format is useful because it treats design values as
  portable, tool-readable contract data:
  <https://www.w3.org/community/reports/design-tokens/CG-FINAL-format-20251028/>.

## Non-Goals

- Do not build a second project graph, spec graph, or ontology engine.
- Do not require every small implementation task to write a new contract
  surface.
- Do not block implementation on perfect automatic discovery. Surface packets
  may start as best-effort generated context plus owner/coordinator review.
- Do not replace OpenAPI, AsyncAPI, design-token files, component catalogs, or
  project-specific schema docs when those already exist. Reference and enrich
  them.
- Do not let a consumer project directly mutate a provider-owned contract.
  Consumer specs propose deltas; the owning authority accepts, rejects, or
  reshapes them.
- Do not turn every internal route handler into a public API contract. Local
  implementation details become contract surfaces only when they are durable
  boundaries with real consumers or repeated design pressure.

## Core Concepts

### Contract Surface

A contract surface is a graph node or graph facet representing a coherent public
or semi-public surface. It has an owner, a domain/capability relationship, a
scope, known consumers, accepted invariants, and accepted decisions.

Examples:

- `looma.component-api`
- `guildhall.owner-input`
- `guildhall.project-graph-exchange`
- `guildhall.structured-spec`
- `narrative-harness.structure-analysis`
- `api.public-rest`
- `events.workflow-lifecycle`
- `design-system.tokens-and-variants`
- `mcp.guildhall-project-resources`

### Surface Invariant

A surface invariant is a named rule inside a contract surface.

Examples:

- Component prop names use noun/adjective roles and avoid one-off synonyms.
- Dialog-like components expose composition slots for complex header/body/footer
  content and props for simple scalar labels.
- Public REST errors use one envelope shape.
- State-machine transitions are event-owned and append receipts.
- Design-system variant axes are limited to the approved vocabulary.

### Surface Decision

A surface decision is an accepted, dated change to the surface contract. It can
add, amend, deprecate, or remove an invariant. Decisions link to specs,
evidence, reviewer notes, and receipts.

### Spec Contract Delta

A spec contract delta is the part of an individual spec that declares its
relationship to one or more surfaces.

The delta says:

- which surface the spec touches;
- whether it consumes, extends, amends, deprecates, or replaces part of the
  surface;
- which invariants it relies on;
- which invariants it proposes to change;
- which sibling specs may be affected;
- which proof obligations follow from the change.

### Surface Review Packet

A surface review packet is generated before spec approval when a spec touches a
contract surface. It gives reviewers the context needed to approve the spec
without rereading the whole codebase or inventing rules from memory.

The packet includes:

- surface summary;
- owning project, domain, and authority role;
- existing invariants and decisions;
- sibling specs and recent deltas;
- consumers and provider/consumer graph edges;
- known drift or duplication from corpus refresh;
- proposed changes from the current spec;
- proof obligations and reviewer lenses;
- acceptance, rejection, or clarification options.

### Surface Receipt

A surface receipt records a deterministic result of a contract-surface event:

- delta accepted;
- delta rejected;
- clarification requested;
- invariant amended;
- surface superseded;
- consumer impact acknowledged;
- migration completed.

Surface receipts should use the generic state-machine primitive and should be
append-only, like project dependency edge receipts.

## Project Graph Integration

Contract surfaces should be represented inside the existing local project graph.
The model can start with a new node type and a few typed edge/facet records.

### Node Type

Add a project graph node type:

```ts
export type ProjectGraphNodeType =
  | 'local_guildhall_project'
  | 'local_repo'
  | 'domain'
  | 'package'
  | 'executable_unit'
  | 'external_authority'
  | 'delivery_channel'
  | 'contract_surface'
```

### Surface Record

Keep the surface record small and source-linked:

```ts
export interface ContractSurface {
  id: string
  label: string
  kind:
    | 'component_api'
    | 'http_api'
    | 'event_api'
    | 'mcp_api'
    | 'schema'
    | 'state_machine'
    | 'design_system'
    | 'domain_capability'
    | 'documentation'
    | 'other'
  owningProject: ProjectGraphNodeRef
  domain?: ProjectGraphNodeRef
  authority: 'provider' | 'shared' | 'consumer'
  scope: 'project' | 'workspace' | 'external_reference'
  sourceRefs: ContractSurfaceSourceRef[]
  consumerRefs: ProjectGraphNodeRef[]
  invariants: SurfaceInvariant[]
  decisions: SurfaceDecision[]
  stateMachine: {
    id: 'contract-surface'
    version: 1
    state: ContractSurfaceState
  }
  updatedAt: string
}
```

### Source References

Surface sources are evidence, not hidden truth:

```ts
export interface ContractSurfaceSourceRef {
  kind:
    | 'structured_spec'
    | 'project_graph'
    | 'structural_map'
    | 'openapi'
    | 'asyncapi'
    | 'design_tokens'
    | 'component_catalog'
    | 'schema_file'
    | 'state_machine_definition'
    | 'mcp_resource'
    | 'docs'
    | 'corpus_digest'
    | 'owner_decision'
  path?: string
  artifactId?: string
  nodeId?: string
  summary: string
}
```

### Edges And Facets

Start with the smallest useful edge/facet vocabulary:

- `owns_contract_surface`: project/domain owns a surface;
- `consumes_contract_surface`: project/domain/package consumes a surface;
- `changes_contract_surface`: spec proposes a delta;
- `validates_contract_surface`: proof/test/review validates an invariant;
- `supersedes_contract_surface`: a surface replaces an old surface;
- `shares_contract_surface`: two projects/domains share authority.

Do not overfit to UI. Design-system governance should become one
well-supported contract-surface kind, not the only kind.

## Contract-Surface State Machine

The first state machine should be intentionally small:

```text
draft -> proposed -> accepted -> amended -> accepted
draft -> rejected
proposed -> clarification_requested -> proposed
accepted -> deprecated -> superseded
accepted -> superseded
```

Events:

- `propose_surface`
- `request_clarification`
- `accept_surface`
- `reject_surface`
- `propose_delta`
- `accept_delta`
- `reject_delta`
- `amend_invariant`
- `deprecate_surface`
- `supersede_surface`

Guards:

- accepting a surface requires an owner or owning domain;
- accepting a delta requires a touched spec ref and reviewer/proof evidence;
- deprecating or superseding a surface requires a migration or consumer-impact
  note unless no consumers are known;
- shared-authority surfaces require the configured authority rule or an owner
  decision receipt.

The state machine should not perform corpus analysis, model calls, or file
writes. Command handlers gather context, call `transition`, then append receipts.

## Spec Approval Flow

Spec approval should gain one new phase:

1. Build or load the structured spec.
2. Detect touched contract surfaces from structured fields, file paths,
   structural map domains, code symbols, existing graph edges, corpus digest,
   and explicit user/coordinator declarations.
3. Generate one surface review packet per touched surface.
4. Let the spec agent revise the spec with explicit contract deltas.
5. Let reviewers approve, reject, or ask for clarification on those deltas.
6. When accepted, append surface receipts and update the central surface record.
7. Carry accepted invariants and proof obligations into worker/reviewer context.

The important product behavior: a spec can be blocked because its local design
is fine but its contract delta is incoherent with the larger surface.

## Structured Spec Extension

`StructuredSpec` should get a narrow optional field rather than a broad freeform
blob:

```ts
export interface StructuredSpecContractSurfaceDelta {
  surfaceId?: string
  proposedSurfaceLabel?: string
  relation: 'consumes' | 'extends' | 'amends' | 'deprecates' | 'replaces'
  summary: string
  invariantRefs?: string[]
  proposedInvariants?: Array<{
    id?: string
    label: string
    rule: string
    reason: string
  }>
  breakingChange?: boolean
  affectedConsumerRefs?: string[]
  proofObligations: string[]
  migrationNotes?: string
}

export interface StructuredSpec {
  contractSurfaceDeltas?: StructuredSpecContractSurfaceDelta[]
}
```

The field should be optional at first. Guildhall should require it only when
the detector finds a likely durable surface change or the user/spec agent
declares one.

## Surface Review Packet Shape

The generated packet should be compact enough for context windows:

```markdown
## Contract Surface Review

- Surface: guildhall.owner-input
- Kind: domain_capability
- Owner: Guildhall / runtime
- Authority: shared
- Known consumers: Thread, Needs You, Work, Structure, Settings
- Recent sibling specs: bounded chat, Needs You collapse, task question migration
- Existing invariants:
  - One owner decision links to one bounded-chat session.
  - Thread owns conversation; Needs You owns alerts.
  - Surfaces project linked session status only.
- Current spec delta:
  - Extends owner-input source kinds to contract-surface clarification.
- Proof obligations:
  - Owner-input store idempotency test.
  - Thread projection test.
  - Needs You alert-only test.
- Review focus:
  - Does this add another question-card model?
  - Does it preserve state-machine receipts?
```

Packets should be rendered into:

- spec agent context;
- reviewer context;
- owner-facing Structure surface when review needs human judgment;
- project graph view data for debugging and impact analysis.

## Corpus Digestion And Refresh

Corpus refresh should eventually propose contract surfaces and drift findings.

Detection sources:

- component exports and component catalogs;
- OpenAPI, AsyncAPI, JSON Schema, GraphQL schema, protobuf, and event schema
  files;
- state-machine definitions;
- MCP resource/tool definitions;
- design-token files and component contracts;
- repeated docs headings such as "API", "Component API", "Events", "Schema",
  "Contracts", "Architecture", and "Design system";
- repeated tests that protect the same vocabulary or proof shape;
- structured specs whose deltas name the same domain/capability.

Diagnostics:

- duplicated surface definitions;
- inconsistent names for equivalent props, events, endpoints, errors, states,
  tokens, or variants;
- specs that mutate a likely durable surface without a contract delta;
- accepted invariants with no proof obligations;
- proof obligations not linked to tests, review receipts, or owner decisions;
- consumer projects using a provider-owned surface without an explicit
  provider/consumer edge.

Learning proposals should stay proposal-only. Refresh may suggest a surface or
invariant; owner/coordinator approval decides what becomes durable.

## UI Placement

Contract surfaces belong in Structure, not Settings.

The Structure surface should eventually show:

- Structural map;
- Project graph;
- Contract surfaces;
- Surface review packets needing owner judgment;
- linked Thread conversations for clarification.

Settings may show readiness if a required contract-surface migration or
approval blocks the project, but Settings must not own contract review state or
packet rendering.

## Agent Harness Transfer

The same concept should feed managed-product agents.

Workers should receive a compact surface packet when their task touches a
contract surface. Reviewers should check whether the task:

- uses the existing surface vocabulary;
- adds a delta when changing the surface;
- stays inside the owner authority boundary;
- updates proof obligations;
- avoids creating a second local contract.

This generalizes the design-system constitution. UI tokens/components are one
surface type. APIs, event contracts, MCP tools, schemas, domain capabilities,
and state machines should get the same governance pattern.

## Storage And Migration

Initial storage should stay local-first:

- contract surfaces in the configured Guildhall home/project graph store;
- surface receipts as JSONL next to project graph receipts;
- structured spec deltas inside task/spec records;
- corpus refresh proposals inside corpus-map output until accepted.

Do not migrate existing specs in a broad compatibility pass. Instead:

1. add optional schema support;
2. generate packets for new specs;
3. add a refresh command that proposes surfaces from existing specs;
4. let owners/coordinators accept only the surfaces worth governing.

## Implementation Plan

Agents implementing this spec must update the checkboxes below in the same
commit as the completed work. Every checked step must include an `Evidence:`
bullet with the command, test, receipt, browser proof, or commit note that made
the step true.

- [x] **Step 1: Add contract-surface runtime model**

  Create the `ContractSurface`, `SurfaceInvariant`, `SurfaceDecision`,
  `StructuredSpecContractSurfaceDelta`, and `SurfaceReviewPacket` types. Keep
  the initial model small, source-linked, and project-graph-owned.

  Expected files:

  - `src/runtime/contract-surfaces.ts`
  - `src/runtime/__tests__/contract-surfaces.test.ts`
  - `src/core/structured-spec.ts`
  - `src/core/__tests__/structured-spec.test.ts`

  - Evidence: added `src/runtime/contract-surfaces.ts` with source-linked
    `ContractSurface`, invariant/decision, and `SurfaceReviewPacket` records;
    added optional `StructuredSpec.contractSurfaceDeltas` in
    `src/core/structured-spec.ts`; verified with
    `pnpm vitest run src/runtime/__tests__/contract-surfaces.test.ts src/runtime/__tests__/project-graph.test.ts src/core/__tests__/structured-spec.test.ts --reporter=dot`
    (`17` tests) and `pnpm typecheck`.

- [x] **Step 2: Add the contract-surface state machine and receipts**

  Use `src/runtime/state-machine.ts`. Do not invent lifecycle status helpers.
  Persist append-only receipts and test legal/rejected transitions.

  Expected files:

  - `src/runtime/contract-surface-machine.ts`
  - `src/runtime/__tests__/contract-surface-machine.test.ts`

  - Evidence: added `src/runtime/contract-surface-machine.ts` using the shared
    `src/runtime/state-machine.ts` primitive and persisted append-only
    transition receipts under the project-graph store; verified legal accepted
    surface flow and rejected delta acceptance in
    `src/runtime/__tests__/contract-surfaces.test.ts` with
    `pnpm vitest run src/runtime/__tests__/contract-surfaces.test.ts src/runtime/__tests__/project-graph.test.ts src/core/__tests__/structured-spec.test.ts --reporter=dot`
    (`17` tests) and `pnpm typecheck`.

- [x] **Step 3: Extend project graph nodes, view, and storage**

  Add `contract_surface` graph nodes plus minimal surface edges/facets. Querying
  the project graph should return surfaces scoped to the selected project and
  domain without putting review logic in Settings.

  Expected files:

  - `src/runtime/project-graph.ts`
  - `src/runtime/__tests__/project-graph.test.ts`
  - `src/runtime/serve.ts`
  - `src/runtime/__tests__/serve-settings.test.ts` or a focused graph endpoint
    test

  - Evidence: added `contract_surface` project graph node support, registry
    summaries, graph draft nodes, scoped `ProjectGraphView.contractSurfaces`,
    and `registerProjectGraphContractSurface`; verified with
    `src/runtime/__tests__/project-graph.test.ts` and the focused command
    `pnpm vitest run src/runtime/__tests__/contract-surfaces.test.ts src/runtime/__tests__/project-graph.test.ts src/core/__tests__/structured-spec.test.ts --reporter=dot`
    (`17` tests) plus `pnpm typecheck`. Endpoint/UI projection remains for
    later Structure work.

- [ ] **Step 4: Generate surface review packets during spec approval**

  The spec agent should detect or accept declared touched surfaces, generate
  packets, and revise structured specs with explicit deltas. Reviewers should
  receive the packet when contract surfaces are touched.

  Expected files:

  - `src/agents/spec-agent.ts`
  - `src/agents/reviewer-agent.ts`
  - `src/runtime/review-planner.ts`
  - focused tests for spec/reviewer context

  - Progress: added the first compact packet data structure and renderer in
    `src/runtime/contract-surfaces.ts`, but did not wire packet generation into
    spec approval or reviewer context in this bounded slice.

- [ ] **Step 5: Add corpus-refresh contract-surface proposals**

  Extend corpus digestion to propose likely contract surfaces and drift
  diagnostics without mutating durable graph state directly.

  Expected files:

  - `src/corpus-map/types.ts`
  - `src/corpus-map/build.ts`
  - `src/corpus-map/query.ts`
  - `src/corpus-map/__tests__/corpus-map.test.ts`

- [ ] **Step 6: Project contract surfaces into Structure**

  Add a focused Structure panel for contract surfaces and review packets. It
  should link to Thread/owner input for discussion and must not add new Settings
  branches.

  Expected files:

  - `src/web/surfaces/project/structure/ContractSurfacesPanel.svelte`
  - `src/web/surfaces/project/structure/ProjectStructurePanel.svelte`
  - `src/web/surfaces/project/structure/__tests__/ProjectStructurePanel.svelte.test.ts`

- [ ] **Step 7: Feed packets into worker and reviewer context**

  Context builder should inject compact surface packets only when relevant.
  Reviewer guidance should treat packet findings as evidence and ask for
  contract deltas when a task changes a durable surface.

  Expected files:

  - `src/runtime/context-builder.ts`
  - `src/runtime/effective-memory-packet.ts`
  - `src/agents/worker-agent.ts`
  - `src/agents/reviewer-agent.ts`

- [ ] **Step 8: Prove with three non-overfit fixtures**

  Test at least:

  - design-system token/variant surface;
  - component API surface;
  - API/event/MCP/schema surface.

  The tests must prove the model is not overfit to Looma, Knit, Dialog, Drawer,
  or Guildhall UI cleanup.

- [ ] **Step 9: Verify installed app behavior**

  Refresh the installed app, restart the service, verify `/api/stale-server`
  returns `stale:false`, and browser-proof the Structure surface against the
  active Narrative Harness project.

- [ ] **Step 10: Update the active overhead-reduction and flow-audit ledgers**

  Mark completed steps in this spec, update
  `internal/plans/2026-06-01-guildhall-cognitive-overhead-reduction.md`, and
  update `artifact:flow-audit` with exact verification evidence.

## Acceptance Criteria

- Contract surfaces are represented in the project graph, not in a separate
  graph subsystem.
- Individual structured specs can declare contract-surface deltas.
- Spec approval generates a surface review packet when a durable surface is
  touched.
- Accepted deltas update the central surface through a state-machine receipt.
- Corpus refresh can propose likely surfaces and drift findings without
  silently making durable decisions.
- Structure, not Settings, owns the owner-facing contract-surface review view.
- Worker and reviewer context includes compact surface packets when relevant.
- Tests include at least three surface kinds and prove the behavior is not
  product-name-specific.

## Open Questions

- Should contract-surface records live in the user-level graph registry first,
  project-local `.guildhall/`, or both with a mirror? Recommendation: start in
  the same local graph registry as project graph edges and mirror only accepted
  project-local facts later.
- Should surface invariants be editable directly, or only through accepted spec
  deltas? Recommendation: first implementation should prefer spec deltas and
  owner/coordinator receipts; direct editing can arrive later as a Structure UI
  shortcut that still creates a receipt.
- Should existing design-system governance records be migrated into a
  `design_system` surface? Recommendation: do this as a fixture/proof after the
  generic surface model lands, not as the first implementation shortcut.
