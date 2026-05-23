---
title: rejection_dampening
help_topic: lever.rejection_dampening
help_summary: |
  Suppresses noise from tasks that get rejected repeatedly. After N
  rejections, `soft_penalty` deprioritizes the task; `hard_suppress`
  removes it from the queue entirely until a human revives it.
---

# `rejection_dampening`

**Scope:** project • **Default:** `off`

What happens when the same task is rejected (pre-rejection or review reject) N times in a row.

## Positions

| Position | Effect |
|---|---|
| `off` | No dampening. Task stays in queue at same priority indefinitely. |
| `soft_penalty_after_N` | After N rejections, lower the task's priority so other work gets picked first. |
| `hard_suppress_after_N` | After N rejections, remove the task from the queue until a human manually revives it. |

## Storage shape

```yaml
rejection_dampening:
  position: { kind: soft_penalty, after: 3 }
  rationale: "Prevent thrash on persistently-ambiguous asks."
```

## Related

- [`pre_rejection_policy`](./pre-rejection-policy) (domain-level) — decides the immediate action on rejection; `rejection_dampening` is the escalating action that kicks in once `pre_rejection_policy`'s action has fired N times.
