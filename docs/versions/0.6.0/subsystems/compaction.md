---
title: Compaction
help_topic: subsystem.compaction
help_summary: |
  When a conversation nears the model's context window, compaction summarizes
  older turns to free space. Three modes — full LLM compaction, microcompact
  (no LLM), and session-memory compaction — trigger automatically.
---

# Compaction

**Source:** `src/compaction/`

The engine calls a `Compactor` when token usage crosses a threshold (default: context window minus `AUTOCOMPACT_BUFFER_TOKENS = 4000`). Compaction replaces older messages with a summary message, freeing space for continued work.

## Three modes

- **Full LLM compaction** (`compactConversation`) — a separate LLM call generates a structured summary of the older turns. Most accurate; costs tokens.
- **Microcompact** (`microcompactMessages`) — pure truncation: keep the first system message, the last N messages, drop the middle. Used when under time pressure or when the summary-LLM is unavailable.
- **Session-memory compaction** — applied to persisted `SessionSnapshot` messages when they exceed `SESSION_MEMORY_MAX_CHARS = 50000`.

## Public API

```ts
import {
  autoCompactIfNeeded,
  compactConversation,
  microcompactMessages,
  buildCompactSummaryMessage,
  estimateTokens,
  estimateMessageTokens,
} from 'guildhall/compaction'
```

- `autoCompactIfNeeded(state, messages)` — checks the `AutoCompactState` and fires compaction if usage crosses the trigger.
- `estimateTokens(text)` — Claude-tokenizer-aware approximation (no network call).

## Constants

```
AUTOCOMPACT_BUFFER_TOKENS = 4000     // headroom before the context ceiling
SESSION_MEMORY_MAX_CHARS  = 50000    // persisted-session threshold
DEFAULT_KEEP_RECENT       = 5        // messages kept verbatim after compaction
COMPACT_TIMEOUT_MS        = 30000    // abort compact-LLM call after 30s
COMPACT_MAX_RETRIES       = 3
```

## What survives compaction

Compaction always preserves:

- The system prompt.
- The last `DEFAULT_KEEP_RECENT` messages (usually includes the current turn's tool-use round-trip).
- A newly synthesized summary message standing in for everything older.

Session-memory compaction additionally preserves `tool_metadata` entries in the persist-allowlist so tools don't forget state they care about (read-state, invoked skills).
