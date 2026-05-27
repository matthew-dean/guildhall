---
title: Request intake and thread-routed actions
---

# Request intake and thread-routed actions

**Status:** `0.8.0` exploration candidate

**Release scope:** use
`internal/plans/2026-05-24-guildhall-0-8-mvp-tracker.md` as the current 0.8.0
MVP source of truth. This spec preserves broader design context; candidate
slices not named in the tracker are deferred to 0.9.0 or later.

Guildhall should replace the narrow **New task** affordance with **New request**:
one plain-language entry point where a user can say what they want, and Guildhall
decides which product flow should handle it.

This is not chat. The user is not opening an open-ended conversation and hoping
the assistant remembers what to do. A request is a durable input that can become
one or more routed actions: a task brief, a deep spec intake, a codebase answer,
a settings adjustment, a persona proposal, a practice proposal, a blocker
repair, or another structured Guildhall workflow.

The Thread then becomes the visible action log: a mostly chronological view of
requests, decisions, questions, cards, tool-backed actions, and outcomes.
Dedicated routes can still exist, but they should increasingly render the same
underlying action/card records through more focused lenses.

Important storage boundary: full Thread history is metadata **about** a project,
not project data **inside** the project. The project should keep enough durable
`.guildhall` assets to reconstruct a minimum useful Thread from recent recorded
project actions, but the detailed scrollback/audit history belongs in the user's
Guildhall system metadata, keyed to the project.

## Product Goal

The user should not need to know which Guildhall button maps to their intent.
They should be able to type:

- "Add dark mode to the dashboard."
- "Ask me everything you need to know before we build the book editor."
- "Why is this project still blocked on `useAuth.ts`?"
- "Make the coordinator more conservative about splitting tasks."
- "Create a persona for reviewing public docs copy."
- "Turn these three ideas into separate requests."

Guildhall should split, classify, route, and process those requests into the
right flows without pretending the product is a chat app.

## Non-Goals

- Do not replace Guildhall with a chatbot.
- Do not make the Thread an infinite transcript with no product structure.
- Do not hide real state transitions behind assistant prose.
- Do not force every request through deep spec intake.
- Do not assume every sentence becomes a task.
- Do not make users understand internal task statuses, artifact IDs, or agent
  implementation details before submitting a request.
- Do not make old cards disappear just because they are outside the current
  rendered buffer.

## Core Vocabulary

### Request

A **request** is the raw thing the user asks for. It may contain one action or
several actions. It is stored as the user wrote it, with metadata for source,
time, project, and any target context such as the current route or selected task.

### Routed Action

A **routed action** is Guildhall's interpretation of one processable unit inside
a request. One request can produce many routed actions.

Examples:

- "Build the settings UI and update docs" becomes two routed actions: one
  implementation/spec action and one documentation action.
- "Why is FLL blocked on `useAuth.ts`?" becomes a codebase/status question.
- "Create a Copywriter persona" becomes a persona proposal flow.
- "Make the worker more cautious globally" becomes a settings/lever candidate,
  probably with a confirmation card.
- "FLL is blocked on unapplied migrations" becomes a guided operational
  unblocker, not a failed task.

### Thread Card

A **thread card** is a renderable action surface backed by a durable record. A
card can appear in the Thread, a route-specific view, a drawer, or a search
result. It is not owned by the page that happens to display it.

### Action Instance

An **action instance** is one rendering of a thread card. If the canonical card is
far outside the rendered Thread buffer, Guildhall may create a temporary nearby
instance that points back to the same durable action record.

## User Experience Contract

### Primary Affordance

Replace **New task** with **New request**.

The input should be deliberately broad:

- label: `New request`;
- placeholder examples should rotate or be short, not dense;
- submit action should say `Send request` or simply use the primary action icon
  when space is tight;
- the input should be reachable from top-level project views and the Thread;
- route context should travel with the request, but the user should not need to
  pick a request type first.

The UI should not ask "what kind of thing is this?" up front unless the intake
agent cannot safely infer it.

### Immediate Feedback

