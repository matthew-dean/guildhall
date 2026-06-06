import { appendManagedTextFile, readManagedTextFile, readManagedTextFileSync, writeManagedTextFile } from '@guildhall/persistence'
import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { getProjectRuntimeDevServersPath } from '@guildhall/sessions'
import {
  readProjectRuntimeState,
  type ProjectRuntimePort,
  type ProjectRuntimeState,
} from './project-runtime-store.js'
import {
  allocateRuntimePort,
  type RuntimePortAllocationRequest,
} from './port-router.js'
import type { ProjectRuntimeSupervisor } from './project-runtime-supervisor.js'

const execFileP = promisify(execFile)

export type DevServerStatus = 'starting' | 'running' | 'stopped' | 'failed' | 'stale'
export type DevServerReadiness = 'unknown' | 'ready' | 'failed'

export interface DevServerRecord {
  id: string
  projectId: string
  taskId?: string
  status: DevServerStatus
  readiness: DevServerReadiness
  command: {
    cwd: string
    argv: string[]
  }
  ports: ProjectRuntimePort[]
  url: string
  readinessPath: string
  browserProof: {
    url: string
    ok: boolean
    status: number | null
    checkedAt: string
    error: string | null
  } | null
  runtimeProcessId: string | null
  logs: string[]
  startedAt: string | null
  stoppedAt: string | null
  lastCheckedAt: string | null
  error: string | null
}

export interface StartDevServerRequest {
  id: string
  projectId: string
  taskId?: string
  cwd: string
  argv: string[]
  containerPort: number
  preferredHostPort?: number
  readinessPath?: string
}

export interface DevServerLauncher {
  start(
    projectRoot: string,
    runtime: ProjectRuntimeState,
    request: StartDevServerRequest & { hostPort: number },
  ): Promise<{ runtimeProcessId: string; logs?: string[] }>
  stop(projectRoot: string, runtimeProcessId: string): Promise<void>
}

export interface DevServerManagerOptions {
  runtimeSupervisor: Pick<ProjectRuntimeSupervisor, 'start' | 'rebuild' | 'releaseKeepAlive'>
  launcher?: DevServerLauncher
  isPortAvailable?: RuntimePortAllocationRequest['isPortAvailable']
  fetch?: (url: string) => Promise<{ ok: boolean; status: number }>
  now?: () => string
}

export class DevServerManager {
  readonly #runtimeSupervisor: DevServerManagerOptions['runtimeSupervisor']
  readonly #launcher: DevServerLauncher
  readonly #isPortAvailable: RuntimePortAllocationRequest['isPortAvailable']
  readonly #fetch: (url: string) => Promise<{ ok: boolean; status: number }>
  readonly #now: () => string

  constructor(options: DevServerManagerOptions) {
    this.#runtimeSupervisor = options.runtimeSupervisor
    this.#launcher = options.launcher ?? new PodmanDevServerLauncher()
    this.#isPortAvailable = options.isPortAvailable
    this.#fetch = options.fetch ?? defaultFetch
    this.#now = options.now ?? (() => new Date().toISOString())
  }

  async list(projectRoot: string): Promise<DevServerRecord[]> {
    return readRuntimeDevServers(projectRoot)
  }

  async start(projectRoot: string, request: StartDevServerRequest): Promise<DevServerRecord> {
    const reservation = await allocateRuntimePort(projectRoot, {
      containerPort: request.containerPort,
      preferredHostPort: request.preferredHostPort,
      purpose: 'dev-server',
      ...(this.#isPortAvailable ? { isPortAvailable: this.#isPortAvailable } : {}),
    })
    const existingRuntime = await readProjectRuntimeState(projectRoot)
    if (existingRuntime.status !== 'running') await this.#runtimeSupervisor.rebuild(projectRoot)
    const runtime = await this.#runtimeSupervisor.start(projectRoot, { reason: 'dev-server' })
    const starting = await this.#upsert(projectRoot, {
      id: request.id,
      projectId: request.projectId,
      ...(request.taskId ? { taskId: request.taskId } : {}),
      status: 'starting',
      readiness: 'unknown',
      command: { cwd: request.cwd, argv: request.argv },
      ports: [{ container: reservation.container, host: reservation.host, purpose: reservation.purpose }],
      url: reservation.url,
      readinessPath: normalizeReadinessPath(request.readinessPath),
      browserProof: null,
      runtimeProcessId: null,
      logs: [],
      startedAt: this.#now(),
      stoppedAt: null,
      lastCheckedAt: null,
      error: null,
    })

