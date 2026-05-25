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

`review_effort` tells Guildhall how much review attention to start with for a
kind of work.

Most projects can leave this at `balanced`. Small, familiar changes stay light;
larger or riskier changes get more eyes before Guildhall accepts them.

This setting is a starting point, not a blind cap. If a task touches security,
privacy, migrations, release rollout, or another sensitive area, Guildhall can
raise the review level for that task and explain why.

## Positions

| Position | Behavior |
|---|---|
| `lean` | Keeps review short for small, low-risk work. Good for tidy follow-ups where the blast radius is easy to see. |
| `balanced` | The default. Covers the likely risks without turning every task into a ceremony. |
| `thorough` | Adds deeper review when the product surface is new, the change is subtle, or misses would be expensive. |
| `release_critical` | Uses the heaviest review posture for work that should feel like a release gate. |

## What It Does Not Override

`review_effort` does not replace verification commands, required checks,
reviewer agreement rules, or approval settings. It shapes the review plan; it
does not waive safety gates.

## Related

- [`reviewer_mode`](./reviewer-mode) — whether review uses LLM reviewers, deterministic checks, or both.
- [`reviewer_fanout_policy`](./reviewer-fanout-policy) — how multiple reviewer verdicts are combined.
- [`completion_approval`](./completion-approval) — who can mark reviewed work done.
