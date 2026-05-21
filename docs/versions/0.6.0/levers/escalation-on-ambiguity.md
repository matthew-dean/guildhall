---
title: escalation_on_ambiguity
help_topic: lever.escalation_on_ambiguity
help_summary: |
  When a spec is ambiguous mid-work, who resolves it. `always` escalates
  to humans; `coordinator_first` (default) tries the coordinator agent
  first and only escalates if it can't decide; `never` lets the worker
  just pick.
---

# `escalation_on_ambiguity`

**Scope:** domain • **Default:** `coordinator_first`

When a worker encounters spec ambiguity mid-work, what escalation path to take.

## Positions

| Position | Behavior |
|---|---|
| `always` | Worker raises an escalation for humans; work pauses. |
| `coordinator_first` | Worker asks its domain coordinator. If the coordinator can resolve (within `autonomousDecisions`), work continues. Otherwise escalate to humans. |
| `never` | Worker makes a best-effort decision, records it in the spec, and continues. Reviewer can catch it. |

## When to pick `never`

For domains where reversibility is cheap (frontend polish, doc edits) and thrash is expensive. The spec becomes a living document that records decisions as they happen.
