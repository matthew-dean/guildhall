# Guildhall 0.10.0 Implementation Tracker

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this tracker task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Guildhall 0.10.0 as an owner-trustworthy operating-map release where focused bounded chats replace transcript drift, repo structure is understood before routing work, external planning systems can remain authoritative while Guildhall executes locally, and outside-agent memory exchange becomes intentional.

**Architecture:** Land the owner-facing interaction contract first with bounded chat, add a small deterministic state-machine substrate before introducing new lifecycle-heavy flows, then give the runtime a stronger model of repo structure, local project graphs, and authority boundaries before layering external task sync and external memory exchange on top. Keep each lane independently testable, but make bounded state, context shaping, explicit transitions, and auditable evidence the common substrate.

**Tech Stack:** TypeScript/Node, Svelte, Vitest, Playwright, Guildhall runtime/session stores, local host app + browser UI, MCP/server surfaces, external issue connectors, docs/versioning scripts.

---

## Source Plans

- `internal/plans/2026-05-31-guildhall-0-10-bounded-chat.md`
- `internal/specs/2026-05-29-guildhall-0-10-structural-domain-intelligence.md`
- `internal/specs/2026-05-29-guildhall-0-10-external-task-authority.md`
- `internal/specs/2026-06-01-guildhall-0-10-state-machines-project-graph.md`
- `internal/specs/2026-05-28-guildhall-0-10-agent-memory-bridge.md`
- `internal/audits/flow-audit.md`

## Release Thesis

0.10.0 should feel like Guildhall finally knows how to ask for help, how to
understand a repo, and how to stay humble about what it owns.

The owner-facing leap is bounded chat: Guildhall should open one focused
conversation when it needs information, permission, judgment, or blocker
resolution, close it when the objective is fulfilled, and preserve only the
useful durable record. That interaction model becomes the front door for intake,
New request, and later owner-input recovery.

Under that surface, 0.10.0 should deepen Guildhall's operating map. Repo
structure, domain routing, Git authority, external planning authority, contract
surfaces, and memory scope should be explicit enough that future work is
grounded in audited context instead of transcript archaeology or stale local
assumptions.

The release is ready only when:

- bounded chat handles at least deep intake and New request with one active
  objective, explicit closure, and durable receipts;
- owner-input surfaces stop scattering multiple async question cards for one
  objective across Thread, Inbox, Overview, and task detail;
- structural/domain intelligence can draft a reviewable map of repo/package/
  domain/Git boundaries without mutating the target repo as a side effect;
- the state-machine substrate validates new lifecycle transitions through
  events, guards, and receipts instead of ad hoc status assignment;
- the local project graph can represent other local Guildhall projects as
  authority-aware nodes and track at least one provider/consumer dependency
  edge through delivery, consumer verification, return, and final acceptance;
- external task authority can mirror an externally owned issue into local
  execution truth without pretending Guildhall owns planning truth;
- the agent memory bridge keeps external-agent memory exchange structured,
  bounded, and evidence-backed;
- every changed owner-facing surface has matching docs and browser proof before
  the release is called ready.

OpenRouter guided provider setup has been moved to 0.11.0. Keep the 0.10
release boundary focused on operating-map behavior, authority boundaries,
owner-input coherence, and contract/memory structure.

## Priority Order

1. Bounded chat runtime contract and first owner-facing adapters.
2. State-machine substrate and local project graph dependency-edge proof.
3. Structural/domain intelligence and auditable context shaping.
4. External task authority and local execution mirrors.
5. External agent memory bridge.
6. Contract surfaces and surface review packets.
7. Cross-lane docs, screenshots, and release proof.

## Cross-Cutting Rules

- Keep Thread as the command surface, but do not treat every owner interaction
  as a permanent transcript.
- Prefer one bounded-chat entry point per active objective over rows of
  competing recovery buttons.
- Separate repo structure, package graph, domain group, executable unit, memory
  scope, and Git authority in both code and owner-facing review surfaces.
- New lifecycle-heavy 0.10 flows must use explicit state-machine events,
  validated transitions, and receipts. UI wording can be richer than stored
  states, but stored states must not become a bucket of lifecycle moods.
- Treat other local Guildhall projects as possible project-graph nodes. A
  consumer project can request work from a provider project, but provider-owned
  state changes must happen through provider authority and consumer acceptance
  must be explicit.
- Keep public docs reader-facing; keep unreleased architecture/process details
  in `internal/`.
- Every new owner-facing behavior needs fresh browser proof plus matching docs
  or an explicit note that the change remains internal-only in this release.

## Milestone 0: Planning Hygiene And Sequencing

**Purpose:** Make the 0.10 implementation order explicit so feature work lands
in a deliberate sequence rather than as disconnected spikes.

**Files:**

- Modify: `internal/README.md`
- Modify: `internal/audits/flow-audit.md`
- Create/maintain: this tracker

