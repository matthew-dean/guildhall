---
title: Providers page
help_topic: web.providers
help_summary: |
  Manage machine-scoped provider credentials — authenticated CLIs,
  Anthropic-compatible API keys, OpenAI-compatible API keys, and local
  OpenAI-compatible server URLs.
---

# Providers page

`src/web/surfaces/ProvidersPage.svelte`. Credential and model management.

For each provider connection, the page shows:

- **Status**: not configured / authenticated / expired / error.
- **Credential action**: log in, paste API key, or set a base URL.
- **Model picker** (`src/web/lib/ProviderPicker.svelte`): which role(s) this provider backs.

## Provider families

- **Authenticated CLIs** — Claude Code CLI and Codex CLI.
- **Anthropic-compatible API** — API key-backed hosted provider.
- **OpenAI-compatible API** — API key-backed hosted provider. Leave base URL blank to use real OpenAI.
- **OpenAI-compatible local server** — local server URL for endpoints such as LM Studio or llama.cpp.

## Where credentials live

- Machine-scoped credentials: `~/.guildhall/providers.yaml`.
- Global defaults and model settings: `~/.guildhall/config.yaml`.
- Project-level provider preference: `<project>/.guildhall/config.yaml`.

The page only reveals credentials that are explicitly in config — it will never log or display a hidden system credential.

## Related

- [Environment variables](../reference/env) that override credential sources.
- [Providers subsystem](../subsystems/providers) for the client-side details.
