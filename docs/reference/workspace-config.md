---
title: ./guildhall.yaml
help_topic: reference.workspace_config
help_summary: |
  The project config file. Defines name, id, projectPath, model assignments
  per agent role, coordinator/routing structure, and orchestrator knobs like
  maxRevisions.
---

# `./guildhall.yaml` reference

The main project config file. It normally lives at the project root.

## Top-level shape

```yaml
name: string
id: string
projectPath: string
kind?: project | workspace
projects?: WorkspaceProject[]
council?: CouncilConfig
models: ModelAssignmentConfig
coordinators: CoordinatorDomain[]
maxRevisions?: number        # default 3
heartbeatInterval?: number   # ticks between progress log entries
bootstrap?: BootstrapConfig
hooks?: { [event]: HookDefinition[] }
mcp?: { servers: { [name]: McpServerConfig } }
ignore?: string[]
tags?: string[]
skills?: ProjectSkillsConfig
runtime?: RuntimeSlotConfig
worktree?: WorktreeConfig
```

## Identity

- `name` — human-readable label shown in the browser UI.
- `id` — slug used by `guildhall run <id>` and in `~/.guildhall/registry.yaml`. Must be lowercase, dash-separated.
- `projectPath` — absolute path to the project root. Defaults to the directory containing this file.
- `kind` — defaults to `project`. Use `workspace` only when this config coordinates multiple buildable child projects.

## `projects` And `council`

Most projects should skip these fields.

Use `projects` when one Guildhall entry coordinates multiple buildable folders
with different setup contracts. Use `council` only to describe how those child
projects should influence each other.

```yaml
kind: workspace

projects:
  - id: looma
    label: Looma
    type: library
    path: looma
    coordinator: looma
    bootstrap:
      commands:
        - pnpm install
      successGates:
        - pnpm typecheck
        - pnpm build
        - pnpm lint

  - id: knit
    label: Knit
    type: app
    path: knit
    coordinator: knit
    bootstrap:
      commands:
        - pnpm install
      successGates:
        - pnpm typecheck
        - pnpm build
        - pnpm lint
    worktree:
      include:
        - .env

council:
  mandate: Keep Looma generic while letting Knit needs drive priority.
  coordinationRules:
    - id: knit-drives-looma
      from: knit
      to: looma
      rule: Reusable Knit UI needs should become Looma primitives before app-specific wiring.
```

The parent workspace coordinates planning. Tasks still bind to a child project
for setup, worktree creation, gates, and verification.

Git policy follows the same shape. In a multi-project workspace, Guildhall
keeps the workspace-level `.guildhall/` state at the parent so planning and
tasks stay coherent, but local/private ignore rules are written at the actual
Git-backed child project roots from `projects[].path`. If the workspace folder
is only a container, its `.gitignore` does not need to pretend it owns those
repos.

Child-project settings are project settings. If a workspace coordinates
multiple buildable projects, put local worktree files under the matching
`projects[]` entry so paths stay relative to that child project. Do not put
`knit/.env` in the parent workspace include list; a Knit task resolves includes
from the Knit project root, so the child setting should be `.env`.

## `models`

```yaml
models:
  spec: deepseek-ai/DeepSeek-V4-Flash
  coordinator: deepseek-ai/DeepSeek-V4-Flash
  worker: Qwen/Qwen3-235B-A22B-Instruct-2507
  reviewer: deepseek-ai/DeepSeek-V4-Flash
  gateChecker: deepseek-ai/DeepSeek-V4-Flash
  contextIndexer: zai-org/GLM-4.6
```

Each model role must resolve against the model catalog in `./src/core/models.ts`.
See [Open model recommendations](../guide/open-models) for the currently tested
role split and retesting notes.

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

## `worktree.include`

Optional project-root-relative files or glob patterns that Guildhall copies into
isolated task worktrees before bootstrap:

```yaml
worktree:
  include:
    - .env
    - .env.local
    - appsettings.local.yaml
    - config/local/**
```

Use this for local runtime config that is intentionally not committed but is
needed for bootstrap, tests, or local app startup. Guildhall may suggest likely
filenames during setup, but it only copies paths listed here. Parent-directory
paths are rejected, missing files are skipped, and symlinks are not copied.

You can edit this list in **Settings → Advanced → Task worktree local files**.

## `runtime`

Optional runtime-resource settings used when the project lever
[`runtime_isolation`](../levers/runtime-isolation) is set to
`slot_allocation`.

```yaml
runtime:
  portBase: 48000
  portStride: 100
  envVarPrefixTemplate: GUILDHALL_SLOT_{slot}
```

Slot allocation is not container isolation. It is a lightweight way to give
parallel workers separate port ranges and environment hints while they still
run in normal task worktrees. Containerized runtimes remain a future design
candidate, not a `0.7.0` claim.

## `skills`

Optional project-local skill settings. Guildhall can suggest project skills
from repeated project evidence, but using them is opt-in and inspectable from
Settings.

## `hooks`

Per-event hook lists for custom automation around Guildhall lifecycle events.

```yaml
hooks:
  pre_tool_use:
    - type: command
      matcher: "Bash:*rm -rf*"
      command: "./scripts/danger-log.sh"
```

## `mcp.servers`

External MCP servers whose tools should become available to Guildhall agents.

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

Free-form groups shown on the Projects page.

```yaml
tags:
  - frontend
  - typescript
```
