import type { Thread, ThreadTurn } from './thread.js'

export const DEFAULT_CURRENT_THREAD_COMPLETED_TURN_WINDOW = 8
export const DEFAULT_CURRENT_THREAD_PENDING_TURN_WINDOW = 12
export const DEFAULT_CURRENT_THREAD_TEXT_LIMIT = 1_000
const DEFAULT_CURRENT_THREAD_HISTORY_TURN_BYTE_LIMIT = 32 * 1024
const DEFAULT_CURRENT_THREAD_HISTORY_ARRAY_LIMIT = 64
export const DEFAULT_THREAD_HISTORY_TURN_WINDOW = 2_000
export const DEFAULT_THREAD_HISTORY_BYTE_LIMIT = 512 * 1024
export const DEFAULT_THREAD_HISTORY_TEXT_LIMIT = 4_000

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
 * This helper does not load, reconstruct, or otherwise discover history; the
 * projection writer publishes historical detail separately.
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

export interface ThreadHistoryProjection {
  turns: ThreadTurn[]
  truncated: boolean
}

/**
 * Builds the durable historical Thread projection from an already-built
 * Thread at the projector boundary. History is intentionally capped and text
 * is bounded before it enters the database; a page GET never rebuilds this.
 */
export function buildThreadHistoryProjection(input: {
  thread: Thread
  turnWindow?: number
  maxBytes?: number
  maxTextChars?: number
}): ThreadHistoryProjection {
  const turnWindow = normalizedLimit(input.turnWindow, DEFAULT_THREAD_HISTORY_TURN_WINDOW)
  const maxBytes = normalizedLimit(input.maxBytes, DEFAULT_THREAD_HISTORY_BYTE_LIMIT)
  const maxTextChars = normalizedLimit(input.maxTextChars, DEFAULT_THREAD_HISTORY_TEXT_LIMIT)
  if (turnWindow === 0 || maxBytes === 0) {
    return { turns: [], truncated: input.thread.turns.length > 0 }
  }
  const candidates = input.thread.turns.map(turn => boundedHistoryTurn(turn, maxTextChars))
  const retained: ThreadTurn[] = []
  let bytes = 0
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const turn = candidates[index]!
    const turnBytes = serializedBytes(turn)
    if (turnBytes > maxBytes - bytes) break
    retained.push(turn)
    bytes += turnBytes
    if (retained.length >= turnWindow) break
  }
  retained.reverse()
  return {
    turns: retained,
    truncated: retained.length < input.thread.turns.length,
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

function boundedHistoryTurn(turn: ThreadTurn, maxTextChars: number): ThreadTurn {
  const sanitized = sanitizeHistoryValue(turn, maxTextChars) as ThreadTurn
  if (serializedBytes(sanitized) <= DEFAULT_CURRENT_THREAD_HISTORY_TURN_BYTE_LIMIT) return sanitized

  const source = sanitized as unknown as Record<string, unknown>
  const compact: Record<string, unknown> = {}
  for (const key of [
    'kind', 'id', 'at', 'persona', 'status', 'phase', 'taskId', 'taskTitle',
    'title', 'category', 'label', 'approvedAt',
  ]) {
    if (key in source) compact[key] = source[key]
  }
  if (source.brief && typeof source.brief === 'object') {
    compact.brief = sanitizeHistoryValue(source.brief, Math.min(maxTextChars, 512))
  }
  if (source.question && typeof source.question === 'object') {
    compact.question = sanitizeHistoryValue(source.question, Math.min(maxTextChars, 512))
  }
  compact.historyTruncated = true
  return compact as unknown as ThreadTurn
}

function sanitizeHistoryValue(value: unknown, maxTextChars: number): unknown {
  if (typeof value === 'string') return clip(value, maxTextChars)
  if (Array.isArray(value)) {
    return value
      .slice(0, DEFAULT_CURRENT_THREAD_HISTORY_ARRAY_LIMIT)
      .map(item => sanitizeHistoryValue(item, maxTextChars))
  }
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [key, sanitizeHistoryValue(nested, maxTextChars)]),
  )
}

function serializedBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value ?? null), 'utf8')
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
