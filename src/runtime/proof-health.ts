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
    return [
      typeof record.reason === 'string' ? record.reason : '',
      typeof record.reasoning === 'string' ? record.reasoning : '',
      typeof record.summary === 'string' ? record.summary : '',
    ].filter(Boolean).join('\n')
  }
  return null
}

function proofRecoveryForTask(task: unknown): Record<string, unknown> | null {
  if (!task || typeof task !== 'object') return null
  const record = task as Record<string, unknown>
  const runtime = record.runtime && typeof record.runtime === 'object' && !Array.isArray(record.runtime)
    ? record.runtime as Record<string, unknown>
    : null
  return record.proofRecovery && typeof record.proofRecovery === 'object' && !Array.isArray(record.proofRecovery)
    ? record.proofRecovery as Record<string, unknown>
    : runtime?.proofRecovery && typeof runtime.proofRecovery === 'object' && !Array.isArray(runtime.proofRecovery)
      ? runtime.proofRecovery as Record<string, unknown>
      : null
}

function proofEvidenceRecordedAfterRecovery(task: Record<string, unknown>, reopenedAt: number): boolean {
  const proofPaths = Array.isArray(task.proofPaths) ? task.proofPaths : []
  const documentedCommands = proofPaths
    .filter((proof): proof is Record<string, unknown> => Boolean(proof) && typeof proof === 'object' && !Array.isArray(proof))
    .filter(proof => proof.kind === 'command' && proof.source === 'documented')
    .map(proof => typeof proof.command === 'string' ? proof.command.trim() : '')
    .filter(Boolean)
  const gateResults = evidencePayloads(task, 'gate_result') ?? (Array.isArray(task.gateResults) ? task.gateResults : [])
  const passedCommandGate = gateResults.some((gate): gate is Record<string, unknown> => {
    if (!gate || typeof gate !== 'object' || Array.isArray(gate)) return false
    const record = gate as Record<string, unknown>
    if (!(record.passed === true || record.status === 'pass' || record.status === 'passed')) return false
    const checkedAt = Date.parse(String(record.checkedAt ?? record.recordedAt ?? ''))
    if (!Number.isFinite(checkedAt) || checkedAt <= reopenedAt || documentedCommands.length === 0) return false
    const candidates = [record.command, record.gateId, record.name, record.output]
      .filter((value): value is string => typeof value === 'string')
      .map(value => value.trim())
      .filter(Boolean)
    return documentedCommands.some(command => candidates.some(candidate => candidate === command || candidate.includes(command)))
  })
  if (passedCommandGate) return true

  return proofPaths.some((proof): proof is Record<string, unknown> => {
    if (!proof || typeof proof !== 'object' || Array.isArray(proof)) return false
    const records = Array.isArray(proof.verificationRecords) ? proof.verificationRecords : []
    return records.some((verification): boolean => {
      if (!verification || typeof verification !== 'object' || Array.isArray(verification)) return false
      const record = verification as Record<string, unknown>
      if (record.status !== 'passed') return false
      const recordedAt = Date.parse(String(record.recordedAt ?? record.updatedAt ?? ''))
      return Number.isFinite(recordedAt) && recordedAt > reopenedAt
    })
  })
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
    const identity = String(gate.gateId ?? gate.command ?? gate.name ?? 'hard-gate')
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
      .map(proof => typeof proof.command === 'string' ? proof.command.trim() : '')
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
    .map(criterion => typeof criterion.command === 'string' ? criterion.command.trim() : '')
    .filter(Boolean))
  const missingCommandCriteria = documentedCommands
    .filter(command => !representedCommands.has(command))
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
  const projectedCriteria = missingCommandCriteria.length > 0
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
  const criteriaChanged = proofSettledCriteria.some((criterion, index) => criterion !== projectedCriteria[index])
  const projectedWithProof = criteriaChanged
    ? { ...projectedTask, acceptanceCriteria: proofSettledCriteria }
    : projectedTask
  const failedHardGate = latestFailedHardGate(projectedWithProof)
  const proofReason = activeProofRecoveryReason(projectedWithProof) || failedHardGateReason(failedHardGate)
  if (!proofReason) return projectedWithProof
  const gateCheckedAt = typeof failedHardGate?.checkedAt === 'string' ? failedHardGate.checkedAt : undefined
  const existingProofState = projectedWithProof.acceptanceCriteriaProofState &&
    typeof projectedWithProof.acceptanceCriteriaProofState === 'object' &&
    !Array.isArray(projectedWithProof.acceptanceCriteriaProofState)
    ? projectedWithProof.acceptanceCriteriaProofState as Record<string, unknown>
    : null
  const staleMetCriteria = proofSettledCriteria.filter(criterion => criterion.met === true)
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
  // Historical approval cannot settle criteria after a newer proof recovery or
  // failed hard gate has reopened the task's completion claim.
  const reviewText = latestApprovingReviewReasoning(task)
  if (!reviewText) return false
  return (
    /\bacceptance-criteria-met\s*:\s*yes\b/i.test(reviewText) ||
    /\ball acceptance criteria (?:are |were )?(?:met|satisfied)\b/i.test(reviewText) ||
    /\bacceptance criteria are satisfied\b/i.test(reviewText)
  )
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

