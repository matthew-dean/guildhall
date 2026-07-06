import type { Task } from '@guildhall/core'
import { taskHasRecordedCompletionProof } from './task-completion-proof.js'

export interface ProofMissingDoneTask {
  id: string
  title: string
  unmetCriteriaCount: number
}

function nonEmptyStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : []
}

function nonEmptyArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value.filter(Boolean) : []
}

function passedVerificationRecords(value: unknown): unknown[] {
  return Array.isArray(value)
    ? value.filter(item => Boolean(item && typeof item === 'object' && (item as { status?: unknown }).status === 'passed'))
    : []
}

function unmetAcceptanceCriteriaCount(task: unknown): number {
  const acceptanceCriteria = Array.isArray((task as { acceptanceCriteria?: unknown } | null)?.acceptanceCriteria)
    ? (task as { acceptanceCriteria: unknown[] }).acceptanceCriteria
    : []
  return acceptanceCriteria.filter(criterion => Boolean(
    criterion &&
    typeof criterion === 'object' &&
    (criterion as { met?: unknown }).met === false,
  )).length
}

function proofPathMissingEvidence(proofPath: unknown): boolean {
  if (!proofPath || typeof proofPath !== 'object') return true
  const record = proofPath as Record<string, unknown>
  const expectedEvidence = Array.isArray(record.expectedEvidence) ? record.expectedEvidence : []
  const verificationRecords = Array.isArray(record.verificationRecords) ? record.verificationRecords : []
  const passedEvidence = new Set(
    verificationRecords
      .filter(item => Boolean(item && typeof item === 'object' && (item as { status?: unknown }).status === 'passed'))
      .map(item => (item as { evidenceId?: unknown }).evidenceId)
      .filter((id): id is string => typeof id === 'string' && id.trim().length > 0),
  )
  const requiredEvidenceIds = expectedEvidence
    .filter(item => Boolean(item && typeof item === 'object' && (item as { required?: unknown }).required !== false))
    .map(item => (item as { id?: unknown }).id)
    .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
  if (requiredEvidenceIds.length > 0) {
    return requiredEvidenceIds.some(id => !passedEvidence.has(id))
  }
  if (record.status === 'verified') return false
  return verificationRecords.every(item => !Boolean(item && typeof item === 'object' && (item as { status?: unknown }).status === 'passed'))
}

export function taskDoneButProofMissing(task: unknown): boolean {
  if (!task || typeof task !== 'object') return false
  if (unmetAcceptanceCriteriaCount(task) > 0) return true
  const proofPaths = Array.isArray((task as { proofPaths?: unknown }).proofPaths)
    ? (task as { proofPaths: unknown[] }).proofPaths
    : []
  const handoff = (task as { completionHandoff?: unknown }).completionHandoff
  const handoffObject = handoff && typeof handoff === 'object' && !Array.isArray(handoff)
    ? handoff as Record<string, unknown>
    : null

  const handoffVerified = nonEmptyStringArray(handoffObject?.verified).length > 0 ||
    passedVerificationRecords(handoffObject?.automatedProof).length > 0 ||
    passedVerificationRecords(handoffObject?.manualProof).length > 0 ||
    passedVerificationRecords(handoffObject?.providerProof).length > 0 ||
    nonEmptyArray(handoffObject?.evidenceRefs).length > 0
  const handoffMissing = nonEmptyStringArray(handoffObject?.notVerified).length > 0 ||
    nonEmptyStringArray(handoffObject?.remainingRisks).length > 0

  if (taskHasRecordedCompletionProof(task)) return false
  if (proofPaths.length === 0) return handoffMissing && !handoffVerified
  return proofPaths.some(proofPathMissingEvidence)
}

export function proofMissingDoneTasks(tasks: readonly Task[]): ProofMissingDoneTask[] {
  return tasks
    .filter(task => String((task as { status?: unknown }).status ?? '') === 'done')
    .filter(taskDoneButProofMissing)
    .map(task => {
      const id = typeof task.id === 'string' && task.id.trim() ? task.id.trim() : ''
      const title = typeof task.title === 'string' && task.title.trim() ? task.title.trim() : id || 'completed task'
      return { id, title, unmetCriteriaCount: unmetAcceptanceCriteriaCount(task) }
    })
    .filter(task => task.id.length > 0)
}
