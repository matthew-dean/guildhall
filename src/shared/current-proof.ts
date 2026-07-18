export interface CurrentProofSummary {
  state: 'none' | 'needed' | 'partial' | 'proven'
  expectationCount: number
  verified: string[]
  missing: string[]
}

type RecordValue = Record<string, unknown>

function recordValue(value: unknown): RecordValue | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as RecordValue
    : null
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function requiredEvidence(path: RecordValue): RecordValue[] {
  return (Array.isArray(path.expectedEvidence) ? path.expectedEvidence : [])
    .map(recordValue)
    .filter((value): value is RecordValue => value !== null && value.required !== false)
}

function expectedEvidenceText(path: RecordValue): string[] {
  return (Array.isArray(path.expectedEvidence) ? path.expectedEvidence : [])
    .flatMap(value => {
      if (typeof value === 'string' && value.trim().length > 0) return [value.trim()]
      const record = recordValue(value)
      const text = stringValue(record?.description) ?? stringValue(record?.summary) ?? stringValue(record?.title)
      return text ? [text] : []
    })
}

function passedEvidenceIds(path: RecordValue): Set<string> {
  return new Set(
    (Array.isArray(path.verificationRecords) ? path.verificationRecords : [])
      .map(recordValue)
      .filter((record): record is RecordValue => record?.status === 'passed')
      .map(record => stringValue(record.evidenceId))
      .filter((id): id is string => id !== null),
  )
}

function proofLabel(path: RecordValue): string {
  return stringValue(path.command) ?? stringValue(path.title) ?? stringValue(path.id) ??
    (path.kind === 'review' ? 'review evidence' : 'recorded proof')
}

function normalizedText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

function evidencePayloads(task: RecordValue, kind: string): RecordValue[] {
  if (!Array.isArray(task.evidence)) return []
  return task.evidence.flatMap(value => {
    const event = recordValue(value)
    const payload = event?.kind === kind ? recordValue(event.payload) : null
    return payload ? [payload] : []
  })
}

function approvedReviewerSummary(task: RecordValue): string | null {
  const text = stringValue(task.latestReviewerSummary)
  if (!text || !/\b(?:verdict|review)\s*:\s*(?:approved|approve)\b/i.test(text.replace(/\*\*/g, ''))) return null
  return text
}

function completionEvidenceText(task: RecordValue): string {
  const parts: string[] = []
  const doneSummary = recordValue(recordValue(task.doneSummaryBundle)?.summary)
  const doneEvidence = stringValue(doneSummary?.evidence)
  if (doneEvidence) parts.push(doneEvidence)
  const gates = [
    ...(Array.isArray(task.gateResults) ? task.gateResults : []).map(recordValue),
    ...evidencePayloads(task, 'gate_result'),
  ]
  for (const gate of gates) {
    if (!gate || !(gate.passed === true || gate.status === 'pass' || gate.status === 'passed')) continue
    for (const field of ['command', 'gateId', 'name', 'output']) {
      const text = stringValue(gate[field])
      if (text) parts.push(text)
    }
  }
  const reviews = [
    ...(Array.isArray(task.reviewVerdicts) ? task.reviewVerdicts : []).map(recordValue),
    ...evidencePayloads(task, 'review_verdict'),
  ]
  for (const review of reviews) {
    if (!review || !['approve', 'approved'].includes(String(review.verdict ?? review.decision))) continue
    for (const field of ['reason', 'reasoning', 'summary']) {
      const text = stringValue(review[field])
      if (text) parts.push(text)
    }
  }
  const reviewerSummary = approvedReviewerSummary(task)
  if (reviewerSummary) parts.push(reviewerSummary)
  const selfCritique = stringValue(task.latestSelfCritique)
  if (selfCritique) parts.push(selfCritique)
  const handoff = recordValue(task.completionHandoff)
  for (const key of ['verified', 'whatCanBeDoneNow', 'howToProveIt']) {
    if (!Array.isArray(handoff?.[key])) continue
    parts.push(...handoff[key].filter((value): value is string => typeof value === 'string'))
  }
  return parts.join('\n')
}

