import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {
  Orchestrator,
  pickNextTask,
  shouldResumeAgentSession,
  type OrchestratorAgentSet,
} from '../orchestrator.js'
import { LivenessTracker } from '../liveness.js'
import type { ResolvedConfig } from '@guildhall/config'
import type { Task, TaskQueue, TaskStatus } from '@guildhall/core'
import {
  AGENT_SETTINGS_FILENAME,
  makeDefaultSettings,
  saveLeverSettings,
  type DomainLevers,
  type LeverSettings,
} from '@guildhall/levers'

// ---------------------------------------------------------------------------
// Orchestrator feedback-loop tests
//
// These tests exercise the full tick cycle against a real temp workspace.
// Agents are stubbed with a recording helper that can optionally mutate
// TASKS.json to simulate what the real LLM-driven agents would do through
// their tool calls. The orchestrator reads the mutated state after each
// agent call — that is the feedback loop we are verifying.
// ---------------------------------------------------------------------------

let tmpDir: string
let memoryDir: string
let tasksPath: string
let progressPath: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-orch-test-'))
  memoryDir = path.join(tmpDir, 'memory')
  await fs.mkdir(memoryDir, { recursive: true })
  tasksPath = path.join(memoryDir, 'TASKS.json')
  progressPath = path.join(memoryDir, 'PROGRESS.md')
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

function baseConfig(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
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
    servePort: 7777,
    ...overrides,
  }
}

function mkTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-001',
    title: 'Do a thing',
    description: 'Details here',
    domain: 'looma',
    projectPath: tmpDir,
    status: 'exploring',
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

async function readQueue(): Promise<TaskQueue> {
  const raw = await fs.readFile(tasksPath, 'utf-8')
  return JSON.parse(raw)
}

function queueOf(tasks: Task[]): TaskQueue {
  return {
    version: 1,
    lastUpdated: '2026-04-01T00:00:00Z',
    tasks,
  }
}

/**
 * Mutate a task on disk as if the real agent had called the update-task tool.
 */
async function mutateTask(id: string, patch: Partial<Task>): Promise<void> {
  const q = await readQueue()
  const t = q.tasks.find((t) => t.id === id)
  if (!t) throw new Error(`No task ${id}`)
  Object.assign(t, patch)
  await fs.writeFile(tasksPath, JSON.stringify(q, null, 2), 'utf-8')
}

interface StubAgent {
  readonly name: string
  calls: { prompt: string }[]
  generate(prompt: string): Promise<{ text: string }>
  resetConversation?(): void
}

/**
 * Build a stub agent that records prompts and optionally fires a side effect
 * (typically a state mutation on TASKS.json) to simulate tool calls.
 */
function stubAgent(
  name: string,
  sideEffect?: (prompt: string) => Promise<void> | void,
  text = 'ok',
): StubAgent {
  const calls: { prompt: string }[] = []
  return {
    name,
    calls,
    async generate(prompt: string) {
      calls.push({ prompt })
      if (sideEffect) await sideEffect(prompt)
      return { text }
    },
  }
}

function agentSet(partial: Partial<OrchestratorAgentSet> = {}): OrchestratorAgentSet {
  return {
    spec: partial.spec ?? stubAgent('spec-agent'),
    worker: partial.worker ?? stubAgent('worker-agent'),
    reviewer: partial.reviewer ?? stubAgent('reviewer-agent'),
    gateChecker: partial.gateChecker ?? stubAgent('gate-checker-agent'),
    coordinators: partial.coordinators ?? {},
  }
}

describe('pickNextTask', () => {
  it('continues active work before claiming fresh tasks', async () => {
    const q: TaskQueue = {
      version: 1,
      lastUpdated: 'now',
      tasks: [
        mkTask({ id: 't-review', status: 'review' }),
        mkTask({ id: 't-exploring', status: 'exploring' }),
      ],
    }
    expect(pickNextTask(q)?.id).toBe('t-review')
  })

  it('runs gate checks before sending reviewed work back through other stages', async () => {
    const q: TaskQueue = {
      version: 1,
      lastUpdated: 'now',
      tasks: [
        mkTask({ id: 't-ready', status: 'ready', priority: 'critical' }),
        mkTask({ id: 't-gate', status: 'gate_check', priority: 'low' }),
      ],
    }
    expect(pickNextTask(q)?.id).toBe('t-gate')
  })

  it('does not redispatch exploring tasks that are waiting on unanswered user questions', async () => {
    const q: TaskQueue = {
      version: 1,
      lastUpdated: 'now',
      tasks: [
        mkTask({
          id: 't-exploring',
          status: 'exploring',
          openQuestions: [
            {
              kind: 'text',
              id: 'q1',
              askedBy: 'spec-agent',
              askedAt: '2026-04-01T00:00:00Z',
              prompt: 'Which scenario matters most?',
            },
          ],
        }),
        mkTask({ id: 't-ready', status: 'ready' }),
      ],
    }
    expect(pickNextTask(q)?.id).toBe('t-ready')
  })

  it('prioritizes higher priority within the same status', async () => {
    const q: TaskQueue = {
      version: 1,
      lastUpdated: 'now',
      tasks: [
        mkTask({ id: 't-low', status: 'in_progress', priority: 'low' }),
        mkTask({ id: 't-crit', status: 'in_progress', priority: 'critical' }),
      ],
    }
    expect(pickNextTask(q)?.id).toBe('t-crit')
  })

  it('skips tasks whose dependencies are not done', async () => {
    const q: TaskQueue = {
      version: 1,
      lastUpdated: 'now',
      tasks: [
        mkTask({ id: 'parent', status: 'ready', priority: 'normal' }),
        mkTask({
          id: 'child',
          status: 'ready',
          priority: 'critical',
          dependsOn: ['parent'],
        }),
      ],
    }
    expect(pickNextTask(q)?.id).toBe('parent')
  })

  it('allows dependent tasks once every dependency is done', async () => {
    const q: TaskQueue = {
      version: 1,
      lastUpdated: 'now',
      tasks: [
        mkTask({ id: 'parent', status: 'done' }),
        mkTask({
          id: 'child',
          status: 'ready',
          priority: 'critical',
          dependsOn: ['parent'],
        }),
      ],
    }
    expect(pickNextTask(q)?.id).toBe('child')
  })

  it('filters by domain when provided', async () => {
    const q: TaskQueue = {
      version: 1,
      lastUpdated: 'now',
      tasks: [
        mkTask({ id: 't-looma', status: 'exploring', domain: 'looma' }),
        mkTask({ id: 't-knit', status: 'exploring', domain: 'knit' }),
      ],
    }
    expect(pickNextTask(q, 'knit')?.id).toBe('t-knit')
  })

  it('returns undefined when all tasks are terminal', async () => {
    const q: TaskQueue = {
      version: 1,
      lastUpdated: 'now',
      tasks: [
        mkTask({ id: 'a', status: 'done' }),
        mkTask({ id: 'b', status: 'blocked' }),
      ],
    }
    expect(pickNextTask(q)).toBeUndefined()
  })
})

describe('shouldResumeAgentSession', () => {
  it('does not resume a worker session when the task is no longer assigned to the worker', () => {
    const queue = queueOf([
      mkTask({ status: 'review' }),
    ])
    expect(shouldResumeAgentSession('worker', queue)).toBe(false)
  })

  it('resumes a worker session only for an in_progress task assigned to worker-agent', () => {
    const queue = queueOf([
      mkTask({ status: 'in_progress', assignedTo: 'worker-agent' }),
    ])
    expect(shouldResumeAgentSession('worker', queue)).toBe(true)
  })

  it('does not resume a reviewer session for unassigned review tasks', () => {
    const queue = queueOf([
      mkTask({ status: 'review' }),
    ])
    expect(shouldResumeAgentSession('reviewer', queue)).toBe(false)
  })

  it('resumes a spec session for active exploring work', () => {
    const queue = queueOf([
      mkTask({ status: 'exploring' }),
    ])
    expect(shouldResumeAgentSession('spec', queue)).toBe(true)
  })

  it('resumes a domain coordinator session only for matching domain review-prep work', () => {
    const queue = queueOf([
      mkTask({ domain: 'knit', status: 'spec_review', spec: 'draft' }),
      mkTask({ domain: 'looma', status: 'spec_review', spec: 'draft' }),
    ])
    expect(shouldResumeAgentSession('coordinator-knit', queue)).toBe(true)
    expect(shouldResumeAgentSession('coordinator-auth', queue)).toBe(false)
  })
})

describe('Orchestrator.tick — idle handling', () => {
  it('reports idle + allDone=true when every task is terminal', async () => {
    await writeQueue([
      mkTask({ id: 'a', status: 'done' }),
      mkTask({ id: 'b', status: 'blocked' }),
    ])
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    const out = await orch.tick()
    expect(out.kind).toBe('idle')
    if (out.kind === 'idle') {
      expect(out.allDone).toBe(true)
      expect(out.consecutiveIdleTicks).toBe(1)
    }
  })

  it('increments consecutiveIdleTicks across consecutive empty ticks', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'done' })])
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    await orch.tick()
    const out = await orch.tick()
    expect(out.kind).toBe('idle')
    if (out.kind === 'idle') expect(out.consecutiveIdleTicks).toBe(2)
  })

  it('resets the idle counter when a task is processed', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'done' })])
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    await orch.tick() // idle
    // Now add an actionable task
    await writeQueue([
      mkTask({ id: 'a', status: 'done' }),
      mkTask({ id: 'b', status: 'in_progress' }),
    ])
    await orch.tick() // processed
    // Drain b so next tick is idle again
    await writeQueue([
      mkTask({ id: 'a', status: 'done' }),
      mkTask({ id: 'b', status: 'done' }),
    ])
    const out = await orch.tick()
    expect(out.kind).toBe('idle')
    if (out.kind === 'idle') expect(out.consecutiveIdleTicks).toBe(1)
  })
})

describe('Orchestrator.tick — bootstrap precondition', () => {
  it('refuses to dispatch when bootstrap has install/gates but no verifiedAt', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'in_progress' })])
    const worker = stubAgent('worker-agent')
    const cfg = baseConfig({
      bootstrap: {
        commands: [],
        successGates: [],
        timeoutMs: 300_000,
        packageManager: 'pnpm',
        install: { command: 'pnpm install', status: 'ok' },
        gates: {
          lint: { command: 'pnpm lint', available: true },
        },
      },
    })
    const orch = new Orchestrator({ config: cfg, agents: agentSet({ worker }) })
    const out = await orch.tick()
    expect(out.kind).toBe('bootstrap-required')
    if (out.kind === 'bootstrap-required') {
      expect(out.reason).toBe('bootstrap_required')
      expect(out.pendingTaskCount).toBe(1)
    }
    expect(worker.calls).toHaveLength(0)
  })

  it('emits bootstrap_failed when last install failed', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'in_progress' })])
    const worker = stubAgent('worker-agent')
    const cfg = baseConfig({
      bootstrap: {
        commands: [],
        successGates: [],
        timeoutMs: 300_000,
        verifiedAt: '2026-04-23T00:00:00Z',
        packageManager: 'pnpm',
        install: { command: 'pnpm install', status: 'failed' },
        gates: { lint: { command: 'pnpm lint', available: true } },
      },
    })
    const orch = new Orchestrator({ config: cfg, agents: agentSet({ worker }) })
    const out = await orch.tick()
    expect(out.kind).toBe('bootstrap-required')
    if (out.kind === 'bootstrap-required') expect(out.reason).toBe('bootstrap_failed')
    expect(worker.calls).toHaveLength(0)
  })

  it('dispatches normally when bootstrap.verifiedAt is present and install is ok', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'in_progress' })])
    const worker = stubAgent('worker-agent')
    const cfg = baseConfig({
      bootstrap: {
        commands: [],
        successGates: [],
        timeoutMs: 300_000,
        verifiedAt: '2026-04-23T00:00:00Z',
        packageManager: 'pnpm',
        install: { command: 'pnpm install', status: 'ok' },
        gates: { lint: { command: 'pnpm lint', available: true } },
      },
    })
    const orch = new Orchestrator({ config: cfg, agents: agentSet({ worker }) })
    const out = await orch.tick()
    expect(out.kind).toBe('processed')
    expect(worker.calls).toHaveLength(1)
  })

  it('dispatches normally when there is no bootstrap block at all (legacy)', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'in_progress' })])
    const worker = stubAgent('worker-agent')
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet({ worker }) })
    const out = await orch.tick()
    expect(out.kind).toBe('processed')
    expect(worker.calls).toHaveLength(1)
  })
})

