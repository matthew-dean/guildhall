import type { Task } from '@guildhall/core'
import {
  isOperationalReceiptQuestion,
  visibleQuestionSignature,
  type QuestionVisibilityRecord,
} from '@guildhall/shared'
import { META_INTAKE_TASK_ID, parseCoordinatorDraft } from './meta-intake.js'
import { isInternalAgentNarration } from './user-facing-text.js'

type QuestionRecord = QuestionVisibilityRecord & {
  answeredAt?: unknown
  askedAt?: unknown
}

function isTerminalQuestionState(status: string): boolean {
  return status === 'done' || status === 'shelved' || status === 'blocked' || status === 'pending_pr'
}

function hasRoutingDraft(taskSpec: string): boolean {
  return !!parseCoordinatorDraft(taskSpec) || /```ya?ml[\s\S]*?\bcoordinators:\b[\s\S]*?```/i.test(taskSpec)
}

function hasConcreteSpecDraft(task: Task): boolean {
  return (
    typeof task.status === 'string' &&
    task.status === 'spec_review' &&
    typeof task.spec === 'string' &&
    task.spec.trim().length > 0 &&
    Array.isArray(task.acceptanceCriteria) &&
    task.acceptanceCriteria.length > 0
  )
}

function questionText(question: QuestionRecord): string {
  const restatement = typeof question.restatement === 'string' ? question.restatement : ''
  const prompt = typeof question.prompt === 'string' ? question.prompt : ''
  return restatement || prompt
}

function isObsoleteMetaRoutingQuestion(taskId: string, taskSpec: string, question: QuestionRecord): boolean {
  if (taskId !== META_INTAKE_TASK_ID) return false
  if (!hasRoutingDraft(taskSpec)) return false
  return /project areas|review lanes|coordinator domains?|coordinators for/i.test(questionText(question))
}

function isObsoleteStarterTaskFocusQuestion(task: Task, question: QuestionRecord): boolean {
  if (!hasConcreteSpecDraft(task)) return false
  const text = questionText(question)
  if (!/what should .*?(first|starter) task focus on|pick the focus for this first task/i.test(text)) {
    return false
  }
  const askedAt = typeof question.askedAt === 'string' ? Date.parse(question.askedAt) : Number.NaN
  const updatedAt = typeof task.updatedAt === 'string' ? Date.parse(task.updatedAt) : Number.NaN
  return !Number.isFinite(askedAt) || !Number.isFinite(updatedAt) || askedAt <= updatedAt
}

export function isObsoleteVisibleQuestion(task: Task, question: QuestionRecord): boolean {
  const taskId = typeof task.id === 'string' ? task.id : ''
  const taskSpec = typeof task.spec === 'string' ? task.spec : ''
  return (
    isOperationalReceiptQuestion(question) ||
    isInternalAgentNarration(questionText(question)) ||
    isObsoleteMetaRoutingQuestion(taskId, taskSpec, question) ||
    isObsoleteStarterTaskFocusQuestion(task, question)
  )
}

export function visibleOpenQuestions<T extends QuestionRecord>(task: Task): T[] {
  const status = typeof task.status === 'string' ? task.status : ''
  if (isTerminalQuestionState(status)) return []
  const questions = Array.isArray(task.openQuestions) ? (task.openQuestions as unknown as T[]) : []
  const seen = new Set<string>()
  return questions.filter((question) => {
    if (typeof question?.answeredAt === 'string') return false
    if (isObsoleteVisibleQuestion(task, question)) return false
    const signature = visibleQuestionSignature(question)
    if (signature && seen.has(signature)) return false
    if (signature) seen.add(signature)
    return true
  })
}

export function taskHasUnansweredVisibleQuestion(task: Task): boolean {
  return visibleOpenQuestions(task).length > 0
}
