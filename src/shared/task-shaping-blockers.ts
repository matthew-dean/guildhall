export interface TaskShapingBlocker {
  code: 'imported_brief_shaping' | 'source_recovery'
  summary: string
}

interface TaskReadinessLike {
  recommendation?: string
  summary?: string
}

interface TaskNoteLike {
  role?: string
  agentId?: string
}

interface TaskBriefLike {
  userJob?: string
  whyItMattersNow?: string
  successMetric?: string
  rolloutPlan?: string
  nonGoals?: unknown[]
  antiPatterns?: unknown[]
}

interface TaskLike {
  status?: string
  notes?: TaskNoteLike[]
  productBrief?: TaskBriefLike | null
  acceptanceCriteria?: unknown[]
  taskReadiness?: TaskReadinessLike
  currentSummary?: {
    imported?: boolean
    brief?: {
      present?: boolean
      shaped?: boolean
      userJob?: boolean
      successMetric?: boolean
      approvedAt?: string | null
    }
    acceptanceCriteriaCount?: number
    taskReadiness?: TaskReadinessLike
  }
  sourceClaims?: unknown[]
  requestIntake?: {
    createdBy?: string
    evidenceRefs?: unknown[]
  }
}

export function taskShapingBlockers(task: TaskLike): TaskShapingBlocker[] {
  if (isTerminalTaskStatus(task.status)) return []
  const blockers: TaskShapingBlocker[] = []
  if (taskNeedsImportedBriefShaping(task)) {
    blockers.push({
      code: 'imported_brief_shaping',
      summary: 'Imported current work needs a real brief before Guildhall can build unattended.',
    })
  }
  const taskReadiness = task.taskReadiness ?? task.currentSummary?.taskReadiness
  if (taskReadiness?.recommendation === 'needs_research_spike') {
    blockers.push({
      code: 'source_recovery',
      summary: taskReadiness.summary ?? 'Guildhall needs source-backed recovery before worker handoff.',
    })
  }
  return blockers
}

export function taskNeedsImportedBriefShaping(task: TaskLike): boolean {
  if (isTerminalTaskStatus(task.status)) return false
  if (task.status === 'import_draft') return true
  if (!hasWorkspaceImportProvenance(task)) return false
  if (task.status !== 'exploring') return false
  return !taskHasBriefShape(task) || acceptanceCriteriaCount(task) === 0
}

function isTerminalTaskStatus(status: string | undefined): boolean {
  return status === 'done' || status === 'shelved' || status === 'cancelled' || status === 'archived' || status === 'pending_pr'
}

function hasWorkspaceImportProvenance(task: TaskLike): boolean {
  if (task.currentSummary?.imported === true) return true
  if (task.requestIntake?.createdBy === 'workspace-importer') return true
  if (task.requestIntake?.evidenceRefs?.some(ref => typeof ref === 'string' && /^import:/.test(ref))) return true
  if ((task.sourceClaims?.length ?? 0) > 0) return true
  return (task.notes ?? []).some(note =>
    note?.role === 'importer' ||
    note?.agentId === 'workspace-importer' ||
    note?.agentId === 'workspace-importer-agent',
  )
}

function taskHasBriefShape(task: TaskLike): boolean {
  if (task.currentSummary?.brief) return task.currentSummary.brief.shaped === true
  const brief = task.productBrief
  if (!brief) return false
  return Boolean(
    brief.userJob?.trim() ||
    brief.whyItMattersNow?.trim() ||
    brief.successMetric?.trim() ||
    brief.rolloutPlan?.trim() ||
    (brief.nonGoals?.length ?? 0) > 0 ||
    (brief.antiPatterns?.length ?? 0) > 0,
  )
}

function acceptanceCriteriaCount(task: TaskLike): number {
  if (typeof task.currentSummary?.acceptanceCriteriaCount === 'number') {
    return Math.max(0, task.currentSummary.acceptanceCriteriaCount)
  }
  return Array.isArray(task.acceptanceCriteria) ? task.acceptanceCriteria.length : 0
}

export function taskShapingBlockerLabel(code: TaskShapingBlocker['code'] | string | undefined): string {
  if (code === 'imported_brief_shaping') return 'Imported brief shaping'
  if (code === 'source_recovery') return 'Source recovery'
  return code?.replace(/[_-]/g, ' ').replace(/\b\w/g, char => char.toUpperCase()) ?? 'Shaping blocker'
}
