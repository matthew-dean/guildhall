import { taskDisplayLabel } from '@guildhall/shared'

export interface ProjectActionStartReadiness {
  canStart: boolean
  code?: string
  message?: string
  actionHref?: string
  focusTaskId?: string
  focusTaskTitle?: string
  focusKind?: string
  count?: number
  executionScope?: {
    id: string
    label: string
    kind: string
    source?: string
    taskCount?: number
    deferredTaskCount?: number
  }
}

export function isFocusedOwnerInputTaskReview(
  readiness: Pick<ProjectActionStartReadiness, 'code' | 'focusKind' | 'focusTaskId'> | null | undefined,
): boolean {
  return readiness?.code === 'owner_input_required' &&
    Boolean(readiness.focusTaskId?.trim()) &&
    readiness.focusKind !== 'setup'
}

export function projectTaskActionHref(
  readiness: Pick<ProjectActionStartReadiness, 'code' | 'focusKind' | 'focusTaskId'>,
  projectId?: string,
): string {
  const projectRoot = projectId ? `/projects/${encodeURIComponent(projectId)}` : ''
  const taskId = readiness.focusTaskId?.trim()
  const reviewInThread = readiness.focusKind === 'spec_review' ||
    isFocusedOwnerInputTaskReview(readiness)
  if (reviewInThread) {
    return taskId
      ? `${projectRoot}/thread?thread=${encodeURIComponent(`task:${taskId}`)}`
      : `${projectRoot}/thread`
  }
  return taskId
    ? `${projectRoot}/work?task=${encodeURIComponent(taskId)}`
    : `${projectRoot}/work`
}

/**
 * A saved next-action can still describe the last paused task after a run
 * starts. Keep the user-facing readiness contract aligned with the live
 * supervisor observation without rebuilding the project task projection.
 */
export function applyRunStatusToStartReadiness(
  readiness: ProjectActionStartReadiness,
  runStatus: string | undefined,
): ProjectActionStartReadiness {
  if (runStatus !== 'running' && runStatus !== 'stopping') return readiness
  const focus = readiness.focusTaskTitle?.trim()
  const action = runStatus === 'stopping' ? 'stopping' : 'running'
  return {
    ...readiness,
    canStart: true,
    code: action,
    message: runStatus === 'stopping'
      ? 'Guildhall is stopping the selected work.'
      : focus
        ? `Guildhall is running "${focus}".`
        : 'Guildhall is running the selected work.',
  }
}

export interface ProjectActionInboxItem {
  kind?: string
  severity?: 'high' | 'medium' | 'low' | string
  title?: string
  detail?: string
  taskId?: string
  actionHref?: string
  taskDescription?: string
}

export interface ProjectActionTask {
  id: string
  title?: string
  description?: string
  status?: string
  assignedTo?: string | null
  blockReason?: string
  updatedAt?: string
  dependsOn?: string[]
  productBrief?: {
    approvedAt?: string | null
    userJob?: string
    whyItMattersNow?: string
    successMetric?: string
    nonGoals?: string[]
    antiPatterns?: string[]
  }
  spec?: string
  acceptanceCriteria?: unknown[]
  needsBriefCleanup?: boolean
  hierarchy?: {
    parentId?: string | null
    childIds?: string[]
    relation?: string
  }
}

export interface ProjectWorkSummaryModel {
  total: number
  agentActive: number
  paused: number
  waiting: number
  reviewWaiting: number
  gatesWaiting: number
  shaping: number
  specRevisionQueued: number
  readyForWorker: number
  needsSpecCleanup: number
  awaitingApproval: number
  done: number
}

export interface ProjectActionThreadTurn {
  id: string
  kind?: string
  status?: string
  actionHref?: string
  sessionId?: string
  title?: string
  why?: string
  domainTitle?: string
  targetTitle?: string
  taskTitle?: string
  question?: {
    prompt?: string
    why?: string
  }
}

export interface ProjectActionThread {
  activeTurnId?: string | null
  turns?: ProjectActionThreadTurn[]
}

export interface ProjectActionScopeAuthorityRequest {
  id: string
  type?: string
  status?: 'open' | 'answered' | 'withdrawn' | string
  targetWorkId?: string
  question?: string
  whyItMatters?: string
  createdAt?: string
  createdBy?: string
}

export type ProjectActionSource = 'owner_input' | 'start_readiness' | 'task' | 'inbox' | 'thread' | 'none'
export type ProjectActionTone = 'neutral' | 'accent' | 'warn' | 'danger' | 'running'

export interface ProjectAction {
  source: ProjectActionSource
  label: string
  taskLabel?: string
  detail?: string
  content?: string
  buttonLabel: string
  href: string
  tone: ProjectActionTone
  code?: string
  taskId?: string
  inboxKind?: string
}