const evidenceStopWords = new Set([
  'about',
  'after',
  'before',
  'bounded',
  'checking',
  'concrete',
  'could',
  'draft',
  'during',
  'evidence',
  'exists',
  'first',
  'from',
  'have',
  'into',
  'local',
  'needed',
  'path',
  'proof',
  'real',
  'records',
  'required',
  'review',
  'should',
  'task',
  'that',
  'this',
  'using',
  'whether',
  'with',
])

function evidenceTokens(value: string): string[] {
  return normalizedText(value)
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map(token => token.trim())
    .filter(token => token.length >= 4 && !evidenceStopWords.has(token))
}

function tokenStem(token: string): string {
  if (token.length > 6 && token.endsWith('ing')) return token.slice(0, -3)
  if (token.length > 5 && token.endsWith('ed')) return token.slice(0, -2)
  if (token.length > 5 && token.endsWith('es')) return token.slice(0, -2)
  if (token.length > 4 && token.endsWith('s')) return token.slice(0, -1)
  return token
}

function tokenCovered(expected: string, evidence: readonly string[]): boolean {
  const expectedStem = tokenStem(expected)
  return evidence.some(candidate => {
    const candidateStem = tokenStem(candidate)
    return candidate === expected ||
      candidateStem === expectedStem ||
      (expected.length >= 5 && candidate.startsWith(expected)) ||
      (candidate.length >= 5 && expected.startsWith(candidate))
  })
}

function expectedEvidenceSemanticallySatisfied(expected: string, evidenceText: string): boolean {
  const expectedTokens = Array.from(new Set(evidenceTokens(expected)))
  if (expectedTokens.length === 0) return false
  const completionTokens = Array.from(new Set(evidenceTokens(evidenceText)))
  if (completionTokens.length === 0) return false
  const covered = expectedTokens.filter(token => tokenCovered(token, completionTokens)).length
  const required = expectedTokens.length <= 4
    ? expectedTokens.length
    : Math.max(3, Math.ceil(expectedTokens.length * 0.55))
  return covered >= required
}

