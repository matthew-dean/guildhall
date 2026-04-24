---
title: Workspaces
---

# Workspaces

A workspace is a directory containing:

- a `guildhall.yaml` (committed) — coordinators, models, domains, ignore patterns
- a `memory/` folder (committed) — the work queue, lever settings, transcripts
- a `.guildhall/config.yaml` (gitignored) — local provider credentials

## Registering workspaces

GuildHall keeps a global registry at `~/.guildhall/registry.yaml` so the CLI and dashboard can reference workspaces by id instead of by path.

```bash
guildhall register ~/projects/my-app     # add to registry
guildhall list                           # show all registered
guildhall unregister my-app              # remove
```

`guildhall init` registers the workspace automatically.

## Multiple workspaces in the dashboard

`guildhall serve` (no path argument) surfaces every registered workspace. Use the `tags` field in `guildhall.yaml` to group related workspaces in the sidebar.

## Workspace-local config vs project-local config

Two shapes both work:

- **`guildhall.yaml` at the workspace root** — preferred when a workspace owns a single repo.
- **`.guildhall/config.yaml` inside a repo** — preferred when the repo is also tracked by other tools and you want GuildHall state namespaced.

The config loader reads both, with project-local taking precedence. See [`src/config`](../subsystems/config).

## Lever settings

Lever settings live in `memory/agent-settings.yaml` and are scoped to the workspace, not the global registry. Each workspace has its own lever configuration, seeded with system defaults on first run and edited either through the dashboard Settings page or by direct YAML edit. See [Levers](../levers/).
