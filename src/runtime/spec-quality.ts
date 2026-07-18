import type { Task } from '@guildhall/core'

export interface SpecQualityResult {
  ok: boolean
  errors: string[]
}

export interface SpecGroundingResult {
  ok: boolean
  errors: string[]
}

const REQUIRED_COMPLETION_BOUNDARY_FIELDS = [
  'product outcome',
  'what guildhall can complete in code',
  'external dependencies',
  'owner-only setup',
  'verification environment',
  'what counts as done',
  'what must be split or blocked',
] as const

const EMPTY_FIELD_PATTERN = /\b(tbd|todo|unknown|unclear|not sure|to be decided|n\/a\?)\b/i
const NO_EXTERNAL_DEPENDENCY_PATTERN = /^(none|no|nothing|not required|no external dependencies)(?:[.\s].*)?$/i
const BROWSER_ONLY_VERIFICATION_DEPENDENCY_PATTERN =
  /\b(?:modern\s+)?(?:web\s+)?browser\b[\s\S]*\b(?:verification|verify|inspect|screenshot|headless|local)\b[\s\S]*\b(?:no runtime dependencies|no APIs|no CDN|no backend|no credentials|no deployed infrastructure|no network)\b/i
const STANDARD_LOCAL_TOOLING_PATTERN =
  /\b(?:node(?:\.js)?|npm|pnpm|yarn|bun|python|ruby|go|rust|cargo|java|dotnet|swift|xcode|git|bash|zsh|shell)\b/i
const LOCAL_TOOLING_ALREADY_AVAILABLE_PATTERN =
  /\b(?:already available|already installed|available on path|available in the execution environment|local filesystem|local[- ]only|no external services|no external dependencies|none)\b/i
const NO_SPLIT_OR_BLOCK_PATTERN = /^(none|nothing|not required|no split|no blockers?|nothing to split)(?:[.\s].*)?$/i
const EXTERNAL_SETUP_RESOLUTION_PATTERN =
  /\b(owner|user|admin|operator|human|create|configure|set up|setup|provision|dashboard|credential|secret|key|callback|webhook|env|environment|supabase|provider)\b/i
const SPLIT_OR_BLOCK_RESOLUTION_PATTERN =
  /\b(split|block|blocked|setup task|follow-?up|separate task|dependency|shelv|owner|human|configure|configuration|credential|secret|key)\b/i
const CONFIGURED_DEPENDENCY_PATTERN =
  /\b(?:already\s+(?:set\s+up|configured|available)|configured\s+(?:provider|service|endpoint|environment)|available\s+(?:provider|service|endpoint|environment))\b/i
const LIVE_VERIFICATION_PATTERN =
  /\b(end[- ]to[- ]end|e2e|live|staging|production|configured|configuration|provider|credential|callback|webhook|verified|works|can actually|real user|target environment)\b/i

