export interface RecordedCompletionProof {
  verified: string[]
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
  if (!record) return { verified: [] }

  const verified: string[] = []
  const doneSummary = recordValue(record.doneSummaryBundle)
  const doneSummarySummary = recordValue(doneSummary?.summary)
  const doneSummaryEvidence = stringValue(doneSummarySummary?.evidence)
  if (doneSummary?.status === 'done' && doneSummaryEvidence) {
    verified.push(`Done summary: ${doneSummaryEvidence}`)
  }

  const gateResults = Array.isArray(record.gateResults) ? record.gateResults : []
  for (const item of gateResults) {
    const gate = recordValue(item)
    if (!gate) continue
    const passed = gate.passed === true || gate.status === 'pass' || gate.status === 'passed'
    if (!passed) continue
    verified.push(`Gate passed: ${stringValue(gate.gateId) ?? stringValue(gate.command) ?? stringValue(gate.name) ?? 'recorded gate'}`)
  }

  const reviewVerdicts = Array.isArray(record.reviewVerdicts) ? record.reviewVerdicts : []
  for (const item of reviewVerdicts) {
    const verdict = recordValue(item)
    if (!verdict) continue
    const approved = verdict.verdict === 'approve' || verdict.verdict === 'approved' ||
      verdict.decision === 'approve' || verdict.decision === 'approved'
    if (!approved) continue
    verified.push(`Review approved: ${stringValue(verdict.reviewerPath) ?? stringValue(verdict.reviewer) ?? 'recorded review'}`)
  }

  return { verified }
}

export function taskHasRecordedCompletionProof(task: unknown): boolean {
  return recordedCompletionProofForTask(task).verified.length > 0
}