export interface ProjectRunControlModel {
  label: string
  startEnabled: boolean
  pauseEnabled?: boolean
  disabledReason?: string
  href?: string
}

export interface ProjectAvailabilityModel {
  status?: 'active' | 'paused' | string
}

export interface ProjectOwnerInputModel {
  active: boolean
  label?: string
  detail?: string
  href?: string
}

export interface ProjectSetupModel {
  state: 'ready' | 'blocked' | 'fresh_intake_needed'
  freshIntakeNeeded: boolean
  href?: string
  detail?: string
}

export interface ProjectActionModel {
  primaryAction: ProjectAction | null
  secondaryActions: ProjectAction[]
  runControl: ProjectRunControlModel
  ownerInput: ProjectOwnerInputModel
  setup: ProjectSetupModel
  workSummary?: ProjectWorkSummaryModel
}

export interface BuildProjectActionModelInput {
  startReadiness?: ProjectActionStartReadiness | null
  ownerInput?: ProjectOwnerInputModel | null
  inbox?: { items?: ProjectActionInboxItem[] } | null
  tasks?: ProjectActionTask[]
  summaryTasks?: ProjectActionTask[]
  thread?: ProjectActionThread | null
  scopeAuthorityRequests?: ProjectActionScopeAuthorityRequest[]
  runStatus?: string | null
  runMode?: string | null
  availability?: ProjectAvailabilityModel | null
  releaseLifecycleState?: string | null
}

function buildProjectWorkSummary(tasks: ProjectActionTask[], running: boolean): ProjectWorkSummaryModel {
  const visible = tasks.filter(task =>
    !['task-meta-intake', 'task-workspace-import'].includes(task.id) &&
    !['archived', 'cancelled'].includes(task.status ?? ''),
  )
  const tasksById = new Map(tasks.map(task => [task.id, task]))
  const waiting = (task: ProjectActionTask): boolean => {
    const dependencies = task.dependsOn ?? []
    return dependencies.length > 0 && dependencies.some(id => tasksById.get(id)?.status !== 'done')
  }
  const ready = visible.filter(task => task.status === 'ready' && !waiting(task))
  return {
    total: visible.length,
    agentActive: visible.filter(task => running && ['in_progress', 'review', 'gate_check'].includes(task.status ?? '')).length,
    paused: visible.filter(task => !running && ['exploring', 'in_progress'].includes(task.status ?? '') && !waiting(task)).length,
    waiting: visible.filter(waiting).length,
    reviewWaiting: visible.filter(task => task.status === 'review' && !waiting(task)).length,
    gatesWaiting: visible.filter(task => task.status === 'gate_check' && !waiting(task)).length,
    shaping: visible.filter(task => running && ['import_draft', 'exploring'].includes(task.status ?? '') && !waiting(task)).length,
    specRevisionQueued: 0,
    readyForWorker: ready.filter(task => !needsBriefCleanup(task)).length,
    needsSpecCleanup: ready.filter(needsBriefCleanup).length,
    awaitingApproval: visible.filter(task => task.status === 'spec_review' && !waiting(task)).length,
    done: visible.filter(task => ['done', 'pending_pr'].includes(task.status ?? '')).length,
  }
}

function hasApprovedProductBrief(task: ProjectActionTask): boolean {
  return typeof task.productBrief?.approvedAt === 'string' && task.productBrief.approvedAt.trim().length > 0
}

function hasCompleteProductBrief(task: ProjectActionTask): boolean {
  const brief = task.productBrief
  if (!brief || typeof brief !== 'object') return false
  const nonGoals = Array.isArray(brief.nonGoals) ? brief.nonGoals.filter(Boolean) : []
  const antiPatterns = Array.isArray(brief.antiPatterns) ? brief.antiPatterns.filter(Boolean) : []
  return Boolean(
    typeof brief.userJob === 'string' &&
    brief.userJob.trim().length > 0 &&
    typeof brief.whyItMattersNow === 'string' &&
    brief.whyItMattersNow.trim().length > 0 &&
    typeof brief.successMetric === 'string' &&
    brief.successMetric.trim().length > 0 &&
    (nonGoals.length > 0 || antiPatterns.length > 0),
  )
}

function hasSpecDraft(task: ProjectActionTask): boolean {
  return typeof task.spec === 'string' && task.spec.trim().length > 0 && Array.isArray(task.acceptanceCriteria) && task.acceptanceCriteria.length > 0
}

function needsBriefCleanup(task: ProjectActionTask): boolean {
  if (task.needsBriefCleanup === true) return true
  return task.status === 'ready' && !hasSpecDraft(task) && !(hasApprovedProductBrief(task) && hasCompleteProductBrief(task))
}

