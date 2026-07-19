import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

import {
  OHJSON_PREFIX,
  encodeBackendEvent,
  backendEventSchema,
  type BackendEvent,
} from '@guildhall/backend-host'
import type { ResolvedConfig } from '@guildhall/config'
import type { Task, TaskQueue } from '@guildhall/core'

import {
  AGENT_SETTINGS_FILENAME,
  makeDefaultSettings,
  saveLeverSettings,
} from '@guildhall/levers'
import {
  projectStatePathFromMemoryDir,
  readProjectStateDatabaseAuthority,
  readProjectTaskQueueSync,
  upsertTaskRuntimeState,
} from '@guildhall/sessions'

import { InMemoryGitDriver } from '../git-driver.js'
import { Orchestrator, type OrchestratorAgentSet } from '../orchestrator.js'
import { tickOutcomeToBackendEvent } from '../wire-events.js'
import {
  sanitizeTaskQueueForProjectWrite,
  writePromotedTaskDetailMutation,
  writeProjectTaskQueue,
} from '../project-state-boundary.js'
import { applyProjectMigrations } from '../migrations.js'

// ---------------------------------------------------------------------------
// FR-16: drive the orchestrator through a full task lifecycle and assert
// the OHJSON event stream produced by tickOutcomeToBackendEvent parses
// cleanly and represents every lifecycle transition.
//
// AC-05: "structured event protocol emits all lifecycle events for one
// complete task run, consumable by a subscriber."
// ---------------------------------------------------------------------------

let tmpDir: string
let memoryDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-wire-e2e-'))
  memoryDir = path.join(tmpDir, 'memory')
  await fs.mkdir(memoryDir, { recursive: true })
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

