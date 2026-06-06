# Guildhall Architecture Replacement Audit Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Audit Guildhall's storage and architecture surfaces, then rank each surface as Keep, Thin, Replace, Kill, or Defer with evidence.

**Architecture:** The audit separates product authority from substrate. Guildhall keeps bespoke logic where it owns task truth, context-inclusion reasoning, provenance policy, review/gate semantics, and project storage boundaries. It evaluates replacement or thinning where Guildhall rebuilt commodity substrate: memory storage, compaction, recall, observation/reflection, workflow snapshots, tracing, tool schema plumbing, and generated artifact storage.

**Tech Stack:** TypeScript, existing Guildhall runtime modules, repository file audits, package/dependency checks, ignored generated reports under `artifacts/architecture-replacement-audit/`, internal Markdown reports under `internal/audits/`.

---

## Ranking Categories

Every audited surface gets exactly one category:

| Category | Meaning | Required Evidence |
| --- | --- | --- |
| **Keep** | Bespoke Guildhall logic is justified and should remain owned here. | Clear product authority, good behavior, manageable size/complexity, regression tests. |
| **Thin** | Keep Guildhall policy, replace or reduce custom substrate underneath. | Bespoke layer mixes policy with commodity storage/runtime mechanics. |
| **Replace** | A library/framework should own most of this surface. | External candidate is clearly better on reliability, size, integration, or maintenance. |
| **Kill** | Surface should not exist or should not persist by default. | No durable workflow need, duplicate state, generated bulk, or unsafe repo-local growth. |
| **Defer** | Not healthy enough to bless, but not currently causing enough damage to touch. | Unknowns are listed, and revisit trigger is explicit. |

## Audit Scope

Audit both kinds of failure:

1. **Storage sprawl and size**
   - files Guildhall writes;
   - project-local versus system-local placement;
   - byte growth and file count;
   - append-only logs and backups;
   - generated maps/drafts;
   - direct writers that recreate bloat after cleanup.

2. **Architecture replacement opportunities**
   - memory storage and compaction;
   - observation/reflection and recall;
   - context packet substrate;
   - workflow snapshots/resume;
   - tracing/observability;
   - tool schemas/registry;
   - agent loop/runtime;
   - MCP bridge and external memory ingestion.

## Initial Ranking Hypotheses

These are hypotheses, not final decisions. The audit must confirm or change
them with file paths, byte counts, tests, and candidate comparisons.

| Surface | Initial Rank | Why |
| --- | --- | --- |
| Task truth and lifecycle policy | **Keep** | Guildhall owns status semantics, review/gate transitions, owner-input policy, and task readiness. |
| Context-inclusion reasoning | **Keep** | Guildhall must decide what enters context and why based on the active request. No memory system should replace this. |
| Project/repo storage boundary | **Keep** | This is product policy and trust boundary. It must stay explicit and enforced by Guildhall. |
| Project-local `TASKS.json` as bulky shared state | **Thin** | Keep optional compact task summaries, move runtime/evidence/history out. |
| Project-local `PROGRESS.md` append-only log | **Kill** | It creates repo-local unbounded growth. Replace with local events plus compact optional summary. |
| Migration backup files in project `.guildhall/` | **Kill** | Backups are safety artifacts and belong in local history, not project checkouts. |
| Generated `codebase-map.yaml` / structural-map drafts in repo | **Thin** | Keep compact accepted summaries or hashes; move generated bulk/drafts to system-local artifacts. |
| Custom memory storage and compaction substrate | **Replace** | Current behavior sprawls. Evaluate Mastra Memory/Observational Memory first as TypeScript-native substrate. |
| Memory/context policy | **Keep** | Guildhall owns scopes, acceptance, provenance, risk, and inclusion/omission decisions. |
| Graphiti/Kuzu fact extraction | **Kill** | Explored and retired. Local plumbing worked, but default search and product value did not justify keeping it on the roadmap. |
| LangGraph/LangMem-style context assembly | **Defer** | Useful reference; adoption may be too broad unless Mastra/baseline fails. |
| Letta/MemGPT architecture | **Defer** | Strong conceptual reference, likely too full-agent-shaped for immediate substrate replacement. |
| OpenHarness/QueryEngine agent loop | **Keep** for now | It solved real tool-loop/runtime needs. Re-audit only after memory/storage replacement scope is understood. |
| Mastra Agent as primary runtime | **Defer** | Historical wrappers were insufficient, but that does not disprove modern Mastra. Not part of first storage-sprawl fix. |
| Mastra Memory/Observational Memory | **Replace** | Selected first memory substrate after the value gate: TS-native compaction, observations/reflections, scoped recall, source ranges. |
| Session persistence / mid-turn resume | **Defer** | Existing QueryEngine sessions may be adequate; audit size, retention, and cleanup before replacement. |
| Tool schema helper layer | **Thin** | Keep Guildhall tool policy; consider external schema/helper only if it removes custom maintenance. |
| Tracing/observability | **Thin** | Guildhall needs product events, but commodity tracing may reduce bespoke telemetry paths. |
| External-agent memory bridge | **Thin** | Keep review/accept/reject policy; storage and compaction substrate may move. |

