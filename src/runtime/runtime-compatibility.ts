import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  getProjectLocalHistoryDir,
  getProjectSystemStatePath,
  readProjectStateDatabaseCurrentAuthority,
} from '@guildhall/sessions'

export interface ProjectRuntimeManifest {
  version: 1
  writtenByGuildhall?: string
  minGuildhallVersion?: string
  stateSchema?: string
  requiredFeatures?: string[]
  updatedAt?: string
}

export interface ProjectRuntimeBlocker {
  canStart: false
  code: 'runtime_too_old'
  message: string
  actionHref: string
}

/**
 * Legacy queue migrations are allowed to read a file only before SQLite owns
 * the project's current state. A promoted project must be inspected through
 * its canonical database projections, never by replaying an old queue file.
 */
export function legacyCurrentStateMigrationAvailable(projectRoot: string): boolean {
  return readProjectStateDatabaseCurrentAuthority(projectRoot) !== 'database'
}

export function assertLegacyCurrentStateMigrationAccess(
  projectRoot: string,
  migrationId: string,
): void {
  if (legacyCurrentStateMigrationAvailable(projectRoot)) return
  throw new Error(
    `Cannot apply ${migrationId}: SQLite already owns current project state. Read and mutate the canonical project projections instead of legacy current-state files.`,
  )
}

const CURRENT_RUNTIME_FEATURES = new Set([
  'attention-records.v1',
  'intake.schema-surface.v1',
  'intake.text-corpus-map.v1',
  'project-migrations.v1',
  'task-state-split.v1',
])

function manifestPath(projectRoot: string): string {
  return join(getProjectLocalHistoryDir(projectRoot), 'runtime', 'compatibility.json')
}

function legacyManifestPath(projectRoot: string): string {
  return getProjectSystemStatePath(projectRoot, 'runtime.json')
}

function parseVersion(version: string): number[] | null {
  const main = version.trim().replace(/^v/i, '').split(/[+-]/)[0] ?? ''
  if (!/^\d+(?:\.\d+){0,2}$/.test(main)) return null
  return main.split('.').map(part => Number(part))
}

function readManifestFile(file: string): ProjectRuntimeManifest | null {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<ProjectRuntimeManifest>
    if (parsed.version !== 1) return null
    return {
      version: 1,
      ...(typeof parsed.writtenByGuildhall === 'string' ? { writtenByGuildhall: parsed.writtenByGuildhall } : {}),
      ...(typeof parsed.minGuildhallVersion === 'string' ? { minGuildhallVersion: parsed.minGuildhallVersion } : {}),
      ...(typeof parsed.stateSchema === 'string' ? { stateSchema: parsed.stateSchema } : {}),
      ...(Array.isArray(parsed.requiredFeatures)
        ? { requiredFeatures: parsed.requiredFeatures.filter((feature): feature is string => typeof feature === 'string') }
        : {}),
      ...(typeof parsed.updatedAt === 'string' ? { updatedAt: parsed.updatedAt } : {}),
    }
  } catch {
    return null
  }
}

/**
 * The old marker remains readable only by the compatibility gate. It is not a
 * current project-state source and must never be returned as the canonical
 * runtime manifest.
 */
function readLegacyRuntimeManifestForCompatibility(projectRoot: string): ProjectRuntimeManifest | null {
  const file = legacyManifestPath(projectRoot)
  if (!existsSync(file)) return null
  return readManifestFile(file)
}

export function compareVersions(left: string, right: string): number | null {
  const a = parseVersion(left)
  const b = parseVersion(right)
  if (!a || !b) return null
  const width = Math.max(a.length, b.length)
  for (let i = 0; i < width; i++) {
    const av = a[i] ?? 0
    const bv = b[i] ?? 0
    if (av !== bv) return av > bv ? 1 : -1
  }
  return 0
}

export function readRuntimePackageVersion(): string {
  try {
    let dir = dirname(fileURLToPath(import.meta.url))
    for (let i = 0; i < 8; i++) {
      const file = join(dir, 'package.json')
      if (existsSync(file)) {
        const parsed = JSON.parse(readFileSync(file, 'utf8')) as { name?: string; version?: string }
        if (parsed.name === 'guildhall' || parsed.name === '@guildhall/cli') {
          return parsed.version ?? 'unknown'
        }
      }
      const next = dirname(dir)
      if (next === dir) break
      dir = next
    }
  } catch {
    // Fall through to unknown.
  }
  return 'unknown'
}

export function readProjectRuntimeManifest(projectRoot: string): ProjectRuntimeManifest | null {
  const file = manifestPath(projectRoot)
  return existsSync(file) ? readManifestFile(file) : null
}

export function projectRuntimeCompatibilityBlocker(input: {
  projectRoot: string
  currentVersion?: string
}): ProjectRuntimeBlocker | null {
  const manifest = readProjectRuntimeManifest(input.projectRoot) ??
    readLegacyRuntimeManifestForCompatibility(input.projectRoot)
  if (!manifest) return null
  const currentVersion = input.currentVersion ?? readRuntimePackageVersion()
  // Older installed bundles could not resolve their own package metadata and
  // wrote the literal sentinel `unknown`. That is not a version requirement;
  // treating it as one bricks otherwise compatible project migrations.
  const minimum = manifest.minGuildhallVersion?.trim()
  const usableMinimum = minimum && minimum !== 'unknown' ? minimum : undefined
  if (usableMinimum) {
    const comparison = compareVersions(currentVersion, usableMinimum)
    if (comparison === null || comparison < 0) {
      return {
        canStart: false,
        code: 'runtime_too_old',
        message: `This project requires Guildhall ${usableMinimum} or newer. You are running ${currentVersion}. Upgrade Guildhall before changing this project.`,
        actionHref: '/settings/about',
      }
    }
  }
  const missingFeatures = (manifest.requiredFeatures ?? []).filter(feature => !CURRENT_RUNTIME_FEATURES.has(feature))
  if (missingFeatures.length > 0) {
    return {
      canStart: false,
      code: 'runtime_too_old',
      message: `This project uses Guildhall state features this runtime does not understand: ${missingFeatures.join(', ')}. Upgrade Guildhall before changing this project.`,
      actionHref: '/settings/about',
    }
  }
  return null
}

export function recordGuildhallRuntimeWrite(projectRoot: string, features: readonly string[]): void {
  const currentVersion = readRuntimePackageVersion()
  const existing = readProjectRuntimeManifest(projectRoot)
  const requiredFeatures = new Set([...(existing?.requiredFeatures ?? []), ...features])
  const existingMinimum = existing?.minGuildhallVersion
  const minGuildhallVersion = existingMinimum && compareVersions(existingMinimum, currentVersion) === 1
    ? existingMinimum
    : currentVersion
  const next: ProjectRuntimeManifest = {
    version: 1,
    writtenByGuildhall: currentVersion,
    minGuildhallVersion,
    stateSchema: existing?.stateSchema ?? 'project-state.v1',
    requiredFeatures: [...requiredFeatures].sort(),
    updatedAt: new Date().toISOString(),
  }
  const file = manifestPath(projectRoot)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
}
