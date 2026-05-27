---
title: Providers page
help_topic: web.providers
help_summary: |
  Manage provider credentials — Claude OAuth or API key, OpenAI key, Codex
  tokens, llama.cpp / LM Studio URLs. Credentials are stored in
  ~/.guildhall/providers.yaml or the provider CLI's own auth store.
---

# Providers page

Use the Providers page to connect the model services Guildhall can use for
planning, implementation, review, and gates.

For each provider, the page shows:

- **Detection**: whether the service found a usable CLI auth file, API key, or
  reachable local-model endpoint.
- **Verification**: a `verifiedAt` marker after a successful test.
- **Credential action**: connect, paste an API key, test, or disconnect.
- **Provider choice**: which configured provider Guildhall prefers by default, with room for a project override when needed.
- **Fallback and mismatch warnings**: whether Guildhall had to use a fallback,
  or whether model settings point at a different provider family than the one
  you meant to use.

## Provider paths the service exposes today

- **Claude** — OAuth (via Claude Code CLI) or API key.
- **Codex (ChatGPT)** — Codex CLI tokens.
- **Anthropic-compatible APIs** — Anthropic itself and Anthropic-shaped hosted endpoints.
- **OpenAI-compatible APIs** — OpenAI itself and OpenAI-shaped hosted endpoints.
- **Local OpenAI-compatible servers** — usually llama.cpp or LM Studio, but conceptually just another OpenAI-compatible endpoint running on your machine.

## Where credentials live

- Machine-scoped provider credentials: `~/.guildhall/providers.yaml`.
- OAuth-managed credentials:
  - `~/.claude/.credentials.json`
  - `~/.codex/auth.json`
- Machine-wide default: `preferredProvider` in `~/.guildhall/config.yaml`.
- Optional project override: `preferredProvider` in `./.guildhall/config.yaml` only when one project truly needs different behavior.

The page only reveals credentials that are explicitly in config — it will never log or display a hidden system credential.

## Default provider visibility

Projects Home shows the machine-default provider and active worker model group
so you can spot the lane before starting work. The chip routes here, to global
Providers, because provider drift usually affects the whole local service.

Fallback is intentionally loud. If the preferred provider is unavailable, or a
scoped model override points at a provider family that does not match the
preferred provider, Guildhall shows the warning until you fix the config or
accept the mismatch. Paid-provider fallback stays disabled unless you opt in,
so a local-model outage does not quietly become a cloud bill.

## Related

- [Environment variables](../reference/env) that override credential sources.
