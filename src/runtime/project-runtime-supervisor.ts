import {
  defaultProjectRuntimeState,
  readProjectRuntimeState,
  writeProjectRuntimeState,
  type ProjectRuntimeHealth,
  type ProjectRuntimeState,
  type RuntimeKeepAliveReason,
} from './project-runtime-store.js'
import { ContainerProjectRuntimeBackend } from './container-project-runtime-backend.js'
import {
  appendRuntimeCommandEvidence,
  createRuntimeCommandId,
  ProjectRuntimeCommandRequest,
  type ProjectRuntimeCommandRequest as ProjectRuntimeCommandRequestData,
  type RuntimeCommandEvent,
  type RuntimeCommandResult,
} from './project-runtime-command.js'
import type {
  ProjectRuntimeBackend,
  RuntimeBackendCommandEvent,
  RuntimeBackendCommandRequest,
} from './project-runtime-backend.js'
import { providerCommandEnv } from '@guildhall/config/global-providers'

export type RuntimeStartReason = RuntimeKeepAliveReason | 'ui-open'

export interface ProjectRuntimeSupervisorOptions {
  backend?: ProjectRuntimeBackend
  now?: () => string
}

const allowedStartReasons = new Set<RuntimeKeepAliveReason>([
  'command',
  'proof',
  'dev-server',
  'browser-proof',
])

export class ProjectRuntimeSupervisor {
  readonly #backend: ProjectRuntimeBackend
  readonly #now: () => string
  readonly #knownProjectRoots = new Set<string>()

  constructor(options: ProjectRuntimeSupervisorOptions = {}) {
    this.#backend = options.backend ?? new ContainerProjectRuntimeBackend()
    this.#now = options.now ?? (() => new Date().toISOString())
  }

  async create(projectRoot: string): Promise<ProjectRuntimeState> {
    this.#knownProjectRoots.add(projectRoot)
    const state = await readProjectRuntimeState(projectRoot)
    if (state.containerId) return state
    const created = await this.#backend.create(projectRoot, state)
    return writeProjectRuntimeState(projectRoot, {
      ...state,
      status: 'stopped',
      containerId: created.containerId ?? state.containerId,
      lastStoppedAt: state.lastStoppedAt ?? this.#now(),
    })
  }

  async inspect(projectRoot: string): Promise<ProjectRuntimeState> {
    this.#knownProjectRoots.add(projectRoot)
    const state = await readProjectRuntimeState(projectRoot)
    if (state.status !== 'running') return state

    const inspected = await this.#backend.inspect(projectRoot, state)
    return writeProjectRuntimeState(projectRoot, {
      ...state,
      status: inspected.status ?? state.status,
      containerId: inspected.containerId ?? state.containerId,
      health: inspected.health ?? state.health,
      lastInspectedAt: this.#now(),
    })
  }

  async start(
    projectRoot: string,
    options: { reason: RuntimeStartReason },
  ): Promise<ProjectRuntimeState> {
    this.#knownProjectRoots.add(projectRoot)
    if (!allowedStartReasons.has(options.reason as RuntimeKeepAliveReason)) {
      throw new Error(`Runtime start reason "${options.reason}" is not allowed.`)
    }

    const state = await readProjectRuntimeState(projectRoot)
    const started = await this.#backend.start(projectRoot, state)
    const reason = options.reason as RuntimeKeepAliveReason
    const keepAliveReasons = Array.from(new Set([...state.keepAliveReasons, reason]))
    return writeProjectRuntimeState(projectRoot, {
      ...state,
      status: 'running',
      containerId: started.containerId ?? state.containerId,
      keepAliveReasons,
      lastStartedAt: this.#now(),
      lastActivityAt: this.#now(),
      lastError: null,
    })
  }

  async stop(projectRoot: string): Promise<ProjectRuntimeState> {
    this.#knownProjectRoots.add(projectRoot)
    const state = await readProjectRuntimeState(projectRoot)
    if (state.status === 'running') await this.#backend.stop(projectRoot, state)
    return writeProjectRuntimeState(projectRoot, {
      ...state,
      status: 'stopped',
      containerId: null,
      keepAliveReasons: [],
      lastStoppedAt: this.#now(),
    })
  }

