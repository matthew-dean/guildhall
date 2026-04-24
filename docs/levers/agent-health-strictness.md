---
title: agent_health_strictness
help_topic: lever.agent_health_strictness
help_summary: |
  Threshold for stall detection. `lax` waits 5 minutes without output
  before intervening; `standard` (default) waits 2 minutes; `strict` waits
  30 seconds.
---

# `agent_health_strictness`

**Scope:** project • **Default:** `standard`

Controls how quickly the orchestrator considers an agent "stuck" and intervenes.

## Positions

| Position | Stall threshold | Good for |
|---|---|---|
| `lax` | 5 minutes without output | Slow local models, heavy reasoning. |
| `standard` | 2 minutes | Typical hosted models on typical work. |
| `strict` | 30 seconds | Fast models; you want fast failure and restart. |

## What "intervention" means

When an agent stalls past the threshold, the orchestrator consults [`crash_recovery_default`](./crash-recovery-default) to decide whether to resume, restart clean, or pause for review.

## See also

- [`remediation_autonomy`](./remediation-autonomy) — controls how much of the recovery action can be autonomous.
