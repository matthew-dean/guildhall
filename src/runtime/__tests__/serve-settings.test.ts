import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  bootstrapWorkspace,
  readProjectConfig,
  readWorkspaceConfig,
  registerWorkspace,
  unregisterWorkspace,
  setProvider,
  updateGlobalConfig,
  writeProjectConfig,
  writeWorkspaceConfig,
  type ResolvedConfig,
} from '@guildhall/config'
import { defaultAgentSettingsPath, loadLeverSettings, makeDefaultSettings } from '@guildhall/levers'
import { proposeProjectSkill } from '@guildhall/skills'
import {
  appendTaskEvidence,
  ensureProjectLocalHistoryDir,
  getProjectLocalHistoryDir,
  getProjectSystemStatePath,
  getProjectTranscriptPath,
  projectStateDatabasePath,
  readProjectStateDatabaseMetadata,
  readProjectStateDatabaseQueueDefinition,
  readProjectStateJsonAsync,
  promoteProjectStateDatabaseAuthority,
  upsertTaskRuntimeState,
  upsertTaskWorkspaceState,
  writeProjectStateJsonAsync,
  writeProjectStateTextAsync,
} from '@guildhall/sessions'
import { buildServeApp } from '../serve.js'
import { TaskEvidenceEvent, type Task } from '@guildhall/core'
import { buildEffectiveTask } from '../effective-task.js'
import { persistLearningCandidates } from '../learning.js'
import { applyProjectMigrations, getProjectMigrationStatus } from '../migrations.js'
import { acceptStructuralMap, draftStructuralMap, submitStructuralMapForReview } from '../structural-map.js'
import { createProjectDependencyRequest } from '../project-graph.js'
import { createOwnerInputRequest } from '../owner-input-store.js'
import { detectWorkspaceSignals } from '../workspace-import/detect.js'
import { formWorkspaceHypothesis } from '../workspace-import/hypothesis.js'
import { buildWorkspaceImportReview } from '../workspace-import/review.js'
import { OrchestratorSupervisor } from '../serve-supervisor.js'
import { sanitizeTaskQueueForProjectWrite } from '../project-state-boundary.js'
import { writeProjectSummaryProjectionFromUnknownQueue } from '../project-summary-projection.js'
import type { LearningCandidate } from '../policy.js'

const execFileP = promisify(execFile)

// Integration tests for the Settings-page read-only endpoints:
//   GET /api/config/levers — flatten lever settings into the shape the UI
//   renders. Seeds agent-settings.yaml on first read, so a freshly bootstrapped
//   workspace is a valid test input.

let tmpDir: string
let previousHome: string | undefined
let previousConfigDir: string | undefined
let previousSemanticRecall: string | undefined
let previousObservationalMemory: string | undefined
let previousEngineGate: string | undefined
let previousSubstrate: string | undefined
let systemDir: string
let remoteDir: string
const PROJECT_ID = 'settings-test'

function scoped(pathname: string): string {
  const url = new URL(`http://localhost${pathname}`)
  url.searchParams.set('projectId', PROJECT_ID)
  if (url.pathname === '/api/project' && !url.searchParams.has('compact') && !url.searchParams.has('detail')) {
    url.searchParams.set('detail', 'true')
  }
  return url.toString()
}

function scopedDiagnostic(pathname = '/api/project'): string {
  const url = new URL(scoped(pathname))
  url.searchParams.set('diagnostic', 'true')
  return url.toString()
}

async function readTasks(tmpPath: string): Promise<Array<Record<string, any>>> {
  const tasksPath = getProjectSystemStatePath(tmpPath, 'TASKS.json')
  const queue = readProjectStateDatabaseQueueDefinition(tasksPath)
  if (!queue) throw new Error('Missing canonical SQLite task queue')
  return await Promise.all(queue.tasks.map(task => buildEffectiveTask(tmpPath, task as any))) as Array<Record<string, any>>
}

type TaskFixture = {
  definition: Record<string, any>
  runtime?: Record<string, any>
  workspace?: Record<string, any>
  evidence?: Array<TaskEvidenceEvent>
}

const runtimeFixtureFields = ['assignedTo', 'revisionCount', 'retryWindow', 'proofRecovery', 'remediationAttempts', 'handoffStep'] as const
const workspaceFixtureFields = ['worktreePath', 'branchName', 'baseBranch'] as const

function fixtureEvent(taskId: string, kind: TaskEvidenceEvent['kind'], value: Record<string, any>, index: number, recordedAt: string): TaskEvidenceEvent {
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
  const definition = { ...task, ...(task.definition ?? {}) }
  delete definition.definition
  delete definition.runtime
  delete definition.workspace
  delete definition.evidence

  const runtime: Record<string, any> = { ...(task.runtime ?? {}) }
  const workspace: Record<string, any> = { ...(task.workspace ?? {}) }
  const evidenceKinds = new Set(['event', 'note', 'gate_result', 'review_verdict', 'adjudication', 'escalation', 'agent_issue', 'merge_record', 'git_story'])
  const evidence: Array<TaskEvidenceEvent> = (task.evidence ?? [])
    .filter((event: Record<string, any>) => evidenceKinds.has(String(event.kind)))
    .map((event: Record<string, any>) => TaskEvidenceEvent.parse(event))

  for (const field of runtimeFixtureFields) {
    if (!(field in definition)) continue
    if ((field === 'revisionCount' || field === 'remediationAttempts') && definition[field] === 0) {
      delete definition[field]
      continue
    }
    runtime[field] = definition[field]
    delete definition[field]
  }
  for (const field of workspaceFixtureFields) {
    if (!(field in definition)) continue
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
      evidence.push(fixtureEvent(taskId, collection.kind as TaskEvidenceEvent['kind'], value, index, collection.timestamp(value) ?? now))
    })
    delete definition[collection.field]
  }
  if ('mergeRecord' in definition) {
    const value = definition.mergeRecord as Record<string, any>
    evidence.push(fixtureEvent(taskId, 'merge_record', value, 0, value.mergedAt ?? now))
    delete definition.mergeRecord
  }

  if (!Array.isArray(runtime.openEscalationIds) && Array.isArray(task.escalations)) {
    runtime.openEscalationIds = task.escalations.filter((value: Record<string, any>) => !value.resolvedAt).map((value: Record<string, any>) => String(value.id))
  }
  if (!Array.isArray(runtime.openIssueIds) && Array.isArray(task.agentIssues)) {
    runtime.openIssueIds = task.agentIssues.filter((value: Record<string, any>) => !value.resolvedAt).map((value: Record<string, any>) => String(value.id))
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
  const tasksPath = getProjectSystemStatePath(tmpDir, 'TASKS.json')
  const queue = readProjectStateDatabaseQueueDefinition(tasksPath)
  if (!queue) throw new Error('Missing canonical SQLite task queue')
  const projectionTasks = await Promise.all(queue.tasks.map(task => buildEffectiveTask(tmpDir, task as any))) as unknown as Task[]
  writeProjectSummaryProjectionFromUnknownQueue(tasksPath, {
    projectId: PROJECT_ID,
    projectRoot: tmpDir,
    queue,
    projectionTasks,
    queueCommit: false,
  })
}

async function applyCanonicalMigrations(): Promise<void> {
  try {
    await fs.access(getProjectSystemStatePath(tmpDir, 'TASKS.json'))
  } catch {
    // A settings fixture may persist project metadata before its legacy task
    // queue exists. Once SQLite exists, however, the final migrations read
    // the authoritative queue from the database after TASKS.json is retired.
    if (readProjectStateDatabaseMetadata(tmpDir) === null) return
  }
  for (let attempt = 0; attempt < 128; attempt += 1) {
    const prerequisites = await applyProjectMigrations({
      projectRoot: tmpDir,
      includePrompt: true,
      appVersion: 'serve-settings-test',
    })
    if (prerequisites.failed.length > 0) {
      throw new Error(prerequisites.failed.map(item => `${item.id}: ${item.error}`).join('; '))
    }
    const status = await getProjectMigrationStatus({ projectRoot: tmpDir })
    const automaticIds = status.blocked
      .filter(item => item.safety !== 'manual' && (
        item.safety === 'required' || item.requirement === 'required'
      ))
      .map(item => item.id)
      .filter((id, index, all) => all.indexOf(id) === index)
      .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
    if (automaticIds.length === 0) break
    // Apply prerequisites one at a time so a later migration cannot run in
    // the same pass against a boundary its earlier prerequisite just created.
    const result = await applyProjectMigrations({
      projectRoot: tmpDir,
      only: [automaticIds[0]!],
      appVersion: 'serve-settings-test',
    })
    if (result.failed.length > 0) {
      throw new Error(result.failed.map(item => `${item.id}: ${item.error}`).join('; '))
    }
  }
  const remaining = await getProjectMigrationStatus({ projectRoot: tmpDir })
  if (remaining.blocked.length > 0) {
    throw new Error(`Required migrations remain blocked: ${remaining.blocked.map(item => item.id).join(', ')}`)
  }
}

async function readLiveWorkspaceImportReview(): Promise<ReturnType<typeof buildWorkspaceImportReview>> {
  const inventory = await detectWorkspaceSignals({ projectPath: tmpDir })
  return buildWorkspaceImportReview(formWorkspaceHypothesis(inventory), [], tmpDir)
}

async function writeSystemTasks(queue: unknown): Promise<void> {
  const tasksPath = getProjectSystemStatePath(tmpDir, 'TASKS.json')
  const sourceQueue = queue as Record<string, any>
  const now = typeof sourceQueue.lastUpdated === 'string' ? sourceQueue.lastUpdated : new Date().toISOString()
  const fixtures = (Array.isArray(sourceQueue.tasks) ? sourceQueue.tasks : []).map(task => normalizeTaskFixture(task, now))
  const definitionQueue = {
    ...sourceQueue,
    tasks: fixtures.map(fixture => fixture.definition),
  }
  const normalizedQueue = sanitizeTaskQueueForProjectWrite(definitionQueue).queue
  writeProjectSummaryProjectionFromUnknownQueue(tasksPath, {
    projectId: PROJECT_ID,
    projectRoot: tmpDir,
    queue: normalizedQueue,
    taskDefinitionsAlreadySanitized: true,
  })
  promoteProjectStateDatabaseAuthority(tmpDir)
  for (const [index, fixture] of fixtures.entries()) {
    const taskId = String(fixture.definition.id ?? '')
    if (!taskId) throw new Error(`Missing seeded task id at index ${index}`)
    if (fixture.runtime) await upsertTaskRuntimeState(tmpDir, taskId, fixture.runtime)
    if (fixture.workspace) await upsertTaskWorkspaceState(tmpDir, taskId, fixture.workspace)
    for (const event of fixture.evidence ?? []) await appendTaskEvidence(tmpDir, taskId, event)
  }
  await refreshCanonicalSummary()
  await applyCanonicalMigrations()
  // Migrations are authoritative writes too. Leave the fixture at the same
  // current-summary boundary that the async projector establishes in a live
  // service instead of making GETs repair it.
  await refreshCanonicalSummary()
}

async function writeSystemText(relativePath: string, content: string): Promise<void> {
  if (relativePath === 'TASKS.json') {
    await writeSystemTasks(JSON.parse(content))
    return
  }
  await writeProjectStateTextAsync(tmpDir, relativePath, content)
}

async function writeSystemJson(relativePath: string, value: unknown): Promise<void> {
  if (relativePath === 'TASKS.json') {
    await writeSystemTasks(value)
    return
  }
  await writeProjectStateJsonAsync(tmpDir, relativePath, value)
  await applyCanonicalMigrations()
}

async function writeLegacySystemJson(relativePath: string, value: unknown): Promise<void> {
  await writeProjectStateJsonAsync(tmpDir, relativePath, value)
}

async function readFirstOwnerInputRequest(): Promise<{ boundedChatSessionId: string }> {
  const ownerInputDir = getProjectSystemStatePath(tmpDir, 'owner-input')
  const requests = await fs.readdir(ownerInputDir)
  return JSON.parse(
    await fs.readFile(path.join(ownerInputDir, requests[0]!), 'utf8'),
  ) as { boundedChatSessionId: string }
}

async function seedThreadOwnerInput(input: {
  taskId: string
  questionId: string
  prompt: string
  label: string
  kind?: 'task_shaping' | 'recovery_decision'
  choices?: string[]
  now: string
}): Promise<void> {
  await createOwnerInputRequest({
    projectRoot: tmpDir,
    projectId: PROJECT_ID,
    commandId: `serve-settings:${input.taskId}:${input.questionId}`,
    now: input.now,
    actor: 'test:serve-settings',
    source: input.kind === 'recovery_decision'
      ? { kind: 'recovery_decision', taskId: input.taskId, questionId: input.questionId }
      : { kind: 'task', taskId: input.taskId, questionId: input.questionId },
    target: { kind: 'thread' },
    prompt: input.prompt,
    ...(input.choices ? { choices: input.choices } : {}),
    objective: {
      kind: input.kind ?? 'task_shaping',
      label: input.label,
      successCriteria: ['Owner answers the linked Thread session.'],
    },
    sessionSource: `test:serve-settings:${input.taskId}:${input.questionId}`,
  })
}

beforeEach(async () => {
  previousHome = process.env.HOME
  previousConfigDir = process.env.GUILDHALL_CONFIG_DIR
  previousSemanticRecall = process.env.GUILDHALL_MEMORY_SEMANTIC_RECALL
  previousObservationalMemory = process.env.GUILDHALL_MEMORY_OBSERVATIONAL
  previousEngineGate = process.env.GUILDHALL_MEMORY_ENGINE_GATE
  previousSubstrate = process.env.GUILDHALL_MEMORY_SUBSTRATE
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-serve-settings-'))
  systemDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-serve-settings-system-'))
  remoteDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-serve-settings-remote-'))
  await fs.rm(remoteDir, { recursive: true, force: true })
  process.env.HOME = tmpDir
  process.env.GUILDHALL_CONFIG_DIR = systemDir
  bootstrapWorkspace(tmpDir, { name: 'Settings Test' })
  await execFileP('git', ['init', '-b', 'main'], { cwd: tmpDir })
  await execFileP('git', ['config', 'user.name', 'Guildhall Test'], { cwd: tmpDir })
  await execFileP('git', ['config', 'user.email', 'guildhall@example.test'], { cwd: tmpDir })
  await execFileP('git', ['add', '.'], { cwd: tmpDir })
  await execFileP('git', ['commit', '-m', 'init'], { cwd: tmpDir })
})

afterEach(async () => {
  if (previousHome === undefined) delete process.env.HOME
  else process.env.HOME = previousHome
  if (previousConfigDir === undefined) delete process.env.GUILDHALL_CONFIG_DIR
  else process.env.GUILDHALL_CONFIG_DIR = previousConfigDir
  if (previousSemanticRecall === undefined) delete process.env.GUILDHALL_MEMORY_SEMANTIC_RECALL
  else process.env.GUILDHALL_MEMORY_SEMANTIC_RECALL = previousSemanticRecall
  if (previousObservationalMemory === undefined) delete process.env.GUILDHALL_MEMORY_OBSERVATIONAL
  else process.env.GUILDHALL_MEMORY_OBSERVATIONAL = previousObservationalMemory
  if (previousEngineGate === undefined) delete process.env.GUILDHALL_MEMORY_ENGINE_GATE
  else process.env.GUILDHALL_MEMORY_ENGINE_GATE = previousEngineGate
  if (previousSubstrate === undefined) delete process.env.GUILDHALL_MEMORY_SUBSTRATE
  else process.env.GUILDHALL_MEMORY_SUBSTRATE = previousSubstrate
  await fs.rm(tmpDir, { recursive: true, force: true })
  await fs.rm(systemDir, { recursive: true, force: true })
  await fs.rm(remoteDir, { recursive: true, force: true })
})

describe('GET /api/config/levers', () => {
  it('returns seeded project + default-domain levers with string-rendered positions', async () => {
    const { app, refreshProjectProjections } = buildServeApp({ projectPath: tmpDir })
    await refreshProjectProjections(tmpDir)
    const res = await app.fetch(new Request(scoped('/api/config/levers')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { levers: Array<Record<string, any>> }
    expect(Array.isArray(body.levers)).toBe(true)
    expect(body.levers.length).toBeGreaterThan(0)

    // Every entry has scope, name, stringified position, rationale, setBy.
    for (const l of body.levers) {
      expect(typeof l.name).toBe('string')
      expect(typeof l.position).toBe('string')
      expect(typeof l.rationale).toBe('string')
      expect(typeof l.setBy).toBe('string')
      expect(['project', 'domain:default']).toContain(l.scope)
    }

    // Spot-check: concurrent_task_dispatch is a parameterized lever — the
    // renderer should emit "serial" (not "[object Object]").
    const concurrent = body.levers.find(l => l.name === 'concurrent_task_dispatch')
    expect(concurrent?.position).toBe('serial')

    // Spot-check: a plain-string lever renders as-is.
    const envelope = body.levers.find(l => l.name === 'business_envelope_strictness')
    expect(envelope?.position).toBe('advisory')

    // Seed provenance should be intact.
    expect(concurrent?.setBy).toBe('system-default')
  })

  it('seeds .guildhall/agent-settings.yaml on first call if missing', async () => {
    const settingsPath = getProjectSystemStatePath(tmpDir, 'agent-settings.yaml')
    await expect(fs.access(settingsPath)).rejects.toThrow()
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(scoped('/api/config/levers')))
    expect(res.status).toBe(200)
    await fs.access(settingsPath) // now exists
  })
})

describe('project re-intake endpoints', () => {
  it('creates, returns, applies, and dismisses a re-intake draft', async () => {
    await fs.mkdir(path.join(tmpDir, 'looma/docs'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'looma/docs/component-library-audit.md'),
      [
        '# Component audit',
        '',
        '| Deliverable | Need | Foundation | Consumer |',
        '| --- | --- | --- | --- |',
        '| Dialog | shipped as `ui-dialog` | native dialog + overlay manager | Knit BaseDialog already uses it |',
        '| AlertDialog | missing P0 gap | builds on Dialog and Button | Knit destructive confirmation flow |',
      ].join('\n'),
      'utf8',
    )
    await writeSystemTasks({
        version: 1,
        lastUpdated: '2026-05-30T20:00:00.000Z',
        tasks: [{
          id: 'task-039',
          title: 'Build AlertDialog primitive',
          description: 'Old task',
          domain: 'looma',
          projectPath: tmpDir,
          status: 'blocked',
          priority: 'high',
          dependsOn: [],
          outOfScope: [],
          acceptanceCriteria: [],
          notes: [],
          gateResults: [],
          reviewVerdicts: [],
          adjudications: [],
          escalations: [],
          agentIssues: [],
          revisionCount: 0,
          remediationAttempts: 0,
          origination: 'human',
          createdAt: '2026-05-30T20:00:00.000Z',
          updatedAt: '2026-05-30T20:00:00.000Z',
        }],
        })

    const { app } = buildServeApp({ projectPath: tmpDir })
    const rerun = await app.fetch(new Request(scoped('/api/project/reintake/rerun'), { method: 'POST' }))
    expect(rerun.status).toBe(200)
    const rerunBody = await rerun.json() as { draft: { summary: { reframed: number; created: number } } }
    expect(rerunBody.draft.summary.reframed).toBe(1)
    expect(rerunBody.draft.summary.created).toBeGreaterThan(0)

    const draftResponse = await app.fetch(new Request(scoped('/api/project/reintake/draft')))
    const draft = await draftResponse.json() as { groups: Array<{ id: string }> }
    expect(draft.groups.map(group => group.id)).toContain('evidence-work-graph')

    const apply = await app.fetch(new Request(scoped('/api/project/reintake/apply'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ groupIds: ['evidence-work-graph'] }),
    }))
    expect(apply.status, await apply.clone().text()).toBe(200)
    const tasks = await readTasks(tmpDir)
    expect(tasks.find(task => task.id === 'task-039')).toMatchObject({
      title: 'Build AlertDialog',
      status: 'spec_review',
      productBrief: expect.objectContaining({ authoredBy: 'project-reintake' }),
    })
    expect(tasks.find(task => task.id === 'task-alert-dialog-integration')).toMatchObject({
      dependsOn: ['task-039'],
    })

    const dismiss = await app.fetch(new Request(scoped('/api/project/reintake/dismiss'), { method: 'POST' }))
    expect(dismiss.status).toBe(200)
  })
})

describe('POST /api/config/levers', () => {
  it('writes a project override and can return the lever to the global default', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })

    const set = await app.fetch(new Request(scoped('/api/config/levers'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scope: 'project',
        name: 'worktree_isolation',
        position: 'per_attempt',
      }),
    }))
    expect(set.status).toBe(200)
    const setBody = await set.json() as { levers: Array<Record<string, any>> }
    const overridden = setBody.levers.find(l => l.scope === 'project' && l.name === 'worktree_isolation')
    expect(overridden).toMatchObject({
      position: 'per_attempt',
      defaultPosition: 'per_task',
      setBy: 'user-direct',
    })

    let settings = await loadLeverSettings({
      path: defaultAgentSettingsPath(tmpDir),
    })
    expect(settings.project.worktree_isolation.position).toBe('per_attempt')
    expect(settings.project.worktree_isolation.setBy).toBe('user-direct')

    const inherit = await app.fetch(new Request(scoped('/api/config/levers'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scope: 'project',
        name: 'worktree_isolation',
        position: null,
      }),
    }))
    expect(inherit.status).toBe(200)
    const inheritBody = await inherit.json() as { levers: Array<Record<string, any>> }
    const inherited = inheritBody.levers.find(l => l.scope === 'project' && l.name === 'worktree_isolation')
    expect(inherited).toMatchObject({
      position: 'per_task',
      defaultPosition: 'per_task',
      setBy: 'system-default',
    })

    settings = await loadLeverSettings({
      path: defaultAgentSettingsPath(tmpDir),
    })
    expect(settings.project.worktree_isolation.position).toBe('per_task')
    expect(settings.project.worktree_isolation.setBy).toBe('system-default')
  })

  it('writes parameterized lever positions from UI option values', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })

    const res = await app.fetch(new Request(scoped('/api/config/levers'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scope: 'project',
        name: 'concurrent_task_dispatch',
        position: 'fanout_2',
      }),
    }))
    expect(res.status).toBe(200)

    const settings = await loadLeverSettings({
      path: defaultAgentSettingsPath(tmpDir),
    })
    expect(settings.project.concurrent_task_dispatch.position).toEqual({ kind: 'fanout', n: 2 })
    expect(settings.project.concurrent_task_dispatch.setBy).toBe('user-direct')
  })
})

describe('general project status endpoints', () => {
  it('reports and refreshes the project codebase map', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'settings-test', scripts: { test: 'vitest' }, dependencies: { svelte: '5.0.0' } }, null, 2),
      'utf8',
    )
    await fs.mkdir(path.join(tmpDir, 'src/web/lib'), { recursive: true })
    await fs.writeFile(path.join(tmpDir, 'src/web/lib/Button.svelte'), '<button><slot /></button>\n', 'utf8')
    const { app } = buildServeApp({ projectPath: tmpDir })

    const initial = await app.fetch(new Request(scoped('/api/project/codebase-map/status')))
    expect(initial.status).toBe(200)
    const initialBody = await initial.json() as Record<string, any>
    expect(initialBody).toMatchObject({
      configured: false,
      counts: { abstractions: 0 },
    })
    expect(initialBody.generatedAt).toBeNull()

    const refresh = await app.fetch(new Request(scoped('/api/project/codebase-map/refresh'), { method: 'POST' }))
    expect(refresh.status).toBe(200)
    const refreshBody = await refresh.json() as Record<string, any>
    expect(refreshBody).toMatchObject({
      ok: true,
      mode: 'full',
      status: {
        configured: true,
        counts: { abstractions: 1 },
      },
    })

    const status = await app.fetch(new Request(scoped('/api/project/codebase-map/status')))
    expect(status.status).toBe(200)
    const body = await status.json() as Record<string, any>
    expect(body.configured).toBe(true)
    expect(body.counts.files).toBeGreaterThan(0)
    expect(body.project.summary).toContain('Local project')
    expect(body.project.languages).toContain('svelte')
    expect(body.entrypoints.map((entry: any) => entry.path)).toContain('package.json')
    expect(body.areas.length).toBeGreaterThan(0)
    expect(body.areas[0]).toHaveProperty('canonicalFiles')
    expect(body.abstractions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: 'Command buttons',
          canonicalPath: 'src/web/lib/Button.svelte',
        }),
      ]),
    )
    expect(body.frameworks).toContain('svelte')

    await writeSystemText(
      'codebase-map.yaml',
      [
        'version: 1',
        'generatedAt: 2026-05-21T12:00:00.000Z',
        'project:',
        `  root: ${tmpDir}`,
        '  summary: Fixture',
        '  languages: [typescript]',
        '  packageManagers: [pnpm]',
        '  primaryFrameworks: [svelte]',
        'files: {}',
        'entrypoints: []',
        'areas: []',
        'abstractions: []',
        'verification:',
        '  commands: []',
        'semantic:',
        '  generatedAt: 2026-05-21T12:00:00.000Z',
        '  modelId: zai-org/GLM-4.6',
        '  corpusKind: documentation',
        '  confidence: 0.95',
        '  projectPurpose: Fixture semantic map.',
        '  currentTruth: []',
        '  architectureAreas: []',
        '  canonicalAbstractions: []',
        '  gapsOrRisks: []',
        '  readNext:',
        '    - path: docs/architecture.md',
        '      reason: Read the project architecture first.',
        '  workerGuidance:',
        '    - Use the semantic map before editing.',
        '  needsBroaderRead: true',
      ].join('\n'),
    )
    const semanticStatus = await app.fetch(new Request(scoped('/api/project/codebase-map/status')))
    const semanticBody = await semanticStatus.json() as Record<string, any>
    expect(semanticBody.semantic).toMatchObject({
      modelId: 'zai-org/GLM-4.6',
      corpusKind: 'documentation',
      projectPurpose: 'Fixture semantic map.',
      readNext: [{ path: 'docs/architecture.md', reason: 'Read the project architecture first.' }],
      workerGuidance: ['Use the semantic map before editing.'],
      needsBroaderRead: true,
    })
  })

  it('reports setup status and generated setup defaults for the selected project', async () => {
    writeWorkspaceConfig(tmpDir, {
      ...readWorkspaceConfig(tmpDir),
      id: PROJECT_ID,
      name: 'Settings Test',
      coordinators: [
        {
          id: 'frontend',
          domain: 'frontend',
          mandate: 'Own UI work.',
          concerns: [],
          autonomousDecisions: [],
          escalationTriggers: [],
        },
      ],
      ignore: ['node_modules', 'dist', '.git', 'coverage'],
    })
    writeProjectConfig(tmpDir, { ...readProjectConfig(tmpDir), preferredProvider: 'openai-api' })
    const { app, refreshProjectProjections } = buildServeApp({ projectPath: tmpDir })

    const status = await app.fetch(new Request(scoped('/api/setup/status')))
    expect(status.status).toBe(200)
    const statusBody = await status.json() as Record<string, any>
    expect(statusBody).toMatchObject({
      initialized: true,
      providerConfigured: true,
      name: 'Settings Test',
      id: PROJECT_ID,
      coordinatorCount: 1,
    })

    const defaults = await app.fetch(new Request(scoped('/api/setup/defaults')))
    expect(defaults.status).toBe(200)
    const defaultsBody = await defaults.json() as Record<string, any>
    expect(defaultsBody.suggestedName).toBe('Settings Test')
    expect(defaultsBody.suggestedId).toBe(PROJECT_ID)
    expect(defaultsBody.path).toBe(tmpDir)
    expect(Array.isArray(defaultsBody.localModels)).toBe(true)
    expect(Array.isArray(defaultsBody.cloudModels)).toBe(true)
  })

  it('detects and saves explicit task worktree include paths for local runtime config', async () => {
    await fs.writeFile(path.join(tmpDir, '.env.local'), 'SECRET=do-not-read\n', 'utf8')
    await fs.writeFile(path.join(tmpDir, 'README.md'), '# readme\n', 'utf8')
    await fs.mkdir(path.join(tmpDir, 'frontend'), { recursive: true })
    await execFileP('git', ['init'], { cwd: path.join(tmpDir, 'frontend') })
    await execFileP('git', ['config', 'user.email', 'guildhall@example.test'], { cwd: path.join(tmpDir, 'frontend') })
    await execFileP('git', ['config', 'user.name', 'Guildhall Test'], { cwd: path.join(tmpDir, 'frontend') })
    await fs.writeFile(path.join(tmpDir, 'frontend', '.env'), 'SECRET=tracked\n', 'utf8')
    await execFileP('git', ['add', '.env'], { cwd: path.join(tmpDir, 'frontend') })
    await fs.mkdir(path.join(tmpDir, 'backend'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'backend', 'appsettings.local.yaml'),
      'connection: local\n',
      'utf8',
    )
    const { app } = buildServeApp({ projectPath: tmpDir })

    const before = await app.fetch(new Request(scoped('/api/project/worktree-includes')))
    expect(before.status).toBe(200)
    const beforeBody = await before.json() as Record<string, any>
    expect(beforeBody.include).toEqual([])
    expect(beforeBody.candidates.map((candidate: { path: string }) => candidate.path)).toEqual(
      expect.arrayContaining(['.env.local', 'backend/appsettings.local.yaml']),
    )
    expect(beforeBody.candidates.map((candidate: { path: string }) => candidate.path)).not.toContain('README.md')
    expect(beforeBody.candidates.map((candidate: { path: string }) => candidate.path)).not.toContain('frontend/.env')

    const save = await app.fetch(
      new Request(scoped('/api/project/worktree-includes'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ includeText: '.env.local\nbackend/appsettings.local.yaml\n' }),
      }),
    )
    expect(save.status).toBe(200)
    const saved = await save.json() as Record<string, any>
    expect(saved.include).toEqual(['.env.local', 'backend/appsettings.local.yaml'])
    expect(readWorkspaceConfig(tmpDir).worktree?.include).toEqual([
      '.env.local',
      'backend/appsettings.local.yaml',
    ])
  })

  it('rejects task worktree include paths outside the project root', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })
    const save = await app.fetch(
      new Request(scoped('/api/project/worktree-includes'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ include: ['.env', '../outside.env'] }),
      }),
    )
    expect(save.status).toBe(400)
    const body = await save.json() as Record<string, any>
    expect(body.error).toMatch(/project-relative/i)
  })

  it('saves task worktree include paths on the selected child project in a workspace', async () => {
    await fs.mkdir(path.join(tmpDir, 'looma'), { recursive: true })
    await fs.mkdir(path.join(tmpDir, 'knit'), { recursive: true })
    await fs.writeFile(path.join(tmpDir, 'knit', '.env'), 'SECRET=needed\n', 'utf8')
    await fs.writeFile(path.join(tmpDir, 'knit', 'package.json'), JSON.stringify({ name: 'knit' }), 'utf8')
    writeWorkspaceConfig(tmpDir, {
      ...readWorkspaceConfig(tmpDir),
      kind: 'workspace',
      projectPath: tmpDir,
      projects: [
        { id: 'looma', label: 'Looma', path: 'looma', coordinator: 'looma' },
        { id: 'knit', label: 'Knit', path: 'knit', coordinator: 'knit' },
      ],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })

    const before = await app.fetch(new Request(scoped('/api/project/worktree-includes')))
    expect(before.status).toBe(200)
    const beforeBody = await before.json() as Record<string, any>
    expect(beforeBody.scopes.map((scope: { projectId?: string }) => scope.projectId)).toEqual(['looma', 'knit'])
    const knitScope = beforeBody.scopes.find((scope: { projectId?: string }) => scope.projectId === 'knit')
    expect(knitScope.candidates.map((candidate: { path: string }) => candidate.path)).toContain('.env')

    const saveWithoutChild = await app.fetch(
      new Request(scoped('/api/project/worktree-includes'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ includeText: '.env\n' }),
      }),
    )
    expect(saveWithoutChild.status).toBe(400)

    const save = await app.fetch(
      new Request(scoped('/api/project/worktree-includes'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceProjectId: 'knit', includeText: '.env\n' }),
      }),
    )
    expect(save.status).toBe(200)
    const saved = await save.json() as Record<string, any>
    expect(saved.include).toEqual(['.env'])
    const workspace = readWorkspaceConfig(tmpDir)
    expect(workspace.worktree).toBeUndefined()
    expect(workspace.projects.find(project => project.id === 'knit')?.worktree?.include).toEqual(['.env'])
    expect(workspace.projects.find(project => project.id === 'looma')?.worktree).toBeUndefined()
  })

  it('redacts local config secrets and filters noisy progress entries', async () => {
    writeProjectConfig(tmpDir, {
      ...readProjectConfig(tmpDir),
      preferredProvider: 'anthropic-api',
      anthropicApiKey: 'sk-ant-secret',
      openaiApiKey: 'sk-openai-secret',
    })
    await writeSystemText(
      'PROGRESS.md',
      [
        '# Progress',
        '',
        '### 💓 HEARTBEAT',
        'routine tick',
        '---',
        '### Worker blocked',
        'Useful blocker detail',
        '---',
        '### Escalation',
        'error: Exceeded maximum turn limit',
        '---',
      ].join('\n'),
    )
    const { app } = buildServeApp({ projectPath: tmpDir })

    const config = await app.fetch(new Request(scoped('/api/config')))
    expect(config.status).toBe(200)
    const configBody = await config.json() as Record<string, any>
    expect(configBody.anthropicApiKey).toBe('•••')
    expect(configBody.openaiApiKey).toBe('•••')

    const progress = await app.fetch(new Request(scoped('/api/project/progress')))
    expect(progress.status).toBe(200)
    const progressBody = await progress.json() as { progress: string }
    expect(progressBody.progress).toContain('Worker blocked')
    expect(progressBody.progress).toContain('Useful blocker detail')
    expect(progressBody.progress).not.toContain('HEARTBEAT')
    expect(progressBody.progress).not.toContain('Exceeded maximum turn limit')
  })

  it('reports bootstrap and workspace-import status before either flow has work to do', async () => {
    writeWorkspaceConfig(tmpDir, {
      ...readWorkspaceConfig(tmpDir),
      id: PROJECT_ID,
      name: 'Settings Test',
      bootstrap: {
        commands: ['node --version'],
        successGates: ['node --version'],
        timeoutMs: 300_000,
        provenance: {
          establishedBy: 'test',
          establishedAt: '2026-05-19T16:00:00.000Z',
          tried: [{ command: 'node --version', result: 'pass' }],
        },
      },
      coordinators: [],
      ignore: ['node_modules', 'dist', '.git', 'coverage'],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })

    const needsMeta = await app.fetch(new Request(scoped('/api/project/needs-meta-intake')))
    expect(needsMeta.status).toBe(200)
    expect(await needsMeta.json()).toMatchObject({ needsMetaIntake: expect.any(Boolean) })

    const bootstrap = await app.fetch(new Request(scoped('/api/project/bootstrap/status')))
    expect(bootstrap.status).toBe(200)
    const bootstrapBody = await bootstrap.json() as Record<string, any>
    expect(bootstrapBody.configured).toBe(true)
    expect(bootstrapBody.bootstrap.commands).toEqual(['node --version'])
    expect(bootstrapBody.bootstrap.successGates).toEqual(['node --version'])
    expect(bootstrapBody.bootstrap.provenance.establishedBy).toBe('test')

    const importStatus = await app.fetch(new Request(scoped('/api/project/workspace-import/status')))
    expect(importStatus.status).toBe(200)
    const importBody = await importStatus.json() as Record<string, any>
    expect(importBody).toMatchObject({
      seeded: false,
      taskStatus: null,
      specPresent: false,
      leverPosition: expect.any(String),
    })
    expect(importBody.draft).toMatchObject({
      goals: expect.any(Number),
      tasks: expect.any(Number),
      milestones: expect.any(Number),
    })
  })
})

describe('GET/POST /api/project/local-config', () => {
  it('reports effective landing config and persists advanced landing updates', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })

    const before = await app.fetch(new Request(scoped('/api/project/local-config')))
    expect(before.status).toBe(200)
    const beforeBody = (await before.json()) as {
      landingBranch: string | null
      effectiveLandingBranch: string | null
      landingStrategy: string
    }
    expect(beforeBody.landingBranch).toBeNull()
    expect(beforeBody.effectiveLandingBranch).toBe('main')
    expect(beforeBody.landingStrategy).toBe('cherry_pick_local')

    const save = await app.fetch(
      new Request(scoped('/api/project/local-config'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          landingBranch: 'release/mainline',
          landingStrategy: 'manual_pr',
        }),
      }),
    )
    expect(save.status).toBe(200)
    expect(((await save.json()) as { ok?: boolean }).ok).toBe(true)

    const projectCfg = readProjectConfig(tmpDir)
    expect(projectCfg.landingBranch).toBe('release/mainline')

    const settings = await loadLeverSettings({
      path: defaultAgentSettingsPath(tmpDir),
    })
    expect(settings.project.landing_strategy.position).toBe('manual_pr')
    expect(settings.project.landing_strategy.setBy).toBe('user-direct')
  })
})

