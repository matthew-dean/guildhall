import type {
  ProjectRuntimeBackend,
  RuntimeBackendCommandEvent,
  RuntimeBackendCommandRequest,
} from './project-runtime-backend.js'
import type { ProjectRuntimeState } from './project-runtime-store.js'
import { DockerProjectRuntimeBackend } from './docker-project-runtime-backend.js'
import { PodmanProjectRuntimeBackend } from './podman-project-runtime-backend.js'

export class ContainerProjectRuntimeBackend implements ProjectRuntimeBackend {
  readonly #docker: ProjectRuntimeBackend
  readonly #podman: ProjectRuntimeBackend

  constructor(input: {
    docker?: ProjectRuntimeBackend
    podman?: ProjectRuntimeBackend
  } = {}) {
    this.#docker = input.docker ?? new DockerProjectRuntimeBackend()
    this.#podman = input.podman ?? new PodmanProjectRuntimeBackend()
  }

  #backend(state: ProjectRuntimeState): ProjectRuntimeBackend {
    if (state.backend === 'podman') return this.#podman
    if (state.backend === 'docker') return this.#docker
    throw new Error('No container runtime backend is selected for this project.')
  }

  create(projectRoot: string, state: ProjectRuntimeState) {
    return this.#backend(state).create(projectRoot, state)
  }

  start(projectRoot: string, state: ProjectRuntimeState) {
    return this.#backend(state).start(projectRoot, state)
  }

  stop(projectRoot: string, state: ProjectRuntimeState) {
    return this.#backend(state).stop(projectRoot, state)
  }

  inspect(projectRoot: string, state: ProjectRuntimeState) {
    return this.#backend(state).inspect(projectRoot, state)
  }

  logs(projectRoot: string, state: ProjectRuntimeState) {
    return this.#backend(state).logs(projectRoot, state)
  }

  rebuild(projectRoot: string, state: ProjectRuntimeState) {
    return this.#backend(state).rebuild(projectRoot, state)
  }

  remove(projectRoot: string, state: ProjectRuntimeState) {
    return this.#backend(state).remove(projectRoot, state)
  }

  runCommand(
    projectRoot: string,
    state: ProjectRuntimeState,
    request: RuntimeBackendCommandRequest,
    emit: (event: RuntimeBackendCommandEvent) => void,
    signal: AbortSignal,
  ) {
    return this.#backend(state).runCommand(projectRoot, state, request, emit, signal)
  }
}
