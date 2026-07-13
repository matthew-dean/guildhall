import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { bootstrapWorkspace, setProvider, updateGlobalConfig, updateProjectConfig, writeWorkspaceConfig } from '@guildhall/config'
import {
  appendTaskEvidence,
  getProjectContextDebugLedgerPath,
  getProjectRecentEventsPath,
  getProjectStateDir,
  getProjectSystemStatePath,
  readTaskRuntimeStore,
  readTaskWorkspaceStore,
  upsertTaskRuntimeState,
  upsertTaskWorkspaceState,
} from '@guildhall/sessions'
import { activeEscalations, raiseEscalation, readExploringTranscript, writeCheckpoint } from '@guildhall/tools'
import { buildServeApp, filterEventsForTask } from '../serve.js'
import { OrchestratorSupervisor } from '../serve-supervisor.js'
import { createReviewAuditStore } from '../review-audit-store.js'
import { FileBackedGuildhallPersistence } from '@guildhall/persistence'
import { loadBoundedChatSession } from '../bounded-chat.js'
import { createOwnerInputRequest, listOwnerInputRequests } from '../owner-input-store.js'
import {
  stageContractChangeSet,
  validateProjectPrimitiveSetupResult,
  writeProjectDeliveryModel,
  emptyProjectDeliveryModel,
} from '../delivery-spine.js'
import { writeProjectTaskQueue } from '../project-state-boundary.js'
import {
  buildEffectiveTask,
  legacyEvidenceFromTask,
  legacyRuntimeFromTask,
  legacyWorkspaceFromTask,
} from '../effective-task.js'

// Integration tests for the v0.2 UI endpoints:
//   GET  /api/project/task/:id        — per-task detail powering the drawer
//   POST /api/project/task/:id/hold   — human hold → blocked, reversible
//   POST /api/project/task/:id/shelve — human override → shelved
//   GET  /api/project/activity        — summary for the persistent chip

let tmpDir: string
let memoryDir: string
let projectId: string

function projectUrl(route: string): string {
  const url = new URL(`http://localhost${route}`)
  url.searchParams.set('projectId', projectId)
  return url.toString()
}

function taskQueuePath(): string {
  return getProjectSystemStatePath(tmpDir, 'TASKS.json')
}

async function readTaskQueue(): Promise<Record<string, any>> {
  const parsed = JSON.parse(await fs.readFile(taskQueuePath(), 'utf8')) as Record<string, any>
  return Array.isArray(parsed) ? { version: 1, tasks: parsed } : parsed
}

async function writeTaskQueue(queue: Record<string, any>): Promise<void> {
  const tasks = Array.isArray(queue.tasks) ? queue.tasks : []
  for (const task of tasks) {
    const runtime = legacyRuntimeFromTask(task)
    const workspace = legacyWorkspaceFromTask(task)
    const evidence = legacyEvidenceFromTask(task)
    if (runtime) await upsertTaskRuntimeState(tmpDir, task.id, runtime)
    if (workspace) await upsertTaskWorkspaceState(tmpDir, task.id, workspace)
    for (const event of evidence) {
      await appendTaskEvidence(tmpDir, task.id, event)
    }
  }
  writeProjectTaskQueue(taskQueuePath(), queue)
}

async function writeRawTaskQueue(queue: Record<string, any>): Promise<void> {
  await fs.mkdir(path.dirname(taskQueuePath()), { recursive: true })
  await fs.writeFile(taskQueuePath(), JSON.stringify(queue, null, 2) + '\n', 'utf8')
}

async function readEffectiveTask(id: string): Promise<Record<string, any>> {
  const queue = await readTaskQueue()
  const task = queue.tasks.find((entry: Record<string, any>) => entry.id === id)
  if (!task) throw new Error(`Missing seeded task ${id}`)
  return await buildEffectiveTask(tmpDir, task as any) as Record<string, any>
}

async function applyStorageBoundaryMigration(app: ReturnType<typeof buildServeApp>['app']): Promise<void> {
  const migration = await app.fetch(
    new Request(projectUrl('/api/project/migrations/apply'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        includePrompt: true,
        migrationId: '0.10.0/project-state-storage-boundary',
      }),
    }),
  )
  expect(migration.status).toBe(200)
}

async function seedTask(id: string, overrides: Record<string, any> = {}): Promise<void> {
  const queue = {
    version: 1,
    lastUpdated: new Date().toISOString(),
    tasks: [
      {
        id,
        title: 'Seeded task for tests',
        description: 'A test task',
        domain: 'looma',
        projectPath: tmpDir,
        status: 'in_progress',
        priority: 'normal',
        revisionCount: 0,
        remediationAttempts: 0,
        origination: 'human',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...overrides,
      },
    ],
  }
  await writeTaskQueue(queue)
}

async function seedRawTaskDefinition(id: string, overrides: Record<string, any> = {}): Promise<void> {
  const queue = {
    version: 1,
    lastUpdated: new Date().toISOString(),
    tasks: [
      {
        id,
        title: 'Seeded task for tests',
        description: 'A test task',
        domain: 'looma',
        projectPath: tmpDir,
        status: 'in_progress',
        priority: 'normal',
        revisionCount: 0,
        remediationAttempts: 0,
        origination: 'human',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...overrides,
      },
    ],
  }
  await writeRawTaskQueue(queue)
}

async function seedTasks(tasks: Array<Record<string, any>>): Promise<void> {
  const now = new Date().toISOString()
  const queue = {
    version: 1,
    lastUpdated: now,
    tasks: tasks.map((task, index) => ({
      id: `task-${index + 1}`,
      title: `Seeded task ${index + 1}`,
      description: 'A test task',
      domain: 'looma',
      projectPath: tmpDir,
      status: 'ready',
      priority: 'normal',
      revisionCount: 0,
      remediationAttempts: 0,
      origination: 'human',
      createdAt: now,
      updatedAt: now,
      ...task,
    })),
  }
  await writeTaskQueue(queue)
}

function createTrackingSupervisor(): {
  supervisor: OrchestratorSupervisor
  starts: Array<{ preferredTaskId?: string; stopAfterOneTask?: boolean }>
} {
  const starts: Array<{ preferredTaskId?: string; stopAfterOneTask?: boolean }> = []
  const supervisor = new OrchestratorSupervisor({
    resolveConfig: () => ({ workspaceId: projectId, projectPath: tmpDir } as any),
    runOrchestrator: async (_config, opts) => {
      starts.push({
        ...(opts?.preferredTaskId ? { preferredTaskId: opts.preferredTaskId } : {}),
        ...(opts?.stopAfterOneTask ? { stopAfterOneTask: true } : {}),
      })
      await new Promise<void>((resolve) => {
        if (opts?.abortSignal?.aborted) {
          resolve()
          return
        }
        opts?.abortSignal?.addEventListener('abort', () => resolve(), { once: true })
      })
      return { ticks: 1, stopReason: 'stop_requested', stopMessage: 'Stop requested.' }
    },
  })
  return { supervisor, starts }
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-serve-tasks-'))
  process.env.GUILDHALL_DATA_DIR = path.join(tmpDir, '.guildhall-data')
  process.env.GUILDHALL_CONFIG_DIR = path.join(tmpDir, '.guildhall-config')
  projectId = bootstrapWorkspace(tmpDir, { name: 'Task Endpoints Test' }).id ?? path.basename(tmpDir)
  memoryDir = getProjectStateDir(tmpDir)
})

