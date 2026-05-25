import { z } from 'zod'

export const IntakeTarget = z.object({
  type: z.enum(['release', 'feature', 'project', 'task', 'bug', 'investigation', 'memory', 'note']),
  title: z.string(),
  source: z.string(),
  pressureTestRequired: z.boolean(),
  nextStep: z.enum([
    'pressure-test-intake',
    'task-intake',
    'answer-question',
    'settings-proposal',
    'proposal-review',
    'repair-triage',
  ]),
})
export type IntakeTarget = z.infer<typeof IntakeTarget>

export const RoutedAction = z.object({
  id: z.string(),
  kind: z.enum([
    'task_spec',
    'pressure_test_intake',
    'project_question',
    'settings_proposal',
    'persona_practice_proposal',
    'repair_triage',
    'clarification',
  ]),
  label: z.string(),
  safety: z.enum(['read-only', 'project-write', 'global-write', 'external-write']),
  intakeTarget: IntakeTarget,
  requiresConfirmation: z.boolean(),
  reuse: z.object({
    existingActionId: z.string(),
    reason: z.string(),
  }).optional(),
})
export type RoutedAction = z.infer<typeof RoutedAction>

export interface ExistingRoutedAction {
  id: string
  kind: RoutedAction['kind']
  label: string
}

export interface RouteRequestInput {
  raw: string
  source: 'modal' | 'thread' | 'api'
  routeContext: {
    projectId?: string | undefined
    route?: string | undefined
  }
  existingActions?: ExistingRoutedAction[] | undefined
}

export interface RouteRequestResult {
  actions: RoutedAction[]
  routingDecision: {
    reason: string
    matchedSignals: string[]
    split?: {
      required: boolean
      reviewable: boolean
      parts: string[]
    }
  }
}

export function routeRequest(input: RouteRequestInput): RouteRequestResult {
  const parts = splitRequest(input.raw.trim())
  if (parts.length > 1) {
    const actions = parts.flatMap((part) => routeSingleRequest({ ...input, raw: part }).actions)
    return {
      actions,
      routingDecision: {
        reason: 'multi-intent request split into reviewable routed actions',
        matchedSignals: ['multi_intent', ...new Set(actions.map(action => action.kind))],
        split: {
          required: true,
          reviewable: true,
          parts,
        },
      },
    }
  }
  return routeSingleRequest(input)
}

function routeSingleRequest(input: RouteRequestInput): RouteRequestResult {
  const raw = input.raw.trim()
  const title = inferTitle(raw)
  const lower = raw.toLowerCase()
  const releaseMatch = raw.match(/\b(?:v)?(\d+\.\d+(?:\.\d+)?)\b/)

  if (isQuestionLike(lower)) {
    return withReuse(input, one({
      kind: 'project_question',
      title,
      safety: 'read-only',
      targetType: 'investigation',
      pressureTestRequired: false,
      reason: 'question-like request',
      matchedSignals: ['question'],
    }))
  }

  if (
    releaseMatch ||
    /\brelease\b|\bmilestone\b|\broadmap\b|\bpressure[- ]test\b|\bask me everything\b|\bproduct spec\b/.test(lower)
  ) {
    return withReuse(input, one({
      kind: 'pressure_test_intake',
      title: releaseMatch ? inferVersionedTitle(raw, releaseMatch) : title,
      safety: 'project-write',
      targetType: releaseMatch ? 'release' : 'feature',
      pressureTestRequired: true,
      reason: 'release or high-ambiguity product request',
      matchedSignals: ['release_or_feature_intake'],
    }))
  }

  if (/\b(setting|settings|configure|configuration|turn on|turn off|enable|disable|global|default)\b/.test(lower)) {
    return withReuse(input, one({
      kind: 'settings_proposal',
      title,
      safety: /\b(global|default)\b/.test(lower) ? 'global-write' : 'project-write',
      targetType: 'project',
      pressureTestRequired: false,
      reason: 'settings or configuration change request',
      matchedSignals: ['settings_change'],
    }))
  }

  if (/\b(persona|practice|rubric|reviewer|guild|lens)\b/.test(lower)) {
    return withReuse(input, one({
      kind: 'persona_practice_proposal',
      title,
      safety: 'project-write',
      targetType: 'project',
      pressureTestRequired: false,
      reason: 'persona or practice proposal request',
      matchedSignals: ['persona_practice_proposal'],
    }))
  }

  if (/\b(fix|repair|broken|failing|failure|bug|triage|debug)\b/.test(lower)) {
    return withReuse(input, one({
      kind: 'repair_triage',
      title,
      safety: 'project-write',
      targetType: 'bug',
      pressureTestRequired: false,
      reason: 'repair or triage request',
      matchedSignals: ['repair_triage'],
    }))
  }

  if (/\b(maybe|thing|stuff|something|improve it|better)\b/.test(lower)) {
    return withReuse(input, one({
      kind: 'clarification',
      title,
      safety: 'read-only',
      targetType: 'note',
      pressureTestRequired: false,
      reason: 'underspecified request needs clarification before work starts',
      matchedSignals: ['clarification_needed'],
    }))
  }

  return withReuse(input, one({
    kind: 'task_spec',
    title,
    safety: 'project-write',
    targetType: 'task',
    pressureTestRequired: false,
    reason: 'small concrete implementation request',
    matchedSignals: ['task_like'],
  }))
}

