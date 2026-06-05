import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { bootstrapWorkspace, slugify } from '@guildhall/config'
import type { Task, TaskQueue } from '@guildhall/core'
import { getProjectStateDir } from '@guildhall/sessions'
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
  tasksPath = path.join(getProjectStateDir(tmpDir), 'TASKS.json')
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
  await fs.mkdir(path.dirname(tasksPath), { recursive: true })
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
  await execFileP('git', ['commit', '--allow-empty', '-m', message], { cwd: tmpDir })
  await execFileP('git', ['push'], { cwd: tmpDir })
}

describe('GET /api/project/release-readiness', () => {
  it('reports initializationNeeded for an attached-but-uninitialized project shell', async () => {
    const emptyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-release-uninitialized-'))
    try {
      const { app } = buildServeApp({ projectPath: emptyDir })
      const fallbackId = slugify(path.basename(emptyDir))
      const url = new URL('http://localhost/api/project/release-readiness')
      url.searchParams.set('projectId', fallbackId)
      const res = await app.fetch(new Request(url))
      expect(res.status).toBe(200)
      const body = await res.json() as { initializationNeeded?: boolean }
      expect(body.initializationNeeded).toBe(true)
    } finally {
      await fs.rm(emptyDir, { recursive: true, force: true })
    }
  })

  it('does not call an empty workspace release-ready', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/release-readiness')))
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.ready).toBe(false)
    expect(body.notReadyReason).toBe('No tasks in this project yet.')
    expect(body.totals.blockingCount).toBe(0)
    expect(body.openEscalations).toEqual([])
    expect(body.unapprovedBriefs).toEqual([])
    expect(body.unapprovedSpecs).toEqual([])
  })

  it('returns a plain release-readiness load error when task state cannot be read', async () => {
    await fs.writeFile(tasksPath, '{ broken json', 'utf-8')
    const { app } = buildServeApp({ projectPath: tmpDir })

    const res = await app.fetch(new Request(projectUrl('/api/project/release-readiness')))
    const body = await res.json() as any

    expect(res.status).toBe(500)
    expect(body.error).toBe('Could not load release readiness for this project.')
    expect(body.detail).toMatch(/TASKS\.json/)
    expect(body.detail).not.toMatch(/SyntaxError/)
  })

  it('surfaces unapproved briefs and specs in spec_review', async () => {
    await seed([
      makeTask({
        id: 'task-1',
        title: 'Brief-needs-approval',
        productBrief: {
          userJob: 'x',
          whyItMattersNow: 'because this task is ready for an owner approval decision',
          successMetric: 'y',
          nonGoals: ['Do not expand the release scope.'],
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
    const res = await app.fetch(new Request(projectUrl('/api/project/release-readiness')))
    const body = await res.json() as any
    expect(body.unapprovedBriefs.map((b: any) => b.id)).toEqual(['task-1'])
    expect(body.unapprovedSpecs.map((b: any) => b.id)).toEqual(['task-2'])
    expect(body.totals.humanBlockingCount).toBe(2)
    expect(body.totals.blockingCount).toBeGreaterThan(2)
  })

  it('separates incomplete briefs from approval-ready briefs', async () => {
    await seed([
      makeTask({
        id: 'task-incomplete',
        title: 'Needs brief cleanup',
        status: 'proposed',
        productBrief: {
          userJob: 'x',
          successMetric: 'y',
          antiPatterns: [],
        },
      }),
      makeTask({
        id: 'task-unapproved',
        title: 'Ready for brief approval',
        status: 'proposed',
        productBrief: {
          userJob: 'x',
          whyItMattersNow: 'because this can close a real user gap',
          successMetric: 'y',
          nonGoals: ['Do not widen scope.'],
        },
      }),
    ])
    const { app } = buildServeApp({ projectPath: tmpDir })
    await approveDesignSystem(app)
    await commitAndPush('settle brief fixtures')

    const res = await app.fetch(new Request(projectUrl('/api/project/release-readiness')))
    const body = await res.json() as any

    expect(body.incompleteBriefs).toEqual([
      {
        id: 'task-incomplete',
        title: 'Needs brief cleanup',
        reason: 'Task brief needs user job, why it matters now, success metric, and at least one non-goal before approval.',
      },
    ])
    expect(body.unapprovedBriefs.map((b: any) => b.id)).toEqual(['task-unapproved'])
    expect(body.totals.incompleteBriefBlockingCount).toBe(1)
    expect(body.totals.humanBlockingCount).toBe(2)
  })

  it('keeps external setup blockers owner-facing in release readiness', async () => {
    await seed([
      makeTask({
        id: 'task-oauth',
        title: 'Connect OAuth provider',
        status: 'blocked',
        blockReason: 'OAuth client secrets need external setup before Guildhall can verify this work.',
      }),
    ])
    const { app } = buildServeApp({ projectPath: tmpDir })
    await approveDesignSystem(app)
    await commitAndPush('settle external setup blocker')

    const res = await app.fetch(new Request(projectUrl('/api/project/release-readiness')))
    const body = await res.json() as any

    expect(body.ready).toBe(false)
    expect(body.blockedByAgent).toEqual([
      {
        id: 'task-oauth',
        title: 'Connect OAuth provider',
        reason: 'OAuth client secrets need external setup before Guildhall can verify this work.',
      },
    ])
    expect(body.totals.humanBlockingCount).toBe(1)
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
    const res = await app.fetch(new Request(projectUrl('/api/project/release-readiness')))
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
    const res = await app.fetch(new Request(projectUrl('/api/project/release-readiness')))
    const body = await res.json() as any
    expect(body.ready).toBe(true)
    expect(body.totals.done).toBe(1)
    expect(body.totals.blockingCount).toBe(0)
  })

  it('blocks current work closure when Guildhall-owned project files are dirty', async () => {
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
    await fs.writeFile(path.join(tmpDir, 'guildhall.yaml'), 'name: Release Test\nid: release-test\nnotes: unlanded\n', 'utf8')

    const res = await app.fetch(new Request(projectUrl('/api/project/release-readiness')))
    const body = await res.json() as any

    expect(body.ready).toBe(false)
    expect(body.dirtyCheckout.ownedCount).toBe(1)
    expect(body.dirtyCheckout.files).toEqual(['guildhall.yaml'])
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
    const res = await app.fetch(new Request(projectUrl('/api/project/release-readiness')))
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
    let res = await app.fetch(new Request(projectUrl('/api/project/release-readiness')))
    let body = await res.json() as any
    expect(body.designSystem.drafted).toBe(true)
    expect(body.designSystem.approved).toBe(false)
    expect(body.designSystem.revision).toBe(1)

    await app.fetch(new Request(projectUrl('/api/project/design-system/approve'), { method: 'POST' }))
    res = await app.fetch(new Request(projectUrl('/api/project/release-readiness')))
    body = await res.json() as any
    expect(body.designSystem.approved).toBe(true)
  })

  it('treats a component-library repo as having its design system in the repo', async () => {
    await seed([
      makeTask({
        id: 'task-1',
        title: 'Completed component work',
        status: 'done',
        completedAt: '2026-05-09T00:00:00Z',
      }),
    ])
    await fs.writeFile(
      path.join(tmpDir, '.guildhall', 'codebase-map.yaml'),
      [
        'version: 1',
        `generatedAt: ${new Date().toISOString()}`,
        'project:',
        `  root: ${tmpDir}`,
        '  summary: Component library with design-system components.',
        '  languages: [typescript]',
        '  packageManagers: [pnpm]',
        '  primaryFrameworks: []',
        'files: {}',
        'entrypoints: []',
        'areas: []',
        'abstractions: []',
        'designSystem:',
        '  approved: false',
        '  tokenCounts: { color: 0, spacing: 0, typography: 0, radius: 0, shadow: 0 }',
        '  tokenSamples: []',
        '  primitives: []',
        '  componentFiles:',
        '    - packages/core/src/components/ui-button/ui-button.tsx',
        '    - packages/core/src/components/ui-dialog/ui-dialog.tsx',
        '    - packages/core/src/components/ui-tooltip/ui-tooltip.tsx',
        '    - packages/core/src/components/ui-tabs/ui-tabs.tsx',
        '  maturity: absent',
        '  recommendations: []',
        'verification: { commands: [] }',
        '',
      ].join('\n'),
      'utf8',
    )
    await fs.writeFile(
      path.join(tmpDir, 'guildhall.yaml'),
      [
        'name: Release Test',
        'tags:',
        '  - ui-library',
        '',
      ].join('\n'),
      'utf8',
    )
    const { app } = buildServeApp({ projectPath: tmpDir })
    await commitAndPush('settle component library')

    const res = await app.fetch(new Request(projectUrl('/api/project/release-readiness')))
    const body = await res.json() as any

    expect(body.ready).toBe(true)
    expect(body.designSystem).toMatchObject({
      drafted: true,
      approved: true,
      source: 'repo',
      label: 'detected in repo',
    })
    expect(body.totals.designSystemBlockingCount).toBe(0)
  })
})
