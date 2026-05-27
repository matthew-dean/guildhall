---
title: Project files and workspace state
---

# Project files and workspace state

In the product, you mostly start with **projects**. A project is one buildable
thing: one repo or folder with one setup path, one set of gates, and one queue
of work.

Most people do not need more vocabulary than that.

A **workspace** is the advanced shape for related projects that need to be
coordinated as one effort. Use it when the folders have separate setup/startup
contracts but the work has to be planned together. For example, Looma and Knit
are separate buildable projects, but Knit product needs can drive Looma
primitive design.

In that shape, the workspace has a lightweight **council**: the coordination
rules that explain how the child projects influence each other. The council is
not another mandatory setup step for ordinary projects. It exists only when a
multi-project workspace needs shared planning.

These are the files that make a project or workspace durable across service
restarts and agent sessions.

A workspace is a directory containing:

- a `./guildhall.yaml` (committed) — the shared project/workspace contract:
  coordinators, domains, bootstrap, child projects, council rules, and planned
  task-worktree include paths
- optional `./.guildhall/*.yaml` metadata (committed when present) — Guildhall
  metadata that is shared with the repo, such as `artifacts.yaml`
- a `./.guildhall/` folder (committed where appropriate) — compact shared state:
  active tasks, sealed task summaries, lever settings, project memory,
  decisions, progress summaries, and shared Guildhall metadata
- a `./.guildhall/config.yaml` (gitignored) — local/private checkout overrides
- local history under `~/.guildhall/data/projects/<project-hash>/` — transcripts,
  events, checkpoints, heartbeats, and bulky evidence that should not inflate
  project commits

## Registering projects

Guildhall keeps a global registry at `~/.guildhall/registry.yaml` so the CLI
and browser UI can reference projects by id instead of by path.

```bash
guildhall register ~/projects/my-app     # add to registry
guildhall list                           # show all registered
guildhall unregister my-app              # remove
```

`guildhall init` registers the project automatically. The projects view can
also register an existing folder when it finds a `./guildhall.yaml`.

## Single Project Or Workspace

When you add a folder, Guildhall usually treats it as a single project.
That keeps setup flat: find the package manager, verify bootstrap, draft the
first tasks, and start moving.

Choose the workspace shape only when the folder is really a coordination layer
over multiple buildable projects:

- each child has its own working directory
- each child has its own install/start/test commands
- tasks normally belong to one child by default
- some tasks intentionally coordinate across children

In a workspace, the parent coordinates; the child project runs. That means a
Looma task bootstraps Looma, a Knit task bootstraps Knit, and a cross-project
task gets split or linked so each side has an explicit lane.

## Multiple Projects In The Service

The registry lets the CLI resolve project ids to paths, and the service uses it
to power the `/projects` home. You can attach folders there, scan what is
moving across registered projects, and jump into the shell that needs your
eyes.

When you launch `guildhall serve` from a project folder, Guildhall usually opens
that one project shell directly. The service view is still there when you want
the broader fleet picture.

Use the `tags` field in `./guildhall.yaml` to keep related projects grouped in
the registry metadata even before the UI grows into a fuller fleet view.

## Project files vs local machine config

These layers can coexist, and they do different jobs:

- **`./guildhall.yaml` at the project root** — the committed project config.
- **`./.guildhall/artifacts.yaml` inside the project** — committed Guildhall
  metadata for stable project-relative artifact IDs. Future shared Guildhall
  metadata can live beside it.
- **`./.guildhall/TASKS.json` inside the project** — the active task queue.
  Completed and shelved tasks are sealed into compact records under
  `./.guildhall/tasks/archive/`.
- **`./.guildhall/agent-settings.yaml` inside the project** — committed lever
  settings with provenance.
- **`./.guildhall/config.yaml` inside the project** — local/private runtime
  overrides for this checkout only.
- **`~/.guildhall/data/projects/<project-hash>/`** — local transcripts, events,
  debug snapshots, checkpoints, and full archive evidence.
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

Lever settings live in `./.guildhall/agent-settings.yaml` and are scoped to the
workspace, not the global registry. Each project gets its own lever
configuration, seeded with system defaults on first run and edited either
through the Settings page or by direct YAML edit. See
[Levers](../levers/).
