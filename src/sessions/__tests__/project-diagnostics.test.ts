import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { getProjectSystemStatePath } from '../local-history.js'
import {
  PROJECT_STATE_DATABASE_DIAGNOSTIC_MAX_BLOCKERS,
  PROJECT_STATE_DATABASE_DIAGNOSTIC_MAX_BYTES,
  PROJECT_STATE_DATABASE_DIAGNOSTIC_MAX_TEXT_LENGTH,
  PROJECT_STATE_DATABASE_DIAGNOSTIC_PROJECTION_DOMAIN,
  listProjectStateDatabaseProjectionJobs,
  projectStateDatabasePath,
  readProjectStateDatabaseDiagnosticProjection,
  readProjectStateDatabaseProjectionWatermark,
  writeProjectStateDatabaseDiagnosticProjection,
  writeProjectStateDatabaseSnapshot,
} from '../project-state-database.js'

let tmp: string
let projectRoot: string
let tasksPath: string

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-project-diagnostics-'))
  process.env.GUILDHALL_DATA_DIR = path.join(tmp, 'data')
  projectRoot = path.join(tmp, 'project')
  tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
  await fs.mkdir(path.dirname(tasksPath), { recursive: true })
  await fs.writeFile(tasksPath, JSON.stringify({ lastUpdated: '2026-07-16T00:00:00.000Z' }), 'utf8')
})

afterEach(async () => {
  delete process.env.GUILDHALL_DATA_DIR
  await fs.rm(tmp, { recursive: true, force: true })
})

