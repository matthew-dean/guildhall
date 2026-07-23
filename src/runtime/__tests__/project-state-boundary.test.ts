import { describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { readManagedTextFileSync, writeManagedTextFileSync } from '@guildhall/persistence'
import {
  appendTaskEvidence,
  getProjectSystemStatePath,
  projectStateDatabasePath,
  readProjectStateDatabaseCurrentAuthority,
  readProjectStateDatabaseTaskOverlay,
  readProjectStateDatabaseSourceCapabilities,
  upsertTaskRuntimeState,
  upsertTaskWorkspaceState,
  writeProjectStateDatabaseAvailability,
} from '@guildhall/sessions'
import {
  promoteProjectStateDatabaseAuthority,
  readProjectStateDatabaseCurrentState,
  readProjectStateDatabaseInventory,
  readProjectStateDatabaseProjectionState,
  readProjectStateDatabaseQueueRevision,
  readProjectStateDatabaseQueueDefinition,
  readProjectStateDatabaseTaskPointWithRevision,
  writeProjectStateDatabaseSnapshot,
} from '@guildhall/sessions'

import {
  FORBIDDEN_PROJECT_TASK_FIELDS,
  findForbiddenProjectTaskFields,
  readProjectCanonicalCurrentState,
  readProjectSavedReleaseState,
  projectTaskStateExistsSync,
  readProjectCurrentStateModel,
  readProjectMapStateModel,
  readProjectOverviewStateAtBoundary,
  readProjectStateAuthorityAtBoundary,
  readProjectSurfaceStateAtBoundary,
  readProjectTaskRecordsAtBoundaryWithRevision,
  readProjectTaskCurrentStateAtBoundary,
  readProjectTaskDetailState,
  readProjectTaskDetailStateAtBoundary,
  readProjectTaskQueueForRichMutation,
  sanitizeTaskForProjectWrite,
  sanitizeTaskQueueForProjectWrite,
  readProjectTaskQueueForMutationSync,
  writePromotedTaskDetailMutation,
  writeProjectTaskQueueAtCurrentStateBoundary,
  writeProjectTaskQueueWithSummary,
  upsertProjectSourceCapabilitiesAtBoundary,
} from '../project-state-boundary.js'
import { readProjectSummaryProjection } from '../project-summary-projection.js'

describe('project-state-boundary', () => {
  it('records a structured capability snapshot without manufacturing task work', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-boundary-capability-catalog-'))
    const tasksPath = getProjectSystemStatePath(root, 'TASKS.json')
    try {
      writeProjectTaskQueueWithSummary(tasksPath, {
        version: 1,
        lastUpdated: '2026-07-23T00:00:00.000Z',
        tasks: [{ id: 'task-existing', title: 'Existing work', status: 'ready' }],
        releases: [],
      }, { projectRoot: root })
      promoteProjectStateDatabaseAuthority(root)

      expect(upsertProjectSourceCapabilitiesAtBoundary(tasksPath, [{
        id: 'narrative:world-state-review',
        adapterId: 'narrative-release-plan',
        adapterSchemaVersion: 1,
        sourceRevision: 'v1',
        label: 'Review world state',
        state: 'planned',
        releaseIds: ['headless-mvp'],
        dependsOnCapabilityIds: [],
        evidenceRefs: ['artifact:release-plan'],
      }], { projectRoot: root })).toBe(true)
      expect(readProjectStateDatabaseSourceCapabilities(tasksPath)).toEqual([
        expect.objectContaining({ id: 'narrative:world-state-review' }),
      ])
      expect(readProjectStateDatabaseQueueDefinition(tasksPath)?.tasks).toEqual([
        expect.objectContaining({ id: 'task-existing' }),
      ])
      expect(readProjectSummaryProjection(tasksPath)?.sourceCapabilityCatalog).toEqual({
        availability: 'ready',
        total: 1,
        planned: 1,
        retired: 0,
      })
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('fails closed when a current-state database is present but unreadable', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-boundary-corrupt-db-'))
    const tasksPath = getProjectSystemStatePath(root, 'TASKS.json')
    const databasePath = projectStateDatabasePath(root)

    try {
      await fs.mkdir(path.dirname(databasePath), { recursive: true })
      await fs.writeFile(databasePath, 'not a sqlite database', 'utf8')
      await fs.writeFile(tasksPath, JSON.stringify({
        version: 1,
        lastUpdated: '2026-07-16T00:00:00.000Z',
        tasks: [{ id: 'compatibility-only', title: 'Must not be reopened', status: 'ready' }],
        releases: [],
      }), 'utf8')

      expect(readProjectStateAuthorityAtBoundary(tasksPath)).toMatchObject({
        authority: 'database',
        queueRevision: null,
        projectRevision: 0,
      })
      expect(projectTaskStateExistsSync(tasksPath)).toBe(false)
      expect(() => readProjectTaskQueueForMutationSync(tasksPath)).toThrow()
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('keeps promoted point reads on the durable authority when compatibility data diverges', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-boundary-point-read-'))
    const tasksPath = getProjectSystemStatePath(root, 'TASKS.json')
    const queue = {
      version: 1,
      lastUpdated: '2026-07-16T00:00:00.000Z',
      tasks: [{
        id: 'task-point',
        title: 'Durable task title',
        status: 'ready',
        createdAt: '2026-07-16T00:00:00.000Z',
        updatedAt: '2026-07-16T00:00:00.000Z',
      }],
      releases: [],
    }

    try {
      writeProjectTaskQueueWithSummary(tasksPath, queue, { projectRoot: root })
      promoteProjectStateDatabaseAuthority(root)
      writeManagedTextFileSync(tasksPath, JSON.stringify({
        ...queue,
        tasks: [{ ...queue.tasks[0], title: 'Stale compatibility title' }],
      }, null, 2))

      const read = readProjectTaskRecordsAtBoundaryWithRevision(tasksPath, ['task-point'])
      expect(read.records).toEqual([expect.objectContaining({
        id: 'task-point',
        title: 'Durable task title',
      })])
      expect(read.queueRevision).toEqual(expect.any(Number))
      expect(read.projectRevision).toEqual(expect.any(Number))
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('returns queue, projection, and authority from one current-state boundary', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-boundary-read-model-'))
    const tasksPath = getProjectSystemStatePath(root, 'TASKS.json')
    const queue = {
      version: 1,
      lastUpdated: '2026-07-16T00:00:00.000Z',
      selectedReleaseId: 'release-current',
      releases: [{
        id: 'release-current',
        label: 'Current release',
        kind: 'release',
        state: 'active',
        source: 'owner_approved',
        nodeIds: ['work:task-current'],
        deferredNodeIds: [],
      }],
      tasks: [{
        id: 'task-current',
        title: 'Current task',
        status: 'ready',
        releaseIds: ['release-current'],
        createdAt: '2026-07-16T00:00:00.000Z',
        updatedAt: '2026-07-16T00:00:00.000Z',
      }],
    }

    try {
      writeProjectTaskQueueWithSummary(tasksPath, queue, { projectRoot: root })
      promoteProjectStateDatabaseAuthority(root)
      writeProjectStateDatabaseAvailability(root, {
        status: 'paused',
        pausedAt: '2026-07-16T00:01:00.000Z',
        resumedAt: null,
        reason: 'test pause',
      })

      const current = readProjectCurrentStateModel(tasksPath)
      expect(current.authority).toBe('database')
      expect(current.queueRevision).toBe(readProjectStateDatabaseQueueRevision(tasksPath))
      expect(current.projectRevision).toEqual(expect.any(Number))
      expect(current.queue).toMatchObject({
        selectedReleaseId: 'release-current',
        tasks: [{ id: 'task-current' }],
      })
      expect(current.summary).toMatchObject({
        freshness: 'stale',
        releaseSummary: { release: { id: 'release-current' } },
      })
      const canonical = await readProjectCanonicalCurrentState(root)
      expect(canonical).toMatchObject({
        authority: 'database',
        queueRevision: current.queueRevision,
        projectRevision: current.projectRevision,
        rawQueue: {
          releases: [{ id: 'release-current' }],
          tasks: [{ id: 'task-current' }],
        },
        tasks: [{ id: 'task-current' }],
      })
      const savedRelease = readProjectSavedReleaseState(root)
      expect(savedRelease).toMatchObject({
        authority: 'database',
        queueRevision: current.queueRevision,
        projectRevision: current.projectRevision,
        rawQueue: {
          releases: [{ id: 'release-current' }],
        },
        scopeRows: [{ taskId: 'task-current' }],
      })
      expect(savedRelease.rawQueue).not.toHaveProperty('tasks')
      expect(savedRelease).not.toHaveProperty('tasks')
      const databaseSnapshot = readProjectStateDatabaseCurrentState(tasksPath)
      expect(databaseSnapshot).toMatchObject({
        queueRevision: current.queueRevision,
        projectRevision: current.projectRevision,
        queue: { selectedReleaseId: 'release-current' },
      })
      const compactSnapshot = readProjectStateDatabaseProjectionState(tasksPath, { offset: 0, limit: 10 })
      expect(compactSnapshot).toMatchObject({
        queueRevision: current.queueRevision,
        projectRevision: current.projectRevision,
        queue: {
          selectedReleaseId: 'release-current',
          tasks: [],
          releases: [{ id: 'release-current' }],
        },
        inventory: {
          total: 1,
          tasks: [{ id: 'task-current' }],
        },
      })
      const taskDetail = readProjectTaskDetailState(tasksPath, 'task-current')
      expect(taskDetail).toMatchObject({
        authority: 'database',
        queueRevision: current.queueRevision,
        projectRevision: current.projectRevision,
        queue: { selectedReleaseId: 'release-current' },
        task: { id: 'task-current', title: 'Current task' },
        relationships: { taskId: 'task-current', parentId: null, childIds: [] },
        availability: { status: 'paused', reason: 'test pause' },
      })
      expect(readProjectTaskDetailStateAtBoundary(tasksPath, 'task-current')).toMatchObject({
        authority: 'database',
        state: {
          queueRevision: current.queueRevision,
          projectRevision: current.projectRevision,
          task: { id: 'task-current' },
        },
      })
      const currentTask = await readProjectTaskCurrentStateAtBoundary(root, 'task-current')
      expect(currentTask).toMatchObject({
        authority: 'database',
        state: {
          queueRevision: current.queueRevision,
          projectRevision: current.projectRevision,
        },
        task: { id: 'task-current', title: 'Current task' },
      })
      expect(readProjectStateAuthorityAtBoundary(tasksPath)).toMatchObject({
        authority: 'database',
        queueRevision: current.queueRevision,
        projectRevision: current.projectRevision,
      })
      expect(readProjectMapStateModel(tasksPath)).toMatchObject({
        authority: 'database',
        queueRevision: current.queueRevision,
        projectRevision: current.projectRevision,
        queue: { selectedReleaseId: 'release-current' },
        inventory: {
          total: 1,
          tasks: [{ id: 'task-current', title: 'Current task' }],
        },
      })
      const surface = readProjectSurfaceStateAtBoundary(root, {
        includeThread: true,
        includeAttention: true,
        includeAvailability: true,
        offset: 0,
        limit: 10,
      })
      expect(surface).toMatchObject({
        authority: 'database',
        queueRevision: current.queueRevision,
        projectRevision: current.projectRevision,
        compact: {
          queueRevision: current.queueRevision,
          projectRevision: current.projectRevision,
          inventory: { total: 1 },
        },
        availability: { status: 'paused', reason: 'test pause' },
      })
      const overview = readProjectOverviewStateAtBoundary(root)
      expect(overview).toMatchObject({
        authority: 'database',
        queueRevision: current.queueRevision,
        projectRevision: current.projectRevision,
        // This fixture intentionally carries an older unversioned summary.
        // Overview reads it through the runtime schema boundary, so it is
        // visible but stale instead of being accepted as current state.
        summary: { freshness: 'stale' },
        availability: { status: 'paused', reason: 'test pause' },
      })
      // The Overview boundary intentionally exposes no compact projection:
      // its task cards must be point-hydrated from saved spine IDs instead.
      expect(overview).not.toHaveProperty('compact')
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('fails closed when a promoted database loses its queue row instead of falling back to a compatibility source', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-boundary-authority-'))
    const tasksPath = getProjectSystemStatePath(root, 'TASKS.json')
    try {
      writeProjectTaskQueueWithSummary(tasksPath, {
        version: 1,
        tasks: [{ id: 'task-authority', title: 'Authority task', status: 'ready' }],
        releases: [],
      }, { projectRoot: root })
      promoteProjectStateDatabaseAuthority(root)
      const database = new DatabaseSync(projectStateDatabasePath(root))
      database.exec('DELETE FROM queue_state')
      database.close()

      expect(readProjectStateAuthorityAtBoundary(tasksPath)).toMatchObject({
        authority: 'database',
        queueRevision: null,
      })
      expect(projectTaskStateExistsSync(tasksPath)).toBe(false)
      expect(() => readProjectCurrentStateModel(tasksPath)).toThrow('Authoritative project detail store is unavailable')
      expect(() => readProjectSavedReleaseState(root)).toThrow('Authoritative saved Release projection is unavailable')
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('uses the normalized queue and evidence stores even when the historical authority marker is stale', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-boundary-current-authority-'))
    const tasksPath = getProjectSystemStatePath(root, 'TASKS.json')
    try {
      writeProjectTaskQueueWithSummary(tasksPath, {
        version: 1,
        lastUpdated: '2026-07-16T00:00:00.000Z',
        tasks: [{
          id: 'task-current-authority',
          title: 'Durable task title',
          status: 'ready',
          spec: 'Durable task specification',
        }],
        releases: [],
      }, { projectRoot: root })
      promoteProjectStateDatabaseAuthority(root)
      await appendTaskEvidence(root, 'task-current-authority', {
        id: 'durable-note',
        kind: 'note',
        recordedAt: '2026-07-16T00:01:00.000Z',
        payload: { content: 'Durable evidence note' },
      })

      const database = new DatabaseSync(projectStateDatabasePath(root))
      database.prepare("UPDATE project_meta SET project_state_authority = 'legacy'").run()
      database.close()
      writeManagedTextFileSync(tasksPath, JSON.stringify({
        version: 1,
        tasks: [{ id: 'task-current-authority', title: 'Stale compatibility title', status: 'ready' }],
        releases: [],
      }))

      expect(readProjectStateDatabaseCurrentAuthority(root)).toBe('database')
      const current = await readProjectTaskQueueForRichMutation(root) as {
        tasks: Array<Record<string, unknown>>
      }
      expect(current.tasks[0]).toMatchObject({
        id: 'task-current-authority',
        title: 'Durable task title',
        spec: 'Durable task specification',
        notes: [{ content: 'Durable evidence note' }],
      })
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('strips runtime and evidence fields from active task records before project-local writes', () => {
    const task = {
      id: 'task-payment-oauth',
      title: 'Finish OAuth setup',
      status: 'blocked',
      spec: 'Keep the real spec.',
      notes: Array.from({ length: 60 }, (_, index) => `note ${index}`),
      reviewVerdicts: Array.from({ length: 70 }, (_, index) => ({ reviewer: `r-${index}`, ok: index % 2 === 0 })),
      adjudications: [{ id: 'adj-1' }],
      gateResults: [{ command: 'pnpm test', ok: true }],
      agentIssues: [{ id: 'issue-1', status: 'resolved' }],
      worktreePath: '/tmp/worktree',
      branchName: 'guildhall/task-payment-oauth',
      baseBranch: 'main',
      mergeRecord: { branch: 'guildhall/task-payment-oauth' },
      revisionCount: 9,
      retryWindow: { count: 3 },
      remediationAttempts: 2,
      escalations: [
        {
          id: 'esc-open',
          status: 'open',
          title: 'Need provider credentials',
          summary: 'The provider setup needs owner credentials.',
          question: 'Which provider should be used?',
          createdAt: '2026-06-06T12:00:00.000Z',
          resolvedAt: undefined,
          rawTranscript: 'large raw escalation transcript',
        },
        {
          id: 'esc-resolved',
          status: 'resolved',
          title: 'Resolved blocker',
          summary: 'Already fixed.',
          resolvedAt: '2026-06-06T12:01:00.000Z',
          rawTranscript: 'large resolved transcript',
        },
      ],
    }

    const result = sanitizeTaskForProjectWrite(task)

    for (const field of FORBIDDEN_PROJECT_TASK_FIELDS) {
      expect(result.task).not.toHaveProperty(field)
    }
    expect(result.task).toMatchObject({
      id: 'task-payment-oauth',
      title: 'Finish OAuth setup',
      status: 'blocked',
      spec: 'Keep the real spec.',
      openEscalations: [
        {
          id: 'esc-open',
          status: 'open',
          title: 'Need provider credentials',
          summary: 'The provider setup needs owner credentials.',
          question: 'Which provider should be used?',
          createdAt: '2026-06-06T12:00:00.000Z',
        },
      ],
    })
    expect(JSON.stringify(result.task)).not.toContain('large raw escalation transcript')
    expect(JSON.stringify(result.task)).not.toContain('esc-resolved')
    expect(result.removedFields).toEqual(expect.arrayContaining([
      'notes',
      'reviewVerdicts',
      'escalations',
      'worktreePath',
      'revisionCount',
    ]))
    expect(result.removedEvidenceBytes).toBeGreaterThan(1_000)
  })

  it('sanitizes task queues and reports forbidden fields before cleanup', () => {
    const queue = {
      version: 1,
      tasks: [
        { id: 'clean', title: 'Clean', status: 'ready' },
        { id: 'dirty', title: 'Dirty', status: 'ready', notes: ['note'], gateResults: [{ ok: true }] },
      ],
    }

    expect(findForbiddenProjectTaskFields(queue)).toEqual([
      { taskId: 'dirty', field: 'notes', bytes: expect.any(Number) },
      { taskId: 'dirty', field: 'gateResults', bytes: expect.any(Number) },
    ])

    const result = sanitizeTaskQueueForProjectWrite(queue)

    expect(result.queue).toMatchObject({
      version: 1,
      tasks: [
        { id: 'clean', title: 'Clean', status: 'ready' },
        { id: 'dirty', title: 'Dirty', status: 'ready' },
      ],
    })
    expect(findForbiddenProjectTaskFields(result.queue)).toEqual([])
    expect(result.taskDefinitionsRewritten).toBe(1)
  })

  it('rejects a promoted aggregate caller that tries to change evidence-owned fields', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-boundary-evidence-guard-'))
    const tasksPath = getProjectSystemStatePath(root, 'TASKS.json')
    const queue = {
      version: 1,
      lastUpdated: '2026-07-15T00:00:00.000Z',
      releases: [],
      tasks: [{ id: 'task-1', title: 'Task', status: 'ready', projectPath: root }],
    }
    try {
      writeProjectTaskQueueWithSummary(tasksPath, queue, { projectRoot: root })
      promoteProjectStateDatabaseAuthority(root)
      expect(() => writeProjectTaskQueueWithSummary(tasksPath, {
        ...queue,
        lastUpdated: '2026-07-15T00:01:00.000Z',
        tasks: [{ ...queue.tasks[0], notes: [{ role: 'human', content: 'This must be evidence.' }] }],
      }, { expectedQueueRevision: readProjectStateDatabaseQueueRevision(tasksPath) }))
        .toThrow(/evidence\/runtime-owned field notes/i)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('allows parser-default empty evidence fields through structural writes', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-boundary-empty-evidence-'))
    const tasksPath = getProjectSystemStatePath(root, 'TASKS.json')
    const queue = {
      version: 1,
      lastUpdated: '2026-07-15T00:00:00.000Z',
      releases: [],
      tasks: [{ id: 'task-1', title: 'Task', status: 'ready', projectPath: root }],
    }
    try {
      writeProjectTaskQueueWithSummary(tasksPath, queue, { projectRoot: root })
      promoteProjectStateDatabaseAuthority(root)
      expect(() => writeProjectTaskQueueWithSummary(tasksPath, {
        ...queue,
        lastUpdated: '2026-07-15T00:01:00.000Z',
        tasks: [{ ...queue.tasks[0], title: 'Renamed task', notes: [], reviewVerdicts: [] }],
      }, { expectedQueueRevision: readProjectStateDatabaseQueueRevision(tasksPath) }))
        .not.toThrow()
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('preserves release selection when a task-only repair rewrites the queue', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-boundary-'))
    const tasksPath = path.join(root, 'TASKS.json')
    const release = {
      id: 'stage-1',
      label: 'Stage 1',
      kind: 'release',
      state: 'active',
      source: 'owner_approved',
      nodeIds: ['work:task-1'],
      deferredNodeIds: [],
      proofStyle: 'script_only',
    }
    try {
      writeManagedTextFileSync(tasksPath, JSON.stringify({
        version: 1,
        lastUpdated: '2026-07-14T00:00:00.000Z',
        selectedReleaseId: 'stage-1',
        releases: [release],
        tasks: [{ id: 'task-1', title: 'Task', status: 'ready' }],
      }))

      writeProjectTaskQueueWithSummary(tasksPath, {
        version: 1,
        lastUpdated: '2026-07-14T00:01:00.000Z',
        tasks: [{ id: 'task-1', title: 'Task', status: 'ready', projectPath: root }],
      })

      expect(JSON.parse(readManagedTextFileSync(tasksPath, 'utf8'))).toMatchObject({
        selectedReleaseId: 'stage-1',
        releases: [release],
      })
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('keeps named-release membership bounded when a split adds unassigned child rows', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-boundary-release-membership-'))
    const tasksPath = getProjectSystemStatePath(root, 'TASKS.json')
    const release = {
      id: 'release-1',
      label: 'First release',
      kind: 'release',
      state: 'active',
      source: 'owner_approved',
      nodeIds: ['work:task-parent'],
      deferredNodeIds: [],
    }

    try {
      writeProjectTaskQueueWithSummary(tasksPath, {
        version: 1,
        lastUpdated: '2026-07-15T00:00:00.000Z',
        selectedReleaseId: 'release-1',
        releases: [release],
        tasks: [
          {
            id: 'task-parent',
            title: 'Parent task',
            status: 'ready',
            releaseIds: ['release-1'],
          },
          {
            id: 'task-child',
            title: 'Split child',
            status: 'ready',
            parentId: 'task-parent',
          },
        ],
      }, { projectRoot: root })
      promoteProjectStateDatabaseAuthority(root)

      const saved = readProjectSavedReleaseState(root)

      expect(saved.scope).toMatchObject({
        id: 'release-1',
        nodeIds: ['work:task-parent'],
        deferredNodeIds: [],
      })
      expect(saved.scope?.nodeIds).not.toContain('work:task-child')
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('refreshes the shared summary projections at the queue write boundary', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-boundary-summary-'))
    const tasksPath = path.join(root, 'TASKS.json')
    const release = {
      id: 'release-1',
      label: 'First release',
      kind: 'release',
      state: 'active',
      source: 'owner_approved',
      nodeIds: ['work:task-1'],
      deferredNodeIds: [],
      proofStyle: 'script_only',
    }

    try {
      writeProjectTaskQueueWithSummary(tasksPath, {
        version: 1,
        lastUpdated: '2026-07-15T00:00:00.000Z',
        selectedReleaseId: 'release-1',
        releases: [release],
        tasks: [{
          id: 'task-1',
          title: 'Write the proof',
          description: 'A complete task',
          domain: 'general',
          projectPath: root,
          status: 'ready',
          priority: 'normal',
          spec: 'Run the proof.',
          references: [],
          sourceClaims: [],
          acceptanceCriteria: [{ id: 'ac-1', description: 'The proof passes.', met: false }],
          outOfScope: [],
          dependsOn: [],
          notes: [],
          gateResults: [],
          escalations: [],
          createdAt: '2026-07-15T00:00:00.000Z',
          updatedAt: '2026-07-15T00:00:00.000Z',
          releaseIds: ['release-1'],
        }],
      })

      const summary = readProjectSummaryProjection(tasksPath)

      expect(summary).toMatchObject({
        freshness: 'current',
        counts: { total: 1, included: 1, ready: 1 },
        scope: { id: 'release-1', included: 1, deferred: 0 },
        releaseSummary: {
          scopeMode: 'named_release',
          release: { id: 'release-1', label: 'First release' },
        },
        nextAction: { code: 'ready_work', focusTaskId: 'task-1' },
        orientationSpine: expect.objectContaining({
          summary: expect.objectContaining({ includedWorkCount: 1 }),
        }),
        actionModel: expect.any(Object),
      })
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('uses the normalized database revision for bootstrap CAS', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-boundary-bootstrap-cas-'))
    const tasksPath = getProjectSystemStatePath(root, 'TASKS.json')
    const queue = {
      version: 1,
      lastUpdated: '2026-07-15T00:00:00.000Z',
      releases: [],
      tasks: [{ id: 'task-1', title: 'Task', status: 'ready', projectPath: root }],
    }

    try {
      writeProjectTaskQueueWithSummary(tasksPath, queue, { projectRoot: root })
      const mutationRead = readProjectTaskQueueForMutationSync(tasksPath)
      expect(mutationRead.expectedQueueRevision).toBeTypeOf('number')

      writeProjectStateDatabaseSnapshot(tasksPath, {
        queue,
        summary: readProjectSummaryProjection(tasksPath) ?? { generatedAt: '2026-07-15T00:01:00.000Z', freshness: 'current' },
        expectedQueueRevision: mutationRead.expectedQueueRevision,
      })

      expect(() => writeProjectTaskQueueWithSummary(tasksPath, {
        ...queue,
        lastUpdated: '2026-07-15T00:02:00.000Z',
        tasks: [{ ...queue.tasks[0], title: 'Stale writer' }],
      }, { expectedQueueRevision: mutationRead.expectedQueueRevision }))
        .toThrow(/Stale targeted task batch: expected revision \d+, found \d+/)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('uses the targeted transaction for one promoted detail-only task change', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-boundary-targeted-'))
    const tasksPath = getProjectSystemStatePath(root, 'TASKS.json')
    const initialQueue = {
      version: 1,
      lastUpdated: '2026-07-15T00:00:00.000Z',
      releases: [],
      tasks: [
        { id: 'task-1', title: 'First task', status: 'ready' },
        { id: 'task-2', title: 'Second task', status: 'ready' },
      ],
    }
    try {
      writeProjectTaskQueueWithSummary(tasksPath, initialQueue, { projectRoot: root })
      promoteProjectStateDatabaseAuthority(root)
      const promotedRevision = readProjectStateDatabaseQueueRevision(tasksPath)
      expect(promotedRevision).not.toBeNull()
      writeProjectStateDatabaseSnapshot(tasksPath, {
        queue: initialQueue,
        summary: readProjectSummaryProjection(tasksPath) ?? { generatedAt: '2026-07-15T00:00:00.000Z', freshness: 'current' },
        expectedQueueRevision: promotedRevision,
      })
      const currentRevision = readProjectStateDatabaseQueueRevision(tasksPath)
      expect(currentRevision).not.toBeNull()

      writeProjectTaskQueueWithSummary(tasksPath, {
        ...initialQueue,
        lastUpdated: '2026-07-15T00:01:00.000Z',
        tasks: [
          { id: 'task-1', title: 'First task, clarified', status: 'ready' },
          { id: 'task-2', title: 'Second task', status: 'ready' },
        ],
      }, { expectedQueueRevision: currentRevision })

      expect(readProjectStateDatabaseQueueRevision(tasksPath)).toBeGreaterThan(currentRevision!)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('mutates one promoted task from its point read and refreshes the indexed summary', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-boundary-point-mutation-'))
    const tasksPath = getProjectSystemStatePath(root, 'TASKS.json')
    const initialQueue = {
      version: 1,
      lastUpdated: '2026-07-15T00:00:00.000Z',
      selectedReleaseId: 'release-1',
      releases: [{
        id: 'release-1',
        label: 'Current work',
        kind: 'release',
        state: 'active',
        source: 'owner_approved',
        nodeIds: ['work:task-1', 'work:task-2'],
        deferredNodeIds: [],
      }],
      tasks: [
        {
          id: 'task-1',
          title: 'First task',
          status: 'ready',
          createdAt: '2026-07-15T00:00:00.000Z',
          updatedAt: '2026-07-15T00:00:00.000Z',
          spec: 'A real spec.',
          acceptanceCriteria: [{ id: 'ac-1', description: 'The first proof exists.', met: false }],
          releaseIds: ['release-1'],
          references: [],
          sourceClaims: [],
        },
        {
          id: 'task-2',
          title: 'Untouched task',
          status: 'ready',
          createdAt: '2026-07-15T00:00:00.000Z',
          updatedAt: '2026-07-15T00:00:00.000Z',
          releaseIds: ['release-1'],
        },
      ],
    }
    try {
      writeProjectTaskQueueWithSummary(tasksPath, initialQueue, { projectRoot: root })
      promoteProjectStateDatabaseAuthority(root)
      const beforeDatabase = new DatabaseSync(projectStateDatabasePath(root), { readOnly: true })
      const untouchedBefore = beforeDatabase.prepare('SELECT payload_gzip FROM work_item_detail WHERE task_id = ?').get('task-2') as { payload_gzip: Uint8Array }
      beforeDatabase.close()

      const result = writePromotedTaskDetailMutation(tasksPath, 'task-1', {
        projectId: 'point-mutation-test',
        projectRoot: root,
        mutate: task => {
          const criteria = Array.isArray(task.acceptanceCriteria) ? [...task.acceptanceCriteria as Array<Record<string, unknown>>] : []
          criteria.push({ id: 'ac-2', description: 'The second proof exists.', verifiedBy: 'review', source: 'documented', met: false })
          task.acceptanceCriteria = criteria
          task.updatedAt = '2026-07-15T00:01:00.000Z'
          return task
        },
      })

      expect(result?.committedRevision).toBeGreaterThan(0)
      expect(readProjectSummaryProjection(tasksPath)).toMatchObject({
        freshness: 'current',
        counts: { total: 2, included: 2, ready: 1 },
        nextAction: { code: 'ready_work', focusTaskId: 'task-1' },
      })
      expect(readProjectStateDatabaseInventory(tasksPath, { includeDefinitions: false })?.tasks.find(task => task.id === 'task-1'))
        .toMatchObject({ currentSummary: { acceptanceCriteriaCount: 2 } })
      expect(readProjectStateDatabaseTaskPointWithRevision(tasksPath, 'task-1')?.task.definition.acceptanceCriteria).toHaveLength(2)
      const afterDatabase = new DatabaseSync(projectStateDatabasePath(root), { readOnly: true })
      const untouchedAfter = afterDatabase.prepare('SELECT payload_gzip FROM work_item_detail WHERE task_id = ?').get('task-2') as { payload_gzip: Uint8Array }
      expect(Buffer.from(untouchedAfter.payload_gzip)).toEqual(Buffer.from(untouchedBefore.payload_gzip))
      afterDatabase.close()
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('refreshes shared scope and action state when a promoted brief becomes approved', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-boundary-approved-brief-'))
    const tasksPath = getProjectSystemStatePath(root, 'TASKS.json')
    const initialQueue = {
      version: 1,
      lastUpdated: '2026-07-23T00:00:00.000Z',
      selectedReleaseId: 'release-1',
      releases: [{
        id: 'release-1', label: 'Current work', kind: 'release', state: 'active', source: 'owner_approved',
        nodeIds: ['work:task-shaping', 'work:task-untouched'], deferredNodeIds: [],
      }],
      tasks: [
        {
          id: 'task-shaping', title: 'Shape a source-backed spec', status: 'exploring',
          updatedAt: '2026-07-23T00:00:00.000Z', releaseIds: ['release-1'],
        },
        {
          id: 'task-untouched', title: 'Keep this payload untouched', status: 'ready',
          updatedAt: '2026-07-23T00:00:00.000Z', releaseIds: ['release-1'],
          spec: 'Executable proof.', acceptanceCriteria: [{ id: 'ac-untouched', description: 'The proof exists.' }],
        },
      ],
    }
    try {
      writeProjectTaskQueueWithSummary(tasksPath, initialQueue, { projectRoot: root })
      promoteProjectStateDatabaseAuthority(root)
      const beforeDatabase = new DatabaseSync(projectStateDatabasePath(root), { readOnly: true })
      const untouchedBefore = beforeDatabase.prepare('SELECT payload_gzip FROM work_item_detail WHERE task_id = ?').get('task-untouched') as { payload_gzip: Uint8Array }
      beforeDatabase.close()

      const result = writePromotedTaskDetailMutation(tasksPath, 'task-shaping', {
        projectId: 'approved-brief',
        projectRoot: root,
        mutate: task => ({
          ...task,
          updatedAt: '2026-07-23T00:01:00.000Z',
          productBrief: {
            userJob: 'Turn documented story intent into a runnable CLI workflow.',
            whyItMattersNow: 'The selected release needs an executable spec.',
            successMetric: 'The spec names its inputs, proof, and review boundary.',
            nonGoals: ['Do not broaden into a visual editor.'],
            approvedAt: '2026-07-23T00:01:00.000Z',
          },
        }),
      })

      expect(result?.committedRevision).toBeGreaterThan(0)
      expect(readProjectStateDatabaseInventory(tasksPath, { includeDefinitions: false })?.tasks.find(task => task.id === 'task-shaping'))
        .toMatchObject({ currentSummary: { brief: { present: true, shaped: true, approvedAt: '2026-07-23T00:01:00.000Z' } } })
      const summary = readProjectSummaryProjection(tasksPath)
      expect(summary).not.toBeNull()
      const primaryAction = summary?.actionModel?.primaryAction
      expect(primaryAction).not.toBeNull()
      expect(primaryAction!).toMatchObject({
        source: 'task',
        taskId: 'task-shaping',
        detail: 'Guildhall is shaping a source-backed spec from the approved brief.',
      })
      expect(summary!.releaseSummary).toMatchObject({
        state: 'shaping',
        blockers: [],
      })
      const afterDatabase = new DatabaseSync(projectStateDatabasePath(root), { readOnly: true })
      const untouchedAfter = afterDatabase.prepare('SELECT payload_gzip FROM work_item_detail WHERE task_id = ?').get('task-untouched') as { payload_gzip: Uint8Array }
      expect(Buffer.from(untouchedAfter.payload_gzip)).toEqual(Buffer.from(untouchedBefore.payload_gzip))
      afterDatabase.close()
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('does not resurrect historical completion when a promoted task is reopened', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-boundary-reopen-completion-'))
    const tasksPath = getProjectSystemStatePath(root, 'TASKS.json')
    const completedAt = '2026-07-15T00:00:00.000Z'
    const queue = {
      version: 1,
      lastUpdated: completedAt,
      tasks: [{
        id: 'task-reopen',
        title: 'Reopen me',
        status: 'exploring',
        completedAt,
        doneSummaryBundle: {
          taskId: 'task-reopen',
          status: 'reopened',
          completedAt,
          reopenedAt: '2026-07-15T00:01:00.000Z',
          reopenReason: 'Fresh spec pass',
          summary: { journey: 'old', decision: 'old', evidence: 'old', learningCandidates: [], openResidue: 'old' },
          retention: { transcriptPrimaryArtifact: false, compactedFullTranscript: false, fullEvidenceAvailable: true },
          evidenceRefs: [],
          createdAt: '2026-07-15T00:01:00.000Z',
          createdBy: 'test',
        },
      }],
    }

    try {
      writeProjectTaskQueueWithSummary(tasksPath, queue, { projectRoot: root })
      promoteProjectStateDatabaseAuthority(root)

      const result = writePromotedTaskDetailMutation(tasksPath, 'task-reopen', {
        projectRoot: root,
        mutate: task => {
          task.completedAt = undefined
          task.updatedAt = '2026-07-15T00:02:00.000Z'
          return task
        },
      })

      expect(result?.task).not.toHaveProperty('completedAt')
      const point = readProjectStateDatabaseTaskPointWithRevision(tasksPath, 'task-reopen')
      expect(point?.task.completedAt).toBeNull()
      expect(point?.task.definition).toMatchObject({
        doneSummaryBundle: expect.objectContaining({
          status: 'reopened',
          reopenReason: 'Fresh spec pass',
        }),
      })
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('uses the targeted transaction for a promoted structural task delta', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-boundary-batch-'))
    const tasksPath = getProjectSystemStatePath(root, 'TASKS.json')
    const initialQueue = {
      version: 1,
      lastUpdated: '2026-07-15T00:00:00.000Z',
      releases: [],
      tasks: [
        { id: 'task-1', title: 'Parent task', status: 'ready' },
        { id: 'task-2', title: 'Untouched task', status: 'ready' },
      ],
    }
    try {
      writeProjectTaskQueueWithSummary(tasksPath, initialQueue, { projectRoot: root })
      promoteProjectStateDatabaseAuthority(root)
      const promotedRevision = readProjectStateDatabaseQueueRevision(tasksPath)
      expect(promotedRevision).not.toBeNull()
      writeProjectStateDatabaseSnapshot(tasksPath, {
        queue: initialQueue,
        summary: readProjectSummaryProjection(tasksPath) ?? { generatedAt: '2026-07-15T00:00:00.000Z', freshness: 'current' },
        expectedQueueRevision: promotedRevision,
      })
      const beforeDatabase = new DatabaseSync(projectStateDatabasePath(root), { readOnly: true })
      const untouchedBefore = beforeDatabase.prepare('SELECT payload_gzip FROM work_item_detail WHERE task_id = ?').get('task-2') as { payload_gzip: Uint8Array }
      beforeDatabase.close()
      const currentRevision = readProjectStateDatabaseQueueRevision(tasksPath)

      writeProjectTaskQueueWithSummary(tasksPath, {
        ...initialQueue,
        lastUpdated: '2026-07-15T00:01:00.000Z',
        tasks: [
          { id: 'task-1', title: 'Parent task', status: 'ready', hierarchy: { childIds: ['task-3'] } },
          { id: 'task-2', title: 'Untouched task', status: 'ready' },
          { id: 'task-3', title: 'New child', status: 'ready', hierarchy: { parentId: 'task-1' } },
        ],
      }, { expectedQueueRevision: currentRevision })

      expect(readProjectStateDatabaseQueueDefinition(tasksPath)?.tasks).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'task-3', title: 'New child' }),
      ]))
      const afterDatabase = new DatabaseSync(projectStateDatabasePath(root), { readOnly: true })
      const untouchedAfter = afterDatabase.prepare('SELECT payload_gzip FROM work_item_detail WHERE task_id = ?').get('task-2') as { payload_gzip: Uint8Array }
      expect(Buffer.from(untouchedAfter.payload_gzip)).toEqual(Buffer.from(untouchedBefore.payload_gzip))
      afterDatabase.close()
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('removes legacy overlay fields from a promoted detail before persisting an ordinary edit', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-boundary-detail-cleanup-'))
    const tasksPath = getProjectSystemStatePath(root, 'TASKS.json')
    const queue = {
      version: 1,
      lastUpdated: '2026-07-15T00:00:00.000Z',
      tasks: [{
        id: 'task-legacy-detail',
        title: 'Legacy detail',
        status: 'ready',
        assignedTo: 'old-worker',
        notes: [{ id: 'note-1', content: 'Old evidence' }],
        proofRecovery: { reopenedAt: '2026-07-15T00:00:00.000Z' },
        shelveReason: {
          code: 'not_viable',
          detail: 'Old shelving state',
          rejectedBy: 'old-worker',
          rejectedAt: '2026-07-15T00:00:00.000Z',
        },
        worktreePath: '/tmp/old-worktree',
      }],
    }

    try {
      writeProjectTaskQueueWithSummary(tasksPath, queue, { projectRoot: root })
      promoteProjectStateDatabaseAuthority(root)

      const result = writePromotedTaskDetailMutation(tasksPath, 'task-legacy-detail', {
        projectRoot: root,
        mutate: task => {
          task.title = 'Clean detail'
          task.updatedAt = '2026-07-15T00:01:00.000Z'
          return task
        },
      })

      expect(result?.task).not.toHaveProperty('assignedTo')
      const definition = readProjectStateDatabaseTaskPointWithRevision(tasksPath, 'task-legacy-detail')?.task.definition
      expect(definition).toMatchObject({ id: 'task-legacy-detail', title: 'Clean detail' })
      for (const field of FORBIDDEN_PROJECT_TASK_FIELDS) {
        expect(definition).not.toHaveProperty(field)
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('replaces rich overlays and removes orphaned task state during re-intake', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-boundary-overlay-replace-'))
    const tasksPath = getProjectSystemStatePath(root, 'TASKS.json')
    const initialQueue = {
      version: 1,
      lastUpdated: '2026-07-15T00:00:00.000Z',
      tasks: [
        { id: 'task-keep', title: 'Keep', status: 'ready' },
        { id: 'task-remove', title: 'Remove', status: 'ready' },
      ],
    }

    try {
      writeProjectTaskQueueWithSummary(tasksPath, initialQueue, { projectRoot: root })
      promoteProjectStateDatabaseAuthority(root)
      await upsertTaskRuntimeState(root, 'task-keep', {
        assignedTo: 'old-worker',
        revisionCount: 12,
        updatedAt: '2026-07-15T00:00:01.000Z',
      })
      await upsertTaskWorkspaceState(root, 'task-keep', {
        worktreePath: '/tmp/old-worktree',
        branchName: 'old-branch',
        updatedAt: '2026-07-15T00:00:01.000Z',
      })
      await upsertTaskRuntimeState(root, 'task-remove', {
        assignedTo: 'orphan-worker',
        updatedAt: '2026-07-15T00:00:01.000Z',
      })
      await appendTaskEvidence(root, 'task-remove', {
        id: 'orphan-proof',
        kind: 'gate_result',
        recordedAt: '2026-07-15T00:00:01.000Z',
        payload: { gateId: 'build', passed: false },
      })

      const beforeReintake = readProjectStateDatabaseCurrentState(tasksPath)
      expect(beforeReintake).not.toBeNull()

      await writeProjectTaskQueueAtCurrentStateBoundary(tasksPath, {
        ...initialQueue,
        lastUpdated: '2026-07-15T00:01:00.000Z',
        tasks: [{
          id: 'task-keep',
          title: 'Keep, re-intaked',
          status: 'ready',
          updatedAt: '2026-07-15T00:01:00.000Z',
          assignedTo: null,
          notes: [{
            id: 'reintake-note',
            role: 'system',
            agentId: 'reintake',
            content: 'Re-intake evidence',
            timestamp: '2026-07-15T00:01:00.000Z',
          }],
        }],
      }, {
        projectRoot: root,
        expectedQueueRevision: readProjectStateDatabaseQueueRevision(tasksPath),
      })

      expect(readProjectStateDatabaseTaskOverlay(root, 'task-keep')).toMatchObject({
        runtime: { payload: { taskId: 'task-keep', assignedTo: null } },
      })
      expect(readProjectStateDatabaseTaskOverlay(root, 'task-keep')?.runtime?.payload).not.toHaveProperty('revisionCount')
      expect(readProjectStateDatabaseTaskOverlay(root, 'task-keep')?.workspace).toBeUndefined()
      expect(readProjectStateDatabaseTaskOverlay(root, 'task-remove')).toEqual({})
      const afterReintake = readProjectStateDatabaseCurrentState(tasksPath)
      expect(afterReintake?.projectRevision).toBe((beforeReintake?.projectRevision ?? 0) + 1)
      const canonical = await readProjectCanonicalCurrentState(root)
      expect(canonical.tasks.find(task => task.id === 'task-keep')).toMatchObject({
        assignedTo: null,
        notes: [expect.objectContaining({ content: 'Re-intake evidence' })],
      })
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})
