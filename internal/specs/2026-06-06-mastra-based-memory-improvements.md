# Mastra-Based Memory Improvements Spec

## Status

Partially implemented, 2026-06-06.

Graphiti is retired. It was explored as a graph/fact-memory candidate and did
not bear fruit for Guildhall's product needs. It should not remain as a deferred
implementation path, fallback, or "maybe later" product option. The selected
path is Mastra Memory and Observational Memory behind a Guildhall-owned
memory-core API, with deterministic Guildhall summaries as the control and
fallback.

This is an internal product and implementation spec. It is not public docs.

## Decision

Guildhall should turn the Mastra value-gate prototype into production
memory-core infrastructure.

Mastra is useful because it gives Guildhall:

- TypeScript-native persistent memory with `@mastra/memory`;
- local embedded storage through `@mastra/libsql`;
- explicit thread/resource scoping;
- read-only memory mode for preview/routing/review contexts;
- Observational Memory for observer/reflector compaction;
- async observation/reflection buffering so long-running work can compact in
  the background;
- token-window status and buffering events that can support truthful UI;
- optional semantic recall and retrieval modes that can be enabled only after a
  separate quality/latency gate.

Guildhall still owns:

- storage policy and opt-in repo exports;
- source references and drill-down;
- context inclusion and omission decisions;
- task truth, readiness, review, and gate outcomes;
- migrations, cleanup, retention, and audit reports;
- all reads/writes through the data layer.

## Source Facts From Current Mastra Docs

The current Mastra reference describes `Memory` as a thread-based message and
conversation store. It requires a storage provider for conversation history and
requires a vector store plus embedder only when semantic recall is enabled.
`Memory` supports `lastMessages`, `readOnly`, `semanticRecall`,
`workingMemory`, `observationalMemory`, and thread-title generation.

Mastra's Observational Memory is available through the `observationalMemory`
option. It uses an Observer to turn raw conversation history into observations
and a Reflector to condense observations. The docs expose configuration for
thread or resource scope, model selection, observation/reflection instructions,
token thresholds, temporal markers, retrieval, async buffering, and typed
streaming status parts. Resource-scoped Observational Memory is experimental;
async buffering is disabled for resource scope.

Guildhall should use those capabilities, but only behind a Guildhall-owned
boundary. Product/runtime code must never import Mastra directly unless it is
inside `src/memory-core/adapters/mastra*`.

## Goals

1. Stop `.guildhall/*` memory and runtime bloat from reappearing.
2. Give worker/reviewer/gate prompts compact, source-backed context packets.
3. Preserve source drill-down from every compact observation to raw evidence.
4. Make long-running task threads survive without raw transcript replay.
5. Expose memory health, compaction progress, and storage location truthfully.
6. Keep startup and retrieval fast enough for normal Guildhall interaction.
7. Keep the deterministic fallback good enough that Mastra failures never block
   cleanup, task updates, or context packet construction.

## Non-Goals

- Do not adopt Mastra Agent as Guildhall's top-level runtime in this slice.
- Do not let Mastra decide next action, task readiness, review verdicts, or gate
  outcomes.
- Do not enable semantic recall by default.
- Do not write raw memory, observations, embeddings, transcripts, migration
  backups, or operational ledgers to project repositories.
- Do not keep Graphiti as a postponed feature.

## Contract Touch Decision

Work id: `mastra-memory-core`.

Touched contracts:

- `GuildhallDataStore` read/write boundary;
- memory-core public TypeScript API;
- system-local project data layout;
- optional project-local memory export manifest;
- context packet shape consumed by runtime context builders and MCP memory
  reads;
- migration/audit report formats.

Contracts considered but not touched:

- task lifecycle state machine;
- review/gate result schemas;
- top-level agent runtime selection;
- public docs contract.

Required follow-up:

- run `pnpm lint:contracts` after implementation;
- update MCP memory surface only after memory-core has a stable packet shape;
- add explicit schema migration decision before writing persistent memory-core
  tables in production.

Proof required:

- direct-writer guardrails still pass;
- no project-local writes occur without opt-in;
- source refs survive compaction and recall;
- deterministic fallback works when Mastra import, storage, observer, reflector,
  or recall fails;
- stale `.guildhall` project fixtures can be read and compacted without
  mutating those repos.

Apply/revert behavior:

- applying the slice creates system-local memory DBs only;
- reverting the slice leaves project repositories untouched;
- cleanup removes system-local memory-core DBs and reports through the data
  layer, not ad hoc filesystem writes.

## Schema Migration Decision

Persisted schema touched:

- system-local memory-core database;
- optional system-local audit reports;
- optional project-local thin export manifest only when opted in.

Scope:

- per Guildhall project;
- optional user-global memories later;
- no default project checkout writes.

Change class:

- additive system-local schema;
- no project-local schema change unless explicit export mode is enabled.

Existing data impact:

- current `.guildhall` bloat is read as migration input;
- raw project-local state is not deleted by this spec;
- cleanup/migration tools may later move or compact it with separate proof.

Migration id:

- `2026-06-06-mastra-memory-core`.

Safety:

- migrations run against system-local data paths;
- every migration writes an audit record with storage path, before/after bytes,
  created tables, and rollback notes;
- project-local writes require opt-in checked through the data layer.

Compatibility reader:

- deterministic reader can build packets from old project-local `.guildhall`
  files and from new memory-core tables;
- memory-core can ignore Mastra tables and use deterministic summaries if Mastra
  is unavailable.

Fixtures:

- Fair Labor License `.guildhall` cleanup fixture;
- Looma + Knit bloated progress/task fixture;
- Jess generated-map fixture;
- Narrative Harness migration-backup fixture.

Tests:

- unit tests for schema initialization, read/write routing, compaction fallback,
  source-ref preservation, and opt-in export;
- integration tests using fixture projects under temporary system-local data;
- guardrail tests for direct filesystem reads/writes;
- CLI/audit tests for `memory:mastra:value-gate` and the future memory-core
  audit command.

Owner-facing plan text:

- "Guildhall is moving operational memory out of your repository and into local
  Guildhall storage. The repo only receives a small manifest if you opt in."

Rollback/revert:

- disable Mastra adapter through config;
- continue deterministic packet generation;
- keep system-local DB as inert audit data until cleanup;
- never restore bulky `.guildhall` files into project repos.

## Contract Touch Decision

Work id: `mastra-memory-core-runtime-integration`.

Touched contracts:

- `WorkspaceYamlConfig.memory`;
- project-local `.guildhall/config.yaml` `memory` overrides;
- `MemoryCandidatePacket.health`;
- `guildhall://project/memory`;
- `/api/project.memoryHealth.memoryCore`;
- Overview memory-health presentation.

Contracts considered but not touched:

- legacy `memory-store` record schema;
- task queue schema;
- project migration ledger;
- external-agent memory bridge records.

Required follow-up:

- none for schema migration;
- semantic recall remains disabled unless `memory.semanticRecall` or
  `GUILDHALL_MEMORY_SEMANTIC_RECALL` explicitly enables it.

Proof required:

- config kill-switch test;
- Mastra packet/default test;
- deterministic fallback test;
- MCP memory render test;
- project API test;
- Overview render test.

Proof provided:

- focused Vitest coverage for project config, memory-core, effective memory
  packet, MCP project-reader, `/api/project`, and ProjectOverviewTab.

Waivers:

- no owner opt-in prompt is needed because the default stores only system-local
  memory-core data and reports `repoLocalWrites: []`;
- project-local storage remains rejected.

Owner-review items:

- none.

Apply/revert behavior:

- setting `memory.substrate = "deterministic"` or
  `GUILDHALL_MEMORY_SUBSTRATE=deterministic` disables Mastra without deleting
  recorded memory events;
- removing the config returns to the Mastra default.

## Schema Migration Decision

Persisted schema touched:

- workspace/project config gains optional `memory.substrate` and
  `memory.semanticRecall`.

Scope:

- config-only runtime behavior switch;
- no project task/history data is rewritten.

Change class:

- backward-compatible optional field with defaults.

Existing data impact:

- existing configs parse with `mastra` and `semanticRecall: false` defaults.

Migration id:

- none required.

Safety:

- project-local `.guildhall/config.yaml` remains ignored/local;
- shared `guildhall.yaml` can opt into the same memory block when desired.

Compatibility reader:

- `readProjectConfig` and workspace schema defaults.

Fixtures/tests:

- project-config kill-switch test;
- effective-memory packet deterministic substrate test.

Owner-facing plan text:

