import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { bootstrapWorkspace } from '@guildhall/config'
import type { Task, TaskQueue } from '@guildhall/core'
import {
  getProjectSystemStatePath,
  listProjectStateDatabaseProjectionJobs,
  markProjectStateDatabaseProjectionCurrent,
  readProjectStateDatabaseMetadata,
  projectStateDatabasePath,
  recordProjectStateDatabaseProjectionObligations,
  readProjectStateDatabaseCurrentThread,
  readProjectStateDatabaseThreadHistoryPage,
  upsertProjectStateDatabaseTaskRuntime,
} from '@guildhall/sessions'

import { refreshCurrentThreadProjection } from '../current-thread-refresh.js'
import { buildServeApp } from '../serve.js'
import { writeProjectTaskQueueWithSummary } from '../project-state-boundary.js'

let tmpDir: string
let projectRoot: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-current-thread-refresh-'))
  process.env.GUILDHALL_DATA_DIR = path.join(tmpDir, 'data')
  projectRoot = path.join(tmpDir, 'project')
  bootstrapWorkspace(projectRoot, { name: 'Current Thread Test' })
})

afterEach(async () => {
  delete process.env.GUILDHALL_DATA_DIR
  await fs.rm(tmpDir, { recursive: true, force: true })
})

function task(projectPath: string, overrides: Partial<Task> = {}): Task {
  const now = '2026-07-15T00:00:00.000Z'
  return {
    id: 'task-current-thread',
    title: 'Keep the current Thread projection small',
    description: 'A task used to prove the projection writer.',
    domain: 'runtime',
    projectPath,
    references: [],
    sourceClaims: [],
    status: 'ready',
    priority: 'normal',
    acceptanceCriteria: [],
    outOfScope: [],
    dependsOn: [],
    notes: [],
    gateResults: [],
    reviewVerdicts: [],
    adjudications: [],
    escalations: [],
    agentIssues: [],
    revisionCount: 0,
    remediationAttempts: 0,
    origination: 'human',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

describe('current Thread projection refresh', () => {
  it('does not reconstruct historical turns when the current row is missing', async () => {
    const queue: TaskQueue = {
      version: 1,
      lastUpdated: '2026-07-15T00:00:00.000Z',
      tasks: [task(projectRoot)],
    }
    writeProjectTaskQueueWithSummary(getProjectSystemStatePath(projectRoot, 'TASKS.json'), queue, {
      projectId: 'current-thread-test',
      projectRoot,
    })

    const { app } = buildServeApp({ projectPath: projectRoot })
    const response = await app.fetch(new Request(
      'http://localhost/api/project/thread?projectId=current-thread-test',
    ))
    const body = await response.json() as { turns?: unknown[]; currentThreadFreshness?: string }

    expect(response.status).toBe(200)
    expect(body.turns).toEqual([])
    expect(body.currentThreadFreshness).toBe('missing')

    const historyResponse = await app.fetch(new Request(
      'http://localhost/api/project/thread/history?projectId=current-thread-test&limit=10',
    ))
    const historyBody = await historyResponse.json() as { turns?: unknown[]; historyFreshness?: string; requiresRefresh?: boolean }
    expect(historyResponse.status).toBe(200)
    expect(historyBody.turns).toEqual([])
    expect(historyBody.historyFreshness).toBe('missing')
    expect(historyBody.requiresRefresh).toBe(true)

    const diagnosticResponse = await app.fetch(new Request(
      'http://localhost/api/project?diagnostic=true&projectId=current-thread-test',
    ))
    const diagnostic = await diagnosticResponse.json() as Record<string, unknown>
    expect(diagnosticResponse.status).toBe(200)
    expect(diagnostic.thread).toBeUndefined()

    const taskExtrasResponse = await app.fetch(new Request(
      'http://localhost/api/project/task/task-current-thread/extras?include=thread&projectId=current-thread-test',
    ))
    const taskExtras = await taskExtrasResponse.json() as { threadTurns?: unknown[] }
    expect(taskExtrasResponse.status).toBe(200)
    expect(taskExtras.threadTurns).toEqual([])
  })

  it('persists a bounded current row for ordinary reads', async () => {
    const queue: TaskQueue = {
      version: 1,
      lastUpdated: '2026-07-15T00:00:00.000Z',
      tasks: [task(projectRoot)],
    }
    writeProjectTaskQueueWithSummary(getProjectSystemStatePath(projectRoot, 'TASKS.json'), queue, {
      projectId: 'current-thread-test',
      projectRoot,
    })

    const projection = await refreshCurrentThreadProjection(projectRoot, {
      runStatus: 'stopped',
      recentEvents: [],
    })

    expect(projection).not.toBeNull()
    const stored = readProjectStateDatabaseCurrentThread(projectRoot)
    const sourceRevision = readProjectStateDatabaseMetadata(projectRoot)?.revision
    expect(stored?.payload).toMatchObject({
      turns: expect.any(Array),
      caughtUp: expect.any(Boolean),
    })
    expect(stored?.payload).toHaveProperty('activeTurnId')
    expect(stored?.sourceQueueRevision).toEqual(expect.any(Number))
    expect(stored?.sourceRevision).toBe(String(sourceRevision))
    expect(JSON.stringify(stored?.payload).length).toBeLessThan(40_000)

    const { app } = buildServeApp({ projectPath: projectRoot })
    const response = await app.fetch(new Request(
      'http://localhost/api/project/thread?projectId=current-thread-test',
    ))
    const body = await response.json() as { turns?: unknown[]; currentThreadFreshness?: string }
    expect(response.status).toBe(200)
    expect(body.turns).toEqual((stored?.payload as { turns: unknown[] }).turns)
    expect(body.currentThreadFreshness).toBe('current')

    const history = readProjectStateDatabaseThreadHistoryPage(projectRoot, { offset: 0, limit: 10 })
    expect(history).toMatchObject({
      total: expect.any(Number),
      sourceRevision: String(sourceRevision),
      sourceQueueRevision: stored?.sourceQueueRevision,
    })
    await fs.rm(getProjectSystemStatePath(projectRoot, 'TASKS.json'))
    const historyResponse = await app.fetch(new Request(
      'http://localhost/api/project/thread/history?projectId=current-thread-test&limit=10',
    ))
    const historyBody = await historyResponse.json() as { historyFreshness?: string; turns?: unknown[] }
    expect(historyResponse.status).toBe(200)
    expect(historyBody.historyFreshness).toBe('current')
    expect(historyBody.turns).toEqual(history?.turns)
  })

  it('completes a claimed thread projection job after a thread-only refresh', async () => {
    writeProjectTaskQueueWithSummary(getProjectSystemStatePath(projectRoot, 'TASKS.json'), {
      version: 1,
      lastUpdated: '2026-07-15T00:00:00.000Z',
      tasks: [task(projectRoot)],
    } satisfies TaskQueue, {
      projectId: 'current-thread-test',
      projectRoot,
    })
    const revision = readProjectStateDatabaseMetadata(projectRoot)?.revision
    expect(revision).toBeTypeOf('number')
    for (const job of listProjectStateDatabaseProjectionJobs(projectRoot)) {
      markProjectStateDatabaseProjectionCurrent(projectRoot, job.domain, revision!)
    }
    recordProjectStateDatabaseProjectionObligations(projectRoot, ['thread'], {
      sourceRevision: revision!,
    })

    const { refreshProjectProjections } = buildServeApp({ projectPath: projectRoot })
    await refreshProjectProjections(projectRoot, {
      projectRoot,
      revision,
      domains: ['thread'],
    })

    expect(listProjectStateDatabaseProjectionJobs(projectRoot)).toEqual([])
    expect(listProjectStateDatabaseProjectionJobs(projectRoot, { status: 'succeeded' }))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ domain: 'thread', sourceRevision: revision, status: 'succeeded' }),
      ]))
  })

  it('hydrates only bounded rich task details while preserving Thread fields', async () => {
    const richTask = task(projectRoot, {
      id: 'task-rich-thread',
      title: 'Keep the selected Thread task readable',
      status: 'spec_review',
      request: {
        id: 'request-rich-thread',
        raw: 'Show the selected Thread task clearly.',
        kind: 'task_spec',
        title: 'Keep the selected Thread task readable',
        routingSummary: 'Routed to Task Intake',
        pressureTestRequired: false,
        createdAt: '2026-07-15T00:01:00.000Z',
      },
      spec: '## Summary\n\nThe selected Thread task keeps its rich fields.',
      acceptanceCriteria: [{
        id: 'ac-rich-thread',
        description: 'The current Thread keeps the selected task detail.',
        verifiedBy: 'review',
        source: 'documented',
        met: false,
      }],
      productBrief: {
        userJob: 'Read the selected task in Thread.',
        whyItMattersNow: 'This is the current task.',
        successMetric: 'The selected detail remains visible.',
        antiPatterns: ['Do not load the whole queue.'],
      },
      updatedAt: '2026-07-15T00:01:00.000Z',
    })
    const queuedTasks = Array.from({ length: 20 }, (_, index) => task(projectRoot, {
      id: 'task-queued-' + index,
      title: 'Queued task ' + index,
      status: 'ready',
      updatedAt: '2026-07-15T00:' + String(index + 2).padStart(2, '0') + ':00.000Z',
    }))
    writeProjectTaskQueueWithSummary(getProjectSystemStatePath(projectRoot, 'TASKS.json'), {
      version: 1,
      lastUpdated: '2026-07-15T00:30:00.000Z',
      tasks: [richTask, ...queuedTasks],
    } satisfies TaskQueue, {
      projectId: 'current-thread-test',
      projectRoot,
    })

    const database = new DatabaseSync(projectStateDatabasePath(projectRoot))
    database.prepare('DELETE FROM work_item_detail WHERE task_id = ?').run('task-queued-19')
    database.close()

    const projection = await refreshCurrentThreadProjection(projectRoot, {
      runStatus: 'stopped',
      recentEvents: [],
    })

    expect(projection).not.toBeNull()
    expect(projection?.turns.find(turn => turn.id === 'request:request-rich-thread')).toMatchObject({
      kind: 'request',
      rawRequest: 'Show the selected Thread task clearly.',
    })
    expect(projection?.turns.find(turn => turn.id === 'spec:task-rich-thread')).toMatchObject({
      kind: 'spec_review',
      spec: '## Summary\n\nThe selected Thread task keeps its rich fields.',
      taskStatus: 'spec_review',
    })
    const stored = readProjectStateDatabaseCurrentThread(projectRoot)
    expect(stored?.sourceRevision).toEqual(expect.any(String))
  })

  it('keeps older approved brief turns in history without widening current Thread', async () => {
    const approvedAt = '2026-07-15T00:01:00.000Z'
    const approvedTask = task(projectRoot, {
      id: 'task-history-approved',
      title: 'Preserve the approved history turn',
      status: 'done',
      createdAt: '2026-07-15T00:01:00.000Z',
      updatedAt: '2026-07-15T00:01:00.000Z',
      completedAt: '2026-07-15T00:01:00.000Z',
      productBrief: {
        userJob: 'Keep the approved brief visible in history.',
        whyItMattersNow: 'The history reader must preserve owner decisions.',
        successMetric: 'The approved turn retains its approval metadata.',
        antiPatterns: ['Do not make history depend on the current window.'],
        authoredBy: 'spec-agent',
        approvedAt,
      },
    })
    const recentTasks = Array.from({ length: 10 }, (_, index) => task(projectRoot, {
      id: `task-history-recent-${index}`,
      title: `Recent completed task ${index}`,
      status: 'done',
      createdAt: `2026-07-15T00:${String(index + 2).padStart(2, '0')}:00.000Z`,
      updatedAt: `2026-07-15T00:${String(index + 2).padStart(2, '0')}:00.000Z`,
      completedAt: `2026-07-15T00:${String(index + 2).padStart(2, '0')}:00.000Z`,
    }))
    writeProjectTaskQueueWithSummary(getProjectSystemStatePath(projectRoot, 'TASKS.json'), {
      version: 1,
      lastUpdated: '2026-07-15T00:30:00.000Z',
      tasks: [approvedTask, ...recentTasks],
    } satisfies TaskQueue, {
      projectId: 'current-thread-test',
      projectRoot,
    })

    await refreshCurrentThreadProjection(projectRoot, { runStatus: 'stopped', recentEvents: [] })

    const current = readProjectStateDatabaseCurrentThread(projectRoot)
    expect((current?.payload as { turns: Array<{ id: string }> }).turns)
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ id: 'brief:task-history-approved' })]))
    const history = readProjectStateDatabaseThreadHistoryPage(projectRoot, { limit: 100 })
    expect(history?.turns).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'brief:task-history-approved',
        approvedAt,
        brief: expect.objectContaining({ authoredBy: 'spec-agent' }),
      }),
    ]))
  })

  it('marks the current Thread stale when a non-queue project revision advances', async () => {
    const queue: TaskQueue = {
      version: 1,
      lastUpdated: '2026-07-15T00:00:00.000Z',
      tasks: [task(projectRoot)],
    }
    writeProjectTaskQueueWithSummary(getProjectSystemStatePath(projectRoot, 'TASKS.json'), queue, {
      projectId: 'current-thread-test',
      projectRoot,
    })
    await refreshCurrentThreadProjection(projectRoot, { runStatus: 'stopped', recentEvents: [] })
    upsertProjectStateDatabaseTaskRuntime(projectRoot, {
      taskId: 'task-current-thread',
      updatedAt: '2026-07-15T00:01:00.000Z',
      payload: { status: 'in_progress' },
    })

    const { app } = buildServeApp({ projectPath: projectRoot })
    const response = await app.fetch(new Request(
      'http://localhost/api/project/thread?projectId=current-thread-test',
    ))
    const body = await response.json() as { currentThreadFreshness?: string }

    expect(response.status).toBe(200)
    expect(body.currentThreadFreshness).toBe('stale')
  })

  it('does not publish current after the source advances during the write', async () => {
    writeProjectTaskQueueWithSummary(getProjectSystemStatePath(projectRoot, 'TASKS.json'), {
      version: 1,
      lastUpdated: '2026-07-15T00:00:00.000Z',
      tasks: [task(projectRoot)],
    } satisfies TaskQueue, {
      projectId: 'current-thread-test',
      projectRoot,
    })
    const database = new DatabaseSync(projectStateDatabasePath(projectRoot))
    database.exec(`
      CREATE TRIGGER current_thread_race_insert
      AFTER INSERT ON current_thread
      BEGIN
        UPDATE project_meta SET revision = revision + 1;
      END;
      CREATE TRIGGER current_thread_race_update
      AFTER UPDATE ON current_thread
      BEGIN
        UPDATE project_meta SET revision = revision + 1;
      END;
    `)
    database.close()

    const projection = await refreshCurrentThreadProjection(projectRoot, {
      runStatus: 'stopped',
      recentEvents: [],
    })

    expect(projection).toBeNull()
    const stored = readProjectStateDatabaseCurrentThread(projectRoot)
    const metadata = readProjectStateDatabaseMetadata(projectRoot)
    expect(stored?.sourceRevision).not.toBe(String(metadata?.revision))

    const { app } = buildServeApp({ projectPath: projectRoot })
    const response = await app.fetch(new Request(
      'http://localhost/api/project/thread?projectId=current-thread-test',
    ))
    const body = await response.json() as { currentThreadFreshness?: string }
    expect(response.status).toBe(200)
    expect(body.currentThreadFreshness).toBe('stale')
  })
})
