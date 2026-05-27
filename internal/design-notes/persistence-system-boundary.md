---
title: Persistence system boundary
---

# Persistence system boundary

Date: 2026-05-25

## Status

Draft architectural guardrail and 0.9.0+ migration shape.

## Thesis

Guildhall should have one persistence system. Anything that stores durable state
or evidence should go through that system, whether the bytes eventually land in
YAML, JSON, JSONL, Markdown, SQLite, object storage, local history, or committed
project state.

The storage backend is an implementation detail. The product contract is:

- writes are schema-validated;
- writes have provenance;
- records know whether they are shared project state or local/private history;
- compact records preserve source references;
- compaction and retention are consistent;
- MCP, CLI, UI, and agents read through the same conceptual model;
- deleting or compacting local evidence produces an honest "full evidence
  unavailable" state instead of silently breaking auditability.

## Scope

This applies to every durable write path:

- task state;
- task evidence;
- review verdicts;
- review plans;
- reviewer runs;
- calibration and frontier reports;
- logs and event streams;
- memory;
- decisions;
- artifacts;
- rich artifacts;
- lever settings;
- project facts;
- practices and learned preferences;
- archives and compaction summaries;
- checkpoints and recovery records.

Docs and hand-authored internal planning notes can still be normal Markdown
files. Runtime code, generated evidence, and agent/tool writes should not invent
their own persistence paths.

## Required boundary

Add a central persistence package, module, or service that owns durable file
storage policy. It may expose domain-specific facades, but those facades must be
implemented on top of the same persistence boundary.

Suggested shape:

```ts
interface GuildhallPersistence {
  writeRecord<T>(input: WriteRecordInput<T>): Promise<PersistedRecord<T>>
  appendEvent<T>(input: AppendEventInput<T>): Promise<PersistedEvent<T>>
  readRecord<T>(ref: PersistenceRef): Promise<PersistedRecord<T> | null>
  listEvents<T>(query: EventQuery): Promise<Array<PersistedEvent<T>>>
  saveArtifact(input: SaveArtifactInput): Promise<ArtifactRef>
  compact(scope: CompactionScope): Promise<CompactionSummary>
  resolveEvidence(ref: EvidenceRef): Promise<EvidenceResolution>
}
```

Domain services should be thin:

- `TaskStateStore`;
- `TaskEvidenceStore`;
- `ReviewAuditStore`;
- `ArtifactStore`;
- `LeverStore`;
- `MemoryStore`;
- `DecisionStore`.
- `ConfigStore`;
- `TranscriptStore`;
- `CheckpointStore`;
- `CorpusMapStore`;
- `DesignSystemStore`;
- `SkillStore`;

Those services can provide ergonomic domain methods, but they should not decide
storage paths independently.

## Existing persistence consumers

The current codebase already has many useful stores and helpers, but the write
policy is spread across them. The 0.9.0+ goal is not to delete every domain
store. It is to make every domain store delegate placement, provenance,
compaction, evidence refs, and backend writes to one persistence system.

Known consumer families:

| Consumer family | Examples | Retool target |
|---|---|---|
| Task queue and task updates | `TASKS.json`, proposal/update/question/escalation tools, gate tool writes | `TaskStateStore` backed by `GuildhallPersistence` |
| Task evidence | review verdicts, gate results, adjudications, escalations, merge records | `TaskEvidenceStore` event streams backed by `GuildhallPersistence` |
| Review audit | review plans, reviewer runs, frontier reports, escaped misses | `ReviewAuditStore` backed by `GuildhallPersistence` |
| Memory and decisions | `MEMORY.md`, `DECISIONS.md`, `PROGRESS.md`, agent overrides rationale | `MemoryStore` and `DecisionStore` backed by append-event records plus rendered Markdown where needed |
| Logs and runtime events | stream events, debug ledgers, context snapshots, provider traces | `RuntimeEventStore` with local-history placement by default |
| Transcripts and checkpoints | exploring transcripts, resume checkpoints, recovery snapshots | `TranscriptStore` and `CheckpointStore` with local-history placement and compact refs |
| Artifacts | artifact registry, rich artifacts, generated review artifacts, exports | `ArtifactStore` with hashed content and explicit placement |
| Levers and config | agent settings, project config, global config, providers, registry | `ConfigStore` and `LeverStore` with provenance and visibility policy |
| Corpus map and discovery | map summaries, history JSONL, stale markers | `CorpusMapStore` with compact shared summary and local history for refresh events |
| Design system and skills | `.guildhall/design-system.yaml`, project skills/proposals | `DesignSystemStore` and `SkillStore` backed by typed records and rendered editable files |

