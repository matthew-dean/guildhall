import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getProjectStateDir } from '@guildhall/sessions'

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

const CURRENT_RUNTIME_FEATURES = new Set([
  'attention-records.v1',
  'intake.schema-surface.v1',
  'intake.text-corpus-map.v1',
  'project-migrations.v1',
  'task-state-split.v1',
])

function manifestPath(projectRoot: string): string {
  return join(getProjectStateDir(projectRoot), 'runtime.json')
}

function parseVersion(version: string): number[] | null {
  const main = version.trim().replace(/^v/i, '').split(/[+-]/)[0] ?? ''
  if (!/^\d+(?:\.\d+){0,2}$/.test(main)) return null
  return main.split('.').map(part => Number(part))
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
  try {
    const parsed = JSON.parse(readFileSync(manifestPath(projectRoot), 'utf8')) as Partial<ProjectRuntimeManifest>
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

export function projectRuntimeCompatibilityBlocker(input: {
  projectRoot: string
  currentVersion?: string
}): ProjectRuntimeBlocker | null {
  const manifest = readProjectRuntimeManifest(input.projectRoot)
  if (!manifest) return null
  const currentVersion = input.currentVersion ?? readRuntimePackageVersion()
  const minimum = manifest.minGuildhallVersion
  if (minimum) {
    const comparison = compareVersions(currentVersion, minimum)
    if (comparison === null || comparison < 0) {
      return {
        canStart: false,
        code: 'runtime_too_old',
        message: `This project requires Guildhall ${minimum} or newer. You are running ${currentVersion}. Upgrade Guildhall before changing this project.`,
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
