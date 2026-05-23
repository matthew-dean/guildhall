---
title: Providers
help_topic: subsystem.providers
help_summary: |
  LLM clients — authenticated CLIs plus OpenAI-compatible and
  Anthropic-compatible providers. Each implements
  SupportsStreamingMessages with SSE-based streaming and
  retry-on-transient-error.
---

# Providers

**Source:** `src/providers/`

All provider clients implement a shared `SupportsStreamingMessages` interface so the engine is agnostic to which provider is backing the current role.

## Clients

| Class | Purpose |
|---|---|
| `ClaudeOauthClient` | Claude via OAuth (Claude Code CLI tokens) or API key. Retries on 429/500/502/503/529 with exponential backoff (max 3 retries, 1–30s). |
| `OpenAICompatibleClient` | OpenAI-shaped APIs — OpenAI itself, hosted OpenAI-compatible providers, and local OpenAI-compatible servers such as LM Studio or llama.cpp. Includes `stripThinkBlocks()` for models that emit `<think>` fenced output. |
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

- **Authenticated CLIs** — Claude Code CLI or Codex CLI.
- **Anthropic-compatible APIs** — paste an API key (`ANTHROPIC_API_KEY`), and point the provider at Anthropic or another Anthropic-shaped endpoint.
- **OpenAI-compatible APIs** — paste an API key (`OPENAI_API_KEY`); optionally set a custom base URL for OpenAI itself or another OpenAI-shaped endpoint.
- **Local OpenAI-compatible servers** — set `LLAMA_CPP_URL` or `LM_STUDIO_BASE_URL` to a local server such as LM Studio or llama.cpp. The important distinction is “OpenAI-compatible and local,” not “one magical local slot forever.”

Override provider selection globally with `GUILDHALL_PROVIDER=claude-oauth|codex-oauth|anthropic-api|openai-api|llama-cpp`. `lm-studio` remains a compatibility alias for `llama-cpp`.

## Fallback Policy

`preferredProvider` is machine-level by default and can be overridden per
project when you genuinely need a one-off local preference. If the preferred
provider is unavailable, Guildhall may fall back to another configured local
provider. Fallback to another paid/cloud provider is disabled by default so a
stale local preference cannot silently spend money.

Enable paid fallback globally:

```yaml
# ~/.guildhall/config.yaml
allowPaidProviderFallback: true
```

Or for one project only:

```yaml
# <project>/.guildhall/config.yaml
allowPaidProviderFallback: true
```

Set the machine-wide provider default in:

```yaml
# ~/.guildhall/config.yaml
preferredProvider: openai-api
```

Override it for one project only in:

```yaml
# <project>/.guildhall/config.yaml
preferredProvider: llama-cpp
```

## Errors

Typed exceptions for each provider let callers distinguish transient from fatal:

- `ClaudeAuthError` — creds missing/expired and refresh failed.
- `ClaudeApiError`, `OpenAIApiError`, `CodexApiError` — non-retryable API errors.

## Session & version headers

The Claude client tags requests with a session id and client version so Anthropic-side logs correlate with Guildhall sessions; see `src/providers/claude-client.ts`.
