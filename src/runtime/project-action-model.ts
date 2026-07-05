import { taskDisplayLabel } from '../shared/task-display-label.js'

export interface ProjectActionStartReadiness {
  canStart: boolean
  code?: string
  message?: string
  actionHref?: string
  focusTaskId?: string
  focusTaskTitle?: string
  focusKind?: string
  count?: number
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
}

export interface BuildProjectActionModelInput {
  startReadiness?: ProjectActionStartReadiness | null
  inbox?: { items?: ProjectActionInboxItem[] } | null
  tasks?: ProjectActionTask[]
  thread?: ProjectActionThread | null
  scopeAuthorityRequests?: ProjectActionScopeAuthorityRequest[]
  runStatus?: string | null
  availability?: ProjectAvailabilityModel | null
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
  if (readiness.code === 'required_migration_pending') return 'Migrate project'
  if (isProviderReadinessCode(readiness.code)) return 'Choose provider'
  if (readiness.code === 'owner_input_required') {
    return /question|answer/i.test(readiness.message ?? '') ? 'Open Thread' : 'Open item'
  }
  if (readiness.code === 'import_drafts_waiting') return 'Review drafts'
  if (readiness.code === 'imported_scope_shaping') return 'Draft first brief'
  if (readiness.code === 'proof_evidence_missing') return 'Attach proof'
  if (readiness.code === 'paused_live_work') return 'Open Work'
  if (readiness.code === 'no_unattended_progress') {
    if (readiness.focusKind === 'brief_cleanup') return 'Review brief'
    if (readiness.focusKind === 'spec_review') return readiness.count && readiness.count > 1 ? 'Review next spec' : 'Review spec'
    const message = readiness.message ?? ''
    if (/brief/i.test(message)) return 'Review brief'
    if (/spec|review|approve/i.test(message)) return pluralSpecReviewMessage(message) ? 'Review next spec' : 'Review spec'
    return 'Open Work'
  }
  return 'Open item'
}

function pluralSpecReviewMessage(message: string): boolean {
  return /\b\d+\s+specs\b/i.test(message)
}

