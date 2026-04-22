import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { load as yamlLoad, dump as yamlDump } from 'js-yaml'
import { WorkspaceYamlConfig, AgentSettings, AGENT_OVERRIDES_FILENAME, slugify } from './schemas.js'
import type { ZodError } from 'zod'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const FORGE_YAML_FILENAME = 'guildhall.yaml'
export const MEMORY_DIR_NAME = 'memory'

// ---------------------------------------------------------------------------
// Locate guildhall.yaml
// ---------------------------------------------------------------------------

/**
 * Walk up from `startDir` looking for a guildhall.yaml file.
 * Returns the absolute path to the directory containing guildhall.yaml, or null.
 */
export function findWorkspaceRoot(startDir: string): string | null {
  let dir = resolve(startDir)

  // Walk up max 10 levels to avoid infinite loops
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, FORGE_YAML_FILENAME))) {
      return dir
    }
    const parent = dirname(dir)
    if (parent === dir) break // reached filesystem root
    dir = parent
  }

  return null
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Read and parse guildhall.yaml from `workspacePath`.
 * `workspacePath` should be the directory containing guildhall.yaml.
 */
export function readWorkspaceConfig(workspacePath: string): WorkspaceYamlConfig {
  const configPath = join(resolve(workspacePath), FORGE_YAML_FILENAME)

  if (!existsSync(configPath)) {
    throw new Error(`guildhall.yaml not found at ${configPath}`)
  }

  let raw: unknown
  try {
    raw = yamlLoad(readFileSync(configPath, 'utf8'))
  } catch (err) {
    throw new Error(`Failed to parse ${configPath}: ${String(err)}`)
  }

  try {
    return WorkspaceYamlConfig.parse(raw ?? {})
  } catch (err) {
    const zodErr = err as ZodError
    const issues = zodErr.issues?.map(i => `  ${i.path.join('.')}: ${i.message}`).join('\n') ?? String(err)
    throw new Error(`Invalid guildhall.yaml at ${configPath}:\n${issues}`)
  }
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Write a WorkspaceYamlConfig to `workspacePath/guildhall.yaml`.
 * Creates the directory if it does not exist.
 */
export function writeWorkspaceConfig(workspacePath: string, config: WorkspaceYamlConfig): void {
  const absPath = resolve(workspacePath)
  if (!existsSync(absPath)) {
    mkdirSync(absPath, { recursive: true })
  }

  const validated = WorkspaceYamlConfig.parse(config)
  const yaml = yamlDump(validated, { lineWidth: 120, noRefs: true })
  writeFileSync(join(absPath, FORGE_YAML_FILENAME), yaml, 'utf8')
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

/**
 * Create a new workspace directory with a guildhall.yaml and empty memory/ subdir.
 * Safe to call on an existing directory — only writes missing files.
 */
export function bootstrapWorkspace(
  workspacePath: string,
  options: {
    name: string
    projectPath?: string
    coordinators?: WorkspaceYamlConfig['coordinators']
  }
): WorkspaceYamlConfig {
  const absPath = resolve(workspacePath)
  const configPath = join(absPath, FORGE_YAML_FILENAME)
  const memoryPath = join(absPath, MEMORY_DIR_NAME)

  // Don't overwrite existing config
  if (existsSync(configPath)) {
    return readWorkspaceConfig(absPath)
  }

  // Ensure directories exist
  mkdirSync(absPath, { recursive: true })
  mkdirSync(memoryPath, { recursive: true })
  // FR-08: memory/exploring/<task-id>.md is where the spec-agent records
  // the conversational intake transcript. Seed the subdirectory up front so
  // the append tool doesn't race on first write.
  mkdirSync(join(memoryPath, 'exploring'), { recursive: true })

  // Derive id from name
  const id = slugify(options.name)

  const config: WorkspaceYamlConfig = WorkspaceYamlConfig.parse({
    name: options.name,
    id,
    projectPath: options.projectPath,
    coordinators: options.coordinators ?? [],
  })

  writeWorkspaceConfig(absPath, config)

  // Seed empty memory files
  const memoryFiles = {
    'TASKS.json': '[]',
    'MEMORY.md': `# ${options.name} Memory\n\n_Updated by GuildHall agents._\n`,
    'DECISIONS.md': `# ${options.name} Decisions\n\n_Architecture decisions recorded by GuildHall agents._\n`,
    'PROGRESS.md': `# ${options.name} Progress\n\n_Progress log maintained by GuildHall agents._\n`,
  }

  for (const [filename, content] of Object.entries(memoryFiles)) {
    const filePath = join(memoryPath, filename)
    if (!existsSync(filePath)) {
      writeFileSync(filePath, content, 'utf8')
    }
  }

  return config
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the memory directory for a workspace.
 * Always returns <workspacePath>/memory (absolute).
 */
export function resolveMemoryDir(workspacePath: string): string {
  return join(resolve(workspacePath), MEMORY_DIR_NAME)
}

// ---------------------------------------------------------------------------
// Agent overrides (memory/agent-overrides.yaml)
// ---------------------------------------------------------------------------

function agentOverridesPath(workspacePath: string): string {
  return join(resolve(workspacePath), MEMORY_DIR_NAME, AGENT_OVERRIDES_FILENAME)
}

/**
 * Read memory/agent-overrides.yaml for a workspace.
 * Returns an empty AgentSettings if the file does not exist.
 */
export function readAgentSettings(workspacePath: string): AgentSettings {
  const filePath = agentOverridesPath(workspacePath)

  if (!existsSync(filePath)) {
    return AgentSettings.parse({})
  }

  let raw: unknown
  try {
    raw = yamlLoad(readFileSync(filePath, 'utf8'))
  } catch (err) {
    throw new Error(`Failed to parse memory/agent-overrides.yaml: ${String(err)}`)
  }

  try {
    return AgentSettings.parse(raw ?? {})
  } catch (err) {
    const zodErr = err as ZodError
    const issues = zodErr.issues?.map(i => `  ${i.path.join('.')}: ${i.message}`).join('\n') ?? String(err)
    throw new Error(`Invalid memory/agent-overrides.yaml:\n${issues}`)
  }
}

/**
 * Write memory/agent-overrides.yaml for a workspace.
 * Creates the memory/ directory if needed.
 */
export function writeAgentSettings(workspacePath: string, settings: AgentSettings): void {
  const memDir = join(resolve(workspacePath), MEMORY_DIR_NAME)
  if (!existsSync(memDir)) {
    mkdirSync(memDir, { recursive: true })
  }
  const validated = AgentSettings.parse(settings)
  const yaml = yamlDump(validated, { lineWidth: 120, noRefs: true })
  writeFileSync(agentOverridesPath(workspacePath), yaml, 'utf8')
}

/**
 * Apply a partial update to agent-overrides.yaml.
 * Merges coordinator overrides (append-only for concerns, decisions, triggers)
 * and records the change in the history trail.
 */
export function updateAgentSettings(
  workspacePath: string,
  patch: Partial<AgentSettings>,
  meta: { agentRole: string; rationale: string }
): AgentSettings {
  const current = readAgentSettings(workspacePath)
  const now = new Date().toISOString()
  const entry = { savedAt: now, agentRole: meta.agentRole, rationale: meta.rationale }

  // Merge model overrides (last write wins per role)
  const models = patch.models
    ? { ...(current.models ?? {}), ...patch.models }
    : current.models

  // Merge coordinator overrides (append-only for lists)
  const coordinators = { ...current.coordinators }
  for (const [coordId, override] of Object.entries(patch.coordinators ?? {})) {
    const existing = coordinators[coordId] ?? {
      addConcerns: [], removeConcerns: [], addAutonomousDecisions: [],
      addEscalationTriggers: [], history: [],
    }
    coordinators[coordId] = {
      addConcerns: dedup([...existing.addConcerns, ...override.addConcerns], c => c.id),
      removeConcerns: [...new Set([...existing.removeConcerns, ...override.removeConcerns])],
      addAutonomousDecisions: [...new Set([...existing.addAutonomousDecisions, ...override.addAutonomousDecisions])],
      addEscalationTriggers: [...new Set([...existing.addEscalationTriggers, ...override.addEscalationTriggers])],
      mandateAddendum: override.mandateAddendum ?? existing.mandateAddendum,
      history: [...existing.history, entry],
    }
  }

  // Merge addIgnore (append-only, deduplicated)
  const addIgnore = [...new Set([...current.addIgnore, ...(patch.addIgnore ?? [])])]

  const merged = AgentSettings.parse({
    version: 1,
    models,
    coordinators,
    addIgnore,
    maxRevisions: patch.maxRevisions ?? current.maxRevisions,
    heartbeatInterval: patch.heartbeatInterval ?? current.heartbeatInterval,
    history: [...current.history, entry],
  })

  writeAgentSettings(workspacePath, merged)
  return merged
}

function dedup<T>(arr: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>()
  return arr.filter(item => {
    const k = key(item)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}
