import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {
  createExploringTask,
  approveSpec,
  resumeExploring,
} from '../intake.js'
import { TaskQueue } from '@guildhall/core'
import { raiseEscalation } from '@guildhall/tools'

// ---------------------------------------------------------------------------
// FR-12 exploratory task intake
//
// Verifies that a fuzzy ask becomes an `exploring` task with a seeded
// transcript, that approve-spec advances the task, and that a resume can
// resolve a blocking escalation and append a follow-up message.
// ---------------------------------------------------------------------------

let tmpDir: string
let memoryDir: string
let tasksPath: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-intake-'))
  memoryDir = path.join(tmpDir, 'memory')
  await fs.mkdir(memoryDir, { recursive: true })
  tasksPath = path.join(memoryDir, 'TASKS.json')
  // Bootstrap seeds TASKS.json as a bare `[]`, so test that path directly too.
  await fs.writeFile(tasksPath, '[]', 'utf-8')
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

async function readQueue(): Promise<TaskQueue> {
  const raw = await fs.readFile(tasksPath, 'utf-8')
  return TaskQueue.parse(JSON.parse(raw))
}

describe('createExploringTask', () => {
  it('creates a new task in exploring status and seeds the transcript', async () => {
    const result = await createExploringTask({
      memoryDir,
      ask: 'Add a ghost button variant',
      domain: 'looma',
      projectPath: '/projects/looma',
    })
    expect(result.taskId).toBe('task-001')
    expect(result.transcriptPath).toBe(
      path.join(memoryDir, 'exploring', 'task-001.md'),
    )

    const queue = await readQueue()
    expect(queue.tasks).toHaveLength(1)
    const task = queue.tasks[0]!
    expect(task.status).toBe('exploring')
    expect(task.description).toBe('Add a ghost button variant')
    expect(task.domain).toBe('looma')
    expect(task.title).toBe('Add a ghost button variant')

    const transcript = await fs.readFile(result.transcriptPath, 'utf-8')
    expect(transcript).toContain('Add a ghost button variant')
    expect(transcript).toContain('user')
  })

  it('handles a bare-array TASKS.json (bootstrap legacy format)', async () => {
    // Already seeded as '[]' in beforeEach — createExploringTask should cope.
    const result = await createExploringTask({
      memoryDir,
      ask: 'legacy format',
      domain: 'looma',
      projectPath: '/projects/looma',
    })
    expect(result.taskId).toBe('task-001')
    // After first intake, the file should be a full queue object
    const raw = JSON.parse(await fs.readFile(tasksPath, 'utf-8'))
    expect(raw.version).toBe(1)
    expect(raw.tasks).toHaveLength(1)
  })

  it('generates sequential ids when called multiple times', async () => {
    const a = await createExploringTask({
      memoryDir,
      ask: 'first',
      domain: 'looma',
      projectPath: '/x',
    })
    const b = await createExploringTask({
      memoryDir,
      ask: 'second',
      domain: 'looma',
      projectPath: '/x',
    })
    expect(a.taskId).toBe('task-001')
    expect(b.taskId).toBe('task-002')
  })

  it('respects an explicit task id override', async () => {
    const result = await createExploringTask({
      memoryDir,
      ask: 'x',
      domain: 'looma',
      projectPath: '/x',
      taskId: 'custom-id',
    })
    expect(result.taskId).toBe('custom-id')
  })

  it('truncates long asks into a reasonable title', async () => {
    const long = 'x'.repeat(200)
    await createExploringTask({ memoryDir, ask: long, domain: 'looma', projectPath: '/x' })
    const queue = await readQueue()
    expect(queue.tasks[0]!.title.length).toBeLessThanOrEqual(60)
    expect(queue.tasks[0]!.title).toMatch(/\.\.\.$/)
  })

  it('uses explicit title when provided', async () => {
    await createExploringTask({
      memoryDir,
      ask: 'some long ask that should not be used as the title',
      domain: 'looma',
      projectPath: '/x',
      title: 'Short Title',
    })
    const queue = await readQueue()
    expect(queue.tasks[0]!.title).toBe('Short Title')
  })

  it('rejects reusing an existing task id', async () => {
    await createExploringTask({
      memoryDir,
      ask: 'first',
      domain: 'looma',
      projectPath: '/x',
      taskId: 'same',
    })
    await expect(
      createExploringTask({
        memoryDir,
        ask: 'second',
        domain: 'looma',
        projectPath: '/x',
        taskId: 'same',
      }),
    ).rejects.toThrow(/already exists/)
  })
})

