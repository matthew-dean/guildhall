# LLM Memory And Context Evaluation Spike Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. This spike happens before implementing a new Guildhall memory/storage layer.

**Goal:** Evaluate existing open-source LLM memory systems for Guildhall's durable memory, compaction, provenance, and context-building needs before building custom infrastructure, assuming repo-local storage is off or very thin by default.

**Architecture:** Build a small adapter-and-benchmark harness around real Guildhall failure fixtures. Each candidate ingests the same noisy project histories into a system-local memory/context layer, produces compact memory/context outputs, and is scored on retrieval quality, compaction behavior, provenance, operational fit, and whether Guildhall can expose an optional thin repo-local manifest/export on top.

**Tech Stack:** TypeScript harness in `scripts/`, fixture snapshots from managed projects, local-only test outputs under ignored `artifacts/memory-context-eval/`, candidate adapters for Letta/MemGPT, Zep/Graphiti, Mem0, LangGraph/LangMem-style memory, LlamaIndex memory, and a minimal Guildhall baseline.

---

## Why This Spike Exists

Guildhall already failed once by claiming task-state/memory separation was implemented while real projects still accumulated huge project-local `.guildhall` files. The corrective action should not be to build an ornate custom memory layer by default.

This spike asks whether existing LLM memory systems can handle the part Guildhall should not reinvent:

- context-window compaction;
- durable memory extraction;
- temporal/superseded facts;
- provenance-aware retrieval;
- configurable retention;
- compact context packet assembly.

Guildhall may still need a strict project/system storage boundary, but the default should no longer assume a substantial project-local `.guildhall` state tree. The spike should evaluate memory/context systems as the primary state substrate, then treat repo-local storage as an optional, bespoke, very thin manifest/export layer that Guildhall can build on top when a project explicitly wants shared state in Git.

Important boundary: none of these systems should replace Guildhall's reasoning
or decide the top-level intent. They may help with scaling, storage, compaction
workflow, retrieval, fact extraction, and provenance. Guildhall must still own
the context-inclusion decision: what enters the prompt, what is omitted, and why
that evidence serves the user's current request.

## Candidates

Evaluate these first:

1. **Letta / MemGPT**
   - Strength to test: memory hierarchy, core/recall/archival split, context engineering.
   - Risk: may be agent-architecture-heavy rather than embeddable as a Guildhall memory subsystem.

2. **Zep / Graphiti**
   - Strength to test: temporal knowledge graph, episodes/facts/summaries, superseded facts.
   - Risk: operational dependency weight and fit for local-first product state.

3. **Mem0**
   - Strength to test: durable memory extraction with add/update/delete/noop semantics and broad integrations.
   - Risk: may optimize for user preference memory rather than typed project/task state.

4. **LangGraph / LangMem-style memory**
   - Strength to test: short-term trimming, summarization, checkpoint history, long-term stores, context assembly hooks.
   - Risk: framework adoption may be too invasive if Guildhall only needs a memory layer.

5. **LlamaIndex memory**
   - Strength to test: token-budgeted memory blocks and flush behavior.
   - Risk: likely better as a reference design than as a direct runtime dependency.

6. **Minimal Guildhall baseline**
   - SQLite/event store plus deterministic rollups and retrieval.
   - Purpose: not the preferred answer, but a control to compare external systems against when repo-local storage is thin or disabled.

## Repo-Local Storage Assumption

This spike should not require candidates to handle "spanning two memory locations" as a core feature. Evaluate them as if Guildhall's primary memory/context state lives system-local by default.

Repo-local state should be treated as an optional Guildhall-managed layer:

- **none:** no project-local Guildhall state except possibly ignored local config;
- **thin manifest:** portable registration/config/artifact IDs only;
- **shared team manifest:** explicitly opted-in compact task or decision summaries;
- **export snapshot:** deliberate one-time export for handoff/debug/archive, not live runtime state.

The candidate does not need native awareness of this split. Guildhall can own the optional manifest/export adapter if the candidate provides good memory, retrieval, compaction, and context assembly.

## Evaluation Fixtures

Use real failure shapes, scrubbed only where needed:

- **Fair Labor License task-state bloat**
  - Source: `/Users/matthew/git/oss/fair-labor-license/.guildhall/TASKS.json`
  - Shape: 17 tasks, huge notes/review verdicts/escalations.
  - Questions: "What is the current auth task status?", "What evidence matters?", "What was superseded?", "What should enter the next worker context?"

