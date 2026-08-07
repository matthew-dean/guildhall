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

function passedEvidenceIds(path: RecordValue): Set<string> {
  return new Set(
    (Array.isArray(path.verificationRecords) ? path.verificationRecords : [])
      .map(recordValue)
      .filter((record): record is RecordValue => record?.status === 'passed')
      .map(record => stringValue(record.evidenceId))
      .filter((id): id is string => id !== null),
  )
}

function passedStructuredReviewEvidenceIds(task: RecordValue): Set<string> {
  return new Set(
    [
      ...evidencePayloads(task, 'review_verdict'),
      ...(Array.isArray(task.reviewVerdicts) ? task.reviewVerdicts.map(recordValue).filter((value): value is RecordValue => value !== null) : []),
    ].flatMap(review => {
      if (review.verdict !== 'approve' && review.decision !== 'approve') return []
      return Array.isArray(review.proofEvidenceIds)
        ? review.proofEvidenceIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
        : []
    }),
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
  if (path.kind !== 'command') return false
  const command = stringValue(path.command)
  if (!command) return false
  if (!(gate.passed === true || gate.status === 'pass' || gate.status === 'passed')) return false
  const normalizedCommand = normalizedText(command)
  const recordedCommand = normalizedText(typeof gate.command === 'string' ? gate.command : '')
  if (recordedCommand && recordedCommand === normalizedCommand) return true
  const gateId = stringValue(gate.gateId)
  if (!gateId) return false
  return requiredEvidence(path).some(evidence => stringValue(evidence.id) === gateId)
}

function commandGateMatches(path: RecordValue, task: RecordValue): boolean {
  const recordedGates = evidencePayloads(task, 'gate_result')
  const gateResults = recordedGates.length > 0
    ? recordedGates
    : (Array.isArray(task.gateResults) ? task.gateResults : [])
  return gateResults
    .map(recordValue)
    .filter((gate): gate is RecordValue => gate !== null)
    .some(gate => commandProofGateMatches(path, gate))
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
  const passed = new Set([
    ...passedEvidenceIds(path),
    ...passedStructuredReviewEvidenceIds(task),
  ])
  if (expected.length > 0 && expected.every(evidence => {
    const id = stringValue(evidence.id)
    return id !== null && passed.has(id)
  })) return true
  // Descriptions are for people. They are deliberately excluded from proof
  // matching: a model's wording must never be treated as a semantic proof
  // token. Current contracts prove through stable evidence IDs, exact command
  // gates, or an explicit verified path status with recorded evidence.
  return expected.length === 0 && path.status === 'verified' && passed.size > 0
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
