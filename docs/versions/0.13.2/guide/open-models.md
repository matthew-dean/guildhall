---
title: Open model recommendations
---

# Open model recommendations

Guildhall can run different models for different agent roles. During
development, we test open and open-weight models against saved Guildhall task
prompts so the defaults stay grounded in the work the agents actually do:
blueprint drafting, coordinator decisions, bounded implementation, review, and
gate checking.

These notes are intentionally practical. They are not a benchmark leaderboard,
and they are not a provider preset. They summarize what we have found while
testing Guildhall.

Guildhall is designed to help cheaper models compete on quality by giving them
clearer task boundaries, project context, role-specific prompts, deterministic
checks, review steps, and proof requirements. That makes OpenAI-compatible
providers that serve inexpensive open models especially interesting, even though
Guildhall does not ship a preferred provider or configure one for you.

Structured Guildhall runs need tool calls or strict `response_format` JSON
support. Reasoning controls are applied by role/model policy when the provider
supports them, and Guildhall does not send paid priority `service_tier` settings
by default.

## What We Have Found

| Role | Model we have evidence for | What we found | Still checking |
|---|---|---|---|
| `spec` | `deepseek-ai/DeepSeek-V4-Flash` | Strong enough for project framing without needing one of the largest models. | Long, ambiguous specs still need more replay coverage. |
| `coordinator` | `deepseek-ai/DeepSeek-V4-Flash` | Good structured decisions for promotions, blockers, and task routing. | Deterministic guards still matter. |
| `worker` | `deepseek-ai/DeepSeek-V4-Flash` | Surprisingly good frontend implementation quality for a model branded as Flash. | More full edit/verify tasks, especially against Qwen coding challengers. |
| `reviewer` | `nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning` | Useful evidence so far is for fast, structured review-style prompts. | Schema reliability and tougher code-review cases. |
| `gateChecker` | `deepseek-ai/DeepSeek-V4-Flash` or no model | Gate checks mostly run commands and parse evidence. A model is useful only when summarizing failures or choosing a recovery path. | Command exit codes and explicit checks stay in charge. |
| `contextIndexer` | `nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning` | Useful evidence so far is for fast structured context passes. | GLM still looks stronger for deeper semantic summaries. |

What surprised us:

- DeepSeek V4 Flash has been better at frontend implementation than its
  "Flash" name suggests.
- The Qwen coding models looked promising on reputation and some replay slices,
  but they were weaker than expected on real frontend work: more brittle
  styling choices, less reliable design-system reuse, and less convincing
  finish quality. They stay in the comparison set, not the default.
- Nemotron has only earned narrower evidence so far: review-style and
  context-indexing prompts. We do not yet have enough full implementation
  evidence to recommend it for worker tasks.
- GLM still looks strong for deeper semantic summaries and remains the model to
  beat for richer [Corpus Map](./corpus-map) enrichment.

Models we still compare:

- `Qwen/Qwen3.5-35B-A3B` did well in a small implementation test and advertises
  cached-input pricing, but our broader frontend checks made us less confident
  in it as the default worker.
- `Qwen/Qwen3-Coder-480B-A35B-Instruct-Turbo` is a plausible premium worker
  model for difficult code tasks. It was fast in a small implementation test, but it
  costs more than the smaller Qwen option.
- `Qwen/Qwen3.5-397B-A17B` and `moonshotai/Kimi-K2.6` both advertise cached
  input pricing, but our checks have not made them clear defaults.
- `Qwen/Qwen3-235B-A22B-Thinking-2507` advertises cached input pricing, but it
  was inconsistent in small implementation tests and its cached input discount is
  shallow, so do not use it as the default worker lane without stronger
  follow-up evidence.
- `openai/gpt-oss-120b` is worth retesting for reviewer-style work after
  Guildhall has a stricter schema-repair path for model outputs.
- `zai-org/GLM-4.7-Flash`, `MiniMaxAI/MiniMax-M2.5`, and
  `stepfun-ai/Step-3.5-Flash` are not recommended for structured Guildhall
  lanes from the current replay set unless the provider/output-format path is
  changed and retested.

## How we test

Model testing replays the same frozen task input across each candidate:

- the exact agent role prompt,
- the same task context and project facts,
- the same tool schema or response format,
- the same role-specific scoring rubric,
- captured latency, token use, schema compliance, and decision quality.

Deterministic checks come first. A model that chooses the right answer but
cannot return the expected shape is not ready for a structured Guildhall lane.

## What the comparison means

This is not a general leaderboard. Guildhall cares about a specific kind of
work: shaping tasks, editing real projects, respecting existing UI systems,
returning structured decisions, and leaving proof a reviewer can trust.

That is why the recommendation may look odd if you are expecting the best-known
coding model to win by default. In our current frontend-heavy checks, DeepSeek
V4 Flash was more useful than expected, and several Qwen models were less
useful than expected. The main lesson is simple: measure full task outcomes,
not model reputation.

## Compare models locally

Use the built-in replay harness to generate a deterministic report:

```bash
guildhall model-bakeoff
```

By default, this writes:

- `artifacts/model-bakeoff/model-bakeoff-report.json`
- `artifacts/model-bakeoff/model-bakeoff-report.md`

You can choose another JSON output path:

```bash
guildhall model-bakeoff artifacts/model-bakeoff/my-report.json
```

To run the context-indexer replay specifically:

```bash
guildhall model-bakeoff --context-indexer
```

The current command uses saved replay scenarios and simulated model lanes. It
is useful for checking Guildhall's reporting, scoring, and learning-candidate
pipeline without spending provider credits.

The context-indexer replay set covers semantic code orientation: canonical
abstraction selection, legacy/current path detection, design-system drift, and
module relationship summaries. Current open-model candidates are
`deepseek-ai/DeepSeek-V4-Flash`,
`nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning`,
`Qwen/Qwen3.6-35B-A3B`, and `zai-org/GLM-4.6`.

The context-indexer report also records the real-project test ladder Guildhall
uses when moving from replay checks to provider-backed evaluation:

| Track | Corpus shape | What it tests |
|---|---|---|
| Documentation corpus | Product theory and planning notes | Product theory, specs, decisions, and architecture intent without claiming code exists where it does not. |
| Code corpus | Small-to-medium real codebase | Enough structure to compare architecture summaries and read-next guidance. |
| Design-system slice | Shared UI and token files | Whether the indexer steers workers toward shared primitives instead of one-off controls or styling. |
| Hard architecture | Deeper compiler/parser-style codebase | Whether summaries stay bounded and correct in a more complex architecture. |

## Planned live comparison mode

The live version adds provider-backed candidate runs:

```bash
guildhall model-bakeoff --live \
  --provider openai-api \
  --models deepseek-ai/DeepSeek-V4-Flash,nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning,Qwen/Qwen3.5-35B-A3B \
  --judge-model deepseek-ai/DeepSeek-V4-Flash
```

The judge model is not the whole evaluation. Guildhall scores hard facts first:

- Did the model return valid structured output?
- Did it call the right tool or produce the expected decision?
- Did it avoid false approvals and false escalations?
- Did it preserve the task's acceptance criteria?
- How long did it take, and how many tokens did it use?

After that, an explicit judge model can compare outputs under a rubric and
explain tradeoffs. That evaluator is configurable, excluded from the candidate
set by default, and treated as advisory evidence. You approve any change to
global model defaults.
