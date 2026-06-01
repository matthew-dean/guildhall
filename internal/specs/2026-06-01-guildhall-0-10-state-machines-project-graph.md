# Guildhall 0.10.0 State Machines and Local Project Graph

**Status:** Proposed 0.10.0 target-feature spec

## Goal

Add a small deterministic state-machine substrate to Guildhall, then use it to
model local project-graph dependency edges where one Guildhall project needs
work delivered by another Guildhall project.

This spec addresses two related 0.10 problems:

1. Guildhall is accumulating lifecycle state in several places, but many flows
   still behave like buckets of statuses set by ad hoc code.
2. Structural/domain intelligence and external authority need a shared project
   graph that can include other local Guildhall projects, not only folders,
   packages, domains, and external issue systems.

The 0.10 slice should build the state-machine primitive now, use it for the new
cross-project dependency edge, and migrate one small existing lifecycle enough
to prove the primitive. The broader task-status cleanup belongs in 0.11.0.

## Product Thesis

Guildhall should not ask agents to invent lifecycle strings. Agents can propose
events with evidence. The runtime decides whether the event is legal, applies
the transition, records a receipt, or rejects it with a deterministic reason.

The project graph should be local-first in 0.10. A graph node may be another
local Guildhall project, a repo, a domain, a package, an executable unit, an
external authority reference, or a delivery channel. Remote project authority
and richer external systems should be designed for, but not required for the
first implementation.

The first new product behavior is a provider/consumer dependency edge:

- a consumer project discovers a need;
- Guildhall routes that need to a provider project or provider-owned domain;
- the provider coordinator accepts, reshapes, rejects, or asks for clarity;
- the provider delivers through a typed channel;
- the consumer verifies the delivery in its own project;
- the dependency resolves only when the consumer accepts, an alternate outcome
  is explicitly chosen, or the edge is closed/deferred.

Provider "done" is not the same thing as dependency resolved.

## Non-Goals

- Do not replace the whole task lifecycle in 0.10.
- Do not force related projects under one filesystem root.
- Do not require symlinks, submodules, or a monorepo-shaped checkout.
- Do not build remote project execution in 0.10.
- Do not let one project write files, records, tasks, or state into another
  project. Projects can make requests to each other through a neutral exchange;
  the receiving project decides whether and how to import that request into its
  own state.
- Do not store raw agent negotiation transcript as durable project memory.
- Do not add new lifecycle state fields unless they are backed by an explicit
  state machine with legal transitions.

## Deterministic State-Machine Substrate

### Required Contract

Create a reusable runtime module, likely `src/runtime/state-machine.ts`, with a
small generic API:

```ts
export type StateMachineDefinition<
  State extends string,
  Event extends string,
  Context
> = {
  id: string
  version: number
  initial: State
  terminal: readonly State[]
  states: Record<State, {
    on: Partial<Record<Event, TransitionRule<State, Context>>>
  }>
}

export type TransitionRule<State extends string, Context> = {
  to: State
  require?: readonly string[]
  guard?: (context: Context) => TransitionGuardResult
  effect?: string
}

export type TransitionGuardResult =
  | { ok: true }
  | { ok: false; reason: string; missing?: string[] }
```

The runtime transition function should be the only supported mutation path:

```ts
transition(machine, {
  entityId,
  currentState,
  event,
  context,
  actor,
  evidence,
  now,
})
```

It returns one of:

- `applied`: `from`, `event`, `to`, `actor`, `evidence`, `machineId`,
  `machineVersion`, and timestamp;
- `rejected`: `from`, `event`, deterministic reason, missing requirements,
  actor, and timestamp.

The pure state-machine transition result must not include `noop`,
`already_applied`, or any other pseudo-state. Idempotency belongs one layer up,
in command handling. A retry-safe endpoint may check an idempotency key before
calling `transition`; if the key has already produced a receipt, the command
handler can return the existing receipt as `already_applied`. That is not a
state-machine result and must not appear in transition tables.

Direct assignment remains possible in legacy code until migrated, but new
lifecycles must not call `record.status = ...` or equivalent. They must emit an
event and let the machine validate it.

### Primitive Requirements

The state-machine primitive must support:

- explicit initial and terminal states;
- legal transitions by event;
- required context/evidence keys;
- optional guards for domain-specific checks;
- deterministic rejection reasons;
- append-only transition receipts;
- a clean boundary where retry-safe command handlers may use idempotency keys
  before transition evaluation;