The rendered files can remain stable for users and Git diffs. What changes is
the ownership: domain stores ask persistence to write, append, compact, and
resolve evidence. They do not build paths or write files directly.

## Placement policy

Every write declares placement:

```yaml
placement:
  scope: shared_project | local_history | global_user | exported_artifact
  retention: active | archive | debug | ephemeral
  visibility: user_visible | internal_audit | private_runtime
  commitPolicy: committed | ignored | user_exported
```

The persistence system maps placement to concrete storage:

- shared compact state under `./.guildhall/`;
- local/private evidence under `~/.guildhall/data/projects/<project-hash>/`;
- machine-global preferences under `~/.guildhall/`;
- explicit exports under user-chosen paths.

Call sites should not build those paths by hand.

## Record requirements

Every durable generated record must include:

- schema name and version;
- record id;
- createdAt and updatedAt when applicable;
- creator identity, such as agent, tool, coordinator, or user;
- source task/run/session ids when applicable;
- placement;
- source refs;
- content hash when the payload is material evidence;
- compaction status when a compact record replaces fuller evidence.

## Migration rule

When adding a new durable feature, first ask:

1. Is there an existing domain store for this record?
2. If yes, does it already delegate to the persistence boundary?
3. If no, add the domain facade on top of the boundary.
4. Do not add direct `fs.writeFile`, `fs.appendFile`, ad hoc `atomicWriteText`,
   or path-building logic in feature code.

Low-level persistence code may use file APIs. Feature code should not.

## 0.9.0+ migration roadmap

The migration should happen in layers so Guildhall can keep shipping while the
boundary becomes real.

### Phase 0: Inventory and guardrail

- Keep an inventory of every runtime write path.
- Classify each write as shared project state, local history, global user state,
  or explicit export.
- Add a static check or test that flags new direct writes under managed
  Guildhall paths outside approved low-level persistence modules.
- Document temporary exceptions with owners and target migration phase.

Exit criteria:

- New feature work has a clear rule: no new ad hoc durable writes.
- The exception list is finite and visible.

### Phase 1: Persistence core

Create the central `GuildhallPersistence` layer with:

- typed record writes;
- append-only event writes;
- artifact writes with content hashes;
- placement policy;
- evidence refs;
- compaction hooks;
- local evidence resolution;
- migration metadata.

Exit criteria:

- A domain store can persist a record without knowing its concrete path.
- Tests prove shared/local/global/export placements land where expected.

### Phase 2: Review audit as first consumer

Implement `ReviewAuditStore` on top of the persistence layer.

Persist:

- review plans;
- review-plan events;
- reviewer runs;
- planning corpus runs;
- frontier reports;
- escaped-miss links.

Exit criteria:

- Review effort ships without adding a parallel storage island.
- Frontier reports and raw reviewer outputs stay local by default, with compact
  task-facing summaries and evidence refs.

### Phase 3: Task state and task evidence

Move task queue writes and task evidence writes behind persistence-backed domain
stores.

Targets:

- proposal, update-task, post-user-question, escalation, product-brief, report
  issue, run-gates, and intake writes;
- task evidence JSONL appenders;
- terminal task archive and compaction records.

Exit criteria:

- Feature code no longer receives raw `tasksPath` as its write authority.
- Existing `TASKS.json` shape can still be rendered for compatibility.
- Compaction consumes typed task/evidence records instead of bespoke task-field
  trimming.

### Phase 4: Memory, decisions, transcripts, and checkpoints

Move Markdown appenders and local transcript/checkpoint writers behind domain
stores.

Targets:

- `MEMORY.md`;
- `DECISIONS.md`;
- `PROGRESS.md`;
- exploring transcripts;
- checkpoints and recovery records;
- agent-setting rationale logs.

Exit criteria:

- Markdown remains available as a rendered human-readable view.
- The underlying append events carry schema, provenance, placement, and evidence
  refs.
- MCP reads can resolve both compact Markdown views and underlying records.

### Phase 5: Artifacts, corpus map, design system, skills, and config

Move specialized stores behind persistence while preserving existing user-facing
files where they are useful.

Targets:

- artifact registry and rich artifact records;
- codebase/corpus map summaries and refresh history;
- `.guildhall/design-system.yaml`;
- project skill proposals/settings;
- project/global config, providers, registry, and lever settings.

Exit criteria:

- Editable YAML/Markdown files remain editable where that is part of the product
  contract.
- Domain stores validate and write through persistence.
- Config and lever changes have consistent provenance and audit records.

### Phase 6: Reader convergence

Once writes are centralized, converge readers.

Targets:

- MCP resources;
- browser UI project APIs;
- CLI inspect/export commands;
- compaction and migration commands;
- agent context builders.

Exit criteria:

- UI, CLI, MCP, and agents read the same compact/full evidence model.
- Missing local evidence is represented consistently everywhere.

### Phase 7: Backend freedom

After domain stores delegate to the persistence boundary, Guildhall can change
backends without feature rewrites.

Possible future backends:

- current file-backed store;
- SQLite for local history indexes;
- object storage for large artifacts;
- encrypted local private history;
- explicit export bundles.

Exit criteria:

- Backend changes happen below the persistence boundary.
- Domain feature code remains unchanged.

## Testing rule

The persistence boundary needs tests that prevent storage sprawl:

- domain facades route writes through the central persistence layer;
- records validate schema and placement;
- compact records keep evidence refs;
- local evidence deletion is represented honestly;
- shared/local/global placement maps to the expected backend;
- feature modules do not directly write managed Guildhall paths.

The last rule can start as import-boundary tests or a static scan over known
runtime directories.

Migration tests should also cover:

- existing files can be read through the new domain stores;
- new writes can render legacy-compatible files when needed;
- round-tripping through compaction preserves audit refs;
- migration commands are idempotent;
- missing local history produces an explicit unavailable state;
- no new managed-path writes appear outside the approved persistence modules.

## Relationship to review effort

Review effort should be the first major consumer of this boundary, not an
exception to it. `ReviewAuditStore` belongs on top of the central persistence
system and should persist:

- review plans;
- review-plan events;
- reviewer runs;
- planning corpus runs;
- frontier reports;
- escaped-miss links;
- compaction summaries.

If adding review effort exposes copy-pasted storage helpers, the implementation
should wrap or remove them before review-plan persistence ships.

## Documentation

Public docs should explain the outcome:

- compact summaries travel with the project;
- large/private run evidence stays local by default;
- Guildhall tells you when full evidence is unavailable;
- exported artifacts are explicit.

Internal docs should explain the boundary, placement policy, record schema, and
how domain stores use the persistence system.

## 0.9.0 planning implication

0.9.0 should not try to migrate every store before review effort can start.
Instead:

1. Ship the persistence core and guardrail.
2. Put review audit on top of it.
3. Migrate task state/evidence next because review planning depends on task
   lifecycle and compaction.
4. Migrate memory/decision/transcript/checkpoint writes before expanding
   autonomous recovery and long-running review calibration.
5. Migrate artifacts/config/corpus/design-system stores as each area receives
   feature work.

The important rule is directional: no new durable feature should deepen the old
distributed persistence pattern.