- users can disable Mastra with `memory.substrate = "deterministic"`;
- semantic recall stays off by default.

Rollback/revert behavior:

- remove the config block or set deterministic.

## Architecture

```text
Runtime / UI / MCP
  |
  v
src/memory-core/index.ts
  |
  +-- types.ts              # public Guildhall-owned contracts
  +-- scopes.ts             # project/task/thread/resource mapping
  +-- data-access.ts        # only layer allowed to touch memory storage
  +-- events.ts             # raw event ingestion and source refs
  +-- packets.ts            # candidate evidence packets
  +-- compaction.ts         # deterministic and Mastra compaction orchestration
  +-- recall.ts             # scoped recall and packet ranking
  +-- audit.ts              # health, storage, migrations, repo-write proof
  +-- adapters/
      +-- deterministic.ts
      +-- mastra.ts
      +-- mastra-observational.ts
```

The adapter layout is intentionally boring. Mastra is a substrate, not a
cross-cutting runtime dependency. All surfaces call `GuildhallMemory`, and
`GuildhallMemory` calls the data layer.

## Storage Layout

Default system-local path:

```text
<guildhall-system-data>/projects/<project-key>/memory/
  guildhall-memory.db
  audit/
    memory-audit-<timestamp>.json
  exports/
    memory-manifest-<timestamp>.json
```

Default project-local path:

```text
.guildhall/
  artifacts.yaml
```

Allowed project-local memory file, only after explicit opt-in:

```text
.guildhall/memory-manifest.json
```

The manifest is a thin index of accepted summaries and source hashes. It must
not contain raw transcripts, full observations, embeddings, detailed review
verdicts, migration backups, or generated maps.

## Core Types

```ts
export type GuildhallMemoryScope =
  | {
      kind: 'task_thread'
      projectId: string
      taskId: string
      agentRole: 'spec' | 'coordinator' | 'worker' | 'reviewer' | 'gateChecker' | 'contextIndexer'
      threadId: string
      runId?: string
    }
  | { kind: 'project'; projectId: string }
  | { kind: 'user_global'; userId: string }

export interface MemorySourceRef {
  id: string
  sourceKind: 'task' | 'progress' | 'review' | 'gate' | 'tool' | 'thread' | 'artifact' | 'external_agent'
  uri: string
  path?: string
  lineStart?: number
  lineEnd?: number
  byteStart?: number
  byteEnd?: number
  hash?: string
  capturedAt: string
}

export interface MemoryCandidate {
  id: string
  kind: 'event' | 'observation' | 'reflection' | 'working_memory' | 'semantic_recall' | 'deterministic_summary'
  summary: string
  relevance: 'high' | 'medium' | 'low'
  confidence: 'high' | 'medium' | 'low'
  freshness: 'current' | 'possibly_stale' | 'stale'
  sourceRefs: MemorySourceRef[]
  reasonForInclusion: string
  risks: string[]
}

export interface MemoryCandidatePacket {
  scope: GuildhallMemoryScope
  purpose: 'next_worker_context' | 'review_context' | 'gate_context' | 'owner_answer' | 'cleanup_audit' | 'handoff'
  generatedAt: string
  byteEstimate: number
  candidates: MemoryCandidate[]
  omitted: Array<{
    reason: 'too_large' | 'low_relevance' | 'stale' | 'wrong_scope' | 'unsafe' | 'duplicate'
    summary: string
    sourceRefs: MemorySourceRef[]
  }>
  health: {
    adapter: 'mastra' | 'deterministic'
    fallbackUsed: boolean
    warnings: string[]
  }
}
```

## Mastra Scope Mapping

Task-thread memory:

- Mastra resource: `project:${projectId}:task:${taskId}`
- Mastra thread: `agent:${agentRole}:thread:${threadId}`
- Guildhall metadata: `projectId`, `taskId`, `agentRole`, `runId`, `sourceRef`,
  `sourceKind`, `retention`, `risk`.

Project memory:

- Mastra resource: `project:${projectId}`
- Mastra thread: `project:${projectId}:memory`

User-global memory:

- Mastra resource: `user:${userId}`
- Mastra thread: `user:${userId}:guildhall`

Resource-scoped Observational Memory remains off by default because Mastra marks
resource scope experimental and async buffering is disabled there. Project-level
memory can use project resource scope only after fixture tests prove it does
not blur active tasks or slow startup.

