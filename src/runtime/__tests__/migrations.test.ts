import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { parse as parseYaml } from 'yaml'
import { FileBackedGuildhallPersistence } from '@guildhall/persistence'
import { getProjectLocalHistoryDir, getProjectRuntimeCommandEvidencePath, getProjectSystemStatePath, projectStateDatabaseCompressedDetailPathFromTasksPath, projectStateDatabaseDetailPathFromTasksPath, projectStateDatabasePath, promoteProjectStateDatabaseAuthority, readProjectStateDatabaseMetadata, readProjectStateDatabaseQueueDefinition, readProjectStateDatabaseQueueRevision, readProjectStateDatabaseSummary, readProjectStateDatabaseTaskOverlay, readProjectStateDatabaseTaskEvidenceAuthority, readProjectStateDatabaseTaskEvidenceCurrent, readProjectStateDatabaseTaskEvidenceHistory, readProjectStateDatabaseTaskPoint, writeProjectStateDatabaseSnapshot, PROJECT_STATE_DATABASE_SCHEMA_VERSION } from '@guildhall/sessions'
import {
  applyProjectMigrations,
  getProjectMigrationStatus,
  readProjectMigrationLedger,
  writeProjectMigrationLedger,
} from '../migrations.js'
import { createOwnerInputRequest } from '../owner-input-store.js'
import { readProjectSummaryProjection, writeProjectSummaryProjectionFromIndexedState } from '../project-summary-projection.js'
import { projectTaskStateExistsSync, readProjectTaskQueueSync, writeProjectTaskQueueWithSummary } from '../project-state-boundary.js'
import { appendTaskEvidence, compressedTaskEvidencePath, readTaskEvidence, readTaskRuntimeStore, runtimeStatePath, taskEvidencePath, upsertTaskRuntimeState, upsertTaskWorkspaceState } from '../task-state-store.js'

let tmp: string
let projectRoot: string
let previousConfigDir: string | undefined
let previousDataDir: string | undefined

beforeEach(async () => {
  previousConfigDir = process.env.GUILDHALL_CONFIG_DIR
  previousDataDir = process.env.GUILDHALL_DATA_DIR
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-migrations-'))
  process.env.GUILDHALL_CONFIG_DIR = path.join(tmp, 'config')
  process.env.GUILDHALL_DATA_DIR = path.join(tmp, 'data')
  projectRoot = path.join(tmp, 'project')
  await fs.mkdir(projectRoot, { recursive: true })
  await fs.writeFile(path.join(projectRoot, 'guildhall.yaml'), 'name: Migration Test\nid: migration-test\n', 'utf8')
})

afterEach(async () => {
  if (previousConfigDir === undefined) delete process.env.GUILDHALL_CONFIG_DIR
  else process.env.GUILDHALL_CONFIG_DIR = previousConfigDir
  if (previousDataDir === undefined) delete process.env.GUILDHALL_DATA_DIR
  else process.env.GUILDHALL_DATA_DIR = previousDataDir
  await fs.rm(tmp, { recursive: true, force: true })
})

describe('project migration ledger', () => {
  it('starts empty and round-trips applied migration records', async () => {
    expect(await readProjectMigrationLedger(projectRoot)).toEqual({ version: 1, records: [] })

    await writeProjectMigrationLedger(projectRoot, {
      version: 1,
      records: [{
        id: '0.8.0/example',
        introducedIn: '0.8.0',
        scope: 'project',
        safety: 'automatic',
        status: 'applied',
        appliedAt: '2026-05-26T00:00:00.000Z',
        appliedByVersion: '0.8.0',
        summary: 'Example migration applied.',
      }],
    })

    expect(await readProjectMigrationLedger(projectRoot)).toMatchObject({
      version: 1,
      records: [{ id: '0.8.0/example', status: 'applied' }],
    })
    await expect(fs.access(path.join(projectRoot, '.guildhall', 'migrations.json'))).rejects.toThrow()
    await expect(fs.access(path.join(getProjectLocalHistoryDir(projectRoot), 'migrations', 'migrations.json'))).resolves.toBeUndefined()
  })
})

describe('getProjectMigrationStatus', () => {
  it('does not re-block an applied scope migration for valid non-task release nodes', async () => {
    const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
    const now = '2026-07-15T12:00:00.000Z'
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: {
        version: 1,
        lastUpdated: now,
        selectedReleaseId: 'release-current',
        releases: [{
          id: 'release-current',
          label: 'Current release',
          kind: 'release',
          state: 'active',
          nodeIds: ['capability:narrative-core', 'work:task-current'],
          deferredNodeIds: [],
        }],
        tasks: [{
          id: 'task-current',
          title: 'Current task',
          status: 'ready',
          releaseIds: ['release-current'],
        }],
      },
      summary: {
        projectId: 'migration-test',
        generatedAt: now,
        freshness: 'current',
      },
    })
    promoteProjectStateDatabaseAuthority(projectRoot)
    await writeProjectMigrationLedger(projectRoot, {
      version: 1,
      records: [{
        id: '0.12.36/project-summary-current-scope-authority',
        introducedIn: '0.12.36',
        scope: 'project',
        safety: 'automatic',
        status: 'applied',
        appliedAt: now,
        appliedByVersion: '0.12.36',
        summary: 'Current scope was reconciled.',
      }],
    })

    const status = await getProjectMigrationStatus({ projectRoot })
    expect(status.blocked.some(item => item.id === '0.12.36/project-summary-current-scope-authority')).toBe(false)
    expect(status.applied.some(item => item.id === '0.12.36/project-summary-current-scope-authority')).toBe(true)
  })

  it('reports pending built-in project migrations and hides applied ledger entries', async () => {
    await fs.mkdir(path.join(projectRoot, 'memory'), { recursive: true })
    await fs.writeFile(path.join(projectRoot, 'memory', 'MEMORY.md'), '# Legacy\n', 'utf8')
    await fs.writeFile(path.join(projectRoot, 'memory', 'artifacts.yaml'), [
      'version: 1',
      'artifacts:',
      '  - id: flow-audit',
      '    path: internal/audits/flow-audit.md',
      '',
    ].join('\n'), 'utf8')
    await fs.writeFile(path.join(projectRoot, 'memory', 'TASKS.json'), JSON.stringify({
      version: 1,
      tasks: [{
        id: 'task-current',
        title: 'Current work',
        description: 'Resume me.',
        domain: 'runtime',
        projectPath: projectRoot,
        status: 'ready',
        spec: 'Current thin state includes the resumable task.',
        acceptanceCriteria: [{ id: 'ac-1', description: 'Resume packet exists.', verifiedBy: 'review', met: false }],
        notes: [{ content: 'old audit note should not export' }],
      }],
    }, null, 2), 'utf8')

    const before = await getProjectMigrationStatus({ projectRoot })
    expect(before.blocked.some(item => item.id === '0.8.0/project-state-layout')).toBe(true)

    await writeProjectMigrationLedger(projectRoot, {
      version: 1,
      records: [{
        id: '0.8.0/project-state-layout',
        introducedIn: '0.8.0',
        scope: 'project',
        safety: 'prompt',
        status: 'applied',
        appliedAt: '2026-05-26T00:00:00.000Z',
        appliedByVersion: '0.8.0',
        summary: 'Moved legacy memory into split project state.',
      }],
    })

    const after = await getProjectMigrationStatus({ projectRoot })
    expect(after.blocked.some(item => item.id === '0.8.0/project-state-layout')).toBe(false)
    expect(after.applied.some(item => item.id === '0.8.0/project-state-layout')).toBe(true)
  })

  it('reports legacy split recommendation migration as required when task state needs action audit', async () => {
    const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
    await fs.mkdir(path.dirname(tasksPath), { recursive: true })
    await fs.writeFile(tasksPath, JSON.stringify({
      version: 1,
      lastUpdated: '2026-06-17T00:00:00.000Z',
      tasks: [{
        id: 'parent',
        title: 'Parent',
        sizePlan: {
          action: 'split_recommended',
          recommendedChildren: [{ title: 'Child A', reason: 'Legacy child.' }],
        },
      }],
    }, null, 2), 'utf8')

    const status = await getProjectMigrationStatus({ projectRoot })
    expect(status.blocked).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: '0.11.0/execution-planning-decomposition',
        requirement: 'required',
      }),
    ]))
  })
})