- generated transition tables for tests and docs;
- derived UI labels from state, event history, and context;
- versioned definitions so persisted state can identify which machine applied
  a transition.

The primitive should not include:

- async side effects inside transition validation;
- model calls;
- UI copy as stored state;
- hidden fallback transitions;
- transitions selected by natural-language matching.

### Existing Lifecycle Proof

To prove the primitive is not overfit to project graph edges, 0.10 should
migrate one small existing lifecycle after the primitive lands.

Recommended first existing customer: capability requests.

Current capability requests carry:

```ts
status: 'pending' | 'approved' | 'denied' | 'blocked' | 'revoked'
```

The 0.10 migration should keep the stored `status` field for compatibility but
route changes through a machine:

```ts
pending --approve--> approved
pending --deny--> denied
pending --block--> blocked
approved --revoke--> revoked
blocked --approve--> approved
blocked --deny--> denied
```

This gives the library a real second use without disturbing the full task
engine. Bounded chat is also a good later customer because it already has a
state/action shape, but it is more entangled with the current 0.10 UI work.

Task lifecycle migration should be planned for 0.11.0. In 0.10, add adapter
tests or documentation that names obvious current task-transition debt, but do
not rewrite the task engine as part of this feature.

## Local Project Graph

### Graph Shape

The project graph is an authority-aware coordination graph, not only a repo or
package graph.

Node types:

- `local_guildhall_project`: a local project with `.guildhall/`, optional
  `guildhall.yaml`, or reachable Guildhall MCP/project state;
- `local_repo`: a Git authority root that may or may not be a Guildhall
  project;
- `domain`: a durable responsibility area such as editor, design system,
  parser parity, docs publishing, billing, auth, runtime, or project intake;
- `package`: a package/crate/module/unit discovered from manifests;
- `executable_unit`: a test/build/run/proof unit;
- `external_authority`: read-only references to Jira, Linear, GitHub Issues,
  npm, package registries, deployment systems, or artifact registries;
- `delivery_channel`: npm tag, package release, local path, Git branch, PR,
  Guildhall artifact, schema, endpoint, container image, or docs artifact.

Edge types:

- `owns`: project or domain owns a responsibility;
- `depends_on`: consumer needs provider output;
- `requests_from`: consumer asks provider for work;
- `delivers_to`: provider produces a delivery for consumer;
- `consumes`: consumer integrates a delivery;
- `mirrors`: local state mirrors an external authority;
- `blocks`: one unresolved edge blocks another unit of work;
- `shares_domain_with`: folders/packages/projects participate in a shared
  domain or cross-cutting concern.

In 0.10, graph discovery is local-first:

- inspect configured or recently used local project paths;
- inspect `.guildhall/` state and optional config;
- use Guildhall MCP resources when configured;
- inspect package dependencies, local path dependencies, imports, docs, memory,
  and current task references;
- propose graph nodes and edges for owner review before using them as routing
  truth.

Remote entries should be representable as references, but remote execution and
remote project coordination are future work.

### Domain Catalog and Custom Domains

Domains should be stable enough to document and compare, but flexible enough
for agents to discover project-specific concerns.

Use two layers:

1. **Domain archetypes:** a curated catalog with stable ids, labels, default
   questions, proof hints, and icons. Examples: `design_system`, `editor`,
   `runtime`, `cli`, `docs`, `release`, `auth`, `data_model`,
   `observability`, `billing`, `infrastructure`, `agent_memory`,
   `project_intake`, `testing`, `accessibility`.
2. **Custom domains:** project-specific proposed domains that map to an
   archetype when possible. Examples: `looma_editor_surface`,
   `jess_node_copy_reduction`, `narrative_constraint_engine`,
   `guildhall_bounded_chat`.

Agents may propose custom domains, but an accepted graph edge should preserve
the evidence and owner/coordinator decision that made the domain routable.

## Cross-Project Dependency Edge

### Responsibility Model

A dependency edge connects a consumer need to provider-owned delivery.

Consumer owns:

- the original need;
- consumer constraints;
- consumer verification;
- acceptance or structured rejection;
- downstream consumption task state.

Provider owns:

- whether the request belongs in the provider project;
- provider-domain shaping;
- provider implementation work;
- delivery format/channel decision within negotiated constraints;
- provider proof.

