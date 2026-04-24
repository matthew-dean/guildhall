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
import type { PersonaVerdict } from '../reviewer-fanout.js'
import {
  AGENT_SETTINGS_FILENAME,
  makeDefaultSettings,
  saveLeverSettings,
} from '@guildhall/levers'

// ---------------------------------------------------------------------------
// End-to-end: when reviewer_fanout_policy = coordinator_adjudicates_on_conflict
// and a persona dissents across two consecutive rounds with overlapping
// revision items, the orchestrator routes to the coordinator adjudication
// path instead of bouncing to the worker with raw dissent feedback.
// ---------------------------------------------------------------------------

let tmpDir: string
let memoryDir: string
let tasksPath: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'adjudication-test-'))
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
    servePort: 7777,
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

async function writeTask(task: Task): Promise<void> {
  const queue: TaskQueue = {
    version: 1,
    lastUpdated: '2026-04-23T00:00:00Z',
    tasks: [task],
  }
  await fs.writeFile(tasksPath, JSON.stringify(queue, null, 2), 'utf-8')
}

async function readQueue(): Promise<TaskQueue> {
  return JSON.parse(await fs.readFile(tasksPath, 'utf-8'))
}

function mkTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    title: 'Gated posting flow with auth',
    description:
      'Add email verification auth endpoint before first post to gate permission for posting',
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

async function setFanoutPolicy(
  position: 'strict' | 'coordinator_adjudicates_on_conflict' | 'advisory' | 'majority',
): Promise<void> {
  const settings = makeDefaultSettings()
  settings.domains.default.reviewer_fanout_policy = {
    position,
    setBy: 'user-direct',
    rationale: 'test override',
    setAt: '2026-04-23T00:00:00Z',
  }
  await saveLeverSettings({
    path: path.join(memoryDir, AGENT_SETTINGS_FILENAME),
    settings,
  })
}

describe('Orchestrator — coordinator adjudication on recurrent dissent', () => {
  it('bounces normally on first round of dissent even under the adjudication policy', async () => {
    await setFanoutPolicy('coordinator_adjudicates_on_conflict')
    await writeTask(mkTask())

    const runner: ReviewerFanoutRunner = async ({ personas }) => {
      return personas.map(
        (persona, i): PersonaVerdict =>
          i === 0
            ? {
                guildSlug: persona.slug,
                guildName: persona.name,
                verdict: 'revise',
                reasoning: 'Email verification must come before posting.',
                revisionItems: ['Verify email before posting.'],
                rawOutput: '',
              }
            : {
                guildSlug: persona.slug,
                guildName: persona.name,
                verdict: 'approve',
                reasoning: `${persona.name} approved.`,
                revisionItems: [],
                rawOutput: '',
              },
      )
    }

    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet(),
      reviewerFanout: runner,
    })
    await orch.tick()

    const after = (await readQueue()).tasks[0]!
    expect(after.status).toBe('in_progress')
    expect(after.adjudications).toHaveLength(0)
    // First-round revise attaches reviewer-fanout note, not coordinator note.
    expect(after.notes.some((n) => n.agentId === 'reviewer-fanout')).toBe(true)
    expect(after.notes.some((n) => n.role === 'coordinator')).toBe(false)
  })

  it('adjudicates on the second round when the same persona dissents with overlapping items', async () => {
    await setFanoutPolicy('coordinator_adjudicates_on_conflict')

    // Seed the task with an already-recorded first round of dissent so the
    // fan-out detector sees it as "prior round." Using the same recordedAt
    // across the two verdicts mimics how the orchestrator writes fan-out
    // verdicts in a single second.
    const priorTs = '2026-04-23T10:00:00.000Z'
    await writeTask(
      mkTask({
        reviewVerdicts: [
          {
            verdict: 'revise',
            reviewerPath: 'llm',
            reason: 'The Security Engineer requested revision',
            reasoning: 'Verify email before posting is required by SOC-2.',
            failingSignals: ['security-engineer'],
            recordedAt: priorTs,
          },
          {
            verdict: 'approve',
            reviewerPath: 'llm',
            reason: 'The Copywriter approved',
            reasoning: 'Copy is fine.',
            failingSignals: [],
            recordedAt: priorTs,
          },
        ],
        revisionCount: 1,
      }),
    )

    const runner: ReviewerFanoutRunner = async ({ personas }) => {
      return personas.map(
        (persona): PersonaVerdict => {
          if (persona.slug === 'security-engineer') {
            return {
              guildSlug: persona.slug,
              guildName: persona.name,
              verdict: 'revise',
              reasoning: 'Verify email before posting still not enforced.',
              revisionItems: ['Verify email before posting.'],
              rawOutput: '',
            }
          }
          return {
            guildSlug: persona.slug,
            guildName: persona.name,
            verdict: 'approve',
            reasoning: `${persona.name} approved.`,
            revisionItems: [],
            rawOutput: '',
          }
        },
      )
    }

    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet(),
      reviewerFanout: runner,
    })
    await orch.tick()

    const after = (await readQueue()).tasks[0]!
    // Coordinator adjudication fires.
    expect(after.adjudications).toHaveLength(1)
    const adj = after.adjudications[0]!
    expect(adj.trigger).toBe('same_persona_repeat_dissent')
    expect(adj.dissenters).toContain('security-engineer')
    expect(adj.scopeInstructions.length).toBeGreaterThan(0)
    // Task bounced to in_progress for the worker to act on the scoped list.
    expect(after.status).toBe('in_progress')
    // The worker-facing note is the coordinator's scoped instructions, not
    // the raw dissent transcript.
    const coordNote = after.notes.find((n) => n.role === 'coordinator')
    expect(coordNote).toBeDefined()
    expect(coordNote!.content).toContain('Scoped instructions')
    expect(coordNote!.content).toContain('Verify email')
    // DECISIONS.md captures the adjudication.
    const decisions = await fs.readFile(
      path.join(memoryDir, 'DECISIONS.md'),
      'utf8',
    )
    expect(decisions).toContain('Reviewer fan-out adjudication')
    expect(decisions).toContain('security-engineer')
  })

  it('does not adjudicate under strict policy even with recurrent dissent', async () => {
    await setFanoutPolicy('strict')
    const priorTs = '2026-04-23T10:00:00.000Z'
    await writeTask(
      mkTask({
        reviewVerdicts: [
          {
            verdict: 'revise',
            reviewerPath: 'llm',
            reason: 'The Security Engineer requested revision',
            reasoning: 'Verify email before posting.',
            failingSignals: ['security-engineer'],
            recordedAt: priorTs,
          },
        ],
        revisionCount: 1,
      }),
    )

    const runner: ReviewerFanoutRunner = async ({ personas }) => {
      return personas.map((persona): PersonaVerdict => ({
        guildSlug: persona.slug,
        guildName: persona.name,
        verdict: persona.slug === 'security-engineer' ? 'revise' : 'approve',
        reasoning:
          persona.slug === 'security-engineer'
            ? 'Verify email before posting still not enforced.'
            : `${persona.name} approved.`,
        revisionItems:
          persona.slug === 'security-engineer'
            ? ['Verify email before posting.']
            : [],
        rawOutput: '',
      }))
    }

    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet(),
      reviewerFanout: runner,
    })
    await orch.tick()

    const after = (await readQueue()).tasks[0]!
    expect(after.adjudications).toHaveLength(0)
    expect(after.status).toBe('in_progress')
  })
})
