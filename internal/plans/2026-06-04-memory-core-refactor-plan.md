# Memory Core Refactor Plan

## Categories

### Keep

- Guildhall decides what context is included and why.
- Runtime/product surfaces consume shared summary/action results.
- Task truth remains deterministic and auditable.

### Thin

- Project `.guildhall` state becomes manifests, active task summaries, artifact
  registry, and optional exports.
- Archived task state becomes compact summaries with system-local evidence.
- Structural maps become indexed data sources, not prompt blobs.

### Replace

- Replace current memory packet construction with `@guildhall/memory-core`.
- Replace project-local progress-memory with event recording plus compaction.
- Replace after-the-fact cleanup as the primary safety net with write-time
  retention policy.

### Kill

- Project-local migration backups.
- Append-only `PROGRESS.md` as a durable memory backend.
- Any path that copies bulky task notes/reviews/gates into prompt memory.

### Defer

- Mastra Memory / Observational Memory adapter.
- Graphiti/Kuzu fact extraction.
- Full DB substrate decision beyond file-backed deterministic prototype.

## Aggressive Slice

Done in slice 1:

- System-local project state is now the default path for task, memory, and
  storage state.
- Repo-local `.guildhall` is ignored by default.
- Existing legacy `.guildhall` task/memory/storage files migrate into system
  state at `guildhall serve` startup.
- Workspace import, pressure-test intake, bounded project check-in, and owner
  input project-root inference were patched for system-state paths.

Next:

1. Wire `buildEffectiveMemoryPacket` to call `GuildhallMemory.buildCandidatePacket`
   while preserving current behavior behind a fallback.
2. Add memory-core audit output to project-state compaction dry runs.
3. Add a cleanup command for backups and oversized logs with dry-run proof.
4. Re-run the live four-project prototype after each slice and require:
   - no project-local memory writes;
   - candidate packets under 3.5KB for the storage-bloat intent;
   - migration backups and oversized maps appear as explicit signals;
   - raw backup/task-note/progress bodies do not appear in packets.
