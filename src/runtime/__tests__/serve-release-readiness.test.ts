import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { bootstrapWorkspace, registerWorkspace, slugify, unregisterWorkspace } from '@guildhall/config'
import type { Task, TaskQueue } from '@guildhall/core'
import { appendTaskEvidence, projectStatePath, writeProjectStateJsonAsync, writeProjectStateTextAsync } from '@guildhall/sessions'
import { buildServeApp } from '../serve.js'

// Integration tests for GET /api/project/release-readiness — the dashboard's
// "what's still waiting on a human?" aggregator.

let tmpDir: string
let remoteDir: string
let projectId: string
const execFileP = promisify(execFile)

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-release-'))
  remoteDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-release-remote-'))
  projectId = bootstrapWorkspace(tmpDir, { name: 'Release Test' }).id ?? path.basename(tmpDir)
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
  unregisterWorkspace(projectId)
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

function modeledScriptProof(command = 'pnpm test'): Pick<Task, 'proofPaths' | 'gateResults'> {
  return {
    proofPaths: [{
      title: command,
      launchSteps: [{ id: command, title: command, kind: 'copy_command', command }],
      expectedEvidence: [`${command} passed.`],
    }],
    gateResults: [{
      gateId: command,
      command,
      type: 'hard',
      passed: true,
      output: `${command} passed.`,
      checkedAt: '2026-07-04T08:50:00.000Z',
    }],
  } as Pick<Task, 'proofPaths' | 'gateResults'>
}

async function seed(tasks: Task[]): Promise<void> {
  const queue: TaskQueue = { version: 1, lastUpdated: new Date().toISOString(), tasks }
  await writeProjectStateJsonAsync(tmpDir, 'TASKS.json', queue)
}

async function seedQueue(queue: TaskQueue): Promise<void> {
  await writeProjectStateJsonAsync(tmpDir, 'TASKS.json', {
    ...queue,
    version: queue.version ?? 1,
    lastUpdated: queue.lastUpdated ?? new Date().toISOString(),
  })
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
  await execFileP('git', ['add', '-f', '--', 'guildhall.yaml'], { cwd: tmpDir })
  await execFileP('git', ['commit', '--allow-empty', '-m', message], { cwd: tmpDir })
  await execFileP('git', ['push'], { cwd: tmpDir })
}

