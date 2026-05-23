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
  completedLabel: string | null
  nextLabel: string | null
  maturityLabel: string
  maturityDescription: string
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
  taskActivity: {
    windowLabel: string
    max: number
    bars: Array<{
      value: number
      label: string
    }>
  }
  ticker: ProjectActivityLine
  actionLabel: string
  runActionLabel: string | null
  canOpen: boolean
  canStart: boolean
  canStop: boolean
}

function emptyTaskActivity(): ProjectCardSummary['taskActivity'] {
  return {
    windowLabel: 'Last 30 days',
    max: 0,
    bars: Array.from({ length: 18 }, (_, index) => ({
      value: 0,
      label: `No task updates in period ${index + 1}`,
    })),
  }
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

function completedLabel(project: ServiceProjectSummary, counts: ProjectCardSummary['counts']): string | null {
  if (project.highlights?.recentCompletedTaskTitle) {
    return project.highlights.recentCompletedTaskTitle
  }
  if (counts.done > 0) {
    return counts.done === 1 ? '1 completed task recorded' : `${counts.done} completed tasks recorded`
  }
  return null
}

function nextLabel(project: ServiceProjectSummary, counts: ProjectCardSummary['counts']): string | null {
  if (project.highlights?.blockedTaskTitle) return `Unblock: ${project.highlights.blockedTaskTitle}`
  if (project.highlights?.activeTaskTitle) {
    return project.run?.status === 'running'
      ? `In progress: ${project.highlights.activeTaskTitle}`
      : `Resume: ${project.highlights.activeTaskTitle}`
  }
  if (counts.draftReview > 0) {
    return counts.draftReview === 1
      ? 'Review 1 draft brief'
      : `Review ${counts.draftReview} draft briefs`
  }
  if (counts.active > 0) {
    return project.run?.status === 'running'
      ? `${counts.active} active ${counts.active === 1 ? 'task' : 'tasks'} in progress`
      : `Start or resume ${counts.active} ${counts.active === 1 ? 'task' : 'tasks'}`
  }
  if (counts.done > 0) return 'No immediate next task detected'
  return 'Run intake or add the first task'
}

function maturity(project: ServiceProjectSummary, counts: ProjectCardSummary['counts']): Pick<ProjectCardSummary, 'maturityLabel' | 'maturityDescription'> {
  if (project.initializationNeeded) {
    return {
      maturityLabel: 'Setup',
      maturityDescription: 'Guildhall still needs the basic project setup contract before it can reason about work reliably.',
    }
  }
  if (counts.total === 0) {
    return {
      maturityLabel: 'Intake',
      maturityDescription: 'Guildhall has the project registered, but does not yet have a meaningful task map.',
    }
  }
  if (counts.draftReview > 0 && counts.done === 0 && counts.active === 0) {
    return {
      maturityLabel: 'Blueprint',
      maturityDescription: 'Guildhall is still turning notes or imported work into reviewed task briefs.',
    }
  }
  if (counts.blocked > 0) {
    return {
      maturityLabel: 'Inspect',
      maturityDescription: 'Some work needs triage before Guildhall can treat the project as flowing cleanly.',
    }
  }
  if (counts.active > 0) {
    return {
      maturityLabel: project.run?.status === 'running' ? 'Build' : 'Queued',
      maturityDescription: project.run?.status === 'running'
        ? 'Agents are actively building from the current task plan.'
        : 'Runnable work exists, but the project is not currently running.',
    }
  }
  if (counts.done > 0 && counts.done >= counts.total - counts.shelved) {
    return {
      maturityLabel: 'Stable',
      maturityDescription: 'As far as Guildhall can tell, the current task set is complete or intentionally shelved.',
    }
  }
  return {
    maturityLabel: 'Mixed',
    maturityDescription: 'The project has a mix of completed, queued, and planning work; inspect details for the next meaningful step.',
  }
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
  const maturityState = maturity(project, counts)
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
    completedLabel: completedLabel(project, counts),
    nextLabel: nextLabel(project, counts),
    maturityLabel: maturityState.maturityLabel,
    maturityDescription: maturityState.maturityDescription,
    blurb: project.summary ?? null,
    tags: project.tags ?? [],
    counts,
    taskActivity: project.taskActivity ?? emptyTaskActivity(),
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
