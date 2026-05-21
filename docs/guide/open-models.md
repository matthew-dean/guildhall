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

## Current recommendation

| Role | Recommended model | Why | Watch for |
|---|---|---|---|
| `spec` | `deepseek-ai/DeepSeek-V4-Flash` | Strong enough reasoning for project framing without requiring the largest lane. | Re-test for long, ambiguous specs before making it the only spec model. |
| `coordinator` | `deepseek-ai/DeepSeek-V4-Flash` | Good decision quality on structured coordination prompts and supports the OpenAI-compatible API shape Guildhall uses. | Keep deterministic guards around promotions and task handoffs. |
| `worker` | `Qwen/Qwen3-235B-A22B-Instruct-2507` | Best strict pass rate in the current worker-lane replay set, with reliable JSON formatting. | It is slower than some flash models, so use lane-specific routing instead of making every role use the worker model. |
| `reviewer` | `deepseek-ai/DeepSeek-V4-Flash` | Good fit for critique and acceptance checks when paired with deterministic gate evidence. | Reviewers should cite concrete files, commands, and acceptance criteria rather than giving vibes. |
| `gateChecker` | `deepseek-ai/DeepSeek-V4-Flash` or a deterministic path | Gate checks should mostly run commands and parse evidence. A model is useful only when it summarizes failures or chooses the next recovery playbook. | Do not let model judgment replace command exit codes or explicit policy checks. |
| `contextIndexer` | `deepseek-ai/DeepSeek-V4-Flash` | Best fit for high-volume semantic Corpus Map enrichment in the current replay: long context, fast enough, and low enough cost for frequent refreshes. | Re-test on real repositories; this lane should summarize architecture, not make product or implementation decisions. |

Premium or experimental lanes:

- `Qwen/Qwen3-Coder-480B-A35B-Instruct-Turbo` is a plausible premium worker
  lane for difficult code tasks, but its output-shape behavior makes it a
  targeted experiment rather than the default.
- `openai/gpt-oss-120b` is worth retesting for reviewer-style work after
  Guildhall has a stricter schema-repair path for model outputs.
- `zai-org/GLM-4.7-Flash`, `MiniMaxAI/MiniMax-M2.5`, and
  `stepfun-ai/Step-3.5-Flash` are not recommended for structured Guildhall
  lanes from the current replay set unless the provider/output-format path is
  changed and retested.

## How we test

Model testing should replay the same frozen task input across each candidate:

- the exact agent role prompt,
- the same task context and project facts,
- the same tool schema or response format,
- the same role-specific scoring rubric,
- captured latency, token use, schema compliance, and decision quality.

Deterministic checks come first. A model that chooses the right answer but
cannot return the expected shape is not ready for a structured Guildhall lane.

## Development findings

The current recommendations came from a small live development bakeoff against
frozen Guildhall prompts. The table below summarizes the result shape without
treating it as a permanent benchmark.

| Model | What we saw | Recommendation |
|---|---|---|
| `Qwen/Qwen3-235B-A22B-Instruct-2507` | Best strict pass rate and strongest structured-output reliability in the worker-style cases. | Use for `worker` by default. |
| `deepseek-ai/DeepSeek-V4-Flash` | Strong general decision quality across coordinator/reviewer-style cases, with acceptable structured output. Context-indexer replay also favored it on cost and speed. | Use for `spec`, `coordinator`, `reviewer`, `contextIndexer`, and model-assisted `gateChecker` work. |
| `Qwen/Qwen3.6-35B-A3B` | Good context-indexer candidate when code understanding matters; slower and costlier than DeepSeek V4 Flash in the replay model. | Keep in the context-indexer bakeoff set as the main code-understanding challenger. |
| `openai/gpt-oss-120b` | Promising decisions, but weak format reliability in the current harness. | Retest after schema repair before recommending. |
| `Qwen/Qwen3-Coder-480B-A35B-Instruct-Turbo` | Strong decisions, but poor strict-format reliability in the current harness. | Keep as a premium worker experiment, not a default. |
| `zai-org/GLM-4.6` | Strong decisions, but poor strict-format reliability in the current harness. | Retest only if output repair improves. |
| `deepseek-ai/DeepSeek-V3.2` | Reasonable decisions, but failed the strict structured-output path. | Do not use for structured Guildhall lanes as tested. |
| `openai/gpt-oss-20b` | Did not clear enough worker/reviewer cases in this harness. | Do not recommend for default lanes yet. |
| `zai-org/GLM-4.7-Flash`, `MiniMaxAI/MiniMax-M2.5`, `stepfun-ai/Step-3.5-Flash` | Did not work well enough with the current structured lane requirements. | Do not recommend unless the provider/output path changes and is retested. |

## Local replay command

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
module contract summaries. Current DeepInfra candidate lanes are
`deepseek-ai/DeepSeek-V4-Flash`, `Qwen/Qwen3.6-35B-A3B`, and `zai-org/GLM-4.6`.

## Planned live bakeoff mode

The live version should add provider-backed candidate runs:

```bash
guildhall model-bakeoff --live \
  --provider openai-api \
  --models deepseek-ai/DeepSeek-V4-Flash,Qwen/Qwen3-235B-A22B-Instruct-2507 \
  --judge-model deepseek-ai/DeepSeek-V4-Flash
```

The judge model should not be the whole evaluation. Guildhall should score
hard facts first:

- Did the model return valid structured output?
- Did it call the right tool or produce the expected decision?
- Did it avoid false approvals and false escalations?
- Did it preserve the task's acceptance criteria?
- How long did it take, and how many tokens did it use?

After that, an explicit judge model can compare outputs under a rubric and
explain tradeoffs. That evaluator should be configurable, excluded from the
candidate set by default, and treated as advisory evidence. The user should
approve any change to global model defaults.
