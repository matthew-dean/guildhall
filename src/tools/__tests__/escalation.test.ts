import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import {
  raiseEscalation,
  resolveEscalation,
  raiseEscalationTool,
  resolveEscalationTool,
  hasOpenEscalation,
  activeEscalations,
  currentRevisionCycleCount,
  resolveSupersededEscalations,
} from '../escalation.js'
import { readTasks } from '../task-queue.js'
import { buildEffectiveTask } from '../../runtime/effective-task.js'
import {
  appendTaskEvidence,
  getProjectSystemStatePath,
  promoteProjectStateDatabaseAuthority,
  projectStateDatabasePath,
  readProjectTaskQueueSync,
  readTaskEvidence,
  readTaskRuntimeStore,
  upsertTaskRuntimeState,
} from '@guildhall/sessions'
import {
  writePromotedTaskDetailMutation,
  writeProjectTaskQueue,
} from '../../runtime/project-state-boundary.js'
import type { Task } from '@guildhall/core'
import { setProvider } from '../../config/global-providers.js'

// ---------------------------------------------------------------------------
// FR-10 escalation protocol tests — these events are load-bearing for the
// orchestrator halt contract, so tests are thorough.
// ---------------------------------------------------------------------------

let tmpDir: string
let tasksPath: string
let progressPath: string

