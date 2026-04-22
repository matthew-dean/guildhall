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
} from '../escalation.js'
import { readTasks } from '../task-queue.js'
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

    const { queue } = await readTasks({ tasksPath })
    expect(queue?.tasks[0]?.escalations).toHaveLength(1)
    expect(queue?.tasks[0]?.escalations[0]?.id).toBe('esc-task-001-1')
    expect(queue?.tasks[0]?.escalations[0]?.reason).toBe('human_judgment_required')
    expect(queue?.tasks[0]?.escalations[0]?.raisedAt).toBeDefined()
    expect(queue?.tasks[0]?.escalations[0]?.resolvedAt).toBeUndefined()
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
    const { queue } = await readTasks({ tasksPath })
    expect(queue?.tasks[0]?.escalations).toHaveLength(2)
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
    const { queue } = await readTasks({ tasksPath })
    expect(queue?.tasks[0]?.escalations[0]?.details).toContain('Stack: tsc')
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
    expect(task?.blockReason).toBeUndefined()
    expect(task?.escalations[0]?.resolvedAt).toBeDefined()
    expect(task?.escalations[0]?.resolution).toBe('Use library A')
    expect(task?.escalations[0]?.resolvedBy).toBe('human')
  })

  it('defaults resolvedBy to "human"', async () => {
    await resolveEscalation({
      tasksPath,
      taskId: 'task-001',
      escalationId: 'esc-task-001-1',
      resolution: 'r',
      nextStatus: 'in_progress',
    })
    const { queue } = await readTasks({ tasksPath })
    expect(queue?.tasks[0]?.escalations[0]?.resolvedBy).toBe('human')
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
    const { queue } = await readTasks({ tasksPath })
    expect(queue?.tasks[0]?.escalations[0]?.resolvedBy).toBe('coordinator-looma')
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
    expect(task?.escalations[0]?.resolvedAt).toBeDefined()
    expect(task?.escalations[1]?.resolvedAt).toBeUndefined()
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
  it('returns false for a task with no escalations', () => {
    expect(hasOpenEscalation(seedTask())).toBe(false)
  })

  it('returns true when at least one escalation is unresolved', () => {
    const task = seedTask({
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
