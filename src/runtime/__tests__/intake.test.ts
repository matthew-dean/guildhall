import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {
  createExploringTask,
  approveSpec,
  resumeExploring,
  createBugReportTask,
  parseStackTraceTopFile,
} from '../intake.js'
import { TaskQueue } from '@guildhall/core'
import { raiseEscalation } from '@guildhall/tools'
import { getProjectStateDir, getProjectTranscriptPath } from '@guildhall/sessions'

// ---------------------------------------------------------------------------
// FR-12 exploratory task intake
//
// Verifies that a fuzzy ask becomes an `exploring` task with a seeded
// transcript, that approve-spec advances a reviewed spec, and that a resume can
// resolve a blocking escalation and append a follow-up message.
// ---------------------------------------------------------------------------

let tmpDir: string
let dataDir: string
let memoryDir: string
let tasksPath: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-intake-'))
  dataDir = path.join(os.tmpdir(), `guildhall-data-${path.basename(tmpDir)}`)
  process.env.GUILDHALL_DATA_DIR = dataDir
  memoryDir = getProjectStateDir(tmpDir)
  await fs.mkdir(memoryDir, { recursive: true })
  tasksPath = path.join(memoryDir, 'TASKS.json')
  // Bootstrap seeds TASKS.json as a bare `[]`, so test that path directly too.
  await fs.writeFile(tasksPath, '[]', 'utf-8')
})

afterEach(async () => {
  delete process.env.GUILDHALL_DATA_DIR
  await fs.rm(dataDir, { recursive: true, force: true })
  await fs.rm(tmpDir, { recursive: true, force: true })
})

async function readQueue(): Promise<TaskQueue> {
  const raw = await fs.readFile(tasksPath, 'utf-8')
  return TaskQueue.parse(JSON.parse(raw))
}

function buildableSpec(extra = ''): string {
  return [
    '## Summary',
    'Add a ghost button variant.',
    '## Acceptance Criteria',
    '1. Renders.',
    '## Completion Boundary',
    'Product outcome: Users can choose a ghost button style where this task applies.',
    'What Guildhall can complete in code: Add the repo-local button styling and usage contract.',
    'External dependencies: None.',
    'Owner-only setup: None.',
    'Verification environment: Local automated tests and review in the app.',
    'What counts as done: The ghost button variant renders and can be reviewed locally.',
    'What must be split or blocked: Nothing to split.',
    extra,
  ].filter(Boolean).join('\n')
}