describe('Orchestrator.tick — routing', () => {
  it('routes exploring tasks to the spec agent', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'exploring' })])
    const spec = stubAgent('spec-agent')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ spec }),
    })
    const out = await orch.tick()
    expect(out.kind).toBe('processed')
    if (out.kind === 'processed') {
      expect(out.agent).toBe('spec-agent')
      expect(out.beforeStatus).toBe('exploring')
    }
    expect(spec.calls).toHaveLength(1)
  })

  it('escalates exploring tasks after repeated spec-agent no-change passes', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'exploring' })])
    const spec = stubAgent('spec-agent', undefined, '')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ spec }),
    })

    const first = await orch.tick()
    const second = await orch.tick()
    const third = await orch.tick()

    expect(first.kind).toBe('processed')
    expect(second.kind).toBe('processed')
    expect(third.kind).toBe('escalated')

    const queue = await readQueue()
    const task = queue.tasks[0]!
    expect(task.status).toBe('blocked')
    expect(task.blockReason).toMatch(/no visible progress/i)
    expect(task.escalations).toHaveLength(1)
    expect(task.escalations[0]!.reason).toBe('human_judgment_required')
  })

  it('persists plain-text spec-agent questions to transcript and openQuestions', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'exploring' })])
    const spec = stubAgent(
      'spec-agent',
      undefined,
      'Pick one: should this cover only the happy path, or error cases too?',
    )
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ spec }),
    })

    const out = await orch.tick()
    expect(out.kind).toBe('processed')

    const queue = await readQueue()
    const task = queue.tasks[0]!
    expect(task.status).toBe('exploring')
    expect(task.openQuestions).toHaveLength(1)
    expect(task.openQuestions?.[0]?.kind).toBe('text')
    expect(task.openQuestions?.[0]?.prompt).toContain('Pick one')

    const transcript = await fs.readFile(
      path.join(memoryDir, 'exploring', 'a.md'),
      'utf-8',
    )
    expect(transcript).toContain('Pick one: should this cover only the happy path')
  })

  it('authors a fallback product brief from spec-agent plain text when none exists yet', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'exploring', title: 'Preserve last assistant text' })])
    const spec = stubAgent(
      'spec-agent',
      undefined,
      [
        'Got it.',
        '',
        '### My best guess for this task',
        'You want to preserve the last meaningful assistant text across tool-only turns so recovery paths keep the right context.',
        '',
        'Pick one: should this be test-only, or behavior + test?',
      ].join('\n'),
    )
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ spec }),
    })

    const out = await orch.tick()
    expect(out.kind).toBe('processed')

    const queue = await readQueue()
    const task = queue.tasks[0]!
    expect(task.productBrief).toMatchObject({
      userJob:
        'You want to preserve the last meaningful assistant text across tool-only turns so recovery paths keep the right context.',
      successMetric: 'Thread shows a drafted brief and actionable next step for "Preserve last assistant text".',
      authoredBy: 'spec-agent',
    })
  })

  it('prefers the pre-nudge assistant question when later recovery prose would otherwise hide it', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'exploring' })])
    const calls: { prompt: string }[] = []
    const spec: StubAgent = {
      name: 'spec-agent',
      calls,
      async generate(prompt: string) {
        calls.push({ prompt })
        return {
          text: "Understood. I'm blocked on tool-schema details and will inspect them next.",
          messages: [
            { role: 'user', content: [{ type: 'text', text: prompt }] },
            {
              role: 'assistant',
              content: [{ type: 'text', text: 'Pick one: happy path only, or error cases too?' }],
            },
            {
              role: 'user',
              content: [{
                type: 'text',
                text: 'Your last response did not use a tool, so Guildhall could not turn it into durable spec progress.',
              }],
            },
            {
              role: 'assistant',
              content: [{
                type: 'text',
                text: "Understood. I'm blocked on tool-schema details and will inspect them next.",
              }],
            },
          ],
        }
      },
    }
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ spec }),
    })

    const out = await orch.tick()
    expect(out.kind).toBe('processed')

    const queue = await readQueue()
    const task = queue.tasks[0]!
    expect(task.openQuestions).toHaveLength(1)
    expect(task.openQuestions?.[0]?.kind).toBe('choice')
    expect(task.openQuestions?.[0]?.prompt).toBe('Pick one')
    expect(task.openQuestions?.[0]).toMatchObject({
      choices: ['happy path only', 'error cases too'],
      selectionMode: 'single',
    })

    const transcript = await fs.readFile(path.join(memoryDir, 'exploring', 'a.md'), 'utf-8')
    expect(transcript).toContain('Pick one: happy path only, or error cases too?')
    expect(transcript).not.toContain("I'm blocked on tool-schema details")
  })

  it('splits numbered plain-text spec questions into multiple structured choice cards', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'exploring' })])
    const spec = stubAgent(
      'spec-agent',
      undefined,
      [
        'Pick one option for each:',
        '',
        '1) **Primary scenario to spec**',
        '- A) Validation failure',
        '- B) Empty assistant message',
        '- C) Any of the above',
        '',
        '2) **What the fallback must do**',
        '- A) Post one structured choice question, then stop turn',
        '- B) Post structured question + transcript entry + stop turn',
        '',
        '3) **Out-of-scope guardrails**',
        '- A) Don’t redesign the task state machine',
        '- B) Don’t add new question kinds',
        '- C) Don’t change Looma code',
      ].join('\n'),
    )
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ spec }),
    })

    const out = await orch.tick()
    expect(out.kind).toBe('processed')

    const queue = await readQueue()
    const task = queue.tasks[0]!
    expect(task.openQuestions).toHaveLength(3)
    expect(task.openQuestions?.map((q) => q.kind)).toEqual(['choice', 'choice', 'choice'])
    expect(task.openQuestions?.[0]).toMatchObject({
      prompt: 'Primary scenario to spec',
      choices: ['Validation failure', 'Empty assistant message', 'Any of the above'],
      selectionMode: 'single',
    })
    expect(task.openQuestions?.[1]).toMatchObject({
      prompt: 'What the fallback must do',
      choices: [
        'Post one structured choice question, then stop turn',
        'Post structured question + transcript entry + stop turn',
      ],
    })
    expect(task.openQuestions?.[2]).toMatchObject({
      prompt: 'Out-of-scope guardrails',
      choices: [
        'Don’t redesign the task state machine',
        'Don’t add new question kinds',
        'Don’t change Looma code',
      ],
    })
  })

  it('limits fallback questionnaire parsing to the top three structured questions', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'exploring' })])
    const spec = stubAgent(
      'spec-agent',
      undefined,
      [
        'Pick one option for each:',
        '',
        '1) **First**',
        '- A) one',
        '- B) two',
        '',
        '2) **Second**',
        '- A) one',
        '- B) two',
        '',
        '3) **Third**',
        '- A) one',
        '- B) two',
        '',
        '4) **Fourth**',
        '- A) one',
        '- B) two',
      ].join('\n'),
    )
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ spec }),
    })

    const out = await orch.tick()
    expect(out.kind).toBe('processed')

    const queue = await readQueue()
    const task = queue.tasks[0]!
    expect(task.openQuestions).toHaveLength(3)
    expect(task.openQuestions?.map((q) => q.kind)).toEqual(['choice', 'choice', 'choice'])
    expect(task.openQuestions?.map((q) => ('prompt' in q ? q.prompt : ''))).toEqual([
      'First',
      'Second',
      'Third',
    ])
  })

  it('prefers prompt-line plus numbered choices when spec prose mixes numbered options with a later success check', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'exploring' })])
    const spec = stubAgent(
      'spec-agent',
      undefined,
      [
        'Got it — I’ll keep this first intake tight.',
        '',
        'To lock scope before I draft acceptance criteria, pick one:',
        '',
        '1. **Behavior spec only** — define what “narrowed first-turn batch” means.',
        '2. **End-to-end feature spec** — behavior + storage/format expectations.',
        '3. **Evaluation harness spec** — define test scenarios + pass/fail metrics.',
        '4. **Other** — tell me your target in one line.',
        '',
        'Also, what should success look like in one concrete check?',
        '- A) In first turn, agent asks at most N questions and yields.',
        '- B) Task spec quality stays complete while first turn stays narrow.',
        '- C) Both A and B.',
        '- D) Other.',
      ].join('\n'),
    )
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ spec }),
    })

    const out = await orch.tick()
    expect(out.kind).toBe('processed')

    const queue = await readQueue()
    const task = queue.tasks[0]!
    expect(task.openQuestions).toHaveLength(2)
    expect(task.openQuestions?.[0]).toMatchObject({
      prompt: 'To lock scope before I draft acceptance criteria, pick one:',
      choices: [
        'Behavior spec only',
        'End-to-end feature spec',
        'Evaluation harness spec',
        'Other',
      ],
    })
    expect(task.openQuestions?.[1]).toMatchObject({
      prompt: 'Also, what should success look like in one concrete check?',
      choices: [
        'In first turn, agent asks at most N questions and yields.',
        'Task spec quality stays complete while first turn stays narrow.',
        'Both A and B.',
        'Other.',
      ],
    })
  })

  it('backfills missing inferred questions when the agent only managed to post the first one', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'exploring' })])
    const generatedText = [
      'Great, thanks — we’ve got 3 of 6 decisions locked.',
      '',
      'I still need 3 quick picks before I can draft a precise, testable spec:',
      '',
      '1) **Test level target (pick one)**',
      '- A. Unit only',
      '- B. Unit + integration',
      '- C. Integration/e2e only',
      '',
      '2) **Coverage posture (pick one)**',
      '- A. Cover only the new narrowed-intake paths',
      '- B. Keep current project baseline (no new floor)',
      '- C. Set explicit floor for touched files (reply with %)',
      '',
      '3) **If first-turn data is still insufficient (pick one)**',
      '- A. Ask a second-turn follow-up batch (again narrow)',
      '- B. Escalate immediately as spec ambiguous',
      '- C. Draft best-effort spec with explicit open questions and pause for approval',
      '',
      'Once you pick these, I’ll draft the full spec with:',
      '- numbered Given/When/Then acceptance criteria',
      '- test mapping (which AC is unit vs integration)',
      '- out-of-scope',
      '- open questions (if any)',
    ].join('\n')
    const spec = stubAgent('spec-agent', async () => {
      await mutateTask('a', {
        openQuestions: [{
          kind: 'choice',
          id: 'q-1',
          askedBy: 'spec-agent',
          askedAt: new Date().toISOString(),
          prompt: '1) **Test level target (pick one)**',
          choices: ['Unit only', 'Unit + integration', 'Integration/e2e only'],
          selectionMode: 'single',
        }],
      })
    }, generatedText)
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ spec }),
    })

    const out = await orch.tick()
    expect(out.kind).toBe('processed')

    const queue = await readQueue()
    const task = queue.tasks[0]!
    expect(task.openQuestions).toHaveLength(3)
    expect(task.openQuestions?.map((q) => ('prompt' in q ? q.prompt : ''))).toEqual([
      '1) **Test level target (pick one)**',
      '2) **Coverage posture (pick one)**',
      '3) **If first-turn data is still insufficient (pick one)**',
    ])
  })

  it('does not synthesize fallback questions after the agent already drafted the spec and moved to spec_review', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'exploring', title: 'Draft spec' })])
    const specText = [
      'Perfect — that is enough to draft the spec.',
      '',
      'I’m going to:',
      '- write the spec into the task,',
      '- move the task to `spec_review`, and',
      '- log progress.',
    ].join('\n')
    const spec = stubAgent('spec-agent', async () => {
      await mutateTask('a', {
        status: 'spec_review',
        spec: '## Summary\\nDrafted spec.',
        notes: [{
          agentId: 'spec-agent',
          role: 'spec',
          content: 'Drafted spec.',
          timestamp: new Date().toISOString(),
        }],
      })
    }, specText)
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ spec }),
    })

    const out = await orch.tick()
    expect(out.kind).toBe('processed')

    const queue = await readQueue()
    const task = queue.tasks[0]!
    expect(task.status).toBe('spec_review')
    expect(task.spec).toContain('Summary')
    expect(task.openQuestions ?? []).toHaveLength(0)
  })

  it('drops stale unanswered exploring questions once a drafted spec reaches spec_review', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'exploring' })])
    const spec = stubAgent('spec-agent', async () => {
      await mutateTask('a', {
        status: 'spec_review',
        spec: '## Summary\\nDrafted spec.',
        openQuestions: [{
          kind: 'choice',
          id: 'q-stale',
          askedBy: 'spec-agent',
          askedAt: new Date().toISOString(),
          prompt: 'Old fallback question',
          choices: ['one', 'two'],
          selectionMode: 'single',
        }],
        notes: [{
          agentId: 'spec-agent',
          role: 'spec',
          content: 'Drafted spec.',
          timestamp: new Date().toISOString(),
        }],
      })
    }, 'Draft complete.')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ spec }),
    })

    const out = await orch.tick()
    expect(out.kind).toBe('processed')

    const queue = await readQueue()
    const task = queue.tasks[0]!
    expect(task.status).toBe('spec_review')
    expect((task.openQuestions ?? []).filter((q) => !q.answeredAt)).toHaveLength(0)
  })

  it('parses markdown-headed numbered questions and a "my read" brief into structured state', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'exploring', title: 'Fallback recovery' })])
    const spec = stubAgent(
      'spec-agent',
      undefined,
      [
        'Got it.',
        '',
        'My read of this task title is:',
        '- We want to verify fallback brief creation and structured question recovery after spec-agent failures.',
        '',
        '### 1) Primary outcome',
        '- A) Spec-agent flow only',
        '- B) Shared orchestration recovery',
        '- C) Both',
        '',
        '### 2) Test depth',
        '- A) Unit only',
        '- B) Unit + integration',
      ].join('\n'),
    )
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ spec }),
    })

    const out = await orch.tick()
    expect(out.kind).toBe('processed')

    const queue = await readQueue()
    const task = queue.tasks[0]!
    expect(task.productBrief).toMatchObject({
      userJob:
        'We want to verify fallback brief creation and structured question recovery after spec-agent failures.',
      authoredBy: 'spec-agent',
    })
    expect(task.openQuestions).toHaveLength(2)
    expect(task.openQuestions?.[0]).toMatchObject({
      kind: 'choice',
      prompt: 'Primary outcome',
      choices: ['Spec-agent flow only', 'Shared orchestration recovery', 'Both'],
    })
    expect(task.openQuestions?.[1]).toMatchObject({
      kind: 'choice',
      prompt: 'Test depth',
      choices: ['Unit only', 'Unit + integration'],
    })
  })

  it('parses markdown-headed questions that use A/B/C option lines into multiple structured cards', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'exploring' })])
    const spec = stubAgent(
      'spec-agent',
      undefined,
      [
        'Perfect — “all of the above” is clear.',
        '',
        '### 1) What should be the **primary success signal** for this task? (pick one)',
        'A. Spec quality only: clear ACs + testing strategy, no implementation expectations',
        'B. Implementation-ready: ACs are directly testable and mapped to unit/integration tests',
        'C. End-to-end governance: includes ACs for behavior, tests, task-state transitions, and transcript persistence as release gates',
        '',
        '### 2) Coverage posture for the future implementation (pick one)',
        'A. Standard floor only (existing project defaults; no extra target)',
        'B. Elevated on touched intake modules (explicit higher expectation in spec)',
        'C. Standard floor + explicit exemption note allowed for non-deterministic orchestration paths',
      ].join('\n'),
    )
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ spec }),
    })

    const out = await orch.tick()
    expect(out.kind).toBe('processed')

    const queue = await readQueue()
    const task = queue.tasks[0]!
    expect(task.openQuestions).toHaveLength(2)
    expect(task.openQuestions?.[0]).toMatchObject({
      prompt: 'What should be the **primary success signal** for this task? (pick one)',
      choices: [
        'Spec quality only: clear ACs + testing strategy, no implementation expectations',
        'Implementation-ready: ACs are directly testable and mapped to unit/integration tests',
        'End-to-end governance: includes ACs for behavior, tests, task-state transitions, and transcript persistence as release gates',
      ],
    })
    expect(task.openQuestions?.[1]).toMatchObject({
      prompt: 'Coverage posture for the future implementation (pick one)',
      choices: [
        'Standard floor only (existing project defaults; no extra target)',
        'Elevated on touched intake modules (explicit higher expectation in spec)',
        'Standard floor + explicit exemption note allowed for non-deterministic orchestration paths',
      ],
    })
  })

  it('routes in_progress tasks to the worker agent', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'in_progress' })])
    const worker = stubAgent('worker-agent')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
    })
    const out = await orch.tick()
    if (out.kind === 'processed') expect(out.agent).toBe('worker-agent')
    expect(worker.calls).toHaveLength(1)
  })

  it('routes review tasks to the reviewer agent', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'review' })])
    const reviewer = stubAgent('reviewer-agent')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ reviewer }),
    })
    await orch.tick()
    expect(reviewer.calls).toHaveLength(1)
  })

  it('routes gate_check tasks to the gate-checker agent', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'gate_check' })])
    const gc = stubAgent('gate-checker-agent')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ gateChecker: gc }),
    })
    await orch.tick()
    expect(gc.calls).toHaveLength(1)
  })

  it('claims ready tasks deterministically without a coordinator call', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'ready', domain: 'ghost', spec: 'approved spec' })])
    const coord = stubAgent('ghost-coordinator')
    const worker = stubAgent('worker-agent')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ coordinators: { ghost: coord }, worker }),
    })
    const out = await orch.tick()
    expect(out.kind).toBe('processed')
    if (out.kind === 'processed') {
      expect(out.agent).toBe('task-claimer')
      expect(out.beforeStatus).toBe('ready')
      expect(out.afterStatus).toBe('in_progress')
      expect(out.transitioned).toBe(true)
    }
    expect(coord.calls).toHaveLength(0)
    expect(worker.calls).toHaveLength(0)
    const q = await readQueue()
    expect(q.tasks[0]!.status).toBe('in_progress')
    expect(q.tasks[0]!.assignedTo).toBe('worker-agent')
    expect(q.tasks[0]!.notes.at(-1)).toMatchObject({
      agentId: 'task-claimer',
      role: 'orchestrator',
    })
  })

  it('leaves a drafted spec_review task idle for human approval', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'spec_review', domain: 'looma', spec: 'draft spec' })])
    const coord = stubAgent('looma-coordinator')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ coordinators: { looma: coord } }),
    })
    const out = await orch.tick()
    expect(out.kind).toBe('idle')
    expect(coord.calls).toHaveLength(0)
  })

  it('routes workspace-import drafts to spec_review instead of looping in exploring', async () => {
    await writeQueue([
      mkTask({
        id: 'task-workspace-import',
        title: 'Import existing workspace artifacts into TASKS.json',
        domain: '_workspace_import',
        status: 'exploring',
      }),
    ])
    const spec = stubAgent('spec-agent', async () => {
      await mutateTask('task-workspace-import', {
        spec: '```yaml\\ntasks:\\n  - id: imported\\n    title: Imported task\\n```',
        updatedAt: '2026-04-01T00:05:00Z',
      })
    })
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ spec }),
    })
    const out = await orch.tick()
    expect(out.kind).toBe('processed')
    if (out.kind === 'processed') {
      expect(out.taskId).toBe('task-workspace-import')
      expect(out.afterStatus).toBe('spec_review')
      expect(out.transitioned).toBe(true)
    }
    const q = await readQueue()
    expect(q.tasks[0]!.status).toBe('spec_review')
  })

  it('reports no-coordinator when spec_review needs a missing domain coordinator', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'spec_review', domain: 'ghost' })])
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    const out = await orch.tick()
    expect(out.kind).toBe('no-coordinator')
    if (out.kind === 'no-coordinator') {
      expect(out.taskId).toBe('a')
      expect(out.domain).toBe('ghost')
    }
  })

  it('filters by domain when domainFilter is set', async () => {
    await writeQueue([
      mkTask({ id: 'a', status: 'in_progress', domain: 'looma' }),
      mkTask({ id: 'b', status: 'in_progress', domain: 'knit' }),
    ])
    const worker = stubAgent('worker-agent')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
      domainFilter: 'knit',
    })
    const out = await orch.tick()
    if (out.kind === 'processed') expect(out.taskId).toBe('b')
  })

  it('retries empty assistant turns before surfacing an agent error', async () => {
    await writeQueue([mkTask({ id: 'worker-task', status: 'in_progress' })])
    let calls = 0
    const worker = {
      name: 'worker-agent',
      calls: [] as Array<{ prompt: string }>,
      async generate(prompt: string) {
        this.calls.push({ prompt })
        calls += 1
        if (calls < 3) {
          throw new Error('Model returned an empty assistant message. The turn was ignored to keep the session healthy.')
        }
        await mutateTask('worker-task', {
          status: 'done',
          updatedAt: '2026-04-01T00:06:00Z',
        })
        return { text: 'ok' }
      },
    }
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
    })

    const first = await orch.tick()
    expect(first.kind).toBe('processed')
    if (first.kind === 'processed') {
      expect(first.afterStatus).toBe('in_progress')
      expect(first.transitioned).toBe(false)
    }

    const second = await orch.tick()
    expect(second.kind).toBe('processed')
    if (second.kind === 'processed') {
      expect(second.afterStatus).toBe('in_progress')
      expect(second.transitioned).toBe(false)
    }

    const third = await orch.tick()
    expect(third.kind).toBe('processed')
    if (third.kind === 'processed') {
      expect(third.afterStatus).toBe('done')
      expect(third.transitioned).toBe(true)
    }
  })

  it('resets the agent conversation once after repeated empty assistant turns', async () => {
    await writeQueue([mkTask({ id: 'worker-task', status: 'in_progress' })])
    let calls = 0
    let resets = 0
    const worker: StubAgent = {
      name: 'worker-agent',
      calls: [],
      async generate(prompt: string) {
        this.calls.push({ prompt })
        calls += 1
        if (calls <= 3) {
          throw new Error('Model returned an empty assistant message. The turn was ignored to keep the session healthy.')
        }
        await mutateTask('worker-task', {
          status: 'done',
          updatedAt: '2026-04-01T00:06:00Z',
        })
        return { text: 'ok' }
      },
      resetConversation() {
        resets += 1
      },
    }
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
    })

    expect((await orch.tick()).kind).toBe('processed')
    expect((await orch.tick()).kind).toBe('processed')

    const third = await orch.tick()
    expect(third.kind).toBe('processed')
    if (third.kind === 'processed') {
      expect(third.afterStatus).toBe('in_progress')
      expect(third.transitioned).toBe(false)
    }
    expect(resets).toBe(1)

    const fourth = await orch.tick()
    expect(fourth.kind).toBe('processed')
    if (fourth.kind === 'processed') {
      expect(fourth.afterStatus).toBe('done')
      expect(fourth.transitioned).toBe(true)
    }
  })
})

