import { resolve, join, isAbsolute } from 'node:path'
import { readGlobalConfig } from './global-config.js'
import { readWorkspaceConfig, resolveMemoryDir, readAgentSettings } from './workspace-config.js'
import { ResolvedConfig, mergeModels, slugify } from './schemas.js'
import type { WorkspaceYamlConfig, AgentSettings } from './schemas.js'

// ---------------------------------------------------------------------------
// resolve — produce a fully-merged ResolvedConfig
//
// Priority (highest → lowest):
//   1. Environment variables (LM_STUDIO_BASE_URL, etc.)
//   2. memory/agent-overrides.yaml ← agents write here at runtime
//   3. guildhall.yaml                  ← human intent
//   4. ~/.guildhall/config.yaml        ← global defaults
//   5. Built-in defaults           ← Zod schema defaults
// ---------------------------------------------------------------------------

export interface ResolveOptions {
  /** Absolute path to the directory containing guildhall.yaml */
  workspacePath: string
}

/**
 * Apply agent-settings coordinator overrides onto the workspace coordinator list.
 * - Appends learned concerns, decisions, triggers
 * - Removes concerns flagged for removal
 * - Appends mandate addendum
 * - Applies model overrides
 */
function applyAgentSettings(
  workspace: WorkspaceYamlConfig,
  agentSettings: AgentSettings,
): WorkspaceYamlConfig {
  // Model overrides from agents (highest specificity)
  const models = agentSettings.models
    ? { ...(workspace.models ?? {}), ...agentSettings.models }
    : workspace.models

  // Coordinator overrides
  const coordinators = workspace.coordinators.map(coord => {
    const override = agentSettings.coordinators[coord.id]
    if (!override) return coord

    // Merge concerns: append new, remove flagged
    const mergedConcerns = [
      ...coord.concerns.filter(c => !override.removeConcerns.includes(c.id)),
      ...override.addConcerns,
    ]

    // Append mandate addendum if present
    const mandate = override.mandateAddendum
      ? `${coord.mandate}\n\n[Agent addendum]\n${override.mandateAddendum}`
      : coord.mandate

    return {
      ...coord,
      mandate,
      concerns: mergedConcerns,
      autonomousDecisions: [
        ...coord.autonomousDecisions,
        ...override.addAutonomousDecisions,
      ],
      escalationTriggers: [
        ...coord.escalationTriggers,
        ...override.addEscalationTriggers,
      ],
    }
  })

  // Merge ignore patterns
  const ignore = [
    ...new Set([...workspace.ignore, ...agentSettings.addIgnore]),
  ]

  return {
    ...workspace,
    models,
    coordinators,
    ignore,
    maxRevisions: agentSettings.maxRevisions ?? workspace.maxRevisions,
    heartbeatInterval: agentSettings.heartbeatInterval ?? workspace.heartbeatInterval,
  }
}

/**
 * Load and merge all config layers into a ResolvedConfig.
 * This is the primary entry point for the orchestrator and CLI.
 */
export function resolveConfig(opts: ResolveOptions): ResolvedConfig {
  const workspacePath = resolve(opts.workspacePath)

  // Layer 1: global defaults
  const global = readGlobalConfig()

  // Layer 2: workspace config (guildhall.yaml)
  const workspaceRaw = readWorkspaceConfig(workspacePath)

  // Layer 3: agent-accumulated overrides (memory/agent-overrides.yaml)
  const agentSettings = readAgentSettings(workspacePath)

  // Apply agent settings on top of guildhall.yaml
  const workspace = applyAgentSettings(workspaceRaw, agentSettings)

  // Merge models: built-in defaults ← global ← guildhall.yaml ← agent-settings
  const models = mergeModels(global.models ?? {}, workspace.models)

  // Resolve project path
  const projectPath = workspace.projectPath
    ? resolve(workspace.projectPath.replace(/^~/, process.env['HOME'] ?? ''))
    : workspacePath

  // Workspace id
  const workspaceId = workspace.id ?? slugify(workspace.name)

  // Memory dir is always <workspacePath>/memory
  const memoryDir = resolveMemoryDir(workspacePath)

  // Environment variable overrides (highest priority)
  const lmStudioUrl =
    process.env['LM_STUDIO_BASE_URL'] ??
    global.lmStudioUrl

  const servePort = global.servePort

  // Resolve coordinator paths (relative → absolute)
  const coordinators = workspace.coordinators.map(c => ({
    ...c,
    path: c.path
      ? (isAbsolute(c.path) ? c.path : join(projectPath, c.path))
      : undefined,
  }))

  const resolved: ResolvedConfig = ResolvedConfig.parse({
    workspaceId,
    workspaceName: workspace.name,
    workspacePath,
    projectPath,
    memoryDir,
    models,
    coordinators,
    maxRevisions: workspace.maxRevisions ?? global.maxRevisions,
    heartbeatInterval: workspace.heartbeatInterval ?? global.heartbeatInterval,
    ignore: workspace.ignore,
    lmStudioUrl,
    servePort,
    ...(workspace.runtime ? { runtime: workspace.runtime } : {}),
    ...(workspace.hooks ? { hooks: workspace.hooks } : {}),
    ...(workspace.mcp ? { mcp: workspace.mcp } : {}),
  })

  return resolved
}