describe('POST /api/project/start', () => {
  it('routes configured but unverified bootstrap to the readiness check', async () => {
    writeWorkspaceConfig(tmpDir, {
      ...readWorkspaceConfig(tmpDir),
      id: PROJECT_ID,
      name: 'Settings Test',
      bootstrap: {
        commands: ['pnpm install'],
        successGates: ['pnpm test'],
        timeoutMs: 300_000,
        install: { command: 'pnpm install', status: 'configured' },
      },
    })
    await writeSystemTasks({ version: 1, lastUpdated: new Date().toISOString(), tasks: [] })
    const { app, refreshProjectProjections } = buildServeApp({ projectPath: tmpDir })
    await refreshProjectProjections(tmpDir)

    const project = await app.fetch(new Request(scoped('/api/project?surface=overview')))
    expect(project.status).toBe(200)
    const projectBody = await project.json() as {
      startReadiness?: { canStart?: boolean; code?: string; actionHref?: string }
      actionModel?: { primaryAction?: { code?: string; buttonLabel?: string; href?: string } | null }
      decision?: { primaryAction?: { kind?: string; reasonCode?: string }; execution?: { code?: string; state?: string } }
    }
    expect(projectBody.startReadiness).toMatchObject({
      canStart: false,
      code: 'bootstrap_required',
      actionHref: '/settings/ready',
    })
    expect(projectBody.actionModel?.primaryAction).toMatchObject({
      code: 'bootstrap_required',
      buttonLabel: 'Run bootstrap',
      href: '/settings/ready',
    })
    expect(projectBody.decision).toMatchObject({
      primaryAction: { kind: 'none', reasonCode: 'bootstrap_required' },
      execution: { state: 'blocked', code: 'bootstrap_required' },
    })

    const start = await app.fetch(new Request(scoped('/api/project/start'), { method: 'POST', body: '{}' }))
    expect(start.status).toBe(400)
    expect(await start.json()).toMatchObject({
      code: 'bootstrap_required',
      actionHref: '/settings/ready',
    })
  })

  it('repairs a safe required compact migration before an owner-facing project read', async () => {
    const reviewedAt = '2026-08-29T12:00:00.000Z'
    await writeSystemTasks({
      version: 1,
      lastUpdated: reviewedAt,
      selectedReleaseId: 'release-1',
      tasks: [{
        id: 'task-needs-spec-repair',
        title: 'Repair the legacy spec before review',
        status: 'spec_review',
        releaseIds: ['release-1'],
        spec: 'Legacy rendered Markdown is not an approval contract.',
        acceptanceCriteria: [{
          id: 'ac-1',
          description: 'Guildhall repairs the durable spec before asking the owner to review.',
          verifiedBy: 'review',
          source: 'inferred',
          met: false,
        }],
      }],
      releases: [{
        id: 'release-1',
        label: 'Release 1',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        nodeIds: ['work:task-needs-spec-repair'],
        deferredNodeIds: [],
      }],
    })

    const database = new DatabaseSync(projectStateDatabasePath(tmpDir))
    const row = database.prepare('SELECT summary_json FROM work_items WHERE id = ?').get('task-needs-spec-repair') as { summary_json: string }
    const summary = JSON.parse(row.summary_json) as { currentSummary?: Record<string, unknown> }
    summary.currentSummary = {
      ...summary.currentSummary,
      // Legacy review rows default to owner authority. This is the compact
      // authority produced by an earlier version before readiness existed.
      specReviewAuthority: 'owner',
    }
    delete summary.currentSummary?.specReviewReadyForOwnerApproval
    database.prepare('UPDATE work_items SET summary_json = ? WHERE id = ?').run(
      JSON.stringify(summary),
      'task-needs-spec-repair',
    )
    database.close()

    const { app } = buildServeApp({ projectPath: tmpDir })
    const migrations = await app.fetch(new Request(scoped('/api/project/migrations')))
    expect(migrations.status).toBe(200)
    const migrationsBody = await migrations.json() as Record<string, any>
    expect(migrationsBody.blocked.map((item: { id: string }) => item.id)).not.toContain('0.13.69/compact-spec-review-authority')
    expect(migrationsBody.blocked.map((item: { id: string }) => item.id)).not.toContain('0.13.100/compact-spec-review-readiness')
    expect(migrationsBody.applied.map((item: { id: string }) => item.id)).toContain('0.13.69/compact-spec-review-authority')
    expect(migrationsBody.applied.map((item: { id: string }) => item.id)).toContain('0.13.100/compact-spec-review-readiness')

    const repaired = new DatabaseSync(projectStateDatabasePath(tmpDir), { readOnly: true })
    const repairedRow = repaired.prepare('SELECT summary_json FROM work_items WHERE id = ?').get('task-needs-spec-repair') as { summary_json: string }
    repaired.close()
    expect(JSON.parse(repairedRow.summary_json)).toMatchObject({
      currentSummary: {
        specReviewAuthority: 'owner',
        specReviewReadyForOwnerApproval: false,
      },
    })
  })

  it('blocks project start when required migrations are pending', async () => {
    await fs.mkdir(path.join(tmpDir, 'memory'), { recursive: true })
    await fs.writeFile(path.join(tmpDir, 'memory', 'MEMORY.md'), '# Legacy\n', 'utf8')
    const { app } = buildServeApp({ projectPath: tmpDir })

    const migrations = await app.fetch(new Request(scoped('/api/project/migrations')))
    expect(migrations.status).toBe(200)
    const migrationsBody = await migrations.json() as Record<string, any>
    expect(migrationsBody.blocked.map((item: { id: string }) => item.id)).toContain('0.8.0/project-state-layout')

    const project = await app.fetch(new Request(scoped('/api/project')))
    expect(project.status).toBe(200)
    const projectBody = await project.json() as {
      id?: string
      summaryFreshness?: string
      requiresRefresh?: boolean
    }
    expect(projectBody).toMatchObject({
      id: PROJECT_ID,
      summaryFreshness: 'missing',
    })

    const start = await app.fetch(new Request(scoped('/api/project/start'), { method: 'POST', body: '{}' }))
    expect(start.status).toBe(409)
    const startBody = await start.json() as Record<string, any>
    expect(startBody).toMatchObject({
      code: 'required_migration_pending',
    })

    const apply = await app.fetch(new Request(scoped('/api/project/migrations/apply'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ includeRequired: true, migrationId: '0.8.0/project-state-layout' }),
    }))
    expect(apply.status).toBe(200)
    const applyBody = await apply.json() as Record<string, any>
    expect(applyBody.result.applied.map((item: { id: string }) => item.id)).toContain('0.8.0/project-state-layout')
    expect(applyBody.status.blocked).toEqual([])

    const after = await app.fetch(new Request(scoped('/api/project/migrations')))
    const afterBody = await after.json() as Record<string, any>
    expect(afterBody.blocked).toEqual([])

    const repairedProject = await app.fetch(new Request(scoped('/api/project?surface=work')))
    expect(repairedProject.status).toBe(200)
    const repairedProjectBody = await repairedProject.json() as { startReadiness?: { code?: string } }
    expect(repairedProjectBody.startReadiness?.code).not.toBe('required_migration_pending')
  })

  it('leaves the inbox empty until the saved attention projection is materialized', async () => {
    await fs.mkdir(path.join(tmpDir, 'memory'), { recursive: true })
    await fs.writeFile(path.join(tmpDir, 'memory', 'MEMORY.md'), '# Legacy\n', 'utf8')
    await writeSystemTasks({ version: 1, lastUpdated: new Date().toISOString(), tasks: [] })
    const { app, refreshProjectProjections } = buildServeApp({ projectPath: tmpDir })

    const before = await app.fetch(new Request(scoped('/api/project/inbox')))
    expect(before.status).toBe(200)
    const beforeBody = (await before.json()) as {
      items?: Array<Record<string, any>>
      history?: Array<Record<string, any>>
    }
    expect(beforeBody).toMatchObject({
      items: [],
      history: [],
      freshness: 'missing',
      requiresRefresh: true,
    })

    const apply = await app.fetch(new Request(scoped('/api/project/migrations/apply'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ includePrompt: true, migrationId: '0.8.0/project-state-layout' }),
    }))
    expect(apply.status).toBe(200)

    await refreshProjectProjections(tmpDir)

    const after = await app.fetch(new Request(scoped('/api/project/inbox')))
    const afterBody = (await after.json()) as {
      items?: Array<Record<string, any>>
      history?: Array<Record<string, any>>
    }
    expect(afterBody.items?.some(item => item.id === 'migration:0.8.0/project-state-layout')).toBe(false)
    expect(afterBody.history?.some(item => item.id === 'migration:0.8.0/project-state-layout')).toBe(false)
  })

  it('does not rebuild migration or draft alerts from legacy task files', async () => {
    const yamlPath = path.join(tmpDir, 'guildhall.yaml')
    const current = await fs.readFile(yamlPath, 'utf8')
    await fs.writeFile(
      yamlPath,
      current +
        '\nbootstrap:\n  verifiedAt: "2026-04-24T00:00:00Z"\n  packageManager: pnpm\n  install: { command: "pnpm install", status: ok }\n  gates:\n    lint: { command: "pnpm lint", available: true }\n',
      'utf8',
    )
    await writeSystemJson('workspace-goals.json', { goals: [{ id: 'stage-1', title: 'Stage 1' }] })
    await writeSystemText(
      'project-brief.md',
      'This project already has a scoped import outcome and a current stage.\n',
    )
    await writeLegacySystemJson(
      'TASKS.json',
      {
        version: 1,
        lastUpdated: '2026-06-18T00:00:00.000Z',
        tasks: [
          {
            id: 'task-import-a',
            title: 'Version diff view (deferred)',
            status: 'import_draft',
          },
          {
            id: 'task-import-b',
            title: 'Scope current release proof',
            status: 'import_draft',
            sizePlan: {
              action: 'split_recommended',
              recommendedChildren: [{ title: 'Child A', reason: 'Legacy child.' }],
            },
          },
        ],
      },
    )
    const { app } = buildServeApp({ projectPath: tmpDir })

    const res = await app.fetch(new Request(scoped('/api/project/inbox')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      items?: Array<Record<string, any>>
    }

    expect(body.items).toEqual([])
  })

  it('uses the durable projected readiness in service summaries', async () => {
    registerWorkspace({ id: PROJECT_ID, name: 'Settings Test', path: tmpDir, tags: [] })
    await fs.mkdir(path.join(tmpDir, 'memory'), { recursive: true })
    await fs.writeFile(path.join(tmpDir, 'memory', 'MEMORY.md'), '# Legacy\n', 'utf8')
    await writeSystemTasks({ version: 1, lastUpdated: new Date().toISOString(), tasks: [] })
    const { app } = buildServeApp({ projectPath: tmpDir })

    const service = await app.fetch(new Request('http://localhost/api/service?detail=true'))
    expect(service.status).toBe(200)
    const body = (await service.json()) as {
      projects?: Array<{
        id?: string
        startReadiness?: { canStart?: boolean; code?: string; actionHref?: string }
      }>
    }
    const project = body.projects?.find(entry => entry.id === PROJECT_ID)
    expect(project?.startReadiness).toMatchObject({
      canStart: false,
      code: 'all_terminal',
      actionHref: '/work',
    })
  })

  it('blocks project mutations when project state requires a newer Guildhall runtime', async () => {
    await writeSystemText(
      'runtime.json',
      JSON.stringify({
        version: 1,
        writtenByGuildhall: '999.0.0',
        minGuildhallVersion: '999.0.0',
        stateSchema: 'future-state',
        requiredFeatures: ['future.guildhall-state.v1'],
      }, null, 2),
    )
    const { app } = buildServeApp({ projectPath: tmpDir })

    const project = await app.fetch(new Request(scoped('/api/project')))
    expect(project.status).toBe(200)
    const projectBody = await project.json() as {
      id?: string
      summaryFreshness?: string
      requiresRefresh?: boolean
    }
    expect(projectBody).toMatchObject({
      id: PROJECT_ID,
      summaryFreshness: 'missing',
    })

    const start = await app.fetch(new Request(scoped('/api/project/start'), { method: 'POST', body: '{}' }))
    expect(start.status).toBe(409)
    expect(await start.json()).toMatchObject({
      code: 'runtime_too_old',
      actionHref: '/settings/about',
    })

    const migrations = await app.fetch(new Request(scoped('/api/project/migrations/apply'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ includePrompt: true }),
    }))
    expect(migrations.status).toBe(409)
    expect(await migrations.json()).toMatchObject({
      code: 'runtime_too_old',
    })
  })

  it('marks all-terminal projects as not startable', async () => {
    const now = new Date().toISOString()
    await writeSystemTasks({
        version: 1,
        lastUpdated: now,
        tasks: [
          {
            id: 'task-done-1',
            title: 'Done one',
            description: 'Finished already.',
            domain: 'core',
            status: 'done',
            priority: 'normal',
            acceptanceCriteria: [],
            outOfScope: [],
            dependsOn: [],
            notes: [],
            gateResults: [],
            reviewVerdicts: [],
            adjudications: [],
            escalations: [],
            agentIssues: [],
            revisionCount: 0,
            remediationAttempts: 0,
            createdAt: now,
            updatedAt: now,
          },
          {
            id: 'task-done-2',
            title: 'Done two',
            description: 'Also finished already.',
            domain: 'core',
            status: 'done',
            priority: 'normal',
            acceptanceCriteria: [],
            outOfScope: [],
            dependsOn: [],
            notes: [],
            gateResults: [],
            reviewVerdicts: [],
            adjudications: [],
            escalations: [],
            agentIssues: [],
            revisionCount: 0,
            remediationAttempts: 0,
            createdAt: now,
            updatedAt: now,
          },
        ],
    })

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(scoped('/api/project')))

    expect(res.status).toBe(200)
    const body = await res.json() as { startReadiness?: { canStart?: boolean; code?: string; message?: string } }
    expect(body.startReadiness).toMatchObject({
      canStart: false,
      code: 'all_terminal',
    })
    expect(body.startReadiness?.message).toBe('Current work has no runnable work remaining.')
  })

  it('returns a no-op start response when all tasks are terminal', async () => {
    const now = new Date().toISOString()
    await writeSystemTasks({
        version: 1,
        lastUpdated: now,
        tasks: [
          {
            id: 'task-done-1',
            title: 'Done one',
            description: 'Finished already.',
            domain: 'core',
            status: 'done',
            priority: 'normal',
            acceptanceCriteria: [],
            outOfScope: [],
            dependsOn: [],
            notes: [],
            gateResults: [],
            reviewVerdicts: [],
            adjudications: [],
            escalations: [],
            agentIssues: [],
            revisionCount: 0,
            remediationAttempts: 0,
            createdAt: now,
            updatedAt: now,
          },
          {
            id: 'task-blocked-1',
            title: 'Blocked one',
            description: 'No action can be taken.',
            domain: 'core',
            status: 'blocked',
            priority: 'normal',
            acceptanceCriteria: [],
            outOfScope: [],
            dependsOn: [],
            notes: [],
            gateResults: [],
            reviewVerdicts: [],
            adjudications: [],
            escalations: [],
            agentIssues: [],
            revisionCount: 0,
            remediationAttempts: 0,
            createdAt: now,
            updatedAt: now,
          },
        ],
    })

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(scoped('/api/project/start'), { method: 'POST', body: '{}' }),
    )

    expect(res.status).toBe(200)
    const body = await res.json() as { status?: string; code?: string; stopSummary?: { reason?: string } }
    expect(body).toMatchObject({
      status: 'stopped',
      code: 'all_terminal',
      stopSummary: { reason: 'all_terminal' },
    })
  })

  it('shows the selected release as consumed when only deferred work remains runnable', async () => {
    const now = new Date().toISOString()
    await writeSystemTasks({
      version: 1,
      lastUpdated: now,
      selectedReleaseId: 'headless-mvp',
      releases: [
        {
          id: 'headless-mvp',
          label: 'Headless MVP',
          kind: 'release',
          state: 'active',
          source: 'release_plan',
          nodeIds: ['work:current-done'],
          deferredNodeIds: ['work:later-ready'],
        },
      ],
      tasks: [
        {
          id: 'current-done',
          title: 'Finish current release proof',
          description: 'The selected release work is finished.',
          domain: 'core',
          status: 'done',
          releaseIds: ['headless-mvp'],
          priority: 'normal',
          acceptanceCriteria: [],
          outOfScope: [],
          dependsOn: [],
          notes: [],
          gateResults: [],
          reviewVerdicts: [],
          adjudications: [],
          escalations: [],
          agentIssues: [],
          revisionCount: 0,
          remediationAttempts: 0,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: 'later-ready',
          title: 'Start next release feature',
          description: 'This is outside the selected release.',
          domain: 'core',
          status: 'ready',
          scope: 'later',
          priority: 'critical',
          acceptanceCriteria: ['Later work has its own release boundary.'],
          outOfScope: [],
          dependsOn: [],
          notes: [],
          gateResults: [],
          reviewVerdicts: [],
          adjudications: [],
          escalations: [],
          agentIssues: [],
          revisionCount: 0,
          remediationAttempts: 0,
          createdAt: now,
          updatedAt: now,
        },
      ],
    })
    setProvider('anthropic-api', { apiKey: 'sk-ant-test' })
    updateGlobalConfig({ preferredProvider: 'anthropic-api' })

    const { app, refreshProjectProjections } = buildServeApp({ projectPath: tmpDir })
    await refreshProjectProjections(tmpDir)
    const projectRes = await app.fetch(new Request(scoped('/api/project')))
    expect(projectRes.status).toBe(200)
    const projectBody = await projectRes.json() as {
      startReadiness?: {
        canStart?: boolean
        code?: string
        message?: string
      }
      actionModel?: {
        primaryAction?: {
          source?: string
          taskId?: string
          label?: string
        } | null
        runControl?: {
          label?: string
          startEnabled?: boolean
        }
      }
    }

    expect(projectBody.startReadiness).toMatchObject({
      canStart: false,
      code: 'all_terminal',
      executionScope: {
        id: 'headless-mvp',
        label: 'Headless MVP',
        kind: 'release',
        taskCount: 1,
        deferredTaskCount: 1,
      },
    })
    expect(projectBody.startReadiness?.message).toBe('Headless MVP has no runnable work remaining.')
    expect(projectBody.actionModel?.primaryAction?.taskId).not.toBe('later-ready')
    expect(projectBody.actionModel?.primaryAction?.label ?? '').not.toContain('Start next release feature')
    expect(projectBody.actionModel?.runControl).toMatchObject({
      label: 'No runnable tasks',
      startEnabled: false,
    })

    const startRes = await app.fetch(
      new Request(scoped('/api/project/start'), { method: 'POST', body: '{}' }),
    )
    expect(startRes.status).toBe(200)
    const startBody = await startRes.json() as {
      status?: string
      code?: string
      stopSummary?: { reason?: string }
    }
    expect(startBody).toMatchObject({
      status: 'stopped',
      code: 'all_terminal',
      executionScope: {
        id: 'headless-mvp',
        label: 'Headless MVP',
        kind: 'release',
        taskCount: 1,
        deferredTaskCount: 1,
      },
      stopSummary: { reason: 'all_terminal' },
    })
  })

  it('keeps a completed selected release from being blocked by stale broader import coverage', async () => {
    const now = new Date().toISOString()
    await fs.mkdir(path.join(tmpDir, 'docs', 'harness'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'harness', 'implementation-roadmap.md'),
      [
        '# Implementation Roadmap',
        '',
        '## Stage 1: Fixture And Evaluation Harness',
        '',
        '## Current Next Milestone',
        '',
        'The next milestone is Stage 1: Fixture And Evaluation Harness.',
        '',
        '1. Define fixture, expected-record, prototype-run, and evaluation schemas.',
      ].join('\n'),
      'utf8',
    )
    await writeSystemTasks({
      version: 1,
      lastUpdated: now,
      selectedReleaseId: 'headless-mvp',
      releases: [
        {
          id: 'headless-mvp',
          label: 'Headless MVP',
          kind: 'release',
          state: 'active',
          source: 'release_plan',
          nodeIds: ['work:current-done'],
        },
      ],
      tasks: [
        {
          id: 'task-workspace-import',
          title: 'Review existing project work',
          description: 'Reserved importer',
          domain: '_workspace_import',
          projectPath: tmpDir,
          status: 'done',
          priority: 'normal',
          acceptanceCriteria: [],
          dependsOn: [],
          outOfScope: [],
          spec: [
            '```yaml',
            'goals:',
            '  - id: imported-direction',
            '    title: Narrative Harness',
            '    rationale: A stale importer run only saved the project goal.',
            '```',
          ].join('\n'),
          createdAt: now,
          updatedAt: now,
        },
        {
          id: 'current-done',
          title: 'Finish current release proof',
          description: 'The selected release work is finished.',
          domain: 'core',
          status: 'done',
          releaseIds: ['headless-mvp'],
          priority: 'normal',
          acceptanceCriteria: [],
          outOfScope: [],
          dependsOn: [],
          notes: [],
          gateResults: [],
          reviewVerdicts: [],
          adjudications: [],
          escalations: [],
          agentIssues: [],
          revisionCount: 0,
          remediationAttempts: 0,
          createdAt: now,
          updatedAt: now,
        },
      ],
    })
    setProvider('anthropic-api', { apiKey: 'sk-ant-test' })
    updateGlobalConfig({ preferredProvider: 'anthropic-api' })

    const { app } = buildServeApp({ projectPath: tmpDir })
    const projectRes = await app.fetch(new Request(scoped('/api/project')))
    expect(projectRes.status).toBe(200)
    const body = await projectRes.json() as {
      startReadiness?: { canStart?: boolean; code?: string; message?: string; actionHref?: string }
      actionModel?: {
        primaryAction?: { source?: string; label?: string; detail?: string } | null
        runControl?: { label?: string; startEnabled?: boolean }
      }
      orientationSpine?: { summary?: { headline?: string; topBlocker?: string; nextAction?: string } }
    }

    expect(body.startReadiness?.canStart).toBe(false)
    expect(body.startReadiness?.code).not.toBe('workspace_import_refresh_needed')
    expect(body.startReadiness?.message ?? '').not.toContain('under-scoped')
    expect(body.actionModel?.primaryAction?.label ?? '').not.toContain('Workspace import')
    expect(body.actionModel?.runControl?.startEnabled).toBe(false)
    expect(body.orientationSpine?.summary?.headline ?? '').not.toContain('needs import refresh')
    expect(body.orientationSpine?.summary?.topBlocker ?? '').not.toBe('Workspace import is under-scoped.')
  })

  it('reads explicit task release membership from the durable release envelope', async () => {
    const now = new Date().toISOString()
    await writeSystemTasks({
      version: 1,
      lastUpdated: now,
      selectedReleaseId: 'headless-mvp',
      releases: [
        {
          id: 'headless-mvp',
          label: 'Headless MVP',
          kind: 'release',
          state: 'active',
          source: 'release_plan',
          nodeIds: ['work:current-done'],
          deferredNodeIds: ['work:later-ready'],
        },
      ],
      tasks: [
        {
          id: 'current-done',
          title: 'Finish current release proof',
          description: 'The explicitly selected release work is finished.',
          domain: 'core',
          status: 'done',
          releaseIds: ['headless-mvp'],
          priority: 'normal',
          acceptanceCriteria: [],
          outOfScope: [],
          dependsOn: [],
          notes: [],
          gateResults: [],
          reviewVerdicts: [],
          adjudications: [],
          escalations: [],
          agentIssues: [],
          revisionCount: 0,
          remediationAttempts: 0,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: 'later-ready',
          title: 'Start next release feature',
          description: 'This is outside the explicitly selected release.',
          domain: 'core',
          status: 'ready',
          scope: 'later',
          priority: 'critical',
          acceptanceCriteria: [],
          outOfScope: [],
          dependsOn: [],
          notes: [],
          gateResults: [],
          reviewVerdicts: [],
          adjudications: [],
          escalations: [],
          agentIssues: [],
          revisionCount: 0,
          remediationAttempts: 0,
          createdAt: now,
          updatedAt: now,
        },
      ],
    })
    setProvider('anthropic-api', { apiKey: 'sk-ant-test' })
    updateGlobalConfig({ preferredProvider: 'anthropic-api' })

    const { app } = buildServeApp({ projectPath: tmpDir })
    const projectRes = await app.fetch(new Request(scoped('/api/project')))
    const projectBody = await projectRes.json() as {
      startReadiness?: { canStart?: boolean; code?: string; message?: string }
      actionModel?: { runControl?: { startEnabled?: boolean } }
    }

    expect(projectBody.startReadiness).toMatchObject({
      canStart: false,
      code: 'all_terminal',
      executionScope: {
        id: 'headless-mvp',
        label: 'Headless MVP',
        kind: 'release',
        taskCount: 1,
        deferredTaskCount: 1,
      },
    })
    expect(projectBody.startReadiness?.message).toBe('Headless MVP has no runnable work remaining.')
    expect(projectBody.actionModel?.runControl?.startEnabled).toBe(false)

    const startRes = await app.fetch(
      new Request(scoped('/api/project/start'), { method: 'POST', body: '{}' }),
    )
    expect(startRes.status).toBe(200)
    const startBody = await startRes.json() as { code?: string }
    expect(startBody.code).toBe('all_terminal')
  })

  it('does not infer a release from task membership during saved readiness reads', async () => {
    const now = new Date().toISOString()
    await writeSystemTasks({
      version: 1,
      lastUpdated: now,
      tasks: [
        {
          id: 'release-parent',
          title: 'Build release harness',
          description: 'Selected release container.',
          domain: 'core',
          status: 'done',
          releaseIds: ['headless-mvp'],
          requestIntake: { createdBy: 'workspace-importer' },
          priority: 'normal',
          acceptanceCriteria: [],
          outOfScope: [],
          dependsOn: [],
          notes: [],
          gateResults: [],
          reviewVerdicts: [],
          adjudications: [],
          escalations: [],
          agentIssues: [],
          revisionCount: 0,
          remediationAttempts: 0,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: 'release-parent-split-review-proof',
          title: 'Review proof packet',
          description: 'A generated child split under the selected release parent.',
          domain: 'core',
          status: 'spec_review',
          workVisibility: { kind: 'primary', countInProjectTotals: true },
          hierarchy: { parentId: 'release-parent', childIds: [], relation: 'decomposes', order: 0 },
          spec: 'Spec that needs owner review.',
          priority: 'normal',
          acceptanceCriteria: [{ text: 'Reviewed.', met: false }],
          outOfScope: [],
          dependsOn: [],
          notes: [],
          gateResults: [],
          reviewVerdicts: [],
          adjudications: [],
          escalations: [],
          agentIssues: [],
          revisionCount: 0,
          remediationAttempts: 0,
          createdAt: now,
          updatedAt: now,
        },
      ],
    })
    setProvider('anthropic-api', { apiKey: 'sk-ant-test' })
    updateGlobalConfig({ preferredProvider: 'anthropic-api' })

    const { app } = buildServeApp({ projectPath: tmpDir })
    const projectRes = await app.fetch(new Request(scoped('/api/project')))
    expect(projectRes.status).toBe(200)
    const projectBody = await projectRes.json() as {
      startReadiness?: { canStart?: boolean; code?: string; message?: string; focusTaskId?: string }
      actionModel?: { runControl?: { startEnabled?: boolean } }
    }

    expect(projectBody.startReadiness).toMatchObject({
      canStart: false,
      code: 'no_unattended_progress',
      focusTaskId: 'release-parent-split-review-proof',
    })
    expect(projectBody.startReadiness?.message).toContain('Review proof packet')
    expect(projectBody.actionModel?.runControl?.startEnabled).toBe(false)

    const readinessRes = await app.fetch(new Request(scoped('/api/project/release-readiness')))
    const readiness = await readinessRes.json() as {
      totals?: { tasks?: number; unfinishedCount?: number; humanBlockingCount?: number }
      diagnostics?: {
        statusCounts?: Record<string, number>
        unapprovedSpecs?: Array<{ id: string }>
      }
    }
    expect(readiness.totals).toMatchObject({
      tasks: 1,
      unfinishedCount: 1,
      humanBlockingCount: 1,
    })
    // Optional releases do not infer a named release from task membership,
    // but current work still needs to remain visible in the project scope.
    expect(readiness.diagnostics?.statusCounts?.spec_review).toBe(1)
    expect(readiness.diagnostics?.unapprovedSpecs).toBeUndefined()
  })

  it('does not call a selected release consumed when completed current work is still missing proof', async () => {
    const now = new Date().toISOString()
    await writeSystemTasks({
      version: 1,
      lastUpdated: now,
      selectedReleaseId: 'headless-mvp',
      releases: [
        {
          id: 'headless-mvp',
          label: 'Headless MVP',
          kind: 'release',
          state: 'active',
          source: 'release_plan',
          nodeIds: ['work:current-done'],
          deferredNodeIds: ['work:later-ready'],
        },
      ],
      tasks: [
        {
          id: 'current-done',
          title: 'Run fixture evaluator proof',
          description: 'The selected release work has implementation status but no attached proof evidence yet.',
          domain: 'core',
          status: 'done',
          releaseIds: ['headless-mvp'],
          proofPaths: ['artifacts/fixture-evaluator-proof.md'],
          priority: 'normal',
          acceptanceCriteria: [],
          outOfScope: [],
          dependsOn: [],
          notes: [],
          gateResults: [],
          reviewVerdicts: [],
          adjudications: [],
          escalations: [],
          agentIssues: [],
          revisionCount: 0,
          remediationAttempts: 0,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: 'later-ready',
          title: 'Start next release feature',
          description: 'This is outside the selected release.',
          domain: 'core',
          status: 'ready',
          scope: 'later',
          priority: 'critical',
          acceptanceCriteria: ['Later work has its own release boundary.'],
          outOfScope: [],
          dependsOn: [],
          notes: [],
          gateResults: [],
          reviewVerdicts: [],
          adjudications: [],
          escalations: [],
          agentIssues: [],
          revisionCount: 0,
          remediationAttempts: 0,
          createdAt: now,
          updatedAt: now,
        },
      ],
    })

    setProvider('anthropic-api', { apiKey: 'sk-ant-test' })
    updateGlobalConfig({ preferredProvider: 'anthropic-api' })
    writeProjectConfig(tmpDir, { ...readProjectConfig(tmpDir), preferredProvider: 'anthropic-api' })
    await applyCanonicalMigrations()

    const { app } = buildServeApp({ projectPath: tmpDir })
    const projectRes = await app.fetch(new Request(scoped('/api/project')))
    expect(projectRes.status).toBe(200)
    const projectBody = await projectRes.json() as {
      startReadiness?: {
        canStart?: boolean
        code?: string
        message?: string
        actionHref?: string
        focusTaskId?: string
        focusTaskTitle?: string
        focusKind?: string
        proofTaskIds?: string[]
      }
      orientationSpine?: {
        summary?: {
          headline?: string
          topBlocker?: string | null
          nextAction?: string
        }
      }
      actionModel?: {
        runControl?: {
          label?: string
          startEnabled?: boolean
        }
      }
    }

    expect(projectBody.startReadiness).toMatchObject({
      canStart: false,
      code: 'proof_evidence_missing',
      focusTaskId: 'current-done',
    })
    expect(projectBody.actionModel?.runControl).toMatchObject({
      label: 'Resume',
      startEnabled: true,
    })

    const startRes = await app.fetch(
      new Request(scoped('/api/project/start'), { method: 'POST', body: '{}' }),
    )
    const startBody = await startRes.json() as { status?: string; mode?: string }
    expect(startRes.status, JSON.stringify(startBody)).toBe(200)
    expect(startBody).toMatchObject({
      status: 'running',
      mode: 'continuous',
    })
    const tasks = await readTasks(tmpDir)
    const reopened = tasks.find(task => task.id === 'current-done')
    expect(reopened).toMatchObject({
      status: 'in_progress',
    })
    expect(JSON.stringify(reopened?.notes ?? [])).toContain('Reopen completed task for missing release proof')
  })

  it('uses scoped release proof blockers for project start instead of stale hidden split rows', async () => {
    const now = new Date().toISOString()
    await writeSystemTasks({
      version: 1,
      lastUpdated: now,
      selectedReleaseId: 'headless-mvp',
      releases: [
        {
          id: 'headless-mvp',
          label: 'Stage 1: Headless Drafting MVP',
          kind: 'release',
          state: 'active',
          source: 'release_plan',
          proofStyle: 'script_only',
          nodeIds: ['work:imported-parent', 'work:real-proof-gap'],
          deferredNodeIds: [],
        },
      ],
      tasks: [
        {
          id: 'imported-parent',
          title: 'Define fixture, expected-record, prototype-run, and evaluation schemas.',
          description: 'Imported parent work with command-backed proof already recorded.',
          domain: 'core',
          status: 'done',
          releaseIds: ['headless-mvp'],
          proofPaths: [{
            kind: 'command',
            command: 'pnpm test:schema',
            title: 'Run schema proof',
            launchSteps: [{ id: 'schema-proof', title: 'Run schema proof', kind: 'copy_command', command: 'pnpm test:schema' }],
            expectedEvidence: [{ id: 'schema-proof', description: 'Schema proof command passed.' }],
            verificationRecords: [{ evidenceId: 'schema-proof', status: 'passed' }],
          }],
          gateResults: [{
            gateId: 'schema-proof',
            command: 'pnpm test:schema',
            type: 'hard',
            passed: true,
            output: 'pnpm test:schema passed.',
            checkedAt: now,
          }],
          requestIntake: {
            createdBy: 'workspace-importer',
            evidenceRefs: ['import:docs/harness/implementation-roadmap.md'],
          },
          priority: 'normal',
          acceptanceCriteria: [],
          outOfScope: [],
          dependsOn: [],
          notes: [],
          reviewVerdicts: [],
          adjudications: [],
          escalations: [],
          agentIssues: [],
          revisionCount: 0,
          remediationAttempts: 0,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: 'imported-parent-split-shape-fixture-and-expected-record-ground-truth',
          title: 'Shape fixture and expected-record ground truth',
          description: 'Hidden imported split row that should not become the selected-release proof blocker.',
          domain: 'core',
          status: 'done',
          releaseIds: ['headless-mvp'],
          hierarchy: { parentId: 'imported-parent', relation: 'decomposes' },
          requestIntake: {
            createdBy: 'workspace-importer',
            evidenceRefs: ['import:docs/harness/implementation-roadmap.md'],
          },
          priority: 'normal',
          acceptanceCriteria: [],
          outOfScope: [],
          dependsOn: [],
          notes: [],
          gateResults: [],
          reviewVerdicts: [],
          adjudications: [],
          escalations: [],
          agentIssues: [],
          revisionCount: 0,
          remediationAttempts: 0,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: 'real-proof-gap',
          title: 'Prove world-state continuity review over elapsed-time object changes.',
          description: 'The selected release still needs real proof here.',
          domain: 'core',
          status: 'done',
          releaseIds: ['headless-mvp'],
          proofPaths: [{
            kind: 'review',
            source: 'inferred',
            expectedEvidence: ['Headless command proof records the world-state continuity review result.'],
          }],
          priority: 'normal',
          acceptanceCriteria: [],
          outOfScope: [],
          dependsOn: [],
          notes: [],
          gateResults: [],
          reviewVerdicts: [],
          adjudications: [],
          escalations: [],
          agentIssues: [],
          revisionCount: 0,
          remediationAttempts: 0,
          createdAt: now,
          updatedAt: now,
        },
      ],
    })

    const { app } = buildServeApp({ projectPath: tmpDir })

    const readinessRes = await app.fetch(new Request(scoped('/api/project/release-readiness?live=true')))
    expect(readinessRes.status).toBe(200)
    const readiness = await readinessRes.json() as {
      diagnostics?: {
        proofMissingDoneTasks?: Array<{ id: string }>
        totals?: { proofEvidenceBlockingCount?: number }
      }
    }
    expect(readiness.diagnostics?.proofMissingDoneTasks?.map(task => task.id)).toEqual(['real-proof-gap'])
    expect(readiness.diagnostics?.totals?.proofEvidenceBlockingCount).toBe(1)

    const projectRes = await app.fetch(new Request(scopedDiagnostic('/api/project')))
    expect(projectRes.status).toBe(200)
    const projectBody = await projectRes.json() as {
      startReadiness?: {
        code?: string
        focusTaskId?: string
        proofTaskIds?: string[]
        count?: number
        message?: string
      }
    }
    expect(projectBody.startReadiness).toMatchObject({
      code: 'proof_evidence_missing',
      focusTaskId: 'real-proof-gap',
      proofTaskIds: ['real-proof-gap'],
      count: 1,
    })
    expect(projectBody.startReadiness?.message).toContain('Prove world-state continuity')
    expect(projectBody.startReadiness?.message).not.toContain('Shape fixture')
  })

  it('reopens script-only work when review proof exists but executable proof is missing', async () => {
    const now = new Date().toISOString()
    await writeSystemTasks({
      version: 1,
      lastUpdated: now,
      selectedReleaseId: 'headless-mvp',
      releases: [
        {
          id: 'headless-mvp',
          label: 'Headless MVP',
          kind: 'release',
          state: 'active',
          source: 'release_plan',
          proofStyle: 'script_only',
          nodeIds: ['work:completed-with-review-only-proof'],
          deferredNodeIds: [],
        },
      ],
      tasks: [
        {
          id: 'completed-with-review-only-proof',
          title: 'Run the headless synopsis proof',
          description: 'A review exists, but this script-only release still needs executable proof.',
          domain: 'core',
          status: 'done',
          releaseIds: ['headless-mvp'],
          proofPaths: [{
            kind: 'review',
            source: 'inferred',
            status: 'verified',
            expectedEvidence: ['The implementation boundary is coherent.'],
          }],
          priority: 'normal',
          acceptanceCriteria: [],
          outOfScope: [],
          dependsOn: [],
          notes: [],
          gateResults: [],
          reviewVerdicts: [],
          adjudications: [],
          escalations: [],
          agentIssues: [],
          revisionCount: 0,
          remediationAttempts: 0,
          createdAt: now,
          updatedAt: now,
        },
      ],
    })

    setProvider('anthropic-api', { apiKey: 'sk-ant-test' })
    updateGlobalConfig({ preferredProvider: 'anthropic-api' })
    writeProjectConfig(tmpDir, { ...readProjectConfig(tmpDir), preferredProvider: 'anthropic-api' })
    await applyCanonicalMigrations()

    const { app } = buildServeApp({ projectPath: tmpDir })
    const projectRes = await app.fetch(new Request(scoped('/api/project')))
    expect(projectRes.status).toBe(200)
    const projectBody = await projectRes.json() as {
      startReadiness?: { canStart?: boolean; code?: string; focusTaskId?: string }
    }
    expect(projectBody.startReadiness).toMatchObject({
      canStart: false,
      code: 'proof_evidence_missing',
      focusTaskId: 'completed-with-review-only-proof',
    })

    const startRes = await app.fetch(new Request(scoped('/api/project/start'), { method: 'POST', body: '{}' }))
    expect(startRes.status).toBe(200)
    const tasks = await readTasks(tmpDir)
    expect(tasks.find(task => task.id === 'completed-with-review-only-proof')).toMatchObject({ status: 'in_progress' })
  })

  it('treats archived, cancelled, and pending PR tasks as terminal for Start readiness', async () => {
    const now = new Date().toISOString()
    await writeSystemTasks({
      version: 1,
      lastUpdated: now,
      tasks: [
        {
          id: 'task-done-1',
          title: 'Done one',
          description: 'Finished already.',
          domain: 'core',
          status: 'done',
          priority: 'normal',
          acceptanceCriteria: [],
          outOfScope: [],
          dependsOn: [],
          notes: [],
          gateResults: [],
          reviewVerdicts: [],
          adjudications: [],
          escalations: [],
          agentIssues: [],
          revisionCount: 0,
          remediationAttempts: 0,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: 'task-pr-1',
          title: 'Pending PR one',
          description: 'Already pushed and waiting to merge.',
          domain: 'core',
          status: 'pending_pr',
          priority: 'normal',
          acceptanceCriteria: [],
          outOfScope: [],
          dependsOn: [],
          notes: [],
          gateResults: [],
          reviewVerdicts: [],
          adjudications: [],
          escalations: [],
          agentIssues: [],
          revisionCount: 0,
          remediationAttempts: 0,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: 'task-archived-1',
          title: 'Archived one',
          description: 'Shadow import preserved for audit only.',
          domain: 'core',
          status: 'archived',
          priority: 'normal',
          acceptanceCriteria: [],
          outOfScope: [],
          dependsOn: [],
          notes: [],
          gateResults: [],
          reviewVerdicts: [],
          adjudications: [],
          escalations: [],
          agentIssues: [],
          revisionCount: 0,
          remediationAttempts: 0,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: 'task-cancelled-1',
          title: 'Cancelled one',
          description: 'Superseded and no longer actionable.',
          domain: 'core',
          status: 'cancelled',
          priority: 'normal',
          acceptanceCriteria: [],
          outOfScope: [],
          dependsOn: [],
          notes: [],
          gateResults: [],
          reviewVerdicts: [],
          adjudications: [],
          escalations: [],
          agentIssues: [],
          revisionCount: 0,
          remediationAttempts: 0,
          createdAt: now,
          updatedAt: now,
        },
      ],
    })

    const { app } = buildServeApp({ projectPath: tmpDir })
    const projectRes = await app.fetch(new Request(scoped('/api/project')))

    expect(projectRes.status).toBe(200)
    const projectBody = await projectRes.json() as {
      startReadiness?: {
        canStart?: boolean
        code?: string
        message?: string
      }
    }
    expect(projectBody.startReadiness).toMatchObject({
      canStart: false,
      code: 'all_terminal',
    })
    expect(projectBody.startReadiness?.message).toBe('Current work has no runnable work remaining.')

    const startRes = await app.fetch(
      new Request(scoped('/api/project/start'), { method: 'POST', body: '{}' }),
    )
    expect(startRes.status).toBe(200)
    const startBody = await startRes.json() as {
      code?: string
      stopSummary?: {
        counts?: {
          done?: number
          pendingPr?: number
          archived?: number
          cancelled?: number
          actionable?: number
          terminal?: number
        }
      }
    }
    expect(startBody).toMatchObject({
      code: 'all_terminal',
      stopSummary: {
        counts: {
          done: 1,
          pendingPr: 1,
          archived: 1,
          cancelled: 1,
          actionable: 0,
          terminal: 4,
        },
      },
    })
  })

  it('does not block Start on archived-only residue when nothing actionable remains', async () => {
    const now = new Date().toISOString()
    await writeSystemTasks({
      version: 1,
      lastUpdated: now,
      tasks: [
        {
          id: 'task-archived-1',
          title: 'Archived one',
          description: 'Kept only for audit trail.',
          domain: 'core',
          status: 'archived',
          priority: 'normal',
          acceptanceCriteria: [],
          outOfScope: [],
          dependsOn: [],
          notes: [],
          gateResults: [],
          reviewVerdicts: [],
          adjudications: [],
          escalations: [],
          agentIssues: [],
          revisionCount: 0,
          remediationAttempts: 0,
          createdAt: now,
          updatedAt: now,
        },
      ],
    })

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(scoped('/api/project/start'), { method: 'POST', body: '{}' }),
    )

    expect(res.status).toBe(200)
    const body = await res.json() as { status?: string; code?: string; stopSummary?: { reason?: string } }
    expect(body).toMatchObject({
      status: 'stopped',
      code: 'all_terminal',
      stopSummary: { reason: 'all_terminal' },
    })
  })

  it('does not treat a targeted recoverable worktree blocker as all-terminal', async () => {
    const now = new Date().toISOString()
    const taskId = 'task-recover-worktree'
    await writeSystemTasks({
        version: 1,
        lastUpdated: now,
        tasks: [
          {
            id: taskId,
            title: 'Recover worktree task',
            description: 'Previously blocked on stale worktree setup.',
            domain: 'core',
            status: 'blocked',
            priority: 'normal',
            blockReason:
              "Guildhall could not create a task worktree: fatal: '/tmp/task-worktree' already exists. Fix the worktree setup issue, then resume the task.",
            acceptanceCriteria: [],
            outOfScope: [],
            dependsOn: [],
            notes: [
              {
                agentId: 'worker-agent',
                role: 'self-critique',
                content: 'Guildhall-owned task work was already attempted.',
                timestamp: now,
              },
            ],
            gateResults: [],
            reviewVerdicts: [],
            adjudications: [],
            escalations: [],
            agentIssues: [],
            revisionCount: 0,
            remediationAttempts: 0,
            createdAt: now,
            updatedAt: now,
          },
        ],
    })

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(scoped('/api/project/start'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'one_task', taskId }),
      }),
    )
    const body = await res.json() as { code?: string; stopSummary?: { reason?: string } }

    expect(body.code).not.toBe('all_terminal')
    expect(body.stopSummary?.reason).not.toBe('all_terminal')
  })

  it('reopens a legacy worktree-sync blocker before Start evaluates unattended progress', async () => {
    const now = new Date().toISOString()
    const taskId = 'task-recover-worktree-sync'
    await writeSystemTasks({
      version: 1,
      lastUpdated: now,
      tasks: [
        {
          id: taskId,
          title: 'Recover typed worktree sync',
          description: 'Continue the existing task worktree after a historical merge stop.',
          domain: 'core',
          status: 'blocked',
          priority: 'normal',
          recoveryCode: 'task_worktree_sync_conflict',
          blockReason: 'Older Guildhall asked an owner to resolve its task worktree merge.',
          acceptanceCriteria: [],
          outOfScope: [],
          dependsOn: [],
          notes: [],
          gateResults: [],
          reviewVerdicts: [],
          adjudications: [],
          escalations: [],
          agentIssues: [],
          revisionCount: 0,
          remediationAttempts: 0,
          createdAt: now,
          updatedAt: now,
        },
      ],
    })

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(scoped('/api/project/start'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'one_task', taskId }),
      }),
    )

    expect(res.status).not.toBe(400)
    const task = (await readTasks(tmpDir)).find(candidate => candidate.id === taskId)
    expect(task).toMatchObject({
      status: 'in_progress',
      assignedTo: 'worker-agent',
    })
    expect(task?.blockReason).toBeUndefined()
    expect(task?.recoveryCode).toBeUndefined()
  })

  it('points Start at imported draft review when no runnable work is available', async () => {
    await writeSystemTasks({
        version: 1,
        lastUpdated: new Date().toISOString(),
        tasks: [
          {
            id: 'task-import-1',
            title: 'Imported draft',
            description: 'Needs shaping before work can run.',
            domain: 'core',
            status: 'import_draft',
            priority: 'normal',
            acceptanceCriteria: [],
            outOfScope: [],
            dependsOn: [],
            notes: [],
            gateResults: [],
            reviewVerdicts: [],
            adjudications: [],
            escalations: [],
            agentIssues: [],
            revisionCount: 0,
            remediationAttempts: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
    })
    const { app, refreshProjectProjections } = buildServeApp({ projectPath: tmpDir })
    await refreshProjectProjections(tmpDir)

    const projectRes = await app.fetch(new Request(scopedDiagnostic('/api/project')))
    const projectBody = (await projectRes.json()) as {
      startReadiness?: { canStart?: boolean; code?: string; actionHref?: string; message?: string }
    }
    expect(projectBody.startReadiness).toMatchObject({
      canStart: false,
      code: 'import_drafts_waiting',
      actionHref: '/task/task-import-1',
    })
    expect(projectBody.startReadiness?.message).toContain('Review the imported draft')

    const startRes = await app.fetch(
      new Request(scoped('/api/project/start'), { method: 'POST', body: '{}' }),
    )
    expect(startRes.status).toBe(400)
    const startBody = (await startRes.json()) as { code?: string; actionHref?: string }
    expect(startBody.code).toBe('import_drafts_waiting')
    expect(startBody.actionHref).toBe('/task/task-import-1')
  })

  it('treats approved import drafts as shaping backlog instead of ongoing import review', async () => {
    const now = new Date().toISOString()
    await writeSystemTasks({
        version: 1,
        lastUpdated: now,
        tasks: [
          {
            id: 'task-workspace-import',
            title: 'Import project notes and plans',
            description: 'Reserved importer.',
            domain: '_workspace_import',
            status: 'done',
            priority: 'high',
            acceptanceCriteria: [],
            outOfScope: [],
            dependsOn: [],
            notes: [],
            gateResults: [],
            reviewVerdicts: [],
            adjudications: [],
            escalations: [],
            agentIssues: [],
            revisionCount: 0,
            remediationAttempts: 0,
            createdAt: now,
            updatedAt: now,
          },
          {
            id: 'task-import-1',
            title: 'Define fixture schemas',
            description: 'Needs shaping before work can run.',
            domain: 'core',
            status: 'import_draft',
            priority: 'normal',
            acceptanceCriteria: [],
            outOfScope: [],
            dependsOn: [],
            notes: [],
            gateResults: [],
            reviewVerdicts: [],
            adjudications: [],
            escalations: [],
            agentIssues: [],
            revisionCount: 0,
            remediationAttempts: 0,
            createdAt: now,
            updatedAt: now,
          },
        ],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })

    const projectRes = await app.fetch(new Request(scopedDiagnostic('/api/project')))
    const projectBody = (await projectRes.json()) as {
      startReadiness?: { canStart?: boolean; code?: string; actionHref?: string; message?: string }
      orientationSpine?: { summary?: { headline?: string; topBlocker?: string; nextAction?: string; includedCount?: number; progress?: { total?: number; done?: number } } }
    }
    expect(projectBody.startReadiness).toMatchObject({
      canStart: false,
      code: 'imported_scope_shaping',
      actionHref: '/task/task-import-1',
    })
    expect(projectBody.startReadiness?.message).toContain('still needs source-backed shaping')
    expect(projectBody.orientationSpine?.summary).toMatchObject({
      headline: 'Current task scope needs attention.',
      nextAction: expect.stringContaining('Define fixture schemas'),
      includedCount: 1,
      progress: { total: 1, done: 0 },
    })
    const overviewProjectRes = await app.fetch(new Request(scopedDiagnostic('/api/project?surface=overview')))
    const overviewProjectBody = (await overviewProjectRes.json()) as {
      orientationSpine?: { summary?: { nextAction?: string } }
    }
    expect(overviewProjectBody.orientationSpine?.summary?.nextAction).toContain('Define fixture schemas')

    const startRes = await app.fetch(
      new Request(scoped('/api/project/start'), { method: 'POST', body: '{}' }),
    )
    expect(startRes.status).toBe(400)
    const startBody = (await startRes.json()) as { code?: string; actionHref?: string }
    expect(startBody.code).toBe('imported_scope_shaping')
    expect(startBody.actionHref).toBe('/task/task-import-1')
  })

  it('lets selected release Start advance an exploring import task before raw drafts', async () => {
    const now = new Date().toISOString()
    await writeSystemTasks({
        version: 1,
        selectedReleaseId: 'release-stage-1',
        lastUpdated: now,
        releases: [
          {
            id: 'release-stage-1',
            label: 'Stage 1: Fixture And Evaluation Harness',
            kind: 'release',
            state: 'active',
            source: 'release_plan',
            nodeIds: ['work:task-import-shaped', 'work:task-import-waiting', 'work:task-current-ready'],
            deferredNodeIds: ['work:task-future-ready'],
            proofStyle: 'script_only',
          },
        ],
        tasks: [
          {
            id: 'task-workspace-import',
            title: 'Import project notes and plans',
            description: 'Reserved importer.',
            domain: '_workspace_import',
            status: 'done',
            priority: 'high',
            acceptanceCriteria: [],
            outOfScope: [],
            dependsOn: [],
            notes: [],
            gateResults: [],
            reviewVerdicts: [],
            adjudications: [],
            escalations: [],
            agentIssues: [],
            revisionCount: 0,
            remediationAttempts: 0,
            createdAt: now,
            updatedAt: now,
          },
          {
            id: 'task-import-shaped',
            title: 'Define fixture manifest and run result schemas',
            description: 'Drafted import context, but no owner-approved brief exists yet.',
            domain: 'core',
            status: 'exploring',
            priority: 'normal',
            releaseIds: ['release-stage-1'],
            spec: 'Imported task spec text from docs.',
            acceptanceCriteria: [],
            outOfScope: [],
            dependsOn: [],
            notes: [
              {
                agentId: 'workspace-importer',
                role: 'importer',
                content: 'Imported from docs.',
                timestamp: now,
              },
              {
                agentId: 'human',
                role: 'shaping-request',
                content: 'User asked Guildhall to shape this imported draft into a complete task.',
                timestamp: now,
              },
            ],
            gateResults: [],
            reviewVerdicts: [],
            adjudications: [],
            escalations: [],
            agentIssues: [],
            revisionCount: 0,
            remediationAttempts: 0,
            createdAt: now,
            updatedAt: now,
          },
          {
            id: 'task-import-waiting',
            title: 'Build evaluation command fixtures',
            description: 'Needs shaping before work can run.',
            domain: 'core',
            status: 'import_draft',
            priority: 'normal',
            releaseIds: ['release-stage-1'],
            acceptanceCriteria: [],
            outOfScope: [],
            dependsOn: [],
            notes: [
              {
                agentId: 'workspace-importer',
                role: 'importer',
                content: 'Imported from docs.',
                timestamp: now,
              },
            ],
            gateResults: [],
            reviewVerdicts: [],
            adjudications: [],
            escalations: [],
            agentIssues: [],
            revisionCount: 0,
            remediationAttempts: 0,
            createdAt: now,
            updatedAt: now,
          },
          {
            id: 'task-future-ready',
            title: 'Future ready task',
            description: 'Outside the selected release.',
            domain: 'core',
            status: 'ready',
            priority: 'normal',
            productBrief: {
              userJob: 'Run a future task.',
              whyItMattersNow: 'It matters later.',
              successMetric: 'The future task completes.',
              nonGoals: ['Do not include in Stage 1.'],
              approvedAt: now,
            },
            spec: 'Complete future task spec.',
            acceptanceCriteria: ['The future task works.'],
            outOfScope: [],
            dependsOn: [],
            notes: [],
            gateResults: [],
            reviewVerdicts: [],
            adjudications: [],
            escalations: [],
            agentIssues: [],
            revisionCount: 0,
            remediationAttempts: 0,
            createdAt: now,
            updatedAt: now,
          },
          {
            id: 'task-current-ready',
            title: 'Ready selected-release task',
            description: 'Runnable, but it must not let Start skip import shaping.',
            domain: 'core',
            status: 'ready',
            priority: 'normal',
            releaseIds: ['release-stage-1'],
            productBrief: {
              userJob: 'Run a selected-release task.',
              whyItMattersNow: 'It belongs to Stage 1.',
              successMetric: 'The selected-release task completes.',
              nonGoals: [],
              approvedAt: now,
            },
            spec: 'Complete selected-release task spec.',
            acceptanceCriteria: ['The selected-release task works.'],
            outOfScope: [],
            dependsOn: [],
            notes: [],
            gateResults: [],
            reviewVerdicts: [],
            adjudications: [],
            escalations: [],
            agentIssues: [],
            revisionCount: 0,
            remediationAttempts: 0,
            createdAt: now,
            updatedAt: now,
          },
        ],
    })
    setProvider('anthropic-api', { apiKey: 'sk-ant-test' })
    updateGlobalConfig({ preferredProvider: 'anthropic-api' })
    const { app } = buildServeApp({ projectPath: tmpDir })

    const projectRes = await app.fetch(new Request(scopedDiagnostic('/api/project')))
    const projectBody = (await projectRes.json()) as {
      startReadiness?: { canStart?: boolean; code?: string; actionHref?: string; message?: string }
    }
    expect(projectBody.startReadiness).toMatchObject({ canStart: true })

    const overviewRes = await app.fetch(new Request(scoped('/api/project?surface=overview')))
    const overviewBody = (await overviewRes.json()) as {
      startReadiness?: { canStart?: boolean; message?: string }
      orientationSpine?: { summary?: { nextAction?: string } }
    }
    expect(overviewBody.startReadiness).toMatchObject({ canStart: true })
    expect(overviewBody.startReadiness?.message).toBeTruthy()
    expect(overviewBody.orientationSpine?.summary?.nextAction).toBe(overviewBody.startReadiness?.message)

    const startRes = await app.fetch(
      new Request(scoped('/api/project/start'), { method: 'POST', body: '{}' }),
    )
    expect(startRes.status).toBe(200)
  })

  it('blocks Start when ready tasks still need brief cleanup', async () => {
    const now = new Date().toISOString()
    await writeSystemTasks({
        version: 1,
        lastUpdated: now,
        tasks: [
          {
            id: 'task-thin-ready',
            title: 'Thin ready task',
            description: 'Looks queued but has no approved brief or acceptance criteria.',
            domain: 'core',
            status: 'ready',
            priority: 'normal',
            acceptanceCriteria: [],
            outOfScope: [],
            dependsOn: [],
            notes: [],
            gateResults: [],
            reviewVerdicts: [],
            adjudications: [],
            escalations: [],
            agentIssues: [],
            revisionCount: 0,
            remediationAttempts: 0,
            createdAt: now,
            updatedAt: now,
          },
        ],
      })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const projectRes = await app.fetch(new Request(scopedDiagnostic('/api/project')))
    const projectBody = (await projectRes.json()) as {
      startReadiness?: { canStart?: boolean; code?: string; actionHref?: string; message?: string }
    }

    expect(projectBody.startReadiness).toMatchObject({
      canStart: false,
      code: 'no_unattended_progress',
      actionHref: '/work?task=task-thin-ready',
      focusTaskId: 'task-thin-ready',
      focusTaskTitle: 'Thin ready task',
      focusKind: 'brief_cleanup',
      count: 1,
    })
    expect(projectBody.startReadiness?.message).toContain('Thin ready task')
    expect(projectBody.startReadiness?.message).toContain('clearer brief')
  })

  it('does not treat ready tasks with a spec and acceptance criteria as brief cleanup', async () => {
    const now = new Date().toISOString()
    await writeSystemTasks({
      version: 1,
      lastUpdated: now,
      tasks: [
        {
          id: 'task-spec-shaped-ready',
          title: 'Add the first tiny fiction fixture and human-authored expected records.',
          description: 'Spec-shaped ready work should be runnable even if imported brief copy is thin.',
          domain: 'core',
          status: 'ready',
          priority: 'normal',
          productBrief: {
            userJob: 'Build a no-UI fixture proof.',
            whyItMattersNow: 'The MVP needs reusable ground truth.',
            successMetric: 'Fixture records are available.',
            nonGoals: [],
          },
          spec: 'Fixture spec.',
          acceptanceCriteria: [{ id: 'AC-1', description: 'Fixture records exist.', verifiedBy: 'test', met: false }],
          outOfScope: [],
          dependsOn: [],
          notes: [],
          gateResults: [],
          reviewVerdicts: [],
          adjudications: [],
          escalations: [],
          agentIssues: [],
          revisionCount: 0,
          remediationAttempts: 0,
          createdAt: now,
          updatedAt: now,
        },
      ],
    })

    const { app } = buildServeApp({ projectPath: tmpDir })
    const projectRes = await app.fetch(new Request(scoped('/api/project')))
    const projectBody = (await projectRes.json()) as {
      startReadiness?: { canStart?: boolean; code?: string; actionHref?: string; message?: string; focusKind?: string }
    }

    expect(projectBody.startReadiness?.code).not.toBe('no_unattended_progress')
    expect(projectBody.startReadiness?.focusKind).not.toBe('brief_cleanup')
    expect(projectBody.startReadiness?.message ?? '').not.toContain('clearer brief')
  })

  it('points owner-input Start blockers at the linked Thread session', async () => {
    const now = new Date().toISOString()
    await writeSystemTasks({
        version: 1,
        lastUpdated: now,
        tasks: [
          {
            id: 'task-blocked',
            title: 'Blocked task',
            description: 'Already has a separate escalation.',
            domain: 'core',
            status: 'blocked',
            priority: 'normal',
            acceptanceCriteria: [],
            outOfScope: [],
            dependsOn: [],
            notes: [],
            openQuestions: [],
            escalations: [{ id: 'esc-1', summary: 'Build is failing' }],
            agentIssues: [],
            gateResults: [],
            reviewVerdicts: [],
            adjudications: [],
            revisionCount: 0,
            remediationAttempts: 0,
            createdAt: now,
            updatedAt: now,
          },
          {
            id: 'task-question',
            title: 'Question task',
            description: 'Needs one owner decision.',
            domain: 'core',
            status: 'exploring',
            priority: 'normal',
            acceptanceCriteria: [],
            outOfScope: [],
            dependsOn: [],
            notes: [],
            openQuestions: [],
            escalations: [],
            agentIssues: [],
            gateResults: [],
            reviewVerdicts: [],
            adjudications: [],
            revisionCount: 0,
            remediationAttempts: 0,
            createdAt: now,
            updatedAt: now,
          },
        ],
      })
    await seedThreadOwnerInput({
      taskId: 'task-question',
      questionId: 'q-1',
      now,
      label: 'Clarify Question task',
      prompt: 'Which API shape should this component use?',
      choices: ['Stencil component', 'Vanilla web component'],
    })

    const { app } = buildServeApp({ projectPath: tmpDir })
    const projectRes = await app.fetch(new Request(scoped('/api/project')))
    const projectBody = (await projectRes.json()) as {
      startReadiness?: { canStart?: boolean; code?: string; actionHref?: string; message?: string }
    }

    const request = await readFirstOwnerInputRequest()

    expect(projectBody.startReadiness).toMatchObject({
      canStart: false,
      code: 'owner_input_required',
      actionHref: `/thread?thread=${request.boundedChatSessionId}`,
    })
    expect(projectBody.startReadiness?.message).toContain('Clarify Question task needs your answer')
  })

  it('uses a friendly structural-map label in owner-input Start blockers', async () => {
    const now = new Date().toISOString()
    await writeSystemTasks({
        version: 1,
        lastUpdated: now,
        tasks: [],
      })
    await seedThreadOwnerInput({
      taskId: 'structural-map-mpyrvqjg',
      questionId: 'owner-input-1',
      now,
      label: 'Review structural map structural-map-mpyrvqjg',
      prompt: 'Review the proposed domains before Guildhall uses this map for routing.',
      choices: ['Use this map', 'Something looks wrong'],
    })

    const { app } = buildServeApp({ projectPath: tmpDir })
    const projectRes = await app.fetch(new Request(scoped('/api/project')))
    const projectBody = (await projectRes.json()) as {
      startReadiness?: { canStart?: boolean; code?: string; message?: string }
    }

    expect(projectBody.startReadiness).toMatchObject({
      canStart: false,
      code: 'owner_input_required',
      message: 'Review the project map needs your answer before work can continue',
    })
    expect(projectBody.startReadiness?.message).not.toContain('structural-map-mpyrvqjg')
  })

  it('points recovery-only Start blockers at the newest blocked task instead of stale historical blockers', async () => {
    const older = '2026-05-19T10:00:00.000Z'
    const newer = '2026-05-19T12:00:00.000Z'
    await writeSystemTasks({
        version: 1,
        lastUpdated: newer,
        tasks: [
          {
            id: 'task-old-import',
            title: 'Old import blocker',
            description: 'Historical blocked task.',
            domain: 'core',
            status: 'blocked',
            priority: 'normal',
            acceptanceCriteria: [],
            outOfScope: [],
            dependsOn: [],
            notes: [],
            openQuestions: [],
            escalations: [{ id: 'esc-old', summary: 'Old recovery path' }],
            agentIssues: [],
            gateResults: [],
            reviewVerdicts: [],
            adjudications: [],
            revisionCount: 0,
            remediationAttempts: 0,
            createdAt: older,
            updatedAt: older,
          },
          {
            id: 'task-current',
            title: 'Current blocked task',
            description: 'The task the user is looking at now.',
            domain: 'core',
            status: 'blocked',
            priority: 'normal',
            acceptanceCriteria: [],
            outOfScope: [],
            dependsOn: [],
            notes: [],
            openQuestions: [],
            escalations: [{ id: 'esc-current', summary: 'Current recovery path' }],
            agentIssues: [],
            gateResults: [],
            reviewVerdicts: [],
            adjudications: [],
            revisionCount: 0,
            remediationAttempts: 0,
            createdAt: newer,
            updatedAt: newer,
          },
        ],
      })
    await seedThreadOwnerInput({
      taskId: 'task-current',
      questionId: 'esc-current',
      now: newer,
      kind: 'recovery_decision',
      label: 'Choose recovery path for Current blocked task',
      prompt: 'How should Guildhall recover the current blocked task?',
      choices: ['Retry with more context', 'Shelve it for now'],
    })

    const { app } = buildServeApp({ projectPath: tmpDir })
    const projectRes = await app.fetch(new Request(scoped('/api/project')))
    const projectBody = (await projectRes.json()) as {
      startReadiness?: { canStart?: boolean; code?: string; actionHref?: string; message?: string }
    }

    const request = await readFirstOwnerInputRequest()

    expect(projectBody.startReadiness).toMatchObject({
      canStart: false,
      code: 'owner_input_required',
      actionHref: `/thread?thread=${request.boundedChatSessionId}`,
    })
    expect(projectBody.startReadiness?.message).toContain('Choose recovery path for Current blocked task')
  })

  it('does not treat in-progress work with a block reason as resumable Start work', async () => {
    const now = new Date().toISOString()
    await writeSystemTasks({
      version: 1,
      lastUpdated: now,
      tasks: [
        {
          id: 'task-stage-2',
          title: 'Implement Stage 2 reviewer',
          description: 'This task was selected before its prerequisites were modeled.',
          domain: 'core',
          status: 'in_progress',
          priority: 'normal',
          assignedTo: 'worker-agent',
          blockReason: 'Stage sequencing violation: Stage 1 is not complete.',
          acceptanceCriteria: [],
          outOfScope: [],
          dependsOn: [],
          notes: [],
          openQuestions: [],
          escalations: [],
          agentIssues: [],
          gateResults: [],
          reviewVerdicts: [],
          adjudications: [],
          revisionCount: 0,
          remediationAttempts: 0,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: 'task-ready',
          title: 'Runnable sibling',
          description: 'Another task in the same current scope.',
          domain: 'core',
          status: 'ready',
          priority: 'normal',
          acceptanceCriteria: ['Run the sibling proof.'],
          outOfScope: [],
          dependsOn: [],
          notes: [],
          openQuestions: [],
          escalations: [],
          agentIssues: [],
          gateResults: [],
          reviewVerdicts: [],
          adjudications: [],
          revisionCount: 0,
          remediationAttempts: 0,
          createdAt: now,
          updatedAt: now,
        },
      ],
    })

    const { app } = buildServeApp({ projectPath: tmpDir })
    const projectRes = await app.fetch(new Request(scopedDiagnostic('/api/project')))
    const projectBody = (await projectRes.json()) as {
      startReadiness?: { canStart?: boolean; code?: string; actionHref?: string; message?: string; focusKind?: string }
    }

    expect(projectBody.startReadiness).toMatchObject({
      canStart: false,
      code: 'no_unattended_progress',
      actionHref: '/work?task=task-stage-2',
      focusKind: 'blocked_work',
    })
    expect(projectBody.startReadiness?.message).toContain('Implement Stage 2 reviewer')
    expect(projectBody.startReadiness?.message).toContain('Stage sequencing violation')
  })

  it('rejects focused task starts while project-level owner input is still blocking Start', async () => {
    const now = new Date().toISOString()
    await writeSystemTasks({
        version: 1,
        lastUpdated: now,
        tasks: [
          {
            id: 'task-needs-answer',
            title: 'Needs answer first',
            description: 'The project-level blocker.',
            domain: 'core',
            status: 'exploring',
            priority: 'normal',
            acceptanceCriteria: [],
            outOfScope: [],
            dependsOn: [],
            notes: [],
            openQuestions: [],
            escalations: [],
            agentIssues: [],
            gateResults: [],
            reviewVerdicts: [],
            adjudications: [],
            revisionCount: 0,
            remediationAttempts: 0,
            createdAt: now,
            updatedAt: now,
          },
          {
            id: 'task-other',
            title: 'Other ready-looking task',
            description: 'This should not be startable while the project is blocked.',
            domain: 'core',
            status: 'ready',
            priority: 'normal',
            acceptanceCriteria: ['It has a real acceptance criterion.'],
            outOfScope: [],
            dependsOn: [],
            notes: [],
            productBrief: {
              userJob: 'Move another task forward.',
              successMetric: 'The task completes.',
              approvedAt: now,
            },
            escalations: [],
            agentIssues: [],
            gateResults: [],
            reviewVerdicts: [],
            adjudications: [],
            revisionCount: 0,
            remediationAttempts: 0,
            createdAt: now,
            updatedAt: now,
          },
        ],
      })
    await seedThreadOwnerInput({
      taskId: 'task-needs-answer',
      questionId: 'q-1',
      now,
      label: 'Clarify Needs answer first',
      prompt: 'Which implementation direction should Guildhall use?',
      choices: ['Option A', 'Option B'],
    })

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(scoped('/api/project/start'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'one_task', taskId: 'task-other', scope: 'work_item' }),
      }),
    )

    expect(res.status).toBe(409)
    const body = (await res.json()) as { code?: string; actionHref?: string; error?: string }
    const request = await readFirstOwnerInputRequest()

    expect(body).toMatchObject({
      code: 'owner_input_required',
      actionHref: `/thread?thread=${request.boundedChatSessionId}`,
    })
    expect(body.error).toContain('An owner decision needs your answer before work can continue')
  })

  it('rejects fanout without worktree isolation with a clear error', async () => {
    const settings = makeDefaultSettings()
    settings.project.concurrent_task_dispatch = {
      position: { kind: 'fanout', n: 3 },
      rationale: 'fan out tasks',
      setAt: new Date().toISOString(),
      setBy: 'user-direct',
    }
    settings.project.worktree_isolation = {
      position: 'none',
      rationale: 'bad combo',
      setAt: new Date().toISOString(),
      setBy: 'user-direct',
    }
    const settingsPath = defaultAgentSettingsPath(tmpDir)
    // write the invalid historical file directly to simulate a bad legacy/edit state
    await fs.mkdir(path.dirname(settingsPath), { recursive: true })
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf8')

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(scoped('/api/project/start'), { method: 'POST', body: '{}' }),
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error?: string; code?: string; actionHref?: string }
    expect(body.code).toBe('invalid_lever_combo')
    expect(body.error).toContain('fanout_N requires worktree_isolation')
    expect(body.actionHref).toBe('/settings/advanced')
  })

  it('rejects targeted task starts while a project run is already active', async () => {
    const supervisor = new OrchestratorSupervisor({
      resolveConfig: () => ({ workspaceId: PROJECT_ID, projectPath: tmpDir } as ResolvedConfig),
      runOrchestrator: async (_config, opts) => {
        await new Promise<void>((resolve) => {
          opts?.abortSignal?.addEventListener('abort', () => resolve(), { once: true })
        })
        return { ticks: 1, stopReason: 'stop_requested', stopMessage: 'Stop requested.' }
      },
    })
    const { app } = buildServeApp({ projectPath: tmpDir, supervisor })
    supervisor.start({
      workspaceId: PROJECT_ID,
      workspacePath: tmpDir,
    })

    const res = await app.fetch(
      new Request(scoped('/api/project/start'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ taskId: 'task-a', mode: 'continuous' }),
      }),
    )
    expect(res.status).toBe(409)
    const body = (await res.json()) as { code?: string; status?: string; error?: string }
    expect(body.code).toBe('run_already_active')
    expect(body.status).toBe('running')
    expect(body.error).toContain('run is already active')

    await supervisor.stop(PROJECT_ID, { waitMs: 1_000 })
  })
})