describe('Orchestrator.tick — feedback loop', () => {
  it('detects status transitions the agent wrote to disk', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'in_progress' })])
    const worker = stubAgent('worker-agent', async () => {
      await mutateTask('a', { status: 'review' })
    })
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
    })
    const out = await orch.tick()
    expect(out.kind).toBe('processed')
    if (out.kind === 'processed') {
      expect(out.beforeStatus).toBe('in_progress')
      expect(out.afterStatus).toBe('review')
      expect(out.transitioned).toBe(true)
    }
  })

  it('reports transitioned=false when the agent left the status unchanged', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'in_progress' })])
    const worker = stubAgent('worker-agent') // no mutation
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
    })
    const out = await orch.tick()
    if (out.kind === 'processed') {
      expect(out.afterStatus).toBe('in_progress')
      expect(out.transitioned).toBe(false)
    }
  })

  it('includes the tasks path and memory dir in the agent prompt', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'in_progress' })])
    const worker = stubAgent('worker-agent')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
    })
    await orch.tick()
    const [call] = worker.calls
    expect(call).toBeDefined()
    expect(call!.prompt).toContain(tasksPath)
    expect(call!.prompt).toContain(memoryDir)
  })

  it('injects buildContext output (task summary + markers) into the prompt', async () => {
    await writeQueue([
      mkTask({ id: 'a', status: 'in_progress', title: 'Unique title xyz' }),
    ])
    const worker = stubAgent('worker-agent')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
    })
    await orch.tick()
    const [call] = worker.calls
    expect(call).toBeDefined()
    expect(call!.prompt).toContain('FORGE CONTEXT')
    expect(call!.prompt).toContain('Unique title xyz')
  })
})

describe('Orchestrator.tick — revision counting', () => {
  it('increments revisionCount when review bounces back to in_progress', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'review', revisionCount: 0 })])
    const reviewer = stubAgent('reviewer-agent', async () => {
      await mutateTask('a', { status: 'in_progress' })
    })
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ reviewer }),
    })
    const out = await orch.tick()
    expect(out.kind).toBe('processed')
    if (out.kind === 'processed') expect(out.revisionCount).toBe(1)
    const q = await readQueue()
    expect(q.tasks[0]!.revisionCount).toBe(1)
    expect(q.tasks[0]!.assignedTo).toBe('worker-agent')
  })

  it('increments revisionCount when gate_check bounces back to in_progress', async () => {
    await writeQueue([
      mkTask({ id: 'a', status: 'gate_check', revisionCount: 1 }),
    ])
    const gc = stubAgent('gate-checker-agent', async () => {
      await mutateTask('a', { status: 'in_progress' })
    })
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ gateChecker: gc }),
    })
    const out = await orch.tick()
    if (out.kind === 'processed') expect(out.revisionCount).toBe(2)
    const q = await readQueue()
    expect(q.tasks[0]!.assignedTo).toBe('worker-agent')
  })

  it('does not increment revisionCount on forward transitions', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'review', revisionCount: 1 })])
    const reviewer = stubAgent('reviewer-agent', async () => {
      await mutateTask('a', { status: 'gate_check' })
    })
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ reviewer }),
    })
    const out = await orch.tick()
    if (out.kind === 'processed') expect(out.revisionCount).toBe(1)
  })

  it('blocks the task when revisionCount exceeds maxRevisions', async () => {
    await writeQueue([
      mkTask({ id: 'a', status: 'review', revisionCount: 3 }),
    ])
    const reviewer = stubAgent('reviewer-agent', async () => {
      await mutateTask('a', { status: 'in_progress' })
    })
    const orch = new Orchestrator({
      config: baseConfig({ maxRevisions: 3 }),
      agents: agentSet({ reviewer }),
    })
    const out = await orch.tick()
    expect(out.kind).toBe('blocked-max-revisions')
    const q = await readQueue()
    const task = q.tasks[0]!
    expect(task.status).toBe('blocked')
    expect(task.blockReason).toContain('maxRevisions')
  })
})

describe('Orchestrator.tick — progress logging (FR-09)', () => {
  it('appends a typed HEARTBEAT entry on a routine forward transition', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'in_progress' })])
    const worker = stubAgent('worker-agent', async () => {
      await mutateTask('a', { status: 'review' })
    })
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
      now: () => '2026-04-20T12:00:00Z',
    })
    await orch.tick()
    const progress = await fs.readFile(progressPath, 'utf-8')
    expect(progress).toContain('HEARTBEAT')
    expect(progress).toContain('2026-04-20T12:00:00Z')
    expect(progress).toContain('worker-agent')
    expect(progress).toContain('in_progress → review')
  })

  it('writes a MILESTONE entry when a task transitions to done', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'gate_check' })])
    const gc = stubAgent('gate-checker-agent', async () => {
      await mutateTask('a', { status: 'done' })
    })
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ gateChecker: gc }),
    })
    await orch.tick()
    const progress = await fs.readFile(progressPath, 'utf-8')
    expect(progress).toContain('MILESTONE')
  })

  it('does NOT write a PROGRESS.md entry when the agent ran but no transition occurred', async () => {
    // No-op ticks are noise in the on-disk progress history. Orchestrator-
    // alive signal belongs in the ephemeral SSE stream, not PROGRESS.md.
    await writeQueue([mkTask({ id: 'a', status: 'in_progress' })])
    const worker = stubAgent('worker-agent')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
    })
    await orch.tick()
    const progress = await fs
      .readFile(progressPath, 'utf-8')
      .catch(() => '')
    expect(progress).not.toContain('HEARTBEAT')
    expect(progress).not.toContain('unchanged')
  })

  it('stays silent across many no-op ticks (no PROGRESS.md churn)', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'in_progress' })])
    const worker = stubAgent('worker-agent')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
    })
    for (let i = 0; i < 5; i++) await orch.tick()
    const progress = await fs
      .readFile(progressPath, 'utf-8')
      .catch(() => '')
    expect(progress).toBe('')
  })

  it('writes an ESCALATION entry when max revisions is exceeded (FR-10 supersedes BLOCKED)', async () => {
    // Prior to FR-10 this path wrote a BLOCKED heartbeat. Now the orchestrator
    // routes max-revisions through the escalation protocol, which writes a
    // typed `escalation` entry instead.
    await writeQueue([
      mkTask({ id: 'a', status: 'review', revisionCount: 3 }),
    ])
    const reviewer = stubAgent('reviewer-agent', async () => {
      await mutateTask('a', { status: 'in_progress' })
    })
    const orch = new Orchestrator({
      config: baseConfig({ maxRevisions: 3 }),
      agents: agentSet({ reviewer }),
    })
    await orch.tick()
    const progress = await fs.readFile(progressPath, 'utf-8')
    expect(progress).toContain('ESCALATION')
    expect(progress).toContain('max_revisions_exceeded')
  })

  it('writes an ESCALATION entry on agent errors', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'in_progress' })])
    const worker = {
      name: 'worker-agent',
      async generate() {
        throw new Error('LLM boom')
      },
    }
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
    })
    await orch.tick()
    const progress = await fs.readFile(progressPath, 'utf-8')
    expect(progress).toContain('ESCALATION')
    expect(progress).toContain('LLM boom')
  })

  it('tags each entry with the task domain', async () => {
    await writeQueue([
      mkTask({ id: 'a', status: 'in_progress', domain: 'knit-web' }),
    ])
    const worker = stubAgent('worker-agent', async () => {
      await mutateTask('a', { status: 'review' })
    })
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
    })
    await orch.tick()
    const progress = await fs.readFile(progressPath, 'utf-8')
    expect(progress).toContain('knit-web')
  })
})

describe('Orchestrator.tick — error handling', () => {
  it('reports agent-error when the agent throws', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'in_progress' })])
    const worker = {
      name: 'worker-agent',
      async generate() {
        throw new Error('LLM exploded')
      },
    }
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
    })
    const out = await orch.tick()
    expect(out.kind).toBe('agent-error')
    if (out.kind === 'agent-error') {
      expect(out.error).toContain('LLM exploded')
    }
  })

  it('logs agent errors to PROGRESS.md', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'in_progress' })])
    const worker = {
      name: 'worker-agent',
      async generate() {
        throw new Error('boom')
      },
    }
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
    })
    await orch.tick()
    const progress = await fs.readFile(progressPath, 'utf-8')
    expect(progress).toContain('error: boom')
  })

  it('blocks the task when an agent hits its turn limit', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'in_progress' })])
    const worker = {
      name: 'worker-agent',
      async generate() {
        throw new Error('Exceeded maximum turn limit (8)')
      },
    }
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
    })
    const out = await orch.tick()
    expect(out.kind).toBe('escalated')

    const q = await readQueue()
    expect(q.tasks[0]!.status).toBe('blocked')
    expect(q.tasks[0]!.escalations[0]!.summary).toContain('Worker stopped')
  })
})

