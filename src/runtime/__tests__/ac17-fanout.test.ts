/**
 * AC-17: with `concurrent_task_dispatch: fanout_N` + `worktree_isolation:
 * per_task` + `runtime_isolation: slot_allocation`, the orchestrator runs N
 * tasks in parallel worktrees and each worker receives unique
 * `GUILDHALL_SLOT` / `GUILDHALL_PORT_BASE` env vars, with merges proceeding
 * per `merge_policy`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { Orchestrator, type OrchestratorAgentSet } from '../orchestrator.js'
import { InMemoryGitDriver } from '../git-driver.js'
import type { ResolvedConfig } from '@guildhall/config'
import type { Task, TaskQueue } from '@guildhall/core'
import {
  AGENT_SETTINGS_FILENAME,
  makeDefaultSettings,
  saveLeverSettings,
} from '@guildhall/levers'

let tmpDir: string
let memoryDir: string
let tasksPath: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ac17-'))
  memoryDir = path.join(tmpDir, 'memory')
  await fs.mkdir(memoryDir, { recursive: true })
  tasksPath = path.join(memoryDir, 'TASKS.json')
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

function config(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    workspaceId: 'ws',
    workspaceName: 'AC-17',
    workspacePath: tmpDir,
    projectPath: tmpDir,
    memoryDir,
    models: { spec: 'm', coordinator: 'm', worker: 'm', reviewer: 'm', gateChecker: 'm' },
    coordinators: [],
    maxRevisions: 3,
    heartbeatInterval: 5,
    ignore: [],
    lmStudioUrl: 'http://localhost:1234',
    servePort: 7842,
    ...overrides,
  }
}

function mkTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't',
    title: 't',
    description: '',
    domain: 'core',
    projectPath: tmpDir,
    status: 'in_progress',
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
    createdAt: '2026-04-22T00:00:00.000Z',
    updatedAt: '2026-04-22T00:00:00.000Z',
    ...overrides,
  }
}

async function seedQueue(tasks: Task[]): Promise<void> {
  const queue: TaskQueue = {
    version: 1,
    lastUpdated: '2026-04-22T00:00:00.000Z',
    tasks,
  }
  await fs.writeFile(tasksPath, JSON.stringify(queue, null, 2), 'utf-8')
}

async function configureLevers(): Promise<void> {
  const settings = makeDefaultSettings(new Date('2026-04-22T00:00:00Z'))
  settings.project.concurrent_task_dispatch = {
    position: { kind: 'fanout', n: 2 },
    rationale: 'AC-17 test',
    setAt: '2026-04-22T00:00:00.000Z',
    setBy: 'system-default',
  }
  settings.project.worktree_isolation = {
    position: 'per_task',
    rationale: 'AC-17 test',
    setAt: '2026-04-22T00:00:00.000Z',
    setBy: 'system-default',
  }
  settings.project.runtime_isolation = {
    position: 'slot_allocation',
    rationale: 'AC-17 test',
    setAt: '2026-04-22T00:00:00.000Z',
    setBy: 'system-default',
  }
  settings.project.merge_policy = {
    position: 'ff_only_with_push',
    rationale: 'AC-17 test',
    setAt: '2026-04-22T00:00:00.000Z',
    setBy: 'system-default',
  }
  await saveLeverSettings({
    path: path.join(memoryDir, AGENT_SETTINGS_FILENAME),
    settings,
  })
}

interface SpyAgent {
  name: string
  calls: { prompt: string; taskId: string | undefined }[]
  generate(prompt: string): Promise<{ text: string }>
}

/**
 * Worker stub that marks the task referenced in its prompt as `done`. Writes
 * route through the orchestrator's `updateQueueAtomically` so concurrent
 * fanout dispatches and the post-generate merge-dispatcher are globally
 * serialized (in prod this is a file lock; here it's the orchestrator's
 * queueWriteChain).
 */
