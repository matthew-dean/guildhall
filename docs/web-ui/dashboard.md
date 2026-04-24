---
title: Dashboard
help_topic: web.dashboard
help_summary: |
  Landing page at http://localhost:7842 when guildhall serve is run without
  a path. Lists every registered workspace with tags, run state, and jump
  links into the project view.
---

# Dashboard

The dashboard is the entry page when you run `guildhall serve` without a path argument. It lists every workspace registered in `~/.guildhall/registry.yaml`, grouped by `tags:` from `guildhall.yaml`.

Each card shows:

- Workspace name + id.
- Current run state (idle, running, paused, errored).
- Count of open escalations and blocked tasks.
- Quick links to Work tab, Settings, and Providers.

Clicking a card opens the [project view](./project-view) for that workspace.

## Global header

The header (`src/web/surfaces/Header.svelte`) surfaces the current workspace name, a global status dot, and the primary nav to switch between project tabs or jump to providers.