afterEach(async () => {
  delete process.env.GUILDHALL_DATA_DIR
  delete process.env.GUILDHALL_CONFIG_DIR
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('GET /api/project/task/:id', () => {
  it('returns the task body + (empty) recent events for a seeded task', async () => {
    await seedTask('task-1')
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/task/task-1')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.task?.id).toBe('task-1')
    expect(body.task?.status).toBe('in_progress')
    expect(Array.isArray(body.recentEvents)).toBe(true)
    expect(Array.isArray(body.contextDebug)).toBe(true)
  })

  it('builds drawer work progress from effective proof state, not stale raw task records', async () => {
    await seedTask('task-1', {
      title: 'Run fixture evaluator proof',
      status: 'done',
      proofPaths: [{ expectedEvidence: ['runner-smoke'] }],
      gateResults: [],
    })
    await appendTaskEvidence(tmpDir, 'task-1', {
      id: 'gate-task-1-runner-smoke',
      kind: 'gate_result',
      recordedAt: '2026-07-06T12:00:00.000Z',
      payload: {
        gateId: 'runner-smoke',
        status: 'pass',
        checkedAt: '2026-07-06T12:00:00.000Z',
      },
    })

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/task/task-1')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>

    expect(body.task?.completionProof).toMatchObject({ state: 'verified' })
    expect(body.workProgress?.byTaskId?.['task-1']).toMatchObject({
      rollup: {
        primaryState: 'done',
        requiredStepCount: 1,
        doneStepCount: 1,
      },
    })
    expect(body.workProgress?.byTaskId?.['task-1']?.deliverySteps).toEqual([
      expect.objectContaining({
        id: 'proof:1',
        status: 'done',
      }),
    ])
  })

  it('returns adjacent task links for hierarchy and dependency display', async () => {
    await seedTasks([
      {
        id: 'task-parent',
        title: 'Parent task',
        hierarchy: { childIds: ['task-1'], order: 0 },
      },
      {
        id: 'task-1',
        title: 'Current task',
        hierarchy: { parentId: 'task-parent', childIds: ['task-child'], order: 1 },
        dependsOn: ['task-blocker'],
        sizePlan: {
          taskId: 'task-1',
          score: 8,
          band: 'epic',
          action: 'split_required',
          reviewBudgetHint: 'release_critical',
          reasons: ['Task size score: 8.'],
          factors: [],
          recommendedChildren: [
            {
              title: 'Materialized child',
              reason: 'Created during split.',
              suggestedDomain: 'frontend',
              dependsOn: [],
              createdTaskId: 'task-child',
            },
          ],
        },
      },
      {
        id: 'task-child',
        title: 'Child task',
        hierarchy: { parentId: 'task-1', order: 0 },
      },
      {
        id: 'task-blocker',
        title: 'Blocking task',
      },
      {
        id: 'task-dependent',
        title: 'Dependent task',
        dependsOn: ['task-1'],
      },
      {
        id: 'task-unrelated',
        title: 'Unrelated task',
      },
    ])

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/task/task-1')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>

    expect(body.relatedTasks?.map((task: Record<string, any>) => task.id).sort()).toEqual([
      'task-blocker',
      'task-child',
      'task-dependent',
      'task-parent',
    ])
  })

  it('returns shared delivery-spine relationships and context packets for task detail', async () => {
    await writeProjectDeliveryModel(tmpDir, {
      version: 1,
      updatedAt: '2026-06-05T12:00:00.000Z',
      drivers: [
        { id: 'knit', label: 'Knit', role: 'primary', paths: ['./apps/knit'], domains: ['looma'] },
        { id: 'looma', label: 'Looma', role: 'provider', paths: ['./packages/looma'], domains: ['looma'] },
      ],
      primitives: [
        {
          id: 'menu-item',
          label: 'MenuItem',
          kind: 'ui_primitive',
          provider: 'looma',
          paths: ['./packages/looma/src/menu'],
          dependsOn: [],
          invariants: ['Can render as button or link.'],
          proof: ['storybook'],
          status: 'needs_proof',
          evidence: [],
          aliases: [],
        },
      ],
      validationEvidence: [],
      rejectedCandidates: [],
    })
    await seedTasks([
      {
        id: 'task-component',
        title: 'Component implementation',
        status: 'done',
        delivery: { driver: 'knit', provider: 'looma', usesPrimitives: ['menu-item'] },
      },
      {
        id: 'task-storybook',
        title: 'Storybook proof',
        dependsOn: ['task-component'],
        delivery: { driver: 'knit', provider: 'looma', provesPrimitives: ['menu-item'], proofKind: 'storybook' },
      },
    ])

    const { app } = buildServeApp({ projectPath: tmpDir })
    const detailRes = await app.fetch(new Request(projectUrl('/api/project/task/task-component')))
    expect(detailRes.status).toBe(200)
    const detail = (await detailRes.json()) as Record<string, any>
    expect(detail.deliverySpine.contextPacket.deliveryIntent.driver.label).toBe('Knit')
    expect(detail.deliverySpine.contextPacket.primitiveContext.direct.map((primitive: any) => primitive.id)).toEqual(['menu-item'])
    expect(detail.deliverySpine.relationships.primitiveUse.blockers.map((primitive: any) => primitive.id)).toEqual(['menu-item'])

    const projectRes = await app.fetch(new Request(projectUrl('/api/project')))
    expect(projectRes.status).toBe(200)
    const project = (await projectRes.json()) as Record<string, any>
    expect(project.deliverySpine.queue.firstRunnable.task.id).toBe('task-storybook')
    expect(project.deliverySpine.validation.valid).toBe(true)
  })

  it('heals stale worker ownership for in_progress tasks when reading task detail', async () => {
    await seedRawTaskDefinition('task-1', { assignedTo: null })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/task/task-1')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.task?.assignedTo).toBe('worker-agent')

    const raw = JSON.parse(await fs.readFile(taskQueuePath(), 'utf8')) as Record<string, any>
    expect(raw.tasks[0]?.assignedTo).toBe('worker-agent')
  })

  it('heals completed tasks that were left blocked without a block reason', async () => {
    await seedRawTaskDefinition('task-1', {
      status: 'blocked',
      blockReason: null,
      completedAt: '2026-06-17T05:20:00.000Z',
      assignedTo: null,
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/task/task-1')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.task?.status).toBe('done')
    expect(body.task?.completedAt).toBe('2026-06-17T05:20:00.000Z')
    expect(body.task?.blockReason).toBeUndefined()
    expect(body.task?.notes.at(-1)?.content).toContain('Recovered completed task from stale blocked status')

    const raw = JSON.parse(await fs.readFile(taskQueuePath(), 'utf8')) as Record<string, any>
    expect(raw.tasks[0]?.status).toBe('done')
    expect(raw.tasks[0]?.blockReason).toBeUndefined()
  })

  it('returns recent context debug records for the task', async () => {
    await seedTask('task-1')
    const ledgerPath = getProjectContextDebugLedgerPath(tmpDir)
    await fs.mkdir(path.dirname(ledgerPath), { recursive: true })
    await fs.writeFile(
      ledgerPath,
      [
        JSON.stringify({
          id: 'older',
          taskId: 'task-1',
          agentName: 'worker-agent',
          modelId: 'qwen/test',
          promptPreview: 'older prompt',
          at: '2026-05-02T00:00:00.000Z',
          sections: [],
          health: [],
          reasons: [],
        }),
        JSON.stringify({
          id: 'newer',
          taskId: 'task-1',
          agentName: 'reviewer-agent',
          modelId: 'qwen/test',
          promptPreview: 'newer prompt',
          at: '2026-05-02T00:01:00.000Z',
          sections: [],
          health: [],
          reasons: [],
        }),
      ].join('\n') + '\n',
      'utf8',
    )
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/task/task-1')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.contextDebug?.map((record: Record<string, any>) => record.id)).toEqual([
      'newer',
      'older',
    ])
  })

  it('includes a stored review plan in the task drawer payload', async () => {
    await seedTask('task-1', { status: 'review' })
    const store = createReviewAuditStore({
      projectRoot: tmpDir,
      persistence: new FileBackedGuildhallPersistence(),
      now: () => new Date('2026-05-25T12:00:00.000Z'),
    })
    await store.saveReviewPlan({
      taskId: 'task-1',
      effort: 'balanced',
      depth: 'standard',
      selectedLanes: ['ux_comprehension', 'test_adequacy'],
      requiredRecipes: [{
        recipeId: 'product-ux-zero-context',
        version: 'v1',
        lanes: ['ux_comprehension'],
        blocking: 'high',
        required: true,
        calibrationRecipeIds: ['ux-zero-context-comprehension'],
      }],
      budget: { maxReviewerAgents: 4, maxWallClockMinutes: 18 },
      createdBy: 'coordinator-review-planner',
    })

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/task/task-1')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>

    expect(body.task?.reviewPlan).toMatchObject({
      taskId: 'task-1',
      effort: 'balanced',
      depth: 'standard',
      selectedLanes: ['ux_comprehension', 'test_adequacy'],
      budget: { maxReviewerAgents: 4, maxWallClockMinutes: 18 },
    })
  })

  it('includes a compact review audit summary in the task drawer payload', async () => {
    await seedTask('task-1', { status: 'review' })
    const store = createReviewAuditStore({
      projectRoot: tmpDir,
      persistence: new FileBackedGuildhallPersistence(),
      now: () => new Date('2026-05-25T12:00:00.000Z'),
    })
    await store.saveReviewerRun({
      taskId: 'task-1',
      recipeId: 'product-ux-zero-context',
      recipeVersion: 'v1',
      lanes: ['ux_comprehension'],
      verdict: 'revise',
      findings: [{
        lane: 'ux_comprehension',
        severity: 'high',
        summary: 'Primary action is ambiguous.',
      }],
      recordedAt: '2026-05-25T12:01:00.000Z',
      recordedBy: 'reviewer-fanout:component-designer',
    })
    await store.saveReviewerRun({
      taskId: 'task-1',
      recipeId: 'product-ux-zero-context',
      recipeVersion: 'v1',
      lanes: ['copy_clarity'],
      verdict: 'approve',
      recordedAt: '2026-05-25T12:02:00.000Z',
      recordedBy: 'reviewer-fanout:copywriter',
    })
    await store.linkEscapedMiss({
      taskId: 'task-1',
      missedLane: 'ux_comprehension',
      humanFinding: 'Reviewer missed that the setup action was unclear.',
      nextCalibrationAction: 'create_case',
      recordedBy: 'human:test',
    })

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/task/task-1')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>

    expect(body.task?.reviewAuditSummary).toEqual({
      reviewerRunCount: 2,
      reviseCount: 1,
      escapedMissCount: 1,
      latestReviewerRunAt: '2026-05-25T12:02:00.000Z',
    })
  })

  it('returns the exploring transcript artifact for the task drawer', async () => {
    await seedTask('task-1')
    await fs.mkdir(path.join(memoryDir, 'exploring'), { recursive: true })
    await fs.writeFile(
      path.join(memoryDir, 'exploring', 'task-1.md'),
      [
        '# Exploring transcript: task-1',
        '',
        '## [2026-05-19T23:48:34.395Z] system',
        '',
        'Imported from project notes. Turn this into a complete task.',
        '',
        '---',
        '## [2026-05-19T23:49:39.164Z] spec-agent',
        '',
        'Let me find the source note first.',
        '',
        '---',
      ].join('\n'),
      'utf8',
    )

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/task/task-1')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.exploringTranscript?.path).toBe(path.join(memoryDir, 'exploring', 'task-1.md'))
    expect(body.exploringTranscript?.content).toContain('Let me find the source note first.')
  })

  it('filters stale acceptance-note transcript entries that no longer match canonical criteria', async () => {
    await seedTask('task-1', {
      acceptanceCriteria: [
        {
          id: 'ac-1',
          description: 'Redirects to /<slug> when membership resolves.',
          verifiedBy: 'review',
          met: false,
        },
      ],
      notes: [
        {
          agentId: 'human',
          role: 'specifier',
          timestamp: new Date(Date.now() - 60_000).toISOString(),
          content: 'Added acceptance criterion: Redirects to /.',
        },
        {
          agentId: 'human',
          role: 'specifier',
          timestamp: new Date(Date.now() - 30_000).toISOString(),
          content: 'Added acceptance criterion: Redirects to /<slug> when membership resolves.',
        },
        {
          agentId: 'reviewer-agent',
          role: 'reviewer',
          timestamp: new Date().toISOString(),
          content: 'Keep the /signup fallback explicit.',
        },
      ],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/task/task-1')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.task?.notes).toHaveLength(2)
    expect(body.task?.notes?.map((note: Record<string, any>) => note.content)).toEqual([
      'Added acceptance criterion: Redirects to /<slug> when membership resolves.',
      'Keep the /signup fallback explicit.',
    ])
  })

  it('serves the current proof-recovery blocker instead of stale max-revisions text', async () => {
    await seedTask('task-1', {
      status: 'blocked',
      blockReason: 'max_revisions_exceeded: reviewer loop hit its old cap before proof recovery reopened.',
      proofRecovery: {
        reopenedAt: '2026-07-07T09:50:00.000Z',
        reason: 'provider_missing: DEEPINFRA_API_TOKEN is required.',
      },
      acceptanceCriteria: [{
        id: 'provider-proof',
        description: 'Live provider proof records telemetry.',
        verifiedBy: 'review',
        met: true,
      }],
      gateResults: [{
        gateId: 'prove-provider.live',
        type: 'hard',
        passed: false,
        output: 'DEEPINFRA_API_TOKEN is required.',
        checkedAt: '2026-07-07T10:00:00.000Z',
      }],
      mergeRecord: {
        fromBranch: 'guildhall/task-1',
        toBranch: 'main',
        strategy: 'cherry_pick_local',
        result: 'merged',
        commitSha: 'abc123',
        mergedAt: '2026-07-07T09:59:00.000Z',
      },
      runtime: {
        openEscalationIds: ['esc-task-1'],
      },
      escalations: [{
        id: 'esc-task-1',
        taskId: 'task-1',
        agentId: 'coordinator',
        reason: 'max_revisions_exceeded',
        summary: 'Reviewer loop hit its old cap.',
        raisedAt: '2026-07-07T09:40:00.000Z',
      }],
    })

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/task/task-1')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>

    expect(body.task?.blockReason).toBe('provider_missing: DEEPINFRA_API_TOKEN is required.')
    expect(body.task?.persistedBlockReason).toBe('max_revisions_exceeded: reviewer loop hit its old cap before proof recovery reopened.')
    expect(body.task?.runtime?.proofRecovery?.reason).toBe('provider_missing: DEEPINFRA_API_TOKEN is required.')
    expect(body.task?.runtime?.openEscalationIds).toEqual([])
    expect(body.task?.terminalSummary).toBeUndefined()
    expect(body.task?.acceptanceCriteria).toEqual([
      expect.objectContaining({
        id: 'provider-proof',
        met: false,
        persistedMet: true,
        verificationState: 'stale',
        staleReason: 'provider_missing: DEEPINFRA_API_TOKEN is required.',
        staleGateId: 'prove-provider.live',
      }),
    ])
    expect(body.task?.acceptanceCriteriaProofState).toMatchObject({
      state: 'blocked',
      reason: 'provider_missing: DEEPINFRA_API_TOKEN is required.',
      staleMetCount: 1,
      gateId: 'prove-provider.live',
    })

    const projectRes = await app.fetch(new Request(projectUrl('/api/project')))
    expect(projectRes.status).toBe(200)
    const projectBody = (await projectRes.json()) as Record<string, any>
    const projectTask = projectBody.tasks?.find((entry: Record<string, any>) => entry.id === 'task-1')
    expect(projectTask?.runtime?.openEscalationIds).toEqual([])
  })

  it('surfaces derived reviewer, self-critique, and checkpoint summaries', async () => {
    await seedTask('task-1', {
      status: 'review',
      notes: [
        {
          agentId: 'worker-agent',
          role: 'self-critique',
          timestamp: new Date(Date.now() - 60_000).toISOString(),
          content: 'Self-critique: focused use-collections tests are green.',
        },
        {
          agentId: 'reviewer-fanout',
          role: 'reviewer',
          timestamp: new Date().toISOString(),
          content: '**Aggregated revisions from 2 personas:**\n\nNeed direct file excerpts in the packet.',
        },
      ],
    })
    await writeCheckpoint({
      tasksPath: taskQueuePath(),
      memoryDir,
      taskId: 'task-1',
      agentId: 'worker-agent',
      intent: 'Verify focused unit tests',
      nextPlannedAction: 'Hand off to review',
      filesTouched: ['web/tests/unit/composables/use-collections.test.ts'],
    })

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/task/task-1')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.task?.latestReviewerSummary).toContain('Aggregated revisions')
    expect(body.task?.latestSelfCritique).toContain('focused use-collections tests are green')
    expect(body.task?.latestCheckpoint?.intent).toBe('Verify focused unit tests')
    expect(body.task?.latestCheckpoint?.nextPlannedAction).toBe('Hand off to review')
  })

  it('hides stale reviewer summaries after a max-revisions retry was resolved', async () => {
    await seedTask('task-1', {
      status: 'in_progress',
      notes: [
        {
          agentId: 'reviewer-fanout',
          role: 'reviewer',
          timestamp: '2026-05-09T01:00:00.000Z',
          content: 'Recommended task-local revisions:\n- Add broad platform ceremony.',
        },
      ],
      escalations: [
        {
          id: 'esc-task-1-3',
          taskId: 'task-1',
          agentId: 'reviewer-fanout',
          reason: 'max_revisions_exceeded',
          summary: 'Exceeded maxRevisions (3). Reviewer fan-out keeps rejecting.',
          raisedAt: '2026-05-09T01:02:00.000Z',
          resolvedAt: '2026-05-09T01:05:00.000Z',
          resolvedBy: 'human',
          resolution: 'Retry with narrower reviewer scope.',
        },
      ],
    })

    const { app } = buildServeApp({ projectPath: tmpDir })
    const detailRes = await app.fetch(new Request(projectUrl('/api/project/task/task-1')))
    expect(detailRes.status).toBe(200)
    const detailBody = (await detailRes.json()) as Record<string, any>
    expect(detailBody.task?.latestReviewerSummary).toBeUndefined()

    const projectRes = await app.fetch(new Request(projectUrl('/api/project')))
    const projectBody = (await projectRes.json()) as Record<string, any>
    expect(projectRes.status, projectBody.error).toBe(200)
    const task = projectBody.tasks?.find((entry: Record<string, any>) => entry.id === 'task-1')
    expect(task?.latestReviewerSummary).toBeUndefined()
  })

  it('includes derived reviewer/self-critique/checkpoint summaries on /api/project task rows too', async () => {
    await seedTask('task-1', {
      status: 'review',
      notes: [
        {
          agentId: 'worker-agent',
          role: 'self-critique',
          timestamp: new Date(Date.now() - 60_000).toISOString(),
          content: 'Self-critique: focused use-collections tests are green.',
        },
        {
          agentId: 'reviewer-fanout',
          role: 'reviewer',
          timestamp: new Date().toISOString(),
          content: '**Aggregated revisions from 2 personas:**\n\nNeed direct file excerpts in the packet.',
        },
      ],
    })
    await writeCheckpoint({
      tasksPath: taskQueuePath(),
      memoryDir,
      taskId: 'task-1',
      agentId: 'worker-agent',
      intent: 'Verify focused unit tests',
      nextPlannedAction: 'Hand off to review',
      filesTouched: ['web/tests/unit/composables/use-collections.test.ts'],
    })

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    const task = body.tasks?.find((entry: Record<string, any>) => entry.id === 'task-1')
    expect(task?.latestReviewerSummary).toContain('Aggregated revisions')
    expect(task?.latestSelfCritique).toContain('focused use-collections tests are green')
    expect(task?.latestCheckpoint?.intent).toBe('Verify focused unit tests')
    expect(task?.evidenceSummary?.counts?.notes).toBeGreaterThanOrEqual(2)
    expect(task?.evidenceSummary?.counts?.reviewVerdicts).toBe(0)
    expect(task?.evidenceSummary?.counts?.adjudications).toBe(0)
    expect(task?.evidenceSummary?.counts?.gateResults).toBe(0)
    expect(task?.evidenceSummary?.latest?.kind).toBe('note')
    expect(task?.notes).toBeUndefined()
  })

  it('keeps /api/project task rows compact while task detail remains full fidelity', async () => {
    await seedRawTaskDefinition('task-1', {
      status: 'blocked',
      title: 'Compact project task',
      description: 'Show this in project orientation.',
      spec: '## Summary\n\nThis full worker handoff belongs in task detail.',
      acceptanceCriteria: [{ description: 'The project row still shows proof needs.' }],
      openQuestions: [
        {
          id: 'question-1',
          askedBy: 'spec-agent',
          askedAt: '2026-06-01T00:00:00.000Z',
          kind: 'text',
          prompt: 'Which proof path matters?',
        },
      ],
      notes: [
        {
          role: 'worker',
          agentId: 'worker-agent',
          timestamp: '2026-06-01T00:01:00.000Z',
          content: 'Verbose transcript note that should not ship in the project summary.',
        },
      ],
      evidence: [
        {
          kind: 'command',
          summary: 'Long command proof stored for detail views.',
          output: 'x'.repeat(5000),
        },
      ],
      requestIntake: {
        source: 'workspace-import',
        rawText: 'Large intake source text that belongs in detail.',
      },
      productBrief: {
        successMetric: 'This whole brief belongs in detail.',
        approvedAt: '2026-06-01T00:02:00.000Z',
      },
      reviewPlan: {
        effort: 'release_critical',
        reasons: ['Large reviewer plan belongs in detail.'],
      },
      reviewAuditSummary: {
        reviewerRunCount: 3,
        reviseCount: 1,
      },
      latestReviewerSummary: 'Short project-card review summary may remain.',
      latestSelfCritique: 'Short self-critique summary may remain.',
      gitStory: {
        state: 'local_only',
        samplePaths: ['src/large-file.ts'],
        nextAction: 'Inspect repository state in detail.',
      },
      runtime: {
        openEscalationIds: ['esc-1'],
        transcript: 'Large runtime payload that belongs in detail.',
      },
      escalations: [
        {
          id: 'esc-1',
          taskId: 'task-1',
          agentId: 'worker-agent',
          reason: 'human_judgment_required',
          summary: 'Needs owner decision.',
          raisedAt: '2026-06-01T00:03:00.000Z',
        },
      ],
    })

    const { app } = buildServeApp({ projectPath: tmpDir })

    const projectRes = await app.fetch(new Request(projectUrl('/api/project')))
    const projectBody = (await projectRes.json()) as Record<string, any>
    expect(projectRes.status, projectBody.error).toBe(200)
    const projectTask = projectBody.tasks?.find((entry: Record<string, any>) => entry.id === 'task-1')
    expect(projectTask).toMatchObject({
      id: 'task-1',
      title: 'Compact project task',
      description: 'Show this in project orientation.',
      status: 'blocked',
      latestReviewerSummary: 'Short project-card review summary may remain.',
      latestSelfCritique: 'Short self-critique summary may remain.',
    })
    expect(projectTask?.acceptanceCriteria?.[0]?.description).toBe('The project row still shows proof needs.')
    expect(projectTask?.openQuestions?.[0]?.prompt).toBe('Which proof path matters?')
    expect(projectTask?.escalations?.[0]?.id).toBe('esc-1')
    expect(projectTask?.runtime).toEqual({ openEscalationIds: ['esc-1'] })
    expect(projectTask?.spec).toBeUndefined()
    expect(projectTask?.notes).toBeUndefined()
    expect(projectTask?.evidence).toBeUndefined()
    expect(projectTask?.requestIntake).toBeUndefined()
    expect(projectTask?.productBrief).toBeUndefined()
    expect(projectTask?.reviewPlan).toBeUndefined()
    expect(projectTask?.reviewAuditSummary).toBeUndefined()
    expect(projectTask?.gitStory).toBeUndefined()

    const detailRes = await app.fetch(new Request(projectUrl('/api/project/task/task-1')))
    expect(detailRes.status).toBe(200)
    const detailBody = (await detailRes.json()) as Record<string, any>
    expect(detailBody.task?.spec).toContain('full worker handoff')
    expect(detailBody.task?.notes?.[0]?.content).toContain('Verbose transcript note')
    expect(detailBody.task?.requestIntake?.rawText).toContain('Large intake')
    expect(detailBody.task?.productBrief?.successMetric).toContain('whole brief')
    expect(detailBody.task?.reviewPlan?.effort).toBe('release_critical')
  })

  it('keeps the Work-surface project payload scoped to queue and shared shell state', async () => {
    await seedTask('task-storybook', {
      title: 'Prove the menu primitive',
      status: 'ready',
      workKind: 'verification',
      spec: '## Full worker handoff\n\nThis belongs on the task detail endpoint.',
      acceptanceCriteria: [{ description: 'Storybook proof exists.' }],
      sourceRefs: ['docs/storybook.md', 'docs/menu.md'],
      references: ['docs/storybook.md', 'docs/menu.md'],
      projectPath: '/tmp/storybook-project',
      createdAt: '2026-06-01T00:00:00.000Z',
      origination: 'human',
      remediationAttempts: 2,
      taskReadiness: {
        recommendation: 'ready',
        summary: 'Task is ready for a focused worker pass.',
        dimensions: [{ id: 'context_load', evidence: ['full diagnostic detail belongs elsewhere'] }],
      },
      latestCheckpoint: {
        step: 3,
        agentId: 'worker-agent',
        intent: 'Long checkpoint intent belongs on task detail.',
        nextPlannedAction: 'Rerun Storybook proof.',
        filesTouched: ['packages/editor/src/menu.ts'],
        writtenAt: '2026-06-01T01:00:00.000Z',
      },
      notes: [{
        role: 'worker',
        agentId: 'worker-agent',
        timestamp: '2026-06-01T01:30:00.000Z',
        content: '**Self-critique:** full detail belongs on the task drawer.',
      }],
      definitionOfDone: {
        items: ['Long done item belongs on task detail.'],
        evidenceRequired: ['Storybook proof screenshot.'],
      },
      escalations: [{
        id: 'esc-storybook',
        taskId: 'task-storybook',
        reason: 'decision_required',
        summary: 'Verbose escalation belongs on task detail.',
        raisedAt: '2026-06-01T02:00:00.000Z',
      }],
      evidence: [{
        kind: 'command',
        summary: 'Verbose proof',
        output: 'x'.repeat(1000),
        recordedAt: '2026-06-01T02:00:00.000Z',
      }],
    })
    await writeProjectDeliveryModel(tmpDir, {
      version: 1,
      updatedAt: '2026-06-05T12:00:00.000Z',
      drivers: [{ id: 'knit', label: 'Knit', role: 'primary' }],
      primitives: [{
        id: 'menu-item',
        label: 'Menu item',
        kind: 'ui_primitive',
        status: 'proposed',
        provingTaskIds: ['task-storybook'],
      }],
    })

    const { app } = buildServeApp({ projectPath: tmpDir })
    const workRes = await app.fetch(new Request(projectUrl('/api/project?surface=work&task=task-storybook')))
    const workBody = (await workRes.json()) as Record<string, any>
    const overviewRes = await app.fetch(new Request(projectUrl('/api/project?surface=overview')))
    const overviewBody = (await overviewRes.json()) as Record<string, any>

    expect(workRes.status, workBody.error).toBe(200)
    expect(overviewRes.status, overviewBody.error).toBe(200)
    expect(overviewBody.orientationSpine?.sourceHealth).toEqual(workBody.orientationSpine?.sourceHealth)
    expect(workBody.selectedTaskId).toBe('task-storybook')
    expect(workBody.tasks?.some((task: Record<string, any>) => task.id === 'task-storybook')).toBe(true)
    const workTask = workBody.tasks?.find((task: Record<string, any>) => task.id === 'task-storybook')
    expect(workTask?.sourceRefs).toEqual(['docs/storybook.md', 'docs/menu.md'])
    expect(workTask?.references).toEqual(['docs/storybook.md', 'docs/menu.md'])
    expect(workTask?.projectPath).toBeUndefined()
    expect(workTask?.createdAt).toBeUndefined()
    expect(workTask?.origination).toBeUndefined()
    expect(workTask?.remediationAttempts).toBeUndefined()
    expect(workTask?.escalations).toBeUndefined()
    expect(workTask?.latestSelfCritique).toBeUndefined()
    expect(workTask?.taskReadiness).toEqual({
      recommendation: 'ready',
      summary: 'Task is ready for a focused worker pass.',
    })
    expect(workTask?.latestCheckpoint).toEqual({ nextPlannedAction: 'Rerun Storybook proof.' })
    expect(workTask?.definitionOfDone).toEqual({ evidenceRequired: ['Storybook proof screenshot.'] })
    expect(workTask?.evidenceSummary).toMatchObject({
      counts: {
        notes: 1,
        reviewVerdicts: 0,
        adjudications: 0,
        gateResults: 0,
      },
      latest: {
        kind: 'note',
        summary: expect.stringContaining('Self-critique'),
      },
    })
    expect(workTask?.notes).toBeUndefined()
    expect(workBody.actionModel).toBeTruthy()
    expect(workBody.startReadiness).toBeTruthy()
    expect(workBody.orientationSpine).toBeTruthy()
    expect(workBody.orientationSpine?.summary?.selectedScopeLabel).toBeTruthy()
    expect(workBody.orientationSpine?.roots).toEqual([])
    expect(workBody.orientationSpine?.scopeRows).toEqual([
      expect.objectContaining({
        taskId: 'task-storybook',
        nodeId: 'work:task-storybook',
        title: 'Prove the menu primitive',
        sourceRefs: ['docs/storybook.md', 'docs/menu.md'],
      }),
    ])
    expect(workBody.orientationSpine?.proofContracts).toEqual([
      expect.objectContaining({
        nodeId: 'work:task-storybook',
        title: 'Prove the menu primitive',
        state: 'needed',
      }),
    ])
    const orientationNode = workBody.orientationSpine?.nodes?.['work:task-storybook']
    expect(orientationNode).toMatchObject({
      id: 'work:task-storybook',
      title: 'Prove the menu primitive',
    })
    expect(orientationNode?.children).toBeUndefined()
    expect(orientationNode?.refs).toBeUndefined()
    expect(orientationNode?.proof).toBeUndefined()
    expect(workBody.taskRoutingContexts?.['task-storybook']?.status).toBeTruthy()
    expect(workBody.taskRoutingContexts?.['task-storybook']?.reasons).toBeUndefined()
    expect(workBody.taskRoutingContexts?.['task-storybook']?.checks).toBeUndefined()
    expect(workBody.deliverySpine?.queue?.firstRunnable?.task?.id).toBe('task-storybook')
    expect(workBody.deliverySpine?.queue?.firstRunnable?.task?.title).toBe('Prove the menu primitive')
    expect(workBody.deliverySpine?.queue?.firstRunnable?.task?.spec).toBeUndefined()
    expect(workBody.deliverySpine?.queue?.firstRunnable?.task?.evidence).toBeUndefined()
    expect(workBody.deliverySpine?.model).toBeUndefined()
    expect(workBody.deliverySpine?.primitives).toBeUndefined()
    expect(workBody.releaseReadiness?.releaseBlockers).toEqual(expect.any(Array))
    expect(workBody.gitStory).toBeUndefined()
    expect(workBody.memoryHealth).toBeUndefined()

    const mapRes = await app.fetch(new Request(projectUrl('/api/project?surface=map')))
    const mapBody = (await mapRes.json()) as Record<string, any>
    expect(mapRes.status, mapBody.error).toBe(200)
    const mapTask = mapBody.tasks?.find((task: Record<string, any>) => task.id === 'task-storybook')
    expect(mapTask?.sourceRefs).toEqual(['docs/storybook.md', 'docs/menu.md'])
    expect(mapTask?.references).toEqual(['docs/storybook.md', 'docs/menu.md'])
    expect(mapTask?.projectPath).toBeUndefined()
  })

  it('does not call a consumed release complete when a done task still has unmet acceptance criteria', async () => {
    const now = '2026-06-01T00:00:00.000Z'
    await writeRawTaskQueue({
      version: 1,
      lastUpdated: now,
      selectedReleaseId: 'headless-mvp',
      releases: [{
        id: 'headless-mvp',
        label: 'Headless MVP',
        status: 'active',
        createdAt: now,
      }],
      tasks: [{
        id: 'task-model-proof',
        title: 'Prove the drafting model',
        description: 'A test task',
        domain: 'harness',
        status: 'done',
        priority: 'normal',
        createdAt: now,
        updatedAt: now,
        releaseIds: ['headless-mvp'],
        acceptanceCriteria: [{
          id: 'AC-1',
          description: 'Model proof records telemetry.',
          verifiedBy: 'review',
          met: false,
        }],
      }],
    })

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project')))
    const body = (await res.json()) as Record<string, any>

    expect(res.status, body.error).toBe(200)
    expect(body.startReadiness).toMatchObject({
      canStart: false,
      code: 'proof_evidence_missing',
      actionHref: '/work?task=task-model-proof',
      focusTaskId: 'task-model-proof',
      focusKind: 'proof',
      count: 1,
    })
    expect(body.startReadiness?.message).toContain('Headless MVP is waiting on proof evidence for "Prove the drafting model".')
  })

  it('derives terminal summaries from merge records on task detail and project rows', async () => {
    await seedTask('task-1', {
      status: 'done',
      completedAt: '2026-05-08T18:48:00.000Z',
      proofPaths: [{ kind: 'command', command: 'pnpm test' }],
      doneSummaryBundle: {
        taskId: 'task-1',
        status: 'done',
        completedAt: '2026-05-08T18:48:00.000Z',
        summary: {
          journey: 'Worker completed the task.',
          decision: 'Task finished as done.',
          evidence: 'pnpm test passed.',
          learningCandidates: [],
          openResidue: 'No residue.',
        },
        retention: {
          transcriptPrimaryArtifact: false,
          compactedFullTranscript: false,
          fullEvidenceAvailable: true,
        },
        evidenceRefs: [],
        createdAt: '2026-05-08T18:48:00.000Z',
        createdBy: 'orchestrator',
      },
      gateResults: [{
        gateId: 'pnpm test',
        type: 'hard',
        passed: true,
        output: 'tests passed',
        checkedAt: '2026-05-08T18:48:00.000Z',
      }],
      mergeRecord: {
        fromBranch: 'guildhall/task-1',
        toBranch: 'main',
        strategy: 'cherry_pick_local',
        result: 'merged',
        commitSha: 'abc123',
        mergedAt: '2026-05-08T18:47:00.000Z',
      },
    })

    const { app } = buildServeApp({ projectPath: tmpDir })
    const detailRes = await app.fetch(new Request(projectUrl('/api/project/task/task-1')))
    expect(detailRes.status).toBe(200)
    const detailBody = (await detailRes.json()) as Record<string, any>
    expect(detailBody.task?.terminalSummary?.headline).toBe('Merged locally into main.')
    expect(detailBody.task?.completionProof).toMatchObject({
      state: 'verified',
      expectedCount: 1,
      verifiedCount: expect.any(Number),
      latestAt: '2026-05-08T18:48:00.000Z',
    })
    expect(detailBody.task?.completionProof?.verified.join('\n')).toContain('pnpm test')

    const projectRes = await app.fetch(new Request(projectUrl('/api/project')))
    expect(projectRes.status).toBe(200)
    const projectBody = (await projectRes.json()) as Record<string, any>
    const task = projectBody.tasks?.find((entry: Record<string, any>) => entry.id === 'task-1')
    expect(task?.terminalSummary?.headline).toBe('Merged locally into main.')
    expect(task?.completionProof).toMatchObject({
      state: 'verified',
      expectedCount: 1,
      verifiedCount: expect.any(Number),
      latestAt: '2026-05-08T18:48:00.000Z',
    })
  })

  it('normalizes legacy string proof evidence for task detail and project rows', async () => {
    await seedTask('task-1', {
      status: 'done',
      proofPaths: [{
        kind: 'review',
        expectedEvidence: [
          'Chapter draft fixture is generated.',
          {
            kind: 'automated',
            description: 'Focused generation test passes.',
            required: false,
          },
        ],
      }],
    })

    const { app } = buildServeApp({ projectPath: tmpDir })
    const detailRes = await app.fetch(new Request(projectUrl('/api/project/task/task-1')))
    expect(detailRes.status).toBe(200)
    const detailBody = (await detailRes.json()) as Record<string, any>
    expect(detailBody.task?.proofPaths?.[0]).toMatchObject({
      id: 'review-proof-path',
      title: 'review proof path',
      expectedEvidence: [
        {
          id: 'review-proof-path-evidence-0',
          kind: 'artifact',
          description: 'Chapter draft fixture is generated.',
          required: true,
        },
        {
          id: 'review-proof-path-evidence-1',
          kind: 'automated',
          description: 'Focused generation test passes.',
          required: false,
        },
      ],
    })

    const projectRes = await app.fetch(new Request(projectUrl('/api/project')))
    expect(projectRes.status).toBe(200)
    const projectBody = (await projectRes.json()) as Record<string, any>
    const task = projectBody.tasks?.find((entry: Record<string, any>) => entry.id === 'task-1')
    expect(task?.proofPaths?.[0]?.expectedEvidence?.[0]).toMatchObject({
      kind: 'artifact',
      description: 'Chapter draft fixture is generated.',
      required: true,
    })
  })

  it('explains skipped automatic merges truthfully for done tasks', async () => {
    await seedTask('task-1', {
      status: 'done',
      mergeRecord: {
        fromBranch: '<unknown>',
        toBranch: '<unknown>',
        strategy: 'cherry_pick_local',
        result: 'skipped',
        mergedAt: '2026-05-08T18:47:00.000Z',
        detail: 'worktree isolation disabled — merge skipped',
      },
    })

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/task/task-1')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.task?.terminalSummary?.headline).toBe(
      'Task completed without an automatic merge.',
    )
    expect(body.task?.terminalSummary?.detail).toBe(
      'worktree isolation disabled — merge skipped',
    )
  })

  it('derives self-critique summaries from worker-role notes when the content is explicitly labeled', async () => {
    await seedTask('task-1', {
      status: 'review',
      notes: [
        {
          agentId: 'worker-agent',
          role: 'Worker',
          timestamp: new Date(Date.now() - 60_000).toISOString(),
          content: '**Self-critique:** focused use-workspace verification passed.',
        },
      ],
    })

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/task/task-1')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.task?.latestSelfCritique).toContain('focused use-workspace verification passed')
  })

  it('derives self-critique summaries from implementer-role notes when the content is explicitly labeled', async () => {
    await seedTask('task-1', {
      status: 'review',
      notes: [
        {
          agentId: 'worker-agent',
          role: 'implementer',
          timestamp: new Date(Date.now() - 60_000).toISOString(),
          content: '**Self-critique:** focused use-presence verification passed.',
        },
      ],
    })

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/task/task-1')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.task?.latestSelfCritique).toContain('focused use-presence verification passed')
  })

  it('derives self-critique summaries from worker persona-role notes when the content is explicitly labeled', async () => {
    await seedTask('task-1', {
      status: 'review',
      notes: [
        {
          agentId: 'worker-agent',
          role: 'Backend Engineer',
          timestamp: new Date(Date.now() - 60_000).toISOString(),
          content: '**Self-critique:** focused restore handler verification passed.',
        },
      ],
    })

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/task/task-1')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.task?.latestSelfCritique).toContain('focused restore handler verification passed')
  })

  it('normalizes stale checkpoint self-critique instructions when a worker persona-role note already exists', async () => {
    await seedTask('task-1', {
      status: 'in_progress',
      notes: [
        {
          agentId: 'worker-agent',
          role: 'Backend Engineer',
          timestamp: new Date(Date.now() - 60_000).toISOString(),
          content: '**Self-critique:** focused restore handler verification passed.',
        },
      ],
    })
    await writeCheckpoint({
      tasksPath: taskQueuePath(),
      memoryDir,
      taskId: 'task-1',
      agentId: 'worker-agent',
      intent: 'Worker recovery checkpoint after verified progress.',
      nextPlannedAction: "Write or refresh self-critique note, then transition task to 'review'",
      filesTouched: ['web/server/api/pages/[id]/restore.post.ts'],
    })

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/task/task-1')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
  expect(body.task?.latestCheckpoint?.nextPlannedAction).toBe(
    'Resume from the latest self-critique and recorded verification evidence, then hand off to review.',
  )
})

describe('POST /api/project/delivery-spine/contract-results/:id/apply', () => {
  it('applies a staged primitive setup result and removes it from the inbox', async () => {
    await seedTask('task-context-menu', {
      status: 'ready',
      delivery: { driver: 'knit', provider: 'looma', supports: [] },
    })
    const taskQueue = JSON.parse(await fs.readFile(taskQueuePath(), 'utf8')) as { tasks: any[] }
    const baseModel = {
      ...emptyProjectDeliveryModel('2026-06-05T12:00:00.000Z'),
      drivers: [
        { id: 'knit', label: 'Knit', role: 'primary' as const, paths: ['./apps/knit'], domains: [] },
        { id: 'looma', label: 'Looma', role: 'provider' as const, paths: ['./packages/looma'], domains: [] },
      ],
    }
    const validation = validateProjectPrimitiveSetupResult({
      model: baseModel,
      tasks: taskQueue.tasks,
      result: {
        primitives: [{
          id: 'context-menu',
          label: 'ContextMenu',
          kind: 'ui_primitive',
          provider: 'looma',
          paths: ['./packages/looma/src/context-menu'],
          invariants: ['ContextMenu composes menu primitives.'],
          proof: ['storybook'],
          status: 'needs_proof',
        }],
        taskLinks: [{ taskId: 'task-context-menu', usesPrimitives: ['context-menu'] }],
      },
      now: '2026-06-05T12:00:00.000Z',
      actor: 'setup-agent',
      applyPolicy: 'owner_review',
    })
    if (!validation.changeSet) throw new Error('expected changeSet')
    await writeProjectDeliveryModel(tmpDir, stageContractChangeSet({
      model: baseModel,
      changeSet: validation.changeSet,
      now: '2026-06-05T12:01:00.000Z',
      actor: 'setup-agent',
    }))

    const { app } = buildServeApp({ projectPath: tmpDir })
    const beforeInbox = await app.fetch(new Request(projectUrl('/api/project/inbox')))
    const beforeBody = (await beforeInbox.json()) as { items?: Array<{ kind?: string; resultId?: string }> }
    expect(beforeBody.items?.some(item => item.kind === 'contract_result_review' && item.resultId === validation.changeSet?.id)).toBe(true)

    const res = await app.fetch(new Request(projectUrl(`/api/project/delivery-spine/contract-results/${validation.changeSet.id}/apply`), {
      method: 'POST',
      body: JSON.stringify({ ownerOverrideReason: 'Accepted from Needs you.' }),
    }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok?: boolean; applied?: { id?: string } }
    expect(body.ok).toBe(true)
    expect(body.applied?.id).toBe(validation.changeSet.id)

    const projectRes = await app.fetch(new Request(projectUrl('/api/project')))
    const projectBody = (await projectRes.json()) as any
    expect(projectBody.deliverySpine.model.primitives.map((primitive: any) => primitive.id)).toContain('context-menu')
    const updatedQueue = JSON.parse(await fs.readFile(taskQueuePath(), 'utf8')) as { tasks: any[] }
    expect(updatedQueue.tasks.find(task => task.id === 'task-context-menu')?.delivery?.usesPrimitives).toEqual(['context-menu'])

    const afterInbox = await app.fetch(new Request(projectUrl('/api/project/inbox')))
    const afterBody = (await afterInbox.json()) as { items?: Array<{ kind?: string; resultId?: string }> }
    expect(afterBody.items?.some(item => item.kind === 'contract_result_review' && item.resultId === validation.changeSet?.id)).toBe(false)
  })

  it('rejects a staged primitive setup result and records the reason', async () => {
    await seedTask('task-context-menu', {
      status: 'ready',
      delivery: { driver: 'knit', provider: 'looma', supports: [] },
    })
    const taskQueue = JSON.parse(await fs.readFile(taskQueuePath(), 'utf8')) as { tasks: any[] }
    const baseModel = {
      ...emptyProjectDeliveryModel('2026-06-05T12:00:00.000Z'),
      drivers: [
        { id: 'knit', label: 'Knit', role: 'primary' as const, paths: ['./apps/knit'], domains: [] },
        { id: 'looma', label: 'Looma', role: 'provider' as const, paths: ['./packages/looma'], domains: [] },
      ],
    }
    const validation = validateProjectPrimitiveSetupResult({
      model: baseModel,
      tasks: taskQueue.tasks,
      result: {
        primitives: [{
          id: 'context-menu',
          label: 'ContextMenu',
          kind: 'ui_primitive',
          provider: 'looma',
          paths: ['./packages/looma/src/context-menu'],
          invariants: ['ContextMenu composes menu primitives.'],
          proof: ['storybook'],
          status: 'needs_proof',
        }],
      },
      now: '2026-06-05T12:00:00.000Z',
      actor: 'setup-agent',
      applyPolicy: 'owner_review',
    })
    if (!validation.changeSet) throw new Error('expected changeSet')
    await writeProjectDeliveryModel(tmpDir, stageContractChangeSet({
      model: baseModel,
      changeSet: validation.changeSet,
      now: '2026-06-05T12:01:00.000Z',
      actor: 'setup-agent',
    }))

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl(`/api/project/delivery-spine/contract-results/${validation.changeSet.id}/reject`), {
      method: 'POST',
      body: JSON.stringify({ reason: 'Duplicate primitive.' }),
    }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok?: boolean; rejected?: { reason?: string } }
    expect(body.ok).toBe(true)
    expect(body.rejected?.reason).toBe('Duplicate primitive.')

    const projectRes = await app.fetch(new Request(projectUrl('/api/project')))
    const projectBody = (await projectRes.json()) as any
    expect(projectBody.deliverySpine.model.primitives.map((primitive: any) => primitive.id)).not.toContain('context-menu')
    expect(projectBody.deliverySpine.model.rejectedCandidates.at(-1).reason).toBe('Duplicate primitive.')
  })
})

it('hides placeholder checkpoint next-action values in task detail responses', async () => {
  await seedTask('task-1', {
    status: 'in_progress',
  })
  await writeCheckpoint({
    tasksPath: taskQueuePath(),
    memoryDir,
    taskId: 'task-1',
    agentId: 'worker-agent',
    intent: 'Resume implementation',
    nextPlannedAction: 'None',
    filesTouched: ['web/server/api/pages/[id]/restore.post.ts'],
  })

  const { app } = buildServeApp({ projectPath: tmpDir })
  const res = await app.fetch(new Request(projectUrl('/api/project/task/task-1')))
  expect(res.status).toBe(200)
  const body = (await res.json()) as Record<string, any>
  expect(body.task?.latestCheckpoint?.nextPlannedAction).toBeNull()
})

  it('returns 404 when task id is unknown', async () => {
    await seedTask('task-1')
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/task/missing')))
    expect(res.status).toBe(404)
  })
})

describe('POST /api/project/task/:id/git-story/:closureAction', () => {
  it('uses the matching workspace child gitStory policy for task git actions', async () => {
    const loomaPath = path.join(tmpDir, 'looma')
    await fs.mkdir(loomaPath, { recursive: true })
    writeWorkspaceConfig(tmpDir, {
      name: 'Task Endpoints Test',
      id: projectId,
      kind: 'workspace',
      projects: [
        {
          id: 'looma',
          path: 'looma',
          gitStory: {
            completionTarget: 'open_pr',
            commit: 'never',
            push: 'ask',
            pullRequest: 'ask',
            merge: 'ask',
            localOnlyAllowed: true,
            deferAllowed: true,
            requireCleanRelease: true,
            allowForcePush: false,
            allowSharedBranchRebase: false,
            discoveredFrom: [],
          },
        },
      ],
    } as any)
    await seedTask('task-1', { status: 'done', domain: 'looma', projectPath: loomaPath })
    const { app } = buildServeApp({ projectPath: tmpDir })

    const res = await app.fetch(new Request(projectUrl('/api/project/task/task-1/git-story/commit'), {
      method: 'POST',
      body: JSON.stringify({ confirmed: true, message: 'test', files: ['src/a.ts'] }),
      headers: { 'content-type': 'application/json' },
    }))

    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: 'Project policy disables commit.' })
  })

  it('records a local-only git story override with a required reason', async () => {
    await seedTask('task-1', { status: 'done' })
    const { app } = buildServeApp({ projectPath: tmpDir })

    const missingReason = await app.fetch(new Request(projectUrl('/api/project/task/task-1/git-story/local-only'), {
      method: 'POST',
      body: JSON.stringify({ reason: '' }),
      headers: { 'content-type': 'application/json' },
    }))
    expect(missingReason.status).toBe(400)

    const res = await app.fetch(new Request(projectUrl('/api/project/task/task-1/git-story/local-only'), {
      method: 'POST',
      body: JSON.stringify({ reason: 'Fixture-only scratch work.' }),
      headers: { 'content-type': 'application/json' },
    }))
    expect(res.status).toBe(200)

    const raw = JSON.parse(await fs.readFile(taskQueuePath(), 'utf8')) as Record<string, any>
    expect(raw.tasks[0]?.gitStory).toMatchObject({
      override: 'local_only',
      reason: 'Fixture-only scratch work.',
      recordedBy: 'user',
    })
  })

  it('preserves selected release metadata when recording a git story override', async () => {
    const now = new Date().toISOString()
    await writeTaskQueue({
      version: 1,
      lastUpdated: now,
      selectedReleaseId: 'near-term-proof-scope',
      releases: [{
        id: 'near-term-proof-scope',
        label: 'Near-term proof scope',
        kind: 'release',
        state: 'active',
        source: 'inferred',
        nodeIds: ['work:task-1'],
        deferredNodeIds: [],
      }],
      tasks: [{
        id: 'task-1',
        title: 'Review scoped proof lane',
        description: 'A test task',
        domain: 'harness',
        projectPath: tmpDir,
        status: 'spec_review',
        priority: 'normal',
        releaseIds: ['near-term-proof-scope'],
        revisionCount: 0,
        remediationAttempts: 0,
        origination: 'human',
        createdAt: now,
        updatedAt: now,
      }],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })

    const res = await app.fetch(new Request(projectUrl('/api/project/task/task-1/git-story/local-only'), {
      method: 'POST',
      body: JSON.stringify({ reason: 'Generated lockfile metadata churn.' }),
      headers: { 'content-type': 'application/json' },
    }))
    expect(res.status).toBe(200)

    const raw = await readTaskQueue()
    expect(raw.selectedReleaseId).toBe('near-term-proof-scope')
    expect(raw.releases).toEqual([
      expect.objectContaining({
        id: 'near-term-proof-scope',
        source: 'inferred',
        nodeIds: ['work:task-1'],
      }),
    ])
    expect(raw.tasks[0]?.gitStory).toMatchObject({
      override: 'local_only',
      reason: 'Generated lockfile metadata churn.',
    })
  })
})

describe('filterEventsForTask (drawer live feed)', () => {
  it('matches wire-protocol snake_case task_id', () => {
    const events = [
      { event: { type: 'task_transition', task_id: 't1', from_status: 'ready', to_status: 'in_progress' } },
      { event: { type: 'task_transition', task_id: 't2', from_status: 'ready', to_status: 'in_progress' } },
      { event: { type: 'supervisor_started' } }, // no task_id
    ]
    expect(filterEventsForTask(events, 't1')).toHaveLength(1)
    expect(filterEventsForTask(events, 't2')).toHaveLength(1)
    expect(filterEventsForTask(events, 'none')).toHaveLength(0)
  })

  it('also matches legacy camelCase taskId shapes', () => {
    const events = [{ event: { type: 'agent_note', taskId: 't9', content: 'hi' } }]
    expect(filterEventsForTask(events, 't9')).toHaveLength(1)
  })
})

describe('GET /api/project/task/:id/file', () => {
  it('reads a changed file from the task workspace and rejects directories', async () => {
    await fs.mkdir(path.join(tmpDir, 'frontend', 'app', 'pages'), { recursive: true })
    await fs.mkdir(path.join(tmpDir, 'frontend', 'app', 'lib'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'frontend', 'app', 'pages', 'dashboard.vue'),
      '<template>Dashboard</template>\n',
      'utf8',
    )
    await seedTask('task-1', {
      latestCheckpoint: {
        filesTouched: [
          'frontend/app/pages/dashboard.vue',
          'frontend/app/lib/',
        ],
      },
    })
    const { app } = buildServeApp({ projectPath: tmpDir })

    const fileUrl = new URL(projectUrl('/api/project/task/task-1/file'))
    fileUrl.searchParams.set('path', 'frontend/app/pages/dashboard.vue')
    const fileRes = await app.fetch(new Request(fileUrl.toString()))

    expect(fileRes.status).toBe(200)
    const fileBody = (await fileRes.json()) as Record<string, any>
    expect(fileBody).toMatchObject({
      taskId: 'task-1',
      path: 'frontend/app/pages/dashboard.vue',
      content: '<template>Dashboard</template>\n',
      language: 'vue',
      truncated: false,
    })

    const dirUrl = new URL(projectUrl('/api/project/task/task-1/file'))
    dirUrl.searchParams.set('path', 'frontend/app/lib/')
    const dirRes = await app.fetch(new Request(dirUrl.toString()))

    expect(dirRes.status).toBe(400)
    await expect(dirRes.json()).resolves.toMatchObject({ error: 'path is not a file' })
  })

  it('keeps file reads inside the project or task worktree', async () => {
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-outside-'))
    try {
      await fs.writeFile(path.join(outsideDir, 'secret.txt'), 'nope\n', 'utf8')
      await seedTask('task-1')
      const { app } = buildServeApp({ projectPath: tmpDir })
      const url = new URL(projectUrl('/api/project/task/task-1/file'))
      url.searchParams.set('path', path.join(outsideDir, 'secret.txt'))

      const res = await app.fetch(new Request(url.toString()))

      expect(res.status).toBe(400)
      await expect(res.json()).resolves.toMatchObject({ error: 'path is outside the task workspace' })
    } finally {
      await fs.rm(outsideDir, { recursive: true, force: true })
    }
  })
})

describe('POST /api/project/task/:id/hold|shelve', () => {
  it('puts a task on hold with a reason and can return it to its previous stage', async () => {
    await seedTask('task-1', { status: 'review' })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const holdRes = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/hold'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'Waiting for the design call.' }),
      }),
    )
    expect(holdRes.status).toBe(200)
    const body = (await holdRes.json()) as Record<string, any>
    expect(body.ok).toBe(true)
    expect(body.status).toBe('blocked')

    const raw = await fs.readFile(taskQueuePath(), 'utf8')
    let q = JSON.parse(raw)
    expect(q.tasks[0].status).toBe('blocked')
    expect(q.tasks[0].blockReason).toBe('On hold: Waiting for the design call.')
    expect(q.tasks[0].hold).toMatchObject({
      previousStatus: 'review',
      reason: 'Waiting for the design call.',
      heldBy: 'human',
    })
    expect(q.tasks[0].notes?.at(-1)?.agentId).toBe('system:human')

    const resumeRes = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/resume-hold'), { method: 'POST' }),
    )
    expect(resumeRes.status).toBe(200)
    const resumeBody = (await resumeRes.json()) as Record<string, any>
    expect(resumeBody.status).toBe('review')

    q = JSON.parse(await fs.readFile(taskQueuePath(), 'utf8'))
    expect(q.tasks[0].status).toBe('review')
    expect(q.tasks[0].hold).toBeUndefined()
    expect(q.tasks[0].blockReason).toBeUndefined()
  })

  it('shelve transitions to shelved with a shelveReason record', async () => {
    await seedTask('task-1')
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/shelve'), { method: 'POST' }),
    )
    expect(res.status).toBe(200)
    const raw = await fs.readFile(taskQueuePath(), 'utf8')
    const q = JSON.parse(raw)
    expect(q.tasks[0].status).toBe('shelved')
    expect(q.tasks[0].shelveReason?.rejectedBy).toBe('system:human')
  })

  it('rejects hold on a done task', async () => {
    await seedTask('task-1', { status: 'done' })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/hold'), { method: 'POST' }),
    )
    expect(res.status).toBe(400)
  })

  it('rejects unknown actions', async () => {
    await seedTask('task-1')
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/nuke'), { method: 'POST' }),
    )
    expect(res.status).toBe(400)
  })
})

