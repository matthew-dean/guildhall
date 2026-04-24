---
title: Tools
help_topic: subsystem.tools
help_summary: |
  Built-in tools agents use — shell, files, search, task queue, escalation,
  proposal, checkpoint, web, skill, gate runner, plan mode. Each has a typed
  schema and a permission-checked handler.
---

# Tools

**Source:** `src/tools/`

Tools are what agents do with their turns. Every tool has a Zod schema, a handler, and a permission class (`read | write | shell | escalate | meta`).

## Built-ins

| Tool | What it does |
|---|---|
| `shell` | Run commands with timeout + output truncation (12 KB cap). Blocks interactive scaffolds when stdin is not a TTY. |
| `files` | Read, write, append, list, stat, rename, delete. |
| `search` | Keyword + regex code search across the project. |
| `task_queue` | Add tasks, move them between statuses, attach spec items. |
| `memory_tools` | Read/write entries under `memory/` (notes, transcripts). |
| `escalation` | Raise an escalation with category + free text. |
| `proposal` | Propose a design or scope change that a coordinator reviews. |
| `checkpoint` | Save/restore named checkpoints mid-task. |
| `web` | Preview + screenshot local URLs during UI work. |
| `skill_tool` | List available skills and invoke one. |
| `gate_runner` | Run lint/test/typecheck/custom gates. |
| `plan_mode` | Structured planning (produces a plan without side effects). |

## Shell tool

```ts
interface ShellInput {
  command: string
  cwd?: string
  timeoutMs?: number         // default 120_000
  env?: Record<string, string>
}
```

Output is truncated at 12 KB (head + tail preserved with a `[... N bytes elided ...]` marker). Interactive scaffolds (`npm create`, etc.) are rejected when stdin is not a TTY to avoid hangs.

## Interaction tool

`src/tools/interaction.ts` provides user-confirmation gates (`ask_user`, `confirm_destructive`) that surface as permission prompts in the dashboard or CLI.

## Adding a custom tool

```ts
import { z } from 'zod'
import type { ToolDefinition } from 'guildhall/tools'

export const deployTool: ToolDefinition = {
  name: 'deploy',
  permission: 'shell',
  schema: z.object({ env: z.enum(['staging', 'production']) }),
  async handler({ args }) {
    /* ... */
    return { ok: true }
  },
}
```

Register during agent construction. Custom tools automatically participate in the permission checker and hook pipeline.
