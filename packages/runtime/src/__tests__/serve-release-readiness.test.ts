import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { bootstrapWorkspace } from '@guildhall/config'
import type { Task, TaskQueue } from '@guildhall/core'
import { buildServeApp } from '../serve.js'

// Integration tests for GET /api/project/release-readiness — the dashboard's
// "what's still waiting on a human?" aggregator.

let tmpDir: string
let tasksPath: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-release-'))
  bootstrapWorkspace(tmpDir, { name: 'Release Test' })
  tasksPath = path.join(tmpDir, 'memory', 'TASKS.json')
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

function makeTask(overrides: Partial<Task>): Task {
  const now = new Date().toISOString()
  return {
    id: 'task-1',
    title: 'A task',
    description: 'd',
    domain: 'core',
    projectPath: tmpDir,
    status: 'proposed',
    priority: 'normal',
    acceptanceCriteria: [],
    outOfScope: [],
    dependsOn: [],
    notes: [],
    gateResults: [],
    escalations: [],
    agentIssues: [],
    revisionCount: 0,
    remediationAttempts: 0,
    origination: 'human',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

async function seed(tasks: Task[]): Promise<void> {
  const queue: TaskQueue = { version: 1, lastUpdated: new Date().toISOString(), tasks }
  await fs.writeFile(tasksPath, JSON.stringify(queue, null, 2), 'utf-8')
}

describe('GET /api/project/release-readiness', () => {
  it('reports all-clear on an empty workspace', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request('http://localhost/api/project/release-readiness'))
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.totals.blockingCount).toBe(0)
    expect(body.openEscalations).toEqual([])
    expect(body.unapprovedBriefs).toEqual([])
    expect(body.unapprovedSpecs).toEqual([])
  })

  it('surfaces unapproved briefs and specs in spec_review', async () => {
    await seed([
      makeTask({
        id: 'task-1',
        title: 'Brief-needs-approval',
        productBrief: {
          userJob: 'x',
          successMetric: 'y',
          antiPatterns: [],
        },
      }),
      makeTask({
        id: 'task-2',
        title: 'In spec review',
        status: 'spec_review',
      }),
    ])
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request('http://localhost/api/project/release-readiness'))
    const body = await res.json() as any
    expect(body.unapprovedBriefs.map((b: any) => b.id)).toEqual(['task-1'])
    expect(body.unapprovedSpecs.map((b: any) => b.id)).toEqual(['task-2'])
    expect(body.totals.blockingCount).toBe(2)
  })

  it('surfaces open escalations, shelved tasks, and blocked tasks', async () => {
    const now = new Date().toISOString()
    await seed([
      makeTask({
        id: 'task-1',
        title: 'Has an open escalation',
        status: 'blocked',
        blockReason: 'escalation pending',
        escalations: [
          {
            id: 'esc-1',
            taskId: 'task-1',
            agentId: 'agent:spec-agent',
            reason: 'spec_ambiguous',
            summary: 'needs a call',
            raisedAt: now,
          },
        ],
      }),
      makeTask({
        id: 'task-2',
        title: 'Shelved task',
        status: 'shelved',
        shelveReason: {
          code: 'not_viable',
          detail: 'out of scope',
          rejectedBy: 'system:human',
          rejectedAt: now,
          source: 'proposal_policy',
          policyApplied: false,
          requeueCount: 0,
        },
      }),
    ])
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request('http://localhost/api/project/release-readiness'))
    const body = await res.json() as any
    expect(body.openEscalations).toHaveLength(1)
    expect(body.openEscalations[0]).toMatchObject({
      taskId: 'task-1',
      escalationId: 'esc-1',
      reason: 'spec_ambiguous',
    })
    expect(body.shelvedUnclaimed.map((s: any) => s.id)).toEqual(['task-2'])
    expect(body.blockedByAgent.map((b: any) => b.id)).toEqual(['task-1'])
  })

  it('reports the design-system approval state', async () => {
    // Draft a DS via the endpoint, then check before/after approval.
    const { app } = buildServeApp({ projectPath: tmpDir })
    await app.fetch(new Request('http://localhost/api/project/design-system', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tokens: {
          color: [{ name: 'primary', value: '#000' }],
          spacing: [], typography: [], radius: [], shadow: [],
        },
        primitives: [],
        copyVoice: { tone: 'plain', bannedTerms: [], preferredTerms: [], examples: [] },
        authoredBy: 'human',
      }),
    }))
    let res = await app.fetch(new Request('http://localhost/api/project/release-readiness'))
    let body = await res.json() as any
    expect(body.designSystem.drafted).toBe(true)
    expect(body.designSystem.approved).toBe(false)
    expect(body.designSystem.revision).toBe(1)

    await app.fetch(new Request('http://localhost/api/project/design-system/approve', { method: 'POST' }))
    res = await app.fetch(new Request('http://localhost/api/project/release-readiness'))
    body = await res.json() as any
    expect(body.designSystem.approved).toBe(true)
  })
})
