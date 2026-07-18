import { existsSync, readFileSync } from 'node:fs'

import { atomicWriteText } from './atomic.js'
import { getProjectSystemStatePath } from './local-history.js'
import { markProjectStateDatabaseStale, readProjectStateDatabaseCurrentAuthority } from './project-state-database.js'
import { emitProjectSummaryInvalidation } from './project-summary-invalidation.js'

const PROJECT_SUMMARY_FILE = 'project-summary.json'

/**
 * Mark the saved summary as stale when a non-queue source changes. The
 * projection is rebuilt by the owning runtime boundary; this small hook keeps
 * compact reads honest in the meantime without importing runtime code into
 * the lower-level sessions package.
 */
export function markProjectSummaryStale(projectRoot: string, reason = 'current-state-write'): void {
  const databaseRevision = markProjectStateDatabaseStale(projectRoot)
  // Promoted projects have no file-backed summary authority. Keep the
  // compatibility file untouched so it cannot masquerade as a current read
  // model while SQLite is refreshing.
  if (readProjectStateDatabaseCurrentAuthority(projectRoot) === 'database') {
    emitProjectSummaryInvalidation(projectRoot, reason, databaseRevision === null ? {} : { revision: databaseRevision })
    return
  }
  try {
    const file = getProjectSystemStatePath(projectRoot, PROJECT_SUMMARY_FILE)
    if (!existsSync(file)) return
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
      if (typeof parsed.version !== 'number') return
      if (parsed.freshness === 'stale') return
      atomicWriteText(file, `${JSON.stringify({ ...parsed, freshness: 'stale' }, null, 2)}\n`)
    } catch {
      // A malformed or missing projection is already unavailable to readers.
    }
  } finally {
    emitProjectSummaryInvalidation(projectRoot, reason, databaseRevision === null ? {} : { revision: databaseRevision })
  }
}
