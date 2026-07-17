import type { Thread, ThreadTurn } from './thread.js'

export const DEFAULT_CURRENT_THREAD_COMPLETED_TURN_WINDOW = 8
export const DEFAULT_CURRENT_THREAD_PENDING_TURN_WINDOW = 12
export const DEFAULT_CURRENT_THREAD_TEXT_LIMIT = 1_000

export interface CurrentThreadProjectionInput {
  thread: Thread
  generatedAt: string
  sourceRevision: string | number
  completedTurnWindow?: number
  pendingTurnWindow?: number
  maxTextChars?: number
}

export interface CurrentThreadProjection {
  turns: ThreadTurn[]
  activeTurnId: string | null
  caughtUp: boolean
  generatedAt: string
  sourceRevision: string | number
}

/**
 * Builds the disjoint current-thread projection from an existing Thread.
 * Thread remains the explicit historical/detail projection; this helper does
 * not load, reconstruct, or otherwise discover history.
 */
export function buildCurrentThreadProjection(
  input: CurrentThreadProjectionInput,
): CurrentThreadProjection {
  const completedTurnWindow = normalizedLimit(
    input.completedTurnWindow,
    DEFAULT_CURRENT_THREAD_COMPLETED_TURN_WINDOW,
  )
  const maxTextChars = normalizedLimit(input.maxTextChars, DEFAULT_CURRENT_THREAD_TEXT_LIMIT)
  const pendingTurnWindow = normalizedLimit(
    input.pendingTurnWindow,
    DEFAULT_CURRENT_THREAD_PENDING_TURN_WINDOW,
  )
  const completedTurns = input.thread.turns.filter(turn => turn.status === 'done')
  const pendingTurnIds = new Set(
    (pendingTurnWindow === 0 ? [] : input.thread.turns
      .filter(turn => turn.status === 'pending')
      .slice(0, pendingTurnWindow)).map(turn => turn.id),
  )
  const latestCompletedTurnIds = new Set(
    (completedTurnWindow === 0 ? [] : completedTurns.slice(-completedTurnWindow)).map(turn => turn.id),
  )

  return {
    turns: input.thread.turns
      .filter(turn => turn.status === 'active' || pendingTurnIds.has(turn.id) || latestCompletedTurnIds.has(turn.id))
      .map(turn => sanitizeTurn(turn, maxTextChars)),
    activeTurnId: input.thread.activeTurnId,
    caughtUp: input.thread.caughtUp,
    generatedAt: input.generatedAt,
    sourceRevision: input.sourceRevision,
  }
}

const BOUNDED_TEXT_FIELDS = new Set([
  'answer',
  'details',
  'description',
  'feedback',
  'latestUserCorrection',
  'message',
  'notes',
  'prompt',
  'rawRequest',
  'restatement',
  'routingSummary',
  'spec',
  'summary',
  'successCriteria',
  'successMetric',
  'taskDescription',
  'userJob',
  'why',
])

function sanitizeTurn(turn: ThreadTurn, maxTextChars: number): ThreadTurn {
  return sanitizeValue(turn, maxTextChars) as ThreadTurn
}

function sanitizeValue(value: unknown, maxTextChars: number, bounded = false): unknown {
  if (typeof value === 'string') return bounded ? clip(value, maxTextChars) : value
  if (Array.isArray(value)) return value.map(item => sanitizeValue(item, maxTextChars, bounded))
  if (!value || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      sanitizeValue(nested, maxTextChars, BOUNDED_TEXT_FIELDS.has(key)),
    ]),
  )
}

function normalizedLimit(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.max(0, Math.floor(value))
}

function clip(value: string, maxTextChars: number): string {
  if (value.length <= maxTextChars) return value
  if (maxTextChars <= 3) return value.slice(0, maxTextChars)
  return `${value.slice(0, maxTextChars - 3)}...`
}
