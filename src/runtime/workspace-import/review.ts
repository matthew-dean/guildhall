import path from 'node:path'
import type {
  DraftContext,
  DraftGoal,
  DraftMilestone,
  DraftTask,
  WorkspaceImportDraft,
} from './hypothesis.js'

export interface WorkspaceImportExistingTask {
  title: string
  status: string
}

export interface WorkspaceImportSourceGroup {
  key: string
  label: string
  path: string | null
  areaKey: string
  areaLabel: string
  taskCount: number
  milestoneCount: number
  goalCount: number
  contextCount: number
  existingOverlapCount: number
  kind: 'tasks' | 'milestones' | 'mixed' | 'reference'
  summary: string
  taskIds: string[]
}

export interface WorkspaceImportAreaGroup {
  key: string
  label: string
  taskCount: number
  milestoneCount: number
  goalCount: number
  contextCount: number
  sourceCount: number
  sourceKeys: string[]
  summary: string
}

export interface WorkspaceImportReview {
  areaGroups: WorkspaceImportAreaGroup[]
  sourceGroups: WorkspaceImportSourceGroup[]
  totalTaskCandidates: number
  totalMilestones: number
  totalGoals: number
}

function primaryReference(
  item: { references?: readonly string[]; source: string },
): string | null {
  const first = item.references?.find((ref) => typeof ref === 'string' && ref.trim().length > 0)
  if (first) return first
  return item.source?.trim() ? item.source : null
}

function sourceKey(ref: string | null): string {
  if (!ref) return 'unknown'
  return ref.replaceAll('\\', '/')
}