After submission, the Thread should show a request card immediately:

1. raw request text;
2. intake status such as `Sorting this out`;
3. current route/context where the request was submitted;
4. a subtle affordance to edit/cancel while intake has not committed actions.

The user should see the request become real before any model call finishes.

### Split Preview

If intake finds multiple requests, it should create a split preview card:

- title: `I found 3 requests`;
- each proposed split has a short label, one-sentence meaning, and route;
- user can approve all, edit one, merge two, delete one, or ask Guildhall to
  reconsider;
- if the splits are obvious and low-risk, Guildhall may queue them while still
  showing the split card as evidence.

Splitting should be conservative. The intake agent should not fragment a single
cohesive feature just because it contains multiple sentences. It should split
when independent outcomes, different routes, or different owners would otherwise
be tangled.

## Intake Agent Responsibilities

The intake agent is not the coordinator. Its job is to turn plain language into
clear routed actions and hand them to the right workflow.

Responsibilities:

1. Preserve the raw request exactly.
2. Decide whether the request contains one or many processable units.
3. Split only when doing so improves execution or review.
4. Classify each unit by route/action type.
5. Detect whether an existing card/action already represents this work.
6. Choose whether to update, reopen, scroll to, or create a new action.
7. Ask one focused clarification only when routing would otherwise be unsafe.
8. Queue routed actions for sequential or concurrent processing.
9. Record the evidence for the routing decision.

The intake agent should be good at triage, but not expensive by default. It can
use a cheaper model for obvious routing and escalate to a stronger model when:

- the request contains several ambiguous clauses;
- the target project has similar existing work;
- the request may change global settings or persistent personas/practices;
- the split decision affects user trust or work cost;
- the request asks a codebase question requiring Corpus Map or tool inspection.

## Request Splitting Decision Tree

```text
User submits request
  |
  |-- Is the text empty or only acknowledgement/noise?
  |     -> show inline validation; do not create a request
  |
  |-- Does it clearly refer to an existing visible/known action?
  |     -> route to existing card; append the new instruction as a request event
  |
  |-- Does it contain multiple independent outcomes?
  |     |-- no
  |     |    -> create one routed action
  |     |
  |     |-- yes
  |          -> split candidates
  |          -> check whether outcomes share the same flow and acceptance criteria
  |          |    |-- tightly coupled
  |          |    |    -> keep as one action with sub-goals
  |          |    |
  |          |    |-- independently executable or different routes
  |          |         -> create multiple routed actions
  |
  |-- Would the split surprise a reasonable user?
  |     -> show split preview before committing work
  |
  |-- Are any actions destructive, global, costly, or privacy-sensitive?
        -> require confirmation card before execution
```

### Split Heuristics

Split when:

- clauses have different verbs and different deliverables;
- one part is a question and another part is a build request;
- one part changes settings/personas/practices and another creates project work;
- one part is documentation and another is runtime implementation;
- one part targets another project/workspace;
- one part can run now while another needs user input.

Do not split when:

- the request describes one feature with natural substeps;
- acceptance criteria depend on the pieces landing together;
- the user phrases examples, constraints, or rationale as separate sentences;
- splitting would create tiny bookkeeping tasks with no independent value.

## Routing Decision Tree

```text
Routed action candidate
  |
  |-- Is the user asking for information?
  |     -> Codebase/project question flow
  |        - use Corpus Map first
  |        - inspect source/status/tools when needed
  |        - answer in Thread with citations/evidence
  |
  |-- Is the user asking to change code/docs/assets?
  |     -> Task/spec flow
  |        - if small and well-defined: task brief
  |        - if product/architecture/user-flow risk: deep spec intake
  |        - if insufficient context: clarification card
  |
  |-- Is the user asking to shape a large idea?
  |     -> Deep intake Practice
  |        - ask structured questions
  |        - create product brief/spec/action plan
  |
  |-- Is the user asking to change Guildhall behavior?
  |     -> Settings/lever flow
  |        - classify project vs global
  |        - show current value and proposed value
  |        - ask confirmation for durable changes
  |
  |-- Is the user asking for a new persona or practice?
  |     -> Persona/practice proposal flow
  |        - draft proposal
  |        - run Persona Designer or Practice Designer review
  |        - require approval before activation
  |
  |-- Is the user reporting broken/stale state?
  |     -> Repair/triage flow
  |        - inspect existing tasks/cards/artifacts
  |        - propose repair or auto-repair if safe
  |
  |-- Is the action ambiguous?
        -> ask one focused routing question in Thread
```

