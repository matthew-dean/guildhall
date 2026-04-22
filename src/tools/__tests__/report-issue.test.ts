import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {
  reportIssue,
  resolveIssue,
  reportIssueTool,
  openIssues,
  pendingBroadcastIssues,
} from '../report-issue.js'
import { readTasks } from '../task-queue.js'
import type { Task } from '@guildhall/core'

// ---------------------------------------------------------------------------
// FR-31 agent-issue channel tests.
//
// Issues differ from escalations (FR-10) in a subtle but load-bearing way:
// they do NOT change the task's status. The agent keeps running; the
// coordinator decides remediation on its next tick. These tests pin that
// invariant so a future refactor cannot accidentally flip the task to
// blocked when an issue is raised.
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
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-issue-'))
  tasksPath = path.join(tmpDir, 'TASKS.json')
  progressPath = path.join(tmpDir, 'PROGRESS.md')
  await writeSeed([seedTask()])
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('reportIssue', () => {
  it('appends an issue with a stable id', async () => {
    const result = await reportIssue({
      tasksPath,
      taskId: 'task-001',
      agentId: 'worker-agent',
      code: 'stuck',
      severity: 'warn',
      detail: 'Tried three variants of the build command; all timed out',
    })
    expect(result.success).toBe(true)
    expect(result.issueId).toBe('iss-task-001-1')
  })

  it('keeps the task on its current status (issues are NOT terminal)', async () => {
    await reportIssue({
      tasksPath,
      taskId: 'task-001',
      agentId: 'worker-agent',
      code: 'context_exhausted',
      severity: 'critical',
      detail: 'Spec is too thin to proceed without more context',
    })

    const { queue } = await readTasks({ tasksPath })
    const t = queue!.tasks[0]!
    // FR-31 invariant: status unchanged
    expect(t.status).toBe('in_progress')
    // blockReason must NOT be set (that's the escalation protocol's contract)
    expect(t.blockReason).toBeUndefined()
    // The issue is recorded with broadcast=false (orchestrator hasn't seen it yet)
    expect(t.agentIssues).toHaveLength(1)
    expect(t.agentIssues[0]!.broadcast).toBe(false)
    expect(t.agentIssues[0]!.resolvedAt).toBeUndefined()
  })

  it('records all payload fields verbatim', async () => {
    await reportIssue({
      tasksPath,
      taskId: 'task-001',
      agentId: 'worker-agent',
      code: 'dependency_unreachable',
      severity: 'critical',
      detail: 'upstream ci.example.com returns 502',
      suggestedAction: 'retry after 5m or shelve until ops confirms',
    })
    const { queue } = await readTasks({ tasksPath })
    const iss = queue!.tasks[0]!.agentIssues[0]!
    expect(iss.code).toBe('dependency_unreachable')
    expect(iss.severity).toBe('critical')
    expect(iss.detail).toBe('upstream ci.example.com returns 502')
    expect(iss.suggestedAction).toBe('retry after 5m or shelve until ops confirms')
    expect(iss.agentId).toBe('worker-agent')
  })

  it('defaults severity to warn when omitted', async () => {
    await reportIssue({
      tasksPath,
      taskId: 'task-001',
      agentId: 'worker-agent',
      code: 'unknown',
      detail: 'Something off, not sure what',
    })
    const { queue } = await readTasks({ tasksPath })
    expect(queue!.tasks[0]!.agentIssues[0]!.severity).toBe('warn')
  })

  it('stamps successive issues with monotonic ids', async () => {
    await reportIssue({
      tasksPath,
      taskId: 'task-001',
      agentId: 'w',
      code: 'stuck',
      detail: 'first',
    })
    await reportIssue({
      tasksPath,
      taskId: 'task-001',
      agentId: 'w',
      code: 'stuck',
      detail: 'still first',
    })
    const { queue } = await readTasks({ tasksPath })
    const ids = queue!.tasks[0]!.agentIssues.map((i) => i.id)
    expect(ids).toEqual(['iss-task-001-1', 'iss-task-001-2'])
  })

  it('writes a heartbeat-type PROGRESS entry when progressPath is provided', async () => {
    await reportIssue({
      tasksPath,
      progressPath,
      taskId: 'task-001',
      agentId: 'worker-agent',
      code: 'spec_incoherent',
      severity: 'warn',
      detail: 'AC-3 contradicts the summary',
    })
    const progress = await fs.readFile(progressPath, 'utf-8')
    expect(progress).toMatch(/ISSUE \[warn\/spec_incoherent\]/)
    expect(progress).toMatch(/AC-3 contradicts the summary/)
    // heartbeat, NOT blocked — FR-31 distinction
    expect(progress).toMatch(/HEARTBEAT —/)
  })

  it('returns an error (not a throw) when the task id does not exist', async () => {
    const result = await reportIssue({
      tasksPath,
      taskId: 'does-not-exist',
      agentId: 'worker-agent',
      code: 'stuck',
      detail: 'x',
    })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/not found/)
  })
})