function taskLabel(task: ProjectActionTask): string {
  const recovered = recoverClippedTaskTitle(task)
  if (recovered) return recovered
  return taskDisplayLabel(task, task.id)
}

function recoverClippedTaskTitle(task: ProjectActionTask): string | null {
  const title = task.title?.trim()
  const description = task.description?.trim()
  if (!title || !description) return null
  const compactTitle = title.replace(/\.\.\.$/, '').trim()
  if (!title.endsWith('...') && title.length < 60) return null
  if (description.length <= title.length) return null
  if (!description.toLowerCase().startsWith(compactTitle.toLowerCase())) return null
  return description
}

function workHrefForTask(taskId: string | undefined): string {
  return taskId ? `/work?task=${encodeURIComponent(taskId)}` : '/work'
}

function startReadinessButtonLabel(readiness: ProjectActionStartReadiness): string {
  if (readiness.code === 'required_migration_pending') return 'Review project update'
  if (isProviderReadinessCode(readiness.code)) return 'Choose provider'
  if (readiness.code === 'owner_review_required') {
    return readiness.count && readiness.count > 1 ? 'Review next spec' : 'Review spec'
  }
  if (readiness.code === 'owner_input_required') {
    if (readiness.focusKind === 'brief_cleanup') return 'Review brief'
    if (readiness.focusKind === 'spec_review') return 'Review spec'
    return 'Open Thread'
  }
  if (readiness.code === 'import_drafts_waiting') return 'Review drafts'
  if (readiness.code === 'imported_scope_shaping') return 'Shape first task'
  if (readiness.code === 'workspace_import_refresh_needed') return 'Refresh import'
  if (readiness.code === 'proof_evidence_missing') return 'Attach proof'
  if (readiness.code === 'scope_source_conflict') return 'Open map'
  if (readiness.code === 'repository_followup_required') return 'Open release'
  if (readiness.code === 'ready_work') return 'Open Work'
  if (readiness.code === 'paused_live_work') return 'Open Work'
  if (readiness.code === 'no_unattended_progress') {
    if (readiness.focusKind === 'blocked_work') return 'Open Work'
    if (readiness.focusKind === 'brief_cleanup') return 'Review brief'
    if (readiness.focusKind === 'spec_review') return readiness.count && readiness.count > 1 ? 'Review next spec' : 'Review spec'
    return 'Open Work'
  }
  return 'Open item'
}

function runControlLabel(readiness: ProjectActionStartReadiness | null | undefined, running: boolean, stopping: boolean): string {
  if (stopping) return 'Stopping'
  if (running) return 'Pause'
  if (!readiness || readiness.canStart) return 'Resume'
  if (readiness.code === 'required_migration_pending') return 'Migrate'
  if (isProviderReadinessCode(readiness.code)) return 'Needs provider'
  if (readiness.code === 'all_terminal') return 'No runnable tasks'
  if (readiness.code === 'import_drafts_waiting') return 'Review drafts'
  if (readiness.code === 'imported_scope_shaping') return 'Needs shaping'
  if (readiness.code === 'workspace_import_refresh_needed') return 'Refresh import'
  if (readiness.code === 'proof_evidence_missing') return 'Resume'
  if (readiness.code === 'scope_source_conflict') return 'Review conflict'
  if (readiness.code === 'repository_followup_required') return 'Repo follow-up'
  if (readiness.code === 'paused_live_work') return 'Resume'
  if (readiness.code === 'owner_review_required') return 'Review needed'
  if (readiness.code === 'no_unattended_progress' && readiness.focusKind === 'blocked_work') return 'Needs recovery'
  if (readiness.code === 'no_unattended_progress' && readiness.focusKind === 'brief_cleanup') return 'Review brief'
  if (readiness.code === 'no_unattended_progress' && readiness.focusKind === 'spec_review') return 'Review needed'
  if (readiness.code === 'owner_input_required') return 'Needs input'
  return 'Start blocked'
}

function isProviderReadinessCode(code: string | undefined): boolean {
  return code === 'no_provider' ||
    code === 'no_loaded_model' ||
    code === 'model_unavailable' ||
    code === 'provider_unavailable'
}