- [x] Create a canonical 0.10.0 implementation tracker.
- [x] Link the tracker from `internal/README.md`.
- [x] Record the active bounded-chat implementation start in `artifact:flow-audit`.
- [x] Keep this tracker updated as each 0.10 lane moves from proposed to active
  to browser-proven.
  Final 0.10 readiness pass updated the remaining bounded-chat, external task
  authority, external-agent memory bridge, contract-surface, docs, screenshot,
  and browser-proof ledgers. OpenRouter remains explicitly deferred to 0.11.0.

## Milestone 1: Bounded Chat

**Purpose:** Replace transcript-drift-prone owner-input flows with objective-
bounded conversations that leave structured receipts instead of permanent raw
threads.

**Primary source:** `internal/plans/2026-05-31-guildhall-0-10-bounded-chat.md`

**Priority slices:**

1. Runtime contract.
2. Intake adapter.
3. New request adapter.
4. Recovery/owner-input adapter.
5. UI replacement and receipts.
6. Docs and release proof.

**Immediate first slice:** Runtime contract, then the minimum intake/New request
path needed to prove the pattern in a browser.

- [x] Add bounded-chat types and storage.
- [x] Add bounded-chat session state transitions and action validation.
- [x] Add idempotent application for coordinator actions and closure receipts.
- [x] Route deep intake through bounded chat before tackling the broader owner-
  input replacement map.
  Project check-in now starts, resumes, answers, and closes through bounded
  chat, and Thread projects both active and fulfilled sessions as bounded-chat
  turns/receipts instead of the setup card. The dedicated bounded-chat panel
  now replaces the old question-card rendering wherever bounded-chat state
  exists. Focused proof covers multi-question exhaustion, confused-answer
  discard handling, resume-later behavior, persisted decision writes, completed
  Thread receipts, and the dedicated bounded-chat UI branch.
- [x] Route New request through bounded chat once runtime + intake contract are
  stable.
  Backend default now creates a `new_request` bounded-chat session for every
  non-pressure-test New request route: ordinary task shaping, ambiguous
  policy/spec asks, settings/practice/repair/clarification routes, and pure
  project-question conversations. Task-like requests create exploring task
  drafts only after the owner answers the shaping prompt. Pure project
  questions close as conversation receipts with no task draft. The modal routes
  straight into `Threads`, includes the bounded-chat id in its app event, and
  preserves that id in `/thread?thread=<boundedChatId>` so the new conversation
  is selected.
- [x] Add route-backed bounded-chat UI and notification projection only after
  the backend/session contract is stable.
  The first `Threads + Needs you` transition slice is now in place: runtime
  inbox classification explicitly keeps approvals/questions/escalations
  thread-owned, `/api/project/inbox` only returns alert-owned items, the rail
  now says `Threads`, and `Needs you` renders as a compact alert/history view
  that points active conversations back to Threads. The current `Threads` shell
  has the first real navigation model behind it: wide layouts keep list +
  detail side by side, compact layouts switch to a `project nav -> thread list
  -> thread detail` stack, the top-left control becomes `Threads` instead of a
  hamburger while a compact detail is selected, and thread content no longer
  waits on runtime/dev-server/capability side fetches before rendering. The
  bounded-chat route slice lets `/thread?thread=<boundedChatId>` select the
  linked bounded-chat chain even when another turn is globally active, and row
  selection keeps Thread URLs route-backed. The latest UI projection adds a
  dedicated bounded-chat conversation panel for task intake and project
  questions so bounded-chat state no longer renders through the legacy
  question-card branch. Focused verification:
  `pnpm vitest run src/runtime/__tests__/bounded-chat.test.ts
  src/runtime/__tests__/thread.test.ts
  src/runtime/__tests__/request-routing.test.ts
  src/runtime/__tests__/serve-intake.test.ts
  src/runtime/__tests__/serve-settings.test.ts
  src/web/surfaces/project/__tests__/ThreadTab.svelte.test.ts
  src/web/surfaces/__tests__/IntakeModal.svelte.test.ts --reporter=dot`
  passed with 251 tests; `pnpm typecheck:ui` and `pnpm lint:design` passed.
  `pnpm typecheck` was rerun, but the branch still has unrelated
  contract-surface schema/type drift in `src/runtime/context-builder.ts` and
  `src/runtime/intake.ts`.

## Milestone 2: State Machines And Local Project Graph

**Purpose:** Build a deterministic transition primitive before adding more
lifecycle-heavy coordination flows, then use it for local cross-project
provider/consumer dependency edges.

**Primary source:** `internal/specs/2026-06-01-guildhall-0-10-state-machines-project-graph.md`

- [x] Add a small generic state-machine runtime with legal transitions,
  guards, required evidence, terminal states, and append-only transition
  receipts. The pure transition result must be only `applied` or `rejected`;
  idempotency-key replay belongs in command handling, not in the state-machine
  result or transition table. First implementation landed in
  `src/runtime/state-machine.ts` with focused tests.
