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
import { constructionModeForTask, type ConstructionMode, type Task, type TaskRequest } from '@guildhall/core'
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
import { visibleQuestions, visibleOpenQuestions } from './question-visibility.js'
import { thresholdMs } from './liveness.js'
import { listPressureTestIntakes, summarizeProjectCheckIn, type PressureTestIntake, type ProjectCheckInSummary } from './pressure-test-intake.js'
import { listBoundedChatSessions, type BoundedChatSession } from './bounded-chat.js'
import { getProjectStateDir, getProjectSystemStatePath } from '@guildhall/sessions'
import type { GitStorySnapshot } from './git-story.js'
import { userFacingText } from './user-facing-text.js'
import { specReviewRequiresOwnerApproval } from './spec-review-ownership.js'
import { taskShapingBlockers, type TaskShapingBlocker } from '../shared/task-shaping-blockers.js'

// ---------------------------------------------------------------------------
// Turn shape
// ---------------------------------------------------------------------------

export type TurnPersona = 'intake' | 'spec' | 'worker' | 'reviewer' | 'coord' | 'system'
export type TurnStatus = 'done' | 'active' | 'pending'
export type TurnPhase = 'setup' | 'intake' | 'spec' | 'ready' | 'inflight' | 'blocked' | 'done'
export type RequestStage = 'new_request' | 'task_brief_cleanup'
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

export interface TaskSourceNote {
  description?: string | undefined
  references: string[]
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
  contextSummary?: {
    intro: string
    facts: string[]
    uncertainty: string
  } | undefined
}

/**
 * Brief approval / reply. Mirrors the Spec drawer card but lives in the feed.
 */
export interface BriefTurn extends TurnBase {
  kind: 'brief_approval'
  taskId: string
  taskTitle: string
  constructionMode: ConstructionMode
  gitStory?: GitStorySnapshot | undefined
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
  latestUserCorrection?: string | undefined
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
  constructionMode: ConstructionMode
  gitStory?: GitStorySnapshot | undefined
  taskDescription?: string | undefined
  sourceNote?: TaskSourceNote | undefined
  liveAgent?: { name: string; startedAt?: string | undefined } | undefined
  activity?: LiveActivity[] | undefined
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
  questions?: AgentQuestionTurn['question'][] | undefined
}

/** Spec ready for the user to approve / revise. */
export interface SpecReviewTurn extends TurnBase {
  kind: 'spec_review'
  taskId: string
  taskTitle: string
  constructionMode: ConstructionMode
  gitStory?: GitStorySnapshot | undefined
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
  constructionMode: ConstructionMode
  gitStory?: GitStorySnapshot | undefined
  escalationId: string
  escalationReason?: string | undefined
  escalationAgentId?: string | undefined
  summary: string
  details?: string | undefined
  externalChecklist?: unknown[] | undefined
  activity?: LiveActivity[] | undefined
}

/** Reviewer feedback returned the task to implementation. */
export interface ReviewFeedbackTurn extends TurnBase {
  kind: 'review_feedback'
  taskId: string
  taskTitle: string
  constructionMode: ConstructionMode
  gitStory?: GitStorySnapshot | undefined
  summary: string
  feedback: string
  revisionCount?: number | undefined
}

export interface HistoryNoteTurn extends TurnBase {
  kind: 'history_note'
  taskId: string
  taskTitle: string
  constructionMode: ConstructionMode
  category: 'source' | 'request' | 'system'
  label: string
  summary: string
  references?: string[] | undefined
  count?: number | undefined
  entries?: Array<{
    at: string
    label: string
    summary: string
  }> | undefined
}

/** Task is currently running; informational, no user action required. */
export interface InFlightTurn extends TurnBase {
  kind: 'inflight'
  taskId: string
  taskTitle: string
  constructionMode: ConstructionMode
  gitStory?: GitStorySnapshot | undefined
  requestKind?: TaskRequest['kind'] | undefined
  requestStage?: RequestStage | undefined
  routingSummary?: string | undefined
  taskDescription?: string | undefined
  sourceNote?: TaskSourceNote | undefined
  taskStatus?: string | undefined
  summary: string
  importedDraft?: boolean | undefined
  shapingBlockers?: TaskShapingBlocker[] | undefined
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
  workerHandoff?: {
    ready: boolean
    cleanupNeeded: boolean
  } | undefined
}

export interface RequestTurn extends TurnBase {
  kind: 'request'
  requestId: string
  taskId?: string | undefined
  rawRequest: string
  title: string
  requestStage: RequestStage
  routingSummary: string
}

export interface PressureTestQuestionTurn extends TurnBase {
  kind: 'pressure_test_question'
  intakeId: string
  targetTitle: string
  domainId: string
  domainTitle: string
  question: {
    id: string
    prompt: string
    why: string
    choices?: string[] | undefined
    selectionMode?: 'single' | 'multiple' | undefined
    evidence: string[]
  }
  answerEndpoint: string
}

export interface BoundedChatTurn extends TurnBase {
  kind: 'bounded_chat'
  sessionId: string
  subObjectiveId: string
  targetTitle: string
  domainTitle: string
  actionHref: string
  question: {
    id: string
    prompt: string
    why: string
    choices?: string[] | undefined
    selectionMode?: 'single' | 'multiple' | undefined
    evidence: string[]
  }
  answerEndpoint: string
}

