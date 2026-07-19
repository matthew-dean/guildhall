import { ExpectedEvidence, EvidenceKind, LaunchStep, LaunchStepBase, ProofPath, ProofPathScope, VerificationRecord, type Task, type ProofPath as ProofPathType } from '@guildhall/core'
import type { EvidenceRef, GuildhallPersistence, PersistedRecord, PersistencePlacement } from '@guildhall/persistence'

export { LaunchStepBase, LaunchStep, EvidenceKind, ExpectedEvidence, ProofPath, ProofPathScope, VerificationRecord }

type TaskProofPath = ProofPathType
type TaskProofEvidence = TaskProofPath['expectedEvidence'][number]
type TaskProofVerification = TaskProofPath['verificationRecords'][number]
type CommandProofPath = TaskProofPath & {
  kind: 'command'
  command: string
  expectedEvidence: TaskProofEvidence[]
  verificationRecords: TaskProofVerification[]
  updatedAt: string
  updatedBy?: string
}

export function stableProofPathId(value: Record<string, unknown>, index: number): string {
  const existing = typeof value.id === 'string' ? value.id.trim() : ''
  if (existing) return existing
  const title = typeof value.title === 'string' && value.title.trim()
    ? value.title.trim()
    : typeof value.kind === 'string' && value.kind.trim()
      ? `${value.kind.trim().replace(/[_-]/g, ' ')} proof path`
      : `Proof path ${index + 1}`
  const compact = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return compact || `proof-path-${index}`
}

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
        kind: evidenceKindFromCriterion(criterion.verifiedBy ?? 'review'),
        description: criterion.description,
        required: true,
        sourceRef: criterion.command,
        ...(criterion.expectedExit ? { expectedExit: criterion.expectedExit } : {}),
        ...(criterion.expectedOutputIncludes?.length
          ? { expectedOutputIncludes: criterion.expectedOutputIncludes }
          : {}),
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

/**
 * An explicit acceptance command is already the task's proof contract. Keep
 * that contract durable even when intake did not create a proof-path row.
 * This is deliberately exact: no command is inferred from prose here.
 */
export function ensureCommandProofPathsFromAcceptanceCriteria(
  task: Task,
  now: string,
  createdBy = 'acceptance-command-gates',
): NonNullable<Task['proofPaths']> {
  const existing = dedupeCommandProofPaths(Array.isArray(task.proofPaths)
    ? task.proofPaths
      .filter((path): path is Record<string, unknown> => Boolean(path) && typeof path === 'object' && !Array.isArray(path))
      .map(path => path as ProofPathType)
    : [])
  const existingCommands = new Set(
    existing
      .filter(path => isCommandProofPath(path))
      .map(path => comparableCommand(path.command))
      .filter(Boolean),
  )

  for (const criterion of task.acceptanceCriteria ?? []) {
    const command = typeof criterion.command === 'string' ? criterion.command.trim() : ''
    if (!command) continue
    const comparable = comparableCommand(command)
    if (!comparable) continue

    const expectedEvidence = {
      id: criterion.id,
      kind: 'automated' as const,
      description: criterion.description,
      required: true,
      sourceRef: command,
      ...(criterion.expectedExit ? { expectedExit: criterion.expectedExit } : {}),
      ...(criterion.expectedOutputIncludes?.length
        ? { expectedOutputIncludes: criterion.expectedOutputIncludes }
        : {}),
    }
    const existingPath = existing.find((path): path is CommandProofPath =>
      isCommandProofPath(path) && comparableCommand(path.command) === comparable,
    )
    if (existingPath) {
      const previousEvidence = existingPath.expectedEvidence?.find((evidence) => evidence.id === criterion.id)
      const evidenceChanged = JSON.stringify(previousEvidence) !== JSON.stringify(expectedEvidence)
      existingPath.expectedEvidence = [
        ...(existingPath.expectedEvidence ?? []).filter((evidence) => evidence.id !== criterion.id),
        expectedEvidence,
      ]
      if (evidenceChanged) {
        existingPath.status = 'planned'
        existingPath.verificationRecords = []
        existingPath.updatedAt = now
        existingPath.updatedBy = createdBy
      }
      existingCommands.add(comparable)
      continue
    }

    const proofPathId = `${task.id}-${criterion.id}-command-proof`
    existing.push(ProofPath.parse({
      id: proofPathId,
      scope: { type: 'task', id: task.id },
      title: `Run ${criterion.id}`,
      summary: criterion.description,
      kind: 'command',
      command,
      source: 'documented',
      status: 'planned',
      launchSteps: [{
        id: `${proofPathId}-launch`,
        kind: 'copy_command',
        title: `Run ${criterion.id}`,
        command,
        expectedOutcome: criterion.description,
      }],
      expectedEvidence: [expectedEvidence],
      verificationRecords: [],
      relatedTaskIds: [task.id],
      createdAt: now,
      updatedAt: now,
      createdBy,
    }))
    existingCommands.add(comparable)
  }

  return existing
}