## Tool-Backed Processing

The intake agent should not route from vibes alone. It should receive a catalog
of available tool-backed actions and enough metadata to choose among them.

Each action/tool definition should expose:

- plain-language purpose;
- input schema;
- route/card type it creates or updates;
- safety level: read-only, project-write, global-write, external-write;
- whether it can run concurrently;
- whether it requires user confirmation;
- whether it can target an existing card;
- examples of requests it should handle;
- examples it should decline or escalate.

Example catalog entries:

```yaml
- id: task.create
  label: Create task brief
  purpose: Turn a well-scoped implementation request into a task record.
  safety: project-write
  createsCard: task-brief
  confirmation: when acceptance criteria are inferred from weak context

- id: spec.deep_intake.start
  label: Start deep spec intake
  purpose: Interview the user and project context before creating a larger spec.
  safety: project-write
  createsCard: spec-intake
  confirmation: false

- id: project.question.answer
  label: Answer project question
  purpose: Use status, Corpus Map, and source inspection to answer a project question.
  safety: read-only
  createsCard: answer
  confirmation: false

- id: settings.propose_change
  label: Propose settings change
  purpose: Show current setting, proposed value, scope, and consequences.
  safety: project-write-or-global-write
  createsCard: settings-proposal
  confirmation: true

- id: persona.propose
  label: Propose persona
  purpose: Draft a new persona and route it through review before activation.
  safety: project-write-or-global-write
  createsCard: persona-proposal
  confirmation: true
```

## Guided Operational Unblockers

Some routed actions are not ordinary code tasks. They are operational blockers
where the user, their hosting provider, or an external service must perform a
step that Guildhall cannot safely complete by itself. The product failure mode
to avoid is "blocked because migrations are not run" with no practical help.

When Guildhall sees a blocker such as an unapplied migration, missing Supabase
link, Vercel environment variable, GitHub secret, failed deployment, or required
CI rerun, it should route to a guided operational unblocker card.

The contract is:

1. Inspect first. Check repo scripts, migration folders, provider config,
   `.github/workflows`, docs, existing task notes, and project memory before
   asking the user what to do.
2. Identify the fastest safe path and any safer alternate paths. For a Supabase
   migration, for example, Guildhall might choose between local CLI, linked
   remote CLI, dashboard SQL editor, or an existing GitHub workflow based on
   what the repo actually supports.
3. Show one step at a time with the exact command, dashboard path, required
   environment, expected output, and what could go wrong.
4. Offer action buttons such as `I've done that`, `Show another way`, `This
   failed`, and `I don't have access`.
5. After `I've done that`, verify with available tools when possible. If
   Guildhall cannot verify directly, ask for the smallest proof needed, such as
   pasted command output or a deployment URL.
6. Advance to the next step or mark the blocker cleared only after verification
   or explicit user confirmation.

The card should sound like useful operator help:

> Good news: this is not a code problem. The app is blocked because the remote
> database has not received the pending migration. From this repo, the lowest
> friction path appears to be the Supabase CLI. Do this first...

The generated steps must come from inspected project evidence. Guildhall should
not hard-code a universal Supabase, Vercel, or GitHub Actions recipe and hope it
fits.

Operational unblockers should persist as blocker records with:

- the detected blocker;
- inspected evidence;
- recommended path and alternates;
- each user-performed step;
- verification evidence;
- final cleared/failed/deferred status.

This lets the next agent resume the operational runbook instead of rediscovering
why the project is stuck.

## Thread as the Interaction Spine

