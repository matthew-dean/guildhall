---
title: Environment variables
help_topic: reference.env
help_summary: |
  Environment variables the CLI and runtime read — config paths, provider
  selection, credentials, local model URLs.
---

# Environment variables

## Paths

| Var | Purpose |
|---|---|
| `HOME` | Used for `~` expansion. |
| `GUILDHALL_CONFIG_DIR` | Override global config root (default `~/.guildhall`). |
| `GUILDHALL_DATA_DIR` | Override data/memory/cache root (sessions, transcripts). |
| `GUILDHALL_LOGS_DIR` | Override log directory. |

## Provider selection

| Var | Purpose |
|---|---|
| `GUILDHALL_PROVIDER` | Force provider: `claude`, `openai`, `codex`, `llama-cpp`, `lm-studio`. |

## Credentials

| Var | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API key (alternative to OAuth). |
| `OPENAI_API_KEY` | OpenAI API key. |
| `CLAUDE_CREDENTIALS_PATH` | Path to Claude OAuth credentials file. |
| `CODEX_CREDENTIALS_PATH` | Path to Codex credentials file. |

## Local model servers

| Var | Purpose |
|---|---|
| `LM_STUDIO_BASE_URL` | LM Studio server URL. |
| `LLAMA_CPP_URL` | llama.cpp server URL. |
| `LM_STUDIO_MODEL` | Default model name for LM Studio in tests. |

## CLI targeting

| Var | Purpose |
|---|---|
| `FORGE_WORKSPACE` | Default workspace id when CLI command doesn't specify one. (Name preserved for historical reasons; applies to `guildhall` as well.) |
