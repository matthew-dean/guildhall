# Guildhall 0.9.0 Memory System Plan

**Status:** proposed 0.9.0 direction
**Owner:** future Guildhall release planning
**Depends on:** 0.8.0 pressure-test intake, task state boundary, MCP server bridge first slice, and the persistence-system boundary direction.
**Related sources:**

- `internal/plans/archive/2026-05-24-guildhall-0-9-task-shaping-and-finishability.md`
- `internal/plans/archive/2026-05-24-guildhall-mcp-server-bridge.md`
- `internal/specs/guildhall-mcp-server-contract.md`
- `internal/design-notes/archive/persistence-system-boundary.md`
- `docs/reference/memory-layout.md`
- `docs/reference/agent-settings.md`

## Thesis

Guildhall 0.9.0 should make memory a product capability, not a pile of saved
files.

The owner-facing story should be:

> Guildhall gets better as it works with you. It remembers what it learned about
> this project, what it learned about your preferences, what evidence backs that
> up, and which parts of that memory are actively shaping agent behavior.

This needs to be at least as strong as the best self-improving agent story in
the market: not because Guildhall claims mystical continuity, but because it can
show the chain from work to learning to future behavior.

The product standard is simple:

1. Guildhall records useful learning opportunities while work happens.
2. It keeps proposed memory inert until the owner accepts it or policy allows it.
3. Accepted memory becomes part of future agent context.
4. Every durable memory has provenance and evidence links.
5. The UI and MCP can both answer, "What do you know, why do you know it, and
   where is it used?"

## Current Gap

Guildhall already stores a lot of project state:

- project briefs;
- workspace goals;
- tasks and task archives;
- progress summaries;
- decision logs;
- codebase maps;
- context-debug snapshots;
- local transcripts and event streams;
- project/global learning files.

But the current system does not yet make a strong memory story.

The major gaps are:

- `.guildhall/learning.json` and `~/.guildhall/learning.json` can hold useful
  suggestions, but accepted learnings are not clearly injected into agent
  context as first-class memory.
- The Settings Guidance tab can show some durable context, but it is not the
  same as "what the next agent will actually see."
- The MCP server exposes compact memory and artifacts, but not the full memory
  system: project brief, goals, learning records, evidence availability,
  context-debug health, codebase-map guidance, or effective handoff context.
- Recording is opportunistic. Repeated corrections, recovery playbooks, and
  workspace-import approvals can create learning records, but ordinary completed
  work does not consistently produce candidate memories.
- Retrieval is primitive. `MEMORY.md` and decisions are selected with bounded
  keyword/domain matching, which can miss cross-domain habits, user preferences,
  and vocabulary drift.
- Some compact project memories are stale or thin, while large useful context
  sits in progress logs, task state, local history, and codebase maps.

## Product Contract

Guildhall memory should be explicit about five states.

### Observed

Guildhall noticed something in a task, correction, review, import choice,
recovery run, or project scan.

Observed facts can be noisy. They are evidence, not guidance.

### Proposed

Guildhall thinks the observation may be reusable.

Proposed memory stays inert unless policy says it is safe to use automatically.
The owner can accept, dismiss, edit, or make it project-wide/global.

### Active

The memory is allowed to shape future work.

Active memory must be visible in Settings and MCP, and must appear in the
effective context packet when relevant.

### Used

An agent actually received or relied on the memory.

Guildhall records where the memory was injected, which task used it, and whether
it helped or caused a correction.

### Retired

The memory is stale, contradicted, superseded, or scoped too broadly.

Retired memory should remain auditable but should not shape future agent
behavior.

## Memory Types

### Project Facts

Stable facts about this project.

Examples:

- product purpose;
- repository layout;
- build/test commands;
- current runtime assumptions;
- important external systems;
- project-specific vocabulary;
- canonical docs/specs.

### Project Habits

Reusable repo-specific ways of working.

Examples:

- for docs navigation work, browser-verify published version paths;
- for public docs, write like a human reader is trying to decide what to do;
- for Stripe flows, distinguish local env credentials from dashboard/provider
  setup;
- for UI changes, end with browser verification, not just tests.

### User Preferences

Cross-project guidance about how the owner wants work done.

Examples:

- prefer evidence-backed answers over speculation;
- preserve pushed branch history;
- answer Jira keys in plain English;
- keep public copy warm, specific, and non-PRD-like;
- when a review thread is fixed, reply and resolve it.

### Project Skills

Reusable playbooks that can change how agents perform work.

Examples:

- "docs navigation snapshot repair";
- "browser-first Guildhall UI proof";
- "Stripe local proof path";
- "task completion handoff with proof path."

### Codebase Knowledge

Discovered knowledge about architecture, entrypoints, dependency direction,
commands, design-system evidence, and risky areas.

