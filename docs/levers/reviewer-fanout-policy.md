---
title: reviewer_fanout_policy
help_topic: lever.reviewer_fanout_policy
help_summary: |
  How verdicts from multiple reviewer personas are aggregated. `strict`
  (default) requires unanimous pass; `majority` uses a simple majority;
  `coordinator_adjudicates_on_conflict` kicks conflicts to the coordinator;
  `advisory` treats all verdicts as non-binding recommendations.
---

# `reviewer_fanout_policy`

**Scope:** domain • **Default:** `strict`

How the orchestrator aggregates verdicts when multiple persona reviewers (guilds) review the same task.

## Positions

| Position | Aggregation |
|---|---|
| `strict` | All reviewers must pass. Any reject blocks. |
| `majority` | >50% must pass. Minority opposition is recorded but non-binding. |
| `coordinator_adjudicates_on_conflict` | Unanimous pass → pass. Unanimous reject → reject. Split → coordinator decides. |
| `advisory` | Verdicts are attached for humans to see but do not gate advancement. |

## Picking per-domain

- `strict` for domains where reviewer agreement is a hard signal (security, accessibility, API contracts).
- `majority` when you have ≥3 personas and want tolerance for one dissent.
- `coordinator_adjudicates_on_conflict` when reviewer personas often disagree on style and you want a single responsible decision-maker.
- `advisory` for experimental domains where you're still calibrating what "good" looks like.

## See also

- [Disagreement & handoff](../design/disagreement-and-handoff) — design notes on how substantive conflicts get resolved.
