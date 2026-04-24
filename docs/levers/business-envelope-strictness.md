---
title: business_envelope_strictness
help_topic: lever.business_envelope_strictness
help_summary: |
  How strictly the business envelope (Goals + Guardrails) is enforced.
  `strict` blocks on any guardrail violation; `advisory` surfaces warnings
  but lets work proceed; `off` disables envelope checks.
---

# `business_envelope_strictness`

**Scope:** project • **Default:** `advisory`

Controls enforcement of the project's business envelope — `memory/business-envelope.yaml` with `goals:` and `guardrails:`.

## Positions

| Position | Effect |
|---|---|
| `strict` | Any proposed task that would violate a guardrail is rejected before it leaves `proposed`. |
| `advisory` | Violations raise a warning attached to the task but do not block. Coordinator decides. |
| `off` | Envelope checks are skipped entirely. |

## When to pick which

- `strict` in regulated environments (compliance, safety).
- `advisory` for startup velocity — humans see the warning and can say "yes, proceed."
- `off` only for prototypes where you haven't written an envelope yet.

## See also

- [Runtime → business envelope](../subsystems/runtime#business-envelope) for how evaluation works.
