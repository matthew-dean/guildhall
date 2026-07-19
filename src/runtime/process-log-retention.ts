import { fstatSync, ftruncateSync } from 'node:fs'

export const DEFAULT_PROCESS_LOG_MAX_BYTES = 8 * 1024 * 1024
export const DEFAULT_PROCESS_LOG_RETENTION_INTERVAL_MS = 60_000

export interface ProcessLogRetentionOptions {
  descriptors?: readonly number[]
  maxBytes?: number
  intervalMs?: number
}

/**
 * Process stdout/stderr are operational diagnostics, not project evidence.
 * Keep them bounded so a long-lived installed service cannot turn logs into
 * another project-state payload.
 */
export function trimProcessLogDescriptor(
  descriptor: number,
  maxBytes = DEFAULT_PROCESS_LOG_MAX_BYTES,
): boolean {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new Error(`maxBytes must be a non-negative safe integer; received ${maxBytes}`)
  }

  try {
    const stats = fstatSync(descriptor)
    if (!stats.isFile() || stats.size <= maxBytes) return false
    ftruncateSync(descriptor, 0)
    return true
  } catch {
    // stdout/stderr may be pipes, sockets, or already closed during shutdown.
    // Retention must never make the service fail.
    return false
  }
}

export function startProcessLogRetention(
  options: ProcessLogRetentionOptions = {},
): () => void {
  const descriptors = options.descriptors ?? [1, 2]
  const maxBytes = options.maxBytes ?? DEFAULT_PROCESS_LOG_MAX_BYTES
  const intervalMs = options.intervalMs ?? DEFAULT_PROCESS_LOG_RETENTION_INTERVAL_MS
  const trim = () => {
    for (const descriptor of descriptors) trimProcessLogDescriptor(descriptor, maxBytes)
  }

  trim()
  if (intervalMs <= 0) return () => undefined

  const timer = setInterval(trim, intervalMs)
  timer.unref()
  return () => clearInterval(timer)
}