## Mastra Configuration Policy

Default production config:

```ts
new Memory({
  storage: new LibSQLStore({
    id: `guildhall-memory-${projectKey}`,
    url: `file:${systemLocalMemoryDbPath}`,
  }),
  vector: false,
  options: {
    lastMessages: 20,
    readOnly: false,
    semanticRecall: false,
    observationalMemory: {
      model: configuredObserverModel,
      scope: 'thread',
      temporalMarkers: true,
      observation: {
        instruction: guildhallObservationInstruction,
        messageTokens: 30_000,
        bufferTokens: 5_000,
        bufferActivation: 0.7,
        blockAfter: 1.5,
      },
      reflection: {
        instruction: guildhallReflectionInstruction,
        observationTokens: 60_000,
        bufferActivation: 0.5,
        blockAfter: 1.2,
      },
    },
  },
})
```

Read-only preview/routing/review config:

```ts
{
  lastMessages: 10,
  readOnly: true,
  semanticRecall: false,
  observationalMemory: false,
}
```

Semantic recall gate:

- disabled by default;
- requires vector store, embedder, latency test, source-range test, and cost
  budget;
- can only return candidates, never final prompt text.

## Data-Layer Requirements

All memory reads and writes go through data-layer functions. Direct `fs.readFile`
or `fs.writeFile` usage for Guildhall data remains forbidden outside approved
data-layer modules.

New data-layer APIs:

```ts
export interface GuildhallMemoryDataAccess {
  resolveMemoryPaths(scope: GuildhallMemoryScope): Promise<MemoryPaths>
  initializeMemoryStore(scope: GuildhallMemoryScope): Promise<MemoryStoreHandle>
  recordMemoryEvent(input: RecordMemoryEventInput): Promise<MemoryWriteResult>
  readMemoryEvents(input: ReadMemoryEventsInput): Promise<MemoryEventPage>
  recordCompactionJob(input: RecordCompactionJobInput): Promise<CompactionJob>
  updateCompactionJob(input: UpdateCompactionJobInput): Promise<CompactionJob>
  writeAuditReport(input: WriteMemoryAuditReportInput): Promise<MemoryAuditReportRef>
  writeProjectExport(input: WriteProjectMemoryExportInput): Promise<MemoryExportResult>
}
```

Any attempt to write `.guildhall/*` memory files without an explicit export mode
must throw a product error, not silently fall back to repo-local state.

## Event Ingestion

Memory-core records compact events from these sources:

- task status transitions;
- worker/reviewer/gate summaries;
- owner questions and owner answers;
- accepted external-agent evidence;
- migration and cleanup reports;
- stale-server/runtime proof;
- selected artifact changes;
- accepted delivery receipts.

Event ingestion stores raw source refs, not giant duplicated payloads. If the
source payload is too large, memory-core stores:

- a short deterministic summary;
- content hash;
- source pointer;
- byte/line range when available;
- retention class.

## Observational Compaction

Mastra Observational Memory should be used for long-running task threads where
raw message replay would bloat prompts. Guildhall should add custom observer and
reflector instructions:

Observer priorities:

- current task goal and latest owner instruction;
- blockers and whether they are still current;
- files, routes, projects, and commands touched;
- proof already run and proof still missing;
- stale or superseded claims;
- explicit user preferences and policy decisions;
- source refs for every claim.

Reflector priorities:

- combine repeated progress into a short current-state note;
- mark older blockers as superseded when later proof contradicts them;
- preserve dates and absolute timestamps;
- keep source refs, hashes, and task ids;
- omit chatter, redundant tool logs, and already-landed details.

Compaction failure behavior:

- if Observer fails, keep deterministic event summary;
- if Reflector fails, keep observations and warn in audit;
- if Mastra storage fails, switch to deterministic fallback store;
- if model config is missing, record event and skip model compaction;
- no failure writes bulky state to the project repo.

## Context Packet Builder

The packet builder is the main product value. It returns candidate evidence,
not final prompt text.

For `next_worker_context`, include:

- latest owner instruction;
- current task goal and acceptance boundary;
- current blockers and unblock proof;
- files/routes/projects already touched;
- stale claims to avoid repeating;
- required verification commands;
- source refs for each item.

For `review_context`, include:

