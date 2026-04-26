/**
 * Thread aggregator — the linear "structured chat" surface.
 *
 * Whereas Notifications is the *non-linear* feed of asynchronous interrupts
 * (provider dropped, escalation, lever drift), Thread is the **chronological
 * transcript of interaction cards** between the user and the agent collective.
 * It is the answer to "where do I start?" — the bottom of the feed always
 * carries the one open turn (if any), and prior turns scroll up as read-only
 * context.
 *
 * Turn shape mirrors a chat conversation:
 *  - persona       — which agent "spoke" ('intake', 'spec', 'worker', 'coord')
 *  - at            — ISO timestamp the turn was produced
 *  - status        — 'done' | 'active' | 'pending' (only one 'active' at a time)
 *  - kind-specific body + answer/affordance shape
 *
 * Source of truth is on-disk: onboard wizard progress, TASKS.json. No hidden
 * state lives in the Thread — it's a pure projection.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildSnapshot,
  buildTaskSnapshot,
  onboardWizard,
  progressFor,
  progressForTask,
  specFillWizard,
  type ProjectSnapshot,
} from './wizards.js'
import { parseCoordinatorDraft } from './meta-intake.js'

// ---------------------------------------------------------------------------
// Turn shape
// ---------------------------------------------------------------------------

export type TurnPersona = 'intake' | 'spec' | 'worker' | 'coord' | 'system'
export type TurnStatus = 'done' | 'active' | 'pending'
export type TurnPhase = 'setup' | 'intake' | 'spec' | 'inflight' | 'blocked' | 'done'
export type SetupAffordance =
  | 'link'
  | 'inline-text'
  | 'inline-textarea'
  | 'inline-button'
  | 'inline-choice'

interface TurnBase {
  id: string
  at: string
  persona: TurnPersona
  status: TurnStatus
  phase: TurnPhase
}

/**
 * Setup step rendered as a chat turn. Simple setup work is handled inline so
 * Thread owns the setup flow; only genuinely separate flows link out.
 */
export interface SetupStepTurn extends TurnBase {
  kind: 'setup_step'
  stepId: string
  title: string
  why: string
  skippable: boolean
  affordance: SetupAffordance
  actionLabel: string
  actionHref?: string | undefined
  submitEndpoint?: string | undefined
  currentValue?: string | undefined
  placeholder?: string | undefined
  choices?: Array<{ value: string; label: string }> | undefined
}

/**
 * Brief approval / reply. Mirrors the Spec drawer card but lives in the feed.
 */
export interface BriefTurn extends TurnBase {
  kind: 'brief_approval'
  taskId: string
  taskTitle: string
  brief: {
    userJob?: string | undefined
    successMetric?: string | undefined
    successCriteria?: string | undefined
    antiPatterns?: string[] | undefined
    rolloutPlan?: string | undefined
    authoredBy?: string | undefined
  }
  liveAgent?: { name: string; startedAt?: string | undefined } | undefined
  approvedAt?: string | null | undefined
}

/**
 * Discriminated agent-question (confirm | yesno | choice | text). The web
 * client renders `<AgentQuestion>` for each. Answer posts to the task's
 * answer-question endpoint.
 */
export interface AgentQuestionTurn extends TurnBase {
  kind: 'agent_question'
  taskId: string
  taskTitle: string
  liveAgent?: { name: string; startedAt?: string | undefined } | undefined
  // Mirrors AgentQuestion union from src/core/task.ts; kept loose here so the
  // server doesn't have to re-import the zod schema for projection.
  question: {
    kind: 'confirm' | 'yesno' | 'choice' | 'text'
    id: string
    askedBy: string
    askedAt: string
    answeredAt?: string | undefined
    answer?: string | undefined
    restatement?: string | undefined
    prompt?: string | undefined
    choices?: string[] | undefined
    selectionMode?: 'single' | 'multiple' | undefined
  }
}

/** Spec ready for the user to approve / revise. */
export interface SpecReviewTurn extends TurnBase {
  kind: 'spec_review'
  taskId: string
  taskTitle: string
  spec: string
  draftCoordinators?: Array<{
    id: string
    name: string
    domain: string
    path?: string | undefined
    mandate: string
    concerns: Array<{ id: string }>
  }> | undefined
}

/** Worker escalated; needs human input. */
export interface EscalationTurn extends TurnBase {
  kind: 'escalation'
  taskId: string
  taskTitle: string
  escalationId: string
  summary: string
  details?: string | undefined
}

