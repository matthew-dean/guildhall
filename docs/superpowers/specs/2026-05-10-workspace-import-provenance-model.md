# Workspace Import Provenance Model

## Why this exists

Guildhall's current workspace import journey is getting much better at
guiding the human through:

- project parts
- planning sources
- candidate tasks
- final import approval

But after approval, too much of that structure is flattened away.

Today Guildhall keeps enough model to:

- review the imported material coherently
- create real backlog tasks
- record goals
- log milestones

It does **not** yet keep enough durable structure to use those findings as a
first-class planning model later.

This document defines the next model step.

## Current truth

Guildhall currently has:

1. **A review-time structure**
   - area groups
   - source groups
   - candidate tasks
   - context notes
   - goals
   - milestones

2. **A post-approval flattening**
   - candidate tasks become ordinary Guildhall tasks
   - goals go into `workspace-goals.json`
   - milestones go into `PROGRESS.md`
   - task references survive only as note text

That means Guildhall loses too much answerable structure after import.

## Product problems caused by flattening

Without a durable provenance model, Guildhall cannot answer questions like:

- Which tasks came from the Looma component roadmap?
- Which planning sources have already been mined?
- Which sources were reviewed but skipped?
- Which source sections produced accepted tasks versus rejected ones?
- What backlog work is still missing relative to the planning corpus?
- Which imported tasks belong to the same planning initiative?

This weakens:

- future intake passes
- backlog confidence
- project memory
- adaptive learning
- product diagnostics

## Design goal

Preserve the structure Guildhall already found during import, and make that
structure useful after approval.

The import journey should not be the only place where Guildhall understands:

- parts
- sources
- candidate items
- acceptance/rejection decisions
- provenance

## Proposed durable model

Add a project-local import manifest, for example:

- `memory/workspace-import-manifests/<run-id>.json`

Each manifest should record:

### Import run

- `runId`
- `createdAt`
- `approvedAt`
- `projectPath`
- `version`

### Project parts

For each part:

- `partKey`
- `partLabel`
- `selected`
- aggregate counts

### Sources

For each source:

- `sourceKey`
- `sourceLabel`
- `path`
- `partKey`
- `kind`
- `selected`
- summary counts

### Candidate items

For each candidate:

- `candidateId`
- `kind`
  - `task`
  - `goal`
  - `milestone`
  - `context`
- `sourceKey`
- `partKey`
- original extracted title/summary
- acceptance state
  - `accepted`
  - `rejected`
  - `deferred`

### Task creation linkage

For accepted task candidates:

- `createdTaskId`
- `createdAt`

This is the critical bridge between the review structure and the live backlog.

## Important product rules

### 1. Import review structure should survive approval

Approval should not mean "throw away the structure and keep only the tasks."

### 2. Provenance should be inspectable, not noisy

Normal users should not have to live in the manifest.

But Guildhall should be able to surface provenance when useful:

- in task details
- in future import review
- in planning diagnostics

### 3. Future import passes should build on prior truth

Guildhall should know:

- what has already been reviewed
- what was accepted
- what was intentionally skipped
- what still has no downstream task representation

### 4. Learning should use real provenance, not only aggregate ratios

The adaptive learning loop is stronger if it knows:

- this user keeps accepting Looma roadmap tasks
- this user keeps skipping milestone-plan items
- this source tends to overproduce junk candidates

That is much better than only knowing "task acceptance ratio was 42%."

## What this unlocks later

With a durable provenance model, Guildhall can eventually support:

- source-aware re-intake
- "show missing work from source X"
- "these docs have never been fully reviewed"
- imported-task lineage in task details
- better project suggestions
- model/provider diagnostics on import quality by source type

## Scope

This is **not** part of the current UI polish slice.

This is the architecture follow-up that should come after the current guided
import journey is stable enough for real user testing.

## Recommended next implementation slice

1. Write one import manifest on approval
2. Link accepted task candidates to created task ids
3. Expose provenance in task details
4. Reuse the manifest in future import draft/review passes

That is the smallest meaningful version that preserves the structure Guildhall
already paid to discover.