describe('Orchestrator.run — full loops', () => {
  it('drives an approved task through the implementation lifecycle in one run', async () => {
    await writeQueue([
      mkTask({
        id: 'a',
        status: 'ready',
        domain: 'looma',
        spec: 'approved spec',
        acceptanceCriteria: [
          {
            id: 'ac-1',
            description: 'Thing is done',
            verifiedBy: 'automated',
            command: 'pnpm test',
            met: true,
          },
        ],
      }),
    ])

    // Each agent transitions the task one step forward.
    const advance = (next: TaskStatus) => async () => {
      await mutateTask('a', {
        status: next,
        ...(next === 'done'
          ? {
              mergeRecord: {
                fromBranch: 'guildhall/task-a',
                toBranch: 'main',
                strategy: 'ff_only_local',
                result: 'merged',
                commitSha: 'abc123',
                mergedAt: '2026-04-29T00:00:00.000Z',
              },
            }
          : {}),
      })
    }

    const agents: OrchestratorAgentSet = {
      spec: stubAgent('spec-agent'),
      worker: stubAgent('worker-agent', advance('review')),
      reviewer: stubAgent('reviewer-agent', advance('gate_check')),
      gateChecker: stubAgent('gate-checker-agent', advance('done')),
      coordinators: {},
    }

    const orch = new Orchestrator({ config: baseConfig(), agents })
    await orch.run({ maxTicks: 20, tickDelayMs: 0 })

    const q = await readQueue()
    expect(q.tasks[0]!.status).toBe('done')
    const packet = await fs.readFile(
      path.join(memoryDir, 'tasks', 'a', 'review-packet.md'),
      'utf-8',
    )
    expect(packet).toContain('# Review packet: Do a thing')
    expect(packet).toContain('- Task: a')
    expect(packet).toContain('- Status: done')
    expect(packet).toContain('- [x] ac-1: Thing is done')
    expect(packet).toContain('## Merge')
    expect(packet).toContain('- merged: guildhall/task-a -> main via ff_only_local (abc123); 2026-04-29T00:00:00.000Z')
    expect(packet).toContain('Task is complete and merged.')
  })

  it('stopAfterOneTask stops after one active task reaches terminal status', async () => {
    await writeQueue([
      mkTask({ id: 'a', status: 'in_progress', domain: 'looma' }),
      mkTask({ id: 'b', status: 'ready', domain: 'looma', spec: 'approved spec' }),
    ])

    const mutateCurrentTask = (next: TaskStatus) => async (prompt: string) => {
      const match = prompt.match(/\*\*Current task ID \(for task tools\):\*\* ([^\n]+)/)
      const taskId = match?.[1]
      if (!taskId) throw new Error('missing current task id in prompt')
      await mutateTask(taskId, { status: next })
    }

    const agents: OrchestratorAgentSet = {
      spec: stubAgent('spec-agent'),
      worker: stubAgent('worker-agent', mutateCurrentTask('review')),
      reviewer: stubAgent('reviewer-agent', mutateCurrentTask('gate_check')),
      gateChecker: stubAgent('gate-checker-agent', mutateCurrentTask('done')),
      coordinators: {},
    }

    const orch = new Orchestrator({ config: baseConfig(), agents })
    await orch.run({ maxTicks: 20, tickDelayMs: 0, stopAfterOneTask: true })

    const q = await readQueue()
    expect(q.tasks.find((t) => t.id === 'a')?.status).toBe('done')
    expect(q.tasks.find((t) => t.id === 'b')?.status).toBe('ready')
  })

  it('stopAfterOneTask stops immediately when exploring work is waiting on the user', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'exploring', domain: 'knit' })])

    const agents: OrchestratorAgentSet = {
      spec: stubAgent(
        'spec-agent',
        undefined,
        'Pick one: should I spec only the happy path, or the full failure matrix?',
      ),
      worker: stubAgent('worker-agent'),
      reviewer: stubAgent('reviewer-agent'),
      gateChecker: stubAgent('gate-checker-agent'),
      coordinators: {},
    }

    const orch = new Orchestrator({ config: baseConfig(), agents })
    await orch.run({ maxTicks: 20, tickDelayMs: 0, stopAfterOneTask: true })

    expect(agents.spec.calls).toHaveLength(1)
    const q = await readQueue()
    const task = q.tasks.find((t) => t.id === 'a')!
    expect(task.status).toBe('exploring')
    expect(task.openQuestions).toHaveLength(1)
    expect(task.openQuestions?.[0]?.answeredAt).toBeUndefined()
  })

  it('stops early when all tasks are terminal (done/blocked)', async () => {
    await writeQueue([
      mkTask({ id: 'a', status: 'done' }),
      mkTask({ id: 'b', status: 'blocked' }),
    ])
    let completed = false
    const start = Date.now()
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    await orch.run({ maxTicks: 50, tickDelayMs: 0 })
    completed = true
    // Must complete on the first idle tick via the allDone short-circuit,
    // not by exhausting maxTicks.
    expect(completed).toBe(true)
    expect(Date.now() - start).toBeLessThan(500)
  })

  it('FR-28 / AC-19: honors an external memory/stop-requested marker between ticks', async () => {
    // An always-active task keeps the loop running — the marker is what
    // should cut it short, not task exhaustion.
    await writeQueue([mkTask({ id: 'a', status: 'in_progress', domain: 'looma' })])

    let ticks = 0
    const markerPath = path.join(memoryDir, 'stop-requested')
    const stopSignal = { stopRequested: false }

    const agents: OrchestratorAgentSet = {
      spec: stubAgent('spec-agent', async () => {}),
      worker: {
        name: 'worker-agent',
        calls: [] as { prompt: string }[],
        async generate() {
          ticks++
          if (ticks === 2) {
            // Simulate an external operator writing the marker — no SIGINT
            // delivery, no dashboard stop button.
            await fs.writeFile(markerPath, '{"requestedBy":"external"}', 'utf-8')
          }
          return { text: 'ok' }
        },
      } as unknown as OrchestratorAgentSet['worker'],
      reviewer: stubAgent('reviewer-agent', async () => {}),
      gateChecker: stubAgent('gate-checker-agent', async () => {}),
      coordinators: {
        looma: stubAgent('looma-coordinator', async () => {}),
      },
    }

    const orch = new Orchestrator({ config: baseConfig(), agents, stopSignal })
    await orch.run({ maxTicks: 20, tickDelayMs: 0 })

    expect(stopSignal.stopRequested).toBe(true)
    // Should have exited within a couple of ticks of the marker appearing,
    // not run to the maxTicks=20 ceiling.
    expect(ticks).toBeLessThan(10)
  })
})

// ---------------------------------------------------------------------------
// FR-10: structured escalation events
// ---------------------------------------------------------------------------

describe('Orchestrator.tick — FR-10 escalations', () => {
  it('surfaces an `escalated` outcome when an agent raises an escalation', async () => {
    await writeQueue([mkTask({ status: 'in_progress' })])
    const worker = stubAgent('worker-agent', async () => {
      // Simulate the worker calling raise-escalation: appends to escalations
      // and flips status to blocked.
      await mutateTask('task-001', {
        status: 'blocked',
        blockReason: 'decision_required: need choice',
        escalations: [
          {
            id: 'esc-task-001-1',
            taskId: 'task-001',
            agentId: 'worker-agent',
            reason: 'decision_required',
            summary: 'need choice',
            raisedAt: '2026-04-01T00:00:01Z',
          },
        ],
      })
    })
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
    })
    const outcome = await orch.tick()
    expect(outcome.kind).toBe('escalated')
    if (outcome.kind === 'escalated') {
      expect(outcome.taskId).toBe('task-001')
      expect(outcome.agent).toBe('worker-agent')
      expect(outcome.reason).toBe('decision_required')
      expect(outcome.escalationId).toBe('esc-task-001-1')
    }
  })

  it('skips tasks with open escalations even if status is not blocked', async () => {
    // Defense-in-depth: even if status somehow gets unblocked while an
    // escalation remains open, pickNextTask must still halt the task.
    await writeQueue([
      mkTask({
        id: 'a',
        status: 'in_progress',
        escalations: [
          {
            id: 'esc-a-1',
            taskId: 'a',
            agentId: 'x',
            reason: 'decision_required',
            summary: 's',
            raisedAt: '2026-04-01T00:00:00Z',
          },
        ],
      }),
      mkTask({ id: 'b', status: 'in_progress' }),
    ])
    const picked = pickNextTask(await readQueue())
    expect(picked?.id).toBe('b')
  })

  it('resumes routing once the escalation is resolved', async () => {
    const raisedAt = '2026-04-01T00:00:00Z'
    await writeQueue([
      mkTask({
        status: 'blocked',
        escalations: [
          {
            id: 'esc-task-001-1',
            taskId: 'task-001',
            agentId: 'worker-agent',
            reason: 'decision_required',
            summary: 's',
            raisedAt,
          },
        ],
      }),
    ])
    // Simulate human resolving the escalation (flip status back + mark resolved)
    await mutateTask('task-001', {
      status: 'in_progress',
      escalations: [
        {
          id: 'esc-task-001-1',
          taskId: 'task-001',
          agentId: 'worker-agent',
          reason: 'decision_required',
          summary: 's',
          raisedAt,
          resolvedAt: '2026-04-01T01:00:00Z',
          resolvedBy: 'human',
          resolution: 'pick A',
        },
      ],
    })
    const picked = pickNextTask(await readQueue())
    expect(picked?.id).toBe('task-001')
  })

  it('routes max-revisions block through the structured escalation protocol', async () => {
    // Task is on its final allowed revision; one more review→in_progress bump
    // should trigger an auto-escalation.
    await writeQueue([
      mkTask({ status: 'review', revisionCount: 3 }),
    ])
    const reviewer = stubAgent('reviewer-agent', async () => {
      await mutateTask('task-001', { status: 'in_progress' })
    })
    const orch = new Orchestrator({
      config: baseConfig({ maxRevisions: 3 }),
      agents: agentSet({ reviewer }),
    })
    const outcome = await orch.tick()
    expect(outcome.kind).toBe('blocked-max-revisions')

    const q = await readQueue()
    const task = q.tasks[0]!
    expect(task.status).toBe('blocked')
    expect(task.escalations).toHaveLength(1)
    expect(task.escalations[0]!.reason).toBe('max_revisions_exceeded')
    expect(task.escalations[0]!.agentId).toBe('reviewer-agent')
    expect(task.escalations[0]!.summary).toContain('maxRevisions')
  })

  it('writes an escalation progress entry when max-revisions fires', async () => {
    await writeQueue([mkTask({ status: 'review', revisionCount: 3 })])
    const reviewer = stubAgent('reviewer-agent', async () => {
      await mutateTask('task-001', { status: 'in_progress' })
    })
    const orch = new Orchestrator({
      config: baseConfig({ maxRevisions: 3 }),
      agents: agentSet({ reviewer }),
    })
    await orch.tick()
    const progress = await fs.readFile(progressPath, 'utf-8')
    expect(progress).toContain('ESCALATION')
    expect(progress).toContain('max_revisions_exceeded')
  })

  it('does not double-log when an agent raises a fresh escalation', async () => {
    // When an agent raises an escalation itself, raise-escalation already
    // writes the progress entry. The orchestrator must NOT also write a
    // heartbeat for the same tick.
    await writeQueue([mkTask({ status: 'in_progress' })])
    const worker = stubAgent('worker-agent', async () => {
      // Simulate the agent calling raise-escalation, which writes a line
      // directly to PROGRESS.md and mutates the task.
      await fs.appendFile(
        progressPath,
        '\n### 🆘 ESCALATION — 2026-04-01T00:00:00Z\nsynthetic direct entry\n---\n',
        'utf-8',
      )
      await mutateTask('task-001', {
        status: 'blocked',
        escalations: [
          {
            id: 'esc-task-001-1',
            taskId: 'task-001',
            agentId: 'worker-agent',
            reason: 'human_judgment_required',
            summary: 's',
            raisedAt: '2026-04-01T00:00:00Z',
          },
        ],
      })
    })
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
    })
    await orch.tick()
    const progress = await fs.readFile(progressPath, 'utf-8')
    const escalationCount = (progress.match(/ESCALATION/g) ?? []).length
    // Exactly one entry (from the tool, not the orchestrator)
    expect(escalationCount).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// FR-15 per-task permission modes: the orchestrator calls setPermissionMode on
// the dispatched agent before generate(), using the task's `permissionMode`
// field if set, or FULL_AUTO (which the agent clamps to its baseline) if not.
// ---------------------------------------------------------------------------
import { PermissionMode } from '@guildhall/engine'

interface ModeAwareStubAgent extends StubAgent {
  modeCalls: PermissionMode[]
  setPermissionMode(mode: PermissionMode): PermissionMode
}

function modeAwareStubAgent(
  name: string,
  sideEffect?: (prompt: string) => Promise<void> | void,
): ModeAwareStubAgent {
  const calls: { prompt: string }[] = []
  const modeCalls: PermissionMode[] = []
  let current = PermissionMode.FULL_AUTO
  return {
    name,
    calls,
    modeCalls,
    setPermissionMode(mode: PermissionMode) {
      modeCalls.push(mode)
      current = mode
      return current
    },
    async generate(prompt: string) {
      calls.push({ prompt })
      if (sideEffect) await sideEffect(prompt)
      return { text: 'ok' }
    },
  }
}

describe('Orchestrator.tick — FR-15 per-task permission modes', () => {
  it('applies task.permissionMode to the dispatched agent before generate()', async () => {
    await writeQueue([
      mkTask({ id: 'a', status: 'in_progress', permissionMode: 'plan' }),
    ])
    const worker = modeAwareStubAgent('worker-agent')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
    })
    await orch.tick()
    expect(worker.modeCalls).toEqual([PermissionMode.PLAN])
  })

  it('asks for FULL_AUTO when the task has no permissionMode override', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'in_progress' })])
    const worker = modeAwareStubAgent('worker-agent')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
    })
    await orch.tick()
    expect(worker.modeCalls).toEqual([PermissionMode.FULL_AUTO])
  })

  it('re-applies mode on every tick so narrowed state does not stick', async () => {
    await writeQueue([
      mkTask({ id: 'a', status: 'in_progress', permissionMode: 'plan' }),
    ])
    const worker = modeAwareStubAgent('worker-agent', async () => {
      // Simulate the worker mutating status forward; then change the on-disk
      // task so the next tick has no permissionMode.
      await mutateTask('a', { status: 'review', permissionMode: undefined })
    })
    const reviewer = modeAwareStubAgent('reviewer-agent')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker, reviewer }),
    })
    await orch.tick() // dispatches to worker with PLAN
    await orch.tick() // dispatches to reviewer (no override) → FULL_AUTO
    expect(worker.modeCalls).toEqual([PermissionMode.PLAN])
    expect(reviewer.modeCalls).toEqual([PermissionMode.FULL_AUTO])
  })

  it('supports default mode as an intermediate narrowing', async () => {
    await writeQueue([
      mkTask({ id: 'a', status: 'in_progress', permissionMode: 'default' }),
    ])
    const worker = modeAwareStubAgent('worker-agent')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
    })
    await orch.tick()
    expect(worker.modeCalls).toEqual([PermissionMode.DEFAULT])
  })

  it('silently skips permission-mode wiring for agents without setPermissionMode', async () => {
    await writeQueue([
      mkTask({ id: 'a', status: 'in_progress', permissionMode: 'plan' }),
    ])
    const worker = stubAgent('worker-agent')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
    })
    // Must not throw even though the stub has no setPermissionMode.
    const out = await orch.tick()
    expect(out.kind).toBe('processed')
  })
})

