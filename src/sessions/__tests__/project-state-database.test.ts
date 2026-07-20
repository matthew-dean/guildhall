import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { gzipSync } from 'node:zlib'
import { TaskQueue } from '@guildhall/core'

import { getProjectSystemStatePath } from '../local-history.js'
import { readProjectCacheAllocationManifest } from '../project-cache-registry.js'
import {
  compressProjectStateDetailStore,
  markProjectStateDatabaseStale,
  migrateLegacyProjectLiveState,
  readProjectStateDatabaseAttentionRecords,
  readProjectStateDatabaseProjectionWatermark,
  readProjectStateDatabaseAvailability,
  readProjectStateDatabaseMetadata,
  readProjectStateDatabaseReconciliations,
  projectStateDatabasePath,
  projectStateDatabaseCompressedDetailPathFromTasksPath,
  projectStateDatabaseDetailPathFromTasksPath,
  readProjectStateDatabaseInventory,
  readProjectStateDatabaseProjectionState,
  listProjectStateDatabaseProjectionJobs,
  readProjectStateDatabaseQueue,
  readProjectStateDatabaseQueueRevision,
  readProjectStateDatabaseQueueDefinition,
  readProjectStateDatabaseReadBundle,
  readProjectStateDatabaseSurfaceState,
  readProjectStateDatabaseRevisionFromTasksPath,
  readProjectStateDatabaseQueueWithRevision,
  readProjectStateDatabaseSummary,
  readProjectStateDatabaseShellState,
  readProjectStateDatabaseCurrentThread,
  readProjectStateDatabaseThreadHistoryPage,
  readProjectStateDatabaseThreadSurfaceState,
  readProjectStateDatabaseTask,
  readProjectStateDatabaseTaskDetailState,
  readProjectStateDatabaseTaskPoint,
  readProjectStateDatabaseTaskPointsWithRevision,
  readProjectStateDatabaseCurrentTasksWithRevision,
  readProjectStateDatabaseTaskRelationships,
  readProjectStateDatabaseTasks,
  readProjectStateDatabaseTaskOverlay,
  readProjectStateDatabaseTaskEvidenceCurrent,
  readProjectStateDatabaseTaskEvidenceCurrentMany,
  readProjectStateDatabaseTaskEvidenceHistory,
  readProjectStateDatabaseRepositories,
  readProjectStateDatabaseRepositoriesFromTasksPath,
  readProjectStateDatabaseRepository,
  readProjectTaskQueueSync,
  promoteProjectStateDatabaseAuthority,
  compactProjectStateDatabaseEvidence,
  vacuumProjectStateDatabase,
  writeProjectStateDatabaseSnapshot,
  writeProjectStateDatabaseMemoryHealth,
  writeProjectStateDatabaseReleaseSelectionMutation,
  writeProjectStateDatabaseTaskBatchMutation,
  writeProjectStateDatabaseTaskMutation,
  writeProjectStateDatabaseCurrentThread,
  updateProjectStateDatabaseSummary,
  writeProjectStateDatabaseSummarySnapshot,
  upsertProjectStateDatabaseExecution,
  upsertProjectStateDatabaseRuntime,
  upsertProjectStateDatabaseTaskProof,
  appendProjectStateDatabaseTaskEvidence,
  upsertProjectStateDatabaseTaskRuntime,
  upsertProjectStateDatabaseTaskRuntimes,
  replaceProjectStateDatabaseTaskRuntimes,
  replaceProjectStateDatabaseTaskWorkspaces,
  upsertProjectStateDatabaseReconciliations,
  replaceProjectStateDatabaseOwnerInputs,
  replaceProjectStateDatabaseAttentionRecords,
  writeProjectStateDatabaseAvailability,
  upsertProjectStateDatabaseRepository,
  replaceProjectStateDatabaseRepositories,
  registerProjectHistoricalArtifact,
  readProjectHistoricalArtifact,
  readProjectHistoricalArtifacts,
  readProjectHistoricalRetentionSummary,
  markProjectHistoricalArtifactReplaced,
  PROJECT_STATE_DATABASE_SCHEMA_VERSION,
} from '../project-state-database.js'
import { subscribeProjectSummaryInvalidations } from '../project-summary-invalidation.js'

let tmp: string
let projectRoot: string
let tasksPath: string

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-project-state-db-'))
  process.env.GUILDHALL_DATA_DIR = path.join(tmp, 'data')
  projectRoot = path.join(tmp, 'project')
  tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
  await fs.mkdir(path.dirname(tasksPath), { recursive: true })
  await fs.writeFile(tasksPath, JSON.stringify({ lastUpdated: '2026-07-14T00:00:00.000Z' }), 'utf8')
})

afterEach(async () => {
  delete process.env.GUILDHALL_DATA_DIR
  await fs.rm(tmp, { recursive: true, force: true })
})