- [x] Migrate one small existing lifecycle, preferably capability requests, so
  the primitive is proven outside the new project-graph feature without
  rewriting the full task lifecycle. Capability request approve, deny, block,
  and revoke now route through a machine and append transition receipts.
- [x] Draft and persist a local project graph that can include other local
  Guildhall projects, domains, packages, executable units, external authority
  references, and delivery channels. Initial user-level registry and local
  graph snapshot are persisted under `~/.guildhall/project-graph/`.
- [x] Add a project dependency edge state machine where provider completion is
  not enough; the edge resolves only after consumer verification, an explicit
  alternate outcome, or closure/deferment. Edge helpers now cover provider
  import, shaping, delivery, consumer review, consumer return, revised plan,
  redelivery, and final acceptance.
- [x] Add coordinator negotiation packets so consumer and provider coordinators
  talk through the neutral graph exchange while each reasons from its own
  project context. Do not build a blended cross-project prompt or let one
  coordinator impersonate another project's authority. The implementation
  writes provider requests and consumer returns to the neutral exchange, and
  writes project-local mirrors only from the matching provider/consumer
  authority helper.
- [x] Prove request, provider shaping, delivery receipt, consumer verification,
  consumer return, redelivery, and final acceptance with local fixtures such as
  Looma/Knit while keeping the model provider-neutral. Runtime tests use
  local Knit/Looma fixtures while asserting provider/consumer authority rather
  than product-specific behavior.

## Milestone 3: Structural And Domain Intelligence

**Purpose:** Give Guildhall a reviewable model of repo structure so routing,
context, memory, and Git policy are grounded in evidence.

**Primary source:** `internal/specs/2026-05-29-guildhall-0-10-structural-domain-intelligence.md`

### Status

Foundation slice complete, feature not complete. The branch currently has the
first structural-map runtime primitive, persistence location, deterministic
owner-review machine, focused context-slice helper, and one cross-project
handoff test path. It does **not** yet have full domain inference, UI review,
agent packet integration, coordinator assignment, or remote authority support.

### Completed Foundation

- [x] Create structural-map records under
  `.guildhall/structural-map/drafts/<map-id>.json`, accepted map at
  `.guildhall/structural-map/accepted.json`, and transition receipts under
  `.guildhall/structural-map/receipts/<map-id>.jsonl`.
- [x] Avoid target repo registration side effects: discovery does not create
  `guildhall.yaml`.
- [x] Add a deterministic structural-map review state machine:
  `draft -> owner_review -> accepted`,
  `owner_review -> correction_requested -> owner_review -> accepted`, and
  `* -> superseded` where allowed.
- [x] Add initial runtime model nodes for project, workspace, monorepo,
  package, domain group, cross-cutting domain, executable unit, and Git
  authority root.
- [x] Detect pnpm workspace package nodes, package dependency edges,
  package-local executable units, root executable units, and vendored
  dependency Git metadata.
- [x] Add a focused structural context-slice helper with routing authority,
  handles, executable units, and omitted unrelated package reasons.
- [x] Add cross-project request shaping from accepted consumer/provider maps
  into the project graph, preserving the rule that projects publish requests
  and never write into each other's project state.
- [x] Prove the foundation path with tests for draft persistence, review,
  correction, acceptance, context slicing, provider import, provider delivery,
  consumer verification, and return-for-revision.

### Remaining Work Ledger

**Remaining: 0 items. Next item: merge decision once the active bounded-chat worktree on `0.10.0` is clean enough to receive this branch.**

Verification on `feature/0.10-structural-domain-intelligence`: `pnpm
typecheck` passed; `pnpm vitest run src/runtime/__tests__/project-graph.test.ts
src/runtime/__tests__/serve-settings.test.ts
src/web/surfaces/project/__tests__/SettingsTab.svelte.test.ts` passed with 82
tests; `pnpm vitest run src/runtime/__tests__/structural-map.test.ts
src/runtime/__tests__/context-builder.test.ts
src/runtime/__tests__/effective-memory-packet.test.ts` passed with 89 tests;
`pnpm build` passed. Full `pnpm test` remains blocked by bounded-chat UI tests
outside this branch's changed files:
`src/web/surfaces/__tests__/ProjectView.svelte.test.ts` and
`src/web/surfaces/project/__tests__/ThreadTab.svelte.test.ts`.

18. [x] Persist explicit project-domain authority assignments in the local
    project graph. After this: expose project-graph actions through the project
    API.
    Completed in `feature/0.10-structural-domain-intelligence`: the global
    local project graph now records domain authority assignments separately
    from dependency requests, preserves those assignments in scoped graph views,
    and never writes provider project state during assignment.
