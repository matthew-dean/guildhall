---
title: reviewer_mode
help_topic: lever.reviewer_mode
help_summary: |
  How tasks in `review` are evaluated. `llm_only` uses LLM reviewers only;
  `deterministic_only` uses only rule-based checks; `llm_with_deterministic_fallback`
  (default) tries LLM first and falls back to deterministic on failure.
---

# `reviewer_mode`

**Scope:** domain • **Default:** `llm_with_deterministic_fallback`

How review is performed for tasks in the `review` status.

## Positions

| Position | Behavior |
|---|---|
| `llm_only` | A reviewer LLM (or fan-out of persona reviewers) produces the verdict. Fails hard if the LLM is unavailable. |
| `deterministic_only` | Only rule-based checks (lint, typecheck, rubric heuristics) run. No LLM cost. |
| `llm_with_deterministic_fallback` | LLM reviewers first; if they timeout or error, deterministic checks provide the verdict. |

## Cost vs confidence

- LLM-only: highest-quality verdicts; highest cost; single point of failure if the provider is down.
- Deterministic-only: cheap; fast; blind to anything a rubric can't encode (tone, clarity, architecture).
- Fallback: best of both.

## Related

- [`reviewer_fanout_policy`](./reviewer-fanout-policy) — how multiple LLM reviewers are aggregated when `reviewer_mode` is LLM-based.