Codebase knowledge should be queryable separately from prose memory because it
needs freshness, stale markers, and source-file evidence.

### Product Improvement Ideas

Ideas Guildhall learns about itself.

These are not active project/user memory. They become product backlog candidates
with evidence, scope, and risk.

## Proposed Architecture

### Memory Store

Create a `MemoryStore` domain facade on top of the planned persistence boundary.

It should own:

- `MemoryObservation`;
- `MemoryCandidate`;
- `ActiveMemory`;
- `MemoryUseRecord`;
- `MemoryRetirement`;
- evidence refs;
- scope and placement policy;
- rendered compatibility files.

Rendered files can remain:

- `.guildhall/MEMORY.md`;
- `.guildhall/learning.json`;
- `.guildhall/project-skills.json`;
- `~/.guildhall/learning.json`.

But runtime code should read and write through `MemoryStore`, not through ad hoc
file paths.

### Evidence Model

Every candidate and active memory should carry:

- source task ids;
- transcript refs when available;
- context-debug snapshot refs when relevant;
- artifact ids;
- changed file refs when relevant;
- creator identity;
- created/updated timestamps;
- confidence;
- risk;
- scope;
- lifecycle state.

If local evidence is compacted or deleted, Guildhall should keep the memory but
mark the full evidence as unavailable.

### Effective Memory Packet

Add a first-class effective memory packet.

It should answer:

- what memory is available;
- what memory is relevant to this task;
- what was injected;
- what was withheld and why;
- how many chars each section consumed;
- which evidence backs each injected item;
- whether context is thin, stale, too large, or missing role guidance.

The effective memory packet should power:

- agent prompts;
- Settings Guidance;
- Task Drawer/Journey context audit;
- MCP resources;
- context-debug snapshots.

### Retrieval

Start with deterministic retrieval that is better than current keyword matching:

- scope filters: project, domain, user-global, task type, file area;
- tags and destination: project fact, project habit, user preference, skill,
  codebase knowledge;
- recency and freshness;
- confidence and risk;
- explicit applicability rules;
- source evidence quality.

Then add semantic retrieval as an optional second pass once the deterministic
packet is stable.

The packet must remain bounded and explainable. "The vector search found it" is
not enough; Guildhall should say why a memory was included.

## Agent Handoff Changes

### Build Context From Active Memory

`buildContext` should include active project and user memory as named sections,
not only selected `MEMORY.md` prose.

Suggested sections:

- `Relevant Project Facts`;
- `Relevant Project Habits`;
- `Relevant User Preferences`;
- `Relevant Project Skills`;
- `Relevant Codebase Knowledge`;
- `Memory Evidence Notes`.

Each section should be bounded and should identify source refs where useful.

### Record Memory Use

Whenever active memory is injected, record a `MemoryUseRecord`:

- task id;
- agent role;
- memory ids included;
- memory ids withheld;
- reason codes;
- context-debug snapshot id;
- prompt size impact.

If the owner corrects the agent, Guildhall can connect that correction back to
the memories used in the failed handoff.

### Learn From Completion

At task completion, generate memory candidates from:

- repeated touched files and commands;
- proof paths;
- project-specific verification rules;
- review corrections;
- recovery playbooks;
- user corrections;
- external setup blockers;
- differences between planned and actual implementation;
- "this task succeeded only after X" patterns.

Do not auto-activate broad preferences. Do auto-record observations.

### Learn From Corrections

Repeated owner corrections should become visible candidates quickly.

The correction flow should ask:

- Is this a one-off correction?
- Should this apply to this project?
- Should this apply across projects?
- Should this become a project skill/playbook?

The answer should create or update a candidate with evidence links.

## UI Changes

### Settings: Guidance Becomes Memory Control

Settings should show four columns of memory state:

- What Guildhall knows about this project.
- What Guildhall has learned about how you like work done.
- Proposed memories waiting for approval.
- Memories that shaped recent agent work.

Each memory item should show:

- state: observed, proposed, active, used, retired;
- scope: project, domain, user-global;
- source evidence;
- last used;
- confidence/risk;
- actions: accept, edit, narrow scope, make global, retire, open evidence.

### Task Drawer: Why The Agent Knew That

Task Drawer should show a "Context used" section:

- project facts injected;
- user preferences injected;
- project habits injected;
- codebase map entries injected;
- missing or stale context warnings.

This should be a debug-friendly surface, but still readable by an owner.

### Project Overview: Memory Health

Project Overview should include memory health:

- project brief present/stale;
- active project facts count;
- active project habits count;
- active user preferences count;
- latest successful context-debug packet;
- thin-context warnings;
- evidence availability.

This should not dominate the page. It is a confidence signal.

