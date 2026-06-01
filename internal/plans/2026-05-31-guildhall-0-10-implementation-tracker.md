# Guildhall 0.10.0 Implementation Tracker

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this tracker task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Guildhall 0.10.0 as an owner-trustworthy operating-map release where focused bounded chats replace transcript drift, repo structure is understood before routing work, external planning systems can remain authoritative while Guildhall executes locally, outside-agent memory exchange becomes intentional, and hosted-provider setup is guided instead of generic.

**Architecture:** Land the owner-facing interaction contract first with bounded chat, add a small deterministic state-machine substrate before introducing new lifecycle-heavy flows, then give the runtime a stronger model of repo structure, local project graphs, and authority boundaries before layering external task sync, external memory exchange, and provider setup guidance on top. Keep each lane independently testable, but make bounded state, context shaping, explicit transitions, and auditable evidence the common substrate.

**Tech Stack:** TypeScript/Node, Svelte, Vitest, Playwright, Guildhall runtime/session stores, local host app + browser UI, MCP/server surfaces, external issue connectors, provider configuration flows, docs/versioning scripts.

---

## Source Plans

- `internal/plans/2026-05-31-guildhall-0-10-bounded-chat.md`
- `internal/specs/2026-05-29-guildhall-0-10-structural-domain-intelligence.md`
- `internal/specs/2026-05-29-guildhall-0-10-external-task-authority.md`
- `internal/specs/2026-06-01-guildhall-0-10-state-machines-project-graph.md`
- `internal/specs/2026-05-28-guildhall-0-10-agent-memory-bridge.md`
- `internal/plans/2026-05-28-guildhall-0-10-openrouter-support.md`
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
structure, domain routing, Git authority, external planning authority, and
memory scope should be explicit enough that future work is grounded in audited
context instead of transcript archaeology or stale local assumptions.

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
- OpenRouter setup is guided as a named provider path with attribution,
  routing, and recommendation evidence rather than a generic hosted URL field;
- every changed owner-facing surface has matching docs and browser proof before
  the release is called ready.

## Priority Order

1. Bounded chat runtime contract and first owner-facing adapters.
2. State-machine substrate and local project graph dependency-edge proof.
3. Structural/domain intelligence and auditable context shaping.
4. External task authority and local execution mirrors.
5. External agent memory bridge.
6. OpenRouter guided provider setup and listing readiness.
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
- [ ] Keep this tracker updated as each 0.10 lane moves from proposed to active
  to browser-proven.

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
- [ ] Route deep intake through bounded chat before tackling the broader owner-
  input replacement map.
  Project check-in now starts and answers through bounded chat, with Thread
  projection reusing the existing question-card surface while the dedicated
  bounded-chat UI is still pending. Focused proof now covers multi-question
  exhaustion, confused-answer discard handling, resume-later behavior,
  persisted decision writes, and a completed Thread turn once the session
  closes.
- [ ] Route New request through bounded chat once runtime + intake contract are
  stable.
  Backend default is now widened for task-like asks: ordinary Task Intake and
  ambiguous policy/spec asks both create a `new_request` bounded-chat session
  instead of immediately creating exploring tasks. The task is only created
  after the owner answers the shaping prompt, and Thread continues to project
  active/done turns for the session. The modal now routes straight into
  `Threads` after creation and includes the bounded-chat id in its app event,
  but a dedicated thread-list selection model and pure project-question
  conversation threads are still follow-up slices.
- [ ] Add route-backed bounded-chat UI and notification projection only after
  the backend/session contract is stable.
  The first `Threads + Needs you` transition slice is now in place: runtime
  inbox classification explicitly keeps approvals/questions/escalations
  thread-owned, `/api/project/inbox` only returns alert-owned items, the rail
  now says `Threads`, and `Needs you` renders as a compact alert/history view
  that points active conversations back to Threads. Dedicated route-backed
  bounded-chat task intake is still pending. The current `Threads` shell now
  has the first real navigation model behind it: wide layouts keep list +
  detail side by side, compact layouts switch to a `project nav -> thread list
  -> thread detail` stack, the top-left control becomes `Threads` instead of a
  hamburger while a compact detail is selected, and thread content no longer
  waits on runtime/dev-server/capability side fetches before rendering. The
  latest runtime pass also split `/api/project/thread` into a fast core payload
  plus best-effort `/api/project/thread/extras` hydration for per-task git
  story data, moved thread snapshot/session loading onto async cached reads,
  and taught `buildSnapshotAsync` to use `.guildhall/tasks/index.json` for
  hot-path task counts instead of reparsing `TASKS.json` just to count current
  tasks.

