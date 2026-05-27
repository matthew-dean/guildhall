---
title: Guildhall app overview
help_topic: web.overview
help_summary: |
  The browser UI is the main Guildhall interface. It is served by
  `guildhall serve` and is where you set up projects, add work, review runs,
  answer questions, and manage providers.
---

# Guildhall app

The app has two useful scales: the `/projects` service home for scanning
registered projects, and the project shell where setup, tasks, live runs,
reviewer calls, and current work closure actually play out.

Use it for the everyday loop:

1. Open the service home or jump straight into a project shell.
2. Pick or configure a provider.
3. Add tasks.
4. Start and stop runs.
5. Inspect transcripts, reviews, gates, and provenance.
6. Resolve escalations and tune settings.

The app is still transparent: the shared project plan lands in
`./guildhall.yaml`, shared Guildhall notes can live in checked-in
`./.guildhall/` files, compact project memory lands in `./.guildhall/`, and
local/private checkout overrides stay in `./.guildhall/config.yaml`.
Machine-scoped state such as the project registry, provider credentials, and
default provider choice live under `~/.guildhall/`; transcripts and bulky run
history live under `~/.guildhall/data/projects/`.

## Pages

- [Setup wizard](./setup) — first-run onboarding.
- [Projects home](./dashboard) — `Projects & Workspaces`, service-level work mix, attention, running-now, and project launcher.
- [Project view](./project-view) — main per-project shell.
- [Task drawer](./task-drawer) — task detail pane.
- [Providers page](./providers) — credential management.

If the UI does something weird, the receipts are usually sitting in plain files
that can be inspected directly.
