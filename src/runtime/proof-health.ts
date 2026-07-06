import type { Task } from '@guildhall/core'
import { recordedCompletionProofForTask, taskHasRecordedCompletionProof } from './task-completion-proof.js'

export interface ProofMissingDoneTask {
  id: string
  title: string
  unmetCriteriaCount: number
}

export interface AcceptanceCriteriaReconciliation {
  changed: boolean
  reconciledCount: number
  reason: string
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

function hasAcceptanceCriteria(task: unknown): boolean {
  const acceptanceCriteria = Array.isArray((task as { acceptanceCriteria?: unknown } | null)?.acceptanceCriteria)
    ? (task as { acceptanceCriteria: unknown[] }).acceptanceCriteria
    : []
  return acceptanceCriteria.length > 0
}

function latestApprovingReviewReasoning(task: unknown): string | null {
  if (!task || typeof task !== 'object') return null
  const reviewVerdicts = Array.isArray((task as { reviewVerdicts?: unknown }).reviewVerdicts)
    ? (task as { reviewVerdicts: unknown[] }).reviewVerdicts
    : []
  for (let index = reviewVerdicts.length - 1; index >= 0; index -= 1) {
    const verdict = reviewVerdicts[index]
    if (!verdict || typeof verdict !== 'object') continue
    const record = verdict as Record<string, unknown>
    if (record.verdict === 'revise' || record.decision === 'revise') return null
    if (record.verdict !== 'approve' && record.verdict !== 'approved' && record.decision !== 'approve' && record.decision !== 'approved') continue
    return [
      typeof record.reason === 'string' ? record.reason : '',
      typeof record.reasoning === 'string' ? record.reasoning : '',
      typeof record.summary === 'string' ? record.summary : '',
    ].filter(Boolean).join('\n')
  }
  return null
}

export function completionProofCanSettleUnmetAcceptanceCriteria(task: unknown): boolean {
  if (!task || typeof task !== 'object') return false
  if (String((task as { status?: unknown }).status ?? '') !== 'done') return false
  if (unmetAcceptanceCriteriaCount(task) === 0) return false
  const reviewText = latestApprovingReviewReasoning(task)
  if (!reviewText) return false
  return (
    /\bacceptance-criteria-met\s*:\s*yes\b/i.test(reviewText) ||
    /\ball acceptance criteria (?:are |were )?(?:met|satisfied)\b/i.test(reviewText) ||
    /\bacceptance criteria are satisfied\b/i.test(reviewText)
  )
}

export function reconcileAcceptanceCriteriaFromCompletionProof(task: Task, now: string): AcceptanceCriteriaReconciliation {
  if (!completionProofCanSettleUnmetAcceptanceCriteria(task)) {
    return { changed: false, reconciledCount: 0, reason: '' }
  }
  let reconciledCount = 0
  for (const criterion of task.acceptanceCriteria ?? []) {
    if (criterion.met === false) {
      criterion.met = true
      reconciledCount += 1
    }
  }
  if (reconciledCount === 0) return { changed: false, reconciledCount: 0, reason: '' }
  task.notes.push({
    agentId: 'coordinator',
    role: 'evidence-repair',
    content:
      'Guildhall reconciled stale acceptance-criteria flags from later recorded completion proof so the task status, review verdict, and checklist agree.',
    timestamp: now,
  })
  task.updatedAt = now
  return {
    changed: true,
    reconciledCount,
    reason: 'approved review recorded all acceptance criteria as met',
  }
}

function normalizedText(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
}

function passedGateResultsForTask(task: unknown): Array<Record<string, unknown>> {
  const gateResults = Array.isArray((task as { gateResults?: unknown } | null)?.gateResults)
    ? (task as { gateResults: unknown[] }).gateResults
    : []
  return gateResults.filter((gate): gate is Record<string, unknown> =>
    Boolean(
      gate &&
      typeof gate === 'object' &&
      ((gate as { passed?: unknown }).passed === true || (gate as { status?: unknown }).status === 'passed'),
    ),
  )
}

function commandProofSatisfiedByTask(proofPath: Record<string, unknown>, task: unknown): boolean {
  const command = normalizedText(proofPath.command)
  if (!command) return false
  return passedGateResultsForTask(task).some((gate) => {
    const candidates = [
      normalizedText(gate.command),
      normalizedText(gate.gateId),
      normalizedText(gate.name),
      normalizedText(gate.output),
    ].filter(Boolean)
    return candidates.some(candidate => candidate === command || candidate.includes(command))
  })
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function completionEvidenceTextForTask(task: unknown): string {
  const record = recordValue(task)
  if (!record) return ''
  const chunks: string[] = [...recordedCompletionProofForTask(task).verified]
  const doneSummary = recordValue(record.doneSummaryBundle)
  const doneSummarySummary = recordValue(doneSummary?.summary)
  for (const value of Object.values(doneSummarySummary ?? {})) {
    if (typeof value === 'string') chunks.push(value)
  }
  for (const gate of Array.isArray(record.gateResults) ? record.gateResults : []) {
    const gateRecord = recordValue(gate)
    if (!gateRecord) continue
    for (const key of ['command', 'gateId', 'name', 'output']) {
      const value = gateRecord[key]
      if (typeof value === 'string') chunks.push(value)
    }
  }
  for (const verdict of Array.isArray(record.reviewVerdicts) ? record.reviewVerdicts : []) {
    const verdictRecord = recordValue(verdict)
    if (!verdictRecord) continue
    for (const key of ['reason', 'reasoning', 'summary']) {
      const value = verdictRecord[key]
      if (typeof value === 'string') chunks.push(value)
    }
  }
  return normalizedText(chunks.join('\n')).toLowerCase()
}

function expectedEvidenceStringsSatisfied(expectedEvidence: unknown[], task: unknown): boolean {
  const expectedStrings = expectedEvidence
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map(item => normalizedText(item).toLowerCase())
  if (expectedStrings.length === 0) return true
  const evidenceText = completionEvidenceTextForTask(task)
  if (!evidenceText) return false
  return expectedStrings.every(expected => evidenceText.includes(expected))
}

function proofPathMissingEvidence(proofPath: unknown, task: unknown): boolean {
  if (typeof proofPath === 'string' && proofPath.trim().length > 0) {
    return !taskHasRecordedCompletionProof(task)
  }
  if (!proofPath || typeof proofPath !== 'object') return true
  const record = proofPath as Record<string, unknown>
  if (record.kind === 'command' && normalizedText(record.command)) {
    return !commandProofSatisfiedByTask(record, task)
  }
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
  const expectedEvidenceStringCount = expectedEvidence.filter(item => typeof item === 'string' && item.trim().length > 0).length
  if (expectedEvidenceStringCount > 0) return !expectedEvidenceStringsSatisfied(expectedEvidence, task)
  if (record.status === 'verified') return false
  return verificationRecords.every(item => !Boolean(item && typeof item === 'object' && (item as { status?: unknown }).status === 'passed'))
}

export function taskDoneButProofMissing(task: unknown): boolean {
  if (!task || typeof task !== 'object') return false
  if (unmetAcceptanceCriteriaCount(task) > 0) {
    return !completionProofCanSettleUnmetAcceptanceCriteria(task)
  }
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

  const commandProofMissing = proofPaths.some(proofPath =>
    Boolean(
      proofPath &&
      typeof proofPath === 'object' &&
      (proofPath as { kind?: unknown }).kind === 'command' &&
      normalizedText((proofPath as { command?: unknown }).command) &&
      proofPathMissingEvidence(proofPath, task),
    ),
  )
  if (commandProofMissing) return true
  if (proofPaths.length === 0) {
    if (taskHasRecordedCompletionProof(task)) return false
    if (hasAcceptanceCriteria(task) && !handoffVerified) return true
    return handoffMissing && !handoffVerified
  }
  const proofPathMissing = proofPaths.some(proofPath => proofPathMissingEvidence(proofPath, task))
  if (proofPathMissing) return true
  if (taskHasRecordedCompletionProof(task)) return false
  return false
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
