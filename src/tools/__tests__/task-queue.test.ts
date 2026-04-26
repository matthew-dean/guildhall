import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {
  readTasks,
  updateTask,
  addTask,
  readTasksTool,
  updateTaskTool,
  addTaskTool,
} from '../task-queue.js'

// ---------------------------------------------------------------------------
// Tests for task queue tools — these are safety-critical (gate logic depends
// on them) so coverage must be thorough.
// ---------------------------------------------------------------------------

let tmpDir: string
let tasksPath: string

const seedQueue = {
  version: 1,
  lastUpdated: new Date().toISOString(),
  tasks: [
    {
      id: 'task-001',
      title: 'Test task',
      description: 'A test task',
      domain: 'looma',
      projectPath: '/projects/looma',
      status: 'exploring',
      priority: 'normal',
      dependsOn: [],
      outOfScope: [],
      acceptanceCriteria: [],
      notes: [],
      gateResults: [],
      reviewVerdicts: [],
    adjudications: [],
      escalations: [],
      revisionCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ],
}

const ctx = { cwd: '/tmp', metadata: {} }

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-test-'))
  tasksPath = path.join(tmpDir, 'TASKS.json')
  await fs.writeFile(tasksPath, JSON.stringify(seedQueue), 'utf-8')
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('readTasks', () => {
  it('reads and parses a valid task queue', async () => {
    const result = await readTasks({ tasksPath })
    expect(result.queue).not.toBeNull()
    expect(result.queue?.tasks).toHaveLength(1)
    expect(result.queue?.tasks[0]?.id).toBe('task-001')
  })

  it('returns null queue with error for missing file', async () => {
    const result = await readTasks({ tasksPath: path.join(tmpDir, 'nonexistent.json') })
    expect(result.queue).toBeNull()
    expect(result.error).toBeDefined()
  })

  it('returns null queue with error for malformed JSON', async () => {
    await fs.writeFile(tasksPath, '{ invalid json', 'utf-8')
    const result = await readTasks({ tasksPath })
    expect(result.queue).toBeNull()
    expect(result.error).toBeDefined()
  })
})

describe('updateTask', () => {
  it('updates task status', async () => {
    await updateTask({ tasksPath, taskId: 'task-001', status: 'spec_review' })
    const raw = JSON.parse(await fs.readFile(tasksPath, 'utf-8'))
    expect(raw.tasks[0].status).toBe('spec_review')
  })

  it('appends a note to a task', async () => {
    await updateTask({
      tasksPath,
      taskId: 'task-001',
      note: { agentId: 'spec-agent', role: 'spec', content: 'Spec complete.' },
    })
    const raw = JSON.parse(await fs.readFile(tasksPath, 'utf-8'))
    expect(raw.tasks[0].notes).toHaveLength(1)
    expect(raw.tasks[0].notes[0].content).toBe('Spec complete.')
    expect(raw.tasks[0].notes[0].timestamp).toBeDefined()
  })

  it('updates the task spec and acceptance criteria', async () => {
    await updateTask({
      tasksPath,
      taskId: 'task-001',
      spec: '## Summary\nBuild the thing.',
      acceptanceCriteria: [
        {
          id: 'ac-1',
          description: 'Build passes',
          verifiedBy: 'pnpm test',
        },
      ],
    })
    const raw = JSON.parse(await fs.readFile(tasksPath, 'utf-8'))
    expect(raw.tasks[0].spec).toContain('Build the thing')
    expect(raw.tasks[0].acceptanceCriteria).toEqual([
      {
        id: 'ac-1',
        description: 'Build passes',
        verifiedBy: 'automated',
        command: 'pnpm test',
        met: false,
      },
    ])
  })

  it('updates updatedAt timestamp', async () => {
    const before = seedQueue.tasks[0]!.updatedAt
    await new Promise((r) => setTimeout(r, 5))
    await updateTask({ tasksPath, taskId: 'task-001', status: 'ready' })
    const raw = JSON.parse(await fs.readFile(tasksPath, 'utf-8'))
    expect(raw.tasks[0].updatedAt).not.toBe(before)
  })

  it('returns error for unknown task id', async () => {
    const result = await updateTask({ tasksPath, taskId: 'nonexistent' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('nonexistent')
  })

  it('sets blockReason when blocking a task', async () => {
    await updateTask({
      tasksPath,
      taskId: 'task-001',
      status: 'blocked',
      blockReason: 'Spec ambiguous — awaiting human input',
    })
    const raw = JSON.parse(await fs.readFile(tasksPath, 'utf-8'))
    expect(raw.tasks[0].status).toBe('blocked')
    expect(raw.tasks[0].blockReason).toBe('Spec ambiguous — awaiting human input')
  })
})

describe('addTask', () => {
  it('adds a new task to the queue', async () => {
    const newTask = {
      id: 'task-002',
      title: 'New task',
      description: 'Another task',
      domain: 'knit',
      projectPath: '/projects/knit',
      status: 'exploring' as const,
      priority: 'high' as const,
      dependsOn: [],
      outOfScope: [],
      acceptanceCriteria: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    const result = await addTask({ tasksPath, task: newTask })
    expect(result.success).toBe(true)
    expect(result.taskId).toBe('task-002')

    const raw = JSON.parse(await fs.readFile(tasksPath, 'utf-8'))
    expect(raw.tasks).toHaveLength(2)
    expect(raw.tasks[1].id).toBe('task-002')
    expect(raw.tasks[1].notes).toEqual([])
    expect(raw.tasks[1].gateResults).toEqual([])
    expect(raw.tasks[1].revisionCount).toBe(0)
  })
})

describe('engine tool wrappers', () => {
  it('readTasksTool surfaces queue via metadata and JSON-stringified output', async () => {
    const result = await readTasksTool.execute({ tasksPath }, ctx)
    expect(result.is_error).toBe(false)
    expect(result.output).toContain('task-001')
    expect(result.metadata?.queue).toBeDefined()
  })

  it('readTasksTool marks missing file as error', async () => {
    const result = await readTasksTool.execute(
      { tasksPath: path.join(tmpDir, 'nope.json') },
      ctx,
    )
    expect(result.is_error).toBe(true)
  })

  it('updateTaskTool reports success', async () => {
    const result = await updateTaskTool.execute(
      { tasksPath, taskId: 'task-001', status: 'ready' },
      ctx,
    )
    expect(result.is_error).toBe(false)
    expect(result.metadata?.success).toBe(true)
  })

  it('addTaskTool adds via engine interface', async () => {
    const result = await addTaskTool.execute(
      {
        tasksPath,
        task: {
          id: 'task-003',
          title: 'Via engine',
          description: 'x',
          domain: 'knit',
          projectPath: '/x',
          status: 'exploring',
          priority: 'normal',
          dependsOn: [],
          outOfScope: [],
          acceptanceCriteria: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      },
      ctx,
    )
    expect(result.is_error).toBe(false)
    expect(result.metadata?.taskId).toBe('task-003')
  })
})
