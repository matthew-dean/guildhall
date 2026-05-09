import type { ProjectRun, ServiceDetail, ServiceProjectSummary } from './types.js'

export interface ProjectCardSummary {
  id: string
  name: string
  path: string
  selected: boolean
  statusLabel: string
  tone: 'active' | 'warn' | 'success' | 'idle'
  counts: {
    total: number
    active: number
    blocked: number
    done: number
    shelved: number
  }
  actionLabel: string
  canOpen: boolean
  canStart: boolean
  canStop: boolean
}

function statusFromRun(run: ProjectRun | null | undefined): ProjectCardSummary['tone'] {
  const status = run?.status ?? 'stopped'
  if (status === 'running') return 'active'
  if (status === 'error' || status === 'stopping') return 'warn'
  if (status === 'stopped') return 'idle'
  return 'success'
}

function statusLabel(run: ProjectRun | null | undefined, selected: boolean): string {
  const status = run?.status ?? 'stopped'
  if (status === 'running') return selected ? 'Running here' : 'Running'
  if (status === 'stopping') return 'Stopping'
  if (status === 'error') return 'Needs attention'
  return selected ? 'Ready here' : 'Idle'
}

export function summarizeProjectCard(project: ServiceProjectSummary): ProjectCardSummary {
  const counts = {
    total: project.taskCounts?.total ?? 0,
    active: project.taskCounts?.active ?? 0,
    blocked: project.taskCounts?.blocked ?? 0,
    done: project.taskCounts?.done ?? 0,
    shelved: project.taskCounts?.shelved ?? 0,
  }
  const selected = Boolean(project.selected)
  const running = project.run?.status === 'running'
  const initializationNeeded = Boolean(project.initializationNeeded)
  return {
    id: project.id,
    name: project.name,
    path: project.path,
    selected,
    statusLabel: initializationNeeded ? 'Needs setup' : statusLabel(project.run, selected),
    tone: initializationNeeded ? 'warn' : statusFromRun(project.run),
    counts,
    actionLabel: initializationNeeded
      ? (selected ? 'Open setup' : 'Switch and set up')
      : selected ? 'Open project' : 'Switch and open',
    canOpen: true,
    canStart: !running && !initializationNeeded,
    canStop: running,
  }
}

export function summarizeProjects(service: ServiceDetail | null | undefined): ProjectCardSummary[] {
  return (service?.projects ?? []).map(summarizeProjectCard)
}