describe('createExploringTask', () => {
  it('creates a new task in exploring status and seeds the transcript', async () => {
    const result = await createExploringTask({
      memoryDir,
      ask: 'Add a ghost button variant',
      domain: 'looma',
      projectPath: '/projects/looma',
    })
    expect(result.taskId).toBe('task-001')
    expect(result.transcriptPath).toBe(
      getProjectTranscriptPath(tmpDir, 'exploring', 'task-001'),
    )

    const queue = await readQueue()
    expect(queue.tasks).toHaveLength(1)
    const task = queue.tasks[0]!
    expect(task.status).toBe('exploring')
    expect(task.description).toBe('Add a ghost button variant')
    expect(task.domain).toBe('looma')
    expect(task.title).toBe('Add a ghost button variant')

    const transcript = await fs.readFile(result.transcriptPath, 'utf-8')
    expect(transcript).toContain('Add a ghost button variant')
    expect(transcript).toContain('user')
  })

  it('handles a bare-array TASKS.json (bootstrap legacy format)', async () => {
    // Already seeded as '[]' in beforeEach — createExploringTask should cope.
    const result = await createExploringTask({
      memoryDir,
      ask: 'legacy format',
      domain: 'looma',
      projectPath: '/projects/looma',
    })
    expect(result.taskId).toBe('task-001')
    // After first intake, the file should be a full queue object
    const raw = JSON.parse(await fs.readFile(tasksPath, 'utf-8'))
    expect(raw.version).toBe(1)
    expect(raw.tasks).toHaveLength(1)
  })

  it('generates sequential ids when called multiple times', async () => {
    const a = await createExploringTask({
      memoryDir,
      ask: 'first',
      domain: 'looma',
      projectPath: '/x',
    })
    const b = await createExploringTask({
      memoryDir,
      ask: 'second',
      domain: 'looma',
      projectPath: '/x',
    })
    expect(a.taskId).toBe('task-001')
    expect(b.taskId).toBe('task-002')
  })

  it('respects an explicit task id override', async () => {
    const result = await createExploringTask({
      memoryDir,
      ask: 'x',
      domain: 'looma',
      projectPath: '/x',
      taskId: 'custom-id',
    })
    expect(result.taskId).toBe('custom-id')
  })

  it('keeps long asks complete in description instead of storing truncated title content', async () => {
    const long = 'x'.repeat(200)
    await createExploringTask({ memoryDir, ask: long, domain: 'looma', projectPath: '/x' })
    const queue = await readQueue()
    expect(queue.tasks[0]!.title).toBe('New request')
    expect(queue.tasks[0]!.description).toBe(long)
  })

  it('uses explicit title when provided', async () => {
    await createExploringTask({
      memoryDir,
      ask: 'some long ask that should not be used as the title',
      domain: 'looma',
      projectPath: '/x',
      title: 'Short Title',
    })
    const queue = await readQueue()
    expect(queue.tasks[0]!.title).toBe('Short Title')
  })

  it('classifies ambiguous policy requests and asks whether the user wants spec or implementation', async () => {
    await createExploringTask({
      memoryDir,
      ask: 'We should have a system-wide policy of how much FLL charges on overhead for maintenance fees etc.',
      domain: 'policy',
      projectPath: '/projects/fll',
      title: 'Set FLL overhead charge policy',
    })

    const queue = await readQueue()
    const task = queue.tasks[0]!
    expect(task.requestIntake).toMatchObject({
      intent: 'ambiguous_spec_or_implementation',
      recommendedNextAction: 'ask_clarifying_question',
    })
    expect(task.requestIntake?.componentStack.map(component => component.kind)).toEqual([
      'policy_decision',
      'documented_spec',
      'implementation',
      'verification',
    ])
    expect(task.openQuestions?.[0]).toMatchObject({
      kind: 'choice',
      subject: 'Policy request scope',
      prompt: expect.stringContaining('draft the FLL overhead policy first'),
      choices: [
        'Draft the policy/spec first',
        'Draft the policy and create linked implementation tasks',
        'Apply the policy now',
      ],
    })
  })

  it('rejects reusing an existing task id', async () => {
    await createExploringTask({
      memoryDir,
      ask: 'first',
      domain: 'looma',
      projectPath: '/x',
      taskId: 'same',
    })
    await expect(
      createExploringTask({
        memoryDir,
        ask: 'second',
        domain: 'looma',
        projectPath: '/x',
        taskId: 'same',
      }),
    ).rejects.toThrow(/already exists/)
  })
})