function runControlLabel(readiness: ProjectActionStartReadiness | null | undefined, running: boolean): string {
  if (running) return 'Pause'
  if (!readiness || readiness.canStart) return 'Resume'
  const message = readiness.message ?? ''
  if (readiness.code === 'required_migration_pending') return 'Migrate'
  if (isProviderReadinessCode(readiness.code)) return 'Needs provider'
  if (readiness.code === 'all_terminal') return 'No runnable tasks'
  if (readiness.code === 'imported_scope_shaping') return 'Needs briefs'
  if (readiness.code === 'proof_evidence_missing') return 'Needs proof'
  if (readiness.code === 'paused_live_work') return 'Resume'
  if (readiness.code === 'no_unattended_progress' && readiness.focusKind === 'brief_cleanup') return 'Review brief'
  if (readiness.code === 'no_unattended_progress' && readiness.focusKind === 'spec_review') return 'Review needed'
  if (/question|answer/i.test(message)) return 'Waiting on answer'
  if (/recover|blocked|escalation/i.test(message)) return 'Needs recovery'
  if (/draft/i.test(message)) return 'Review drafts'
  if (/brief/i.test(message)) return 'Review brief'
  if (/review|approve/i.test(message)) return 'Review needed'
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
  if (readiness.code === 'required_migration_pending') return 'Required migration'
  if (readiness.code === 'import_drafts_waiting') return 'Review imported drafts'
  if (readiness.code === 'imported_scope_shaping') return 'Imported scope needs briefs'
  if (readiness.code === 'proof_evidence_missing') return readiness.focusTaskTitle?.trim() || 'Proof evidence missing'
  if (readiness.code === 'paused_live_work') return readiness.focusTaskTitle?.trim() || 'Paused live work'
  if (isProviderReadinessCode(readiness.code)) return 'Provider unavailable'
  if (readiness.code === 'no_unattended_progress') {
    if (readiness.focusTaskTitle?.trim()) return readiness.focusTaskTitle.trim()
    if (readiness.focusKind === 'brief_cleanup') return 'Needs brief cleanup'
    if (readiness.focusKind === 'spec_review') return 'Spec review pending'
    const message = readiness.message ?? ''
    if (/brief/i.test(message)) return 'Needs brief cleanup'
    if (/spec|review|approve/i.test(message)) return 'Review waiting specs'
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
    return {
      active: true,
      label: 'Answer in Thread',
      detail: ownerInputDetail(turn?.question?.prompt ?? readiness.message),
      href: readiness.actionHref ?? (turn ? threadHref(turn) : '/thread'),
    }
  }
  if (!isOwnerQuestionTurn(turn)) {
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

function bestTaskAction(tasks: ProjectActionTask[], running: boolean): ProjectAction | null {
  const priority = ['in_progress', 'review', 'gate_check', 'blocked', 'exploring', 'spec_review', 'ready', 'import_draft']
  const tasksById = new Map(tasks.map(task => [task.id, task]))
  const ranked = [...tasks]
    .filter(task => priority.includes(task.status ?? ''))
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
  return {
    source: 'task',
    label: taskLabel(task),
    detail: task.status === 'blocked' && task.blockReason?.trim()
      ? task.blockReason.trim()
      : cleanup
      ? 'Needs brief: finish the handoff before a worker can start.'
      : task.description,
    buttonLabel: task.status === 'spec_review' ? 'Review in Thread' : 'Open Work',
    href: task.status === 'spec_review' ? threadHrefForTask(task.id) : workHrefForTask(task.id),
    tone: cleanup || task.status === 'blocked' || task.status === 'spec_review' ? 'warn' : running ? 'running' : 'accent',
    taskId: task.id,
  }
}

function threadHrefForTask(taskId: string | undefined): string {
  return taskId ? `/thread?thread=${encodeURIComponent(`task:${taskId}`)}` : '/thread'
}

function startReadinessAction(readiness: ProjectActionStartReadiness): ProjectAction {
  const label = readiness.code === 'owner_input_required' ? 'Answer in Thread' : startReadinessActionLabel(readiness)
  const detail = readiness.message && readiness.message !== label ? readiness.message : undefined
  return {
    source: readiness.code === 'owner_input_required' ? 'owner_input' : 'start_readiness',
    label,
    detail,
    buttonLabel: startReadinessButtonLabel(readiness),
    href: readiness.actionHref ?? '/overview',
    tone: readiness.code === 'required_migration_pending' ? 'danger' : 'warn',
    code: readiness.code,
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

function setupModel(readiness: ProjectActionStartReadiness | null | undefined, tasks: ProjectActionTask[], turn: ProjectActionThreadTurn | null): ProjectSetupModel {
  if (!readiness?.canStart && readiness?.code === 'owner_input_required') {
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
  const availabilityPaused = input.availability?.status === 'paused'
  const activeTurn = activeThreadTurn(input.thread)
  const scopeOwnerInput = scopeAuthorityOwnerInput(input.scopeAuthorityRequests ?? [])
  const ownerInput = scopeOwnerInput ?? ownerInputFrom(startReadiness, activeTurn)
  const setup = setupModel(startReadiness, tasks, activeTurn)
  const setupBlocksStart = setup.state === 'blocked' && tasks.length === 0
  const inboxActions = (input.inbox?.items ?? [])
    .filter(item => item.severity !== 'low')
    .map(inboxAction)
  const scopeAction = scopeAuthorityAction(input.scopeAuthorityRequests ?? [])
  const taskAction = bestTaskAction(tasks, running)
  const candidates: ProjectAction[] = []

  if (startReadiness && !startReadiness.canStart && startReadiness.code !== 'all_terminal') {
    candidates.push(
      startReadiness.code === 'owner_input_required' && ownerInput.href
        ? {
            ...startReadinessAction(startReadiness),
            detail: ownerInputDetail(activeTurn?.question?.prompt ?? startReadiness.message),
            href: ownerInput.href,
            buttonLabel: 'Open Thread',
          }
        : startReadinessAction(startReadiness),
    )
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
  const secondaryActions = candidates.slice(1, 4)
  const disabledReason = !running && startReadiness?.canStart === false
    ? startReadiness.message
    : !running && setupBlocksStart
      ? setup.detail ?? ownerInput.detail ?? 'Finish setup before starting work.'
      : undefined
  return {
    primaryAction,
    secondaryActions,
    runControl: {
      label: setupBlocksStart && !running ? 'Waiting on setup' : runControlLabel(startReadiness, running),
      startEnabled: running || availabilityPaused || (startReadiness?.canStart !== false && !setupBlocksStart),
      disabledReason,
      href: startReadiness?.actionHref ?? setup.href,
    },
    ownerInput,
    setup,
  }
}
