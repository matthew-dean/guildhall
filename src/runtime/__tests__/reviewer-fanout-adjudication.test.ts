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
import { TaskQueue, type Task } from '@guildhall/core'
import type { PersonaVerdict } from '../reviewer-fanout.js'
import {
  AGENT_SETTINGS_FILENAME,
  makeDefaultSettings,
  saveLeverSettings,
} from '@guildhall/levers'
import { projectStatePathFromMemoryDir } from '@guildhall/sessions'
import { buildEffectiveTask } from '../effective-task.js'

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
  tasksPath = projectStatePathFromMemoryDir(memoryDir, 'TASKS.json')
  await fs.mkdir(path.dirname(tasksPath), { recursive: true })
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
      contextIndexer: 'm',
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
  const queue = TaskQueue.parse(JSON.parse(await fs.readFile(tasksPath, 'utf-8')))
  return {
    ...queue,
    tasks: await Promise.all(queue.tasks.map(async task => buildEffectiveTask(task.projectPath, task))) as unknown as Task[],
  }
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
  it('records an approving adjudication verdict when procedural-only dissent advances to gates', async () => {
    await writeTask(mkTask())

    const runner: ReviewerFanoutRunner = async ({ personas }) => {
      return personas.map(
        (persona, i): PersonaVerdict =>
          i === 0
            ? {
                guildSlug: persona.slug,
                guildName: persona.name,
                verdict: 'revise',
                reasoning:
                  'The implementation meets all acceptance criteria. Please add a checkpoint/audit trail follow-up before a future release.',
                revisionItems: ['Add a checkpoint/audit trail follow-up.'],
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
    expect(after.status).toBe('gate_check')
    expect(after.notes.some((n) => n.agentId === 'reviewer-fanout')).toBe(true)
    expect(after.reviewVerdicts.at(-1)).toMatchObject({
      verdict: 'approve',
      reviewerPath: 'deterministic',
      failingSignals: [],
    })
    expect(after.reviewVerdicts.at(-1)?.reason).toContain('procedural-only dissent')
  })

  it('does not bounce completed work for Guildhall checkpoint or audit bookkeeping requests', async () => {
    await writeTask(mkTask())

    const runner: ReviewerFanoutRunner = async ({ personas }) => {
      return personas.map(
        (persona, i): PersonaVerdict =>
          i === 0
            ? {
                guildSlug: persona.slug,
                guildName: persona.name,
                verdict: 'revise',
                reasoning:
                  'All acceptance criteria are satisfied. However, the absence of recorded checkpoints and a persisted audit trail violates the crash-recoverability and traceability requirements.',
                revisionItems: [
                  'Add a checkpoint marker to the README documenting the verification command.',
                  'Insert an audit entry in a product file documenting the verification command.',
                ],
                rawOutput: '**Verdict:** revise',
              }
            : {
                guildSlug: persona.slug,
                guildName: persona.name,
                verdict: 'approve',
                reasoning: `${persona.name} approved.`,
                revisionItems: [],
                rawOutput: '**Verdict:** approve',
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
    expect(after.status).toBe('gate_check')
    expect(after.revisionCount).toBe(0)
    expect(after.notes.at(-1)?.content).toContain('procedural-only')
    expect(after.notes.at(-1)?.content).toContain('persisted audit trail')
  })

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
    expect(adj.trigger).toBe('policy_conflict')
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
      projectStatePathFromMemoryDir(memoryDir, 'DECISIONS.md'),
      'utf8',
    )
    expect(decisions).toContain('Reviewer fan-out adjudication')
    expect(decisions).toContain('security-engineer')
  })

  it('advances when the latest worker proof satisfies the adjudicated concrete artifact request', async () => {
    await setFanoutPolicy('coordinator_adjudicates_on_conflict')
    const priorTs = '2026-04-23T10:00:00.000Z'
    await writeTask(
      mkTask({
        reviewVerdicts: [
          {
            verdict: 'revise',
            reviewerPath: 'llm',
            reason: 'The Backend Engineer requested revision',
            reasoning:
              'Add `scripts/prove-spatial-geographic-continuity.mjs` and `fixtures/spatial-geographic-continuity/impossible-walk.json`.',
            failingSignals: ['backend-engineer'],
            recordedAt: priorTs,
          },
          {
            verdict: 'approve',
            reviewerPath: 'llm',
            reason: 'The Accessibility Specialist approved',
            reasoning: 'Shape is good.',
            failingSignals: [],
            recordedAt: priorTs,
          },
        ],
        notes: [
          {
            agentId: 'coordinator-product-direction',
            role: 'coordinator',
            content:
              '**Coordinator adjudication (round 3):**\n\nScoped instructions:\n- Implement `scripts/prove-spatial-geographic-continuity.mjs` against `fixtures/spatial-geographic-continuity/impossible-walk.json`.',
            timestamp: '2026-04-23T10:05:00.000Z',
          },
          {
            agentId: 'worker-agent',
            role: 'worker',
            content:
              '**Self-critique:** ac-1 met. `scripts/prove-spatial-geographic-continuity.mjs` processes `fixtures/spatial-geographic-continuity/impossible-walk.json`. Verification passed: `npm run prove:spatial-geographic-continuity` emitted ok: true; `npm run build` passed.',
            timestamp: '2026-04-23T10:10:00.000Z',
          },
        ],
        revisionCount: 2,
      }),
    )

    const runner: ReviewerFanoutRunner = async ({ personas }) => {
      return personas.map(
        (persona): PersonaVerdict => {
          if (persona.slug === 'backend-engineer') {
            return {
              guildSlug: persona.slug,
              guildName: persona.name,
              verdict: 'revise',
              reasoning:
                'Still missing `scripts/prove-spatial-geographic-continuity.mjs` and `fixtures/spatial-geographic-continuity/impossible-walk.json`.',
              revisionItems: [
                'Add `scripts/prove-spatial-geographic-continuity.mjs` and `fixtures/spatial-geographic-continuity/impossible-walk.json`.',
              ],
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
    expect(after.status).toBe('gate_check')
    expect(after.reviewVerdicts.at(-1)).toMatchObject({
      verdict: 'approve',
      reviewerPath: 'deterministic',
      failingSignals: [],
    })
    expect(after.reviewVerdicts.at(-1)?.reason).toContain('Coordinator adjudication scope satisfied')
    expect(after.notes.at(-1)?.content).toContain('latest worker proof satisfies')
  })

  it('routes repeated same-persona dissent through coordinator inspection under strict policy', async () => {
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
    expect(after.adjudications).toHaveLength(1)
    expect(after.adjudications[0]).toMatchObject({
      trigger: 'policy_conflict',
      dissenters: ['security-engineer'],
      decidedBy: 'coordinator',
    })
    expect(after.status).toBe('in_progress')
  })

  it('escalates instead of looping when the same dissent returns after coordinator adjudication', async () => {
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
        adjudications: [
          {
            round: 2,
            trigger: 'policy_conflict',
            dissenters: ['security-engineer'],
            winningConcerns: ['security-engineer'],
            supersededConcerns: [],
            summary: 'Coordinator adjudicated the security revision.',
            rationale: 'Worker should address email verification before posting.',
            scopeInstructions: ['Verify email before posting.'],
            decidedBy: 'coordinator',
            decidedAt: '2026-04-23T10:05:00.000Z',
          },
        ],
        revisionCount: 2,
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
    const outcome = await orch.tick()

    expect(outcome?.kind).toBe('escalated')
    const after = (await readQueue()).tasks[0]!
    expect(after.status).toBe('blocked')
    expect(after.blockReason).toContain('Reviewer/worker handoff loop detected')
    expect(after.escalations.at(-1)).toMatchObject({
      agentId: 'coordinator-foreman',
      reason: 'human_judgment_required',
      summary: 'Reviewer/worker handoff loop detected after coordinator adjudication.',
    })
    expect(after.notes.some((note) => note.agentId === 'reviewer-fanout')).toBe(false)
  })
})
