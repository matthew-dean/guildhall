import type { GuildhallPersistence, PersistedRecord, PersistencePlacement } from '@guildhall/persistence'
import { CompletionHandoff, ProofPath, type ProofPath as ProofPathType, type VerificationRecord as VerificationRecordType } from '@guildhall/core'

export { CompletionHandoff }

const completionHandoffPlacement: PersistencePlacement = {
  scope: 'shared_project',
  retention: 'archive',
  visibility: 'user_visible',
  commitPolicy: 'committed',
}

export function buildCompletionHandoff(input: {
  taskId: string
  completedAt?: string
  completedBy?: string
  summary: string
  proofPaths: readonly ProofPathType[]
  observedEvidence?: readonly VerificationRecordType[]
  residualRisk?: string
  followUpTaskIds?: readonly string[]
}): CompletionHandoff {
  const taskProofPaths = input.proofPaths.filter((path) =>
    path.scope.type === 'task' && path.scope.id === input.taskId
  )
  const records = [...(input.observedEvidence ?? [])]
  const automatedProof = records.filter((record) => record.kind === 'automated')
  const manualProof = records.filter((record) => record.kind === 'manual' || record.kind === 'browser')
  const providerProof = records.filter((record) => record.kind === 'provider' || record.kind === 'external')
  const artifactProof = records.filter((record) => record.kind === 'artifact')
  const evidenceRefs = records.flatMap((record) => record.evidenceRefs)

  return CompletionHandoff.parse({
    id: `${input.taskId}-completion-handoff`,
    taskId: input.taskId,
    completedAt: input.completedAt ?? new Date().toISOString(),
    completedBy: input.completedBy ?? 'gate-checker-agent',
    summary: input.summary,
    proofPathIds: taskProofPaths.map((path) => path.id),
    verificationSummary: [
      `${records.length} verification record${records.length === 1 ? '' : 's'}`,
      `${automatedProof.length} automated`,
      `${manualProof.length} manual`,
      `${providerProof.length} provider`,
      `${artifactProof.length} artifact`,
    ].join(', '),
    automatedProof,
    manualProof,
    providerProof,
    residualRisk: input.residualRisk ?? 'No known residual risk recorded.',
    followUpTaskIds: [...(input.followUpTaskIds ?? [])],
    evidenceRefs,
  })
}

export function reviewCompletionHandoff(input: {
  taskId: string
  proofPaths: readonly ProofPathType[]
  handoff: CompletionHandoff
  observedEvidence?: readonly VerificationRecordType[]
}): { ok: boolean; issues: string[] } {
  const issues: string[] = []
  const taskProofPaths = input.proofPaths.filter((path) =>
    path.scope.type === 'task' && path.scope.id === input.taskId
  )
  if (taskProofPaths.length === 0 || input.handoff.proofPathIds.length === 0) {
    issues.push('Completion handoff is missing a task-scoped proof path.')
  }
  for (const proofPath of taskProofPaths) {
    for (const evidence of proofPath.expectedEvidence) {
      if (!evidence.required) continue
      const passed = (input.observedEvidence ?? []).some((record) =>
        record.evidenceId === evidence.id && record.status === 'passed'
      )
      if (!passed) {
        issues.push(`Required evidence "${evidence.id}" has no passed verification record.`)
      }
    }
  }
  if (input.handoff.providerProof.length > 0) {
    for (const record of input.handoff.providerProof) {
      if (record.status !== 'passed') {
        issues.push(`Provider proof "${record.id}" is not passed and cannot be claimed as complete.`)
      }
    }
  }
  return { ok: issues.length === 0, issues }
}

export async function recordCompletionHandoff(input: {
  projectRoot: string
  handoff: CompletionHandoff
  proofPaths: readonly ProofPathType[]
  persistence: Pick<GuildhallPersistence, 'writeRecord'>
}): Promise<PersistedRecord<CompletionHandoff>> {
  const parsedProofPaths = input.proofPaths.map((proofPath) => ProofPath.parse(proofPath))
  return input.persistence.writeRecord({
    projectRoot: input.projectRoot,
    placement: completionHandoffPlacement,
    collection: 'completion-handoffs',
    id: input.handoff.id,
    schemaName: 'completion-handoff',
    schemaVersion: 1,
    createdBy: input.handoff.completedBy,
    sourceRefs: [
      `task:${input.handoff.taskId}`,
      ...parsedProofPaths.map((proofPath) => `proof-path:${proofPath.id}`),
    ],
    compactedFrom: input.handoff.evidenceRefs,
    payload: input.handoff,
  })
}

export function renderCompletionHandoffContext(handoff: CompletionHandoff): string {
  return [
    '## Completion Handoff',
    '',
    `- Task: ${handoff.taskId}`,
    `- Summary: ${handoff.summary}`,
    `- Verification: ${handoff.verificationSummary}`,
    `- Residual risk: ${handoff.residualRisk}`,
    handoff.followUpTaskIds.length > 0
      ? `- Follow-up tasks: ${handoff.followUpTaskIds.join(', ')}`
      : '',
  ].filter(Boolean).join('\n')
}

export function passedEvidenceIds(records: readonly VerificationRecordType[]): Set<string> {
  return new Set(records
    .filter((record) => record.status === 'passed' && record.evidenceId)
    .map((record) => record.evidenceId as string))
}
