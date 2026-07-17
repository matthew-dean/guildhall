# Guildhall Independent Memory Module Spec

## Status

Draft, 2026-06-04.

This spec draws from current Mastra memory documentation. The goal is a discrete
Guildhall memory module with a stable boundary and possible spin-out value. The
module may use Mastra Agent/runtime pieces internally if that is the cleanest way
to get Observational Memory, processors, and recall, but Guildhall code should
call a Guildhall-owned memory API rather than scattering Mastra calls throughout
the product. Mastra Memory / Observational Memory is the selected first
substrate behind that boundary.

## Problem

Guildhall memory is failing first as a storage system:

- project checkouts accumulate oversized `.guildhall` files;
- append-only progress and task evidence live in the repo;
- generated maps and migration backups become durable project state;
- cleanup can be undone by writers that serialize bulky task records again.

Guildhall also needs better memory workflow:

- compact noisy task/event history;
- keep source drill-down available;
- support scoped recall without cross-project or cross-task leakage;
- produce candidate evidence for context builders;
- preserve provenance and retention budgets.

The memory system must not replace Guildhall's reasoning. It supplies storage,
compaction, recall, observation/reflection, and provenance. Guildhall decides
what context belongs in a worker/reviewer/gate prompt and why.

## Mastra Memory Findings

Current Mastra docs describe a useful substrate shape:

- Memory stores message history and can add Observational Memory, working
  memory, semantic recall, multi-user thread support, and processors.
- Storage is adapter-based. libSQL is the easiest local provider and does not
  require a separate database server.
- Memory is organized by `resource` and `thread`. A thread belongs to one
  resource, and the owner cannot be changed after creation.
- Observational Memory uses background Observer and Reflector agents to compress
  long histories into dense observations/reflections.
- Observational Memory currently supports `@mastra/pg`, `@mastra/libsql`, and
  `@mastra/mongodb`.
- Observational Memory has retrieval modes. With retrieval enabled, observation
  groups keep source message ranges; with vector retrieval, semantic search
  returns observation groups plus raw source ranges.
- Working memory is persistent structured state, either resource-scoped or
  thread-scoped. It can be Markdown-template-based or schema-based.
- Semantic recall is disabled by default, uses vector embeddings, supports
  `topK`, message ranges, thread/resource scope, and metadata filters.
- Memory processors load memory before the model call and persist/index after
  output guardrails. Output guardrails can prevent memory writes.
- Multi-user threads require explicit speaker identity in the message body;
  Observational Memory is recommended for long-running shared threads, while
  working memory is useful for structured participant lists.

## Design Principles

1. **Discrete module boundary first.**
   Guildhall product/runtime code imports `GuildhallMemory`, not scattered
   substrate classes. The module can wrap Mastra Agent, Mastra Memory, or a
   deterministic backend internally.

2. **System-local by default.**
   Memory data lives under Guildhall's machine-local data directory. Repo-local
   state is off or thin unless explicitly exported.

3. **Substrate only.**
   Memory can return candidate evidence. It cannot decide the active goal,
   context inclusion, task readiness, or review/gate outcome.

4. **Provenance required.**
   Every observation, reflection, working-memory update, recall hit, and compact
   summary must carry source refs or source ranges.

5. **Scopes are explicit.**
   Guildhall must name the project, task, agent role, thread/run, and user/global
   scope for every write and query.

6. **Compaction is a write-path invariant.**
   The module owns retention and compaction triggers. Cleanup commands are
   recovery tools, not the first defense.

7. **Fallback is deterministic.**
   If Mastra observation, embedding, recall, or storage fails, Guildhall falls
   back to deterministic local summaries and still preserves compact task truth.

8. **Fast retrieval is a product requirement.**
   Memory must help Guildhall start work faster and with better context. If
   recall or compaction makes normal task startup feel slow, it fails the
   module's purpose.

9. **No surprise infrastructure.**
   The default memory path must not require the user to manually install,
   configure, or operate Docker, Neo4j, FalkorDB, PostgreSQL, MongoDB, Redis, a
   hosted database, system Python, or another service. Embedded databases,
   bundled runtimes, WASM-compiled storage engines, and Node.js database drivers
   are allowed if Guildhall owns lifecycle, paths, migrations, health checks,
   and cleanup.

## Scope Model

Guildhall memory has more axes than Mastra's `resource` and `thread`, so the
module must map Guildhall scopes deliberately.

### Guildhall Scope

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
  | {
      kind: 'project'
      projectId: string
    }
  | {
      kind: 'user_global'
      userId: string
    }
  | {
      kind: 'guildhall_product'
    }