describe('POST /api/project/task/:id/mark-done', () => {
  it('marks a ready task done with human evidence and closes its checklist', async () => {
    await seedRawTaskDefinition('task-1', {
      status: 'ready',
      assignedTo: null,
      blockReason: 'Old blocker',
      acceptanceCriteria: [
        { id: 'AC-1', description: 'Migrations are applied', verifiedBy: 'manual', met: false },
        { id: 'AC-2', description: 'Types are generated', verifiedBy: 'manual', met: false },
      ],
      escalations: [
        {
          id: 'esc-1',
          taskId: 'task-1',
          reason: 'environment_blocked',
          summary: 'Waiting on hosted database credentials',
          agentId: 'worker-agent',
          raisedAt: new Date().toISOString(),
        },
      ],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/mark-done'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ evidence: 'supabase db push reports remote database is up to date' }),
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.status).toBe('done')

    const raw = await fs.readFile(taskQueuePath(), 'utf8')
    const q = JSON.parse(raw)
    const task = q.tasks[0]
    expect(task.status).toBe('done')
    expect(task.assignedTo).toBeNull()
    expect(task.blockReason).toBeUndefined()
    expect(task.acceptanceCriteria.every((criterion: Record<string, any>) => criterion.met === true)).toBe(true)
    expect(task.escalations[0].resolvedBy).toBe('human')
    expect(task.notes.at(-1).content).toMatch(/supabase db push/)
    expect(task.doneSummaryBundle).toMatchObject({
      taskId: 'task-1',
      status: 'done',
      retention: {
        transcriptPrimaryArtifact: false,
      },
    })
    expect(task.doneSummaryBundle.summary.decision).toMatch(/Task finished as done/)
  })

  it('rejects mark-done on active execution stages', async () => {
    await seedTask('task-1', { status: 'in_progress' })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/mark-done'), { method: 'POST' }),
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, any>
    expect(body.error).toMatch(/active run/i)
  })
})

describe('POST /api/project/task/:id/start', () => {
  it('blocks a scoped spec_review task start until the spec is approved', async () => {
    await seedTasks([
      {
        id: 'task-context-menu',
        title: 'ContextMenu',
        status: 'spec_review',
        spec: '## Summary\nImplement ContextMenu.\n\n## Acceptance Criteria\n1. ContextMenu works.',
        acceptanceCriteria: [{ id: 'ac-1', description: 'ContextMenu works.', verifiedBy: 'review' }],
      },
      {
        id: 'task-hover-card',
        title: 'HoverCard',
        status: 'spec_review',
        spec: '## Summary\nImplement HoverCard.\n\n## Acceptance Criteria\n1. HoverCard works.',
        acceptanceCriteria: [{ id: 'ac-2', description: 'HoverCard works.', verifiedBy: 'review' }],
      },
    ])
    const { supervisor, starts } = createTrackingSupervisor()
    const { app } = buildServeApp({ projectPath: tmpDir, supervisor })
    await applyStorageBoundaryMigration(app)
    setProvider('anthropic-api', { apiKey: 'sk-ant-test' })
    updateGlobalConfig({ preferredProvider: 'anthropic-api' })

    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-context-menu/start'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'one_task', scope: 'work_item' }),
      }),
    )

    const body = (await res.json()) as Record<string, any>
    expect(res.status).toBe(400)
    expect(body.code).toBe('no_unattended_progress')
    expect(body.error ?? body.message).toMatch(/spec.*waiting for review/i)
    expect(starts).toHaveLength(0)
  })

  it('repairs weak recovery specs before blocking focused start for spec review', async () => {
    await seedTasks([
      {
        id: 'task-model-proof',
        title: 'Define Narrative Harness MVP drafting model and physical-world review lanes',
        status: 'spec_review',
        description:
          'For the Narrative Harness current MVP/current bounded scope, make sure Guildhall shapes explicit work for: (1) selecting and proving a DeepInfra-accessible model that can do drafting/writing work across genres, including adult genres, rather than assuming the current default model is sufficient; (2) defining review lanes for world-state continuity over time, including object/property state transitions such as wet hair drying after enough time in a given climate; (3) defining spatial/geographic continuity reviews, including scene geography, travel distance, walking speed for fantasy epics, and other physical plausibility checks. These should become source-backed MVP scope/tasks or explicit deferred work, and Guildhall should show them clearly in the project map/overview/work queue instead of treating them as hidden Codex knowledge. from For the Narrative Harness current MVP/current bounded scope, make sure Guildhall shapes explicit work for.',
        productBrief: {
          userJob: 'I want Define Narrative Harness MVP drafting model and physical-world review lanes implemented or proven from current evidence.',
          successMetric: 'Define Narrative Harness MVP drafting model and physical-world review lanes has a concrete completion boundary.',
          antiPatterns: [],
          authoredBy: 'coordinator-recovery',
          authoredAt: '2026-07-05T18:15:02.867Z',
        },
        spec: [
          '## Summary',
          'Define Narrative Harness MVP drafting model and physical-world review lanes from the current project evidence.',
          '',
          '## Acceptance Criteria',
          '1. Given the current project evidence, when Define Narrative Harness MVP drafting model and physical-world review lanes is implemented, then the repo-local proof demonstrates that exact child outcome without adding unrelated later-stage work.',
          '2. Given the parent task boundary, when this task is reviewed, then it satisfies the relevant parent acceptance criteria and leaves sibling child work to its own task.',
          '',
          '## Completion Boundary',
          '- Product outcome: Define Narrative Harness MVP drafting model and physical-world review lanes is proven inside the no-UI Narrative Harness Stage 1 boundary.',
        ].join('\n'),
        acceptanceCriteria: [
          {
            id: 'ac-1',
            description: 'Given the current project evidence, when Define Narrative Harness MVP drafting model and physical-world review lanes is implemented, then the repo-local proof demonstrates that exact child outcome without adding unrelated later-stage work.',
            verifiedBy: 'review',
          },
        ],
        notes: [{
          agentId: 'coordinator-recovery',
          role: 'system',
          content: 'Guildhall wrote a deterministic recovery spec seed from the current task evidence before redispatching the spec lane.',
          timestamp: '2026-07-05T18:15:02.867Z',
        }],
      },
    ])
    const { supervisor, starts } = createTrackingSupervisor()
    const { app } = buildServeApp({ projectPath: tmpDir, supervisor })
    await applyStorageBoundaryMigration(app)
    setProvider('anthropic-api', { apiKey: 'sk-ant-test' })
    updateGlobalConfig({ preferredProvider: 'anthropic-api' })

    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-model-proof/start'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'one_task', scope: 'work_item' }),
      }),
    )

    const body = (await res.json()) as Record<string, any>
    expect(res.status).toBe(400)
    expect(body.code).toBe('no_unattended_progress')
    expect(starts).toHaveLength(0)
    const queue = await readTaskQueue()
    const task = queue.tasks.find(candidate => candidate.id === 'task-model-proof')
    const criteria = (task?.acceptanceCriteria ?? []).map((criterion: Record<string, unknown>) => String(criterion.description ?? '')).join('\n')
    expect(criteria).toContain('DeepInfra-accessible model')
    expect(criteria).toContain('adult genres')
    expect(criteria).toContain('wet hair drying')
    expect(criteria).toContain('walking speed for fantasy epics')
    expect(task?.workUnitAnalysis?.units.map(unit => unit.title)).toEqual([
      'Select and prove DeepInfra drafting model',
      'Define world-state continuity review lane',
      'Define spatial/geographic continuity review lane',
    ])
    expect(criteria).not.toContain('repo-local proof demonstrates that exact child outcome')
    expect(criteria).not.toContain(';.')
    expect(criteria).not.toContain('These should become source-backed MVP scope/tasks')
    expect(task?.spec).not.toContain('These should become source-backed MVP scope/tasks')
    expect(task?.spec).not.toContain('from For the Narrative Harness')
    expect(task?.productBrief?.userJob).not.toContain('These should become source-backed MVP scope/tasks')
    expect(task?.productBrief?.userJob).not.toContain('from For the Narrative Harness')
    expect(task?.productBrief?.successMetric).toContain('DeepInfra-accessible model')
    expect(task?.notes?.at(-1)?.content).toContain('under-shaped recovery spec')
  })

  it('lets the selected source-recovery shaping task start while project Start remains blocked', async () => {
    const now = new Date().toISOString()
    await seedTasks([
      {
        id: 'task-source-recovery',
        title: 'Recover source-backed contract surface',
        status: 'exploring',
        taskReadiness: {
          recommendation: 'needs_research_spike',
          summary: 'Needs concrete contract names before worker handoff.',
        },
        notes: [
          {
            agentId: 'workspace-importer',
            role: 'importer',
            content: 'Imported from docs/specs/source.md',
            timestamp: now,
          },
        ],
      },
      {
        id: 'task-ready',
        title: 'Ready implementation task',
        status: 'ready',
        productBrief: {
          approvedAt: now,
          userJob: 'Run a ready task.',
          whyItMattersNow: 'It belongs to current scope.',
          successMetric: 'The task completes.',
          nonGoals: ['Do not skip source recovery.'],
        },
        spec: '## Summary\nRun ready implementation.\n\n## Acceptance Criteria\n- It completes.',
        acceptanceCriteria: [{ id: 'ac-1', description: 'It completes.', verifiedBy: 'review' }],
      },
    ])
    const { supervisor, starts } = createTrackingSupervisor()
    const { app } = buildServeApp({ projectPath: tmpDir, supervisor })
    await applyStorageBoundaryMigration(app)
    setProvider('anthropic-api', { apiKey: 'sk-ant-test' })
    updateGlobalConfig({ preferredProvider: 'anthropic-api' })

    try {
      const projectStart = await app.fetch(
        new Request(projectUrl('/api/project/start'), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ mode: 'continuous' }),
        }),
      )
      expect(projectStart.status).toBe(400)
      await expect(projectStart.json()).resolves.toMatchObject({
        code: 'imported_scope_shaping',
        actionHref: '/task/task-source-recovery',
      })

      const focusedStart = await app.fetch(
        new Request(projectUrl('/api/project/task/task-source-recovery/start'), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ mode: 'one_task', scope: 'work_item' }),
        }),
      )

      expect(focusedStart.status).toBe(200)
      const body = (await focusedStart.json()) as Record<string, any>
      expect(body.scope).toEqual({ type: 'work_item', taskId: 'task-source-recovery' })
      await vi.waitFor(() => {
        expect(starts.at(-1)).toMatchObject({
          preferredTaskId: 'task-source-recovery',
          stopAfterOneTask: true,
        })
      })
    } finally {
      await supervisor.stopAll({ reason: 'test-teardown' }).catch(() => {})
    }
  })

  it('lets a specifically requested shaping task start while unrelated import shaping blocks project Start', async () => {
    const now = new Date().toISOString()
    await seedTasks([
      {
        id: 'task-source-recovery',
        title: 'Recover source-backed contract surface',
        status: 'exploring',
        taskReadiness: {
          recommendation: 'needs_research_spike',
          summary: 'Needs concrete contract names before worker handoff.',
        },
        notes: [
          {
            agentId: 'workspace-importer',
            role: 'importer',
            content: 'Imported from docs/specs/source.md',
            timestamp: now,
          },
        ],
      },
      {
        id: 'task-model-proof',
        title: 'Define drafting model proof',
        status: 'exploring',
        description: 'Select and prove the current drafting model lane.',
      },
    ])
    const { supervisor, starts } = createTrackingSupervisor()
    const { app } = buildServeApp({ projectPath: tmpDir, supervisor })
    await applyStorageBoundaryMigration(app)
    setProvider('anthropic-api', { apiKey: 'sk-ant-test' })
    updateGlobalConfig({ preferredProvider: 'anthropic-api' })

    try {
      const projectStart = await app.fetch(
        new Request(projectUrl('/api/project/start'), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ mode: 'continuous' }),
        }),
      )
      expect(projectStart.status).toBe(400)
      await expect(projectStart.json()).resolves.toMatchObject({
        code: 'imported_scope_shaping',
        actionHref: '/task/task-source-recovery',
      })

      const focusedStart = await app.fetch(
        new Request(projectUrl('/api/project/task/task-model-proof/start'), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ mode: 'one_task', scope: 'work_item' }),
        }),
      )

      expect(focusedStart.status).toBe(200)
      const body = (await focusedStart.json()) as Record<string, any>
      expect(body.scope).toEqual({ type: 'work_item', taskId: 'task-model-proof' })
      await vi.waitFor(() => {
        expect(starts.at(-1)).toMatchObject({
          preferredTaskId: 'task-model-proof',
          stopAfterOneTask: true,
        })
      })
    } finally {
      await supervisor.stopAll({ reason: 'test-teardown' }).catch(() => {})
    }
  })

  it('reopens stale spec-timeout blockers before a focused task start', async () => {
    const now = new Date().toISOString()
    await seedTasks([
      {
        id: 'task-model-proof',
        title: 'Define drafting model proof',
        status: 'blocked',
        blockReason: 'human_judgment_required: Spec shaping timed out before saving durable progress.',
        description: 'Select and prove the current drafting model lane.',
      },
    ])
    const { supervisor, starts } = createTrackingSupervisor()
    const { app } = buildServeApp({ projectPath: tmpDir, supervisor })
    await applyStorageBoundaryMigration(app)
    setProvider('anthropic-api', { apiKey: 'sk-ant-test' })
    updateGlobalConfig({ preferredProvider: 'anthropic-api' })

    try {
      const focusedStart = await app.fetch(
        new Request(projectUrl('/api/project/task/task-model-proof/start'), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ mode: 'one_task', scope: 'work_item' }),
        }),
      )

      expect(focusedStart.status).toBe(200)
      await vi.waitFor(() => {
        expect(starts.at(-1)).toMatchObject({
          preferredTaskId: 'task-model-proof',
          stopAfterOneTask: true,
        })
      })
      const queue = await readTaskQueue()
      const task = queue.tasks.find(candidate => candidate.id === 'task-model-proof')
      expect(task).toMatchObject({
        status: 'exploring',
        assignedTo: null,
      })
      expect(task?.blockReason).toBeUndefined()
      expect(task?.notes?.at(-1)?.content).toContain('stale spec-timeout blocker')
    } finally {
      await supervisor.stopAll({ reason: 'test-teardown' }).catch(() => {})
    }
  })

  it('starts a scoped max-revision task when an earlier LLM review already cleared the rubric', async () => {
    await seedTasks([
      {
        id: 'author-voice-loop-mvp',
        title: 'Implement author voice feedback loop MVP',
        status: 'blocked',
        blockReason: 'max_revisions_exceeded: Exceeded maxRevisions (3). Requires human judgment.',
        revisionCount: 4,
        reviewVerdicts: [
          {
            verdict: 'revise',
            reviewerPath: 'llm',
            reason: 'LLM reviewer requested revision (transitioned to in_progress)',
            reasoning: [
              '**Rubric**',
              '- acceptance-criteria-met: yes - all acceptance criteria are satisfied.',
              '- no-scope-creep: yes - changes are limited to the reviewer lane.',
              '- conventions-followed: yes - code follows project conventions.',
              '- no-regressions: yes - focused tests pass.',
            ].join('\n'),
            failingSignals: [],
            recordedAt: new Date().toISOString(),
          },
        ],
      },
    ])
    const { supervisor, starts } = createTrackingSupervisor()
    const { app } = buildServeApp({ projectPath: tmpDir, supervisor })
    await applyStorageBoundaryMigration(app)
    setProvider('anthropic-api', { apiKey: 'sk-ant-test' })
    updateGlobalConfig({ preferredProvider: 'anthropic-api' })

    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/author-voice-loop-mvp/start'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'one_task', scope: 'work_item' }),
      }),
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.code).not.toBe('all_terminal')
    expect(body.scope).toEqual({ type: 'work_item', taskId: 'author-voice-loop-mvp' })
    expect(starts.at(-1)).toMatchObject({
      preferredTaskId: 'author-voice-loop-mvp',
      stopAfterOneTask: true,
    })
  })
})

