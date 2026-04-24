---
title: Providers page
help_topic: web.providers
help_summary: |
  Manage provider credentials — Claude OAuth or API key, OpenAI key, Codex
  tokens, llama.cpp / LM Studio URLs. Credentials are stored in
  .guildhall/config.yaml (gitignored).
---

# Providers page

`src/web/surfaces/ProvidersPage.svelte`. Credential and model management.

For each provider, the page shows:

- **Status**: not configured / authenticated / expired / error.
- **Credential action**: log in, paste API key, refresh token.
- **Model picker** (`src/web/lib/ProviderPicker.svelte`): which role(s) this provider backs.

## Providers supported

- **Claude** — OAuth (via Claude Code CLI) or API key. Auto-refreshes 60s before expiry.
- **OpenAI** — API key.
- **Codex (ChatGPT)** — Codex CLI tokens.
- **llama.cpp** — local server URL.
- **LM Studio** — local server URL.

## Where credentials live

- Per-workspace: `.guildhall/config.yaml` (gitignored).
- Global defaults: `~/.guildhall/config.yaml`.

The page only reveals credentials that are explicitly in config — it will never log or display a hidden system credential.

## Related

- [Environment variables](../reference/env) that override credential sources.
- [Providers subsystem](../subsystems/providers) for the client-side details.
