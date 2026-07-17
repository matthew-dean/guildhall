import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { DatabaseSync } from 'node:sqlite'

import { bootstrapWorkspace, registerWorkspace, unregisterWorkspace } from '@guildhall/config'
import type { Task, TaskQueue } from '@guildhall/core'
import {
  getProjectLocalHistoryDir,
  getProjectStateDir,
  projectStateDatabasePath,
  projectStatePath,
  replaceProjectStateDatabaseAttentionRecords,
  upsertTaskRuntimeState,
  writeProjectStateJsonAsync,
  writeProjectStateTextAsync,
} from '@guildhall/sessions'
import * as sessions from '@guildhall/sessions'
import { buildServeApp } from '../serve.js'
import { writeProjectSummaryProjection } from '../project-summary-projection.js'
import { inferProjectOrientationSnapshot } from '../project-orientation-snapshot.js'

/**
 * These are deliberately integration-level write-boundary tests. A GET must
 * not quietly normalize a task, refresh a summary, reconcile attention, or
 * persist any of the durable inputs used to project Thread.
 */

type FileSnapshot = {
  content: string
  mtimeMs: number
  size: number
}

type DurableStateSnapshot = Map<string, FileSnapshot>

type ReadRoute = {
  label: string
  route: string
  taskId?: string
}

let tmpDir: string
let projectId: string

const readRoutes: ReadRoute[] = [
  {
    label: 'compact project',
    route: '/api/project?surface=overview&compact=true',
  },
  {
    label: 'activity',
    route: '/api/project/activity',
  },
  {
    label: 'activity history',
    route: '/api/project/activity/history?limit=10',
  },
  {
    label: 'spine',
    route: '/api/project/spine?compact=true',
  },
  {
    label: 'release readiness',
    route: '/api/project/release-readiness',
  },
  {
    label: 'project graph',
    route: '/api/project/project-graph',
  },
  {
    label: 'task detail',
    route: '/api/project/task/task-boundary',
    taskId: 'task-boundary',
  },
  {
    label: 'task Git Story diagnostic',
    route: '/api/project/task/task-boundary/git-story',
    taskId: 'task-boundary',
  },
]

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-read-boundary-'))
  projectId = bootstrapWorkspace(tmpDir, { name: 'Read Boundary Test' }).id ?? path.basename(tmpDir)
  await seedDurableState()
})

afterEach(async () => {
  vi.restoreAllMocks()
  unregisterWorkspace(projectId)
  await fs.rm(tmpDir, { recursive: true, force: true })
})

function projectUrl(route: string): string {
  const url = new URL(`http://localhost${route}`)
  url.searchParams.set('projectId', projectId)
  return url.toString()
}

