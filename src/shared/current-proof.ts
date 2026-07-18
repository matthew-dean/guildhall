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
  return stringValue(path.command) ?? stringValue(path.title) ?? stringValue(path.id) ?? 'recorded proof'
}

function pathIsProven(path: RecordValue): boolean {
  const expected = requiredEvidence(path)
  const passed = passedEvidenceIds(path)
  if (expected.length > 0) return expected.every(evidence => {
    const id = stringValue(evidence.id)
    return id !== null && passed.has(id)
  })
  return path.status === 'verified' && passed.size > 0
}

/** Summarize only the current proof contract; history is deliberately ignored. */
export function summarizeCurrentProof(task: RecordValue): CurrentProofSummary {
  const paths = (Array.isArray(task.proofPaths) ? task.proofPaths : [])
    .map(recordValue)
    .filter((path): path is RecordValue => path !== null)
  const verified = paths
    .filter(pathIsProven)
    .map(path => path.kind === 'review' ? `Review approved: ${proofLabel(path)}` : `Proof passed: ${proofLabel(path)}`)
  const missing = paths
    .filter(path => !pathIsProven(path))
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
