import type { Task } from '@guildhall/core'
import { commandProofGateMatches, isCurrentProofPathProven } from '@guildhall/shared'
import { taskHasRecordedCompletionProof } from './task-completion-proof.js'
import { comparableCommand, proofSetupHasTaskIdentity } from './proof-paths.js'
import { reviewVerdictIsNonSubstantiveFailure } from './review-contract.js'

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

function latestApprovingReviewCriteria(task: unknown): Set<string> | null {
  if (!task || typeof task !== 'object') return null
  const reviewVerdicts = evidencePayloads(task, 'review_verdict') ?? (
    Array.isArray((task as { reviewVerdicts?: unknown }).reviewVerdicts)
      ? (task as { reviewVerdicts: unknown[] }).reviewVerdicts
      : []
  )
  for (let index = reviewVerdicts.length - 1; index >= 0; index -= 1) {
    const verdict = reviewVerdicts[index]
    if (!verdict || typeof verdict !== 'object') continue
    const record = verdict as Record<string, unknown>
    if (record.verdict === 'revise' || record.decision === 'revise') return null
    if (record.verdict !== 'approve' && record.verdict !== 'approved' && record.decision !== 'approve' && record.decision !== 'approved') continue
    const ids = Array.isArray(record.acceptedCriteriaIds)
      ? record.acceptedCriteriaIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
      : []
    return new Set(ids)
  }
  return null
}

function proofRecoveryForTask(task: unknown): Record<string, unknown> | null {
  if (!task || typeof task !== 'object') return null
  const record = task as Record<string, unknown>
  const runtime = record.runtime && typeof record.runtime === 'object' && !Array.isArray(record.runtime)
    ? record.runtime as Record<string, unknown>
    : null
  // Promoted current state owns runtime recovery. A task-shaped compatibility
  // field may still be present, but it must not override a newer normalized
  // overlay and make recovery appear settled.
  return runtime?.proofRecovery && typeof runtime.proofRecovery === 'object' && !Array.isArray(runtime.proofRecovery)
    ? runtime.proofRecovery as Record<string, unknown>
    : record.proofRecovery && typeof record.proofRecovery === 'object' && !Array.isArray(record.proofRecovery)
      ? record.proofRecovery as Record<string, unknown>
      : null
}

function proofEvidenceRecordedAfterRecovery(task: Record<string, unknown>, reopenedAt: number): boolean {
  const proofPaths = Array.isArray(task.proofPaths) ? task.proofPaths : []
  const gateResults = evidencePayloads(task, 'gate_result') ?? (Array.isArray(task.gateResults) ? task.gateResults : [])
  const passedGateForPath = (path: Record<string, unknown>): boolean => {
    if (path.kind !== 'command' || path.source !== 'documented') return false
    return gateResults.some((gate): gate is Record<string, unknown> => {
      if (!gate || typeof gate !== 'object' || Array.isArray(gate)) return false
      if (!(gate.passed === true || gate.status === 'pass' || gate.status === 'passed')) return false
      const checkedAt = Date.parse(String(gate.checkedAt ?? gate.recordedAt ?? ''))
      if (!Number.isFinite(checkedAt) || checkedAt <= reopenedAt) return false
      // Gate identity is structured. A gate name or captured output is
      // explanatory text and must never satisfy a command proof by containing
      // the expected words. The shared matcher accepts either the exact
      // normalized command or the stable expected-evidence ID.
      return commandProofGateMatches(path, gate)
    })
  }

  const pathIsProvenAfterRecovery = (proof: unknown): boolean => {
    if (!proof || typeof proof !== 'object' || Array.isArray(proof)) return false
    const path = proof as Record<string, unknown>
    if (passedGateForPath(path)) return true
    const expected = Array.isArray(path.expectedEvidence)
      ? path.expectedEvidence
        .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry))
        .filter(entry => entry.required !== false)
      : []
    const passed = new Set(
      (Array.isArray(path.verificationRecords) ? path.verificationRecords : [])
        .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry))
        .filter(entry => entry.status === 'passed')
        .filter(entry => {
          const recordedAt = Date.parse(String(entry.recordedAt ?? entry.updatedAt ?? ''))
          return Number.isFinite(recordedAt) && recordedAt > reopenedAt
        })
        .map(entry => typeof entry.evidenceId === 'string' ? entry.evidenceId.trim() : '')
        .filter(Boolean),
    )
    if (expected.length > 0) {
      return expected.every(entry => typeof entry.id === 'string' && passed.has(entry.id.trim()))
    }
    return path.status === 'verified' && passed.size > 0
  }

  // Recovery is settled only when the entire current proof contract is
  // proven. Passing an unrelated review path must not retire a missing
  // command path for the selected release.
  return proofPaths.length > 0 && proofPaths.every(pathIsProvenAfterRecovery)
}

