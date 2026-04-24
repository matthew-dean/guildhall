---
title: Engine
help_topic: subsystem.engine
help_summary: |
  The QueryEngine drives multi-turn tool-using conversations with an LLM.
  Handles message history, tool dispatch, streaming, permissions, compaction,
  hooks, and tool-metadata carryover across turns.
---

# Engine

**Source:** `src/engine/`

The engine is the bottom of the agent stack — the multi-turn loop that manages an LLM conversation.

## `QueryEngine`

```ts
import { QueryEngine } from 'guildhall/engine'

const engine = new QueryEngine({
  apiClient,
  model,
  systemPrompt,
  toolRegistry,
  permissionChecker,
  compactor,
  hookExecutor,
})

for await (const event of engine.generate(userInput)) {
  // StreamEvent: AssistantTextDelta, ToolExecutionStarted, etc.
}
```

Methods:

- `.generate(prompt)` — async generator of `StreamEvent`s for one turn-cycle.
- `.messages()` — full history (read-only snapshot).
- `.addToolResult(toolUseId, result)` — feed tool outputs back to the LLM.
- `.addUsage(snapshot)` — accumulate token counts.

## Tool registry

`ToolRegistry` maps tool names to `{ schema, handler }`. Tools are registered once at engine construction and resolved by name on each LLM tool-use. See [Tools](./tools).

## Permission modes

`PermissionMode`:

- `plan` — no side effects. Read-only tools only; shell commands, writes, and escalations are rejected.
- `default` — standard allow-list. Destructive operations surface through the `permissionPrompt` hook.
- `full_auto` — unrestricted. Used inside sandboxed worktrees where side effects are contained.

`PermissionChecker` is invoked before every tool dispatch.

## Hooks

Lifecycle events fire through `HookExecutor`:

- `session_start`, `session_end`
- `pre_tool_use`, `post_tool_use`
- `user_prompt_submit`, `stop`

Hooks can block (return `{ blocked: true, reason }`) or mutate nothing (pure observers). See [Hooks](./hooks).

## Tool-metadata carryover

`src/engine/tool-carryover.ts` persists per-tool state across turns — e.g. the `read_file_state` that tracks which file regions the agent has already seen, or `invoked_skills` that prevents a skill from being re-loaded repeatedly. This is what the session-persistence allowlist whitelists for disk storage.

## Compaction

When token usage approaches the model's context ceiling, the engine calls `Compactor` (see [Compaction](./compaction)) to summarize older turns before continuing. Compaction can also be triggered manually.
