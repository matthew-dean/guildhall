import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { load as yamlLoad, dump as yamlDump } from 'js-yaml'
import { WorkspaceRegistry, WorkspaceRegistryEntry } from './schemas.js'
import { registryPath, forgeHomeDir } from './global-config.js'
import type { ZodError } from 'zod'

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Read ~/.guildhall/registry.yaml.
 * Returns an empty registry if the file does not exist.
 */
export function readRegistry(): WorkspaceRegistry {
  const path = registryPath()

  if (!existsSync(path)) {
    return WorkspaceRegistry.parse({})
  }

  let raw: unknown
  try {
    raw = yamlLoad(readFileSync(path, 'utf8'))
  } catch (err) {
    throw new Error(`Failed to parse ~/.guildhall/registry.yaml: ${String(err)}`)
  }

  try {
    return WorkspaceRegistry.parse(raw ?? {})
  } catch (err) {
    const zodErr = err as ZodError
    const issues = zodErr.issues?.map(i => `  ${i.path.join('.')}: ${i.message}`).join('\n') ?? String(err)
    throw new Error(`Invalid ~/.guildhall/registry.yaml:\n${issues}`)
  }
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

function writeRegistry(registry: WorkspaceRegistry): void {
  const homeDir = forgeHomeDir()
  if (!existsSync(homeDir)) {
    mkdirSync(homeDir, { recursive: true })
  }
  const validated = WorkspaceRegistry.parse(registry)
  const yaml = yamlDump(validated, { lineWidth: 120, noRefs: true })
  writeFileSync(registryPath(), yaml, 'utf8')
}

// ---------------------------------------------------------------------------
// CRUD operations
// ---------------------------------------------------------------------------

/**
 * List all registered workspaces.
 */
export function listWorkspaces(): WorkspaceRegistryEntry[] {
  return readRegistry().workspaces
}

/**
 * Find a workspace by id or absolute path.
 */
export function findWorkspace(idOrPath: string): WorkspaceRegistryEntry | undefined {
  const abs = resolve(idOrPath)
  return readRegistry().workspaces.find(
    w => w.id === idOrPath || w.path === abs
  )
}

/**
 * Register a new workspace.
 * Throws if a workspace with the same id or path already exists.
 */
export function registerWorkspace(entry: Omit<WorkspaceRegistryEntry, 'registeredAt'>): WorkspaceRegistryEntry {
  const registry = readRegistry()
  const absPath = resolve(entry.path)

  const conflict = registry.workspaces.find(
    w => w.id === entry.id || w.path === absPath
  )
  if (conflict) {
    if (conflict.id === entry.id) {
      throw new Error(`Workspace with id "${entry.id}" already registered (path: ${conflict.path})`)
    }
    throw new Error(`Workspace at path "${absPath}" already registered as "${conflict.id}"`)
  }

  const newEntry: WorkspaceRegistryEntry = WorkspaceRegistryEntry.parse({
    ...entry,
    path: absPath,
    registeredAt: new Date().toISOString(),
  })

  registry.workspaces.push(newEntry)
  writeRegistry(registry)
  return newEntry
}

/**
 * Update a registered workspace (e.g., after guildhall.yaml is edited).
 * Identifies the entry by id. Returns the updated entry.
 */
export function updateWorkspace(
  id: string,
  patch: Partial<Omit<WorkspaceRegistryEntry, 'id' | 'registeredAt'>>
): WorkspaceRegistryEntry {
  const registry = readRegistry()
  const idx = registry.workspaces.findIndex(w => w.id === id)
  if (idx === -1) {
    throw new Error(`Workspace "${id}" not found in registry`)
  }

  const updated = WorkspaceRegistryEntry.parse({
    ...registry.workspaces[idx],
    ...patch,
    id,
  })
  registry.workspaces[idx] = updated
  writeRegistry(registry)
  return updated
}

/**
 * Remove a workspace from the registry by id or path.
 * Returns true if removed, false if not found.
 */
export function unregisterWorkspace(idOrPath: string): boolean {
  const registry = readRegistry()
  const abs = resolve(idOrPath)
  const before = registry.workspaces.length

  registry.workspaces = registry.workspaces.filter(
    w => w.id !== idOrPath && w.path !== abs
  )

  if (registry.workspaces.length === before) return false
  writeRegistry(registry)
  return true
}

/**
 * Touch the lastSeenAt timestamp for a workspace (called by the orchestrator heartbeat).
 */
export function touchWorkspace(id: string): void {
  const registry = readRegistry()
  const entry = registry.workspaces.find(w => w.id === id)
  if (!entry) return
  entry.lastSeenAt = new Date().toISOString()
  writeRegistry(registry)
}