export function hasActiveProofRecovery(task: unknown): boolean {
  const proofRecovery = proofRecoveryForTask(task)
  const reopenedAt = typeof proofRecovery?.reopenedAt === 'string' ? Date.parse(proofRecovery.reopenedAt) : NaN
  if (!Number.isFinite(reopenedAt)) return false
  return !proofEvidenceRecordedAfterRecovery(task as Record<string, unknown>, reopenedAt)
}

function hasCurrentFailedHardGate(task: unknown): boolean {
  return latestFailedHardGate(task as Record<string, unknown>) !== null
}

function activeProofRecoveryReason(task: Record<string, unknown>): string {
  const proofRecovery = proofRecoveryForTask(task)
  if (!proofRecovery || !hasActiveProofRecovery(task)) return ''
  return typeof proofRecovery.reason === 'string' && proofRecovery.reason.trim()
    ? proofRecovery.reason.trim()
    : 'Required proof evidence is being recovered.'
}

function latestFailedHardGate(task: Record<string, unknown>): Record<string, unknown> | null {
  const gates = (evidencePayloads(task, 'gate_result') ?? (Array.isArray(task.gateResults) ? task.gateResults : []))
    .filter((gate): gate is Record<string, unknown> => Boolean(gate) && typeof gate === 'object' && !Array.isArray(gate))
  const latestByGate = new Map<string, Record<string, unknown>>()
  for (const gate of gates) {
    if (gate.type !== 'hard') continue
    const identity = String(gate.gateId ?? gate.command ?? 'hard-gate')
    const previous = latestByGate.get(identity)
    const previousAt = Date.parse(String(previous?.checkedAt ?? previous?.recordedAt ?? ''))
    const currentAt = Date.parse(String(gate.checkedAt ?? gate.recordedAt ?? ''))
    if (!previous || currentAt >= previousAt) latestByGate.set(identity, gate)
  }
  return [...latestByGate.values()]
    .filter(gate => gate.passed === false || gate.status === 'fail' || gate.status === 'failed')
    .sort((left, right) => Date.parse(String(right.checkedAt ?? right.recordedAt ?? '')) - Date.parse(String(left.checkedAt ?? left.recordedAt ?? '')))[0] ?? null
}

function failedHardGateReason(gate: Record<string, unknown> | null): string {
  if (!gate) return ''
  const output = typeof gate.output === 'string' ? gate.output.trim() : ''
  if (output) return output
  const gateId = typeof gate.gateId === 'string' ? gate.gateId.trim() : ''
  return gateId ? `${gateId} failed.` : 'A required hard gate failed.'
}

function commandCriterionId(command: string): string {
  const slug = command
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 56)
  return `proof-command-${slug || 'unnamed'}`
}