19. [x] Add project API actions for assigning domain authority and moving
    provider/consumer requests through the state machine from each owning
    project context. After this: surface the graph in settings.
    Completed in `feature/0.10-structural-domain-intelligence`: the project
    API supports domain authority assignment plus provider accept/plan/deliver
    and consumer review/return/accept actions, each scoped through the current
    project path and the existing authority checks.
20. [x] Add a settings graph surface that shows structural domains, lets the
    owner assign each domain to a local project, and displays inbound/outgoing
    dependency requests. After this: add request action controls.
    Completed in `feature/0.10-structural-domain-intelligence`: Settings now
    has a Project graph section with structural-domain assignment controls,
    local project visibility, and inbound/outgoing request cards.
21. [x] Add request action controls for provider intake/planning/delivery and
    consumer review/return/acceptance, always scoped to the current project
    authority. After this: prove the flow with tests.
    Completed in `feature/0.10-structural-domain-intelligence`: request cards
    expose only the actions valid for the current project role and edge state.
22. [x] Add runtime/API/UI tests for the full cross-project domain lifecycle:
    assign domain, create request, provider sees inbound request, provider
    accepts/plans/delivers, consumer verifies/returns, provider redelivers, and
    consumer accepts. After this: rerun verification, update this ledger, commit
    and push.
    Evidence: `pnpm vitest run src/runtime/__tests__/project-graph.test.ts
    src/runtime/__tests__/serve-settings.test.ts
    src/web/surfaces/project/__tests__/SettingsTab.svelte.test.ts` passed with
    82 tests.
23. [x] Make the project graph itself list detected structural domains and
    local coordinator domains, while keeping separately registered local
    projects unassigned until the owner explicitly assigns authority. This is
    the monorepo boundary rule: domains/coordinators detected inside the
    ingested project graph are automatic graph nodes; external sibling projects
    are selectable but are not auto-assigned.
    Evidence: focused graph/API/UI tests now pass with 83 tests.

### Project Graph UX Walkthrough Fix Plan

**Remaining: 0 items. Next item: merge decision once the active bounded-chat worktree on `0.10.0` is clean enough to receive this branch.**

Walkthrough finding: the underlying graph now has the right boundary model, but
the UI still asks the owner to infer too much. A user needs to see which domains
were detected in this project, which project is responsible for each domain,
which nearby projects are merely available for manual assignment, and who is
waiting on whom for each dependency request.

1. [x] Rename and reframe the domain panel around responsibilities, not vague
   ownership. Show each domain as detected in this project, explicitly assigned
   elsewhere, explicitly assigned here, or not externally assigned.
2. [x] Separate local project rows so the current project, connected projects,
   and unrelated registered projects are visually and textually distinct.
   Related external projects should read as available for manual assignment,
   not implied owners.
3. [x] Make dependency request cards show waiting-on provider/consumer in plain
   language, plus the current project's role on that request.
4. [x] Add focused Settings UI tests for the clarified walkthrough language:
   detected domain, unassigned external responsibility, related project
   available for assignment, and waiting-on text.
5. [x] Rerun focused graph/API/UI verification, update this fix plan, commit,
   and push.
   Evidence: `pnpm typecheck` passed; `pnpm vitest run
   src/runtime/__tests__/project-graph.test.ts
   src/runtime/__tests__/serve-settings.test.ts
   src/web/surfaces/project/__tests__/SettingsTab.svelte.test.ts` passed with
   83 tests; `pnpm build` passed.

### Project Graph Responsibility Facets And Child Projects

**Remaining: 0 items. Next item: merge decision once the active bounded-chat worktree on `0.10.0` is clean enough to receive this branch.**

Live walkthrough finding: Narrative Harness can technically assign a whole
domain such as `Product` or `Specs` to `Looma + Knit`, but that is the wrong
level of authority. The graph needs to show first-class child projects such as
`Looma` and `Knit`, and domain responsibilities need leaf facets so a consumer
can request provider capability from another project without giving away local
product/configuration authority. For example, Looma can own reusable component
capability and the shared theme contract, while Narrative Harness owns token
values, product taste, and consumer verification.

1. [x] Add failing runtime tests that expand registered workspace child
   projects into selectable local graph nodes without making the workspace
   council the only provider target.
2. [x] Add failing runtime tests for domain responsibility facets:
   `provider_capability`, `shared_contract`, `consumer_configuration`, and
   `consumer_verification`, including Narrative Harness + Looma-style
   ownership boundaries.
3. [x] Implement child-project graph expansion from `guildhall.yaml` workspace
   `projects`, preserving project-local paths and current/related/connected
   roles.
4. [x] Implement persistent responsibility-facet assignment records in the
   local project graph registry, with project-scoped assignment helpers and
   scoped graph views.
5. [x] Expose responsibility facets in the Settings graph API while keeping
   the owner-facing Settings graph focused on domains first, not internal
   responsibility machinery.
