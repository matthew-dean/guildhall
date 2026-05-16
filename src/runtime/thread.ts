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
import { basename, join } from 'node:path'
import type { Task } from '@guildhall/core'
import { activeEscalations } from '@guildhall/tools'
import {
  buildSnapshot,
  buildTaskSnapshot,
  onboardWizard,
  progressFor,
  progressForTask,
  specFillWizard,
  type ProjectSnapshot,
} from './wizards.js'
import { shouldUseImportDraftState } from './import-drafts.js'
import { META_INTAKE_TASK_ID, parseCoordinatorDraft } from './meta-intake.js'
import { thresholdMs } from './liveness.js'

// ---------------------------------------------------------------------------
// Turn shape
// ---------------------------------------------------------------------------

export type TurnPersona = 'intake' | 'spec' | 'worker' | 'reviewer' | 'coord' | 'system'
export type TurnStatus = 'done' | 'active' | 'pending'
export type TurnPhase = 'setup' | 'intake' | 'spec' | 'ready' | 'inflight' | 'blocked' | 'done'
export type SetupAffordance =
  | 'link'
  | 'inline-text'
  | 'inline-textarea'
  | 'inline-button'
  | 'inline-choice'
export interface LiveActivity {
  at?: string | undefined
  label: string
  tone: 'neutral' | 'running' | 'ok' | 'warn' | 'danger'
  detail?: string | undefined
}

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
    draftAnswer?: string | undefined
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
    name?: string
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
  activity?: LiveActivity[] | undefined
}

/** Reviewer feedback returned the task to implementation. */
export interface ReviewFeedbackTurn extends TurnBase {
  kind: 'review_feedback'
  taskId: string
  taskTitle: string
  summary: string
  feedback: string
  revisionCount?: number | undefined
}