The Thread should become less like a Kanban board and more like a chronological
work ledger with rich, reusable cards.

### Chronology

Default ordering should be chronological by request/action event:

- request submitted;
- split proposed or accepted;
- routed action created;
- clarification asked;
- user answered;
- tool/action ran;
- spec/task/settings/persona card updated;
- review/gate outcome recorded.

Project status views can group by state, but the Thread should primarily explain
what happened, in what order, and where the user can act now.

### Shared Card Records

Every meaningful UI surface should prefer rendering a thread card record rather
than owning one-off markup:

- task brief card;
- deep spec intake card;
- question/answer card;
- settings proposal card;
- persona proposal card;
- practice proposal card;
- blocker repair card;
- import review card;
- provider/setup card;
- review/gate evidence card.

Dedicated routes should be lenses over these cards:

- Work shows task/spec cards organized by work state.
- Needs You shows cards that currently need user action.
- Settings can show settings proposal history plus current settings controls.
- Personas/Practices can show active definitions plus proposal cards.
- Thread shows the sequence and can jump to route-specific detail.

### Project Data vs User-System Metadata

Guildhall should draw a hard line between portable project state and local
history.

The default project-owned state root should be `.guildhall/`. A root-level
`memory/` folder is too ambiguous: it looks like generic project content, makes
ownership unclear, and risks surprising teams with large agent-generated diffs.
Existing root `memory/` projects can stay readable through a compatibility
bridge, but new writes should prefer `.guildhall/` unless the user explicitly
configures another location.

Guildhall should treat memory as several different stores, not one pile of
files:

- **Working context:** short-lived context assembled for the current request or
  task. It should be regenerated and is not committed.
- **Semantic project facts:** compact, durable facts, decisions, vocabulary,
  assumptions, blockers, and accepted preferences that workers/reviewers need.
  These belong in project-owned `.guildhall` assets.
- **Procedural memory:** approved practices, personas, levers, and project
  runbooks. These can be project-owned when they are part of how the team wants
  the repo worked on.
- **Episodic history:** chronological thread events, tool traces, card render
  snapshots, and "what happened last time" records. This belongs in
  user-system metadata by default, with compact summaries copied into project
  state only when they matter.
- **Archival logs:** raw transcripts, provider logs, model traces, screenshots,
  and bulky audit material. These should be local/exportable, pinned when
  needed, and not committed by default.

This follows the useful pattern from current agent-memory systems without
copying their storage shape directly: keep a small working set in context,
separate semantic facts from episodic history and procedural skills, retrieve
or compact older material instead of dumping it all into the prompt, and
consolidate raw history into durable facts only when it has earned that
promotion.

Project-owned `.guildhall` assets should keep the durable facts needed for the
project to make sense when moved, cloned, backed up, or opened on another
machine:

- current tasks/specs and their durable statuses;
- active staging/planning state, including intake targets, domain coverage,
  assumptions, deferrals, task splits, and release/feature plans;
- current settings overrides and approved personas/practices;
- recent action summaries needed to render a minimum Thread;
- project decisions, blockers, and evidence that workers/reviewers need;
- pointers to artifacts that belong with the project.

The clone contract is important: if a teammate checks out the same repo on
another machine, they should not have the full local transcript, but they should
not have to intake the project from scratch. Guildhall should be able to
reconstruct the current project shape, active plans, tasks, specs, decisions,
language map, personas/practices, settings, and known blockers from committed
project state unless the team explicitly chose to ignore those files.

Project-owned memory should be boring in PRs. It should prefer structured facts
and compact summaries over raw transcripts:

- keep accepted facts, decisions, definitions, and runbook steps;
- keep provenance pointers to the answer, file, task, command, or review that
  produced the fact;
- keep current blockers and the latest meaningful status;
- keep compact task/release/action summaries when they explain project state;
- avoid committing full conversation scrollback, tool logs, repeated status
  events, render snapshots, or large generated histories by default.

User-system metadata should keep the rich local audit experience:

