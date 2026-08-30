/**
 * Machine-readable contracts emitted by review and worker handoff agents.
 *
 * Human-facing prose is retained for audit and worker guidance, but it is not
 * an input to state transitions, proof settlement, or infrastructure routing.
 */

export type StructuredReviewResult = {
  verdict: 'approve' | 'revise'
  acceptedCriteriaIds: string[]
  proofEvidenceIds: string[]
  findings: Array<{
    targetKind: 'acceptance_criterion' | 'proof_evidence'
    targetId: string
    disposition: 'satisfied' | 'unsatisfied' | 'advisory'
    evidenceRefs: string[]
    workerInstruction?: string
  }>
  /** Audit-only narrative. Operational worker instructions live on findings. */
  revisionItems: string[]
  riskItems: string[]
  followUpItems: string[]
  advisoryScores: {
    recommendationPriority?: 'low' | 'medium' | 'high'
    expectedValue?: 'low' | 'medium' | 'high'
    deferredRisk?: 'low' | 'medium' | 'high'
  }
}

export type StructuredReviewTargets = {
  acceptanceCriterionIds: readonly string[]
  proofEvidenceIds: readonly string[]
}

/**
 * Reject a reviewer result when it names a target outside the review packet or
 * asks for revision without a typed unsatisfied finding. This makes freeform
 * revision text useful context, never an operational conclusion.
 */
export function validateStructuredReviewResultTargets(
  result: StructuredReviewResult,
  targets: StructuredReviewTargets,
): StructuredReviewResult | null {
  const acceptanceCriteria = new Set(targets.acceptanceCriterionIds)
  const proofEvidence = new Set(targets.proofEvidenceIds)
  const targetExists = (finding: StructuredReviewResult['findings'][number]) =>
    finding.targetKind === 'acceptance_criterion'
      ? acceptanceCriteria.has(finding.targetId)
      : proofEvidence.has(finding.targetId)
  if (!result.findings.every(targetExists)) return null

  const satisfiedCriteria = new Set(result.findings
    .filter(finding => finding.targetKind === 'acceptance_criterion' && finding.disposition === 'satisfied')
    .map(finding => finding.targetId))
  const satisfiedEvidence = new Set(result.findings
    .filter(finding => finding.targetKind === 'proof_evidence' && finding.disposition === 'satisfied')
    .map(finding => finding.targetId))
  if (!result.acceptedCriteriaIds.every(id => satisfiedCriteria.has(id)) ||
    !result.proofEvidenceIds.every(id => satisfiedEvidence.has(id))) return null

  const hasUnsatisfiedFinding = result.findings.some(finding => finding.disposition === 'unsatisfied')
  const hasIncompleteWorkerInstruction = result.findings.some(
    finding => finding.disposition === 'unsatisfied' && !finding.workerInstruction,
  )
  if ((result.verdict === 'revise' && !hasUnsatisfiedFinding) ||
    (result.verdict === 'revise' && hasIncompleteWorkerInstruction) ||
    (result.verdict === 'approve' && hasUnsatisfiedFinding)) return null
  return result
}

export type StructuredSelfCritique = {
  acceptanceCriteria: Array<{ id: string; status: 'met' | 'not_met' }>
  changedFiles: string[]
  verificationCommands: Array<{ command: string; status: 'passed' | 'failed' }>
  proofEvidenceIds: string[]
  handoff?: {
    completed: string[]
    knownGaps: string[]
    nextFocus?: string
  }
}

function readNonEmptyIds(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  return value
    .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    .map(id => id.trim())
}

function readStructuredReviewFindings(value: unknown): StructuredReviewResult['findings'] | null {
  if (!Array.isArray(value)) return null
  const findings: StructuredReviewResult['findings'] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
    const record = entry as Record<string, unknown>
    const targetKind = record.targetKind
    const targetId = typeof record.targetId === 'string' ? record.targetId.trim() : ''
    const disposition = record.disposition
    const evidenceRefs = readNonEmptyIds(record.evidenceRefs)
    const workerInstruction = record.workerInstruction === undefined
      ? undefined
      : typeof record.workerInstruction === 'string' && record.workerInstruction.trim().length > 0
        ? record.workerInstruction.trim()
        : null
    if ((targetKind !== 'acceptance_criterion' && targetKind !== 'proof_evidence') ||
      !targetId ||
      (disposition !== 'satisfied' && disposition !== 'unsatisfied' && disposition !== 'advisory') ||
      !evidenceRefs || workerInstruction === null) return null
    findings.push({
      targetKind,
      targetId,
      disposition,
      evidenceRefs,
      ...(workerInstruction ? { workerInstruction } : {}),
    })
  }
  const ids = new Set<string>()
  if (findings.some(finding => {
    const id = `${finding.targetKind}:${finding.targetId}`
    if (ids.has(id)) return true
    ids.add(id)
    return false
  })) return null
  return findings
}

