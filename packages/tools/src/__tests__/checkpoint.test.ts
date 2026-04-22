import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {
  writeCheckpoint,
  writeCheckpointTool,
  readCheckpoint,
  clearCheckpoint,
  checkpointPath,
  findReclaimTasks,
  loadReclaimCandidates,
  RECLAIM_AUTO_ESCALATE_MS,
} from '../checkpoint.js'
import { Checkpoint, type Task } from '@guildhall/core'

// ---------------------------------------------------------------------------
// FR-33 crash-safe checkpointing tests.
//
// Two invariants this file pins:
//   1. Checkpoint writes are atomic — a crash mid-write leaves either the
//      old checkpoint or no stray partial file the reader chokes on.
//   2. Reclaim detection identifies tasks whose assigned agent is no longer
//      live AND ignores queue/terminal states. This is the input to FR-32.
// The tests are policy tests: they do not spin up an orchestrator or an
// engine, they exercise the pure functions directly.
// ---------------------------------------------------------------------------

let tmpDir: string
let memoryDir: string
let tasksPath: string

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
  const queue = { version: 1, lastUpdated: new Date().toISOString(), tasks }
  await fs.writeFile(tasksPath, JSON.stringify(queue), 'utf-8')
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-checkpoint-'))
  memoryDir = path.join(tmpDir, 'memory')
  tasksPath = path.join(tmpDir, 'TASKS.json')
  await fs.mkdir(memoryDir, { recursive: true })
  await writeSeed([seedTask()])
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('writeCheckpoint', () => {
  it('creates the checkpoint file at <memoryDir>/tasks/<id>/checkpoint.json', async () => {
    const result = await writeCheckpoint({
      tasksPath,
      memoryDir,
      taskId: 'task-001',
      agentId: 'worker-1',
      intent: 'About to modify src/foo.ts',
      nextPlannedAction: 'Run the unit tests',
    })
    expect(result.success).toBe(true)
    expect(result.step).toBe(1)
    expect(result.path).toBe(
      path.join(memoryDir, 'tasks', 'task-001', 'checkpoint.json'),
    )
    const raw = await fs.readFile(result.path!, 'utf-8')
    const parsed = Checkpoint.parse(JSON.parse(raw))
    expect(parsed.taskId).toBe('task-001')
    expect(parsed.agentId).toBe('worker-1')
    expect(parsed.step).toBe(1)
    expect(parsed.intent).toBe('About to modify src/foo.ts')
    expect(parsed.nextPlannedAction).toBe('Run the unit tests')
    expect(parsed.filesTouched).toEqual([])
    expect(parsed.writtenAt).toMatch(/^\d{4}-/)
  })

  it('auto-increments the step counter on subsequent writes', async () => {
    const r1 = await writeCheckpoint({
      tasksPath,
      memoryDir,
      taskId: 'task-001',
      agentId: 'worker-1',
      intent: 'step 1',
      nextPlannedAction: 'next',
    })
    expect(r1.step).toBe(1)

    const r2 = await writeCheckpoint({
      tasksPath,
      memoryDir,
      taskId: 'task-001',
      agentId: 'worker-1',
      intent: 'step 2',
      nextPlannedAction: 'next',
    })
    expect(r2.step).toBe(2)

    const r3 = await writeCheckpoint({
      tasksPath,
      memoryDir,
      taskId: 'task-001',
      agentId: 'worker-1',
      intent: 'step 3',
      nextPlannedAction: 'next',
    })
    expect(r3.step).toBe(3)
  })

  it('honors an explicit step override (used by resume flows)', async () => {
    const result = await writeCheckpoint({
      tasksPath,
      memoryDir,
      taskId: 'task-001',
      agentId: 'worker-1',
      intent: 'resumed at step 7',
      nextPlannedAction: 'continue where we left off',
      step: 7,
    })
    expect(result.success).toBe(true)
    const cp = await readCheckpoint(memoryDir, 'task-001')
    expect(cp!.step).toBe(7)
  })

  it('overwrites the previous checkpoint (single snapshot per task)', async () => {
    await writeCheckpoint({
      tasksPath,
      memoryDir,
      taskId: 'task-001',
      agentId: 'worker-1',
      intent: 'step 1',
      nextPlannedAction: 'first',
    })
    await writeCheckpoint({
      tasksPath,
      memoryDir,
      taskId: 'task-001',
      agentId: 'worker-1',
      intent: 'step 2',
      nextPlannedAction: 'second',
    })
    const cp = await readCheckpoint(memoryDir, 'task-001')
    expect(cp!.intent).toBe('step 2')
    expect(cp!.nextPlannedAction).toBe('second')
    expect(cp!.step).toBe(2)
  })

  it('records filesTouched, lastCommittedSha, engineSessionId when provided', async () => {
    await writeCheckpoint({
      tasksPath,
      memoryDir,
      taskId: 'task-001',
      agentId: 'worker-1',
      intent: 'staged changes',
      nextPlannedAction: 'run tests',
      filesTouched: ['src/a.ts', 'src/b.ts'],
      lastCommittedSha: 'abc123',
      engineSessionId: 'sess-42',
    })
    const cp = await readCheckpoint(memoryDir, 'task-001')
    expect(cp!.filesTouched).toEqual(['src/a.ts', 'src/b.ts'])
    expect(cp!.lastCommittedSha).toBe('abc123')
    expect(cp!.engineSessionId).toBe('sess-42')
  })

  it('fails with a structured error if the task id does not exist', async () => {
    const result = await writeCheckpoint({
      tasksPath,
      memoryDir,
      taskId: 'nope',
      agentId: 'worker-1',
      intent: 'x',
      nextPlannedAction: 'x',
    })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/Task nope not found/)
  })

  it('is atomic — no .tmp sibling survives a successful write', async () => {
    await writeCheckpoint({
      tasksPath,
      memoryDir,
      taskId: 'task-001',
      agentId: 'worker-1',
      intent: 'x',
      nextPlannedAction: 'x',
    })
    const dir = path.join(memoryDir, 'tasks', 'task-001')
    const entries = await fs.readdir(dir)
    expect(entries).toEqual(['checkpoint.json'])
  })
})