The edge owns:

- the negotiation record;
- the delivery expectation;
- links to provider and consumer tasks;
- delivery receipt;
- consumer verification result;
- final resolution state.

### Delivery Format vs Delivery Channel

The edge must distinguish what was delivered from how it was delivered.

Delivery format examples:

- component API;
- editor adapter;
- schema;
- package version;
- CLI command;
- docs contract;
- design token set;
- migration;
- service endpoint;
- artifact id.

Delivery channel examples:

- local path;
- npm dev tag;
- package release;
- Git branch;
- pull request;
- Guildhall artifact;
- deployed URL;
- container image;
- registry entry.

This lets a consumer say: "The channel worked, but the format is wrong." For
example, Looma may publish a dev tag, but Knit can return the delivery because
the exported editor adapter does not match the integration contract Knit
accepted.

### State Machine

Define the first project dependency edge machine with a deliberately small
state set:

```ts
type ProjectDependencyEdgeState =
  | 'draft'
  | 'submitted'
  | 'provider_shaping'
  | 'provider_working'
  | 'delivered'
  | 'consumer_reviewing'
  | 'revision_requested'
  | 'resolved'
  | 'closed'
```

Legal transitions:

```ts
draft:
  submit -> submitted
  close -> closed

submitted:
  accept_for_shaping -> provider_shaping
  reject_request -> closed
  close -> closed

provider_shaping:
  commit_delivery_plan -> provider_working
  return_for_clarification -> submitted
  close -> closed

provider_working:
  deliver -> delivered
  close -> closed

delivered:
  begin_consumer_review -> consumer_reviewing
  close -> closed

consumer_reviewing:
  accept_delivery -> resolved
  request_revision -> revision_requested
  close -> closed

revision_requested:
  revise_plan -> provider_shaping
  redeliver -> delivered
  close -> closed

resolved:
  no outgoing transitions

closed:
  no outgoing transitions
```

Required evidence:

- `submit`: consumer need, consumer project, provider candidate, rationale;
- `accept_for_shaping`: provider project, provider coordinator/actor, domain;
- `commit_delivery_plan`: delivery format, delivery channel, provider proof
  plan, consumer verification plan;
- `deliver`: delivery receipt, provider proof, exact channel coordinates;
- `begin_consumer_review`: consumer task or verification command/context;
- `accept_delivery`: consumer proof that the delivery was usable;
- `request_revision`: rejection evidence, expected correction, whether the
  issue is format, channel, scope, quality, compatibility, or documentation;
- `close`: reason and owner/coordinator actor.

Derived UI labels should come from state plus context, not stored states:

- "Waiting on Looma"
- "Looma is shaping the editor API"
- "Knit is verifying delivery"
- "Returned to Looma"
- "Resolved with npm dev tag"
- "Closed as deferred"

### Consumer Return Loop

Consumer rejection is normal protocol, not an exceptional failure.

When the consumer requests a revision, Guildhall should create a structured
return packet:

- what the provider delivered;
- what the consumer expected;
- which verification failed;
- whether the mismatch is delivery format, delivery channel, scope, behavior,
  compatibility, docs, or proof;
- what evidence supports the rejection;
- whether the consumer can proceed with a workaround;
- whether owner input is needed to change the contract.

The provider coordinator can then revise the plan, redeliver, reject the
revision as out of contract, or ask for owner/coordinator input through bounded
chat.

### Example: Looma and Knit

1. Knit discovers it needs inline editor comments.
2. The graph shows the editor/domain responsibility belongs to Looma, while
   Knit owns product integration.
3. Knit creates a dependency edge with a consumer need and integration proof.
4. Looma accepts the request for shaping and decides the generic API belongs in
   Looma's editor package, not in Knit.
5. Looma commits a delivery plan: editor annotation primitives delivered via
   local path or npm dev tag, with Storybook/API/docs proof.
6. Looma delivers a receipt.
7. Knit begins consumer review and runs its own integration gates.
8. Knit either accepts the delivery or returns it with evidence, such as "the
   package exposes framework-neutral core state but not the Svelte adapter Knit
   accepted."
9. The edge resolves only after Knit accepts, an alternate outcome is accepted,
   or the dependency is closed/deferred.

## Relationship To Existing 0.10 Lanes

### Structural and Domain Intelligence