function commandGateMatches(path: RecordValue, task: RecordValue): boolean {
  if (path.kind !== 'command') return false
  const command = stringValue(path.command)
  if (!command || !Array.isArray(task.gateResults)) return false
  return task.gateResults.some(value => {
    const gate = recordValue(value)
    if (!gate || !(gate.passed === true || gate.status === 'pass' || gate.status === 'passed')) return false
    return [gate.command, gate.gateId, gate.name, gate.output]
      .map(value => typeof value === 'string' ? normalizedText(value) : '')
      .filter(Boolean)
      .some(candidate => candidate === normalizedText(command) || candidate.includes(normalizedText(command)))
  })
}

function reviewerProofLabel(task: RecordValue): string | null {
  const text = approvedReviewerSummary(task)
  if (!text) return null
  const line = text
    .split(/\r?\n/)
    .map(value => value.replace(/^\s*[-*]\s*/, '').replace(/\*\*/g, '').trim())
    .filter(Boolean)
    .filter(value => !/\b(?:verdict|review)\s*:\s*(?:approved|approve)\b/i.test(value))
    .find(value => /\b(?:proof|command|script|pnpm|npm|node|test|fixture|reviewer|model|output|evidence)\b/i.test(value))
  return line ? `Reviewer proof: ${line}` : 'Reviewer proof: approved completion evidence.'
}

function pathIsProven(path: RecordValue, task: RecordValue): boolean {
  if (commandGateMatches(path, task)) return true
  const expected = requiredEvidence(path)
  const passed = passedEvidenceIds(path)
  if (expected.length > 0 && expected.every(evidence => {
    const id = stringValue(evidence.id)
    return id !== null && passed.has(id)
  })) return true
  const expectedText = expectedEvidenceText(path).map(normalizedText)
  if (expectedText.length > 0) {
    const evidence = normalizedText(completionEvidenceText(task))
    return expectedText.every(text => evidence.includes(text))
  }
  return expected.length === 0 && path.status === 'verified' && passed.size > 0
}

/** Summarize only the current proof contract; history is deliberately ignored. */
export function summarizeCurrentProof(task: RecordValue): CurrentProofSummary {
  const taskRecord = task
  const paths = (Array.isArray(task.proofPaths) ? task.proofPaths : [])
    .map(recordValue)
    .filter((path): path is RecordValue => path !== null)
  const verified = paths
    .filter(path => pathIsProven(path, taskRecord))
    .map(path => path.kind === 'review'
      ? reviewerProofLabel(taskRecord) ?? `Review approved: ${proofLabel(path)}`
      : `Proof passed: ${proofLabel(path)}`)
  const missing = paths
    .filter(path => !pathIsProven(path, taskRecord))
    .map(path => `Required proof evidence is missing for ${proofLabel(path)}.`)

  if (paths.length === 0) {
    const gates = (Array.isArray(task.gateResults) ? task.gateResults : [])
      .map(recordValue)
      .filter((gate): gate is RecordValue => gate?.passed === true || gate?.status === 'pass' || gate?.status === 'passed')
      .map(gate => `Gate passed: ${stringValue(gate.gateId) ?? stringValue(gate.command) ?? stringValue(gate.name) ?? 'recorded gate'}`)
    const reviews = (Array.isArray(task.reviewVerdicts) ? task.reviewVerdicts : [])
      .map(recordValue)
      .filter((review): review is RecordValue => review?.verdict === 'approve' || review?.verdict === 'approved' || review?.decision === 'approve' || review?.decision === 'approved')
      .map(review => `Review approved: ${stringValue(review.reviewerPath) ?? stringValue(review.reviewer) ?? 'recorded review'}`)
    verified.push(...gates, ...reviews)
  }

  const uniqueVerified = [...new Set(verified)].slice(0, 4)
  const uniqueMissing = [...new Set(missing)].slice(0, 4)
  const status = typeof task.status === 'string' ? task.status : ''
  if (paths.length === 0) {
    if (status !== 'done') {
      return {
        state: 'needed',
        expectationCount: 0,
        verified: [],
        missing: ['Current proof contract has not been attached yet.'],
      }
    }
    return {
      state: uniqueVerified.length > 0 ? 'proven' : 'none',
      expectationCount: 0,
      verified: uniqueVerified,
      missing: [],
    }
  }
  return {
    state: uniqueMissing.length > 0 ? uniqueVerified.length > 0 ? 'partial' : 'needed' : 'proven',
    expectationCount: paths.length,
    verified: uniqueVerified,
    missing: uniqueMissing,
  }
}