function structuredSelfCritiqueRecord(value: unknown): StructuredSelfCritique | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (!Array.isArray(record.acceptanceCriteria)) return null
  const acceptanceCriteria = record.acceptanceCriteria
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry))
    .map(entry => ({
      id: typeof entry.id === 'string' ? entry.id.trim() : '',
      status: entry.status === 'met' || entry.status === 'not_met' ? entry.status : null,
    }))
  if (acceptanceCriteria.some(entry => !entry.id || !entry.status)) return null
  const changedFiles = readStringArray(record.changedFiles)
  const proofEvidenceIds = readNonEmptyIds(record.proofEvidenceIds)
  const verificationCommands = Array.isArray(record.verificationCommands)
    ? record.verificationCommands
      .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry))
      .map(entry => ({
        command: typeof entry.command === 'string' ? entry.command.trim() : '',
        status: entry.status === 'passed' || entry.status === 'failed' ? entry.status : null,
      }))
    : null
  if (!changedFiles || !proofEvidenceIds || !verificationCommands) return null
  if (verificationCommands.some(entry => !entry.command || !entry.status)) return null
  const rawHandoff = record.handoff
  let handoff: StructuredSelfCritique['handoff'] | undefined
  if (rawHandoff !== undefined) {
    if (!rawHandoff || typeof rawHandoff !== 'object' || Array.isArray(rawHandoff)) return null
    const handoffRecord = rawHandoff as Record<string, unknown>
    const completed = readStringArray(handoffRecord.completed)
    const knownGaps = readStringArray(handoffRecord.knownGaps)
    const nextFocus = handoffRecord.nextFocus === undefined
      ? undefined
      : typeof handoffRecord.nextFocus === 'string' && handoffRecord.nextFocus.trim().length > 0
        ? handoffRecord.nextFocus.trim()
        : null
    if (!completed || !knownGaps || nextFocus === null) return null
    handoff = {
      completed,
      knownGaps,
      ...(nextFocus ? { nextFocus } : {}),
    }
  }
  return {
    acceptanceCriteria: acceptanceCriteria as StructuredSelfCritique['acceptanceCriteria'],
    changedFiles,
    verificationCommands: verificationCommands as StructuredSelfCritique['verificationCommands'],
    proofEvidenceIds,
    ...(handoff ? { handoff } : {}),
  }
}

function readStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  return value
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    .map(entry => entry.trim())
}

function readAdvisoryScores(value: unknown): StructuredReviewResult['advisoryScores'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const record = value as Record<string, unknown>
  const level = (candidate: unknown): 'low' | 'medium' | 'high' | undefined =>
    candidate === 'low' || candidate === 'medium' || candidate === 'high'
      ? candidate
      : undefined
  return {
    ...(level(record.recommendationPriority) ? { recommendationPriority: level(record.recommendationPriority) } : {}),
    ...(level(record.expectedValue) ? { expectedValue: level(record.expectedValue) } : {}),
    ...(level(record.deferredRisk) ? { deferredRisk: level(record.deferredRisk) } : {}),
  }
}

function jsonDocuments(raw: string | undefined): Record<string, unknown>[] {
  if (!raw) return []
  const records: Record<string, unknown>[] = []
  const trimmed = raw.trim()
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        records.push(parsed as Record<string, unknown>)
      }
    } catch {
      // A non-JSON response remains narrative only.
    }
  }
  for (const match of raw.matchAll(/```json\s*([\s\S]*?)```/gi)) {
    try {
      const parsed: unknown = JSON.parse(match[1]!.trim())
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        records.push(parsed as Record<string, unknown>)
      }
    } catch {
      // Invalid JSON is an invalid machine contract. Keep scanning in case a
      // later block is valid, but never fall back to the surrounding prose.
    }
  }
  return records
}

function oneUnambiguous<T>(values: T[], fingerprint: (value: T) => string): T | null {
  if (values.length === 0) return null
  const first = fingerprint(values[0]!)
  return values.every(value => fingerprint(value) === first) ? values[0]! : null
}

function structuredReviewFromRecord(record: Record<string, unknown>): StructuredReviewResult | null {
  if (record.verdict !== 'approve' && record.verdict !== 'revise') return null
  const acceptedCriteriaIds = readNonEmptyIds(record.acceptedCriteriaIds)
  const proofEvidenceIds = readNonEmptyIds(record.proofEvidenceIds)
  if (!acceptedCriteriaIds || !proofEvidenceIds) return null
  const explicitFindings = record.findings === undefined
    ? null
    : readStructuredReviewFindings(record.findings)
  if (record.findings !== undefined && !explicitFindings) return null
  const findings = explicitFindings ?? [
    ...acceptedCriteriaIds.map((targetId) => ({
      targetKind: 'acceptance_criterion' as const,
      targetId,
      disposition: 'satisfied' as const,
      evidenceRefs: [],
    })),
    ...proofEvidenceIds.map((targetId) => ({
      targetKind: 'proof_evidence' as const,
      targetId,
      disposition: 'satisfied' as const,
      evidenceRefs: [],
    })),
  ]
  return {
    verdict: record.verdict,
    acceptedCriteriaIds,
    proofEvidenceIds,
    findings,
    revisionItems: readStringArray(record.revisionItems) ?? [],
    riskItems: readStringArray(record.riskItems) ?? [],
    followUpItems: readStringArray(record.followUpItems) ?? [],
    advisoryScores: readAdvisoryScores(record.advisoryScores),
  }
}