Structural/domain intelligence should produce graph drafts, not only structural
maps. A domain may be local to one repo, shared across packages in a monorepo,
or owned by another local Guildhall project.

The owner review UI should be able to say:

- "These folders look like domains."
- "These packages share a cross-cutting concern."
- "This project appears to depend on another local Guildhall project."
- "This domain appears provider-owned elsewhere."

### External Task Authority

External task authority is a sibling use of the same graph model. Jira, Linear,
GitHub Issues, npm, and deployment systems are external authority nodes. They
may be mirrored or referenced by graph edges, but they do not become local
Guildhall projects unless a future remote adapter supports that.

### Bounded Chat

Bounded chat remains the owner/coordinator discussion surface when a graph
edge needs judgment:

- accept or reject a provider request;
- reshape a delivery plan;
- choose a delivery channel;
- approve an external system write, when an external authority connector is in
  scope;
- decide whether a consumer rejection is in contract;
- close/defer a dependency.

Bounded chat should propose state-machine events; it should not mutate edge
state directly.

### Agent Memory Bridge

External agents should attach to the relevant project, task, or dependency
edge before acting. Evidence they write back should be usable as transition
evidence when it matches the machine's required fields.

## Data Model Sketch

```ts
type ProjectGraph = {
  id: string
  version: number
  generatedAt: string
  nodes: ProjectGraphNode[]
  edges: ProjectGraphEdge[]
  evidence: ProjectGraphEvidence[]
}

type ProjectDependencyEdge = {
  id: string
  stateMachine: {
    id: 'project_dependency_edge'
    version: number
    state: ProjectDependencyEdgeState
  }
  consumer: ProjectGraphNodeRef
  provider: ProjectGraphNodeRef
  domain?: ProjectGraphNodeRef
  consumerNeed: string
  providerShape?: string
  deliveryExpectation?: {
    format: string
    channel: string
    providerProofPlan: string[]
    consumerVerificationPlan: string[]
  }
  providerTaskRef?: string
  consumerTaskRef?: string
  deliveryReceipt?: DeliveryReceipt
  transitionReceipts: StateTransitionReceipt[]
  evidenceRefs: string[]
  createdAt: string
  updatedAt: string
}
```

## Storage, Exchange, and Authority Boundaries

0.10 should make one concrete storage decision instead of leaving graph records
abstract.

### User-Level Local Graph Registry

Create a user-level local registry as the coordination index for graph records
that span more than one project:

```text
~/.guildhall/project-graph/
  registry.json
  graphs/
    local.json
  edges/
    <edge-id>.json
  receipts/
    <edge-id>.jsonl
```

Use the platform/user state directory if Guildhall already has a preferred
location, but keep the logical contract above: one local registry, one graph
snapshot, one file per cross-project edge, and append-only transition receipts.

The registry owns cross-project coordination identity and the neutral exchange:

- stable graph id;
- stable local project node ids;
- project path and path fingerprint;
- last seen time;
- last successful MCP/resource read time;
- stale/missing-path state;
- edge ids and current edge states;
- pointers to provider/consumer project-local mirrors.

The registry must not own provider task truth or consumer task truth. It is the
coordination index, request exchange, and edge ledger.

### Project-Local Mirrors

Each participating project gets a project-local mirror under its own
`.guildhall/` state:

```text
.guildhall/project-graph/
  incoming-requests/
    <edge-id>.json
  outgoing-requests/
    <edge-id>.json
  deliveries/
    <edge-id>.json
```

Consumer projects create outgoing request mirrors in their own project state.
Provider projects create incoming request mirrors in their own project state
only after the provider coordinator accepts or imports a request from the
neutral exchange. Both mirrors point back to the user-level edge id and store
only the project-local view needed for Thread, Overview, task detail, and local
evidence.

Project-local mirrors make each project independently inspectable and
recoverable. If the user-level registry is unavailable, a project can still
show "this project has an incoming request" or "this task is waiting on a
delivery" from its own state.

### Authority Rules

- The user-level registry may create and advance neutral dependency edge
  records.
- A consumer project may create an outgoing mirror and consumer-side task.
- A consumer project may publish a request packet to the neutral exchange.
- A consumer project must never create, edit, or delete provider project files,
  tasks, mirrors, evidence, or delivery records.
- A provider project decides whether to import an exchange request. Only the
  provider coordinator, operating inside the provider project, may create the
  provider incoming mirror, provider-side task, provider evidence, or delivery
  receipt.