- changed surfaces;
- relevant contract/schema decisions;
- proof already run;
- unverified risk areas;
- previous reviewer concerns that are still current.

For `gate_context`, include:

- acceptance criteria;
- required commands;
- migration/export safety;
- repo-write proof;
- known waivers and owner-review items.

For `cleanup_audit`, include:

- project-local files that should not exist by default;
- writer paths that can recreate them;
- opt-in status;
- before/after byte counts;
- cleanup or migration report refs.

## UI And API Improvements

Add truthful memory status surfaces after memory-core lands:

- project overview memory health row:
  - storage: system-local / opt-in export / misconfigured;
  - compaction: idle / buffering / compacting / failed / fallback;
  - repo writes: none / opted-in manifest / blocked attempt;
  - packet quality: baseline / Mastra / fallback.
- task detail memory panel:
  - current packet candidates;
  - omitted stale/unsafe/duplicate evidence;
  - source drill-down;
  - last compaction status.
- migration/apply modal:
  - blocking progress while migration or cleanup is active;
  - "Do not stop Guildhall while local memory is being moved/compacted";
  - live status from the data layer, not optimistic button text.
- MCP `project/memory` read:
  - return memory-core audit and packet previews;
  - never expose raw DB contents by default.

Use Mastra OM streaming/status events where available, but normalize them into
Guildhall status types before UI surfaces see them.

## Migration Path

Slice 1: retire Graphiti path.

- remove Graphiti executable prototypes and tests;
- update evaluation docs to say explored/no product path;
- keep historical notes only as evidence, not roadmap.

Slice 2: memory-core data access.

- create `src/memory-core/types.ts`, `scopes.ts`, `data-access.ts`, and
  `adapters/deterministic.ts`;
- add failing tests proving no project-local writes happen without opt-in;
- wire data-layer guardrails to memory-core paths.

Implemented 2026-06-06:

- `src/memory-core/` now exposes the Guildhall-owned memory-core boundary.
- Scope mapping converts project/task/thread/user scopes to Mastra
  resource/thread ids without cross-task sharing.
- Memory events and audit reports write to system-local project data through
  memory-core data access.
- Deterministic candidate packets preserve source refs and expose fallback
  health.
- `scripts/data-layer-guardrails.mjs` recognizes memory-core data access as the
  owned storage layer.

Slice 3: Mastra adapter.

- move value-gate runtime code from `scripts/` into
  `src/memory-core/adapters/mastra.ts`;
- instantiate `Memory` and `LibSQLStore` through the data layer;
- preserve thread/resource mapping and source metadata;
- expose health and fallback status.

Implemented 2026-06-06:

- `src/memory-core/adapters/mastra.ts` instantiates real Mastra `Memory` with
  `LibSQLStore` at the system-local memory DB path.
- Adapter health reports package versions, storage path, repo-local writes,
  features, warnings, and normalized scope ids.
- Read-only mode is supported for preview/routing/review-style consumers.

Slice 4: compaction and packets.

- add deterministic packet builder;
- add Mastra observation/reflection orchestration for task threads;
- normalize Mastra output into `MemoryCandidatePacket`;
- prove source refs survive.

Implemented 2026-06-06:

- Deterministic packet builder is live and included in effective memory packets.
- Runtime context builders can now render memory-core candidate packets without
  replacing accepted legacy memory records.
- `buildMemoryCoreCandidatePacket` now instantiates Mastra by default, normalizes
  source-backed scoped events into Guildhall `MemoryCandidatePacket` candidates,
  preserves source refs, and falls back to deterministic packets with visible
  warnings when Mastra is unavailable.
- `memory.substrate = "deterministic"` and
  `GUILDHALL_MEMORY_SUBSTRATE=deterministic` provide the kill switch; semantic
  recall remains disabled by default.

Slice 5: migration/audit.

- read bloated `.guildhall` fixtures without mutating them;
- write system-local memory events;
- report before/after bytes, repo writes, and fallback path;
- add cleanup proof commands.

Implemented 2026-06-06:

- `auditProjectMemoryState` reads project-local `.guildhall` state through the
  memory-core data layer, hashes audited files, and writes system-local memory
  events plus audit reports only when `apply` is true.
- `guildhall memory mastra-audit [--apply] [path]` and
  `pnpm memory:mastra:audit` provide the operator-facing dry-run/apply path.
