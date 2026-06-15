import { execFile } from 'node:child_process'
import { platform as hostPlatform } from 'node:os'
import { promisify } from 'node:util'

import { readGlobalConfig, readWorkspaceConfig } from '@guildhall/config'
import { readProjectRuntimeState, writeProjectRuntimeState } from './project-runtime-store.js'

const execFileP = promisify(execFile)

export type RuntimeBackendSetupStatus =
  | 'ready'
  | 'missing'
  | 'machine-not-created'
  | 'machine-stopped'
  | 'installed-unhealthy'
  | 'unsupported-platform'
  | 'unknown-error'

export type RuntimeBackendSetupActionId =
  | 'install-instructions'
  | 'initialize-machine'
  | 'start-machine'
  | 'retry-detection'
  | 'use-host-run-compatibility'

export interface RuntimeBackendCommandResult {
  stdout: string
  stderr: string
}

export type RuntimeBackendCommandRunner = (
  command: string,
  args: string[],
) => Promise<RuntimeBackendCommandResult>

export type RuntimeBackendSetupDetector = (
  options?: RuntimeBackendSetupOptions,
) => Promise<RuntimeBackendSetupReadout>

export interface RuntimeBackendSetupOptions {
  platform?: NodeJS.Platform | string
  projectRoot?: string
  now?: () => string
  commandRunner?: RuntimeBackendCommandRunner
}

export interface RuntimeBackendSetupAction {
  id: RuntimeBackendSetupActionId
  label: string
  description: string
  mutatesHost: boolean
  requiresApproval: boolean
  command?: string[]
  homebrewAvailable?: boolean
  officialInstallerUrl?: string
}

export interface RuntimeBackendSetupReadout {
  backend: 'docker' | 'podman' | 'none'
  platform: string
  supportedHost: boolean
  status: RuntimeBackendSetupStatus
  dockerPath: string | null
  dockerVersion: string | null
  podmanPath: string | null
  podmanVersion: string | null
  homebrewPath: string | null
  runtimes: {
    docker: {
      status: 'ready' | 'missing' | 'installed-unhealthy'
      path: string | null
      version: string | null
      error?: string
    }
    podman: {
      status: RuntimeBackendSetupStatus
      path: string | null
      version: string | null
      machine: {
        exists: boolean
        name: string | null
        running: boolean
      }
      error?: string
    }
  }
  nonContainerExecution: {
    allowed: boolean
    source: 'project' | 'global' | 'default'
  }
  machine: {
    exists: boolean
    name: string | null
    running: boolean
  }
  message: string
  compatibilityModeAvailable: true
  compatibilityModeLabel: 'Host-run compatibility mode'
  installGuidance: {
    homebrew: string
    officialInstallerUrl: string
  }
  actions: RuntimeBackendSetupAction[]
  lastCheckedAt: string
  error?: string
}

export interface RuntimeBackendSetupActionInput extends RuntimeBackendSetupOptions {
  action: RuntimeBackendSetupActionId
  approved?: boolean
}

export interface RuntimeBackendSetupActionResult {
  ok: boolean
  error?: string
  result: {
    action: RuntimeBackendSetupActionId
    mutatedHost: boolean
    steps: Array<{
      command: string[]
      ok: boolean
      stdout: string
      stderr: string
      error?: string
    }>
  }
  status: RuntimeBackendSetupReadout
}

const installGuidance = {
  homebrew: 'brew install --cask docker or brew install podman',
  officialInstallerUrl: 'https://docs.docker.com/desktop/setup/install/mac-install/',
}

const mutatingActions = new Set<RuntimeBackendSetupActionId>([
  'initialize-machine',
  'start-machine',
])

function defaultRunner(command: string, args: string[]): Promise<RuntimeBackendCommandResult> {
  return execFileP(command, args).then(({ stdout, stderr }) => ({
    stdout: String(stdout),
    stderr: String(stderr),
  }))
}

function timestamp(options: RuntimeBackendSetupOptions): string {
  return (options.now ?? (() => new Date().toISOString()))()
}

async function findCommand(
  name: string,
  runner: RuntimeBackendCommandRunner,
): Promise<string | null> {
  try {
    const result = await runner('which', [name])
    return result.stdout.trim() || null
  } catch {
    return null
  }
}