function structuredReviewFromValue(value: unknown): StructuredReviewResult | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return structuredReviewFromRecord(value as Record<string, unknown>)
}

/**
 * Read the machine contract without requiring a model to serialize it into
 * its prose response. `structured` is the preferred channel when a tool
 * note carries it; the JSON-in-text path remains a compatibility boundary for
 * providers that only return text. If both channels are present, they must
 * agree rather than silently choosing whichever happened to parse first.
 */
export function readStructuredReviewResult(
  raw?: string,
  structured?: unknown,
): StructuredReviewResult | null {
  const direct = structuredReviewFromValue(structured)
  const fromText = oneUnambiguous(
    jsonDocuments(raw)
      .map(structuredReviewFromRecord)
      .filter((value): value is StructuredReviewResult => value !== null),
    value => JSON.stringify(value),
  )
  if (direct && fromText && JSON.stringify(direct) !== JSON.stringify(fromText)) return null
  return direct ?? fromText
}

/**
 * Render only structured reviewer fields for worker context. The surrounding
 * model explanation remains audit-only; an invalid or prose-only review
 * produces no worker feedback rather than being scraped.
 */
export function renderStructuredReviewFeedback(raw?: string, structured?: unknown): string {
  const result = readStructuredReviewResult(raw, structured)
  if (!result) return ''
  const lines: string[] = []
  const unsatisfiedFindings = result.findings.filter(finding => finding.disposition === 'unsatisfied')
  if (unsatisfiedFindings.length > 0) {
    lines.push(
      'Required target inspections:',
      ...unsatisfiedFindings.map(finding =>
        `- ${finding.workerInstruction ?? `Inspect ${finding.targetKind.replace(/_/g, ' ')} ${finding.targetId}.`}`,
      ),
    )
  }
  if (result.riskItems.length > 0) {
    lines.push('Risks:', ...result.riskItems.map(item => `- ${item}`))
  }
  if (result.followUpItems.length > 0) {
    lines.push('Non-blocking follow-ups:', ...result.followUpItems.map(item => `- ${item}`))
  }
  if (result.acceptedCriteriaIds.length > 0) {
    lines.push(`Accepted criteria IDs: ${result.acceptedCriteriaIds.join(', ')}`)
  }
  if (result.proofEvidenceIds.length > 0) {
    lines.push(`Verified proof evidence IDs: ${result.proofEvidenceIds.join(', ')}`)
  }
  return lines.join('\n').trim()
}

export function readStructuredSelfCritique(raw: string | undefined, structured?: unknown): StructuredSelfCritique | null {
  const extracted = structuredSelfCritiqueRecord(structured)
  if (extracted) return extracted
  const extractedBeforeNarrativeBound = extractStructuredSelfCritique({ content: raw ?? '' })
  const extractedRecord = structuredSelfCritiqueRecord(extractedBeforeNarrativeBound)
  if (extractedRecord) return extractedRecord
  const candidates = jsonDocuments(raw)
    .map(structuredSelfCritiqueRecord)
    .filter((value): value is StructuredSelfCritique => value !== null)
  return oneUnambiguous(candidates, value => JSON.stringify(value))
}

/**
 * Read only the persisted machine field. Current orchestration uses this
 * boundary; the raw-text reader above exists solely for explicit legacy
 * migration/tests and must not let model prose affect live state.
 */
export function readPersistedStructuredSelfCritique(structured?: unknown): StructuredSelfCritique | null {
  return structuredSelfCritiqueRecord(structured)
}

export function reviewVerdictIsInfrastructureFailure(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const failureCode = (value as { failureCode?: unknown }).failureCode
  return failureCode === 'provider_unavailable' || failureCode === 'provider_timeout'
}

/**
 * A reviewer contract failure is not a product finding. Keep this decision
 * centralized so fan-out, recovery, and readiness cannot accidentally turn a
 * provider outage or model-shaped prose mismatch into worker instructions.
 */
export function reviewVerdictIsNonSubstantiveFailure(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as { verdict?: unknown; failureCode?: unknown }
  return record.verdict === 'revise' && (
    record.failureCode === 'provider_unavailable' ||
    record.failureCode === 'provider_timeout' ||
    record.failureCode === 'invalid_review_contract'
  )
}

export function reviewVerdictHasStructuredApproval(
  verdict: unknown,
  requiredCriteriaIds: readonly string[] = [],
): boolean {
  if (!verdict || typeof verdict !== 'object' || Array.isArray(verdict)) return false
  const record = verdict as Record<string, unknown>
  if (record.verdict !== 'approve' || record.reviewerPath !== 'llm') return false
  const acceptedCriteriaIds = readNonEmptyIds(record.acceptedCriteriaIds)
  if (!acceptedCriteriaIds) return false
  const accepted = new Set(acceptedCriteriaIds)
  return requiredCriteriaIds.every(id => accepted.has(id))
}
import { extractStructuredSelfCritique } from '@guildhall/core'
