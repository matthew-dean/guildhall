import type { ExecutionPlanAction, Task, TaskQueue } from '@guildhall/core'

export interface SplitWorkDraft {
  id: string
  title: string
  description: string
  domain?: string
  priority?: Task['priority']
  dependsOn?: string[]
  workKind?: Task['workKind']
  workVisibility?: Task['workVisibility']
}

export type ApplyExecutionPlanActionResult =
  | { status: 'applied'; action: ExecutionPlanAction; childTaskIds: string[] }
  | { status: 'failed'; action: ExecutionPlanAction; reason: string }
  | { status: 'noop'; reason: string }

export interface ApplyExecutionPlanActionOptions {
  now: string
  actor: string
  childWork?: SplitWorkDraft[]
}

export function applyExecutionPlanAction(
  queue: TaskQueue,
  actionId: string,
  options: ApplyExecutionPlanActionOptions,
): ApplyExecutionPlanActionResult {
  const action = queue.executionPlanActions?.find(candidate => candidate.id === actionId)
  if (!action) return { status: 'noop', reason: `Execution action ${actionId} was not found.` }
  if (action.status === 'applied') {
    return { status: 'applied', action, childTaskIds: action.createdChildIds }
  }
  if (action.status === 'failed' || action.status === 'superseded') {
    return { status: 'noop', reason: `Execution action ${actionId} is ${action.status}.` }
  }
  if (action.authority !== 'execution_planning') {
    return failAction(action, options, `Execution action ${actionId} does not have execution-planning authority.`)
  }

  if (action.type !== 'split_work') {
    return failAction(action, options, `Execution action type ${action.type} is not implemented yet.`)
  }

  return applySplitWorkAction(queue, action, options)
}

function applySplitWorkAction(
  queue: TaskQueue,
  action: ExecutionPlanAction,
  options: ApplyExecutionPlanActionOptions,
): ApplyExecutionPlanActionResult {
  const parent = queue.tasks.find(task => task.id === action.targetWorkId)
  if (!parent) {
    return failAction(action, options, `Target work ${action.targetWorkId} was not found.`)
  }
  const drafts = options.childWork ?? []
  if (drafts.length === 0) {
    return failAction(action, options, `Split action ${action.id} has no child work to apply.`)
  }

  const validationError = validateSplitDrafts(queue, drafts)
  if (validationError) return failAction(action, options, validationError)

  const childTasks = drafts.map((draft, index): Task => ({
    id: draft.id,
    title: draft.title,
    description: draft.description,
    domain: draft.domain ?? parent.domain,
    projectPath: parent.projectPath,
    references: [],
    sourceClaims: [],
    status: 'ready',
    priority: draft.priority ?? parent.priority,
    acceptanceCriteria: [],
    outOfScope: [],
    dependsOn: draft.dependsOn ?? [],
    notes: [{
      agentId: options.actor,
      role: 'coordinator',
      content: `Created by execution-planning action ${action.id}.`,
      timestamp: options.now,
    }],
    gateResults: [],
    reviewVerdicts: [],
    adjudications: [],
    escalations: [],
    agentIssues: [],
    origination: 'agent',
    revisionCount: 0,
    remediationAttempts: 0,
    hierarchy: {
      parentId: parent.id,
      childIds: [],
      order: index,
      relation: 'decomposes',
    },
    workKind: draft.workKind ?? 'implementation',
    workVisibility: draft.workVisibility ?? { kind: 'supporting', countInProjectTotals: true },
    createdAt: options.now,
    updatedAt: options.now,
  }))

  const existingChildIds = parent.hierarchy?.childIds ?? []
  const childTaskIds = childTasks.map(task => task.id)
  queue.tasks.push(...childTasks)
  parent.hierarchy = {
    ...(parent.hierarchy ?? {}),
    childIds: [...new Set([...existingChildIds, ...childTaskIds])],
    order: parent.hierarchy?.order ?? 0,
    relation: parent.hierarchy?.relation ?? 'contains',
  }
  parent.updatedAt = options.now
  action.status = 'applied'
  action.createdChildIds = childTaskIds
  action.appliedAt = options.now
  action.appliedBy = options.actor
  action.failureReason = undefined
  return { status: 'applied', action, childTaskIds }
}

function validateSplitDrafts(queue: TaskQueue, drafts: SplitWorkDraft[]): string | null {
  const ids = drafts.map(draft => draft.id.trim()).filter(Boolean)
  if (ids.length !== drafts.length) return 'Every split child needs a stable id.'
  const duplicateDraftId = ids.find((id, index) => ids.indexOf(id) !== index)
  if (duplicateDraftId) return `Split child id ${duplicateDraftId} is duplicated.`
  const existingId = ids.find(id => queue.tasks.some(task => task.id === id))
  if (existingId) return `Split child id ${existingId} already exists.`
  const untitled = drafts.find(draft => draft.title.trim().length === 0)
  if (untitled) return `Split child id ${untitled.id} needs a title.`
  return null
}

function failAction(
  action: ExecutionPlanAction,
  options: ApplyExecutionPlanActionOptions,
  reason: string,
): ApplyExecutionPlanActionResult {
  action.status = 'failed'
  action.failureReason = reason
  action.appliedAt = options.now
  action.appliedBy = options.actor
  return { status: 'failed', action, reason }
}