// Recovery path: if the on-disk agent-settings.yaml is missing a lever that
// was added to the Zod schema, `GET /api/config/levers` throws
// LeverSettingsCorruptError. POST /api/config/levers/reset wipes the file and
// re-seeds from defaults so the UI can recover without shelling in.
describe('POST /api/config/levers/reset', () => {
  it('rewrites the lever file with default positions so subsequent reads succeed', async () => {
    const settingsPath = getProjectSystemStatePath(tmpDir, 'agent-settings.yaml')
    const { app } = buildServeApp({ projectPath: tmpDir })

    // Corrupt the file beyond self-heal (bad YAML). Missing-key corruption
    // is auto-repaired by loadLeverSettings, so we need a structurally
    // broken file here to force the 500 path.
    await fs.mkdir(path.dirname(settingsPath), { recursive: true })
    await fs.writeFile(settingsPath, 'version: "one"\nproject: {}\ndomains: {}\n', 'utf8')
    const bad = await app.fetch(new Request(scoped('/api/config/levers')))
    expect(bad.status).toBe(500)

    // Reset → ok.
    const reset = await app.fetch(
      new Request(scoped('/api/config/levers/reset'), { method: 'POST' }),
    )
    expect(reset.status).toBe(200)
    expect(((await reset.json()) as { ok?: boolean }).ok).toBe(true)

    // Follow-up read succeeds and contains the seeded defaults.
    const good = await app.fetch(new Request(scoped('/api/config/levers')))
    expect(good.status).toBe(200)
    const body = (await good.json()) as { levers: Array<{ name: string; setBy: string }> }
    expect(body.levers.length).toBeGreaterThan(0)
    expect(body.levers.every(l => l.setBy === 'system-default')).toBe(true)
  })
})

// When guildhall.yaml has no legacy bootstrap.commands block, POST
// /api/project/bootstrap/run should fall back to structural detection so
// bootstrap isn't silently a no-op.
describe('POST /api/project/bootstrap/run — auto-detect fallback', () => {
  it('runs the detector, writes the structural block, and returns a success payload', async () => {
    // Seed a minimal node project the detector can resolve (package.json with
    // a typecheck script + tsconfig.json). Install is skipped by spawner
    // injection is not available here — but without a lockfile the runner is
    // `none`, so the detector skips install and just probes gates.
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'detect-me', scripts: { typecheck: 'echo ok' } }, null, 2),
      'utf8',
    )
    await fs.writeFile(path.join(tmpDir, 'tsconfig.json'), '{}', 'utf8')

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(scoped('/api/project/bootstrap/run'), { method: 'POST' }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      success: boolean
      detected?: { packageManager?: string; verifiedAt?: string; gates?: Record<string, unknown> }
      logs?: string[]
    }
    expect(body.detected).toBeDefined()
    expect(typeof body.detected?.verifiedAt).toBe('string')
    expect(body.detected?.packageManager).toBe('none')
    expect(body.detected?.gates).toBeDefined()

    // File was written.
    const yamlText = await fs.readFile(path.join(tmpDir, 'guildhall.yaml'), 'utf8')
    // Keys may be double-quoted under the QUOTE_DOUBLE stringifier; match
    // either quoted or unquoted form.
    expect(yamlText).toMatch(/verifiedAt/)
    expect(yamlText).toMatch(/packageManager/)
  })

  it('runs configured child project bootstraps for a workspace envelope', async () => {
    await fs.mkdir(path.join(tmpDir, 'looma'), { recursive: true })
    await fs.mkdir(path.join(tmpDir, 'knit'), { recursive: true })
    writeWorkspaceConfig(tmpDir, {
      ...readWorkspaceConfig(tmpDir),
      kind: 'workspace',
      projectPath: '.',
      bootstrap: undefined,
      projects: [
        {
          id: 'looma',
          label: 'Looma',
          path: 'looma',
          bootstrap: {
            commands: ['node -e "process.exit(0)"'],
            successGates: ['node -e "process.exit(0)"'],
            timeoutMs: 30_000,
          },
        },
        {
          id: 'knit',
          label: 'Knit',
          path: 'knit',
          bootstrap: {
            commands: ['node -e "process.exit(0)"'],
            successGates: ['node -e "process.exit(0)"'],
            timeoutMs: 30_000,
          },
        },
      ],
    })

    const { app } = buildServeApp({ projectPath: tmpDir })
    const statusRes = await app.fetch(new Request(scoped('/api/project/bootstrap/status')))
    expect(statusRes.status).toBe(200)
    const statusBefore = (await statusRes.json()) as {
      configured: boolean
      bootstrap?: { commands?: string[]; successGates?: string[] }
    }
    expect(statusBefore.configured).toBe(true)
    expect(statusBefore.bootstrap?.commands).toEqual([
      `cd 'looma' && node -e "process.exit(0)"`,
      `cd 'knit' && node -e "process.exit(0)"`,
    ])

    const runRes = await app.fetch(
      new Request(scoped('/api/project/bootstrap/run'), { method: 'POST' }),
    )
    expect(runRes.status).toBe(200)
    const body = (await runRes.json()) as {
      success: boolean
      status?: { steps?: Array<{ command: string; result: string }> }
      detected?: unknown
    }
    expect(body.success).toBe(true)
    expect(body.detected).toBeUndefined()
    expect(body.status?.steps?.map(step => [step.command, step.result])).toEqual([
      [`cd 'looma' && node -e "process.exit(0)"`, 'pass'],
      [`cd 'knit' && node -e "process.exit(0)"`, 'pass'],
      [`cd 'looma' && node -e "process.exit(0)"`, 'pass'],
      [`cd 'knit' && node -e "process.exit(0)"`, 'pass'],
    ])

    const yamlText = await fs.readFile(path.join(tmpDir, 'guildhall.yaml'), 'utf8')
    expect(yamlText).not.toMatch(/packageManager/)
    expect(yamlText).not.toMatch(/no package\.json/)
  })
})

