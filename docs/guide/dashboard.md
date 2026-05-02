---
title: The dashboard
---

# The dashboard

The dashboard is a Svelte SPA served by `guildhall serve` at `http://localhost:7842`. It's a window into `memory/` — it doesn't store anything itself. You can edit `memory/*.yaml` with your editor and the dashboard will reflect the change on next refresh.

## Pages

- **Project view** — the main surface. Tabs for Work (inbox + active tasks), Planner, Timeline, Coordinators, Settings, Release, and Workspace Import. See [Project view](../web-ui/project-view).
- **Task drawer** — slides open when you click a task card. Tabs for Transcript, History, Spec, Experts, and Provenance. See [Task drawer](../web-ui/task-drawer).
- **Providers** — credential management for authenticated CLIs plus OpenAI-compatible and Anthropic-compatible providers. See [Providers page](../web-ui/providers).
- **Setup wizard** — runs from `/setup` on first boot and after `guildhall config`. See [Setup wizard](../web-ui/setup).

## In-UI help

Nearly every piece of the UI has a `?` icon that opens a modal with a short explanation and a "Open full docs ↗" link that lands on the matching page in *this* docs site. The help content comes from the YAML frontmatter of the docs pages themselves — there's no second source of truth. See [the help system](../web-ui/help-system) for how it works.

## What the dashboard does NOT do

- It does not replace `guildhall.yaml`. You can edit the YAML by hand; the dashboard picks up changes on refresh.
- It does not hide state. Everything the dashboard shows is in `memory/*`, readable and greppable.
- It does not require a network connection to Anthropic — the only outbound calls are to whichever provider you've configured.