- Provider-owned task creation, status changes, evidence, and delivery receipts
  happen through the provider project's own runtime/MCP/CLI while the provider
  project is the active authority.
- If provider MCP is unavailable, the request remains in the exchange until the
  provider project is opened or a provider-authorized CLI command is run from
  that project. The consumer does not fall back to file writes in the provider
  tree.
- Missing or stale provider paths block provider import and leave a
  deterministic transition rejection or waiting state, not a half-created
  provider task.

## Agent Communication and Task Assignment

Cross-project communication is a protocol, not a chat transcript. Agents pass
structured packets through Guildhall-owned surfaces, and every packet either
creates a state-machine event or becomes evidence for one.

### Coordinator Context Rule

Provider and consumer coordinators must negotiate from their own project
contexts.

The consumer coordinator receives:

- consumer project memory, decisions, tasks, artifacts, and constraints;
- the consumer's structural/domain map;
- the consumer's verification requirements;
- the consumer-side task or request that created the need;
- a compact provider identity and capability summary from the graph, not the
  provider's full project context.

The provider coordinator receives:

- provider project memory, decisions, tasks, artifacts, and constraints;
- the provider's structural/domain map;
- provider ownership and delivery policies;
- provider proof requirements;
- the consumer request packet, not the consumer's full project context.

Neither coordinator should operate from a blended prompt that includes both
projects' full context. The exchange packets are the boundary. Each coordinator
may ask the other for more information through a structured clarification
request, but the answer comes back as a packet that can be recorded, reviewed,
and used as transition evidence.

This matters because the provider must be able to say "this does not belong in
my project" or "I can deliver a more general shape" using provider-local
knowledge, while the consumer must be able to say "that delivery does not work
for us" using consumer-local proof.

### Negotiation Packets

Coordinators negotiate by exchanging packets through the neutral graph exchange:

- `provider_request`: consumer asks provider to consider work;
- `provider_clarification_request`: provider asks the consumer for missing
  constraints or examples;
- `consumer_clarification_response`: consumer answers from consumer context;
- `provider_delivery_plan`: provider states the delivery shape it can own;
- `consumer_plan_response`: consumer accepts the plan or returns requested
  changes before work starts;
- `delivery_receipt`: provider reports what was delivered with provider proof;
- `consumer_return`: consumer rejects delivery with consumer verification
  evidence;
- `consumer_acceptance`: consumer accepts delivery with consumer proof.

These packets are not freeform chat messages. They have typed fields, evidence
refs, actor identity, source project id, target project id, created time, and
the edge id. Bounded chat can help a coordinator draft or explain a packet, but
the packet is the durable exchange record.

### Preferred Communication Path

When both projects are local, communication still flows through requests. MCP
is used only by the project that owns the state being changed.

1. Consumer coordinator calls a local graph command/tool to create an edge draft
   and outgoing mirror.
2. Consumer coordinator submits the edge with `submit`, including consumer
   need, provider candidate, rationale, and expected delivery shape.
3. Graph coordinator resolves the provider project node and publishes a
   provider request packet to the neutral exchange.
4. The provider project, when opened or when its coordinator polls the
   exchange, sees the pending request and chooses whether to import it.
5. Provider coordinator creates an incoming request mirror inside the provider
   project and either:
   - accepts for shaping;
   - rejects with evidence;
   - asks for clarification through bounded chat;
   - proposes a different provider/domain.
6. If accepted, provider coordinator creates a provider-owned task in the
   provider project and links it to the edge.
7. Consumer coordinator creates or links a consumer-side waiting/integration
   task in the consumer project.
8. Provider agents work the provider task normally, append evidence locally,
   and eventually emit `deliver` with a delivery receipt.
9. Consumer agents run consumer verification and emit `accept_delivery` or
   `request_revision`.
10. If revision is requested, the graph coordinator publishes a structured
    return packet to the exchange. The provider project imports it under its
    own authority before revising or rejecting the requested correction.

### Fallback Communication Path

When MCP is not configured for the provider project, use a CLI fallback that
preserves the same authority boundary. Commands that affect provider-local
state must be run with the provider project as the target/current project.

