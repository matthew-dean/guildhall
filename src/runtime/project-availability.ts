import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { atomicWriteText, getProjectLocalHistoryDir } from '@guildhall/sessions'

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

function projectAvailabilityPath(projectPath: string): string {
  return join(getProjectLocalHistoryDir(projectPath), 'project-availability.json')
}

export async function readProjectAvailability(projectPath: string): Promise<ProjectAvailabilityState> {
  try {
    const parsed = JSON.parse(await readFile(projectAvailabilityPath(projectPath), 'utf8')) as Partial<ProjectAvailabilityState>
    return {
      ...defaultProjectAvailabilityState(),
      status: parsed.status === 'paused' ? 'paused' : 'active',
      pausedAt: typeof parsed.pausedAt === 'string' ? parsed.pausedAt : null,
      resumedAt: typeof parsed.resumedAt === 'string' ? parsed.resumedAt : null,
      ...(typeof parsed.reason === 'string' && parsed.reason.trim() ? { reason: parsed.reason } : {}),
    }
  } catch {
    return defaultProjectAvailabilityState()
  }
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
  const target = projectAvailabilityPath(projectPath)
  await mkdir(dirname(target), { recursive: true })
  await atomicWriteText(target, `${JSON.stringify(next, null, 2)}\n`)
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
  const target = projectAvailabilityPath(projectPath)
  await mkdir(dirname(target), { recursive: true })
  await atomicWriteText(target, `${JSON.stringify(next, null, 2)}\n`)
  return next
}
