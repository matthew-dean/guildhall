import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { bootstrapWorkspace } from '@guildhall/config'
import { writeCheckpoint } from '@guildhall/tools'
import { buildServeApp, filterEventsForTask } from '../serve.js'

// Integration tests for the v0.2 UI endpoints:
//   GET  /api/project/task/:id        — per-task detail powering the drawer
//   POST /api/project/task/:id/pause  — human override → blocked
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
  projectId = bootstrapWorkspace(tmpDir, { name: 'Task Endpoints Test' }).id
  memoryDir = path.join(tmpDir, 'memory')
})

afterEach(async () => {
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
    const ledgerPath = path.join(memoryDir, 'context-debug.jsonl')
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

  it('returns 404 when task id is unknown', async () => {
    await seedTask('task-1')
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/task/missing')))
    expect(res.status).toBe(404)
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

describe('POST /api/project/task/:id/pause|shelve', () => {
  it('pause transitions the task to blocked with a blockReason and note', async () => {
    await seedTask('task-1')
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/pause'), { method: 'POST' }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.ok).toBe(true)
    expect(body.status).toBe('blocked')

    // Verify disk state.
    const raw = await fs.readFile(path.join(memoryDir, 'TASKS.json'), 'utf8')
    const q = JSON.parse(raw)
    expect(q.tasks[0].status).toBe('blocked')
    expect(q.tasks[0].blockReason).toMatch(/dashboard/i)
    expect(q.tasks[0].notes?.at(-1)?.agentId).toBe('system:human')
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

  it('rejects pause on a done task', async () => {
    await seedTask('task-1', { status: 'done' })
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(projectUrl('/api/project/task/task-1/pause'), { method: 'POST' }),
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

describe('POST /api/project/task/:id/approve-spec', () => {
  it('transitions a spec_review task with a spec to ready and records the approvalNote', async () => {
    await seedTask('task-1', { status: 'spec_review', spec: 'drafted spec body' })
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
    const transcript = await fs.readFile(path.join(memoryDir, 'exploring', 'task-1.md'), 'utf8')
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
    const transcript = await fs.readFile(
      path.join(memoryDir, 'exploring', 'task-1.md'),
      'utf8',
    )
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
    const transcript = await fs.readFile(
      path.join(memoryDir, 'exploring', 'task-1.md'),
      'utf8',
    )
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
    const transcript = await fs.readFile(
      path.join(memoryDir, 'exploring', 'task-1.md'),
      'utf8',
    )
    expect(transcript).toMatch(/Imported from project notes/)

    const detailRes = await app.fetch(new Request(projectUrl('/api/project/task/task-1')))
    expect(detailRes.status).toBe(200)
    const detailBody = (await detailRes.json()) as Record<string, any>
    expect(detailBody.task?.status).toBe('exploring')
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

  it('returns empty summary when no tasks file exists yet', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(projectUrl('/api/project/activity')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.inFlight).toEqual([])
  })
})
