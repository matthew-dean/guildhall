import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { bootstrapWorkspace, writeWorkspaceConfig } from '@guildhall/config'
import {
  getProjectContextDebugLedgerPath,
  getProjectRecentEventsPath,
  getProjectStateDir,
} from '@guildhall/sessions'
import { readExploringTranscript, writeCheckpoint } from '@guildhall/tools'
import { buildServeApp, filterEventsForTask } from '../serve.js'
import { createReviewAuditStore } from '../review-audit-store.js'
import { FileBackedGuildhallPersistence } from '@guildhall/persistence'

// Integration tests for the v0.2 UI endpoints:
//   GET  /api/project/task/:id        — per-task detail powering the drawer
//   POST /api/project/task/:id/hold   — human hold → blocked, reversible
//   POST /api/project/task/:id/shelve — human override → shelved
//   GET  /api/project/activity        — summary for the persistent chip

let tmpDir: string
let memoryDir: string
let projectId: string

function projectUrl(route: string): string {
  const url = new URL(`http://localhost${route}`)
  url.searchParams.set('projectId', projectId)
  return url.toString()
}

async function seedTask(id: string, overrides: Record<string, any> = {}): Promise<void> {
  const tasksPath = path.join(memoryDir, 'TASKS.json')
  const queue = {
    version: 1,
    lastUpdated: new Date().toISOString(),
    tasks: [
      {
        id,
        title: 'Seeded task for tests',
        description: 'A test task',
        domain: 'looma',
        projectPath: tmpDir,
        status: 'in_progress',
        priority: 'normal',
        revisionCount: 0,
        remediationAttempts: 0,
        origination: 'human',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...overrides,
      },
    ],
  }
  await fs.writeFile(tasksPath, JSON.stringify(queue, null, 2), 'utf8')
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-serve-tasks-'))
  process.env.GUILDHALL_DATA_DIR = path.join(tmpDir, '.guildhall-data')
  projectId = bootstrapWorkspace(tmpDir, { name: 'Task Endpoints Test' }).id ?? path.basename(tmpDir)
  memoryDir = getProjectStateDir(tmpDir)
})