- Fixture proof showed unchanged `.guildhall` files before/after apply,
  system-local event/report writes under `GUILDHALL_DATA_DIR`, and
  `Repo-local writes: none`.
- The older Mastra value-gate storage check now distinguishes repo-local
  project `.guildhall` paths from valid machine-local `~/.guildhall/data`
  storage, so `pnpm memory:mastra:value-gate` returns `decision: "adopt"` while
  still rejecting project-local storage.

Slice 6: runtime/API/UI integration.

- context builders request packets from memory-core;
- MCP memory resource returns packet/audit previews;
- project/task UI shows memory health and compaction progress;
- migration apply modal blocks until data-layer work is complete.

Implemented 2026-06-06:

- `buildEffectiveMemoryPacket` includes memory-core deterministic packet
  candidates and evidence refs.
- `guildhall://project/memory` renders memory-core storage path, event path,
  adapter/fallback status, repo-local write status, and candidate preview.
- `buildEffectiveMemoryPacket` and `guildhall://project/memory` now use the
  Mastra/default memory-core packet builder instead of deterministic-only
  packets.
- `/api/project` returns `memoryHealth.memoryCore` with adapter, fallback,
  storage path, repo-local writes, semantic recall status, warnings, and
  features.
- Overview memory health shows the memory-core substrate, semantic recall
  on/off state, and repo-write status from the shared API payload.
- Migration-modal progress was already fixed in the prior required-migration
  slice; no optimistic completion text remains in this spec's scope.

Slice 7: semantic recall gate.

- add disabled-by-default vector config;
- run fixture quality and latency tests;
- enable only if it beats deterministic and OM packets without losing source
  refs or blowing budgets.

Implemented 2026-06-06:

- `memory.semanticRecall` and `GUILDHALL_MEMORY_SEMANTIC_RECALL` are wired, but
  default to disabled.
- Memory-core health exposes `semanticRecallEnabled` and feature flags so UI/API
  and MCP surfaces can prove semantic recall is off on the default path.
- No vector/semantic recall path is enabled as product behavior until a later
  quality/latency gate beats deterministic packets while preserving source refs.

## Acceptance Criteria

- `pnpm lint:data-layer` fails if new Guildhall data reads/writes bypass the
  data layer.
- `pnpm lint:contracts` passes with recorded contract/schema decisions.
- `pnpm typecheck` passes.
- `pnpm build` passes.
- `pnpm test -- --run --reporter=dot` passes.
- `pnpm memory:mastra:value-gate` still returns `decision: "adopt"`.
- A fixture migration writes only system-local memory files by default.
- `git ls-files .guildhall` and `find <fixture>/.guildhall` proof is included
  before claiming repo cleanup behavior.
- Candidate packets stay under byte budgets and include source refs.
- Forced Mastra failure returns deterministic packets and a visible warning.
- UI/API status does not say migration or compaction is complete until the
  data-layer job is actually done.

## Kill Switches

Mastra adapter must be disableable without code deletion:

- config flag: `memory.substrate = "deterministic"`;
- environment override for tests and emergency operation;
- per-project audit warning when Mastra is unavailable;
- automatic fallback after storage/model/compaction failure.

Kill Mastra as default if:

- it requires surprise infrastructure;
- it leaks Mastra-specific types across product/runtime code;
- it cannot preserve source refs;
- startup/retrieval misses hard gates;
- resource/thread mapping contaminates tasks;
- compaction makes packets smaller but less useful than deterministic baseline.

## Open Questions

1. Should project-level memory use Mastra resource scope, or should it stay as a
   dedicated project thread until resource-scope behavior is proven?
2. Which configured provider/model should observer and reflector use by
   default when the user has not set a memory-specific model?
3. Should accepted memory exports be a project setting, workspace setting, or
   one-time owner action?
4. How much raw source should the system-local store retain before retention
   compacts it into source hashes and line/byte ranges?
5. Should memory health warnings block task start, or only annotate context
   packets unless source refs are missing?

## Source Links

- Mastra Memory class: <https://mastra.ai/reference/memory/memory-class>
- Mastra Observational Memory:
  <https://mastra.ai/reference/memory/observational-memory>
- Mastra createThread:
  <https://mastra.ai/reference/memory/createThread>
- Mastra Memory overview: <https://mastra.ai/docs/memory/overview>
