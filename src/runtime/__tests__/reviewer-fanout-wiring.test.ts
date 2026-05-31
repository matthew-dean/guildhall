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
import {
  AGENT_SETTINGS_FILENAME,
  makeDefaultSettings,
  saveLeverSettings,
} from '@guildhall/levers'
import { getProjectContextDebugSnapshotDir } from '@guildhall/sessions'
import type { ConversationMessage, UsageSnapshot } from '@guildhall/protocol'
import { z } from 'zod'
import { InMemoryGitDriver } from '../git-driver.js'

// ---------------------------------------------------------------------------
// Integration test: reviewer fan-out at `review`. The Orchestrator, when
// given a `reviewerFanout` runner, invokes it INSTEAD of the single reviewer
// agent, aggregates persona verdicts strict-all, and transitions accordingly.
// ---------------------------------------------------------------------------

let tmpDir: string
let memoryDir: string
let tasksPath: string
let originalDataDir: string | undefined

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'reviewer-fanout-test-'))
  originalDataDir = process.env.GUILDHALL_DATA_DIR
  process.env.GUILDHALL_DATA_DIR = path.join(tmpDir, 'data')
  memoryDir = path.join(tmpDir, 'memory')
  await fs.mkdir(memoryDir, { recursive: true })
  tasksPath = path.join(memoryDir, 'TASKS.json')
})