afterEach(async () => {
  delete process.env.GUILDHALL_DATA_DIR
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('GET /api/project/task/:id', () => {
  it('returns the task body + (empty) recent events for a seeded task', async () => {
    await seedTask('task-1')
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/task/task-1')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.task?.id).toBe('task-1')
    expect(body.task?.status).toBe('in_progress')
    expect(Array.isArray(body.recentEvents)).toBe(true)
    expect(Array.isArray(body.contextDebug)).toBe(true)
  })

  it('heals stale worker ownership for in_progress tasks when reading task detail', async () => {
    await seedTask('task-1', { assignedTo: null })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/task/task-1')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.task?.assignedTo).toBe('worker-agent')

    const raw = JSON.parse(await fs.readFile(path.join(memoryDir, 'TASKS.json'), 'utf8')) as Record<string, any>
    expect(raw.tasks[0]?.assignedTo).toBe('worker-agent')
  })

  it('returns recent context debug records for the task', async () => {
    await seedTask('task-1')
    const ledgerPath = getProjectContextDebugLedgerPath(tmpDir)
    await fs.mkdir(path.dirname(ledgerPath), { recursive: true })
    await fs.writeFile(
      ledgerPath,
      [
        JSON.stringify({
          id: 'older',
          taskId: 'task-1',
          agentName: 'worker-agent',
          modelId: 'qwen/test',
          promptPreview: 'older prompt',
          at: '2026-05-02T00:00:00.000Z',
          sections: [],
          health: [],
          reasons: [],
        }),
        JSON.stringify({
          id: 'newer',
          taskId: 'task-1',
          agentName: 'reviewer-agent',
          modelId: 'qwen/test',
          promptPreview: 'newer prompt',
          at: '2026-05-02T00:01:00.000Z',
          sections: [],
          health: [],
          reasons: [],
        }),
      ].join('\n') + '\n',
      'utf8',
    )
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/task/task-1')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.contextDebug?.map((record: Record<string, any>) => record.id)).toEqual([
      'newer',
      'older',
    ])
  })

  it('includes a stored review plan in the task drawer payload', async () => {
    await seedTask('task-1', { status: 'review' })
    const store = createReviewAuditStore({
      projectRoot: tmpDir,
      persistence: new FileBackedGuildhallPersistence(),
      now: () => new Date('2026-05-25T12:00:00.000Z'),
    })
    await store.saveReviewPlan({
      taskId: 'task-1',
      effort: 'balanced',
      depth: 'standard',
      selectedLanes: ['ux_comprehension', 'test_adequacy'],
      requiredRecipes: [{
        recipeId: 'product-ux-zero-context',
        version: 'v1',
        lanes: ['ux_comprehension'],
        blocking: 'high',
        required: true,
        calibrationRecipeIds: ['ux-zero-context-comprehension'],
      }],
      budget: { maxReviewerAgents: 4, maxWallClockMinutes: 18 },
      createdBy: 'coordinator-review-planner',
    })

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/task/task-1')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>

    expect(body.task?.reviewPlan).toMatchObject({
      taskId: 'task-1',
      effort: 'balanced',
      depth: 'standard',
      selectedLanes: ['ux_comprehension', 'test_adequacy'],
      budget: { maxReviewerAgents: 4, maxWallClockMinutes: 18 },
    })
  })

  it('includes a compact review audit summary in the task drawer payload', async () => {
    await seedTask('task-1', { status: 'review' })
    const store = createReviewAuditStore({
      projectRoot: tmpDir,
      persistence: new FileBackedGuildhallPersistence(),
      now: () => new Date('2026-05-25T12:00:00.000Z'),
    })
    await store.saveReviewerRun({
      taskId: 'task-1',
      recipeId: 'product-ux-zero-context',
      recipeVersion: 'v1',
      lanes: ['ux_comprehension'],
      verdict: 'revise',
      findings: [{
        lane: 'ux_comprehension',
        severity: 'high',
        summary: 'Primary action is ambiguous.',
      }],
      recordedAt: '2026-05-25T12:01:00.000Z',
      recordedBy: 'reviewer-fanout:component-designer',
    })
    await store.saveReviewerRun({
      taskId: 'task-1',
      recipeId: 'product-ux-zero-context',
      recipeVersion: 'v1',
      lanes: ['copy_clarity'],
      verdict: 'approve',
      recordedAt: '2026-05-25T12:02:00.000Z',
      recordedBy: 'reviewer-fanout:copywriter',
    })
    await store.linkEscapedMiss({
      taskId: 'task-1',
      missedLane: 'ux_comprehension',
      humanFinding: 'Reviewer missed that the setup action was unclear.',
      nextCalibrationAction: 'create_case',
      recordedBy: 'human:test',
    })

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/task/task-1')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>

    expect(body.task?.reviewAuditSummary).toEqual({
      reviewerRunCount: 2,
      reviseCount: 1,
      escapedMissCount: 1,
      latestReviewerRunAt: '2026-05-25T12:02:00.000Z',
    })
  })

  it('returns the exploring transcript artifact for the task drawer', async () => {
    await seedTask('task-1')
    await fs.mkdir(path.join(memoryDir, 'exploring'), { recursive: true })
    await fs.writeFile(
      path.join(memoryDir, 'exploring', 'task-1.md'),
      [
        '# Exploring transcript: task-1',
        '',
        '## [2026-05-19T23:48:34.395Z] system',
        '',
        'Imported from project notes. Turn this into a complete task.',
        '',
        '---',
        '## [2026-05-19T23:49:39.164Z] spec-agent',
        '',
        'Let me find the source note first.',
        '',
        '---',
      ].join('\n'),
      'utf8',
    )

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/task/task-1')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.exploringTranscript?.path).toBe(path.join(memoryDir, 'exploring', 'task-1.md'))
    expect(body.exploringTranscript?.content).toContain('Let me find the source note first.')
  })

  it('filters stale acceptance-note transcript entries that no longer match canonical criteria', async () => {
    await seedTask('task-1', {
      acceptanceCriteria: [
        {
          id: 'ac-1',
          description: 'Redirects to /<slug> when membership resolves.',
          verifiedBy: 'review',
          met: false,
        },
      ],
      notes: [
        {
          agentId: 'human',
          role: 'specifier',
          timestamp: new Date(Date.now() - 60_000).toISOString(),
          content: 'Added acceptance criterion: Redirects to /.',
        },
        {
          agentId: 'human',
          role: 'specifier',
          timestamp: new Date(Date.now() - 30_000).toISOString(),
          content: 'Added acceptance criterion: Redirects to /<slug> when membership resolves.',
        },
        {
          agentId: 'reviewer-agent',
          role: 'reviewer',
          timestamp: new Date().toISOString(),
          content: 'Keep the /signup fallback explicit.',
        },
      ],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/task/task-1')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.task?.notes).toHaveLength(2)
    expect(body.task?.notes?.map((note: Record<string, any>) => note.content)).toEqual([
      'Added acceptance criterion: Redirects to /<slug> when membership resolves.',
      'Keep the /signup fallback explicit.',
    ])
  })

  it('surfaces derived reviewer, self-critique, and checkpoint summaries', async () => {
    await seedTask('task-1', {
      status: 'review',
      notes: [
        {
          agentId: 'worker-agent',
          role: 'self-critique',
          timestamp: new Date(Date.now() - 60_000).toISOString(),
          content: 'Self-critique: focused use-collections tests are green.',
        },
        {
          agentId: 'reviewer-fanout',
          role: 'reviewer',
          timestamp: new Date().toISOString(),
          content: '**Aggregated revisions from 2 personas:**\n\nNeed direct file excerpts in the packet.',
        },
      ],
    })
    await writeCheckpoint({
      tasksPath: path.join(memoryDir, 'TASKS.json'),
      memoryDir,
      taskId: 'task-1',
      agentId: 'worker-agent',
      intent: 'Verify focused unit tests',
      nextPlannedAction: 'Hand off to review',
      filesTouched: ['web/tests/unit/composables/use-collections.test.ts'],
    })

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/task/task-1')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.task?.latestReviewerSummary).toContain('Aggregated revisions')
    expect(body.task?.latestSelfCritique).toContain('focused use-collections tests are green')
    expect(body.task?.latestCheckpoint?.intent).toBe('Verify focused unit tests')
    expect(body.task?.latestCheckpoint?.nextPlannedAction).toBe('Hand off to review')
  })

  it('hides stale reviewer summaries after a max-revisions retry was resolved', async () => {
    await seedTask('task-1', {
      status: 'in_progress',
      notes: [
        {
          agentId: 'reviewer-fanout',
          role: 'reviewer',
          timestamp: '2026-05-09T01:00:00.000Z',
          content: 'Recommended task-local revisions:\n- Add broad platform ceremony.',
        },
      ],
      escalations: [
        {
          id: 'esc-task-1-3',
          taskId: 'task-1',
          agentId: 'reviewer-fanout',
          reason: 'max_revisions_exceeded',
          summary: 'Exceeded maxRevisions (3). Reviewer fan-out keeps rejecting.',
          raisedAt: '2026-05-09T01:02:00.000Z',
          resolvedAt: '2026-05-09T01:05:00.000Z',
          resolvedBy: 'human',
          resolution: 'Retry with narrower reviewer scope.',
        },
      ],
    })

    const { app } = buildServeApp({ projectPath: tmpDir })
    const detailRes = await app.fetch(new Request(projectUrl('/api/project/task/task-1')))
    expect(detailRes.status).toBe(200)
    const detailBody = (await detailRes.json()) as Record<string, any>
    expect(detailBody.task?.latestReviewerSummary).toBeUndefined()

    const projectRes = await app.fetch(new Request(projectUrl('/api/project')))
    expect(projectRes.status).toBe(200)
    const projectBody = (await projectRes.json()) as Record<string, any>
    const task = projectBody.tasks?.find((entry: Record<string, any>) => entry.id === 'task-1')
    expect(task?.latestReviewerSummary).toBeUndefined()
  })

  it('includes derived reviewer/self-critique/checkpoint summaries on /api/project task rows too', async () => {
    await seedTask('task-1', {
      status: 'review',
      notes: [
        {
          agentId: 'worker-agent',
          role: 'self-critique',
          timestamp: new Date(Date.now() - 60_000).toISOString(),
          content: 'Self-critique: focused use-collections tests are green.',
        },
        {
          agentId: 'reviewer-fanout',
          role: 'reviewer',
          timestamp: new Date().toISOString(),
          content: '**Aggregated revisions from 2 personas:**\n\nNeed direct file excerpts in the packet.',
        },
      ],
    })
    await writeCheckpoint({
      tasksPath: path.join(memoryDir, 'TASKS.json'),
      memoryDir,
      taskId: 'task-1',
      agentId: 'worker-agent',
      intent: 'Verify focused unit tests',
      nextPlannedAction: 'Hand off to review',
      filesTouched: ['web/tests/unit/composables/use-collections.test.ts'],
    })

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    const task = body.tasks?.find((entry: Record<string, any>) => entry.id === 'task-1')
    expect(task?.latestReviewerSummary).toContain('Aggregated revisions')
    expect(task?.latestSelfCritique).toContain('focused use-collections tests are green')
    expect(task?.latestCheckpoint?.intent).toBe('Verify focused unit tests')
  })

  it('derives terminal summaries from merge records on task detail and project rows', async () => {
    await seedTask('task-1', {
      status: 'done',
      completedAt: '2026-05-08T18:48:00.000Z',
      mergeRecord: {
        fromBranch: 'guildhall/task-1',
        toBranch: 'main',
        strategy: 'cherry_pick_local',
        result: 'merged',
        commitSha: 'abc123',
        mergedAt: '2026-05-08T18:47:00.000Z',
      },
    })

    const { app } = buildServeApp({ projectPath: tmpDir })
    const detailRes = await app.fetch(new Request(projectUrl('/api/project/task/task-1')))
    expect(detailRes.status).toBe(200)
    const detailBody = (await detailRes.json()) as Record<string, any>
    expect(detailBody.task?.terminalSummary?.headline).toBe('Merged locally into main.')

    const projectRes = await app.fetch(new Request(projectUrl('/api/project')))
    expect(projectRes.status).toBe(200)
    const projectBody = (await projectRes.json()) as Record<string, any>
    const task = projectBody.tasks?.find((entry: Record<string, any>) => entry.id === 'task-1')
    expect(task?.terminalSummary?.headline).toBe('Merged locally into main.')
  })

  it('explains skipped automatic merges truthfully for done tasks', async () => {
    await seedTask('task-1', {
      status: 'done',
      mergeRecord: {
        fromBranch: '<unknown>',
        toBranch: '<unknown>',
        strategy: 'cherry_pick_local',
        result: 'skipped',
        mergedAt: '2026-05-08T18:47:00.000Z',
        detail: 'worktree isolation disabled — merge skipped',
      },
    })

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/task/task-1')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.task?.terminalSummary?.headline).toBe(
      'Task completed without an automatic merge.',
    )
    expect(body.task?.terminalSummary?.detail).toBe(
      'worktree isolation disabled — merge skipped',
    )
  })

  it('derives self-critique summaries from worker-role notes when the content is explicitly labeled', async () => {
    await seedTask('task-1', {
      status: 'review',
      notes: [
        {
          agentId: 'worker-agent',
          role: 'Worker',
          timestamp: new Date(Date.now() - 60_000).toISOString(),
          content: '**Self-critique:** focused use-workspace verification passed.',
        },
      ],
    })

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/task/task-1')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.task?.latestSelfCritique).toContain('focused use-workspace verification passed')
  })

  it('derives self-critique summaries from implementer-role notes when the content is explicitly labeled', async () => {
    await seedTask('task-1', {
      status: 'review',
      notes: [
        {
          agentId: 'worker-agent',
          role: 'implementer',
          timestamp: new Date(Date.now() - 60_000).toISOString(),
          content: '**Self-critique:** focused use-presence verification passed.',
        },
      ],
    })

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/task/task-1')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.task?.latestSelfCritique).toContain('focused use-presence verification passed')
  })

  it('derives self-critique summaries from worker persona-role notes when the content is explicitly labeled', async () => {
    await seedTask('task-1', {
      status: 'review',
      notes: [
        {
          agentId: 'worker-agent',
          role: 'Backend Engineer',
          timestamp: new Date(Date.now() - 60_000).toISOString(),
          content: '**Self-critique:** focused restore handler verification passed.',
        },
      ],
    })

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/task/task-1')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.task?.latestSelfCritique).toContain('focused restore handler verification passed')
  })

  it('normalizes stale checkpoint self-critique instructions when a worker persona-role note already exists', async () => {
    await seedTask('task-1', {
      status: 'in_progress',
      notes: [
        {
          agentId: 'worker-agent',
          role: 'Backend Engineer',
          timestamp: new Date(Date.now() - 60_000).toISOString(),
          content: '**Self-critique:** focused restore handler verification passed.',
        },
      ],
    })
    await writeCheckpoint({
      tasksPath: path.join(memoryDir, 'TASKS.json'),
      memoryDir,
      taskId: 'task-1',
      agentId: 'worker-agent',
      intent: 'Worker recovery checkpoint after verified progress.',
      nextPlannedAction: "Write or refresh self-critique note, then transition task to 'review'",
      filesTouched: ['web/server/api/pages/[id]/restore.post.ts'],
    })

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/task/task-1')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
  expect(body.task?.latestCheckpoint?.nextPlannedAction).toBe(
    'Resume from the latest self-critique and recorded verification evidence, then hand off to review.',
  )
})

it('hides placeholder checkpoint next-action values in task detail responses', async () => {
  await seedTask('task-1', {
    status: 'in_progress',
  })
  await writeCheckpoint({
    tasksPath: path.join(memoryDir, 'TASKS.json'),
    memoryDir,
    taskId: 'task-1',
    agentId: 'worker-agent',
    intent: 'Resume implementation',
    nextPlannedAction: 'None',
    filesTouched: ['web/server/api/pages/[id]/restore.post.ts'],
  })

  const { app } = buildServeApp({ projectPath: tmpDir })
  const res = await app.fetch(new Request(projectUrl('/api/project/task/task-1')))
  expect(res.status).toBe(200)
  const body = (await res.json()) as Record<string, any>
  expect(body.task?.latestCheckpoint?.nextPlannedAction).toBeNull()
})

  it('returns 404 when task id is unknown', async () => {
    await seedTask('task-1')
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/task/missing')))
    expect(res.status).toBe(404)
  })
})

describe('POST /api/project/task/:id/git-story/:closureAction', () => {
  it('uses the matching workspace child gitStory policy for task git actions', async () => {
    const loomaPath = path.join(tmpDir, 'looma')
    await fs.mkdir(loomaPath, { recursive: true })
    writeWorkspaceConfig(tmpDir, {
      name: 'Task Endpoints Test',
      id: projectId,
      kind: 'workspace',
      projects: [
        {
          id: 'looma',
          path: 'looma',
          gitStory: {
            completionTarget: 'open_pr',
            commit: 'never',
            push: 'ask',
            pullRequest: 'ask',
            merge: 'ask',
            localOnlyAllowed: true,
            deferAllowed: true,
            requireCleanRelease: true,
            allowForcePush: false,
            allowSharedBranchRebase: false,
            discoveredFrom: [],
          },
        },
      ],
    } as any)
    await seedTask('task-1', { status: 'done', domain: 'looma', projectPath: loomaPath })
    const { app } = buildServeApp({ projectPath: tmpDir })

    const res = await app.fetch(new Request(projectUrl('/api/project/task/task-1/git-story/commit'), {
      method: 'POST',
      body: JSON.stringify({ confirmed: true, message: 'test', files: ['src/a.ts'] }),
      headers: { 'content-type': 'application/json' },
    }))

    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: 'Project policy disables commit.' })
  })

  it('records a local-only git story override with a required reason', async () => {
    await seedTask('task-1', { status: 'done' })
    const { app } = buildServeApp({ projectPath: tmpDir })

    const missingReason = await app.fetch(new Request(projectUrl('/api/project/task/task-1/git-story/local-only'), {
      method: 'POST',
      body: JSON.stringify({ reason: '' }),
      headers: { 'content-type': 'application/json' },
    }))
    expect(missingReason.status).toBe(400)

    const res = await app.fetch(new Request(projectUrl('/api/project/task/task-1/git-story/local-only'), {
      method: 'POST',
      body: JSON.stringify({ reason: 'Fixture-only scratch work.' }),
      headers: { 'content-type': 'application/json' },
    }))
    expect(res.status).toBe(200)

    const raw = JSON.parse(await fs.readFile(path.join(memoryDir, 'TASKS.json'), 'utf8')) as Record<string, any>
    expect(raw.tasks[0]?.gitStory).toMatchObject({
      override: 'local_only',
      reason: 'Fixture-only scratch work.',
      recordedBy: 'user',
    })
  })
})

