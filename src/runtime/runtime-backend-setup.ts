import { execFile } from 'node:child_process'
import { platform as hostPlatform } from 'node:os'
import { promisify } from 'node:util'

import { readProjectRuntimeState, writeProjectRuntimeState } from './project-runtime-store.js'

const execFileP = promisify(execFile)

export type RuntimeBackendSetupStatus =
  | 'ready'
  | 'missing'
  | 'machine-not-created'
  | 'machine-stopped'
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
  backend: 'podman'
  platform: string
  supportedHost: boolean
  status: RuntimeBackendSetupStatus
  podmanPath: string | null
  podmanVersion: string | null
  homebrewPath: string | null
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
  homebrew: 'brew install podman',
  officialInstallerUrl: 'https://podman.io/docs/installation#macos',
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
        label: 'Install Podman',
        description: homebrewPath
          ? 'Use Homebrew or the official Podman macOS installer, then check local runtime setup again.'
          : 'Use the official Podman macOS installer, then check local runtime setup again.',
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
  platform: string
  supportedHost: boolean
  status: RuntimeBackendSetupStatus
  podmanPath?: string | null
  podmanVersion?: string | null
  homebrewPath?: string | null
  machine?: RuntimeBackendSetupReadout['machine']
  actions: RuntimeBackendSetupActionId[]
  message: string
  lastCheckedAt: string
  error?: string
}): RuntimeBackendSetupReadout {
  const homebrewPath = input.homebrewPath ?? null
  return {
    backend: 'podman',
    platform: input.platform,
    supportedHost: input.supportedHost,
    status: input.status,
    podmanPath: input.podmanPath ?? null,
    podmanVersion: input.podmanVersion ?? null,
    homebrewPath,
    machine: input.machine ?? { exists: false, name: null, running: false },
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

  if (platform !== 'darwin') {
    return readout({
      platform,
      supportedHost: false,
      status: 'unsupported-platform',
      actions: ['retry-detection', 'use-host-run-compatibility'],
      message: 'Podman-backed local runtime setup is available on macOS. Guildhall can run on the host on this machine.',
      lastCheckedAt,
    })
  }

  const [podmanPath, homebrewPath] = await Promise.all([
    findCommand('podman', runner),
    findCommand('brew', runner),
  ])

  if (!podmanPath) {
    return readout({
      platform,
      supportedHost: true,
      status: 'missing',
      homebrewPath,
      actions: ['install-instructions', 'retry-detection', 'use-host-run-compatibility'],
      message: 'Podman is not installed yet. Install Podman to use the local runtime, or run on the host until Podman is ready.',
      lastCheckedAt,
    })
  }

  const version = await runOptional('podman', ['--version'], runner)
  const machineList = await runOptional('podman', ['machine', 'list', '--format', 'json'], runner)
  if (!machineList) {
    return readout({
      platform,
      supportedHost: true,
      status: 'unknown-error',
      podmanPath,
      podmanVersion: version?.stdout.trim() || null,
      homebrewPath,
      actions: ['retry-detection', 'use-host-run-compatibility'],
      message: 'Guildhall could not read the Podman machine state. Run on the host only until Podman can be checked again.',
      lastCheckedAt,
    })
  }

  const machine = readMachine(machineList.stdout)
  if (!machine.exists) {
    return readout({
      platform,
      supportedHost: true,
      status: 'machine-not-created',
      podmanPath,
      podmanVersion: version?.stdout.trim() || null,
      homebrewPath,
      machine,
      actions: ['initialize-machine', 'retry-detection', 'use-host-run-compatibility'],
      message: 'Podman is installed, but Guildhall still needs to create the local runtime machine before project work runs there.',
      lastCheckedAt,
    })
  }

  if (!machine.running) {
    return readout({
      platform,
      supportedHost: true,
      status: 'machine-stopped',
      podmanPath,
      podmanVersion: version?.stdout.trim() || null,
      homebrewPath,
      machine,
      actions: ['start-machine', 'retry-detection', 'use-host-run-compatibility'],
      message: 'Podman is installed, but the local runtime service is stopped. Start it before project work runs there.',
      lastCheckedAt,
    })
  }

  return readout({
    platform,
    supportedHost: true,
    status: 'ready',
    podmanPath,
    podmanVersion: version?.stdout.trim() || null,
    homebrewPath,
    machine,
    actions: [],
    message: 'The local runtime is ready. Guildhall will start project containers only when work needs them.',
    lastCheckedAt,
  })
}

async function recordSetupState(
  projectRoot: string,
  input: {
    status: RuntimeBackendSetupStatus
    selectedMode: 'podman' | 'host-run' | null
    lastAction: RuntimeBackendSetupActionId
    lastResult: 'completed' | 'declined' | 'failed'
    updatedAt: string
    message?: string
  },
): Promise<void> {
  const state = await readProjectRuntimeState(projectRoot)
  await writeProjectRuntimeState(projectRoot, {
    ...state,
    backendSetup: input,
  })
}

export async function runRuntimeBackendSetupAction(
  projectRoot: string,
  input: RuntimeBackendSetupActionInput,
): Promise<RuntimeBackendSetupActionResult> {
  const runner = input.commandRunner ?? defaultRunner
  const updatedAt = timestamp(input)
  const baseResult: RuntimeBackendSetupActionResult['result'] = {
    action: input.action,
    mutatedHost: false,
    steps: [],
  }

  if (mutatingActions.has(input.action) && input.approved !== true) {
    const status = await detectRuntimeBackendSetup(input)
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
    const status = await detectRuntimeBackendSetup(input)
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
    const status = await detectRuntimeBackendSetup(input)
    await recordSetupState(projectRoot, {
      status: status.status,
      selectedMode: status.status === 'ready' ? 'podman' : null,
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
    const status = await detectRuntimeBackendSetup(input)
    await recordSetupState(projectRoot, {
      status: status.status,
      selectedMode: status.status === 'ready' ? 'podman' : null,
      lastAction: input.action,
      lastResult: 'completed',
      updatedAt,
      message: status.message,
    })
    return { ok: true, result: baseResult, status }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    baseResult.steps.push({ command, ok: false, stdout: '', stderr: '', error: message })
    const status = await detectRuntimeBackendSetup(input)
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
