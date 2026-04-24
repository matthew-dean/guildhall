---
title: Guilds
help_topic: subsystem.guilds
help_summary: |
  Guilds are expert personas — Accessibility Specialist, Color Theorist,
  Frontend Engineer — that sit at the table when a task is relevant. Each
  contributes principles, a review rubric, and deterministic checks.
---

# Guilds

A **guild** is an expert persona with four pieces:

1. **Principles** — 200–500 words of first-person prose that becomes the persona's system context during review.
2. **Rubric** — scored review questions (`{ id, question, weight }`).
3. **Deterministic checks** — pure functions (e.g. contrast math) executed at gate time.
4. **Applicability predicate** — decides whether this guild cares about a given task.

**Source:** `src/guilds/`

## Built-in roster

Visible in `src/guilds/registry.ts` — Accessibility Specialist, Color Theorist, Frontend Engineer, and friends. Each has a `slug` (e.g. `"accessibility-specialist"`), a `role` (`engineer` / `designer` / `specialist` / `overseer`), and optional `specContribution` (extra questions for the Spec Agent's elicitation).

## Custom guilds

Add `guilds.yaml` at the workspace root with the same shape:

```yaml
- slug: performance-engineer
  role: engineer
  principles: |
    I care about the tail, not the median. Before approving any hot-path
    change I look for: allocations per request, async overhead, query plans...
  rubric:
    - id: hot-path
      question: Does this change any code on the hot path?
      weight: 3
  applicable:
    paths: ["src/server/**", "src/db/**"]
```

## Public API

```ts
import {
  selectApplicableGuilds,
  reviewersForTask,
  runGuildDeterministicChecks,
  type GuildDefinition,
  type DeterministicCheck,
} from 'guildhall/guilds'
```

## Fanout

When a task enters `review`, the coordinator picks applicable guilds and fans out — each guild reviews independently. Aggregation follows [`reviewer_fanout_policy`](../levers/reviewer-fanout-policy): `strict`, `majority`, `coordinator_adjudicates_on_conflict`, or `advisory`.
