import {
  readProjectStateDatabaseAvailability,
  writeProjectStateDatabaseAvailability,
} from '@guildhall/sessions'

export interface ProjectAvailabilityState {
  status: 'active' | 'paused'
  pausedAt: string | null
  resumedAt: string | null
  reason?: string
}

export function defaultProjectAvailabilityState(): ProjectAvailabilityState {
  return {
    status: 'active',
    pausedAt: null,
    resumedAt: null,
  }
}

export async function readProjectAvailability(projectPath: string): Promise<ProjectAvailabilityState> {
  return readProjectStateDatabaseAvailability(projectPath) ?? defaultProjectAvailabilityState()
}

export async function pauseProjectAvailability(
  projectPath: string,
  options: { reason?: string; now?: () => string } = {},
): Promise<ProjectAvailabilityState> {
  const next: ProjectAvailabilityState = {
    status: 'paused',
    pausedAt: options.now?.() ?? new Date().toISOString(),
    resumedAt: null,
    ...(options.reason ? { reason: options.reason } : {}),
  }
  writeProjectStateDatabaseAvailability(projectPath, next, next.pausedAt ?? new Date().toISOString())
  return next
}

export async function resumeProjectAvailability(
  projectPath: string,
  options: { now?: () => string } = {},
): Promise<ProjectAvailabilityState> {
  const next: ProjectAvailabilityState = {
    status: 'active',
    pausedAt: null,
    resumedAt: options.now?.() ?? new Date().toISOString(),
  }
  writeProjectStateDatabaseAvailability(projectPath, next, next.resumedAt ?? new Date().toISOString())
  return next
}
