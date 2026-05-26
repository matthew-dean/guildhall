import type { Task } from '@guildhall/core'

export interface SpecQualityResult {
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
const NO_EXTERNAL_DEPENDENCY_PATTERN = /^(none|no|nothing|not required|no external dependencies)\.?$/i
const NO_SPLIT_OR_BLOCK_PATTERN = /^(none|nothing|not required|no split|no blockers?|nothing to split)\.?$/i
const EXTERNAL_SETUP_RESOLUTION_PATTERN =
  /\b(owner|user|admin|operator|human|create|configure|set up|setup|provision|dashboard|credential|secret|key|callback|webhook|env|environment|supabase|provider)\b/i
const SPLIT_OR_BLOCK_RESOLUTION_PATTERN =
  /\b(split|block|blocked|setup task|follow-?up|separate task|dependency|shelv|owner|human|configure|configuration|credential|secret|key)\b/i
const LIVE_VERIFICATION_PATTERN =
  /\b(end[- ]to[- ]end|e2e|live|staging|production|configured|configuration|provider|credential|callback|webhook|verified|works|can actually|real user|target environment)\b/i

function sectionBody(markdown: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`^#{2,3}\\s+${escaped}\\s*$([\\s\\S]*?)(?=^#{2,3}\\s+|(?![\\s\\S]))`, 'im').exec(markdown)
  return match?.[1]?.trim() ?? ''
}

function normalizeFieldName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/:$/, '')
}

function completionBoundaryFields(boundary: string): Map<string, string> {
  const fields = new Map<string, string>()
  for (const rawLine of boundary.split('\n')) {
    const line = rawLine.trim().replace(/^[-*]\s+/, '')
    const match = /^([^:]+):\s*(.+)$/.exec(line)
    if (!match) continue
    fields.set(normalizeFieldName(match[1]!), match[2]!.trim())
  }
  return fields
}

function isFilled(value: string | undefined): value is string {
  return Boolean(value && value.trim().length > 0 && !EMPTY_FIELD_PATTERN.test(value.trim()))
}

export function validateSpecCompletionBoundary(task: Pick<Task,
  'spec' | 'acceptanceCriteria' | 'productBrief'
>): SpecQualityResult {
  const errors: string[] = []
  const spec = task.spec?.trim() ?? ''
  if (!spec) {
    return { ok: false, errors: ['Spec is missing.'] }
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
  const hasExternalDependencies =
    isFilled(externalDependencies) && !NO_EXTERNAL_DEPENDENCY_PATTERN.test(externalDependencies.trim())

  if (hasExternalDependencies) {
    const ownerSetupResolved =
      isFilled(ownerOnlySetup) && EXTERNAL_SETUP_RESOLUTION_PATTERN.test(ownerOnlySetup)
    const splitOrBlockResolved =
      isFilled(splitOrBlocked) &&
      !NO_SPLIT_OR_BLOCK_PATTERN.test(splitOrBlocked.trim()) &&
      SPLIT_OR_BLOCK_RESOLUTION_PATTERN.test(splitOrBlocked)
    if (!ownerSetupResolved && !splitOrBlockResolved) {
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