```

### Mastra Mapping Candidate

For a task-thread memory:

- Mastra `resource`: `project:${projectId}:task:${taskId}`
- Mastra `thread`: `agent:${agentRole}:thread:${threadId}`
- message metadata:
  - `projectId`
  - `taskId`
  - `agentRole`
  - `runId`
  - `sourceKind`
  - `sourceRef`

For project-level memory:

- Mastra `resource`: `project:${projectId}`
- Mastra `thread`: `project:${projectId}:memory`

For user-global memory:

- Mastra `resource`: `user:${userId}`
- Mastra `thread`: `user:${userId}:guildhall`

The adapter must not use one resource for unrelated active tasks unless the
query explicitly requests project-level recall. This prevents one task from
continuing another task's goal.

## Data Classes

| Class | Default Location | Purpose | Repo Export |
| --- | --- | --- | --- |
| Raw memory event | system-local DB/ledger | Source message/tool/evidence record. | Never by default. |
| Observation group | system-local DB | Compact notes derived from raw events. | Optional summary only. |
| Reflection | system-local DB | Higher-level compaction over observations. | Optional summary only. |
| Working memory | system-local DB | Structured current facts/preferences/project state. | Optional curated export. |
| Semantic embedding | system-local vector store | Recall candidate search. | Never. |
| Accepted memory record | system-local DB plus optional manifest | Reviewed durable memory with risk/status. | Thin manifest if opted in. |
| Memory packet | transient / generated artifact | Candidate evidence for context builder. | Never by default. |
| Drill-down source range | system-local refs | Audit and exact source recovery. | Pointer only if exported. |

## Module Boundary

Proposed source layout:

```text
src/memory-core/
  index.ts
  types.ts
  scopes.ts
  storage.ts
  events.ts
  observations.ts
  working-memory.ts
  recall.ts
  packets.ts
  provenance.ts
  retention.ts
  adapters/
    deterministic.ts
    mastra.ts
```

The module owns storage, compaction, and recall. It does not own final prompt
assembly. Runtime context builders call it for candidate evidence. Internally,
the module may use Mastra Agent/runtime facilities if they are the best way to
run memory processors or Observational Memory.

## Public Interface

```ts
export interface GuildhallMemory {
  recordEvent(input: RecordMemoryEventInput): Promise<MemoryWriteResult>
  recordObservation(input: RecordObservationInput): Promise<MemoryWriteResult>
  updateWorkingMemory(input: UpdateWorkingMemoryInput): Promise<MemoryWriteResult>
  compact(input: CompactMemoryInput): Promise<CompactionResult>
  recall(input: RecallMemoryInput): Promise<RecallResult>
  buildCandidatePacket(input: BuildCandidatePacketInput): Promise<MemoryCandidatePacket>
  audit(input: AuditMemoryInput): Promise<MemoryAuditReport>
  cleanup(input: CleanupMemoryInput): Promise<CleanupMemoryReport>
}
```

### Event Writes

```ts
export interface RecordMemoryEventInput {
  scope: GuildhallMemoryScope
  source: {
    kind: 'task' | 'progress' | 'review' | 'gate' | 'tool' | 'thread' | 'external_agent' | 'generated_map'
    ref: string
    path?: string
    timestamp: string
  }
  content: {
    text?: string
    json?: unknown
    summary?: string
  }
  metadata: {
    projectId?: string
    taskId?: string
    agentRole?: string
    status?: string
    risk?: 'low' | 'medium' | 'high'
    retention?: 'ephemeral' | 'debug' | 'task_lifecycle' | 'durable_memory'
  }
}
```

### Recall

```ts
export interface RecallMemoryInput {
  scope: GuildhallMemoryScope
  query: string
  purpose:
    | 'next_worker_context'
    | 'review_context'
    | 'gate_context'
    | 'owner_answer'
    | 'cleanup_audit'
  maxBytes: number
  includeRawRanges?: boolean
  filters?: {
    taskId?: string
    projectId?: string
    agentRole?: string
    sourceKinds?: string[]
    since?: string
    until?: string
    riskAtMost?: 'low' | 'medium' | 'high'
  }
}
```

### Candidate Packet

```ts
export interface MemoryCandidatePacket {
  scope: GuildhallMemoryScope
  purpose: RecallMemoryInput['purpose']
  generatedAt: string
  byteEstimate: number
  candidates: Array<{
    id: string
    kind: 'observation' | 'reflection' | 'working_memory' | 'semantic_recall' | 'deterministic_summary'
    summary: string
    relevance: 'high' | 'medium' | 'low'
    confidence: 'high' | 'medium' | 'low'
    sourceRefs: MemorySourceRef[]
    reasonForInclusion: string
    risks?: string[]
  }>
  omitted: Array<{
    reason: 'too_large' | 'low_relevance' | 'stale' | 'wrong_scope' | 'unsafe' | 'duplicate'
    sourceRefs: MemorySourceRef[]
    summary: string
  }>
}
```

Context builders may choose from this packet, but the packet is not the final
prompt.

## Mastra Adapter Requirements

The Mastra adapter is the selected first substrate path after the value gate.
It remains swappable only as a kill-switch/fallback property: if it misses a
hard gate, Guildhall must be able to fall back to deterministic memory without
rewriting product/runtime callers.

Required behavior:

- Use `@mastra/memory` with `@mastra/libsql` for the first local substrate.
- Store DB files under Guildhall system-local project data, not inside the repo.
- Mastra Agent/runtime use is allowed inside this module if needed for
  Observational Memory or processors, but the integration must stay behind the
  `GuildhallMemory` boundary.
- Preserve source ranges or equivalent source refs for every compacted
  observation.
- Configure thread/resource scopes from `GuildhallMemoryScope`.
- Keep semantic recall disabled by default until vector cost/latency is proven.
- Allow semantic recall with local or configured embeddings later.
- Use output/write guardrails so rejected/unsafe output is not persisted.
- Expose health/audit checks: storage path, byte size, observation counts,
  reflection counts, recall index state, and failed compaction jobs.

Open technical question:

Mastra's docs present memory primarily through `Agent` integration and processor
pipelines. The prototype must verify whether Guildhall can use `Memory` methods
directly, whether it should embed a focused Mastra Agent for memory processing,
or whether the whole memory module should be implemented as a small Mastra-based
service object. Any of those are acceptable if the result stays a discrete,
testable module with a stable Guildhall API and no project-local bloat.

## Deterministic Adapter Requirements

The deterministic adapter remains mandatory as fallback and baseline.

It must:

- summarize task queues without LLM calls;
- summarize progress/event ledgers by status, timestamp, and source kind;
- enforce byte budgets;
- preserve source refs;
- support cleanup/audit even when Mastra dependencies fail;
- produce comparable candidate packets for test scoring.

## Storage Layout

Default system-local layout:

```text
~/.guildhall/data/projects/<project-key>/
  memory/
    guildhall-memory.db
    guildhall-memory-vector.db
    events/
      fallback-events.jsonl
    reports/
      memory-audit-<timestamp>.json
