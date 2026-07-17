import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { TaskQueue } from '@guildhall/core'
import { getProjectSystemStatePath, markProjectSummaryStale, promoteProjectStateDatabaseAuthority, projectStateDatabaseCompressedDetailPathFromTasksPath, projectStateDatabasePath, readProjectStateDatabaseQueue, readProjectStateDatabaseQueueDefinition, readProjectStateDatabaseQueueRevision, readProjectStateDatabaseInventory } from '@guildhall/sessions'

import {
  buildProjectSummaryProjection,
  buildProjectSummaryProjectionFromIndexedState,
  backfillProjectSummaryProjection,
  projectSummaryProjectionPath,
  queueForProjectSummaryScope,
  readProjectSummaryProjection,
  readProjectSummaryProjectionForMigration,
  updateProjectSummaryProjection,
  writeProjectSummaryProjectionFromIndexedState,
  writeProjectSummaryProjectionFromUnknownQueue,
} from '../project-summary-projection.js'
import { writeProjectTaskQueue } from '../project-state-boundary.js'

const now = '2026-07-14T12:00:00.000Z'

function task(
  id: string,
  status: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    title: id,
    description: id,
    domain: 'general',
    projectPath: '/tmp/project',
    status,
    priority: 'normal',
    references: [],
    sourceClaims: [],
    acceptanceCriteria: [],
    outOfScope: [],
    dependsOn: [],
    notes: [],
    gateResults: [],
    escalations: [],
    createdAt: now,
    updatedAt: now,
    ...extra,
  }
}

function queue(tasks: Record<string, unknown>[], extra: Record<string, unknown> = {}) {
  return TaskQueue.parse({
    version: 1,
    lastUpdated: now,
    tasks,
    releases: [],
    ...extra,
  })
}

