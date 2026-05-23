---
title: concurrent_task_dispatch
help_topic: lever.concurrent_task_dispatch
help_summary: |
  How many tasks the orchestrator runs in parallel. `serial` runs one at a
  time per domain; `fanout_N` runs up to N simultaneously, each in its own
  git worktree (combined with worktree_isolation).
---

# `concurrent_task_dispatch`

**Scope:** project • **Default:** `serial`

Controls how many `ready` tasks the orchestrator dispatches at once.

## Positions

| Position | Effect |
|---|---|
| `serial` | Exactly one in-flight worker at a time per domain. Safest. |
| `fanout_N` (N ≥ 2) | Up to N workers run in parallel across all domains. |

## Storage shape

```yaml
concurrent_task_dispatch:
  position: { kind: fanout, n: 4 }
  rationale: "Small team, lots of independent UI work."
  setBy: user-direct
```

The simple `serial` form stores as `{ kind: serial }`.

## Related levers

- [`worktree_isolation`](./worktree-isolation) — almost always set to `per_task` or higher when fanning out, to avoid file collisions.
- [`runtime_isolation`](./runtime-isolation) — if your workers need port allocation (e.g. parallel dev servers), enable `slot_allocation`.

## When to change it

Start with `serial`. Move to `fanout_2`–`fanout_4` once you've verified workers don't step on each other. Beyond 4 you typically hit provider rate limits before you hit useful parallelism.
