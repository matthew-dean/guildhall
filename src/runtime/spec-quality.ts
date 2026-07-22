import { StructuredSpec, type Task } from '@guildhall/core'

export interface SpecQualityResult {
  ok: boolean
  errors: string[]
}

export interface SpecGroundingResult {
  ok: boolean
  errors: string[]
}

const EXECUTABLE_DETAIL_PATTERN = /\b(?:pnpm|npm|node|npx|yarn|bun|python(?:3)?|pytest|vitest|playwright|git)\s+[^\n.;,)]+/gi
const PROJECT_PATH_PATTERN = /(?:^|[\s`"'(])((?:scripts|src|test|tests|fixtures|docs|internal|dist|output|package\.json|expected-records\.json)[A-Za-z0-9_./:@=-]*)/g
const MODEL_FAMILY_PATTERN = /\b(?:mixtral|mistral|qwen|deepseek|kimi|glm|nemotron|llama|gemma|phi|command-r|gpt)(?:[A-Za-z0-9./:_-]*)\b/gi
const INVENTED_SYMBOL_PATTERN = /\b[A-Z][A-Za-z0-9]*(?:Run|Fixture|Agent|Interface|Schema|Harness)\b/g

type GroundingTask = Pick<Task, 'title' | 'description' | 'references' | 'sourceClaims' | 'request' | 'requestIntake' | 'productBrief' | 'structuredSpec'>

function groundingContext(task: GroundingTask, includeProductBrief = true): string {
  return JSON.stringify({
    title: task.title,
    description: task.description,
    references: task.references,
    sourceClaims: task.sourceClaims,
    request: task.request,
    requestIntake: task.requestIntake,
    ...(includeProductBrief ? { productBrief: task.productBrief } : {}),
  }).toLowerCase()
}

function unsupportedMatches(text: string, context: string, pattern: RegExp): string[] {
  const matches = new Set<string>()
  for (const match of text.matchAll(pattern)) {
    const value = match[0]?.trim().replace(/[.,;:)]+$/, '')
    if (value && !context.includes(value.toLowerCase())) matches.add(value)
  }
  return [...matches]
}

/**
 * Specs are executable planning contracts, so plausible detail is dangerous
 * when it was not present in the visible task/source packet. Keep the
 * admission rule deterministic: a spec may elaborate documented intent, but
 * it may not manufacture commands, paths, model families, or named artifacts.
 */
function validateImportedPlanningText(
  task: GroundingTask,
  text: string,
  label: 'Spec' | 'Product brief',
  includeProductBriefInContext: boolean,
  requireSourceEvidence = false,
): SpecGroundingResult {
  if (!text) return { ok: true, errors: [] }
  const imported = (task.sourceClaims?.length ?? 0) > 0 ||
    task.requestIntake?.evidenceRefs?.some(ref => /^import:/.test(ref)) === true ||
    (task.references?.length ?? 0) > 0 ||
    (!requireSourceEvidence && task.requestIntake?.createdBy === 'workspace-importer')
  if (!imported) return { ok: true, errors: [] }
  const context = groundingContext(task, includeProductBriefInContext)
  const errors: string[] = []
  const executable = unsupportedMatches(text, context, EXECUTABLE_DETAIL_PATTERN)
  if (executable.length > 0) {
    errors.push(`${label} contains executable detail not present in the visible task/source context: ${executable.join(', ')}.`)
  }
  const paths = unsupportedMatches(text, context, PROJECT_PATH_PATTERN)
  if (paths.length > 0) {
    errors.push(`${label} names project paths or files not present in the visible task/source context: ${paths.join(', ')}.`)
  }
  const models = unsupportedMatches(text, context, MODEL_FAMILY_PATTERN)
  if (models.length > 0) {
    errors.push(`${label} names model families not present in the visible task/source context: ${models.join(', ')}.`)
  }
  const symbols = unsupportedMatches(text, context, INVENTED_SYMBOL_PATTERN)
  if (symbols.length > 0) {
    errors.push(`${label} names artifacts or interfaces not present in the visible task/source context: ${symbols.join(', ')}.`)
  }
  return { ok: errors.length === 0, errors }
}

export function validateSpecGrounding(task: Pick<Task,
  'title' | 'description' | 'references' | 'sourceClaims' | 'request' | 'requestIntake' | 'productBrief' | 'spec' | 'structuredSpec'
>): SpecGroundingResult {
  if (task.structuredSpec) return validateStructuredSpecGrounding(task)
  return validateImportedPlanningText(task, task.spec?.trim() ?? '', 'Spec', true)
}

function validateStructuredSpecGrounding(task: GroundingTask): SpecGroundingResult {
  const structured = StructuredSpec.safeParse(task.structuredSpec)
  if (!structured.success) {
    return { ok: false, errors: ['Structured spec is invalid and cannot be used as a planning contract.'] }
  }
  const imported = (task.sourceClaims?.length ?? 0) > 0 ||
    task.requestIntake?.evidenceRefs?.some(ref => /^import:/.test(ref)) === true ||
    (task.references?.length ?? 0) > 0 ||
    task.requestIntake?.createdBy === 'workspace-importer'
  if (!imported) return { ok: true, errors: [] }

  // Only typed executable fields can be checked here. The rest of the
  // structured spec is explanatory prose and must not be searched for model-
  // specific vocabulary, commands, paths, or symbols.
  const context = groundingContext(task, true)
  const errors: string[] = []
  for (const criterion of structured.data.acceptanceCriteria) {
    const command = criterion.command?.trim() ?? ''
    if (!command) continue
    const executable = unsupportedMatches(command, context, EXECUTABLE_DETAIL_PATTERN)
    if (executable.length > 0) {
      errors.push(`Spec acceptance criterion command is not present in the visible task/source context: ${executable.join(', ')}.`)
    }
    const paths = unsupportedMatches(command, context, PROJECT_PATH_PATTERN)
    if (paths.length > 0) {
      errors.push(`Spec acceptance criterion command names project paths or files not present in the visible task/source context: ${paths.join(', ')}.`)
    }
    const models = unsupportedMatches(command, context, MODEL_FAMILY_PATTERN)
    if (models.length > 0) {
      errors.push(`Spec acceptance criterion command names model families not present in the visible task/source context: ${models.join(', ')}.`)
    }
  }
  return { ok: errors.length === 0, errors }
}

export function validateProductBriefGrounding(
  task: GroundingTask,
  productBrief: NonNullable<Task['productBrief']>,
): SpecGroundingResult {
  void task
  void productBrief
  // A product brief is explanatory intent, not an executable contract. Do
  // not scan its prose for commands, paths, or model names: those words are
  // valid in arbitrary user language and must not make a model fail intake.
  // Executable proof belongs in structured acceptance criteria instead.
  return { ok: true, errors: [] }
}

export function specSectionBody(markdown: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`^#{2,3}\\s+${escaped}\\s*$([\\s\\S]*?)(?=^#{2,3}\\s+|(?![\\s\\S]))`, 'im').exec(markdown)
  return match?.[1]?.trim() ?? ''
}

function normalizeLegacyFieldName(raw: string): string {
  return raw
    .trim()
    .replace(/^\*{1,3}|\*{1,3}$/g, '')
    .replace(/^_{1,3}|_{1,3}$/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/:$/, '')
}

function legacyCompletionBoundaryFields(boundary: string): Map<string, string> {
  const fields = new Map<string, string>()
  let currentField: string | null = null
  for (const rawLine of boundary.split('\n')) {
    const line = rawLine.trim().replace(/^[-*]\s+/, '')
    const emphasizedMatch =
      /^(?:\*{1,3}|_{1,3})(.+?)(?::)(?:\*{1,3}|_{1,3})\s*(.*)$/.exec(line)
    const match = emphasizedMatch ?? /^([^:]+):\s*(.*)$/.exec(line)
    if (match) {
      currentField = normalizeLegacyFieldName(match[1]!)
      fields.set(currentField, match[2]!.trim())
      continue
    }
    if (!currentField || !line) continue
    fields.set(currentField, [fields.get(currentField) ?? '', line].filter(Boolean).join('\n').trim())
  }
  return fields
}

/**
 * One-way compatibility conversion for records written before structuredSpec
 * became mandatory. This is intentionally a migration reader, not a normal
 * planning path: new agent/tool writes cannot submit Markdown as authority.
 * The converted object is what validation consumes and what the caller should
 * persist back to the queue.
 */
export function migrateLegacySpecToStructuredSpec(spec: string | undefined): NonNullable<Task['structuredSpec']> | null {
  if (!spec?.trim()) return null
  const boundary = specSectionBody(spec, 'Completion Boundary')
  if (!boundary) return null
  const fields = legacyCompletionBoundaryFields(boundary)
  const required = [
    'product outcome',
    'what guildhall can complete in code',
    'external dependencies',
    'owner-only setup',
    'verification environment',
    'what counts as done',
    'what must be split or blocked',
  ] as const
  if (required.some(field => !fields.get(field)?.trim())) return null

  const criteria = extractLegacyAcceptanceCriteriaFromMarkdown(spec)
  if (criteria.length === 0) return null
  const summary = specSectionBody(spec, 'Summary') || fields.get('product outcome')!
  const outOfScope = specSectionBody(spec, 'Out of Scope')
    ?.split('\n')
    .map(line => line.trim().replace(/^[-*]\s+/, '').replace(/^\d+[.)]\s+/, ''))
    .filter(Boolean)
  const verification = specSectionBody(spec, 'Verification')
    ?.split('\n')
    .map(line => line.trim().replace(/^[-*]\s+/, '').replace(/^\d+[.)]\s+/, ''))
    .filter(Boolean)
  return StructuredSpec.parse({
    whatThisIs: summary,
    problemContext: summary,
    goals: [fields.get('product outcome')!],
    nonGoals: outOfScope && outOfScope.length > 0 ? outOfScope : ['Work outside this completion boundary.'],
    proposedDesign: fields.get('what guildhall can complete in code')!,
    keyDecisions: ['Preserve the migrated completion boundary and its explicit proof contract.'],
    acceptanceCriteria: criteria.map((criterion) => ({
      scenario: criterion.scenario ?? criterion.description,
      expectation: criterion.expectation ?? criterion.description,
      verificationMode: criterion.verifiedBy === 'automated' ? 'automated' : criterion.verifiedBy === 'human' ? 'human' : 'review',
      ...(criterion.command ? { command: criterion.command } : {}),
      ...(criterion.expectedExit ? { expectedExit: criterion.expectedExit } : {}),
      ...(criterion.expectedOutputIncludes ? { expectedOutputIncludes: criterion.expectedOutputIncludes } : {}),
      ...(criterion.evidenceHint ? { evidenceHint: criterion.evidenceHint } : {}),
      ...(criterion.negativeCase ? { negativeCase: criterion.negativeCase } : {}),
    })),
    verification: verification && verification.length > 0 ? verification : ['Review the task evidence against the completion boundary.'],
    completionBoundary: {
      productOutcome: fields.get('product outcome')!,
      whatGuildhallCanCompleteInCode: fields.get('what guildhall can complete in code')!,
      externalDependencies: fields.get('external dependencies')!,
      ownerOnlySetup: fields.get('owner-only setup')!,
      verificationEnvironment: fields.get('verification environment')!,
      whatCountsAsDone: fields.get('what counts as done')!,
      whatMustBeSplitOrBlocked: fields.get('what must be split or blocked')!,
      splitPolicy: 'conditional',
    },
  })
}

