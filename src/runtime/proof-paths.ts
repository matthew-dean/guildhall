import { ExpectedEvidence, EvidenceKind, LaunchStep, LaunchStepBase, ProofPath, ProofPathScope, VerificationRecord, type Task, type ProofPath as ProofPathType } from '@guildhall/core'
import type { EvidenceRef, GuildhallPersistence, PersistedRecord, PersistencePlacement } from '@guildhall/persistence'

export { LaunchStepBase, LaunchStep, EvidenceKind, ExpectedEvidence, ProofPath, ProofPathScope, VerificationRecord }

const proofPathPlacement: PersistencePlacement = {
  scope: 'shared_project',
  retention: 'active',
  visibility: 'user_visible',
  commitPolicy: 'committed',
}

export function buildTaskProofPath(input: {
  task: Task
  createdAt?: string
  createdBy?: string
}): ProofPath {
  const at = input.createdAt ?? new Date().toISOString()
  const expectedEvidence = input.task.acceptanceCriteria.length > 0
    ? input.task.acceptanceCriteria.map((criterion, index) => ExpectedEvidence.parse({
        id: criterion.id ?? `ac-${index + 1}`,
        kind: evidenceKindFromCriterion(criterion.verifiedBy),
        description: criterion.description,
        required: true,
        sourceRef: criterion.command,
      }))
    : [
        ExpectedEvidence.parse({
          id: 'review-proof',
          kind: 'manual',
          description: 'Reviewer confirms the task behavior against the saved spec.',
          required: true,
        }),
      ]

  return ProofPath.parse({
    id: `${input.task.id}-proof-path`,
    scope: { type: 'task', id: input.task.id },
    title: `Prove ${input.task.title}`,
    summary: 'Task-scoped proof path for the commands, routes, workflows, and evidence needed before completion handoff.',
    status: 'planned',
    launchSteps: [],
    expectedEvidence,
    verificationRecords: [],
    relatedTaskIds: [input.task.id],
    createdAt: at,
    updatedAt: at,
    createdBy: input.createdBy ?? 'spec-agent',
  })
}

export async function recordProofPath(input: {
  projectRoot: string
  proofPath: ProofPath
  persistence: Pick<GuildhallPersistence, 'writeRecord'>
}): Promise<PersistedRecord<ProofPath>> {
  return input.persistence.writeRecord({
    projectRoot: input.projectRoot,
    placement: proofPathPlacement,
    collection: 'proof-paths',
    id: input.proofPath.id,
    schemaName: 'proof-path',
    schemaVersion: 1,
    createdBy: input.proofPath.updatedBy ?? input.proofPath.createdBy,
    sourceRefs: sourceRefsForProofPath(input.proofPath),
    compactedFrom: evidenceRefsForProofPath(input.proofPath),
    payload: input.proofPath,
  })
}

export function buildProofPathContext(proofPaths: readonly ProofPath[]): string {
  const paths = proofPaths.filter((path) => path.scope.type === 'task' || path.scope.type === 'project')
  if (paths.length === 0) return ''

  const lines = ['## Proof Paths', '']
  for (const path of paths) {
    lines.push(`### ${path.title}`)
    lines.push(`- Scope: ${path.scope.type}:${path.scope.id}`)
    lines.push(`- Status: ${path.status}`)
    lines.push(`- Summary: ${path.summary}`)
    if (path.launchSteps.length > 0) {
      lines.push('- Launch steps:')
      for (const step of path.launchSteps) lines.push(`  - ${renderLaunchStep(step)}`)
    }
    if (path.expectedEvidence.length > 0) {
      lines.push('- Expected evidence:')
      for (const evidence of path.expectedEvidence) {
        lines.push(`  - ${evidence.kind} ${evidence.required ? 'required' : 'optional'}: ${evidence.description}${evidence.sourceRef ? ` (${evidence.sourceRef})` : ''}`)
      }
    }
    if (path.verificationRecords.length > 0) {
      lines.push('- Verification records:')
      for (const record of path.verificationRecords) {
        lines.push(`  - ${record.kind} ${record.status}: ${record.summary}${record.command ? ` [${record.command}]` : ''}${record.url ? ` [${record.url}]` : ''}`)
      }
    } else {
      lines.push('- No verification records yet.')
    }
    lines.push('')
  }
  return lines.join('\n').trim()
}

function evidenceKindFromCriterion(value: unknown): EvidenceKind {
  const text = String(value ?? '').toLowerCase()
  if (/\b(test|command|gate|typecheck|build|lint)\b/.test(text)) return 'automated'
  if (/\b(browser|ui|visual|manual|review)\b/.test(text)) return 'manual'
  if (/\b(provider|dashboard|deploy|preview)\b/.test(text)) return 'provider'
  return 'manual'
}

function sourceRefsForProofPath(proofPath: ProofPath): string[] {
  if (proofPath.scope.type === 'task') return [`task:${proofPath.scope.id}`]
  return [`project:${proofPath.scope.id}`]
}

function evidenceRefsForProofPath(proofPath: ProofPath): EvidenceRef[] {
  return proofPath.verificationRecords.flatMap((record) => record.evidenceRefs as EvidenceRef[])
}

function renderLaunchStep(step: LaunchStep): string {
  switch (step.kind) {
    case 'copy_command':
      return `${step.title} - copy command: ${step.command}${step.cwd ? ` (cwd: ${step.cwd})` : ''}`
    case 'open_url':
      return `${step.title} - open URL: ${step.url}`
    case 'manual_step':
      return `${step.title} - manual step: ${step.instructions}`
    case 'external_dashboard':
      return `${step.title} - external dashboard: ${step.service}${step.url ? ` ${step.url}` : ''}${step.instructions ? ` ${step.instructions}` : ''}`
    case 'blocked_until_setup':
      return `${step.title} - blocked until setup: ${step.setupRequirement}; owner action: ${step.ownerAction}`
  }
}
