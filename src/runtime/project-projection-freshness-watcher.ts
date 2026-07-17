import type { ProjectStateDatabaseMetadata } from '@guildhall/sessions'

import type { ProjectProjectionInvalidation } from './project-projection-refresh.js'

export interface ProjectProjectionFreshnessWatcherInput {
  projectRoots: () => readonly string[]
  readMetadata: (projectRoot: string) => ProjectStateDatabaseMetadata | null
  /** Read a cheap repository/worktree token without Git Story scans. */
  readRepositorySignature?: (projectRoot: string) => string | null | undefined
  schedule: (event: ProjectProjectionInvalidation) => void
}

export interface ProjectProjectionFreshnessWatcher {
  start(): void
  dispose(): void
  poll(): void
}

function metadataSignature(metadata: ProjectStateDatabaseMetadata | null): string {
  if (!metadata) return 'missing'
  return [
    metadata.revision,
    metadata.summaryRevision ?? 'null',
    metadata.summaryFreshness ?? 'missing',
  ].join(':')
}

/** Detect writes made by a separate CLI/MCP/coordinator process cheaply. */
export function createProjectProjectionFreshnessWatcher(
  input: ProjectProjectionFreshnessWatcherInput,
  intervalMs = 1000,
): ProjectProjectionFreshnessWatcher {
  const observedMetadata = new Map<string, string>()
  const observedRepositories = new Map<string, string | null | undefined>()
  let timer: ReturnType<typeof setInterval> | null = null

  const poll = (): void => {
    let roots: readonly string[] = []
    try {
      roots = input.projectRoots()
    } catch {
      return
    }
    for (const projectRoot of roots) {
      let metadata: ProjectStateDatabaseMetadata | null = null
      let metadataChanged = false
      try {
        metadata = input.readMetadata(projectRoot)
        const signature = metadataSignature(metadata)
        metadataChanged = observedMetadata.has(projectRoot) && observedMetadata.get(projectRoot) !== signature
        observedMetadata.set(projectRoot, signature)
      } catch {
        // A broken project must not stop the rest of the fleet from polling.
      }

      let repositoryChanged = false
      if (input.readRepositorySignature) {
        try {
          const signature = input.readRepositorySignature(projectRoot)
          repositoryChanged = observedRepositories.has(projectRoot) &&
            observedRepositories.get(projectRoot) !== signature
          observedRepositories.set(projectRoot, signature)
        } catch {
          // Repository signatures are advisory; retry them on the next poll.
        }
      }

      // The first sample establishes a baseline. A later change means a
      // writer outside this process advanced or invalidated project state.
      const domains = [
        ...(metadataChanged && metadata ? ['legacy' as const] : []),
        ...(repositoryChanged ? ['repository' as const] : []),
      ]
      if (domains.length === 0) continue
      try {
        input.schedule({
          projectRoot,
          revision: metadata?.revision ?? null,
          domains,
        })
      } catch {
        // A scheduler failure must not escape a background fleet poll.
      }
    }
  }

  return {
    start() {
      if (timer) return
      poll()
      timer = setInterval(poll, intervalMs)
      timer.unref?.()
    },
    dispose() {
      if (timer) clearInterval(timer)
      timer = null
      observedMetadata.clear()
      observedRepositories.clear()
    },
    poll,
  }
}