// ---------------------------------------------------------------------------
// FR-18 hook lifecycle — SESSION_START / SESSION_END
// ---------------------------------------------------------------------------
describe('Orchestrator.run — FR-18 session hooks', () => {
  interface RecordingHookExecutor {
    calls: { event: string; payload: Record<string, unknown> }[]
    execute(event: string, payload: Record<string, unknown>): Promise<{ blocked: boolean; reason?: string }>
  }

  function recordingExecutor(
    blockOn?: string,
    reason = 'blocked by test',
  ): RecordingHookExecutor {
    const calls: RecordingHookExecutor['calls'] = []
    return {
      calls,
      async execute(event, payload) {
        calls.push({ event, payload })
        if (blockOn && event === blockOn) return { blocked: true, reason }
        return { blocked: false }
      },
    }
  }

  it('fires SESSION_START before the first tick and SESSION_END after the loop exits', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'done' })])
    const hookExecutor = recordingExecutor()
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      hookExecutor: hookExecutor as any,
    })
    await orch.run({ maxTicks: 1, tickDelayMs: 0 })
    const events = hookExecutor.calls.map((c) => c.event)
    expect(events[0]).toBe('session_start')
    expect(events[events.length - 1]).toBe('session_end')
  })

  it('aborts run() before any tick when SESSION_START blocks', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'exploring' })])
    const spec = stubAgent('spec-agent')
    const hookExecutor = recordingExecutor('session_start')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ spec }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      hookExecutor: hookExecutor as any,
    })
    await orch.run({ maxTicks: 3, tickDelayMs: 0 })
    expect(spec.calls).toHaveLength(0)
    // Only SESSION_START fired — no SESSION_END since we aborted
    const events = hookExecutor.calls.map((c) => c.event)
    expect(events).toEqual(['session_start'])
  })

  it('still fires SESSION_END when SESSION_START does not block', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'done' })])
    const hookExecutor = recordingExecutor()
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      hookExecutor: hookExecutor as any,
    })
    await orch.run({ maxTicks: 1, tickDelayMs: 0 })
    expect(hookExecutor.calls.some((c) => c.event === 'session_end')).toBe(true)
  })

  it('SESSION_END payload includes the tick count', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'done' })])
    const hookExecutor = recordingExecutor()
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      hookExecutor: hookExecutor as any,
    })
    await orch.run({ maxTicks: 2, tickDelayMs: 0 })
    const end = hookExecutor.calls.find((c) => c.event === 'session_end')
    expect(end).toBeDefined()
    expect(end!.payload['ticks']).toBeGreaterThan(0)
    expect(end!.payload['workspaceId']).toBe('test-ws')
  })
})

// ---------------------------------------------------------------------------
// FR-21 proposal promotion — the orchestrator consults the `task_origination`
// lever for the task's domain and applies the resulting status transition
// without calling an LLM agent.
// ---------------------------------------------------------------------------

describe('Orchestrator.tick — FR-21 proposal promotion', () => {
  async function writeLevers(
    origination: DomainLevers['task_origination']['position'],
  ): Promise<void> {
    const settings: LeverSettings = makeDefaultSettings(new Date('2026-04-20T00:00:00Z'))
    settings.domains.default.task_origination = {
      position: origination,
      rationale: 'test override',
      setAt: '2026-04-20T00:00:00Z',
      setBy: 'user-direct',
    }
    await saveLeverSettings({
      path: path.join(memoryDir, AGENT_SETTINGS_FILENAME),
      settings,
    })
  }

  function proposal(overrides: Partial<Task> = {}): Task {
    return mkTask({
      id: 'prop-1',
      status: 'proposed',
      origination: 'agent',
      proposedBy: 'worker:looma:session-7',
      proposalRationale: 'noticed missing coverage on parseUrl',
      ...overrides,
    })
  }

  it('auto-promotes a proposal to ready when task_origination=agent_autonomous', async () => {
    await writeLevers('agent_autonomous')
    await writeQueue([proposal()])
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    const out = await orch.tick()
    expect(out.kind).toBe('proposal-decided')
    if (out.kind === 'proposal-decided') {
      expect(out.actionKind).toBe('auto_promote')
      expect(out.newStatus).toBe('ready')
      expect(out.leverPosition).toBe('agent_autonomous')
    }
    const q = await readQueue()
    expect(q.tasks[0]!.status).toBe('ready')
  })

  it('routes a proposal to spec_review when task_origination=agent_proposed_human_approved', async () => {
    await writeLevers('agent_proposed_human_approved')
    await writeQueue([proposal()])
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    const out = await orch.tick()
    expect(out.kind).toBe('proposal-decided')
    if (out.kind === 'proposal-decided') {
      expect(out.actionKind).toBe('route_to_human')
      expect(out.newStatus).toBe('spec_review')
    }
    const q = await readQueue()
    expect(q.tasks[0]!.status).toBe('spec_review')
  })

  it('routes a proposal to spec_review when task_origination=agent_proposed_coordinator_approved', async () => {
    await writeLevers('agent_proposed_coordinator_approved')
    await writeQueue([proposal()])
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    const out = await orch.tick()
    expect(out.kind).toBe('proposal-decided')
    if (out.kind === 'proposal-decided') {
      expect(out.actionKind).toBe('route_to_coordinator')
      expect(out.newStatus).toBe('spec_review')
    }
  })

  it('shelves a proposal when task_origination=human_only', async () => {
    await writeLevers('human_only')
    await writeQueue([proposal()])
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    const out = await orch.tick()
    expect(out.kind).toBe('proposal-decided')
    if (out.kind === 'proposal-decided') {
      expect(out.actionKind).toBe('reject')
      expect(out.newStatus).toBe('shelved')
      expect(out.leverPosition).toBe('human_only')
    }
    const q = await readQueue()
    const t = q.tasks[0]!
    expect(t.status).toBe('shelved')
    expect(t.shelveReason?.code).toBe('not_viable')
    expect(t.shelveReason?.detail).toMatch(/human_only/)
    expect(t.shelveReason?.rejectedBy).toBe('system:proposal-promoter')
    expect(t.completedAt).toBeDefined()
  })

  it('seeds default lever settings when agent-settings.yaml is missing and routes proposal accordingly', async () => {
    // Default task_origination is `agent_proposed_coordinator_approved`.
    // No writeLevers call — let the orchestrator seed defaults on first read.
    await writeQueue([proposal()])
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    const out = await orch.tick()
    expect(out.kind).toBe('proposal-decided')
    if (out.kind === 'proposal-decided') {
      expect(out.actionKind).toBe('route_to_coordinator')
    }
    // Defaults file was materialized for future ticks.
    const seeded = await fs.readFile(
      path.join(memoryDir, AGENT_SETTINGS_FILENAME),
      'utf-8',
    )
    expect(seeded).toContain('task_origination')
  })

  it('honors per-domain overrides when resolving the lever', async () => {
    const settings = makeDefaultSettings(new Date('2026-04-20T00:00:00Z'))
    settings.domains.default.task_origination = {
      position: 'human_only',
      rationale: 'default is human_only',
      setAt: '2026-04-20T00:00:00Z',
      setBy: 'user-direct',
    }
    settings.domains.overrides = {
      looma: {
        task_origination: {
          position: 'agent_autonomous',
          rationale: 'looma is an agentic domain',
          setAt: '2026-04-20T00:00:00Z',
          setBy: 'user-direct',
        },
      },
    }
    await saveLeverSettings({
      path: path.join(memoryDir, AGENT_SETTINGS_FILENAME),
      settings,
    })
    await writeQueue([proposal({ domain: 'looma' })])
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    const out = await orch.tick()
    expect(out.kind).toBe('proposal-decided')
    if (out.kind === 'proposal-decided') {
      expect(out.actionKind).toBe('auto_promote')
      expect(out.newStatus).toBe('ready')
    }
  })

  it('does not invoke any agent when handling a proposal', async () => {
    await writeLevers('agent_autonomous')
    await writeQueue([proposal()])
    const spec = stubAgent('spec-agent')
    const worker = stubAgent('worker-agent')
    const coord = stubAgent('looma-coordinator')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ spec, worker, coordinators: { looma: coord } }),
    })
    await orch.tick()
    expect(spec.calls).toHaveLength(0)
    expect(worker.calls).toHaveLength(0)
    expect(coord.calls).toHaveLength(0)
  })

  it('logs a heartbeat progress entry summarizing the promotion decision', async () => {
    await writeLevers('agent_autonomous')
    await writeQueue([proposal()])
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet(),
      now: () => '2026-04-20T12:00:00Z',
    })
    await orch.tick()
    const progress = await fs.readFile(progressPath, 'utf-8')
    expect(progress).toContain('HEARTBEAT')
    expect(progress).toContain('proposal-promoter')
    expect(progress).toContain('auto_promote')
    expect(progress).toContain('agent_autonomous')
    expect(progress).toContain('prop-1')
  })

  it('picks proposals before exploration when both are on the board', async () => {
    await writeLevers('agent_autonomous')
    await writeQueue([
      mkTask({ id: 'explore-1', status: 'exploring' }),
      proposal({ id: 'prop-1' }),
    ])
    const spec = stubAgent('spec-agent')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ spec }),
    })
    const out = await orch.tick()
    expect(out.kind).toBe('proposal-decided')
    if (out.kind === 'proposal-decided') expect(out.taskId).toBe('prop-1')
    expect(spec.calls).toHaveLength(0)
  })

  it('treats shelved tasks as terminal in the idle allDone check', async () => {
    await writeQueue([
      mkTask({ id: 'a', status: 'done' }),
      mkTask({
        id: 'b',
        status: 'shelved',
        shelveReason: {
          code: 'not_viable',
          detail: 'x',
          rejectedBy: 'w',
          rejectedAt: '2026-04-20T00:00:00Z',
          source: 'worker_pre_rejection',
          policyApplied: true,
          requeueCount: 0,
        },
      }),
    ])
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    const out = await orch.tick()
    expect(out.kind).toBe('idle')
    if (out.kind === 'idle') expect(out.allDone).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// FR-22 pre-rejection policy — the orchestrator consults pre_rejection_policy
// (domain) and rejection_dampening (project) for freshly worker-shelved tasks
// and either keeps them shelved or resurrects them to ready at lowered
// priority. Applied without any LLM invocation.
// ---------------------------------------------------------------------------

describe('Orchestrator.tick — FR-22 pre-rejection policy', () => {
  async function writeLeverPair(
    domainPos: DomainLevers['pre_rejection_policy']['position'],
    dampPos: LeverSettings['project']['rejection_dampening']['position'] = { kind: 'off' },
  ): Promise<void> {
    const settings: LeverSettings = makeDefaultSettings(new Date('2026-04-20T00:00:00Z'))
    settings.domains.default.pre_rejection_policy = {
      position: domainPos,
      rationale: 'test',
      setAt: '2026-04-20T00:00:00Z',
      setBy: 'user-direct',
    }
    settings.project.rejection_dampening = {
      position: dampPos,
      rationale: 'test',
      setAt: '2026-04-20T00:00:00Z',
      setBy: 'user-direct',
    }
    await saveLeverSettings({
      path: path.join(memoryDir, AGENT_SETTINGS_FILENAME),
      settings,
    })
  }

  function shelved(overrides: Partial<Task> = {}): Task {
    return mkTask({
      id: 'shelve-1',
      status: 'shelved',
      priority: 'normal',
      shelveReason: {
        code: 'not_viable',
        detail: 'no external API',
        rejectedBy: 'worker:looma:session-3',
        rejectedAt: '2026-04-20T00:00:00Z',
        source: 'worker_pre_rejection',
        policyApplied: false,
        requeueCount: 0,
      },
      completedAt: '2026-04-20T00:00:00Z',
      ...overrides,
    })
  }

  it('keeps the task shelved when pre_rejection_policy=terminal_shelved', async () => {
    await writeLeverPair('terminal_shelved')
    await writeQueue([shelved()])
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    const out = await orch.tick()
    expect(out.kind).toBe('pre-rejection-applied')
    if (out.kind === 'pre-rejection-applied') {
      expect(out.actionKind).toBe('keep_shelved')
      expect(out.newStatus).toBe('shelved')
      expect(out.requeueCount).toBe(1)
    }
    const q = await readQueue()
    const t = q.tasks[0]!
    expect(t.status).toBe('shelved')
    expect(t.shelveReason?.policyApplied).toBe(true)
    expect(t.shelveReason?.requeueCount).toBe(1)
  })

  it('requeues with priority stepped down when requeue_lower_priority is set', async () => {
    await writeLeverPair('requeue_lower_priority')
    await writeQueue([shelved({ priority: 'high' })])
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    const out = await orch.tick()
    expect(out.kind).toBe('pre-rejection-applied')
    if (out.kind === 'pre-rejection-applied') {
      expect(out.actionKind).toBe('requeue')
      expect(out.newStatus).toBe('ready')
    }
    const q = await readQueue()
    const t = q.tasks[0]!
    expect(t.status).toBe('ready')
    expect(t.priority).toBe('normal')
    expect(t.shelveReason?.policyApplied).toBe(true)
    expect(t.shelveReason?.requeueCount).toBe(1)
    // Task is no longer terminal — completedAt cleared.
    expect(t.completedAt).toBeUndefined()
  })

  it('suppresses the task once hard_suppress threshold is reached', async () => {
    await writeLeverPair('requeue_with_dampening', { kind: 'hard_suppress', after: 2 })
    // currentRequeueCount=1 → nextCount=2 → at threshold → suppressed.
    await writeQueue([
      shelved({
        shelveReason: {
          code: 'not_viable',
          detail: 'x',
          rejectedBy: 'w',
          rejectedAt: '2026-04-20T00:00:00Z',
          source: 'worker_pre_rejection',
          policyApplied: false,
          requeueCount: 1,
        },
      }),
    ])
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    const out = await orch.tick()
    expect(out.kind).toBe('pre-rejection-applied')
    if (out.kind === 'pre-rejection-applied') {
      expect(out.actionKind).toBe('keep_shelved')
      expect(out.requeueCount).toBe(2)
    }
    const q = await readQueue()
    expect(q.tasks[0]!.status).toBe('shelved')
    expect(q.tasks[0]!.shelveReason?.policyApplied).toBe(true)
  })

  it('floors priority to low when soft_penalty threshold is crossed', async () => {
    await writeLeverPair('requeue_with_dampening', { kind: 'soft_penalty', after: 3 })
    await writeQueue([
      shelved({
        priority: 'high',
        shelveReason: {
          code: 'not_viable',
          detail: 'x',
          rejectedBy: 'w',
          rejectedAt: '2026-04-20T00:00:00Z',
          source: 'worker_pre_rejection',
          policyApplied: false,
          requeueCount: 2,
        },
      }),
    ])
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    await orch.tick()
    const q = await readQueue()
    const t = q.tasks[0]!
    expect(t.status).toBe('ready')
    expect(t.priority).toBe('low')
    expect(t.shelveReason?.requeueCount).toBe(3)
  })

  it('skips tasks whose policyApplied is already true', async () => {
    await writeLeverPair('terminal_shelved')
    await writeQueue([
      shelved({
        shelveReason: {
          code: 'not_viable',
          detail: 'x',
          rejectedBy: 'w',
          rejectedAt: '2026-04-20T00:00:00Z',
          source: 'worker_pre_rejection',
          policyApplied: true,
          requeueCount: 1,
        },
      }),
    ])
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    const out = await orch.tick()
    // Already-processed shelved tasks should be idle.
    expect(out.kind).toBe('idle')
  })

  it('ignores shelves created by proposal_policy', async () => {
    // A proposal-policy rejection should never be re-processed as a worker
    // pre-rejection — its source is tagged to prevent that.
    await writeLeverPair('requeue_lower_priority')
    await writeQueue([
      shelved({
        shelveReason: {
          code: 'not_viable',
          detail: 'human_only lever',
          rejectedBy: 'system:proposal-promoter',
          rejectedAt: '2026-04-20T00:00:00Z',
          source: 'proposal_policy',
          policyApplied: true,
          requeueCount: 0,
        },
      }),
    ])
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    const out = await orch.tick()
    expect(out.kind).toBe('idle')
  })

  it('invokes no agent when applying pre-rejection policy', async () => {
    await writeLeverPair('requeue_lower_priority')
    await writeQueue([shelved()])
    const worker = stubAgent('worker-agent')
    const reviewer = stubAgent('reviewer-agent')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker, reviewer }),
    })
    await orch.tick()
    expect(worker.calls).toHaveLength(0)
    expect(reviewer.calls).toHaveLength(0)
  })

  it('logs a heartbeat progress entry summarizing the decision', async () => {
    await writeLeverPair('requeue_lower_priority')
    await writeQueue([shelved()])
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet(),
      now: () => '2026-04-20T12:00:00Z',
    })
    await orch.tick()
    const progress = await fs.readFile(progressPath, 'utf-8')
    expect(progress).toContain('HEARTBEAT')
    expect(progress).toContain('pre-rejection-policy')
    expect(progress).toContain('requeue_lower_priority')
    expect(progress).toContain('shelve-1')
  })

  it('services pre-rejections before proposals when both are pending', async () => {
    await writeLeverPair('requeue_lower_priority')
    await writeQueue([
      mkTask({
        id: 'prop-1',
        status: 'proposed',
        origination: 'agent',
        proposedBy: 'a',
        proposalRationale: 'r',
      }),
      shelved({ id: 'shelve-1' }),
    ])
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    const out = await orch.tick()
    expect(out.kind).toBe('pre-rejection-applied')
    if (out.kind === 'pre-rejection-applied') expect(out.taskId).toBe('shelve-1')
  })

  it('allows resurrected tasks to be picked by the worker on the next tick', async () => {
    await writeLeverPair('requeue_lower_priority')
    await writeQueue([shelved()])
    const worker = stubAgent('worker-agent')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
    })
    const first = await orch.tick()
    expect(first.kind).toBe('pre-rejection-applied')
    // After resurrection the task is `ready` but no coordinator is wired for
    // its domain — the picker should still surface it because `ready` is
    // actionable. With no coordinator the next tick reports no-coordinator
    // rather than processing, but critically pickNextTask MUST not return
    // undefined (otherwise we'd be idle).
    const second = await orch.tick()
    expect(second.kind).not.toBe('idle')
  })

  it('surfaces an agent-error outcome if lever settings are corrupt during proposal handling', async () => {
    // Mirrors the FR-21 corrupt-settings test, but exercises the pre-rejection
    // path — a malformed agent-settings.yaml should produce an agent-error
    // rather than silently falling through to idle.
    await fs.writeFile(
      path.join(memoryDir, AGENT_SETTINGS_FILENAME),
      'not: [valid: yaml',
      'utf-8',
    )
    await writeQueue([
      mkTask({
        id: 'prop-corrupt',
        status: 'proposed',
        origination: 'agent',
        proposedBy: 'a',
        proposalRationale: 'r',
      }),
    ])
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    const out = await orch.tick()
    expect(out.kind).toBe('agent-error')
    if (out.kind === 'agent-error') {
      expect(out.error).toMatch(/lever settings/)
    }
  })
})