### Inbox: Memory Review

When Guildhall finds high-confidence candidates, show them as small review
cards:

- "Remember this for this project?"
- "Use this across projects?"
- "Turn this into a project playbook?"
- "Dismiss as one-off."

## MCP Changes

The MCP server must be able to answer the memory audit without shell fallback.

### Expand Existing Resources

#### `guildhall://project`

Include a bounded project overview with:

- project brief summary;
- workspace goals count and top goals;
- active task count;
- memory health summary;
- codebase-map freshness;
- latest context-debug health.

#### `guildhall://project/memory`

Change this from "read `MEMORY.md`" to "read the compact memory system."

Include:

- compact `MEMORY.md` sections;
- project brief status;
- project facts summary;
- active project habits;
- active user preferences relevant to this project;
- proposed memory counts;
- retired/stale counts;
- evidence availability summary.

Keep the old `MEMORY.md` body as a subsection for compatibility.

#### `guildhall://project/tasks/<task-id>`

Add memory context fields:

- memory used by the latest handoff;
- memory candidates produced by the task;
- context-debug snapshot refs;
- proof/evidence refs.

### Add New Resources

#### `guildhall://project/learning`

Machine-readable and Markdown-readable learning state:

- project learning records;
- global user learning records relevant to this project;
- proposed/active/retired status;
- evidence refs;
- approval state;
- last used.

#### `guildhall://project/context`

Latest effective context packet summary:

- sections included;
- section sizes;
- memory ids injected;
- withheld memory ids and reasons;
- context health warnings;
- latest snapshot path/ref;
- prompt size.

Default to summary. Provide a tool-mediated way to read a specific snapshot when
safe.

#### `guildhall://project/local-history`

Index only, not raw transcript dumps:

- recent task ids;
- available transcripts;
- context-debug snapshots;
- event streams;
- proof artifacts;
- compaction status;
- local evidence availability.

#### `guildhall://project/codebase-knowledge`

Bounded codebase-map and semantic knowledge:

- summary;
- architecture areas;
- canonical files;
- current truth;
- read-next suggestions;
- worker guidance;
- stale/fresh status.

### Add Or Extend Tools

#### `guildhall.read_memory`

Reads a memory record by id, with optional evidence summary.

#### `guildhall.list_memory`

Filters memory by scope, status, type, domain, tags, and relevance to a task.

#### `guildhall.record_memory_observation`

Lets an agent record an observation without activating it.

Required fields:

- summary;
- scope proposal;
- memory type;
- task id when available;
- evidence refs;
- confidence;
- risk;
- suggested destination.

#### `guildhall.propose_memory`

Promotes an observation into a proposed reusable memory.

#### `guildhall.update_memory_status`

Accepts, dismisses, narrows, globalizes, or retires a memory record.

This should be owner-confirmed unless the action is policy-safe.

#### `guildhall.read_effective_context`

Returns the effective context packet for a task or the latest handoff.

Default output should be bounded and redacted. Raw prompt snapshots should remain
local/private and require explicit safe access.

### MCP Acceptance Criteria

- An external agent can answer "what does Guildhall know about this project?"
  from MCP alone.
- An external agent can answer "what does Guildhall know about the owner?"
  from MCP alone, bounded to approved/active user preferences.
- An external agent can answer "what memory shaped the last worker handoff?"
  from MCP alone.
- An external agent can answer "what evidence backs this memory?"
  from MCP alone, with honest unavailable-evidence states.
- MCP never exposes API keys, provider config secrets, raw private transcripts,
  or unbounded prompt dumps by default.

## Persistence And Privacy

Memory placement should follow the persistence boundary:

- shared project memory: committed `.guildhall` state;
- local evidence: `~/.guildhall/data/projects/<project-hash>/`;
- user-global preferences: `~/.guildhall/learning.json` or successor global
  memory store;
- exports: explicit user-selected artifacts.

Privacy rules:

- raw transcripts are local/private by default;
- cross-project user preferences require explicit approval before activation;
- memory records can quote concise evidence summaries, but should avoid dumping
  private raw content;
- MCP summaries are bounded and redacted by default;
- every cross-scope promotion should show what changes about visibility.

## 0.9.0 Workstreams

### Workstream 1: Memory Inventory And Schema

- Inventory current memory-ish stores and write paths.
- Define memory lifecycle states.
- Define memory record schemas.
- Define evidence refs and availability states.
- Add migration/read adapters for existing `.guildhall/learning.json`,
  `MEMORY.md`, `project-skills.json`, and global learning.

Exit criteria:

- Existing files can be read through `MemoryStore`.
- No active memory state is lost.
- Tests cover old-file compatibility.

### Workstream 2: Effective Memory Packet

