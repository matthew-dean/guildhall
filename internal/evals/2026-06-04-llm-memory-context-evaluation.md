# LLM Memory And Context Evaluation

## Decision

Adopt **Mastra Memory / Observational Memory** as Guildhall's first memory and
context substrate.

Graphiti is retired. It was explored, but it did not bear fruit for Guildhall's
product needs. Do not keep it as a roadmap item, fallback candidate, or narrow
future spike.

Memory module specs:

- `internal/specs/2026-06-04-guildhall-independent-memory-module.md`
- `internal/specs/2026-06-06-mastra-based-memory-improvements.md`

Keep **repo-local Guildhall state off or very thin by default** regardless of
the memory system. Any Git-visible manifest/export should be a small
Guildhall-owned optional layer, not a requirement imposed by Mastra.

Do **not** use Mastra, LangGraph, Letta, Mem0, LlamaIndex, or any memory system
to replace Guildhall's reasoning about the user's top-level request. Memory
tooling is substrate: scaling, storage, compaction workflow, retrieval, fact
extraction, and provenance. Guildhall still decides what belongs in context and
why, based on the active request, task goal, evidence quality, and explicit
omissions.

## Why Mastra

Mastra is the right first substrate if the product goal is to stop bloating
project repos while improving memory, compaction, and context workflow without
replacing Guildhall's reasoning layer.

Mastra's current memory docs describe the needed building blocks:

- `Memory` stores thread-based conversation history and supports explicit
  storage, `readOnly`, working memory, semantic recall, and Observational
  Memory.
- `@mastra/libsql` gives a local embedded storage path that fits Guildhall's
  system-local default.
- Observational Memory compresses long-running histories through Observer and
  Reflector agents.
- Observational Memory supports thread/resource scopes, temporal markers,
  retrieval modes, async buffering, and typed status/buffering events.
- Semantic recall can stay disabled until a separate vector/embedder gate proves
  latency, cost, and source-reference quality.

Mastra does not get to decide task truth, readiness, review, gates, or final
prompt inclusion. It can store, compact, retrieve, and expose candidate
evidence. Guildhall owns the context-inclusion policy.

## What Happened To Graphiti

Graphiti was explored as a graph/fact-memory path. It did not bear fruit.

Evidence from the retired prototype:

- managed Python and local Kuzu could run without a separate user-installed
  graph service;
- ingestion completed against live Fair Labor License and Looma/Knit fixture
  summaries;
- the Kuzu path needed an FTS/index shim for the prototype search path;
- default Graphiti search was weak for Guildhall's natural quality questions;
- useful output required a Guildhall-owned context-packet layer over extracted
  entity summaries, which meant Graphiti was not carrying enough product value
  to justify keeping it alive.

Disposition:

- remove executable Graphiti prototype code;
- keep this note as historical evidence only;
- do not add Graphiti kill switches, deferred tickets, or future roadmap
  language;
- continue with Mastra plus deterministic Guildhall fallback.

## What Happened To Letta / MemGPT

Letta/MemGPT remains a useful conceptual reference for memory hierarchy:
core/current context, recall/searchable history, and archival/deep evidence.
It was not selected because Guildhall needs a memory subsystem, not a broader
agent architecture replacement.

Do not integrate it unless Guildhall later chooses to adopt a broader
Letta-style agent architecture.

## Candidate Scores

These scores came from `scripts/evaluate-memory-context-candidates.mjs`, using
the rubric in
`internal/plans/2026-06-04-llm-memory-context-evaluation-spike.md`.

| Candidate | Total / 50 | Role |
| --- | ---: | --- |
| Minimal Guildhall baseline | 43 | Control and fallback: strict writer boundary plus deterministic rollups. |
| Mastra Memory / Observational Memory | 40 | Selected substrate for compaction workflow, scoped recall, and context support. |
| LangGraph / LangMem-style memory | 38 | Context-assembly reference, not current integration path. |
| Letta / MemGPT | 35 | Strong architecture reference for memory hierarchy. |
| Mem0 | 34 | Practical durable memory extraction reference. |
| LlamaIndex memory | 31 | Useful reference for token-budgeted memory blocks. |

