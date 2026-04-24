import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {
  Orchestrator,
  type OrchestratorAgentSet,
  type ReviewerFanoutRunner,
} from '../orchestrator.js'
import type { ResolvedConfig } from '@guildhall/config'
import type { Task, TaskQueue } from '@guildhall/core'

// ---------------------------------------------------------------------------
// Sequential agent handoff within one task. See
// docs/disagreement-and-handoff.md §2.
// ---------------------------------------------------------------------------

let tmpDir: string
let memoryDir: string
let tasksPath: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'handoff-test-'))
  memoryDir = path.join(tmpDir, 'memory')
  await fs.mkdir(memoryDir, { recursive: true })
  tasksPath = path.join(memoryDir, 'TASKS.json')
})
afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

function baseConfig(): ResolvedConfig {
  return {
    workspaceId: 'ws',
    workspaceName: 'ws',
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
    maxRevisions: 5,
    heartbeatInterval: 5,
    ignore: [],
    lmStudioUrl: 'http://localhost:1234',
    servePort: 7842,
  }
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

function mkTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    title: 'Build signup form with typed state and server auth',
    description:
      'Build the signup form, wire the POST /signup auth endpoint, tighten the FormState types.',
    domain: 'looma',
    projectPath: tmpDir,
    status: 'review',
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
    createdAt: '2026-04-23T00:00:00Z',
    updatedAt: '2026-04-23T00:00:00Z',
    ...overrides,
  }
}

async function writeTask(task: Task): Promise<void> {
  const queue: TaskQueue = {
    version: 1,
    lastUpdated: '2026-04-23T00:00:00Z',
    tasks: [task],
  }
  await fs.writeFile(tasksPath, JSON.stringify(queue, null, 2), 'utf8')
}

async function readQueue(): Promise<TaskQueue> {
  return JSON.parse(await fs.readFile(tasksPath, 'utf8'))
}

describe('Orchestrator — handoff sequence', () => {
  it('advances from step 1 to step 2 when step 1 completes to review (not final step)', async () => {
    const task = mkTask({
      status: 'review',
      handoffSequence: [
        {
          agent: 'frontend-engineer',
          scope: ['ac-1', 'ac-2'],
          instructions: 'Build the form skeleton.',
        },
        {
          agent: 'backend-engineer',
          scope: ['ac-3'],
          instructions: 'Wire the auth endpoint.',
        },
        {
          agent: 'typescript-engineer',
          scope: ['ac-4'],
          instructions: 'Tighten the FormState types.',
        },
      ],
      handoffStep: 0,
      notes: [
        {
          agentId: 'frontend-engineer',
          role: 'worker',
          content:
            '## Self-critique\n- ac-1: met\n- ac-2: met\n\n## Handoff note\nForm renders; Submit button fires POST stub. FormState is `any` in two places — TS Engineer to resolve. Button labels are placeholder, Copywriter may replace.',
          timestamp: '2026-04-23T10:00:00Z',
        },
      ],
    })
    await writeTask(task)

    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    await orch.tick()

    const after = (await readQueue()).tasks[0]!
    // Step advances, status reverts to in_progress.
    expect(after.handoffStep).toBe(1)
    expect(after.status).toBe('in_progress')
    // Step 1 captured its handoff note and completedAt.
    const step1 = after.handoffSequence![0]!
    expect(step1.completedAt).toBeTruthy()
    expect(step1.handoffNote).toContain('Form renders')
    expect(step1.handoffNote).toContain('TS Engineer to resolve')
    // Step 2 untouched.
    const step2 = after.handoffSequence![1]!
    expect(step2.completedAt).toBeUndefined()
  })

  it('runs the reviewer fan-out on the final step (handoffStep = last index)', async () => {
    const task = mkTask({
      status: 'review',
      handoffSequence: [
        { agent: 'frontend-engineer', scope: [], completedAt: '2026-04-23T10:00:00Z', handoffNote: 'ok' },
        { agent: 'typescript-engineer', scope: [] },
      ],
      handoffStep: 1, // final step
      notes: [
        {
          agentId: 'typescript-engineer',
          role: 'worker',
          content: '## Self-critique\n- all met\n\n## Handoff note\nTypes tightened.',
          timestamp: '2026-04-23T11:00:00Z',
        },
      ],
    })
    await writeTask(task)

    const fanoutCalls: { personaSlugs: string[] }[] = []
    const runner: ReviewerFanoutRunner = async ({ personas }) => {
      fanoutCalls.push({ personaSlugs: personas.map((p) => p.slug) })
      return personas.map((persona) => ({
        guildSlug: persona.slug,
        guildName: persona.name,
        verdict: 'approve' as const,
        reasoning: `${persona.name} approved.`,
        revisionItems: [],
        rawOutput: '',
      }))
    }

    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet(),
      reviewerFanout: runner,
    })
    await orch.tick()

    // Reviewer fan-out fired — the handoff pre-pass did NOT advance.
    expect(fanoutCalls).toHaveLength(1)
    const after = (await readQueue()).tasks[0]!
    // handoffStep stayed at 1, status advanced to gate_check (fan-out approve).
    expect(after.handoffStep).toBe(1)
    expect(after.status).toBe('gate_check')
  })

  it('does nothing at `review` when there is no handoff sequence (normal path)', async () => {
    const task = mkTask({ status: 'review' })
    await writeTask(task)

    const fanoutCalls: { personaSlugs: string[] }[] = []
    const runner: ReviewerFanoutRunner = async ({ personas }) => {
      fanoutCalls.push({ personaSlugs: personas.map((p) => p.slug) })
      return personas.map((persona) => ({
        guildSlug: persona.slug,
        guildName: persona.name,
        verdict: 'approve' as const,
        reasoning: 'ok',
        revisionItems: [],
        rawOutput: '',
      }))
    }

    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet(),
      reviewerFanout: runner,
    })
    await orch.tick()

    // Fan-out fired; no handoff bookkeeping happened.
    expect(fanoutCalls).toHaveLength(1)
    const after = (await readQueue()).tasks[0]!
    expect(after.handoffStep).toBeUndefined()
  })
})

describe('context-builder — handoff-aware persona selection', () => {
  it('picks the engineer named by the current handoff step over pickPrimaryEngineer default', async () => {
    const { buildContext } = await import('../context-builder.js')
    const task = mkTask({
      status: 'in_progress',
      handoffSequence: [
        { agent: 'frontend-engineer', scope: [], handoffNote: 'skeleton done' },
        { agent: 'backend-engineer', scope: ['ac-3'] },
      ],
      handoffStep: 1,
    })
    const ctx = await buildContext(task, memoryDir)
    expect(ctx.primaryEngineerSlug).toBe('backend-engineer')
    expect(ctx.personaPrompt).toContain('The Backend Engineer')
    expect(ctx.personaPrompt).toContain('Handoff sequence — step 2 of 2')
    // Prior step's handoff note appears.
    expect(ctx.personaPrompt).toContain('From step 1 (frontend-engineer)')
    expect(ctx.personaPrompt).toContain('skeleton done')
  })
})
