---
title: Config loader
help_topic: subsystem.config
help_summary: |
  Resolves configuration from global defaults, ./guildhall.yaml, and
  ./memory/agent-settings, while consulting project-local config for a smaller
  set of runtime selections such as preferredProvider and landingBranch.
---

# Config loader

**Source:** `./src/config/`

The main resolved runtime config is built from these layers:

1. **Global** — `~/.guildhall/config.yaml`. Machine-wide defaults and UI preferences. Overridable with `GUILDHALL_CONFIG_DIR`.
2. **Workspace** — `./guildhall.yaml` at the workspace root. Coordinators, domains, MCP servers, hooks, models.
3. **Agent settings** — `./memory/agent-settings.yaml`. Learned overrides such as coordinator addenda, ignore additions, and runtime knobs.

Project-local config is consulted more narrowly for local runtime overrides such as `landingBranch` and, when needed, a project-specific `preferredProvider`; it is not the main third layer in the resolved orchestrator config.

Provider credentials are now separate from that merge stack:

- `~/.guildhall/providers.yaml` for machine-scoped API keys and local-model URLs
- provider-owned auth files such as `~/.claude/.credentials.json` and `~/.codex/auth.json` for OAuth flows
- `preferredProvider` in `~/.guildhall/config.yaml` for the machine default
- optional `preferredProvider` in `./.guildhall/config.yaml` only when one project needs an override

## Public API

```ts
import {
  readGlobalConfig, writeGlobalConfig,
  readWorkspaceConfig, readProjectConfig,
  resolveConfig,
  findWorkspace, registerWorkspace, listWorkspaces,
  readAgentSettings, writeAgentSettings,
} from 'guildhall/config'

const config = resolveConfig({ workspacePath })
```

`resolveConfig()` returns a fully validated `ResolvedConfig` that the orchestrator and service accept. It reads the machine-global default first, lets project-local config override specific fields when present, then merges global defaults, `./guildhall.yaml`, and `./memory/agent-settings.yaml`.

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

See [`./guildhall.yaml` reference](../reference/workspace-config) for the user-facing field-by-field breakdown.

## Registry

`~/.guildhall/registry.yaml` lists every registered workspace with its id and path. `findWorkspace(id)` resolves an id to a concrete `WorkspaceYamlConfig`.

## Validation

All config reads go through Zod schemas (`./src/config/schemas.ts`). Validation errors include a pointer into the YAML (line + column) so the dashboard can surface them inline.