function makeBoundaryTask(overrides: Partial<Task> = {}): Task {
  const now = '2026-07-14T00:00:00.000Z'
  return {
    id: 'task-boundary',
    title: 'A task with a read-time ownership mismatch',
    description: 'The route must report this state without repairing it during a GET.',
    domain: 'core',
    projectPath: tmpDir,
    references: [],
    sourceClaims: [],
    status: 'in_progress',
    assignedTo: null,
    priority: 'normal',
    acceptanceCriteria: [],
    outOfScope: [],
    dependsOn: [],
    releaseIds: ['release-boundary'],
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

async function seedDurableState(): Promise<void> {
  const queue: TaskQueue = {
    version: 1,
    lastUpdated: '2026-07-14T00:00:00.000Z',
    selectedReleaseId: 'release-boundary',
    releases: [{
      id: 'release-boundary',
      label: 'Boundary release',
      kind: 'release',
      state: 'active',
      source: 'owner_approved',
      nodeIds: ['work:task-boundary'],
      deferredNodeIds: [],
    }],
    tasks: [makeBoundaryTask()],
  }
  const tasksPath = projectStatePath(tmpDir, 'TASKS.json')
  await writeProjectStateJsonAsync(tmpDir, 'TASKS.json', queue)
  await writeProjectStateJsonAsync(tmpDir, 'workspace-goals.json', {
    version: 3,
    recordedAt: '2026-07-14T00:00:00.000Z',
    goals: [{ id: 'goal-boundary', title: 'Keep read scopes honest' }],
    releases: [{ id: 'release-boundary', label: 'Boundary release', source: 'owner_approved', state: 'active' }],
    tasks: [{ id: 'task-boundary', title: makeBoundaryTask().title, scope: 'current', releaseIds: ['release-boundary'] }],
    milestones: [],
    approved: {
      goalCount: 1,
      taskCount: 1,
      milestoneCount: 0,
      currentTaskCount: 1,
      laterTaskCount: 0,
      taskIds: ['task-boundary'],
      currentTaskIds: ['task-boundary'],
      laterTaskIds: [],
    },
    detected: null,
  })
  writeProjectSummaryProjection(tasksPath, { projectId, queue })

  // Keep an existing attention store and a real Thread input on disk. This
  // makes accidental reconciliation or Thread-state persistence observable.
  await writeProjectStateJsonAsync(tmpDir, 'attention.json', {
    version: 1,
    records: [],
  })
  await writeProjectStateTextAsync(tmpDir, 'agent-settings.yaml', 'version: 1\n')
  await writeProjectStateJsonAsync(tmpDir, path.join('bounded-chat', 'bc-read-boundary.json'), {
    id: 'bc-read-boundary',
    projectId,
    source: 'test:read-boundary',
    objective: {
      kind: 'new_request',
      label: 'Read boundary test',
      successCriteria: ['A GET leaves the Thread input unchanged.'],
      startedAt: '2026-07-14T00:00:00.000Z',
    },
    status: 'waiting_for_owner',
    activeSubObjectiveId: 'question-1',
    subObjectives: [{
      id: 'question-1',
      objective: 'Confirm the read boundary',
      prompt: 'Should a GET mutate durable state?',
      choices: ['No'],
      selectionMode: 'single',
      followUpDepth: 0,
      localTurns: [],
      status: 'active',
    }],
    acceptedState: {
      facts: [],
      decisions: [],
      leverUpdates: [],
      settingUpdates: [],
      taskDrafts: [],
      unresolvedForks: [],
      discardedResponses: [],
    },
    pendingActions: [],
    appliedActionIds: [],
    transitionReceipts: [],
    createdAt: '2026-07-14T00:00:00.000Z',
    updatedAt: '2026-07-14T00:00:00.000Z',
  })
}

async function listFiles(root: string): Promise<string[]> {
  const files: string[] = []
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name)
    if (entry.isDirectory()) files.push(...await listFiles(fullPath))
    else if (entry.isFile()) files.push(fullPath)
  }
  return files
}

async function snapshotDurableState(): Promise<DurableStateSnapshot> {
  const roots = [
    { label: 'system-local', path: getProjectLocalHistoryDir(tmpDir) },
    { label: 'legacy-project-state', path: getProjectStateDir(tmpDir) },
  ]
  const snapshot: DurableStateSnapshot = new Map()
  for (const root of roots) {
    for (const file of await listFiles(root.path)) {
      const relativePath = path.relative(root.path, file)
      // Agent settings has its own first-read seeding contract. This suite is
      // about the project-state records that summarize work and feed Thread.
      if (relativePath === 'project-state/agent-settings.yaml') continue
      const stat = await fs.stat(file)
      snapshot.set(`${root.label}:${relativePath}`, {
        content: await fs.readFile(file, 'utf8'),
        mtimeMs: stat.mtimeMs,
        size: stat.size,
      })
    }
  }
  return snapshot
}

function changedFiles(before: DurableStateSnapshot, after: DurableStateSnapshot): string[] {
  const keys = new Set([...before.keys(), ...after.keys()])
  return [...keys].filter(key => {
    const left = before.get(key)
    const right = after.get(key)
    return !left || !right || left.content !== right.content || left.mtimeMs !== right.mtimeMs || left.size !== right.size
  }).sort()
}