describe('POST /api/project/task/:id/approve-spec', () => {
  it('transitions a spec_review task with a spec to ready and records the approvalNote', async () => {
    await seedTask('task-1', {
      status: 'spec_review',
      productBrief: {
        userJob: 'I want users to complete the invite flow without guessing what happens next.',
        successMetric: 'A user can accept an invite and land in the workspace.',
        approvedAt: '2026-05-26T00:00:00.000Z',
      },
      spec: [
        '## Summary',
        '',
        'Implement invite acceptance.',
        '',
        '## Completion Boundary',
        '- Product outcome: A user can accept an invite and land in the workspace.',
        '- What Guildhall can complete in code: Update the invite acceptance route and UI.',
        '- External dependencies: None.',
        '- Owner-only setup: None.',
        '- Verification environment: Local app with seeded invite data.',
        '- What counts as done: The seeded invite acceptance path succeeds end-to-end.',
        '- What must be split or blocked: Nothing.',
        '',
        '## Acceptance Criteria',
        '1. Given a valid invite, when the user accepts it, then they land in the workspace.',
      ].join('\n'),
      acceptanceCriteria: [
        {
          id: 'AC-1',
          description: 'Given a valid invite, when the user accepts it, then they land in the workspace.',
          verifiedBy: 'review',
          met: false,
        },
      ],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/approve-spec'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ approvalNote: 'Looks great, ship it' }),
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.ok).toBe(true)
    expect(body.status).toBe('ready')

    const raw = await fs.readFile(taskQueuePath(), 'utf8')
    const q = JSON.parse(raw)
    expect(q.tasks[0].status).toBe('ready')
    expect(q.tasks[0].notes?.at(-1)?.content).toMatch(/ship it/i)
  })

  it('rejects approve-spec when the completion boundary is missing', async () => {
    await seedTask('task-1', {
      status: 'spec_review',
      productBrief: {
        userJob: 'I want users to sign in with familiar providers.',
        successMetric: 'Login shows provider buttons.',
        approvedAt: '2026-05-26T00:00:00.000Z',
      },
      spec: [
        '## Summary',
        '',
        'Add Google and Apple buttons to the login screen.',
        '',
        '## Acceptance Criteria',
        '1. Login and registration pages show Google and Apple buttons.',
      ].join('\n'),
      acceptanceCriteria: [
        {
          id: 'AC-1',
          description: 'Login and registration pages show Google and Apple buttons.',
          verifiedBy: 'review',
          met: false,
        },
      ],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/approve-spec'), { method: 'POST' }),
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, any>
    expect(body.error).toMatch(/completion boundary/i)
  })

  it('rejects approve-spec when external dependencies are named without an owner or blocked split', async () => {
    await seedTask('task-1', {
      status: 'spec_review',
      productBrief: {
        userJob: 'I want users to sign in with familiar providers.',
        successMetric: 'Google and Apple sign-in work.',
        approvedAt: '2026-05-26T00:00:00.000Z',
      },
      spec: [
        '## Summary',
        '',
        'Add provider sign-in.',
        '',
        '## Completion Boundary',
        '- Product outcome: A user can sign in with Google and Apple.',
        '- What Guildhall can complete in code: Add provider buttons and callback copy.',
        '- External dependencies: Google and Apple OAuth apps and Supabase provider settings.',
        '- Owner-only setup: TBD.',
        '- Verification environment: TBD.',
        '- What counts as done: Buttons call Supabase.',
        '- What must be split or blocked: None.',
        '',
        '## Acceptance Criteria',
        '1. Login and registration pages show Google and Apple buttons.',
      ].join('\n'),
      acceptanceCriteria: [
        {
          id: 'AC-1',
          description: 'Login and registration pages show Google and Apple buttons.',
          verifiedBy: 'review',
          met: false,
        },
      ],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/approve-spec'), { method: 'POST' }),
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, any>
    expect(body.error).toMatch(/external dependencies/i)
  })

  it('rejects approve-spec when the task has no drafted spec yet', async () => {
    await seedTask('task-1', { status: 'spec_review' })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/approve-spec'), { method: 'POST' }),
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, any>
    expect(body.error).toMatch(/spec/i)
  })

  it('rejects approve-spec on a task that is not in spec_review', async () => {
    await seedTask('task-1', { status: 'in_progress', spec: 'irrelevant' })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/approve-spec'), { method: 'POST' }),
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, any>
    expect(body.error).toMatch(/spec_review/i)
  })

  it('rejects approve-spec for the reserved workspace-import task', async () => {
    await seedTask('task-workspace-import', {
      status: 'spec_review',
      domain: '_workspace_import',
      spec: 'drafted import spec body',
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-workspace-import/approve-spec'), {
        method: 'POST',
      }),
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, any>
    expect(body.error).toMatch(/workspace import/i)
  })
})

describe('POST /api/project/task/:id/rerun-stage', () => {
  it('reopens a task for a fresh spec pass', async () => {
    await seedTask('task-1', {
      status: 'ready',
      spec: 'Old spec',
      notes: [],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/rerun-stage'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ stage: 'spec' }),
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.ok).toBe(true)
    expect(body.status).toBe('exploring')

    const raw = JSON.parse(await fs.readFile(taskQueuePath(), 'utf8')) as Record<string, any>
    expect(raw.tasks[0]?.status).toBe('exploring')
    expect(raw.tasks[0]?.notes?.at(-1)?.content).toMatch(/fresh spec pass/i)
    const transcript = (await readExploringTranscript({ memoryDir, taskId: 'task-1' })).content ?? ''
    expect(transcript).toMatch(/fresh spec pass/i)
  })

  it('reopens a falsely done task for a fresh spec pass', async () => {
    await seedTasks([
      {
        id: 'task-1',
        status: 'done',
        spec: 'Stale spec',
        notes: [],
        hierarchy: { childIds: [], order: 0 },
      },
      {
        id: 'task-1-split-duplicate',
        title: 'Stale duplicate child',
        status: 'shelved',
        hierarchy: { parentId: 'task-1', childIds: [], order: 0 },
      },
      {
        id: 'task-1-active-child',
        title: 'Real active child',
        status: 'ready',
        hierarchy: { parentId: 'task-1', childIds: [], order: 1 },
      },
    ])
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/rerun-stage'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ stage: 'spec' }),
      }),
    )
    expect(res.status).toBe(200)

    const raw = JSON.parse(await fs.readFile(taskQueuePath(), 'utf8')) as Record<string, any>
    const parent = raw.tasks.find((task: Record<string, any>) => task.id === 'task-1')
    const staleChild = raw.tasks.find((task: Record<string, any>) => task.id === 'task-1-split-duplicate')
    const activeChild = raw.tasks.find((task: Record<string, any>) => task.id === 'task-1-active-child')
    expect(parent?.status).toBe('exploring')
    expect(parent?.assignedTo).toBeNull()
    expect(parent?.notes?.at(-1)?.content).toMatch(/fresh spec pass/i)
    expect(staleChild?.hierarchy?.parentId).toBeUndefined()
    expect(activeChild?.hierarchy?.parentId).toBe('task-1')
  })

  it('re-runs review from gate_check without dropping the task out of active work', async () => {
    await seedTask('task-1', {
      status: 'gate_check',
      assignedTo: 'gate-checker-agent',
      notes: [],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/rerun-stage'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ stage: 'review' }),
      }),
    )
    expect(res.status).toBe(200)
    const raw = JSON.parse(await fs.readFile(taskQueuePath(), 'utf8')) as Record<string, any>
    expect(raw.tasks[0]?.status).toBe('review')
    expect(raw.tasks[0]?.assignedTo).toBe('reviewer-agent')
    expect(raw.tasks[0]?.notes?.at(-1)?.content).toMatch(/fresh review pass/i)
  })

  it('re-runs gate_check in place', async () => {
    await seedTask('task-1', {
      status: 'gate_check',
      assignedTo: 'gate-checker-agent',
      notes: [],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/rerun-stage'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ stage: 'gate' }),
      }),
    )
    expect(res.status).toBe(200)
    const raw = JSON.parse(await fs.readFile(taskQueuePath(), 'utf8')) as Record<string, any>
    expect(raw.tasks[0]?.status).toBe('gate_check')
    expect(raw.tasks[0]?.assignedTo).toBe('gate-checker-agent')
    expect(raw.tasks[0]?.notes?.at(-1)?.content).toMatch(/fresh gate-check pass/i)
  })

  it('rejects rerun-stage for invalid stage/status combinations', async () => {
    await seedTask('task-1', {
      status: 'in_progress',
      notes: [],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/rerun-stage'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ stage: 'gate' }),
      }),
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, any>
    expect(body.error).toMatch(/gate_check/i)
  })
})

describe('POST /api/project/task/:id/update-dependencies', () => {
  it('records explicit user/delegate dependency corrections', async () => {
    await seedTasks([
      {
        id: 'task-a',
        title: 'Inventory',
        status: 'ready',
      },
      {
        id: 'task-b',
        title: 'Implementation',
        status: 'ready',
      },
      {
        id: 'task-c',
        title: 'Verify migration record',
        status: 'exploring',
        dependsOn: [],
        notes: [],
      },
    ])
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-c/update-dependencies'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          dependsOn: ['task-a', 'task-b', 'task-a', 'task-c'],
          reason: 'The verification task should wait for inventory and implementation.',
        }),
      }),
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body).toMatchObject({
      ok: true,
      taskId: 'task-c',
      dependsOn: ['task-a', 'task-b'],
    })
    const raw = JSON.parse(await fs.readFile(taskQueuePath(), 'utf8')) as Record<string, any>
    const task = raw.tasks.find((candidate: Record<string, any>) => candidate.id === 'task-c')
    expect(task.dependsOn).toEqual(['task-a', 'task-b'])
    expect(task.notes.at(-1).content).toContain('verification task should wait')
  })

  it('rejects unknown dependency task ids', async () => {
    await seedTask('task-c', {
      status: 'exploring',
      dependsOn: [],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-c/update-dependencies'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dependsOn: ['missing-task'] }),
      }),
    )

    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, any>
    expect(body.error).toContain('missing-task')
  })
})