6. [x] Add focused Settings UI tests for child project visibility and facet
   wording/actions.
7. [x] Run focused graph/API/UI verification, refresh the live browser
   walkthrough on Narrative Harness, update this ledger/audit, commit, and
   push.
   Evidence: `pnpm typecheck` passed; `pnpm vitest run
   src/runtime/__tests__/project-graph.test.ts
   src/runtime/__tests__/serve-settings.test.ts
   src/web/surfaces/project/__tests__/SettingsTab.svelte.test.ts` passed with
   86 tests; `pnpm build` passed; `pnpm dev:install` refreshed the installed
   app; service restart returned `/api/stale-server` with `stale:false`; live
   browser walkthrough on
   `http://localhost:7777/projects/narrative-harness/settings/graph` confirmed
   provider/shared/consumer facets, standalone `Looma` and `Knit` child-project
   options, and local consumer configuration/verification labels.
8. [x] Simplify the Settings project-graph UI after live walkthrough feedback:
   show domains as clickable graph nodes, move assignment into a focused domain
   detail panel, remove select-box-plus-assign controls from the main graph,
   and keep consumer-side responsibility text as plain local context. Focused
   UI test passes.
9. [x] Flatten nested card treatments in the Settings project graph: major
   sections remain framed, but local-project rows, domain detail sections, and
   dependency requests no longer render as utility-panel cards inside graph
   cards. Added a UI regression check that `.graph-card` does not contain
   nested `.utility-panel` elements.
10. [x] Replace raw managed-project dumps with a scalable assignment picker:
    the graph summarizes the managed-project index, stops calling unmanaged
    semantic relationships "related", and only reveals matching project names
    inside a search picker after `Assign to project`.

1. [x] Replace the current pnpm-only discovery core with a provider interface
   for package/workspace discovery. After this: implement JS/npm/yarn/bun
   providers. Completed in `feature/0.10-structural-domain-intelligence`:
   `draftStructuralMap` now accepts structural discovery providers, default
   pnpm workspace discovery is behind `pnpmStructuralDiscoveryProvider`, and
   provider evidence is recorded on drafts.
2. [x] Add JS package-manager providers for npm, yarn, bun, and package.json
   workspaces, including lockfile/source evidence where cheap. After this:
   add non-JS fixtures. Completed in
   `feature/0.10-structural-domain-intelligence`: default structural
   discovery now includes npm, yarn, bun, and package.json workspace providers,
   detects lockfile/workspace evidence, and emits package-manager-specific
   executable commands.
3. [x] Add non-JS structural fixtures and minimal detectors for Python, Rust,
   PHP/Composer, .NET solution/project files, and docs-only repos. After this:
   add module/class architecture inference. Completed in
   `feature/0.10-structural-domain-intelligence`: default discovery now
   includes minimal providers for `pyproject.toml`, Cargo workspaces,
   Composer projects, `.sln`/`.csproj` solutions, and docs-only repositories,
   each with focused fixture coverage and evidence refs.
4. [x] Add module/class architecture inference for app folders, namespaces,
   routes, services, migrations, jobs, commands, and tests when packages do
   not describe domains. After this: expand cross-cutting concern inference.
   Completed in `feature/0.10-structural-domain-intelligence`: default
   discovery now includes a module-architecture provider that clusters
   conventional services, controllers, routes, migrations, tests, jobs, and
   commands into evidence-backed domain groups without treating them as
   packages.
5. [x] Expand cross-cutting concern inference beyond node-copy reduction:
   parser parity, design-system reuse, auth/session security, migrations,
   accessibility, observability, release packaging, and owner-defined custom
   domains. After this: add evidence/conflict scoring. Completed in
   `feature/0.10-structural-domain-intelligence`: cross-cutting inference now
   covers those common concerns, preserves node-copy reduction, and reads
   owner-defined cross-cutting domains from
   `.guildhall/structural-domains.json`.
6. [x] Add structural evidence scoring, freshness, conflicts, and owner
   questions per node/edge instead of coarse confidence labels. After this:
   add refresh/diff behavior. Completed in
   `feature/0.10-structural-domain-intelligence`: final map nodes and edges
   now carry evidence scores and freshness, duplicate structural IDs merge
   evidence instead of overwriting, label conflicts are preserved, and conflict
   owner questions are generated.
7. [x] Add structural-map refresh/diff support so manifest/source/Git changes
   mark only affected map areas stale and ask review questions only where
   routing, memory, commands, or Git authority changes. After this: wire maps
   into task routing. Completed in
   `feature/0.10-structural-domain-intelligence`: `refreshStructuralMap`
   redrafts current structure, diffs it against a prior map, classifies review
   impact, writes `.guildhall/structural-map/refreshes/<refresh-id>.json`, and
   creates targeted review questions for changed routing/command/Git/memory
   areas.
