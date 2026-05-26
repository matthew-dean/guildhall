---
title: Open model recommendations
---

# Open model recommendations

Guildhall can run different models for different agent roles. During
development, we test open and open-weight models against saved Guildhall task
prompts so the defaults stay grounded in the work the agents actually do:
blueprint drafting, coordinator decisions, bounded implementation, review, and
gate checking.

These recommendations are intentionally practical. They are not a benchmark
leaderboard, and they will change as providers update models, context windows,
tool support, and output behavior.

Guildhall now treats hosted API behavior as part of the model recommendation,
not as an afterthought. A default worker lane should advertise cached-input
pricing when we expect repeated stable context. Structured Guildhall lanes must
support either tool calls or strict `response_format` JSON output. Reasoning
controls are applied by role/model policy when the provider supports them, and
Guildhall does not send paid priority `service_tier` settings by default.

## Current recommendation

| Role | Recommended model | Why | Watch for |
|---|---|---|---|
| `spec` | `deepseek-ai/DeepSeek-V4-Flash` | Strong enough reasoning for project framing without requiring the largest lane. | Re-test for long, ambiguous specs before making it the only spec model. |
| `coordinator` | `deepseek-ai/DeepSeek-V4-Flash` | Good decision quality on structured coordination prompts and supports the OpenAI-compatible API shape Guildhall uses. | Keep deterministic guards around promotions and task handoffs. |
| `worker` | `Qwen/Qwen3.5-35B-A3B` | Advertised cached-input pricing, 3/3 on the latest FLL first-action worker replay, and the fastest successful cached Qwen lane in that run. | Its output price is higher than the old 235B instruct lane. Keep measuring full edit/verify tasks, not just first actions. |
| `reviewer` | `deepseek-ai/DeepSeek-V4-Flash` | Good fit for critique and acceptance checks when paired with deterministic gate evidence. | Ask for concrete files, commands, and acceptance criteria, not vibes. |
| `gateChecker` | `deepseek-ai/DeepSeek-V4-Flash` or a deterministic path | Gate checks mostly run commands and parse evidence. A model helps when it summarizes failures or chooses the next recovery playbook. | Command exit codes and explicit checks stay in charge. |
| `contextIndexer` | `zai-org/GLM-4.6` for semantic enrichment; `deepseek-ai/DeepSeek-V4-Flash` for cheap replay/default experiments | GLM led the combined live context-indexer ladder across documentation, code, UI design-system, and hard architecture tracks. DeepSeek remains a useful cheap challenger and repair model, but GLM is the current recommended semantic default. | Keep prompts tight, keep schema repair enabled, and retest as provider behavior changes; this lane summarizes architecture, not product or implementation decisions. |

Premium or experimental lanes:

- `deepseek-ai/DeepSeek-V4-Flash` is the cheapest successful cached lane in
  the latest FLL worker first-action replay, but it was slower than the cached
  Qwen worker lane and needs deeper edit/verification replay before replacing
  the worker default.
- `Qwen/Qwen3-Coder-480B-A35B-Instruct-Turbo` is a plausible premium worker
  lane for difficult code tasks. It was fast and passed the latest first-action
  replay, but cached input and output are both more expensive than
  `Qwen/Qwen3.5-35B-A3B`.
- `Qwen/Qwen3.5-397B-A17B` and `moonshotai/Kimi-K2.6` both advertise cached
  input pricing, but the latest FLL first-action replay did not justify their
  latency/cost as defaults.
- `Qwen/Qwen3-235B-A22B-Thinking-2507` advertises cached input pricing, but it
  failed one of three latest first-action replay cases and its cached input
  discount is shallow, so do not use it as the default worker lane without a
  stronger follow-up bakeoff.
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

## Model comparison findings

The current recommendations came from comparing frozen Guildhall prompts across
candidate models. The table below summarizes the result shape without treating
it as a permanent benchmark.

| Model | What we saw | Recommendation |
|---|---|---|
| `Qwen/Qwen3.5-35B-A3B` | Passed 3/3 latest FLL worker first-action replay cases, fastest successful cached Qwen lane, and DeepInfra advertises about `$0.05/M` cached input. | Use for cache-heavy `worker` runs while continuing deeper full-task bakeoffs. |
| `deepseek-ai/DeepSeek-V4-Flash` | Strong general decision quality across coordinator/reviewer-style cases, with acceptable structured output in replay. In the first live context-indexer ladder it produced one good documentation result, then malformed JSON on the small-codebase rung. | Use for `spec`, `coordinator`, `reviewer`, and model-assisted `gateChecker` work. Keep it in the context-indexer set as the cheap challenger, but do not rely on it without schema repair. |
| `zai-org/GLM-4.6` | Best combined live context-indexer result across the expanded ladder. It gave stronger semantic summaries overall and was faster than DeepSeek on the later UI and hard-architecture tracks, with schema repair covering occasional malformed JSON. | Use for semantic [Corpus Map](./corpus-map) enrichment until a cheaper model passes the same live ladder. |
| `Qwen/Qwen3.6-35B-A3B` | Good replay candidate, but returned no parseable JSON in the first live context-indexer ladder. | Keep in the comparison set only if prompt/schema handling changes. |
| `openai/gpt-oss-120b` | Promising decisions, but weak format reliability in the current harness. | Retest after schema repair before recommending. |
| `Qwen/Qwen3-Coder-480B-A35B-Instruct-Turbo` | Passed 3/3 latest FLL worker first-action replay cases and was the fastest lane in that run, but costs more than the cached Qwen 35B worker lane. | Keep as a premium worker experiment, not a default. |
| `Qwen/Qwen3.5-397B-A17B` | Passed 3/3 latest FLL worker first-action replay cases, but was slower and more expensive than the cached Qwen 35B worker lane. | Keep as a quality challenger for deeper bakeoffs. |
| `moonshotai/Kimi-K2.6` | Passed 3/3 latest FLL worker first-action replay cases, but was slow and expensive in that run. | Keep as a coding challenger, not a default. |
| `Qwen/Qwen3-235B-A22B-Thinking-2507` | Advertises cached input pricing, but passed only 2/3 latest FLL worker first-action replay cases and produced much more output. | Do not use as the default worker lane from current evidence. |
| `deepseek-ai/DeepSeek-V3.2` | Reasonable decisions, but failed the strict structured-output path. | Do not use for structured Guildhall lanes as tested. |
| `openai/gpt-oss-20b` | Did not clear enough worker/reviewer cases in this harness. | Do not recommend for default lanes yet. |
| `zai-org/GLM-4.7-Flash`, `MiniMaxAI/MiniMax-M2.5`, `stepfun-ai/Step-3.5-Flash` | Did not work well enough with the current structured lane requirements. | Do not recommend unless the provider/output path changes and is retested. |

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
module relationship summaries. Current DeepInfra candidate lanes are
`deepseek-ai/DeepSeek-V4-Flash`, `Qwen/Qwen3.6-35B-A3B`, and `zai-org/GLM-4.6`.

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
  --models deepseek-ai/DeepSeek-V4-Flash,Qwen/Qwen3.5-35B-A3B \
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
