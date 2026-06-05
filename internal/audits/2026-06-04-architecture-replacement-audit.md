# Architecture Replacement Audit

Date: 2026-06-04
Branch: `feature/memory-core-prototype`

## Frame

This audit asks where Guildhall is reinventing too much and where bespoke code
is still justified. The ranking is intentionally operational: what to keep,
thin, replace, move behind a module boundary, or delete/deprecate.

The top-level product requirement stays fixed:

- Guildhall owns reasoning about what belongs in context and why.
- Storage, compaction, retrieval, and workflow support can use libraries or
  adapters if they improve scale and quality.
- Memory/context tools feed the original user request and task intent; they do
  not replace task reasoning.

## Evidence Snapshot

Repository hotspots:

- `src/runtime/orchestrator.ts`: 10,109 LOC.
- `src/runtime/serve.ts`: 9,770 LOC.
- `src/engine/run-query.ts`: 2,864 LOC.
- `src/runtime/thread.ts`: 2,381 LOC.
- `src/runtime/structural-map.ts`: 2,158 LOC.
- `src/runtime/context-builder.ts`: 1,318 LOC.

Dependency surface:

- No Mastra runtime dependency is currently installed in `package.json`.
- Mastra appears only in memory-core spec/test text.
- No Graphiti/Zep/Kuzu/Letta runtime dependency is installed.
- Existing production dependencies are mostly Hono, MCP SDK, zod, yaml, marked,
  and UI/runtime basics.

Storage/path evidence:

- `src/runtime`, `src/tools`, `src/memory-core`, `src/sessions`, and
  `src/persistence` still contain thousands of direct filesystem references.
- There is a managed-path guardrail test, but broad runtime code still touches
  `TASKS.json`, `PROGRESS.md`, `MEMORY.md`, and `DECISIONS.md` directly.
- System-local state and automatic compaction now reduce the worst project-local
  file sprawl, but the module boundaries are not clean yet.

## Category Ranking

### 1. Replace: Raw File Memory Backend

Current state:

- `MEMORY.md`, `PROGRESS.md`, `DECISIONS.md`, and `TASKS.json` still act as
  direct memory/context inputs in several paths.
- `buildContext` still reads raw memory/progress/decision files directly.
- `buildEffectiveMemoryPacket` is separate from the new memory-core packet
  contract.

Decision:

- Replace as a backend.
- Keep thin exports/manifests only when explicitly useful.

Replacement target:

- `GuildhallMemory` contract first.
- Mastra adapter only after the deterministic contract replaces current packet
  paths without recall loss.
- Graph/fact extraction stays optional until it proves quality improvement.

Next concrete slice:

- Route `buildEffectiveMemoryPacket` through
  `GuildhallMemory.buildCandidatePacket`.
- Keep old file-backed packet logic as fallback behind one adapter.
- Add tests that prove omitted bulky evidence gets an omission reason, not prompt
  inclusion.

### 2. Move Behind Module Boundary: Task State And Lifecycle Writes

Current state:

- `TASKS.json` reads/writes are spread across runtime, tools, and tests.
- `task-queue.ts`, `intake.ts`, `orchestrator.ts`, `serve.ts`, migrations, and
  repair utilities all manipulate task state.
- Lifecycle policy is improving, but the write surface is still too broad.

Decision:

- Move behind a task-state repository plus transition service.
- Do not immediately replace with an external system.

Why not replace immediately:

- Guildhall task lifecycle is product-specific: owner input, spec review,
  gate check, fanout, proof receipts, bounded chat, and external authority are
  not generic issue-tracker states.

Next concrete slice:

- Add a `TaskStateStore` facade for queue reads/writes.
- Move status changes through explicit transition helpers.
- Make direct `TASKS.json` writes outside the facade fail the managed-path
  guardrail, except migrations.

### 3. Thin: Runtime API Surface In `serve.ts`

Current state:

- `serve.ts` is almost 10k LOC.
- It owns HTTP routing, project binding, startup maintenance, summary building,
  task actions, settings, learning, project graph endpoints, runtime setup, and
  UI payload assembly.

Decision:

- Thin aggressively.
- Do not replace Hono; Hono is small and adequate.

Next concrete slice:

- Extract project-state maintenance into `runtime/project-maintenance.ts`.
- Extract task endpoint handlers into `runtime/http/task-routes.ts`.
- Extract service/project summary builders into `runtime/project-summary-api.ts`
  or reuse the existing shared summary utilities where already present.

Success condition:

- `serve.ts` becomes composition and route registration, not business logic.

### 4. Move Behind Module Boundary: Orchestrator Loop

Current state:

- `orchestrator.ts` is over 10k LOC.
- It mixes loop control, dispatch policy, prompt/context building, progress
  writes, task mutation, recovery, review/gate handling, merge/checkpoint
  behavior, and receipt generation.

Decision:

- Move behind smaller modules.
- Keep bespoke orchestration policy for now.

Why not replace immediately:

- The agent loop is Guildhall's product core. Generic agent frameworks can help
  with memory, tools, or model execution, but they will not understand
  Guildhall's proof, owner-input, state-machine, and project-graph semantics.

Next concrete slice:

- Split into `dispatch-policy`, `task-transition-effects`,
  `progress-recorder`, `review-loop`, and `gate-loop`.
- Keep the public orchestrator API stable while moving internals.

### 5. Keep: Domain Reasoning And Review/Governance Models

Current state:

- Guilds, review rubrics, design-system governance, construction modes,
  acceptance gates, project graph authority, and proof paths are bespoke.

Decision:

- Keep.

Why:

- These are the differentiators that make Guildhall seem intelligent.
- Replacing them with generic memory or agent framework behavior would make the
  product less opinionated and less trustworthy.

Boundary requirement:

- Keep the models, but reduce filesystem and runtime coupling around them.

### 6. Thin Or Replace Later: Context Builder

Current state:

- `context-builder.ts` is 1,318 LOC.
- It still combines task summary rendering, file hint inference, corpus map
  retrieval, memory/progress/decision extraction, guild persona selection,
  environment manifesting, structural map slicing, and packet formatting.

Decision:

- Thin first.
- Replace retrieval internals later if memory-core or Mastra adapter proves
  better recall.

Next concrete slice:

- Extract renderers by section.
- Route memory section through `GuildhallMemory`.
- Keep explicit inclusion reasons and task-intent grounding.

### 7. Delete/Deprecate: Project-Local Backups And Append-Only Memory Logs

Current state:

- Migration backups and append-only progress logs were the direct source of the
  file-size failure.
- Compaction now moves heartbeat noise and terminal task evidence out of live
  state, but old local projects still need cleanup.

Decision:

- Delete/deprecate as durable memory.

Next concrete slice:

- Add cleanup command with dry-run:
  - remove project-local migration backups after confirming system-local copy;
  - compact old archive shards;
  - report remaining repo-local `.guildhall` bytes;
  - never delete opt-in exported manifests.

## Replacement Priority

1. Memory packet backend: replace raw file memory with `GuildhallMemory`.
2. Task state write surface: boundary first, then lifecycle migration.
3. `serve.ts`: thin route composition and move business logic out.
4. `orchestrator.ts`: modularize policy/effects without swapping the product
   brain.
5. Context builder: split renderers and plug in memory-core retrieval.
6. Optional adapters: Mastra first if it can satisfy the contract; Graphiti/Zep
   only if retrieval/fact quality beats deterministic memory-core on real
   project tasks.

## Non-Goals

- Do not replace Guildhall reasoning with a memory framework.
- Do not add a user-installed database service.
- Do not make repo-local `.guildhall` large again under a different name.
- Do not chase Graphiti/knowledge-graph complexity unless quality evidence
  beats the deterministic baseline.

## Immediate Decision

There is still useful work before opening the PR:

1. Wire `buildEffectiveMemoryPacket` to `GuildhallMemory`.
2. Add cleanup dry-run command for old project-local backups/logs.
3. Extract project-state maintenance from `serve.ts`.

After those, the branch will tell a much cleaner story: system-local state,
automatic compaction, bounded retrieval, and fewer direct raw-file memory paths.
