import type { ProjectStateDomain } from '@guildhall/sessions'

export interface ProjectProjectionInvalidation {
  projectRoot: string
  revision?: number | null
  domains?: readonly ProjectStateDomain[]
}

export interface ProjectProjectionRefreshResult {
  projectRoot: string
  event: ProjectProjectionInvalidation
  status: 'success' | 'error'
  attempt: number
  retryCount: number
  retryScheduled: boolean
  error: string | null
}

export interface ProjectProjectionRefreshSchedulerOptions {
  onResult?: (result: ProjectProjectionRefreshResult) => void
}

/**
 * Startup should repair missing or stale projections, not rebuild current
 * ones. Current saved summaries are already the fleet read boundary; making
 * service availability wait for every project detail refresh defeats it.
 */
export function shouldRefreshProjectAtStartup(input: {
  authority: 'database' | 'legacy'
  summaryFreshness: 'current' | 'stale' | 'missing' | 'error' | undefined
}): boolean {
  return input.authority !== 'database' || input.summaryFreshness !== 'current'
}

export interface ProjectProjectionRefreshScheduler {
  schedule(event: ProjectProjectionInvalidation): void
  getStatus(projectRoot: string): ProjectProjectionRefreshResult | null
  dispose(): void
}

const MAX_REFRESH_ERROR_LENGTH = 500
const MAX_REFRESH_RETRIES = 1

function refreshErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (message.length <= MAX_REFRESH_ERROR_LENGTH) return message || 'Unknown projection refresh error'
  return `${message.slice(0, MAX_REFRESH_ERROR_LENGTH - 3)}...`
}

/** Coalesce noisy write events before rebuilding one project's read models. */
export function createProjectProjectionRefreshScheduler(
  refresh: (projectRoot: string, event: ProjectProjectionInvalidation) => Promise<void>,
  delayMs = 150,
  options: ProjectProjectionRefreshSchedulerOptions = {},
): ProjectProjectionRefreshScheduler {
  const pending = new Map<string, {
    timer: ReturnType<typeof setTimeout>
    event: ProjectProjectionInvalidation
    retryCount: number
  }>()
  const inFlight = new Set<string>()
  const deferred = new Map<string, {
    event: ProjectProjectionInvalidation
    retryCount: number
  }>()
  const lastResults = new Map<string, ProjectProjectionRefreshResult>()
  let disposed = false

  const report = (result: ProjectProjectionRefreshResult): void => {
    if (disposed) return
    lastResults.set(result.projectRoot, result)
    try {
      options.onResult?.(result)
    } catch {
      // Result observers must not turn a refresh into an unhandled rejection.
    }
  }

  const scheduleAttempt = (event: ProjectProjectionInvalidation, retryCount: number): void => {
    const existing = pending.get(event.projectRoot)
    if (existing) clearTimeout(existing.timer)
    const timer = setTimeout(() => {
      pending.delete(event.projectRoot)
      if (inFlight.has(event.projectRoot)) {
        deferred.set(event.projectRoot, { event, retryCount })
        return
      }
      inFlight.add(event.projectRoot)
      void Promise.resolve().then(() => refresh(event.projectRoot, event)).then(
        () => report({
          projectRoot: event.projectRoot,
          event,
          status: 'success',
          attempt: retryCount + 1,
          retryCount,
          retryScheduled: false,
          error: null,
        }),
        error => {
          const retryScheduled = retryCount < MAX_REFRESH_RETRIES && !disposed
          report({
            projectRoot: event.projectRoot,
            event,
            status: 'error',
            attempt: retryCount + 1,
            retryCount,
            retryScheduled,
            error: refreshErrorMessage(error),
          })
          if (retryScheduled) {
            const existingDeferred = deferred.get(event.projectRoot)
            if (existingDeferred) {
              deferred.set(event.projectRoot, {
                event: existingDeferred.event,
                retryCount: 0,
              })
            } else {
              deferred.set(event.projectRoot, {
                event,
                retryCount: retryCount + 1,
              })
            }
          }
        },
      ).finally(() => {
        inFlight.delete(event.projectRoot)
        if (disposed) return
        const next = deferred.get(event.projectRoot)
        if (!next) return
        deferred.delete(event.projectRoot)
        scheduleAttempt(next.event, next.retryCount)
      })
    }, delayMs)
    timer.unref?.()
    pending.set(event.projectRoot, { timer, event, retryCount })
  }

  return {
    schedule(event) {
      const existing = pending.get(event.projectRoot)
      const deferredEvent = deferred.get(event.projectRoot)
      const baseEvent = existing?.event ?? deferredEvent?.event
      const mergedEvent: ProjectProjectionInvalidation = {
        projectRoot: event.projectRoot,
        revision: Math.max(baseEvent?.revision ?? 0, event.revision ?? 0) || null,
        domains: [...new Set([...(baseEvent?.domains ?? []), ...(event.domains ?? [])])],
      }
      if (deferredEvent) {
        deferred.set(event.projectRoot, { event: mergedEvent, retryCount: 0 })
        return
      }
      scheduleAttempt(mergedEvent, 0)
    },
    getStatus(projectRoot) {
      return lastResults.get(projectRoot) ?? null
    },
    dispose() {
      disposed = true
      for (const entry of pending.values()) clearTimeout(entry.timer)
      pending.clear()
      deferred.clear()
      lastResults.clear()
    },
  }
}
