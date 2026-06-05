# LLM Memory And Context Evaluation

## Decision

Prototype **Mastra Memory / Observational Memory** first for Guildhall's memory
and context substrate.

Use **Zep / Graphiti** only as an optional fact-extraction or temporal-graph
spike if Mastra plus deterministic Guildhall summaries cannot provide enough
candidate evidence for context building.

Memory module spec:
`internal/specs/2026-06-04-guildhall-independent-memory-module.md`

Keep **repo-local Guildhall state off or very thin by default** regardless of
the memory system. Any Git-visible manifest/export should be a small
Guildhall-owned optional layer, not a requirement imposed on the memory system.

This decision is now folded into the broader architecture replacement audit:
`internal/plans/2026-06-04-guildhall-architecture-replacement-audit.md`. That
audit ranks storage and architecture surfaces as Keep, Thin, Replace, Kill, or
Defer, so Mastra/Graphiti/etc. are evaluated as substrate candidates instead of
as one-off memory experiments.

Do **not** use Mastra, Graphiti, LangGraph, Letta, Mem0, or any memory system to
replace Guildhall's reasoning about the user's top-level request. Memory tooling
is substrate: scaling, storage, compaction workflow, retrieval, fact extraction,
and provenance. Guildhall still decides what belongs in context and why, based
on the active request, task goal, evidence quality, and explicit omissions.

## Why Mastra First

Mastra is the better first substrate if the product goal is to stop bloating
project repos while improving memory, compaction, and context workflow without
replacing Guildhall's reasoning layer.

Repo evidence matters: Guildhall does not currently depend on Mastra. There are
no `@mastra/*` packages in `package.json` or the lockfile. If Mastra was assumed
to be the underlying layer, that assumption was false in the current codebase.

Mastra's Observational Memory is closer to the clarified boundary than
Graphiti: it is TypeScript-native, designed for long-running agent memory, and
compresses conversation history into observations and reflections rather than
replaying raw transcripts. Its retrieval mode keeps source message ranges
available and can expose recall/search as a tool. That is substrate work:
storage, compaction, scoped recall, source drill-down, and workflow.

The first Mastra prototype should test whether it helps Guildhall:

- what changed recently;
- which blockers are still current;
- which prior reviews are stale;
- which tasks relate through decisions, files, or handoffs;
- what should enter the next worker context and why.

Mastra does not get to decide any of those answers. It can compress and retrieve
candidate evidence. Guildhall still owns the context-inclusion policy.

Graphiti remains potentially useful for fact extraction and temporal graph
experiments, but the prototype already showed two concerns: default search was
weak for Guildhall's natural questions, and the Kuzu path needed an FTS-index
shim. That moves Graphiti behind Mastra, not ahead of it.

## What Happened To Letta / MemGPT

Letta/MemGPT is the strongest conceptual reference for memory hierarchy. Its
core-memory, recall-memory, and archival-memory framing is close to what
Guildhall needs when deciding what belongs in the next prompt, what should be
searchable, and what should be compacted into durable summaries.

It was not selected as the first prototype because the immediate Guildhall
problem is not to adopt a full agent architecture. Mastra gives us a narrower
TypeScript memory substrate to test first. Letta remains useful as a conceptual
reference for memory classes, especially core/current context, recall/searchable
history, and archival/deep evidence.

Letta also looks more agent-architecture-shaped than memory-subsystem-shaped.
That may be valuable later, but adopting it first risks pulling Guildhall toward
another full agent runtime when the near-term amends are narrower: stop bloating
project repos, assemble better context, and enforce writer boundaries.

Disposition:

- Do not discard Letta/MemGPT.
- Use its memory hierarchy as a design reference for Guildhall memory classes:
  "core/current context," "recall/searchable history," and
  "archival/deep evidence."
- Revisit it if Mastra plus Guildhall policy turns into too much custom memory
  machinery, or if Guildhall needs agents that can explicitly edit their own
  memory under policy.
- Do not make it the first integration unless we decide to adopt a broader
  Letta-style agent architecture, not just a memory/context layer.

## Candidate Scores

These scores came from `scripts/evaluate-memory-context-candidates.mjs`, using
the rubric in
`internal/plans/2026-06-04-llm-memory-context-evaluation-spike.md`.