// Facts endpoint: aggregates identity, environment, workspace discoveries,
// coordinators, and design-system state with editHref pointers. Surfaces on
// the `/facts` route. Must never crash if a section is missing — undefined
// sections come back as null/empty.
describe('GET /api/project/facts', () => {
  it('returns all sections with editHrefs even on a bare-bootstrap workspace', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(scoped('/api/project/facts')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.identity.name).toBeDefined()
    expect(body.identity.id).toBeDefined()
    expect(typeof body.identity.editHref).toBe('string')
    expect(body.identity.editHref).toBe('/settings/advanced')
    expect(body.environment.editHref).toBe('/settings')
    expect(body.workspace.reviewHref).toBe(`/projects/${PROJECT_ID}/workspace-import`)
    expect(body.coordinators.editHref).toBe('/settings/routing')
    expect(body.designSystem.editHref).toBe('/settings')
    expect(Array.isArray(body.environment.packageManagers)).toBe(true)
    expect(body.environment.packageManagers).toEqual(['unknown'])
  })

  it('reports multiple package managers when the repo clearly spans ecosystems', async () => {
    await fs.mkdir(path.join(tmpDir, 'frontend'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'frontend', 'package.json'),
      JSON.stringify({ name: 'frontend', packageManager: 'pnpm@10.0.0' }, null, 2),
      'utf8',
    )
    await fs.writeFile(path.join(tmpDir, 'frontend', 'pnpm-lock.yaml'), 'lockfileVersion: 9.0', 'utf8')
    await fs.mkdir(path.join(tmpDir, 'backend'), { recursive: true })
    await fs.writeFile(path.join(tmpDir, 'backend', 'backend.csproj'), '<Project />', 'utf8')

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(scoped('/api/project/facts')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { environment: { packageManagers: string[] } }
    expect(body.environment.packageManagers).toEqual(['unknown'])
  })

  it('counts saved completed workspace-import specs in the memory check-in facts', async () => {
    await writeSystemJson(
      'workspace-goals.json',
      {
        version: 2,
        recordedAt: '2026-01-01T00:00:00.000Z',
        goals: [{ id: 'imported-goal', title: 'Imported goal', rationale: 'Captures the imported scope baseline.' }],
        tasks: [
          {
            id: 'imported-task-one',
            title: 'First imported task',
            description: 'README.md: First imported task.',
            domain: 'core',
            priority: 'normal',
            references: [],
          },
          {
            id: 'imported-task-two',
            title: 'Second imported task',
            description: 'README.md: Second imported task.',
            domain: 'core',
            priority: 'normal',
            references: [],
          },
        ],
        milestones: [
          { title: 'First milestone', evidence: 'README.md' },
          { title: 'Second milestone', evidence: 'README.md' },
        ],
        approved: {
          goalCount: 1,
          taskCount: 2,
          milestoneCount: 2,
          currentTaskCount: 2,
          laterTaskCount: 0,
          taskIds: ['imported-task-one', 'imported-task-two'],
        },
        detected: {
          goalCount: 1,
          taskCount: 2,
          milestoneCount: 2,
          currentTaskCount: 2,
          laterTaskCount: 0,
          taskIds: ['imported-task-one', 'imported-task-two'],
        },
      },
    )
    await writeSystemText(
      'TASKS.json',
      JSON.stringify(
        {
          version: 1,
          tasks: [
            {
              id: 'task-workspace-import',
              title: 'Review existing project work',
              status: 'done',
              spec: [
                '```yaml',
                'goals:',
                '  - id: imported-goal',
                '    title: Imported goal',
                '    rationale: Captures the imported scope baseline.',
                '```',
                '```yaml',
                'tasks:',
                '  - id: imported-task-one',
                '    title: First imported task',
                '    description: README.md: First imported task.',
                '    domain: core',
                '    priority: normal',
                '  - id: imported-task-two',
                '    title: Second imported task',
                '    description: README.md: Second imported task.',
                '    domain: core',
                '    priority: normal',
                '```',
                '```yaml',
                'milestones:',
                '  - title: First milestone',
                '    evidence: README.md',
                '  - title: Second milestone',
                '    evidence: README.md',
                '```',
              ].join('\n'),
            },
          ],
        },
        null,
        2,
      ),
    )

    const { app, refreshProjectProjections } = buildServeApp({ projectPath: tmpDir })
    await refreshProjectProjections(tmpDir)
    const res = await app.fetch(new Request(scoped('/api/project/facts')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      workspace: { goals: { imported: boolean; goalCount: number; taskCount: number; milestoneCount: number } }
    }
    expect(body.workspace.goals).toMatchObject({
      imported: true,
      goalCount: 1,
      taskCount: 2,
      milestoneCount: 2,
    })
  })
})

// POST /api/project/workspace-import/dismiss — writes a dismissed marker so
// the Inbox stops nagging; Facts still shows "dismissed" so the user can
// re-review. Replaces the confusing "Scan workspace" prompt.
describe('POST /api/project/workspace-import/dismiss', () => {
  it('writes the dismissed marker and suppresses the inbox item', async () => {
    // Seed files that make buildInbox emit workspace_import_pending.
    await fs.writeFile(path.join(tmpDir, 'README.md'), '# Test\n', 'utf8')
    await fs.writeFile(path.join(tmpDir, 'package.json'), '{"name":"x"}', 'utf8')
    await writeSystemTasks({ version: 1, lastUpdated: new Date().toISOString(), tasks: [] })
    const { app, refreshProjectProjections } = buildServeApp({ projectPath: tmpDir })
    await refreshProjectProjections(tmpDir)

    const before = await app.fetch(new Request(scoped('/api/project/inbox')))
    const beforeBody = (await before.json()) as { items: Array<{ kind: string }> }
    expect(beforeBody.items.some(i => i.kind === 'workspace_import_pending')).toBe(true)

    const dismiss = await app.fetch(
      new Request(scoped('/api/project/workspace-import/dismiss'), { method: 'POST' }),
    )
    expect(dismiss.status).toBe(200)
    expect(((await dismiss.json()) as { ok?: boolean }).ok).toBe(true)

    await refreshProjectProjections(tmpDir)

    const after = await app.fetch(new Request(scoped('/api/project/inbox')))
    const afterBody = (await after.json()) as { items: Array<{ kind: string }> }
    expect(afterBody.items.some(i => i.kind === 'workspace_import_pending')).toBe(false)

    // Facts surface reflects the dismissed state.
    const facts = await app.fetch(new Request(scoped('/api/project/facts')))
    const factsBody = (await facts.json()) as { workspace: { goals: { dismissed: boolean } | null } }
    expect(factsBody.workspace.goals?.dismissed).toBe(true)
  })
})

// GET /api/version exposes the runtime package version so the header can
// render "Guildhall v0.2.0-dev" next to the wordmark.
describe('GET /api/version', () => {
  it('returns a non-empty version string', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request('http://localhost/api/version'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { version?: string }
    expect(typeof body.version).toBe('string')
    expect((body.version ?? '').length).toBeGreaterThan(0)
  })
})

describe('GET /api/stale-server', () => {
  it('returns the served bundle freshness payload used by release smoke', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request('http://localhost/api/stale-server'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      stale?: boolean
      processStartedAt?: string
      bootBuildMtimeMs?: number
      currentBuildMtimeMs?: number
    }
    expect(body.stale).toBe(false)
    expect(typeof body.processStartedAt).toBe('string')
    expect(typeof body.bootBuildMtimeMs).toBe('number')
    expect(typeof body.currentBuildMtimeMs).toBe('number')
  })

  it('stops stale Guildhall siblings before reporting freshness', async () => {
    let killed = false
    const killProcess = vi.fn(() => {
      killed = true
    })
    const { app } = buildServeApp({
      projectPath: tmpDir,
      staleProcessGuard: {
        killProcess,
        listProcesses: async () => killed
          ? []
          : [{
              pid: 12345,
              startedAtMs: 1,
              command: '/Users/matthew/.guildhall/app/0.10.0/app/dist/cli.js mcp serve .',
              mode: 'mcp',
              stale: false,
            }],
      },
    })

    const res = await app.fetch(new Request('http://localhost/api/stale-server'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { staleProcesses?: unknown[] }
    expect(killProcess).toHaveBeenCalledWith(12345, 'SIGTERM')
    expect(body.staleProcesses).toBeUndefined()
  })
})

describe('GET /api/service', () => {
  it('isolates an unavailable registered project from the fleet shell', async () => {
    const brokenProjectPath = await fs.mkdtemp(path.join(tmpDir, 'broken-project-'))
    await fs.writeFile(path.join(brokenProjectPath, 'guildhall.yaml'), 'id: [not valid\n', 'utf8')
    registerWorkspace({ id: PROJECT_ID, name: 'Settings Test', path: tmpDir, tags: [] })
    registerWorkspace({ id: 'broken-settings-project', name: 'Broken Settings Project', path: brokenProjectPath, tags: [] })
    const { app } = buildServeApp({ projectPath: tmpDir })

    try {
      const res = await app.fetch(new Request('http://localhost/api/service/projects'))
      expect(res.status).toBe(200)
      const body = (await res.json()) as { projects?: Array<Record<string, any>> }
      expect(body.projects).toHaveLength(2)
      expect(body.projects?.find(item => item.id === PROJECT_ID)).toMatchObject({
        id: PROJECT_ID,
        projectStatusLoading: false,
      })
      expect(body.projects?.find(item => item.id === 'broken-settings-project')).toMatchObject({
        id: 'broken-settings-project',
        projectStatusLoading: false,
        summaryFreshness: 'missing',
        projectStatusError: expect.stringContaining('fleet summary'),
      })
    } finally {
      unregisterWorkspace(PROJECT_ID)
      unregisterWorkspace('broken-settings-project')
    }
  })

  it('serves the current fleet shell without reconstructing project detail', async () => {
    registerWorkspace({ id: PROJECT_ID, name: 'Settings Test', path: tmpDir, tags: [] })
    await writeSystemTasks({ version: 1, lastUpdated: new Date().toISOString(), tasks: [] })
    const service = buildServeApp({ projectPath: tmpDir })
    await service.refreshProjectProjections(tmpDir)

    const res = await service.app.fetch(new Request('http://localhost/api/service/projects'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { projects?: Array<Record<string, any>> }
    const project = body.projects?.find(item => item.id === PROJECT_ID)
    expect(project).toMatchObject({
      id: PROJECT_ID,
      name: 'Settings Test',
      path: tmpDir,
      projectStatusLoading: false,
      summaryFreshness: 'current',
    })
    expect(project?.migrationSummary).toBeUndefined()
    expect(project?.actionModel).toMatchObject({
      runControl: expect.any(Object),
    })
    expect(project?.startReadiness).toBeDefined()
  })

  it('publishes a required migration as the fleet action before a saved work decision', async () => {
    registerWorkspace({ id: PROJECT_ID, name: 'Settings Test', path: tmpDir, tags: [] })
    await writeSystemTasks({
      version: 1,
      lastUpdated: new Date().toISOString(),
      tasks: [{
        id: 'task-review',
        title: 'Review the prepared spec',
        description: 'The owner needs to review this spec.',
        domain: 'runtime',
        projectPath: tmpDir,
        status: 'spec_review',
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
    })
    await fs.mkdir(path.join(tmpDir, 'memory'), { recursive: true })
    await fs.writeFile(path.join(tmpDir, 'memory', 'MEMORY.md'), '# Legacy\n', 'utf8')
    const service = buildServeApp({ projectPath: tmpDir })
    await service.refreshProjectProjections(tmpDir)

    const fleet = await service.app.fetch(new Request('http://localhost/api/service/projects'))
    expect(fleet.status).toBe(200)
    const fleetBody = await fleet.json() as { projects?: Array<Record<string, any>> }
    const project = fleetBody.projects?.find(item => item.id === PROJECT_ID)
    expect(project).toMatchObject({
      startReadiness: { code: 'required_migration_pending', actionHref: '/migrations' },
      actionModel: {
        primaryAction: { code: 'required_migration_pending', buttonLabel: 'Review project update' },
        runControl: { label: 'Migrate', startEnabled: false },
      },
    })

    const detail = await service.app.fetch(new Request(scoped('/api/project?surface=work')))
    expect(detail.status).toBe(200)
    const detailBody = await detail.json() as Record<string, any>
    expect(detailBody.actionModel).toMatchObject({
      primaryAction: { code: 'required_migration_pending', buttonLabel: 'Review project update' },
    })
  })

  it('serves a current per-project summary without entering full service reconstruction', async () => {
    registerWorkspace({ id: PROJECT_ID, name: 'Settings Test', path: tmpDir, tags: [] })
    const queue = {
      version: 1,
      lastUpdated: '2026-07-14T12:00:00.000Z',
      tasks: [{
        id: 'task-ready',
        title: 'Ready work',
        description: 'Run the ready work.',
        domain: 'runtime',
        projectPath: tmpDir,
        status: 'ready',
        priority: 'normal',
        spec: 'A runnable spec.',
        acceptanceCriteria: [{ id: 'ac-1', description: 'It runs.', met: false }],
        references: [],
        sourceClaims: [],
        outOfScope: [],
        dependsOn: [],
        notes: [],
        createdAt: '2026-07-14T12:00:00.000Z',
        updatedAt: '2026-07-14T12:00:00.000Z',
      }],
    }
    await writeSystemTasks(queue)
    const { app, refreshProjectProjections } = buildServeApp({ projectPath: tmpDir })
    await refreshProjectProjections(tmpDir)

    const res = await app.fetch(new Request(scoped('/api/service')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { partial?: boolean; projects?: Array<Record<string, any>> }
    const project = body.projects?.find(item => item.id === PROJECT_ID)
    expect(body.partial).toBe(true)
    expect(project).toMatchObject({
      id: PROJECT_ID,
      projectStatusLoading: false,
      taskCounts: { total: 1, active: 1 },
      startReadiness: { code: 'ready_work', canStart: true, focusTaskId: 'task-ready' },
      actionModel: { runControl: { startEnabled: true } },
    })
    expect(project?.gitStory).toBeUndefined()
    expect(project?.migrationSummary).toBeUndefined()
  })

  it('keeps migration detail on the owning project endpoint instead of fleet cards', async () => {
    registerWorkspace({ id: PROJECT_ID, name: 'Settings Test', path: tmpDir, tags: [] })
    await writeSystemText('PROGRESS.md', '# Progress\n')
    const { app } = buildServeApp({ projectPath: tmpDir })

    const res = await app.fetch(new Request('http://localhost/api/service?detail=true'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { projects?: Array<Record<string, any>> }
    const project = body.projects?.find(item => item.id === PROJECT_ID)
    expect(project?.migrationSummary).toBeUndefined()

    const migrations = await app.fetch(new Request(scoped('/api/project/migrations')))
    expect(migrations.status).toBe(200)
    const migrationsBody = await migrations.json() as Record<string, any>
    expect(migrationsBody).toMatchObject({
      pending: expect.any(Array),
      blocked: expect.any(Array),
      applied: expect.any(Array),
    })
    expect(migrationsBody.pending.length).toBeGreaterThan(0)
  })
})

describe('GET /api/health', () => {
  it('returns package, git, and served-build identity for the running process', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request('http://localhost/api/health'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      version?: string
      git?: {
        commit?: string
        shortCommit?: string
        branch?: string
        dirty?: boolean
      }
      build?: {
        builtAt?: string
        source?: string
        distPath?: string | null
      }
      served?: {
        stale?: boolean
        processStartedAt?: string
        bootBuildMtimeMs?: number
        currentBuildMtimeMs?: number
      }
      migrations?: {
        pending?: number
        blocked?: number
        applied?: number
      }
    }

    expect(typeof body.version).toBe('string')
    expect((body.version ?? '').length).toBeGreaterThan(0)
    expect(body.git?.commit).toMatch(/^[0-9a-f]{40}$|^unknown$/)
    expect(typeof body.git?.shortCommit).toBe('string')
    expect(typeof body.git?.branch).toBe('string')
    expect(typeof body.git?.dirty).toBe('boolean')
    expect(typeof body.build?.builtAt).toBe('string')
    expect(typeof body.build?.source).toBe('string')
    expect(body.served?.stale).toBe(false)
    expect(typeof body.served?.processStartedAt).toBe('string')
    expect(typeof body.served?.bootBuildMtimeMs).toBe('number')
    expect(typeof body.served?.currentBuildMtimeMs).toBe('number')
    expect(typeof body.migrations?.pending).toBe('number')
    expect(typeof body.migrations?.blocked).toBe('number')
    expect(typeof body.migrations?.applied).toBe('number')
  })

  it('returns JSON 404 for unknown API paths instead of the SPA shell', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(scoped('/api/project/contracts')))

    expect(res.status).toBe(404)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(await res.json()).toEqual({
      error: 'API route not found',
      path: '/api/project/contracts',
    })
  })
})

// GET /api/project/workspace-import/draft must expose the deterministic
// detector output (`detected`) so the Review tab shows findings immediately
// — before the importer agent has populated the task spec. POST /approve
// then falls back to the detector when the spec is still empty, so the
// user is never blocked on an agent round-trip.
describe('Workspace Import review endpoints', () => {
  it('status reports the durable approved snapshot when the reserved importer spec is stale', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'README.md'),
      '# Existing project\n\n## Direction\n\n- Keep the current project scope source-backed.\n',
      'utf8',
    )
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'approved-snapshot-boundary' }), 'utf8')
    await writeSystemJson('workspace-goals.json', {
      version: 3,
      recordedAt: '2026-01-01T00:00:00.000Z',
      goals: [],
      tasks: [{
        id: 'task-current-snapshot',
        title: 'Current snapshot task',
        description: 'The approved current task.',
        domain: 'core',
        priority: 'normal',
        references: ['README.md'],
      }],
      milestones: [],
      context: [],
      approved: {
        goalCount: 0,
        taskCount: 1,
        milestoneCount: 0,
        currentTaskCount: 1,
        laterTaskCount: 0,
        taskIds: ['task-current-snapshot'],
        currentTaskIds: ['task-current-snapshot'],
        laterTaskIds: [],
      },
      detected: null,
    })
    await writeSystemTasks({
      version: 1,
      lastUpdated: '2026-01-01T00:00:00.000Z',
      tasks: [{
        id: 'task-workspace-import',
        title: 'Review existing project work',
        description: 'Reserved importer with an obsolete spec.',
        domain: '_workspace_import',
        status: 'done',
        spec: [
          '```yaml',
          'tasks:',
          '  - id: task-stale-a',
          '    title: Stale importer task A',
          '  - id: task-stale-b',
          '    title: Stale importer task B',
          '```',
        ].join('\n'),
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }],
    })

    const { app } = buildServeApp({ projectPath: tmpDir })
    const response = await app.fetch(new Request(scoped('/api/project/workspace-import/status')))
    const rawBody = await response.text()
    expect(response.status, rawBody).toBe(200)
    const body = JSON.parse(rawBody) as {
      draft: { goals: number; tasks: number; milestones: number }
      specPresent: boolean
    }
    expect(body.specPresent).toBe(true)
    expect(body.draft).toEqual({ goals: 0, tasks: 1, milestones: 0 })
  })

  it('status treats missing task state as an empty existing workspace queue', async () => {
    await fs.rm(getProjectSystemStatePath(tmpDir, 'TASKS.json'), { force: true })
    await fs.writeFile(
      path.join(tmpDir, 'README.md'),
      '# Existing project\n\n## Goals\n\n- Capture the current repo direction\n',
      'utf8',
    )
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'existing-project' }),
      'utf8',
    )

    const { app } = buildServeApp({ projectPath: tmpDir })
    const status = await app.fetch(new Request(scoped('/api/project/workspace-import/status')))

    expect(status.status).toBe(200)
    const body = await status.json() as {
      needed: boolean
      seeded: boolean
      taskStatus: string | null
      draft: { goals: number; tasks: number; milestones: number }
      inventory: { signals: number }
      error?: string
    }
    expect(body.error).toBeUndefined()
    expect(body.seeded).toBe(false)
    expect(body.taskStatus).toBeNull()
    expect(body.needed).toBe(false)
    expect(body.inventory.signals).toBe(0)
    expect(body.draft).toEqual({ goals: 0, tasks: 0, milestones: 0 })
  })

  it('status tolerates archived legacy task records in the saved queue', async () => {
    const now = new Date().toISOString()
    await writeSystemTasks({
      version: 1,
      lastUpdated: now,
      tasks: [
        {
          id: 'task-archive-1',
          title: 'Archived legacy import',
          description: 'Kept only for audit history.',
          domain: 'core',
          status: 'archived',
          priority: 'normal',
          acceptanceCriteria: [],
          outOfScope: [],
          dependsOn: [],
          notes: [],
          gateResults: [],
          reviewVerdicts: [],
          adjudications: [],
          escalations: [],
          agentIssues: [],
          revisionCount: 0,
          remediationAttempts: 0,
          shelveReason: {
            code: 'duplicate',
            detail: 'Superseded by later scope shaping.',
            source: 'policy',
          },
          createdAt: now,
          updatedAt: now,
        },
      ],
    })
    await fs.writeFile(
      path.join(tmpDir, 'README.md'),
      '# Existing project\n\n## Goals\n\n- Capture the current repo direction\n',
      'utf8',
    )
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'existing-project' }),
      'utf8',
    )

    const { app } = buildServeApp({ projectPath: tmpDir })
    const status = await app.fetch(new Request(scoped('/api/project/workspace-import/status')))

    const body = await status.json() as { error?: string; seeded?: boolean; taskStatus?: string | null }
    expect(status.status).toBe(200)
    expect(body.error).toBeUndefined()
    expect(body.seeded).toBe(false)
    expect(body.taskStatus).toBeNull()
  })

  it('draft endpoint does not reconstruct detector output before a saved import projection exists', async () => {
    // Seed signals the detector can pick up.
    await fs.writeFile(
      path.join(tmpDir, 'README.md'),
      '# Ship it\n\nGoals:\n- Ship the orchestrator\n- Wire the dashboard\n',
      'utf8',
    )
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'ws-import', scripts: {} }),
      'utf8',
    )

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(scoped('/api/project/workspace-import/draft')),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      detected: unknown | null
      dismissed: boolean
      projection: { freshness: string; requiresRefresh: boolean }
    }
    expect(body.detected).toBeNull()
    expect(body.dismissed).toBe(false)
    expect(body.projection).toMatchObject({ freshness: 'missing', requiresRefresh: true })
  })

  it('draft endpoint does not derive release containers from live release-plan files', async () => {
    await fs.mkdir(path.join(tmpDir, 'docs'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'release-plan.md'),
      [
        '# Release Plan',
        '',
        '## Stage 1: V1 Release Hardening',
        '',
        'Scope:',
        '- Fill the most important unit and E2E gaps.',
        '',
        '## Current Next Milestone',
        '',
        'The next milestone is Stage 1: V1 Release Hardening.',
        '',
        '1. Fill the most important unit and E2E gaps.',
        '',
        '## Stage 2: Primitive Convergence',
        '',
        'Scope:',
        '- Finish remaining high-use primitive replacement.',
      ].join('\n'),
      'utf8',
    )
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'release-preview', scripts: {} }),
      'utf8',
    )

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(scoped('/api/project/workspace-import/draft')))

    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      detected: unknown | null
      effective: unknown | null
      projection: { freshness: string; requiresRefresh: boolean }
    }
    expect(body.detected).toBeNull()
    expect(body.effective).toBeNull()
    expect(body.projection).toMatchObject({ freshness: 'missing', requiresRefresh: true })
  })

  it('project orientation does not attach unmaterialized import scope to release containers', async () => {
    await fs.mkdir(path.join(tmpDir, 'docs', 'harness'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'harness', 'implementation-roadmap.md'),
      [
        '# Implementation Roadmap',
        '',
        '## Stage 1: Fixture And Evaluation Harness',
        '',
        '## Current Next Milestone',
        '',
        'The next milestone is Stage 1: Fixture And Evaluation Harness.',
        '',
        '1. Define fixture, expected-record, prototype-run, and evaluation schemas.',
      ].join('\n'),
      'utf8',
    )
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'approved-release-orientation' }), 'utf8')
    await writeSystemTasks({
      version: 1,
      lastUpdated: '2026-01-01T00:00:00.000Z',
      tasks: [
        {
          id: 'task-workspace-import',
          title: 'Review existing project work',
          description: 'Reserved importer',
          domain: '_workspace_import',
          projectPath: tmpDir,
          status: 'done',
          priority: 'normal',
          acceptanceCriteria: [],
          dependsOn: [],
          outOfScope: [],
          spec: '```yaml\ntasks: []\n```',
          notes: [],
          gateResults: [],
          reviewVerdicts: [],
          adjudications: [],
          escalations: [],
          agentIssues: [],
          origination: 'system',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    })
    await writeSystemJson('workspace-goals.json', {
      version: 3,
      recordedAt: '2026-01-01T00:00:00.000Z',
      goals: [],
      tasks: [
        {
          id: 'imported-one',
          title: 'Define fixture, expected-record, prototype-run, and evaluation schemas.',
          description: 'Saved approved task.',
          domain: 'harness',
          priority: 'high',
          references: ['docs/harness/implementation-roadmap.md'],
          scope: 'current',
        },
      ],
      milestones: [],
      context: [],
      approved: {
        goalCount: 0,
        taskCount: 1,
        milestoneCount: 0,
        currentTaskCount: 1,
        laterTaskCount: 0,
        taskIds: ['imported-one'],
        currentTaskIds: ['imported-one'],
        laterTaskIds: [],
      },
      detected: null,
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    await execFileP('git', ['add', '.'], { cwd: tmpDir })
    await execFileP('git', ['commit', '-m', 'seed duplicate scope conflict'], { cwd: tmpDir })
    const res = await app.fetch(new Request(scoped('/api/project')))

    expect(res.status).toBe(200)
    const body = await res.json() as {
      orientationSpine?: {
        summary?: { selectedReleaseLabel?: string | null; selectedScopeLabel?: string | null }
        selectedRelease?: { id?: string; label?: string; nodeIds?: string[] } | null
      }
    }
    expect(body.orientationSpine?.summary?.selectedReleaseLabel).toBeNull()
    expect(body.orientationSpine?.summary?.selectedScopeLabel).toBe('Current scope')
    expect(body.orientationSpine?.selectedRelease).toBeNull()
    expect(JSON.stringify(body.orientationSpine)).not.toContain('workspace-import:imported-one')
  })

  it('keeps start readiness aligned with the durable release when import docs are fresher', async () => {
    const now = '2026-07-06T19:15:00.000Z'
    await fs.mkdir(path.join(tmpDir, 'docs', 'harness'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'harness', 'implementation-roadmap.md'),
      [
        '# Implementation Roadmap',
        '',
        '## Stage 1: Headless Drafting And Evaluation MVP',
        '',
        'Goal: prove the headless drafting loop before product UI work.',
        '',
        '## Current Next Milestone',
        '',
        'The next milestone is Stage 1: Headless Drafting And Evaluation MVP.',
        '',
        '1. Select and prove a DeepInfra drafting model for broad-genre chapter writing.',
      ].join('\n'),
      'utf8',
    )
    await writeSystemTasks({
      version: 1,
      lastUpdated: now,
      selectedReleaseId: 'near-term-proof-scope',
      releases: [{
        id: 'near-term-proof-scope',
        label: 'Near-term proof scope',
        kind: 'release',
        state: 'active',
        source: 'inferred',
        nodeIds: ['work:legacy-proof'],
        deferredNodeIds: [],
      }],
      tasks: [
        {
          id: 'legacy-proof',
          title: 'Recover source-backed contract surface',
          description: 'Legacy inferred proof bucket work.',
          domain: 'harness',
          status: 'done',
          releaseIds: ['near-term-proof-scope'],
          priority: 'normal',
          acceptanceCriteria: [{ id: 'proof', description: 'Attach proof.', met: false }],
          createdAt: now,
          updatedAt: now,
        },
        {
          id: 'stage-1-model-proof',
          title: 'Select and prove a DeepInfra drafting model for broad-genre chapter writing.',
          description: 'Current documented Stage 1 work.',
          domain: 'harness',
          status: 'done',
          releaseIds: ['stage-1-headless-drafting-and-evaluation-mvp'],
          priority: 'normal',
          acceptanceCriteria: [{ id: 'proof', description: 'Attach proof.', met: false }],
          createdAt: now,
          updatedAt: now,
        },
      ],
    })
    await writeSystemJson('workspace-goals.json', {
      version: 3,
      recordedAt: now,
      goals: [],
      releases: [{
        id: 'stage-1-headless-drafting-and-evaluation-mvp',
        label: 'Stage 1: Headless Drafting And Evaluation MVP',
        source: 'release_plan',
        state: 'active',
      }],
      tasks: [{
        id: 'stage-1-model-proof',
        title: 'Select and prove a DeepInfra drafting model for broad-genre chapter writing.',
        description: 'Current documented Stage 1 work.',
        domain: 'harness',
        priority: 'normal',
        scope: 'current',
        releaseIds: ['stage-1-headless-drafting-and-evaluation-mvp'],
        references: ['docs/harness/implementation-roadmap.md'],
      }],
      milestones: [],
      context: [],
      approved: {
        goalCount: 0,
        taskCount: 1,
        milestoneCount: 0,
        currentTaskCount: 1,
        laterTaskCount: 0,
        taskIds: ['stage-1-model-proof'],
        currentTaskIds: ['stage-1-model-proof'],
        laterTaskIds: [],
      },
      detected: null,
    })
    await applyCanonicalMigrations()

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(scopedDiagnostic('/api/project')))
    const body = await res.json() as {
      startReadiness?: { code?: string; message?: string; focusTaskId?: string }
      orientationSpine?: { summary?: { selectedScopeLabel?: string | null } }
    }

    expect(res.status).toBe(200)
    const selectedScopeLabel = body.orientationSpine?.summary?.selectedScopeLabel ?? ''
    expect(selectedScopeLabel).toBe('Near-term proof scope')
    expect(selectedScopeLabel).not.toContain('Stage 1')
    expect(body.startReadiness?.code).toBe('proof_evidence_missing')
    const comparable = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    expect(comparable(body.startReadiness?.message ?? '')).toContain(comparable(selectedScopeLabel))
    expect(body.startReadiness?.message).not.toContain('Stage 1')
    expect(body.startReadiness?.focusTaskId).toBe('legacy-proof')
  })

  it('blocks selected-scope completion when duplicate scoped work creates a source conflict', async () => {
    const now = '2026-07-06T19:25:00.000Z'
    await fs.mkdir(path.join(tmpDir, 'docs', 'harness'), { recursive: true })
    await fs.mkdir(path.join(tmpDir, 'docs', 'product'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'harness', 'implementation-roadmap.md'),
      [
        '# Implementation Roadmap',
        '',
        '## Stage 1: Headless Drafting And Evaluation MVP',
        '',
        'Goal: prove the headless drafting loop before product UI work.',
        '',
        '## Current Next Milestone',
        '',
        'The next milestone is Stage 1: Headless Drafting And Evaluation MVP.',
        '',
        '1. Select and prove a DeepInfra drafting model for broad-genre chapter writing.',
      ].join('\n'),
      'utf8',
    )
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'product', 'deepinfra-drafting-model-selection.md'),
      [
        '# DeepInfra Drafting Model Selection',
        '',
        'Select and prove a DeepInfra drafting model for broad-genre and legal adult fiction chapter writing.',
      ].join('\n'),
      'utf8',
    )
    const completionHandoff = {
      verified: ['Command proof passed.'],
      evidenceRefs: ['proof:synthetic'],
    }
    await writeSystemTasks({
      version: 1,
      lastUpdated: now,
      selectedReleaseId: 'stage-1-headless-drafting-and-evaluation-mvp',
      releases: [{
        id: 'stage-1-headless-drafting-and-evaluation-mvp',
        label: 'Stage 1: Headless Drafting And Evaluation MVP',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        nodeIds: ['work:stage-1-model-proof'],
        deferredNodeIds: ['work:near-term-adult-model-proof'],
      }],
      tasks: [
        {
          id: 'stage-1-model-proof',
          title: 'Select and prove a DeepInfra drafting model for broad-genre chapter writing.',
          description: 'Current documented Stage 1 work.',
          domain: 'harness',
          status: 'done',
          releaseIds: ['stage-1-headless-drafting-and-evaluation-mvp'],
          priority: 'normal',
          acceptanceCriteria: [{ id: 'proof', description: 'Attach proof.', met: true }],
          completionHandoff,
          gitStory: { override: 'local_only', reason: 'Synthetic calibration fixture.' },
          references: ['docs/harness/implementation-roadmap.md'],
          createdAt: now,
          updatedAt: now,
        },
        {
          id: 'near-term-adult-model-proof',
          title: 'Select and prove a DeepInfra drafting model for broad-genre and legal adult fiction chapter writing.',
          description: 'Richer owner requirement captured outside the selected scope.',
          domain: 'harness',
          status: 'done',
          releaseIds: ['near-term-proof-scope'],
          priority: 'normal',
          acceptanceCriteria: [{ id: 'proof', description: 'Attach proof.', met: true }],
          completionHandoff,
          gitStory: { override: 'local_only', reason: 'Synthetic calibration fixture.' },
          references: ['docs/product/deepinfra-drafting-model-selection.md'],
          createdAt: now,
          updatedAt: now,
        },
      ],
    })
    await writeSystemJson('workspace-goals.json', {
      version: 3,
      recordedAt: now,
      goals: [],
      releases: [{
        id: 'stage-1-headless-drafting-and-evaluation-mvp',
        label: 'Stage 1: Headless Drafting And Evaluation MVP',
        source: 'release_plan',
        state: 'active',
      }],
      tasks: [{
        id: 'stage-1-model-proof',
        title: 'Select and prove a DeepInfra drafting model for broad-genre chapter writing.',
        description: 'Current documented Stage 1 work.',
        domain: 'harness',
        priority: 'normal',
        scope: 'current',
        releaseIds: ['stage-1-headless-drafting-and-evaluation-mvp'],
        references: ['docs/harness/implementation-roadmap.md'],
      }],
      milestones: [],
      context: [],
      approved: {
        goalCount: 0,
        taskCount: 1,
        milestoneCount: 0,
        currentTaskCount: 1,
        laterTaskCount: 0,
        taskIds: ['stage-1-model-proof'],
        currentTaskIds: ['stage-1-model-proof'],
        laterTaskIds: [],
      },
      detected: null,
    })
    await applyCanonicalMigrations()

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(scopedDiagnostic('/api/project')))
    const body = await res.json() as {
      startReadiness?: { code?: string; message?: string; actionHref?: string; focusKind?: string }
      orientationSpine?: { sourceHealth?: { conflicts?: number }; summary?: { topBlocker?: string | null } }
    }

    expect(res.status).toBe(200)
    expect(body.orientationSpine?.sourceHealth?.conflicts).toBeGreaterThan(0)
    expect(body.startReadiness).toMatchObject({
      canStart: false,
      code: 'scope_source_conflict',
      actionHref: '/map',
      focusKind: 'source_conflict',
    })
    expect(body.startReadiness?.message).toContain('legal adult fiction')
    expect(body.startReadiness?.message).not.toContain('is complete')

    const reconcile = await app.fetch(new Request(scoped('/api/project/source-conflicts/reconcile'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        keepTaskId: 'near-term-adult-model-proof',
        archiveTaskId: 'stage-1-model-proof',
        selectedReleaseId: 'stage-1-headless-drafting-and-evaluation-mvp',
      }),
    }))
    const reconcileBody = await reconcile.json() as {
      keepTask?: { releaseIds?: string[] }
      archivedTask?: { status?: string }
    }
    expect(reconcile.status).toBe(200)
    expect(reconcileBody.keepTask?.releaseIds).toContain('stage-1-headless-drafting-and-evaluation-mvp')
    expect(reconcileBody.archivedTask?.status).toBe('archived')

    const repairedQueue = readProjectStateDatabaseQueueDefinition(getProjectSystemStatePath(tmpDir, 'TASKS.json'))
    if (!repairedQueue) throw new Error('Missing canonical SQLite task queue')
    expect(repairedQueue.tasks.find(task => task.id === 'stage-1-model-proof')).toMatchObject({
      status: 'archived',
      releaseIds: [],
    })
    expect(repairedQueue.tasks.find(task => task.id === 'near-term-adult-model-proof')?.releaseIds).toContain('stage-1-headless-drafting-and-evaluation-mvp')
    expect(repairedQueue.releases.find(release => release.id === 'stage-1-headless-drafting-and-evaluation-mvp')).toMatchObject({
      nodeIds: ['work:near-term-adult-model-proof'],
      deferredNodeIds: [],
    })

    const unsafeReconcile = await app.fetch(new Request(scoped('/api/project/source-conflicts/reconcile'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        keepTaskId: 'stage-1-model-proof',
        archiveTaskId: 'near-term-adult-model-proof',
        selectedReleaseId: 'stage-1-headless-drafting-and-evaluation-mvp',
      }),
    }))
    const unsafeBody = await unsafeReconcile.json() as { error?: string }
    expect(unsafeReconcile.status).toBe(400)
    expect(unsafeBody.error).toContain('current source conflict')
  })

  it('points Start at detected current-scope import work before completed-task proof cleanup', async () => {
    const now = '2026-07-06T19:35:00.000Z'
    await fs.mkdir(path.join(tmpDir, 'docs', 'harness'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'harness', 'implementation-roadmap.md'),
      [
        '# Implementation Roadmap',
        '',
        '## Stage 1: Headless Drafting And Evaluation MVP',
        '',
        'Goal: prove the headless drafting loop before product UI work.',
        '',
        '## Current Next Milestone',
        '',
        'The next milestone is Stage 1: Headless Drafting And Evaluation MVP.',
        '',
        '1. Select and prove a DeepInfra drafting model for broad-genre chapter writing.',
        '2. Add author-intent inputs for voice, genre, audience, theme, synopsis, outline, characters, character voices, world-state facts, and review plan.',
      ].join('\n'),
      'utf8',
    )
    await writeSystemTasks({
      version: 1,
      lastUpdated: now,
      selectedReleaseId: 'near-term-proof-scope',
      releases: [{
        id: 'near-term-proof-scope',
        label: 'Near-term proof scope',
        kind: 'release',
        state: 'active',
        source: 'inferred',
        nodeIds: ['work:author-intent'],
        deferredNodeIds: [],
      }],
      tasks: [{
        id: 'author-intent',
        title: 'Add author-intent inputs for voice, genre, audience, theme, synopsis, outline, characters, character voices, world-state facts, and review plan.',
        description: 'Current documented Stage 1 work.',
        domain: 'harness',
        status: 'done',
        releaseIds: ['near-term-proof-scope'],
        priority: 'normal',
        acceptanceCriteria: [{ id: 'proof', description: 'Attach proof.', met: false }],
        createdAt: now,
        updatedAt: now,
      }],
    })
    await writeSystemJson('workspace-goals.json', {
      version: 3,
      recordedAt: now,
      goals: [],
      releases: [{
        id: 'stage-1-headless-drafting-and-evaluation-mvp',
        label: 'Stage 1: Headless Drafting And Evaluation MVP',
        source: 'release_plan',
        state: 'active',
      }],
      tasks: [{
        id: 'author-intent',
        title: 'Add author-intent inputs for voice, genre, audience, theme, synopsis, outline, characters, character voices, world-state facts, and review plan.',
        description: 'Current documented Stage 1 work.',
        domain: 'harness',
        priority: 'normal',
        scope: 'current',
        releaseIds: ['stage-1-headless-drafting-and-evaluation-mvp'],
        references: ['docs/harness/implementation-roadmap.md'],
      }],
      milestones: [],
      context: [],
      approved: {
        goalCount: 0,
        taskCount: 1,
        milestoneCount: 0,
        currentTaskCount: 1,
        laterTaskCount: 0,
        taskIds: ['author-intent'],
        currentTaskIds: ['author-intent'],
        laterTaskIds: [],
      },
      detected: null,
    })

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(scopedDiagnostic('/api/project')))
    const body = await res.json() as {
      startReadiness?: { code?: string; message?: string; focusKind?: string; focusTaskTitle?: string }
      orientationSpine?: {
        summary?: { selectedScopeLabel?: string | null }
        scopeRows?: Array<{ taskId?: string; title?: string; scope?: string; status?: string }>
      }
    }

    expect(res.status).toBe(200)
    expect(body.orientationSpine?.summary?.selectedScopeLabel).toBe('Near-term proof scope')
    expect(body.orientationSpine?.scopeRows?.some(row =>
      row.scope === 'included' &&
      row.status === 'import_draft' &&
      row.title?.includes('Select and prove a DeepInfra drafting model'),
    )).toBe(false)
    expect(body.startReadiness?.code).toBe('proof_evidence_missing')
    expect(body.startReadiness?.focusKind).toBe('proof')
    expect(body.startReadiness?.message).toContain('waiting on proof evidence')
    expect(body.startReadiness?.message).not.toContain('Select and prove a DeepInfra drafting model')
  })

  it('draft endpoint prefers the approved workspace-goals state over a stale importer task spec', async () => {
    await fs.mkdir(path.join(tmpDir, 'docs', 'harness'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'harness', 'implementation-roadmap.md'),
      [
        '# Implementation Roadmap',
        '',
        '## Stage 1: Fixture And Evaluation Harness',
        '',
        'Deliverables:',
        '- fixture directory shape for at least one small story fixture',
        '- typed fixture and expected-record contracts',
        '',
        '## Current Next Milestone',
        '',
        'The next milestone is Stage 1: Fixture And Evaluation Harness.',
        '',
        '1. Define fixture, expected-record, prototype-run, and evaluation schemas.',
      ].join('\n'),
      'utf8',
    )
    await writeSystemText(
      'TASKS.json',
      JSON.stringify(
        {
          version: 1,
          lastUpdated: '2026-01-01T00:00:00.000Z',
          tasks: [
            {
              id: 'task-workspace-import',
              title: 'Review existing project work',
              description: 'Reserved importer',
              domain: '_workspace_import',
              projectPath: tmpDir,
              status: 'done',
              priority: 'normal',
              acceptanceCriteria: [],
              dependsOn: [],
              outOfScope: [],
              spec: [
                '```yaml',
                'tasks:',
                '  - id: imported-one',
                '    title: Define fixture, expected-record, prototype-run, and evaluation schemas.',
                '    description: Saved starter task.',
                '    domain: harness',
                '    priority: high',
                '```',
              ].join('\n'),
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        },
        null,
        2,
      ),
    )
    await writeSystemText(
      'workspace-goals.json',
      JSON.stringify(
        {
          version: 2,
          recordedAt: '2026-01-01T00:00:00.000Z',
          goals: [],
          tasks: [
            {
              id: 'imported-one',
              title: 'Define fixture, expected-record, prototype-run, and evaluation schemas.',
              description: 'Saved starter task.',
              domain: 'harness',
              priority: 'high',
              references: ['docs/harness/implementation-roadmap.md'],
            },
            {
              id: 'imported-two',
              title: 'fixture directory shape for at least one small story fixture',
              description: 'Saved deliverable task.',
              domain: 'harness',
              priority: 'normal',
              references: ['docs/harness/implementation-roadmap.md'],
            },
          ],
          milestones: [],
          approved: {
            goalCount: 0,
            taskCount: 2,
            milestoneCount: 0,
            currentTaskCount: 2,
            laterTaskCount: 0,
            taskIds: ['imported-one', 'imported-two'],
          },
          detected: {
            goalCount: 0,
            taskCount: 2,
            milestoneCount: 0,
            currentTaskCount: 2,
            laterTaskCount: 0,
            taskIds: ['imported-one', 'imported-two'],
          },
        },
        null,
        2,
      ),
    )

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(scoped('/api/project/workspace-import/draft')))
    expect(res.status).toBe(200)
    const body = await res.json() as {
      parsed?: { tasks?: Array<{ title?: string }> }
    }
    expect(body.parsed?.tasks?.map(task => task.title)).toEqual(expect.arrayContaining([
      'Define fixture, expected-record, prototype-run, and evaluation schemas.',
      'fixture directory shape for at least one small story fixture',
    ]))
  })

  it('materializes an approved import into the saved structured task graph', async () => {
    await fs.mkdir(path.join(tmpDir, 'docs/harness'), { recursive: true })
    await fs.mkdir(path.join(tmpDir, 'docs/specs'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'docs/harness/implementation-roadmap.md'),
      [
        '# Implementation Roadmap',
        '',
        '## Stage 1: Fixture And Evaluation Harness',
        '',
        'Goal: build a no-UI test harness that proves story-memory and packet contracts against small fiction fixtures before any product UI is designed.',
        '',
        '## Current Next Milestone',
        '',
        'The next milestone is Stage 1: Fixture And Evaluation Harness.',
        '',
        '1. Define fixture, expected-record, prototype-run, and evaluation schemas.',
        '2. Add the first tiny fiction fixture and human-authored expected records.',
      ].join('\n'),
      'utf8',
    )
    await fs.writeFile(
      path.join(tmpDir, 'docs/specs/schema-contract-roadmap.md'),
      '# Schema Contract Roadmap\n\nTyped fixture and expected-record contracts.\n',
      'utf8',
    )
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'narrative-preview-shape' }), 'utf8')

    const { app } = buildServeApp({ projectPath: tmpDir })

    const approve = await app.fetch(
      new Request(scoped('/api/project/workspace-import/approve'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    )
    expect(approve.status).toBe(200)

    const after = await app.fetch(new Request(scoped('/api/project/workspace-import/draft')))
    expect(after.status).toBe(200)
    const afterBody = (await after.json()) as {
      parsed: {
        tasks: Array<{
          id: string
          title: string
          domain: string
          dependsOn?: string[]
          proofPaths?: Array<{ kind: string; source?: string; launchSteps?: Array<{ kind?: string }> }>
          acceptanceCriteria?: Array<{ id: string }>
        }>
      } | null
    }
    const parsedSchemaTask = afterBody.parsed?.tasks.find(task => task.title === 'Define fixture, expected-record, prototype-run, and evaluation schemas.')
    const parsedFixtureTask = afterBody.parsed?.tasks.find(task => task.title === 'Add the first tiny fiction fixture and human-authored expected records.')
    expect(parsedSchemaTask).toMatchObject({
      domain: 'harness',
      acceptanceCriteria: expect.arrayContaining([
        expect.objectContaining({ id: 'contracts-defined' }),
        expect.objectContaining({ id: 'deterministic-proof' }),
      ]),
      proofPaths: expect.arrayContaining([
        expect.objectContaining({
          kind: 'command',
          source: 'inferred',
          launchSteps: expect.arrayContaining([
            expect.objectContaining({ kind: 'blocked_until_setup' }),
          ]),
        }),
        expect.objectContaining({ kind: 'review', source: 'inferred' }),
      ]),
    })
    expect(parsedFixtureTask?.dependsOn).toEqual([parsedSchemaTask?.id].filter(Boolean))
  })

  it('default approval preserves goal-only and reference-bearing sources instead of shrinking to task-bearing docs', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'README.md'),
      [
        '# Narrative Harness',
        '',
        'Narrative Harness is a fiction-writing workspace.',
        '',
        '## Goals',
        '',
        '- Preserve author voice while making story continuity visible.',
      ].join('\n'),
      'utf8',
    )
    await fs.mkdir(path.join(tmpDir, 'docs', 'harness'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'harness', 'implementation-roadmap.md'),
      [
        '# Implementation Roadmap',
        '',
        '## Stage 1: Fixture And Evaluation Harness',
        '',
        '## Current Next Milestone',
        '',
        'The next milestone is Stage 1: Fixture And Evaluation Harness.',
        '',
        '1. Define fixture, expected-record, prototype-run, and evaluation schemas.',
      ].join('\n'),
      'utf8',
    )
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'goal-source-truth' }), 'utf8')

    const { app } = buildServeApp({ projectPath: tmpDir })

    const approve = await app.fetch(
      new Request(scoped('/api/project/workspace-import/approve'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    )
    expect(approve.status).toBe(200)

    const after = await app.fetch(new Request(scoped('/api/project/workspace-import/draft')))
    const afterBody = (await after.json()) as {
      parsed: { goals: Array<{ title: string }> } | null
    }
    expect(afterBody.parsed?.goals.map(goal => goal.title)).toContain('Narrative Harness')
  })

  it('approve falls back to detector when the importer task has no spec', async () => {
    // Seed a README with a goal the detector will pick up.
    await fs.writeFile(
      path.join(tmpDir, 'README.md'),
      '# t-minus-t\n\n## Goals\n\n- Ship the extension\n- Wire the popup\n',
      'utf8',
    )
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'ws-fallback' }),
      'utf8',
    )
    // Prime TASKS.json with the reserved importer task — empty spec.
    await writeSystemText(
      'TASKS.json',
      JSON.stringify(
        {
          version: 1,
          lastUpdated: new Date().toISOString(),
          tasks: [
            {
              id: 'task-workspace-import',
              title: 'Workspace import',
              description: 'Reserved importer',
              domain: '_workspace_import',
              projectPath: tmpDir,
              status: 'proposed',
              priority: 'normal',
              acceptanceCriteria: [],
              dependsOn: [],
              outOfScope: [],
              spec: '', // no agent output yet
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
        },
        null,
        2,
      ),
    )

    const { app } = buildServeApp({ projectPath: tmpDir })
    const approve = await app.fetch(
      new Request(scoped('/api/project/workspace-import/approve'), {
        method: 'POST',
      }),
    )
    const body = (await approve.json()) as {
      ok?: boolean
      tasksAdded?: number
      goalsRecorded?: number
      error?: string
    }
    if (approve.status !== 200) {
      throw new Error(`approve failed: status=${approve.status} body=${JSON.stringify(body)}`)
    }
    expect(approve.status).toBe(200)
    expect(body.ok).toBe(true)
    // Detector should have produced at least one goal from the README.
    expect((body.goalsRecorded ?? 0) + (body.tasksAdded ?? 0)).toBeGreaterThan(0)
  })

  it('approves workspace import from system-local task state without creating repo task state', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'README.md'),
      '# t-minus-t\n\n## Goals\n\n- Ship the extension\n- Wire the popup\n',
      'utf8',
    )
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'ws-system-local-fallback' }),
      'utf8',
    )
    await fs.mkdir(path.join(tmpDir, 'docs'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'roadmap.md'),
      '- [x] Initial popup scaffold\n- [ ] Wire the popup context menu\n',
      'utf8',
    )
    const { app } = buildServeApp({ projectPath: tmpDir })
    const tasksPath = getProjectSystemStatePath(tmpDir, 'TASKS.json')
    await writeSystemTasks(
      {
          version: 1,
          lastUpdated: new Date().toISOString(),
          tasks: [
            {
              id: 'task-workspace-import',
              title: 'Workspace import',
              description: 'Reserved importer',
              domain: '_workspace_import',
              projectPath: tmpDir,
              status: 'proposed',
              priority: 'normal',
              acceptanceCriteria: [],
              dependsOn: [],
              outOfScope: [],
              spec: '',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
      },
    )
    const approve = await app.fetch(
      new Request(scoped('/api/project/workspace-import/approve'), {
        method: 'POST',
      }),
    )
    const body = (await approve.json()) as {
      ok?: boolean
      tasksAdded?: number
      goalsRecorded?: number
      error?: string
    }
    if (approve.status !== 200) {
      throw new Error(`approve failed: status=${approve.status} body=${JSON.stringify(body)}`)
    }

    expect(body.ok).toBe(true)
    const written = readProjectStateDatabaseQueueDefinition(tasksPath)
    if (!written) throw new Error('Missing canonical SQLite task queue')
    expect(written.tasks.some(task => task.id !== 'task-workspace-import')).toBe(true)
    await expect(fs.access(path.join(tmpDir, '.guildhall', 'TASKS.json'))).rejects.toThrow()
    await expect(fs.access(path.join(tmpDir, '.guildhall', 'learning.json'))).rejects.toThrow()
    await expect(fs.access(path.join(tmpDir, '.guildhall', 'PROGRESS.md'))).rejects.toThrow()
    await expect(fs.access(getProjectSystemStatePath(tmpDir, 'learning.json'))).resolves.toBeUndefined()
  })

  it('approve preserves the importer agent curated spec when it still covers the live detector output', async () => {
    await fs.mkdir(path.join(tmpDir, 'docs'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'README.md'),
      '# Curated import\n\n## Goals\n\n- Keep the curated project direction\n',
      'utf8',
    )
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'roadmap.md'),
      '- [ ] Build the curated first task\n',
      'utf8',
    )
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'curated-import' }),
      'utf8',
    )
    await writeSystemText(
      'TASKS.json',
      JSON.stringify(
        {
          version: 1,
          lastUpdated: '2026-01-01T00:00:00.000Z',
          tasks: [
            {
              id: 'task-workspace-import',
              title: 'Review existing project work',
              description: 'Reserved importer',
              domain: '_workspace_import',
              projectPath: tmpDir,
              status: 'spec_review',
              priority: 'normal',
              acceptanceCriteria: [],
              dependsOn: [],
              outOfScope: [],
              spec: [
                '```yaml',
                'goals:',
                '  - id: curated-goal',
                '    title: Keep the curated project direction',
                '    rationale: The importer agent narrowed noisy repo notes to one useful workstream.',
                '```',
                '```yaml',
                'tasks:',
                '  - id: curated-first-task',
                '    title: Build the curated first task',
                '    description: Implement only the first reviewed workstream from the importer agent.',
                '    domain: app',
                '    priority: high',
                '    references:',
                '      - README.md',
                '```',
                '```yaml',
                'milestones:',
                '  - title: Curated import spec reviewed',
                '    evidence: README.md',
                '```',
              ].join('\n'),
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        },
        null,
        2,
      ),
    )

    const { app } = buildServeApp({ projectPath: tmpDir })
    const approve = await app.fetch(
      new Request(scoped('/api/project/workspace-import/approve'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
    )
    const body = (await approve.json()) as {
      ok?: boolean
      tasksAdded?: number
      goalsRecorded?: number
      milestonesLogged?: number
      error?: string
    }
    if (approve.status !== 200) {
      throw new Error(`approve failed: status=${approve.status} body=${JSON.stringify(body)}`)
    }

    expect(body.ok).toBe(true)
    expect(body.tasksAdded).toBe(1)
    expect(body.goalsRecorded).toBeGreaterThanOrEqual(1)
    expect(body.milestonesLogged).toBeGreaterThanOrEqual(1)

    const tasks = await readTasks(tmpDir)
    expect(tasks.some(task => task.id === 'curated-first-task')).toBe(true)
    expect(tasks.some(task => task.title === 'Build the curated first task')).toBe(true)
  })

  it('approve refreshes a saved curated importer spec when it undercovers the live detector draft', async () => {
    await fs.mkdir(path.join(tmpDir, 'docs'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'README.md'),
      '# Broad detector bait\n\n## Goals\n\n- Ship everything\n',
      'utf8',
    )
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'roadmap.md'),
      '- [ ] Detector task one\n- [ ] Detector task two\n- [ ] Detector task three\n',
      'utf8',
    )
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'curated-import-undercovers' }),
      'utf8',
    )
    await writeSystemText(
      'TASKS.json',
      JSON.stringify(
        {
          version: 1,
          lastUpdated: '2026-01-01T00:00:00.000Z',
          tasks: [
            {
              id: 'task-workspace-import',
              title: 'Review existing project work',
              description: 'Reserved importer',
              domain: '_workspace_import',
              projectPath: tmpDir,
              status: 'spec_review',
              priority: 'normal',
              acceptanceCriteria: [],
              dependsOn: [],
              outOfScope: [],
              spec: [
                '```yaml',
                'goals:',
                '  - id: curated-goal',
                '    title: Keep the curated project direction',
                '    rationale: The importer agent narrowed noisy repo notes to one useful workstream.',
                '```',
                '```yaml',
                'tasks:',
                '  - id: curated-first-task',
                '    title: Build the curated first task',
                '    description: Implement only the first reviewed workstream from the importer agent.',
                '    domain: app',
                '    priority: high',
                '    references:',
                '      - README.md',
                '```',
              ].join('\n'),
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        },
        null,
        2,
      ),
    )

    const { app } = buildServeApp({ projectPath: tmpDir })
    const approve = await app.fetch(
      new Request(scoped('/api/project/workspace-import/approve'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
    )
    const body = (await approve.json()) as {
      ok?: boolean
      tasksAdded?: number
      goalsRecorded?: number
      error?: string
    }
    if (approve.status !== 200) {
      throw new Error(`approve failed: status=${approve.status} body=${JSON.stringify(body)}`)
    }

    expect(body.ok).toBe(true)
    const tasks = await readTasks(tmpDir)
    expect(body.tasksAdded).toBe(3)
    expect(tasks.some(task => task.id === 'curated-first-task')).toBe(false)
    expect(tasks.some(task => task.title === 'Detector task one')).toBe(true)
    expect(tasks.some(task => task.title === 'Detector task two')).toBe(true)
    expect(tasks.some(task => task.title === 'Detector task three')).toBe(true)
  })

  it('approve replaces a stale importer spec that saved zero tasks while live detection finds current work', async () => {
    await fs.mkdir(path.join(tmpDir, 'docs', 'harness'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'harness', 'implementation-roadmap.md'),
      [
        '# Implementation Roadmap',
        '',
        '## Stage 1: Fixture And Evaluation Harness',
        '',
        '## Current Next Milestone',
        '',
        'The next milestone is Stage 1: Fixture And Evaluation Harness.',
        '',
        '1. Define fixture, expected-record, prototype-run, and evaluation schemas.',
        '2. Add the first tiny fiction fixture and human-authored expected records.',
      ].join('\n'),
      'utf8',
    )
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'stale-import-spec' }), 'utf8')
    await writeSystemText(
      'TASKS.json',
      JSON.stringify(
        {
          version: 1,
          lastUpdated: '2026-01-01T00:00:00.000Z',
          tasks: [
            {
              id: 'task-workspace-import',
              title: 'Review existing project work',
              description: 'Reserved importer',
              domain: '_workspace_import',
              projectPath: tmpDir,
              status: 'done',
              priority: 'normal',
              acceptanceCriteria: [],
              dependsOn: [],
              outOfScope: [],
              spec: [
                '```yaml',
                'goals:',
                '  - id: imported-direction',
                '    title: Narrative Harness',
                '    rationale: A stale importer run only saved the project goal.',
                '```',
              ].join('\n'),
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        },
        null,
        2,
      ),
    )

    const { app } = buildServeApp({ projectPath: tmpDir })
    const approve = await app.fetch(
      new Request(scoped('/api/project/workspace-import/approve'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
    )
    expect(approve.status).toBe(200)
    const body = await approve.json() as { ok?: boolean; tasksAdded?: number }
    expect(body.ok).toBe(true)
    expect(body.tasksAdded).toBe(2)

    const tasks = await readTasks(tmpDir)
    expect(tasks.some(task => task.title === 'Define fixture, expected-record, prototype-run, and evaluation schemas.')).toBe(true)
    expect(tasks.some(task => task.title === 'Add the first tiny fiction fixture and human-authored expected records.')).toBe(true)
  })

  it('treats posting the full detected defaults as a full refresh and archives stale importer residue', async () => {
    await fs.mkdir(path.join(tmpDir, 'docs', 'harness'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'harness', 'implementation-roadmap.md'),
      [
        '# Implementation Roadmap',
        '',
        '## Current Next Milestone',
        '',
        '1. Define fixture, expected-record, prototype-run, and evaluation schemas.',
      ].join('\n'),
      'utf8',
    )
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'full-refresh-defaults' }), 'utf8')
    await writeSystemText(
      'TASKS.json',
      JSON.stringify(
        {
          version: 1,
          lastUpdated: '2026-01-01T00:00:00.000Z',
          tasks: [
            {
              id: 'task-workspace-import',
              title: 'Review existing project work',
              description: 'Reserved importer',
              domain: '_workspace_import',
              projectPath: tmpDir,
              status: 'spec_review',
              priority: 'normal',
              acceptanceCriteria: [],
              dependsOn: [],
              outOfScope: [],
              spec: '',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
            {
              id: 'task-stale-import',
              title: '*(none — umbrella doc, covered by child specs)*',
              description: 'Old importer residue.',
              domain: 'core',
              projectPath: tmpDir,
              status: 'import_draft',
              priority: 'normal',
              acceptanceCriteria: [],
              dependsOn: [],
              outOfScope: [],
              notes: [],
              gateResults: [],
              reviewVerdicts: [],
              adjudications: [],
              escalations: [],
              agentIssues: [],
              revisionCount: 0,
              remediationAttempts: 0,
              origination: 'human',
              requestIntake: {
                intent: 'spec_only',
                recommendedNextAction: 'draft_spec',
                componentStack: [],
                assumptions: [],
                missingInformation: [],
                evidenceRefs: [],
                pressureTestSummary: {
                  systemOwned: true,
                  degree: 'guided',
                  qualityBar:
                    'Treat imported drafts as candidate work that must be reshaped against current evidence before implementation starts.',
                  ownerQuestionPolicy:
                    'Only ask when the imported evidence is no longer enough to choose a trustworthy task boundary or success condition.',
                  checks: [],
                },
                clarifyingQuestions: [],
                createdAt: '2026-01-01T00:00:00.000Z',
                createdBy: 'workspace-importer',
              },
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        },
        null,
        2,
      ),
    )

    const { app } = buildServeApp({ projectPath: tmpDir })

    const approve = await app.fetch(
      new Request(scoped('/api/project/workspace-import/approve'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    )
    const approveBody = await approve.json()
    if (approve.status !== 200) {
      throw new Error(`approve failed: status=${approve.status} body=${JSON.stringify(approveBody)}`)
    }

    const tasks = await readTasks(tmpDir)
    expect(tasks.find(task => task.id === 'task-stale-import')?.status).toBe('archived')
  })

  it('treats an explicit full-current approval as authoritative even when a saved importer spec is stale', async () => {
    await fs.mkdir(path.join(tmpDir, 'docs', 'harness'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'harness', 'implementation-roadmap.md'),
      [
        '# Implementation Roadmap',
        '',
        '## Current Next Milestone',
        '',
        '1. Define fixture, expected-record, prototype-run, and evaluation schemas.',
      ].join('\n'),
      'utf8',
    )
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'explicit-full-refresh' }), 'utf8')
    await writeSystemJson('workspace-goals.json', {
      version: 2,
      recordedAt: '2026-01-01T00:00:00.000Z',
      goals: [],
      tasks: [
        { id: 'imported-a', title: 'Define fixture, expected-record, prototype-run, and evaluation schemas.', description: 'Current task', domain: 'core', priority: 'high', references: [] },
        { id: 'imported-b', title: 'Implement fixture-and-expected-record schemas (from schema-contract-roadmap)', description: 'Stale task', domain: 'core', priority: 'high', references: [] },
      ],
      milestones: [],
      approved: {
        goalCount: 0,
        taskCount: 2,
        milestoneCount: 0,
        currentTaskCount: 2,
        laterTaskCount: 0,
        taskIds: ['imported-a', 'imported-b'],
      },
      detected: {
        goalCount: 0,
        taskCount: 1,
        milestoneCount: 0,
        currentTaskCount: 1,
        laterTaskCount: 0,
        taskIds: ['imported-a'],
      },
    })
    await writeSystemText(
      'TASKS.json',
      JSON.stringify(
        {
          version: 1,
          lastUpdated: '2026-01-01T00:00:00.000Z',
          tasks: [
            {
              id: 'task-workspace-import',
              title: 'Review existing project work',
              description: 'Reserved importer',
              domain: '_workspace_import',
              projectPath: tmpDir,
              status: 'done',
              priority: 'normal',
              acceptanceCriteria: [],
              dependsOn: [],
              outOfScope: [],
              spec: [
                '```yaml',
                'tasks:',
                '  - id: imported-a',
                '    title: Define fixture, expected-record, prototype-run, and evaluation schemas.',
                '    description: Current task',
                '    domain: core',
                '    priority: high',
                '  - id: imported-b',
                '    title: Implement fixture-and-expected-record schemas (from schema-contract-roadmap)',
                '    description: Stale task',
                '    domain: core',
                '    priority: high',
                '```',
              ].join('\n'),
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
            {
              id: 'imported-a',
              title: 'Define fixture, expected-record, prototype-run, and evaluation schemas.',
              description: 'Current task',
              domain: 'core',
              projectPath: tmpDir,
              status: 'ready',
              priority: 'high',
              acceptanceCriteria: [],
              dependsOn: [],
              outOfScope: [],
              notes: [],
              gateResults: [],
              reviewVerdicts: [],
              adjudications: [],
              escalations: [],
              agentIssues: [],
              revisionCount: 0,
              remediationAttempts: 0,
              origination: 'human',
              requestIntake: {
                intent: 'spec_only',
                recommendedNextAction: 'draft_spec',
                componentStack: [],
                assumptions: [],
                missingInformation: [],
                evidenceRefs: [],
                pressureTestSummary: {
                  systemOwned: true,
                  degree: 'guided',
                  qualityBar: 'Imported work must stay aligned with the current evidence slice.',
                  ownerQuestionPolicy: 'Only ask when the cited docs still leave the task boundary ambiguous.',
                  checks: [],
                },
                clarifyingQuestions: [],
                createdAt: '2026-01-01T00:00:00.000Z',
                createdBy: 'workspace-importer',
              },
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
            {
              id: 'imported-b',
              title: 'Implement fixture-and-expected-record schemas (from schema-contract-roadmap)',
              description: 'Stale task',
              domain: 'core',
              projectPath: tmpDir,
              status: 'ready',
              priority: 'high',
              acceptanceCriteria: [],
              dependsOn: [],
              outOfScope: [],
              notes: [],
              gateResults: [],
              reviewVerdicts: [],
              adjudications: [],
              escalations: [],
              agentIssues: [],
              revisionCount: 0,
              remediationAttempts: 0,
              origination: 'human',
              requestIntake: {
                intent: 'spec_only',
                recommendedNextAction: 'draft_spec',
                componentStack: [],
                assumptions: [],
                missingInformation: [],
                evidenceRefs: [],
                pressureTestSummary: {
                  systemOwned: true,
                  degree: 'guided',
                  qualityBar: 'Imported work must stay aligned with the current evidence slice.',
                  ownerQuestionPolicy: 'Only ask when the cited docs still leave the task boundary ambiguous.',
                  checks: [],
                },
                clarifyingQuestions: [],
                createdAt: '2026-01-01T00:00:00.000Z',
                createdBy: 'workspace-importer',
              },
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        },
        null,
        2,
      ),
    )

    const { app } = buildServeApp({ projectPath: tmpDir })

    const approve = await app.fetch(
      new Request(scoped('/api/project/workspace-import/approve'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ taskIds: ['imported-a'] }),
      }),
    )
    expect(approve.status).toBe(200)

    const tasks = await readTasks(tmpDir)
    expect(tasks.find(task => task.id === 'imported-b')?.status).toBe('archived')

    const importerTask = tasks.find(task => task.id === 'task-workspace-import')
    expect(importerTask?.spec).toContain('Define fixture, expected-record, prototype-run, and evaluation schemas.')
    expect(importerTask?.spec).not.toContain('Implement fixture-and-expected-record schemas (from schema-contract-roadmap)')

    const goalsState = await readProjectStateJsonAsync<{
      approved: { taskCount: number; currentTaskCount: number }
      detected: { taskCount: number; currentTaskCount: number } | null
    }>(tmpDir, 'workspace-goals.json')
    expect(goalsState.approved).toMatchObject({ taskCount: 1, currentTaskCount: 1 })
    expect(goalsState.detected).toMatchObject({ taskCount: 1, currentTaskCount: 1 })
  })

  it('keeps durable all-terminal readiness when fresher docs would require a new import', async () => {
    await fs.mkdir(path.join(tmpDir, 'docs', 'harness'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'harness', 'implementation-roadmap.md'),
      [
        '# Implementation Roadmap',
        '',
        '## Stage 1: Fixture And Evaluation Harness',
        '',
        '## Current Next Milestone',
        '',
        'The next milestone is Stage 1: Fixture And Evaluation Harness.',
        '',
        '1. Define fixture, expected-record, prototype-run, and evaluation schemas.',
      ].join('\n'),
      'utf8',
    )
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'all-terminal-import-drift' }), 'utf8')
    await writeSystemText(
      'TASKS.json',
      JSON.stringify(
        {
          version: 1,
          lastUpdated: '2026-01-01T00:00:00.000Z',
          tasks: [
            {
              id: 'task-workspace-import',
              title: 'Review existing project work',
              description: 'Reserved importer',
              domain: '_workspace_import',
              projectPath: tmpDir,
              status: 'done',
              priority: 'normal',
              acceptanceCriteria: [],
              dependsOn: [],
              outOfScope: [],
              spec: [
                '```yaml',
                'goals:',
                '  - id: imported-direction',
                '    title: Narrative Harness',
                '    rationale: A stale importer run only saved the project goal.',
                '```',
              ].join('\n'),
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        },
        null,
        2,
      ),
    )

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(scopedDiagnostic('/api/project')))
    expect(res.status).toBe(200)
    const body = await res.json() as {
      startReadiness?: { canStart?: boolean; code?: string; message?: string; actionHref?: string }
      orientationSpine?: { summary?: { headline?: string; topBlocker?: string; nextAction?: string } }
    }
    expect(body.startReadiness).toMatchObject({
      canStart: false,
      code: 'all_terminal',
    })
    expect(body.startReadiness?.message).toBe('All tasks are already finished.')
    expect(body.orientationSpine?.summary).toMatchObject({
      headline: 'Current scope is in progress.',
      topBlocker: null,
      nextAction: 'Current work has no runnable work remaining.',
    })
  })

  it('does not replace durable readiness with a partial live detector scan', async () => {
    await fs.mkdir(path.join(tmpDir, 'docs', 'harness'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'harness', 'implementation-roadmap.md'),
      [
        '# Implementation Roadmap',
        '',
        '## Stage 1: Fixture And Evaluation Harness',
        '',
        '## Current Next Milestone',
        '',
        'The next milestone is Stage 1: Fixture And Evaluation Harness.',
        '',
        '1. Define fixture, expected-record, prototype-run, and evaluation schemas.',
        '2. Add the first tiny fiction fixture and human-authored expected records.',
      ].join('\n'),
      'utf8',
    )
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'partial-import-drift' }), 'utf8')
    await writeSystemText(
      'TASKS.json',
      JSON.stringify(
        {
          version: 1,
          lastUpdated: '2026-01-01T00:00:00.000Z',
          tasks: [
            {
              id: 'task-workspace-import',
              title: 'Review existing project work',
              description: 'Reserved importer',
              domain: '_workspace_import',
              projectPath: tmpDir,
              status: 'done',
              priority: 'normal',
              acceptanceCriteria: [],
              dependsOn: [],
              outOfScope: [],
              spec: [
                '```yaml',
                'tasks:',
                '  - id: imported-one',
                '    title: Define fixture, expected-record, prototype-run, and evaluation schemas.',
                '    description: Keep only the first detected task.',
                '    domain: harness',
                '    priority: high',
                '```',
              ].join('\n'),
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        },
        null,
        2,
      ),
    )

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(scopedDiagnostic('/api/project')))
    expect(res.status).toBe(200)
    const body = await res.json() as {
      startReadiness?: { canStart?: boolean; code?: string; message?: string; actionHref?: string }
    }
    expect(body.startReadiness).toMatchObject({
      canStart: false,
      code: 'all_terminal',
    })
    expect(body.startReadiness?.message).toBe('All tasks are already finished.')
  })

  it('allows materialized current-scope work to continue even when the saved import is under-scoped', async () => {
    await fs.mkdir(path.join(tmpDir, 'docs', 'harness'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'harness', 'implementation-roadmap.md'),
      [
        '# Implementation Roadmap',
        '',
        '## Stage 1: Fixture And Evaluation Harness',
        '',
        '## Current Next Milestone',
        '',
        'The next milestone is Stage 1: Fixture And Evaluation Harness.',
        '',
        '1. Define fixture, expected-record, prototype-run, and evaluation schemas.',
        '2. Add the first tiny fiction fixture and human-authored expected records.',
      ].join('\n'),
      'utf8',
    )
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'partial-import-with-live-work' }), 'utf8')
    await writeSystemText(
      'TASKS.json',
      JSON.stringify(
        {
          version: 1,
          lastUpdated: '2026-01-01T00:00:00.000Z',
          tasks: [
            {
              id: 'task-workspace-import',
              title: 'Review existing project work',
              description: 'Reserved importer',
              domain: '_workspace_import',
              projectPath: tmpDir,
              status: 'done',
              priority: 'normal',
              acceptanceCriteria: [],
              dependsOn: [],
              outOfScope: [],
              spec: [
                '```yaml',
                'tasks:',
                '  - id: imported-one',
                '    title: Define fixture, expected-record, prototype-run, and evaluation schemas.',
                '    description: Keep only the first detected task.',
                '    domain: harness',
                '    priority: high',
                '```',
              ].join('\n'),
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
            {
              id: 'imported-one',
              title: 'Define fixture, expected-record, prototype-run, and evaluation schemas.',
              description: 'Materialized current-scope work should keep running.',
              domain: 'harness',
              projectPath: tmpDir,
              status: 'ready',
              priority: 'high',
              acceptanceCriteria: [{ id: 'ac-1', description: 'Schema proof exists.', verifiedBy: 'review', met: false }],
              dependsOn: [],
              outOfScope: [],
              spec: 'Create the schema proof and record verification.',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        },
        null,
        2,
      ),
    )

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(scoped('/api/project')))
    expect(res.status).toBe(200)
    const body = await res.json() as {
      startReadiness?: { canStart?: boolean; code?: string; message?: string; actionHref?: string }
    }
    expect(body.startReadiness?.code).not.toBe('workspace_import_refresh_needed')
    expect(body.startReadiness?.message ?? '').not.toContain('under-scoped')
  })

  it('prioritizes shaping selected-release import drafts over global import refresh drift', async () => {
    await fs.mkdir(path.join(tmpDir, 'docs', 'harness'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'harness', 'implementation-roadmap.md'),
      [
        '# Implementation Roadmap',
        '',
        '## Stage 1: Fixture And Evaluation Harness',
        '',
        '## Current Next Milestone',
        '',
        'The next milestone is Stage 1: Fixture And Evaluation Harness.',
        '',
        '1. Define fixture, expected-record, prototype-run, and evaluation schemas.',
        '2. Add the first tiny fiction fixture and human-authored expected records.',
      ].join('\n'),
      'utf8',
    )
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'selected-release-import-draft' }), 'utf8')
    await writeSystemText(
      'TASKS.json',
      JSON.stringify(
        {
          version: 1,
          lastUpdated: '2026-01-01T00:00:00.000Z',
          selectedReleaseId: 'stage-1-fixture-and-evaluation-harness',
          releases: [
            {
              id: 'stage-1-fixture-and-evaluation-harness',
              label: 'Stage 1: Fixture And Evaluation Harness',
              kind: 'release',
              state: 'active',
              source: 'release_plan',
              nodeIds: ['work:imported-one'],
              deferredNodeIds: [],
            },
          ],
          tasks: [
            {
              id: 'task-workspace-import',
              title: 'Review existing project work',
              description: 'Reserved importer',
              domain: '_workspace_import',
              projectPath: tmpDir,
              status: 'done',
              priority: 'normal',
              acceptanceCriteria: [],
              dependsOn: [],
              outOfScope: [],
              spec: [
                '```yaml',
                'tasks:',
                '  - id: imported-one',
                '    title: Define fixture, expected-record, prototype-run, and evaluation schemas.',
                '    description: Keep only the first detected task.',
                '    domain: harness',
                '    priority: high',
                '```',
              ].join('\n'),
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
            {
              id: 'imported-one',
              title: 'Define fixture, expected-record, prototype-run, and evaluation schemas.',
              description: 'Selected-release import draft should be shaped before global import drift blocks Start.',
              domain: 'harness',
              projectPath: tmpDir,
              status: 'import_draft',
              priority: 'high',
              releaseIds: ['stage-1-fixture-and-evaluation-harness'],
              acceptanceCriteria: [{ id: 'ac-1', description: 'Schema proof exists.', verifiedBy: 'review', met: false }],
              dependsOn: [],
              outOfScope: [],
              spec: 'Imported draft awaiting source-backed shaping.',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        },
        null,
        2,
      ),
    )

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(scopedDiagnostic('/api/project')))
    expect(res.status).toBe(200)
    const body = await res.json() as {
      startReadiness?: { canStart?: boolean; code?: string; message?: string; actionHref?: string }
    }
    expect(body.startReadiness).toMatchObject({
      canStart: false,
      code: 'imported_scope_shaping',
      actionHref: '/task/imported-one',
    })
    expect(body.startReadiness?.message ?? '').toContain('source-backed shaping')
    expect(body.startReadiness?.message ?? '').not.toContain('under-scoped')
  })

  it('does not replace durable readiness with unlinked capability docs', async () => {
    await fs.mkdir(path.join(tmpDir, 'docs', 'harness'), { recursive: true })
    await fs.mkdir(path.join(tmpDir, 'docs', 'specs'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'harness', 'implementation-roadmap.md'),
      [
        '# Implementation Roadmap',
        '',
        '## Stage 1: Fixture And Evaluation Harness',
        '',
        '## Current Next Milestone',
        '',
        'The next milestone is Stage 1: Fixture And Evaluation Harness.',
        '',
        '1. Define fixture, expected-record, prototype-run, and evaluation schemas.',
      ].join('\n'),
      'utf8',
    )
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'specs', 'world-and-object-continuity.md'),
      [
        '# World And Object Continuity',
        '',
        'Track object state, world facts, and causal continuity across scenes.',
      ].join('\n'),
      'utf8',
    )
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'spec-capability-gap' }), 'utf8')
    await writeSystemText(
      'TASKS.json',
      JSON.stringify(
        {
          version: 1,
          lastUpdated: '2026-01-01T00:00:00.000Z',
          tasks: [
            {
              id: 'task-workspace-import',
              title: 'Review existing project work',
              description: 'Reserved importer',
              domain: '_workspace_import',
              projectPath: tmpDir,
              status: 'done',
              priority: 'normal',
              acceptanceCriteria: [],
              dependsOn: [],
              outOfScope: [],
              spec: [
                '```yaml',
                'tasks:',
                '  - id: imported-one',
                '    title: Define fixture, expected-record, prototype-run, and evaluation schemas.',
                '    description: Saved importer task.',
                '    domain: harness',
                '    priority: high',
                '    references:',
                '      - docs/harness/implementation-roadmap.md',
                '```',
              ].join('\n'),
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        },
        null,
        2,
      ),
    )

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(scopedDiagnostic('/api/project')))
    expect(res.status).toBe(200)
    const body = await res.json() as {
      startReadiness?: { canStart?: boolean; code?: string; message?: string; actionHref?: string }
    }
    expect(body.startReadiness).toMatchObject({
      canStart: false,
      code: 'all_terminal',
    })
    expect(body.startReadiness?.message).toBe('All tasks are already finished.')
  })

  it('blocks Start when an imported contract task has a hollow worker handoff', async () => {
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'hollow-contract-handoff' }), 'utf8')
    await writeSystemText(
      'TASKS.json',
      JSON.stringify(
        {
          version: 1,
          lastUpdated: '2026-01-01T00:00:00.000Z',
          tasks: [
            {
              id: 'task-import-author-involvement',
              title: 'Implement author-involvement-modes contract and involvement-dial types',
              description: 'Source-backed task from remaining spec inventory.',
              domain: 'workflow',
              projectPath: tmpDir,
              status: 'ready',
              priority: 'normal',
              references: [
                'docs/harness/remaining-spec-decomposition-inventory.md',
                'docs/specs/author-involvement-modes.md',
              ],
              requestIntake: {
                createdBy: 'workspace-importer',
              },
              acceptanceCriteria: [
                {
                  id: 'contracts-defined',
                  description: 'The cited contracts are explicitly defined and usable in code: .',
                  verifiedBy: 'review',
                  met: false,
                },
              ],
              spec: [
                '## What this is',
                'Implement author-involvement-modes contract and involvement-dial types',
                '',
                '## Acceptance criteria',
                '1. The cited contracts are explicitly defined and usable in code: .',
              ].join('\n'),
              definitionOfDone: {
                items: ['The cited contracts are explicitly defined and usable in code: .'],
                evidenceRequired: [],
              },
              taskReadiness: {
                recommendation: 'ready',
                summary: 'Task is ready for a focused worker pass.',
                definitionOfDone: {
                  items: ['The cited contracts are explicitly defined and usable in code: .'],
                  evidenceRequired: [],
                },
              },
              dependsOn: [],
              outOfScope: [],
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        },
        null,
        2,
      ),
    )

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(scopedDiagnostic('/api/project')))
    expect(res.status).toBe(200)
    const body = await res.json() as {
      startReadiness?: { canStart?: boolean; code?: string; message?: string; actionHref?: string; focusKind?: string }
      actionModel?: { runControl?: { startEnabled?: boolean; label?: string } }
      tasks?: Array<{ id?: string; taskReadiness?: { recommendation?: string; summary?: string }; structuralIntegrity?: { status?: string } }>
    }
    expect(body.startReadiness).toMatchObject({
      canStart: false,
      code: 'no_unattended_progress',
      actionHref: '/work?task=task-import-author-involvement',
      focusKind: 'brief_cleanup',
    })
    expect(body.startReadiness?.message).toContain('needs concrete contract names')
    expect(body.actionModel?.runControl).toMatchObject({
      startEnabled: false,
      label: 'Review brief',
    })
    expect(body.tasks?.find(task => task.id === 'task-import-author-involvement')).toMatchObject({
      taskReadiness: {
        recommendation: 'needs_research_spike',
        summary: expect.stringContaining('needs concrete contract names'),
      },
      structuralIntegrity: {
        status: 'needs_repair',
      },
    })
  })

  it('does not treat later release spec capabilities as current import blockers', async () => {
    await fs.mkdir(path.join(tmpDir, 'docs', 'harness'), { recursive: true })
    await fs.mkdir(path.join(tmpDir, 'docs', 'specs'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'harness', 'implementation-roadmap.md'),
      [
        '# Implementation Roadmap',
        '',
        '## Stage 1: Fixture And Evaluation Harness',
        '',
        '## Stage 2: Mastra Agent Prototype',
        '',
        'Deliverables:',
        '- specialist editor agent calls for the first review lanes',
        '',
        '## Current Next Milestone',
        '',
        'The next milestone is Stage 1: Fixture And Evaluation Harness.',
        '',
        '1. Define fixture, expected-record, prototype-run, and evaluation schemas.',
      ].join('\n'),
      'utf8',
    )
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'harness', 'remaining-spec-decomposition-inventory.md'),
      [
        '# Remaining Spec Decomposition Inventory',
        '',
        '### 2.2 `dialogue-and-character-voice.md`',
        '',
        '- **Recommended first task title:** Implement dialogue-and-character-voice reviewer lane',
        '- **Recommended domain:** coherence',
        '- **Stage alignment:** Stage 2 (Agent Coordination)',
      ].join('\n'),
      'utf8',
    )
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'specs', 'dialogue-and-character-voice.md'),
      '# Dialogue And Character Voice\n',
      'utf8',
    )
    await writeSystemText(
      'TASKS.json',
      JSON.stringify(
        {
          version: 1,
          lastUpdated: '2026-01-01T00:00:00.000Z',
          tasks: [
            {
              id: 'task-workspace-import',
              title: 'Review existing project work',
              description: 'Reserved importer',
              domain: '_workspace_import',
              projectPath: tmpDir,
              status: 'done',
              priority: 'normal',
              acceptanceCriteria: [],
              dependsOn: [],
              outOfScope: [],
              spec: [
                '```yaml',
                'tasks:',
                '  - id: imported-one',
                '    title: Define fixture, expected-record, prototype-run, and evaluation schemas.',
                '    description: Saved importer task.',
                '    domain: harness',
                '    priority: high',
                '    references:',
                '      - docs/harness/implementation-roadmap.md',
                '```',
              ].join('\n'),
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        },
        null,
        2,
      ),
    )

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(scoped('/api/project')))
    expect(res.status).toBe(200)
    const body = await res.json() as {
      startReadiness?: { canStart?: boolean; code?: string; message?: string; actionHref?: string }
    }
    expect(body.startReadiness?.message ?? '').not.toContain('structurally incomplete')
    expect(body.startReadiness?.message ?? '').not.toContain('Spec: Dialogue And Character Voice')
  })

  it('does not block readiness on shadowed current-milestone deliverables when starter tasks already define the active slice', async () => {
    await fs.mkdir(path.join(tmpDir, 'docs', 'harness'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'harness', 'implementation-roadmap.md'),
      [
        '# Implementation Roadmap',
        '',
        '## Stage 1: Fixture And Evaluation Harness',
        '',
        'Deliverables:',
        '- fixture directory shape for at least one small story fixture',
        '- typed fixture and expected-record contracts',
        '- scripts or tests that ingest a fixture, build records, run a packet, and',
        '  save the run output',
        '',
        '## Current Next Milestone',
        '',
        'The next milestone is Stage 1: Fixture And Evaluation Harness.',
        '',
        '1. Define fixture, expected-record, prototype-run, and evaluation schemas.',
        '2. Add the first tiny fiction fixture and human-authored expected records.',
      ].join('\n'),
      'utf8',
    )
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'starter-only-import-gap' }), 'utf8')
    await writeSystemText(
      'TASKS.json',
      JSON.stringify(
        {
          version: 1,
          lastUpdated: '2026-01-01T00:00:00.000Z',
          tasks: [
            {
              id: 'task-workspace-import',
              title: 'Review existing project work',
              description: 'Reserved importer',
              domain: '_workspace_import',
              projectPath: tmpDir,
              status: 'done',
              priority: 'normal',
              acceptanceCriteria: [],
              dependsOn: [],
              outOfScope: [],
              spec: [
                '```yaml',
                'tasks:',
                '  - id: imported-one',
                '    title: Define fixture, expected-record, prototype-run, and evaluation schemas.',
                '    description: Saved starter task.',
                '    domain: harness',
                '    priority: high',
                '    references:',
                '      - docs/harness/implementation-roadmap.md',
                '  - id: imported-two',
                '    title: Add the first tiny fiction fixture and human-authored expected records.',
                '    description: Saved starter task.',
                '    domain: harness',
                '    priority: high',
                '    references:',
                '      - docs/harness/implementation-roadmap.md',
                '```',
              ].join('\n'),
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        },
        null,
        2,
      ),
    )

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(scoped('/api/project')))
    expect(res.status).toBe(200)
    const body = await res.json() as {
      startReadiness?: { canStart?: boolean; code?: string; message?: string; actionHref?: string }
    }
    expect(body.startReadiness).toMatchObject({
      canStart: false,
      code: 'all_terminal',
    })
    expect(body.startReadiness?.code).not.toBe('workspace_import_refresh_needed')
  })

  it('does not report import drift when an indented completion note follows an already saved current task', async () => {
    await fs.mkdir(path.join(tmpDir, 'docs', 'harness'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'harness', 'implementation-roadmap.md'),
      [
        '# Implementation Roadmap',
        '',
        '## Stage 1: Fixture And Evaluation Harness',
        '',
        '## Current Next Milestone',
        '',
        'The next milestone is Stage 1: Fixture And Evaluation Harness.',
        '',
        '1. Use the first run to narrow the MVP story-memory schema.',
        '   ✓ Completed — see [mvp-story-memory-schema-narrowing.md](../specs/mvp-story-memory-schema-narrowing.md)',
        '     and the updated [schema-contract-roadmap.md](../specs/schema-contract-roadmap.md#mvp-contract-boundary).',
      ].join('\n'),
      'utf8',
    )
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'clean-completion-note' }), 'utf8')
    await writeSystemText(
      'TASKS.json',
      JSON.stringify(
        {
          version: 1,
          lastUpdated: '2026-01-01T00:00:00.000Z',
          tasks: [
            {
              id: 'task-workspace-import',
              title: 'Review existing project work',
              description: 'Reserved importer',
              domain: '_workspace_import',
              projectPath: tmpDir,
              status: 'done',
              priority: 'normal',
              acceptanceCriteria: [],
              dependsOn: [],
              outOfScope: [],
              spec: [
                '```yaml',
                'tasks:',
                '  - id: task-import-1v2ehs',
                '    title: Use the first run to narrow the MVP story-memory schema.',
                '    description: Saved current task.',
                '    domain: harness',
                '    priority: high',
                '    references:',
                '      - docs/harness/implementation-roadmap.md',
                '```',
              ].join('\n'),
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
            {
              id: 'task-import-1v2ehs',
              title: 'Use the first run to narrow the MVP story-memory schema.',
              description: 'Saved current task.',
              domain: 'harness',
              projectPath: tmpDir,
              status: 'done',
              priority: 'high',
              acceptanceCriteria: [],
              dependsOn: [],
              outOfScope: [],
              references: [
                'docs/harness/implementation-roadmap.md',
              ],
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        },
        null,
        2,
      ),
    )

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(scoped('/api/project')))
    expect(res.status).toBe(200)
    const body = await res.json() as {
      startReadiness?: { canStart?: boolean; code?: string; message?: string; actionHref?: string }
      orientationSpine?: { summary?: { headline?: string; topBlocker?: string; nextAction?: string } }
    }
    expect(body.startReadiness?.message ?? '').not.toContain('Completed')
    expect(body.startReadiness?.code).not.toBe('workspace_import_refresh_needed')
    expect(body.startReadiness).toMatchObject({
      canStart: false,
      code: 'all_terminal',
    })
    expect(body.orientationSpine?.summary?.headline ?? '').not.toContain('needs import refresh')
    expect(body.orientationSpine?.summary?.topBlocker ?? '').not.toBe('Workspace import is under-scoped.')
  })

  it('treats documented spec-to-task coverage links as real structural coverage', async () => {
    await fs.mkdir(path.join(tmpDir, 'docs', 'harness'), { recursive: true })
    await fs.mkdir(path.join(tmpDir, 'docs', 'specs'), { recursive: true })
    await fs.writeFile(path.join(tmpDir, 'docs', 'specs', 'author-voice-system.md'), '# Author Voice System\n', 'utf8')
    await fs.writeFile(path.join(tmpDir, 'docs', 'specs', 'world-and-object-continuity.md'), '# World And Object Continuity\n', 'utf8')
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'harness', 'remaining-spec-decomposition-inventory.md'),
      [
        '# Remaining Spec Decomposition Inventory',
        '',
        '## 1. Already-Decomposed Specs (Reference)',
        '',
        '| Spec File | Matching Task(s) | Notes |',
        '|-----------|------------------|-------|',
        '| `author-voice-system.md` | `author-voice-loop-mvp` | done |',
        '| `world-and-object-continuity.md` | `coherence-reviewer-mvp` | done |',
      ].join('\n'),
      'utf8',
    )
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'spec-coverage-links' }), 'utf8')
    await writeSystemText(
      'TASKS.json',
      JSON.stringify(
        {
          version: 1,
          lastUpdated: '2026-01-01T00:00:00.000Z',
          tasks: [
            {
              id: 'task-workspace-import',
              title: 'Review existing project work',
              description: 'Reserved importer',
              domain: '_workspace_import',
              projectPath: tmpDir,
              status: 'done',
              priority: 'normal',
              acceptanceCriteria: [],
              dependsOn: [],
              outOfScope: [],
              spec: [
                '```yaml',
                'milestones:',
                '  - title: "Import reviewed"',
                '    evidence: "Approved."',
                '```',
              ].join('\n'),
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
            {
              id: 'author-voice-loop-mvp',
              title: 'Build author voice loop MVP',
              description: 'Implements the author voice loop.',
              domain: 'harness',
              projectPath: tmpDir,
              status: 'done',
              priority: 'high',
              acceptanceCriteria: [],
              dependsOn: [],
              outOfScope: [],
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
            {
              id: 'coherence-reviewer-mvp',
              title: 'Build coherence reviewer MVP',
              description: 'Implements the coherence reviewer lane.',
              domain: 'coherence',
              projectPath: tmpDir,
              status: 'done',
              priority: 'high',
              acceptanceCriteria: [],
              dependsOn: [],
              outOfScope: [],
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        },
        null,
        2,
      ),
    )

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(scoped('/api/project')))
    expect(res.status).toBe(200)
    const body = await res.json() as {
      startReadiness?: { canStart?: boolean; code?: string; message?: string; actionHref?: string }
    }
    expect(body.startReadiness?.code).not.toBe('workspace_import_refresh_needed')
    expect(body.startReadiness?.message ?? '').not.toContain('Spec: World And Object Continuity')
  })

  it('does not let stale historical spec-link ids block a bounded current release slice', async () => {
    await fs.mkdir(path.join(tmpDir, 'docs', 'harness'), { recursive: true })
    await fs.mkdir(path.join(tmpDir, 'docs', 'specs'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'harness', 'implementation-roadmap.md'),
      [
        '# Implementation Roadmap',
        '',
        '## Stage 1: Fixture And Evaluation Harness',
        '',
        '## Stage 2: Reviewer Lanes',
        '',
        'Deliverables:',
        '- specialist editor agent calls for the first review lanes',
        '',
        '## Current Next Milestone',
        '',
        'The next milestone is Stage 1: Fixture And Evaluation Harness.',
        '',
        '1. Define fixture, expected-record, prototype-run, and evaluation schemas.',
      ].join('\n'),
      'utf8',
    )
    await fs.writeFile(path.join(tmpDir, 'docs', 'specs', 'character-continuity-and-change.md'), '# Character Continuity And Change\n', 'utf8')
    await fs.writeFile(path.join(tmpDir, 'docs', 'specs', 'world-and-object-continuity.md'), '# World And Object Continuity\n', 'utf8')
    await fs.writeFile(path.join(tmpDir, 'docs', 'specs', 'schema-contract-roadmap.md'), '# Schema Contract Roadmap\n', 'utf8')
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'harness', 'remaining-spec-decomposition-inventory.md'),
      [
        '# Remaining Spec Decomposition Inventory',
        '',
        '## 1. Already-Decomposed Specs (Reference)',
        '',
        '| Spec File | Matching Task(s) | Notes |',
        '|-----------|------------------|-------|',
        '| `character-continuity-and-change.md` | `coherence-reviewer-mvp` | done |',
        '| `world-and-object-continuity.md` | `coherence-reviewer-mvp` | done |',
        '',
        '## 2. Remaining Specs — Inventory',
        '',
        '### 2.1 `dialogue-and-character-voice.md`',
        '',
        '- **Covers:** Dialogue review lane.',
        '- **Why not decomposed yet:** Later stage work.',
        '- **Recommended first task title:** Implement dialogue-and-character-voice reviewer lane',
        '- **Recommended domain:** coherence',
        '- **Stage alignment:** Stage 2 (Agent Coordination)',
      ].join('\n'),
      'utf8',
    )
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'bounded-scope-stale-links' }), 'utf8')
    await writeSystemText(
      'TASKS.json',
      JSON.stringify(
        {
          version: 1,
          lastUpdated: '2026-01-01T00:00:00.000Z',
          tasks: [
            {
              id: 'task-workspace-import',
              title: 'Review existing project work',
              description: 'Reserved importer',
              domain: '_workspace_import',
              projectPath: tmpDir,
              status: 'done',
              priority: 'normal',
              acceptanceCriteria: [],
              dependsOn: [],
              outOfScope: [],
              spec: [
                '```yaml',
                'tasks:',
                '  - id: imported-one',
                '    title: Define fixture, expected-record, prototype-run, and evaluation schemas.',
                '    description: Saved importer current slice.',
                '    domain: harness',
                '    priority: high',
                '    references:',
                '      - docs/harness/implementation-roadmap.md',
                '      - docs/specs/schema-contract-roadmap.md',
                '  - id: imported-later',
                '    title: specialist editor agent calls for the first review lanes',
                '    description: Deferred later work.',
                '    domain: coherence',
                '    priority: normal',
                '    scope: later',
                '    references:',
                '      - docs/harness/implementation-roadmap.md',
                '```',
              ].join('\n'),
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
            {
              id: 'imported-one',
              title: 'Define fixture, expected-record, prototype-run, and evaluation schemas.',
              description: 'Saved importer current slice.',
              domain: 'harness',
              projectPath: tmpDir,
              status: 'ready',
              priority: 'high',
              acceptanceCriteria: [],
              dependsOn: [],
              outOfScope: [],
              references: [
                'docs/harness/implementation-roadmap.md',
                'docs/specs/schema-contract-roadmap.md',
              ],
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
            {
              id: 'imported-later',
              title: 'specialist editor agent calls for the first review lanes',
              description: 'Deferred later work.',
              domain: 'coherence',
              projectPath: tmpDir,
              status: 'shelved',
              priority: 'normal',
              acceptanceCriteria: [],
              dependsOn: [],
              outOfScope: [],
              references: ['docs/harness/implementation-roadmap.md'],
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        },
        null,
        2,
      ),
    )

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(scoped('/api/project')))
    expect(res.status).toBe(200)
    const body = await res.json() as {
      startReadiness?: { canStart?: boolean; code?: string; message?: string; actionHref?: string }
    }
    expect(body.startReadiness?.message ?? '').not.toContain('structurally incomplete')
    expect(body.startReadiness?.message ?? '').not.toContain('Character Continuity')
    expect(body.startReadiness?.message ?? '').not.toContain('World And Object Continuity')
  })

  it('does not let archived stale imports replace durable all-terminal readiness', async () => {
    await fs.mkdir(path.join(tmpDir, 'docs', 'harness'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'harness', 'implementation-roadmap.md'),
      [
        '# Implementation Roadmap',
        '',
        '## Stage 1: Fixture And Evaluation Harness',
        '',
        '## Current Next Milestone',
        '',
        'The next milestone is Stage 1: Fixture And Evaluation Harness.',
        '',
        '1. Define fixture, expected-record, prototype-run, and evaluation schemas.',
        '2. Add the first tiny fiction fixture and human-authored expected records.',
      ].join('\n'),
      'utf8',
    )
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'archived-import-drift' }), 'utf8')
    await writeSystemText(
      'TASKS.json',
      JSON.stringify(
        {
          version: 1,
          lastUpdated: '2026-01-01T00:00:00.000Z',
          tasks: [
            {
              id: 'task-workspace-import',
              title: 'Review existing project work',
              description: 'Reserved importer',
              domain: '_workspace_import',
              projectPath: tmpDir,
              status: 'done',
              priority: 'normal',
              acceptanceCriteria: [],
              dependsOn: [],
              outOfScope: [],
              spec: [
                '```yaml',
                'tasks:',
                '  - id: imported-one',
                '    title: Define fixture, expected-record, prototype-run, and evaluation schemas.',
                '    description: Saved importer only shaped the first task.',
                '    domain: harness',
                '    priority: high',
                '```',
              ].join('\n'),
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
            {
              id: 'task-shadow',
              title: 'Add the first tiny fiction fixture and human-authored expected records.',
              description: 'Old stale import that no longer counts as live coverage.',
              domain: 'harness',
              projectPath: tmpDir,
              status: 'archived',
              priority: 'normal',
              acceptanceCriteria: [],
              dependsOn: [],
              outOfScope: [],
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        },
        null,
        2,
      ),
    )

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(scopedDiagnostic('/api/project')))
    expect(res.status).toBe(200)
    const body = await res.json() as {
      startReadiness?: { canStart?: boolean; code?: string; message?: string; actionHref?: string }
    }
    expect(body.startReadiness).toMatchObject({
      canStart: false,
      code: 'all_terminal',
    })
    expect(body.startReadiness?.message).toBe('No actionable tasks remain: 0 done, 0 blocked, 0 shelved, 0 pending PR, 1 archived, 0 cancelled.')
  })

  it('returns approved import context from saved workspace goals state', async () => {
    await writeSystemTasks({
      version: 1,
      lastUpdated: '2026-01-01T00:00:00.000Z',
      tasks: [
        {
          id: 'task-workspace-import',
          title: 'Review existing project work',
          description: 'Reserved importer',
          domain: '_workspace_import',
          projectPath: tmpDir,
          status: 'done',
          priority: 'normal',
          acceptanceCriteria: [],
          dependsOn: [],
          outOfScope: [],
          spec: [
            '```yaml',
            'tasks:',
            '  - id: imported-one',
            '    title: Define fixture schemas',
            '    description: Saved importer task.',
            '    domain: harness',
            '    priority: high',
            '```',
          ].join('\n'),
          notes: [],
          gateResults: [],
          reviewVerdicts: [],
          adjudications: [],
          escalations: [],
          agentIssues: [],
          origination: 'system',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    })
    await writeSystemJson('workspace-goals.json', {
      version: 3,
      recordedAt: '2026-01-01T00:00:00.000Z',
      goals: [],
      tasks: [
        {
          id: 'imported-one',
          title: 'Define fixture schemas',
          description: 'Saved importer task.',
          domain: 'harness',
          priority: 'high',
          references: ['docs/harness/implementation-roadmap.md'],
          scope: 'current',
        },
      ],
      milestones: [],
      context: [
        {
          label: 'Author defines book intent, genre/form expectations, themes, and voice.',
          excerpt: 'Book-brief framing.',
          source: 'planning-docs',
          references: ['docs/harness/architecture-notes.md'],
          role: 'brief_input',
          structure: 'note',
        },
      ],
      approved: {
        goalCount: 0,
        taskCount: 1,
        milestoneCount: 0,
        currentTaskCount: 1,
        laterTaskCount: 0,
        taskIds: ['imported-one'],
        currentTaskIds: ['imported-one'],
        laterTaskIds: [],
      },
      detected: null,
    })

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(scoped('/api/project/workspace-import/draft')))
    expect(res.status).toBe(200)
    const body = await res.json() as {
      parsed?: { context?: Array<{ label?: string; role?: string }> }
    }
    expect(body.parsed?.context).toEqual([
      expect.objectContaining({
        label: 'Author defines book intent, genre/form expectations, themes, and voice.',
        role: 'brief_input',
      }),
    ])
  })

  it('serves saved structural context without reconstructing a live detector draft', async () => {
    await fs.mkdir(path.join(tmpDir, 'docs', 'harness'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'harness', 'architecture-notes.md'),
      [
        '# Architecture Notes',
        '',
        '## Core Loop',
        '1. Author defines book intent, genre/form expectations, themes, and voice.',
        '',
        '## System Records',
        '| Record | Purpose |',
        '| --- | --- |',
        '| Book brief | author voice, premise, genre, themes, constraints |',
      ].join('\n'),
      'utf8',
    )
    await writeSystemTasks({
      version: 1,
      lastUpdated: '2026-01-01T00:00:00.000Z',
      tasks: [
        {
          id: 'task-workspace-import',
          title: 'Review existing project work',
          description: 'Reserved importer',
          domain: '_workspace_import',
          projectPath: tmpDir,
          status: 'done',
          priority: 'normal',
          acceptanceCriteria: [],
          dependsOn: [],
          outOfScope: [],
          spec: '```yaml\ntasks: []\n```',
          notes: [],
          gateResults: [],
          reviewVerdicts: [],
          adjudications: [],
          escalations: [],
          agentIssues: [],
          origination: 'system',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    })
    await writeSystemJson('workspace-goals.json', {
      version: 2,
      recordedAt: '2026-01-01T00:00:00.000Z',
      goals: [],
      tasks: [],
      milestones: [],
      context: [
        {
          label: 'Author defines book intent, genre/form expectations, themes, and voice.',
          excerpt: 'Legacy structural note with no explicit record shape.',
          source: 'planning-docs',
          references: ['docs/harness/architecture-notes.md'],
          role: 'brief_input',
        },
      ],
      approved: {
        goalCount: 0,
        taskCount: 0,
        milestoneCount: 0,
        currentTaskCount: 0,
        laterTaskCount: 0,
        taskIds: [],
      },
      detected: null,
    })

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(scoped('/api/project/workspace-import/draft')))
    expect(res.status).toBe(200)
    const body = await res.json() as {
      parsed?: { context?: Array<{ label?: string; structure?: string }> }
      detected?: { context?: Array<{ label?: string; structure?: string; role?: string }> }
    }
    expect(body.parsed?.context).toEqual([
      expect.objectContaining({
        label: 'Author defines book intent, genre/form expectations, themes, and voice.',
        role: 'brief_input',
      }),
    ])
    expect(body.detected?.context).toEqual(body.parsed?.context)
  })

  it('keeps durable all-terminal readiness when legacy structural import state is stale', async () => {
    await fs.mkdir(path.join(tmpDir, 'docs', 'harness'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'harness', 'architecture-notes.md'),
      [
        '# Architecture Notes',
        '',
        '## Core Loop',
        '1. Author defines book intent, genre/form expectations, themes, and voice.',
        '2. Author builds a house: premise, world, cast, outline, chapter goals, review standards.',
        '',
        '## System Records',
        '| Record | Purpose |',
        '| --- | --- |',
        '| Book brief | author voice, premise, genre, themes, constraints |',
      ].join('\n'),
      'utf8',
    )
    await writeSystemTasks({
      version: 1,
      lastUpdated: '2026-01-01T00:00:00.000Z',
      tasks: [
        {
          id: 'task-workspace-import',
          title: 'Review existing project work',
          description: 'Reserved importer',
          domain: '_workspace_import',
          projectPath: tmpDir,
          status: 'done',
          priority: 'normal',
          acceptanceCriteria: [],
          dependsOn: [],
          outOfScope: [],
          spec: [
            '```yaml',
            'tasks:',
            '  - id: imported-one',
            '    title: Define fixture schemas',
            '    description: Saved importer task.',
            '    domain: harness',
            '    priority: high',
            '```',
          ].join('\n'),
          notes: [],
          gateResults: [],
          reviewVerdicts: [],
          adjudications: [],
          escalations: [],
          agentIssues: [],
          origination: 'system',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    })
    await writeSystemJson('workspace-goals.json', {
      version: 2,
      recordedAt: '2026-01-01T00:00:00.000Z',
      goals: [],
      tasks: [
        {
          id: 'imported-one',
          title: 'Define fixture schemas',
          description: 'Saved importer task.',
          domain: 'harness',
          priority: 'high',
          references: ['docs/harness/implementation-roadmap.md'],
          scope: 'current',
        },
      ],
      milestones: [],
      context: [
        {
          label: 'Author defines book intent, genre/form expectations, themes, and voice.',
          excerpt: 'Legacy structural note with no explicit record shape.',
          source: 'planning-docs',
          references: ['docs/harness/architecture-notes.md'],
          role: 'brief_input',
        },
      ],
      approved: {
        goalCount: 0,
        taskCount: 1,
        milestoneCount: 0,
        currentTaskCount: 1,
        laterTaskCount: 0,
        taskIds: ['imported-one'],
      },
      detected: null,
    })

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(scopedDiagnostic('/api/project')))
    expect(res.status).toBe(200)
    const body = await res.json() as {
      startReadiness?: { canStart?: boolean; code?: string; message?: string; actionHref?: string }
      orientationSpine?: { summary?: { headline?: string; topBlocker?: string; nextAction?: string } }
    }
    expect(body.startReadiness).toMatchObject({
      canStart: false,
      code: 'all_terminal',
    })
    expect(body.startReadiness?.message).toBe('All tasks are already finished.')
    expect(body.orientationSpine?.summary).toMatchObject({
      headline: 'Current scope is in progress.',
      topBlocker: null,
      nextAction: 'Current work has no runnable work remaining.',
    })
  })

  it('does not let shelved imported tasks replace durable all-terminal readiness', async () => {
    await fs.mkdir(path.join(tmpDir, 'docs', 'harness'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'harness', 'implementation-roadmap.md'),
      [
        '# Implementation Roadmap',
        '',
        '## Stage 1: Fixture And Evaluation Harness',
        '',
        '## Current Next Milestone',
        '',
        'The next milestone is Stage 1: Fixture And Evaluation Harness.',
        '',
        '1. Define fixture, expected-record, prototype-run, and evaluation schemas.',
        '2. Add the first tiny fiction fixture and human-authored expected records.',
      ].join('\n'),
      'utf8',
    )
    await writeSystemText(
      'TASKS.json',
      JSON.stringify(
        {
          version: 1,
          lastUpdated: '2026-01-01T00:00:00.000Z',
          tasks: [
            {
              id: 'task-workspace-import',
              title: 'Review existing project work',
              description: 'Reserved importer',
              domain: '_workspace_import',
              projectPath: tmpDir,
              status: 'done',
              priority: 'normal',
              acceptanceCriteria: [],
              dependsOn: [],
              outOfScope: [],
              spec: [
                '```yaml',
                'tasks:',
                '  - id: imported-one',
                '    title: Define fixture, expected-record, prototype-run, and evaluation schemas.',
                '    description: Keep only the first detected task in the approved current slice.',
                '    domain: harness',
                '    priority: high',
                '```',
              ].join('\n'),
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
            {
              id: 'task-import-later',
              title: 'Add the first tiny fiction fixture and human-authored expected records.',
              description: 'Imported once, then incorrectly deferred.',
              domain: 'harness',
              projectPath: tmpDir,
              status: 'shelved',
              priority: 'normal',
              acceptanceCriteria: [],
              dependsOn: [],
              outOfScope: [],
              notes: [],
              gateResults: [],
              reviewVerdicts: [],
              adjudications: [],
              escalations: [],
              agentIssues: [],
              revisionCount: 0,
              remediationAttempts: 0,
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        },
        null,
        2,
      ),
    )

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(scopedDiagnostic('/api/project')))
    expect(res.status).toBe(200)
    const body = await res.json() as {
      startReadiness?: { canStart?: boolean; code?: string; message?: string; actionHref?: string }
    }
    expect(body.startReadiness).toMatchObject({
      canStart: false,
      code: 'all_terminal',
    })
    expect(body.startReadiness?.message).toBe('No actionable tasks remain: 0 done, 0 blocked, 1 shelved, 0 pending PR, 0 archived, 0 cancelled.')
  })

  it('does not treat current-stage success gates as missing deliverables ahead of real missing deliverables', async () => {
    await fs.mkdir(path.join(tmpDir, 'docs', 'harness'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'harness', 'implementation-roadmap.md'),
      [
        '# Implementation Roadmap',
        '',
        '## Stage 1: Fixture And Evaluation Harness',
        '',
        'Deliverables:',
        '- fixture directory shape for at least one small story fixture',
        '',
        'Success gates:',
        '- the harness can run without a frontend',
        '',
        '## Current Next Milestone',
        '',
        'The next milestone is Stage 1: Fixture And Evaluation Harness.',
        '',
        '1. Define fixture, expected-record, prototype-run, and evaluation schemas.',
      ].join('\n'),
      'utf8',
    )
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'success-gate-is-not-a-deliverable' }), 'utf8')
    await writeSystemText(
      'TASKS.json',
      JSON.stringify(
        {
          version: 1,
          lastUpdated: '2026-01-01T00:00:00.000Z',
          tasks: [
            {
              id: 'task-workspace-import',
              title: 'Review existing project work',
              description: 'Reserved importer',
              domain: '_workspace_import',
              projectPath: tmpDir,
              status: 'done',
              priority: 'normal',
              acceptanceCriteria: [],
              dependsOn: [],
              outOfScope: [],
              spec: [
                '```yaml',
                'tasks:',
                '  - id: imported-starter',
                '    title: Define fixture, expected-record, prototype-run, and evaluation schemas.',
                '    description: Current starter task already carried into the active slice.',
                '    domain: harness',
                '    priority: high',
                '```',
              ].join('\n'),
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
            {
              id: 'imported-starter',
              title: 'Define fixture, expected-record, prototype-run, and evaluation schemas.',
              description: 'Current starter task already tracked.',
              domain: 'harness',
              projectPath: tmpDir,
              status: 'ready',
              priority: 'high',
              acceptanceCriteria: [],
              dependsOn: [],
              outOfScope: [],
              notes: [],
              gateResults: [],
              reviewVerdicts: [],
              adjudications: [],
              escalations: [],
              agentIssues: [],
              revisionCount: 0,
              remediationAttempts: 0,
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        },
        null,
        2,
      ),
    )

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(scoped('/api/project')))
    expect(res.status).toBe(200)
    const body = await res.json() as {
      startReadiness?: { canStart?: boolean; code?: string; message?: string; actionHref?: string } | null
    }
    expect(body.startReadiness).toMatchObject({
      canStart: false,
      code: 'no_unattended_progress',
    })
    expect(body.startReadiness?.code).not.toBe('workspace_import_refresh_needed')
    expect(body.startReadiness?.message).not.toContain('the harness can run without a frontend')
  })

  it('does not require import refresh for proof-only success gates when current work is already represented', async () => {
    await fs.mkdir(path.join(tmpDir, 'docs', 'harness'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'harness', 'implementation-roadmap.md'),
      [
        '# Implementation Roadmap',
        '',
        '## Stage 1: Headless Drafting And Evaluation MVP',
        '',
        'Deliverables:',
        '- story-intelligence specs for character, scene, reader knowledge, world state, theme, revision orchestration, and author voice',
        '',
        'Success gates:',
        '- Docusaurus docs build cleanly with `npm run build`',
        '- roadmap identifies the next implementation stage clearly enough for Guildhall to draft starter tasks',
        '',
        '## Current Next Milestone',
        '',
        'The next milestone is Stage 1: Headless Drafting And Evaluation MVP.',
        '',
        '1. Build the headless story intelligence proof.',
      ].join('\n'),
      'utf8',
    )
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'proof-success-gate-import-coverage' }), 'utf8')
    await writeSystemText(
      'TASKS.json',
      JSON.stringify(
        {
          version: 1,
          lastUpdated: '2026-01-01T00:00:00.000Z',
          tasks: [
            {
              id: 'task-workspace-import',
              title: 'Review existing project work',
              description: 'Reserved importer',
              domain: '_workspace_import',
              projectPath: tmpDir,
              status: 'done',
              priority: 'normal',
              acceptanceCriteria: [],
              dependsOn: [],
              outOfScope: [],
              spec: [
                '```yaml',
                'tasks:',
                '  - id: imported-proof',
                '    title: Build the headless story intelligence proof.',
                '    description: Current starter task already carried into the active slice.',
                '    domain: harness',
                '    priority: high',
                '```',
              ].join('\n'),
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
            {
              id: 'imported-proof',
              title: 'Build the headless story intelligence proof.',
              description: 'Current starter task already tracked.',
              domain: 'harness',
              projectPath: tmpDir,
              status: 'ready',
              priority: 'high',
              acceptanceCriteria: [],
              dependsOn: [],
              outOfScope: [],
              notes: [],
              gateResults: [],
              reviewVerdicts: [],
              adjudications: [],
              escalations: [],
              agentIssues: [],
              revisionCount: 0,
              remediationAttempts: 0,
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        },
        null,
        2,
      ),
    )

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(scoped('/api/project')))
    expect(res.status).toBe(200)
    const body = await res.json() as {
      startReadiness?: { canStart?: boolean; code?: string; message?: string; actionHref?: string } | null
    }
    expect(body.startReadiness?.code).not.toBe('workspace_import_refresh_needed')
    expect(body.startReadiness?.message ?? '').not.toContain('Docusaurus docs build cleanly')
  })

  it('keeps the durable task blocker when saved current work is stale relative to live docs', async () => {
    await fs.mkdir(path.join(tmpDir, 'docs', 'harness'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'harness', 'implementation-roadmap.md'),
      [
        '# Implementation Roadmap',
        '',
        '## Stage 1: Fixture And Evaluation Harness',
        '',
        '## Current Next Milestone',
        '',
        'The next milestone is Stage 1: Fixture And Evaluation Harness.',
        '',
        '1. Define fixture, expected-record, prototype-run, and evaluation schemas.',
      ].join('\n'),
      'utf8',
    )
    await writeSystemText(
      'TASKS.json',
      JSON.stringify(
        {
          version: 1,
          lastUpdated: '2026-01-01T00:00:00.000Z',
          tasks: [
            {
              id: 'task-workspace-import',
              title: 'Review existing project work',
              description: 'Reserved importer',
              domain: '_workspace_import',
              projectPath: tmpDir,
              status: 'done',
              priority: 'normal',
              acceptanceCriteria: [],
              dependsOn: [],
              outOfScope: [],
              spec: [
                '```yaml',
                'tasks:',
                '  - id: imported-current',
                '    title: Define fixture, expected-record, prototype-run, and evaluation schemas.',
                '    description: The true current scope.',
                '    domain: harness',
                '    priority: high',
                '  - id: imported-stale-current',
                '    title: Implement fixture-and-expected-record schemas (from schema-contract-roadmap)',
                '    description: A stale current task that no longer belongs to the active slice.',
                '    domain: harness',
                '    priority: high',
                '```',
              ].join('\n'),
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
            {
              id: 'imported-current',
              title: 'Define fixture, expected-record, prototype-run, and evaluation schemas.',
              description: 'Still valid.',
              domain: 'harness',
              projectPath: tmpDir,
              status: 'ready',
              priority: 'high',
              acceptanceCriteria: [],
              dependsOn: [],
              outOfScope: [],
              notes: [],
              gateResults: [],
              reviewVerdicts: [],
              adjudications: [],
              escalations: [],
              agentIssues: [],
              revisionCount: 0,
              remediationAttempts: 0,
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
            {
              id: 'imported-stale-current',
              title: 'Implement fixture-and-expected-record schemas (from schema-contract-roadmap)',
              description: 'Stale current work that should have been removed from the active slice.',
              domain: 'harness',
              projectPath: tmpDir,
              status: 'ready',
              priority: 'high',
              acceptanceCriteria: [],
              dependsOn: [],
              outOfScope: [],
              notes: [],
              gateResults: [],
              reviewVerdicts: [],
              adjudications: [],
              escalations: [],
              agentIssues: [],
              revisionCount: 0,
              remediationAttempts: 0,
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        },
        null,
        2,
      ),
    )

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(scopedDiagnostic('/api/project')))
    expect(res.status).toBe(200)
    const body = await res.json() as {
      startReadiness?: { canStart?: boolean; code?: string; message?: string; actionHref?: string }
    }
    expect(body.startReadiness).toMatchObject({
      canStart: false,
      code: 'no_unattended_progress',
      actionHref: '/work?task=imported-current',
      focusTaskId: 'imported-current',
    })
    expect(body.startReadiness?.message).toContain('Define fixture, expected-record, prototype-run, and evaluation schemas.')
    expect(body.startReadiness?.message).not.toContain('live docs no longer do')
  })

  it('does not treat a repaired materialized import title as stale just because saved importer YAML is cropped', async () => {
    await fs.mkdir(path.join(tmpDir, 'docs', 'harness'), { recursive: true })
    const fullTitle = 'Continue the fixture harness from the shaped current release into deterministic evaluator proof.'
    const croppedTitle = 'Continue the fixture harness from the shaped current release into deterministic'
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'harness', 'implementation-roadmap.md'),
      [
        '# Implementation Roadmap',
        '',
        '## Stage 1: Fixture And Evaluation Harness',
        '',
        '## Current Next Milestone',
        '',
        'The next milestone is Stage 1: Fixture And Evaluation Harness.',
        '',
        `1. ${fullTitle}`,
      ].join('\n'),
      'utf8',
    )
    await writeSystemText(
      'TASKS.json',
      JSON.stringify(
        {
          version: 1,
          lastUpdated: '2026-01-01T00:00:00.000Z',
          tasks: [
            {
              id: 'task-workspace-import',
              title: 'Review existing project work',
              description: 'Reserved importer',
              domain: '_workspace_import',
              projectPath: tmpDir,
              status: 'done',
              priority: 'normal',
              acceptanceCriteria: [],
              dependsOn: [],
              outOfScope: [],
              spec: [
                '```yaml',
                'tasks:',
                '  - id: imported-current',
                `    title: ${croppedTitle}`,
                '    description: The true current scope.',
                '    domain: harness',
                '    priority: high',
                '```',
              ].join('\n'),
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
            {
              id: 'imported-current',
              title: fullTitle,
              description: 'Still valid after title repair.',
              domain: 'harness',
              projectPath: tmpDir,
              status: 'ready',
              priority: 'high',
              spec: '## Summary\nBuild the evaluator proof.\n',
              productBrief: {
                userJob: 'Prove the evaluator harness.',
                whyItMattersNow: 'This is current release work.',
                successMetric: 'Proof command passes.',
              },
              acceptanceCriteria: [{
                id: 'ac-1',
                description: 'Proof command passes.',
                verifiedBy: 'test',
                met: false,
              }],
              dependsOn: [],
              outOfScope: [],
              notes: [{
                agentId: 'workspace-importer',
                role: 'importer',
                content: 'Imported from implementation-roadmap.md.',
                timestamp: '2026-01-01T00:00:00.000Z',
              }],
              gateResults: [],
              reviewVerdicts: [],
              adjudications: [],
              escalations: [],
              agentIssues: [],
              revisionCount: 0,
              remediationAttempts: 0,
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        },
        null,
        2,
      ),
    )

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(scoped('/api/project')))
    expect(res.status).toBe(200)
    const body = await res.json() as {
      startReadiness?: { canStart?: boolean; code?: string; message?: string; actionHref?: string }
    }
    expect(body.startReadiness?.code).not.toBe('workspace_import_refresh_needed')
    expect(body.startReadiness?.message).not.toContain('live docs no longer do')
    expect(body.startReadiness?.message).toContain(fullTitle)
    expect(body.startReadiness?.message).not.toBe(`"${croppedTitle}" is ready to run.`)
  })

  it('keeps durable all-terminal readiness when importer tasks only survive as context in live docs', async () => {
    await fs.mkdir(path.join(tmpDir, 'docs', 'harness'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'harness', 'implementation-roadmap.md'),
      [
        '# Implementation Roadmap',
        '',
        '## Stage 1: Fixture And Evaluation Harness',
        '',
        '## Current Next Milestone',
        '',
        'The next milestone is Stage 1: Fixture And Evaluation Harness.',
        '',
        '1. Define fixture, expected-record, prototype-run, and evaluation schemas.',
      ].join('\n'),
      'utf8',
    )
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'harness', 'architecture-notes.md'),
      [
        '# Architecture Notes',
        '',
        '## Core Loop',
        '',
        '1. Author defines book intent, genre/form expectations, themes, and voice.',
        '2. Author builds a house: premise, world, cast, outline, chapter goals, review standards.',
        '3. Author drafts or imports chapters.',
      ].join('\n'),
      'utf8',
    )
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'context-ghost-gap' }), 'utf8')
    await writeSystemText(
      'TASKS.json',
      JSON.stringify(
        {
          version: 1,
          lastUpdated: '2026-01-01T00:00:00.000Z',
          tasks: [
            {
              id: 'task-workspace-import',
              title: 'Review existing project work',
              description: 'Reserved importer',
              domain: '_workspace_import',
              projectPath: tmpDir,
              status: 'done',
              priority: 'normal',
              acceptanceCriteria: [],
              dependsOn: [],
              outOfScope: [],
              spec: [
                '```yaml',
                'tasks:',
                '  - id: imported-one',
                '    title: Define fixture, expected-record, prototype-run, and evaluation schemas.',
                '    description: Saved importer task.',
                '    domain: harness',
                '    priority: high',
                '    references:',
                '      - docs/harness/implementation-roadmap.md',
                '```',
              ].join('\n'),
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
            {
              id: 'task-capability-ghost',
              title: 'Author defines book intent, genre/form expectations, themes, and voice.',
              description: 'Old bad import turned architecture prose into runnable work.',
              domain: 'harness',
              projectPath: tmpDir,
              status: 'shelved',
              priority: 'normal',
              acceptanceCriteria: [],
              dependsOn: [],
              outOfScope: [],
              requestIntake: {
                intent: 'spec_only',
                recommendedNextAction: 'draft_spec',
                componentStack: [],
                assumptions: [],
                missingInformation: [],
                evidenceRefs: ['import:docs/harness/architecture-notes.md'],
                pressureTestSummary: {
                  systemOwned: true,
                  degree: 'guided',
                  qualityBar: 'Capability-map prose should not survive as runnable backlog work.',
                  ownerQuestionPolicy: 'Do not keep architecture prose alive as deferred task work.',
                  checks: [],
                },
                clarifyingQuestions: [],
                createdAt: '2026-01-01T00:00:00.000Z',
                createdBy: 'workspace-importer',
              },
              references: [path.join(tmpDir, 'docs', 'harness', 'architecture-notes.md')],
              notes: [],
              gateResults: [],
              reviewVerdicts: [],
              adjudications: [],
              escalations: [],
              agentIssues: [],
              revisionCount: 0,
              remediationAttempts: 0,
              origination: 'human',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        },
        null,
        2,
      ),
    )

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(scopedDiagnostic('/api/project')))
    expect(res.status).toBe(200)
    const body = await res.json() as {
      startReadiness?: { canStart?: boolean; code?: string; message?: string; actionHref?: string }
    }
    expect(body.startReadiness).toMatchObject({
      canStart: false,
      code: 'all_terminal',
    })
    expect(body.startReadiness?.message).toBe('No actionable tasks remain: 0 done, 0 blocked, 1 shelved, 0 pending PR, 0 archived, 0 cancelled.')
  })

  it('keeps durable draft shaping ahead of any live-doc refresh scan', async () => {
    await fs.mkdir(path.join(tmpDir, 'docs', 'harness'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'harness', 'implementation-roadmap.md'),
      [
        '# Implementation Roadmap',
        '',
        '## Stage 1: Fixture And Evaluation Harness',
        '',
        '## Current Next Milestone',
        '',
        'The next milestone is Stage 1: Fixture And Evaluation Harness.',
        '',
        '1. Define fixture, expected-record, prototype-run, and evaluation schemas.',
        '2. Add the first tiny fiction fixture and human-authored expected records.',
      ].join('\n'),
      'utf8',
    )
    await writeSystemText(
      'TASKS.json',
      JSON.stringify(
        {
          version: 1,
          lastUpdated: '2026-01-01T00:00:00.000Z',
          tasks: [
            {
              id: 'task-workspace-import',
              title: 'Review existing project work',
              description: 'Reserved importer',
              domain: '_workspace_import',
              projectPath: tmpDir,
              status: 'done',
              priority: 'normal',
              acceptanceCriteria: [],
              dependsOn: [],
              outOfScope: [],
              spec: [
                '```yaml',
                'tasks:',
                '  - id: imported-one',
                '    title: Define fixture, expected-record, prototype-run, and evaluation schemas.',
                '    description: Keep only the first detected task in the approved current slice.',
                '    domain: harness',
                '    priority: high',
                '```',
              ].join('\n'),
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
            {
              id: 'task-import-current',
              title: 'Define fixture, expected-record, prototype-run, and evaluation schemas.',
              description: 'Imported current work still waiting for a real brief.',
              domain: 'harness',
              projectPath: tmpDir,
              status: 'import_draft',
              priority: 'high',
              acceptanceCriteria: [],
              dependsOn: [],
              outOfScope: [],
              notes: [],
              gateResults: [],
              reviewVerdicts: [],
              adjudications: [],
              escalations: [],
              agentIssues: [],
              revisionCount: 0,
              remediationAttempts: 0,
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
            {
              id: 'task-import-later',
              title: 'Add the first tiny fiction fixture and human-authored expected records.',
              description: 'Detected current work that was wrongly deferred.',
              domain: 'harness',
              projectPath: tmpDir,
              status: 'shelved',
              priority: 'normal',
              acceptanceCriteria: [],
              dependsOn: [],
              outOfScope: [],
              notes: [],
              gateResults: [],
              reviewVerdicts: [],
              adjudications: [],
              escalations: [],
              agentIssues: [],
              revisionCount: 0,
              remediationAttempts: 0,
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        },
        null,
        2,
      ),
    )

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(scopedDiagnostic('/api/project')))
    expect(res.status).toBe(200)
    const body = await res.json() as {
      startReadiness?: { canStart?: boolean; code?: string; message?: string; actionHref?: string }
    }
    expect(body.startReadiness).toMatchObject({
      canStart: false,
      code: 'imported_scope_shaping',
      actionHref: '/task/task-import-current',
    })
    expect(body.startReadiness?.message).toContain('source-backed shaping')
    expect(body.startReadiness?.message).not.toContain('outside the approved current scope')
  })

  it('status does not parse a completed importer task spec as current saved import state', async () => {
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'completed-import-status' }), 'utf8')
    await writeSystemText(
      'TASKS.json',
      JSON.stringify(
        {
          version: 1,
          lastUpdated: '2026-01-01T00:00:00.000Z',
          tasks: [
            {
              id: 'task-workspace-import',
              title: 'Review existing project work',
              description: 'Reserved importer',
              domain: '_workspace_import',
              projectPath: tmpDir,
              status: 'done',
              priority: 'normal',
              acceptanceCriteria: [],
              dependsOn: [],
              outOfScope: [],
              spec: [
                '```yaml',
                'goals:',
                '  - id: imported-direction',
                '    title: Keep the imported direction',
                '    rationale: The completed import captured the owner direction.',
                '```',
                '```yaml',
                'tasks:',
                '  - id: imported-first-task',
                '    title: Build the first imported task',
                '    description: Preserve completed import work in status summaries.',
                '    domain: app',
                '    priority: high',
                '```',
                '```yaml',
                'milestones:',
                '  - title: Imported work reviewed',
                '    evidence: README.md',
                '```',
              ].join('\n'),
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        },
        null,
        2,
      ),
    )

    const { app } = buildServeApp({ projectPath: tmpDir })
    const status = await app.fetch(new Request(scoped('/api/project/workspace-import/status')))
    expect(status.status).toBe(200)
    const body = await status.json() as Record<string, any>
    expect(body).toMatchObject({
      seeded: true,
      taskStatus: 'done',
      specPresent: false,
      draft: {
        goals: 0,
        tasks: 0,
        milestones: 0,
      },
    })
  })

  it('stores learned import focus in the saved projection', async () => {
    await fs.mkdir(path.join(tmpDir, 'looma', 'docs'), { recursive: true })
    await fs.mkdir(path.join(tmpDir, 'knit', 'docs'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'looma', 'docs', 'component-roadmap.md'),
      '- [ ] Listbox\n- [ ] Combobox\n',
      'utf8',
    )
    await fs.writeFile(
      path.join(tmpDir, 'knit', 'docs', 'feature-roadmap.md'),
      '- [ ] Auth callback redirect\n- [ ] Collections parity\n',
      'utf8',
    )
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'ws-learn' }), 'utf8')

    const { app } = buildServeApp({ projectPath: tmpDir })
    const review = await readLiveWorkspaceImportReview()
    const loomaSource = review.sourceGroups.find(group => group.areaKey === 'looma')
    expect(loomaSource).toBeDefined()

    const approve = await app.fetch(
      new Request(scoped('/api/project/workspace-import/approve'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          areaKeys: ['looma'],
          sourceKeys: [loomaSource!.key],
          taskIds: [loomaSource!.taskIds[0]],
        }),
      }),
    )
    expect(approve.status).toBe(200)

    const after = await app.fetch(new Request(scoped('/api/project/workspace-import/draft')))
    const afterBody = (await after.json()) as {
      detected: {
        review: {
          areaGroups: Array<{ key: string }>
          sourceGroups: Array<{ key: string }>
        }
        learning: {
          defaults: {
            selectedAreaKeys: string[]
            selectedSourceKeys: string[]
            selectedTaskIds: string[]
            note: string | null
          }
        }
      }
    }
    expect(afterBody.detected.learning.defaults.selectedAreaKeys).toEqual(
      afterBody.detected.review.areaGroups.map(area => area.key),
    )
    expect(afterBody.detected.learning.defaults.selectedSourceKeys).toEqual(
      afterBody.detected.review.sourceGroups.map(group => group.key),
    )
    expect(afterBody.detected.learning.defaults.selectedTaskIds).toEqual([loomaSource!.taskIds[0]])
    expect(afterBody.detected.learning.defaults.note).toContain('remembers')
  })

  it('keeps approved import scope distinct from detected project breadth after a narrowed approval', async () => {
    await fs.mkdir(path.join(tmpDir, 'looma', 'docs'), { recursive: true })
    await fs.mkdir(path.join(tmpDir, 'knit', 'docs'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'looma', 'docs', 'component-roadmap.md'),
      '- [ ] Listbox\n- [ ] Combobox\n',
      'utf8',
    )
    await fs.writeFile(
      path.join(tmpDir, 'knit', 'docs', 'feature-roadmap.md'),
      '- [ ] Auth callback redirect\n- [ ] Collections parity\n',
      'utf8',
    )
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'ws-scope-truth' }), 'utf8')

    const { app } = buildServeApp({ projectPath: tmpDir })
    const review = await readLiveWorkspaceImportReview()
    const loomaSource = review.sourceGroups.find(group => group.areaKey === 'looma')
    expect(loomaSource).toBeDefined()

    const approve = await app.fetch(
      new Request(scoped('/api/project/workspace-import/approve'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          areaKeys: ['looma'],
          sourceKeys: [loomaSource!.key],
          taskIds: [loomaSource!.taskIds[0]],
        }),
      }),
    )
    expect(approve.status).toBe(200)

    const status = await app.fetch(new Request(scoped('/api/project/workspace-import/status')))
    expect(status.status).toBe(200)
    const statusBody = (await status.json()) as {
      approved: { taskCount: number; currentTaskCount: number }
      detected: { taskCount: number; currentTaskCount: number }
      draft: { tasks: number }
    }
    expect(statusBody.approved.taskCount).toBe(1)
    expect(statusBody.approved.currentTaskCount).toBe(1)
    expect(statusBody.detected.taskCount).toBeGreaterThan(statusBody.approved.taskCount)
    expect(statusBody.detected.currentTaskCount).toBeGreaterThan(statusBody.approved.currentTaskCount)
    expect(statusBody.draft.tasks).toBe(1)

    const facts = await app.fetch(new Request(scoped('/api/project/facts')))
    expect(facts.status).toBe(200)
    const factsBody = (await facts.json()) as {
      workspace: {
        goals: {
          approved: { taskCount: number }
          detected: { taskCount: number } | null
        }
      }
    }
    expect(factsBody.workspace.goals.approved.taskCount).toBe(1)
    expect((factsBody.workspace.goals.detected?.taskCount ?? 0)).toBeGreaterThan(1)
  })

  it('uses the saved approved import summary instead of reconstructing it from importer YAML', async () => {
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'ws-scope-shrink' }), 'utf8')
    await writeSystemJson('workspace-goals.json', {
      version: 2,
      recordedAt: '2026-01-01T00:00:00.000Z',
      goals: [],
      tasks: [
        { id: 'imported-a', title: 'First task', description: 'First task', domain: 'core', priority: 'high', references: [] },
        { id: 'imported-b', title: 'Second stale task', description: 'Second stale task', domain: 'core', priority: 'high', references: [] },
      ],
      milestones: [],
      approved: {
        goalCount: 0,
        taskCount: 2,
        milestoneCount: 0,
        currentTaskCount: 2,
        laterTaskCount: 0,
        taskIds: ['imported-a', 'imported-b'],
      },
      detected: {
        goalCount: 0,
        taskCount: 2,
        milestoneCount: 0,
        currentTaskCount: 2,
        laterTaskCount: 0,
        taskIds: ['imported-a', 'imported-b'],
      },
    })
    await writeSystemText(
      'TASKS.json',
      JSON.stringify(
        {
          version: 1,
          lastUpdated: '2026-01-01T00:00:00.000Z',
          tasks: [
            {
              id: 'task-workspace-import',
              title: 'Review existing project work',
              description: 'Reserved importer',
              domain: '_workspace_import',
              projectPath: tmpDir,
              status: 'done',
              priority: 'normal',
              acceptanceCriteria: [],
              dependsOn: [],
              outOfScope: [],
              spec: [
                '```yaml',
                'tasks:',
                '  - id: imported-a',
                '    title: First task',
                '    description: First task',
                '    domain: core',
                '    priority: high',
                '```',
              ].join('\n'),
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        },
        null,
        2,
      ),
    )

    const { app } = buildServeApp({ projectPath: tmpDir })
    const facts = await app.fetch(new Request(scoped('/api/project/facts')))
    expect(facts.status).toBe(200)
    const factsBody = (await facts.json()) as {
      workspace: {
        goals: {
          approved: { taskCount: number; currentTaskCount: number; laterTaskCount: number }
          detected: { taskCount: number; currentTaskCount: number; laterTaskCount: number } | null
        }
      }
    }
    expect(factsBody.workspace.goals.approved).toMatchObject({
      taskCount: 2,
      currentTaskCount: 2,
      laterTaskCount: 0,
    })
    expect(factsBody.workspace.goals.detected).toMatchObject({
      taskCount: 2,
      currentTaskCount: 2,
      laterTaskCount: 0,
    })

    const status = await app.fetch(new Request(scoped('/api/project/workspace-import/status')))
    expect(status.status).toBe(200)
    const statusBody = (await status.json()) as {
      approved: { taskCount: number; currentTaskCount: number; laterTaskCount: number } | null
      detected: { taskCount: number; currentTaskCount: number; laterTaskCount: number } | null
      draft: { tasks: number }
    }
    expect(statusBody.approved).toMatchObject({
      taskCount: 2,
      currentTaskCount: 2,
      laterTaskCount: 0,
    })
    expect(statusBody.detected).toMatchObject({
      taskCount: 2,
      currentTaskCount: 2,
      laterTaskCount: 0,
    })
    expect(statusBody.draft.tasks).toBe(2)
  })

  it('rerun reseeds the reserved import task even when the project already has tasks', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'README.md'),
      '# Knit\n\n## Goals\n\n- Ship Looma primitives cleanly\n',
      'utf8',
    )
    await fs.mkdir(path.join(tmpDir, 'docs'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'feature-roadmap.md'),
      '## Next up\n\n- [ ] Turn planning docs into real intake tasks\n',
      'utf8',
    )
    await writeSystemJson(
      'workspace-goals.json',
      { dismissed: true, dismissedAt: '2026-01-01T00:00:00Z' },
    )
    await writeSystemText(
      'TASKS.json',
      JSON.stringify(
        {
          version: 1,
          lastUpdated: '2026-01-01T00:00:00Z',
          tasks: [
            {
              id: 'task-001',
              title: 'Existing user task',
              description: 'Existing imported work.',
              status: 'done',
              domain: 'core',
              priority: 'normal',
              projectPath: tmpDir,
              acceptanceCriteria: [],
              outOfScope: [],
              dependsOn: [],
              notes: [],
              gateResults: [],
              reviewVerdicts: [],
              adjudications: [],
              escalations: [],
              agentIssues: [],
              revisionCount: 0,
              remediationAttempts: 0,
              origination: 'human',
              createdAt: '2026-01-01T00:00:00Z',
              updatedAt: '2026-01-01T00:00:00Z',
            },
          ],
        },
        null,
        2,
      ),
    )

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(scoped('/api/project/workspace-import/rerun'), { method: 'POST' }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      ok?: boolean
      draft?: { tasks?: number; goals?: number }
    }
    expect(body.ok).toBe(true)
    expect((body.draft?.tasks ?? 0) + (body.draft?.goals ?? 0)).toBeGreaterThan(0)

    const tasks = await readTasks(tmpDir)
    const importTask = tasks.find((task) => task.id === 'task-workspace-import')
    expect(importTask?.status).toBe('exploring')

    const goalsState = JSON.parse(
      await fs.readFile(getProjectSystemStatePath(tmpDir, 'workspace-goals.json'), 'utf8'),
    ) as { dismissed?: boolean }
    expect(goalsState.dismissed).toBeUndefined()
  })
})

