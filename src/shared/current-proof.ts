export interface CurrentProofSummary {
  state: 'none' | 'needed' | 'partial' | 'proven'
  expectationCount: number
  verified: string[]
  missing: string[]
  /** The current contract includes an executable command/script path. */
  hasExecutablePath?: boolean
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

function passedStructuredReviewEvidenceIds(task: RecordValue): Set<string> {
  const recordedReviews = evidencePayloads(task, 'review_verdict')
  const projectedReviews = Array.isArray(task.reviewVerdicts)
    ? task.reviewVerdicts.map(recordValue).filter((value): value is RecordValue => value !== null)
    : []
  const latest = [...recordedReviews, ...projectedReviews]
    .map((review, index) => ({
      review,
      index,
      recordedAt: Date.parse(String(review.recordedAt ?? '')),
    }))
    .filter(({ review }) =>
      review.verdict === 'approve' || review.decision === 'approve' ||
      review.verdict === 'revise' || review.decision === 'revise')
    .sort((left, right) => {
      const leftAt = Number.isFinite(left.recordedAt) ? left.recordedAt : Number.NEGATIVE_INFINITY
      const rightAt = Number.isFinite(right.recordedAt) ? right.recordedAt : Number.NEGATIVE_INFINITY
      return leftAt - rightAt || left.index - right.index
    })
    .at(-1)?.review
  if (!latest || (latest.verdict !== 'approve' && latest.decision !== 'approve')) return new Set()
  const proofIds = Array.isArray(latest.proofEvidenceIds)
    ? latest.proofEvidenceIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    : []
  const acceptedCriteriaIds = Array.isArray(latest.acceptedCriteriaIds)
    ? latest.acceptedCriteriaIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    : []
  // Generated review paths deliberately reuse the exact acceptance-criterion
  // id. In that typed case the criterion approval is the observed review
  // evidence; distinct proof ids still require explicit proofEvidenceIds.
  return new Set([...proofIds, ...acceptedCriteriaIds])
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
    return payload ? [{ ...(stringValue(event?.recordedAt) ? { recordedAt: event!.recordedAt } : {}), ...payload }] : []
  })
}

/**
 * A hard gate is allowed to identify a command proof in either of the two
 * typed ways emitted by the gate runner: the normalized command itself, or
 * the stable expected-evidence ID assigned to the acceptance criterion.
 *
 * The latter matters for commands that are normalized at execution time (for
 * example `pnpm exec ...`) and for older current rows that retained the path
 * command but not the redundant command copy on the gate result. Output and
 * descriptions remain deliberately irrelevant.
 */
export function commandProofGateMatches(path: RecordValue, gate: RecordValue): boolean {
  return commandProofGateIdentityMatches(path, gate) &&
    (gate.passed === true || gate.status === 'pass' || gate.status === 'passed')
}

function commandProofGateIdentityMatches(path: RecordValue, gate: RecordValue): boolean {
  if (path.kind !== 'command') return false
  const command = stringValue(path.command)
  if (!command) return false
  const proofBoundary = Date.parse(String(path.updatedAt ?? path.createdAt ?? ''))
  const gateObservedAt = Date.parse(String(gate.checkedAt ?? gate.recordedAt ?? ''))
  if (Number.isFinite(proofBoundary) && Number.isFinite(gateObservedAt) && gateObservedAt < proofBoundary) return false
  const normalizedCommand = normalizedText(command)
  const recordedCommand = normalizedText(typeof gate.command === 'string' ? gate.command : '')
  if (recordedCommand && recordedCommand === normalizedCommand) return true
  const gateId = stringValue(gate.gateId)
  if (!gateId) return false
  return requiredEvidence(path).some(evidence => stringValue(evidence.id) === gateId)
}

