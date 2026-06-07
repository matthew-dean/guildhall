import { appendManagedTextFile, readManagedTextFile, readManagedTextFileSync, writeManagedTextFile } from '@guildhall/persistence'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'

import { getProjectRuntimeContainerHomeDir, getProjectRuntimeStatePath } from '@guildhall/sessions'

export type ProjectRuntimeBackendName = 'podman'
export type ProjectRuntimeStatus = 'stopped' | 'creating' | 'running' | 'failed'
export type ProjectRuntimeHealthStatus = 'unknown' | 'healthy' | 'degraded' | 'unhealthy'
export type RuntimeKeepAliveReason = 'command' | 'proof' | 'dev-server' | 'browser-proof'

function defaultRuntimeProjectPath(projectRoot: string): string {
  const slug = (basename(resolve(projectRoot)) || 'project')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'project'
  return `/workspace/${slug}`
}

export interface ProjectRuntimeImageState {
  repository: string
  tag: string
  digest: string | null
}

export interface ProjectRuntimeMountState {
  projectRoot: string
  projectPath: string
  guildhallHome: string
  guildhallHomePath: string
}

export interface ProjectRuntimePort {
  host: number
  container: number
  purpose: 'dashboard' | 'dev-server' | 'browser-proof' | 'custom'
}

export interface ProjectRuntimeHealth {
  status: ProjectRuntimeHealthStatus
  checkedAt: string | null
  checks: Array<{
    name: string
    ok: boolean
    message?: string
  }>
}

export interface ProjectRuntimeBackendSetupState {
  status:
    | 'ready'
    | 'missing'
    | 'machine-not-created'
    | 'machine-stopped'
    | 'unsupported-platform'
    | 'unknown-error'
  selectedMode: 'podman' | 'host-run' | null
  lastAction: string | null
  lastResult: 'completed' | 'declined' | 'failed' | null
  updatedAt: string | null
  message?: string
}

export interface ProjectRuntimeMigrationRollbackState {
  mode: 'host-run'
  backendSetupSelectedMode: 'host-run' | 'podman' | null
  mounts: ProjectRuntimeMountState
}

export interface ProjectRuntimeMigrationState {
  mode: 'host-run' | 'runtime-backed'
  fallbackAvailable: boolean
  lastResult: 'completed' | 'declined' | 'failed' | 'rolled-back' | null
  acceptedAt: string | null
  rolledBackAt: string | null
  runtimeApiVersion: '1'
  image: ProjectRuntimeImageState
  mountLayout: ProjectRuntimeMountState
  health: ProjectRuntimeHealth
  rollback: ProjectRuntimeMigrationRollbackState | null
}

export interface ProjectRuntimeState {
  backend: ProjectRuntimeBackendName
  status: ProjectRuntimeStatus
  image: ProjectRuntimeImageState
  runtimeApiVersion: '1'
  containerId: string | null
  mounts: ProjectRuntimeMountState
  cacheVolumes: string[]
  ports: ProjectRuntimePort[]
  health: ProjectRuntimeHealth
  keepAliveReasons: RuntimeKeepAliveReason[]
  lastStartedAt: string | null
  lastStoppedAt: string | null
  lastInspectedAt: string | null
  lastActivityAt: string | null
  lastError: string | null
  backendSetup: ProjectRuntimeBackendSetupState
  migration: ProjectRuntimeMigrationState
}

export function defaultProjectRuntimeState(projectRoot: string): ProjectRuntimeState {
  const containerHome = getProjectRuntimeContainerHomeDir(projectRoot)
  return {
    backend: 'podman',
    status: 'stopped',
    image: {
      repository: 'ghcr.io/matthew-dean/guildhall-runtime-debian',
      tag: '0.9.0-trixie-node22-python313-playwright',
      digest: null,
    },
    runtimeApiVersion: '1',
    containerId: null,
    mounts: {
      projectRoot: resolve(projectRoot),
      projectPath: defaultRuntimeProjectPath(projectRoot),
      guildhallHome: containerHome,
      guildhallHomePath: '/home/guildhall/.guildhall',
    },
    cacheVolumes: [],
    ports: [],
    health: {
      status: 'unknown',
      checkedAt: null,
      checks: [],
    },
    keepAliveReasons: [],
    lastStartedAt: null,
    lastStoppedAt: null,
    lastInspectedAt: null,
    lastActivityAt: null,
    lastError: null,
    backendSetup: {
      status: 'unknown-error',
      selectedMode: null,
      lastAction: null,
      lastResult: null,
      updatedAt: null,
    },
    migration: {
      mode: 'host-run',
      fallbackAvailable: true,
      lastResult: null,
      acceptedAt: null,
      rolledBackAt: null,
      runtimeApiVersion: '1',
      image: {
        repository: 'ghcr.io/matthew-dean/guildhall-runtime-debian',
        tag: '0.9.0-trixie-node22-python313-playwright',
        digest: null,
      },
      mountLayout: {
        projectRoot: resolve(projectRoot),
        projectPath: defaultRuntimeProjectPath(projectRoot),
        guildhallHome: containerHome,
        guildhallHomePath: '/home/guildhall/.guildhall',
      },
      health: {
        status: 'unknown',
        checkedAt: null,
        checks: [],
      },
      rollback: null,
    },
  }
}

export function normalizeProjectRuntimeState(
  projectRoot: string,
  state: ProjectRuntimeState,
): ProjectRuntimeState {
  const defaults = defaultProjectRuntimeState(projectRoot)
  return {
    ...state,
    mounts: {
      ...state.mounts,
      projectRoot: resolve(projectRoot),
      guildhallHome: defaults.mounts.guildhallHome,
      guildhallHomePath: defaults.mounts.guildhallHomePath,
    },
    migration: {
      ...state.migration,
      mountLayout: {
        ...state.migration.mountLayout,
        projectRoot: resolve(projectRoot),
        guildhallHome: defaults.mounts.guildhallHome,
        guildhallHomePath: defaults.mounts.guildhallHomePath,
      },
    },
  }
}

export async function readProjectRuntimeState(projectRoot: string): Promise<ProjectRuntimeState> {
  const path = getProjectRuntimeStatePath(projectRoot)
  try {
    return normalizeProjectRuntimeState(
      projectRoot,
      JSON.parse(await readManagedTextFile(path, 'utf8')) as ProjectRuntimeState,
    )
  } catch (error) {
    if (String(error).includes('ENOENT')) return defaultProjectRuntimeState(projectRoot)
    throw error
  }
}

export async function writeProjectRuntimeState(
  projectRoot: string,
  state: ProjectRuntimeState,
): Promise<ProjectRuntimeState> {
  const path = getProjectRuntimeStatePath(projectRoot)
  const next = normalizeProjectRuntimeState(projectRoot, state)
  await mkdir(dirname(path), { recursive: true })
  await writeManagedTextFile(path, `${JSON.stringify(next, null, 2)}\n`)
  return next
}