// ---------------------------------------------------------------------------
// FR-31: structured agent-issue channel
//
// Issues are raised via the `report_issue` tool by the running agent. The
// orchestrator's `drainPendingIssues()` returns them on demand and flips the
// `broadcast` flag so they are only emitted once. Unlike escalations, issues
// do NOT change task status — the task keeps running through its lifecycle.
// ---------------------------------------------------------------------------
describe('Orchestrator — FR-31 agent-issue channel', () => {
  it('drainPendingIssues returns all unbroadcast issues and flips the flag', async () => {
    await writeQueue([
      mkTask({
        id: 't-1',
        status: 'in_progress',
        agentIssues: [
          {
            id: 'iss-t-1-1',
            taskId: 't-1',
            agentId: 'worker-agent',
            code: 'stuck',
            severity: 'warn',
            detail: 'No progress after three attempts',
            raisedAt: '2026-04-20T00:00:00Z',
            broadcast: false,
          },
          {
            id: 'iss-t-1-2',
            taskId: 't-1',
            agentId: 'worker-agent',
            code: 'tool_unavailable',
            severity: 'critical',
            detail: 'ripgrep not found',
            raisedAt: '2026-04-20T00:00:01Z',
            broadcast: false,
          },
        ],
      }),
    ])
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })

    const first = await orch.drainPendingIssues()
    expect(first.map((i) => i.id)).toEqual(['iss-t-1-1', 'iss-t-1-2'])

    // Second drain: the flag should now be set on disk, so nothing new.
    const second = await orch.drainPendingIssues()
    expect(second).toEqual([])

    const q = await readQueue()
    expect(q.tasks[0]!.agentIssues.every((i) => i.broadcast)).toBe(true)
  })

  it('does not drain resolved issues even if broadcast=false', async () => {
    // An issue marked resolvedAt should not be re-broadcast. This guards
    // against the coordinator resolving an issue before it was ever seen
    // by subscribers — the resolution is authoritative.
    await writeQueue([
      mkTask({
        id: 't-1',
        status: 'in_progress',
        agentIssues: [
          {
            id: 'iss-t-1-1',
            taskId: 't-1',
            agentId: 'worker-agent',
            code: 'stuck',
            severity: 'warn',
            detail: 'x',
            raisedAt: '2026-04-20T00:00:00Z',
            broadcast: false,
            resolvedAt: '2026-04-20T00:05:00Z',
            resolution: 'coordinator decided: wait',
            resolvedBy: 'coordinator:looma',
          },
        ],
      }),
    ])
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    expect(await orch.drainPendingIssues()).toEqual([])
  })

  it('does not alter task status when draining', async () => {
    await writeQueue([
      mkTask({
        id: 't-1',
        status: 'in_progress',
        agentIssues: [
          {
            id: 'iss-t-1-1',
            taskId: 't-1',
            agentId: 'worker-agent',
            code: 'stuck',
            severity: 'warn',
            detail: 'x',
            raisedAt: '2026-04-20T00:00:00Z',
            broadcast: false,
          },
        ],
      }),
    ])
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    await orch.drainPendingIssues()
    const q = await readQueue()
    expect(q.tasks[0]!.status).toBe('in_progress')
  })

  it('handles multiple tasks with issues in a single drain', async () => {
    await writeQueue([
      mkTask({
        id: 't-a',
        status: 'in_progress',
        agentIssues: [
          {
            id: 'iss-t-a-1',
            taskId: 't-a',
            agentId: 'w',
            code: 'stuck',
            severity: 'warn',
            detail: 'a',
            raisedAt: '2026-04-20T00:00:00Z',
            broadcast: false,
          },
        ],
      }),
      mkTask({
        id: 't-b',
        status: 'review',
        agentIssues: [
          {
            id: 'iss-t-b-1',
            taskId: 't-b',
            agentId: 'r',
            code: 'spec_incoherent',
            severity: 'warn',
            detail: 'b',
            raisedAt: '2026-04-20T00:00:00Z',
            broadcast: false,
          },
        ],
      }),
    ])
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    const drained = await orch.drainPendingIssues()
    expect(drained.map((i) => i.id).sort()).toEqual(['iss-t-a-1', 'iss-t-b-1'])
  })

  it('returns an empty array when no issues exist (no queue write)', async () => {
    await writeQueue([mkTask({ id: 't-1', status: 'in_progress' })])
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    const before = await fs.stat(tasksPath)
    const drained = await orch.drainPendingIssues()
    const after = await fs.stat(tasksPath)
    expect(drained).toEqual([])
    // mtime should be unchanged — draining a no-op must not bump the file
    expect(after.mtimeMs).toBe(before.mtimeMs)
  })
})

// ---------------------------------------------------------------------------
// FR-30: agent liveness via event-stream silence
//
// The orchestrator's liveness tracker is fed by the event stream (which in
// the current in-process model reduces to register-around-generate). These
// tests pin that the register/unregister bookkeeping survives all the exit
// paths of `tick()`: clean return, agent error, escalation, and the
// policy-decision early branches (proposal / pre-rejection) that must NOT
// touch the tracker at all.
// ---------------------------------------------------------------------------
describe('Orchestrator — FR-30 liveness tracking', () => {
  it('registers an agent for the duration of generate() and unregisters on clean return', async () => {
    await writeQueue([mkTask({ id: 't-1', status: 'in_progress' })])
    let snapshotDuringGenerate: Array<{ agentId: string; taskId: string }> = []
    const worker = stubAgent('worker-agent', () => {
      snapshotDuringGenerate = orch.liveness
        .snapshot()
        .map((e) => ({ agentId: e.agentId, taskId: e.taskId }))
    })
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
    })

    await orch.tick()
    expect(snapshotDuringGenerate).toEqual([
      { agentId: 'worker-agent', taskId: 't-1' },
    ])
    // After tick returns cleanly, registration is lifted
    expect(orch.liveness.snapshot()).toEqual([])
  })

  it('unregisters even when the agent throws', async () => {
    await writeQueue([mkTask({ id: 't-1', status: 'in_progress' })])
    const worker = stubAgent('worker-agent', () => {
      throw new Error('boom')
    })
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
    })
    const out = await orch.tick()
    expect(out.kind).toBe('agent-error')
    // Critical — a crashed agent left registered would forever flag as
    // stalled on every subsequent scan.
    expect(orch.liveness.snapshot()).toEqual([])
  })

  it('does NOT register for pure-policy ticks (proposal decisions invoke no LLM)', async () => {
    const settings = makeDefaultSettings(new Date('2026-04-20T00:00:00Z'))
    settings.domains.default.task_origination = {
      position: 'agent_autonomous',
      rationale: 'x',
      setAt: '2026-04-20T00:00:00Z',
      setBy: 'user-direct',
    }
    await saveLeverSettings({
      path: path.join(memoryDir, AGENT_SETTINGS_FILENAME),
      settings,
    })
    await writeQueue([
      mkTask({
        id: 't-prop',
        status: 'proposed',
        origination: 'agent',
        proposedBy: 'worker-agent',
        proposalRationale: 'why',
      }),
    ])
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    const out = await orch.tick()
    expect(out.kind).toBe('proposal-decided')
    // No LLM = no registration
    expect(orch.liveness.snapshot()).toEqual([])
  })

  it('scanStalls flags an agent that has been registered but silent past the strict threshold', () => {
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet(),
    })
    orch.liveness.setStrictness('strict')
    // Simulate a registered agent whose clock has advanced past 45s. The
    // real watchdog runs off-loop; we invoke scanStalls with a nowOverride
    // to assert it returns the right flag.
    orch.liveness.register('out-of-process-worker', 't-1')
    const base = orch.liveness.snapshot()[0]!.lastEventAt
    const flags = orch.scanStalls(base + 50_000)
    expect(flags).toHaveLength(1)
    expect(flags[0]!.agentId).toBe('out-of-process-worker')
    expect(flags[0]!.strictness).toBe('strict')
  })

  it('refreshLivenessStrictness picks up the lever position', async () => {
    const settings = makeDefaultSettings(new Date('2026-04-20T00:00:00Z'))
    settings.project.agent_health_strictness = {
      position: 'strict',
      rationale: 'tight watchdog',
      setAt: '2026-04-20T00:00:00Z',
      setBy: 'user-direct',
    }
    await saveLeverSettings({
      path: path.join(memoryDir, AGENT_SETTINGS_FILENAME),
      settings,
    })
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    // Default strictness is 'standard' until refresh is called.
    orch.liveness.register('w', 't')
    expect(orch.scanStalls(orch.liveness.snapshot()[0]!.lastEventAt + 50_000)).toEqual(
      [],
    )

    await orch.refreshLivenessStrictness()
    expect(
      orch.scanStalls(orch.liveness.snapshot()[0]!.lastEventAt + 50_000),
    ).toHaveLength(1)
  })

  it('refreshLivenessStrictness falls back to standard on missing lever file', async () => {
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    // No lever file written — refresh should not throw and should leave
    // tracker in a usable state.
    await orch.refreshLivenessStrictness()
    orch.liveness.register('w', 't')
    expect(
      orch.scanStalls(orch.liveness.snapshot()[0]!.lastEventAt + 125_000),
    ).toHaveLength(1)
  })

  it('accepts an externally-provided liveness tracker', () => {
    const external = new LivenessTracker({ strictness: 'lax' })
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet(),
      liveness: external,
    })
    expect(orch.liveness).toBe(external)
  })
})