describe('filterEventsForTask (drawer live feed)', () => {
  it('matches wire-protocol snake_case task_id', () => {
    const events = [
      { event: { type: 'task_transition', task_id: 't1', from_status: 'ready', to_status: 'in_progress' } },
      { event: { type: 'task_transition', task_id: 't2', from_status: 'ready', to_status: 'in_progress' } },
      { event: { type: 'supervisor_started' } }, // no task_id
    ]
    expect(filterEventsForTask(events, 't1')).toHaveLength(1)
    expect(filterEventsForTask(events, 't2')).toHaveLength(1)
    expect(filterEventsForTask(events, 'none')).toHaveLength(0)
  })

  it('also matches legacy camelCase taskId shapes', () => {
    const events = [{ event: { type: 'agent_note', taskId: 't9', content: 'hi' } }]
    expect(filterEventsForTask(events, 't9')).toHaveLength(1)
  })
})

describe('GET /api/project/task/:id/file', () => {
  it('reads a changed file from the task workspace and rejects directories', async () => {
    await fs.mkdir(path.join(tmpDir, 'frontend', 'app', 'pages'), { recursive: true })
    await fs.mkdir(path.join(tmpDir, 'frontend', 'app', 'lib'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'frontend', 'app', 'pages', 'dashboard.vue'),
      '<template>Dashboard</template>\n',
      'utf8',
    )
    await seedTask('task-1', {
      latestCheckpoint: {
        filesTouched: [
          'frontend/app/pages/dashboard.vue',
          'frontend/app/lib/',
        ],
      },
    })
    const { app } = buildServeApp({ projectPath: tmpDir })

    const fileUrl = new URL(projectUrl('/api/project/task/task-1/file'))
    fileUrl.searchParams.set('path', 'frontend/app/pages/dashboard.vue')
    const fileRes = await app.fetch(new Request(fileUrl.toString()))

    expect(fileRes.status).toBe(200)
    const fileBody = (await fileRes.json()) as Record<string, any>
    expect(fileBody).toMatchObject({
      taskId: 'task-1',
      path: 'frontend/app/pages/dashboard.vue',
      content: '<template>Dashboard</template>\n',
      language: 'vue',
      truncated: false,
    })

    const dirUrl = new URL(projectUrl('/api/project/task/task-1/file'))
    dirUrl.searchParams.set('path', 'frontend/app/lib/')
    const dirRes = await app.fetch(new Request(dirUrl.toString()))

    expect(dirRes.status).toBe(400)
    await expect(dirRes.json()).resolves.toMatchObject({ error: 'path is not a file' })
  })

  it('keeps file reads inside the project or task worktree', async () => {
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-outside-'))
    try {
      await fs.writeFile(path.join(outsideDir, 'secret.txt'), 'nope\n', 'utf8')
      await seedTask('task-1')
      const { app } = buildServeApp({ projectPath: tmpDir })
      const url = new URL(projectUrl('/api/project/task/task-1/file'))
      url.searchParams.set('path', path.join(outsideDir, 'secret.txt'))

      const res = await app.fetch(new Request(url.toString()))

      expect(res.status).toBe(400)
      await expect(res.json()).resolves.toMatchObject({ error: 'path is outside the task workspace' })
    } finally {
      await fs.rm(outsideDir, { recursive: true, force: true })
    }
  })
})

