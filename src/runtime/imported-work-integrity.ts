import type { Task } from '@guildhall/core'

type RecordLike = Record<string, unknown>

export function titleLooksContractShaped(title: unknown): boolean {
  if (typeof title !== 'string') return false
  if (generatedTypeArtifactTitle(title)) return false
  return /\b(schema|schemas|contract|contracts|typed?\b|types)\b/i.test(title)
}

export function titleRequiresConcreteContractNames(title: unknown): boolean {
  if (typeof title !== 'string') return false
  if (generatedTypeArtifactTitle(title)) return false
  return /\b(contract|contracts|typed?\b|types)\b/i.test(title)
}

function generatedTypeArtifactTitle(title: string): boolean {
  return /\b(?:generate|regenerate|update|refresh)\b[\s\S]*\btypes?\b[\s\S]*\b(?:from|using|in|into)\b/i.test(title)
}

export function taskLooksContractShaped(task: Pick<Task, 'title'> | RecordLike): boolean {
  return titleLooksContractShaped((task as { title?: unknown }).title)
}

export function taskHasConcreteContractNames(task: RecordLike): boolean {
  const text = [
    textField(task.title),
    textField(task.description),
    textField(task.spec),
    textField((task.productBrief as RecordLike | undefined)?.successMetric),
    textFromList(task.acceptanceCriteria),
    textFromDefinition(task.definitionOfDone),
    textFromReadiness(task.taskReadiness),
  ].filter(Boolean).join('\n')
  return extractConcreteContractNames(text).length > 0
}

export function taskHasHollowContractClaim(task: RecordLike): boolean {
  const text = [
    textField(task.spec),
    textFromList(task.acceptanceCriteria),
    textFromDefinition(task.definitionOfDone),
    textFromReadiness(task.taskReadiness),
  ].filter(Boolean).join('\n')
  return /\b(cited\s+)?contracts?\b[^.\n]*(?:defined|usable|create|consume|named)[^.\n]*:\s*\./i.test(text) ||
    /\bcontracts?\s+named\s+in\s+the\s+cited\s+docs\s*:\s*\./i.test(text)
}