function titleCaseSlug(input: string): string {
  return input
    .replace(/\.[^.]+$/, '')
    .split(/[-_]/g)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function sourceLabel(ref: string | null): string {
  if (!ref) return 'Imported notes'
  const normalized = ref.replaceAll('\\', '/')
  const base = path.basename(normalized)
  if (base === 'PROJECT_STATE.md') {
    const parent = path.basename(path.dirname(normalized))
    return `${titleCaseSlug(parent)} project state`
  }
  return titleCaseSlug(base)
}

function sourceArea(
  ref: string | null,
  projectPath?: string,
): { key: string; label: string } {
  if (!ref || !projectPath) {
    return { key: 'project', label: 'Project-wide' }
  }
  const normalizedProject = projectPath.replaceAll('\\', '/')
  const normalizedRef = ref.replaceAll('\\', '/')
  const relative = path.relative(normalizedProject, normalizedRef).replaceAll('\\', '/')
  if (!relative || relative.startsWith('..')) {
    return { key: 'project', label: 'Project-wide' }
  }
  const [head] = relative.split('/')
  if (!head || !relative.includes('/')) {
    return { key: 'project', label: 'Project-wide' }
  }
  return { key: head, label: titleCaseSlug(head) }
}

function normalizedTitle(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function summarizeGroup(group: {
  taskCount: number
  milestoneCount: number
  goalCount: number
  contextCount: number
  existingOverlapCount?: number
}): string {
  const parts: string[] = []
  if (group.taskCount > 0) {
    parts.push(`${group.taskCount} candidate task${group.taskCount === 1 ? '' : 's'}`)
  }
  if (group.milestoneCount > 0) {
    parts.push(`${group.milestoneCount} milestone${group.milestoneCount === 1 ? '' : 's'}`)
  }
  if (group.goalCount > 0) {
    parts.push(`${group.goalCount} goal${group.goalCount === 1 ? '' : 's'}`)
  }
  if (group.contextCount > 0) {
    parts.push(`${group.contextCount} reference note${group.contextCount === 1 ? '' : 's'}`)
  }
  if ((group.existingOverlapCount ?? 0) > 0) {
    parts.push(`${group.existingOverlapCount} similar item${group.existingOverlapCount === 1 ? '' : 's'} already in Guildhall`)
  }
  return parts.join(' · ')
}

function kindForGroup(group: {
  taskCount: number
  milestoneCount: number
  goalCount: number
  contextCount: number
}): WorkspaceImportSourceGroup['kind'] {
  if (group.taskCount > 0 && (group.milestoneCount > 0 || group.goalCount > 0 || group.contextCount > 0)) {
    return 'mixed'
  }
  if (group.taskCount > 0) return 'tasks'
  if (group.milestoneCount > 0) return 'milestones'
  return 'reference'
}

export function buildWorkspaceImportReview(
  draft: WorkspaceImportDraft,
  existingTasks: readonly WorkspaceImportExistingTask[] = [],
  projectPath?: string,
): WorkspaceImportReview {
  const existingTitles = new Set(existingTasks.map(task => normalizedTitle(task.title)))
  const byKey = new Map<string, Omit<WorkspaceImportSourceGroup, 'summary' | 'kind'> & {
    taskTitles: string[]
  }>()
  const byArea = new Map<string, Omit<WorkspaceImportAreaGroup, 'summary'> & {
    sourceKeySet: Set<string>
  }>()

  const ensure = (ref: string | null) => {
    const key = sourceKey(ref)
    let group = byKey.get(key)
    if (!group) {
      const area = sourceArea(ref, projectPath)
      group = {
        key,
        label: sourceLabel(ref),
        path: ref,
        areaKey: area.key,
        areaLabel: area.label,
        taskCount: 0,
        milestoneCount: 0,
        goalCount: 0,
        contextCount: 0,
        existingOverlapCount: 0,
        taskIds: [],
        taskTitles: [],
      }
      byKey.set(key, group)
    }
    return group
  }

  const ensureArea = (group: ReturnType<typeof ensure>) => {
    let area = byArea.get(group.areaKey)
    if (!area) {
      area = {
        key: group.areaKey,
        label: group.areaLabel,
        taskCount: 0,
        milestoneCount: 0,
        goalCount: 0,
        contextCount: 0,
        sourceCount: 0,
        sourceKeys: [],
        sourceKeySet: new Set<string>(),
      }
      byArea.set(group.areaKey, area)
    }
    if (!area.sourceKeySet.has(group.key)) {
      area.sourceKeySet.add(group.key)
      area.sourceKeys.push(group.key)
      area.sourceCount += 1
    }
    return area
  }

  const pushTask = (task: DraftTask) => {
    const ref = primaryReference(task)
    const group = ensure(ref)
    const area = ensureArea(group)
    group.taskCount += 1
    area.taskCount += 1
    group.taskIds.push(task.suggestedId)
    group.taskTitles.push(task.title)
    if (existingTitles.has(normalizedTitle(task.title))) {
      group.existingOverlapCount += 1
    }
  }
  const pushGoal = (goal: DraftGoal) => {
    const group = ensure(primaryReference(goal))
    const area = ensureArea(group)
    group.goalCount += 1
    area.goalCount += 1
  }
  const pushMilestone = (milestone: DraftMilestone) => {
    const group = ensure(primaryReference(milestone))
    const area = ensureArea(group)
    group.milestoneCount += 1
    area.milestoneCount += 1
  }
  const pushContext = (ctx: DraftContext) => {
    const group = ensure(primaryReference(ctx))
    const area = ensureArea(group)
    group.contextCount += 1
    area.contextCount += 1
  }

  draft.tasks.forEach(pushTask)
  draft.goals.forEach(pushGoal)
  draft.milestones.forEach(pushMilestone)
  draft.context.forEach(pushContext)

  const sourceGroups: WorkspaceImportSourceGroup[] = [...byKey.values()]
    .map(group => ({
      key: group.key,
      label: group.label,
      path: group.path,
      areaKey: group.areaKey,
      areaLabel: group.areaLabel,
      taskCount: group.taskCount,
      milestoneCount: group.milestoneCount,
      goalCount: group.goalCount,
      contextCount: group.contextCount,
      existingOverlapCount: group.existingOverlapCount,
      taskIds: group.taskIds,
      kind: kindForGroup(group),
      summary: summarizeGroup(group),
    }))
    .sort((a, b) => {
      const byTasks = b.taskCount - a.taskCount
      if (byTasks !== 0) return byTasks
      const byMilestones = b.milestoneCount - a.milestoneCount
      if (byMilestones !== 0) return byMilestones
      return a.label.localeCompare(b.label)
    })

  const areaGroups: WorkspaceImportAreaGroup[] = [...byArea.values()]
    .map(area => ({
      key: area.key,
      label: area.label,
      taskCount: area.taskCount,
      milestoneCount: area.milestoneCount,
      goalCount: area.goalCount,
      contextCount: area.contextCount,
      sourceCount: area.sourceCount,
      sourceKeys: area.sourceKeys,
      summary: summarizeGroup(area),
    }))
    .sort((a, b) => {
      const byTasks = b.taskCount - a.taskCount
      if (byTasks !== 0) return byTasks
      const bySources = b.sourceCount - a.sourceCount
      if (bySources !== 0) return bySources
      return a.label.localeCompare(b.label)
    })

  return {
    areaGroups,
    sourceGroups,
    totalTaskCandidates: draft.tasks.length,
    totalMilestones: draft.milestones.length,
    totalGoals: draft.goals.length,
  }
}

export function filterWorkspaceImportDraft(
  draft: WorkspaceImportDraft,
  opts: {
    sourceKeys?: readonly string[]
    taskIds?: readonly string[]
  },
): WorkspaceImportDraft {
  const sourceKeys = opts.sourceKeys ? new Set(opts.sourceKeys) : null
  const taskIds = opts.taskIds ? new Set(opts.taskIds) : null
  const includeBySource = (item: { references?: readonly string[]; source: string }): boolean => {
    if (!sourceKeys || sourceKeys.size === 0) return true
    return sourceKeys.has(sourceKey(primaryReference(item)))
  }
  const tasks = draft.tasks.filter(task => includeBySource(task) && (!taskIds || taskIds.has(task.suggestedId)))
  const goals = draft.goals.filter(includeBySource)
  const milestones = draft.milestones.filter(includeBySource)
  const context = draft.context.filter(includeBySource)

  return {
    ...draft,
    tasks,
    goals,
    milestones,
    context,
    stats: {
      ...draft.stats,
      drafted: goals.length + tasks.length + milestones.length + context.length,
    },
  }
}
