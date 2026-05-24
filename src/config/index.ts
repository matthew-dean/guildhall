// Schemas & types
export {
  WorkspaceYamlConfig,
  GlobalConfig,
  WorkspaceRegistryEntry,
  WorkspaceRegistry,
  GitStoryAutomationLevel,
  GitStoryCompletionTarget,
  GitStoryPolicy,
  AgentSettings,
  AgentCoordinatorOverride,
  AgentSettingEntry,
  AGENT_OVERRIDES_FILENAME,
  ResolvedConfig,
  slugify,
  mergeModels,
  resolveModelsForProvider,
  writeModelsForProvider,
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

// Project-local private overrides (<project>/.guildhall/config.yaml) plus the
// shared `.guildhall/*.yaml` metadata file policy.
export {
  ProjectGuildhallConfig,
  PROJECT_CONFIG_DIRNAME,
  PROJECT_CONFIG_FILENAME,
  SHARED_PROJECT_METADATA_GITIGNORE_ENTRIES,
  LOCAL_PROJECT_STATE_GITIGNORE_ENTRIES,
  GUILDHALL_GITIGNORE_BEGIN,
  GUILDHALL_GITIGNORE_END,
  guildhallGitignoreManagedBlock,
  applyGuildhallGitignorePolicy,
  projectConfigDir,
  projectConfigPath,
  ensureProjectGuildhallFilePolicy,
  ensureProjectLocalStateIgnored,
  readProjectConfig,
  writeProjectConfig,
  updateProjectConfig,
} from './project-config.js'

export {
  ARTIFACT_REGISTRY_FILENAME,
  ProjectArtifact,
  ProjectArtifactRegistry,
  artifactRegistryPath,
  readArtifactRegistry,
  writeArtifactRegistry,
  resolveArtifact,
  ensureArtifactRegistryTrackable,
} from './artifacts.js'

// Global providers store (~/.guildhall/providers.yaml)
export {
  GLOBAL_PROVIDERS_FILENAME,
  GlobalProvidersSchema,
  globalProvidersPath,
  readGlobalProviders,
  writeGlobalProviders,
  setProvider,
  removeProvider,
  markProviderVerified,
  resolveGlobalCredentials,
  migrateProjectProvidersToGlobal,
} from './global-providers.js'
export type {
  GlobalProviders,
  ProviderKind,
  ResolvedProviderCredentials,
  MigrationReport,
} from './global-providers.js'

// Config resolution (merged result)
export { resolveConfig } from './resolve.js'
export type { ResolveOptions } from './resolve.js'
export type { ModelConfigInput, ProviderModelShortcut, ProviderModelAssignments } from './schemas.js'
export type {
  GitStoryAutomationLevel as GitStoryAutomationLevelType,
  GitStoryCompletionTarget as GitStoryCompletionTargetType,
  GitStoryPolicy as GitStoryPolicyType,
} from './schemas.js'