async function runOptional(
  command: string,
  args: string[],
  runner: RuntimeBackendCommandRunner,
): Promise<RuntimeBackendCommandResult | null> {
  try {
    return await runner(command, args)
  } catch {
    return null
  }
}

function action(id: RuntimeBackendSetupActionId, homebrewPath: string | null): RuntimeBackendSetupAction {
  switch (id) {
    case 'install-instructions':
      return {
        id,
        label: 'Install Docker or Podman',
        description: homebrewPath
          ? 'Install Docker Desktop or Podman, then check local runtime setup again.'
          : 'Install Docker Desktop or Podman, then check local runtime setup again.',
        mutatesHost: false,
        requiresApproval: false,
        homebrewAvailable: Boolean(homebrewPath),
        officialInstallerUrl: installGuidance.officialInstallerUrl,
      }
    case 'initialize-machine':
      return {
        id,
        label: 'Set up local runtime',
        description: 'Create and start the Podman machine Guildhall uses for runtime-backed project work.',
        mutatesHost: true,
        requiresApproval: true,
        command: ['podman', 'machine', 'init', '--now'],
      }
    case 'start-machine':
      return {
        id,
        label: 'Start local runtime',
        description: 'Start the stopped Podman machine before runtime-backed work begins.',
        mutatesHost: true,
        requiresApproval: true,
        command: ['podman', 'machine', 'start'],
      }
    case 'retry-detection':
      return {
        id,
        label: 'Check again',
        description: 'Check local runtime setup again.',
        mutatesHost: false,
        requiresApproval: false,
      }
    case 'use-host-run-compatibility':
      return {
        id,
        label: 'Use host-run compatibility',
        description: 'Keep running commands directly on this Mac until the container runtime is ready.',
        mutatesHost: false,
        requiresApproval: false,
      }
  }
}

function containerRuntimePolicy(projectRoot: string | undefined): {
  preferredBackend: 'auto' | 'docker' | 'podman'
  nonContainerExecution: RuntimeBackendSetupReadout['nonContainerExecution']
} {
  let globalAllowed = false
  let preferredBackend: 'auto' | 'docker' | 'podman' = 'auto'
  try {
    const globalPolicy = readGlobalConfig().containerRuntime
    globalAllowed = globalPolicy?.mode === 'host-run-allowed'
    preferredBackend = globalPolicy?.preferredBackend ?? 'auto'
  } catch {
    globalAllowed = false
  }
  if (projectRoot) {
    try {
      const projectPolicy = readWorkspaceConfig(projectRoot).containerRuntime
      preferredBackend = projectPolicy?.preferredBackend ?? preferredBackend
      if (projectPolicy?.mode === 'host-run-allowed') {
        return {
          preferredBackend,
          nonContainerExecution: { allowed: true, source: 'project' },
        }
      }
      if (projectPolicy?.mode === 'required') {
        return {
          preferredBackend,
          nonContainerExecution: { allowed: false, source: 'project' },
        }
      }
    } catch {
      // Uninitialized projects inherit the global/default policy.
    }
  }
  if (globalAllowed) {
    return {
      preferredBackend,
      nonContainerExecution: { allowed: true, source: 'global' },
    }
  }
  return {
    preferredBackend,
    nonContainerExecution: { allowed: false, source: 'default' },
  }
}

function readMachine(stdout: string): RuntimeBackendSetupReadout['machine'] {
  try {
    const machines = JSON.parse(stdout) as Array<Record<string, unknown>>
    const machine = machines.find(item => item.Default === true) ?? machines[0]
    if (!machine) return { exists: false, name: null, running: false }
    return {
      exists: true,
      name: typeof machine.Name === 'string' ? machine.Name : null,
      running: machine.Running === true,
    }
  } catch {
    return { exists: false, name: null, running: false }
  }
}

