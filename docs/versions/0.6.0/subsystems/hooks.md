---
title: Hooks
help_topic: subsystem.hooks
help_summary: |
  Plug user-defined commands, prompts, HTTP calls, or agent invocations into
  lifecycle events (session_start, pre_tool_use, etc.). Hooks can observe,
  block, or transform agent behavior.
---

# Hooks

**Source:** `src/hooks/`

A hook is user-defined logic that fires at a lifecycle event. Four types:

| Type | Executes | Good for |
|---|---|---|
| `command` | A shell command with structured args. | Audit logging, local side effects. |
| `prompt` | An LLM prompt that returns a structured result. | Soft checks, natural-language gating. |
| `http` | An HTTP call to an external service. | External approvals, incident tracking. |
| `agent` | Another GuildHall agent invocation (nested). | Meta-review, deep analysis. |

## Events

- `session_start`, `session_end`
- `pre_tool_use`, `post_tool_use`
- `user_prompt_submit`
- `stop`
- (custom events may be added by subsystems)

## Definition shape

```yaml
hooks:
  pre_tool_use:
    - type: command
      matcher: "Bash:*rm -rf*"       # optional glob to filter events
      command: "./scripts/danger-log.sh"
      timeout_seconds: 10
      block_on_failure: true
```

Shared fields:

- `type`: `command | prompt | http | agent`
- `matcher`: optional glob against the event payload (e.g. tool name + args).
- `timeout_seconds`: 1–600 (default 30; agent hooks cap at 1200).
- `block_on_failure`: whether a non-zero/failed hook blocks the event.

## Blocking vs observing

A hook can return `{ blocked: true, reason }` to veto the event. `pre_tool_use` is the common blocker (e.g. refuse `git push --force` unless human approved). `post_tool_use` typically observes only.

## Public API

```ts
import { HookExecutor, HookRegistry } from 'guildhall/hooks'

const registry = HookRegistry.fromWorkspace(workspace)
const executor = new HookExecutor(registry)
const result = await executor.fire('pre_tool_use', context)
if (result.blocked) { /* ... */ }
```

## Matcher globs

`fnmatch(pattern, event)` handles the usual `*`, `?`, `[abc]` syntax. For tool events, `event` is `"${tool_name}:${JSON.stringify(args)}"` so you can match on either name or argument substring.
