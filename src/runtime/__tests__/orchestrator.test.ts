import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import {
  Orchestrator,
  pickNextTask,
  shouldResumeAgentSession,
  isSessionSnapshotFreshForTask,
  type OrchestratorAgent,
  type OrchestratorAgentSet,
  type ReviewerFanoutRunner,
} from '../orchestrator.js'
import { LivenessTracker } from '../liveness.js'
import { upsertTaskRuntimeState, upsertTaskWorkspaceState } from '../task-state-store.js'
import { buildEffectiveTask } from '../effective-task.js'
import { updateProjectConfig, type ResolvedConfig } from '@guildhall/config'
import type { Task, TaskQueue, TaskStatus } from '@guildhall/core'
import { getProjectSystemStatePath } from '../../sessions/local-history.js'
import {
  defaultAgentSettingsPath,
  makeDefaultSettings,
  saveLeverSettings,
  type DomainLevers,
  type LeverSettings,
} from '@guildhall/levers'
import { InMemoryGitDriver } from '../git-driver.js'
import { writeCheckpoint } from '@guildhall/tools'
import { appendFailureClassificationNote, classifyAgentFailure } from '../policy.js'
import { commandEvidence, touchedFiles } from './policy-fixtures.js'
import { readProjectLearning } from '../learning.js'
import { loadCodebaseMap } from '@guildhall/corpus-map'
import {
  getProjectContextDebugLedgerPath,
  getProjectLocalHistoryDir,
  getProjectProgressHeartbeatsPath,
  getProjectTaskLocalHistoryDir,
  getProjectTranscriptPath,
  appendTaskEvidence,
  readTaskEvidence,
  readTaskRuntimeStore,
} from '@guildhall/sessions'
import { createOwnerInputRequest, listOwnerInputRequests } from '../owner-input-store.js'
import { readMemoryEvents } from '@guildhall/memory-core'

// ---------------------------------------------------------------------------
// Orchestrator feedback-loop tests
//
// These tests exercise the full tick cycle against a real temp workspace.
// Agents are stubbed with a recording helper that can optionally mutate
// TASKS.json to simulate what the real LLM-driven agents would do through
// their tool calls. The orchestrator reads the mutated state after each
// agent call — that is the feedback loop we are verifying.
// ---------------------------------------------------------------------------

let tmpDir: string
let dataDir: string
let memoryDir: string
let tasksPath: string
let progressPath: string
let agentSettingsPath: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-orch-test-'))
  dataDir = path.join(os.tmpdir(), `guildhall-data-${path.basename(tmpDir)}`)
  process.env.GUILDHALL_CONFIG_DIR = path.join(dataDir, 'config')
  process.env.GUILDHALL_DATA_DIR = dataDir
  memoryDir = path.join(tmpDir, '.guildhall')
  await fs.mkdir(memoryDir, { recursive: true })
  tasksPath = getProjectSystemStatePath(tmpDir, 'TASKS.json')
  progressPath = getProjectSystemStatePath(tmpDir, 'PROGRESS.md')
  agentSettingsPath = defaultAgentSettingsPath(tmpDir)

  execFileSync('git', ['init', '-b', 'main'], { cwd: tmpDir, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.name', 'Guildhall Test'], {
    cwd: tmpDir,
    stdio: 'ignore',
  })
  execFileSync('git', ['config', 'user.email', 'guildhall-tests@example.com'], {
    cwd: tmpDir,
    stdio: 'ignore',
  })
  await fs.writeFile(path.join(tmpDir, '.gitignore'), 'memory/\n', 'utf-8')
  execFileSync('git', ['add', '.gitignore'], { cwd: tmpDir, stdio: 'ignore' })
  execFileSync('git', ['commit', '--no-verify', '-m', 'init'], {
    cwd: tmpDir,
    stdio: 'ignore',
  })

  const settings = makeDefaultSettings(new Date('2026-04-20T00:00:00Z'))
  settings.project.worktree_isolation = {
    position: 'none',
    rationale: 'Most orchestrator tests exercise queue and agent-state behavior, not git isolation defaults.',
    setAt: '2026-04-20T00:00:00.000Z',
    setBy: 'user-direct',
  }
  await saveLeverSettings({
    path: agentSettingsPath,
    settings,
  })
})

afterEach(async () => {
  delete process.env.GUILDHALL_CONFIG_DIR
  delete process.env.GUILDHALL_DATA_DIR
  await fs.rm(tmpDir, { recursive: true, force: true })
  await fs.rm(dataDir, { recursive: true, force: true })
})

function baseConfig(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    workspaceId: 'test-ws',
    workspaceName: 'Test',
    workspacePath: tmpDir,
    projectPath: tmpDir,
    memoryDir,
    models: {
      spec: 'm',
      coordinator: 'm',
      worker: 'm',
      reviewer: 'm',
      gateChecker: 'm',
      contextIndexer: 'm',
    },
    coordinators: [],
    maxRevisions: 3,
    heartbeatInterval: 5,
    ignore: [],
    lmStudioUrl: 'http://localhost:1234',
    servePort: 7777,
    ...overrides,
  }
}

function taskHistoryPath(taskId: string, ...parts: string[]): string {
  return path.join(getProjectTaskLocalHistoryDir(tmpDir, taskId), ...parts)
}

const VALID_SPEC = [
  '## Summary',
  '',
  'Implement the requested change.',
  '',
  '## Completion Boundary',
  '- Product outcome: The requested change works for the target user.',
  '- What Guildhall can complete in code: Update the relevant source and test files.',
  '- External dependencies: None.',
  '- Owner-only setup: None.',
  '- Verification environment: Local test environment.',
  '- What counts as done: The acceptance criterion is met and the task can be reviewed locally.',
  '- What must be split or blocked: Nothing.',
  '',
  '## Acceptance Criteria',
  '1. Thing is done.',
].join('\n')

function mkTask(overrides: Partial<Task> = {}): Task {
  const task: Task = {
    id: 'task-001',
    title: 'Do a thing',
    description: 'Details here',
    domain: 'looma',
    projectPath: tmpDir,
    status: 'exploring',
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
    origination: 'human',
    createdAt: '2026-04-01T00:00:00Z',
    updatedAt: '2026-04-01T00:00:00Z',
    ...overrides,
  }
  if (task.status === 'ready' && !Object.hasOwn(overrides, 'spec')) {
    task.spec = VALID_SPEC
  }
  if (task.status !== 'exploring' && task.spec === VALID_SPEC) {
    if (task.acceptanceCriteria.length === 0) {
      task.acceptanceCriteria = [{
        id: 'ac-1',
        description: 'Thing is done',
        verifiedBy: 'review',
        met: false,
      }]
    }
    task.productBrief ??= {
      userJob: 'I want the requested task completed.',
      successMetric: 'The acceptance criterion is met.',
      antiPatterns: [],
      approvedAt: '2026-05-26T00:00:00.000Z',
    }
  }
  return task
}

async function writeQueue(tasks: Task[]): Promise<void> {
  const queue: TaskQueue = {
    version: 1,
    lastUpdated: '2026-04-01T00:00:00Z',
    tasks,
  }
  await fs.mkdir(path.dirname(tasksPath), { recursive: true })
  const tmpPath = `${tasksPath}.tmp`
  await fs.writeFile(tmpPath, JSON.stringify(queue, null, 2), 'utf-8')
  await fs.rename(tmpPath, tasksPath)
}

async function writeManagedQueue(tasks: Task[]): Promise<void> {
  const queue: TaskQueue = {
    version: 1,
    lastUpdated: '2026-04-01T00:00:00Z',
    tasks,
  }
  const managedTasksPath = getProjectSystemStatePath(tmpDir, 'TASKS.json')
  await fs.mkdir(path.dirname(managedTasksPath), { recursive: true })
  await fs.writeFile(managedTasksPath, JSON.stringify(queue, null, 2), 'utf-8')
}

async function readQueue(): Promise<TaskQueue> {
  const managedTasksPath = getProjectSystemStatePath(tmpDir, 'TASKS.json')
  const raw = await fs.readFile(managedTasksPath, 'utf-8')
  const queue = JSON.parse(raw) as TaskQueue
  return {
    ...queue,
    tasks: await Promise.all(queue.tasks.map(async (task) => {
      const effective = await buildEffectiveTask(tmpDir, task) as unknown as Task
      effective.notes ??= []
      effective.gateResults ??= []
      effective.reviewVerdicts ??= []
      effective.adjudications ??= []
      effective.escalations ??= []
      effective.agentIssues ??= []
      return effective
    })),
  }
}

async function readManagedQueue(): Promise<TaskQueue> {
  const raw = await fs.readFile(getProjectSystemStatePath(tmpDir, 'TASKS.json'), 'utf-8')
  return JSON.parse(raw)
}

async function readEffectiveTaskFromQueue(taskId: string): Promise<Task | undefined> {
  const queue = await readQueue()
  const task = queue.tasks.find((candidate) => candidate.id === taskId)
  return task ? await buildEffectiveTask(tmpDir, task) as unknown as Task : undefined
}

async function seedTaskOwnerInput(input: {
  taskId: string
  questionId?: string
  prompt: string
  choices?: string[]
}): Promise<void> {
  await createOwnerInputRequest({
    projectRoot: tmpDir,
    projectId: 'test-ws',
    commandId: `test-owner-input:${input.taskId}:${input.questionId ?? 'q-1'}`,
    now: '2026-05-02T00:00:00.000Z',
    actor: 'test',
    source: {
      kind: 'task',
      taskId: input.taskId,
      questionId: input.questionId ?? 'q-1',
    },
    target: { kind: 'thread' },
    prompt: input.prompt,
    ...(input.choices ? { choices: input.choices } : {}),
    objective: {
      kind: 'task_shaping',
      label: `Clarify ${input.taskId}`,
      successCriteria: ['Owner answers the linked bounded-chat session.'],
    },
  })
}

function preservedQuestionNote(prompt: string, answer: string): Task['notes'][number] {
  return {
    agentId: 'migration:0.10.0/task-open-questions-to-bounded-chat',
    role: 'coordinator',
    content:
      'Preserved answered owner question during 0.10.0/task-open-questions-to-bounded-chat migration.\n\n' +
      `Question: ${prompt}\nAnswer: ${answer}`,
    timestamp: '2026-05-19T22:26:12.323Z',
  }
}

function queueOf(tasks: Task[]): TaskQueue {
  return {
    version: 1,
    lastUpdated: '2026-04-01T00:00:00Z',
    tasks,
  }
}

/**
 * Mutate a task on disk as if the real agent had called the update-task tool.
 */
async function mutateTask(id: string, patch: Partial<Task>): Promise<void> {
  const q = await readManagedQueue()
  const t = q.tasks.find((t) => t.id === id)
  if (!t) throw new Error(`No task ${id}`)

  const {
    assignedTo,
    revisionCount,
    retryWindow,
    remediationAttempts,
    handoffStep,
    worktreePath,
    branchName,
    baseBranch,
    notes,
    gateResults,
    reviewVerdicts,
    adjudications,
    escalations,
    agentIssues,
    mergeRecord,
    ...definitionPatch
  } = patch
  Object.assign(t, definitionPatch)

  const updatedAt = patch.updatedAt ?? t.updatedAt ?? '2026-04-01T00:00:00Z'
  const runtimePatch = {
    ...(Object.prototype.hasOwnProperty.call(patch, 'assignedTo') ? { assignedTo } : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, 'revisionCount') ? { revisionCount } : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, 'retryWindow') ? { retryWindow } : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, 'remediationAttempts') ? { remediationAttempts } : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, 'handoffStep') ? { handoffStep } : {}),
  }
  if (Object.keys(runtimePatch).length > 0) {
    await upsertTaskRuntimeState(tmpDir, id, { ...runtimePatch, updatedAt })
  }

  const workspacePatch = {
    ...(Object.prototype.hasOwnProperty.call(patch, 'worktreePath') ? { worktreePath } : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, 'branchName') ? { branchName } : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, 'baseBranch') ? { baseBranch } : {}),
  }
  if (Object.keys(workspacePatch).length > 0) {
    await upsertTaskWorkspaceState(tmpDir, id, { ...workspacePatch, updatedAt })
  }

  const evidence = [
    ...(notes ?? []).map((payload, index) => ({
      id: `note-${id}-${payload.timestamp.replace(/[^0-9A-Za-z]/g, '')}-${index + 1}`,
      kind: 'note' as const,
      recordedAt: payload.timestamp,
      payload,
    })),
    ...(gateResults ?? []).map((payload, index) => ({
      id: `gate-${id}-${payload.checkedAt.replace(/[^0-9A-Za-z]/g, '')}-${index + 1}`,
      kind: 'gate_result' as const,
      recordedAt: payload.checkedAt,
      payload,
    })),
    ...(reviewVerdicts ?? []).map((payload, index) => ({
      id: `review-${id}-${payload.recordedAt.replace(/[^0-9A-Za-z]/g, '')}-${index + 1}`,
      kind: 'review_verdict' as const,
      recordedAt: payload.recordedAt,
      payload,
    })),
    ...(adjudications ?? []).map((payload, index) => ({
      id: `adjudication-${id}-${payload.decidedAt.replace(/[^0-9A-Za-z]/g, '')}-${index + 1}`,
      kind: 'adjudication' as const,
      recordedAt: payload.decidedAt,
      payload,
    })),
    ...(escalations ?? []).map((payload, index) => ({
      id: payload.id || `escalation-${id}-${payload.raisedAt.replace(/[^0-9A-Za-z]/g, '')}-${index + 1}`,
      kind: 'escalation' as const,
      recordedAt: payload.resolvedAt ?? payload.raisedAt,
      payload,
    })),
    ...(agentIssues ?? []).map((payload, index) => ({
      id: payload.id || `issue-${id}-${payload.raisedAt.replace(/[^0-9A-Za-z]/g, '')}-${index + 1}`,
      kind: 'agent_issue' as const,
      recordedAt: payload.resolvedAt ?? payload.raisedAt,
      payload,
    })),
    ...(mergeRecord ? [{
      id: `merge-${id}-${(mergeRecord.mergedAt ?? updatedAt).replace(/[^0-9A-Za-z]/g, '')}`,
      kind: 'merge_record' as const,
      recordedAt: mergeRecord.mergedAt ?? updatedAt,
      payload: mergeRecord,
    }] : []),
  ]
  for (const event of evidence) {
    await appendTaskEvidence(tmpDir, id, event)
  }

  const tmpPath = `${tasksPath}.tmp`
  await fs.writeFile(tmpPath, JSON.stringify(q, null, 2), 'utf-8')
  await fs.rename(tmpPath, tasksPath)
  const managedTasksPath = getProjectSystemStatePath(tmpDir, 'TASKS.json')
  await fs.mkdir(path.dirname(managedTasksPath), { recursive: true })
  await fs.writeFile(managedTasksPath, JSON.stringify(q, null, 2), 'utf-8')
}

interface StubAgent {
  readonly name: string
  calls: { prompt: string }[]
  generate(prompt: string): Promise<{ text: string }>
  resetConversation?(): void
  getToolMetadata?(): Record<string, unknown>
}

/**
 * Build a stub agent that records prompts and optionally fires a side effect
 * (typically a state mutation on TASKS.json) to simulate tool calls.
 */
function stubAgent(
  name: string,
  sideEffect?: (prompt: string) => Promise<void> | void,
  text = 'ok',
): StubAgent {
  const calls: { prompt: string }[] = []
  return {
    name,
    calls,
    async generate(prompt: string) {
      calls.push({ prompt })
      if (sideEffect) await sideEffect(prompt)
      return { text }
    },
  }
}

function agentSet(partial: Partial<OrchestratorAgentSet> = {}): OrchestratorAgentSet {
  return {
    spec: partial.spec ?? stubAgent('spec-agent'),
    worker: partial.worker ?? stubAgent('worker-agent'),
    reviewer: partial.reviewer ?? stubAgent('reviewer-agent'),
    gateChecker: partial.gateChecker ?? stubAgent('gate-checker-agent'),
    coordinators: partial.coordinators ?? {},
  }
}

describe('context debug records', () => {
  it('records meaningful task progress through memory-core system-local storage', async () => {
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet(),
      gitDriver: new InMemoryGitDriver(),
    })
    const task = mkTask({ id: 'task-memory-progress', status: 'review', title: 'Review memory progress' })

    await (orch as any).logTickProgress({
      task,
      agent: 'worker-agent',
      beforeStatus: 'in_progress',
      afterStatus: 'review',
      transitioned: true,
    })

    const events = await readMemoryEvents({
      projectRoot: tmpDir,
      scope: {
        kind: 'task_thread',
        projectId: path.basename(tmpDir),
        taskId: 'task-memory-progress',
        agentRole: 'worker',
        threadId: 'task-memory-progress',
      },
    })
    expect(events).toEqual([
      expect.objectContaining({
        source: expect.objectContaining({
          kind: 'progress',
          ref: 'PROGRESS.md#task-memory-progress',
          path: 'project-state/PROGRESS.md',
        }),
        content: expect.objectContaining({
          summary: expect.stringContaining('Review memory progress'),
        }),
        metadata: expect.objectContaining({
          retention: 'task_lifecycle',
          status: 'review',
          taskId: 'task-memory-progress',
        }),
      }),
    ])
    expect(await fs.readdir(memoryDir)).not.toContain('memory')
  })

  it('writes a context record when dispatching a task', async () => {
    await writeQueue([
      mkTask({
        id: 'task-context',
        status: 'ready',
        acceptanceCriteria: [{
          id: 'ac-1',
          description: 'ship it',
          verifiedBy: 'human',
          met: false,
        } as any],
      }),
    ])
    const worker = stubAgent('worker-agent', async () => {
      await mutateTask('task-context', { status: 'review' })
    })
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
      gitDriver: new InMemoryGitDriver(),
    })

    await orch.tick()
    await orch.tick()

    const ledger = await fs.readFile(getProjectContextDebugLedgerPath(tmpDir), 'utf8')
    const records = ledger
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, any>)
    expect(records.some((record) => record.taskId === 'task-context')).toBe(true)
    expect(records.some((record) => typeof record.promptPreview === 'string' && record.promptPreview.length > 0)).toBe(true)
  })

  it('refreshes the corpus map after a worker changes files', async () => {
    await fs.mkdir(path.join(tmpDir, 'src'), { recursive: true })
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'corpus-refresh-test' }), 'utf8')
    await fs.writeFile(path.join(tmpDir, 'src', 'feature.ts'), 'export const value = 1\n', 'utf8')
    execFileSync('git', ['add', 'package.json', 'src/feature.ts'], { cwd: tmpDir, stdio: 'ignore' })
    execFileSync('git', ['commit', '--no-verify', '-m', 'seed project files'], { cwd: tmpDir, stdio: 'ignore' })

    await writeQueue([
      mkTask({
        id: 'task-corpus-refresh',
        status: 'in_progress',
        assignedTo: 'worker-agent',
        title: 'Update feature value',
        description: 'Edit `src/feature.ts`.',
        spec: 'Update `src/feature.ts` and hand off to review.',
      }),
    ])
    const worker = stubAgent('worker-agent', async () => {
      await fs.writeFile(path.join(tmpDir, 'src', 'feature.ts'), 'export const value = 2\n', 'utf8')
      await mutateTask('task-corpus-refresh', { status: 'review' })
    })
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
      gitDriver: new InMemoryGitDriver(),
    })

    await orch.tick()

    const map = await loadCodebaseMap(memoryDir)
    const history = await fs.readFile(path.join(getProjectLocalHistoryDir(tmpDir), 'codebase-map.history.jsonl'), 'utf8')
    const events = history.trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>)

    expect(map?.files['src/feature.ts']?.summary).toContain('feature.ts')
    expect(events.map((event) => event.reason)).toContain('setup')
    expect(events.map((event) => event.reason)).toContain('worker-completion')
    expect(events.find((event) => event.reason === 'worker-completion')?.changedFiles).toContain('src/feature.ts')
  })
})

describe('pickNextTask', () => {
  it('continues active work before claiming fresh tasks', async () => {
    const q: TaskQueue = {
      version: 1,
      lastUpdated: 'now',
      tasks: [
        mkTask({ id: 't-review', status: 'review' }),
        mkTask({ id: 't-exploring', status: 'exploring' }),
      ],
    }
    expect(pickNextTask(q)?.id).toBe('t-review')
  })

  it('bounds continuous ticks to approved current workspace-goals scope', async () => {
    await writeQueue([
      mkTask({
        id: 'current-parent',
        title: 'Current scoped parent',
        status: 'spec_review',
        priority: 'normal',
        hierarchy: { childIds: ['current-child'], order: 0 },
      }),
      mkTask({
        id: 'current-child',
        title: 'Runnable current child',
        status: 'ready',
        priority: 'normal',
        hierarchy: { parentId: 'current-parent', childIds: [], order: 0 },
      }),
      mkTask({
        id: 'later-critical',
        title: 'Critical later work',
        status: 'ready',
        priority: 'critical',
      }),
    ])
    await fs.writeFile(
      getProjectSystemStatePath(tmpDir, 'workspace-goals.json'),
      JSON.stringify({
        version: 3,
        recordedAt: '2026-07-03T20:10:00.000Z',
        goals: [],
        tasks: [],
        milestones: [],
        context: [],
        approved: {
          goalCount: 0,
          taskCount: 2,
          milestoneCount: 0,
          currentTaskCount: 1,
          laterTaskCount: 1,
          taskIds: ['current-parent', 'later-critical'],
          currentTaskIds: ['current-parent'],
          laterTaskIds: ['later-critical'],
        },
        detected: null,
      }),
      'utf-8',
    )

    const worker = stubAgent('worker-agent', async () => {
      await mutateTask('current-child', { status: 'review' })
    })
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
      gitDriver: new InMemoryGitDriver(),
    })

    const first = await orch.tick()
    expect(first).toMatchObject({
      kind: 'processed',
      taskId: 'current-child',
      agent: 'task-claimer',
      beforeStatus: 'ready',
      afterStatus: 'in_progress',
    })
    expect(worker.calls).toHaveLength(0)

    await orch.tick()

    expect(worker.calls).toHaveLength(1)
    expect(worker.calls[0]?.prompt).toContain('## Current Task: current-child')
    expect(worker.calls[0]?.prompt).not.toContain('## Current Task: later-critical')
    const queue = await readQueue()
    expect(queue.tasks.find(task => task.id === 'current-child')?.status).toBe('review')
    expect(queue.tasks.find(task => task.id === 'later-critical')?.status).toBe('ready')
  })

  it('runs gate checks before sending reviewed work back through other stages', async () => {
    const q: TaskQueue = {
      version: 1,
      lastUpdated: 'now',
      tasks: [
        mkTask({ id: 't-ready', status: 'ready', priority: 'critical' }),
        mkTask({ id: 't-gate', status: 'gate_check', priority: 'low' }),
      ],
    }
    expect(pickNextTask(q)?.id).toBe('t-gate')
  })

  it('dispatches ready audit/research work instead of stranding it on needs_research_spike readiness', async () => {
    const q: TaskQueue = {
      version: 1,
      lastUpdated: 'now',
      tasks: [
        mkTask({
          id: 't-audit',
          title: 'Audit the remaining replacement scope',
          status: 'ready',
          spec: [
            '## What this is',
            'A bounded audit that writes an inventory document.',
            '',
            '## Acceptance Criteria',
            '1. Given the source specs, when the audit is complete, then every remaining spec is listed.',
            '',
            '## Completion Boundary',
            '- Product outcome: The next task knows which implementation target comes first.',
          ].join('\n'),
          acceptanceCriteria: [{
            id: 'ac-1',
            description: 'Every remaining spec is listed.',
            verifiedBy: 'review',
            met: false,
          }],
          taskReadiness: {
            taskKind: 'implementation',
            recommendation: 'needs_research_spike',
            summary: 'Task should run research or a spike before implementation.',
            dimensions: [],
            definitionOfDone: {
              items: ['The audit inventory exists.'],
              evidenceRequired: ['Inventory reviewed against source specs.'],
              updatedAt: '2026-06-17T00:00:00.000Z',
              createdBy: 'test',
            },
            blockerPlans: [],
            contextBudget: {
              estimatedTokens: 100,
              risk: 'low',
              fitsInOneWorkerBrief: true,
              reasons: [],
            },
            assessedAt: '2026-06-17T00:00:00.000Z',
            assessedBy: 'test',
          },
        }),
      ],
    }
    expect(pickNextTask(q)?.id).toBe('t-audit')
  })

  it('does not redispatch exploring tasks that are waiting on unanswered user questions', async () => {
    const q: TaskQueue = {
      version: 1,
      lastUpdated: 'now',
      tasks: [
        mkTask({
          id: 't-exploring',
          status: 'exploring',
          openQuestions: [
            {
              kind: 'text',
              id: 'q1',
              askedBy: 'spec-agent',
              askedAt: '2026-04-01T00:00:00Z',
              prompt: 'Which scenario matters most?',
            },
          ],
        }),
        mkTask({ id: 't-ready', status: 'ready' }),
      ],
    }
    expect(pickNextTask(q)?.id).toBe('t-ready')
  })

  it('does not treat operational receipts as unanswered user questions', async () => {
    const q: TaskQueue = {
      version: 1,
      lastUpdated: 'now',
      tasks: [
        mkTask({
          id: 't-exploring',
          status: 'exploring',
          openQuestions: [
            {
              kind: 'choice',
              id: 'q-receipt',
              askedBy: 'spec-agent',
              askedAt: '2026-04-01T00:00:00Z',
              prompt: 'Done — I took the durable blueprint steps:',
              selectionMode: 'single',
              choices: [
                'Updated the product brief',
                'Revised and strengthened the spec',
                'Set task status to `spec_review`',
                'Appended this turn to the exploring transcript',
                'Logged a milestone in `PROGRESS.md`',
              ],
            },
          ],
        }),
      ],
    }
    expect(pickNextTask(q)?.id).toBe('t-exploring')
  })

  it('does not treat output-promise choices as unanswered user questions', async () => {
    const q: TaskQueue = {
      version: 1,
      lastUpdated: 'now',
      tasks: [
        mkTask({
          id: 't-exploring',
          status: 'exploring',
          openQuestions: [
            {
              kind: 'choice',
              id: 'q-promise',
              askedBy: 'spec-agent',
              askedAt: '2026-05-23T00:00:00Z',
              prompt: 'Next, pick the output path:',
              selectionMode: 'single',
              choices: [
                'I will draft the blueprint',
                'I will update the product brief',
                'I will persist progress with tools',
              ],
            },
          ],
        }),
      ],
    }
    expect(pickNextTask(q)?.id).toBe('t-exploring')
  })

  it('does not treat persisted-progress receipts as unanswered user questions', async () => {
    const q: TaskQueue = {
      version: 1,
      lastUpdated: 'now',
      tasks: [
        mkTask({
          id: 't-exploring',
          status: 'exploring',
          openQuestions: [
            {
              kind: 'choice',
              id: 'q-progress-receipt',
              askedBy: 'spec-agent',
              askedAt: '2026-05-23T00:00:00Z',
              prompt: "I've now persisted progress with tools in this turn:",
              selectionMode: 'single',
              choices: [
                'Appended the exploring message to the transcript',
                'Read back the transcript to confirm it persisted',
                'Logged the current progress state',
              ],
            },
          ],
        }),
      ],
    }
    expect(pickNextTask(q)?.id).toBe('t-exploring')
  })

  it('does not treat output-menu promises as unanswered user questions', async () => {
    const q: TaskQueue = {
      version: 1,
      lastUpdated: 'now',
      tasks: [
        mkTask({
          id: 't-exploring',
          status: 'exploring',
          openQuestions: [
            {
              kind: 'choice',
              id: 'q-output-menu',
              askedBy: 'spec-agent',
              askedAt: '2026-05-23T00:00:00Z',
              prompt: "If you pick one, I'll immediately produce:",
              selectionMode: 'single',
              choices: [
                'Full spec',
                'Product brief',
                'Move task to spec_review',
              ],
            },
          ],
        }),
      ],
    }
    expect(pickNextTask(q)?.id).toBe('t-exploring')
  })

  it('keeps real owner-choice prompts visible even when they mention drafting and updating', async () => {
    const q: TaskQueue = {
      version: 1,
      lastUpdated: 'now',
      tasks: [
        mkTask({
          id: 't-exploring',
          status: 'exploring',
          openQuestions: [
            {
              kind: 'choice',
              id: 'q-real-choice',
              askedBy: 'spec-agent',
              askedAt: '2026-05-23T00:00:00Z',
              prompt: 'I can update the existing spec or draft a new one. Which should I do?',
              selectionMode: 'single',
              choices: [
                'Update the existing spec',
                'Draft a new spec',
              ],
            },
          ],
        }),
        mkTask({ id: 't-ready', status: 'ready' }),
      ],
    }
    expect(pickNextTask(q)?.id).toBe('t-ready')
  })

  it('keeps real payment model owner decisions visible', async () => {
    const q: TaskQueue = {
      version: 1,
      lastUpdated: 'now',
      tasks: [
        mkTask({
          id: 't-exploring',
          status: 'exploring',
          openQuestions: [
            {
              kind: 'choice',
              id: 'q-payment-model',
              askedBy: 'spec-agent',
              askedAt: '2026-05-23T00:00:00Z',
              prompt: 'Which Stripe payment model should v1 use?',
              selectionMode: 'single',
              choices: [
                'One-time checkout',
                'Recurring subscriptions',
              ],
            },
          ],
        }),
        mkTask({ id: 't-ready', status: 'ready' }),
      ],
    }
    expect(pickNextTask(q)?.id).toBe('t-ready')
  })

  it('prioritizes higher priority within the same status', async () => {
    const q: TaskQueue = {
      version: 1,
      lastUpdated: 'now',
      tasks: [
        mkTask({ id: 't-low', status: 'in_progress', priority: 'low' }),
        mkTask({ id: 't-crit', status: 'in_progress', priority: 'critical' }),
      ],
    }
    expect(pickNextTask(q)?.id).toBe('t-crit')
  })

  it('skips tasks whose dependencies are not done', async () => {
    const q: TaskQueue = {
      version: 1,
      lastUpdated: 'now',
      tasks: [
        mkTask({ id: 'parent', status: 'ready', priority: 'normal' }),
        mkTask({
          id: 'child',
          status: 'ready',
          priority: 'critical',
          dependsOn: ['parent'],
        }),
      ],
    }
    expect(pickNextTask(q)?.id).toBe('parent')
  })

  it('allows dependent tasks once every dependency is done', async () => {
    const q: TaskQueue = {
      version: 1,
      lastUpdated: 'now',
      tasks: [
        mkTask({ id: 'parent', status: 'done' }),
        mkTask({
          id: 'child',
          status: 'ready',
          priority: 'critical',
          dependsOn: ['parent'],
        }),
      ],
    }
    expect(pickNextTask(q)?.id).toBe('child')
  })

  it('filters by domain when provided', async () => {
    const q: TaskQueue = {
      version: 1,
      lastUpdated: 'now',
      tasks: [
        mkTask({ id: 't-looma', status: 'exploring', domain: 'looma' }),
        mkTask({ id: 't-knit', status: 'exploring', domain: 'knit' }),
      ],
    }
    expect(pickNextTask(q, 'knit')?.id).toBe('t-knit')
  })

  it('dispatches drafted spec_review tasks for normal coordinator approval work', async () => {
    const q: TaskQueue = {
      version: 1,
      lastUpdated: 'now',
      tasks: [
        mkTask({ id: 't-spec', status: 'spec_review', spec: 'draft spec' }),
        mkTask({ id: 't-ready', status: 'ready' }),
      ],
    }
    expect(pickNextTask(q)?.id).toBe('t-spec')
  })

  it('still holds reserved bootstrap/import drafts for manual approval', async () => {
    const q: TaskQueue = {
      version: 1,
      lastUpdated: 'now',
      tasks: [
        mkTask({ id: 'task-meta-intake', domain: '_meta', status: 'spec_review', spec: 'draft spec' }),
        mkTask({ id: 'task-workspace-import', domain: '_workspace_import', status: 'spec_review', spec: 'draft spec' }),
        mkTask({ id: 't-ready', status: 'ready' }),
      ],
    }
    expect(pickNextTask(q)?.id).toBe('t-ready')
  })

  it('skips spec-review tasks that are still waiting on a user answer', async () => {
    const q: TaskQueue = {
      version: 1,
      lastUpdated: 'now',
      tasks: [
        mkTask({
          id: 'task-workspace-import',
          domain: '_workspace_import',
          status: 'spec_review',
          openQuestions: [
            {
              id: 'q1',
              askedBy: 'spec-agent',
              askedAt: 'now',
              kind: 'choice',
              prompt: 'Should auth be treated as partially done or not done?',
              choices: ['Partially done', 'Not done'],
            },
          ],
        }),
        mkTask({ id: 't-ready', status: 'ready' }),
      ],
    }
    expect(pickNextTask(q)?.id).toBe('t-ready')
  })

  it('returns undefined when all tasks are terminal', async () => {
    const q: TaskQueue = {
      version: 1,
      lastUpdated: 'now',
      tasks: [
        mkTask({ id: 'a', status: 'done' }),
        mkTask({ id: 'b', status: 'blocked' }),
      ],
    }
    expect(pickNextTask(q)).toBeUndefined()
  })
})

describe('shouldResumeAgentSession', () => {
  it('does not resume a worker session when the task is no longer assigned to the worker', () => {
    const queue = queueOf([
      mkTask({ status: 'review' }),
    ])
    expect(shouldResumeAgentSession('worker', queue)).toBe(false)
  })

  it('resumes a worker session only for an in_progress task assigned to worker-agent', () => {
    const queue = queueOf([
      mkTask({ status: 'in_progress', assignedTo: 'worker-agent' }),
    ])
    expect(shouldResumeAgentSession('worker', queue)).toBe(true)
  })

  it('does not resume a reviewer session for unassigned review tasks', () => {
    const queue = queueOf([
      mkTask({ status: 'review' }),
    ])
    expect(shouldResumeAgentSession('reviewer', queue)).toBe(false)
  })

  it('resumes a spec session for active exploring work', () => {
    const queue = queueOf([
      mkTask({ status: 'exploring' }),
    ])
    expect(shouldResumeAgentSession('spec', queue)).toBe(true)
  })

  it('resumes a domain coordinator session only for matching domain review-prep work', () => {
    const queue = queueOf([
      mkTask({ domain: 'knit', status: 'spec_review', spec: 'draft' }),
      mkTask({ domain: 'looma', status: 'spec_review', spec: 'draft' }),
    ])
    expect(shouldResumeAgentSession('coordinator-knit', queue)).toBe(true)
    expect(shouldResumeAgentSession('coordinator-auth', queue)).toBe(false)
  })
})

describe('isSessionSnapshotFreshForTask', () => {
  it('rejects snapshots whose task id does not match the current task', () => {
    const task = mkTask({ id: 'task-009', updatedAt: '2026-05-03T16:15:45.000Z' })
    const snapshot = {
      created_at: Date.parse('2026-05-03T16:15:50.000Z') / 1000,
      tool_metadata: { current_task_id: 'task-008' },
    }
    expect(isSessionSnapshotFreshForTask(snapshot as never, task)).toBe(false)
  })

  it('rejects snapshots older than the current task state', () => {
    const task = mkTask({ id: 'task-009', updatedAt: '2026-05-03T16:15:45.000Z' })
    const snapshot = {
      created_at: Date.parse('2026-05-03T16:15:40.000Z') / 1000,
      tool_metadata: { current_task_id: 'task-009' },
    }
    expect(isSessionSnapshotFreshForTask(snapshot as never, task)).toBe(false)
  })

  it('accepts snapshots for the same task when they are at least as new as the task state', () => {
    const task = mkTask({ id: 'task-009', updatedAt: '2026-05-03T16:15:45.000Z' })
    const snapshot = {
      created_at: Date.parse('2026-05-03T16:15:45.000Z') / 1000,
      tool_metadata: { current_task_id: 'task-009' },
    }
    expect(isSessionSnapshotFreshForTask(snapshot as never, task)).toBe(true)
  })

  it('rejects snapshots when the effective gate list has changed', () => {
    const task = mkTask({ id: 'task-009', updatedAt: '2026-05-03T16:15:45.000Z' })
    const snapshot = {
      created_at: Date.parse('2026-05-03T16:15:50.000Z') / 1000,
      tool_metadata: {
        current_task_id: 'task-009',
        current_task_project_path: '/workspace/knit',
        current_task_success_gates: ['pnpm --dir web test -- --run login-callback-index.flow.test.ts'],
      },
    }
    expect(
      isSessionSnapshotFreshForTask(snapshot as never, task, {
        expectedTaskProjectPath: '/workspace/knit',
        expectedSuccessGates: [
          'pnpm --dir web vitest --run tests/unit/pages/login-callback-index.flow.test.ts',
        ],
      }),
    ).toBe(false)
  })
})

describe('Orchestrator.tick — idle handling', () => {
  it('reports idle + allDone=true when every task is terminal', async () => {
    await writeQueue([
      mkTask({ id: 'a', status: 'done' }),
      mkTask({ id: 'b', status: 'blocked' }),
    ])
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    const out = await orch.tick()
    expect(out.kind).toBe('idle')
    if (out.kind === 'idle') {
      expect(out.allDone).toBe(true)
      expect(out.consecutiveIdleTicks).toBe(1)
      expect(out.summary).toMatchObject({
        reason: 'all_terminal',
        counts: {
          done: 1,
          blocked: 1,
        },
      })
    }
  })

  it('increments consecutiveIdleTicks across consecutive empty ticks', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'done' })])
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    await orch.tick()
    const out = await orch.tick()
    expect(out.kind).toBe('idle')
    if (out.kind === 'idle') expect(out.consecutiveIdleTicks).toBe(2)
  })

  it('reconciles active queue rows to done when durable merge evidence already exists', async () => {
    await writeQueue([
      mkTask({
        id: 'already-landed',
        status: 'in_progress',
        assignedTo: 'worker-agent',
        escalations: [{
          id: 'esc-already-landed',
          taskId: 'already-landed',
          agentId: 'worker-agent',
          reason: 'human_judgment_required',
          summary: 'Stale escalation after provider timeout.',
          details: 'Should not survive durable merge evidence.',
          raisedAt: '2026-04-01T00:10:00.000Z',
          raisedBy: 'worker-agent',
        }],
      }),
    ])
    await appendTaskEvidence(tmpDir, 'already-landed', {
      id: 'merge-already-landed',
      taskId: 'already-landed',
      kind: 'merge_record',
      recordedAt: '2026-04-01T00:20:00.000Z',
      payload: {
        fromBranch: 'guildhall/task-already-landed',
        toBranch: 'main',
        strategy: 'cherry_pick_local',
        result: 'merged',
        mergedAt: '2026-04-01T00:20:00.000Z',
        commitSha: 'abc123',
      },
    })

    const worker = stubAgent('worker-agent')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
    })

    const out = await orch.tick()
    expect(out.kind).toBe('idle')
    expect(worker.calls).toHaveLength(0)
    const task = await readEffectiveTaskFromQueue('already-landed')
    expect(task?.status).toBe('done')
    expect(task?.assignedTo).toBeNull()
    expect(task?.completedAt).toBe('2026-04-01T00:20:00.000Z')
    expect(task?.escalations.every(escalation => escalation.resolvedAt)).toBe(true)
    expect(task?.notes.some(note => note.content.includes('durable merge evidence'))).toBe(true)
  })

  it('reports broader documented work when the current task scope is exhausted but later scope remains', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'done' })])
    await fs.writeFile(
      getProjectSystemStatePath(tmpDir, 'workspace-goals.json'),
      JSON.stringify({
        version: 3,
        recordedAt: '2026-06-18T12:00:00.000Z',
        goals: [],
        tasks: [
          {
            id: 'a',
            title: 'Current harness slice',
            description: 'Current scope.',
            domain: 'harness',
            priority: 'normal',
            references: ['docs/harness/implementation-roadmap.md'],
          },
        ],
        milestones: [],
        context: [
          {
            label: 'Mastra workflow for the prototype iteration loop',
            excerpt: 'Later-stage capability.',
            source: 'planning-docs',
            references: ['docs/harness/implementation-roadmap.md'],
            role: 'capability',
            scopeHint: 'later',
          },
          {
            label: 'provider/model registry schema',
            excerpt: 'Later-stage capability.',
            source: 'planning-docs',
            references: ['docs/harness/implementation-roadmap.md'],
            role: 'capability',
            scopeHint: 'later',
          },
        ],
        approved: {
          goalCount: 0,
          taskCount: 1,
          milestoneCount: 0,
          currentTaskCount: 1,
          laterTaskCount: 0,
          taskIds: ['a'],
          currentTaskIds: ['a'],
          laterTaskIds: [],
        },
        detected: {
          goalCount: 0,
          taskCount: 2,
          milestoneCount: 0,
          currentTaskCount: 1,
          laterTaskCount: 1,
          taskIds: ['a', 'task-later'],
          currentTaskIds: ['a'],
          laterTaskIds: ['task-later'],
        },
      }, null, 2),
      'utf-8',
    )

    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    const out = await orch.tick()
    expect(out.kind).toBe('idle')
    if (out.kind === 'idle') {
      expect(out.allDone).toBe(true)
      expect(out.summary?.reason).toBe('all_terminal')
      expect(out.summary?.message).toContain('Current task scope is exhausted')
      expect(out.summary?.message).toContain('2 later documented capabilities')
      expect(out.summary?.message).toContain('1 additional detected task not yet in the approved scope')
    }
  })

  it('resets the idle counter when a task is processed', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'done' })])
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    await orch.tick() // idle
    // Now add an actionable task
    await writeQueue([
      mkTask({ id: 'a', status: 'done' }),
      mkTask({ id: 'b', status: 'in_progress' }),
    ])
    await orch.tick() // processed
    // Drain b so next tick is idle again
    await writeQueue([
      mkTask({ id: 'a', status: 'done' }),
      mkTask({ id: 'b', status: 'done' }),
    ])
    const out = await orch.tick()
    expect(out.kind).toBe('idle')
    if (out.kind === 'idle') expect(out.consecutiveIdleTicks).toBe(1)
  })

  it('returns an awaiting-human stop summary when the queue is only waiting on user input', async () => {
    await writeQueue([
      mkTask({
        id: 'a',
        status: 'exploring',
      }),
    ])
    await seedTaskOwnerInput({
      taskId: 'a',
      prompt: 'Clarify the target flow',
    })
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet(),
      idleShutdownAfterTicks: 0,
    })
    const result = await orch.run({ maxTicks: 2, tickDelayMs: 0 })
    expect(result).toMatchObject({
      stopReason: 'awaiting_human',
    })
    expect(result.stopMessage).toMatch(/waiting on user answers/i)
    expect(result.idleSummary?.counts.waitingOnUser).toBe(1)
  })

  it('returns an awaiting-human stop summary when the queue is only import drafts waiting for review', async () => {
    await writeQueue([
      mkTask({
        id: 'draft-1',
        status: 'import_draft',
        title: 'Review imported draft',
      }),
    ])
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet(),
      idleShutdownAfterTicks: 0,
    })
    const result = await orch.run({ maxTicks: 2, tickDelayMs: 0 })
    expect(result).toMatchObject({
      stopReason: 'awaiting_human',
    })
    expect(result.stopMessage).toMatch(/draft task\(s\) waiting for review/i)
    expect(result.idleSummary?.counts.draftReview).toBe(1)
  })
})

describe('Orchestrator.tick — bootstrap precondition', () => {
  it('refuses to dispatch when bootstrap has install/gates but no verifiedAt', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'in_progress' })])
    const worker = stubAgent('worker-agent')
    const cfg = baseConfig({
      bootstrap: {
        commands: [],
        successGates: [],
        timeoutMs: 300_000,
        packageManager: 'pnpm',
        install: { command: 'pnpm install', status: 'ok' },
        gates: {
          lint: { command: 'pnpm lint', available: true },
        },
      },
    })
    const orch = new Orchestrator({ config: cfg, agents: agentSet({ worker }) })
    const out = await orch.tick()
    expect(out.kind).toBe('bootstrap-required')
    if (out.kind === 'bootstrap-required') {
      expect(out.reason).toBe('bootstrap_required')
      expect(out.pendingTaskCount).toBe(1)
    }
    expect(worker.calls).toHaveLength(0)
  })

  it('emits bootstrap_failed when last install failed', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'in_progress' })])
    const worker = stubAgent('worker-agent')
    const cfg = baseConfig({
      bootstrap: {
        commands: [],
        successGates: [],
        timeoutMs: 300_000,
        verifiedAt: '2026-04-23T00:00:00Z',
        packageManager: 'pnpm',
        install: { command: 'pnpm install', status: 'failed' },
        gates: { lint: { command: 'pnpm lint', available: true } },
      },
    })
    const orch = new Orchestrator({ config: cfg, agents: agentSet({ worker }) })
    const out = await orch.tick()
    expect(out.kind).toBe('bootstrap-required')
    if (out.kind === 'bootstrap-required') expect(out.reason).toBe('bootstrap_failed')
    expect(worker.calls).toHaveLength(0)
  })

  it('dispatches normally when bootstrap.verifiedAt is present and install is ok', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'in_progress' })])
    const worker = stubAgent('worker-agent')
    const cfg = baseConfig({
      bootstrap: {
        commands: [],
        successGates: [],
        timeoutMs: 300_000,
        verifiedAt: '2026-04-23T00:00:00Z',
        packageManager: 'pnpm',
        install: { command: 'pnpm install', status: 'ok' },
        gates: { lint: { command: 'pnpm lint', available: true } },
      },
    })
    const orch = new Orchestrator({ config: cfg, agents: agentSet({ worker }) })
    const out = await orch.tick()
    expect(out.kind).toBe('processed')
    expect(worker.calls).toHaveLength(1)
  })

  it('dispatches normally when there is no bootstrap block at all (legacy)', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'in_progress' })])
    const worker = stubAgent('worker-agent')
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet({ worker }) })
    const out = await orch.tick()
    expect(out.kind).toBe('processed')
    expect(worker.calls).toHaveLength(1)
  })
})

describe('Orchestrator.tick — routing', () => {
  it('routes exploring tasks to the spec agent', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'exploring' })])
    const spec = stubAgent('spec-agent')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ spec }),
    })
    const out = await orch.tick()
    expect(out.kind).toBe('processed')
    if (out.kind === 'processed') {
      expect(out.agent).toBe('spec-agent')
      expect(out.beforeStatus).toBe('exploring')
    }
    expect(spec.calls).toHaveLength(1)
  })

  it('escalates exploring tasks after repeated spec-agent no-change passes', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'exploring' })])
    const spec = stubAgent('spec-agent', undefined, '')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ spec }),
    })

    const first = await orch.tick()
    const second = await orch.tick()
    const third = await orch.tick()

    expect(first.kind).toBe('processed')
    expect(second.kind).toBe('processed')
    expect(third.kind).toBe('escalated')

    const queue = await readQueue()
    const task = queue.tasks[0]!
    expect(task.status).toBe('blocked')
    expect(task.blockReason).toMatch(/no visible progress/i)
    expect(task.escalations).toHaveLength(1)
    expect(task.escalations[0]!.reason).toBe('human_judgment_required')
  })

  it('escalates immediately when the spec agent ignores the durable-progress nudge', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'exploring', title: 'Build AlertDialog primitive' })])
    const spec = {
      name: 'spec-agent',
      calls: [] as { prompt: string }[],
      async generate(prompt: string) {
        this.calls.push({ prompt })
        return { text: '' }
      },
      async generateWithEvents(prompt: string, onEvent: (event: any) => void | Promise<void>) {
        this.calls.push({ prompt })
        await onEvent({
          type: 'status',
          message:
            'Assistant kept retrying read-only exploration after repeated intake-budget refusals; ending the turn so the orchestrator can treat this as no progress.',
        })
        return { text: '' }
      },
    }
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ spec }),
    })

    const out = await orch.tick()

    expect(out.kind).toBe('escalated')
    if (out.kind === 'escalated') expect(out.reason).toContain('kept researching')
    const queue = await readQueue()
    const task = queue.tasks[0]!
    expect(task.status).toBe('blocked')
    expect(task.blockReason).toContain('Spec agent kept researching')
    expect(task.escalations[0]?.details).toContain('durable-progress nudge')
  })

  it('treats the live durable-progress refusal wording as spec-agent no-progress', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'exploring', title: 'Build AlertDialog primitive' })])
    const spec = {
      name: 'spec-agent',
      calls: [] as { prompt: string }[],
      async generate(prompt: string) {
        this.calls.push({ prompt })
        return { text: '' }
      },
      async generateWithEvents(prompt: string, onEvent: (event: any) => void | Promise<void>) {
        this.calls.push({ prompt })
        await onEvent({
          type: 'status',
          message:
            'Assistant kept researching after an explicit durable-progress nudge; refusing more read-only tool calls for this turn.',
        })
        return { text: '' }
      },
    }
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ spec }),
    })

    const out = await orch.tick()

    expect(out.kind).toBe('escalated')
    const queue = await readQueue()
    const task = queue.tasks[0]!
    expect(task.status).toBe('blocked')
    expect(task.blockReason).toContain('Spec agent kept researching')
  })

  it('recovers the live durable-progress spec-agent blocker on resume', async () => {
    await writeQueue([
      mkTask({
        id: 'a',
        status: 'blocked',
        title: 'Build AlertDialog primitive',
        blockReason: 'human_judgment_required: Spec agent kept researching after Guildhall asked for durable progress.',
        escalations: [{
          id: 'esc-a-1',
          taskId: 'a',
          agentId: 'spec-agent',
          reason: 'human_judgment_required',
          summary: 'Spec agent kept researching after Guildhall asked for durable progress.',
          details: 'Task remained in exploring after the agent ignored the durable-progress nudge and kept using read-only exploration.',
          raisedAt: '2026-07-04T14:37:04.468Z',
        }],
      }),
    ])
    const spec = stubAgent('spec-agent', async () => {
      await mutateTask('a', {
        status: 'spec_review',
        assignedTo: null,
        spec: VALID_SPEC,
        acceptanceCriteria: [{
          id: 'ac-1',
          description: 'Thing is done',
          verifiedBy: 'review',
          met: false,
        }],
        productBrief: {
          userJob: 'I want the task shaped into implementable work.',
          successMetric: 'The task has a reviewable spec.',
          antiPatterns: ['Do not loop on read-only research.'],
        },
      })
    })
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ spec }),
    })

    const out = await orch.tick()

    expect(out).toMatchObject({
      kind: 'processed',
      agent: 'coordinator-recovery',
      beforeStatus: 'exploring',
      afterStatus: 'spec_review',
      transitioned: true,
    })
    expect(spec.calls).toHaveLength(0)
    const queue = await readQueue()
    const task = queue.tasks[0]!
    expect(task.status).toBe('spec_review')
    expect(task.blockReason).toBeUndefined()
    expect(task.notes.some(note =>
      /failed to save a durable draft|preserved transcript notes/i.test(note.content ?? ''),
    )).toBe(true)
    expect(task.escalations[0]).toMatchObject({
      resolvedBy: 'system',
    })
  })

  it('recovers generated internal split durable-progress blockers even without an escalation record', async () => {
    await writeQueue([
      mkTask({
        id: 'a',
        status: 'blocked',
        title: 'Define fixture contracts',
        blockReason: 'human_judgment_required: Spec agent kept researching after Guildhall asked for durable progress.',
        origination: 'system',
        proposedBy: 'task-sizing',
        workVisibility: { kind: 'internal_step', countInProjectTotals: false },
        hierarchy: { parentId: 'parent', childIds: [], order: 0, relation: 'decomposes' },
      }),
      mkTask({
        id: 'parent',
        status: 'ready',
        title: 'Define fixture schemas',
        hierarchy: { childIds: ['a'], order: 0, relation: 'contains' },
      }),
    ])
    const spec = stubAgent('spec-agent', async () => {
      await mutateTask('a', {
        status: 'spec_review',
        assignedTo: null,
        spec: VALID_SPEC,
        acceptanceCriteria: [{
          id: 'ac-1',
          description: 'Thing is done',
          verifiedBy: 'review',
          met: false,
        }],
      })
    })
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ spec }),
    })

    const out = await orch.tick()

    expect(out).toMatchObject({
      kind: 'processed',
      agent: 'coordinator-recovery',
      beforeStatus: 'exploring',
      afterStatus: 'spec_review',
      transitioned: true,
    })
    expect(spec.calls).toHaveLength(0)
    const queue = await readQueue()
    const task = queue.tasks.find(candidate => candidate.id === 'a')!
    expect(task.status).toBe('spec_review')
    expect(task.blockReason).toBeUndefined()
  })

  it('treats the live durable-progress nudge wording as spec-agent no-progress', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'exploring', title: 'Build AlertDialog primitive' })])
    const spec = {
      name: 'spec-agent',
      calls: [] as { prompt: string }[],
      async generate(prompt: string) {
        this.calls.push({ prompt })
        return { text: '' }
      },
      async generateWithEvents(prompt: string, onEvent: (event: any) => void | Promise<void>) {
        this.calls.push({ prompt })
        await onEvent({
          type: 'status',
          message:
            'Assistant kept researching without recording durable progress; asking it to write the brief, question, spec, or escalation now.',
        })
        return { text: '' }
      },
    }
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ spec }),
    })

    const out = await orch.tick()

    expect(out.kind).toBe('escalated')
    const queue = await readQueue()
    const task = queue.tasks[0]!
    expect(task.status).toBe('blocked')
    expect(task.blockReason).toContain('Spec agent kept researching')
  })

  it('persists a visible question from the whole spec turn before escalating durable-progress nudges', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'exploring', title: 'Verify and update the migration record' })])
    const spec = {
      name: 'spec-agent',
      calls: [] as { prompt: string }[],
      async generate(prompt: string) {
        this.calls.push({ prompt })
        return { text: '' }
      },
      async generateWithEvents(prompt: string, onEvent: (event: any) => void | Promise<void>) {
        this.calls.push({ prompt })
        await onEvent({
          type: 'status',
          message:
            'Assistant kept researching without recording durable progress; asking it to write the brief, question, spec, or escalation now.',
        })
        return {
          text: '',
          messages: [
            {
              role: 'assistant',
              content: [{
                type: 'text',
                text: [
                  'The question is: what exactly should this task do now that both dependencies are done?',
                  '- (A) Create the inventory document that was supposed to exist, then verify it',
                  '- (B) Verify that the first replacement was correctly implemented and update the task tracking',
                  '- (C) Both — create the missing inventory AND verify the implementation',
                ].join('\n'),
              }],
            },
            {
              role: 'assistant',
              content: [{
                type: 'text',
                text: 'I already posted my question in the previous turn. The user has not answered yet.',
              }],
            },
          ],
        }
      },
    }
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ spec }),
    })

    const out = await orch.tick()

    expect(out.kind).toBe('processed')
    const queue = await readQueue()
    const task = queue.tasks[0]!
    expect(task.status).toBe('exploring')
    expect(task.blockReason).toBeUndefined()
    expect(task.openQuestions).toHaveLength(1)
    expect(task.openQuestions?.[0]).toMatchObject({
      kind: 'choice',
      prompt: 'What exactly should this task do now that both dependencies are done?',
      choices: [
        'Create the inventory document that was supposed to exist, then verify it',
        'Verify that the first replacement was correctly implemented and update the task tracking',
        'Both — create the missing inventory AND verify the implementation',
      ],
    })
  })

  it('does not turn evidence-summary bullets into owner-input choices', async () => {
    await writeQueue([mkTask({
      id: 'a',
      status: 'exploring',
      title: 'Define fixture, expected-record, prototype-run, and evaluation contracts',
    })])
    const spec = stubAgent(
      'spec-agent',
      undefined,
      [
        'Now I have the full picture. This is a Docusaurus documentation site.',
        '',
        'The existing schemas already have:',
        '- `src/schemas/fixture.ts` — `FixtureManifest`, `ExpectedRecordSet`',
        '- `src/schemas/evaluation.ts` — `PrototypeRun`, `RunEvaluation`',
        '- `src/schemas/index.ts` — barrel export',
        '',
        'Let me now write the product brief and draft the spec.',
      ].join('\n'),
    )
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ spec }),
    })

    const out = await orch.tick()

    expect(out.kind).toBe('processed')
    const queue = await readQueue()
    const task = queue.tasks[0]!
    expect(task.openQuestions ?? []).toHaveLength(0)
    expect(task.status).toBe('exploring')
    expect(task.blockReason).toBeUndefined()
  })


  it('does not count transcript-only intake narration as spec progress', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'exploring' })])
    const spec = stubAgent(
      'spec-agent',
      undefined,
      'I have the answers now and will write the product brief and full spec next.',
    )
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ spec }),
    })

    const first = await orch.tick()
    const second = await orch.tick()
    const third = await orch.tick()

    expect(first.kind).toBe('processed')
    expect(second.kind).toBe('processed')
    expect(third.kind).toBe('escalated')

    const queue = await readQueue()
    const task = queue.tasks[0]!
    expect(task.status).toBe('blocked')
    expect(task.blockReason).toMatch(/no visible progress/i)
    expect(task.productBrief).toBeUndefined()
    expect(task.spec).toBeUndefined()
  })

  it('persists plain-text spec-agent questions to transcript and openQuestions', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'exploring' })])
    const spec = stubAgent(
      'spec-agent',
      undefined,
      'Pick one: should this cover only the happy path, or error cases too?',
    )
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ spec }),
    })

    const out = await orch.tick()
    expect(out.kind).toBe('processed')

    const queue = await readQueue()
    const task = queue.tasks[0]!
    expect(task.status).toBe('exploring')
    expect(task.openQuestions).toHaveLength(1)
    expect(task.openQuestions?.[0]?.kind).toBe('choice')
    expect(task.openQuestions?.[0] && 'prompt' in task.openQuestions[0] ? task.openQuestions[0].prompt : '').toContain('Pick one')

    const transcript = await fs.readFile(
      getProjectTranscriptPath(tmpDir, 'exploring', 'a'),
      'utf-8',
    )
    expect(transcript).toContain('Pick one: should this cover only the happy path')
  })

  it('authors a fallback product brief from spec-agent plain text when none exists yet', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'exploring', title: 'Preserve last assistant text' })])
    const spec = stubAgent(
      'spec-agent',
      undefined,
      [
        'Got it.',
        '',
        '### My best guess for this task',
        'You want to preserve the last meaningful assistant text across tool-only turns so recovery paths keep the right context.',
        '',
        'Pick one: should this be test-only, or behavior + test?',
      ].join('\n'),
    )
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ spec }),
    })

    const out = await orch.tick()
    expect(out.kind).toBe('processed')

    const queue = await readQueue()
    const task = queue.tasks[0]!
    expect(task.productBrief).toMatchObject({
      userJob:
        'You want to preserve the last meaningful assistant text across tool-only turns so recovery paths keep the right context.',
      successMetric: 'Thread shows a drafted brief and actionable next step for "Preserve last assistant text".',
      authoredBy: 'spec-agent',
    })
  })

  it('prefers the pre-nudge assistant question when later recovery prose would otherwise hide it', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'exploring' })])
    const calls: { prompt: string }[] = []
    const spec: StubAgent = {
      name: 'spec-agent',
      calls,
      async generate(prompt: string) {
        calls.push({ prompt })
        return {
          text: "Understood. I'm blocked on tool-schema details and will inspect them next.",
          messages: [
            { role: 'user', content: [{ type: 'text', text: prompt }] },
            {
              role: 'assistant',
              content: [{ type: 'text', text: 'Pick one: happy path only, or error cases too?' }],
            },
            {
              role: 'user',
              content: [{
                type: 'text',
                text: 'Your last response did not use a tool, so Guildhall could not turn it into durable spec progress.',
              }],
            },
            {
              role: 'assistant',
              content: [{
                type: 'text',
                text: "Understood. I'm blocked on tool-schema details and will inspect them next.",
              }],
            },
          ],
        }
      },
    }
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ spec }),
    })

    const out = await orch.tick()
    expect(out.kind).toBe('processed')

    const queue = await readQueue()
    const task = queue.tasks[0]!
    expect(task.openQuestions).toHaveLength(1)
    expect(task.openQuestions?.[0]?.kind).toBe('choice')
    expect(task.openQuestions?.[0] && 'prompt' in task.openQuestions[0] ? task.openQuestions[0].prompt : '').toBe('Pick one')
    expect(task.openQuestions?.[0]).toMatchObject({
      choices: ['happy path only', 'error cases too'],
      selectionMode: 'single',
    })

    const transcript = await fs.readFile(getProjectTranscriptPath(tmpDir, 'exploring', 'a'), 'utf-8')
    expect(transcript).toContain('Pick one: happy path only, or error cases too?')
    expect(transcript).not.toContain("I'm blocked on tool-schema details")
  })

  it('splits numbered plain-text spec questions into multiple structured choice cards', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'exploring' })])
    const spec = stubAgent(
      'spec-agent',
      undefined,
      [
        'Pick one option for each:',
        '',
        '1) **Primary scenario to spec**',
        '- A) Validation failure',
        '- B) Empty assistant message',
        '- C) Any of the above',
        '',
        '2) **What the fallback must do**',
        '- A) Post one structured choice question, then stop turn',
        '- B) Post structured question + transcript entry + stop turn',
        '',
        '3) **Out-of-scope guardrails**',
        '- A) Don’t redesign the task state machine',
        '- B) Don’t add new question kinds',
        '- C) Don’t change Looma code',
      ].join('\n'),
    )
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ spec }),
    })

    const out = await orch.tick()
    expect(out.kind).toBe('processed')

    const queue = await readQueue()
    const task = queue.tasks[0]!
    expect(task.openQuestions).toHaveLength(3)
    expect(task.openQuestions?.map((q) => q.kind)).toEqual(['choice', 'choice', 'choice'])
    expect(task.openQuestions?.[0]).toMatchObject({
      prompt: 'Primary scenario to spec',
      choices: ['Validation failure', 'Empty assistant message', 'Any of the above'],
      selectionMode: 'single',
    })
    expect(task.openQuestions?.[1]).toMatchObject({
      prompt: 'What the fallback must do',
      choices: [
        'Post one structured choice question, then stop turn',
        'Post structured question + transcript entry + stop turn',
      ],
    })
    expect(task.openQuestions?.[2]).toMatchObject({
      prompt: 'Out-of-scope guardrails',
      choices: [
        'Don’t redesign the task state machine',
        'Don’t add new question kinds',
        'Don’t change Looma code',
      ],
    })
  })

  it('limits fallback questionnaire parsing to the top three structured questions', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'exploring' })])
    const spec = stubAgent(
      'spec-agent',
      undefined,
      [
        'Pick one option for each:',
        '',
        '1) **First**',
        '- A) one',
        '- B) two',
        '',
        '2) **Second**',
        '- A) one',
        '- B) two',
        '',
        '3) **Third**',
        '- A) one',
        '- B) two',
        '',
        '4) **Fourth**',
        '- A) one',
        '- B) two',
      ].join('\n'),
    )
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ spec }),
    })

    const out = await orch.tick()
    expect(out.kind).toBe('processed')

    const queue = await readQueue()
    const task = queue.tasks[0]!
    expect(task.openQuestions).toHaveLength(3)
    expect(task.openQuestions?.map((q) => q.kind)).toEqual(['choice', 'choice', 'choice'])
    expect(task.openQuestions?.map((q) => ('prompt' in q ? q.prompt : ''))).toEqual([
      'First',
      'Second',
      'Third',
    ])
  })

  it('prefers prompt-line plus numbered choices when spec prose mixes numbered options with a later success check', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'exploring' })])
    const spec = stubAgent(
      'spec-agent',
      undefined,
      [
        'Got it — I’ll keep this first intake tight.',
        '',
        'To lock scope before I draft acceptance criteria, pick one:',
        '',
        '1. **Behavior spec only** — define what “narrowed first-turn batch” means.',
        '2. **End-to-end feature spec** — behavior + storage/format expectations.',
        '3. **Evaluation harness spec** — define test scenarios + pass/fail metrics.',
        '4. **Other** — tell me your target in one line.',
        '',
        'Also, what should success look like in one concrete check?',
        '- A) In first turn, agent asks at most N questions and yields.',
        '- B) Task spec quality stays complete while first turn stays narrow.',
        '- C) Both A and B.',
        '- D) Other.',
      ].join('\n'),
    )
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ spec }),
    })

    const out = await orch.tick()
    expect(out.kind).toBe('processed')

    const queue = await readQueue()
    const task = queue.tasks[0]!
    expect(task.openQuestions).toHaveLength(2)
    expect(task.openQuestions?.[0]).toMatchObject({
      prompt: 'To lock scope before I draft acceptance criteria, pick one:',
      choices: [
        'Behavior spec only',
        'End-to-end feature spec',
        'Evaluation harness spec',
        'Other',
      ],
    })
    expect(task.openQuestions?.[1]).toMatchObject({
      prompt: 'Also, what should success look like in one concrete check?',
      choices: [
        'In first turn, agent asks at most N questions and yields.',
        'Task spec quality stays complete while first turn stays narrow.',
        'Both A and B.',
        'Other.',
      ],
    })
  })

  it('backfills missing inferred questions when the agent only managed to post the first one', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'exploring' })])
    const generatedText = [
      'Great, thanks — we’ve got 3 of 6 decisions locked.',
      '',
      'I still need 3 quick picks before I can draft a precise, testable spec:',
      '',
      '1) **Test level target (pick one)**',
      '- A. Unit only',
      '- B. Unit + integration',
      '- C. Integration/e2e only',
      '',
      '2) **Coverage posture (pick one)**',
      '- A. Cover only the new narrowed-intake paths',
      '- B. Keep current project baseline (no new floor)',
      '- C. Set explicit floor for touched files (reply with %)',
      '',
      '3) **If first-turn data is still insufficient (pick one)**',
      '- A. Ask a second-turn follow-up batch (again narrow)',
      '- B. Escalate immediately as spec ambiguous',
      '- C. Draft best-effort spec with explicit open questions and pause for approval',
      '',
      'Once you pick these, I’ll draft the full spec with:',
      '- numbered Given/When/Then acceptance criteria',
      '- test mapping (which AC is unit vs integration)',
      '- out-of-scope',
      '- open questions (if any)',
    ].join('\n')
    const spec = stubAgent('spec-agent', async () => {
      await mutateTask('a', {
        openQuestions: [{
          kind: 'choice',
          id: 'q-1',
          askedBy: 'spec-agent',
          askedAt: new Date().toISOString(),
          prompt: '1) **Test level target (pick one)**',
          choices: ['Unit only', 'Unit + integration', 'Integration/e2e only'],
          selectionMode: 'single',
        }],
      })
    }, generatedText)
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ spec }),
    })

    const out = await orch.tick()
    expect(out.kind).toBe('processed')

    const queue = await readQueue()
    const task = queue.tasks[0]!
    expect(task.openQuestions).toHaveLength(3)
    expect(task.openQuestions?.map((q) => ('prompt' in q ? q.prompt : ''))).toEqual([
      'Test level target (pick one)',
      'Coverage posture (pick one)',
      'If first-turn data is still insufficient (pick one)',
    ])
  })

  it('does not synthesize fallback questions after the agent already drafted the spec and moved to spec_review', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'exploring', title: 'Draft spec' })])
    const specText = [
      'Perfect — that is enough to draft the spec.',
      '',
      'I’m going to:',
      '- write the spec into the task,',
      '- move the task to `spec_review`, and',
      '- log progress.',
    ].join('\n')
    const spec = stubAgent('spec-agent', async () => {
      await mutateTask('a', {
        status: 'spec_review',
        spec: '## Summary\\nDrafted spec.',
        notes: [{
          agentId: 'spec-agent',
          role: 'spec',
          content: 'Drafted spec.',
          timestamp: new Date().toISOString(),
        }],
      })
    }, specText)
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ spec }),
    })

    const out = await orch.tick()
    expect(out.kind).toBe('processed')

    const queue = await readQueue()
    const task = queue.tasks[0]!
    expect(task.status).toBe('spec_review')
    expect(task.spec).toContain('Summary')
    expect(task.openQuestions ?? []).toHaveLength(0)
  })

  it('drops stale starter-task focus questions once a drafted spec reaches spec_review', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'exploring' })])
    const updatedAt = '2026-05-11T20:24:50.064Z'
    const spec = stubAgent('spec-agent', async () => {
      await mutateTask('a', {
        status: 'spec_review',
        spec: '## Summary\\nDrafted spec.',
        acceptanceCriteria: [
          {
            id: 'ac-1',
            description: 'A real acceptance criterion exists.',
            verifiedBy: 'review',
            met: false,
          },
        ],
        updatedAt,
        notes: [{
          agentId: 'spec-agent',
          role: 'spec',
          content: 'Drafted spec.',
          timestamp: updatedAt,
        }],
      })
    }, 'Draft complete.')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ spec }),
    })

    const out = await orch.tick()
    expect(out.kind).toBe('processed')

    const queue = await readQueue()
    const task = queue.tasks[0]!
    expect(task.status).toBe('spec_review')
    expect((task.openQuestions ?? []).filter((q) => !q.answeredAt)).toHaveLength(0)
  })

  it('keeps legitimate unanswered spec-review questions after drafting the spec', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'exploring' })])
    const spec = stubAgent('spec-agent', async () => {
      await mutateTask('a', {
        status: 'spec_review',
        spec: '## Summary\\nDrafted spec.',
        acceptanceCriteria: [
          {
            id: 'ac-1',
            description: 'A real acceptance criterion exists.',
            verifiedBy: 'review',
            met: false,
          },
        ],
        openQuestions: [{
          kind: 'choice',
          id: 'q-real',
          askedBy: 'spec-agent',
          askedAt: new Date().toISOString(),
          prompt: 'Should register require only email and password, or also a display name?',
          choices: ['Email + password only', 'Require display name too'],
          selectionMode: 'single',
        }],
        notes: [{
          agentId: 'spec-agent',
          role: 'spec',
          content: 'Drafted spec.',
          timestamp: new Date().toISOString(),
        }],
      })
    }, 'Draft complete.')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ spec }),
    })

    const out = await orch.tick()
    expect(out.kind).toBe('processed')

    const queue = await readQueue()
    const task = queue.tasks[0]!
    expect(task.status).toBe('spec_review')
    expect((task.openQuestions ?? []).filter((q) => !q.answeredAt)).toHaveLength(1)
    expect(task.openQuestions?.[0]).toMatchObject({
      prompt: 'Should register require only email and password, or also a display name?',
    })
  })

  it('parses markdown-headed numbered questions and a "my read" brief into structured state', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'exploring', title: 'Fallback recovery' })])
    const spec = stubAgent(
      'spec-agent',
      undefined,
      [
        'Got it.',
        '',
        'My read of this task title is:',
        '- We want to verify fallback brief creation and structured question recovery after spec-agent failures.',
        '',
        '### 1) Primary outcome',
        '- A) Spec-agent flow only',
        '- B) Shared orchestration recovery',
        '- C) Both',
        '',
        '### 2) Test depth',
        '- A) Unit only',
        '- B) Unit + integration',
      ].join('\n'),
    )
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ spec }),
    })

    const out = await orch.tick()
    expect(out.kind).toBe('processed')

    const queue = await readQueue()
    const task = queue.tasks[0]!
    expect(task.productBrief).toMatchObject({
      userJob:
        'We want to verify fallback brief creation and structured question recovery after spec-agent failures.',
      authoredBy: 'spec-agent',
    })
    expect(task.openQuestions).toHaveLength(2)
    expect(task.openQuestions?.[0]).toMatchObject({
      kind: 'choice',
      prompt: 'Primary outcome',
      choices: ['Spec-agent flow only', 'Shared orchestration recovery', 'Both'],
    })
    expect(task.openQuestions?.[1]).toMatchObject({
      kind: 'choice',
      prompt: 'Test depth',
      choices: ['Unit only', 'Unit + integration'],
    })
  })

  it('does not promote topic labels into fallback choice answers when prose says questions remain', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'exploring', title: 'Mentions' })])
    const spec = stubAgent(
      'spec-agent',
      undefined,
      [
        'Spec updated with inline chip + CSS confirmed. Two questions remain:',
        '',
        '- Extension ownership',
        '- Knit integration',
      ].join('\n'),
    )
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ spec }),
    })

    const out = await orch.tick()
    expect(out.kind).toBe('processed')

    const queue = await readQueue()
    const task = queue.tasks[0]!
    expect(task.openQuestions ?? []).toHaveLength(0)
  })

  it('does not promote operational checklists into fallback owner questions', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'exploring', title: 'Meta intake' })])
    const spec = stubAgent(
      'spec-agent',
      undefined,
      [
        'I’ll now finalize by:',
        '',
        '- Reading current task/spec state from `TASKS.json`',
        '- Confirming the spec includes required sections and the 3 YAML fences',
        '- Updating task status to `spec_review`',
        '- Logging a progress milestone',
      ].join('\n'),
    )
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ spec }),
    })

    const out = await orch.tick()
    expect(out.kind).toBe('processed')

    const queue = await readQueue()
    const task = queue.tasks[0]!
    expect(task.openQuestions ?? []).toHaveLength(0)
  })

  it('does not promote completed-work narration into fallback choices', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'exploring', title: 'Auth flow' })])
    const spec = stubAgent(
      'spec-agent',
      undefined,
      [
        'Done — I took the durable blueprint steps:',
        '',
        '- Updated the product brief',
        '- Set task status to spec_review',
        '- Logged a progress milestone',
      ].join('\n'),
    )
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ spec }),
    })

    const out = await orch.tick()
    expect(out.kind).toBe('processed')

    const queue = await readQueue()
    const task = queue.tasks[0]!
    expect(task.openQuestions ?? []).toHaveLength(0)
  })

  it('does not promote "posted a question" narration into a duplicate fallback question', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'exploring', title: 'Autoencoder quality pass' })])
    const spec = stubAgent(
      'spec-agent',
      undefined,
      [
        'Posted a focused scope question to unblock the blueprint:',
        '',
        '- Full autoencoder quality pass',
        '- Narrow glyph outline review',
      ].join('\n'),
    )
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ spec }),
    })

    const out = await orch.tick()
    expect(out.kind).toBe('processed')

    const queue = await readQueue()
    const task = queue.tasks[0]!
    expect(task.openQuestions ?? []).toHaveLength(0)
  })

  it('does not convert research-budget evidence summaries into fallback questions', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'exploring', title: 'Build AlertDialog primitive' })])
    const spec = stubAgent(
      'spec-agent',
      undefined,
      [
        'Research budget hit. I have enough from the task data and the file listing to know the structure. Let me check what I know:',
        '',
        'What Guildhall found',
        '',
        '- `ui-dialog` is a StencilJS component at `packages/core/src/components/ui-dialog/ui-dialog.tsx`',
        '- `ui-button` is a StencilJS component at `packages/core/src/components/ui-button/ui-button.tsx`',
        '- No design system YAML exists yet',
        '- The user confirmed: StencilJS component matching existing ui-dialog pattern',
      ].join('\n'),
    )
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ spec }),
    })

    const out = await orch.tick()
    expect(out.kind).toBe('processed')

    const queue = await readQueue()
    const task = queue.tasks[0]!
    expect(task.openQuestions ?? []).toHaveLength(0)
  })

  it('does not convert transcript-note summaries into fallback questions', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'exploring', title: 'Autoencoder baseline quality pass' })])
    const spec = stubAgent(
      'spec-agent',
      undefined,
      [
        'From the transcript notes:',
        '',
        '- Baseline means measure the current autoencoder as-is.',
        '- Do not change the model until the first quality report exists.',
      ].join('\n'),
    )
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ spec }),
    })

    const out = await orch.tick()
    expect(out.kind).toBe('processed')

    const queue = await readQueue()
    const task = queue.tasks[0]!
    expect(task.openQuestions ?? []).toHaveLength(0)
  })

  it('does not promote research-summary narration into fallback choice questions', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'exploring', title: 'Rust outline preprocessing' })])
    const spec = stubAgent(
      'spec-agent',
      undefined,
      [
        "OK, I've hit the research budget for this turn. But I have enough context from what I've read to understand the situation clearly. Let me synthesize:",
        '',
        '- The plan doc says Rust gave 10-15% speedup.',
        '- The current task is blocked on a pixi install failure.',
      ].join('\n'),
    )
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ spec }),
    })

    const out = await orch.tick()
    expect(out.kind).toBe('processed')

    const queue = await readQueue()
    const task = queue.tasks[0]!
    expect(task.openQuestions ?? []).toHaveLength(0)
  })

  it('preserves fallback brief and question state when a spec turn hits the max turn limit after plain-text output', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'exploring', title: 'Collections coverage' })])
    const spec = {
      name: 'spec-agent',
      calls: [] as Array<{ prompt: string }>,
      messages: [
        {
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: [
                'My read of this task title is:',
                '- Add unit coverage for the use-collections happy path and one state-update behavior.',
                '',
                '### 1) Which state update matters most first?',
                '- A) Initial collection tree normalization',
                '- B) Optimistic create/update behavior',
              ].join('\n'),
            },
          ],
        },
      ],
      async generate(prompt: string) {
        this.calls.push({ prompt })
        throw new Error('Exceeded maximum turn limit (8)')
      },
    }
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ spec: spec as any }),
    })

    const out = await orch.tick()
    expect(out.kind).toBe('processed')

    const queue = await readQueue()
    const task = queue.tasks[0]!
    expect(task.status).toBe('exploring')
    expect(task.productBrief).toMatchObject({
      userJob: 'Add unit coverage for the use-collections happy path and one state-update behavior.',
      authoredBy: 'spec-agent',
    })
    expect((task.openQuestions ?? []).filter((q) => !q.answeredAt)).toHaveLength(1)
    expect(task.openQuestions?.[0]).toMatchObject({
      kind: 'choice',
      prompt: 'Which state update matters most first?',
      choices: ['Initial collection tree normalization', 'Optimistic create/update behavior'],
    })
    expect(task.escalations ?? []).toHaveLength(0)
  })

  it('retries a spec-agent inactivity timeout once before blocking the task', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'exploring', title: 'Build AlertDialog primitive' })])
    const spec = {
      name: 'spec-agent',
      calls: [] as Array<{ prompt: string }>,
      async generate(prompt: string) {
        this.calls.push({ prompt })
        throw new Error('spec-agent timed out after 120000ms of inactivity')
      },
    }
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ spec: spec as any }),
    })

    const out = await orch.tick()
    expect(out).toMatchObject({
      kind: 'processed',
      taskId: 'a',
      agent: 'spec-agent',
      beforeStatus: 'exploring',
      afterStatus: 'exploring',
      transitioned: false,
    })

    const queue = await readQueue()
    const task = queue.tasks[0]!
    expect(task.status).toBe('exploring')
    expect(task.escalations ?? []).toHaveLength(0)
  })

  it('blocks the task after repeated spec-agent inactivity timeouts without durable progress', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'exploring', title: 'Build AlertDialog primitive' })])
    const spec = {
      name: 'spec-agent',
      calls: [] as Array<{ prompt: string }>,
      async generate(prompt: string) {
        this.calls.push({ prompt })
        throw new Error('spec-agent timed out after 120000ms of inactivity')
      },
    }
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ spec: spec as any }),
    })

    await orch.tick()
    const out = await orch.tick()
    expect(out.kind).toBe('escalated')
    if (out.kind !== 'escalated') throw new Error(`expected escalation, got ${out.kind}`)
    expect(out.reason).toBe('Spec shaping timed out before saving durable progress.')

    const queue = await readQueue()
    const task = queue.tasks[0]!
    expect(task.status).toBe('blocked')
    expect(task.escalations[0]).toMatchObject({
      reason: 'human_judgment_required',
      summary: 'Spec shaping timed out before saving durable progress.',
    })
    expect(task.blockReason).toContain('Spec shaping timed out')
  })

  it('preserves newly saved durable spec progress when the spec agent times out', async () => {
    const savedSpec = [
      '## ContextMenu - Looma Primitive',
      '',
      '### Summary',
      'A right-click context menu that opens at the pointer position.',
      '',
      '## Completion Boundary',
      '- The component appears in the appropriate docs or story surface.',
    ].join('\n')
    await writeQueue([
      mkTask({
        id: 'a',
        status: 'exploring',
        title: 'ContextMenu',
      }),
    ])
    const spec = {
      name: 'spec-agent',
      calls: [] as Array<{ prompt: string }>,
      async generate(prompt: string) {
        this.calls.push({ prompt })
        await writeQueue([
          mkTask({
            id: 'a',
            status: 'exploring',
            title: 'ContextMenu',
            spec: savedSpec,
          }),
        ])
        throw new Error('spec-agent timed out after 120000ms of inactivity')
      },
    }
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ spec: spec as any }),
    })

    const out = await orch.tick()
    expect(out.kind).toBe('processed')
    if (out.kind === 'processed') {
      expect(out.beforeStatus).toBe('exploring')
      expect(out.afterStatus).toBe('spec_review')
      expect(out.transitioned).toBe(true)
    }

    const queue = await readQueue()
    const task = queue.tasks[0]!
    expect(task.status).toBe('spec_review')
    expect(task.blockReason ?? null).toBeNull()
    expect(task.escalations ?? []).toHaveLength(0)
  })

  it('writes a deterministic recovery spec seed before redispatching a reframed shaping task', async () => {
    await writeQueue([
      mkTask({
        id: 'a',
        status: 'exploring',
        title: 'Block menu / block side menu',
        description: 'looma/docs/editor-roadmap.md: - **Block menu / block side menu**',
        productBrief: {
          userJob: 'I want the old broken build failure repaired.',
          successMetric: 'The stale missing import disappears.',
          antiPatterns: ['Keep researching instead of writing a spec.'],
          authoredBy: 'spec-agent',
          authoredAt: '2026-05-25T06:59:09.130Z',
        },
        notes: [
          preservedQuestionNote(
            "I've drafted the product brief and posted three focused questions:",
            'Answer the concrete questions directly.',
          ),
          preservedQuestionNote(
            'Should drag-and-drop reordering be in scope?',
            'Drag-handle is out of scope for this task. Treat drag-and-drop reordering as a separate follow-up task.',
          ),
          {
            agentId: 'system',
            role: 'system',
            content: 'Reframe requested from blocked. Guildhall will rebuild the task in plain language before continuing.',
            timestamp: '2026-05-31T16:15:07.044Z',
          },
        ],
        escalations: [
          {
            id: 'esc-old-build',
            taskId: 'a',
            agentId: 'worker-agent',
            reason: 'decision_required',
            summary: 'Build failing due to unresolved import in packages/core/loader/index.js',
            details: 'Old build failure from a stale task shape.',
            raisedAt: '2026-05-25T06:59:09.130Z',
            resolvedAt: '2026-05-31T16:15:07.044Z',
            resolvedBy: 'human',
            resolution: 'Superseded by a task reframe request.',
          },
        ],
      }),
    ])
    const spec = stubAgent('spec-agent')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ spec }),
    })

    const out = await orch.tick()
    expect(out).toMatchObject({
      kind: 'processed',
      taskId: 'a',
      agent: 'coordinator-recovery',
      beforeStatus: 'exploring',
      afterStatus: 'spec_review',
      transitioned: true,
    })
    expect(spec.calls).toHaveLength(0)

    const queue = await readQueue()
    const task = queue.tasks[0]!
    expect(task.status).toBe('spec_review')
    expect(task.productBrief).toMatchObject({
      authoredBy: 'coordinator-recovery',
    })
    expect(task.productBrief?.userJob).toContain('Block menu / block side menu')
    expect(task.productBrief?.userJob).not.toContain('old broken build failure')
    expect(task.spec).toContain('## Completion Boundary')
    expect(task.spec).toContain('Drag-handle is out of scope')
    expect(task.spec).toContain('Block menu / block side menu from looma/docs/editor-roadmap.md')
    expect(task.spec).not.toContain('looma/docs/editor-roadmap.md: - **')
    expect(task.spec).not.toContain('Should drag-and-drop reordering be in scope?')
    expect(task.spec).not.toContain("I've drafted the product brief")
    expect(task.spec).not.toContain('Build failing due to unresolved import')
    expect(task.spec).not.toContain('Superseded by a task reframe request')
    expect(task.acceptanceCriteria).toHaveLength(3)
    expect(task.notes.some(note => note.content.includes('deterministic recovery spec seed'))).toBe(true)
  })

  it('writes a deterministic recovery spec seed after repeated durable-draft recovery', async () => {
    await writeQueue([
      mkTask({
        id: 'a',
        status: 'exploring',
        title: 'Define fixture, expected-record, prototype-run, and evaluation contracts',
        description: 'Imported contract work should materialize the named schema and record surfaces directly from the cited docs.',
        notes: [{
          agentId: 'coordinator',
          role: 'recovery',
          content: 'User restarted the project after the spec agent failed to save a durable draft. Reopened intake so Guildhall can retry from the preserved transcript notes.',
          timestamp: '2026-07-04T15:06:27.010Z',
        }],
      }),
    ])
    const spec = stubAgent('spec-agent')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ spec }),
    })

    const out = await orch.tick()

    expect(out).toMatchObject({
      kind: 'processed',
      taskId: 'a',
      agent: 'coordinator-recovery',
      beforeStatus: 'exploring',
      afterStatus: 'spec_review',
      transitioned: true,
    })
    expect(spec.calls).toHaveLength(0)
    const queue = await readQueue()
    const task = queue.tasks[0]!
    expect(task.status).toBe('spec_review')
    expect(task.spec).toContain('## Completion Boundary')
    expect(task.acceptanceCriteria).toHaveLength(3)
  })

  it('uses parent contract evidence when seeding a recovered child spec', async () => {
    await writeQueue([
      mkTask({
        id: 'parent',
        status: 'ready',
        title: 'Define fixture, expected-record, prototype-run, and evaluation schemas.',
        spec: [
          '## Acceptance Criteria',
          '1. The cited contracts are explicitly defined and usable in code: `FixtureManifest`, `ExpectedRecordSet`, `ExpectedSignal`.',
          '2. `PrototypeRun`, `RunEvaluation`, and `PacketQualityScore` capture the prototype run and trace evidence.',
        ].join('\n'),
        acceptanceCriteria: [{
          id: 'contracts-defined',
          description: 'The cited contracts are explicitly defined and usable in code: `FixtureManifest`, `ExpectedRecordSet`, `ExpectedSignal`.',
          verifiedBy: 'review',
          met: false,
        }],
        hierarchy: { childIds: ['a'], order: 0, relation: 'contains' },
      }),
      mkTask({
        id: 'a',
        status: 'exploring',
        title: 'Define fixture, expected-record, prototype-run, and evaluation contracts',
        description: 'Imported contract work should materialize the named schema and record surfaces directly from the cited docs.',
        hierarchy: { parentId: 'parent', childIds: [], order: 0, relation: 'decomposes' },
        notes: [{
          agentId: 'coordinator',
          role: 'recovery',
          content: 'User restarted the project after the spec agent failed to save a durable draft. Reopened intake so Guildhall can retry from the preserved transcript notes.',
          timestamp: '2026-07-04T15:06:27.010Z',
        }],
      }),
    ])
    const spec = stubAgent('spec-agent')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ spec }),
    })

    const out = await orch.tick()

    expect(out).toMatchObject({
      kind: 'processed',
      taskId: 'a',
      agent: 'coordinator-recovery',
      afterStatus: 'spec_review',
    })
    expect(spec.calls).toHaveLength(0)
    const queue = await readQueue()
    const task = queue.tasks.find(candidate => candidate.id === 'a')!
    expect(task.spec).toContain('Contract terms to account for')
    expect(task.spec).toContain('`FixtureManifest`')
    expect(task.spec).toContain('`RunEvaluation`')
    expect(task.spec).toContain('Do not introduce Rust contracts')
    expect(task.spec).not.toContain('appropriate repo surface')
    expect(task.acceptanceCriteria).toHaveLength(4)
  })

  it('narrows recovered fixture child specs instead of copying parent prototype scope', async () => {
    await writeQueue([
      mkTask({
        id: 'parent',
        status: 'ready',
        title: 'Define fixture, expected-record, prototype-run, and evaluation schemas.',
        spec: [
          '## Acceptance Criteria',
          '1. The cited contracts are explicitly defined and usable in code: `FixtureManifest`, `SyntheticAuthorProfile`, `FixturePermissionSetup`, `ExpectedRecordSet`, `ExpectedSignal`.',
          '2. `PrototypeRun`, `RunEvaluation`, `SchemaFieldUsage`, and `PacketQualityScore` capture the prototype run and trace evidence.',
        ].join('\n'),
        acceptanceCriteria: [{
          id: 'contracts-defined',
          description: 'The cited contracts include `FixtureManifest`, `ExpectedRecordSet`, `ExpectedSignal`, `PrototypeRun`, and `RunEvaluation`.',
          verifiedBy: 'review',
          met: false,
        }],
        hierarchy: { childIds: ['fixture-child'], order: 0, relation: 'contains' },
      }),
      mkTask({
        id: 'fixture-child',
        status: 'exploring',
        title: 'Shape fixture and expected-record ground truth',
        description: 'The first proof loop needs explicit fixture and ground-truth records instead of ad hoc fixture shape.',
        hierarchy: { parentId: 'parent', childIds: [], order: 0, relation: 'decomposes' },
        notes: [{
          agentId: 'coordinator',
          role: 'recovery',
          content: 'User restarted the project after the spec agent failed to save a durable draft. Reopened intake so Guildhall can retry from the preserved transcript notes.',
          timestamp: '2026-07-04T15:06:27.010Z',
        }],
      }),
    ])
    const spec = stubAgent('spec-agent')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ spec }),
    })

    const out = await orch.tick()

    expect(out).toMatchObject({
      kind: 'processed',
      taskId: 'fixture-child',
      agent: 'coordinator-recovery',
      afterStatus: 'spec_review',
    })
    expect(spec.calls).toHaveLength(0)
    const queue = await readQueue()
    const task = queue.tasks.find(candidate => candidate.id === 'fixture-child')!
    expect(task.spec).toContain('`FixtureManifest`')
    expect(task.spec).toContain('`ExpectedRecordSet`')
    expect(task.spec).toContain('human-authored ground truth')
    expect(task.spec).not.toContain('`PrototypeRun`')
    expect(task.spec).not.toContain('`RunEvaluation`')
    expect(task.spec).not.toContain('prototype run and evaluation boundary')
    expect(task.acceptanceCriteria.map((criterion) => criterion.description).join('\n')).toContain('fixture manifest')
    expect(task.acceptanceCriteria.map((criterion) => criterion.description).join('\n')).not.toContain('prototype run record')
  })

  it('does not fossilize legacy cropped task titles into recovered specs or briefs', async () => {
    const fullTitle = 'What commands should I run to smoke test this project without changing files?'
    await writeQueue([
      mkTask({
        id: 'a',
        status: 'exploring',
        title: 'What commands should I run to smoke test this project without changin...',
        description: fullTitle,
        request: {
          id: 'request-smoke-test',
          raw: fullTitle,
          kind: 'project_question',
          title: 'What commands should I run to smoke test this project without changin...',
          routingSummary: 'Routed to Project Question',
          pressureTestRequired: true,
          createdAt: '2026-06-15T18:48:51.097Z',
        },
        productBrief: {
          userJob: 'I want stale cropped wording repaired.',
          successMetric: 'The stale cropped wording disappears.',
          authoredBy: 'spec-agent',
          authoredAt: '2026-06-15T18:48:51.097Z',
        },
        notes: [{
          agentId: 'system',
          role: 'system',
          content: 'Reframe requested from blocked. Guildhall will rebuild the task in plain language before continuing.',
          timestamp: '2026-06-15T18:48:51.097Z',
        }],
      }),
    ])
    const spec = stubAgent('spec-agent')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ spec }),
    })

    const out = await orch.tick()
    expect(out).toMatchObject({
      kind: 'processed',
      taskId: 'a',
      agent: 'coordinator-recovery',
      afterStatus: 'spec_review',
    })

    const queue = await readQueue()
    const task = queue.tasks[0]!
    expect(task.spec).toContain(fullTitle)
    expect(task.spec).not.toContain('changin...')
    expect(task.productBrief?.userJob).toContain(fullTitle)
    expect(task.productBrief?.successMetric).toContain(fullTitle)
    expect(task.productBrief?.successMetric).not.toContain('changin...')
    expect(task.acceptanceCriteria.map(ac => ac.description).join('\n')).toContain(fullTitle)
    expect(task.acceptanceCriteria.map(ac => ac.description).join('\n')).not.toContain('changin...')
  })

  it('does not fossilize agent research narration into the fallback brief', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'exploring', title: 'Subdomain edge cases' })])
    const spec = {
      name: 'spec-agent',
      calls: [] as Array<{ prompt: string }>,
      messages: [
        {
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: [
                'Let me check the existing worktree tests and verify what exports already exist.',
                '',
                '### 1) Which host shape matters most first?',
                '- A) localhost and bare root domains',
                '- B) malformed hosts and unexpected dots',
              ].join('\n'),
            },
          ],
        },
      ],
      async generate(prompt: string) {
        this.calls.push({ prompt })
        throw new Error('Exceeded maximum turn limit (8)')
      },
    }
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ spec: spec as any }),
    })

    const out = await orch.tick()
    expect(out.kind).toBe('processed')

    const queue = await readQueue()
    const task = queue.tasks[0]!
    expect(task.productBrief).toBeUndefined()
    expect((task.openQuestions ?? []).filter((q) => !q.answeredAt)).toHaveLength(1)
    expect(task.openQuestions?.[0]).toMatchObject({
      kind: 'choice',
      prompt: 'Which host shape matters most first?',
      choices: ['localhost and bare root domains', 'malformed hosts and unexpected dots'],
    })
    expect(task.escalations ?? []).toHaveLength(0)

    const ownerInputRequests = await listOwnerInputRequests(tmpDir)
    expect(ownerInputRequests).toHaveLength(1)
    expect(ownerInputRequests[0]).toMatchObject({
      source: { kind: 'task', taskId: 'a' },
      prompt: 'Which host shape matters most first?',
      choices: ['localhost and bare root domains', 'malformed hosts and unexpected dots'],
      status: 'waiting_for_owner',
    })
  })

  it('parses markdown-headed questions that use A/B/C option lines into multiple structured cards', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'exploring' })])
    const spec = stubAgent(
      'spec-agent',
      undefined,
      [
        'Perfect — “all of the above” is clear.',
        '',
        '### 1) What should be the **primary success signal** for this task? (pick one)',
        'A. Spec quality only: clear ACs + testing strategy, no implementation expectations',
        'B. Implementation-ready: ACs are directly testable and mapped to unit/integration tests',
        'C. End-to-end governance: includes ACs for behavior, tests, task-state transitions, and transcript persistence as release gates',
        '',
        '### 2) Coverage posture for the future implementation (pick one)',
        'A. Standard floor only (existing project defaults; no extra target)',
        'B. Elevated on touched intake modules (explicit higher expectation in spec)',
        'C. Standard floor + explicit exemption note allowed for non-deterministic orchestration paths',
      ].join('\n'),
    )
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ spec }),
    })

    const out = await orch.tick()
    expect(out.kind).toBe('processed')

    const queue = await readQueue()
    const task = queue.tasks[0]!
    expect(task.openQuestions).toHaveLength(2)
    expect(task.openQuestions?.[0]).toMatchObject({
      prompt: 'What should be the **primary success signal** for this task? (pick one)',
      choices: [
        'Spec quality only: clear ACs + testing strategy, no implementation expectations',
        'Implementation-ready: ACs are directly testable and mapped to unit/integration tests',
        'End-to-end governance: includes ACs for behavior, tests, task-state transitions, and transcript persistence as release gates',
      ],
    })
    expect(task.openQuestions?.[1]).toMatchObject({
      prompt: 'Coverage posture for the future implementation (pick one)',
      choices: [
        'Standard floor only (existing project defaults; no extra target)',
        'Elevated on touched intake modules (explicit higher expectation in spec)',
        'Standard floor + explicit exemption note allowed for non-deterministic orchestration paths',
      ],
    })
  })

  it('routes in_progress tasks to the worker agent', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'in_progress' })])
    const worker = stubAgent('worker-agent')
    const gitDriver = new InMemoryGitDriver()
    gitDriver.setClean(true)
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
      gitDriver,
    })
    const out = await orch.tick()
    if (out.kind === 'processed') expect(out.agent).toBe('worker-agent')
    expect(worker.calls).toHaveLength(1)
  })

  it('sets a stable prompt cache key before dispatching an agent turn', async () => {
    await writeQueue([mkTask({ id: 'task-006', status: 'in_progress' })])
    const cacheKeys: Array<string | undefined> = []
    const worker: OrchestratorAgent = {
      name: 'worker-agent',
      setPromptCacheKey(key: string | undefined) {
        cacheKeys.push(key)
      },
      async generate() {
        return { text: 'ok' }
      },
    }
    const gitDriver = new InMemoryGitDriver()
    gitDriver.setClean(true)
    const orch = new Orchestrator({
      config: baseConfig({ workspaceId: 'fair-labor-license' }),
      agents: agentSet({ worker }),
      providerName: 'openai-api',
      gitDriver,
    })

    await orch.tick()

    expect(cacheKeys).toEqual([
      'openai-api:fair-labor-license:task-006:worker:fair-labor-license-worker',
    ])
  })

  it('routes review tasks to the reviewer agent', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'review' })])
    const reviewer = stubAgent('reviewer-agent')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ reviewer }),
    })
    await orch.tick()
    expect(reviewer.calls).toHaveLength(1)
  })

  it('routes gate_check tasks to the gate-checker agent', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'gate_check' })])
    const gc = stubAgent('gate-checker-agent')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ gateChecker: gc }),
    })
    await orch.tick()
    expect(gc.calls).toHaveLength(1)
  })

  it('injects task-scoped hard gates for nested project paths during gate_check', async () => {
    const knitDir = path.join(tmpDir, 'knit')
    await fs.mkdir(knitDir, { recursive: true })
    await fs.writeFile(
      path.join(knitDir, 'package.json'),
      JSON.stringify({
        name: 'knit',
        packageManager: 'pnpm@10.19.0',
        scripts: {
          typecheck: 'tsc --noEmit',
          test: 'vitest',
        },
        devDependencies: {
          vitest: '^3.0.0',
        },
      }),
      'utf8',
    )
    await writeQueue([
      mkTask({
        id: 'a',
        status: 'gate_check',
        projectPath: knitDir,
        acceptanceCriteria: [
          {
            id: 'ac-1',
            description: 'targeted callback tests pass',
            verifiedBy: 'automated',
            command: 'pnpm test --filter @knit-app -- --run login-callback-index.flow.test.ts',
            met: true,
          },
        ],
      }),
    ])
    const gc = stubAgent('gate-checker-agent')
    const orch = new Orchestrator({
      config: baseConfig({
        bootstrap: {
          commands: [],
          successGates: [],
          timeoutMs: 300_000,
          verifiedAt: '2026-05-03T01:00:00Z',
          packageManager: 'none',
          install: { command: '', status: 'ok' },
          gates: {
            lint: { command: '', available: false, unavailableReason: 'no package.json' },
            typecheck: { command: '', available: false, unavailableReason: 'no package.json' },
            build: { command: '', available: false, unavailableReason: 'no package.json' },
            test: { command: '', available: false, unavailableReason: 'no package.json' },
          },
        } as any,
      }),
      agents: agentSet({ gateChecker: gc }),
    })
    await orch.tick()
    expect(gc.calls).toHaveLength(1)
    expect(gc.calls[0]!.prompt).toContain(`Run hard gates against \`${knitDir}\``)
    expect(gc.calls[0]!.prompt).toContain('`pnpm typecheck`')
    expect(gc.calls[0]!.prompt).not.toContain('No verified shell gates are currently configured for this task path.')
  })

  it('claims ready tasks deterministically without a coordinator call', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'ready', domain: 'ghost', spec: VALID_SPEC })])
    const coord = stubAgent('ghost-coordinator')
    const worker = stubAgent('worker-agent')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ coordinators: { ghost: coord }, worker }),
    })
    const out = await orch.tick()
    expect(out.kind).toBe('processed')
    if (out.kind === 'processed') {
      expect(out.agent).toBe('task-claimer')
      expect(out.beforeStatus).toBe('ready')
      expect(out.afterStatus).toBe('in_progress')
      expect(out.transitioned).toBe(true)
    }
    expect(coord.calls).toHaveLength(0)
    expect(worker.calls).toHaveLength(0)
    const q = await readQueue()
    expect(q.tasks[0]!.status).toBe('in_progress')
    expect(q.tasks[0]!.assignedTo).toBe('worker-agent')
    expect(q.tasks[0]!.notes.at(-1)).toMatchObject({
      agentId: 'task-claimer',
      role: 'orchestrator',
    })
  })

  it('records a blueprint sanity review before claiming ready work', async () => {
    await writeQueue([mkTask({
      id: 'a',
      status: 'ready',
      domain: 'ghost',
      productBrief: {
        userJob: 'I want users to complete the invite flow.',
        successMetric: 'A user can accept an invite and land in the workspace.',
        antiPatterns: [],
        approvedAt: '2026-05-26T00:00:00.000Z',
      },
      spec: [
        '## Summary',
        '',
        'Implement invite acceptance.',
        '',
        '## Completion Boundary',
        '- Product outcome: A user can accept an invite and land in the workspace.',
        '- What Guildhall can complete in code: Update the invite route.',
        '- External dependencies: None.',
        '- Owner-only setup: None.',
        '- Verification environment: Local app with seeded invite data.',
        '- What counts as done: The seeded invite acceptance path succeeds end-to-end.',
        '- What must be split or blocked: Nothing.',
        '',
        '## Acceptance Criteria',
        '1. Given a valid invite, when the user accepts it, then they land in the workspace.',
      ].join('\n'),
      acceptanceCriteria: [{
        id: 'AC-1',
        description: 'Given a valid invite, when the user accepts it, then they land in the workspace.',
        verifiedBy: 'review',
        met: false,
      }],
    })])
    const worker = stubAgent('worker-agent')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
    })

    const out = await orch.tick()

    expect(out.kind).toBe('processed')
    const q = await readQueue()
    expect(q.tasks[0]!.status).toBe('in_progress')
    expect(q.tasks[0]!.notes.some((note) =>
      note.agentId === 'blueprint-sanity-review' &&
      note.role === 'blueprint-review' &&
      note.content.includes('approve_blueprint'),
    )).toBe(true)
    expect(q.tasks[0]!.notes.at(-1)?.content).toBe('Claimed ready task for worker-agent.')
    expect(worker.calls).toHaveLength(0)
  })

  it('routes ready tasks with a weak completion boundary back to exploring', async () => {
    await writeQueue([mkTask({
      id: 'a',
      status: 'ready',
      domain: 'ghost',
      productBrief: {
        userJob: 'I want users to sign in with familiar providers.',
        successMetric: 'Login shows Google and Apple buttons.',
        antiPatterns: [],
        approvedAt: '2026-05-26T00:00:00.000Z',
      },
      spec: [
        '## Summary',
        '',
        'Add Google and Apple provider buttons.',
        '',
        '## Acceptance Criteria',
        '1. Login and registration pages show Google and Apple buttons.',
      ].join('\n'),
      acceptanceCriteria: [{
        id: 'AC-1',
        description: 'Login and registration pages show Google and Apple buttons.',
        verifiedBy: 'review',
        met: false,
      }],
    })])
    const worker = stubAgent('worker-agent')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
    })

    const out = await orch.tick()

    expect(out.kind).toBe('processed')
    if (out.kind === 'processed') {
      expect(out.agent).toBe('blueprint-sanity-review')
      expect(out.afterStatus).toBe('exploring')
    }
    expect(worker.calls).toHaveLength(0)
    const q = await readQueue()
    expect(q.tasks[0]!.status).toBe('exploring')
    expect(q.tasks[0]!.notes.at(-1)?.content).toMatch(/completion boundary/i)
  })

  it('repairs ready-task blueprint revisions deterministically after sanity sends them back to exploring', async () => {
    await writeQueue([mkTask({
      id: 'a',
      status: 'ready',
      domain: 'looma',
      title: 'ContextMenu',
      productBrief: {
        userJob: 'I want ContextMenu implemented from the recovered task evidence.',
        successMetric: 'ContextMenu has a buildable spec before worker assignment.',
        antiPatterns: [],
        approvedAt: '2026-05-26T00:00:00.000Z',
      },
      spec: [
        '## Summary',
        '',
        'Implement ContextMenu.',
        '',
        '## Acceptance Criteria',
        '1. ContextMenu works in the target surface.',
      ].join('\n'),
      acceptanceCriteria: [{
        id: 'AC-1',
        description: 'ContextMenu works in the target surface.',
        verifiedBy: 'review',
        met: false,
      }],
    })])
    const worker = stubAgent('worker-agent')
    const spec = stubAgent('spec-agent')
    const coord = stubAgent('looma-coordinator', async () => {
      throw new Error('coordinator should not review an invalid blueprint')
    })
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ spec, worker, coordinators: { looma: coord } }),
    })

    const sanityOut = await orch.tick()

    expect(sanityOut.kind).toBe('processed')
    if (sanityOut.kind === 'processed') {
      expect(sanityOut.agent).toBe('blueprint-sanity-review')
      expect(sanityOut.afterStatus).toBe('exploring')
    }

    const repairOut = await orch.tick()

    expect(repairOut.kind).toBe('processed')
    if (repairOut.kind === 'processed') {
      expect(repairOut.agent).toBe('coordinator-recovery')
      expect(repairOut.beforeStatus).toBe('exploring')
      expect(repairOut.afterStatus).toBe('spec_review')
    }
    expect(worker.calls).toHaveLength(0)
    expect(spec.calls).toHaveLength(0)
    expect(coord.calls).toHaveLength(0)
    const q = await readQueue()
    expect(q.tasks[0]!.status).toBe('spec_review')
    expect(q.tasks[0]!.spec).toContain('## Completion Boundary')
    expect(q.tasks[0]!.notes.at(-1)?.content).toContain('repaired a malformed spec_review blueprint')
  })

  it('routes ready tasks without a usable blueprint back to exploring', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'ready', domain: 'ghost', spec: '' })])
    const worker = stubAgent('worker-agent')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
    })

    const out = await orch.tick()

    expect(out.kind).toBe('processed')
    if (out.kind === 'processed') {
      expect(out.agent).toBe('blueprint-sanity-review')
      expect(out.beforeStatus).toBe('ready')
      expect(out.afterStatus).toBe('exploring')
      expect(out.transitioned).toBe(true)
    }
    expect(worker.calls).toHaveLength(0)
    const q = await readQueue()
    expect(q.tasks[0]!.status).toBe('exploring')
    expect(q.tasks[0]!.assignedTo).toBeNull()
    expect(q.tasks[0]!.notes.at(-1)).toMatchObject({
      agentId: 'blueprint-sanity-review',
      role: 'blueprint-review',
    })
    expect(q.tasks[0]!.notes.at(-1)?.content).toContain('revise_blueprint')
  })

  it('revalidates ready task blueprints even when an earlier blueprint review note exists', async () => {
    await writeQueue([
      mkTask({
        id: 'a',
        status: 'ready',
        domain: 'ghost',
        spec: '',
        notes: [
          {
            agentId: 'blueprint-sanity-review',
            role: 'blueprint-review',
            content: 'approve_blueprint: Task had a usable blueprint/spec before a later edit.',
            timestamp: '2026-05-20T00:00:00.000Z',
          },
        ],
      }),
    ])
    const worker = stubAgent('worker-agent')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
    })

    const out = await orch.tick()

    expect(out.kind).toBe('processed')
    if (out.kind === 'processed') {
      expect(out.agent).toBe('blueprint-sanity-review')
      expect(out.afterStatus).toBe('exploring')
    }
    expect(worker.calls).toHaveLength(0)
    const q = await readQueue()
    expect(q.tasks[0]!.status).toBe('exploring')
    expect(q.tasks[0]!.notes.filter(note => note.role === 'blueprint-review')).toHaveLength(2)
    expect(q.tasks[0]!.notes.at(-1)?.content).toContain('revise_blueprint')
  })

  it('dispatches drafted spec_review tasks to the owning coordinator and clears stale ownership', async () => {
    await writeQueue([
      mkTask({
        id: 'a',
        status: 'spec_review',
        domain: 'looma',
        spec: VALID_SPEC,
        assignedTo: 'worker-agent',
      }),
    ])
    const coord = stubAgent('looma-coordinator', async () => {
      await mutateTask('a', { status: 'ready' })
    })
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ coordinators: { looma: coord } }),
    })
    const out = await orch.tick()
    expect(out.kind).toBe('processed')
    expect(coord.calls).toHaveLength(1)
    const queue = await readQueue()
    expect(queue.tasks[0]!.status).toBe('ready')
    expect(queue.tasks[0]!.assignedTo).toBeNull()
  })

  it('repairs invalid spec_review blueprints deterministically instead of dispatching an agent', async () => {
    await writeQueue([
      mkTask({
        id: 'a',
        status: 'spec_review',
        domain: 'looma',
        title: 'ContextMenu',
        productBrief: {
          userJob: 'I want to verify whether ContextMenu is already done and capture the remaining delta.',
          successMetric: 'The remaining ContextMenu work is clear enough to implement and review.',
          antiPatterns: [],
          approvedAt: '2026-05-26T00:00:00.000Z',
        },
        spec: [
          '## Summary',
          '',
          'Implement ContextMenu.',
          '',
          '## Acceptance Criteria',
          '1. ContextMenu works in the target surface.',
        ].join('\n'),
        acceptanceCriteria: [{
          id: 'AC-1',
          description: 'ContextMenu works in the target surface.',
          verifiedBy: 'review',
          met: false,
        }],
      }),
    ])
    const spec = stubAgent('spec-agent')
    const coord = stubAgent('looma-coordinator', async () => {
      throw new Error('coordinator should not review an invalid blueprint')
    })
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ spec, coordinators: { looma: coord } }),
    })

    const out = await orch.tick()

    expect(out.kind).toBe('processed')
    if (out.kind === 'processed') {
      expect(out.agent).toBe('coordinator-recovery')
      expect(out.afterStatus).toBe('spec_review')
    }
    expect(spec.calls).toHaveLength(0)
    expect(coord.calls).toHaveLength(0)
    const queue = await readQueue()
    expect(queue.tasks[0]!.status).toBe('spec_review')
    expect(queue.tasks[0]!.spec).toContain('## Completion Boundary')
    expect(queue.tasks[0]!.spec).toContain('ContextMenu')
    expect(queue.tasks[0]!.notes.some(note =>
      note.agentId === 'coordinator-recovery' &&
      note.content.includes('repaired a malformed spec_review blueprint'),
    )).toBe(true)
  })

  it('approves valid deterministically repaired spec_review blueprints without coordinator dispatch', async () => {
    await writeQueue([
      mkTask({
        id: 'a',
        status: 'spec_review',
        domain: 'looma',
        spec: VALID_SPEC,
        productBrief: {
          userJob: 'I want ContextMenu implemented from the repaired blueprint.',
          successMetric: 'ContextMenu is ready for worker implementation.',
          antiPatterns: [],
          approvedAt: '2026-05-26T00:00:00.000Z',
        },
        acceptanceCriteria: [{
          id: 'AC-1',
          description: 'Thing is done.',
          verifiedBy: 'review',
          met: false,
        }],
        notes: [{
          agentId: 'coordinator-recovery',
          role: 'system',
          content: 'Guildhall repaired a malformed spec_review blueprint deterministically before dispatch. Spec must include a Completion Boundary section.',
          timestamp: '2026-05-26T00:00:00.000Z',
        }],
      }),
    ])
    const coord = stubAgent('looma-coordinator', async () => {
      throw new Error('coordinator should not approve a deterministic repair')
    })
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ coordinators: { looma: coord } }),
    })

    const out = await orch.tick()

    expect(out.kind).toBe('processed')
    if (out.kind === 'processed') {
      expect(out.agent).toBe('blueprint-sanity-review')
      expect(out.afterStatus).toBe('ready')
    }
    expect(coord.calls).toHaveLength(0)
    const queue = await readQueue()
    expect(queue.tasks[0]!.status).toBe('ready')
    expect(queue.tasks[0]!.notes.at(-1)?.content).toContain('approve_blueprint')
  })

  it('still leaves the reserved meta-intake draft idle for manual approval and clears stale ownership', async () => {
    await writeQueue([
      mkTask({
        id: 'task-meta-intake',
        status: 'spec_review',
        domain: '_meta',
        spec: 'draft spec',
        assignedTo: 'worker-agent',
      }),
    ])
    const coord = stubAgent('meta-coordinator')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ coordinators: { _meta: coord } }),
    })
    const out = await orch.tick()
    expect(out.kind).toBe('idle')
    expect(coord.calls).toHaveLength(0)
    const queue = await readQueue()
    expect(queue.tasks[0]!.assignedTo).toBeNull()
  })

  it('clears stale ownership on terminal tasks during idle normalization', async () => {
    await writeQueue([
      mkTask({
        id: 'done-task',
        status: 'done',
        domain: 'looma',
        assignedTo: 'worker-agent',
      }),
    ])
    const coord = stubAgent('looma-coordinator')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ coordinators: { looma: coord } }),
    })
    const out = await orch.tick()
    expect(out.kind).toBe('idle')
    expect(coord.calls).toHaveLength(0)
    const queue = await readQueue()
    expect(queue.tasks[0]!.assignedTo).toBeNull()
  })

  it('routes workspace-import drafts to spec_review instead of looping in exploring', async () => {
    await writeQueue([
      mkTask({
        id: 'task-workspace-import',
        title: 'Import existing workspace artifacts into TASKS.json',
        domain: '_workspace_import',
        status: 'exploring',
      }),
    ])
    const spec = stubAgent('spec-agent', async () => {
      await mutateTask('task-workspace-import', {
        spec: '```yaml\\ntasks:\\n  - id: imported\\n    title: Imported task\\n```',
        updatedAt: '2026-04-01T00:05:00Z',
      })
    })
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ spec }),
    })
    const out = await orch.tick()
    expect(out.kind).toBe('processed')
    if (out.kind === 'processed') {
      expect(out.taskId).toBe('task-workspace-import')
      expect(out.afterStatus).toBe('spec_review')
      expect(out.transitioned).toBe(true)
    }
    const q = await readQueue()
    expect(q.tasks[0]!.status).toBe('spec_review')
  })

  it('routes non-reserved workspace-import child specs to spec_review when the spec lane saves a draft without status', async () => {
    await writeQueue([
      mkTask({
        id: 'expansion-child-audit',
        title: 'Audit the remaining replacement scope',
        domain: '_workspace_import',
        status: 'exploring',
      }),
    ])
    const spec = stubAgent('spec-agent', async () => {
      await mutateTask('expansion-child-audit', {
        spec: [
          '## What this is',
          'Audit the remaining replacement scope.',
          '',
          '## Acceptance Criteria',
          '1. Given the project docs and task list, when the inventory is reviewed, then every remaining spec is listed exactly once.',
          '',
          '## Completion Boundary',
          '- Product outcome: The next child task knows which implementation target comes first.',
        ].join('\n'),
        updatedAt: '2026-04-01T00:05:00Z',
      })
    })
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ spec }),
    })
    const out = await orch.tick()
    expect(out.kind).toBe('processed')
    if (out.kind === 'processed') {
      expect(out.taskId).toBe('expansion-child-audit')
      expect(out.afterStatus).toBe('spec_review')
      expect(out.transitioned).toBe(true)
    }
    const q = await readQueue()
    expect(q.tasks[0]!.status).toBe('spec_review')
    expect(q.tasks[0]!.notes.at(-1)?.content).toContain('saved spec draft')
  })

  it('does not promote a stale existing spec when the spec lane makes no durable spec update', async () => {
    await writeQueue([
      mkTask({
        id: 'expansion-child-implementation',
        title: 'Implement the first independently verifiable replacement',
        domain: '_workspace_import',
        status: 'exploring',
        spec: [
          '## Summary',
          'Build Implement the first independently verifiable replacement from generic current project evidence.',
          '',
          '## Acceptance Criteria',
          '1. Given existing conventions, when implemented, then the feature appears somewhere appropriate.',
        ].join('\n'),
      }),
    ])
    const spec = stubAgent('spec-agent', async () => {
      // The agent talked, but did not persist a revised spec for this turn.
    })
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ spec }),
    })
    const out = await orch.tick()
    expect(out.kind).toBe('processed')
    if (out.kind === 'processed') {
      expect(out.taskId).toBe('expansion-child-implementation')
      expect(out.afterStatus).toBe('exploring')
      expect(out.transitioned).toBe(false)
    }
    const q = await readQueue()
    expect(q.tasks[0]!.status).toBe('exploring')
    expect(q.tasks[0]!.notes.some(note => note.content.includes('saved spec draft'))).toBe(false)
  })

  it('reports no-coordinator when spec_review needs a missing domain coordinator', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'spec_review', domain: 'ghost', spec: VALID_SPEC })])
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    const out = await orch.tick()
    expect(out.kind).toBe('no-coordinator')
    if (out.kind === 'no-coordinator') {
      expect(out.taskId).toBe('a')
      expect(out.domain).toBe('ghost')
    }
  })

  it('filters by domain when domainFilter is set', async () => {
    await writeQueue([
      mkTask({ id: 'a', status: 'in_progress', domain: 'looma' }),
      mkTask({ id: 'b', status: 'in_progress', domain: 'knit' }),
    ])
    const worker = stubAgent('worker-agent')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
      domainFilter: 'knit',
    })
    const out = await orch.tick()
    if (out.kind === 'processed') expect(out.taskId).toBe('b')
  })

  it('retries empty assistant turns before surfacing an agent error', async () => {
    await writeQueue([mkTask({ id: 'worker-task', status: 'in_progress' })])
    let calls = 0
    const worker = {
      name: 'worker-agent',
      calls: [] as Array<{ prompt: string }>,
      async generate(prompt: string) {
        this.calls.push({ prompt })
        calls += 1
        if (calls < 3) {
          throw new Error('Model returned an empty assistant message. The turn was ignored to keep the session healthy.')
        }
        await mutateTask('worker-task', {
          status: 'done',
          updatedAt: '2026-04-01T00:06:00Z',
        })
        return { text: 'ok' }
      },
    }
    const gitDriver = new InMemoryGitDriver()
    gitDriver.setClean(true)
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
      gitDriver,
    })

    const first = await orch.tick()
    expect(first.kind).toBe('processed')
    if (first.kind === 'processed') {
      expect(first.afterStatus).toBe('in_progress')
      expect(first.transitioned).toBe(false)
    }

    const second = await orch.tick()
    expect(second.kind).toBe('processed')
    if (second.kind === 'processed') {
      expect(second.afterStatus).toBe('in_progress')
      expect(second.transitioned).toBe(false)
    }

    const third = await orch.tick()
    expect(third.kind).toBe('processed')
    if (third.kind === 'processed') {
      expect(third.afterStatus).toBe('done')
      expect(third.transitioned).toBe(true)
    }
  })

  it('resets the agent conversation once after repeated empty assistant turns', async () => {
    await writeQueue([mkTask({ id: 'worker-task', status: 'in_progress' })])
    let calls = 0
    let resets = 0
    const worker: StubAgent = {
      name: 'worker-agent',
      calls: [],
      async generate(prompt: string) {
        this.calls.push({ prompt })
        calls += 1
        if (calls <= 3) {
          throw new Error('Model returned an empty assistant message. The turn was ignored to keep the session healthy.')
        }
        await mutateTask('worker-task', {
          status: 'done',
          updatedAt: '2026-04-01T00:06:00Z',
        })
        return { text: 'ok' }
      },
      resetConversation() {
        resets += 1
      },
    }
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
    })

    expect((await orch.tick()).kind).toBe('processed')
    expect((await orch.tick()).kind).toBe('processed')

    const third = await orch.tick()
    expect(third.kind).toBe('processed')
    if (third.kind === 'processed') {
      expect(third.afterStatus).toBe('in_progress')
      expect(third.transitioned).toBe(false)
    }
    expect(resets).toBe(1)

    const fourth = await orch.tick()
    expect(fourth.kind).toBe('processed')
    if (fourth.kind === 'processed') {
      expect(fourth.afterStatus).toBe('done')
      expect(fourth.transitioned).toBe(true)
    }
  })

  it('preserves empty assistant handoff failures after real worker progress', async () => {
    await writeQueue([
      mkTask({
        id: 'worker-task',
        status: 'in_progress',
        worktreePath: path.join(tmpDir, '.guildhall', 'worktrees', 'worker-task'),
        notes: [
          {
            agentId: 'task-claimer',
            role: 'orchestrator',
            content: 'Claimed ready task for worker-agent.',
            timestamp: '2026-05-13T15:30:00.000Z',
          },
          {
            agentId: 'worker-agent',
            role: 'self-critique',
            content: '**Self-critique:**\n- [ac-1]: Met — focused test passes.',
            timestamp: '2026-04-01T00:05:00Z',
          },
        ],
      }),
    ])
    const worktreePath = path.join(tmpDir, '.guildhall', 'worktrees', 'worker-task')
    await fs.mkdir(path.join(worktreePath, 'web', 'tests', 'unit', 'composables'), { recursive: true })
    await fs.writeFile(
      path.join(worktreePath, 'web', 'tests', 'unit', 'composables', 'use-presence.test.ts'),
      'test("works", () => {})\n',
      'utf8',
    )
    execFileSync('git', ['init'], { cwd: worktreePath, stdio: 'ignore' })
    let resets = 0
    const worker: StubAgent = {
      name: 'worker-agent',
      calls: [],
      async generate(prompt: string) {
        this.calls.push({ prompt })
        throw new Error('Model returned an empty assistant message. The turn was ignored to keep the session healthy.')
      },
      resetConversation() {
        resets += 1
      },
      getToolMetadata() {
        return {
          review_handoff_evidence: {
            taskId: 'worker-task',
            inspectedImplementationFile: true,
            changedOrVerified: true,
          },
          recent_verified_work: [
            'Ran bash command cd web && pnpm vitest --run tests/unit/composables/use-presence.test.ts [PASS]',
            `Edited file ${path.join(tmpDir, '.guildhall', 'worktrees', 'worker-task', 'web', 'tests/unit/composables/use-presence.test.ts')}`,
          ],
        }
      },
    }
    const gitDriver = new InMemoryGitDriver()
    gitDriver.setClean(false)
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
      gitDriver,
    })

    expect((await orch.tick()).kind).toBe('processed')
    expect((await orch.tick()).kind).toBe('processed')

    const third = await orch.tick()
    expect(third.kind).toBe('processed')
    expect(resets).toBe(1)

    const fourth = await orch.tick()
    expect(fourth.kind).toBe('processed')
    if (fourth.kind === 'processed') {
      expect(fourth.afterStatus).toBe('blocked')
      expect(fourth.transitioned).toBe(true)
    }

    const checkpointPath = taskHistoryPath('worker-task', 'checkpoint.json')
    const checkpoint = JSON.parse(await fs.readFile(checkpointPath, 'utf8')) as {
      intent: string
      nextPlannedAction: string
      filesTouched: string[]
      resumeContext?: {
        verification?: Array<{
          command: string
          passed: boolean
          observedAt: string
          summary?: string
        }>
        companionFiles?: string[]
        workingHypothesis?: string
        safeNextMutationSurface?: string[]
      }
    }
    expect(checkpoint.intent).toContain('empty assistant reply after verified progress')
    expect(checkpoint.intent).toContain('Ran bash command cd web && pnpm vitest')
    expect(checkpoint.nextPlannedAction).toContain('Resume from the latest self-critique and verification evidence')
    expect(checkpoint.nextPlannedAction).toContain('hand off to review')
    expect(checkpoint.filesTouched).toContain('web/tests/unit/composables/use-presence.test.ts')
    expect(checkpoint.resumeContext?.verification).toEqual([])
    expect(checkpoint.resumeContext?.safeNextMutationSurface).toContain('web/tests/unit/composables/use-presence.test.ts')
    expect(checkpoint.resumeContext?.workingHypothesis).toContain('safest next mutation surface')

    const queue = await readQueue()
    const task = queue.tasks.find((candidate) => candidate.id === 'worker-task')
    expect(task?.status).toBe('blocked')
    expect(task?.blockReason).toContain('empty assistant reply after verified progress')
  })

  it('stops unattended runs instead of churning empty replies after verified progress', async () => {
    const worktreePath = path.join(tmpDir, '.guildhall', 'worktrees', 'worker-task')
    await writeQueue([
      mkTask({
        id: 'worker-task',
        status: 'in_progress',
        worktreePath,
      }),
    ])
    await fs.mkdir(path.join(worktreePath, 'src'), { recursive: true })
    await fs.writeFile(path.join(worktreePath, 'src', 'feature.ts'), 'export const value = 1\n', 'utf8')
    execFileSync('git', ['init'], { cwd: worktreePath, stdio: 'ignore' })

    let resets = 0
    const worker: StubAgent = {
      name: 'worker-agent',
      calls: [],
      async generate(prompt: string) {
        this.calls.push({ prompt })
        throw new Error('Model returned an empty assistant message. The turn was ignored to keep the session healthy.')
      },
      resetConversation() {
        resets += 1
      },
      getToolMetadata() {
        return {
          review_handoff_evidence: {
            taskId: 'worker-task',
            inspectedImplementationFile: true,
            changedOrVerified: true,
          },
          recent_verified_work: [
            'Ran bash command pnpm vitest src/feature.test.ts [PASS]',
            `Edited file ${path.join(worktreePath, 'src', 'feature.ts')}`,
          ],
        }
      },
    }
    const gitDriver = new InMemoryGitDriver()
    gitDriver.setClean(false)
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
      gitDriver,
    })

    const result = await orch.run({ maxTicks: 8, tickDelayMs: 0 })

    expect(result.stopReason).not.toBe('max_ticks')
    expect(result.stopReason).toBe('all_terminal')
    expect(resets).toBe(1)
    expect(worker.calls.length).toBe(4)
    const queue = await readQueue()
    const task = queue.tasks.find((candidate) => candidate.id === 'worker-task')
    expect(task?.status).toBe('blocked')
    expect(task?.blockReason).toContain('empty assistant reply after verified progress')
  })

  it('prioritizes source and test files over repo metadata in the recovery checkpoint mutation surface', async () => {
    const worktreePath = path.join(tmpDir, '.guildhall', 'worktrees', 'worker-task')
    await writeQueue([
      mkTask({
        id: 'worker-task',
        status: 'in_progress',
        worktreePath,
      }),
    ])
    await fs.mkdir(path.join(worktreePath, 'packages', 'converter', 'src'), { recursive: true })
    await fs.mkdir(path.join(worktreePath, 'packages', 'converter', 'test'), { recursive: true })
    execFileSync('git', ['init'], { cwd: worktreePath, stdio: 'ignore' })
    execFileSync('git', ['config', 'user.email', 'codex@example.com'], { cwd: worktreePath, stdio: 'ignore' })
    execFileSync('git', ['config', 'user.name', 'Codex'], { cwd: worktreePath, stdio: 'ignore' })
    await fs.writeFile(path.join(worktreePath, '.gitignore'), 'dist\n', 'utf8')
    await fs.writeFile(path.join(worktreePath, 'package.json'), '{\"name\":\"demo\"}\n', 'utf8')
    await fs.writeFile(
      path.join(worktreePath, 'packages', 'converter', 'src', 'typescriptToJsdoc.ts'),
      'export const baseline = true\n',
      'utf8',
    )
    await fs.writeFile(
      path.join(worktreePath, 'packages', 'converter', 'test', 'ts-to-jsdoc.test.ts'),
      'test(\"baseline\", () => {})\n',
      'utf8',
    )
    execFileSync('git', ['add', '.'], { cwd: worktreePath, stdio: 'ignore' })
    execFileSync('git', ['commit', '-m', 'baseline', '--no-verify'], { cwd: worktreePath, stdio: 'ignore' })
    await fs.writeFile(path.join(worktreePath, '.gitignore'), 'dist\ncoverage\n', 'utf8')
    await fs.writeFile(path.join(worktreePath, 'package.json'), '{\"name\":\"demo\",\"private\":true}\n', 'utf8')
    await fs.writeFile(
      path.join(worktreePath, 'packages', 'converter', 'src', 'typescriptToJsdoc.ts'),
      'export const changed = true\n',
      'utf8',
    )
    await fs.writeFile(
      path.join(worktreePath, 'packages', 'converter', 'test', 'ts-to-jsdoc.test.ts'),
      'test(\"works\", () => {})\n',
      'utf8',
    )

    const worker: StubAgent = {
      name: 'worker-agent',
      calls: [],
      async generate(prompt: string) {
        this.calls.push({ prompt })
        throw new Error('Model returned an empty assistant message. The turn was ignored to keep the session healthy.')
      },
      getToolMetadata() {
        return {
          review_handoff_evidence: {
            taskId: 'worker-task',
            inspectedImplementationFile: true,
            changedOrVerified: true,
          },
          current_task_verification_history: [
            {
              command: 'cd packages/converter && pnpm vitest --run test/ts-to-jsdoc.test.ts',
              passed: false,
              observedAt: '2026-05-14T13:50:51.803Z',
              summary: '5 failures in non-type JSDoc tag preservation',
            },
          ],
        }
      },
    }

    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
    })

    for (let i = 0; i < 6; i += 1) {
      await orch.tick()
    }

    const checkpointPath = taskHistoryPath('worker-task', 'checkpoint.json')
    const checkpoint = JSON.parse(await fs.readFile(checkpointPath, 'utf8')) as {
      nextPlannedAction: string
      resumeContext?: {
        safeNextMutationSurface?: string[]
        workingHypothesis?: string
      }
    }

    expect(checkpoint.nextPlannedAction).toContain('recorded verification evidence')
    expect(checkpoint.nextPlannedAction).toContain('rerun the focused verification commands')
    expect(checkpoint.resumeContext?.safeNextMutationSurface?.[0]).toBe('packages/converter/src/typescriptToJsdoc.ts')
    expect(checkpoint.resumeContext?.safeNextMutationSurface?.[1]).toBe('packages/converter/test/ts-to-jsdoc.test.ts')
    expect(checkpoint.resumeContext?.safeNextMutationSurface?.slice(0, 2)).not.toContain('.gitignore')
    expect(checkpoint.resumeContext?.safeNextMutationSurface?.slice(0, 2)).not.toContain('package.json')
    expect(checkpoint.resumeContext?.workingHypothesis).toContain('packages/converter/src/typescriptToJsdoc.ts')
    expect(checkpoint.resumeContext?.workingHypothesis).not.toContain('.gitignore')
  })

  it('keeps task-state files and lockfile noise out of recovery checkpoint mutation surfaces', async () => {
    const worktreePath = path.join(tmpDir, '.guildhall', 'worktrees', 'worker-task')
    await writeQueue([
      mkTask({
        id: 'worker-task',
        title: 'Verify and update the migration record',
        status: 'in_progress',
        worktreePath,
        spec: [
          '## Summary',
          'Create the migration inventory and update sibling task notes in TASKS.json.',
          '',
          '## Acceptance Criteria',
          '1. docs/harness/remaining-spec-decomposition-inventory.md exists.',
          '2. Sibling task notes are updated through Guildhall task state.',
        ].join('\n'),
      }),
    ])
    await fs.mkdir(path.join(worktreePath, 'docs', 'harness'), { recursive: true })
    await fs.writeFile(path.join(worktreePath, 'package.json'), '{"name":"demo"}\n', 'utf8')
    await fs.writeFile(path.join(worktreePath, 'package-lock.json'), '{"lockfileVersion":3}\n', 'utf8')
    execFileSync('git', ['init'], { cwd: worktreePath, stdio: 'ignore' })
    execFileSync('git', ['config', 'user.email', 'codex@example.com'], { cwd: worktreePath, stdio: 'ignore' })
    execFileSync('git', ['config', 'user.name', 'Codex'], { cwd: worktreePath, stdio: 'ignore' })
    execFileSync('git', ['add', '.'], { cwd: worktreePath, stdio: 'ignore' })
    execFileSync('git', ['commit', '-m', 'baseline', '--no-verify'], { cwd: worktreePath, stdio: 'ignore' })
    await fs.writeFile(path.join(worktreePath, 'package-lock.json'), '{"lockfileVersion":3,"noise":true}\n', 'utf8')

    const inventoryPath = path.join(worktreePath, 'docs', 'harness', 'remaining-spec-decomposition-inventory.md')
    const taskStatePath = path.join(worktreePath, 'TASKS.json')
    const worker: StubAgent = {
      name: 'worker-agent',
      calls: [],
      async generate(prompt: string) {
        this.calls.push({ prompt })
        throw new Error('Model returned an empty assistant message. The turn was ignored to keep the session healthy.')
      },
      getToolMetadata() {
        return {
          review_handoff_evidence: {
            taskId: 'worker-task',
            inspectedImplementationFile: true,
            changedOrVerified: true,
          },
          recent_verified_work: [
            'Ran bash command head -30 docs/specs/agent-decision-trees.md [PASS]',
          ],
          read_file_state: [
            { path: taskStatePath, preview: '{"tasks":[]}' },
            { path: inventoryPath, preview: '# Remaining spec decomposition inventory' },
          ],
          current_task_likely_target_files: [
            taskStatePath,
            inventoryPath,
          ],
        }
      },
    }

    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
    })

    for (let i = 0; i < 6; i += 1) {
      await orch.tick()
    }

    const checkpoint = JSON.parse(
      await fs.readFile(taskHistoryPath('worker-task', 'checkpoint.json'), 'utf8'),
    ) as {
      filesTouched: string[]
      resumeContext?: {
        companionFiles?: string[]
        safeNextMutationSurface?: string[]
        workingHypothesis?: string
      }
    }

    expect(checkpoint.filesTouched).toContain('package-lock.json')
    expect(checkpoint.resumeContext?.companionFiles).toContain(inventoryPath)
    expect(checkpoint.resumeContext?.companionFiles).not.toContain(taskStatePath)
    expect(checkpoint.resumeContext?.safeNextMutationSurface?.[0]).toBe(inventoryPath)
    expect(checkpoint.resumeContext?.safeNextMutationSurface).not.toContain('package-lock.json')
    expect(checkpoint.resumeContext?.safeNextMutationSurface).not.toContain(taskStatePath)
    expect(checkpoint.resumeContext?.workingHypothesis).toContain('remaining-spec-decomposition-inventory.md')
    expect(checkpoint.resumeContext?.workingHypothesis).not.toContain('package-lock.json')
  })

  it('writes a recovery checkpoint even when the worker already blocked the task before an empty assistant reply', async () => {
    const worktreePath = path.join(tmpDir, '.guildhall', 'worktrees', 'worker-task')
    await writeQueue([
      mkTask({
        id: 'worker-task',
        status: 'in_progress',
        worktreePath,
      }),
    ])
    await fs.mkdir(path.join(worktreePath, 'web', 'tests', 'unit', 'composables'), { recursive: true })
    await fs.writeFile(
      path.join(worktreePath, 'web', 'tests', 'unit', 'composables', 'use-presence.test.ts'),
      'test("works", () => {})\n',
      'utf8',
    )
    execFileSync('git', ['init'], { cwd: worktreePath, stdio: 'ignore' })

    let calls = 0
    const worker: StubAgent = {
      name: 'worker-agent',
      calls: [],
      async generate(prompt: string) {
        this.calls.push({ prompt })
        calls += 1
        if (calls === 3) {
          await mutateTask('worker-task', {
            status: 'blocked',
            blockReason: 'decision_required: unrelated repo-red',
            updatedAt: '2026-04-01T00:06:00Z',
          })
        }
        throw new Error('Model returned an empty assistant message. The turn was ignored to keep the session healthy.')
      },
      getToolMetadata() {
        return {
          review_handoff_evidence: {
            taskId: 'worker-task',
            inspectedImplementationFile: true,
            changedOrVerified: true,
          },
          recent_verified_work: [
            'Ran bash command pnpm --dir web typecheck [FAIL unrelated file outside task scope]',
            `Edited file ${path.join(worktreePath, 'web', 'tests', 'unit', 'composables', 'use-presence.test.ts')}`,
          ],
        }
      },
    }
    const gitDriver = new InMemoryGitDriver()
    gitDriver.setClean(false)
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
      gitDriver,
    })

    expect((await orch.tick()).kind).toBe('processed')
    expect((await orch.tick()).kind).toBe('processed')

    const third = await orch.tick()
    expect(third.kind).toBe('processed')
    if (third.kind === 'processed') {
      expect(third.afterStatus).toBe('blocked')
      expect(third.transitioned).toBe(true)
    }

    const checkpointPath = taskHistoryPath('worker-task', 'checkpoint.json')
    const checkpoint = JSON.parse(await fs.readFile(checkpointPath, 'utf8')) as {
      intent: string
      nextPlannedAction: string
    }
    expect(checkpoint.intent).toContain('empty assistant reply after verified progress')
    expect(checkpoint.nextPlannedAction).toContain('focused verification')
    expect(checkpoint.nextPlannedAction).not.toContain('hand off to review')
  })

  it('writes a recovery checkpoint after an empty assistant reply even when the worktree is clean if checkpoint-scoped verified files are present', async () => {
    const worktreePath = path.join(tmpDir, '.guildhall', 'worktrees', 'worker-clean-verified')
    await writeQueue([
      mkTask({
        id: 'worker-clean-verified',
        status: 'in_progress',
        worktreePath,
      }),
    ])
    await fs.mkdir(path.join(worktreePath, 'web', 'app', 'types'), { recursive: true })
    await fs.writeFile(
      path.join(worktreePath, 'web', 'app', 'types', 'supabase.ts'),
      'export interface Database {}\n',
      'utf8',
    )
    execFileSync('git', ['init'], { cwd: worktreePath, stdio: 'ignore' })

    const worker: StubAgent = {
      name: 'worker-agent',
      calls: [],
      async generate(prompt: string) {
        this.calls.push({ prompt })
        throw new Error('Model returned an empty assistant message. The turn was ignored to keep the session healthy.')
      },
      getToolMetadata() {
        return {
          review_handoff_evidence: {
            taskId: 'worker-clean-verified',
            inspectedImplementationFile: true,
            changedOrVerified: true,
          },
          recent_verified_work: [
            'Ran bash command pnpm db:types:remote [PASS]',
            `Read file ${path.join(worktreePath, 'web', 'app', 'types', 'supabase.ts')}`,
          ],
          current_task_checkpoint_files_touched: ['web/app/types/supabase.ts'],
        }
      },
    }
    const gitDriver = new InMemoryGitDriver()
    gitDriver.setClean(true)
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
      gitDriver,
    })

    expect((await orch.tick()).kind).toBe('processed')
    expect((await orch.tick()).kind).toBe('processed')
    const third = await orch.tick()
    expect(third.kind).toBe('processed')

    const checkpointPath = taskHistoryPath('worker-clean-verified', 'checkpoint.json')
    const checkpoint = JSON.parse(await fs.readFile(checkpointPath, 'utf8')) as {
      intent: string
      nextPlannedAction: string
      filesTouched: string[]
    }
    expect(checkpoint.intent).toContain('empty assistant reply after verified progress')
    expect(checkpoint.intent).toContain('pnpm db:types:remote')
    expect(checkpoint.filesTouched).toContain('web/app/types/supabase.ts')
    expect(checkpoint.nextPlannedAction).toContain('rerun the focused verification commands')
    expect(checkpoint.nextPlannedAction).not.toContain('hand off to review')
  })

  it('keeps a task in review and normalizes reviewer ownership after repeated empty replies post-handoff', async () => {
    await writeQueue([
      mkTask({
        id: 'review-task',
        status: 'review',
        assignedTo: 'worker-agent',
      }),
    ])

    const reviewer: StubAgent = {
      name: 'reviewer-agent',
      calls: [],
      async generate(prompt: string) {
        this.calls.push({ prompt })
        throw new Error('Model returned an empty assistant message. The turn was ignored to keep the session healthy.')
      },
    }

    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ reviewer }),
    })

    expect((await orch.tick()).kind).toBe('processed')
    expect((await orch.tick()).kind).toBe('processed')

    const third = await orch.tick()
    expect(third.kind).toBe('processed')

    expect((await orch.tick()).kind).toBe('processed')
    expect((await orch.tick()).kind).toBe('processed')

    const sixth = await orch.tick()
    expect(sixth.kind).toBe('processed')
    if (sixth.kind === 'processed') {
      expect(sixth.afterStatus).toBe('review')
      expect(sixth.transitioned).toBe(false)
    }

    const queue = await readQueue()
    const task = queue.tasks.find((candidate) => candidate.id === 'review-task')
    expect(task?.status).toBe('review')
    expect(task?.assignedTo).toBe('reviewer-agent')
    expect(task?.blockReason).toBeUndefined()
  })
})

describe('Orchestrator.tick — feedback loop', () => {
  it('detects status transitions the agent wrote to disk', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'in_progress' })])
    const worker = stubAgent('worker-agent', async () => {
      await mutateTask('a', { status: 'review' })
    })
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
    })
    const out = await orch.tick()
    expect(out.kind).toBe('processed')
    if (out.kind === 'processed') {
      expect(out.beforeStatus).toBe('in_progress')
      expect(out.afterStatus).toBe('review')
      expect(out.transitioned).toBe(true)
    }
    const q = await readQueue()
    expect(q.tasks[0]!.assignedTo).toBe('reviewer-agent')
  })

  it('normalizes stale worker ownership before dispatching a review task', async () => {
    await writeQueue([
      mkTask({
        id: 'review-task',
        status: 'review',
        assignedTo: 'worker-agent',
      }),
    ])
    let assignedDuringDispatch: string | null = null
    const reviewer = stubAgent('reviewer-agent', async () => {
      const q = await readQueue()
      assignedDuringDispatch = q.tasks.find((task) => task.id === 'review-task')?.assignedTo ?? null
    })
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ reviewer }),
    })

    await orch.tick()

    expect(assignedDuringDispatch).toBe('reviewer-agent')
  })

  it('normalizes missing worker ownership before dispatching an in_progress task', async () => {
    await writeQueue([
      mkTask({
        id: 'worker-task',
        status: 'in_progress',
        assignedTo: undefined,
      }),
    ])
    let assignedDuringDispatch: string | null = null
    const worker = stubAgent('worker-agent', async () => {
      const q = await readQueue()
      assignedDuringDispatch = q.tasks.find((task) => task.id === 'worker-task')?.assignedTo ?? null
    })
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
    })

    await orch.tick()

    expect(assignedDuringDispatch).toBe('worker-agent')
  })

  it('returns excess active worker tasks to ready when dispatch is serial', async () => {
    await writeQueue([
      mkTask({
        id: 'older-worker-task',
        status: 'in_progress',
        assignedTo: 'worker-agent',
        updatedAt: '2026-05-03T00:00:00.000Z',
      }),
      mkTask({
        id: 'newer-worker-task',
        status: 'in_progress',
        assignedTo: 'worker-agent',
        updatedAt: '2026-05-03T00:01:00.000Z',
      }),
    ])
    const worker = stubAgent('worker-agent')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
    })

    await orch.tick()

    const q = await readQueue()
    const older = q.tasks.find((task) => task.id === 'older-worker-task')
    const newer = q.tasks.find((task) => task.id === 'newer-worker-task')
    expect(older?.status).toBe('ready')
    expect(older?.assignedTo ?? null).toBeNull()
    expect(older?.notes.at(-1)?.content).toContain('serial dispatch')
    expect(newer?.status).toBe('in_progress')
    expect(newer?.assignedTo).toBe('worker-agent')
  })

  it('clears stale spec claims from exploring tasks when dispatch is serial', async () => {
    await writeQueue([
      mkTask({
        id: 'draft-a',
        status: 'exploring',
        assignedTo: 'spec-agent',
        updatedAt: '2026-05-03T00:00:00.000Z',
      }),
      mkTask({
        id: 'draft-b',
        status: 'exploring',
        assignedTo: 'spec-agent',
        updatedAt: '2026-05-03T00:01:00.000Z',
      }),
    ])
    const spec = stubAgent('spec-agent')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ spec }),
    })

    await orch.tick()

    const q = await readQueue()
    const drafts = q.tasks.filter((task) => task.status === 'exploring')
    expect(drafts).toHaveLength(2)
    expect(drafts.every((task) => task.assignedTo == null)).toBe(true)
    expect(drafts.some((task) =>
      task.notes.some((note) => note.content.includes('cleared a stale spec-agent claim')),
    )).toBe(true)
  })

  it('normalizes stale reviewer ownership before dispatching a gate_check task', async () => {
    await writeQueue([
      mkTask({
        id: 'gate-task',
        status: 'gate_check',
        assignedTo: 'reviewer-agent',
      }),
    ])
    let assignedDuringDispatch: string | null = null
    const gateChecker = stubAgent('gate-checker-agent', async () => {
      const q = await readQueue()
      assignedDuringDispatch = q.tasks.find((task) => task.id === 'gate-task')?.assignedTo ?? null
    })
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ gateChecker }),
    })

    await orch.tick()

    expect(assignedDuringDispatch).toBe('gate-checker-agent')
  })

  it('reports transitioned=false when the agent left the status unchanged', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'in_progress' })])
    const worker = stubAgent('worker-agent') // no mutation
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
    })
    const out = await orch.tick()
    if (out.kind === 'processed') {
      expect(out.afterStatus).toBe('in_progress')
      expect(out.transitioned).toBe(false)
    }
  })

  it('treats worker self-critique without project-file changes as no progress', async () => {
    await writeQueue([
      mkTask({
        id: 'pantry-live',
        status: 'in_progress',
        assignedTo: 'worker-agent',
        title: 'Pantry Pulse app spec',
        spec: [
          '## Summary',
          'Build Pantry Pulse, a small local web app.',
          '',
          '## Completion Boundary',
          '- What Guildhall can complete in code: Create the local static web app files, seeded data, filter behavior, styles, and browser-proofable UI.',
          '- Verification environment: Local runtime/browser proof.',
        ].join('\n'),
      }),
    ])
    const worker = stubAgent('worker-agent', async () => {
      const task = (await readQueue()).tasks.find(candidate => candidate.id === 'pantry-live')!
      await mutateTask('pantry-live', {
        updatedAt: '2026-04-01T00:02:00Z',
        notes: [
          ...task.notes,
          {
            agentId: 'worker-agent',
            role: 'self-critique',
            content: [
              '**Self-critique:**',
              'For each acceptance criterion:',
              '- [AC-1]: Met — index.html exists and renders Pantry Pulse.',
              '',
              'Minimum-scope check:',
              '- Files changed: index.html',
              '- Smallest useful change?: yes.',
              '- Anything to revert before review?: none',
              '',
              'Review proof packet:',
              '- Changed files / diff scope: index.html',
              '- Verification commands passed: pnpm build passed',
              '- Working hypothesis at handoff: ready.',
              '- Known gaps / follow-up: none',
              '',
              'Out-of-scope changes introduced: none',
              'Uncertainties: none',
            ].join('\n'),
            timestamp: '2026-04-01T00:02:00Z',
          },
        ],
      })
    })
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
      gitDriver: new InMemoryGitDriver({ clean: true, currentBranch: 'main' }),
    })

    const out = await orch.tick()

    if (out.kind === 'processed') {
      expect(out.afterStatus).toBe('in_progress')
      expect(out.transitioned).toBe(false)
    }
    const task = (await readQueue()).tasks.find(candidate => candidate.id === 'pantry-live')!
    expect(task.notes.at(-1)?.role).toBe('worker-progress-review')
    expect(task.notes.at(-1)?.content).toContain('self-critique without project-file changes')
  })

  it('rejects stale worker self-critique without project-file changes before redispatching', async () => {
    await writeQueue([
      mkTask({
        id: 'pantry-live',
        status: 'in_progress',
        assignedTo: 'worker-agent',
        title: 'Pantry Pulse app spec',
        spec: 'Build a local web app with browser-proofable UI.',
        notes: [{
          agentId: 'worker-agent',
          role: 'self-critique',
          content: [
            '**Self-critique:**',
            'For each acceptance criterion:',
            '- [AC-1]: Met — index.html exists.',
            '',
            'Minimum-scope check:',
            '- Files changed: index.html',
            '- Smallest useful change?: yes.',
            '- Anything to revert before review?: none',
            '',
            'Review proof packet:',
            '- Changed files / diff scope: index.html',
            '- Verification commands passed: pnpm build passed',
            '- Working hypothesis at handoff: ready.',
            '- Known gaps / follow-up: none',
          ].join('\n'),
          timestamp: '2026-04-01T00:02:00Z',
        }],
      }),
    ])
    const worker = stubAgent('worker-agent')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
      gitDriver: new InMemoryGitDriver({ clean: true, currentBranch: 'main' }),
    })

    const out = await orch.tick()

    expect(worker.calls).toHaveLength(0)
    if (out.kind === 'processed') {
      expect(out.agent).toBe('coordinator-remediation')
      expect(out.afterStatus).toBe('in_progress')
    }
    const task = (await readQueue()).tasks.find(candidate => candidate.id === 'pantry-live')!
    expect(task.notes.at(-1)?.role).toBe('worker-progress-review')
    expect(task.notes.at(-1)?.content).toContain('stale worker self-critique without project-file changes')
  })

  it('rejects artifact worker handoff without project-file changes before review can approve it', async () => {
    await writeQueue([
      mkTask({
        id: 'artifact-patch',
        status: 'review',
        assignedTo: 'reviewer-agent',
        title: 'policy-note-overreach',
        description: 'Append a new bullet to RELEASE_NOTES.md and do not edit any other file.',
        spec: 'Append the exact bullet to RELEASE_NOTES.md.',
        acceptanceCriteria: [
          {
            id: 'AC-1',
            description: 'RELEASE_NOTES.md contains benchmark artifact evidence.',
            verifiedBy: 'automated',
            command: "grep -q 'benchmark artifact evidence' RELEASE_NOTES.md",
            met: false,
          },
        ],
        notes: [{
          agentId: 'worker-agent',
          role: 'self-critique',
          content: [
            '**Self-critique:**',
            'For each acceptance criterion:',
            '- AC1: Met — claimed grep passed.',
            '',
            'Minimum-scope check:',
            '- Files changed: RELEASE_NOTES.md.',
            '',
            'Review proof packet:',
            '- Changed files / diff scope: RELEASE_NOTES.md.',
            '- Verification commands passed: grep passed.',
          ].join('\n'),
          timestamp: '2026-04-01T00:02:00Z',
        }],
      }),
    ])
    const reviewer = stubAgent('reviewer-agent')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ reviewer }),
      gitDriver: new InMemoryGitDriver({ clean: true, currentBranch: 'main' }),
    })

    const out = await orch.tick()

    expect(reviewer.calls).toHaveLength(0)
    expect(out.kind).toBe('processed')
    if (out.kind === 'processed') {
      expect(out.agent).toBe('coordinator-remediation')
      expect(out.afterStatus).toBe('in_progress')
    }
    const task = (await readQueue()).tasks.find(candidate => candidate.id === 'artifact-patch')!
    expect(task.notes.at(-1)?.content).toContain('stale worker self-critique without project-file changes')
  })

  it('gives mutation-first instructions after rejecting a false worker self-critique', async () => {
    await writeQueue([
      mkTask({
        id: 'artifact-patch',
        status: 'in_progress',
        assignedTo: 'worker-agent',
        title: 'policy-note-overreach',
        description: 'Append a new bullet to RELEASE_NOTES.md and do not edit any other file.',
        spec: 'Append the exact bullet to RELEASE_NOTES.md.',
        notes: [{
          agentId: 'coordinator',
          role: 'worker-progress-review',
          content:
            'Guildhall rejected the last worker self-critique without project-file changes outside `.guildhall`. Resume implementation by creating or editing the likely target files, then run focused verification before writing another self-critique.',
          timestamp: '2026-04-01T00:02:00Z',
        }],
      }),
    ])

    const worker = stubAgent('worker-agent')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
      gitDriver: new InMemoryGitDriver({ clean: true, currentBranch: 'main' }),
    })

    await orch.tick()

    expect(worker.calls[0]?.prompt).toContain('Previous worker proof was rejected')
    expect(worker.calls[0]?.prompt).toContain('Your next action must be a concrete file mutation')
    expect(worker.calls[0]?.prompt).toContain('Do not write another self-critique')
  })

  it('gives mutation-first instructions after acceptance command gates reject narrated proof', async () => {
    await writeQueue([
      mkTask({
        id: 'artifact-patch',
        status: 'in_progress',
        assignedTo: 'worker-agent',
        title: 'policy-note-overreach',
        description: 'Append a new bullet to RELEASE_NOTES.md and do not edit any other file.',
        spec: 'Append the exact bullet to RELEASE_NOTES.md.',
        acceptanceCriteria: [
          {
            id: 'AC-1',
            description: 'RELEASE_NOTES.md contains benchmark artifact evidence.',
            verifiedBy: 'automated',
            command: "grep -q 'benchmark artifact evidence' RELEASE_NOTES.md",
            met: false,
          },
        ],
        gateResults: [{
          gateId: 'AC-1',
          type: 'hard',
          passed: false,
          checkedAt: '2026-04-01T00:03:00Z',
          output: "grep -q 'benchmark artifact evidence' RELEASE_NOTES.md — non-zero exit",
        }],
        notes: [{
          agentId: 'acceptance-command-gates',
          role: 'gate-checker',
          content: [
            'Acceptance command gates failed (1).',
            "- AC-1: grep -q 'benchmark artifact evidence' RELEASE_NOTES.md — non-zero exit",
            'Repair the implementation in the likely target files, then rerun the focused command gates before writing new proof.',
          ].join('\n'),
          timestamp: '2026-04-01T00:03:00Z',
        }],
      }),
    ])

    const worker = stubAgent('worker-agent')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
      gitDriver: new InMemoryGitDriver({ clean: true, currentBranch: 'main' }),
    })

    await orch.tick()

    expect(worker.calls[0]?.prompt).toContain('Acceptance command gates failed')
    expect(worker.calls[0]?.prompt).toContain('Your next action must be a concrete file mutation')
    expect(worker.calls[0]?.prompt).toContain('Do not write another self-critique')
  })

  it('bounces review back to implementation when a local-web self-critique has no project-file changes', async () => {
    await writeQueue([
      mkTask({
        id: 'pantry-live',
        status: 'review',
        assignedTo: 'reviewer-agent',
        title: 'Pantry Pulse app spec',
        spec: 'Build a local web app with browser-proofable UI.',
        notes: [{
          agentId: 'worker-agent',
          role: 'self-critique',
          content: [
            '**Self-critique:**',
            'For each acceptance criterion:',
            '- [AC-1]: Met — index.html exists.',
            '',
            'Minimum-scope check:',
            '- Files changed: index.html',
            '- Smallest useful change?: yes.',
            '- Anything to revert before review?: none',
            '',
            'Review proof packet:',
            '- Changed files / diff scope: index.html',
            '- Verification commands passed: pnpm build passed',
            '- Working hypothesis at handoff: ready.',
            '- Known gaps / follow-up: none',
          ].join('\n'),
          timestamp: '2026-04-01T00:02:00Z',
        }],
      }),
    ])
    const reviewer = stubAgent('reviewer-agent')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ reviewer }),
      gitDriver: new InMemoryGitDriver({ clean: true, currentBranch: 'main' }),
    })

    const out = await orch.tick()

    expect(reviewer.calls).toHaveLength(0)
    if (out.kind === 'processed') {
      expect(out.beforeStatus).toBe('review')
      expect(out.afterStatus).toBe('in_progress')
      expect(out.transitioned).toBe(true)
    }
    const task = (await readQueue()).tasks.find(candidate => candidate.id === 'pantry-live')!
    expect(task.status).toBe('in_progress')
    expect(task.assignedTo).toBe('worker-agent')
    expect(task.notes.at(-1)?.content).toContain('stale worker self-critique without project-file changes')
  })

  it('includes the tasks path and memory dir in the agent prompt', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'in_progress' })])
    const worker = stubAgent('worker-agent')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
    })
    await orch.tick()
    const [call] = worker.calls
    expect(call).toBeDefined()
    expect(call!.prompt).toContain(getProjectSystemStatePath(tmpDir, 'TASKS.json'))
    expect(call!.prompt).toContain(memoryDir)
  })

  it('writes a live review packet and injects it into the reviewer prompt', async () => {
    const worktree = path.join(tmpDir, 'task-worktree')
    await fs.mkdir(path.join(worktree, 'web/tests/unit/composables'), { recursive: true })
    execFileSync('git', ['init'], { cwd: worktree })
    await fs.writeFile(
      path.join(worktree, 'web/tests/unit/composables/use-presence.test.ts'),
      "import { describe, it, expect } from 'vitest'\n\ndescribe('usePresence', () => {\n  it('works', () => {\n    expect(true).toBe(true)\n  })\n})\n",
      'utf-8',
    )
    await writeQueue([
      mkTask({
        id: 'a',
        status: 'in_progress',
        worktreePath: worktree,
      }),
    ])
    const worker = stubAgent('worker-agent', async () => {
      const notes: Task['notes'] = [
        {
          agentId: 'worker-agent',
          role: 'self-critique',
          content: '**Self-critique:**\n- AC-1: Met — added focused unit coverage.',
          timestamp: '2026-04-01T00:02:00Z',
        } as any,
      ]
      appendFailureClassificationNote(
        { id: 'a', notes },
        classifyAgentFailure({
          taskId: 'a',
          touchedFiles: touchedFiles('web/tests/unit/composables/use-presence.test.ts'),
          verification: [
            commandEvidence({
              command: 'pnpm test -- use-presence',
              passed: false,
              summary:
                'web/tests/unit/composables/use-presence.test.ts(6,5): expected true to be false',
            }),
          ],
        }),
        {
          agentId: 'coordinator',
          timestamp: '2026-04-01T00:02:30Z',
        },
      )
      await mutateTask('a', {
        status: 'review',
        notes,
      })
    })
    const reviewer = stubAgent('reviewer-agent')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker, reviewer }),
    })

    await orch.tick()
    await orch.tick()

    const packet = await fs.readFile(taskHistoryPath('a', 'review-packet.md'), 'utf-8')
    expect(packet).toContain('## Changed File Excerpts')
    expect(packet).toContain('use-presence.test.ts')
    expect(packet).toContain('## Latest Self-Critique')
    expect(packet).toContain('added focused unit coverage')
    expect(packet).toContain('## Policy Decision Packet')
    expect(packet).toContain('Verification failed in files the worker already touched')
    expect(packet).toContain('repair_touched_file_failure')

    const [reviewCall] = reviewer.calls
    expect(reviewCall).toBeDefined()
    expect(reviewCall!.prompt).toContain('## Review Packet')
    expect(reviewCall!.prompt).toContain('use-presence.test.ts')
    expect(reviewCall!.prompt).toContain('added focused unit coverage')
    expect(reviewCall!.prompt).toContain('## Policy Decision Packet')
    expect(reviewCall!.prompt).toContain('repair_touched_file_failure')
  })

  it('marks UI review packets as missing visual evidence when no screenshots are recorded', async () => {
    const worktree = path.join(tmpDir, 'task-worktree')
    await fs.mkdir(worktree, { recursive: true })
    execFileSync('git', ['init'], { cwd: worktree, stdio: 'ignore' })
    await fs.writeFile(
      path.join(worktree, 'index.html'),
      '<!doctype html><html><body><h1>Pantry Pulse</h1></body></html>\n',
      'utf-8',
    )
    await writeQueue([
      mkTask({
        id: 'a',
        title: 'Build Pantry Pulse UI',
        description: 'Build a polished frontend UI for Pantry Pulse.',
        spec: '## Summary\nBuild a polished browser app with app-store-caliber visual design.',
        status: 'in_progress',
        worktreePath: worktree,
        notes: [{
          agentId: 'worker-agent',
          role: 'self-critique',
          content: 'Self-critique: UI implemented but no screenshot proof captured.',
          timestamp: '2026-04-01T00:02:00Z',
        }],
      }),
    ])
    const worker = stubAgent('worker-agent', async () => {
      await mutateTask('a', {
        status: 'review',
      })
    })
    const reviewer = stubAgent('reviewer-agent')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker, reviewer }),
    })

    await orch.tick()
    await orch.tick()

    const packet = await fs.readFile(taskHistoryPath('a', 'review-packet.md'), 'utf-8')
    expect(packet).toContain('## Visual Evidence')
    expect(packet).toContain('Missing desktop/mobile screenshot evidence')
    expect(packet).toContain('visual reviewers must not approve')
  })

  it('records reflection learning when completed work has a successful playbook', async () => {
    await writeQueue([
      mkTask({
        id: 'a',
        status: 'in_progress',
      }),
    ])
    const worker = stubAgent('worker-agent', async () => {
      await mutateTask('a', {
        status: 'done',
        notes: [
          {
            agentId: 'coordinator',
            role: 'recovery-playbook',
            content: JSON.stringify({
              status: 'succeeded',
              playbook: 'repair_touched_file_failure',
              summary: 'Focused invite repair succeeded.',
              allowedPaths: ['web/server/api/workspaces/[id]/invite.post.ts'],
            }),
            timestamp: '2026-05-18T20:04:00.000Z',
          } as any,
        ],
      })
    })
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
    })

    await orch.tick()

    const learning = readProjectLearning(memoryDir)
    expect(learning.suggestedLearnings[0]).toMatchObject({
      source: 'task',
      destination: 'project_memory',
      scope: 'project',
      status: 'suggested',
    })
    expect(learning.suggestedLearnings[0]?.summary).toContain('Focused invite repair succeeded')
  })

  it('uses implementation self-critique notes and filters command-shaped artifact paths from the review packet', async () => {
    const worktree = path.join(tmpDir, 'task-worktree-command-artifacts')
    await fs.mkdir(path.join(worktree, 'web/tests/unit/composables'), { recursive: true })
    await fs.mkdir(
      path.join(worktree, 'pnpm --filter @knit-app test -- tests', 'unit', 'composables'),
      { recursive: true },
    )
    execFileSync('git', ['init'], { cwd: worktree })
    await fs.writeFile(
      path.join(worktree, 'web/tests/unit/composables/use-collections.test.ts'),
      "import { describe, it, expect } from 'vitest'\n\ndescribe('useCollections', () => {\n  it('works', () => {\n    expect(true).toBe(true)\n  })\n})\n",
      'utf-8',
    )
    await fs.writeFile(
      path.join(
        worktree,
        'pnpm --filter @knit-app test -- tests',
        'unit',
        'composables',
        'junk.test.ts',
      ),
      'export {};\n',
      'utf-8',
    )
    await writeQueue([
      mkTask({
        id: 'a',
        status: 'in_progress',
        worktreePath: worktree,
      }),
    ])
    const worker = stubAgent('worker-agent', async () => {
      await mutateTask('a', {
        status: 'review',
        notes: [
          {
            agentId: 'worker-agent',
            role: 'implementation',
            content: '**Self-critique:**\n- AC-1: Met — added focused use-collections coverage.',
            timestamp: '2026-04-01T00:02:00Z',
          } as any,
        ],
      })
    })
    const reviewer = stubAgent('reviewer-agent')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker, reviewer }),
    })

    await orch.tick()
    await orch.tick()

    const packet = await fs.readFile(taskHistoryPath('a', 'review-packet.md'), 'utf-8')
    expect(packet).toContain('use-collections.test.ts')
    expect(packet).toContain('added focused use-collections coverage')
    expect(packet).not.toContain('pnpm --filter @knit-app test -- tests')

    const [reviewCall] = reviewer.calls
    expect(reviewCall).toBeDefined()
    expect(reviewCall!.prompt).toContain('added focused use-collections coverage')
    expect(reviewCall!.prompt).not.toContain('pnpm --filter @knit-app test -- tests')
  })

  it('uses worker-role self-critique notes in the review packet when the content is explicitly labeled', async () => {
    const worktree = path.join(tmpDir, 'task-worktree-worker-role-self-critique')
    await fs.mkdir(path.join(worktree, 'web/app/composables'), { recursive: true })
    execFileSync('git', ['init'], { cwd: worktree })
    await fs.writeFile(
      path.join(worktree, 'web/app/composables/use-workspace.ts'),
      'export function useWorkspace(): null { return null }\n',
      'utf-8',
    )
    await writeQueue([
      mkTask({
        id: 'a',
        status: 'review',
        worktreePath: worktree,
        notes: [
          {
            agentId: 'worker-agent',
            role: 'Worker',
            content: '**Self-critique:**\nFocused workspace typing verification passed.',
            timestamp: '2026-04-21T00:00:00Z',
          },
        ],
      }),
    ])
    const reviewer = stubAgent('reviewer-agent')

    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ reviewer }),
    })

    await orch.tick()

    expect(reviewer.calls[0]?.prompt).toContain('Focused workspace typing verification passed.')
  })

  it('uses implementer-role self-critique notes in the review packet when the content is explicitly labeled', async () => {
    const worktree = path.join(tmpDir, 'task-worktree-implementer-role-self-critique')
    await fs.mkdir(path.join(worktree, 'web/app/composables'), { recursive: true })
    execFileSync('git', ['init'], { cwd: worktree })
    await fs.writeFile(
      path.join(worktree, 'web/app/composables/use-workspace.ts'),
      'export function useWorkspace(): null { return null }\n',
      'utf-8',
    )
    await writeQueue([
      mkTask({
        id: 'a',
        status: 'review',
        worktreePath: worktree,
        notes: [
          {
            agentId: 'worker-agent',
            role: 'implementer',
            content: '**Self-critique:**\nFocused workspace typing verification passed.',
            timestamp: '2026-04-21T00:00:00Z',
          },
        ],
      }),
    ])
    const reviewer = stubAgent('reviewer-agent')

    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ reviewer }),
    })

    await orch.tick()

    expect(reviewer.calls[0]?.prompt).toContain('Focused workspace typing verification passed.')
  })

  it('uses worker persona-role self-critique notes in the review packet when the content is explicitly labeled', async () => {
    const worktree = path.join(tmpDir, 'task-worktree-worker-persona-self-critique')
    await fs.mkdir(path.join(worktree, 'web/server/api/pages/[id]'), { recursive: true })
    execFileSync('git', ['init'], { cwd: worktree })
    await fs.writeFile(
      path.join(worktree, 'web/server/api/pages/[id]/restore.post.ts'),
      'export default defineEventHandler(async () => ({ success: true }))\n',
      'utf-8',
    )
    await writeQueue([
      mkTask({
        id: 'a',
        status: 'review',
        worktreePath: worktree,
        notes: [
          {
            agentId: 'worker-agent',
            role: 'Backend Engineer',
            content: '**Self-critique:**\nFocused restore handler verification passed.',
            timestamp: '2026-04-21T00:00:00Z',
          },
        ],
      }),
    ])
    const reviewer = stubAgent('reviewer-agent')

    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ reviewer }),
    })

    await orch.tick()

    expect(reviewer.calls[0]?.prompt).toContain('Focused restore handler verification passed.')
  })

  it('injects buildContext output (task summary + markers) into the prompt', async () => {
    await writeQueue([
      mkTask({ id: 'a', status: 'in_progress', title: 'Unique title xyz' }),
    ])
    const worker = stubAgent('worker-agent')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
    })
    await orch.tick()
    const [call] = worker.calls
    expect(call).toBeDefined()
    expect(call!.prompt).toContain('FORGE CONTEXT')
    expect(call!.prompt).toContain('Unique title xyz')
  })
})

describe('Orchestrator.tick — revision counting', () => {
  it('increments revisionCount when review bounces back to in_progress', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'review', revisionCount: 0 })])
    const reviewer = stubAgent('reviewer-agent', async () => {
      await mutateTask('a', { status: 'in_progress' })
    })
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ reviewer }),
    })
    const out = await orch.tick()
    expect(out.kind).toBe('processed')
    if (out.kind === 'processed') expect(out.revisionCount).toBe(1)
    const q = await readQueue()
    expect(q.tasks[0]!.revisionCount).toBe(1)
    expect(q.tasks[0]!.assignedTo).toBe('worker-agent')
  })

  it('increments revisionCount when gate_check bounces back to in_progress', async () => {
    await writeQueue([
      mkTask({ id: 'a', status: 'gate_check', revisionCount: 1 }),
    ])
    const gc = stubAgent('gate-checker-agent', async () => {
      await mutateTask('a', { status: 'in_progress' })
    })
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ gateChecker: gc }),
    })
    const out = await orch.tick()
    if (out.kind === 'processed') expect(out.revisionCount).toBe(2)
    const q = await readQueue()
    expect(q.tasks[0]!.assignedTo).toBe('worker-agent')
  })

  it('does not increment revisionCount on forward transitions', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'review', revisionCount: 1 })])
    const reviewer = stubAgent('reviewer-agent', async () => {
      await mutateTask('a', { status: 'gate_check' })
    })
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ reviewer }),
    })
    const out = await orch.tick()
    if (out.kind === 'processed') expect(out.revisionCount).toBe(1)
  })

  it('blocks the task when revisionCount exceeds maxRevisions', async () => {
    await writeQueue([
      mkTask({ id: 'a', status: 'review', revisionCount: 3 }),
    ])
    const reviewer = stubAgent('reviewer-agent', async () => {
      await mutateTask('a', { status: 'in_progress' })
    })
    const orch = new Orchestrator({
      config: baseConfig({ maxRevisions: 3 }),
      agents: agentSet({ reviewer }),
    })
    const out = await orch.tick()
    expect(out.kind).toBe('blocked-max-revisions')
    const q = await readQueue()
    const task = q.tasks[0]!
    expect(task.status).toBe('blocked')
    expect(task.blockReason).toContain('maxRevisions')
  })

  it('advances to gate_check instead of blocking when max revisions follow a prior all-clear LLM review', async () => {
    await writeQueue([
      mkTask({
        id: 'a',
        status: 'review',
        revisionCount: 3,
        reviewVerdicts: [
          {
            verdict: 'revise',
            reviewerPath: 'llm',
            reason: 'LLM reviewer requested revision before parser recovery',
            reasoning: [
              '**Review:** AC-1 through AC-8: Met.',
              '',
              '**Rubric**',
              '- acceptance-criteria-met: yes',
              '- no-scope-creep: yes',
              '- conventions-followed: yes',
              '- no-regressions: yes',
            ].join('\n'),
            failingSignals: [],
            recordedAt: '2026-04-01T00:00:00Z',
          },
        ],
      }),
    ])
    const reviewer = stubAgent('reviewer-agent', async () => {
      await mutateTask('a', { status: 'in_progress' })
    })
    const orch = new Orchestrator({
      config: baseConfig({ maxRevisions: 3 }),
      agents: agentSet({ reviewer }),
    })

    const out = await orch.tick()

    expect(out.kind).toBe('processed')
    const q = await readQueue()
    const task = q.tasks[0]!
    expect(task.status).toBe('gate_check')
    expect(task.assignedTo).toBe('gate-checker-agent')
    expect(task.blockReason).toBeUndefined()
    expect(task.notes.at(-1)?.content).toContain('Skipped max-revision block')
  })

  it('self-heals a fresh retry window after a resolved max-revisions escalation before counting new revisions', async () => {
    await writeQueue([
      mkTask({
        id: 'a',
        status: 'review',
        revisionCount: 8,
        escalations: [
          {
            id: 'esc-a-1',
            taskId: 'a',
            agentId: 'reviewer-fanout',
            reason: 'max_revisions_exceeded',
            summary: 'Exceeded maxRevisions (3). Reviewer fan-out keeps rejecting.',
            raisedAt: '2026-04-01T00:00:00Z',
            resolvedAt: '2026-04-01T01:00:00Z',
            resolvedBy: 'human',
            resolution: 'Retry after guardrail fix.',
          },
        ],
      }),
    ])
    const reviewer = stubAgent('reviewer-agent', async () => {
      await mutateTask('a', { status: 'in_progress' })
    })
    const orch = new Orchestrator({
      config: baseConfig({ maxRevisions: 3 }),
      agents: agentSet({ reviewer }),
      now: () => '2026-04-01T02:00:00Z',
    })
    const out = await orch.tick()
    expect(out.kind).toBe('processed')
    if (out.kind === 'processed') expect(out.revisionCount).toBe(9)
    const q = await readQueue()
    const task = q.tasks[0]!
    expect(task.status).toBe('in_progress')
    expect(task.retryWindow).toEqual({
      startedAt: '2026-04-01T01:00:00Z',
      baseRevisionCount: 8,
    })
    expect(task.escalations).toHaveLength(1)
    expect(task.escalations[0]!.resolvedAt).toBe('2026-04-01T01:00:00Z')
  })
})

describe('Orchestrator.tick — progress logging (FR-09)', () => {
  it('writes a typed HEARTBEAT entry to local progress on a routine forward transition', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'in_progress' })])
    const worker = stubAgent('worker-agent', async () => {
      await mutateTask('a', { status: 'review' })
    })
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
      now: () => '2026-04-20T12:00:00Z',
    })
    await orch.tick()
    const progress = await fs.readFile(getProjectProgressHeartbeatsPath(tmpDir), 'utf-8')
    expect(progress).toContain('HEARTBEAT')
    expect(progress).toContain('2026-04-20T12:00:00Z')
    expect(progress).toContain('worker-agent')
    expect(progress).toContain('in_progress → review')
  })

  it('writes a MILESTONE entry when a task transitions to done', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'gate_check' })])
    const gc = stubAgent('gate-checker-agent', async () => {
      await mutateTask('a', { status: 'done' })
    })
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ gateChecker: gc }),
    })
    await orch.tick()
    const progress = await fs.readFile(progressPath, 'utf-8')
    expect(progress).toContain('MILESTONE')
  })

  it('auto-completes gate_check when fresh hard gate results are persisted without a status mutation', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'gate_check', gateResults: [] })])
    const gc = stubAgent('gate-checker-agent', async () => {
      await mutateTask('a', {
        gateResults: [
          {
            gateId: 'typecheck',
            type: 'hard',
            passed: true,
            checkedAt: '2026-05-04T00:00:00Z',
            output: 'ok',
          },
          {
            gateId: 'test',
            type: 'hard',
            passed: true,
            checkedAt: '2026-05-04T00:00:01Z',
            output: 'ok',
          },
        ] as any,
      })
    })
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ gateChecker: gc }),
    })

    const out = await orch.tick()
    expect(out.kind).toBe('processed')
    if (out.kind === 'processed') {
      expect(out.beforeStatus).toBe('gate_check')
      expect(out.afterStatus).toBe('done')
      expect(out.agent).toBe('gate-checker-agent')
    }

    const queue = await readQueue()
    expect(queue.tasks[0]!.status).toBe('done')
    expect(queue.tasks[0]!.gateResults.filter((gate) => gate.type === 'hard')).toHaveLength(2)
  })

  it('bounces gate_check back to in_progress when fresh hard gate results include a failure', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'gate_check', gateResults: [] })])
    const gc = stubAgent('gate-checker-agent', async () => {
      await mutateTask('a', {
        gateResults: [
          {
            gateId: 'typecheck',
            type: 'hard',
            passed: false,
            checkedAt: '2026-05-04T00:00:00Z',
            output: 'typecheck failed',
          },
          {
            gateId: 'test',
            type: 'hard',
            passed: true,
            checkedAt: '2026-05-04T00:00:01Z',
            output: 'ok',
          },
        ] as any,
      })
    })
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ gateChecker: gc }),
    })

    const out = await orch.tick()
    expect(out.kind).toBe('processed')
    if (out.kind === 'processed') {
      expect(out.beforeStatus).toBe('gate_check')
      expect(out.afterStatus).toBe('in_progress')
      expect(out.agent).toBe('gate-checker-agent')
    }

    const queue = await readQueue()
    expect(queue.tasks[0]!.status).toBe('in_progress')
    expect(queue.tasks[0]!.assignedTo).toBe('worker-agent')
    expect(queue.tasks[0]!.gateResults.filter((gate) => gate.type === 'hard')).toHaveLength(2)
  })

  it('runs acceptance command gates before gate-checker narration can mark false proof green', async () => {
    const projectPath = path.join(tmpDir, 'acceptance-command-gates')
    await fs.mkdir(projectPath, { recursive: true })
    execFileSync('git', ['init'], { cwd: projectPath, stdio: 'ignore' })
    await fs.writeFile(path.join(projectPath, 'RELEASE_NOTES.md'), '# Release Notes\n\n- Placeholder note.\n', 'utf8')

    await writeQueue([
      mkTask({
        id: 'artifact-patch',
        status: 'gate_check',
        assignedTo: 'gate-checker-agent',
        projectPath,
        acceptanceCriteria: [
          {
            id: 'AC-1',
            description: 'RELEASE_NOTES.md contains benchmark artifact evidence.',
            verifiedBy: 'automated',
            command: "grep -q 'benchmark artifact evidence' RELEASE_NOTES.md",
            met: true,
          },
        ],
        notes: [{
          agentId: 'worker-agent',
          role: 'self-critique',
          content: [
            '**Self-critique:**',
            '- AC1: Met — claimed grep passed.',
            '',
            'Minimum-scope check:',
            '- Files changed: RELEASE_NOTES.md.',
            '',
            'Review proof packet:',
            '- Changed files / diff scope: RELEASE_NOTES.md.',
            '- Verification commands passed: grep passed.',
          ].join('\n'),
          timestamp: '2026-04-01T00:02:00Z',
        }],
      }),
    ])
    const gateChecker = stubAgent('gate-checker-agent', async () => {
      throw new Error('gate-checker should not run before authoritative command gates')
    })
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ gateChecker }),
    })

    const out = await orch.tick()

    expect(gateChecker.calls).toHaveLength(0)
    expect(out.kind).toBe('processed')
    if (out.kind === 'processed') {
      expect(out.beforeStatus).toBe('gate_check')
      expect(out.afterStatus).toBe('in_progress')
      expect(out.transitioned).toBe(true)
    }
    const task = (await readQueue()).tasks.find(candidate => candidate.id === 'artifact-patch')!
    expect(task.acceptanceCriteria[0]?.met).toBe(false)
    expect(task.gateResults.at(-1)).toMatchObject({
      gateId: 'AC-1',
      type: 'hard',
      passed: false,
    })
    expect(task.notes.at(-1)?.content).toContain('Acceptance command gates failed')
  })

  it('ignores Guildhall bookkeeping when acceptance git-diff gates check task file scope', async () => {
    const projectPath = path.join(tmpDir, 'acceptance-command-git-scope')
    await fs.mkdir(path.join(projectPath, '.guildhall'), { recursive: true })
    execFileSync('git', ['init'], { cwd: projectPath, stdio: 'ignore' })
    await fs.writeFile(path.join(projectPath, 'RELEASE_NOTES.md'), '# Release Notes\n\n- Placeholder note.\n', 'utf8')
    execFileSync('git', ['add', 'RELEASE_NOTES.md'], { cwd: projectPath, stdio: 'ignore' })
    execFileSync('git', ['commit', '-m', 'seed'], {
      cwd: projectPath,
      stdio: 'ignore',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Test',
        GIT_AUTHOR_EMAIL: 'test@example.com',
        GIT_COMMITTER_NAME: 'Test',
        GIT_COMMITTER_EMAIL: 'test@example.com',
      },
    })
    await fs.appendFile(path.join(projectPath, 'RELEASE_NOTES.md'), '- Added benchmark artifact evidence.\n')
    await fs.writeFile(path.join(projectPath, '.guildhall', 'TASKS.json'), '{"version":1}\n', 'utf8')

    await writeQueue([
      mkTask({
        id: 'artifact-patch',
        status: 'gate_check',
        assignedTo: 'gate-checker-agent',
        projectPath,
        acceptanceCriteria: [
          {
            id: 'AC-1',
            description: 'Only RELEASE_NOTES.md changed.',
            verifiedBy: 'automated',
            command: "git diff --name-only --exit-code -- . ':!RELEASE_NOTES.md'",
            met: false,
          },
        ],
      }),
    ])

    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ gateChecker: stubAgent('gate-checker-agent') }),
    })

    const out = await orch.tick()

    expect(out.kind).toBe('processed')
    if (out.kind === 'processed') {
      expect(out.agent).toBe('acceptance-command-gates')
      expect(out.afterStatus).toBe('done')
    }
    const task = (await readQueue()).tasks.find(candidate => candidate.id === 'artifact-patch')!
    expect(task.acceptanceCriteria[0]?.met).toBe(true)
    expect(task.gateResults[0]).toMatchObject({
      gateId: 'AC-1',
      type: 'hard',
      passed: true,
    })
  })

  it('applies Guildhall bookkeeping exclusions to git-diff gates before a shell pipeline', async () => {
    const projectPath = path.join(tmpDir, 'acceptance-command-git-pipe-scope')
    await fs.mkdir(path.join(projectPath, '.guildhall'), { recursive: true })
    execFileSync('git', ['init'], { cwd: projectPath, stdio: 'ignore' })
    await fs.writeFile(path.join(projectPath, 'RELEASE_NOTES.md'), '# Release Notes\n\n- Placeholder note.\n', 'utf8')
    execFileSync('git', ['add', 'RELEASE_NOTES.md'], { cwd: projectPath, stdio: 'ignore' })
    execFileSync('git', ['commit', '-m', 'seed'], {
      cwd: projectPath,
      stdio: 'ignore',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Test',
        GIT_AUTHOR_EMAIL: 'test@example.com',
        GIT_COMMITTER_NAME: 'Test',
        GIT_COMMITTER_EMAIL: 'test@example.com',
      },
    })
    await fs.appendFile(path.join(projectPath, 'RELEASE_NOTES.md'), '- Added benchmark artifact evidence.\n')
    await fs.writeFile(path.join(projectPath, '.guildhall', 'TASKS.json'), '{"version":1}\n', 'utf8')

    await writeQueue([
      mkTask({
        id: 'artifact-patch',
        status: 'gate_check',
        assignedTo: 'gate-checker-agent',
        projectPath,
        acceptanceCriteria: [
          {
            id: 'AC-1',
            description: 'Only RELEASE_NOTES.md changed.',
            verifiedBy: 'automated',
            command: "git diff --stat --name-only | grep -q '^RELEASE_NOTES.md$'",
            met: false,
          },
        ],
      }),
    ])

    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ gateChecker: stubAgent('gate-checker-agent') }),
    })

    const out = await orch.tick()

    expect(out.kind).toBe('processed')
    if (out.kind === 'processed') {
      expect(out.agent).toBe('acceptance-command-gates')
      expect(out.afterStatus).toBe('done')
    }
    const task = (await readQueue()).tasks.find(candidate => candidate.id === 'artifact-patch')!
    expect(task.acceptanceCriteria[0]?.met).toBe(true)
    expect(task.gateResults[0]).toMatchObject({
      gateId: 'AC-1',
      type: 'hard',
      passed: true,
    })
    expect(task.gateResults[0]?.output).not.toContain('grep: :!.guildhall')
  })

  it('runs acceptance command gates in the active task worktree when one exists', async () => {
    const projectPath = path.join(tmpDir, 'acceptance-command-project-copy')
    const worktreePath = path.join(tmpDir, 'acceptance-command-task-worktree')
    await fs.mkdir(projectPath, { recursive: true })
    await fs.mkdir(path.join(worktreePath, '.guildhall'), { recursive: true })
    await fs.writeFile(path.join(projectPath, 'RELEASE_NOTES.md'), '# Release Notes\n\n- Placeholder note.\n', 'utf8')
    execFileSync('git', ['init'], { cwd: worktreePath, stdio: 'ignore' })
    await fs.writeFile(path.join(worktreePath, 'RELEASE_NOTES.md'), '# Release Notes\n\n- Placeholder note.\n', 'utf8')
    execFileSync('git', ['add', 'RELEASE_NOTES.md'], { cwd: worktreePath, stdio: 'ignore' })
    execFileSync('git', ['commit', '-m', 'seed'], {
      cwd: worktreePath,
      stdio: 'ignore',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Test',
        GIT_AUTHOR_EMAIL: 'test@example.com',
        GIT_COMMITTER_NAME: 'Test',
        GIT_COMMITTER_EMAIL: 'test@example.com',
      },
    })
    await fs.appendFile(path.join(worktreePath, 'RELEASE_NOTES.md'), '- Added benchmark artifact evidence.\n')
    await fs.writeFile(path.join(worktreePath, '.guildhall', 'TASKS.json'), '{"version":1}\n', 'utf8')

    await writeQueue([
      mkTask({
        id: 'artifact-patch',
        status: 'gate_check',
        assignedTo: 'gate-checker-agent',
        projectPath,
        worktreePath,
        acceptanceCriteria: [
          {
            id: 'AC-1',
            description: 'RELEASE_NOTES.md contains benchmark artifact evidence.',
            verifiedBy: 'automated',
            command: "grep -q 'benchmark artifact evidence' RELEASE_NOTES.md",
            met: false,
          },
          {
            id: 'AC-2',
            description: 'Only RELEASE_NOTES.md changed.',
            verifiedBy: 'automated',
            command: "git diff --name-only | grep -q '^RELEASE_NOTES.md$'",
            met: false,
          },
        ],
      }),
    ])

    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ gateChecker: stubAgent('gate-checker-agent') }),
    })

    const out = await orch.tick()

    expect(out.kind).toBe('processed')
    if (out.kind === 'processed') {
      expect(out.agent).toBe('acceptance-command-gates')
      expect(out.afterStatus).toBe('done')
    }
    const task = (await readQueue()).tasks.find(candidate => candidate.id === 'artifact-patch')!
    expect(task.acceptanceCriteria.every((criterion) => criterion.met)).toBe(true)
    expect(await fs.readFile(path.join(projectPath, 'RELEASE_NOTES.md'), 'utf8')).not.toContain('benchmark artifact evidence')
  })

  it('lands accepted command-gated task work before cleaning up the task worktree', async () => {
    const projectPath = path.join(tmpDir, 'acceptance-command-land-project')
    const worktreePath = path.join(tmpDir, 'acceptance-command-land-worktree')
    await fs.mkdir(projectPath, { recursive: true })
    execFileSync('git', ['init', '-b', 'main'], { cwd: projectPath, stdio: 'ignore' })
    execFileSync('git', ['config', 'user.name', 'Guildhall Test'], { cwd: projectPath, stdio: 'ignore' })
    execFileSync('git', ['config', 'user.email', 'guildhall-tests@example.com'], { cwd: projectPath, stdio: 'ignore' })
    await fs.writeFile(path.join(projectPath, 'RELEASE_NOTES.md'), '# Release Notes\n\n- Placeholder note.\n', 'utf8')
    execFileSync('git', ['add', 'RELEASE_NOTES.md'], { cwd: projectPath, stdio: 'ignore' })
    execFileSync('git', ['commit', '-m', 'seed'], { cwd: projectPath, stdio: 'ignore' })
    execFileSync('git', ['worktree', 'add', '-b', 'guildhall/task-task-001', worktreePath, 'main'], {
      cwd: projectPath,
      stdio: 'ignore',
    })
    execFileSync('git', ['config', 'user.name', 'Guildhall Test'], { cwd: worktreePath, stdio: 'ignore' })
    execFileSync('git', ['config', 'user.email', 'guildhall-tests@example.com'], { cwd: worktreePath, stdio: 'ignore' })
    await fs.appendFile(path.join(worktreePath, 'RELEASE_NOTES.md'), '- Added benchmark artifact evidence.\n')

    await writeQueue([
      mkTask({
        id: 'artifact-patch',
        status: 'gate_check',
        assignedTo: 'gate-checker-agent',
        projectPath,
        worktreePath,
        branchName: 'guildhall/task-task-001',
        baseBranch: 'main',
        acceptanceCriteria: [
          {
            id: 'AC-1',
            description: 'RELEASE_NOTES.md contains benchmark artifact evidence.',
            verifiedBy: 'automated',
            command: "grep -q 'benchmark artifact evidence' RELEASE_NOTES.md",
            met: false,
          },
        ],
      }),
    ])

    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ gateChecker: stubAgent('gate-checker-agent') }),
    })

    const out = await orch.tick()

    expect(out.kind).toBe('processed')
    if (out.kind === 'processed') {
      expect(out.agent).toBe('acceptance-command-gates')
      expect(out.afterStatus).toBe('done')
    }
    const projectReleaseNotes = await fs.readFile(path.join(projectPath, 'RELEASE_NOTES.md'), 'utf8')
    expect(projectReleaseNotes).toContain('- Added benchmark artifact evidence.')
    const task = (await readQueue()).tasks.find(candidate => candidate.id === 'artifact-patch')!
    expect(task.mergeRecord).toMatchObject({
      fromBranch: 'guildhall/task-task-001',
      toBranch: 'main',
      result: 'merged',
    })
  })

  it('skips qualitative review for lean command-backed tasks and hands them to command gates', async () => {
    await writeQueue([
      mkTask({
        id: 'artifact-patch',
        status: 'review',
        assignedTo: 'reviewer-agent',
        acceptanceCriteria: [
          {
            id: 'AC-1',
            description: 'RELEASE_NOTES.md contains benchmark artifact evidence.',
            verifiedBy: 'automated',
            command: "grep -q 'benchmark artifact evidence' RELEASE_NOTES.md",
            met: true,
          },
        ],
        sizePlan: {
          taskId: 'artifact-patch',
          score: 1,
          band: 'tiny',
          action: 'proceed',
          factors: [],
          recommendedChildren: [],
          reviewBudgetHint: 'lean',
          reasons: ['Single command-backed artifact patch.'],
          createdAt: '2026-05-29T12:00:00.000Z',
          createdBy: 'test',
        },
      }),
    ])
    const reviewer = stubAgent('reviewer-agent', async () => {
      throw new Error('reviewer should not run for a lean command-backed patch')
    })
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ reviewer }),
    })

    const out = await orch.tick()

    expect(reviewer.calls).toHaveLength(0)
    expect(out.kind).toBe('processed')
    if (out.kind === 'processed') {
      expect(out.agent).toBe('lean-command-review')
      expect(out.afterStatus).toBe('gate_check')
    }
  })

  it('treats unrelated typecheck failures as scoped exceptions when a resolved human decision says broader repo-red is out of scope', async () => {
    await writeQueue([
      mkTask({
        id: 'a',
        status: 'gate_check',
        gateResults: [],
        acceptanceCriteria: [
          {
            id: 'ac-12',
            description: 'Focused unit test passes',
            verifiedBy: 'automated',
            met: true,
            command: 'pnpm test -- --run tests/unit/composables/use-presence.test.ts',
          } as any,
        ],
        escalations: [
          {
            id: 'esc-task-011-5',
            taskId: 'a',
            agentId: 'worker-agent',
            reason: 'decision_required',
            summary: 'Authoritative typecheck is failing on unrelated file web/app/composables/use-presence.test.ts.',
            details: 'Keep broader unrelated repo-red findings out of scope unless the same file set is touched.',
            raisedAt: '2026-05-05T18:02:12.245Z',
            resolvedAt: '2026-05-05T18:08:41.075Z',
            resolvedBy: 'human',
            resolution: 'Treat AC13 as scoped to this tasks changed target for now. Continue the task by relying on the focused unit-test verification and keep any broader unrelated repo-red findings out of scope unless the same file set is touched.',
          } as any,
        ],
      }),
    ])
    const gc = stubAgent('gate-checker-agent', async () => {
      await mutateTask('a', {
        gateResults: [
          {
            gateId: 'typecheck',
            type: 'hard',
            passed: false,
            checkedAt: '2026-05-05T20:07:42.704Z',
            output: [
              `> web@ typecheck ${path.join(tmpDir, 'web')}`,
              "app/composables/use-presence.test.ts(3,23): error TS2305: Module '\"./use-presence\"' has no exported member 'buildPayload'.",
            ].join('\n'),
          },
          {
            gateId: 'test',
            type: 'hard',
            passed: true,
            checkedAt: '2026-05-05T20:07:52.834Z',
            output: 'focused test passed',
          },
        ] as any,
      })
    })
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ gateChecker: gc }),
    })

    const out = await orch.tick()
    expect(out.kind).toBe('processed')
    if (out.kind === 'processed') {
      expect(out.beforeStatus).toBe('gate_check')
      expect(out.afterStatus).toBe('done')
      expect(out.agent).toBe('gate-checker-agent')
    }

    const queue = await readQueue()
    expect(queue.tasks[0]!.status).toBe('done')
    expect(queue.tasks[0]!.notes.at(-1)?.content).toContain('Gate-check scope exception applied')
  })

  it('treats unrelated hard test failures as scoped exceptions when they are outside the tasks likely target files', async () => {
    await writeQueue([
      mkTask({
        id: 'a',
        status: 'gate_check',
        gateResults: [],
        spec: [
          '## Summary',
          '- Update `web/app/composables/use-workspace.ts` to adopt the generated Supabase types.',
          '- Verify `web/app/types/supabase.ts` remains the generated source of truth.',
        ].join('\n'),
        acceptanceCriteria: [
          {
            id: 'ac-1',
            description: 'Regenerate types and keep the use-workspace consumer valid.',
            verifiedBy: 'automated',
            met: true,
            command: 'pnpm vitest --run web/tests/unit/composables/use-workspace.test.ts',
          } as any,
        ],
      }),
    ])
    const gc = stubAgent('gate-checker-agent', async () => {
      await mutateTask('a', {
        gateResults: [
          {
            gateId: 'test',
            type: 'hard',
            passed: false,
            checkedAt: '2026-05-08T17:47:25.289Z',
            output: [
              `> web@ test ${path.join(tmpDir, 'web')}`,
              'FAIL tests/unit/components/app-shell.render.test.ts > app shell organism rendering > AppTopBar emits drawer event and opens search on workspace pages',
              'FAIL tests/unit/pages/login-callback-index.flow.test.ts > login/callback/index flow > moves login to Google sign-in step from workspace entry',
            ].join('\n'),
          },
        ] as any,
      })
    })
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ gateChecker: gc }),
    })

    const out = await orch.tick()
    expect(out.kind).toBe('processed')
    if (out.kind === 'processed') {
      expect(out.beforeStatus).toBe('gate_check')
      expect(out.afterStatus).toBe('done')
      expect(out.agent).toBe('gate-checker-agent')
    }

    const queue = await readQueue()
    expect(queue.tasks[0]!.status).toBe('done')
    expect(queue.tasks[0]!.notes.at(-1)?.content).toContain('Gate-check scope exception applied')
    expect(queue.tasks[0]!.notes.at(-1)?.content).toContain('test:')
  })

  it('completes gate_check from recorded passing hard gates without another model turn', async () => {
    await writeQueue([
      mkTask({
        id: 'a',
        status: 'gate_check',
        gateResults: [{
          gateId: 'npm-run-build',
          type: 'hard',
          passed: true,
          checkedAt: '2026-07-04T10:07:21.557Z',
          output: 'npm run build passed',
        }],
      }),
    ])
    const gc = stubAgent('gate-checker-agent', async () => {
      throw new Error('gate-checker should not run when recorded hard gates already passed')
    })
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ gateChecker: gc }),
    })

    const out = await orch.tick()

    expect(gc.calls).toHaveLength(0)
    expect(out.kind).toBe('processed')
    if (out.kind === 'processed') {
      expect(out.beforeStatus).toBe('gate_check')
      expect(out.afterStatus).toBe('done')
      expect(out.agent).toBe('recorded-hard-gates')
    }
    const queue = await readQueue()
    expect(queue.tasks[0]!.status).toBe('done')
    expect(queue.tasks[0]!.notes.at(-1)?.content).toContain('recorded passing hard gates')
  })

  it('preserves gate_check when the gate checker times out after recording passing hard gates', async () => {
    await writeQueue([
      mkTask({
        id: 'a',
        status: 'gate_check',
        gateResults: [],
      }),
    ])
    const gc = stubAgent('gate-checker-agent', async () => {
      await mutateTask('a', {
        gateResults: [{
          gateId: 'npm-run-build',
          type: 'hard',
          passed: true,
          checkedAt: '2026-07-04T10:07:21.557Z',
          output: 'npm run build passed',
        }] as any,
      })
      throw new Error('gate-checker-agent timed out after 120000ms of inactivity')
    })
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ gateChecker: gc }),
    })

    const out = await orch.tick()

    expect(out.kind).toBe('processed')
    if (out.kind === 'processed') {
      expect(out.beforeStatus).toBe('gate_check')
      expect(out.afterStatus).toBe('gate_check')
      expect(out.agent).toBe('gate-checker-agent')
    }
    const queue = await readQueue()
    expect(queue.tasks[0]!.status).toBe('gate_check')
    expect(queue.tasks[0]!.notes.at(-1)?.content).toContain('timed out after recording passing hard gates')
  })

  it('lets scoped gate adjudication overrule a pessimistic gate-checker bounce for unrelated hard test failures', async () => {
    await writeQueue([
      mkTask({
        id: 'a',
        status: 'gate_check',
        gateResults: [],
        spec: [
          '## Summary',
          '- Remove the unused `deleteTrashRes` binding in `web/server/api/pages/[id]/restore.post.ts`.',
          '- Keep restore behavior unchanged.',
        ].join('\n'),
        acceptanceCriteria: [
          {
            id: 'ac-1',
            description: 'Lint no longer warns about deleteTrashRes.',
            verifiedBy: 'automated',
            met: true,
            command: 'pnpm --dir web lint',
          } as any,
        ],
      }),
    ])
    const gc = stubAgent('gate-checker-agent', async () => {
      await mutateTask('a', {
        status: 'in_progress',
        assignedTo: 'worker-agent',
        gateResults: [
          {
            gateId: 'test',
            type: 'hard',
            passed: false,
            checkedAt: '2026-05-09T15:23:48.222Z',
            output: [
              `> web@ test ${path.join(tmpDir, 'web')}`,
              'FAIL tests/unit/components/app-shell.render.test.ts > app shell organism rendering > AppTopBar emits drawer event and opens search on workspace pages',
              'FAIL tests/unit/pages/login-callback-index.flow.test.ts > login/callback/index flow > moves login to Google sign-in step from workspace entry',
            ].join('\n'),
          },
        ] as any,
      })
    })
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ gateChecker: gc }),
    })

    const out = await orch.tick()
    expect(out.kind).toBe('processed')
    if (out.kind === 'processed') {
      expect(out.beforeStatus).toBe('gate_check')
      expect(out.afterStatus).toBe('done')
      expect(out.agent).toBe('gate-checker-agent')
    }

    const queue = await readQueue()
    expect(queue.tasks[0]!.status).toBe('done')
    expect(queue.tasks[0]!.revisionCount).toBe(0)
    expect(queue.tasks[0]!.notes.at(-1)?.content).toContain('Gate-check scope exception applied')
    expect(queue.tasks[0]!.notes.at(-1)?.content).toContain('test:')
  })

  it('does NOT write a PROGRESS.md entry when the agent ran but no transition occurred', async () => {
    // No-op ticks are noise in the on-disk progress history. Orchestrator-
    // alive signal belongs in the ephemeral SSE stream, not PROGRESS.md.
    await writeQueue([mkTask({ id: 'a', status: 'in_progress' })])
    const worker = stubAgent('worker-agent')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
    })
    await orch.tick()
    const progress = await fs
      .readFile(progressPath, 'utf-8')
      .catch(() => '')
    expect(progress).not.toContain('HEARTBEAT')
    expect(progress).not.toContain('unchanged')
  })

  it('writes a recovery checkpoint and bumps updatedAt when a worker pass leaves dirty verified progress without a status transition', async () => {
    const worktreePath = path.join(tmpDir, '.guildhall', 'worktrees', 'worker-progress')
    await fs.mkdir(path.join(worktreePath, 'web', 'tests', 'unit', 'composables'), { recursive: true })
    await fs.writeFile(
      path.join(worktreePath, 'web', 'tests', 'unit', 'composables', 'use-collections.test.ts'),
      'test("works", () => {})\n',
      'utf8',
    )
    execFileSync('git', ['init'], { cwd: worktreePath, stdio: 'ignore' })

    await writeQueue([
      mkTask({
        id: 'worker-progress',
        status: 'in_progress',
        worktreePath,
        updatedAt: '2026-04-01T00:00:00Z',
      }),
    ])

    const worker: StubAgent = {
      name: 'worker-agent',
      calls: [],
      async generate(prompt: string) {
        this.calls.push({ prompt })
        return { text: 'Implemented the test update and verified the focused behavior.' }
      },
      getToolMetadata() {
        return {
          review_handoff_evidence: {
            taskId: 'worker-progress',
            inspectedImplementationFile: true,
            changedOrVerified: true,
          },
          recent_verified_work: [
            'Ran bash command cd web && pnpm vitest --run tests/unit/composables/use-collections.test.ts [PASS]',
            `Edited file ${path.join(worktreePath, 'web', 'tests', 'unit', 'composables', 'use-collections.test.ts')}`,
          ],
        }
      },
    }
    const gitDriver = new InMemoryGitDriver()
    gitDriver.setClean(false)
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
      gitDriver,
    })

    const out = await orch.tick()
    expect(out.kind).toBe('processed')
    if (out.kind === 'processed') {
      expect(out.beforeStatus).toBe('in_progress')
      expect(out.afterStatus).toBe('in_progress')
      expect(out.transitioned).toBe(false)
    }

    const queue = await readQueue()
    const task = queue.tasks.find((candidate) => candidate.id === 'worker-progress')
    expect(task?.updatedAt).not.toBe('2026-04-01T00:00:00Z')

    const checkpointPath = taskHistoryPath('worker-progress', 'checkpoint.json')
    const checkpoint = JSON.parse(await fs.readFile(checkpointPath, 'utf8')) as {
      intent: string
      nextPlannedAction: string
      filesTouched: string[]
    }
    expect(checkpoint.intent).toContain('worker pass ended with dirty worktree progress but no status transition')
    expect(checkpoint.intent).toContain('Ran bash command cd web && pnpm vitest')
    expect(checkpoint.filesTouched).toContain('web/tests/unit/composables/use-collections.test.ts')
    expect(checkpoint.nextPlannedAction).toContain('rerun the focused verification commands')
    expect(checkpoint.nextPlannedAction).not.toContain('hand off to review')
  })

  it('treats dirty likely-target files in the main project checkout as durable worker progress', async () => {
    const projectPath = path.join(tmpDir, 'worker-likely-target-progress')
    const editedFile = path.join(projectPath, 'packages', 'converter', 'test', 'jsdoc-to-ts.test.ts')
    await fs.mkdir(path.dirname(editedFile), { recursive: true })
    await fs.writeFile(editedFile, 'it("round trips", () => {})\n', 'utf8')
    execFileSync('git', ['init'], { cwd: projectPath, stdio: 'ignore' })

    await writeQueue([
      mkTask({
        id: 'worker-likely-target-progress',
        status: 'in_progress',
        projectPath,
        updatedAt: '2026-04-01T00:00:00Z',
        spec: 'Likely target file: `packages/converter/test/jsdoc-to-ts.test.ts`',
        acceptanceCriteria: [
          {
            id: 'ac-1',
            description: 'Focused converter tests pass.',
            verifiedBy: 'automated',
            command: 'pnpm --dir packages/converter vitest run packages/converter/test/jsdoc-to-ts.test.ts',
            met: false,
          },
        ],
      }),
    ])

    const worker: StubAgent = {
      name: 'worker-agent',
      calls: [],
      async generate(prompt: string) {
        this.calls.push({ prompt })
        return { text: 'Focused converter tests still fail; next step is to fix the JSDoc-to-TS round-trip.' }
      },
      getToolMetadata() {
        return {
          review_handoff_evidence: {
            taskId: 'worker-likely-target-progress',
            inspectedImplementationFile: true,
            changedOrVerified: true,
          },
          recent_verified_work: [
            'Ran bash command pnpm --dir packages/converter vitest run test/jsdoc-to-ts.test.ts [FAIL]',
          ],
        }
      },
    }
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
      gitDriver: new InMemoryGitDriver(),
    })

    const out = await orch.tick()
    expect(out.kind).toBe('processed')
    if (out.kind === 'processed') {
      expect(out.beforeStatus).toBe('in_progress')
      expect(out.afterStatus).toBe('in_progress')
      expect(out.transitioned).toBe(false)
    }

    const queue = await readQueue()
    const task = queue.tasks.find((candidate) => candidate.id === 'worker-likely-target-progress')
    expect(task?.updatedAt).not.toBe('2026-04-01T00:00:00Z')

    const checkpointPath = taskHistoryPath('worker-likely-target-progress', 'checkpoint.json')
    const checkpoint = JSON.parse(await fs.readFile(checkpointPath, 'utf8')) as {
      intent: string
      nextPlannedAction: string
      filesTouched: string[]
    }
    expect(checkpoint.intent).toContain('dirty likely-target files in the main project checkout')
    expect(checkpoint.filesTouched).toContain(path.join('packages', 'converter', 'test', 'jsdoc-to-ts.test.ts'))
    expect(checkpoint.nextPlannedAction).toContain('rerun the focused verification commands')
    expect(checkpoint.nextPlannedAction).not.toContain('hand off to review')
  })

  it('writes a recovery checkpoint and bumps updatedAt when a worker pass leaves clean verified progress without a status transition', async () => {
    const worktreePath = path.join(tmpDir, '.guildhall', 'worktrees', 'worker-clean-progress')
    await fs.mkdir(path.join(worktreePath, 'web', 'app', 'types'), { recursive: true })
    await fs.writeFile(
      path.join(worktreePath, 'web', 'app', 'types', 'supabase.ts'),
      'export interface Database {}\n',
      'utf8',
    )
    execFileSync('git', ['init'], { cwd: worktreePath, stdio: 'ignore' })

    await writeQueue([
      mkTask({
        id: 'worker-clean-progress',
        status: 'in_progress',
        worktreePath,
        updatedAt: '2026-04-01T00:00:00Z',
      }),
    ])

    const worker: StubAgent = {
      name: 'worker-agent',
      calls: [],
      async generate(prompt: string) {
        this.calls.push({ prompt })
        return { text: 'Verified the generated types and inspected the target file.' }
      },
      getToolMetadata() {
        return {
          review_handoff_evidence: {
            taskId: 'worker-clean-progress',
            inspectedImplementationFile: true,
            changedOrVerified: true,
          },
          recent_verified_work: [
            'Ran bash command pnpm db:types:remote [PASS]',
            `Read file ${path.join(worktreePath, 'web', 'app', 'types', 'supabase.ts')}`,
          ],
          current_task_checkpoint_files_touched: ['web/app/types/supabase.ts'],
        }
      },
    }
    const gitDriver = new InMemoryGitDriver()
    gitDriver.setClean(true)
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
      gitDriver,
    })

    const out = await orch.tick()
    expect(out.kind).toBe('processed')
    if (out.kind === 'processed') {
      expect(out.beforeStatus).toBe('in_progress')
      expect(out.afterStatus).toBe('in_progress')
      expect(out.transitioned).toBe(false)
    }

    const queue = await readQueue()
    const task = queue.tasks.find((candidate) => candidate.id === 'worker-clean-progress')
    expect(task?.updatedAt).not.toBe('2026-04-01T00:00:00Z')

    const checkpointPath = taskHistoryPath('worker-clean-progress', 'checkpoint.json')
    const checkpoint = JSON.parse(await fs.readFile(checkpointPath, 'utf8')) as {
      intent: string
      nextPlannedAction: string
      filesTouched: string[]
    }
    expect(checkpoint.intent).toContain('worker pass ended with clean verified progress but no status transition')
    expect(checkpoint.intent).toContain('pnpm db:types:remote')
    expect(checkpoint.filesTouched).toContain('web/app/types/supabase.ts')
    expect(checkpoint.nextPlannedAction).toContain('rerun the focused verification commands')
    expect(checkpoint.nextPlannedAction).not.toContain('hand off to review')
  })

  it('preserves worker progress in the main project checkout when worktree isolation is off', async () => {
    const projectPath = tmpDir
    const editedFile = path.join(projectPath, 'frontend', 'app', 'pages', 'register.vue')
    await fs.mkdir(path.dirname(editedFile), { recursive: true })
    await fs.writeFile(editedFile, '<template />\n', 'utf8')

    await writeQueue([
      mkTask({
        id: 'worker-project-progress',
        status: 'in_progress',
        projectPath,
        updatedAt: '2026-04-01T00:00:00Z',
      }),
    ])

    const worker: StubAgent = {
      name: 'worker-agent',
      calls: [],
      async generate(prompt: string) {
        this.calls.push({ prompt })
        return { text: 'Updated the registration page and verified the flow.' }
      },
      getToolMetadata() {
        return {
          review_handoff_evidence: {
            taskId: 'worker-project-progress',
            inspectedImplementationFile: true,
            changedOrVerified: true,
          },
          recent_verified_work: [
            'Ran bash command pnpm --dir frontend build [PASS]',
            `Edited file ${editedFile}`,
          ],
        }
      },
    }
    class DirtyProjectGitDriver extends InMemoryGitDriver {
      override async isClean(repoRoot: string): Promise<boolean> {
        if (repoRoot === projectPath) return false
        return true
      }
    }
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
      gitDriver: new DirtyProjectGitDriver(),
    })

    const out = await orch.tick()
    expect(out.kind).toBe('processed')
    if (out.kind === 'processed') {
      expect(out.beforeStatus).toBe('in_progress')
      expect(out.afterStatus).toBe('in_progress')
      expect(out.transitioned).toBe(false)
    }

    const queue = await readQueue()
    const task = queue.tasks.find((candidate) => candidate.id === 'worker-project-progress')
    expect(task?.updatedAt).not.toBe('2026-04-01T00:00:00Z')

    const checkpointPath = taskHistoryPath('worker-project-progress', 'checkpoint.json')
    const checkpoint = JSON.parse(await fs.readFile(checkpointPath, 'utf8')) as {
      intent: string
      nextPlannedAction: string
      filesTouched: string[]
    }
    expect(checkpoint.intent).toContain('progress but no status transition')
    expect(checkpoint.filesTouched).toContain(path.join('frontend', 'app', 'pages', 'register.vue'))
    expect(checkpoint.nextPlannedAction).toContain('rerun the focused verification commands')
    expect(checkpoint.nextPlannedAction).not.toContain('hand off to review')
  })

  it('reuses worker persona-role self-critique notes when building a recovery checkpoint next action', async () => {
    const worktreePath = path.join(tmpDir, '.guildhall', 'worktrees', 'worker-persona-self-critique')
    await fs.mkdir(path.join(worktreePath, 'web', 'server', 'api', 'pages', '[id]'), { recursive: true })
    await fs.writeFile(
      path.join(worktreePath, 'web', 'server', 'api', 'pages', '[id]', 'restore.post.ts'),
      'export default defineEventHandler(async () => ({ success: true }))\n',
      'utf8',
    )
    execFileSync('git', ['init'], { cwd: worktreePath, stdio: 'ignore' })

    await writeQueue([
      mkTask({
        id: 'worker-persona-self-critique',
        status: 'in_progress',
        worktreePath,
        notes: [
          {
            agentId: 'worker-agent',
            role: 'Backend Engineer',
            content: '**Self-critique:**\nFocused restore handler verification passed.',
            timestamp: '2026-04-21T00:00:00Z',
          },
        ],
      }),
    ])

    const worker: StubAgent = {
      name: 'worker-agent',
      calls: [],
      async generate(prompt: string) {
        this.calls.push({ prompt })
        return { text: 'Verified the restore handler and existing self-critique note.' }
      },
      getToolMetadata() {
        return {
          review_handoff_evidence: {
            taskId: 'worker-persona-self-critique',
            inspectedImplementationFile: true,
            changedOrVerified: true,
          },
          recent_verified_work: [
            'Ran bash command pnpm lint [PASS]',
            `Read file ${path.join(worktreePath, 'web', 'server', 'api', 'pages', '[id]', 'restore.post.ts')}`,
          ],
          current_task_checkpoint_files_touched: ['web/server/api/pages/[id]/restore.post.ts'],
        }
      },
    }
    const gitDriver = new InMemoryGitDriver()
    gitDriver.setClean(true)
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
      gitDriver,
    })

    await orch.tick()

    const checkpointPath = taskHistoryPath('worker-persona-self-critique', 'checkpoint.json')
    const checkpoint = JSON.parse(await fs.readFile(checkpointPath, 'utf8')) as {
      nextPlannedAction: string
    }
  expect(checkpoint.nextPlannedAction).toContain('Resume from the latest self-critique and verification evidence')
  expect(checkpoint.nextPlannedAction).not.toContain('write or refresh the self-critique note')
})

it('ignores placeholder checkpoint next-action values when resuming worker tasks', async () => {
  const worktreePath = path.join(tmpDir, '.guildhall', 'worktrees', 'worker-placeholder-checkpoint')
  await fs.mkdir(path.join(worktreePath, 'web', 'app', 'components'), { recursive: true })
  execFileSync('git', ['init'], { cwd: worktreePath, stdio: 'ignore' })

  await writeQueue([
    mkTask({
      id: 'worker-placeholder-checkpoint',
      status: 'in_progress',
      worktreePath,
    }),
  ])

  const worker: StubAgent = {
    name: 'worker-agent',
    calls: [],
    async generate(prompt: string) {
      this.calls.push({ prompt })
      throw new Error('Model returned an empty assistant message. The turn was ignored to keep the session healthy.')
    },
  }

  await writeCheckpoint({
    tasksPath,
    memoryDir,
    taskId: 'worker-placeholder-checkpoint',
    agentId: 'worker-agent',
    intent: 'Resume implementation',
    nextPlannedAction: 'None',
    filesTouched: ['web/app/components/VersionHistoryDialog.vue'],
  })

  const orch = new Orchestrator({
    config: baseConfig(),
    agents: agentSet({ worker }),
    gitDriver: new InMemoryGitDriver(),
  })

  const out = await orch.tick()
  expect(out.kind).toBe('processed')
  const prompt = worker.calls.at(-1)?.prompt ?? ''
  expect(prompt).not.toContain('The latest checkpoint already told you what to do next: None')
})

it('filters node_modules noise out of recovery checkpoints and falls back to metadata-touched source files', async () => {
    const worktreePath = path.join(tmpDir, '.guildhall', 'worktrees', 'worker-node-modules-noise')
    await fs.mkdir(path.join(worktreePath, 'node_modules'), { recursive: true })
    await fs.writeFile(path.join(worktreePath, 'node_modules', '.keep'), '', 'utf8')
    execFileSync('git', ['init'], { cwd: worktreePath, stdio: 'ignore' })

    await writeQueue([
      mkTask({
        id: 'worker-node-modules-noise',
        status: 'in_progress',
        worktreePath,
      }),
    ])

    const worker: StubAgent = {
      name: 'worker-agent',
      calls: [],
      async generate(prompt: string) {
        this.calls.push({ prompt })
        throw new Error('Model returned an empty assistant message. The turn was ignored to keep the session healthy.')
      },
      getToolMetadata() {
        return {
          recent_verified_work: [
            'Edited file /workspace/frontend/app/pages/register.vue',
          ],
          current_task_checkpoint_files_touched: ['frontend/app/pages/register.vue'],
        }
      },
    }
    const gitDriver = new InMemoryGitDriver()
    gitDriver.setClean(false)
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
      gitDriver,
    })

    expect((await orch.tick()).kind).toBe('processed')
    expect((await orch.tick()).kind).toBe('processed')
    expect((await orch.tick()).kind).toBe('processed')

    const checkpointPath = taskHistoryPath('worker-node-modules-noise', 'checkpoint.json')
    const checkpoint = JSON.parse(await fs.readFile(checkpointPath, 'utf8')) as {
      filesTouched: string[]
    }
    expect(checkpoint.filesTouched).not.toContain('node_modules')
    expect(checkpoint.filesTouched).toContain('frontend/app/pages/register.vue')
  })

  it('stays silent across many no-op ticks (no PROGRESS.md churn)', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'in_progress' })])
    const worker = stubAgent('worker-agent')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
    })
    for (let i = 0; i < 5; i++) await orch.tick()
    const progress = await fs
      .readFile(progressPath, 'utf-8')
      .catch(() => '')
    expect(progress).toBe('')
  })

  it('writes an ESCALATION entry when max revisions is exceeded (FR-10 supersedes BLOCKED)', async () => {
    // Prior to FR-10 this path wrote a BLOCKED heartbeat. Now the orchestrator
    // routes max-revisions through the escalation protocol, which writes a
    // typed `escalation` entry instead.
    await writeQueue([
      mkTask({ id: 'a', status: 'review', revisionCount: 3 }),
    ])
    const reviewer = stubAgent('reviewer-agent', async () => {
      await mutateTask('a', { status: 'in_progress' })
    })
    const orch = new Orchestrator({
      config: baseConfig({ maxRevisions: 3 }),
      agents: agentSet({ reviewer }),
    })
    await orch.tick()
    const progress = await fs.readFile(progressPath, 'utf-8')
    expect(progress).toContain('ESCALATION')
    expect(progress).toContain('max_revisions_exceeded')
  })

  it('writes an ESCALATION entry on agent errors', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'in_progress' })])
    const worker = {
      name: 'worker-agent',
      async generate() {
        throw new Error('LLM boom')
      },
    }
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
    })
    await orch.tick()
    const progress = await fs.readFile(progressPath, 'utf-8')
    expect(progress).toContain('ESCALATION')
    expect(progress).toContain('LLM boom')
  })

  it('tags each entry with the task domain', async () => {
    await writeQueue([
      mkTask({ id: 'a', status: 'in_progress', domain: 'knit-web' }),
    ])
    const worker = stubAgent('worker-agent', async () => {
      await mutateTask('a', { status: 'review' })
    })
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
    })
    await orch.tick()
    const progress = await fs.readFile(getProjectProgressHeartbeatsPath(tmpDir), 'utf-8')
    expect(progress).toContain('knit-web')
  })
})

describe('Orchestrator.tick — error handling', () => {
  it('reports agent-error when the agent throws', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'in_progress' })])
    const worker = {
      name: 'worker-agent',
      async generate() {
        throw new Error('LLM exploded')
      },
    }
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
    })
    const out = await orch.tick()
    expect(out.kind).toBe('agent-error')
    if (out.kind === 'agent-error') {
      expect(out.error).toContain('LLM exploded')
    }
  })

  it('preserves gate_check on retryable provider throttling instead of surfacing agent-error', async () => {
    await writeQueue([
      mkTask({
        id: 'a',
        status: 'gate_check',
        blockReason: 'gate_hard_failure: stale blocker',
        updatedAt: '2026-05-03T19:10:00.000Z',
        escalations: [
          {
            id: 'esc-a-1',
            taskId: 'a',
            agentId: 'gate-checker-agent',
            reason: 'gate_hard_failure',
            summary: 'stale blocker',
            raisedAt: '2026-05-03T19:00:00.000Z',
          },
        ],
      }),
    ])
    const gateChecker = {
      name: 'gate-checker-agent',
      async generate() {
        throw new Error('OpenAI-compatible API HTTP 429: {"status":429,"title":"Too Many Requests"}')
      },
    }
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ gateChecker }),
    })
    const out = await orch.tick()
    expect(out.kind).toBe('provider-backoff')
    if (out.kind === 'provider-backoff') {
      expect(out.status).toBe('gate_check')
      expect(out.agent).toBe('gate-checker-agent')
    }

    const q = await readQueue()
    expect(q.tasks[0]!.status).toBe('gate_check')
    expect(q.tasks[0]!.blockReason).toBeUndefined()
    expect(q.tasks[0]!.escalations[0]!.resolvedAt).toBeTruthy()
    expect(q.tasks[0]!.escalations[0]!.resolvedBy).toBe('system')
  })

  it('preserves worker progress on retryable provider capacity errors instead of blocking the task', async () => {
    await writeQueue([
      mkTask({
        id: 'a',
        status: 'in_progress',
        assignedTo: 'worker-agent',
        updatedAt: '2026-05-03T19:10:00.000Z',
      }),
    ])
    const worker = {
      name: 'worker-agent',
      async generate() {
        throw new Error(
          'OpenAI-compatible API HTTP 429: {"error":{"message":"Model busy, retry later","code":"engine_overloaded"}}',
        )
      },
    }
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
    })
    const out = await orch.tick()
    expect(out.kind).toBe('provider-backoff')
    if (out.kind === 'provider-backoff') {
      expect(out.status).toBe('in_progress')
      expect(out.agent).toBe('worker-agent')
    }

    const q = await readQueue()
    expect(q.tasks[0]!.status).toBe('in_progress')
    expect(q.tasks[0]!.assignedTo).toBe('worker-agent')
  })

  it('logs agent errors to PROGRESS.md', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'in_progress' })])
    const worker = {
      name: 'worker-agent',
      async generate() {
        throw new Error('boom')
      },
    }
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
    })
    await orch.tick()
    const progress = await fs.readFile(progressPath, 'utf-8')
    expect(progress).toContain('error: boom')
  })

  it('blocks the task when an agent hits its turn limit', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'in_progress' })])
    const worker = {
      name: 'worker-agent',
      async generate() {
        throw new Error('Exceeded maximum turn limit (8)')
      },
    }
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
    })
    const out = await orch.tick()
    expect(out.kind).toBe('escalated')

    const q = await readQueue()
    expect(q.tasks[0]!.status).toBe('blocked')
    expect(q.tasks[0]!.escalations[0]!.summary).toContain('Worker stopped')
    expect(q.tasks[0]!.notes.find((note) => note.role === 'policy-classification')?.content)
      .toContain('"class":"model_tool_use_failure"')
  })

  it('preserves durable spec progress instead of escalating when turn limit hits after update-task work', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'exploring' })])
    const spec = {
      name: 'spec-agent',
      async generate() {
        await mutateTask('a', {
          status: 'spec_review',
          spec: '## Summary\nAlready drafted.',
        })
        throw new Error('Exceeded maximum turn limit (8)')
      },
    }
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ spec }),
    })
    const out = await orch.tick()
    expect(out.kind).toBe('processed')
    if (out.kind === 'processed') {
      expect(out.afterStatus).toBe('spec_review')
      expect(out.transitioned).toBe(true)
    }

    const q = await readQueue()
    expect(q.tasks[0]!.status).toBe('spec_review')
    expect(q.tasks[0]!.spec).toContain('Already drafted')
    expect(q.tasks[0]!.escalations).toHaveLength(0)
  })

  it('asks a concrete owner question when imported draft shaping hits a turn limit without durable progress', async () => {
    await writeQueue([
      mkTask({
        id: 'draft-a',
        title: 'Zapier / webhook support',
        status: 'exploring',
        notes: [
          {
            agentId: 'workspace-importer',
            role: 'importer',
            content: [
              'Imported from: /workspace/knit/docs/features.md',
              'Why this may matter: knit/docs/features.md: - [ ] Zapier / webhook support',
              'Missing information: Guildhall still needs to confirm scope.',
            ].join('\n'),
            timestamp: '2026-06-13T20:00:00.000Z',
          },
          {
            agentId: 'human',
            role: 'shaping-request',
            content: 'User asked Guildhall to shape this imported draft into a complete task.',
            timestamp: '2026-06-13T20:01:00.000Z',
          },
        ],
      }),
    ])
    const spec = {
      name: 'spec-agent',
      async generate() {
        throw new Error('Exceeded maximum turn limit (8)')
      },
    }
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ spec }),
    })
    const out = await orch.tick()
    expect(out.kind).toBe('processed')
    if (out.kind === 'processed') {
      expect(out.afterStatus).toBe('exploring')
      expect(out.waitingOnUser).toBe(true)
    }

    const q = await readQueue()
    const task = q.tasks[0]!
    expect(task.status).toBe('exploring')
    expect(task.escalations).toHaveLength(0)
    expect(task.blockReason).toBeUndefined()
    const question = task.openQuestions?.[0]
    expect(question?.kind).toBe('text')
    if (question?.kind === 'text') {
      expect(question.prompt).toContain('Zapier / webhook support')
      expect(question.prompt).toContain('concrete success boundary')
      expect(question.description).toContain('knit/docs/features.md')
    }
  })

  it('preserves worker progress instead of escalating when turn limit hits after dirtying the worktree', async () => {
    const worktreePath = path.join(tmpDir, '.guildhall', 'worktrees', 'task-a')
    await fs.mkdir(worktreePath, { recursive: true })
    await writeQueue([
      mkTask({
        id: 'a',
        status: 'in_progress',
        assignedTo: 'worker-agent',
        worktreePath,
      }),
    ])
    class DirtyWorktreeGitDriver extends InMemoryGitDriver {
      override async isClean(repoRoot: string): Promise<boolean> {
        if (repoRoot === worktreePath) return false
        return true
      }
    }
    const worker = {
      name: 'worker-agent',
      async generate() {
        throw new Error('Exceeded maximum turn limit (24)')
      },
    }
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
      gitDriver: new DirtyWorktreeGitDriver(),
    })
    const out = await orch.tick()
    expect(out.kind).toBe('processed')
    if (out.kind === 'processed') {
      expect(out.afterStatus).toBe('in_progress')
      expect(out.transitioned).toBe(false)
    }

    const q = await readQueue()
    expect(q.tasks[0]!.status).toBe('in_progress')
    expect(q.tasks[0]!.escalations).toHaveLength(0)
  })

  it('promotes durable spec progress to spec_review when turn limit hits after all questions are answered', async () => {
    await writeQueue([
      mkTask({
        id: 'a',
        status: 'exploring',
        openQuestions: [
          {
            id: 'q-1',
            kind: 'choice',
            askedBy: 'spec-agent',
            askedAt: '2026-05-03T21:00:00.000Z',
            answeredAt: '2026-05-03T21:01:00.000Z',
            answer: 'Use bootstrapWorkspaceSession',
            prompt: 'Which auth path should this E2E use?',
            choices: [
              'Use bootstrapWorkspaceSession',
              'Drive the full login UI',
            ],
            selectionMode: 'single',
          },
        ],
      }),
    ])
    const spec = {
      name: 'spec-agent',
      async generate() {
        await writeQueue([
          mkTask({
            id: 'a',
            status: 'exploring',
            spec: '## Summary\nReady for review.',
            openQuestions: [
              {
                id: 'q-1',
                kind: 'choice',
                askedBy: 'spec-agent',
                askedAt: '2026-05-03T21:00:00.000Z',
                answeredAt: '2026-05-03T21:01:00.000Z',
                answer: 'Use bootstrapWorkspaceSession',
                prompt: 'Which auth path should this E2E use?',
                choices: [
                  'Use bootstrapWorkspaceSession',
                  'Drive the full login UI',
                ],
                selectionMode: 'single',
              },
            ],
          }),
        ])
        throw new Error('Exceeded maximum turn limit (8)')
      },
    }
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ spec }),
    })
    const out = await orch.tick()
    expect(out.kind).toBe('processed')
    if (out.kind === 'processed') {
      expect(out.afterStatus).toBe('spec_review')
      expect(out.transitioned).toBe(true)
    }

    const q = await readQueue()
    expect(q.tasks[0]!.status).toBe('spec_review')
    expect(q.tasks[0]!.spec).toContain('Ready for review')
    expect(q.tasks[0]!.escalations).toHaveLength(0)
  })

  it('does not promote stale preexisting spec text when spec shaping hits a turn limit', async () => {
    await writeQueue([
      mkTask({
        id: 'a',
        status: 'exploring',
        spec: '## Summary\nGeneric old draft that was already present before dispatch.',
      }),
    ])
    const spec = {
      name: 'spec-agent',
      async generate() {
        throw new Error('Exceeded maximum turn limit (8)')
      },
    }
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ spec }),
    })
    const out = await orch.tick()
    expect(out.kind).toBe('escalated')

    const q = await readQueue()
    expect(q.tasks[0]!.status).toBe('blocked')
    expect(q.tasks[0]!.spec).toContain('Generic old draft')
  })
})

describe('Orchestrator.run — full loops', () => {
  it('drives an approved task through the implementation lifecycle in one run', async () => {
    await writeQueue([
      mkTask({
        id: 'a',
        status: 'ready',
        domain: 'looma',
        spec: VALID_SPEC,
        acceptanceCriteria: [
          {
            id: 'ac-1',
            description: 'Thing is done',
            verifiedBy: 'automated',
            command: 'pnpm test',
            met: true,
          },
        ],
      }),
    ])

    // Each agent transitions the task one step forward.
    const advance = (next: TaskStatus) => async () => {
      await mutateTask('a', {
        status: next,
        ...(next === 'done'
          ? {
              mergeRecord: {
                fromBranch: 'guildhall/task-a',
                toBranch: 'main',
                strategy: 'cherry_pick_local',
                result: 'merged',
                commitSha: 'abc123',
                mergedAt: '2026-04-29T00:00:00.000Z',
              },
            }
          : {}),
      })
    }

    const agents: OrchestratorAgentSet = {
      spec: stubAgent('spec-agent'),
      worker: stubAgent('worker-agent', advance('review')),
      reviewer: stubAgent('reviewer-agent', advance('gate_check')),
      gateChecker: stubAgent('gate-checker-agent', advance('done')),
      coordinators: {},
    }

    const orch = new Orchestrator({ config: baseConfig(), agents })
    await orch.run({ maxTicks: 20, tickDelayMs: 0 })

    const q = await readQueue()
    expect(q.tasks[0]!.status).toBe('done')
    const packet = await fs.readFile(
      taskHistoryPath('a', 'review-packet.md'),
      'utf-8',
    )
    expect(packet).toContain('# Review packet: Do a thing')
    expect(packet).toContain('- Task: a')
    expect(packet).toContain('- Status: done')
    expect(packet).toContain('- [x] ac-1: Thing is done')
    expect(packet).toContain('## Merge')
    expect(packet).toContain('- merged: guildhall/task-a -> main via cherry_pick_local (abc123); 2026-04-29T00:00:00.000Z')
    expect(packet).toContain('Task is complete and merged.')
  })

  it('records a skipped merge when worktree isolation is disabled', async () => {
    await writeQueue([
      mkTask({
        id: 'a',
        status: 'ready',
        domain: 'looma',
        spec: VALID_SPEC,
        acceptanceCriteria: [
          {
            id: 'ac-1',
            description: 'Thing is done',
            verifiedBy: 'automated',
            command: 'pnpm test',
            met: true,
          },
        ],
      }),
    ])

    const advance = (next: TaskStatus) => async () => {
      await mutateTask('a', { status: next })
    }

    const agents: OrchestratorAgentSet = {
      spec: stubAgent('spec-agent'),
      worker: stubAgent('worker-agent', advance('review')),
      reviewer: stubAgent('reviewer-agent', advance('gate_check')),
      gateChecker: stubAgent('gate-checker-agent', advance('done')),
      coordinators: {},
    }

    const orch = new Orchestrator({ config: baseConfig(), agents })
    await orch.run({ maxTicks: 20, tickDelayMs: 0 })

    const q = await readQueue()
    expect(q.tasks[0]!.status).toBe('done')
    expect(q.tasks[0]!.mergeRecord).toMatchObject({
      result: 'skipped',
      detail: 'worktree isolation disabled — merge skipped',
      fromBranch: '<unknown>',
      toBranch: '<unknown>',
    })
  })

  it('checkpoints shared-checkout work into a task branch when worktree isolation is disabled and the repo is dirty', async () => {
    await writeQueue([
      mkTask({
        id: 'a',
        status: 'ready',
        domain: 'looma',
        spec: VALID_SPEC,
        acceptanceCriteria: [
          {
            id: 'ac-1',
            description: 'Thing is done',
            verifiedBy: 'automated',
            command: 'pnpm test',
            met: true,
          },
        ],
      }),
    ])

    const advance = (next: TaskStatus) => async () => {
      await mutateTask('a', { status: next })
    }

    const agents: OrchestratorAgentSet = {
      spec: stubAgent('spec-agent'),
      worker: stubAgent('worker-agent', advance('review')),
      reviewer: stubAgent('reviewer-agent', advance('gate_check')),
      gateChecker: stubAgent('gate-checker-agent', advance('done')),
      coordinators: {},
    }

    const gitDriver = new InMemoryGitDriver({ clean: false })
    const orch = new Orchestrator({ config: baseConfig(), agents, gitDriver })
    await orch.run({ maxTicks: 20, tickDelayMs: 0 })

    const q = await readQueue()
    expect(q.tasks[0]!.status).toBe('done')
    expect(gitDriver.state.checkpoints).toHaveLength(1)
    expect(gitDriver.state.checkpoints[0]?.branch).toBe('guildhall/task-a')
    expect(q.tasks[0]!.branchName).toBe('guildhall/task-a')
    expect(q.tasks[0]!.baseBranch).toBe('main')
    expect(q.tasks[0]!.mergeRecord).toMatchObject({
      result: 'skipped',
      detail: 'worktree isolation disabled — shared-checkout work checkpointed to task branch',
      fromBranch: 'guildhall/task-a',
      toBranch: 'main',
      commitSha: 'checkpoint-1',
    })
    expect(q.tasks[0]!.notes.some((note) =>
      note.role === 'checkpoint' &&
      note.content.includes('Checkpointed shared-checkout work into guildhall/task-a'),
    )).toBe(true)
  })

  it('uses the task project repo for worktree and merge operations in multi-repo workspaces', async () => {
    const subrepo = path.join(tmpDir, 'knit')
    const guildhallHome = path.join(tmpDir, '.guildhall-home')
    process.env.GUILDHALL_CONFIG_DIR = guildhallHome
    await fs.mkdir(subrepo, { recursive: true })

    const settings = makeDefaultSettings(new Date('2026-05-03T00:00:00Z'))
    settings.project.worktree_isolation = {
      position: 'per_task',
      rationale: 'test',
      setAt: '2026-05-03T00:00:00Z',
      setBy: 'user-direct',
    }
    await saveLeverSettings({
      path: agentSettingsPath,
      settings,
    })

    await writeQueue([
      mkTask({
        id: 'a',
        status: 'ready',
        domain: 'knit',
        projectPath: subrepo,
        spec: VALID_SPEC,
        acceptanceCriteria: [
          {
            id: 'ac-1',
            description: 'Thing is done',
            verifiedBy: 'automated',
            command: 'pnpm test',
            met: true,
          },
        ],
      }),
    ])

    const advance = (next: TaskStatus) => async () => {
      await mutateTask('a', { status: next })
    }

    class RecordingGitDriver extends InMemoryGitDriver {
      readonly currentBranchRoots: string[] = []
      readonly createRoots: string[] = []
      readonly mergeRoots: string[] = []
      readonly removeRoots: string[] = []

      override async currentBranch(repoRoot: string): Promise<string> {
        this.currentBranchRoots.push(repoRoot)
        return super.currentBranch(repoRoot)
      }

      override async createWorktree(repoRoot: string, opts: any): Promise<void> {
        this.createRoots.push(repoRoot)
        return super.createWorktree(repoRoot, opts)
      }

      override async cherryPickBranch(repoRoot: string, branch: string, baseBranch: string) {
        this.mergeRoots.push(repoRoot)
        return super.cherryPickBranch(repoRoot, branch, baseBranch)
      }

      override async removeWorktree(repoRoot: string, worktreePath: string): Promise<void> {
        this.removeRoots.push(repoRoot)
        return super.removeWorktree(repoRoot, worktreePath)
      }
    }

    const gitDriver = new RecordingGitDriver()

    const agents: OrchestratorAgentSet = {
      spec: stubAgent('spec-agent'),
      worker: stubAgent('worker-agent', advance('review')),
      reviewer: stubAgent('reviewer-agent', advance('gate_check')),
      gateChecker: stubAgent('gate-checker-agent', advance('done')),
      coordinators: {},
    }

    const orch = new Orchestrator({
      config: baseConfig({ projectPath: tmpDir }),
      agents,
      gitDriver,
    })
    await orch.run({ maxTicks: 20, tickDelayMs: 0 })

    expect(gitDriver.currentBranchRoots).toEqual([subrepo])
    expect(gitDriver.createRoots).toEqual([subrepo])
    expect(gitDriver.mergeRoots).toEqual([subrepo])
    expect(gitDriver.removeRoots).toEqual([subrepo])
    expect(gitDriver.state.createdWorktrees[0]?.worktreePath).toBe(
      path.join(guildhallHome, 'worktrees', 'test-ws', 'a'),
    )

    const q = await readQueue()
    expect(q.tasks[0]!.mergeRecord?.result).toBe('merged')
    delete process.env.GUILDHALL_CONFIG_DIR
  })

  it('keeps isolated task workspaces for blocked tasks that have not landed', async () => {
    const guildhallHome = path.join(tmpDir, '.guildhall-home')
    process.env.GUILDHALL_CONFIG_DIR = guildhallHome

    const settings = makeDefaultSettings(new Date('2026-05-03T00:00:00Z'))
    settings.project.worktree_isolation = {
      position: 'per_task',
      rationale: 'test',
      setAt: '2026-05-03T00:00:00Z',
      setBy: 'user-direct',
    }
    await saveLeverSettings({
      path: agentSettingsPath,
      settings,
    })

    await writeQueue([
      mkTask({
        id: 'blocked-task',
        status: 'ready',
        domain: 'looma',
        spec: VALID_SPEC,
      }),
    ])

    const agents: OrchestratorAgentSet = {
      spec: stubAgent('spec-agent'),
      worker: stubAgent('worker-agent', async () => {
        await mutateTask('blocked-task', { status: 'blocked' })
      }),
      reviewer: stubAgent('reviewer-agent'),
      gateChecker: stubAgent('gate-checker-agent'),
      coordinators: {},
    }

    class RecordingGitDriver extends InMemoryGitDriver {
      readonly removeRoots: string[] = []
      override async removeWorktree(repoRoot: string, worktreePath: string): Promise<void> {
        this.removeRoots.push(worktreePath)
        return super.removeWorktree(repoRoot, worktreePath)
      }
    }

    const gitDriver = new RecordingGitDriver()
    const orch = new Orchestrator({ config: baseConfig(), agents, gitDriver })
    await orch.run({ maxTicks: 5, tickDelayMs: 0 })

    expect(gitDriver.state.createdWorktrees[0]?.worktreePath).toBe(
      path.join(guildhallHome, 'worktrees', 'test-ws', 'blocked-task'),
    )
    expect(gitDriver.removeRoots).toEqual([])
    delete process.env.GUILDHALL_CONFIG_DIR
  })

  it('blocks the task once when the target repo is dirty before worktree creation', async () => {
    const subrepo = path.join(tmpDir, 'knit')
    await fs.mkdir(subrepo, { recursive: true })

    const settings = makeDefaultSettings(new Date('2026-05-03T00:00:00Z'))
    settings.project.worktree_isolation = {
      position: 'per_task',
      rationale: 'test',
      setAt: '2026-05-03T00:00:00Z',
      setBy: 'user-direct',
    }
    await saveLeverSettings({
      path: agentSettingsPath,
      settings,
    })

    await writeQueue([
      mkTask({
        id: 'a',
        status: 'in_progress',
        assignedTo: 'worker-agent',
        domain: 'knit',
        projectPath: subrepo,
        spec: VALID_SPEC,
      }),
    ])

    const gitDriver = new InMemoryGitDriver({ clean: false })
    const agents: OrchestratorAgentSet = {
      spec: stubAgent('spec-agent'),
      worker: stubAgent('worker-agent'),
      reviewer: stubAgent('reviewer-agent'),
      gateChecker: stubAgent('gate-checker-agent'),
      coordinators: {},
    }

    const orch = new Orchestrator({
      config: baseConfig({ projectPath: tmpDir }),
      agents,
      gitDriver,
    })
    const out = await orch.tick()

    expect(out.kind).toBe('processed')
    if (out.kind === 'processed') {
      expect(out.beforeStatus).toBe('in_progress')
      expect(out.afterStatus).toBe('blocked')
      expect(out.transitioned).toBe(true)
    }
    const queue = await readQueue()
    const task = queue.tasks.find((candidate) => candidate.id === 'a')
    expect(task?.status).toBe('blocked')
    expect(task?.assignedTo).toBeNull()
    expect(task?.blockReason).toContain(`base repo has uncommitted changes at ${subrepo}`)
  })

  it('packages Guildhall-owned shared-checkout edits into a task branch before creating a worktree', async () => {
    const subrepo = path.join(tmpDir, 'frontend')
    const guildhallHome = path.join(tmpDir, '.guildhall-home')
    process.env.GUILDHALL_CONFIG_DIR = guildhallHome
    await fs.mkdir(subrepo, { recursive: true })

    const settings = makeDefaultSettings(new Date('2026-05-03T00:00:00Z'))
    settings.project.worktree_isolation = {
      position: 'per_task',
      rationale: 'test',
      setAt: '2026-05-03T00:00:00Z',
      setBy: 'user-direct',
    }
    await saveLeverSettings({
      path: agentSettingsPath,
      settings,
    })

    await writeQueue([
      mkTask({
        id: 'a',
        status: 'blocked',
        assignedTo: null,
        domain: 'frontend',
        projectPath: subrepo,
        spec: VALID_SPEC,
        blockReason:
          `Guildhall could not start work because the target repo is dirty: ` +
          `base repo has uncommitted changes at ${subrepo}. ` +
          'Commit or stash those changes, then resume the task.',
        notes: [
          {
            agentId: 'task-claimer',
            role: 'orchestrator',
            content: 'Claimed ready task for worker-agent.',
            timestamp: '2026-05-03T00:00:00.000Z',
          },
        ],
      }),
    ])

    const gitDriver = new InMemoryGitDriver({ clean: false })
    const agents: OrchestratorAgentSet = {
      spec: stubAgent('spec-agent'),
      worker: stubAgent('worker-agent', async () => {
        await mutateTask('a', { status: 'review' })
      }),
      reviewer: stubAgent('reviewer-agent'),
      gateChecker: stubAgent('gate-checker-agent'),
      coordinators: {},
    }

    const orch = new Orchestrator({
      config: baseConfig({ projectPath: tmpDir }),
      agents,
      gitDriver,
    })
    const out = await orch.tick()

    expect(out.kind).toBe('processed')
    if (out.kind === 'processed') {
      expect(out.beforeStatus).toBe('in_progress')
      expect(out.afterStatus).toBe('review')
    }

    expect(gitDriver.state.checkpoints).toHaveLength(1)
    expect(gitDriver.state.checkpoints[0]?.branch).toBe('guildhall/task-a')
    expect(gitDriver.state.attachedWorktrees[0]?.branch).toBe('guildhall/task-a')
    expect(gitDriver.state.attachedWorktrees[0]?.worktreePath).toBe(
      path.join(guildhallHome, 'worktrees', 'test-ws', 'a'),
    )

    const queue = await readQueue()
    const task = queue.tasks.find((candidate) => candidate.id === 'a')
    expect(task?.status).toBe('review')
    expect(task?.branchName).toBe('guildhall/task-a')
    expect(task?.baseBranch).toBe('main')
    expect(task?.blockReason ?? null).toBeNull()
    expect(task?.notes.some((note) => note.role === 'recovery')).toBe(true)
    expect(task?.notes.some((note) => note.role === 'checkpoint')).toBe(true)
    delete process.env.GUILDHALL_CONFIG_DIR
  })

  it('reopens likely-target worker timeouts without requiring a recovery checkpoint', async () => {
    await writeQueue([
      mkTask({
        id: 'a',
        status: 'blocked',
        assignedTo: null,
        spec: 'Edit `src/report.ts` so every run writes a developer-readable debug report.',
        blockReason: 'human_judgment_required: Worker timed out after failing to mutate the likely target file.',
        escalations: [
          {
            id: 'esc-a',
            taskId: 'a',
            agentId: 'worker-agent',
            reason: 'human_judgment_required',
            summary: 'Worker timed out after failing to mutate the likely target file.',
            details: 'worker-agent timed out after 10ms of inactivity.',
            raisedAt: '2026-05-03T00:00:00.000Z',
          } as any,
        ],
      }),
    ])

    const agents: OrchestratorAgentSet = {
      spec: stubAgent('spec-agent'),
      worker: stubAgent('worker-agent', async () => {
        await mutateTask('a', { status: 'review' })
      }),
      reviewer: stubAgent('reviewer-agent'),
      gateChecker: stubAgent('gate-checker-agent'),
      coordinators: {},
    }

    const orch = new Orchestrator({
      config: baseConfig({ projectPath: tmpDir }),
      agents,
      gitDriver: new InMemoryGitDriver(),
    })

    const out = await orch.tick()
    expect(out.kind).toBe('processed')
    if (out.kind === 'processed') {
      expect(out.beforeStatus).toBe('in_progress')
      expect(out.afterStatus).toBe('review')
    }

    const queue = await readQueue()
    const task = queue.tasks.find((candidate) => candidate.id === 'a')
    expect(task?.status).toBe('review')
    expect(task?.blockReason ?? null).toBeNull()
    expect(task?.escalations[0]?.resolvedBy).toBe('system')
    expect(task?.notes.some((note) =>
      note.role === 'recovery' &&
      note.content.includes('internal execution miss as owner judgment'),
    )).toBe(true)
  })

  it('reopens a stale review-handoff tool-loop blocker after the validator bug is fixed', async () => {
    await writeQueue([
      mkTask({
        id: 'a',
        status: 'blocked',
        assignedTo: null,
        spec: VALID_SPEC,
        blockReason: 'human_judgment_required: Blocked transitioning task to review — tool loop',
        notes: [
          {
            agentId: 'worker-agent',
            role: 'self-critique',
            content: `**Self-critique:**\n\nAC-1 (Registration): Met — /register works.\n\n**Minimum-scope check:**\n- Files changed: none.\n- Smallest useful change?: yes.\n- Anything to revert before review?: none.`,
            timestamp: '2026-05-03T00:10:00.000Z',
          },
        ],
        escalations: [
          {
            id: 'esc-a-1',
            taskId: 'a',
            agentId: 'worker-agent',
            reason: 'human_judgment_required',
            summary: 'Blocked transitioning task to review — tool loop',
            details: 'The transition was blocked with: persist a structured self-critique note via update-task first.',
            raisedAt: '2026-05-03T00:11:00.000Z',
          },
        ],
      }),
    ])

    const agents: OrchestratorAgentSet = {
      spec: stubAgent('spec-agent'),
      worker: stubAgent('worker-agent', async () => {
        await mutateTask('a', { status: 'review' })
      }),
      reviewer: stubAgent('reviewer-agent'),
      gateChecker: stubAgent('gate-checker-agent'),
      coordinators: {},
    }

    const orch = new Orchestrator({
      config: baseConfig(),
      agents,
      gitDriver: new InMemoryGitDriver({ clean: true }),
    })
    const out = await orch.tick()

    expect(out.kind).toBe('processed')
    if (out.kind === 'processed') {
      expect(out.beforeStatus).toBe('in_progress')
      expect(out.afterStatus).toBe('review')
    }

    const queue = await readQueue()
    const task = queue.tasks.find((candidate) => candidate.id === 'a')
    expect(task?.status).toBe('review')
    expect(task?.assignedTo).toBe('reviewer-agent')
    expect(task?.blockReason ?? null).toBeNull()
    expect(task?.notes.some((note) =>
      note.role === 'recovery' &&
      note.content.includes('review handoff validator bug'),
    )).toBe(true)
    expect(task?.escalations[0]?.resolvedBy).toBe('system')
    expect(task?.escalations[0]?.resolution).toContain('Superseded')
  })

  it('reopens a stale review-handoff tool-loop blocker that uses the newer decision-required wording', async () => {
    await writeQueue([
      mkTask({
        id: 'a',
        status: 'blocked',
        assignedTo: null,
        spec: VALID_SPEC,
        blockReason: 'decision_required: Stuck in tool loop transitioning a to review status',
        notes: [
          {
            agentId: 'worker-agent',
            role: 'self-critique',
            content: `**Self-critique:**\n\nAC-1 (Registration): Met — /register works.\n\n**Minimal-scope check:**\n- Files changed: dashboard.vue.\n- Smallest useful change?: yes.\n- Anything to revert before review?: none.`,
            timestamp: '2026-05-03T00:10:00.000Z',
          },
        ],
        escalations: [
          {
            id: 'esc-a-1',
            taskId: 'a',
            agentId: 'worker-agent',
            reason: 'decision_required',
            summary: 'Stuck in tool loop transitioning a to review status',
            details: 'The transition was blocked with: persist a structured self-critique note via update-task first.',
            raisedAt: '2026-05-03T00:11:00.000Z',
          },
        ],
      }),
    ])

    const agents: OrchestratorAgentSet = {
      spec: stubAgent('spec-agent'),
      worker: stubAgent('worker-agent', async () => {
        await mutateTask('a', { status: 'review' })
      }),
      reviewer: stubAgent('reviewer-agent'),
      gateChecker: stubAgent('gate-checker-agent'),
      coordinators: {},
    }

    const orch = new Orchestrator({
      config: baseConfig(),
      agents,
      gitDriver: new InMemoryGitDriver({ clean: true }),
    })
    const out = await orch.tick()

    expect(out.kind).toBe('processed')
    if (out.kind === 'processed') {
      expect(out.beforeStatus).toBe('in_progress')
      expect(out.afterStatus).toBe('review')
    }

    const queue = await readQueue()
    const task = queue.tasks.find((candidate) => candidate.id === 'a')
    expect(task?.status).toBe('review')
    expect(task?.assignedTo).toBe('reviewer-agent')
    expect(task?.blockReason ?? null).toBeNull()
    expect(task?.notes.some((note) =>
      note.role === 'recovery' &&
      note.content.includes('review handoff validator bug'),
    )).toBe(true)
    expect(task?.escalations[0]?.resolvedBy).toBe('system')
    expect(task?.escalations[0]?.resolution).toContain('Superseded')
  })

  it('reopens a stale review-handoff blocker from update-task note persistence mismatch', async () => {
    await writeQueue([
      mkTask({
        id: 'a',
        status: 'blocked',
        assignedTo: null,
        spec: VALID_SPEC,
        blockReason:
          'human_judgment_required: Cannot transition to review — update-task tool rejects the transition despite self-critique being persisted on disk (SELF_CRITIQUE.md) and in PROGRESS.md. The note parameter does not append to the notes array for this task.',
        notes: [
          {
            agentId: 'worker-agent',
            role: 'self-critique',
            content: `**Self-critique:**\n\nAC-1: Met — implementation exists and build passes.\n\n**Minimum-scope check:**\n- Files changed: author-voice-reviewer.ts.\n- Smallest useful change?: yes.\n- Anything to revert before review?: none.`,
            timestamp: '2026-06-16T23:40:00.000Z',
          },
        ],
        escalations: [
          {
            id: 'esc-a-1',
            taskId: 'a',
            agentId: 'worker-agent',
            reason: 'human_judgment_required',
            summary:
              'Cannot transition to review — update-task tool rejects the transition despite self-critique being persisted on disk (SELF_CRITIQUE.md) and in PROGRESS.md.',
            details:
              'The note parameter does not append to the notes array for this task.',
            raisedAt: '2026-06-16T23:41:39.000Z',
          },
        ],
      }),
    ])

    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({
        worker: stubAgent('worker-agent', async () => {
          await mutateTask('a', { status: 'review' })
        }),
      }),
      gitDriver: new InMemoryGitDriver({ clean: true }),
    })

    const out = await orch.tick()

    expect(out.kind).toBe('processed')
    if (out.kind === 'processed') {
      expect(out.beforeStatus).toBe('in_progress')
      expect(out.afterStatus).toBe('review')
    }

    const queue = await readQueue()
    const task = queue.tasks.find((candidate) => candidate.id === 'a')
    expect(task?.status).toBe('review')
    expect(task?.assignedTo).toBe('reviewer-agent')
    expect(task?.blockReason ?? null).toBeNull()
    expect(task?.escalations[0]?.resolvedBy).toBe('system')
    expect(task?.escalations[0]?.resolution).toContain('Superseded')
  })

  it('reopens a stale review-handoff blocker when the self-critique was stored as a JSON wrapper string', async () => {
    await writeQueue([
      mkTask({
        id: 'a',
        status: 'blocked',
        assignedTo: null,
        spec: VALID_SPEC,
        blockReason:
          "decision_required: Cannot transition task to 'review' — guard keeps blocking despite self-critique note being persisted",
        notes: [
          {
            agentId: 'worker-agent',
            role: 'self-critique',
            content:
              '{"agentId":"worker-agent","role":"self-critique","content":"**Self-critique:**\\n\\nAC 1: Met — implementation exists and build passes.\\n\\nMinimum-scope check:\\n- Files changed: scripts/run-packet.mjs.\\n- Smallest useful change?: yes.',
            timestamp: '2026-07-04T09:50:53.838Z',
          },
        ],
        escalations: [
          {
            id: 'esc-a-1',
            taskId: 'a',
            agentId: 'worker-agent',
            reason: 'decision_required',
            summary:
              "Cannot transition task to 'review' — guard keeps blocking despite self-critique note being persisted",
            details:
              'Blocked transition to review: persist a structured self-critique note with a review proof packet via update-task first.',
            raisedAt: '2026-07-04T09:52:54.000Z',
          },
        ],
      }),
    ])

    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({
        worker: stubAgent('worker-agent', async () => {
          await mutateTask('a', { status: 'review' })
        }),
      }),
      gitDriver: new InMemoryGitDriver({ clean: true }),
    })

    const out = await orch.tick()

    expect(out.kind).toBe('processed')
    if (out.kind === 'processed') {
      expect(out.beforeStatus).toBe('in_progress')
      expect(out.afterStatus).toBe('review')
    }

    const queue = await readQueue()
    const task = queue.tasks.find((candidate) => candidate.id === 'a')
    expect(task?.status).toBe('review')
    expect(task?.assignedTo).toBe('reviewer-agent')
    expect(task?.blockReason ?? null).toBeNull()
    expect(task?.notes.some((note) =>
      note.role === 'recovery' &&
      note.content.includes('review handoff validator bug'),
    )).toBe(true)
    expect(task?.escalations[0]?.resolvedBy).toBe('system')
  })

  it('reopens a stale gate_hard_failure review-handoff blocker after the validator bug is fixed', async () => {
    await writeQueue([
      mkTask({
        id: 'a',
        status: 'blocked',
        assignedTo: null,
        spec: VALID_SPEC,
        blockReason:
          'gate_hard_failure: Tool validation bug prevents transitioning a to review status despite all work being complete.',
        notes: [
          {
            agentId: 'worker-agent',
            role: 'self-critique',
            content: `**Self-critique:**\n\nAC-1 (Registration): Met — /register works.\n\n**Mini-scope check:**\n- Files changed: login.vue, register.vue.\n- Smallest useful change?: yes.\n- Out-of-scope changes: none.`,
            timestamp: '2026-05-13T15:42:00.000Z',
          },
        ],
        escalations: [
          {
            id: 'esc-a-1',
            taskId: 'a',
            agentId: 'worker-agent',
            reason: 'gate_hard_failure',
            summary:
              'Tool validation bug prevents transitioning a to review status despite all work being complete.',
            details:
              'The update-task tool kept rejecting status=review even though the self-critique note was already persisted.',
            raisedAt: '2026-05-13T15:42:05.000Z',
          },
        ],
      }),
    ])

    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({
        worker: stubAgent('worker-agent', async () => {
          await mutateTask('a', { status: 'review' })
        }),
      }),
      gitDriver: new InMemoryGitDriver({ clean: true }),
    })

    const out = await orch.tick()

    expect(out.kind).toBe('processed')
    if (out.kind === 'processed') {
      expect(out.beforeStatus).toBe('in_progress')
      expect(out.afterStatus).toBe('review')
    }

    const queue = await readQueue()
    const task = queue.tasks.find((candidate) => candidate.id === 'a')
    expect(task?.status).toBe('review')
    expect(task?.assignedTo).toBe('reviewer-agent')
    expect(task?.blockReason ?? null).toBeNull()
    expect(task?.notes.some((note) =>
      note.role === 'recovery' &&
      note.content.includes('review handoff validator bug'),
    )).toBe(true)
    expect(task?.escalations[0]?.resolvedBy).toBe('system')
    expect(task?.escalations[0]?.resolution).toContain('Superseded')
  })

  it('reopens a stale decision-required review-handoff blocker when the old validator wrongly claimed verification was not durable', async () => {
    await writeQueue([
      mkTask({
        id: 'a',
        status: 'blocked',
        assignedTo: null,
        spec: VALID_SPEC,
        blockReason:
          'decision_required: Task blocked from transitioning to review despite passing all verification',
        notes: [
          {
            agentId: 'worker-agent',
            role: 'self-critique',
            content: `**Self-critique:**\n\nAC-1 (Registration): Met — auth pages are wired and verified.\n\n**Minimum-scope check:**\n- Files changed: register.vue, login.vue.\n- Smallest useful change?: yes.\n- Anything to revert before review?: none.`,
            timestamp: '2026-05-13T19:41:49.000Z',
          },
        ],
        escalations: [
          {
            id: 'esc-a-1',
            taskId: 'a',
            agentId: 'worker-agent',
            reason: 'decision_required',
            summary: 'Task blocked from transitioning to review despite passing all verification',
            details:
              'Both authoritative verification commands passed, but update-task with status=review was blocked because Guildhall claimed it did not yet have durable proof that the task passed its required verification commands.',
            raisedAt: '2026-05-13T19:42:09.000Z',
          },
        ],
      }),
    ])

    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({
        worker: stubAgent('worker-agent', async () => {
          await mutateTask('a', { status: 'review' })
        }),
      }),
      gitDriver: new InMemoryGitDriver({ clean: true }),
    })

    const out = await orch.tick()

    expect(out.kind).toBe('processed')
    if (out.kind === 'processed') {
      expect(out.beforeStatus).toBe('in_progress')
      expect(out.afterStatus).toBe('review')
    }

    const queue = await readQueue()
    const task = queue.tasks.find((candidate) => candidate.id === 'a')
    expect(task?.status).toBe('review')
    expect(task?.assignedTo).toBe('reviewer-agent')
    expect(task?.blockReason ?? null).toBeNull()
    expect(task?.notes.some((note) =>
      note.role === 'recovery' &&
      note.content.includes('review handoff validator bug'),
    )).toBe(true)
    expect(task?.escalations[0]?.resolvedBy).toBe('system')
    expect(task?.escalations[0]?.resolution).toContain('Superseded')
  })

  it('reopens a stale validator-rejects-passing-verification blocker after restart', async () => {
    await writeQueue([
      mkTask({
        id: 'a',
        status: 'blocked',
        assignedTo: null,
        spec: VALID_SPEC,
        blockReason:
          'decision_required: Cannot transition to review — system validator rejects passing verification',
        notes: [
          {
            agentId: 'worker-agent',
            role: 'self-critique',
            content: `**Self-critique:**\n\nAC-1 (Registration): Met — auth wiring is complete.\n\n**Minimum-scope check:**\n- Files changed: register.vue.\n- Smallest useful change?: yes.\n- Anything to revert before review?: none.`,
            timestamp: '2026-05-13T19:56:00.000Z',
          },
        ],
        escalations: [
          {
            id: 'esc-a-1',
            taskId: 'a',
            agentId: 'worker-agent',
            reason: 'decision_required',
            summary: 'Cannot transition to review — system validator rejects passing verification',
            details:
              "update-task with status='review' failed because Guildhall claimed it did not yet have durable proof that the task passed its required verification commands.",
            raisedAt: '2026-05-13T19:56:39.000Z',
          },
        ],
      }),
    ])

    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({
        worker: stubAgent('worker-agent', async () => {
          await mutateTask('a', { status: 'review' })
        }),
      }),
      gitDriver: new InMemoryGitDriver({ clean: true }),
    })

    const out = await orch.tick()

    expect(out.kind).toBe('processed')
    if (out.kind === 'processed') {
      expect(out.beforeStatus).toBe('in_progress')
      expect(out.afterStatus).toBe('review')
    }

    const queue = await readQueue()
    const task = queue.tasks.find((candidate) => candidate.id === 'a')
    expect(task?.status).toBe('review')
    expect(task?.assignedTo).toBe('reviewer-agent')
    expect(task?.blockReason ?? null).toBeNull()
    expect(task?.notes.some((note) =>
      note.role === 'recovery' &&
      note.content.includes('review handoff validator bug'),
    )).toBe(true)
    expect(task?.escalations[0]?.resolvedBy).toBe('system')
    expect(task?.escalations[0]?.resolution).toContain('Superseded')
  })

  it('reopens a stale validator-bug-persists blocker after restart', async () => {
    await writeQueue([
      mkTask({
        id: 'a',
        status: 'blocked',
        assignedTo: null,
        spec: VALID_SPEC,
        blockReason:
          'gate_hard_failure: Blocked from transitioning to review — system validator bug persists',
        notes: [
          {
            agentId: 'worker-agent',
            role: 'self-critique',
            content: `**Self-critique:**\n\nAC-1 (Registration): Met — auth wiring is complete.\n\n**Minimum-scope check:**\n- Files changed: register.vue.\n- Smallest useful change?: yes.\n- Anything to revert before review?: none.`,
            timestamp: '2026-05-13T21:05:00.000Z',
          },
        ],
        escalations: [
          {
            id: 'esc-a-1',
            taskId: 'a',
            agentId: 'worker-agent',
            reason: 'gate_hard_failure',
            summary: 'Blocked from transitioning to review — system validator bug persists',
            details:
              'Implementation complete with all acceptance criteria are met and both verification commands passing. A human needs to resolve this validator issue to allow the review transition.',
            raisedAt: '2026-05-13T21:06:16.000Z',
          },
        ],
      }),
    ])

    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({
        worker: stubAgent('worker-agent', async () => {
          await mutateTask('a', { status: 'review' })
        }),
      }),
      gitDriver: new InMemoryGitDriver({ clean: true }),
    })

    const out = await orch.tick()

    expect(out.kind).toBe('processed')
    if (out.kind === 'processed') {
      expect(out.beforeStatus).toBe('in_progress')
      expect(out.afterStatus).toBe('review')
    }

    const queue = await readQueue()
    const task = queue.tasks.find((candidate) => candidate.id === 'a')
    expect(task?.status).toBe('review')
    expect(task?.assignedTo).toBe('reviewer-agent')
    expect(task?.blockReason ?? null).toBeNull()
    expect(task?.notes.some((note) =>
      note.role === 'recovery' &&
      note.content.includes('review handoff validator bug'),
    )).toBe(true)
    expect(task?.escalations[0]?.resolvedBy).toBe('system')
    expect(task?.escalations[0]?.resolution).toContain('Superseded')
  })

  it('auto-promotes a worker task to review when durable handoff evidence already exists but the worker leaves it in progress', async () => {
    await writeQueue([
      mkTask({
        id: 'a',
        status: 'in_progress',
        assignedTo: 'worker-agent',
        spec: VALID_SPEC,
        notes: [
          {
            agentId: 'worker-agent',
            role: 'self-critique',
            content: `**Self-critique:**\n\n**Acceptance criteria:**\n- AC 1 (Conversion): Met — focused tests cover the touched files.\n\n**Minimum-scope check:**\n- Files changed: packages/converter/src/features/variableDeclaration.ts.\n- Smallest useful change?: yes.\n- Anything to revert before review?: none.\n\n**Review proof packet:**\n- Changed files / diff scope: packages/converter/src/features/variableDeclaration.ts, packages/converter/test/ts-to-jsdoc.test.ts.\n- Verification commands passed: cd /tmp/project/packages/converter && pnpm vitest --run test/ts-to-jsdoc.test.ts passed.\n- Working hypothesis at handoff: The converter change and focused tests are ready for reviewer evaluation.\n- Known gaps / follow-up: none.`,
            timestamp: '2026-05-13T15:00:00.000Z',
          },
        ],
      }),
    ])

    const worker: OrchestratorAgent = {
      name: 'worker-agent',
      async generate() {
        return { text: 'ok' }
      },
      getToolMetadata() {
        return {
          current_task_checkpoint_next_action:
            'Resume from the latest self-critique and recorded verification evidence, then hand off to review.',
          current_task_checkpoint_files_touched: [
            'packages/converter/src/features/variableDeclaration.ts',
            'packages/converter/test/ts-to-jsdoc.test.ts',
          ],
          review_handoff_evidence: {
            taskId: 'a',
            changedOrVerified: true,
          },
          recent_verified_work: [
            'Edited file /tmp/project/packages/converter/src/features/variableDeclaration.ts',
            'Ran bash command cd /tmp/project/packages/converter && pnpm vitest --run test/ts-to-jsdoc.test.ts',
          ],
        }
      },
    }

    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
      gitDriver: new InMemoryGitDriver({ clean: true }),
    })
    const out = await orch.tick()

    expect(out.kind).toBe('processed')
    if (out.kind === 'processed') {
      expect(out.beforeStatus).toBe('in_progress')
      expect(out.afterStatus).toBe('review')
      expect(out.transitioned).toBe(true)
    }

    const queue = await readQueue()
    const task = queue.tasks.find((candidate) => candidate.id === 'a')
    expect(task?.status).toBe('review')
    expect(task?.assignedTo).toBe('reviewer-agent')
    expect(task?.blockReason ?? null).toBeNull()
  })

  it('synthesizes checkpoint-backed self-critique when verified work is stuck in handoff ceremony', async () => {
    const worktreePath = path.join(tmpDir, 'checkpoint-backed-handoff')
    await fs.mkdir(worktreePath, { recursive: true })
    await writeQueue([
      mkTask({
        id: 'debug-report',
        status: 'in_progress',
        assignedTo: 'worker-agent',
        projectPath: tmpDir,
        worktreePath,
        spec: 'Generate a developer-readable debug report for each run.',
        acceptanceCriteria: [{
          id: 'AC1',
          description: 'Debug report command generates a report.',
          verifiedBy: 'automated',
          command: 'node scripts/generate-debug-report.mjs runs/example.json',
          met: false,
        } as any],
      }),
    ])

    const worker: OrchestratorAgent = {
      name: 'worker-agent',
      async generate() {
        return { text: 'Build passes, but I failed to call update-task correctly.' }
      },
      getToolMetadata() {
        return {
          current_task_checkpoint_next_action:
            'All authoritative verification commands have passed. Persist the structured self-critique note, then transition the task to review.',
          current_task_checkpoint_files_touched: [
            'scripts/generate-debug-report.mjs',
            'runs/example-debug-report.md',
          ],
          recent_verified_work: [
            'Ran bash command node scripts/generate-debug-report.mjs runs/example.json',
            'Ran bash command npm run build',
          ],
        }
      },
    }

    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
      gitDriver: new InMemoryGitDriver({ clean: true }),
    })
    const out = await orch.tick()

    expect(out.kind).toBe('processed')
    if (out.kind === 'processed') {
      expect(out.afterStatus).toBe('review')
      expect(out.transitioned).toBe(true)
    }

    const queue = await readQueue()
    const task = queue.tasks.find((candidate) => candidate.id === 'debug-report')
    expect(task?.status).toBe('review')
    expect(task?.assignedTo).toBe('reviewer-agent')
    const selfCritique = task?.notes.find((note) => note.role === 'self-critique')
    expect(selfCritique?.content).toContain('synthesized by Guildhall from durable checkpoint evidence')
    expect(selfCritique?.content).toContain('Review proof packet:')
  })

  it('auto-promotes fresh worker self-critique handoffs with verified target-file changes', async () => {
    const projectPath = path.join(tmpDir, 'fresh-handoff-target-change')
    await fs.mkdir(projectPath, { recursive: true })
    execFileSync('git', ['init'], { cwd: projectPath, stdio: 'ignore' })
    await fs.writeFile(path.join(projectPath, 'RELEASE_NOTES.md'), '# Release Notes\n- Placeholder note.\n', 'utf8')

    await writeQueue([
      mkTask({
        id: 'artifact-patch',
        status: 'in_progress',
        assignedTo: 'worker-agent',
        projectPath,
        spec: [
          '## Summary',
          'Append the exact bullet `- Added benchmark artifact evidence.` to `RELEASE_NOTES.md`.',
          '',
          '## Acceptance Criteria',
          '1. `RELEASE_NOTES.md` contains `- Added benchmark artifact evidence.`.',
          '2. No other files change.',
        ].join('\n'),
        acceptanceCriteria: [
          {
            id: 'AC1',
            description: 'RELEASE_NOTES.md contains the requested bullet.',
            verifiedBy: 'automated',
            met: false,
          },
          {
            id: 'AC2',
            description: 'No other files change.',
            verifiedBy: 'automated',
            met: false,
          },
        ],
      }),
    ])

    const worker: OrchestratorAgent = {
      name: 'worker-agent',
      async generate() {
        await fs.appendFile(path.join(projectPath, 'RELEASE_NOTES.md'), '- Added benchmark artifact evidence.\n')
        await mutateTask('artifact-patch', {
          notes: [
            {
              agentId: 'worker-agent',
              role: 'self-critique',
              content: [
                '**Self-critique:**',
                '',
                'For each acceptance criterion:',
                '- AC1: Met — grep exits 0.',
                '- AC2: Met — git diff --name-only shows only RELEASE_NOTES.md.',
                '',
                'Minimum-scope check:',
                '- Files changed: RELEASE_NOTES.md.',
                '- Smallest useful change?: yes — one line appended.',
                '- Corpus fit: existing release notes artifact.',
                '- Abstraction fit: n-a.',
                '- Anything to revert before review?: none.',
                '',
                'Review proof packet:',
                '- Changed files / diff scope: RELEASE_NOTES.md only.',
                '- Verification commands passed: grep -q "benchmark artifact evidence" RELEASE_NOTES.md passed.',
                '- Proof path updates: local filesystem proof only.',
                '- Working hypothesis at handoff: The artifact patch is ready for review.',
                '- Known gaps / follow-up: none.',
                '',
                'Out-of-scope changes introduced: None.',
                'Uncertainties: None.',
              ].join('\n'),
              timestamp: '2026-05-30T12:00:00.000Z',
            },
          ],
        })
        return { text: 'Implemented and handed off.' }
      },
      getToolMetadata() {
        return {
          review_handoff_evidence: {
            taskId: 'artifact-patch',
            changedOrVerified: true,
          },
          recent_verified_work: [
            'Edited file RELEASE_NOTES.md',
            'Ran bash command grep -q "benchmark artifact evidence" RELEASE_NOTES.md [PASS]',
          ],
        }
      },
    }

    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
      gitDriver: new InMemoryGitDriver({ clean: true }),
    })
    const out = await orch.tick()

    expect(out.kind).toBe('processed')
    if (out.kind === 'processed') {
      expect(out.beforeStatus).toBe('in_progress')
      expect(out.afterStatus).toBe('review')
      expect(out.transitioned).toBe(true)
    }

    const task = (await readQueue()).tasks.find((candidate) => candidate.id === 'artifact-patch')
    expect(task?.status).toBe('review')
    expect(task?.assignedTo).toBe('reviewer-agent')
    expect(task?.notes.some((note) => note.role === 'worker-progress-review')).toBe(false)
  })

  it('promotes an existing worker review proof packet before redispatching the worker', async () => {
    const worktreePath = path.join(tmpDir, 'existing-proof-worktree')
    await fs.mkdir(worktreePath, { recursive: true })
    await writeQueue([
      mkTask({
        id: 'schema-narrowing',
        status: 'in_progress',
        assignedTo: 'worker-agent',
        worktreePath,
        spec: VALID_SPEC,
        notes: [
          {
            agentId: 'worker-agent',
            role: 'backend-engineer',
            content: [
              '**Self-critique:**',
              '',
              'For each acceptance criterion:',
              '- AC1: Met — docs/specs/mvp-story-memory-schema-narrowing.md records the narrowed schema.',
              '',
              'Minimum-scope check:',
              '- Files changed: docs/specs/mvp-story-memory-schema-narrowing.md, docs/specs/schema-contract-roadmap.md.',
              '- Smallest useful change?: yes — documentation-only narrowing proof.',
              '- Anything to revert before review?: none.',
              '',
              'Review proof packet:',
              '- Changed files / diff scope: docs/specs/mvp-story-memory-schema-narrowing.md and docs/specs/schema-contract-roadmap.md.',
              '- Verification commands passed: npm run build passed.',
              '- Working hypothesis at handoff: The schema-narrowing proof is ready for review.',
              '- Known gaps / follow-up: none.',
            ].join('\n'),
            timestamp: '2026-07-04T11:45:33.236Z',
          },
        ],
      }),
    ])

    const worker: OrchestratorAgent = {
      name: 'worker-agent',
      async generate() {
        throw new Error('worker should not be redispatched')
      },
    }

    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
      gitDriver: new InMemoryGitDriver({ clean: false }),
    })
    const out = await orch.tick()

    expect(out.kind).toBe('processed')
    if (out.kind === 'processed') {
      expect(out.beforeStatus).toBe('in_progress')
      expect(out.afterStatus).toBe('review')
      expect(out.transitioned).toBe(true)
      expect(out.agent).toBe('coordinator-recovery')
    }

    const task = (await readQueue()).tasks.find((candidate) => candidate.id === 'schema-narrowing')
    expect(task?.status).toBe('review')
    expect(task?.assignedTo).toBe('reviewer-agent')
    expect(task?.notes.some((note) =>
      note.role === 'recovery' &&
      note.content.includes('existing worker self-critique with a review proof packet'),
    )).toBe(true)
  })

  it('does not promote stale worker proof when newer review feedback requests revisions', async () => {
    const worktreePath = path.join(tmpDir, 'stale-proof-worktree')
    await fs.mkdir(worktreePath, { recursive: true })
    await writeQueue([
      mkTask({
        id: 'schema-narrowing',
        status: 'in_progress',
        assignedTo: 'worker-agent',
        worktreePath,
        spec: VALID_SPEC,
        notes: [
          {
            agentId: 'worker-agent',
            role: 'backend-engineer',
            content: [
              '**Self-critique:**',
              '',
              'For each acceptance criterion:',
              '- AC1: Met — docs/specs/mvp-story-memory-schema-narrowing.md records the narrowed schema.',
              '',
              'Minimum-scope check:',
              '- Files changed: docs/specs/mvp-story-memory-schema-narrowing.md.',
              '- Smallest useful change?: yes.',
              '',
              'Review proof packet:',
              '- Changed files / diff scope: docs/specs/mvp-story-memory-schema-narrowing.md.',
              '- Verification commands passed: npm run build passed.',
              '- Working hypothesis at handoff: The schema-narrowing proof is ready for review.',
            ].join('\n'),
            timestamp: '2026-07-04T11:45:33.236Z',
          },
          {
            agentId: 'reviewer-fanout',
            role: 'reviewer',
            content: [
              '**Aggregated revisions from 1 persona:**',
              '',
              'Recommended task-local revisions:',
              '- Add the missing proof command capture before acceptance.',
            ].join('\n'),
            timestamp: '2026-07-04T11:50:33.236Z',
          },
          {
            agentId: 'coordinator-harness-prototype',
            role: 'coordinator',
            content: [
              '**Coordinator adjudication (round 5):**',
              '',
              'Coordinator adjudicated: worker to address 1 scoped item from security-engineer',
              '',
              '**Scoped instructions (address exactly these items):**',
              '- Add the missing proof command capture before acceptance.',
            ].join('\n'),
            timestamp: '2026-07-04T11:51:33.236Z',
          },
          {
            agentId: 'coordinator',
            role: 'recovery',
            content:
              'User restarted the project after Guildhall hit the review revision cap. Reopened the task so the worker can address the latest substantive review feedback instead of treating that cap as terminal.',
            timestamp: '2026-07-04T11:52:33.236Z',
          },
        ],
      }),
    ])

    let workerCalled = false
    const worker: OrchestratorAgent = {
      name: 'worker-agent',
      async generate() {
        workerCalled = true
        await mutateTask('schema-narrowing', {
          status: 'in_progress',
          assignedTo: 'worker-agent',
        })
        return { text: 'worker resumed' }
      },
    }

    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
      gitDriver: new InMemoryGitDriver({ clean: false }),
    })
    const out = await orch.tick()

    expect(workerCalled).toBe(true)
    expect(out.kind).toBe('processed')
    if (out.kind === 'processed') {
      expect(out.beforeStatus).toBe('in_progress')
      expect(out.afterStatus).toBe('in_progress')
      expect(out.agent).toBe('worker-agent')
    }

    const task = (await readQueue()).tasks.find((candidate) => candidate.id === 'schema-narrowing')
    expect(task?.status).toBe('in_progress')
    expect(task?.assignedTo).toBe('worker-agent')
    expect(task?.notes.some((note) =>
      note.role === 'recovery' &&
      note.content.includes('existing worker self-critique with a review proof packet'),
    )).toBe(false)
  })

  it('uses handoff-specific immediate resume instructions instead of file-open instructions when a review handoff checkpoint exists', async () => {
    await writeQueue([
      mkTask({
        id: 'a',
        status: 'in_progress',
        assignedTo: 'worker-agent',
        title: 'Resume handoff',
        spec: VALID_SPEC,
        notes: [
          {
            agentId: 'worker-agent',
            role: 'self-critique',
            content: `**Self-critique:**\n\nAC-1: Met.\n\n**Minimum-scope check:**\n- Files changed: src/a.ts.\n- Smallest useful change?: yes.\n- Anything to revert before review?: none.`,
            timestamp: '2026-05-13T15:00:00.000Z',
          },
        ],
      }),
    ])

    const checkpointDir = getProjectTaskLocalHistoryDir(tmpDir, 'a')
    await fs.mkdir(checkpointDir, { recursive: true })
    await fs.writeFile(
      path.join(checkpointDir, 'checkpoint.json'),
      JSON.stringify({
        taskId: 'a',
        agentId: 'worker-agent',
        step: 3,
        intent: 'resume handoff',
        filesTouched: ['src/a.ts'],
        nextPlannedAction:
          'Resume from the latest self-critique and recorded verification evidence, then hand off to review.',
        writtenAt: '2026-05-13T15:00:00.000Z',
      }),
    )

    let seenPrompt = ''
    const worker: OrchestratorAgent = {
      name: 'worker-agent',
      async generate(prompt: string) {
        seenPrompt = prompt
        return { text: 'ok' }
      },
      loadToolMetadata() {},
    }

    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
      gitDriver: new InMemoryGitDriver({ clean: true }),
    })
    await orch.tick()

    expect(seenPrompt).toContain('already at the review handoff stage')
    expect(seenPrompt).toContain('Your first action should be the exact handoff')
    expect(seenPrompt).not.toContain('Open or edit these exact files before any directory listing')
  })

  it('uses handoff-specific immediate resume instructions when proof and self-critique exist even with a noisy checkpoint', async () => {
    await writeQueue([
      mkTask({
        id: 'a',
        status: 'in_progress',
        assignedTo: 'worker-agent',
        title: 'Resume proven handoff',
        spec: VALID_SPEC,
        notes: [
          {
            agentId: 'worker-agent',
            role: 'self-critique',
            content: [
              '**Self-critique:**',
              '',
              'For each acceptance criterion:',
              '- ac-1: Met.',
              '',
              '**Minimum-scope check:**',
              '- Files changed: docs/harness/remaining-spec-decomposition-inventory.md.',
              '- Smallest useful change?: yes.',
              '- Anything to revert before review?: none.',
              '',
              '**Review proof packet:**',
              '- Changed files: docs/harness/remaining-spec-decomposition-inventory.md.',
              '- Verification commands passed: npm run build.',
            ].join('\n'),
            timestamp: '2026-05-13T15:00:00.000Z',
          },
        ],
      }),
    ])

    const checkpointDir = getProjectTaskLocalHistoryDir(tmpDir, 'a')
    await fs.mkdir(checkpointDir, { recursive: true })
    await fs.writeFile(
      path.join(checkpointDir, 'checkpoint.json'),
      JSON.stringify({
        taskId: 'a',
        agentId: 'worker-agent',
        step: 4,
        intent: 'resume noisy worker state',
        filesTouched: ['docs/harness/remaining-spec-decomposition-inventory.md'],
        nextPlannedAction:
          'Read likely target files to understand the current state, then verify sibling task notes.',
        writtenAt: '2026-05-13T15:00:00.000Z',
      }),
    )

    let seenPrompt = ''
    const worker: OrchestratorAgent = {
      name: 'worker-agent',
      async generate(prompt: string) {
        seenPrompt = prompt
        return { text: 'ok' }
      },
      loadToolMetadata() {},
    }

    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
      gitDriver: new InMemoryGitDriver({ clean: true }),
    })
    await orch.tick()

    expect(seenPrompt).toContain('already has durable verification proof and a structured self-critique')
    expect(seenPrompt).toContain('Your first action should be the exact handoff')
    expect(seenPrompt).not.toContain('Open or edit these files before any directory listing')
    expect(seenPrompt).not.toContain('Do not use list-files, glob, or generic repo-root shell inspection')
  })

  it('reopens an already-existing task-branch blocker so Guildhall can attach the branch and continue', async () => {
    const subrepo = path.join(tmpDir, 'frontend')
    const guildhallHome = path.join(tmpDir, '.guildhall-home')
    process.env.GUILDHALL_CONFIG_DIR = guildhallHome
    await fs.mkdir(subrepo, { recursive: true })

    const settings = makeDefaultSettings(new Date('2026-05-03T00:00:00Z'))
    settings.project.worktree_isolation = {
      position: 'per_task',
      rationale: 'test',
      setAt: '2026-05-03T00:00:00Z',
      setBy: 'user-direct',
    }
    await saveLeverSettings({
      path: agentSettingsPath,
      settings,
    })

    await writeQueue([
      mkTask({
        id: 'a',
        status: 'blocked',
        assignedTo: null,
        domain: 'frontend',
        projectPath: subrepo,
        spec: VALID_SPEC,
        blockReason:
          'Guildhall could not create a task worktree: ' +
          'fatal: a branch named \'guildhall/task-a\' already exists. ' +
          'Fix the worktree setup issue, then resume the task.',
        notes: [
          {
            agentId: 'task-claimer',
            role: 'orchestrator',
            content: 'Claimed ready task for worker-agent.',
            timestamp: '2026-05-03T00:00:00.000Z',
          },
        ],
      }),
    ])

    const gitDriver = new InMemoryGitDriver({ clean: true })
    const agents: OrchestratorAgentSet = {
      spec: stubAgent('spec-agent'),
      worker: stubAgent('worker-agent', async () => {
        await mutateTask('a', { status: 'review' })
      }),
      reviewer: stubAgent('reviewer-agent'),
      gateChecker: stubAgent('gate-checker-agent'),
      coordinators: {},
    }

    const orch = new Orchestrator({
      config: baseConfig({ projectPath: tmpDir }),
      agents,
      gitDriver,
    })
    const out = await orch.tick()

    expect(out.kind).toBe('processed')
    if (out.kind === 'processed') {
      expect(out.beforeStatus).toBe('in_progress')
      expect(out.afterStatus).toBe('review')
    }

    const queue = await readQueue()
    const task = queue.tasks.find((candidate) => candidate.id === 'a')
    expect(task?.status).toBe('review')
    expect(task?.notes.some((note) => note.role === 'recovery')).toBe(true)
    expect(gitDriver.state.createdWorktrees).toHaveLength(1)
    expect(gitDriver.state.createdWorktrees[0]?.branch).toBe('guildhall/task-a')
    delete process.env.GUILDHALL_CONFIG_DIR
  })

  it('reopens a stale turn-limit blocker when the user explicitly restarts the project', async () => {
    await writeQueue([
      mkTask({
        id: 'a',
        status: 'blocked',
        assignedTo: null,
        spec: VALID_SPEC,
        blockReason: 'human_judgment_required: Worker stopped after hitting its turn limit.',
        notes: [
          {
            agentId: 'task-claimer',
            role: 'orchestrator',
            content: 'Claimed ready task for worker-agent.',
            timestamp: '2026-05-03T00:00:00.000Z',
          },
        ],
        escalations: [
          {
            id: 'esc-a-1',
            taskId: 'a',
            agentId: 'worker-agent',
            reason: 'human_judgment_required',
            summary: 'Worker stopped after hitting its turn limit.',
            details: 'Exceeded maximum turn limit (24)',
            raisedAt: '2026-05-03T00:11:00.000Z',
          },
        ],
      }),
    ])

    let seenPrompt = ''
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({
        worker: stubAgent('worker-agent', async (prompt) => {
          seenPrompt = prompt
          await mutateTask('a', { status: 'in_progress' })
        }),
      }),
      gitDriver: new InMemoryGitDriver({ clean: true }),
    })

    const out = await orch.tick()

    expect(out.kind).toBe('processed')
    if (out.kind === 'processed') {
      expect(out.beforeStatus).toBe('ready')
      expect(out.afterStatus).toBe('in_progress')
    }

    const queue = await readQueue()
    const task = queue.tasks.find((candidate) => candidate.id === 'a')
    expect(task?.status).toBe('in_progress')
    expect(task?.assignedTo).toBe('worker-agent')
    expect(task?.blockReason ?? null).toBeNull()
    expect(task?.notes.some((note) =>
      note.role === 'recovery' &&
      note.content.includes('worker exhausted its turn budget'),
    )).toBe(true)
    expect(task?.escalations[0]?.resolvedBy).toBe('system')
    expect(task?.escalations[0]?.resolution).toContain('explicitly resumed')
  })

  it('reopens a stale tool/path mismatch blocker after task-worktree routing is fixed', async () => {
    await writeQueue([
      mkTask({
        id: 'a',
        status: 'blocked',
        assignedTo: null,
        spec: VALID_SPEC,
        blockReason: 'decision_required: Tool reads are being intercepted to an unrelated missing file, blocking implementation',
        notes: [
          {
            agentId: 'task-claimer',
            role: 'orchestrator',
            content: 'Claimed ready task for worker-agent.',
            timestamp: '2026-05-03T00:00:00.000Z',
          },
        ],
        escalations: [
          {
            id: 'esc-a-1',
            taskId: 'a',
            agentId: 'worker-agent',
            reason: 'decision_required',
            summary: 'Tool reads are being intercepted to an unrelated missing file, blocking implementation',
            details: 'The required companion file read was misrouted into a different task worktree.',
            raisedAt: '2026-05-03T00:11:00.000Z',
          },
        ],
      }),
    ])

    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({
        worker: stubAgent('worker-agent', async () => {
          await mutateTask('a', { status: 'in_progress' })
        }),
      }),
      gitDriver: new InMemoryGitDriver({ clean: true }),
    })

    const out = await orch.tick()

    expect(out.kind).toBe('processed')
    if (out.kind === 'processed') {
      expect(out.beforeStatus).toBe('ready')
      expect(out.afterStatus).toBe('in_progress')
    }

    const queue = await readQueue()
    const task = queue.tasks.find((candidate) => candidate.id === 'a')
    expect(task?.status).toBe('in_progress')
    expect(task?.assignedTo).toBe('worker-agent')
    expect(task?.blockReason ?? null).toBeNull()
    expect(task?.notes.some((note) =>
      note.role === 'recovery' &&
      note.content.includes('old tool/path routing bug'),
    )).toBe(true)
    expect(task?.escalations[0]?.resolvedBy).toBe('system')
    expect(task?.escalations[0]?.resolution).toContain('task-worktree path/context routing')
  })

  it('runs foreman inspection before escalating stale blueprint tooling blockers to the user', async () => {
    const coordinator = stubAgent('coordinator-looma', async () => {
      await mutateTask('a', { status: 'ready', assignedTo: null })
    })
    await writeQueue([
      mkTask({
        id: 'a',
        status: 'blocked',
        assignedTo: null,
        spec: VALID_SPEC,
        acceptanceCriteria: [{
          id: 'ac-1',
          description: 'Thing is done',
          verifiedBy: 'review',
          met: false,
        }],
        productBrief: {
          userJob: 'I want auth profile management completed.',
          successMetric: 'The auth profile management acceptance criterion is met.',
          antiPatterns: [],
          approvedAt: '2026-05-26T00:00:00.000Z',
        },
        blockReason: 'human_judgment_required: Cannot author missing useAuth.ts during blueprint phase for a spec task.',
        notes: [
          {
            agentId: 'spec-agent',
            role: 'blueprint-review',
            content: 'Reviewed auth files and prepared the spec.',
            timestamp: '2026-05-03T00:00:00.000Z',
          },
        ],
        escalations: [
          {
            id: 'esc-a-1',
            taskId: 'a',
            agentId: 'spec-agent',
            reason: 'human_judgment_required',
            summary: 'Cannot author missing useAuth.ts during blueprint phase for a spec task.',
            details:
              'The read-only planning lane is being forced to create frontend/app/composables/useAuth.ts before it can inspect nearby evidence.',
            raisedAt: '2026-05-03T00:11:00.000Z',
          },
        ],
      }),
      mkTask({
        id: 'b',
        status: 'blocked',
        assignedTo: null,
        title: 'Choose billing model',
        blockReason: 'human_judgment_required: Owner decision needed on per-seat billing vs project billing.',
        escalations: [
          {
            id: 'esc-b-1',
            taskId: 'b',
            agentId: 'spec-agent',
            reason: 'human_judgment_required',
            summary: 'Owner decision needed on billing model.',
            details: 'The project can support either per-seat billing or project billing; the owner must choose.',
            raisedAt: '2026-05-03T00:12:00.000Z',
          },
        ],
      }),
    ])

    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({
        coordinators: { looma: coordinator },
      }),
      gitDriver: new InMemoryGitDriver({ clean: true }),
    })

    const out = await orch.tick()

    expect(out.kind).toBe('processed')
    if (out.kind === 'processed') {
      expect(out.beforeStatus).toBe('spec_review')
      expect(out.afterStatus).toBe('ready')
    }
    expect(coordinator.calls).toHaveLength(1)

    const queue = await readQueue()
    const inspected = queue.tasks.find((candidate) => candidate.id === 'a')
    const realDecision = queue.tasks.find((candidate) => candidate.id === 'b')
    expect(inspected?.blockReason ?? null).toBeNull()
    expect(inspected?.notes.some((note) =>
      note.agentId === 'coordinator' &&
      note.role === 'foreman-inspection' &&
      note.content.includes('stale blueprint/tooling blocker'),
    )).toBe(true)
    expect(inspected?.escalations[0]?.resolvedBy).toBe('coordinator')
    expect(inspected?.escalations[0]?.resolution).toContain('Foreman inspection')
    expect(realDecision?.status).toBe('blocked')
    expect(realDecision?.escalations[0]?.resolvedAt).toBeUndefined()
  })

  it('reopens a stale spec no-progress blocker into intake after transcript preservation is fixed', async () => {
    await writeQueue([
      mkTask({
        id: 'a',
        status: 'blocked',
        assignedTo: null,
        title: 'Emoji',
        blockReason: 'human_judgment_required: Spec agent made no visible progress after 3 passes.',
        notes: [
          {
            agentId: 'task-claimer',
            role: 'orchestrator',
            content: 'Claimed ready task for spec-agent.',
            timestamp: '2026-05-03T00:00:00.000Z',
          },
        ],
        escalations: [
          {
            id: 'esc-a-1',
            taskId: 'a',
            agentId: 'spec-agent',
            reason: 'human_judgment_required',
            summary: 'Spec agent made no visible progress after 3 passes.',
            details: 'Task remained in exploring with no saved spec.',
            raisedAt: '2026-05-03T00:11:00.000Z',
          },
        ],
      }),
    ])

    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({
        spec: stubAgent('spec-agent', async () => {
          await mutateTask('a', { status: 'spec_review' })
        }),
      }),
      gitDriver: new InMemoryGitDriver({ clean: true }),
    })

    const out = await orch.tick()

    expect(out.kind).toBe('processed')
    if (out.kind === 'processed') {
      expect(out.beforeStatus).toBe('exploring')
      expect(out.afterStatus).toBe('spec_review')
    }

    const queue = await readQueue()
    const task = queue.tasks.find((candidate) => candidate.id === 'a')
    expect(task?.status).toBe('spec_review')
    expect(task?.blockReason ?? null).toBeNull()
    expect(task?.notes.some((note) =>
      note.role === 'recovery' &&
      note.content.includes('failed to save a durable draft'),
    )).toBe(true)
    expect(task?.escalations[0]?.resolvedBy).toBe('system')
    expect(task?.escalations[0]?.resolution).toContain('preserve useful transcript context')
  })

  it('reopens a checkpoint-backed worker timeout blocker when the user explicitly restarts the project', async () => {
    await writeQueue([
      mkTask({
        id: 'a',
        status: 'blocked',
        assignedTo: null,
        spec: VALID_SPEC,
        blockReason: 'human_judgment_required: Worker timed out after failing to mutate the likely target file.',
        notes: [
          {
            agentId: 'task-claimer',
            role: 'orchestrator',
            content: 'Claimed ready task for worker-agent.',
            timestamp: '2026-05-03T00:00:00.000Z',
          },
        ],
        escalations: [
          {
            id: 'esc-a-1',
            taskId: 'a',
            agentId: 'worker-agent',
            reason: 'human_judgment_required',
            summary: 'Worker timed out after failing to mutate the likely target file.',
            details: 'worker-agent timed out after 120000ms of inactivity',
            raisedAt: '2026-05-03T00:11:00.000Z',
          },
        ],
      }),
    ])

    const taskDir = getProjectTaskLocalHistoryDir(tmpDir, 'a')
    await fs.mkdir(taskDir, { recursive: true })
    await fs.writeFile(path.join(taskDir, 'checkpoint.json'), JSON.stringify({
      taskId: 'a',
      agentId: 'worker-agent',
      step: 11,
      intent: 'Recovery checkpoint',
      filesTouched: ['packages/converter/src/features/variableDeclaration.ts'],
      nextPlannedAction: 'Resume from the recorded verification evidence, write or refresh the self-critique note, then hand off to review.',
      writtenAt: '2026-05-03T00:10:00.000Z',
    }, null, 2))

    let seenPrompt = ''
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({
        worker: stubAgent('worker-agent', async (prompt) => {
          seenPrompt = prompt
          await mutateTask('a', { status: 'in_progress' })
        }),
      }),
      gitDriver: new InMemoryGitDriver({ clean: true }),
    })

    const out = await orch.tick()

    expect(out.kind).toBe('processed')
    if (out.kind === 'processed') {
      expect(out.beforeStatus).toBe('in_progress')
      expect(out.afterStatus).toBe('in_progress')
    }

    const queue = await readQueue()
    const task = queue.tasks.find((candidate) => candidate.id === 'a')
    expect(task?.status).toBe('in_progress')
    expect(task?.assignedTo).toBe('worker-agent')
    expect(task?.blockReason ?? null).toBeNull()
    expect(task?.notes.some((note) =>
      note.role === 'recovery' &&
      note.content.includes('latest recovery checkpoint'),
    )).toBe(true)
    expect(task?.escalations[0]?.resolvedBy).toBe('system')
    expect(task?.escalations[0]?.resolution).toContain('latest recovery checkpoint')
    expect(seenPrompt).toContain('rerun the focused verification commands')
    expect(seenPrompt).not.toContain('write or refresh the self-critique note, then hand off to review')
  })

  it('reopens a self-authored verification blocker when the user explicitly restarts the project', async () => {
    await writeQueue([
      mkTask({
        id: 'a',
        title: 'Proper invite flow',
        status: 'blocked',
        assignedTo: null,
        blockReason:
          'spec_ambiguous: Unable to resolve type errors in settings.vue and invite.post.ts due to missing imports and utilities.',
        spec: [
          'Implement the Supabase invite flow in Knit settings.',
          '- web/app/pages/settings.vue should expose the invite form and send handler.',
          '- web/server/api/workspaces/[id]/invite.post.ts should validate roles and send the invite.',
        ].join('\n'),
        acceptanceCriteria: [{
          id: 'ac-1',
          description: 'typecheck passes',
          verifiedBy: 'automated',
          command: 'cd web && pnpm typecheck',
          met: false,
        } as any],
        escalations: [
          {
            id: 'esc-a-1',
            taskId: 'a',
            agentId: 'worker-agent',
            reason: 'spec_ambiguous',
            summary:
              'Unable to resolve type errors in settings.vue and invite.post.ts due to missing imports and utilities.',
            details:
              "The files web/app/pages/settings.vue and web/server/api/workspaces/[id]/invite.post.ts contain references to 'sendInvite', 'sendToast' and 'Role' that cannot be resolved after the worker implementation.",
            raisedAt: '2026-04-01T00:00:01Z',
          },
        ],
      }),
    ])
    await writeCheckpoint({
      tasksPath,
      memoryDir,
      taskId: 'a',
      agentId: 'worker-agent',
      intent: 'Repair failed verification',
      nextPlannedAction:
        'Resume from the recorded verification evidence, rerun the focused verification commands, and fix whatever still fails.',
      filesTouched: [
        'web/app/pages/settings.vue',
        'web/server/api/workspaces/[id]/invite.post.ts',
      ],
      resumeContext: {
        verification: [{
          command: 'cd web && pnpm typecheck',
          passed: false,
          observedAt: '2026-05-16T00:00:00.000Z',
          summary:
            'settings.vue cannot find sendInvite; invite.post.ts cannot find sendToast or Role',
        }],
      },
    })

    let seenPrompt = ''
    const worker = {
      ...stubAgent('worker-agent', async (prompt) => {
        seenPrompt = prompt
        await mutateTask('a', { status: 'in_progress' })
      }),
      loadToolMetadata() {
        return {}
      },
    }
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
      gitDriver: new InMemoryGitDriver({ clean: false }),
    })

    const out = await orch.tick()

    expect(out.kind).toBe('processed')
    const queue = await readQueue()
    const task = queue.tasks.find((candidate) => candidate.id === 'a')
    expect(task?.status).toBe('in_progress')
    expect(task?.assignedTo).toBe('worker-agent')
    expect(task?.blockReason ?? null).toBeNull()
    expect(task?.escalations[0]?.resolvedBy).toBe('system')
    expect(task?.escalations[0]?.resolution).toContain('worker-owned verification confusion')
    expect(task?.notes.at(-1)?.content).toContain('rerun the focused verification')
    expect(seenPrompt).toContain('Authoritative verification commands')
  })

  it('reopens an infra-only max-revisions blocker at review when the user explicitly restarts the project', async () => {
    await writeQueue([
      mkTask({
        id: 'a',
        status: 'blocked',
        assignedTo: null,
        spec: VALID_SPEC,
        acceptanceCriteria: [
          { id: 'ac-1', description: 'done', met: true, verifiedBy: 'review' },
        ],
        blockReason: 'max_revisions_exceeded: Exceeded maxRevisions (3). Reviewer fan-out keeps rejecting.',
        reviewVerdicts: [
          {
            verdict: 'revise',
            reviewerPath: 'llm',
            reason: 'The Copywriter requested revision',
            reasoning: 'Real earlier revision item that has already been handled.',
            recordedAt: '2026-05-03T00:09:00.000Z',
            failingSignals: ['copywriter'],
          },
          {
            verdict: 'revise',
            reviewerPath: 'llm',
            reason: 'The Component Designer requested revision',
            reasoning: 'The Component Designer failed to produce a verdict (Exceeded maximum turn limit (3)). Treating as revise per strict-all policy.',
            recordedAt: '2026-05-03T00:10:00.000Z',
            failingSignals: ['component-designer'],
          },
          {
            verdict: 'approve',
            reviewerPath: 'llm',
            reason: 'The Copywriter approved',
            reasoning: 'Looks good.',
            recordedAt: '2026-05-03T00:10:00.000Z',
            failingSignals: [],
          },
        ],
        escalations: [
          {
            id: 'esc-a-1',
            taskId: 'a',
            agentId: 'reviewer-fanout',
            reason: 'max_revisions_exceeded',
            summary: 'Exceeded maxRevisions (3). Reviewer fan-out keeps rejecting.',
            details: 'The Component Designer failed to produce a verdict (Exceeded maximum turn limit (3)). Treating as revise per strict-all policy.',
            raisedAt: '2026-05-03T00:11:00.000Z',
          },
        ],
      }),
    ])

    const runner: ReviewerFanoutRunner = async () => [
      {
        guildSlug: 'component-designer',
        guildName: 'The Component Designer',
        verdict: 'revise',
        reasoning: 'The Component Designer failed to produce a verdict (Exceeded maximum turn limit (3)). Treating as revise per strict-all policy.',
        revisionItems: [],
        rawOutput: '**Verdict:** revise',
      },
      {
        guildSlug: 'copywriter',
        guildName: 'The Copywriter',
        verdict: 'approve',
        reasoning: 'Looks good.',
        revisionItems: [],
        rawOutput: '**Verdict:** approve',
      },
    ]

    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet(),
      reviewerFanout: runner,
      gitDriver: new InMemoryGitDriver({ clean: true }),
    })

    const out = await orch.tick()
    expect(out.kind).toBe('processed')

    const queue = await readQueue()
    const task = queue.tasks.find((candidate) => candidate.id === 'a')
    expect(task?.status).toBe('gate_check')
    expect(task?.assignedTo).toBe('gate-checker-agent')
    expect(task?.blockReason ?? null).toBeNull()
    expect(task?.notes.some((note) =>
      note.role === 'recovery' &&
      note.content.includes('availability failures incorrectly counted as hard rejection'),
    )).toBe(true)
    expect(task?.escalations[0]?.resolvedBy).toBe('system')
    expect(task?.escalations[0]?.resolution).toContain('availability failures stopped counting')
  })

  it('advances a blocked max-revisions task to gate_check when prior LLM review was all-clear', async () => {
    await writeQueue([
      mkTask({
        id: 'a',
        status: 'blocked',
        assignedTo: null,
        spec: VALID_SPEC,
        acceptanceCriteria: [
          { id: 'ac-1', description: 'done', met: true, verifiedBy: 'review' },
        ],
        blockReason: 'max_revisions_exceeded: Exceeded maxRevisions (3). Requires human judgment.',
        reviewVerdicts: [
          {
            verdict: 'revise',
            reviewerPath: 'llm',
            reason: 'LLM reviewer requested revision before parser recovery',
            reasoning: [
              '**Review:** AC-1 through AC-8: Met.',
              '',
              '**Rubric**',
              '- acceptance-criteria-met: yes',
              '- no-scope-creep: yes',
              '- conventions-followed: yes',
              '- no-regressions: yes',
            ].join('\n'),
            recordedAt: '2026-05-03T00:10:00.000Z',
            failingSignals: [],
          },
          {
            verdict: 'revise',
            reviewerPath: 'llm',
            reason: 'LLM reviewer requested revision after partial output',
            reasoning: '**Review:** AC-1: Met. AC-2: Met. AC-3: Met. AC-4: Met',
            recordedAt: '2026-05-03T00:11:00.000Z',
            failingSignals: [],
          },
        ],
      }),
    ])

    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet(),
      reviewerFanout: async () => [],
      gitDriver: new InMemoryGitDriver({ clean: true }),
    })

    const out = await orch.tick()
    expect(out.kind).toBe('processed')

    const queue = await readQueue()
    const task = queue.tasks.find((candidate) => candidate.id === 'a')
    expect(task?.status).toBe('gate_check')
    expect(task?.assignedTo).toBe('gate-checker-agent')
    expect(task?.blockReason ?? null).toBeNull()
    expect(task?.notes.some((note) =>
      note.role === 'recovery' &&
      note.content.includes('earlier all-clear LLM review'),
    )).toBe(true)
  })

  it('reopens a substantive max-revisions blocker for another worker pass when the user explicitly restarts the project', async () => {
    await writeQueue([
      mkTask({
        id: 'a',
        status: 'blocked',
        assignedTo: null,
        spec: VALID_SPEC,
        acceptanceCriteria: [
          { id: 'ac-1', description: 'done', met: true, verifiedBy: 'review' },
        ],
        revisionCount: 9,
        blockReason: 'max_revisions_exceeded: Exceeded maxRevisions (3). Reviewer fan-out keeps rejecting.',
        reviewVerdicts: [
          {
            verdict: 'approve',
            reviewerPath: 'llm',
            reason: 'The Copywriter approved',
            reasoning: 'Looks good.',
            recordedAt: '2026-05-03T00:10:00.000Z',
            failingSignals: [],
          },
          {
            verdict: 'revise',
            reviewerPath: 'llm',
            reason: 'The Security Engineer requested revision',
            reasoning: 'Validate redirect targets before navigating.',
            recordedAt: '2026-05-03T00:10:00.000Z',
            failingSignals: ['security-engineer'],
          },
          {
            verdict: 'revise',
            reviewerPath: 'llm',
            reason: 'The Frontend Engineer requested revision',
            reasoning: 'The Frontend Engineer failed to produce a verdict (Exceeded maximum turn limit (3)). Treating as revise per strict-all policy.',
            recordedAt: '2026-05-03T00:10:00.000Z',
            failingSignals: ['frontend-engineer'],
          },
        ],
        escalations: [
          {
            id: 'esc-a-1',
            taskId: 'a',
            agentId: 'reviewer-fanout',
            reason: 'max_revisions_exceeded',
            summary: 'Exceeded maxRevisions (3). Reviewer fan-out keeps rejecting.',
            details: 'Security Engineer requested redirect validation changes.',
            raisedAt: '2026-05-03T00:11:00.000Z',
          },
        ],
      }),
    ])

    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({
        worker: stubAgent('worker-agent', async () => {
          await mutateTask('a', { status: 'in_progress' })
        }),
      }),
      gitDriver: new InMemoryGitDriver({ clean: true }),
    })

    const out = await orch.tick()

    expect(out.kind).toBe('processed')
    if (out.kind === 'processed') {
      expect(out.beforeStatus).toBe('in_progress')
      expect(out.afterStatus).toBe('in_progress')
    }

    const queue = await readQueue()
    const task = queue.tasks.find((candidate) => candidate.id === 'a')
    expect(task?.status).toBe('in_progress')
    expect(task?.assignedTo).toBe('worker-agent')
    expect(task?.blockReason ?? null).toBeNull()
    expect(task?.notes.some((note) =>
      note.role === 'recovery' &&
      note.content.includes('latest substantive review feedback'),
    )).toBe(true)
    expect(task?.escalations[0]?.resolvedBy).toBe('system')
    expect(task?.escalations[0]?.resolution).toContain('explicitly resumed for another revision cycle')
  })

  it('blocks the task instead of retry-looping forever when worktree bootstrap fails', async () => {
    const subrepo = path.join(tmpDir, 'knit')
    await fs.mkdir(subrepo, { recursive: true })

    const settings = makeDefaultSettings(new Date('2026-05-03T00:00:00Z'))
    settings.project.worktree_isolation = {
      position: 'per_task',
      rationale: 'test',
      setAt: '2026-05-03T00:00:00Z',
      setBy: 'user-direct',
    }
    await saveLeverSettings({
      path: agentSettingsPath,
      settings,
    })

    await writeQueue([
      mkTask({
        id: 'a',
        status: 'in_progress',
        assignedTo: 'worker-agent',
        domain: 'knit',
        projectPath: subrepo,
        spec: VALID_SPEC,
      }),
    ])

    const gitDriver = new InMemoryGitDriver()
    const cfg = baseConfig({
      projectPath: tmpDir,
      bootstrap: {
        commands: ['cd knit && pnpm install'],
        successGates: [],
        timeoutMs: 30_000,
        verifiedAt: '2026-05-03T00:00:00Z',
      },
    })
    const orch = new Orchestrator({
      config: cfg,
      agents: agentSet(),
      gitDriver,
    })

    const out = await orch.tick()
    expect(out.kind).toBe('processed')
    if (out.kind === 'processed') {
      expect(out.beforeStatus).toBe('in_progress')
      expect(out.afterStatus).toBe('blocked')
      expect(out.transitioned).toBe(true)
    }

    const queue = await readQueue()
    const task = queue.tasks.find((candidate) => candidate.id === 'a')
    expect(task?.status).toBe('blocked')
    expect(task?.assignedTo).toBeNull()
    expect(task?.blockReason).toMatch(/task setup failed/i)
    expect(task?.notes.at(-1)?.role).toBe('bootstrap-failure')
  })

  it('checkpoints dirty worktree bootstrap verification failures before redispatching the worker', async () => {
    const subrepo = path.join(tmpDir, 'knit')
    const worktree = path.join(tmpDir, '.guildhall', 'worktrees', 'knit-task-a')
    await fs.mkdir(path.join(subrepo, 'web'), { recursive: true })
    await fs.mkdir(path.join(worktree, 'web', 'app', 'pages'), { recursive: true })
    await fs.writeFile(path.join(worktree, 'web', 'app', 'pages', 'settings.vue'), '<template />\n', 'utf-8')

    const settings = makeDefaultSettings(new Date('2026-05-03T00:00:00Z'))
    settings.project.worktree_isolation = {
      position: 'per_task',
      rationale: 'test',
      setAt: '2026-05-03T00:00:00Z',
      setBy: 'user-direct',
    }
    await saveLeverSettings({
      path: agentSettingsPath,
      settings,
    })

    await writeQueue([
      mkTask({
        id: 'a',
        status: 'in_progress',
        assignedTo: 'worker-agent',
        domain: 'knit',
        projectPath: subrepo,
        worktreePath: worktree,
        branchName: 'guildhall/task-a',
        baseBranch: 'main',
        spec: 'Implement the invite flow in `web/app/pages/settings.vue`.',
      }),
    ])

    const worker = stubAgent('worker-agent')
    const orch = new Orchestrator({
      config: baseConfig({
        projectPath: tmpDir,
        bootstrap: {
          commands: ['node -e "process.exit(0)"'],
          successGates: ['node -e "console.error(\'settings.vue type error\'); process.exit(1)"'],
          timeoutMs: 30_000,
          verifiedAt: '2026-05-03T00:00:00Z',
        },
      }),
      agents: agentSet({ worker }),
      gitDriver: new InMemoryGitDriver({ clean: false }),
    })

    const out = await orch.tick()
    expect(out.kind).toBe('processed')
    if (out.kind === 'processed') {
      expect(out.beforeStatus).toBe('in_progress')
      expect(out.afterStatus).toBe('in_progress')
      expect(out.transitioned).toBe(false)
    }

    const queue = await readQueue()
    const task = queue.tasks.find((candidate) => candidate.id === 'a')
    expect(task?.status).toBe('in_progress')
    expect(task?.blockReason ?? null).toBeNull()
    expect(task?.notes.at(-1)?.role).toBe('bootstrap-verification')

    const checkpoint = JSON.parse(
      await fs.readFile(taskHistoryPath('a', 'checkpoint.json'), 'utf8'),
    ) as {
      nextPlannedAction: string
      filesTouched: string[]
      resumeContext?: {
        verification?: Array<{ command: string; passed: boolean; summary?: string }>
        safeNextMutationSurface?: string[]
        workingHypothesis?: string
      }
    }
    expect(checkpoint.nextPlannedAction).toContain('recorded verification evidence')
    expect(checkpoint.filesTouched).toContain('web/app/pages/settings.vue')
    expect(checkpoint.resumeContext?.verification).toEqual([
      expect.objectContaining({
        command: 'node -e "console.error(\'settings.vue type error\'); process.exit(1)"',
        passed: false,
        summary: expect.stringContaining('settings.vue type error'),
      }),
    ])
    expect(checkpoint.resumeContext?.safeNextMutationSurface).toContain('web/app/pages/settings.vue')
    expect(checkpoint.resumeContext?.workingHypothesis).toContain('last authoritative verification failed')
    expect(worker.calls[0]?.prompt).toContain('Latest authoritative verification')
    expect(worker.calls[0]?.prompt).toContain('settings.vue type error')
  })

  it('hands explicit task-owned bootstrap repair failures to the worker even when the task worktree is clean', async () => {
    const subrepo = path.join(tmpDir, 'looma')
    const worktree = path.join(tmpDir, '.guildhall', 'worktrees', 'looma-alert-dialog')
    await fs.mkdir(path.join(subrepo, 'packages', 'looma', 'src'), { recursive: true })
    await fs.mkdir(path.join(worktree, 'packages', 'looma', 'src'), { recursive: true })

    const settings = makeDefaultSettings(new Date('2026-05-03T00:00:00Z'))
    settings.project.worktree_isolation = {
      position: 'per_task',
      rationale: 'test',
      setAt: '2026-05-03T00:00:00Z',
      setBy: 'user-direct',
    }
    await saveLeverSettings({
      path: agentSettingsPath,
      settings,
    })

    await writeQueue([
      mkTask({
        id: 'alert-dialog',
        title: 'AlertDialog',
        status: 'in_progress',
        assignedTo: 'worker-agent',
        domain: 'looma',
        projectPath: subrepo,
        worktreePath: worktree,
        branchName: 'guildhall/task-alert-dialog',
        baseBranch: 'main',
        spec: [
          VALID_SPEC,
          '',
          'The worker must also fix the task-local bootstrap failure before delivery.',
        ].join('\n'),
        notes: [{
          agentId: 'human',
          role: 'human',
          content:
            'Fix the task-local bootstrap failure that blocked the run: pnpm lint fails because packages/looma/src/extensions.ts cannot resolve @threadlabs/editor/extensions. Treat that as setup/implementation work inside this task branch, not as an owner decision.',
          timestamp: '2026-05-03T00:00:00.000Z',
        }],
      }),
    ])

    const worker = stubAgent('worker-agent')
    const orch = new Orchestrator({
      config: baseConfig({
        projectPath: tmpDir,
        bootstrap: {
          commands: ['node -e "process.exit(0)"'],
          successGates: ['node -e "console.error(\'Cannot find module @threadlabs/editor/extensions\'); process.exit(1)"'],
          timeoutMs: 30_000,
          verifiedAt: '2026-05-03T00:00:00Z',
        },
      }),
      agents: agentSet({ worker }),
      gitDriver: new InMemoryGitDriver({ clean: true }),
    })

    const out = await orch.tick()
    expect(out.kind).toBe('processed')
    if (out.kind === 'processed') {
      expect(out.beforeStatus).toBe('in_progress')
      expect(out.afterStatus).toBe('in_progress')
      expect(out.transitioned).toBe(false)
    }

    expect(worker.calls).toHaveLength(1)
    const queue = await readQueue()
    const task = queue.tasks.find((candidate) => candidate.id === 'alert-dialog')
    expect(task?.status).toBe('in_progress')
    expect(task?.blockReason ?? null).toBeNull()
    expect(task?.notes.at(-1)?.role).toBe('bootstrap-verification')
    expect(task?.notes.at(-1)?.content).toContain('task explicitly asks Guildhall to repair this bootstrap failure')
  })

  it('does not touch git isolation for reserved intake tasks in a non-git workspace root', async () => {
    const settings = makeDefaultSettings(new Date('2026-05-03T00:00:00Z'))
    settings.project.worktree_isolation = {
      position: 'per_task',
      rationale: 'test',
      setAt: '2026-05-03T00:00:00Z',
      setBy: 'user-direct',
    }
    await saveLeverSettings({
      path: agentSettingsPath,
      settings,
    })

    await writeQueue([
      mkTask({
        id: 'task-meta-intake',
        domain: '_meta',
        status: 'exploring',
        projectPath: tmpDir,
      }),
    ])

    class ExplodingGitDriver extends InMemoryGitDriver {
      override async isClean(): Promise<boolean> {
        throw new Error('reserved intake should not probe git cleanliness')
      }

      override async currentBranch(): Promise<string> {
        throw new Error('reserved intake should not resolve git branch')
      }

      override async createWorktree(): Promise<void> {
        throw new Error('reserved intake should not create worktrees')
      }
    }

    const spec = stubAgent('spec-agent')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ spec }),
      gitDriver: new ExplodingGitDriver(),
    })

    const out = await orch.tick()

    expect(out.kind).toBe('processed')
    expect(spec.calls).toHaveLength(1)
  })

  it('reopens a stale task-bootstrap failure when the existing task worktree bootstrap now passes', async () => {
    const subrepo = path.join(tmpDir, 'knit')
    const worktreePath = path.join(tmpDir, '.guildhall', 'worktrees', 'test-ws', 'a')
    const guildhallHome = path.join(tmpDir, '.guildhall-home')
    process.env.GUILDHALL_CONFIG_DIR = guildhallHome
    await fs.mkdir(subrepo, { recursive: true })
    await fs.mkdir(worktreePath, { recursive: true })

    const settings = makeDefaultSettings(new Date('2026-05-03T00:00:00Z'))
    settings.project.worktree_isolation = {
      position: 'per_task',
      rationale: 'test',
      setAt: '2026-05-03T00:00:00Z',
      setBy: 'user-direct',
    }
    await saveLeverSettings({
      path: agentSettingsPath,
      settings,
    })

    await fs.writeFile(
      path.join(worktreePath, 'package.json'),
      JSON.stringify({
        name: '@knit-app',
        scripts: {
          preinstall: 'node -e "process.exit(0)"',
          prepare: 'node -e "process.exit(0)"',
        },
      }),
      'utf8',
    )
    await fs.writeFile(path.join(worktreePath, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n', 'utf8')

    await writeQueue([
      mkTask({
        id: 'a',
        status: 'blocked',
        assignedTo: null,
        domain: 'knit',
        projectPath: subrepo,
        worktreePath,
        branchName: 'guildhall/task-a',
        baseBranch: 'main',
        spec: VALID_SPEC,
        blockReason:
          'Guildhall could not start work because task setup failed: ' +
          'worktree bootstrap failed on command `pnpm install` (exit 1). ' +
          'Fix the task bootstrap command or project install state, then resume the task.',
        notes: [
          {
            agentId: 'coordinator',
            role: 'bootstrap-failure',
            content: 'Blocked after repeated task setup failure.',
            timestamp: '2026-05-03T00:00:00.000Z',
          },
        ],
      }),
    ])

    const orch = new Orchestrator({
      config: baseConfig({
        projectPath: tmpDir,
        bootstrap: {
          commands: ['cd knit && pnpm install'],
          successGates: [],
          timeoutMs: 30_000,
          verifiedAt: '2026-05-03T00:00:00Z',
        },
      }),
      agents: agentSet({
        worker: stubAgent('worker-agent', async () => {
          await mutateTask('a', { status: 'in_progress' })
        }),
      }),
      gitDriver: new InMemoryGitDriver({ clean: true }),
    })

    const out = await orch.tick()

    expect(out.kind).toBe('processed')
    if (out.kind === 'processed') {
      expect(out.beforeStatus).toBe('ready')
      expect(out.afterStatus).toBe('in_progress')
    }

    const queue = await readQueue()
    const task = queue.tasks.find((candidate) => candidate.id === 'a')
    expect(task?.status).toBe('in_progress')
    expect(task?.assignedTo).toBe('worker-agent')
    expect(task?.blockReason ?? null).toBeNull()
    expect(task?.notes.some((note) =>
      note.role === 'recovery' &&
      note.content.includes('task worktree bootstrap now passes'),
    )).toBe(true)
    delete process.env.GUILDHALL_CONFIG_DIR
  })

  it('reopens a stale test-environment blocker when the repaired task worktree bootstrap now passes', async () => {
    const subrepo = path.join(tmpDir, 'knit')
    const worktreePath = path.join(tmpDir, '.guildhall', 'worktrees', 'test-ws', 'env-fix')
    const guildhallHome = path.join(tmpDir, '.guildhall-home-env-fix')
    process.env.GUILDHALL_CONFIG_DIR = guildhallHome
    await fs.mkdir(subrepo, { recursive: true })
    await fs.mkdir(worktreePath, { recursive: true })

    const settings = makeDefaultSettings(new Date('2026-05-03T00:00:00Z'))
    settings.project.worktree_isolation = {
      position: 'per_task',
      rationale: 'test',
      setAt: '2026-05-03T00:00:00Z',
      setBy: 'user-direct',
    }
    await saveLeverSettings({
      path: agentSettingsPath,
      settings,
    })

    await fs.writeFile(
      path.join(worktreePath, 'package.json'),
      JSON.stringify({
        name: '@knit-app',
        scripts: {
          preinstall: 'node -e "process.exit(0)"',
          prepare: 'node -e "process.exit(0)"',
        },
      }),
      'utf8',
    )
    await fs.writeFile(path.join(worktreePath, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n', 'utf8')

    await writeQueue([
      mkTask({
        id: 'env-fix',
        status: 'blocked',
        assignedTo: null,
        domain: 'knit',
        projectPath: subrepo,
        worktreePath,
        branchName: 'guildhall/task-env-fix',
        baseBranch: 'main',
        spec: VALID_SPEC,
        blockReason: 'Test environment setup failed due to unresolved @nuxt/test-utils module',
        notes: [
          {
            agentId: 'worker-agent',
            role: 'progress',
            content: 'Hit unresolved @nuxt/test-utils while trying to run focused verification.',
            timestamp: '2026-05-03T00:00:00.000Z',
          },
        ],
        escalations: [
          {
            id: 'esc-env-fix',
            taskId: 'env-fix',
            agentId: 'worker-agent',
            raisedAt: '2026-05-03T00:00:00.000Z',
            reason: 'gate_hard_failure',
            summary: 'Test environment setup failed',
            details:
              'Cannot find module /tmp/knit/node_modules/.pnpm/@nuxt+test-utils/node_modules/@nuxt/test-utils/dist/runtime/entry.mjs',
          },
        ],
      }),
    ])

    const orch = new Orchestrator({
      config: baseConfig({
        projectPath: tmpDir,
        bootstrap: {
          commands: ['cd knit && pnpm install'],
          successGates: [],
          timeoutMs: 30_000,
          verifiedAt: '2026-05-03T00:00:00Z',
        },
      }),
      agents: agentSet({
        worker: stubAgent('worker-agent', async () => {
          await mutateTask('env-fix', { status: 'in_progress' })
        }),
      }),
      gitDriver: new InMemoryGitDriver({ clean: true }),
    })

    const out = await orch.tick()

    expect(out.kind).toBe('processed')
    const queue = await readQueue()
    const task = queue.tasks.find((candidate) => candidate.id === 'env-fix')
    expect(task?.status).toBe('in_progress')
    expect(task?.assignedTo).toBe('worker-agent')
    expect(task?.blockReason ?? null).toBeNull()
    expect(task?.escalations?.[0]?.resolvedAt).toBeTruthy()
    expect(task?.notes.some((note) =>
      note.role === 'recovery' &&
      note.content.includes('task-local test environment failure'),
    )).toBe(true)
    delete process.env.GUILDHALL_CONFIG_DIR
  })

  it('does not touch git isolation for spec-intake shaping work', async () => {
    const subrepo = path.join(tmpDir, 'knit')
    await fs.mkdir(subrepo, { recursive: true })

    const settings = makeDefaultSettings(new Date('2026-05-03T00:00:00Z'))
    settings.project.worktree_isolation = {
      position: 'per_task',
      rationale: 'test',
      setAt: '2026-05-03T00:00:00Z',
      setBy: 'user-direct',
    }
    await saveLeverSettings({
      path: agentSettingsPath,
      settings,
    })

    await writeQueue([
      mkTask({
        id: 'task-import-shape',
        domain: 'knit',
        status: 'exploring',
        projectPath: subrepo,
        notes: [
          {
            agentId: 'workspace-importer',
            role: 'importer',
            content: 'Imported from: knit/docs/feature-roadmap.md',
            timestamp: new Date().toISOString(),
          },
        ],
      }),
    ])

    class ExplodingGitDriver extends InMemoryGitDriver {
      override async isClean(): Promise<boolean> {
        throw new Error('spec shaping should not probe git cleanliness')
      }

      override async currentBranch(): Promise<string> {
        throw new Error('spec shaping should not resolve git branch')
      }

      override async createWorktree(): Promise<void> {
        throw new Error('spec shaping should not create worktrees')
      }
    }

    const spec = stubAgent('spec-agent')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ spec }),
      gitDriver: new ExplodingGitDriver(),
    })

    const out = await orch.tick()

    expect(out.kind).toBe('processed')
    expect(spec.calls).toHaveLength(1)
  })

  it('stopAfterOneTask stops after one active task reaches terminal status', async () => {
    await writeQueue([
      mkTask({ id: 'a', status: 'in_progress', domain: 'looma' }),
      mkTask({ id: 'b', status: 'ready', domain: 'looma', spec: VALID_SPEC }),
    ])

    let writeChain = Promise.resolve()
    const mutateCurrentTask = (next: TaskStatus) => async (prompt: string) => {
      const match = prompt.match(/\*\*Current task ID \(for task tools\):\*\* ([^\n]+)/)
      const taskId = match?.[1]
      if (!taskId) throw new Error('missing current task id in prompt')
      const run = writeChain.then(() => mutateTask(taskId, { status: next }))
      writeChain = run.catch(() => {})
      await run
    }

    const agents: OrchestratorAgentSet = {
      spec: stubAgent('spec-agent'),
      worker: stubAgent('worker-agent', mutateCurrentTask('review')),
      reviewer: stubAgent('reviewer-agent', mutateCurrentTask('gate_check')),
      gateChecker: stubAgent('gate-checker-agent', mutateCurrentTask('done')),
      coordinators: {},
    }

    const orch = new Orchestrator({ config: baseConfig(), agents })
    await orch.run({ maxTicks: 20, tickDelayMs: 0, stopAfterOneTask: true })

    const q = await readQueue()
    expect(q.tasks.find((t) => t.id === 'a')?.status).toBe('done')
    expect(q.tasks.find((t) => t.id === 'b')?.status).toBe('ready')
  })

  it('scoped one-task runs finish selected parent child work before stopping', async () => {
    await writeQueue([
      mkTask({
        id: 'context-menu',
        title: 'ContextMenu',
        status: 'ready',
        domain: 'looma',
        hierarchy: { childIds: ['context-menu-component', 'context-menu-story'], order: 0 },
      }),
      mkTask({
        id: 'context-menu-component',
        title: 'Component implementation',
        status: 'ready',
        domain: 'looma',
        hierarchy: { parentId: 'context-menu', childIds: [], order: 0 },
      }),
      mkTask({
        id: 'context-menu-story',
        title: 'Storybook story',
        status: 'ready',
        domain: 'looma',
        hierarchy: { parentId: 'context-menu', childIds: [], order: 1 },
      }),
      mkTask({ id: 'unrelated', status: 'ready', domain: 'looma', priority: 'critical' }),
    ])

    const picked: string[] = []
    const worker = stubAgent('worker-agent', async (prompt: string) => {
      const taskId = prompt.match(/\*\*Current task ID \(for task tools\):\*\* ([^\n]+)/)?.[1]
      if (!taskId) throw new Error('missing current task id in prompt')
      picked.push(taskId)
      await mutateTask(taskId, { status: 'done' })
    })

    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
    })
    const result = await orch.run({
      maxTicks: 20,
      tickDelayMs: 0,
      stopAfterOneTask: true,
      preferredTaskId: 'context-menu',
    })

    expect(result.stopReason).toBe('one_task')
    expect(result.stopMessage).toContain('context-menu')
    expect(picked).toEqual(['context-menu-component', 'context-menu-story'])
    const q = await readManagedQueue()
    expect(q.tasks.find((t) => t.id === 'context-menu')?.status).toBe('done')
    expect(q.tasks.find((t) => t.id === 'context-menu-component')?.status).toBe('done')
    expect(q.tasks.find((t) => t.id === 'context-menu-story')?.status).toBe('done')
    expect(q.tasks.find((t) => t.id === 'unrelated')?.status).toBe('ready')
  })

  it('scoped one-task runs continue when selected child reaches spec review', async () => {
    await writeQueue([
      mkTask({
        id: 'context-menu',
        title: 'ContextMenu',
        status: 'ready',
        domain: 'looma',
        hierarchy: { childIds: ['context-menu-component'], order: 0 },
      }),
      mkTask({
        id: 'context-menu-component',
        title: 'Component implementation',
        status: 'exploring',
        domain: 'looma',
        hierarchy: { parentId: 'context-menu', childIds: [], order: 0 },
      }),
      mkTask({ id: 'unrelated', status: 'ready', domain: 'looma', priority: 'critical' }),
    ])

    const picked: string[] = []
    const currentTaskId = (prompt: string) => {
      const taskId = prompt.match(/\*\*Current task ID \(for task tools\):\*\* ([^\n]+)/)?.[1]
      if (!taskId) throw new Error('missing current task id in prompt')
      picked.push(taskId)
      return taskId
    }
    const spec = stubAgent('spec-agent', async (prompt: string) => {
      const taskId = currentTaskId(prompt)
      await mutateTask(taskId, { status: 'spec_review', spec: VALID_SPEC })
    })
    const coord = stubAgent('looma-coordinator', async (prompt: string) => {
      const taskId = currentTaskId(prompt)
      await mutateTask(taskId, { status: 'ready' })
    })
    const worker = stubAgent('worker-agent', async (prompt: string) => {
      const taskId = currentTaskId(prompt)
      await mutateTask(taskId, { status: 'done' })
    })

    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ spec, worker, coordinators: { looma: coord } }),
    })
    const result = await orch.run({
      maxTicks: 20,
      tickDelayMs: 0,
      stopAfterOneTask: true,
      preferredTaskId: 'context-menu',
    })

    expect(result.stopReason).toBe('one_task')
    expect(picked).toEqual(['context-menu-component', 'context-menu-component'])
    const q = await readManagedQueue()
    expect(q.tasks.find((t) => t.id === 'context-menu')?.status).toBe('done')
    expect(q.tasks.find((t) => t.id === 'context-menu-component')?.status).toBe('done')
    expect(q.tasks.find((t) => t.id === 'unrelated')?.status).toBe('ready')
  })

  it('scoped one-task runs keep dirty selected work resumable when the worker hits its turn limit', async () => {
    const worktreePath = path.join(tmpDir, '.guildhall', 'worktrees', 'task-selected')
    await fs.mkdir(worktreePath, { recursive: true })
    await writeManagedQueue([
      mkTask({
        id: 'selected',
        title: 'Selected work',
        status: 'in_progress',
        domain: 'looma',
        assignedTo: 'worker-agent',
      }),
      mkTask({ id: 'unrelated', status: 'ready', domain: 'looma', priority: 'critical' }),
    ])
    await upsertTaskWorkspaceState(tmpDir, 'selected', {
      worktreePath,
      branchName: 'guildhall/task-selected',
      baseBranch: 'main',
      mode: 'per_task',
      updatedAt: '2026-04-01T00:00:00Z',
    })

    class DirtyWorktreeGitDriver extends InMemoryGitDriver {
      override async isClean(repoRoot: string): Promise<boolean> {
        if (repoRoot === worktreePath) return false
        return true
      }
    }
    const worker = stubAgent('worker-agent', async () => {
      throw new Error('Exceeded maximum turn limit (24)')
    })
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
      gitDriver: new DirtyWorktreeGitDriver(),
    })

    const result = await orch.run({
      maxTicks: 5,
      tickDelayMs: 0,
      stopAfterOneTask: true,
      preferredTaskId: 'selected',
    })

    expect(result.stopReason).toBe('max_ticks')
    const q = await readManagedQueue()
    expect(q.tasks.find((t) => t.id === 'selected')?.status).toBe('in_progress')
    expect(q.tasks.find((t) => t.id === 'selected')?.escalations).toHaveLength(0)
    expect(q.tasks.find((t) => t.id === 'unrelated')?.status).toBe('ready')
  })

  it('scoped one-task runs stop when selected parent child work is blocked', async () => {
    await writeQueue([
      mkTask({
        id: 'context-menu',
        title: 'ContextMenu',
        status: 'ready',
        domain: 'looma',
        hierarchy: { childIds: ['context-menu-component', 'context-menu-story'], order: 0 },
      }),
      mkTask({
        id: 'context-menu-component',
        title: 'Component implementation',
        status: 'done',
        domain: 'looma',
        hierarchy: { parentId: 'context-menu', childIds: [], order: 0 },
      }),
      mkTask({
        id: 'context-menu-story',
        title: 'Storybook story',
        status: 'blocked',
        domain: 'looma',
        hierarchy: { parentId: 'context-menu', childIds: [], order: 1 },
        blockReason: 'Provider backoff stopped shaping.',
      }),
      mkTask({ id: 'unrelated', status: 'ready', domain: 'looma', priority: 'critical' }),
    ])

    const worker = stubAgent('worker-agent')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
    })
    const result = await orch.run({
      maxTicks: 20,
      tickDelayMs: 0,
      stopAfterOneTask: true,
      preferredTaskId: 'context-menu',
    })

    expect(result.stopReason).toBe('dependency_blocked')
    expect(result.stopMessage).toContain('context-menu-story is blocked')
    expect(worker.calls).toHaveLength(0)
    const q = await readQueue()
    expect(q.tasks.find((t) => t.id === 'context-menu')?.status).toBe('ready')
    expect(q.tasks.find((t) => t.id === 'unrelated')?.status).toBe('ready')
  })

  it('auto-commits dirty task worktree changes when Git Story policy says commit auto', async () => {
    const worktreePath = path.join(tmpDir, '.guildhall', 'worktrees', 'test-ws', 'task-auto')
    await writeQueue([
      mkTask({
        id: 'task-auto',
        title: 'Implement feature workflow',
        status: 'gate_check',
        worktreePath,
        branchName: 'guildhall/task-auto',
        baseBranch: 'main',
      }),
    ])

    const gitDriver = new InMemoryGitDriver({ clean: true })
    gitDriver.setStatusSummary(worktreePath, {
      branch: 'guildhall/task-auto',
      upstream: undefined,
      changedCount: 2,
      untrackedCount: 0,
      samplePaths: ['src/feature.ts', 'src/feature.test.ts'],
      clean: false,
    })
    const gateChecker = stubAgent('gate-checker-agent', async () => {
      await mutateTask('task-auto', { status: 'done' })
    })

    const orch = new Orchestrator({
      config: baseConfig({
        gitStory: {
          completionTarget: 'open_pr',
          commit: 'auto',
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
      }),
      agents: agentSet({ gateChecker }),
      gitDriver,
    })

    const out = await orch.tick()

    expect(out.kind).toBe('processed')
    expect(gitDriver.state.commits).toEqual([
      expect.objectContaining({
        repoRoot: worktreePath,
        message: [
          'Implement feature workflow',
          '',
          'Task: task-auto',
          'Changes: 2 changed',
          'Paths:',
          '- src/feature.ts',
          '- src/feature.test.ts',
        ].join('\n'),
      }),
    ])
    const q = await readQueue()
    expect(q.tasks[0]?.notes.some((note) =>
      note.role === 'git-story' &&
      note.content.includes('Auto-committed completed task work'),
    )).toBe(true)
  })

  it('recovers stale auto-commit landing failures instead of leaving proven work blocked', async () => {
    const worktreePath = path.join(tmpDir, '.guildhall', 'worktrees', 'test-ws', 'task-auto')
    await writeQueue([
      mkTask({
        id: 'task-auto',
        title: 'Implement feature workflow',
        status: 'blocked',
        blockReason: 'Guildhall could not auto-commit completed work: stale index.lock.',
        worktreePath,
        branchName: 'guildhall/task-auto',
        baseBranch: 'main',
        mergeRecord: {
          fromBranch: 'guildhall/task-auto',
          toBranch: 'main',
          strategy: 'cherry_pick_local',
          result: 'skipped',
          mergedAt: '2026-07-04T00:00:00.000Z',
          detail: 'auto-commit failed before landing',
        },
      }),
    ])

    const gitDriver = new InMemoryGitDriver({ clean: true })
    gitDriver.setStatusSummary(worktreePath, {
      branch: 'guildhall/task-auto',
      changedCount: 1,
      untrackedCount: 0,
      samplePaths: ['src/feature.ts'],
      clean: false,
    })
    const orch = new Orchestrator({
      config: baseConfig({
        gitStory: {
          completionTarget: 'open_pr',
          commit: 'auto',
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
      }),
      agents: agentSet({}),
      gitDriver,
    })

    await orch.tick()

    expect(gitDriver.state.commits).toHaveLength(1)
    expect(gitDriver.state.cherryPicks).toEqual([
      expect.objectContaining({
        branch: 'guildhall/task-auto',
        baseBranch: 'main',
      }),
    ])
    const q = await readQueue()
    expect(q.tasks[0]?.status).toBe('done')
    expect(q.tasks[0]?.blockReason).toBeUndefined()
    expect(q.tasks[0]?.mergeRecord).toMatchObject({
      result: 'merged',
      strategy: 'cherry_pick_local',
    })
  })

  it('auto-commits dirty task worktree changes from matching workspace child Git Story policy', async () => {
    const loomaPath = path.join(tmpDir, 'looma')
    const worktreePath = path.join(tmpDir, '.guildhall', 'worktrees', 'test-ws', 'task-child-auto')
    await writeQueue([
      mkTask({
        id: 'task-child-auto',
        title: 'Implement child feature workflow',
        status: 'gate_check',
        domain: 'looma',
        projectPath: loomaPath,
        worktreePath,
        branchName: 'guildhall/task-child-auto',
        baseBranch: 'main',
      }),
    ])

    const gitDriver = new InMemoryGitDriver({ clean: true })
    gitDriver.setStatusSummary(worktreePath, {
      branch: 'guildhall/task-child-auto',
      upstream: undefined,
      changedCount: 1,
      untrackedCount: 0,
      samplePaths: ['src/child-feature.ts'],
      clean: false,
    })
    const gateChecker = stubAgent('gate-checker-agent', async () => {
      await mutateTask('task-child-auto', { status: 'done' })
    })

    const orch = new Orchestrator({
      config: baseConfig({
        kind: 'workspace',
        gitStory: {
          completionTarget: 'open_pr',
          commit: 'ask',
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
        projects: [
          {
            id: 'looma',
            path: loomaPath,
            gitStory: {
              completionTarget: 'open_pr',
              commit: 'auto',
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
      }),
      agents: agentSet({ gateChecker }),
      gitDriver,
    })

    const out = await orch.tick()

    expect(out.kind).toBe('processed')
    expect(gitDriver.state.commits).toEqual([
      expect.objectContaining({
        repoRoot: worktreePath,
      }),
    ])
  })

  it('commits dirty isolated task worktree changes before landing even when Git Story policy is ask', async () => {
    const worktreePath = path.join(tmpDir, '.guildhall', 'worktrees', 'test-ws', 'task-ask')
    await writeQueue([
      mkTask({
        id: 'task-ask',
        status: 'gate_check',
        worktreePath,
        branchName: 'guildhall/task-ask',
        baseBranch: 'main',
      }),
    ])

    const gitDriver = new InMemoryGitDriver({ clean: true })
    gitDriver.setStatusSummary(worktreePath, {
      branch: 'guildhall/task-ask',
      changedCount: 1,
      untrackedCount: 0,
      samplePaths: ['src/feature.ts'],
      clean: false,
    })
    const gateChecker = stubAgent('gate-checker-agent', async () => {
      await mutateTask('task-ask', { status: 'done' })
    })

    const orch = new Orchestrator({
      config: baseConfig({
        gitStory: {
          completionTarget: 'open_pr',
          commit: 'ask',
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
      }),
      agents: agentSet({ gateChecker }),
      gitDriver,
    })

    await orch.tick()

    expect(gitDriver.state.commits).toEqual([
      expect.objectContaining({
        repoRoot: worktreePath,
      }),
    ])
    expect(gitDriver.state.cherryPicks).toEqual([
      expect.objectContaining({
        branch: 'guildhall/task-ask',
        baseBranch: 'main',
      }),
    ])
    expect(gitDriver.state.removedWorktrees).toEqual([worktreePath])
  })

  it('reconciles already-done isolated worktrees that were marked done before landing', async () => {
    const worktreePath = path.join(tmpDir, '.guildhall', 'worktrees', 'test-ws', 'task-orphaned-done')
    await writeQueue([
      mkTask({
        id: 'task-orphaned-done',
        status: 'done',
        worktreePath,
        branchName: 'guildhall/task-orphaned-done',
        baseBranch: 'main',
      }),
    ])

    const gitDriver = new InMemoryGitDriver({ clean: true })
    gitDriver.setStatusSummary(worktreePath, {
      branch: 'guildhall/task-orphaned-done',
      changedCount: 2,
      untrackedCount: 1,
      samplePaths: ['src/feature.ts', 'src/feature.test.ts', 'src/new.ts'],
      clean: false,
    })

    const orch = new Orchestrator({
      config: baseConfig({
        gitStory: {
          completionTarget: 'open_pr',
          commit: 'ask',
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
      }),
      agents: agentSet(),
      gitDriver,
    })

    const out = await orch.tick()

    expect(out.kind).toBe('idle')
    expect(gitDriver.state.commits).toEqual([
      expect.objectContaining({
        repoRoot: worktreePath,
      }),
    ])
    expect(gitDriver.state.cherryPicks).toEqual([
      expect.objectContaining({
        branch: 'guildhall/task-orphaned-done',
        baseBranch: 'main',
      }),
    ])
    expect(gitDriver.state.removedWorktrees).toEqual([worktreePath])
    const q = await readQueue()
    expect(q.tasks[0]?.mergeRecord).toMatchObject({
      result: 'merged',
      fromBranch: 'guildhall/task-orphaned-done',
      toBranch: 'main',
    })
  })

  it('marks pending PR tasks done and removes the worktree once the PR is merged', async () => {
    const worktreePath = path.join(tmpDir, '.guildhall', 'worktrees', 'test-ws', 'task-pr')
    await writeQueue([
      mkTask({
        id: 'task-pr',
        status: 'pending_pr',
        worktreePath,
        branchName: 'guildhall/task-pr',
        baseBranch: 'main',
        mergeRecord: {
          fromBranch: 'guildhall/task-pr',
          toBranch: 'main',
          strategy: 'manual_pr',
          result: 'pending_pr',
          prUrl: 'https://github.test/org/repo/pull/12',
          mergedAt: '2026-05-01T00:00:00.000Z',
        },
      }),
    ])

    const gitDriver = new InMemoryGitDriver({ clean: true })
    gitDriver.setPullRequest(tmpDir, {
      ok: true,
      url: 'https://github.test/org/repo/pull/12',
      state: 'MERGED',
      mergeStateStatus: 'UNKNOWN',
    })

    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet(),
      gitDriver,
    })

    const out = await orch.tick()

    expect(out.kind).toBe('idle')
    expect(gitDriver.state.removedWorktrees).toEqual([worktreePath])
    const q = await readQueue()
    expect(q.tasks[0]?.status).toBe('done')
    expect(q.tasks[0]?.mergeRecord).toMatchObject({
      result: 'merged',
      fromBranch: 'guildhall/task-pr',
      toBranch: 'main',
      prUrl: 'https://github.test/org/repo/pull/12',
    })
  })

  it('stopAfterOneTask stops immediately when exploring work is waiting on the user', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'exploring', domain: 'knit' })])

    const agents: OrchestratorAgentSet = {
      spec: stubAgent(
        'spec-agent',
        undefined,
        'Pick one: should I spec only the happy path, or the full failure matrix?',
      ),
      worker: stubAgent('worker-agent'),
      reviewer: stubAgent('reviewer-agent'),
      gateChecker: stubAgent('gate-checker-agent'),
      coordinators: {},
    }

    const orch = new Orchestrator({ config: baseConfig(), agents })
    await orch.run({ maxTicks: 20, tickDelayMs: 0, stopAfterOneTask: true })

    expect(agents.spec.calls).toHaveLength(1)
    const q = await readQueue()
    const task = q.tasks.find((t) => t.id === 'a')!
    expect(task.status).toBe('exploring')
    expect(task.openQuestions).toHaveLength(1)
    expect(task.openQuestions?.[0]?.answeredAt).toBeUndefined()
  })

  it('adds immediate resume instructions for in-progress worker tasks with likely target files', async () => {
    const worker = stubAgent('worker-agent')
    await fs.mkdir(path.join(tmpDir, 'web', 'tests', 'unit', 'composables'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'web', 'package.json'),
      JSON.stringify({
        name: '@knit-app',
        scripts: {
          test: 'vitest',
        },
      }),
      'utf8',
    )
    await fs.writeFile(
      path.join(tmpDir, 'web', 'tests', 'unit', 'composables', 'use-presence.test.ts'),
      '// placeholder\n',
      'utf8',
    )
    await writeQueue([
      mkTask({
        id: 'task-resume',
        status: 'in_progress',
        worktreePath: path.join(tmpDir, '.guildhall', 'worktrees', 'task-resume'),
        title: 'Add unit coverage for use-presence lifecycle',
        description: 'Resume the usePresence unit test work.',
        spec: 'Edit `web/app/composables/use-presence.ts` and verify `tests/unit/composables/use-presence.test.ts`.',
        acceptanceCriteria: [
          {
            id: 'ac-1',
            description: 'use-presence tests pass',
            verifiedBy: 'automated',
            command: 'pnpm --filter @knit-app test -- tests/unit/composables/use-presence.test.ts',
            met: false,
          } as any,
        ],
      }),
    ])

    const gitDriver = new InMemoryGitDriver()
    gitDriver.setClean(true)
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
      gitDriver,
    })

    await orch.tick()

    const prompt = worker.calls[0]?.prompt ?? ''
    expect(prompt).toContain('### Immediate Resume Instructions')
    expect(prompt).toContain('## Authoritative verification commands')
    expect(prompt).toContain('Use these commands as the authoritative verification commands for this task:')
    expect(prompt).toContain('cd web && pnpm vitest --run tests/unit/composables/use-presence.test.ts')
    expect(prompt).toContain('Open or edit these files before any directory listing or broad globbing:')
    expect(prompt).toContain(path.join(tmpDir, '.guildhall', 'worktrees', 'task-resume', 'web', 'app', 'composables', 'use-presence.ts'))
    expect(prompt).toContain(path.join(tmpDir, '.guildhall', 'worktrees', 'task-resume', 'web', 'tests', 'unit', 'composables', 'use-presence.test.ts'))
    expect(prompt).toContain('If one of these likely target files does not exist yet, first verify that its parent directory matches the existing project structure.')
    expect(prompt).toContain('Do not use list-files, glob, or generic repo-root shell inspection')
  })

  it('stops early when all tasks are terminal (done/blocked)', async () => {
    await writeQueue([
      mkTask({ id: 'a', status: 'done' }),
      mkTask({ id: 'b', status: 'blocked' }),
    ])
    let completed = false
    const start = Date.now()
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    await orch.run({ maxTicks: 50, tickDelayMs: 0 })
    completed = true
    // Must complete on the first idle tick via the allDone short-circuit,
    // not by exhausting maxTicks.
    expect(completed).toBe(true)
    expect(Date.now() - start).toBeLessThan(500)
  })

  it('FR-28 / AC-19: honors an external memory/stop-requested marker between ticks', async () => {
    // An always-active task keeps the loop running — the marker is what
    // should cut it short, not task exhaustion.
    await writeQueue([mkTask({ id: 'a', status: 'in_progress', domain: 'looma' })])

    let ticks = 0
    const markerPath = path.join(getProjectLocalHistoryDir(tmpDir), 'stop-requested')
    const stopSignal = { stopRequested: false }

    const agents: OrchestratorAgentSet = {
      spec: stubAgent('spec-agent', async () => {}),
      worker: {
        name: 'worker-agent',
        calls: [] as { prompt: string }[],
        async generate() {
          ticks++
          if (ticks === 2) {
            // Simulate an external operator writing the marker — no SIGINT
            // delivery, no dashboard stop button.
            await fs.writeFile(markerPath, '{"requestedBy":"external"}', 'utf-8')
          }
          return { text: 'ok' }
        },
      } as unknown as OrchestratorAgentSet['worker'],
      reviewer: stubAgent('reviewer-agent', async () => {}),
      gateChecker: stubAgent('gate-checker-agent', async () => {}),
      coordinators: {
        looma: stubAgent('looma-coordinator', async () => {}),
      },
    }

    const orch = new Orchestrator({ config: baseConfig(), agents, stopSignal })
    await orch.run({ maxTicks: 20, tickDelayMs: 0 })

    expect(stopSignal.stopRequested).toBe(true)
    // Should have exited within a couple of ticks of the marker appearing,
    // not run to the maxTicks=20 ceiling.
    expect(ticks).toBeLessThan(10)
  })

  it('processes three unblocked tasks in one unattended run', async () => {
    await writeQueue([
      mkTask({ id: 'a', status: 'ready', spec: VALID_SPEC, domain: 'looma' }),
      mkTask({ id: 'b', status: 'ready', spec: VALID_SPEC, domain: 'looma' }),
      mkTask({ id: 'c', status: 'ready', spec: VALID_SPEC, domain: 'looma' }),
    ])

    const mutateCurrentTask = (next: TaskStatus) => async (prompt: string) => {
      const match = prompt.match(/\*\*Current task ID \(for task tools\):\*\* ([^\n]+)/)
      const taskId = match?.[1]
      if (!taskId) throw new Error('missing current task id in prompt')
      await mutateTask(taskId, { status: next })
    }

    const orch = new Orchestrator({
      config: baseConfig(),
      agents: {
        spec: stubAgent('spec-agent'),
        worker: stubAgent('worker-agent', mutateCurrentTask('review')),
        reviewer: stubAgent('reviewer-agent', mutateCurrentTask('gate_check')),
        gateChecker: stubAgent('gate-checker-agent', mutateCurrentTask('done')),
        coordinators: {},
      },
    })

    const result = await orch.run({ maxTicks: 20, tickDelayMs: 0 })

    const q = await readQueue()
    expect(q.tasks.map((task) => task.status)).toEqual(['done', 'done', 'done'])
    expect(result.stopReason).toBe('all_terminal')
    expect(result.idleSummary?.counts.done).toBe(3)
  })

  it('closes a materialized split parent when all linked child tasks are complete', async () => {
    await writeQueue([
      mkTask({
        id: 'parent',
        status: 'ready',
        taskReadiness: {
          taskKind: 'decision',
          recommendation: 'ready',
          summary: 'Split work has been turned into linked child tasks; continue through the child tasks instead of splitting this parent again.',
          dimensions: [],
          definitionOfDone: {
            items: ['All linked child tasks are closed.'],
            evidenceRequired: ['Child outcomes are recorded.'],
            updatedAt: '2026-06-17T00:00:00.000Z',
            createdBy: 'task-sizing',
          },
          blockerPlans: [],
          contextBudget: {
            estimatedTokens: 0,
            risk: 'low',
            fitsInOneWorkerBrief: true,
            reasons: ['This work is already represented by linked tasks.'],
          },
          assessedAt: '2026-06-17T00:00:00.000Z',
          assessedBy: 'task-sizing',
        },
        hierarchy: {
          order: 0,
          childIds: ['child-a', 'child-b', 'child-c'],
        },
      }),
      mkTask({ id: 'child-a', status: 'done', hierarchy: { parentId: 'parent', childIds: [], order: 0 } }),
      mkTask({ id: 'child-b', status: 'done', hierarchy: { parentId: 'parent', childIds: [], order: 1 } }),
      mkTask({ id: 'child-c', status: 'done', hierarchy: { parentId: 'parent', childIds: [], order: 2 } }),
    ])

    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    const result = await orch.run({ maxTicks: 5, tickDelayMs: 0 })

    const q = await readQueue()
    expect(q.tasks.find(task => task.id === 'parent')?.status).toBe('done')
    expect(q.tasks.find(task => task.id === 'parent')?.notes.at(-1)?.content).toContain('Closed containing work after linked child tasks completed')
    expect(result.stopReason).toBe('all_terminal')
    expect(result.idleSummary?.counts.done).toBe(4)
  })

  it('stops with explicit blocked accounting when unattended work runs into a human question', async () => {
    const settings: LeverSettings = makeDefaultSettings(new Date('2026-05-02T00:00:00Z'))
    settings.project.worktree_isolation = {
      position: 'per_task',
      rationale: 'Fanout queue accounting should still use a valid isolated runtime configuration.',
      setAt: '2026-05-02T00:00:00Z',
      setBy: 'user-direct',
    }
    settings.project.concurrent_task_dispatch = {
      position: { kind: 'fanout', n: 2 },
      rationale: 'test fanout',
      setAt: '2026-05-02T00:00:00Z',
      setBy: 'user-direct',
    }
    await saveLeverSettings({
      path: agentSettingsPath,
      settings,
    })
    updateProjectConfig(tmpDir, {
      workerLaneConcurrency: 2,
    })
    execFileSync('git', ['add', '-A'], { cwd: tmpDir, stdio: 'ignore' })
    execFileSync('git', ['commit', '--no-verify', '-m', 'test config'], {
      cwd: tmpDir,
      stdio: 'ignore',
    })
    await writeQueue([
      mkTask({ id: 'done-ish', status: 'ready', spec: VALID_SPEC, domain: 'looma' }),
      mkTask({
        id: 'question',
        status: 'exploring',
        domain: 'looma',
      }),
    ])
    await seedTaskOwnerInput({
      taskId: 'question',
      prompt: 'Which environment should I target?',
    })

    const mutateCurrentTask = (next: TaskStatus) => async (prompt: string) => {
      const match = prompt.match(/\*\*Current task ID \(for task tools\):\*\* ([^\n]+)/)
      const taskId = match?.[1]
      if (!taskId) throw new Error('missing current task id in prompt')
      await mutateTask(taskId, { status: next })
    }

    const orch = new Orchestrator({
      config: baseConfig(),
      agents: {
        spec: stubAgent('spec-agent'),
        worker: stubAgent('worker-agent', mutateCurrentTask('review')),
        reviewer: stubAgent('reviewer-agent', mutateCurrentTask('gate_check')),
        gateChecker: stubAgent('gate-checker-agent', mutateCurrentTask('done')),
        coordinators: {},
      },
      idleShutdownAfterTicks: 0,
    })

    const result = await orch.run({ maxTicks: 20, tickDelayMs: 0 })

    const q = await readQueue()
    expect(q.tasks.find((task) => task.id === 'done-ish')?.status).toBe('done')
    expect(q.tasks.find((task) => task.id === 'question')?.status).toBe('exploring')
    expect(result.stopReason).toBe('awaiting_human')
    expect(result.idleSummary?.counts.done).toBe(1)
    expect(result.idleSummary?.counts.waitingOnUser).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// FR-10: structured escalation events
// ---------------------------------------------------------------------------

describe('Orchestrator.tick — FR-10 escalations', () => {
  it('surfaces an `escalated` outcome when an agent raises an escalation', async () => {
    await writeQueue([mkTask({ status: 'in_progress' })])
    const worker = stubAgent('worker-agent', async () => {
      // Simulate the worker calling raise-escalation: appends to escalations
      // and flips status to blocked.
      await mutateTask('task-001', {
        status: 'blocked',
        blockReason: 'decision_required: need choice',
        escalations: [
          {
            id: 'esc-task-001-1',
            taskId: 'task-001',
            agentId: 'worker-agent',
            reason: 'decision_required',
            summary: 'need choice',
            raisedAt: '2026-04-01T00:00:01Z',
          },
        ],
      })
    })
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
    })
    const outcome = await orch.tick()
    expect(outcome.kind).toBe('escalated')
    if (outcome.kind === 'escalated') {
      expect(outcome.taskId).toBe('task-001')
      expect(outcome.agent).toBe('worker-agent')
      expect(outcome.reason).toBe('decision_required')
      expect(outcome.escalationId).toBe('esc-task-001-1')
    }
  })

  it('keeps self-authored verification repair escalations in the worker lane', async () => {
    const worktreePath = path.join(tmpDir, '.guildhall', 'worktrees', 'invite-flow')
    await fs.mkdir(path.join(worktreePath, 'web', 'app', 'pages'), { recursive: true })
    await writeQueue([
      mkTask({
        id: 'task-invite',
        title: 'Proper invite flow',
        status: 'in_progress',
        assignedTo: 'worker-agent',
        projectPath: tmpDir,
        worktreePath,
        spec: [
          'Implement the Supabase invite flow in Knit settings.',
          '- web/app/pages/settings.vue should expose the invite form and send handler.',
          '- web/server/api/workspaces/[id]/invite.post.ts should validate roles and send the invite.',
        ].join('\n'),
        acceptanceCriteria: [{
          id: 'ac-1',
          description: 'typecheck passes',
          verifiedBy: 'automated',
          command: 'cd web && pnpm typecheck',
          met: false,
        } as any],
      }),
    ])
    await writeCheckpoint({
      tasksPath,
      memoryDir,
      taskId: 'task-invite',
      agentId: 'worker-agent',
      intent: 'Repair failed verification',
      nextPlannedAction:
        'Resume from the recorded verification evidence, rerun the focused verification commands, and fix whatever still fails.',
      filesTouched: [
        'web/app/pages/settings.vue',
        'web/server/api/workspaces/[id]/invite.post.ts',
      ],
      resumeContext: {
        verification: [{
          command: 'cd web && pnpm typecheck',
          passed: false,
          observedAt: '2026-05-16T00:00:00.000Z',
          summary:
            'settings.vue cannot find sendInvite; invite.post.ts cannot find sendToast or Role',
        }],
        safeNextMutationSurface: [
          'web/app/pages/settings.vue',
          'web/server/api/workspaces/[id]/invite.post.ts',
        ],
      },
    })
    const worker = {
      ...stubAgent('worker-agent', async () => {
        await mutateTask('task-invite', {
          status: 'blocked',
          assignedTo: null,
          blockReason:
            'spec_ambiguous: Unable to resolve type errors in settings.vue and invite.post.ts due to missing imports and utilities.',
          escalations: [
            {
              id: 'esc-task-invite-1',
              taskId: 'task-invite',
              agentId: 'worker-agent',
              reason: 'spec_ambiguous',
              summary:
                'Unable to resolve type errors in settings.vue and invite.post.ts due to missing imports and utilities.',
              details:
                "The files web/app/pages/settings.vue and web/server/api/workspaces/[id]/invite.post.ts contain references to 'sendInvite', 'sendToast' and 'Role' that cannot be resolved after the worker implementation.",
              raisedAt: '2026-04-01T00:00:01Z',
            },
          ],
        })
      }),
      loadToolMetadata() {
        return {}
      },
    }
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
      gitDriver: new InMemoryGitDriver({ clean: false }),
    })

    const outcome = await orch.tick()
    expect(outcome.kind).toBe('processed')
    if (outcome.kind === 'processed') {
      expect(outcome.afterStatus).toBe('in_progress')
      expect(outcome.agent).toBe('worker-agent')
    }
    const queue = await readQueue()
    const task = queue.tasks.find((candidate) => candidate.id === 'task-invite')
    expect(task?.status).toBe('in_progress')
    expect(task?.assignedTo).toBe('worker-agent')
    expect(task?.blockReason ?? null).toBeNull()
    expect(task?.escalations[0]?.resolvedBy).toBe('orchestrator')
    expect(task?.escalations[0]?.resolution).toContain('self-authored verification failure')
    const policyNote = task?.notes.find((note) => note.role === 'policy-classification')
    expect(policyNote).toBeTruthy()
    expect(JSON.parse(policyNote?.content ?? '{}')).toMatchObject({
      class: 'self_authored_verification_failure',
      safePlaybooks: ['repair_touched_file_failure', 'rerun_authoritative_command'],
    })
    const playbookNote = task?.notes.find((note) => note.role === 'recovery-playbook')
    expect(playbookNote).toBeTruthy()
    expect(JSON.parse(playbookNote?.content ?? '{}')).toMatchObject({
      status: 'started',
      playbook: 'repair_touched_file_failure',
      command: 'cd web && pnpm typecheck',
      maxTurns: 2,
      allowedPaths: [
        'web/app/pages/settings.vue',
        'web/server/api/workspaces/[id]/invite.post.ts',
      ],
    })
    expect(task?.notes.at(-1)?.content).toContain('repair the failed verification')
  })

  it('keeps worker-owned verification environment claims out of the human queue', async () => {
    const worktreePath = path.join(tmpDir, '.guildhall', 'worktrees', 'listing-form')
    await fs.mkdir(path.join(worktreePath, 'frontend', 'app', 'pages', 'listings'), { recursive: true })
    execFileSync('git', ['init', '-b', 'main'], { cwd: worktreePath, stdio: 'ignore' })
    execFileSync('git', ['config', 'user.name', 'Guildhall Test'], {
      cwd: worktreePath,
      stdio: 'ignore',
    })
    execFileSync('git', ['config', 'user.email', 'guildhall-tests@example.com'], {
      cwd: worktreePath,
      stdio: 'ignore',
    })
    await fs.writeFile(path.join(worktreePath, '.gitignore'), 'node_modules/\n', 'utf-8')
    execFileSync('git', ['add', '.gitignore'], { cwd: worktreePath, stdio: 'ignore' })
    execFileSync('git', ['commit', '--no-verify', '-m', 'init'], {
      cwd: worktreePath,
      stdio: 'ignore',
    })
    await fs.writeFile(
      path.join(worktreePath, 'frontend', 'app', 'pages', 'listings', 'new.vue'),
      '<template><form>listing</form></template>\n',
      'utf-8',
    )
    await writeQueue([
      mkTask({
        id: 'task-listing',
        title: 'Basic project listing',
        status: 'blocked',
        assignedTo: null,
        blockReason:
          "spec_ambiguous: Verification commands don't work in this environment but implementation is complete",
        projectPath: 'frontend/',
        worktreePath,
        acceptanceCriteria: [{
          id: 'ac-1',
          description: 'build passes',
          verifiedBy: 'automated',
          command: 'pnpm build',
          met: false,
        } as any],
        escalations: [
          {
            id: 'esc-task-listing-1',
            taskId: 'task-listing',
            agentId: 'worker-agent',
            reason: 'spec_ambiguous',
            summary:
              "Verification commands don't work in this environment but implementation is complete",
            details:
              'The implementation is complete at frontend/app/pages/listings/new.vue, but the verification commands cannot run because the package setup appears unavailable.',
            raisedAt: '2026-04-01T00:00:01Z',
          },
        ],
      }),
    ])
    const worker = {
      ...stubAgent('worker-agent'),
      loadToolMetadata() {
        return {}
      },
    }
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
      gitDriver: new InMemoryGitDriver({ clean: false }),
    })

    const outcome = await orch.tick()

    expect(outcome.kind).toBe('processed')
    const queue = await readQueue()
    const task = queue.tasks.find((candidate) => candidate.id === 'task-listing')
    expect(task?.status).toBe('in_progress')
    expect(task?.assignedTo).toBe('worker-agent')
    expect(task?.blockReason ?? null).toBeNull()
    expect(task?.escalations[0]?.resolvedBy, JSON.stringify(task, null, 2)).toBe('system')
    expect(task?.escalations[0]?.resolution).toContain('kept the task in automation')
    expect(task?.notes.some((note) =>
      note.role === 'recovery' &&
      note.content.includes('keep the decision in automation'),
    )).toBe(true)
  })

  it('skips tasks with open escalations even if status is not blocked', async () => {
    // Defense-in-depth: even if status somehow gets unblocked while an
    // escalation remains open, pickNextTask must still halt the task.
    await writeQueue([
      mkTask({
        id: 'a',
        status: 'in_progress',
        escalations: [
          {
            id: 'esc-a-1',
            taskId: 'a',
            agentId: 'x',
            reason: 'decision_required',
            summary: 's',
            raisedAt: '2026-04-01T00:00:00Z',
          },
        ],
      }),
      mkTask({ id: 'b', status: 'in_progress' }),
    ])
    const picked = pickNextTask(await readQueue())
    expect(picked?.id).toBe('b')
  })

  it('resumes routing once the escalation is resolved', async () => {
    const raisedAt = '2026-04-01T00:00:00Z'
    await writeQueue([
      mkTask({
        status: 'blocked',
        escalations: [
          {
            id: 'esc-task-001-1',
            taskId: 'task-001',
            agentId: 'worker-agent',
            reason: 'decision_required',
            summary: 's',
            raisedAt,
          },
        ],
      }),
    ])
    // Simulate human resolving the escalation (flip status back + mark resolved)
    await mutateTask('task-001', {
      status: 'in_progress',
      escalations: [
        {
          id: 'esc-task-001-1',
          taskId: 'task-001',
          agentId: 'worker-agent',
          reason: 'decision_required',
          summary: 's',
          raisedAt,
          resolvedAt: '2026-04-01T01:00:00Z',
          resolvedBy: 'human',
          resolution: 'pick A',
        },
      ],
    })
    const picked = pickNextTask(await readQueue())
    expect(picked?.id).toBe('task-001')
  })

  it('resumes routing once later task progress supersedes an older unresolved escalation', async () => {
    await writeQueue([
      mkTask({
        id: 'a',
        status: 'gate_check',
        updatedAt: '2026-05-03T19:10:00.000Z',
        escalations: [
          {
            id: 'esc-a-1',
            taskId: 'a',
            agentId: 'gate-checker-agent',
            reason: 'gate_hard_failure',
            summary: 'old gate failure',
            raisedAt: '2026-05-03T19:00:00.000Z',
          },
        ],
      }),
    ])
    const picked = pickNextTask(await readQueue())
    expect(picked?.id).toBe('a')
  })

  it('routes max-revisions block through the structured escalation protocol', async () => {
    // Task is on its final allowed revision; one more review→in_progress bump
    // should trigger an auto-escalation.
    await writeQueue([
      mkTask({ status: 'review', revisionCount: 3 }),
    ])
    const reviewer = stubAgent('reviewer-agent', async () => {
      await mutateTask('task-001', { status: 'in_progress' })
    })
    const orch = new Orchestrator({
      config: baseConfig({ maxRevisions: 3 }),
      agents: agentSet({ reviewer }),
    })
    const outcome = await orch.tick()
    expect(outcome.kind).toBe('blocked-max-revisions')

    const q = await readQueue()
    const task = q.tasks[0]!
    expect(task.status).toBe('blocked')
    expect(task.escalations).toHaveLength(1)
    expect(task.escalations[0]!.reason).toBe('max_revisions_exceeded')
    expect(task.escalations[0]!.agentId).toBe('reviewer-agent')
    expect(task.escalations[0]!.summary).toContain('maxRevisions')
  })

  it('writes an escalation progress entry when max-revisions fires', async () => {
    await writeQueue([mkTask({ status: 'review', revisionCount: 3 })])
    const reviewer = stubAgent('reviewer-agent', async () => {
      await mutateTask('task-001', { status: 'in_progress' })
    })
    const orch = new Orchestrator({
      config: baseConfig({ maxRevisions: 3 }),
      agents: agentSet({ reviewer }),
    })
    await orch.tick()
    const progress = await fs.readFile(progressPath, 'utf-8')
    expect(progress).toContain('ESCALATION')
    expect(progress).toContain('max_revisions_exceeded')
  })

  it('does not double-log when an agent raises a fresh escalation', async () => {
    // When an agent raises an escalation itself, raise-escalation already
    // writes the progress entry. The orchestrator must NOT also write a
    // heartbeat for the same tick.
    await writeQueue([mkTask({ status: 'in_progress' })])
    const worker = stubAgent('worker-agent', async () => {
      // Simulate the agent calling raise-escalation, which writes a line
      // directly to PROGRESS.md and mutates the task.
      await fs.appendFile(
        progressPath,
        '\n### 🆘 ESCALATION — 2026-04-01T00:00:00Z\nsynthetic direct entry\n---\n',
        'utf-8',
      )
      await mutateTask('task-001', {
        status: 'blocked',
        escalations: [
          {
            id: 'esc-task-001-1',
            taskId: 'task-001',
            agentId: 'worker-agent',
            reason: 'human_judgment_required',
            summary: 's',
            raisedAt: '2026-04-01T00:00:00Z',
          },
        ],
      })
    })
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
    })
    await orch.tick()
    const progress = await fs.readFile(progressPath, 'utf-8')
    const escalationCount = (progress.match(/ESCALATION/g) ?? []).length
    // Exactly one entry (from the tool, not the orchestrator)
    expect(escalationCount).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// FR-15 per-task permission modes: the orchestrator calls setPermissionMode on
// the dispatched agent before generate(), using the task's `permissionMode`
// field if set, or FULL_AUTO (which the agent clamps to its baseline) if not.
// ---------------------------------------------------------------------------
import { PermissionMode } from '@guildhall/engine'

interface ModeAwareStubAgent extends StubAgent {
  modeCalls: PermissionMode[]
  setPermissionMode(mode: PermissionMode): PermissionMode
}

function modeAwareStubAgent(
  name: string,
  sideEffect?: (prompt: string) => Promise<void> | void,
): ModeAwareStubAgent {
  const calls: { prompt: string }[] = []
  const modeCalls: PermissionMode[] = []
  let current = PermissionMode.FULL_AUTO
  return {
    name,
    calls,
    modeCalls,
    setPermissionMode(mode: PermissionMode) {
      modeCalls.push(mode)
      current = mode
      return current
    },
    async generate(prompt: string) {
      calls.push({ prompt })
      if (sideEffect) await sideEffect(prompt)
      return { text: 'ok' }
    },
  }
}

describe('Orchestrator.tick — FR-15 per-task permission modes', () => {
  it('applies task.permissionMode to the dispatched agent before generate()', async () => {
    await writeQueue([
      mkTask({ id: 'a', status: 'in_progress', permissionMode: 'plan' }),
    ])
    const worker = modeAwareStubAgent('worker-agent')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
    })
    await orch.tick()
    expect(worker.modeCalls).toEqual([PermissionMode.PLAN])
  })

  it('asks for FULL_AUTO when the task has no permissionMode override', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'in_progress' })])
    const worker = modeAwareStubAgent('worker-agent')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
    })
    await orch.tick()
    expect(worker.modeCalls).toEqual([PermissionMode.FULL_AUTO])
  })

  it('re-applies mode on every tick so narrowed state does not stick', async () => {
    await writeQueue([
      mkTask({ id: 'a', status: 'in_progress', permissionMode: 'plan' }),
    ])
    const worker = modeAwareStubAgent('worker-agent', async () => {
      // Simulate the worker mutating status forward; then change the on-disk
      // task so the next tick has no permissionMode.
      await mutateTask('a', { status: 'review', permissionMode: undefined })
    })
    const reviewer = modeAwareStubAgent('reviewer-agent')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker, reviewer }),
    })
    await orch.tick() // dispatches to worker with PLAN
    await orch.tick() // dispatches to reviewer (no override) → FULL_AUTO
    expect(worker.modeCalls).toEqual([PermissionMode.PLAN])
    expect(reviewer.modeCalls).toEqual([PermissionMode.FULL_AUTO])
  })

  it('supports default mode as an intermediate narrowing', async () => {
    await writeQueue([
      mkTask({ id: 'a', status: 'in_progress', permissionMode: 'default' }),
    ])
    const worker = modeAwareStubAgent('worker-agent')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
    })
    await orch.tick()
    expect(worker.modeCalls).toEqual([PermissionMode.DEFAULT])
  })

  it('silently skips permission-mode wiring for agents without setPermissionMode', async () => {
    await writeQueue([
      mkTask({ id: 'a', status: 'in_progress', permissionMode: 'plan' }),
    ])
    const worker = stubAgent('worker-agent')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
    })
    // Must not throw even though the stub has no setPermissionMode.
    const out = await orch.tick()
    expect(out.kind).toBe('processed')
  })
})

// ---------------------------------------------------------------------------
// FR-18 hook lifecycle — SESSION_START / SESSION_END
// ---------------------------------------------------------------------------
describe('Orchestrator.run — FR-18 session hooks', () => {
  interface RecordingHookExecutor {
    calls: { event: string; payload: Record<string, unknown> }[]
    execute(event: string, payload: Record<string, unknown>): Promise<{ blocked: boolean; reason?: string }>
  }

  function recordingExecutor(
    blockOn?: string,
    reason = 'blocked by test',
  ): RecordingHookExecutor {
    const calls: RecordingHookExecutor['calls'] = []
    return {
      calls,
      async execute(event, payload) {
        calls.push({ event, payload })
        if (blockOn && event === blockOn) return { blocked: true, reason }
        return { blocked: false }
      },
    }
  }

  it('fires SESSION_START before the first tick and SESSION_END after the loop exits', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'done' })])
    const hookExecutor = recordingExecutor()
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      hookExecutor: hookExecutor as any,
    })
    await orch.run({ maxTicks: 1, tickDelayMs: 0 })
    const events = hookExecutor.calls.map((c) => c.event)
    expect(events[0]).toBe('session_start')
    expect(events[events.length - 1]).toBe('session_end')
  })

  it('aborts run() before any tick when SESSION_START blocks', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'exploring' })])
    const spec = stubAgent('spec-agent')
    const hookExecutor = recordingExecutor('session_start')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ spec }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      hookExecutor: hookExecutor as any,
    })
    await orch.run({ maxTicks: 3, tickDelayMs: 0 })
    expect(spec.calls).toHaveLength(0)
    // Only SESSION_START fired — no SESSION_END since we aborted
    const events = hookExecutor.calls.map((c) => c.event)
    expect(events).toEqual(['session_start'])
  })

  it('still fires SESSION_END when SESSION_START does not block', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'done' })])
    const hookExecutor = recordingExecutor()
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      hookExecutor: hookExecutor as any,
    })
    await orch.run({ maxTicks: 1, tickDelayMs: 0 })
    expect(hookExecutor.calls.some((c) => c.event === 'session_end')).toBe(true)
  })

  it('SESSION_END payload includes the tick count', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'done' })])
    const hookExecutor = recordingExecutor()
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      hookExecutor: hookExecutor as any,
    })
    await orch.run({ maxTicks: 2, tickDelayMs: 0 })
    const end = hookExecutor.calls.find((c) => c.event === 'session_end')
    expect(end).toBeDefined()
    expect(end!.payload['ticks']).toBeGreaterThan(0)
    expect(end!.payload['workspaceId']).toBe('test-ws')
  })
})

// ---------------------------------------------------------------------------
// FR-21 proposal promotion — the orchestrator consults the `task_origination`
// lever for the task's domain and applies the resulting status transition
// without calling an LLM agent.
// ---------------------------------------------------------------------------

describe('Orchestrator.tick — FR-21 proposal promotion', () => {
  async function writeLevers(
    origination: DomainLevers['task_origination']['position'],
  ): Promise<void> {
    const settings: LeverSettings = makeDefaultSettings(new Date('2026-04-20T00:00:00Z'))
    settings.domains.default.task_origination = {
      position: origination,
      rationale: 'test override',
      setAt: '2026-04-20T00:00:00Z',
      setBy: 'user-direct',
    }
    await saveLeverSettings({
      path: agentSettingsPath,
      settings,
    })
  }

  function proposal(overrides: Partial<Task> = {}): Task {
    return mkTask({
      id: 'prop-1',
      status: 'proposed',
      origination: 'agent',
      proposedBy: 'worker:looma:session-7',
      proposalRationale: 'noticed missing coverage on parseUrl',
      ...overrides,
    })
  }

  it('auto-promotes a proposal to ready when task_origination=agent_autonomous', async () => {
    await writeLevers('agent_autonomous')
    await writeQueue([proposal()])
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    const out = await orch.tick()
    expect(out.kind).toBe('proposal-decided')
    if (out.kind === 'proposal-decided') {
      expect(out.actionKind).toBe('auto_promote')
      expect(out.newStatus).toBe('ready')
      expect(out.leverPosition).toBe('agent_autonomous')
    }
    const q = await readQueue()
    expect(q.tasks[0]!.status).toBe('ready')
  })

  it('routes a proposal to spec_review when task_origination=agent_proposed_human_approved', async () => {
    await writeLevers('agent_proposed_human_approved')
    await writeQueue([proposal()])
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    const out = await orch.tick()
    expect(out.kind).toBe('proposal-decided')
    if (out.kind === 'proposal-decided') {
      expect(out.actionKind).toBe('route_to_human')
      expect(out.newStatus).toBe('spec_review')
    }
    const q = await readQueue()
    expect(q.tasks[0]!.status).toBe('spec_review')
  })

  it('routes a proposal to spec_review when task_origination=agent_proposed_coordinator_approved', async () => {
    await writeLevers('agent_proposed_coordinator_approved')
    await writeQueue([proposal()])
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    const out = await orch.tick()
    expect(out.kind).toBe('proposal-decided')
    if (out.kind === 'proposal-decided') {
      expect(out.actionKind).toBe('route_to_coordinator')
      expect(out.newStatus).toBe('spec_review')
    }
  })

  it('shelves a proposal when task_origination=human_only', async () => {
    await writeLevers('human_only')
    await writeQueue([proposal()])
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    const out = await orch.tick()
    expect(out.kind).toBe('proposal-decided')
    if (out.kind === 'proposal-decided') {
      expect(out.actionKind).toBe('reject')
      expect(out.newStatus).toBe('shelved')
      expect(out.leverPosition).toBe('human_only')
    }
    const q = await readQueue()
    const t = q.tasks[0]!
    expect(t.status).toBe('shelved')
    expect(t.shelveReason?.code).toBe('not_viable')
    expect(t.shelveReason?.detail).toMatch(/human_only/)
    expect(t.shelveReason?.rejectedBy).toBe('system:proposal-promoter')
    expect(t.completedAt).toBeDefined()
  })

  it('seeds default lever settings when agent-settings.yaml is missing and routes proposal accordingly', async () => {
    // Default task_origination is `agent_proposed_coordinator_approved`.
    // Remove the seeded test settings so the orchestrator exercises first-read
    // materialization against true missing-file state.
    await fs.rm(agentSettingsPath, { force: true })
    await writeQueue([proposal()])
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    const out = await orch.tick()
    expect(out.kind).toBe('proposal-decided')
    if (out.kind === 'proposal-decided') {
      expect(out.actionKind).toBe('route_to_coordinator')
    }
    // Defaults file was materialized for future ticks.
    const seeded = await fs.readFile(
      agentSettingsPath,
      'utf-8',
    )
    expect(seeded).toContain('task_origination')
  })

  it('honors per-domain overrides when resolving the lever', async () => {
    const settings = makeDefaultSettings(new Date('2026-04-20T00:00:00Z'))
    settings.domains.default.task_origination = {
      position: 'human_only',
      rationale: 'default is human_only',
      setAt: '2026-04-20T00:00:00Z',
      setBy: 'user-direct',
    }
    settings.domains.overrides = {
      looma: {
        task_origination: {
          position: 'agent_autonomous',
          rationale: 'looma is an agentic domain',
          setAt: '2026-04-20T00:00:00Z',
          setBy: 'user-direct',
        },
      },
    }
    await saveLeverSettings({
      path: agentSettingsPath,
      settings,
    })
    await writeQueue([proposal({ domain: 'looma' })])
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    const out = await orch.tick()
    expect(out.kind).toBe('proposal-decided')
    if (out.kind === 'proposal-decided') {
      expect(out.actionKind).toBe('auto_promote')
      expect(out.newStatus).toBe('ready')
    }
  })

  it('does not invoke any agent when handling a proposal', async () => {
    await writeLevers('agent_autonomous')
    await writeQueue([proposal()])
    const spec = stubAgent('spec-agent')
    const worker = stubAgent('worker-agent')
    const coord = stubAgent('looma-coordinator')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ spec, worker, coordinators: { looma: coord } }),
    })
    await orch.tick()
    expect(spec.calls).toHaveLength(0)
    expect(worker.calls).toHaveLength(0)
    expect(coord.calls).toHaveLength(0)
  })

  it('logs a heartbeat progress entry summarizing the promotion decision', async () => {
    await writeLevers('agent_autonomous')
    await writeQueue([proposal()])
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet(),
      now: () => '2026-04-20T12:00:00Z',
    })
    await orch.tick()
    const progress = await fs.readFile(getProjectProgressHeartbeatsPath(tmpDir), 'utf-8')
    expect(progress).toContain('HEARTBEAT')
    expect(progress).toContain('proposal-promoter')
    expect(progress).toContain('auto_promote')
    expect(progress).toContain('agent_autonomous')
    expect(progress).toContain('prop-1')
  })

  it('picks proposals before exploration when both are on the board', async () => {
    await writeLevers('agent_autonomous')
    await writeQueue([
      mkTask({ id: 'explore-1', status: 'exploring' }),
      proposal({ id: 'prop-1' }),
    ])
    const spec = stubAgent('spec-agent')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ spec }),
    })
    const out = await orch.tick()
    expect(out.kind).toBe('proposal-decided')
    if (out.kind === 'proposal-decided') expect(out.taskId).toBe('prop-1')
    expect(spec.calls).toHaveLength(0)
  })

  it('treats shelved tasks as terminal in the idle allDone check', async () => {
    await writeQueue([
      mkTask({ id: 'a', status: 'done' }),
      mkTask({
        id: 'b',
        status: 'shelved',
        shelveReason: {
          code: 'not_viable',
          detail: 'x',
          rejectedBy: 'w',
          rejectedAt: '2026-04-20T00:00:00Z',
          source: 'worker_pre_rejection',
          policyApplied: true,
          requeueCount: 0,
        },
      }),
    ])
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    const out = await orch.tick()
    expect(out.kind).toBe('idle')
    if (out.kind === 'idle') expect(out.allDone).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// FR-22 pre-rejection policy — the orchestrator consults pre_rejection_policy
// (domain) and rejection_dampening (project) for freshly worker-shelved tasks
// and either keeps them shelved or resurrects them to ready at lowered
// priority. Applied without any LLM invocation.
// ---------------------------------------------------------------------------

describe('Orchestrator.tick — FR-22 pre-rejection policy', () => {
  async function writeLeverPair(
    domainPos: DomainLevers['pre_rejection_policy']['position'],
    dampPos: LeverSettings['project']['rejection_dampening']['position'] = { kind: 'off' },
  ): Promise<void> {
    const settings: LeverSettings = makeDefaultSettings(new Date('2026-04-20T00:00:00Z'))
    settings.domains.default.pre_rejection_policy = {
      position: domainPos,
      rationale: 'test',
      setAt: '2026-04-20T00:00:00Z',
      setBy: 'user-direct',
    }
    settings.project.rejection_dampening = {
      position: dampPos,
      rationale: 'test',
      setAt: '2026-04-20T00:00:00Z',
      setBy: 'user-direct',
    }
    await saveLeverSettings({
      path: agentSettingsPath,
      settings,
    })
  }

  function shelved(overrides: Partial<Task> = {}): Task {
    return mkTask({
      id: 'shelve-1',
      status: 'shelved',
      priority: 'normal',
      shelveReason: {
        code: 'not_viable',
        detail: 'no external API',
        rejectedBy: 'worker:looma:session-3',
        rejectedAt: '2026-04-20T00:00:00Z',
        source: 'worker_pre_rejection',
        policyApplied: false,
        requeueCount: 0,
      },
      completedAt: '2026-04-20T00:00:00Z',
      ...overrides,
    })
  }

  it('keeps the task shelved when pre_rejection_policy=terminal_shelved', async () => {
    await writeLeverPair('terminal_shelved')
    await writeQueue([shelved()])
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    const out = await orch.tick()
    expect(out.kind).toBe('pre-rejection-applied')
    if (out.kind === 'pre-rejection-applied') {
      expect(out.actionKind).toBe('keep_shelved')
      expect(out.newStatus).toBe('shelved')
      expect(out.requeueCount).toBe(1)
    }
    const q = await readQueue()
    const t = q.tasks[0]!
    expect(t.status).toBe('shelved')
    expect(t.shelveReason?.policyApplied).toBe(true)
    expect(t.shelveReason?.requeueCount).toBe(1)
  })

  it('requeues with priority stepped down when requeue_lower_priority is set', async () => {
    await writeLeverPair('requeue_lower_priority')
    await writeQueue([shelved({ priority: 'high' })])
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    const out = await orch.tick()
    expect(out.kind).toBe('pre-rejection-applied')
    if (out.kind === 'pre-rejection-applied') {
      expect(out.actionKind).toBe('requeue')
      expect(out.newStatus).toBe('ready')
    }
    const q = await readQueue()
    const t = q.tasks[0]!
    expect(t.status).toBe('ready')
    expect(t.priority).toBe('normal')
    expect(t.shelveReason?.policyApplied).toBe(true)
    expect(t.shelveReason?.requeueCount).toBe(1)
    // Task is no longer terminal — completedAt cleared.
    expect(t.completedAt).toBeUndefined()
  })

  it('suppresses the task once hard_suppress threshold is reached', async () => {
    await writeLeverPair('requeue_with_dampening', { kind: 'hard_suppress', after: 2 })
    // currentRequeueCount=1 → nextCount=2 → at threshold → suppressed.
    await writeQueue([
      shelved({
        shelveReason: {
          code: 'not_viable',
          detail: 'x',
          rejectedBy: 'w',
          rejectedAt: '2026-04-20T00:00:00Z',
          source: 'worker_pre_rejection',
          policyApplied: false,
          requeueCount: 1,
        },
      }),
    ])
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    const out = await orch.tick()
    expect(out.kind).toBe('pre-rejection-applied')
    if (out.kind === 'pre-rejection-applied') {
      expect(out.actionKind).toBe('keep_shelved')
      expect(out.requeueCount).toBe(2)
    }
    const q = await readQueue()
    expect(q.tasks[0]!.status).toBe('shelved')
    expect(q.tasks[0]!.shelveReason?.policyApplied).toBe(true)
  })

  it('floors priority to low when soft_penalty threshold is crossed', async () => {
    await writeLeverPair('requeue_with_dampening', { kind: 'soft_penalty', after: 3 })
    await writeQueue([
      shelved({
        priority: 'high',
        shelveReason: {
          code: 'not_viable',
          detail: 'x',
          rejectedBy: 'w',
          rejectedAt: '2026-04-20T00:00:00Z',
          source: 'worker_pre_rejection',
          policyApplied: false,
          requeueCount: 2,
        },
      }),
    ])
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    await orch.tick()
    const q = await readQueue()
    const t = q.tasks[0]!
    expect(t.status).toBe('ready')
    expect(t.priority).toBe('low')
    expect(t.shelveReason?.requeueCount).toBe(3)
  })

  it('skips tasks whose policyApplied is already true', async () => {
    await writeLeverPair('terminal_shelved')
    await writeQueue([
      shelved({
        shelveReason: {
          code: 'not_viable',
          detail: 'x',
          rejectedBy: 'w',
          rejectedAt: '2026-04-20T00:00:00Z',
          source: 'worker_pre_rejection',
          policyApplied: true,
          requeueCount: 1,
        },
      }),
    ])
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    const out = await orch.tick()
    // Already-processed shelved tasks should be idle.
    expect(out.kind).toBe('idle')
  })

  it('ignores shelves created by proposal_policy', async () => {
    // A proposal-policy rejection should never be re-processed as a worker
    // pre-rejection — its source is tagged to prevent that.
    await writeLeverPair('requeue_lower_priority')
    await writeQueue([
      shelved({
        shelveReason: {
          code: 'not_viable',
          detail: 'human_only lever',
          rejectedBy: 'system:proposal-promoter',
          rejectedAt: '2026-04-20T00:00:00Z',
          source: 'proposal_policy',
          policyApplied: true,
          requeueCount: 0,
        },
      }),
    ])
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    const out = await orch.tick()
    expect(out.kind).toBe('idle')
  })

  it('ignores terminal duplicate shelves that have no pre-rejection policy metadata', async () => {
    await writeLeverPair('requeue_lower_priority')
    await writeQueue([
      shelved({
        shelveReason: {
          code: 'duplicate',
          detail: 'Duplicate of task-006',
          rejectedBy: 'system:import-draft-dedupe',
          rejectedAt: '2026-04-20T00:00:00Z',
        },
      }),
    ])
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    const out = await orch.tick()
    expect(out.kind).toBe('idle')
  })

  it('invokes no agent when applying pre-rejection policy', async () => {
    await writeLeverPair('requeue_lower_priority')
    await writeQueue([shelved()])
    const worker = stubAgent('worker-agent')
    const reviewer = stubAgent('reviewer-agent')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker, reviewer }),
    })
    await orch.tick()
    expect(worker.calls).toHaveLength(0)
    expect(reviewer.calls).toHaveLength(0)
  })

  it('logs a heartbeat progress entry summarizing the decision', async () => {
    await writeLeverPair('requeue_lower_priority')
    await writeQueue([shelved()])
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet(),
      now: () => '2026-04-20T12:00:00Z',
    })
    await orch.tick()
    const progress = await fs.readFile(getProjectProgressHeartbeatsPath(tmpDir), 'utf-8')
    expect(progress).toContain('HEARTBEAT')
    expect(progress).toContain('pre-rejection-policy')
    expect(progress).toContain('requeue_lower_priority')
    expect(progress).toContain('shelve-1')
  })

  it('services pre-rejections before proposals when both are pending', async () => {
    await writeLeverPair('requeue_lower_priority')
    await writeQueue([
      mkTask({
        id: 'prop-1',
        status: 'proposed',
        origination: 'agent',
        proposedBy: 'a',
        proposalRationale: 'r',
      }),
      shelved({ id: 'shelve-1' }),
    ])
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    const out = await orch.tick()
    expect(out.kind).toBe('pre-rejection-applied')
    if (out.kind === 'pre-rejection-applied') expect(out.taskId).toBe('shelve-1')
  })

  it('allows resurrected tasks to be picked by the worker on the next tick', async () => {
    await writeLeverPair('requeue_lower_priority')
    await writeQueue([shelved()])
    const worker = stubAgent('worker-agent')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
    })
    const first = await orch.tick()
    expect(first.kind).toBe('pre-rejection-applied')
    // After resurrection the task is `ready` but no coordinator is wired for
    // its domain — the picker should still surface it because `ready` is
    // actionable. With no coordinator the next tick reports no-coordinator
    // rather than processing, but critically pickNextTask MUST not return
    // undefined (otherwise we'd be idle).
    const second = await orch.tick()
    expect(second.kind).not.toBe('idle')
  })

  it('surfaces an agent-error outcome if lever settings are corrupt during proposal handling', async () => {
    // Mirrors the FR-21 corrupt-settings test, but exercises the pre-rejection
    // path — a malformed agent-settings.yaml should produce an agent-error
    // rather than silently falling through to idle.
    await fs.writeFile(
      agentSettingsPath,
      'not: [valid: yaml',
      'utf-8',
    )
    await writeQueue([
      mkTask({
        id: 'prop-corrupt',
        status: 'proposed',
        origination: 'agent',
        proposedBy: 'a',
        proposalRationale: 'r',
      }),
    ])
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    const out = await orch.tick()
    expect(out.kind).toBe('agent-error')
    if (out.kind === 'agent-error') {
      expect(out.error).toMatch(/lever settings/)
    }
  })
})

// ---------------------------------------------------------------------------
// FR-31: structured agent-issue channel
//
// Issues are raised via the `report_issue` tool by the running agent. The
// orchestrator's `drainPendingIssues()` returns them on demand and flips the
// `broadcast` flag so they are only emitted once. Unlike escalations, issues
// do NOT change task status — the task keeps running through its lifecycle.
// ---------------------------------------------------------------------------
describe('Orchestrator — FR-31 agent-issue channel', () => {
  it('drainPendingIssues returns all unbroadcast issues and flips the flag', async () => {
    await writeQueue([
      mkTask({
        id: 't-1',
        status: 'in_progress',
        agentIssues: [
          {
            id: 'iss-t-1-1',
            taskId: 't-1',
            agentId: 'worker-agent',
            code: 'stuck',
            severity: 'warn',
            detail: 'No progress after three attempts',
            raisedAt: '2026-04-20T00:00:00Z',
            broadcast: false,
          },
          {
            id: 'iss-t-1-2',
            taskId: 't-1',
            agentId: 'worker-agent',
            code: 'tool_unavailable',
            severity: 'critical',
            detail: 'ripgrep not found',
            raisedAt: '2026-04-20T00:00:01Z',
            broadcast: false,
          },
        ],
      }),
    ])
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })

    const first = await orch.drainPendingIssues()
    expect(first.map((i) => i.id)).toEqual(['iss-t-1-1', 'iss-t-1-2'])

    // Second drain: the flag should now be set on disk, so nothing new.
    const second = await orch.drainPendingIssues()
    expect(second).toEqual([])

    const q = await readManagedQueue()
    expect(q.tasks[0]!.agentIssues.every((i) => i.broadcast === false)).toBe(true)
    const evidence = await readTaskEvidence(tmpDir, 't-1', { kind: 'agent_issue' })
    const latestById = new Map(evidence.map((event) => [
      (event.payload as { id: string }).id,
      event.payload as { broadcast?: boolean },
    ]))
    expect(latestById.get('iss-t-1-1')?.broadcast).toBe(true)
    expect(latestById.get('iss-t-1-2')?.broadcast).toBe(true)
  })

  it('drains evidence-backed issues without writing them back to TASKS.json', async () => {
    await writeQueue([
      mkTask({
        id: 't-1',
        status: 'in_progress',
        agentIssues: [],
      }),
    ])
    await appendTaskEvidence(tmpDir, 't-1', {
      id: 'iss-t-1-1',
      kind: 'agent_issue',
      recordedAt: '2026-04-20T00:00:00Z',
      payload: {
        id: 'iss-t-1-1',
        taskId: 't-1',
        agentId: 'worker-agent',
        code: 'stuck',
        severity: 'warn',
        detail: 'No progress after three attempts',
        raisedAt: '2026-04-20T00:00:00Z',
        broadcast: false,
      },
    })
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })

    const first = await orch.drainPendingIssues()
    expect(first.map((i) => i.id)).toEqual(['iss-t-1-1'])
    expect(await orch.drainPendingIssues()).toEqual([])

    const q = await readManagedQueue()
    expect(q.tasks[0]!.agentIssues).toEqual([])
    const evidence = await readTaskEvidence(tmpDir, 't-1', { kind: 'agent_issue' })
    expect(evidence.map((event) => (event.payload as { broadcast?: boolean }).broadcast)).toEqual([false, true])
  })

  it('does not drain resolved issues even if broadcast=false', async () => {
    // An issue marked resolvedAt should not be re-broadcast. This guards
    // against the coordinator resolving an issue before it was ever seen
    // by subscribers — the resolution is authoritative.
    await writeQueue([
      mkTask({
        id: 't-1',
        status: 'in_progress',
        agentIssues: [
          {
            id: 'iss-t-1-1',
            taskId: 't-1',
            agentId: 'worker-agent',
            code: 'stuck',
            severity: 'warn',
            detail: 'x',
            raisedAt: '2026-04-20T00:00:00Z',
            broadcast: false,
            resolvedAt: '2026-04-20T00:05:00Z',
            resolution: 'coordinator decided: wait',
            resolvedBy: 'coordinator:looma',
          },
        ],
      }),
    ])
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    expect(await orch.drainPendingIssues()).toEqual([])
  })

  it('does not alter task status when draining', async () => {
    await writeQueue([
      mkTask({
        id: 't-1',
        status: 'in_progress',
        agentIssues: [
          {
            id: 'iss-t-1-1',
            taskId: 't-1',
            agentId: 'worker-agent',
            code: 'stuck',
            severity: 'warn',
            detail: 'x',
            raisedAt: '2026-04-20T00:00:00Z',
            broadcast: false,
          },
        ],
      }),
    ])
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    await orch.drainPendingIssues()
    const q = await readQueue()
    expect(q.tasks[0]!.status).toBe('in_progress')
  })

  it('handles multiple tasks with issues in a single drain', async () => {
    await writeQueue([
      mkTask({
        id: 't-a',
        status: 'in_progress',
        agentIssues: [
          {
            id: 'iss-t-a-1',
            taskId: 't-a',
            agentId: 'w',
            code: 'stuck',
            severity: 'warn',
            detail: 'a',
            raisedAt: '2026-04-20T00:00:00Z',
            broadcast: false,
          },
        ],
      }),
      mkTask({
        id: 't-b',
        status: 'review',
        agentIssues: [
          {
            id: 'iss-t-b-1',
            taskId: 't-b',
            agentId: 'r',
            code: 'spec_incoherent',
            severity: 'warn',
            detail: 'b',
            raisedAt: '2026-04-20T00:00:00Z',
            broadcast: false,
          },
        ],
      }),
    ])
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    const drained = await orch.drainPendingIssues()
    expect(drained.map((i) => i.id).sort()).toEqual(['iss-t-a-1', 'iss-t-b-1'])
  })

  it('returns an empty array when no issues exist (no queue write)', async () => {
    await writeQueue([mkTask({ id: 't-1', status: 'in_progress' })])
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    const before = await fs.stat(tasksPath)
    const drained = await orch.drainPendingIssues()
    const after = await fs.stat(tasksPath)
    expect(drained).toEqual([])
    // mtime should be unchanged — draining a no-op must not bump the file
    expect(after.mtimeMs).toBe(before.mtimeMs)
  })
})

// ---------------------------------------------------------------------------
// FR-30: agent liveness via event-stream silence
//
// The orchestrator's liveness tracker is fed by the event stream (which in
// the current in-process model reduces to register-around-generate). These
// tests pin that the register/unregister bookkeeping survives all the exit
// paths of `tick()`: clean return, agent error, escalation, and the
// policy-decision early branches (proposal / pre-rejection) that must NOT
// touch the tracker at all.
// ---------------------------------------------------------------------------
describe('Orchestrator — FR-30 liveness tracking', () => {
  it('registers an agent for the duration of generate() and unregisters on clean return', async () => {
    await writeQueue([mkTask({ id: 't-1', status: 'in_progress' })])
    let snapshotDuringGenerate: Array<{ agentId: string; taskId: string }> = []
    const worker = stubAgent('worker-agent', () => {
      snapshotDuringGenerate = orch.liveness
        .snapshot()
        .map((e) => ({ agentId: e.agentId, taskId: e.taskId }))
    })
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
    })

    await orch.tick()
    expect(snapshotDuringGenerate).toEqual([
      { agentId: 'worker-agent', taskId: 't-1' },
    ])
    // After tick returns cleanly, registration is lifted
    expect(orch.liveness.snapshot()).toEqual([])
  })

  it('unregisters even when the agent throws', async () => {
    await writeQueue([mkTask({ id: 't-1', status: 'in_progress' })])
    const worker = stubAgent('worker-agent', () => {
      throw new Error('boom')
    })
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
    })
    const out = await orch.tick()
    expect(out.kind).toBe('agent-error')
    // Critical — a crashed agent left registered would forever flag as
    // stalled on every subsequent scan.
    expect(orch.liveness.snapshot()).toEqual([])
  })

  it('does NOT register for pure-policy ticks (proposal decisions invoke no LLM)', async () => {
    const settings = makeDefaultSettings(new Date('2026-04-20T00:00:00Z'))
    settings.domains.default.task_origination = {
      position: 'agent_autonomous',
      rationale: 'x',
      setAt: '2026-04-20T00:00:00Z',
      setBy: 'user-direct',
    }
    await saveLeverSettings({
      path: agentSettingsPath,
      settings,
    })
    await writeQueue([
      mkTask({
        id: 't-prop',
        status: 'proposed',
        origination: 'agent',
        proposedBy: 'worker-agent',
        proposalRationale: 'why',
      }),
    ])
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    const out = await orch.tick()
    expect(out.kind).toBe('proposal-decided')
    // No LLM = no registration
    expect(orch.liveness.snapshot()).toEqual([])
  })

  it('scanStalls flags an agent that has been registered but silent past the strict threshold', () => {
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet(),
    })
    orch.liveness.setStrictness('strict')
    // Simulate a registered agent whose clock has advanced past 45s. The
    // real watchdog runs off-loop; we invoke scanStalls with a nowOverride
    // to assert it returns the right flag.
    orch.liveness.register('out-of-process-worker', 't-1')
    const base = orch.liveness.snapshot()[0]!.lastEventAt
    const flags = orch.scanStalls(base + 50_000)
    expect(flags).toHaveLength(1)
    expect(flags[0]!.agentId).toBe('out-of-process-worker')
    expect(flags[0]!.strictness).toBe('strict')
  })

  it('refreshLivenessStrictness picks up the lever position', async () => {
    const settings = makeDefaultSettings(new Date('2026-04-20T00:00:00Z'))
    settings.project.agent_health_strictness = {
      position: 'strict',
      rationale: 'tight watchdog',
      setAt: '2026-04-20T00:00:00Z',
      setBy: 'user-direct',
    }
    await saveLeverSettings({
      path: agentSettingsPath,
      settings,
    })
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    // Default strictness is 'standard' until refresh is called.
    orch.liveness.register('w', 't')
    expect(orch.scanStalls(orch.liveness.snapshot()[0]!.lastEventAt + 50_000)).toEqual(
      [],
    )

    await orch.refreshLivenessStrictness()
    expect(
      orch.scanStalls(orch.liveness.snapshot()[0]!.lastEventAt + 50_000),
    ).toHaveLength(1)
  })

  it('refreshLivenessStrictness falls back to standard on missing lever file', async () => {
    await fs.rm(agentSettingsPath, { force: true })
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    // Refresh should not throw and should leave the tracker in a usable state
    // even when the settings file is truly absent.
    await orch.refreshLivenessStrictness()
    orch.liveness.register('w', 't')
    expect(
      orch.scanStalls(orch.liveness.snapshot()[0]!.lastEventAt + 125_000),
    ).toHaveLength(1)
  })

  it('accepts an externally-provided liveness tracker', () => {
    const external = new LivenessTracker({ strictness: 'lax' })
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet(),
      liveness: external,
    })
    expect(orch.liveness).toBe(external)
  })
})

// ---------------------------------------------------------------------------
// FR-33: crash-safe task checkpointing / reclaim detection
//
// `scanReclaimCandidates` is the orchestrator's entry point into the FR-32
// remediation loop. It must:
//   - find tasks in `in_progress`/`review`/`gate_check` whose assigned agent
//     is not in the liveness tracker's live set,
//   - ignore queue statuses and terminal statuses,
//   - load the last durable checkpoint from memory/tasks/<id>/checkpoint.json,
//   - flag checkpoints older than 24h for auto-escalation.
//
// The tests write the checkpoint file directly rather than going through the
// `writeCheckpoint` tool (that's covered in @guildhall/tools) — we only care
// that the orchestrator reads the right paths and routes the right tasks.
// ---------------------------------------------------------------------------
describe('Orchestrator — FR-33 reclaim detection', () => {
  async function writeCheckpointFile(
    taskId: string,
    partial: Partial<{
      step: number
      intent: string
      nextPlannedAction: string
      writtenAt: string
      agentId: string
      filesTouched: string[]
    }> = {},
  ): Promise<void> {
    const dir = getProjectTaskLocalHistoryDir(tmpDir, taskId)
    await fs.mkdir(dir, { recursive: true })
    const cp = {
      taskId,
      agentId: partial.agentId ?? 'worker-agent',
      step: partial.step ?? 1,
      intent: partial.intent ?? 'doing work',
      filesTouched: partial.filesTouched ?? [],
      nextPlannedAction: partial.nextPlannedAction ?? 'continue',
      writtenAt: partial.writtenAt ?? '2026-04-20T00:00:00Z',
    }
    await fs.writeFile(
      path.join(dir, 'checkpoint.json'),
      JSON.stringify(cp, null, 2),
      'utf-8',
    )
  }

  it('flags in_progress tasks whose assignee is not in the live set', async () => {
    await writeQueue([
      mkTask({ id: 't-alive', status: 'in_progress', assignedTo: 'w-alive' }),
      mkTask({ id: 't-crashed', status: 'in_progress', assignedTo: 'w-dead' }),
    ])
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    orch.liveness.register('w-alive', 't-alive')

    const candidates = await orch.scanReclaimCandidates()
    expect(candidates.map((c) => c.task.id)).toEqual(['t-crashed'])
  })

  it('ignores terminal statuses (done / shelved / blocked)', async () => {
    await writeQueue([
      mkTask({ id: 't-done', status: 'done' }),
      mkTask({ id: 't-shelved', status: 'shelved' }),
      mkTask({ id: 't-blocked', status: 'blocked' }),
    ])
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    expect(await orch.scanReclaimCandidates()).toEqual([])
  })

  it('ignores queue statuses (ready / proposed / spec_review / exploring)', async () => {
    await writeQueue([
      mkTask({ id: 't1', status: 'ready' }),
      mkTask({ id: 't2', status: 'proposed' }),
      mkTask({ id: 't3', status: 'spec_review' }),
      mkTask({ id: 't4', status: 'exploring' }),
    ])
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    expect(await orch.scanReclaimCandidates()).toEqual([])
  })

  it('includes the last durable checkpoint for each candidate', async () => {
    await writeQueue([
      mkTask({ id: 't-crashed', status: 'in_progress', assignedTo: 'w-dead' }),
    ])
    await writeCheckpointFile('t-crashed', {
      step: 7,
      intent: 'migrating db',
      nextPlannedAction: 'run the migration',
    })
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })

    const [cand] = await orch.scanReclaimCandidates()
    expect(cand!.task.id).toBe('t-crashed')
    expect(cand!.checkpoint).not.toBeNull()
    expect(cand!.checkpoint!.step).toBe(7)
    expect(cand!.checkpoint!.nextPlannedAction).toBe('run the migration')
  })

  it('returns checkpoint:null when the task never wrote one', async () => {
    await writeQueue([
      mkTask({ id: 't-crashed', status: 'in_progress', assignedTo: 'w-dead' }),
    ])
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    const [cand] = await orch.scanReclaimCandidates()
    expect(cand!.checkpoint).toBeNull()
    expect(cand!.ageMs).toBeNull()
    expect(cand!.autoEscalate).toBe(false)
  })

  it('auto-escalates checkpoints older than 24h', async () => {
    await writeQueue([
      mkTask({ id: 't-stale', status: 'in_progress', assignedTo: 'w-dead' }),
    ])
    // 25 hours in the past — auto-escalation triggers at 24h regardless of
    // remediation_autonomy (spec: "auto-escalated to human review regardless
    // of `remediation_autonomy`").
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
    await writeCheckpointFile('t-stale', { writtenAt: old })
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })

    const [cand] = await orch.scanReclaimCandidates()
    expect(cand!.autoEscalate).toBe(true)
    expect(cand!.ageMs).toBeGreaterThan(24 * 60 * 60 * 1000)
  })

  it('does NOT auto-escalate a fresh checkpoint', async () => {
    await writeQueue([
      mkTask({ id: 't-recent', status: 'in_progress', assignedTo: 'w-dead' }),
    ])
    await writeCheckpointFile('t-recent', { writtenAt: new Date().toISOString() })
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    const [cand] = await orch.scanReclaimCandidates()
    expect(cand!.autoEscalate).toBe(false)
  })

  it('honors a nowMs override for deterministic age calculations', async () => {
    await writeQueue([
      mkTask({ id: 't-x', status: 'in_progress', assignedTo: 'w-dead' }),
    ])
    // Checkpoint at t=0; scan at t=10s → age should be exactly 10_000.
    await writeCheckpointFile('t-x', {
      writtenAt: new Date(0).toISOString(),
    })
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    const [cand] = await orch.scanReclaimCandidates(10_000)
    expect(cand!.ageMs).toBe(10_000)
  })
})

// ---------------------------------------------------------------------------
// FR-32: coordinator remediation decision loop (orchestrator integration)
//
// The pure policy (authorizeAction, buildRemediationContext,
// recordRemediationDecision) is exercised in remediation.test.ts. Here we
// pin the orchestrator's wiring: collect triggers from all three sources,
// assemble a context with the right lever state, and record decisions that
// bump the task's remediationAttempts counter.
// ---------------------------------------------------------------------------
describe('Orchestrator — FR-32 remediation wiring', () => {
  async function seedSettings(): Promise<void> {
    const settings = makeDefaultSettings(new Date('2026-04-20T00:00:00Z'))
    await saveLeverSettings({
      path: agentSettingsPath,
      settings,
    })
  }

  it('collectRemediationTriggers surfaces stall + issue + crash triggers together', async () => {
    await seedSettings()
    await writeQueue([
      mkTask({ id: 't-stall', status: 'in_progress', assignedTo: 'w-stall' }),
      mkTask({
        id: 't-issue',
        status: 'in_progress',
        assignedTo: 'w-alive',
        agentIssues: [
          {
            id: 'iss-t-issue-1',
            taskId: 't-issue',
            agentId: 'w-alive',
            code: 'stuck',
            severity: 'warn',
            detail: 'made no progress',
            raisedAt: '2026-04-20T00:00:00Z',
            broadcast: true,
          },
        ],
      }),
      mkTask({ id: 't-crash', status: 'in_progress', assignedTo: 'w-dead' }),
    ])

    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    orch.liveness.setStrictness('strict')
    // w-stall: registered long ago → past strict 45s threshold → stalled
    orch.liveness.register('w-stall', 't-stall')
    // w-alive: just registered → not stalled
    orch.liveness.register('w-alive', 't-issue')
    const base = orch.liveness.snapshot().find((e) => e.agentId === 'w-stall')!
      .lastEventAt

    const triggers = await orch.collectRemediationTriggers(base + 60_000)
    const kinds = triggers.map((t) => `${t.kind}:${t.taskId}`).sort()
    expect(kinds).toContain('stall:t-stall')
    expect(kinds).toContain('issue:t-issue')
    expect(kinds).toContain('crash:t-crash')
  })

  it('does NOT surface resolved issues as triggers', async () => {
    await seedSettings()
    await writeQueue([
      mkTask({
        id: 't-done-issue',
        status: 'in_progress',
        assignedTo: 'w-alive',
        agentIssues: [
          {
            id: 'iss-t-done-issue-1',
            taskId: 't-done-issue',
            agentId: 'w-alive',
            code: 'stuck',
            severity: 'warn',
            detail: 'resolved earlier',
            raisedAt: '2026-04-20T00:00:00Z',
            broadcast: true,
            resolvedAt: '2026-04-20T00:05:00Z',
            resolution: 'coordinator intervened',
            resolvedBy: 'coord-looma',
          },
        ],
      }),
    ])
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    orch.liveness.register('w-alive', 't-done-issue')

    const triggers = await orch.collectRemediationTriggers()
    expect(triggers.filter((t) => t.kind === 'issue')).toEqual([])
  })

  it('buildRemediationContextFor reflects current lever positions', async () => {
    const settings = makeDefaultSettings(new Date('2026-04-20T00:00:00Z'))
    settings.project.remediation_autonomy = {
      position: 'confirm_destructive',
      rationale: 'x',
      setAt: '2026-04-20T00:00:00Z',
      setBy: 'user-direct',
    }
    settings.domains.default.crash_recovery_default = {
      position: 'prefer_resume',
      rationale: 'x',
      setAt: '2026-04-20T00:00:00Z',
      setBy: 'user-direct',
    }
    await saveLeverSettings({
      path: agentSettingsPath,
      settings,
    })

    await writeQueue([
      mkTask({
        id: 't-1',
        status: 'in_progress',
        assignedTo: 'w-1',
        remediationAttempts: 3,
      }),
    ])

    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    orch.liveness.register('w-1', 't-1')
    const [trigger] = await orch.collectRemediationTriggers(
      orch.liveness.snapshot()[0]!.lastEventAt + 1_000_000,
    )

    const ctx = await orch.buildRemediationContextFor(trigger!)
    expect(ctx.priorAttempts).toBe(3)
    expect(ctx.leverState.remediationAutonomy).toBe('confirm_destructive')
    expect(ctx.leverState.crashRecoveryDefault).toBe('prefer_resume')
    expect(ctx.leverState.agentHealthStrictness).toBe('standard')
  })

  it('recordRemediation appends to DECISIONS.md and bumps remediationAttempts', async () => {
    await seedSettings()
    await writeQueue([
      mkTask({ id: 't-1', status: 'in_progress', assignedTo: 'w-1' }),
    ])

    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    orch.liveness.register('w-1', 't-1')
    const [trigger] = await orch.collectRemediationTriggers(
      orch.liveness.snapshot()[0]!.lastEventAt + 1_000_000,
    )
    const ctx = await orch.buildRemediationContextFor(trigger!)

    await orch.recordRemediation({
      context: ctx,
      action: {
        kind: 'restart_from_checkpoint',
        rationale: 'no destructive change needed',
      },
      authorization: { kind: 'autonomous' },
      decidedBy: 'coord-looma',
    })

    const decisions = await fs.readFile(
      getProjectSystemStatePath(tmpDir, 'DECISIONS.md'),
      'utf-8',
    )
    expect(decisions).toMatch(/Remediation: restart_from_checkpoint/)
    expect(decisions).toMatch(/task=t-1/)

    const runtime = await readTaskRuntimeStore(tmpDir)
    expect(runtime.tasks['t-1']?.remediationAttempts).toBe(1)
  })

  it('authorizeRemediation delegates to the pure gate using the context lever', async () => {
    const settings = makeDefaultSettings(new Date('2026-04-20T00:00:00Z'))
    settings.project.remediation_autonomy = {
      position: 'confirm_destructive',
      rationale: 'x',
      setAt: '2026-04-20T00:00:00Z',
      setBy: 'user-direct',
    }
    await saveLeverSettings({
      path: agentSettingsPath,
      settings,
    })

    await writeQueue([
      mkTask({ id: 't-1', status: 'in_progress', assignedTo: 'w-1' }),
    ])

    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    orch.liveness.register('w-1', 't-1')
    const [trigger] = await orch.collectRemediationTriggers(
      orch.liveness.snapshot()[0]!.lastEventAt + 1_000_000,
    )
    const ctx = await orch.buildRemediationContextFor(trigger!)

    // Non-destructive under confirm_destructive → autonomous
    expect(
      orch.authorizeRemediation(
        { kind: 'restart_from_checkpoint', rationale: 'x' },
        ctx,
      ),
    ).toEqual({ kind: 'autonomous' })
    // Destructive under confirm_destructive → requires_confirm
    expect(
      orch.authorizeRemediation({ kind: 'shelve_task', rationale: 'x' }, ctx).kind,
    ).toBe('requires_confirm')
  })

  it('multiple recordRemediation calls increment remediationAttempts monotonically', async () => {
    await seedSettings()
    await writeQueue([
      mkTask({ id: 't-1', status: 'in_progress', assignedTo: 'w-1' }),
    ])
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    orch.liveness.register('w-1', 't-1')
    const [trigger] = await orch.collectRemediationTriggers(
      orch.liveness.snapshot()[0]!.lastEventAt + 1_000_000,
    )

    for (let i = 0; i < 3; i++) {
      const ctx = await orch.buildRemediationContextFor(trigger!)
      await orch.recordRemediation({
        context: ctx,
        action: { kind: 'wait', rationale: `attempt ${i + 1}` },
        authorization: { kind: 'autonomous' },
        decidedBy: 'coord-looma',
      })
    }

    const runtime = await readTaskRuntimeStore(tmpDir)
    expect(runtime.tasks['t-1']?.remediationAttempts).toBe(3)
  })
})

describe('Orchestrator worker no-progress escalation', () => {
  it('gives the worker five no-op passes before escalating likely-target no-progress', async () => {
    const worktreePath = path.join(tmpDir, '.guildhall', 'worktrees', 'task-011')
    await fs.mkdir(path.join(worktreePath, 'web', 'tests', 'unit', 'composables'), { recursive: true })
    await writeQueue([
      mkTask({
        id: 'task-011',
        title: 'Add unit coverage for use-presence lifecycle',
        status: 'in_progress',
        assignedTo: 'worker-agent',
        projectPath: tmpDir,
        worktreePath,
        spec: `Edit \`${path.join(worktreePath, 'web', 'app', 'composables', 'use-presence.ts')}\` and verify \`${path.join(worktreePath, 'web', 'tests', 'unit', 'composables', 'use-presence.test.ts')}\`.`,
        acceptanceCriteria: [{
          id: 'ac-1',
          description: 'test passes',
          verifiedBy: 'automated',
          command: 'pnpm --filter @knit-app test -- tests/unit/composables/use-presence.test.ts',
          met: false,
        } as any],
      }),
    ])

    const worker = stubAgent('worker-agent', undefined, '')
    const gitDriver = new InMemoryGitDriver()
    gitDriver.setClean(true)
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
      gitDriver,
    })

    for (let pass = 1; pass < 5; pass += 1) {
      const outcome = await orch.tick({ dispatchLimit: 1 })
      expect(outcome.kind).toBe('processed')
      if (outcome.kind === 'processed') expect(outcome.transitioned).toBe(false)
    }

    const fifth = await orch.tick({ dispatchLimit: 1 })
    expect(fifth.kind).toBe('escalated')
    if (fifth.kind === 'escalated') expect(fifth.reason).toContain('Worker made no visible progress')

    const task = await readEffectiveTaskFromQueue('task-011')
    expect(task?.status).toBe('blocked')
    expect(task?.escalations.length).toBe(1)
    expect(task?.escalations[0]?.summary).toContain('Worker made no visible progress after 5 passes')
    expect(task?.notes.find((note) => note.role === 'policy-classification')?.content)
      .toContain('"class":"model_tool_use_failure"')
  })

  it('tries one autonomous checkpoint remediation before blocking repeated checkpoint no-progress stops', async () => {
    const targetPath = path.join(tmpDir, 'packages', 'converter', 'src', 'commentInserter.ts')
    await fs.mkdir(path.dirname(targetPath), { recursive: true })
    await fs.writeFile(targetPath, 'export const value = 1;\n', 'utf-8')
    execFileSync('git', ['add', 'packages/converter/src/commentInserter.ts'], {
      cwd: tmpDir,
      stdio: 'ignore',
    })
    execFileSync('git', ['commit', '--no-verify', '-m', 'add target'], {
      cwd: tmpDir,
      stdio: 'ignore',
    })
    await writeCheckpoint({
      tasksPath,
      memoryDir,
      taskId: 'task-blank',
      agentId: 'worker-agent',
      intent: 'Resume converter comment repair',
      nextPlannedAction:
        'Inspect the checkpoint-touched files against the verification result, then fix whatever still fails before you write the structured self-critique.',
      filesTouched: ['packages/converter/src/commentInserter.ts'],
    })
    await writeQueue([
      mkTask({
        id: 'task-blank',
        title: 'Repair converter comments',
        status: 'in_progress',
        assignedTo: 'worker-agent',
        projectPath: tmpDir,
        spec: `Edit \`${targetPath}\` and verify the converter tests.`,
        acceptanceCriteria: [{
          id: 'ac-1',
          description: 'converter test passes',
          verifiedBy: 'automated',
          command: 'cd packages/converter && pnpm vitest --run test/ts-to-jsdoc.test.ts',
          met: false,
        } as any],
      }),
    ])

    const worker = {
      name: 'worker-agent',
      calls: [] as { prompt: string }[],
      resetCount: 0,
      async generate(prompt: string) {
        this.calls.push({ prompt })
        return { text: '' }
      },
      async generateWithEvents(prompt: string, onEvent: (event: any) => void | Promise<void>) {
        this.calls.push({ prompt })
        await onEvent({
          type: 'status',
          message:
            'Assistant kept returning no tool call after checkpoint-directed nudges; ending this turn so the coordinator can treat it as no progress.',
        })
        return { text: '' }
      },
      resetConversation() {
        this.resetCount += 1
      },
    }
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
    })

    for (let pass = 1; pass < 5; pass += 1) {
      const outcome = await orch.tick({ dispatchLimit: 1 })
      expect(outcome.kind).toBe('processed')
      if (outcome.kind === 'processed') expect(outcome.agent).toBe('worker-agent')
    }

    const fifth = await orch.tick({ dispatchLimit: 1 })
    expect(fifth.kind).toBe('processed')
    if (fifth.kind === 'processed') {
      expect(fifth.agent).toBe('coordinator-remediation')
      expect(fifth.afterStatus).toBe('in_progress')
    }

    let task = await readEffectiveTaskFromQueue('task-blank')
    expect(task?.status).toBe('in_progress')
    expect(task?.remediationAttempts).toBe(1)
    expect(task?.agentIssues[0]?.resolvedBy).toBe('coordinator-remediation')
    expect(worker.resetCount).toBe(1)

    const decisions = await fs.readFile(getProjectSystemStatePath(tmpDir, 'DECISIONS.md'), 'utf-8')
    expect(decisions).toMatch(/Remediation: restart_from_checkpoint/)

    for (let pass = 1; pass < 5; pass += 1) {
      const outcome = await orch.tick({ dispatchLimit: 1 })
      expect(outcome.kind).toBe('processed')
      if (outcome.kind === 'processed') expect(outcome.agent).toBe('worker-agent')
    }

    const tenth = await orch.tick({ dispatchLimit: 1 })
    expect(tenth.kind).toBe('escalated')
    if (tenth.kind === 'escalated') expect(tenth.reason).toContain('Worker made no visible progress')

    task = await readEffectiveTaskFromQueue('task-blank')
    expect(task?.status).toBe('blocked')
    expect(task?.escalations[0]?.summary).toContain('Worker made no visible progress after 5 passes')
    expect(task?.notes.find((note) => note.role === 'policy-classification')?.content)
      .toContain('"class":"model_tool_use_failure"')
  })

  it('treats dirty worktrees as no progress when a failed checkpointed verification gets no new worker evidence', async () => {
    const worktreePath = path.join(tmpDir, '.guildhall', 'worktrees', 'invite-flow')
    await fs.mkdir(path.join(worktreePath, 'web', 'app', 'pages'), { recursive: true })
    await writeQueue([
      mkTask({
        id: 'task-failed-checkpoint',
        title: 'Repair invite flow',
        status: 'in_progress',
        assignedTo: 'worker-agent',
        projectPath: tmpDir,
        worktreePath,
        spec: `Edit \`${path.join(worktreePath, 'web', 'app', 'pages', 'settings.vue')}\` and rerun typecheck.`,
        acceptanceCriteria: [{
          id: 'ac-1',
          description: 'typecheck passes',
          verifiedBy: 'automated',
          command: 'cd web && pnpm typecheck',
          met: false,
        } as any],
      }),
    ])
    await writeCheckpoint({
      tasksPath,
      memoryDir,
      taskId: 'task-failed-checkpoint',
      agentId: 'worker-agent',
      intent: 'Failed bootstrap verification',
      nextPlannedAction:
        'Resume from the recorded bootstrap verification failure, rerun the focused verification command, and fix whatever still fails.',
      filesTouched: ['web/app/pages/settings.vue'],
      resumeContext: {
        verification: [{
          command: 'cd web && pnpm typecheck',
          passed: false,
          observedAt: '2026-05-16T00:00:00.000Z',
          summary: 'settings.vue type error',
        }],
        safeNextMutationSurface: ['web/app/pages/settings.vue'],
      },
    })

    const worker = {
      name: 'worker-agent',
      calls: [] as { prompt: string }[],
      resetCount: 0,
      async generate(prompt: string) {
        this.calls.push({ prompt })
        return { text: 'I looked at it but made no change.' }
      },
      loadToolMetadata() {
        return {}
      },
      resetConversation() {
        this.resetCount += 1
      },
    }
    const gitDriver = new InMemoryGitDriver({ clean: false })
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
      gitDriver,
    })

    for (let pass = 1; pass < 5; pass += 1) {
      const outcome = await orch.tick({ dispatchLimit: 1 })
      expect(outcome.kind).toBe('processed')
      if (outcome.kind === 'processed') expect(outcome.agent).toBe('worker-agent')
    }

    const fifth = await orch.tick({ dispatchLimit: 1 })
    expect(fifth.kind).toBe('processed')
    if (fifth.kind === 'processed') {
      expect(fifth.agent).toBe('coordinator-remediation')
      expect(fifth.afterStatus).toBe('in_progress')
    }

    const task = await readEffectiveTaskFromQueue('task-failed-checkpoint')
    expect(task?.status).toBe('in_progress')
    expect(task?.remediationAttempts).toBe(1)
    expect(task?.agentIssues[0]?.resolvedBy).toBe('coordinator-remediation')
    expect(worker.resetCount).toBe(1)
    expect(worker.calls[0]?.prompt).toContain('Latest authoritative verification')
    expect(worker.calls[0]?.prompt).toContain('cd web && pnpm typecheck')
  })

  it('retries once before escalating when a resumed worker times out without mutating likely target files', async () => {
    const worktreePath = path.join(tmpDir, '.guildhall', 'worktrees', 'task-012')
    await fs.mkdir(path.join(worktreePath, 'web', 'tests', 'unit', 'composables'), { recursive: true })
    await writeQueue([
      mkTask({
        id: 'task-012',
        title: 'Repair use-presence lifecycle tests',
        status: 'in_progress',
        assignedTo: 'worker-agent',
        projectPath: tmpDir,
        worktreePath,
        spec: `Edit \`${path.join(worktreePath, 'web', 'app', 'composables', 'use-presence.ts')}\` and verify \`${path.join(worktreePath, 'web', 'tests', 'unit', 'composables', 'use-presence.test.ts')}\`.`,
        acceptanceCriteria: [{
          id: 'ac-1',
          description: 'test passes',
          verifiedBy: 'automated',
          command: 'pnpm --filter @knit-app test -- tests/unit/composables/use-presence.test.ts',
          met: false,
        } as any],
      }),
    ])

    const worker = stubAgent('worker-agent')
    worker.generate = async () =>
      await new Promise<string>((_, reject) => {
        setTimeout(() => reject(new Error('worker-agent timed out after 10ms')), 25)
      }) as never

    const gitDriver = new InMemoryGitDriver()
    gitDriver.setClean(true)
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
      gitDriver,
      agentGenerateTimeoutMs: 10,
    })

    const first = await orch.tick({ dispatchLimit: 1 })
    expect(first.kind).toBe('processed')
    if (first.kind === 'processed') {
      expect(first.afterStatus).toBe('in_progress')
      expect(first.transitioned).toBe(false)
    }

    const retried = await readEffectiveTaskFromQueue('task-012')
    expect(retried?.status).toBe('in_progress')
    expect(retried?.escalations.length).toBe(0)
    expect(retried?.notes.find((note) => note.role === 'runtime')?.content)
      .toContain('will retry once')

    const second = await orch.tick({ dispatchLimit: 1 })
    expect(second.kind).toBe('escalated')
    if (second.kind === 'escalated') {
      expect(second.reason).toContain('timed out after 10ms')
    }

    const task = await readEffectiveTaskFromQueue('task-012')
    expect(task?.status).toBe('blocked')
    expect(task?.escalations.length).toBe(1)
    expect(task?.escalations[0]?.summary).toContain('Worker timed out after failing to mutate')
    expect(task?.notes.find((note) => note.role === 'policy-classification')?.content)
      .toContain('"class":"provider_unavailable"')
  })

  it('preserves dirty worktree progress when a worker exceeds its total turn budget', async () => {
    const worktreePath = path.join(tmpDir, '.guildhall', 'worktrees', 'task-013')
    await fs.mkdir(worktreePath, { recursive: true })
    await writeQueue([
      mkTask({
        id: 'task-013',
        title: 'Build small local app',
        status: 'in_progress',
        assignedTo: 'worker-agent',
        projectPath: tmpDir,
        worktreePath,
        spec: 'Build the app files and hand off to review.',
        acceptanceCriteria: [{
          id: 'ac-1',
          description: 'app files exist',
          verifiedBy: 'review',
          met: false,
        } as any],
      }),
    ])

    const worker = stubAgent('worker-agent')
    worker.generate = async () => await new Promise(() => {}) as never
    const gitDriver = new InMemoryGitDriver()
    gitDriver.setClean(false)
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
      gitDriver,
      agentGenerateTimeoutMs: 60_000,
      agentGenerateWallClockTimeoutMs: 10,
    })

    const outcome = await orch.tick({ dispatchLimit: 1 })

    expect(outcome.kind).toBe('processed')
    if (outcome.kind === 'processed') {
      expect(outcome.agent).toBe('worker-agent')
      expect(outcome.beforeStatus).toBe('in_progress')
      expect(outcome.afterStatus).toBe('in_progress')
      expect(outcome.transitioned).toBe(false)
    }
    const task = (await readQueue()).tasks.find((candidate) => candidate.id === 'task-013')
    expect(task?.status).toBe('in_progress')
    expect(task?.escalations).toEqual([])
    expect(task?.notes.at(-1)).toMatchObject({
      agentId: 'worker-agent',
      role: 'runtime',
      content:
        'The worker hit its turn budget after making worktree edits, so Guildhall is preserving that partial implementation for the next pass.',
    })
  })

  it('blocks after repeated dirty worktree worker turn-budget retries', async () => {
    const worktreePath = path.join(tmpDir, '.guildhall', 'worktrees', 'task-014')
    await fs.mkdir(worktreePath, { recursive: true })
    await writeQueue([
      mkTask({
        id: 'task-014',
        title: 'Finish component keyboard behavior',
        status: 'in_progress',
        assignedTo: 'worker-agent',
        projectPath: tmpDir,
        worktreePath,
        spec: 'Finish the component and hand off to review.',
        acceptanceCriteria: [{
          id: 'ac-1',
          description: 'component behavior is verified',
          verifiedBy: 'review',
          met: false,
        } as any],
      }),
    ])

    const worker = stubAgent('worker-agent')
    worker.generate = async () => await new Promise(() => {}) as never
    const gitDriver = new InMemoryGitDriver()
    gitDriver.setClean(false)
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
      gitDriver,
      agentGenerateTimeoutMs: 60_000,
      agentGenerateWallClockTimeoutMs: 10,
    })

    const first = await orch.tick({ dispatchLimit: 1 })
    const second = await orch.tick({ dispatchLimit: 1 })
    const third = await orch.tick({ dispatchLimit: 1 })

    expect(first.kind).toBe('processed')
    expect(second.kind).toBe('processed')
    expect(third.kind).toBe('escalated')
    if (third.kind === 'escalated') {
      expect(third.reason).toContain('repeatedly hit its turn budget')
    }
    const task = await readEffectiveTaskFromQueue('task-014')
    expect(task?.status).toBe('blocked')
    expect(task?.escalations.at(-1)?.summary)
      .toContain('repeatedly hit its turn budget')
    expect(task?.notes.find((note) => note.role === 'policy-classification')?.content)
      .toContain('"class":"model_tool_use_failure"')
  })

  it('uses durable runtime notes when deciding repeated dirty worktree retries after restart', async () => {
    const worktreePath = path.join(tmpDir, '.guildhall', 'worktrees', 'task-015')
    await fs.mkdir(worktreePath, { recursive: true })
    await writeQueue([
      mkTask({
        id: 'task-015',
        title: 'Finish debug report script',
        status: 'in_progress',
        assignedTo: 'worker-agent',
        projectPath: tmpDir,
        worktreePath,
        spec: 'Finish the debug report and hand off to review.',
        acceptanceCriteria: [{
          id: 'ac-1',
          description: 'debug report is verified',
          verifiedBy: 'review',
          met: false,
        } as any],
        notes: [
          {
            agentId: 'worker-agent',
            role: 'runtime',
            content:
              'The worker hit its turn budget after making worktree edits, so Guildhall is preserving that partial implementation for the next pass.',
            timestamp: '2026-05-03T00:00:00.000Z',
          },
          {
            agentId: 'worker-agent',
            role: 'runtime',
            content:
              'The worker hit its turn budget again with dirty work preserved. Guildhall will retry once more before asking for owner intervention.',
            timestamp: '2026-05-03T00:01:00.000Z',
          },
        ],
      }),
    ])

    const worker = stubAgent('worker-agent')
    worker.generate = async () => await new Promise(() => {}) as never
    const gitDriver = new InMemoryGitDriver()
    gitDriver.setClean(false)
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
      gitDriver,
      agentGenerateTimeoutMs: 60_000,
      agentGenerateWallClockTimeoutMs: 10,
    })

    const outcome = await orch.tick({ dispatchLimit: 1 })

    expect(outcome.kind).toBe('escalated')
    if (outcome.kind === 'escalated') {
      expect(outcome.reason).toContain('repeatedly hit its turn budget')
    }
    const task = await readEffectiveTaskFromQueue('task-015')
    expect(task?.status).toBe('blocked')
    expect(task?.escalations.at(-1)?.summary)
      .toContain('repeatedly hit its turn budget')
  })
})

describe('Orchestrator — FR-24 slot allocation / runtime isolation', () => {
  async function writeSettings(overrides: {
    runtime?: 'none' | 'slot_allocation'
    dispatch?: { kind: 'serial' } | { kind: 'fanout'; n: number }
  } = {}): Promise<void> {
    const settings: LeverSettings = makeDefaultSettings(new Date('2026-04-20T00:00:00Z'))
    settings.project.worktree_isolation = {
      position: overrides.dispatch?.kind === 'fanout' ? 'per_task' : 'none',
      rationale:
        overrides.dispatch?.kind === 'fanout'
          ? 'Fanout dispatch now requires worktree isolation; keep the test config valid.'
          : 'These tests cover runtime slot allocation, not per-task git worktrees.',
      setAt: '2026-04-20T00:00:00Z',
      setBy: 'user-direct',
    }
    if (overrides.runtime) {
      settings.project.runtime_isolation = {
        position: overrides.runtime,
        rationale: 'test',
        setAt: '2026-04-20T00:00:00Z',
        setBy: 'user-direct',
      }
    }
    if (overrides.dispatch) {
      settings.project.concurrent_task_dispatch = {
        position: overrides.dispatch,
        rationale: 'test',
        setAt: '2026-04-20T00:00:00Z',
        setBy: 'user-direct',
      }
    }
    await saveLeverSettings({
      path: agentSettingsPath,
      settings,
    })
  }

  it('skips slot allocation when runtime_isolation=none (default)', async () => {
    await writeSettings() // default = none
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    const allocator = await orch.ensureSlotAllocator()
    expect(allocator).toBeNull()
  })

  it('instantiates a capacity-1 allocator when runtime_isolation=slot_allocation and dispatch=serial', async () => {
    await writeSettings({ runtime: 'slot_allocation' })
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    const allocator = await orch.ensureSlotAllocator()
    expect(allocator).not.toBeNull()
    expect(allocator!.capacity).toBe(1)
  })

  it('instantiates a fanout-N allocator when dispatch=fanout_N and isolation is on', async () => {
    await writeSettings({
      runtime: 'slot_allocation',
      dispatch: { kind: 'fanout', n: 4 },
    })
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    const allocator = await orch.ensureSlotAllocator()
    expect(allocator!.capacity).toBe(4)
  })

  it('falls back to null when agent-settings.yaml is missing', async () => {
    await fs.rm(agentSettingsPath, { force: true })
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    const allocator = await orch.ensureSlotAllocator()
    expect(allocator).toBeNull()
  })

  it('injects the slot system-prompt rule into the dispatched prompt', async () => {
    await writeSettings({ runtime: 'slot_allocation' })
    await writeQueue([mkTask({ id: 't-1', status: 'in_progress', assignedTo: 'w-1' })])

    const worker = stubAgent('worker-agent')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
    })
    await orch.tick()

    expect(worker.calls).toHaveLength(1)
    const prompt = worker.calls[0]!.prompt
    expect(prompt).toContain('Runtime isolation (FR-24)')
    expect(prompt).toContain('slot is **0**')
    expect(prompt).toContain('GUILDHALL_W0_')
  })

  it('does NOT inject the slot rule when runtime_isolation=none', async () => {
    await writeSettings() // none
    await writeQueue([mkTask({ id: 't-1', status: 'in_progress', assignedTo: 'w-1' })])

    const worker = stubAgent('worker-agent')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
    })
    await orch.tick()

    expect(worker.calls[0]!.prompt).not.toContain('Runtime isolation (FR-24)')
  })

  it('releases the slot after the agent returns so the next tick can claim it', async () => {
    await writeSettings({ runtime: 'slot_allocation' })
    await writeQueue([
      mkTask({ id: 't-a', status: 'in_progress', assignedTo: 'w-a' }),
    ])
    const worker = stubAgent('worker-agent')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
    })
    await orch.tick()

    const allocator = await orch.ensureSlotAllocator()
    expect(allocator!.inUse).toBe(0)

    // Replace the queue with a different task; slot 0 should be free again.
    await writeQueue([
      mkTask({ id: 't-b', status: 'in_progress', assignedTo: 'w-b' }),
    ])
    await orch.tick()
    expect(allocator!.inUse).toBe(0)
  })

  it('releases the slot when the agent throws', async () => {
    await writeSettings({ runtime: 'slot_allocation' })
    await writeQueue([
      mkTask({ id: 't-1', status: 'in_progress', assignedTo: 'w-1' }),
    ])
    const worker = stubAgent('worker-agent', async () => {
      throw new Error('boom')
    })
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
    })
    const out = await orch.tick()
    expect(out.kind).toBe('agent-error')
    const allocator = await orch.ensureSlotAllocator()
    expect(allocator!.inUse).toBe(0)
  })

  it('honors guildhall.yaml runtime overrides for portBase / envVarPrefix', async () => {
    await writeSettings({ runtime: 'slot_allocation' })
    await writeQueue([
      mkTask({ id: 't-1', status: 'in_progress', assignedTo: 'w-1' }),
    ])

    const worker = stubAgent('worker-agent')
    const config = baseConfig({
      runtime: {
        portBase: 9000,
        portStride: 10,
        envVarPrefixTemplate: 'X{slot}_',
      },
    })
    const orch = new Orchestrator({
      config,
      agents: agentSet({ worker }),
    })
    await orch.tick()

    const prompt = worker.calls[0]!.prompt
    expect(prompt).toContain('Port base is **9000**')
    expect(prompt).toContain('X0_')
  })

  it('slotEnvFor merges canonical vars on top of process env when a slot is held', async () => {
    await writeSettings({ runtime: 'slot_allocation' })
    await writeQueue([
      mkTask({ id: 't-1', status: 'in_progress', assignedTo: 'w-1' }),
    ])

    // Hold the dispatch so we can observe slotEnvFor while the slot is live.
    let resolveGate: (() => void) | null = null
    const gate = new Promise<void>((r) => {
      resolveGate = r
    })
    let signalEntered: (() => void) | null = null
    const entered = new Promise<void>((r) => {
      signalEntered = r
    })
    const worker = stubAgent('worker-agent', async () => {
      // Do not resolve the gate inside generate — we want the tick in flight.
    })
    // Override generate to wait on gate so the slot is held during probing.
    // Signal `entered` on first line so the test waits on a real event,
    // not a wall-clock timeout (which is flaky under load).
    worker.generate = async (prompt: string) => {
      worker.calls.push({ prompt })
      signalEntered!()
      await gate
      return { text: 'ok' }
    }

    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
    })
    const tickPromise = orch.tick()
    await entered

    const task = mkTask({ id: 't-1', status: 'in_progress' })
    const env = orch.slotEnvFor(task, { PATH: '/usr/bin' })
    expect(env['PATH']).toBe('/usr/bin')
    expect(env['GUILDHALL_SLOT']).toBe('0')
    expect(env['GUILDHALL_PORT_BASE']).toBeDefined()
    expect(env['GUILDHALL_ENV_PREFIX']).toBe('GUILDHALL_W0_')

    resolveGate!()
    await tickPromise
  })

  it('is idempotent: re-allocating a held slot for the same task returns the same index', async () => {
    await writeSettings({
      runtime: 'slot_allocation',
      dispatch: { kind: 'fanout', n: 3 },
    })
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    const allocator = (await orch.ensureSlotAllocator())!
    const s1 = allocator.allocate('t-A')!
    const s2 = allocator.allocate('t-A')!
    expect(s2).toBe(s1)
    expect(allocator.inUse).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// FR-27 / AC-18 \u2014 reviewer_mode dispatch with deterministic fallback.
// Exercises the three modes end-to-end through the orchestrator tick:
// verifies that (a) the LLM is skipped when the mode says so, (b) the
// deterministic reviewer fires on LLM outage under `llm_with_deterministic_fallback`,
// and (c) the verdict record carries `reviewerPath` so the audit trail
// shows which code path produced the decision.
// ---------------------------------------------------------------------------
describe('Orchestrator.tick \u2014 AC-18 reviewer_mode dispatch', () => {
  async function writeReviewerMode(
    mode: DomainLevers['reviewer_mode']['position'],
  ): Promise<void> {
    const settings: LeverSettings = makeDefaultSettings(
      new Date('2026-04-21T00:00:00Z'),
    )
    settings.project.worktree_isolation = {
      position: 'none',
      rationale: 'Reviewer fallback tests isolate reviewer-mode behavior, not git worktree setup.',
      setAt: '2026-04-21T00:00:00Z',
      setBy: 'user-direct',
    }
    settings.domains.default.reviewer_mode = {
      position: mode,
      rationale: 'test override',
      setAt: '2026-04-21T00:00:00Z',
      setBy: 'user-direct',
    }
    await saveLeverSettings({
      path: agentSettingsPath,
      settings,
    })
  }

  /** A review-ready task with ACs met and a passing hard gate, so the
   *  deterministic rubric clears the 0.8 threshold and returns approve. */
  function reviewReadyTask(overrides: Partial<Task> = {}): Task {
    return mkTask({
      id: 't-review',
      status: 'review',
      acceptanceCriteria: [
        { id: 'ac-1', description: 'ghost button renders', verifiedBy: 'review', met: true },
        { id: 'ac-2', description: 'build passes', verifiedBy: 'automated', command: 'pnpm build', met: true },
      ],
      gateResults: [
        { gateId: 'typecheck', type: 'hard', passed: true, checkedAt: '2026-04-21T00:00:00Z' },
        { gateId: 'test', type: 'hard', passed: true, checkedAt: '2026-04-21T00:00:00Z' },
      ],
      ...overrides,
    })
  }

  it(
    'llm_with_deterministic_fallback: simulated LLM outage runs deterministic reviewer and records reviewerPath on the verdict',
    async () => {
      await writeReviewerMode('llm_with_deterministic_fallback')
      await writeQueue([reviewReadyTask()])

      // Reviewer throws every call \u2014 simulates provider outage / timeout.
      const throwingReviewer: StubAgent = {
        name: 'reviewer-agent',
        calls: [],
        async generate(prompt: string) {
          this.calls.push({ prompt })
          throw new Error('provider timeout')
        },
      }

      const orch = new Orchestrator({
        config: baseConfig(),
        agents: agentSet({ reviewer: throwingReviewer }),
      })
      const out = await orch.tick()

      // The orchestrator must NOT surface agent-error \u2014 the fallback absorbs
      // the outage and produces a real verdict.
      expect(out.kind).toBe('processed')
      if (out.kind === 'processed') {
        expect(out.beforeStatus).toBe('review')
        expect(out.afterStatus).toBe('gate_check')
        expect(out.agent).toBe('reviewer-deterministic-fallback')
      }

      const q = await readQueue()
      const t = q.tasks[0]!
      expect(t.status).toBe('gate_check')
      expect(t.reviewVerdicts).toHaveLength(1)
      const verdict = t.reviewVerdicts[0]!
      expect(verdict.reviewerPath).toBe('deterministic')
      expect(verdict.verdict).toBe('approve')
      expect(verdict.llmError).toContain('provider timeout')
      expect(verdict.score).toBeGreaterThanOrEqual(0.8)
    },
  )

  it(
    'llm_with_deterministic_fallback: reviewer throttle advances verified work to gate_check before hard gates exist',
    async () => {
      await writeReviewerMode('llm_with_deterministic_fallback')
      await writeQueue([
        reviewReadyTask({
          acceptanceCriteria: [
            { id: 'ac-1', description: 'ghost button renders', verifiedBy: 'review', met: false },
            { id: 'ac-2', description: 'build passes', verifiedBy: 'automated', command: 'pnpm build', met: false },
          ],
          gateResults: [],
          notes: [
            {
              agentId: 'worker-agent',
              role: 'worker',
              content: [
                '**Self-critique:**',
                '1. **Ghost button renders:** Met — Verified in source.',
                '2. **Build passes:** Met — Verified via pnpm build.',
                '',
                'Out-of-scope changes introduced: None.',
                'Uncertainties: None.',
              ].join('\n'),
              timestamp: '2026-04-21T00:00:00Z',
            },
          ],
        }),
      ])

      const throwingReviewer: StubAgent = {
        name: 'reviewer-agent',
        calls: [],
        async generate(prompt: string) {
          this.calls.push({ prompt })
          throw new Error('OpenAI-compatible API HTTP 429: {"status":429,"title":"Too Many Requests"}')
        },
      }

      const orch = new Orchestrator({
        config: baseConfig(),
        agents: agentSet({ reviewer: throwingReviewer }),
      })
      const out = await orch.tick()

      expect(out.kind).toBe('processed')
      if (out.kind === 'processed') {
        expect(out.afterStatus).toBe('gate_check')
        expect(out.agent).toBe('reviewer-deterministic-fallback')
      }

      const task = (await readQueue()).tasks[0]!
      expect(task.status).toBe('gate_check')
      expect(task.acceptanceCriteria.every((criterion) => criterion.met)).toBe(true)
      expect(task.reviewVerdicts.at(-1)?.verdict).toBe('approve')
      expect(task.reviewVerdicts.at(-1)?.llmError).toContain('Too Many Requests')
    },
  )

  it(
    'llm_with_deterministic_fallback: a hanging reviewer turn times out and advances via deterministic fallback',
    async () => {
      await writeReviewerMode('llm_with_deterministic_fallback')
      await writeQueue([reviewReadyTask()])

      const hangingReviewer = {
        name: 'reviewer-agent',
        calls: [] as { prompt: string }[],
        async generate(prompt: string) {
          this.calls.push({ prompt })
          return { text: 'unused' }
        },
        async generateWithEvents(
          prompt: string,
          _onEvent: (event: any) => void | Promise<void>,
          opts?: { signal?: AbortSignal | undefined },
        ) {
          this.calls.push({ prompt })
          await new Promise<void>((resolve, reject) => {
            const signal = opts?.signal
            if (!signal) return
            if (signal.aborted) {
              reject(new Error('reviewer-agent timed out after 100ms'))
              return
            }
            signal.addEventListener(
              'abort',
              () => reject(new Error('reviewer-agent timed out after 100ms')),
              { once: true },
            )
          })
          return { text: 'unused' }
        },
      }

      const orch = new Orchestrator({
        config: baseConfig(),
        agents: agentSet({ reviewer: hangingReviewer }),
        agentGenerateTimeoutMs: 100,
      })
      const out = await orch.tick()

      expect(out.kind).toBe('processed')
      if (out.kind === 'processed') {
        expect(out.afterStatus).toBe('gate_check')
        expect(out.agent).toBe('reviewer-deterministic-fallback')
      }

      const task = (await readQueue()).tasks[0]!
      expect(task.status).toBe('gate_check')
      expect(task.reviewVerdicts.at(-1)?.llmError).toContain('timed out after 100ms')
    },
  )

  it(
    'llm_with_deterministic_fallback: streamed reviewer activity resets the inactivity timeout',
    async () => {
      await writeReviewerMode('llm_with_deterministic_fallback')
      await writeQueue([reviewReadyTask()])

      const streamingReviewer = {
        name: 'reviewer-agent',
        calls: [] as { prompt: string }[],
        async generate(prompt: string) {
          this.calls.push({ prompt })
          return { text: 'unused' }
        },
        async generateWithEvents(
          prompt: string,
          onEvent: (event: any) => void | Promise<void>,
          _opts?: { signal?: AbortSignal | undefined },
        ) {
          this.calls.push({ prompt })
          await onEvent({ type: 'assistant_delta', message: 'thinking' })
          await new Promise((resolve) => setTimeout(resolve, 15))
          await onEvent({ type: 'assistant_delta', message: 'still working' })
          await new Promise((resolve) => setTimeout(resolve, 15))
          await onEvent({ type: 'assistant_delta', message: 'wrapping up' })
          await new Promise((resolve) => setTimeout(resolve, 15))
          throw new Error('HTTP 429 Too Many Requests')
        },
      }

      const orch = new Orchestrator({
        config: baseConfig(),
        agents: agentSet({ reviewer: streamingReviewer }),
        agentGenerateTimeoutMs: 20,
      })
      const out = await orch.tick()

      expect(out.kind).toBe('processed')
      if (out.kind === 'processed') {
        expect(out.afterStatus).toBe('gate_check')
        expect(out.agent).toBe('reviewer-deterministic-fallback')
      }

      const task = (await readQueue()).tasks[0]!
      expect(task.status).toBe('gate_check')
      expect(task.reviewVerdicts.at(-1)?.llmError).toContain('Too Many Requests')
      expect(task.reviewVerdicts.at(-1)?.llmError).not.toContain('timed out after 20ms')
    },
  )

  it(
    'llm_with_deterministic_fallback: derives acceptance criteria from spec before reconciling worker self-critique',
    async () => {
      await writeReviewerMode('llm_with_deterministic_fallback')
      await writeQueue([
        reviewReadyTask({
          acceptanceCriteria: [],
          spec: [
            '## Summary',
            'Integrate Looma editor table primitives into Knit.',
            '',
            '## Acceptance Criteria',
            '1. Looma table primitives are wired into Knit.',
            '2. `pnpm -F web build` passes.',
          ].join('\n'),
          gateResults: [],
          notes: [
            {
              agentId: 'worker-agent',
              role: 'worker',
              content: [
                '**Self-critique:**',
                '1. **Looma table primitives are wired into Knit:** Met — Verified in source.',
                '2. **`pnpm -F web build` passes:** Met — Verified via pnpm -F web build.',
              ].join('\n'),
              timestamp: '2026-04-21T00:00:00Z',
            },
          ],
        }),
      ])

      const throwingReviewer: StubAgent = {
        name: 'reviewer-agent',
        calls: [],
        async generate(prompt: string) {
          this.calls.push({ prompt })
          throw new Error('OpenAI-compatible API HTTP 429: {"status":429,"title":"Too Many Requests"}')
        },
      }

      const orch = new Orchestrator({
        config: baseConfig(),
        agents: agentSet({ reviewer: throwingReviewer }),
      })
      const out = await orch.tick()

      expect(out.kind).toBe('processed')
      if (out.kind === 'processed') {
        expect(out.afterStatus).toBe('gate_check')
        expect(out.agent).toBe('reviewer-deterministic-fallback')
      }

      const task = (await readQueue()).tasks[0]!
      expect(task.acceptanceCriteria).toHaveLength(2)
      expect(task.acceptanceCriteria.every((criterion) => criterion.met)).toBe(true)
      expect(task.reviewVerdicts.at(-1)?.verdict).toBe('approve')
    },
  )

  it(
    'llm_with_deterministic_fallback: reconciles AC-01 criteria from AC1 self-critique shorthand after a total turn budget timeout',
    async () => {
      await writeReviewerMode('llm_with_deterministic_fallback')
      await writeQueue([
        reviewReadyTask({
          acceptanceCriteria: [
            { id: 'AC-01', description: 'Page loads.', verifiedBy: 'review', met: false },
            { id: 'AC-02', description: 'Mark used removes an item.', verifiedBy: 'review', met: false },
          ] as any,
          gateResults: [],
          notes: [
            {
              agentId: 'worker-agent',
              role: 'self-critique',
              content: [
                '**Self-critique:**',
                '- AC1 (Page loads): Met — Verified in browser.',
                '- AC2 (Mark used removes an item): Met — Verified in browser.',
              ].join('\n'),
              timestamp: '2026-04-21T00:00:00Z',
            },
          ],
        }),
      ])

      const timedOutReviewer: StubAgent = {
        name: 'reviewer-agent',
        calls: [],
        async generate(prompt: string) {
          this.calls.push({ prompt })
          throw new Error('reviewer-agent exceeded 120000ms total turn budget')
        },
      }

      const orch = new Orchestrator({
        config: baseConfig(),
        agents: agentSet({ reviewer: timedOutReviewer }),
      })
      const out = await orch.tick()

      expect(out.kind).toBe('processed')
      if (out.kind === 'processed') {
        expect(out.afterStatus).toBe('gate_check')
        expect(out.agent).toBe('reviewer-deterministic-fallback')
      }

      const task = (await readQueue()).tasks[0]!
      expect(task.acceptanceCriteria.every((criterion) => criterion.met)).toBe(true)
      expect(task.reviewVerdicts.at(-1)?.verdict).toBe('approve')
      expect(task.reviewVerdicts.at(-1)?.llmError).toContain('total turn budget')
    },
  )

  it(
    'llm_with_deterministic_fallback: when the LLM reviewer succeeds, the verdict is recorded as reviewerPath=llm',
    async () => {
      await writeReviewerMode('llm_with_deterministic_fallback')
      await writeQueue([reviewReadyTask()])

      // LLM reviewer approves via a tool call (simulated here by mutating
      // the task on disk) and returns cleanly.
      const approvingReviewer = stubAgent('reviewer-agent', async () => {
        await mutateTask('t-review', { status: 'gate_check' })
      })
      const orch = new Orchestrator({
        config: baseConfig(),
        agents: agentSet({ reviewer: approvingReviewer }),
      })
      const out = await orch.tick()

      expect(out.kind).toBe('processed')
      if (out.kind === 'processed') {
        expect(out.afterStatus).toBe('gate_check')
        expect(out.agent).toBe('reviewer-agent')
      }
      const t = (await readQueue()).tasks[0]!
      expect(t.reviewVerdicts).toHaveLength(1)
      expect(t.reviewVerdicts[0]!.reviewerPath).toBe('llm')
      expect(t.reviewVerdicts[0]!.verdict).toBe('approve')
      expect(t.reviewVerdicts[0]!.llmError).toBeUndefined()
    },
  )

  it(
    'llm_only: preserves a plain-text reviewer note and advances with deterministic fallback when no task mutation is written',
    async () => {
      await writeReviewerMode('llm_only')
      await writeQueue([reviewReadyTask()])

      const plainTextReviewer = stubAgent(
        'reviewer-agent',
        undefined,
        [
          '**Review:**',
          '- ac-1: Met — snapshot and worker verification show the test coverage is present.',
          '- ac-2: Met — build/typecheck verification already passed.',
          '',
          '**Verdict:** Approved',
          '',
          '**Reasoning:** The task already satisfies the review bar and only needed the verdict recorded.',
        ].join('\n'),
      )

      const orch = new Orchestrator({
        config: baseConfig(),
        agents: agentSet({ reviewer: plainTextReviewer }),
      })
      const out = await orch.tick()

      expect(out.kind).toBe('processed')
      if (out.kind === 'processed') {
        expect(out.agent).toBe('reviewer-agent')
        expect(out.afterStatus).toBe('gate_check')
      }

      const t = (await readQueue()).tasks[0]!
      expect(t.status).toBe('gate_check')
      expect(t.notes.at(-1)?.agentId).toBe('reviewer-agent')
      expect(t.notes.at(-1)?.content).toContain('**Verdict:** Approved')
      expect(t.reviewVerdicts).toHaveLength(1)
      expect(t.reviewVerdicts[0]!.reviewerPath).toBe('llm')
      expect(t.reviewVerdicts[0]!.reasoning).toContain('**Verdict:** Approved')
    },
  )

  it('deterministic_only: skips the LLM reviewer entirely', async () => {
    await writeReviewerMode('deterministic_only')
    await writeQueue([reviewReadyTask()])

    const reviewer = stubAgent('reviewer-agent')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ reviewer }),
    })
    const out = await orch.tick()

    expect(out.kind).toBe('processed')
    if (out.kind === 'processed') {
      expect(out.agent).toBe('reviewer-deterministic')
      expect(out.afterStatus).toBe('gate_check')
    }
    expect(reviewer.calls).toHaveLength(0) // LLM never called
    const t = (await readQueue()).tasks[0]!
    expect(t.reviewVerdicts[0]!.reviewerPath).toBe('deterministic')
    expect(t.reviewVerdicts[0]!.llmError).toBeUndefined()
  })

  it('deterministic_only: hands verified work to gate_check even before hard gates have run', async () => {
    await writeReviewerMode('deterministic_only')
    await writeQueue([
      reviewReadyTask({
        gateResults: [],
      }),
    ])

    const reviewer = stubAgent('reviewer-agent')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ reviewer }),
    })
    const out = await orch.tick()

    expect(out.kind).toBe('processed')
    if (out.kind === 'processed') {
      expect(out.agent).toBe('reviewer-deterministic')
      expect(out.afterStatus).toBe('gate_check')
    }
    expect(reviewer.calls).toHaveLength(0)

    const task = (await readQueue()).tasks[0]!
    expect(task.status).toBe('gate_check')
    expect(task.reviewVerdicts.at(-1)?.verdict).toBe('approve')
    expect(task.reviewVerdicts.at(-1)?.reason).toContain('advance to gate_check')
  })

  it('bypasses reviewer LLM work when only automated hard-verification criteria remain', async () => {
    await writeReviewerMode('llm_only')
    await writeQueue([
      reviewReadyTask({
        acceptanceCriteria: [
          { id: 'ac-1', description: 'workspace page opens', verifiedBy: 'review', met: true },
          {
            id: 'ac-2',
            description:
              'Playwright runner runs against the new file and passes with zero console violations',
            verifiedBy: 'automated',
            met: false,
          },
        ],
        gateResults: [],
      }),
    ])

    const reviewer = stubAgent('reviewer-agent')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ reviewer }),
    })
    const out = await orch.tick()

    expect(out.kind).toBe('processed')
    if (out.kind === 'processed') {
      expect(out.agent).toBe('reviewer-deterministic')
      expect(out.afterStatus).toBe('gate_check')
    }
    expect(reviewer.calls).toHaveLength(0)

    const task = (await readQueue()).tasks[0]!
    expect(task.status).toBe('gate_check')
    expect(task.reviewVerdicts.at(-1)?.reviewerPath).toBe('deterministic')
    expect(task.reviewVerdicts.at(-1)?.reason).toContain('automated hard-verification steps')
  })

  it('llm_only: LLM outage still surfaces as an agent-error (no fallback)', async () => {
    await writeReviewerMode('llm_only')
    await writeQueue([reviewReadyTask()])

    const throwingReviewer: StubAgent = {
      name: 'reviewer-agent',
      calls: [],
      async generate(prompt: string) {
        this.calls.push({ prompt })
        throw new Error('provider timeout')
      },
    }
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ reviewer: throwingReviewer }),
    })
    const out = await orch.tick()
    expect(out.kind).toBe('agent-error')

    const t = (await readQueue()).tasks[0]!
    expect(t.status).toBe('review') // unchanged
    expect(t.reviewVerdicts).toHaveLength(0) // no verdict recorded
  })

  it(
    'llm_with_deterministic_fallback: deterministic revise bounces to in_progress and bumps revisionCount',
    async () => {
      await writeReviewerMode('llm_with_deterministic_fallback')
      // ACs NOT met \u2192 deterministic rubric scores below threshold \u2192 revise.
      await writeQueue([
        reviewReadyTask({
          id: 't-bad',
          acceptanceCriteria: [
            { id: 'ac-1', description: 'ghost renders', verifiedBy: 'review', met: false },
          ],
          gateResults: [],
        }),
      ])

      const throwingReviewer: StubAgent = {
        name: 'reviewer-agent',
        calls: [],
        async generate() { throw new Error('provider outage') },
      }
      const orch = new Orchestrator({
        config: baseConfig(),
        agents: agentSet({ reviewer: throwingReviewer }),
      })
      const out = await orch.tick()
      expect(out.kind).toBe('processed')
      if (out.kind === 'processed') {
        expect(out.afterStatus).toBe('in_progress')
        expect(out.revisionCount).toBe(1)
      }
      const t = (await readQueue()).tasks[0]!
      expect(t.status).toBe('in_progress')
      expect(t.assignedTo).toBe('worker-agent')
      expect(t.revisionCount).toBe(1)
      expect(t.reviewVerdicts[0]!.verdict).toBe('revise')
      expect(t.reviewVerdicts[0]!.reviewerPath).toBe('deterministic')
    },
  )

  it(
    'records worker ownership again when the LLM reviewer sends a task back to in_progress',
    async () => {
      await writeReviewerMode('llm_with_deterministic_fallback')
      await writeQueue([reviewReadyTask({ id: 't-llm-revise' })])

      const revisingReviewer = stubAgent('reviewer-agent', async () => {
        await mutateTask('t-llm-revise', { status: 'in_progress' })
      })
      const orch = new Orchestrator({
        config: baseConfig(),
        agents: agentSet({ reviewer: revisingReviewer }),
      })
      const out = await orch.tick()

      expect(out.kind).toBe('processed')
      if (out.kind === 'processed') {
        expect(out.afterStatus).toBe('in_progress')
      }
      const t = (await readQueue()).tasks[0]!
      expect(t.status).toBe('in_progress')
      expect(t.assignedTo).toBe('worker-agent')
      expect(t.reviewVerdicts[0]!.reviewerPath).toBe('llm')
      expect(t.reviewVerdicts[0]!.verdict).toBe('revise')
    },
  )
})
