import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  FLEET_SUMMARY_PAYLOAD_MAX_BYTES,
  ensureFleetStateDatabase,
  deleteFleetSummaryProjection,
  markAllFleetSummaryProjectionsStale,
  markFleetSummaryProjectionError,
  markFleetSummaryProjectionStale,
  fleetStateDatabasePath,
  pruneFleetSummaryProjections,
  readFleetSummaryProjection,
  readFleetSummaryProjectionPage,
  upsertFleetSummaryProjection,
} from '../fleet-state-database.js'

describe('fleet state database', () => {
  let temporaryRoot: string
  let previousDataDir: string | undefined

  beforeEach(() => {
    temporaryRoot = mkdtempSync(join(tmpdir(), 'guildhall-fleet-state-'))
    previousDataDir = process.env.GUILDHALL_DATA_DIR
    process.env.GUILDHALL_DATA_DIR = join(temporaryRoot, 'data')
  })

  afterEach(() => {
    if (previousDataDir === undefined) delete process.env.GUILDHALL_DATA_DIR
    else process.env.GUILDHALL_DATA_DIR = previousDataDir
    rmSync(temporaryRoot, { recursive: true, force: true })
  })

  function write(projectId: string, overrides: Partial<Parameters<typeof upsertFleetSummaryProjection>[0]> = {}) {
    return upsertFleetSummaryProjection({
      projectId,
      projectPath: `/workspace/${projectId}`,
      sourceProjectRevision: 4,
      sourceQueueRevision: 9,
      refreshedAt: '2026-07-17T12:00:00.000Z',
      state: 'current',
      payload: { projectId, nextAction: 'Resume', counts: { total: 3 } },
      ...overrides,
    })
  }

  it('bootstraps, upserts idempotently, and reads a bounded fleet page', () => {
    expect(ensureFleetStateDatabase()).toBe(fleetStateDatabasePath())
    write('alpha')
    write('alpha', { payload: { projectId: 'alpha', nextAction: 'Review' } })
    write('beta')

    const page = readFleetSummaryProjectionPage({ limit: 10 })
    expect(page.databaseError).toBeNull()
    expect(page.hasMore).toBe(false)
    expect(page.rows).toHaveLength(2)
    expect(page.rows[0]).toMatchObject({
      projectId: 'alpha',
      sourceProjectRevision: 4,
      sourceQueueRevision: 9,
      state: 'current',
      payload: { projectId: 'alpha', nextAction: 'Review' },
    })

    const boundedPage = readFleetSummaryProjectionPage({ limit: 1 })
    expect(boundedPage.rows).toHaveLength(1)
    expect(boundedPage.hasMore).toBe(true)
  })

  it('marks a saved row stale when the caller supplies newer source revisions', () => {
    write('narrative-harness')

    expect(readFleetSummaryProjection('narrative-harness')).toMatchObject({
      state: 'current',
      sourceProjectRevision: 4,
      sourceQueueRevision: 9,
    })

    expect(readFleetSummaryProjection('narrative-harness', {
      currentRevisions: {
        'narrative-harness': { projectRevision: 5, queueRevision: 9 },
      },
    })).toMatchObject({
      state: 'stale',
      staleReason: 'project_revision_changed',
      sourceProjectRevision: 4,
      sourceQueueRevision: 9,
    })
  })

  it('marks rows stale without dropping the last usable payload', () => {
    write('narrative-harness')
    markFleetSummaryProjectionStale({
      projectId: 'narrative-harness',
      projectPath: '/workspace/narrative-harness',
      sourceProjectRevision: 5,
    })
    expect(readFleetSummaryProjection('narrative-harness')).toMatchObject({
      state: 'stale',
      sourceProjectRevision: 5,
      sourceQueueRevision: 9,
      payload: { projectId: 'narrative-harness', nextAction: 'Resume' },
    })

    expect(markAllFleetSummaryProjectionsStale()).toBe(0)
  })

  it('records a refresh error without deleting the last usable payload', () => {
    write('narrative-harness')
    markFleetSummaryProjectionError({
      projectId: 'narrative-harness',
      projectPath: '/workspace/narrative-harness',
      error: 'project database is locked',
    })
    expect(readFleetSummaryProjection('narrative-harness')).toMatchObject({
      state: 'error',
      payload: { projectId: 'narrative-harness', nextAction: 'Resume' },
      error: 'project database is locked',
    })
  })

  it('turns corrupt payload JSON into an explicit row error without breaking other rows', () => {
    write('corrupt')
    write('healthy')
    const database = new DatabaseSync(fleetStateDatabasePath())
    database.prepare('UPDATE fleet_summary_projection SET payload_json = ? WHERE project_id = ?').run('{broken', 'corrupt')
    database.close()

    const page = readFleetSummaryProjectionPage({ limit: 10 })
    expect(page.databaseError).toBeNull()
    expect(page.rows).toHaveLength(2)
    expect(page.rows.find(row => row.projectId === 'corrupt')).toMatchObject({
      state: 'error',
      payload: null,
      error: 'Fleet summary payload JSON is corrupt',
    })
    expect(page.rows.find(row => row.projectId === 'healthy')).toMatchObject({ state: 'current' })
  })

  it('does not persist an oversized fleet payload', () => {
    const result = write('oversized', { payload: { text: 'x'.repeat(FLEET_SUMMARY_PAYLOAD_MAX_BYTES * 2) } })
    expect(result).toMatchObject({ state: 'error', payload: null })
    expect(result.error).toContain('exceeds')

    const database = new DatabaseSync(fleetStateDatabasePath(), { readOnly: true })
    const row = database.prepare('SELECT payload_json FROM fleet_summary_projection WHERE project_id = ?').get('oversized') as { payload_json: string }
    database.close()
    expect(Buffer.byteLength(row.payload_json, 'utf8')).toBeLessThanOrEqual(FLEET_SUMMARY_PAYLOAD_MAX_BYTES)
    expect(readFleetSummaryProjection('oversized')?.payloadBytes).toBeLessThanOrEqual(FLEET_SUMMARY_PAYLOAD_MAX_BYTES)
  })

  it('reads selected ids and supports delete and prune', () => {
    write('alpha')
    write('beta')
    write('gamma')

    expect(readFleetSummaryProjectionPage({ projectIds: ['gamma'], limit: 10 }).rows.map(row => row.projectId)).toEqual(['gamma'])
    expect(deleteFleetSummaryProjection('beta')).toBe(true)
    expect(deleteFleetSummaryProjection('beta')).toBe(false)
    expect(pruneFleetSummaryProjections(['alpha'])).toBe(1)
    expect(readFleetSummaryProjectionPage({ limit: 10 }).rows.map(row => row.projectId)).toEqual(['alpha'])
  })
})
