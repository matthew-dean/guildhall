import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { bootstrapWorkspace } from '@guildhall/config'
import {
  getProjectSystemStatePath,
  readProjectStateDatabaseMetadata,
  readProjectStateDatabaseQueueRevision,
  writeProjectStateDatabaseCurrentThread,
} from '@guildhall/sessions'

import {
  readThreadHistoryReadProjection,
  readThreadReadProjection,
  THREAD_READ_PROJECTION_MAX_CURRENT_BYTES,
  THREAD_READ_PROJECTION_MAX_CURRENT_TURNS,
} from '../thread-read-projection.js'
import { writeProjectTaskQueueWithSummary } from '../project-state-boundary.js'
import { buildServeApp } from '../serve.js'
import { NodeGitDriver } from '../git-driver.js'

let tmpDir: string
let projectRoot: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-thread-read-projection-'))
  projectRoot = path.join(tmpDir, 'project')
  bootstrapWorkspace(projectRoot, { name: 'Thread Read Projection Test' })
})

afterEach(async () => {
  vi.restoreAllMocks()
  await fs.rm(tmpDir, { recursive: true, force: true })
})

function seedCurrentThread(turns: unknown[]): { projectRevision: number; queueRevision: number } {
  writeProjectTaskQueueWithSummary(getProjectSystemStatePath(projectRoot, 'TASKS.json'), {
    version: 1,
    lastUpdated: '2026-07-17T00:00:00.000Z',
    tasks: [],
  }, {
    projectId: 'thread-read-projection-test',
    projectRoot,
  })
  const metadata = readProjectStateDatabaseMetadata(projectRoot)
  const queueRevision = readProjectStateDatabaseQueueRevision(getProjectSystemStatePath(projectRoot, 'TASKS.json'))
  if (!metadata || queueRevision === null) throw new Error('expected seeded project revisions')
  writeProjectStateDatabaseCurrentThread(projectRoot, {
    payload: {
      turns,
      activeTurnId: 'turn-0',
      caughtUp: true,
      generatedAt: '2026-07-17T00:01:00.000Z',
      sourceRevision: String(metadata.revision),
    },
    generatedAt: '2026-07-17T00:01:00.000Z',
    sourceRevision: String(metadata.revision),
    sourceQueueRevision: queueRevision,
    history: {
      turns,
      sourceRevision: metadata.revision,
      sourceQueueRevision: queueRevision,
      generatedAt: '2026-07-17T00:01:00.000Z',
      truncated: false,
    },
  })
  return { projectRevision: metadata.revision, queueRevision }
}

describe('Thread read projection', () => {
  it('bounds the saved current row without reconstructing Thread', () => {
    seedCurrentThread(Array.from({ length: 100 }, (_, index) => ({
      kind: 'history_note',
      id: `turn-${index}`,
      summary: 'x'.repeat(10_000),
    })))

    const projection = readThreadReadProjection(projectRoot)

    expect(projection.currentThreadFreshness).toBe('current')
    expect(projection.payload.turns.length).toBeLessThanOrEqual(THREAD_READ_PROJECTION_MAX_CURRENT_TURNS)
    expect(Buffer.byteLength(JSON.stringify(projection.payload), 'utf8'))
      .toBeLessThanOrEqual(THREAD_READ_PROJECTION_MAX_CURRENT_BYTES)
    expect(projection.payload.turns[0]).toMatchObject({
      id: 'turn-0',
      summary: expect.stringMatching(/\.\.\.$/),
    })
  })

  it('serves the bounded saved row through the ordinary Thread route', async () => {
    seedCurrentThread(Array.from({ length: 100 }, (_, index) => ({
      kind: 'history_note',
      id: `turn-${index}`,
      summary: 'x'.repeat(10_000),
    })))

    const { app } = buildServeApp({ projectPath: projectRoot })
    const response = await app.fetch(new Request(
      'http://localhost/api/project/thread?projectId=thread-read-projection-test',
    ))
    const body = await response.json() as { turns?: unknown[]; currentThreadFreshness?: string }

    expect(response.status).toBe(200)
    expect(body.currentThreadFreshness).toBe('current')
    expect(body.turns).toHaveLength(THREAD_READ_PROJECTION_MAX_CURRENT_TURNS)
    expect(Buffer.byteLength(JSON.stringify(body.turns), 'utf8'))
      .toBeLessThanOrEqual(THREAD_READ_PROJECTION_MAX_CURRENT_BYTES)
  })

  it('reads only one bounded saved history page and reports its watermark', () => {
    const revisions = seedCurrentThread(Array.from({ length: 150 }, (_, index) => ({
      kind: 'history_note',
      id: `turn-${index}`,
      summary: `Turn ${index}`,
    })))

    const projection = readThreadHistoryReadProjection(projectRoot, { offset: 20, limit: 100 })

    expect(projection.body).toMatchObject({
      offset: 20,
      limit: 100,
      total: 150,
      hasMore: true,
      nextOffset: 120,
      historyFreshness: 'current',
      sourceRevision: String(revisions.projectRevision),
      sourceQueueRevision: revisions.queueRevision,
    })
    expect(projection.body.turns).toHaveLength(100)
    expect(projection.body.turns[0]).toMatchObject({ id: 'turn-20' })
  })

  it('keeps ordinary Thread extras on the saved-state path', async () => {
    const inspection = vi.spyOn(NodeGitDriver.prototype, 'statusSummary').mockRejectedValue(
      new Error('ordinary Thread extras must not inspect Git'),
    )
    const { app } = buildServeApp({ projectPath: projectRoot })
    const response = await app.fetch(new Request(
      'http://localhost/api/project/thread/extras?projectId=thread-read-projection-test&taskIds=turn-0',
    ))
    const body = await response.json() as { taskGitStories?: unknown; diagnostic?: boolean; requiresRefresh?: boolean }

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      taskGitStories: {},
      diagnostic: false,
      requiresRefresh: true,
    })
    expect(inspection).not.toHaveBeenCalled()
  })

  it('fails closed with an honest cache miss when no saved current row exists', () => {
    const projection = readThreadReadProjection(projectRoot)

    expect(projection).toEqual({
      payload: {
        turns: [],
        activeTurnId: null,
        caughtUp: false,
        generatedAt: '1970-01-01T00:00:00.000Z',
        sourceRevision: 'missing',
      },
      currentThreadFreshness: 'missing',
    })
  })
})