describe('GET/POST /api/project/learning', () => {
  it('returns learned import behavior and supports reset', async () => {
    await fs.mkdir(path.join(tmpDir, 'looma', 'docs'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'looma', 'docs', 'component-roadmap.md'),
      '- [ ] Listbox\n- [ ] Combobox\n',
      'utf8',
    )
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'learning-api' }), 'utf8')

    const { app } = buildServeApp({ projectPath: tmpDir })
    const review = await readLiveWorkspaceImportReview()
    const source = review.sourceGroups[0]
    expect(source).toBeDefined()
    const approve = await app.fetch(
      new Request(scoped('/api/project/workspace-import/approve'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          areaKeys: ['looma'],
          sourceKeys: [source!.key],
          taskIds: [source!.taskIds[0]],
        }),
      }),
    )
    const approveBody = await approve.json()
    if (approve.status !== 200) {
      throw new Error(`approve failed: status=${approve.status} body=${JSON.stringify(approveBody)}`)
    }
    promoteProjectStateDatabaseAuthority(tmpDir)
    await applyCanonicalMigrations()
    const briefPath = getProjectSystemStatePath(tmpDir, 'project-brief.md')
    await fs.mkdir(path.dirname(briefPath), { recursive: true })
    await fs.writeFile(briefPath, 'This project has saved context.\n', 'utf8')

    const learning = await app.fetch(new Request(scoped('/api/project/learning')))
    const learningBody = (await learning.json()) as {
      effective: { defaults: { selectedAreaKeys: string[] } } | null
      project: { workspaceImport: { approvedRuns: number } } | null
      projectContext: {
        projectBrief: { present: boolean; nonEmptyLines: number }
      } | null
    }
    expect(learningBody.project?.workspaceImport.approvedRuns).toBe(1)
    expect(learningBody.effective?.defaults.selectedAreaKeys).toEqual(['looma'])
    expect(learningBody.projectContext?.projectBrief).toMatchObject({ present: true, nonEmptyLines: 1 })

    const reset = await app.fetch(
      new Request(scoped('/api/project/learning/reset'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scope: 'project' }),
      }),
    )
    expect(reset.status).toBe(200)

    const afterReset = await app.fetch(new Request(scoped('/api/project/learning')))
    const afterResetBody = (await afterReset.json()) as {
      project: { workspaceImport: { approvedRuns: number } } | null
    }
    expect(afterResetBody.project?.workspaceImport.approvedRuns).toBe(0)
  })

  it('lists learning records and supports accept, dismiss, reset, and make-project-wide', async () => {
    const memoryDir = getProjectSystemStatePath(tmpDir, '')
    const projectCandidate: LearningCandidate = {
      id: 'project-invite-path',
      source: 'task',
      summary: 'Invite work usually touches web/server/api/workspaces routes.',
      evidence: [{ kind: 'task', summary: 'Recovered invite task.', ref: 'task-invite' }],
      proposedScope: 'project',
      proposedDestination: 'project_memory',
      confidence: 'medium',
      risk: 'low',
      requiresApproval: true,
    }
    const userCandidate: LearningCandidate = {
      id: 'global-doc-style',
      source: 'user_correction',
      summary: 'Prefer shorter public docs with less implementation trivia.',
      evidence: [{ kind: 'task', summary: 'User corrected docs tone.', ref: 'task-docs' }],
      proposedScope: 'user_global',
      proposedDestination: 'user_preference',
      confidence: 'medium',
      risk: 'low',
      requiresApproval: true,
    }
    const productCandidate: LearningCandidate = {
      id: 'product-recovery-visibility',
      source: 'blocker',
      summary: 'Make failed recovery playbooks more visible to builders.',
      evidence: [{ kind: 'task', summary: 'Playbook failed.', ref: 'task-blocked' }],
      proposedScope: 'guildhall_product',
      proposedDestination: 'product_suggestion',
      confidence: 'medium',
      risk: 'low',
      requiresApproval: true,
    }
    await persistLearningCandidates({
      memoryDir,
      candidates: [projectCandidate, userCandidate, productCandidate],
    })
    await proposeProjectSkill({
      memoryDir,
      proposal: {
        id: 'invite-route-skill',
        name: 'invite-route-skill',
        description: 'Repair invite routes',
        routingKeys: ['domain:looma'],
        content: 'Use existing workspace route helpers before adding utilities.',
        risk: 'medium',
        requiresApproval: true,
      },
    })

    const { app } = buildServeApp({ projectPath: tmpDir })
    const before = await app.fetch(new Request(scoped('/api/project/learning')))
    expect(before.status).toBe(200)
    const beforeBody = (await before.json()) as {
      project: { suggestedLearnings: Array<{ id: string; status: string }> } | null
      user: { suggestedLearnings: Array<{ id: string; status: string }> } | null
      effective: { productSuggestions: Array<{ id: string }> } | null
      projectSkillProposals: Array<{ id: string; status: string }>
    }
    expect(beforeBody.project?.suggestedLearnings.map(item => item.id)).toContain('project-invite-path')
    expect(beforeBody.user?.suggestedLearnings.map(item => item.id)).toContain('global-doc-style')
    expect(beforeBody.effective?.productSuggestions.map(item => item.id)).toContain('product-recovery-visibility')
    expect(beforeBody.projectSkillProposals[0]).toMatchObject({
      id: 'invite-route-skill',
      status: 'suggested',
    })

    const accept = await app.fetch(
      new Request(scoped('/api/project/learning/action'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'accept', scope: 'project', id: 'project-invite-path' }),
      }),
    )
    expect(accept.status).toBe(200)

    const makeProjectWide = await app.fetch(
      new Request(scoped('/api/project/learning/action'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'make-project-wide', id: 'global-doc-style' }),
      }),
    )
    expect(makeProjectWide.status).toBe(200)

    const dismiss = await app.fetch(
      new Request(scoped('/api/project/learning/action'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'dismiss', scope: 'user_global', id: 'global-doc-style' }),
      }),
    )
    expect(dismiss.status).toBe(200)

    const activateSkill = await app.fetch(
      new Request(scoped('/api/project/skill-proposals/action'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'activate', id: 'invite-route-skill', approved: true }),
      }),
    )
    expect(activateSkill.status).toBe(200)

    const after = await app.fetch(new Request(scoped('/api/project/learning')))
    const afterBody = (await after.json()) as {
      project: { suggestedLearnings: Array<{ id: string; status: string; scope: string }> } | null
      user: { suggestedLearnings: Array<{ id: string; status: string }> } | null
      projectSkillProposals: Array<{ id: string; status: string }>
    }
    expect(afterBody.project?.suggestedLearnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'project-invite-path', status: 'active' }),
        expect.objectContaining({ id: 'project-global-doc-style', status: 'active', scope: 'project' }),
      ]),
    )
    expect(afterBody.user?.suggestedLearnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'global-doc-style', status: 'dismissed' }),
      ]),
    )
    expect(afterBody.projectSkillProposals[0]).toMatchObject({
      id: 'invite-route-skill',
      status: 'active',
    })

    const reset = await app.fetch(
      new Request(scoped('/api/project/learning/action'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'reset', scope: 'project' }),
      }),
    )
    expect(reset.status).toBe(200)

    const skillReset = await app.fetch(
      new Request(scoped('/api/project/skill-proposals/action'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'reset' }),
      }),
    )
    expect(skillReset.status).toBe(200)

    const final = await app.fetch(new Request(scoped('/api/project/learning')))
    const finalBody = (await final.json()) as {
      project: { suggestedLearnings: unknown[] } | null
      projectSkillProposals: unknown[]
    }
    expect(finalBody.project?.suggestedLearnings).toEqual([])
    expect(finalBody.projectSkillProposals).toEqual([])
  })
})

