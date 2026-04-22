import { existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import {
  resolveConfig,
  findWorkspaceRoot,
  FORGE_YAML_FILENAME,
} from '@guildhall/config'
import type { ResolvedConfig } from '@guildhall/config'

// ---------------------------------------------------------------------------
// Workspace loader (YAML-based)
//
// Resolution order:
//   1. Explicit --workspace <path> CLI flag
//   2. FORGE_WORKSPACE env var
//   3. guildhall.yaml walking up from CWD
//   4. Error — user must run `guildhall init` or `guildhall register`
// ---------------------------------------------------------------------------

export interface ResolvedWorkspace {
  /** Absolute path to the directory containing guildhall.yaml */
  root: string
  /** Absolute path to the memory/ directory */
  memoryDir: string
  /** Fully merged config */
  config: ResolvedConfig
}

/**
 * Load a workspace from an explicit path.
 * `workspacePath` must be a directory containing guildhall.yaml.
 */
export function loadWorkspace(workspacePath: string): ResolvedWorkspace {
  const absPath = resolve(workspacePath)

  if (!existsSync(join(absPath, FORGE_YAML_FILENAME))) {
    throw new Error(
      `guildhall.yaml not found in ${absPath}.\n` +
      `Run "guildhall init" to create a new workspace, or "guildhall register <path>" to register an existing one.`
    )
  }

  const config = resolveConfig({ workspacePath: absPath })

  return {
    root: absPath,
    memoryDir: config.memoryDir,
    config,
  }
}

/**
 * Auto-discover the workspace, in priority order:
 *   1. Explicit workspacePath argument
 *   2. FORGE_WORKSPACE env var
 *   3. guildhall.yaml walking up from CWD
 */
export function resolveWorkspace(workspacePath?: string): ResolvedWorkspace {
  // 1. Explicit path
  if (workspacePath) {
    return loadWorkspace(workspacePath)
  }

  // 2. Env var
  const envWorkspace = process.env['FORGE_WORKSPACE']
  if (envWorkspace) {
    return loadWorkspace(envWorkspace)
  }

  // 3. Walk up from CWD
  const found = findWorkspaceRoot(process.cwd())
  if (found) {
    return loadWorkspace(found)
  }

  throw new Error(
    'No guildhall.yaml found in the current directory or any parent.\n' +
    'Run "guildhall init" to create a new workspace, or cd into an existing one.'
  )
}