function readout(input: {
  backend?: RuntimeBackendSetupReadout['backend']
  platform: string
  supportedHost: boolean
  status: RuntimeBackendSetupStatus
  dockerPath?: string | null
  dockerVersion?: string | null
  dockerStatus?: RuntimeBackendSetupReadout['runtimes']['docker']['status']
  dockerError?: string
  podmanPath?: string | null
  podmanVersion?: string | null
  podmanStatus?: RuntimeBackendSetupStatus
  podmanError?: string
  homebrewPath?: string | null
  machine?: RuntimeBackendSetupReadout['machine']
  nonContainerExecution?: RuntimeBackendSetupReadout['nonContainerExecution']
  actions: RuntimeBackendSetupActionId[]
  message: string
  lastCheckedAt: string
  error?: string
}): RuntimeBackendSetupReadout {
  const homebrewPath = input.homebrewPath ?? null
  const machine = input.machine ?? { exists: false, name: null, running: false }
  return {
    backend: input.backend ?? 'none',
    platform: input.platform,
    supportedHost: input.supportedHost,
    status: input.status,
    dockerPath: input.dockerPath ?? null,
    dockerVersion: input.dockerVersion ?? null,
    podmanPath: input.podmanPath ?? null,
    podmanVersion: input.podmanVersion ?? null,
    homebrewPath,
    runtimes: {
      docker: {
        status: input.dockerStatus ?? (input.dockerPath ? 'installed-unhealthy' : 'missing'),
        path: input.dockerPath ?? null,
        version: input.dockerVersion ?? null,
        ...(input.dockerError ? { error: input.dockerError } : {}),
      },
      podman: {
        status: input.podmanStatus ?? (input.podmanPath ? input.status : 'missing'),
        path: input.podmanPath ?? null,
        version: input.podmanVersion ?? null,
        machine,
        ...(input.podmanError ? { error: input.podmanError } : {}),
      },
    },
    nonContainerExecution: input.nonContainerExecution ?? { allowed: false, source: 'default' },
    machine,
    message: input.message,
    compatibilityModeAvailable: true,
    compatibilityModeLabel: 'Host-run compatibility mode',
    installGuidance,
    actions: input.actions.map(id => action(id, homebrewPath)),
    lastCheckedAt: input.lastCheckedAt,
    ...(input.error ? { error: input.error } : {}),
  }
}

