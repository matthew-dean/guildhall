# Memory Scalability Pressure Test

Date: 2026-06-04
Branch: `feature/memory-core-prototype`

## Purpose

Prove that Guildhall can tolerate 10x historical task and memory growth without
letting active runtime state, retrieval packets, or worker context balloon.

The test is not trying to replace reasoning. It checks the storage and workflow
plumbing that feeds reasoning:

- automatic project-state compaction;
- bounded live task queue;
- system-local archive evidence;
- summarized memory ingest;
- bounded candidate packet retrieval;
- bounded just-in-time context construction.

## Committed Test

`src/runtime/__tests__/memory-scalability.test.ts`

The test seeds:

- 500 old terminal tasks, each with bulky notes, gate results, and spec text;
- 10 active in-progress tasks;
- 2 blocked tasks;
- 2 shelved tasks that must remain visible;
- 300 noisy progress heartbeats;
- an oversized 1,000-file codebase map.

It then runs `compactProjectState`, ingests project-state summaries through
`GuildhallMemory`, builds a memory candidate packet, and calls `buildContext`
for the active task.

## Latest Local Result

Command:

```sh
pnpm exec vitest run src/runtime/__tests__/memory-scalability.test.ts
```

Result:

```json
{
  "historicalTasks": 500,
  "tasksBytesBefore": 8890348,
  "stateBytesBefore": 9468567,
  "stateBytesAfter": 155204,
  "archivedTasks": 500,
  "activeTasksKept": 14,
  "archiveFiles": 500,
  "localHistoryFiles": 1010,
  "packetBytes": 2917,
  "contextBytes": 3286,
  "compactionMs": 747,
  "ingestMs": 291,
  "contextMs": 51
}
```

Interpretation:

- Live state shrank from 9.47MB to 155KB, a 61.0x reduction.
- The live queue kept active, blocked, and shelved tasks visible.
- Old terminal evidence moved to system-local task history.
- The candidate packet stayed under 3KB.
- The worker context stayed under 4KB for this fixture.
- Runtime compaction, memory ingest, and context construction were all comfortably
  below their test ceilings on this machine.

## Bug Found

The pressure test exposed a semantic mismatch:

- `project-state-compaction.ts` treats `shelved` as visible and non-terminal.
- `project-state-ingest.ts` still counted `shelved` as terminal.

Fixed by aligning memory ingest terminal statuses to `done`, `cancelled`, and
`archived`.

## Remaining Scalability Risks

1. This test proves a single-project 10x historical fixture. It does not yet
   prove fleet-scale service startup across many large projects.
2. `compactProjectState` writes one archive file and one local-history evidence
   file per archived task. That is acceptable for hundreds of historical tasks,
   but thousands may need batched archive indexes or SQLite/libSQL-backed
   storage.
3. `buildContext` is bounded, but it still reads several files directly from the
   state directory. The next memory slice should route `buildEffectiveMemoryPacket`
   through `GuildhallMemory.buildCandidatePacket` so retrieval policy is shared.
4. The test uses generous timing ceilings to avoid CI flakes. The logged metrics
   are the actual pressure signal.

## Next Engineering Move

Keep this test in the normal focused memory suite and add a second fleet-scale
test only after the single-project memory-core replacement path is wired into
`buildEffectiveMemoryPacket`.
