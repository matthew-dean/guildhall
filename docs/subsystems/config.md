---
title: Config loader
help_topic: subsystem.config
help_summary: |
  Resolves configuration from three layers — global (~/.guildhall/), workspace
  (guildhall.yaml), and project (.guildhall/config.yaml) — merging later
  layers over earlier ones.
---

# Config loader

**Source:** `src/config/`

Three config layers, merged in order:

1. **Global** — `~/.guildhall/config.yaml`. Provider credentials, default models, provider fallback policy, UI preferences. Overridable with `GUILDHALL_CONFIG_DIR`.
2. **Workspace** — `guildhall.yaml` at the workspace root. Coordinators, domains, MCP servers, hooks, models.
3. **Project** — `.guildhall/config.yaml` inside a repo. Mostly used for per-repo secrets and provider policy that shouldn't be committed.

Project overrides workspace overrides global.

## Public API

```ts
import {
  readGlobalConfig, writeGlobalConfig,
  readWorkspaceConfig, readProjectConfig,
  resolveConfig,
  findWorkspace, registerWorkspace, listWorkspaces,
  readAgentSettings, writeAgentSettings,
} from 'guildhall/config'

const config = await resolveConfig({ cwd, workspaceId })
```

`resolveConfig()` returns a fully validated `ResolvedConfig` that all other subsystems accept.

## `WorkspaceYamlConfig` schema

```ts
interface WorkspaceYamlConfig {
  name: string
  id: string
  projectPath: string
  models: ModelAssignmentConfig
  coordinators: CoordinatorDomain[]
  maxRevisions?: number              // default 3
  bootstrap?: {
    commands?: string[]
    successGates?: string[]
    gates?: {
      lint?: string
      typecheck?: string
      build?: string
      test?: string
    }
  }
  hooks?: Record<HookEvent, HookDefinition[]>
  mcp?: { servers: Record<string, McpServerConfig> }
  ignore?: string[]
  tags?: string[]
}
```

See [`guildhall.yaml` reference](../reference/workspace-config) for the user-facing field-by-field breakdown.

## Registry

`~/.guildhall/registry.yaml` lists every registered workspace with its id and path. `findWorkspace(id)` resolves an id to a concrete `WorkspaceYamlConfig`.

## Validation

All config reads go through Zod schemas (`src/config/schemas.ts`). Validation errors include a pointer into the YAML (line + column) so the dashboard can surface them inline.