- full Thread scrollback;
- card render history and temporary action instances;
- routing-decision traces that are useful for audit but not required for project
  portability;
- local UI state such as scroll position, highlights, dismissed transient cards,
  and expanded/collapsed card state;
- high-volume transcripts or tool-level traces that would make project data
  noisy or private beyond the project itself.

The minimum Thread is reconstructed from project-owned action summaries. The
full Thread is an enriched local projection that Guildhall can rebuild or extend
from user-system metadata when available.

To prevent PR bloat, Guildhall should add explicit memory-diff guardrails:

- size budgets for committed `.guildhall` memory files;
- compaction before write when a fact file grows beyond the budget;
- generated/raw history paths ignored by default;
- PR summaries that explain meaningful memory changes in plain language;
- a review warning when a change would commit bulky transcripts, tool traces, or
  many generated memory files;
- a "promote to project memory" action for moving a local lesson into the
  committed project facts after user approval.

### Detailed History Retention

User-system Thread metadata should be bounded per project. "Full history" means
"full within the configured retention window plus pinned audit records," not
"append forever."

Default retention should be generous. Local space is cheaper than lost context,
and Guildhall should not compact useful history just because it is a little old.
The goal is not premature cleanup. The goal is to prevent silent unbounded
growth over a long enough timeline.

Default retention should balance usefulness, privacy, performance, and disk
growth:

- keep the most recent detailed Thread events by count, for example 5,000 events
  per project;
- keep a time window, for example the last 90 days, even if the event count is
  smaller;
- always keep pinned or audit-important records regardless of age;
- compact older unpinned events into summaries before deletion;
- preserve project-owned minimum Thread summaries separately from local detailed
  history retention.

For 0.8.0, these numbers should be treated as product placeholders, not final
limits. A more realistic default may be much larger, such as hundreds of MB per
active project or a year of detailed local history, as long as Guildhall has a
clear ceiling and a visible cleanup path. The important behavior is:

- never let local history grow forever without at least a soft warning;
- prefer lazy compaction after a project exceeds both age and size thresholds;
- preserve exact user requests, user answers, approvals, final specs, blocker
  resolutions, and review/gate outcomes longer than noisy status events;
- keep raw transcripts locally until they become old, huge, or both;
- delete raw local data only after compact summaries and indexes exist, unless
  the user requests immediate cleanup.

Records that should be pin-protected:

- user-approved specs, personas, practices, and global/project setting changes;
- routing decisions the user corrected;
- destructive or irreversible actions;
- review/gate failures and final pass evidence;
- blockers, recovery decisions, and root-cause notes;
- release or publish decisions;
- user-pinned cards.

When detailed history exceeds the cap, Guildhall should compact in layers:

1. merge noisy render/UI events into a card-level summary;
2. merge repeated tool/status events into a run-level summary;
3. preserve exact user requests and user answers when they materially changed
   work;
4. keep links to durable project artifacts;
5. delete only after the compacted summary is written and indexed.

Retention should be configurable globally and overridable per project:

- `detailedHistory.maxEvents`;
- `detailedHistory.maxAgeDays`;
- `detailedHistory.maxStorageMb`;
- `detailedHistory.warnAtStorageMb`;
- `detailedHistory.rawTranscriptMaxAgeDays`;
- `detailedHistory.rawTranscriptMaxStorageMb`;
- `detailedHistory.pinAuditRecords`;
- `detailedHistory.compactionMode`: `conservative`, `balanced`, or `aggressive`.

If a project exceeds storage limits, Guildhall should explain what will be
compacted before doing anything destructive. Routine compaction can run quietly
when it only replaces local detailed events with local summaries and leaves
project-owned minimum Thread records untouched.

The UI should expose local history health without making it feel like chores:

- total local history size per project;
- oldest retained raw transcript;
- pinned audit records;
- what would be compacted next;
- actions for `Compact now`, `Keep more history`, `Export archive`, and
  `Delete local history`.

Deleting local history should never delete committed project state. It should
degrade the project from full local Thread detail to the minimum shared project
history.