export function normalizeAcceptanceCriteriaForCurrentProof(task: Record<string, unknown>): Record<string, unknown> {
  const criteria = Array.isArray(task.acceptanceCriteria)
    ? task.acceptanceCriteria.filter((criterion): criterion is Record<string, unknown> =>
        Boolean(criterion) && typeof criterion === 'object' && !Array.isArray(criterion),
      )
    : []
  if (criteria.length === 0) return task

  // Older imported tasks stored the command on the proof path but dropped
  // the relationship from the automated acceptance criterion. Recover that
  // relationship only when the task has one unambiguous command pair; never
  // guess when several criteria or proof paths could be matched.
  const documentedCommands = Array.isArray(task.proofPaths)
    ? [...new Set(task.proofPaths
      .filter((proof): proof is Record<string, unknown> => Boolean(proof) && typeof proof === 'object' && !Array.isArray(proof))
      .filter(proof => proof.kind === 'command' && proof.source === 'documented')
      .map(proof => comparableCommand(proof.command))
      .filter(Boolean))]
    : []
  const unlinkedAutomatedCriteria = criteria.filter(criterion =>
    criterion.verifiedBy === 'automated' &&
    !(typeof criterion.command === 'string' && criterion.command.trim()),
  )
  const commandProjection = documentedCommands.length === 1 && unlinkedAutomatedCriteria.length === 1
    ? documentedCommands[0]
    : null
  const linkedCriteria = commandProjection
    ? criteria.map(criterion => criterion === unlinkedAutomatedCriteria[0]
      ? { ...criterion, command: commandProjection }
      : criterion)
    : criteria
  const representedCommands = new Set(linkedCriteria
    .map(criterion => comparableCommand(criterion.command))
    .filter(Boolean))
  type AcceptanceCriterion = Record<string, unknown>
  const missingCommandCriteria: AcceptanceCriterion[] = documentedCommands
    .filter(command => !representedCommands.has(comparableCommand(command)))
    .map(command => ({
      id: commandCriterionId(command),
      description: `The documented proof command \`${command}\` passes for this task.`,
      scenario: 'Execute the documented local proof path for this task.',
      expectation: `\`${command}\` exits successfully and records durable task evidence.`,
      verifiedBy: 'automated',
      source: 'documented',
      command,
      met: false,
    }))
  const projectedCriteria: AcceptanceCriterion[] = missingCommandCriteria.length > 0
    ? [...linkedCriteria, ...missingCommandCriteria]
    : linkedCriteria
  const projectedTask = commandProjection || missingCommandCriteria.length > 0
    ? { ...task, acceptanceCriteria: projectedCriteria }
    : task

  const proofSettledCriteria = projectedCriteria.map(criterion => {
    if (criterion.met !== false || !commandProofSatisfiedByTask(criterion, projectedTask)) return criterion
    return {
      ...criterion,
      met: true,
      verificationState: 'verified',
      verificationSource: 'passed-command-proof',
    }
  })
  const currentProofPathMissing = Array.isArray(projectedTask.proofPaths) &&
    projectedTask.proofPaths.some(proofPath => proofPathMissingEvidence(proofPath, projectedTask))
  const failedHardGate = latestFailedHardGate(projectedTask)
  const proofReason = activeProofRecoveryReason(projectedTask) ||
    failedHardGateReason(failedHardGate) ||
    (currentProofPathMissing ? 'Current proof evidence is missing.' : '')
  const currentCriteria = proofReason
    ? proofSettledCriteria
    : proofSettledCriteria.map(criterion => {
        if (criterion.met !== true || criterion.verificationState !== 'stale') return criterion
        const {
          persistedMet: _persistedMet,
          staleReason: _staleReason,
          staleGateId: _staleGateId,
          ...settledCriterion
        } = criterion
        return {
          ...settledCriterion,
          met: true,
          verificationState: 'verified',
        }
      })
  const criteriaChanged = currentCriteria.some((criterion, index) => criterion !== projectedCriteria[index])
  const projectedWithProof = criteriaChanged
    ? { ...projectedTask, acceptanceCriteria: currentCriteria }
    : projectedTask
  const existingProofState = projectedWithProof.acceptanceCriteriaProofState &&
    typeof projectedWithProof.acceptanceCriteriaProofState === 'object' &&
    !Array.isArray(projectedWithProof.acceptanceCriteriaProofState)
    ? projectedWithProof.acceptanceCriteriaProofState as Record<string, unknown>
    : null
  if (!proofReason) {
    if (!existingProofState) return projectedWithProof
    const {
      reason: _reason,
      gateId: _gateId,
      checkedAt: _checkedAt,
      staleMetCount: _staleMetCount,
      ...settledProofState
    } = existingProofState
    return {
      ...projectedWithProof,
      acceptanceCriteriaProofState: {
        ...settledProofState,
        state: 'verified',
      },
    }
  }
  const gateCheckedAt = typeof failedHardGate?.checkedAt === 'string' ? failedHardGate.checkedAt : undefined
  const staleMetCriteria = currentCriteria.filter(criterion => criterion.met === true)
  if (staleMetCriteria.length === 0) {
    return {
      ...projectedWithProof,
      acceptanceCriteriaProofState: {
        state: 'blocked',
        reason: proofReason,
        ...(failedHardGate?.gateId ? { gateId: failedHardGate.gateId } : {}),
        ...(gateCheckedAt ? { checkedAt: gateCheckedAt } : {}),
        ...(typeof existingProofState?.staleMetCount === 'number'
          ? { staleMetCount: existingProofState.staleMetCount }
          : {}),
      },
    }
  }

  return {
    ...projectedWithProof,
    acceptanceCriteria: proofSettledCriteria.map(criterion => criterion.met === true
      ? {
          ...criterion,
          met: false,
          persistedMet: true,
          verificationState: 'stale',
          staleReason: proofReason,
          ...(failedHardGate?.gateId ? { staleGateId: failedHardGate.gateId } : {}),
        }
      : criterion),
    acceptanceCriteriaProofState: {
      state: 'blocked',
      reason: proofReason,
      staleMetCount: staleMetCriteria.length,
      ...(failedHardGate?.gateId ? { gateId: failedHardGate.gateId } : {}),
      ...(gateCheckedAt ? { checkedAt: gateCheckedAt } : {}),
    },
  }
}