function dedupeCommandProofPaths(
  paths: TaskProofPath[],
): TaskProofPath[] {
  const result: TaskProofPath[] = []
  const byCommand = new Map<string, TaskProofPath>()

  for (const path of paths) {
    if (!isCommandProofPath(path)) {
      result.push(path)
      continue
    }

    const command = comparableCommand(path.command)
    if (!command) {
      result.push(path)
      continue
    }

    const primary = byCommand.get(command)
    if (!primary) {
      byCommand.set(command, path)
      result.push(path)
      continue
    }

    const evidence = new Map((primary.expectedEvidence ?? []).map(item => [item.id, item]))
    for (const item of path.expectedEvidence ?? []) evidence.set(item.id, item)
    primary.expectedEvidence = [...evidence.values()]

    const records = new Map((primary.verificationRecords ?? []).map(item => [item.id, item]))
    for (const item of path.verificationRecords ?? []) records.set(item.id, item)
    primary.verificationRecords = [...records.values()]
    // Two equivalent command rows mean the old state had competing proof
    // authorities. Keep one row, but require a fresh run to establish it.
    primary.status = 'planned'
    primary.verificationRecords = []
    if (path.updatedAt > primary.updatedAt) {
      primary.updatedAt = path.updatedAt
      primary.updatedBy = path.updatedBy
    }
  }

  return result
}

/**
 * A release recovery command must identify a bounded proof, not merely invoke
 * the workspace's broad test/build/check convention. A source-backed spec may
 * still choose one of these commands deliberately, but recovery must send a
 * bare convention back through shaping instead of treating it as task proof.
 */
export function isConcreteProjectProofCommand(command: string): boolean {
  const normalized = command.trim().replace(/\s+/g, ' ')
  return !/^(?:pnpm|npm|yarn|bun)\s+(?:(?:run|exec)\s+)?(?:test|proof|check|verify|validate|build|lint|typecheck)\s*$/i.test(normalized)
}

/**
 * Imported work must not retain a bare workspace convention as if it were a
 * task proof. Keep the task and its evidence expectation, but turn the
 * command into an explicit setup step that Guildhall can advance or explain.
 */
export function replaceGenericProjectProofPathsWithSetup(
  task: Pick<Task, 'id' | 'title' | 'proofPaths'>,
): TaskProofPath[] {
  const proofPaths = Array.isArray(task.proofPaths)
    ? task.proofPaths
      .filter((path): path is Record<string, unknown> => Boolean(path) && typeof path === 'object' && !Array.isArray(path))
      .map(path => path as ProofPathType)
    : []
  return proofPaths.map((path) => {
    if (
      !path ||
      typeof path !== 'object' ||
      Array.isArray(path) ||
      path.kind !== 'command' ||
      typeof path.command !== 'string' ||
      isConcreteProjectProofCommand(path.command)
    ) return path

    const rawExpectedEvidence = (path as unknown as Record<string, unknown>).expectedEvidence
    const expectedEvidence = Array.isArray(rawExpectedEvidence)
      ? rawExpectedEvidence
        .map((evidence) => {
          if (typeof evidence === 'string') return evidence.trim()
          if (evidence && typeof evidence === 'object' && !Array.isArray(evidence)) {
            const description = (evidence as Record<string, unknown>).description
            return typeof description === 'string' ? description.trim() : ''
          }
          return ''
        })
        .filter(Boolean)
      : []
    const pathId = typeof path.id === 'string' && path.id.trim()
      ? path.id.trim()
      : `${task.id}-proof-command-needed`
    const title = task.title.replace(/[.?!]\s*$/, '')
    const { command: _command, ...withoutCommand } = path as Record<string, unknown>
    return {
      ...withoutCommand,
      id: pathId,
      kind: 'command',
      source: 'inferred',
      status: 'planned',
      launchSteps: [{
        id: `${pathId}-setup`,
        title: 'Add proof command',
        kind: 'blocked_until_setup',
        setupRequirement: 'No repo-local pnpm script or CLI proof command is named yet.',
        ownerAction: `Name or implement the command that proves ${title}.`,
      }],
      ...(expectedEvidence.length > 0 ? { expectedEvidence } : {}),
      verificationRecords: [],
    }
  }) as TaskProofPath[]
}

