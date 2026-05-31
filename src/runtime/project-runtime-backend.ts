import type { ProjectRuntimeCommandRequest as ProjectRuntimeCommandRequestData } from './project-runtime-command.js'
import type {
  ProjectRuntimeHealth,
  ProjectRuntimeState,
} from './project-runtime-store.js'

export type RuntimeBackendCommandEvent =
  | { type: 'stdout'; data: string }
  | { type: 'stderr'; data: string }
  | { type: 'port'; port: number; hostPort: number }
  | { type: 'health_warning'; message: string }

export type RuntimeBackendCommandRequest = ProjectRuntimeCommandRequestData & {
  runtimeUser: 'guildhall'
}

export interface ProjectRuntimeBackend {
  create(projectRoot: string, state: ProjectRuntimeState): Promise<{ containerId?: string | null }>
  start(projectRoot: string, state: ProjectRuntimeState): Promise<{ containerId?: string | null }>
  stop(projectRoot: string, state: ProjectRuntimeState): Promise<void>
  inspect(projectRoot: string, state: ProjectRuntimeState): Promise<{
    status?: ProjectRuntimeState['status']
    containerId?: string | null
    health?: ProjectRuntimeHealth
  }>
  logs(projectRoot: string, state: ProjectRuntimeState): Promise<string>
  rebuild(projectRoot: string, state: ProjectRuntimeState): Promise<{ containerId?: string | null }>
  remove(projectRoot: string, state: ProjectRuntimeState): Promise<void>
  runCommand(
    projectRoot: string,
    state: ProjectRuntimeState,
    request: RuntimeBackendCommandRequest,
    emit: (event: RuntimeBackendCommandEvent) => void,
    signal: AbortSignal,
  ): Promise<{ exitCode: number }>
}
