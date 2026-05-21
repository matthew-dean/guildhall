---
title: Runtime bundle
help_topic: subsystem.runtime_bundle
help_summary: |
  Thin glue that assembles a QueryEngine + tools + session state into a
  ready-to-use bundle. Callers provide provider client, model, prompt,
  permission checker; the bundle hands back a streaming engine.
---

# Runtime bundle

**Source:** `src/runtime-bundle/`

The runtime bundle is the assembly layer between config and running agents. It owns no state itself — it just wires a `QueryEngine` with the right tools, LLM client, permission checker, and session persistence.

## `buildRuntime(opts)`

```ts
import { buildRuntime } from 'guildhall/runtime-bundle'

const bundle = await buildRuntime({
  apiClient,           // ClaudeOauthClient | OpenAICompatibleClient | CodexClient
  cwd,
  model,
  systemPrompt,
  toolRegistry,
  permissionChecker,
  sessionId,           // stable id for this agent
  restoreSessionId?,   // if resuming, id of the snapshot to load
  restoreMessages?,    // or inline messages to seed history
  permissionPrompt,    // hook for "approve this destructive call?"
  askUserPrompt,       // hook for user-directed questions
})
```

Returns a `RuntimeBundle`:

```ts
interface RuntimeBundle {
  engine: QueryEngine
  sessionId: string
  restored: boolean
}
```

## `handleLine(bundle, input)`

Feeds a user line through the engine and yields a stream of `StreamEvent`s:

- `AssistantTextDelta` — streaming text tokens.
- `AssistantTurnComplete` — turn boundary with final message.
- `ToolExecutionStarted` / `ToolExecutionCompleted` — tool lifecycle.
- `CompactProgressEvent` — when compaction fires mid-turn.
- `ErrorEvent` — non-fatal errors.

See [protocol](./protocol) for the full event union.

## When to use this directly

Most callers shouldn't. The agent factories (`createWorkerAgent`, etc.) call `buildRuntime` under the hood. You'd use `buildRuntime` directly only when building a custom agent role that doesn't fit the built-in five.
