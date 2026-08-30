import { isAttentionOwnedInboxItem, type InboxItem } from './inbox.js'

export type FleetAttentionItem = Omit<InboxItem, 'kind'> & {
  id?: string
  status?: 'open' | 'resolved' | 'dismissed' | 'superseded' | string
  kind: InboxItem['kind'] | 'project_action'
  buttonLabel?: string
}

export interface FleetAttentionProject {
  id: string
  initializationNeeded?: boolean
  summaryFreshness?: 'current' | 'stale' | 'error' | 'missing'
  projectStatusError?: string
  actionModel?: {
    primaryAction?: {
      label?: string
      taskLabel?: string
      detail?: string
      buttonLabel?: string
      href?: string
      tone?: string
      code?: string
      taskId?: string
    } | null
    ownerInput?: {
      active?: boolean
      label?: string
      detail?: string
      href?: string
    }
  } | null
  startReadiness?: {
    canStart?: boolean
    code?: string
    message?: string
    actionHref?: string
    focusTaskId?: string
    focusTaskTitle?: string
  } | null
  fleetAttention?: {
    items: Array<Omit<FleetAttentionItem, 'kind'> & { kind: InboxItem['kind'] }>
    total: number
    freshness: 'current' | 'missing'
  }
}

export interface FleetAttentionGroup<TProject extends FleetAttentionProject = FleetAttentionProject> {
  project: TProject
  items: FleetAttentionItem[]
  error: string | null
}

function ownerActionItem(project: FleetAttentionProject): FleetAttentionItem | null {
  const action = project.actionModel?.primaryAction
  const ownerInput = project.actionModel?.ownerInput
  const primaryRequiresOwner = action?.tone === 'warn' || action?.tone === 'danger'
  if (!primaryRequiresOwner && !ownerInput?.active) return null

  const label = action?.label?.trim() || action?.taskLabel?.trim() || ownerInput?.label?.trim() || 'Project needs your decision'
  const detail = action?.detail?.trim() || action?.label?.trim() || ownerInput?.detail?.trim() || 'Open the project to continue.'
  return {
    id: `project-action:${project.id}:${action?.code ?? 'owner-input'}:${action?.taskId ?? ''}`,
    status: 'open',
    kind: 'project_action',
    severity: action?.tone === 'danger' ? 'high' : 'medium',
    title: label,
    detail,
    actionHref: action?.href ?? ownerInput?.href ?? '/overview',
    ...(action?.taskId ? { taskId: action.taskId } : {}),
    buttonLabel: action?.buttonLabel?.trim() || 'Open project',
  }
}

function legacyOwnerActionItem(project: FleetAttentionProject): FleetAttentionItem | null {
  const readiness = project.startReadiness
  if (!readiness || readiness.canStart !== false || readiness.code === 'all_terminal') return null
  return {
    id: `project-action:${project.id}:${readiness.code ?? 'blocked'}:${readiness.focusTaskId ?? ''}`,
    status: 'open',
    kind: 'project_action',
    severity: 'medium',
    title: readiness.focusTaskTitle?.trim() || 'Project needs your decision',
    detail: readiness.message?.trim() || 'Open the project to continue.',
    actionHref: readiness.actionHref ?? '/overview',
    ...(readiness.focusTaskId ? { taskId: readiness.focusTaskId } : {}),
    buttonLabel: 'Open project',
  }
}

/**
 * Selects the one global owner decision from an already-saved project summary.
 * A current shared action outranks retained inbox records; retained setup
 * attention is useful only when the summary has no action of its own.
 */
export function fleetAttentionItemsForProject(project: FleetAttentionProject): FleetAttentionItem[] {
  const currentAction = ownerActionItem(project)
  if (currentAction) return [currentAction]

  if (project.actionModel?.primaryAction) return []

  const legacyAction = legacyOwnerActionItem(project)
  if (legacyAction) return [legacyAction]

  return (project.fleetAttention?.items ?? [])
    .filter(item => item.status === 'open')
    .filter(isAttentionOwnedInboxItem)
    .filter(item => item.severity !== 'low')
}

export function buildFleetAttentionGroups<TProject extends FleetAttentionProject>(projects: readonly TProject[]): FleetAttentionGroup<TProject>[] {
  return projects.map(project => {
    if (project.initializationNeeded) return { project, items: [], error: null }
    if (project.summaryFreshness !== 'current' || project.fleetAttention?.freshness !== 'current') {
      return {
        project,
        items: [],
        error: project.projectStatusError ?? 'Saved fleet attention is not available yet. Background refresh will populate it.',
      }
    }
    return { project, items: fleetAttentionItemsForProject(project), error: null }
  })
}

export function summarizeFleetAttention<TProject extends FleetAttentionProject>(projects: readonly TProject[]): {
  projectCount: number
  totalItems: number
} {
  const groups = buildFleetAttentionGroups(projects)
  return {
    projectCount: groups.filter(group => group.items.length > 0).length,
    totalItems: groups.reduce((sum, group) => sum + group.items.length, 0),
  }
}