```sh
guildhall graph request publish --edge <edge-id>
guildhall graph request list --project <provider-path>
guildhall graph request import --edge <edge-id> --project <provider-path>
guildhall graph request accept --edge <edge-id> --project <provider-path> --domain <domain-id>
guildhall graph deliver --edge <edge-id> --project <provider-path> --receipt <receipt-file>
guildhall graph delivery accept --edge <edge-id> --project <consumer-path>
guildhall graph delivery return --edge <edge-id> --project <consumer-path> --evidence <evidence-file>
```

These commands should call the same runtime helper functions as MCP tools. The
fallback is not permission for a consumer project to hand-edit provider task
files or provider records.

### Assignment Packets

Provider assignment packet:

```ts
type ProviderAssignmentPacket = {
  edgeId: string
  consumerProject: ProjectGraphNodeRef
  providerProject: ProjectGraphNodeRef
  requestedDomain?: ProjectGraphNodeRef
  consumerNeed: string
  constraints: string[]
  proposedDeliveryExpectation?: {
    format: string
    channel: string
    consumerVerificationPlan: string[]
  }
  evidenceRefs: string[]
  requestedBy: string
  requestedAt: string
}
```

Consumer waiting packet:

```ts
type ConsumerWaitingPacket = {
  edgeId: string
  providerProject: ProjectGraphNodeRef
  providerTaskRef?: string
  expectedDelivery?: {
    format: string
    channel: string
  }
  blockedConsumerTaskRef?: string
  verificationPlan: string[]
  currentEdgeState: ProjectDependencyEdgeState
}
```

Return packet:

```ts
type ConsumerReturnPacket = {
  edgeId: string
  deliveryReceiptId: string
  mismatchKind: 'format' | 'channel' | 'scope' | 'behavior' | 'compatibility' | 'docs' | 'proof'
  expected: string
  received: string
  failedVerification: string[]
  evidenceRefs: string[]
  requestedCorrection: string
  returnedBy: string
  returnedAt: string
}
```

These packets are durable exchange records. A project may mirror the packets
that involve it into its own `.guildhall/` state, but only that project writes
its own mirror. The structured exchange packet is the source of truth for
cross-project negotiation, while each project-local mirror is the source of
truth for that project's UI and task context.

### Task Assignment Rules

- Consumer-side tasks are created in the consumer project only.
- Provider-side tasks are created in the provider project only.
- The edge stores both task refs and blocks/resumes work based on edge state.
- Provider tasks should use normal Guildhall task lifecycle until the 0.11 task
  state-machine migration. The edge state machine does not replace provider
  task status.
- Consumer verification is its own task or subtask when it requires code,
  commands, or review. Quick verification can be recorded directly as edge
  evidence.
- An agent starting work in either project should attach to the edge if the
  task has `edgeId`, `incomingRequestId`, or `outgoingRequestId`.

### Communication Failures

Communication failures must be explicit:

- provider path missing: leave the request in the exchange with
  `provider_path_missing`;
- provider MCP unavailable: leave the request in the exchange until the
  provider project imports it through its own runtime or CLI;
- duplicate existing edge: return existing edge and do not create another;
- provider rejects ownership: edge closes or reroutes with evidence;
- consumer rejects delivery: edge enters `revision_requested`, not `closed`;
- provider/consumer disagree about contract: bounded chat asks owner or
  coordinator to choose revise, accept alternate, or close/defer.

## UX Requirements

The user should not have to type graph configuration by hand for the first
successful path.

Guildhall should inspect local projects and propose a graph in plain language:

- "Knit appears to depend on Looma for editor components."
- "Guildhall appears to consume Looma editor UI."
- "Narrative Harness may consume Looma UI later, but no active dependency was
  found."
- "Jess has a monorepo-local parser parity domain; no external project needed."

When a task crosses authority boundaries, the UI should offer one clear action:

- "Send request to Looma"
- "Review provider plan"
- "Verify Looma delivery"
- "Return to provider"
- "Accept delivery"

The advanced graph view can exist later. The 0.10 path should prioritize
actionable cards in Thread, Overview, task detail, and provider/consumer task
surfaces.

## Implementation Slices

1. **State-machine primitive**
   - Add `src/runtime/state-machine.ts`.
   - Add red-to-green tests for legal transitions, rejected transitions,
     terminal states, required evidence, and receipt shape.
   - Add command-handler tests outside the pure primitive for idempotency-key
     replay, proving `already_applied` is a command result and never a
     transition result.