// ---------------------------------------------------------------------------
// FR-33: crash-safe task checkpointing / reclaim detection
//
// `scanReclaimCandidates` is the orchestrator's entry point into the FR-32
// remediation loop. It must:
//   - find tasks in `in_progress`/`review`/`gate_check` whose assigned agent
//     is not in the liveness tracker's live set,
//   - ignore queue statuses and terminal statuses,
//   - load the last durable checkpoint from memory/tasks/<id>/checkpoint.json,
//   - flag checkpoints older than 24h for auto-escalation.
//
// The tests write the checkpoint file directly rather than going through the
// `writeCheckpoint` tool (that's covered in @guildhall/tools) — we only care
// that the orchestrator reads the right paths and routes the right tasks.
// ---------------------------------------------------------------------------
describe('Orchestrator — FR-33 reclaim detection', () => {
  async function writeCheckpointFile(
    taskId: string,
    partial: Partial<{
      step: number
      intent: string
      nextPlannedAction: string
      writtenAt: string
      agentId: string
      filesTouched: string[]
    }> = {},
  ): Promise<void> {
    const dir = path.join(memoryDir, 'tasks', taskId)
    await fs.mkdir(dir, { recursive: true })
    const cp = {
      taskId,
      agentId: partial.agentId ?? 'worker-agent',
      step: partial.step ?? 1,
      intent: partial.intent ?? 'doing work',
      filesTouched: partial.filesTouched ?? [],
      nextPlannedAction: partial.nextPlannedAction ?? 'continue',
      writtenAt: partial.writtenAt ?? '2026-04-20T00:00:00Z',
    }
    await fs.writeFile(
      path.join(dir, 'checkpoint.json'),
      JSON.stringify(cp, null, 2),
      'utf-8',
    )
  }

  it('flags in_progress tasks whose assignee is not in the live set', async () => {
    await writeQueue([
      mkTask({ id: 't-alive', status: 'in_progress', assignedTo: 'w-alive' }),
      mkTask({ id: 't-crashed', status: 'in_progress', assignedTo: 'w-dead' }),
    ])
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    orch.liveness.register('w-alive', 't-alive')

    const candidates = await orch.scanReclaimCandidates()
    expect(candidates.map((c) => c.task.id)).toEqual(['t-crashed'])
  })

  it('ignores terminal statuses (done / shelved / blocked)', async () => {
    await writeQueue([
      mkTask({ id: 't-done', status: 'done' }),
      mkTask({ id: 't-shelved', status: 'shelved' }),
      mkTask({ id: 't-blocked', status: 'blocked' }),
    ])
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    expect(await orch.scanReclaimCandidates()).toEqual([])
  })

  it('ignores queue statuses (ready / proposed / spec_review / exploring)', async () => {
    await writeQueue([
      mkTask({ id: 't1', status: 'ready' }),
      mkTask({ id: 't2', status: 'proposed' }),
      mkTask({ id: 't3', status: 'spec_review' }),
      mkTask({ id: 't4', status: 'exploring' }),
    ])
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    expect(await orch.scanReclaimCandidates()).toEqual([])
  })

  it('includes the last durable checkpoint for each candidate', async () => {
    await writeQueue([
      mkTask({ id: 't-crashed', status: 'in_progress', assignedTo: 'w-dead' }),
    ])
    await writeCheckpointFile('t-crashed', {
      step: 7,
      intent: 'migrating db',
      nextPlannedAction: 'run the migration',
    })
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })

    const [cand] = await orch.scanReclaimCandidates()
    expect(cand!.task.id).toBe('t-crashed')
    expect(cand!.checkpoint).not.toBeNull()
    expect(cand!.checkpoint!.step).toBe(7)
    expect(cand!.checkpoint!.nextPlannedAction).toBe('run the migration')
  })

  it('returns checkpoint:null when the task never wrote one', async () => {
    await writeQueue([
      mkTask({ id: 't-crashed', status: 'in_progress', assignedTo: 'w-dead' }),
    ])
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    const [cand] = await orch.scanReclaimCandidates()
    expect(cand!.checkpoint).toBeNull()
    expect(cand!.ageMs).toBeNull()
    expect(cand!.autoEscalate).toBe(false)
  })

  it('auto-escalates checkpoints older than 24h', async () => {
    await writeQueue([
      mkTask({ id: 't-stale', status: 'in_progress', assignedTo: 'w-dead' }),
    ])
    // 25 hours in the past — auto-escalation triggers at 24h regardless of
    // remediation_autonomy (spec: "auto-escalated to human review regardless
    // of `remediation_autonomy`").
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
    await writeCheckpointFile('t-stale', { writtenAt: old })
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })

    const [cand] = await orch.scanReclaimCandidates()
    expect(cand!.autoEscalate).toBe(true)
    expect(cand!.ageMs).toBeGreaterThan(24 * 60 * 60 * 1000)
  })

  it('does NOT auto-escalate a fresh checkpoint', async () => {
    await writeQueue([
      mkTask({ id: 't-recent', status: 'in_progress', assignedTo: 'w-dead' }),
    ])
    await writeCheckpointFile('t-recent', { writtenAt: new Date().toISOString() })
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    const [cand] = await orch.scanReclaimCandidates()
    expect(cand!.autoEscalate).toBe(false)
  })

  it('honors a nowMs override for deterministic age calculations', async () => {
    await writeQueue([
      mkTask({ id: 't-x', status: 'in_progress', assignedTo: 'w-dead' }),
    ])
    // Checkpoint at t=0; scan at t=10s → age should be exactly 10_000.
    await writeCheckpointFile('t-x', {
      writtenAt: new Date(0).toISOString(),
    })
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    const [cand] = await orch.scanReclaimCandidates(10_000)
    expect(cand!.ageMs).toBe(10_000)
  })
})

// ---------------------------------------------------------------------------
// FR-32: coordinator remediation decision loop (orchestrator integration)
//
// The pure policy (authorizeAction, buildRemediationContext,
// recordRemediationDecision) is exercised in remediation.test.ts. Here we
// pin the orchestrator's wiring: collect triggers from all three sources,
// assemble a context with the right lever state, and record decisions that
// bump the task's remediationAttempts counter.
// ---------------------------------------------------------------------------
describe('Orchestrator — FR-32 remediation wiring', () => {
  async function seedSettings(): Promise<void> {
    const settings = makeDefaultSettings(new Date('2026-04-20T00:00:00Z'))
    await saveLeverSettings({
      path: path.join(memoryDir, AGENT_SETTINGS_FILENAME),
      settings,
    })
  }

  it('collectRemediationTriggers surfaces stall + issue + crash triggers together', async () => {
    await seedSettings()
    await writeQueue([
      mkTask({ id: 't-stall', status: 'in_progress', assignedTo: 'w-stall' }),
      mkTask({
        id: 't-issue',
        status: 'in_progress',
        assignedTo: 'w-alive',
        agentIssues: [
          {
            id: 'iss-t-issue-1',
            taskId: 't-issue',
            agentId: 'w-alive',
            code: 'stuck',
            severity: 'warn',
            detail: 'made no progress',
            raisedAt: '2026-04-20T00:00:00Z',
            broadcast: true,
          },
        ],
      }),
      mkTask({ id: 't-crash', status: 'in_progress', assignedTo: 'w-dead' }),
    ])

    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    orch.liveness.setStrictness('strict')
    // w-stall: registered long ago → past strict 45s threshold → stalled
    orch.liveness.register('w-stall', 't-stall')
    // w-alive: just registered → not stalled
    orch.liveness.register('w-alive', 't-issue')
    const base = orch.liveness.snapshot().find((e) => e.agentId === 'w-stall')!
      .lastEventAt

    const triggers = await orch.collectRemediationTriggers(base + 60_000)
    const kinds = triggers.map((t) => `${t.kind}:${t.taskId}`).sort()
    expect(kinds).toContain('stall:t-stall')
    expect(kinds).toContain('issue:t-issue')
    expect(kinds).toContain('crash:t-crash')
  })

  it('does NOT surface resolved issues as triggers', async () => {
    await seedSettings()
    await writeQueue([
      mkTask({
        id: 't-done-issue',
        status: 'in_progress',
        assignedTo: 'w-alive',
        agentIssues: [
          {
            id: 'iss-t-done-issue-1',
            taskId: 't-done-issue',
            agentId: 'w-alive',
            code: 'stuck',
            severity: 'warn',
            detail: 'resolved earlier',
            raisedAt: '2026-04-20T00:00:00Z',
            broadcast: true,
            resolvedAt: '2026-04-20T00:05:00Z',
            resolution: 'coordinator intervened',
            resolvedBy: 'coord-looma',
          },
        ],
      }),
    ])
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    orch.liveness.register('w-alive', 't-done-issue')

    const triggers = await orch.collectRemediationTriggers()
    expect(triggers.filter((t) => t.kind === 'issue')).toEqual([])
  })

  it('buildRemediationContextFor reflects current lever positions', async () => {
    const settings = makeDefaultSettings(new Date('2026-04-20T00:00:00Z'))
    settings.project.remediation_autonomy = {
      position: 'confirm_destructive',
      rationale: 'x',
      setAt: '2026-04-20T00:00:00Z',
      setBy: 'user-direct',
    }
    settings.domains.default.crash_recovery_default = {
      position: 'prefer_resume',
      rationale: 'x',
      setAt: '2026-04-20T00:00:00Z',
      setBy: 'user-direct',
    }
    await saveLeverSettings({
      path: path.join(memoryDir, AGENT_SETTINGS_FILENAME),
      settings,
    })

    await writeQueue([
      mkTask({
        id: 't-1',
        status: 'in_progress',
        assignedTo: 'w-1',
        remediationAttempts: 3,
      }),
    ])

    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    orch.liveness.register('w-1', 't-1')
    const [trigger] = await orch.collectRemediationTriggers(
      orch.liveness.snapshot()[0]!.lastEventAt + 1_000_000,
    )

    const ctx = await orch.buildRemediationContextFor(trigger!)
    expect(ctx.priorAttempts).toBe(3)
    expect(ctx.leverState.remediationAutonomy).toBe('confirm_destructive')
    expect(ctx.leverState.crashRecoveryDefault).toBe('prefer_resume')
    expect(ctx.leverState.agentHealthStrictness).toBe('standard')
  })

  it('recordRemediation appends to DECISIONS.md and bumps remediationAttempts', async () => {
    await seedSettings()
    await writeQueue([
      mkTask({ id: 't-1', status: 'in_progress', assignedTo: 'w-1' }),
    ])

    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    orch.liveness.register('w-1', 't-1')
    const [trigger] = await orch.collectRemediationTriggers(
      orch.liveness.snapshot()[0]!.lastEventAt + 1_000_000,
    )
    const ctx = await orch.buildRemediationContextFor(trigger!)

    await orch.recordRemediation({
      context: ctx,
      action: {
        kind: 'restart_from_checkpoint',
        rationale: 'no destructive change needed',
      },
      authorization: { kind: 'autonomous' },
      decidedBy: 'coord-looma',
    })

    const decisions = await fs.readFile(
      path.join(memoryDir, 'DECISIONS.md'),
      'utf-8',
    )
    expect(decisions).toMatch(/Remediation: restart_from_checkpoint/)
    expect(decisions).toMatch(/task=t-1/)

    const q = await readQueue()
    const updated = q.tasks.find((t) => t.id === 't-1')!
    expect(updated.remediationAttempts).toBe(1)
  })

  it('authorizeRemediation delegates to the pure gate using the context lever', async () => {
    const settings = makeDefaultSettings(new Date('2026-04-20T00:00:00Z'))
    settings.project.remediation_autonomy = {
      position: 'confirm_destructive',
      rationale: 'x',
      setAt: '2026-04-20T00:00:00Z',
      setBy: 'user-direct',
    }
    await saveLeverSettings({
      path: path.join(memoryDir, AGENT_SETTINGS_FILENAME),
      settings,
    })

    await writeQueue([
      mkTask({ id: 't-1', status: 'in_progress', assignedTo: 'w-1' }),
    ])

    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    orch.liveness.register('w-1', 't-1')
    const [trigger] = await orch.collectRemediationTriggers(
      orch.liveness.snapshot()[0]!.lastEventAt + 1_000_000,
    )
    const ctx = await orch.buildRemediationContextFor(trigger!)

    // Non-destructive under confirm_destructive → autonomous
    expect(
      orch.authorizeRemediation(
        { kind: 'restart_from_checkpoint', rationale: 'x' },
        ctx,
      ),
    ).toEqual({ kind: 'autonomous' })
    // Destructive under confirm_destructive → requires_confirm
    expect(
      orch.authorizeRemediation({ kind: 'shelve_task', rationale: 'x' }, ctx).kind,
    ).toBe('requires_confirm')
  })

  it('multiple recordRemediation calls increment remediationAttempts monotonically', async () => {
    await seedSettings()
    await writeQueue([
      mkTask({ id: 't-1', status: 'in_progress', assignedTo: 'w-1' }),
    ])
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    orch.liveness.register('w-1', 't-1')
    const [trigger] = await orch.collectRemediationTriggers(
      orch.liveness.snapshot()[0]!.lastEventAt + 1_000_000,
    )

    for (let i = 0; i < 3; i++) {
      const ctx = await orch.buildRemediationContextFor(trigger!)
      await orch.recordRemediation({
        context: ctx,
        action: { kind: 'wait', rationale: `attempt ${i + 1}` },
        authorization: { kind: 'autonomous' },
        decidedBy: 'coord-looma',
      })
    }

    const q = await readQueue()
    expect(q.tasks.find((t) => t.id === 't-1')!.remediationAttempts).toBe(3)
  })
})