async function initChildRepo(repoPath: string): Promise<void> {
  await fs.mkdir(repoPath, { recursive: true })
  await execFileP('git', ['init', '-b', 'main'], { cwd: repoPath })
  await execFileP('git', ['config', 'user.email', 'guildhall@example.test'], { cwd: repoPath })
  await execFileP('git', ['config', 'user.name', 'Guildhall Test'], { cwd: repoPath })
  await fs.writeFile(path.join(repoPath, 'README.md'), '# child repo\n', 'utf8')
  await execFileP('git', ['add', '.'], { cwd: repoPath })
  await execFileP('git', ['commit', '-m', 'baseline'], { cwd: repoPath })
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
    expect(body.release).toBeNull()
    expect(body.scope).toMatchObject({ id: 'current-work', label: 'Current task scope', kind: 'current_work' })
    expect(body.notReadyReason).toBe('No tasks in this scope yet.')
    expect(body.totals.blockingCount).toBe(0)
    expect(body.openEscalations).toEqual([])
    expect(body.unapprovedBriefs).toEqual([])
    expect(body.unapprovedSpecs).toEqual([])
  })

  it('returns the selected named release when a project defines releases', async () => {
    await seedQueue({
      version: 1,
      lastUpdated: new Date().toISOString(),
      selectedReleaseId: '2-0-alpha',
      releases: [{
        id: '2-0-alpha',
        label: '2.0 alpha',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        nodeIds: ['work:task-alpha'],
        deferredNodeIds: ['work:task-later'],
        proofStyle: 'script_only',
      }],
      tasks: [
        makeTask({ id: 'task-alpha', title: 'Alpha work', status: 'ready', releaseIds: ['2-0-alpha'] }),
        makeTask({ id: 'task-later', title: 'Later work', status: 'ready' }),
      ],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })

    const res = await app.fetch(new Request(projectUrl('/api/project/release-readiness')))
    const body = await res.json() as any

    expect(body.release).toMatchObject({
      id: '2-0-alpha',
      label: '2.0 alpha',
      kind: 'release',
      source: 'release_plan',
    })
    expect(body.scope).toMatchObject({ id: '2-0-alpha', label: '2.0 alpha' })
  })

  it('does not require a design-system guardrail for no-UI headless release work', async () => {
    await seedQueue({
      version: 1,
      lastUpdated: new Date().toISOString(),
      selectedReleaseId: 'headless-mvp',
      releases: [{
        id: 'headless-mvp',
        label: 'Headless MVP',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        nodeIds: ['work:task-runner'],
        deferredNodeIds: [],
        proofStyle: 'unspecified',
      }],
      tasks: [
        makeTask({
          id: 'task-runner',
          title: 'Implement a no-UI runner that builds a packet from fixture records',
          description: 'The harness run works without a frontend and stays inside the no-UI prototype boundary.',
          status: 'done',
          completedAt: '2026-05-08T00:00:00Z',
          releaseIds: ['headless-mvp'],
        }),
      ],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    await commitAndPush('headless proof landed')

    const res = await app.fetch(new Request(projectUrl('/api/project/release-readiness')))
    const body = await res.json() as any

    expect(body.designSystem).toMatchObject({
      drafted: false,
      approved: false,
      source: 'none',
    })
    expect(body.totals.designSystemBlockingCount).toBe(0)
    expect(body.ready).toBe(true)
  })

  it('uses the orientation execution boundary when the release proof style is unspecified', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'README.md'),
      [
        '# Narrative Harness',
        '',
        'The first MVP is headless: script-only proofs of all systems.',
      ].join('\n'),
      'utf8',
    )
    await execFileP('git', ['add', 'README.md'], { cwd: tmpDir })
    await execFileP('git', ['commit', '-m', 'document headless boundary'], { cwd: tmpDir })
    await execFileP('git', ['push'], { cwd: tmpDir })
    await seedQueue({
      version: 1,
      lastUpdated: new Date().toISOString(),
      selectedReleaseId: 'near-term-proof',
      releases: [{
        id: 'near-term-proof',
        label: 'Near-term proof',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        nodeIds: ['work:task-review-plan'],
        deferredNodeIds: [],
        proofStyle: 'unspecified',
      }],
      tasks: [
        makeTask({
          id: 'task-review-plan',
          title: 'Define reviewer UI context plan',
          description: 'Specify which review dimensions participate in the script-only proof run.',
          status: 'done',
          completedAt: '2026-05-08T00:00:00Z',
          releaseIds: ['near-term-proof'],
        }),
      ],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })

    const res = await app.fetch(new Request(projectUrl('/api/project/release-readiness')))
    const body = await res.json() as any

    expect(body.release).toMatchObject({ id: 'near-term-proof', proofStyle: 'script_only' })
    expect(body.totals.designSystemBlockingCount).toBe(0)
  })

  it('does not treat negated UI copy as release UI work', async () => {
    await seedQueue({
      version: 1,
      lastUpdated: new Date().toISOString(),
      selectedReleaseId: 'contract-proof',
      releases: [{
        id: 'contract-proof',
        label: 'Contract proof',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        nodeIds: ['work:task-contract'],
        deferredNodeIds: [],
        proofStyle: 'unspecified',
      }],
      tasks: [
        makeTask({
          id: 'task-contract',
          title: 'Define fixture contracts',
          description: 'Do not add UI copy or API endpoints for this contract-only child task.',
          status: 'done',
          completedAt: '2026-05-08T00:00:00Z',
          releaseIds: ['contract-proof'],
        }),
      ],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    await commitAndPush('contract proof landed')

    const res = await app.fetch(new Request(projectUrl('/api/project/release-readiness')))
    const body = await res.json() as any

    expect(body.totals.designSystemBlockingCount).toBe(0)
    expect(body.ready).toBe(true)
  })

  it('still requires a design-system guardrail when a mixed release includes UI work', async () => {
    await seedQueue({
      version: 1,
      lastUpdated: new Date().toISOString(),
      selectedReleaseId: 'mixed-alpha',
      releases: [{
        id: 'mixed-alpha',
        label: 'Mixed alpha',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        nodeIds: ['work:task-runner', 'work:task-ui'],
        deferredNodeIds: [],
        proofStyle: 'unspecified',
      }],
      tasks: [
        makeTask({
          id: 'task-runner',
          title: 'Implement a no-UI runner that builds a packet from fixture records',
          description: 'The harness run works without a frontend.',
          status: 'done',
          completedAt: '2026-05-08T00:00:00Z',
          releaseIds: ['mixed-alpha'],
        }),
        makeTask({
          id: 'task-ui',
          title: 'Add the review screen layout',
          description: 'The browser view shows reviewer findings responsively.',
          status: 'done',
          completedAt: '2026-05-08T00:00:00Z',
          releaseIds: ['mixed-alpha'],
        }),
      ],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    await commitAndPush('mixed proof landed')

    const res = await app.fetch(new Request(projectUrl('/api/project/release-readiness')))
    const body = await res.json() as any

    expect(body.totals.designSystemBlockingCount).toBe(1)
    expect(body.ready).toBe(false)
    expect(body.releaseBlockers).toEqual([
      expect.objectContaining({
        id: 'design-system',
        title: 'Design system',
        label: expect.stringContaining('No design-system guardrail is captured yet.'),
      }),
    ])
  })

  it('counts only the selected scope when later or stale tasks remain elsewhere in the queue', async () => {
    await seedQueue({
      version: 1,
      lastUpdated: new Date().toISOString(),
      selectedReleaseId: 'headless-mvp',
      releases: [{
        id: 'headless-mvp',
        label: 'Headless MVP',
        kind: 'release',
        state: 'ready',
        source: 'release_plan',
        nodeIds: ['work:task-current'],
        deferredNodeIds: [],
        proofStyle: 'script_only',
      }],
      tasks: [
        makeTask({ id: 'task-current', title: 'Current proof lane', status: 'import_draft' }),
        makeTask({
          id: 'task-later',
          title: 'Later reviewer lane',
          status: 'shelved',
          shelveReason: {
            code: 'no_op',
            detail: 'Out-of-scope legacy residue.',
            rejectedBy: 'system:proposal-policy',
            rejectedAt: new Date(0).toISOString(),
            source: 'proposal_policy',
            policyApplied: true,
          },
        } as any),
        makeTask({ id: 'task-archived', title: 'Archived residue', status: 'archived' }),
      ],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    await approveDesignSystem(app)
    await commitAndPush('scope-only release readiness')

    const res = await app.fetch(new Request(projectUrl('/api/project/release-readiness')))
    const body = await res.json() as any

    expect(body.scope).toMatchObject({ id: 'headless-mvp', label: 'Headless MVP' })
    expect(body.totals.tasks).toBe(1)
    expect(body.statusCounts).toEqual({ import_draft: 1 })
    expect(body.shelvedUnclaimed).toEqual([])
    expect(body.totals.unfinishedCount).toBe(1)
  })

  it('does not let out-of-scope task git stories block the selected release', async () => {
    await seedQueue({
      version: 1,
      lastUpdated: new Date().toISOString(),
      selectedReleaseId: 'headless-mvp',
      releases: [{
        id: 'headless-mvp',
        label: 'Headless script-only MVP',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        nodeIds: ['work:task-current'],
        deferredNodeIds: ['work:task-archived'],
        proofStyle: 'script_only',
      }],
      tasks: [
        makeTask({ id: 'task-current', title: 'Current proof lane', status: 'done', releaseIds: ['headless-mvp'], ...modeledScriptProof() }),
        makeTask({
          id: 'task-archived',
          title: 'Archived residue with stale merge story',
          status: 'archived',
          mergeRecord: {
            result: 'skipped',
            detail: 'Old out-of-scope task completed before this release was selected.',
          },
        } as any),
      ],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    await approveDesignSystem(app)
    await commitAndPush('selected release git story scope')

    const res = await app.fetch(new Request(projectUrl('/api/project/release-readiness')))
    const body = await res.json() as any

    expect(body.totals.tasks).toBe(1)
    expect(body.statusCounts).toEqual({ done: 1 })
    expect(body.totals.gitStoryBlockingCount).toBe(0)
    expect(body.gitStory.blockers).toEqual([])
    expect(body.ready).toBe(true)
  })

  it('does not call a selected release ready while current-scope git story follow-up remains', async () => {
    await seedQueue({
      version: 1,
      lastUpdated: new Date().toISOString(),
      selectedReleaseId: 'headless-mvp',
      releases: [{
        id: 'headless-mvp',
        label: 'Headless MVP',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        nodeIds: ['work:task-current'],
        deferredNodeIds: [],
        proofStyle: 'script_only',
      }],
      tasks: [
        makeTask({ id: 'task-current', title: 'Current proof lane', status: 'done', releaseIds: ['headless-mvp'], ...modeledScriptProof() }),
      ],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    await approveDesignSystem(app)
    await execFileP('git', ['commit', '--allow-empty', '-m', 'unpushed release proof'], { cwd: tmpDir })

    const res = await app.fetch(new Request(projectUrl('/api/project/release-readiness')))
    const body = await res.json() as any

    expect(body.statusCounts).toEqual({ done: 1 })
    expect(body.gitStory.ready).toBe(false)
    expect(body.gitStory.blockers).toHaveLength(1)
    expect(body.totals.gitStoryBlockingCount).toBe(1)
    expect(body.totals.blockingCount).toBe(1)
    expect(body.release).toMatchObject({
      id: 'headless-mvp',
      state: 'blocked',
    })
    expect(body.releaseBlockers).toEqual([
      expect.objectContaining({
        id: 'repository-followup:repo:0',
        title: 'Repository follow-up: main',
        label: expect.stringContaining('not pushed'),
      }),
    ])
    expect(body.ready).toBe(false)

    const projectRes = await app.fetch(new Request(projectUrl('/api/project')))
    const projectBody = await projectRes.json() as any
    expect(projectBody.startReadiness).toMatchObject({
      canStart: false,
      code: 'repository_followup_required',
      actionHref: '/release',
      count: 1,
    })
    expect(projectBody.startReadiness.message).toContain('repository follow-up')
    expect(projectBody.startReadiness.message).not.toContain('is complete')

    const [spineRes, threadRes] = await Promise.all([
      app.fetch(new Request(projectUrl('/api/project/spine'))),
      app.fetch(new Request(projectUrl('/api/project/thread'))),
    ])
    const spineBody = await spineRes.json() as any
    const threadBody = await threadRes.json() as any
    const releaseBlockerIds = body.releaseBlockers.map((blocker: any) => blocker.id)

    expect(projectBody.orientationSpine.release.blockers.map((blocker: any) => blocker.id)).toEqual(releaseBlockerIds)
    expect(spineBody.spine.release.blockers.map((blocker: any) => blocker.id)).toEqual(releaseBlockerIds)
    expect(threadBody.orientationSpine.release.blockers.map((blocker: any) => blocker.id)).toEqual(releaseBlockerIds)
  })

  it('does not let recorded proof and an old merge record hide dirty proof-recovery worktree changes', async () => {
    const taskWorktreePath = path.join(tmpDir, '..', `${path.basename(tmpDir)}-dirty-proof-worktree`)
    await execFileP('git', ['worktree', 'add', '-b', 'guildhall/task-dirty-proof', taskWorktreePath], { cwd: tmpDir })
    await fs.writeFile(path.join(taskWorktreePath, 'PROOF.md'), 'new proof still needs landing\n', 'utf8')

    await seedQueue({
      version: 1,
      lastUpdated: new Date().toISOString(),
      selectedReleaseId: 'headless-mvp',
      releases: [{
        id: 'headless-mvp',
        label: 'Headless MVP',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        nodeIds: ['work:task-current'],
        deferredNodeIds: [],
        proofStyle: 'script_only',
      }],
      tasks: [
        makeTask({
          id: 'task-current',
          title: 'Current proof recovery lane',
          status: 'blocked',
          releaseIds: ['headless-mvp'],
          worktreePath: taskWorktreePath,
          blockReason: 'max_revisions_exceeded: reviewer asked for proof execution.',
          proofRecovery: {
            reopenedAt: '2026-07-07T08:00:00.000Z',
            reason: 'Run the real provider proof and attach the evidence.',
          },
          doneSummaryBundle: {
            taskId: 'task-current',
            status: 'done',
            completedAt: '2026-07-06T20:00:00.000Z',
            summary: {
              journey: 'Worker attempted to prove provider drafting.',
              decision: 'Task did not finish; proof recovery is blocked.',
              evidence: 'npm-run-build passed.',
              learningCandidates: [],
              openResidue: 'Run the real provider proof and attach the evidence.',
            },
            retention: {
              transcriptPrimaryArtifact: false,
              compactedFullTranscript: false,
              fullEvidenceAvailable: true,
            },
            evidenceRefs: [],
            createdAt: '2026-07-06T20:00:00.000Z',
            createdBy: 'orchestrator',
          },
          gateResults: [{
            gateId: 'npm-run-build',
            type: 'hard',
            passed: true,
            output: 'build passed',
            checkedAt: '2026-07-06T20:00:00.000Z',
          }],
          mergeRecord: {
            result: 'merged',
            fromBranch: 'guildhall/task-dirty-proof',
            toBranch: 'main',
            strategy: 'ff_only_local',
            mergedAt: '2026-07-06T20:01:00.000Z',
          },
        } as Partial<Task>),
      ],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    await approveDesignSystem(app)

    const res = await app.fetch(new Request(projectUrl('/api/project/release-readiness')))
    const body = await res.json() as any

    expect(body.gitStory.ready).toBe(false)
    expect(body.gitStory.blockers).toEqual([
      expect.objectContaining({
        taskId: 'task-current',
        state: 'dirty_uncommitted',
        reason: '1 changed file is not committed.',
      }),
    ])
    expect(body.gitStory.snapshots.find((snapshot: any) => snapshot.taskId === 'task-current')).toMatchObject({
      state: 'dirty_uncommitted',
      mergeRecordResult: 'merged',
      changedCount: 0,
      untrackedCount: 1,
      samplePaths: ['PROOF.md'],
    })
    expect(body.totals.gitStoryBlockingCount).toBe(1)
    expect(body.ready).toBe(false)

    const projectRes = await app.fetch(new Request(projectUrl('/api/project?surface=overview')))
    const projectBody = await projectRes.json() as any
    expect(projectBody.startReadiness).toMatchObject({
      canStart: false,
      code: 'repository_followup_required',
      message: '"Current proof recovery lane" cannot resume until repository follow-up is finished: 1 changed file is not committed.',
      actionHref: '/release',
      focusTaskId: 'task-current',
      focusTaskTitle: 'Current proof recovery lane',
      focusKind: 'repository_followup',
      count: 1,
    })

    await execFileP('git', ['worktree', 'remove', '--force', taskWorktreePath], { cwd: tmpDir })
  })

  it('does not let an old merge record hide a clean proof-recovery branch without an upstream', async () => {
    const taskWorktreePath = path.join(tmpDir, '..', `${path.basename(tmpDir)}-clean-local-proof-worktree`)
    await execFileP('git', ['worktree', 'add', '-b', 'guildhall/task-clean-local-proof', taskWorktreePath], { cwd: tmpDir })
    await fs.writeFile(path.join(taskWorktreePath, 'PROOF.md'), 'proof harness committed but provider proof still needs a credential\n', 'utf8')
    await execFileP('git', ['add', 'PROOF.md'], { cwd: taskWorktreePath })
    await execFileP('git', ['commit', '-m', 'add proof harness'], { cwd: taskWorktreePath })

    await seedQueue({
      version: 1,
      lastUpdated: new Date().toISOString(),
      selectedReleaseId: 'headless-mvp',
      releases: [{
        id: 'headless-mvp',
        label: 'Headless MVP',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        nodeIds: ['work:task-current'],
        deferredNodeIds: [],
        proofStyle: 'script_only',
      }],
      tasks: [
        makeTask({
          id: 'task-current',
          title: 'Current proof recovery lane',
          status: 'blocked',
          releaseIds: ['headless-mvp'],
          worktreePath: taskWorktreePath,
          blockReason: 'provider_missing: DEEPINFRA_API_TOKEN is required.',
          proofRecovery: {
            reopenedAt: '2026-07-07T09:45:00.000Z',
            reason: 'Run the real provider proof and attach the evidence.',
          },
          mergeRecord: {
            result: 'merged',
            fromBranch: 'guildhall/task-clean-local-proof',
            toBranch: 'main',
            strategy: 'ff_only_local',
            mergedAt: '2026-07-06T20:01:00.000Z',
          },
        } as Partial<Task>),
      ],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    await approveDesignSystem(app)

    const res = await app.fetch(new Request(projectUrl('/api/project/release-readiness')))
    const body = await res.json() as any

    expect(body.gitStory.blockers).toEqual([
      expect.objectContaining({
        taskId: 'task-current',
        state: 'no_upstream',
        reason: 'guildhall/task-clean-local-proof has no upstream branch, so Guildhall cannot compare or publish this work yet.',
      }),
    ])
    expect(body.gitStory.snapshots.find((snapshot: any) => snapshot.taskId === 'task-current')).toMatchObject({
      state: 'no_upstream',
      mergeRecordResult: 'merged',
      changedCount: 0,
      untrackedCount: 0,
      branch: 'guildhall/task-clean-local-proof',
    })

    const projectRes = await app.fetch(new Request(projectUrl('/api/project?surface=overview')))
    const projectBody = await projectRes.json() as any
    expect(projectBody.startReadiness).toMatchObject({
      canStart: false,
      code: 'repository_followup_required',
      message: '"Current proof recovery lane" cannot resume until repository follow-up is finished: guildhall/task-clean-local-proof has no upstream branch, so Guildhall cannot compare or publish this work yet.',
      actionHref: '/release',
      focusTaskId: 'task-current',
      focusTaskTitle: 'Current proof recovery lane',
      focusKind: 'repository_followup',
      count: 1,
    })

    await execFileP('git', ['worktree', 'remove', '--force', taskWorktreePath], { cwd: tmpDir })
  })

  it('reconciles a blocked proof-recovery branch after its local commit lands in project history', async () => {
    const taskWorktreePath = path.join(tmpDir, '..', `${path.basename(tmpDir)}-landed-proof-worktree`)
    await execFileP('git', ['worktree', 'add', '-b', 'guildhall/task-landed-proof', taskWorktreePath], { cwd: tmpDir })
    await fs.writeFile(path.join(taskWorktreePath, 'PROOF.md'), 'proof harness committed but provider proof still needs a credential\n', 'utf8')
    await execFileP('git', ['add', 'PROOF.md'], { cwd: taskWorktreePath })
    await execFileP('git', ['commit', '-m', 'add proof harness'], { cwd: taskWorktreePath })
    await execFileP('git', ['merge', '--no-ff', 'guildhall/task-landed-proof', '-m', 'land proof harness'], { cwd: tmpDir })

    await seedQueue({
      version: 1,
      lastUpdated: new Date().toISOString(),
      selectedReleaseId: 'headless-mvp',
      releases: [{
        id: 'headless-mvp',
        label: 'Headless MVP',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        nodeIds: ['work:task-current'],
        deferredNodeIds: [],
        proofStyle: 'script_only',
      }],
      tasks: [
        makeTask({
          id: 'task-current',
          title: 'Current proof recovery lane',
          status: 'blocked',
          releaseIds: ['headless-mvp'],
          worktreePath: taskWorktreePath,
          blockReason: 'max_revisions_exceeded: reviewer loop hit its old cap before proof recovery reopened.',
          proofRecovery: {
            reopenedAt: '2026-07-07T09:50:00.000Z',
            reason: 'provider_missing: DEEPINFRA_API_TOKEN is required.',
          },
          mergeRecord: {
            result: 'merged',
            fromBranch: 'guildhall/task-landed-proof',
            toBranch: 'main',
            strategy: 'ff_only_local',
            mergedAt: '2026-07-06T20:01:00.000Z',
          },
        } as Partial<Task>),
      ],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    await approveDesignSystem(app)

    const res = await app.fetch(new Request(projectUrl('/api/project/release-readiness')))
    const body = await res.json() as any

    expect(body.gitStory.blockers).toEqual([
      expect.objectContaining({
        id: 'repo:0',
        state: 'committed_local',
        reason: 'main has 2 local commits not pushed to origin/main.',
      }),
    ])
    expect(body.gitStory.snapshots.find((snapshot: any) => snapshot.taskId === 'task-current')).toMatchObject({
      state: 'merged',
      mergeRecordResult: 'reconciled',
      branch: 'guildhall/task-landed-proof',
      reason: 'Task worktree HEAD is already contained in the project repository history.',
    })

    const projectRes = await app.fetch(new Request(projectUrl('/api/project?surface=overview')))
    const projectBody = await projectRes.json() as any
    expect(projectBody.startReadiness).toMatchObject({
      canStart: false,
      code: 'no_unattended_progress',
      message: '"Current proof recovery lane" is blocked before unattended work can run: provider_missing: DEEPINFRA_API_TOKEN is required.',
      actionHref: '/work?task=task-current',
      focusTaskId: 'task-current',
      focusTaskTitle: 'Current proof recovery lane',
      focusKind: 'blocked_work',
      count: 1,
    })
    expect(body.openEscalations).toEqual([])
    expect(body.blockedByAgent).toEqual([
      expect.objectContaining({
        id: 'task-current',
        reason: 'provider_missing: DEEPINFRA_API_TOKEN is required.',
      }),
    ])
    expect(body.releaseBlockers).toEqual([
      expect.objectContaining({
        id: 'task-current',
        label: 'Current proof recovery lane: provider_missing: DEEPINFRA_API_TOKEN is required.',
      }),
      expect.objectContaining({
        id: 'repository-followup:repo:0',
        title: 'Repository follow-up: main',
        label: 'main has 2 local commits not pushed to origin/main.',
      }),
    ])

    await execFileP('git', ['worktree', 'remove', '--force', taskWorktreePath], { cwd: tmpDir })
  })

  it('reconciles skipped task merge records when the task worktree commit is already in project history', async () => {
    const taskWorktreePath = path.join(tmpDir, '..', `${path.basename(tmpDir)}-skipped-merge-worktree`)
    await execFileP('git', ['worktree', 'add', '-b', 'guildhall/task-skipped-merge', taskWorktreePath], { cwd: tmpDir })
    await fs.writeFile(path.join(taskWorktreePath, 'PROOF.md'), 'task proof landed\n', 'utf8')
    await execFileP('git', ['add', 'PROOF.md'], { cwd: taskWorktreePath })
    await execFileP('git', ['commit', '-m', 'add task proof'], { cwd: taskWorktreePath })
    await execFileP('git', ['merge', '--no-ff', 'guildhall/task-skipped-merge', '-m', 'land skipped task proof'], { cwd: tmpDir })
    await execFileP('git', ['push'], { cwd: tmpDir })

    await seedQueue({
      version: 1,
      lastUpdated: new Date().toISOString(),
      selectedReleaseId: 'headless-mvp',
      releases: [{
        id: 'headless-mvp',
        label: 'Headless MVP',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        nodeIds: ['work:task-current'],
        deferredNodeIds: [],
        proofStyle: 'script_only',
      }],
      tasks: [
        makeTask({
          id: 'task-current',
          title: 'Current proof lane',
          status: 'done',
          releaseIds: ['headless-mvp'],
          ...modeledScriptProof(),
          worktreePath: taskWorktreePath,
          mergeRecord: {
            result: 'skipped',
            toBranch: 'main',
            detail: 'Legacy task completed before automatic merge record capture.',
          },
        } as Partial<Task>),
      ],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    await approveDesignSystem(app)

    const res = await app.fetch(new Request(projectUrl('/api/project/release-readiness')))
    const body = await res.json() as any

    expect(body.ready).toBe(true)
    expect(body.totals.gitStoryBlockingCount).toBe(0)
    expect(body.gitStory.blockers).toEqual([])
    expect(body.gitStory.snapshots.find((snapshot: any) => snapshot.taskId === 'task-current')).toMatchObject({
      state: 'merged',
      mergeRecordResult: 'reconciled',
      reason: 'Task worktree HEAD is already contained in the project repository history.',
    })

    await execFileP('git', ['worktree', 'remove', '--force', taskWorktreePath], { cwd: tmpDir })
  })

  it('blocks release readiness on proof-missing completed work without counting reserved import scaffolding', async () => {
    const missingProofPath = {
      path: 'artifacts/fixture-run.md',
      expectedEvidence: [{ id: 'fixture-run', required: true }],
      verificationRecords: [],
    }
    await seedQueue({
      version: 1,
      lastUpdated: new Date().toISOString(),
      selectedReleaseId: 'headless-mvp',
      releases: [{
        id: 'headless-mvp',
        label: 'Headless MVP',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        nodeIds: ['work:task-workspace-import', 'work:task-current'],
        deferredNodeIds: [],
        proofStyle: 'script_only',
      }],
      tasks: [
        makeTask({
          id: 'task-workspace-import',
          title: 'Import project notes and plans',
          status: 'done',
          releaseIds: ['headless-mvp'],
          proofPaths: [missingProofPath],
        } as Partial<Task>),
        makeTask({
          id: 'task-current',
          title: 'Run fixture evaluator proof',
          status: 'done',
          releaseIds: ['headless-mvp'],
          proofPaths: [missingProofPath],
        } as Partial<Task>),
      ],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    await approveDesignSystem(app)
    await commitAndPush('proof missing release readiness')

    const readinessRes = await app.fetch(new Request(projectUrl('/api/project/release-readiness')))
    const readiness = await readinessRes.json() as any

    expect(readiness.ready).toBe(false)
    expect(readiness.totals).toMatchObject({
      tasks: 1,
      done: 1,
      blockingCount: 1,
      proofEvidenceBlockingCount: 1,
    })
    expect(readiness.proofMissingDoneTasks).toEqual([{ id: 'task-current', title: 'Run fixture evaluator proof' }])

    const projectRes = await app.fetch(new Request(projectUrl('/api/project')))
    const project = await projectRes.json() as any
    expect(project.startReadiness).toMatchObject({
      canStart: false,
      code: 'proof_evidence_missing',
      focusTaskId: 'task-current',
      count: 1,
    })
  })

  it('prioritizes blocked release work over duplicate completed proof rows in start readiness', async () => {
    const proofPath = {
      title: 'DeepInfra drafting proof command',
      launchSteps: [{ id: 'deepinfra-model-proof', title: 'Run DeepInfra model proof', kind: 'copy_command', command: 'pnpm nh:prove:deepinfra' }],
      expectedEvidence: [
        'DeepInfra drafting telemetry recorded refusal behavior, cost, latency, and voice preservation.',
      ],
    }
    await seedQueue({
      version: 1,
      lastUpdated: new Date().toISOString(),
      selectedReleaseId: 'headless-mvp',
      releases: [{
        id: 'headless-mvp',
        label: 'Headless MVP',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        nodeIds: ['work:task-blocked-proof', 'work:task-duplicate-proof'],
        deferredNodeIds: [],
        proofStyle: 'script_only',
      }],
      tasks: [
        makeTask({
          id: 'task-blocked-proof',
          title: 'Select and prove a DeepInfra drafting model for broad-genre and legal adult fiction chapter writing',
          status: 'blocked',
          releaseIds: ['near-term-proof-scope', 'headless-mvp'],
          blockReason: 'max_revisions_exceeded: Worker hit its turn budget while creating proof.',
          proofPaths: [proofPath],
          doneSummaryBundle: {
            taskId: 'task-blocked-proof',
            status: 'done',
            completedAt: '2026-07-06T20:00:00.000Z',
            summary: {
              journey: 'Worker attempted to prove provider drafting.',
              decision: 'Task did not finish; proof recovery is blocked.',
              evidence: 'content.no-truncated-data passed.',
              learningCandidates: [],
              openResidue: 'Worker hit its turn budget while creating proof.',
            },
            retention: {
              transcriptPrimaryArtifact: false,
              compactedFullTranscript: false,
              fullEvidenceAvailable: true,
            },
            evidenceRefs: [],
            createdAt: '2026-07-06T20:00:00.000Z',
            createdBy: 'orchestrator',
          },
          gateResults: [{
            gateId: 'content.no-truncated-data',
            type: 'hard',
            passed: true,
            output: 'no truncated content',
            checkedAt: '2026-07-06T20:00:00.000Z',
          }],
          reviewVerdicts: [{
            verdict: 'approve',
            reviewerPath: 'llm',
            reason: 'LLM reviewer approved',
            reasoning: 'All acceptance criteria are met.',
            failingSignals: [],
            recordedAt: '2026-07-06T20:00:00.000Z',
          }],
          escalations: [{
            id: 'esc-1',
            taskId: 'task-blocked-proof',
            agentId: 'coordinator',
            reason: 'max_revisions_exceeded',
            summary: 'Worker hit its turn budget while creating proof.',
            raisedAt: '2026-07-06T20:10:00.000Z',
          }],
        } as Partial<Task>),
        makeTask({
          id: 'task-duplicate-proof',
          title: 'Select and prove a DeepInfra drafting model for broad-genre chapter writing',
          status: 'done',
          releaseIds: [],
          proofPaths: [proofPath],
        } as Partial<Task>),
      ],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    await approveDesignSystem(app)
    await commitAndPush('blocked proof recovery start readiness')

    const projectRes = await app.fetch(new Request(projectUrl('/api/project')))
    expect(projectRes.status).toBe(200)
    const project = await projectRes.json() as any
    expect(project.startReadiness).toMatchObject({
      canStart: false,
      code: 'no_unattended_progress',
      focusTaskId: 'task-blocked-proof',
      focusKind: 'blocked_work',
    })
    expect(project.startReadiness?.message).toContain('Worker hit its turn budget')

    const readinessRes = await app.fetch(new Request(projectUrl('/api/project/release-readiness')))
    const readiness = await readinessRes.json() as any
    expect(readiness.openEscalations.map((item: any) => item.taskId)).toEqual(['task-blocked-proof'])
    expect(readiness.proofMissingDoneTasks).toEqual([])
    expect(readiness.releaseBlockers.map((blocker: any) => blocker.id)).toContain('task-blocked-proof')
  })

  it('accepts recorded completion proof even when imported proof paths lack inline verification records', async () => {
    const importedProofPath = {
      kind: 'review',
      source: 'inferred',
      expectedEvidence: ['npm-run-build passed.'],
    }
    await seedQueue({
      version: 1,
      lastUpdated: new Date().toISOString(),
      selectedReleaseId: 'headless-mvp',
      releases: [{
        id: 'headless-mvp',
        label: 'Headless MVP',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        nodeIds: ['work:task-current'],
        deferredNodeIds: [],
        proofStyle: 'script_only',
      }],
      tasks: [
        makeTask({
          id: 'task-current',
          title: 'Run fixture evaluator proof',
          status: 'done',
          releaseIds: ['headless-mvp'],
          completedAt: '2026-07-04T08:50:00.000Z',
          proofPaths: [importedProofPath],
          doneSummaryBundle: {
            taskId: 'task-current',
            status: 'done',
            completedAt: '2026-07-04T08:50:00.000Z',
            summary: {
              journey: 'Worker completed the proof.',
              decision: 'Task finished as done.',
              evidence: 'npm-run-build passed.',
              learningCandidates: [],
              openResidue: 'No open residue recorded.',
            },
            retention: {
              transcriptPrimaryArtifact: false,
              compactedFullTranscript: false,
              fullEvidenceAvailable: true,
            },
            evidenceRefs: [],
            createdAt: '2026-07-04T08:50:00.000Z',
            createdBy: 'orchestrator',
          },
          gateResults: [{
            gateId: 'npm-run-build',
            type: 'hard',
            passed: true,
            output: 'build passed',
            checkedAt: '2026-07-04T08:50:00.000Z',
          }],
          reviewVerdicts: [{
            verdict: 'approve',
            reviewerPath: 'llm',
            reason: 'LLM reviewer approved',
            reasoning: 'All acceptance criteria are met.',
            failingSignals: [],
            recordedAt: '2026-07-04T08:50:00.000Z',
          }],
        } as Partial<Task>),
      ],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    await approveDesignSystem(app)
    await commitAndPush('recorded completion proof release readiness')

    const readinessRes = await app.fetch(new Request(projectUrl('/api/project/release-readiness')))
    const readiness = await readinessRes.json() as any

    expect(readiness.ready).toBe(true)
    expect(readiness.totals).toMatchObject({
      tasks: 1,
      done: 1,
      proofEvidenceBlockingCount: 0,
    })
    expect(readiness.proofMissingDoneTasks).toEqual([])

    const projectRes = await app.fetch(new Request(projectUrl('/api/project')))
    const project = await projectRes.json() as any
    const task = project.tasks.find((candidate: any) => candidate.id === 'task-current')
    expect(task?.completionProof).toMatchObject({
      state: 'verified',
      expectedCount: 1,
      verifiedCount: expect.any(Number),
      latestAt: '2026-07-04T08:50:00.000Z',
    })
    expect(task.completionProof.verified.join('\n')).toContain('npm-run-build')
  })

  it('does not accept imported proof-path status without recorded task evidence', async () => {
    await seedQueue({
      version: 1,
      lastUpdated: new Date().toISOString(),
      selectedReleaseId: 'headless-mvp',
      releases: [{
        id: 'headless-mvp',
        label: 'Headless MVP',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        nodeIds: ['work:task-current'],
        deferredNodeIds: [],
        proofStyle: 'script_only',
      }],
      tasks: [
        makeTask({
          id: 'task-current',
          title: 'Prove world-state continuity review over elapsed-time object and property changes.',
          status: 'done',
          releaseIds: ['headless-mvp'],
          proofPaths: [{
            kind: 'review',
            source: 'inferred',
            status: 'verified',
            expectedEvidence: [
              'The reviewer catches object property changes caused by elapsed time.',
              'The proof explains whether wet hair would dry in the story climate.',
            ],
          }],
        } as Partial<Task>),
      ],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    await approveDesignSystem(app)
    await commitAndPush('imported proof-path status release readiness')

    const readinessRes = await app.fetch(new Request(projectUrl('/api/project/release-readiness')))
    const readiness = await readinessRes.json() as any

    expect(readiness.ready).toBe(false)
    expect(readiness.totals).toMatchObject({
      tasks: 1,
      done: 1,
      proofEvidenceBlockingCount: 1,
    })
    expect(readiness.proofMissingDoneTasks).toEqual([{
      id: 'task-current',
      title: 'Prove world-state continuity review over elapsed-time object and property changes.',
    }])

    const projectRes = await app.fetch(new Request(projectUrl('/api/project')))
    const project = await projectRes.json() as any
    expect(project.startReadiness).toMatchObject({
      canStart: false,
      code: 'proof_evidence_missing',
      actionHref: '/work?task=task-current',
      focusTaskId: 'task-current',
      focusKind: 'proof',
      proofTaskIds: ['task-current'],
    })
    expect(project.startReadiness?.message).toContain('Headless MVP')
    expect(project.startReadiness?.message).toContain('waiting on proof evidence')
    expect(project.orientationSpine?.summary?.progress).toMatchObject({
      done: 1,
      proven: 0,
    })
  })

  it('does not accept stale imported proof status plus truncation-only done evidence', async () => {
    await seedQueue({
      version: 1,
      lastUpdated: new Date().toISOString(),
      selectedReleaseId: 'headless-mvp',
      releases: [{
        id: 'headless-mvp',
        label: 'Headless MVP',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        nodeIds: ['work:task-current'],
        deferredNodeIds: [],
        proofStyle: 'script_only',
      }],
      tasks: [
        makeTask({
          id: 'task-current',
          title: 'Select and prove a DeepInfra drafting model for broad-genre chapter writing.',
          status: 'done',
          releaseIds: ['headless-mvp'],
          proofPaths: [{
            kind: 'review',
            source: 'inferred',
            status: 'verified',
            expectedEvidence: [
              'Select and prove a DeepInfra drafting model for broad-genre chapter writing has a bounded proof plan for harness.',
              'Select and prove a DeepInfra drafting model for broad-genre chapter writing reuses Stage 1.',
            ],
          }],
          doneSummaryBundle: {
            taskId: 'task-current',
            status: 'done',
            completedAt: '2026-07-06T11:56:59.195Z',
            summary: {
              journey: 'worker-agent recorded: The worker timed out before mutating a likely target file.',
              decision: 'Task finished as done.',
              evidence: 'content.no-truncated-data passed.',
              learningCandidates: [],
              openResidue: 'No open residue recorded.',
            },
            retention: {
              transcriptPrimaryArtifact: false,
              compactedFullTranscript: false,
              fullEvidenceAvailable: true,
            },
            evidenceRefs: [],
            createdAt: '2026-07-06T11:56:59.195Z',
            createdBy: 'orchestrator',
          },
          gateResults: [{
            gateId: 'content.no-truncated-data',
            type: 'soft',
            passed: true,
            output: 'no truncated semantic data detected',
            checkedAt: '2026-07-06T11:56:59.195Z',
          }],
          reviewVerdicts: [],
        } as Partial<Task>),
      ],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    await approveDesignSystem(app)
    await commitAndPush('stale imported proof status release readiness')

    const projectRes = await app.fetch(new Request(projectUrl('/api/project?surface=overview')))
    const project = await projectRes.json() as any

    expect(project.releaseReadiness).toMatchObject({
      ready: false,
      proofMissingDoneTasks: [{
        id: 'task-current',
        title: 'Select and prove a DeepInfra drafting model for broad-genre chapter writing.',
      }],
    })
    expect(project.startReadiness).toMatchObject({
      canStart: false,
      code: 'proof_evidence_missing',
      focusTaskId: 'task-current',
    })
    expect(project.tasks[0]?.completionProof).toMatchObject({
      state: 'missing',
      expectedCount: 1,
    })
  })

  it('does not show verified completion proof for unfinished overview work', async () => {
    await seedQueue({
      version: 1,
      lastUpdated: new Date().toISOString(),
      selectedReleaseId: 'headless-mvp',
      releases: [{
        id: 'headless-mvp',
        label: 'Headless MVP',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        nodeIds: ['work:task-ready-with-old-gates', 'work:task-ready-with-proof-plan'],
        deferredNodeIds: [],
        proofStyle: 'script_only',
      }],
      tasks: [
        makeTask({
          id: 'task-ready-with-old-gates',
          title: 'Mobile: test on real device',
          status: 'ready',
          releaseIds: ['headless-mvp'],
          gateResults: [{
            gateId: 'build',
            type: 'hard',
            passed: true,
            output: 'build passed before the task was reset to ready',
            checkedAt: '2026-05-16T20:30:00.000Z',
          }],
          reviewVerdicts: [{
            verdict: 'approve',
            reviewerPath: 'llm',
            reason: 'Old review approved',
            reasoning: 'This evidence is not completion proof for the current ready task.',
            failingSignals: [],
            recordedAt: '2026-05-16T20:30:00.000Z',
          }],
        } as Partial<Task>),
        makeTask({
          id: 'task-ready-with-proof-plan',
          title: 'Run the release proof script',
          status: 'ready',
          releaseIds: ['headless-mvp'],
          proofPaths: [{
            kind: 'command',
            command: 'pnpm test -- release-proof',
            expectedEvidence: ['release proof script passes'],
          }],
          gateResults: [{
            gateId: 'old-build',
            type: 'hard',
            passed: true,
            output: 'old build passed',
            checkedAt: '2026-05-16T20:30:00.000Z',
          }],
        } as Partial<Task>),
      ],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    await approveDesignSystem(app)
    await commitAndPush('ready task stale proof')

    const project = await (await app.fetch(new Request(projectUrl('/api/project?surface=overview')))).json() as any
    const staleGateTask = project.tasks.find((task: any) => task.id === 'task-ready-with-old-gates')
    const plannedProofTask = project.tasks.find((task: any) => task.id === 'task-ready-with-proof-plan')

    expect(staleGateTask?.completionProof).toBeUndefined()
    expect(plannedProofTask?.completionProof).toMatchObject({
      state: 'planned',
      expectedCount: 1,
      verifiedCount: 0,
    })
  })

  it('pins the start blocker over ready work in the overview preview', async () => {
    await seedQueue({
      version: 1,
      lastUpdated: new Date().toISOString(),
      selectedReleaseId: 'hardening',
      releases: [{
        id: 'hardening',
        label: 'Hardening',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        nodeIds: ['work:task-workspace-import', 'work:task-import-e2e', 'work:task-mobile'],
        deferredNodeIds: [],
        proofStyle: 'script_only',
      }],
      tasks: [
        makeTask({
          id: 'task-workspace-import',
          title: 'Import project notes and plans',
          domain: '_workspace_import',
          status: 'done',
          releaseIds: ['hardening'],
        } as Partial<Task>),
        makeTask({
          id: 'task-import-e2e',
          title: 'E2E tests: login -> create page -> edit -> search flow',
          status: 'import_draft',
          releaseIds: ['hardening'],
        } as Partial<Task>),
        makeTask({
          id: 'task-mobile',
          title: 'Mobile: test on real device',
          status: 'ready',
          releaseIds: ['hardening'],
        } as Partial<Task>),
      ],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    await approveDesignSystem(app)
    await commitAndPush('overview pin start blocker')

    const project = await (await app.fetch(new Request(projectUrl('/api/project?surface=overview')))).json() as any
    const work = await (await app.fetch(new Request(projectUrl('/api/project?surface=work')))).json() as any
    const map = await (await app.fetch(new Request(projectUrl('/api/project?surface=map')))).json() as any

    expect(project.startReadiness).toMatchObject({
      canStart: false,
      code: 'imported_scope_shaping',
      actionHref: '/task/task-import-e2e',
    })
    for (const body of [project, work, map]) {
      expect(body.orientationSpine?.summary?.topBlocker).toContain('E2E tests')
      expect(body.orientationSpine?.summary?.pinnedNow).toEqual([
        'E2E tests: login -> create page -> edit -> search flow',
      ])
    }
    for (const body of [project, map]) {
      expect(body.orientationSpine?.activePins?.[0]).toMatchObject({
        nodeId: 'work:task-import-e2e',
        kind: 'owner_input',
        label: 'E2E tests: login -> create page -> edit -> search flow',
      })
    }
  })

  it('uses documented release metadata in the overview preview when the map has source-backed scope', async () => {
    await seedQueue({
      version: 1,
      lastUpdated: new Date().toISOString(),
      selectedReleaseId: 'stage-1-headless-drafting-and-evaluation-mvp',
      releases: [{
        id: 'stage-1-headless-drafting-and-evaluation-mvp',
        label: 'Stage 1 Headless Drafting And Evaluation MVP',
        kind: 'release',
        state: 'ready',
        source: 'inferred',
        nodeIds: ['work:task-model-proof'],
        deferredNodeIds: [],
        proofStyle: 'unspecified',
      }],
      tasks: [
        makeTask({
          id: 'task-model-proof',
          title: 'Select and prove a DeepInfra drafting model for broad-genre and legal adult fiction chapter writing.',
          status: 'done',
          releaseIds: ['stage-1-headless-drafting-and-evaluation-mvp'],
          proofPaths: [{ kind: 'command', command: 'pnpm test', status: 'passed' }],
          references: ['docs/product/deepinfra-drafting-model-selection.md'],
        } as Partial<Task>),
      ],
    })
    await writeProjectStateJsonAsync(tmpDir, 'workspace-goals.json', {
      version: 3,
      recordedAt: new Date().toISOString(),
      goals: [],
      releases: [{
        id: 'stage-1-headless-drafting-and-evaluation-mvp',
        label: 'Stage 1: Headless Drafting And Evaluation MVP',
        source: 'release_plan',
      }],
      tasks: [],
      milestones: [],
      context: [{
        label: 'Stage 1 source',
        excerpt: 'Stage 1 is defined by the implementation roadmap.',
        domain: 'harness',
        source: 'docs/harness/implementation-roadmap.md',
        role: 'capability',
        scopeHint: 'current',
        releaseIds: ['stage-1-headless-drafting-and-evaluation-mvp'],
        references: ['docs/harness/implementation-roadmap.md'],
      }],
      approved: {
        goalCount: 0,
        taskCount: 0,
        milestoneCount: 1,
        currentTaskCount: 0,
        laterTaskCount: 0,
        taskIds: [],
        currentTaskIds: [],
        laterTaskIds: [],
      },
      detected: null,
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    await approveDesignSystem(app)
    await commitAndPush('overview source metadata')

    const overview = await (await app.fetch(new Request(projectUrl('/api/project?surface=overview')))).json() as any
    const map = await (await app.fetch(new Request(projectUrl('/api/project?surface=map')))).json() as any

    expect(map.orientationSpine?.scope).toMatchObject({
      label: 'Stage 1: Headless Drafting And Evaluation MVP',
      source: 'release_plan',
    })
    expect(overview.orientationSpine?.scope).toMatchObject({
      label: 'Stage 1: Headless Drafting And Evaluation MVP',
      source: 'release_plan',
    })
    expect(overview.orientationSpine?.sourceTrail?.find((row: any) => row.label === 'Scope')).toMatchObject({
      value: 'Release Plan',
      tone: 'ok',
    })
    expect(overview.startReadiness?.executionScope).toMatchObject({
      id: 'stage-1-headless-drafting-and-evaluation-mvp',
      label: 'Stage 1: Headless Drafting And Evaluation MVP',
      source: 'release_plan',
    })
  })

  it('uses fresh approved import scope instead of stale task release selection', async () => {
    await seedQueue({
      version: 1,
      lastUpdated: new Date().toISOString(),
      selectedReleaseId: 'stage-1-finish-primitive-wave',
      releases: [{
        id: 'stage-1-finish-primitive-wave',
        label: 'Stage 1: Finish Primitive Wave',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        nodeIds: ['work:task-block-menu'],
        deferredNodeIds: [],
      }],
      tasks: [
        makeTask({
          id: 'task-block-menu',
          title: 'Block menu / side menu',
          status: 'blocked',
          releaseIds: ['stage-1-finish-primitive-wave'],
        }),
      ],
    })
    await writeProjectStateJsonAsync(tmpDir, 'workspace-goals.json', {
      version: 3,
      recordedAt: new Date().toISOString(),
      goals: [],
      releases: [{
        id: 'stage-1-v1-release-hardening',
        label: 'Stage 1: V1 Release Hardening',
        source: 'release_plan',
      }],
      tasks: [
        {
          id: 'imported-toolbar',
          title: 'Floating toolbar',
          description: 'Current approved release work.',
          domain: 'editor',
          priority: 'high',
          references: ['docs/releases/v1-hardening.md'],
          releaseIds: ['stage-1-v1-release-hardening'],
          scope: 'current',
        },
      ],
      milestones: [],
      context: [],
      approved: {
        goalCount: 0,
        taskCount: 1,
        milestoneCount: 1,
        currentTaskCount: 1,
        laterTaskCount: 0,
        taskIds: ['imported-toolbar'],
        currentTaskIds: ['imported-toolbar'],
        laterTaskIds: [],
      },
      detected: null,
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    await approveDesignSystem(app)
    await commitAndPush('fresh approved import scope')

    const map = await (await app.fetch(new Request(projectUrl('/api/project?surface=map')))).json() as any
    const overview = await (await app.fetch(new Request(projectUrl('/api/project?surface=overview')))).json() as any
    const readiness = await (await app.fetch(new Request(projectUrl('/api/project/release-readiness')))).json() as any

    expect(map.orientationSpine?.summary?.selectedReleaseLabel).toBe('Stage 1: V1 Release Hardening')
    expect(map.orientationSpine?.scope).toMatchObject({
      id: 'stage-1-v1-release-hardening',
      label: 'Stage 1: V1 Release Hardening',
      source: 'release_plan',
    })
    expect(overview.orientationSpine?.summary?.selectedReleaseLabel).toBe('Stage 1: V1 Release Hardening')
    expect(overview.orientationSpine?.scope).toMatchObject({
      id: 'stage-1-v1-release-hardening',
      label: 'Stage 1: V1 Release Hardening',
      source: 'release_plan',
    })
    expect(overview.startReadiness?.executionScope).toMatchObject({
      id: 'stage-1-v1-release-hardening',
      label: 'Stage 1: V1 Release Hardening',
      source: 'release_plan',
      taskCount: 1,
    })
    expect(readiness.scope).toMatchObject({
      id: 'stage-1-v1-release-hardening',
      label: 'Stage 1: V1 Release Hardening',
      source: 'release_plan',
    })
    expect(readiness.release).toMatchObject({
      id: 'stage-1-v1-release-hardening',
      label: 'Stage 1: V1 Release Hardening',
      source: 'release_plan',
    })
    expect(readiness.statusCounts).toMatchObject({
      import_draft: 1,
    })
  })

  it('accepts review-backed imported proof hints when later completion evidence exists', async () => {
    await seedQueue({
      version: 1,
      lastUpdated: new Date().toISOString(),
      selectedReleaseId: 'headless-mvp',
      releases: [{
        id: 'headless-mvp',
        label: 'Headless MVP',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        nodeIds: ['work:task-current'],
        deferredNodeIds: [],
        proofStyle: 'script_only',
      }],
      tasks: [
        makeTask({
          id: 'task-current',
          title: 'Define fixture, expected-record, prototype-run, and evaluation schemas.',
          status: 'done',
          releaseIds: ['headless-mvp'],
          completedAt: '2026-07-04T08:50:00.000Z',
          proofPaths: [{
            kind: 'review',
            source: 'inferred',
            expectedEvidence: [
              'fixture directory shape for at least one small story fixture',
            ],
          }],
          doneSummaryBundle: {
            taskId: 'task-current',
            status: 'done',
            completedAt: '2026-07-04T08:50:00.000Z',
            summary: {
              journey: 'Worker completed the imported proof.',
              decision: 'Task finished as done.',
              evidence: 'npm-run-build passed.',
              learningCandidates: [],
              openResidue: 'No open residue recorded.',
            },
            retention: {
              transcriptPrimaryArtifact: false,
              compactedFullTranscript: false,
              fullEvidenceAvailable: true,
            },
            evidenceRefs: [],
            createdAt: '2026-07-04T08:50:00.000Z',
            createdBy: 'orchestrator',
          },
          gateResults: [{
            gateId: 'npm-run-build',
            type: 'hard',
            passed: true,
            output: 'build passed',
            checkedAt: '2026-07-04T08:50:00.000Z',
          }],
          reviewVerdicts: [{
            verdict: 'approve',
            reviewerPath: 'llm',
            reason: 'LLM reviewer approved',
            reasoning: 'The imported fixture/schema proof is complete. Proof path: yes.',
            failingSignals: [],
            recordedAt: '2026-07-04T08:50:00.000Z',
          }],
        } as Partial<Task>),
      ],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    await approveDesignSystem(app)
    await commitAndPush('review-backed imported proof release readiness')

    const readinessRes = await app.fetch(new Request(projectUrl('/api/project/release-readiness')))
    const readiness = await readinessRes.json() as any

    expect(readiness.ready).toBe(true)
    expect(readiness.totals).toMatchObject({
      tasks: 1,
      done: 1,
      proofEvidenceBlockingCount: 0,
    })
    expect(readiness.proofMissingDoneTasks).toEqual([])

    const projectRes = await app.fetch(new Request(projectUrl('/api/project')))
    const project = await projectRes.json() as any
    const task = project.tasks.find((candidate: any) => candidate.id === 'task-current')
    expect(task?.completionProof).toMatchObject({
      state: 'verified',
      expectedCount: 1,
      verifiedCount: expect.any(Number),
      latestAt: '2026-07-04T08:50:00.000Z',
    })
    expect(task.completionProof.verified.join('\n')).toContain('npm-run-build')
  })

  it('requires recorded proof before treating a completed selected-release task as release-ready', async () => {
    await seedQueue({
      version: 1,
      lastUpdated: new Date().toISOString(),
      selectedReleaseId: 'headless-mvp',
      releases: [{
        id: 'headless-mvp',
        label: 'Headless MVP',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        nodeIds: ['work:task-current'],
        deferredNodeIds: [],
        proofStyle: 'script_only',
      }],
      tasks: [
        makeTask({
          id: 'task-current',
          title: 'Generate the first chapter draft',
          status: 'done',
          releaseIds: ['headless-mvp'],
          acceptanceCriteria: [{
            id: 'chapter-draft-command',
            description: 'A pnpm command drafts one chapter from the selected model.',
            verifiedBy: 'automated',
            met: true,
          }],
          gateResults: [],
          reviewVerdicts: [],
          notes: [],
        } as Partial<Task>),
      ],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    await approveDesignSystem(app)
    await commitAndPush('missing recorded proof release readiness')

    const readinessRes = await app.fetch(new Request(projectUrl('/api/project/release-readiness')))
    const readiness = await readinessRes.json() as any

    expect(readiness.ready).toBe(false)
    expect(readiness.totals).toMatchObject({
      tasks: 1,
      done: 1,
      proofEvidenceBlockingCount: 1,
    })
    expect(readiness.proofMissingDoneTasks).toEqual([{ id: 'task-current', title: 'Generate the first chapter draft' }])

    const projectRes = await app.fetch(new Request(projectUrl('/api/project')))
    const project = await projectRes.json() as any
    expect(project.startReadiness).toMatchObject({
      canStart: false,
      code: 'proof_evidence_missing',
      focusTaskId: 'task-current',
    })
    expect(project.actionModel?.runControl).toMatchObject({
      label: 'Resume',
      startEnabled: true,
    })
  })

  it('does not accept unrelated completion proof for a command-backed completed task', async () => {
    await seedQueue({
      version: 1,
      lastUpdated: new Date().toISOString(),
      selectedReleaseId: 'headless-mvp',
      releases: [{
        id: 'headless-mvp',
        label: 'Headless MVP',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        nodeIds: ['work:task-current'],
        deferredNodeIds: [],
        proofStyle: 'script_only',
      }],
      tasks: [
        makeTask({
          id: 'task-current',
          title: 'Generate the first chapter draft',
          status: 'done',
          releaseIds: ['headless-mvp'],
          acceptanceCriteria: [{
            id: 'chapter-draft-command',
            description: 'A pnpm command drafts one chapter from the selected model.',
            verifiedBy: 'automated',
            command: 'pnpm test -- generate-first-chapter',
            met: true,
          }],
          proofPaths: [{
            kind: 'command',
            command: 'pnpm test -- generate-first-chapter',
            expectedEvidence: ['Chapter draft fixture is generated.'],
            source: 'inferred',
          }],
          doneSummaryBundle: {
            taskId: 'task-current',
            status: 'done',
            completedAt: '2026-07-04T08:50:00.000Z',
            summary: {
              journey: 'Worker touched the task.',
              decision: 'Task finished as done.',
              evidence: 'content.no-truncated-data passed.',
              learningCandidates: [],
              openResidue: 'No open residue recorded.',
            },
            retention: {
              transcriptPrimaryArtifact: false,
              compactedFullTranscript: false,
              fullEvidenceAvailable: true,
            },
            evidenceRefs: [],
            createdAt: '2026-07-04T08:50:00.000Z',
            createdBy: 'orchestrator',
          },
          gateResults: [{
            gateId: 'content.no-truncated-data',
            type: 'soft',
            passed: true,
            output: 'no truncated semantic data detected',
            checkedAt: '2026-07-04T08:50:00.000Z',
          }],
          reviewVerdicts: [{
            verdict: 'approve',
            reviewerPath: 'llm',
            reason: 'LLM reviewer approved',
            reasoning: 'All acceptance criteria are met.',
            failingSignals: [],
            recordedAt: '2026-07-04T08:50:00.000Z',
          }],
        } as Partial<Task>),
      ],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    await approveDesignSystem(app)
    await commitAndPush('unrelated recorded proof release readiness')

    const readinessRes = await app.fetch(new Request(projectUrl('/api/project/release-readiness')))
    const readiness = await readinessRes.json() as any

    expect(readiness.ready).toBe(false)
    expect(readiness.totals).toMatchObject({
      tasks: 1,
      done: 1,
      proofEvidenceBlockingCount: 1,
    })
    expect(readiness.proofMissingDoneTasks).toEqual([{ id: 'task-current', title: 'Generate the first chapter draft' }])

    const projectRes = await app.fetch(new Request(projectUrl('/api/project')))
    const project = await projectRes.json() as any
    expect(project.orientationSpine?.summary?.progress).toMatchObject({
      done: 1,
      proven: 0,
    })
  })

  it('does not accept generic build proof for a semantic review-backed completed task', async () => {
    await seedQueue({
      version: 1,
      lastUpdated: new Date().toISOString(),
      selectedReleaseId: 'headless-mvp',
      releases: [{
        id: 'headless-mvp',
        label: 'Headless MVP',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        nodeIds: ['work:task-current'],
        deferredNodeIds: [],
        proofStyle: 'script_only',
      }],
      tasks: [
        makeTask({
          id: 'task-current',
          title: 'Select and prove a DeepInfra drafting model',
          status: 'done',
          releaseIds: ['headless-mvp'],
          acceptanceCriteria: [{
            id: 'drafting-failure-telemetry',
            description: 'The proof records refusal behavior, repetition/runaway behavior, cost, latency, and whether output preserves author voice and genre constraints.',
            verifiedBy: 'review',
            met: true,
          }],
          proofPaths: [{
            kind: 'review',
            expectedEvidence: [
              'DeepInfra drafting telemetry recorded refusal behavior, cost, latency, and voice preservation.',
            ],
            source: 'inferred',
          }],
          doneSummaryBundle: {
            taskId: 'task-current',
            status: 'done',
            completedAt: '2026-07-04T08:50:00.000Z',
            summary: {
              journey: 'Worker added fixture records.',
              decision: 'Task finished as done.',
              evidence: 'npm-run-build passed.',
              learningCandidates: [],
              openResidue: 'No open residue recorded.',
            },
            retention: {
              transcriptPrimaryArtifact: false,
              compactedFullTranscript: false,
              fullEvidenceAvailable: true,
            },
            evidenceRefs: [],
            createdAt: '2026-07-04T08:50:00.000Z',
            createdBy: 'orchestrator',
          },
          gateResults: [{
            gateId: 'npm-run-build',
            type: 'hard',
            passed: true,
            output: 'build passed',
            checkedAt: '2026-07-04T08:50:00.000Z',
          }],
          reviewVerdicts: [{
            verdict: 'approve',
            reviewerPath: 'llm',
            reason: 'LLM reviewer approved',
            reasoning: 'All acceptance criteria are met.',
            failingSignals: [],
            recordedAt: '2026-07-04T08:50:00.000Z',
          }],
        } as Partial<Task>),
      ],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    await approveDesignSystem(app)
    await commitAndPush('generic build proof release readiness')

    const readinessRes = await app.fetch(new Request(projectUrl('/api/project/release-readiness')))
    const readiness = await readinessRes.json() as any

    expect(readiness.ready).toBe(false)
    expect(readiness.totals).toMatchObject({
      tasks: 1,
      done: 1,
      proofEvidenceBlockingCount: 1,
    })
    expect(readiness.proofMissingDoneTasks).toEqual([{ id: 'task-current', title: 'Select and prove a DeepInfra drafting model' }])

    const projectRes = await app.fetch(new Request(projectUrl('/api/project')))
    const project = await projectRes.json() as any
    expect(project.orientationSpine?.summary?.progress).toMatchObject({
      done: 1,
      proven: 0,
    })
  })

  it('does not accept script-only release completion without modeled proof paths', async () => {
    await seedQueue({
      version: 1,
      lastUpdated: new Date().toISOString(),
      selectedReleaseId: 'headless-mvp',
      releases: [{
        id: 'headless-mvp',
        label: 'Headless script-only MVP',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        nodeIds: ['work:task-current'],
        deferredNodeIds: [],
        proofStyle: 'script_only',
      }],
      tasks: [
        makeTask({
          id: 'task-current',
          title: 'Generate the first chapter draft',
          status: 'done',
          releaseIds: ['headless-mvp'],
          doneSummaryBundle: {
            taskId: 'task-current',
            status: 'done',
            completedAt: '2026-07-04T08:50:00.000Z',
            summary: {
              journey: 'Worker completed the task.',
              decision: 'Task finished as done.',
              evidence: 'pnpm-build passed.',
              learningCandidates: [],
              openResidue: 'No open residue recorded.',
            },
            retention: {
              transcriptPrimaryArtifact: false,
              compactedFullTranscript: false,
              fullEvidenceAvailable: true,
            },
            evidenceRefs: [],
            createdAt: '2026-07-04T08:50:00.000Z',
            createdBy: 'orchestrator',
          },
          gateResults: [{
            gateId: 'pnpm-build',
            type: 'hard',
            passed: true,
            output: 'build passed',
            checkedAt: '2026-07-04T08:50:00.000Z',
          }],
        } as Partial<Task>),
      ],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    await approveDesignSystem(app)
    await commitAndPush('script-only release without modeled proof paths')

    const readinessRes = await app.fetch(new Request(projectUrl('/api/project/release-readiness')))
    const readiness = await readinessRes.json() as any

    expect(readiness.ready).toBe(false)
    expect(readiness.totals).toMatchObject({
      tasks: 1,
      done: 1,
      proofEvidenceBlockingCount: 1,
    })
    expect(readiness.proofMissingDoneTasks).toEqual([{ id: 'task-current', title: 'Generate the first chapter draft' }])

    const projectRes = await app.fetch(new Request(projectUrl('/api/project')))
    const project = await projectRes.json() as any
    expect(project.orientationSpine?.summary?.progress).toMatchObject({
      done: 1,
      proven: 0,
    })
    expect(project.orientationSpine?.proofContracts[0]).toMatchObject({
      state: 'needed',
      missing: ['Script-only scope needs a command proof path for this completed task.'],
    })
  })

  it('does not accept inferred review proof as derived script-only release proof', async () => {
    await seedQueue({
      version: 1,
      lastUpdated: new Date().toISOString(),
      selectedReleaseId: 'headless-mvp',
      releases: [{
        id: 'headless-mvp',
        label: 'Headless script-only MVP',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        nodeIds: ['work:task-current'],
        deferredNodeIds: [],
        proofStyle: 'unspecified',
      }],
      tasks: [
        makeTask({
          id: 'task-current',
          title: 'Generate the first chapter draft',
          status: 'done',
          releaseIds: ['headless-mvp'],
          proofPaths: [{
            kind: 'review',
            source: 'inferred',
            expectedEvidence: ['The chapter draft is reviewed for continuity.'],
            status: 'verified',
          }],
          gateResults: [{
            gateId: 'content.no-truncated-data',
            type: 'hard',
            passed: true,
            output: 'content check passed',
            checkedAt: '2026-07-04T08:50:00.000Z',
          }],
        } as Partial<Task>),
      ],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    await approveDesignSystem(app)
    await commitAndPush('derived script-only release with review proof only')

    const readiness = await (await app.fetch(new Request(projectUrl('/api/project/release-readiness')))).json() as any

    expect(readiness.ready).toBe(false)
    expect(readiness.release).toMatchObject({ proofStyle: 'script_only' })
    expect(readiness.proofMissingDoneTasks).toEqual([{ id: 'task-current', title: 'Generate the first chapter draft' }])
    expect(readiness.totals.proofEvidenceBlockingCount).toBe(1)

    const project = await (await app.fetch(new Request(projectUrl('/api/project')))).json() as any
    expect(project.startReadiness).toMatchObject({
      canStart: false,
      code: 'proof_evidence_missing',
      focusTaskId: 'task-current',
      focusKind: 'proof',
      proofTaskIds: ['task-current'],
    })
    expect(project.orientationSpine?.proofContracts[0]).toMatchObject({
      state: 'needed',
    })
  })

  it('accepts semantically matching review proof for inferred Narrative Harness proof paths', async () => {
    await seedQueue({
      version: 1,
      lastUpdated: new Date().toISOString(),
      selectedReleaseId: 'headless-mvp',
      releases: [{
        id: 'headless-mvp',
        label: 'Headless MVP',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        nodeIds: ['work:task-current'],
        deferredNodeIds: [],
        proofStyle: 'script_only',
      }],
      tasks: [
        makeTask({
          id: 'task-current',
          title: 'Generate a CLI-first story synopsis, outline, character/voice records, and one chapter draft from the selected model',
          status: 'done',
          releaseIds: ['headless-mvp'],
          acceptanceCriteria: [
            {
              id: 'synopsis-to-outline-chain',
              description: 'The task can generate or load a synopsis, outline, character/voice records, and world-state facts before drafting.',
              verifiedBy: 'review',
              met: true,
            },
            {
              id: 'chapter-draft-command',
              description: 'A pnpm script or CLI command drafts one chapter from the selected model using the bounded context packet and review plan.',
              verifiedBy: 'review',
              met: true,
            },
            {
              id: 'author-voice-preservation',
              description: 'The draft proof records whether the chapter follows the requested author voice, genre, audience, and character voices.',
              verifiedBy: 'review',
              met: true,
            },
          ],
          proofPaths: [{
            kind: 'review',
            source: 'inferred',
            expectedEvidence: [
              'The task can generate or load a synopsis, outline, character/voice records, and world-state facts before drafting.',
              'A pnpm script or CLI command drafts one chapter from the selected model using the bounded context packet and review plan.',
              'The draft proof records whether the chapter follows the requested author voice, genre, audience, and character voices.',
            ],
          }],
          doneSummaryBundle: {
            taskId: 'task-current',
            status: 'done',
            completedAt: '2026-07-04T08:50:00.000Z',
            summary: {
              journey: 'Worker completed the chapter generation proof.',
              decision: 'Task finished as done.',
              evidence: 'pnpm build passed and tests/generate.test.mjs passed.',
              learningCandidates: [],
              openResidue: 'No open residue recorded.',
            },
            retention: {
              transcriptPrimaryArtifact: false,
              compactedFullTranscript: false,
              fullEvidenceAvailable: true,
            },
            evidenceRefs: [],
            createdAt: '2026-07-04T08:50:00.000Z',
            createdBy: 'orchestrator',
          },
          gateResults: [{
            gateId: 'pnpm-build',
            type: 'hard',
            passed: true,
            output: 'pnpm build passed',
            checkedAt: '2026-07-04T08:50:00.000Z',
          }],
          reviewVerdicts: [{
            verdict: 'approve',
            reviewerPath: 'llm',
            reason: 'LLM reviewer approved',
            reasoning: [
              'The CLI tool generates a valid story output JSON containing synopsis, outline, character/voice records, world-state facts, and a chapter draft.',
              'The generate:story pnpm script invokes src/cli/generate.ts and drafts one chapter from the selected model using the bounded context packet and review plan.',
              'Regression test tests/generate.test.mjs verifies that the generated chapter follows the requested author voice, genre, audience, and character voices.',
            ].join('\n'),
            failingSignals: [],
            recordedAt: '2026-07-04T08:50:00.000Z',
          }],
        } as Partial<Task>),
      ],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    await approveDesignSystem(app)
    await commitAndPush('semantic review proof release readiness')

    const readinessRes = await app.fetch(new Request(projectUrl('/api/project/release-readiness')))
    const readiness = await readinessRes.json() as any

    expect(readiness.ready).toBe(true)
    expect(readiness.totals).toMatchObject({
      tasks: 1,
      done: 1,
      proofEvidenceBlockingCount: 0,
    })
    expect(readiness.proofMissingDoneTasks).toEqual([])

    const projectRes = await app.fetch(new Request(projectUrl('/api/project')))
    const project = await projectRes.json() as any
    const task = project.tasks.find((candidate: any) => candidate.id === 'task-current')
    expect(task?.completionProof).toMatchObject({
      state: 'verified',
      expectedCount: 1,
      verifiedCount: expect.any(Number),
      latestAt: '2026-07-04T08:50:00.000Z',
    })
    expect(task.completionProof.verified.join('\n')).toContain('tests/generate.test.mjs')
  })

  it('accepts command-backed review proof paths for headless drafting script-only scopes', async () => {
    await seedQueue({
      version: 1,
      lastUpdated: new Date().toISOString(),
      selectedReleaseId: 'headless-drafting',
      releases: [{
        id: 'headless-drafting',
        label: 'Stage 1: Headless Drafting MVP',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        nodeIds: ['work:task-current'],
        deferredNodeIds: [],
        proofStyle: 'script_only',
      }],
      tasks: [
        makeTask({
          id: 'task-current',
          title: 'Generate a CLI-first story draft',
          status: 'done',
          releaseIds: ['headless-drafting'],
          proofPaths: [{
            kind: 'review',
            source: 'inferred',
            expectedEvidence: [
              'A pnpm script or CLI command drafts one chapter from the selected model using the bounded context packet and review plan.',
            ],
          }],
          doneSummaryBundle: {
            taskId: 'task-current',
            status: 'done',
            completedAt: '2026-07-04T08:50:00.000Z',
            summary: {
              journey: 'Worker completed the chapter generation proof.',
              decision: 'Task finished as done.',
              evidence: 'pnpm build passed and tests/generate.test.mjs passed.',
              learningCandidates: [],
              openResidue: 'No open residue recorded.',
            },
            retention: {
              transcriptPrimaryArtifact: false,
              compactedFullTranscript: false,
              fullEvidenceAvailable: true,
            },
            evidenceRefs: [],
            createdAt: '2026-07-04T08:50:00.000Z',
            createdBy: 'orchestrator',
          },
          gateResults: [{
            gateId: 'pnpm-build',
            type: 'hard',
            passed: true,
            output: 'pnpm build passed',
            checkedAt: '2026-07-04T08:50:00.000Z',
          }],
          reviewVerdicts: [{
            verdict: 'approve',
            reviewerPath: 'llm',
            reason: 'LLM reviewer approved',
            reasoning: 'The generate:story pnpm script invokes src/cli/generate.ts and drafts one chapter from the selected model using the bounded context packet and review plan.',
            failingSignals: [],
            recordedAt: '2026-07-04T08:50:00.000Z',
          }],
        } as Partial<Task>),
      ],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    await approveDesignSystem(app)
    await commitAndPush('headless drafting command-backed proof')

    const readiness = await (await app.fetch(new Request(projectUrl('/api/project/release-readiness')))).json() as any

    expect(readiness.ready).toBe(true)
    expect(readiness.proofMissingDoneTasks).toEqual([])
    expect(readiness.totals.proofEvidenceBlockingCount).toBe(0)
  })

  it('does not accept review prose alone for provider/model proof paths', async () => {
    await seedQueue({
      version: 1,
      lastUpdated: new Date().toISOString(),
      selectedReleaseId: 'headless-mvp',
      releases: [{
        id: 'headless-mvp',
        label: 'Headless MVP',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        nodeIds: ['work:task-current'],
        deferredNodeIds: [],
        proofStyle: 'script_only',
      }],
      tasks: [
        makeTask({
          id: 'task-current',
          title: 'Select and prove a DeepInfra drafting model for broad-genre chapter writing',
          status: 'done',
          releaseIds: ['headless-mvp'],
          acceptanceCriteria: [{
            id: 'provider-proof',
            description: 'The proof records DeepInfra model telemetry, latency, cost, refusal, repetition, and voice preservation from an executed scenario run.',
            verifiedBy: 'review',
            met: true,
          }],
          proofPaths: [{
            kind: 'review',
            source: 'inferred',
            expectedEvidence: [
              'The proof records DeepInfra model telemetry, latency, cost, refusal, repetition, and voice preservation from an executed scenario run.',
            ],
          }],
          doneSummaryBundle: {
            taskId: 'task-current',
            status: 'done',
            completedAt: '2026-07-04T08:50:00.000Z',
            summary: {
              journey: 'Reviewer prose claimed the DeepInfra proof exists.',
              decision: 'Task finished as done.',
              evidence: 'content.no-truncated-data passed.',
              learningCandidates: [],
              openResidue: 'No open residue recorded.',
            },
            retention: {
              transcriptPrimaryArtifact: false,
              compactedFullTranscript: false,
              fullEvidenceAvailable: true,
            },
            evidenceRefs: [],
            createdAt: '2026-07-04T08:50:00.000Z',
            createdBy: 'orchestrator',
          },
          gateResults: [{
            gateId: 'content.no-truncated-data',
            type: 'soft',
            passed: true,
            output: 'no truncated semantic data detected',
            checkedAt: '2026-07-04T08:50:00.000Z',
          }],
          reviewVerdicts: [{
            verdict: 'approve',
            reviewerPath: 'deterministic',
            reason: 'Coordinator adjudication scope satisfied by latest worker proof.',
            reasoning: 'The proof records DeepInfra model telemetry, latency, cost, refusal, repetition, and voice preservation from an executed scenario run.',
            failingSignals: [],
            recordedAt: '2026-07-04T08:50:00.000Z',
          }],
        } as Partial<Task>),
      ],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    await approveDesignSystem(app)
    await commitAndPush('provider review prose without command proof')

    const readinessRes = await app.fetch(new Request(projectUrl('/api/project/release-readiness')))
    const readiness = await readinessRes.json() as any

    expect(readiness.ready).toBe(false)
    expect(readiness.totals).toMatchObject({
      tasks: 1,
      done: 1,
      proofEvidenceBlockingCount: 1,
    })
    expect(readiness.proofMissingDoneTasks).toEqual([{
      id: 'task-current',
      title: 'Select and prove a DeepInfra drafting model for broad-genre chapter writing',
    }])
  })

  it('does not accept truncation-only evidence for inferred Narrative Harness review proof', async () => {
    await seedQueue({
      version: 1,
      lastUpdated: new Date().toISOString(),
      selectedReleaseId: 'headless-mvp',
      releases: [{
        id: 'headless-mvp',
        label: 'Headless MVP',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        nodeIds: ['work:task-current'],
        deferredNodeIds: [],
        proofStyle: 'script_only',
      }],
      tasks: [
        makeTask({
          id: 'task-current',
          title: 'Generate a CLI-first story synopsis, outline, character/voice records, and one chapter draft from the selected model',
          status: 'done',
          releaseIds: ['headless-mvp'],
          acceptanceCriteria: [{
            id: 'chapter-draft-command',
            description: 'A pnpm script or CLI command drafts one chapter from the selected model using the bounded context packet and review plan.',
            verifiedBy: 'review',
            met: true,
          }],
          proofPaths: [{
            kind: 'review',
            source: 'inferred',
            expectedEvidence: [
              'A pnpm script or CLI command drafts one chapter from the selected model using the bounded context packet and review plan.',
            ],
          }],
          doneSummaryBundle: {
            taskId: 'task-current',
            status: 'done',
            completedAt: '2026-07-04T08:50:00.000Z',
            summary: {
              journey: 'Worker timed out before mutating a likely target file.',
              decision: 'Task finished as done.',
              evidence: 'content.no-truncated-data passed.',
              learningCandidates: [],
              openResidue: 'No open residue recorded.',
            },
            retention: {
              transcriptPrimaryArtifact: false,
              compactedFullTranscript: false,
              fullEvidenceAvailable: true,
            },
            evidenceRefs: [],
            createdAt: '2026-07-04T08:50:00.000Z',
            createdBy: 'orchestrator',
          },
          gateResults: [{
            gateId: 'content.no-truncated-data',
            type: 'soft',
            passed: true,
            output: 'no truncated semantic data detected',
            checkedAt: '2026-07-04T08:50:00.000Z',
          }],
          reviewVerdicts: [{
            verdict: 'approve',
            reviewerPath: 'llm',
            reason: 'LLM reviewer approved',
            reasoning: 'The output is not truncated.',
            failingSignals: [],
            recordedAt: '2026-07-04T08:50:00.000Z',
          }],
        } as Partial<Task>),
      ],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    await approveDesignSystem(app)
    await commitAndPush('truncation-only review proof release readiness')

    const readinessRes = await app.fetch(new Request(projectUrl('/api/project/release-readiness')))
    const readiness = await readinessRes.json() as any
    expect(readiness.ready).toBe(false)
    expect(readiness.totals).toMatchObject({
      tasks: 1,
      done: 1,
      proofEvidenceBlockingCount: 1,
    })
    expect(readiness.proofMissingDoneTasks).toEqual([{
      id: 'task-current',
      title: 'Generate a CLI-first story synopsis, outline, character/voice records, and one chapter draft from the selected model',
    }])

    const projectRes = await app.fetch(new Request(projectUrl('/api/project')))
    const project = await projectRes.json() as any
    expect(project.startReadiness).toMatchObject({
      canStart: false,
      code: 'proof_evidence_missing',
      actionHref: '/work?task=task-current',
      focusTaskId: 'task-current',
      focusKind: 'proof',
      proofTaskIds: ['task-current'],
    })
    const task = project.tasks.find((candidate: any) => candidate.id === 'task-current')
    expect(task?.completionProof).toMatchObject({
      state: 'missing',
      expectedCount: 1,
      verifiedCount: expect.any(Number),
      missing: ['Required proof evidence has not been attached yet.'],
    })
    expect(project.orientationSpine?.summary).toMatchObject({
      headline: 'Headless MVP is waiting on proof.',
      nextAction: 'Attach proof for the completed scoped work.',
    })
  })

  it('does not let stale escalations block work that has later approved review proof', async () => {
    await seedQueue({
      version: 1,
      lastUpdated: new Date().toISOString(),
      selectedReleaseId: 'headless-mvp',
      releases: [{
        id: 'headless-mvp',
        label: 'Headless MVP',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        nodeIds: ['work:task-current'],
        deferredNodeIds: [],
        proofStyle: 'script_only',
      }],
      tasks: [
        makeTask({
          id: 'task-current',
          title: 'Recover completed context packet work',
          status: 'blocked',
          releaseIds: ['headless-mvp'],
          blockReason: 'human_judgment_required: Spec author stopped after hitting its turn limit.',
          escalations: [{
            id: 'esc-task-current-1',
            taskId: 'task-current',
            agentId: 'spec-agent',
            reason: 'human_judgment_required',
            summary: 'Spec author stopped after hitting its turn limit.',
            raisedAt: '2026-05-31T15:40:15.590Z',
            details: 'Exceeded maximum turn limit.',
          }],
          notes: [{
            agentId: 'worker-agent',
            role: 'self-critique',
            content: '**Self-critique:**\n\nAC 1: Met — `npm run build` passed.\n\nReview proof packet:\n- Verification commands passed: `npm run build`.',
            timestamp: '2026-06-17T04:39:21.602Z',
          }],
          reviewVerdicts: [{
            verdict: 'approve',
            reviewerPath: 'llm',
            reason: 'LLM reviewer approved',
            reasoning: 'All acceptance criteria are met and the build passes.',
            failingSignals: [],
            recordedAt: '2026-06-17T04:44:42.271Z',
          }],
        } as Partial<Task>),
      ],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    await approveDesignSystem(app)
    await commitAndPush('stale escalation release readiness')

    const readinessRes = await app.fetch(new Request(projectUrl('/api/project/release-readiness')))
    const readiness = await readinessRes.json() as any

    expect(readiness.openEscalations).toEqual([])
    expect(readiness.blockedByAgent).toEqual([])
    expect(readiness.releaseBlockers).toEqual([])
    expect(readiness.totals).toMatchObject({
      tasks: 1,
      done: 1,
      humanBlockingCount: 0,
      blockingCount: 0,
    })
    expect(readiness.ready).toBe(true)
  })

  it('does not let stale parent blockers override a later linked-child closure note', async () => {
    const staleParentWorktree = path.join(tmpDir, '..', `${path.basename(tmpDir)}-stale-parent-worktree`)
    await execFileP('git', ['worktree', 'add', '-b', 'guildhall/task-parent', staleParentWorktree], { cwd: tmpDir })
    await execFileP('git', ['commit', '--allow-empty', '-m', 'stale parent checkpoint'], { cwd: staleParentWorktree })
    await seedQueue({
      version: 1,
      lastUpdated: new Date().toISOString(),
      selectedReleaseId: 'headless-mvp',
      releases: [{
        id: 'headless-mvp',
        label: 'Headless MVP',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        nodeIds: ['work:task-parent'],
        deferredNodeIds: [],
        proofStyle: 'script_only',
      }],
      tasks: [
        makeTask({
          id: 'task-parent',
          title: 'Expand backlog into full decomposition',
          status: 'blocked',
          releaseIds: ['headless-mvp'],
          worktreePath: staleParentWorktree,
          blockReason: 'human_judgment_required: Spec agent kept researching after Guildhall asked for durable progress.',
          escalations: [{
            id: 'esc-task-parent-1',
            taskId: 'task-parent',
            agentId: 'spec-agent',
            reason: 'human_judgment_required',
            summary: 'Spec agent kept researching after Guildhall asked for durable progress.',
            raisedAt: '2026-05-31T15:39:34.666Z',
          }],
          notes: [{
            agentId: 'coordinator',
            role: 'system',
            content: 'Closed containing work after linked child tasks completed: task-parent-split-audit, task-parent-split-implement, task-parent-split-verify.',
            timestamp: '2026-06-17T07:59:35.680Z',
          }],
        } as Partial<Task>),
      ],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    await approveDesignSystem(app)
    await commitAndPush('closed parent release readiness')

    const readinessRes = await app.fetch(new Request(projectUrl('/api/project/release-readiness')))
    const readiness = await readinessRes.json() as any

    expect(readiness.openEscalations).toEqual([])
    expect(readiness.blockedByAgent).toEqual([])
    expect(readiness.releaseBlockers).toEqual([])
    expect(readiness.gitStory.blockers).toEqual([])
    expect(readiness.totals).toMatchObject({
      tasks: 1,
      done: 1,
      humanBlockingCount: 0,
      blockingCount: 0,
      gitStoryBlockingCount: 0,
    })
    expect(readiness.ready).toBe(true)
  })

  it('does not count importer-generated decomposition children as scoped release tasks', async () => {
    await seedQueue({
      version: 1,
      lastUpdated: new Date().toISOString(),
      selectedReleaseId: 'headless-mvp',
      releases: [{
        id: 'headless-mvp',
        label: 'Headless MVP',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        nodeIds: ['work:task-runner', 'work:task-runner-split-load-fixture-inputs'],
        deferredNodeIds: [],
        proofStyle: 'script_only',
      }],
      tasks: [
        makeTask({
          id: 'task-runner',
          title: 'Implement a no-UI runner that builds a packet from fixture records.',
          status: 'ready',
          requestIntake: { createdBy: 'workspace-importer' } as Task['requestIntake'],
          hierarchy: { childIds: ['task-runner-split-load-fixture-inputs'], relation: 'contains' } as Task['hierarchy'],
        }),
        makeTask({
          id: 'task-runner-split-load-fixture-inputs',
          title: 'Load fixture inputs and canonical story records',
          status: 'exploring',
          hierarchy: { parentId: 'task-runner', childIds: [], order: 0, relation: 'decomposes' } as Task['hierarchy'],
          notes: [{ agentId: 'task-sizing', role: 'coordinator', content: 'Generated split child.' }] as Task['notes'],
        }),
      ],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    await approveDesignSystem(app)
    await commitAndPush('release readiness ignores imported split children')

    const res = await app.fetch(new Request(projectUrl('/api/project/release-readiness')))
    const body = await res.json() as any

    expect(body.scope.nodeIds).toEqual(['work:task-runner'])
    expect(body.totals.tasks).toBe(1)
    expect(body.statusCounts).toEqual({ ready: 1 })
  })

  it('does not turn active materialized child work into parent brief-cleanup blockers', async () => {
    await seedQueue({
      version: 1,
      lastUpdated: new Date().toISOString(),
      selectedReleaseId: 'headless-mvp',
      releases: [{
        id: 'headless-mvp',
        label: 'Headless MVP',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        nodeIds: ['work:task-contracts'],
        deferredNodeIds: [],
        proofStyle: 'script_only',
      }],
      tasks: [
        makeTask({
          id: 'task-contracts',
          title: 'Define fixture, expected-record, prototype-run, and evaluation schemas.',
          status: 'ready',
          releaseIds: ['headless-mvp'],
          requestIntake: { createdBy: 'workspace-importer' } as Task['requestIntake'],
          productBrief: {
            userJob: 'Shape the headless fixture harness.',
            whyItMattersNow: 'The first proof loop needs contract records.',
            successMetric: 'Contracts are ready for child implementation.',
            nonGoals: [],
          },
          spec: 'Parent contract spec.',
          acceptanceCriteria: [{ id: 'AC-1', description: 'Contracts are named.', verifiedBy: 'review', met: false }],
          hierarchy: { childIds: ['task-ground-truth'], relation: 'contains' } as Task['hierarchy'],
        }),
        makeTask({
          id: 'task-ground-truth',
          title: 'Shape fixture and expected-record ground truth',
          status: 'in_progress',
          assignedTo: 'worker-agent',
          hierarchy: { parentId: 'task-contracts', childIds: [], order: 0, relation: 'decomposes' } as Task['hierarchy'],
          notes: [{ agentId: 'task-sizing', role: 'coordinator', content: 'Generated split child.' }] as Task['notes'],
          productBrief: {
            userJob: 'Define fixture ground truth.',
            whyItMattersNow: 'The current worker is implementing this child.',
            successMetric: 'Fixture records can drive the proof loop.',
            nonGoals: ['Prototype run records'],
            approvedAt: '2026-07-04T16:00:00.000Z',
          },
          spec: 'Child fixture spec.',
          acceptanceCriteria: [{ id: 'AC-1', description: 'Fixture records exist.', verifiedBy: 'test', met: false }],
        }),
      ],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    await approveDesignSystem(app)
    await commitAndPush('active child release readiness')

    const res = await app.fetch(new Request(projectUrl('/api/project/release-readiness')))
    const body = await res.json() as any

    expect(body.incompleteBriefs).toEqual([])
    expect(body.unapprovedBriefs).toEqual([])
    expect(body.totals.humanBlockingCount).toBe(0)
    expect(body.statusCounts).toEqual({ ready: 1 })
    expect(body.totals.unfinishedCount).toBe(1)
    expect(body.ready).toBe(false)
  })

  it('counts materialized split children as release execution units instead of counting the parent twice', async () => {
    await seedQueue({
      version: 1,
      lastUpdated: new Date().toISOString(),
      selectedReleaseId: 'headless-mvp',
      releases: [{
        id: 'headless-mvp',
        label: 'Headless MVP',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        nodeIds: ['work:task-contracts'],
        deferredNodeIds: [],
        proofStyle: 'script_only',
      }],
      tasks: [
        makeTask({
          id: 'task-contracts',
          title: 'Define Narrative Harness MVP drafting model and physical-world review lanes',
          status: 'ready',
          releaseIds: ['headless-mvp'],
          spec: 'Parent spec represented by linked child tasks.',
          acceptanceCriteria: [{ id: 'AC-1', description: 'Child work is complete.', verifiedBy: 'review', met: false }],
          hierarchy: {
            childIds: [
              'task-contracts-split-model',
              'task-contracts-split-world',
              'task-contracts-split-space',
            ],
            relation: 'contains',
          } as Task['hierarchy'],
        }),
        makeTask({
          id: 'task-contracts-split-model',
          title: 'Select and prove DeepInfra drafting model',
          status: 'in_progress',
          assignedTo: 'worker-agent',
          hierarchy: { parentId: 'task-contracts', childIds: [], order: 0, relation: 'decomposes' } as Task['hierarchy'],
          spec: 'Select and prove a DeepInfra-accessible drafting model.',
          acceptanceCriteria: [{ id: 'AC-1', description: 'Model is proven across genres.', verifiedBy: 'review', met: false }],
        }),
        makeTask({
          id: 'task-contracts-split-world',
          title: 'Define world-state continuity review lane',
          status: 'ready',
          hierarchy: { parentId: 'task-contracts', childIds: [], order: 1, relation: 'decomposes' } as Task['hierarchy'],
          spec: 'Define world-state continuity.',
          acceptanceCriteria: [{ id: 'AC-1', description: 'World state reviewer exists.', verifiedBy: 'review', met: false }],
        }),
        makeTask({
          id: 'task-contracts-split-space',
          title: 'Define spatial/geographic continuity review lane',
          status: 'ready',
          hierarchy: { parentId: 'task-contracts', childIds: [], order: 2, relation: 'decomposes' } as Task['hierarchy'],
          spec: 'Define spatial continuity.',
          acceptanceCriteria: [{ id: 'AC-1', description: 'Spatial reviewer exists.', verifiedBy: 'review', met: false }],
        }),
      ],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    await approveDesignSystem(app)
    await commitAndPush('materialized children are execution units')

    const res = await app.fetch(new Request(projectUrl('/api/project/release-readiness')))
    const body = await res.json() as any

    expect(body.statusCounts).toEqual({ in_progress: 1, ready: 2 })
    expect(body.totals.tasks).toBe(3)
    expect(body.totals.unfinishedCount).toBe(3)
    expect(body.blockedByAgent).toEqual([])
    expect(body.releaseBlockers ?? []).toEqual([])
  })

  it('does not let stale completion proof mark revised in-progress work as done', async () => {
    await seedQueue({
      version: 1,
      lastUpdated: new Date().toISOString(),
      selectedReleaseId: 'headless-mvp',
      releases: [{
        id: 'headless-mvp',
        label: 'Headless MVP',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        nodeIds: ['work:task-model'],
        deferredNodeIds: [],
        proofStyle: 'script_only',
      }],
      tasks: [
        makeTask({
          id: 'task-model',
          title: 'Select and prove DeepInfra drafting model',
          status: 'in_progress',
          assignedTo: 'worker-agent',
          releaseIds: ['headless-mvp'],
          acceptanceCriteria: [{ id: 'AC-1', description: 'Model proof records telemetry.', verifiedBy: 'review', met: false }],
          gateResults: [{
            gateId: 'build',
            status: 'passed',
            command: 'npm run build',
            checkedAt: '2026-07-06T11:46:02.000Z',
          }],
          reviewVerdicts: [{
            verdict: 'revise',
            reviewerPath: 'llm',
            reason: 'Proof lacks telemetry.',
            recordedAt: '2026-07-06T11:48:30.000Z',
          }],
        }),
      ],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    await approveDesignSystem(app)
    await commitAndPush('revised work stays unfinished')

    const body = await (await app.fetch(new Request(projectUrl('/api/project/release-readiness')))).json() as any

    expect(body.statusCounts).toEqual({ in_progress: 1 })
    expect(body.totals.done).toBe(0)
    expect(body.totals.unfinishedCount).toBe(1)
    expect(body.ready).toBe(false)
  })

  it('does not treat ready spec-shaped work as incomplete brief cleanup', async () => {
    await seedQueue({
      version: 1,
      lastUpdated: new Date().toISOString(),
      selectedReleaseId: 'headless-mvp',
      releases: [{
        id: 'headless-mvp',
        label: 'Headless MVP',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        nodeIds: ['work:task-fixture'],
        deferredNodeIds: [],
        proofStyle: 'script_only',
      }],
      tasks: [
        makeTask({
          id: 'task-fixture',
          title: 'Add the first tiny fiction fixture and human-authored expected records.',
          status: 'ready',
          releaseIds: ['headless-mvp'],
          productBrief: {
            userJob: 'Build a no-UI fixture proof.',
            whyItMattersNow: 'The MVP needs reusable ground truth.',
            successMetric: 'Fixture records are available.',
            nonGoals: [],
          },
          spec: 'Fixture spec.',
          acceptanceCriteria: [{ id: 'AC-1', description: 'Fixture records exist.', verifiedBy: 'test', met: false }],
        }),
      ],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    await approveDesignSystem(app)
    await commitAndPush('ready spec shaped work')

    const res = await app.fetch(new Request(projectUrl('/api/project/release-readiness')))
    const body = await res.json() as any

    expect(body.incompleteBriefs).toEqual([])
    expect(body.unapprovedBriefs).toEqual([])
    expect(body.totals.humanBlockingCount).toBe(0)
    expect(body.statusCounts).toEqual({ ready: 1 })
    expect(body.totals.unfinishedCount).toBe(1)
  })

  it('returns a plain release-readiness load error when task state cannot be read', async () => {
    await writeProjectStateTextAsync(tmpDir, 'TASKS.json', '{ broken json')
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
    expect(body.totals.blockingCount).toBe(2)
    expect(body.totals.unfinishedCount).toBe(2)
    expect(body.ready).toBe(false)
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

  it('keeps imported current-scope shaping work visible as incomplete brief cleanup', async () => {
    await seedQueue({
      version: 1,
      lastUpdated: new Date().toISOString(),
      selectedReleaseId: 'near-term-proof-scope',
      releases: [{
        id: 'near-term-proof-scope',
        label: 'Near Term Proof Scope',
        kind: 'release',
        state: 'active',
        source: 'inferred',
        nodeIds: ['work:task-imported'],
        deferredNodeIds: [],
        proofStyle: 'script_only',
      }],
      tasks: [
        makeTask({
          id: 'task-imported',
          title: 'Recover source-backed contract surface',
          status: 'import_draft',
          releaseIds: ['near-term-proof-scope'],
          notes: [{
            agentId: 'workspace-importer',
            role: 'importer',
            content: 'Imported from docs/specs/contract.md',
          }],
          spec: 'Imported repair spec.',
          acceptanceCriteria: [{ id: 'AC-1', description: 'Contract surfaces are named.', verifiedBy: 'review', met: false }],
        }),
      ],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    await approveDesignSystem(app)
    await commitAndPush('import draft release readiness')

    const res = await app.fetch(new Request(projectUrl('/api/project/release-readiness')))
    const body = await res.json() as any

    expect(body.incompleteBriefs).toEqual([
      {
        id: 'task-imported',
        title: 'Recover source-backed contract surface',
        reason: 'Imported current work needs a real brief before Guildhall can build unattended.',
      },
    ])
    expect(body.totals.incompleteBriefBlockingCount).toBe(1)
    expect(body.totals.humanBlockingCount).toBe(1)
    expect(body.ready).toBe(false)
  })

  it('returns projection release blockers for every unshaped current execution row', async () => {
    await seedQueue({
      version: 1,
      lastUpdated: new Date().toISOString(),
      selectedReleaseId: 'primitive-wave',
      releases: [{
        id: 'primitive-wave',
        label: 'Primitive wave',
        kind: 'release',
        state: 'active',
        source: 'inferred',
        nodeIds: [
          'work:task-imported',
          'work:task-ready-unshaped',
          'work:task-exploring-unshaped',
        ],
        deferredNodeIds: [],
        proofStyle: 'script_only',
      }],
      tasks: [
        makeTask({
          id: 'task-imported',
          title: 'Block menu / block side menu',
          status: 'import_draft',
        }),
        makeTask({
          id: 'task-ready-unshaped',
          title: 'Link editing UI',
          status: 'ready',
          acceptanceCriteria: [],
        }),
        makeTask({
          id: 'task-exploring-unshaped',
          title: 'Audit the remaining replacement scope',
          status: 'exploring',
          acceptanceCriteria: [],
        }),
      ],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    await approveDesignSystem(app)
    await commitAndPush('projection blockers visible')

    const res = await app.fetch(new Request(projectUrl('/api/project/release-readiness')))
    const body = await res.json() as any

    expect(body.totals.humanBlockingCount).toBe(3)
    expect(body.releaseBlockers.map((blocker: any) => blocker.id)).toEqual([
      'task-imported',
      'task-ready-unshaped',
      'task-exploring-unshaped',
    ])
    expect(body.releaseBlockers.map((blocker: any) => blocker.label)).toEqual([
      'Block menu / block side menu: needs a clearer brief before unattended work can run.',
      'Link editing UI: needs a clearer brief before unattended work can run.',
      'Audit the remaining replacement scope: needs a clearer brief before unattended work can run.',
    ])

    const overviewRes = await app.fetch(new Request(projectUrl('/api/project?surface=overview')))
    const overview = await overviewRes.json() as any
    expect(overview.workProgress.selectedCounts).toMatchObject({
      visibleTotal: 3,
      visibleBlocked: 3,
      visibleActive: 0,
    })

    const workRes = await app.fetch(new Request(projectUrl('/api/project?surface=work')))
    const work = await workRes.json() as any
    expect(work.workProgress.selectedCounts).toMatchObject({
      visibleTotal: 3,
      visibleBlocked: 3,
      visibleActive: 0,
    })

    const mapRes = await app.fetch(new Request(projectUrl('/api/project?surface=map')))
    const map = await mapRes.json() as any
    expect(map.workProgress.selectedCounts).toMatchObject({
      visibleTotal: 3,
      visibleBlocked: 3,
      visibleActive: 0,
    })

    registerWorkspace({ id: projectId, name: 'Release Test', path: tmpDir, tags: [] })
    const serviceRes = await app.fetch(new Request('http://localhost/api/service'))
    const service = await serviceRes.json() as any
    const project = service.projects.find((candidate: any) => candidate.path === tmpDir)
    expect(project.workProgress.selectedCounts).toMatchObject({
      visibleTotal: 3,
      visibleBlocked: 3,
      visibleActive: 0,
    })
  }, 45000)

  it('counts imported selected-scope rows the same way as the project spine', async () => {
    await writeProjectStateJsonAsync(tmpDir, 'workspace-goals.json', {
      version: 3,
      recordedAt: new Date().toISOString(),
      goals: [],
      tasks: [
        {
          id: 'task-done',
          title: 'Completed release task',
          description: 'Done work.',
          domain: 'core',
          priority: 'normal',
          scope: 'current',
          releaseIds: ['stage-1'],
          references: [],
        },
        {
          id: 'task-blocked',
          title: 'Blocked release task',
          description: 'Blocked work.',
          domain: 'core',
          priority: 'normal',
          scope: 'current',
          releaseIds: ['stage-1'],
          references: [],
        },
        {
          id: 'task-spec-review',
          title: 'Review release spec',
          description: 'Spec work.',
          domain: 'core',
          priority: 'normal',
          scope: 'current',
          releaseIds: ['stage-1'],
          references: [],
        },
        {
          id: 'task-ready',
          title: 'Ready release task',
          description: 'Ready work.',
          domain: 'core',
          priority: 'normal',
          scope: 'current',
          releaseIds: ['stage-1'],
          references: [],
        },
      ],
      milestones: [],
      context: [],
      approved: {
        goalCount: 0,
        taskCount: 4,
        milestoneCount: 0,
        currentTaskCount: 4,
        laterTaskCount: 0,
        taskIds: ['task-done', 'task-blocked', 'task-spec-review', 'task-ready'],
        currentTaskIds: ['task-done', 'task-blocked', 'task-spec-review', 'task-ready'],
        laterTaskIds: [],
      },
      detected: null,
    })
    await seedQueue({
      version: 1,
      lastUpdated: new Date().toISOString(),
      selectedReleaseId: 'stage-1',
      releases: [{
        id: 'stage-1',
        label: 'Stage 1',
        kind: 'release',
        state: 'active',
        source: 'inferred',
        nodeIds: ['work:task-done'],
        deferredNodeIds: [],
        proofStyle: 'script_only',
      }],
      tasks: [
        makeTask({
          id: 'task-done',
          title: 'Completed release task',
          status: 'done',
          releaseIds: ['stage-1'],
        }),
        makeTask({
          id: 'task-blocked',
          title: 'Blocked release task',
          status: 'blocked',
          releaseIds: [],
          spec: 'Imported repair spec.',
          acceptanceCriteria: [{ id: 'AC-1', description: 'Blocked task is named.', verifiedBy: 'review', met: false }],
        }),
        makeTask({
          id: 'task-spec-review',
          title: 'Review release spec',
          status: 'spec_review',
          releaseIds: [],
          spec: 'Imported review spec.',
          acceptanceCriteria: [{ id: 'AC-1', description: 'Spec waits for review.', verifiedBy: 'review', met: false }],
        }),
        makeTask({
          id: 'task-ready',
          title: 'Ready release task',
          status: 'ready',
          releaseIds: [],
          spec: 'Ready imported spec.',
          acceptanceCriteria: [{ id: 'AC-1', description: 'Ready work is shaped.', verifiedBy: 'review', met: false }],
        }),
      ],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    await approveDesignSystem(app)
    await commitAndPush('selected scope count agreement')

    const projectRes = await app.fetch(new Request(projectUrl('/api/project')))
    const readinessRes = await app.fetch(new Request(projectUrl('/api/project/release-readiness')))
    const projectBody = await projectRes.json() as any
    const readinessBody = await readinessRes.json() as any

    expect(projectBody.orientationSpine.summary.includedWorkCount).toBe(4)
    expect(readinessBody.scope.nodeIds).toHaveLength(4)
    expect(readinessBody.totals.tasks).toBe(4)
    expect(readinessBody.statusCounts).toMatchObject({
      done: 1,
      blocked: 1,
      spec_review: 1,
      ready: 1,
    })
    expect(readinessBody.totals.humanBlockingCount).toBe(2)
    expect(readinessBody.totals.unfinishedCount).toBe(3)
  })

  it('keeps overview task rows scoped to the selected release instead of shipping deferred backlog rows', async () => {
    await seedQueue({
      version: 1,
      lastUpdated: new Date().toISOString(),
      selectedReleaseId: 'stage-1',
      releases: [{
        id: 'stage-1',
        label: 'Stage 1',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        nodeIds: ['work:task-current'],
        deferredNodeIds: ['work:task-later'],
        proofStyle: 'script_only',
      }],
      tasks: [
        makeTask({
          id: 'task-current',
          title: 'Current release task',
          status: 'ready',
          releaseIds: ['stage-1'],
          spec: 'Current release work.',
          acceptanceCriteria: [{ id: 'AC-current', description: 'Current task is shaped.', verifiedBy: 'review' }],
        }),
        makeTask({
          id: 'task-later',
          title: 'Later release task',
          status: 'blocked',
          releaseIds: [],
          spec: 'Later release work.',
          proofPaths: [{ id: 'proof', title: 'Later proof', status: 'blocked' }],
          acceptanceCriteria: [{ id: 'AC-later', description: 'Later task is shaped.', verifiedBy: 'review' }],
        }),
      ],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    await approveDesignSystem(app)
    await commitAndPush('overview scoped rows')

    const res = await app.fetch(new Request(projectUrl('/api/project?surface=overview')))
    const body = await res.json() as any

    expect(body.orientationSpine.summary.includedWorkCount).toBe(1)
    expect(body.orientationSpine.summary.deferredWorkCount).toBe(1)
    expect(body.orientationSpine.roots).toEqual([])
    expect(body.orientationSpine.nodes).toEqual({})
    expect(body.tasks.map((task: any) => task.id)).toEqual(['task-current'])
    expect(body.workProgress.counts).toMatchObject({
      visibleTotal: 2,
      visibleBlocked: 1,
      deliveryBlocked: 1,
    })
    expect(body.workProgress.selectedCounts).toMatchObject({
      visibleTotal: 1,
      visibleActive: 1,
      visibleBlocked: 0,
      deliveryBlocked: 0,
    })
  }, 20000)

  it('does not widen the selected release with an unscoped import duplicate of scoped work', async () => {
    const proofPath = {
      title: 'DeepInfra drafting proof command',
      launchSteps: [{ id: 'deepinfra-model-proof', title: 'Run DeepInfra model proof', kind: 'copy_command' as const, command: 'pnpm nh:prove:deepinfra' }],
      source: 'inferred' as const,
      expectedEvidence: [
        'DeepInfra proof records refusal behavior, repetition, cost, latency, and voice preservation.',
      ],
    }
    await writeProjectStateJsonAsync(tmpDir, 'workspace-goals.json', {
      version: 3,
      recordedAt: new Date().toISOString(),
      goals: [],
      releases: [{
        id: 'stage-1-headless-drafting-and-evaluation-mvp',
        label: 'Stage 1 Headless Drafting And Evaluation MVP',
        source: 'release_plan',
        state: 'active',
      }],
      tasks: [
        {
          id: 'task-stale',
          title: 'Select and prove a DeepInfra drafting model for broad-genre chapter writing.',
          description: 'Older approved import row.',
          domain: 'harness',
          priority: 'normal',
          scope: 'current',
          releaseIds: ['stage-1-headless-drafting-and-evaluation-mvp'],
          references: [],
        },
      ],
      milestones: [],
      context: [],
      approved: {
        goalCount: 0,
        taskCount: 1,
        milestoneCount: 0,
        currentTaskCount: 1,
        laterTaskCount: 0,
        taskIds: ['task-stale'],
        currentTaskIds: ['task-stale'],
        laterTaskIds: [],
      },
      detected: null,
    })
    await seedQueue({
      version: 1,
      lastUpdated: new Date().toISOString(),
      selectedReleaseId: 'stage-1-headless-drafting-and-evaluation-mvp',
      releases: [{
        id: 'stage-1-headless-drafting-and-evaluation-mvp',
        label: 'Stage 1 Headless Drafting And Evaluation MVP',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        nodeIds: ['work:task-current'],
        deferredNodeIds: [],
        proofStyle: 'script_only',
      }],
      tasks: [
        makeTask({
          id: 'task-current',
          title: 'Select and prove a DeepInfra drafting model for broad-genre and legal adult fiction chapter writing.',
          status: 'done',
          releaseIds: ['stage-1-headless-drafting-and-evaluation-mvp'],
          proofPaths: [proofPath],
          gateResults: [{
            gateId: 'deepinfra-model-proof',
            type: 'hard',
            passed: true,
            output: 'DeepInfra proof records refusal behavior, repetition, cost, latency, and voice preservation.',
            checkedAt: '2026-07-07T11:05:00.000Z',
          }],
          reviewVerdicts: [{
            verdict: 'approve',
            reviewerPath: 'llm',
            reason: 'LLM reviewer approved.',
            reasoning: 'All acceptance criteria are met.',
            failingSignals: [],
            recordedAt: '2026-07-07T11:04:00.000Z',
          }],
        }),
        makeTask({
          id: 'task-stale',
          title: 'Select and prove a DeepInfra drafting model for broad-genre chapter writing.',
          status: 'done',
          releaseIds: [],
          proofPaths: [proofPath],
        }),
      ],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    await approveDesignSystem(app)
    await commitAndPush('scoped duplicate release proof')

    const projectRes = await app.fetch(new Request(projectUrl('/api/project')))
    const projectBody = await projectRes.json() as any
    const readinessRes = await app.fetch(new Request(projectUrl('/api/project/release-readiness')))
    const readinessBody = await readinessRes.json() as any

    expect(projectBody.orientationSpine.scope.nodeIds).toContain('work:task-current')
    expect(projectBody.orientationSpine.scope.nodeIds).not.toContain('work:task-stale')
    expect(projectBody.startReadiness?.proofTaskIds ?? []).not.toContain('task-stale')
    expect(projectBody.startReadiness?.code).not.toBe('proof_evidence_missing')
    expect(projectBody.startReadiness?.code).not.toBe('scope_source_conflict')
    expect(readinessBody.scope.nodeIds).toEqual(['work:task-current'])
    expect(readinessBody.proofMissingDoneTasks).toEqual([])
  })

  it('builds the project spine from effective task proof state, not stale raw task records', async () => {
    await seedQueue({
      version: 1,
      lastUpdated: new Date().toISOString(),
      selectedReleaseId: 'headless-mvp',
      releases: [{
        id: 'headless-mvp',
        label: 'Headless MVP',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        nodeIds: ['work:task-runner'],
        deferredNodeIds: [],
        proofStyle: 'script_only',
      }],
      tasks: [
        makeTask({
          id: 'task-runner',
          title: 'Implement no-UI runner.',
          status: 'done',
          releaseIds: ['headless-mvp'],
          proofPaths: [{
            title: 'Runner smoke command',
            launchSteps: [{ id: 'runner-smoke', title: 'Run runner smoke', kind: 'copy_command', command: 'pnpm test -- runner-smoke' }],
            expectedEvidence: ['runner-smoke'],
          }],
          gateResults: [],
          reviewVerdicts: [],
        }),
      ],
    })
    await appendTaskEvidence(tmpDir, 'task-runner', {
      id: 'gate-task-runner-smoke',
      kind: 'gate_result',
      recordedAt: '2026-07-06T12:00:00.000Z',
      payload: {
        gateId: 'runner-smoke',
        status: 'pass',
        checkedAt: '2026-07-06T12:00:00.000Z',
      },
    })
    await appendTaskEvidence(tmpDir, 'task-runner', {
      id: 'review-task-runner-smoke',
      kind: 'review_verdict',
      recordedAt: '2026-07-06T12:01:00.000Z',
      payload: {
        reviewerPath: 'deterministic',
        verdict: 'approve',
        recordedAt: '2026-07-06T12:01:00.000Z',
      },
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    await approveDesignSystem(app)
    await commitAndPush('runner proof landed')

    const readiness = await (await app.fetch(new Request(projectUrl('/api/project/release-readiness')))).json() as any
    const overview = await (await app.fetch(new Request(projectUrl('/api/project?surface=overview')))).json() as any
    const spineBody = await (await app.fetch(new Request(projectUrl('/api/project/spine')))).json() as any

    expect(readiness.ready).toBe(true)
    expect(readiness.totals.proofEvidenceBlockingCount).toBe(0)
    expect(overview.releaseReadiness.ready).toBe(true)
    expect(overview.tasks.find((task: any) => task.id === 'task-runner')?.completionProof).toMatchObject({
      state: 'verified',
    })
    expect(overview.workProgress.byTaskId['task-runner']).toMatchObject({
      rollup: {
        primaryState: 'done',
        requiredStepCount: 1,
        doneStepCount: 1,
      },
    })
    expect(overview.workProgress.byTaskId['task-runner'].deliverySteps).toEqual([
      expect.objectContaining({
        id: 'proof:1',
        status: 'done',
      }),
    ])
    expect(spineBody.spine.gaps.map((gap: any) => gap.kind)).not.toContain('proof_needed')
    expect(spineBody.spine.release.blockers).toEqual([])
    expect(spineBody.spine.nodes['work:task-runner']?.maturity).toBe('proven')
  })

  it('returns a compact project spine for overview previews without changing the full map spine', async () => {
    await seedQueue({
      version: 1,
      lastUpdated: new Date().toISOString(),
      selectedReleaseId: 'headless-mvp',
      releases: [{
        id: 'headless-mvp',
        label: 'Headless MVP',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        nodeIds: ['work:task-runner'],
        deferredNodeIds: [],
        proofStyle: 'script_only',
      }],
      tasks: [
        makeTask({
          id: 'task-runner',
          title: 'Implement command-line runner.',
          description: 'A script-only command runner for the headless release.',
          status: 'ready',
          releaseIds: ['headless-mvp'],
        }),
      ],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })

    const fullBody = await (await app.fetch(new Request(projectUrl('/api/project/spine')))).json() as any
    const previewUrl = new URL(projectUrl('/api/project/spine'))
    previewUrl.searchParams.set('surface', 'overview')
    const previewBody = await (await app.fetch(new Request(previewUrl))).json() as any
    const mapUrl = new URL(projectUrl('/api/project'))
    mapUrl.searchParams.set('surface', 'map')
    const mapBody = await (await app.fetch(new Request(mapUrl))).json() as any
    const overviewUrl = new URL(projectUrl('/api/project'))
    overviewUrl.searchParams.set('surface', 'overview')
    const overviewBody = await (await app.fetch(new Request(overviewUrl))).json() as any

    expect(fullBody.spine.roots.length).toBeGreaterThan(0)
    expect(fullBody.spine.nodes['work:task-runner']).toMatchObject({ title: 'Implement command-line runner.' })
    expect(previewBody.spine.roots).toEqual([])
    expect(previewBody.spine.nodes).toEqual({})
    expect(previewBody.spine.summary.includedWorkCount).toBe(1)
    expect(previewBody.spine.selectedRelease.source).toBe('release_plan')
    expect(previewBody.spine.scope.source).toBe('release_plan')
    expect(previewBody.spine.executionBoundary).toMatchObject({
      label: 'Headless proof',
      mode: 'headless',
      proofStyle: 'script_only',
    })
    expect(previewBody.spine.sourceTrail).toContainEqual(expect.objectContaining({
      label: 'Scope',
      value: 'Release Plan',
    }))
    expect(previewBody.spine.selectedRelease.nodeIds).toEqual(['work:task-runner'])
    expect(previewBody.spine.release).toEqual(fullBody.spine.release)
    expect(mapBody.orientationSpine.roots.length).toBeGreaterThan(0)
    expect(mapBody.orientationSpine.nodes).toEqual({})
    expect(mapBody.orientationSpine.roots[0]).toMatchObject({
      id: expect.any(String),
      title: expect.any(String),
      children: expect.any(Array),
    })
    expect(mapBody.orientationSpine.roots[0].ownerAction).toBeUndefined()
    expect(mapBody.orientationSpine.roots[0].proof).toBeUndefined()
    expect(mapBody.orientationSpine.selectedRelease.source).toBe('release_plan')
    expect(mapBody.orientationSpine.executionBoundary).toMatchObject({
      label: fullBody.spine.executionBoundary.label,
      mode: fullBody.spine.executionBoundary.mode,
      proofStyle: fullBody.spine.executionBoundary.proofStyle,
      detail: fullBody.spine.executionBoundary.detail,
    })
    expect(overviewBody.orientationSpine.executionBoundary).toMatchObject({
      label: fullBody.spine.executionBoundary.label,
      mode: fullBody.spine.executionBoundary.mode,
      proofStyle: fullBody.spine.executionBoundary.proofStyle,
      detail: fullBody.spine.executionBoundary.detail,
    })
    expect(mapBody.orientationSpine.sourceTrail).toContainEqual(expect.objectContaining({
      label: 'Scope',
      value: 'Release Plan',
    }))
    expect(mapBody.tasks).toEqual([expect.objectContaining({
      id: 'task-runner',
      title: 'Implement command-line runner.',
      status: 'ready',
    })])
    expect(mapBody.tasks[0].acceptanceCriteria).toBeUndefined()
    expect(mapBody.inbox).toBeUndefined()
    expect(mapBody.taskRoutingContexts).toEqual({})
    expect(mapBody.runtime).toBeNull()
    expect(mapBody.recentEvents).toEqual([])
    expect(mapBody.actionModel?.runControl?.label).toBeTruthy()
  })

  it('keeps overview spine preview release state aligned with proof blockers', async () => {
    await seedQueue({
      version: 1,
      lastUpdated: new Date().toISOString(),
      selectedReleaseId: 'headless-mvp',
      releases: [{
        id: 'headless-mvp',
        label: 'Headless MVP',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        nodeIds: ['work:task-runner'],
        deferredNodeIds: [],
        proofStyle: 'script_only',
      }],
      tasks: [
        makeTask({
          id: 'task-runner',
          title: 'Implement command-line runner.',
          description: 'A script-only command runner for the headless release.',
          status: 'done',
          releaseIds: ['headless-mvp'],
          proofPaths: [{
            kind: 'command',
            source: 'inferred',
            launchSteps: [{
              id: 'task-runner-proof-command-needed',
              title: 'Add proof command',
              kind: 'blocked_until_setup',
              setupRequirement: 'No repo-local pnpm script or CLI proof command is named yet.',
            }],
            expectedEvidence: ['Add a repo-local pnpm script or CLI proof command.'],
          }],
        } as Partial<Task>),
      ],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })

    const previewUrl = new URL(projectUrl('/api/project/spine'))
    previewUrl.searchParams.set('surface', 'overview')
    const previewBody = await (await app.fetch(new Request(previewUrl))).json() as any
    const projectBody = await (await app.fetch(new Request(projectUrl('/api/project')))).json() as any

    expect(previewBody.spine.release.state).toBe('blocked')
    expect(previewBody.spine.selectedRelease.state).toBe('blocked')
    expect(previewBody.spine.releases.map((release: any) => [release.id, release.state])).toEqual([
      ['headless-mvp', 'blocked'],
    ])
    expect(projectBody.startReadiness).toMatchObject({
      canStart: false,
      code: 'proof_evidence_missing',
      focusTaskId: 'task-runner',
      focusKind: 'proof',
      proofTaskIds: ['task-runner'],
    })
  })

  it('does not turn terminal complete start readiness into an overview blocker', async () => {
    await seedQueue({
      version: 1,
      lastUpdated: new Date().toISOString(),
      selectedReleaseId: 'headless-mvp',
      releases: [{
        id: 'headless-mvp',
        label: 'Headless MVP',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        nodeIds: ['work:task-runner'],
        deferredNodeIds: [],
        proofStyle: 'script_only',
      }],
      tasks: [
        makeTask({
          id: 'task-runner',
          title: 'Completed no-UI runner.',
          status: 'done',
          completedAt: '2026-05-09T00:00:00Z',
          releaseIds: ['headless-mvp'],
          ...modeledScriptProof(),
        }),
      ],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    await commitAndPush('completed headless mvp')

    const previewUrl = new URL(projectUrl('/api/project/spine'))
    previewUrl.searchParams.set('surface', 'overview')
    const previewBody = await (await app.fetch(new Request(previewUrl))).json() as any

    expect(previewBody.spine.summary.headline).toBe('Headless MVP is complete.')
    expect(previewBody.spine.summary.topBlocker).toBeNull()
    expect(previewBody.spine.summary.nextAction).toBe('Review completed scope.')
  })

  it('keeps imported source-recovery work visible as incomplete brief cleanup', async () => {
    await seedQueue({
      version: 1,
      lastUpdated: new Date().toISOString(),
      selectedReleaseId: 'near-term-proof-scope',
      releases: [{
        id: 'near-term-proof-scope',
        label: 'Near Term Proof Scope',
        kind: 'release',
        state: 'active',
        source: 'inferred',
        nodeIds: ['work:task-imported'],
        deferredNodeIds: [],
        proofStyle: 'script_only',
      }],
      tasks: [
        makeTask({
          id: 'task-imported',
          title: 'Recover source-backed contract surface',
          status: 'exploring',
          releaseIds: ['near-term-proof-scope'],
          notes: [{
            agentId: 'workspace-importer',
            role: 'importer',
            content: 'Imported from docs/specs/contract.md',
          }],
          productBrief: {
            userJob: 'Recover the contract surface.',
            whyItMattersNow: 'Workers need concrete contracts before implementation.',
            successMetric: 'The relevant contract names are recovered from source.',
            nonGoals: ['Do not invent contracts.'],
          },
          acceptanceCriteria: [{ id: 'AC-1', description: 'Contract surfaces are named.', verifiedBy: 'review', met: false }],
          taskReadiness: {
            recommendation: 'needs_research_spike',
            summary: 'This imported task still needs concrete contract names before Guildhall can hand it to a worker.',
          },
        }),
      ],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    await approveDesignSystem(app)
    await commitAndPush('imported source recovery release readiness')

    const res = await app.fetch(new Request(projectUrl('/api/project/release-readiness')))
    const body = await res.json() as any

    expect(body.incompleteBriefs).toEqual([
      {
        id: 'task-imported',
        title: 'Recover source-backed contract surface',
        reason: 'This imported task still needs concrete contract names before Guildhall can hand it to a worker.',
      },
    ])
    expect(body.totals.incompleteBriefBlockingCount).toBe(1)
    expect(body.totals.humanBlockingCount).toBe(1)
    expect(body.ready).toBe(false)
  })

  it('does not absorb unassigned open root backlog into a selected named release', async () => {
    await seedQueue({
      version: 1,
      lastUpdated: new Date().toISOString(),
      selectedReleaseId: 'stage-1',
      releases: [{
        id: 'stage-1',
        label: 'Stage 1',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        nodeIds: ['work:task-done'],
        deferredNodeIds: [],
        proofStyle: 'script_only',
      }],
      tasks: [
        makeTask({
          id: 'task-done',
          title: 'Completed release task',
          status: 'done',
          releaseIds: ['stage-1'],
          ...modeledScriptProof(),
        }),
        makeTask({
          id: 'unassigned-ready',
          title: 'Unassigned ready backlog',
          status: 'ready',
          releaseIds: [],
          spec: 'This belongs to backlog, not the selected release.',
          acceptanceCriteria: [{ id: 'AC-1', description: 'Backlog remains unassigned.', verifiedBy: 'review', met: false }],
        }),
        makeTask({
          id: 'unassigned-blocked',
          title: 'Unassigned blocked backlog',
          status: 'blocked',
          releaseIds: [],
          blockReason: 'This blocker should not hold the selected release.',
        }),
      ],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    await approveDesignSystem(app)
    await commitAndPush('selected release ignores unassigned backlog')

    const projectRes = await app.fetch(new Request(projectUrl('/api/project')))
    const readinessRes = await app.fetch(new Request(projectUrl('/api/project/release-readiness')))
    const projectBody = await projectRes.json() as any
    const readinessBody = await readinessRes.json() as any

    expect(projectBody.orientationSpine.selectedRelease.nodeIds).toEqual(['work:task-done'])
    expect(projectBody.orientationSpine.summary.includedWorkCount).toBe(1)
    expect(readinessBody.scope.nodeIds).toEqual(['work:task-done'])
    expect(readinessBody.totals.tasks).toBe(1)
    expect(readinessBody.statusCounts).toEqual({ done: 1 })
    expect(readinessBody.releaseBlockers).toEqual([])
    expect(readinessBody.totals.unfinishedCount).toBe(0)
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
    await fs.mkdir(path.join(tmpDir, '.guildhall'), { recursive: true })
    await fs.writeFile(path.join(tmpDir, '.guildhall', 'release-note.md'), 'unlanded Guildhall note\n', 'utf8')

    const res = await app.fetch(new Request(projectUrl('/api/project/release-readiness')))
    const body = await res.json() as any

    expect(body.ready).toBe(false)
    expect(body.dirtyCheckout.ownedCount).toBe(1)
    expect(body.dirtyCheckout.files).toEqual(['.guildhall/release-note.md'])
    expect(body.totals.dirtyCheckoutBlockingCount).toBe(1)
    expect(body.releaseBlockers).toEqual([
      expect.objectContaining({
        id: 'dirty-checkout',
        title: 'Project checkout',
        label: '1 Guildhall-managed checkout file needs cleanup or landing.',
      }),
    ])
  })

  it('does not block current work closure on exploring scratch files', async () => {
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
    await fs.mkdir(path.join(tmpDir, '.guildhall', 'exploring'), { recursive: true })
    await fs.writeFile(path.join(tmpDir, '.guildhall', 'exploring', 'task-workspace-import.md'), 'scratch importer transcript\n', 'utf8')

    const res = await app.fetch(new Request(projectUrl('/api/project/release-readiness')))
    const body = await res.json() as any

    expect(body.dirtyCheckout.ownedCount).toBe(0)
    expect(body.dirtyCheckout.files).toEqual([])
    expect(body.totals.dirtyCheckoutBlockingCount).toBe(0)
  })

  it('inspects child repos for a non-git workspace envelope', async () => {
    const envelopePath = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-release-envelope-'))
    const taskWorktreePath = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-release-envelope-task-worktree-'))
    try {
      const envelopeId = bootstrapWorkspace(envelopePath, { name: 'Release Envelope Fixture' }).id ?? path.basename(envelopePath)
      await initChildRepo(path.join(envelopePath, 'looma'))
      await initChildRepo(path.join(envelopePath, 'knit'))
      await initChildRepo(taskWorktreePath)
      await fs.writeFile(path.join(taskWorktreePath, 'task-only.txt'), 'task worktree change\n', 'utf8')
      await fs.writeFile(path.join(envelopePath, 'knit', '.gitignore'), 'node_modules\n', 'utf8')
      const queue: TaskQueue = {
        version: 1,
        lastUpdated: new Date().toISOString(),
        tasks: [
          {
            ...makeTask({
              id: 'task-workspace-import',
              title: 'Review existing project work',
              status: 'done',
              completedAt: '2026-05-08T00:00:00Z',
            }),
            projectPath: envelopePath,
          },
          {
            ...makeTask({
              id: 'task-envelope-1',
              title: 'Completed envelope task',
              status: 'done',
              completedAt: '2026-05-09T00:00:00Z',
            }),
            projectPath: envelopePath,
          },
          {
            ...makeTask({
              id: 'task-looma-worktree',
              title: 'Looma task worktree',
              status: 'ready',
            }),
            projectPath: path.join(envelopePath, 'looma'),
            worktreePath: taskWorktreePath,
          },
        ],
      }
      await writeProjectStateJsonAsync(envelopePath, 'TASKS.json', queue)
      const { app } = buildServeApp({ projectPath: envelopePath })
      const url = new URL('http://localhost/api/project/release-readiness')
      url.searchParams.set('projectId', envelopeId)

      const res = await app.fetch(new Request(url))
      const body = await res.json() as any

      expect(res.status).toBe(200)
      expect(body.dirtyCheckout).toMatchObject({
        ownedCount: 1,
        files: ['knit/.gitignore'],
      })
      expect(body.dirtyCheckout.error).toBeUndefined()
      expect(JSON.stringify(body)).not.toContain('not a git repository')
      const repoIds = body.gitStory.snapshots.map((snapshot: any) => snapshot.repoId)
      expect(new Set(repoIds)).toEqual(new Set(['knit', 'looma']))
      expect(repoIds.every((repoId: string | undefined) => repoId === 'knit' || repoId === 'looma')).toBe(true)
      const taskSnapshot = body.gitStory.snapshots.find((snapshot: any) => snapshot.taskId === 'task-looma-worktree')
      expect(taskSnapshot).toMatchObject({
        taskId: 'task-looma-worktree',
        inspectedPath: taskWorktreePath,
        state: 'dirty_uncommitted',
      })

      const projectRes = await app.fetch(new Request(`http://localhost/api/project?projectId=${encodeURIComponent(envelopeId)}`))
      const projectBody = await projectRes.json() as any
      expect(projectRes.status).toBe(200)
      expect(JSON.stringify(projectBody)).not.toContain('not a git repository')
      expect(projectBody.releaseReadiness).toMatchObject({
        ready: body.ready,
        totals: {
          dirtyCheckoutBlockingCount: body.totals.dirtyCheckoutBlockingCount,
        },
      })
      expect(projectBody.releaseReadiness.totals.gitStoryBlockingCount).toBeGreaterThan(0)
      const projectRepoIds = new Set(projectBody.releaseReadiness.gitStory.snapshots.map((snapshot: any) => snapshot.repoId))
      expect(projectRepoIds.has('knit')).toBe(true)
      expect(projectRepoIds.has('looma')).toBe(true)
      expect(projectBody.releaseReadiness.gitStory.snapshots.map((snapshot: any) => snapshot.state)).not.toContain('not_git')
      expect(projectBody.tasks.find((task: any) => task.id === 'task-workspace-import')?.gitStory).toBeUndefined()
      expect(projectBody.tasks.find((task: any) => task.id === 'task-looma-worktree')?.gitStory).toMatchObject({
        inspectedPath: taskWorktreePath,
        state: 'dirty_uncommitted',
      })

      const spineRes = await app.fetch(new Request(`http://localhost/api/project/spine?projectId=${encodeURIComponent(envelopeId)}`))
      const spineBody = await spineRes.json() as any
      expect(spineRes.status).toBe(200)
      expect(projectBody.orientationSpine.release.blockers.map((blocker: any) => blocker.id)).toEqual(
        body.releaseBlockers.map((blocker: any) => blocker.id),
      )
      expect(spineBody.spine.release.blockers.map((blocker: any) => blocker.id)).toEqual(
        body.releaseBlockers.map((blocker: any) => blocker.id),
      )
    } finally {
      await fs.rm(envelopePath, { recursive: true, force: true })
      await fs.rm(taskWorktreePath, { recursive: true, force: true })
    }
  }, 20000)

  it('does not let deferred fallback-scope shelves block current work closure', async () => {
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
    expect(body.shelvedUnclaimed).toEqual([])
    expect(body.blockedByAgent.map((b: any) => b.id)).toEqual(['task-1'])
    expect(body.totals.humanBlockingCount).toBe(1)
    expect(body.totals.blockingCount).toBe(1)
    expect(body.totals.unfinishedCount).toBe(1)
  })

  it('keeps blocked proof recovery out of completed proof-missing rows', async () => {
    await seed([
      makeTask({
        id: 'task-current',
        title: 'Select and prove a DeepInfra drafting model',
        status: 'blocked',
        blockReason: 'max_revisions_exceeded: Worker hit its turn budget while creating proof.',
        proofPaths: [{
          kind: 'review',
          expectedEvidence: [
            'DeepInfra drafting telemetry recorded refusal behavior, cost, latency, and voice preservation.',
          ],
        }],
        doneSummaryBundle: {
          status: 'done',
          completedAt: '2026-07-06T20:00:00.000Z',
          summary: {
            evidence: 'content.no-truncated-data passed.',
          },
        },
        gateResults: [{
          gateId: 'content.no-truncated-data',
          passed: true,
          output: 'no truncated content',
          checkedAt: '2026-07-06T20:00:00.000Z',
        }],
        reviewVerdicts: [{
          verdict: 'approve',
          reasoning: 'All acceptance criteria are met.',
          recordedAt: '2026-07-06T20:00:00.000Z',
        }],
        escalations: [{
          id: 'esc-1',
          taskId: 'task-current',
          agentId: 'coordinator',
          reason: 'max_revisions_exceeded',
          summary: 'Worker hit its turn budget while creating proof.',
          raisedAt: '2026-07-06T20:10:00.000Z',
        }],
      } as Partial<Task>),
    ])
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/release-readiness')))
    const body = await res.json() as any

    expect(body.proofMissingDoneTasks).toEqual([])
    expect(body.openEscalations).toEqual([expect.objectContaining({
      taskId: 'task-current',
      escalationId: 'esc-1',
      reason: 'max_revisions_exceeded',
    })])
    expect(body.blockedByAgent.map((task: any) => task.id)).toEqual(['task-current'])
    expect(body.statusCounts).toMatchObject({ blocked: 1 })
    expect(body.totals).toMatchObject({
      done: 0,
      unfinishedCount: 1,
      humanBlockingCount: 1,
      proofEvidenceBlockingCount: 0,
    })
  })

  it('collapses repeated active escalations for the same task and reason in release readiness', async () => {
    const now = new Date().toISOString()
    await seed([
      makeTask({
        id: 'task-1',
        title: 'Has repeated escalations',
        status: 'blocked',
        blockReason: 'escalation pending',
        escalations: [
          {
            id: 'esc-1',
            taskId: 'task-1',
            agentId: 'agent:spec-agent',
            reason: 'decision_required',
            summary: 'Build failing due to unresolved import in packages/core/loader/index.js',
            raisedAt: now,
          },
          {
            id: 'esc-2',
            taskId: 'task-1',
            agentId: 'agent:spec-agent',
            reason: 'decision_required',
            summary: 'Build failing due to unresolved import in packages/core/loader/index.js',
            raisedAt: now,
          },
          {
            id: 'esc-3',
            taskId: 'task-1',
            agentId: 'agent:spec-agent',
            reason: 'decision_required',
            summary: 'A separate decision is needed.',
            raisedAt: now,
          },
        ],
      }),
    ])
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/release-readiness')))
    const body = await res.json() as any

    expect(body.openEscalations).toHaveLength(2)
    expect(body.openEscalations.map((item: any) => item.escalationId)).toEqual(['esc-1', 'esc-3'])
    expect(body.openEscalations.map((item: any) => item.summary)).toEqual([
      'Build failing due to unresolved import in packages/core/loader/index.js',
      'A separate decision is needed.',
    ])
    expect(body.totals.humanBlockingCount).toBe(1)
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
      projectStatePath(tmpDir, 'codebase-map.yaml'),
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

  it('summarizes immediate child git repositories when the attached path is only a container', async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-release-container-'))
    const loomaDir = path.join(workspaceDir, 'looma')
    const knitDir = path.join(workspaceDir, 'knit')
    try {
      const containerProjectId = bootstrapWorkspace(workspaceDir, { name: 'Looma + Knit' }).id ?? path.basename(workspaceDir)
      for (const childDir of [loomaDir, knitDir]) {
        await fs.mkdir(childDir, { recursive: true })
        await execFileP('git', ['init', '-b', 'main'], { cwd: childDir })
        await execFileP('git', ['config', 'user.email', 'guildhall@example.test'], { cwd: childDir })
        await execFileP('git', ['config', 'user.name', 'Guildhall Test'], { cwd: childDir })
        await fs.writeFile(path.join(childDir, 'README.md'), `# ${path.basename(childDir)}\n`, 'utf8')
        await execFileP('git', ['add', '.'], { cwd: childDir })
        await execFileP('git', ['commit', '-m', `baseline ${path.basename(childDir)}`], { cwd: childDir })
      }
      const { app } = buildServeApp({ projectPath: workspaceDir })
      const url = new URL('http://localhost/api/project/release-readiness')
      url.searchParams.set('projectId', containerProjectId)

      const res = await app.fetch(new Request(url))
      const body = await res.json() as any

      const repoLabels = new Set(
        body.gitStory.snapshots.map((snapshot: any) => String(snapshot.repoLabel).toLowerCase()),
      )
      expect(repoLabels).toEqual(new Set(['knit', 'looma']))
      expect(body.gitStory.snapshots.map((snapshot: any) => snapshot.state)).not.toContain('not_git')
    } finally {
      await fs.rm(workspaceDir, { recursive: true, force: true })
    }
  })
})
