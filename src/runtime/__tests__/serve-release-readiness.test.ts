import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { bootstrapWorkspace, slugify } from '@guildhall/config'
import type { Task, TaskQueue } from '@guildhall/core'
import { projectStatePath, writeProjectStateJsonAsync, writeProjectStateTextAsync } from '@guildhall/sessions'
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

    expect(body.release).toMatchObject({ id: 'near-term-proof', proofStyle: 'unspecified' })
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
        state: 'active',
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
        label: 'Headless MVP',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        nodeIds: ['work:task-current'],
        deferredNodeIds: ['work:task-archived'],
        proofStyle: 'script_only',
      }],
      tasks: [
        makeTask({ id: 'task-current', title: 'Current proof lane', status: 'done', releaseIds: ['headless-mvp'] }),
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
        makeTask({ id: 'task-current', title: 'Current proof lane', status: 'done', releaseIds: ['headless-mvp'] }),
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

  it('accepts recorded completion proof even when imported proof paths lack inline verification records', async () => {
    const importedProofPath = {
      kind: 'review',
      source: 'inferred',
      expectedEvidence: ['The fixture proof is visible in recorded completion evidence.'],
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
      label: 'Needs proof',
      startEnabled: false,
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
  })

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
