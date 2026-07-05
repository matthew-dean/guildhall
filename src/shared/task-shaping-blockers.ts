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
}

export function taskShapingBlockers(task: TaskLike): TaskShapingBlocker[] {
  const blockers: TaskShapingBlocker[] = []
  if (taskNeedsImportedBriefShaping(task)) {
    blockers.push({
      code: 'imported_brief_shaping',
      summary: 'Imported current work needs a real brief before Guildhall can build unattended.',
    })
  }
  if (task.taskReadiness?.recommendation === 'needs_research_spike') {
    blockers.push({
      code: 'source_recovery',
      summary: task.taskReadiness.summary ?? 'Guildhall needs source-backed recovery before worker handoff.',
    })
  }
  return blockers
}

export function taskNeedsImportedBriefShaping(task: TaskLike): boolean {
  if (task.status === 'import_draft') return true
  if (!hasWorkspaceImportProvenance(task)) return false
  if (task.status !== 'exploring') return false
  return !taskHasBriefShape(task) || !task.acceptanceCriteria?.length
}

function hasWorkspaceImportProvenance(task: TaskLike): boolean {
  return (task.notes ?? []).some(note =>
    note?.role === 'importer' ||
    note?.agentId === 'workspace-importer' ||
    note?.agentId === 'workspace-importer-agent',
  )
}

function taskHasBriefShape(task: TaskLike): boolean {
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

export function taskShapingBlockerLabel(code: TaskShapingBlocker['code'] | string | undefined): string {
  if (code === 'imported_brief_shaping') return 'Imported brief shaping'
  if (code === 'source_recovery') return 'Source recovery'
  return code?.replace(/[_-]/g, ' ').replace(/\b\w/g, char => char.toUpperCase()) ?? 'Shaping blocker'
}
