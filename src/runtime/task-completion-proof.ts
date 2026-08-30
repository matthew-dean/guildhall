export type CompletionProofSource = 'done_summary' | 'gate' | 'review' | 'note'

export interface RecordedCompletionProofEntry {
  text: string
  source: CompletionProofSource
  /** False when the record belongs to an older proof contract. */
  current?: boolean
}

export interface RecordedCompletionProof {
  verified: string[]
  entries: RecordedCompletionProofEntry[]
  latestAt: string | null
}

export interface ClassifiedCompletionProof {
  current: string[]
  historical: string[]
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
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

function proofEvidenceRank(value: string): number {
  if (/^Gate passed: (?!content\.no-truncated-data\b)/i.test(value)) return 1
  if (/^Review evidence:/i.test(value)) return 2
  if (/\bcontent\.no-truncated-data\b/i.test(value)) return 5
  return 4
}

function prioritizeProofEvidence(values: string[]): string[] {
  return [...values].sort((a, b) => proofEvidenceRank(a) - proofEvidenceRank(b))
}

export function classifyCompletionProof(
  recorded: RecordedCompletionProof,
  proofIsStale: boolean,
): ClassifiedCompletionProof {
  const currentEntries = recorded.entries.filter((entry) =>
    entry.current !== false && (!proofIsStale || entry.source !== 'review'),
  )
  const historicalEntries = recorded.entries.filter((entry) =>
    entry.current === false || (proofIsStale && entry.source === 'review'),
  )
  return {
    current: currentEntries.map((entry) => entry.text),
    historical: [...new Set(historicalEntries.map((entry) => entry.text))],
  }
}

export function recordedCompletionProofForTask(task: unknown): RecordedCompletionProof {
  const record = recordValue(task)
  if (!record) return { verified: [], entries: [], latestAt: null }

  const proofPaths = Array.isArray(record.proofPaths)
    ? record.proofPaths.map(recordValue).filter((path): path is Record<string, unknown> => path !== null)
    : []
  const currentEvidenceIds = new Set(
    proofPaths.flatMap(path => Array.isArray(path.expectedEvidence)
      ? path.expectedEvidence
        .map(recordValue)
        .filter((evidence): evidence is Record<string, unknown> => evidence !== null)
        .map(evidence => stringValue(evidence.id))
        .filter((id): id is string => id !== null)
      : []),
  )
  const hasProofContract = proofPaths.length > 0
  const gateIsCurrent = (gate: Record<string, unknown>): boolean => {
    if (!hasProofContract) return true
    return proofPaths.some(path => commandProofGateMatches(path, gate))
  }
  const reviewEvidenceIsCurrent = (verdict: Record<string, unknown>): boolean => {
    if (!hasProofContract) return true
    const evidenceIds = Array.isArray(verdict.proofEvidenceIds)
      ? verdict.proofEvidenceIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
      : []
    return evidenceIds.some(id => currentEvidenceIds.has(id.trim()))
  }

  const entries: RecordedCompletionProofEntry[] = []
  const addEntry = (text: string, source: CompletionProofSource, current = true) => {
    entries.push({ text, source, current })
  }
  const proofDates: string[] = []
  const addProofDate = (value: unknown) => {
    const text = stringValue(value)
    if (!text || Number.isNaN(Date.parse(text))) return
    proofDates.push(text)
  }
  const gateResults = evidencePayloads(task, 'gate_result') ?? (Array.isArray(record.gateResults) ? record.gateResults : [])
  for (const item of gateResults) {
    const gate = recordValue(item)
    if (!gate) continue
    const passed = gate.passed === true || gate.status === 'pass' || gate.status === 'passed'
    if (!passed) continue
    addEntry(
      `Gate passed: ${stringValue(gate.gateId) ?? stringValue(gate.command) ?? stringValue(gate.name) ?? 'recorded gate'}`,
      'gate',
      gateIsCurrent(gate),
    )
    addProofDate(gate.checkedAt)
    addProofDate(gate.recordedAt)
  }

  const reviewVerdicts = evidencePayloads(task, 'review_verdict') ?? (Array.isArray(record.reviewVerdicts) ? record.reviewVerdicts : [])
  for (const item of reviewVerdicts) {
    const verdict = recordValue(item)
    if (!verdict) continue
    const approved = verdict.verdict === 'approve' || verdict.verdict === 'approved' ||
      verdict.decision === 'approve' || verdict.decision === 'approved'
    if (!approved) continue
    const proofEvidenceIds = Array.isArray(verdict.proofEvidenceIds)
      ? verdict.proofEvidenceIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
      : []
    if (proofEvidenceIds.length > 0) {
      for (const evidenceId of proofEvidenceIds) {
        addEntry(`Review evidence: ${evidenceId}`, 'review', reviewEvidenceIsCurrent(verdict))
      }
    } else {
      // Keep a compact audit marker for an approval without treating its prose
      // as proof. Explicit proof paths still require stable evidence IDs.
      addEntry(
        `Review approved: ${stringValue(verdict.reviewerPath) ?? 'recorded review'}`,
        'review',
        !hasProofContract,
      )
    }
    addProofDate(verdict.recordedAt)
  }

  // Compact task reads may intentionally omit the evidence ledger. In that
  // shape, the shared current-proof projection is the authority for the
  // display entries. It is derived from typed path/evidence state; it is not
  // a license to recover completion from reviewer or worker prose.
  const currentProof = recordValue(recordValue(record.currentSummary)?.proof)
  if (entries.every(entry => entry.current !== true) && currentProof?.state === 'proven') {
    const verified = Array.isArray(currentProof.verified)
      ? currentProof.verified.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      : []
    for (const text of verified) addEntry(text, 'gate', true)
  }

  const latestAt = proofDates
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null
  const prioritized = [...entries].sort((a, b) => proofEvidenceRank(a.text) - proofEvidenceRank(b.text))
  return { verified: prioritized.map((entry) => entry.text), entries: prioritized, latestAt }
}

export function taskHasRecordedCompletionProof(task: unknown): boolean {
  return recordedCompletionProofForTask(task).verified.length > 0
}

export function recordedCompletionProofCanSettleTaskStatus(task: unknown): boolean {
  const record = recordValue(task)
  if (!record || !taskHasRecordedCompletionProof(record)) return false
  const status = stringValue(record.status)
  return status === 'done' || status === 'pending_pr' || status === 'blocked'
}

export function latestRecordedCompletionProofAt(task: unknown): string | null {
  return recordedCompletionProofForTask(task).latestAt
}
import { commandProofGateMatches } from '@guildhall/shared'