export function completionProofCanSettleUnmetAcceptanceCriteria(task: unknown): boolean {
  if (!task || typeof task !== 'object') return false
  if (String((task as { status?: unknown }).status ?? '') !== 'done') return false
  if (unmetAcceptanceCriteriaCount(task) === 0) return false
  const criteria = Array.isArray((task as { acceptanceCriteria?: unknown }).acceptanceCriteria)
    ? (task as { acceptanceCriteria: unknown[] }).acceptanceCriteria
    : []
  const unmetCriteria = criteria.filter(criterion => {
    const record = recordValue(criterion)
    return record?.met === false
  })
  const observedProofCriteria = unmetCriteria.filter(criterion => criterionRequiresObservedProof(criterion))
  // A command pass cannot overrule a newer recovery boundary or failed hard
  // gate. The current proof projection must settle those blockers first.
  if (hasActiveProofRecovery(task) || hasCurrentFailedHardGate(task)) return false
  // Review narration can explain a result, but it cannot stand in for an
  // executable command or provider observation named by the criterion.
  const observedCommandCriteria = observedProofCriteria.filter(criterion => {
    const record = recordValue(criterion)
    return typeof record?.command === 'string' && record.command.trim().length > 0
  })
  if (observedCommandCriteria.length !== observedProofCriteria.length ||
    observedCommandCriteria.some(criterion => !commandProofSatisfiedByTask(recordValue(criterion)!, task))) return false
  if (observedProofCriteria.length === unmetCriteria.length) return true
  // Review text is explanatory only. A review can settle review-owned
  // criteria only when the verdict carries the exact criterion IDs it
  // evaluated. This keeps a model's Markdown style out of completion state.
  const acceptedCriteriaIds = latestApprovingReviewCriteria(task)
  if (!acceptedCriteriaIds) return false
  return unmetCriteria.every(criterion => {
    const id = recordValue(criterion)?.id
    return typeof id === 'string' && id.trim().length > 0 && acceptedCriteriaIds.has(id.trim())
  })
}