function commandGateMatches(path: RecordValue, task: RecordValue): boolean {
  const recordedGates = evidencePayloads(task, 'gate_result')
  const gateResults = Array.isArray(task.evidence)
    ? recordedGates
    : recordedGates.length > 0
      ? recordedGates
      : (Array.isArray(task.gateResults) ? task.gateResults : [])
  const matching = gateResults
    .map(recordValue)
    .filter((gate): gate is RecordValue => gate !== null)
    .filter(gate => commandProofGateIdentityMatches(path, gate))
  if (matching.length === 0) return false
  const latest = matching
    .map((gate, index) => ({ gate, index, observedAt: Date.parse(String(gate.checkedAt ?? gate.recordedAt ?? '')) }))
    .sort((left, right) => {
      const leftAt = Number.isFinite(left.observedAt) ? left.observedAt : Number.NEGATIVE_INFINITY
      const rightAt = Number.isFinite(right.observedAt) ? right.observedAt : Number.NEGATIVE_INFINITY
      return leftAt - rightAt || left.index - right.index
    })
    .at(-1)?.gate
  return Boolean(latest && (latest.passed === true || latest.status === 'pass' || latest.status === 'passed'))
}

/**
 * The one path-level proof predicate used by both summary and readiness
 * projections. Keeping this at the shared boundary prevents a saved task
 * summary and a live release read from inventing different proof rules.
 */
export function isCurrentProofPathProven(
  path: Record<string, unknown>,
  task: Record<string, unknown>,
): boolean {
  if (commandGateMatches(path, task)) return true
  const expected = requiredEvidence(path)
  const passed = passedStructuredReviewEvidenceIds(task)
  if (expected.length > 0 && expected.every(evidence => {
    const id = stringValue(evidence.id)
    return id !== null && passed.has(id)
  })) return true
  // Descriptions are for people. They are deliberately excluded from proof
  // matching: a model's wording and mutable path status must never be treated
  // as semantic proof tokens. Current contracts prove through typed observed
  // evidence with stable IDs or exact command identity.
  return false
}

function pathIsExecutable(path: RecordValue): boolean {
  if (stringValue(path.command)) return true
  return Array.isArray(path.launchSteps) && path.launchSteps.some(step => {
    const record = recordValue(step)
    return record?.kind === 'copy_command' && Boolean(stringValue(record.command))
  })
}

export function proofPathIsScriptRunnable(proofPath: unknown): boolean {
  if (typeof proofPath === 'string') return proofPath.trim().length > 0
  const record = recordValue(proofPath)
  return record !== null && pathIsExecutable(record)
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

/** Summarize only the current proof contract; history is deliberately ignored. */
export function summarizeCurrentProof(task: RecordValue): CurrentProofSummary {
  const taskRecord = task
  const doneSummary = recordValue(recordValue(task.doneSummaryBundle))
  const hasTerminalCompletion = doneSummary?.status === 'done' &&
    stringValue(recordValue(doneSummary.summary)?.evidence) !== null
  const paths = (Array.isArray(task.proofPaths) ? task.proofPaths : [])
    .map(recordValue)
    .filter((path): path is RecordValue => path !== null)
  const hasExecutablePath = paths.some(pathIsExecutable)
  const verified = paths
    .filter(path => isCurrentProofPathProven(path, taskRecord))
    .map(path => path.kind === 'review'
      ? `Review approved: ${proofLabel(path)}`
      : `Proof passed: ${proofLabel(path)}`)
  const missing = paths
    .filter(path => !isCurrentProofPathProven(path, taskRecord))
    .map(path => `Required proof evidence is missing for ${proofLabel(path)}.`)

  if (paths.length === 0) {
    const recordedGates = evidencePayloads(task, 'gate_result')
    const gates = (recordedGates.length > 0
      ? recordedGates
      : (Array.isArray(task.gateResults) ? task.gateResults : []))
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
  const proofStatus = hasTerminalCompletion ? 'done' : status
  if (paths.length === 0) {
    if (proofStatus !== 'done') {
      return {
        state: 'needed',
        expectationCount: 0,
        verified: [],
        missing: ['Current proof contract has not been attached yet.'],
      }
    }
    return {
      state: uniqueVerified.length > 0 || hasTerminalCompletion ? 'proven' : 'none',
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
    ...(hasExecutablePath ? { hasExecutablePath: true } : {}),
  }
}