    try {
      const launched = await this.#launcher.start(projectRoot, runtime, {
        ...request,
        hostPort: reservation.host,
      })
      const proof = await this.#browserProof(`${starting.url}${starting.readinessPath}`)
      return await this.#upsert(projectRoot, {
        ...starting,
        status: proof.ok ? 'running' : 'failed',
        readiness: proof.ok ? 'ready' : 'failed',
        runtimeProcessId: launched.runtimeProcessId,
        logs: redactLogs(launched.logs ?? []),
        browserProof: proof,
        lastCheckedAt: proof.checkedAt,
        error: proof.ok ? null : proof.error ?? `HTTP ${proof.status ?? '?'}`,
      })
    } catch (error) {
      return await this.#upsert(projectRoot, {
        ...starting,
        status: 'failed',
        readiness: 'failed',
        error: error instanceof Error ? error.message : String(error),
        lastCheckedAt: this.#now(),
      })
    }
  }

  async stop(projectRoot: string, id: string): Promise<DevServerRecord> {
    const server = await this.#find(projectRoot, id)
    if (server.runtimeProcessId) await this.#launcher.stop(projectRoot, server.runtimeProcessId)
    await this.#runtimeSupervisor.releaseKeepAlive(projectRoot, 'dev-server')
    const stoppedAt = this.#now()
    return await this.#upsert(projectRoot, {
      ...server,
      status: 'stopped',
      readiness: 'unknown',
      stoppedAt,
      lastCheckedAt: stoppedAt,
    })
  }

  async restart(projectRoot: string, id: string): Promise<DevServerRecord> {
    const existing = await this.#find(projectRoot, id)
    if (existing.status !== 'stopped') await this.stop(projectRoot, id)
    return this.start(projectRoot, {
      id: existing.id,
      projectId: existing.projectId,
      ...(existing.taskId ? { taskId: existing.taskId } : {}),
      cwd: existing.command.cwd,
      argv: existing.command.argv,
      containerPort: existing.ports[0]?.container ?? 5173,
      preferredHostPort: existing.ports[0]?.host,
      readinessPath: existing.readinessPath,
    })
  }

  async reconcile(
    projectRoot: string,
    input: { runtimeStatus: ProjectRuntimeState['status'] },
  ): Promise<DevServerRecord[]> {
    const records = await readRuntimeDevServers(projectRoot)
    if (input.runtimeStatus === 'running') return records
    const reconciled = records.map(record =>
      record.status === 'running' || record.status === 'starting'
        ? {
            ...record,
            status: 'stale' as const,
            readiness: 'unknown' as const,
            lastCheckedAt: this.#now(),
            error: 'Runtime stopped while the dev server was marked active.',
          }
        : record
    )
    await writeRuntimeDevServers(projectRoot, reconciled)
    return reconciled
  }

  async #browserProof(url: string): Promise<NonNullable<DevServerRecord['browserProof']>> {
    const checkedAt = this.#now()
    try {
      const response = await this.#fetch(url)
      return {
        url,
        ok: response.ok,
        status: response.status,
        checkedAt,
        error: response.ok ? null : `HTTP ${response.status}`,
      }
    } catch (error) {
      return {
        url,
        ok: false,
        status: null,
        checkedAt,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async #find(projectRoot: string, id: string): Promise<DevServerRecord> {
    const server = (await readRuntimeDevServers(projectRoot)).find(candidate => candidate.id === id)
    if (!server) throw new Error(`Dev server ${id} not found.`)
    return server
  }

  async #upsert(projectRoot: string, next: DevServerRecord): Promise<DevServerRecord> {
    const existing = await readRuntimeDevServers(projectRoot)
    const filtered = existing.filter(record => record.id !== next.id)
    await writeRuntimeDevServers(projectRoot, [...filtered, next])
    return next
  }
}

export async function readRuntimeDevServers(projectRoot: string): Promise<DevServerRecord[]> {
  try {
    return JSON.parse(await readManagedTextFile(getProjectRuntimeDevServersPath(projectRoot), 'utf8')) as DevServerRecord[]
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

export async function writeRuntimeDevServers(
  projectRoot: string,
  records: DevServerRecord[],
): Promise<void> {
  const file = getProjectRuntimeDevServersPath(projectRoot)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await writeManagedTextFile(file, `${JSON.stringify(records, null, 2)}\n`, 'utf8')
}

export function redactLogs(logs: string[]): string[] {
  return logs.map(line =>
    line
      .replace(/\b([A-Z0-9_]*(?:TOKEN|SECRET|KEY|PASSWORD)[A-Z0-9_]*)=([^\s]+)/g, '$1=[redacted]')
      .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[redacted]')
  )
}

export class PodmanDevServerLauncher implements DevServerLauncher {
  async start(
    _projectRoot: string,
    runtime: ProjectRuntimeState,
    request: StartDevServerRequest,
  ): Promise<{ runtimeProcessId: string; logs?: string[] }> {
    if (!runtime.containerId) throw new Error('Project runtime is not running.')
    const { stdout } = await execFileP('podman', [
      'exec',
      '--detach',
      '--user',
      'guildhall',
      '--workdir',
      request.cwd,
      '--env',
      `PORT=${request.containerPort}`,
      runtime.containerId,
      'guildhall-exec',
      ...request.argv,
    ])
    return {
      runtimeProcessId: stdout.trim(),
      logs: [`Started ${request.argv.join(' ')} on ${request.containerPort}.`],
    }
  }

  async stop(_projectRoot: string, runtimeProcessId: string): Promise<void> {
    await execFileP('podman', ['exec', runtimeProcessId, 'true']).catch(() => undefined)
    await execFileP('podman', ['kill', runtimeProcessId]).catch(() => undefined)
  }
}

function normalizeReadinessPath(value: string | undefined): string {
  if (!value || value.trim() === '') return '/'
  return value.startsWith('/') ? value : `/${value}`
}

async function defaultFetch(url: string): Promise<{ ok: boolean; status: number }> {
  const response = await fetch(url)
  return { ok: response.ok, status: response.status }
}