- Build deterministic retrieval for project/user/codebase memory.
- Add active memory sections to agent context.
- Record `MemoryUseRecord` on handoff.
- Connect context-debug records to memory ids.
- Add tests proving accepted project/global memories appear in `buildContext`.

Exit criteria:

- Agent context shows active memory explicitly.
- Context-debug can prove what memory was injected.
- Thin/stale/oversized context warnings include memory-specific causes.

### Workstream 3: Memory Capture

- Generate observations from task completion.
- Generate candidates from repeated corrections.
- Generate candidates from recovery playbooks and review misses.
- Generate product-improvement ideas separately from active project/user memory.
- Add owner review actions.

Exit criteria:

- Completed tasks can produce evidence-linked memory candidates.
- User corrections become visible candidates within a small number of repeats.
- Proposed memories remain inert until accepted.

### Workstream 4: Memory UI

- Upgrade Settings Guidance into a memory control surface.
- Add Task Drawer "Context used."
- Add Project Overview memory health.
- Add Inbox memory review cards.
- Add evidence drill-ins.

Exit criteria:

- Owner can see what Guildhall knows, what is proposed, what is active, and what
  shaped recent work.
- Owner can accept, edit, narrow, globalize, retire, or dismiss memory.

### Workstream 5: MCP Memory Surface

- Expand `guildhall://project` and `guildhall://project/memory`.
- Add `guildhall://project/learning`.
- Add `guildhall://project/context`.
- Add `guildhall://project/local-history`.
- Add `guildhall://project/codebase-knowledge`.
- Add memory read/list/record/update tools.
- Add MCP smoke tests that answer the memory audit without shell fallback.

Exit criteria:

- MCP can answer the memory audit directly.
- MCP output is bounded, redacted, and evidence-linked.
- MCP mutation tools write visible audit records.

### Workstream 6: Self-Improvement Loop

- Track which memories improve outcomes.
- Track corrections after memory use.
- Detect stale or harmful memory.
- Suggest retiring/narrowing memory when it causes misses.
- Convert recurring successful patterns into project skills.
- Convert product-level friction into Guildhall improvement candidates.

Exit criteria:

- Guildhall can say not only "I remembered this," but "this memory helped" or
  "this memory caused friction and should be narrowed."

## Test Strategy

### Unit Tests

- Memory lifecycle transitions.
- Evidence refs and local-history availability.
- Active memory retrieval.
- Scope filtering.
- Redaction/bounding.
- Old-file compatibility.

### Integration Tests

- Accepted project memory appears in `buildContext`.
- Accepted global user preference appears in `buildContext`.
- Proposed memory does not appear in `buildContext`.
- Memory use writes context-debug refs.
- Completed task produces candidate observations.
- User correction creates proposed global preference only after threshold.

### MCP Tests

- `guildhall://project/memory` includes project brief, active memory, proposed
  counts, and evidence availability.
- `guildhall://project/context` includes latest handoff section stats and memory
  ids.
- `guildhall://project/learning` can be filtered by scope/status/type.
- MCP tools cannot read raw private snapshots by default.
- MCP mutation tools append task evidence/audit entries.

### Browser Tests

- Settings Guidance shows active/proposed/used/retired memory.
- Task Drawer shows context used.
- Inbox memory review actions work.
- Project Overview shows memory health.

## Release Acceptance Criteria

Guildhall 0.9.0 should not claim the memory story unless these are true:

- A new agent can ask MCP what Guildhall knows about the project and get a useful
  answer without shell access.
- A new agent can ask MCP what Guildhall knows about the owner and see approved
  active preferences, not private raw logs.
- The owner can see and control proposed reusable memories.
- Accepted memories actually shape future agent context.
- Context-debug proves what memory was injected into at least the latest worker
  handoff.
- Memory records link back to evidence or honestly say full evidence is
  unavailable.
- Guildhall can generate at least one useful memory candidate from completed
  work, repeated correction, or recovery.
- Stale memory can be retired without deleting its audit trail.

## Non-Goals For 0.9.0

- Do not build a general-purpose personal knowledge graph.
- Do not expose raw transcripts through MCP by default.
- Do not auto-activate broad cross-project preferences.
- Do not make semantic/vector retrieval the only way memory works.
- Do not turn every task note into permanent memory.
- Do not require committed project state to contain private local evidence.

## Open Questions

- Should active user-global memory require explicit per-project opt-in, or should
  approved global preferences apply everywhere by default?
- What memory types are safe to auto-activate for a single project?
- Should memory editing be freeform Markdown, structured fields, or both?
- How much of the effective prompt can MCP expose safely?
- Should memory health block task launch when context is thin or stale, or only
  warn?
- What is the first real project to use as the 0.9.0 memory proving ground?