describe('POST /api/project/task/:id/hold|shelve', () => {
  it('puts a task on hold with a reason and can return it to its previous stage', async () => {
    await seedTask('task-1', { status: 'review' })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const holdRes = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/hold'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'Waiting for the design call.' }),
      }),
    )
    expect(holdRes.status).toBe(200)
    const body = (await holdRes.json()) as Record<string, any>
    expect(body.ok).toBe(true)
    expect(body.status).toBe('blocked')

    const raw = await fs.readFile(path.join(memoryDir, 'TASKS.json'), 'utf8')
    let q = JSON.parse(raw)
    expect(q.tasks[0].status).toBe('blocked')
    expect(q.tasks[0].blockReason).toBe('On hold: Waiting for the design call.')
    expect(q.tasks[0].hold).toMatchObject({
      previousStatus: 'review',
      reason: 'Waiting for the design call.',
      heldBy: 'human',
    })
    expect(q.tasks[0].notes?.at(-1)?.agentId).toBe('system:human')

    const resumeRes = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/resume-hold'), { method: 'POST' }),
    )
    expect(resumeRes.status).toBe(200)
    const resumeBody = (await resumeRes.json()) as Record<string, any>
    expect(resumeBody.status).toBe('review')

    q = JSON.parse(await fs.readFile(path.join(memoryDir, 'TASKS.json'), 'utf8'))
    expect(q.tasks[0].status).toBe('review')
    expect(q.tasks[0].hold).toBeUndefined()
    expect(q.tasks[0].blockReason).toBeUndefined()
  })

  it('shelve transitions to shelved with a shelveReason record', async () => {
    await seedTask('task-1')
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/shelve'), { method: 'POST' }),
    )
    expect(res.status).toBe(200)
    const raw = await fs.readFile(path.join(memoryDir, 'TASKS.json'), 'utf8')
    const q = JSON.parse(raw)
    expect(q.tasks[0].status).toBe('shelved')
    expect(q.tasks[0].shelveReason?.rejectedBy).toBe('system:human')
  })

  it('rejects hold on a done task', async () => {
    await seedTask('task-1', { status: 'done' })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/hold'), { method: 'POST' }),
    )
    expect(res.status).toBe(400)
  })

  it('rejects unknown actions', async () => {
    await seedTask('task-1')
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/nuke'), { method: 'POST' }),
    )
    expect(res.status).toBe(400)
  })
})

