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

The app has two useful scales: the `/projects` service home for scanning
registered projects, and the project shell where setup, tasks, live runs,
reviewer calls, and release readiness actually play out.

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
- [Projects home](./dashboard) — `Projects & Workspaces`, service-level work mix, attention, running-now, and project launcher.
- [Project view](./project-view) — main per-project shell.
- [Task drawer](./task-drawer) — task detail pane.
- [Providers page](./providers) — credential management.

If the UI does something weird, the receipts are usually sitting in plain files
that can be inspected directly.