describe('resolveIssue', () => {
  it('marks an open issue resolved with a resolution record', async () => {
    await reportIssue({
      tasksPath,
      taskId: 'task-001',
      agentId: 'w',
      code: 'stuck',
      detail: 'spinning',
    })
    const res = await resolveIssue({
      tasksPath,
      taskId: 'task-001',
      issueId: 'iss-task-001-1',
      resolution: 'coordinator decided: replace_with_different_agent',
      resolvedBy: 'coordinator:looma',
    })
    expect(res.success).toBe(true)
    const { queue } = await readTasks({ tasksPath })
    const iss = queue!.tasks[0]!.agentIssues[0]!
    expect(iss.resolvedAt).toBeDefined()
    expect(iss.resolution).toMatch(/replace_with_different_agent/)
    expect(iss.resolvedBy).toBe('coordinator:looma')
  })

  it('refuses to resolve an already-resolved issue', async () => {
    await reportIssue({
      tasksPath,
      taskId: 'task-001',
      agentId: 'w',
      code: 'stuck',
      detail: 'spinning',
    })
    await resolveIssue({
      tasksPath,
      taskId: 'task-001',
      issueId: 'iss-task-001-1',
      resolution: 'first',
      resolvedBy: 'coordinator:looma',
    })
    const res = await resolveIssue({
      tasksPath,
      taskId: 'task-001',
      issueId: 'iss-task-001-1',
      resolution: 'second',
      resolvedBy: 'coordinator:looma',
    })
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/already resolved/)
  })

  it('errors cleanly on unknown issueId', async () => {
    const res = await resolveIssue({
      tasksPath,
      taskId: 'task-001',
      issueId: 'iss-task-001-99',
      resolution: 'x',
      resolvedBy: 'c',
    })
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/not found/)
  })
})

describe('openIssues / pendingBroadcastIssues helpers', () => {
  it('openIssues returns only unresolved issues', async () => {
    await reportIssue({
      tasksPath,
      taskId: 'task-001',
      agentId: 'w',
      code: 'stuck',
      detail: 'one',
    })
    await reportIssue({
      tasksPath,
      taskId: 'task-001',
      agentId: 'w',
      code: 'tool_unavailable',
      detail: 'two',
    })
    await resolveIssue({
      tasksPath,
      taskId: 'task-001',
      issueId: 'iss-task-001-1',
      resolution: 'handled',
      resolvedBy: 'c',
    })
    const { queue } = await readTasks({ tasksPath })
    const t = queue!.tasks[0]!
    expect(openIssues(t)).toHaveLength(1)
    expect(openIssues(t)[0]!.id).toBe('iss-task-001-2')
  })

  it('pendingBroadcastIssues filters both broadcast and resolved', async () => {
    await reportIssue({
      tasksPath,
      taskId: 'task-001',
      agentId: 'w',
      code: 'stuck',
      detail: 'one',
    })
    await reportIssue({
      tasksPath,
      taskId: 'task-001',
      agentId: 'w',
      code: 'stuck',
      detail: 'two',
    })
    const { queue } = await readTasks({ tasksPath })
    // Manually mark the first as broadcast; second remains pending.
    queue!.tasks[0]!.agentIssues[0]!.broadcast = true
    await fs.writeFile(tasksPath, JSON.stringify(queue), 'utf-8')
    const fresh = await readTasks({ tasksPath })
    const t = fresh.queue!.tasks[0]!
    const pending = pendingBroadcastIssues(t)
    expect(pending).toHaveLength(1)
    expect(pending[0]!.id).toBe('iss-task-001-2')
  })
})

describe('reportIssueTool (tool wrapper)', () => {
  it('exposes the expected tool metadata', () => {
    expect(reportIssueTool.name).toBe('report-issue')
    expect(reportIssueTool.description).toMatch(/without halting/i)
  })

  const ctx = { cwd: '/tmp', metadata: {} }

  it('returns is_error=false on success', async () => {
    const r = await reportIssueTool.execute(
      {
        tasksPath,
        taskId: 'task-001',
        agentId: 'w',
        code: 'stuck',
        severity: 'warn',
        detail: 'x',
      },
      ctx,
    )
    expect(r.is_error).toBe(false)
    expect(r.output).toMatch(/Reported issue iss-task-001-1/)
  })

  it('returns is_error=true on failure', async () => {
    const r = await reportIssueTool.execute(
      {
        tasksPath,
        taskId: 'does-not-exist',
        agentId: 'w',
        code: 'stuck',
        severity: 'warn',
        detail: 'x',
      },
      ctx,
    )
    expect(r.is_error).toBe(true)
  })
})