describe('POST /api/project/task/:id/mark-done', () => {
  it('marks a ready task done with human evidence and closes its checklist', async () => {
    await seedTask('task-1', {
      status: 'ready',
      assignedTo: null,
      blockReason: 'Old blocker',
      acceptanceCriteria: [
        { id: 'AC-1', description: 'Migrations are applied', verifiedBy: 'manual', met: false },
        { id: 'AC-2', description: 'Types are generated', verifiedBy: 'manual', met: false },
      ],
      escalations: [
        {
          id: 'esc-1',
          taskId: 'task-1',
          reason: 'environment_blocked',
          summary: 'Waiting on hosted database credentials',
          agentId: 'worker-agent',
          raisedAt: new Date().toISOString(),
        },
      ],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/mark-done'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ evidence: 'supabase db push reports remote database is up to date' }),
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.status).toBe('done')

    const raw = await fs.readFile(path.join(memoryDir, 'TASKS.json'), 'utf8')
    const q = JSON.parse(raw)
    const task = q.tasks[0]
    expect(task.status).toBe('done')
    expect(task.assignedTo).toBeNull()
    expect(task.blockReason).toBeUndefined()
    expect(task.acceptanceCriteria.every((criterion: Record<string, any>) => criterion.met === true)).toBe(true)
    expect(task.escalations[0].resolvedBy).toBe('human')
    expect(task.notes.at(-1).content).toMatch(/supabase db push/)
    expect(task.doneSummaryBundle).toMatchObject({
      taskId: 'task-1',
      status: 'done',
      retention: {
        transcriptPrimaryArtifact: false,
      },
    })
    expect(task.doneSummaryBundle.summary.decision).toMatch(/Task finished as done/)
  })

  it('rejects mark-done on active execution stages', async () => {
    await seedTask('task-1', { status: 'in_progress' })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/mark-done'), { method: 'POST' }),
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, any>
    expect(body.error).toMatch(/active run/i)
  })
})

describe('POST /api/project/task/:id/approve-spec', () => {
  it('transitions a spec_review task with a spec to ready and records the approvalNote', async () => {
    await seedTask('task-1', {
      status: 'spec_review',
      productBrief: {
        userJob: 'I want users to complete the invite flow without guessing what happens next.',
        successMetric: 'A user can accept an invite and land in the workspace.',
        approvedAt: '2026-05-26T00:00:00.000Z',
      },
      spec: [
        '## Summary',
        '',
        'Implement invite acceptance.',
        '',
        '## Completion Boundary',
        '- Product outcome: A user can accept an invite and land in the workspace.',
        '- What Guildhall can complete in code: Update the invite acceptance route and UI.',
        '- External dependencies: None.',
        '- Owner-only setup: None.',
        '- Verification environment: Local app with seeded invite data.',
        '- What counts as done: The seeded invite acceptance path succeeds end-to-end.',
        '- What must be split or blocked: Nothing.',
        '',
        '## Acceptance Criteria',
        '1. Given a valid invite, when the user accepts it, then they land in the workspace.',
      ].join('\n'),
      acceptanceCriteria: [
        {
          id: 'AC-1',
          description: 'Given a valid invite, when the user accepts it, then they land in the workspace.',
          verifiedBy: 'review',
          met: false,
        },
      ],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/approve-spec'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ approvalNote: 'Looks great, ship it' }),
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.ok).toBe(true)
    expect(body.status).toBe('ready')

    const raw = await fs.readFile(path.join(memoryDir, 'TASKS.json'), 'utf8')
    const q = JSON.parse(raw)
    expect(q.tasks[0].status).toBe('ready')
    expect(q.tasks[0].notes?.at(-1)?.content).toMatch(/ship it/i)
  })

  it('rejects approve-spec when the completion boundary is missing', async () => {
    await seedTask('task-1', {
      status: 'spec_review',
      productBrief: {
        userJob: 'I want users to sign in with familiar providers.',
        successMetric: 'Login shows provider buttons.',
        approvedAt: '2026-05-26T00:00:00.000Z',
      },
      spec: [
        '## Summary',
        '',
        'Add Google and Apple buttons to the login screen.',
        '',
        '## Acceptance Criteria',
        '1. Login and registration pages show Google and Apple buttons.',
      ].join('\n'),
      acceptanceCriteria: [
        {
          id: 'AC-1',
          description: 'Login and registration pages show Google and Apple buttons.',
          verifiedBy: 'review',
          met: false,
        },
      ],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/approve-spec'), { method: 'POST' }),
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, any>
    expect(body.error).toMatch(/completion boundary/i)
  })

  it('rejects approve-spec when external dependencies are named without an owner or blocked split', async () => {
    await seedTask('task-1', {
      status: 'spec_review',
      productBrief: {
        userJob: 'I want users to sign in with familiar providers.',
        successMetric: 'Google and Apple sign-in work.',
        approvedAt: '2026-05-26T00:00:00.000Z',
      },
      spec: [
        '## Summary',
        '',
        'Add provider sign-in.',
        '',
        '## Completion Boundary',
        '- Product outcome: A user can sign in with Google and Apple.',
        '- What Guildhall can complete in code: Add provider buttons and callback copy.',
        '- External dependencies: Google and Apple OAuth apps and Supabase provider settings.',
        '- Owner-only setup: TBD.',
        '- Verification environment: TBD.',
        '- What counts as done: Buttons call Supabase.',
        '- What must be split or blocked: None.',
        '',
        '## Acceptance Criteria',
        '1. Login and registration pages show Google and Apple buttons.',
      ].join('\n'),
      acceptanceCriteria: [
        {
          id: 'AC-1',
          description: 'Login and registration pages show Google and Apple buttons.',
          verifiedBy: 'review',
          met: false,
        },
      ],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/approve-spec'), { method: 'POST' }),
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, any>
    expect(body.error).toMatch(/external dependencies/i)
  })

  it('rejects approve-spec when the task has no drafted spec yet', async () => {
    await seedTask('task-1', { status: 'spec_review' })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/approve-spec'), { method: 'POST' }),
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, any>
    expect(body.error).toMatch(/spec/i)
  })

  it('rejects approve-spec on a task that is not in spec_review', async () => {
    await seedTask('task-1', { status: 'in_progress', spec: 'irrelevant' })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/approve-spec'), { method: 'POST' }),
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, any>
    expect(body.error).toMatch(/spec_review/i)
  })

  it('rejects approve-spec for the reserved workspace-import task', async () => {
    await seedTask('task-workspace-import', {
      status: 'spec_review',
      domain: '_workspace_import',
      spec: 'drafted import spec body',
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-workspace-import/approve-spec'), {
        method: 'POST',
      }),
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, any>
    expect(body.error).toMatch(/workspace import/i)
  })
})

describe('POST /api/project/task/:id/rerun-stage', () => {
  it('reopens a task for a fresh spec pass', async () => {
    await seedTask('task-1', {
      status: 'ready',
      spec: 'Old spec',
      notes: [],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/rerun-stage'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ stage: 'spec' }),
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.ok).toBe(true)
    expect(body.status).toBe('exploring')

    const raw = JSON.parse(await fs.readFile(path.join(memoryDir, 'TASKS.json'), 'utf8')) as Record<string, any>
    expect(raw.tasks[0]?.status).toBe('exploring')
    expect(raw.tasks[0]?.notes?.at(-1)?.content).toMatch(/fresh spec pass/i)
    const transcript = (await readExploringTranscript({ memoryDir, taskId: 'task-1' })).content ?? ''
    expect(transcript).toMatch(/fresh spec pass/i)
  })

  it('re-runs review from gate_check without dropping the task out of active work', async () => {
    await seedTask('task-1', {
      status: 'gate_check',
      assignedTo: 'gate-checker-agent',
      notes: [],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/rerun-stage'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ stage: 'review' }),
      }),
    )
    expect(res.status).toBe(200)
    const raw = JSON.parse(await fs.readFile(path.join(memoryDir, 'TASKS.json'), 'utf8')) as Record<string, any>
    expect(raw.tasks[0]?.status).toBe('review')
    expect(raw.tasks[0]?.assignedTo).toBe('reviewer-agent')
    expect(raw.tasks[0]?.notes?.at(-1)?.content).toMatch(/fresh review pass/i)
  })

  it('re-runs gate_check in place', async () => {
    await seedTask('task-1', {
      status: 'gate_check',
      assignedTo: 'gate-checker-agent',
      notes: [],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/rerun-stage'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ stage: 'gate' }),
      }),
    )
    expect(res.status).toBe(200)
    const raw = JSON.parse(await fs.readFile(path.join(memoryDir, 'TASKS.json'), 'utf8')) as Record<string, any>
    expect(raw.tasks[0]?.status).toBe('gate_check')
    expect(raw.tasks[0]?.assignedTo).toBe('gate-checker-agent')
    expect(raw.tasks[0]?.notes?.at(-1)?.content).toMatch(/fresh gate-check pass/i)
  })

  it('rejects rerun-stage for invalid stage/status combinations', async () => {
    await seedTask('task-1', {
      status: 'in_progress',
      notes: [],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/rerun-stage'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ stage: 'gate' }),
      }),
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, any>
    expect(body.error).toMatch(/gate_check/i)
  })
})

describe('POST /api/project/task/:id/create-split-children', () => {
  it('materializes stored split-required recommendations into child tasks', async () => {
    await seedTask('task-1', {
      status: 'spec_review',
      parentGoalId: 'goal-task-1',
      sizePlan: {
        taskId: 'task-1',
        score: 8,
        band: 'epic',
        action: 'split_required',
        factors: [],
        recommendedChildren: [
          {
            title: 'Implement the billing settings workflow',
            reason: 'Keep the user-facing workflow small enough for UX review.',
            suggestedDomain: 'frontend',
            dependsOn: [],
          },
          {
            title: 'Add the admin subscription API contract',
            reason: 'Separate API compatibility and security review from UI work.',
            suggestedDomain: 'backend',
            dependsOn: ['Implement the billing settings workflow'],
          },
        ],
        reviewBudgetHint: 'release_critical',
        reasons: ['Task size score: 8.'],
        createdAt: '2026-05-25T12:00:00.000Z',
        createdBy: 'task-sizing',
      },
    })
    const { app } = buildServeApp({ projectPath: tmpDir })

    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/create-split-children'), { method: 'POST' }),
    )

    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, any>
    expect(body.createdTaskIds).toEqual([
      'task-1-split-implement-the-billing-settings-workflow',
      'task-1-split-add-the-admin-subscription-api-contract',
    ])
    expect(body.parentTaskId).toBe('task-1')

    const raw = JSON.parse(await fs.readFile(path.join(memoryDir, 'TASKS.json'), 'utf8')) as Record<string, any>
    expect(raw.tasks).toHaveLength(3)
    expect(raw.tasks[0].status).toBe('parent')
    expect(raw.tasks[0].sizePlan.recommendedChildren.map((child: Record<string, unknown>) => child.createdTaskId)).toEqual(body.createdTaskIds)
    expect(raw.tasks[1]).toMatchObject({
      id: 'task-1-split-implement-the-billing-settings-workflow',
      status: 'exploring',
      parentGoalId: 'goal-task-1',
      origination: 'system',
      proposedBy: 'task-sizing',
    })
    expect(raw.tasks[2].dependsOn).toEqual(['task-1-split-implement-the-billing-settings-workflow'])
  })
})

describe('POST /api/project/task/:id/resume', () => {
  it('appends a human follow-up message to the exploring transcript', async () => {
    await seedTask('task-1', { status: 'exploring' })
    // The transcript file is created on first append; resumeExploring does
    // the write, we just verify the end state.
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/resume'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'One more requirement: respect DOM ordering.' }),
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.ok).toBe(true)
    const transcript = (await readExploringTranscript({ memoryDir, taskId: 'task-1' })).content ?? ''
    expect(transcript).toMatch(/respect DOM ordering/)
  })

  it('preserves an in-flight task status when Thread sends a steering note', async () => {
    await seedTask('task-1', { status: 'in_progress', notes: [] })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/resume'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message: 'Check the current failure before editing.',
          preserveStatus: true,
        }),
      }),
    )
    expect(res.status).toBe(200)
    const queue = JSON.parse(
      await fs.readFile(path.join(memoryDir, 'TASKS.json'), 'utf8'),
    ) as { tasks: Array<Record<string, any>> }
    expect(queue.tasks[0]!.status).toBe('in_progress')
    expect(queue.tasks[0]!.notes.at(-1)?.content).toContain('current failure')
    const transcript = (await readExploringTranscript({ memoryDir, taskId: 'task-1' })).content ?? ''
    expect(transcript).toMatch(/current failure/)
  })

  it('promotes an import draft into exploring when shaping starts', async () => {
    await seedTask('task-1', {
      status: 'import_draft',
      acceptanceCriteria: [],
      notes: [
        {
          agentId: 'workspace-importer',
          role: 'importer',
          content: 'Imported from: knit/docs/feature-roadmap.md',
          timestamp: new Date().toISOString(),
        },
      ],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/shape-draft'), {
        method: 'POST',
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.status).toBe('exploring')
    const queue = JSON.parse(
      await fs.readFile(path.join(memoryDir, 'TASKS.json'), 'utf8'),
    ) as { tasks: Array<Record<string, any>> }
    expect(queue.tasks[0]!.status).toBe('exploring')
    expect(queue.tasks[0]!.notes?.at(-1)?.role).toBe('shaping-request')
    const transcript = (await readExploringTranscript({ memoryDir, taskId: 'task-1' })).content ?? ''
    expect(transcript).toMatch(/Imported from project notes/)

    const detailRes = await app.fetch(new Request(projectUrl('/api/project/task/task-1')))
    expect(detailRes.status).toBe(200)
    const detailBody = (await detailRes.json()) as Record<string, any>
    expect(detailBody.task?.status).toBe('exploring')
  })

  it('shelves an imported draft immediately when it is an obvious duplicate of finished work', async () => {
    const now = new Date().toISOString()
    await fs.writeFile(
      path.join(memoryDir, 'TASKS.json'),
      JSON.stringify({
        version: 1,
        lastUpdated: now,
        tasks: [
          {
            id: 'task-done',
            title: 'Add E2E login -> create page -> edit -> search flow',
            description: 'Finished version',
            domain: 'knit',
            projectPath: '/tmp/knit',
            status: 'done',
            priority: 'normal',
            revisionCount: 0,
            remediationAttempts: 0,
            origination: 'human',
            createdAt: now,
            updatedAt: now,
          },
          {
            id: 'task-1',
            title: 'E2E tests: login → create page → edit → search flow',
            description: 'Imported raw draft',
            domain: 'knit',
            projectPath: '/tmp/knit',
            status: 'import_draft',
            priority: 'normal',
            revisionCount: 0,
            remediationAttempts: 0,
            origination: 'human',
            createdAt: now,
            updatedAt: now,
            acceptanceCriteria: [],
            notes: [
              {
                agentId: 'workspace-importer',
                role: 'importer',
                content: 'Imported from: knit/docs/feature-roadmap.md',
                timestamp: now,
              },
            ],
          },
        ],
      }, null, 2),
      'utf8',
    )

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/shape-draft'), {
        method: 'POST',
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.status).toBe('shelved')

    const queue = JSON.parse(
      await fs.readFile(path.join(memoryDir, 'TASKS.json'), 'utf8'),
    ) as { tasks: Array<Record<string, any>> }
    const task = queue.tasks.find(task => task.id === 'task-1')
    expect(task?.status).toBe('shelved')
    expect(task?.shelveReason?.code).toBe('duplicate')
    expect(task?.shelveReason?.detail).toMatch(/task-done/)
    expect(task?.notes?.at(-1)?.content).toMatch(/Duplicate of task-done/i)
  })

  it('rejects resume with neither a message nor an escalation resolution', async () => {
    await seedTask('task-1', { status: 'exploring' })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/resume'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, any>
    expect(body.error).toMatch(/message|escalation/i)
  })

  it('rejects resume on an unknown task', async () => {
    await seedTask('task-1', { status: 'exploring' })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/missing/resume'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'hi' }),
      }),
    )
    expect(res.status).toBe(400)
  })
})