export function recordCommandProofPathResults(
  task: Pick<Task, 'proofPaths'>,
  gates: Array<{ id: string; command: string }>,
  results: Array<{ gateId: string; type: 'hard' | 'soft'; passed: boolean; output?: string; checkedAt: string }>,
  recordedBy = 'run-gates',
): void {
  if (!Array.isArray(task.proofPaths)) return
  const commandById = new Map(gates.map((gate) => [gate.id, comparableCommand(gate.command)]))

  for (const [index, proofPath] of task.proofPaths.entries()) {
    if (!proofPath || typeof proofPath !== 'object' || Array.isArray(proofPath)) continue
    const pathRecord = proofPath as Record<string, unknown>
    if (pathRecord.kind !== 'command') continue
    const proofPathId = stableProofPathId(pathRecord, index)
    if (typeof pathRecord.id !== 'string' || !pathRecord.id.trim()) pathRecord.id = proofPathId
    const proofCommand = comparableCommand(pathRecord.command)
    if (!proofCommand) continue
    const result = results.find((candidate) => {
      const gateCommand = commandById.get(candidate.gateId) ?? ''
      return candidate.gateId === pathRecord.id || gateCommand === proofCommand
    })
    if (!result) continue

    const expectedEvidence = Array.isArray(pathRecord.expectedEvidence) ? pathRecord.expectedEvidence : []
    const existingRecords = Array.isArray(pathRecord.verificationRecords)
      ? pathRecord.verificationRecords.filter((record): record is Record<string, unknown> =>
          Boolean(record) && typeof record === 'object' && !Array.isArray(record),
        )
      : []
    let records = existingRecords
    const evidenceItems = expectedEvidence.length > 0
      ? expectedEvidence
      : [{ id: `${proofPathId}-evidence-0`, description: proofCommand }]
    for (const [evidenceIndex, rawEvidence] of evidenceItems.entries()) {
      const evidence = rawEvidence && typeof rawEvidence === 'object' && !Array.isArray(rawEvidence)
        ? rawEvidence as Record<string, unknown>
        : { id: `${proofPathId}-evidence-${evidenceIndex}`, description: String(rawEvidence) }
      const evidenceId = typeof evidence.id === 'string' && evidence.id.trim()
        ? evidence.id.trim()
        : `${proofPathId}-evidence-${evidenceIndex}`
      const record = {
        id: `command-proof-${evidenceId}-${result.checkedAt.replace(/[^0-9A-Za-z]/g, '')}`,
        evidenceId,
        kind: 'automated',
        status: result.passed ? 'passed' : 'failed',
        summary: result.passed
          ? `Observed command passed: ${proofCommand}`
          : `Observed command failed: ${proofCommand}`,
        command: proofCommand,
        recordedAt: result.checkedAt,
        recordedBy,
        evidenceRefs: [],
      }
      records = [...records.filter((candidate) => candidate.evidenceId !== evidenceId), record]
    }

    pathRecord.verificationRecords = records
    const requiredEvidence = evidenceItems.filter((evidence) =>
      !(evidence && typeof evidence === 'object' && !Array.isArray(evidence) && (evidence as Record<string, unknown>).required === false),
    )
    pathRecord.status = result.passed && requiredEvidence.length > 0 ? 'verified' : 'blocked'
    pathRecord.updatedAt = result.checkedAt
    pathRecord.updatedBy = recordedBy
  }
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
        const expectation = [
          evidence.expectedExit ? `expected exit ${evidence.expectedExit}` : '',
          ...(evidence.expectedOutputIncludes ?? []).map((value) => `output includes ${value}`),
        ].filter(Boolean).join('; ')
        lines.push(`  - ${evidence.kind} ${evidence.required ? 'required' : 'optional'}: ${evidence.description}${evidence.sourceRef ? ` (${evidence.sourceRef})` : ''}${expectation ? ` [${expectation}]` : ''}`)
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

export function comparableCommand(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value
    .trim()
    .replace(/\s+/g, ' ')
    // Gate normalization may add the package-manager exec wrapper. It does
    // not describe a different proof command, so keep one path authoritative.
    .replace(/^pnpm\s+exec\s+/i, '')
}

function isCommandProofPath(path: TaskProofPath | Record<string, unknown>): path is CommandProofPath {
  return Boolean(path) && typeof path === 'object' && !Array.isArray(path) &&
    (path.kind === 'command' || typeof path.command === 'string') &&
    typeof path.command === 'string'
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