  async runCommand(
    projectRoot: string,
    requestInput: ProjectRuntimeCommandRequestData,
    options: { signal?: AbortSignal } = {},
  ): Promise<RuntimeCommandResult> {
    this.#knownProjectRoots.add(projectRoot)
    const request = ProjectRuntimeCommandRequest.parse(requestInput)
    const commandId = createRuntimeCommandId()
    const started = await this.start(projectRoot, { reason: 'command' })
    const events: RuntimeCommandEvent[] = []
    const startedAt = this.#now()
    const push = (event: RuntimeCommandEvent) => {
      events.push(event)
    }
    push({ type: 'started', at: startedAt, cwd: request.cwd, argv: request.argv })

    const controller = new AbortController()
    const abortFromCaller = () => controller.abort(options.signal?.reason ?? new Error('cancelled'))
    if (options.signal?.aborted) abortFromCaller()
    else options.signal?.addEventListener('abort', abortFromCaller, { once: true })

    let timeout: ReturnType<typeof setTimeout> | undefined
    let didTimeout = false
    try {
      const backendRequest: RuntimeBackendCommandRequest = {
        ...request,
        env: {
          ...providerCommandEnv(),
          ...request.env,
        },
        runtimeUser: 'guildhall',
      }
      const run = this.#backend.runCommand(
        projectRoot,
        started,
        backendRequest,
        event => push(runtimeCommandEventFromBackend(event, this.#now())),
        controller.signal,
      )
      const timeoutPromise = new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          didTimeout = true
          controller.abort(new Error('timeout'))
          reject(new Error(`Command timed out after ${request.timeoutMs}ms.`))
        }, request.timeoutMs)
      })
      const result = await Promise.race([run, timeoutPromise])
      if (timeout) clearTimeout(timeout)
      const completedAt = this.#now()
      push({ type: 'exit', at: completedAt, exitCode: result.exitCode })
      return await this.#completeCommand(projectRoot, {
        commandId,
        request,
        runtime: started,
        status: 'exited',
        exitCode: result.exitCode,
        startedAt,
        completedAt,
        events,
        error: null,
      })
    } catch (error) {
      if (timeout) clearTimeout(timeout)
      const completedAt = this.#now()
      const status = didTimeout
        ? 'timed_out'
        : controller.signal.aborted
          ? 'cancelled'
          : 'failed'
      const message = didTimeout
        ? `Command timed out after ${request.timeoutMs}ms.`
        : error instanceof Error
          ? error.message
          : String(error)
      push({
        type: 'failed',
        at: completedAt,
        reason: didTimeout ? 'timeout' : status === 'cancelled' ? 'cancelled' : 'error',
        message,
      })
      return await this.#completeCommand(projectRoot, {
        commandId,
        request,
        runtime: started,
        status,
        exitCode: null,
        startedAt,
        completedAt,
        events,
        error: message,
      })
    } finally {
      options.signal?.removeEventListener('abort', abortFromCaller)
      await this.releaseKeepAlive(projectRoot, 'command')
    }
  }

  async health(projectRoot: string): Promise<ProjectRuntimeHealth> {
    const inspected = await this.inspect(projectRoot)
    return inspected.health
  }

  async logs(projectRoot: string): Promise<string> {
    return this.#backend.logs(projectRoot, await readProjectRuntimeState(projectRoot))
  }

  async rebuild(projectRoot: string): Promise<ProjectRuntimeState> {
    const state = await readProjectRuntimeState(projectRoot)
    const rebuilt = await this.#backend.rebuild(projectRoot, state)
    return writeProjectRuntimeState(projectRoot, {
      ...state,
      status: 'stopped',
      containerId: rebuilt.containerId ?? null,
      keepAliveReasons: [],
      lastStoppedAt: this.#now(),
    })
  }

  async remove(projectRoot: string): Promise<ProjectRuntimeState> {
    const state = await readProjectRuntimeState(projectRoot)
    await this.#backend.remove(projectRoot, state)
    return writeProjectRuntimeState(projectRoot, {
      ...defaultProjectRuntimeState(projectRoot),
      lastStoppedAt: this.#now(),
    })
  }

  async #completeCommand(
    projectRoot: string,
    input: {
      commandId: string
      request: ProjectRuntimeCommandRequestData
      runtime: ProjectRuntimeState
      status: RuntimeCommandResult['status']
      exitCode: number | null
      startedAt: string
      completedAt: string
      events: RuntimeCommandEvent[]
      error: string | null
    },
  ): Promise<RuntimeCommandResult> {
    const record = {
      id: input.commandId,
      projectId: input.request.projectId,
      ...(input.request.taskId ? { taskId: input.request.taskId } : {}),
      request: input.request,
      runtime: {
        id: input.runtime.containerId,
        containerId: input.runtime.containerId,
      },
      status: input.status,
      exitCode: input.exitCode,
      startedAt: input.startedAt,
      completedAt: input.completedAt,
      events: input.events,
      error: input.error,
    }
    await appendRuntimeCommandEvidence(projectRoot, record)
    return {
      ...record,
      commandId: input.commandId,
    }
  }

  async releaseKeepAlive(
    projectRoot: string,
    reason: RuntimeKeepAliveReason,
  ): Promise<ProjectRuntimeState> {
    const state = await readProjectRuntimeState(projectRoot)
    return writeProjectRuntimeState(projectRoot, {
      ...state,
      keepAliveReasons: state.keepAliveReasons.filter((item) => item !== reason),
      lastActivityAt: this.#now(),
    })
  }

  async stopIdle(options: { idleTimeoutMs: number }): Promise<string[]> {
    const stopped: string[] = []
    const nowMs = Date.parse(this.#now())
    for (const projectRoot of this.#knownProjectRoots) {
      const state = await readProjectRuntimeState(projectRoot)
      if (state.status !== 'running') continue
      if (state.keepAliveReasons.length > 0) continue
      const lastActivityMs = Date.parse(state.lastActivityAt ?? state.lastStartedAt ?? '')
      if (!Number.isFinite(lastActivityMs)) continue
      if (nowMs - lastActivityMs < options.idleTimeoutMs) continue
      await this.stop(projectRoot)
      stopped.push(projectRoot)
    }
    return stopped
  }
}

function runtimeCommandEventFromBackend(
  event: RuntimeBackendCommandEvent,
  at: string,
): RuntimeCommandEvent {
  switch (event.type) {
    case 'stdout':
      return { type: 'stdout', at, data: event.data }
    case 'stderr':
      return { type: 'stderr', at, data: event.data }
    case 'port':
      return { type: 'port', at, port: event.port, hostPort: event.hostPort }
    case 'health_warning':
      return { type: 'health_warning', at, message: event.message }
  }
}

export class NoopProjectRuntimeBackend implements ProjectRuntimeBackend {
  async create() {
    return {}
  }

  async start() {
    return {}
  }

  async stop() {
    return
  }

  async inspect() {
    return {}
  }

  async logs() {
    return ''
  }

  async rebuild() {
    return {}
  }

  async remove() {
    return
  }

  async runCommand() {
    return { exitCode: 0 }
  }
}