describe('POST /api/project/meta-intake/rerun', () => {
  it('resets the reserved task back to exploring and reseeds the transcript', async () => {
    await writeSystemText(
      'TASKS.json',
      JSON.stringify(
        {
          version: 1,
          lastUpdated: '2026-01-01T00:00:00Z',
          tasks: [
            {
              id: 'task-meta-intake',
              title: 'Inspect the repo and draft starter tasks',
              description: 'Inspect the codebase, infer the project structure, and draft the first starter tasks. Ask only if confidence is low and being wrong would matter.',
              status: 'done',
              domain: '_meta',
              priority: 'critical',
              projectPath: tmpDir,
              spec: 'old draft',
              notes: [
                {
                  agentId: 'worker-agent',
                  role: 'worker-agent',
                  content: 'stale',
                  timestamp: '2026-01-01T00:30:00Z',
                },
              ],
              acceptanceCriteria: [],
              outOfScope: [],
              dependsOn: [],
              gateResults: [],
              reviewVerdicts: [],
              adjudications: [],
              escalations: [],
              agentIssues: [],
              revisionCount: 0,
              remediationAttempts: 0,
              origination: 'system',
              createdAt: '2026-01-01T00:00:00Z',
              updatedAt: '2026-01-01T00:00:00Z',
              completedAt: '2026-01-01T01:00:00Z',
            },
          ],
        },
        null,
        2,
      ),
    )
    const transcriptPath = getProjectTranscriptPath(tmpDir, 'exploring', 'task-meta-intake')
    await fs.mkdir(path.dirname(transcriptPath), { recursive: true })
    await fs.writeFile(transcriptPath, 'stale transcript\n', 'utf8')

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(scoped('/api/project/meta-intake/rerun'), { method: 'POST' }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok?: boolean; taskId?: string }
    expect(body.ok).toBe(true)
    expect(body.taskId).toBe('task-meta-intake')

    const tasks = await readTasks(tmpDir)
    const metaTask = tasks.find((task) => task.id === 'task-meta-intake')
    expect(metaTask?.status).toBe('exploring')
    expect(metaTask?.spec).toBeUndefined()
    expect(metaTask?.completedAt).toBeUndefined()

    const transcript = await fs.readFile(transcriptPath, 'utf8')
    expect(transcript).toMatch(/You are bootstrapping a new Guildhall workspace/i)
    expect(transcript).not.toMatch(/stale transcript/)
  })
})