describe('POST /api/project/task/:id/create-split-children', () => {
  it('materializes stored split-required recommendations into child tasks', async () => {
    await seedTask('task-1', {
      status: 'spec_review',
      businessEnvelope: { goalId: 'goal-task-1' },
      sizePlan: {
        taskId: 'task-1',
        score: 8,
        band: 'epic',
        action: 'split_required',
        factors: [],
        recommendedChildren: [
          {
            title: 'Implement the billing settings workflow',
            reason: 'Keep the user-facing workflow small enough for UX review.',
            suggestedDomain: 'frontend',
            dependsOn: [],
          },
          {
            title: 'Add the admin subscription API contract',
            reason: 'Separate API compatibility and security review from UI work.',
            suggestedDomain: 'backend',
            dependsOn: ['Implement the billing settings workflow'],
          },
        ],
        reviewBudgetHint: 'release_critical',
        reasons: ['Task size score: 8.'],
        createdAt: '2026-05-25T12:00:00.000Z',
        createdBy: 'task-sizing',
      },
    })
    const { app } = buildServeApp({ projectPath: tmpDir })

    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/create-split-children'), { method: 'POST' }),
    )

    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, any>
    expect(body.createdTaskIds).toEqual([
      'task-1-split-implement-the-billing-settings-workflow',
      'task-1-split-add-the-admin-subscription-api-contract',
    ])
    expect(body.parentTaskId).toBe('task-1')

    const raw = JSON.parse(await fs.readFile(taskQueuePath(), 'utf8')) as Record<string, any>
    expect(raw.tasks).toHaveLength(3)
    expect(raw.tasks[0].status).toBe('ready')
    expect(raw.tasks[0].hierarchy.childIds).toEqual(body.createdTaskIds)
    expect(raw.tasks[0].taskReadiness.recommendation).toBe('ready')
    expect(raw.tasks[0].taskReadiness.summary).toContain('continue through the child tasks')
    expect(raw.tasks[0].sizePlan.action).toBe('proceed_with_warning')
    expect(raw.tasks[0].sizePlan.recommendedChildren.map((child: Record<string, unknown>) => child.createdTaskId)).toEqual(body.createdTaskIds)
    expect(raw.tasks[1]).toMatchObject({
      id: 'task-1-split-implement-the-billing-settings-workflow',
      status: 'exploring',
      businessEnvelope: { goalId: 'goal-task-1' },
      hierarchy: {
        parentId: 'task-1',
        order: 0,
        childIds: [],
      },
      origination: 'system',
      proposedBy: 'task-sizing',
    })
    expect(raw.tasks[2].dependsOn).toEqual(['task-1-split-implement-the-billing-settings-workflow'])
  })

  it('materializes stored split-recommended recommendations into child tasks', async () => {
    await seedTask('task-1', {
      status: 'spec_review',
      sizePlan: {
        taskId: 'task-1',
        score: 5,
        band: 'large',
        action: 'split_recommended',
        factors: [],
        recommendedChildren: [
          {
            title: 'Component implementation',
            reason: 'Ship the primitive implementation first.',
            suggestedDomain: 'frontend',
            dependsOn: [],
          },
          {
            title: 'Storybook story',
            reason: 'Add visual proof after the implementation exists.',
            suggestedDomain: 'frontend',
            dependsOn: ['Component implementation'],
          },
        ],
        reviewBudgetHint: 'thorough',
        reasons: ['Task size score: 5.'],
        createdAt: '2026-06-05T12:00:00.000Z',
        createdBy: 'task-sizing',
      },
    })
    const { app } = buildServeApp({ projectPath: tmpDir })

    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/create-split-children'), { method: 'POST' }),
    )

    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, any>
    expect(body.createdTaskIds).toEqual([
      'task-1-split-component-implementation',
      'task-1-split-storybook-story',
    ])

    const raw = JSON.parse(await fs.readFile(taskQueuePath(), 'utf8')) as Record<string, any>
    expect(raw.tasks[0].status).toBe('ready')
    expect(raw.tasks[0].hierarchy.childIds).toEqual(body.createdTaskIds)
    expect(raw.tasks[0].sizePlan.action).toBe('proceed_with_warning')
    expect(raw.tasks[0].taskReadiness.recommendation).toBe('ready')
    expect(raw.tasks[0].taskReadiness.summary).toContain('continue through the child tasks')
    expect(raw.tasks[2].dependsOn).toEqual(['task-1-split-component-implementation'])
  })

  it('repairs stale split readiness when child tasks were already materialized', async () => {
    await seedTasks([
      {
        id: 'task-1',
        title: 'Expand the imported backlog',
        status: 'ready',
        hierarchy: {
          childIds: ['task-1-split-audit', 'task-1-split-build'],
          order: 0,
        },
        sizePlan: {
          taskId: 'task-1',
          score: 8,
          band: 'epic',
          action: 'proceed_with_warning',
          factors: [],
          recommendedChildren: [
            {
              title: 'Audit',
              reason: 'Inventory remaining work.',
              createdTaskId: 'task-1-split-audit',
              dependsOn: [],
            },
            {
              title: 'Build',
              reason: 'Implement first verified unit.',
              createdTaskId: 'task-1-split-build',
              dependsOn: [],
            },
          ],
          reviewBudgetHint: 'release_critical',
          reasons: ['Split has already been materialized into linked child tasks; do not split this parent again unless the child structure changes.'],
          createdAt: '2026-06-05T12:00:00.000Z',
          createdBy: 'task-sizing',
        },
        taskReadiness: {
          taskKind: 'implementation',
          recommendation: 'requires_child_work',
          summary: 'Split-required work is represented by linked child tasks.',
          dimensions: [
            {
              id: 'size',
              status: 'blocked',
              summary: 'Work is too broad for one clean worker/review pass.',
              evidence: ['The task is too large for one high-quality agent pass and should become linked child tasks.'],
            },
          ],
          definitionOfDone: { items: [], evidenceRequired: [], updatedAt: '2026-06-05T12:00:00.000Z', createdBy: 'task-sizing' },
          blockerPlans: [],
          contextBudget: { estimatedTokens: 0, risk: 'medium', fitsInOneWorkerBrief: false, reasons: [] },
          assessedAt: '2026-06-05T12:00:00.000Z',
          assessedBy: 'task-sizing',
        },
      },
      {
        id: 'task-1-split-audit',
        title: 'Audit',
        status: 'done',
        hierarchy: { parentId: 'task-1', order: 0, childIds: [] },
      },
      {
        id: 'task-1-split-build',
        title: 'Build',
        status: 'ready',
        hierarchy: { parentId: 'task-1', order: 1, childIds: [] },
      },
    ])
    const { app } = buildServeApp({ projectPath: tmpDir })

    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/create-split-children'), { method: 'POST' }),
    )

    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, any>
    expect(body.createdTaskIds).toEqual(['task-1-split-audit', 'task-1-split-build'])
    const raw = JSON.parse(await fs.readFile(taskQueuePath(), 'utf8')) as Record<string, any>
    expect(raw.tasks[0].taskReadiness.recommendation).toBe('ready')
    expect(raw.tasks[0].taskReadiness.summary).toContain('continue through the child tasks')
    expect(raw.tasks[0].taskReadiness.dimensions.find((dimension: Record<string, unknown>) => dimension.id === 'size')).toMatchObject({
      status: 'ok',
      summary: 'Size is handled by linked child tasks.',
    })
    expect(raw.tasks[0].hierarchy.childIds).toEqual(['task-1-split-audit', 'task-1-split-build'])
  })

  it('materializes split children with validated delivery-spine metadata', async () => {
    await writeProjectDeliveryModel(tmpDir, {
      version: 1,
      updatedAt: '2026-06-05T12:00:00.000Z',
      drivers: [
        { id: 'knit', label: 'Knit', role: 'primary', paths: ['./apps/knit'], domains: [] },
        { id: 'looma', label: 'Looma', role: 'provider', paths: ['./packages/looma'], domains: [] },
      ],
      primitives: [
        {
          id: 'menu-item',
          label: 'MenuItem',
          kind: 'ui_primitive',
          provider: 'looma',
          paths: ['./packages/looma/src/menu'],
          dependsOn: [],
          invariants: ['Renders consistently as a button or link.'],
          proof: ['storybook'],
          status: 'needs_proof',
          source: 'user',
          evidence: [],
          aliases: [],
        },
      ],
      validationEvidence: [],
      rejectedCandidates: [],
    })
    await seedTask('task-1', {
      status: 'spec_review',
      delivery: { driver: 'knit', provider: 'looma', usesPrimitives: ['menu-item'] },
      sizePlan: {
        taskId: 'task-1',
        score: 5,
        band: 'large',
        action: 'split_recommended',
        factors: [],
        recommendedChildren: [
          {
            title: 'MenuItem implementation',
            reason: 'Compose the MenuItem primitive in the ContextMenu component.',
            suggestedDomain: 'frontend',
            dependsOn: [],
            usesPrimitives: ['menu-item'],
          },
          {
            title: 'Storybook proof',
            reason: 'Prove MenuItem states visually.',
            suggestedDomain: 'frontend',
            dependsOn: ['MenuItem implementation'],
            provesPrimitives: ['menu-item'],
            proofKind: 'storybook',
          },
        ],
        reviewBudgetHint: 'thorough',
        reasons: ['Task size score: 5.'],
        createdAt: '2026-06-05T12:00:00.000Z',
        createdBy: 'task-sizing',
      },
    })
    const { app } = buildServeApp({ projectPath: tmpDir })

    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/create-split-children'), { method: 'POST' }),
    )

    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, any>
    expect(body.splitPlan.errors).toEqual([])
    expect(body.splitPlan.children[1].delivery).toMatchObject({
      driver: 'knit',
      provider: 'looma',
      supports: ['task-1'],
      provesPrimitives: ['menu-item'],
      proofKind: 'storybook',
    })

    const raw = JSON.parse(await fs.readFile(taskQueuePath(), 'utf8')) as Record<string, any>
    expect(raw.tasks[1].delivery).toMatchObject({
      driver: 'knit',
      provider: 'looma',
      supports: ['task-1'],
      usesPrimitives: ['menu-item'],
    })
    expect(raw.tasks[2].delivery).toMatchObject({
      driver: 'knit',
      provider: 'looma',
      supports: ['task-1'],
      provesPrimitives: ['menu-item'],
      proofKind: 'storybook',
    })
    expect(raw.tasks[2].dependsOn).toEqual(['task-1-split-menuitem-implementation'])
  })
})

