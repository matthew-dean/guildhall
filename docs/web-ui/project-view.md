---
title: Project view
help_topic: web.project_view
help_summary: |
  The main per-workspace page. Tabs for Work (inbox + active), Planner,
  Timeline, Settings, Release, Workspace Import. Clicking
  any task card opens the task drawer.
---

# Project view

`src/web/surfaces/ProjectView.svelte`. The main per-workspace page.

## Tabs

| Tab | Component | Purpose |
|---|---|---|
| **Work** | `project/WorkTab.svelte` | The human inbox plus currently active tasks. Primary surface. |
| **Inbox** | `project/InboxTab.svelte` | Escalations awaiting human response. |
| **Planner** | `project/PlannerTab.svelte` | Proposed + exploring tasks being shaped. |
| **Timeline** | `project/TimelineTab.svelte` | Chronological view of task transitions and agent events. |
| **Settings → Routing** | `project/CoordinatorsTab.svelte` | Internal routing inspection: inferred slices, scope hints, and what work is landing where. |
| **Settings** | `project/SettingsTab.svelte` | Every lever surfaced with a `?` icon linking to its docs page. |
| **Release** | `project/ReleaseTab.svelte` | Done-but-unmerged tasks, merge policy status, push state. |
| **Workspace Import** | `project/WorkspaceImportTab.svelte` | Detected importable state (see [`workspace_import_autonomy`](../levers/workspace-import-autonomy)). |

## Run controls

The Work tab has a Run/Stop toggle that starts and stops the orchestrator. While running, a live event feed (SSE from `GET /api/project/events`) streams task transitions and transcript additions.

## Intake

The Intake modal (`src/web/surfaces/IntakeModal.svelte`) creates a new task in `exploring`. Equivalent to `guildhall intake "..."` on the CLI.
