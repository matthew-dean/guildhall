---
title: task_origination
help_topic: lever.task_origination
help_summary: |
  Who is allowed to create tasks in this domain. `human_only` (strictest),
  `agent_proposed_human_approved`, `agent_proposed_coordinator_approved`
  (default), or `agent_autonomous` (freest).
---

# `task_origination`

**Scope:** domain • **Default:** `agent_proposed_coordinator_approved`

Who can add tasks to this domain's queue.

## Positions

| Position | Who can add | Who must approve |
|---|---|---|
| `human_only` | Humans only. Agents never create tasks. | n/a |
| `agent_proposed_human_approved` | Agents may propose; humans must approve before `exploring`. | Human |
| `agent_proposed_coordinator_approved` | Agents may propose; the domain coordinator approves. | Coordinator |
| `agent_autonomous` | Agents may create tasks freely (still subject to coordinator review later). | None at origination |

## When to pick which

- **`human_only`** for high-risk domains (production infra, migrations).
- **`agent_proposed_coordinator_approved`** — the sweet spot for most domains.
- **`agent_autonomous`** for a domain with a tight review loop where throwaway ideas are cheap to reject.

## Interaction with `business_envelope_strictness`

Even under `agent_autonomous`, the business envelope still applies — envelope violations will reject the proposal if `business_envelope_strictness` is `strict`.