function criterionRequiresObservedProof(criterion: unknown): boolean {
  const record = recordValue(criterion)
  if (!record || record.met !== false) return false
  if (typeof record.command === 'string' && record.command.trim()) return true
  // The criterion's declared verifier is authoritative. A review-owned
  // criterion may mention voice, model, or another keyword that also appears
  // in command-backed proofs; prose must not silently change its evidence
  // contract.
  if (record.verifiedBy === 'review' || record.verifiedBy === 'human') return false
  if (record.verifiedBy === 'automated' || record.verifiedBy === 'provider') return true
  // An untyped criterion is reviewable by default. Do not infer an evidence
  // owner from prose; intake must persist `verifiedBy` or a command when the
  // criterion truly requires executable/provider proof.
  return false
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
  const fromEvidence = evidencePayloads(task, 'gate_result')
  const gateResults = fromEvidence && fromEvidence.length > 0
    ? fromEvidence
    : Array.isArray((task as { gateResults?: unknown } | null)?.gateResults)
      ? (task as { gateResults: unknown[] }).gateResults
      : []
  return gateResults.filter((gate): gate is Record<string, unknown> =>
    Boolean(
      gate &&
      typeof gate === 'object' &&
      ((gate as { passed?: unknown }).passed === true ||
        (gate as { status?: unknown }).status === 'pass' ||
        (gate as { status?: unknown }).status === 'passed'),
    ),
  )
}