function baseConfig(): ResolvedConfig {
  return {
    workspaceId: 'e2e-ws',
    workspaceName: 'E2E',
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
    title: 'Do a thing',
    description: 'Details here',
    domain: 'looma',
    projectPath: tmpDir,
    status: 'exploring',
    priority: 'normal',
    acceptanceCriteria: [{
      id: 'ac-1',
      description: 'The requested change is complete.',
      verifiedBy: 'review',
      met: false,
    }],
    productBrief: {
      userJob: 'I want the requested task completed.',
      successMetric: 'The acceptance criterion is met.',
      approvedAt: '2026-04-01T00:00:00.000Z',
    },
    spec: [
      '## Summary',
      '',
      'Implement the requested change.',
      '',
      '## Completion Boundary',
      '- Product outcome: The task is complete for the requested scope.',
      '- What Guildhall can complete in code: Update the project and its tests.',
      '- External dependencies: None.',
      '- Owner-only setup: None.',
      '- Verification environment: Local test environment.',
      '- What counts as done: The acceptance criterion is met and review can proceed.',
      '- What must be split or blocked: Nothing.',
      '',
      '## Acceptance Criteria',
      '1. The requested change is complete.',
    ].join('\n'),
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
  const tasksPath = projectStatePathFromMemoryDir(memoryDir, 'TASKS.json')
  // Seed only canonical definition rows. Runtime/evidence fields belong in
  // their normalized stores even during bootstrap, so promotion exercises the
  // same boundary production data uses instead of preserving rich fixtures.
  const normalized = sanitizeTaskQueueForProjectWrite(queue).queue as TaskQueue
  writeProjectTaskQueue(tasksPath, normalized, { projectRoot: tmpDir })
  for (const task of tasks) {
    await upsertTaskRuntimeState(tmpDir, task.id, {
      ...(task.assignedTo !== undefined ? { assignedTo: task.assignedTo } : {}),
      revisionCount: task.revisionCount,
      ...(task.remediationAttempts !== undefined ? { remediationAttempts: task.remediationAttempts } : {}),
      updatedAt: task.updatedAt,
    })
  }
  await applyProjectMigrations({
    projectRoot: tmpDir,
    only: ['0.12.21/task-overlay-authority'],
  })
}

async function mutateTask(id: string, patch: Partial<Task>): Promise<void> {
  const tasksPath = projectStatePathFromMemoryDir(memoryDir, 'TASKS.json')
  const promoted = writePromotedTaskDetailMutation(tasksPath, id, {
    projectId: 'e2e-ws',
    projectRoot: tmpDir,
    mutate: (task) => ({ ...task, ...patch }),
  })
  if (!promoted) throw new Error(`Task ${id} is not in promoted fixture state`)
}

function statePath(relativePath: string): string {
  return projectStatePathFromMemoryDir(memoryDir, relativePath)
}

function stubAgent(name: string, sideEffect?: () => Promise<void> | void) {
  return {
    name,
    async generate(): Promise<{ text: string }> {
      if (sideEffect) await sideEffect()
      return { text: 'ok' }
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

/** Decode an OHJSON line back to a BackendEvent. */
function decode(line: string): BackendEvent {
  expect(line.startsWith(OHJSON_PREFIX)).toBe(true)
  const body = line.slice(OHJSON_PREFIX.length).trim()
  return backendEventSchema.parse(JSON.parse(body))
}

describe('FR-16 end-to-end: orchestrator → OHJSON stream', () => {
  it('seeds TASKS.json through the named migration before promoted reads', async () => {
    await writeQueue([mkTask({ id: 'migrated', status: 'ready' })])

    expect(readProjectStateDatabaseAuthority(tmpDir)).toBe('database')
    expect((readProjectTaskQueueSync(statePath('TASKS.json')) as TaskQueue).tasks)
      .toEqual([expect.objectContaining({ id: 'migrated', status: 'ready' })])
  })

  it('emits a task_transition event for every status change through a happy-path run', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'in_progress' })])

    // Fake worker flips status to 'review' on its turn.
    const worker = stubAgent('worker-agent', async () => {
      await mutateTask('a', { status: 'review' })
    })
    // Fake reviewer approves → gate_check
    const reviewer = stubAgent('reviewer-agent', async () => {
      await mutateTask('a', { status: 'gate_check' })
    })
    // Fake gate checker passes → done
    const gateChecker = stubAgent('gate-checker-agent', async () => {
      await mutateTask('a', {
        status: 'done',
        gateResults: [{
          gateId: 'a-completion',
          passed: true,
          checkedAt: '2026-04-01T00:00:01.000Z',
          output: 'The acceptance criterion is met.',
        }],
      })
    })

    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker, reviewer, gateChecker }),
      gitDriver: new InMemoryGitDriver({ clean: true, currentBranch: 'main' }),
    })

    const stream: string[] = []
    for (let i = 0; i < 3; i++) {
      const outcome = await orch.tick()
      const evt = tickOutcomeToBackendEvent(outcome)
      if (evt) stream.push(encodeBackendEvent(evt))
    }

    expect(stream).toHaveLength(3)
    const parsed = stream.map(decode)

    expect(parsed[0]).toMatchObject({
      type: 'task_transition',
      task_id: 'a',
      from_status: 'in_progress',
      to_status: 'review',
      agent_name: 'worker-agent',
    })
    expect(parsed[1]).toMatchObject({
      type: 'task_transition',
      from_status: 'review',
      to_status: 'gate_check',
      agent_name: 'reviewer-agent',
    })
    expect(parsed[2]).toMatchObject({
      type: 'task_transition',
      from_status: 'gate_check',
      to_status: 'done',
      agent_name: 'approved-review-gates',
    })
  })

  it('flattens a fanout batch outcome into one backend event per sub-outcome via run()', async () => {
    // Configure fanout_2 + per_task worktrees so tick() returns a batch.
    const settings = makeDefaultSettings(new Date('2026-04-22T00:00:00Z'))
    settings.project.concurrent_task_dispatch = {
      position: { kind: 'fanout', n: 2 },
      rationale: 'fanout-wire test',
      setAt: '2026-04-22T00:00:00.000Z',
      setBy: 'system-default',
    }
    settings.project.worktree_isolation = {
      position: 'per_task',
      rationale: 'fanout-wire test',
      setAt: '2026-04-22T00:00:00.000Z',
      setBy: 'system-default',
    }
    settings.project.landing_strategy = {
      position: 'cherry_pick_local',
      rationale: 'fanout-wire test',
      setAt: '2026-04-22T00:00:00.000Z',
      setBy: 'system-default',
    }
    await saveLeverSettings({
      path: statePath(AGENT_SETTINGS_FILENAME),
      settings,
    })

    await writeQueue([
      mkTask({ id: 'task-a', status: 'in_progress' }),
      mkTask({ id: 'task-b', status: 'in_progress' }),
    ])

    let orchRef: Orchestrator | null = null
    const worker = {
      name: 'worker-agent',
      async generate(prompt: string): Promise<{ text: string }> {
        const m = prompt.match(/## Current Task:\s+(\S+)/)
        const id = m?.[1]
        if (id && orchRef) {
          await orchRef.updateQueueAtomically((queue) => {
          const t = queue.tasks.find((x) => x.id === id)
            if (t && t.status === 'in_progress') {
              t.status = 'done'
              t.acceptanceCriteria = t.acceptanceCriteria.map(criterion => ({ ...criterion, met: true }))
              t.gateResults = [{
                gateId: `${id}-completion`,
                passed: true,
                checkedAt: '2026-04-01T00:00:01.000Z',
                output: 'The acceptance criterion is met.',
              }]
              t.completionHandoff = {
                id: `${id}-completion`,
                taskId: id,
                completedAt: '2026-04-01T00:00:01.000Z',
                completedBy: 'worker-agent',
                summary: 'The task was completed by the worker.',
                verified: ['The acceptance criterion is met.'],
                evidenceRefs: [`task:${id}:completion`],
              }
              t.completedAt = '2026-04-01T00:00:01.000Z'
            }
          })
        }
        return { text: 'ok' }
      },
    }

    const events: BackendEvent[] = []
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
      gitDriver: new InMemoryGitDriver({ currentBranch: 'main' }),
      onBackendEvent: async (evt) => {
        events.push(evt)
      },
    })
    orchRef = orch

    await orch.run({ maxTicks: 1, tickDelayMs: 0 })

    const transitions = events.filter((e) => e.type === 'task_transition')
    expect(transitions).toHaveLength(2)
    const ids = transitions.map((e) => e.task_id).sort()
    expect(ids).toEqual(['task-a', 'task-b'])
    for (const t of transitions) {
      expect(t.from_status).toBe('in_progress')
      expect(t.to_status).toBe('done')
      expect(t.agent_name).toBe('worker-agent')
    }
  })

  it('encodes each event as a single OHJSON-prefixed line so a subscriber can parse line-by-line', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'in_progress' })])
    const worker = stubAgent('worker-agent', async () => {
      await mutateTask('a', { status: 'review' })
    })
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
      gitDriver: new InMemoryGitDriver({ clean: true, currentBranch: 'main' }),
    })

    const outcome = await orch.tick()
    const evt = tickOutcomeToBackendEvent(outcome)!
    const line = encodeBackendEvent(evt)

    expect(line.startsWith(OHJSON_PREFIX)).toBe(true)
    expect(line.endsWith('\n')).toBe(true)
    // Only one newline, at the end — OHJSON is strictly line-delimited.
    expect(line.slice(0, -1).includes('\n')).toBe(false)
  })
})
