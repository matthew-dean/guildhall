---
title: Providers page
help_topic: web.providers
help_summary: |
  Manage provider credentials — Claude OAuth or API key, OpenAI key, Codex
  tokens, llama.cpp / LM Studio URLs. Credentials are stored in
  ~/.guildhall/providers.yaml or the provider CLI's own auth store.
---

# Providers page

`src/web/surfaces/ProvidersPage.svelte`. Credential and model management.

For each provider, the page shows:

- **Detection**: whether the service found a usable CLI auth file, API key, or
  reachable local-model endpoint.
- **Verification**: a `verifiedAt` marker after a successful test.
- **Credential action**: connect, paste an API key, test, or disconnect.
- **Provider choice**: which configured provider GuildHall prefers by default, with room for a project override when needed.

## Provider slots the service exposes

- **Claude** — OAuth (via Claude Code CLI) or API key.
- **OpenAI** — API key.
- **Codex (ChatGPT)** — Codex CLI tokens.
- **OpenAI-compatible local server** — one `llama-cpp` slot, usually pointed
  at llama.cpp or LM Studio.

## Where credentials live

- Machine-scoped provider credentials: `~/.guildhall/providers.yaml`.
- OAuth-managed credentials:
  - `~/.claude/.credentials.json`
  - `~/.codex/auth.json`
- Machine-wide default: `preferredProvider` in `~/.guildhall/config.yaml`.
- Optional project override: `preferredProvider` in `.guildhall/config.yaml` only when one project truly needs different behavior.

The page only reveals credentials that are explicitly in config — it will never log or display a hidden system credential.

## Related

- [Environment variables](../reference/env) that override credential sources.
- [Providers subsystem](../subsystems/providers) for the client-side details.