function startReadinessActionLabel(readiness: ProjectActionStartReadiness): string {
  if (readiness.code === 'owner_review_required') {
    return readiness.focusTaskTitle?.trim() || 'Spec review pending'
  }
  if (readiness.code === 'owner_input_required') {
    if (readiness.focusKind === 'brief_cleanup') return readiness.focusTaskTitle?.trim() || 'Review task brief'
    if (readiness.focusKind === 'spec_review') return readiness.focusTaskTitle?.trim() || 'Review spec'
    return 'Answer in Thread'
  }
  if (readiness.code === 'ready_work') return readiness.focusTaskTitle?.trim() || readiness.message || 'Ready work'
  if (readiness.code === 'required_migration_pending') return 'Required migration'
  if (readiness.code === 'import_drafts_waiting') return 'Review imported drafts'
  if (readiness.code === 'imported_scope_shaping') return 'Imported scope needs shaping'
  if (readiness.code === 'workspace_import_refresh_needed') return 'Workspace import needs refresh'
  if (readiness.code === 'proof_evidence_missing') return readiness.focusTaskTitle?.trim() || 'Proof evidence missing'
  if (readiness.code === 'scope_source_conflict') return 'Source conflict requires review'
  if (readiness.code === 'repository_followup_required') return 'Repository follow-up required'
  if (readiness.code === 'paused_live_work') return readiness.focusTaskTitle?.trim() || 'Paused live work'
  if (isProviderReadinessCode(readiness.code)) return 'Provider unavailable'
  if (readiness.code === 'no_unattended_progress') {
    if (readiness.focusTaskTitle?.trim()) return readiness.focusTaskTitle.trim()
    if (readiness.focusKind === 'blocked_work') return 'Blocked work'
    if (readiness.focusKind === 'brief_cleanup') return 'Needs brief cleanup'
    if (readiness.focusKind === 'spec_review') return 'Spec review pending'
    return 'Nothing ready to run'
  }
  if (readiness.code === 'bootstrap_blocked') return 'Readiness blocked'
  if (readiness.code === 'invalid_lever_combo') return 'Settings blocked'
  if (readiness.code === 'runtime_too_old') return 'Update Guildhall'
  return readiness.message ?? 'Start is blocked'
}

function activeThreadTurn(thread: ProjectActionThread | null | undefined): ProjectActionThreadTurn | null {
  if (!thread?.activeTurnId) return null
  return (thread.turns ?? []).find(turn => turn.id === thread.activeTurnId && turn.status === 'active') ?? null
}

function isOwnerQuestionTurn(turn: ProjectActionThreadTurn | null | undefined): boolean {
  return Boolean(turn && ['bounded_chat', 'agent_question', 'pressure_test_question'].includes(turn.kind ?? ''))
}

function threadHref(turn: ProjectActionThreadTurn): string {
  return turn.actionHref ?? (turn.sessionId ? `/thread?thread=${encodeURIComponent(turn.sessionId)}` : '/thread')
}