describe('GET route read boundaries', () => {
  it.each(readRoutes)('$label does not mutate durable project state', async ({ route, taskId }) => {
    const { app } = buildServeApp({ projectPath: tmpDir })
    const before = await snapshotDurableState()

    const response = await app.fetch(new Request(projectUrl(route)))

    expect(response.status, `${route} should be readable`).toBe(200)
    if (taskId) {
      expect(route).toContain(encodeURIComponent(taskId))
    }
    const after = await snapshotDurableState()
    expect(changedFiles(before, after), `${route} mutated durable project state`).toEqual([])
  })

  it('uses the approved release scope consistently across compact and detail reads', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })

    for (const surface of ['overview', 'work', 'map']) {
      const compactResponse = await app.fetch(new Request(projectUrl(`/api/project?surface=${surface}&compact=true`)))
      const compactBody = await compactResponse.json() as any
      expect(compactResponse.status).toBe(200)
      expect(compactBody.releaseSummary).toMatchObject({
        scopeMode: 'named_release',
        release: { id: 'release-boundary', label: 'Boundary release' },
      })
      expect(compactBody.orientationSpine.selectedRelease).toMatchObject({
        id: 'release-boundary',
        label: 'Boundary release',
      })
      expect(compactBody.orientationSpine.selectedTaskScope).toMatchObject({
        id: 'release-boundary',
        nodeIds: ['work:task-boundary'],
        deferredNodeIds: [],
      })
    }

    const activityResponse = await app.fetch(new Request(projectUrl('/api/project/activity')))
    const activityBody = await activityResponse.json() as any
    expect(activityResponse.status).toBe(200)
    expect(activityBody.releaseSummary).toMatchObject({
      scopeMode: 'named_release',
      release: { id: 'release-boundary', label: 'Boundary release' },
    })

    const spineResponse = await app.fetch(new Request(projectUrl('/api/project/spine')))
    const spineBody = await spineResponse.json() as any
    expect(spineResponse.status).toBe(200)
    expect(spineBody.spine.selectedRelease).toMatchObject({
      id: 'release-boundary',
      label: 'Boundary release',
    })

    const readinessResponse = await app.fetch(new Request(projectUrl('/api/project/release-readiness')))
    const readinessBody = await readinessResponse.json() as any
    expect(readinessResponse.status).toBe(200)
    expect(readinessBody.release).toMatchObject({
      id: 'release-boundary',
      label: 'Boundary release',
    })
    expect(readinessBody.scope).toMatchObject({
      id: 'release-boundary',
      nodeIds: ['work:task-boundary'],
      deferredNodeIds: [],
    })
  })

  it('uses the bounded projection for an unqualified project read', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })
    const response = await app.fetch(new Request(projectUrl('/api/project')))
    const body = await response.json() as any

    expect(response.status).toBe(200)
    expect(body.detailPayload).toMatchObject({
      kind: 'project-summary-projection',
      omitted: expect.arrayContaining(['Git Story', 'request-time repair']),
    })
    expect(body.detailPayload.endpoints).toMatchObject({
      activity: '/api/project/activity',
      activityHistory: '/api/project/activity/history',
      inbox: '/api/project/inbox',
      thread: '/api/project/thread',
      releaseReadiness: '/api/project/release-readiness',
      gitStory: '/api/project/git-story',
      taskDetail: '/api/project/task/:id',
    })
    expect(body.config).toBeUndefined()
    expect(body.gitStory).toBeUndefined()
    expect(body.inbox).toBeUndefined()
  })

  it('keeps explicit project detail bounded without running independent diagnostics', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })
    const response = await app.fetch(new Request(projectUrl('/api/project?detail=true')))
    const body = await response.json() as any

    expect(response.status).toBe(200)
    expect(JSON.stringify(body).length).toBeLessThan(100_000)
    expect(body.config).toBeDefined()
    expect(body.inbox).toMatchObject({ items: expect.any(Array) })
    expect(body.inbox.items.length).toBeLessThanOrEqual(50)
    expect(body.thread).toBeUndefined()
    expect(body.gitStory).toBeUndefined()
    expect(body.memoryHealth).toBeDefined()
    expect(body.recentEvents).toBeDefined()
    expect(body.detailPayload).toBeUndefined()
  })

  it('keeps the structural projection usable after a dynamic task overlay write', async () => {
    const queue: TaskQueue = {
      version: 1,
      lastUpdated: '2026-07-14T00:00:00.000Z',
      selectedReleaseId: 'release-boundary',
      releases: [{
        id: 'release-boundary',
        label: 'Boundary release',
        kind: 'release',
        state: 'active',
        source: 'owner_approved',
        nodeIds: ['work:task-boundary'],
        deferredNodeIds: [],
        proofStyle: 'script_only',
      }],
      tasks: [
        makeBoundaryTask({ releaseIds: ['release-boundary'] }),
        ...Array.from({ length: 8 }, (_, index) => makeBoundaryTask({
          id: `task-outside-${index + 1}`,
          title: `Outside task ${index + 1}`,
          releaseIds: [],
        })),
      ],
    }
    const tasksPath = projectStatePath(tmpDir, 'TASKS.json')
    await writeProjectStateJsonAsync(tmpDir, 'TASKS.json', queue)
    writeProjectSummaryProjection(tasksPath, { projectId, queue })
    await upsertTaskRuntimeState(tmpDir, 'task-boundary', { assignedTo: 'coordinator' })

    const { app } = buildServeApp({ projectPath: tmpDir })
    const response = await app.fetch(new Request(projectUrl('/api/project?surface=overview&compact=true')))
    const body = await response.json() as any

    expect(response.status).toBe(200)
    expect(body.tasks.length).toBeLessThan(4)
    expect(body.tasks.map((task: any) => task.id)).toContain('task-boundary')
    expect(body.tasks.map((task: any) => task.id)).not.toContain('task-outside-8')
    expect(body.taskPayload.kind).toBe('selected_scope_cards')
  })

  it('serves the last indexed state immediately when a legacy file changes out of band', async () => {
    const tasksPath = projectStatePath(tmpDir, 'TASKS.json')
    const changedQueue = {
      version: 1,
      lastUpdated: '2026-07-14T00:01:00.000Z',
      tasks: [{ ...makeBoundaryTask(), title: 'Legacy file changed outside Guildhall' }],
    }
    await writeProjectStateJsonAsync(tmpDir, 'TASKS.json', changedQueue)

    const { app } = buildServeApp({ projectPath: tmpDir })
    const response = await app.fetch(new Request(projectUrl('/api/project?surface=overview&compact=true')))
    const body = await response.json() as any

    expect(response.status).toBe(200)
    expect(body.detailPayload).toMatchObject({ freshness: 'stale' })
    expect(body.tasks[0]?.title).toBe('A task with a read-time ownership mismatch')
    expect(body.tasks[0]?.title).not.toBe('Legacy file changed outside Guildhall')
  })

  it('does not parse TASKS.json for a current Overview read', async () => {
    const tasksPath = projectStatePath(tmpDir, 'TASKS.json')
    const original = await fs.stat(tasksPath)
    await fs.writeFile(tasksPath, '{ this is intentionally not a task queue }', 'utf8')
    await fs.utimes(tasksPath, original.atime, new Date(original.mtimeMs))
    const sourceMtimeMs = (await fs.stat(tasksPath)).mtimeMs
    const database = new DatabaseSync(projectStateDatabasePath(tmpDir))
    database.prepare('UPDATE project_summary SET source_queue_mtime_ms = ? WHERE id = 1').run(sourceMtimeMs)
    database.close()

    const { app } = buildServeApp({ projectPath: tmpDir })
    const response = await app.fetch(new Request(projectUrl('/api/project?surface=overview&compact=true')))
    const body = await response.json() as any

    expect(response.status).toBe(200)
    expect(body.detailPayload).toMatchObject({ freshness: 'current' })
    expect(body.tasks).toEqual([expect.objectContaining({ id: 'task-boundary' })])
  })

  it('does not parse TASKS.json for a current compact spine read', async () => {
    const tasksPath = projectStatePath(tmpDir, 'TASKS.json')
    const original = await fs.stat(tasksPath)
    await fs.writeFile(tasksPath, '{ this is intentionally not a task queue }', 'utf8')
    await fs.utimes(tasksPath, original.atime, new Date(original.mtimeMs))
    const sourceMtimeMs = (await fs.stat(tasksPath)).mtimeMs
    const database = new DatabaseSync(projectStateDatabasePath(tmpDir))
    database.prepare('UPDATE project_summary SET source_queue_mtime_ms = ? WHERE id = 1').run(sourceMtimeMs)
    database.close()

    const { app } = buildServeApp({ projectPath: tmpDir })
    const response = await app.fetch(new Request(projectUrl('/api/project/spine?compact=true')))
    const body = await response.json() as any

    expect(response.status).toBe(200)
    expect(body.summary).toMatchObject({ summaryFreshness: 'current' })
    expect(body.spine.selectedRelease).toMatchObject({ id: 'release-boundary' })
  })

  it('does not expand task definitions for the saved noncompact spine read', async () => {
    const tasksPath = projectStatePath(tmpDir, 'TASKS.json')
    const original = await fs.stat(tasksPath)
    await fs.writeFile(tasksPath, '{ this is intentionally not a task queue }', 'utf8')
    await fs.utimes(tasksPath, original.atime, new Date(original.mtimeMs))

    const { app } = buildServeApp({ projectPath: tmpDir })
    const response = await app.fetch(new Request(projectUrl('/api/project/spine')))
    const body = await response.json() as any

    expect(response.status).toBe(200)
    expect(body.spine).toMatchObject({
      projectId,
      selectedRelease: { id: 'release-boundary' },
      scope: { id: 'release-boundary' },
    })
    expect(body.spine.nodes).toEqual(expect.any(Object))
  })

  it('uses the promoted database queue for rich routes after TASKS.json is removed', async () => {
    const tasksPath = projectStatePath(tmpDir, 'TASKS.json')
    const database = new DatabaseSync(projectStateDatabasePath(tmpDir))
    database.prepare("UPDATE project_meta SET project_state_authority = 'database'").run()
    database.close()
    await fs.rm(tasksPath)

    const { app } = buildServeApp({ projectPath: tmpDir })
    const routes = [
      '/api/project?detail=true',
      '/api/project/activity',
      '/api/project/spine',
      '/api/project/release-readiness',
      '/api/project/project-graph',
      '/api/project/git-story',
      '/api/project/delivery-spine',
      '/api/project/inbox',
      '/api/project/task/task-boundary',
    ]
    for (const route of routes) {
      const response = await app.fetch(new Request(projectUrl(route)))
      expect(response.status, `${route} should read the promoted database state`).toBe(200)
    }
    const activity = await app.fetch(new Request(projectUrl('/api/project/activity')))
    const activityBody = await activity.json() as any
    expect(activityBody.counts.in_progress).toBe(1)
    expect(activityBody.inFlight).toEqual([expect.objectContaining({ id: 'task-boundary', status: 'in_progress' })])
  })

  it('reads current activity from the summary shell without queue detail', async () => {
    const tasksPath = projectStatePath(tmpDir, 'TASKS.json')
    const database = new DatabaseSync(projectStateDatabasePath(tmpDir))
    database.prepare("UPDATE project_meta SET project_state_authority = 'database'").run()
    // Activity is a current-state read. Its contract must not depend on the
    // compressed queue detail or full work-item definitions being opened.
    database.exec('DROP TABLE queue_detail; DROP TABLE work_items;')
    database.close()
    await fs.rm(tasksPath)

    const { app } = buildServeApp({ projectPath: tmpDir })
    const response = await app.fetch(new Request(projectUrl('/api/project/activity')))
    const body = await response.json() as any

    expect(response.status).toBe(200)
    expect(body.summaryFreshness).toBe('current')
    expect(body.counts.in_progress).toBe(1)
    expect(body.inFlight).toEqual([expect.objectContaining({ id: 'task-boundary', status: 'in_progress' })])
  })

  it('reads current Inbox from its projection without rediscovering task state', async () => {
    replaceProjectStateDatabaseAttentionRecords(tmpDir, [{
      id: 'attention-boundary',
      status: 'open',
      updatedAt: '2026-07-14T00:01:00.000Z',
      kind: 'project_understanding',
      severity: 'medium',
      title: 'Review project discovery update',
      detail: 'A current attention record.',
      signals: ['intake.v1'],
      actionHref: '/workspace-import?mode=reconcile',
      dismissEndpoint: '/api/project/attention/dismiss?id=attention-boundary',
    }])
    const database = new DatabaseSync(projectStateDatabasePath(tmpDir))
    database.prepare("UPDATE project_meta SET project_state_authority = 'database'").run()
    database.exec('DROP TABLE queue_detail; DROP TABLE work_items;')
    database.close()
    await fs.rm(projectStatePath(tmpDir, 'TASKS.json'))

    const { app } = buildServeApp({ projectPath: tmpDir })
    const response = await app.fetch(new Request(projectUrl('/api/project/inbox')))
    const body = await response.json() as any

    expect(response.status).toBe(200)
    expect(body.items).toEqual([expect.objectContaining({ id: 'attention-boundary', title: 'Review project discovery update' })])
    expect(body.blockers).toEqual({ bootstrap: false, workspaceImport: false })
  })

  it('does not reconstruct Inbox when its projection is missing', async () => {
    const aggregateRead = vi.spyOn(sessions, 'readProjectStateDatabaseQueue').mockImplementation(() => {
      throw new Error('Inbox GET must not rebuild the queue')
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const response = await app.fetch(new Request(projectUrl('/api/project/inbox')))
    const body = await response.json() as any

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      items: [],
      history: [],
      freshness: 'missing',
      requiresRefresh: true,
    })
    expect(aggregateRead).not.toHaveBeenCalled()
  })

  it('keeps the compact spine on the last indexed release state after an out-of-band queue edit', async () => {
    const tasksPath = projectStatePath(tmpDir, 'TASKS.json')
    await writeProjectStateJsonAsync(tmpDir, 'TASKS.json', {
      version: 1,
      lastUpdated: '2026-07-14T00:01:00.000Z',
      tasks: [{ ...makeBoundaryTask(), title: 'Legacy spine should not win', releaseIds: [] }],
      releases: [],
    })

    const { app } = buildServeApp({ projectPath: tmpDir })
    const response = await app.fetch(new Request(projectUrl('/api/project/spine?compact=true')))
    const body = await response.json() as any

    expect(response.status).toBe(200)
    expect(body.summary).toMatchObject({
      summaryFreshness: 'stale',
      releaseSummary: { release: { id: 'release-boundary', label: 'Boundary release' } },
    })
    expect(body.spine.selectedRelease).toMatchObject({ id: 'release-boundary', label: 'Boundary release' })
  })

  it('uses the saved orientation snapshot instead of rereading repository documents on compact project surfaces', async () => {
    const tasksPath = projectStatePath(tmpDir, 'TASKS.json')
    await fs.writeFile(path.join(tmpDir, 'README.md'), 'Guildhall is a durable project planner for small teams.\n', 'utf8')
    writeProjectSummaryProjection(tasksPath, {
      projectId,
      queue: {
        version: 1,
        lastUpdated: '2026-07-14T00:00:00.000Z',
        tasks: [makeBoundaryTask()],
      },
      orientation: inferProjectOrientationSnapshot(tmpDir),
    })
    await fs.writeFile(path.join(tmpDir, 'README.md'), 'A changed README must not become a second compact-map interpretation.\n', 'utf8')

    const { app } = buildServeApp({ projectPath: tmpDir })
    for (const surface of ['overview', 'work', 'map']) {
      const response = await app.fetch(new Request(projectUrl(`/api/project?surface=${surface}&compact=true`)))
      const body = await response.json() as any
      expect(response.status).toBe(200)
      expect(body.orientationSpine.charter.goal).toBe('Guildhall is a durable project planner for small teams.')
      expect(body.orientationSpine.executionBoundary.source.refs).toContain('README.md')
      expect(body.config).toBeUndefined()
      expect(body.coordinatorCount).toBeTypeOf('number')
      if (surface === 'overview') {
        expect(body.orientationSpine.roots).toEqual([])
        expect(body.orientationSpine.nodes).toEqual({})
      }
    }
  })

  it('bounds compact inventory reads and exposes a cursor for the next page', async () => {
    const queue: TaskQueue = {
      version: 1,
      lastUpdated: '2026-07-14T00:00:00.000Z',
      tasks: [
        makeBoundaryTask(),
        makeBoundaryTask({ id: 'task-boundary-2', title: 'Second bounded task' }),
        makeBoundaryTask({ id: 'task-boundary-3', title: 'Third bounded task' }),
      ],
    }
    const tasksPath = projectStatePath(tmpDir, 'TASKS.json')
    await writeProjectStateJsonAsync(tmpDir, 'TASKS.json', queue)
    writeProjectSummaryProjection(tasksPath, { projectId, queue })
    const { app } = buildServeApp({ projectPath: tmpDir })

    const first = await app.fetch(new Request(projectUrl('/api/project?surface=work&compact=true&inventoryLimit=1&inventoryOffset=0')))
    const firstBody = await first.json() as any
    expect(first.status).toBe(200)
    expect(firstBody.tasks).toHaveLength(1)
    expect(firstBody.taskPayload).toMatchObject({
      offset: 0,
      limit: 1,
      count: 1,
      totalEffectiveCount: 3,
      hasMore: true,
      nextOffset: 1,
    })
    expect(firstBody.orientationSpine.scopeRows).toHaveLength(1)
    expect(firstBody.orientationSpine.scopeRowCounts).toMatchObject({ included: 3, deferred: 0 })

    const second = await app.fetch(new Request(projectUrl('/api/project?surface=work&compact=true&inventoryLimit=1&inventoryOffset=1')))
    const secondBody = await second.json() as any
    expect(second.status).toBe(200)
    expect(secondBody.tasks).toHaveLength(1)
    expect(secondBody.tasks[0].id).toBe('task-boundary-2')
    expect(secondBody.taskPayload).toMatchObject({ offset: 1, limit: 1, hasMore: true, nextOffset: 2 })
  })

  it('does not aggregate-read a large queue when the compact projection is missing', async () => {
    const queue: TaskQueue = {
      version: 1,
      lastUpdated: '2026-07-14T00:00:00.000Z',
      tasks: Array.from({ length: 1_000 }, (_, index) => makeBoundaryTask({
        id: `task-large-${index + 1}`,
        title: `Large synthetic task ${index + 1}`,
      })),
    }
    const tasksPath = projectStatePath(tmpDir, 'TASKS.json')
    await writeProjectStateJsonAsync(tmpDir, 'TASKS.json', queue)
    writeProjectSummaryProjection(tasksPath, { projectId, queue })

    // Leave the indexed work rows in place but remove only the compact summary
    // so the route must choose between a bounded inventory and an aggregate
    // reconstruction.
    const database = new DatabaseSync(projectStateDatabasePath(tmpDir))
    database.prepare('DELETE FROM project_summary WHERE id = 1').run()
    database.close()

    const aggregateRead = vi.spyOn(sessions, 'readProjectStateDatabaseQueue').mockImplementation(() => {
      throw new Error('aggregate queue reads are forbidden for compact project routes')
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const response = await app.fetch(new Request(projectUrl('/api/project?surface=work&compact=true&inventoryLimit=7')))
    const body = await response.json() as any

    expect(response.status).toBe(200)
    expect(aggregateRead).not.toHaveBeenCalled()
    expect(body.summaryFreshness).toBe('missing')
    expect(body.projectStatusError).toContain('not available')
    expect(body.tasks).toEqual([])
    expect(body.taskPayload).toMatchObject({
      count: 0,
      totalEffectiveCount: 1_000,
      hasMore: true,
      nextOffset: 7,
    })
    expect(body.detailPayload).toMatchObject({
      freshness: 'missing',
      unavailable: true,
      requiresRefresh: true,
    })
    expect(JSON.stringify(body).length).toBeLessThan(25_000)

    registerWorkspace({ id: projectId, name: 'Read Boundary Test', path: tmpDir, tags: [] })
    const serviceResponse = await app.fetch(new Request('http://localhost/api/service?detail=true'))
    const serviceBody = await serviceResponse.json() as any
    expect(serviceResponse.status).toBe(200)
    expect(serviceBody).toMatchObject({
      partial: true,
      detail: 'bounded_project_summaries',
      omitted: expect.arrayContaining(['task inventory', 'Thread']),
    })
    expect(serviceBody.projects).toEqual(expect.arrayContaining([expect.objectContaining({
      id: projectId,
      summaryFreshness: 'missing',
    })]))
    expect(aggregateRead).not.toHaveBeenCalled()
  })
})
