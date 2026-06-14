import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
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
import { readTaskRuntimeStore, upsertTaskRuntimeState } from '@guildhall/sessions'
import type { Task } from '@guildhall/core'

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
    projectPath: '/projects/looma',
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
  await fs.writeFile(tasksPath, JSON.stringify(queue), 'utf-8')
}

async function readEffectiveTask(): Promise<Task> {
  const { queue } = await readTasks({ tasksPath })
  const task = queue?.tasks.find((candidate) => candidate.id === 'task-001')
  if (!task) throw new Error('task-001 not found')
  return await buildEffectiveTask(tmpDir, task) as unknown as Task
}

async function readRawQueue(): Promise<{ tasks: Array<Record<string, unknown>> }> {
  return JSON.parse(await fs.readFile(tasksPath, 'utf-8')) as { tasks: Array<Record<string, unknown>> }
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-esc-'))
  tasksPath = path.join(tmpDir, 'TASKS.json')
  progressPath = path.join(tmpDir, 'PROGRESS.md')
  await writeSeed([seedTask()])
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
    expect(raw.tasks[0]?.escalations).toEqual([])
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
    expect(task?.status).toBe('in_progress')
    expect(task?.assignedTo).toBe('worker-agent')
    expect(task?.blockReason).toBeUndefined()
    const raw = await readRawQueue()
    expect(raw.tasks[0]).not.toHaveProperty('escalations')
    const effective = await readEffectiveTask()
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
    expect(queue?.tasks[0]?.status).toBe('review')
    expect(queue?.tasks[0]?.assignedTo).toBe('reviewer-agent')
  })

  it('starts a fresh retry window when resolving max-revisions back to active work', async () => {
    await resolveEscalation({
      tasksPath,
      taskId: 'task-001',
      escalationId: 'esc-task-001-1',
      resolution: 'Clear setup blocker for retry-window test.',
      nextStatus: 'in_progress',
    })
    await writeSeed([
      seedTask({
        revisionCount: 4,
        escalations: [],
      }),
    ])
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