## Required Outputs

- `internal/specs/2026-06-04-guildhall-independent-memory-module.md`
  - discrete memory module boundary and Mastra substrate requirements;
  - may use Mastra Agent/runtime internally if that is the right implementation;
  - must expose a Guildhall-owned API with spin-out potential.
- `internal/audits/2026-06-04-architecture-replacement-audit.md`
  - final ranking table;
  - evidence per surface;
  - candidate replacement notes;
  - follow-up implementation order.
- `scripts/audit-guildhall-persistence-surfaces.mjs`
  - repeatable file/write-surface audit.
- `artifacts/architecture-replacement-audit/<timestamp>/persistence-surfaces.json`
  - ignored generated evidence.
- Updates to:
  - `internal/plans/2026-06-04-project-state-storage-governance-and-cleanup.md`;
  - `internal/evals/2026-06-04-llm-memory-context-evaluation.md`;
  - `internal/audits/flow-audit.md`.

## Task 1: Build The Persistence Surface Inventory

**Files:**
- Create: `scripts/audit-guildhall-persistence-surfaces.mjs`
- Create generated output only under: `artifacts/architecture-replacement-audit/`

- [ ] Write a script that scans `src/`, `scripts/`, `docs/`, `internal/`, and `.guildhall/` for persistence writes and durable file paths.
- [ ] Capture path patterns such as `.guildhall/`, `memory/`, `PROGRESS.md`, `TASKS.json`, `codebase-map`, `structural-map`, `local-history`, `events.jsonl`, `transcripts`, and `sessions`.
- [ ] Emit JSON grouped by surface: task state, progress, decisions, memory, generated maps, sessions, transcripts, artifacts, backups, MCP bridge.
- [ ] Run the script and save ignored output under `artifacts/architecture-replacement-audit/current/`.

## Task 2: Measure Live Managed Project Sprawl

**Files:**
- Modify: `scripts/audit-guildhall-persistence-surfaces.mjs`
- Generated output only under: `artifacts/architecture-replacement-audit/`

- [ ] Add live project inputs for Fair Labor License, Looma/Knit, Jess, Narrative Harness, Font Something, T Minus T, Commerce Project, and Guildhall.
- [ ] Report `.guildhall` total bytes, file count, top files, generated files, backup files, append-only logs, and forbidden task fields.
- [ ] Mark each file as repo-local, system-local, generated, backup, append-only, compact summary, or unknown.
- [ ] Emit before-cleanup evidence.

## Task 3: Rank Storage Surfaces

**Files:**
- Create: `internal/audits/2026-06-04-architecture-replacement-audit.md`

- [ ] Rank each storage surface as Keep, Thin, Replace, Kill, or Defer.
- [ ] For each rank, include evidence: file paths, byte counts, writer paths, retention rule, and cleanup action.
- [ ] Require a reason for every project-local durable file class.
- [ ] Identify writers that can recreate bloat after cleanup.

## Task 4: Rank Architecture/Substrate Surfaces

**Files:**
- Modify: `internal/audits/2026-06-04-architecture-replacement-audit.md`

- [ ] Rank memory storage, compaction, recall, context packet substrate, agent loop, sessions/resume, tracing, tool schemas, MCP bridge, external memory bridge, and generated artifact handling.
- [ ] Compare candidates only as substrate:
  - Mastra Memory / Observational Memory;
  - deterministic Guildhall baseline;
  - retired Graphiti/Kuzu evidence;
  - LangGraph/LangMem-style memory;
  - Letta/MemGPT;
  - Mem0;
  - LlamaIndex memory.
- [ ] Do not let any candidate replace Guildhall's reasoning/context-inclusion policy.
- [ ] Identify which replacement candidates need prototypes and which are only conceptual references.

## Task 5: Produce Replacement Order

**Files:**
- Modify: `internal/audits/2026-06-04-architecture-replacement-audit.md`
- Modify: `internal/plans/2026-06-04-project-state-storage-governance-and-cleanup.md`
- Modify: `internal/evals/2026-06-04-llm-memory-context-evaluation.md`
- Modify: `internal/audits/flow-audit.md`

- [ ] Produce an ordered implementation plan that starts with the highest-damage storage sprawl fixes.
- [ ] Separate immediate cleanup blockers from substrate replacement experiments.
- [ ] Define kill switches for Mastra and any active external candidate.
- [ ] Keep the writer-boundary fix mandatory regardless of selected substrate.

## Success Criteria

- Every durable Guildhall storage surface has an owner, budget, retention rule,
  and ranking.
- Every architecture substrate surface has a Keep/Thin/Replace/Kill/Defer
  decision or an explicit Defer trigger.
- The audit explains which bespoke pieces are justified product policy and which
  bespoke pieces are accidental infrastructure.
- The next implementation order prioritizes file sprawl and size before broader
  runtime rewrites.
- The final audit makes it impossible to claim cleanup is complete while writers
  can still recreate project-local bloat.