/** Task is currently running; informational, no user action required. */
export interface InFlightTurn extends TurnBase {
  kind: 'inflight'
  taskId: string
  taskTitle: string
  taskStatus?: string | undefined
  summary: string
  importedDraft?: boolean | undefined
  liveAgent?: {
    name: string
    startedAt?: string | undefined
    lastEventAt?: string | undefined
    lastEventType?: string | undefined
    lastEventLabel?: string | undefined
    silentMs?: number | undefined
    stalled?: boolean | undefined
  } | undefined
  activity?: LiveActivity[] | undefined
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
  | ReviewFeedbackTurn
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
  /** Current coordinator run status; when stopped, stale task activity should not project as live work. */
  runStatus?: string | undefined
  /** Recent supervisor events, used only for live "agent is currently busy" hints. */
  recentEvents?: Array<{
    at?: string | undefined
    event?: {
      type?: string | undefined
      task_id?: string | null | undefined
      agent_name?: string | null | undefined
      tool_name?: string | null | undefined
      message?: string | null | undefined
      output?: string | null | undefined
      is_error?: boolean | null | undefined
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

function tasksArray(raw: unknown): Task[] {
  if (Array.isArray(raw)) return raw as Task[]
  if (raw && typeof raw === 'object' && Array.isArray((raw as { tasks?: unknown }).tasks)) {
    return (raw as { tasks: Task[] }).tasks
  }
  return []
}

function isTerminalQuestionState(status: string): boolean {
  return status === 'done' || status === 'shelved' || status === 'blocked' || status === 'pending_pr'
}

function isGuildhallQueuedTurn(turn: ThreadTurn): boolean {
  return (
    turn.kind === 'inflight' &&
    turn.status === 'active' &&
    !turn.liveAgent &&
    !turn.importedDraft &&
    (
      turn.taskStatus === 'ready' ||
      turn.taskStatus === 'exploring' ||
      turn.taskStatus === 'in_progress' ||
      turn.taskStatus === 'review' ||
      turn.taskStatus === 'gate_check'
    )
  )
}

function isHumanOwnedActiveTurn(turn: ThreadTurn): boolean {
  if (turn.status !== 'active') return false
  switch (turn.kind) {
    case 'setup_step':
    case 'agent_question':
    case 'brief_approval':
    case 'spec_review':
    case 'escalation':
      return true
    case 'inflight':
      return Boolean(turn.importedDraft)
    default:
      return false
  }
}

function hasRoutingDraft(taskSpec: string): boolean {
  return !!parseCoordinatorDraft(taskSpec) || /```ya?ml[\s\S]*?\bcoordinators:\b[\s\S]*?```/i.test(taskSpec)
}

function hasSpecDraftContent(task: Pick<Task, 'spec' | 'acceptanceCriteria'>): boolean {
  return (
    typeof task.spec === 'string' &&
    task.spec.trim().length > 0 &&
    Array.isArray(task.acceptanceCriteria) &&
    task.acceptanceCriteria.length > 0
  )
}

function hasApprovedProductBrief(task: Pick<Task, 'productBrief'>): boolean {
  return Boolean(
    task.productBrief &&
    typeof task.productBrief === 'object' &&
    typeof task.productBrief.approvedAt === 'string' &&
    task.productBrief.approvedAt.trim().length > 0,
  )
}

function hasConcreteSpecDraft(task: Task): boolean {
  return (
    typeof task.status === 'string' &&
    task.status === 'spec_review' &&
    hasSpecDraftContent(task)
  )
}

function isQueuedSpecRevision(task: Task): boolean {
  return (
    task.status === 'exploring' &&
    hasSpecDraftContent(task) &&
    hasApprovedProductBrief(task)
  )
}

function firstSpecSummaryLine(spec: string | undefined): string | undefined {
  if (typeof spec !== 'string' || !spec.trim()) return undefined
  const summaryMatch = spec.match(/## Summary\s+([\s\S]*?)(?:\n## |\n### |\Z)/i)
  const summaryBlock = (summaryMatch?.[1] ?? spec).trim()
  if (!summaryBlock) return undefined
  const firstParagraph = summaryBlock.split(/\n\s*\n/)[0]?.trim() ?? ''
  if (!firstParagraph) return undefined
  const singleLine = firstParagraph.replace(/\s+/g, ' ').trim()
  if (!singleLine) return undefined
  const sentence = singleLine.match(/^(.+?[.!?])(?:\s|$)/)?.[1] ?? singleLine
  return sentence.trim()
}

function truncateDisplayTitle(value: string, max = 72): string {
  const singleLine = value.replace(/\s+/g, ' ').trim()
  if (singleLine.length <= max) return singleLine
  return `${singleLine.slice(0, max - 1).trim()}...`
}

function displayTaskTitle(task: Task): string {
  if (task.id === META_INTAKE_TASK_ID) return 'Inspect the repo and draft starter tasks'
  if (task.id === 'task-workspace-import') return 'Review existing project work'
  const raw = typeof task.title === 'string' ? task.title.trim() : ''
  if (isQueuedSpecRevision(task) && /^Draft a first starter task for /i.test(raw)) {
    const summary = firstSpecSummaryLine(task.spec)
    if (summary) return `Starter task spec: ${truncateDisplayTitle(summary)}`
    return 'Starter task spec draft'
  }
  return raw || task.id
}

function isObsoleteMetaRoutingQuestion(taskId: string, taskSpec: string, question: Record<string, unknown>): boolean {
  if (taskId !== META_INTAKE_TASK_ID) return false
  if (!hasRoutingDraft(taskSpec)) return false
  const text =
    (typeof question.restatement === 'string' && question.restatement) ||
    (typeof question.prompt === 'string' && question.prompt) ||
    ''
  return /project areas|review lanes|coordinator domains?|coordinators for/i.test(text)
}

function isObsoleteStarterTaskFocusQuestion(task: Task, question: Record<string, unknown>): boolean {
  if (!hasConcreteSpecDraft(task)) return false
  const text =
    (typeof question.restatement === 'string' && question.restatement) ||
    (typeof question.prompt === 'string' && question.prompt) ||
    ''
  if (!/what should .*?(first|starter) task focus on|pick the focus for this first task/i.test(text)) {
    return false
  }
  const askedAt = typeof question.askedAt === 'string' ? Date.parse(question.askedAt) : Number.NaN
  const updatedAt = typeof task.updatedAt === 'string' ? Date.parse(task.updatedAt) : Number.NaN
  return !Number.isFinite(askedAt) || !Number.isFinite(updatedAt) || askedAt <= updatedAt
}

function isObsoleteVisibleQuestion(task: Task, question: Record<string, unknown>): boolean {
  const taskId = typeof task.id === 'string' ? task.id : ''
  const taskSpec = typeof task.spec === 'string' ? task.spec : ''
  return (
    isObsoleteMetaRoutingQuestion(taskId, taskSpec, question) ||
    isObsoleteStarterTaskFocusQuestion(task, question)
  )
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

function firstSentence(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  const match = trimmed.match(/^(.+?[.!?])(?:\s|$)/)
  return (match?.[1] ?? trimmed).trim()
}

function compactEscalationDetails(value: string | undefined): string | undefined {
  if (!value) return undefined
  const cleaned = stripMarkdown(value)
  if (!cleaned) return undefined
  const dirtyRepoMatch = cleaned.match(
    /(?:Guildhall could not start work because the target repo is dirty:\s*)?base repo has uncommitted changes at (.+?)(?:\.|$)/i,
  )
  if (dirtyRepoMatch) {
    const repoPath = dirtyRepoMatch[1]?.trim() ?? ''
    const repoName = repoPath ? basename(repoPath) : 'the repo'
    return `Guildhall is blocked because ${repoName} has uncommitted changes. Commit or stash that repo, then try again.`
  }

  const mustChangeMatch = cleaned.match(/What must change:\s*[-•]?\s*(.+?)(?=(?:[-•]\s+[A-Z]|\bReviewer availability notes\b|$))/i)
  const primaryAction = firstSentence(mustChangeMatch?.[1] ?? '')
  const timeoutCount = (cleaned.match(/timed out after \d+ms/gi) ?? []).length

  const parts: string[] = []
  if (primaryAction) {
    parts.push(primaryAction)
  } else {
    parts.push(firstSentence(cleaned))
  }
  if (timeoutCount > 0) {
    parts.push(`${timeoutCount} reviewer${timeoutCount === 1 ? '' : 's'} timed out.`)
  }

  const summary = parts.join(' ')
  return summary.length > 220 ? `${summary.slice(0, 217).trimEnd()}...` : summary
}

function guessedProjectDirection(projectPath: string): string {
  const readmePath = join(projectPath, 'README.md')
  if (!existsSync(readmePath)) return ''
  try {
    const raw = readFileSync(readmePath, 'utf8')
    const lines = raw.split(/\r?\n/)
    const title = stripMarkdown(lines.find(line => line.trim().startsWith('# '))?.replace(/^#\s+/, '') ?? '')
    const cleaned = lines.map(line => stripMarkdown(line).trim())
    let body = ''
    for (let i = 0; i < lines.length; i += 1) {
      const rawLine = lines[i] ?? ''
      const line = cleaned[i] ?? ''
      if (
        line.length === 0 ||
        line.startsWith('!') ||
        /^status\s*:/i.test(line) ||
        (title && line.toLowerCase() === title.toLowerCase())
      ) {
        continue
      }
      if (/^[-*]\s/.test(rawLine.trim())) continue
      if (/:$/.test(line)) {
        const bullets: string[] = []
        for (let j = i + 1; j < lines.length; j += 1) {
          const nextRaw = lines[j] ?? ''
          if (!/^[-*]\s/.test(nextRaw.trim())) break
          const nextLine = stripMarkdown(nextRaw)
            .trim()
            .replace(/^[-*]\s*/, '')
            .replace(/^(primary|also)\s*:\s*/i, '')
          if (nextLine) bullets.push(nextLine)
        }
        if (bullets.length > 0) {
          body = `${line.replace(/:\s*$/, '')} ${bullets.join('; ')}.`
          break
        }
      }
      body = line
      break
    }
    const lead = body ? firstSentence(body).replace(/\s+/g, ' ').trim() : ''
    if (lead) return lead
    return title ? `${title}.` : ''
  } catch {
    return ''
  }
}

function isLegacyGeneratedProjectDirection(value: string): boolean {
  return /from the readme, the project appears to be about/i.test(value) ||
    /guildhall should treat the main goal as/i.test(value)
}

function normalizeOpenQuestionPrompt(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase()
}

function openQuestionSignature(question: Record<string, unknown>): string {
  const body = normalizeOpenQuestionPrompt(
    typeof question.prompt === 'string'
      ? question.prompt
      : typeof question.restatement === 'string'
        ? question.restatement
        : '',
  )
  const choices = Array.isArray(question.choices)
    ? (question.choices as unknown[])
      .filter((choice): choice is string => typeof choice === 'string')
      .map((choice) => normalizeOpenQuestionPrompt(choice))
      .join('|')
    : ''
  const selectionMode =
    question.selectionMode === 'single' || question.selectionMode === 'multiple'
      ? question.selectionMode
      : ''
  const kind = typeof question.kind === 'string' ? question.kind : ''
  return [kind, body, choices, selectionMode].join('::')
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
    actionLabel: 'Run checks',
    submitEndpoint: '/api/project/bootstrap/run',
  },
  coordinator: {
    affordance: 'inline-button',
    actionLabel: 'Let Guildhall inspect the repo',
    submitEndpoint: '/api/project/meta-intake',
  },
  direction: {
    affordance: 'inline-textarea',
    actionLabel: 'Save',
    submitEndpoint: '/api/project/brief',
    placeholder: 'Project direction',
  },
  workspaceImport: {
    affordance: 'link',
    actionLabel: 'Open review',
    actionHref: '/workspace-import',
  },
  firstTask: {
    affordance: 'inline-text',
    actionLabel: 'Create task',
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
    if (existing && isLegacyGeneratedProjectDirection(existing)) {
      return guessedProjectDirection(projectPath)
    }
    return existing || guessedProjectDirection(projectPath)
  } catch {
    return guessedProjectDirection(projectPath)
  }
}

function phaseForTurn(turn: ThreadTurn): TurnPhase {
  if (turn.kind === 'review_feedback') return turn.phase
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
      if (turn.phase === 'setup') return 'setup'
      if (turn.phase === 'spec') return 'spec'
      if (turn.taskStatus === 'ready') return 'ready'
      if (turn.taskStatus === 'exploring' || turn.taskStatus === 'import_draft') return 'intake'
      return 'inflight'
  }
}

function friendlyAgentName(agentName: string | undefined): string {
  if (agentName?.startsWith('coordinator-')) return 'Coordinator'
  switch (agentName) {
    case 'spec-agent': return 'Spec author'
    case 'worker-agent': return 'Worker'
    case 'reviewer-agent': return 'Reviewer'
    case 'gate-checker-agent': return 'Gate checker'
    default: return agentName?.trim() || 'Agent'
  }
}

function personaForAgent(agentName: string | undefined): TurnPersona | null {
  if (agentName?.startsWith('coordinator-')) return 'coord'
  switch (agentName) {
    case 'spec-agent': return 'spec'
    case 'worker-agent': return 'worker'
    case 'reviewer-agent': return 'reviewer'
    case 'gate-checker-agent':
      return 'coord'
    default:
      return null
  }
}

function liveAgentsByTask(
  events: BuildThreadOptions['recentEvents'],
  cutoffs: ReadonlyMap<string, number>,
): Map<string, {
  name: string
  startedAt?: string | undefined
  lastEventAt?: string | undefined
  lastEventType?: string | undefined
  lastEventLabel?: string | undefined
  silentMs?: number | undefined
  stalled?: boolean | undefined
}> {
  const activityTypes = new Set([
    'assistant_delta',
    'assistant_complete',
    'line_complete',
    'tool_started',
    'tool_completed',
  ])
  const live = new Map<string, {
    name: string
    startedAt?: string | undefined
    lastEventAt?: string | undefined
    lastEventType?: string | undefined
    lastEventLabel?: string | undefined
  }>()
  for (const envelope of events ?? []) {
    const ev = envelope.event
    const taskId = typeof ev?.task_id === 'string' ? ev.task_id : null
    if (!taskId) continue
    const cutoff = cutoffs.get(taskId)
    if (cutoff && envelope.at && Date.parse(envelope.at) < cutoff) continue
    if (ev?.type === 'agent_started') {
      live.set(taskId, {
        name: typeof ev.agent_name === 'string' ? ev.agent_name : 'agent',
        startedAt: envelope.at,
        lastEventAt: envelope.at,
        lastEventType: ev.type,
        lastEventLabel: 'Started working',
      })
    } else if (
      ev?.type === 'agent_finished' ||
      ev?.type === 'task_transition' ||
      ev?.type === 'escalation_raised' ||
      ev?.type === 'error'
    ) {
      live.delete(taskId)
    } else if (live.has(taskId)) {
      const current = live.get(taskId)!
      live.set(taskId, {
        ...current,
        lastEventAt: envelope.at ?? current.lastEventAt,
        lastEventType: ev?.type,
        lastEventLabel: liveEventLabel(ev),
      })
    } else if (ev?.type && activityTypes.has(ev.type)) {
      live.set(taskId, {
        name: typeof ev.agent_name === 'string' ? ev.agent_name : 'agent',
        startedAt: envelope.at,
        lastEventAt: envelope.at,
        lastEventType: ev.type,
        lastEventLabel: liveEventLabel(ev),
      })
    }
  }
  const now = Date.now()
  const stalledAfterMs = thresholdMs('standard')
  return new Map(Array.from(live.entries()).map(([taskId, entry]) => {
    const last = entry.lastEventAt ? Date.parse(entry.lastEventAt) : NaN
    const silentMs = Number.isFinite(last) ? Math.max(0, now - last) : undefined
    return [
      taskId,
      {
        ...entry,
        ...(silentMs !== undefined ? { silentMs } : {}),
        stalled: silentMs !== undefined ? silentMs >= stalledAfterMs : false,
      },
    ]
  }))
}

function liveEventLabel(
  ev: NonNullable<BuildThreadOptions['recentEvents']>[number]['event'],
): string {
  const type = ev?.type ?? ''
  const tool = friendlyToolName(typeof ev?.tool_name === 'string' ? ev.tool_name : '')
  if (type === 'tool_started' && tool) return `Started ${tool}`
  if (type === 'tool_completed' && ev?.is_error && tool) return `Failed ${tool}`
  if (type === 'tool_completed' && tool) return `Finished ${tool}`
  if (type === 'assistant_delta') return 'Writing'
  if (type === 'assistant_complete') return 'Finished a thought'
  if (type === 'line_complete' && typeof ev?.message === 'string' && ev.message.trim()) {
    return ev.message.trim()
  }
  return type ? type.replace(/_/g, ' ') : 'Working'
}

function friendlyToolName(tool: string): string {
  switch (tool) {
    case 'read-file': return 'file read'
    case 'edit-file': return 'file edit'
    case 'run-command': return 'command'
    case 'search-files': return 'file search'
    case 'list-files': return 'file list'
    default: return tool.replace(/[-_]/g, ' ')
  }
}

function liveEventTone(
  ev: NonNullable<BuildThreadOptions['recentEvents']>[number]['event'],
): 'neutral' | 'running' | 'ok' | 'warn' | 'danger' {
  const type = ev?.type ?? ''
  if (
    type === 'error' &&
    /empty (assistant|model) reply|empty assistant message/i.test(String(ev?.message ?? ''))
  ) return 'warn'
  if (type === 'error' || (type === 'tool_completed' && ev?.is_error)) return 'danger'
  if (
    type === 'line_complete' &&
    /retrying|waiting for the local model to respond/i.test(String(ev?.message ?? ''))
  ) return 'running'
  if (type === 'tool_started' || type === 'assistant_delta') return 'running'
  if (type === 'tool_completed' || type === 'assistant_complete') return 'ok'
  if (type === 'line_complete') return 'warn'
  return 'neutral'
}

function truncateDetail(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  const dirtyRepoMatch = trimmed.match(/worktree setup blocked: base repo has uncommitted changes at (.+)$/i)
  if (dirtyRepoMatch) {
    const repoPath = dirtyRepoMatch[1]?.trim() ?? ''
    const repoName = repoPath ? basename(repoPath) : 'the repo'
    return `Guildhall is blocked because ${repoName} has uncommitted changes. Commit or stash that repo, then try again.`
  }
  if (
    trimmed.includes('Invalid input for edit-file') &&
    /"path"\s*:\s*\[\s*"oldString"\s*\]/.test(trimmed)
  ) {
    return 'The file edit was missing oldString: the exact existing text to replace. Read the file, then call edit-file with filePath, oldString, and newString.'
  }
  return trimmed.length > 180 ? `${trimmed.slice(0, 177)}...` : trimmed
}

function rollingDetail(value: string): string | undefined {
  const compact = value.replace(/\s+/g, ' ').trim()
  if (!compact) return undefined
  return compact.length > 220 ? `...${compact.slice(-217)}` : compact
}

function compactReviewSummary(value: string): string {
  const firstAction = value
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('- '))
  if (firstAction) return firstAction.replace(/^-+\s*/, '')
  const firstSentence = value.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+/)[0]
  return firstSentence || 'Reviewer requested revisions.'
}

function trimActivityItems(items: LiveActivity[], limit = 6): LiveActivity[] {
  if (items.length <= limit) return items
  const recent = items.slice(-limit)
  const included = new Set(recent)
  const stickyFailures = items
    .filter(item => item.tone === 'danger' && !included.has(item))
    .slice(-2)
  if (stickyFailures.length === 0) return recent
  return [...stickyFailures, ...recent.slice(-(limit - stickyFailures.length))]
}

function latestDangerActivityAt(
  activity: LiveActivity[] | undefined,
): number | null {
  let newest: number | null = null
  for (const item of activity ?? []) {
    if (item.tone !== 'danger' || !item.at) continue
    const at = Date.parse(item.at)
    if (!Number.isFinite(at)) continue
    newest = newest == null || at > newest ? at : newest
  }
  return newest
}

function currentActivityCutoffs(
  tasks: ReadonlyArray<Task>,
): Map<string, number> {
  const cutoffs = new Map<string, number>()
  for (const task of tasks) {
    const updatedAt = typeof task.updatedAt === 'string'
      ? Date.parse(task.updatedAt)
      : NaN
    if (!Number.isFinite(updatedAt)) continue
    cutoffs.set(task.id, updatedAt)
  }
  return cutoffs
}

function activityByTask(
  events: BuildThreadOptions['recentEvents'],
  cutoffs: ReadonlyMap<string, number>,
): Map<string, LiveActivity[]> {
  const activity = new Map<string, LiveActivity[]>()
  let lastAssistantDeltaTask: string | null = null
  const deltaTextByTask = new Map<string, string>()
  for (const envelope of events ?? []) {
    const ev = envelope.event
    const taskId = typeof ev?.task_id === 'string' ? ev.task_id : null
    if (!taskId) continue
    const cutoff = cutoffs.get(taskId)
    if (cutoff && envelope.at && Date.parse(envelope.at) < cutoff) continue
    const type = ev?.type ?? ''
    const include =
      type === 'line_complete' ||
      type === 'tool_started' ||
      type === 'tool_completed' ||
      type === 'assistant_complete' ||
      type === 'error' ||
      type === 'assistant_delta'
    if (!include) continue
    if (type === 'assistant_delta') {
      const message = typeof ev?.message === 'string' ? ev.message : ''
      const nextText = `${deltaTextByTask.get(taskId) ?? ''}${message}`
      deltaTextByTask.set(taskId, nextText.slice(-1000))
    } else {
      deltaTextByTask.delete(taskId)
    }
    const items = activity.get(taskId) ?? []
    if (type === 'assistant_delta' && lastAssistantDeltaTask === taskId) {
      const last = items.at(-1)
      if (last) last.detail = rollingDetail(deltaTextByTask.get(taskId) ?? '')
    } else {
      items.push({
        at: envelope.at,
        label: liveEventLabel(ev),
        tone: liveEventTone(ev),
        ...(type === 'assistant_delta'
          ? { detail: rollingDetail(deltaTextByTask.get(taskId) ?? '') }
          : {}),
        ...(type === 'tool_completed' || type === 'error'
          ? { detail: truncateDetail(ev?.output ?? ev?.message) }
          : {}),
      })
    }
    lastAssistantDeltaTask = type === 'assistant_delta' ? taskId : null
    activity.set(taskId, trimActivityItems(items))
  }
  return activity
}

export function buildThread(opts: BuildThreadOptions): Thread {
  const snap = opts.snapshot ?? buildSnapshot({ projectPath: opts.projectPath })
  const turns: ThreadTurn[] = []
  const tasksPath = join(opts.projectPath, 'memory', 'TASKS.json')
  const tasks = existsSync(tasksPath) ? tasksArray(readJsonSafe(tasksPath)) : []
  const activityCutoffs = currentActivityCutoffs(tasks)
  const liveAgents = liveAgentsByTask(opts.recentEvents, activityCutoffs)
  const liveActivity = activityByTask(opts.recentEvents, activityCutoffs)
  const runIsActive = opts.runStatus == null || opts.runStatus === 'running' || opts.runStatus === 'stopping'
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
  const providerSetupPending = onboardProgress.steps.some(
    (step) => step.id === 'provider' && step.status === 'pending',
  )
  const bootstrapSetupPending = onboardProgress.steps.some(
    (step) => step.id === 'bootstrap' && step.status === 'pending',
  )
  const activeSetupStepId = onboardProgress.activeStepId
  const setupStillBlockingMetaIntake = providerSetupPending || bootstrapSetupPending
  const metaIntakeCanLeadSetup =
    activeSetupStepId === 'routing' &&
    (metaIntakeDraftReady || (metaIntakeInProgress && !setupStillBlockingMetaIntake))
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
          : metaIntakeCanLeadSetup
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
  const importDraftTasks = tasks.filter((task) => {
    const taskStatus = typeof task.status === 'string' ? task.status : ''
    return taskStatus === 'import_draft' || shouldUseImportDraftState(task)
  })
  const leadingImportDraftId = typeof importDraftTasks[0]?.id === 'string' ? importDraftTasks[0].id : null
  for (const t of tasks) {
    const taskId = typeof t.id === 'string' ? t.id : ''
    const taskTitle = displayTaskTitle(t)
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
    const openQs = isTerminalQuestionState(taskStatus)
      ? []
      : (Array.isArray(t.openQuestions)
          ? (t.openQuestions as Array<Record<string, unknown>>)
          : []).filter((q) => !isObsoleteVisibleQuestion(t, q))
    const seenQuestionSignatures = new Set<string>()
    for (const q of openQs) {
      const signature = openQuestionSignature(q)
      const answeredAt = typeof q.answeredAt === 'string' ? q.answeredAt : undefined
      if (!answeredAt && signature && seenQuestionSignatures.has(signature)) continue
      const qid = typeof q.id === 'string' ? q.id : ''
      const askedAt = typeof q.askedAt === 'string' ? q.askedAt : createdAt
      if (!qid) continue
      if (!answeredAt && signature) seenQuestionSignatures.add(signature)
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
          draftAnswer: typeof q.draftAnswer === 'string' ? q.draftAnswer : undefined,
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

    const notes = Array.isArray(t.notes)
      ? (t.notes as Array<Record<string, unknown>>)
      : []
    const reviewerNotes = notes
      .map((note, index) => ({ note, index }))
      .filter(({ note }) => {
        const role = typeof note.role === 'string' ? note.role : ''
        const agentId = typeof note.agentId === 'string' ? note.agentId : ''
        const content = typeof note.content === 'string' ? note.content.trim() : ''
        return !!content && (role === 'reviewer' || agentId.includes('reviewer'))
      })
    for (const [reviewIndex, { note, index }] of reviewerNotes.entries()) {
      const role = typeof note.role === 'string' ? note.role : ''
      const agentId = typeof note.agentId === 'string' ? note.agentId : ''
      const content = typeof note.content === 'string' ? note.content.trim() : ''
      if (!content) continue
      if (role !== 'reviewer' && !agentId.includes('reviewer')) continue
      const isLatestReviewFeedback = reviewIndex === reviewerNotes.length - 1
      const at = typeof note.timestamp === 'string' ? note.timestamp : createdAt
      const reviewAt = Date.parse(at)
      const latestDangerAt = latestDangerActivityAt(liveActivity.get(taskId))
      const failureHasMovedPastReview =
        taskStatus === 'in_progress' &&
        latestDangerAt != null &&
        Number.isFinite(reviewAt) &&
        latestDangerAt > reviewAt
      turns.push({
        kind: 'review_feedback',
        id: `review:${taskId}:${at}:${index}`,
        at,
        persona: 'reviewer',
        status: 'done',
        phase: isLatestReviewFeedback &&
          taskStatus !== 'done' &&
          taskStatus !== 'shelved' &&
          !failureHasMovedPastReview
          ? 'inflight'
          : 'done',
        taskId,
        taskTitle,
        summary: compactReviewSummary(content),
        feedback: content,
        revisionCount: reviewIndex + 1,
      })
    }

    const hasUnansweredQuestions = openQs.some(q => !q.answeredAt)
    const hasActiveBriefTurn = !!brief && !approvedAt && taskStatus === 'exploring'
    const importedDraft = taskStatus === 'import_draft' || shouldUseImportDraftState(t)
    if (importedDraft && taskId !== leadingImportDraftId) {
      continue
    }

    // Spec review
    if (taskStatus === 'spec_review' && !hasUnansweredQuestions) {
      const status: TurnStatus = hasUnansweredQuestions
        ? 'pending'
        : !activeAssigned
          ? 'active'
          : 'pending'
      if (status === 'active') activeAssigned = true
      const spec = typeof t.spec === 'string' ? t.spec : ''
      const draftCoordinators = taskId === 'task-meta-intake'
        ? parseCoordinatorDraft(spec)?.map((draft) => ({
            id: draft.id,
            ...(draft.name ? { name: draft.name } : {}),
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

    if (
      ['import_draft', 'exploring', 'in_progress', 'gate_check', 'review', 'ready'].includes(taskStatus) &&
      !hasUnansweredQuestions &&
      !hasActiveBriefTurn
    ) {
      const status: TurnStatus = !activeAssigned ? 'active' : 'pending'
      if (status === 'active') activeAssigned = true
      const effectiveLiveAgent = runIsActive ? liveAgent : undefined
      const livePersona = personaForAgent(effectiveLiveAgent?.name)
      const persona = livePersona ?? (taskStatus === 'exploring' || taskStatus === 'import_draft' ? 'spec' : 'worker')
      const queuedSpecRevision = isQueuedSpecRevision(t)
      const phase = taskStatus === 'ready'
        ? 'ready'
        : taskId === META_INTAKE_TASK_ID && setupStillBlockingMetaIntake && !liveAgent
          ? 'setup'
        : queuedSpecRevision
          ? 'spec'
        : taskStatus === 'exploring' || taskStatus === 'import_draft' || livePersona === 'spec'
          ? 'intake'
          : 'inflight'
      const summary =
        effectiveLiveAgent
          ? importedDraft && effectiveLiveAgent.name === 'spec-agent'
            ? 'Guildhall is shaping this imported draft now.'
            : taskId === META_INTAKE_TASK_ID
              ? 'Guildhall is inspecting the repo and drafting starter tasks now.'
            : `${friendlyAgentName(effectiveLiveAgent.name)} is working on this now.`
          : taskId === META_INTAKE_TASK_ID
            ? providerSetupPending
              ? 'Setup is waiting on provider configuration before Guildhall can inspect the repo.'
              : bootstrapSetupPending
                ? 'Setup checks still need to run before Guildhall can inspect the repo.'
                : 'Guildhall has a partial setup draft here.'
          : taskStatus === 'import_draft'
            ? importDraftTasks.length > 1
              ? `Imported draft waiting for shaping. ${importDraftTasks.length - 1} more drafts are queued behind it.`
              : 'Imported draft waiting for shaping.'
            : taskStatus === 'exploring'
              ? importedDraft
                ? importDraftTasks.length > 1
                  ? `Imported draft waiting for shaping. ${importDraftTasks.length - 1} more drafts are queued behind it.`
                  : 'Imported draft waiting for shaping.'
              : queuedSpecRevision
                ? 'Guildhall has your latest answers and a spec draft. The next step is for Guildhall to revise the spec.'
              : 'The spec author is shaping this task.'
            : taskStatus === 'ready'
              ? 'Approved and queued for work.'
              : taskStatus === 'gate_check'
                ? 'Gate checks are next.'
                : taskStatus === 'review'
                  ? 'Review is next.'
                  : 'Waiting for worker activity.'
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
        importedDraft,
        liveAgent: effectiveLiveAgent,
        activity: liveActivity.get(taskId),
        checklist:
          taskStatus === 'exploring' &&
          !queuedSpecRevision &&
          taskId !== META_INTAKE_TASK_ID &&
          taskId !== 'task-workspace-import' &&
          (!importedDraft || Boolean(liveAgent))
            ? specFillChecklist(opts.projectPath, t)
            : undefined,
      })
    }

    // Open escalations
    for (const esc of activeEscalations(t)) {
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
        details: compactEscalationDetails(
          typeof esc.details === 'string' ? esc.details : undefined,
        ),
        activity: liveActivity.get(taskId),
      })
    }
  }

  // ---- Sort: setup first (epoch=0), then turns by `at` chronological -------
  turns.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
  for (const turn of turns) {
    turn.phase = phaseForTurn(turn)
  }

  // Once there is live task work or a real task question/review, the thread
  // should center that activity instead of keeping setup cards marked active.
  const hasActiveTaskTurn = turns.some(
    (turn) => turn.status === 'active' && turn.kind !== 'setup_step',
  )
  const hadOnlySetupActive =
    !hasActiveTaskTurn && turns.some((turn) => turn.kind === 'setup_step' && turn.status === 'active')
  const hasPendingNonSetupTurnBeyondSetup = turns.some(
    (turn) =>
      turn.kind !== 'setup_step' &&
      turn.status === 'pending' &&
      turn.phase !== 'setup',
  )
  const setupCanYieldToTaskTurns = activeSetupStepId === 'routing'
  if (setupCanYieldToTaskTurns && (hasActiveTaskTurn || (hadOnlySetupActive && hasPendingNonSetupTurnBeyondSetup))) {
    for (const turn of turns) {
      if (turn.kind === 'setup_step' && turn.status === 'active') {
        turn.status = 'pending'
        turn.phase = 'setup'
      }
    }
  }
  if (setupCanYieldToTaskTurns && hadOnlySetupActive && hasPendingNonSetupTurnBeyondSetup) {
    for (let index = turns.length - 1; index >= 0; index -= 1) {
      const turn = turns[index]
      if (!turn || turn.kind === 'setup_step' || turn.status !== 'pending') continue
      turn.status = 'active'
      break
    }
  }

  const hasHumanOwnedActiveTurn = turns.some(isHumanOwnedActiveTurn)
  if (hasHumanOwnedActiveTurn) {
    for (const turn of turns) {
      if (isGuildhallQueuedTurn(turn)) {
        turn.status = 'pending'
      }
    }
  }

  const activeReviewTurnWithoutLiveAgent = turns.find(
    (turn) =>
      turn.kind === 'inflight' &&
      turn.status === 'active' &&
      turn.taskStatus === 'review' &&
      !turn.liveAgent,
  )
  const pendingWorkerTurn = turns.find(
    (turn) =>
      turn.kind === 'inflight' &&
      turn.status === 'pending' &&
      turn.taskStatus === 'in_progress',
  )
  if (activeReviewTurnWithoutLiveAgent && pendingWorkerTurn) {
    activeReviewTurnWithoutLiveAgent.status = 'pending'
    pendingWorkerTurn.status = 'active'
  }

  const activeTurns = turns.filter(t => t.status === 'active')
  const activeTurnId = activeTurns.length > 0 ? activeTurns[activeTurns.length - 1]!.id : null
  const caughtUp = activeTurnId === null && turns.every(t => t.status === 'done')

  return { turns, activeTurnId, caughtUp }
}
