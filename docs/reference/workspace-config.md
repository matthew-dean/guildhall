---
title: guildhall.yaml
help_topic: reference.workspace_config
help_summary: |
  The workspace config file. Defines name, id, projectPath, model assignments
  per agent role, coordinator domains with mandates/concerns/autonomy, and
  orchestrator knobs like maxRevisions.
---

# `guildhall.yaml` reference

The workspace config file. Lives at the workspace root (or `.guildhall/config.yaml` inside a repo).

## Top-level shape

```yaml
name: string
id: string
projectPath: string
models: ModelAssignmentConfig
coordinators: CoordinatorDomain[]
maxRevisions?: number        # default 3
heartbeatInterval?: number   # ticks between progress log entries
bootstrap?: BootstrapConfig
hooks?: { [event]: HookDefinition[] }
mcp?: { servers: { [name]: McpServerConfig } }
ignore?: string[]
tags?: string[]
```

## Identity

- `name` — human-readable label shown in the dashboard.
- `id` — slug used by `guildhall run <id>` and in `~/.guildhall/registry.yaml`. Must be lowercase, dash-separated.
- `projectPath` — absolute path to the project root. Defaults to the directory containing this file.

## `models`

```yaml
models:
  spec: claude-sonnet-4-6
  coordinator: claude-sonnet-4-6
  worker: qwen2.5-coder-32b-instruct
  reviewer: qwen2.5-coder-14b-instruct
  gateChecker: qwen2.5-coder-7b-instruct
```

Each of the five roles must resolve against the model catalog in `src/core/models.ts`.

## `coordinators`

```yaml
coordinators:
  - id: ui
    name: UI Coordinator
    domain: ui                   # matches task.domain in TASKS.json
    path: packages/ui            # relative to projectPath
    mandate: |
      Multi-line prose describing the domain's charter.
    concerns:
      - id: accessibility
        description: "..."
        reviewQuestions:
          - "..."
    autonomousDecisions:
      - "..."
    escalationTriggers:
      - "..."
```

See [Coordinators & domains](../guide/coordinators) for semantics.

## `bootstrap`

Optional commands that run when a new worktree is created:

```yaml
bootstrap:
  commands:
    - pnpm install --frozen-lockfile
  successGates:
    - pnpm typecheck
  gates:
    lint: pnpm lint
    typecheck: pnpm typecheck
    build: pnpm build
    test: pnpm test
```

The `gates` map resolves the builtin hard-gate names to project-specific commands.

## `hooks`

Per-event hook lists. See [Hooks](../subsystems/hooks).

```yaml
hooks:
  pre_tool_use:
    - type: command
      matcher: "Bash:*rm -rf*"
      command: "./scripts/danger-log.sh"
```

## `mcp.servers`

See [MCP](../subsystems/mcp).

```yaml
mcp:
  servers:
    github:
      type: stdio
      command: npx
      args: ["@modelcontextprotocol/server-github"]
```

## `ignore`

Paths to skip when scanning the project. Glob patterns are supported.

```yaml
ignore:
  - node_modules
  - dist
  - .git
  - coverage
```

## `tags`

Free-form groups shown in the multi-workspace dashboard.

```yaml
tags:
  - frontend
  - typescript
```