8. [x] Use accepted structural maps in actual task routing and coordinator
   assignment, including domain coordinators and cross-cutting domain
   activation. After this: wire maps into context-builder. Completed in
   `feature/0.10-structural-domain-intelligence`: `routeTaskWithStructuralMap`
   now requires an accepted map and returns primary domain, coordinator,
   package nodes, executable units, Git authority root, activated
   cross-cutting domains, and route reasons.
9. [x] Integrate structural slices into `buildContext`/agent packets for spec,
   worker, reviewer, and gate-checker roles with role-specific budget tiers.
   After this: add omitted-context audit persistence. Completed in
   `feature/0.10-structural-domain-intelligence`: `buildContext` now loads an
   accepted structural map when present, injects a structural map section into
   formatted context, exposes `structuralMapContext`, and renders role-specific
   budget tiers for spec, worker, reviewer, and gate-checker packets.
10. [x] Persist context-debug/omitted-context records with structural handles
    and reasons, and expose enough data for agents to retrieve deferred
    context on demand. After this: wire memory scopes. Completed in
    `feature/0.10-structural-domain-intelligence`: `BuiltContext` carries
    structural omissions, context debug records persist omitted handles with
    reasons/confidence/retrieval hints, and context snapshots render deferred
    structural handles explicitly.
11. [x] Connect structural map scopes to memory selection/promotion so
    repo-global, domain, package, executable-unit, cross-cutting, and
    task-specific memories do not compete as flat project memory. After this:
    add owner review UI. Completed in
    `feature/0.10-structural-domain-intelligence`: memory records now support
    `structuralScopes`, effective memory derives task route scope ids from the
    accepted structural map, and structurally mismatched memory is withheld
    instead of included through generic tag overlap.
12. [x] Build the owner review/correction UI for detected Git roots, ignored
    roots, package graph, domain groups, cross-cutting domains, executable
    units, confidence, conflicts, and questions. After this: add UI actions.
    Completed in `feature/0.10-structural-domain-intelligence`: `/api/project`
    now includes an accepted structural-map review summary and Project
    Overview renders the owner-visible map state, counts, Git roots, ignored
    roots, packages, domains, cross-cutting domains, executable units,
    conflicts, and owner questions without granting cross-project write
    authority.
13. [x] Add UI actions for accept, rename, merge, split, mark cross-cutting,
    mark package-only, ignore with reason, and defer decision. After this:
    add coordinator communication records.
    Completed in `feature/0.10-structural-domain-intelligence`: structural
    map review actions now run through deterministic transition primitives and
    a project-owned `/api/project/structural-map/action` endpoint; Project
    Overview posts owner requests for accepting, renaming, merging, splitting,
    marking cross-cutting/package-only, ignoring, and deferring decisions, then
    refreshes the local review summary.
14. [x] Add explicit coordinator communication records for structural domain
    requests: consumer request packet, provider intake packet, negotiated
    delivery plan, delivery receipt, consumer return packet, and final
    acceptance summary with each coordinator's own project context. After this:
    add project graph visualization/query.
    Completed in `feature/0.10-structural-domain-intelligence`: project
    dependency edges now carry typed coordinator communication records, the
    neutral exchange persists
    `.guildhall-home/project-graph/exchange/coordinator-communications/<edge-id>.jsonl`,
    and each lifecycle record includes the speaking coordinator's own project
    context rather than granting any coordinator cross-project write authority.
15. [x] Add project-graph queries/views that include other local projects,
    local authority roots, provider-owned domains, dependency edges, delivery
    channels, and unresolved requests. After this: add delivery-channel
    abstraction.
    Completed in `feature/0.10-structural-domain-intelligence`:
    `queryProjectGraphView` projects the current local project, related local
    projects, provider authority roots/domains, dependency edges, delivery
    channels, and unresolved requests; `/api/project/project-graph` serves the
    scoped view for the selected project.
16. [x] Generalize delivery channels beyond npm/dev tags to package-manager
    coordinates, local path artifacts, docs/spec artifacts, patches, releases,
    MCP artifact IDs, and future remote authority refs without overfitting to
    Looma/Knit. After this: add remote authority extension points.
    Completed in `feature/0.10-structural-domain-intelligence`: dependency
    plans and delivery receipts now accept ecosystem-neutral delivery channel
    descriptors covering package-manager coordinates, local path artifacts,
    docs/spec artifacts, patches, releases, MCP artifact IDs, and future
    remote authority refs; the project-graph view preserves descriptor kind,
    label, and coordinates while keeping legacy string channels compatible.
17. [x] Add remote authority extension points for future Jira/Linear/GitHub
    issue truth sources while keeping 0.10 execution local and request-based.
    After this: run full milestone verification and decide whether to merge
    into `0.10.0` or keep slicing.
    Completed in `feature/0.10-structural-domain-intelligence`: dependency
    edges can carry local-only remote authority refs for Jira, Linear, GitHub
    Issues, and generic future systems; scoped project-graph views expose those
    refs with `executionMode: local_request_reference`, preserving the 0.10
    rule that local projects negotiate requests instead of letting remote
    systems or other projects write into project state.