describe('POST /api/project/task/:id/resume', () => {
  it('appends a human follow-up message to the exploring transcript', async () => {
    await seedTask('task-1', { status: 'exploring' })
    // The transcript file is created on first append; resumeExploring does
    // the write, we just verify the end state.
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/resume'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'One more requirement: respect DOM ordering.' }),
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.ok).toBe(true)
    const transcript = (await readExploringTranscript({ memoryDir, taskId: 'task-1' })).content ?? ''
    expect(transcript).toMatch(/respect DOM ordering/)
  })

  it('preserves an in-flight task status when Thread sends a steering note', async () => {
    await seedTask('task-1', { status: 'in_progress', notes: [] })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/resume'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message: 'Check the current failure before editing.',
          preserveStatus: true,
        }),
      }),
    )
    expect(res.status).toBe(200)
    const queue = JSON.parse(
      await fs.readFile(taskQueuePath(), 'utf8'),
    ) as { tasks: Array<Record<string, any>> }
    expect(queue.tasks[0]!.status).toBe('in_progress')
    expect(queue.tasks[0]!.notes.at(-1)?.content).toContain('current failure')
    const transcript = (await readExploringTranscript({ memoryDir, taskId: 'task-1' })).content ?? ''
    expect(transcript).toMatch(/current failure/)
  })

  it('reopens blocked partial worker work for retry with a concrete instruction', async () => {
    await seedTask('task-1', {
      status: 'in_progress',
      assignedTo: 'worker-agent',
      notes: [],
    })
    const escalation = await raiseEscalation({
      tasksPath: taskQueuePath(),
      progressPath: getProjectSystemStatePath(tmpDir, 'PROGRESS.md'),
      taskId: 'task-1',
      agentId: 'worker-agent',
      reason: 'human_judgment_required',
      summary: 'Worker repeatedly hit its turn budget after saving partial work.',
    })
    expect(escalation.success).toBe(true)
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/retry-work'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          instruction: 'Continue from the partial diff and create the main reviewer file first.',
        }),
      }),
    )
    const body = (await res.json()) as Record<string, any>
    expect(res.status, JSON.stringify(body)).toBe(200)
    expect(body).toMatchObject({ ok: true, status: 'in_progress' })
    const queue = JSON.parse(
      await fs.readFile(taskQueuePath(), 'utf8'),
    ) as { tasks: Array<Record<string, any>> }
    expect(queue.tasks[0]).toMatchObject({
      status: 'in_progress',
      assignedTo: null,
    })
    expect(queue.tasks[0]?.blockReason).toBeUndefined()
    expect(queue.tasks[0]?.notes.at(-1)?.content).toContain('partial diff')
    const effective = await readEffectiveTask('task-1')
    expect(activeEscalations(effective as any)).toEqual([])
    const transcript = (await readExploringTranscript({ memoryDir, taskId: 'task-1' })).content ?? ''
    expect(transcript).toContain('create the main reviewer file')
  })

  it('reopens blocked work when retry encounters stale missing escalation runtime state', async () => {
    await seedTask('task-1', {
      status: 'blocked',
      assignedTo: null,
      blockReason: 'human_judgment_required: Spec author stopped after hitting its turn limit.',
      openEscalations: [
        {
          id: 'esc-task-1-stale',
          summary: 'Stale compact escalation row',
        },
      ],
      notes: [],
    })
    await upsertTaskRuntimeState(tmpDir, 'task-1', {
      assignedTo: null,
      openEscalationIds: ['esc-task-1-1'],
      updatedAt: new Date().toISOString(),
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/retry-work'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          instruction: 'Continue from saved planning notes and finish the reviewable proof.',
        }),
      }),
    )
    const body = (await res.json()) as Record<string, any>
    expect(res.status, JSON.stringify(body)).toBe(200)
    expect(body).toMatchObject({ ok: true, status: 'in_progress' })
    const queue = JSON.parse(
      await fs.readFile(taskQueuePath(), 'utf8'),
    ) as { tasks: Array<Record<string, any>> }
    expect(queue.tasks[0]).toMatchObject({
      status: 'in_progress',
      assignedTo: null,
    })
    expect(queue.tasks[0]?.blockReason).toBeUndefined()
    expect(queue.tasks[0]?.openEscalations).toBeUndefined()
    expect(queue.tasks[0]?.notes.at(-1)?.content).toContain('finish the reviewable proof')
    const effective = await readEffectiveTask('task-1')
    expect(activeEscalations(effective as any)).toEqual([])
    expect(effective.runtime?.openEscalationIds).toEqual([])
  })

  it('reopens completed work only when release proof is still missing', async () => {
    await seedTask('task-1', {
      status: 'done',
      notes: [],
      proofPaths: [{
        kind: 'review',
        expectedEvidence: [
          'DeepInfra drafting telemetry recorded refusal behavior, cost, latency, and voice preservation.',
        ],
      }],
      gateResults: [{
        gateId: 'npm-run-build',
        passed: true,
        output: 'build passed',
        checkedAt: '2026-07-06T20:00:00.000Z',
      }],
      reviewVerdicts: [{
        verdict: 'approve',
        reasoning: 'All acceptance criteria are met.',
        recordedAt: '2026-07-06T20:01:00.000Z',
      }],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/retry-work'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          instruction: 'Run the real provider proof and attach the evidence.',
        }),
      }),
    )
    const body = (await res.json()) as Record<string, any>
    expect(res.status, JSON.stringify(body)).toBe(200)
    expect(body).toMatchObject({ ok: true, status: 'in_progress' })
    const queue = await readTaskQueue()
    expect(queue.tasks[0]).toMatchObject({
      status: 'in_progress',
      assignedTo: null,
    })
    const noteText = queue.tasks[0]?.notes.map((note: Record<string, unknown>) => String(note.content ?? '')).join('\n') ?? ''
    expect(noteText).toContain('missing release proof')
    expect(noteText).toContain('real provider proof')
    const effective = await readEffectiveTask('task-1')
    expect(effective.status).toBe('in_progress')
    expect(effective.runtime?.proofRecovery?.reason).toBe('Run the real provider proof and attach the evidence.')

    const detailRes = await app.fetch(new Request(projectUrl('/api/project/task/task-1')))
    expect(detailRes.status).toBe(200)
    const detailBody = (await detailRes.json()) as Record<string, any>
    expect(detailBody.task?.completionProof).toMatchObject({
      state: 'missing',
      expectedCount: 1,
      verifiedCount: expect.any(Number),
      missing: ['Required proof evidence has not been attached yet.'],
    })

    const projectRes = await app.fetch(new Request(projectUrl('/api/project?surface=work&task=task-1')))
    expect(projectRes.status).toBe(200)
    const projectBody = (await projectRes.json()) as Record<string, any>
    const task = projectBody.tasks?.find((entry: Record<string, any>) => entry.id === 'task-1')
    expect(task?.status).toBe('in_progress')
    expect(task?.completionProof).toMatchObject({
      state: 'missing',
      expectedCount: 1,
      verifiedCount: expect.any(Number),
      missing: ['Required proof evidence has not been attached yet.'],
    })
    expect(task?.runtime?.proofRecovery?.reason).toBe('Run the real provider proof and attach the evidence.')
  })

  it('does not reopen stale raw retries when effective completion proof already settled the task', async () => {
    await seedTask('task-1', {
      status: 'in_progress',
      assignedTo: 'worker-agent',
      completedAt: '2026-07-06T20:00:00.000Z',
      notes: [],
      proofPaths: [{
        kind: 'review',
        expectedEvidence: [
          'DeepInfra drafting telemetry recorded refusal behavior, cost, latency, and voice preservation.',
        ],
      }],
      doneSummaryBundle: {
        taskId: 'task-1',
        status: 'done',
        completedAt: '2026-07-06T20:00:00.000Z',
        summary: {
          journey: 'Worker proved the provider drafting lane.',
          decision: 'Task finished as done.',
          evidence: 'DeepInfra drafting telemetry recorded refusal behavior, cost, latency, and voice preservation.',
          learningCandidates: [],
          openResidue: 'No residue.',
        },
        retention: {
          transcriptPrimaryArtifact: false,
          compactedFullTranscript: false,
          fullEvidenceAvailable: true,
        },
        evidenceRefs: [],
        createdAt: '2026-07-06T20:00:00.000Z',
        createdBy: 'orchestrator',
      },
      gateResults: [{
        gateId: 'deepinfra-drafting-telemetry',
        passed: true,
        output: 'DeepInfra drafting telemetry recorded refusal behavior, cost, latency, and voice preservation.',
        checkedAt: '2026-07-06T20:00:00.000Z',
      }],
      reviewVerdicts: [{
        verdict: 'approve',
        reasoning: 'All acceptance criteria are met.',
        recordedAt: '2026-07-06T20:01:00.000Z',
      }],
    })
    expect((await readEffectiveTask('task-1')).status).toBe('done')

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/retry-work'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          instruction: 'Run the real provider proof and attach the evidence.',
        }),
      }),
    )
    const body = (await res.json()) as Record<string, any>
    expect(res.status, JSON.stringify(body)).toBe(400)
    expect(body).toMatchObject({ error: 'task is done' })
    const effective = await readEffectiveTask('task-1')
    expect(effective.status).toBe('done')
    expect(effective.runtime?.proofRecovery).toBeUndefined()
  })

  it('promotes an import draft into exploring when shaping starts', async () => {
    await fs.mkdir(path.join(tmpDir, 'docs/specs'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'docs/specs/link-editor.md'),
      [
        '# Link editor',
        '',
        'The editor should allow inline link editing with explicit URL and label controls.',
        'Writers should not need to leave the current surface to adjust a link.',
      ].join('\n'),
      'utf8',
    )
    await seedTask('task-1', {
      status: 'import_draft',
      title: 'Knit: add link editor controls',
      description: 'Draft imported from planning docs.',
      assignedTo: 'worker-agent',
      blockReason: 'Old implementation blocker should not survive draft shaping.',
      worktreePath: path.join(tmpDir, '.guildhall', 'worktrees', 'task-1'),
      branchName: 'guildhall/task-task-1',
      acceptanceCriteria: [],
      requestIntake: {
        intent: 'spec_only',
        recommendedNextAction: 'draft_spec',
        assumptions: ['The planning doc still matches the desired editor flow.'],
        missingInformation: ['Confirm whether inline editing also needs keyboard shortcuts.'],
        evidenceRefs: [`import:${path.join(tmpDir, 'docs/specs/link-editor.md')}`],
        componentStack: [],
        pressureTestSummary: {
          systemOwned: true,
          degree: 'guided',
          qualityBar: 'Imported draft shaping should stay grounded in the cited planning docs.',
          ownerQuestionPolicy: 'Only ask when the cited docs still leave the scope boundary unclear.',
          checks: [],
        },
        clarifyingQuestions: [],
        createdAt: new Date().toISOString(),
        createdBy: 'workspace-importer',
      },
      notes: [
        {
          agentId: 'workspace-importer',
          role: 'importer',
          content: 'Imported from: knit/docs/feature-roadmap.md',
          timestamp: new Date().toISOString(),
        },
      ],
    })
    await upsertTaskRuntimeState(tmpDir, 'task-1', {
      assignedTo: 'worker-agent',
      revisionCount: 2,
      remediationAttempts: 1,
      updatedAt: new Date().toISOString(),
    })
    await upsertTaskWorkspaceState(tmpDir, 'task-1', {
      worktreePath: path.join(tmpDir, '.guildhall', 'worktrees', 'task-1'),
      branchName: 'guildhall/task-task-1',
      baseBranch: 'main',
      updatedAt: new Date().toISOString(),
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/shape-draft'), {
        method: 'POST',
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.status).toBe('exploring')
    const queue = JSON.parse(
      await fs.readFile(taskQueuePath(), 'utf8'),
    ) as { tasks: Array<Record<string, any>> }
    expect(queue.tasks[0]!.status).toBe('exploring')
    expect(queue.tasks[0]!.assignedTo).toBeNull()
    expect(queue.tasks[0]!.blockReason).toBeUndefined()
    expect(queue.tasks[0]!.worktreePath).toBeUndefined()
    expect(queue.tasks[0]!.branchName).toBeUndefined()
    expect(queue.tasks[0]!.notes?.at(-1)?.role).toBe('shaping-request')
    const runtimeStore = await readTaskRuntimeStore(tmpDir)
    const workspaceStore = await readTaskWorkspaceStore(tmpDir)
    expect(runtimeStore.tasks['task-1']).toBeUndefined()
    expect(workspaceStore.workspaces['task-1']).toBeUndefined()
    const transcript = (await readExploringTranscript({ memoryDir, taskId: 'task-1' })).content ?? ''
    expect(transcript).toMatch(/Imported draft context/)
    expect(transcript).toMatch(/Knit: add link editor controls/)
    expect(transcript).toMatch(/The planning doc still matches the desired editor flow/)
    expect(transcript).toMatch(/docs\/specs\/link-editor\.md/)
    expect(transcript).toMatch(/allow inline link editing with explicit URL and label controls/i)

    const detailRes = await app.fetch(new Request(projectUrl('/api/project/task/task-1')))
    expect(detailRes.status).toBe(200)
    const detailBody = (await detailRes.json()) as Record<string, any>
    expect(detailBody.task?.status).toBe('exploring')
    expect(detailBody.task?.assignedTo).toBeNull()
    expect(detailBody.task?.runtime).toMatchObject({
      assignedTo: null,
      revisionCount: 0,
      remediationAttempts: 0,
      openEscalationIds: [],
      openIssueIds: [],
    })
    expect(detailBody.task?.workspace).toBeUndefined()
  })

  it('repairs stale worker overlays on imported tasks already back in shaping', async () => {
    const staleProjectPath = path.join(tmpDir, 'docs', 'harness')
    await seedRawTaskDefinition('task-1', {
      status: 'exploring',
      title: 'Recover source-backed contract surface for author-involvement-modes contract and involvement-dial types',
      projectPath: staleProjectPath,
      assignedTo: 'worker-agent',
      blockReason: 'Old implementation blocker should not survive imported draft shaping.',
      worktreePath: path.join(tmpDir, '.guildhall', 'worktrees', 'task-1'),
      branchName: 'guildhall/task-task-1',
      notes: [
        {
          agentId: 'workspace-importer',
          role: 'importer',
          content: 'Imported from planning docs.',
          timestamp: new Date().toISOString(),
        },
      ],
      taskKind: 'research',
      acceptanceCriteria: [{
        id: 'contract-surface-recovered',
        description: 'Contract surface is recovered from cited sources.',
        verifiedBy: 'review',
        source: 'documented',
        met: false,
      }],
      taskReadiness: {
        recommendation: 'needs_research_spike',
        summary: 'Needs concrete source-backed contract names before worker handoff.',
      },
      requestIntake: {
        createdBy: 'workspace-importer',
      },
    })
    await upsertTaskRuntimeState(tmpDir, 'task-1', {
      assignedTo: 'worker-agent',
      revisionCount: 2,
      remediationAttempts: 1,
      updatedAt: new Date().toISOString(),
    })
    await upsertTaskWorkspaceState(tmpDir, 'task-1', {
      worktreePath: path.join(tmpDir, '.guildhall', 'worktrees', 'task-1'),
      branchName: 'guildhall/task-task-1',
      baseBranch: 'main',
      updatedAt: new Date().toISOString(),
    })

    const { app } = buildServeApp({ projectPath: tmpDir })
    const projectRes = await app.fetch(new Request(projectUrl('/api/project')))
    expect(projectRes.status).toBe(200)
    const projectBody = (await projectRes.json()) as Record<string, any>
    expect(projectBody.tasks.find((task: Record<string, any>) => task.id === 'task-1')).toMatchObject({
      status: 'exploring',
      projectPath: tmpDir,
      assignedTo: null,
    })
    expect(projectBody.tasks.find((task: Record<string, any>) => task.id === 'task-1')?.blockReason).toBeUndefined()
    expect(projectBody.tasks.find((task: Record<string, any>) => task.id === 'task-1')?.workspace).toBeUndefined()

    const queue = await readTaskQueue()
    expect(queue.tasks[0]).toMatchObject({
      projectPath: tmpDir,
      assignedTo: null,
      revisionCount: 0,
      remediationAttempts: 0,
    })
    expect(queue.tasks[0].blockReason).toBeUndefined()
    expect(queue.tasks[0].worktreePath).toBeUndefined()
    expect(queue.tasks[0].branchName).toBeUndefined()
    expect(queue.tasks[0].notes.some((note: { role?: string }) => note.role === 'state-repair')).toBe(true)

    const runtimeStore = await readTaskRuntimeStore(tmpDir)
    const workspaceStore = await readTaskWorkspaceStore(tmpDir)
    expect(runtimeStore.tasks['task-1']).toBeUndefined()
    expect(workspaceStore.workspaces['task-1']).toBeUndefined()
  })

  it('continues source recovery for an already-shaped imported task', async () => {
    await fs.mkdir(path.join(tmpDir, 'docs/specs'), { recursive: true })
    const sourcePath = path.join(tmpDir, 'docs/specs/author-involvement-modes.md')
    await fs.writeFile(
      sourcePath,
      [
        '# Author involvement modes',
        '',
        'The author can shape how much intervention each review lane may perform.',
      ].join('\n'),
      'utf8',
    )
    const now = new Date().toISOString()
    await seedTask('task-1', {
      status: 'exploring',
      title: 'Recover source-backed contract surface for author involvement modes',
      description: 'Imported contract target needs concrete source recovery.',
      assignedTo: null,
      acceptanceCriteria: [{
        id: 'contract-surface-recovered',
        description: 'Names concrete source-backed surfaces.',
        verifiedBy: 'review',
      }],
      references: [sourcePath],
      taskReadiness: {
        recommendation: 'needs_research_spike',
        summary: 'Needs concrete contract names before Guildhall can hand it to a worker.',
      },
      notes: [
        {
          agentId: 'workspace-importer',
          role: 'importer',
          content: 'Imported from docs/specs/author-involvement-modes.md',
          timestamp: now,
        },
        {
          agentId: 'human',
          role: 'shaping-request',
          content: 'User asked Guildhall to shape this imported draft into a complete task.',
          timestamp: now,
        },
      ],
    })

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/shape-draft'), {
        method: 'POST',
      }),
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.status).toBe('exploring')
    const queue = JSON.parse(
      await fs.readFile(taskQueuePath(), 'utf8'),
    ) as { tasks: Array<Record<string, any>> }
    expect(queue.tasks[0]!.status).toBe('exploring')
    expect(queue.tasks[0]!.notes.filter((note: Record<string, unknown>) => note.role === 'shaping-request')).toHaveLength(1)
    const transcript = (await readExploringTranscript({ memoryDir, taskId: 'task-1' })).content ?? ''
    expect(transcript).toMatch(/Imported draft context/)
    expect(transcript).toMatch(/author can shape how much intervention/i)
  })

  it('shelves an imported draft immediately when it is an obvious duplicate of finished work', async () => {
    const now = new Date().toISOString()
    await writeTaskQueue({
      version: 1,
      lastUpdated: now,
      tasks: [
        {
          id: 'task-done',
          title: 'Add E2E login -> create page -> edit -> search flow',
          description: 'Finished version',
          domain: 'knit',
          projectPath: '/tmp/knit',
          status: 'done',
          priority: 'normal',
          revisionCount: 0,
          remediationAttempts: 0,
          origination: 'human',
          createdAt: now,
          updatedAt: now,
        },
        {
          id: 'task-1',
          title: 'E2E tests: login → create page → edit → search flow',
          description: 'Imported raw draft',
          domain: 'knit',
          projectPath: '/tmp/knit',
          status: 'import_draft',
          priority: 'normal',
          revisionCount: 0,
          remediationAttempts: 0,
          origination: 'human',
          createdAt: now,
          updatedAt: now,
          acceptanceCriteria: [],
          notes: [
            {
              agentId: 'workspace-importer',
              role: 'importer',
              content: 'Imported from: knit/docs/feature-roadmap.md',
              timestamp: now,
            },
          ],
        },
      ],
    })

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/shape-draft'), {
        method: 'POST',
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.status).toBe('shelved')

    const queue = JSON.parse(
      await fs.readFile(taskQueuePath(), 'utf8'),
    ) as { tasks: Array<Record<string, any>> }
    const task = queue.tasks.find(task => task.id === 'task-1')
    expect(task?.status).toBe('shelved')
    expect(task?.shelveReason?.code).toBe('duplicate')
    expect(task?.shelveReason?.detail).toMatch(/task-done/)
    expect(task?.notes?.at(-1)?.content).toMatch(/Duplicate of task-done/i)
  })

  it('rejects resume with neither a message nor an escalation resolution', async () => {
    await seedTask('task-1', { status: 'exploring' })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/resume'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, any>
    expect(body.error).toMatch(/message|escalation/i)
  })

  it('rejects resume on an unknown task', async () => {
    await seedTask('task-1', { status: 'exploring' })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/missing/resume'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'hi' }),
      }),
    )
    expect(res.status).toBe(400)
  })
})

describe('POST /api/project/bounded-chat/:id/answer', () => {
  it('accepts generic owner-input task shaping answers instead of rendering a dead Thread composer', async () => {
    const ownerInput = await createOwnerInputRequest({
      projectRoot: tmpDir,
      projectId,
      commandId: 'test:alert-dialog-variants',
      now: '2026-06-03T12:00:00.000Z',
      actor: 'test',
      source: { kind: 'task', taskId: 'task-alert-dialog', questionId: 'variants' },
      target: { kind: 'thread' },
      objective: {
        kind: 'task_shaping',
        label: 'Clarify AlertDialog',
        successCriteria: ['Owner answers the linked bounded-chat session.'],
      },
      question: {
        kind: 'text',
        prompt: 'What variants does AlertDialog need?',
        description: 'Guildhall needs one clear answer before it shapes future work.',
      },
    })
    const session = ownerInput.session
    const { app } = buildServeApp({ projectPath: tmpDir })
    await applyStorageBoundaryMigration(app)

    const res = await app.fetch(
      new Request(projectUrl(`/api/project/bounded-chat/${session.id}/answer`), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          questionId: 'variants',
          answer: 'AlertDialog should be a constant destructive-confirmation pattern, not a variant matrix.',
        }),
      }),
    )

    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, any>
    expect(body.boundedChat?.status).toBe('coordinator_review')
    const saved = await loadBoundedChatSession({ memoryDir, sessionId: session.id })
    expect(saved.status).toBe('coordinator_review')
    expect(saved.subObjectives[0]?.localTurns.at(-1)?.content).toContain('constant destructive-confirmation')
    const requests = await listOwnerInputRequests(tmpDir)
    expect(requests[0]).toMatchObject({
      id: ownerInput.request.id,
      status: 'coordinator_review',
      boundedChatSessionId: session.id,
    })
  })
})

describe('POST /api/project/task/:id/reframe-task', () => {
  it('reopens an inscrutable blocked task for a fresh plain-language frame', async () => {
    await seedRawTaskDefinition('task-1', {
      status: 'blocked',
      assignedTo: 'worker-agent',
      blockReason: 'human_judgment_required: Required authoritative verification is blocked by upstream workspace build failure outside checkpoint-touched editor files.',
      productBrief: {
        approvedAt: new Date().toISOString(),
        userJob: 'Old internal phrasing.',
        successMetric: 'Old finish line.',
      },
      spec: '## Summary\nOld schematic-style spec.',
      acceptanceCriteria: [{ id: 'AC-8', description: 'Provide authoritative verification evidence.', verifiedBy: 'review' }],
      escalations: [{
        id: 'esc-old',
        taskId: 'task-1',
        agentId: 'worker-agent',
        reason: 'human_judgment_required',
        summary: 'This task needs a recovery decision.',
        raisedAt: new Date().toISOString(),
      }],
      notes: [],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/reframe-task'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'The current task is unreadable.' }),
      }),
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.status).toBe('exploring')

    const queue = JSON.parse(
      await fs.readFile(taskQueuePath(), 'utf8'),
    ) as { tasks: Array<Record<string, any>> }
    const task = queue.tasks[0]!
    expect(task.status).toBe('exploring')
    expect(task.assignedTo).toBe('spec-agent')
    expect(task.blockReason).toBeUndefined()
    expect(task.productBrief).toBeUndefined()
    expect(task.spec).toBeUndefined()
    expect(task.acceptanceCriteria).toEqual([])
    expect(task.escalations[0]?.resolvedAt).toBeTruthy()
    expect(task.notes.some((note: Record<string, unknown>) => /reframe/i.test(String(note.content ?? '')))).toBe(true)
    const transcript = (await readExploringTranscript({ memoryDir, taskId: 'task-1' })).content ?? ''
    expect(transcript).toContain('Reframe this existing task')
    expect(transcript).toContain('what exact decision is needed')
    expect(transcript).toContain('The current task is unreadable.')
  })

  it('reopens an active worker claim when no durable implementation output exists yet', async () => {
    await seedTask('task-1', {
      status: 'in_progress',
      assignedTo: 'worker-agent',
      spec: '## Summary\nApply the wrong broad policy in the dashboard.',
      acceptanceCriteria: [{ id: 'AC-1', description: 'Dashboard shows the policy.', verifiedBy: 'review' }],
      notes: [{
        agentId: 'task-claimer',
        role: 'orchestrator',
        content: 'Claimed ready task for worker-agent.',
        timestamp: '2026-05-19T10:00:00.000Z',
      }],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })

    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/reframe-task'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'The spec copied parent scope into this child before any worker output was saved.' }),
      }),
    )

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ ok: true, status: 'exploring' })

    const queue = await readTaskQueue()
    const task = queue.tasks[0]!
    expect(task.status).toBe('exploring')
    expect(task.assignedTo).toBe('spec-agent')
    expect(task.spec).toBeUndefined()
    expect(task.acceptanceCriteria).toEqual([])
    expect(task.notes.some((note: Record<string, unknown>) =>
      String(note.content ?? '').includes('Cleared an active agent claim with no durable worker checkpoint'),
    )).toBe(true)
    const effective = await buildEffectiveTask(tmpDir, task as any) as Record<string, any>
    expect(effective.assignedTo).toBe('spec-agent')
  })

  it('rejects reframe once implementation work has durable output', async () => {
    await seedTask('task-1', {
      status: 'in_progress',
      assignedTo: 'worker-agent',
      handoffStep: 1,
      spec: '## Summary\nApply the policy in the dashboard.',
      acceptanceCriteria: [{ id: 'AC-1', description: 'Dashboard shows the policy.', verifiedBy: 'review' }],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })

    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/reframe-task'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'This should be split.' }),
      }),
    )

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringContaining('already started implementation'),
    })
  })
})

