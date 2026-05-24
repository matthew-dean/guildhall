import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { bootstrapWorkspace } from '@guildhall/config'
import type { Task, TaskQueue } from '@guildhall/core'
import { buildServeApp } from '../serve.js'

// Integration tests for GET /api/project/release-readiness — the dashboard's
// "what's still waiting on a human?" aggregator.

let tmpDir: string
let remoteDir: string
let tasksPath: string
let projectId: string
const execFileP = promisify(execFile)

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-release-'))
  remoteDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-release-remote-'))
  projectId = bootstrapWorkspace(tmpDir, { name: 'Release Test' }).id ?? path.basename(tmpDir)
  tasksPath = path.join(tmpDir, '.guildhall', 'TASKS.json')
  await execFileP('git', ['init', '-b', 'main'], { cwd: tmpDir })
  await execFileP('git', ['config', 'user.email', 'guildhall@example.test'], { cwd: tmpDir })
  await execFileP('git', ['config', 'user.name', 'Guildhall Test'], { cwd: tmpDir })
  await execFileP('git', ['add', '.'], { cwd: tmpDir })
  await execFileP('git', ['commit', '-m', 'baseline'], { cwd: tmpDir })
  await execFileP('git', ['init', '--bare'], { cwd: remoteDir })
  await execFileP('git', ['remote', 'add', 'origin', remoteDir], { cwd: tmpDir })
  await execFileP('git', ['push', '-u', 'origin', 'main'], { cwd: tmpDir })
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
  await fs.rm(remoteDir, { recursive: true, force: true })
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
    reviewVerdicts: [],
    adjudications: [],
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

function projectUrl(route: string): string {
  const url = new URL(`http://localhost${route}`)
  url.searchParams.set('projectId', projectId)
  return url.toString()
}

async function approveDesignSystem(app: ReturnType<typeof buildServeApp>['app']): Promise<void> {
  await app.fetch(new Request(projectUrl('/api/project/design-system'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      tokens: {
        color: [{ name: 'primary', value: '#000' }],
        spacing: [],
        typography: [],
        radius: [],
        shadow: [],
      },
      primitives: [],
      copyVoice: { tone: 'plain', bannedTerms: [], preferredTerms: [], examples: [] },
      authoredBy: 'human',
    }),
  }))
  await app.fetch(new Request(projectUrl('/api/project/design-system/approve'), { method: 'POST' }))
}

async function commitAndPush(message: string): Promise<void> {
  await execFileP('git', ['add', '-f', '--', 'guildhall.yaml', '.guildhall'], { cwd: tmpDir })
  await execFileP('git', ['commit', '-m', message], { cwd: tmpDir })
  await execFileP('git', ['push'], { cwd: tmpDir })
}

describe('GET /api/project/release-readiness', () => {
  it('reports initializationNeeded for an attached-but-uninitialized project shell', async () => {
    const emptyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-release-uninitialized-'))
    try {
      const { app } = buildServeApp({ projectPath: emptyDir })
      const res = await app.fetch(new Request('http://localhost/api/project/release-readiness'))
      expect(res.status).toBe(200)
      const body = await res.json() as { initializationNeeded?: boolean }
      expect(body.initializationNeeded).toBe(true)
    } finally {
      await fs.rm(emptyDir, { recursive: true, force: true })
    }
  })

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
    await approveDesignSystem(app)
    await commitAndPush('settle terminal tasks')
    const res = await app.fetch(new Request('http://localhost/api/project/release-readiness'))
    const body = await res.json() as any
    expect(body.unapprovedBriefs.map((b: any) => b.id)).toEqual(['task-1'])
    expect(body.unapprovedSpecs.map((b: any) => b.id)).toEqual(['task-2'])
    expect(body.totals.humanBlockingCount).toBe(2)
    expect(body.totals.blockingCount).toBeGreaterThan(2)
  })

  it('does not count terminal or reserved workspace-import briefs as human blockers', async () => {
    await seed([
      makeTask({
        id: 'done-brief',
        title: 'Done brief',
        status: 'done',
        productBrief: {
          userJob: 'x',
          successMetric: 'y',
          antiPatterns: [],
        },
      }),
      makeTask({
        id: 'task-workspace-import',
        title: 'Workspace import',
        status: 'done',
        productBrief: {
          userJob: 'x',
          successMetric: 'y',
          antiPatterns: [],
        },
      }),
      makeTask({
        id: 'shelved-brief',
        title: 'Shelved brief',
        status: 'shelved',
        productBrief: {
          userJob: 'x',
          successMetric: 'y',
          antiPatterns: [],
        },
      }),
    ])
    const { app } = buildServeApp({ projectPath: tmpDir })
    await approveDesignSystem(app)
    await commitAndPush('settle done task')
    const res = await app.fetch(new Request('http://localhost/api/project/release-readiness'))
    const body = await res.json() as any
    expect(body.unapprovedBriefs).toEqual([])
    expect(body.totals.blockingCount).toBe(0)
  })

  it('treats a done-only narrow-lane project as release-ready', async () => {
    await seed([
      makeTask({
        id: 'task-1',
        title: 'Completed cleanup',
        status: 'done',
        completedAt: '2026-05-09T00:00:00Z',
      }),
    ])
    const { app } = buildServeApp({ projectPath: tmpDir })
    await approveDesignSystem(app)
    await commitAndPush('settle done task')
    const res = await app.fetch(new Request('http://localhost/api/project/release-readiness'))
    const body = await res.json() as any
    expect(body.ready).toBe(true)
    expect(body.totals.done).toBe(1)
    expect(body.totals.blockingCount).toBe(0)
  })

  it('blocks release readiness when Guildhall-owned project files are dirty', async () => {
    await seed([
      makeTask({
        id: 'task-1',
        title: 'Completed cleanup',
        status: 'done',
        completedAt: '2026-05-09T00:00:00Z',
      }),
    ])
    const { app } = buildServeApp({ projectPath: tmpDir })
    await approveDesignSystem(app)
    await commitAndPush('approve design system')
    await fs.writeFile(path.join(tmpDir, '.guildhall', 'release-note.md'), 'unlanded Guildhall note\n', 'utf8')

    const res = await app.fetch(new Request('http://localhost/api/project/release-readiness'))
    const body = await res.json() as any

    expect(body.ready).toBe(false)
    expect(body.dirtyCheckout.ownedCount).toBe(1)
    expect(body.dirtyCheckout.files).toEqual(['.guildhall/release-note.md'])
    expect(body.totals.dirtyCheckoutBlockingCount).toBe(1)
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
    expect(body.totals.humanBlockingCount).toBe(2)
    expect(body.totals.blockingCount).toBeGreaterThan(2)
  })

  it('reports the design-system approval state', async () => {
    // Draft a DS via the endpoint, then check before/after approval.
    const { app } = buildServeApp({ projectPath: tmpDir })
    await app.fetch(new Request(projectUrl('/api/project/design-system'), {
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

    await app.fetch(new Request(projectUrl('/api/project/design-system/approve'), { method: 'POST' }))
    res = await app.fetch(new Request('http://localhost/api/project/release-readiness'))
    body = await res.json() as any
    expect(body.designSystem.approved).toBe(true)
  })
})