describe('project-state database', () => {
  it('rejects adding work to a shipped release before replacing current state', () => {
    const release = {
      id: 'release-1',
      label: 'Release 1',
      kind: 'release',
      state: 'shipped',
      source: 'user',
      proofStyle: 'script',
      nodeIds: ['work:task-done'],
      deferredNodeIds: [],
    }
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: {
        selectedReleaseId: release.id,
        releases: [release],
        tasks: [{ id: 'task-done', title: 'Done', status: 'done', releaseIds: [release.id] }],
      },
      summary: { generatedAt: '2026-07-14T00:00:00.000Z', freshness: 'current' },
      projectRoot,
    })

    expect(() => writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: {
        selectedReleaseId: release.id,
        releases: [release],
        tasks: [
          { id: 'task-done', title: 'Done', status: 'done', releaseIds: [release.id] },
          { id: 'task-late', title: 'Late work', status: 'ready', releaseIds: [release.id] },
        ],
      },
      summary: { generatedAt: '2026-07-14T00:01:00.000Z', freshness: 'current' },
      projectRoot,
    })).toThrow('Cannot change membership of shipped release release-1')

    expect(readProjectStateDatabaseTask(tasksPath, 'task-done')).toMatchObject({ id: 'task-done', status: 'done' })
    expect(readProjectStateDatabaseTask(tasksPath, 'task-late')).toBeNull()
  })

  it('stores historical artifact metadata without storing payload bodies', () => {
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: { tasks: [] },
      summary: { generatedAt: '2026-07-14T00:00:00.000Z', freshness: 'current' },
      projectRoot,
    })

    const artifact = registerProjectHistoricalArtifact(projectRoot, {
      artifactId: 'transcript:task-1',
      kind: 'essential_history',
      owner: 'exploring-transcript',
      logicalRef: 'transcripts/exploring/task-1.md',
      createdAt: '2026-07-14T00:01:00.000Z',
      lastVerifiedAt: '2026-07-14T00:02:00.000Z',
      bytes: 1200,
      sha256: 'a'.repeat(64),
      retentionClass: 'essential',
      sourceRevision: 'project:3',
    })
    expect(artifact).toMatchObject({
      artifactId: 'transcript:task-1',
      bytes: 1200,
      state: 'active',
    })

    registerProjectHistoricalArtifact(projectRoot, {
      ...artifact,
      bytes: 1400,
      lastVerifiedAt: '2026-07-14T00:03:00.000Z',
    })
    expect(readProjectHistoricalArtifacts(projectRoot)).toHaveLength(1)
    expect(readProjectHistoricalArtifact(projectRoot, 'transcript:task-1')).toMatchObject({ bytes: 1400 })
    expect(readProjectHistoricalRetentionSummary(projectRoot)).toMatchObject({
      totalArtifacts: 1,
      totalBytes: 1400,
      unclassifiedArtifacts: 0,
      byKind: { essential_history: { artifacts: 1, bytes: 1400 } },
      byRetentionClass: { essential: { artifacts: 1, bytes: 1400 } },
    })
    expect(markProjectHistoricalArtifactReplaced(
      projectRoot,
      'transcript:task-1',
      'memory/essential-history/task-1.md',
      '2026-07-14T00:04:00.000Z',
    )).toBe(true)
    expect(readProjectHistoricalArtifact(projectRoot, 'transcript:task-1')).toMatchObject({
      state: 'replaced',
      replacementRef: 'memory/essential-history/task-1.md',
    })

    const database = new DatabaseSync(projectStateDatabasePath(projectRoot), { readOnly: true })
    const columns = database.prepare('PRAGMA table_info(historical_artifacts)').all() as Array<{ name?: string }>
    database.close()
    expect(columns.map(column => column.name)).not.toContain('payload_json')
  })

  it('stores and reads one bounded current Thread row through its explicit writer', () => {
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: { tasks: [{ id: 'task-1', title: 'One', status: 'ready' }] },
      summary: { generatedAt: '2026-07-14T00:00:00.000Z', freshness: 'current' },
      projectRoot,
    })
    // Temp-root fixtures are intentionally ephemeral and must not acquire
    // durable project-cache ownership as a side effect of SQLite allocation.
    expect(readProjectCacheAllocationManifest(projectRoot)).toBeNull()
    const beforeThreadWrite = new DatabaseSync(projectStateDatabasePath(projectRoot), { readOnly: true })
    expect(beforeThreadWrite.prepare('SELECT COUNT(*) AS count FROM current_thread').get()).toMatchObject({ count: 0 })
    beforeThreadWrite.close()

    const sourceRevision = readProjectStateDatabaseRevisionFromTasksPath(tasksPath)!
    const sourceQueueRevision = readProjectStateDatabaseQueueRevision(tasksPath)!
    const payload = {
      turns: [{ id: 'active-turn', status: 'active' }],
      activeTurnId: 'active-turn',
      caughtUp: false,
      generatedAt: '2026-07-15T00:00:00.000Z',
      sourceRevision,
    }
    writeProjectStateDatabaseCurrentThread(projectRoot, {
      payload,
      generatedAt: payload.generatedAt,
      sourceRevision: payload.sourceRevision,
      sourceQueueRevision,
    })

    expect(readProjectStateDatabaseCurrentThread(projectRoot)).toEqual({
      payload,
      generatedAt: payload.generatedAt,
      sourceRevision: String(sourceRevision),
      sourceQueueRevision,
    })
    expect(readProjectStateDatabaseThreadSurfaceState(projectRoot)).toMatchObject({
      thread: {
        payload,
        sourceQueueRevision,
      },
      queueRevision: expect.any(Number),
      projectRevision: expect.any(Number),
    })
    const database = new DatabaseSync(projectStateDatabasePath(projectRoot), { readOnly: true })
    expect(database.prepare('SELECT COUNT(*) AS count FROM current_thread').get()).toMatchObject({ count: 1 })
    database.close()
  })

  it('rejects a current Thread write from an older project or queue revision', () => {
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: { tasks: [{ id: 'task-1', title: 'One', status: 'ready' }] },
      summary: { generatedAt: '2026-07-14T00:00:00.000Z', freshness: 'current' },
    })
    const sourceRevision = readProjectStateDatabaseRevisionFromTasksPath(tasksPath)!
    const sourceQueueRevision = readProjectStateDatabaseQueueRevision(tasksPath)!
    writeProjectStateDatabaseCurrentThread(projectRoot, {
      payload: { turns: [] },
      generatedAt: '2026-07-15T00:00:00.000Z',
      sourceRevision,
      sourceQueueRevision,
    })

    upsertProjectStateDatabaseRuntime(projectRoot, {
      status: 'running',
      updatedAt: '2026-07-15T00:01:00.000Z',
    })

    expect(() => writeProjectStateDatabaseCurrentThread(projectRoot, {
      payload: { turns: [{ id: 'stale' }] },
      generatedAt: '2026-07-15T00:02:00.000Z',
      sourceRevision,
      sourceQueueRevision,
    })).toThrow(/Stale current Thread write/)
    expect(readProjectStateDatabaseCurrentThread(projectRoot)?.payload).toEqual({ turns: [] })
  })

  it('stores bounded Thread history and serves indexed pages without rebuilding Thread', () => {
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: { tasks: [{ id: 'task-1', title: 'One', status: 'ready' }] },
      summary: { generatedAt: '2026-07-14T00:00:00.000Z', freshness: 'current' },
      projectRoot,
    })
    const sourceRevision = readProjectStateDatabaseRevisionFromTasksPath(tasksPath)!
    const sourceQueueRevision = readProjectStateDatabaseQueueRevision(tasksPath)!
    const turns = Array.from({ length: 2_005 }, (_, index) => ({
      id: `turn-${index}`,
      at: `2026-07-15T00:${String(Math.floor(index / 60) % 60).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}.000Z`,
      status: 'done',
      summary: `Turn ${index}`,
    }))
    writeProjectStateDatabaseCurrentThread(projectRoot, {
      payload: { turns: [] },
      generatedAt: '2026-07-15T01:00:00.000Z',
      sourceRevision,
      sourceQueueRevision,
      history: {
        turns,
        generatedAt: '2026-07-15T01:00:00.000Z',
        sourceRevision,
        sourceQueueRevision,
        truncated: false,
      },
    })

    const page = readProjectStateDatabaseThreadHistoryPage(projectRoot, { offset: 1_998, limit: 10 })
    expect(page).toMatchObject({
      offset: 1_998,
      limit: 10,
      total: 2_000,
      hasMore: false,
      truncated: true,
      sourceRevision: String(sourceRevision),
      sourceQueueRevision,
    })
    expect(page?.turns.map((turn: any) => turn.id)).toEqual(['turn-2003', 'turn-2004'])
    const boundedPage = readProjectStateDatabaseThreadHistoryPage(projectRoot, { offset: 0, limit: 10_000 })
    expect(boundedPage?.limit).toBe(100)
    expect(boundedPage?.turns).toHaveLength(100)
    const database = new DatabaseSync(projectStateDatabasePath(projectRoot), { readOnly: true })
    expect(database.prepare('SELECT COUNT(*) AS count FROM thread_history').get()).toMatchObject({ count: 2_000 })
    database.close()
  })

  it('rejects historical Thread writes from an older project revision', () => {
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: { tasks: [{ id: 'task-1', title: 'One', status: 'ready' }] },
      summary: { generatedAt: '2026-07-14T00:00:00.000Z', freshness: 'current' },
      projectRoot,
    })
    const sourceRevision = readProjectStateDatabaseRevisionFromTasksPath(tasksPath)!
    const sourceQueueRevision = readProjectStateDatabaseQueueRevision(tasksPath)!
    upsertProjectStateDatabaseRuntime(projectRoot, { status: 'running', updatedAt: '2026-07-15T00:01:00.000Z' })
    expect(() => writeProjectStateDatabaseCurrentThread(projectRoot, {
      payload: { turns: [{ id: 'stale' }] },
      generatedAt: '2026-07-15T01:00:00.000Z',
      sourceRevision,
      sourceQueueRevision,
      history: {
        turns: [{ id: 'stale', status: 'done' }],
        generatedAt: '2026-07-15T01:00:00.000Z',
        sourceRevision,
        sourceQueueRevision,
        truncated: false,
      },
    })).toThrow(/Stale current Thread write/)
  })

  it('advances one source revision and enqueues obligations for a summary patch', () => {
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: { tasks: [{ id: 'task-1', title: 'One', status: 'ready' }] },
      summary: { generatedAt: '2026-07-14T00:00:00.000Z', freshness: 'current' },
    })
    const before = readProjectStateDatabaseMetadata(projectRoot)!.revision

    updateProjectStateDatabaseSummary(tasksPath, summary => ({ ...summary, patched: true }))

    const after = readProjectStateDatabaseMetadata(projectRoot)!.revision
    expect(after).toBe(before + 1)
    expect(listProjectStateDatabaseProjectionJobs(projectRoot)).toEqual(expect.arrayContaining([
      expect.objectContaining({ domain: 'attention', sourceRevision: after, status: 'pending' }),
      expect.objectContaining({ domain: 'diagnostics', sourceRevision: after, status: 'pending' }),
    ]))
  })

  it('does not let a compact summary patch overwrite dedicated current state', () => {
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: { tasks: [{ id: 'task-1', title: 'One', status: 'ready' }] },
      summary: { generatedAt: '2026-07-14T00:00:00.000Z', freshness: 'current' },
    })
    upsertProjectStateDatabaseExecution(projectRoot, {
      status: 'running',
      mode: 'continuous',
      updatedAt: '2026-07-14T00:01:00.000Z',
    })
    upsertProjectStateDatabaseRuntime(projectRoot, {
      status: 'healthy',
      health: 'ready',
      updatedAt: '2026-07-14T00:01:00.000Z',
    })

    updateProjectStateDatabaseSummary(tasksPath, summary => ({
      ...summary,
      execution: { status: 'stopped', updatedAt: '1999-01-01T00:00:00.000Z' },
      runtime: { status: 'unknown', updatedAt: '1999-01-01T00:00:00.000Z' },
    }))

    expect(readProjectStateDatabaseSummary(tasksPath)?.payload).toMatchObject({
      execution: { status: 'running', mode: 'continuous' },
      runtime: { status: 'healthy', health: 'ready' },
    })
  })

  it('reclaims pages only through the explicit maintenance boundary', async () => {
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: { tasks: [{ id: 'task-1', title: 'One', status: 'ready' }] },
      summary: { generatedAt: '2026-07-14T00:00:00.000Z', freshness: 'current' },
    })

    const databasePath = projectStateDatabasePath(projectRoot)
    const database = new DatabaseSync(databasePath)
    const insert = database.prepare('INSERT INTO task_workspace (task_id, updated_at, payload_json) VALUES (?, ?, ?)')
    for (let index = 0; index < 40; index += 1) {
      insert.run(`temporary-${index}`, '2026-07-14T00:00:00.000Z', JSON.stringify({ detail: 'x'.repeat(20_000) }))
    }
    database.prepare('DELETE FROM task_workspace WHERE task_id LIKE ?').run('temporary-%')
    database.close()

    const before = (await fs.stat(databasePath)).size
    expect(vacuumProjectStateDatabase(projectRoot, { dryRun: true })).toMatchObject({
      bytesBefore: before,
      bytesAfter: before,
      vacuumed: false,
    })
    const result = vacuumProjectStateDatabase(projectRoot)
    expect(result).toMatchObject({ vacuumed: true, bytesBefore: before })
    expect(result.bytesAfter).toBeLessThan(before)
  })

  it('discovers the schema 10 authority marker before the writable rename to schema 11', () => {
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: { tasks: [{ id: 'task-legacy-authority', title: 'Legacy authority', status: 'ready' }] },
      summary: { generatedAt: '2026-07-14T00:00:00.000Z', freshness: 'current' },
    })

    const database = new DatabaseSync(projectStateDatabasePath(projectRoot))
    database.exec("ALTER TABLE project_meta RENAME COLUMN project_state_authority TO task_overlay_authority; UPDATE project_meta SET schema_version = 10, task_overlay_authority = 'database';")
    database.close()

    expect(readProjectStateDatabaseMetadata(projectRoot)).toMatchObject({
      schemaVersion: 10,
      projectStateAuthority: 'database',
    })
  })

  it('stores normalized work rows and one compact summary atomically', () => {
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: {
        lastUpdated: '2026-07-14T00:00:00.000Z',
        releases: [{ id: 'release-1', label: 'Release 1', nodeIds: ['work:task-1'], deferredNodeIds: [] }],
        tasks: [{
          id: 'task-1',
          title: 'Full title survives the summary boundary',
          description: 'Task description',
          status: 'ready',
          domain: 'runtime',
          priority: 'normal',
          workKind: 'implementation',
          hierarchy: { childIds: [] },
          dependsOn: ['task-0'],
          releaseIds: ['release-1'],
          sourceRefs: ['docs/plan.md'],
          updatedAt: '2026-07-14T00:00:00.000Z',
        }],
      },
      summary: {
        version: 3,
        projectId: 'project',
        generatedAt: '2026-07-14T00:00:00.000Z',
        freshness: 'current',
        counts: { total: 1 },
      },
    })

    expect(projectStateDatabasePath(projectRoot)).toContain('project-state.db')
    expect(readProjectStateDatabaseSummary(tasksPath)).toMatchObject({
      freshness: 'current',
      payload: { projectId: 'project', counts: { total: 1 } },
    })
    expect(readProjectStateDatabaseTask(tasksPath, 'task-1')).toMatchObject({
      id: 'task-1',
      title: 'Full title survives the summary boundary',
      parentId: null,
      dependsOn: ['task-0'],
      releaseIds: ['release-1'],
      sourceRefs: ['docs/plan.md'],
    })
    expect(readProjectStateDatabaseQueueDefinition(tasksPath)).toMatchObject({
      version: 1,
      lastUpdated: '2026-07-14T00:00:00.000Z',
      tasks: [{ id: 'task-1', title: 'Full title survives the summary boundary' }],
      releases: [{ id: 'release-1', label: 'Release 1' }],
    })
    expect(readProjectStateDatabaseQueueDefinition(tasksPath)).not.toHaveProperty('selectedReleaseId')
  })

  it('reads a fleet-sized shell without opening the task inventory', () => {
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: {
        tasks: Array.from({ length: 8 }, (_, index) => ({
          id: `task-${index + 1}`,
          title: `Task ${index + 1}`,
          status: index === 0 ? 'in_progress' : 'ready',
        })),
      },
      summary: {
        projectId: 'project',
        generatedAt: '2026-07-14T00:00:00.000Z',
        freshness: 'current',
        counts: { total: 8, active: 1 },
      },
    })

    const shell = readProjectStateDatabaseShellState(tasksPath, {
      includeOrientation: false,
      includeApprovedPlan: false,
    })
    expect(shell).toMatchObject({
      authority: 'database',
      queueRevision: expect.any(Number),
      projectRevision: expect.any(Number),
      summary: {
        freshness: 'current',
        payload: { projectId: 'project', counts: { total: 8, active: 1 } },
      },
    })
  })

  it('stores memory health as a bounded revisioned projection', () => {
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: { tasks: [{ id: 'task-1', title: 'One', status: 'ready' }] },
      summary: { generatedAt: '2026-07-14T00:00:00.000Z', freshness: 'current' },
    })
    const revision = readProjectStateDatabaseMetadata(projectRoot)!.revision

    expect(writeProjectStateDatabaseMemoryHealth(projectRoot, {
      sourceRevision: revision,
      freshness: 'current',
      generatedAt: '2026-07-14T00:01:00.000Z',
      payload: {
        total: 2,
        active: 1,
        recentUse: [],
      },
    })).toBe(true)

    expect(readProjectStateDatabaseReadBundle(tasksPath, { includeMemoryHealth: true })?.memoryHealth).toMatchObject({
      sourceRevision: revision,
      freshness: 'current',
      payload: { total: 2, active: 1 },
    })

    markProjectStateDatabaseStale(projectRoot)
    expect(readProjectStateDatabaseReadBundle(tasksPath, { includeMemoryHealth: true })?.memoryHealth).toMatchObject({
      sourceRevision: revision,
      freshness: 'stale',
    })
  })

  it('uses one snapshot for rich and compact views while promotion metadata is incomplete', () => {
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: {
        selectedReleaseId: 'release-current',
        releases: [{
          id: 'release-current',
          label: 'Current release',
          kind: 'release',
          state: 'active',
          nodeIds: ['work:task-current'],
          deferredNodeIds: [],
        }],
        tasks: [{ id: 'task-current', title: 'Current task', status: 'ready' }],
      },
      summary: {
        generatedAt: '2026-07-14T00:00:00.000Z',
        freshness: 'current',
      },
    })

    const bundle = readProjectStateDatabaseReadBundle(tasksPath, {
      includeQueueDefinition: true,
      includeProjection: true,
      includeRepositories: true,
      includeDiagnostics: true,
      includeTaskOverlays: true,
    })

    expect(bundle).toMatchObject({
      authority: 'database',
      queueRevision: expect.any(Number),
      projectRevision: expect.any(Number),
      queueDefinition: {
        selectedReleaseId: 'release-current',
        tasks: [{ id: 'task-current' }],
      },
      projection: {
        queue: { selectedReleaseId: 'release-current', tasks: [] },
        inventory: { total: 1, tasks: [{ id: 'task-current' }] },
      },
      summary: { freshness: 'current' },
    })
    expect(bundle?.projection?.queueRevision).toBe(bundle?.queueRevision)
    expect(bundle?.projection?.projectRevision).toBe(bundle?.projectRevision)
  })

  it('can read fleet attention state without expanding the task projection', () => {
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: {
        tasks: Array.from({ length: 200 }, (_, index) => ({
          id: `task-${index + 1}`,
          title: `Task ${index + 1}`,
          status: 'ready',
        })),
        releases: [],
      },
      summary: {
        generatedAt: '2026-07-14T00:00:00.000Z',
        freshness: 'current',
      },
    })

    const surface = readProjectStateDatabaseSurfaceState(tasksPath, {
      includeProjection: false,
      includeAttention: true,
    })

    expect(surface).toMatchObject({
      authority: 'database',
      projection: null,
      summary: { freshness: 'current' },
      attentionRecords: [],
    })
  })

  it('omits an unselected release at the database-to-domain boundary', () => {
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: { tasks: [] },
      summary: { generatedAt: '2026-07-14T00:00:00.000Z', freshness: 'current' },
    })

    const queue = readProjectStateDatabaseQueueWithRevision(tasksPath)?.definition
    expect(queue).not.toHaveProperty('selectedReleaseId')
    expect(TaskQueue.safeParse(queue).success).toBe(true)
  })

  it('does not borrow release identity or selection from the derived summary', () => {
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: {
        selectedReleaseId: 'release-durable',
        releases: [{
          id: 'release-durable',
          label: 'Durable release',
          kind: 'release',
          state: 'active',
          source: 'release_plan',
          nodeIds: [],
          deferredNodeIds: [],
        }],
        tasks: [{ id: 'task-1', title: 'Task', status: 'ready', releaseIds: ['release-durable'] }],
      },
      summary: {
        generatedAt: '2026-07-14T00:00:00.000Z',
        freshness: 'current',
        releaseSummary: {
          release: {
            id: 'release-synthetic',
            label: 'Synthetic summary release',
          },
        },
      },
    })

    expect(readProjectStateDatabaseQueue(tasksPath)).toMatchObject({
      selectedReleaseId: 'release-durable',
      releases: [{ id: 'release-durable', label: 'Durable release' }],
    })
    expect(readProjectStateDatabaseQueue(tasksPath)?.releases).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'release-synthetic' })]),
    )
  })

  it('refreshes derived summary rows without advancing or replacing the queue', () => {
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: {
        lastUpdated: '2026-07-14T00:00:00.000Z',
        tasks: [
          { id: 'task-1', title: 'Canonical definition', status: 'ready', spec: 'Keep this.' },
          { id: 'task-2', title: 'Untouched scope row', status: 'ready' },
        ],
      },
      summary: { generatedAt: '2026-07-14T00:00:00.000Z', freshness: 'current' },
      scopeRows: [
        {
          taskId: 'task-1',
          scope: 'included',
          eligibilityReason: 'selected',
          hierarchyRole: 'leaf',
          handoffState: 'ready',
          blocksStart: false,
          blocksRelease: false,
          humanBlocking: false,
          sourceRefs: [],
        },
        {
          taskId: 'task-2',
          scope: 'included',
          eligibilityReason: 'selected',
          hierarchyRole: 'leaf',
          handoffState: 'ready',
          blocksStart: false,
          blocksRelease: false,
          humanBlocking: false,
          sourceRefs: [],
        },
      ],
    })
    const before = readProjectStateDatabaseQueueWithRevision(tasksPath)
    expect(before).not.toBeNull()
    const databaseBefore = new DatabaseSync(projectStateDatabasePath(projectRoot), { readOnly: true })
    const taskTwoScopeBefore = databaseBefore.prepare('SELECT rowid FROM work_scope WHERE task_id = ?').get('task-2') as { rowid: number }
    databaseBefore.close()

    writeProjectStateDatabaseSummarySnapshot(tasksPath, {
      summary: {
        generatedAt: '2026-07-14T00:01:00.000Z',
        freshness: 'current',
        source: { taskQueueLastUpdated: '2026-07-14T00:00:00.000Z' },
        counts: { total: 1 },
      },
      scopeRows: [
        {
          taskId: 'task-1',
          scope: 'included',
          eligibilityReason: 'still selected',
          hierarchyRole: 'leaf',
          handoffState: 'active',
          blocksStart: false,
          blocksRelease: true,
          humanBlocking: false,
          sourceRefs: [],
        },
        {
          taskId: 'task-2',
          scope: 'included',
          eligibilityReason: 'selected',
          hierarchyRole: 'leaf',
          handoffState: 'ready',
          blocksStart: false,
          blocksRelease: false,
          humanBlocking: false,
          sourceRefs: [],
        },
      ],
      expectedQueueRevision: before!.revision,
    })

    const after = readProjectStateDatabaseQueueWithRevision(tasksPath)
    expect(after?.revision).toBe(before!.revision)
    expect(after?.definition.tasks.map(task => task.id)).toEqual(['task-1', 'task-2'])
    expect(after?.definition.tasks[0]).toMatchObject({ id: 'task-1', title: 'Canonical definition', spec: 'Keep this.' })
    expect(readProjectStateDatabaseSummary(tasksPath)?.freshness).toBe('current')
    const databaseAfter = new DatabaseSync(projectStateDatabasePath(projectRoot), { readOnly: true })
    expect(databaseAfter.prepare('SELECT rowid FROM work_scope WHERE task_id = ?').get('task-2')).toMatchObject(taskTwoScopeBefore)
    expect(databaseAfter.prepare('SELECT rowid FROM work_scope WHERE task_id = ?').get('task-1')).toMatchObject({ rowid: expect.any(Number) })
    databaseAfter.close()
  })

  it('rejects a stale whole-queue replacement before deleting current rows', () => {
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: { tasks: [{ id: 'task-1', title: 'Original', status: 'ready' }] },
      summary: { generatedAt: '2026-07-14T00:00:00.000Z', freshness: 'current' },
    })
    const firstRevision = readProjectStateDatabaseQueueRevision(tasksPath)
    expect(firstRevision).toBeTypeOf('number')

    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: { tasks: [{ id: 'task-1', title: 'Newer writer', status: 'working' }] },
      summary: { generatedAt: '2026-07-14T00:01:00.000Z', freshness: 'current' },
      expectedQueueRevision: firstRevision,
    })

    expect(() => writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: { tasks: [{ id: 'task-1', title: 'Stale writer', status: 'done' }] },
      summary: { generatedAt: '2026-07-14T00:02:00.000Z', freshness: 'current' },
      expectedQueueRevision: firstRevision,
    })).toThrow(/Stale project queue replacement/)
    expect(readProjectStateDatabaseQueueDefinition(tasksPath)).toMatchObject({
      tasks: [{ id: 'task-1', title: 'Newer writer', status: 'working' }],
    })
  })

  it('commits one promoted task and its summary without rewriting other detail payloads', () => {
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: {
        lastUpdated: '2026-07-14T00:00:00.000Z',
        releases: [{
          id: 'release-1',
          label: 'Release 1',
          kind: 'release',
          state: 'active',
          nodeIds: ['work:task-1'],
          deferredNodeIds: [],
        }],
        tasks: [
          { id: 'task-1', title: 'Original one', status: 'ready', updatedAt: '2026-07-14T00:00:00.000Z' },
          { id: 'task-2', title: 'Original two', status: 'ready', updatedAt: '2026-07-14T00:00:00.000Z' },
        ],
      },
      summary: {
        projectId: 'project',
        generatedAt: '2026-07-14T00:00:00.000Z',
        freshness: 'current',
        counts: { total: 2, ready: 2 },
      },
    })
    promoteProjectStateDatabaseAuthority(projectRoot)
    const before = readProjectStateDatabaseQueueRevision(tasksPath)
    expect(before).toBeTypeOf('number')

    const databaseBefore = new DatabaseSync(projectStateDatabasePath(projectRoot), { readOnly: true })
    const taskTwoBefore = databaseBefore.prepare('SELECT payload_gzip FROM work_item_detail WHERE task_id = ?').get('task-2') as { payload_gzip: Uint8Array }
    databaseBefore.close()

    const committed = writeProjectStateDatabaseTaskMutation(tasksPath, {
      expectedQueueRevision: before!,
      expectedProjectRevision: readProjectStateDatabaseRevisionFromTasksPath(tasksPath)!,
      task: {
        id: 'task-1',
        title: 'Updated one',
        status: 'working',
        updatedAt: '2026-07-15T00:00:00.000Z',
        spec: 'Updated rich detail',
        hierarchy: { childIds: [] },
        dependsOn: ['task-2'],
        releaseIds: ['release-1'],
        references: [],
      },
      summary: {
        projectId: 'project',
        generatedAt: '2026-07-15T00:00:00.000Z',
        freshness: 'current',
        counts: { total: 2, active: 1, ready: 1 },
        nextAction: { code: 'active_work', focusTaskId: 'task-1' },
      },
      scopeRow: {
        taskId: 'task-1',
        scope: 'included',
        eligibilityReason: 'selected scope',
        hierarchyRole: 'leaf',
        handoffState: 'ready',
        blocksStart: false,
        blocksRelease: false,
        humanBlocking: false,
        sourceRefs: [],
      },
    })

    expect(committed).toBeGreaterThan(before!)
    expect(readProjectStateDatabaseTask(tasksPath, 'task-1')).toMatchObject({
      id: 'task-1',
      title: 'Updated one',
      status: 'working',
      definition: { spec: 'Updated rich detail' },
    })
    expect(readProjectStateDatabaseSummary(tasksPath)).toMatchObject({
      freshness: 'current',
      payload: { counts: { total: 2, active: 1 } },
    })

    const databaseAfter = new DatabaseSync(projectStateDatabasePath(projectRoot), { readOnly: true })
    const taskTwoAfter = databaseAfter.prepare('SELECT payload_gzip FROM work_item_detail WHERE task_id = ?').get('task-2') as { payload_gzip: Uint8Array }
    expect(Buffer.from(taskTwoAfter.payload_gzip)).toEqual(Buffer.from(taskTwoBefore.payload_gzip))
    expect(databaseAfter.prepare('SELECT COUNT(*) AS count FROM work_item_detail WHERE revision = ?').get(committed)).toMatchObject({ count: 1 })
    expect(databaseAfter.prepare('SELECT scope FROM work_scope WHERE task_id = ?').get('task-1')).toMatchObject({ scope: 'included' })
    expect(databaseAfter.prepare('SELECT depends_on_json, release_ids_json FROM work_items WHERE id = ?').get('task-1')).toMatchObject({
      depends_on_json: '["task-2"]',
      release_ids_json: '[]',
    })
    databaseAfter.close()
    expect(readProjectStateDatabaseTaskRelationships(tasksPath, 'task-1')).toMatchObject({
      taskId: 'task-1',
      parentId: null,
      scopeRow: { taskId: 'task-1', scope: 'included' },
    })
  })

  it('commits task detail and bounded evidence in one promoted transaction', () => {
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: {
        lastUpdated: '2026-07-14T00:00:00.000Z',
        tasks: [{ id: 'task-1', title: 'Run gates', status: 'gate_check', proofPaths: [] }],
      },
      summary: { generatedAt: '2026-07-14T00:00:00.000Z', freshness: 'current', counts: { total: 1 } },
    })
    promoteProjectStateDatabaseAuthority(projectRoot)
    const revision = readProjectStateDatabaseQueueRevision(tasksPath)
    expect(revision).toBeTypeOf('number')

    writeProjectStateDatabaseTaskMutation(tasksPath, {
      expectedQueueRevision: revision!,
      expectedProjectRevision: readProjectStateDatabaseRevisionFromTasksPath(tasksPath)!,
      task: {
        id: 'task-1',
        title: 'Run gates',
        status: 'gate_check',
        updatedAt: '2026-07-15T00:00:00.000Z',
        proofPaths: [{ kind: 'command', command: 'pnpm test' }],
      },
      summary: { generatedAt: '2026-07-15T00:00:00.000Z', freshness: 'current', counts: { total: 1 } },
      evidence: [{
        event: {
          id: 'task-1-gate-test',
          taskId: 'task-1',
          kind: 'gate_result',
          recordedAt: '2026-07-15T00:00:00.000Z',
          payload: { gateId: 'test', passed: true, output: 'ok' },
        },
        retention: { maxRecords: 8, maxBytes: 4096 },
      }],
    })

    expect(readProjectStateDatabaseTaskEvidenceCurrent(projectRoot, 'task-1')).toMatchObject({
      taskId: 'task-1',
      byKind: {
        gate_result: [expect.objectContaining({
          payload: expect.objectContaining({ gateId: 'test', passed: true }),
        })],
      },
    })
    expect(readProjectStateDatabaseTaskEvidenceHistory(projectRoot, 'task-1', 'gate_result')).toHaveLength(1)
    expect(readProjectStateDatabaseTask(tasksPath, 'task-1')?.definition).not.toHaveProperty('gateResults')
  })

  it('changes release selection without rewriting unrelated task detail payloads', () => {
    const releases = [
      { id: 'release-1', label: 'First', kind: 'release', state: 'active', nodeIds: ['task-1'], deferredNodeIds: [] },
      { id: 'release-2', label: 'Second', kind: 'release', state: 'planned', nodeIds: ['task-2'], deferredNodeIds: [] },
    ]
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: {
        lastUpdated: '2026-07-14T00:00:00.000Z',
        selectedReleaseId: 'release-1',
        releases,
        tasks: [
          { id: 'task-1', title: 'First task', status: 'ready', releaseIds: ['release-1'] },
          { id: 'task-2', title: 'Second task', status: 'ready', releaseIds: ['release-2'] },
        ],
      },
      summary: { generatedAt: '2026-07-14T00:00:00.000Z', freshness: 'current', counts: { total: 2, included: 1, deferred: 1 } },
      scopeRows: [
        { taskId: 'task-1', scope: 'included', eligibilityReason: 'selected release', hierarchyRole: 'leaf', handoffState: 'ready', blocksStart: false, blocksRelease: false, humanBlocking: false, sourceRefs: [] },
        { taskId: 'task-2', scope: 'deferred', eligibilityReason: 'later release', hierarchyRole: 'leaf', handoffState: 'ready', blocksStart: false, blocksRelease: false, humanBlocking: false, sourceRefs: [] },
      ],
    })
    promoteProjectStateDatabaseAuthority(projectRoot)
    const before = readProjectStateDatabaseQueueRevision(tasksPath)!
    const databaseBefore = new DatabaseSync(projectStateDatabasePath(projectRoot), { readOnly: true })
    const taskOneBefore = databaseBefore.prepare('SELECT payload_gzip FROM work_item_detail WHERE task_id = ?').get('task-1') as { payload_gzip: Uint8Array }
    const taskTwoBefore = databaseBefore.prepare('SELECT payload_gzip FROM work_item_detail WHERE task_id = ?').get('task-2') as { payload_gzip: Uint8Array }
    databaseBefore.close()

    const committed = writeProjectStateDatabaseReleaseSelectionMutation(tasksPath, {
      releases,
      selectedReleaseId: 'release-2',
      expectedQueueRevision: before,
      expectedProjectRevision: readProjectStateDatabaseRevisionFromTasksPath(tasksPath)!,
      lastUpdated: '2026-07-15T00:00:00.000Z',
      summary: { generatedAt: '2026-07-15T00:00:00.000Z', freshness: 'current', counts: { total: 2, included: 1, deferred: 1 }, releaseSummary: { release: { id: 'release-2' } } },
      scopeRows: [
        { taskId: 'task-1', scope: 'deferred', eligibilityReason: 'later release', hierarchyRole: 'leaf', handoffState: 'ready', blocksStart: false, blocksRelease: false, humanBlocking: false, sourceRefs: [] },
        { taskId: 'task-2', scope: 'included', eligibilityReason: 'selected release', hierarchyRole: 'leaf', handoffState: 'ready', blocksStart: false, blocksRelease: false, humanBlocking: false, sourceRefs: [] },
      ],
    })

    expect(committed).toBeGreaterThan(before)
    expect(readProjectStateDatabaseQueueDefinition(tasksPath)).toMatchObject({ selectedReleaseId: 'release-2' })
    expect(new Map(readProjectStateDatabaseInventory(tasksPath)?.tasks.map(task => [task.id, task.scopeRow?.scope]))).toEqual(new Map([
      ['task-1', 'deferred'],
      ['task-2', 'included'],
    ]))
    const databaseAfter = new DatabaseSync(projectStateDatabasePath(projectRoot), { readOnly: true })
    const taskOneAfter = databaseAfter.prepare('SELECT payload_gzip FROM work_item_detail WHERE task_id = ?').get('task-1') as { payload_gzip: Uint8Array }
    const taskTwoAfter = databaseAfter.prepare('SELECT payload_gzip FROM work_item_detail WHERE task_id = ?').get('task-2') as { payload_gzip: Uint8Array }
    expect(Buffer.from(taskOneAfter.payload_gzip)).toEqual(Buffer.from(taskOneBefore.payload_gzip))
    expect(Buffer.from(taskTwoAfter.payload_gzip)).toEqual(Buffer.from(taskTwoBefore.payload_gzip))
    expect(databaseAfter.prepare('SELECT COUNT(*) AS count FROM work_item_detail WHERE revision = ?').get(committed)).toMatchObject({ count: 0 })
    databaseAfter.close()
  })

  it('commits a structural task delta without rewriting untouched detail payloads', () => {
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: {
        lastUpdated: '2026-07-14T00:00:00.000Z',
        tasks: [
          { id: 'task-1', title: 'Parent', status: 'ready' },
          { id: 'task-2', title: 'Untouched sibling', status: 'ready' },
        ],
      },
      summary: { generatedAt: '2026-07-14T00:00:00.000Z', freshness: 'current', counts: { total: 2 } },
      scopeRows: [
        { taskId: 'task-1', scope: 'included', eligibilityReason: 'current', hierarchyRole: 'parent', handoffState: 'ready', blocksStart: false, blocksRelease: false, humanBlocking: false, sourceRefs: [] },
        { taskId: 'task-2', scope: 'included', eligibilityReason: 'current', hierarchyRole: 'leaf', handoffState: 'ready', blocksStart: false, blocksRelease: false, humanBlocking: false, sourceRefs: [] },
      ],
    })
    promoteProjectStateDatabaseAuthority(projectRoot)
    const before = readProjectStateDatabaseQueueRevision(tasksPath)!
    const databaseBefore = new DatabaseSync(projectStateDatabasePath(projectRoot), { readOnly: true })
    const untouchedBefore = databaseBefore.prepare('SELECT payload_gzip FROM work_item_detail WHERE task_id = ?').get('task-2') as { payload_gzip: Uint8Array }
    databaseBefore.close()

    const committed = writeProjectStateDatabaseTaskBatchMutation(tasksPath, {
      expectedQueueRevision: before,
      expectedProjectRevision: readProjectStateDatabaseRevisionFromTasksPath(tasksPath)!,
      lastUpdated: '2026-07-15T00:00:00.000Z',
      tasks: [
        { id: 'task-1', title: 'Parent', status: 'ready', hierarchy: { childIds: ['task-3'] } },
        { id: 'task-3', title: 'New child', status: 'ready', hierarchy: { parentId: 'task-1' } },
      ],
      summary: { generatedAt: '2026-07-15T00:00:00.000Z', freshness: 'current', counts: { total: 3 } },
      scopeRows: [
        { taskId: 'task-3', scope: 'included', eligibilityReason: 'current', hierarchyRole: 'leaf', handoffState: 'ready', blocksStart: false, blocksRelease: false, humanBlocking: false, sourceRefs: [] },
      ],
    })

    expect(committed).toBeGreaterThan(before)
    expect(readProjectStateDatabaseQueueDefinition(tasksPath)?.tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'task-1', hierarchy: { childIds: ['task-3'] } }),
      expect.objectContaining({ id: 'task-3', title: 'New child' }),
    ]))
    const databaseAfter = new DatabaseSync(projectStateDatabasePath(projectRoot), { readOnly: true })
    const untouchedAfter = databaseAfter.prepare('SELECT payload_gzip FROM work_item_detail WHERE task_id = ?').get('task-2') as { payload_gzip: Uint8Array }
    expect(Buffer.from(untouchedAfter.payload_gzip)).toEqual(Buffer.from(untouchedBefore.payload_gzip))
    expect(databaseAfter.prepare('SELECT COUNT(*) AS count FROM work_item_detail WHERE revision = ?').get(committed)).toMatchObject({ count: 2 })
    databaseAfter.close()
  })

  it('commits relationship and planning-envelope changes with the same structural delta', () => {
    const releases = [{
      id: 'release-1',
      label: 'Release 1',
      kind: 'release',
      state: 'active',
      nodeIds: ['work:task-1', 'work:task-2'],
      deferredNodeIds: [],
    }]
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: {
        selectedReleaseId: 'release-1',
        executionPlanActions: [],
        scopeAuthorityRequests: [],
        releases,
        tasks: [
          { id: 'task-1', title: 'Needs dependency', status: 'ready', releaseIds: ['release-1'] },
          { id: 'task-2', title: 'Prerequisite', status: 'done', releaseIds: ['release-1'] },
        ],
      },
      summary: { generatedAt: '2026-07-14T00:00:00.000Z', freshness: 'current', counts: { total: 2 } },
      scopeRows: [
        { taskId: 'task-1', scope: 'included', eligibilityReason: 'current', hierarchyRole: 'leaf', handoffState: 'ready', blocksStart: false, blocksRelease: false, humanBlocking: false, sourceRefs: [] },
        { taskId: 'task-2', scope: 'included', eligibilityReason: 'current', hierarchyRole: 'leaf', handoffState: 'done', blocksStart: false, blocksRelease: false, humanBlocking: false, sourceRefs: [] },
      ],
    })
    promoteProjectStateDatabaseAuthority(projectRoot)
    const before = readProjectStateDatabaseQueueRevision(tasksPath)!
    const databaseBefore = new DatabaseSync(projectStateDatabasePath(projectRoot), { readOnly: true })
    const untouchedBefore = databaseBefore.prepare('SELECT payload_gzip FROM work_item_detail WHERE task_id = ?').get('task-2') as { payload_gzip: Uint8Array }
    databaseBefore.close()

    const committed = writeProjectStateDatabaseTaskBatchMutation(tasksPath, {
      expectedQueueRevision: before,
      expectedProjectRevision: readProjectStateDatabaseRevisionFromTasksPath(tasksPath)!,
      lastUpdated: '2026-07-15T00:00:00.000Z',
      tasks: [{ id: 'task-1', title: 'Needs dependency', status: 'ready', dependsOn: ['task-2'], releaseIds: ['release-1'] }],
      releases,
      selectedReleaseId: 'release-1',
      executionPlanActions: [{ id: 'plan-1', taskId: 'task-1', action: 'verify' }],
      scopeAuthorityRequests: [],
      summary: { generatedAt: '2026-07-15T00:00:00.000Z', freshness: 'current', counts: { total: 2 } },
      scopeRows: [
        { taskId: 'task-1', scope: 'included', eligibilityReason: 'dependency satisfied', hierarchyRole: 'leaf', handoffState: 'ready', blocksStart: false, blocksRelease: false, humanBlocking: false, sourceRefs: [] },
      ],
      evidence: [{
        event: {
          id: 'task-1-relationship-proof',
          taskId: 'task-1',
          kind: 'gate_result',
          recordedAt: '2026-07-15T00:00:00.000Z',
          payload: { gateId: 'dependency-check', passed: true, output: 'ok' },
        },
        retention: { maxRecords: 8, maxBytes: 4096 },
      }],
    })

    expect(committed).toBeGreaterThan(before)
    expect(readProjectStateDatabaseQueueDefinition(tasksPath)).toMatchObject({
      selectedReleaseId: 'release-1',
      executionPlanActions: [{ id: 'plan-1', taskId: 'task-1', action: 'verify' }],
      tasks: expect.arrayContaining([expect.objectContaining({ id: 'task-1', dependsOn: ['task-2'] })]),
    })
    const databaseAfter = new DatabaseSync(projectStateDatabasePath(projectRoot), { readOnly: true })
    const untouchedAfter = databaseAfter.prepare('SELECT payload_gzip FROM work_item_detail WHERE task_id = ?').get('task-2') as { payload_gzip: Uint8Array }
    expect(Buffer.from(untouchedAfter.payload_gzip)).toEqual(Buffer.from(untouchedBefore.payload_gzip))
    expect(databaseAfter.prepare('SELECT execution_plan_actions_json FROM queue_state WHERE id = 1').get()).toMatchObject({
      execution_plan_actions_json: '[{"id":"plan-1","taskId":"task-1","action":"verify"}]',
    })
    databaseAfter.close()
    expect(readProjectStateDatabaseTaskEvidenceCurrent(projectRoot, 'task-1')).toMatchObject({
      byKind: {
        gate_result: [expect.objectContaining({ payload: expect.objectContaining({ gateId: 'dependency-check', passed: true }) })],
      },
    })
  })

  it('keeps release membership normalized across task edits', () => {
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: {
        selectedReleaseId: 'release-current',
        releases: [{
          id: 'release-current',
          label: 'Current release',
          kind: 'release',
          state: 'active',
          nodeIds: ['work:task-current'],
          deferredNodeIds: ['work:task-later'],
        }],
        tasks: [
          { id: 'task-current', title: 'Current', status: 'ready', releaseIds: ['release-current'] },
          { id: 'task-later', title: 'Later', status: 'shelved', releaseIds: [] },
        ],
      },
      summary: { generatedAt: '2026-07-14T00:00:00.000Z', freshness: 'current' },
    })
    promoteProjectStateDatabaseAuthority(projectRoot)
    const queueRevision = readProjectStateDatabaseQueueRevision(tasksPath)!
    const projectRevision = readProjectStateDatabaseRevisionFromTasksPath(tasksPath)!

    writeProjectStateDatabaseTaskMutation(tasksPath, {
      expectedQueueRevision: queueRevision,
      expectedProjectRevision: projectRevision,
      task: { id: 'task-current', title: 'Current', status: 'done', releaseIds: ['release-current'] },
      summary: { generatedAt: '2026-07-15T00:00:00.000Z', freshness: 'current' },
    })

    const database = new DatabaseSync(projectStateDatabasePath(projectRoot), { readOnly: true })
    expect(database.prepare('SELECT release_id, task_id, disposition FROM release_membership ORDER BY task_id').all()).toEqual([
      { release_id: 'release-current', task_id: 'task-current', disposition: 'included' },
      { release_id: 'release-current', task_id: 'task-later', disposition: 'deferred' },
    ])
    expect(database.prepare('SELECT release_ids_json FROM work_items ORDER BY id').all()).toEqual([
      { release_ids_json: '[]' },
      { release_ids_json: '[]' },
    ])
    expect(database.prepare('SELECT node_ids_json, deferred_node_ids_json FROM scopes').all()).toEqual([
      { node_ids_json: '[]', deferred_node_ids_json: '[]' },
    ])
    expect(database.prepare('SELECT definition_json FROM scopes').get()?.definition_json).not.toMatch(/nodeIds|deferredNodeIds/)
    database.close()

    expect(readProjectStateDatabaseQueue(tasksPath)).toMatchObject({
      releases: [{
        id: 'release-current',
        nodeIds: ['work:task-current'],
        deferredNodeIds: ['work:task-later'],
      }],
      tasks: [
        { id: 'task-current', releaseIds: ['release-current'] },
        { id: 'task-later', releaseIds: ['release-current'] },
      ],
    })

    writeProjectStateDatabaseTaskMutation(tasksPath, {
      expectedQueueRevision: readProjectStateDatabaseQueueRevision(tasksPath)!,
      expectedProjectRevision: readProjectStateDatabaseRevisionFromTasksPath(tasksPath)!,
      task: { id: 'task-current', title: 'Current', status: 'done', releaseIds: [] },
      summary: { generatedAt: '2026-07-15T00:01:00.000Z', freshness: 'current' },
    })
    const afterEdit = new DatabaseSync(projectStateDatabasePath(projectRoot), { readOnly: true })
    expect(afterEdit.prepare('SELECT release_id, task_id, disposition FROM release_membership ORDER BY task_id').all()).toEqual([
      { release_id: 'release-current', task_id: 'task-later', disposition: 'deferred' },
    ])
    expect(afterEdit.prepare('SELECT release_ids_json FROM work_items ORDER BY id').all()).toEqual([
      { release_ids_json: '[]' },
      { release_ids_json: '[]' },
    ])
    afterEdit.close()

    expect(readProjectStateDatabaseTask(tasksPath, 'task-current')).toMatchObject({
      id: 'task-current',
      releaseIds: [],
    })
  })

  it('does not resurrect a dependency from the JSON mirror after normalized edges change', () => {
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: {
        tasks: [
          { id: 'task-dependent', title: 'Dependent', status: 'ready', dependsOn: ['task-prerequisite'] },
          { id: 'task-prerequisite', title: 'Prerequisite', status: 'done' },
        ],
      },
      summary: { generatedAt: '2026-07-14T00:00:00.000Z', freshness: 'current' },
    })

    const database = new DatabaseSync(projectStateDatabasePath(projectRoot))
    database.prepare('DELETE FROM task_dependencies WHERE task_id = ?').run('task-dependent')
    database.prepare('UPDATE work_items SET depends_on_json = ? WHERE id = ?')
      .run('["task-prerequisite"]', 'task-dependent')
    database.close()

    expect(readProjectStateDatabaseTask(tasksPath, 'task-dependent')).toMatchObject({
      id: 'task-dependent',
      dependsOn: [],
    })
    expect(readProjectStateDatabaseTaskRelationships(tasksPath, 'task-dependent')).toMatchObject({
      dependsOnIds: [],
    })
  })

  it('rejects a stale targeted mutation without changing the current task', () => {
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: { tasks: [{ id: 'task-1', title: 'Current', status: 'ready' }] },
      summary: { generatedAt: '2026-07-14T00:00:00.000Z', freshness: 'current' },
    })
    promoteProjectStateDatabaseAuthority(projectRoot)
    const revision = readProjectStateDatabaseQueueRevision(tasksPath)!
    writeProjectStateDatabaseTaskMutation(tasksPath, {
      expectedQueueRevision: revision,
      expectedProjectRevision: readProjectStateDatabaseRevisionFromTasksPath(tasksPath)!,
      task: { id: 'task-1', title: 'Newer', status: 'working' },
      summary: { generatedAt: '2026-07-15T00:00:00.000Z', freshness: 'current' },
    })

    expect(() => writeProjectStateDatabaseTaskMutation(tasksPath, {
      expectedQueueRevision: revision,
      expectedProjectRevision: readProjectStateDatabaseRevisionFromTasksPath(tasksPath)!,
      task: { id: 'task-1', title: 'Stale', status: 'done' },
      summary: { generatedAt: '2026-07-15T00:01:00.000Z', freshness: 'current' },
    })).toThrow(/Stale targeted project mutation/)
    expect(readProjectStateDatabaseTask(tasksPath, 'task-1')).toMatchObject({ title: 'Newer', status: 'working' })
  })

  it('rejects a task mutation when non-queue project state advanced', () => {
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: { tasks: [{ id: 'task-1', title: 'Current', status: 'ready' }] },
      summary: { generatedAt: '2026-07-14T00:00:00.000Z', freshness: 'current' },
    })
    promoteProjectStateDatabaseAuthority(projectRoot)
    const token = readProjectStateDatabaseQueueWithRevision(tasksPath)
    expect(token).not.toBeNull()
    markProjectStateDatabaseStale(projectRoot)

    expect(() => writeProjectStateDatabaseTaskMutation(tasksPath, {
      expectedQueueRevision: token!.revision,
      expectedProjectRevision: token!.projectRevision,
      task: { id: 'task-1', title: 'Must retry', status: 'working' },
      summary: { generatedAt: '2026-07-15T00:00:00.000Z', freshness: 'current' },
    })).toThrow(/project revision/i)
    expect(readProjectStateDatabaseTask(tasksPath, 'task-1')).toMatchObject({ title: 'Current', status: 'ready' })
  })

  it('refuses to insert an unknown item through the targeted mutation boundary', () => {
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: { tasks: [{ id: 'task-1', title: 'Current', status: 'ready' }] },
      summary: { generatedAt: '2026-07-14T00:00:00.000Z', freshness: 'current' },
    })
    promoteProjectStateDatabaseAuthority(projectRoot)
    const revision = readProjectStateDatabaseQueueRevision(tasksPath)!

    expect(() => writeProjectStateDatabaseTaskMutation(tasksPath, {
      expectedQueueRevision: revision,
      expectedProjectRevision: readProjectStateDatabaseRevisionFromTasksPath(tasksPath)!,
      task: { id: 'missing', title: 'Must not be inserted', status: 'ready' },
      summary: { generatedAt: '2026-07-15T00:00:00.000Z', freshness: 'current' },
    })).toThrow(/item not found/)

    expect(readProjectStateDatabaseQueueRevision(tasksPath)).toBe(revision)
    expect(readProjectStateDatabaseTask(tasksPath, 'missing')).toBeNull()
    expect(readProjectStateDatabaseTask(tasksPath, 'task-1')).toMatchObject({ title: 'Current', status: 'ready' })
  })

  it('rejects a scope row for a different work item before opening a transaction', () => {
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: { tasks: [{ id: 'task-1', title: 'Current', status: 'ready' }] },
      summary: { generatedAt: '2026-07-14T00:00:00.000Z', freshness: 'current' },
    })
    promoteProjectStateDatabaseAuthority(projectRoot)
    const revision = readProjectStateDatabaseQueueRevision(tasksPath)!

    expect(() => writeProjectStateDatabaseTaskMutation(tasksPath, {
      expectedQueueRevision: revision,
      expectedProjectRevision: readProjectStateDatabaseRevisionFromTasksPath(tasksPath)!,
      task: { id: 'task-1', title: 'Current', status: 'ready' },
      summary: { generatedAt: '2026-07-15T00:00:00.000Z', freshness: 'current' },
      scopeRow: {
        taskId: 'task-2',
        scope: 'included',
        eligibilityReason: 'wrong item',
        hierarchyRole: 'leaf',
        handoffState: 'ready',
        blocksStart: false,
        blocksRelease: false,
        humanBlocking: false,
        sourceRefs: [],
      },
    })).toThrow(/scope row must belong to task-1/)

    expect(readProjectStateDatabaseQueueRevision(tasksPath)).toBe(revision)
  })

  it('rejects unknown identities in the bundled current projection', () => {
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: { tasks: [{ id: 'task-1', title: 'Current', status: 'ready' }] },
      summary: { generatedAt: '2026-07-14T00:00:00.000Z', freshness: 'current' },
    })
    promoteProjectStateDatabaseAuthority(projectRoot)

    expect(() => writeProjectStateDatabaseSummarySnapshot(tasksPath, {
      summary: { generatedAt: '2026-07-15T00:00:00.000Z', freshness: 'current' },
      currentProjection: {
        taskStatusRows: [{ taskId: 'workspace-import:missing', status: 'ready' }],
        scopeRows: [],
      },
    })).toThrow(/unknown task workspace-import:missing/)

    expect(readProjectStateDatabaseTask(tasksPath, 'workspace-import:missing')).toBeNull()
    expect(readProjectStateDatabaseTask(tasksPath, 'task-1')).toMatchObject({ status: 'ready' })
  })

  it('rejects unknown scope identities in a full queue snapshot', () => {
    expect(() => writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: { tasks: [{ id: 'task-1', title: 'Current', status: 'ready' }] },
      summary: { generatedAt: '2026-07-14T00:00:00.000Z', freshness: 'current' },
      scopeRows: [{
        taskId: 'workspace-import:missing',
        scope: 'included',
        eligibilityReason: 'selected',
        hierarchyRole: 'leaf',
        handoffState: 'ready',
        blocksStart: false,
        blocksRelease: false,
        humanBlocking: false,
        sourceRefs: [],
      }],
    })).toThrow(/unknown task workspace-import:missing/)
  })

  it('rejects a summary projection read from an older project revision', () => {
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: { tasks: [{ id: 'task-1', title: 'Current', status: 'ready' }] },
      summary: { generatedAt: '2026-07-14T00:00:00.000Z', freshness: 'current' },
    })
    promoteProjectStateDatabaseAuthority(projectRoot)
    const metadata = readProjectStateDatabaseMetadata(projectRoot)
    if (!metadata) throw new Error('Missing project metadata')

    expect(() => writeProjectStateDatabaseSummarySnapshot(tasksPath, {
      summary: { generatedAt: '2026-07-15T00:00:00.000Z', freshness: 'current' },
      expectedProjectRevision: metadata.revision - 1,
    })).toThrow(/expected project revision/)
  })

  it('returns the full mutation queue and its compare-and-swap revision together', () => {
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: { tasks: [{ id: 'task-1', title: 'Current detail', status: 'ready' }] },
      summary: { generatedAt: '2026-07-14T00:00:00.000Z', freshness: 'current' },
    })

    const read = readProjectStateDatabaseQueueWithRevision(tasksPath)
    expect(read).toMatchObject({
      revision: expect.any(Number),
      definition: { tasks: [{ id: 'task-1', title: 'Current detail' }] },
    })
  })

  it('reconstructs explicit rich reads from indexed task detail without a queue blob', async () => {
    const fullTask = {
      id: 'task-atomic-detail',
      title: 'Atomic detail',
      status: 'ready',
      spec: 'The full task definition is durable detail.'.repeat(20),
    }
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: { tasks: [fullTask] },
      summary: { generatedAt: '2026-07-14T00:00:00.000Z', freshness: 'current' },
    })

    const detailPath = projectStateDatabaseCompressedDetailPathFromTasksPath(tasksPath)
    await expect(fs.stat(detailPath)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(readProjectStateDatabaseQueueDefinition(tasksPath)).toMatchObject({
      tasks: [{ id: fullTask.id, spec: fullTask.spec }],
    })

    const database = new DatabaseSync(projectStateDatabasePath(projectRoot), { readOnly: true })
    expect(database.prepare('SELECT COUNT(*) AS count FROM queue_detail').get()).toMatchObject({ count: 0 })
    expect(database.prepare('SELECT COUNT(*) AS count FROM work_item_detail').get()).toMatchObject({ count: 1 })
    database.close()

    promoteProjectStateDatabaseAuthority(projectRoot)
    const revision = readProjectStateDatabaseQueueRevision(tasksPath)
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: { tasks: [{ ...fullTask, status: 'working' }] },
      summary: { generatedAt: '2026-07-14T00:01:00.000Z', freshness: 'current' },
      expectedQueueRevision: revision,
    })
    await expect(fs.stat(detailPath)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(readProjectStateDatabaseQueueDefinition(tasksPath)).toMatchObject({
      tasks: [{ id: fullTask.id, status: 'working', spec: fullTask.spec }],
    })

    const databaseAfterPromotion = new DatabaseSync(projectStateDatabasePath(projectRoot))
    databaseAfterPromotion.prepare('DELETE FROM queue_detail WHERE id = 1').run()
    databaseAfterPromotion.close()
    await fs.writeFile(detailPath, gzipSync(JSON.stringify({
      detailStoreVersion: 1,
      revision,
      tasks: [{ id: fullTask.id, title: 'Stale filesystem detail' }],
      releases: [],
    })))
    expect(readProjectStateDatabaseQueueDefinition(tasksPath)).toMatchObject({
      tasks: [{ id: fullTask.id, spec: fullTask.spec }],
    })
  })

  it('reads one task detail and indexed relationships without queue_detail', () => {
    const parent = {
      id: 'task-parent',
      title: 'Parent task',
      status: 'ready',
      hierarchy: { childIds: ['task-child'] },
      spec: 'Parent detail stays independently addressable.',
    }
    const child = {
      id: 'task-child',
      title: 'Child task',
      status: 'in_progress',
      hierarchy: { parentId: 'task-parent', childIds: [] },
      delivery: {
        driver: 'writer',
        usesPrimitives: ['primitive-editor'],
        provesPrimitives: ['primitive-proof'],
      },
      spec: 'Child detail does not require the whole queue.',
    }
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: { tasks: [parent, child] },
      summary: { generatedAt: '2026-07-14T00:00:00.000Z', freshness: 'current' },
      scopeRows: [{
        taskId: 'task-child',
        scope: 'included',
        eligibilityReason: 'current release',
        hierarchyRole: 'leaf',
        handoffState: 'ready',
        blocksStart: false,
        blocksRelease: true,
        humanBlocking: false,
        sourceRefs: ['docs/mvp.md'],
      }],
    })

    const database = new DatabaseSync(projectStateDatabasePath(projectRoot))
    expect(database.prepare('SELECT COUNT(*) AS count FROM work_item_detail').get()).toMatchObject({ count: 2 })
    database.prepare('DELETE FROM queue_detail WHERE id = 1').run()
    database.close()

    expect(readProjectStateDatabaseTaskPoint(tasksPath, 'task-child')?.definition).toMatchObject({
      id: 'task-child',
      spec: child.spec,
    })
    expect(readProjectStateDatabaseTask(tasksPath, 'task-child')?.definition).toMatchObject({ spec: child.spec })
    expect(readProjectStateDatabaseQueue(tasksPath)?.tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'task-child',
        delivery: {
          driver: 'writer',
          usesPrimitives: ['primitive-editor'],
          provesPrimitives: ['primitive-proof'],
        },
      }),
    ]))
    expect(readProjectStateDatabaseTasks(tasksPath, ['task-child'], { includeDefinitions: true })?.[0]?.definition)
      .toMatchObject({ spec: child.spec })
    expect(readProjectStateDatabaseTaskRelationships(tasksPath, 'task-parent')).toMatchObject({
      taskId: 'task-parent',
      parentId: null,
      childIds: ['task-child'],
    })
    expect(readProjectStateDatabaseTaskRelationships(tasksPath, 'task-child')).toMatchObject({
      parentId: 'task-parent',
      childIds: [],
      scopeRow: {
        taskId: 'task-child',
        parentTaskId: 'task-parent',
        scope: 'included',
        blocksRelease: true,
      },
    })
  })

  it('reads a bounded task-detail envelope without the aggregate task SELECT', () => {
    const tasks = [
      {
        id: 'task-parent',
        title: 'Parent task',
        status: 'ready',
        releaseIds: ['release-current'],
      },
      {
        id: 'task-prerequisite',
        title: 'Prerequisite',
        status: 'done',
        releaseIds: ['release-current'],
      },
      {
        id: 'task-target',
        title: 'Target task',
        status: 'working',
        hierarchy: { parentId: 'task-parent' },
        dependsOn: ['task-prerequisite'],
        releaseIds: ['release-current'],
        spec: 'The drawer needs this definition only.',
      },
      {
        id: 'task-child',
        title: 'Target child',
        status: 'ready',
        hierarchy: { parentId: 'task-target' },
        releaseIds: ['release-current'],
      },
      {
        id: 'task-dependent',
        title: 'Direct dependent',
        status: 'blocked',
        dependsOn: ['task-target'],
        releaseIds: ['release-current'],
      },
      ...Array.from({ length: 500 }, (_, index) => ({
        id: `task-${index}`,
        title: `Background task ${index}`,
        status: 'ready',
      })),
    ]
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: {
        selectedReleaseId: 'release-current',
        releases: [
          { id: 'release-current', label: 'Current release', state: 'active', nodeIds: ['work:task-target'], deferredNodeIds: [] },
          { id: 'release-later', label: 'Later release', state: 'planned', nodeIds: [], deferredNodeIds: [] },
        ],
        tasks,
      },
      scopeRows: [{
        taskId: 'task-target',
        scope: 'included',
        eligibilityReason: 'selected release',
        hierarchyRole: 'child',
        handoffState: 'working',
        blocksStart: false,
        blocksRelease: true,
        humanBlocking: false,
        sourceRefs: ['docs/current-release.md'],
      }],
      summary: {
        generatedAt: '2026-07-14T00:00:00.000Z',
        freshness: 'current',
        counts: { total: tasks.length },
      },
    })

    const prepare = vi.spyOn(DatabaseSync.prototype, 'prepare')
    let detail: ReturnType<typeof readProjectStateDatabaseTaskDetailState>
    try {
      detail = readProjectStateDatabaseTaskDetailState(tasksPath, 'task-target')
      const aggregateTaskReads = prepare.mock.calls.filter(([sql]) => (
        typeof sql === 'string' && /FROM work_items\s+ORDER BY rowid/.test(sql)
      ))
      expect(aggregateTaskReads).toHaveLength(0)
    } finally {
      prepare.mockRestore()
    }

    expect(detail).toMatchObject({
      task: { id: 'task-target', definition: { spec: 'The drawer needs this definition only.' } },
      queue: {
        selectedReleaseId: 'release-current',
        tasks: [],
        releases: [
          { id: 'release-current', label: 'Current release' },
          { id: 'release-later', label: 'Later release' },
        ],
      },
      relationships: {
        parentId: 'task-parent',
        childIds: ['task-child'],
        dependsOnIds: ['task-prerequisite'],
        dependentIds: ['task-dependent'],
      },
      scopeRows: [expect.objectContaining({ taskId: 'task-target', scope: 'included' })],
      summary: { payload: { counts: { total: tasks.length } } },
    })

    const diagnostic = readProjectStateDatabaseTaskDetailState(tasksPath, 'task-target', {
      includeAggregateTasks: true,
    })
    expect(diagnostic?.queue.tasks).toHaveLength(tasks.length)

    const database = new DatabaseSync(projectStateDatabasePath(projectRoot), { readOnly: true })
    const plan = database.prepare(`
      EXPLAIN QUERY PLAN
      SELECT task_id FROM task_dependencies WHERE depends_on_task_id = ?
    `).all('task-target') as Array<{ detail?: string }>
    database.close()
    expect(plan.some(row => row.detail?.includes('task_dependencies_dependency_idx'))).toBe(true)
  })

  it('does not resurrect task definitions from a historical source queue', async () => {
    const task = {
      id: 'task-legacy-detail',
      title: 'Legacy detail',
      status: 'ready',
      spec: 'Legacy projects still read their source queue while migrating.',
    }
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: { tasks: [task] },
      summary: { generatedAt: '2026-07-14T00:00:00.000Z', freshness: 'current' },
    })
    await fs.writeFile(tasksPath, JSON.stringify({ tasks: [task] }), 'utf8')

    const database = new DatabaseSync(projectStateDatabasePath(projectRoot))
    database.exec('DROP TABLE work_item_detail; DELETE FROM queue_detail WHERE id = 1;')
    database.close()

    expect(readProjectStateDatabaseTaskPoint(tasksPath, task.id)?.definition).toEqual({})
  })

  it('stores orientation separately from the compact summary payload', () => {
    const orientation = {
      scope: { id: 'release-1', label: 'Release 1' },
      nodes: { 'work:task-1': { id: 'work:task-1', title: 'One' } },
    }
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: { tasks: [{ id: 'task-1', title: 'One', status: 'ready' }] },
      summary: {
        projectId: 'project',
        generatedAt: '2026-07-14T00:00:00.000Z',
        freshness: 'current',
        counts: { total: 1 },
        orientationSpine: orientation,
      },
    })

    const database = new DatabaseSync(projectStateDatabasePath(projectRoot), { readOnly: true })
    const compactPayload = database.prepare('SELECT payload_json FROM project_summary WHERE id = 1').get() as { payload_json: string }
    const orientationPayload = database.prepare('SELECT payload_json FROM project_orientation WHERE id = 1').get() as { payload_json: string }
    database.close()

    expect(JSON.parse(compactPayload.payload_json)).not.toHaveProperty('orientationSpine')
    expect(JSON.parse(orientationPayload.payload_json)).toEqual(orientation)
    expect(readProjectStateDatabaseSummary(tasksPath)?.payload).toMatchObject({ orientationSpine: orientation })
    expect(readProjectStateDatabaseSummary(tasksPath, { includeOrientation: false })?.payload).not.toHaveProperty('orientationSpine')

    updateProjectStateDatabaseSummary(tasksPath, summary => ({ ...summary, unrelatedPatch: true }))

    expect(readProjectStateDatabaseSummary(tasksPath)?.payload).toMatchObject({
      orientationSpine: orientation,
      unrelatedPatch: true,
    })
  })

  it('stores only bounded current intake facts for inbox reads', () => {
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: {
        tasks: [{
          id: 'task-imported',
          title: 'Imported task',
          description: 'Imported work with a bounded current summary.',
          status: 'exploring',
          importedDraft: true,
          productBrief: {
            userJob: 'Shape the imported task.',
            successMetric: 'A usable brief exists.',
            approvedAt: null,
            whyItMattersNow: 'This is current work.',
          },
          acceptanceCriteria: [{ id: 'one', description: 'A proof exists.' }],
          taskReadiness: { recommendation: 'needs_research_spike', summary: 'Source proof is missing.' },
          notes: [{ content: 'A long historical note must not enter the summary.' }],
        }],
      },
      summary: { generatedAt: '2026-07-14T00:00:00.000Z', freshness: 'current' },
    })

    const task = readProjectStateDatabaseQueue(tasksPath)?.tasks[0] as Record<string, unknown>
    expect(task).toMatchObject({
      id: 'task-imported',
      currentSummary: {
        imported: true,
        brief: { present: true, shaped: true, userJob: true, successMetric: true, approvedAt: null },
        acceptanceCriteriaCount: 1,
        taskReadiness: { recommendation: 'needs_research_spike', summary: 'Source proof is missing.' },
      },
    })
    expect(JSON.stringify(task)).not.toContain('A long historical note')
    expect(JSON.stringify(task)).not.toContain('Shape the imported task.')
  })

  it('pages inventory rows without loading task definitions into the summary', () => {
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: {
        tasks: [
          { id: 'task-1', title: 'One', status: 'ready', updatedAt: '2026-07-14T00:00:02.000Z' },
          { id: 'task-2', title: 'Two', status: 'done', updatedAt: '2026-07-14T00:00:01.000Z' },
        ],
      },
      summary: { generatedAt: '2026-07-14T00:00:00.000Z', freshness: 'current' },
      scopeRows: [{
        taskId: 'task-1',
        scope: 'included',
        eligibilityReason: 'included',
        hierarchyRole: 'root',
        handoffState: 'ready',
        blocksStart: false,
        blocksRelease: false,
        humanBlocking: false,
        sourceRefs: ['docs/plan.md'],
      }],
    })

    expect(readProjectStateDatabaseInventory(tasksPath, { offset: 1, limit: 1 })).toMatchObject({
      total: 2,
      offset: 1,
      limit: 1,
      hasMore: false,
      tasks: [{ id: 'task-2', title: 'Two', status: 'done' }],
    })
    expect(readProjectStateDatabaseInventory(tasksPath, { limit: 1 })?.tasks[0]?.scopeRow).toMatchObject({
      taskId: 'task-1',
      scope: 'included',
      sourceRefs: ['docs/plan.md'],
    })
  })

  it('captures a selected task in the same projection snapshot as its revisions', () => {
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: {
        tasks: [
          { id: 'task-1', title: 'One', status: 'ready', spec: 'The selected definition.' },
          { id: 'task-2', title: 'Two', status: 'done', spec: 'Another definition.' },
        ],
      },
      summary: { generatedAt: '2026-07-14T00:00:00.000Z', freshness: 'current' },
    })

    const snapshot = readProjectStateDatabaseProjectionState(tasksPath, {
      limit: 1,
      selectedTaskId: 'task-2',
      includeDefinitions: true,
    })

    expect(snapshot?.inventory.tasks).toHaveLength(1)
    expect(snapshot?.selectedTask).toMatchObject({
      id: 'task-2',
      title: 'Two',
      definition: { spec: 'Another definition.' },
    })
    expect(snapshot?.queueRevision).toEqual(readProjectStateDatabaseQueueRevision(tasksPath))
    expect(snapshot?.projectRevision).toEqual(readProjectStateDatabaseRevisionFromTasksPath(tasksPath))
  })

  it('hydrates explicit task points in caller order and captures matching revisions', () => {
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: {
        tasks: [
          { id: 'task-1', title: 'One', status: 'ready', spec: 'First definition.' },
          { id: 'task-2', title: 'Two', status: 'working', spec: 'Second definition.' },
          { id: 'task-3', title: 'Three', status: 'done', spec: 'Third definition.' },
        ],
      },
      summary: { generatedAt: '2026-07-14T00:00:00.000Z', freshness: 'current' },
    })

    const read = readProjectStateDatabaseTaskPointsWithRevision(
      tasksPath,
      ['task-3', 'missing', 'task-1', 'task-3'],
      { includeDefinitions: true },
    )

    expect(read?.tasks.map(task => task.id)).toEqual(['task-3', 'task-1'])
    expect(read?.tasks).toMatchObject([
      { id: 'task-3', definition: { spec: 'Third definition.' } },
      { id: 'task-1', definition: { spec: 'First definition.' } },
    ])
    expect(read?.queueRevision).toBe(readProjectStateDatabaseQueueRevision(tasksPath))
    expect(read?.projectRevision).toBe(readProjectStateDatabaseRevisionFromTasksPath(tasksPath))
  })

  it('reads bounded current tasks and overlays from one revisioned database snapshot', () => {
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: {
        tasks: [
          { id: 'task-1', title: 'One', status: 'ready' },
          { id: 'task-2', title: 'Two', status: 'ready' },
        ],
      },
      summary: { generatedAt: '2026-07-14T00:00:00.000Z', freshness: 'current' },
    })
    upsertProjectStateDatabaseTaskRuntime(projectRoot, {
      taskId: 'task-2',
      updatedAt: '2026-07-14T00:01:00.000Z',
      payload: { status: 'running', owner: 'worker-1' },
    })

    const read = readProjectStateDatabaseCurrentTasksWithRevision(tasksPath, [
      'task-2',
      'missing',
      'task-1',
    ])

    expect(read?.tasks.map(task => ({ id: task.id, status: task.status }))).toEqual([
      { id: 'task-2', status: 'ready' },
      { id: 'task-1', status: 'ready' },
    ])
    expect(read?.overlays.get('task-2')).toMatchObject({
      runtime: { payload: { status: 'running', owner: 'worker-1' } },
    })
    expect(read?.overlays.get('task-1')).toEqual({})
    expect([...read?.overlays.keys() ?? []]).toEqual(['task-2', 'task-1'])
    expect(read?.queueRevision).toBe(readProjectStateDatabaseQueueRevision(tasksPath))
    expect(read?.projectRevision).toBe(readProjectStateDatabaseRevisionFromTasksPath(tasksPath))
    expect(read?.projectAuthority).toBe('database')
  })

  it('returns revisions for an empty point selection without reconstructing queue data', () => {
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: { tasks: [{ id: 'task-1', title: 'Only task', status: 'ready' }] },
      summary: { generatedAt: '2026-07-14T00:00:00.000Z', freshness: 'current' },
    })

    const read = readProjectStateDatabaseTaskPointsWithRevision(tasksPath, [])

    expect(read?.tasks).toEqual([])
    expect(read?.queueRevision).toBe(readProjectStateDatabaseQueueRevision(tasksPath))
    expect(read?.projectRevision).toBe(readProjectStateDatabaseRevisionFromTasksPath(tasksPath))
  })

  it('materializes only the Work-card facts needed by a compact list read', () => {
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: {
        tasks: [{
          id: 'task-1',
          title: 'Bounded card',
          status: 'ready',
          spec: 'The full implementation detail stays behind task detail.',
          acceptanceCriteria: [{ id: 'criterion-1', description: 'The list shows the first acceptance signal.' }],
          workUnitAnalysis: { units: [{ id: 'unit-1' }, { id: 'unit-2' }] },
          evidence: Array.from({ length: 20 }, (_, index) => ({ id: `evidence-${index}`, transcript: 'detail only' })),
        }],
      },
      summary: { generatedAt: '2026-07-14T00:00:00.000Z', freshness: 'current' },
    })

    const card = readProjectStateDatabaseInventory(tasksPath, { limit: 1 })?.tasks[0] as unknown as Record<string, unknown>
    expect(card).toMatchObject({
      id: 'task-1',
      acceptanceCriteriaCount: 1,
      acceptanceCriteriaFirstDescription: 'The list shows the first acceptance signal.',
      workUnitCount: 2,
      spec: 'present',
    })
    expect(card.definition).toEqual({})
    expect(card).not.toHaveProperty('acceptanceCriteria')
    expect(card).not.toHaveProperty('evidence')
  })

  it('compresses the full detail store without changing its parsed content', async () => {
    const fullTask = {
      id: 'task-detail',
      title: 'Detail payload',
      status: 'ready',
      spec: 'Repeated detail '.repeat(500),
      acceptanceCriteria: [{ id: 'criterion-1', description: 'The detail remains readable.' }],
    }
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: { tasks: [fullTask] },
      summary: { generatedAt: '2026-07-14T00:00:00.000Z', freshness: 'current' },
    })
    const sourcePath = projectStateDatabaseDetailPathFromTasksPath(tasksPath)
    const compressedPath = projectStateDatabaseCompressedDetailPathFromTasksPath(tasksPath)
    await fs.writeFile(sourcePath, JSON.stringify({
      detailStoreVersion: 1,
      revision: readProjectStateDatabaseQueueRevision(tasksPath),
      version: 1,
      tasks: [fullTask],
      releases: [],
    }))

    const result = compressProjectStateDetailStore(tasksPath)
    expect(result).toMatchObject({ removedSource: true })
    expect(result!.bytesAfter).toBeLessThan(result!.bytesBefore)
    await expect(fs.stat(sourcePath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.stat(compressedPath)).resolves.toBeDefined()
    expect(readProjectStateDatabaseTask(tasksPath, 'task-detail')?.definition).toMatchObject({
      id: 'task-detail',
      spec: fullTask.spec,
    })
  })

  it('refuses to remove an unrecognized detail store during compression', async () => {
    const sourcePath = projectStateDatabaseDetailPathFromTasksPath(tasksPath)
    const compressedPath = projectStateDatabaseCompressedDetailPathFromTasksPath(tasksPath)
    await fs.writeFile(sourcePath, '{"not":"a detail store"}', 'utf8')

    expect(() => compressProjectStateDetailStore(tasksPath)).toThrow(/unrecognized project detail store/)
    await expect(fs.readFile(sourcePath, 'utf8')).resolves.toContain('not')
    await expect(fs.stat(compressedPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('marks the current read model stale without rewriting authoritative rows', () => {
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: { tasks: [{ id: 'task-1', title: 'One', status: 'ready' }] },
      summary: { generatedAt: '2026-07-14T00:00:00.000Z', freshness: 'current' },
    })

    const before = readProjectStateDatabaseMetadata(projectRoot)
    const invalidationRevision = markProjectStateDatabaseStale(projectRoot)
    const after = readProjectStateDatabaseMetadata(projectRoot)

    expect(invalidationRevision).toBe(after?.revision)
    expect(after?.revision).toBeGreaterThan(before?.revision ?? 0)
    expect(readProjectStateDatabaseSummary(tasksPath)?.freshness).toBe('stale')
    expect(readProjectStateDatabaseTask(tasksPath, 'task-1')?.title).toBe('One')
  })

  it('reads repository snapshots without creating state and preserves freshness', () => {
    const missingRoot = path.join(tmp, 'missing-project')
    expect(readProjectStateDatabaseRepositories(missingRoot)).toEqual([])
    expect(readProjectStateDatabaseRepository(missingRoot, 'task:missing')).toBeNull()

    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: { tasks: [{ id: 'task-1', title: 'One', status: 'ready' }] },
      summary: { generatedAt: '2026-07-14T00:00:00.000Z', freshness: 'current' },
    })
    upsertProjectStateDatabaseRepository(projectRoot, {
      id: 'task:task-1',
      root: '/repo/task-1',
      branch: 'feature/task-1',
      status: 'committed_local',
      freshness: 'current',
      inspectedAt: '2026-07-14T00:01:00.000Z',
      payload: {
        state: 'committed_local',
        repoRoot: '/repo/task-1',
        inspectedAt: '2026-07-14T00:01:00.000Z',
        reason: 'One local commit is not pushed.',
        nextAction: 'Push the branch.',
      },
    })

    expect(readProjectStateDatabaseRepository(projectRoot, 'task:task-1')).toMatchObject({
      id: 'task:task-1',
      root: '/repo/task-1',
      branch: 'feature/task-1',
      freshness: 'current',
      payload: { state: 'committed_local' },
    })
    expect(readProjectStateDatabaseRepositories(projectRoot)).toHaveLength(1)
    expect(readProjectStateDatabaseRepositoriesFromTasksPath(tasksPath)).toEqual(readProjectStateDatabaseRepositories(projectRoot))
  })

  it('replaces repository observations atomically and does not advance unchanged state', () => {
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: { tasks: [{ id: 'task-1', title: 'One', status: 'ready' }] },
      summary: { generatedAt: '2026-07-14T00:00:00.000Z', freshness: 'current' },
    })

    replaceProjectStateDatabaseRepositories(projectRoot, [
      {
        id: 'repo:child',
        root: '/repo/child',
        branch: 'main',
        head: 'abc123',
        status: 'clean',
        freshness: 'current',
        inspectedAt: '2026-07-14T00:01:00.000Z',
        payload: { state: 'clean' },
      },
      {
        id: 'repo:root',
        root: '/repo/root',
        branch: 'feature/work',
        head: 'def456',
        status: 'committed_local',
        freshness: 'current',
        inspectedAt: '2026-07-14T00:01:00.000Z',
        payload: { state: 'committed_local' },
      },
    ])
    const afterFirstWrite = readProjectStateDatabaseMetadata(projectRoot)!

    replaceProjectStateDatabaseRepositories(projectRoot, [{
      id: 'repo:root',
      root: '/repo/root',
      branch: 'feature/work',
      head: 'def456',
      status: 'committed_local',
      freshness: 'current',
      inspectedAt: '2026-07-14T00:01:00.000Z',
      payload: { state: 'committed_local' },
    }])
    const afterSecondWrite = readProjectStateDatabaseMetadata(projectRoot)!

    expect(readProjectStateDatabaseRepositories(projectRoot)).toEqual([{
      id: 'repo:root',
      root: '/repo/root',
      branch: 'feature/work',
      head: 'def456',
      status: 'committed_local',
      freshness: 'current',
      inspectedAt: '2026-07-14T00:01:00.000Z',
      payload: { state: 'committed_local' },
    }])
    expect(afterSecondWrite?.revision).toBe(afterFirstWrite.revision + 1)

    replaceProjectStateDatabaseRepositories(projectRoot, [{
      id: 'repo:root',
      root: '/repo/root',
      branch: 'feature/work',
      head: 'def456',
      status: 'committed_local',
      freshness: 'current',
      inspectedAt: '2026-07-14T00:01:00.000Z',
      payload: { state: 'committed_local' },
    }])
    expect(readProjectStateDatabaseMetadata(projectRoot)?.revision).toBe(afterSecondWrite.revision)

    replaceProjectStateDatabaseRepositories(projectRoot, [{
      id: 'repo:root',
      root: '/repo/root',
      branch: 'feature/work',
      head: 'def456',
      status: 'committed_local',
      freshness: 'current',
      inspectedAt: '2026-07-14T00:02:00.000Z',
      payload: { state: 'committed_local' },
    }])
    expect(readProjectStateDatabaseMetadata(projectRoot)?.revision).toBe(afterSecondWrite.revision)
    expect(readProjectStateDatabaseRepository(projectRoot, 'repo:root')?.inspectedAt).toBe('2026-07-14T00:02:00.000Z')
  })

  it('keeps promoted summary freshness independent from legacy source files', async () => {
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: {
        tasks: [{ id: 'task-1', title: 'Current task', status: 'ready' }],
        releases: [],
      },
      summary: {
        projectId: 'summary-authority',
        generatedAt: '2026-07-14T00:00:00.000Z',
        freshness: 'current',
        currentStateAuthority: 'database',
        counts: { total: 1, done: 0, unfinished: 1 },
      },
    })
    await fs.writeFile(tasksPath, 'this legacy queue is intentionally invalid', 'utf8')
    await fs.writeFile(path.join(path.dirname(tasksPath), 'workspace-goals.json'), '{not current state}', 'utf8')

    const summary = readProjectStateDatabaseSummary<{ currentStateAuthority?: string }>(tasksPath)

    expect(summary?.freshness).toBe('current')
    expect(summary?.payload.currentStateAuthority).toBe('database')
  })

  it('keeps current execution and runtime rows while proof invalidates the shared projection', () => {
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: { tasks: [{ id: 'task-1', title: 'One', status: 'ready' }] },
      summary: { generatedAt: '2026-07-14T00:00:00.000Z', freshness: 'current' },
    })
    const before = readProjectStateDatabaseMetadata(projectRoot)
    upsertProjectStateDatabaseTaskRuntime(projectRoot, {
      taskId: 'task-1',
      updatedAt: '2026-07-14T00:01:00.000Z',
      payload: { taskId: 'task-1', handoffStep: 2 },
    })
    upsertProjectStateDatabaseTaskProof(projectRoot, {
      taskId: 'task-1',
      kind: 'gate_result',
      recordedAt: '2026-07-14T00:02:00.000Z',
      payload: { passed: true, gateId: 'build' },
    })
    upsertProjectStateDatabaseExecution(projectRoot, {
      status: 'running',
      mode: 'continuous',
      startedAt: '2026-07-14T00:03:00.000Z',
      updatedAt: '2026-07-14T00:03:00.000Z',
    })

    const after = readProjectStateDatabaseMetadata(projectRoot)
    expect(after?.schemaVersion).toBe(PROJECT_STATE_DATABASE_SCHEMA_VERSION)
    expect(after?.revision).toBeGreaterThan(before?.revision ?? 0)
    expect(readProjectStateDatabaseSummary(tasksPath)).toMatchObject({
      freshness: 'stale',
    })
    expect(readProjectStateDatabaseTaskOverlay(projectRoot, 'task-1')).toMatchObject({
      runtime: { payload: { taskId: 'task-1', handoffStep: 2 } },
      latestProof: {
        kind: 'gate_result',
        recordedAt: '2026-07-14T00:02:00.000Z',
        result: 'passed',
        payload: { passed: true, gateId: 'build' },
      },
      evidenceCurrent: {
        taskId: 'task-1',
        version: 1,
        byKind: {
          gate_result: [{ payload: { passed: true, gateId: 'build' } }],
        },
      },
    })
    expect(readProjectStateDatabaseTaskEvidenceCurrent(projectRoot, 'task-1')?.byKind.gate_result).toHaveLength(1)
  })

  it('hydrates mutable summary facts from their dedicated current tables', () => {
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: { tasks: [{ id: 'task-1', title: 'One', status: 'ready' }] },
      summary: {
        generatedAt: '2026-07-14T00:00:00.000Z',
        freshness: 'current',
        ownerInput: { openCount: 0, next: null, updatedAt: '2026-07-14T00:00:00.000Z' },
      },
      execution: { status: 'stopped', updatedAt: '2026-07-14T00:00:00.000Z' },
      runtime: { status: 'unknown', updatedAt: '2026-07-14T00:00:00.000Z' },
    })

    upsertProjectStateDatabaseExecution(projectRoot, {
      status: 'running',
      mode: 'continuous',
      startedAt: '2026-07-14T00:03:00.000Z',
      updatedAt: '2026-07-14T00:03:00.000Z',
    })
    upsertProjectStateDatabaseRuntime(projectRoot, {
      status: 'healthy',
      health: 'ready',
      lastActivityAt: '2026-07-14T00:04:00.000Z',
      updatedAt: '2026-07-14T00:04:00.000Z',
    })
    replaceProjectStateDatabaseOwnerInputs(projectRoot, [{
      id: 'owner-1',
      status: 'waiting_for_owner',
      taskId: 'task-1',
      prompt: 'Which proof should run first?',
      updatedAt: '2026-07-14T00:05:00.000Z',
      payload: { target: { href: '/thread?owner=owner-1' } },
    }, {
      id: 'owner-answered',
      status: 'coordinator_review',
      taskId: 'task-answered',
      prompt: 'This answer is already with Guildhall.',
      updatedAt: '2026-07-14T00:06:00.000Z',
      payload: { target: { href: '/thread?owner=owner-answered' } },
    }])

    expect(readProjectStateDatabaseSummary(tasksPath)).toMatchObject({
      payload: {
        execution: { status: 'running', mode: 'continuous', startedAt: '2026-07-14T00:03:00.000Z' },
        runtime: { status: 'healthy', health: 'ready', lastActivityAt: '2026-07-14T00:04:00.000Z' },
        ownerInput: {
          openCount: 1,
          next: { id: 'owner-1', taskId: 'task-1', prompt: 'Which proof should run first?', href: '/thread?owner=owner-1' },
        },
      },
    })

    const database = new DatabaseSync(projectStateDatabasePath(projectRoot), { readOnly: true })
    const row = database.prepare('SELECT payload_json FROM project_summary WHERE id = 1').get() as { payload_json: string }
    const stored = JSON.parse(row.payload_json) as Record<string, unknown>
    expect(stored).not.toHaveProperty('execution')
    expect(stored).not.toHaveProperty('runtime')
    // The normalized owner-input queue now owns this fact. The summary keeps
    // only compact facts that are not already represented by a current table.
    expect(stored).not.toHaveProperty('ownerInput')

    const ownerRow = database.prepare('SELECT payload_json FROM owner_inputs WHERE id = ?').get('owner-1') as { payload_json: string }
    expect(JSON.parse(ownerRow.payload_json)).toEqual({ target: { href: '/thread?owner=owner-1' } })
    database.close()
  })

  it('stores imported planning separately from the compact summary payload', async () => {
    const approvedPlan = {
      source: 'workspace_import',
      recordedAt: '2026-07-14T00:00:00.000Z',
      currentTaskIds: ['task-1'],
      laterTaskIds: [],
    }
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: { tasks: [{ id: 'task-1', title: 'One', status: 'ready' }] },
      summary: {
        generatedAt: '2026-07-14T00:00:00.000Z',
        freshness: 'current',
        approvedPlan,
      },
    })

    const database = new DatabaseSync(projectStateDatabasePath(projectRoot), { readOnly: true })
    const stored = database.prepare('SELECT payload_json FROM project_summary WHERE id = 1').get() as { payload_json: string }
    expect(JSON.parse(stored.payload_json)).not.toHaveProperty('approvedPlan')
    expect(database.prepare('SELECT COUNT(*) AS count FROM project_plan').get()).toMatchObject({ count: 1 })
    database.close()

    expect(readProjectStateDatabaseSummary(tasksPath)?.payload).toMatchObject({ approvedPlan })
    expect(readProjectStateDatabaseSummary(tasksPath, { includeApprovedPlan: false })?.payload)
      .not.toHaveProperty('approvedPlan')
  })

  it('fails closed when a promoted project loses its revision-matched detail store', async () => {
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: {
        tasks: [{ id: 'task-1', title: 'Rich task', spec: 'Do not replace this with an index row.' }],
        releases: [{ id: 'release-1', label: 'Release 1', nodeIds: ['task-1'] }],
      },
      summary: { generatedAt: '2026-07-14T00:00:00.000Z', freshness: 'current' },
    })
    promoteProjectStateDatabaseAuthority(projectRoot)
    await fs.rm(projectStateDatabaseCompressedDetailPathFromTasksPath(tasksPath), { force: true })
    const database = new DatabaseSync(projectStateDatabasePath(projectRoot))
    database.exec('DELETE FROM work_item_detail; DELETE FROM queue_detail WHERE id = 1')
    database.close()

    expect(readProjectStateDatabaseQueueDefinition(tasksPath)).toBeNull()
    expect(() => readProjectTaskQueueSync(tasksPath)).toThrow(/Current project-state detail store is unavailable/)
  })

  it('keeps task evidence history bounded and idempotent in SQLite', () => {
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: { tasks: [{ id: 'task-1', title: 'One', status: 'ready' }] },
      summary: { generatedAt: '2026-07-14T00:00:00.000Z', freshness: 'current' },
    })

    for (let index = 0; index < 4; index += 1) {
      appendProjectStateDatabaseTaskEvidence(projectRoot, {
        id: `note-${index}`,
        taskId: 'task-1',
        kind: 'note',
        recordedAt: `2026-07-14T00:0${index}:00.000Z`,
        payload: { content: `Essential note ${index}` },
      }, { maxRecords: 2, maxBytes: 10_000 })
    }
    appendProjectStateDatabaseTaskEvidence(projectRoot, {
      id: 'note-3',
      taskId: 'task-1',
      kind: 'note',
      recordedAt: '2026-07-14T00:03:00.000Z',
      payload: { content: 'Essential note 3 updated' },
    }, { maxRecords: 2, maxBytes: 10_000 })

    expect(readProjectStateDatabaseTaskEvidenceHistory(projectRoot, 'task-1', 'note')).toMatchObject([
      { id: 'note-2', payload: { content: 'Essential note 2' } },
      { id: 'note-3', payload: { content: 'Essential note 3 updated' } },
    ])
    expect(readProjectStateDatabaseSummary(tasksPath)?.freshness).toBe('stale')
  })

  it('caps oversized retention requests and ordinary history reads', () => {
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: { tasks: [{ id: 'task-1', title: 'One', status: 'ready' }] },
      summary: { generatedAt: '2026-07-14T00:00:00.000Z', freshness: 'current' },
    })

    const database = new DatabaseSync(projectStateDatabasePath(projectRoot))
    const insert = database.prepare(`
      INSERT INTO task_evidence_history (task_id, kind, evidence_id, recorded_at, payload_json)
      VALUES (?, ?, ?, ?, ?)
    `)
    for (let index = 0; index < 100; index += 1) {
      insert.run(
        'task-1',
        'note',
        `legacy-${index}`,
        `2026-07-14T00:${String(index).padStart(2, '0')}:00.000Z`,
        JSON.stringify({ content: `legacy note ${index}` }),
      )
    }
    database.close()

    expect(readProjectStateDatabaseTaskEvidenceHistory(projectRoot, 'task-1', 'note')).toHaveLength(64)

    appendProjectStateDatabaseTaskEvidence(projectRoot, {
      id: 'note-newest',
      taskId: 'task-1',
      kind: 'note',
      recordedAt: '2026-07-15T00:00:00.000Z',
      payload: { content: 'newest' },
    }, { maxRecords: 10_000, maxBytes: 10_000_000 })

    const bounded = new DatabaseSync(projectStateDatabasePath(projectRoot), { readOnly: true })
    expect(bounded.prepare('SELECT COUNT(*) AS count FROM task_evidence_history WHERE task_id = ? AND kind = ?').get('task-1', 'note'))
      .toMatchObject({ count: 64 })
    bounded.close()
  })

  it('reads current evidence for a task batch through one bounded projection query', () => {
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: { tasks: [{ id: 'task-1', title: 'One', status: 'ready' }, { id: 'task-2', title: 'Two', status: 'ready' }] },
      summary: { generatedAt: '2026-07-14T00:00:00.000Z', freshness: 'current' },
    })
    upsertProjectStateDatabaseTaskProof(projectRoot, {
      taskId: 'task-1',
      kind: 'note',
      recordedAt: '2026-07-14T00:01:00.000Z',
      payload: { content: 'One' },
    })
    upsertProjectStateDatabaseTaskProof(projectRoot, {
      taskId: 'task-2',
      kind: 'note',
      recordedAt: '2026-07-14T00:02:00.000Z',
      payload: { content: 'Two' },
    })

    const current = readProjectStateDatabaseTaskEvidenceCurrentMany(projectRoot, ['task-1', 'task-2', 'missing'])

    expect(current?.size).toBe(2)
    expect(current?.get('task-1')?.byKind.note?.[0]?.payload).toEqual({ content: 'One' })
    expect(current?.get('task-2')?.byKind.note?.[0]?.payload).toEqual({ content: 'Two' })
  })

  it('keeps the latest compact note for each operational source', () => {
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: { tasks: [{ id: 'task-1', title: 'One', status: 'review' }] },
      summary: { generatedAt: '2026-07-14T00:00:00.000Z', freshness: 'current' },
    })
    for (const [agentId, role, minute] of [
      ['worker-agent', 'worker', '01'],
      ['reviewer-agent', 'reviewer', '02'],
      ['coordinator', 'review-reconciliation', '03'],
    ] as const) {
      upsertProjectStateDatabaseTaskProof(projectRoot, {
        taskId: 'task-1',
        kind: 'note',
        recordedAt: `2026-07-14T00:${minute}:00.000Z`,
        payload: { agentId, role, content: `${role} decision` },
      })
    }

    const current = readProjectStateDatabaseTaskEvidenceCurrent(projectRoot, 'task-1')
    expect(current?.byKind.note?.map(note => note.payload.role)).toEqual([
      'review-reconciliation',
      'reviewer',
      'worker',
    ])
  })

  it('collapses oversized current evidence without touching the historical source', () => {
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: { tasks: [{ id: 'task-1', title: 'One', status: 'ready' }] },
      summary: { generatedAt: '2026-07-14T00:00:00.000Z', freshness: 'current' },
    })
    const database = new DatabaseSync(projectStateDatabasePath(projectRoot))
    const records = Array.from({ length: 16 }, (_, index) => ({
      id: `esc-${index}`,
      recordedAt: `2026-07-14T00:${String(index).padStart(2, '0')}:00.000Z`,
      payload: {
        id: `esc-${index}`,
        reason: 'spec_ambiguous',
        summary: 'A current summary',
        details: 'historical diagnostic detail '.repeat(300),
      },
    }))
    database.prepare('INSERT INTO task_evidence_current (task_id, updated_at, payload_json) VALUES (?, ?, ?)').run(
      'task-1',
      '2026-07-14T00:16:00.000Z',
      JSON.stringify({ taskId: 'task-1', updatedAt: '2026-07-14T00:16:00.000Z', version: 1, byKind: { escalation: records } }),
    )
    database.close()

    const result = compactProjectStateDatabaseEvidence(projectRoot)
    const current = readProjectStateDatabaseTaskEvidenceCurrent(projectRoot, 'task-1')

    expect(result.currentRowsCompacted).toBe(1)
    expect(current?.byKind.escalation?.length ?? 0).toBeLessThanOrEqual(8)
    expect(JSON.stringify(current)).not.toContain('historical diagnostic detail')
    expect(JSON.stringify(current).length).toBeLessThan(12 * 1024)
  })

  it('keeps the newest recorded proof when historical evidence is backfilled out of order', () => {
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: { tasks: [{ id: 'task-1', title: 'One', status: 'ready' }] },
      summary: { generatedAt: '2026-07-14T00:00:00.000Z', freshness: 'current' },
    })
    upsertProjectStateDatabaseTaskProof(projectRoot, {
      taskId: 'task-1', kind: 'gate_result', recordedAt: '2026-07-14T00:02:00.000Z', payload: { passed: true },
    })
    upsertProjectStateDatabaseTaskProof(projectRoot, {
      taskId: 'task-1', kind: 'note', recordedAt: '2026-07-14T00:01:00.000Z', payload: { content: 'Older' },
    })

    expect(readProjectStateDatabaseTaskOverlay(projectRoot, 'task-1')?.latestProof).toMatchObject({
      kind: 'gate_result',
      recordedAt: '2026-07-14T00:02:00.000Z',
      payload: { passed: true },
    })
  })

  it('removes only orphaned current overlays when the queue replaces a task', () => {
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: { tasks: [{ id: 'task-current', title: 'Current', status: 'ready' }, { id: 'task-removed', title: 'Removed', status: 'ready' }] },
      summary: { generatedAt: '2026-07-14T00:00:00.000Z', freshness: 'current' },
    })
    upsertProjectStateDatabaseTaskRuntime(projectRoot, {
      taskId: 'task-removed', updatedAt: '2026-07-14T00:01:00.000Z', payload: { taskId: 'task-removed' },
    })
    upsertProjectStateDatabaseTaskProof(projectRoot, {
      taskId: 'task-removed', kind: 'note', recordedAt: '2026-07-14T00:01:00.000Z', payload: { content: 'Historical detail is elsewhere.' },
    })

    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: { tasks: [{ id: 'task-current', title: 'Current', status: 'ready' }] },
      summary: { generatedAt: '2026-07-14T00:02:00.000Z', freshness: 'current' },
    })

    expect(readProjectStateDatabaseTaskOverlay(projectRoot, 'task-removed')).toEqual({})
  })

  it('commits a runtime store batch under one project revision', () => {
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: { tasks: [{ id: 'task-1', title: 'One', status: 'ready' }, { id: 'task-2', title: 'Two', status: 'ready' }] },
      summary: { generatedAt: '2026-07-14T00:00:00.000Z', freshness: 'current' },
    })
    const before = readProjectStateDatabaseMetadata(projectRoot)

    upsertProjectStateDatabaseTaskRuntimes(projectRoot, [
      { taskId: 'task-1', updatedAt: '2026-07-14T00:01:00.000Z', payload: { taskId: 'task-1' } },
      { taskId: 'task-2', updatedAt: '2026-07-14T00:02:00.000Z', payload: { taskId: 'task-2' } },
    ])

    expect(readProjectStateDatabaseMetadata(projectRoot)?.revision).toBe((before?.revision ?? 0) + 1)
  })

  it('replaces current runtime and workspace overlays when state is cleared', () => {
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: { tasks: [{ id: 'task-1', title: 'One', status: 'ready' }, { id: 'task-2', title: 'Two', status: 'ready' }] },
      summary: { generatedAt: '2026-07-14T00:00:00.000Z', freshness: 'current' },
    })

    replaceProjectStateDatabaseTaskRuntimes(projectRoot, [
      { taskId: 'task-1', updatedAt: '2026-07-14T00:01:00.000Z', payload: { taskId: 'task-1', assignedTo: 'worker' } },
      { taskId: 'task-2', updatedAt: '2026-07-14T00:02:00.000Z', payload: { taskId: 'task-2', assignedTo: 'reviewer' } },
    ])
    replaceProjectStateDatabaseTaskWorkspaces(projectRoot, [
      { taskId: 'task-1', updatedAt: '2026-07-14T00:01:00.000Z', payload: { taskId: 'task-1', branchName: 'guildhall/task-1' } },
    ])

    replaceProjectStateDatabaseTaskRuntimes(projectRoot, [
      { taskId: 'task-1', updatedAt: '2026-07-14T00:03:00.000Z', payload: { taskId: 'task-1', assignedTo: null } },
    ])
    replaceProjectStateDatabaseTaskWorkspaces(projectRoot, [])

    expect(readProjectStateDatabaseTaskOverlay(projectRoot, 'task-1')).toMatchObject({
      runtime: { payload: { assignedTo: null } },
    })
    expect(readProjectStateDatabaseTaskOverlay(projectRoot, 'task-2')).toEqual({})
    expect(readProjectStateDatabaseTaskOverlay(projectRoot, 'task-1')?.workspace).toBeUndefined()
  })

  it('diffs overlay replacement so unchanged task payloads are not rewritten', () => {
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: { tasks: [{ id: 'task-1', title: 'One', status: 'ready' }, { id: 'task-2', title: 'Two', status: 'ready' }] },
      summary: { generatedAt: '2026-07-14T00:00:00.000Z', freshness: 'current' },
    })

    replaceProjectStateDatabaseTaskRuntimes(projectRoot, [
      { taskId: 'task-1', updatedAt: '2026-07-14T00:01:00.000Z', payload: { taskId: 'task-1', assignedTo: 'worker' } },
      { taskId: 'task-2', updatedAt: '2026-07-14T00:02:00.000Z', payload: { taskId: 'task-2', assignedTo: 'reviewer' } },
    ])
    const beforeDatabase = new DatabaseSync(projectStateDatabasePath(projectRoot), { readOnly: true })
    const beforeTaskTwo = beforeDatabase.prepare('SELECT updated_at, payload_json FROM task_execution WHERE task_id = ?').get('task-2')
    const beforeRevision = readProjectStateDatabaseMetadata(projectRoot)?.revision ?? 0
    beforeDatabase.close()

    replaceProjectStateDatabaseTaskRuntimes(projectRoot, [
      { taskId: 'task-1', updatedAt: '2026-07-14T00:03:00.000Z', payload: { taskId: 'task-1', assignedTo: 'reviewer' } },
      { taskId: 'task-2', updatedAt: '2026-07-14T00:02:00.000Z', payload: { taskId: 'task-2', assignedTo: 'reviewer' } },
    ])

    const afterDatabase = new DatabaseSync(projectStateDatabasePath(projectRoot), { readOnly: true })
    const afterTaskTwo = afterDatabase.prepare('SELECT updated_at, payload_json FROM task_execution WHERE task_id = ?').get('task-2')
    afterDatabase.close()

    expect(afterTaskTwo).toEqual(beforeTaskTwo)
    expect(readProjectStateDatabaseMetadata(projectRoot)?.revision).toBe(beforeRevision + 1)
  })

  it('returns a compact queue without materializing stored task definitions', () => {
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: {
        selectedReleaseId: 'release-1',
        releases: [{ id: 'release-1', label: 'Release 1', nodeIds: ['work:task-1'], deferredNodeIds: [] }],
        tasks: [{
          id: 'task-1',
          title: 'Compact task',
          description: 'Description survives as a compact field.',
          status: 'ready',
          releaseIds: ['release-1'],
          spec: 'A large definition that compact reads must not parse.',
        }],
      },
      summary: {
        generatedAt: '2026-07-14T00:00:00.000Z',
        freshness: 'current',
        releaseSummary: { release: { id: 'release-1' } },
      },
    })

    expect(readProjectStateDatabaseQueue(tasksPath)).toEqual({
      version: 1,
      selectedReleaseId: 'release-1',
      releases: [expect.objectContaining({ id: 'release-1', label: 'Release 1' })],
      tasks: [expect.objectContaining({
        id: 'task-1',
        title: 'Compact task',
        description: 'Description survives as a compact field.',
      })],
    })
    expect(readProjectStateDatabaseQueue(tasksPath)?.tasks[0]).not.toHaveProperty('spec')
    expect(readProjectStateDatabaseTask(tasksPath, 'task-1')?.definition).toHaveProperty('spec')
  })

  it('keeps queue detail current when dynamic execution state advances the project revision', () => {
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: {
        tasks: [{
          id: 'task-1',
          title: 'Detail remains addressable',
          status: 'ready',
          spec: 'Full detail is not part of the mutable current-state row.',
        }],
      },
      summary: { generatedAt: '2026-07-14T00:00:00.000Z', freshness: 'current' },
    })

    upsertProjectStateDatabaseTaskRuntime(projectRoot, {
      taskId: 'task-1',
      updatedAt: '2026-07-14T00:01:00.000Z',
      payload: { status: 'running' },
    })

    expect(readProjectStateDatabaseTask(tasksPath, 'task-1')?.definition).toMatchObject({
      spec: 'Full detail is not part of the mutable current-state row.',
    })
  })

  it('does not allocate for live-state reads and imports legacy records only through an explicit migration', async () => {
    const databasePath = projectStateDatabasePath(projectRoot)
    const attentionPath = getProjectSystemStatePath(projectRoot, 'attention.json')
    const reconciliationPath = getProjectSystemStatePath(projectRoot, 'reconciliations.json')
    const availabilityPath = path.join(path.dirname(path.dirname(tasksPath)), 'project-availability.json')
    await fs.writeFile(availabilityPath, JSON.stringify({ status: 'paused', pausedAt: '2026-07-14T00:00:00.000Z' }))
    await fs.writeFile(attentionPath, JSON.stringify({ records: [{ id: 'attention-1', status: 'open', updatedAt: '2026-07-14T00:00:00.000Z' }] }))
    await fs.writeFile(reconciliationPath, JSON.stringify({ records: [{ capabilityId: 'intake.v1', status: 'resolved', resolvedAt: '2026-07-14T00:00:00.000Z' }] }))

    // Historical files are migration inputs, not a normal-read fallback. A
    // project without a database has no current live-state answer yet.
    expect(readProjectStateDatabaseAvailability(projectRoot)).toBeNull()
    expect(readProjectStateDatabaseAttentionRecords(projectRoot)).toBeNull()
    expect(readProjectStateDatabaseReconciliations(projectRoot)).toBeNull()
    await expect(fs.stat(databasePath)).rejects.toMatchObject({ code: 'ENOENT' })

    expect(migrateLegacyProjectLiveState(projectRoot)).toEqual([
      'project-availability.json',
      'project-state/attention.json',
      'project-state/reconciliations.json',
    ])
    expect(readProjectStateDatabaseAvailability(projectRoot)).toMatchObject({ status: 'paused' })
    expect(readProjectStateDatabaseAttentionRecords(projectRoot)).toMatchObject([{ id: 'attention-1' }])
    expect(readProjectStateDatabaseReconciliations(projectRoot)).toMatchObject([{ capabilityId: 'intake.v1' }])
  })

  it('keeps reconciliation writes on the current source revision', async () => {
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: { tasks: [{ id: 'task-1', title: 'One', status: 'ready' }] },
      summary: { generatedAt: '2026-07-14T00:00:00.000Z', freshness: 'current' },
    })
    const initialRevision = readProjectStateDatabaseMetadata(projectRoot)?.revision ?? 0
    const events: Array<{ domains: readonly string[]; revision: number | null }> = []
    const unsubscribe = subscribeProjectSummaryInvalidations(event => {
      events.push({ domains: event.domains, revision: event.revision })
    })

    writeProjectStateDatabaseAvailability(projectRoot, {
      status: 'paused',
      pausedAt: '2026-07-14T00:01:00.000Z',
      resumedAt: null,
    }, '2026-07-14T00:01:00.000Z')
    await Promise.resolve()
    // Rebuild the summary between the two independent writes so the test
    // proves reconciliation can advance its watermark without invalidating
    // an otherwise-current summary.
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: { tasks: [{ id: 'task-1', title: 'One', status: 'ready' }] },
      summary: { generatedAt: '2026-07-14T00:01:30.000Z', freshness: 'current' },
    })
    const beforeReconciliationRevision = readProjectStateDatabaseMetadata(projectRoot)?.revision ?? 0
    upsertProjectStateDatabaseReconciliations(projectRoot, [{
      capabilityId: 'intake.v1',
      status: 'resolved',
      resolvedAt: '2026-07-14T00:02:00.000Z',
    }])
    await Promise.resolve()

    expect(readProjectStateDatabaseMetadata(projectRoot)?.revision).toBe(beforeReconciliationRevision)
    expect(readProjectStateDatabaseSummary(tasksPath)?.freshness).toBe('current')
    expect(events).toEqual([
      { domains: ['availability'], revision: initialRevision + 1 },
      { domains: ['reconciliation'], revision: beforeReconciliationRevision },
    ])
    unsubscribe()
  })

  it('replaces the compact owner-input queue instead of leaving closed rows behind', () => {
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: { tasks: [] },
      summary: { generatedAt: '2026-07-14T00:00:00.000Z', freshness: 'current' },
    })
    replaceProjectStateDatabaseOwnerInputs(projectRoot, [
      { id: 'owner-1', status: 'waiting_for_owner', prompt: 'One?', taskId: 'task-1', updatedAt: '2026-07-14T00:01:00.000Z', payload: { id: 'owner-1' } },
      { id: 'owner-2', status: 'coordinator_review', prompt: 'Two?', taskId: null, updatedAt: '2026-07-14T00:02:00.000Z', payload: { id: 'owner-2' } },
    ])

    replaceProjectStateDatabaseOwnerInputs(projectRoot, [
      { id: 'owner-2', status: 'coordinator_review', prompt: 'Two?', taskId: null, updatedAt: '2026-07-14T00:02:00.000Z', payload: { id: 'owner-2' } },
    ])

    const database = new DatabaseSync(projectStateDatabasePath(projectRoot), { readOnly: true })
    const rows = database.prepare('SELECT id, status FROM owner_inputs ORDER BY id').all() as Array<{ id: string; status: string }>
    database.close()
    expect(rows).toEqual([{ id: 'owner-2', status: 'coordinator_review' }])
  })

  it('publishes attention replacement without advancing the source revision', async () => {
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: { tasks: [] },
      summary: { generatedAt: '2026-07-14T00:00:00.000Z', freshness: 'current' },
    })
    const initialRevision = readProjectStateDatabaseMetadata(projectRoot)?.revision ?? 0
    const events: Array<{ domains: readonly string[]; revision: number | null }> = []
    const unsubscribe = subscribeProjectSummaryInvalidations(event => {
      events.push({ domains: event.domains, revision: event.revision })
    })
    const record = { id: 'attention-1', status: 'open', updatedAt: '2026-07-14T00:01:00.000Z', title: 'Review', kind: 'project_understanding' }
    replaceProjectStateDatabaseAttentionRecords(projectRoot, [record])
    replaceProjectStateDatabaseAttentionRecords(projectRoot, [record])
    await Promise.resolve()
    expect(events).toEqual([{ domains: ['attention'], revision: initialRevision }])
    expect(readProjectStateDatabaseMetadata(projectRoot)?.revision).toBe(initialRevision)
    expect(readProjectStateDatabaseProjectionWatermark(projectRoot, 'attention')).toMatchObject({
      domain: 'attention',
      sourceRevision: readProjectStateDatabaseMetadata(projectRoot)?.revision,
    })
    expect(readProjectStateDatabaseSummary(tasksPath)?.freshness).toBe('current')
    unsubscribe()
  })
})