2. **Capability-request migration proof**
   - Keep stored request shape compatible.
   - Route approve/deny/block/revoke through a capability request machine.
   - Add tests proving direct illegal transitions are rejected.

3. **Project graph draft model**
   - Add local graph node/edge types.
   - Discover local Guildhall projects through configured paths, recent
     project state, `.guildhall/`, MCP resources when available, and package
     dependency hints.
   - Persist graph drafts to the user-level local graph registry and project-
     local mirrors only for the active project. Do not write mirrors into
     another project.

4. **Dependency edge machine**
   - Define the project dependency edge machine.
   - Add user-level storage for local dependency edges and append-only
     transition receipts.
   - Add runtime tests for full happy path and consumer return path.

5. **Agent communication and assignment**
   - Add graph exchange helpers for publishing provider requests and return
     packets to the neutral registry.
   - Add provider-authority helpers for importing requests, creating provider
     tasks, and recording delivery receipts only when running in the provider
     project.
   - Add consumer-authority helpers for accepting or returning delivery only
     when running in the consumer project.
   - Add CLI fallback commands that call the same runtime helpers and require
     an explicit `--project` authority target.
   - Add tests proving consumer code cannot create provider mirrors, provider
     tasks, or provider delivery records.

6. **Local Looma/Knit fixture**
   - Use local Looma/Knit/Guildhall project facts as a fixture, but keep the
     model provider-neutral.
   - Prove request, provider shaping, delivery receipt, consumer verification,
     revision request, redelivery, and final acceptance.

7. **Owner-facing first path**
   - Add one bounded-chat or Thread-driven flow for sending a local dependency
     request and reviewing provider/consumer state.
   - Do not build a full graph editor in 0.10.

8. **Docs and release proof**
   - Keep this spec internal until behavior is implemented and proven.
   - Public docs should describe the user-facing feature only after browser
     proof exists.

## Acceptance Criteria

- New lifecycle code uses the state-machine primitive instead of direct status
  assignment.
- The primitive rejects illegal transitions with deterministic reasons.
- The primitive records append-only transition receipts.
- Capability requests or another small existing lifecycle are migrated enough
  to prove the primitive outside the project graph feature.
- Guildhall can represent a local project graph containing at least Guildhall,
  Looma, and Knit as separate local projects.
- Cross-project graph records have concrete storage: a user-level local graph
  registry for edge identity and receipts, plus project-local incoming/outgoing
  mirrors for each participating project.
- A graph edge can point from one local Guildhall project to another without
  requiring symlinks, submodules, or a shared parent workspace.
- A consumer coordinator can publish a provider request to the neutral graph
  exchange without mutating provider files, tasks, or records.
- A provider coordinator can accept a request, create provider-owned work, and
  link it back to the shared edge only from inside the provider project's
  authority boundary.
- A project dependency edge can move through request, provider shaping,
  provider delivery, consumer review, consumer return, redelivery, and consumer
  acceptance using legal state-machine events.
- Provider completion alone does not mark the edge resolved.
- Consumer rejection records structured evidence and returns the edge through
  a legal transition.
- Remote/external authority nodes can be represented as references, but no
  remote execution is required for 0.10.

## Risks

- **State-machine overbuild:** avoid a heavyweight workflow engine. The first
  primitive should be a small transition validator plus receipts.
- **Status proliferation:** do not add states for every UI mood. UI labels are
  derived from machine state, context, and receipts.
- **Cross-project mutation risk:** one project must never write another
  project's records. Mitigate by using a neutral exchange plus provider-side
  import, with tests that fail any consumer-side provider mutation path.
- **Split-brain registry risk:** the user-level registry and project-local
  mirrors can drift. Mitigate with edge ids, path fingerprints, last-seen
  timestamps, and repair commands that reconcile mirrors from receipts.
- **Graph overreach:** 0.10 should propose and use a narrow local graph, not
  build a universal enterprise dependency platform.
- **Looma/Knit overfitting:** fixtures may use Looma/Knit, but the model must
  use provider/consumer/domain/delivery language.
- **Task lifecycle scope creep:** leave broad task-status migration for 0.11.0.

## Open Questions

- Which existing local project registry should seed
  `~/.guildhall/project-graph/registry.json` in the first implementation?
- How much of the graph should be visible in 0.10 UI versus only represented
  through actionable Thread/Overview cards?
- Should consumer return require owner approval when the provider and consumer
  coordinators disagree about the accepted contract?