describe('project-summary-projection', () => {
  let temp: string | undefined

  afterEach(async () => {
    if (temp) await rm(temp, { recursive: true, force: true })
    temp = undefined
  })

  it('projects scope, counts, and next action without effective-task expansion', () => {
    const projection = buildProjectSummaryProjection({
      projectId: 'narrative-harness',
      queue: queue([
        task('ready-task', 'ready', {
          spec: 'A real spec.',
          acceptanceCriteria: [{ id: 'ac-1', description: 'It works.', met: false }],
        }),
        task('done-task', 'done'),
        task('blocked-task', 'blocked'),
      ]),
      generatedAt: now,
    })

    expect(projection).toMatchObject({
      projectId: 'narrative-harness',
      freshness: 'current',
      counts: {
        total: 3,
        active: 1,
        blocked: 1,
        done: 1,
        included: 3,
        ready: 1,
        ownerBlocked: 1,
      },
      releaseSummary: {
        scopeMode: 'unreleased',
        release: null,
        counts: { total: 3, done: 1, unfinished: 2, blocked: 1 },
      },
      nextAction: {
        label: 'Start',
        focusTaskId: 'ready-task',
      },
    })
    expect(projection.blockers).toEqual([
      expect.objectContaining({ id: 'blocked-task', owningTaskId: 'blocked-task' }),
    ])
  })

  it('keeps indexed summary refresh aligned with the full projection for task-state facts', async () => {
    temp = await mkdtemp(join(tmpdir(), 'guildhall-summary-index-parity-'))
    const tasksPath = getProjectSystemStatePath(temp, 'TASKS.json')
    const taskQueue = queue([
      task('task-ready', 'ready', {
        spec: 'A concrete implementation spec.',
        acceptanceCriteria: [{ id: 'ac-1', description: 'The proof exists.', met: false }],
        releaseIds: ['release-current'],
      }),
      task('task-done', 'done', {
        releaseIds: ['release-current'],
        completedAt: now,
      }),
      task('task-later', 'ready', {
        releaseIds: ['release-later'],
      }),
    ], {
      selectedReleaseId: 'release-current',
      releases: [
        {
          id: 'release-current',
          label: 'Current release',
          kind: 'release',
          state: 'active',
          source: 'release_plan',
          nodeIds: ['work:task-ready', 'work:task-done'],
          deferredNodeIds: [],
        },
        {
          id: 'release-later',
          label: 'Later release',
          kind: 'release',
          state: 'planned',
          source: 'release_plan',
          nodeIds: [],
          deferredNodeIds: ['work:task-later'],
        },
      ],
    })
    writeProjectTaskQueue(tasksPath, taskQueue, { projectId: 'parity', projectRoot: temp })
    promoteProjectStateDatabaseAuthority(temp)

    const full = buildProjectSummaryProjection({
      projectId: 'parity',
      projectRoot: temp,
      queue: taskQueue,
      generatedAt: now,
    })
    const indexed = buildProjectSummaryProjectionFromIndexedState(tasksPath, {
      projectId: 'parity',
      generatedAt: now,
      sourceQueueLastUpdated: now,
    })

    expect(indexed).not.toBeNull()
    expect(indexed?.counts).toMatchObject({
      total: full.counts.total,
      included: full.counts.included,
      deferred: full.counts.deferred,
      ready: full.counts.ready,
      done: full.counts.done,
      blocked: full.counts.blocked,
    })
    expect(indexed?.scope).toEqual(full.scope)
    expect(indexed?.releaseSummary).toEqual(full.releaseSummary)
    expect(indexed?.nextAction).toEqual(full.nextAction)
    expect(readProjectStateDatabaseInventory(tasksPath, { includeDefinitions: false })?.tasks.every(task => Object.keys(task.definition).length === 0)).toBe(true)
  })

  it('does not let an imported plan reshape current scope after promotion', async () => {
    temp = await mkdtemp(join(tmpdir(), 'guildhall-summary-authority-'))
    const tasksPath = getProjectSystemStatePath(temp, 'TASKS.json')
    const taskQueue = queue([
      task('queue-task', 'ready', { releaseIds: ['release-current'] }),
      task('stale-plan-task', 'done'),
    ], {
      selectedReleaseId: 'release-current',
      releases: [{
        id: 'release-current',
        label: 'Current release',
        kind: 'release',
        state: 'active',
        source: 'owner_approved',
        nodeIds: ['work:queue-task'],
        deferredNodeIds: [],
      }],
    })
    writeProjectTaskQueue(tasksPath, taskQueue, { projectId: 'authority', projectRoot: temp })
    promoteProjectStateDatabaseAuthority(temp)

    const importedPlan = {
      source: 'workspace_import' as const,
      recordedAt: now,
      goalCount: 1,
      taskCount: 1,
      milestoneCount: 0,
      currentTaskCount: 1,
      laterTaskCount: 0,
      currentTaskIds: ['stale-plan-task'],
      laterTaskIds: [],
      currentReleaseId: 'release-current',
      releases: [{
        id: 'release-current',
        label: 'Imported release',
        kind: 'release',
        state: 'active',
        source: 'workspace_import',
        currentTaskIds: ['stale-plan-task'],
        laterTaskIds: [],
      }],
    }
    const projection = buildProjectSummaryProjection({
      projectId: 'authority',
      projectRoot: temp,
      queue: taskQueue,
      approvedPlan: importedPlan,
      generatedAt: now,
    })

    expect(projection.releaseSummary.counts.total).toBe(1)
    expect(projection.releaseSummary.release?.label).toBe('Current release')
    expect(projection.orientationSpine?.summary.includedCount).toBe(1)
  })

  it('keeps approved-plan release containers unique when the queue has the same release', () => {
    const scoped = queueForProjectSummaryScope(
      queue([], {
        releases: [{
          id: 'release-1',
          label: 'Queue release',
          kind: 'release',
          state: 'active',
          source: 'owner_approved',
          proofStyle: 'unspecified',
          nodeIds: [],
          deferredNodeIds: [],
        }],
      }),
      {
        source: 'workspace_import',
        recordedAt: now,
        goalCount: 0,
        taskCount: 0,
        milestoneCount: 0,
        currentTaskCount: 0,
        laterTaskCount: 0,
        currentTaskIds: [],
        laterTaskIds: [],
        currentReleaseId: 'release-1',
        releases: [{
          id: 'release-1',
          label: 'Approved release',
          kind: 'release',
          state: 'active',
          source: 'owner_approved',
          currentTaskIds: [],
          laterTaskIds: [],
        }],
      },
    )

    expect(scoped.releases).toHaveLength(1)
    expect(scoped.releases?.[0]?.id).toBe('release-1')
  })

  it('does not promote stale approved-plan task ids into an explicitly assigned queue release', () => {
    const scoped = queueForProjectSummaryScope(
      queue([
        task('queue-task', 'ready', { releaseIds: ['release-1'] }),
        task('stale-plan-task', 'done'),
      ], {
        releases: [{
          id: 'release-1',
          label: 'Queue release',
          kind: 'release',
          state: 'active',
          source: 'release_plan',
          proofStyle: 'script_only',
          nodeIds: ['work:queue-task'],
          deferredNodeIds: [],
        }],
      }),
      {
        source: 'workspace_import',
        recordedAt: now,
        goalCount: 0,
        taskCount: 1,
        milestoneCount: 0,
        currentTaskCount: 1,
        laterTaskCount: 0,
        currentTaskIds: ['stale-plan-task'],
        laterTaskIds: [],
        currentReleaseId: 'release-1',
        releases: [{
          id: 'release-1',
          label: 'Imported release',
          kind: 'release',
          state: 'active',
          source: 'workspace_import',
          currentTaskIds: ['stale-plan-task'],
          laterTaskIds: [],
        }],
      },
    )

    expect(scoped.releases?.[0]?.nodeIds).toEqual(['work:queue-task'])
    expect(scoped.releases?.[0]?.nodeIds).not.toContain('work:stale-plan-task')
  })

  it('keeps replaced queue work current when the approved plan only names stale task ids', () => {
    const scoped = queueForProjectSummaryScope(
      queue([
        task('replacement-one', 'ready', {
          spec: 'Spec',
          acceptanceCriteria: [{ id: 'ac-1', description: 'Proof' }],
        }),
        task('replacement-two', 'blocked'),
      ], {
        releases: [{
          id: 'release-1',
          label: 'Current release',
          kind: 'release',
          state: 'active',
          source: 'release_plan',
          proofStyle: 'script_only',
          nodeIds: [],
          deferredNodeIds: [],
        }],
        selectedReleaseId: 'release-1',
      }),
      {
        source: 'workspace_import',
        recordedAt: now,
        goalCount: 1,
        taskCount: 2,
        milestoneCount: 0,
        currentTaskCount: 2,
        laterTaskCount: 0,
        currentTaskIds: ['old-task-one', 'old-task-two'],
        laterTaskIds: [],
        currentReleaseId: 'release-1',
        releases: [{
          id: 'release-1',
          label: 'Imported release',
          kind: 'release',
          state: 'active',
          source: 'release_plan',
          currentTaskIds: ['old-task-one', 'old-task-two'],
          laterTaskIds: [],
        }],
      },
    )

    expect(scoped.releases?.[0]?.nodeIds).toEqual([
      'work:replacement-one',
      'work:replacement-two',
    ])
    expect(scoped.releases?.[0]?.deferredNodeIds).toEqual([])

    const projection = buildProjectSummaryProjection({
      projectId: 'replaced-project',
      queue: scoped,
      approvedPlan: {
        source: 'workspace_import',
        recordedAt: now,
        goalCount: 1,
        taskCount: 2,
        milestoneCount: 0,
        currentTaskCount: 2,
        laterTaskCount: 0,
        currentTaskIds: ['old-task-one', 'old-task-two'],
        laterTaskIds: [],
        currentReleaseId: 'release-1',
        releases: [{
          id: 'release-1',
          label: 'Imported release',
          kind: 'release',
          state: 'active',
          source: 'release_plan',
          currentTaskIds: ['old-task-one', 'old-task-two'],
          laterTaskIds: [],
        }],
      },
      generatedAt: now,
    })
    expect(projection.releaseSummary).toMatchObject({
      state: 'blocked',
      counts: { total: 2, deferred: 0 },
    })
  })

  it('keeps a selected release and deferred work in the projection', () => {
    const projection = buildProjectSummaryProjection({
      queue: queue([
        task('now-task', 'ready', {
          releaseIds: ['release-1'],
          spec: 'Spec',
          acceptanceCriteria: [{ id: 'ac-1', description: 'Proof' }],
        }),
        task('later-task', 'ready', { releaseIds: ['release-2'] }),
      ], {
        releases: [
          {
            id: 'release-1',
            label: 'Current release',
            kind: 'release',
            state: 'active',
            source: 'owner_approved',
            nodeIds: ['work:now-task'],
            deferredNodeIds: [],
          },
          {
            id: 'release-2',
            label: 'Later release',
            kind: 'release',
            state: 'planned',
            source: 'spec',
            nodeIds: ['work:later-task'],
            deferredNodeIds: [],
          },
        ],
        selectedReleaseId: 'release-1',
      }),
      generatedAt: now,
    })

    expect(projection.scope).toMatchObject({
      id: 'release-1',
      label: 'Current release',
      included: 1,
      deferred: 1,
    })
    expect(projection.counts).toMatchObject({ included: 1, deferred: 1, ready: 1 })
    expect(projection.nextAction.focusTaskId).toBe('now-task')
    expect(projection.orientationSpine).toMatchObject({
      selectedRelease: { id: 'release-1', label: 'Current release' },
      nodes: {},
    })
    expect(projection.releaseSummary).toMatchObject({
      scopeMode: 'named_release',
      release: { id: 'release-1', label: 'Current release' },
      counts: { total: 1, deferred: 1 },
    })
  })

  it('keeps task prose out of the stored map projection', () => {
    const taskDescription = 'Unique task prose that belongs in an explicit task-detail read, not every project-map response.'
    const projection = buildProjectSummaryProjection({
      queue: queue([task('map-budget-task', 'ready', { description: taskDescription })]),
      generatedAt: now,
    })

    expect(JSON.stringify(projection.orientationSpine)).not.toContain(taskDescription)
    expect(projection.orientationSpine?.roots[0]).toMatchObject({
      title: 'map-budget-task',
    })
    expect(projection.orientationSpine?.roots[0]?.summary).toBeUndefined()
    expect(projection.orientationSpine?.roots[0]?.proof).toBeUndefined()
    expect(projection.orientationSpine?.roots[0]?.source).toBeUndefined()
    expect(projection.orientationSpine?.roots[0]?.parentId).toBeUndefined()
    expect(projection.orientationSpine?.roots[0]?.progress).toEqual({ total: 1 })
    expect(projection.orientationSpine?.roots[0]?.progress?.blocked).toBeUndefined()
  })

  it('keeps setup pending distinct from an empty terminal work scope', () => {
    const projection = buildProjectSummaryProjection({
      projectId: 'new-project',
      queue: queue([
        task('task-workspace-import', 'exploring', {
          title: 'Review existing project work',
        }),
      ]),
      generatedAt: now,
    })

    expect(projection.releaseSummary).toMatchObject({
      scopeMode: 'unreleased',
      state: 'unknown',
      counts: { total: 0 },
    })
    expect(projection.nextAction).toMatchObject({
      code: 'workspace_import_pending',
      label: 'Configure',
      focusTaskId: 'task-workspace-import',
      focusKind: 'setup',
    })
  })

  it('keeps completed work counted while exposing missing proof as a release blocker', () => {
    const projection = buildProjectSummaryProjection({
      queue: queue([
        task('done-without-proof', 'done', {
          acceptanceCriteria: [{ id: 'ac-1', description: 'A proof exists.', met: false }],
        }),
      ]),
      generatedAt: now,
    })

    expect(projection.releaseSummary).toMatchObject({
      state: 'blocked',
      counts: { total: 1, done: 1, unfinished: 0, proofBlocked: 1 },
      blockers: [expect.objectContaining({ id: 'done-without-proof' })],
    })
    expect(projection.nextAction).toMatchObject({ code: 'proof_evidence_missing' })
  })

  it('does not rebuild an authoritative summary from an empty queue when detail is missing', async () => {
    temp = await mkdtemp(join(tmpdir(), 'guildhall-summary-fail-closed-'))
    const projectRoot = join(temp, 'project')
    const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
    await mkdir(dirname(tasksPath), { recursive: true })
    await writeFile(tasksPath, JSON.stringify(queue([task('rich-task', 'ready', { spec: 'Keep this detail.' })])), 'utf8')
    writeProjectTaskQueue(tasksPath, queue([task('rich-task', 'ready', { spec: 'Keep this detail.' })]), {
      projectId: 'project',
      projectRoot,
    })
    promoteProjectStateDatabaseAuthority(projectRoot)
    await rm(projectStateDatabaseCompressedDetailPathFromTasksPath(tasksPath), { force: true })
    const database = new DatabaseSync(projectStateDatabasePath(projectRoot))
    database.prepare('DELETE FROM queue_detail WHERE id = 1').run()
    database.prepare('DELETE FROM work_item_detail').run()
    database.close()
    await rm(tasksPath)

    const projection = backfillProjectSummaryProjection(tasksPath, { projectId: 'project' })

    expect(projection.freshness).toBe('error')
    expect(projection.error).toMatch(/authoritative project detail store is unavailable/)
    expect(readProjectStateDatabaseQueueDefinition(tasksPath)).toBeNull()
  })

  it('writes and reads a compact projection from the current-state database', async () => {
    temp = await mkdtemp(join(tmpdir(), 'guildhall-summary-projection-'))
    const tasksPath = getProjectSystemStatePath(temp, 'TASKS.json')
    const result = writeProjectSummaryProjectionFromUnknownQueue(tasksPath, {
      projectId: 'fair-labor-license',
      queue: queue([task('one', 'done')]),
      generatedAt: now,
    })

    await expect(readFile(projectSummaryProjectionPath(tasksPath), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(readProjectSummaryProjection(tasksPath)).toEqual(result)
  })

  it('does not resurrect a historical summary sidecar during a current read', async () => {
    temp = await mkdtemp(join(tmpdir(), 'guildhall-summary-read-boundary-'))
    const tasksPath = getProjectSystemStatePath(temp, 'TASKS.json')
    const summaryPath = projectSummaryProjectionPath(tasksPath)
    await mkdir(dirname(summaryPath), { recursive: true })
    await writeFile(summaryPath, JSON.stringify({ version: 12, freshness: 'current', projectId: 'historical-only' }), 'utf8')

    expect(readProjectSummaryProjection(tasksPath)).toBeNull()
    expect(readProjectSummaryProjectionForMigration(tasksPath)).toMatchObject({
      projectId: 'historical-only',
      freshness: 'stale',
    })
  })

  it('keeps promoted summary reads on SQLite when a legacy sidecar reappears', async () => {
    temp = await mkdtemp(join(tmpdir(), 'guildhall-summary-authority-'))
    const tasksPath = getProjectSystemStatePath(temp, 'TASKS.json')
    const queueValue = queue([task('canonical-task', 'ready')])
    writeProjectTaskQueue(tasksPath, queueValue, {
      projectId: 'canonical-project',
      projectRoot: temp,
    })
    promoteProjectStateDatabaseAuthority(temp)
    const refreshed = writeProjectSummaryProjectionFromIndexedState(tasksPath, {
      projectId: 'canonical-project',
      sourceQueueLastUpdated: now,
    })
    expect(refreshed).toMatchObject({ projectId: 'canonical-project', freshness: 'current' })

    await mkdir(dirname(projectSummaryProjectionPath(tasksPath)), { recursive: true })
    await writeFile(projectSummaryProjectionPath(tasksPath), JSON.stringify({
      version: 12,
      projectId: 'legacy-sidecar-project',
      freshness: 'current',
    }), 'utf8')

    expect(readProjectSummaryProjection(tasksPath)).toMatchObject({
      projectId: 'canonical-project',
      freshness: 'current',
      counts: { total: 1 },
    })
  })

  it('keeps promoted plan reads on the stored database snapshot', async () => {
    temp = await mkdtemp(join(tmpdir(), 'guildhall-summary-plan-authority-'))
    const tasksPath = getProjectSystemStatePath(temp, 'TASKS.json')
    await mkdir(dirname(tasksPath), { recursive: true })
    await writeFile(join(dirname(tasksPath), 'workspace-goals.json'), JSON.stringify({
      version: 3,
      recordedAt: now,
      goals: [{ id: 'goal-original', title: 'Original goal' }],
      tasks: [{ id: 'task-original', title: 'Original task', scope: 'current' }],
      milestones: [],
      approved: {
        taskCount: 1,
        currentTaskIds: ['task-original'],
        laterTaskIds: [],
      },
      releases: [],
    }), 'utf8')
    const queueValue = queue([task('task-original', 'ready')])
    writeProjectSummaryProjectionFromUnknownQueue(tasksPath, {
      projectId: 'plan-authority-project',
      queue: queueValue,
    })
    promoteProjectStateDatabaseAuthority(temp)

    await writeFile(join(dirname(tasksPath), 'workspace-goals.json'), JSON.stringify({
      version: 3,
      recordedAt: now,
      goals: [{ id: 'goal-stale', title: 'Stale goal' }],
      tasks: [{ id: 'task-phantom', title: 'Phantom task', scope: 'current' }],
      milestones: [],
      approved: {
        taskCount: 1,
        currentTaskIds: ['task-phantom'],
        laterTaskIds: [],
      },
      releases: [],
    }), 'utf8')

    const refreshed = writeProjectSummaryProjectionFromUnknownQueue(tasksPath, {
      projectId: 'plan-authority-project',
      queue: queueValue,
      queueCommit: false,
      expectedQueueRevision: readProjectStateDatabaseQueueRevision(tasksPath),
    })
    expect(refreshed.approvedPlan?.currentTaskIds).toEqual(['task-original'])
    expect(readProjectSummaryProjection(tasksPath)?.approvedPlan?.currentTaskIds).toEqual(['task-original'])
  })

  it('rebuilds a stale promoted summary from indexed rows without reading rich detail', async () => {
    temp = await mkdtemp(join(tmpdir(), 'guildhall-summary-indexed-refresh-'))
    const tasksPath = getProjectSystemStatePath(temp, 'TASKS.json')
    const queueValue = queue([
      task('indexed-ready', 'ready', { spec: 'Rich detail stays behind the point-read boundary.' }),
      task('indexed-done', 'done'),
    ])
    writeProjectTaskQueue(tasksPath, queueValue, {
      projectId: 'indexed-project',
      projectRoot: temp,
    })
    promoteProjectStateDatabaseAuthority(temp)
    writeProjectSummaryProjectionFromIndexedState(tasksPath, {
      projectId: 'indexed-project',
      sourceQueueLastUpdated: now,
    })

    // A compact refresh must not decompress or reconstruct every task detail.
    // Corrupting the rich rows makes accidental aggregate/detail reads fail
    // loudly while the indexed projection remains usable.
    const database = new DatabaseSync(projectStateDatabasePath(temp))
    database.prepare('UPDATE work_item_detail SET payload_gzip = ?').run(Buffer.from('not gzip'))
    database.close()
    markProjectSummaryStale(temp)
    expect(readProjectSummaryProjection(tasksPath)).toMatchObject({ freshness: 'stale' })

    const refreshed = writeProjectSummaryProjectionFromIndexedState(tasksPath, {
      projectId: 'indexed-project',
      sourceQueueLastUpdated: now,
    })

    expect(refreshed).toMatchObject({
      projectId: 'indexed-project',
      freshness: 'current',
      counts: { total: 2, ready: 0, done: 1 },
      nextAction: { focusTaskId: 'indexed-ready' },
    })
    expect(readProjectSummaryProjection(tasksPath)).toMatchObject({ freshness: 'current' })
  })

  it('materializes evidence-derived status beside scope rows without rewriting task detail', async () => {
    temp = await mkdtemp(join(tmpdir(), 'guildhall-summary-evidence-status-'))
    const tasksPath = getProjectSystemStatePath(temp, 'TASKS.json')
    const queueValue = queue([task('evidence-done', 'ready')])
    writeProjectTaskQueue(tasksPath, queueValue, {
      projectId: 'evidence-status-project',
      projectRoot: temp,
    })
    promoteProjectStateDatabaseAuthority(temp)
    writeProjectSummaryProjectionFromIndexedState(tasksPath, {
      projectId: 'evidence-status-project',
      sourceQueueLastUpdated: now,
    })

    const revision = readProjectStateDatabaseQueueRevision(tasksPath)
    expect(revision).not.toBeNull()
    const projected = writeProjectSummaryProjectionFromUnknownQueue(tasksPath, {
      projectId: 'evidence-status-project',
      queue: queueValue,
      projectionTasks: [task('evidence-done', 'done', { completedAt: now })],
      queueCommit: false,
      expectedQueueRevision: revision,
    })

    expect(projected.counts.done).toBe(1)
    expect(readProjectStateDatabaseQueue(tasksPath)?.tasks).toEqual([
      expect.objectContaining({ id: 'evidence-done', status: 'done', completedAt: now }),
    ])
    const database = new DatabaseSync(projectStateDatabasePath(temp), { readOnly: true })
    const detail = database.prepare('SELECT payload_gzip FROM work_item_detail WHERE task_id = ?').get('evidence-done') as { payload_gzip: Buffer }
    expect(detail.payload_gzip.byteLength).toBeGreaterThan(0)
    database.close()
  })

  it('captures each physical orientation source once during an explicit refresh', async () => {
    temp = await mkdtemp(join(tmpdir(), 'guildhall-summary-orientation-'))
    const tasksPath = getProjectSystemStatePath(temp, 'TASKS.json')
    await writeFile(join(temp, 'README.md'), 'A test project is a durable planning system for maintainers.\n', 'utf8')

    const result = writeProjectSummaryProjectionFromUnknownQueue(tasksPath, {
      projectId: 'orientation-test',
      projectRoot: temp,
      queue: queue([task('one', 'ready')]),
      generatedAt: now,
    })

    expect(result.orientation).toMatchObject({
      charter: { goal: 'A test project is a durable planning system for maintainers.', source: 'inferred' },
      sourceRefs: ['README.md'],
    })
  })

  it('projects the approved plan without importing its full task records', async () => {
    temp = await mkdtemp(join(tmpdir(), 'guildhall-approved-plan-'))
    const tasksPath = getProjectSystemStatePath(temp, 'TASKS.json')
    await mkdir(dirname(tasksPath), { recursive: true })
    await writeFile(
      join(dirname(tasksPath), 'workspace-goals.json'),
      JSON.stringify({
        version: 3,
        recordedAt: now,
        goals: [{ id: 'goal-1', title: 'Ship the first slice' }],
        releases: [{ id: 'release-1', label: 'First release', source: 'owner_approved', state: 'active' }],
        tasks: [
          { id: 'planned-1', title: 'Current work', scope: 'current', releaseIds: ['release-1'] },
          { id: 'planned-2', title: 'Later work', scope: 'later', releaseIds: ['release-1'] },
        ],
        milestones: [{ title: 'First proof', evidence: 'A command passes.' }],
        approved: {
          goalCount: 1,
          taskCount: 2,
          milestoneCount: 1,
          currentTaskCount: 1,
          laterTaskCount: 1,
          taskIds: ['planned-1', 'planned-2'],
          currentTaskIds: ['planned-1'],
          laterTaskIds: ['planned-2'],
        },
        detected: null,
      }, null, 2),
      'utf8',
    )
    const result = writeProjectSummaryProjectionFromUnknownQueue(tasksPath, {
      projectId: 'narrative-harness',
      queue: queue([task('one', 'ready')]),
      generatedAt: now,
    })

    expect(result.counts.total).toBe(1)
    expect(result.approvedPlan).toMatchObject({
      source: 'workspace_import',
      goalCount: 1,
      taskCount: 2,
      currentTaskCount: 1,
      laterTaskCount: 1,
      currentReleaseId: 'release-1',
      releases: [{ id: 'release-1', label: 'First release', currentTaskIds: ['planned-1'], laterTaskIds: ['planned-2'] }],
    })
  })

  it('marks the projection stale when approved planning changes out of band', async () => {
    temp = await mkdtemp(join(tmpdir(), 'guildhall-approved-plan-stale-'))
    const tasksPath = getProjectSystemStatePath(temp, 'TASKS.json')
    const goalsPath = join(dirname(tasksPath), 'workspace-goals.json')
    await mkdir(dirname(tasksPath), { recursive: true })
    await writeFile(goalsPath, JSON.stringify({ version: 3, recordedAt: now, goals: [], tasks: [], milestones: [], approved: { goalCount: 0, taskCount: 0, milestoneCount: 0, currentTaskCount: 0, laterTaskCount: 0, taskIds: [], currentTaskIds: [], laterTaskIds: [] }, detected: null }), 'utf8')
    writeProjectSummaryProjectionFromUnknownQueue(tasksPath, {
      projectId: 'narrative-harness',
      queue: queue([task('one', 'ready')]),
      generatedAt: now,
    })
    await utimes(goalsPath, new Date(Date.now() + 5000), new Date(Date.now() + 5000))

    expect(readProjectSummaryProjection(tasksPath)).toMatchObject({ freshness: 'stale' })
  })

  it('updates the projection at the task write boundary', async () => {
    temp = await mkdtemp(join(tmpdir(), 'guildhall-summary-boundary-'))
    const tasksPath = join(temp, 'TASKS.json')
    const taskQueue = queue([task('one', 'done')])

    writeProjectTaskQueue(tasksPath, taskQueue)

    expect(readProjectSummaryProjection(tasksPath)).toMatchObject({
      freshness: 'current',
      counts: { total: 1, done: 1 },
    })
  })

  it('projects current overlay facts without copying them into task definitions', async () => {
    temp = await mkdtemp(join(tmpdir(), 'guildhall-summary-overlay-'))
    const tasksPath = getProjectSystemStatePath(temp, 'TASKS.json')
    const rawQueue = queue([task('one', 'ready')])
    const currentTask = task('one', 'done', { assignedTo: null })

    const projection = writeProjectSummaryProjectionFromUnknownQueue(tasksPath, {
      projectId: 'overlay-project',
      queue: rawQueue,
      projectionTasks: [currentTask] as typeof rawQueue.tasks,
      generatedAt: now,
    })

    expect(projection.counts).toMatchObject({ total: 1, done: 1, active: 0 })
    const detail = readProjectStateDatabaseQueueDefinition(tasksPath)
    expect(detail?.tasks[0]).toMatchObject({ id: 'one', status: 'ready' })
  })

  it('marks the compact projection stale when runtime or evidence state changes', async () => {
    temp = await mkdtemp(join(tmpdir(), 'guildhall-summary-stale-'))
    const tasksPath = getProjectSystemStatePath(temp, 'TASKS.json')
    writeProjectSummaryProjectionFromUnknownQueue(tasksPath, {
      projectId: 'narrative-harness',
      queue: queue([task('one', 'ready')]),
      generatedAt: now,
    })

    markProjectSummaryStale(temp)

    expect(readProjectSummaryProjection(tasksPath)).toMatchObject({ freshness: 'stale' })
  })

  it('persists compact execution and runtime state without replacing task facts', async () => {
    temp = await mkdtemp(join(tmpdir(), 'guildhall-summary-supplemental-'))
    const tasksPath = getProjectSystemStatePath(temp, 'TASKS.json')
    writeProjectSummaryProjectionFromUnknownQueue(tasksPath, {
      projectId: 'narrative-harness',
      queue: queue([task('one', 'ready')]),
      generatedAt: now,
    })

    const updated = updateProjectSummaryProjection(tasksPath, {
      execution: {
        status: 'running',
        mode: 'continuous',
        startedAt: now,
        updatedAt: now,
      },
      runtime: {
        status: 'running',
        health: 'healthy',
        updatedAt: now,
      },
    })

    expect(updated).toMatchObject({
      freshness: 'current',
      counts: { total: 1, active: 1 },
      execution: { status: 'running', mode: 'continuous' },
      runtime: { status: 'running', health: 'healthy' },
    })
  })

  it('preserves compact execution and runtime state when the task queue is rebuilt', async () => {
    temp = await mkdtemp(join(tmpdir(), 'guildhall-summary-preserve-'))
    const tasksPath = getProjectSystemStatePath(temp, 'TASKS.json')
    writeProjectSummaryProjectionFromUnknownQueue(tasksPath, {
      projectId: 'narrative-harness',
      queue: queue([task('one', 'ready')]),
      generatedAt: now,
    })
    updateProjectSummaryProjection(tasksPath, {
      execution: { status: 'stopped', updatedAt: now },
      runtime: { status: 'stopped', updatedAt: now },
    })

    writeProjectTaskQueue(tasksPath, queue([task('one', 'done')]))

    expect(readProjectSummaryProjection(tasksPath)).toMatchObject({
      counts: { done: 1 },
      execution: { status: 'stopped' },
      runtime: { status: 'stopped' },
    })
  })

  it('records an explicit error instead of manufacturing a partial summary', async () => {
    temp = await mkdtemp(join(tmpdir(), 'guildhall-summary-error-'))
    const projection = writeProjectSummaryProjectionFromUnknownQueue(join(temp, 'TASKS.json'), {
      projectId: 'broken-project',
      queue: { tasks: [{ id: 'missing-required-fields' }] },
      generatedAt: now,
    })

    expect(projection).toMatchObject({
      freshness: 'error',
      projectId: 'broken-project',
      nextAction: { code: 'summary_unavailable' },
    })
    expect(projection.error).toBeTruthy()
  })
})