describe('POST /api/project/task/:id/reframe-task', () => {
  it('reopens an inscrutable blocked task for a fresh plain-language frame', async () => {
    await seedTask('task-1', {
      status: 'blocked',
      assignedTo: 'worker-agent',
      blockReason: 'human_judgment_required: Required authoritative verification is blocked by upstream workspace build failure outside checkpoint-touched editor files.',
      productBrief: {
        approvedAt: new Date().toISOString(),
        userJob: 'Old internal phrasing.',
        successMetric: 'Old finish line.',
      },
      spec: '## Summary\nOld schematic-style spec.',
      acceptanceCriteria: [{ id: 'AC-8', description: 'Provide authoritative verification evidence.', verifiedBy: 'review' }],
      openQuestions: [{
        kind: 'choice',
        id: 'q-old',
        askedBy: 'worker-agent',
        askedAt: new Date().toISOString(),
        prompt: 'Choose recovery path.',
        choices: ['retry', 'resolve'],
      }],
      escalations: [{
        id: 'esc-old',
        taskId: 'task-1',
        agentId: 'worker-agent',
        reason: 'human_judgment_required',
        summary: 'This task needs a recovery decision.',
        raisedAt: new Date().toISOString(),
      }],
      notes: [],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/reframe-task'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'The current task is unreadable.' }),
      }),
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.status).toBe('exploring')

    const queue = JSON.parse(
      await fs.readFile(path.join(memoryDir, 'TASKS.json'), 'utf8'),
    ) as { tasks: Array<Record<string, any>> }
    const task = queue.tasks[0]!
    expect(task.status).toBe('exploring')
    expect(task.assignedTo).toBe('spec-agent')
    expect(task.blockReason).toBeUndefined()
    expect(task.productBrief).toBeUndefined()
    expect(task.spec).toBeUndefined()
    expect(task.acceptanceCriteria).toEqual([])
    expect(task.openQuestions[0]?.answeredAt).toBeTruthy()
    expect(task.openQuestions[0]?.answer).toMatch(/Superseded by a task reframe/i)
    expect(task.escalations[0]?.resolvedAt).toBeTruthy()
    expect(task.notes.some((note: Record<string, unknown>) => /reframe/i.test(String(note.content ?? '')))).toBe(true)
    const transcript = (await readExploringTranscript({ memoryDir, taskId: 'task-1' })).content ?? ''
    expect(transcript).toContain('Reframe this existing task')
    expect(transcript).toContain('what exact decision is needed')
    expect(transcript).toContain('The current task is unreadable.')
  })

  it('rejects reframe once implementation work is active', async () => {
    await seedTask('task-1', {
      status: 'in_progress',
      assignedTo: 'worker-agent',
      spec: '## Summary\nApply the policy in the dashboard.',
      acceptanceCriteria: [{ id: 'AC-1', description: 'Dashboard shows the policy.', verifiedBy: 'review' }],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })

    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/reframe-task'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'This should be split.' }),
      }),
    )

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringContaining('already started implementation'),
    })
  })
})