export function productBriefFromSpecCompletionBoundary(
  task: Pick<Task, 'structuredSpec'>,
): NonNullable<Task['productBrief']> | null {
  const structured = StructuredSpec.safeParse(task.structuredSpec)
  if (!structured.success) return null
  const { productOutcome: userJob, whatCountsAsDone: successMetric, whatMustBeSplitOrBlocked: nonGoals } = structured.data.completionBoundary
  return {
    userJob,
    successMetric,
    nonGoals: [nonGoals],
    antiPatterns: [nonGoals],
    authoredBy: 'system:completion-boundary',
  }
}

export function validateSpecCompletionBoundary(task: Pick<Task,
  'spec' | 'structuredSpec' | 'acceptanceCriteria' | 'productBrief'
>): SpecQualityResult {
  const errors: string[] = []
  // Rendered Markdown is intentionally not a live compatibility reader.
  // Durable planning state must already have been migrated or authored as a
  // structured contract before any runtime path can validate or execute it.
  const structured = StructuredSpec.safeParse(task.structuredSpec)
  if (!structured.success) {
    errors.push('Structured spec is missing or invalid. Durable planning state must be authored through structuredSpec; rendered Markdown is display-only.')
  }

  const brief = task.productBrief
  if (!brief?.userJob?.trim() || !brief?.successMetric?.trim()) {
    errors.push('Product brief must name the user/project job and observable success metric.')
  }

  if (!Array.isArray(task.acceptanceCriteria) || task.acceptanceCriteria.length === 0) {
    errors.push('At least one acceptance criterion is required before approval.')
  }
  if (structured.success && structured.data.acceptanceCriteria.length === 0) {
    errors.push('Structured spec must contain at least one acceptance criterion.')
  }

  return { ok: errors.length === 0, errors }
}

/** One-way migration helper; rendered Markdown is never a live contract. */
export function extractLegacyAcceptanceCriteriaFromMarkdown(spec: string): Task['acceptanceCriteria'] {
  const body = specSectionBody(spec, 'Acceptance Criteria')
  if (!body) return []
  const criteria: Task['acceptanceCriteria'] = []
  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    const match = /^(?:[-*]\s+|\d+[.)]\s+)(.+)$/.exec(line)
    if (!match) continue
    const description = match[1]!.trim().replace(/\s+/g, ' ')
    if (!description || /^none\.?$/i.test(description)) continue
    criteria.push({
      id: `AC-${criteria.length + 1}`,
      description,
      // Rendered Markdown is explanatory text, not an executable proof
      // contract. Automated verification requires an explicit structured
      // command on the criterion.
      verifiedBy: 'review',
      source: 'documented',
      met: false,
    })
  }
  return criteria
}
