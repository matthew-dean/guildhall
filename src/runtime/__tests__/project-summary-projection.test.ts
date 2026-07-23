import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { TaskQueue, type Task } from '@guildhall/core'
import { appendTaskEvidence, getProjectSystemStatePath, markProjectSummaryStale, promoteProjectStateDatabaseAuthority, projectStateDatabaseCompressedDetailPathFromTasksPath, projectStateDatabasePath, readProjectStateDatabaseQueue, readProjectStateDatabaseQueueDefinition, readProjectStateDatabaseQueueRevision, readProjectStateDatabaseInventory, readProjectStateDatabaseSummary, writeProjectStateDatabaseSummarySnapshot } from '@guildhall/sessions'

import {
  buildProjectSummaryProjection,
  buildProjectSummaryProjectionFromIndexedState,
  backfillProjectSummaryProjection,
  PROJECT_SUMMARY_PROJECTION_VERSION,
  projectSummaryProjectionPath,
  queueForProjectSummaryScope,
  readProjectSummaryProjection,
  readProjectSummaryProjectionForMigration,
  readProjectSummaryShellProjection,
  updateProjectSummaryProjection,
  writeProjectSummaryProjectionFromIndexedState,
  writeProjectSummaryProjectionFromUnknownQueue,
} from '../project-summary-projection.js'
import { writePromotedTaskDetailMutation, writeProjectTaskQueue } from '../project-state-boundary.js'

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

  it('keeps an unreadable saved shell local to the affected project', async () => {
    temp = await mkdtemp(join(tmpdir(), 'guildhall-summary-shell-error-'))
    await mkdir(dirname(projectStateDatabasePath(temp)), { recursive: true })
    await writeFile(projectStateDatabasePath(temp), 'not a sqlite database')

    expect(readProjectSummaryShellProjection(getProjectSystemStatePath(temp, 'TASKS.json'))).toBeNull()
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
        taskStatusCounts: { ready: 1, done: 1, blocked: 1 },
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

  it('carries only compact structured source authority into the shared summary', () => {
    const projection = buildProjectSummaryProjection({
      projectId: 'narrative-harness',
      queue: queue([]),
      generatedAt: now,
      sourceCapabilities: [{
        id: 'narrative:voice-shaping',
        adapterId: 'narrative-release-plan',
        adapterSchemaVersion: 1,
        sourceRevision: 'v1',
        label: 'Shape author voice',
        state: 'planned',
        releaseIds: ['headless-mvp'],
        dependsOnCapabilityIds: [],
        evidenceRefs: ['artifact:release-plan'],
      }, {
        id: 'narrative:retired-ui',
        adapterId: 'narrative-release-plan',
        adapterSchemaVersion: 1,
        sourceRevision: 'v1',
        label: 'Retired UI experiment',
        state: 'retired',
        releaseIds: [],
        dependsOnCapabilityIds: [],
        evidenceRefs: [],
      }],
    })

    expect(projection.sourceCapabilityCatalog).toEqual({
      availability: 'ready',
      total: 2,
      planned: 1,
      retired: 1,
    })
    expect(JSON.stringify(projection)).not.toContain('Shape author voice')
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
        acceptanceCriteria: [{
          id: 'ac-done',
          description: 'The completion proof exists.',
          verifiedBy: 'automated',
          source: 'documented',
          met: false,
        }],
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
    expect(indexed?.version).toBe(PROJECT_SUMMARY_PROJECTION_VERSION)
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

  it('keeps the indexed orientation note when a named release has later work', async () => {
    temp = await mkdtemp(join(tmpdir(), 'guildhall-summary-indexed-later-work-'))
    const tasksPath = getProjectSystemStatePath(temp, 'TASKS.json')
    const taskQueue = queue([
      task('task-current-done', 'done'),
      task('task-later-ready', 'ready'),
    ], {
      selectedReleaseId: 'release-current',
      releases: [{
        id: 'release-current',
        label: 'Current release',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        nodeIds: ['work:task-current-done'],
        deferredNodeIds: ['work:task-later-ready'],
      }],
    })
    writeProjectTaskQueue(tasksPath, taskQueue, { projectId: 'indexed-later-work', projectRoot: temp })
    promoteProjectStateDatabaseAuthority(temp)
    const indexed = writeProjectSummaryProjectionFromIndexedState(tasksPath, {
      projectId: 'indexed-later-work',
      sourceQueueLastUpdated: now,
    })

    expect(indexed?.nextAction).toMatchObject({
      code: 'release_ready',
      message: 'Review completed scope.',
    })
    expect(indexed?.orientationSpine?.summary).toMatchObject({
      topBlocker: null,
      nextAction: 'Review completed scope.',
    })
  })

  it('keeps a compact indexed summary when the optional orientation store is missing', async () => {
    temp = await mkdtemp(join(tmpdir(), 'guildhall-summary-indexed-missing-orientation-'))
    const tasksPath = getProjectSystemStatePath(temp, 'TASKS.json')
    const taskQueue = queue([task('task-ready', 'ready')])
    writeProjectTaskQueue(tasksPath, taskQueue, { projectId: 'missing-orientation', projectRoot: temp })
    promoteProjectStateDatabaseAuthority(temp)

    const database = new DatabaseSync(projectStateDatabasePath(temp))
    database.prepare('DELETE FROM project_orientation').run()
    database.close()

    expect(buildProjectSummaryProjectionFromIndexedState(tasksPath, {
      projectId: 'missing-orientation',
      generatedAt: now,
      sourceQueueLastUpdated: now,
    })).toMatchObject({
      version: PROJECT_SUMMARY_PROJECTION_VERSION,
      freshness: 'current',
      projectId: 'missing-orientation',
    })
    expect(writeProjectSummaryProjectionFromIndexedState(tasksPath, {
      projectId: 'missing-orientation',
      sourceQueueLastUpdated: now,
    })).toMatchObject({
      version: PROJECT_SUMMARY_PROJECTION_VERSION,
      freshness: 'current',
      projectId: 'missing-orientation',
    })
  })

  it('refreshes a reopened task proof contract from the bounded indexed summary', async () => {
    temp = await mkdtemp(join(tmpdir(), 'guildhall-summary-current-proof-'))
    const tasksPath = getProjectSystemStatePath(temp, 'TASKS.json')
    const taskQueue = queue([
      task('reopened-task', 'done', {
        releaseIds: ['release-current'],
        completedAt: now,
        proofPaths: [{ kind: 'command', command: 'pnpm prove:reopened-task' }],
        latestReviewerSummary: '**Verdict:** Approved\nThe proof runs `pnpm prove:reopened-task`.',
      }),
    ], {
      selectedReleaseId: 'release-current',
      releases: [{
        id: 'release-current',
        label: 'Current release',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        proofStyle: 'script_only',
        nodeIds: ['work:reopened-task'],
        deferredNodeIds: [],
      }],
    })
    writeProjectTaskQueue(tasksPath, taskQueue, { projectId: 'proof-refresh', projectRoot: temp })
    promoteProjectStateDatabaseAuthority(temp)

    // Seed the old rich projection to reproduce a saved proof contract that
    // predates the task being reopened.
    const historicalProjection = buildProjectSummaryProjection({
      projectId: 'proof-refresh',
      projectRoot: temp,
      queue: taskQueue,
      generatedAt: now,
    })
    const staleOrientation = historicalProjection.orientationSpine
      ? {
          ...historicalProjection.orientationSpine,
          proofContracts: historicalProjection.orientationSpine.proofContracts.map(contract => ({
            ...contract,
            state: 'proven' as const,
            verified: ['Gate passed: pnpm-prove-reopened-task'],
            missing: [],
          })),
        }
      : null
    expect(staleOrientation?.proofContracts[0]?.state).toBe('proven')
    writeProjectStateDatabaseSummarySnapshot(tasksPath, {
      summary: { ...historicalProjection, orientationSpine: staleOrientation },
    })
    expect(((readProjectStateDatabaseSummary(tasksPath)?.payload as Record<string, any> | undefined)?.orientationSpine?.proofContracts as Array<Record<string, any>> | undefined)?.[0]?.state).toBe('proven')

    const committed = writePromotedTaskDetailMutation(tasksPath, 'reopened-task', {
      projectId: 'proof-refresh',
      projectRoot: temp,
      mutate: current => ({
        ...current,
        status: 'spec_review',
        completedAt: undefined,
        proofPaths: [],
      }),
    })
    expect(committed).not.toBeNull()

    expect(readProjectSummaryProjection(tasksPath)?.orientationSpine?.proofContracts[0]).toMatchObject({
      state: 'needed',
      verified: [],
      missing: ['Current proof contract has not been attached yet.'],
    })

    const refreshed = buildProjectSummaryProjectionFromIndexedState(tasksPath, {
      projectId: 'proof-refresh',
      generatedAt: now,
      sourceQueueLastUpdated: now,
    })
    expect(refreshed?.orientationSpine?.proofContracts[0]).toMatchObject({
      state: 'needed',
      missing: ['Current proof contract has not been attached yet.'],
    })
  })

  it('recomputes release proof state when evidence arrives after the saved scope rows', async () => {
    temp = await mkdtemp(join(tmpdir(), 'guildhall-summary-indexed-proof-refresh-'))
    const tasksPath = getProjectSystemStatePath(temp, 'TASKS.json')
    const taskQueue = queue([
      task('task-proof', 'done', {
        releaseIds: ['release-current'],
        completedAt: now,
        acceptanceCriteria: [{
          id: 'ac-proof',
          description: 'The completion proof exists.',
          verifiedBy: 'automated',
          met: false,
        }],
        proofPaths: [{
          kind: 'command',
          command: 'pnpm prove:task-proof',
          expectedEvidence: [{ id: 'ac-proof', required: true }],
        }],
      }),
    ], {
      selectedReleaseId: 'release-current',
      releases: [{
        id: 'release-current',
        label: 'Current release',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        proofStyle: 'script_only',
        nodeIds: ['work:task-proof'],
        deferredNodeIds: [],
      }],
    })
    writeProjectTaskQueue(tasksPath, taskQueue, { projectId: 'indexed-proof-refresh', projectRoot: temp })
    promoteProjectStateDatabaseAuthority(temp)

    expect((readProjectStateDatabaseSummary(tasksPath)?.payload as Record<string, any> | undefined)?.releaseSummary.counts.proofBlocked).toBe(1)

    await appendTaskEvidence(temp, 'task-proof', {
      id: 'gate-proof',
      taskId: 'task-proof',
      kind: 'gate_result',
      recordedAt: '2026-07-14T12:01:00.000Z',
      payload: {
        gateId: 'ac-proof',
        passed: true,
        checkedAt: '2026-07-14T12:01:00.000Z',
        output: 'The completion proof exists.',
      },
    })

    const refreshed = writeProjectSummaryProjectionFromIndexedState(tasksPath, {
      projectId: 'indexed-proof-refresh',
      generatedAt: '2026-07-14T12:01:00.000Z',
      sourceQueueLastUpdated: now,
    })

    expect(refreshed?.releaseSummary.counts.proofBlocked).toBe(0)
    expect(refreshed?.releaseSummary.state).toBe('ready')
    expect(readProjectStateDatabaseInventory(tasksPath, { includeDefinitions: false })?.tasks
      .find(indexed => indexed.id === 'task-proof')?.scopeRow?.proofBlocked).toBe(false)
  })

  it('keeps an absent proof record blocking for completed script-only release work', async () => {
    temp = await mkdtemp(join(tmpdir(), 'guildhall-summary-indexed-missing-proof-'))
    const tasksPath = getProjectSystemStatePath(temp, 'TASKS.json')
    const taskQueue = queue([
      task('task-without-proof-record', 'done', {
        releaseIds: ['release-current'],
        completedAt: now,
      }),
    ], {
      selectedReleaseId: 'release-current',
      releases: [{
        id: 'release-current',
        label: 'Current release',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        proofStyle: 'script_only',
        nodeIds: ['work:task-without-proof-record'],
        deferredNodeIds: [],
      }],
    })
    writeProjectTaskQueue(tasksPath, taskQueue, { projectId: 'indexed-missing-proof', projectRoot: temp })
    promoteProjectStateDatabaseAuthority(temp)

    const refreshed = writeProjectSummaryProjectionFromIndexedState(tasksPath, {
      projectId: 'indexed-missing-proof',
      generatedAt: now,
      sourceQueueLastUpdated: now,
    })

    expect(refreshed?.releaseSummary).toMatchObject({
      state: 'blocked',
      counts: { total: 1, done: 1, unfinished: 0, proofBlocked: 1 },
      blockers: [expect.objectContaining({ id: 'task-without-proof-record', code: 'proof_evidence_missing' })],
    })
    expect(readProjectStateDatabaseInventory(tasksPath, { includeDefinitions: false })?.tasks
      .find(indexed => indexed.id === 'task-without-proof-record')?.scopeRow?.proofBlocked).toBe(true)
  })

  it('uses proven decomposition children to satisfy a stale indexed parent proof', async () => {
    temp = await mkdtemp(join(tmpdir(), 'guildhall-summary-indexed-parent-proof-'))
    const tasksPath = getProjectSystemStatePath(temp, 'TASKS.json')
    const taskQueue = queue([
      task('feature-parent', 'done', {
        releaseIds: ['release-current'],
        completedAt: now,
        acceptanceCriteria: [{
          id: 'ac-parent',
          description: 'The feature boundary is complete.',
          verifiedBy: 'automated',
          met: false,
        }],
        hierarchy: {
          childIds: ['feature-parent-split-proof'],
          relation: 'contains',
        },
      }),
      task('feature-parent-split-proof', 'done', {
        releaseIds: ['release-current'],
        completedAt: now,
        parentId: 'feature-parent',
        proofPaths: [{ kind: 'command', command: 'pnpm prove:feature-parent-split-proof' }],
        acceptanceCriteria: [{
          id: 'ac-child',
          description: 'The proof child passes.',
          verifiedBy: 'automated',
          met: false,
        }],
        hierarchy: {
          parentId: 'feature-parent',
          relation: 'decomposes',
        },
      }),
    ], {
      selectedReleaseId: 'release-current',
      releases: [{
        id: 'release-current',
        label: 'Current release',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        proofStyle: 'script_only',
        nodeIds: ['work:feature-parent'],
        deferredNodeIds: [],
      }],
    })
    writeProjectTaskQueue(tasksPath, taskQueue, { projectId: 'indexed-parent-proof', projectRoot: temp })
    promoteProjectStateDatabaseAuthority(temp)

    const initial = readProjectStateDatabaseSummary(tasksPath)?.payload as Record<string, any> | undefined
    expect(initial?.releaseSummary.counts.proofBlocked).toBe(1)
    expect(initial?.releaseSummary.state).toBe('blocked')

    await appendTaskEvidence(temp, 'feature-parent-split-proof', {
      id: 'gate-child',
      taskId: 'feature-parent-split-proof',
      kind: 'gate_result',
      recordedAt: '2026-07-14T12:00:30.000Z',
      payload: {
        gateId: 'ac-child',
        command: 'pnpm prove:feature-parent-split-proof',
        passed: true,
        checkedAt: '2026-07-14T12:00:30.000Z',
        output: 'The proof child passes.',
      },
    })

    const refreshed = writeProjectSummaryProjectionFromIndexedState(tasksPath, {
      projectId: 'indexed-parent-proof',
      generatedAt: '2026-07-14T12:01:00.000Z',
      sourceQueueLastUpdated: now,
    })

    expect(refreshed?.releaseSummary.counts.proofBlocked).toBe(0)
    expect(refreshed?.releaseSummary.state).toBe('ready')
    expect(readProjectStateDatabaseInventory(tasksPath, { includeDefinitions: false })?.tasks
      .find(indexed => indexed.id === 'feature-parent')?.scopeRow?.proofBlocked).toBe(false)
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

  it('persists explicit structural records in the shared Map projection without retaining raw intake notes', () => {
    const projection = buildProjectSummaryProjection({
      projectId: 'narrative-harness',
      queue: queue([task('task-proof', 'ready')]),
      documentedStructure: [
        {
          id: 'import-structure-story-fact',
          title: 'Story fact',
          description: 'A durable story-state record.',
          refs: ['docs/harness/architecture-notes.md'],
          role: 'capability',
          structure: 'record',
        },
      ],
    })

    expect(projection.documentedStructure).toEqual([
      expect.objectContaining({ id: 'import-structure-story-fact', title: 'Story fact' }),
    ])
    expect(projection.orientationSpine?.roots).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: 'Architecture Notes',
        children: expect.arrayContaining([
          expect.objectContaining({ title: 'Story fact', visibility: { kind: 'supporting' } }),
        ]),
      }),
    ]))
    expect(projection.orientationSpine?.sourceHealth).toMatchObject({ documented: 1, deferred: 0 })
    expect(JSON.stringify(projection.documentedStructure)).not.toContain('raw detector note')
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

  it('treats a matching-version summary without its decision packet as stale', async () => {
    temp = await mkdtemp(join(tmpdir(), 'guildhall-summary-decision-required-'))
    const tasksPath = getProjectSystemStatePath(temp, 'TASKS.json')
    writeProjectTaskQueue(tasksPath, queue([task('decision-ready', 'ready')]), {
      projectId: 'decision-required-project',
      projectRoot: temp,
    })
    promoteProjectStateDatabaseAuthority(temp)
    const projection = writeProjectSummaryProjectionFromIndexedState(tasksPath, {
      projectId: 'decision-required-project',
      sourceQueueLastUpdated: now,
    })!
    const { decision: _decision, ...invalidProjection } = projection
    const database = new DatabaseSync(projectStateDatabasePath(temp))
    database.prepare('UPDATE project_summary SET payload_json = ?, freshness = ? WHERE id = 1')
      .run(JSON.stringify(invalidProjection), 'current')
    database.close()

    expect(readProjectSummaryProjection(tasksPath)).toMatchObject({ freshness: 'stale' })
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
      projectionTasks: [task('evidence-done', 'done', { completedAt: now }) as unknown as Task],
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

  it('keeps the promoted projection current when compatibility planning changes out of band', async () => {
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

    // Once the normalized queue exists, workspace-goals.json is provenance,
    // not a second current-state authority. The saved projection stays
    // current until a Guildhall write marks its database revision stale.
    expect(readProjectSummaryProjection(tasksPath)).toMatchObject({ freshness: 'current' })
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