## Milestone 4: External Task Authority

**Purpose:** Let Guildhall execute locally while respecting Jira/Linear/GitHub
Issues style planning authority.

**Primary source:** `internal/specs/2026-05-29-guildhall-0-10-external-task-authority.md`

- [x] Add provider-neutral external issue refs and local execution mirrors.
  First bounded runtime slice landed in
  `src/runtime/external-task-authority.ts`: Jira, Linear, GitHub Issues, Azure
  DevOps, Asana, and custom refs share one `ExternalIssueRef` identity model,
  and `ExternalTaskMirror` keeps local task id, authority policy, context route,
  context budget, source snapshot, local proof/evidence refs, proposed external
  writes, and state-machine receipts separate from provider planning truth.
- [x] Keep stale/conflict state inspectable instead of silently overwriting.
  `refreshExternalTaskMirror` now compares a fresh provider ref with the
  shaped source snapshot, records field-level `syncState`, marks harmless
  external drift as `stale`, and marks authority-sensitive changes or stale
  proposed writes as `conflict` without mutating external systems.
- [x] Shape execution packets from external issue truth plus repo-local context.
  `buildExternalTaskExecutionPacket` now produces a deterministic,
  provider-neutral packet from an `ExternalTaskMirror` plus repo-local task,
  structural, route, policy, PR/review, and proof refs. Packets expose readiness
  as `ready`, `recheck_required`, or `blocked_by_external_conflict` from the
  mirror's stale/conflict state and keep context manifest buckets sorted and
  inspectable.
- [x] Gate external writes behind explicit policy and evidence-backed proposals.
  `recordExternalWriteProposal`, `approveExternalWriteProposal`, and
  `rejectExternalWriteProposal` record proposal/decision receipts, require
  evidence refs, honor read-only/allowed-field policy, and move approved writes
  only to `pending` connector execution state without mutating provider truth.
  Focused verification:
  `pnpm vitest run src/runtime/__tests__/external-task-authority.test.ts --reporter=dot`
  passed with 8 tests. `pnpm typecheck` was rerun, but the branch still has
  unrelated contract-surface/intake/serve type errors outside Milestone 4.

## Milestone 5: Agent Memory Bridge

**Purpose:** Make outside-agent memory exchange first-class without turning raw
chat into ambient truth.

**Primary source:** `internal/specs/2026-05-28-guildhall-0-10-agent-memory-bridge.md`

- [x] Define bridge records, freshness/evidence requirements, and scope rules.
  First bounded runtime slice landed in
  `src/runtime/external-agent-memory-bridge.ts`: provider-neutral bridge
  records now validate explicit scope/type, freshness, confidence/risk, and at
  least one evidence ref before import.
- [x] Expose memory exchange through explicit import/export or link flows.
  The runtime now persists `.guildhall/external-agent-memory-bridge.json` and
  exposes import, export, list, link-style source refs, review, and reject
  helpers. The 0.10 exposure path now includes MCP and CLI record flows:
  `guildhall://project/external-agent-memory-bridge`,
  `guildhall.list_external_memory_bridge_records`,
  `guildhall.import_external_memory_bridge_record`,
  `guildhall.review_external_memory_bridge_record`,
  `guildhall.reject_external_memory_bridge_record`, and
  `guildhall agent memory <import|list|review|reject>`. UI exposure remains
  deferred to the broader external-session/task-surface work rather than being
  added to Settings for this bounded memory-record slice.
- [x] Keep external-agent memory reviewable before it shapes local execution.
  Imported bridge records stay in the bridge store only; `reviewExternalMemoryBridgeRecord`
  is the explicit promotion step into ordinary memory, where the existing
  effective-memory rules decide whether it enters execution context.
  Focused verification: `pnpm vitest run
  src/runtime/__tests__/external-agent-memory-bridge.test.ts
  src/runtime/__tests__/cli.test.ts src/mcp-server/__tests__/server.test.ts
  --reporter=dot` passed with 30 tests. `pnpm typecheck` was rerun, but the
  branch still has unrelated contract-surface/intake/serve type errors outside
  Milestone 5.

## Milestone 6: Contract Surfaces And Surface Review Packets

**Purpose:** Let specs for one domain or capability update and be checked
against a central contract surface so sibling specs do not drift into
inconsistent prop names, API shapes, composition rules, provider boundaries, or
design-system vocabulary.

**Primary source:** `internal/specs/2026-06-02-guildhall-contract-surfaces-project-graph.md`