describe('POST /api/project/task/:id/enrich-task', () => {
  it('reopens a blocked task for split enrichment without deleting the existing spec', async () => {
    await seedTask('task-1', {
      status: 'blocked',
      assignedTo: 'worker-agent',
      blockReason: 'human_judgment_required: OAuth providers need setup.',
      productBrief: {
        approvedAt: new Date().toISOString(),
        userJob: 'Sign in with external providers.',
        successMetric: 'Google and Apple sign-in complete end-to-end.',
      },
      spec: '## Summary\nImplement OAuth buttons and callbacks.',
      acceptanceCriteria: [{ id: 'AC-1', description: 'Google sign-in works.', verifiedBy: 'review' }],
      escalations: [{
        id: 'esc-oauth',
        taskId: 'task-1',
        agentId: 'worker-agent',
        reason: 'human_judgment_required',
        summary: 'OAuth providers need setup.',
        raisedAt: new Date().toISOString(),
      }],
      notes: [],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })

    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/enrich-task'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mode: 'split',
          instruction: 'Split Google OAuth setup, Apple OAuth setup, and live verification.',
        }),
      }),
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.status).toBe('exploring')

    const queue = JSON.parse(
      await fs.readFile(path.join(memoryDir, 'TASKS.json'), 'utf8'),
    ) as { tasks: Array<Record<string, any>> }
    const task = queue.tasks[0]!
    expect(task.status).toBe('exploring')
    expect(task.assignedTo).toBe('spec-agent')
    expect(task.blockReason).toBeUndefined()
    expect(task.productBrief?.userJob).toBe('Sign in with external providers.')
    expect(task.spec).toContain('Implement OAuth buttons')
    expect(task.acceptanceCriteria).toHaveLength(1)
    expect(task.escalations[0]?.resolution).toMatch(/enrichment request/i)
    const transcript = (await readExploringTranscript({ memoryDir, taskId: 'task-1' })).content ?? ''
    expect(transcript).toContain('Enrich this task')
    expect(transcript).toContain('containing work with smaller linked nested work')
    expect(transcript).toContain('Split Google OAuth setup')
  })
})

