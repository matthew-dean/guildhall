---
title: review_effort
help_topic: lever.review_effort
help_summary: |
  How much review attention Guildhall starts with for tasks in this domain.
  `balanced` is the default; higher settings spend more reviewer time before
  work is accepted, while safety-sensitive task signals can still raise the plan.
---

# `review_effort`

**Scope:** domain • **Default:** `balanced`

`review_effort` sets the starting depth for task review in a domain. It is the
review-side version of a reasoning level: lower settings keep everyday work
moving, while higher settings ask Guildhall to spend more reviewer attention
before accepting a change.

Guildhall still looks at the task itself. If a task touches security, privacy,
migrations, release rollout, or other high-risk areas, the review plan can rise
above this setting.

## Positions

| Position | Behavior |
|---|---|
| `lean` | Keeps review short for small, low-risk work. Uses a smaller reviewer budget and treats more findings as advisory unless the task itself raises risk. |
| `balanced` | The default. Covers the likely risk lanes without turning every task into a release review. |
| `thorough` | Adds deeper review for domains where quality risk is higher, the product surface is newer, or calibration data says misses are still common. |
| `release_critical` | Uses the heaviest review posture for work that must be treated like a release gate. |

## What It Does Not Override

`review_effort` does not replace required verification commands, deterministic
checks, reviewer fan-out policy, or human approval settings. It shapes the review
plan; it does not waive safety gates.

## Related

- [`reviewer_mode`](./reviewer-mode) — whether review uses LLM reviewers, deterministic checks, or both.
- [`reviewer_fanout_policy`](./reviewer-fanout-policy) — how multiple reviewer verdicts are combined.
- [`completion_approval`](./completion-approval) — who can mark reviewed work done.
