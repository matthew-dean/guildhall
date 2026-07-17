export type ProjectStateDomain =
  | 'queue'
  | 'scope'
  | 'task-runtime'
  | 'workspace'
  | 'evidence'
  | 'attention'
  | 'owner-input'
  | 'execution'
  | 'runtime'
  | 'availability'
  | 'repository'
  | 'release'
  | 'reconciliation'
  | 'config'
  | 'delivery'
  | 'thread'
  | 'legacy'

export interface ProjectSummaryInvalidation {
  projectRoot: string
  reason: string
  revision: number | null
  domains: readonly ProjectStateDomain[]
  invalidatedAt: string
}

export interface ProjectSummaryInvalidationOptions {
  revision?: number | null
  domains?: readonly ProjectStateDomain[]
}

type ProjectSummaryInvalidationListener = (event: ProjectSummaryInvalidation) => void

const listeners = new Set<ProjectSummaryInvalidationListener>()

/** Subscribe to write-boundary invalidations without importing runtime code. */
export function subscribeProjectSummaryInvalidations(
  listener: ProjectSummaryInvalidationListener,
): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function emitProjectSummaryInvalidation(
  projectRoot: string,
  reason = 'current-state-write',
  options: ProjectSummaryInvalidationOptions = {},
): void {
  const event: ProjectSummaryInvalidation = {
    projectRoot,
    reason,
    revision: options.revision ?? null,
    domains: options.domains ?? ['legacy'],
    invalidatedAt: new Date().toISOString(),
  }
  // Writers may emit while SQLite is still inside its transaction. Deliver on
  // the next microtask so subscribers observe the committed state.
  queueMicrotask(() => {
    for (const listener of listeners) {
      try {
        listener(event)
      } catch {
        // A projection subscriber cannot make the authoritative write fail.
      }
    }
  })
}
