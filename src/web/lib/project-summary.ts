import type { ProjectRun, ProviderStatus, ServiceDetail, ServiceProjectSummary } from './types.js'
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
  projectCheckIn?: ServiceProjectSummary['projectCheckIn']
  provider?: {
    label: string
    title: string
    tone: 'warn' | 'neutral'
  } | null
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
  needsAttention: boolean
  gitStory?: {
    state?: string
    label: string
    title: string
    blockerCount: number
  } | null
  statusLoading: boolean
}

export interface ProjectSummaryCache {
  summarize(service: ServiceDetail | null | undefined): ProjectCardSummary[]
}

interface CachedProjectCardSummary {
  signature: string
  summary: ProjectCardSummary
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

function readinessStage(project: ServiceProjectSummary): string | null {
  const readiness = project.startReadiness
  if (!readiness || readiness.canStart !== false) return null
  switch (readiness.code) {
    case 'required_migration_pending': return 'Needs migration'
    case 'owner_input_required': return 'Needs you'
    case 'no_provider': return 'Needs provider'
    case 'no_loaded_model': return 'Needs provider'
    case 'model_unavailable': return 'Needs provider'
    case 'provider_unavailable': return 'Needs provider'
    case 'invalid_lever_combo': return 'Settings blocked'
    case 'runtime_too_old': return 'Update Guildhall'
    case 'all_terminal': return 'Complete'
    default: return 'Blocked'
  }
}

function actionModelStage(project: ServiceProjectSummary): string | null {
  const actionModel = project.actionModel
  if (!actionModel) return null
  if (actionModel.ownerInput?.active) return 'Needs you'
  const code = actionModel.primaryAction?.code ?? project.startReadiness?.code
  if (code === 'all_terminal') return 'Complete'
  if (code === 'required_migration_pending') return 'Needs migration'
  if (code === 'no_provider' || code === 'no_loaded_model' || code === 'model_unavailable' || code === 'provider_unavailable') {
    return 'Needs provider'
  }
  return null
}

function readinessMaturity(project: ServiceProjectSummary): Pick<ProjectCardSummary, 'maturityLabel' | 'maturityDescription'> | null {
  const readiness = project.startReadiness
  if (!readiness || readiness.canStart !== false) return null
  if (readiness.code === 'required_migration_pending') {
    return {
      maturityLabel: 'Migrate',
      maturityDescription: readiness.message ?? 'Run the required migration before starting this project.',
    }
  }
  if (readiness.code === 'owner_input_required') {
    return {
      maturityLabel: 'Needs you',
      maturityDescription: readiness.message ?? 'Waiting for a project decision before work can continue.',
    }
  }
  return {
    maturityLabel: readinessStage(project) ?? 'Blocked',
    maturityDescription: readiness.message ?? 'Resolve this start blocker before the project can move forward.',
  }
}

function stageLabel(project: ServiceProjectSummary, counts: ProjectCardSummary['counts']): string {
  const runStatus = project.run?.status ?? 'stopped'
  if (project.initializationNeeded) return 'Needs setup'
  const actionStage = actionModelStage(project)
  if (actionStage) return actionStage
  const readiness = readinessStage(project)
  if (readiness) return readiness
  if (project.projectCheckIn?.needed) return project.projectCheckIn.label ?? 'Project questions'
  if (runStatus === 'error') return 'Needs attention'
  if (runStatus === 'stopping') return 'Stopping'
  if (runStatus === 'running') return 'Running'
  if (counts.blocked > 0) return 'Needs attention'
  if (counts.draftReview > 0 && counts.active === 0) return 'Needs brief'
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
  if (project.startReadiness?.canStart === false && project.startReadiness.message) {
    return project.startReadiness.message
  }
  if (project.projectCheckIn?.needed) return `${project.projectCheckIn.title ?? 'Project check-in needed'}.`
  const running = (project.run?.status ?? 'stopped') === 'running'
  const oneTaskRun = running && project.run?.mode === 'one_task'
  if (oneTaskRun) return 'Advancing one task.'
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
  if ((project.run?.status ?? 'stopped') === 'running' && project.run?.mode === 'one_task') {
    return project.highlights?.activeTaskTitle
      ? `Advancing one task: ${project.highlights.activeTaskTitle}`
      : 'Advancing one task'
  }
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
  const primary = project.actionModel?.primaryAction
  if (primary) {
    return primary.detail ?? primary.label
  }
  if (project.actionModel?.runControl?.startEnabled === false) {
    return project.actionModel.runControl.disabledReason ?? project.actionModel.runControl.label
  }
  if (project.startReadiness?.canStart === false) {
    if (project.startReadiness.code === 'required_migration_pending') return 'Run required migration'
    if (project.startReadiness.code === 'owner_input_required') return project.startReadiness.message ?? 'Answer project blocker'
    return project.startReadiness.message ?? 'Resolve start blocker'
  }
  if (project.projectCheckIn?.needed) return 'Answer project questions'
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

function projectNeedsAttention(
  project: ServiceProjectSummary,
  counts: ProjectCardSummary['counts'],
  projectCheckIn: ServiceProjectSummary['projectCheckIn'] | undefined,
  provider: ProjectCardSummary['provider'] | null,
): boolean {
  const code = project.actionModel?.primaryAction?.code ?? project.startReadiness?.code
  if (code === 'all_terminal') return false
  if (project.actionModel?.ownerInput?.active) return true
  if (project.actionModel?.primaryAction?.tone === 'danger' || project.actionModel?.primaryAction?.tone === 'warn') return true
  if (project.actionModel?.runControl?.startEnabled === false && code !== 'all_terminal') return true
  if (!project.actionModel && project.startReadiness?.canStart === false && code !== 'all_terminal') return true
  return Boolean(counts.blocked > 0 || counts.draftReview > 0 || projectCheckIn?.needed || provider?.tone === 'warn')
}

function maturity(project: ServiceProjectSummary, counts: ProjectCardSummary['counts']): Pick<ProjectCardSummary, 'maturityLabel' | 'maturityDescription'> {
  const readiness = readinessMaturity(project)
  if (readiness) return readiness
  if (project.projectCheckIn?.needed) {
    return {
      maturityLabel: 'Check-in',
      maturityDescription: project.projectCheckIn.detail ?? 'Answer the first project questions so current project context can be used.',
    }
  }
  if (project.initializationNeeded) {
    return {
      maturityLabel: 'Setup',
      maturityDescription: 'The basic project setup contract is still missing.',
    }
  }
  if (counts.total === 0) {
    return {
      maturityLabel: 'Intake',
      maturityDescription: 'The project is registered, but does not yet have a meaningful task map.',
    }
  }
  if (counts.draftReview > 0 && counts.done === 0 && counts.active === 0) {
    return {
      maturityLabel: 'Blueprint',
      maturityDescription: 'Notes or imported work are still becoming reviewed task briefs.',
    }
  }
  if (counts.blocked > 0) {
    return {
      maturityLabel: 'Inspect',
      maturityDescription: 'Some work needs triage before the project is flowing cleanly.',
    }
  }
  if (counts.active > 0) {
    return {
      maturityLabel: project.run?.status === 'running' ? 'Build' : 'Paused',
      maturityDescription: project.run?.status === 'running'
        ? 'Agents are actively building from the current task plan.'
        : 'Work is ready or paused, but no agents are running right now.',
    }
  }
  if (counts.done > 0 && counts.done >= counts.total - counts.shelved) {
    return {
      maturityLabel: 'Stable',
      maturityDescription: 'The current task set appears complete or intentionally shelved.',
    }
  }
  return {
    maturityLabel: 'Mixed',
    maturityDescription: 'The project has a mix of completed, queued, and planning work; inspect details for the next meaningful step.',
  }
}

function providerIdentity(status: ProviderStatus | null | undefined): string | null {
  const provider =
    status?.preferredProvider ??
    status?.activeProvider ??
    status?.preferredProviderLabel ??
    status?.activeProviderLabel
  const model = status?.models?.worker ?? status?.activeModel ?? null
  return provider || model ? `${provider ?? ''}::${model ?? ''}` : null
}

function gitStoryTitle(state: string, reason: string | undefined): string {
  const text = `${state}\n${reason ?? ''}`.toLowerCase()
  if (text.includes('no upstream')) {
    return 'This branch needs a sharing decision: push it, open a PR, or mark the work local-only/deferred.'
  }
  if (text.includes('dirty') || text.includes('uncommitted')) {
    return 'This checkout has uncommitted work. Review the diff, then commit it or mark it local-only/deferred.'
  }
  if (text.includes('fatal: not a git repository') || text.includes('spawn git enoent')) {
    return 'This checkout could not be inspected with git.'
  }
  return reason ?? 'Git story needs closure.'
}

export function summarizeProjectCard(
  project: ServiceProjectSummary,
  defaultProviderStatus?: ProviderStatus | null,
): ProjectCardSummary {
  const projectStatusLoading = Boolean(project.projectStatusLoading)
  const visibleWorkCounts = project.workProgress?.counts
  const counts = {
    total: visibleWorkCounts?.visibleTotal ?? project.taskCounts?.total ?? 0,
    active: visibleWorkCounts?.visibleActive ?? project.taskCounts?.active ?? 0,
    draftReview: project.taskCounts?.draftReview ?? 0,
    blocked: visibleWorkCounts?.visibleBlocked ?? project.taskCounts?.blocked ?? 0,
    done: visibleWorkCounts?.visibleDone ?? project.taskCounts?.done ?? 0,
    shelved: visibleWorkCounts?.visibleShelved ?? project.taskCounts?.shelved ?? 0,
  }
  const running = project.run?.status === 'running'
  const initializationNeeded = Boolean(project.initializationNeeded)
  const maturityState = maturity(project, counts)
  const runControl = project.actionModel?.runControl ?? null
  const startBlocked = runControl
    ? !running && runControl.startEnabled === false
    : project.startReadiness?.canStart === false
  const projectCheckIn = startBlocked ? undefined : project.projectCheckIn
  const gitStory = project.gitStory &&
    project.gitStory.state &&
    project.gitStory.state !== 'clean' &&
    project.gitStory.state !== 'merged' &&
    project.gitStory.state !== 'unknown'
    ? {
        state: project.gitStory.state,
        label: gitStoryLabel(project.gitStory.state),
        title: gitStoryTitle(project.gitStory.state, project.gitStory.blockers?.[0]?.reason),
        blockerCount: project.gitStory.blockers?.length ?? 0,
      }
    : null
  const providerWarning = project.providerStatus?.warnings?.[0]
  const providerLabel =
    project.providerStatus?.preferredProviderLabel ??
    project.providerStatus?.activeProviderLabel ??
    project.providerStatus?.preferredProvider ??
    project.providerStatus?.activeProvider
  const providerIsDefault = providerIdentity(project.providerStatus) === providerIdentity(defaultProviderStatus)
  const provider = providerLabel && (providerWarning || !providerIsDefault)
    ? {
        label: providerWarning ? 'Provider warning' : String(providerLabel),
        title: providerWarning?.message ?? `Project provider: ${providerLabel}.`,
        tone: providerWarning ? 'warn' as const : 'neutral' as const,
      }
    : null
  const needsAttention = projectNeedsAttention(project, counts, projectCheckIn, provider)
  if (projectStatusLoading) {
    return {
      id: project.id,
      name: humanizeProjectName(project.name?.trim() || project.id),
      path: formatUserPath(project.path),
      statusLabel: 'Loading',
      tone: project.run?.status === 'running' ? 'active' : 'idle',
      stageLabel: 'Loading',
      activityLabel: 'Loading project status...',
      recentLabel: null,
      completedLabel: null,
      nextLabel: null,
      maturityLabel: 'Loading',
      maturityDescription: 'Project status is still loading.',
      blurb: project.summary ?? null,
      tags: project.tags ?? [],
      counts,
      taskActivity: project.taskActivity ?? emptyTaskActivity(),
      ticker: buildProjectCardTicker(project),
      actionLabel: initializationNeeded ? 'Open setup' : 'Open project',
      runActionLabel: null,
      canOpen: true,
      canStart: false,
      canStop: false,
      needsAttention: false,
      gitStory: null,
      statusLoading: true,
    }
  }
  return {
    id: project.id,
    name: humanizeProjectName(project.name?.trim() || project.id),
    path: formatUserPath(project.path),
    statusLabel: statusLabel(project, counts),
    tone:
      projectCheckIn?.needed || initializationNeeded || startBlocked || project.run?.status === 'error'
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
    ...(projectCheckIn ? { projectCheckIn } : {}),
    ...(provider ? { provider } : {}),
    blurb: project.summary ?? null,
    tags: project.tags ?? [],
    counts,
    taskActivity: project.taskActivity ?? emptyTaskActivity(),
    ticker: buildProjectCardTicker(project),
    actionLabel: initializationNeeded ? 'Open setup' : 'Open project',
    runActionLabel: initializationNeeded
      ? null
      : running
        ? 'Pause'
        : startBlocked
          ? null
        : runControl?.label && runControl.label !== 'Resume'
          ? runControl.label
        : counts.active > 0
          ? 'Resume'
          : counts.total === 0
            ? 'Start intake'
            : null,
    canOpen: true,
    canStart: runControl
      ? !running && !initializationNeeded && runControl.startEnabled && runControl.label !== 'Pause'
      : !running &&
        !initializationNeeded &&
        !startBlocked &&
        (counts.active > 0 || counts.total === 0) &&
        !(counts.draftReview > 0 && counts.active === 0),
    canStop: running || (!initializationNeeded && !running && runControl?.startEnabled === true && runControl.label === 'Pause'),
    needsAttention,
    gitStory,
    statusLoading: false,
  }
}

function projectSummarySignature(
  project: ServiceProjectSummary,
  defaultProviderStatus?: ProviderStatus | null,
): string {
  return JSON.stringify({
    defaultProviderIdentity: providerIdentity(defaultProviderStatus),
    id: project.id,
    path: project.path,
    name: project.name,
    summary: project.summary,
    tags: project.tags,
    taskCounts: project.taskCounts,
    workProgress: project.workProgress,
    taskActivity: project.taskActivity,
    highlights: project.highlights,
    run: project.run,
    initializationNeeded: project.initializationNeeded,
    startReadiness: project.startReadiness,
    actionModel: project.actionModel,
    providerStatus: project.providerStatus,
    gitStory: project.gitStory,
    projectCheckIn: project.projectCheckIn,
    projectStatusLoading: project.projectStatusLoading,
  })
}

function serviceDefaultProviderSignature(service: ServiceDetail | null | undefined): string {
  return JSON.stringify({
    defaultProviderIdentity: providerIdentity(service?.defaultProviderStatus),
    defaultProviderStatus: service?.defaultProviderStatus,
  })
}

export function mergeServiceProjectSummaries(
  previous: ServiceDetail | null | undefined,
  incoming: ServiceDetail,
): ServiceDetail {
  if (!previous) return incoming
  if (serviceDefaultProviderSignature(previous) !== serviceDefaultProviderSignature(incoming)) {
    return incoming
  }

  const previousProjects = previous.projects ?? []
  const incomingProjects = incoming.projects ?? []
  const previousByProjectId = new Map(previousProjects.map(project => [project.id, project]))
  let changed = previousProjects.length !== incomingProjects.length

  const projects = incomingProjects.map((project, index) => {
    const cached = previousByProjectId.get(project.id)
    if (previousProjects[index]?.id !== project.id) {
      changed = true
    }
    if (!cached) {
      changed = true
      return project
    }
    if (projectSummarySignature(cached, incoming.defaultProviderStatus) === projectSummarySignature(project, incoming.defaultProviderStatus)) {
      return cached
    }
    changed = true
    return project
  })

  if (!changed) return previous
  return {
    ...incoming,
    projects,
  }
}

export function createProjectSummaryCache(): ProjectSummaryCache {
  let summariesByProjectId = new Map<string, CachedProjectCardSummary>()

  return {
    summarize(service: ServiceDetail | null | undefined): ProjectCardSummary[] {
      const defaultProviderStatus = service?.defaultProviderStatus ?? null
      const nextSummariesByProjectId = new Map<string, CachedProjectCardSummary>()
      const summaries = (service?.projects ?? []).map((project) => {
        const signature = projectSummarySignature(project, defaultProviderStatus)
        const cached = summariesByProjectId.get(project.id)
        if (cached?.signature === signature) {
          nextSummariesByProjectId.set(project.id, cached)
          return cached.summary
        }
        const next = {
          signature,
          summary: summarizeProjectCard(project, defaultProviderStatus),
        }
        nextSummariesByProjectId.set(project.id, next)
        return next.summary
      })
      summariesByProjectId = nextSummariesByProjectId
      return summaries
    },
  }
}

function gitStoryLabel(state: string): string {
  switch (state) {
    case 'dirty_uncommitted': return 'Dirty'
    case 'committed_local': return 'Unpushed'
    case 'no_upstream': return 'No upstream'
    case 'pr_open': return 'PR open'
    case 'pushed': return 'Pushed'
    case 'local_only': return 'Local-only'
    case 'deferred': return 'Deferred'
    case 'conflict': return 'Git conflict'
    case 'unknown': return 'Git unknown'
    default: return 'Git story'
  }
}

export function summarizeProjects(service: ServiceDetail | null | undefined): ProjectCardSummary[] {
  return (service?.projects ?? []).map(project => summarizeProjectCard(project, service?.defaultProviderStatus ?? null))
}