function one(input: {
  kind: RoutedAction['kind']
  title: string
  safety: RoutedAction['safety']
  targetType: IntakeTarget['type']
  pressureTestRequired: boolean
  reason: string
  matchedSignals: string[]
}): RouteRequestResult {
  const nextStep =
    input.pressureTestRequired ? 'pressure-test-intake'
      : input.kind === 'project_question' ? 'answer-question'
        : input.kind === 'settings_proposal' ? 'settings-proposal'
          : input.kind === 'persona_practice_proposal' ? 'proposal-review'
            : input.kind === 'repair_triage' ? 'repair-triage'
              : 'task-intake'
  return {
    actions: [{
      id: `action-${slugify(input.title)}`,
      kind: input.kind,
      label: input.title,
      safety: input.safety,
      intakeTarget: {
        type: input.targetType,
        title: input.title,
        source: 'new-request',
        pressureTestRequired: input.pressureTestRequired,
        nextStep,
      },
      requiresConfirmation: input.safety === 'global-write' || input.safety === 'external-write',
    }],
    routingDecision: {
      reason: input.reason,
      matchedSignals: input.matchedSignals,
    },
  }
}

function withReuse(input: RouteRequestInput, result: RouteRequestResult): RouteRequestResult {
  const action = result.actions[0]
  if (!action) return result
  const existing = findExistingAction(input.existingActions ?? [], action)
  if (!existing) return result
  return {
    actions: [{
      ...action,
      id: existing.id,
      label: existing.label,
      reuse: {
        existingActionId: existing.id,
        reason: `Reusing existing similar ${existing.kind.replace(/_/g, ' ')} card.`,
      },
    }],
    routingDecision: {
      ...result.routingDecision,
      matchedSignals: [...result.routingDecision.matchedSignals, 'existing_card_reuse'],
    },
  }
}

function isQuestionLike(lower: string): boolean {
  return (
    lower.trim().endsWith('?') ||
    /\bwhy\b|\bwhat is\b|\bwhat are\b|\bhow does\b|\bhow do\b|\bblocked\b/.test(lower)
  )
}

function inferTitle(raw: string): string {
  const firstLine = raw.split(/\n/)[0]?.trim() ?? 'New request'
  if (firstLine.length <= 72) return firstLine
  return `${firstLine.slice(0, 69).trim()}...`
}

function inferVersionedTitle(raw: string, match: RegExpMatchArray): string {
  const version = match[1] ?? match[0].replace(/^v/i, '')
  const index = typeof match.index === 'number' ? match.index : raw.indexOf(match[0])
  const beforeVersion = index >= 0 ? raw.slice(0, index) : ''
  let candidate = beforeVersion
    .replace(/[^\p{L}\p{N}/._ -]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const scoped = candidate.match(/\b(?:for|about|around|on)\s+(.+)$/i)
  if (scoped?.[1]) candidate = scoped[1].trim()

  candidate = candidate
    .replace(/^(?:please\s+)?(?:pressure[- ]test|test|shape|draft|plan|spec|release)\s+/i, '')
    .replace(/^(?:i\s+)?(?:have|got)\s+ideas?\s+(?:for|about)\s+/i, '')
    .trim()

  const words = candidate.split(/\s+/).filter(Boolean)
  const title = words.slice(Math.max(0, words.length - 5)).join(' ').trim()
  return title ? `${title} ${version}` : version
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'request'
}

function splitRequest(raw: string): string[] {
  const parts = raw
    .split(/\s+\band\b\s+|[;\n]+/i)
    .map(part => part.trim().replace(/[.]+$/, ''))
    .filter(Boolean)
  if (parts.length <= 1) return [raw]
  const actionable = parts.filter(part => isClassifiable(part.toLowerCase()))
  return actionable.length > 1 ? actionable : [raw]
}

function isClassifiable(lower: string): boolean {
  return Boolean(
    lower.match(/\b(?:v)?\d+\.\d+(?:\.\d+)?\b/) ||
    /\b(release|milestone|roadmap|pressure[- ]test|product spec|question|why|what|how|setting|settings|configure|turn on|turn off|enable|disable|persona|practice|rubric|reviewer|guild|lens|fix|repair|broken|failing|failure|bug|triage|debug|maybe|thing|stuff|something)\b/.test(lower),
  )
}

function findExistingAction(
  existingActions: ExistingRoutedAction[],
  action: RoutedAction,
): ExistingRoutedAction | null {
  const actionWords = significantWords(action.label.toLowerCase())
  for (const existing of existingActions) {
    if (existing.kind !== action.kind) continue
    const existingWords = significantWords(existing.label.toLowerCase())
    const overlap = actionWords.filter(word => existingWords.includes(word))
    if (overlap.length >= Math.min(2, actionWords.length)) return existing
  }
  return null
}

function significantWords(value: string): string[] {
  return value
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(word => word.length >= 4 && !['this', 'that', 'with', 'from', 'into'].includes(word))
}
