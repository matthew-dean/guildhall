---
title: Guildhall app overview
help_topic: web.overview
help_summary: |
  The browser UI is the main Guildhall interface. It is served by
  `guildhall serve`, reads and writes project state, and exposes the
  setup, task, run, review, and provider workflows through the main
  product surface.
---

# Guildhall app

The app is the main way to operate Guildhall. It has two useful scales:
the `/projects` service home for scanning registered projects, and the
project shell where setup, tasks, live runs, reviewer calls, and release
readiness actually play out.

Use it for the everyday loop:

1. Open the service home or jump straight into a project shell.
2. Pick or configure a provider.
3. Add tasks.
4. Start and stop the orchestrator.
5. Inspect transcripts, reviews, gates, and provenance.
6. Resolve escalations and tune settings.

The app is still transparent: project state lands in `guildhall.yaml`,
`.guildhall/config.yaml`, and `memory/*`, while machine-scoped state such as
the project registry, provider credentials, and default provider choice live
under `~/.guildhall/`.

## Pages

- [Setup wizard](./setup) — first-run onboarding.
- [Dashboard](./dashboard) — service home and project launcher.
- [Project view](./project-view) — main per-project shell.
- [Task drawer](./task-drawer) — task detail pane.
- [Providers page](./providers) — credential management.

## Implementation reference

Most users do not need this. If you are working on Guildhall itself, the
implementation reference covers [design tokens](./design-tokens) and the
[in-UI help system](./help-system).

If the UI does something weird, the receipts are usually sitting in plain files
that can be inspected directly.
