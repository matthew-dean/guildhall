import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Task, TaskQueue } from '@guildhall/core'
import {
  getProjectSystemStatePath,
  promoteProjectStateDatabaseAuthority,
  writeProjectStateDatabaseTaskMutation,
} from '@guildhall/sessions'
import { writeProjectTaskQueue } from '../project-state-boundary.js'
import {
  ProjectDeliveryModel,
  writeProjectDeliveryModel,
} from '../delivery-spine.js'
import {
  contextPacketFromDeliveryReadProjection,
  readProjectDeliveryReadProjection,
  readProjectDeliveryReadProjectionWithAuthority,
  refreshProjectDeliveryReadProjection,
} from '../delivery-read-projection.js'

const now = '2026-07-16T12:00:00.000Z'

function task(id: string, status: string, extra: Record<string, unknown> = {}): Task {
  return {
    id,
    title: id,
    description: `${id} description`,
    domain: 'delivery',
    projectPath: '/tmp/project',
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

function deliveryModel() {
  return ProjectDeliveryModel.parse({
    version: 1,
    updatedAt: now,
    drivers: [{ id: 'primary', label: 'Primary', role: 'primary' }],
    primitives: [
      {
        id: 'proof-ready',
        label: 'Proof ready',
        kind: 'system',
        status: 'ready',
        proof: ['command'],
        evidence: ['test:proof-ready'],
        invariants: ['The proof command succeeds.'],
      },
      {
        id: 'proof-needed',
        label: 'Proof needed',
        kind: 'system',
        status: 'needs_proof',
        proof: ['command'],
        invariants: ['The proof command exists.'],
      },
    ],
  })
}

function queue(projectRoot: string): TaskQueue {
  return {
    version: 1,
    lastUpdated: now,
    selectedReleaseId: 'release-current',
    releases: [{
      id: 'release-current',
      label: 'Current release',
      kind: 'release',
      state: 'active',
      source: 'owner_approved',
      proofStyle: 'script_only',
      nodeIds: ['work-ready', 'work-proof'],
      deferredNodeIds: [],
    }],
    tasks: [
      task('work-ready', 'ready', {
        projectPath: projectRoot,
        releaseIds: ['release-current'],
        proofPaths: [{
          kind: 'command',
          command: 'node scripts/proof-work-ready.mjs',
          expectedEvidence: ['work-ready'],
        }],
        delivery: { driver: 'primary', usesPrimitives: ['proof-ready'], provesPrimitives: [] },
      }),
      task('work-proof', 'ready', {
        projectPath: projectRoot,
        releaseIds: ['release-current'],
        dependsOn: ['work-ready'],
        delivery: { driver: 'primary', usesPrimitives: ['proof-needed'], provesPrimitives: [] },
      }),
      task('work-done', 'done', {
        projectPath: projectRoot,
        dependsOn: ['work-proof'],
        delivery: { driver: 'primary', usesPrimitives: [], provesPrimitives: ['proof-needed'] },
      }),
    ],
  }
}

describe('delivery read projection', () => {
  let projectRoot: string | undefined

  afterEach(async () => {
    vi.restoreAllMocks()
    if (projectRoot) await fs.rm(projectRoot, { recursive: true, force: true })
    projectRoot = undefined
  })

  async function seed(): Promise<void> {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-delivery-read-projection-'))
    const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
    await writeProjectTaskQueue(tasksPath, queue(projectRoot), { projectId: 'delivery-read', projectRoot })
    promoteProjectStateDatabaseAuthority(projectRoot)
    await writeProjectDeliveryModel(projectRoot, deliveryModel())
  }

  it('reports missing state without creating a database', async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-delivery-read-missing-'))

    const result = await readProjectDeliveryReadProjection(projectRoot)

    expect(result).toMatchObject({ status: 'missing', freshness: 'missing', reason: 'database_missing' })
    expect(await fs.readdir(projectRoot)).toEqual([])
  })

  it('resolves legacy versus promoted authority inside the delivery boundary', async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-delivery-authority-'))

    await expect(readProjectDeliveryReadProjectionWithAuthority(projectRoot)).resolves.toMatchObject({
      authority: 'legacy',
      projection: null,
    })

    await seed()
    await expect(readProjectDeliveryReadProjectionWithAuthority(projectRoot!)).resolves.toMatchObject({
      authority: 'database',
      projection: { status: 'missing', reason: 'projection_missing' },
    })
  })

  it('refreshes compact rows into a revisioned projection and reads bounded pages', async () => {
    await seed()

    const refreshed = await refreshProjectDeliveryReadProjection(projectRoot!)
    expect(refreshed).toMatchObject({
      status: 'current',
      taskCount: 3,
      candidateCount: 2,
      primitiveCount: 2,
    })

    const result = await readProjectDeliveryReadProjection(projectRoot!, {
      queue: { limit: 1 },
      primitiveLimit: 1,
    })
    expect(result.status).toBe('current')
    if (result.status !== 'current') throw new Error('expected current projection')
    expect(result.source.queueRevision).toBeGreaterThanOrEqual(0)
    expect(result.source.projectRevision).toBeGreaterThanOrEqual(0)
    expect(result.queue?.runnable).toHaveLength(1)
    expect(result.queue?.hasMore).toBe(true)
    expect(result.primitives.primitives).toHaveLength(1)
    expect(result.primitives.hasMore).toBe(true)
    expect(result.selectedReleaseId).toBe('release-current')
    expect(result.selectedRelease).toEqual({ id: 'release-current', proofStyle: 'script_only' })
    expect(result.model.primitives).toHaveLength(2)
  })

  it('projects selected script-only proof policy into task context without deriving a command', async () => {
    await seed()
    await refreshProjectDeliveryReadProjection(projectRoot!)

    const attachedProjection = await readProjectDeliveryReadProjection(projectRoot!, {
      queue: false,
      taskId: 'work-ready',
    })
    expect(attachedProjection.status).toBe('current')
    if (attachedProjection.status !== 'current') throw new Error('expected current projection')
    expect(contextPacketFromDeliveryReadProjection(attachedProjection, projectRoot!)?.proofContext.releaseRequirement).toEqual({
      releaseId: 'release-current',
      proofStyle: 'script_only',
      taskContract: 'attached',
    })

    const missingProjection = await readProjectDeliveryReadProjection(projectRoot!, {
      queue: false,
      taskId: 'work-proof',
    })
    expect(missingProjection.status).toBe('current')
    if (missingProjection.status !== 'current') throw new Error('expected current projection')
    expect(contextPacketFromDeliveryReadProjection(missingProjection, projectRoot!)?.proofContext.releaseRequirement).toEqual({
      releaseId: 'release-current',
      proofStyle: 'script_only',
      taskContract: 'missing_contract',
    })
  })

  it('returns relationship facts from indexed edges without an aggregate task select', async () => {
    await seed()
    await refreshProjectDeliveryReadProjection(projectRoot!)

    const prepare = vi.spyOn(DatabaseSync.prototype, 'prepare')
    const result = await readProjectDeliveryReadProjection(projectRoot!, {
      queue: false,
      taskId: 'work-proof',
    })
    const statements = prepare.mock.calls.map(([statement]) => String(statement))

    expect(result.status).toBe('current')
    if (result.status !== 'current') throw new Error('expected current projection')
    expect(result.task).toMatchObject({ id: 'work-proof', dependsOn: ['work-ready'] })
    expect(result.relationships?.dependencies.directBlockers).toEqual([
      { id: 'work-ready', title: 'work-ready', status: 'ready' },
    ])
    expect(result.relationships?.dependencies.blocks).toEqual([
      { id: 'work-done', title: 'work-done', status: 'done' },
    ])
    expect(result.relationships?.primitiveUse.direct).toEqual(['proof-needed'])
    expect(statements.some(statement => /FROM\s+work_items\s+ORDER BY\s+rowid/i.test(statement))).toBe(false)
    expect(statements.some(statement => /FROM\s+delivery_read_projection_candidates/i.test(statement))).toBe(false)
  })

  it('marks the projection stale after the authoritative project revision advances', async () => {
    await seed()
    const refreshed = await refreshProjectDeliveryReadProjection(projectRoot!)
    if (refreshed.status !== 'current' || !refreshed.source) throw new Error('expected refresh')

    const tasksPath = getProjectSystemStatePath(projectRoot!, 'TASKS.json')
    const taskPoint = {
      ...task('work-ready', 'in_progress', { projectPath: projectRoot }),
      delivery: { driver: 'primary', usesPrimitives: ['proof-ready'], provesPrimitives: [] },
    }
    writeProjectStateDatabaseTaskMutation(tasksPath, {
      task: taskPoint,
      summary: {},
      expectedQueueRevision: refreshed.source.queueRevision,
      expectedProjectRevision: refreshed.source.projectRevision,
    })

    const result = await readProjectDeliveryReadProjection(projectRoot!)

    expect(result).toMatchObject({ status: 'stale', freshness: 'stale', reason: 'queue_revision_changed' })
  })

  it('marks the projection stale when the saved delivery model revision advances', async () => {
    await seed()
    await refreshProjectDeliveryReadProjection(projectRoot!)
    await writeProjectDeliveryModel(projectRoot!, {
      ...deliveryModel(),
      updatedAt: '2026-07-16T12:01:00.000Z',
    })

    const result = await readProjectDeliveryReadProjection(projectRoot!)

    expect(result).toMatchObject({ status: 'stale', freshness: 'stale', reason: 'delivery_model_changed' })
  })
})
