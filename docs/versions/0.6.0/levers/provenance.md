---
title: Provenance
help_topic: lever.provenance
help_summary: |
  Every lever records who set it — system-default (boot), spec-agent-intake
  (Spec Agent during exploring), user-direct (human), or coordinator:<name>
  (mid-project coordinator decision) — plus an ISO timestamp and rationale.
---

# Provenance

Every lever entry records:

- `setBy` — who set this position.
- `setAt` — ISO 8601 timestamp.
- `rationale` — required free-text reason.

## `setBy` values

| Value | Meaning |
|---|---|
| `system-default` | The seed value written at workspace init. Edit freely. |
| `spec-agent-intake` | Set by the Spec Agent while refining a task in `exploring`. |
| `user-direct` | Set by a human — CLI, dashboard, or hand-edited YAML. |
| `coordinator:<name>` | Set mid-project by a coordinator agent acting within its autonomy. |

## Why it matters

When behavior surprises you, you can trace the exact line in `agent-settings.yaml` that produced it — and see who and when. This turns "the agents decided to fan out" from an opaque outcome into an explicit decision you can audit, roll back, or argue with.

The dashboard's Settings tab surfaces the setter chip next to every lever, and clicking it opens the full rationale + history.
