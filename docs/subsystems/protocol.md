---
title: Protocol
help_topic: subsystem.protocol
help_summary: |
  Wire types for messages, content blocks, tool use, streaming events, and
  usage snapshots. Provider-agnostic — every provider translates its own
  shape into these types.
---

# Protocol

**Source:** `src/protocol/`

The protocol module is the wire vocabulary. Every provider normalizes its native shape into these types so the engine doesn't know (or care) which provider is backing the current turn.

## Content blocks

```ts
type ContentBlock =
  | TextBlock
  | ImageBlock
  | ToolUseBlock
  | ToolResultBlock
  | ReasoningBlock
```

- `TextBlock` — plain text.
- `ImageBlock` — base64 or URL.
- `ToolUseBlock` — `{ id, name, input }`, emitted by the assistant.
- `ToolResultBlock` — `{ tool_use_id, content, is_error? }`, emitted by the user (client) in response.
- `ReasoningBlock` — thinking tokens (Claude extended thinking); visible to the engine for compaction decisions but generally hidden from UIs.

## Conversation messages

```ts
interface ConversationMessage {
  role: 'user' | 'assistant' | 'system'
  content: ContentBlock[]
  timestamp?: string
}

// Helpers
userMessageFromText(text: string): ConversationMessage
messageText(msg: ConversationMessage): string
```

## Stream events

What an agent turn emits:

- `AssistantTextDelta { text }` — streaming tokens.
- `AssistantTurnComplete { message, usage }` — end of an assistant turn.
- `ToolExecutionStarted { toolUseId, name, input }`
- `ToolExecutionCompleted { toolUseId, result, durationMs }`
- `CompactProgressEvent { stage, tokensBefore, tokensAfter }`
- `ErrorEvent { error, recoverable }`

## Usage

```ts
interface UsageSnapshot {
  inputTokens: number
  outputTokens: number
  cacheCreationInputTokens?: number
  cacheReadInputTokens?: number
}
```

## Serialization

`serializeContentBlock()` and `toApiParam()` are provider-side helpers used by individual clients to convert back to the API's native shape.