## Milestone 2: State Machines And Local Project Graph

**Purpose:** Build a deterministic transition primitive before adding more
lifecycle-heavy coordination flows, then use it for local cross-project
provider/consumer dependency edges.

**Primary source:** `internal/specs/2026-06-01-guildhall-0-10-state-machines-project-graph.md`

- [ ] Add a small generic state-machine runtime with legal transitions,
  guards, required evidence, terminal states, and append-only transition
  receipts. The pure transition result must be only `applied` or `rejected`;
  idempotency-key replay belongs in command handling, not in the state-machine
  result or transition table.
- [ ] Migrate one small existing lifecycle, preferably capability requests, so
  the primitive is proven outside the new project-graph feature without
  rewriting the full task lifecycle.
- [ ] Draft and persist a local project graph that can include other local
  Guildhall projects, domains, packages, executable units, external authority
  references, and delivery channels.
- [ ] Add a project dependency edge state machine where provider completion is
  not enough; the edge resolves only after consumer verification, an explicit
  alternate outcome, or closure/deferment.
- [ ] Add coordinator negotiation packets so consumer and provider coordinators
  talk through the neutral graph exchange while each reasons from its own
  project context. Do not build a blended cross-project prompt or let one
  coordinator impersonate another project's authority.
- [ ] Prove request, provider shaping, delivery receipt, consumer verification,
  consumer return, redelivery, and final acceptance with local fixtures such as
  Looma/Knit while keeping the model provider-neutral.

## Milestone 3: Structural And Domain Intelligence

**Purpose:** Give Guildhall a reviewable model of repo structure so routing,
context, memory, and Git policy are grounded in evidence.

**Primary source:** `internal/specs/2026-05-29-guildhall-0-10-structural-domain-intelligence.md`

- [ ] Draft and persist a structural map without mutating target repo config.
- [ ] Keep project/workspace/monorepo/package/domain/executable/Git authority
  concepts separate in the runtime model.
- [ ] Use the structural map to improve context manifests and omission audits.
- [ ] Add owner review/correction flow before the map becomes routing truth.

## Milestone 4: External Task Authority

**Purpose:** Let Guildhall execute locally while respecting Jira/Linear/GitHub
Issues style planning authority.

**Primary source:** `internal/specs/2026-05-29-guildhall-0-10-external-task-authority.md`

- [ ] Add provider-neutral external issue refs and local execution mirrors.
- [ ] Keep stale/conflict state inspectable instead of silently overwriting.
- [ ] Shape execution packets from external issue truth plus repo-local context.
- [ ] Gate external writes behind explicit policy and evidence-backed proposals.

## Milestone 5: Agent Memory Bridge

**Purpose:** Make outside-agent memory exchange first-class without turning raw
chat into ambient truth.

**Primary source:** `internal/specs/2026-05-28-guildhall-0-10-agent-memory-bridge.md`

- [ ] Define bridge records, freshness/evidence requirements, and scope rules.
- [ ] Expose memory exchange through explicit import/export or link flows.
- [ ] Keep external-agent memory reviewable before it shapes local execution.

## Milestone 6: OpenRouter Guided Setup

**Purpose:** Offer OpenRouter as a trustworthy hosted-provider setup path with
clear routing, attribution, and recommendation evidence.

**Primary source:** `internal/plans/2026-05-28-guildhall-0-10-openrouter-support.md`

- [ ] Add named OpenRouter provider profile and request extras.
- [ ] Add role-aware presets and recommendation evidence thresholds.
- [ ] Add guided provider UI, browser proof, and listing-readiness packet.

## Milestone 7: Docs, Screenshots, And Release Proof

**Purpose:** Prove 0.10 behavior end to end and keep public/internal docs in
sync with what actually shipped.

- [ ] Update public docs only for behavior that is implemented and proven.
- [ ] Capture fresh screenshots for every changed owner-facing surface.
- [ ] Keep internal plans/specs aligned with what the code now does.
- [ ] Run browser proof for bounded chat, then for the later 0.10 lanes that
  add new owner-facing surfaces.
