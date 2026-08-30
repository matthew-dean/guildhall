import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { statSync } from 'node:fs'
import { bootstrapWorkspace, registerWorkspace, setProvider, updateGlobalConfig, updateProjectConfig, writeWorkspaceConfig } from '@guildhall/config'
import {
  appendTaskEvidence,
  getProjectContextDebugLedgerPath,
  getProjectRecentEventsPath,
  getProjectStateDir,
  getProjectSystemStatePath,
  getProjectTranscriptPath,
  projectStateDatabasePath,
  readProjectStateDatabaseCurrentThread,
  readProjectStateDatabaseQueueDefinition,
  readProjectStateDatabaseTaskPointWithRevision,
  readTaskEvidence,
  readTaskRuntimeStore,
  readTaskWorkspaceStore,
  subscribeProjectSummaryInvalidations,
  updateProjectStateDatabaseSummaryAndCurrentState,
  upsertTaskRuntimeState,
  upsertTaskWorkspaceState,
} from '@guildhall/sessions'
import { activeEscalations, raiseEscalation, readExploringTranscript, writeCheckpoint } from '@guildhall/tools'
import { buildServeApp, filterEventsForTask } from '../serve.js'
import { refreshProjectDeliveryReadProjection } from '../delivery-read-projection.js'
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
import {
  sanitizeTaskQueueForProjectWrite,
  writePromotedTaskDetailMutation,
  writeProjectTaskQueueWithSummary,
} from '../project-state-boundary.js'
import { writeProjectSummaryProjectionFromUnknownQueue } from '../project-summary-projection.js'
import { buildEffectiveTask } from '../effective-task.js'
import { applyProjectMigrations, getProjectMigrationStatus } from '../migrations.js'
import { StructuredSpec, TaskEvidenceEvent } from '@guildhall/core'

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
  if (url.pathname === '/api/project' && !url.searchParams.has('compact') && !url.searchParams.has('detail')) {
    url.searchParams.set('detail', 'true')
  }
  return url.toString()
}

function taskQueuePath(): string {
  return getProjectSystemStatePath(tmpDir, 'TASKS.json')
}

function structuredSpecForTest(
  title: string,
  boundary: Partial<StructuredSpec['completionBoundary']> = {},
): StructuredSpec {
  return StructuredSpec.parse({
    whatThisIs: title,
    problemContext: 'The test needs an explicit structured planning contract.',
    goals: [`Implement ${title}.`],
    nonGoals: ['No unrelated work.'],
    proposedDesign: `Use the project surface named by ${title}.`,
    keyDecisions: ['Keep the test contract explicit.'],
    acceptanceCriteria: [{
      scenario: `Given ${title} is implemented`,
      expectation: 'Then the recorded task boundary is ready for review.',
      verificationMode: 'review',
    }],
    verification: ['Run the focused test.'],
    completionBoundary: {
      productOutcome: `${title} is ready for review.`,
      whatGuildhallCanCompleteInCode: `Implement ${title}.`,
      externalDependencies: 'None.',
      ownerOnlySetup: 'None.',
      verificationEnvironment: 'The local test process.',
      whatCountsAsDone: 'The focused test passes.',
      whatMustBeSplitOrBlocked: 'Nothing.',
      splitPolicy: 'none',
      ...boundary,
    },
  })
}

async function readTaskQueue(): Promise<Record<string, any>> {
  const queue = readProjectStateDatabaseQueueDefinition(taskQueuePath())
  if (!queue) throw new Error('Missing canonical SQLite task queue')
  const tasks = await Promise.all(queue.tasks.map(task => buildEffectiveTask(tmpDir, task as any)))
  return { ...queue, tasks } as Record<string, any>
}

type TaskFixture = {
  definition: Record<string, any>
  runtime?: Record<string, any>
  workspace?: Record<string, any>
  evidence?: Array<TaskEvidenceEvent>
}

function findLastMatching<T>(items: readonly T[], predicate: (item: T) => boolean): T | undefined {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item !== undefined && predicate(item)) return item
  }
  return undefined
}

const runtimeFixtureFields = [
  'assignedTo',
  'revisionCount',
  'retryWindow',
  'proofRecovery',
  'remediationAttempts',
  'handoffStep',
] as const
const workspaceFixtureFields = ['worktreePath', 'branchName', 'baseBranch'] as const