describe('approveSpec', () => {
  beforeEach(async () => {
    // Create and then attach a spec
    await createExploringTask({
      memoryDir,
      ask: 'Add ghost button',
      domain: 'looma',
      projectPath: '/projects/looma',
    })
    const queue = await readQueue()
    queue.tasks[0]!.status = 'spec_review'
    queue.tasks[0]!.spec = buildableSpec()
    queue.tasks[0]!.productBrief = {
      userJob: 'Use a lower-emphasis button action.',
      successMetric: 'A ghost button variant is available and reviewable.',
      antiPatterns: [],
      authoredBy: 'spec-agent',
      authoredAt: new Date().toISOString(),
    }
    queue.tasks[0]!.acceptanceCriteria = [
      { id: 'AC-1', description: 'Ghost button renders.', verifiedBy: 'review', met: false },
    ]
    await fs.writeFile(tasksPath, JSON.stringify(queue, null, 2), 'utf-8')
  })

  it('transitions spec_review → ready', async () => {
    const result = await approveSpec({ memoryDir, taskId: 'task-001' })
    expect(result.success).toBe(true)
    expect(result.newStatus).toBe('ready')
    const queue = await readQueue()
    expect(queue.tasks[0]!.status).toBe('ready')
  })

  it('approves specs where Completion Boundary is the final section', async () => {
    const queue = await readQueue()
    queue.tasks[0]!.spec = buildableSpec()
    await fs.writeFile(tasksPath, JSON.stringify(queue, null, 2), 'utf-8')

    const result = await approveSpec({ memoryDir, taskId: 'task-001' })

    expect(result.success).toBe(true)
    expect(result.newStatus).toBe('ready')
  })

  it('splits a split-required spec into a parent task and child tasks when approved', async () => {
    const queue = await readQueue()
    const parent = queue.tasks[0]!
    parent.parentGoalId = 'goal-task-001'
    parent.sizePlan = {
      taskId: 'task-001',
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
    }
    await fs.writeFile(tasksPath, JSON.stringify(queue, null, 2), 'utf-8')

    const result = await approveSpec({ memoryDir, taskId: 'task-001' })

    expect(result.success).toBe(true)
    expect(result.newStatus).toBe('parent')
    const updated = await readQueue()
    expect(updated.tasks[0]!.status).toBe('parent')
    expect(updated.tasks.map(task => task.title)).toEqual([
      'Add ghost button',
      'Implement the billing settings workflow',
      'Add the admin subscription API contract',
    ])
    expect(updated.tasks[0]!.sizePlan?.recommendedChildren.map(child => child.createdTaskId)).toEqual([
      'task-001-split-implement-the-billing-settings-workflow',
      'task-001-split-add-the-admin-subscription-api-contract',
    ])
    expect(updated.tasks[1]).toMatchObject({
      status: 'exploring',
      parentGoalId: 'goal-task-001',
      origination: 'system',
      proposedBy: 'task-sizing',
    })
    expect(updated.tasks[2]!.dependsOn).toEqual(['task-001-split-implement-the-billing-settings-workflow'])
  })

  it('records an approval note on the task when provided', async () => {
    await approveSpec({
      memoryDir,
      taskId: 'task-001',
      approvalNote: 'LGTM, ship it',
    })
    const queue = await readQueue()
    const notes = queue.tasks[0]!.notes
    expect(notes).toHaveLength(1)
    expect(notes[0]!.agentId).toBe('human')
    expect(notes[0]!.role).toBe('approver')
    expect(notes[0]!.content).toBe('LGTM, ship it')
  })

  it('appends an approval entry to the transcript', async () => {
    await approveSpec({
      memoryDir,
      taskId: 'task-001',
      approvalNote: 'ship it',
    })
    const transcript = await fs.readFile(
      getProjectTranscriptPath(tmpDir, 'exploring', 'task-001'),
      'utf-8',
    )
    expect(transcript).toContain('Spec approved')
    expect(transcript).toContain('ship it')
  })

  it('describes split approval in plain language in the transcript', async () => {
    const queue = await readQueue()
    const parent = queue.tasks[0]!
    parent.parentGoalId = 'goal-task-001'
    parent.sizePlan = {
      taskId: 'task-001',
      score: 8,
      band: 'epic',
      action: 'split_required',
      factors: [],
      recommendedChildren: [
        {
          title: 'Draft the policy',
          reason: 'Separate the decision from implementation.',
          suggestedDomain: 'product',
          dependsOn: [],
        },
      ],
      reviewBudgetHint: 'release_critical',
      reasons: ['Task size score: 8.'],
      createdAt: '2026-05-25T12:00:00.000Z',
      createdBy: 'task-sizing',
    }
    await fs.writeFile(tasksPath, JSON.stringify(queue, null, 2), 'utf-8')

    await approveSpec({ memoryDir, taskId: 'task-001' })

    const transcript = await fs.readFile(
      getProjectTranscriptPath(tmpDir, 'exploring', 'task-001'),
      'utf-8',
    )
    expect(transcript).toContain('Spec approved. Guildhall created the listed tasks and kept this as the parent task.')
  })

  it('refuses to approve a task that has no spec', async () => {
    const queue = await readQueue()
    delete queue.tasks[0]!.spec
    await fs.writeFile(tasksPath, JSON.stringify(queue, null, 2), 'utf-8')
    const result = await approveSpec({ memoryDir, taskId: 'task-001' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('no spec')
  })

  it('refuses to approve a task not in spec_review status', async () => {
    const queue = await readQueue()
    queue.tasks[0]!.status = 'in_progress'
    await fs.writeFile(tasksPath, JSON.stringify(queue, null, 2), 'utf-8')
    const result = await approveSpec({ memoryDir, taskId: 'task-001' })
    expect(result.success).toBe(false)
    expect(result.error).toContain("'in_progress'")
  })

  it('returns an error for unknown task id', async () => {
    const result = await approveSpec({ memoryDir, taskId: 'nope' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('nope')
  })
})

describe('parseStackTraceTopFile', () => {
  it('extracts the file path from a parenthesised frame', () => {
    const stack = [
      'Error: something',
      '    at foo (/src/app/server.ts:42:7)',
      '    at bar (/src/app/other.ts:10:1)',
    ].join('\n')
    expect(parseStackTraceTopFile(stack)).toBe('/src/app/server.ts')
  })

  it('extracts the file path from a bare "at file:line:col" frame', () => {
    const stack = [
      'Error: other',
      '    at /src/worker.ts:99:3',
    ].join('\n')
    expect(parseStackTraceTopFile(stack)).toBe('/src/worker.ts')
  })

  it('returns undefined when nothing file-shaped is present', () => {
    expect(parseStackTraceTopFile('Error: no frames here')).toBeUndefined()
  })
})

describe('createBugReportTask', () => {
  it('creates a proposed task with "Bug:" prefix and high priority by default', async () => {
    const result = await createBugReportTask({
      memoryDir,
      projectPath: '/projects/looma',
      title: 'Ghost button crashes on hover',
      body: 'Clicking ghost button in the sidebar throws.',
      domain: 'looma',
    })
    expect(result.taskId).toBe('task-001')
    const queue = await readQueue()
    expect(queue.tasks).toHaveLength(1)
    const task = queue.tasks[0]!
    expect(task.status).toBe('proposed')
    expect(task.priority).toBe('high')
    expect(task.title.startsWith('Bug: ')).toBe(true)
    expect(task.title).toContain('Ghost button')
    expect(task.origination).toBe('human')
    expect(task.description).toContain('Clicking ghost button')
    expect(task.notes).toHaveLength(1)
    expect(task.notes[0]!.role).toBe('reporter')
  })

  it('does not double-prefix when the user already wrote "Bug:" in the title', async () => {
    await createBugReportTask({
      memoryDir,
      projectPath: '/x',
      title: 'Bug: API 500 on login',
      body: 'body',
      domain: 'api',
    })
    const queue = await readQueue()
    expect(queue.tasks[0]!.title).toBe('Bug: API 500 on login')
  })

  it('includes the stack trace as a fenced block in the description', async () => {
    await createBugReportTask({
      memoryDir,
      projectPath: '/x',
      title: 'boom',
      body: 'It crashed.',
      stackTrace: 'Error: x\n    at foo (/src/x.ts:1:1)',
      domain: 'api',
    })
    const queue = await readQueue()
    expect(queue.tasks[0]!.description).toContain('```')
    expect(queue.tasks[0]!.description).toContain('at foo (/src/x.ts:1:1)')
  })

  it('appends the environment block when provided', async () => {
    await createBugReportTask({
      memoryDir,
      projectPath: '/x',
      title: 'env repro',
      body: 'Happens only on macOS.',
      env: { os: 'darwin 25.3.0', node: 'v22.7.0' },
      domain: 'api',
    })
    const queue = await readQueue()
    expect(queue.tasks[0]!.description).toContain('**Environment:**')
    expect(queue.tasks[0]!.description).toContain('os: darwin 25.3.0')
    expect(queue.tasks[0]!.description).toContain('node: v22.7.0')
  })

  it('accepts an explicit priority override', async () => {
    await createBugReportTask({
      memoryDir,
      projectPath: '/x',
      title: 'minor',
      body: 'cosmetic',
      domain: 'looma',
      priority: 'low',
    })
    const queue = await readQueue()
    expect(queue.tasks[0]!.priority).toBe('low')
  })
})

describe('resumeExploring', () => {
  beforeEach(async () => {
    await createExploringTask({
      memoryDir,
      ask: 'first ask',
      domain: 'looma',
      projectPath: '/x',
    })
  })

  it('appends a new user message to the transcript', async () => {
    const result = await resumeExploring({
      memoryDir,
      taskId: 'task-001',
      message: 'one more requirement',
    })
    expect(result.success).toBe(true)
    const transcript = await fs.readFile(
      getProjectTranscriptPath(tmpDir, 'exploring', 'task-001'),
      'utf-8',
    )
    expect(transcript).toContain('first ask')
    expect(transcript).toContain('one more requirement')
  })

  it('moves a non-terminal task back to exploring when the user replies', async () => {
    let queue = await readQueue()
    queue.tasks[0]!.status = 'ready'
    await fs.writeFile(tasksPath, JSON.stringify(queue, null, 2))

    const result = await resumeExploring({
      memoryDir,
      taskId: 'task-001',
      message: 'Actually, re-check the imported TODO before implementing.',
    })
    expect(result.success).toBe(true)

    queue = await readQueue()
    expect(queue.tasks[0]!.status).toBe('exploring')
  })

  it('can add a human steering note without reopening spec intake', async () => {
    let queue = await readQueue()
    queue.tasks[0]!.status = 'in_progress'
    await fs.writeFile(tasksPath, JSON.stringify(queue, null, 2))

    const result = await resumeExploring({
      memoryDir,
      taskId: 'task-001',
      message: 'Before editing more files, summarize the failing test.',
      preserveStatus: true,
    })
    expect(result.success).toBe(true)

    queue = await readQueue()
    expect(queue.tasks[0]!.status).toBe('in_progress')
    expect(queue.tasks[0]!.notes.at(-1)?.content).toContain('summarize the failing test')
    const transcript = await fs.readFile(
      getProjectTranscriptPath(tmpDir, 'exploring', 'task-001'),
      'utf-8',
    )
    expect(transcript).toContain('summarize the failing test')
  })

  it('resolves a pending escalation and returns task to exploring', async () => {
    await raiseEscalation({
      tasksPath,
      taskId: 'task-001',
      agentId: 'spec-agent',
      reason: 'spec_ambiguous',
      summary: 'is this for mobile too?',
    })
    let queue = await readQueue()
    expect(queue.tasks[0]!.status).toBe('blocked')

    const result = await resumeExploring({
      memoryDir,
      taskId: 'task-001',
      resolveEscalationId: 'esc-task-001-1',
      resolution: 'yes, mobile too',
      message: 'also mobile, yes',
    })
    expect(result.success).toBe(true)

    queue = await readQueue()
    expect(queue.tasks[0]!.status).toBe('exploring')
    expect(queue.tasks[0]!.escalations[0]!.resolvedAt).toBeDefined()
    expect(queue.tasks[0]!.escalations[0]!.resolution).toBe('yes, mobile too')
  })

  it('returns error for unknown task id', async () => {
    const result = await resumeExploring({
      memoryDir,
      taskId: 'nope',
      message: 'x',
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('nope')
  })
})
