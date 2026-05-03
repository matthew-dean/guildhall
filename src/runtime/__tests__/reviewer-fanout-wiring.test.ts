import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import yaml from 'js-yaml'
import {
  Orchestrator,
  type OrchestratorAgentSet,
  type ReviewerFanoutRunner,
  buildDefaultReviewerFanout,
} from '../orchestrator.js'
import type { ResolvedConfig } from '@guildhall/config'
import type { Task, TaskQueue, DesignSystem } from '@guildhall/core'
import type { PersonaVerdict } from '../reviewer-fanout.js'
import { defineTool } from '@guildhall/engine'
import type {
  ApiMessageRequest,
  ApiStreamEvent,
  SupportsStreamingMessages,
} from '@guildhall/engine'
import type { ConversationMessage, UsageSnapshot } from '@guildhall/protocol'
import { z } from 'zod'

// ---------------------------------------------------------------------------
// Integration test: reviewer fan-out at `review`. The Orchestrator, when
// given a `reviewerFanout` runner, invokes it INSTEAD of the single reviewer
// agent, aggregates persona verdicts strict-all, and transitions accordingly.
// ---------------------------------------------------------------------------

let tmpDir: string
let memoryDir: string
let tasksPath: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'reviewer-fanout-test-'))
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
    maxRevisions: 3,
    heartbeatInterval: 5,
    ignore: [],
    lmStudioUrl: 'http://localhost:1234',
    servePort: 7777,
  }
}

function mkTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-001',
    title: 'Add ghost button',
    description: 'UI component work',
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
  return JSON.parse(await fs.readFile(tasksPath, 'utf-8'))
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

interface ScriptedTurn {
  message: ConversationMessage
  usage?: UsageSnapshot
}

class ScriptedApiClient implements SupportsStreamingMessages {
  private index = 0

  constructor(private readonly script: ScriptedTurn[]) {}

  async *streamMessage(_request: ApiMessageRequest): AsyncIterable<ApiStreamEvent> {
    const turn = this.script[this.index]
    if (!turn) throw new Error(`ScriptedApiClient exhausted at ${this.index}`)
    this.index += 1
    yield {
      type: 'message_complete',
      message: turn.message,
      usage: turn.usage ?? { input_tokens: 0, output_tokens: 0 },
      stop_reason: null,
    }
  }
}

function assistantMsg(text: string): ConversationMessage {
  return { role: 'assistant', content: [{ type: 'text', text }] }
}

