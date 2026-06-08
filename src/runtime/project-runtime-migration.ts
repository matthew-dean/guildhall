import {
  defaultProjectRuntimeState,
  readProjectRuntimeState,
  writeProjectRuntimeState,
  type ProjectRuntimeImageState,
  type ProjectRuntimeMigrationState,
} from './project-runtime-store.js'
import {
  buildRuntimeMountLayout,
  type RuntimeHealthReport,
} from './runtime-health.js'

export interface ProjectRuntimeMigrationPlan {
  projectRoot: string
  status: 'needs-health-check' | 'ready-to-accept' | 'runtime-backed'
  fallbackMode: 'host-run'
  fallbackAvailable: true
  runtimeImage: ProjectRuntimeImageState
  runtimeApiVersion: '1'
  mountLayout: ProjectRuntimeMigrationState['mountLayout']
  actions: Array<{
    id: 'run-health-checks' | 'accept-runtime-backed' | 'keep-host-run-compatibility' | 'rollback-to-host-run'
    label: string
    description: string
    requiresAcceptance: boolean
  }>
}

export interface ApplyProjectRuntimeMigrationInput {
  projectId?: string
  accepted: boolean
  healthReport: RuntimeHealthReport
  now?: () => string
}

export interface ApplyProjectRuntimeMigrationResult {
  ok: boolean
  error?: string
  record: ProjectRuntimeMigrationState
}

export interface RollbackProjectRuntimeMigrationResult {
  ok: boolean
  error?: string
  record: ProjectRuntimeMigrationState
}

function now(input?: { now?: () => string }): string {
  return (input?.now ?? (() => new Date().toISOString()))()
}

export async function planProjectRuntimeMigration(
  projectRoot: string,
  options: { projectId?: string; guildhallHome?: string; now?: () => string } = {},
): Promise<ProjectRuntimeMigrationPlan> {
  const state = await readProjectRuntimeState(projectRoot)
  const mountLayout = buildRuntimeMountLayout(projectRoot, options)
  const runtimeBacked = state.migration.mode === 'runtime-backed'
  return {
    projectRoot,
    status: runtimeBacked ? 'runtime-backed' : 'needs-health-check',
    fallbackMode: 'host-run',
    fallbackAvailable: true,
    runtimeImage: state.image,
    runtimeApiVersion: state.runtimeApiVersion,
    mountLayout,
    actions: [
      {
        id: 'run-health-checks',
        label: 'Run runtime health checks',
        description: 'Verify mounts, tools, DNS, and command-log persistence before switching modes.',
        requiresAcceptance: false,
      },
      {
        id: 'accept-runtime-backed',
        label: 'Use runtime-backed mode',
        description: 'Switch this project from host-run compatibility to the container runtime after checks pass.',
        requiresAcceptance: true,
      },
      {
        id: 'keep-host-run-compatibility',
        label: 'Keep host-run compatibility',
        description: 'Leave this project running commands directly on the host for now.',
        requiresAcceptance: false,
      },
      ...(runtimeBacked ? [{
        id: 'rollback-to-host-run' as const,
        label: 'Roll back to host-run',
        description: 'Restore the compatibility mode saved before runtime-backed migration.',
        requiresAcceptance: true,
      }] : []),
    ],
  }
}

function hostRunRecord(
  state: ReturnType<typeof defaultProjectRuntimeState>,
  input: {
    healthReport?: RuntimeHealthReport
    lastResult: ProjectRuntimeMigrationState['lastResult']
    acceptedAt?: string | null
    rolledBackAt?: string | null
  },
): ProjectRuntimeMigrationState {
  return {
    mode: 'host-run',
    fallbackAvailable: true,
    lastResult: input.lastResult,
    acceptedAt: input.acceptedAt ?? null,
    rolledBackAt: input.rolledBackAt ?? null,
    runtimeApiVersion: state.runtimeApiVersion,
    image: state.image,
    mountLayout: input.healthReport?.mountLayout ?? state.mounts,
    health: input.healthReport
      ? {
          status: input.healthReport.status,
          checkedAt: input.healthReport.checkedAt,
          checks: input.healthReport.checks,
        }
      : state.health,
    rollback: null,
  }
}

export async function applyProjectRuntimeMigration(
  projectRoot: string,
  input: ApplyProjectRuntimeMigrationInput,
): Promise<ApplyProjectRuntimeMigrationResult> {
  const state = await readProjectRuntimeState(projectRoot)
  if (!input.accepted) {
    const record = hostRunRecord(state, {
      healthReport: input.healthReport,
      lastResult: 'declined',
    })
    await writeProjectRuntimeState(projectRoot, {
      ...state,
      migration: record,
    })
    return {
      ok: false,
      error: 'Runtime-backed migration requires owner acceptance.',
      record,
    }
  }

  if (input.healthReport.status !== 'healthy') {
    const record = hostRunRecord(state, {
      healthReport: input.healthReport,
      lastResult: 'failed',
    })
    await writeProjectRuntimeState(projectRoot, {
      ...state,
      migration: record,
    })
    return {
      ok: false,
      error: 'Runtime health checks must pass before switching to runtime-backed mode.',
      record,
    }
  }

  const acceptedAt = now(input)
  const selectedContainerMode = state.backend === 'docker' || state.backend === 'podman'
    ? state.backend
    : state.backendSetup.selectedMode === 'docker' || state.backendSetup.selectedMode === 'podman'
      ? state.backendSetup.selectedMode
      : 'docker'
  const record: ProjectRuntimeMigrationState = {
    mode: 'runtime-backed',
    fallbackAvailable: true,
    lastResult: 'completed',
    acceptedAt,
    rolledBackAt: null,
    runtimeApiVersion: state.runtimeApiVersion,
    image: state.image,
    mountLayout: input.healthReport.mountLayout,
    health: {
      status: input.healthReport.status,
      checkedAt: input.healthReport.checkedAt,
      checks: input.healthReport.checks,
    },
    rollback: {
      mode: 'host-run',
      backendSetupSelectedMode: state.backendSetup.selectedMode,
      mounts: state.mounts,
    },
  }

  await writeProjectRuntimeState(projectRoot, {
    ...state,
    mounts: input.healthReport.mountLayout,
    health: record.health,
    backendSetup: {
      ...state.backendSetup,
      selectedMode: selectedContainerMode,
      updatedAt: acceptedAt,
      message: 'Runtime-backed project mode accepted.',
    },
    migration: record,
  })
  return { ok: true, record }
}

export async function rollbackProjectRuntimeMigration(
  projectRoot: string,
  input: { now?: () => string } = {},
): Promise<RollbackProjectRuntimeMigrationResult> {
  const state = await readProjectRuntimeState(projectRoot)
  const rollback = state.migration.rollback
  if (!rollback) {
    return {
      ok: false,
      error: 'No runtime migration rollback state is available.',
      record: state.migration,
    }
  }

  const rolledBackAt = now(input)
  const record: ProjectRuntimeMigrationState = {
    ...state.migration,
    mode: 'host-run',
    lastResult: 'rolled-back',
    rolledBackAt,
  }
  await writeProjectRuntimeState(projectRoot, {
    ...state,
    mounts: rollback.mounts,
    backendSetup: {
      ...state.backendSetup,
      selectedMode: rollback.backendSetupSelectedMode ?? 'host-run',
      updatedAt: rolledBackAt,
      message: 'Runtime-backed project mode rolled back to host-run compatibility.',
    },
    migration: record,
  })
  return { ok: true, record }
}