function hasOwn(value: Record<string, any>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function fixtureEvent(
  taskId: string,
  kind: TaskEvidenceEvent['kind'],
  value: Record<string, any>,
  index: number,
  recordedAt: string,
): TaskEvidenceEvent {
  return TaskEvidenceEvent.parse({
    id: String(value.id ?? `${taskId}-${kind}-${index + 1}`),
    taskId,
    kind,
    recordedAt,
    payload: value,
  })
}

function normalizeTaskFixture(task: Record<string, any>, now: string): TaskFixture {
  const taskId = String(task.id ?? task.definition?.id ?? '')
  const definition = {
    ...task,
    ...(task.definition ?? {}),
  }
  delete definition.definition
  delete definition.runtime
  delete definition.workspace
  delete definition.evidence

  const runtime: Record<string, any> = { ...(task.runtime ?? {}) }
  const workspace: Record<string, any> = { ...(task.workspace ?? {}) }
  const evidenceKinds = new Set(['event', 'note', 'gate_result', 'review_verdict', 'adjudication', 'escalation', 'agent_issue', 'merge_record', 'git_story', 'completion_summary'])
  const evidence: Array<TaskEvidenceEvent> = (task.evidence ?? [])
    .filter((event: Record<string, any>) => evidenceKinds.has(String(event.kind)))
    .map((event: Record<string, any>, index: number) => TaskEvidenceEvent.parse({
      ...event,
      id: event.id ?? `${taskId}-event-${index + 1}`,
      taskId: event.taskId ?? taskId,
      recordedAt: event.recordedAt ?? now,
      payload: event.payload ?? {},
    }))

  for (const field of runtimeFixtureFields) {
    if (!hasOwn(definition, field)) continue
    runtime[field] = definition[field]
    delete definition[field]
  }
  for (const field of workspaceFixtureFields) {
    if (!hasOwn(definition, field)) continue
    workspace[field] = definition[field]
    delete definition[field]
  }

  const evidenceCollections: Array<{ field: string; kind: string; timestamp: (value: Record<string, any>) => string | undefined }> = [
    { field: 'notes', kind: 'note', timestamp: value => value.timestamp },
    { field: 'gateResults', kind: 'gate_result', timestamp: value => value.checkedAt },
    { field: 'reviewVerdicts', kind: 'review_verdict', timestamp: value => value.recordedAt },
    { field: 'adjudications', kind: 'adjudication', timestamp: value => value.decidedAt },
    { field: 'escalations', kind: 'escalation', timestamp: value => value.raisedAt },
    { field: 'agentIssues', kind: 'agent_issue', timestamp: value => value.raisedAt },
  ]
  for (const collection of evidenceCollections) {
    const values = definition[collection.field]
    if (!Array.isArray(values)) continue
    values.forEach((value: Record<string, any>, index: number) => {
      evidence.push(fixtureEvent(
        taskId,
        collection.kind as TaskEvidenceEvent['kind'],
        value,
        index,
        collection.timestamp(value) ?? now,
      ))
    })
    delete definition[collection.field]
  }
  if (hasOwn(definition, 'mergeRecord')) {
    const value = definition.mergeRecord as Record<string, any>
    evidence.push(fixtureEvent(taskId, 'merge_record', value, 0, value.mergedAt ?? now))
    delete definition.mergeRecord
  }
  if (hasOwn(definition, 'doneSummaryBundle')) {
    const value = definition.doneSummaryBundle as Record<string, any>
    evidence.push(fixtureEvent(taskId, 'completion_summary', value, 0, value.createdAt ?? now))
    delete definition.doneSummaryBundle
  }

  if (Array.isArray(runtime.openEscalationIds) === false && Array.isArray(task.escalations)) {
    runtime.openEscalationIds = task.escalations
      .filter((value: Record<string, any>) => !value.resolvedAt)
      .map((value: Record<string, any>) => String(value.id))
  }
  if (Array.isArray(runtime.openIssueIds) === false && Array.isArray(task.agentIssues)) {
    runtime.openIssueIds = task.agentIssues
      .filter((value: Record<string, any>) => !value.resolvedAt)
      .map((value: Record<string, any>) => String(value.id))
  }
  if (Object.keys(runtime).length > 0) runtime.updatedAt ??= definition.updatedAt ?? now
  if (Object.keys(workspace).length > 0) workspace.updatedAt ??= definition.updatedAt ?? now

  return {
    definition,
    ...(Object.keys(runtime).length > 0 ? { runtime } : {}),
    ...(Object.keys(workspace).length > 0 ? { workspace } : {}),
    ...(evidence.length > 0 ? { evidence } : {}),
  }
}

async function refreshCanonicalSummary(): Promise<void> {
  const queue = readProjectStateDatabaseQueueDefinition(taskQueuePath())
  if (!queue) throw new Error('Missing canonical SQLite task queue')
  const projectionTasks = await Promise.all(queue.tasks.map(task => buildEffectiveTask(tmpDir, task as any)))
  writeProjectSummaryProjectionFromUnknownQueue(taskQueuePath(), {
    projectId,
    projectRoot: tmpDir,
    queue: queue as any,
    projectionTasks: projectionTasks as any,
    queueCommit: false,
  })
}

async function applyCanonicalMigrations(): Promise<void> {
  const promotion = await applyProjectMigrations({
    projectRoot: tmpDir,
    only: ['0.12.21/task-overlay-authority'],
    appVersion: 'serve-task-endpoints-test',
  })
  if (promotion.failed.length > 0) {
    throw new Error(promotion.failed.map(item => `${item.id}: ${item.error}`).join('; '))
  }
  await refreshCanonicalSummary()
  for (;;) {
    const prerequisites = await applyProjectMigrations({
      projectRoot: tmpDir,
      includePrompt: true,
      appVersion: 'serve-task-endpoints-test',
    })
    if (prerequisites.failed.length > 0) {
      throw new Error(prerequisites.failed.map(item => `${item.id}: ${item.error}`).join('; '))
    }
    const status = await getProjectMigrationStatus({ projectRoot: tmpDir })
    const automatic = status.blocked
      .filter(item => item.safety !== 'manual' && (
        item.safety === 'required' || item.requirement === 'required'
      ))
    automatic.sort((left, right) => left.id.localeCompare(right.id, undefined, { numeric: true }))
    if (automatic.length === 0) return

    const result = await applyProjectMigrations({
      projectRoot: tmpDir,
      only: [automatic[0]!.id],
      appVersion: 'serve-task-endpoints-test',
    })
    if (result.failed.length > 0) {
      throw new Error(result.failed.map(item => `${item.id}: ${item.error}`).join('; '))
    }
    if (result.applied.length === 0) {
      throw new Error(`Automatic migrations made no progress: ${automatic.map(item => item.id).join(', ')}`)
    }
  }
}

async function seedCanonicalQueue(queue: Record<string, any>): Promise<void> {
  const now = typeof queue.lastUpdated === 'string' ? queue.lastUpdated : new Date().toISOString()
  const fixtures = (Array.isArray(queue.tasks) ? queue.tasks : [])
    .map(task => normalizeTaskFixture(task, now))
  const definitionQueue = {
    ...queue,
    tasks: fixtures.map(fixture => fixture.definition),
  }
  const normalizedQueue = sanitizeTaskQueueForProjectWrite(definitionQueue).queue
  writeProjectTaskQueueWithSummary(taskQueuePath(), normalizedQueue as any, {
    projectId,
    projectRoot: tmpDir,
    taskDefinitionsAlreadySanitized: true,
  })
  await applyCanonicalMigrations()
  for (const [index, fixture] of fixtures.entries()) {
    const taskId = String(fixture.definition.id ?? '')
    if (fixture.runtime) await upsertTaskRuntimeState(tmpDir, taskId, fixture.runtime)
    if (fixture.workspace) await upsertTaskWorkspaceState(tmpDir, taskId, fixture.workspace)
    for (const event of fixture.evidence ?? []) {
      await appendTaskEvidence(tmpDir, taskId, event)
    }
    if (!taskId) throw new Error(`Missing seeded task id at index ${index}`)
  }
  await refreshCanonicalSummary()
  await applyCanonicalMigrations()
  await refreshCanonicalSummary()
}

async function readEffectiveTask(id: string): Promise<Record<string, any>> {
  const queue = await readTaskQueue()
  const task = queue.tasks.find((entry: Record<string, any>) => entry.id === id)
  if (!task) throw new Error(`Missing seeded task ${id}`)
  return await buildEffectiveTask(tmpDir, task as any) as Record<string, any>
}

async function seedTask(id: string, overrides: Record<string, any> = {}): Promise<void> {
  const seededTask: Record<string, any> = {
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
  }
  if (typeof seededTask.spec === 'string' && seededTask.spec.trim() && !hasOwn(overrides, 'structuredSpec')) {
    seededTask.structuredSpec = structuredSpecForTest(seededTask.title)
  }
  const queue = {
    version: 1,
    lastUpdated: new Date().toISOString(),
    tasks: [
      seededTask,
    ],
  }
  await seedCanonicalQueue(queue)
}

async function seedTasks(tasks: Array<Record<string, any>>): Promise<void> {
  const now = new Date().toISOString()
  const queue = {
    version: 1,
    lastUpdated: now,
    tasks: tasks.map((task, index) => {
      const seededTask: Record<string, any> = {
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
      }
      if (typeof seededTask.spec === 'string' && seededTask.spec.trim() && !hasOwn(task, 'structuredSpec')) {
        seededTask.structuredSpec = structuredSpecForTest(seededTask.title)
      }
      return seededTask
    }),
  }
  await seedCanonicalQueue(queue)
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
  it('returns the task body without optional diagnostics for a seeded task', async () => {
    await seedTask('task-1')
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/task/task-1')))
    expect(res.status, await res.clone().text()).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.task?.id).toBe('task-1')
    expect(body.task?.status).toBe('in_progress')
    expect(body.projectRevision).toBeTypeOf('number')
    expect(body.queueRevision).toBeTypeOf('number')
    expect(body.decision).toMatchObject({
      projectRevision: body.projectRevision,
      queueRevision: body.queueRevision,
    })
    expect(body.actionModel?.primaryAction?.taskId).toBe(body.decision?.primaryAction?.targetId)
    expect(body.recentEvents).toBeUndefined()
    expect(body.contextDebug).toBeUndefined()
    expect(body.exploringTranscript).toBeUndefined()
    expect(body.threadTurns).toBeUndefined()
    expect(body.detailPayload?.extrasHref).toBe('/api/project/task/task-1/extras')
  })

  it('reuses the shared project action for the task named by the current decision', async () => {
    await seedTask('task-1')
    const { app } = buildServeApp({ projectPath: tmpDir })
    const [projectResponse, taskResponse] = await Promise.all([
      app.fetch(new Request(projectUrl('/api/project'))),
      app.fetch(new Request(projectUrl('/api/project/task/task-1'))),
    ])

    expect(projectResponse.status).toBe(200)
    expect(taskResponse.status).toBe(200)
    const projectBody = await projectResponse.json() as Record<string, any>
    const taskBody = await taskResponse.json() as Record<string, any>
    expect(taskBody.decision).toEqual(projectBody.decision)
    expect(taskBody.actionModel?.primaryAction).toEqual(projectBody.actionModel?.primaryAction)
  })

  it('does not let a stale task-opening cache replace a paused project resume action', async () => {
    await seedTask('task-1')
    updateProjectStateDatabaseSummaryAndCurrentState(taskQueuePath(), summary => ({
      summary: {
        ...summary,
        decision: {
          ...(summary.decision as Record<string, unknown>),
          execution: {
            state: 'paused',
            code: 'paused_live_work',
            focusTaskId: 'task-1',
            focusTaskTitle: 'Seeded task for tests',
            focusKind: 'paused_work',
            message: 'Seeded task for tests is paused in live work.',
          },
          primaryAction: {
            kind: 'resume',
            targetId: 'task-1',
            reasonCode: 'paused_live_work',
          },
        },
        actionModel: {
          ...(summary.actionModel as Record<string, unknown>),
          primaryAction: {
            source: 'task',
            label: 'Seeded task for tests',
            buttonLabel: 'Open task',
            href: '/task/task-1',
            tone: 'warn',
            taskId: 'task-1',
          },
        },
      },
      currentState: {
        execution: { status: 'stopped', updatedAt: new Date().toISOString() },
      },
    }))

    const { app } = buildServeApp({ projectPath: tmpDir })
    const [projectResponse, taskResponse] = await Promise.all([
      app.fetch(new Request(projectUrl('/api/project'))),
      app.fetch(new Request(projectUrl('/api/project/task/task-1'))),
    ])
    const projectBody = await projectResponse.json() as Record<string, any>
    const taskBody = await taskResponse.json() as Record<string, any>

    expect(projectBody.actionModel?.primaryAction).toMatchObject({
      code: 'paused_live_work',
      taskId: 'task-1',
      buttonLabel: 'Resume work',
      href: `/projects/${projectId}/work?task=task-1`,
    })
    expect(taskBody.actionModel?.primaryAction).toEqual(projectBody.actionModel?.primaryAction)
  })

  it('keeps task detail inspectable but exposes no action when the shared decision is stale', async () => {
    await seedTask('task-1')
    const database = new DatabaseSync(projectStateDatabasePath(tmpDir))
    try {
      database.exec('DELETE FROM project_state_decisions')
    } finally {
      database.close()
    }

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/task/task-1')))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      task: { id: 'task-1' },
      decision: null,
      decisionFreshness: 'stale',
      requiresRefresh: true,
      actionModel: null,
    })
  })

  it('keeps durable history out of the initial drawer payload', async () => {
    await seedTask('task-1', {
      notes: Array.from({ length: 20 }, (_, index) => ({
        role: 'agent',
        content: `Historical note ${index} ${'x'.repeat(500)}`,
        timestamp: `2026-07-06T12:${String(index).padStart(2, '0')}:00.000Z`,
      })),
      evidence: Array.from({ length: 20 }, (_, index) => ({
        id: `evidence-${index}`,
        kind: 'note',
        recordedAt: '2026-07-06T12:00:00.000Z',
        payload: { content: 'Historical evidence '.repeat(100) },
      })),
      reviewVerdicts: [{ recordedAt: '2026-07-06T12:00:00.000Z', verdict: 'revise', reasoning: 'Historical review '.repeat(100) }],
      adjudications: [{ decidedAt: '2026-07-06T12:00:01.000Z', verdict: 'revise', reasoning: 'Historical adjudication '.repeat(100) }],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/task/task-1')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>

    expect(body.task?.notes).toBeUndefined()
    expect(body.task?.evidence).toBeUndefined()
    expect(body.task?.reviewVerdicts).toBeUndefined()
    expect(body.task?.adjudications).toBeUndefined()
    expect(body.detailPayload?.omitted).toEqual(expect.arrayContaining([
      'task notes',
      'task evidence ledger',
      'review verdict history',
      'review adjudications',
    ]))
  })

  it('does not present a checkpoint from before a reframe as current task progress', async () => {
    await seedTask('task-1', { status: 'spec_review' })
    await upsertTaskRuntimeState(tmpDir, 'task-1', {
      currentLifecycle: {
        reopenedAt: '2026-08-08T12:00:00.000Z',
        status: 'exploring',
        source: 'rerun_spec',
      },
      updatedAt: '2026-08-08T12:00:00.000Z',
    })
    const checkpoint = await writeCheckpoint({
      tasksPath: taskQueuePath(),
      memoryDir,
      taskId: 'task-1',
      agentId: 'worker-agent',
      intent: 'Old worker checkpoint',
      nextPlannedAction: 'Resume the old worker pass.',
      filesTouched: ['src/old-work.ts'],
    })
    expect(checkpoint.success).toBe(true)
    if (!checkpoint.path) throw new Error('Expected checkpoint writer to return its path')
    const persisted = JSON.parse(await fs.readFile(checkpoint.path, 'utf8')) as Record<string, unknown>
    persisted.writtenAt = '2026-08-08T11:59:59.000Z'
    await fs.writeFile(checkpoint.path, JSON.stringify(persisted), 'utf8')

    const { app } = buildServeApp({ projectPath: tmpDir })
    const response = await app.fetch(new Request(projectUrl('/api/project/task/task-1')))
    expect(response.status).toBe(200)
    expect((await response.json() as Record<string, any>).task?.latestCheckpoint).toBeUndefined()
  })

  it('reads a current task detail from the database queue, not TASKS.json', async () => {
    await seedCanonicalQueue({
      version: 1,
      lastUpdated: '2026-07-14T00:00:00.000Z',
      tasks: [{
        id: 'task-1',
        title: 'Database-backed task detail',
        description: 'The compatibility export is deliberately unreadable for this regression.',
        domain: 'runtime',
        projectPath: tmpDir,
        status: 'ready',
        priority: 'normal',
        revisionCount: 0,
        remediationAttempts: 0,
        origination: 'human',
        createdAt: '2026-07-14T00:00:00.000Z',
        updatedAt: '2026-07-14T00:00:00.000Z',
      }],
    })
    await fs.writeFile(taskQueuePath(), '{ deliberately invalid compatibility JSON', 'utf8')
    const database = new DatabaseSync(projectStateDatabasePath(tmpDir))
    database.prepare('UPDATE project_summary SET source_queue_mtime_ms = ? WHERE id = 1')
      .run(statSync(taskQueuePath()).mtimeMs)
    database.close()

    const { app } = buildServeApp({ projectPath: tmpDir })
    const response = await app.fetch(new Request(projectUrl('/api/project/task/task-1')))
    expect(response.status).toBe(200)
    expect((await response.json() as Record<string, any>).task).toMatchObject({
      id: 'task-1',
      title: 'Database-backed task detail',
    })
  })

  it('shows release-required script proof as missing in task detail', async () => {
    const now = new Date().toISOString()
    await seedCanonicalQueue({
      version: 1,
      lastUpdated: now,
      selectedReleaseId: 'headless-mvp',
      releases: [{
        id: 'headless-mvp',
        label: 'Stage 1: Headless Drafting MVP',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        nodeIds: ['work:task-1'],
        deferredNodeIds: [],
        proofStyle: 'script_only',
      }],
      tasks: [{
        id: 'task-1',
        title: 'Prove world-state continuity review',
        description: 'A test task',
        domain: 'looma',
        projectPath: tmpDir,
        status: 'done',
        priority: 'normal',
        revisionCount: 0,
        remediationAttempts: 0,
        releaseIds: ['headless-mvp'],
        proofPaths: [{
          kind: 'review',
          expectedEvidence: [{
            id: 'elapsed-object-state',
            description: 'Object state changes over elapsed time.',
          }],
        }],
        doneSummaryBundle: {
          status: 'done',
          completedAt: '2026-07-06T20:00:00.000Z',
          summary: { evidence: 'content.no-truncated-data passed.' },
        },
        gateResults: [{
          gateId: 'content.no-truncated-data',
          passed: true,
          checkedAt: '2026-07-06T20:00:00.000Z',
        }],
        reviewVerdicts: [{
          verdict: 'approve',
          reviewerPath: 'llm',
          acceptedCriteriaIds: [],
          proofEvidenceIds: [],
          reasoning: 'All acceptance criteria are met.',
          recordedAt: '2026-07-06T20:00:00.000Z',
        }],
        createdAt: now,
        updatedAt: now,
      }],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/task/task-1')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>

    expect(body.task?.completionProof).toMatchObject({ state: 'missing' })
    expect(body.task?.completionProof?.missing?.length).toBeGreaterThan(0)
    expect(body.task?.completionProof?.verified).not.toContain('Gate passed: content.no-truncated-data')
    expect(body.task?.completionProof?.verified).not.toContain('Review approved: llm')
    expect(body.task?.completionProof?.historical).toEqual(expect.arrayContaining([
      'Gate passed: content.no-truncated-data',
      'Review approved: llm',
    ]))
  })

  it('builds drawer work progress from effective proof state, not stale raw task records', async () => {
    await seedTask('task-1', {
      title: 'Run fixture evaluator proof',
      status: 'done',
      proofPaths: [{
        kind: 'command',
        command: 'runner-smoke',
        expectedEvidence: [{ id: 'runner-smoke', description: 'Runner smoke proof.' }],
      }],
      gateResults: [],
    })
    await appendTaskEvidence(tmpDir, 'task-1', {
      id: 'gate-task-1-runner-smoke',
      kind: 'gate_result',
      recordedAt: '2026-07-06T12:00:00.000Z',
      payload: {
        gateId: 'runner-smoke',
        command: 'runner-smoke',
        status: 'pass',
        checkedAt: '2026-07-06T12:00:00.000Z',
      },
    })

    const effectiveFixture = await readEffectiveTask('task-1')
    expect(effectiveFixture.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'gate_result',
        payload: expect.objectContaining({ command: 'runner-smoke' }),
      }),
    ]))
    expect(effectiveFixture.currentSummary?.proof).toMatchObject({ state: 'proven' })

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
          createdAt: '2026-06-01T00:00:00.000Z',
          createdBy: 'test',
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
    const deliveryRefresh = await refreshProjectDeliveryReadProjection(tmpDir)
    expect(deliveryRefresh.status).toBe('current')

    const { app } = buildServeApp({ projectPath: tmpDir })
    const detailRes = await app.fetch(new Request(projectUrl('/api/project/task/task-component')))
    expect(detailRes.status).toBe(200)
    const detail = (await detailRes.json()) as Record<string, any>
    expect(detail.deliverySpine.contextPacket.deliveryIntent.driver.label).toBe('Knit')
    expect(detail.deliverySpine.contextPacket.primitiveContext.direct.map((primitive: any) => primitive.id)).toEqual(['menu-item'])
    expect(detail.deliverySpine.relationships.primitiveUse.blockers.map((primitive: any) => primitive.id)).toEqual(['menu-item'])

    const projectRes = await app.fetch(new Request(projectUrl('/api/project/delivery-spine')))
    expect(projectRes.status).toBe(200)
    const project = (await projectRes.json()) as Record<string, any>
    expect(project.queue.firstRunnable.task.id).toBe('task-storybook')
    expect(project.validation.valid).toBe(true)
  })

  it('does not repair stale worker ownership during a task-detail read', async () => {
    await seedTask('task-1', { assignedTo: null })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/task/task-1')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.task?.assignedTo).toBeNull()

    const raw = await readTaskQueue()
    expect(raw.tasks[0]?.assignedTo).toBeNull()
  })

  it('does not repair completed tasks left blocked during a task-detail read', async () => {
    await seedTask('task-1', {
      status: 'blocked',
      blockReason: null,
      completedAt: '2026-06-17T05:20:00.000Z',
      assignedTo: null,
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/task/task-1')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.task?.status).toBe('blocked')
    expect(body.task?.completedAt).toBe('2026-06-17T05:20:00.000Z')
    expect(body.task?.blockReason).toBeUndefined()

    const current = readProjectStateDatabaseTaskPointWithRevision(taskQueuePath(), 'task-1')
    expect(current?.task.definition.status).toBe('blocked')
    expect(current?.task.definition.blockReason).toBeUndefined()
  })

  it('returns recent context debug records only from the diagnostics endpoint', async () => {
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
    const res = await app.fetch(new Request(projectUrl('/api/project/task/task-1/extras?include=context')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.contextDebug?.map((record: Record<string, any>) => record.id)).toEqual([
      'newer',
      'older',
    ])
  })

  it('returns task thread turns only from the explicit task-detail extras endpoint', async () => {
    await seedTask('task-1')
    const { app } = buildServeApp({ projectPath: tmpDir })

    const detailRes = await app.fetch(new Request(projectUrl('/api/project/task/task-1')))
    expect(detailRes.status).toBe(200)
    expect((await detailRes.json() as Record<string, unknown>).threadTurns).toBeUndefined()

    const extrasRes = await app.fetch(new Request(projectUrl('/api/project/task/task-1/extras?include=thread')))
    expect(extrasRes.status).toBe(200)
    expect(Array.isArray((await extrasRes.json() as Record<string, unknown>).threadTurns)).toBe(true)
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

  it('keeps the exploring transcript out of task detail until requested', async () => {
    await seedTask('task-1')
    const transcriptPath = getProjectTranscriptPath(tmpDir, 'exploring', 'task-1')
    await fs.mkdir(path.dirname(transcriptPath), { recursive: true })
    await fs.writeFile(
      transcriptPath,
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
        'Raw transcript should never be in ordinary task detail.'.repeat(4_096),
        '',
        '---',
      ].join('\n'),
      'utf8',
    )

    const { app } = buildServeApp({ projectPath: tmpDir })
    const detailRes = await app.fetch(new Request(projectUrl('/api/project/task/task-1')))
    expect(detailRes.status).toBe(200)
    const detail = (await detailRes.json()) as Record<string, any>
    expect(detail.exploringTranscript).toBeUndefined()
    expect(JSON.stringify(detail).length).toBeLessThan(50_000)

    const extrasRes = await app.fetch(new Request(projectUrl('/api/project/task/task-1/extras?include=transcript')))
    expect(extrasRes.status).toBe(200)
    const extras = (await extrasRes.json()) as Record<string, any>
    const transcript = await readExploringTranscript({ memoryDir, taskId: 'task-1' })
    expect(extras.exploringTranscript?.path).toBe(transcript.path)
    expect(extras.exploringTranscript?.content).toContain('Let me find the source note first.')
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
    expect(body.task?.notes).toBeUndefined()

    const historyRes = await app.fetch(new Request(projectUrl('/api/project/task/task-1/history')))
    expect(historyRes.status).toBe(200)
    const historyBody = (await historyRes.json()) as Record<string, any>
    expect(historyBody.events?.filter((event: Record<string, any>) => event.kind === 'note').map((event: Record<string, any>) => event.payload?.content)).toEqual([
      'Added acceptance criterion: Redirects to /<slug> when membership resolves.',
      'Keep the /signup fallback explicit.',
    ])

    const pageRes = await app.fetch(new Request(projectUrl('/api/project/task/task-1/history?limit=1&cursor=1')))
    expect(pageRes.status).toBe(200)
    const pageBody = (await pageRes.json()) as Record<string, any>
    expect(pageBody.events).toHaveLength(1)
    expect(pageBody.pagination).toMatchObject({ cursor: 1, limit: 1, total: 2, hasMore: false })
  })

  it('serves the current proof-recovery blocker instead of stale max-revisions text', async () => {
    await seedTask('task-1', {
      status: 'blocked',
      blockReason: 'max_revisions_exceeded: reviewer loop hit its old cap before proof recovery reopened.',
      proofRecovery: {
        kind: 'proof',
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
    expect(body.task?.latestSelfCritique).toBeUndefined()
    expect(body.task?.latestCheckpoint?.intent).toBe('Verify focused unit tests')
    expect(body.task?.latestCheckpoint?.nextPlannedAction).toBe('Hand off to review')
    const evidence = await readTaskEvidence(tmpDir, 'task-1', { kind: 'note' })
    expect(evidence.map(event => String((event.payload as Record<string, unknown>)?.content))).toEqual(expect.arrayContaining([
      expect.stringContaining('focused use-collections tests are green'),
      expect.stringContaining('Aggregated revisions'),
    ]))
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
    expect(task?.latestSelfCritique).toBeUndefined()
    expect(task?.latestCheckpoint?.intent).toBe('Verify focused unit tests')
    expect(task?.evidenceSummary?.counts?.notes).toBe(2)
    expect(task?.evidenceSummary?.counts?.reviewVerdicts).toBe(0)
    expect(task?.evidenceSummary?.counts?.adjudications).toBe(0)
    expect(task?.evidenceSummary?.counts?.gateResults).toBe(0)
    expect(task?.evidenceSummary?.latest?.kind).toBe('note')
    expect(task?.notes).toBeUndefined()
    const evidence = await readTaskEvidence(tmpDir, 'task-1', { kind: 'note' })
    expect(evidence.map(event => String((event.payload as Record<string, unknown>)?.content))).toEqual(expect.arrayContaining([
      expect.stringContaining('focused use-collections tests are green'),
      expect.stringContaining('Aggregated revisions'),
    ]))
  })

  it('keeps /api/project task rows compact while task detail remains full fidelity', async () => {
    await seedTask('task-1', {
      status: 'blocked',
      title: 'Compact project task',
      description: 'Show this in project orientation.',
      spec: '## Summary\n\nThis full worker handoff belongs in task detail.',
      acceptanceCriteria: [{ description: 'The project row still shows proof needs.' }],
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
    const ownerInput = await createOwnerInputRequest({
      projectRoot: tmpDir,
      projectId,
      commandId: 'test:task-1-proof-path',
      now: '2026-06-01T00:00:00.000Z',
      actor: 'test',
      source: { kind: 'task', taskId: 'task-1', questionId: 'proof-path' },
      target: { kind: 'thread' },
      objective: {
        kind: 'task_shaping',
        label: 'Clarify Compact project task',
        successCriteria: ['Owner chooses the proof path.'],
      },
      question: {
        kind: 'text',
        prompt: 'Which proof path matters?',
      },
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
    })
    expect(projectTask?.acceptanceCriteria?.[0]?.description).toBe('The project row still shows proof needs.')
    expect(projectTask?.openQuestions).toBeUndefined()
    expect(await listOwnerInputRequests(tmpDir)).toEqual([
      expect.objectContaining({
        id: ownerInput.request.id,
        prompt: 'Which proof path matters?',
        source: { kind: 'task', taskId: 'task-1', questionId: 'proof-path' },
      }),
    ])
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
    expect(detailBody.task?.notes).toBeUndefined()
    expect(detailBody.task?.requestIntake).toMatchObject({ intent: 'implementation' })
    expect(detailBody.task?.productBrief?.successMetric).toContain('whole brief')
    expect(detailBody.task?.reviewPlan).toBeUndefined()

    const historyRes = await app.fetch(new Request(projectUrl('/api/project/task/task-1/history')))
    expect(historyRes.status).toBe(200)
    const historyBody = (await historyRes.json()) as Record<string, any>
    expect(historyBody.events?.some((event: Record<string, any>) => event.payload?.content?.includes('Verbose transcript note'))).toBe(true)
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
    await writeCheckpoint({
      tasksPath: taskQueuePath(),
      memoryDir,
      taskId: 'task-storybook',
      agentId: 'worker-agent',
      intent: 'Long checkpoint intent belongs on task detail.',
      nextPlannedAction: 'Rerun Storybook proof.',
      filesTouched: ['packages/editor/src/menu.ts'],
    })
    await writeProjectDeliveryModel(tmpDir, {
      version: 1,
      updatedAt: '2026-06-05T12:00:00.000Z',
      drivers: [{ id: 'knit', label: 'Knit', role: 'primary', paths: [], domains: [] }],
      primitives: [{
        id: 'menu-item',
        label: 'Menu item',
        kind: 'ui_primitive',
        paths: [],
        dependsOn: [],
        invariants: [],
        proof: [],
        status: 'proposed',
        evidence: [],
        aliases: [],
      }],
      validationEvidence: [],
      rejectedCandidates: [],
    })
    const deliveryRefresh = await refreshProjectDeliveryReadProjection(tmpDir)
    expect(deliveryRefresh.status).toBe('current')

    const { app, refreshProjectProjections } = buildServeApp({ projectPath: tmpDir })
    await refreshProjectProjections(tmpDir)
    const workRes = await app.fetch(new Request(projectUrl('/api/project?surface=work&task=task-storybook')))
    const workBody = (await workRes.json()) as Record<string, any>
    const overviewRes = await app.fetch(new Request(projectUrl('/api/project?surface=overview')))
    const overviewBody = (await overviewRes.json()) as Record<string, any>

    expect(workRes.status, workBody.error).toBe(200)
    expect(overviewRes.status, overviewBody.error).toBe(200)
    expect(overviewBody.orientationSpine?.sourceHealth).toEqual(workBody.orientationSpine?.sourceHealth)
    expect(overviewBody.orientationSpine?.summary?.headline).toEqual(workBody.orientationSpine?.summary?.headline)
    expect(overviewBody.orientationSpine?.summary?.nextAction).toEqual(workBody.orientationSpine?.summary?.nextAction)
    expect(overviewBody.orientationSpine?.summary?.progress).toEqual(workBody.orientationSpine?.summary?.progress)
    expect(overviewBody.orientationSpine?.release).toEqual(workBody.orientationSpine?.release)
    expect(overviewBody.taskPayload).toMatchObject({
      surface: 'overview',
      kind: 'selected_scope_cards',
      count: overviewBody.tasks.length,
      selectedScopeCount: overviewBody.orientationSpine?.summary?.includedWorkCount,
      selectedScopeAndDeferredCount: overviewBody.orientationSpine?.summary?.progress?.total,
    })
    expect(workBody.taskPayload).toMatchObject({
      surface: 'work',
      kind: 'project_work_inventory',
      count: workBody.tasks.length,
      selectedScopeCount: workBody.orientationSpine?.summary?.includedWorkCount,
      selectedScopeAndDeferredCount: workBody.orientationSpine?.summary?.progress?.total,
    })
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
    expect(workTask?.evidenceSummary).toBeUndefined()
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
    expect(workBody.taskRoutingContexts).toBeUndefined()
    const deliveryRes = await app.fetch(new Request(projectUrl('/api/project/delivery-spine')))
    const deliveryBody = (await deliveryRes.json()) as Record<string, any>
    expect(deliveryRes.status, deliveryBody.error).toBe(200)
    expect(deliveryBody.queue?.firstRunnable?.task?.id).toBe('task-storybook')
    expect(deliveryBody.queue?.firstRunnable?.task?.title).toBe('Prove the menu primitive')
    expect(deliveryBody.queue?.firstRunnable?.task?.spec).toBeUndefined()
    expect(deliveryBody.queue?.firstRunnable?.task?.evidence).toBeUndefined()
    expect(workBody.deliverySpine).toBeUndefined()
    expect(workBody.releaseReadiness?.releaseBlockers).toEqual(expect.any(Array))
    expect(workBody.gitStory).toBeUndefined()
    expect(workBody.memoryHealth).toBeTruthy()

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
    await seedCanonicalQueue({
      version: 1,
      lastUpdated: now,
      selectedReleaseId: 'headless-mvp',
      releases: [{
        id: 'headless-mvp',
        label: 'Headless MVP',
        status: 'active',
        createdAt: now,
        nodeIds: ['work:task-model-proof'],
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

    setProvider('anthropic-api', { apiKey: 'sk-ant-test' })
    updateGlobalConfig({ preferredProvider: 'anthropic-api' })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project')))
    const body = (await res.json()) as Record<string, any>

    expect(res.status, body.error).toBe(200)
    expect(body.startReadiness).toMatchObject({
      canStart: false,
      code: 'proof_evidence_missing',
      actionHref: '/projects/task-endpoints-test/work?task=task-model-proof',
      focusTaskId: 'task-model-proof',
      focusKind: 'proof',
      count: 1,
    })
    expect(body.startReadiness?.message).toContain('"Prove the drafting model" is complete but its completion proof is missing or stale.')
  })

  it('backfills compact task provenance from selected-scope orientation truth when raw task refs are empty', async () => {
    const now = '2026-07-13T20:10:00.000Z'
    await seedTask('task-smoke', {
      title: 'Define safe smoke-test commands',
      description: 'Ground this in docs/harness/smoke-test-commands.md so the project can be smoke tested safely.',
      domain: 'narrative-harness',
      status: 'ready',
      createdAt: now,
      updatedAt: now,
      references: [],
    })

    const { app, refreshProjectProjections } = buildServeApp({ projectPath: tmpDir })
    await refreshProjectProjections(tmpDir)
    const workRes = await app.fetch(new Request(projectUrl('/api/project?surface=work&task=task-smoke')))
    const workBody = (await workRes.json()) as Record<string, any>
    const overviewRes = await app.fetch(new Request(projectUrl('/api/project?surface=overview')))
    const overviewBody = (await overviewRes.json()) as Record<string, any>

    expect(workRes.status, workBody.error).toBe(200)
    expect(overviewRes.status, overviewBody.error).toBe(200)
    expect(workBody.orientationSpine?.scopeRows).toEqual([
      expect.objectContaining({
        taskId: 'task-smoke',
        sourceRefs: ['docs/harness/smoke-test-commands.md'],
      }),
    ])
    expect(workBody.tasks?.find((task: Record<string, any>) => task.id === 'task-smoke')).toMatchObject({
      sourceRefs: ['docs/harness/smoke-test-commands.md'],
      references: ['docs/harness/smoke-test-commands.md'],
      orientationSummary: 'Ground this in docs/harness/smoke-test-commands.md so the project can be smoke tested safely.',
    })
    expect(overviewBody.tasks?.find((task: Record<string, any>) => task.id === 'task-smoke')).toMatchObject({
      sourceRefs: ['docs/harness/smoke-test-commands.md'],
      references: ['docs/harness/smoke-test-commands.md'],
      orientationSummary: 'Ground this in docs/harness/smoke-test-commands.md so the project can be smoke tested safely.',
    })
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
        command: 'pnpm test',
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
    const evidence = await readTaskEvidence(tmpDir, 'task-1', { kind: 'merge_record' })
    expect(evidence.at(-1)?.payload).toMatchObject({
      detail: 'worktree isolation disabled — merge skipped',
    })
  })

  it('does not derive self-critique summaries from worker-role prose', async () => {
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
    expect(body.task?.latestSelfCritique).toBeUndefined()
  })

  it('does not derive self-critique summaries from implementer-role prose', async () => {
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
    expect(body.task?.latestSelfCritique).toBeUndefined()
  })

  it('does not derive self-critique summaries from worker persona-role prose', async () => {
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
    expect(body.task?.latestSelfCritique).toBeUndefined()
  })

  it('keeps checkpoint display text separate from structured routing state', async () => {
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
      "Write or refresh self-critique note, then transition task to 'review'",
    )
  })

describe('POST /api/project/delivery-spine/contract-results/:id/apply', () => {
  it('applies a staged primitive setup result and removes it from the inbox', async () => {
    await seedTask('task-context-menu', {
      status: 'ready',
      delivery: { driver: 'knit', provider: 'looma', supports: [] },
    })
    const taskQueue = await readTaskQueue() as { tasks: any[] }
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

    const { app, refreshProjectProjections } = buildServeApp({ projectPath: tmpDir })
    await refreshProjectProjections(tmpDir)
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
    await refreshProjectProjections(tmpDir)

    const projectRes = await app.fetch(new Request(projectUrl('/api/project/delivery-spine')))
    const projectBody = (await projectRes.json()) as any
    expect(projectBody.model.primitives.map((primitive: any) => primitive.id)).toContain('context-menu')
    const updatedQueue = await readTaskQueue() as { tasks: any[] }
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
    const taskQueue = await readTaskQueue() as { tasks: any[] }
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

    const projectRes = await app.fetch(new Request(projectUrl('/api/project/delivery-spine')))
    const projectBody = (await projectRes.json()) as any
    expect(projectBody.model.primitives.map((primitive: any) => primitive.id)).not.toContain('context-menu')
    expect(projectBody.model.rejectedCandidates.at(-1).reason).toBe('Duplicate primitive.')
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

  it('commits task work in the persisted task worktree instead of the project root', async () => {
    const taskRepo = path.join(tmpDir, 'task-repo')
    await fs.mkdir(path.join(taskRepo, 'src'), { recursive: true })
    execFileSync('git', ['init', '-q'], { cwd: taskRepo })
    execFileSync('git', ['config', 'user.email', 'guildhall-tests@example.invalid'], { cwd: taskRepo })
    execFileSync('git', ['config', 'user.name', 'Guildhall Tests'], { cwd: taskRepo })
    await fs.writeFile(path.join(taskRepo, 'src', 'proof.txt'), 'proof\n', 'utf8')
    await upsertTaskWorkspaceState(tmpDir, 'task-1', {
      worktreePath: taskRepo,
      branchName: 'guildhall/task-task-1',
      baseBranch: 'main',
    })
    await seedTask('task-1', { status: 'done' })
    await upsertTaskWorkspaceState(tmpDir, 'task-1', {
      worktreePath: taskRepo,
      branchName: 'guildhall/task-task-1',
      baseBranch: 'main',
    })
    // The workspace overlay advances project state after the initial seed.
    // Apply the required current-state migration before exercising a write.
    await applyCanonicalMigrations()
    const { app } = buildServeApp({ projectPath: tmpDir })

    const events: Array<{ projectRoot: string; domains: string[] }> = []
    const unsubscribe = subscribeProjectSummaryInvalidations(event => events.push({
      projectRoot: event.projectRoot,
      domains: [...event.domains],
    }))
    const res = await app.fetch(new Request(projectUrl('/api/project/task/task-1/git-story/commit'), {
      method: 'POST',
      body: JSON.stringify({ confirmed: true, message: 'record task proof', files: ['src/proof.txt'] }),
      headers: { 'content-type': 'application/json' },
    }))
    unsubscribe()

    expect(res.status, await res.clone().text()).toBe(200)
    expect(execFileSync('git', ['status', '--short'], { cwd: taskRepo, encoding: 'utf8' })).toBe('')
    await expect(fs.access(path.join(tmpDir, 'src', 'proof.txt'))).rejects.toThrow()
    expect(events).toContainEqual({
      projectRoot: tmpDir,
      domains: ['repository'],
    })
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

    const raw = await readTaskQueue()
    expect(raw.tasks[0]?.gitStory).toMatchObject({
      override: 'local_only',
      reason: 'Fixture-only scratch work.',
      recordedBy: 'user',
    })
  })

  it('preserves selected release metadata when recording a git story override', async () => {
    const now = new Date().toISOString()
    await seedCanonicalQueue({
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

    let q = await readTaskQueue()
    expect(q.tasks[0].status).toBe('blocked')
    expect(q.tasks[0].blockReason).toBe('On hold: Waiting for the design call.')
    expect(q.tasks[0].hold).toMatchObject({
      previousStatus: 'review',
      reason: 'Waiting for the design call.',
      heldBy: 'human',
    })
    expect(q.tasks[0].notes?.at(-1)?.agentId).toBe('system:human')

    const detailAfterHold = await app.fetch(new Request(projectUrl('/api/project/task/task-1')))
    const detailAfterHoldBody = await detailAfterHold.json() as Record<string, any>
    expect(detailAfterHoldBody.decisionFreshness, JSON.stringify(detailAfterHoldBody)).toBe('current')

    const resumeRes = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/resume-hold'), { method: 'POST' }),
    )
    expect(resumeRes.status, await resumeRes.clone().text()).toBe(200)
    const resumeBody = (await resumeRes.json()) as Record<string, any>
    expect(resumeBody.status).toBe('review')

    q = await readTaskQueue()
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
    const q = await readTaskQueue()
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
  it('does not let a Thread evidence note manufacture completion proof', async () => {
    await seedTask('task-1', {
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
    expect(res.status).toBe(409)
    const body = (await res.json()) as Record<string, any>
    expect(body.code).toBe('task_completion_proof_required')

    const q = await readTaskQueue()
    const task = q.tasks[0]
    expect(task.status).toBe('ready')
    expect(task.assignedTo).toBeNull()
    expect(task.blockReason).toBe('Old blocker')
    expect(task.acceptanceCriteria.every((criterion: Record<string, any>) => criterion.met === false)).toBe(true)
    expect(task.doneSummaryBundle).toBeUndefined()
  })

  it('rejects mark-done on active execution stages', async () => {
    await seedTask('task-1', { status: 'in_progress' })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/mark-done'), { method: 'POST' }),
    )
    expect(res.status).toBe(409)
    const body = (await res.json()) as Record<string, any>
    expect(body.error).toMatch(/cannot complete/i)
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
        structuredSpec: structuredSpecForTest('ContextMenu'),
        specReviewGate: {
          authority: 'owner',
          requestedAt: new Date().toISOString(),
          requestedBy: 'spec-agent',
          reason: 'spec_handoff',
        },
        productBrief: {
          userJob: 'Review the ContextMenu implementation contract.',
          successMetric: 'The owner can approve a complete ContextMenu contract.',
          nonGoals: [],
          authoredBy: 'spec-agent',
          authoredAt: new Date().toISOString(),
        },
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

  it('starts a malformed spec review through the shared repair readiness', async () => {
    await seedTasks([{
      id: 'task-needs-spec-repair',
      title: 'Repair the legacy draft',
      status: 'spec_review',
      spec: 'Rendered Markdown is not a durable contract.',
      structuredSpec: undefined,
      acceptanceCriteria: [{ id: 'ac-1', description: 'The owner sees this only after repair.', verifiedBy: 'review' }],
    }])
    const { supervisor, starts } = createTrackingSupervisor()
    const { app } = buildServeApp({ projectPath: tmpDir, supervisor })
    setProvider('anthropic-api', { apiKey: 'sk-ant-test' })
    updateGlobalConfig({ preferredProvider: 'anthropic-api' })

    try {
      const res = await app.fetch(
        new Request(projectUrl('/api/project/task/task-needs-spec-repair/start'), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ mode: 'one_task', scope: 'work_item' }),
        }),
      )

      expect(res.status, await res.text()).toBe(200)
      await vi.waitFor(() => {
        expect(starts.at(-1)).toMatchObject({
          preferredTaskId: 'task-needs-spec-repair',
          stopAfterOneTask: true,
        })
      })
    } finally {
      await supervisor.stopAll({ reason: 'test-teardown' }).catch(() => {})
    }
  })

  it('does not infer recovery child work before blocking focused start for spec review', async () => {
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
          structured: { event: 'recovery_spec_seed', source: 'deterministic' },
          content: 'Guildhall wrote a deterministic recovery spec seed from the current task evidence before redispatching the spec lane.',
          timestamp: '2026-07-05T18:15:02.867Z',
        }],
      },
    ])
    const { supervisor, starts } = createTrackingSupervisor()
    const { app } = buildServeApp({ projectPath: tmpDir, supervisor })
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
    const task = queue.tasks.find((candidate: Record<string, any>) => candidate.id === 'task-model-proof')
    const criteria = (task?.acceptanceCriteria ?? []).map((criterion: Record<string, unknown>) => String(criterion.description ?? '')).join('\n')
    expect(criteria).toContain('repo-local proof demonstrates that exact child outcome')
    expect((task?.workUnitAnalysis as Record<string, any> | undefined)?.units).toBeUndefined()
    expect(task?.spec).toContain('repo-local proof demonstrates that exact child outcome')
    expect(task?.productBrief?.userJob).toContain('implemented or proven from current evidence')
    expect(task?.productBrief?.successMetric).toContain('concrete completion boundary')
    expect(task?.notes?.at(-1)?.content).toContain('deterministic recovery spec seed')
  })

  it('does not replace a proof-recovery spec from the raw task projection', async () => {
    const originalSpec = [
      '## Summary',
      'Recover a concrete project-backed proof command.',
      '',
      '## Acceptance Criteria',
      '1. The proof command is recorded against this task.',
    ].join('\n')
    await seedTasks([
      {
        id: 'task-proof-recovery',
        title: 'Recover project proof',
        status: 'spec_review',
        spec: originalSpec,
        acceptanceCriteria: [{
          id: 'ac-1',
          description: 'The proof command is recorded against this task.',
          verifiedBy: 'review',
        }],
        productBrief: {
          userJob: 'Recover the missing project proof.',
          successMetric: 'The proof command is recorded against this task.',
          antiPatterns: [],
          authoredBy: 'coordinator-recovery',
          authoredAt: new Date().toISOString(),
        },
        runtime: {
          proofRecovery: {
            reopenedAt: new Date().toISOString(),
            reason: 'The selected release requires script proof, but the current proof command is missing.',
          },
        },
        notes: [{
          agentId: 'coordinator-recovery',
          role: 'system',
          structured: { event: 'recovery_spec_seed', source: 'deterministic' },
          content: 'Guildhall wrote a deterministic recovery spec seed from the current task evidence before redispatching the spec lane.',
          timestamp: new Date().toISOString(),
        }],
      },
    ])
    const { supervisor, starts } = createTrackingSupervisor()
    const { app } = buildServeApp({ projectPath: tmpDir, supervisor })
    setProvider('anthropic-api', { apiKey: 'sk-ant-test' })
    updateGlobalConfig({ preferredProvider: 'anthropic-api' })

    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-proof-recovery/start'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'one_task', scope: 'work_item' }),
      }),
    )

    expect(res.status).toBe(400)
    expect((await res.json() as Record<string, unknown>).code).toBe('no_unattended_progress')
    expect(starts).toHaveLength(0)
    const queue = await readTaskQueue()
    const task = queue.tasks.find((candidate: Record<string, any>) => candidate.id === 'task-proof-recovery')
    expect(task?.spec).toBe(originalSpec)
    expect(task?.notes?.at(-1)?.content).toContain('deterministic recovery spec seed')
    expect(task?.notes?.at(-1)?.content).not.toContain('under-shaped recovery spec')
  })

  it('lets project Start advance the selected source-recovery shaping task', async () => {
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
      expect(projectStart.status).toBe(200)
      await vi.waitFor(() => {
        expect(starts.at(-1)).toEqual({})
      })
    } finally {
      await supervisor.stopAll({ reason: 'test-teardown' }).catch(() => {})
    }
  })

  it('prepares every selected proof blocker and keeps global Resume scoped to the release', async () => {
    const now = '2026-07-23T09:00:00.000Z'
    await seedCanonicalQueue({
      version: 1,
      lastUpdated: now,
      selectedReleaseId: 'release-1',
      releases: [{
        id: 'release-1',
        label: 'Headless MVP',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        proofStyle: 'script_only',
        nodeIds: ['work:task-1', 'work:task-2', 'work:task-review'],
        deferredNodeIds: [],
      }],
      tasks: [{
        id: 'task-1',
        title: 'Prove author input',
        description: 'A completed selected-scope task needs current script proof.',
        domain: 'harness',
        projectPath: tmpDir,
        status: 'done',
        priority: 'normal',
        releaseIds: ['release-1'],
        acceptanceCriteria: [{ id: 'ac-1', description: 'A project proof passes.', verifiedBy: 'review', met: true }],
        createdAt: now,
        updatedAt: now,
      }, {
        id: 'task-2',
        title: 'Prove chapter review',
        description: 'A second completed selected-scope task needs current script proof.',
        domain: 'harness',
        projectPath: tmpDir,
        status: 'done',
        priority: 'normal',
        releaseIds: ['release-1'],
        acceptanceCriteria: [{ id: 'ac-1', description: 'A project proof passes.', verifiedBy: 'review', met: true }],
        createdAt: now,
        updatedAt: now,
        completedAt: now,
      }, {
        id: 'task-review',
        title: 'Review an unrelated release spec',
        description: 'This task needs an owner review, but must not stop runnable proof work.',
        domain: 'harness',
        projectPath: tmpDir,
        status: 'spec_review',
        priority: 'normal',
        releaseIds: ['release-1'],
        spec: '## Summary\nReview the unrelated task.\n\n## Acceptance Criteria\n1. The task is approved.',
        acceptanceCriteria: [{ id: 'ac-1', description: 'The task is approved.', verifiedBy: 'review', met: false }],
        createdAt: now,
        updatedAt: now,
      }],
    })
    await applyProjectMigrations({
      projectRoot: tmpDir,
      only: ['0.13.30/proof-setup-completion-authority'],
      appVersion: 'serve-task-endpoints-test',
    })
    await applyCanonicalMigrations()
    await refreshCanonicalSummary()
    const { supervisor, starts } = createTrackingSupervisor()
    const { app } = buildServeApp({ projectPath: tmpDir, supervisor })
    setProvider('anthropic-api', { apiKey: 'sk-ant-test' })
    updateGlobalConfig({ preferredProvider: 'anthropic-api' })

    try {
      const response = await app.fetch(new Request(projectUrl('/api/project/start'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'continuous' }),
      }))
      expect(response.status, await response.text()).toBe(200)
      await vi.waitFor(() => expect(starts.at(-1)).toEqual({}))

      const queue = await readTaskQueue()
      expect(queue.tasks.filter((task: Record<string, any>) => task.semanticKind === 'proof_setup')).toEqual([
        expect.objectContaining({ id: 'task-1-proof-setup', status: 'ready', proofForReleaseId: 'release-1', releaseIds: [] }),
        expect.objectContaining({ id: 'task-2-proof-setup', status: 'ready', proofForReleaseId: 'release-1', releaseIds: [] }),
      ])
      const runtime = await readTaskRuntimeStore(tmpDir)
      expect(runtime.tasks['task-1-proof-setup']?.proofRecovery).toBeUndefined()
      expect(runtime.tasks['task-2-proof-setup']?.proofRecovery).toBeUndefined()
      expect(queue.tasks.find((task: Record<string, any>) => task.id === 'task-review')).toMatchObject({
        status: 'spec_review',
      })
    } finally {
      await supervisor.stopAll({ reason: 'test-teardown' }).catch(() => {})
    }
  })

  it('lets a specifically requested shaping task start inside the selected scope', async () => {
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
        recoveryCode: 'spec_no_progress',
        blockReason: 'human_judgment_required: Spec shaping timed out before saving durable progress.',
        description: 'Select and prove the current drafting model lane.',
      },
    ])
    const { supervisor, starts } = createTrackingSupervisor()
    const { app } = buildServeApp({ projectPath: tmpDir, supervisor })
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
      const detailAfterRecovery = await app.fetch(new Request(projectUrl('/api/project/task/task-model-proof')))
      const detailAfterRecoveryBody = await detailAfterRecovery.json() as Record<string, any>
      expect(detailAfterRecoveryBody.decisionFreshness, JSON.stringify(detailAfterRecoveryBody)).toBe('current')
      const queue = await readTaskQueue()
      const task = queue.tasks.find((candidate: Record<string, any>) => candidate.id === 'task-model-proof')
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

  it('resumes checkpointed implementation when compacted state has no open blocker', async () => {
    const now = new Date().toISOString()
    await seedTasks([
      {
        id: 'task-desktop-spike',
        title: 'Prove packaged desktop sidecar',
        status: 'blocked',
        blockReason: 'Historical worker blocker text that no longer has an escalation record.',
        productBrief: {
          userJob: 'Prove the packaged desktop architecture.',
          successMetric: 'The packaged sidecar runs without a separate host runtime.',
          approvedAt: now,
        },
        spec: '## Summary\nBuild and verify the packaged desktop sidecar.',
        acceptanceCriteria: [{
          id: 'AC-1',
          description: 'The packaged sidecar proof passes.',
          verifiedBy: 'pnpm test:desktop-sidecar',
          met: false,
        }],
        taskReadiness: {
          taskKind: 'implementation',
          recommendation: 'ready',
          summary: 'Task is ready for a focused worker pass.',
          dimensions: [],
          definitionOfDone: { items: [], evidenceRequired: [] },
          blockerPlans: [],
          contextBudget: { estimatedTokens: 100, risk: 'low', fitsInOneWorkerBrief: true, reasons: [] },
          assessedAt: now,
        },
        runtime: {
          openEscalationIds: [],
          openIssueIds: [],
        },
      },
    ])
    await writeCheckpoint({
      tasksPath: taskQueuePath(),
      memoryDir,
      taskId: 'task-desktop-spike',
      agentId: 'worker-agent',
      intent: 'Fix the failing packaged-app verification.',
      nextPlannedAction: 'Rerun the declared package command.',
      nextActionKind: 'rerun_verification',
      filesTouched: ['tauri.conf.json'],
    })
    const { supervisor, starts } = createTrackingSupervisor()
    const { app } = buildServeApp({ projectPath: tmpDir, supervisor })
    setProvider('anthropic-api', { apiKey: 'sk-ant-test' })
    updateGlobalConfig({ preferredProvider: 'anthropic-api' })

    try {
      const focusedStart = await app.fetch(
        new Request(projectUrl('/api/project/task/task-desktop-spike/start'), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ mode: 'one_task', scope: 'work_item' }),
        }),
      )

      expect(focusedStart.status).toBe(200)
      await vi.waitFor(() => {
        expect(starts.at(-1)).toMatchObject({
          preferredTaskId: 'task-desktop-spike',
          stopAfterOneTask: true,
        })
      })
      const queue = await readTaskQueue()
      const task = queue.tasks.find((candidate: Record<string, any>) => candidate.id === 'task-desktop-spike')
      expect(task).toMatchObject({ status: 'in_progress', assignedTo: null })
      expect(task?.blockReason).toBeUndefined()
      expect(task?.notes?.at(-1)?.structured).toMatchObject({
        event: 'orphaned_checkpoint_blocker_repaired',
        source: 'focused_task_start',
      })
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
        recoveryCode: 'max_revisions_actionable',
        revisionCount: 4,
        reviewVerdicts: [
          {
            verdict: 'approve',
            reviewerPath: 'llm',
            reason: 'The machine review contract approves the task.',
            acceptedCriteriaIds: [],
            proofEvidenceIds: [],
            reasoning: 'The machine review contract approves the task.',
            recordedAt: new Date().toISOString(),
          },
        ],
      },
    ])
    const effectiveFixture = await readEffectiveTask('author-voice-loop-mvp')
    expect(effectiveFixture.reviewVerdicts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        verdict: 'approve',
        reviewerPath: 'llm',
      }),
    ]))
    const { supervisor, starts } = createTrackingSupervisor()
    const { app } = buildServeApp({ projectPath: tmpDir, supervisor })
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

    const q = await readTaskQueue()
    expect(q.tasks[0].status).toBe('ready')
    expect(q.tasks[0].notes?.at(-1)?.content).toMatch(/ship it/i)
    const thread = readProjectStateDatabaseCurrentThread(tmpDir) as {
      payload: { turns: Array<{ taskId?: string; taskStatus?: string }> }
    } | null
    expect(thread?.payload.turns).toEqual(expect.arrayContaining([
      expect.objectContaining({ taskId: 'task-1', taskStatus: 'ready' }),
    ]))
    expect(JSON.stringify(thread?.payload.turns)).not.toMatch(/needs brief|full product brief/i)
  })

  it('keeps a script-only release spec and links proof setup when it has no concrete command', async () => {
    const now = '2026-07-18T04:00:00.000Z'
    await seedCanonicalQueue({
      version: 1,
      lastUpdated: now,
      selectedReleaseId: 'release-1',
      releases: [{
        id: 'release-1',
        label: 'Headless release',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        proofStyle: 'script_only',
        nodeIds: ['work:task-1'],
      }],
      tasks: [{
        id: 'task-1',
        title: 'Build the bounded runner',
        status: 'spec_review',
        // Visible selected-release membership is normalized on the release
        // node; task definitions do not duplicate it in `releaseIds`.
        structuredSpec: structuredSpecForTest('Build the bounded runner'),
        createdAt: now,
        updatedAt: now,
        spec: [
          '## Summary',
          'Build the bounded runner.',
          '',
          '## Completion Boundary',
          '- Product outcome: The bounded runner produces the expected result.',
          '- What Guildhall can complete in code: Implement the runner.',
          '- External dependencies: None.',
          '- Owner-only setup: None.',
          '- Verification environment: The local project checkout.',
          '- What counts as done: The bounded runner is proven.',
          '- What must be split or blocked: Nothing.',
          '',
          '## Acceptance Criteria',
          '1. The bounded runner produces the expected result.',
        ].join('\n'),
        productBrief: {
          userJob: 'Run the bounded runner.',
          successMetric: 'The runner produces the expected result.',
        },
        acceptanceCriteria: [{
          id: 'AC-1',
          description: 'The bounded runner produces the expected result.',
          verifiedBy: 'review',
          met: false,
        }],
      }],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/approve-spec'), { method: 'POST' }),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, status: 'ready' })
    const queue = await readTaskQueue()
    expect(queue.tasks[0]).toMatchObject({ status: 'ready' })
    expect(queue.tasks[0]?.spec).toContain('Build the bounded runner.')
    expect(queue.tasks).toHaveLength(2)
    expect(queue.tasks[1]).toMatchObject({
      title: 'Establish concrete proof for Build the bounded runner',
      status: 'ready',
      workKind: 'verification',
      hierarchy: { parentId: 'task-1' },
      proofForReleaseId: 'release-1',
      releaseIds: [],
    })
    expect(queue.tasks[0]?.notes?.at(-1)?.content).toMatch(/linked verification work/i)
  })

  it('rejects approve-spec when the completion boundary is missing', async () => {
    await seedTask('task-1', {
      status: 'spec_review',
      productBrief: {
        userJob: 'I want users to sign in with familiar providers.',
        successMetric: 'Login shows provider buttons.',
        approvedAt: '2026-05-26T00:00:00.000Z',
      },
      structuredSpec: undefined,
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
    expect(body.error).toMatch(/structured spec/i)
  })

  it('rejects approve-spec when external dependencies are named without an owner or blocked split', async () => {
    await seedTask('task-1', {
      status: 'spec_review',
      productBrief: {
        userJob: 'I want users to sign in with familiar providers.',
        successMetric: 'Google and Apple sign-in work.',
        approvedAt: '2026-05-26T00:00:00.000Z',
      },
      structuredSpec: structuredSpecForTest('Add provider sign-in', {
        externalDependencies: 'Google and Apple OAuth apps and Supabase provider settings.',
        ownerOnlySetup: 'TBD.',
        verificationEnvironment: 'TBD.',
      }),
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
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.status).toBe('ready')
  })

  it('approves a spec when its external provider is already configured and live', async () => {
    await seedTask('task-1', {
      status: 'spec_review',
      productBrief: {
        userJob: 'I want to verify the configured drafting provider across representative genres.',
        successMetric: 'The live provider generates a labeled result for every declared genre.',
      },
      structuredSpec: structuredSpecForTest('Run the bounded multi-genre provider proof', {
        externalDependencies: 'Configured DeepInfra provider (already set up).',
        ownerOnlySetup: 'None.',
        verificationEnvironment: 'Local development environment with access to the configured DeepInfra provider.',
      }),
      spec: [
        '## Summary',
        '',
        'Run the bounded multi-genre provider proof.',
        '',
        '## Completion Boundary',
        '- Product outcome: The configured provider generates a labeled result for every declared genre.',
        '- What Guildhall can complete in code: Add and run the bounded proof script.',
        '- External dependencies: Configured DeepInfra provider (already set up).',
        '- Owner-only setup: None.',
        '- Verification environment: Local development environment with access to the configured DeepInfra provider.',
        '- What counts as done: The live provider call succeeds for every declared genre.',
        '- What must be split or blocked: None.',
        '',
        '## Acceptance Criteria',
        '1. The live provider call succeeds for every declared genre.',
      ].join('\n'),
      acceptanceCriteria: [
        {
          id: 'AC-1',
          description: 'The live provider call succeeds for every declared genre.',
          verifiedBy: 'automated',
          met: false,
        },
      ],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/approve-spec'), { method: 'POST' }),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, status: 'ready' })
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
        body: JSON.stringify({ stage: 'spec', actor: 'codex_delegated_owner' }),
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.ok).toBe(true)
    expect(body.status).toBe('exploring')

    const raw = await readTaskQueue()
    expect(raw.tasks[0]?.status).toBe('exploring')
    expect(raw.tasks[0]?.spec).toBeUndefined()
    expect(raw.tasks[0]?.acceptanceCriteria).toEqual([])
    expect(raw.tasks[0]?.productBrief).toBeUndefined()
    expect(raw.tasks[0]?.notes?.at(-1)?.content).toMatch(/fresh spec pass/i)
    expect(raw.tasks[0]?.notes?.at(-1)).toMatchObject({
      agentId: 'codex_delegated_owner',
      role: 'codex_delegated_owner',
      structured: { source: 'codex_delegated_owner' },
    })
    const transcript = (await readExploringTranscript({ memoryDir, taskId: 'task-1' })).content ?? ''
    expect(transcript).toMatch(/fresh spec pass/i)
    expect(transcript).toMatch(/earlier spec approval.*superseded/i)
  })

  it('records explicit proof re-intake guidance and clears the old executable plan', async () => {
    await seedTask('task-1', {
      status: 'ready',
      spec: 'Invented proof command',
      proofPaths: [{ command: 'pnpm proof:evaluation', kind: 'command' }],
      acceptanceCriteria: ['Run the invented command'],
      productBrief: {
        userJob: 'Run the release proof.',
        successMetric: 'The proof produces durable evidence.',
      },
      notes: [],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const reason = 'The saved command is not grounded in visible project evidence.'
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/rerun-stage'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ stage: 'spec', recoveryReason: reason, recoveryKind: 'proof' }),
      }),
    )
    expect(res.status).toBe(200)

    const raw = await readTaskQueue()
    expect(raw.tasks[0]?.status).toBe('exploring')
    expect(raw.tasks[0]?.spec).toBeUndefined()
    expect(raw.tasks[0]?.proofPaths).toBeUndefined()
    expect(raw.tasks[0]?.acceptanceCriteria).toEqual([])
    expect(raw.tasks[0]?.productBrief).toBeUndefined()
    expect(raw.tasks[0]?.notes?.at(-1)?.content).toMatch(/fresh spec pass/i)
    const runtime = (await readTaskRuntimeStore(tmpDir)).tasks['task-1']
    expect(runtime?.proofRecovery).toMatchObject({ reason })
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

    const raw = await readTaskQueue()
    const parent = raw.tasks.find((task: Record<string, any>) => task.id === 'task-1')
    const staleChild = raw.tasks.find((task: Record<string, any>) => task.id === 'task-1-split-duplicate')
    const activeChild = raw.tasks.find((task: Record<string, any>) => task.id === 'task-1-active-child')
    expect(parent?.status).toBe('exploring')
    expect(parent?.assignedTo).toBeNull()
    const evidence = await readTaskEvidence(tmpDir, 'task-1', { kind: 'note' })
    expect(findLastMatching(evidence, event => String((event.payload as Record<string, unknown>)?.content).match(/fresh spec pass/i) !== null)).toBeTruthy()
    expect(staleChild?.hierarchy?.parentId).toBeUndefined()
    expect(activeChild?.hierarchy?.parentId).toBe('task-1')
  })

  it('supersedes the live completion summary when reopening done work', async () => {
    await seedTask('task-1', {
      status: 'done',
      spec: 'Stale spec',
      completedAt: '2026-06-01T00:00:00.000Z',
      doneSummaryBundle: {
        taskId: 'task-1',
        status: 'done',
        completedAt: '2026-06-01T00:00:00.000Z',
        summary: {
          journey: 'The old pass completed.',
          decision: 'The task was marked done.',
          evidence: 'The old proof passed.',
          learningCandidates: [],
          openResidue: 'A fresh pass may still be needed.',
        },
        retention: {
          transcriptPrimaryArtifact: false,
          compactedFullTranscript: false,
          fullEvidenceAvailable: true,
        },
        evidenceRefs: [],
        createdAt: '2026-06-01T00:00:00.000Z',
        createdBy: 'test',
      },
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

    const raw = await readTaskQueue()
    expect(raw.tasks[0]?.status).toBe('exploring')
    expect(raw.tasks[0]?.completedAt).toBeUndefined()
    expect(raw.tasks[0]?.doneSummaryBundle).toMatchObject({
      status: 'reopened',
      reopenReason: expect.stringMatching(/fresh spec pass/i),
      createdBy: 'rerun-stage',
    })
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
    const raw = await readTaskQueue()
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
    const raw = await readTaskQueue()
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
    const raw = await readTaskQueue()
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
            identity: 'billing-settings-workflow',
            title: 'Implement the billing settings workflow',
            reason: 'Keep the user-facing workflow small enough for UX review.',
            suggestedDomain: 'frontend',
            dependsOn: [],
          },
          {
            title: 'Add the admin subscription API contract',
            reason: 'Separate API compatibility and security review from UI work.',
            suggestedDomain: 'backend',
            identity: 'admin-subscription-api-contract',
            dependsOn: ['billing-settings-workflow'],
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
      'task-1-split-billing-settings-workflow',
      'task-1-split-admin-subscription-api-contract',
    ])
    expect(body.parentTaskId).toBe('task-1')

    const raw = await readTaskQueue()
    expect(raw.tasks).toHaveLength(3)
    expect(raw.tasks[0].status).toBe('ready')
    expect(raw.tasks[0].hierarchy.childIds).toEqual(body.createdTaskIds)
    expect(raw.tasks[0].taskReadiness.recommendation).toBe('ready')
    expect(raw.tasks[0].taskReadiness.summary).toContain('continue through the child tasks')
    expect(raw.tasks[0].sizePlan.action).toBe('proceed_with_warning')
    expect(raw.tasks[0].sizePlan.recommendedChildren.map((child: Record<string, unknown>) => child.createdTaskId)).toEqual(body.createdTaskIds)
    expect(raw.tasks[1]).toMatchObject({
      id: 'task-1-split-billing-settings-workflow',
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
    expect(raw.tasks[2].dependsOn).toEqual(['task-1-split-billing-settings-workflow'])
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
            identity: 'component-implementation',
            title: 'Component implementation',
            reason: 'Ship the primitive implementation first.',
            suggestedDomain: 'frontend',
            dependsOn: [],
          },
          {
            title: 'Storybook story',
            reason: 'Add visual proof after the implementation exists.',
            suggestedDomain: 'frontend',
            identity: 'storybook-proof',
            dependsOn: ['component-implementation'],
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
      'task-1-split-storybook-proof',
    ])

    const raw = await readTaskQueue()
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
    const raw = await readTaskQueue()
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
            identity: 'menu-item-implementation',
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
            identity: 'storybook-proof',
            dependsOn: ['menu-item-implementation'],
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

    const raw = await readTaskQueue()
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
    expect(raw.tasks[2].dependsOn).toEqual(['task-1-split-menu-item-implementation'])
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

  it('rejects an invalid revision target without mutating the task', async () => {
    await seedTask('task-1', { status: 'spec_review', spec: 'Keep this spec.' })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/resume'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message: 'Revise the document.',
          revisionTarget: 'acceptance-criteria',
        }),
      }),
    )

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({
      error: 'revisionTarget must be "brief" or "spec".',
    })
    const queue = await readTaskQueue() as { tasks: Array<Record<string, any>> }
    expect(queue.tasks[0]).toMatchObject({ status: 'spec_review', spec: 'Keep this spec.' })
    const transcript = await readExploringTranscript({ memoryDir, taskId: 'task-1' })
    expect(transcript.content ?? '').not.toContain('Revise the document.')
  })

  it('reopens a rejected brief for revision instead of returning to the same approval gate', async () => {
    await seedTask('task-1', {
      status: 'exploring',
      productBrief: {
        userJob: 'Build the desktop spike with Vue.',
        whyItMattersNow: 'Prove packaging first.',
        successMetric: 'A packaged app launches.',
        nonGoals: [],
        antiPatterns: ['Do not widen the architecture spike.'],
        authoredBy: 'spec-agent',
        authoredAt: '2026-08-08T00:00:00.000Z',
      },
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/resume'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message: 'Keep the spike framework-neutral.',
          revisionTarget: 'brief',
        }),
      }),
    )

    expect(res.status).toBe(200)
    const queue = await readTaskQueue() as { tasks: Array<Record<string, any>> }
    expect(queue.tasks[0]!.status).toBe('exploring')
    expect(queue.tasks[0]!.productBrief).toBeUndefined()
    const thread = readProjectStateDatabaseCurrentThread(tmpDir) as {
      payload: { turns: unknown[] }
    } | null
    expect(thread?.payload.turns).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'brief_approval', taskId: 'task-1' }),
    ]))
  })

  it('reopens a rejected spec without leaving its approval turn authoritative', async () => {
    await seedTask('task-1', {
      status: 'spec_review',
      productBrief: {
        userJob: 'Prove a framework-neutral desktop sidecar.',
        whyItMattersNow: 'The architecture must be proven before UI work.',
        successMetric: 'A packaged app runs one offline fixture.',
        nonGoals: ['Do not build the full UI.'],
        antiPatterns: [],
        authoredBy: 'spec-agent',
        authoredAt: '2026-08-08T00:00:00.000Z',
      },
      spec: '## What this is\nAn incomplete spike.\n\n## Completion Boundary\n- Product outcome: prove packaging.',
      acceptanceCriteria: [{ id: 'ac-old', description: 'Old proof', verifiedBy: 'review', met: false }],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/resume'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message: 'Add exact packaged-app proof before approval.',
          revisionTarget: 'spec',
        }),
      }),
    )

    expect(res.status).toBe(200)
    const queue = await readTaskQueue() as { tasks: Array<Record<string, any>> }
    expect(queue.tasks[0]).toMatchObject({
      status: 'exploring',
      productBrief: { userJob: 'Prove a framework-neutral desktop sidecar.' },
      acceptanceCriteria: [],
    })
    expect(queue.tasks[0]!.spec).toBeUndefined()
    const thread = readProjectStateDatabaseCurrentThread(tmpDir) as {
      payload: { turns: unknown[] }
    } | null
    expect(thread?.payload.turns).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'spec_review', taskId: 'task-1' }),
    ]))
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
    const queue = await readTaskQueue() as { tasks: Array<Record<string, any>> }
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
    const queue = await readTaskQueue() as { tasks: Array<Record<string, any>> }
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

  it('does not mistake an unimplemented ready task for completed proof recovery', async () => {
    await seedTask('task-1', {
      status: 'ready',
      assignedTo: null,
      notes: [],
      spec: '## Completion Boundary\nBuild the bounded desktop spike before running its proof.',
      acceptanceCriteria: [{
        id: 'ac-1',
        description: 'The project typechecks after the desktop spike is implemented.',
        verifiedBy: 'automated',
        command: 'pnpm typecheck',
        met: false,
      }],
      proofPaths: [{
        id: 'task-1-ac-1-command-proof',
        kind: 'command',
        source: 'documented',
        command: 'pnpm typecheck',
        status: 'planned',
        expectedEvidence: [{
          id: 'ac-1',
          kind: 'automated',
          description: 'The project typechecks after the desktop spike is implemented.',
          required: true,
        }],
        verificationRecords: [],
      }],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/retry-work'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ instruction: 'Implement the approved desktop spike.' }),
      }),
    )
    const body = (await res.json()) as Record<string, any>
    expect(res.status, JSON.stringify(body)).toBe(200)
    expect(body).toMatchObject({ ok: true, status: 'in_progress' })

    const effective = await readEffectiveTask('task-1')
    expect(effective.runtime?.proofRecovery).toBeUndefined()
    const queue = await readTaskQueue()
    const noteText = queue.tasks[0]?.notes
      .map((note: Record<string, unknown>) => String(note.content ?? ''))
      .join('\n') ?? ''
    expect(noteText).toContain('Retry partial worker pass')
    expect(noteText).not.toContain('missing release proof')
  })

  it('reopens in-progress work for blueprint shaping instead of resuming a worker', async () => {
    await seedTask('task-1', {
      status: 'in_progress',
      assignedTo: null,
      spec: undefined,
      acceptanceCriteria: [],
      notes: [],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/retry-work'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ instruction: 'Continue from the visible project sources.' }),
      }),
    )
    const body = (await res.json()) as Record<string, any>
    expect(res.status, JSON.stringify(body)).toBe(200)
    expect(body).toMatchObject({
      ok: true,
      status: 'exploring',
      nextAction: 'source_backed_spec',
    })
    const queue = await readTaskQueue() as { tasks: Array<Record<string, any>> }
    expect(queue.tasks[0]).toMatchObject({
      status: 'exploring',
      assignedTo: null,
    })
    expect(queue.tasks[0]?.spec).toBeUndefined()
    expect(queue.tasks[0]?.acceptanceCriteria).toEqual([])
    const effective = await readEffectiveTask('task-1')
    expect(effective.doneSummaryBundle?.status).not.toBe('done')
    expect(effective.runtime?.currentLifecycle).toMatchObject({
      status: 'exploring',
      source: 'rerun_spec',
    })
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
    const queue = await readTaskQueue() as { tasks: Array<Record<string, any>> }
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
          {
            id: 'provider-proof',
            kind: 'provider',
            description: 'DeepInfra drafting telemetry recorded refusal behavior, cost, latency, and voice preservation.',
            required: true,
          },
        ],
        verificationRecords: [],
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

  it('resumes a done proof-setup boundary without creating another proof child', async () => {
    await seedTask('task-proof-setup', {
      status: 'ready',
      semanticKind: 'proof_setup',
      taskKind: 'verification',
      spec: '## Completion Boundary\nThe exact command must pass.',
      acceptanceCriteria: [{
        id: 'ac-1',
        description: 'The exact proof command passes.',
        verifiedBy: 'automated',
        command: 'pnpm exec vitest run src/example.test.ts',
        expectedOutputIncludes: ['guildhall-proof:task-proof-setup'],
        met: false,
      }],
      proofPaths: [{
        id: 'task-proof-setup-ac-1-command-proof',
        kind: 'command',
        source: 'documented',
        command: 'pnpm exec vitest run src/example.test.ts',
        status: 'planned',
        expectedEvidence: [{
          id: 'ac-1',
          kind: 'automated',
          description: 'The exact proof command passes.',
          required: true,
        }],
        verificationRecords: [],
      }],
    })
    const promoted = writePromotedTaskDetailMutation(taskQueuePath(), 'task-proof-setup', {
      projectId,
      projectRoot: tmpDir,
      mutate: current => ({
        ...current,
        status: 'done',
        completedAt: '2026-07-21T21:00:00.000Z',
        updatedAt: '2026-07-21T21:00:00.000Z',
      }),
    })
    expect(promoted).toMatchObject({ task: { status: 'done' } })
    // The installed app runs required migrations before serving actions. Keep
    // that lifecycle boundary in the flow test without asserting a particular
    // migration ledger detail here.
    await applyCanonicalMigrations()

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-proof-setup/retry-work'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ instruction: 'Run the current task-specific proof command.' }),
      }),
    )
    const body = (await res.json()) as Record<string, any>
    expect(res.status, JSON.stringify(body)).toBe(200)
    expect(body).toMatchObject({ ok: true, status: 'in_progress' })

    const queue = await readTaskQueue()
    expect(queue.tasks).toHaveLength(1)
    expect(queue.tasks[0]).toMatchObject({
      id: 'task-proof-setup',
      status: 'in_progress',
    })
    expect(queue.tasks[0]?.notes.at(-1)?.content).toContain('current task-specific proof command')
    expect((await readEffectiveTask('task-proof-setup')).runtime?.proofRecovery?.kind).toBe('proof')
  })

  it('reopens a blocked proof-setup boundary inside an active script release', async () => {
    const now = '2026-07-20T20:00:00.000Z'
    await seedCanonicalQueue({
      version: 1,
      lastUpdated: now,
      selectedReleaseId: 'release-1',
      releases: [{
        id: 'release-1',
        label: 'Headless MVP',
        kind: 'release',
        state: 'active',
        proofStyle: 'script_only',
      }],
      tasks: [{
        id: 'task-proof-setup',
        title: 'Establish the exact proof command',
        status: 'blocked',
        semanticKind: 'proof_setup',
        taskKind: 'verification',
        releaseIds: ['release-1'],
        acceptanceCriteria: [{
          id: 'ac-1',
          description: 'The task-specific proof command is recorded and passes.',
          verifiedBy: 'review',
          met: false,
        }],
        createdAt: now,
        updatedAt: now,
        blockReason: 'The previous handoff was invalid.',
      }],
    })

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-proof-setup/retry-work'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ instruction: 'Run the exact task-specific proof command.' }),
      }),
    )
    const body = (await res.json()) as Record<string, any>
    expect(res.status, JSON.stringify(body)).toBe(200)
    expect(body).toMatchObject({ ok: true, status: 'in_progress' })
    expect(body.proofSetupTaskId).toBeUndefined()

    const queue = await readTaskQueue()
    expect(queue.tasks).toHaveLength(1)
    expect(queue.tasks[0]).toMatchObject({
      id: 'task-proof-setup',
      status: 'in_progress',
      semanticKind: 'proof_setup',
      assignedTo: 'worker-agent',
    })
  })

  it('creates release-local proof work instead of reopening a shipped task', async () => {
    const now = '2026-07-20T20:00:00.000Z'
    await seedCanonicalQueue({
      version: 1,
      lastUpdated: now,
      selectedReleaseId: 'release-next',
      releases: [
        {
          id: 'release-shipped',
          label: 'Shipped foundation',
          kind: 'release',
          state: 'shipped',
          proofStyle: 'script_only',
          nodeIds: ['work:task-1'],
          deferredNodeIds: [],
        },
        {
          id: 'release-next',
          label: 'Follow-up proof',
          kind: 'release',
          state: 'active',
          proofStyle: 'script_only',
          nodeIds: ['work:task-1'],
          deferredNodeIds: [],
        },
      ],
      tasks: [{
        id: 'task-1',
        title: 'Completed implementation',
        description: 'The implementation shipped, but the follow-up release needs an executable proof contract.',
        domain: 'runtime',
        projectPath: tmpDir,
        status: 'done',
        releaseIds: ['release-shipped', 'release-next'],
        proofPaths: [{
          kind: 'review',
          expectedEvidence: [{ id: 'script-proof', kind: 'command', description: 'A task-specific script proof passes.', required: true }],
          verificationRecords: [],
        }],
        createdAt: now,
        updatedAt: now,
        completedAt: now,
      }],
    })

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/retry-work'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ instruction: 'Establish the proof for the selected follow-up release.' }),
      }),
    )
    const body = await res.json() as Record<string, any>
    expect(res.status, JSON.stringify(body)).toBe(200)
    expect(body).toMatchObject({ ok: true, status: 'exploring', nextAction: 'source_backed_spec' })
    expect(body.proofSetupTaskId).toBe('task-1-proof-setup')

    const queue = await readTaskQueue()
    expect(queue.tasks.find((task: Record<string, any>) => task.id === 'task-1')).toMatchObject({
      status: 'done',
      releaseIds: expect.arrayContaining(['release-shipped', 'release-next']),
    })
    expect(queue.tasks.find((task: Record<string, any>) => task.id === 'task-1-proof-setup')).toMatchObject({
      status: 'ready',
      releaseIds: [],
      proofForReleaseId: 'release-next',
      hierarchy: { parentId: 'task-1', relation: 'decomposes' },
    })

    const database = new DatabaseSync(projectStateDatabasePath(tmpDir))
    const memberships = database.prepare(
      'SELECT release_id, task_id FROM release_membership ORDER BY release_id, task_id',
    ).all()
    database.close()
    expect(memberships).toEqual([
      { release_id: 'release-next', task_id: 'task-1' },
      { release_id: 'release-shipped', task_id: 'task-1' },
    ])
  })

  it('materializes linked proof work for completed active-release work when no executable proof is recorded', async () => {
    const now = '2026-07-18T04:00:00.000Z'
    await seedCanonicalQueue({
      version: 1,
      lastUpdated: now,
      selectedReleaseId: 'release-1',
      releases: [{
        id: 'release-1',
        label: 'Headless MVP',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        proofStyle: 'script_only',
      }],
      tasks: [{
        id: 'task-1',
        title: 'Run headless proof',
        status: 'done',
        releaseIds: ['release-1'],
        completedAt: now,
        updatedAt: now,
        createdAt: now,
        acceptanceCriteria: [{
          id: 'AC-1',
          description: 'The implementation is covered by a current project proof.',
          verifiedBy: 'review',
          met: true,
        }],
        proofPaths: [{
          kind: 'review',
          source: 'inferred',
          status: 'verified',
          expectedEvidence: [{
            id: 'legacy-review-proof',
            kind: 'manual',
            description: 'An old review note says the implementation is coherent.',
            required: true,
          }],
          verificationRecords: [{
            id: 'legacy-review-proof-record',
            evidenceId: 'legacy-review-proof',
            kind: 'manual',
            status: 'passed',
            summary: 'Approved review verified from historical audit text.',
            recordedAt: now,
            recordedBy: 'legacy-import',
            evidenceRefs: [],
          }],
        }],
        gateResults: [{
          gateId: 'review-backed-gate',
          passed: true,
          output: 'review proof passed',
          checkedAt: now,
        }],
        reviewVerdicts: [{
          verdict: 'approve',
          reasoning: 'The implementation is coherent.',
          recordedAt: now,
        }],
      }],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/retry-work'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ instruction: 'Attach the executable release proof.' }),
      }),
    )
    const body = (await res.json()) as Record<string, any>
    expect(res.status, JSON.stringify(body)).toBe(200)
    expect(body).toMatchObject({ ok: true, status: 'exploring', nextAction: 'source_backed_spec' })
    expect(body.proofSetupTaskId).toBe('task-1-proof-setup')
    const queue = await readTaskQueue()
    expect(queue.tasks.find((task: Record<string, any>) => task.id === 'task-1')).toMatchObject({
      status: 'done',
      releaseIds: ['release-1'],
    })
    expect(queue.tasks.find((task: Record<string, any>) => task.id === 'task-1-proof-setup')).toMatchObject({
      status: 'ready',
      releaseIds: [],
      proofForReleaseId: 'release-1',
      hierarchy: { parentId: 'task-1', relation: 'decomposes' },
    })
  })

  it('does not reopen stale raw retries when effective completion proof already settled the task', async () => {
    await seedTask('task-1', {
      status: 'in_progress',
      assignedTo: 'worker-agent',
      completedAt: '2026-07-06T20:00:00.000Z',
      notes: [],
      proofPaths: [{
        kind: 'review',
        status: 'verified',
        source: 'documented',
        expectedEvidence: [
          {
            id: 'provider-proof',
            kind: 'provider',
            description: 'DeepInfra drafting telemetry recorded refusal behavior, cost, latency, and voice preservation.',
            required: true,
          },
        ],
        verificationRecords: [{
          id: 'provider-proof-record',
          evidenceId: 'provider-proof',
          kind: 'provider',
          status: 'passed',
          summary: 'Provider proof was recorded.',
          recordedAt: '2026-07-06T20:00:00.000Z',
          recordedBy: 'test',
          evidenceRefs: [],
        }],
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

    const cachedBeforeRes = await app.fetch(new Request(projectUrl('/api/project/task/task-1')))
    expect(cachedBeforeRes.status).toBe(200)
    const cachedBeforeBody = (await cachedBeforeRes.json()) as Record<string, any>
    expect(cachedBeforeBody.task?.status).toBe('import_draft')

    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/shape-draft'), {
        method: 'POST',
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.status).toBe('exploring')
    const queue = await readTaskQueue() as { tasks: Array<Record<string, any>> }
    expect(queue.tasks[0]!.status).toBe('exploring')
    expect(queue.tasks[0]!.assignedTo).toBeNull()
    expect(queue.tasks[0]!.blockReason).toBeUndefined()
    expect(queue.tasks[0]!.worktreePath).toBeUndefined()
    expect(queue.tasks[0]!.branchName).toBeUndefined()
    expect(queue.tasks[0]!.notes?.at(-1)?.role).toBe('shaping-request')
    const runtimeStore = await readTaskRuntimeStore(tmpDir)
    const workspaceStore = await readTaskWorkspaceStore(tmpDir)
    expect(runtimeStore.tasks['task-1']).toMatchObject({ assignedTo: null })
    expect(workspaceStore.workspaces['task-1']).toMatchObject({ taskId: 'task-1' })
    expect(workspaceStore.workspaces['task-1']).not.toHaveProperty('worktreePath')
    expect(workspaceStore.workspaces['task-1']).not.toHaveProperty('branchName')
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
    expect(detailBody.task?.runtime).toEqual(expect.objectContaining({ assignedTo: null }))
    expect(detailBody.task?.workspace).toMatchObject({ taskId: 'task-1' })
    expect(detailBody.task?.workspace).not.toHaveProperty('worktreePath')
    expect(detailBody.task?.workspace).not.toHaveProperty('branchName')

    const workRes = await app.fetch(new Request(projectUrl('/api/project?surface=work')))
    expect(workRes.status).toBe(200)
    const workBody = (await workRes.json()) as Record<string, any>
    expect(workBody.tasks.find((task: Record<string, any>) => task.id === 'task-1')?.status).toBe('exploring')
  })

  it('does not repair stale worker overlays while reading imported shaping work', async () => {
    const staleProjectPath = path.join(tmpDir, 'docs', 'harness')
    await seedTask('task-1', {
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
      projectPath: staleProjectPath,
      assignedTo: 'worker-agent',
    })
    expect(projectBody.tasks.find((task: Record<string, any>) => task.id === 'task-1')?.blockReason).toBe('Old implementation blocker should not survive imported draft shaping.')
    expect(projectBody.tasks.find((task: Record<string, any>) => task.id === 'task-1')?.workspace).toBeUndefined()

    const queue = await readTaskQueue()
    const current = readProjectStateDatabaseTaskPointWithRevision(taskQueuePath(), 'task-1')
    expect(current?.task.definition).toMatchObject({
      projectPath: staleProjectPath,
    })
    expect(queue.tasks[0]?.assignedTo).toBe('worker-agent')
    expect(queue.tasks[0].blockReason).toBe('Old implementation blocker should not survive imported draft shaping.')
    expect(queue.tasks[0].worktreePath).toContain('.guildhall/worktrees/task-1')
    expect(queue.tasks[0].branchName).toBe('guildhall/task-task-1')
    expect(queue.tasks[0].notes.some((note: { role?: string }) => note.role === 'state-repair')).toBe(false)

    const runtimeStore = await readTaskRuntimeStore(tmpDir)
    const workspaceStore = await readTaskWorkspaceStore(tmpDir)
    expect(runtimeStore.tasks['task-1']).toMatchObject({ assignedTo: 'worker-agent' })
    expect(workspaceStore.workspaces['task-1']).toMatchObject({ branchName: 'guildhall/task-task-1' })
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
    const queue = await readTaskQueue() as { tasks: Array<Record<string, any>> }
    expect(queue.tasks[0]!.status).toBe('exploring')
    expect(queue.tasks[0]!.notes.filter((note: Record<string, unknown>) => note.role === 'shaping-request')).toHaveLength(1)
    const transcript = (await readExploringTranscript({ memoryDir, taskId: 'task-1' })).content ?? ''
    expect(transcript).toMatch(/Imported draft context/)
    expect(transcript).toMatch(/author can shape how much intervention/i)
  })

  it('shelves an imported draft immediately when it is an obvious duplicate of finished work', async () => {
    const now = new Date().toISOString()
    await seedCanonicalQueue({
      version: 1,
      lastUpdated: now,
      tasks: [
      {
        id: 'task-done',
        sourceIdentity: 'knit:e2e-login-create-edit-search',
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
        sourceIdentity: 'knit:e2e-login-create-edit-search',
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

    const queue = await readTaskQueue() as { tasks: Array<Record<string, any>> }
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

  it('reopens completed work when a provider fallback erased substantive reviewer feedback', async () => {
    await seedTask('task-1', {
      status: 'done',
      notes: [],
      reviewVerdicts: [
        {
          verdict: 'approve',
          reviewerPath: 'llm',
          reason: 'Initial review passed.',
          recordedAt: '2026-07-18T04:17:58.507Z',
        },
        {
          verdict: 'revise',
          reviewerPath: 'llm',
          reason: 'The reviewer found concrete implementation bugs.',
          reasoning: 'The implementation has a syntax error and emits findings with an empty character.',
          recordedAt: '2026-07-18T04:20:54.206Z',
        },
        {
          verdict: 'approve',
          reviewerPath: 'deterministic',
          reason: 'Deterministic fallback approval.',
          llmError: 'reviewer-agent timed out after 60000ms of inactivity',
          recordedAt: '2026-07-18T04:28:59.233Z',
        },
      ],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/retry-work'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ instruction: 'Fix the concrete reviewer findings and run the focused proof.' }),
      }),
    )
    const body = (await res.json()) as Record<string, any>
    expect(res.status, JSON.stringify(body)).toBe(200)
    expect(body).toMatchObject({ ok: true, status: 'in_progress' })
    const queue = await readTaskQueue()
    expect(queue.tasks[0]).toMatchObject({ status: 'in_progress', assignedTo: null })
    const noteText = queue.tasks[0]?.notes.map((note: Record<string, unknown>) => String(note.content ?? '')).join('\n') ?? ''
    expect(noteText).toContain('reviewer feedback was lost')
    expect(noteText).toContain('Fix the concrete reviewer findings')
  })
})

describe('POST /api/project/task/:id/reframe-task', () => {
  it('reopens an inscrutable blocked task for a fresh plain-language frame', async () => {
    await seedTask('task-1', {
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
      taskReadiness: {
        taskKind: 'research',
        recommendation: 'ready',
        summary: 'Stale readiness from the old frame.',
        dimensions: [],
        definitionOfDone: { items: [], evidenceRequired: [] },
        blockerPlans: [],
        contextBudget: { estimatedTokens: 100, risk: 'low', fitsInOneWorkerBrief: true, reasons: [] },
        assessedAt: new Date().toISOString(),
      },
      workUnitAnalysis: {
        summary: 'Stale split decision.',
        units: [],
        proofOnlyItems: [],
        createdAt: new Date().toISOString(),
      },
      sizePlan: {
        taskId: 'task-1',
        score: 1,
        band: 'tiny',
        action: 'proceed',
        factors: [],
        recommendedChildren: [],
        reasons: ['Stale sizing decision.'],
        createdAt: new Date().toISOString(),
        createdBy: 'test',
      },
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

    const queue = await readTaskQueue() as { tasks: Array<Record<string, any>> }
    const task = queue.tasks[0]!
    expect(task.status).toBe('exploring')
    expect(task.assignedTo).toBe('spec-agent')
    expect(task.blockReason).toBeUndefined()
    expect(task.productBrief).toBeUndefined()
    expect(task.spec).toBeUndefined()
    expect(task.acceptanceCriteria).toEqual([])
    expect(task.taskReadiness).toBeUndefined()
    expect(task.workUnitAnalysis).toBeUndefined()
    expect(task.sizePlan).toBeUndefined()
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
    const evidence = await readTaskEvidence(tmpDir, 'task-1', { kind: 'note' })
    expect(evidence.some(event => String((event.payload as Record<string, unknown>)?.content ?? '').includes('Cleared an active agent claim with no durable worker checkpoint'))).toBe(true)
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

    const raw = await readTaskQueue() as { tasks: Array<Record<string, any>> }
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
    await seedTask('task-1', {
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

    const queue = await readTaskQueue() as { tasks: Array<Record<string, any>> }
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

    const queue = await readTaskQueue() as { tasks: Array<Record<string, any>> }
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
        whyItMattersNow: 'The initial flow needs an explicit value boundary.',
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

    const q = await readTaskQueue()
    expect(q.tasks[0].productBrief.approvedBy).toBe('human')
    expect(q.tasks[0].productBrief.approvedAt).toMatch(/\d{4}-\d{2}-\d{2}T/)
    // User job + success metric are unchanged by approval.
    expect(q.tasks[0].productBrief.userJob).toMatch(/new user/)
  })

  it('records an explicitly delegated Codex owner approval without treating it as autonomous approval', async () => {
    await seedTask('task-1', {
      status: 'exploring',
      productBrief: {
        userJob: 'As an owner I want to approve this bounded brief through my delegated Codex run.',
        successMetric: 'The task can proceed with a durable, truthful approval record.',
        nonGoals: ['Do not let Guildhall approve its own work.'],
        authoredBy: 'agent:spec-agent',
        authoredAt: new Date().toISOString(),
      },
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/approve-brief'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ approvalActor: 'codex_delegated_owner' }),
      }),
    )

    expect(res.status).toBe(200)
    const q = await readTaskQueue()
    expect(q.tasks[0].productBrief.approvedBy).toBe('codex_delegated_owner')
    expect(q.tasks[0].productBrief.approvedAt).toMatch(/\d{4}-\d{2}-\d{2}T/)
    expect(q.tasks[0].notes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        agentId: 'codex:delegated-owner',
        content: expect.stringContaining('Guildhall did not approve this brief autonomously.'),
      }),
    ]))
  })

  it('promotes an exploring task back to spec_review when the brief is approved after a concrete spec draft already exists', async () => {
    await seedTask('task-1', {
      status: 'exploring',
      spec: '## Summary\n\nDraft spec.\n\n## Acceptance Criteria\n\n1. Works.',
      acceptanceCriteria: [
        { id: 'ac-1', description: 'Works.', verifiedBy: 'review', met: false },
      ],
      productBrief: {
        userJob: 'As a new user I want to X so Y',
        whyItMattersNow: 'The concrete spec needs an owner-approved scope boundary.',
        successMetric: 'Time-to-first-success drops below 60s',
        nonGoals: ['Do not broaden the concrete spec during approval.'],
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

    const q = await readTaskQueue()
    expect(q.tasks[0].status).toBe('spec_review')
  })

  it('passes an explicitly delegated Codex owner actor through spec approval', async () => {
    await seedTask('task-1', {
      status: 'spec_review',
      structuredSpec: structuredSpecForTest('Delegated spec approval'),
      productBrief: {
        userJob: 'Approve a bounded spec through the delegated Codex run.',
        successMetric: 'The task advances with the correct approval actor.',
        nonGoals: ['Do not let automation approve the spec.'],
        authoredBy: 'project-reintake',
        authoredAt: new Date().toISOString(),
      },
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/task/task-1/approve-spec'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ approvalActor: 'codex_delegated_owner' }),
    }))

    expect(res.status).toBe(200)
    const q = await readTaskQueue()
    expect(q.tasks[0].status).toBe('ready')
    expect(q.tasks[0].productBrief.approvedBy).toBe('codex_delegated_owner')
  })

  it('keeps an approved brief in source-backed shaping when no concrete spec exists yet', async () => {
    await seedTask('task-1', {
      status: 'exploring',
      spec: undefined,
      acceptanceCriteria: [],
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
    expect(body).toMatchObject({ ok: true, status: 'exploring' })

    const q = await readTaskQueue()
    expect(q.tasks[0].status).toBe('exploring')
    expect(q.tasks[0].productBrief.approvedBy).toBe('human')
    expect(q.tasks[0].spec).toBeUndefined()
    expect(q.tasks[0].acceptanceCriteria).toEqual([])
  })

  it('returns stale unassigned in-progress approved brief to source-backed shaping', async () => {
    await seedTask('task-1', {
      status: 'in_progress',
      assignedTo: null,
      spec: undefined,
      acceptanceCriteria: [],
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
    expect(body).toMatchObject({ ok: true, status: 'exploring' })

    const q = await readTaskQueue()
    expect(q.tasks[0].status).toBe('exploring')
    expect(q.tasks[0].assignedTo).toBeNull()
    expect(q.tasks[0].spec).toBeUndefined()
    expect(q.tasks[0].acceptanceCriteria).toEqual([])
    const effective = await readEffectiveTask('task-1')
    expect(effective.runtime?.openEscalationIds).toEqual([])
  })

  it('uses effective task state when raw approved brief state is stale', async () => {
    await seedTask('task-1', {
      status: 'in_progress',
      assignedTo: 'spec-agent',
      spec: undefined,
      acceptanceCriteria: [],
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
    expect(body).toMatchObject({ ok: true, status: 'exploring' })

    const q = await readTaskQueue()
    expect(q.tasks[0].status).toBe('exploring')
    expect(q.tasks[0].spec).toBeUndefined()
    expect(q.tasks[0].acceptanceCriteria).toEqual([])
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
  it('appends a human-written acceptance criterion without duplicating it as task notes', async () => {
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

    const current = readProjectStateDatabaseTaskPointWithRevision(taskQueuePath(), 'task-1')
    expect(current?.task.definition.acceptanceCriteria).toEqual([
      {
        id: 'ac-1',
        description: 'Round-trip tests preserve comments and formatting.',
        verifiedBy: 'review',
        source: 'documented',
        met: false,
      },
    ])
    expect(current?.task.definition.notes ?? []).toEqual([])
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

describe('POST /api/project/task/:id/set-acceptance-command', () => {
  it('binds one exact executable proof command and invalidates stale completion', async () => {
    await seedTask('task-1', {
      status: 'done',
      acceptanceCriteria: [{
        id: 'AC-1',
        description: 'The focused test suite passes.',
        verifiedBy: 'review',
        source: 'documented',
        met: true,
        verificationState: 'verified',
      }],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/set-acceptance-command'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          criterionId: 'AC-1',
          command: 'pnpm test -- --runInBand',
          approvalActor: 'codex_delegated_owner',
        }),
      }),
    )
    const body = (await res.json()) as Record<string, any>
    expect(res.status, JSON.stringify(body)).toBe(200)
    expect(body).toMatchObject({ ok: true, changed: true, criterionId: 'AC-1', command: 'pnpm test -- --runInBand' })

    const current = readProjectStateDatabaseTaskPointWithRevision(taskQueuePath(), 'task-1')
    expect(current?.task.definition.acceptanceCriteria).toMatchObject([{
      id: 'AC-1',
      description: 'The focused test suite passes.',
      verifiedBy: 'automated',
      source: 'documented',
      command: 'pnpm test -- --runInBand',
      met: false,
    }])
    const evidence = await readTaskEvidence(tmpDir, 'task-1')
    expect(evidence.at(-1)?.payload).toMatchObject({
      agentId: 'system:codex_delegated_owner',
      role: 'codex_delegated_owner',
      criterionId: 'AC-1',
      command: 'pnpm test -- --runInBand',
    })
  })

  it('does not accept multiline commands or an unknown criterion', async () => {
    await seedTask('task-1', {
      acceptanceCriteria: [{
        id: 'AC-1',
        description: 'The focused test suite passes.',
        verifiedBy: 'review',
        source: 'documented',
        met: false,
      }],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const multiline = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/set-acceptance-command'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ criterionId: 'AC-1', command: 'pnpm test\npnpm build' }),
      }),
    )
    expect(multiline.status).toBe(400)

    const missing = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/set-acceptance-command'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ criterionId: 'AC-404', command: 'pnpm test' }),
      }),
    )
    const body = (await missing.json()) as Record<string, any>
    expect(missing.status).toBe(404)
    expect(body.error).toMatch(/criterion not found/i)
  })
})

describe('POST /api/project/task/:id/set-acceptance-proof-expectation', () => {
  it('records an intentional non-zero command result and refreshes its proof path', async () => {
    await seedTask('task-1', {
      status: 'in_progress',
      acceptanceCriteria: [{
        id: 'AC-negative',
        description: 'Missing fixture files produce a clear error.',
        verifiedBy: 'automated',
        source: 'documented',
        command: 'pnpm exec node scripts/validate-fixture.mjs fixtures/missing',
        met: false,
      }],
      proofPaths: [{
        id: 'task-1-AC-negative-command-proof',
        scope: { type: 'task', id: 'task-1' },
        title: 'Run AC-negative',
        summary: 'Missing fixture files produce a clear error.',
        kind: 'command',
        command: 'pnpm exec node scripts/validate-fixture.mjs fixtures/missing',
        source: 'documented',
        status: 'blocked',
        launchSteps: [],
        expectedEvidence: [{
          id: 'AC-negative',
          kind: 'automated',
          description: 'Missing fixture files produce a clear error.',
          required: true,
        }],
        verificationRecords: [],
        relatedTaskIds: ['task-1'],
        createdAt: '2026-07-18T00:00:00.000Z',
        updatedAt: '2026-07-18T00:00:00.000Z',
        createdBy: 'test',
      }],
      acceptanceCriteriaProofState: {
        state: 'blocked',
        reason: 'The old expected exit was zero.',
        gateId: 'AC-negative',
      },
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/set-acceptance-proof-expectation'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          criterionId: 'AC-negative',
          expectedExit: 'non_zero',
          approvalActor: 'codex_delegated_owner',
        }),
      }),
    )
    const body = (await res.json()) as Record<string, any>
    expect(res.status, JSON.stringify(body)).toBe(200)
    expect(body).toMatchObject({
      ok: true,
      changed: true,
      criterionId: 'AC-negative',
      expectedExit: 'non_zero',
    })

    const current = readProjectStateDatabaseTaskPointWithRevision(taskQueuePath(), 'task-1')
    expect(current?.task.definition.acceptanceCriteria).toMatchObject([{
      id: 'AC-negative',
      expectedExit: 'non_zero',
      met: false,
    }])
    expect(current?.task.definition.proofPaths).toMatchObject([{
      status: 'planned',
      expectedEvidence: [{ id: 'AC-negative', expectedExit: 'non_zero' }],
      verificationRecords: [],
    }])
    expect(current?.task.definition.acceptanceCriteriaProofState).toBeUndefined()
    const evidence = await readTaskEvidence(tmpDir, 'task-1')
    expect(evidence.at(-1)?.payload).toMatchObject({
      agentId: 'system:codex_delegated_owner',
      role: 'codex_delegated_owner',
      criterionId: 'AC-negative',
      expectedExit: 'non_zero',
    })
  })
})

describe('POST /api/project/bounded-chat/:id/answer for task owner input', () => {
  it('answers the linked owner-input request without persisting task-local questions', async () => {
    await seedTask('task-1', { status: 'exploring' })
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
        prompt: 'Which option should we use?',
        choices: ['A', 'B'],
        selectionMode: 'single',
      },
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl(`/api/project/bounded-chat/${ownerInput.session.id}/answer`), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subObjectiveId: 'q-1', response: 'A' }),
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
    expect(readProjectStateDatabaseTaskPointWithRevision(taskQueuePath(), 'task-1')?.task.definition.openQuestions).toBeUndefined()
  })

  it('records the answer on the linked task before coordinator review', async () => {
    await seedTask('task-1', {
      status: 'exploring',
    })
    const seededQuestion = writePromotedTaskDetailMutation(taskQueuePath(), 'task-1', {
      projectId,
      projectRoot: tmpDir,
      mutate: task => ({
        ...task,
        openQuestions: [{
          kind: 'text',
          id: 'q-1',
          prompt: 'What is the bounded proof target?',
        }],
      }),
    })
    expect(seededQuestion?.task.openQuestions).toMatchObject([{
      id: 'q-1',
      prompt: 'What is the bounded proof target?',
    }])
    const ownerInput = await createOwnerInputRequest({
      projectRoot: tmpDir,
      projectId,
      commandId: 'test:task-q-1-persisted-answer',
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
        kind: 'text',
        prompt: 'What is the bounded proof target?',
      },
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl(`/api/project/bounded-chat/${ownerInput.session.id}/answer`), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subObjectiveId: 'q-1', response: 'A deterministic CLI proof over the fixture.' }),
      }),
    )

    expect(res.status).toBe(200)
    expect(readProjectStateDatabaseTaskPointWithRevision(taskQueuePath(), 'task-1')?.task.definition.openQuestions).toMatchObject([{
      id: 'q-1',
      answer: 'A deterministic CLI proof over the fixture.',
      answeredAt: expect.any(String),
    }])
    expect((await listOwnerInputRequests(tmpDir))[0]).toMatchObject({ status: 'coordinator_review' })
  })
})

describe('promoted ordinary task actions', () => {
  it('keeps detail actions on the promoted point path while owner input stays in bounded chat', async () => {
    await seedTask('task-1', { status: 'exploring' })
    const ownerInput = await createOwnerInputRequest({
      projectRoot: tmpDir,
      projectId,
      commandId: 'test:task-q-1-ordinary-actions',
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
        prompt: 'Which option should we use?',
        choices: ['A', 'B'],
        selectionMode: 'single',
      },
    })
    const { app } = buildServeApp({ projectPath: tmpDir })

    const postAction = async (action: string, body?: Record<string, unknown>) => app.fetch(
      new Request(projectUrl(`/api/project/task/task-1/${action}`), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
    )
    const briefResponse = await postAction('update-brief', {
      successTarget: 'The task has a concrete proof target.',
      acceptanceCriterion: 'The proof target is recorded.',
      whyItMattersNow: 'The release cannot run without a bounded proof target.',
      nonGoals: ['Do not replace the source authority with generated records.'],
    })
    expect(briefResponse.status).toBe(200)
    let point = readProjectStateDatabaseTaskPointWithRevision(taskQueuePath(), 'task-1')
    expect(point?.task.definition.productBrief).toMatchObject({
      successMetric: 'The task has a concrete proof target.',
      whyItMattersNow: 'The release cannot run without a bounded proof target.',
      nonGoals: ['Do not replace the source authority with generated records.'],
      antiPatterns: ['Do not replace the source authority with generated records.'],
    })
    expect(point?.task.definition.acceptanceCriteria).toEqual([
      expect.objectContaining({ description: 'The proof target is recorded.' }),
    ])
    const answerResponse = await app.fetch(
      new Request(projectUrl(`/api/project/bounded-chat/${ownerInput.session.id}/answer`), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subObjectiveId: 'q-1', response: 'A' }),
      }),
    )
    expect(answerResponse.status).toBe(200)
    expect((await listOwnerInputRequests(tmpDir))[0]).toMatchObject({
      id: ownerInput.request.id,
      status: 'coordinator_review',
    })

    expect((await postAction('hold', { reason: 'Waiting for review.' })).status).toBe(200)
    point = readProjectStateDatabaseTaskPointWithRevision(taskQueuePath(), 'task-1')
    expect(point?.task.definition).toMatchObject({
      status: 'blocked',
      blockReason: 'On hold: Waiting for review.',
      hold: { reason: 'Waiting for review.' },
    })
    expect((await postAction('resume-hold')).status).toBe(200)
    expect((await postAction('shelve')).status).toBe(200)
    expect((await postAction('unshelve')).status).toBe(200)

    const notes = await readTaskEvidence(tmpDir, 'task-1', { kind: 'note' })
    expect(notes.map(note => String((note.payload as Record<string, unknown>)?.content))).toEqual(expect.arrayContaining([
      expect.stringContaining('Updated task brief.'),
      expect.stringContaining('Task put on hold: Waiting for review.'),
      expect.stringContaining('Task returned from hold.'),
      expect.stringContaining('Task shelved via dashboard'),
      expect.stringContaining('Task unshelved via dashboard'),
    ]))
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

    const q = await readTaskQueue()
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
    await seedTask('task-1', {
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

  it('preserves an explicit Codex owner delegation instead of calling it a human click', async () => {
    await seedTask('task-1', {
      status: 'blocked',
      blockReason: 'Escalation raised',
      escalations: [{
        id: 'esc-1',
        taskId: 'task-1',
        reason: 'spec_ambiguous',
        summary: 'The proof contract needs a fresh spec pass.',
        agentId: 'agent:worker-1',
        raisedAt: new Date().toISOString(),
      }],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/resolve-escalation'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          escalationId: 'esc-1',
          resolution: 'Re-open proof/spec shaping under the delegated owner mandate.',
          nextStatus: 'exploring',
          actor: 'codex_delegated_owner',
        }),
      }),
    )
    expect(res.status).toBe(200)
    const task = await readEffectiveTask('task-1')
    expect(task.status).toBe('exploring')
    expect(task.escalations[0].resolvedBy).toBe('codex_delegated_owner')
  })

  it('collapses identical direct-recovery escalations into one owner action', async () => {
    const now = new Date().toISOString()
    await seedTask('task-1', {
      status: 'blocked',
      blockReason: 'Escalation raised',
      escalations: [
        {
          id: 'esc-1', taskId: 'task-1', reason: 'human_judgment_required',
          summary: 'The spec pass stalled.', agentId: 'spec-agent', raisedAt: now,
        },
        {
          id: 'esc-2', taskId: 'task-1', reason: 'human_judgment_required',
          summary: 'The same spec pass stalled again.', agentId: 'spec-agent', raisedAt: now,
        },
        {
          id: 'esc-3', taskId: 'task-1', reason: 'spec_ambiguous',
          summary: 'A different recovery remains open.', agentId: 'spec-agent', raisedAt: now,
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
          resolution: 'Retry the spec from its saved notes.',
          nextStatus: 'exploring',
          resolveEquivalent: true,
        }),
      }),
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, resolvedCount: 2 })
    const task = await readEffectiveTask('task-1')
    expect(task.status).toBe('blocked')
    expect(task.escalations.find((escalation: { id: string; resolvedAt?: string }) => escalation.id === 'esc-1')?.resolvedAt).toBeTruthy()
    expect(task.escalations.find((escalation: { id: string; resolvedAt?: string }) => escalation.id === 'esc-2')?.resolvedAt).toBeTruthy()
    expect(task.escalations.find((escalation: { id: string; resolvedAt?: string }) => escalation.id === 'esc-3')?.resolvedAt).toBeUndefined()
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
    await seedCanonicalQueue(queue)

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

  it('keeps Activity decision and action model aligned when blocked and ready work coexist', async () => {
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
    await seedCanonicalQueue(queue)

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/activity')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.counts.blocked).toBe(1)
    expect(body.counts.ready).toBe(1)
    expect(body.topAction?.taskId).toBe(body.decision?.primaryAction?.targetId)
    expect(body.actionModel.primaryAction?.taskId).toBe(body.decision?.primaryAction?.targetId)
    expect(body.summary).toMatchObject({
      taskId: body.decision?.primaryAction?.targetId,
    })
  })

  it('keeps a drafted brief review task-scoped in Thread across saved Activity state', async () => {
    const now = new Date().toISOString()
    await seedCanonicalQueue({
      version: 1,
      lastUpdated: now,
      selectedReleaseId: 'desktop-mvp',
      releases: [{
        id: 'desktop-mvp',
        label: 'Desktop MVP',
        kind: 'release',
        state: 'active',
        source: 'owner_approved',
        nodeIds: ['work:task-086'],
        deferredNodeIds: [],
      }],
      tasks: [{
        id: 'task-086',
        title: 'Prove packaged Tauri sidecar',
        description: '',
        domain: 'desktop',
        projectPath: tmpDir,
        status: 'exploring',
        priority: 'normal',
        revisionCount: 0,
        remediationAttempts: 0,
        origination: 'human',
        productBrief: {
          userJob: 'Prove the packaged sidecar before desktop work begins.',
          whyItMattersNow: 'The desktop release depends on this architecture gate.',
          successMetric: 'The packaged app completes one offline fixture run.',
          nonGoals: ['Do not build the full interface yet.'],
        },
        createdAt: now,
        updatedAt: now,
      }],
    })

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/activity')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    const reviewHref = `/projects/${projectId}/thread?thread=task%3Atask-086`
    expect(body.decision).toMatchObject({
      execution: { focusKind: 'brief_cleanup', focusTaskId: 'task-086' },
      primaryAction: { kind: 'answer_owner_input', targetId: 'task-086' },
    })
    expect(body.topAction).toMatchObject({
      label: 'Prove packaged Tauri sidecar',
      buttonLabel: 'Review brief',
      href: reviewHref,
      taskId: 'task-086',
    })
    expect(body.actionModel).toMatchObject({
      primaryAction: { buttonLabel: 'Review brief', href: reviewHref, taskId: 'task-086' },
      runControl: { label: 'Waiting on answer', startEnabled: false },
      setup: { state: 'ready', freshIntakeNeeded: false },
    })
  })

  it('keeps live Activity and fleet on the same project decision packet', async () => {
    const now = new Date().toISOString()
    await seedCanonicalQueue({
      version: 1,
      lastUpdated: now,
      tasks: [
        {
          id: 'focused-task',
          title: 'Run the focused task',
          description: '',
          domain: 'd',
          projectPath: tmpDir,
          status: 'blocked',
          blockReason: 'Needs a durable proof path.',
          priority: 'normal',
          revisionCount: 0,
          remediationAttempts: 0,
          origination: 'human',
          createdAt: now,
          updatedAt: now,
        },
      ],
    })

    registerWorkspace({ id: projectId, name: 'Task Endpoints Test', path: tmpDir, tags: [] })
    const { app, refreshProjectProjections } = buildServeApp({ projectPath: tmpDir })
    await refreshProjectProjections(tmpDir)
    const [activityRes, serviceRes] = await Promise.all([
      app.fetch(new Request(projectUrl('/api/project/activity'))),
      app.fetch(new Request(projectUrl('/api/service'))),
    ])
    expect(activityRes.status).toBe(200)
    expect(serviceRes.status).toBe(200)

    const activity = await activityRes.json() as Record<string, any>
    const service = await serviceRes.json() as { projects?: Array<Record<string, any>> }
    const projectSummary = service.projects?.[0]
    expect(activity.summaryFreshness).toBe('current')
    expect(projectSummary?.summaryFreshness).toBe('current')
    expect(activity.releaseSummary).toEqual(projectSummary?.releaseSummary)
    expect(projectSummary?.workProgress?.counts.visibleTotal).toBe(1)
    expect(activity.actionModel).toEqual(projectSummary?.actionModel)
    expect(activity.decision).toEqual(projectSummary?.decision)
    expect(activity.topAction?.taskId).toBe(activity.decision?.primaryAction?.targetId)
  })

  it('refreshes a stale decision with the bounded typed live execution identity', async () => {
    const now = new Date().toISOString()
    await seedCanonicalQueue({
      version: 1,
      lastUpdated: now,
      tasks: [
        {
          id: 'planned-task',
          title: 'Old planned work',
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
        },
        {
          id: 'live-task',
          title: 'Prove world-state continuity',
          description: '',
          domain: 'd',
          projectPath: tmpDir,
          status: 'in_progress',
          priority: 'normal',
          revisionCount: 0,
          remediationAttempts: 0,
          origination: 'human',
          createdAt: now,
          updatedAt: now,
        },
      ],
    })
    updateProjectStateDatabaseSummaryAndCurrentState(taskQueuePath(), summary => ({
      summary: {
        ...summary,
        freshness: 'stale',
        decision: {
          ...(summary.decision as Record<string, unknown>),
          execution: {
            state: 'runnable',
            code: 'ready_work',
            focusTaskId: 'planned-task',
            focusTaskTitle: 'Old planned work',
          },
          primaryAction: {
            kind: 'open_work',
            targetId: 'planned-task',
            reasonCode: 'ready_work',
          },
        },
      },
      currentState: {
        execution: {
          status: 'running',
          mode: 'continuous',
          activeTaskId: 'live-task',
          activeTaskTitle: 'Prove world-state continuity',
          updatedAt: now,
        },
      },
    }))

    const { app } = buildServeApp({ projectPath: tmpDir })
    const response = await app.fetch(new Request(projectUrl('/api/project/activity')))
    const body = await response.json() as Record<string, any>

    expect(response.status).toBe(200)
    expect(body.summaryFreshness).toBe('stale')
    expect(body.counts).toEqual({})
    expect(body.releaseSummary).toMatchObject({
      release: { id: 'release-current' },
      state: 'unknown',
    })
    expect(body.releaseSummary).not.toHaveProperty('counts')
    expect(body.decision.execution).toMatchObject({
      state: 'running',
      focusTaskId: 'live-task',
      focusTaskTitle: 'Prove world-state continuity',
    })
    expect(body.topAction).toMatchObject({
      label: 'Prove world-state continuity',
      href: `/projects/${projectId}/work?task=live-task`,
      taskId: 'live-task',
    })
    expect(body.actionModel.primaryAction).toEqual(body.topAction)
    expect(body.inFlight[0]).toMatchObject({ id: 'live-task', title: 'Prove world-state continuity' })
  })

  it('keeps live event metadata out of ordinary activity polling', async () => {
    const older = '2026-05-23T18:00:00.000Z'
    const now = '2026-05-23T18:01:00.000Z'
    const queue = {
      version: 1,
      lastUpdated: now,
      tasks: [
        { id: 't1', title: 'Long worker loop', description: '', domain: 'd', projectPath: tmpDir, status: 'in_progress', priority: 'normal', revisionCount: 0, remediationAttempts: 0, origination: 'human', createdAt: older, updatedAt: older },
      ],
    }
    await seedCanonicalQueue(queue)
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
    })
    expect(body.inFlight[0].lastActivityAt).toBe(older)
    expect(body.inFlight[0]).not.toHaveProperty('lastActivityLabel')
    expect(body.inFlight[0]).not.toHaveProperty('lastActivityTone')
  })

  it('keeps activity polling read-only for phantom worker claims', async () => {
    const now = new Date().toISOString()
    const staleClaimAt = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    await seedCanonicalQueue({
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
              structured: {
                event: 'task_claim',
                source: 'deterministic',
                taskId: 't1',
                assignedTo: 'worker-agent',
              },
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
    expect(body.counts.ready).toBeUndefined()
    expect(body.counts.in_progress).toBe(1)
    expect(body.inFlight).toMatchObject([{ id: 't1', status: 'in_progress' }])

    const queue = await readTaskQueue()
    expect(queue.tasks[0]).toMatchObject({
      status: 'in_progress',
      assignedTo: 'worker-agent',
    })
    const effective = await readEffectiveTask('t1')
    expect(effective.runtime?.openEscalationIds).toEqual(['esc-t1-1'])
  })

  it('does not repair fresh worker claims while external CLI work may still be active', async () => {
    const now = new Date().toISOString()
    await seedCanonicalQueue({
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

  it('keeps legacy provider recovery state unchanged during activity polling', async () => {
    const now = new Date().toISOString()
    await seedCanonicalQueue({
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
    const evidence = await readTaskEvidence(tmpDir, 't1', { kind: 'note' })
    const notes = evidence.map(event => event.payload as Record<string, unknown>)
    expect(findLastMatching(notes, note => note.role === 'policy-classification')?.content)
      .toContain('"safePlaybooks":["resume_from_checkpoint"]')
    expect(findLastMatching(notes, note => note.role === 'recovery-playbook')?.content)
      .toContain('"playbook":"resume_from_checkpoint"')
    expect(findLastMatching(notes, note => note.role === 'provider-recovery')).toBeUndefined()
  })

  it('keeps dirty worktree recovery state unchanged during activity polling', async () => {
    const now = new Date().toISOString()
    const worktreePath = path.join(tmpDir, '.guildhall', 'worktrees', 'dirty-provider-recovery')
    await fs.mkdir(path.join(worktreePath, 'docs', 'product'), { recursive: true })
    execFileSync('git', ['init'], { cwd: worktreePath, stdio: 'ignore' })
    await fs.writeFile(
      path.join(worktreePath, 'docs', 'product', 'deepinfra-drafting-model-selection.md'),
      '# DeepInfra Drafting Model Selection\n\nPartial output.\n',
      'utf8',
    )
    await seedCanonicalQueue({
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
    const evidence = await readTaskEvidence(tmpDir, 't1', { kind: 'note' })
    const notes = evidence.map(event => event.payload as Record<string, unknown>)
    expect(findLastMatching(notes, note => note.role === 'policy-classification')?.content)
      .toContain('"class":"provider_unavailable"')
    expect(findLastMatching(notes, note => note.role === 'recovery-playbook')?.content)
      .toContain('"playbook":"resume_from_checkpoint"')
    expect(findLastMatching(notes, note => note.role === 'recovery')).toBeUndefined()
  })

  it('keeps corrected provider recovery state unchanged during activity polling', async () => {
    const now = new Date().toISOString()
    const worktreePath = path.join(tmpDir, '.guildhall', 'worktrees', 'dirty-corrected-playbook')
    await fs.mkdir(path.join(worktreePath, 'docs', 'product'), { recursive: true })
    execFileSync('git', ['init'], { cwd: worktreePath, stdio: 'ignore' })
    await fs.writeFile(
      path.join(worktreePath, 'docs', 'product', 'deepinfra-drafting-model-selection.md'),
      '# DeepInfra Drafting Model Selection\n\nPartial output.\n',
      'utf8',
    )
    await seedCanonicalQueue({
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
    const evidence = await readTaskEvidence(tmpDir, 't1', { kind: 'note' })
    const notes = evidence.map(event => event.payload as Record<string, unknown>)
    expect(findLastMatching(notes, note => note.role === 'policy-classification')?.content)
      .toContain('"class":"provider_unavailable"')
    expect(findLastMatching(notes, note => note.role === 'recovery')).toBeUndefined()
  })

  it('returns empty summary when no tasks file exists yet', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/activity')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.inFlight).toEqual([])
  })
})