describe('POST /api/project/task/:id/enrich-task', () => {
  it('converts legacy partial task readiness records before brief cleanup enrichment', async () => {
    await seedTasks([
      {
        id: 'task-1',
        status: 'ready',
        title: 'Ready task with an incomplete brief',
        productBrief: { approvedAt: new Date().toISOString(), userJob: 'Understand policy overhead.' },
        spec: '## Summary\nDraft overhead policy.',
        acceptanceCriteria: [{ id: 'ac-1', description: 'Policy has a concrete check.', verifiedBy: 'review' }],
        taskReadiness: { recommendation: 'ready' },
        notes: [],
      },
      {
        id: 'task-legacy-sibling',
        status: 'ready',
        title: 'Sibling carrying old split readiness',
        taskReadiness: { recommendation: 'requires_child_work' },
        notes: [],
      },
    ])
    const { app } = buildServeApp({ projectPath: tmpDir })

    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/enrich-task'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mode: 'checklist',
          instruction: 'Complete this task for worker handoff.',
        }),
      }),
    )

    const body = await res.json() as Record<string, any>
    expect(res.status, JSON.stringify(body)).toBe(200)
    expect(body).toMatchObject({ ok: true, status: 'exploring' })

    const raw = JSON.parse(
      await fs.readFile(taskQueuePath(), 'utf8'),
    ) as { tasks: Array<Record<string, any>> }
    expect(raw.tasks[0]!.taskReadiness).toMatchObject({
      taskKind: expect.any(String),
      recommendation: 'ready',
      summary: expect.any(String),
      definitionOfDone: {
        items: expect.any(Array),
        evidenceRequired: expect.any(Array),
      },
      contextBudget: {
        risk: expect.any(String),
        fitsInOneWorkerBrief: expect.any(Boolean),
      },
      assessedAt: expect.any(String),
    })
    expect(raw.tasks[1]!.taskReadiness).toMatchObject({
      taskKind: expect.any(String),
      recommendation: 'requires_child_work',
      contextBudget: {
        fitsInOneWorkerBrief: false,
      },
    })
  })

  it('reopens a blocked task for split enrichment without deleting the existing spec', async () => {
    await seedRawTaskDefinition('task-1', {
      status: 'blocked',
      assignedTo: 'worker-agent',
      blockReason: 'human_judgment_required: OAuth providers need setup.',
      productBrief: {
        approvedAt: new Date().toISOString(),
        userJob: 'Sign in with external providers.',
        successMetric: 'Google and Apple sign-in complete end-to-end.',
      },
      spec: '## Summary\nImplement OAuth buttons and callbacks.',
      acceptanceCriteria: [{ id: 'AC-1', description: 'Google sign-in works.', verifiedBy: 'review' }],
      escalations: [{
        id: 'esc-oauth',
        taskId: 'task-1',
        agentId: 'worker-agent',
        reason: 'human_judgment_required',
        summary: 'OAuth providers need setup.',
        raisedAt: new Date().toISOString(),
      }],
      notes: [],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })

    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/enrich-task'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mode: 'split',
          instruction: 'Split Google OAuth setup, Apple OAuth setup, and live verification.',
        }),
      }),
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.status).toBe('exploring')

    const queue = JSON.parse(
      await fs.readFile(taskQueuePath(), 'utf8'),
    ) as { tasks: Array<Record<string, any>> }
    const task = queue.tasks[0]!
    expect(task.status).toBe('exploring')
    expect(task.assignedTo).toBe('spec-agent')
    expect(task.blockReason).toBeUndefined()
    expect(task.productBrief?.userJob).toBe('Sign in with external providers.')
    expect(task.spec).toContain('Implement OAuth buttons')
    expect(task.acceptanceCriteria).toHaveLength(1)
    expect(task.escalations[0]?.resolution).toMatch(/enrichment request/i)
    const transcript = (await readExploringTranscript({ memoryDir, taskId: 'task-1' })).content ?? ''
    expect(transcript).toContain('Enrich this task')
    expect(transcript).toContain('containing work with smaller linked nested work')
    expect(transcript).toContain('Split Google OAuth setup')
  })
})

describe('POST /api/project/task/:id/continue', () => {
  it('continues brief cleanup through continuous coordination without one-task start semantics', async () => {
    await seedTask('task-1', {
      status: 'ready',
      assignedTo: null,
      title: 'Ready task with an incomplete brief',
      productBrief: { approvedAt: new Date().toISOString(), userJob: 'Understand policy overhead.' },
      spec: '## Summary\nDraft overhead policy.',
      acceptanceCriteria: [{ id: 'ac-1', description: 'Policy has a concrete check.', verifiedBy: 'review' }],
      notes: [],
    })
    const { supervisor, starts } = createTrackingSupervisor()
    const { app } = buildServeApp({ projectPath: tmpDir, supervisor })
    await applyStorageBoundaryMigration(app)
    setProvider('anthropic-api', { apiKey: 'sk-ant-test' })
    updateGlobalConfig({ preferredProvider: 'anthropic-api' })

    try {
      const res = await app.fetch(
        new Request(projectUrl('/api/project/task/task-1/continue'), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            action: 'brief_cleanup',
            mode: 'checklist',
            instruction: 'Complete this task for worker handoff.',
          }),
        }),
      )
      const body = await res.json() as Record<string, any>

      expect(res.status, JSON.stringify(body)).toBe(200)
      expect(body).toMatchObject({
        ok: true,
        taskId: 'task-1',
        action: 'brief_cleanup',
        status: 'exploring',
        continuation: {
          status: 'started',
          runStatus: 'running',
          mode: 'continuous',
        },
      })
      await vi.waitFor(() => {
        expect(starts).toEqual([{ preferredTaskId: 'task-1' }])
      })
      expect(supervisor.get(projectId)?.mode).toBe('continuous')

      const queue = JSON.parse(
        await fs.readFile(taskQueuePath(), 'utf8'),
      ) as { tasks: Array<Record<string, any>> }
      expect(queue.tasks[0]).toMatchObject({
        id: 'task-1',
        status: 'exploring',
        assignedTo: 'spec-agent',
      })
      const transcript = (await readExploringTranscript({ memoryDir, taskId: 'task-1' })).content ?? ''
      expect(transcript).toContain('Complete this task for worker handoff.')
    } finally {
      await supervisor.stopAll({ reason: 'test-teardown' }).catch(() => {})
    }
  })

  it('queues brief cleanup continuation instead of rejecting when the project is already running', async () => {
    await seedTask('task-1', {
      status: 'ready',
      assignedTo: null,
      title: 'Queued cleanup task',
      productBrief: { approvedAt: new Date().toISOString(), userJob: 'Understand policy overhead.' },
      spec: '## Summary\nDraft overhead policy.',
      acceptanceCriteria: [{ id: 'ac-1', description: 'Policy has a concrete check.', verifiedBy: 'review' }],
      notes: [],
    })
    const { supervisor, starts } = createTrackingSupervisor()
    const { app } = buildServeApp({ projectPath: tmpDir, supervisor })

    try {
      supervisor.start({ workspaceId: projectId, workspacePath: tmpDir })
      await vi.waitFor(() => expect(supervisor.get(projectId)?.status).toBe('running'))
      await vi.waitFor(() => expect(starts).toHaveLength(1))
      starts.length = 0
      const startSpy = vi.spyOn(supervisor, 'start')

      const res = await app.fetch(
        new Request(projectUrl('/api/project/task/task-1/continue'), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            action: 'brief_cleanup',
            mode: 'checklist',
            instruction: 'Complete this task for worker handoff.',
          }),
        }),
      )
      const body = await res.json() as Record<string, any>

      expect(res.status, JSON.stringify(body)).toBe(200)
      expect(body).toMatchObject({
        ok: true,
        taskId: 'task-1',
        action: 'brief_cleanup',
        status: 'exploring',
        continuation: {
          status: 'queued',
          runStatus: 'running',
        },
      })
      expect(startSpy).not.toHaveBeenCalled()
      expect(starts).toEqual([])
    } finally {
      await supervisor.stopAll({ reason: 'test-teardown' }).catch(() => {})
    }
  })
})