function ownerInputDetail(detail: string | null | undefined): string {
  const normalized = detail?.trim()
  if (!normalized) return 'Open the thread to answer the current question.'
  if (/^from what i(?:'|’)ve seen:\s*$/i.test(normalized)) return 'Open the thread to answer the current question.'
  return normalized
}

function ownerInputFrom(readiness: ProjectActionStartReadiness | null | undefined, turn: ProjectActionThreadTurn | null): ProjectOwnerInputModel {
  if (readiness?.code === 'owner_input_required') {
    const focusedSpecReview = readiness.focusKind === 'spec_review' && readiness.focusTaskId
    return {
      active: true,
      label: startReadinessActionLabel(readiness),
      detail: ownerInputDetail(turn?.question?.prompt ?? readiness.message),
      href: focusedSpecReview
        ? taskHrefForTask(readiness.focusTaskId)
        : readiness.actionHref ?? (turn ? threadHref(turn) : '/thread'),
    }
  }
  if (!turn || !isOwnerQuestionTurn(turn)) {
    return { active: false }
  }
  return {
    active: true,
    label: 'Answer in Thread',
    detail: ownerInputDetail(turn.question?.prompt ?? turn.why ?? turn.domainTitle ?? turn.title),
    href: threadHref(turn),
  }
}

function scopeAuthorityAction(requests: ProjectActionScopeAuthorityRequest[]): ProjectAction | null {
  const request = requests.find(item => item.status === 'open')
  if (!request) return null
  const detail = ownerInputDetail(request.question ?? request.whyItMatters ?? 'Open the decision before Guildhall changes scope.')
  return {
    source: 'owner_input',
    label: 'Needs your decision',
    detail,
    buttonLabel: 'Open decision',
    href: `/overview/inbox?scopeAuthority=${encodeURIComponent(request.id)}`,
    tone: 'warn',
  }
}

function scopeAuthorityOwnerInput(requests: ProjectActionScopeAuthorityRequest[]): ProjectOwnerInputModel | null {
  const action = scopeAuthorityAction(requests)
  if (!action) return null
  return {
    active: true,
    label: action.label,
    detail: action.detail,
    href: action.href,
  }
}

function inboxButtonLabel(item: ProjectActionInboxItem): string {
  switch (item.kind) {
    case 'project_understanding': return 'Review update'
    case 'workspace_import_pending': return 'Review import'
    case 'proof_reconciliation': return 'Review proof'
    case 'bootstrap_missing': return 'Open readiness checks'
    case 'setup_pending': return 'Open setup'
    case 'import_draft_queue': return item.taskId === 'task-workspace-import' ? 'Open import review' : 'Draft task brief'
    case 'required_migration': return 'Migrate project'
    case 'lever_questions': return 'Open advanced'
    case 'spec_fill_pending': return 'Open in Thread'
    default: return 'Open'
  }
}

function inboxAction(item: ProjectActionInboxItem): ProjectAction {
  const label = item.kind === 'import_draft_queue'
    ? 'Shape the imported drafts'
    : item.kind === 'proof_reconciliation'
      ? 'Review proof records'
    : item.kind === 'bootstrap_missing'
      ? 'Verify your bootstrap commands'
      : item.title ?? 'Open project item'
  return {
    source: 'inbox',
    label,
    detail: item.detail,
    content: item.taskDescription,
    buttonLabel: inboxButtonLabel(item),
    href: item.actionHref ?? '/overview/inbox',
    tone: item.severity === 'high' ? 'danger' : 'warn',
    inboxKind: item.kind,
    taskId: item.taskId,
  }
}

function dependencyBlockedRank(task: ProjectActionTask, tasksById: ReadonlyMap<string, ProjectActionTask>): number {
  const dependencies = Array.isArray(task.dependsOn) ? task.dependsOn.filter(Boolean) : []
  if (dependencies.length === 0) return 0
  const allSatisfied = dependencies.every(dependency => {
    const dependencyTask = tasksById.get(dependency)
    return dependencyTask?.status === 'done'
  })
  return allSatisfied ? 0 : 1
}

function taskHasLiveAssignment(task: ProjectActionTask): boolean {
  return typeof task.assignedTo === 'string' && task.assignedTo.trim().length > 0
}

function taskBlockedReason(task: ProjectActionTask): string | null {
  const reason = typeof task.blockReason === 'string' ? task.blockReason.trim() : ''
  return reason.length > 0 ? reason : null
}

function hasExecutionChildren(task: ProjectActionTask, tasks: readonly ProjectActionTask[]): boolean {
  const explicitChildren = task.hierarchy?.childIds ?? []
  if (explicitChildren.length > 0) return true
  return tasks.some(candidate =>
    candidate.id !== task.id &&
    candidate.hierarchy?.parentId === task.id &&
    (
      candidate.hierarchy?.relation === 'decomposes' ||
      candidate.id.startsWith(`${task.id}-split-`)
    ),
  )
}

function bestTaskAction(tasks: ProjectActionTask[], running: boolean): ProjectAction | null {
  const priority = ['in_progress', 'review', 'gate_check', 'blocked', 'exploring', 'spec_review', 'ready', 'import_draft']
  const tasksById = new Map(tasks.map(task => [task.id, task]))
  const ranked = [...tasks]
    .filter(task => priority.includes(task.status ?? ''))
    .filter(task => !hasExecutionChildren(task, tasks))
    .sort((left, right) => {
      if (running) {
        const assignmentDelta = Number(taskHasLiveAssignment(right)) - Number(taskHasLiveAssignment(left))
        if (assignmentDelta !== 0) return assignmentDelta
      }
      const dependencyDelta = dependencyBlockedRank(left, tasksById) - dependencyBlockedRank(right, tasksById)
      if (dependencyDelta !== 0) return dependencyDelta
      const statusDelta = priority.indexOf(left.status ?? '') - priority.indexOf(right.status ?? '')
      if (statusDelta !== 0) return statusDelta
      const briefDelta = Number(needsBriefCleanup(right)) - Number(needsBriefCleanup(left))
      if (briefDelta !== 0) return briefDelta
      return (right.updatedAt ?? '').localeCompare(left.updatedAt ?? '')
    })
  const task = ranked[0]
  if (!task) return null
  const cleanup = needsBriefCleanup(task)
  const approvedBriefNeedsSpec =
    task.status === 'exploring' &&
    hasApprovedProductBrief(task) &&
    hasCompleteProductBrief(task) &&
    !hasSpecDraft(task)
  const blockedReason = taskBlockedReason(task)
  const blocked = task.status === 'blocked' || blockedReason !== null
  const currentBriefIntent = hasCompleteProductBrief(task)
    ? task.productBrief?.userJob?.trim()
    : ''
  return {
    source: 'task',
    label: taskLabel(task),
    detail: blockedReason
      ? blockedReason
      : approvedBriefNeedsSpec
      ? 'Guildhall is shaping a source-backed spec from the approved brief.'
      : cleanup
      ? 'Needs brief: finish the handoff before a worker can start.'
      : currentBriefIntent
        ? `Current brief: ${currentBriefIntent}`
        : task.description,
    buttonLabel: task.status === 'spec_review' ? 'Review spec' : 'Open Work',
    href: task.status === 'spec_review' ? taskHrefForTask(task.id) : workHrefForTask(task.id),
    tone: cleanup || blocked || task.status === 'spec_review' ? 'warn' : running ? 'running' : 'accent',
    taskId: task.id,
  }
}

function taskHrefForTask(taskId: string | undefined): string {
  return taskId ? `/task/${encodeURIComponent(taskId)}` : '/work'
}

function startReadinessAction(readiness: ProjectActionStartReadiness): ProjectAction {
  const ownerReview = readiness.code === 'owner_review_required'
  const focusedSpecReview = ownerReview || readiness.focusKind === 'spec_review'
  const runnableWork = readiness.code === 'ready_work' || readiness.code === 'paused_live_work'
  const label = ownerReview
    ? 'Review a spec'
    : runnableWork
      ? (readiness.code === 'paused_live_work' ? 'Work paused' : 'Work ready to resume')
      : startReadinessActionLabel(readiness)
  const taskLabel = ownerReview || runnableWork ? readiness.focusTaskTitle?.trim() : undefined
  // The selected task is the decision. A review-queue count is operational
  // context, not an explanation that competes with that task on every surface.
  const detail = !ownerReview && !runnableWork && readiness.message && readiness.message !== label
      ? readiness.message
      : undefined
  return {
    source: readiness.code === 'owner_input_required' ? 'owner_input' : 'start_readiness',
    label,
    ...(taskLabel ? { taskLabel } : {}),
    detail,
    buttonLabel: startReadinessButtonLabel(readiness),
    href: focusedSpecReview && readiness.focusTaskId
      ? taskHrefForTask(readiness.focusTaskId)
      : readiness.actionHref ?? (readiness.code === 'ready_work' ? workHrefForTask(readiness.focusTaskId) : '/overview'),
    tone: readiness.code === 'required_migration_pending'
      ? 'danger'
      : readiness.code === 'ready_work' || readiness.code === 'paused_live_work'
        ? 'accent'
        : 'warn',
    code: readiness.code,
    ...(readiness.focusTaskId ? { taskId: readiness.focusTaskId } : {}),
  }
}

function threadAction(turn: ProjectActionThreadTurn): ProjectAction {
  return {
    source: 'thread',
    label: 'Answer in Thread',
    detail: ownerInputDetail(turn.question?.prompt ?? turn.why ?? turn.domainTitle ?? turn.title),
    buttonLabel: 'Open Thread',
    href: threadHref(turn),
    tone: 'warn',
  }
}

function setupBlockingInboxItem(items: ProjectActionInboxItem[]): ProjectActionInboxItem | null {
  return items.find(item =>
    item.severity === 'high' &&
    ['bootstrap_missing', 'required_migration', 'setup_pending'].includes(item.kind ?? ''),
  ) ?? null
}

function setupModel(
  readiness: ProjectActionStartReadiness | null | undefined,
  tasks: ProjectActionTask[],
  turn: ProjectActionThreadTurn | null,
  blockingInboxItem: ProjectActionInboxItem | null,
): ProjectSetupModel {
  if (blockingInboxItem) {
    return {
      state: 'blocked',
      freshIntakeNeeded: false,
      href: blockingInboxItem.actionHref ?? '/overview/inbox',
      detail: blockingInboxItem.detail ?? blockingInboxItem.title,
    }
  }
  if (!readiness?.canStart && readiness?.code === 'owner_input_required') {
    if (isFocusedOwnerInputTaskReview(readiness)) {
      return { state: 'ready', freshIntakeNeeded: false }
    }
    return {
      state: 'blocked',
      freshIntakeNeeded: false,
      href: readiness.actionHref ?? (turn ? threadHref(turn) : '/thread'),
      detail: readiness.message,
    }
  }
  if (tasks.length === 0) {
    return {
      state: turn?.status === 'active' ? 'blocked' : 'fresh_intake_needed',
      freshIntakeNeeded: turn?.status !== 'active',
      href: turn ? threadHref(turn) : '/thread',
      detail: turn?.why,
    }
  }
  return { state: 'ready', freshIntakeNeeded: false }
}

export function buildProjectActionModel(input: BuildProjectActionModelInput): ProjectActionModel {
  const startReadiness = input.startReadiness ?? null
  const tasks = input.tasks ?? []
  const running = input.runStatus === 'running'
  const stopping = input.runStatus === 'stopping'
  const runActive = running || stopping
  const availabilityPaused = input.availability?.status === 'paused'
  const activeTurn = activeThreadTurn(input.thread)
  const scopeOwnerInput = scopeAuthorityOwnerInput(input.scopeAuthorityRequests ?? [])
  const ownerInput = scopeOwnerInput ?? input.ownerInput ?? ownerInputFrom(startReadiness, activeTurn)
  const inboxItems = input.inbox?.items ?? []
  const shippedTerminal = input.releaseLifecycleState === 'shipped'
  const blockingInboxItem = setupBlockingInboxItem(inboxItems)
  const setup = setupModel(startReadiness, tasks, activeTurn, blockingInboxItem)
  const workSummary = input.summaryTasks ? buildProjectWorkSummary(input.summaryTasks, runActive) : undefined
  if (shippedTerminal) {
    return {
      primaryAction: null,
      secondaryActions: [],
      runControl: {
        label: 'Release shipped',
        startEnabled: false,
        pauseEnabled: false,
        disabledReason: 'This release is complete and recorded as shipped.',
        href: '/release',
      },
      ownerInput: { active: false },
      setup: blockingInboxItem ? setup : { state: 'ready', freshIntakeNeeded: false },
      ...(workSummary ? { workSummary } : {}),
    }
  }
  const setupBlocksStart = setup.state === 'blocked' && (tasks.length === 0 || blockingInboxItem !== null)
  const setupInboxAction = blockingInboxItem ? inboxAction(blockingInboxItem) : null
  const inboxActions = (shippedTerminal ? [] : inboxItems)
    .filter(item => item.severity !== 'low')
    .filter(item => item !== blockingInboxItem)
    .map(inboxAction)
  const scopeAction = scopeAuthorityAction(input.scopeAuthorityRequests ?? [])
  const focusedRunTaskId = input.runMode === 'one_task' ? startReadiness?.focusTaskId : undefined
  const taskAction = startReadiness?.code === 'all_terminal'
    ? null
    : focusedRunTaskId
      ? bestTaskAction(tasks.filter(task => task.id === focusedRunTaskId), runActive)
      : bestTaskAction(tasks, runActive)
  const candidates: ProjectAction[] = []

  if (startReadiness?.code === 'all_terminal') {
    candidates.push({
      source: 'start_readiness',
      label: 'Release is ready',
      detail: startReadiness.message ?? 'All scoped work is complete. Review the release evidence before shipping.',
      buttonLabel: 'Open Release',
      href: '/release',
      tone: 'accent',
      code: 'release_ready',
    })
  }
  if (startReadiness && !startReadiness.canStart && startReadiness.code !== 'all_terminal') {
    candidates.push(
      startReadiness.code === 'owner_input_required' && ownerInput.href && startReadiness.focusKind !== 'spec_review'
        ? {
            ...startReadinessAction(startReadiness),
            detail: ownerInputDetail(activeTurn?.question?.prompt ?? startReadiness.message),
            href: ownerInput.href,
            buttonLabel: startReadinessButtonLabel(startReadiness),
          }
        : startReadinessAction(startReadiness),
    )
  }
  if (setupInboxAction && !runActive) candidates.push(setupInboxAction)
  // Start readiness owns whether work is runnable. Compact summaries omit
  // brief/spec detail, so task ranking must never reinterpret a ready item as
  // blocked or incomplete merely because that detail is intentionally absent.
  if (
    startReadiness?.canStart &&
    (startReadiness.code === 'ready_work' || (startReadiness.code === 'paused_live_work' && !taskAction))
  ) {
    candidates.push(startReadinessAction(startReadiness))
  }
  if (runActive && startReadiness?.focusTaskId && !taskAction) {
    candidates.push({
      source: 'start_readiness',
      label: startReadiness.focusTaskTitle?.trim() || 'Current work',
      detail: startReadiness.message,
      buttonLabel: 'Open Work',
      href: startReadiness.actionHref ?? workHrefForTask(startReadiness.focusTaskId),
      tone: 'running',
      taskId: startReadiness.focusTaskId,
    })
  }
  if (setupBlocksStart && ownerInput.href) {
    candidates.push({
      source: 'owner_input',
      label: ownerInput.label ?? 'Answer in Thread',
      detail: ownerInput.detail ?? setup.detail,
      buttonLabel: 'Open Thread',
      href: ownerInput.href,
      tone: 'warn',
    })
  }
  if (scopeAction) candidates.push(scopeAction)
  if (taskAction) candidates.push(taskAction)
  candidates.push(...inboxActions)
  if (
    activeTurn &&
    !ownerInput.active &&
    (
      isOwnerQuestionTurn(activeTurn) ||
      (activeTurn.kind === 'setup_step' && tasks.length === 0)
    )
  ) {
    candidates.push(threadAction(activeTurn))
  }
  if (ownerInput.active && !scopeAction && startReadiness?.canStart !== false && ownerInput.href && !setupBlocksStart) {
    candidates.unshift({
      source: 'owner_input',
      label: ownerInput.label ?? 'Answer in Thread',
      detail: ownerInput.detail,
      buttonLabel: 'Open Thread',
      href: ownerInput.href,
      tone: 'warn',
    })
  }

  const primaryAction = candidates[0] ?? null
  const secondaryActions = candidates
    .slice(1)
    .filter(action => {
      if (!primaryAction) return true
      if (primaryAction.taskId && action.taskId === primaryAction.taskId) return false
      return action.href !== primaryAction.href
    })
    .slice(0, 3)
  const blockedButRunnable = startReadiness?.code === 'proof_evidence_missing'
  const disabledReason = stopping
    ? 'Pause requested. Guildhall is waiting for active work to stop.'
    : !runActive && startReadiness?.canStart === false && !blockedButRunnable
      ? startReadiness.message
      : !runActive && setupBlocksStart
        ? setup.detail ?? ownerInput.detail ?? 'Finish setup before starting work.'
        : undefined
  return {
    primaryAction,
    secondaryActions,
    runControl: {
      label: setupBlocksStart && !running && !stopping
        ? 'Waiting on setup'
        : availabilityPaused && !running && !stopping
          ? 'Resume'
        : ownerInput.active && !running && !stopping
          ? 'Waiting on answer'
          : runControlLabel(startReadiness, running, stopping),
      startEnabled: availabilityPaused || running || (!stopping && (startReadiness?.canStart !== false || blockedButRunnable) && !setupBlocksStart),
      pauseEnabled: !availabilityPaused && !stopping && !setupBlocksStart,
      disabledReason,
      href: startReadiness?.actionHref ?? setup.href,
    },
    ownerInput,
    setup,
    ...(workSummary ? { workSummary } : {}),
  }
}

/**
 * A persisted action is a cache of presentation, not an independent decision
 * source. When the shared readiness result names a current action, rebuild
 * that action from the readiness contract so compact task points cannot
 * reinterpret it with missing detail.
 */
export function resolveProjectActionModel(input: {
  stored?: ProjectActionModel | null
  startReadiness?: ProjectActionStartReadiness | null
  ownerInput?: ProjectOwnerInputModel | null
  runStatus?: string | null
  runMode?: string | null
  releaseLifecycleState?: string | null
}): ProjectActionModel {
  const readiness = input.startReadiness ?? null
  if (input.releaseLifecycleState === 'shipped') {
    const resolved = buildProjectActionModel({
      startReadiness: readiness,
      ownerInput: input.ownerInput,
      runStatus: input.runStatus,
      runMode: input.runMode,
      tasks: [],
      releaseLifecycleState: input.releaseLifecycleState,
    })
    return {
      ...resolved,
      setup: input.stored?.setup ?? resolved.setup,
      ...(input.stored?.workSummary ? { workSummary: input.stored.workSummary } : {}),
    }
  }
  const hasResolvedReadiness = Boolean(readiness?.code)
  if (!hasResolvedReadiness) {
    return input.stored ?? buildProjectActionModel({
      startReadiness: readiness,
      ownerInput: input.ownerInput,
      runStatus: input.runStatus,
      runMode: input.runMode,
      tasks: [],
    })
  }
  const resolved = buildProjectActionModel({
    startReadiness: readiness,
    ownerInput: input.ownerInput,
    runStatus: input.runStatus,
    runMode: input.runMode,
    tasks: [],
    releaseLifecycleState: input.releaseLifecycleState,
  })
  const focusedTaskReview = isFocusedOwnerInputTaskReview(readiness)
  const candidateSecondaryActions = readiness?.code === 'all_terminal'
    ? resolved.secondaryActions
    : resolved.secondaryActions.length > 0
    ? resolved.secondaryActions
    : input.stored?.secondaryActions ?? []
  const secondaryActions = candidateSecondaryActions.filter(action => {
    if (!resolved.primaryAction) return true
    if (resolved.primaryAction.taskId && action.taskId === resolved.primaryAction.taskId) return false
    return action.href !== resolved.primaryAction.href
  })
  return {
    ...(input.stored ?? resolved),
    primaryAction: resolved.primaryAction,
    runControl: resolved.runControl,
    ownerInput: resolved.ownerInput,
    // Setup state depends on the task inventory, which a compact current-state
    // refresh deliberately does not reload. Keep its saved projection instead
    // of deriving a false "fresh intake" state from an empty placeholder list.
    setup: focusedTaskReview ? resolved.setup : input.stored?.setup ?? resolved.setup,
    secondaryActions,
  }
}