## Existing Card Detection

Before creating a new card, intake should search for existing relevant cards:

1. exact task/action ID from context;
2. active cards on the current route;
3. open cards with similar title/target files/settings/persona names;
4. recently completed cards if the request sounds like a follow-up;
5. hidden/buffered cards in local Thread history metadata;
6. project-owned recent action summaries when local metadata is missing.

If a match exists:

- if visible, scroll to it and highlight it;
- if loaded but offscreen, scroll to it and highlight it;
- if outside the rendered buffer, inject a temporary action instance near the
  current position that points to the canonical record;
- if the user is clearly adding new instructions, append an event to the existing
  action instead of creating a duplicate.

The user should never need to hunt through old Thread history to find the card
Guildhall already knows is relevant.

## Rendering Long Threads

Long Threads need virtualization or pagination, but the product contract should
not feel like old evidence vanished.

### Render Window

The live Thread can render:

- a recent chronological window;
- pinned active cards;
- cards that need user action;
- cards targeted by route/hash/search;
- temporary instances for old canonical cards.

Older actions should be discoverable by search, filters, and timeline anchors
when local Thread metadata is available. If the user opens a project without that
metadata, Guildhall should still show the project-owned minimum Thread rather
than pretending the project has no history.

Search should cover compacted summaries as well as detailed events. If the exact
old card was compacted away, Guildhall should show the summary, linked project
artifacts, and any pin-protected records that survived retention.

### Temporary Instances

When the relevant canonical card is outside the render window, Guildhall can
insert an instance near the current position:

- label it subtly as `Earlier action`;
- show enough context to act;
- link to the canonical time position;
- update the same underlying action record;
- collapse/remove the temporary instance once the user navigates away or the
  immediate interaction is complete.

This avoids forcing a user to scroll through thousands of cards while preserving
chronology and auditability.

## Concurrency and Sequencing

Each routed action should declare whether it can run concurrently.

Concurrent by default:

- independent read-only questions;
- separate docs/code tasks in unrelated areas;
- non-conflicting spec intake flows;
- local analysis that does not write project state.

Sequential by default:

- global settings changes;
- persona/practice activation;
- actions writing the same task/spec/card;
- actions requiring a user answer before classification;
- actions whose output becomes input to another action.

The Thread should show multiple in-flight request cards without hiding ownership.
Each card needs a clear status such as `sorting`, `waiting for you`, `inspecting`,
`drafting`, `ready to approve`, `running`, `done`, or `blocked`.

## Data Model Direction

This spec is intentionally not a full storage schema, but the shape should move
toward durable action records with a clear storage boundary.

Minimum records:

- Project `.guildhall` records:
  - `request_summary`: compact request/action summary when it affects durable
    project state;
  - `routed_action`: split/classified unit with route, status, and owner;
  - `thread_card_summary`: enough card payload to render a minimum Thread;
  - `project_action`: recent recorded project action used to reconstruct the
    minimum Thread.
- User-system metadata records:
  - `request_raw`: raw user input and full context;
  - `thread_event`: chronological event for the full local ledger;
  - `thread_card_snapshot`: rich render payload and historical UI state;
  - `action_instance`: optional UI instance pointing at a card;
  - `routing_decision`: detailed evidence for split/classification/reuse
    decisions.

The important invariant: routes render from shared action/card state. They should
not invent separate one-off state machines for the same interaction.

The second invariant: losing local user-system metadata should degrade the Thread
from "full audit scrollback" to "minimum project action history," not break the
project or pollute the project with every UI/audit event.

### Human-Owned YAML

Guildhall should write configuration and project memory YAML as files a person
would not resent editing.

The emitter should use structured YAML serialization, but the output style should
be idiomatic:

- do not quote keys unless YAML requires it;
- do not quote simple strings unless the value would be ambiguous;
- use stable field order so diffs are readable;
- prefer block strings for multiline prose;
- keep comments/provenance concise and attached to the relevant field;
- avoid rewriting the whole file when only one fact changed.