function assistantToolUse(name: string, input: Record<string, unknown> = {}): ConversationMessage {
  return {
    role: 'assistant',
    content: [{ type: 'tool_use', id: `toolu_${name}`, name, input }],
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

const minimalDS: DesignSystem = {
  version: 1,
  revision: 1,
  tokens: {
    color: [
      { name: 'text.body', value: '#111111' },
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

async function writeDesignSystem(ds: DesignSystem): Promise<void> {
  await fs.writeFile(
    path.join(memoryDir, 'design-system.yaml'),
    yaml.dump(ds),
    'utf-8',
  )
}

describe('Orchestrator — reviewer fan-out at review', () => {
  it('default fanout reviewers inspect files from the task projectPath', async () => {
    let observedCwd: string | null = null
    const cwdProbe = defineTool<Record<string, never>>({
      name: 'cwd-probe',
      description: 'records cwd',
      inputSchema: z.object({}),
      jsonSchema: { type: 'object', properties: {}, additionalProperties: false },
      execute: async (_input, ctx) => {
        observedCwd = ctx.cwd
        return { output: 'ok', is_error: false }
      },
    })
    const client = new ScriptedApiClient([
      { message: assistantToolUse('cwd-probe') },
      {
        message: assistantMsg(
          [
            '**Rubric:**',
            '- review: yes - checked',
            '',
            '**Verdict:** approve',
            '',
            '**Reasoning:** Project path was readable.',
          ].join('\n'),
        ),
      },
    ])
    const runner = buildDefaultReviewerFanout(
      { apiClient: client, modelId: 'm' },
      { extraTools: [cwdProbe] },
    )

    const verdicts = await runner({
      task: mkTask(),
      personas: [
        {
          slug: 'project-manager',
          name: 'The Project Manager',
          principles: 'Check handoff quality.',
          rubric: [{ id: 'review', question: 'Is the review packet usable?', weight: 1 }],
        },
      ],
      context: 'Review the task.',
      memoryDir,
      projectPath: tmpDir,
    })

    expect(observedCwd).toBe(tmpDir)
    expect(verdicts[0]?.verdict).toBe('approve')
  })

  it('advances the task to gate_check when every persona approves', async () => {
    await writeDesignSystem(minimalDS)
    const task = mkTask()
    await writeQueue([task])
    const agents = agentSet()

    const calls: { personaSlugs: string[] }[] = []
    const runner: ReviewerFanoutRunner = async ({ personas }) => {
      calls.push({ personaSlugs: personas.map((p) => p.slug) })
      return personas.map(
        (persona): PersonaVerdict => ({
          guildSlug: persona.slug,
          guildName: persona.name,
          verdict: 'approve',
          reasoning: `${persona.name} approved.`,
          revisionItems: [],
          rawOutput: '**Verdict:** approve',
        }),
      )
    }

    const orch = new Orchestrator({ config: baseConfig(), agents, reviewerFanout: runner })
    await orch.tick()

    // Runner was invoked with the applicable reviewer personas.
    expect(calls).toHaveLength(1)
    expect(calls[0]!.personaSlugs.length).toBeGreaterThan(0)
    // The legacy single-reviewer agent was NOT called.
    expect((agents.reviewer as ReturnType<typeof stubAgent>).calls).toHaveLength(0)

    const q = await readQueue()
    const after = q.tasks[0]!
    expect(after.status).toBe('gate_check')
    // One ReviewVerdict per persona was persisted.
    expect(after.reviewVerdicts.length).toBe(calls[0]!.personaSlugs.length)
    expect(after.reviewVerdicts.every((v) => v.verdict === 'approve')).toBe(true)
  })

  it('bounces the task to in_progress when any persona revises', async () => {
    await writeDesignSystem(minimalDS)
    const task = mkTask()
    await writeQueue([task])
    const agents = agentSet()

    const runner: ReviewerFanoutRunner = async ({ personas }) => {
      return personas.map((persona, i): PersonaVerdict => {
        // The first persona dissents; rest approve.
        if (i === 0) {
          return {
            guildSlug: persona.slug,
            guildName: persona.name,
            verdict: 'revise',
            reasoning: `${persona.name} found a load-bearing issue.`,
            revisionItems: ['Fix the problem the engineer introduced.'],
            rawOutput: '**Verdict:** revise',
          }
        }
        return {
          guildSlug: persona.slug,
          guildName: persona.name,
          verdict: 'approve',
          reasoning: `${persona.name} approved.`,
          revisionItems: [],
          rawOutput: '**Verdict:** approve',
        }
      })
    }

    const orch = new Orchestrator({ config: baseConfig(), agents, reviewerFanout: runner })
    await orch.tick()

    const q = await readQueue()
    const after = q.tasks[0]!
    expect(after.status).toBe('in_progress')
    expect(after.revisionCount).toBe(1)
    // All persona verdicts persisted — dissenters and approvers alike.
    expect(after.reviewVerdicts.length).toBeGreaterThan(1)
    // Combined feedback note is attached for the worker.
    const fanoutNote = after.notes.find((n) => n.agentId === 'reviewer-fanout')
    expect(fanoutNote).toBeDefined()
    expect(fanoutNote!.content).toContain('load-bearing issue')
    expect(fanoutNote!.content).toContain('Fix the problem')
  })

  it('falls through to the legacy single reviewer when no fanout runner is supplied', async () => {
    await writeDesignSystem(minimalDS)
    const task = mkTask()
    await writeQueue([task])
    const agents = agentSet()

    // No reviewerFanout in options → legacy path fires.
    const orch = new Orchestrator({ config: baseConfig(), agents })
    await orch.tick()

    expect((agents.reviewer as ReturnType<typeof stubAgent>).calls.length).toBeGreaterThan(0)
    const q = await readQueue()
    const after = q.tasks[0]!
    // Legacy reviewer didn't transition (stub doesn't mutate task) — status unchanged.
    expect(after.status).toBe('review')
  })

  it('falls through to the legacy single reviewer when fanout only produces infra failures', async () => {
    await writeDesignSystem(minimalDS)
    const task = mkTask()
    await writeQueue([task])
    const approvingReviewer = stubAgent('reviewer-agent')
    approvingReviewer.generate = async function (prompt: string) {
      this.calls.push({ prompt })
      const q = await readQueue()
      q.tasks[0]!.status = 'gate_check'
      q.tasks[0]!.updatedAt = '2026-04-01T00:00:02Z'
      q.lastUpdated = '2026-04-01T00:00:02Z'
      await fs.writeFile(tasksPath, JSON.stringify(q, null, 2), 'utf-8')
      return { text: 'ok' }
    }
    const agents = {
      ...agentSet(),
      reviewer: approvingReviewer,
    }

    const runner: ReviewerFanoutRunner = async ({ personas }) =>
      personas.map(
        (persona): PersonaVerdict => ({
          guildSlug: persona.slug,
          guildName: persona.name,
          verdict: 'revise',
          reasoning:
            `${persona.name} failed to produce a verdict (API error: OpenAI-compatible API HTTP 429: {"status":429,"title":"Too Many Requests"}). Treating as revise per strict-all policy.`,
          revisionItems: [],
          rawOutput: '**Verdict:** revise',
        }),
      )

    const orch = new Orchestrator({ config: baseConfig(), agents, reviewerFanout: runner })
    await orch.tick()

    expect(approvingReviewer.calls).toHaveLength(1)
    const q = await readQueue()
    const after = q.tasks[0]!
    expect(after.status).toBe('gate_check')
    expect(after.reviewVerdicts).toHaveLength(1)
    expect(after.reviewVerdicts[0]!.reviewerPath).toBe('llm')
    expect(after.reviewVerdicts[0]!.verdict).toBe('approve')
  })

  it('raises escalation when fan-out keeps rejecting past maxRevisions', async () => {
    await writeDesignSystem(minimalDS)
    const task = mkTask({ revisionCount: 3 }) // already at maxRevisions
    await writeQueue([task])
    const agents = agentSet()

    const runner: ReviewerFanoutRunner = async ({ personas }) => {
      return personas.map(
        (persona): PersonaVerdict => ({
          guildSlug: persona.slug,
          guildName: persona.name,
          verdict: 'revise',
          reasoning: `${persona.name} dissents again.`,
          revisionItems: ['Fix it.'],
          rawOutput: '**Verdict:** revise',
        }),
      )
    }

    const orch = new Orchestrator({ config: baseConfig(), agents, reviewerFanout: runner })
    const outcome = await orch.tick()

    // Outcome should be the blocked-max-revisions variant.
    const hasBlocked = (o: typeof outcome): boolean => {
      if (o.kind === 'blocked-max-revisions') return true
      if (o.kind === 'batch') return o.outcomes.some(hasBlocked)
      return false
    }
    expect(hasBlocked(outcome)).toBe(true)
  })
})