describe('applyProjectMigrations', () => {
  it('backfills the revisioned current-state database from a legacy summary', async () => {
    const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
    const summaryPath = getProjectSystemStatePath(projectRoot, 'project-summary.json')
    await fs.mkdir(path.dirname(tasksPath), { recursive: true })
    await fs.writeFile(tasksPath, JSON.stringify({
      version: 1,
      lastUpdated: '2026-07-14T12:00:00.000Z',
      tasks: [{ id: 'task-db-migration', title: 'Database migration task', status: 'ready' }],
    }, null, 2), 'utf8')
    await fs.writeFile(summaryPath, JSON.stringify({ version: 3, freshness: 'current' }), 'utf8')

    const before = await getProjectMigrationStatus({ projectRoot })
    expect([...before.pending, ...before.blocked].some(item => item.id === '0.12.0/project-state-database')).toBe(true)

    const result = await applyProjectMigrations({
      projectRoot,
      only: ['0.12.0/project-state-database'],
    })
    expect(result.applied.map(item => item.id)).toContain('0.12.0/project-state-database')
    expect(readProjectStateDatabaseMetadata(projectRoot)).toMatchObject({ schemaVersion: PROJECT_STATE_DATABASE_SCHEMA_VERSION })
    await expect(fs.access(projectStateDatabasePath(projectRoot))).resolves.toBeUndefined()
  })

  it('normalizes release membership into one relation before ordinary reads use it', async () => {
    const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
    const now = '2026-07-16T12:00:00.000Z'
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: {
        version: 1,
        lastUpdated: now,
        selectedReleaseId: 'release-one',
        releases: [{
          id: 'release-one',
          label: 'Release One',
          kind: 'release',
          state: 'active',
          source: 'owner_approved',
          nodeIds: ['work:task-current'],
          deferredNodeIds: ['work:task-later'],
        }],
        tasks: [
          { id: 'task-current', title: 'Current', status: 'ready', releaseIds: ['release-one'] },
          { id: 'task-later', title: 'Later', status: 'shelved', releaseIds: [] },
        ],
      },
      summary: { version: 12, freshness: 'current' },
      scopeRows: [],
      projectRoot,
    })
    promoteProjectStateDatabaseAuthority(projectRoot)
    const database = new DatabaseSync(projectStateDatabasePath(projectRoot))
    database.prepare('DELETE FROM release_membership').run()
    // Recreate the old pre-normalization mirrors so this test exercises the
    // migration input shape rather than asking a normalized write to retain
    // data that the new model intentionally no longer duplicates.
    database.prepare('UPDATE work_items SET release_ids_json = ? WHERE id = ?').run('["release-one"]', 'task-current')
    database.prepare('UPDATE work_items SET release_ids_json = ? WHERE id = ?').run('["release-one"]', 'task-later')
    database.prepare('UPDATE scopes SET node_ids_json = ?, deferred_node_ids_json = ?, definition_json = ? WHERE id = ?')
      .run('["work:task-current"]', '["work:task-later"]', JSON.stringify({
        id: 'release-one',
        label: 'Release One',
        kind: 'release',
        state: 'active',
        source: 'owner_approved',
        nodeIds: ['work:task-current'],
        deferredNodeIds: ['work:task-later'],
      }), 'release-one')
    database.close()
    expect(readProjectStateDatabaseQueueDefinition(tasksPath)).toMatchObject({
      releases: [{ id: 'release-one', nodeIds: [], deferredNodeIds: [] }],
      tasks: [
        { id: 'task-current', releaseIds: [] },
        { id: 'task-later', releaseIds: [] },
      ],
    })

    const result = await applyProjectMigrations({
      projectRoot,
      only: ['0.13.1/release-membership'],
    })
    expect(result.applied.map(item => item.id)).toEqual(['0.13.1/release-membership'])
    const migrated = new DatabaseSync(projectStateDatabasePath(projectRoot))
    expect(migrated.prepare('SELECT release_id, task_id, disposition FROM release_membership ORDER BY task_id').all()).toEqual([
      { release_id: 'release-one', task_id: 'task-current', disposition: 'included' },
      { release_id: 'release-one', task_id: 'task-later', disposition: 'deferred' },
    ])
    migrated.close()
  })

  it('does not erase normalized membership when compatibility mirrors are empty', async () => {
    const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: {
        version: 1,
        lastUpdated: '2026-07-16T12:00:00.000Z',
        selectedReleaseId: 'release-one',
        releases: [{
          id: 'release-one',
          label: 'Release One',
          kind: 'release',
          state: 'active',
          source: 'owner_approved',
          nodeIds: ['work:task-current'],
          deferredNodeIds: [],
        }],
        tasks: [{ id: 'task-current', title: 'Current', status: 'ready', releaseIds: ['release-one'] }],
      },
      summary: { version: 12, freshness: 'current' },
      scopeRows: [],
      projectRoot,
    })
    promoteProjectStateDatabaseAuthority(projectRoot)

    const result = await applyProjectMigrations({
      projectRoot,
      only: ['0.13.1/release-membership'],
    })
    expect(result.failed).toEqual([])
    const migrated = new DatabaseSync(projectStateDatabasePath(projectRoot))
    expect(migrated.prepare('SELECT release_id, task_id, disposition FROM release_membership').all()).toEqual([
      { release_id: 'release-one', task_id: 'task-current', disposition: 'included' },
    ])
    migrated.close()
  })

  it('does not reopen retired current-overlay migrations after the database exists', async () => {
    const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
    await fs.mkdir(path.dirname(tasksPath), { recursive: true })
    await fs.writeFile(tasksPath, JSON.stringify({
      version: 1,
      lastUpdated: '2026-07-14T12:00:00.000Z',
      tasks: [{ id: 'task-overlay', title: 'Current overlay task', status: 'ready' }],
    }, null, 2), 'utf8')
    await upsertTaskRuntimeState(projectRoot, 'task-overlay', {
      assignedTo: 'worker-agent', revisionCount: 3, updatedAt: '2026-07-14T12:01:00.000Z',
    })
    await upsertTaskWorkspaceState(projectRoot, 'task-overlay', {
      branchName: 'guildhall/task-task-overlay', updatedAt: '2026-07-14T12:01:00.000Z',
    })
    await appendTaskEvidence(projectRoot, 'task-overlay', {
      id: 'note-overlay', kind: 'note', recordedAt: '2026-07-14T12:02:00.000Z', payload: { content: 'Keep this history.' },
    })
    const evidencePath = path.join(getProjectLocalHistoryDir(projectRoot), 'tasks', 'task-overlay', 'notes.jsonl')
    const beforeEvidence = await fs.readFile(evidencePath, 'utf8')

    await applyProjectMigrations({ projectRoot, only: ['0.12.0/project-state-database'] })
    const result = await applyProjectMigrations({ projectRoot, only: ['0.12.14/task-current-overlay'] })

    expect(result.applied.map(item => item.id)).toEqual([])
    expect(readProjectStateDatabaseTaskOverlay(projectRoot, 'task-overlay')).toMatchObject({
      runtime: { payload: { assignedTo: 'worker-agent', revisionCount: 3 } },
      workspace: { payload: { branchName: 'guildhall/task-task-overlay' } },
      latestProof: { kind: 'note', payload: { content: 'Keep this history.' } },
    })
    expect(await fs.readFile(evidencePath, 'utf8')).toBe(beforeEvidence)
    expect((await applyProjectMigrations({ projectRoot, only: ['0.12.14/task-current-overlay'] })).applied).toEqual([])
    expect((await applyProjectMigrations({ projectRoot, only: ['0.12.15/task-current-overlay-reconcile'] })).applied.map(item => item.id))
      .toEqual([])
    expect((await applyProjectMigrations({ projectRoot, only: ['0.12.15/task-current-overlay-reconcile'] })).applied).toEqual([])

    expect(readProjectStateDatabaseMetadata(projectRoot)?.projectStateAuthority).toBe('legacy')
  })

  it('backfills the canonical action model from indexed state after compatibility and aggregate files are gone', async () => {
    const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
    await fs.mkdir(path.dirname(tasksPath), { recursive: true })
    await fs.writeFile(tasksPath, JSON.stringify({
      version: 1,
      lastUpdated: '2026-07-14T12:00:00.000Z',
      tasks: [{
        id: 'task-action-model',
        title: 'Action model task',
        status: 'ready',
        createdAt: '2026-07-14T12:00:00.000Z',
        updatedAt: '2026-07-14T12:00:00.000Z',
      }],
    }), 'utf8')
    await fs.writeFile(getProjectSystemStatePath(projectRoot, 'project-summary.json'), JSON.stringify({ version: 3, freshness: 'current' }), 'utf8')

    await applyProjectMigrations({ projectRoot, only: ['0.12.0/project-state-database'] })
    await applyProjectMigrations({ projectRoot, only: ['0.12.21/task-overlay-authority'] })

    const database = new DatabaseSync(projectStateDatabasePath(projectRoot))
    const row = database.prepare('SELECT payload_json FROM project_summary WHERE id = 1').get() as { payload_json: string }
    const summary = JSON.parse(row.payload_json) as Record<string, unknown>
    summary.version = 11
    delete summary.actionModel
    database.prepare('UPDATE project_summary SET payload_json = ? WHERE id = 1').run(JSON.stringify(summary))
    database.close()

    await applyProjectMigrations({ projectRoot, only: ['0.12.23/project-state-single-authority'] })
    await fs.rm(projectStateDatabaseDetailPathFromTasksPath(tasksPath), { force: true })
    await fs.rm(projectStateDatabaseCompressedDetailPathFromTasksPath(tasksPath), { force: true })
    const result = await applyProjectMigrations({
      projectRoot,
      only: ['0.12.24/project-summary-action-model'],
    })

    expect(result.failed).toEqual([])
    expect(result.applied.map(item => item.id)).toEqual(['0.12.24/project-summary-action-model'])
    expect(readProjectSummaryProjection(tasksPath)).toMatchObject({
      version: 12,
      freshness: 'current',
      actionModel: { runControl: expect.any(Object) },
    })
    await expect(fs.access(tasksPath)).rejects.toThrow()
    await expect(fs.access(getProjectSystemStatePath(projectRoot, 'project-summary.json'))).rejects.toThrow()
    await expect(fs.access(projectStateDatabaseDetailPathFromTasksPath(tasksPath))).rejects.toThrow()
    await expect(fs.access(projectStateDatabaseCompressedDetailPathFromTasksPath(tasksPath))).rejects.toThrow()
    expect((await applyProjectMigrations({
      projectRoot,
      only: ['0.12.24/project-summary-action-model'],
    })).applied).toEqual([])
  })

  it('runs the current-evidence backfill after an earlier migration has already advanced the database schema', async () => {
    const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
    await fs.mkdir(path.dirname(tasksPath), { recursive: true })
    await fs.writeFile(tasksPath, JSON.stringify({
      version: 1,
      lastUpdated: '2026-07-14T12:00:00.000Z',
      tasks: [{ id: 'task-evidence-current', title: 'Evidence projection task', status: 'ready' }],
    }, null, 2), 'utf8')
    await fs.writeFile(getProjectSystemStatePath(projectRoot, 'project-summary.json'), JSON.stringify({ version: 3, freshness: 'current' }), 'utf8')
    const evidencePath = path.join(
      getProjectLocalHistoryDir(projectRoot),
      'tasks',
      'task-evidence-current',
      'notes.jsonl',
    )
    await fs.mkdir(path.dirname(evidencePath), { recursive: true })
    await fs.writeFile(evidencePath, `${JSON.stringify({
      id: 'note-current',
      taskId: 'task-evidence-current',
      kind: 'note',
      recordedAt: '2026-07-14T12:02:00.000Z',
      payload: { content: 'Keep this as the compact current record.' },
    })}\n`, 'utf8')

    await applyProjectMigrations({ projectRoot, only: ['0.12.0/project-state-database'] })
    expect(readProjectStateDatabaseMetadata(projectRoot)?.schemaVersion).toBe(PROJECT_STATE_DATABASE_SCHEMA_VERSION)
    expect(readProjectStateDatabaseTaskEvidenceCurrent(projectRoot, 'task-evidence-current')).toBeNull()

    const result = await applyProjectMigrations({ projectRoot, only: ['0.12.31/task-evidence-current-projection'] })

    expect(result.applied.map(item => item.id)).toEqual(['0.12.31/task-evidence-current-projection'])
    expect(readProjectStateDatabaseTaskEvidenceCurrent(projectRoot, 'task-evidence-current')).toMatchObject({
      taskId: 'task-evidence-current',
      byKind: {
        note: [{ id: 'note:unattributed', payload: { content: 'Keep this as the compact current record.' } }],
      },
    })
    expect((await applyProjectMigrations({ projectRoot, only: ['0.12.31/task-evidence-current-projection'] })).applied).toEqual([])
  })

  it('realigns promoted summary and scope from current evidence without reading compatibility files', async () => {
    const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
    const now = '2026-07-15T12:00:00.000Z'
    const completedAt = '2026-07-15T11:59:00.000Z'
    const task = {
      id: 'task-effective-done',
      title: 'Evidence-backed task',
      description: 'Its current evidence says the work is complete.',
      domain: 'runtime',
      projectPath: projectRoot,
      status: 'ready',
      priority: 'normal',
      references: [],
      sourceClaims: [],
      acceptanceCriteria: [],
      outOfScope: [],
      dependsOn: [],
      releaseIds: ['release-current'],
      notes: [],
      gateResults: [],
      reviewVerdicts: [],
      adjudications: [],
      escalations: [],
      agentIssues: [],
      createdAt: now,
      updatedAt: now,
      completedAt,
    }
    const queue = {
      version: 1,
      lastUpdated: now,
      selectedReleaseId: 'release-current',
      releases: [{
        id: 'release-current',
        label: 'Current release',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        nodeIds: ['work:task-effective-done'],
        deferredNodeIds: [],
      }],
      tasks: [task],
    }
    await fs.mkdir(path.dirname(tasksPath), { recursive: true })
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue,
      summary: { projectId: 'migration-test', generatedAt: now, freshness: 'current', version: 12 },
      scopeRows: [{
        taskId: 'task-effective-done',
        scope: 'included',
        eligibilityReason: 'included',
        hierarchyRole: 'root',
        handoffState: 'ready',
        blocksStart: false,
        blocksRelease: false,
        humanBlocking: false,
        proofBlocked: false,
        sourceRefs: [],
      }],
      projectRoot,
    })
    promoteProjectStateDatabaseAuthority(projectRoot)

    // A promoted migration must not parse or revive this compatibility file.
    await fs.writeFile(tasksPath, '{ this is intentionally not a queue }\n', 'utf8')
    writeProjectSummaryProjectionFromIndexedState(tasksPath, {
      projectId: 'migration-test',
      generatedAt: now,
      sourceQueueLastUpdated: now,
    })
    await appendTaskEvidence(projectRoot, 'task-effective-done', {
      id: 'gate-effective-done',
      kind: 'gate_result',
      recordedAt: completedAt,
      payload: { gateId: 'smoke-test', type: 'hard', passed: true, output: 'pnpm test passed', checkedAt: completedAt },
    })

    expect(readProjectSummaryProjection(tasksPath)).toMatchObject({
      freshness: 'stale',
      counts: { total: 1, done: 0 },
      releaseSummary: { counts: { total: 1, done: 0, unfinished: 1 } },
    })
    const before = await getProjectMigrationStatus({
      projectRoot,
      only: ['0.13.0/project-summary-effective-state-realignment'],
    })
    expect(before.blocked.map(item => item.id)).toEqual(['0.13.0/project-summary-effective-state-realignment'])

    const result = await applyProjectMigrations({
      projectRoot,
      only: ['0.13.0/project-summary-effective-state-realignment'],
    })

    expect(result.failed).toEqual([])
    expect(result.applied.map(item => item.id)).toEqual(['0.13.0/project-summary-effective-state-realignment'])
    expect(readProjectSummaryProjection(tasksPath)).toMatchObject({
      freshness: 'current',
      counts: { total: 1, done: 1 },
      scope: { included: 1, deferred: 0 },
      releaseSummary: {
        state: 'ready',
        counts: { total: 1, done: 1, unfinished: 0, deferred: 0 },
      },
    })
    const database = new DatabaseSync(projectStateDatabasePath(projectRoot), { readOnly: true })
    expect(database.prepare('SELECT status, completed_at FROM work_items WHERE id = ?').get('task-effective-done'))
      .toMatchObject({ status: 'done', completed_at: completedAt })
    expect(database.prepare('SELECT handoff_state, blocks_release FROM work_scope WHERE task_id = ?').get('task-effective-done'))
      .toMatchObject({ handoff_state: 'done', blocks_release: 0 })
    database.close()
    expect(await fs.readFile(tasksPath, 'utf8')).toBe('{ this is intentionally not a queue }\n')

    const second = await applyProjectMigrations({
      projectRoot,
      only: ['0.13.0/project-summary-effective-state-realignment'],
    })
    expect(second.applied).toEqual([])
    expect(second.failed).toEqual([])
  })

  it('materializes the shared current task status rule into indexed rows', async () => {
    const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
    const now = '2026-07-15T12:00:00.000Z'
    const completedAt = '2026-07-15T11:00:00.000Z'
    const task = {
      id: 'task-effective-done',
      title: 'Task with stale blocked status',
      status: 'ready',
      releaseIds: ['release-current'],
      completedAt,
      doneSummaryBundle: {
        taskId: 'task-effective-done',
        status: 'done',
        completedAt,
        summary: {
          journey: 'worker completed the task',
          decision: 'Task finished as done.',
          evidence: 'pnpm test passed.',
          learningCandidates: [],
          openResidue: 'No open residue recorded.',
        },
      },
    }
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: {
        version: 1,
        lastUpdated: now,
        selectedReleaseId: 'release-current',
        releases: [{
          id: 'release-current',
          label: 'Current release',
          kind: 'release',
          state: 'active',
          source: 'release_plan',
          nodeIds: ['work:task-effective-done'],
          deferredNodeIds: [],
        }],
        tasks: [task],
      },
      summary: { projectId: 'migration-test', generatedAt: now, freshness: 'current', version: 12 },
      scopeRows: [{
        taskId: task.id,
        scope: 'included',
        eligibilityReason: 'included',
        hierarchyRole: 'root',
        handoffState: 'ready',
        blocksStart: false,
        blocksRelease: false,
        humanBlocking: false,
        proofBlocked: false,
        sourceRefs: [],
      }],
      projectRoot,
    })
    promoteProjectStateDatabaseAuthority(projectRoot)

    const database = new DatabaseSync(projectStateDatabasePath(projectRoot))
    database.prepare('UPDATE work_items SET status = ?, completed_at = NULL WHERE id = ?').run('blocked', task.id)
    database.prepare('UPDATE work_scope SET handoff_state = ?, blocks_release = 1, human_blocking = 1 WHERE task_id = ?').run('blocked', task.id)
    database.close()
    writeProjectSummaryProjectionFromIndexedState(tasksPath, {
      projectId: 'migration-test',
      generatedAt: now,
      sourceQueueLastUpdated: now,
    })

    const result = await applyProjectMigrations({
      projectRoot,
      only: ['0.13.1/project-current-status-projection'],
    })

    expect(result.failed).toEqual([])
    expect(result.applied.map(item => item.id)).toEqual(['0.13.1/project-current-status-projection'])
    const repaired = new DatabaseSync(projectStateDatabasePath(projectRoot), { readOnly: true })
    expect(repaired.prepare('SELECT status, completed_at FROM work_items WHERE id = ?').get(task.id))
      .toMatchObject({ status: 'done', completed_at: completedAt })
    expect(repaired.prepare('SELECT handoff_state, blocks_release, human_blocking FROM work_scope WHERE task_id = ?').get(task.id))
      .toMatchObject({ handoff_state: 'done', blocks_release: 0, human_blocking: 0 })
    repaired.close()
  })

  it('treats the database as the restore target after compatibility TASKS is removed', async () => {
    const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
    await fs.mkdir(path.dirname(tasksPath), { recursive: true })
    await fs.writeFile(tasksPath, JSON.stringify({
      version: 1,
      lastUpdated: '2026-07-14T12:00:00.000Z',
      tasks: [{ id: 'task-existing', title: 'Existing task', status: 'ready' }],
    }, null, 2), 'utf8')

    await applyProjectMigrations({ projectRoot, only: ['0.12.0/project-state-database'] })
    await applyProjectMigrations({ projectRoot, only: ['0.12.21/task-overlay-authority'] })
    // The single-authority migration normally removes these compatibility
    // files. Remove them here directly so this test isolates restore behavior
    // from that migration's unrelated detection prerequisites.
    await fs.rm(tasksPath, { force: true })
    await fs.rm(getProjectSystemStatePath(projectRoot, 'project-summary.json'), { force: true })
    await expect(fs.access(tasksPath)).rejects.toThrow()

    const evacuatedTasksPath = path.join(getProjectLocalHistoryDir(projectRoot), 'project-state-evacuation', 'TASKS.json')
    await fs.mkdir(path.dirname(evacuatedTasksPath), { recursive: true })
    await fs.writeFile(evacuatedTasksPath, JSON.stringify({
      version: 1,
      tasks: [
        { id: 'task-existing', title: 'Existing task', status: 'ready' },
        { id: 'task-late-batch', title: 'Late evacuation batch', status: 'ready' },
      ],
    }, null, 2), 'utf8')

    const before = await getProjectMigrationStatus({
      projectRoot,
      only: ['0.10.0/restore-evacuated-task-state'],
    })
    expect(before.blocked.map(item => item.id)).toEqual(['0.10.0/restore-evacuated-task-state'])

    await applyProjectMigrations({
      projectRoot,
      only: ['0.10.0/restore-evacuated-task-state'],
    })

    expect(readProjectStateDatabaseQueueDefinition(tasksPath)?.tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'task-existing' }),
      expect.objectContaining({ id: 'task-late-batch' }),
    ]))
    const after = await getProjectMigrationStatus({
      projectRoot,
      only: ['0.10.0/restore-evacuated-task-state'],
    })
    expect(after.pending).toEqual([])
    expect(after.blocked).toEqual([])
    expect((await applyProjectMigrations({
      projectRoot,
      only: ['0.10.0/restore-evacuated-task-state'],
    })).applied).toEqual([])
  })

  it('upgrades an already-created project-state database to the read-safe journal mode', async () => {
    const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
    await fs.mkdir(path.dirname(tasksPath), { recursive: true })
    await fs.writeFile(tasksPath, JSON.stringify({
      version: 1,
      lastUpdated: '2026-07-14T12:00:00.000Z',
      tasks: [{ id: 'task-journal-migration', title: 'Journal migration task', status: 'ready' }],
    }), 'utf8')
    await fs.writeFile(getProjectSystemStatePath(projectRoot, 'project-summary.json'), JSON.stringify({ version: 3, freshness: 'current' }), 'utf8')
    await applyProjectMigrations({ projectRoot, only: ['0.12.0/project-state-database'] })
    const database = new DatabaseSync(projectStateDatabasePath(projectRoot))
    database.exec('PRAGMA journal_mode = WAL; UPDATE project_meta SET schema_version = 2;')
    database.close()

    const before = await getProjectMigrationStatus({ projectRoot })
    expect([...before.pending, ...before.blocked].some(item => item.id === '0.12.1/project-state-database-rollback-journal')).toBe(true)
    const result = await applyProjectMigrations({
      projectRoot,
      only: ['0.12.1/project-state-database-rollback-journal'],
    })

    expect(result.applied.map(item => item.id)).toContain('0.12.1/project-state-database-rollback-journal')
    expect(readProjectStateDatabaseMetadata(projectRoot)).toMatchObject({ schemaVersion: PROJECT_STATE_DATABASE_SCHEMA_VERSION })
    const migratedDatabase = new DatabaseSync(projectStateDatabasePath(projectRoot), { readOnly: true })
    expect((migratedDatabase.prepare('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode).toBe('delete')
    migratedDatabase.close()
    await expect(fs.access(`${projectStateDatabasePath(projectRoot)}-wal`)).rejects.toThrow()
    await expect(fs.access(`${projectStateDatabasePath(projectRoot)}-shm`)).rejects.toThrow()
  })

  it('moves bounded legacy task evidence through SQLite into a compact ledger', async () => {
    promoteProjectStateDatabaseAuthority(projectRoot)
    const evidencePath = taskEvidencePath(projectRoot, 'task-history', 'note')
    await fs.mkdir(path.dirname(evidencePath), { recursive: true })
    const records = Array.from({ length: 70 }, (_, index) => JSON.stringify({
      id: `note-${index}`,
      taskId: 'task-history',
      kind: 'note',
      recordedAt: new Date(Date.parse('2026-07-14T12:00:00.000Z') + index * 1000).toISOString(),
      payload: { content: `Essential history ${index}` },
    })).join('\n')
    await fs.writeFile(evidencePath, `${records}\n`, 'utf8')

    expect(readProjectStateDatabaseTaskEvidenceAuthority(projectRoot)).toBe('legacy')
    const result = await applyProjectMigrations({
      projectRoot,
      only: ['0.12.41/task-evidence-history-authority'],
    })

    expect(result.applied.map(item => item.id)).toEqual(['0.12.41/task-evidence-history-authority'])
    expect(readProjectStateDatabaseTaskEvidenceAuthority(projectRoot)).toBe('database')
    await expect(fs.access(evidencePath)).rejects.toThrow()
    const history = readProjectStateDatabaseTaskEvidenceHistory(projectRoot, 'task-history', 'note') ?? []
    expect(history[0]).toMatchObject({ id: 'note-6' })
    expect(history.at(-1)).toMatchObject({ id: 'note-69' })
    expect(history).toHaveLength(64)

    const compressed = await applyProjectMigrations({
      projectRoot,
      only: ['0.12.42/task-evidence-history-compression'],
    })
    expect(compressed.applied.map(item => item.id)).toEqual(['0.12.42/task-evidence-history-compression'])
    expect(readProjectStateDatabaseTaskEvidenceAuthority(projectRoot)).toBe('compressed')
    expect(readProjectStateDatabaseTaskEvidenceHistory(projectRoot, 'task-history', 'note')).toEqual([])
    await expect(fs.access(compressedTaskEvidencePath(projectRoot, 'task-history', 'note'))).resolves.toBeUndefined()
    await expect(readTaskEvidence(projectRoot, 'task-history', { kind: 'note' })).resolves.toHaveLength(64)

    const second = await applyProjectMigrations({
      projectRoot,
      only: ['0.12.42/task-evidence-history-compression'],
    })
    expect(second.applied).toEqual([])
  })

  it('fails closed when the transitional SQLite history table is missing', async () => {
    promoteProjectStateDatabaseAuthority(projectRoot)
    const authorityDatabase = new DatabaseSync(projectStateDatabasePath(projectRoot))
    authorityDatabase.prepare("UPDATE project_meta SET task_evidence_authority = 'database'").run()
    authorityDatabase.close()
    const database = new DatabaseSync(projectStateDatabasePath(projectRoot))
    database.exec('DROP TABLE task_evidence_history')
    database.close()

    const result = await applyProjectMigrations({
      projectRoot,
      only: ['0.12.42/task-evidence-history-compression'],
    })
    expect(result.failed).toEqual([expect.objectContaining({ error: expect.stringContaining('SQLite history table is missing') })])
    expect(readProjectStateDatabaseTaskEvidenceAuthority(projectRoot)).toBe('database')
  })

  it('backfills revision-matched point detail and no longer needs the queue blob', async () => {
    const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
    await fs.mkdir(path.dirname(tasksPath), { recursive: true })
    await fs.writeFile(tasksPath, JSON.stringify({
      version: 1,
      lastUpdated: '2026-07-14T12:00:00.000Z',
      tasks: [{
        id: 'task-point-migration',
        title: 'Point detail migration task',
        description: 'Only this task should be read for the drawer.',
        status: 'ready',
        references: ['docs/point-detail.md'],
      }],
    }, null, 2), 'utf8')

    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: {
        version: 1,
        lastUpdated: '2026-07-14T12:00:00.000Z',
        tasks: [{
          id: 'task-point-migration',
          title: 'Point detail migration task',
          description: 'Only this task should be read for the drawer.',
          status: 'ready',
          references: ['docs/point-detail.md'],
        }],
      },
      summary: { projectId: 'migration-test', generatedAt: '2026-07-14T12:00:00.000Z', freshness: 'current' },
    })
    const database = new DatabaseSync(projectStateDatabasePath(projectRoot))
    database.prepare('DELETE FROM work_item_detail').run()
    database.close()

    const result = await applyProjectMigrations({
      projectRoot,
      only: ['0.12.43/project-state-per-task-detail-index'],
    })
    expect(result.applied.map(item => item.id)).toEqual(['0.12.43/project-state-per-task-detail-index'])
    expect(readProjectStateDatabaseTaskPoint(tasksPath, 'task-point-migration')).toMatchObject({
      id: 'task-point-migration',
      title: 'Point detail migration task',
      definition: expect.objectContaining({ references: ['docs/point-detail.md'] }),
    })

    const clearAggregate = await applyProjectMigrations({
      projectRoot,
      only: ['0.12.44/project-state-remove-aggregate-detail'],
    })
    expect(clearAggregate.applied.map(item => item.id)).toEqual(['0.12.44/project-state-remove-aggregate-detail'])
    const afterMigration = new DatabaseSync(projectStateDatabasePath(projectRoot))
    expect(afterMigration.prepare('SELECT COUNT(*) AS count FROM queue_detail').get()).toMatchObject({ count: 0 })
    afterMigration.close()
    expect(readProjectStateDatabaseTaskPoint(tasksPath, 'task-point-migration')).toMatchObject({
      id: 'task-point-migration',
      definition: expect.objectContaining({ references: ['docs/point-detail.md'] }),
    })
    expect((await applyProjectMigrations({
      projectRoot,
      only: ['0.12.43/project-state-per-task-detail-index'],
    })).applied).toEqual([])
    expect((await applyProjectMigrations({
      projectRoot,
      only: ['0.12.44/project-state-remove-aggregate-detail'],
    })).applied).toEqual([])

    const currentThreadStore = await applyProjectMigrations({
      projectRoot,
      only: ['0.12.45/project-current-thread-projection-store'],
    })
    expect(currentThreadStore.applied.map(item => item.id)).toEqual(['0.12.45/project-current-thread-projection-store'])
    const currentThreadDatabase = new DatabaseSync(projectStateDatabasePath(projectRoot), { readOnly: true })
    expect(currentThreadDatabase.prepare('SELECT COUNT(*) AS count FROM current_thread').get()).toMatchObject({ count: 0 })
    currentThreadDatabase.close()
    expect((await applyProjectMigrations({
      projectRoot,
      only: ['0.12.45/project-current-thread-projection-store'],
    })).applied).toEqual([])

    const threadHistoryStore = await applyProjectMigrations({
      projectRoot,
      only: ['0.12.47/project-thread-history-read-model'],
    })
    expect(threadHistoryStore.applied.map(item => item.id)).toEqual(['0.12.47/project-thread-history-read-model'])
    const threadHistoryDatabase = new DatabaseSync(projectStateDatabasePath(projectRoot), { readOnly: true })
    expect(threadHistoryDatabase.prepare('SELECT COUNT(*) AS count FROM thread_history').get()).toMatchObject({ count: 0 })
    expect(threadHistoryDatabase.prepare('SELECT COUNT(*) AS count FROM thread_history_state').get()).toMatchObject({ count: 0 })
    threadHistoryDatabase.close()
    expect((await applyProjectMigrations({
      projectRoot,
      only: ['0.12.47/project-thread-history-read-model'],
    })).applied).toEqual([])
  })

  it('finalizes the current-state boundary and removes historical queue files only after verification', async () => {
    const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
    const summaryPath = getProjectSystemStatePath(projectRoot, 'project-summary.json')
    await fs.mkdir(path.dirname(tasksPath), { recursive: true })
    await fs.writeFile(tasksPath, JSON.stringify({
      version: 1,
      lastUpdated: '2026-07-14T12:00:00.000Z',
      tasks: [{
        id: 'task-final-cutover',
        title: 'Final cutover task',
        description: 'The current database must stand alone.',
        status: 'ready',
      }],
    }, null, 2), 'utf8')
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: {
        version: 1,
        lastUpdated: '2026-07-14T12:00:00.000Z',
        tasks: [{
          id: 'task-final-cutover',
          title: 'Final cutover task',
          description: 'The current database must stand alone.',
          status: 'ready',
        }],
      },
      summary: { projectId: 'migration-test', generatedAt: '2026-07-14T12:00:00.000Z', freshness: 'current' },
    })
    await fs.writeFile(summaryPath, JSON.stringify({ version: 1, freshness: 'stale' }), 'utf8')

    promoteProjectStateDatabaseAuthority(projectRoot)
    const rawDetailPath = path.join(path.dirname(tasksPath), 'queue-details.json')
    await fs.writeFile(rawDetailPath, '{"legacy":true}', 'utf8')
    const availabilityPath = path.join(getProjectLocalHistoryDir(projectRoot), 'project-availability.json')
    const attentionPath = getProjectSystemStatePath(projectRoot, 'attention.json')
    const reconciliationPath = getProjectSystemStatePath(projectRoot, 'reconciliations.json')
    const runtimePath = path.join(getProjectLocalHistoryDir(projectRoot), 'runtime', 'tasks.json')
    const workspaceRuntimePath = path.join(getProjectLocalHistoryDir(projectRoot), 'runtime', 'task-workspaces.json')
    await fs.mkdir(path.dirname(runtimePath), { recursive: true })
    await fs.writeFile(availabilityPath, JSON.stringify({ status: 'paused' }), 'utf8')
    await fs.writeFile(attentionPath, JSON.stringify({ records: [] }), 'utf8')
    await fs.writeFile(reconciliationPath, JSON.stringify({ records: [] }), 'utf8')
    await fs.writeFile(runtimePath, JSON.stringify({ version: 1, tasks: {} }), 'utf8')
    await fs.writeFile(workspaceRuntimePath, JSON.stringify({ version: 1, workspaces: {} }), 'utf8')

    const result = await applyProjectMigrations({
      projectRoot,
      only: ['0.13.0/project-state-finalize'],
    })

    expect(result.failed).toEqual([])
    expect(result.applied.map(item => item.id)).toEqual(['0.13.0/project-state-finalize'])
    await expect(fs.access(tasksPath)).rejects.toThrow()
    await expect(fs.access(summaryPath)).rejects.toThrow()
    await expect(fs.access(rawDetailPath)).rejects.toThrow()
    await expect(fs.access(availabilityPath)).rejects.toThrow()
    await expect(fs.access(attentionPath)).rejects.toThrow()
    await expect(fs.access(reconciliationPath)).rejects.toThrow()
    await expect(fs.access(runtimePath)).rejects.toThrow()
    await expect(fs.access(workspaceRuntimePath)).rejects.toThrow()
    expect(readProjectTaskQueueSync(tasksPath)).toMatchObject({
      tasks: [expect.objectContaining({ id: 'task-final-cutover' })],
    })
    await fs.writeFile(tasksPath, JSON.stringify({
      version: 1,
      tasks: [{ id: 'task-final-cutover', title: 'stale duplicate', status: 'done' }],
    }), 'utf8')
    expect(readProjectTaskQueueSync(tasksPath)).toMatchObject({
      tasks: [expect.objectContaining({ title: 'Final cutover task', status: 'ready' })],
    })
    const secondFinalize = await applyProjectMigrations({
      projectRoot,
      only: ['0.13.0/project-state-finalize'],
    })
    expect(secondFinalize.applied).toEqual([])
    expect(secondFinalize.failed).toEqual([])

    // A prior build may have recorded the cutover before its cleanup list was
    // expanded. The follow-up migration must repair that state without
    // pretending the original migration is pending again.
    await fs.writeFile(availabilityPath, JSON.stringify({ status: 'active' }), 'utf8')
    await fs.writeFile(attentionPath, JSON.stringify({ records: [] }), 'utf8')
    await fs.writeFile(reconciliationPath, JSON.stringify({ records: [] }), 'utf8')
    await fs.writeFile(runtimePath, JSON.stringify({ version: 1, tasks: {} }), 'utf8')
    await fs.writeFile(workspaceRuntimePath, JSON.stringify({ version: 1, workspaces: {} }), 'utf8')
    const cleanup = await applyProjectMigrations({
      projectRoot,
      only: ['0.13.0/project-state-legacy-live-file-cleanup'],
    })
    expect(cleanup.failed).toEqual([])
    expect(cleanup.applied.map(item => item.id)).toEqual(['0.13.0/project-state-legacy-live-file-cleanup'])
    await expect(fs.access(availabilityPath)).rejects.toThrow()
    await expect(fs.access(attentionPath)).rejects.toThrow()
    await expect(fs.access(reconciliationPath)).rejects.toThrow()
    await expect(fs.access(runtimePath)).rejects.toThrow()
    await expect(fs.access(workspaceRuntimePath)).rejects.toThrow()
    const secondCleanup = await applyProjectMigrations({
      projectRoot,
      only: ['0.13.0/project-state-legacy-live-file-cleanup'],
    })
    expect(secondCleanup.applied).toEqual([])
    expect(secondCleanup.failed).toEqual([])
  })

  it('refreshes the project summary shape idempotently without rewriting task history', async () => {
    const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
    await fs.mkdir(path.dirname(tasksPath), { recursive: true })
    const queue = {
      version: 1,
      lastUpdated: '2026-07-14T12:00:00.000Z',
      tasks: [{
        id: 'task-summary-v2',
        title: 'Summary shape task',
        description: 'A task used to prove summary shape refresh.',
        domain: 'runtime',
        projectPath: projectRoot,
        status: 'ready',
        priority: 'normal',
        references: [],
        sourceClaims: [],
        acceptanceCriteria: [],
        outOfScope: [],
        dependsOn: [],
        notes: [],
        createdAt: '2026-07-14T12:00:00.000Z',
        updatedAt: '2026-07-14T12:00:00.000Z',
      }],
    }
    await fs.writeFile(tasksPath, `${JSON.stringify(queue, null, 2)}\n`, 'utf8')
    const before = await fs.readFile(tasksPath, 'utf8')

    const first = await applyProjectMigrations({
      projectRoot,
      only: ['0.11.1/project-summary-projection-v2'],
    })
    expect(first.applied.map(item => item.id)).toEqual(['0.11.1/project-summary-projection-v2'])
    expect(readProjectSummaryProjection(tasksPath)).toMatchObject({
      projectId: path.basename(projectRoot),
      freshness: 'current',
      counts: { total: 1, byStatus: { ready: 1 } },
      releaseSummary: { scopeMode: 'unreleased' },
    })
    expect(await fs.readFile(tasksPath, 'utf8')).toBe(before)

    const second = await applyProjectMigrations({
      projectRoot,
      only: ['0.11.1/project-summary-projection-v2'],
    })
    expect(second.applied).toEqual([])
    expect(await fs.readFile(tasksPath, 'utf8')).toBe(before)
  })

  it('refreshes approved planning and selected scope idempotently without rewriting task history', async () => {
    const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
    await fs.mkdir(path.dirname(tasksPath), { recursive: true })
    const queue = {
      version: 1,
      lastUpdated: '2026-07-14T12:00:00.000Z',
      tasks: [{
        id: 'planned-1',
        title: 'Approved plan task',
        description: 'A task used to prove approved plan projection.',
        domain: 'runtime',
        projectPath: projectRoot,
        status: 'ready',
        priority: 'normal',
        references: [],
        sourceClaims: [],
        acceptanceCriteria: [],
        outOfScope: [],
        dependsOn: [],
        notes: [],
        releaseIds: ['release-1'],
        createdAt: '2026-07-14T12:00:00.000Z',
        updatedAt: '2026-07-14T12:00:00.000Z',
      }],
    }
    await fs.writeFile(tasksPath, `${JSON.stringify(queue, null, 2)}\n`, 'utf8')
    await fs.writeFile(path.join(path.dirname(tasksPath), 'workspace-goals.json'), JSON.stringify({
      version: 3,
      recordedAt: '2026-07-14T12:00:00.000Z',
      goals: [{ id: 'goal-1', title: 'Ship the plan' }],
      releases: [{ id: 'release-1', label: 'First release', source: 'owner_approved', state: 'active' }],
      tasks: [{ id: 'planned-1', title: 'Planned task', scope: 'current', releaseIds: ['release-1'] }],
      milestones: [],
      approved: {
        goalCount: 1,
        taskCount: 1,
        milestoneCount: 0,
        currentTaskCount: 1,
        laterTaskCount: 0,
        taskIds: ['planned-1'],
        currentTaskIds: ['planned-1'],
        laterTaskIds: [],
      },
      detected: null,
    }, null, 2), 'utf8')
    const before = await fs.readFile(tasksPath, 'utf8')

    const first = await applyProjectMigrations({
      projectRoot,
      only: ['0.11.3/project-summary-approved-plan'],
    })
    expect(first.applied.map(item => item.id)).toEqual(['0.11.3/project-summary-approved-plan'])
    expect(readProjectSummaryProjection(tasksPath)).toMatchObject({
      freshness: 'current',
      approvedPlan: {
        taskCount: 1,
        currentReleaseId: 'release-1',
      },
    })
    expect(await fs.readFile(tasksPath, 'utf8')).toBe(before)

    const scopeRefresh = await applyProjectMigrations({
      projectRoot,
      only: ['0.11.4/project-summary-approved-scope-selection'],
    })
    expect(scopeRefresh.applied.map(item => item.id)).toEqual(['0.11.4/project-summary-approved-scope-selection'])
    expect(readProjectSummaryProjection(tasksPath)).toMatchObject({
      freshness: 'current',
      releaseSummary: {
        scopeMode: 'named_release',
        release: { id: 'release-1', label: 'First release' },
      },
    })
    expect(await fs.readFile(tasksPath, 'utf8')).toBe(before)

    const second = await applyProjectMigrations({
      projectRoot,
      only: ['0.11.4/project-summary-approved-scope-selection'],
    })
    expect(second.applied).toEqual([])

    const authorityRefresh = await applyProjectMigrations({
      projectRoot,
      only: ['0.11.5/project-summary-release-membership-authority'],
    })
    expect(authorityRefresh.applied.map(item => item.id)).toEqual([
      '0.11.5/project-summary-release-membership-authority',
    ])
    expect(readProjectSummaryProjection(tasksPath)).toMatchObject({
      freshness: 'current',
      releaseSummary: {
        scopeMode: 'named_release',
        release: { id: 'release-1' },
      },
    })
    expect(await fs.readFile(tasksPath, 'utf8')).toBe(before)

    const authoritySecond = await applyProjectMigrations({
      projectRoot,
      only: ['0.11.5/project-summary-release-membership-authority'],
    })
    expect(authoritySecond.applied).toEqual([])
    expect(await fs.readFile(tasksPath, 'utf8')).toBe(before)
  })

  it('backfills the project summary projection idempotently without rewriting task history', async () => {
    const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
    await fs.mkdir(path.dirname(tasksPath), { recursive: true })
    const queue = {
      version: 1,
      lastUpdated: '2026-07-14T12:00:00.000Z',
      tasks: [{
        id: 'task-summary',
        title: 'Summary task',
        description: 'A task used to prove summary backfill.',
        domain: 'runtime',
        projectPath: projectRoot,
        status: 'done',
        priority: 'normal',
        references: [],
        sourceClaims: [],
        acceptanceCriteria: [],
        outOfScope: [],
        dependsOn: [],
        notes: [],
        createdAt: '2026-07-14T12:00:00.000Z',
        updatedAt: '2026-07-14T12:00:00.000Z',
      }],
    }
    await fs.writeFile(tasksPath, `${JSON.stringify(queue, null, 2)}\n`, 'utf8')
    const before = await fs.readFile(tasksPath, 'utf8')

    const first = await applyProjectMigrations({
      projectRoot,
      only: ['0.11.0/project-summary-projection'],
    })
    expect(first.applied.map(item => item.id)).toEqual(['0.11.0/project-summary-projection'])
    expect(readProjectSummaryProjection(tasksPath)).toMatchObject({
      projectId: path.basename(projectRoot),
      freshness: 'current',
      counts: { total: 1, done: 1 },
    })
    expect(await fs.readFile(tasksPath, 'utf8')).toBe(before)

    const second = await applyProjectMigrations({
      projectRoot,
      only: ['0.11.0/project-summary-projection'],
    })
    expect(second.applied).toEqual([])
    expect(await fs.readFile(tasksPath, 'utf8')).toBe(before)
  })

  it('moves orientation out of an existing summary row without rewriting task state', async () => {
    const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
    await fs.mkdir(path.dirname(tasksPath), { recursive: true })
    await fs.writeFile(tasksPath, JSON.stringify({ version: 1, tasks: [] }), 'utf8')
    writeProjectStateDatabaseSnapshot(tasksPath, {
      queue: { tasks: [{ id: 'task-orientation', title: 'Orientation task', status: 'ready' }] },
      summary: {
        projectId: path.basename(projectRoot),
        generatedAt: '2026-07-14T12:00:00.000Z',
        freshness: 'current',
        counts: { total: 1 },
        orientationSpine: { nodes: { 'work:task-orientation': { id: 'work:task-orientation' } } },
      },
    })
    const beforeTasks = await fs.readFile(tasksPath, 'utf8')
    const database = new DatabaseSync(projectStateDatabasePath(projectRoot))
    database.prepare('DELETE FROM project_orientation').run()
    database.prepare('UPDATE project_summary SET payload_json = ? WHERE id = 1').run(JSON.stringify({
      projectId: path.basename(projectRoot),
      generatedAt: '2026-07-14T12:00:00.000Z',
      freshness: 'current',
      counts: { total: 1 },
      orientationSpine: { nodes: { 'work:task-orientation': { id: 'work:task-orientation' } } },
    }))
    database.close()

    const result = await applyProjectMigrations({
      projectRoot,
      only: ['0.12.37/project-summary-orientation-store'],
    })
    expect(result.applied.map(item => item.id)).toEqual(['0.12.37/project-summary-orientation-store'])
    expect(await fs.readFile(tasksPath, 'utf8')).toBe(beforeTasks)
    expect(readProjectStateDatabaseSummary(tasksPath, { includeOrientation: false })?.payload).not.toHaveProperty('orientationSpine')
    expect(readProjectStateDatabaseSummary(tasksPath)?.payload).toMatchObject({
      orientationSpine: { nodes: { 'work:task-orientation': { id: 'work:task-orientation' } } },
    })
    expect((await applyProjectMigrations({
      projectRoot,
      only: ['0.12.37/project-summary-orientation-store'],
    })).applied).toEqual([])
  })

  it('applies automatic migrations but leaves prompt migrations pending by default', async () => {
    await fs.mkdir(path.join(projectRoot, '.guildhall'), { recursive: true })
    await fs.writeFile(path.join(projectRoot, '.guildhall', 'config.yaml'), [
      'openaiApiKey: sk-local',
      '',
    ].join('\n'), 'utf8')
    await fs.mkdir(path.join(projectRoot, 'memory'), { recursive: true })
    await fs.writeFile(path.join(projectRoot, 'memory', 'MEMORY.md'), '# Legacy\n', 'utf8')
    await fs.writeFile(path.join(projectRoot, 'memory', 'artifacts.yaml'), [
      'version: 1',
      'artifacts:',
      '  - id: flow-audit',
      '    path: internal/audits/flow-audit.md',
      '',
    ].join('\n'), 'utf8')
    await fs.writeFile(path.join(projectRoot, 'memory', 'TASKS.json'), JSON.stringify({
      version: 1,
      tasks: [{
        id: 'task-current',
        title: 'Current work',
        description: 'Resume me.',
        domain: 'runtime',
        projectPath: projectRoot,
        status: 'ready',
        spec: 'Current thin state includes the resumable task.',
        acceptanceCriteria: [{ id: 'ac-1', description: 'Resume packet exists.', verifiedBy: 'review', met: false }],
        notes: [{ content: 'old audit note should not export' }],
      }],
    }, null, 2), 'utf8')

    const result = await applyProjectMigrations({ projectRoot, includePrompt: false })

    expect(result.applied.some(item => item.id === '0.8.0/provider-config-globalization')).toBe(true)
    expect(result.skipped.some(item => item.id === '0.8.0/project-state-layout')).toBe(true)
  })

  it('applies selected prompt migrations and records them in the ledger', async () => {
    await fs.mkdir(path.join(projectRoot, 'memory'), { recursive: true })
    await fs.writeFile(path.join(projectRoot, 'memory', 'MEMORY.md'), '# Legacy\n', 'utf8')

    const result = await applyProjectMigrations({
      projectRoot,
      includePrompt: true,
      only: ['0.8.0/project-state-layout'],
    })

    expect(result.applied.some(item => item.id === '0.8.0/project-state-layout')).toBe(true)
    const ledger = await readProjectMigrationLedger(projectRoot)
    expect(ledger.records.some(record => record.id === '0.8.0/project-state-layout')).toBe(true)
  })

  it('repairs source-trail owner-input lead-ins even when the original owner-input repair already ran', async () => {
    const now = '2026-07-06T08:30:00.000Z'
    const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
    await fs.mkdir(path.dirname(tasksPath), { recursive: true })
    await fs.writeFile(tasksPath, JSON.stringify({
      version: 1,
      lastUpdated: now,
      tasks: [{
        id: 'task-templates',
        title: 'Templates',
        description: 'Legacy imported task.',
        domain: 'product',
        projectPath: projectRoot,
        status: 'ready',
        priority: 'normal',
        notes: [],
      }],
    }, null, 2), 'utf8')
    const created = await createOwnerInputRequest({
      projectRoot,
      projectId: 'migration-test',
      commandId: 'test:source-trail-leadin',
      now,
      actor: 'test',
      source: { kind: 'task', taskId: 'task-templates', questionId: 'q-templates' },
      target: { kind: 'thread' },
      question: {
        prompt: 'Should Templates stay in the current release scope?',
        choices: ['Keep Templates in the current release', 'Defer Templates'],
      },
      objective: {
        kind: 'task_shaping',
        label: 'Clarify Templates',
        successCriteria: ['Owner answers the linked bounded-chat session.'],
      },
    })
    await rewriteOwnerInputPrompt(projectRoot, created.request.id, {
      prompt: "From what I've seen:",
      choices: [
        '`features.md` line 59: `- [ ] Templates` - unchecked, under "Organization & Structure"',
        'The roadmap does not list Templates as a priority parity gap',
      ],
    })
    await writeProjectMigrationLedger(projectRoot, {
      version: 1,
      records: [{
        id: '0.10.0/owner-input-state-repair',
        introducedIn: '0.10.0',
        scope: 'project',
        safety: 'prompt',
        status: 'applied',
        appliedAt: now,
        appliedByVersion: '0.10.0',
        summary: 'Original owner-input repair already ran.',
      }],
    })

    const before = await getProjectMigrationStatus({
      projectRoot,
      only: ['0.10.1/owner-input-source-trail-leadin-repair'],
    })
    expect(before.blocked.map(item => item.id)).toEqual(['0.10.1/owner-input-source-trail-leadin-repair'])

    const result = await applyProjectMigrations({
      projectRoot,
      only: ['0.10.1/owner-input-source-trail-leadin-repair'],
    })

    expect(result.applied.map(item => item.id)).toEqual(['0.10.1/owner-input-source-trail-leadin-repair'])
    const request = JSON.parse(await fs.readFile(
      getProjectSystemStatePath(projectRoot, path.join('owner-input', `${created.request.id}.json`)),
      'utf8',
    ))
    expect(request.status).toBe('cancelled')
    expect(JSON.stringify(request.receipts)).toContain('0.10.1/owner-input-source-trail-leadin-repair')
  })

  it('normalizes verification child tasks into explicit delivery-step metadata', async () => {
    const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
    await fs.mkdir(path.dirname(tasksPath), { recursive: true })
    await fs.writeFile(tasksPath, JSON.stringify({
      version: 1,
      lastUpdated: '2026-06-12T00:00:00.000Z',
      tasks: [
        {
          id: 'task-import-review',
          title: 'Import review flow',
          description: 'Review imported project material.',
          domain: 'project',
          projectPath: projectRoot,
          status: 'ready',
          priority: 'normal',
          hierarchy: { childIds: ['task-runtime-proof'] },
        },
        {
          id: 'task-runtime-proof',
          title: 'Runtime proof',
          description: 'Prove the import review flow.',
          domain: 'project',
          projectPath: projectRoot,
          status: 'blocked',
          priority: 'normal',
          workKind: 'verification',
          hierarchy: { parentId: 'task-import-review', order: 0 },
        },
      ],
    }, null, 2), 'utf8')

    const before = await getProjectMigrationStatus({ projectRoot, only: ['0.10.0/task-delivery-steps'] })
    expect(before.pending.map(item => item.id)).toContain('0.10.0/task-delivery-steps')

    const result = await applyProjectMigrations({
      projectRoot,
      only: ['0.10.0/task-delivery-steps'],
    })

    expect(result.applied.map(item => item.id)).toContain('0.10.0/task-delivery-steps')
    const updated = JSON.parse(await fs.readFile(tasksPath, 'utf8')) as { tasks: Array<Record<string, any>> }
    const parent = updated.tasks.find(task => task.id === 'task-import-review')
    const child = updated.tasks.find(task => task.id === 'task-runtime-proof')
    expect(child?.workVisibility).toMatchObject({ kind: 'internal_step', countInProjectTotals: false })
    expect(parent?.deliverySteps).toEqual([
      expect.objectContaining({
        id: 'task:task-runtime-proof',
        title: 'Runtime proof',
        kind: 'verify',
        status: 'blocked',
        sourceTaskId: 'task-runtime-proof',
      }),
    ])
  })

  it('applies required merge_policy conversion into landing_strategy', async () => {
    const settingsPath = path.join(projectRoot, '.guildhall', 'agent-settings.yaml')
    await fs.mkdir(path.dirname(settingsPath), { recursive: true })
    await fs.writeFile(settingsPath, [
      'version: 1',
      'project:',
      '  merge_policy:',
      '    position: ff_only_local',
      '    rationale: legacy local-only landing',
      '    setAt: "2026-05-31T00:00:00.000Z"',
      '    setBy: user-direct',
      'domains:',
      '  default: {}',
      '  overrides: {}',
      '',
    ].join('\n'), 'utf8')

    const before = await getProjectMigrationStatus({ projectRoot })
    expect(before.blocked.some(item => item.id === '0.10.0/merge-policy-to-landing-strategy')).toBe(true)

    const result = await applyProjectMigrations({
      projectRoot,
      includePrompt: true,
      only: ['0.10.0/merge-policy-to-landing-strategy'],
    })

    expect(result.applied.some(item => item.id === '0.10.0/merge-policy-to-landing-strategy')).toBe(true)
    const updated = parseYaml(await fs.readFile(settingsPath, 'utf8')) as Record<string, any>
    expect(updated.project.merge_policy).toBeUndefined()
    expect(updated.project.landing_strategy).toMatchObject({
      position: 'cherry_pick_local',
      rationale: 'legacy local-only landing',
      setBy: 'user-direct',
    })
  })

  it('clears repo-local Guildhall state when applying the layout migration without thin opt-in', async () => {
    await fs.mkdir(path.join(projectRoot, 'memory'), { recursive: true })
    await fs.writeFile(path.join(projectRoot, 'memory', 'MEMORY.md'), '# Legacy\n', 'utf8')

    await applyProjectMigrations({
      projectRoot,
      includePrompt: true,
      only: ['0.8.0/project-state-layout'],
    })

    await expect(fs.access(path.join(projectRoot, '.guildhall'))).rejects.toThrow()
    await expect(fs.readFile(
      path.join(getProjectLocalHistoryDir(projectRoot), 'project-state-evacuation', 'MEMORY.md'),
      'utf8',
    )).resolves.toContain('# Legacy')
    await expect(fs.readFile(
      path.join(getProjectLocalHistoryDir(projectRoot), 'migrations', 'migrations.json'),
      'utf8',
    )).resolves.toContain('0.8.0/project-state-layout')
  })

  it('writes only the current thin manifest when thin repo state is explicitly opted in', async () => {
    await fs.writeFile(path.join(projectRoot, 'guildhall.yaml'), [
      'name: Migration Test',
      'id: migration-test',
      'storage:',
      '  repoState: thin',
      '',
    ].join('\n'), 'utf8')
    await fs.mkdir(path.join(projectRoot, 'memory'), { recursive: true })
    await fs.writeFile(path.join(projectRoot, 'memory', 'MEMORY.md'), '# Legacy\n', 'utf8')
    await fs.writeFile(path.join(projectRoot, 'memory', 'artifacts.yaml'), [
      'version: 1',
      'artifacts:',
      '  - id: flow-audit',
      '    path: internal/audits/flow-audit.md',
      '',
    ].join('\n'), 'utf8')
    await fs.writeFile(path.join(projectRoot, 'memory', 'TASKS.json'), JSON.stringify({
      version: 1,
      tasks: [{
        id: 'task-current',
        title: 'Current work',
        description: 'Resume me.',
        domain: 'runtime',
        projectPath: projectRoot,
        status: 'ready',
        spec: 'Current thin state includes the resumable task.',
        acceptanceCriteria: [{ id: 'ac-1', description: 'Resume packet exists.', verifiedBy: 'review', met: false }],
        notes: [{ content: 'old audit note should not export' }],
      }],
    }, null, 2), 'utf8')

    await applyProjectMigrations({
      projectRoot,
      includePrompt: true,
      only: ['0.8.0/project-state-layout'],
    })

    const manifest = JSON.parse(await fs.readFile(path.join(projectRoot, '.guildhall', 'project-state-manifest.json'), 'utf8')) as Record<string, unknown>
    expect(manifest).toMatchObject({
      version: 1,
      mode: 'thin',
      projectId: 'migration-test',
      projectName: 'Migration Test',
      currentShape: {
        artifacts: ['flow-audit'],
        activeTasks: [expect.objectContaining({
          id: 'task-current',
          title: 'Current work',
          status: 'ready',
          spec: 'Current thin state includes the resumable task.',
        })],
      },
      exports: {
        artifactRegistry: {
          path: '.guildhall/artifacts.yaml',
          artifactIds: ['flow-audit'],
        },
      },
    })
    expect(JSON.stringify(manifest)).not.toContain('old audit note')
    expect(JSON.stringify(manifest)).not.toContain('project-state-evacuation')
    await expect(fs.access(path.join(projectRoot, '.guildhall', 'TASKS.json'))).rejects.toThrow()
    await expect(fs.access(path.join(projectRoot, '.guildhall', 'MEMORY.md'))).rejects.toThrow()
    await expect(fs.access(path.join(projectRoot, '.guildhall', 'DECISIONS.md'))).rejects.toThrow()
    await expect(fs.access(path.join(projectRoot, '.guildhall', 'PROGRESS.md'))).rejects.toThrow()
  })

  it('evacuates stale repo-local Guildhall state through the storage-boundary migration', async () => {
    await fs.mkdir(path.join(projectRoot, '.guildhall', 'tasks'), { recursive: true })
    await fs.writeFile(path.join(projectRoot, '.guildhall', 'agent-settings.yaml'), 'version: 1\n', 'utf8')
    await fs.writeFile(path.join(projectRoot, '.guildhall', 'TASKS.json'), JSON.stringify({
      version: 1,
      tasks: [{ id: 'task-stale', title: 'Stale state', status: 'ready', notes: [{ content: 'history' }] }],
    }, null, 2), 'utf8')

    const before = await getProjectMigrationStatus({ projectRoot })
    expect(before.blocked.some(item => item.id === '0.10.0/project-state-storage-boundary')).toBe(true)

    const result = await applyProjectMigrations({
      projectRoot,
      includePrompt: true,
      only: ['0.10.0/project-state-storage-boundary'],
    })

    expect(result.applied.some(item => item.id === '0.10.0/project-state-storage-boundary')).toBe(true)
    await expect(fs.access(path.join(projectRoot, '.guildhall'))).rejects.toThrow()
    await expect(fs.readFile(
      path.join(getProjectLocalHistoryDir(projectRoot), 'project-state-evacuation', 'TASKS.json'),
      'utf8',
    )).resolves.toContain('task-stale')

    const after = await getProjectMigrationStatus({ projectRoot })
    expect(after.blocked.some(item => item.id === '0.10.0/project-state-storage-boundary')).toBe(false)
  })

  it('restores stranded evacuated task state into the system-local queue', async () => {
    const systemTasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
    await fs.mkdir(path.dirname(systemTasksPath), { recursive: true })
    await fs.writeFile(systemTasksPath, JSON.stringify({
      version: 1,
      tasks: [
        { id: 'task-workspace-import', title: 'Review existing project work', status: 'done' },
        { id: 'task-context-menu', title: 'ContextMenu', status: 'done' },
      ],
    }, null, 2), 'utf8')
    const evacuatedTasksPath = path.join(getProjectLocalHistoryDir(projectRoot), 'project-state-evacuation', 'TASKS.json')
    await fs.mkdir(path.dirname(evacuatedTasksPath), { recursive: true })
    await fs.writeFile(evacuatedTasksPath, JSON.stringify({
      version: 1,
      tasks: [
        { id: 'task-listbox', title: 'Listbox', status: 'spec_review' },
        { id: 'task-context-menu', title: 'ContextMenu', status: 'ready' },
      ],
    }, null, 2), 'utf8')
    const evacuatedIndexPath = path.join(getProjectLocalHistoryDir(projectRoot), 'project-state-evacuation', 'tasks', 'index.json')
    const evacuatedArchivePath = path.join(getProjectLocalHistoryDir(projectRoot), 'project-state-evacuation', 'tasks', 'archive', 'task-done.json')
    await fs.mkdir(path.dirname(evacuatedArchivePath), { recursive: true })
    await fs.writeFile(evacuatedIndexPath, JSON.stringify({
      activeTaskIds: ['task-listbox'],
      archivedTaskIds: ['task-done'],
    }, null, 2), 'utf8')
    await fs.writeFile(evacuatedArchivePath, JSON.stringify({
      id: 'task-done',
      title: 'Readable completed task',
      status: 'done',
    }, null, 2), 'utf8')

    const before = await getProjectMigrationStatus({ projectRoot })
    expect(before.blocked.some(item => item.id === '0.10.0/restore-evacuated-task-state')).toBe(true)

    const result = await applyProjectMigrations({
      projectRoot,
      only: ['0.10.0/restore-evacuated-task-state'],
    })

    expect(result.applied.some(item => item.id === '0.10.0/restore-evacuated-task-state')).toBe(true)
    const restored = JSON.parse(await fs.readFile(systemTasksPath, 'utf8')) as { tasks: Array<{ id: string; title: string; status: string }> }
    expect(restored.tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'task-listbox', title: 'Listbox', status: 'spec_review' }),
      expect.objectContaining({ id: 'task-context-menu', title: 'ContextMenu', status: 'done' }),
      expect.objectContaining({ id: 'task-workspace-import', title: 'Review existing project work', status: 'done' }),
    ]))
    await expect(fs.readFile(getProjectSystemStatePath(projectRoot, 'tasks/index.json'), 'utf8'))
      .resolves.toContain('task-listbox')
    await expect(fs.readFile(getProjectSystemStatePath(projectRoot, 'tasks/archive/task-done.json'), 'utf8'))
      .resolves.toContain('Readable completed task')
  })

  it('rechecks an applied evacuation migration when a later batch appears', async () => {
    const systemTasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
    await fs.mkdir(path.dirname(systemTasksPath), { recursive: true })
    await fs.writeFile(systemTasksPath, JSON.stringify({ version: 1, tasks: [] }, null, 2), 'utf8')
    await writeProjectMigrationLedger(projectRoot, {
      version: 1,
      records: [{
        id: '0.10.0/restore-evacuated-task-state',
        introducedIn: '0.10.0',
        scope: 'project',
        safety: 'automatic',
        status: 'applied',
        appliedAt: '2026-07-14T00:00:00.000Z',
        appliedByVersion: '0.10.0',
        summary: 'The first evacuation batch was restored.',
      }],
    })

    const evacuatedTasksPath = path.join(getProjectLocalHistoryDir(projectRoot), 'project-state-evacuation', 'TASKS.json')
    await fs.mkdir(path.dirname(evacuatedTasksPath), { recursive: true })
    await fs.writeFile(evacuatedTasksPath, JSON.stringify({
      version: 1,
      tasks: [{ id: 'task-later-batch', title: 'Restore this later batch', status: 'ready' }],
    }, null, 2), 'utf8')

    const status = await getProjectMigrationStatus({
      projectRoot,
      only: ['0.10.0/restore-evacuated-task-state'],
    })
    expect(status.blocked.map(item => item.id)).toContain('0.10.0/restore-evacuated-task-state')

    const result = await applyProjectMigrations({
      projectRoot,
      only: ['0.10.0/restore-evacuated-task-state'],
    })
    expect(result.applied.map(item => item.id)).toContain('0.10.0/restore-evacuated-task-state')
    await expect(fs.readFile(systemTasksPath, 'utf8')).resolves.toContain('task-later-batch')
  })

  it('restores evacuated release containers even when task records already exist', async () => {
    const systemTasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
    await fs.mkdir(path.dirname(systemTasksPath), { recursive: true })
    await fs.writeFile(systemTasksPath, JSON.stringify({
      version: 1,
      tasks: [
        {
          id: 'task-knit-unit-tests',
          title: 'Unit tests: use-collections, use-presence, subdomain utils',
          status: 'spec_review',
          releaseIds: ['stage-1-v1-release-hardening'],
        },
      ],
    }, null, 2), 'utf8')
    const evacuatedTasksPath = path.join(getProjectLocalHistoryDir(projectRoot), 'project-state-evacuation', 'TASKS.json')
    await fs.mkdir(path.dirname(evacuatedTasksPath), { recursive: true })
    await fs.writeFile(evacuatedTasksPath, JSON.stringify({
      version: 1,
      selectedReleaseId: 'stage-1-v1-release-hardening',
      releases: [{
        id: 'stage-1-v1-release-hardening',
        label: 'Stage 1: V1 Release Hardening',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        nodeIds: ['work:task-knit-unit-tests'],
        deferredNodeIds: ['work:task-looma-editor-integration'],
      }],
      tasks: [
        {
          id: 'task-knit-unit-tests',
          title: 'Unit tests: use-collections, use-presence, subdomain utils',
          status: 'spec_review',
          releaseIds: ['stage-1-v1-release-hardening'],
        },
      ],
    }, null, 2), 'utf8')

    const before = await getProjectMigrationStatus({ projectRoot })
    expect(before.blocked.some(item => item.id === '0.10.0/restore-evacuated-task-state')).toBe(true)

    const result = await applyProjectMigrations({
      projectRoot,
      only: ['0.10.0/restore-evacuated-task-state'],
    })

    expect(result.applied.some(item => item.id === '0.10.0/restore-evacuated-task-state')).toBe(true)
    const restored = JSON.parse(await fs.readFile(systemTasksPath, 'utf8')) as {
      selectedReleaseId?: string
      releases?: Array<{ id: string; label: string; deferredNodeIds?: string[] }>
      tasks: Array<{ id: string }>
    }
    expect(restored.selectedReleaseId).toBe('stage-1-v1-release-hardening')
    expect(restored.releases).toEqual([
      expect.objectContaining({
        id: 'stage-1-v1-release-hardening',
        label: 'Stage 1: V1 Release Hardening',
        deferredNodeIds: ['work:task-looma-editor-integration'],
      }),
    ])
    expect(restored.tasks).toEqual([
      expect.objectContaining({ id: 'task-knit-unit-tests' }),
    ])
  })

  it('restores richer evacuated task shape over hollow same-id imported drafts', async () => {
    const systemTasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
    const fullTitle = 'Block menu / block side menu supports generic Looma blocks and Knit-specific actions.'
    const croppedTitle = 'Block menu / block side menu supports generic Looma blocks and Knit-specific'
    await fs.mkdir(path.dirname(systemTasksPath), { recursive: true })
    await fs.writeFile(systemTasksPath, JSON.stringify({
      version: 1,
      tasks: [
        {
          id: 'task-import-block-menu',
          title: croppedTitle,
          description: `docs/editor-roadmap.md: - ${fullTitle}`,
          status: 'import_draft',
          scope: 'current',
          releaseIds: ['stage-1-finish-knit-primitive-replacement-wave'],
          references: ['docs/editor-roadmap.md'],
        },
      ],
    }, null, 2), 'utf8')
    const evacuatedTasksPath = path.join(getProjectLocalHistoryDir(projectRoot), 'project-state-evacuation', 'TASKS.json')
    await fs.mkdir(path.dirname(evacuatedTasksPath), { recursive: true })
    await fs.writeFile(evacuatedTasksPath, JSON.stringify({
      version: 1,
      tasks: [
        {
          id: 'task-import-block-menu',
          title: croppedTitle,
          description: `docs/editor-roadmap.md: - ${fullTitle}`,
          status: 'ready',
          spec: '## Summary\nBuild the block menu and side menu primitives.',
          productBrief: {
            status: 'approved',
            productOutcome: 'Knit can use a generic Looma block menu primitive.',
            successMetric: 'Block menu primitive is specified and ready for implementation.',
          },
          acceptanceCriteria: [
            { id: 'ac-1', description: 'Block menu primitive has a ready implementation spec.', verifiedBy: 'review', met: false },
          ],
        },
      ],
    }, null, 2), 'utf8')

    const before = await getProjectMigrationStatus({ projectRoot })
    expect(before.blocked.some(item => item.id === '0.10.1/restore-evacuated-shaped-task-state')).toBe(true)

    await applyProjectMigrations({
      projectRoot,
      only: ['0.10.1/restore-evacuated-shaped-task-state'],
    })

    const restored = JSON.parse(await fs.readFile(systemTasksPath, 'utf8')) as {
      tasks: Array<{
        id: string
        title: string
        status: string
        spec?: string
        productBrief?: { productOutcome?: string }
        acceptanceCriteria?: Array<{ id: string }>
        releaseIds?: string[]
        references?: string[]
      }>
    }
    expect(restored.tasks).toHaveLength(1)
    expect(restored.tasks[0]).toEqual(expect.objectContaining({
      id: 'task-import-block-menu',
      title: fullTitle,
      status: 'ready',
      spec: expect.stringContaining('Build the block menu'),
      productBrief: expect.objectContaining({
        productOutcome: 'Knit can use a generic Looma block menu primitive.',
      }),
      acceptanceCriteria: [expect.objectContaining({ id: 'ac-1' })],
      releaseIds: ['stage-1-finish-knit-primitive-replacement-wave'],
      references: ['docs/editor-roadmap.md'],
    }))
  })

  it('restores shaped done evidence from evacuated task archive over hollow same-id imported drafts', async () => {
    const systemTasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
    await fs.mkdir(path.dirname(systemTasksPath), { recursive: true })
    await fs.writeFile(systemTasksPath, JSON.stringify({
      version: 1,
      tasks: [
        {
          id: 'task-import-kj0cyz',
          title: 'Unit tests: use-collections, use-presence, subdomain utils',
          status: 'import_draft',
          releaseIds: ['stage-1-v1-release-hardening'],
          references: ['knit/PROJECT_STATE.md'],
        },
      ],
    }, null, 2), 'utf8')
    const evacuatedTasksPath = path.join(getProjectLocalHistoryDir(projectRoot), 'project-state-evacuation', 'TASKS.json')
    await fs.mkdir(path.dirname(evacuatedTasksPath), { recursive: true })
    await fs.writeFile(evacuatedTasksPath, JSON.stringify({ version: 1, tasks: [] }, null, 2), 'utf8')
    const archivePath = path.join(getProjectLocalHistoryDir(projectRoot), 'project-state-evacuation', 'tasks', 'archive', 'task-import-kj0cyz.json')
    await fs.mkdir(path.dirname(archivePath), { recursive: true })
    await fs.writeFile(archivePath, JSON.stringify({
      id: 'task-import-kj0cyz',
      title: 'Unit tests: use-collections, use-presence, subdomain utils',
      status: 'done',
      acceptanceCriteria: [
        {
          id: 'ac-1',
          description: 'Targeted unit tests pass.',
          verifiedBy: 'automated',
          command: 'pnpm test use-collections use-presence subdomain',
          met: true,
        },
      ],
      mergeRecord: {
        result: 'merged',
        mergedAt: '2026-05-15T07:37:45.052Z',
      },
    }, null, 2), 'utf8')

    const before = await getProjectMigrationStatus({ projectRoot })
    expect(before.blocked.some(item => item.id === '0.10.1/restore-evacuated-archive-shaped-task-state')).toBe(true)

    await applyProjectMigrations({
      projectRoot,
      only: ['0.10.1/restore-evacuated-archive-shaped-task-state'],
    })

    const restored = JSON.parse(await fs.readFile(systemTasksPath, 'utf8')) as {
      tasks: Array<{
        id: string
        status: string
        acceptanceCriteria?: Array<{ met?: boolean }>
        mergeRecord?: { result?: string }
        releaseIds?: string[]
        references?: string[]
      }>
    }
    expect(restored.tasks).toEqual([
      expect.objectContaining({
        id: 'task-import-kj0cyz',
        status: 'done',
        acceptanceCriteria: [expect.objectContaining({ met: true })],
        mergeRecord: expect.objectContaining({ result: 'merged' }),
        releaseIds: ['stage-1-v1-release-hardening'],
        references: ['knit/PROJECT_STATE.md'],
      }),
    ])
  })

  it('does not restore archived done status when evacuated criteria still lack proof', async () => {
    const systemTasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
    await fs.mkdir(path.dirname(systemTasksPath), { recursive: true })
    await fs.writeFile(systemTasksPath, JSON.stringify({
      version: 1,
      tasks: [
        {
          id: 'task-import-mobile-proof',
          title: 'Mobile: test on real device',
          status: 'import_draft',
          releaseIds: ['stage-1-v1-release-hardening'],
        },
      ],
    }, null, 2), 'utf8')
    const evacuatedTasksPath = path.join(getProjectLocalHistoryDir(projectRoot), 'project-state-evacuation', 'TASKS.json')
    await fs.mkdir(path.dirname(evacuatedTasksPath), { recursive: true })
    await fs.writeFile(evacuatedTasksPath, JSON.stringify({ version: 1, tasks: [] }, null, 2), 'utf8')
    const archivePath = path.join(getProjectLocalHistoryDir(projectRoot), 'project-state-evacuation', 'tasks', 'archive', 'task-import-mobile-proof.json')
    await fs.mkdir(path.dirname(archivePath), { recursive: true })
    await fs.writeFile(archivePath, JSON.stringify({
      id: 'task-import-mobile-proof',
      title: 'Mobile: test on real device',
      status: 'done',
      spec: '## Summary\nRun the mobile smoke proof.',
      acceptanceCriteria: [
        {
          id: 'ac-1',
          description: 'Mobile smoke proof is reviewed.',
          verifiedBy: 'review',
          met: false,
        },
      ],
      mergeRecord: {
        result: 'merged',
        mergedAt: '2026-05-15T07:37:45.052Z',
      },
    }, null, 2), 'utf8')

    await applyProjectMigrations({
      projectRoot,
      only: ['0.10.1/restore-evacuated-archive-shaped-task-state'],
    })

    const restored = JSON.parse(await fs.readFile(systemTasksPath, 'utf8')) as {
      tasks: Array<{ id: string; status: string; spec?: string; mergeRecord?: { result?: string } }>
    }
    expect(restored.tasks).toEqual([
      expect.objectContaining({
        id: 'task-import-mobile-proof',
        status: 'ready',
        spec: expect.stringContaining('mobile smoke proof'),
        mergeRecord: expect.objectContaining({ result: 'merged' }),
      }),
    ])
  })

  it('repairs clipped shaped task titles left behind after evacuated state restoration', async () => {
    const fullTitle = 'Continue the Knit-to-Looma promotion work into the next generic surfaces while primitive normalization continues.'
    const croppedTitle = 'Continue the Knit-to-Looma promotion work into the next generic surfaces while'
    const systemTasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
    await fs.mkdir(path.dirname(systemTasksPath), { recursive: true })
    await fs.writeFile(systemTasksPath, JSON.stringify({
      version: 1,
      tasks: [
        {
          id: 'task-import-next-wave',
          title: croppedTitle,
          description: `looma/PROJECT_STATE.md: 3. ${fullTitle}`,
          status: 'spec_review',
          spec: `## Summary\nBuild ${croppedTitle} from the current evidence.`,
          productBrief: {
            productOutcome: 'The next promotion wave is shaped.',
          },
          acceptanceCriteria: [
            { id: 'ac-1', description: 'The wave has acceptance criteria.', verifiedBy: 'review', met: false },
          ],
        },
      ],
    }, null, 2), 'utf8')
    const evacuatedTasksPath = path.join(getProjectLocalHistoryDir(projectRoot), 'project-state-evacuation', 'TASKS.json')
    await fs.mkdir(path.dirname(evacuatedTasksPath), { recursive: true })
    await fs.writeFile(evacuatedTasksPath, JSON.stringify({ version: 1, tasks: [] }, null, 2), 'utf8')

    const before = await getProjectMigrationStatus({ projectRoot })
    expect(before.blocked.some(item => item.id === '0.10.1/restore-evacuated-shaped-task-state')).toBe(true)

    await applyProjectMigrations({
      projectRoot,
      only: ['0.10.1/restore-evacuated-shaped-task-state'],
    })

    const restored = JSON.parse(await fs.readFile(systemTasksPath, 'utf8')) as {
      tasks: Array<{ id: string; title: string; status: string }>
    }
    expect(restored.tasks).toEqual([
      expect.objectContaining({
        id: 'task-import-next-wave',
        title: fullTitle,
        status: 'spec_review',
      }),
    ])
  })

  it('repairs clipped task titles even when evacuation repair already ran', async () => {
    const fullTitle = 'Keep ui-top-bar, ui-search-shell, and ui-search-result-row as recipe-level primitives rather than forcing them into lower-level generic atoms'
    const markdownSourceTitle = 'Keep `ui-top-bar`, `ui-search-shell`, and `ui-search-result-row` as recipe-level primitives rather than forcing them into lower-level generic atoms'
    const croppedTitle = 'Keep ui-top-bar, ui-search-shell, and ui-search-result-row as recipe-level primitives rather than forcing them into lowe'
    const systemTasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
    await fs.mkdir(path.dirname(systemTasksPath), { recursive: true })
    await fs.writeFile(systemTasksPath, JSON.stringify({
      version: 1,
      tasks: [{
        id: 'task-import-2h8fxk',
        title: croppedTitle,
        description: `looma/docs/component-roadmap.md: - ${markdownSourceTitle}`,
        status: 'spec_review',
        acceptanceCriteria: [{
          id: 'ac-1',
          description: `When ${croppedTitle} is implemented, then the source-backed primitive boundary is preserved.`,
        }],
        productBrief: {
          userJob: `I want ${croppedTitle} turned into concrete project work.`,
        },
        spec: `## Summary\nBuild ${croppedTitle} from the current project evidence.\n\n## Acceptance Criteria\n1. ${croppedTitle} is implemented.`,
      }],
    }, null, 2), 'utf8')
    await writeProjectMigrationLedger(projectRoot, {
      version: 1,
      records: [{
        id: '0.10.1/restore-evacuated-shaped-task-state',
        introducedIn: '0.10.1',
        scope: 'project',
        safety: 'automatic',
        status: 'applied',
        appliedAt: '2026-07-05T00:00:00.000Z',
        appliedByVersion: '0.10.1',
        summary: 'Older evacuation repair already ran.',
      }],
    })

    const before = await getProjectMigrationStatus({ projectRoot })
    expect(before.blocked.some(item => item.id === '0.10.1/repair-clipped-task-titles')).toBe(true)

    await applyProjectMigrations({
      projectRoot,
      only: ['0.10.1/repair-clipped-task-titles'],
    })

    const repaired = JSON.parse(await fs.readFile(systemTasksPath, 'utf8')) as {
      tasks: Array<{ id: string; title: string }>
    }
    expect(repaired.tasks).toEqual([
      expect.objectContaining({
        id: 'task-import-2h8fxk',
        title: fullTitle,
      }),
    ])
    expect(JSON.stringify(repaired.tasks[0])).not.toContain(`${croppedTitle} is`)
    expect(JSON.stringify(repaired.tasks[0])).not.toContain(`${croppedTitle} from`)
    expect(JSON.stringify(repaired.tasks[0])).not.toContain(`${croppedTitle} turned`)
    expect(JSON.stringify(repaired.tasks[0])).toContain(fullTitle)
  })

  it('attaches recovered current-scope owner requirement work to the selected release', async () => {
    const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
    await fs.mkdir(path.dirname(tasksPath), { recursive: true })
    await fs.writeFile(tasksPath, JSON.stringify({
      version: 1,
      lastUpdated: '2026-07-06T09:00:00.000Z',
      tasks: [
        {
          id: 'task-import-fixture',
          title: 'Add the first tiny fiction fixture and human-authored expected records.',
          status: 'done',
          releaseIds: ['stage-1-fixture-and-evaluation-harness'],
        },
        {
          id: 'task-150',
          title: 'Define Narrative Harness MVP drafting model and physical-world review lanes',
          status: 'done',
          releaseIds: [],
          hierarchy: {
            childIds: [
              'task-150-split-select-and-prove-deepinfra-drafting-model',
              'task-150-split-define-world-state-continuity-review-lane',
              'task-150-split-define-spatial-geographic-continuity-review-lane',
            ],
            relation: 'contains',
          },
        },
        {
          id: 'task-150-split-select-and-prove-deepinfra-drafting-model',
          title: 'Select and prove DeepInfra drafting model',
          status: 'done',
          releaseIds: [],
          hierarchy: { parentId: 'task-150', childIds: [], order: 0, relation: 'decomposes' },
        },
        {
          id: 'task-150-split-define-world-state-continuity-review-lane',
          title: 'Define world-state continuity review lane',
          status: 'done',
          releaseIds: [],
          hierarchy: { parentId: 'task-150', childIds: [], order: 1, relation: 'decomposes' },
        },
        {
          id: 'task-150-split-define-spatial-geographic-continuity-review-lane',
          title: 'Define spatial/geographic continuity review lane',
          status: 'done',
          releaseIds: [],
          hierarchy: { parentId: 'task-150', childIds: [], order: 2, relation: 'decomposes' },
        },
      ],
    }, null, 2), 'utf8')

    const before = await getProjectMigrationStatus({ projectRoot })
    expect(before.blocked.some(item => item.id === '0.10.1/attach-recovered-current-scope-work-to-selected-release')).toBe(true)

    await applyProjectMigrations({
      projectRoot,
      only: ['0.10.1/attach-recovered-current-scope-work-to-selected-release'],
    })

    const repaired = JSON.parse(await fs.readFile(tasksPath, 'utf8')) as {
      tasks: Array<{ id: string; releaseIds?: string[] }>
      selectedReleaseId?: string
      releases: Array<{ id: string; nodeIds?: string[] }>
    }
    expect(repaired.selectedReleaseId).toBe('stage-1-fixture-and-evaluation-harness')
    for (const task of repaired.tasks.filter(task => task.id.startsWith('task-150'))) {
      expect(task.releaseIds).toEqual(['stage-1-fixture-and-evaluation-harness'])
    }
    expect(repaired.releases[0]?.nodeIds).toEqual([
      'work:task-import-fixture',
      'work:task-150',
      'work:task-150-split-select-and-prove-deepinfra-drafting-model',
      'work:task-150-split-define-world-state-continuity-review-lane',
      'work:task-150-split-define-spatial-geographic-continuity-review-lane',
    ])

    const after = await getProjectMigrationStatus({ projectRoot })
    expect(after.blocked.some(item => item.id === '0.10.1/attach-recovered-current-scope-work-to-selected-release')).toBe(false)
  })

  it('rewrites stale thin repo state into only the current-shape manifest', async () => {
    await fs.writeFile(path.join(projectRoot, 'guildhall.yaml'), [
      'name: Migration Test',
      'id: migration-test',
      'storage:',
      '  repoState: thin',
      '',
    ].join('\n'), 'utf8')
    await fs.mkdir(path.join(projectRoot, '.guildhall'), { recursive: true })
    await fs.writeFile(path.join(projectRoot, '.guildhall', 'artifacts.yaml'), [
      'version: 1',
      'artifacts:',
      '  - id: flow-audit',
      '    path: internal/audits/flow-audit.md',
      '',
    ].join('\n'), 'utf8')
    await fs.writeFile(path.join(projectRoot, '.guildhall', 'TASKS.json'), JSON.stringify({
      version: 1,
      tasks: [{
        id: 'task-thin',
        title: 'Thin resumable work',
        status: 'ready',
        spec: 'Enough information to continue.',
        notes: [{ content: 'not exported' }],
      }],
    }, null, 2), 'utf8')
    await fs.writeFile(path.join(projectRoot, '.guildhall', 'MEMORY.md'), '# Old memory\n', 'utf8')

    const result = await applyProjectMigrations({
      projectRoot,
      includePrompt: true,
      only: ['0.10.0/project-state-storage-boundary'],
    })

    expect(result.applied.some(item => item.id === '0.10.0/project-state-storage-boundary')).toBe(true)
    const manifest = JSON.parse(await fs.readFile(path.join(projectRoot, '.guildhall', 'project-state-manifest.json'), 'utf8')) as Record<string, unknown>
    expect(manifest).toMatchObject({
      mode: 'thin',
      currentShape: {
        artifacts: ['flow-audit'],
        activeTasks: [expect.objectContaining({
          id: 'task-thin',
          title: 'Thin resumable work',
          status: 'ready',
          spec: 'Enough information to continue.',
        })],
      },
    })
    expect(JSON.stringify(manifest)).not.toContain('not exported')
    expect(JSON.stringify(manifest)).not.toContain('Old memory')
    await expect(fs.access(path.join(projectRoot, '.guildhall', 'artifacts.yaml'))).resolves.toBeUndefined()
    await expect(fs.access(path.join(projectRoot, '.guildhall', 'TASKS.json'))).rejects.toThrow()
    await expect(fs.access(path.join(projectRoot, '.guildhall', 'MEMORY.md'))).rejects.toThrow()
  })

  it('automatically migrates legacy runtime command JSONL into persistence', async () => {
    const legacyFile = getProjectRuntimeCommandEvidencePath(projectRoot)
    await fs.mkdir(path.dirname(legacyFile), { recursive: true })
    await fs.writeFile(legacyFile, `${JSON.stringify({
      id: 'cmd-legacy',
      projectId: 'migration-test',
      taskId: 'task-legacy',
      request: {
        projectId: 'migration-test',
        cwd: '/workspace/migration-test',
        argv: ['node', '--version'],
        env: {},
        timeoutMs: 5_000,
        expectedPorts: [],
        taskId: 'task-legacy',
      },
      runtime: { id: null, containerId: null },
      status: 'exited',
      exitCode: 0,
      startedAt: '2026-05-27T19:00:00.000Z',
      completedAt: '2026-05-27T19:00:01.000Z',
      events: [],
      error: null,
    })}\n`, 'utf8')

    const result = await applyProjectMigrations({ projectRoot, includePrompt: false })

    expect(result.applied.some(item => item.id === '0.9.0/runtime-command-evidence-persistence')).toBe(true)
    await expect(fs.stat(legacyFile)).rejects.toMatchObject({ code: 'ENOENT' })
    const persistence = new FileBackedGuildhallPersistence()
    const events = await persistence.listEvents({
      projectRoot,
      placement: {
        scope: 'local_history',
        retention: 'active',
        visibility: 'internal_audit',
        commitPolicy: 'ignored',
      },
      collection: 'runtime-command-evidence',
      streamId: 'task-legacy',
    })
    expect(events).toHaveLength(1)
    expect(events[0]?.payload).toMatchObject({
      id: 'cmd-legacy',
      projectId: 'migration-test',
      taskId: 'task-legacy',
    })
  })
})

async function rewriteOwnerInputPrompt(
  root: string,
  requestId: string,
  patch: { prompt: string; choices?: string[] },
): Promise<void> {
  const requestFile = getProjectSystemStatePath(root, path.join('owner-input', `${requestId}.json`))
  const request = JSON.parse(await fs.readFile(requestFile, 'utf8'))
  request.prompt = patch.prompt
  if (patch.choices === undefined) delete request.choices
  else request.choices = patch.choices
  await fs.writeFile(requestFile, `${JSON.stringify(request, null, 2)}\n`, 'utf8')

  const sessionFile = getProjectSystemStatePath(root, path.join('bounded-chat', `${request.boundedChatSessionId}.json`))
  const session = JSON.parse(await fs.readFile(sessionFile, 'utf8'))
  session.subObjectives[0].prompt = patch.prompt
  if (patch.choices === undefined) delete session.subObjectives[0].choices
  else session.subObjectives[0].choices = patch.choices
  await fs.writeFile(sessionFile, `${JSON.stringify(session, null, 2)}\n`, 'utf8')
}
