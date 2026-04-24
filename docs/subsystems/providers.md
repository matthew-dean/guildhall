---
title: Providers
help_topic: subsystem.providers
help_summary: |
  LLM clients — Claude OAuth, OpenAI-compatible, Codex (ChatGPT), local
  llama.cpp / LM Studio. Each implements SupportsStreamingMessages with
  SSE-based streaming and retry-on-transient-error.
---

# Providers

**Source:** `src/providers/`

All provider clients implement a shared `SupportsStreamingMessages` interface so the engine is agnostic to which provider is backing the current role.

## Clients

| Class | Purpose |
|---|---|
| `ClaudeOauthClient` | Claude via OAuth (Claude Code CLI tokens) or API key. Retries on 429/500/502/503/529 with exponential backoff (max 3 retries, 1–30s). |
| `OpenAICompatibleClient` | OpenAI-shaped APIs — OpenAI, LM Studio, llama.cpp. Includes `stripThinkBlocks()` for models that emit `<think>` fenced output. |
| `CodexClient` | ChatGPT (Codex) API. |

All stream through an SSE parser (`src/providers/sse.ts`).

## Authentication

```ts
import {
  loadValidClaudeCredential,
  refreshClaudeOauthCredential,
  readClaudeCredentials,
  writeClaudeCredentials,
} from 'guildhall/providers/auth'
```

Claude credentials auto-refresh 60 seconds before expiry. Paths default to the Claude Code CLI's credential file but can be overridden with `CLAUDE_CREDENTIALS_PATH`.

## Configuring

Most users configure providers through the Setup Wizard or the Providers page. Under the hood:

- **Claude** — paste an API key or log in via the Claude Code CLI.
- **OpenAI** — paste an API key (`OPENAI_API_KEY`).
- **Codex** — configured via Codex CLI tokens.
- **llama.cpp** — set `LLAMA_CPP_URL` to your local server.
- **LM Studio** — set `LM_STUDIO_BASE_URL`.

Override provider selection globally with `GUILDHALL_PROVIDER=claude|openai|codex|llama-cpp|lm-studio`.

## Errors

Typed exceptions for each provider let callers distinguish transient from fatal:

- `ClaudeAuthError` — creds missing/expired and refresh failed.
- `ClaudeApiError`, `OpenAIApiError`, `CodexApiError` — non-retryable API errors.

## Session & version headers

The Claude client tags requests with a session id and client version so Anthropic-side logs correlate with GuildHall sessions; see `src/providers/claude-client.ts`.
