import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { getProjectSystemStatePath } from '../local-history.js'
import {
  claimProjectStateDatabaseProjectionJobs,
  failProjectStateDatabaseProjectionJob,
  listProjectStateDatabaseProjectionJobs,
  markProjectStateDatabaseProjectionCurrent,
  projectStateDatabasePath,
  recordProjectStateDatabaseProjectionObligations,
  retryProjectStateDatabaseProjectionJob,
  readProjectStateDatabaseMetadata,
  upsertProjectStateDatabaseRuntime,
  writeProjectStateDatabaseSnapshot,
} from '../project-state-database.js'

let tmp: string
let projectRoot: string
let tasksPath: string

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-projection-jobs-'))
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

function writeQueue(projectionDomains?: readonly string[]): void {
  writeProjectStateDatabaseSnapshot(tasksPath, {
    queue: { tasks: [{ id: 'task-1', title: 'One', status: 'ready' }] },
    summary: { generatedAt: '2026-07-16T00:00:00.000Z', freshness: 'current' },
    ...(projectionDomains ? { projectionDomains } : {}),
  })
}

describe('durable projection jobs', () => {
  it('records, claims, fails, retries, and completes revision metadata', () => {
    writeQueue(['summary', 'search'])
    const sourceRevision = readProjectStateDatabaseMetadata(projectRoot)?.revision
    expect(sourceRevision).toBeTypeOf('number')

    expect(listProjectStateDatabaseProjectionJobs(projectRoot)).toMatchObject([{
      domain: 'search',
      sourceRevision,
      status: 'pending',
      attempts: 0,
      error: null,
    }])
    const database = new DatabaseSync(projectStateDatabasePath(projectRoot), { readOnly: true })
    expect(database.prepare("PRAGMA table_info(projection_jobs)").all()).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'payload_json' })]),
    )
    database.close()

    const claimed = claimProjectStateDatabaseProjectionJobs(projectRoot, {
      limit: 1,
      now: '2026-07-16T00:01:00.000Z',
    })
    expect(claimed).toMatchObject([{
      domain: 'search',
      sourceRevision,
      status: 'running',
      attempts: 1,
      claimedAt: '2026-07-16T00:01:00.000Z',
      lastAttemptAt: '2026-07-16T00:01:00.000Z',
    }])

    const failed = failProjectStateDatabaseProjectionJob(
      projectRoot,
      claimed[0]!.id,
      `  ${'index unavailable '.repeat(80)}  `,
      '2026-07-16T00:02:00.000Z',
    )
    expect(failed).toMatchObject({ status: 'failed', attempts: 1 })
    expect(failed?.error?.length).toBeLessThanOrEqual(500)

    const retried = retryProjectStateDatabaseProjectionJob(projectRoot, claimed[0]!.id, {
      now: '2026-07-16T00:03:00.000Z',
    })
    expect(retried).toMatchObject({ status: 'pending', attempts: 1, claimedAt: null })
    expect(retried?.error?.length).toBeLessThanOrEqual(500)

    const secondClaim = claimProjectStateDatabaseProjectionJobs(projectRoot, {
      now: '2026-07-16T00:04:00.000Z',
    })
    expect(secondClaim).toMatchObject([{ id: claimed[0]!.id, status: 'running', attempts: 2 }])

    markProjectStateDatabaseProjectionCurrent(
      projectRoot,
      'search',
      sourceRevision!,
      '2026-07-16T00:05:00.000Z',
    )
    expect(listProjectStateDatabaseProjectionJobs(projectRoot)).toEqual([])
    const completed = listProjectStateDatabaseProjectionJobs(projectRoot, { status: 'succeeded' })
      .find(job => job.domain === 'search')
    expect(completed).toMatchObject({
      domain: 'search',
      sourceRevision,
      status: 'succeeded',
      attempts: 2,
      error: null,
      completedAt: '2026-07-16T00:05:00.000Z',
    })
  })

  it('coalesces repeated obligations to the latest project revision', () => {
    writeQueue(['search'])
    const firstRevision = readProjectStateDatabaseMetadata(projectRoot)?.revision
    recordProjectStateDatabaseProjectionObligations(projectRoot, ['search'], {
      sourceRevision: firstRevision!,
      now: '2026-07-16T00:01:00.000Z',
    })
    expect(listProjectStateDatabaseProjectionJobs(projectRoot)).toHaveLength(1)

    writeQueue(['search'])
    const secondRevision = readProjectStateDatabaseMetadata(projectRoot)?.revision
    expect(secondRevision).toBeGreaterThan(firstRevision!)
    const jobs = listProjectStateDatabaseProjectionJobs(projectRoot)
    expect(jobs).toMatchObject([{
      id: expect.any(Number),
      domain: 'search',
      sourceRevision: secondRevision,
      status: 'pending',
      attempts: 0,
    }])

    const database = new DatabaseSync(projectStateDatabasePath(projectRoot), { readOnly: true })
    expect(database.prepare('SELECT COUNT(*) AS count FROM projection_jobs').get()).toMatchObject({ count: 1 })
    database.close()
  })

  it('schedules the default derived domains from an authoritative runtime write', () => {
    writeQueue()
    upsertProjectStateDatabaseRuntime(projectRoot, {
      status: 'running',
      updatedAt: '2026-07-16T00:06:00.000Z',
    })
    const revision = readProjectStateDatabaseMetadata(projectRoot)?.revision
    expect(listProjectStateDatabaseProjectionJobs(projectRoot)).toEqual(expect.arrayContaining([
      expect.objectContaining({ domain: 'summary', sourceRevision: revision, status: 'pending' }),
      expect.objectContaining({ domain: 'attention', sourceRevision: revision, status: 'pending' }),
    ]))
  })
})