export function importedContractWorkIsStructurallyIncomplete(task: RecordLike): boolean {
  if (!taskLooksContractShaped(task)) return false
  if (taskHasConcreteContractNames(task)) return false
  if (taskHasHollowContractClaim(task)) return true
  if (!titleRequiresConcreteContractNames(task.title)) return false

  const createdBy = textField((task.requestIntake as RecordLike | undefined)?.createdBy)
  const references = arrayText(task.references)
  const refs = references.join('\n')
  const sourceBacked =
    createdBy === 'workspace-importer' ||
    createdBy === 'project-reintake' ||
    references.some(ref => /(^|\/)docs\/(?:harness|specs)\//i.test(ref)) ||
    /remaining-spec-decomposition-inventory\.md/i.test(refs)

  return sourceBacked
}

export function importedContractStructuralRepairReadiness(
  task: RecordLike,
  now = new Date().toISOString(),
): NonNullable<Task['taskReadiness']> {
  const title = textField(task.title) || 'this imported contract task'
  return {
    taskKind: 'research',
    recommendation: 'needs_research_spike',
    summary: `${title} needs concrete contract names before Guildhall can hand it to a worker.`,
    dimensions: [
      {
        id: 'outcome_clarity',
        status: 'blocked',
        summary: 'The task asks for contracts/types but the cited sources did not recover concrete contract names.',
        evidence: ['Contract/type task has no concrete contract identifiers.'],
      },
      {
        id: 'proofability',
        status: 'blocked',
        summary: 'The proof target is hollow until the contract surface is named.',
        evidence: taskHasHollowContractClaim(task)
          ? ['Existing handoff contains an empty contract claim.']
          : ['Guildhall needs a source-backed contract surface before implementation proof can run.'],
      },
      {
        id: 'size',
        status: 'warn',
        summary: 'Implementation size cannot be trusted until the contract surface is known.',
        evidence: [],
      },
      {
        id: 'context_load',
        status: 'ok',
        summary: 'The missing information is structural, not context-window size.',
        evidence: [],
      },
      {
        id: 'dependency_risk',
        status: 'warn',
        summary: 'Downstream work may depend on this contract boundary.',
        evidence: [],
      },
      {
        id: 'uncertainty',
        status: 'blocked',
        summary: 'Uncertainty is not bounded enough for unattended implementation.',
        evidence: [],
      },
      {
        id: 'user_judgment_exposure',
        status: 'ok',
        summary: 'Guildhall should repair the source model; this is not owner approval.',
        evidence: [],
      },
    ],
    definitionOfDone: {
      items: [
        `${title} names the concrete contracts/types it owns.`,
        'The cited source trail explains where those contract names came from.',
        'Worker proof targets the named contract surface instead of an empty placeholder.',
      ],
      evidenceRequired: [
        'Source-backed contract/type names are present.',
        'Acceptance criteria reference the recovered contract surface.',
      ],
      updatedAt: now,
      createdBy: 'imported-work-integrity',
    },
    blockerPlans: [
      {
        if: 'The cited docs do not name concrete contracts or equivalent structural workflow records',
        then: 'Keep the task in shaping/research and refresh the import or split a source-recovery task before worker handoff.',
        owner: 'guildhall',
        reason: 'Guildhall must not run workers from hollow contract placeholders.',
      },
    ],
    contextBudget: {
      estimatedTokens: Math.max(250, textField(task.spec).length + textField(task.description).length),
      risk: 'medium',
      fitsInOneWorkerBrief: true,
      reasons: ['The task needs source repair before implementation context matters.'],
    },
    assessedAt: now,
    assessedBy: 'imported-work-integrity',
  }
}

export function contractShapedImportHasNoConcreteContracts(input: {
  title: unknown
  contractNames?: readonly string[]
  hasAlternativeStructuralEvidence?: boolean
}): boolean {
  if (input.hasAlternativeStructuralEvidence) return false
  return titleRequiresConcreteContractNames(input.title) && (input.contractNames?.length ?? 0) === 0
}

function extractConcreteContractNames(text: string): string[] {
  return [...text.matchAll(/`([^`\n]{2,120})`/g)]
    .map(match => match[1]?.trim() ?? '')
    .filter((name): name is string => Boolean(name))
    .filter(name =>
      /^[A-Z][A-Za-z0-9]*(?:[A-Z][A-Za-z0-9]*)?$/.test(name) ||
      /\b(?:schema|schemas|contract|contracts|type|types|pipeline|pipelines|workflow|workflows|coordinator|coordinators)\b/i.test(name),
    )
    .filter(name => !/\b(?:placeholder|unnamed|missing|unknown|todo)\b/i.test(name))
    .filter(name => !['TODO', 'MVP', 'CLI', 'API', 'UI', 'JSON', 'YAML', 'PNPM'].includes(name))
}

function textField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function arrayText(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}

function textFromList(value: unknown): string {
  if (!Array.isArray(value)) return ''
  return value.map(item => {
    if (typeof item === 'string') return item
    if (!item || typeof item !== 'object') return ''
    const record = item as RecordLike
    return [
      textField(record.id),
      textField(record.description),
      textField(record.scenario),
      textField(record.expectation),
    ].filter(Boolean).join(' ')
  }).filter(Boolean).join('\n')
}

function textFromDefinition(value: unknown): string {
  if (!value || typeof value !== 'object') return ''
  const record = value as RecordLike
  return [
    ...arrayText(record.items),
    ...arrayText(record.evidenceRequired),
  ].join('\n')
}

function textFromReadiness(value: unknown): string {
  if (!value || typeof value !== 'object') return ''
  const record = value as RecordLike
  return [
    textField(record.summary),
    textFromDefinition(record.definitionOfDone),
  ].filter(Boolean).join('\n')
}
