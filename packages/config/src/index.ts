// Schemas & types
export {
  WorkspaceYamlConfig,
  GlobalConfig,
  WorkspaceRegistryEntry,
  WorkspaceRegistry,
  AgentSettings,
  AgentCoordinatorOverride,
  AgentSettingEntry,
  AGENT_SETTINGS_FILENAME,
  ResolvedConfig,
  slugify,
  mergeModels,
} from './schemas.js'

// Global config (~/.guildhall/config.yaml)
export {
  guildhallHomeDir,
  globalConfigPath,
  registryPath,
  readGlobalConfig,
  writeGlobalConfig,
  updateGlobalConfig,
  ensureGuildhallHome,
} from './global-config.js'

// Workspace registry (~/.guildhall/registry.yaml)
export {
  readRegistry,
  listWorkspaces,
  findWorkspace,
  registerWorkspace,
  updateWorkspace,
  unregisterWorkspace,
  touchWorkspace,
} from './registry.js'

// Per-workspace config (guildhall.yaml) + agent-settings
export {
  FORGE_YAML_FILENAME,
  MEMORY_DIR_NAME,
  findWorkspaceRoot,
  readWorkspaceConfig,
  writeWorkspaceConfig,
  bootstrapWorkspace,
  resolveMemoryDir,
  readAgentSettings,
  writeAgentSettings,
  updateAgentSettings,
} from './workspace-config.js'

// Project-local config (<project>/.guildhall/config.yaml) — preferred over
// ~/.guildhall/ for single-project installs. The global config + registry
// remain available for guild-pro.
export {
  ProjectGuildhallConfig,
  PROJECT_CONFIG_DIRNAME,
  PROJECT_CONFIG_FILENAME,
  projectConfigDir,
  projectConfigPath,
  readProjectConfig,
  writeProjectConfig,
  updateProjectConfig,
} from './project-config.js'

// Config resolution (merged result)
export { resolveConfig } from './resolve.js'
export type { ResolveOptions } from './resolve.js'
