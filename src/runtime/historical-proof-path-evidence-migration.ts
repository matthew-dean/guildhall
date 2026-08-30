import { TaskEvidenceEvent, type Task } from '@guildhall/core'

type RecordValue = Record<string, unknown>

export interface HistoricalProofPathEvidenceMigration {
  changed: boolean
  proofPaths: NonNullable<Task['proofPaths']>
  evidence: TaskEvidenceEvent[]
}

function recordValue(value: unknown): RecordValue | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as RecordValue
    : null
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function expectedEvidenceIds(path: RecordValue): string[] {
  if (!Array.isArray(path.expectedEvidence)) return []
  return path.expectedEvidence.flatMap(value => {
    const evidence = recordValue(value)
    const id = stringValue(evidence?.id)
    return id && evidence?.required !== false ? [id] : []
  })
}

function eventId(taskId: string, pathId: string, recordId: string, index: number): string {
  return `proof-verification-migration:${taskId}:${pathId}:${recordId}:${index + 1}`
}

function migrateVerificationRecord(input: {
  taskId: string
  taskUpdatedAt: string
  path: RecordValue
  pathIndex: number
  verification: RecordValue
  verificationIndex: number
}): TaskEvidenceEvent | null {
  const { taskId, taskUpdatedAt, path, pathIndex, verification, verificationIndex } = input
  const status = verification.status
  if (status !== 'passed' && status !== 'failed') return null

  const pathId = stringValue(path.id) ?? `proof-path-${pathIndex + 1}`
  const recordId = stringValue(verification.id) ?? `verification-${verificationIndex + 1}`
  const recordedAt = stringValue(verification.recordedAt) ?? stringValue(path.updatedAt) ?? taskUpdatedAt
  const summary = stringValue(verification.summary) ?? `Migrated historical ${status} verification.`
  const evidenceIds = stringValue(verification.evidenceId)
    ? [stringValue(verification.evidenceId)!]
    : expectedEvidenceIds(path)

  if (path.kind === 'command') {
    const command = stringValue(verification.command) ?? stringValue(path.command)
    if (!command) {
      throw new Error(`Cannot migrate command proof path ${pathId} for ${taskId}: no command is recorded`)
    }
    const executionRoot = verification.executionRoot === 'task_worktree' || verification.executionRoot === 'project_checkout'
      ? verification.executionRoot
      : undefined
    return TaskEvidenceEvent.parse({
      id: eventId(taskId, pathId, recordId, verificationIndex),
      taskId,
      kind: 'gate_result',
      recordedAt,
      payload: {
        gateId: evidenceIds[0] ?? pathId,
        command,
        type: 'hard',
        passed: status === 'passed',
        output: summary,
        checkedAt: recordedAt,
        ...(executionRoot ? { executionRoot } : {}),
        proofPathId: pathId,
        sourceVerificationRecordId: recordId,
      },
    })
  }

  if (path.kind === 'review' || path.kind === 'browser' || path.kind === 'provider' || path.kind === undefined) {
    return TaskEvidenceEvent.parse({
      id: eventId(taskId, pathId, recordId, verificationIndex),
      taskId,
      kind: 'review_verdict',
      recordedAt,
      payload: {
        id: recordId,
        verdict: status === 'passed' ? 'approve' : 'revise',
        reviewerPath: 'deterministic',
        reviewerId: stringValue(verification.recordedBy) ?? 'historical-proof-migration',
        reason: summary,
        failingSignals: status === 'failed' ? ['historical_verification_failed'] : [],
        proofEvidenceIds: evidenceIds,
        recordedAt,
        policyVersion: 'proof-path-verification-record-migration-v1',
        proofKind: path.kind ?? 'legacy',
        proofPathId: pathId,
        sourceVerificationRecordId: recordId,
      },
    })
  }

  throw new Error(`Cannot migrate proof path ${pathId} for ${taskId}: unsupported typed kind ${String(path.kind)}`)
}

/**
 * Move observed historical results out of proof-path expectations. Arbitrary
 * prose remains audit payload only; path kind, result status, command, and
 * evidence IDs are the complete conversion contract.
 */
export function migrateHistoricalProofPathEvidence(
  task: Pick<Task, 'id' | 'updatedAt' | 'proofPaths'>,
): HistoricalProofPathEvidenceMigration {
  const proofPaths = task.proofPaths ?? []
  const evidence: TaskEvidenceEvent[] = []
  let changed = false

  const migratedPaths = proofPaths.map((proofPath, pathIndex) => {
    const path = recordValue(proofPath)
    if (!path) return proofPath
    const verificationRecords = Array.isArray(path.verificationRecords)
      ? path.verificationRecords
      : []
    if (verificationRecords.length > 0 || path.status !== 'planned') changed = true

    for (const [verificationIndex, value] of verificationRecords.entries()) {
      const verification = recordValue(value)
      if (!verification) continue
      const migrated = migrateVerificationRecord({
        taskId: task.id,
        taskUpdatedAt: task.updatedAt,
        path,
        pathIndex,
        verification,
        verificationIndex,
      })
      if (migrated) evidence.push(migrated)
    }

    return {
      ...path,
      status: 'planned' as const,
      verificationRecords: [],
    }
  }) as NonNullable<Task['proofPaths']>

  return { changed, proofPaths: migratedPaths, evidence }
}
