import { friendlyStatus } from './display.js'
import {
  hasIncompleteTaskChecklist,
  hasSpecDraftContent,
  isImportedDraftShaping,
  isQueuedSpecRevision,
  needsRecovery,
  needsWorkerHandoffSpecCleanup,
} from './task-state.js'
import { hasUnmetDependencies, type TaskDependencyLite } from './task-dependencies.js'
import type { AcceptanceCriterion, AgentQuestion, ProductBrief } from './types.js'

export type TaskPresentationTone = 'accent' | 'ok' | 'warn' | 'danger' | 'neutral' | 'running'

export interface TaskPresentation {
  key: string
  label: string
  tone: TaskPresentationTone
}

interface TaskPresentationInput {
  id?: string
  taskId?: string
  title?: string
  taskTitle?: string
  status?: string
  taskStatus?: string
  dependsOn?: string[]
  importedDraft?: boolean
  liveAgent?: { name?: string } | unknown
  activity?: Array<{ label: string; tone: 'neutral' | 'running' | 'ok' | 'warn' | 'danger' }>
  checklist?: unknown
  workerHandoff?: {
    ready?: unknown
    cleanupNeeded?: unknown
  }
  phase?: string
  requestKind?: string
  requestStage?: string
  spec?: string
  acceptanceCriteria?: AcceptanceCriterion[]
  productBrief?: ProductBrief
  openQuestions?: AgentQuestion[]
}

export interface TaskPresentationOptions {
  runStatus?: string | null
  availabilityStatus?: string | null
  tasks?: TaskDependencyLite[]
}

function taskId(input: TaskPresentationInput): string | undefined {
  return input.taskId ?? input.id
}

function taskStatus(input: TaskPresentationInput): string | undefined {
  return input.taskStatus ?? input.status
}

function liveAgentName(input: TaskPresentationInput): string | undefined {
  const agent = input.liveAgent
  if (!agent || typeof agent !== 'object') return undefined
  const name = (agent as { name?: unknown }).name
  return typeof name === 'string' ? name : undefined
}

function hasOpenQuestion(input: TaskPresentationInput): boolean {
  return Boolean(input.openQuestions?.some(question => !question.answeredAt && !question.answer))
}

function runIsActive(options: TaskPresentationOptions): boolean {
  return (
    options.runStatus === 'running' ||
    options.runStatus === 'stopping'
  )
}

function canStartTask(input: TaskPresentationInput): boolean {
  return ['ready', 'import_draft', 'exploring', 'in_progress', 'review', 'gate_check'].includes(taskStatus(input) ?? '')
}

function specRevisionQueued(input: TaskPresentationInput): boolean {
  return isQueuedSpecRevision({
    taskStatus: taskStatus(input),
    importedDraft: input.importedDraft,
    liveAgent: input.liveAgent,
    checklist: input.checklist,
    phase: input.phase,
  }) || (
    (taskStatus(input) === 'exploring' || taskStatus(input) === 'spec_review') &&
    !input.importedDraft &&
    !input.liveAgent &&
    !hasOpenQuestion(input) &&
    hasSpecDraftContent(input)
  )
}

export function taskStagePresentation(
  input: TaskPresentationInput,
  options: TaskPresentationOptions = {},
): TaskPresentation {
  const status = taskStatus(input)
  const agentName = liveAgentName(input)

  if (input.status === 'done' || status === 'done') return { key: 'done', label: 'Done', tone: 'ok' }
  if (needsRecovery({ ...input, taskStatus: status })) return { key: 'needs_recovery', label: 'Needs recovery', tone: 'warn' }
  if (hasUnmetDependencies({ id: taskId(input), status, dependsOn: input.dependsOn }, options.tasks)) {
    return { key: 'dependency_blocked', label: 'Blocked', tone: 'danger' }
  }
  if (agentName === 'spec-agent') {
    return { key: 'working', label: 'Working', tone: 'running' }
  }
  if (agentName?.startsWith('coordinator-')) return { key: 'working', label: 'Working', tone: 'running' }
  if (agentName === 'worker-agent') return { key: 'working', label: 'Working', tone: 'running' }
  if (agentName === 'reviewer-agent') return { key: 'review', label: 'Review', tone: 'running' }
  if (agentName === 'gate-checker-agent') return { key: 'gates', label: 'Gates', tone: 'running' }
  if (hasOpenQuestion(input)) return { key: 'needs_you', label: 'Needs you', tone: 'warn' }
  if (input.requestKind === 'project_question') return { key: 'needs_you', label: 'Needs you', tone: 'warn' }
  if (taskId(input) === 'task-meta-intake') return { key: 'setup', label: 'Setup', tone: 'warn' }

  switch (status) {
    case 'import_draft':
      return { key: 'needs_brief', label: 'Needs brief', tone: 'warn' }
    case 'exploring':
      if (input.requestStage === 'task_brief_cleanup') {
        return { key: 'needs_brief', label: 'Needs brief', tone: 'warn' }
      }
      if (input.importedDraft || isImportedDraftShaping({ ...input, taskStatus: status })) {
        return runIsActive(options)
          ? { key: 'queued', label: 'Queued', tone: 'running' }
          : { key: 'paused', label: 'Paused', tone: 'neutral' }
      }
      if (specRevisionQueued(input)) {
        return runIsActive(options)
          ? { key: 'queued', label: 'Queued', tone: 'running' }
          : { key: 'paused', label: 'Paused', tone: 'neutral' }
      }
      return runIsActive(options)
        ? { key: 'queued', label: 'Queued', tone: 'running' }
        : { key: 'paused', label: 'Paused', tone: 'neutral' }
    case 'spec_review':
      if (specRevisionQueued(input)) {
        return runIsActive(options)
          ? { key: 'queued', label: 'Queued', tone: 'running' }
          : { key: 'paused', label: 'Paused', tone: 'neutral' }
      }
      return { key: 'spec_review', label: friendlyStatus(status), tone: 'warn' }
    case 'ready':
      if (needsWorkerHandoffSpecCleanup({ ...input, taskStatus: status })) {
        return { key: 'needs_brief', label: 'Needs brief', tone: 'warn' }
      }
      return runIsActive(options)
        ? { key: 'queued', label: 'Queued', tone: 'running' }
        : { key: 'ready', label: 'Ready', tone: 'ok' }
    case 'in_progress':
      return runIsActive(options)
        ? { key: 'queued', label: 'Queued', tone: 'running' }
        : { key: 'paused', label: 'Paused', tone: 'neutral' }
    case 'review':
      return runIsActive(options)
        ? { key: 'review', label: 'Review', tone: 'ok' }
        : { key: 'review', label: 'Review', tone: 'ok' }
    case 'gate_check':
      return runIsActive(options)
        ? { key: 'gates', label: 'Gates', tone: 'ok' }
        : { key: 'gates', label: 'Gates', tone: 'ok' }
    case 'blocked':
      return { key: 'blocked', label: 'Blocked', tone: 'danger' }
    case 'shelved':
      return { key: 'shelved', label: 'Shelved', tone: 'warn' }
    case 'pending_pr':
      return { key: 'pending_pr', label: 'Pending PR', tone: 'warn' }
    default:
      if (canStartTask(input)) return { key: 'queued', label: 'Queued', tone: 'running' }
      return { key: status ?? 'unknown', label: friendlyStatus(status), tone: 'neutral' }
  }
}
