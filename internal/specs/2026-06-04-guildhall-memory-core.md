# Guildhall Memory Core

## Problem

Guildhall project state is too large because raw operational history, bulky task
evidence, migration backups, structural maps, and agent progress logs are being
kept as project-local files. The result is not just ugly storage: it makes
context construction less trustworthy because the next agent can accidentally
inherit volume instead of selected, justified memory.

The core memory module must own four jobs:

1. Decide what generated data is worth recording.
2. Compact raw events before they become durable prompt material.
3. Retrieve bounded candidate packets with inclusion and omission reasons.
4. Keep normal storage system-local by default, with repo-visible exports only
   as explicit thin manifests.

## Module Boundary

The module is discrete for spin-out value, but it does not have to avoid Mastra.
Guildhall product/runtime code should call `GuildhallMemory`; adapters may use
Mastra Memory, Observational Memory, libSQL, an embedded/WASM store, or a future
graph/fact extractor if that adapter passes the same contract.

Initial source boundary:

```text
src/memory-core/
  index.ts
  types.ts
  storage.ts
  deterministic.ts
  project-state-ingest.ts
  prototype-runner.ts
```

Current prototype API:

```ts
interface GuildhallMemory {
  recordEvent(input): Promise<StoredMemoryEvent>
  recordObservation(input): Promise<StoredMemoryObservation>
  compact(input): Promise<MemoryCompactionResult>
  buildCandidatePacket(input): Promise<MemoryCandidatePacket>
  audit(input): Promise<MemoryAuditResult>
}
```

## Storage Rules

- Default storage root is `GUILDHALL_DATA_DIR/memory` or
  `~/.guildhall/data/memory`.
- Project identity is a path hash, not a repo-local directory.
- `recordEvent` appends raw JSONL events only under system-local storage.
- `compact` replaces raw event logs with typed observations grouped by event
  type.
- Candidate packets clamp body/provenance size and always expose
  `reasonForInclusion` or an omission reason.
- `.guildhall` should become a thin project manifest/checklist/export surface,
  not the raw memory database.

## Prototype Evidence

Command:

```sh
pnpm exec vitest run src/memory-core/__tests__/deterministic.test.ts src/memory-core/__tests__/project-state-ingest.test.ts
node scripts/prototype-memory-core.mjs
```

Generated report:
`artifacts/memory-core-prototype/report.md` (ignored).

Live local project sample on 2026-06-04:

| Project | Project-local bytes scanned | Memory bytes after compaction | Candidate packet bytes |
| --- | ---: | ---: | ---: |
| Fair Labor License | 1,682,449 | 9,337 | 2,609 |
| Looma + Knit | 2,717,512 | 21,150 | 3,462 |
| Jess | 1,193,145 | 5,535 | 2,984 |
| Narrative Harness | 396,220 | 8,663 | 3,359 |

The important quality signal: the Fair Labor License packet now includes the
545KB `TASKS.before-0.10.0-task-hierarchy-links.json` migration backup as a
do-not-ingest-full-file memory signal, plus the 582KB task queue summary and
360KB progress-log summary. The module does not copy the backup body, task
notes, or raw progress log into the packet.

## Refactor Direction

Keep:

- Guildhall-owned reasoning about what belongs in context.
- Source references and explicit inclusion/omission reasons.
- Runtime summary/action model as the product-facing decision layer.

Replace:

- Project-local `MEMORY.md`/`PROGRESS.md`/large `TASKS.json` as memory sources
  of truth.
- Ad hoc prompt-packet builders that read raw project files directly.

Thin:

- `.guildhall/TASKS.json` to active/shared task manifest.
- `.guildhall/tasks/archive/*.json` to compact terminal task summaries.
- Structural maps to indexes/snapshots, not prompt memory blobs.

Kill:

- Repo-local migration backups.
- Append-only progress logs as a memory backend.

Defer:

- Mastra adapter until the deterministic contract is wired into existing
  context paths.
- Graphiti/Kuzu or other fact extraction until the packet contract proves the
  facts improve project quality.

## Refactor Slice 1

Implemented on `feature/memory-core-prototype`:

- `getProjectStateDir(projectRoot)` resolves to system-local state by default:
  `GUILDHALL_DATA_DIR/projects/<project-hash>/state`.
- `getProjectSharedStateDir(projectRoot)` is the explicit repo-local
  `.guildhall` location.
- `GUILDHALL_PROJECT_STATE_PLACEMENT=project` is the explicit opt-in for
  project-local state.
- `migrateProjectStateToSystem(projectRoot)` copies legacy `.guildhall` task,
  memory, progress, structural, bounded-chat, runtime, and evidence-like state
  into system storage and removes the migrated project-local entries.
- `guildhall serve` runs startup migration for registered projects and the
  selected project unless project-local placement is explicitly opted in.
- New workspace bootstrap seeds `TASKS.json`, `MEMORY.md`, `DECISIONS.md`, and
  `PROGRESS.md` in system state, not in the repo.
- The managed `.gitignore` block ignores `.guildhall/` by default; exports must
  be added through an explicit future policy instead of assumed.

## Next Implementation Steps

1. Route `buildEffectiveMemoryPacket` through `GuildhallMemory`.
2. Route project-state compaction/audit through `project-state-ingest` signals.
3. Add an operator-visible cleanup command that removes repo-local backups and compacts existing
   managed projects after a dry-run report.
4. Add a Mastra adapter spike only after the deterministic module can replace
   the current packet builder without worse recall quality.