const EXECUTABLE_DETAIL_PATTERN = /\b(?:pnpm|npm|node|npx|yarn|bun|python(?:3)?|pytest|vitest|playwright|git)\s+[^\n.;,)]+/gi
const PROJECT_PATH_PATTERN = /(?:^|[\s`"'(])((?:scripts|src|test|tests|fixtures|docs|internal|dist|output|package\.json|expected-records\.json)[A-Za-z0-9_./:@=-]*)/g
const MODEL_FAMILY_PATTERN = /\b(?:mixtral|mistral|qwen|deepseek|kimi|glm|nemotron|llama|gemma|phi|command-r|gpt)(?:[A-Za-z0-9./:_-]*)\b/gi
const INVENTED_SYMBOL_PATTERN = /\b[A-Z][A-Za-z0-9]*(?:Run|Fixture|Agent|Interface|Schema|Harness)\b/g

const CURRENT_PLAN_PROCESS_LEAKAGE_PATTERNS = [
  /\bexceeded maxrevisions\b/i,
  /\bdeterministic reviewer bounced\b/i,
  /\bretrying worker pass\b/i,
  /\btarget directory structure does not match expected paths\b/i,
  /\bexpected file path .*\.guildhall[\\/]worktrees\b/i,
  /\bparent directories do not exist\b/i,
  /\bsuperseded after\b/i,
  /\brequires human judgment\b/i,
] as const

/**
 * Current briefs/specs describe the product boundary. Recovery attempts,
 * revision counters, and internal worktree diagnostics belong in notes and
 * evidence, where they remain useful without becoming executable scope.
 */
export function currentPlanProcessLeakage(text: string): string | null {
  const match = CURRENT_PLAN_PROCESS_LEAKAGE_PATTERNS.find((pattern) => pattern.test(text))
  return match ? match.source : null
}

type GroundingTask = Pick<Task, 'title' | 'description' | 'references' | 'sourceClaims' | 'request' | 'requestIntake' | 'productBrief'>

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
  'title' | 'description' | 'references' | 'sourceClaims' | 'request' | 'requestIntake' | 'productBrief' | 'spec'
>): SpecGroundingResult {
  return validateImportedPlanningText(task, task.spec?.trim() ?? '', 'Spec', true)
}

export function validateProductBriefGrounding(
  task: GroundingTask,
  productBrief: NonNullable<Task['productBrief']>,
): SpecGroundingResult {
  return validateImportedPlanningText(task, JSON.stringify(productBrief), 'Product brief', false, true)
}

export function stripCurrentPlanProcessLeakage(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => currentPlanProcessLeakage(line) === null)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function specSectionBody(markdown: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`^#{2,3}\\s+${escaped}\\s*$([\\s\\S]*?)(?=^#{2,3}\\s+|(?![\\s\\S]))`, 'im').exec(markdown)
  return match?.[1]?.trim() ?? ''
}

function sectionBody(markdown: string, heading: string): string {
  return specSectionBody(markdown, heading)
}

function normalizeFieldName(raw: string): string {
  return raw
    .trim()
    .replace(/^\*{1,3}|\*{1,3}$/g, '')
    .replace(/^_{1,3}|_{1,3}$/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/:$/, '')
}

function completionBoundaryFields(boundary: string): Map<string, string> {
  const fields = new Map<string, string>()
  let currentField: string | null = null
  for (const rawLine of boundary.split('\n')) {
    const line = rawLine.trim().replace(/^[-*]\s+/, '')
    const emphasizedMatch =
      /^(?:\*{1,3}|_{1,3})(.+?)(?::)(?:\*{1,3}|_{1,3})\s*(.*)$/.exec(line)
    const match = emphasizedMatch ?? /^([^:]+):\s*(.*)$/.exec(line)
    if (match) {
      currentField = normalizeFieldName(match[1]!)
      fields.set(currentField, match[2]!.trim())
      continue
    }
    if (!currentField || !line) continue
    const existing = fields.get(currentField) ?? ''
    fields.set(currentField, [existing, line].filter(Boolean).join('\n').trim())
  }
  return fields
}

function isFilled(value: string | undefined): value is string {
  return Boolean(value && value.trim().length > 0 && !EMPTY_FIELD_PATTERN.test(value.trim()))
}

export function productBriefFromSpecCompletionBoundary(spec: string): NonNullable<Task['productBrief']> | null {
  const boundary = sectionBody(spec, 'Completion Boundary')
  if (!boundary) return null
  const fields = completionBoundaryFields(boundary)
  const userJob = fields.get('product outcome')
  const successMetric = fields.get('what counts as done')
  if (!isFilled(userJob) || !isFilled(successMetric)) return null
  const nonGoals = fields.get('what must be split or blocked')
  return {
    userJob,
    successMetric,
    ...(isFilled(nonGoals) ? { nonGoals: [nonGoals], antiPatterns: [nonGoals] } : {}),
    authoredBy: 'system:completion-boundary',
  }
}

export function validateSpecCompletionBoundary(task: Pick<Task,
  'spec' | 'acceptanceCriteria' | 'productBrief'
>): SpecQualityResult {
  const errors: string[] = []
  const spec = task.spec?.trim() ?? ''
  if (!spec) {
    return { ok: false, errors: ['Spec is missing.'] }
  }

  if (currentPlanProcessLeakage(spec)) {
    errors.push('Spec contains internal recovery/process history. Keep that evidence in task notes or history, and write only the current product boundary here.')
  }

  const brief = task.productBrief
  if (!brief?.userJob?.trim() || !brief?.successMetric?.trim()) {
    errors.push('Product brief must name the user/project job and observable success metric.')
  }

  if (!Array.isArray(task.acceptanceCriteria) || task.acceptanceCriteria.length === 0) {
    errors.push('At least one acceptance criterion is required before approval.')
  }

  const boundary = sectionBody(spec, 'Completion Boundary')
  if (!boundary) {
    errors.push('Spec must include a Completion Boundary section.')
    return { ok: errors.length === 0, errors }
  }

  const fields = completionBoundaryFields(boundary)
  for (const field of REQUIRED_COMPLETION_BOUNDARY_FIELDS) {
    if (!isFilled(fields.get(field))) {
      errors.push(`Completion Boundary is missing a concrete "${field}" value.`)
    }
  }

  const externalDependencies = fields.get('external dependencies') ?? ''
  const ownerOnlySetup = fields.get('owner-only setup') ?? ''
  const verificationEnvironment = fields.get('verification environment') ?? ''
  const done = fields.get('what counts as done') ?? ''
  const splitOrBlocked = fields.get('what must be split or blocked') ?? ''
  const localToolingAlreadyAvailable =
    isFilled(externalDependencies) &&
    STANDARD_LOCAL_TOOLING_PATTERN.test(externalDependencies) &&
    LOCAL_TOOLING_ALREADY_AVAILABLE_PATTERN.test(
      `${externalDependencies}\n${ownerOnlySetup}\n${verificationEnvironment}\n${splitOrBlocked}`,
    )
  const hasExternalDependencies =
    isFilled(externalDependencies) &&
    !NO_EXTERNAL_DEPENDENCY_PATTERN.test(externalDependencies.trim()) &&
    !BROWSER_ONLY_VERIFICATION_DEPENDENCY_PATTERN.test(externalDependencies.trim()) &&
    !localToolingAlreadyAvailable

  if (hasExternalDependencies) {
    const ownerSetupResolved =
      isFilled(ownerOnlySetup) && EXTERNAL_SETUP_RESOLUTION_PATTERN.test(ownerOnlySetup)
    const splitOrBlockResolved =
      isFilled(splitOrBlocked) &&
      !NO_SPLIT_OR_BLOCK_PATTERN.test(splitOrBlocked.trim()) &&
      SPLIT_OR_BLOCK_RESOLUTION_PATTERN.test(splitOrBlocked)
    const dependencyAlreadyConfigured =
      CONFIGURED_DEPENDENCY_PATTERN.test(externalDependencies) &&
      LIVE_VERIFICATION_PATTERN.test(`${verificationEnvironment}\n${done}`)
    if (!ownerSetupResolved && !splitOrBlockResolved && !dependencyAlreadyConfigured) {
      errors.push(
        'External dependencies must name the owner/setup action or be split/blocked before implementation.',
      )
    }
    if (!LIVE_VERIFICATION_PATTERN.test(`${verificationEnvironment}\n${done}`)) {
      errors.push(
        'External dependencies require a live/configured verification environment or end-to-end proof.',
      )
    }
  }

  return { ok: errors.length === 0, errors }
}

export function extractAcceptanceCriteriaFromSpec(spec: string): Task['acceptanceCriteria'] {
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
      verifiedBy: inferVerificationKind(description),
      source: 'documented',
      met: false,
    })
  }
  return criteria
}

function inferVerificationKind(description: string): Task['acceptanceCriteria'][number]['verifiedBy'] {
  if (/\b(test|build|lint|typecheck|command)\b/i.test(description)) return 'automated'
  return 'review'
}
