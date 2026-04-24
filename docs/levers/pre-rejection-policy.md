---
title: pre_rejection_policy
help_topic: lever.pre_rejection_policy
help_summary: |
  What happens when a task is rejected before work starts (e.g. at
  spec_review). `terminal_shelved` kills it; `requeue_lower_priority`
  demotes and retries; `requeue_with_dampening` (default) combines with
  rejection_dampening.
---

# `pre_rejection_policy`

**Scope:** domain • **Default:** `requeue_with_dampening`

What happens when a task is rejected *before* work starts — e.g. the coordinator rejects at `spec_review`, or the business envelope blocks a proposal.

## Positions

| Position | Behavior |
|---|---|
| `terminal_shelved` | Task moves to `shelved`. No retries. |
| `requeue_lower_priority` | Task returns to `exploring` at one step lower priority. |
| `requeue_with_dampening` | Same as above, but also counts toward [`rejection_dampening`](./rejection-dampening). After N pre-rejections, dampening escalates. |

## Why not just shelve everything

Agents sometimes propose good tasks that coordinators reject because the spec was weak. `requeue_with_dampening` lets agents try again with a sharper spec; dampening prevents indefinite thrash.