describe('project diagnostic projection', () => {
  it('does not allocate a database when the diagnostic reader has no state', () => {
    expect(readProjectStateDatabaseDiagnosticProjection(projectRoot)).toBeNull()
    expect(existsSync(projectStateDatabasePath(projectRoot))).toBe(false)
  })

  it('stores one revisioned Git/readiness row and completes its projection job', () => {
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: { tasks: [{ id: 'task-1', title: 'One', status: 'ready' }] },
      summary: { generatedAt: '2026-07-16T00:00:00.000Z', freshness: 'current' },
      projectionDomains: [PROJECT_STATE_DATABASE_DIAGNOSTIC_PROJECTION_DOMAIN],
    })
    const sourceRevision = 1

    expect(listProjectStateDatabaseProjectionJobs(projectRoot)).toMatchObject([{
      domain: PROJECT_STATE_DATABASE_DIAGNOSTIC_PROJECTION_DOMAIN,
      sourceRevision,
      status: 'pending',
    }])
    expect(writeProjectStateDatabaseDiagnosticProjection(projectRoot, {
      sourceRevision,
      freshness: 'current',
      generatedAt: '2026-07-16T00:01:00.000Z',
      git: {
        ready: false,
        state: 'dirty_uncommitted',
        blockerCount: 1,
        blockers: [{
          id: 'repo:root',
          label: 'Project checkout',
          state: 'dirty_uncommitted',
          reason: 'Local changes need review.',
          nextAction: 'Review the checkout.',
          repoId: 'root',
        }],
      },
      readiness: {
        ready: false,
        code: 'repository_followup_required',
        message: 'Repository follow-up is required.',
        blockerCount: 1,
        unfinishedCount: 0,
      },
    }, { updatedAt: '2026-07-16T00:01:01.000Z' })).toBe(true)

    expect(readProjectStateDatabaseDiagnosticProjection(projectRoot)).toEqual({
      sourceRevision,
      freshness: 'current',
      generatedAt: '2026-07-16T00:01:00.000Z',
      updatedAt: '2026-07-16T00:01:01.000Z',
      git: {
        ready: false,
        state: 'dirty_uncommitted',
        blockerCount: 1,
        blockers: [{
          id: 'repo:root',
          label: 'Project checkout',
          state: 'dirty_uncommitted',
          reason: 'Local changes need review.',
          nextAction: 'Review the checkout.',
          repoId: 'root',
        }],
      },
      readiness: {
        ready: false,
        code: 'repository_followup_required',
        message: 'Repository follow-up is required.',
        blockerCount: 1,
        unfinishedCount: 0,
      },
    })
    expect(readProjectStateDatabaseProjectionWatermark(projectRoot, PROJECT_STATE_DATABASE_DIAGNOSTIC_PROJECTION_DOMAIN)).toEqual({
      domain: PROJECT_STATE_DATABASE_DIAGNOSTIC_PROJECTION_DOMAIN,
      sourceRevision,
      refreshedAt: '2026-07-16T00:01:01.000Z',
    })
    expect(listProjectStateDatabaseProjectionJobs(projectRoot)).toEqual([])
    expect(listProjectStateDatabaseProjectionJobs(projectRoot, { status: 'succeeded' })).toMatchObject([{
      domain: PROJECT_STATE_DATABASE_DIAGNOSTIC_PROJECTION_DOMAIN,
      sourceRevision,
      status: 'succeeded',
    }])

    const database = new DatabaseSync(projectStateDatabasePath(projectRoot), { readOnly: true })
    expect(database.prepare('SELECT COUNT(*) AS count FROM project_diagnostics').get()).toMatchObject({ count: 1 })
    database.close()
  })

  it('keeps freshness honest and never lets an older observation replace a newer one', () => {
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: { tasks: [{ id: 'task-1', title: 'One', status: 'ready' }] },
      summary: { generatedAt: '2026-07-16T00:00:00.000Z', freshness: 'current' },
    })
    expect(writeProjectStateDatabaseDiagnosticProjection(projectRoot, {
      sourceRevision: 1,
      freshness: 'current',
      generatedAt: '2026-07-16T00:01:00.000Z',
      git: null,
      readiness: { ready: true, code: null, message: null, blockerCount: 0, unfinishedCount: 0 },
    })).toBe(true)

    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: { tasks: [{ id: 'task-1', title: 'One', status: 'done' }] },
      summary: { generatedAt: '2026-07-16T00:02:00.000Z', freshness: 'current' },
    })
    expect(readProjectStateDatabaseDiagnosticProjection(projectRoot)).toMatchObject({
      sourceRevision: 1,
      freshness: 'stale',
    })
    expect(writeProjectStateDatabaseDiagnosticProjection(projectRoot, {
      sourceRevision: 2,
      freshness: 'current',
      generatedAt: '2026-07-16T00:03:00.000Z',
      git: null,
      readiness: { ready: true, code: null, message: null, blockerCount: 0, unfinishedCount: 0 },
    })).toBe(true)

    expect(writeProjectStateDatabaseDiagnosticProjection(projectRoot, {
      sourceRevision: 1,
      freshness: 'stale',
      generatedAt: '2026-07-16T00:04:00.000Z',
      git: null,
      readiness: { ready: false, code: 'old', message: 'Old observation.', blockerCount: 1, unfinishedCount: 1 },
    })).toBe(false)
    expect(readProjectStateDatabaseDiagnosticProjection(projectRoot)).toMatchObject({
      sourceRevision: 2,
      freshness: 'current',
      generatedAt: '2026-07-16T00:03:00.000Z',
    })
    expect(() => writeProjectStateDatabaseDiagnosticProjection(projectRoot, {
      sourceRevision: 3,
      freshness: 'current',
      generatedAt: '2026-07-16T00:05:00.000Z',
      git: null,
      readiness: null,
    })).toThrow(/ahead of the current project revision/)
  })

  it('bounds blocker detail and diagnostic text at the database boundary', () => {
    const longText = 'x'.repeat(PROJECT_STATE_DATABASE_DIAGNOSTIC_MAX_TEXT_LENGTH + 80)
    expect(writeProjectStateDatabaseDiagnosticProjection(projectRoot, {
      sourceRevision: 0,
      freshness: 'current',
      generatedAt: '2026-07-16T00:06:00.000Z',
      git: {
        ready: false,
        state: longText,
        blockerCount: 40,
        blockers: Array.from({ length: 40 }, (_, index) => ({
          id: `${index}-${longText}`,
          label: longText,
          reason: longText,
        })),
      },
      readiness: {
        ready: false,
        code: longText,
        message: longText,
        blockerCount: 40,
        unfinishedCount: 40,
      },
    })).toBe(true)

    const projection = readProjectStateDatabaseDiagnosticProjection(projectRoot)
    expect(projection?.git?.blockers).toHaveLength(PROJECT_STATE_DATABASE_DIAGNOSTIC_MAX_BLOCKERS)
    expect(projection?.git?.state).toHaveLength(PROJECT_STATE_DATABASE_DIAGNOSTIC_MAX_TEXT_LENGTH)
    expect(projection?.git?.blockers[0]?.label).toHaveLength(PROJECT_STATE_DATABASE_DIAGNOSTIC_MAX_TEXT_LENGTH)
    expect(projection?.readiness?.message).toHaveLength(PROJECT_STATE_DATABASE_DIAGNOSTIC_MAX_TEXT_LENGTH)

    const database = new DatabaseSync(projectStateDatabasePath(projectRoot), { readOnly: true })
    const row = database.prepare('SELECT git_json, readiness_json FROM project_diagnostics WHERE id = 1').get() as {
      git_json: string
      readiness_json: string
    }
    expect(Buffer.byteLength(row.git_json, 'utf8') + Buffer.byteLength(row.readiness_json, 'utf8'))
      .toBeLessThanOrEqual(PROJECT_STATE_DATABASE_DIAGNOSTIC_MAX_BYTES)
    database.close()
  })
})