function commandProofSatisfiedByTask(proofPath: Record<string, unknown>, task: unknown): boolean {
  const command = comparableCommand(proofPath.command)
  if (!command) return false
  if (passedGateResultsForTask(task).some((gate) => {
    return gate.gateId === proofPath.id || commandProofGateMatches(proofPath, gate) || comparableCommand(gate.command) === command
  })) return true
  return (Array.isArray(proofPath.verificationRecords) ? proofPath.verificationRecords : [])
    .some(record => {
      if (!record || typeof record !== 'object' || Array.isArray(record) || (record as { status?: unknown }).status !== 'passed') return false
      const verification = record as Record<string, unknown>
      return comparableCommand(verification.command) === command
    })
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function evidencePayloads(task: unknown, kind: string): unknown[] | null {
  const record = recordValue(task)
  if (!record || !Array.isArray(record.evidence)) return null
  return record.evidence.flatMap(event => {
    const eventRecord = recordValue(event)
    return eventRecord?.kind === kind && Object.prototype.hasOwnProperty.call(eventRecord, 'payload')
      ? [eventRecord.payload]
      : []
  })
}

type ReviewVerdictRecord = {
  verdict?: unknown
  reviewerPath?: unknown
  reasoning?: unknown
  llmError?: unknown
  failureCode?: unknown
  recordedAt?: unknown
}

function reviewVerdictsForTask(task: unknown): ReviewVerdictRecord[] {
  const fromEvidence = evidencePayloads(task, 'review_verdict')
    ?.filter((value): value is ReviewVerdictRecord => Boolean(recordValue(value)))
  if (fromEvidence && fromEvidence.length > 0) {
    return [...fromEvidence].sort((left, right) => String(left.recordedAt ?? '').localeCompare(String(right.recordedAt ?? '')))
  }
  const record = recordValue(task)
  const reviewVerdicts = Array.isArray(record?.reviewVerdicts)
    ? record.reviewVerdicts.filter((value): value is ReviewVerdictRecord => Boolean(recordValue(value)))
    : []
  return [...reviewVerdicts].sort((left, right) => String(left.recordedAt ?? '').localeCompare(String(right.recordedAt ?? '')))
}

/** Recovery must not erase a structured reviewer finding. */
export function reviewVerdictLooksNonSubstantive(verdict: ReviewVerdictRecord): boolean {
  return reviewVerdictIsNonSubstantiveFailure(verdict)
}

export function latestFallbackApprovalHasUnresolvedSubstantiveRevision(task: unknown): boolean {
  const verdicts = reviewVerdictsForTask(task)
  const latestApprovalIndex = [...verdicts]
    .map((verdict, index) => ({ verdict, index }))
    .reverse()
    .find(({ verdict }) => verdict.verdict === 'approve')?.index
  if (latestApprovalIndex === undefined) return false

  const latestApproval = verdicts[latestApprovalIndex]
  if (latestApproval?.reviewerPath !== 'deterministic' || typeof latestApproval.llmError !== 'string' || !latestApproval.llmError) {
    return false
  }

  for (let index = latestApprovalIndex - 1; index >= 0; index -= 1) {
    const verdict = verdicts[index]
    if (!verdict) continue
    if (verdict.verdict === 'approve') return false
    if (verdict.verdict === 'revise' && !reviewVerdictLooksNonSubstantive(verdict)) return true
  }
  return false
}

export function taskDoneButReviewConflict(task: unknown): boolean {
  const record = recordValue(task)
  return record?.status === 'done' && latestFallbackApprovalHasUnresolvedSubstantiveRevision(task)
}

export function taskHasNonReviewCommandBackedProof(task: unknown): boolean {
  return passedGateResultsForTask(task).some((gate) => {
    const type = normalizedText(gate.type).toLowerCase()
    // A gate is command-backed because it carries a command field, not
    // because its free-form name or output happens to contain a keyword.
    return type !== 'soft' && normalizedText(gate.command).length > 0
  })
}

function proofPathIsScriptRunnable(proofPath: unknown): boolean {
  if (typeof proofPath === 'string') return proofPath.trim().length > 0
  if (!proofPath || typeof proofPath !== 'object' || Array.isArray(proofPath)) return false
  const record = proofPath as Record<string, unknown>
  if (typeof record.command === 'string' && record.command.trim().length > 0) return true
  const launchSteps = Array.isArray(record.launchSteps) ? record.launchSteps : []
  return launchSteps.some((step) =>
    step &&
    typeof step === 'object' &&
    !Array.isArray(step) &&
    (step as Record<string, unknown>).kind === 'copy_command' &&
    typeof (step as Record<string, unknown>).command === 'string' &&
    String((step as Record<string, unknown>).command).trim().length > 0,
  )
}

/** Keep script-only completion proof in the shared proof authority. */
export function taskHasScriptProofPath(task: unknown): boolean {
  const record = recordValue(task)
  if (!record) return false
  const currentSummary = recordValue(record.currentSummary)
  const currentProof = recordValue(currentSummary?.proof)
  if (currentProof?.hasExecutablePath === true) return true
  if (!Array.isArray(record.proofPaths)) return false
  if (record.proofPaths.some(proofPathIsScriptRunnable)) return true
  // A review description cannot turn a non-executable path into script proof.
  // Script-only releases require an actual command or script path in data.
  return false
}

/** A review contract is enough to reopen executable work without re-intaking its scope. */
export function taskHasReviewProofPath(task: unknown): boolean {
  const record = recordValue(task)
  if (!record || !Array.isArray(record.proofPaths)) return false
  return record.proofPaths.some(path => recordValue(path)?.kind === 'review')
}

function proofPathMissingEvidence(proofPath: unknown, task: unknown): boolean {
  const pathRecord = proofPath && typeof proofPath === 'object' && !Array.isArray(proofPath)
    ? proofPath as Record<string, unknown>
    : null
  const taskRecord = task && typeof task === 'object' && !Array.isArray(task)
    ? task as Record<string, unknown>
    : null
  if (pathRecord && taskRecord && isCurrentProofPathProven(pathRecord, taskRecord)) return false
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
    [
      ...verificationRecords
        .filter(item => Boolean(item && typeof item === 'object' && (item as { status?: unknown }).status === 'passed'))
        .map(item => (item as { evidenceId?: unknown }).evidenceId),
      ...reviewVerdictsForTask(task).flatMap(verdict => {
        if (verdict.verdict !== 'approve') return []
        const proofEvidenceIds = (verdict as { proofEvidenceIds?: unknown }).proofEvidenceIds
        return Array.isArray(proofEvidenceIds) ? proofEvidenceIds : []
      }),
    ].filter((id): id is string => typeof id === 'string' && id.trim().length > 0),
  )
  const requiredEvidenceIds = expectedEvidence
    .filter(item => Boolean(item && typeof item === 'object' && (item as { required?: unknown }).required !== false))
    .map(item => (item as { id?: unknown }).id)
    .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
  if (requiredEvidenceIds.length > 0) {
    return requiredEvidenceIds.some(id => !passedEvidence.has(id))
  }
  // Legacy string-only expectations have no stable identity and therefore
  // cannot be proven. They remain visible for migration/intake repair, but
  // never become complete because a model happened to use similar wording.
  return expectedEvidence.some(item => typeof item === 'string' && item.trim().length > 0) ||
    verificationRecords.every(item => !Boolean(item && typeof item === 'object' && (item as { status?: unknown }).status === 'passed'))
}

