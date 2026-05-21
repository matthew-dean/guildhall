---
title: Project files and workspace state
---

# Project files and workspace state

In the product, you mostly see **projects**. In the config and runtime layers,
the same unit is still called a **workspace**.

In practice, one workspace usually maps to one project folder. These are the
files that make a project durable across service restarts and agent sessions.

A workspace is a directory containing:

- a `guildhall.yaml` (committed) — coordinators, models, domains, ignore patterns
- a `memory/` folder (committed) — the work queue, lever settings, transcripts
- a `.guildhall/config.yaml` (gitignored) — machine-local project overrides

## Registering projects

Guildhall keeps a global registry at `~/.guildhall/registry.yaml` so the CLI
and browser UI can reference projects by id instead of by path.

```bash
guildhall register ~/projects/my-app     # add to registry
guildhall list                           # show all registered
guildhall unregister my-app              # remove
```

`guildhall init` registers the project automatically. The projects view can
also register an existing folder when it finds a `guildhall.yaml`.

## Multiple projects in the service

The registry lets the CLI resolve project ids to paths, and the service uses
it to power the `/projects` home. You can attach a folder there, scan what is
moving across registered projects, and jump into the shell that needs your
eyes.

When you launch `guildhall serve` from a project folder, Guildhall usually
opens that one project shell directly. The service view is still there when you
want the broader fleet picture.

Use the `tags` field in `guildhall.yaml` to keep related projects grouped in
the registry metadata even before the UI grows into a fuller fleet view.

## Project files vs local machine config

These layers can coexist, and they do different jobs:

- **`guildhall.yaml` at the project root** — the committed project config.
- **`.guildhall/config.yaml` inside the project** — local-only runtime
  overrides for that one project.
- **`~/.guildhall/config.yaml`** — user-global machine defaults across
  projects.
- **`~/.guildhall/providers.yaml`** — machine-scoped provider credentials
  shared across projects.

The config loader merges them instead of treating them as alternatives.
Project-local settings override user-global local settings where appropriate.
Provider secrets are no longer expected in the project-local file. Machine-wide
provider choice and model-lane defaults belong in `~/.guildhall/config.yaml`;
see [Open model recommendations](./open-models) for the currently tested
open-model split. The project-local file only overrides those defaults when a
single project truly needs different behavior, and it still holds local runtime
selections such as `landingBranch`.

## Project settings on disk

Lever settings live in `memory/agent-settings.yaml` and are scoped to the
workspace, not the global registry. Each project gets its own lever
configuration, seeded with system defaults on first run and edited either
through the Settings page or by direct YAML edit. See
[Levers](../levers/).