export type ThreadTurn =
  | SetupStepTurn
  | RequestTurn
  | PressureTestQuestionTurn
  | BoundedChatTurn
  | BriefTurn
  | AgentQuestionTurn
  | SpecReviewTurn
  | HistoryNoteTurn
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
  /** Optional preloaded current tasks to avoid re-reading TASKS.json. */
  tasks?: Task[]
  /** Optional preloaded bounded-chat sessions for current owner-input threads. */
  boundedChatSessions?: BoundedChatSession[]
  /** Optional preloaded pressure-test intakes. */
  pressureTestIntakes?: PressureTestIntake[]
  /** Optional preloaded project check-in summary. */
  projectCheckInSummary?: ProjectCheckInSummary
  /** Current coordinator run status; when stopped, stale task activity should not project as live work. */
  runStatus?: string | undefined
  /** Recent supervisor events, used only for live "agent is currently busy" hints. */
  recentEvents?: Array<{
    at?: string | undefined
    workspaceId?: string | undefined
    event?: {
      type?: string | undefined
      task_id?: string | null | undefined
      agent_name?: string | null | undefined
      tool_name?: string | null | undefined
      message?: string | null | undefined
      output?: string | null | undefined
      reason?: string | null | undefined
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

function requestStageForTask(task: Task, taskStatus: string): RequestStage {
  if (taskStatus !== 'exploring') return 'new_request'
  const notes = Array.isArray(task.notes)
    ? (task.notes as Array<Record<string, unknown>>)
    : []
  return notes.some((note) => {
    const content = typeof note.content === 'string' ? note.content.trim() : ''
    return (
      content.startsWith('Asked Guildhall to enrich this task') ||
      content.startsWith('Asked to enrich this task') ||
      content.startsWith('Enrichment requested from ')
    )
  })
    ? 'task_brief_cleanup'
    : 'new_request'
}

function requestRoutingSummary(request: TaskRequest, stage: RequestStage): string {
  const explicit = typeof request.routingSummary === 'string'
    ? request.routingSummary.trim()
    : ''
  if (explicit && explicit !== 'Routed to Task Intake') return explicit
  if (stage === 'task_brief_cleanup') {
    return 'Guildhall saved this cleanup request and queued the task brief in Thread.'
  }
  return 'Guildhall saved this request and is shaping it into a task brief.'
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
    case 'pressure_test_question':
    case 'bounded_chat':
      return true
    case 'inflight':
      return Boolean(turn.importedDraft)
    default:
      return false
  }
}

function isStaleSetupPressureQuestion(turn: PressureTestQuestionTurn): boolean {
  return /\bsetup\b/i.test([
    turn.targetTitle,
    turn.domainTitle,
    turn.question.prompt,
    turn.question.why,
  ].join(' '))
}

function hasActiveBoundedChatTurn(turns: ThreadTurn[]): boolean {
  return turns.some(turn => turn.kind === 'bounded_chat' && turn.status === 'active')
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

function hasReviewableProductBrief(brief: unknown): brief is {
  userJob?: string
  whyItMattersNow?: string
  successMetric?: string
  successCriteria?: string
  nonGoals?: string[]
  antiPatterns?: string[]
  rolloutPlan?: string
  authoredBy?: string
  approvedAt?: string | null
} {
  if (!brief || typeof brief !== 'object') return false
  const b = brief as {
    userJob?: unknown
    whyItMattersNow?: unknown
    successMetric?: unknown
    successCriteria?: unknown
    nonGoals?: unknown
    antiPatterns?: unknown
  }
  const userJob = typeof b.userJob === 'string' ? b.userJob.trim() : ''
  const whyItMattersNow = typeof b.whyItMattersNow === 'string' ? b.whyItMattersNow.trim() : ''
  const success = typeof b.successMetric === 'string' && b.successMetric.trim()
    ? b.successMetric.trim()
    : typeof b.successCriteria === 'string'
      ? b.successCriteria.trim()
      : ''
  const nonGoals = Array.isArray(b.nonGoals) ? b.nonGoals.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : []
  const antiPatterns = Array.isArray(b.antiPatterns) ? b.antiPatterns.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : []
  return Boolean(userJob && whyItMattersNow && success && (nonGoals.length > 0 || antiPatterns.length > 0))
}

function taskNeedsSpecFill(task: Pick<Task, 'spec' | 'acceptanceCriteria' | 'productBrief'>): boolean {
  return !hasApprovedProductBrief(task) || !hasSpecDraftContent(task)
}

function isQueuedSpecRevision(task: Task): boolean {
  if (taskShapingBlockers(task).length > 0) return false
  return (
    (task.status === 'exploring' || task.status === 'spec_review') &&
    hasSpecDraftContent(task)
  )
}

function firstSpecSummaryLine(spec: string | undefined): string | undefined {
  if (typeof spec !== 'string' || !spec.trim()) return undefined
  const anchor = /^##\s+(?:Summary|What this is)\s*$/im.exec(spec)
  const normalized = anchor ? spec.slice(anchor.index + anchor[0].length).trim() : spec.trim()
  const nextHeadingIndex = normalized.search(/\n##\s|\n###\s/)
  const summaryBlock = (nextHeadingIndex >= 0 ? normalized.slice(0, nextHeadingIndex) : normalized).trim()
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

function truncateSummary(value: string, max = 220): string {
  const singleLine = value.replace(/\s+/g, ' ').trim()
  if (singleLine.length <= max) return singleLine
  return `${singleLine.slice(0, max - 1).trim()}...`
}

function cleanTaskDescription(task: Task): string | undefined {
  const description = typeof task.description === 'string' ? task.description.trim() : ''
  return description ? truncateSummary(description) : undefined
}

function sourceNoteForTask(task: Task): TaskSourceNote | undefined {
  const references: string[] = []
  for (const note of Array.isArray(task.notes) ? task.notes : []) {
    const content = typeof note?.content === 'string' ? note.content.trim() : ''
    const match = content.match(/^Imported from:\s*(.+)$/i)
    if (!match?.[1]) continue
    for (const raw of match[1].split(',')) {
      const ref = raw.trim()
      if (ref && !references.includes(ref)) references.push(ref)
    }
  }
  const description = cleanTaskDescription(task)
  if (references.length === 0 && !description) return undefined
  return { description, references }
}

function noteRole(note: Record<string, unknown>): string {
  return typeof note.role === 'string' ? note.role : ''
}

function noteAgentId(note: Record<string, unknown>): string {
  return typeof note.agentId === 'string' ? note.agentId : ''
}

function noteContent(note: Record<string, unknown>): string {
  return typeof note.content === 'string' ? note.content.trim() : ''
}

function noteTimestamp(note: Record<string, unknown>, fallback: string): string {
  return typeof note.timestamp === 'string' ? note.timestamp : fallback
}

function formatSourceReferences(references: string[]): string {
  const names = references.map((ref) => basename(ref))
  if (names.length === 0) return 'Imported from project notes.'
  if (names.length === 1) return `Imported from ${names[0]}.`
  if (names.length === 2) return `Imported from ${names[0]} and ${names[1]}.`
  return `Imported from ${names[0]}, ${names[1]}, and ${names.length - 2} more sources.`
}

function firstImporterTimestamp(notes: Array<Record<string, unknown>>, fallback: string): string {
  for (const note of notes) {
    if (noteRole(note) !== 'importer') continue
    if (!/^Imported from:\s*/i.test(noteContent(note))) continue
    return noteTimestamp(note, fallback)
  }
  return fallback
}

function firstShapingRequestTimestamp(notes: Array<Record<string, unknown>>, fallback: string): string | null {
  for (const note of notes) {
    if (noteRole(note) !== 'shaping-request') continue
    return noteTimestamp(note, fallback)
  }
  return null
}

function latestReframeRequest(notes: Array<Record<string, unknown>>): { at: string; summary: string } | null {
  for (let index = notes.length - 1; index >= 0; index -= 1) {
    const note = notes[index]
    if (!note) continue
    if (noteRole(note) !== 'human') continue
    const content = noteContent(note)
    if (!/^Asked (?:Guildhall )?to reframe this task\./i.test(content)) continue
    const reason = content.match(/Reason:\s*(.+)$/i)?.[1]?.trim() ?? content
    return {
      at: noteTimestamp(note, new Date().toISOString()),
      summary: truncateSummary(reason),
    }
  }
  return null
}

function latestBriefCleanupRequest(notes: Array<Record<string, unknown>>): { at: string; summary: string } | null {
  for (let index = notes.length - 1; index >= 0; index -= 1) {
    const note = notes[index]
    if (!note) continue
    const content = noteContent(note)
    if (!/^Asked (?:Guildhall )?to enrich this task\b/i.test(content)) continue
    const instruction = content.match(/Note:\s*(.+)$/i)?.[1]?.trim()
    return {
      at: noteTimestamp(note, new Date().toISOString()),
      summary: instruction
        ? truncateSummary(instruction)
        : 'Guildhall was asked to clean up this task brief before worker execution.',
    }
  }
  return null
}

function classifyRecoveryNote(note: Record<string, unknown>): { label: string; summary: string } | null {
  const role = noteRole(note)
  const agentId = noteAgentId(note)
  const content = noteContent(note)
  if (!content) return null

  if (role === 'recovery' && /stale .*claim/i.test(content)) {
    return {
      label: 'Cleared stale spec-agent claim',
      summary: 'A stale active claim was cleared so this task could wait in the shaping queue honestly.',
    }
  }
  if ((role === 'system' || agentId === 'coordinator-recovery') && /deterministic recovery spec seed/i.test(content)) {
    return {
      label: 'Saved deterministic recovery spec seed',
      summary: 'A durable recovery spec seed was saved before retrying the spec lane.',
    }
  }
  if (role === 'bootstrap-failure') {
    return {
      label: 'Recovery blocked on setup',
      summary: firstSentence(stripMarkdown(content)),
    }
  }
  return null
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

function latestPolicyClassificationSummary(notes: Array<Record<string, unknown>>): string | undefined {
  for (let index = notes.length - 1; index >= 0; index -= 1) {
    const note = notes[index]
    if (!note) continue
    if (note.role !== 'policy-classification') continue
    const content = typeof note.content === 'string' ? note.content : ''
    if (!content.trim()) continue
    try {
      const parsed = JSON.parse(content) as { summary?: unknown }
      const summary = typeof parsed.summary === 'string' ? stripMarkdown(parsed.summary) : ''
      if (summary) return summary
    } catch {
      continue
    }
  }
  return undefined
}

function latestRecoveryPlaybookSummary(notes: Array<Record<string, unknown>>): string | undefined {
  for (let index = notes.length - 1; index >= 0; index -= 1) {
    const note = notes[index]
    if (!note) continue
    if (note.role !== 'recovery-playbook') continue
    const content = typeof note.content === 'string' ? note.content : ''
    if (!content.trim()) continue
    try {
      const parsed = JSON.parse(content) as { summary?: unknown; playbook?: unknown; status?: unknown }
      const summary = typeof parsed.summary === 'string' ? stripMarkdown(parsed.summary) : ''
      if (summary) return summary
      const playbook = typeof parsed.playbook === 'string' ? parsed.playbook : ''
      const status = typeof parsed.status === 'string' ? parsed.status : ''
      if (playbook) return `${playbook}${status ? ` ${status}` : ''}`
    } catch {
      continue
    }
  }
  return undefined
}

function latestHumanCorrection(notes: Array<Record<string, unknown>>): string | undefined {
  for (let index = notes.length - 1; index >= 0; index -= 1) {
    const note = notes[index]
    const role = typeof note?.role === 'string' ? note.role : ''
    const agentId = typeof note?.agentId === 'string' ? note.agentId : ''
    const content = typeof note?.content === 'string' ? note.content.trim() : ''
    if (!content) continue
    if (role === 'human' || agentId === 'human' || agentId === 'system:human') return content
  }
  return undefined
}

function compactEscalationDetailsWithPolicy(
  value: string | undefined,
  notes: Array<Record<string, unknown>>,
): string | undefined {
  const base = compactEscalationDetails(value)
  const policy = latestPolicyClassificationSummary(notes)
  const recovery = latestRecoveryPlaybookSummary(notes)
  if (!policy && !recovery) return base
  const prefix = [
    policy ? `Policy read: ${policy}` : '',
    recovery ? `Recovery path: ${recovery}` : '',
  ].filter(Boolean).join(' ')
  const combined = base ? `${prefix} ${base}` : prefix
  return combined.length > 260 ? `${combined.slice(0, 257).trimEnd()}...` : combined
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
  routing: {
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
    actionLabel: 'Open import review',
    actionHref: '/workspace-import',
  },
  firstTask: {
    affordance: 'inline-text',
    actionLabel: 'Start shaping',
    submitEndpoint: '/api/project/intake',
    placeholder: 'Describe the product idea or first outcome',
  },
}

function setupCurrentValue(stepId: string, snap: ProjectSnapshot, projectPath: string): string | undefined {
  if (stepId === 'identity') return snap.config?.name ?? ''
  if (stepId !== 'direction') return undefined
  const briefPath = getProjectSystemStatePath(projectPath, 'project-brief.md')
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

function setupStepTimestamp(stepId: string, status: TurnStatus, snap: ProjectSnapshot): string {
  if (stepId === 'firstTask' && status !== 'done') {
    const bootstrapAt = snap.config?.bootstrap?.verifiedAt
    if (typeof bootstrapAt === 'string' && Number.isFinite(Date.parse(bootstrapAt))) {
      return bootstrapAt
    }
    return new Date().toISOString()
  }
  return new Date(0).toISOString()
}

function taskCountSummary(tasks: Task[]): string {
  if (tasks.length === 0) return 'No tasks have been created yet.'
  const counts = new Map<string, number>()
  for (const task of tasks) {
    const bucket = taskCountBucket(task)
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1)
  }
  const order = ['needs you', 'needs brief', 'open', 'working', 'blocked', 'shelved', 'done', 'unknown']
  const parts = Array.from(counts.entries())
    .sort(([a], [b]) => taskCountBucketRank(a, order) - taskCountBucketRank(b, order))
    .map(([bucket, count]) => `${count} ${bucket}`)
  return `${tasks.length} task${tasks.length === 1 ? '' : 's'} on record: ${parts.join(', ')}.`
}

function taskCountBucketRank(bucket: string, order: string[]): number {
  const index = order.indexOf(bucket)
  return index >= 0 ? index : order.length
}

function taskCountBucket(task: Task): string {
  const status = typeof task.status === 'string' ? task.status : 'unknown'
  if (visibleOpenQuestions(task).length > 0) return 'needs you'
  if (status === 'import_draft') return 'needs brief'
  if (status === 'blocked') return 'blocked'
  if (status === 'shelved') return 'shelved'
  if (status === 'done' || status === 'pending_pr') return 'done'
  if (status === 'in_progress' || status === 'review' || status === 'gate_check') return 'working'
  if (status === 'proposed' || status === 'exploring' || status === 'spec_review' || status === 'ready') return 'open'
  return 'unknown'
}

function coordinatorSummary(snap: ProjectSnapshot): string {
  const coordinators = snap.config?.coordinators ?? []
  if (coordinators.length === 0) return 'No coordinator areas have been saved yet.'
  const names = coordinators
    .map((coordinator) => coordinator.name ?? coordinator.id)
    .filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
  if (names.length === 0) return `${coordinators.length} coordinator area${coordinators.length === 1 ? '' : 's'} saved.`
  return `Coordinator areas: ${names.join(', ')}.`
}

function setupContextSummary(
  stepId: string,
  status: TurnStatus,
  snap: ProjectSnapshot,
  projectPath: string,
  tasks: Task[],
  currentValue: string | undefined,
): SetupStepTurn['contextSummary'] {
  if ((stepId !== 'direction' && stepId !== 'workspaceImport') || status === 'done') return undefined
  const projectName = snap.config?.name?.trim() || basename(projectPath)
  const durableDirection = currentValue?.trim() || setupCurrentValue('direction', snap, projectPath)?.trim()
  const currentRead = durableDirection
    ? `Current read: ${durableDirection}`
    : 'Current read: no durable project direction has been saved yet.'
  const uncertainty = stepId === 'workspaceImport'
    ? 'If these files, priorities, or constraints are stale, correct the project direction or source notes before approving imported tasks. The review should use this snapshot as evidence, not as permanent project truth.'
    : 'If the goal, audience, architecture, priorities, or constraints have changed, add that here. The saved direction is the durable plan input, and it can be revised later as the project changes.'
  return {
    intro: "This is Guildhall's current snapshot from local files and setup state, not permanent project truth.",
    facts: [
      `Project: ${projectName} (${basename(projectPath)}).`,
      currentRead,
      coordinatorSummary(snap),
      snap.bootstrapVerified ? 'Bootstrap has been verified before.' : 'Bootstrap is not verified yet.',
      taskCountSummary(tasks),
    ],
    uncertainty,
  }
}

function phaseForTurn(turn: ThreadTurn): TurnPhase {
  if (turn.kind === 'request') return turn.status === 'done' ? 'done' : 'intake'
  if (turn.kind === 'pressure_test_question') return 'intake'
  if (turn.kind === 'bounded_chat') return 'intake'
  if (turn.kind === 'review_feedback') return turn.phase
  if (turn.status === 'done') return 'done'
  switch (turn.kind) {
    case 'history_note':
      return 'done'
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
  return 'done'
}

function pressureTestTurns(projectPath: string, intakes: PressureTestIntake[]): ThreadTurn[] {
  return intakes.flatMap((intake) => {
    const turns: ThreadTurn[] = [{
      kind: 'request',
      id: `request:${intake.id}`,
      requestId: intake.id,
      rawRequest: intake.rawRequest,
      title: intake.target.title,
      requestStage: 'new_request',
      routingSummary: 'Routed to Pressure-Test Intake',
      at: intake.createdAt,
      persona: 'intake',
      status: 'done',
      phase: 'intake',
    }]

    if (intake.status === 'active' && intake.pendingQuestion) {
      const domain = intake.domains.find(d => d.id === intake.pendingQuestion?.domainId)
      const domainTitle = intake.pendingQuestion.domainId === 'project-planner'
        ? 'Project direction'
        : domain?.title ?? intake.pendingQuestion.domainId
      turns.push({
        kind: 'pressure_test_question',
        id: `pressure-test:${intake.id}:${intake.pendingQuestion.id}`,
        intakeId: intake.id,
        targetTitle: intake.target.title,
        domainId: intake.pendingQuestion.domainId,
        domainTitle,
        question: {
          id: intake.pendingQuestion.id,
          prompt: intake.pendingQuestion.prompt,
          why: intake.pendingQuestion.why,
          choices: intake.pendingQuestion.choices,
          evidence: intake.pendingQuestion.evidence,
        },
        answerEndpoint: `/api/project/pressure-test/${encodeURIComponent(intake.id)}/answer`,
        at: intake.pendingQuestion.askedAt,
        persona: 'intake',
        status: 'active',
        phase: 'intake',
      })
    }

    return turns
  })
}

function boundedChatTurns(projectPath: string, sessions: BoundedChatSession[]): ThreadTurn[] {
  void projectPath
  const turns: ThreadTurn[] = []
  for (const session of sessions) {
    if ((session.status === 'fulfilled' || session.status === 'blocked' || session.status === 'cancelled') && session.closure) {
      turns.push({
        kind: 'request',
        id: `bounded-chat-done:${session.id}`,
        requestId: session.id,
        rawRequest: session.acceptedState.decisions.map(item => item.decision).join('\n'),
        title: session.objective.kind === 'project_check_in'
          ? 'Project check-in complete'
          : isProjectQuestionBoundedChat(session)
            ? 'Project question complete'
            : session.objective.kind === 'new_request'
            ? 'New request complete'
            : `${session.objective.label} complete`,
        requestStage: 'new_request',
        routingSummary: session.closure.summary,
        at: session.closure.closedAt,
        persona: 'intake',
        status: 'done',
        phase: 'done',
      })
      continue
    }
    if (session.status !== 'waiting_for_owner') continue
    const active = session.subObjectives.find(item => item.id === session.activeSubObjectiveId && item.status === 'active')
    if (!active) continue
    turns.push({
      kind: 'bounded_chat',
      id: `bounded-chat:${session.id}:${active.id}`,
      sessionId: session.id,
      subObjectiveId: active.id,
      targetTitle: session.projectId.replace(/-/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase()),
      domainTitle: boundedChatDomainTitle(session),
      actionHref: boundedChatActionHref(session.id),
      question: {
        id: active.id,
        prompt: active.prompt,
        why: active.helperText ?? 'Guildhall needs one clear answer before it shapes future work.',
        choices: active.choices,
        selectionMode: active.selectionMode ?? inferredLegacyBoundedChatSelectionMode(active),
        evidence: session.acceptedState.facts.map(fact => fact.fact),
      },
      answerEndpoint: `/api/project/bounded-chat/${encodeURIComponent(session.id)}/answer`,
      at: session.updatedAt,
      persona: 'intake',
      status: 'active',
      phase: 'intake',
    })
  }
  return turns
}

function inferredLegacyBoundedChatSelectionMode(
  active: Pick<BoundedChatSession['subObjectives'][number], 'prompt' | 'choices'>,
): 'multiple' | undefined {
  const choices = active.choices ?? []
  if (
    /meta-intake task\s+—\s+i need to:?/i.test(active.prompt) &&
    choices.length > 1 &&
    choices.every(choice => /\b(infer|bootstrap|draft|verify|verification|task|tasks|routing|lever)\b/i.test(choice))
  ) {
    return 'multiple'
  }
  return undefined
}

function boundedChatActionHref(sessionId: string): string {
  return `/thread?thread=${encodeURIComponent(sessionId)}`
}

function boundedChatDomainTitle(session: BoundedChatSession): string {
  if (isProjectQuestionBoundedChat(session)) return 'Project question'
  switch (session.objective.kind) {
    case 'new_request':
      return 'New request'
    case 'project_check_in':
      return 'Project check-in'
    case 'structural_review':
      return 'Structural review'
    default:
      return session.objective.label
  }
}

function isProjectQuestionBoundedChat(session: BoundedChatSession): boolean {
  return session.objective.kind === 'new_request' &&
    session.plannerState?.newRequest?.routedRequestKind === 'project_question'
}

function taskRequestTurn(
  task: Task,
  taskId: string,
  taskStatus: string,
  createdAt: string,
  requestStage: RequestStage,
): RequestTurn | null {
  const request = task.request
  if (!request || typeof request !== 'object') return null
  const requestId = typeof request.id === 'string' && request.id.trim()
    ? request.id.trim()
    : `request-${taskId}`
  const rawRequest = typeof request.raw === 'string' ? request.raw : ''
  const title = typeof request.title === 'string' && request.title.trim()
    ? request.title.trim()
    : displayTaskTitle(task)
  const routingSummary = requestRoutingSummary(request, requestStage)
  const pending = taskStatus === 'proposed'
  return {
    kind: 'request',
    id: `request:${requestId}`,
    requestId,
    taskId,
    rawRequest,
    title,
    requestStage,
    routingSummary,
    at: typeof request.createdAt === 'string' ? request.createdAt : createdAt,
    persona: 'intake',
    status: pending ? 'pending' : 'done',
    phase: pending ? 'intake' : 'done',
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
    } else if (isExpectedResearchBudgetRefusal(ev)) {
      continue
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
  const message = typeof ev?.message === 'string' ? ev.message.trim() : ''
  if ((type === 'line_complete' || type === 'error') && isProviderCapacityMessage(message)) {
    return providerCapacityActivityLabel(message)
  }
  const tool = friendlyToolName(typeof ev?.tool_name === 'string' ? ev.tool_name : '')
  if (type === 'tool_started' && tool) return `Started ${tool}`
  if (type === 'tool_completed' && ev?.is_error && tool) return `Failed ${tool}`
  if (type === 'tool_completed' && tool) return `Finished ${tool}`
  if (type === 'assistant_delta') return 'Writing'
  if (type === 'assistant_complete') return 'Finished a thought'
  if (type === 'line_complete' && message) {
    return friendlyActivityText(message)
  }
  return type ? type.replace(/_/g, ' ') : 'Working'
}

function friendlyActivityText(value: string): string {
  const friendly = userFacingText(value, value)
  if (friendly !== value.trim()) return friendly
  if (isProviderCapacityMessage(value)) return providerCapacityActivityLabel(value)
  if (/posted (choice|freeform)?\s*question|yield now|wait for the user's answer|q-\d/i.test(value)) {
    return 'Guildhall asked a question and is waiting for the answer.'
  }
  if (/authoritative likely target file|read-only exploration|refusing further read-only|concrete progress or escalates/i.test(value)) {
    return 'Guildhall is nudging the worker to make a concrete change before reading more files.'
  }
  if (/non-durable steps|moving the implementation forward|mutate, verify, checkpoint, or escalate/i.test(value)) {
    return 'Guildhall is asking the worker to save concrete progress before doing more exploration.'
  }
  if (/research budget exhausted|refusing more read-only tool calls|do not call more read-only tools now/i.test(value)) {
    return 'Guildhall is keeping the worker focused after enough context gathering.'
  }
  if (/\bAC-\d+\b|acceptance criteria except|missing test infrastructure|self-critique has been documented/i.test(value)) {
    return 'Guildhall saved progress, but one verification check still needs a project test command or a manual note before review can finish.'
  }
  if (/routine verification evidence|task proof pack|proof packet|proof packe/i.test(value)) {
    return 'Guildhall needs to save the verification result itself instead of asking you to handle routine test evidence.'
  }
  if (/Shell command succeeded|Treat this command as PASSED|required verification/i.test(value)) {
    return 'Command passed. Guildhall can use it as verification if this task needs it.'
  }
  return value
}

function isProviderCapacityMessage(value: string): boolean {
  return /HTTP 429|Too Many Requests|rate limit|engine_overloaded|Model busy, retry later|retryable provider throttle/i.test(value)
}

function providerCapacityActivityLabel(value: string): string {
  const retry = value.match(/retrying in ([\d.]+)s \(attempt (\d+) of (\d+)\)/i)
  if (retry) return `Provider busy; retrying in ${retry[1]}s (attempt ${retry[2]} of ${retry[3]}).`
  if (/retryable provider throttle/i.test(value)) return 'Provider busy; Guildhall will resume this task later.'
  if (/Agent .* failed on .*API error/i.test(value)) return 'Provider busy; this agent turn stopped.'
  if (/API error/i.test(value)) return 'Provider busy; request failed after retries.'
  return 'Provider busy; retry later.'
}

function providerCapacityDetail(value: string): string {
  const modelBusy = /Model busy, retry later|engine_overloaded/i.test(value)
  if (modelBusy) {
    return 'The remote model provider reported overloaded capacity. This is infrastructure noise, not a task or spec decision.'
  }
  return 'The remote model provider throttled the request. Guildhall can retry when capacity returns.'
}

function isExpectedResearchBudgetRefusal(
  ev: NonNullable<BuildThreadOptions['recentEvents']>[number]['event'],
): boolean {
  if (ev?.type !== 'tool_completed' || !ev.is_error) return false
  const output = String(ev.output ?? ev.message ?? '')
  return /research budget exhausted|refusing more read-only tool calls|do not call more read-only tools now/i.test(output)
}

function friendlyToolName(tool: string): string {
  switch (tool) {
    case 'post-user-question': return 'question'
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
  if (
    (type === 'error' || type === 'line_complete') &&
    isProviderCapacityMessage(String(ev?.message ?? ''))
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
  const friendly = friendlyActivityText(trimmed)
  return friendly.length > 180 ? `${friendly.slice(0, 177)}...` : friendly
}

function toolCompletedDetail(
  ev: NonNullable<BuildThreadOptions['recentEvents']>[number]['event'],
): string | undefined {
  if (ev?.type !== 'tool_completed' && ev?.type !== 'error') return undefined
  const tool = typeof ev?.tool_name === 'string' ? ev.tool_name : ''
  if (
    ev?.type === 'tool_completed' &&
    !ev.is_error &&
    (
      tool === 'read-file' ||
      tool === 'list-files' ||
      tool === 'search-files' ||
      tool === 'read-tasks' ||
      tool === 'read-exploring-transcript'
    )
  ) {
    return undefined
  }
  if (ev?.type === 'tool_completed' && !ev.is_error && tool === 'post-user-question') {
    return 'Guildhall asked a question and is waiting for the answer.'
  }
  if (ev?.type === 'error' && isProviderCapacityMessage(String(ev?.message ?? ''))) {
    return providerCapacityDetail(String(ev?.message ?? ''))
  }
  return truncateDetail(ev?.output ?? ev?.message)
}

function rollingDetail(value: string): string | undefined {
  const compact = friendlyActivityText(value).replace(/\s+/g, ' ').trim()
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
    if (isExpectedResearchBudgetRefusal(ev)) continue
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
          ? { detail: toolCompletedDetail(ev) }
          : {}),
      })
    }
    lastAssistantDeltaTask = type === 'assistant_delta' ? taskId : null
    activity.set(taskId, trimActivityItems(items))
  }
  return activity
}

function latestSupervisorActivity(
  events: BuildThreadOptions['recentEvents'],
): { at: string; label: string; tone: LiveActivity['tone']; message: string } | null {
  const latest = [...(events ?? [])].reverse().find(envelope =>
    ['supervisor_started', 'supervisor_stopped', 'supervisor_error'].includes(String(envelope.event?.type ?? '')),
  )
  const type = latest?.event?.type ?? ''
  const rawMessage = latest?.event?.message
  const message = typeof rawMessage === 'string' && rawMessage.trim()
    ? rawMessage.trim()
    : type === 'supervisor_started'
      ? 'Run started.'
      : type === 'supervisor_error'
        ? 'Run hit an error.'
        : 'Run finished.'
  const label = type === 'supervisor_started'
    ? 'Run started'
    : type === 'supervisor_error'
      ? 'Run error'
      : 'Run finished'
  const tone: LiveActivity['tone'] = type === 'supervisor_started'
    ? 'running'
    : type === 'supervisor_error'
      ? 'danger'
      : 'ok'
  if (!latest || !type) return null
  return {
    at: latest.at ?? new Date().toISOString(),
    label,
    tone,
    message,
  }
}

export function buildThread(opts: BuildThreadOptions): Thread {
  const snap = opts.snapshot ?? buildSnapshot({ projectPath: opts.projectPath })
  const turns: ThreadTurn[] = []
  const tasksPath = getProjectSystemStatePath(opts.projectPath, 'TASKS.json')
  const tasks = opts.tasks ?? (existsSync(tasksPath) ? tasksArray(readJsonSafe(tasksPath)) : [])
  const boundedChats = opts.boundedChatSessions ?? listBoundedChatSessions(getProjectStateDir(opts.projectPath))
  const pressureTests = opts.pressureTestIntakes ?? listPressureTestIntakes(getProjectStateDir(opts.projectPath))
  turns.push(...boundedChatTurns(opts.projectPath, boundedChats))
  turns.push(...pressureTestTurns(opts.projectPath, pressureTests))
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
  // Most setup steps use synthetic timestamps so they sort before real task
  // history. Fresh first-spec setup is user-facing active work, so it gets a
  // real timestamp instead of rendering as decades old.
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
    const currentValue = setupCurrentValue(step.id, snap, opts.projectPath) ?? action.currentValue
    turns.push({
      kind: 'setup_step',
      id: `setup:${step.id}`,
      at: setupStepTimestamp(step.id, status, snap),
      persona: 'intake',
      status,
      phase: status === 'done' ? 'done' : 'setup',
      stepId: step.id,
      title: step.title,
      why: step.why,
      skippable: step.skippable,
      ...action,
      currentValue,
      contextSummary: setupContextSummary(step.id, status, snap, opts.projectPath, tasks, currentValue),
    })
  }

  const projectCheckIn = opts.projectCheckInSummary ?? summarizeProjectCheckIn(getProjectStateDir(opts.projectPath))
  if (projectCheckIn.needed) {
    turns.push({
      kind: 'setup_step',
      id: 'setup:project-check-in',
      at: new Date(3 * 60_000).toISOString(),
      persona: 'intake',
      status: 'pending',
      phase: 'setup',
      stepId: 'projectCheckIn',
      title: projectCheckIn.title,
      why: projectCheckIn.detail,
      skippable: true,
      affordance: 'inline-button',
      actionLabel: 'Start project check-in',
      submitEndpoint: '/api/project/project-check-in',
      contextSummary: {
        intro: 'This project was set up before Guildhall learned to ask these project-level questions.',
        facts: [
          'Existing tasks and settings stay as they are.',
          'This check-in adds context for future requests and release decisions.',
        ],
        uncertainty: 'Guildhall will ask one question at a time in Thread.',
      },
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
    const taskDescription = cleanTaskDescription(t)
    const sourceNote = sourceNoteForTask(t)
    const taskStatus = typeof t.status === 'string' ? t.status : ''
    const requestStage = requestStageForTask(t, taskStatus)
    const requestKind = t.request?.kind
    const routingSummary = t.request ? requestRoutingSummary(t.request, requestStage) : undefined
    const constructionMode = constructionModeForTask(t)
    const createdAt =
      typeof t.createdAt === 'string' ? t.createdAt : new Date().toISOString()
    const requestTurn = taskRequestTurn(t, taskId, taskStatus, createdAt, requestStage)
    if (requestTurn) turns.push(requestTurn)

    const openQs = visibleQuestions<Record<string, unknown>>(t)
    const seenQuestionSignatures = new Set<string>()
    const questionHistory: Array<{
      q: Record<string, unknown>
      qid: string
      askedAt: string
      answeredAt?: string | undefined
      question: AgentQuestionTurn['question']
    }> = []
    for (const q of openQs) {
      const signature = openQuestionSignature(q)
      const answeredAt = typeof q.answeredAt === 'string' ? q.answeredAt : undefined
      if (!answeredAt && signature && seenQuestionSignatures.has(signature)) continue
      const qid = typeof q.id === 'string' ? q.id : ''
      const askedAt = typeof q.askedAt === 'string' ? q.askedAt : createdAt
      if (!qid) continue
      if (!answeredAt && signature) seenQuestionSignatures.add(signature)
      questionHistory.push({
        q,
        qid,
        askedAt,
        answeredAt,
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
    const unansweredQuestions = questionHistory.filter((entry) => !entry.answeredAt)
    const answeredQuestions = questionHistory.filter((entry) => entry.answeredAt)
    const notes = Array.isArray(t.notes)
      ? (t.notes as Array<Record<string, unknown>>)
      : []

    if (sourceNote?.references.length) {
      turns.push({
        kind: 'history_note',
        id: `source:${taskId}`,
        at: firstImporterTimestamp(notes, createdAt),
        persona: 'intake',
        status: 'done',
        phase: 'done',
        taskId,
        taskTitle,
        constructionMode,
        category: 'source',
        label: 'Imported from source',
        summary: formatSourceReferences(sourceNote.references),
        references: sourceNote.references,
      })
    }

    const shapingRequestAt = firstShapingRequestTimestamp(notes, createdAt)
    if (shapingRequestAt) {
      turns.push({
        kind: 'history_note',
        id: `request:${taskId}:shape`,
        at: shapingRequestAt,
        persona: 'intake',
        status: 'done',
        phase: 'done',
        taskId,
        taskTitle,
        constructionMode,
        category: 'request',
        label: 'Asked to shape this task',
        summary: 'This imported draft was sent through shaping before implementation.',
      })
    }

    const reframeRequest = latestReframeRequest(notes)
    if (reframeRequest) {
      turns.push({
        kind: 'history_note',
        id: `request:${taskId}:reframe`,
        at: reframeRequest.at,
        persona: 'intake',
        status: 'done',
        phase: 'done',
        taskId,
        taskTitle,
        constructionMode,
        category: 'request',
        label: 'Asked to reframe this task',
        summary: reframeRequest.summary,
      })
    }

    const briefCleanupRequest = latestBriefCleanupRequest(notes)
    if (briefCleanupRequest) {
      turns.push({
        kind: 'history_note',
        id: `request:${taskId}:brief-cleanup`,
        at: briefCleanupRequest.at,
        persona: 'intake',
        status: 'done',
        phase: 'done',
        taskId,
        taskTitle,
        constructionMode,
        category: 'request',
        label: 'Brief cleanup requested',
        summary: briefCleanupRequest.summary,
      })
    }

    const recoveryEntries = notes
      .map((note) => {
        const classified = classifyRecoveryNote(note)
        if (!classified) return null
        return {
          at: noteTimestamp(note, createdAt),
          label: classified.label,
          summary: classified.summary,
        }
      })
      .filter((entry): entry is { at: string; label: string; summary: string } => Boolean(entry))
    if (recoveryEntries.length > 0) {
      const latest = recoveryEntries[recoveryEntries.length - 1]!
      turns.push({
        kind: 'history_note',
        id: `system:${taskId}:recovery`,
        at: latest.at,
        persona: 'system',
        status: 'done',
        phase: 'done',
        taskId,
        taskTitle,
        constructionMode,
        category: 'system',
        label: 'Recovery history',
        summary: latest.summary,
        count: recoveryEntries.length,
        entries: recoveryEntries,
      })
    }

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
    const hasSpecDraft = hasSpecDraftContent(t)
    if (hasReviewableProductBrief(brief) && unansweredQuestions.length === 0) {
      const briefStillNeedsHuman = !approvedAt && taskStatus === 'exploring' && !hasSpecDraft
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
        constructionMode,
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
        latestUserCorrection: latestHumanCorrection(notes),
      })
    }

    // Open agent questions
    if (unansweredQuestions.length > 0) {
      const first = unansweredQuestions[0]!
      // Agent questions are co-active, but the Thread should still show one
      // state for one task. The UI renders the rest as a subsection.
      turns.push({
        kind: 'agent_question',
        id: unansweredQuestions.length === 1 ? `q:${taskId}:${first.qid}` : `q:${taskId}:questions`,
        at: first.askedAt,
        persona: typeof first.q.askedBy === 'string' && first.q.askedBy.includes('spec')
          ? 'spec'
          : 'coord',
        status: 'active',
        phase: 'intake',
        taskId,
        taskTitle,
        constructionMode,
        taskDescription,
        sourceNote,
        liveAgent,
        activity: liveActivity.get(taskId),
        question: first.question,
        questions: unansweredQuestions.length > 1
          ? unansweredQuestions.map((entry) => entry.question)
          : undefined,
      })
    }
    for (const entry of answeredQuestions) {
      turns.push({
        kind: 'agent_question',
        id: `q:${taskId}:${entry.qid}`,
        at: entry.askedAt,
        persona: typeof entry.q.askedBy === 'string' && entry.q.askedBy.includes('spec')
          ? 'spec'
          : 'coord',
        status: 'done',
        phase: 'done',
        taskId,
        taskTitle,
        constructionMode,
        taskDescription,
        sourceNote,
        liveAgent,
        question: entry.question,
      })
    }

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
      const reviewFeedbackCanDriveCurrentWork = taskStatus === 'in_progress' || taskStatus === 'review'
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
        phase: reviewFeedbackCanDriveCurrentWork &&
          isLatestReviewFeedback &&
          !failureHasMovedPastReview
          ? 'inflight'
          : 'done',
        taskId,
        taskTitle,
        constructionMode,
        summary: compactReviewSummary(content),
        feedback: content,
        revisionCount: reviewIndex + 1,
      })
    }

    const hasUnansweredQuestions = openQs.some(q => !q.answeredAt)
    const hasActiveBriefTurn = hasReviewableProductBrief(brief) && !approvedAt && taskStatus === 'exploring' && !hasSpecDraft
    const importedDraft = taskStatus === 'import_draft' || shouldUseImportDraftState(t)
    const shapingBlockers = taskShapingBlockers(t)
    if (importedDraft && taskId !== leadingImportDraftId) {
      continue
    }

    // Spec review
    const shouldSurfaceSpecReview =
      (taskStatus === 'spec_review' || (taskStatus === 'exploring' && hasSpecDraft)) &&
      specReviewRequiresOwnerApproval(t) &&
      shapingBlockers.length === 0
    if (shouldSurfaceSpecReview && !hasUnansweredQuestions) {
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
        constructionMode,
        spec,
        draftCoordinators,
      })
    }

    if (
      ['import_draft', 'exploring', 'spec_review', 'in_progress', 'gate_check', 'review', 'ready'].includes(taskStatus) &&
      !hasUnansweredQuestions &&
      !hasActiveBriefTurn
    ) {
      const status: TurnStatus = !activeAssigned ? 'active' : 'pending'
      if (status === 'active') activeAssigned = true
      const effectiveLiveAgent = runIsActive ? liveAgent : undefined
      const livePersona = personaForAgent(effectiveLiveAgent?.name)
      const persona = livePersona ?? (taskStatus === 'exploring' || taskStatus === 'import_draft' ? 'spec' : 'worker')
      const queuedSpecRevision = isQueuedSpecRevision(t)
      const needsSpecFill = taskStatus === 'ready' && taskNeedsSpecFill(t)
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
            ? 'Guildhall is drafting a task brief for this imported note now.'
            : taskId === META_INTAKE_TASK_ID
              ? 'Guildhall is inspecting the repo and drafting starter tasks now.'
            : `${friendlyAgentName(effectiveLiveAgent.name)} is working on this now.`
          : taskId === META_INTAKE_TASK_ID
            ? providerSetupPending
              ? 'Setup is waiting on provider configuration before the repo can be inspected.'
              : bootstrapSetupPending
                ? 'Setup checks still need to run before the repo can be inspected.'
                : 'A partial setup draft is saved here.'
          : taskStatus === 'import_draft'
            ? importDraftTasks.length > 1
              ? `Imported draft needs a task brief. ${importDraftTasks.length - 1} more drafts are queued behind it.`
              : 'Imported draft needs a task brief.'
          : taskStatus === 'exploring'
              ? requestStage === 'task_brief_cleanup'
                ? 'Task brief cleanup is queued before worker handoff.'
              : importedDraft
                ? importDraftTasks.length > 1
                  ? `Imported draft has a task brief in progress. ${importDraftTasks.length - 1} more drafts are queued behind it.`
                  : 'Imported draft has a task brief in progress.'
              : requestKind === 'project_question'
                ? 'This can be answered from project context without turning it into implementation work.'
              : queuedSpecRevision
                ? 'Your answers and a spec draft are saved. Coordinator review is next.'
              : 'The spec author is shaping this task.'
            : queuedSpecRevision
              ? 'Your answers and a spec draft are saved. Coordinator review is next.'
            : taskStatus === 'ready'
              ? needsSpecFill
                ? 'Queued, but the task brief or acceptance criteria still need cleanup before a worker should treat this as approved.'
                : 'Approved and queued for work.'
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
        constructionMode,
        requestKind,
        requestStage,
        routingSummary,
        taskDescription,
        sourceNote,
        taskStatus,
        summary,
        importedDraft,
        shapingBlockers: shapingBlockers.length > 0 ? shapingBlockers : undefined,
        liveAgent: effectiveLiveAgent,
        activity: liveActivity.get(taskId),
        checklist:
          (taskStatus === 'exploring' || needsSpecFill) &&
          !queuedSpecRevision &&
          requestKind !== 'project_question' &&
          taskId !== META_INTAKE_TASK_ID &&
          taskId !== 'task-workspace-import' &&
          (!importedDraft || Boolean(liveAgent))
            ? specFillChecklist(opts.projectPath, t)
            : undefined,
        workerHandoff:
          taskStatus === 'ready'
            ? {
                ready: !needsSpecFill,
                cleanupNeeded: needsSpecFill,
              }
            : undefined,
      })
    }

    // Open escalations
    const openEscalations = activeEscalations(t)
    const hasEscalationHistory = Array.isArray(t.escalations) && t.escalations.length > 0
    const fallbackBlockedEscalations = !hasEscalationHistory && openEscalations.length === 0 && t.status === 'blocked' && typeof t.blockReason === 'string' && t.blockReason.trim()
      ? [{
          id: 'block-reason',
          summary: t.blockReason.trim(),
          details: undefined,
          raisedAt: typeof t.updatedAt === 'string' ? t.updatedAt : createdAt,
        }]
      : []
    for (const esc of [...openEscalations, ...fallbackBlockedEscalations]) {
      const escId = typeof esc.id === 'string' ? esc.id : ''
      const at = typeof esc.raisedAt === 'string' ? esc.raisedAt : createdAt
      const reason = 'reason' in esc && typeof esc.reason === 'string' ? esc.reason : ''
      const escalationAgentId = 'agentId' in esc && typeof esc.agentId === 'string'
        ? esc.agentId
        : undefined
      const summary =
        typeof esc.summary === 'string' && esc.summary.trim()
          ? esc.summary
          : reason
            ? reason
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
        constructionMode,
        escalationId: escId,
        escalationReason: reason || undefined,
        escalationAgentId,
        summary,
        details: compactEscalationDetailsWithPolicy(
          typeof esc.details === 'string' ? esc.details : undefined,
          notes,
        ),
        externalChecklist: Array.isArray((esc as { externalChecklist?: unknown }).externalChecklist)
          ? (esc as { externalChecklist: unknown[] }).externalChecklist
          : [],
        activity: liveActivity.get(taskId),
      })
    }
  }

  const latestRunActivity = latestSupervisorActivity(opts.recentEvents)
  const hasTaskActivityTurn = turns.some(turn => turn.kind !== 'setup_step')
  if (latestRunActivity && !hasTaskActivityTurn) {
    turns.push({
      kind: 'inflight',
      id: 'run:recent-activity',
      at: latestRunActivity.at,
      persona: 'coord',
      status: 'done',
      phase: 'done',
      taskId: '__run__',
      taskTitle: 'Project run',
      constructionMode: 'survey',
      taskStatus: 'run_activity',
      summary: latestRunActivity.message,
      activity: [{
        at: latestRunActivity.at,
        label: latestRunActivity.label,
        tone: latestRunActivity.tone,
        detail: latestRunActivity.message,
      }],
    })
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

  const activeFirstTaskSetup = turns.find(
    (turn) => turn.kind === 'setup_step' && turn.stepId === 'firstTask' && turn.status === 'active',
  )
  if (activeFirstTaskSetup) {
    const activePressureQuestions = turns.filter(
      (turn): turn is PressureTestQuestionTurn => turn.kind === 'pressure_test_question' && turn.status === 'active',
    )
    const staleSetupPressureQuestions = activePressureQuestions.filter(isStaleSetupPressureQuestion)
    if (hasActiveBoundedChatTurn(turns) || (activePressureQuestions.length > 0 && staleSetupPressureQuestions.length === 0)) {
      activeFirstTaskSetup.status = 'pending'
    } else {
      for (const turn of staleSetupPressureQuestions) {
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

  if (!turns.some(t => t.status === 'active')) {
    const checkInTurn = turns.find(
      (turn) => turn.kind === 'setup_step' && turn.stepId === 'projectCheckIn' && turn.status === 'pending',
    )
    if (checkInTurn) checkInTurn.status = 'active'
  }

  const activeTurns = turns.filter(t => t.status === 'active')
  const activeTurnId = activeTurns.length > 0 ? activeTurns[activeTurns.length - 1]!.id : null
  const caughtUp = activeTurnId === null && turns.every(t => t.status === 'done')

  return { turns, activeTurnId, caughtUp }
}