export function taskDoneButProofMissing(task: unknown): boolean {
  if (!task || typeof task !== 'object') return false
  const record = task as Record<string, unknown>
  // A proof-setup task is an executable boundary, not a review checkbox.
  // Its acceptance criterion cannot settle completion until it names the
  // containing task, stores a concrete command, and exposes a runnable proof
  // path. Provider narration and stale `met: true` values stay outside the
  // completion authority.
  if (record.semanticKind === 'proof_setup' && (
    !proofSetupHasTaskIdentity(record as Pick<Task, 'hierarchy' | 'delivery' | 'acceptanceCriteria'>) ||
    !taskHasScriptProofPath(task)
  )) return true
  // A reopened proof lane is current work even when an older acceptance
  // criterion or review approval still looks complete. Recovery must be
  // represented in every readiness projection, not only in task detail.
  if (hasActiveProofRecovery(task)) return true
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

  // Handoff prose and bare references are explanatory metadata, not proof.
  // Only structured verification records can settle a current task contract.
  const handoffVerified = passedVerificationRecords(handoffObject?.automatedProof).length > 0 ||
    passedVerificationRecords(handoffObject?.manualProof).length > 0 ||
    passedVerificationRecords(handoffObject?.providerProof).length > 0
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
    // A task with no explicit proof contract is complete when every persisted
    // acceptance criterion is already met. Do not make a prose completion
    // summary mandatory just because the task has no separate proof path.
    if (hasAcceptanceCriteria(task) && unmetAcceptanceCriteriaCount(task) === 0) return false
    if (hasAcceptanceCriteria(task) && !handoffVerified) return true
    return handoffMissing && !handoffVerified
  }
  const proofPathMissing = proofPaths.some(proofPath => proofPathMissingEvidence(proofPath, task))
  if (proofPathMissing) return true
  if (taskHasRecordedCompletionProof(task)) return false
  return false
}

/**
 * A release contract can make executable proof mandatory. Keep that rule in
 * the proof authority so projections and recovery actions agree on whether a
 * completed task is actually releasable.
 */
export function taskDoneButProofMissingForScope(
  task: unknown,
  proofStyle: 'script_only' | 'manual' | 'mixed' | 'unspecified' | null | undefined,
): boolean {
  return taskDoneButProofMissing(task) || (
    proofStyle === 'script_only' &&
    (task as { status?: unknown } | null)?.status === 'done' &&
    !taskHasScriptProofPath(task)
  )
}

export function taskProofIsStale(task: unknown): boolean {
  if (!task || typeof task !== 'object') return false
  return hasActiveProofRecovery(task) || (
    String((task as { status?: unknown }).status ?? '') === 'done' &&
    taskDoneButProofMissing(task)
  )
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
