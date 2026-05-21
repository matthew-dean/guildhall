---
title: workspace_import_autonomy
help_topic: lever.workspace_import_autonomy
help_summary: |
  What happens when GuildHall detects an importable workspace (e.g. existing
  specs, task backlogs, design docs). `off` ignores them; `suggest` (default)
  surfaces a banner; `apply` imports automatically.
---

# `workspace_import_autonomy`

**Scope:** project • **Default:** `suggest`

Controls how GuildHall behaves when it detects importable state from another workspace-shaped tool (issue tracker export, existing spec folder, migration artifact).

## Positions

| Position | Behavior |
|---|---|
| `off` | Ignore detected imports. |
| `suggest` | Show a "Workspace Import" banner in the dashboard offering to review and import. User confirms each item. |
| `apply` | Import detected items automatically on workspace start. Trust but verify. |

## What gets imported

The importer detects recognized shapes — e.g. a `specs/` folder, a `TASKS.md` markdown backlog, or an external issue tracker export. Each shape has a module under `src/runtime/workspace-import/` (not shown in this survey) defining the detection and translation rules.