describe('writeCheckpointTool wrapper', () => {
  it('returns a structured tool result on success', async () => {
    const ctx = { cwd: '/tmp', metadata: {} }
    const result = await writeCheckpointTool.execute(
      {
        tasksPath,
        memoryDir,
        taskId: 'task-001',
        agentId: 'worker-1',
        intent: 'writing checkpoint via tool',
        nextPlannedAction: 'continue',
        filesTouched: [],
      },
      ctx as never,
    )
    expect(result.is_error).toBe(false)
    expect(result.output).toMatch(/Wrote checkpoint step 1 for task-001/)
  })

  it('surfaces errors as is_error:true', async () => {
    const ctx = { cwd: '/tmp', metadata: {} }
    const result = await writeCheckpointTool.execute(
      {
        tasksPath,
        memoryDir,
        taskId: 'missing-task',
        agentId: 'worker-1',
        intent: 'x',
        nextPlannedAction: 'x',
        filesTouched: [],
      },
      ctx as never,
    )
    expect(result.is_error).toBe(true)
    expect(result.output).toMatch(/Error writing checkpoint/)
  })
})

describe('readCheckpoint / clearCheckpoint', () => {
  it('returns null when no checkpoint exists', async () => {
    expect(await readCheckpoint(memoryDir, 'task-001')).toBeNull()
  })

  it('clearCheckpoint removes the file and is idempotent', async () => {
    await writeCheckpoint({
      tasksPath,
      memoryDir,
      taskId: 'task-001',
      agentId: 'worker-1',
      intent: 'x',
      nextPlannedAction: 'x',
    })
    await clearCheckpoint(memoryDir, 'task-001')
    await clearCheckpoint(memoryDir, 'task-001') // no-op
    expect(await readCheckpoint(memoryDir, 'task-001')).toBeNull()
  })

  it('clearCheckpoint also removes a stray .tmp file', async () => {
    const file = checkpointPath(memoryDir, 'task-001')
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(`${file}.tmp`, 'half-written', 'utf-8')
    await clearCheckpoint(memoryDir, 'task-001')
    await expect(fs.access(`${file}.tmp`)).rejects.toThrow()
  })
})