// The inbox endpoint exposes `blockers` so the UI can disable Start/+ New
// Task while bootstrap is incomplete without re-deriving the rules.
describe('GET /api/project/inbox — blockers', () => {
  it('reports bootstrap: true when bootstrap is incomplete, false once verified', async () => {
    await writeSystemTasks({ version: 1, lastUpdated: new Date().toISOString(), tasks: [] })
    const { app, refreshProjectProjections } = buildServeApp({ projectPath: tmpDir })
    await refreshProjectProjections(tmpDir)

    // bootstrapWorkspace leaves guildhall.yaml without a structural bootstrap
    // verifiedAt, so bootstrap_missing is expected.
    const before = await app.fetch(new Request(scoped('/api/project/inbox')))
    expect(before.status).toBe(200)
    const beforeBody = (await before.json()) as {
      items: Array<{ kind: string }>
      blockers: { bootstrap: boolean; workspaceImport: boolean }
    }
    expect(beforeBody.blockers.bootstrap).toBe(true)

    // Overwrite guildhall.yaml with a complete structural bootstrap block.
    const yamlPath = path.join(tmpDir, 'guildhall.yaml')
    const current = await fs.readFile(yamlPath, 'utf8')
    await fs.writeFile(
      yamlPath,
      current +
        '\nbootstrap:\n  verifiedAt: "2026-04-24T00:00:00Z"\n  packageManager: pnpm\n  install: { command: "pnpm install", status: ok }\n  gates:\n    lint: { command: "pnpm lint", available: true }\n    typecheck: { command: "pnpm tsc --noEmit", available: true }\n    build: { command: "pnpm build", available: true }\n    test: { command: "pnpm test", available: true }\n',
      'utf8',
    )
    await refreshProjectProjections(tmpDir)

    const after = await app.fetch(new Request(scoped('/api/project/inbox')))
    const afterBody = (await after.json()) as {
      blockers: { bootstrap: boolean; workspaceImport: boolean }
    }
    expect(afterBody.blockers.bootstrap).toBe(false)
  })

  it('keeps attention history and marks satisfied items resolved', async () => {
    await writeSystemTasks({ version: 1, lastUpdated: new Date().toISOString(), tasks: [] })
    const { app, refreshProjectProjections } = buildServeApp({ projectPath: tmpDir })
    await refreshProjectProjections(tmpDir)

    const before = await app.fetch(new Request(scoped('/api/project/inbox')))
    expect(before.status).toBe(200)
    const beforeBody = (await before.json()) as {
      items?: Array<{ id?: string; status?: string; kind?: string }>
      history?: Array<{ id?: string; status?: string; kind?: string }>
    }
    expect(beforeBody.items?.some(item => item.id === 'bootstrap:readiness' && item.status === 'open')).toBe(true)
    expect(beforeBody.history?.some(item => item.id === 'bootstrap:readiness' && item.status === 'open')).toBe(true)

    const yamlPath = path.join(tmpDir, 'guildhall.yaml')
    const current = await fs.readFile(yamlPath, 'utf8')
    await fs.writeFile(
      yamlPath,
      current +
        '\nbootstrap:\n  verifiedAt: "2026-04-24T00:00:00Z"\n  packageManager: pnpm\n  install: { command: "pnpm install", status: ok }\n  gates:\n    lint: { command: "pnpm lint", available: true }\n',
      'utf8',
    )
    await refreshProjectProjections(tmpDir)

    const after = await app.fetch(new Request(scoped('/api/project/inbox')))
    expect(after.status).toBe(200)
    const afterBody = (await after.json()) as {
      items?: Array<{ id?: string; status?: string }>
      history?: Array<{ id?: string; status?: string; resolution?: string }>
    }
    expect(afterBody.items?.some(item => item.id === 'bootstrap:readiness')).toBe(false)
    expect(afterBody.history?.some(item =>
      item.id === 'bootstrap:readiness' &&
      item.status === 'resolved' &&
      item.resolution === 'verified',
    )).toBe(true)
  })

  it('keeps archived generated task titles out of owner-facing inbox history', async () => {
    await writeSystemJson(
      'TASKS.json',
      {
        version: 1,
        lastUpdated: '2026-07-04T18:00:00.000Z',
        tasks: [
          {
            id: 'task-live',
            title: 'Define fixture, expected-record, prototype-run, and evaluation contracts',
            status: 'ready',
            acceptanceCriteria: [],
            escalations: [],
          },
          {
            id: 'task-stale-generated',
            title: 'Define the cited contracts for Implement fixture-and-expected-record schemas',
            status: 'archived',
            acceptanceCriteria: [],
            escalations: [],
          },
        ],
      },
    )
    await writeSystemJson(
      'attention.json',
      {
        version: 1,
        records: [
          {
            id: 'spec_fill_pending:task-live',
            status: 'open',
            kind: 'spec_fill_pending',
            severity: 'low',
            taskId: 'task-live',
            title: 'Define fixture, expected-record, prototype-run, and evaluation contracts',
            detail: 'Optional cleanup: add acceptance criteria so agents and reviewers have a clearer brief.',
            actionHref: '/task/task-live?tab=spec',
            missingSteps: ['acceptance'],
            createdAt: '2026-07-04T18:00:00.000Z',
            updatedAt: '2026-07-04T18:00:00.000Z',
          },
          {
            id: 'spec_fill_pending:task-stale-generated',
            status: 'resolved',
            resolution: 'verified',
            kind: 'spec_fill_pending',
            severity: 'low',
            taskId: 'task-stale-generated',
            title: 'Define the cited contracts for Implement fixture-and-expected-record schemas',
            detail: 'Old generated split title.',
            actionHref: '/task/task-stale-generated?tab=spec',
            missingSteps: ['acceptance'],
            createdAt: '2026-07-04T17:00:00.000Z',
            updatedAt: '2026-07-04T17:00:00.000Z',
          },
        ],
      },
    )

    const { app, refreshProjectProjections } = buildServeApp({ projectPath: tmpDir })
    await refreshProjectProjections(tmpDir)
    const res = await app.fetch(new Request(scoped('/api/project/inbox?includeHistory=true')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      history?: Array<{ taskId?: string; title?: string }>
    }

    expect(body.history?.some(item => item.taskId === 'task-live')).toBe(true)
    expect(JSON.stringify(body.history ?? [])).not.toContain('Define the cited contracts')
    expect(body.history?.some(item => item.taskId === 'task-stale-generated')).toBe(false)
  })

  it('returns only needs-you alerts sorted by current inbox priority instead of stale record recency', async () => {
    const yamlPath = path.join(tmpDir, 'guildhall.yaml')
    const current = await fs.readFile(yamlPath, 'utf8')
    await fs.writeFile(
      yamlPath,
      current +
        '\nbootstrap:\n  verifiedAt: "2026-04-24T00:00:00Z"\n  packageManager: pnpm\n  install: { command: "pnpm install", status: ok }\n  gates:\n    lint: { command: "pnpm lint", available: true }\n',
      'utf8',
    )
    await writeSystemJson(
      'workspace-goals.json',
      { goals: [] },
    )
    await writeSystemJson(
      'TASKS.json',
      {
        version: 1,
        lastUpdated: '2026-05-31T15:00:00.000Z',
        tasks: [
          {
            id: 'task-thin',
            title: 'Thin ready task',
            description: 'Needs acceptance criteria.',
            status: 'ready',
            productBrief: {
              userJob: 'Use the task.',
              successMetric: 'Task works.',
              approvedAt: '2026-05-31T14:00:00.000Z',
            },
            acceptanceCriteria: [],
            escalations: [],
          },
          {
            id: 'task-blocked',
            title: 'Blocked task',
            description: 'Needs recovery.',
            status: 'blocked',
            escalations: [{ id: 'esc-block', summary: 'Needs recovery.' }],
          },
        ],
      },
    )
    await writeSystemJson(
      'attention.json',
      {
        version: 1,
        records: [
          {
            id: 'spec_fill_pending:task-thin',
            status: 'open',
            kind: 'spec_fill_pending',
            severity: 'low',
            taskId: 'task-thin',
            title: 'Thin ready task',
            detail: 'Optional cleanup: add acceptance criteria so agents and reviewers have a clearer brief.',
            actionHref: '/task/task-thin?tab=spec',
            missingSteps: ['acceptance'],
            createdAt: '2026-05-31T16:00:00.000Z',
            updatedAt: '2026-05-31T16:00:00.000Z',
          },
        ],
      },
    )

    const { app, refreshProjectProjections } = buildServeApp({ projectPath: tmpDir })
    await refreshProjectProjections(tmpDir)
    const res = await app.fetch(new Request(scoped('/api/project/inbox')))
    const body = (await res.json()) as {
      items?: Array<{ kind?: string; taskId?: string; severity?: string }>
    }
    const relevant = (body.items ?? []).filter(item =>
      item.taskId === 'task-thin' || item.taskId === 'task-blocked',
    )

    expect(relevant.map(item => item.kind)).toEqual(['spec_fill_pending'])
    expect(relevant.map(item => item.severity)).toEqual(['low'])
  })

  it('describes project-understanding reconciliation without implying Git is missing', async () => {
    await writeSystemJson(
      'workspace-goals.json',
      { goals: [{ id: 'goal-1', title: 'Existing imported plan' }] },
    )
    await writeSystemTasks({ version: 1, lastUpdated: new Date().toISOString(), tasks: [] })
    const { app, refreshProjectProjections } = buildServeApp({ projectPath: tmpDir })
    await refreshProjectProjections(tmpDir)

    const res = await app.fetch(new Request(scoped('/api/project/inbox')))
    const body = (await res.json()) as {
      items?: Array<{ kind?: string; title?: string; detail?: string; actionHref?: string }>
    }
    const item = body.items?.find(candidate => candidate.kind === 'project_understanding')

    expect(item).toMatchObject({
      title: 'Review project discovery update',
      detail: 'More planning docs and migrations can now be scanned. Review the reconciliation to update or dismiss stale imported work.',
      actionHref: '/workspace-import?mode=reconcile',
    })
    expect(`${item?.title ?? ''} ${item?.detail ?? ''}`).not.toMatch(/missing repo evidence/i)
  })

  it('keeps thread-owned approvals and questions out of the needs-you inbox snapshot', async () => {
    await writeSystemJson(
      'TASKS.json',
      {
        version: 1,
        lastUpdated: '2026-05-31T15:00:00.000Z',
        tasks: [
          {
            id: 'task-spec',
            title: 'Approve the spec draft',
            status: 'spec_review',
            spec: 'Draft spec',
            escalations: [],
            openQuestions: [],
            createdAt: '2026-05-31T14:00:00.000Z',
            updatedAt: '2026-05-31T14:05:00.000Z',
          },
          {
            id: 'task-question',
            title: 'Pick a scope',
            status: 'exploring',
            productBrief: {
              userJob: 'Ship the thing.',
              successMetric: 'The thing works.',
            },
            openQuestions: [
              {
                id: 'q-1',
                kind: 'text',
                askedBy: 'coordinator',
                askedAt: '2026-05-31T14:10:00.000Z',
                prompt: 'Which scope should Guildhall use?',
              },
            ],
            escalations: [],
            createdAt: '2026-05-31T14:00:00.000Z',
            updatedAt: '2026-05-31T14:10:00.000Z',
          },
          {
            id: 'task-thin',
            title: 'Fill in acceptance criteria',
            status: 'ready',
            productBrief: {
              userJob: 'Use the task.',
              successMetric: 'Task works.',
              approvedAt: '2026-05-31T14:00:00.000Z',
            },
            acceptanceCriteria: [],
            openQuestions: [],
            escalations: [],
            createdAt: '2026-05-31T14:00:00.000Z',
            updatedAt: '2026-05-31T14:20:00.000Z',
          },
        ],
      },
    )

    const { app, refreshProjectProjections } = buildServeApp({ projectPath: tmpDir })
    await refreshProjectProjections(tmpDir)
    const res = await app.fetch(new Request(scoped('/api/project/inbox?includeHistory=true')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      items?: Array<{ kind?: string; taskId?: string }>
      history?: Array<{ kind?: string; taskId?: string }>
    }

    expect(body.items?.some(item => item.kind === 'spec_approval' || item.kind === 'agent_question_pending')).toBe(false)
    expect(body.items?.some(item => item.kind === 'spec_fill_pending' && item.taskId === 'task-thin')).toBe(true)
    expect(body.history?.some(item => item.kind === 'spec_approval' || item.kind === 'agent_question_pending')).toBe(false)
  })
})

describe('GET /api/project — bootstrap status', () => {
  it('treats drafted spec_review tasks as waiting for review before project start', async () => {
    await writeSystemTasks({
      tasks: [
        {
          id: 'task-spec-a',
          title: 'Continue drafted spec work',
          status: 'spec_review',
          spec: 'Draft spec',
          createdAt: '2026-06-11T15:00:00.000Z',
          updatedAt: '2026-06-11T15:00:00.000Z',
        },
      ],
    })
    setProvider('anthropic-api', { apiKey: 'sk-ant-test' })
    updateGlobalConfig({ preferredProvider: 'anthropic-api' })
    const { app, refreshProjectProjections } = buildServeApp({ projectPath: tmpDir })
    await refreshProjectProjections(tmpDir)

    const res = await app.fetch(new Request(scopedDiagnostic('/api/project')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      startReadiness?: { canStart?: boolean; actionHref?: string; message?: string }
    }

    expect(body.startReadiness).toMatchObject({
      canStart: false,
      message: '"Continue drafted spec work" is waiting for review before work can start.',
      actionHref: '/thread?thread=task%3Atask-spec-a',
      focusTaskId: 'task-spec-a',
      focusTaskTitle: 'Continue drafted spec work',
      focusKind: 'spec_review',
      count: 1,
    })
  })

  it('targets the first waiting spec thread when spec review blocks start', async () => {
    await writeSystemTasks({
      tasks: [
        {
          id: 'task-spec-a',
          title: 'Approve first spec',
          domain: 'core',
          status: 'spec_review',
          spec: 'Draft spec',
          createdAt: '2026-06-11T15:00:00.000Z',
          updatedAt: '2026-06-11T15:00:00.000Z',
        },
        {
          id: 'task-spec-b',
          title: 'Approve second spec',
          domain: 'core',
          status: 'spec_review',
          spec: 'Draft spec',
          createdAt: '2026-06-11T15:01:00.000Z',
          updatedAt: '2026-06-11T15:01:00.000Z',
        },
      ],
    })
    setProvider('anthropic-api', { apiKey: 'sk-ant-test' })
    updateGlobalConfig({ preferredProvider: 'anthropic-api' })
    const { app, refreshProjectProjections } = buildServeApp({ projectPath: tmpDir })
    await refreshProjectProjections(tmpDir)

    const res = await app.fetch(new Request(scopedDiagnostic('/api/project')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      startReadiness?: { canStart?: boolean; actionHref?: string; message?: string }
    }

    expect(body.startReadiness).toMatchObject({
      canStart: false,
      message: '2 specs are waiting for review before work can start. Start with "Approve first spec".',
      actionHref: '/thread?thread=task%3Atask-spec-a',
      focusTaskId: 'task-spec-a',
      focusTaskTitle: 'Approve first spec',
      focusKind: 'spec_review',
      count: 2,
    })
  })

  it('blocks project start when the selected release is waiting for review even if unscoped child work is runnable', async () => {
    await writeSystemTasks({
      version: 1,
      selectedReleaseId: 'stage-0-spec-baseline',
      releases: [{
        id: 'stage-0-spec-baseline',
        label: 'Stage 0 spec baseline',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        nodeIds: ['work:task-release-spec'],
        deferredNodeIds: [],
      }],
      tasks: [
        {
          id: 'task-release-spec',
          title: 'Define fixture, expected-record, prototype-run, and evaluation schemas.',
          status: 'spec_review',
          releaseIds: ['stage-0-spec-baseline'],
          createdAt: '2026-06-11T15:00:00.000Z',
          updatedAt: '2026-06-11T15:00:00.000Z',
        },
        {
          id: 'task-unscoped-child',
          title: 'Shape fixture and expected-record ground truth',
          status: 'exploring',
          createdAt: '2026-06-11T15:01:00.000Z',
          updatedAt: '2026-06-11T15:01:00.000Z',
        },
      ],
    })
    setProvider('anthropic-api', { apiKey: 'sk-ant-test' })
    updateGlobalConfig({ preferredProvider: 'anthropic-api' })
    const { app } = buildServeApp({ projectPath: tmpDir })

    const res = await app.fetch(new Request(scopedDiagnostic('/api/project')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      startReadiness?: { canStart?: boolean; actionHref?: string; message?: string }
      orientationSpine?: { summary?: { topBlocker?: string | null } }
    }

    expect(body.orientationSpine?.summary?.topBlocker).toBe(
      'Define fixture, expected-record, prototype-run, and evaluation schemas: waiting for review before work can start.',
    )
    expect(body.startReadiness).toMatchObject({
      canStart: false,
      message: '"Define fixture, expected-record, prototype-run, and evaluation schemas." is waiting for review before work can start.',
      actionHref: '/thread?thread=task%3Atask-release-spec',
      focusTaskId: 'task-release-spec',
      focusTaskTitle: 'Define fixture, expected-record, prototype-run, and evaluation schemas.',
      focusKind: 'spec_review',
      count: 1,
    })
  })

  it('prioritizes selected-release spec review over imported-scope shaping', async () => {
    await writeSystemTasks({
      version: 1,
      selectedReleaseId: 'stage-1',
      releases: [{
        id: 'stage-1',
        label: 'Stage 1',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        nodeIds: ['work:task-review-spec', 'work:task-import-needs-shaping'],
        deferredNodeIds: [],
      }],
      tasks: [
        {
          id: 'task-review-spec',
          title: 'Approve current release spec',
          status: 'spec_review',
          releaseIds: ['stage-1'],
          spec: 'Draft spec awaiting owner approval.',
          createdAt: '2026-06-11T15:00:00.000Z',
          updatedAt: '2026-06-11T15:00:00.000Z',
        },
        {
          id: 'task-import-needs-shaping',
          title: 'Shape imported current work',
          status: 'exploring',
          releaseIds: ['stage-1'],
          requestIntake: {
            createdBy: 'workspace-importer',
            evidenceRefs: ['import:docs/current-scope.md'],
          },
          createdAt: '2026-06-11T15:01:00.000Z',
          updatedAt: '2026-06-11T15:01:00.000Z',
        },
      ],
    })
    setProvider('anthropic-api', { apiKey: 'sk-ant-test' })
    updateGlobalConfig({ preferredProvider: 'anthropic-api' })
    const { app } = buildServeApp({ projectPath: tmpDir })

    const res = await app.fetch(new Request(scopedDiagnostic('/api/project')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      startReadiness?: {
        canStart?: boolean
        code?: string
        actionHref?: string
        message?: string
        focusTaskId?: string
        focusKind?: string
      }
      actionModel?: { primaryAction?: { buttonLabel?: string; href?: string; code?: string } | null }
    }

    expect(body.startReadiness).toMatchObject({
      canStart: false,
      code: 'no_unattended_progress',
      message: '"Approve current release spec" is waiting for review before work can start.',
      actionHref: '/thread?thread=task%3Atask-review-spec',
      focusTaskId: 'task-review-spec',
      focusKind: 'spec_review',
    })
    expect(body.actionModel?.primaryAction).toMatchObject({
      buttonLabel: 'Review spec',
      href: '/thread?thread=task%3Atask-review-spec',
      code: 'no_unattended_progress',
    })
  })

  it('includes the last bootstrap run status so the shell can explain async start failures', async () => {
    const bootstrapPath = path.join(getProjectLocalHistoryDir(tmpDir), 'bootstrap.json')
    ensureProjectLocalHistoryDir(tmpDir)
    await fs.writeFile(
      bootstrapPath,
      JSON.stringify({
        success: false,
        lastRunAt: '2026-04-25T00:00:00Z',
        durationMs: 10,
        commandHash: 'x',
        lockfileHash: null,
        steps: [
          {
            kind: 'gate',
            command: 'pnpm run build',
            result: 'fail',
            exitCode: 2,
            output: 'src/customEditorProvider.ts(6,8): error TS2307',
            durationMs: 10,
          },
        ],
      }),
      'utf8',
    )
    await writeSystemTasks({ version: 1, lastUpdated: new Date().toISOString(), tasks: [] })
    const { app } = buildServeApp({ projectPath: tmpDir })

    const res = await app.fetch(new Request(scopedDiagnostic('/api/project')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      bootstrapStatus?: { success?: boolean; steps?: Array<{ command?: string; result?: string }> }
    }
    expect(body.bootstrapStatus?.success).toBe(false)
    expect(body.bootstrapStatus?.steps?.[0]?.command).toBe('pnpm run build')
    expect(body.bootstrapStatus?.steps?.[0]?.result).toBe('fail')
  })

  it('includes the same inbox snapshot as /api/project/inbox', async () => {
    const tasksPath = getProjectSystemStatePath(tmpDir, 'TASKS.json')
    await writeSystemTasks({
        tasks: [
          {
            id: 'task-1',
            title: 'Add unit coverage for use-collections behavior',
            status: 'spec_review',
            spec: 'Draft spec',
            createdAt: '2026-05-05T00:00:00Z',
            updatedAt: '2026-05-05T00:05:00Z',
          },
        ],
    })

    const { app, refreshProjectProjections } = buildServeApp({ projectPath: tmpDir })
    await refreshProjectProjections(tmpDir)
    const projectRes = await app.fetch(new Request(scoped('/api/project')))
    expect(projectRes.status).toBe(200)
    const projectBody = (await projectRes.json()) as {
      inbox?: {
        items?: Array<{ kind?: string; taskId?: string }>
        blockers?: { bootstrap?: boolean; workspaceImport?: boolean }
      }
      memoryHealth?: {
        memoryCore?: {
          adapter?: string
          fallbackUsed?: boolean
          semanticRecallEnabled?: boolean
          observationalMemoryEnabled?: boolean
          observationalProcessorReady?: boolean
          compactionStatus?: string
          semanticValidity?: string
          repoLocalWrites?: string[]
        }
      }
    }

    const inboxRes = await app.fetch(new Request(scoped('/api/project/inbox')))
    expect(inboxRes.status).toBe(200)
    const inboxBody = (await inboxRes.json()) as {
      items?: Array<{ kind?: string; taskId?: string }>
      blockers?: { bootstrap?: boolean; workspaceImport?: boolean }
    }

    expect(projectBody.inbox).toEqual(inboxBody)
    expect(projectBody.inbox?.items?.some(item => item.kind === 'spec_approval' && item.taskId === 'task-1')).toBe(false)
    expect(projectBody.memoryHealth?.memoryCore).toMatchObject({
      adapter: 'deterministic',
      fallbackUsed: false,
      semanticRecallEnabled: false,
      observationalMemoryEnabled: false,
      observationalProcessorReady: false,
      compactionStatus: 'active',
      semanticValidity: 'valid',
      repoLocalWrites: [],
    })
  })

  it('keeps memory engines gated in /api/project when env vars request them without quality proof', async () => {
    process.env.GUILDHALL_MEMORY_SUBSTRATE = 'mastra'
    process.env.GUILDHALL_MEMORY_SEMANTIC_RECALL = '1'
    process.env.GUILDHALL_MEMORY_OBSERVATIONAL = '1'
    await writeSystemTasks({ version: 1, lastUpdated: new Date().toISOString(), tasks: [] })
    const { app, refreshProjectProjections } = buildServeApp({ projectPath: tmpDir })
    await refreshProjectProjections(tmpDir)

    const projectRes = await app.fetch(new Request(scoped('/api/project')))
    expect(projectRes.status).toBe(200)
    const projectBody = (await projectRes.json()) as {
      memoryHealth?: {
        memoryCore?: {
          semanticRecallEnabled?: boolean
          observationalMemoryEnabled?: boolean
          observationalProcessorReady?: boolean
          features?: string[]
          warnings?: string[]
        }
      }
    }

    expect(projectBody.memoryHealth?.memoryCore).toMatchObject({
      semanticRecallEnabled: false,
      observationalMemoryEnabled: false,
      observationalProcessorReady: false,
    })
    expect(projectBody.memoryHealth?.memoryCore?.features).toEqual(expect.arrayContaining([
      'semantic-recall-gated',
      'observational-memory-gated',
    ]))
    expect(projectBody.memoryHealth?.memoryCore?.warnings?.join('\n')).toContain('Semantic recall requested but held behind the memory engine quality gate.')
    expect(projectBody.memoryHealth?.memoryCore?.warnings?.join('\n')).toContain('Observational Memory requested but held behind the memory engine quality gate.')
  })

  it('marks dynamic project payloads as non-cacheable', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })

    const projectRes = await app.fetch(new Request(scoped('/api/project')))
    expect(projectRes.headers.get('cache-control')).toBe('no-store, no-cache, must-revalidate')
    expect(projectRes.headers.get('pragma')).toBe('no-cache')

    const inboxRes = await app.fetch(new Request(scoped('/api/project/inbox')))
    expect(inboxRes.headers.get('cache-control')).toBe('no-store, no-cache, must-revalidate')
    expect(inboxRes.headers.get('pragma')).toBe('no-cache')
  })

  it('includes a structural map review summary for owner review', async () => {
    await fs.mkdir(path.join(tmpDir, 'packages', 'core'), { recursive: true })
    await fs.mkdir(path.join(tmpDir, 'packages', 'editor'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'settings-test',
        private: true,
        workspaces: ['packages/*'],
      }, null, 2),
      'utf8',
    )
    await fs.writeFile(
      path.join(tmpDir, 'packages', 'core', 'package.json'),
      JSON.stringify({
        name: '@settings/core',
        scripts: { test: 'vitest run' },
      }, null, 2),
      'utf8',
    )
    await fs.writeFile(
      path.join(tmpDir, 'packages', 'editor', 'package.json'),
      JSON.stringify({
        name: '@settings/editor',
        dependencies: { '@settings/core': 'workspace:*' },
      }, null, 2),
      'utf8',
    )
    const draft = await draftStructuralMap({
      projectId: PROJECT_ID,
      projectRoot: tmpDir,
      now: '2026-06-01T12:00:00.000Z',
    })
    const review = await submitStructuralMapForReview({
      projectRoot: tmpDir,
      mapId: draft.id,
      actor: 'coordinator',
      now: '2026-06-01T12:01:00.000Z',
    })
    await acceptStructuralMap({
      projectRoot: tmpDir,
      mapId: review.id,
      actor: 'owner',
      now: '2026-06-01T12:02:00.000Z',
    })

    await writeSystemTasks({ version: 1, lastUpdated: new Date().toISOString(), tasks: [] })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(scopedDiagnostic('/api/project')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      structuralMapReview?: {
        state?: string
        counts?: Record<string, number>
        packages?: Array<{ id: string; label: string }>
        domains?: Array<{ id: string; label: string }>
        executableUnits?: Array<{ id: string; command?: string }>
        gitRoots?: Array<{ path: string }>
        questions?: Array<{ id: string; prompt: string }>
      }
    }

    expect(body.structuralMapReview?.state).toBe('accepted')
    expect(body.structuralMapReview?.counts?.packages).toBe(2)
    expect(body.structuralMapReview?.packages?.map(item => item.label)).toEqual(expect.arrayContaining(['@settings/core', '@settings/editor']))
    expect(body.structuralMapReview?.domains?.some(item => item.id.startsWith('domain:'))).toBe(true)
    expect(body.structuralMapReview?.executableUnits?.some(item => item.command === 'npm --workspace @settings/core run test')).toBe(true)
    expect(body.structuralMapReview?.gitRoots?.[0]?.path).toBe('.')
    expect(body.structuralMapReview?.questions?.length).toBeGreaterThan(0)

    const graphRes = await app.fetch(new Request(scoped('/api/project/project-graph')))
    expect(graphRes.status).toBe(200)
    const graphBody = (await graphRes.json()) as {
      projectGraph?: { structuralDomains?: Array<{ id?: string; label?: string; kind?: string }> }
    }
    expect(graphBody.projectGraph?.structuralDomains?.some(item => item.id?.startsWith('domain:'))).toBe(true)
    expect(graphBody.projectGraph?.structuralDomains?.every(item => item.kind === 'structural_domain')).toBe(true)
  })

  it('applies structural map review actions through the owning project endpoint', async () => {
    await fs.mkdir(path.join(tmpDir, 'packages', 'core'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'settings-test',
        private: true,
        workspaces: ['packages/*'],
      }, null, 2),
      'utf8',
    )
    await fs.writeFile(
      path.join(tmpDir, 'packages', 'core', 'package.json'),
      JSON.stringify({ name: '@settings/core' }, null, 2),
      'utf8',
    )
    const draft = await draftStructuralMap({
      projectId: PROJECT_ID,
      projectRoot: tmpDir,
      now: '2026-06-01T12:10:00.000Z',
    })
    const review = await submitStructuralMapForReview({
      projectRoot: tmpDir,
      mapId: draft.id,
      actor: 'coordinator',
      now: '2026-06-01T12:11:00.000Z',
    })

    const { app } = buildServeApp({ projectPath: tmpDir })
    const rename = await app.fetch(new Request(scoped('/api/project/structural-map/action'), {
      method: 'POST',
      body: JSON.stringify({
        mapId: review.id,
        action: { kind: 'rename_node', nodeId: 'domain:core', label: 'Core runtime' },
      }),
    }))
    expect(rename.status).toBe(200)
    const renameBody = (await rename.json()) as { structuralMapReview?: { domains?: Array<{ label?: string }> } }
    expect(renameBody.structuralMapReview?.domains?.map(item => item.label)).toContain('Core runtime')

    const accept = await app.fetch(new Request(scoped('/api/project/structural-map/action'), {
      method: 'POST',
      body: JSON.stringify({
        mapId: review.id,
        action: { kind: 'accept' },
      }),
    }))
    expect(accept.status).toBe(200)
    const acceptBody = (await accept.json()) as { structuralMapReview?: { state?: string } }
    expect(acceptBody.structuralMapReview?.state).toBe('accepted')
  })

  it('selects the current release boundary through the owning project endpoint', async () => {
    await writeSystemTasks({
      version: 1,
      lastUpdated: '2026-06-01T12:00:00.000Z',
      selectedReleaseId: 'release-1',
      releases: [
        {
          id: 'release-1',
          label: 'Headless MVP',
          kind: 'release',
          state: 'active',
          source: 'release_plan',
        },
        {
          id: 'release-2',
          label: 'Agent review proof',
          kind: 'release',
          state: 'planned',
          source: 'release_plan',
          description: null,
        },
      ],
      tasks: [
        {
          id: 'task-1',
          title: 'Run headless proof',
          status: 'ready',
          releaseIds: ['release-1'],
        },
        {
          id: 'task-2',
          title: 'Run agent review proof',
          status: 'ready',
          releaseIds: ['release-2'],
        },
      ],
    })
    await applyCanonicalMigrations()
    const { app } = buildServeApp({ projectPath: tmpDir })

    const select = await app.fetch(new Request(scoped('/api/project/release/select'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ releaseId: 'release-2' }),
    }))

    expect(select.status).toBe(200)
    const body = (await select.json()) as {
      selectedReleaseId?: string
      release?: { id?: string; label?: string }
      spine?: { selectedRelease?: { id?: string; label?: string } }
    }
    expect(body.selectedReleaseId).toBe('release-2')
    expect(body.release?.label).toBe('Agent review proof')
    expect(body.spine?.selectedRelease?.id).toBe('release-2')

    const queue = readProjectStateDatabaseQueueDefinition(getProjectSystemStatePath(tmpDir, 'TASKS.json'))
    if (!queue) throw new Error('Missing canonical SQLite task queue')
    expect(queue.selectedReleaseId).toBe('release-2')
    expect(queue.releases?.find(release => release.id === 'release-2')?.description).toBeUndefined()
    expect(queue.releases?.find(release => release.id === 'release-2')?.state).toBe('active')
  })

  it('activates later scope without reopening a shipped release', async () => {
    await writeSystemTasks({
      version: 1,
      lastUpdated: '2026-06-01T12:00:00.000Z',
      selectedReleaseId: 'release-1',
      releases: [
        {
          id: 'release-1',
          label: 'First release',
          kind: 'release',
          state: 'shipped',
          source: 'release_plan',
          nodeIds: ['work:task-1'],
          deferredNodeIds: [],
        },
        {
          id: 'release-2',
          label: 'Later release',
          kind: 'release',
          state: 'planned',
          source: 'release_plan',
          nodeIds: ['work:task-2'],
          deferredNodeIds: [],
        },
      ],
      tasks: [
        { id: 'task-1', title: 'Closed work', status: 'done', releaseIds: ['release-1'] },
        { id: 'task-2', title: 'Later work', status: 'ready', releaseIds: ['release-2'] },
      ],
    })
    await applyCanonicalMigrations()
    const { app } = buildServeApp({ projectPath: tmpDir })

    const select = await app.fetch(new Request(scoped('/api/project/release/select'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ releaseId: 'release-2' }),
    }))

    expect(select.status).toBe(200)
    const queue = readProjectStateDatabaseQueueDefinition(getProjectSystemStatePath(tmpDir, 'TASKS.json'))
    expect(queue?.selectedReleaseId).toBe('release-2')
    expect(queue?.releases?.find(release => release.id === 'release-1')?.state).toBe('shipped')
    expect(queue?.releases?.find(release => release.id === 'release-2')?.state).toBe('active')
  })

  it('selects a release inferred from task membership through the owning project endpoint', async () => {
    await writeSystemTasks({
      version: 1,
      lastUpdated: '2026-06-01T12:00:00.000Z',
      selectedReleaseId: 'release-1',
      releases: [
        { id: 'release-1', label: 'Headless MVP', kind: 'release', state: 'active', source: 'release_plan' },
        { id: 'release-2', label: 'Release 2', kind: 'release', state: 'planned', source: 'release_plan' },
      ],
      tasks: [
        {
          id: 'task-1',
          title: 'Run headless proof',
          status: 'done',
          releaseIds: ['release-1'],
        },
        {
          id: 'task-2',
          title: 'Run agent review proof',
          status: 'ready',
          releaseIds: ['release-2'],
        },
      ],
    })
    await applyCanonicalMigrations()
    const { app } = buildServeApp({ projectPath: tmpDir })

    const select = await app.fetch(new Request(scoped('/api/project/release/select'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ releaseId: 'release-2' }),
    }))

    expect(select.status).toBe(200)
    const body = (await select.json()) as {
      selectedReleaseId?: string
      release?: { id?: string; label?: string }
      spine?: { selectedRelease?: { id?: string; label?: string } }
    }
    expect(body.selectedReleaseId).toBe('release-2')
    expect(body.release?.label).toBe('Release 2')
    expect(body.spine?.selectedRelease?.id).toBe('release-2')

    const queue = readProjectStateDatabaseQueueDefinition(getProjectSystemStatePath(tmpDir, 'TASKS.json'))
    if (!queue) throw new Error('Missing canonical SQLite task queue')
    expect(queue.selectedReleaseId).toBe('release-2')
    expect(queue.releases?.map(release => release.id)).toEqual(['release-1', 'release-2'])
  })

  it('ships a selected release through the shared readiness boundary', async () => {
    await writeSystemTasks({
      version: 1,
      lastUpdated: '2026-06-01T12:00:00.000Z',
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
        completedAt: '2026-06-01T12:00:00.000Z',
        updatedAt: '2026-06-01T12:00:00.000Z',
        createdAt: '2026-06-01T12:00:00.000Z',
        releaseIds: ['release-1'],
        proofPaths: [{ kind: 'command', source: 'documented', command: 'pnpm test' }],
        gateResults: [{ status: 'passed', command: 'pnpm test', checkedAt: '2026-06-01T12:00:00.000Z' }],
        gitStory: { override: 'local_only', reason: 'The fixture deliberately has no remote release target.' },
      }],
    })
    await execFileP('git', ['init', '--bare', remoteDir])
    await execFileP('git', ['remote', 'add', 'origin', remoteDir], { cwd: tmpDir })
    await execFileP('git', ['push', '--set-upstream', 'origin', 'main'], { cwd: tmpDir })
    await applyCanonicalMigrations()
    const { app } = buildServeApp({ projectPath: tmpDir })

    const close = await app.fetch(new Request(scoped('/api/project/release/close'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ releaseId: 'release-1' }),
    }))

    expect(close.status).toBe(200)
    expect(await close.json()).toMatchObject({ ok: true, release: { id: 'release-1', state: 'shipped' } })
    const queue = readProjectStateDatabaseQueueDefinition(getProjectSystemStatePath(tmpDir, 'TASKS.json'))
    expect(queue?.releases?.find(release => release.id === 'release-1')?.state).toBe('shipped')

    const repeat = await app.fetch(new Request(scoped('/api/project/release/close'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ releaseId: 'release-1' }),
    }))
    expect(repeat.status).toBe(200)
    expect(await repeat.json()).toMatchObject({ ok: true, alreadyShipped: true })
  })

  it('does not ship a release with unfinished work', async () => {
    await writeSystemTasks({
      version: 1,
      lastUpdated: '2026-06-01T12:00:00.000Z',
      selectedReleaseId: 'release-1',
      releases: [{ id: 'release-1', label: 'Headless MVP', kind: 'release', state: 'active', source: 'release_plan', proofStyle: 'script_only' }],
      tasks: [{
        id: 'task-1',
        title: 'Run headless proof',
        status: 'ready',
        createdAt: '2026-06-01T12:00:00.000Z',
        updatedAt: '2026-06-01T12:00:00.000Z',
        releaseIds: ['release-1'],
      }],
    })
    await applyCanonicalMigrations()
    const { app } = buildServeApp({ projectPath: tmpDir })

    const close = await app.fetch(new Request(scoped('/api/project/release/close'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ releaseId: 'release-1' }),
    }))

    expect(close.status).toBe(409)
    expect(await close.json()).toMatchObject({ code: 'not_ready' })
  })

  it('serves the scoped local project graph view for the selected project', async () => {
    const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-serve-settings-provider-'))
    try {
      bootstrapWorkspace(providerDir, { name: 'Looma' })
      await createProjectDependencyRequest({
        consumerProject: { id: PROJECT_ID, path: tmpDir, label: 'Settings Test' },
        providerProject: { id: 'looma', path: providerDir, label: 'Looma' },
        domain: { id: 'domain:editor', label: 'Editor' },
        consumerNeed: 'Settings Test needs an editor adapter.',
        rationale: 'The editor domain is provider-owned by Looma.',
        requestedBy: 'coordinator:settings-test',
        expectedDelivery: {
          format: 'Svelte editor adapter',
          channel: 'npm dev tag',
          consumerVerificationPlan: ['Run settings-test editor integration.'],
        },
        now: '2026-06-01T12:20:00.000Z',
      })

      const { app } = buildServeApp({ projectPath: tmpDir })
      const res = await app.fetch(new Request(scoped('/api/project/project-graph')))
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        projectGraph?: {
          localProjects?: Array<{ id?: string; role?: string }>
          authorityRoots?: Array<{ projectId?: string; domainId?: string }>
          unresolvedRequests?: Array<{ waitingOn?: string }>
        }
      }
      expect(body.projectGraph?.localProjects).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: PROJECT_ID, role: 'current' }),
        expect.objectContaining({ id: 'looma', role: 'provider' }),
      ]))
      expect(body.projectGraph?.authorityRoots).toContainEqual(expect.objectContaining({
        projectId: 'looma',
        domainId: 'domain:editor',
      }))
      expect(body.projectGraph?.unresolvedRequests).toContainEqual(expect.objectContaining({
        waitingOn: 'provider',
      }))
    } finally {
      await fs.rm(providerDir, { recursive: true, force: true })
    }
  })

  it('serves child project graph targets and assigns domain responsibility facets', async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-serve-settings-workspace-provider-'))
    try {
      await fs.mkdir(path.join(workspaceDir, 'looma'), { recursive: true })
      await fs.mkdir(path.join(workspaceDir, 'knit'), { recursive: true })
      writeWorkspaceConfig(workspaceDir, {
        name: 'Looma + Knit',
        id: 'looma-knit',
        kind: 'workspace',
        projects: [
          { id: 'looma', label: 'Looma', type: 'library', path: 'looma', coordinator: 'looma' },
          { id: 'knit', label: 'Knit', type: 'app', path: 'knit', coordinator: 'knit' },
        ],
      } as Parameters<typeof writeWorkspaceConfig>[1])
      registerWorkspace({ id: 'looma-knit', path: workspaceDir, name: 'Looma + Knit', tags: [] })

      const { app } = buildServeApp({ projectPath: tmpDir })
      const graph = await app.fetch(new Request(scoped('/api/project/project-graph')))
      expect(graph.status).toBe(200)
      const graphBody = (await graph.json()) as {
        projectGraph?: {
          localProjects?: Array<{ id?: string; role?: string; path?: string }>
          localProjectIndex?: Array<{ id?: string; role?: string; path?: string }>
          domainResponsibilities?: Array<{ facet?: string; responsibleProjectId?: string; assignable?: boolean }>
        }
      }
      expect(graphBody.projectGraph?.localProjects).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'looma-knit' }),
        expect.objectContaining({ id: 'looma' }),
        expect.objectContaining({ id: 'knit' }),
      ]))
      expect(graphBody.projectGraph?.localProjectIndex).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'looma-knit', role: 'indexed', path: workspaceDir }),
        expect.objectContaining({ id: 'looma', role: 'indexed', path: path.join(workspaceDir, 'looma') }),
        expect.objectContaining({ id: 'knit', role: 'indexed', path: path.join(workspaceDir, 'knit') }),
      ]))

      const assign = await app.fetch(new Request(scoped('/api/project/project-graph/domain-responsibility'), {
        method: 'POST',
        body: JSON.stringify({
          domainId: 'domain:ui-foundation',
          domainLabel: 'UI foundation',
          facet: 'provider_capability',
          responsibleProjectId: 'looma',
        }),
      }))
      expect(assign.status).toBe(200)
      const assignBody = (await assign.json()) as {
        projectGraph?: {
          domainResponsibilities?: Array<{ domainId?: string; facet?: string; responsibleProjectId?: string; assignable?: boolean }>
        }
      }
      expect(assignBody.projectGraph?.domainResponsibilities).toEqual(expect.arrayContaining([
        expect.objectContaining({
          domainId: 'domain:ui-foundation',
          facet: 'provider_capability',
          responsibleProjectId: 'looma',
        }),
        expect.objectContaining({
          domainId: 'domain:ui-foundation',
          facet: 'consumer_configuration',
          responsibleProjectId: PROJECT_ID,
          assignable: false,
        }),
      ]))
    } finally {
      await fs.rm(workspaceDir, { recursive: true, force: true })
    }
  })

  it('assigns domain authority and drives provider/consumer request actions through owning project endpoints', async () => {
    const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-serve-settings-provider-'))
    try {
      bootstrapWorkspace(providerDir, { name: 'Looma' })
      registerWorkspace({ id: 'looma', path: providerDir, name: 'Looma', tags: [] })

      const consumerApp = buildServeApp({ projectPath: tmpDir }).app
      const assign = await consumerApp.fetch(new Request(scoped('/api/project/project-graph/domain-authority'), {
        method: 'POST',
        body: JSON.stringify({
          domainId: 'domain:editor',
          domainLabel: 'Editor',
          providerProjectId: 'looma',
        }),
      }))
      expect(assign.status).toBe(200)
      const assignBody = (await assign.json()) as {
        projectGraph?: { domainAuthorities?: Array<{ domain?: { id?: string }; providerProject?: { id?: string } }> }
      }
      expect(assignBody.projectGraph?.domainAuthorities).toContainEqual(expect.objectContaining({
        domain: expect.objectContaining({ id: 'domain:editor' }),
        providerProject: expect.objectContaining({ id: 'looma' }),
      }))

      const edge = await createProjectDependencyRequest({
        consumerProject: { id: PROJECT_ID, path: tmpDir, label: 'Settings Test' },
        providerProject: { id: 'looma', path: providerDir, label: 'Looma' },
        domain: { id: 'domain:editor', label: 'Editor' },
        consumerNeed: 'Settings Test needs a portable editor control.',
        rationale: 'The editor domain is provider-owned by Looma.',
        requestedBy: 'coordinator:settings-test',
        expectedDelivery: {
          format: 'portable editor package',
          channel: 'local path artifact',
          consumerVerificationPlan: ['Run Settings Test editor integration.'],
        },
        now: '2026-06-01T12:30:00.000Z',
      })

      const providerApp = buildServeApp({ projectPath: providerDir }).app
      const providerGraph = await providerApp.fetch(new Request(`http://localhost/api/project/project-graph?projectId=looma`))
      expect(providerGraph.status).toBe(200)
      const providerBody = (await providerGraph.json()) as {
        projectGraph?: { dependencyEdges?: Array<{ id?: string; state?: string; consumerProjectId?: string }> }
      }
      expect(providerBody.projectGraph?.dependencyEdges).toContainEqual(expect.objectContaining({
        id: edge.id,
        state: 'submitted',
        consumerProjectId: PROJECT_ID,
      }))

      const providerAccept = await providerApp.fetch(new Request(`http://localhost/api/project/project-graph/requests/${edge.id}/provider-accept?projectId=looma`, {
        method: 'POST',
        body: JSON.stringify({ providerTaskRef: 'task-editor-control' }),
      }))
      expect(providerAccept.status).toBe(200)
      expect(await readJsonState(providerAccept)).toEqual(expect.objectContaining({ edgeState: 'provider_shaping' }))

      const providerPlan = await providerApp.fetch(new Request(`http://localhost/api/project/project-graph/requests/${edge.id}/provider-plan?projectId=looma`, {
        method: 'POST',
        body: JSON.stringify({
          format: 'portable editor package',
          channel: 'local path artifact',
          providerProofPlan: ['pnpm test editor'],
          consumerVerificationPlan: ['pnpm test settings-editor'],
        }),
      }))
      expect(providerPlan.status).toBe(200)
      expect(await readJsonState(providerPlan)).toEqual(expect.objectContaining({ edgeState: 'provider_working' }))

      const providerDeliver = await providerApp.fetch(new Request(`http://localhost/api/project/project-graph/requests/${edge.id}/provider-deliver?projectId=looma`, {
        method: 'POST',
        body: JSON.stringify({
          id: 'delivery-1',
          format: 'portable editor package',
          channel: 'local path artifact',
          coordinates: `${providerDir}/dist/editor.tgz`,
          providerProof: ['pnpm test editor passed'],
        }),
      }))
      expect(providerDeliver.status).toBe(200)
      expect(await readJsonState(providerDeliver)).toEqual(expect.objectContaining({ edgeState: 'delivered' }))

      const consumerReview = await consumerApp.fetch(new Request(scoped(`/api/project/project-graph/requests/${edge.id}/consumer-review`), {
        method: 'POST',
        body: JSON.stringify({ verificationContext: 'Settings Test tried the editor package.' }),
      }))
      expect(consumerReview.status).toBe(200)
      expect(await readJsonState(consumerReview)).toEqual(expect.objectContaining({ edgeState: 'consumer_reviewing' }))

      const consumerReturn = await consumerApp.fetch(new Request(scoped(`/api/project/project-graph/requests/${edge.id}/consumer-return`), {
        method: 'POST',
        body: JSON.stringify({
          deliveryReceiptId: 'delivery-1',
          mismatchKind: 'format',
          expected: 'tarball package',
          received: 'folder path',
          failedVerification: ['install failed'],
          requestedCorrection: 'Publish a tarball package.',
        }),
      }))
      expect(consumerReturn.status).toBe(200)
      expect(await readJsonState(consumerReturn)).toEqual(expect.objectContaining({ edgeState: 'revision_requested' }))

      const providerRevise = await providerApp.fetch(new Request(`http://localhost/api/project/project-graph/requests/${edge.id}/provider-plan?projectId=looma`, {
        method: 'POST',
        body: JSON.stringify({
          format: 'tarball package',
          channel: 'local path artifact',
          consumerVerificationPlan: ['install tarball'],
        }),
      }))
      expect(providerRevise.status).toBe(200)
      expect(await readJsonState(providerRevise)).toEqual(expect.objectContaining({ edgeState: 'provider_working' }))

      const providerRedeliver = await providerApp.fetch(new Request(`http://localhost/api/project/project-graph/requests/${edge.id}/provider-deliver?projectId=looma`, {
        method: 'POST',
        body: JSON.stringify({
          id: 'delivery-2',
          format: 'tarball package',
          channel: 'local path artifact',
          coordinates: `${providerDir}/dist/editor-2.tgz`,
          providerProof: ['tarball created'],
        }),
      }))
      expect(providerRedeliver.status).toBe(200)
      expect(await readJsonState(providerRedeliver)).toEqual(expect.objectContaining({ edgeState: 'delivered' }))

      const consumerReviewAgain = await consumerApp.fetch(new Request(scoped(`/api/project/project-graph/requests/${edge.id}/consumer-review`), {
        method: 'POST',
        body: JSON.stringify({ verificationContext: 'Settings Test installed the tarball.' }),
      }))
      expect(consumerReviewAgain.status).toBe(200)

      const consumerAccept = await consumerApp.fetch(new Request(scoped(`/api/project/project-graph/requests/${edge.id}/consumer-accept`), {
        method: 'POST',
        body: JSON.stringify({ consumerProof: ['install tarball passed'] }),
      }))
      expect(consumerAccept.status).toBe(200)
      expect(await readJsonState(consumerAccept)).toEqual(expect.objectContaining({ edgeState: 'resolved' }))
    } finally {
      await fs.rm(providerDir, { recursive: true, force: true })
    }
  })
})

async function readJsonState(response: Response): Promise<{ edgeState?: string }> {
  const body = (await response.json()) as {
    edge?: { stateMachine?: { state?: string } }
  }
  return { edgeState: body.edge?.stateMachine?.state }
}