```

Project-local layout by default:

```text
.guildhall/
  artifacts.yaml        # optional registry only
  memory-manifest.json  # optional, explicit export only
```

No raw observations, embeddings, transcripts, progress logs, review verdicts,
or migration backups belong in project-local state by default.

## Retention Budgets

| Surface | Target | Hard Gate |
| --- | ---: | ---: |
| Repo-local memory manifest | 16 KB | 32 KB |
| Repo-local task summary export | 2 KB/task | 8 KB/task |
| Single task candidate packet | 4 KB | 8 KB |
| Multi-project candidate packet | 16 KB | 32 KB |
| Raw system-local event ledger | configurable | no repo impact |
| Observation/reflection DB | configurable | audit warning only |

## Retrieval And Startup Budgets

These are initial prototype gates. The audit may tune them, but the module must
ship with explicit budgets rather than "it feels fine."

| Operation | Target | Hard Gate | Notes |
| --- | ---: | ---: | --- |
| Build single-task candidate packet after warm storage open | p95 < 500 ms | p95 < 2 s | Deterministic summary plus recent observations. |
| Build multi-project handoff packet after warm storage open | p95 < 1.5 s | p95 < 4 s | Only for explicit multi-project views/handoffs. |
| Open local memory store | < 150 ms | < 750 ms | Measured on existing managed-project fixtures. |
| Deterministic fallback packet | < 250 ms | < 1 s | Must work without model, embedding, or Mastra processing. |
| Semantic recall query | p95 < 1 s | p95 < 3 s | Optional path; disabled by default until proven. |
| Observational compaction | background | must not block normal task startup | Synchronous fallback only under explicit safety thresholds. |

If a memory feature misses its hard gate, Guildhall must either disable that
feature by default or move it to an async/background path.

## External Dependency Policy

Default allowed:

- TypeScript/JavaScript dependencies installed by Guildhall's package manager.
- Local libSQL or equivalent embedded storage.
- WASM-compiled storage engines when Guildhall manages loading, data files,
  migrations, and cleanup.
- Node.js database drivers for local embedded/file-backed storage.
- Existing Guildhall provider configuration for optional model calls.
- System-local files under Guildhall's data directory.

Default forbidden:

- system Python;
- manual Docker or Podman setup;
- user-managed Neo4j, FalkorDB, Kuzu, PostgreSQL, MongoDB, Redis, or another DB
  service;
- hosted DBs unless explicitly configured;
- remote vector databases unless explicitly configured;
- cloud-only memory gateways;
- project-local DB files inside source checkouts.

Opt-in allowed:

- PostgreSQL, MongoDB, Redis, hosted vector DBs, or graph backends for teams
  that explicitly configure them.
- Guildhall-managed bundled or embedded DB runtimes, including WASM runtimes, if
  they require no manual service install and pass startup/retrieval budgets.
- Remote embedding/model providers through existing Guildhall provider config.
- graph-memory experiments only after a fresh owner-approved decision. Graphiti
  was explored and retired; it is not on the roadmap.

Dependency acceptance gate:

- A fresh Guildhall install must be able to run the memory module locally
  without extra manually installed or user-managed services.
- The module must expose `audit()` output that names every active storage,
  vector, model, runtime, driver, and optional dependency in use.
- Any embedded, bundled, WASM, or driver-backed store must have explicit lifecycle
  ownership: open, close, migrate, backup, compact, health-check, and cleanup.
- If an optional dependency is unavailable, Guildhall must degrade to
  deterministic local memory instead of writing bulky repo-local state.

## First Prototype

The first value-gate prototype exists as
`scripts/prototype-mastra-memory-value-gate.mjs` and is runnable through
`pnpm memory:mastra:value-gate`. It proves real Mastra/libSQL instantiation,
system-local storage, scoped thread/resource mapping, no repo-local writes, and
pass/fail scoring against deterministic baseline packets.

The next implementation should turn that prototype into `src/memory-core/`:

1. Adds no project-local runtime state.
2. Reads FLL and Looma bloated `.guildhall` fixtures without mutating them.
3. Writes compact memory events into a system-local test DB.
4. Runs deterministic compaction and, if feasible, Mastra Observational Memory.
5. Produces candidate packets for:
   - current blockers;
   - stale evidence;
   - repeated churn;
   - next worker context.
6. Compares candidate packet size and relevance against the deterministic
   baseline.
7. Emits an audit report under ignored `artifacts/memory-core-prototype/`.

## Pass / Kill Criteria

Pass:

- system-local storage only;
- no system Python;
- no manual Docker, user-managed DB service, hosted database, or remote vector DB
  in the default path;
- embedded/bundled/WASM/Node-driver storage is acceptable only if Guildhall owns
  lifecycle and it meets startup/retrieval budgets;
- compact candidate packets beat or match deterministic baseline relevance;
- every candidate has source refs;
- failed Mastra processing falls back to deterministic packets;
- no runtime writer can recreate project-local bloat.

Disable Mastra as the default:

- cannot expose a stable Guildhall memory API without leaking Mastra-specific
  runtime details across Guildhall;
- cannot meet retrieval/startup hard gates;
- requires surprise infrastructure in the default path;
- cannot preserve source refs/ranges for compacted observations;
- resource/thread scoping causes cross-task contamination;
- storage path or DB size cannot be audited;
- compaction reduces bytes but worsens context relevance;
- adapter code becomes more complex than deterministic Guildhall compaction.

## Implementation Plan Pointer

This spec should feed a concrete implementation plan after the architecture
replacement audit:

- `internal/specs/2026-06-06-mastra-based-memory-improvements.md`
- `internal/plans/archive/2026-06-04-guildhall-architecture-replacement-audit.md`
- `internal/plans/archive/2026-06-04-project-state-storage-governance-and-cleanup.md`

The writer-boundary cleanup remains mandatory regardless of the selected memory
substrate.

## Source Links

- Mastra Memory overview: <https://mastra.ai/docs/memory/overview>
- Mastra Memory storage: <https://mastra.ai/docs/memory/storage>
- Mastra message history: <https://mastra.ai/docs/memory/message-history>
- Mastra Observational Memory:
  <https://mastra.ai/docs/memory/observational-memory>
- Mastra working memory: <https://mastra.ai/docs/memory/working-memory>
- Mastra semantic recall: <https://mastra.ai/docs/memory/semantic-recall>
- Mastra memory processors:
  <https://mastra.ai/docs/memory/memory-processors>
- Mastra multi-user threads:
  <https://mastra.ai/docs/memory/multi-user-threads>
