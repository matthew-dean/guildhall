import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import yaml from 'js-yaml'
import { Orchestrator, type OrchestratorAgentSet } from '../orchestrator.js'
import type { ResolvedConfig } from '@guildhall/config'
import type { Task, TaskQueue, DesignSystem } from '@guildhall/core'

// ---------------------------------------------------------------------------
// Integration test: at `gate_check`, the orchestrator's guild deterministic
// pre-pass runs BEFORE the shell-gate LLM dispatch. A design system with a
// failing WCAG contrast pair should short-circuit to `in_progress` without
// the gate-checker agent being invoked.
// ---------------------------------------------------------------------------

let tmpDir: string
let memoryDir: string
let tasksPath: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guild-gate-test-'))
  memoryDir = path.join(tmpDir, 'memory')
  await fs.mkdir(memoryDir, { recursive: true })
  tasksPath = path.join(memoryDir, 'TASKS.json')
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

function baseConfig(): ResolvedConfig {
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
    },
    coordinators: [],
    maxRevisions: 3,
    heartbeatInterval: 5,
    ignore: [],
    lmStudioUrl: 'http://localhost:1234',
    servePort: 7842,
  }
}

function mkTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-001',
    title: 'Add ghost button',
    description: 'UI component work',
    domain: 'looma',
    projectPath: tmpDir,
    status: 'gate_check',
    priority: 'normal',
    acceptanceCriteria: [],
    outOfScope: [],
    dependsOn: [],
    notes: [],
    gateResults: [],
    reviewVerdicts: [],
    escalations: [],
    agentIssues: [],
    revisionCount: 0,
    remediationAttempts: 0,
    origination: 'human',
    createdAt: '2026-04-01T00:00:00Z',
    updatedAt: '2026-04-01T00:00:00Z',
    ...overrides,
  }
}

async function writeQueue(tasks: Task[]): Promise<void> {
  const queue: TaskQueue = {
    version: 1,
    lastUpdated: '2026-04-01T00:00:00Z',
    tasks,
  }
  await fs.writeFile(tasksPath, JSON.stringify(queue, null, 2), 'utf-8')
}

async function writeDesignSystem(ds: DesignSystem): Promise<void> {
  await fs.writeFile(
    path.join(memoryDir, 'design-system.yaml'),
    yaml.dump(ds),
    'utf-8',
  )
}

function stubAgent(name: string) {
  const calls: { prompt: string }[] = []
  return {
    name,
    calls,
    async generate(prompt: string) {
      calls.push({ prompt })
      return { text: 'ok' }
    },
  }
}

function agentSet(): OrchestratorAgentSet {
  return {
    spec: stubAgent('spec-agent'),
    worker: stubAgent('worker-agent'),
    reviewer: stubAgent('reviewer-agent'),
    gateChecker: stubAgent('gate-checker-agent'),
    coordinators: {},
  }
}

const failingDS: DesignSystem = {
  version: 1,
  revision: 1,
  tokens: {
    color: [
      // 3.68:1 ratio on white — fails AA normal (4.5 required).
      { name: 'text.body', value: '#878787' },
      { name: 'bg.surface', value: '#ffffff' },
    ],
    spacing: [],
    typography: [],
    radius: [],
    shadow: [],
  },
  primitives: [],
  interactions: { motionDurationsMs: [], hoverRules: [] },
  a11y: {
    minContrastRatio: 4.5,
    focusOutlineRequired: true,
    keyboardRules: [],
    reducedMotionRespected: true,
  },
  copyVoice: { tone: 'plain', bannedTerms: [], preferredTerms: [], examples: [] },
}

const passingDS: DesignSystem = {
  ...failingDS,
  tokens: {
    ...failingDS.tokens,
    color: [
      { name: 'text.body', value: '#111111' },
      { name: 'bg.surface', value: '#ffffff' },
    ],
  },
}

async function readQueue(): Promise<TaskQueue> {
  return JSON.parse(await fs.readFile(tasksPath, 'utf-8'))
}

describe('Orchestrator — guild-gate pre-pass at gate_check', () => {
  it('bounces a task with a failing contrast matrix to in_progress, without invoking the gate-checker agent', async () => {
    await writeDesignSystem(failingDS)
    const task = mkTask({ status: 'gate_check' })
    await writeQueue([task])
    const agents = agentSet()
    const orch = new Orchestrator({ config: baseConfig(), agents })

    const outcome = await orch.tick()
    expect(outcome.kind).not.toBe('idle')

    const q = await readQueue()
    const after = q.tasks[0]!
    expect(after.status).toBe('in_progress')
    expect(after.revisionCount).toBe(1)
    // The contrast gate landed on the task as a soft gate result.
    const soft = after.gateResults.filter((g) => g.type === 'soft')
    expect(soft.length).toBeGreaterThan(0)
    const contrastGate = soft.find((g) => g.gateId === 'a11y.contrast-matrix')
    expect(contrastGate).toBeDefined()
    expect(contrastGate!.passed).toBe(false)
    // The gate-checker agent never got called — guild gates short-circuited.
    expect((agents.gateChecker as ReturnType<typeof stubAgent>).calls).toHaveLength(0)
    // A note from guild-gate-runner is attached.
    const note = after.notes.find((n) => n.agentId === 'guild-gate-runner')
    expect(note).toBeDefined()
    expect(note!.content).toContain('a11y.contrast-matrix')
  })

  it('falls through to the gate-checker agent when all guild gates pass', async () => {
    await writeDesignSystem(passingDS)
    const task = mkTask({ status: 'gate_check' })
    await writeQueue([task])
    const agents = agentSet()
    const orch = new Orchestrator({ config: baseConfig(), agents })

    await orch.tick()

    // Guild gates passed → fell through to gate-checker agent.
    expect((agents.gateChecker as ReturnType<typeof stubAgent>).calls.length).toBeGreaterThan(0)
    const q = await readQueue()
    const after = q.tasks[0]!
    const soft = after.gateResults.filter((g) => g.type === 'soft')
    // Soft gates still recorded — they ran and passed.
    expect(soft.every((g) => g.passed)).toBe(true)
  })

  it('falls through when no design system exists (nothing to check)', async () => {
    // No design-system.yaml written.
    const task = mkTask({ status: 'gate_check' })
    await writeQueue([task])
    const agents = agentSet()
    const orch = new Orchestrator({ config: baseConfig(), agents })

    await orch.tick()

    expect((agents.gateChecker as ReturnType<typeof stubAgent>).calls.length).toBeGreaterThan(0)
    const q = await readQueue()
    const after = q.tasks[0]!
    // No guild soft gates recorded — none were applicable.
    expect(after.gateResults.filter((g) => g.type === 'soft')).toHaveLength(0)
  })
})