function makeWorkerAgent(getOrch: () => Orchestrator): SpyAgent {
  const calls: { prompt: string; taskId: string | undefined }[] = []
  return {
    name: 'worker-agent',
    calls,
    async generate(prompt: string) {
      const taskIdMatch = prompt.match(/## Current Task:\s+(\S+)/)
      const taskId = taskIdMatch?.[1]
      calls.push({ prompt, taskId })
      if (!taskId) return { text: 'no task id in prompt' }
      await getOrch().updateQueueAtomically((queue) => {
        const t = queue.tasks.find((x) => x.id === taskId)
        if (t && t.status === 'in_progress') {
          t.status = 'done'
          t.updatedAt = '2026-04-22T00:00:01.000Z'
        }
        queue.lastUpdated = '2026-04-22T00:00:01.000Z'
      })
      return { text: 'done' }
    },
  }
}

function agentSet(worker: SpyAgent): OrchestratorAgentSet {
  const stub = (name: string): SpyAgent => ({
    name,
    calls: [],
    async generate() {
      return { text: 'ok' }
    },
  })
  return {
    spec: stub('spec-agent'),
    worker,
    reviewer: stub('reviewer-agent'),
    gateChecker: stub('gate-checker-agent'),
    coordinators: {},
  }
}

describe('AC-17: fanout_2 + per_task + slot_allocation + ff_only_with_push', () => {
  it('runs two tasks in parallel with unique slots, per-task worktrees, and push merges', async () => {
    await configureLevers()
    await seedQueue([
      mkTask({ id: 'task-a' }),
      mkTask({ id: 'task-b' }),
    ])

    const gitDriver = new InMemoryGitDriver({ currentBranch: 'main' })
    let orchRef: Orchestrator | null = null
    const worker = makeWorkerAgent(() => {
      if (!orchRef) throw new Error('orchestrator not initialized')
      return orchRef
    })
    const orch = new Orchestrator({
      config: config(),
      agents: agentSet(worker),
      gitDriver,
    })
    orchRef = orch

    const outcome = await orch.tick()

    expect(outcome.kind).toBe('batch')
    if (outcome.kind !== 'batch') return
    expect(outcome.outcomes).toHaveLength(2)

    // Both tasks ran and transitioned to done → mergeRecord populated.
    const dispatchedIds = new Set<string>()
    for (const sub of outcome.outcomes) {
      expect(sub.kind).toBe('processed')
      if (sub.kind === 'processed') {
        dispatchedIds.add(sub.taskId)
        expect(sub.agent).toBe('worker-agent')
        expect(sub.afterStatus).toBe('done')
      }
    }
    expect(dispatchedIds).toEqual(new Set(['task-a', 'task-b']))

    // FR-24: two worktrees were created, one per task.
    expect(gitDriver.state.createdWorktrees).toHaveLength(2)
    const branchNames = gitDriver.state.createdWorktrees.map((c) => c.branch).sort()
    expect(branchNames).toEqual([
      'guildhall/task-task-a',
      'guildhall/task-task-b',
    ])

    // FR-25: both tasks got a ff_only_with_push merge → push.
    expect(gitDriver.state.merges).toHaveLength(2)
    expect(gitDriver.state.pushes).toHaveLength(2)

    // Each worker call saw a unique `GUILDHALL_SLOT` / `GUILDHALL_PORT_BASE`
    // rule. The slot-allocator prompt rule format is deterministic; we
    // extract the slot index from it.
    expect(worker.calls).toHaveLength(2)
    const slotIndexes = worker.calls
      .map((c) => c.prompt.match(/Your worker slot is \*\*(\d+)\*\*/)?.[1])
      .filter((s): s is string => s !== undefined)
    expect(slotIndexes).toHaveLength(2)
    expect(new Set(slotIndexes).size).toBe(2)

    // Each prompt also references a distinct port base (the GUILDHALL_PORT_BASE
    // system-prompt hint matches `Port base is **N**.`).
    const portBases = worker.calls
      .map((c) => c.prompt.match(/Port base is \*\*(\d+)\*\*/)?.[1])
      .filter((s): s is string => s !== undefined)
    expect(portBases).toHaveLength(2)
    expect(new Set(portBases).size).toBe(2)

    // Task metadata is persisted.
    const finalRaw = await fs.readFile(tasksPath, 'utf-8')
    const finalQueue = JSON.parse(finalRaw) as TaskQueue
    const a = finalQueue.tasks.find((t) => t.id === 'task-a')!
    const b = finalQueue.tasks.find((t) => t.id === 'task-b')!
    expect(a.worktreePath).toBeDefined()
    expect(a.branchName).toBe('guildhall/task-task-a')
    expect(a.baseBranch).toBe('main')
    expect(a.mergeRecord?.result).toBe('pushed')
    expect(b.worktreePath).toBeDefined()
    expect(b.mergeRecord?.result).toBe('pushed')
    expect(a.worktreePath).not.toBe(b.worktreePath)

    // FR-24: worktrees cleaned up on done.
    expect(gitDriver.state.removedWorktrees.sort()).toEqual(
      [a.worktreePath!, b.worktreePath!].sort(),
    )
  })
})
