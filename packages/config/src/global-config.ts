import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { load as yamlLoad, dump as yamlDump } from 'js-yaml'
import { GlobalConfig } from './schemas.js'
import type { ZodError } from 'zod'

// ---------------------------------------------------------------------------
// ~/.guildhall/ directory layout
//
//   ~/.guildhall/
//     config.yaml      — global defaults
//     registry.yaml    — workspace registry
// ---------------------------------------------------------------------------

export function forgeHomeDir(): string {
  return join(homedir(), '.forge')
}

export function globalConfigPath(): string {
  return join(forgeHomeDir(), 'config.yaml')
}

export function registryPath(): string {
  return join(forgeHomeDir(), 'registry.yaml')
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Read and parse ~/.guildhall/config.yaml.
 * Returns default config if the file does not exist.
 */
export function readGlobalConfig(): GlobalConfig {
  const configPath = globalConfigPath()

  if (!existsSync(configPath)) {
    return GlobalConfig.parse({})
  }

  let raw: unknown
  try {
    raw = yamlLoad(readFileSync(configPath, 'utf8'))
  } catch (err) {
    throw new Error(`Failed to parse ~/.guildhall/config.yaml: ${String(err)}`)
  }

  let parsed: GlobalConfig
  try {
    parsed = GlobalConfig.parse(raw ?? {})
  } catch (err) {
    const zodErr = err as ZodError
    const issues = zodErr.issues?.map(i => `  ${i.path.join('.')}: ${i.message}`).join('\n') ?? String(err)
    throw new Error(`Invalid ~/.guildhall/config.yaml:\n${issues}`)
  }

  return parsed
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Write a GlobalConfig to ~/.guildhall/config.yaml.
 * Creates ~/.guildhall/ if it does not exist.
 */
export function writeGlobalConfig(config: GlobalConfig): void {
  const homeDir = forgeHomeDir()
  if (!existsSync(homeDir)) {
    mkdirSync(homeDir, { recursive: true })
  }

  const validated = GlobalConfig.parse(config)
  const yaml = yamlDump(validated, { lineWidth: 120, noRefs: true })
  writeFileSync(globalConfigPath(), yaml, 'utf8')
}

/**
 * Merge a partial config into the current global config and persist.
 */
export function updateGlobalConfig(patch: Partial<GlobalConfig>): GlobalConfig {
  const current = readGlobalConfig()
  const merged = GlobalConfig.parse({ ...current, ...patch })
  writeGlobalConfig(merged)
  return merged
}

/**
 * Ensure ~/.guildhall/ exists with a default config.yaml if missing.
 * Safe to call multiple times (idempotent).
 */
export function ensureForgeHome(): void {
  const homeDir = forgeHomeDir()
  if (!existsSync(homeDir)) {
    mkdirSync(homeDir, { recursive: true })
  }
  if (!existsSync(globalConfigPath())) {
    writeGlobalConfig(GlobalConfig.parse({}))
  }
  // registry.yaml is bootstrapped by registry.ts on first read/write
}