/** Task is currently running; informational, no user action required. */
export interface InFlightTurn extends TurnBase {
  kind: 'inflight'
  taskId: string
  taskTitle: string
  taskStatus?: string | undefined
  summary: string
  liveAgent?: {
    name: string
    startedAt?: string | undefined
  } | undefined
  checklist?: {
    title: string
    doneCount: number
    totalSteps: number
    activeStepId: string | null
    steps: Array<{
      id: string
      title: string
      why: string
      status: 'done' | 'active' | 'pending' | 'skipped'
    }>
  } | undefined
}

export type ThreadTurn =
  | SetupStepTurn
  | BriefTurn
  | AgentQuestionTurn
  | SpecReviewTurn
  | EscalationTurn
  | InFlightTurn

export interface Thread {
  /** Chronological — earliest first. The last turn with status='active' is the cursor. */
  turns: ThreadTurn[]
  /** Convenience: id of the single active turn, if any. */
  activeTurnId: string | null
  /** Whether ALL turns are done (used by UI to show "all caught up"). */
  caughtUp: boolean
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

export interface BuildThreadOptions {
  projectPath: string
  /** Optional pre-built snapshot (lets callers share one snapshot per request). */
  snapshot?: ProjectSnapshot
  /** Recent supervisor events, used only for live "agent is currently busy" hints. */
  recentEvents?: Array<{
    at?: string | undefined
    event?: {
      type?: string | undefined
      task_id?: string | null | undefined
      agent_name?: string | null | undefined
    } | undefined
  }>
}

function readJsonSafe(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

function tasksArray(raw: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(raw)) return raw as Array<Record<string, unknown>>
  if (raw && typeof raw === 'object' && Array.isArray((raw as { tasks?: unknown }).tasks)) {
    return (raw as { tasks: Array<Record<string, unknown>> }).tasks
  }
  return []
}

function stripMarkdown(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/[*_~#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function guessedProjectDirection(projectPath: string): string {
  const readmePath = join(projectPath, 'README.md')
  if (!existsSync(readmePath)) return ''
  try {
    const raw = readFileSync(readmePath, 'utf8')
    const lines = raw.split(/\r?\n/)
    const title = stripMarkdown(lines.find(line => line.trim().startsWith('# '))?.replace(/^#\s+/, '') ?? '')
    const body = lines
      .map(line => stripMarkdown(line))
      .filter(line =>
        line.length > 0 &&
        !line.startsWith('!') &&
        !/^status\s*:/i.test(line) &&
        !/^[-*]\s/.test(line),
      )
      .find(line => title ? line.toLowerCase() !== title.toLowerCase() : true)
    const parts = [
      title ? `${title} is this project.` : '',
      body ? `From the README, the project appears to be about ${body.charAt(0).toLowerCase()}${body.slice(1)}` : '',
      'Review or replace this guess so Guildhall routes future tasks with the right product intent.',
    ].filter(Boolean)
    return parts.join(' ')
  } catch {
    return ''
  }
}

function specFillChecklist(
  projectPath: string,
  task: Record<string, unknown>,
): InFlightTurn['checklist'] {
  const taskForSnapshot: Parameters<typeof buildTaskSnapshot>[0]['task'] = {}
  if (typeof task.id === 'string') taskForSnapshot.id = task.id
  if (typeof task.title === 'string') taskForSnapshot.title = task.title
  if (typeof task.description === 'string') taskForSnapshot.description = task.description
  if (typeof task.status === 'string') taskForSnapshot.status = task.status
  if (typeof task.spec === 'string') taskForSnapshot.spec = task.spec
  if (task.productBrief && typeof task.productBrief === 'object') {
    taskForSnapshot.productBrief = task.productBrief as {
      userJob?: string
      successCriteria?: string
      successMetric?: string
      approvedAt?: string | null
    }
  }
  if (Array.isArray(task.acceptanceCriteria)) {
    taskForSnapshot.acceptanceCriteria = task.acceptanceCriteria
  }
  const snap = buildTaskSnapshot({
    projectPath,
    task: taskForSnapshot,
  })
  if (!specFillWizard.applicable(snap)) return undefined
  const progress = progressForTask(specFillWizard, snap)
  return {
    title: progress.title,
    doneCount: progress.doneCount,
    totalSteps: progress.totalSteps,
    activeStepId: progress.activeStepId,
    steps: progress.steps.map(step => ({
      id: step.id,
      title: step.title,
      why: step.why,
      status:
        step.status === 'pending' && step.id === progress.activeStepId
          ? 'active'
          : step.status,
    })),
  }
}

type SetupAction = Omit<
  SetupStepTurn,
  keyof TurnBase | 'kind' | 'stepId' | 'title' | 'why' | 'skippable'
>

const SETUP_STEP_ACTIONS: Record<string, SetupAction> = {
  identity: {
    affordance: 'inline-text',
    actionLabel: 'Save',
    submitEndpoint: '/api/setup/identity',
    placeholder: 'Project name',
  },
  provider: {
    affordance: 'link',
    actionLabel: 'Connect',
    actionHref: '/providers',
  },
  bootstrap: {
    affordance: 'inline-button',
    actionLabel: 'Verify',
    submitEndpoint: '/api/project/bootstrap/run',
  },
  coordinator: {
    affordance: 'inline-choice',
    actionLabel: 'Add',
    submitEndpoint: '/api/project/coordinators/seed',
    choices: [
      { value: 'tech', label: 'Tech' },
      { value: 'product', label: 'Product' },
      { value: 'qa', label: 'QA' },
    ],
  },
  direction: {
    affordance: 'inline-textarea',
    actionLabel: 'Save',
    submitEndpoint: '/api/project/brief',
    placeholder: 'Project direction',
  },
  workspaceImport: {
    affordance: 'link',
    actionLabel: 'Review',
    actionHref: '/workspace-import',
  },
  firstTask: {
    affordance: 'inline-text',
    actionLabel: 'Create',
    submitEndpoint: '/api/project/intake',
    placeholder: 'First task',
  },
}

function setupCurrentValue(stepId: string, snap: ProjectSnapshot, projectPath: string): string | undefined {
  if (stepId === 'identity') return snap.config?.name ?? ''
  if (stepId !== 'direction') return undefined
  const briefPath = join(projectPath, 'memory', 'project-brief.md')
  if (!existsSync(briefPath)) return guessedProjectDirection(projectPath)
  try {
    const existing = readFileSync(briefPath, 'utf8').trim()
    return existing || guessedProjectDirection(projectPath)
  } catch {
    return guessedProjectDirection(projectPath)
  }
}

function phaseForTurn(turn: ThreadTurn): TurnPhase {
  if (turn.status === 'done') return 'done'
  switch (turn.kind) {
    case 'setup_step':
      return 'setup'
    case 'brief_approval':
    case 'agent_question':
      return 'intake'
    case 'spec_review':
      return turn.status === 'active' ? 'spec' : 'intake'
    case 'escalation':
      return 'blocked'
    case 'inflight':
      if (turn.taskStatus === 'exploring') return 'intake'
      return 'inflight'
  }
}

function friendlyAgentName(agentName: string | undefined): string {
  switch (agentName) {
    case 'spec-agent': return 'Spec author'
    case 'worker-agent': return 'Worker'
    case 'reviewer-agent': return 'Reviewer'
    case 'gate-checker-agent': return 'Gate checker'
    default: return agentName?.trim() || 'Agent'
  }
}

function personaForAgent(agentName: string | undefined): TurnPersona | null {
  switch (agentName) {
    case 'spec-agent': return 'spec'
    case 'worker-agent': return 'worker'
    case 'reviewer-agent':
    case 'gate-checker-agent':
      return 'coord'
    default:
      return null
  }
}

function liveAgentsByTask(events: BuildThreadOptions['recentEvents']): Map<string, { name: string; startedAt?: string | undefined }> {
  const live = new Map<string, { name: string; startedAt?: string | undefined }>()
  for (const envelope of events ?? []) {
    const ev = envelope.event
    const taskId = typeof ev?.task_id === 'string' ? ev.task_id : null
    if (!taskId) continue
    if (ev?.type === 'agent_started') {
      live.set(taskId, {
        name: typeof ev.agent_name === 'string' ? ev.agent_name : 'agent',
        startedAt: envelope.at,
      })
    } else if (
      ev?.type === 'agent_finished' ||
      ev?.type === 'task_transition' ||
      ev?.type === 'escalation_raised' ||
      ev?.type === 'error'
    ) {
      live.delete(taskId)
    }
  }
  return live
}

export function buildThread(opts: BuildThreadOptions): Thread {
  const snap = opts.snapshot ?? buildSnapshot({ projectPath: opts.projectPath })
  const turns: ThreadTurn[] = []
  const tasksPath = join(opts.projectPath, 'memory', 'TASKS.json')
  const tasks = existsSync(tasksPath) ? tasksArray(readJsonSafe(tasksPath)) : []
  const liveAgents = liveAgentsByTask(opts.recentEvents)
  const metaIntakeDraftReady = tasks.some((t) =>
    t.id === 'task-meta-intake' &&
    t.status === 'spec_review' &&
    typeof t.spec === 'string' &&
    t.spec.trim().length > 0,
  )
  const metaIntakeInProgress = tasks.some((t) =>
    t.id === 'task-meta-intake' &&
    typeof t.status === 'string' &&
    !['done', 'shelved'].includes(t.status),
  )

  // ---- Setup section: onboard wizard steps as chat turns -------------------
  const onboardProgress = progressFor(onboardWizard, snap)
  let activeAssigned = false
  // Synthetic timestamps so setup steps order-deterministically before any
  // real task turns. Using epoch=0 + minute offsets keeps sort stable.
  const setupBase = new Date(0).toISOString()
  for (const step of onboardProgress.steps) {
    const status: TurnStatus =
      step.status === 'done'
        ? 'done'
        : step.status === 'skipped'
          ? 'done'
          : metaIntakeDraftReady || metaIntakeInProgress
            ? 'pending'
            : !activeAssigned
            ? 'active'
            : 'pending'
    if (status === 'active') activeAssigned = true
    const action = SETUP_STEP_ACTIONS[step.id] ?? {
      affordance: 'link',
      actionLabel: 'Open',
      actionHref: '/',
    }
    turns.push({
      kind: 'setup_step',
      id: `setup:${step.id}`,
      at: setupBase,
      persona: 'intake',
      status,
      phase: status === 'done' ? 'done' : 'setup',
      stepId: step.id,
      title: step.title,
      why: step.why,
      skippable: step.skippable,
      ...action,
      currentValue: setupCurrentValue(step.id, snap, opts.projectPath) ?? action.currentValue,
    })
  }

  // ---- Task-derived turns --------------------------------------------------
  for (const t of tasks) {
    const taskId = typeof t.id === 'string' ? t.id : ''
    const taskTitle = typeof t.title === 'string' ? t.title : taskId
    if (!taskId) continue
    const taskStatus = typeof t.status === 'string' ? t.status : ''
    const createdAt =
      typeof t.createdAt === 'string' ? t.createdAt : new Date().toISOString()

    // Brief approval (or done card)
    const brief = t.productBrief as
      | {
          userJob?: string
          successMetric?: string
          successCriteria?: string
          antiPatterns?: string[]
          rolloutPlan?: string
          authoredBy?: string
          approvedAt?: string | null
        }
      | undefined
    const approvedAt = brief && typeof brief === 'object' ? brief.approvedAt ?? null : null
    const liveAgent = liveAgents.get(taskId)
    if (brief && typeof brief === 'object') {
      const briefStillNeedsHuman = !approvedAt && taskStatus === 'exploring'
      const status: TurnStatus = !briefStillNeedsHuman
        ? 'done'
        : !activeAssigned
          ? 'active'
          : 'pending'
      if (status === 'active') activeAssigned = true
      turns.push({
        kind: 'brief_approval',
        id: `brief:${taskId}`,
        at: createdAt,
        persona: 'spec',
        status,
        phase: status === 'done' ? 'done' : 'intake',
        taskId,
        taskTitle,
        brief: {
          userJob: brief.userJob,
          successMetric: brief.successMetric,
          successCriteria: brief.successCriteria,
          antiPatterns: brief.antiPatterns,
          rolloutPlan: brief.rolloutPlan,
          authoredBy: brief.authoredBy,
        },
        liveAgent,
        approvedAt,
      })
    }

    // Open agent questions
    const openQs = Array.isArray(t.openQuestions)
      ? (t.openQuestions as Array<Record<string, unknown>>)
      : []
    for (const q of openQs) {
      const qid = typeof q.id === 'string' ? q.id : ''
      const askedAt = typeof q.askedAt === 'string' ? q.askedAt : createdAt
      if (!qid) continue
      const answeredAt = typeof q.answeredAt === 'string' ? q.answeredAt : undefined
      // Agent questions are co-active: any unanswered question on the task
      // is independently 'active' so the user can answer them in any order.
      // We DO NOT bump `activeAssigned` here — that flag gates the strictly
      // linear turn kinds (setup steps, brief approval, spec review). A batch
      // of related questions on one task should all surface as live cards.
      const status: TurnStatus = answeredAt ? 'done' : 'active'
      turns.push({
        kind: 'agent_question',
        id: `q:${taskId}:${qid}`,
        at: askedAt,
        persona: typeof q.askedBy === 'string' && q.askedBy.includes('spec')
          ? 'spec'
          : 'coord',
        status,
        phase: status === 'done' ? 'done' : 'intake',
        taskId,
        taskTitle,
        liveAgent,
        question: {
          kind: (q.kind as 'confirm' | 'yesno' | 'choice' | 'text') ?? 'text',
          id: qid,
          askedBy: typeof q.askedBy === 'string' ? q.askedBy : 'agent',
          askedAt,
          answeredAt,
          answer: typeof q.answer === 'string' ? q.answer : undefined,
          restatement: typeof q.restatement === 'string' ? q.restatement : undefined,
          prompt: typeof q.prompt === 'string' ? q.prompt : undefined,
          choices: Array.isArray(q.choices)
            ? (q.choices as unknown[]).filter((c): c is string => typeof c === 'string')
            : undefined,
          selectionMode: q.selectionMode === 'single' || q.selectionMode === 'multiple'
            ? q.selectionMode
            : undefined,
        },
      })
    }

    // Spec review
    if (taskStatus === 'spec_review') {
      const status: TurnStatus = !activeAssigned ? 'active' : 'pending'
      if (status === 'active') activeAssigned = true
      const spec = typeof t.spec === 'string' ? t.spec : ''
      const draftCoordinators = taskId === 'task-meta-intake'
        ? parseCoordinatorDraft(spec)?.map((draft) => ({
            id: draft.id,
            name: draft.name,
            domain: draft.domain,
            path: draft.path,
            mandate: draft.mandate,
            concerns: draft.concerns.map((concern) => ({
              id: concern.id,
              description: concern.description,
            })),
          }))
        : undefined
      turns.push({
        kind: 'spec_review',
        id: `spec:${taskId}`,
        at: typeof t.updatedAt === 'string' ? t.updatedAt : createdAt,
        persona: 'spec',
        status,
        phase: status === 'active' ? 'spec' : 'intake',
        taskId,
        taskTitle,
        spec,
        draftCoordinators,
      })
    }

    const hasUnansweredQuestions = openQs.some(q => !q.answeredAt)
    const hasActiveBriefTurn = !!brief && !approvedAt && taskStatus === 'exploring'
    if (
      ['exploring', 'in_progress', 'gate_check', 'review', 'ready'].includes(taskStatus) &&
      !hasUnansweredQuestions &&
      !hasActiveBriefTurn
    ) {
      const status: TurnStatus = !activeAssigned ? 'active' : 'pending'
      if (status === 'active') activeAssigned = true
      const livePersona = personaForAgent(liveAgent?.name)
      const persona = livePersona ?? (taskStatus === 'exploring' ? 'spec' : 'worker')
      const phase = taskStatus === 'exploring' || livePersona === 'spec' ? 'intake' : 'inflight'
      const summary =
        liveAgent
          ? `${friendlyAgentName(liveAgent.name)} is working on this now.`
          : taskStatus === 'exploring'
            ? 'The spec author is shaping this task.'
            : taskStatus === 'ready'
              ? 'Ready for a worker.'
              : taskStatus === 'gate_check'
                ? 'Gates are running.'
                : taskStatus === 'review'
                  ? 'Review is running.'
                  : 'Agent is working.'
      turns.push({
        kind: 'inflight',
        id: `inflight:${taskId}`,
        at: typeof t.updatedAt === 'string' ? t.updatedAt : createdAt,
        persona,
        status,
        phase,
        taskId,
        taskTitle,
        taskStatus,
        summary,
        liveAgent,
        checklist: taskStatus === 'exploring' ? specFillChecklist(opts.projectPath, t) : undefined,
      })
    }

    // Open escalations
    const escalations = Array.isArray(t.escalations)
      ? (t.escalations as Array<Record<string, unknown>>)
      : []
    for (const esc of escalations) {
      if (esc.resolvedAt) continue
      const escId = typeof esc.id === 'string' ? esc.id : ''
      const at = typeof esc.raisedAt === 'string' ? esc.raisedAt : createdAt
      const summary =
        typeof esc.summary === 'string' && esc.summary.trim()
          ? esc.summary
          : typeof esc.reason === 'string'
            ? esc.reason
            : 'Agent escalation awaiting human input.'
      const status: TurnStatus = !activeAssigned ? 'active' : 'pending'
      if (status === 'active') activeAssigned = true
      turns.push({
        kind: 'escalation',
        id: `esc:${taskId}:${escId}`,
        at,
        persona: 'worker',
        status,
        phase: 'blocked',
        taskId,
        taskTitle,
        escalationId: escId,
        summary,
        details: typeof esc.details === 'string' ? esc.details : undefined,
      })
    }
  }

  // ---- Sort: setup first (epoch=0), then turns by `at` chronological -------
  turns.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
  for (const turn of turns) {
    turn.phase = phaseForTurn(turn)
  }

  const activeTurnId = turns.find(t => t.status === 'active')?.id ?? null
  const caughtUp = activeTurnId === null && turns.every(t => t.status === 'done')

  return { turns, activeTurnId, caughtUp }
}
