import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {
  readTasks,
  updateTask,
  addTask,
  readTasksTool,
  updateTaskTool,
  addTaskTool,
} from '../task-queue.js'

// ---------------------------------------------------------------------------
// Tests for task queue tools — these are safety-critical (gate logic depends
// on them) so coverage must be thorough.
// ---------------------------------------------------------------------------

let tmpDir: string
let tasksPath: string

const seedQueue = {
  version: 1,
  lastUpdated: new Date().toISOString(),
  tasks: [
    {
      id: 'task-001',
      title: 'Test task',
      description: 'A test task',
      domain: 'looma',
      projectPath: '/projects/looma',
      status: 'exploring',
      priority: 'normal',
      dependsOn: [],
      outOfScope: [],
      acceptanceCriteria: [],
      notes: [],
      gateResults: [],
      reviewVerdicts: [],
    adjudications: [],
      escalations: [],
      revisionCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ],
}

const ctx = { cwd: '/tmp', metadata: {} }

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-test-'))
  tasksPath = path.join(tmpDir, 'TASKS.json')
  await fs.writeFile(tasksPath, JSON.stringify(seedQueue), 'utf-8')
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('readTasks', () => {
  it('reads and parses a valid task queue', async () => {
    const result = await readTasks({ tasksPath })
    expect(result.queue).not.toBeNull()
    expect(result.queue?.tasks).toHaveLength(1)
    expect(result.queue?.tasks[0]?.id).toBe('task-001')
  })

  it('returns null queue with error for missing file', async () => {
    const result = await readTasks({ tasksPath: path.join(tmpDir, 'nonexistent.json') })
    expect(result.queue).toBeNull()
    expect(result.error).toBeDefined()
  })

  it('returns null queue with error for malformed JSON', async () => {
    await fs.writeFile(tasksPath, '{ invalid json', 'utf-8')
    const result = await readTasks({ tasksPath })
    expect(result.queue).toBeNull()
    expect(result.error).toBeDefined()
  })
})

describe('updateTask', () => {
  it('updates task status', async () => {
    await updateTask({ tasksPath, taskId: 'task-001', status: 'spec_review' })
    const raw = JSON.parse(await fs.readFile(tasksPath, 'utf-8'))
    expect(raw.tasks[0].status).toBe('spec_review')
  })

  it('normalizes reviewer ownership when a task moves into review', async () => {
    await updateTask({ tasksPath, taskId: 'task-001', status: 'spec_review' })
    await updateTask({ tasksPath, taskId: 'task-001', status: 'ready' })
    await updateTask({ tasksPath, taskId: 'task-001', status: 'in_progress' })
    await updateTask({ tasksPath, taskId: 'task-001', status: 'review' })
    const raw = JSON.parse(await fs.readFile(tasksPath, 'utf-8'))
    expect(raw.tasks[0].status).toBe('review')
    expect(raw.tasks[0].assignedTo).toBe('reviewer-agent')
  })

  it('normalizes gate-checker ownership when a task moves into gate_check', async () => {
    await updateTask({ tasksPath, taskId: 'task-001', status: 'spec_review' })
    await updateTask({ tasksPath, taskId: 'task-001', status: 'ready' })
    await updateTask({ tasksPath, taskId: 'task-001', status: 'in_progress' })
    await updateTask({ tasksPath, taskId: 'task-001', status: 'review' })
    await updateTask({ tasksPath, taskId: 'task-001', status: 'gate_check' })
    const raw = JSON.parse(await fs.readFile(tasksPath, 'utf-8'))
    expect(raw.tasks[0].status).toBe('gate_check')
    expect(raw.tasks[0].assignedTo).toBe('gate-checker-agent')
  })

  it('preserves an explicitly supplied assignee when provided alongside a status', async () => {
    await updateTask({ tasksPath, taskId: 'task-001', status: 'spec_review' })
    await updateTask({ tasksPath, taskId: 'task-001', status: 'ready' })
    await updateTask({ tasksPath, taskId: 'task-001', status: 'in_progress' })
    await updateTask({
      tasksPath,
      taskId: 'task-001',
      status: 'review',
      assignedTo: 'custom-review-owner',
    })
    const raw = JSON.parse(await fs.readFile(tasksPath, 'utf-8'))
    expect(raw.tasks[0].assignedTo).toBe('custom-review-owner')
  })

  it('rejects impossible explicit status jumps through the transition boundary', async () => {
    const result = await updateTask({ tasksPath, taskId: 'task-001', status: 'review' })

    expect(result.success).toBe(false)
    expect(result.error).toContain('cannot request review from exploring')

    const raw = JSON.parse(await fs.readFile(tasksPath, 'utf-8'))
    expect(raw.tasks[0].status).toBe('exploring')
  })

  it('updates task title', async () => {
    await updateTask({ tasksPath, taskId: 'task-001', title: 'Write a clear implementation spec' })
    const raw = JSON.parse(await fs.readFile(tasksPath, 'utf-8'))
    expect(raw.tasks[0].title).toBe('Write a clear implementation spec')
  })

  it('appends a note to a task', async () => {
    await updateTask({
      tasksPath,
      taskId: 'task-001',
      note: { agentId: 'spec-agent', role: 'spec', content: 'Spec complete.' },
    })
    const raw = JSON.parse(await fs.readFile(tasksPath, 'utf-8'))
    expect(raw.tasks[0].notes).toHaveLength(1)
    expect(raw.tasks[0].notes[0].content).toBe('Spec complete.')
    expect(raw.tasks[0].notes[0].timestamp).toBeDefined()
  })

  it('updates the task spec and acceptance criteria', async () => {
    await updateTask({
      tasksPath,
      taskId: 'task-001',
      spec: '## Summary\nBuild the thing.',
      acceptanceCriteria: [
        {
          id: 'ac-1',
          description: 'Build passes',
          verifiedBy: 'pnpm test',
        },
      ],
    })
    const raw = JSON.parse(await fs.readFile(tasksPath, 'utf-8'))
    expect(raw.tasks[0].spec).toContain('Build the thing')
    expect(raw.tasks[0].acceptanceCriteria).toEqual([
      {
        id: 'ac-1',
        description: 'Build passes',
        scenario: 'Build passes',
        expectation: 'Build passes',
        verifiedBy: 'automated',
        command: 'pnpm test',
        met: false,
      },
    ])
    expect(raw.tasks[0].sizePlan).toMatchObject({
      taskId: 'task-001',
      action: 'proceed',
      createdBy: 'task-sizing',
    })
  })

  it('renders structuredSpec JSON into markdown and deterministic acceptance criteria', async () => {
    await updateTask({
      tasksPath,
      taskId: 'task-001',
      structuredSpec: {
        whatThisIs: 'A block menu for Looma selection actions.',
        problemContext: 'The imported roadmap draft and answered questions already narrowed the scope.',
        goals: ['Ship the approved block menu interaction.'],
        nonGoals: ['Do not include drag-and-drop reordering.'],
        proposedDesign: 'Extend the existing editor action surface with a block menu entry point.',
        keyDecisions: ['Keep drag-handle work split into a follow-up task.'],
        acceptanceCriteria: [
          {
            scenario: 'Given a selected block, when the menu opens',
            expectation: 'Then the approved actions appear.',
            verificationMode: 'review',
          },
        ],
        verification: ['Review the block menu locally in the editor shell.'],
        completionBoundary: {
          productOutcome: 'Editors can use the approved block menu locally.',
          whatGuildhallCanCompleteInCode: 'The repo-local menu UI and tests.',
          externalDependencies: 'None.',
          ownerOnlySetup: 'None.',
          verificationEnvironment: 'Local editor shell and repo tests.',
          whatCountsAsDone: 'The block menu is reviewable and behaves as specified.',
          whatMustBeSplitOrBlocked: 'Drag-handle work stays split.',
        },
        userFacingBehavior: 'The menu appears beside the selected block and shows only the approved actions.',
      },
    })

    const raw = JSON.parse(await fs.readFile(tasksPath, 'utf-8'))
    expect(raw.tasks[0].structuredSpec.whatThisIs).toBe('A block menu for Looma selection actions.')
    expect(raw.tasks[0].spec).toContain('## What this is')
    expect(raw.tasks[0].spec).toContain('## User-facing behavior')
    expect(raw.tasks[0].acceptanceCriteria).toEqual([
      {
        id: 'ac-1',
        description: 'Given a selected block, when the menu opens Then the approved actions appear.',
        scenario: 'Given a selected block, when the menu opens',
        expectation: 'Then the approved actions appear.',
        verifiedBy: 'review',
        met: false,
      },
    ])
  })

  it('rejects updates that provide both markdown spec and structuredSpec JSON', async () => {
    const result = await updateTask({
      tasksPath,
      taskId: 'task-001',
      spec: '## Summary\nLegacy spec.',
      structuredSpec: {
        whatThisIs: 'A block menu.',
        problemContext: 'Need one.',
        goals: ['Ship it.'],
        nonGoals: ['No drag handle.'],
        proposedDesign: 'Use the existing surface.',
        keyDecisions: ['Reuse the current selection model.'],
        acceptanceCriteria: ['Given x, when y, then z.'],
        verification: ['Review locally.'],
        completionBoundary: {
          productOutcome: 'It works.',
          whatGuildhallCanCompleteInCode: 'Repo changes.',
          externalDependencies: 'None.',
          ownerOnlySetup: 'None.',
          verificationEnvironment: 'Local.',
          whatCountsAsDone: 'Reviewable.',
          whatMustBeSplitOrBlocked: 'None.',
        },
      },
    })

    expect(result).toEqual({
      success: false,
      taskId: 'task-001',
      error: 'Provide either spec markdown or structuredSpec JSON, not both.',
    })
  })

  it('records a split-required sizing plan when a shaped task is too large', async () => {
    await updateTask({
      tasksPath,
      taskId: 'task-001',
      spec: [
        '## Summary',
        'Add billing settings, create an admin API endpoint, migrate subscription data, send invite emails, and document analytics rollout.',
        '',
        '## Acceptance Criteria',
        '- Billing settings update subscriptions.',
        '- Admin API returns subscription status.',
        '- Migration backfills existing workspace subscriptions.',
      ].join('\n'),
      acceptanceCriteria: [
        { id: 'ac-1', description: 'Billing settings update subscriptions.', verifiedBy: 'review' },
        { id: 'ac-2', description: 'Admin API returns subscription status.', verifiedBy: 'review' },
        { id: 'ac-3', description: 'Migration backfills subscriptions.', verifiedBy: 'review' },
      ],
    })

    const raw = JSON.parse(await fs.readFile(tasksPath, 'utf-8'))
    expect(raw.tasks[0].sizePlan).toMatchObject({
      taskId: 'task-001',
      score: 8,
      band: 'epic',
      action: 'split_required',
    })
    expect(raw.tasks[0].parentGoalId).toBeUndefined()
    expect(raw.tasks[0].sizePlan.recommendedChildren.length).toBeGreaterThanOrEqual(3)
  })

  it('materializes split-required sizing plans into linked child tasks idempotently', async () => {
    const spec = [
      '## Summary',
      'Add billing settings, create an admin API endpoint, migrate subscription data, send invite emails, and document analytics rollout.',
      '',
      '## Acceptance Criteria',
      '- Billing settings update subscriptions.',
      '- Admin API returns subscription status.',
      '- Migration backfills existing workspace subscriptions.',
    ].join('\n')
    const acceptanceCriteria = [
      { id: 'ac-1', description: 'Billing settings update subscriptions.', verifiedBy: 'review' as const },
      { id: 'ac-2', description: 'Admin API returns subscription status.', verifiedBy: 'review' as const },
      { id: 'ac-3', description: 'Migration backfills subscriptions.', verifiedBy: 'review' as const },
    ]

    await updateTask({ tasksPath, taskId: 'task-001', status: 'ready', spec, acceptanceCriteria })
    await updateTask({ tasksPath, taskId: 'task-001', status: 'ready', spec, acceptanceCriteria })

    const raw = JSON.parse(await fs.readFile(tasksPath, 'utf-8'))
    const parent = raw.tasks.find((task: { id: string }) => task.id === 'task-001')
    const children = raw.tasks.filter((task: { id: string; hierarchy?: { parentId?: string } }) =>
      task.id !== 'task-001' && task.hierarchy?.parentId === 'task-001',
    )

    expect(parent.sizePlan.action).toBe('split_required')
    expect(parent.status).toBe('ready')
    expect(parent.hierarchy.childIds).toEqual(children.map((task: { id: string }) => task.id))
    expect(children.map((task: { title: string }) => task.title)).toEqual([
      'Implement the billing settings workflow',
      'Add the admin subscription API contract',
      'Migrate existing workspace subscription data',
      'Implement invite email delivery',
      'Update analytics documentation and rollout evidence',
    ])
    expect(children.every((task: { status: string; origination: string; proposedBy: string }) =>
      task.status === 'exploring' &&
      task.origination === 'system' &&
      task.proposedBy === 'task-sizing',
    )).toBe(true)
    expect(parent.sizePlan.recommendedChildren.map((child: { createdTaskId?: string }) => child.createdTaskId)).toEqual(
      children.map((task: { id: string }) => task.id),
    )
  })

  it('keeps a split-required parent out of the ready worker queue', async () => {
    await updateTask({
      tasksPath,
      taskId: 'task-001',
      status: 'ready',
      spec: [
        '## Summary',
        'Add billing settings, create an admin API endpoint, migrate subscription data, send invite emails, and document analytics rollout.',
        '',
        '## Acceptance Criteria',
        '- Billing settings update subscriptions.',
        '- Admin API returns subscription status.',
        '- Migration backfills existing workspace subscriptions.',
      ].join('\n'),
      acceptanceCriteria: [
        { id: 'ac-1', description: 'Billing settings update subscriptions.', verifiedBy: 'review' },
        { id: 'ac-2', description: 'Admin API returns subscription status.', verifiedBy: 'review' },
        { id: 'ac-3', description: 'Migration backfills subscriptions.', verifiedBy: 'review' },
      ],
    })

    const raw = JSON.parse(await fs.readFile(tasksPath, 'utf-8'))
    expect(raw.tasks[0].sizePlan.action).toBe('split_required')
    expect(raw.tasks[0].status).toBe('ready')
    expect(raw.tasks.filter((task: { id: string; hierarchy?: { parentId?: string } }) =>
      task.id !== 'task-001' && task.hierarchy?.parentId === 'task-001',
    ).length).toBeGreaterThan(0)
  })

  it('promotes exploring tasks to spec_review when a non-empty spec is written without an explicit status', async () => {
    await updateTask({
      tasksPath,
      taskId: 'task-001',
      spec: '## Summary\nBuild the thing.',
    })
    const raw = JSON.parse(await fs.readFile(tasksPath, 'utf-8'))
    expect(raw.tasks[0].status).toBe('spec_review')
    expect(raw.tasks[0].spec).toContain('Build the thing')
  })

  it('does not invent split pressure or child tasks for one bounded artifact patch spec', async () => {
    await updateTask({
      tasksPath,
      taskId: 'task-001',
      status: 'ready',
      spec: [
        '## Summary',
        'Append one sentence to STATUS_NOTE.md and do not edit any other file.',
        '',
        '## Acceptance Criteria',
        '- STATUS_NOTE.md contains the requested sentence.',
        '- Existing content remains unchanged.',
        '- No other files change.',
        '',
        '## Completion Boundary',
        '- Product outcome: STATUS_NOTE.md contains the requested sentence.',
        '- What Guildhall can complete in code: Append one sentence to STATUS_NOTE.md.',
        '- External dependencies: None.',
        '- Owner-only setup: None.',
        '- Verification environment: Local filesystem.',
        '- What counts as done:',
        '  1. grep exits 0 for the sentence.',
        '  2. git diff shows only STATUS_NOTE.md changed.',
        '  3. Original lines remain untouched.',
        '- What must be split or blocked: Nothing.',
      ].join('\n'),
      acceptanceCriteria: [
        { id: 'ac-1', description: 'STATUS_NOTE.md contains the requested sentence.', verifiedBy: 'automated' },
        { id: 'ac-2', description: 'Existing content remains unchanged.', verifiedBy: 'automated' },
        { id: 'ac-3', description: 'No other files change.', verifiedBy: 'automated' },
      ],
      workUnitAnalysis: {
        summary: 'One deliverable with three proof checks.',
        units: [{
          id: 'unit-1',
          title: 'Patch status note artifact',
          deliverable: 'STATUS_NOTE.md contains the requested sentence while preserving existing content.',
          rationale: 'Content, preservation, and diff checks all verify the same artifact change.',
        }],
        proofOnlyItems: ['content check', 'diff scope check', 'preservation check'],
        createdAt: '2026-05-30T12:05:00.000Z',
        createdBy: 'coordinator-test',
      },
    })

    const raw = JSON.parse(await fs.readFile(tasksPath, 'utf-8'))
    expect(raw.tasks[0].sizePlan).toMatchObject({
      taskId: 'task-001',
      score: 1,
      action: 'proceed',
    })
    expect(raw.tasks[0].status).toBe('ready')
    expect(raw.tasks[0].parentGoalId).toBeUndefined()
    expect(raw.tasks.filter((task: { id: string; hierarchy?: { parentId?: string } }) =>
      task.id !== 'task-001' && task.hierarchy?.parentId === 'task-001',
    )).toEqual([])
  })

  it('rejects worker-authored hard gate results', async () => {
    const result = await updateTask({
      tasksPath,
      taskId: 'task-001',
      gateResults: [{
        gateId: 'AC-1',
        type: 'hard',
        passed: true,
        checkedAt: '2026-05-30T00:00:00.000Z',
        output: 'claimed pass',
      }],
    }, { current_agent_id: 'worker-agent' })

    expect(result.success).toBe(false)
    expect(result.error).toContain('Workers cannot author hard gate results')
  })

  it('rejects worker-authored met=true command-backed acceptance criteria', async () => {
    const result = await updateTask({
      tasksPath,
      taskId: 'task-001',
      acceptanceCriteria: [{
        id: 'AC-1',
        description: 'RELEASE_NOTES.md contains benchmark artifact evidence.',
        verifiedBy: 'automated',
        command: "grep -q 'benchmark artifact evidence' RELEASE_NOTES.md",
        met: true,
      }],
    }, { current_agent_id: 'worker-agent' })

    expect(result.success).toBe(false)
    expect(result.error).toContain('Workers cannot mark command-backed acceptance criteria as met')
  })

  it('rejects spec_review promotion when the spec buries unanswered human questions in markdown', async () => {
    const result = await updateTask({
      tasksPath,
      taskId: 'task-001',
      spec: [
        '## Summary',
        'Build the invite flow.',
        '',
        '## Acceptance Criteria',
        '1. Given an owner invites a teammate, then an invite email is sent.',
        '',
        '## Out of Scope',
        '- Bulk invites',
        '',
        '## Open Questions',
        '1. Who can invite?',
        '2. What role should invitees get?',
      ].join('\n'),
    })

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/post-user-question/i)

    const raw = JSON.parse(await fs.readFile(tasksPath, 'utf-8'))
    expect(raw.tasks[0].status).toBe('exploring')
    expect(raw.tasks[0].spec).toBeUndefined()
  })

  it('normalizes duplicated subproject path prefixes inside specs and derived verification commands', async () => {
    const queue = {
      ...seedQueue,
      tasks: [
        {
          ...seedQueue.tasks[0],
          projectPath: '/projects/looma-knit/knit',
        },
      ],
    }
    await fs.writeFile(tasksPath, JSON.stringify(queue), 'utf-8')

    await updateTask({
      tasksPath,
      taskId: 'task-001',
      spec: [
        '## Summary',
        'Wire the settings page.',
        '',
        '## Acceptance Criteria',
        '1. Given `pnpm typecheck` runs in `knit/web`, then it passes.',
        '2. Given `pnpm build` runs in `knit/web`, then it succeeds.',
      ].join('\n'),
      acceptanceCriteria: [
        {
          id: 'ac-1',
          description: 'Given `pnpm typecheck` runs in `knit/web`, then it passes.',
          verifiedBy: 'automated',
          command: 'cd knit/web && pnpm typecheck',
        },
        {
          id: 'ac-2',
          description: 'Given `pnpm build` runs in `knit/web`, then it succeeds.',
          verifiedBy: 'automated',
          command: 'cd knit/web && pnpm build',
        },
      ],
    })

    const raw = JSON.parse(await fs.readFile(tasksPath, 'utf-8'))
    expect(raw.tasks[0].spec).toContain('`web`')
    expect(raw.tasks[0].spec).not.toContain('knit/web')
    expect(raw.tasks[0].acceptanceCriteria).toMatchObject([
      {
        description: 'Given `pnpm typecheck` runs in `web`, then it passes.',
        command: 'cd web && pnpm typecheck',
      },
      {
        description: 'Given `pnpm build` runs in `web`, then it succeeds.',
        command: 'cd web && pnpm build',
      },
    ])
  })

  it('retitles imported deferred tasks from spec summary once a real spec exists', async () => {
    const importedQueue = {
      ...seedQueue,
      tasks: [
        {
          ...seedQueue.tasks[0],
          title: 'Version diff view (deferred)',
          notes: [
            {
              agentId: 'workspace-importer',
              role: 'importer',
              content: 'Imported from: /repo/knit/PROJECT_STATE.md',
              timestamp: new Date().toISOString(),
            },
          ],
        },
      ],
    }
    await fs.writeFile(tasksPath, JSON.stringify(importedQueue), 'utf-8')

    await updateTask({
      tasksPath,
      taskId: 'task-001',
      spec: '## Summary\nAdd a version diff view to page history.',
    })

    const raw = JSON.parse(await fs.readFile(tasksPath, 'utf-8'))
    expect(raw.tasks[0].title).toBe('Knit: add a version diff view to page history')
  })

  it('derives structured acceptance criteria from the spec when none are provided explicitly', async () => {
    await updateTask({
      tasksPath,
      taskId: 'task-001',
      spec: [
        '## Summary',
        'Build the thing.',
        '',
        '## Acceptance Criteria',
        '1. The table menu renders.',
        '2. `pnpm -F web build` passes.',
      ].join('\n'),
    })

    const raw = JSON.parse(await fs.readFile(tasksPath, 'utf-8'))
    expect(raw.tasks[0].acceptanceCriteria).toEqual([
      {
        id: 'ac-1',
        description: 'The table menu renders.',
        scenario: 'The table menu renders.',
        expectation: 'The table menu renders.',
        verifiedBy: 'review',
        met: false,
      },
      {
        id: 'ac-2',
        description: '`pnpm -F web build` passes.',
        scenario: '`pnpm -F web build` passes.',
        expectation: '`pnpm -F web build` passes.',
        verifiedBy: 'review',
        met: false,
      },
    ])
  })

  it('ignores empty optional strings so broad model calls do not erase existing spec state', async () => {
    await updateTask({
      tasksPath,
      taskId: 'task-001',
      spec: 'Existing spec',
      blockReason: 'Existing block reason',
      humanJudgment: 'Existing human note',
      completedAt: '2026-04-29T00:00:00.000Z',
      assignedTo: 'worker-agent',
    })
    await updateTask({ tasksPath, taskId: 'task-001', status: 'ready' })
    await updateTask({ tasksPath, taskId: 'task-001', status: 'in_progress' })

    await updateTask({
      tasksPath,
      taskId: 'task-001',
      status: 'review',
      spec: '',
      blockReason: '',
      humanJudgment: '',
      completedAt: '',
      assignedTo: '',
    })

    const raw = JSON.parse(await fs.readFile(tasksPath, 'utf-8'))
    expect(raw.tasks[0].status).toBe('review')
    expect(raw.tasks[0].spec).toBe('Existing spec')
    expect(raw.tasks[0].blockReason).toBe('Existing block reason')
    expect(raw.tasks[0].humanJudgment).toBe('Existing human note')
    expect(raw.tasks[0].completedAt).toBe('2026-04-29T00:00:00.000Z')
    expect(raw.tasks[0].assignedTo).toBeUndefined()
  })

  it('updates updatedAt timestamp', async () => {
    const before = seedQueue.tasks[0]!.updatedAt
    await new Promise((r) => setTimeout(r, 5))
    await updateTask({ tasksPath, taskId: 'task-001', status: 'ready' })
    const raw = JSON.parse(await fs.readFile(tasksPath, 'utf-8'))
    expect(raw.tasks[0].updatedAt).not.toBe(before)
  })

  it('returns error for unknown task id', async () => {
    const result = await updateTask({ tasksPath, taskId: 'nonexistent' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('nonexistent')
  })

  it('returns error when no mutation is provided', async () => {
    const result = await updateTask({ tasksPath, taskId: 'task-001' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('No task mutation provided')
  })

  it('sets blockReason when blocking a task', async () => {
    await updateTask({
      tasksPath,
      taskId: 'task-001',
      status: 'blocked',
      blockReason: 'Spec ambiguous — awaiting human input',
    })
    const raw = JSON.parse(await fs.readFile(tasksPath, 'utf-8'))
    expect(raw.tasks[0].status).toBe('blocked')
    expect(raw.tasks[0].blockReason).toBe('Spec ambiguous — awaiting human input')
  })

  it('records gate results for review packets and gate audit', async () => {
    await updateTask({
      tasksPath,
      taskId: 'task-001',
      gateResults: [
        {
          gateId: 'test',
          type: 'hard',
          passed: true,
          output: 'ok',
          checkedAt: '2026-04-29T00:00:00.000Z',
        },
      ],
    })

    const raw = JSON.parse(await fs.readFile(tasksPath, 'utf-8'))
    expect(raw.tasks[0].gateResults).toEqual([
      {
        gateId: 'test',
        type: 'hard',
        passed: true,
        output: 'ok',
        checkedAt: '2026-04-29T00:00:00.000Z',
      },
    ])
  })

  it('ignores empty array fields so broad model calls do not erase existing review state', async () => {
    await updateTask({
      tasksPath,
      taskId: 'task-001',
      acceptanceCriteria: [
        {
          id: 'ac-1',
          description: 'Build passes',
          verifiedBy: 'pnpm test',
        },
      ],
      gateResults: [
        {
          gateId: 'test',
          type: 'hard',
          passed: true,
          output: 'ok',
          checkedAt: '2026-04-29T00:00:00.000Z',
        },
      ],
    })
    await updateTask({ tasksPath, taskId: 'task-001', status: 'spec_review' })
    await updateTask({ tasksPath, taskId: 'task-001', status: 'ready' })

    await updateTask({
      tasksPath,
      taskId: 'task-001',
      status: 'in_progress',
      acceptanceCriteria: [],
      gateResults: [],
    })

    const raw = JSON.parse(await fs.readFile(tasksPath, 'utf-8'))
    expect(raw.tasks[0].status).toBe('in_progress')
    expect(raw.tasks[0].acceptanceCriteria).toEqual([
      {
        id: 'ac-1',
        description: 'Build passes',
        scenario: 'Build passes',
        expectation: 'Build passes',
        verifiedBy: 'automated',
        command: 'pnpm test',
        met: false,
      },
    ])
    expect(raw.tasks[0].gateResults).toEqual([
      {
        gateId: 'test',
        type: 'hard',
        passed: true,
        output: 'ok',
        checkedAt: '2026-04-29T00:00:00.000Z',
      },
    ])
  })

  it('infers taskId from runtime metadata when a single active task cannot be inferred', async () => {
    const result = await updateTask(
      {
        tasksPath,
        status: 'spec_review',
      },
      {
        current_task_id: 'task-001',
      },
    )

    expect(result.success).toBe(true)
    expect(result.taskId).toBe('task-001')

    const raw = JSON.parse(await fs.readFile(tasksPath, 'utf-8'))
    expect(raw.tasks[0].status).toBe('spec_review')
  })
})

describe('addTask', () => {
  it('adds a new task to the queue', async () => {
    const newTask = {
      id: 'task-002',
      title: 'New task',
      description: 'Another task',
      domain: 'knit',
      projectPath: '/projects/knit',
      status: 'exploring' as const,
      priority: 'high' as const,
      dependsOn: [],
      outOfScope: [],
      acceptanceCriteria: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    const result = await addTask({ tasksPath, task: newTask })
    expect(result.success).toBe(true)
    expect(result.taskId).toBe('task-002')

    const raw = JSON.parse(await fs.readFile(tasksPath, 'utf-8'))
    expect(raw.tasks).toHaveLength(2)
    expect(raw.tasks[1].id).toBe('task-002')
    expect(raw.tasks[1].notes).toEqual([])
    expect(raw.tasks[1].gateResults).toEqual([])
    expect(raw.tasks[1].revisionCount).toBe(0)
  })
})

describe('engine tool wrappers', () => {
  it('readTasksTool surfaces queue via metadata and JSON-stringified output', async () => {
    const result = await readTasksTool.execute({ tasksPath }, ctx)
    expect(result.is_error).toBe(false)
    expect(result.output).toContain('task-001')
    expect(result.metadata?.queue).toBeDefined()
  })

  it('readTasksTool marks missing file as error', async () => {
    const result = await readTasksTool.execute(
      { tasksPath: path.join(tmpDir, 'nope.json') },
      ctx,
    )
    expect(result.is_error).toBe(true)
  })

  it('updateTaskTool reports success', async () => {
    const result = await updateTaskTool.execute(
      { tasksPath, taskId: 'task-001', status: 'ready' },
      ctx,
    )
    expect(result.is_error).toBe(false)
    expect(result.metadata?.success).toBe(true)
  })

  it('updateTaskTool exposes a usable JSON schema for model tool calls', () => {
    expect(updateTaskTool.jsonSchema.properties).toMatchObject({
      tasksPath: { type: 'string' },
      status: { type: 'string' },
      note: { type: 'object' },
      gateResults: { type: 'array' },
    })
    expect(updateTaskTool.jsonSchema.required).toEqual(['tasksPath'])
  })

  it('updateTaskTool infers the task id when exactly one task is active', async () => {
    await updateTask({ tasksPath, taskId: 'task-001', status: 'spec_review' })
    await updateTask({ tasksPath, taskId: 'task-001', status: 'ready' })
    await updateTask({ tasksPath, taskId: 'task-001', status: 'in_progress' })
    const result = await updateTaskTool.execute(
      {
        tasksPath,
        status: 'review',
        note: {
          agentId: 'worker-agent',
          role: 'worker',
          content: 'Self-critique complete',
        },
      },
      ctx,
    )
    expect(result.is_error).toBe(false)
    expect(result.metadata?.taskId).toBe('task-001')
    const raw = JSON.parse(await fs.readFile(tasksPath, 'utf-8'))
    expect(raw.tasks[0].status).toBe('review')
    expect(raw.tasks[0].notes[0].content).toBe('Self-critique complete')
  })

  it('addTaskTool adds via engine interface', async () => {
    const result = await addTaskTool.execute(
      {
        tasksPath,
        task: {
          id: 'task-003',
          title: 'Via engine',
          description: 'x',
          domain: 'knit',
          projectPath: '/x',
          status: 'exploring',
          priority: 'normal',
          dependsOn: [],
          outOfScope: [],
          acceptanceCriteria: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      },
      ctx,
    )
    expect(result.is_error).toBe(false)
    expect(result.metadata?.taskId).toBe('task-003')
  })
})
