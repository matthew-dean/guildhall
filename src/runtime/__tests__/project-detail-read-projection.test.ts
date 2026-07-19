import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Task, TaskQueue } from '@guildhall/core'
import {
  getProjectSystemStatePath,
  markProjectSummaryStale,
  promoteProjectStateDatabaseAuthority,
  projectStateDatabasePath,
} from '@guildhall/sessions'
import { writeProjectTaskQueue } from '../project-state-boundary.js'
import { writeProjectSummaryProjectionFromIndexedState } from '../project-summary-projection.js'
import {
  readProjectDetailReadProjection,
  PROJECT_DETAIL_READ_PROJECTION_DEFAULT_LIMIT,
  PROJECT_DETAIL_READ_PROJECTION_MAX_LIMIT,
} from '../project-detail-read-projection.js'

const now = '2026-07-16T12:00:00.000Z'

function task(
  id: string,
  status: string,
  projectRoot: string,
  extra: Record<string, unknown> = {},
): Task {
  return {
    id,
    title: `${id} title`,
    description: `${id} description`,
    domain: 'general',
    projectPath: projectRoot,
    references: [],
    sourceClaims: [],
    status: status as Task['status'],
    priority: 'normal',
    acceptanceCriteria: [],
    outOfScope: [],
    dependsOn: [],
    notes: [],
    gateResults: [],
    reviewVerdicts: [],
    adjudications: [],
    revisionCount: 0,
    remediationAttempts: 0,
    escalations: [],
    agentIssues: [],
    origination: 'human',
    createdAt: now,
    updatedAt: now,
    ...extra,
  }
}

function queue(projectRoot: string): TaskQueue {
  return {
    version: 1,
    lastUpdated: now,
    selectedReleaseId: 'release-one',
    releases: [{
      id: 'release-one',
      label: 'Release One',
      kind: 'release',
      state: 'active',
      source: 'owner_approved',
      proofStyle: 'script_only',
      nodeIds: ['task-one', 'task-two'],
      deferredNodeIds: ['task-three'],
    }],
    tasks: [
      task('task-one', 'ready', projectRoot, { releaseIds: ['release-one'] }),
      task('task-two', 'in_progress', projectRoot, { releaseIds: ['release-one'] }),
      task('task-three', 'done', projectRoot, { dependsOn: ['task-two'] }),
    ],
  }
}

describe('project detail read projection', () => {
  let projectRoot: string | undefined

  afterEach(async () => {
    if (projectRoot) await fs.rm(projectRoot, { recursive: true, force: true })
    projectRoot = undefined
  })

  async function seed(): Promise<string> {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-project-detail-read-'))
    const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
    writeProjectTaskQueue(tasksPath, queue(projectRoot), {
      projectId: 'project-detail-read',
      projectRoot,
    })
    promoteProjectStateDatabaseAuthority(projectRoot)
    writeProjectSummaryProjectionFromIndexedState(tasksPath, {
      projectId: 'project-detail-read',
      sourceQueueLastUpdated: now,
    })
    return projectRoot
  }

  it('returns a bounded, revisioned saved detail surface with an optional task point', async () => {
    const root = await seed()
    const database = new DatabaseSync(projectStateDatabasePath(root))
    database.prepare('UPDATE work_item_detail SET payload_gzip = ?').run(Buffer.from('not gzip'))
    database.close()

    const result = readProjectDetailReadProjection(root, {
      limit: 1,
      selectedTaskId: 'task-two',
    })

    expect(result.status).toBe('current')
    if (result.status !== 'current') throw new Error('expected current detail projection')
    expect(result).toMatchObject({
      schemaVersion: 1,
      freshness: 'current',
      authority: 'database',
      requiresRefresh: false,
      queue: {
        selectedReleaseId: 'release-one',
        tasks: [],
        releases: [{ id: 'release-one', label: 'Release One' }],
      },
      inventory: {
        total: 3,
        offset: 0,
        limit: 1,
        hasMore: true,
      },
      selectedTask: { id: 'task-two', title: 'task-two title', definition: {} },
      selectedTaskId: 'task-two',
      selectedTaskState: 'present',
      scope: { id: 'release-one', label: 'Release One' },
      summary: { freshness: 'current', counts: { total: 3 } },
    })
    expect(result.inventory.tasks).toHaveLength(1)
    expect(result.revisions.queue).toBeGreaterThanOrEqual(0)
    expect(result.revisions.project).toBeGreaterThanOrEqual(0)
  })

  it('uses a finite default and maximum page size instead of allowing an aggregate inventory read', async () => {
    const root = await seed()

    const defaultResult = readProjectDetailReadProjection(root)
    const maxResult = readProjectDetailReadProjection(root, { limit: 1000 })

    expect(defaultResult.status).toBe('current')
    expect(maxResult.status).toBe('current')
    if (defaultResult.status !== 'current' || maxResult.status !== 'current') {
      throw new Error('expected current detail projections')
    }
    expect(defaultResult.inventory.limit).toBe(PROJECT_DETAIL_READ_PROJECTION_DEFAULT_LIMIT)
    expect(maxResult.inventory.limit).toBe(PROJECT_DETAIL_READ_PROJECTION_MAX_LIMIT)
  })

  it('returns stale saved data explicitly when the summary revision needs refresh', async () => {
    const root = await seed()
    markProjectSummaryStale(root)

    const result = readProjectDetailReadProjection(root, { selectedTaskId: 'does-not-exist' })

    expect(result).toMatchObject({
      status: 'stale',
      freshness: 'stale',
      authority: 'database',
      requiresRefresh: true,
      reason: 'summary_stale',
      selectedTaskId: 'does-not-exist',
      selectedTaskState: 'missing',
      summary: { freshness: 'stale' },
    })
    if (result.status !== 'stale') throw new Error('expected stale detail projection')
    expect(result.queue).toBeTruthy()
    expect(result.inventory).toBeTruthy()
    expect(result.revisions.queue).toBeGreaterThanOrEqual(0)
  })

  it('reports a missing summary without hiding the saved queue and inventory', async () => {
    const root = await seed()
    const database = new DatabaseSync(projectStateDatabasePath(root))
    database.exec('DELETE FROM project_summary')
    database.close()

    const result = readProjectDetailReadProjection(root, { limit: 1 })

    expect(result).toMatchObject({
      status: 'missing',
      freshness: 'missing',
      reason: 'summary_missing',
      authority: 'database',
      requiresRefresh: true,
      selectedTaskState: 'not_requested',
      queue: { selectedReleaseId: 'release-one' },
      inventory: { total: 3, limit: 1 },
      summary: null,
    })
  })

  it('fails closed before reading a legacy queue or creating project state', async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-project-detail-missing-'))
    const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
    await fs.mkdir(path.dirname(tasksPath), { recursive: true })
    await fs.writeFile(tasksPath, JSON.stringify({
      version: 1,
      tasks: [{ id: 'legacy-task', title: 'Legacy task', status: 'ready' }],
      releases: [],
    }))

    const result = readProjectDetailReadProjection(projectRoot, { selectedTaskId: 'task-one' })

    expect(result).toMatchObject({
      status: 'missing',
      freshness: 'missing',
      authority: 'legacy',
      reason: 'project_state_not_promoted',
      requiresRefresh: true,
      selectedTaskId: 'task-one',
      selectedTaskState: 'missing',
      queue: null,
      inventory: null,
      summary: null,
    })
    await expect(fs.access(projectStateDatabasePath(projectRoot))).rejects.toThrow()
  })
})