export async function detectRuntimeBackendSetup(
  options: RuntimeBackendSetupOptions = {},
): Promise<RuntimeBackendSetupReadout> {
  const platform = options.platform ?? hostPlatform()
  const runner = options.commandRunner ?? defaultRunner
  const lastCheckedAt = timestamp(options)
  const policy = containerRuntimePolicy(options.projectRoot)
  const nonContainerExecution = policy.nonContainerExecution

  if (platform !== 'darwin') {
    return readout({
      backend: 'none',
      platform,
      supportedHost: false,
      status: 'unsupported-platform',
      nonContainerExecution,
      actions: nonContainerExecution.allowed ? ['retry-detection', 'use-host-run-compatibility'] : ['retry-detection'],
      message: nonContainerExecution.allowed
        ? 'No container runtime is active on this host. Host-run is allowed by config.'
        : 'No container runtime is active on this host. Configure Docker or Podman, or explicitly allow host-run in config.',
      lastCheckedAt,
    })
  }

  const [dockerPath, podmanPath, homebrewPath] = await Promise.all([
    findCommand('docker', runner),
    findCommand('podman', runner),
    findCommand('brew', runner),
  ])

  let dockerVersion: string | null = null
  let dockerStatus: RuntimeBackendSetupReadout['runtimes']['docker']['status'] = dockerPath ? 'installed-unhealthy' : 'missing'
  let dockerError: string | undefined
  if (dockerPath) {
    try {
      dockerVersion = (await runner('docker', ['version', '--format', '{{.Server.Version}}'])).stdout.trim() || null
      await runner('docker', ['info', '--format', '{{json .ServerVersion}}'])
      dockerStatus = 'ready'
    } catch (error) {
      dockerError = error instanceof Error ? error.message : String(error)
    }
  }

  if (!podmanPath) {
    if (dockerStatus === 'ready') {
      return readout({
        backend: 'docker',
        platform,
        supportedHost: true,
        status: 'ready',
        dockerPath,
        dockerVersion,
        dockerStatus,
        podmanPath,
        homebrewPath,
        nonContainerExecution,
        actions: [],
        message: 'Docker is ready. Guildhall will start project containers only when work needs them.',
        lastCheckedAt,
      })
    }
    return readout({
      backend: 'none',
      platform,
      supportedHost: true,
      status: 'missing',
      dockerPath,
      dockerVersion,
      dockerStatus,
      dockerError,
      homebrewPath,
      nonContainerExecution,
      actions: ['install-instructions', 'retry-detection', ...(nonContainerExecution.allowed ? ['use-host-run-compatibility' as const] : [])],
      message: nonContainerExecution.allowed
        ? 'No container runtime is ready. Host-run is allowed by config.'
        : 'No container runtime is ready. Install Docker Desktop or Podman, or explicitly allow host-run in config.',
      lastCheckedAt,
    })
  }

  const version = await runOptional('podman', ['--version'], runner)
  const machineList = await runOptional('podman', ['machine', 'list', '--format', 'json'], runner)
  const podmanMachine = machineList ? readMachine(machineList.stdout) : null
  const podmanStatus: RuntimeBackendSetupStatus = machineList
    ? podmanMachine?.running ? 'ready' : podmanMachine?.exists ? 'machine-stopped' : 'machine-not-created'
    : podmanPath ? 'unknown-error' : 'missing'
  if (dockerStatus === 'ready' && (policy.preferredBackend !== 'podman' || podmanStatus !== 'ready')) {
    return readout({
      backend: 'docker',
      platform,
      supportedHost: true,
      status: 'ready',
      dockerPath,
      dockerVersion,
      dockerStatus,
      podmanPath,
      podmanVersion: version?.stdout.trim() || null,
      homebrewPath,
      podmanStatus,
      machine: podmanMachine ?? undefined,
      nonContainerExecution,
      actions: [],
      message: 'Docker is ready. Guildhall will start project containers only when work needs them.',
      lastCheckedAt,
    })
  }
  if (!machineList) {
    return readout({
      backend: 'none',
      platform,
      supportedHost: true,
      status: dockerPath ? 'installed-unhealthy' : 'unknown-error',
      dockerPath,
      dockerVersion,
      dockerStatus,
      dockerError,
      podmanPath,
      podmanVersion: version?.stdout.trim() || null,
      podmanStatus: 'unknown-error',
      homebrewPath,
      nonContainerExecution,
      actions: ['retry-detection', ...(nonContainerExecution.allowed ? ['use-host-run-compatibility' as const] : [])],
      message: nonContainerExecution.allowed
        ? 'No container runtime is ready. Host-run is allowed by config.'
        : 'Guildhall could not read a usable container runtime state. Fix Docker or Podman before project work runs.',
      lastCheckedAt,
    })
  }

  const machine = podmanMachine ?? readMachine(machineList.stdout)
  if (!machine.exists) {
    return readout({
      backend: 'none',
      platform,
      supportedHost: true,
      status: 'machine-not-created',
      dockerPath,
      dockerVersion,
      dockerStatus,
      dockerError,
      podmanPath,
      podmanVersion: version?.stdout.trim() || null,
      homebrewPath,
      machine,
      podmanStatus: 'machine-not-created',
      nonContainerExecution,
      actions: ['initialize-machine', 'retry-detection', ...(nonContainerExecution.allowed ? ['use-host-run-compatibility' as const] : [])],
      message: 'Podman is installed, but Guildhall still needs to create the local runtime machine before project work runs there.',
      lastCheckedAt,
    })
  }

  if (!machine.running) {
    return readout({
      backend: 'none',
      platform,
      supportedHost: true,
      status: 'machine-stopped',
      dockerPath,
      dockerVersion,
      dockerStatus,
      dockerError,
      podmanPath,
      podmanVersion: version?.stdout.trim() || null,
      homebrewPath,
      machine,
      podmanStatus: 'machine-stopped',
      nonContainerExecution,
      actions: ['start-machine', 'retry-detection', ...(nonContainerExecution.allowed ? ['use-host-run-compatibility' as const] : [])],
      message: 'Podman is installed, but the local runtime service is stopped. Start it before project work runs there.',
      lastCheckedAt,
    })
  }

  return readout({
    backend: 'podman',
    platform,
    supportedHost: true,
    status: 'ready',
    dockerPath,
    dockerVersion,
    dockerStatus,
    dockerError,
    podmanPath,
    podmanVersion: version?.stdout.trim() || null,
    homebrewPath,
    machine,
    podmanStatus: 'ready',
    nonContainerExecution,
    actions: [],
    message: 'Podman is ready. Guildhall will start project containers only when work needs them.',
    lastCheckedAt,
  })
}