| Candidate | Total / 50 | Role |
| --- | ---: | --- |
| Minimal Guildhall baseline | 43 | Control only: strict writer boundary plus deterministic rollups. |
| Mastra Memory / Observational Memory | 40 | Primary substrate prototype for compaction workflow, scoped recall, and context support. |
| LangGraph / LangMem-style memory | 38 | Context-assembly reference and possible second prototype. |
| Letta / MemGPT | 35 | Strong architecture reference for memory hierarchy. |
| Zep / Graphiti | 34 | Optional fact-extraction/temporal graph spike after Mastra. |
| Mem0 | 34 | Practical durable memory extraction candidate. |
| LlamaIndex memory | 31 | Useful reference for token-budgeted memory blocks. |

The baseline scores highest because it can be made perfectly local,
provenance-heavy, and repo-clean. It remains the control and fallback. Mastra is
the first external prototype because it can supply memory/compaction workflow in
the same TypeScript runtime without asking Graphiti to become the reasoning
layer.

## Mastra Prototype Gate

Prototype Mastra before additional Graphiti work.

Pass conditions:

- **Actually integrated:** add a real `@mastra/*` memory dependency or adapter
  prototype. Do not treat Mastra as present until the repo proves it.
- **Substrate only:** Mastra can store, compact, retrieve, and expose recall.
  Guildhall owns context-inclusion policy and top-level request reasoning.
- **Scoped memory:** project/task/thread/resource scopes must map cleanly to
  Guildhall projects, tasks, and agents without cross-thread task contamination.
- **Source ranges:** compacted observations must retain drill-down pointers to
  raw source events/messages/evidence.
- **Repo-clean:** Mastra storage must live in system-local storage by default;
  repo-local state remains off/thin.
- **Better than baseline:** Mastra must produce smaller or higher-quality
  candidate evidence packets than deterministic Guildhall summaries alone.
- **Failure behavior:** failed observation/reflection/retrieval must fall back
  to deterministic summaries and never block cleanup or task-state writes.

Kill conditions:

- It cannot run locally in Guildhall's TypeScript runtime without large service
  assumptions.
- Resource-scoped memory causes one project/task/thread to continue another's
  work or blur active goals.
- Observations lose provenance or cannot page back to raw source evidence.
- It reduces prompt size but worsens context relevance compared with the
  deterministic baseline.
- It starts acting as context authority instead of candidate evidence substrate.

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

## Graphiti Prototype Evidence

Prototype script:
`scripts/prototype-graphiti-project-memory.mjs`

Python probe:
`scripts/prototype_graphiti_project_memory.py`

Generated report:
`artifacts/memory-context-eval/graphiti-prototype/report-quality-attempt.json`
(ignored).

Result from 2026-06-04:

- `uv --managed-python --python 3.12` used managed Python 3.12.13, not system
  Python.
- `graphiti-core[kuzu]` and `kuzu` installed and ran without requiring the user
  to install a separate database service.
- Guildhall global OpenAI-compatible provider config was loaded into the child
  process environment without putting secrets in command-line arguments or the
  report.
- The local Kuzu backend opened, `KuzuDriver` initialized, and Graphiti
  ingested Fair Labor License and Looma/Knit fixture summaries.
- Graphiti's Kuzu path needed an integration shim: the Kuzu driver creates the
  schema but not the FTS indexes that its own search path expects, so the
  prototype calls Graphiti's `get_fulltext_indices(GraphProvider.KUZU)`.
- Default `graphiti.search()` was not good enough for Guildhall quality gates:
  the three natural questions returned only generic facts such as project-root
  relationships.
- Querying Graphiti-extracted entity summaries through Kuzu FTS did produce
  useful compact context. It recovered task counts, active statuses, large task
  offenders, progress-log escalation counts, and "next worker context" style
  summaries from the bloated fixture inputs.

Disposition: Graphiti remains worth keeping as a secondary spike, but not as the
first substrate and not as a drop-in answer.
Guildhall needs a project-memory adapter that feeds Graphiti typed compact
episodes, creates/validates Kuzu indexes, and owns final context-packet assembly
over retrieved entity summaries. The adapter must feed the original user/task
intent; it must not let retrieved memory redefine the goal or replace reasoning
about which evidence is relevant. The next quality gate is retrieval precision,
compaction usefulness, and context-packet support, not dependency installation.

## Brutally Specific Decision Gate

Graphiti/Kuzu continues only if it proves useful as substrate. It does not get
to become the reasoning layer, and it does not get a pass for fragile plumbing.

Pass conditions:

- **No hidden shim:** Kuzu FTS/index creation must be handled by upstream
  Graphiti, a tiny audited adapter with tests, or a different maintained graph
  backend. A silent runtime patch is not acceptable product behavior.
- **No system Python:** installation and execution must stay under
  `uv --managed-python` or a bundled runtime path.
