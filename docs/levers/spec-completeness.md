---
title: spec_completeness
help_topic: lever.spec_completeness
help_summary: |
  How complete a spec must be at each stage. `full_upfront` requires a
  complete spec before leaving exploring; `stage_appropriate` (default)
  gradually tightens; `emergent` lets specs stay loose and fill in during
  work.
---

# `spec_completeness`

**Scope:** domain • **Default:** `stage_appropriate`

How strict the coordinator is about spec completeness at each lifecycle stage.

## Positions

| Position | Behavior |
|---|---|
| `full_upfront` | Before leaving `exploring`: full acceptance criteria, test plan, edge cases, migration plan if applicable. |
| `stage_appropriate` | Graduated. Acceptance criteria by `ready`; test plan by `review`; docs/migration by `gate_check`. Reasonable default. |
| `emergent` | Spec can be a one-line intent. Worker fills in as they go; reviewer's job is heavier. |

## Stage-by-stage requirements

For `stage_appropriate`:

| Stage | Must have |
|---|---|
| `exploring` | A problem statement. |
| `spec_review` | Title, intent, user-visible impact. |
| `ready` | + acceptance criteria. |
| `in_progress` | + test plan attached. |
| `review` | + completed implementation + updated docs. |
| `gate_check` | + all hard gates defined. |

## When to pick `emergent`

For exploratory spike work where you genuinely don't know what "done" looks like until you try. Expect high rework rates.
