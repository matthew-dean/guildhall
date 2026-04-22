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

import { Orchestrator, type OrchestratorAgentSet } from '../orchestrator.js'
import { tickOutcomeToBackendEvent } from '../wire-events.js'

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
let tasksPath: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-wire-e2e-'))
  memoryDir = path.join(tmpDir, 'memory')
  await fs.mkdir(memoryDir, { recursive: true })
  tasksPath = path.join(memoryDir, 'TASKS.json')
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

async function mutateTask(id: string, patch: Partial<Task>): Promise<void> {
  const raw = await fs.readFile(tasksPath, 'utf-8')
  const q: TaskQueue = JSON.parse(raw)
  const t = q.tasks.find((x) => x.id === id)
  if (!t) throw new Error(`No task ${id}`)
  Object.assign(t, patch)
  await fs.writeFile(tasksPath, JSON.stringify(q, null, 2), 'utf-8')
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
      await mutateTask('a', { status: 'done' })
    })

    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker, reviewer, gateChecker }),
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
      agent_name: 'gate-checker-agent',
    })
  })

  it('encodes each event as a single OHJSON-prefixed line so a subscriber can parse line-by-line', async () => {
    await writeQueue([mkTask({ id: 'a', status: 'in_progress' })])
    const worker = stubAgent('worker-agent', async () => {
      await mutateTask('a', { status: 'review' })
    })
    const orch = new Orchestrator({
      config: baseConfig(),
      agents: agentSet({ worker }),
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
