import type {
  ApiMessageRequest,
  ApiStreamEvent,
  SupportsStreamingMessages,
} from '@guildhall/engine'

export interface ProviderClientHealthSnapshot {
  key: string
  state: 'idle' | 'healthy' | 'degraded'
  pooled: boolean
  maxConcurrency: number
  activeRequests: number
  queuedRequests: number
  createdAt: string
  lastUsedAt: string
  lastSuccessAt?: string
  lastFailureAt?: string
  consecutiveFailures: number
  retryableFailures: number
  fatalFailures: number
  lastError?: string
}

export interface ProviderClientHealthEvent {
  key: string
  snapshot: ProviderClientHealthSnapshot
}

interface PoolEntry {
  client: SupportsStreamingMessages
  maxConcurrency: number
  activeRequests: number
  waiters: Array<() => void>
  createdAt: number
  lastUsedAt: number
  lastSuccessAt?: number
  lastFailureAt?: number
  consecutiveFailures: number
  retryableFailures: number
  fatalFailures: number
  lastError?: string
  cooldownUntil?: number
}

const pool = new Map<string, PoolEntry>()
const listeners = new Set<(event: ProviderClientHealthEvent) => void>()
const CLIENT_RECYCLE_COOLDOWN_MS = 30_000

class PooledProviderClient implements SupportsStreamingMessages {
  constructor(
    private readonly key: string,
    private readonly inner: SupportsStreamingMessages,
  ) {}

  async *streamMessage(request: ApiMessageRequest): AsyncIterable<ApiStreamEvent> {
    markUsed(this.key)
    await acquireSlot(this.key)
    try {
      for await (const event of this.inner.streamMessage(request)) {
        yield event
      }
      markSuccess(this.key)
    } catch (err) {
      markFailure(this.key, err)
      throw err
    } finally {
      releaseSlot(this.key)
    }
  }
}

export function openAiCompatiblePoolKey(input: {
  provider: 'openai-api' | 'llama-cpp'
  baseUrl: string
  apiKey?: string
}): string {
  const baseUrl = input.baseUrl.trim()
  const apiKeySuffix = input.apiKey ? input.apiKey.slice(-8) : 'local'
  return `openai-compatible:${input.provider}:${baseUrl}:${apiKeySuffix}`
}

export function anthropicCompatiblePoolKey(apiKey: string): string {
  return `anthropic-compatible:anthropic-api:${apiKey.slice(-8)}`
}

export function getOrCreateProviderClient(
  key: string,
  opts: { maxConcurrency?: number } | undefined,
  factory: () => SupportsStreamingMessages,
): SupportsStreamingMessages {
  const existing = pool.get(key)
  if (existing) {
    if (!shouldRecycleEntry(existing)) {
      existing.lastUsedAt = Date.now()
      return existing.client
    }
    pool.delete(key)
  }
  const inner = factory()
  const entry: PoolEntry = {
    client: new PooledProviderClient(key, inner),
    maxConcurrency: Math.max(1, Math.floor(opts?.maxConcurrency ?? 1)),
    activeRequests: 0,
    waiters: [],
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
    consecutiveFailures: 0,
    retryableFailures: 0,
    fatalFailures: 0,
  }
  pool.set(key, entry)
  return entry.client
}

export function providerClientHealth(key: string): ProviderClientHealthSnapshot | null {
  const entry = pool.get(key)
  if (!entry) return null
  return {
    key,
    pooled: true,
    maxConcurrency: entry.maxConcurrency,
    activeRequests: entry.activeRequests,
    queuedRequests: entry.waiters.length,
    state:
      entry.consecutiveFailures >= 2
        ? 'degraded'
        : entry.lastSuccessAt || entry.lastFailureAt
          ? 'healthy'
          : 'idle',
    createdAt: new Date(entry.createdAt).toISOString(),
    lastUsedAt: new Date(entry.lastUsedAt).toISOString(),
    ...(entry.lastSuccessAt ? { lastSuccessAt: new Date(entry.lastSuccessAt).toISOString() } : {}),
    ...(entry.lastFailureAt ? { lastFailureAt: new Date(entry.lastFailureAt).toISOString() } : {}),
    consecutiveFailures: entry.consecutiveFailures,
    retryableFailures: entry.retryableFailures,
    fatalFailures: entry.fatalFailures,
    ...(entry.lastError ? { lastError: entry.lastError } : {}),
  }
}

export function subscribeProviderClientHealth(
  listener: (event: ProviderClientHealthEvent) => void,
): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function clearProviderClientPool(): void {
  pool.clear()
}

export function providerClientPoolSize(): number {
  return pool.size
}

function markUsed(key: string): void {
  const entry = pool.get(key)
  if (!entry) return
  entry.lastUsedAt = Date.now()
}

function markSuccess(key: string): void {
  const entry = pool.get(key)
  if (!entry) return
  entry.lastUsedAt = Date.now()
  entry.lastSuccessAt = Date.now()
  entry.consecutiveFailures = 0
  entry.lastError = undefined
  entry.cooldownUntil = undefined
  emitHealth(key)
}

function markFailure(key: string, err: unknown): void {
  const entry = pool.get(key)
  if (!entry) return
  entry.lastUsedAt = Date.now()
  entry.lastFailureAt = Date.now()
  entry.consecutiveFailures += 1
  entry.lastError = err instanceof Error ? err.message : String(err)
  if (isRetryableError(err)) entry.retryableFailures += 1
  else entry.fatalFailures += 1
  if (entry.fatalFailures > 0 || entry.consecutiveFailures >= 2) {
    entry.cooldownUntil = Date.now() + CLIENT_RECYCLE_COOLDOWN_MS
  }
  emitHealth(key)
}

function shouldRecycleEntry(entry: PoolEntry): boolean {
  if (entry.fatalFailures > 0) return true
  if (entry.consecutiveFailures < 2) return false
  return true
}

async function acquireSlot(key: string): Promise<void> {
  const entry = pool.get(key)
  if (!entry) return
  if (entry.activeRequests < entry.maxConcurrency) {
    entry.activeRequests += 1
    return
  }
  await new Promise<void>((resolve) => {
    entry.waiters.push(() => {
      entry.activeRequests += 1
      resolve()
    })
  })
}

function releaseSlot(key: string): void {
  const entry = pool.get(key)
  if (!entry) return
  entry.activeRequests = Math.max(0, entry.activeRequests - 1)
  const next = entry.waiters.shift()
  if (next) next()
}

function isRetryableError(err: unknown): boolean {
  return typeof err === 'object' &&
    err !== null &&
    'retryable' in err &&
    (err as { retryable?: unknown }).retryable === true
}

function emitHealth(key: string): void {
  const snapshot = providerClientHealth(key)
  if (!snapshot) return
  const event: ProviderClientHealthEvent = { key, snapshot }
  for (const listener of listeners) listener(event)
}
