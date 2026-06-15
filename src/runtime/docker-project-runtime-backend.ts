import { createHash } from 'node:crypto'
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { promisify } from 'node:util'
import { getProjectStateDir } from '@guildhall/sessions'

import { capabilityGrantMounts } from './capability-grants.js'
import type {
  RuntimeBackendCommandEvent,
  RuntimeBackendCommandRequest,
} from './project-runtime-backend.js'
import type {
  ProjectRuntimeHealth,
  ProjectRuntimeState,
} from './project-runtime-store.js'
import { normalizeProjectRuntimeState } from './project-runtime-store.js'

const execFileP = promisify(execFile)

export interface DockerProjectRuntimeBackendOptions {
  execFile?: (file: string, args: string[]) => Promise<{ stdout: string; stderr: string }>
  spawn?: (file: string, args: string[]) => ChildProcessWithoutNullStreams
}

export class DockerProjectRuntimeBackend {
  readonly #execFile: (file: string, args: string[]) => Promise<{ stdout: string; stderr: string }>
  readonly #spawn: (file: string, args: string[]) => ChildProcessWithoutNullStreams

  constructor(options: DockerProjectRuntimeBackendOptions = {}) {
    this.#execFile = options.execFile ?? execFileP
    this.#spawn = options.spawn ?? spawn
  }

  async create(projectRoot: string, state: ProjectRuntimeState): Promise<{ containerId?: string | null }> {
    const runtimeState = normalizeProjectRuntimeState(projectRoot, state)
    const existing = await this.#existingContainerId(runtimeState)
    if (existing) return { containerId: existing }
    await mkdir(runtimeState.mounts.guildhallHome, { recursive: true })

    const { stdout } = await this.#execFile('docker', [
      'create',
      '--name',
      containerName(projectRoot),
      '--user',
      'guildhall',
      '--workdir',
      runtimeState.mounts.projectPath,
      ...runtimeState.ports.flatMap(port => ['--publish', `${port.host}:${port.container}`]),
      '--volume',
      `${runtimeState.mounts.projectRoot}:${runtimeState.mounts.projectPath}:rw`,
      '--tmpfs',
      `${runtimeState.mounts.projectPath}/.guildhall:rw,noexec,nosuid,nodev`,
      '--volume',
      `${runtimeState.mounts.guildhallHome}:${runtimeState.mounts.guildhallHomePath}:rw`,
      ...capabilityGrantMounts(getProjectStateDir(projectRoot)).flatMap(mount => [
        '--volume',
        `${mount.hostPath}:${mount.containerPath}:${mount.access === 'read-only' ? 'ro' : 'rw'}`,
      ]),
      `${runtimeState.image.repository}:${runtimeState.image.tag}`,
    ])
    return { containerId: stdout.trim() || null }
  }

  async start(projectRoot: string, state: ProjectRuntimeState): Promise<{ containerId?: string | null }> {
    const containerId = state.containerId ?? (await this.create(projectRoot, state)).containerId
    if (!containerId) throw new Error('Unable to create project runtime container.')
    await this.#execFile('docker', ['start', containerId])
    return { containerId }
  }

  async stop(_projectRoot: string, state: ProjectRuntimeState): Promise<void> {
    if (!state.containerId) return
    await this.#execFile('docker', ['stop', state.containerId])
  }

  async inspect(_projectRoot: string, state: ProjectRuntimeState): Promise<{
    status?: ProjectRuntimeState['status']
    containerId?: string | null
    health?: ProjectRuntimeHealth
  }> {
    if (!state.containerId) return { status: 'stopped', containerId: null }
    const { stdout } = await this.#execFile('docker', ['inspect', '--format', 'json', state.containerId])
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
        checks: [{ name: 'docker-container', ok: running }],
      },
    }
  }

  async logs(_projectRoot: string, state: ProjectRuntimeState): Promise<string> {
    if (!state.containerId) return ''
    const { stdout, stderr } = await this.#execFile('docker', ['logs', state.containerId])
    return `${stdout}${stderr}`
  }

  async rebuild(projectRoot: string, state: ProjectRuntimeState): Promise<{ containerId?: string | null }> {
    await this.remove(projectRoot, state)
    return this.create(projectRoot, { ...state, containerId: null })
  }

  async remove(projectRoot: string, state: ProjectRuntimeState): Promise<void> {
    const id = state.containerId ?? await this.#existingContainerId(state) ?? containerName(projectRoot)
    await this.#execFile('docker', ['rm', '--force', id]).catch(() => ({ stdout: '', stderr: '' }))
  }

  async runCommand(
    _projectRoot: string,
    state: ProjectRuntimeState,
    request: RuntimeBackendCommandRequest,
    emit: (event: RuntimeBackendCommandEvent) => void,
    signal: AbortSignal,
  ): Promise<{ exitCode: number }> {
    if (!state.containerId) throw new Error('Project runtime is not running.')
    const args = [
      'exec',
      '--user',
      request.runtimeUser,
      '--workdir',
      request.cwd,
      ...Object.entries(request.env).flatMap(([key, value]) => ['--env', `${key}=${value}`]),
      state.containerId,
      'guildhall-exec',
      ...request.argv,
    ]
    const child = this.#spawn('docker', args)
    return waitForCommand(child, emit, signal)
  }

  async #existingContainerId(state: ProjectRuntimeState): Promise<string | null> {
    if (!state.containerId) return null
    try {
      const { stdout } = await this.#execFile('docker', ['container', 'inspect', state.containerId])
      return stdout.trim() ? state.containerId : null
    } catch {
      return null
    }
  }
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