- [x] Add contract-surface runtime records and state-machine receipts.
  Runtime model, optional structured-spec deltas, surface state machine, and
  append-only receipt persistence landed in `src/runtime/contract-surfaces.ts`,
  `src/runtime/contract-surface-machine.ts`, and `src/core/structured-spec.ts`.
  Evidence: `pnpm vitest run src/runtime/__tests__/contract-surfaces.test.ts src/runtime/__tests__/project-graph.test.ts src/core/__tests__/structured-spec.test.ts --reporter=dot`
  (`17` tests) and `pnpm typecheck`.
- [x] Represent contract surfaces as project-graph nodes/facets with evidence,
  owning project authority, invariants, decisions, and proof obligations.
  Contract surfaces now register through the existing project graph store,
  appear as `contract_surface` nodes in graph drafts, and project scoped surface
  summaries through `ProjectGraphView.contractSurfaces`. Evidence: focused
  project-graph contract-surface test in
  `src/runtime/__tests__/project-graph.test.ts`, included in the focused Vitest
  command above.
- [x] Generate surface review packets during spec approval from sibling specs,
  known decisions, changed rules, and unresolved obligations.
  Spec approval now reads `structuredSpec.contractSurfaceDeltas`, generates
  task-local `contractSurfaceReviewPackets` from durable surface records, and
  carries sibling task refs, decisions, invariants, and proof obligations into
  the packet artifact. Evidence: `pnpm vitest run src/runtime/__tests__/contract-surfaces.test.ts src/runtime/__tests__/project-graph.test.ts src/core/__tests__/structured-spec.test.ts src/runtime/__tests__/intake.test.ts src/corpus-map/__tests__/corpus-map.test.ts src/runtime/__tests__/context-builder.test.ts src/web/surfaces/project/structure/__tests__/ProjectStructurePanel.svelte.test.ts --reporter=dot`
  (`141` tests) and `pnpm typecheck`.
- [x] Let corpus refresh propose contract-surface updates from repeated
  cross-spec patterns without applying them automatically.
  Corpus Map refresh now emits `contractSurfaceProposals` only after repeated
  `Contract Surface` / invariant language appears across multiple indexed spec
  or doc files; proposals carry evidence and `ownerApprovalRequired: true` and
  do not mutate durable project-graph surface state. Evidence: focused corpus
  fixture in `src/corpus-map/__tests__/corpus-map.test.ts`, included in the
  focused Vitest command above.
- [x] Project contract surfaces into Structure and feed relevant packets into
  worker/reviewer context.
  Structure now renders scoped project-graph contract surfaces in the existing
  Structure graph panel, while context builder injects compact packet markdown
  for `in_progress`, `review`, and `gate_check` tasks only when packets are
  attached to the task. Evidence: focused Structure/context fixtures in
  `src/web/surfaces/project/structure/__tests__/ProjectStructurePanel.svelte.test.ts`
  and `src/runtime/__tests__/context-builder.test.ts`, included in the focused
  Vitest command above.

## Deferred To 0.11: OpenRouter Guided Setup

**Purpose:** Offer OpenRouter as a trustworthy hosted-provider setup path with
clear routing, attribution, and recommendation evidence.

**Primary source:** `internal/plans/2026-05-28-guildhall-0-11-openrouter-support.md`

- [ ] Add named OpenRouter provider profile and request extras in 0.11.0.
- [ ] Add role-aware presets and recommendation evidence thresholds in 0.11.0.
- [ ] Add guided provider UI, browser proof, and listing-readiness packet in
  0.11.0.

## Milestone 7: Docs, Screenshots, And Release Proof

**Purpose:** Prove 0.10 behavior end to end and keep public/internal docs in
sync with what actually shipped.

- [x] Update public docs only for behavior that is implemented and proven.
  Root public docs now describe bounded Thread conversations, Structure-owned
  contract surfaces, contract-surface packets in context, and MCP/CLI external
  memory bridge review. Frozen version snapshots were left alone.
- [x] Capture fresh screenshots for every changed owner-facing surface.
  Captured installed-app Thread and Structure screenshots under
  `docs/assets/ui-audit/0-10-0/` after dev install and service restart.
- [x] Keep internal plans/specs aligned with what the code now does.
  Milestone 1, 4, 5, and 6 checklists now reflect the completed implementation
  slices, and the 0.11 OpenRouter deferral remains separate from the 0.10
  readiness boundary.
- [x] Run browser proof for bounded chat, then for the later 0.10 lanes that
  add new owner-facing surfaces.
  Installed-app proof: `pnpm dev:install` completed, service restart reported
  `/api/stale-server` as `stale:false`, browser proof loaded
  `http://localhost:7777/projects/narrative-harness/thread` and confirmed no
  raw `invalid_type` / `taskReadiness` / schema JSON leak while Thread showed
  project-question and brief-cleanup routing, and browser proof loaded
  `http://localhost:7777/projects/narrative-harness/structure` with Structure
  showing structural map, project graph, and contract-surface placement.