describe('Orchestrator — FR-24 slot allocation / runtime isolation', () => {
  async function writeSettings(overrides: {
    runtime?: 'none' | 'slot_allocation'
    dispatch?: { kind: 'serial' } | { kind: 'fanout'; n: number }
  } = {}): Promise<void> {
    const settings: LeverSettings = makeDefaultSettings(new Date('2026-04-20T00:00:00Z'))
    if (overrides.runtime) {
      settings.project.runtime_isolation = {
        position: overrides.runtime,
        rationale: 'test',
        setAt: '2026-04-20T00:00:00Z',
        setBy: 'user-direct',
      }
    }
    if (overrides.dispatch) {
      settings.project.concurrent_task_dispatch = {
        position: overrides.dispatch,
        rationale: 'test',
        setAt: '2026-04-20T00:00:00Z',
        setBy: 'user-direct',
      }
    }
    await saveLeverSettings({
      path: path.join(memoryDir, AGENT_SETTINGS_FILENAME),
      settings,
    })
  }

  it('skips slot allocation when runtime_isolation=none (default)', async () => {
    await writeSettings() // default = none
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    const allocator = await orch.ensureSlotAllocator()
    expect(allocator).toBeNull()
  })

  it('instantiates a capacity-1 allocator when runtime_isolation=slot_allocation and dispatch=serial', async () => {
    await writeSettings({ runtime: 'slot_allocation' })
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    const allocator = await orch.ensureSlotAllocator()
    expect(allocator).not.toBeNull()
    expect(allocator!.capacity).toBe(1)
  })

  it('instantiates a fanout-N allocator when dispatch=fanout_N and isolation is on', async () => {
    await writeSettings({
      runtime: 'slot_allocation',
      dispatch: { kind: 'fanout', n: 4 },
    })
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    const allocator = await orch.ensureSlotAllocator()
    expect(allocator!.capacity).toBe(4)
  })

  it('falls back to null when agent-settings.yaml is missing', async () => {
    // No writeSettings call — file absent
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    const allocator = await orch.ensureSlotAllocator()
    expect(allocator).toBeNull()
  })

  it('injects the slot system-prompt rule into the dispatched prompt', async () => {
    await writeSettings({ runtime: 'slot_allocation' })
    await writeQueue([mkTask({ id: 't-1', status: 'in_progress', assignedTo: 'w-1' })])

    const worker = stubAgent('worker-agent')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
    })
    await orch.tick()

    expect(worker.calls).toHaveLength(1)
    const prompt = worker.calls[0]!.prompt
    expect(prompt).toContain('Runtime isolation (FR-24)')
    expect(prompt).toContain('slot is **0**')
    expect(prompt).toContain('GUILDHALL_W0_')
  })

  it('does NOT inject the slot rule when runtime_isolation=none', async () => {
    await writeSettings() // none
    await writeQueue([mkTask({ id: 't-1', status: 'in_progress', assignedTo: 'w-1' })])

    const worker = stubAgent('worker-agent')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
    })
    await orch.tick()

    expect(worker.calls[0]!.prompt).not.toContain('Runtime isolation (FR-24)')
  })

  it('releases the slot after the agent returns so the next tick can claim it', async () => {
    await writeSettings({ runtime: 'slot_allocation' })
    await writeQueue([
      mkTask({ id: 't-a', status: 'in_progress', assignedTo: 'w-a' }),
    ])
    const worker = stubAgent('worker-agent')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
    })
    await orch.tick()

    const allocator = await orch.ensureSlotAllocator()
    expect(allocator!.inUse).toBe(0)

    // Replace the queue with a different task; slot 0 should be free again.
    await writeQueue([
      mkTask({ id: 't-b', status: 'in_progress', assignedTo: 'w-b' }),
    ])
    await orch.tick()
    expect(allocator!.inUse).toBe(0)
  })

  it('releases the slot when the agent throws', async () => {
    await writeSettings({ runtime: 'slot_allocation' })
    await writeQueue([
      mkTask({ id: 't-1', status: 'in_progress', assignedTo: 'w-1' }),
    ])
    const worker = stubAgent('worker-agent', async () => {
      throw new Error('boom')
    })
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
    })
    const out = await orch.tick()
    expect(out.kind).toBe('agent-error')
    const allocator = await orch.ensureSlotAllocator()
    expect(allocator!.inUse).toBe(0)
  })

  it('honors guildhall.yaml runtime overrides for portBase / envVarPrefix', async () => {
    await writeSettings({ runtime: 'slot_allocation' })
    await writeQueue([
      mkTask({ id: 't-1', status: 'in_progress', assignedTo: 'w-1' }),
    ])

    const worker = stubAgent('worker-agent')
    const config = baseConfig({
      runtime: {
        portBase: 9000,
        portStride: 10,
        envVarPrefixTemplate: 'X{slot}_',
      },
    })
    const orch = new Orchestrator({
      config,
      agents: agentSet({ worker }),
    })
    await orch.tick()

    const prompt = worker.calls[0]!.prompt
    expect(prompt).toContain('Port base is **9000**')
    expect(prompt).toContain('X0_')
  })

  it('slotEnvFor merges canonical vars on top of process env when a slot is held', async () => {
    await writeSettings({ runtime: 'slot_allocation' })
    await writeQueue([
      mkTask({ id: 't-1', status: 'in_progress', assignedTo: 'w-1' }),
    ])

    // Hold the dispatch so we can observe slotEnvFor while the slot is live.
    let resolveGate: (() => void) | null = null
    const gate = new Promise<void>((r) => {
      resolveGate = r
    })
    let signalEntered: (() => void) | null = null
    const entered = new Promise<void>((r) => {
      signalEntered = r
    })
    const worker = stubAgent('worker-agent', async () => {
      // Do not resolve the gate inside generate — we want the tick in flight.
    })
    // Override generate to wait on gate so the slot is held during probing.
    // Signal `entered` on first line so the test waits on a real event,
    // not a wall-clock timeout (which is flaky under load).
    worker.generate = async (prompt: string) => {
      worker.calls.push({ prompt })
      signalEntered!()
      await gate
      return { text: 'ok' }
    }

    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
    })
    const tickPromise = orch.tick()
    await entered

    const task = mkTask({ id: 't-1', status: 'in_progress' })
    const env = orch.slotEnvFor(task, { PATH: '/usr/bin' })
    expect(env['PATH']).toBe('/usr/bin')
    expect(env['GUILDHALL_SLOT']).toBe('0')
    expect(env['GUILDHALL_PORT_BASE']).toBeDefined()
    expect(env['GUILDHALL_ENV_PREFIX']).toBe('GUILDHALL_W0_')

    resolveGate!()
    await tickPromise
  })

  it('is idempotent: re-allocating a held slot for the same task returns the same index', async () => {
    await writeSettings({
      runtime: 'slot_allocation',
      dispatch: { kind: 'fanout', n: 3 },
    })
    const orch = new Orchestrator({ config: baseConfig(), agents: agentSet() })
    const allocator = (await orch.ensureSlotAllocator())!
    const s1 = allocator.allocate('t-A')!
    const s2 = allocator.allocate('t-A')!
    expect(s2).toBe(s1)
    expect(allocator.inUse).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// FR-27 / AC-18 \u2014 reviewer_mode dispatch with deterministic fallback.
// Exercises the three modes end-to-end through the orchestrator tick:
// verifies that (a) the LLM is skipped when the mode says so, (b) the
// deterministic reviewer fires on LLM outage under `llm_with_deterministic_fallback`,
// and (c) the verdict record carries `reviewerPath` so the audit trail
// shows which code path produced the decision.
// ---------------------------------------------------------------------------
describe('Orchestrator.tick \u2014 AC-18 reviewer_mode dispatch', () => {
  async function writeReviewerMode(
    mode: DomainLevers['reviewer_mode']['position'],
  ): Promise<void> {
    const settings: LeverSettings = makeDefaultSettings(
      new Date('2026-04-21T00:00:00Z'),
    )
    settings.domains.default.reviewer_mode = {
      position: mode,
      rationale: 'test override',
      setAt: '2026-04-21T00:00:00Z',
      setBy: 'user-direct',
    }
    await saveLeverSettings({
      path: path.join(memoryDir, AGENT_SETTINGS_FILENAME),
      settings,
    })
  }

  /** A review-ready task with ACs met and a passing hard gate, so the
   *  deterministic rubric clears the 0.8 threshold and returns approve. */
  function reviewReadyTask(overrides: Partial<Task> = {}): Task {
    return mkTask({
      id: 't-review',
      status: 'review',
      acceptanceCriteria: [
        { id: 'ac-1', description: 'ghost button renders', verifiedBy: 'review', met: true },
        { id: 'ac-2', description: 'build passes', verifiedBy: 'automated', command: 'pnpm build', met: true },
      ],
      gateResults: [
        { gateId: 'typecheck', type: 'hard', passed: true, checkedAt: '2026-04-21T00:00:00Z' },
        { gateId: 'test', type: 'hard', passed: true, checkedAt: '2026-04-21T00:00:00Z' },
      ],
      ...overrides,
    })
  }

  it(
    'llm_with_deterministic_fallback: simulated LLM outage runs deterministic reviewer and records reviewerPath on the verdict',
    async () => {
      await writeReviewerMode('llm_with_deterministic_fallback')
      await writeQueue([reviewReadyTask()])

      // Reviewer throws every call \u2014 simulates provider outage / timeout.
      const throwingReviewer: StubAgent = {
        name: 'reviewer-agent',
        calls: [],
        async generate(prompt: string) {
          this.calls.push({ prompt })
          throw new Error('provider timeout')
        },
      }

      const orch = new Orchestrator({
        config: baseConfig(),
        agents: agentSet({ reviewer: throwingReviewer }),
      })
      const out = await orch.tick()

      // The orchestrator must NOT surface agent-error \u2014 the fallback absorbs
      // the outage and produces a real verdict.
      expect(out.kind).toBe('processed')
      if (out.kind === 'processed') {
        expect(out.beforeStatus).toBe('review')
        expect(out.afterStatus).toBe('gate_check')
        expect(out.agent).toBe('reviewer-deterministic-fallback')
      }

      const q = await readQueue()
      const t = q.tasks[0]!
      expect(t.status).toBe('gate_check')
      expect(t.reviewVerdicts).toHaveLength(1)
      const verdict = t.reviewVerdicts[0]!
      expect(verdict.reviewerPath).toBe('deterministic')
      expect(verdict.verdict).toBe('approve')
      expect(verdict.llmError).toContain('provider timeout')
      expect(verdict.score).toBeGreaterThanOrEqual(0.8)
    },
  )

  it(
    'llm_with_deterministic_fallback: when the LLM reviewer succeeds, the verdict is recorded as reviewerPath=llm',
    async () => {
      await writeReviewerMode('llm_with_deterministic_fallback')
      await writeQueue([reviewReadyTask()])

      // LLM reviewer approves via a tool call (simulated here by mutating
      // the task on disk) and returns cleanly.
      const approvingReviewer = stubAgent('reviewer-agent', async () => {
        await mutateTask('t-review', { status: 'gate_check' })
      })
      const orch = new Orchestrator({
        config: baseConfig(),
        agents: agentSet({ reviewer: approvingReviewer }),
      })
      const out = await orch.tick()

      expect(out.kind).toBe('processed')
      if (out.kind === 'processed') {
        expect(out.afterStatus).toBe('gate_check')
        expect(out.agent).toBe('reviewer-agent')
      }
      const t = (await readQueue()).tasks[0]!
      expect(t.reviewVerdicts).toHaveLength(1)
      expect(t.reviewVerdicts[0]!.reviewerPath).toBe('llm')
      expect(t.reviewVerdicts[0]!.verdict).toBe('approve')
      expect(t.reviewVerdicts[0]!.llmError).toBeUndefined()
    },
  )

  it('deterministic_only: skips the LLM reviewer entirely', async () => {
    await writeReviewerMode('deterministic_only')
    await writeQueue([reviewReadyTask()])

    const reviewer = stubAgent('reviewer-agent')
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ reviewer }),
    })
    const out = await orch.tick()

    expect(out.kind).toBe('processed')
    if (out.kind === 'processed') {
      expect(out.agent).toBe('reviewer-deterministic')
      expect(out.afterStatus).toBe('gate_check')
    }
    expect(reviewer.calls).toHaveLength(0) // LLM never called
    const t = (await readQueue()).tasks[0]!
    expect(t.reviewVerdicts[0]!.reviewerPath).toBe('deterministic')
    expect(t.reviewVerdicts[0]!.llmError).toBeUndefined()
  })

  it('llm_only: LLM outage still surfaces as an agent-error (no fallback)', async () => {
    await writeReviewerMode('llm_only')
    await writeQueue([reviewReadyTask()])

    const throwingReviewer: StubAgent = {
      name: 'reviewer-agent',
      calls: [],
      async generate(prompt: string) {
        this.calls.push({ prompt })
        throw new Error('provider timeout')
      },
    }
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ reviewer: throwingReviewer }),
    })
    const out = await orch.tick()
    expect(out.kind).toBe('agent-error')

    const t = (await readQueue()).tasks[0]!
    expect(t.status).toBe('review') // unchanged
    expect(t.reviewVerdicts).toHaveLength(0) // no verdict recorded
  })

  it(
    'llm_with_deterministic_fallback: deterministic revise bounces to in_progress and bumps revisionCount',
    async () => {
      await writeReviewerMode('llm_with_deterministic_fallback')
      // ACs NOT met \u2192 deterministic rubric scores below threshold \u2192 revise.
      await writeQueue([
        reviewReadyTask({
          id: 't-bad',
          acceptanceCriteria: [
            { id: 'ac-1', description: 'ghost renders', verifiedBy: 'review', met: false },
          ],
          gateResults: [],
        }),
      ])

      const throwingReviewer: StubAgent = {
        name: 'reviewer-agent',
        calls: [],
        async generate() { throw new Error('provider outage') },
      }
      const orch = new Orchestrator({
        config: baseConfig(),
        agents: agentSet({ reviewer: throwingReviewer }),
      })
      const out = await orch.tick()
      expect(out.kind).toBe('processed')
      if (out.kind === 'processed') {
        expect(out.afterStatus).toBe('in_progress')
        expect(out.revisionCount).toBe(1)
      }
      const t = (await readQueue()).tasks[0]!
      expect(t.status).toBe('in_progress')
      expect(t.assignedTo).toBe('worker-agent')
      expect(t.revisionCount).toBe(1)
      expect(t.reviewVerdicts[0]!.verdict).toBe('revise')
      expect(t.reviewVerdicts[0]!.reviewerPath).toBe('deterministic')
    },
  )

  it(
    'records worker ownership again when the LLM reviewer sends a task back to in_progress',
    async () => {
      await writeReviewerMode('llm_with_deterministic_fallback')
      await writeQueue([reviewReadyTask({ id: 't-llm-revise' })])

      const revisingReviewer = stubAgent('reviewer-agent', async () => {
        await mutateTask('t-llm-revise', { status: 'in_progress' })
      })
      const orch = new Orchestrator({
        config: baseConfig(),
        agents: agentSet({ reviewer: revisingReviewer }),
      })
      const out = await orch.tick()

      expect(out.kind).toBe('processed')
      if (out.kind === 'processed') {
        expect(out.afterStatus).toBe('in_progress')
      }
      const t = (await readQueue()).tasks[0]!
      expect(t.status).toBe('in_progress')
      expect(t.assignedTo).toBe('worker-agent')
      expect(t.reviewVerdicts[0]!.reviewerPath).toBe('llm')
      expect(t.reviewVerdicts[0]!.verdict).toBe('revise')
    },
  )
})