describe('findReclaimTasks', () => {
  it('flags in_progress tasks whose assignee is not in the live set', () => {
    const queue = {
      tasks: [
        seedTask({ id: 't1', status: 'in_progress', assignedTo: 'w1' }),
        seedTask({ id: 't2', status: 'in_progress', assignedTo: 'w2' }),
      ],
    }
    const reclaim = findReclaimTasks(queue, ['w1'])
    expect(reclaim.map((t) => t.id)).toEqual(['t2'])
  })

  it('flags in_progress tasks with no assignee at all', () => {
    const queue = { tasks: [seedTask({ id: 't1', status: 'in_progress' })] }
    const reclaim = findReclaimTasks(queue, [])
    expect(reclaim.map((t) => t.id)).toEqual(['t1'])
  })

  it('skips terminal statuses (done / shelved / blocked)', () => {
    const queue = {
      tasks: [
        seedTask({ id: 't1', status: 'done' }),
        seedTask({ id: 't2', status: 'shelved' }),
        seedTask({ id: 't3', status: 'blocked' }),
      ],
    }
    expect(findReclaimTasks(queue, [])).toEqual([])
  })

  it('skips queue statuses (ready / proposed / exploring / spec_review)', () => {
    // These don't expect an agent to be running; they're waiting to be picked
    // up. Reclaim-candidate only applies to statuses where an agent IS
    // expected to be working: in_progress / review / gate_check.
    const queue = {
      tasks: [
        seedTask({ id: 't1', status: 'ready' }),
        seedTask({ id: 't2', status: 'proposed' }),
        seedTask({ id: 't3', status: 'exploring' }),
        seedTask({ id: 't4', status: 'spec_review' }),
      ],
    }
    expect(findReclaimTasks(queue, [])).toEqual([])
  })

  it('flags review and gate_check tasks too', () => {
    const queue = {
      tasks: [
        seedTask({ id: 't1', status: 'review', assignedTo: 'rev-1' }),
        seedTask({ id: 't2', status: 'gate_check', assignedTo: 'gate-1' }),
      ],
    }
    const reclaim = findReclaimTasks(queue, [])
    expect(reclaim.map((t) => t.id).sort()).toEqual(['t1', 't2'])
  })

  it('does NOT flag a task whose assignee is still live', () => {
    const queue = {
      tasks: [seedTask({ id: 't1', status: 'in_progress', assignedTo: 'w1' })],
    }
    expect(findReclaimTasks(queue, ['w1'])).toEqual([])
  })
})

describe('loadReclaimCandidates', () => {
  it('loads the checkpoint for each candidate when present', async () => {
    await writeCheckpoint({
      tasksPath,
      memoryDir,
      taskId: 'task-001',
      agentId: 'worker-1',
      intent: 'halfway',
      nextPlannedAction: 'continue',
    })
    const candidates = await loadReclaimCandidates(memoryDir, [seedTask()])
    expect(candidates).toHaveLength(1)
    expect(candidates[0]!.checkpoint).not.toBeNull()
    expect(candidates[0]!.checkpoint!.intent).toBe('halfway')
  })

  it('returns checkpoint:null when the task never wrote one', async () => {
    const candidates = await loadReclaimCandidates(memoryDir, [seedTask()])
    expect(candidates[0]!.checkpoint).toBeNull()
    expect(candidates[0]!.ageMs).toBeNull()
    expect(candidates[0]!.autoEscalate).toBe(false)
  })

  it('marks autoEscalate=true for checkpoints older than 24h', async () => {
    // Write a checkpoint, then manually rewind its writtenAt into the past.
    await writeCheckpoint({
      tasksPath,
      memoryDir,
      taskId: 'task-001',
      agentId: 'worker-1',
      intent: 'old',
      nextPlannedAction: 'x',
    })
    const file = checkpointPath(memoryDir, 'task-001')
    const raw = JSON.parse(await fs.readFile(file, 'utf-8')) as Record<
      string,
      unknown
    >
    const ancient = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
    raw['writtenAt'] = ancient
    await fs.writeFile(file, JSON.stringify(raw), 'utf-8')

    const [candidate] = await loadReclaimCandidates(memoryDir, [seedTask()])
    expect(candidate!.autoEscalate).toBe(true)
    expect(candidate!.ageMs).toBeGreaterThan(RECLAIM_AUTO_ESCALATE_MS)
  })

  it('does NOT auto-escalate a fresh checkpoint', async () => {
    await writeCheckpoint({
      tasksPath,
      memoryDir,
      taskId: 'task-001',
      agentId: 'worker-1',
      intent: 'fresh',
      nextPlannedAction: 'x',
    })
    const [candidate] = await loadReclaimCandidates(memoryDir, [seedTask()])
    expect(candidate!.autoEscalate).toBe(false)
  })
})
