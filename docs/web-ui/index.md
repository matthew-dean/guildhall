---
title: Web UI overview
help_topic: web.overview
help_summary: |
  The dashboard is a Svelte SPA served by `guildhall serve` at
  http://localhost:7842. It reads and writes memory/* and exposes
  everything the CLI can do through a GUI.
---

# Web UI

The web UI is a Svelte 5 single-page app at `src/web/`, served by the Hono-based backend under `src/runtime/serve.ts`. It's a window into `memory/` — every state change ends up in a file you can grep.

## Pages

- [Setup wizard](./setup) — first-run onboarding.
- [Dashboard](./dashboard) — multi-workspace overview.
- [Project view](./project-view) — main per-workspace page with tabs.
- [Task drawer](./task-drawer) — task detail pane.
- [Providers page](./providers) — credential management.

## Design system

Tokens, components, and conventions: [Design tokens](./design-tokens).

## In-UI help

How the `?` icons stay in sync with these docs: [Help system](./help-system).

## Stack

- **Svelte 5** (runes mode).
- **Lucide** for icons (wrapped by `src/web/lib/Icon.svelte`).
- **CSS custom properties** (`src/web/tokens.css`) — no runtime CSS-in-JS.
- **Hono** on the server side; SSE for live events; OHJSON (`OHJSON:` line prefix) for event framing.