The baseline scores highest because it can be perfectly local, provenance-heavy,
and repo-clean. It remains the fallback/control. Mastra is selected because it
adds memory/compaction workflow in the same TypeScript runtime while letting
Guildhall keep policy, provenance, and storage boundaries.

## Mastra Value Gate Result

2026-06-06 result: **adopt Mastra as the first memory substrate path**.

Command:

```sh
pnpm memory:mastra:value-gate -- --out artifacts/memory-core-prototype/mastra-value-gate.json --storage-root /tmp/guildhall-mastra-value-gate-cli
```

Evidence:

- Real dependencies are installed and recorded by the report:
  `@mastra/core@1.41.0`, `@mastra/libsql@1.12.1`, and
  `@mastra/memory@1.20.2`.
- The probe instantiates Mastra `Memory` with `LibSQLStore`, creates a scoped
  thread, and stores the DB at
  `/tmp/guildhall-mastra-value-gate-cli/memory/guildhall-mastra-memory.db`.
- The report records `repoLocalWrites: []`.
- The gate keeps Mastra substrate-only: Guildhall still owns context inclusion,
  task truth, and adoption/defer decisions.
- The comparison gate requires Mastra packets to beat deterministic baseline
  packet score. If they do not, the same harness returns `decision: "defer"`.
- The tested passing gate reported `decision: "adopt"` with:
  `actuallyIntegrated`, `systemLocalStorage`, `substrateOnly`,
  `sourceRefsPreserved`, `betterThanBaseline`, and `failureFallback` all true.

This is not an optional plugin recommendation. The next implementation should
move the selected memory substrate behind a Guildhall-owned memory-core API and
keep deterministic Guildhall summaries as fallback/control.

## Fixture Evidence

Generated evidence report:
`artifacts/memory-context-eval/current/candidate-report.md` (ignored).

Live fixture findings:

- Fair Labor License: audited `.guildhall` sources totaled about 1.42 MB.
  `.guildhall/TASKS.json` was about 568 KB across only 17 tasks; the largest
  fields were `notes`, `reviewVerdicts`, and `escalations`.
- Looma + Knit: audited `.guildhall` sources totaled about 1.57 MB.
  `PROGRESS.md` alone was about 1.05 MB with thousands of progress blocks.
- Jess: generated intelligence was the issue: `codebase-map.yaml` was about
  644 KB, and accepted/draft structural maps duplicated roughly 239 KB each.
- Narrative Harness: task migration backup plus task-state history created
  about 223 KB of audited project-local state.

The control context packets were all under 1 KB because they used summaries and
provenance references instead of raw histories. That is the shape Guildhall
should preserve.

## Next Implementation Step

Implement `internal/specs/2026-06-06-mastra-based-memory-improvements.md`:

1. Retire Graphiti prototype code and stale roadmap language.
2. Create `src/memory-core/` with data-layer-only reads/writes.
3. Move the Mastra value-gate behavior behind a Guildhall-owned adapter.
4. Build deterministic and Mastra candidate packets with source refs.
5. Add migration/audit proof that fixture `.guildhall` bloat is read without
   project mutation and compacted into system-local memory.
6. Add API/UI status that reports real memory/compaction/migration progress.

The writer-boundary fix remains mandatory regardless of the memory backend.

## Source Notes

- Mastra Memory class:
  <https://mastra.ai/reference/memory/memory-class>
- Mastra Observational Memory:
  <https://mastra.ai/reference/memory/observational-memory>
- Mastra createThread:
  <https://mastra.ai/reference/memory/createThread>
- Mastra Memory overview:
  <https://mastra.ai/docs/memory/overview>
- LangGraph memory remains a context-assembly reference:
  <https://docs.langchain.com/oss/javascript/langgraph/add-memory>
- Letta memory hierarchy remains a conceptual reference:
  <https://docs.letta.com/guides/agents/architectures/memgpt>
