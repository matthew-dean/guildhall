import type { Task } from '@guildhall/core'
import {
  visibleQuestionSignature,
  type QuestionVisibilityRecord,
} from '@guildhall/shared'

type QuestionRecord = QuestionVisibilityRecord & {
  answeredAt?: unknown
  askedAt?: unknown
}

function isTerminalQuestionState(status: string): boolean {
  return status === 'done' || status === 'shelved' || status === 'blocked' || status === 'pending_pr'
}

export function visibleOpenQuestions<T extends QuestionRecord>(task: Task): T[] {
  return visibleQuestions(task).filter((question) => typeof question?.answeredAt !== 'string') as T[]
}

export function visibleQuestions<T extends QuestionRecord>(task: Task): T[] {
  const status = typeof task.status === 'string' ? task.status : ''
  if (isTerminalQuestionState(status)) return []
  const questions = Array.isArray(task.openQuestions) ? (task.openQuestions as unknown as T[]) : []
  const seen = new Set<string>()
  return questions.filter((question) => {
    // Legacy assistant narration may remain in task history, but only a
    // structured question can block dispatch or appear as owner work.
    if (typeof question?.kind !== 'string' || question.kind.trim().length === 0) return false
    const prompt = typeof question.prompt === 'string' ? question.prompt : ''
    const restatement = typeof question.restatement === 'string' ? question.restatement : ''
    if (!(restatement || prompt).includes('?')) return false
    const signature = visibleQuestionSignature(question)
    if (signature && seen.has(signature)) return false
    if (signature) seen.add(signature)
    return true
  })
}

export function taskHasUnansweredVisibleQuestion(task: Task): boolean {
  return visibleOpenQuestions(task).length > 0
}