describe('approveSpec', () => {
  beforeEach(async () => {
    // Create and then attach a spec
    await createExploringTask({
      memoryDir,
      ask: 'Add ghost button',
      domain: 'looma',
      projectPath: '/projects/looma',
    })
    const queue = await readQueue()
    queue.tasks[0]!.spec = '## Summary\nAdd a ghost button variant.\n## AC\n1. Renders.'
    await fs.writeFile(tasksPath, JSON.stringify(queue, null, 2), 'utf-8')
  })

  it('transitions exploring → spec_review', async () => {
    const result = await approveSpec({ memoryDir, taskId: 'task-001' })
    expect(result.success).toBe(true)
    expect(result.newStatus).toBe('spec_review')
    const queue = await readQueue()
    expect(queue.tasks[0]!.status).toBe('spec_review')
  })

  it('records an approval note on the task when provided', async () => {
    await approveSpec({
      memoryDir,
      taskId: 'task-001',
      approvalNote: 'LGTM, ship it',
    })
    const queue = await readQueue()
    const notes = queue.tasks[0]!.notes
    expect(notes).toHaveLength(1)
    expect(notes[0]!.agentId).toBe('human')
    expect(notes[0]!.role).toBe('approver')
    expect(notes[0]!.content).toBe('LGTM, ship it')
  })

  it('appends an approval entry to the transcript', async () => {
    await approveSpec({
      memoryDir,
      taskId: 'task-001',
      approvalNote: 'ship it',
    })
    const transcript = await fs.readFile(
      path.join(memoryDir, 'exploring', 'task-001.md'),
      'utf-8',
    )
    expect(transcript).toContain('Spec approved')
    expect(transcript).toContain('ship it')
  })

  it('refuses to approve a task that has no spec', async () => {
    const queue = await readQueue()
    delete queue.tasks[0]!.spec
    await fs.writeFile(tasksPath, JSON.stringify(queue, null, 2), 'utf-8')
    const result = await approveSpec({ memoryDir, taskId: 'task-001' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('no spec')
  })

  it('refuses to approve a task not in exploring status', async () => {
    const queue = await readQueue()
    queue.tasks[0]!.status = 'in_progress'
    await fs.writeFile(tasksPath, JSON.stringify(queue, null, 2), 'utf-8')
    const result = await approveSpec({ memoryDir, taskId: 'task-001' })
    expect(result.success).toBe(false)
    expect(result.error).toContain("'in_progress'")
  })

  it('returns an error for unknown task id', async () => {
    const result = await approveSpec({ memoryDir, taskId: 'nope' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('nope')
  })
})

describe('resumeExploring', () => {
  beforeEach(async () => {
    await createExploringTask({
      memoryDir,
      ask: 'first ask',
      domain: 'looma',
      projectPath: '/x',
    })
  })

  it('appends a new user message to the transcript', async () => {
    const result = await resumeExploring({
      memoryDir,
      taskId: 'task-001',
      message: 'one more requirement',
    })
    expect(result.success).toBe(true)
    const transcript = await fs.readFile(
      path.join(memoryDir, 'exploring', 'task-001.md'),
      'utf-8',
    )
    expect(transcript).toContain('first ask')
    expect(transcript).toContain('one more requirement')
  })

  it('resolves a pending escalation and returns task to exploring', async () => {
    await raiseEscalation({
      tasksPath,
      taskId: 'task-001',
      agentId: 'spec-agent',
      reason: 'spec_ambiguous',
      summary: 'is this for mobile too?',
    })
    let queue = await readQueue()
    expect(queue.tasks[0]!.status).toBe('blocked')

    const result = await resumeExploring({
      memoryDir,
      taskId: 'task-001',
      resolveEscalationId: 'esc-task-001-1',
      resolution: 'yes, mobile too',
      message: 'also mobile, yes',
    })
    expect(result.success).toBe(true)

    queue = await readQueue()
    expect(queue.tasks[0]!.status).toBe('exploring')
    expect(queue.tasks[0]!.escalations[0]!.resolvedAt).toBeDefined()
    expect(queue.tasks[0]!.escalations[0]!.resolution).toBe('yes, mobile too')
  })

  it('returns error for unknown task id', async () => {
    const result = await resumeExploring({
      memoryDir,
      taskId: 'nope',
      message: 'x',
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('nope')
  })
})
