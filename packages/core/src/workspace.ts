import { z } from 'zod'
import { ModelAssignmentConfig, DEFAULT_LOCAL_MODEL_ASSIGNMENT } from './models.js'
import type { CoordinatorDomain } from './coordinator.js'

// ---------------------------------------------------------------------------
// Workspace
//
// A workspace is a self-contained directory that holds:
//   - A guildhall.workspace.ts config file
//   - A memory/ subdirectory (TASKS.json, MEMORY.md, DECISIONS.md, PROGRESS.md)
//
// The Forge tool is installed once. Workspaces can live anywhere.
// Multiple workspaces can run simultaneously as separate processes.
//
// Typical layouts:
//
//   Dedicated workspace directory:
//     ~/workspaces/my-project/
//       guildhall.workspace.ts
//       memory/
//
//   Workspace inside a project:
//     ~/git/my-project/.guildhall/
//       guildhall.workspace.ts
//       memory/
//
//   Default workspace (ships with Forge, for Looma + Knit):
//     ~/git/oss/forge/memory/
//       (uses packages/runtime/src/guildhall.config.ts)
// ---------------------------------------------------------------------------

export const WorkspaceConfig = z.object({
  // Human-readable name for this workspace (used in progress reports)
  name: z.string(),

  // Which model to use for each agent role
  // Defaults to DEFAULT_LOCAL_MODEL_ASSIGNMENT if not specified
  models: ModelAssignmentConfig.optional(),

  // Coordinator domain definitions
  coordinators: z.array(z.custom<CoordinatorDomain>()),

  // Override the memory directory path
  // Defaults to <workspace-root>/memory
  memoryDir: z.string().optional(),

  // Max revision cycles before a task is escalated as blocked
  maxRevisions: z.number().default(3),

  // How often (in task transitions) to write a heartbeat progress entry
  heartbeatInterval: z.number().default(5),
})
export type WorkspaceConfig = z.infer<typeof WorkspaceConfig>

// ---------------------------------------------------------------------------
// defineWorkspace — the config helper used in guildhall.workspace.ts files.
// Provides type safety and IDE autocomplete, similar to defineConfig in Vite.
// ---------------------------------------------------------------------------

export function defineWorkspace(config: Omit<WorkspaceConfig, 'models'> & {
  models?: Partial<WorkspaceConfig['models']>
}): WorkspaceConfig {
  return WorkspaceConfig.parse({
    ...config,
    models: {
      ...DEFAULT_LOCAL_MODEL_ASSIGNMENT,
      ...(config.models ?? {}),
    },
  })
}