Tests should cover representative `guildhall.yaml`, practice, persona, language
map, and memory outputs so over-quoting does not silently come back.

## Safety and Confirmation Rules

The intake agent may route read-only actions immediately. It should ask for
confirmation before:

- global settings changes;
- project settings that alter future agent behavior broadly;
- activating personas or practices;
- deleting, shelving, or merging durable work;
- starting expensive/high-token work when the request is ambiguous;
- running tools with external effects;
- making irreversible edits.

Confirmation cards should say what will change, where it applies, why Guildhall
thinks this is the right route, and what the alternatives are.

## Relationship to Practices and Personas

This spec depends on the 0.8.0 Practices/personas direction.

Requests like "ask me everything you need to know" should route to a deep-intake
Practice. Requests like "create a copy editor persona" should route to a persona
proposal card. The intake agent should not implement every behavior itself; it
should recognize the request, choose the right flow, and hand off with evidence.

The intake agent should also learn from repeated routing corrections. If the user
repeatedly changes the same split/routing decision, Guildhall can propose a
project or global lever such as "Prefer one cohesive product request unless the
user explicitly asks for separate tasks."

## UI Principles

- One box starts the work, but the result is structured UI.
- Cards should explain the current state, not expose internal status names.
- The user should see why Guildhall split or routed a request.
- Existing work should be reused before new cards are created.
- The Thread should be chronological first, state-grouped only where a route
  needs it.
- Needs You should be a filtered view over action cards, not a separate world.
- Route-specific views should add focus, not duplicate state.
- Long history should be searchable and re-instantiable without forcing massive
  scrollback.

## Acceptance Criteria

- The primary project action reads **New request**, not **New task**.
- A freeform request can be submitted without choosing a type first.
- The request appears immediately in Thread as a durable request card.
- Intake can classify at least these action types: task/spec, codebase question,
  settings proposal, persona/practice proposal, repair/triage, and clarification.
- A multi-intent request can be split into individual routed actions with a
  reviewable split decision.
- Existing relevant cards are found and reused before duplicates are created.
- Needs You, Work, Settings, and Thread can render the same underlying card record
  through different lenses.
- Long Thread history supports old-card access from user-system metadata without
  rendering the entire history at once.
- Project data can reconstruct a minimum useful Thread even when full local
  Thread metadata is unavailable.
- Project memory defaults to `.guildhall/`, separates committed facts from local
  episodic history, and warns before committing bulky generated history.
- A clean clone with committed Guildhall project state can resume current
  staging, planning, tasks, specs, decisions, and settings without repeating
  project intake from scratch.
- Operational blockers can become guided unblocker cards with inspected
  project-specific steps, user confirmation buttons, and verification state.
- Generated `guildhall.yaml` and related YAML files are minimally quoted,
  stable, and comfortable to review by hand.
- Global or durable behavior changes require confirmation.
- Routing decisions leave enough evidence for review and future learning.

## Open Design Questions

- Should split preview be mandatory for all multi-action requests in 0.8.0, or
  can obvious splits auto-queue with an undo affordance?
- What is the first minimal set of card renderer types?
- What exact fields belong in project-owned action summaries versus local
  user-system Thread metadata?
- How much of request routing can run locally/cheaply before using a stronger
  model?
- How should active cards be pinned when chronology would otherwise move them
  out of view?
- What is the right UI for comparing duplicate/similar cards before reusing one?
- Should "New request" be project-scoped only at first, or can it route across
  registered projects?

## Suggested Implementation Slices

1. Rename the product affordance from **New task** to **New request** and route
   submissions through a new request-intake endpoint without changing downstream
   task creation yet.
2. Add durable request and routed-action records, plus Thread request cards.
3. Implement single-request classification for task/spec vs question vs
   settings/persona/practice/repair.
4. Add multi-request splitting with split preview.
5. Add existing-card detection and scroll/highlight behavior.
6. Move Needs You and Work toward shared thread-card records.
7. Add long-thread virtualization plus temporary action instances.
8. Add learning from repeated routing corrections.
