import {
  deleteFleetSummaryProjection,
  ensureFleetStateDatabase,
  markAllFleetSummaryProjectionsStale,
  markFleetSummaryProjectionError,
  markFleetSummaryProjectionStale,
  pruneFleetSummaryProjections,
  readFleetSummaryProjection,
  readFleetSummaryProjectionPage,
  upsertFleetSummaryProjection,
  type FleetSummaryProjection,
  type FleetSummaryProjectionCurrentRevisions,
  type FleetSummaryProjectionReadOptions,
  type FleetSummaryProjectionWrite,
  type FleetSummaryProjectionStaleMark,
  type FleetSummaryProjectionErrorMark,
} from '@guildhall/sessions'

export type {
  FleetSummaryProjection,
  FleetSummaryProjectionCurrentRevisions,
  FleetSummaryProjectionReadOptions,
  FleetSummaryProjectionWrite,
  FleetSummaryProjectionStaleMark,
  FleetSummaryProjectionErrorMark,
}

/** Bootstrap the single machine-level derived store. No project is opened. */
export function bootstrapFleetSummaryProjection(): string {
  return ensureFleetStateDatabase()
}

/** Publish a summary already computed by a project write/projection boundary. */
export function publishFleetSummaryProjection(input: FleetSummaryProjectionWrite): FleetSummaryProjection {
  return upsertFleetSummaryProjection(input)
}

export function markFleetSummaryStaleAtBoundary(input: FleetSummaryProjectionStaleMark): void {
  markFleetSummaryProjectionStale(input)
}

export function markFleetSummaryErrorAtBoundary(input: FleetSummaryProjectionErrorMark): void {
  markFleetSummaryProjectionError(input)
}

const FLEET_SUMMARY_SOURCE_DOMAINS = new Set([
  'availability',
  'config',
  'evidence',
  'execution',
  'legacy',
  'owner-input',
  'queue',
  'reconciliation',
  'release',
  'runtime',
  'scope',
  'task-runtime',
  'workspace',
])

const FLEET_SUMMARY_DETAIL_ONLY_DOMAINS = new Set([
  'attention',
  'delivery',
  'diagnostics',
  'memory',
  'repository',
  'thread',
])

/**
 * Fleet cards depend on the compact project summary, not every project
 * projection. Thread, attention, memory, and diagnostics refreshes must not
 * invalidate an otherwise current fleet row after a project refresh.
 */
export function fleetSummaryDependsOnDomains(domains: readonly string[]): boolean {
  return domains.some(domain =>
    FLEET_SUMMARY_SOURCE_DOMAINS.has(domain) || !FLEET_SUMMARY_DETAIL_ONLY_DOMAINS.has(domain),
  )
}

export function markAllFleetSummariesStaleAtBoundary(): number {
  return markAllFleetSummaryProjectionsStale()
}

/** Read bounded machine summaries without reconstructing any project state. */
export function readFleetSummaryProjectionPageAtBoundary(
  options: FleetSummaryProjectionReadOptions = {},
) {
  return readFleetSummaryProjectionPage(options)
}

export function readFleetSummaryProjectionAtBoundary(
  projectId: string,
  options: Omit<FleetSummaryProjectionReadOptions, 'projectIds' | 'limit'> = {},
) {
  return readFleetSummaryProjection(projectId, options)
}

export function deleteFleetSummaryProjectionAtBoundary(projectId: string): boolean {
  return deleteFleetSummaryProjection(projectId)
}

export function pruneFleetSummaryProjectionAtBoundary(keepProjectIds: readonly string[]): number {
  return pruneFleetSummaryProjections(keepProjectIds)
}
