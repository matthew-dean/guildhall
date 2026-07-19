import {
  readProjectStateDatabaseThreadHistorySurfaceState,
  readProjectStateDatabaseThreadSurfaceState,
  type ProjectStateDatabaseThreadSurfaceState,
} from '@guildhall/sessions'

import {
  DEFAULT_CURRENT_THREAD_TEXT_LIMIT,
  DEFAULT_THREAD_HISTORY_BYTE_LIMIT,
  DEFAULT_THREAD_HISTORY_TEXT_LIMIT,
} from './current-thread-projection.js'

export const THREAD_READ_PROJECTION_MAX_CURRENT_TURNS = 64
export const THREAD_READ_PROJECTION_MAX_CURRENT_BYTES = 128 * 1024
export const THREAD_READ_PROJECTION_MAX_HISTORY_PAGE_TURNS = 100

type JsonRecord = Record<string, unknown>
type ThreadFreshness = 'missing' | 'stale' | 'current'

export interface ThreadReadPayload {
  turns: unknown[]
  activeTurnId: string | null
  caughtUp: boolean
  generatedAt: string
  sourceRevision: string | number
}

export interface ThreadReadProjection {
  payload: ThreadReadPayload
  currentThreadFreshness: ThreadFreshness
}

export interface ThreadHistoryReadProjection {
  body: {
    turns: unknown[]
    offset: number
    limit: number
    total: number
    hasMore: boolean
    nextOffset?: number
    sourceRevision?: string
    sourceQueueRevision?: number | null
    generatedAt?: string
    truncated?: boolean
    historyFreshness: ThreadFreshness
    requiresRefresh?: boolean
    detailPayload?: Record<string, unknown>
  }
}

/**
 * Ordinary Thread reads consume only the saved current row. This adapter also
 * bounds persisted JSON at the response boundary, so a malformed or old row
 * cannot turn a navigation GET into an unbounded transcript read.
 */
export function readThreadReadProjection(projectRoot: string): ThreadReadProjection {
  const surface = readProjectStateDatabaseThreadSurfaceState<JsonRecord>(projectRoot)
  return threadReadProjectionFromBoundary(surface)
}

/** Format a Thread row captured by the shared project surface boundary. */
export function threadReadProjectionFromBoundary(
  surface: ProjectStateDatabaseThreadSurfaceState<JsonRecord> | null,
): ThreadReadProjection {
  const stored = surface?.thread ?? null
  const payload = currentThreadPayload(stored?.payload, stored?.generatedAt, stored?.sourceRevision)
  const currentThreadFreshness: ThreadFreshness = !stored
    ? 'missing'
    : stored.sourceRevision !== String(surface?.projectRevision ?? 'missing') ||
        stored.sourceQueueRevision !== (surface?.queueRevision ?? null)
      ? 'stale'
      : 'current'
  return { payload, currentThreadFreshness }
}

/** Return task identities from the bounded saved Thread row for diagnostics. */
export function readCurrentThreadTaskIdsAtBoundary(projectRoot: string): string[] {
  return readThreadReadProjection(projectRoot).payload.turns
    .filter(isRecord)
    .map(turn => typeof turn.taskId === 'string' ? turn.taskId.trim() : '')
    .filter(Boolean)
}

/** Read one bounded page from the saved history row; never reconstruct Thread. */
export function readThreadHistoryReadProjection(
  projectRoot: string,
  options: { offset?: number; limit?: number } = {},
): ThreadHistoryReadProjection {
  const offset = boundedOffset(options.offset)
  const limit = boundedLimit(options.limit)
  const { history, surface } = readProjectStateDatabaseThreadHistorySurfaceState(projectRoot, { offset, limit })
  if (!history) {
    return {
      body: {
        turns: [],
        offset,
        limit,
        total: 0,
        hasMore: false,
        historyFreshness: 'missing',
        requiresRefresh: true,
        detailPayload: {
          kind: 'thread-history-projection',
          unavailable: true,
          omitted: 'Historical turns are populated by the asynchronous projection writer.',
        },
      },
    }
  }

  const current = history.sourceRevision === String(surface?.projectRevision ?? 'missing') &&
    history.sourceQueueRevision === (surface?.queueRevision ?? null)
  const turns = boundedTurns(history.turns, limit, DEFAULT_THREAD_HISTORY_BYTE_LIMIT, DEFAULT_THREAD_HISTORY_TEXT_LIMIT)
  return {
    body: {
      ...history,
      turns,
      historyFreshness: current ? 'current' : 'stale',
      ...(current ? {} : { requiresRefresh: true }),
    },
  }
}

function currentThreadPayload(
  raw: unknown,
  generatedAt: string | undefined,
  sourceRevision: string | number | undefined,
): ThreadReadPayload {
  const record = isRecord(raw) ? raw : {}
  return {
    turns: boundedTurns(
      record.turns,
      THREAD_READ_PROJECTION_MAX_CURRENT_TURNS,
      THREAD_READ_PROJECTION_MAX_CURRENT_BYTES,
      DEFAULT_CURRENT_THREAD_TEXT_LIMIT,
    ),
    activeTurnId: typeof record.activeTurnId === 'string' ? record.activeTurnId : null,
    caughtUp: record.caughtUp === true,
    generatedAt: typeof record.generatedAt === 'string'
      ? record.generatedAt
      : generatedAt ?? new Date(0).toISOString(),
    sourceRevision: typeof record.sourceRevision === 'string' || typeof record.sourceRevision === 'number'
      ? record.sourceRevision
      : sourceRevision ?? 'missing',
  }
}

function boundedTurns(
  raw: unknown,
  maxTurns: number,
  maxBytes: number,
  maxTextChars: number,
): unknown[] {
  const turns = Array.isArray(raw)
    ? raw.slice(0, maxTurns).map(turn => boundValue(turn, maxTextChars))
    : []
  while (turns.length > 0 && serializedBytes(turns) > maxBytes) turns.pop()
  if (turns.length === 1 && serializedBytes(turns) > maxBytes) {
    return [compactOversizedTurn(turns[0])]
  }
  return turns
}

function compactOversizedTurn(value: unknown): JsonRecord {
  if (!isRecord(value)) return { readTruncated: true }
  const compact: JsonRecord = { readTruncated: true }
  for (const key of ['kind', 'id', 'at', 'persona', 'status', 'phase', 'taskId', 'taskTitle', 'title', 'label']) {
    if (key in value) compact[key] = value[key]
  }
  return compact
}

function boundValue(value: unknown, maxTextChars: number, depth = 0): unknown {
  if (typeof value === 'string') return clip(value, maxTextChars)
  if (!value || typeof value !== 'object') return value
  if (depth >= 8) return '[truncated]'
  if (Array.isArray(value)) {
    return value.slice(0, 64).map(item => boundValue(item, maxTextChars, depth + 1))
  }
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 64)
      .map(([key, nested]) => [key, boundValue(nested, maxTextChars, depth + 1)]),
  )
}

function boundedOffset(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value as number)) : 0
}

function boundedLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return 50
  return Math.min(THREAD_READ_PROJECTION_MAX_HISTORY_PAGE_TURNS, Math.max(1, Math.trunc(value as number)))
}

function serializedBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value ?? null), 'utf8')
}

function clip(value: string, maxTextChars: number): string {
  if (value.length <= maxTextChars) return value
  if (maxTextChars <= 3) return value.slice(0, maxTextChars)
  return `${value.slice(0, maxTextChars - 3)}...`
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