describe('POST /api/project/task/:id/approve-brief', () => {
  it('marks a drafted product brief as approved and records approvedBy/At', async () => {
    await seedTask('task-1', {
      status: 'exploring',
      productBrief: {
        userJob: 'As a new user I want to X so Y',
        successMetric: 'Time-to-first-success drops below 60s',
        antiPatterns: ['no dark patterns', 'no jargon in first 3 screens'],
        authoredBy: 'agent:spec-agent',
        authoredAt: new Date().toISOString(),
      },
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/approve-brief'), { method: 'POST' }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.ok).toBe(true)

    const raw = await fs.readFile(taskQueuePath(), 'utf8')
    const q = JSON.parse(raw)
    expect(q.tasks[0].productBrief.approvedBy).toBe('human')
    expect(q.tasks[0].productBrief.approvedAt).toMatch(/\d{4}-\d{2}-\d{2}T/)
    // User job + success metric are unchanged by approval.
    expect(q.tasks[0].productBrief.userJob).toMatch(/new user/)
  })

  it('promotes an exploring task back to spec_review when the brief is approved after a concrete spec draft already exists', async () => {
    await seedTask('task-1', {
      status: 'exploring',
      spec: '## Summary\n\nDraft spec.\n\n## Acceptance Criteria\n\n1. Works.',
      acceptanceCriteria: [
        { id: 'ac-1', description: 'Works.', verifiedBy: 'review', met: false },
      ],
      openQuestions: [],
      productBrief: {
        userJob: 'As a new user I want to X so Y',
        successMetric: 'Time-to-first-success drops below 60s',
        antiPatterns: [],
        authoredBy: 'agent:spec-agent',
        authoredAt: new Date().toISOString(),
      },
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/approve-brief'), { method: 'POST' }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.ok).toBe(true)
    expect(body.status).toBe('spec_review')

    const raw = await fs.readFile(taskQueuePath(), 'utf8')
    const q = JSON.parse(raw)
    expect(q.tasks[0].status).toBe('spec_review')
  })

  it('seeds a deterministic spec when an approved exploring brief has no concrete spec yet', async () => {
    await seedTask('task-1', {
      status: 'exploring',
      spec: undefined,
      acceptanceCriteria: [],
      openQuestions: [],
      productBrief: {
        userJob: 'Verify whether the registered story specs already satisfy the current MVP decomposition.',
        whyItMattersNow: 'Guildhall needs the owner-approved brief to become runnable work instead of another intake loop.',
        successMetric: 'The remaining decomposition delta is reviewed, proven, and no longer asks the owner to repeat answered intake.',
        nonGoals: ['Do not broaden into unrelated roadmap planning.'],
        antiPatterns: [],
        authoredBy: 'agent:spec-agent',
        authoredAt: new Date().toISOString(),
      },
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/approve-brief'), { method: 'POST' }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body).toMatchObject({ ok: true, status: 'spec_review' })

    const raw = await fs.readFile(taskQueuePath(), 'utf8')
    const q = JSON.parse(raw)
    expect(q.tasks[0].status).toBe('spec_review')
    expect(q.tasks[0].productBrief.approvedBy).toBe('human')
    expect(q.tasks[0].spec).toContain('## Completion Boundary')
    expect(q.tasks[0].spec).toContain('Approved user job')
    expect(q.tasks[0].acceptanceCriteria).toHaveLength(3)
    expect(q.tasks[0].notes.at(-1)?.content).toContain('deterministic spec seed from the approved brief')
  })

  it('repairs stale unassigned in-progress approved brief into spec_review', async () => {
    await seedTask('task-1', {
      status: 'in_progress',
      assignedTo: null,
      spec: undefined,
      acceptanceCriteria: [],
      openQuestions: [],
      productBrief: {
        userJob: 'Verify whether the backlog decomposition is already represented by current project artifacts.',
        whyItMattersNow: 'The approved brief should become reviewable work without making the owner restart intake.',
        successMetric: 'The remaining decomposition delta is captured as reviewable acceptance criteria.',
        nonGoals: ['Do not broaden into unrelated roadmap planning.'],
        antiPatterns: [],
        approvedBy: 'human',
        approvedAt: new Date().toISOString(),
        authoredBy: 'agent:spec-agent',
        authoredAt: new Date().toISOString(),
      },
    })
    await upsertTaskRuntimeState(tmpDir, 'task-1', {
      assignedTo: null,
      openEscalationIds: ['esc-stale-runtime-only'],
      updatedAt: new Date().toISOString(),
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/approve-brief'), { method: 'POST' }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body).toMatchObject({ ok: true, status: 'spec_review' })

    const raw = await fs.readFile(taskQueuePath(), 'utf8')
    const q = JSON.parse(raw)
    expect(q.tasks[0].status).toBe('spec_review')
    expect(q.tasks[0].assignedTo).toBeUndefined()
    expect(q.tasks[0].spec).toContain('Approved user job')
    expect(q.tasks[0].acceptanceCriteria).toHaveLength(3)
    const effective = await readEffectiveTask('task-1')
    expect(effective.runtime?.openEscalationIds).toEqual([])
  })

  it('uses effective task state when raw approved brief state is stale', async () => {
    await seedRawTaskDefinition('task-1', {
      status: 'in_progress',
      assignedTo: 'spec-agent',
      spec: undefined,
      acceptanceCriteria: [],
      openQuestions: [],
      escalations: [
        {
          id: 'esc-task-1-1',
          taskId: 'task-1',
          agentId: 'spec-agent',
          reason: 'human_judgment_required',
          summary: 'Spec author stopped after hitting its turn limit.',
          details: 'Exceeded maximum turn limit (8)',
          raisedAt: '2026-05-31T00:57:20.368Z',
        },
      ],
      productBrief: {
        userJob: 'Verify whether the backlog decomposition is already represented by current project artifacts.',
        whyItMattersNow: 'The approved brief should become reviewable work without making the owner restart intake.',
        successMetric: 'The remaining decomposition delta is captured as reviewable acceptance criteria.',
        nonGoals: ['Do not broaden into unrelated roadmap planning.'],
        antiPatterns: [],
        approvedBy: 'human',
        approvedAt: new Date().toISOString(),
        authoredBy: 'agent:spec-agent',
        authoredAt: new Date().toISOString(),
      },
    })
    await upsertTaskRuntimeState(tmpDir, 'task-1', {
      assignedTo: null,
      openEscalationIds: ['esc-task-1-1'],
      updatedAt: new Date().toISOString(),
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/approve-brief'), { method: 'POST' }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body).toMatchObject({ ok: true, status: 'spec_review' })

    const raw = await fs.readFile(taskQueuePath(), 'utf8')
    const q = JSON.parse(raw)
    expect(q.tasks[0].status).toBe('spec_review')
    expect(q.tasks[0].spec).toContain('Approved user job')
    expect(q.tasks[0].acceptanceCriteria).toHaveLength(3)
    expect(q.tasks[0].escalations[0].resolvedBy).toBe('system')
    expect(activeEscalations(q.tasks[0] as any)).toEqual([])
    const effective = await readEffectiveTask('task-1')
    expect(effective.runtime?.openEscalationIds).toEqual([])
  })

  it('rejects approve-brief when no brief is drafted', async () => {
    await seedTask('task-1', { status: 'exploring' })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/approve-brief'), { method: 'POST' }),
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, any>
    expect(body.error).toMatch(/no product brief/i)
  })

  it('rejects approve-brief on an incomplete brief (missing successMetric)', async () => {
    await seedTask('task-1', {
      status: 'exploring',
      productBrief: {
        userJob: 'a job',
        successMetric: '',
        antiPatterns: [],
        authoredBy: 'agent:spec-agent',
      },
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/approve-brief'), { method: 'POST' }),
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, any>
    expect(body.error).toMatch(/incomplete/i)
  })
})

describe('POST /api/project/task/:id/add-acceptance', () => {
  it('appends a human-written acceptance criterion and records a note', async () => {
    await seedTask('task-1', {
      status: 'exploring',
      acceptanceCriteria: [],
      notes: [],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/add-acceptance'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ description: 'Round-trip tests preserve comments and formatting.' }),
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.ok).toBe(true)
    expect(body.count).toBe(1)

    const raw = await fs.readFile(taskQueuePath(), 'utf8')
    const q = JSON.parse(raw)
    expect(q.tasks[0].acceptanceCriteria).toEqual([
      {
        id: 'ac-1',
        description: 'Round-trip tests preserve comments and formatting.',
        verifiedBy: 'review',
        met: false,
      },
    ])
    expect(q.tasks[0].notes[0].agentId).toBe('human')
    expect(q.tasks[0].notes[0].content).toContain('Round-trip tests preserve')
  })

  it('rejects an empty acceptance criterion', async () => {
    await seedTask('task-1', { status: 'exploring', acceptanceCriteria: [] })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/add-acceptance'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ description: '   ' }),
      }),
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, any>
    expect(body.error).toMatch(/description required/i)
  })
})

describe('POST /api/project/task/:id/stage-answer', () => {
  it('stages a draft answer on current-shape task questions', async () => {
    await seedTask('task-1', {
      status: 'spec_review',
      openQuestions: [
        {
          kind: 'choice',
          id: 'q-1',
          askedBy: 'spec-agent',
          askedAt: new Date().toISOString(),
          prompt: 'Pick one',
          choices: ['A', 'B'],
          selectionMode: 'single',
        },
      ],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/stage-answer'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ questionId: 'q-1', answer: 'A' }),
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body).toEqual({ ok: true, staged: true })
    const q = await readTaskQueue()
    expect(q.tasks[0].openQuestions[0].draftAnswer).toBe('A')
  })

  it('answers current-shape task questions and clears the draft answer', async () => {
    await seedTask('task-1', {
      status: 'exploring',
      openQuestions: [
        {
          kind: 'choice',
          id: 'q-1',
          askedBy: 'spec-agent',
          askedAt: new Date().toISOString(),
          prompt: 'Pick one',
          choices: ['A', 'B'],
          selectionMode: 'single',
          draftAnswer: 'A',
        },
      ],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/answer-questions'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ answers: [{ questionId: 'q-1', answer: 'A' }] }),
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body).toEqual({ ok: true, count: 1 })
    const transcript = (await readExploringTranscript({ memoryDir, taskId: 'task-1' })).content ?? ''
    expect(transcript).toContain('Answer to "q-1": A')
  })

  it('answers the linked owner-input request when a migrated task question is submitted', async () => {
    await seedTask('task-1', {
      status: 'exploring',
      openQuestions: [
        {
          kind: 'choice',
          id: 'q-1',
          askedBy: 'spec-agent',
          askedAt: new Date().toISOString(),
          prompt: 'Pick one',
          choices: ['A', 'B'],
          selectionMode: 'single',
          draftAnswer: 'A',
        },
      ],
    })
    const ownerInput = await createOwnerInputRequest({
      projectRoot: tmpDir,
      projectId,
      commandId: 'test:task-q-1',
      now: '2026-06-03T12:00:00.000Z',
      actor: 'test',
      source: { kind: 'task', taskId: 'task-1', questionId: 'q-1' },
      target: { kind: 'thread' },
      objective: {
        kind: 'task_shaping',
        label: 'Clarify Seeded task for tests',
        successCriteria: ['Owner answers the linked bounded-chat session.'],
      },
      question: {
        kind: 'choice',
        prompt: 'Pick one',
        choices: ['A', 'B'],
        selectionMode: 'single',
      },
    })
    const { app } = buildServeApp({ projectPath: tmpDir })

    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/answer-questions'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ answers: [{ questionId: 'q-1', answer: 'A' }] }),
      }),
    )

    expect(res.status).toBe(200)
    const requests = await listOwnerInputRequests(tmpDir)
    expect(requests[0]).toMatchObject({
      id: ownerInput.request.id,
      status: 'coordinator_review',
      boundedChatSessionId: ownerInput.session.id,
    })
    const session = await loadBoundedChatSession({ memoryDir, sessionId: ownerInput.session.id })
    expect(session.status).toBe('coordinator_review')
    expect(session.subObjectives[0]?.localTurns.at(-1)?.content).toBe('A')
  })
})

describe('POST /api/project/task/:id/unshelve', () => {
  it('clears shelveReason and returns a shelved task to proposed', async () => {
    await seedTask('task-1', {
      status: 'shelved',
      shelveReason: {
        code: 'not_viable',
        detail: 'was shelved by a worker',
        rejectedBy: 'agent:worker-1',
        rejectedAt: new Date().toISOString(),
        source: 'worker_pre_rejection',
        policyApplied: true,
        requeueCount: 0,
      },
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/unshelve'), { method: 'POST' }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.ok).toBe(true)
    expect(body.status).toBe('proposed')

    const raw = await fs.readFile(taskQueuePath(), 'utf8')
    const q = JSON.parse(raw)
    expect(q.tasks[0].status).toBe('proposed')
    expect(q.tasks[0].shelveReason).toBeUndefined()
    expect(q.tasks[0].notes?.at(-1)?.content).toMatch(/unshelved/i)
  })

  it('rejects unshelve on a non-shelved task', async () => {
    await seedTask('task-1', { status: 'in_progress' })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/unshelve'), { method: 'POST' }),
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, any>
    expect(body.error).toMatch(/not shelved/i)
  })
})

describe('POST /api/project/task/:id/resolve-escalation', () => {
  it('resolves an open escalation and unblocks the task', async () => {
    await seedRawTaskDefinition('task-1', {
      status: 'blocked',
      blockReason: 'Escalation raised',
      escalations: [
        {
          id: 'esc-1',
          taskId: 'task-1',
          reason: 'scope_boundary',
          summary: 'Unclear if this should touch the auth layer',
          details: 'The proposed change crosses into the auth package',
          agentId: 'agent:worker-1',
          raisedAt: new Date().toISOString(),
        },
      ],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/resolve-escalation'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          escalationId: 'esc-1',
          resolution: 'Proceed — auth layer is in scope',
          nextStatus: 'in_progress',
        }),
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.ok).toBe(true)

    const task = await readEffectiveTask('task-1')
    expect(task.status).toBe('in_progress')
    expect(task.assignedTo).toBe('worker-agent')
    expect(task.escalations[0].resolvedAt).toBeTruthy()
    expect(task.escalations[0].resolution).toMatch(/Proceed/)
    expect(task.blockReason).toBeUndefined()
  })

  it('requires both escalationId and resolution', async () => {
    await seedTask('task-1', { status: 'blocked' })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const resNoId = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/resolve-escalation'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ resolution: 'fine' }),
      }),
    )
    expect(resNoId.status).toBe(400)

    const resNoReason = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/resolve-escalation'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ escalationId: 'esc-1' }),
      }),
    )
    expect(resNoReason.status).toBe(400)
  })
})

describe('GET /api/project/activity', () => {
  it('summarizes counts and in-flight tasks', async () => {
    const now = new Date().toISOString()
    const queue = {
      version: 1,
      lastUpdated: now,
      tasks: [
        { id: 't1', title: 'One', description: '', domain: 'd', projectPath: tmpDir, status: 'in_progress', priority: 'normal', revisionCount: 0, remediationAttempts: 0, origination: 'human', createdAt: now, updatedAt: now },
        { id: 't2', title: 'Two', description: '', domain: 'd', projectPath: tmpDir, status: 'review', priority: 'normal', revisionCount: 0, remediationAttempts: 0, origination: 'human', createdAt: now, updatedAt: now },
        { id: 't3', title: 'Done one', description: '', domain: 'd', projectPath: tmpDir, status: 'done', priority: 'normal', revisionCount: 0, remediationAttempts: 0, origination: 'human', createdAt: now, updatedAt: now },
      ],
    }
    await writeTaskQueue(queue)

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/activity')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.counts.in_progress).toBe(1)
    expect(body.counts.review).toBe(1)
    expect(body.counts.done).toBe(1)
    expect(body.inFlight).toHaveLength(2)
    expect(body.inFlight.map((t: any) => t.id).sort()).toEqual(['t1', 't2'])
  })

  it('reuses the shared action model so blocked work still has a visible next action', async () => {
    const now = new Date().toISOString()
    const queue = {
      version: 1,
      lastUpdated: now,
      tasks: [
        {
          id: 'blocked-task',
          title: 'Select and prove DeepInfra drafting model',
          description: '',
          domain: 'd',
          projectPath: tmpDir,
          status: 'blocked',
          blockReason: 'human_judgment_required: Confirm which provider policy applies before continuing.',
          priority: 'normal',
          revisionCount: 0,
          remediationAttempts: 0,
          origination: 'human',
          createdAt: now,
          updatedAt: now,
        },
        {
          id: 'ready-task',
          title: 'Implement dialogue reviewer lane',
          description: '',
          domain: 'd',
          projectPath: tmpDir,
          status: 'ready',
          priority: 'normal',
          revisionCount: 0,
          remediationAttempts: 0,
          origination: 'human',
          createdAt: now,
          updatedAt: now,
          spec: [
            '## Summary',
            'Implement the lane.',
            '',
            '## Acceptance Criteria',
            '1. Lane exists.',
          ].join('\n'),
          acceptanceCriteria: [
            { id: 'ac-1', description: 'Lane exists.', verifiedBy: 'review', met: false },
          ],
        },
      ],
    }
    await writeTaskQueue(queue)

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/activity')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.counts.blocked).toBe(1)
    expect(body.counts.ready).toBe(1)
    expect(body.topAction).toMatchObject({
      source: 'task',
      label: 'Select and prove DeepInfra drafting model',
      buttonLabel: 'Open Work',
      href: '/work?task=blocked-task',
      tone: 'warn',
      taskId: 'blocked-task',
    })
    expect(body.actionModel.primaryAction).toEqual(body.topAction)
    expect(body.summary).toMatchObject({
      label: 'Select and prove DeepInfra drafting model',
      actionHref: '/work?task=blocked-task',
      actionLabel: 'Open Work',
      tone: 'warn',
      taskId: 'blocked-task',
    })
  })

  it('includes the latest live event metadata for in-flight tasks', async () => {
    const older = '2026-05-23T18:00:00.000Z'
    const now = '2026-05-23T18:01:00.000Z'
    const queue = {
      version: 1,
      lastUpdated: now,
      tasks: [
        { id: 't1', title: 'Long worker loop', description: '', domain: 'd', projectPath: tmpDir, status: 'in_progress', priority: 'normal', revisionCount: 0, remediationAttempts: 0, origination: 'human', createdAt: older, updatedAt: older },
      ],
    }
    await writeTaskQueue(queue)
    const recentEventsPath = getProjectRecentEventsPath(tmpDir)
    await fs.mkdir(path.dirname(recentEventsPath), { recursive: true })
    await fs.writeFile(
      recentEventsPath,
      [
        JSON.stringify({
          at: older,
          workspaceId: projectId,
          event: {
            type: 'tool_execution_started',
            task_id: 't1',
            tool_name: 'command',
            tool_input: { cmd: 'pnpm test' },
          },
        }),
        JSON.stringify({
          at: now,
          workspaceId: projectId,
          event: {
            type: 'tool_execution_completed',
            task_id: 't1',
            tool_name: 'command',
            output: 'command failed',
            is_error: true,
          },
        }),
      ].join('\n') + '\n',
      'utf8',
    )

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/activity')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.inFlight[0]).toMatchObject({
      id: 't1',
      status: 'in_progress',
      lastActivityLabel: 'Failed command',
      lastActivityTone: 'danger',
    })
    expect(body.inFlight[0].lastActivityAt).toBe(now)
  })

  it('repairs phantom worker claims when the project run is stopped', async () => {
    const now = new Date().toISOString()
    const staleClaimAt = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    await writeRawTaskQueue({
      version: 1,
      lastUpdated: now,
      tasks: [
        {
          id: 't1',
          title: 'Claimed then stopped',
          description: '',
          domain: 'd',
          projectPath: tmpDir,
          status: 'in_progress',
          assignedTo: 'worker-agent',
          priority: 'normal',
          revisionCount: 0,
          remediationAttempts: 0,
          origination: 'human',
          createdAt: now,
          updatedAt: now,
          spec: [
            '## Summary',
            'Do the thing.',
            '',
            '## Acceptance Criteria',
            '1. Works.',
            '',
            '## Completion Boundary',
            '- Product outcome: Works.',
            '- What Guildhall can complete in code: Update local files.',
            '- External dependencies: None.',
            '- Owner-only setup: None.',
            '- Verification environment: Local checkout.',
            '- What counts as done: Verified.',
            '- What must be split or blocked: None.',
          ].join('\n'),
          acceptanceCriteria: [
            { id: 'ac-1', description: 'Works.', verifiedBy: 'review', met: false },
          ],
          escalations: [
            {
              id: 'esc-t1-1',
              taskId: 't1',
              agentId: 'spec-agent',
              reason: 'human_judgment_required',
              summary: 'Spec author stopped after hitting its turn limit.',
              raisedAt: '2026-05-31T00:57:20.368Z',
            },
          ],
          notes: [
            {
              agentId: 'task-claimer',
              role: 'orchestrator',
              content: 'Claimed ready task for worker-agent.',
              timestamp: staleClaimAt,
            },
          ],
        },
      ],
    })
    await upsertTaskRuntimeState(tmpDir, 't1', {
      assignedTo: 'worker-agent',
      openEscalationIds: ['esc-t1-1'],
      updatedAt: now,
    })

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/activity')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.counts.ready).toBe(1)
    expect(body.counts.in_progress).toBeUndefined()
    expect(body.inFlight).toEqual([])

    const queue = await readTaskQueue()
    expect(queue.tasks[0]).toMatchObject({
      status: 'ready',
      assignedTo: null,
    })
    expect(queue.tasks[0].escalations[0].resolvedBy).toBe('system')
    const effective = await readEffectiveTask('t1')
    expect(effective.runtime?.openEscalationIds).toEqual([])
  })

  it('does not repair fresh worker claims while external CLI work may still be active', async () => {
    const now = new Date().toISOString()
    await writeRawTaskQueue({
      version: 1,
      lastUpdated: now,
      tasks: [
        {
          id: 't1',
          title: 'Fresh active claim',
          description: '',
          domain: 'd',
          projectPath: tmpDir,
          status: 'in_progress',
          assignedTo: 'worker-agent',
          priority: 'normal',
          revisionCount: 0,
          remediationAttempts: 0,
          origination: 'human',
          createdAt: now,
          updatedAt: now,
          spec: [
            '## Summary',
            'Do the thing.',
            '',
            '## Acceptance Criteria',
            '1. Works.',
            '',
            '## Completion Boundary',
            '- Product outcome: Works.',
            '- What Guildhall can complete in code: Update local files.',
            '- External dependencies: None.',
            '- Owner-only setup: None.',
            '- Verification environment: Local checkout.',
            '- What counts as done: Verified.',
            '- What must be split or blocked: None.',
          ].join('\n'),
          acceptanceCriteria: [
            { id: 'ac-1', description: 'Works.', verifiedBy: 'review', met: false },
          ],
          notes: [
            {
              agentId: 'task-claimer',
              role: 'orchestrator',
              content: 'Claimed ready task for worker-agent.',
              timestamp: now,
            },
          ],
        },
      ],
    })
    await upsertTaskRuntimeState(tmpDir, 't1', {
      assignedTo: 'worker-agent',
      openEscalationIds: [],
      updatedAt: now,
    })

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/activity')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.counts.in_progress).toBe(1)
    expect(body.inFlight[0]).toMatchObject({
      id: 't1',
      status: 'in_progress',
    })

    const queue = await readTaskQueue()
    expect(queue.tasks[0]).toMatchObject({
      status: 'in_progress',
      assignedTo: 'worker-agent',
    })
  })

  it('repairs legacy no-checkpoint provider recovery playbooks on stopped runs', async () => {
    const now = new Date().toISOString()
    await writeRawTaskQueue({
      version: 1,
      lastUpdated: now,
      tasks: [
        {
          id: 't1',
          title: 'Select and prove DeepInfra drafting model',
          description: '',
          domain: 'product',
          projectPath: tmpDir,
          status: 'in_progress',
          assignedTo: 'worker-agent',
          priority: 'normal',
          revisionCount: 0,
          remediationAttempts: 0,
          origination: 'human',
          createdAt: now,
          updatedAt: now,
          spec: '## Summary\nSelect and prove a DeepInfra-accessible drafting model across genres.',
          acceptanceCriteria: [
            { id: 'ac-1', description: 'DeepInfra drafting model is selected and proven.', verifiedBy: 'review', met: false },
          ],
          notes: [
            {
              agentId: 'coordinator',
              role: 'policy-classification',
              timestamp: now,
              content: JSON.stringify({
                class: 'provider_unavailable',
                confidence: 'medium',
                scope: 'task',
                needsHuman: false,
                safePlaybooks: ['resume_from_checkpoint'],
                evidence: [{ kind: 'task', summary: 'Worker timed out before producing visible progress.' }],
              }),
            },
            {
              agentId: 'coordinator',
              role: 'recovery-playbook',
              timestamp: now,
              content: JSON.stringify({
                status: 'started',
                playbook: 'resume_from_checkpoint',
                reason: 'Resume from the durable checkpoint instead of rediscovering context.',
                allowedTools: ['read-file', 'edit-file', 'run-shell-command', 'write-checkpoint', 'raise-escalation'],
                allowedPaths: [],
                maxTurns: 2,
                successSignals: ['checkpoint_next_action_completed'],
                stopSignals: ['same_playbook_failed', 'checkpoint_invalid'],
                summary: 'Guildhall reopened a stale no-output worker timeout as provider/runtime recovery.',
              }),
            },
          ],
        },
      ],
    })

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/activity')))
    expect(res.status).toBe(200)

    const queue = await readTaskQueue()
    const task = await buildEffectiveTask(tmpDir, queue.tasks[0] as any) as Record<string, any>
    expect(task.status).toBe('in_progress')
    expect(task.assignedTo).toBe('worker-agent')
    expect(task.notes.findLast((note: Record<string, unknown>) => note.role === 'policy-classification')?.content)
      .toContain('"safePlaybooks":["retry_current_task_context"]')
    expect(task.notes.findLast((note: Record<string, unknown>) => note.role === 'recovery-playbook')?.content)
      .toContain('"playbook":"retry_current_task_context"')
    expect(task.notes.findLast((note: Record<string, unknown>) => note.role === 'provider-recovery')?.content)
      .toContain('current task context')
  })

  it('repairs legacy no-checkpoint recovery as partial progress when the task worktree is dirty', async () => {
    const now = new Date().toISOString()
    const worktreePath = path.join(tmpDir, '.guildhall', 'worktrees', 'dirty-provider-recovery')
    await fs.mkdir(path.join(worktreePath, 'docs', 'product'), { recursive: true })
    execFileSync('git', ['init'], { cwd: worktreePath, stdio: 'ignore' })
    await fs.writeFile(
      path.join(worktreePath, 'docs', 'product', 'deepinfra-drafting-model-selection.md'),
      '# DeepInfra Drafting Model Selection\n\nPartial output.\n',
      'utf8',
    )
    await writeRawTaskQueue({
      version: 1,
      lastUpdated: now,
      tasks: [
        {
          id: 't1',
          title: 'Select and prove DeepInfra drafting model',
          description: '',
          domain: 'product',
          projectPath: tmpDir,
          worktreePath,
          status: 'in_progress',
          assignedTo: 'worker-agent',
          priority: 'normal',
          revisionCount: 0,
          remediationAttempts: 0,
          origination: 'human',
          createdAt: now,
          updatedAt: now,
          spec: '## Summary\nSelect and prove a DeepInfra-accessible drafting model across genres.',
          acceptanceCriteria: [
            { id: 'ac-1', description: 'DeepInfra drafting model is selected and proven.', verifiedBy: 'review', met: false },
          ],
          notes: [
            {
              agentId: 'coordinator',
              role: 'policy-classification',
              timestamp: now,
              content: JSON.stringify({
                class: 'provider_unavailable',
                confidence: 'medium',
                scope: 'task',
                needsHuman: false,
                safePlaybooks: ['resume_from_checkpoint'],
                evidence: [{ kind: 'task', summary: 'Worker timed out before producing visible progress.' }],
              }),
            },
            {
              agentId: 'coordinator',
              role: 'recovery-playbook',
              timestamp: now,
              content: JSON.stringify({
                status: 'started',
                playbook: 'resume_from_checkpoint',
                reason: 'Resume from the durable checkpoint instead of rediscovering context.',
                allowedTools: ['read-file', 'edit-file', 'run-shell-command', 'write-checkpoint', 'raise-escalation'],
                allowedPaths: [],
                maxTurns: 2,
                successSignals: ['checkpoint_next_action_completed'],
                stopSignals: ['same_playbook_failed', 'checkpoint_invalid'],
                summary: 'Guildhall reopened a stale no-output worker timeout as provider/runtime recovery.',
              }),
            },
          ],
        },
      ],
    })

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/activity')))
    expect(res.status).toBe(200)

    const queue = await readTaskQueue()
    const task = await buildEffectiveTask(tmpDir, queue.tasks[0] as any) as Record<string, any>
    expect(task.status).toBe('in_progress')
    expect(task.assignedTo).toBe('worker-agent')
    expect(task.notes.findLast((note: Record<string, unknown>) => note.role === 'policy-classification')?.content)
      .toContain('"class":"model_tool_use_failure"')
    expect(task.notes.findLast((note: Record<string, unknown>) => note.role === 'recovery-playbook')?.content)
      .toContain('"playbook":"retry_current_task_context"')
    expect(task.notes.findLast((note: Record<string, unknown>) => note.role === 'recovery')?.content)
      .toContain('partial worker output')
  })

  it('repairs stale provider no-progress projection after the playbook was already corrected', async () => {
    const now = new Date().toISOString()
    const worktreePath = path.join(tmpDir, '.guildhall', 'worktrees', 'dirty-corrected-playbook')
    await fs.mkdir(path.join(worktreePath, 'docs', 'product'), { recursive: true })
    execFileSync('git', ['init'], { cwd: worktreePath, stdio: 'ignore' })
    await fs.writeFile(
      path.join(worktreePath, 'docs', 'product', 'deepinfra-drafting-model-selection.md'),
      '# DeepInfra Drafting Model Selection\n\nPartial output.\n',
      'utf8',
    )
    await writeRawTaskQueue({
      version: 1,
      lastUpdated: now,
      tasks: [
        {
          id: 't1',
          title: 'Select and prove DeepInfra drafting model',
          description: '',
          domain: 'product',
          projectPath: tmpDir,
          worktreePath,
          status: 'in_progress',
          assignedTo: 'worker-agent',
          priority: 'normal',
          revisionCount: 0,
          remediationAttempts: 0,
          origination: 'human',
          createdAt: now,
          updatedAt: now,
          spec: '## Summary\nSelect and prove a DeepInfra-accessible drafting model across genres.',
          acceptanceCriteria: [
            { id: 'ac-1', description: 'DeepInfra drafting model is selected and proven.', verifiedBy: 'review', met: false },
          ],
          notes: [
            {
              agentId: 'coordinator',
              role: 'policy-classification',
              timestamp: now,
              content: JSON.stringify({
                class: 'provider_unavailable',
                confidence: 'medium',
                scope: 'task',
                needsHuman: false,
                safePlaybooks: ['retry_current_task_context'],
                evidence: [{ kind: 'task', summary: 'Worker timed out before producing visible progress.' }],
                summary: 'The model provider is unavailable, so Guildhall should preserve state and retry or switch lanes.',
              }),
            },
            {
              agentId: 'coordinator',
              role: 'recovery-playbook',
              timestamp: now,
              content: JSON.stringify({
                status: 'started',
                playbook: 'retry_current_task_context',
                reason: 'Retry from the current task brief/spec because no durable checkpoint exists yet.',
                allowedTools: ['read-file', 'edit-file', 'write-checkpoint', 'raise-escalation'],
                allowedPaths: [],
                maxTurns: 1,
                successSignals: ['visible_progress_or_checkpoint_written'],
                stopSignals: ['same_playbook_failed', 'no_visible_progress_after_retry'],
                summary: 'Worker timed out without visible progress after a retry. Guildhall kept this in provider recovery.',
              }),
            },
            {
              agentId: 'coordinator',
              role: 'provider-recovery',
              timestamp: now,
              content:
                'Guildhall corrected legacy no-checkpoint provider recovery. The task stays in automation so Guildhall can retry from the current task context.',
            },
          ],
        },
      ],
    })

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/activity')))
    expect(res.status).toBe(200)

    const queue = await readTaskQueue()
    const task = await buildEffectiveTask(tmpDir, queue.tasks[0] as any) as Record<string, any>
    expect(task.notes.findLast((note: Record<string, unknown>) => note.role === 'policy-classification')?.content)
      .toContain('"class":"model_tool_use_failure"')
    expect(task.notes.findLast((note: Record<string, unknown>) => note.role === 'recovery')?.content)
      .toContain('partial worker output')
  })

  it('returns empty summary when no tasks file exists yet', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/activity')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.inFlight).toEqual([])
  })
})