afterEach(async () => {
  if (originalDataDir === undefined) delete process.env.GUILDHALL_DATA_DIR
  else process.env.GUILDHALL_DATA_DIR = originalDataDir
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
      contextIndexer: 'm',
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
  readonly requests: ApiMessageRequest[] = []

  constructor(private readonly script: ScriptedTurn[]) {}

  async *streamMessage(request: ApiMessageRequest): AsyncIterable<ApiStreamEvent> {
    this.requests.push(request)
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

class HangingApiClient implements SupportsStreamingMessages {
  async *streamMessage(_request: ApiMessageRequest): AsyncIterable<ApiStreamEvent> {
    await new Promise((_resolve, _reject) => {})
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

function builtContextStub() {
  return {
    taskSummary: '',
    projectMemory: '',
    recentProgress: '',
    recentDecisions: '',
    exploringTranscript: '',
    personaPrompt: '',
    applicableGuildSlugs: [],
    primaryEngineerSlug: null,
    reviewerSlugs: [],
    envelope: '',
    designSystem: '',
    reviewRubrics: '',
    corpusMap: '',
    formatted: '',
  }
}

function memoryGitDriver() {
  return new InMemoryGitDriver({ clean: true, currentBranch: 'main' })
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
          blurb: 'Checks handoff quality.',
          role: 'overseer',
          principles: 'Check handoff quality.',
          rubric: [{ id: 'review', question: 'Is the review packet usable?', weight: 1 }],
          deterministicChecks: [],
          applicable: () => true,
        },
      ],
      builtContext: builtContextStub(),
      context: 'Review the task.',
      memoryDir,
      projectPath: tmpDir,
    })

    expect(observedCwd).toBe(tmpDir)
    expect(verdicts[0]?.verdict).toBe('approve')
  })

  it('default fanout prompts include the planned review lanes and recipes', async () => {
    const client = new ScriptedApiClient([
      {
        message: assistantMsg(
          [
            '**Rubric:**',
            '- review: yes - checked planned lanes',
            '',
            '**Verdict:** approve',
            '',
            '**Reasoning:** Planned UX recipe was considered.',
          ].join('\n'),
        ),
      },
    ])
    const runner = buildDefaultReviewerFanout(
      { apiClient: client, modelId: 'm' },
      { personaTimeoutMs: 1_000 },
    )

    await runner({
      task: mkTask(),
      personas: [
        {
          slug: 'project-manager',
          name: 'The Project Manager',
          blurb: 'Checks handoff quality.',
          role: 'overseer',
          principles: 'Check handoff quality.',
          rubric: [{ id: 'review', question: 'Is the review packet usable?', weight: 1 }],
          deterministicChecks: [],
          applicable: () => true,
        },
      ],
      reviewPlan: {
        taskId: 'task-001',
        effort: 'balanced',
        depth: 'standard',
        selectedLanes: ['ux_comprehension', 'copy_clarity'],
        skippedLanes: [{ lane: 'security', reason: 'No security signal.' }],
        requiredRecipes: [{
          recipeId: 'product-ux-zero-context',
          version: 'v1',
          lanes: ['ux_comprehension', 'copy_clarity'],
          blocking: 'high',
          required: true,
          calibrationRecipeIds: ['ux-zero-context-comprehension'],
        }],
        advisoryLenses: [],
        deterministicChecks: ['browser-or-screenshot-evidence'],
        requiredArtifacts: ['visual-evidence'],
        budget: { maxReviewerAgents: 4 },
        aggregation: { ux_comprehension: 'blocking_on_high', copy_clarity: 'blocking_on_high' },
        reasons: ['User-facing copy changed.'],
        createdAt: '2026-04-01T00:00:00Z',
        createdBy: 'coordinator-review-planner',
      },
      builtContext: builtContextStub(),
      context: 'Review the task.',
      memoryDir,
      projectPath: tmpDir,
    })

    const requestText = JSON.stringify(client.requests[0])
    expect(requestText).toContain('Planned review lanes')
    expect(requestText).toContain('ux_comprehension')
    expect(requestText).toContain('product-ux-zero-context')
    expect(requestText).toContain('ux-zero-context-comprehension')
    expect(requestText).toContain('Completeness pass')
    expect(requestText).toContain('missing risk lane')
    expect(requestText).toContain('pitfall')
  })

  it('default fanout context debug snapshots include the reviewer persona prompt', async () => {
    const client = new ScriptedApiClient([
      {
        message: assistantMsg(
          [
            '**Rubric:**',
            '- review: yes - checked context',
            '',
            '**Verdict:** approve',
            '',
            '**Reasoning:** Persona role context was present.',
          ].join('\n'),
        ),
      },
    ])
    const runner = buildDefaultReviewerFanout(
      { apiClient: client, modelId: 'm' },
      {
        personaTimeoutMs: 1_000,
        contextDebug: { memoryDir, workspacePath: tmpDir },
      },
    )

    await runner({
      task: mkTask(),
      personas: [
        {
          slug: 'project-manager',
          name: 'The Project Manager',
          blurb: 'Checks handoff quality.',
          role: 'overseer',
          principles: 'Check handoff quality.',
          rubric: [{ id: 'review', question: 'Is the review packet usable?', weight: 1 }],
          deterministicChecks: [],
          applicable: () => true,
        },
      ],
      builtContext: builtContextStub(),
      context: 'Review the task.',
      memoryDir,
      projectPath: tmpDir,
    })

    const snapshotDir = getProjectContextDebugSnapshotDir(tmpDir, 'task-001')
    const snapshots = await fs.readdir(snapshotDir)
    const reviewerSnapshot = snapshots.find((name) => name.includes('reviewer-persona-project-manager'))
    expect(reviewerSnapshot).toBeTruthy()
    const snapshot = await fs.readFile(path.join(snapshotDir, reviewerSnapshot!), 'utf-8')
    expect(snapshot).not.toContain('Persona prompt: 0 chars (empty)')
    expect(snapshot).toContain('## Reviewer Persona')
    expect(snapshot).toContain('You are The Project Manager')
  })

  it('times out a hanging persona call instead of stalling review forever', async () => {
    const runner = buildDefaultReviewerFanout(
      { apiClient: new HangingApiClient(), modelId: 'm' },
      { personaTimeoutMs: 25 },
    )

    const startedAt = Date.now()
    const verdicts = await runner({
      task: mkTask(),
      personas: [
        {
          slug: 'project-manager',
          name: 'The Project Manager',
          blurb: 'Checks handoff quality.',
          role: 'overseer',
          principles: 'Check handoff quality.',
          rubric: [{ id: 'review', question: 'Is the review packet usable?', weight: 1 }],
          deterministicChecks: [],
          applicable: () => true,
        },
      ],
      builtContext: builtContextStub(),
      context: 'Review the task.',
      memoryDir,
      projectPath: tmpDir,
    })

    expect(Date.now() - startedAt).toBeLessThan(1_000)
    expect(verdicts).toHaveLength(1)
    expect(verdicts[0]?.verdict).toBe('revise')
    expect(verdicts[0]?.reasoning).toContain('timed out')
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

    const orch = new Orchestrator({
      config: baseConfig(),
      agents,
      reviewerFanout: runner,
      gitDriver: memoryGitDriver(),
    })
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

  it('passes the persisted review plan into reviewer fan-out', async () => {
    await writeDesignSystem(minimalDS)
    const task = mkTask({
      title: 'Clarify confusing setup flow copy',
      description: 'The UI flow needs clearer labels.',
    })
    await writeQueue([task])
    const agents = agentSet()

    const reviewPlan = {
      taskId: task.id,
      effort: 'balanced',
      depth: 'standard',
      selectedLanes: ['ux_comprehension', 'copy_clarity', 'test_adequacy'],
      skippedLanes: [],
      requiredRecipes: [{
        recipeId: 'product-ux-zero-context',
        version: 'v1',
        lanes: ['ux_comprehension', 'copy_clarity'],
        blocking: 'high',
        required: true,
        calibrationRecipeIds: ['ux-zero-context-comprehension'],
      }],
      deterministicChecks: ['browser-or-screenshot-evidence'],
      requiredArtifacts: ['visual-evidence'],
      budget: { maxReviewerAgents: 4 },
      aggregation: {},
      reasons: ['Stored plan from coordinator.'],
      createdAt: '2026-04-01T00:00:00Z',
      createdBy: 'coordinator-review-planner',
    } as const
    const reviewAuditStore = {
      async readTaskReviewAudit() {
        return {
          plan: {
            payload: reviewPlan,
          },
          events: [],
          reviewerRuns: [],
          escapedMisses: [],
        }
      },
      async saveReviewPlan() {
        throw new Error('should not overwrite existing plan')
      },
      async appendReviewPlanEvent() {
        throw new Error('should not append event for existing plan')
      },
    }

    const calls: { lanes?: readonly string[]; recipeIds?: readonly string[] }[] = []
    const runner: ReviewerFanoutRunner = async ({ personas, reviewPlan: plan }) => {
      calls.push({
        lanes: plan?.selectedLanes,
        recipeIds: plan?.requiredRecipes.map((recipe) => recipe.recipeId),
      })
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

    const orch = new Orchestrator({
      config: baseConfig(),
      agents,
      reviewerFanout: runner,
      reviewAuditStore: reviewAuditStore as never,
      gitDriver: memoryGitDriver(),
    })
    await orch.tick()

    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual({
      lanes: ['ux_comprehension', 'copy_clarity', 'test_adequacy'],
      recipeIds: ['product-ux-zero-context'],
    })
  })

  it('records new review plans with the domain review effort lever', async () => {
    await writeDesignSystem(minimalDS)
    const task = mkTask({
      title: 'Clarify release-note wording',
      description: 'Update public docs copy for the changelog.',
      priority: 'low',
    })
    await writeQueue([task])

    const settings = makeDefaultSettings(new Date('2026-04-01T00:00:00.000Z'))
    settings.domains.overrides = {
      looma: {
        review_effort: {
          position: 'thorough',
          rationale: 'This project wants deeper review while calibrating reviewer coverage.',
          setAt: '2026-04-01T00:00:00.000Z',
          setBy: 'user-direct',
        },
      },
    }
    await saveLeverSettings({
      path: path.join(memoryDir, AGENT_SETTINGS_FILENAME),
      settings,
    })

    const savedPlans: Array<{ effort: string; budget?: { maxReviewerAgents?: number } }> = []
    const reviewAuditStore = {
      async readTaskReviewAudit() {
        return {
          plan: null,
          events: [],
          reviewerRuns: [],
          escapedMisses: [],
        }
      },
      async saveReviewPlan(plan: { effort: string; budget?: { maxReviewerAgents?: number } }) {
        savedPlans.push(plan)
        return { payload: plan }
      },
      async appendReviewPlanEvent() {
        return { payload: {} }
      },
      async appendReviewerRun() {
        return { payload: {} }
      },
    }

    const runner: ReviewerFanoutRunner = async ({ personas }) =>
      personas.map(
        (persona): PersonaVerdict => ({
          guildSlug: persona.slug,
          guildName: persona.name,
          verdict: 'approve',
          reasoning: `${persona.name} approved.`,
          revisionItems: [],
          rawOutput: '**Verdict:** approve',
        }),
      )

    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet(),
      reviewerFanout: runner,
      reviewAuditStore: reviewAuditStore as never,
      gitDriver: memoryGitDriver(),
    })
    await orch.tick()

    expect(savedPlans).toHaveLength(1)
    expect(savedPlans[0]).toMatchObject({
      effort: 'thorough',
      budget: { maxReviewerAgents: 6 },
    })
  })

  it('uses the review plan budget to cap reviewer fan-out personas', async () => {
    await writeDesignSystem(minimalDS)
    const task = mkTask({
      title: 'Clarify confusing setup flow copy',
      description: 'The UI flow needs clearer labels.',
    })
    await writeQueue([task])
    const agents = agentSet()

    const reviewAuditStore = {
      async readTaskReviewAudit() {
        return {
          plan: {
            payload: {
              taskId: task.id,
              effort: 'lean',
              depth: 'minimal',
              selectedLanes: ['ux_comprehension', 'copy_clarity'],
              skippedLanes: [],
              requiredRecipes: [],
              deterministicChecks: [],
              requiredArtifacts: [],
              budget: { maxReviewerAgents: 2 },
              aggregation: {},
              reasons: [],
              createdAt: '2026-04-01T00:00:00Z',
              createdBy: 'coordinator-review-planner',
            },
          },
          events: [],
          reviewerRuns: [],
          escapedMisses: [],
        }
      },
      async saveReviewPlan() {
        throw new Error('should not overwrite existing plan')
      },
      async appendReviewPlanEvent() {
        throw new Error('should not append event for existing plan')
      },
    }

    const calls: { personaSlugs: string[] }[] = []
    const runner: ReviewerFanoutRunner = async ({ personas }) => {
      calls.push({ personaSlugs: personas.map((persona) => persona.slug) })
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

    const orch = new Orchestrator({
      config: baseConfig(),
      agents,
      reviewerFanout: runner,
      reviewAuditStore: reviewAuditStore as never,
      gitDriver: memoryGitDriver(),
    })
    await orch.tick()

    expect(calls).toHaveLength(1)
    expect(calls[0]!.personaSlugs.length).toBeLessThanOrEqual(2)
    expect(calls[0]!.personaSlugs).toEqual(expect.arrayContaining([
      'component-designer',
      'copywriter',
    ]))
  })

  it('persists persona reviewer runs through the review audit store', async () => {
    await writeDesignSystem(minimalDS)
    const task = mkTask({
      title: 'Clarify confusing setup flow copy',
      description: 'The UI flow needs clearer labels.',
    })
    await writeQueue([task])
    const agents = agentSet()

    const savedRuns: Array<{
      taskId: string
      recipeId: string
      lanes: readonly string[]
      verdict: string
      findings: readonly { summary: string }[]
      recordedBy: string
    }> = []
    const reviewAuditStore = {
      async readTaskReviewAudit() {
        return {
          plan: {
            payload: {
              taskId: task.id,
              effort: 'balanced',
              depth: 'standard',
              selectedLanes: ['ux_comprehension', 'copy_clarity'],
              skippedLanes: [],
              requiredRecipes: [{
                recipeId: 'product-ux-zero-context',
                version: 'v1',
                lanes: ['ux_comprehension', 'copy_clarity'],
                blocking: 'high',
                required: true,
                calibrationRecipeIds: ['ux-zero-context-comprehension'],
              }],
              deterministicChecks: [],
              requiredArtifacts: [],
              budget: { maxReviewerAgents: 2 },
              aggregation: {},
              reasons: [],
              createdAt: '2026-04-01T00:00:00Z',
              createdBy: 'coordinator-review-planner',
            },
          },
          events: [],
          reviewerRuns: [],
          escapedMisses: [],
        }
      },
      async saveReviewPlan() {
        throw new Error('should not overwrite existing plan')
      },
      async appendReviewPlanEvent() {
        throw new Error('should not append event for existing plan')
      },
      async saveReviewerRun(run: {
        taskId: string
        recipeId: string
        lanes: readonly string[]
        verdict: string
        findings: readonly { summary: string }[]
        recordedBy: string
      }) {
        savedRuns.push(run)
        return { payload: run } as never
      },
    }

    const runner: ReviewerFanoutRunner = async ({ personas }) =>
      personas.map((persona, index): PersonaVerdict => index === 0
        ? {
            guildSlug: persona.slug,
            guildName: persona.name,
            verdict: 'revise',
            reasoning: `${persona.name} found ambiguous next action copy.`,
            revisionItems: ['Rename the primary action so the next step is clear.'],
            riskItems: ['Users may choose the wrong setup path.'],
            rawOutput: '**Verdict:** revise',
          }
        : {
            guildSlug: persona.slug,
            guildName: persona.name,
            verdict: 'approve',
            reasoning: `${persona.name} approved.`,
            revisionItems: [],
            rawOutput: '**Verdict:** approve',
          })

    const orch = new Orchestrator({
      config: baseConfig(),
      agents,
      reviewerFanout: runner,
      reviewAuditStore: reviewAuditStore as never,
      gitDriver: memoryGitDriver(),
    })
    await orch.tick()

    expect(savedRuns).toHaveLength(2)
    expect(savedRuns[0]).toMatchObject({
      taskId: task.id,
      recipeId: 'product-ux-zero-context',
      lanes: ['ux_comprehension', 'copy_clarity'],
      verdict: 'revise',
      recordedBy: 'reviewer-fanout:component-designer',
    })
    expect(savedRuns[0]!.findings[0]?.summary).toContain('Rename the primary action')
    expect(savedRuns[1]).toMatchObject({
      verdict: 'approve',
      findings: [],
      recordedBy: 'reviewer-fanout:copywriter',
    })
  })

  it('continues review when reviewer-run audit persistence fails', async () => {
    await writeDesignSystem(minimalDS)
    const task = mkTask({
      title: 'Clarify confusing setup flow copy',
      description: 'The UI flow needs clearer labels.',
    })
    await writeQueue([task])
    const agents = agentSet()

    const reviewAuditStore = {
      async readTaskReviewAudit() {
        return {
          plan: {
            payload: {
              taskId: task.id,
              effort: 'lean',
              depth: 'minimal',
              selectedLanes: ['ux_comprehension'],
              skippedLanes: [],
              requiredRecipes: [],
              deterministicChecks: [],
              requiredArtifacts: [],
              budget: { maxReviewerAgents: 1 },
              aggregation: {},
              reasons: [],
              createdAt: '2026-04-01T00:00:00Z',
              createdBy: 'coordinator-review-planner',
            },
          },
          events: [],
          reviewerRuns: [],
          escapedMisses: [],
        }
      },
      async saveReviewPlan() {
        throw new Error('should not overwrite existing plan')
      },
      async appendReviewPlanEvent() {
        throw new Error('should not append event for existing plan')
      },
      async saveReviewerRun() {
        throw new Error('local history unavailable')
      },
    }

    const runner: ReviewerFanoutRunner = async ({ personas }) =>
      personas.map(
        (persona): PersonaVerdict => ({
          guildSlug: persona.slug,
          guildName: persona.name,
          verdict: 'approve',
          reasoning: `${persona.name} approved.`,
          revisionItems: [],
          rawOutput: '**Verdict:** approve',
        }),
      )

    const orch = new Orchestrator({
      config: baseConfig(),
      agents,
      reviewerFanout: runner,
      reviewAuditStore: reviewAuditStore as never,
      gitDriver: memoryGitDriver(),
    })
    await orch.tick()

    const q = await readQueue()
    expect(q.tasks[0]!.status).toBe('gate_check')
    expect(q.tasks[0]!.reviewVerdicts).toHaveLength(1)
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

    const orch = new Orchestrator({
      config: baseConfig(),
      agents,
      reviewerFanout: runner,
      gitDriver: memoryGitDriver(),
    })
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
    const orch = new Orchestrator({
      config: baseConfig(),
      agents,
      gitDriver: memoryGitDriver(),
    })
    await orch.tick()

    expect((agents.reviewer as ReturnType<typeof stubAgent>).calls.length).toBeGreaterThan(0)
    const q = await readQueue()
    const after = q.tasks[0]!
    // Legacy reviewer fell back to the deterministic review path when the
    // stub returned prose without a task-state mutation.
    expect(after.status).toBe('in_progress')
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

    const orch = new Orchestrator({
      config: baseConfig(),
      agents,
      reviewerFanout: runner,
      gitDriver: memoryGitDriver(),
    })
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

    const orch = new Orchestrator({
      config: baseConfig(),
      agents,
      reviewerFanout: runner,
      gitDriver: memoryGitDriver(),
    })
    const outcome = await orch.tick()

    // Outcome should be the blocked-max-revisions variant.
    const hasBlocked = (o: typeof outcome): boolean => {
      if (o.kind === 'blocked-max-revisions') return true
      if (o.kind === 'batch') return o.outcomes.some(hasBlocked)
      return false
    }
    expect(hasBlocked(outcome)).toBe(true)
  })

  it('does not immediately re-escalate fan-out dissent after a resolved max-revisions retry', async () => {
    await writeDesignSystem(minimalDS)
    const task = mkTask({
      revisionCount: 8,
      escalations: [
        {
          id: 'esc-task-001-1',
          taskId: 'task-001',
          agentId: 'reviewer-fanout',
          reason: 'max_revisions_exceeded',
          summary: 'Exceeded maxRevisions (3). Reviewer fan-out keeps rejecting.',
          raisedAt: '2026-04-01T00:00:00Z',
          resolvedAt: '2026-04-01T01:00:00Z',
          resolvedBy: 'human',
          resolution: 'Retry after guardrail fix.',
        },
      ],
    })
    await writeQueue([task])
    const agents = agentSet()

    const runner: ReviewerFanoutRunner = async ({ personas }) =>
      personas.map(
        (persona): PersonaVerdict => ({
          guildSlug: persona.slug,
          guildName: persona.name,
          verdict: 'revise',
          reasoning: `${persona.name} still wants a change.`,
          revisionItems: ['Fix it.'],
          riskItems: [],
          followUpItems: [],
          rawOutput: '**Verdict:** revise',
        }),
      )

    const orch = new Orchestrator({
      config: baseConfig(),
      agents,
      reviewerFanout: runner,
      gitDriver: memoryGitDriver(),
    })
    const outcome = await orch.tick()

    expect(outcome.kind).toBe('processed')
    const q = await readQueue()
    const after = q.tasks[0]!
    expect(after.status).toBe('in_progress')
    expect(after.retryWindow).toEqual({
      startedAt: '2026-04-01T01:00:00Z',
      baseRevisionCount: 8,
    })
    expect(after.escalations).toHaveLength(1)
    expect(after.escalations[0]!.resolvedAt).toBe('2026-04-01T01:00:00Z')
  })
})