- **Looma + Knit progress bloat**
  - Source: `/Users/matthew/git/oss/looma-knit/.guildhall/PROGRESS.md`
  - Shape: over 1 MB append-only progress log.
  - Questions: "What happened recently?", "What is still actionable?", "Which repeated churn can be compacted?"

- **Jess generated intelligence bloat**
  - Source: `/Users/matthew/git/oss/jess/.guildhall/codebase-map.yaml` and structural maps.
  - Shape: generated codebase/structural intelligence stored too heavily.
  - Questions: "Can the memory system keep a useful project map without dumping every detail into prompt/project files?"

- **Narrative Harness migration backup**
  - Source: `/Users/matthew/git/oss/narrative-harness/.guildhall/TASKS.before-0.10.0-task-hierarchy-links.json`
  - Shape: backup/migration artifact in project-local state.
  - Questions: "Can the system distinguish durable memory from migration safety artifact?"

Fixtures must be copied into ignored eval input/output paths or read live in dry-run mode without mutating project state.

## Scoring Rubric

Each candidate gets a 0-5 score per category:

1. **Context assembly**
   - Can it produce a compact next-agent packet with current task state, relevant past evidence, project conventions, and explicit uncertainty?

2. **Compaction quality**
   - Can it turn noisy histories into durable summaries without losing important blockers, decisions, failed attempts, and owner preferences?

3. **Temporal correctness**
   - Can it represent superseded facts, current facts, resolved blockers, and stale evidence distinctly?

4. **Provenance**
   - Can every memory claim point back to raw evidence, task id, timestamp, or source artifact?

5. **Configurability**
   - Can Guildhall control retention, summarization prompts, memory classes, project/user scopes, and redaction rules?

6. **Local-first operational fit**
   - Can it run locally without a heavy service, cloud dependency, or fragile ops burden?

7. **Project-local cleanliness**
   - Can Guildhall keep repo-local state off or very thin while using this candidate? Does the candidate force live state into the project checkout?

8. **Integration surface**
   - Can Guildhall call it as a library/API from TypeScript, or would adoption force a larger framework rewrite?

9. **Cost and latency**
   - How many LLM calls, embedding calls, and graph/vector operations are needed per task tick?

10. **Failure behavior**
   - If memory extraction fails, does Guildhall still have safe task state and recoverable evidence?

## Required Outputs

Create:

- `internal/evals/2026-06-04-llm-memory-context-evaluation.md`
  - concise results, recommendation, and rejected options;
- `scripts/evaluate-memory-context-candidates.mjs`
  - repeatable harness entrypoint;
- `internal/evals/fixtures/memory-context/README.md`
  - fixture descriptions and redaction notes;
- ignored output directory:
  - `artifacts/memory-context-eval/<timestamp>/candidate-report.json`
  - `artifacts/memory-context-eval/<timestamp>/candidate-report.md`

Do not commit raw copied project histories unless they are tiny, scrubbed, and intentionally curated. Prefer scripts that read live local files and write reports to ignored artifacts.

## Spike Tasks

### Task 1: Build The Fixture Audit Harness

**Files:**
- Create: `scripts/evaluate-memory-context-candidates.mjs`
- Create: `internal/evals/fixtures/memory-context/README.md`
- Modify: `.gitignore` if `artifacts/memory-context-eval/` is not already ignored.

Steps:

- [ ] Add a harness that reads the four live fixture sources and reports byte counts, top fields, and sample task/progress snippets without sending anything to a model.
- [ ] Run it and confirm it reproduces the known failure shapes.
- [ ] Commit only the harness and fixture README, not generated reports.

### Task 2: Define Candidate Adapter Contract

**Files:**
- Modify: `scripts/evaluate-memory-context-candidates.mjs`

Steps:

- [ ] Add an adapter interface with `ingest(fixture)`, `compact(query)`, `retrieve(query)`, and `buildContextPacket(query)`.
- [ ] Implement the minimal Guildhall baseline adapter first as the control.
- [ ] Record output size, provenance refs, memory classes used, and failed assumptions.

### Task 3: Evaluate OSS Memory Candidates

**Files:**
- Modify: `scripts/evaluate-memory-context-candidates.mjs`
- Create generated reports under ignored `artifacts/memory-context-eval/`.

Steps:

- [ ] Evaluate Letta/MemGPT concepts first. If direct local integration is too heavy, write a concept adapter and record the operational blocker.
- [ ] Evaluate Zep/Graphiti. Prioritize temporal correctness and provenance.
- [ ] Evaluate Mem0. Prioritize memory extraction, update/delete/noop behavior, and retention configurability.
- [ ] Evaluate LangGraph/LangMem-style memory. Prioritize context assembly, checkpoint trimming, and summarization hooks.
- [ ] Evaluate LlamaIndex memory. Prioritize token flush and memory block mechanics.

### Task 4: Write Recommendation

**Files:**
- Create: `internal/evals/2026-06-04-llm-memory-context-evaluation.md`
- Modify: `internal/plans/2026-06-04-project-state-storage-governance-and-cleanup.md`

Steps:

- [ ] Score every candidate with evidence from the harness.
- [ ] Recommend one of:
  - integrate a candidate;
  - adopt candidate patterns but keep Guildhall storage;
  - reject external memory systems for now and implement the minimal baseline.
- [ ] Update the cleanup plan so implementation follows the spike result.

## Decision Gate

Do not implement the final storage/memory layer until the evaluation answers:

- Which system, if any, owns durable memory extraction?
- Which system, if any, owns context packet assembly?
- What compaction policy is configurable versus Guildhall-specific?
- What, if anything, needs to be stored in the repo by default?
- What optional thin manifest/export layer should Guildhall own on top of the selected memory system?
- What is the smallest writer-boundary fix we must implement regardless of memory system choice?

For the Graphiti prototype, the decision gate is pass/fail:

- It must be substrate only: storage, compaction workflow, retrieval, fact
  extraction, and provenance. It must not own top-level reasoning or final
  context-inclusion policy.
- It must run without system Python and without a default user-installed graph
  service.
- It must not depend on a hidden Kuzu FTS/index shim. Either upstream handles
  the index path, a tiny tested adapter owns it explicitly, or Graphiti fails
  this gate.
- It must beat the deterministic Guildhall baseline on retrieval quality for
  current blockers, stale evidence, repeated churn, related tasks, and
  next-worker context.
- It must preserve provenance for every retrieved summary/fact.
- It must meet context-size and warm-retrieval latency budgets that make the
  result usable in real Guildhall workflows.

If those conditions are not met in the adapter spike, stop Graphiti work and
use the baseline plus LangGraph-style context assembly patterns.

## Success Criteria

- We can explain why we are or are not adopting an existing LLM memory system.
- Context-building quality is part of the score, not an afterthought.
- Compaction is evaluated at both memory and prompt-context levels.
- Repo-local storage is evaluated as optional and thin by default, not as a required second memory location.
- The chosen path would have prevented the Fair Labor License and Looma+Knit bloat from reappearing.
- The spike produces a concrete next implementation plan, not another abstract strategy note.

## Result

Completed 2026-06-04.

- Evaluation: `internal/evals/2026-06-04-llm-memory-context-evaluation.md`
- Harness: `scripts/evaluate-memory-context-candidates.mjs`
- Generated report: `artifacts/memory-context-eval/current/candidate-report.md`
  (ignored)

Revised decision after product-quality review: prototype Zep/Graphiti first
because it has the most promise for project-aware temporal memory: current
facts, stale facts, resolved blockers, related tasks, decisions, and evidence
trails. Keep LangGraph / LangMem-style memory as the context-assembly reference
and possible second prototype if Graphiti retrieval needs a tighter packet
builder. Keep repo-local state off or very thin by default regardless of the
selected memory system.

Prototype evidence added 2026-06-04:

- `scripts/prototype-graphiti-project-memory.mjs` runs Graphiti through
  `uv --managed-python --python 3.12` and does not depend on system Python.
- Kuzu works as a local file-backed graph store; no separate user-installed
  database service was required.
- The prototype loads Guildhall global OpenAI-compatible provider config into
  the child process environment without leaking credentials into command-line
  arguments or reports.
- Graphiti ingestion completed against live Fair Labor License and Looma/Knit
  bloat fixtures.
- Graphiti's default search was weak for Guildhall's natural quality questions.
  The promising path is Graphiti extraction plus a Guildhall-owned
  context-packet builder over entity summaries and provenance.
- Next gate: prove retrieval precision and context-packet quality, not just
  dependency installation.
- Scope boundary: Graphiti or any other memory system is substrate only. It may
  help store, compact, retrieve, and extract facts, but Guildhall owns reasoning
  over the active request and the final context-inclusion policy.