- **No user-installed service by default:** the default path must not require a
  user to install Neo4j, FalkorDB, Docker, or a graph service.
- **Better than baseline:** for FLL and Looma fixture questions, the Graphiti
  adapter must return materially better candidate evidence than the
  deterministic Guildhall baseline.
- **Context help, not context authority:** retrieved facts may enter the
  candidate evidence pool only. Guildhall owns final inclusion, omissions, and
  why the evidence serves the active request.
- **Provenance:** every retrieved summary or fact must carry source project,
  source artifact/event, task id when applicable, and generated-at/observed-at
  time.
- **Compaction budget:** next-worker context output must stay small enough to be
  prompt-useful. Target: under 4 KB for a single task context packet and under
  16 KB for a multi-project handoff packet, excluding explicitly requested
  drill-down evidence.
- **Latency budget:** cold ingestion can be slower, but warm retrieval plus
  context-packet assembly must be fast enough for UI/task startup use. Target:
  p95 under 2 seconds on the local prototype fixtures after ingestion.
- **Failure behavior:** if extraction, embedding, or graph search fails,
  Guildhall must fall back to deterministic summaries and still preserve task
  state, provenance pointers, and cleanup safety.

Kill conditions:

- Kuzu remains dependent on an unaudited FTS/index shim after the adapter spike.
- Default or expanded Graphiti retrieval cannot beat the deterministic baseline
  on current blockers, stale evidence, repeated churn, and next-worker context.
- Useful results require dumping raw histories or giant task blobs into
  episodes.
- Provenance cannot be made reliable without a large custom side channel.
- Provider/model compatibility remains brittle across OpenAI-compatible
  providers.
- Warm retrieval/context assembly is too slow for normal Guildhall workflows.
- The adapter starts replacing Guildhall's reasoning about user intent instead
  of feeding candidate evidence into it.

Immediate next test for Graphiti: only after the Mastra substrate gate, implement
the smallest adapter that satisfies the pass conditions against FLL and Looma.
If any kill condition is triggered and not fixed inside that spike, stop
Graphiti work and continue with Mastra or the deterministic Guildhall baseline
plus LangGraph-style context assembly patterns.

## Source Notes

- LangGraph docs describe short-term memory, long-term stores, trimming,
  deletion, summarization, checkpoints, and semantic search hooks:
  <https://docs.langchain.com/oss/javascript/langgraph/add-memory>
- Mastra docs describe Observational Memory, observation/reflection compaction,
  thread/resource scopes, recall over source ranges, semantic search, and memory
  processors:
  <https://mastra.ai/blog/changelog-2026-02-04>
  and <https://mastra.ai/reference/memory/observational-memory>
- Letta docs describe core memory, recall memory, archival memory, and
  automatic compaction of older messages into recursive summaries:
  <https://docs.letta.com/guides/agents/architectures/memgpt>
- Zep/Graphiti docs describe episodes, entity/fact extraction, summaries,
  temporal graph retrieval, and invalidating outdated facts while preserving
  history:
  <https://help.getzep.com/v2/understanding-the-graph>
  and <https://www.getzep.com/platform/graphiti/>
- Graphiti's Kuzu docs describe Kuzu as embedded/no-service and say schema/index
  creation happens during driver initialization, while noting Kuzu's schema
  constraints:
  <https://getzep-graphiti.mintlify.app/integrations/kuzu>
- The Graphiti issue tracker currently has an open Kuzu maintenance concern:
  <https://github.com/getzep/graphiti/issues/1132>
- Mem0 docs describe open-source memory add/search/get/list/update/delete
  operations and inferred versus raw memory ingestion:
  <https://docs.mem0.ai/>
- LlamaIndex docs describe token limits, flush size, memory blocks, and
  inserting memory block content into chat context:
  <https://developers.llamaindex.ai/python/framework-api-reference/memory/memory>

## Next Implementation Step

Do not clean live project `.guildhall` state yet. First prototype Mastra Memory
as the system-local substrate:

1. Wire a real Mastra Memory/Observational Memory adapter or spike harness.
2. Feed it compact FLL and Looma fixture events without mutating those projects.
3. Verify observation/reflection compaction, recall source ranges, scope
   behavior, failure fallback, and repo-local cleanliness.
4. Compare Mastra-produced candidate evidence packets against the deterministic
   Guildhall baseline.
5. Only if Mastra cannot cover fact extraction or temporal relationships,
   evaluate Graphiti as a secondary substrate for that narrow purpose.

The writer-boundary fix remains mandatory regardless of the memory backend.