function seedTask(overrides: Partial<Task> = {}): Task {
  const now = new Date().toISOString()
  return {
    id: 'task-001',
    title: 'Test task',
    description: 'A test task',
    domain: 'looma',
    projectPath: tmpDir,
    status: 'in_progress',
    priority: 'normal',
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
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

async function writeSeed(tasks: Task[]): Promise<void> {
  const queue = {
    version: 1,
    lastUpdated: new Date().toISOString(),
    tasks,
  }
  writeProjectTaskQueue(tasksPath, queue, { projectRoot: tmpDir })
  promoteProjectStateDatabaseAuthority(tmpDir)
}

async function readEffectiveTask(): Promise<Task> {
  const { queue } = await readTasks({ tasksPath })
  const task = queue?.tasks.find((candidate) => candidate.id === 'task-001')
  if (!task) throw new Error('task-001 not found')
  return await buildEffectiveTask(tmpDir, task) as unknown as Task
}

async function readRawQueue(): Promise<{ tasks: Array<Record<string, unknown>> }> {
  return readProjectTaskQueueSync(tasksPath) as { tasks: Array<Record<string, unknown>> }
}

function readTaskDetailBytes(taskId: string): Buffer {
  const database = new DatabaseSync(projectStateDatabasePath(tmpDir), { readOnly: true })
  try {
    const row = database.prepare('SELECT payload_gzip FROM work_item_detail WHERE task_id = ?').get(taskId) as { payload_gzip: Uint8Array }
    return Buffer.from(row.payload_gzip)
  } finally {
    database.close()
  }
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-esc-'))
  tasksPath = getProjectSystemStatePath(tmpDir, 'TASKS.json')
  await fs.mkdir(path.dirname(tasksPath), { recursive: true })
  progressPath = path.join(tmpDir, 'PROGRESS.md')
  await writeSeed([
    seedTask(),
    seedTask({ id: 'task-002', title: 'Untouched task' }),
  ])
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('raiseEscalation', () => {
  it('appends an escalation with a stable id', async () => {
    const result = await raiseEscalation({
      tasksPath,
      taskId: 'task-001',
      agentId: 'worker-agent',
      reason: 'human_judgment_required',
      summary: 'Need product input on X vs Y',
    })
    expect(result.success).toBe(true)
    expect(result.escalationId).toBe('esc-task-001-1')

    const raw = await readRawQueue()
    expect(raw.tasks[0]).not.toHaveProperty('escalations')
    const task = await readEffectiveTask()
    expect(task.escalations).toHaveLength(1)
    expect(task.escalations[0]?.id).toBe('esc-task-001-1')
    expect(task.escalations[0]?.reason).toBe('human_judgment_required')
    expect(task.escalations[0]?.raisedAt).toBeDefined()
    expect(task.escalations[0]?.resolvedAt).toBeUndefined()
  })

  it('stores external setup checklist steps on owner blockers', async () => {
    const result = await raiseEscalation({
      tasksPath,
      taskId: 'task-001',
      agentId: 'worker-agent',
      reason: 'human_judgment_required',
      summary: 'OAuth providers need external setup',
      details: 'Guildhall can verify the code after the provider dashboards are configured.',
      externalChecklist: [
        {
          id: 'google-oauth',
          title: 'Create Google OAuth credentials',
          detail: 'Add the client ID and secret to Supabase.',
          owner: 'user',
          status: 'todo',
        },
        {
          id: 'apple-oauth',
          title: 'Create Apple OAuth credentials',
          owner: 'user',
          status: 'todo',
        },
      ],
    })

    expect(result.success).toBe(true)
    const task = await readEffectiveTask()
    expect(task.escalations[0]?.externalChecklist).toMatchObject([
      { id: 'google-oauth', title: 'Create Google OAuth credentials' },
      { id: 'apple-oauth', title: 'Create Apple OAuth credentials' },
    ])
  })

  it('halts the task by setting status to blocked', async () => {
    await raiseEscalation({
      tasksPath,
      taskId: 'task-001',
      agentId: 'worker-agent',
      reason: 'decision_required',
      summary: 'Library choice needs product signoff',
    })
    const { queue } = await readTasks({ tasksPath })
    expect(queue?.tasks[0]?.status).toBe('blocked')
    expect(queue?.tasks[0]?.blockReason).toContain('decision_required')
    expect(queue?.tasks[0]?.blockReason).toContain('product signoff')
  })

  it('increments escalation id for each new escalation on the same task', async () => {
    await raiseEscalation({
      tasksPath,
      taskId: 'task-001',
      agentId: 'worker-agent',
      reason: 'decision_required',
      summary: 'first',
    })
    const second = await raiseEscalation({
      tasksPath,
      taskId: 'task-001',
      agentId: 'reviewer-agent',
      reason: 'spec_ambiguous',
      summary: 'second',
    })
    expect(second.escalationId).toBe('esc-task-001-2')
    const task = await readEffectiveTask()
    expect(task.escalations).toHaveLength(2)
  })

  it('reuses an existing unresolved escalation for the same blocker', async () => {
    const first = await raiseEscalation({
      tasksPath,
      taskId: 'task-001',
      agentId: 'worker-agent',
      reason: 'decision_required',
      summary: 'Owner must choose between monthly and annual billing',
      details: 'Both pricing paths are implementable, but the task needs a product decision before the worker can pick one.',
    })
    const second = await raiseEscalation({
      tasksPath,
      taskId: 'task-001',
      agentId: 'worker-agent',
      reason: 'decision_required',
      summary: 'Owner must choose between monthly and annual billing',
      details: 'Same blocker with a more detailed explanation.',
    })

    expect(first.success).toBe(true)
    expect(second.success).toBe(true)
    expect(second.escalationId).toBe(first.escalationId)

    const task = await readEffectiveTask()
    expect(task.escalations).toHaveLength(1)
  })

  it('re-blocks a task when an existing unresolved escalation is raised again after a bad reopen', async () => {
    const first = await raiseEscalation({
      tasksPath,
      taskId: 'task-001',
      agentId: 'worker-agent',
      reason: 'human_judgment_required',
      summary: 'Worker repeatedly hit its turn budget after saving partial work.',
    })
    expect(first.success).toBe(true)

    writePromotedTaskDetailMutation(tasksPath, 'task-001', {
      mutate: task => ({ ...task, status: 'in_progress', blockReason: undefined }),
    })
    await upsertTaskRuntimeState(tmpDir, 'task-001', { assignedTo: 'worker-agent' })

    const second = await raiseEscalation({
      tasksPath,
      taskId: 'task-001',
      agentId: 'worker-agent',
      reason: 'human_judgment_required',
      summary: 'Worker repeatedly hit its turn budget after saving partial work.',
    })

    expect(second.success).toBe(true)
    expect(second.escalationId).toBe(first.escalationId)
    const task = await readEffectiveTask()
    expect(task.status).toBe('blocked')
    expect(task.assignedTo).toBeNull()
    expect(task.blockReason).toBe('human_judgment_required: Worker repeatedly hit its turn budget after saving partial work.')
    expect(activeEscalations(task)).toHaveLength(1)
  })

  it('rejects worker escalations caused by brittle edit matching instead of owner decisions', async () => {
    const result = await raiseEscalation({
      tasksPath,
      taskId: 'task-001',
      agentId: 'worker-agent',
      reason: 'spec_ambiguous',
      summary: 'Card component exists but template syntax mismatch prevents edit',
      details: 'Multiple attempts to edit dashboard.vue failed because the exact string was not found, suggesting a whitespace or formatting mismatch. Need clarification on how to properly apply Card with props in the template.',
    })

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/implementation recovery/i)
    expect(result.error).toMatch(/do not ask the owner/i)

    const raw = await readRawQueue()
    expect(raw.tasks[0]?.status).toBe('in_progress')
    expect(raw.tasks[0]).not.toHaveProperty('escalations')
  })

  it('writes a typed progress entry when progressPath is provided', async () => {
    await raiseEscalation({
      tasksPath,
      progressPath,
      taskId: 'task-001',
      agentId: 'worker-agent',
      reason: 'spec_ambiguous',
      summary: 'criterion 3 underspecified',
    })
    const progress = await fs.readFile(progressPath, 'utf-8')
    expect(progress).toContain('ESCALATION')
    expect(progress).toContain('spec_ambiguous')
    expect(progress).toContain('🆘')
  })

  it('does not write a progress entry if progressPath is omitted', async () => {
    await raiseEscalation({
      tasksPath,
      taskId: 'task-001',
      agentId: 'worker-agent',
      reason: 'decision_required',
      summary: 'silent',
    })
    await expect(fs.access(progressPath)).rejects.toThrow()
  })

  it('includes optional details in the escalation record', async () => {
    await raiseEscalation({
      tasksPath,
      taskId: 'task-001',
      agentId: 'worker-agent',
      reason: 'gate_hard_failure',
      summary: 'typecheck keeps failing',
      details: 'Tried 3 times. Stack: tsc -b --verbose ...',
    })
    const task = await readEffectiveTask()
    expect(task.escalations[0]?.details).toContain('Stack: tsc')
  })

  it('returns error for unknown task id', async () => {
    const result = await raiseEscalation({
      tasksPath,
      taskId: 'nonexistent',
      agentId: 'worker-agent',
      reason: 'decision_required',
      summary: 'nope',
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('nonexistent')
  })
})

describe('resolveEscalation', () => {
  beforeEach(async () => {
    await raiseEscalation({
      tasksPath,
      taskId: 'task-001',
      agentId: 'worker-agent',
      reason: 'decision_required',
      summary: 'pick a library',
    })
  })

  it('marks the escalation as resolved and returns task to nextStatus', async () => {
    const result = await resolveEscalation({
      tasksPath,
      taskId: 'task-001',
      escalationId: 'esc-task-001-1',
      resolution: 'Use library A',
      nextStatus: 'in_progress',
    })
    expect(result.success).toBe(true)

    const { queue } = await readTasks({ tasksPath })
    const task = queue?.tasks[0]
    const effective = await readEffectiveTask()
    expect(task?.status).toBe('in_progress')
    expect(effective.assignedTo).toBe('worker-agent')
    expect(task?.blockReason).toBeUndefined()
    const raw = await readRawQueue()
    expect(raw.tasks[0]).not.toHaveProperty('escalations')
    expect(effective.escalations[0]?.resolvedAt).toBeDefined()
    expect(effective.escalations[0]?.resolution).toBe('Use library A')
    expect(effective.escalations[0]?.resolvedBy).toBe('human')
  })

  it('restores reviewer ownership when an escalation resolves back to review', async () => {
    const result = await resolveEscalation({
      tasksPath,
      taskId: 'task-001',
      escalationId: 'esc-task-001-1',
      resolution: 'Return this to review',
      nextStatus: 'review',
    })
    expect(result.success).toBe(true)

    const { queue } = await readTasks({ tasksPath })
    const effective = await readEffectiveTask()
    expect(queue?.tasks[0]?.status).toBe('review')
    expect(effective.assignedTo).toBe('reviewer-agent')
  })

  it('starts a fresh retry window when resolving max-revisions back to active work', async () => {
    await resolveEscalation({
      tasksPath,
      taskId: 'task-001',
      escalationId: 'esc-task-001-1',
      resolution: 'Clear setup blocker for retry-window test.',
      nextStatus: 'in_progress',
    })
    await upsertTaskRuntimeState(tmpDir, 'task-001', {
      revisionCount: 4,
      updatedAt: '2026-05-01T00:00:00.000Z',
    })
    const escalation = await raiseEscalation({
      tasksPath,
      taskId: 'task-001',
      agentId: 'reviewer-fanout',
      reason: 'max_revisions_exceeded',
      summary: 'Exceeded maxRevisions (3). Reviewer fan-out keeps rejecting.',
    })

    const result = await resolveEscalation({
      tasksPath,
      taskId: 'task-001',
      escalationId: escalation.escalationId!,
      resolution: 'Retry after guardrail fix.',
      nextStatus: 'in_progress',
    })
    expect(result.success).toBe(true)

    const task = await readEffectiveTask()
    const runtime = await readTaskRuntimeStore(tmpDir)
    const resolvedRetry = task.escalations.find(candidate => candidate.id === escalation.escalationId)
    expect(runtime.tasks['task-001']?.retryWindow).toEqual({
      startedAt: resolvedRetry?.resolvedAt,
      baseRevisionCount: 4,
    })
    expect(task.retryWindow).toEqual({
      startedAt: resolvedRetry?.resolvedAt,
      baseRevisionCount: 4,
    })
    expect(currentRevisionCycleCount(task)).toBe(0)
  })

  it('defaults resolvedBy to "human"', async () => {
    await resolveEscalation({
      tasksPath,
      taskId: 'task-001',
      escalationId: 'esc-task-001-1',
      resolution: 'r',
      nextStatus: 'in_progress',
    })
    const task = await readEffectiveTask()
    expect(task.escalations[0]?.resolvedBy).toBe('human')
  })

  it('accepts explicit resolvedBy', async () => {
    await resolveEscalation({
      tasksPath,
      taskId: 'task-001',
      escalationId: 'esc-task-001-1',
      resolution: 'r',
      resolvedBy: 'coordinator-looma',
      nextStatus: 'in_progress',
    })
    const task = await readEffectiveTask()
    expect(task.escalations[0]?.resolvedBy).toBe('coordinator-looma')
  })

  it('clears canonical blocker fields when resolving a sidecar-only escalation', async () => {
    const raisedAt = new Date().toISOString()
    writePromotedTaskDetailMutation(tasksPath, 'task-001', {
      mutate: task => ({
        ...task,
        status: 'blocked',
        blockReason: 'decision_required: stale proof policy question',
        openEscalations: [{
          id: 'esc-task-001-stale',
          summary: 'Stale compact escalation row',
        }],
      }),
    })
    await appendTaskEvidence(tmpDir, 'task-001', {
      id: 'esc-task-001-1',
      kind: 'escalation',
      recordedAt: raisedAt,
      payload: {
        id: 'esc-task-001-1',
        taskId: 'task-001',
        agentId: 'worker-agent',
        reason: 'decision_required',
        summary: 'Need proof policy decision',
        raisedAt,
      },
    })

    const result = await resolveEscalation({
      tasksPath,
      taskId: 'task-001',
      escalationId: 'esc-task-001-1',
      resolution: 'Use the project-local proof command.',
      nextStatus: 'in_progress',
    })

    expect(result.success).toBe(true)
    const raw = await readRawQueue()
    const task = raw.tasks.find(candidate => candidate.id === 'task-001')!
    expect(task.status).toBe('in_progress')
    expect(task.blockReason).toBeUndefined()
    expect(task.openEscalations).toBeUndefined()
  })

  it('keeps task blocked if other escalations remain open', async () => {
    await raiseEscalation({
      tasksPath,
      taskId: 'task-001',
      agentId: 'reviewer-agent',
      reason: 'spec_ambiguous',
      summary: 'second',
    })
    await resolveEscalation({
      tasksPath,
      taskId: 'task-001',
      escalationId: 'esc-task-001-1',
      resolution: 'first resolved',
      nextStatus: 'in_progress',
    })
    const { queue } = await readTasks({ tasksPath })
    const task = queue?.tasks[0]
    expect(task?.status).toBe('blocked') // still halted — second escalation open
    const effective = await readEffectiveTask()
    expect(effective.escalations[0]?.resolvedAt).toBeDefined()
    expect(effective.escalations[1]?.resolvedAt).toBeUndefined()
  })

  it('returns error for unknown escalation id', async () => {
    const result = await resolveEscalation({
      tasksPath,
      taskId: 'task-001',
      escalationId: 'esc-does-not-exist',
      resolution: 'r',
      nextStatus: 'in_progress',
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('esc-does-not-exist')
  })

  it('returns error when resolving an already-resolved escalation', async () => {
    await resolveEscalation({
      tasksPath,
      taskId: 'task-001',
      escalationId: 'esc-task-001-1',
      resolution: 'first',
      nextStatus: 'in_progress',
    })
    const second = await resolveEscalation({
      tasksPath,
      taskId: 'task-001',
      escalationId: 'esc-task-001-1',
      resolution: 'again',
      nextStatus: 'in_progress',
    })
    expect(second.success).toBe(false)
    expect(second.error).toContain('already resolved')
  })

  it('writes a milestone progress entry when progressPath is provided', async () => {
    await resolveEscalation({
      tasksPath,
      progressPath,
      taskId: 'task-001',
      escalationId: 'esc-task-001-1',
      resolution: 'pick A',
      nextStatus: 'in_progress',
    })
    const progress = await fs.readFile(progressPath, 'utf-8')
    expect(progress).toContain('MILESTONE')
    expect(progress).toContain('esc-task-001-1')
    expect(progress).toContain('pick A')
  })
})

describe('promoted escalation persistence', () => {
  it('mutates only the target detail and keeps raise/resolve visible through evidence and effective task state', async () => {
    tasksPath = getProjectSystemStatePath(tmpDir, 'TASKS.json')
    await fs.mkdir(path.dirname(tasksPath), { recursive: true })

    const before = readTaskDetailBytes('task-002')
    const raised = await raiseEscalation({
      tasksPath,
      taskId: 'task-001',
      agentId: 'worker-agent',
      reason: 'decision_required',
      summary: 'Choose the supported provider.',
    })

    expect(raised.success).toBe(true)
    expect(readTaskDetailBytes('task-002')).toEqual(before)
    const raisedTask = await readEffectiveTask()
    expect(raisedTask).toMatchObject({
      status: 'blocked',
      blockReason: 'decision_required: Choose the supported provider.',
    })
    expect(raisedTask.escalations).toEqual([
      expect.objectContaining({ id: raised.escalationId }),
    ])
    expect(raisedTask.escalations[0]?.resolvedAt).toBeUndefined()
    expect(await readTaskEvidence(tmpDir, 'task-001', { kind: 'escalation' })).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({ id: raised.escalationId }),
      }),
    ])
    expect((await readTaskRuntimeStore(tmpDir)).tasks['task-001']).toMatchObject({
      assignedTo: null,
      openEscalationIds: [raised.escalationId],
    })

    const resolved = await resolveEscalation({
      tasksPath,
      taskId: 'task-001',
      escalationId: raised.escalationId!,
      resolution: 'Use the supported provider.',
      nextStatus: 'in_progress',
    })

    expect(resolved.success).toBe(true)
    expect(readTaskDetailBytes('task-002')).toEqual(before)
    const resolvedQueue = (await readTasks({ tasksPath })).queue
    const resolvedTask = await buildEffectiveTask(tmpDir, resolvedQueue!.tasks[0]!, { evidence: 'full' }) as unknown as Task
    expect(resolvedTask).toMatchObject({
      status: 'in_progress',
      assignedTo: 'worker-agent',
      escalations: [expect.objectContaining({
        id: raised.escalationId,
        resolution: 'Use the supported provider.',
        resolvedBy: 'human',
      })],
    })
    expect(resolvedTask.blockReason).toBeUndefined()
    expect((await readTaskRuntimeStore(tmpDir)).tasks['task-001']).toMatchObject({
      assignedTo: 'worker-agent',
      openEscalationIds: [],
    })
    expect(await readTaskEvidence(tmpDir, 'task-001', { kind: 'escalation' })).toEqual(expect.arrayContaining([
      expect.objectContaining({
        payload: expect.objectContaining({
          id: raised.escalationId,
          resolution: 'Use the supported provider.',
        }),
      }),
    ]))
  })
})

describe('hasOpenEscalation', () => {
  it('treats missing escalation arrays as empty', () => {
    const task = seedTask()
    ;(task as Partial<Task>).escalations = undefined
    expect(activeEscalations(task)).toEqual([])
    expect(hasOpenEscalation(task)).toBe(false)
  })

  it('returns false for a task with no escalations', () => {
    expect(hasOpenEscalation(seedTask())).toBe(false)
  })

  it('returns true when at least one escalation is unresolved', () => {
    const task = seedTask({
      status: 'blocked',
      escalations: [
        {
          id: 'esc-1',
          taskId: 'task-001',
          agentId: 'a',
          reason: 'decision_required',
          summary: 's',
          raisedAt: new Date().toISOString(),
        },
      ],
    })
    expect(hasOpenEscalation(task)).toBe(true)
  })

  it('returns false when all escalations are resolved', () => {
    const task = seedTask({
      escalations: [
        {
          id: 'esc-1',
          taskId: 'task-001',
          agentId: 'a',
          reason: 'decision_required',
          summary: 's',
          raisedAt: new Date().toISOString(),
          resolvedAt: new Date().toISOString(),
          resolution: 'done',
        },
      ],
    })
    expect(hasOpenEscalation(task)).toBe(false)
  })

  it('returns false when an unresolved escalation was superseded by later task progress', () => {
    const task = seedTask({
      status: 'gate_check',
      updatedAt: '2026-05-03T19:10:00.000Z',
      escalations: [
        {
          id: 'esc-1',
          taskId: 'task-001',
          agentId: 'a',
          reason: 'gate_hard_failure',
          summary: 'old blocker',
          raisedAt: '2026-05-03T19:00:00.000Z',
        },
      ],
    })
    expect(hasOpenEscalation(task)).toBe(false)
  })
})

describe('resolveSupersededEscalations', () => {
  it('materializes superseded escalations as resolved and clears stale block reason', () => {
    const task = seedTask({
      status: 'gate_check',
      blockReason: 'gate_hard_failure: stale blocker',
      updatedAt: '2026-05-03T19:10:00.000Z',
      escalations: [
        {
          id: 'esc-1',
          taskId: 'task-001',
          agentId: 'a',
          reason: 'gate_hard_failure',
          summary: 'old blocker',
          raisedAt: '2026-05-03T19:00:00.000Z',
        },
      ],
    })

    expect(
      resolveSupersededEscalations(task, {
        now: '2026-05-03T19:10:00.000Z',
        resolvedBy: 'system',
        resolution: 'Superseded by resumed gate_check.',
      }),
    ).toEqual(['esc-1'])
    expect(task.escalations[0]?.resolvedAt).toBe('2026-05-03T19:10:00.000Z')
    expect(task.escalations[0]?.resolvedBy).toBe('system')
    expect(task.escalations[0]?.resolution).toBe('Superseded by resumed gate_check.')
    expect(task.blockReason).toBeUndefined()
  })
})

describe('engine tool wrappers', () => {
  const ctx = { cwd: '/tmp', metadata: {} }

  it('raiseEscalationTool reports success', async () => {
    const result = await raiseEscalationTool.execute(
      {
        tasksPath,
        taskId: 'task-001',
        agentId: 'worker-agent',
        reason: 'decision_required',
        summary: 'x',
      },
      ctx,
    )
    expect(result.is_error).toBe(false)
    expect(result.metadata?.escalationId).toBe('esc-task-001-1')
  })

  it('raiseEscalationTool rejects routine verification proof as owner work', async () => {
    const result = await raiseEscalationTool.execute(
      {
        tasksPath,
        taskId: 'task-001',
        agentId: 'worker-agent',
        reason: 'human_judgment_required',
        summary: 'Cannot satisfy required AC-8 evidence command under current authoritative verification gate.',
        details: 'Coordinator scoped instructions require an AC-8 evidence block with the exact pnpm --dir frontend test result.',
      },
      ctx,
    )
    expect(result.is_error).toBe(true)
    expect(result.output).toMatch(/routine verification evidence/i)
  })

  it('raiseEscalationTool rejects Guildhall task orchestration as owner proof policy work', async () => {
    const result = await raiseEscalationTool.execute(
      {
        tasksPath,
        taskId: 'task-001',
        agentId: 'worker-agent',
        reason: 'decision_required',
        summary:
          'AC4 cannot be satisfied by running `npx guildhall run --task=task-001` because Guildhall blocks that command as delegating back to orchestration.',
        details:
          'The project-level proof `npm run proof:ground-truth` has already passed, but reviewer feedback still asks whether the blocked command counts as proof.',
      },
      ctx,
    )
    expect(result.is_error).toBe(true)
    expect(result.output).toMatch(/does not/i)

    const { queue } = await readTasks({ tasksPath })
    expect(queue?.tasks[0]?.status).toBe('in_progress')
  })

  it('raiseEscalationTool rejects configured provider credential proof as owner setup work', async () => {
    const previousHome = process.env.GUILDHALL_CONFIG_DIR
    const previousOpenAiKey = process.env.OPENAI_API_KEY
    const previousOpenAiBaseUrl = process.env.OPENAI_BASE_URL
    const previousDeepinfraToken = process.env.DEEPINFRA_API_TOKEN
    const providerHome = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-escalation-provider-'))
    process.env.GUILDHALL_CONFIG_DIR = providerHome
    delete process.env.OPENAI_API_KEY
    delete process.env.OPENAI_BASE_URL
    delete process.env.DEEPINFRA_API_TOKEN
    try {
      setProvider('openai-api', {
        apiKey: 'fake-deepinfra-key',
        baseUrl: 'https://api.deepinfra.com/v1/openai',
      })
      const result = await raiseEscalationTool.execute(
        {
          tasksPath,
          taskId: 'task-001',
          agentId: 'worker-agent',
          reason: 'human_judgment_required',
          summary: 'Provider API token required to complete proof execution',
          details:
            'The proof script `scripts/prove-deepinfra-drafting-model.mjs` requires a valid DEEPINFRA_API_TOKEN to execute.',
          externalChecklist: [
            {
              id: 'configure-api-token',
              title: 'Configure DEEPINFRA_API_TOKEN environment variable',
              detail: 'Set the DEEPINFRA_API_TOKEN environment variable with a valid API token from DeepInfra',
            },
          ],
        },
        ctx,
      )

      expect(result.is_error).toBe(true)
      expect(result.output).toMatch(/provider.*configured/i)
      const { queue } = await readTasks({ tasksPath })
      expect(queue?.tasks[0]?.status).toBe('in_progress')
    } finally {
      if (previousHome === undefined) delete process.env.GUILDHALL_CONFIG_DIR
      else process.env.GUILDHALL_CONFIG_DIR = previousHome
      if (previousOpenAiKey === undefined) delete process.env.OPENAI_API_KEY
      else process.env.OPENAI_API_KEY = previousOpenAiKey
      if (previousOpenAiBaseUrl === undefined) delete process.env.OPENAI_BASE_URL
      else process.env.OPENAI_BASE_URL = previousOpenAiBaseUrl
      if (previousDeepinfraToken === undefined) delete process.env.DEEPINFRA_API_TOKEN
      else process.env.DEEPINFRA_API_TOKEN = previousDeepinfraToken
    }
  })

  it('raiseEscalationTool marks unknown task as error', async () => {
    const result = await raiseEscalationTool.execute(
      {
        tasksPath,
        taskId: 'nope',
        agentId: 'worker-agent',
        reason: 'decision_required',
        summary: 'x',
      },
      ctx,
    )
    expect(result.is_error).toBe(true)
  })

  it('resolveEscalationTool returns task to requested status', async () => {
    await raiseEscalationTool.execute(
      {
        tasksPath,
        taskId: 'task-001',
        agentId: 'worker-agent',
        reason: 'decision_required',
        summary: 'x',
      },
      ctx,
    )
    const result = await resolveEscalationTool.execute(
      {
        tasksPath,
        taskId: 'task-001',
        escalationId: 'esc-task-001-1',
        resolution: 'resolved',
        resolvedBy: 'human',
        nextStatus: 'in_progress',
      },
      ctx,
    )
    expect(result.is_error).toBe(false)
    const { queue } = await readTasks({ tasksPath })
    expect(queue?.tasks[0]?.status).toBe('in_progress')
  })
})
