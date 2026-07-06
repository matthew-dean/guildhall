export interface RecordedCompletionProof {
  verified: string[]
  latestAt: string | null
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

export function recordedCompletionProofForTask(task: unknown): RecordedCompletionProof {
  const record = recordValue(task)
  if (!record) return { verified: [], latestAt: null }

  const verified: string[] = []
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
    verified.push(`Done summary: ${doneSummaryEvidence}`)
    addProofDate(doneSummary.completedAt)
    addProofDate(doneSummary.createdAt)
  }

  const gateResults = Array.isArray(record.gateResults) ? record.gateResults : []
  for (const item of gateResults) {
    const gate = recordValue(item)
    if (!gate) continue
    const passed = gate.passed === true || gate.status === 'pass' || gate.status === 'passed'
    if (!passed) continue
    verified.push(`Gate passed: ${stringValue(gate.gateId) ?? stringValue(gate.command) ?? stringValue(gate.name) ?? 'recorded gate'}`)
    addProofDate(gate.checkedAt)
    addProofDate(gate.recordedAt)
  }

  const reviewVerdicts = Array.isArray(record.reviewVerdicts) ? record.reviewVerdicts : []
  for (const item of reviewVerdicts) {
    const verdict = recordValue(item)
    if (!verdict) continue
    const approved = verdict.verdict === 'approve' || verdict.verdict === 'approved' ||
      verdict.decision === 'approve' || verdict.decision === 'approved'
    if (!approved) continue
    verified.push(`Review approved: ${stringValue(verdict.reviewerPath) ?? stringValue(verdict.reviewer) ?? 'recorded review'}`)
    addProofDate(verdict.recordedAt)
  }

  const notes = Array.isArray(record.notes) ? record.notes : []
  for (const item of notes) {
    const note = recordValue(item)
    if (!note) continue
    const content = stringValue(note.content)
    if (!content || !/^Closed containing work after linked child tasks completed:/i.test(content)) continue
    verified.push('Containing work closed after linked child tasks completed')
    addProofDate(note.timestamp)
  }

  const latestAt = proofDates
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null
  return { verified, latestAt }
}

export function taskHasRecordedCompletionProof(task: unknown): boolean {
  return recordedCompletionProofForTask(task).verified.length > 0
}

export function latestRecordedCompletionProofAt(task: unknown): string | null {
  return recordedCompletionProofForTask(task).latestAt
}
