export type CompletionProofSource = 'done_summary' | 'gate' | 'review' | 'note'

export interface RecordedCompletionProofEntry {
  text: string
  source: CompletionProofSource
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

function approvedReviewerProofSummary(value: unknown): string | null {
  const text = stringValue(value)
  if (!text) return null
  const normalized = text.replace(/\*\*/g, '')
  if (!/\b(?:verdict|review)\s*:\s*(?:approved|approve)\b/i.test(normalized)) return null
  const lines = text
    .split(/\r?\n/)
    .map(line => line.replace(/^\s*[-*]\s*/, '').replace(/\*\*/g, '').trim())
    .filter(Boolean)
    .filter(line => !/\b(?:verdict|review)\s*:\s*(?:approved|approve)\b/i.test(line))
  const proofLine = lines.find(line => /\b(?:proof|command|script|pnpm|npm|node|test|fixture|reviewer|model|output|evidence)\b/i.test(line))
  return proofLine ? `Reviewer proof: ${proofLine}` : 'Reviewer proof: approved completion evidence.'
}

function reviewerProofFromVerdict(value: Record<string, unknown>): string | null {
  const reasoning = stringValue(value.reasoning)
  if (!reasoning) return null
  const lines = reasoning
    .split(/\r?\n/)
    .map(line => line.replace(/^\s*[-*]\s*/, '').trim())
  const proofLine = lines.find(line => /\b(?:tests?\/|fixtures?\/)/i.test(line)) ??
    lines.find(line => /\b(?:pnpm|npm|node)\b/i.test(line)) ??
    lines.find(line => /\b(?:model|chapter|synopsis|outline|character|voice)\b/i.test(line))
  return proofLine ? `Reviewer proof: ${proofLine}` : null
}

function proofEvidenceRank(value: string): number {
  if (value.startsWith('Reviewer proof:')) return 0
  if (/^Gate passed: (?!content\.no-truncated-data\b)/i.test(value)) return 1
  if (/^Done summary:/i.test(value) && !/\bcontent\.no-truncated-data\b/i.test(value)) return 2
  if (/^Review approved:/i.test(value)) return 3
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
  const currentEntries = proofIsStale
    ? recorded.entries.filter((entry) => entry.source !== 'review')
    : recorded.entries
  const historicalEntries = proofIsStale
    ? recorded.entries.filter((entry) => entry.source === 'review')
    : []
  return {
    current: currentEntries.map((entry) => entry.text),
    historical: historicalEntries.map((entry) => entry.text),
  }
}

export function recordedCompletionProofForTask(task: unknown): RecordedCompletionProof {
  const record = recordValue(task)
  if (!record) return { verified: [], entries: [], latestAt: null }

  const entries: RecordedCompletionProofEntry[] = []
  const addEntry = (text: string, source: CompletionProofSource) => {
    entries.push({ text, source })
  }
  const proofDates: string[] = []
  const addProofDate = (value: unknown) => {
    const text = stringValue(value)
    if (!text || Number.isNaN(Date.parse(text))) return
    proofDates.push(text)
  }
  const doneSummary = recordValue(record.doneSummaryBundle)
  const doneSummarySummary = recordValue(doneSummary?.summary)
  const doneSummaryEvidence = stringValue(doneSummarySummary?.evidence)
  if (doneSummary?.status === 'done' && doneSummaryEvidence) {
    addEntry(`Done summary: ${doneSummaryEvidence}`, 'done_summary')
    addProofDate(doneSummary.completedAt)
    addProofDate(doneSummary.createdAt)
  }

  const gateResults = evidencePayloads(task, 'gate_result') ?? (Array.isArray(record.gateResults) ? record.gateResults : [])
  for (const item of gateResults) {
    const gate = recordValue(item)
    if (!gate) continue
    const passed = gate.passed === true || gate.status === 'pass' || gate.status === 'passed'
    if (!passed) continue
    addEntry(`Gate passed: ${stringValue(gate.gateId) ?? stringValue(gate.command) ?? stringValue(gate.name) ?? 'recorded gate'}`, 'gate')
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
    addEntry(
      reviewerProofFromVerdict(verdict) ?? `Review approved: ${stringValue(verdict.reviewerPath) ?? stringValue(verdict.reviewer) ?? 'recorded review'}`,
      'review',
    )
    addProofDate(verdict.recordedAt)
  }

  const notes = evidencePayloads(task, 'note') ?? (Array.isArray(record.notes) ? record.notes : [])
  for (const item of notes) {
    const note = recordValue(item)
    if (!note) continue
    const content = stringValue(note.content)
    if (!content || !/^Closed containing work after linked child tasks completed:/i.test(content)) continue
    addEntry('Containing work closed after linked child tasks completed', 'note')
    addProofDate(note.timestamp)
  }

  const latestReviewerSummary = approvedReviewerProofSummary(record.latestReviewerSummary)
  if (latestReviewerSummary) addEntry(latestReviewerSummary, 'review')

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
