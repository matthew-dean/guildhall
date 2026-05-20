import type { ProjectRun, ServiceDetail, ServiceProjectSummary } from './types.js'
import { buildProjectCardTicker, type ProjectActivityLine } from './project-activity.js'
import { formatUserPath } from './display-path.js'
import { humanizeProjectName } from './project-name.js'

export interface ProjectCardSummary {
  id: string
  name: string
  path: string
  statusLabel: string
  tone: 'active' | 'warn' | 'success' | 'idle'
  stageLabel: string
  activityLabel: string
  recentLabel: string | null
  blurb: string | null
  tags: string[]
  counts: {
    total: number
    active: number
    draftReview: number
    blocked: number
    done: number
    shelved: number
  }
  ticker: ProjectActivityLine
  actionLabel: string
  runActionLabel: string | null
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

function stageLabel(project: ServiceProjectSummary, counts: ProjectCardSummary['counts']): string {
  const runStatus = project.run?.status ?? 'stopped'
  if (project.initializationNeeded) return 'Needs setup'
  if (runStatus === 'error') return 'Needs attention'
  if (runStatus === 'stopping') return 'Stopping'
  if (runStatus === 'running') return 'Running'
  if (counts.blocked > 0) return 'Needs attention'
  if (counts.draftReview > 0 && counts.active === 0) return 'Needs task briefs'
  if (counts.active > 0) return 'Paused'
  if (counts.total === 0) return 'Ready'
  if (counts.done > 0 && counts.active === 0 && counts.blocked === 0) return 'Stable'
  return 'Ready'
}

function statusLabel(project: ServiceProjectSummary, counts: ProjectCardSummary['counts']): string {
  return stageLabel(project, counts)
}

function activityLabel(project: ServiceProjectSummary, counts: ProjectCardSummary['counts']): string {
  if (project.initializationNeeded) return 'Needs first-time Guildhall setup.'
  const running = (project.run?.status ?? 'stopped') === 'running'
  if (running && counts.active > 0) {
    return counts.active === 1
      ? 'Agents are working on 1 task.'
      : `Agents are working on ${counts.active} tasks.`
  }
  if (counts.blocked > 0) {
    return counts.blocked === 1
      ? '1 blocked task needs attention.'
      : `${counts.blocked} blocked tasks need attention.`
  }
  if (counts.draftReview > 0 && counts.active === 0) {
    return counts.draftReview === 1
      ? '1 imported draft needs a task brief.'
      : `${counts.draftReview} imported drafts need task briefs.`
  }
  if (counts.active > 0) {
    return counts.active === 1
      ? '1 task is paused.'
      : `${counts.active} tasks are paused.`
  }
  if (counts.done > 0) {
    return counts.total > 0
      ? `${counts.done} of ${counts.total} tasks are done.`
      : `${counts.done} tasks are done.`
  }
  return 'No task activity yet.'
}

function recentLabel(project: ServiceProjectSummary, counts: ProjectCardSummary['counts']): string | null {
  if (project.highlights?.activeTaskTitle) return `Working on: ${project.highlights.activeTaskTitle}`
  if (project.highlights?.blockedTaskTitle) return `Blocked on: ${project.highlights.blockedTaskTitle}`
  if (project.highlights?.recentCompletedTaskTitle) return `Recently completed: ${project.highlights.recentCompletedTaskTitle}`
  if (counts.done > 0) return 'Completed work is recorded in this project.'
  return null
}

export function summarizeProjectCard(project: ServiceProjectSummary): ProjectCardSummary {
  const counts = {
    total: project.taskCounts?.total ?? 0,
    active: project.taskCounts?.active ?? 0,
    draftReview: project.taskCounts?.draftReview ?? 0,
    blocked: project.taskCounts?.blocked ?? 0,
    done: project.taskCounts?.done ?? 0,
    shelved: project.taskCounts?.shelved ?? 0,
  }
  const running = project.run?.status === 'running'
  const initializationNeeded = Boolean(project.initializationNeeded)
  return {
    id: project.id,
    name: humanizeProjectName(project.name),
    path: formatUserPath(project.path),
    statusLabel: statusLabel(project, counts),
    tone:
      initializationNeeded || project.run?.status === 'error'
        ? 'warn'
        : (project.run?.status ?? 'stopped') === 'running'
          ? 'active'
          : counts.blocked > 0
            ? 'warn'
            : counts.draftReview > 0 && counts.active === 0
              ? 'warn'
            : counts.done > 0 && counts.active === 0 && counts.blocked === 0
              ? 'success'
              : statusFromRun(project.run),
    stageLabel: stageLabel(project, counts),
    activityLabel: activityLabel(project, counts),
    recentLabel: recentLabel(project, counts),
    blurb: project.summary ?? null,
    tags: project.tags ?? [],
    counts,
    ticker: buildProjectCardTicker(project),
    actionLabel: initializationNeeded ? 'Open setup' : 'Open project',
    runActionLabel: initializationNeeded ? null : running ? 'Stop' : 'Start',
    canOpen: true,
    canStart: !running && !initializationNeeded && !(counts.draftReview > 0 && counts.active === 0),
    canStop: running,
  }
}

export function summarizeProjects(service: ServiceDetail | null | undefined): ProjectCardSummary[] {
  return (service?.projects ?? []).map(summarizeProjectCard)
}