async function recordSetupState(
  projectRoot: string,
  input: {
    status: RuntimeBackendSetupStatus
    selectedMode: 'docker' | 'podman' | 'host-run' | null
    lastAction: RuntimeBackendSetupActionId
    lastResult: 'completed' | 'declined' | 'failed'
    updatedAt: string
    message?: string
  },
): Promise<void> {
  const state = await readProjectRuntimeState(projectRoot)
  await writeProjectRuntimeState(projectRoot, {
    ...state,
    backend: input.selectedMode === 'docker' || input.selectedMode === 'podman'
      ? input.selectedMode
      : input.selectedMode === 'host-run'
        ? 'none'
        : state.backend,
    backendSetup: input,
  })
}

export async function runRuntimeBackendSetupAction(
  projectRoot: string,
  input: RuntimeBackendSetupActionInput,
): Promise<RuntimeBackendSetupActionResult> {
  const runner = input.commandRunner ?? defaultRunner
  const detectOptions: RuntimeBackendSetupOptions = { ...input, projectRoot: input.projectRoot ?? projectRoot }
  const updatedAt = timestamp(input)
  const baseResult: RuntimeBackendSetupActionResult['result'] = {
    action: input.action,
    mutatedHost: false,
    steps: [],
  }

  if (mutatingActions.has(input.action) && input.approved !== true) {
    const status = await detectRuntimeBackendSetup(detectOptions)
    await recordSetupState(projectRoot, {
      status: status.status,
      selectedMode: null,
      lastAction: input.action,
      lastResult: 'declined',
      updatedAt,
      message: 'Runtime setup action was declined before changing the host.',
    })
    return {
      ok: false,
      error: 'Runtime setup requires explicit owner approval before changing the host.',
      result: baseResult,
      status,
    }
  }

  if (input.action === 'use-host-run-compatibility') {
    const status = await detectRuntimeBackendSetup(detectOptions)
    if (!status.nonContainerExecution.allowed) {
      await recordSetupState(projectRoot, {
        status: status.status,
        selectedMode: null,
        lastAction: input.action,
        lastResult: 'declined',
        updatedAt,
        message: 'Host-run compatibility is unavailable until global or project config explicitly allows it.',
      })
      return {
        ok: false,
        error: 'Host-run compatibility is not available unless global or project config explicitly allows it.',
        result: baseResult,
        status,
      }
    }
    await recordSetupState(projectRoot, {
      status: status.status,
      selectedMode: 'host-run',
      lastAction: input.action,
      lastResult: 'completed',
      updatedAt,
      message: 'Host-run compatibility mode selected.',
    })
    return { ok: true, result: baseResult, status }
  }

  if (input.action === 'install-instructions' || input.action === 'retry-detection') {
    const status = await detectRuntimeBackendSetup(detectOptions)
    await recordSetupState(projectRoot, {
      status: status.status,
      selectedMode: status.status === 'ready' && status.backend !== 'none' ? status.backend : null,
      lastAction: input.action,
      lastResult: 'completed',
      updatedAt,
      message: status.message,
    })
    return { ok: true, result: baseResult, status }
  }

  const command: [string, ...string[]] = input.action === 'initialize-machine'
    ? ['podman', 'machine', 'init', '--now']
    : ['podman', 'machine', 'start']

  try {
    const { stdout, stderr } = await runner(command[0], command.slice(1))
    baseResult.mutatedHost = true
    baseResult.steps.push({ command, ok: true, stdout, stderr })
    const status = await detectRuntimeBackendSetup(detectOptions)
    await recordSetupState(projectRoot, {
      status: status.status,
      selectedMode: status.status === 'ready' && status.backend !== 'none' ? status.backend : null,
      lastAction: input.action,
      lastResult: 'completed',
      updatedAt,
      message: status.message,
    })
    return { ok: true, result: baseResult, status }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    baseResult.steps.push({ command, ok: false, stdout: '', stderr: '', error: message })
    const status = await detectRuntimeBackendSetup(detectOptions)
    await recordSetupState(projectRoot, {
      status: status.status,
      selectedMode: null,
      lastAction: input.action,
      lastResult: 'failed',
      updatedAt,
      message,
    })
    return { ok: false, error: message, result: baseResult, status }
  }
}