function passedGateResultsForTask(task: unknown): Array<Record<string, unknown>> {
  const gateResults = evidencePayloads(task, 'gate_result') ?? (
    Array.isArray((task as { gateResults?: unknown } | null)?.gateResults)
      ? (task as { gateResults: unknown[] }).gateResults
      : []
  )
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

function completionEvidenceTextForTask(task: unknown): string {
  const record = recordValue(task)
  if (!record) return ''
  const chunks: string[] = [...recordedCompletionProofForTask(task).verified]
  const doneSummary = recordValue(record.doneSummaryBundle)
  const doneSummarySummary = recordValue(doneSummary?.summary)
  for (const value of Object.values(doneSummarySummary ?? {})) {
    if (typeof value === 'string') chunks.push(value)
  }
  for (const gate of evidencePayloads(task, 'gate_result') ?? (Array.isArray(record.gateResults) ? record.gateResults : [])) {
    const gateRecord = recordValue(gate)
    if (!gateRecord) continue
    for (const key of ['command', 'gateId', 'name', 'output']) {
      const value = gateRecord[key]
      if (typeof value === 'string') chunks.push(value)
    }
  }
  for (const verdict of evidencePayloads(task, 'review_verdict') ?? (Array.isArray(record.reviewVerdicts) ? record.reviewVerdicts : [])) {
    const verdictRecord = recordValue(verdict)
    if (!verdictRecord) continue
    for (const key of ['reason', 'reasoning', 'summary']) {
      const value = verdictRecord[key]
      if (typeof value === 'string') chunks.push(value)
    }
  }
  for (const key of ['latestReviewerSummary', 'latestSelfCritique']) {
    const value = record[key]
    if (typeof value === 'string') chunks.push(value)
  }
  return normalizedText(chunks.join('\n')).toLowerCase()
}

export function taskHasNonReviewCommandBackedProof(task: unknown): boolean {
  const record = recordValue(task)
  if (!record) return false
  const doneSummary = recordValue(record.doneSummaryBundle)
  const doneSummarySummary = recordValue(doneSummary?.summary)
  const doneSummaryEvidence = typeof doneSummarySummary?.evidence === 'string'
    ? doneSummarySummary.evidence
    : ''
  if (
    doneSummary?.status === 'done' &&
    /\b(?:pnpm|npm|node|test|script|command|api|deepinfra|model|telemetry|latency|cost|refusal|repetition)\b/i.test(doneSummaryEvidence) &&
    !/\bcontent\.no-truncated-data\b/i.test(doneSummaryEvidence)
  ) {
    return true
  }
  return passedGateResultsForTask(task).some((gate) => {
    const type = normalizedText(gate.type).toLowerCase()
    const text = [
      normalizedText(gate.command),
      normalizedText(gate.gateId),
      normalizedText(gate.name),
      normalizedText(gate.output),
    ].filter(Boolean).join(' ')
    if (!text || /\bcontent\.no-truncated-data\b/i.test(text)) return false
    if (type === 'soft') return false
    return /\b(?:pnpm|npm|node|test|script|command|api|deepinfra|model|telemetry|latency|cost|refusal|repetition|build)\b/i.test(text)
  })
}

function requiresCommandBackedProofText(value: string): boolean {
  return /\b(?:DeepInfra|OpenAI-compatible|provider|model|telemetry|latency|cost|refusal|repetition|voice|pnpm|npm|node|script|command|api)\b/i.test(value)
}

function expectedEvidenceStringsSatisfied(expectedEvidence: unknown[], task: unknown): boolean {
  const expectedStrings = expectedEvidence
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map(item => normalizedText(item).toLowerCase())
  if (expectedStrings.length === 0) return true
  if (expectedStrings.some(requiresCommandBackedProofText) && !taskHasNonReviewCommandBackedProof(task)) {
    return false
  }
  const evidenceText = completionEvidenceTextForTask(task)
  if (!evidenceText) return false
  return expectedStrings.every(expected =>
    evidenceText.includes(expected) ||
    expectedEvidenceSemanticallySatisfied(expected, evidenceText),
  )
}

function requiresProviderProofText(value: string): boolean {
  return /\b(?:DeepInfra|OpenAI-compatible|provider|model|telemetry|latency|cost|refusal|repetition|voice)\b/i.test(value)
}

function reviewProofCanSettleStringEvidenceHint(proofPath: Record<string, unknown>, task: unknown): boolean {
  if (proofPath.kind !== 'review') return false
  const expectedEvidence = Array.isArray(proofPath.expectedEvidence) ? proofPath.expectedEvidence : []
  const expectedStrings = expectedEvidence.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  if (expectedStrings.length === 0) return false
  if (expectedStrings.some(requiresProviderProofText)) return false
  if (!latestApprovingReviewReasoning(task)) return false
  return taskHasRecordedCompletionProof(task)
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
  if (expectedEvidenceStringCount > 0) {
    return !(
      expectedEvidenceStringsSatisfied(expectedEvidence, task) ||
      reviewProofCanSettleStringEvidenceHint(record, task)
    )
  }
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
