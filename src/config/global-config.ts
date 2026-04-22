import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  renameSync,
  cpSync,
  rmSync,
  readdirSync,
} from 'node:fs'
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

export function guildhallHomeDir(): string {
  return join(homedir(), '.guildhall')
}

export function globalConfigPath(): string {
  return join(guildhallHomeDir(), 'config.yaml')
}

export function registryPath(): string {
  return join(guildhallHomeDir(), 'registry.yaml')
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
  const homeDir = guildhallHomeDir()
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
 *
 * Also performs a one-time migration from the pre-rename ~/.forge/ directory:
 * if ~/.guildhall/ does not exist but ~/.forge/ does, rename it.
 */
export function ensureGuildhallHome(): void {
  const homeDir = guildhallHomeDir()
  const legacyHomeDir = join(homedir(), '.forge')

  if (existsSync(legacyHomeDir)) {
    if (!existsSync(homeDir)) {
      renameSync(legacyHomeDir, homeDir)
      console.log(`[guildhall] migrated ${legacyHomeDir} → ${homeDir}`)
    } else {
      // Both dirs exist (older install of a dev build probably created ~/.guildhall
      // before this rename landed). Copy any files the legacy dir has that the new
      // one is missing, then remove the legacy dir.
      for (const name of readdirSync(legacyHomeDir)) {
        const src = join(legacyHomeDir, name)
        const dest = join(homeDir, name)
        if (!existsSync(dest)) cpSync(src, dest, { recursive: true })
      }
      rmSync(legacyHomeDir, { recursive: true, force: true })
      console.log(`[guildhall] merged ${legacyHomeDir} into ${homeDir} and removed the legacy dir`)
    }
  }

  if (!existsSync(homeDir)) {
    mkdirSync(homeDir, { recursive: true })
  }
  if (!existsSync(globalConfigPath())) {
    writeGlobalConfig(GlobalConfig.parse({}))
  }
  // registry.yaml is bootstrapped by registry.ts on first read/write
}