describe('POST /api/project/task/:id/approve-brief', () => {
  it('marks a drafted product brief as approved and records approvedBy/At', async () => {
    await seedTask('task-1', {
      status: 'exploring',
      productBrief: {
        userJob: 'As a new user I want to X so Y',
        successMetric: 'Time-to-first-success drops below 60s',
        antiPatterns: ['no dark patterns', 'no jargon in first 3 screens'],
        authoredBy: 'agent:spec-agent',
        authoredAt: new Date().toISOString(),
      },
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/approve-brief'), { method: 'POST' }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.ok).toBe(true)

    const raw = await fs.readFile(path.join(memoryDir, 'TASKS.json'), 'utf8')
    const q = JSON.parse(raw)
    expect(q.tasks[0].productBrief.approvedBy).toBe('human')
    expect(q.tasks[0].productBrief.approvedAt).toMatch(/\d{4}-\d{2}-\d{2}T/)
    // User job + success metric are unchanged by approval.
    expect(q.tasks[0].productBrief.userJob).toMatch(/new user/)
  })

  it('promotes an exploring task back to spec_review when the brief is approved after a concrete spec draft already exists', async () => {
    await seedTask('task-1', {
      status: 'exploring',
      spec: '## Summary\n\nDraft spec.\n\n## Acceptance Criteria\n\n1. Works.',
      acceptanceCriteria: [
        { id: 'ac-1', description: 'Works.', verifiedBy: 'review', met: false },
      ],
      openQuestions: [],
      productBrief: {
        userJob: 'As a new user I want to X so Y',
        successMetric: 'Time-to-first-success drops below 60s',
        antiPatterns: [],
        authoredBy: 'agent:spec-agent',
        authoredAt: new Date().toISOString(),
      },
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/approve-brief'), { method: 'POST' }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.ok).toBe(true)
    expect(body.status).toBe('spec_review')

    const raw = await fs.readFile(path.join(memoryDir, 'TASKS.json'), 'utf8')
    const q = JSON.parse(raw)
    expect(q.tasks[0].status).toBe('spec_review')
  })

  it('rejects approve-brief when no brief is drafted', async () => {
    await seedTask('task-1', { status: 'exploring' })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/approve-brief'), { method: 'POST' }),
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, any>
    expect(body.error).toMatch(/no product brief/i)
  })

  it('rejects approve-brief on an incomplete brief (missing successMetric)', async () => {
    await seedTask('task-1', {
      status: 'exploring',
      productBrief: {
        userJob: 'a job',
        successMetric: '',
        antiPatterns: [],
        authoredBy: 'agent:spec-agent',
      },
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/approve-brief'), { method: 'POST' }),
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, any>
    expect(body.error).toMatch(/incomplete/i)
  })
})

describe('POST /api/project/task/:id/add-acceptance', () => {
  it('appends a human-written acceptance criterion and records a note', async () => {
    await seedTask('task-1', {
      status: 'exploring',
      acceptanceCriteria: [],
      notes: [],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/add-acceptance'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ description: 'Round-trip tests preserve comments and formatting.' }),
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.ok).toBe(true)
    expect(body.count).toBe(1)

    const raw = await fs.readFile(path.join(memoryDir, 'TASKS.json'), 'utf8')
    const q = JSON.parse(raw)
    expect(q.tasks[0].acceptanceCriteria).toEqual([
      {
        id: 'ac-1',
        description: 'Round-trip tests preserve comments and formatting.',
        verifiedBy: 'review',
        met: false,
      },
    ])
    expect(q.tasks[0].notes[0].agentId).toBe('human')
    expect(q.tasks[0].notes[0].content).toContain('Round-trip tests preserve')
  })

  it('rejects an empty acceptance criterion', async () => {
    await seedTask('task-1', { status: 'exploring', acceptanceCriteria: [] })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/add-acceptance'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ description: '   ' }),
      }),
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, any>
    expect(body.error).toMatch(/description required/i)
  })
})

describe('POST /api/project/task/:id/stage-answer', () => {
  it('persists a draft answer on the question without marking it answered', async () => {
    await seedTask('task-1', {
      status: 'spec_review',
      openQuestions: [
        {
          kind: 'choice',
          id: 'q-1',
          askedBy: 'spec-agent',
          askedAt: new Date().toISOString(),
          prompt: 'Pick one',
          choices: ['A', 'B'],
          selectionMode: 'single',
        },
      ],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/stage-answer'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ questionId: 'q-1', answer: 'A' }),
      }),
    )
    expect(res.status).toBe(200)

    const raw = await fs.readFile(path.join(memoryDir, 'TASKS.json'), 'utf8')
    const q = JSON.parse(raw)
    expect(q.tasks[0].openQuestions[0].draftAnswer).toBe('A')
    expect(q.tasks[0].openQuestions[0].answeredAt).toBeUndefined()
  })

  it('clears the persisted draft answer after final submission', async () => {
    await seedTask('task-1', {
      status: 'exploring',
      openQuestions: [
        {
          kind: 'choice',
          id: 'q-1',
          askedBy: 'spec-agent',
          askedAt: new Date().toISOString(),
          prompt: 'Pick one',
          choices: ['A', 'B'],
          selectionMode: 'single',
          draftAnswer: 'A',
        },
      ],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/answer-questions'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ answers: [{ questionId: 'q-1', answer: 'A' }] }),
      }),
    )
    expect(res.status).toBe(200)

    const raw = await fs.readFile(path.join(memoryDir, 'TASKS.json'), 'utf8')
    const q = JSON.parse(raw)
    expect(q.tasks[0].openQuestions[0].draftAnswer).toBeUndefined()
    expect(q.tasks[0].openQuestions[0].answer).toBe('A')
  })
})

describe('POST /api/project/task/:id/unshelve', () => {
  it('clears shelveReason and returns a shelved task to proposed', async () => {
    await seedTask('task-1', {
      status: 'shelved',
      shelveReason: {
        code: 'not_viable',
        detail: 'was shelved by a worker',
        rejectedBy: 'agent:worker-1',
        rejectedAt: new Date().toISOString(),
        source: 'worker_pre_rejection',
        policyApplied: true,
        requeueCount: 0,
      },
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/unshelve'), { method: 'POST' }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.ok).toBe(true)
    expect(body.status).toBe('proposed')

    const raw = await fs.readFile(path.join(memoryDir, 'TASKS.json'), 'utf8')
    const q = JSON.parse(raw)
    expect(q.tasks[0].status).toBe('proposed')
    expect(q.tasks[0].shelveReason).toBeUndefined()
    expect(q.tasks[0].notes?.at(-1)?.content).toMatch(/unshelved/i)
  })

  it('rejects unshelve on a non-shelved task', async () => {
    await seedTask('task-1', { status: 'in_progress' })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/unshelve'), { method: 'POST' }),
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, any>
    expect(body.error).toMatch(/not shelved/i)
  })
})

describe('POST /api/project/task/:id/resolve-escalation', () => {
  it('resolves an open escalation and unblocks the task', async () => {
    await seedTask('task-1', {
      status: 'blocked',
      blockReason: 'Escalation raised',
      escalations: [
        {
          id: 'esc-1',
          taskId: 'task-1',
          reason: 'scope_boundary',
          summary: 'Unclear if this should touch the auth layer',
          details: 'The proposed change crosses into the auth package',
          agentId: 'agent:worker-1',
          raisedAt: new Date().toISOString(),
        },
      ],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/resolve-escalation'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          escalationId: 'esc-1',
          resolution: 'Proceed — auth layer is in scope',
          nextStatus: 'in_progress',
        }),
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.ok).toBe(true)

    const raw = await fs.readFile(path.join(memoryDir, 'TASKS.json'), 'utf8')
    const q = JSON.parse(raw)
    const task = q.tasks[0]
    expect(task.status).toBe('in_progress')
    expect(task.assignedTo).toBe('worker-agent')
    expect(task.escalations[0].resolvedAt).toBeTruthy()
    expect(task.escalations[0].resolution).toMatch(/Proceed/)
    expect(task.blockReason).toBeUndefined()
  })

  it('requires both escalationId and resolution', async () => {
    await seedTask('task-1', { status: 'blocked' })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const resNoId = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/resolve-escalation'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ resolution: 'fine' }),
      }),
    )
    expect(resNoId.status).toBe(400)

    const resNoReason = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/resolve-escalation'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ escalationId: 'esc-1' }),
      }),
    )
    expect(resNoReason.status).toBe(400)
  })
})

describe('GET /api/project/activity', () => {
  it('summarizes counts and in-flight tasks', async () => {
    const tasksPath = path.join(memoryDir, 'TASKS.json')
    const now = new Date().toISOString()
    const queue = {
      version: 1,
      lastUpdated: now,
      tasks: [
        { id: 't1', title: 'One', description: '', domain: 'd', projectPath: tmpDir, status: 'in_progress', priority: 'normal', revisionCount: 0, remediationAttempts: 0, origination: 'human', createdAt: now, updatedAt: now },
        { id: 't2', title: 'Two', description: '', domain: 'd', projectPath: tmpDir, status: 'review', priority: 'normal', revisionCount: 0, remediationAttempts: 0, origination: 'human', createdAt: now, updatedAt: now },
        { id: 't3', title: 'Done one', description: '', domain: 'd', projectPath: tmpDir, status: 'done', priority: 'normal', revisionCount: 0, remediationAttempts: 0, origination: 'human', createdAt: now, updatedAt: now },
      ],
    }
    await fs.writeFile(tasksPath, JSON.stringify(queue, null, 2), 'utf8')

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/activity')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.counts.in_progress).toBe(1)
    expect(body.counts.review).toBe(1)
    expect(body.counts.done).toBe(1)
    expect(body.inFlight).toHaveLength(2)
    expect(body.inFlight.map((t: any) => t.id).sort()).toEqual(['t1', 't2'])
  })

  it('includes the latest live event metadata for in-flight tasks', async () => {
    const tasksPath = path.join(memoryDir, 'TASKS.json')
    const older = '2026-05-23T18:00:00.000Z'
    const now = '2026-05-23T18:01:00.000Z'
    const queue = {
      version: 1,
      lastUpdated: now,
      tasks: [
        { id: 't1', title: 'Long worker loop', description: '', domain: 'd', projectPath: tmpDir, status: 'in_progress', priority: 'normal', revisionCount: 0, remediationAttempts: 0, origination: 'human', createdAt: older, updatedAt: older },
      ],
    }
    await fs.writeFile(tasksPath, JSON.stringify(queue, null, 2), 'utf8')
    const recentEventsPath = getProjectRecentEventsPath(tmpDir)
    await fs.mkdir(path.dirname(recentEventsPath), { recursive: true })
    await fs.writeFile(
      recentEventsPath,
      [
        JSON.stringify({
          at: older,
          workspaceId: projectId,
          event: {
            type: 'tool_execution_started',
            task_id: 't1',
            tool_name: 'command',
            tool_input: { cmd: 'pnpm test' },
          },
        }),
        JSON.stringify({
          at: now,
          workspaceId: projectId,
          event: {
            type: 'tool_execution_completed',
            task_id: 't1',
            tool_name: 'command',
            output: 'command failed',
            is_error: true,
          },
        }),
      ].join('\n') + '\n',
      'utf8',
    )

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/activity')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.inFlight[0]).toMatchObject({
      id: 't1',
      status: 'in_progress',
      lastActivityLabel: 'Failed command',
      lastActivityTone: 'danger',
    })
    expect(body.inFlight[0].lastActivityAt).toBe(now)
  })

  it('returns empty summary when no tasks file exists yet', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/activity')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.inFlight).toEqual([])
  })
})
