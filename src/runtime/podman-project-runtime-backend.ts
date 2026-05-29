import { createHash } from 'node:crypto'
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { promisify } from 'node:util'
import { getProjectStateDir } from '@guildhall/sessions'

import { capabilityGrantMounts } from './capability-grants.js'
import type {
  RuntimeBackendCommandEvent,
  RuntimeBackendCommandRequest,
} from './project-runtime-supervisor.js'
import type {
  ProjectRuntimeHealth,
  ProjectRuntimeState,
} from './project-runtime-store.js'

const execFileP = promisify(execFile)

export interface PodmanProjectRuntimeBackendOptions {
  execFile?: (file: string, args: string[]) => Promise<{ stdout: string; stderr: string }>
  spawn?: (file: string, args: string[]) => ChildProcessWithoutNullStreams
}

export class PodmanProjectRuntimeBackend {
  readonly #execFile: (file: string, args: string[]) => Promise<{ stdout: string; stderr: string }>
  readonly #spawn: (file: string, args: string[]) => ChildProcessWithoutNullStreams

  constructor(options: PodmanProjectRuntimeBackendOptions = {}) {
    this.#execFile = options.execFile ?? execFileP
    this.#spawn = options.spawn ?? spawn
  }

  async create(projectRoot: string, state: ProjectRuntimeState): Promise<{ containerId?: string | null }> {
    const existing = await this.#existingContainerId(state)
    if (existing) return { containerId: existing }

    const { stdout } = await this.#execFile('podman', [
      'create',
      '--name',
      containerName(projectRoot),
      '--replace',
      '--user',
      'guildhall',
      '--workdir',
      state.mounts.projectPath,
      ...state.ports.flatMap(port => ['--publish', `${port.host}:${port.container}`]),
      '--volume',
      `${state.mounts.projectRoot}:${state.mounts.projectPath}:rw,z`,
      '--volume',
      `${state.mounts.guildhallHome}:${state.mounts.guildhallHomePath}:rw,z`,
      ...capabilityGrantMounts(getProjectStateDir(projectRoot)).flatMap(mount => [
        '--volume',
        `${mount.hostPath}:${mount.containerPath}:${mount.access === 'read-only' ? 'ro' : 'rw'},z`,
      ]),
      `${state.image.repository}:${state.image.tag}`,
    ])
    return { containerId: stdout.trim() || null }
  }

  async start(projectRoot: string, state: ProjectRuntimeState): Promise<{ containerId?: string | null }> {
    const containerId = state.containerId ?? (await this.create(projectRoot, state)).containerId
    if (!containerId) throw new Error('Unable to create project runtime container.')
    await this.#execFile('podman', ['start', containerId])
    return { containerId }
  }

  async stop(_projectRoot: string, state: ProjectRuntimeState): Promise<void> {
    if (!state.containerId) return
    await this.#execFile('podman', ['stop', state.containerId])
  }

  async inspect(_projectRoot: string, state: ProjectRuntimeState): Promise<{
    status?: ProjectRuntimeState['status']
    containerId?: string | null
    health?: ProjectRuntimeHealth
  }> {
    if (!state.containerId) return { status: 'stopped', containerId: null }
    const { stdout } = await this.#execFile('podman', ['inspect', '--format', 'json', state.containerId])
    const parsed = JSON.parse(stdout) as Array<Record<string, unknown>>
    const first = parsed[0] ?? {}
    const runtimeState = first.State as Record<string, unknown> | undefined
    const running = runtimeState?.Running === true
    return {
      status: running ? 'running' : 'stopped',
      containerId: state.containerId,
      health: {
        status: running ? 'healthy' : 'unknown',
        checkedAt: new Date().toISOString(),
        checks: [{ name: 'podman-container', ok: running }],
      },
    }
  }

  async logs(_projectRoot: string, state: ProjectRuntimeState): Promise<string> {
    if (!state.containerId) return ''
    const { stdout, stderr } = await this.#execFile('podman', ['logs', state.containerId])
    return `${stdout}${stderr}`
  }

  async rebuild(projectRoot: string, state: ProjectRuntimeState): Promise<{ containerId?: string | null }> {
    await this.remove(projectRoot, state)
    return this.create(projectRoot, { ...state, containerId: null })
  }

  async remove(projectRoot: string, state: ProjectRuntimeState): Promise<void> {
    const id = state.containerId ?? await this.#existingContainerId(state) ?? containerName(projectRoot)
    await this.#execFile('podman', ['rm', '--force', id]).catch(() => ({ stdout: '', stderr: '' }))
  }

  async runCommand(
    _projectRoot: string,
    state: ProjectRuntimeState,
    request: RuntimeBackendCommandRequest,
    emit: (event: RuntimeBackendCommandEvent) => void,
    signal: AbortSignal,
  ): Promise<{ exitCode: number }> {
    if (!state.containerId) throw new Error('Project runtime is not running.')
    return spawnPodmanExec(this.#spawn, state, request, emit, signal)
  }

  async #existingContainerId(state: ProjectRuntimeState): Promise<string | null> {
    if (!state.containerId) return null
    try {
      const { stdout } = await this.#execFile('podman', ['container', 'exists', state.containerId])
      return stdout.trim() || state.containerId
    } catch {
      return null
    }
  }
}

function spawnPodmanExec(
  spawnRunner: (file: string, args: string[]) => ChildProcessWithoutNullStreams,
  state: ProjectRuntimeState,
  request: RuntimeBackendCommandRequest,
  emit: (event: RuntimeBackendCommandEvent) => void,
  signal: AbortSignal,
): Promise<{ exitCode: number }> {
  const args = [
    'exec',
    '--user',
    request.runtimeUser,
    '--workdir',
    request.cwd,
    ...Object.entries(request.env).flatMap(([key, value]) => ['--env', `${key}=${value}`]),
    state.containerId!,
    'guildhall-exec',
    ...request.argv,
  ]
  const child = spawnRunner('podman', args)
  return waitForCommand(child, emit, signal)
}

function waitForCommand(
  child: ChildProcessWithoutNullStreams,
  emit: (event: RuntimeBackendCommandEvent) => void,
  signal: AbortSignal,
): Promise<{ exitCode: number }> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      child.kill('SIGTERM')
      reject(new Error('cancelled'))
    }
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })

    child.stdout.on('data', chunk => emit({ type: 'stdout', data: String(chunk) }))
    child.stderr.on('data', chunk => emit({ type: 'stderr', data: String(chunk) }))
    child.on('error', reject)
    child.on('close', code => {
      signal.removeEventListener('abort', abort)
      resolve({ exitCode: code ?? 1 })
    })
  })
}

function containerName(projectRoot: string): string {
  const hash = createHash('sha256').update(projectRoot).digest('hex').slice(0, 12)
  return `guildhall-project-${hash}`
}
