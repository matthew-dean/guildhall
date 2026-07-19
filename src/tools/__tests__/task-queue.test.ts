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
  materializeSplitChildren,
  materializeProofSetupTask,
  settleMaterializedSplitReadiness,
} from '../task-queue.js'
import {
  getProjectSystemStatePath,
  promoteProjectStateDatabaseAuthority,
  readProjectStateDatabaseQueueRevision,
  readProjectStateDatabaseTask,
  readProjectTaskQueueSync as readProjectTaskQueueSyncRaw,
  readTaskEvidence,
  upsertTaskRuntimeState,
  appendTaskEvidence,
} from '@guildhall/sessions'
import { TaskQueue } from '@guildhall/core'
import {
  writeProjectTaskQueue,
  writeProjectTaskQueueWithSummary,
} from '../../runtime/project-state-boundary.js'
import { buildEffectiveTask } from '../../runtime/effective-task.js'

// ---------------------------------------------------------------------------
// Tests for task queue tools — these are safety-critical (gate logic depends
// on them) so coverage must be thorough.
// ---------------------------------------------------------------------------

let tmpDir: string
let tasksPath: string
let seedQueue: ReturnType<typeof makeSeedQueue>

function makeSeedQueue() {
  return {
  version: 1,
  lastUpdated: new Date().toISOString(),
  tasks: [
    {
      id: 'task-001',
      title: 'Test task',
      description: 'A test task',
      domain: 'looma',
      projectPath: tmpDir,
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
}

async function seedSystemStateQueue(stateTasksPath: string): Promise<void> {
  // The root TASKS fixture and the system-local fixture map to different
  // SQLite paths. Remove the empty system database created by the shared
  // beforeEach so this test can exercise the real bootstrap path.
  await fs.rm(path.join(path.dirname(stateTasksPath), 'project-state.db'), { force: true })
  writeProjectTaskQueue(stateTasksPath, seedQueue, { projectRoot: tmpDir })
  promoteProjectStateDatabaseAuthority(tmpDir)
}

const ctx = { cwd: '/tmp', metadata: {} }

type TestTaskQueue = Omit<TaskQueue, 'tasks' | 'executionPlanActions'> & {
  tasks: [TaskQueue['tasks'][number], ...TaskQueue['tasks']]
  executionPlanActions: NonNullable<TaskQueue['executionPlanActions']>
}

function readProjectTaskQueueSync(statePath: string): TestTaskQueue {
  return TaskQueue.parse(readProjectTaskQueueSyncRaw(statePath)) as TestTaskQueue
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-test-'))
  tasksPath = path.join(tmpDir, 'TASKS.json')
  seedQueue = makeSeedQueue()
  writeProjectTaskQueue(tasksPath, seedQueue, { projectRoot: tmpDir })
  promoteProjectStateDatabaseAuthority(tmpDir)
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
    const result = await readTasks({ tasksPath: path.join(tmpDir, 'missing', 'TASKS.json') })
    expect(result.queue).toBeNull()
    expect(result.error).toBeDefined()
  })

  it('returns null queue with error for malformed JSON', async () => {
    const malformedPath = path.join(tmpDir, 'malformed', 'TASKS.json')
    await fs.mkdir(path.dirname(malformedPath), { recursive: true })
    await fs.writeFile(malformedPath, '{ invalid json', 'utf-8')
    const result = await readTasks({ tasksPath: malformedPath })
    expect(result.queue).toBeNull()
    expect(result.error).toBeDefined()
  })
})

describe('updateTask', () => {
  it('does not let the spec agent enter spec_review without a durable spec', async () => {
    const result = await updateTask(
      { tasksPath, taskId: 'task-001', status: 'spec_review' },
      { current_agent_id: 'spec-agent' },
    )

    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining('without a durable spec'),
    })
    expect(readProjectTaskQueueSync(tasksPath).tasks[0].status).toBe('exploring')
  })

  it('rejects recovery/process history inside the current task spec', async () => {
    const result = await updateTask(
      {
        tasksPath,
        taskId: 'task-001',
        spec: [
          '## Summary',
          'Build the current task.',
          '',
          'Resolved owner decisions:',
          '- Exceeded maxRevisions (3). Requires human judgment.',
        ].join('\n'),
      },
      { current_agent_id: 'spec-agent' },
    )

    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining('Current task specs may only contain the product boundary'),
    })
    expect(readProjectTaskQueueSync(tasksPath).tasks[0]?.spec).toBeUndefined()
  })

  it('rejects bare workspace proof commands in a selected script-only release', async () => {
    const queue = TaskQueue.parse({
      ...seedQueue,
      selectedReleaseId: 'release-1',
      releases: [{
        id: 'release-1',
        label: 'Stage 1',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        nodeIds: [],
        deferredNodeIds: [],
        proofStyle: 'script_only',
      }],
      tasks: [{
        ...seedQueue.tasks[0],
        releaseIds: ['release-1'],
      }],
    })
    writeProjectTaskQueue(tasksPath, queue, { projectRoot: tmpDir })

    const result = await updateTask({
      tasksPath,
      taskId: 'task-001',
      acceptanceCriteria: [{
        id: 'ac-1',
        description: 'The focused proof passes.',
        verifiedBy: 'automated',
        command: 'pnpm test',
      }],
    }, { current_agent_id: 'spec-agent' })

    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining('Bare workspace test/build commands'),
    })
    expect(readProjectTaskQueueSync(tasksPath).tasks[0]?.acceptanceCriteria).toEqual([])
  })

  it('updates task status', async () => {
    await updateTask({ tasksPath, taskId: 'task-001', status: 'spec_review' })
    const raw = readProjectTaskQueueSync(tasksPath)
    expect(raw.tasks[0].status).toBe('spec_review')
  })

  it('allows spec review tasks to return to exploring when a revision is requested', async () => {
    await updateTask({ tasksPath, taskId: 'task-001', status: 'spec_review' })
    const result = await updateTask({ tasksPath, taskId: 'task-001', status: 'exploring' })

    expect(result.success).toBe(true)

    const raw = readProjectTaskQueueSync(tasksPath)
    expect(raw.tasks[0].status).toBe('exploring')
  })

  it('updates task domain for lane repair', async () => {
    await updateTask({ tasksPath, taskId: 'task-001', domain: 'harness' })
    const raw = readProjectTaskQueueSync(tasksPath)
    expect(raw.tasks[0].domain).toBe('harness')
  })

  it('persists updates through the project-state boundary', async () => {
    await updateTask({ tasksPath, taskId: 'task-001', title: 'Boundary-safe title' })

    const raw = readProjectTaskQueueSync(tasksPath)
    expect(raw.tasks[0].title).toBe('Boundary-safe title')
    await expect(readTasks({ tasksPath })).resolves.toMatchObject({
      queue: { tasks: [expect.objectContaining({ title: 'Boundary-safe title' })] },
    })
  })

  it('uses the promoted point writer while keeping runtime and note evidence separate', async () => {
    const stateDir = path.join(tmpDir, '.guildhall', 'project-state')
    const promotedTasksPath = path.join(stateDir, 'TASKS.json')
    await fs.mkdir(stateDir, { recursive: true })
    await fs.writeFile(promotedTasksPath, '{}', 'utf-8')
    writeProjectTaskQueue(promotedTasksPath, seedQueue, { projectRoot: tmpDir })
    promoteProjectStateDatabaseAuthority(tmpDir)
    const before = readProjectStateDatabaseQueueRevision(promotedTasksPath)
    const result = await updateTask(
      {
        tasksPath: promotedTasksPath,
        taskId: 'task-001',
        title: 'Point-written title',
        assignedTo: 'worker-agent',
        note: { agentId: 'worker-agent', role: 'worker', content: 'Updated the definition.' },
      },
      { current_task_project_path: tmpDir },
    )

    expect(result.success).toBe(true)
    expect(readProjectStateDatabaseQueueRevision(promotedTasksPath)).toBeGreaterThan(before!)
    expect(readProjectStateDatabaseTask(promotedTasksPath, 'task-001')?.definition).toMatchObject({
      title: 'Point-written title',
    })
    expect(readProjectStateDatabaseTask(tasksPath, 'task-001')?.definition).not.toHaveProperty('assignedTo')
    expect((await readTaskEvidence(tmpDir, 'task-001', { kind: 'note' }))[0]?.payload).toMatchObject({
      content: 'Updated the definition.',
    })
  })

  it('preserves runtime counters when a promoted definition mutation writes status or evidence', async () => {
    const stateDir = path.join(tmpDir, '.guildhall', 'project-state')
    const promotedTasksPath = path.join(stateDir, 'TASKS.json')
    await fs.mkdir(stateDir, { recursive: true })
    seedQueue.tasks[0]!.status = 'in_progress'
    await fs.writeFile(promotedTasksPath, '{}', 'utf-8')
    writeProjectTaskQueue(promotedTasksPath, seedQueue, { projectRoot: tmpDir })
    promoteProjectStateDatabaseAuthority(tmpDir)
    await upsertTaskRuntimeState(tmpDir, 'task-001', {
      assignedTo: 'worker-agent',
      revisionCount: 2,
      remediationAttempts: 1,
    })

    const result = await updateTask({
      tasksPath: promotedTasksPath,
      taskId: 'task-001',
      status: 'review',
      note: { agentId: 'worker-agent', role: 'self-critique', content: 'Handed off for review.' },
    }, { current_task_project_path: tmpDir })

    expect(result.success).toBe(true)
    const effective = await buildEffectiveTask(
      tmpDir,
      TaskQueue.parse(readProjectTaskQueueSync(promotedTasksPath)).tasks[0]!,
    )
    expect(effective.status).toBe('review')
    expect(effective.revisionCount).toBe(2)
    expect(effective.remediationAttempts).toBe(1)
    expect(effective.assignedTo).toBe('reviewer-agent')
  })

  it('normalizes reviewer ownership when a task moves into review', async () => {
    await updateTask({ tasksPath, taskId: 'task-001', status: 'spec_review' })
    await updateTask({ tasksPath, taskId: 'task-001', status: 'ready' })
    await updateTask({ tasksPath, taskId: 'task-001', status: 'in_progress' })
    await updateTask({ tasksPath, taskId: 'task-001', status: 'review' })
    const raw = readProjectTaskQueueSync(tasksPath)
    const effective = await buildEffectiveTask(tmpDir, TaskQueue.parse(raw).tasks[0]!)
    expect(raw.tasks[0].status).toBe('review')
    expect(effective.assignedTo).toBe('reviewer-agent')
  })

  it('normalizes gate-checker ownership when a task moves into gate_check', async () => {
    await updateTask({ tasksPath, taskId: 'task-001', status: 'spec_review' })
    await updateTask({ tasksPath, taskId: 'task-001', status: 'ready' })
    await updateTask({ tasksPath, taskId: 'task-001', status: 'in_progress' })
    await updateTask({ tasksPath, taskId: 'task-001', status: 'review' })
    await updateTask({ tasksPath, taskId: 'task-001', status: 'gate_check' })
    const raw = readProjectTaskQueueSync(tasksPath)
    const effective = await buildEffectiveTask(tmpDir, TaskQueue.parse(raw).tasks[0]!)
    expect(raw.tasks[0].status).toBe('gate_check')
    expect(effective.assignedTo).toBe('gate-checker-agent')
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
    const raw = readProjectTaskQueueSync(tasksPath)
    const effective = await buildEffectiveTask(tmpDir, TaskQueue.parse(raw).tasks[0]!)
    expect(effective.assignedTo).toBe('custom-review-owner')
  })

  it('rejects impossible explicit status jumps through the transition boundary', async () => {
    const result = await updateTask({ tasksPath, taskId: 'task-001', status: 'review' })

    expect(result.success).toBe(false)
    expect(result.error).toContain('cannot request review from exploring')

    const raw = readProjectTaskQueueSync(tasksPath)
    expect(raw.tasks[0].status).toBe('exploring')
  })

  it('updates task title', async () => {
    await updateTask({ tasksPath, taskId: 'task-001', title: 'Write a clear implementation spec' })
    const raw = readProjectTaskQueueSync(tasksPath)
    expect(raw.tasks[0].title).toBe('Write a clear implementation spec')
  })

  it('appends a note to a task', async () => {
    await updateTask({
      tasksPath,
      taskId: 'task-001',
      note: { agentId: 'spec-agent', role: 'spec', content: 'Spec complete.' },
    })
    const evidence = await readTaskEvidence(tmpDir, 'task-001', { kind: 'note' })
    expect(evidence).toHaveLength(1)
    expect(evidence[0]?.payload).toMatchObject({
      agentId: 'spec-agent',
      role: 'spec',
      content: 'Spec complete.',
    })
    expect((evidence[0]?.payload as { timestamp?: string }).timestamp).toBeDefined()
  })

  it('writes note evidence to the task project root when TASKS lives under project-state', async () => {
    const stateDir = path.join(tmpDir, '.guildhall', 'project-state')
    const stateTasksPath = path.join(stateDir, 'TASKS.json')
    await fs.mkdir(stateDir, { recursive: true })
    seedQueue.tasks[0]!.status = 'in_progress'
    await seedSystemStateQueue(stateTasksPath)

    const result = await updateTask({
      tasksPath: stateTasksPath,
      taskId: 'task-001',
      status: 'review',
      note: {
        agentId: 'worker-agent',
        role: 'self-critique',
        content: '**Self-critique:**\n\nAC-1: Met.\n\n**Minimum-scope check:** yes.',
      },
    })
    expect(result.success).toBe(true)

    const evidence = await readTaskEvidence(tmpDir, 'task-001', { kind: 'note' })
    expect(evidence.at(-1)?.payload).toMatchObject({
      agentId: 'worker-agent',
      role: 'self-critique',
      content: '**Self-critique:**\n\nAC-1: Met.\n\n**Minimum-scope check:** yes.',
    })
    const misplaced = await readTaskEvidence(path.join(tmpDir, '.guildhall'), 'task-001', { kind: 'note' })
    expect(misplaced).toHaveLength(0)
  })

  it('uses task metadata as the evidence root when a system-local TASKS record has a relative projectPath', async () => {
    const stateTasksPath = getProjectSystemStatePath(tmpDir, 'TASKS.json')
    await fs.mkdir(path.dirname(stateTasksPath), { recursive: true })
    seedQueue.tasks[0]!.projectPath = '.'
    seedQueue.tasks[0]!.status = 'in_progress'
    await seedSystemStateQueue(stateTasksPath)

    const result = await updateTask({
      tasksPath: stateTasksPath,
      taskId: 'task-001',
      note: {
        agentId: 'worker-agent',
        role: 'self-critique',
        content: '**Self-critique:** Metadata-rooted proof packet recorded.',
      },
    }, {
      current_agent_id: 'worker-agent',
      current_task_id: 'task-001',
      current_task_project_path: tmpDir,
    })
    expect(result.success).toBe(true)

    const raw = readProjectTaskQueueSync(stateTasksPath)
    const effective = await buildEffectiveTask(tmpDir, TaskQueue.parse(raw).tasks[0]!)
    expect(Array.isArray(effective.notes)).toBe(true)
    const effectiveNotes = effective.notes as Array<{ agentId: string; role: string; content: string }>
    expect(effectiveNotes.at(-1)).toMatchObject({
      agentId: 'worker-agent',
      role: 'self-critique',
      content: '**Self-critique:** Metadata-rooted proof packet recorded.',
    })

    const misplaced = await readTaskEvidence(path.dirname(stateTasksPath), 'task-001', { kind: 'note' })
    expect(misplaced).toHaveLength(0)
  })

  it('uses the workspace project root for evidence when the task target is a subdirectory', async () => {
    const stateTasksPath = getProjectSystemStatePath(tmpDir, 'TASKS.json')
    await fs.mkdir(path.dirname(stateTasksPath), { recursive: true })
    const docsTarget = path.join(tmpDir, 'docs', 'harness')
    seedQueue.tasks[0]!.projectPath = docsTarget
    seedQueue.tasks[0]!.status = 'in_progress'
    await seedSystemStateQueue(stateTasksPath)

    const result = await updateTask({
      tasksPath: stateTasksPath,
      taskId: 'task-001',
      note: {
        agentId: 'worker-agent',
        role: 'self-critique',
        content: '**Self-critique:** Subdirectory-targeted task proof recorded.',
      },
    }, {
      current_agent_id: 'worker-agent',
      current_task_id: 'task-001',
      current_task_project_path: docsTarget,
      current_task_workspace_project_path: tmpDir,
    })
    expect(result.success).toBe(true)

    const raw = readProjectTaskQueueSync(stateTasksPath)
    const effective = await buildEffectiveTask(tmpDir, TaskQueue.parse(raw).tasks[0]!)
    const effectiveNotes = effective.notes as Array<{ agentId: string; role: string; content: string }> | undefined
    expect(effectiveNotes?.at(-1)).toMatchObject({
      agentId: 'worker-agent',
      role: 'self-critique',
      content: '**Self-critique:** Subdirectory-targeted task proof recorded.',
    })

    const misplaced = await readTaskEvidence(docsTarget, 'task-001', { kind: 'note' })
    expect(misplaced).toHaveLength(0)
  })

  it('accepts a plain note string and structures it from current agent metadata', async () => {
    const stateTasksPath = getProjectSystemStatePath(tmpDir, 'TASKS.json')
    await fs.mkdir(path.dirname(stateTasksPath), { recursive: true })
    seedQueue.tasks[0]!.status = 'in_progress'
    await seedSystemStateQueue(stateTasksPath)

    const result = await updateTask({
      tasksPath: stateTasksPath,
      taskId: 'task-001',
      note: '**Self-critique:** All acceptance criteria are met.',
    }, {
      current_agent_id: 'worker-agent',
      current_task_id: 'task-001',
      current_task_workspace_project_path: tmpDir,
    })

    expect(result.success).toBe(true)
    const raw = readProjectTaskQueueSync(stateTasksPath)
    const effective = await buildEffectiveTask(tmpDir, TaskQueue.parse(raw).tasks[0]!)
    const effectiveNotes = effective.notes as Array<{ agentId: string; role: string; content: string }>
    expect(effectiveNotes.at(-1)).toMatchObject({
      agentId: 'worker-agent',
      role: 'self-critique',
      content: '**Self-critique:** All acceptance criteria are met.',
    })
  })

  it('accepts a stringified note object from model tool calls', async () => {
    await updateTaskTool.execute({
      tasksPath,
      taskId: 'task-001',
      note: JSON.stringify({
        agentId: 'worker-agent',
        role: 'self-critique',
        content: '**Self-critique:** Review proof packet recorded.',
      }),
    }, ctx)

    const evidence = await readTaskEvidence(tmpDir, 'task-001', { kind: 'note' })
    expect(evidence.at(-1)?.payload).toMatchObject({
      agentId: 'worker-agent',
      role: 'self-critique',
      content: '**Self-critique:** Review proof packet recorded.',
    })
  })

  it('accepts a stringified note object during engine input validation', () => {
    const parsed = updateTaskTool.inputSchema.safeParse({
      tasksPath,
      taskId: 'task-001',
      note: JSON.stringify({
        agentId: 'worker-agent',
        role: 'self-critique',
        content: '**Self-critique:** Review proof packet recorded.',
      }),
    })

    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(parsed.data.note).toMatchObject({
      agentId: 'worker-agent',
      role: 'self-critique',
      content: '**Self-critique:** Review proof packet recorded.',
    })
  })

  it('accepts a multiline JSON-shaped note string during engine input validation', () => {
    const parsed = updateTaskTool.inputSchema.safeParse({
      tasksPath,
      taskId: 'task-001',
      note:
        '{"agentId":"worker-agent","role":"self-critique","content":"**Self-critique:**\n\nAC4: `npm run verify:schemas` passed."}',
    })

    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(parsed.data.note).toMatchObject({
      agentId: 'worker-agent',
      role: 'self-critique',
      content: '**Self-critique:**\n\nAC4: `npm run verify:schemas` passed.',
    })
  })

  it('unwraps a malformed JSON-shaped note wrapper from structured note content', async () => {
    await updateTaskTool.execute({
      tasksPath,
      taskId: 'task-001',
      note: {
        agentId: 'worker-agent',
        role: 'self-critique',
        content:
          '{"agentId":"worker-agent","role":"self-critique","content":"**Self-critique:**\\n\\nAC 1: Met.\\n\\nMinimum-scope check: only scripts/run-packet.mjs changed.',
      },
    }, ctx)

    const evidence = await readTaskEvidence(tmpDir, 'task-001', { kind: 'note' })
    expect(evidence.at(-1)?.payload).toMatchObject({
      agentId: 'worker-agent',
      role: 'self-critique',
      content:
        '**Self-critique:**\n\nAC 1: Met.\n\nMinimum-scope check: only scripts/run-packet.mjs changed.',
    })
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
    const raw = readProjectTaskQueueSync(tasksPath)
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
        source: 'documented',
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

    const raw = readProjectTaskQueueSync(tasksPath)
    expect((raw.tasks[0].structuredSpec as { whatThisIs?: string } | undefined)?.whatThisIs).toBe('A block menu for Looma selection actions.')
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
        source: 'documented',
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

  it('records a decomposition sizing plan without persisted child recommendations when shaped work is too large', async () => {
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

    const raw = readProjectTaskQueueSync(tasksPath)
    expect(raw.tasks[0].sizePlan).toMatchObject({
      taskId: 'task-001',
      score: 8,
      band: 'epic',
      action: 'decompose_before_execution',
    })
    expect((raw.tasks[0] as unknown as Record<string, unknown>).parentGoalId).toBeUndefined()
    expect(raw.tasks[0].sizePlan?.recommendedChildren).toEqual([])
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
    const workUnitAnalysis = {
      summary: 'Five independently deliverable work units.',
      units: [
        {
          id: 'billing-ui',
          title: 'Implement the billing settings workflow',
          deliverable: 'Billing settings can update subscriptions.',
          rationale: 'The UI workflow can be reviewed separately from the API and migration work.',
          suggestedDomain: 'frontend',
          dependsOn: [],
        },
        {
          id: 'admin-api',
          title: 'Add the admin subscription API contract',
          deliverable: 'Admin API returns subscription status.',
          rationale: 'The API contract is independently verifiable.',
          suggestedDomain: 'backend',
          dependsOn: [],
        },
        {
          id: 'migration',
          title: 'Migrate existing workspace subscription data',
          deliverable: 'Existing workspace subscriptions are backfilled.',
          rationale: 'Migration safety needs its own proof loop.',
          suggestedDomain: 'data',
          dependsOn: ['admin-api'],
        },
        {
          id: 'invite-email',
          title: 'Implement invite email delivery',
          deliverable: 'Invite emails are sent.',
          rationale: 'Delivery behavior is separate from data migration.',
          suggestedDomain: 'backend',
          dependsOn: [],
        },
        {
          id: 'analytics-rollout',
          title: 'Update analytics documentation and rollout evidence',
          deliverable: 'Analytics events and rollout evidence are documented.',
          rationale: 'Docs and rollout proof should stay separate from code changes.',
          suggestedDomain: 'docs',
          dependsOn: [],
        },
      ],
      proofOnlyItems: [],
      createdAt: '2026-05-25T12:00:00.000Z',
      createdBy: 'coordinator-test',
    }

    await updateTask({ tasksPath, taskId: 'task-001', status: 'ready', spec, acceptanceCriteria, workUnitAnalysis })
    await updateTask({ tasksPath, taskId: 'task-001', status: 'ready', spec, acceptanceCriteria, workUnitAnalysis })

    const raw = readProjectTaskQueueSync(tasksPath)
    const parent = raw.tasks.find((task: { id: string }) => task.id === 'task-001')!
    const children = raw.tasks.filter((task: { id: string; hierarchy?: { parentId?: string } }) =>
      task.id !== 'task-001' && task.hierarchy?.parentId === 'task-001',
    )

    expect(parent.sizePlan?.action).toBe('proceed_with_warning')
    expect(parent.sizePlan?.reasons.at(-1)).toContain('Linked child tasks already represent this parent')
    expect(parent.taskReadiness?.recommendation).toBe('ready')
    expect(parent.taskReadiness?.summary).toContain('continue through the child tasks')
    expect(parent.taskReadiness?.dimensions.find((dimension: { id: string }) => dimension.id === 'size')?.status).toBe('ok')
    expect(parent.status).toBe('ready')
    expect(parent.hierarchy?.childIds).toEqual(children.map((task: { id: string }) => task.id))
    expect(raw.executionPlanActions).toHaveLength(1)
    expect(raw.executionPlanActions[0]).toMatchObject({
      type: 'split_work',
      targetWorkId: 'task-001',
      status: 'applied',
      authority: 'execution_planning',
      createdChildIds: children.map((task: { id: string }) => task.id),
    })
    expect(children.map((task: { title: string }) => task.title)).toEqual([
      'Implement the billing settings workflow',
      'Add the admin subscription API contract',
      'Migrate existing workspace subscription data',
      'Implement invite email delivery',
      'Update analytics documentation and rollout evidence',
    ])
    expect(children.every((task) =>
      task.status === 'exploring' &&
      task.origination === 'system' &&
      task.proposedBy === 'task-sizing',
    )).toBe(true)
    expect(parent.sizePlan?.recommendedChildren).toEqual([])
  })

  it('materializes split-recommended work units into linked child tasks idempotently', async () => {
    const workUnitAnalysis = {
      summary: '4 independently deliverable work units: component implementation, Storybook story, contract README, and API docs sync.',
      units: [
        {
          id: 'wu-1',
          title: 'Component implementation',
          deliverable: 'ContextMenu component implementation is available.',
          rationale: 'The runtime component is the base deliverable.',
          suggestedDomain: 'frontend',
          dependsOn: [],
        },
        {
          id: 'wu-2',
          title: 'Storybook story',
          deliverable: 'ContextMenu has a Storybook story.',
          rationale: 'Visual proof can be reviewed separately.',
          suggestedDomain: 'frontend',
          dependsOn: ['wu-1'],
        },
        {
          id: 'wu-3',
          title: 'Contract README',
          deliverable: 'ContextMenu has contract documentation.',
          rationale: 'Consumer-facing contract text can be reviewed separately.',
          suggestedDomain: 'docs',
          dependsOn: ['wu-1'],
        },
        {
          id: 'wu-4',
          title: 'API docs sync',
          deliverable: 'Public API docs include ContextMenu.',
          rationale: 'Export and API documentation sync is independently checkable.',
          suggestedDomain: 'docs',
          dependsOn: ['wu-1'],
        },
      ],
      proofOnlyItems: [],
      createdAt: '2026-06-05T12:00:00.000Z',
      createdBy: 'coordinator-test',
    }

    await updateTask({
      tasksPath,
      taskId: 'task-001',
      status: 'ready',
      workUnitAnalysis,
      delivery: { driver: 'knit', provider: 'looma', supports: ['task-knit-context-actions'] },
    })
    await updateTask({ tasksPath, taskId: 'task-001', status: 'ready', workUnitAnalysis })

    const raw = readProjectTaskQueueSync(tasksPath)
    const parent = raw.tasks.find((task: { id: string }) => task.id === 'task-001')!
    const children = raw.tasks.filter((task: { id: string; hierarchy?: { parentId?: string } }) =>
      task.id !== 'task-001' && task.hierarchy?.parentId === 'task-001',
    )

    expect(parent.sizePlan?.action).toBe('proceed_with_warning')
    expect(parent.sizePlan?.reasons.at(-1)).toContain('Linked child tasks already represent this parent')
    expect(parent.taskReadiness?.recommendation).toBe('ready')
    expect(parent.taskReadiness?.summary).toContain('continue through the child tasks')
    expect(parent.taskReadiness?.dimensions.find((dimension: { id: string }) => dimension.id === 'size')?.status).toBe('ok')
    expect(parent.status).toBe('ready')
    expect(parent.hierarchy?.childIds).toEqual(children.map((task: { id: string }) => task.id))
    expect(children.map((task: { title: string }) => task.title)).toEqual([
      'Component implementation',
      'Storybook story',
      'Contract README',
      'API docs sync',
    ])
    expect(raw.tasks).toHaveLength(5)
    expect(parent.sizePlan?.recommendedChildren).toEqual([])
    expect(children.find((task: { title: string }) => task.title === 'Component implementation')?.workKind).toBe('component')
    expect(children.find((task: { title: string }) => task.title === 'Storybook story')?.workKind).toBe('story')
    expect(children.every((task: { delivery?: { driver?: string; provider?: string; supports?: string[] } }) =>
      task.delivery?.driver === 'knit' &&
      task.delivery?.provider === 'looma' &&
      task.delivery?.supports?.includes('task-001') &&
      task.delivery?.supports?.includes('task-knit-context-actions'),
    )).toBe(true)
    expect(children.find((task: { title: string }) => task.title === 'Storybook story')?.dependsOn).toEqual([
      'task-001-split-component-implementation',
    ])
  })

  it('materializes verification split children as internal delivery steps on the parent', async () => {
    const parentTask = structuredClone(seedQueue.tasks[0]!)
    const queue = TaskQueue.parse({
      version: 1,
      lastUpdated: '2026-06-12T00:00:00.000Z',
      tasks: [
        {
          ...parentTask,
          status: 'ready',
          sizePlan: {
            taskId: 'task-001',
            score: 8,
            band: 'large',
            action: 'split_required',
            factors: [],
            recommendedChildren: [
              {
                title: 'Implement import review flow',
                reason: 'Keep the product change separate from proof.',
                suggestedDomain: 'product',
                dependsOn: [],
              },
              {
                title: 'Runtime proof for import review flow',
                reason: 'Keep proof explicit without adding another visible work item.',
                suggestedDomain: 'product',
                dependsOn: ['Implement import review flow'],
              },
            ],
            reasons: ['Broad enough to split.'],
            reviewBudgetHint: 'balanced',
            createdAt: '2026-06-12T00:00:00.000Z',
            createdBy: 'test',
          },
        },
      ],
    })
    const parent = queue.tasks[0]!

    materializeSplitChildren(queue, parent, '2026-06-12T00:00:00.000Z')

    const proofChild = queue.tasks.find(task => task.title === 'Runtime proof for import review flow')
    expect(proofChild).toBeDefined()
    if (!proofChild) throw new Error('Expected proof child to be materialized')

    expect(proofChild).toMatchObject({
      workKind: 'test',
      workVisibility: { kind: 'internal_step', countInProjectTotals: false },
    })
    expect(parent.deliverySteps).toEqual([
      expect.objectContaining({
        id: `task:${proofChild.id}`,
        title: 'Runtime proof for import review flow',
        kind: 'verify',
        status: 'todo',
        sourceTaskId: proofChild.id,
      }),
    ])
  })

  it('does not inherit reserved workspace-import domains for executable split children', async () => {
    const timestamp = '2026-06-12T00:00:00.000Z'
    const parentTask = structuredClone(seedQueue.tasks[0]!)
    const queue = TaskQueue.parse({
      version: 1,
      lastUpdated: timestamp,
      tasks: [
        {
          ...parentTask,
          id: 'existing-harness-task',
          domain: 'harness',
        },
        {
          ...parentTask,
          id: 'expansion-task-full-decomposition',
          title: 'Expand backlog into full doc-to-task decomposition',
          domain: '_workspace_import',
          status: 'ready',
          sizePlan: {
            taskId: 'expansion-task-full-decomposition',
            score: 8,
            band: 'large',
            action: 'split_required',
            factors: [],
            recommendedChildren: [
              {
                title: 'Implement the first independently verifiable replacement',
                reason: 'Make the first replacement executable.',
                dependsOn: [],
              },
            ],
            reasons: ['Broad enough to split.'],
            reviewBudgetHint: 'balanced',
            createdAt: timestamp,
            createdBy: 'test',
          },
        },
      ],
    })
    const parent = queue.tasks.find(task => task.id === 'expansion-task-full-decomposition')!

    materializeSplitChildren(queue, parent, timestamp)

    const child = queue.tasks.find(task => task.title === 'Implement the first independently verifiable replacement')
    expect(child).toBeDefined()
    expect(child?.domain).toBe('harness')
  })

  it('reattaches generated split rows and inherits parent release/source truth', async () => {
    const timestamp = '2026-06-12T00:00:00.000Z'
    const queue = TaskQueue.parse({
      version: 1,
      lastUpdated: timestamp,
      tasks: [
        {
          ...structuredClone(seedQueue.tasks[0]!),
          id: 'task-runner',
          title: 'Implement a no-UI runner',
          status: 'ready',
          releaseIds: ['stage-1-fixture-and-evaluation-harness'],
          references: ['docs/harness/implementation-roadmap.md'],
          sizePlan: {
            taskId: 'task-runner',
            score: 8,
            band: 'large',
            action: 'split_required',
            factors: [],
            recommendedChildren: [
              {
                title: 'Build the bounded writer packet',
                reason: 'Prove packet discipline as a separate runnable child.',
                dependsOn: [],
              },
            ],
            reasons: ['Broad enough to split.'],
            reviewBudgetHint: 'balanced',
            createdAt: timestamp,
            createdBy: 'test',
          },
        },
        {
          ...structuredClone(seedQueue.tasks[0]!),
          id: 'task-runner-split-build-the-bounded-writer-packet',
          title: 'Build the bounded writer packet',
          description: 'Split from containing work task-runner: Implement a no-UI runner.',
          status: 'done',
          releaseIds: [],
          references: [],
          hierarchy: { childIds: [], order: 0 },
        },
      ],
    })
    const parent = queue.tasks[0]!

    const result = materializeSplitChildren(queue, parent, timestamp)

    expect(result.childTaskIds).toEqual(['task-runner-split-build-the-bounded-writer-packet'])
    expect(queue.tasks).toHaveLength(2)
    expect(queue.tasks[1]).toMatchObject({
      status: 'done',
      releaseIds: ['stage-1-fixture-and-evaluation-harness'],
      references: ['docs/harness/implementation-roadmap.md'],
      hierarchy: {
        parentId: 'task-runner',
        order: 0,
        relation: 'decomposes',
      },
    })
    expect(parent.hierarchy?.childIds).toContain('task-runner-split-build-the-bounded-writer-packet')
  })

  it('settles duplicate sibling child-work plans without creating nested duplicate children', async () => {
    const timestamp = '2026-06-12T00:00:00.000Z'
    const queue = TaskQueue.parse({
      version: 1,
      lastUpdated: timestamp,
      tasks: [
        {
          ...structuredClone(seedQueue.tasks[0]!),
          id: 'parent',
          title: 'Replace primitives',
          status: 'ready',
          hierarchy: { childIds: ['child-audit', 'child-implement', 'child-verify'], order: 0 },
        },
        {
          ...structuredClone(seedQueue.tasks[0]!),
          id: 'child-audit',
          title: 'Audit the remaining replacement scope',
          status: 'ready',
          hierarchy: {
            parentId: 'parent',
            childIds: [
              'child-audit-split-audit',
              'child-audit-split-implement',
              'child-audit-split-verify',
            ],
            order: 0,
          },
          sizePlan: {
            taskId: 'child-audit',
            score: 8,
            band: 'epic',
            action: 'split_required',
            factors: [],
            recommendedChildren: [
              { title: 'Audit the remaining replacement scope', reason: 'Duplicate current child.', dependsOn: [] },
              { title: 'Implement the first independently verifiable replacement', reason: 'Duplicate sibling.', dependsOn: [] },
              { title: 'Verify and update the migration record', reason: 'Duplicate sibling.', dependsOn: [] },
            ],
            reasons: ['Task size score: 8.'],
            reviewBudgetHint: 'release_critical',
            createdAt: timestamp,
            createdBy: 'test',
          },
        },
        {
          ...structuredClone(seedQueue.tasks[0]!),
          id: 'child-implement',
          title: 'Implement the first independently verifiable replacement',
          status: 'exploring',
          hierarchy: { parentId: 'parent', childIds: [], order: 1 },
        },
        {
          ...structuredClone(seedQueue.tasks[0]!),
          id: 'child-verify',
          title: 'Verify and update the migration record',
          status: 'exploring',
          hierarchy: { parentId: 'parent', childIds: [], order: 2 },
        },
        {
          ...structuredClone(seedQueue.tasks[0]!),
          id: 'child-audit-split-audit',
          title: 'Audit the remaining replacement scope',
          status: 'shelved',
          hierarchy: { parentId: 'child-audit', childIds: [], order: 0 },
        },
        {
          ...structuredClone(seedQueue.tasks[0]!),
          id: 'child-audit-split-implement',
          title: 'Implement the first independently verifiable replacement',
          status: 'shelved',
          hierarchy: { parentId: 'child-audit', childIds: [], order: 1 },
        },
        {
          ...structuredClone(seedQueue.tasks[0]!),
          id: 'child-audit-split-verify',
          title: 'Verify and update the migration record',
          status: 'shelved',
          hierarchy: { parentId: 'child-audit', childIds: [], order: 2 },
        },
      ],
    })
    const childAudit = queue.tasks.find(task => task.id === 'child-audit')!

    const result = materializeSplitChildren(queue, childAudit, timestamp)

    expect(result.status).toBe('already_represented')
    expect(result.childTaskIds).toEqual(['child-audit', 'child-implement', 'child-verify'])
    expect(queue.tasks).toHaveLength(7)
    expect(childAudit.hierarchy?.childIds).toEqual([])
    expect(queue.tasks.find(task => task.id === 'child-audit-split-audit')?.hierarchy?.parentId).toBeUndefined()
    expect(queue.tasks.find(task => task.id === 'child-audit-split-implement')?.hierarchy?.parentId).toBeUndefined()
    expect(queue.tasks.find(task => task.id === 'child-audit-split-verify')?.hierarchy?.parentId).toBeUndefined()
    expect(childAudit.sizePlan?.action).toBe('proceed_with_warning')
    expect(childAudit.sizePlan?.reasons.at(-1)).toContain('already matches existing sibling tasks')
    expect(childAudit.taskReadiness?.recommendation).toBe('ready')
    expect(childAudit.taskReadiness?.summary).toBe('This task is ready; sibling tasks already cover the split work.')
  })

  it('settles refreshed parent sizing when linked child tasks already represent the split', async () => {
    const timestamp = '2026-06-12T00:00:00.000Z'
    const queue = TaskQueue.parse({
      version: 1,
      lastUpdated: timestamp,
      tasks: [
        {
          ...structuredClone(seedQueue.tasks[0]!),
          id: 'parent',
          title: 'Build the release scope',
          status: 'spec_review',
          hierarchy: { childIds: ['child-audit', 'child-implement', 'child-verify'], order: 0 },
          spec: [
            '## Summary',
            'Build the release scope.',
            '',
            '## Completion Boundary',
            '- Product outcome: The release scope is ready.',
            '- What Guildhall can complete in code: Implement the release scope.',
            '- External dependencies: None.',
            '- Owner-only setup: None.',
            '- Verification environment: Local.',
            '- What counts as done: Linked proof is recorded.',
            '- What must be split or blocked: Audit, implementation, and verification must still be split before work can proceed.',
          ].join('\n'),
          structuredSpec: {
            whatThisIs: 'Build the release scope.',
            problemContext: 'Release scope parent.',
            goals: ['The release scope is ready.'],
            nonGoals: ['Do not implement child work inside the parent container.'],
            proposedDesign: 'Coordinate linked child work.',
            keyDecisions: ['Use linked child tasks as the execution boundary.'],
            acceptanceCriteria: [
              {
                scenario: 'Given linked child tasks',
                expectation: 'Then linked proof is recorded before the parent is closed.',
                verificationMode: 'review',
              },
            ],
            verification: ['Review linked task outcomes.'],
            completionBoundary: {
              productOutcome: 'The release scope is ready.',
              whatGuildhallCanCompleteInCode: 'Implement the release scope.',
              externalDependencies: 'None.',
              ownerOnlySetup: 'None.',
              verificationEnvironment: 'Local.',
              whatCountsAsDone: 'Linked proof is recorded.',
              whatMustBeSplitOrBlocked: 'Audit, implementation, and verification must still be split before work can proceed.',
            },
          },
          taskReadiness: {
            taskKind: 'implementation',
            recommendation: 'requires_child_work',
            summary: 'Task must be planned as child work before execution.',
            dimensions: [
              {
                id: 'size',
                status: 'blocked',
                summary: 'Too broad for one pass.',
                evidence: ['Split required before work can continue.'],
              },
            ],
            definitionOfDone: {
              items: ['Ship the release scope.'],
              evidenceRequired: ['Proof is recorded.'],
              updatedAt: timestamp,
              createdBy: 'test',
            },
            blockerPlans: [],
            contextBudget: {
              estimatedTokens: 12000,
              risk: 'high',
              fitsInOneWorkerBrief: false,
              reasons: ['Too large.'],
            },
            assessedAt: timestamp,
            assessedBy: 'test',
          },
        },
        {
          ...structuredClone(seedQueue.tasks[0]!),
          id: 'child-audit',
          title: 'Audit the remaining replacement scope',
          status: 'done',
          hierarchy: { parentId: 'parent', childIds: [], order: 0 },
        },
        {
          ...structuredClone(seedQueue.tasks[0]!),
          id: 'child-implement',
          title: 'Implement the first independently verifiable replacement',
          status: 'review',
          hierarchy: { parentId: 'parent', childIds: [], order: 1 },
        },
        {
          ...structuredClone(seedQueue.tasks[0]!),
          id: 'child-verify',
          title: 'Verify and update the migration record',
          status: 'exploring',
          hierarchy: { parentId: 'parent', childIds: [], order: 2 },
        },
      ],
    })
    const parent = queue.tasks.find(task => task.id === 'parent')!
    parent.sizePlan = {
      taskId: 'parent',
      score: 8,
      band: 'epic',
      action: 'split_required',
      factors: [],
      recommendedChildren: [
        {
          title: 'Implementation slice',
          reason: 'A stale coordinator title that no longer matches the child records exactly.',
          dependsOn: [],
        },
      ],
      reasons: ['Task size score: 8.', 'The task is too large for one high-quality agent pass and should become linked child tasks.'],
      reviewBudgetHint: 'release_critical',
      createdAt: timestamp,
      createdBy: 'test',
    }

    const result = settleMaterializedSplitReadiness(queue, parent, timestamp)

    expect(result?.childTaskIds).toEqual(['child-audit', 'child-implement', 'child-verify'])
    expect(parent.sizePlan.action).toBe('proceed_with_warning')
    expect(parent.sizePlan.recommendedChildren.map(child => child.title)).toEqual([
      'Audit the remaining replacement scope',
      'Implement the first independently verifiable replacement',
      'Verify and update the migration record',
    ])
    expect(parent.sizePlan.recommendedChildren.map(child => child.createdTaskId)).toEqual([
      'child-audit',
      'child-implement',
      'child-verify',
    ])
    expect(parent.sizePlan.reasons.at(-1)).toContain('Linked child tasks already represent this parent')
    expect(parent.taskReadiness?.recommendation).toBe('ready')
    expect(parent.taskReadiness?.summary).toContain('continue through the child tasks')
    expect(parent.taskReadiness?.dimensions.find(dimension => dimension.id === 'size')?.status).toBe('ok')
    expect(parent.structuredSpec?.completionBoundary.whatMustBeSplitOrBlocked).toContain('Already split into linked child tasks')
    expect(parent.spec).toContain('- What must be split or blocked: Already split into linked child tasks:')
    expect(parent.spec).toContain('child-audit, child-implement, child-verify')
    expect(parent.spec).not.toContain('must still be split before work can proceed')
    expect(queue.executionPlanActions).toHaveLength(1)
    expect(queue.executionPlanActions?.[0]).toMatchObject({
      type: 'split_work',
      targetWorkId: 'parent',
      status: 'applied',
      authority: 'execution_planning',
      createdChildIds: ['child-audit', 'child-implement', 'child-verify'],
    })
  })

  it('keeps a materialized split parent out of the ready worker queue', async () => {
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
      workUnitAnalysis: {
        summary: 'Five independently deliverable work units.',
        units: [
          {
            id: 'billing-ui',
            title: 'Implement the billing settings workflow',
            deliverable: 'Billing settings can update subscriptions.',
            rationale: 'The UI workflow can be reviewed separately from the API and migration work.',
            suggestedDomain: 'frontend',
            dependsOn: [],
          },
          {
            id: 'admin-api',
            title: 'Add the admin subscription API contract',
            deliverable: 'Admin API returns subscription status.',
            rationale: 'The API contract is independently verifiable.',
            suggestedDomain: 'backend',
            dependsOn: [],
          },
          {
            id: 'migration',
            title: 'Migrate existing workspace subscription data',
            deliverable: 'Existing workspace subscriptions are backfilled.',
            rationale: 'Migration safety needs its own proof loop.',
            suggestedDomain: 'data',
            dependsOn: ['admin-api'],
          },
          {
            id: 'invite-email',
            title: 'Implement invite email delivery',
            deliverable: 'Invite emails are sent.',
            rationale: 'Delivery behavior is separate from data migration.',
            suggestedDomain: 'backend',
            dependsOn: [],
          },
          {
            id: 'analytics-rollout',
            title: 'Update analytics documentation and rollout evidence',
            deliverable: 'Analytics events and rollout evidence are documented.',
            rationale: 'Docs and rollout proof should stay separate from code changes.',
            suggestedDomain: 'docs',
            dependsOn: [],
          },
        ],
        proofOnlyItems: [],
        createdAt: '2026-05-25T12:00:00.000Z',
        createdBy: 'coordinator-test',
      },
    })

    const raw = readProjectTaskQueueSync(tasksPath)
    expect(raw.tasks[0].sizePlan?.action).toBe('proceed_with_warning')
    expect(raw.tasks[0].taskReadiness?.recommendation).toBe('ready')
    expect(raw.tasks[0].taskReadiness?.summary).toContain('continue through the child tasks')
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
    const raw = readProjectTaskQueueSync(tasksPath)
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

    const raw = readProjectTaskQueueSync(tasksPath)
    expect(raw.tasks[0].sizePlan).toMatchObject({
      taskId: 'task-001',
      score: 1,
      action: 'proceed',
    })
    expect(raw.tasks[0].status).toBe('ready')
    expect((raw.tasks[0] as unknown as Record<string, unknown>).parentGoalId).toBeUndefined()
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

    const raw = readProjectTaskQueueSync(tasksPath)
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
    writeProjectTaskQueue(tasksPath, queue, { projectRoot: tmpDir })

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

    const raw = readProjectTaskQueueSync(tasksPath)
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
    writeProjectTaskQueue(tasksPath, importedQueue, { projectRoot: tmpDir })
    await appendTaskEvidence(tmpDir, 'task-001', {
      id: 'imported-note-001',
      kind: 'note',
      recordedAt: importedQueue.tasks[0]!.notes[0]!.timestamp,
      payload: importedQueue.tasks[0]!.notes[0]!,
    })

    await updateTask({
      tasksPath,
      taskId: 'task-001',
      spec: '## Summary\nAdd a version diff view to page history.',
    })

    const raw = readProjectTaskQueueSync(tasksPath)
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

    const raw = readProjectTaskQueueSync(tasksPath)
    expect(raw.tasks[0].acceptanceCriteria).toEqual([
      {
        id: 'ac-1',
        description: 'The table menu renders.',
        scenario: 'The table menu renders.',
        expectation: 'The table menu renders.',
        verifiedBy: 'review',
        met: false,
        source: 'documented',
      },
      {
        id: 'ac-2',
        description: '`pnpm -F web build` passes.',
        scenario: '`pnpm -F web build` passes.',
        expectation: '`pnpm -F web build` passes.',
        verifiedBy: 'review',
        met: false,
        source: 'documented',
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

    const raw = readProjectTaskQueueSync(tasksPath)
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
    const raw = readProjectTaskQueueSync(tasksPath)
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
    const raw = readProjectTaskQueueSync(tasksPath)
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

    const evidence = await readTaskEvidence(tmpDir, 'task-001', { kind: 'gate_result' })
    expect(evidence.map((event) => event.payload)).toEqual([
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

    const raw = readProjectTaskQueueSync(tasksPath)
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
        source: 'documented',
      },
    ])
    const evidence = await readTaskEvidence(tmpDir, 'task-001', { kind: 'gate_result' })
    expect(evidence.map((event) => event.payload)).toEqual([
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

    const raw = readProjectTaskQueueSync(tasksPath)
    expect(raw.tasks[0].status).toBe('spec_review')
  })
})

describe('materializeProofSetupTask', () => {
  it('creates one linked internal verification child and inherits release scope', async () => {
    const queue = TaskQueue.parse({
      ...seedQueue,
      selectedReleaseId: 'release-1',
      releases: [{
        id: 'release-1',
        label: 'Stage 1',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        nodeIds: [],
        deferredNodeIds: [],
        proofStyle: 'script_only',
      }],
      tasks: [{
        ...seedQueue.tasks[0],
        releaseIds: ['release-1'],
        references: ['docs/release-plan.md'],
      }],
    })
    const timestamp = '2026-07-18T20:00:00.000Z'

    const first = materializeProofSetupTask(queue, queue.tasks[0]!, timestamp)
    const second = materializeProofSetupTask(queue, queue.tasks[0]!, timestamp)
    const child = queue.tasks.find(task => task.id === first.childTaskId)

    expect(first.status).toBe('materialized')
    expect(second).toEqual({ status: 'already_represented', childTaskId: first.childTaskId })
    expect(child).toMatchObject({
      title: 'Establish concrete proof for Test task',
      status: 'exploring',
      workKind: 'verification',
      releaseIds: ['release-1'],
      references: ['docs/release-plan.md'],
      workVisibility: { kind: 'internal_step', countInProjectTotals: false },
      hierarchy: { parentId: 'task-001', relation: 'decomposes' },
    })
    expect(queue.tasks[0]!.hierarchy?.childIds).toContain(first.childTaskId)
    expect(queue.tasks[0]!.deliverySteps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceTaskId: first.childTaskId,
        kind: 'verify',
        blocksCompletion: true,
      }),
    ]))
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

    await expect(readTasks({ tasksPath })).resolves.toMatchObject({
      queue: {
        tasks: [
          expect.anything(),
          expect.objectContaining({ id: 'task-002' }),
        ],
      },
    })
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
      { tasksPath: path.join(tmpDir, 'missing', 'nope.json') },
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
    await expect(readTasks({ tasksPath })).resolves.toMatchObject({
      queue: { tasks: [expect.objectContaining({ status: 'review' })] },
    })
    const evidence = await readTaskEvidence(tmpDir, 'task-001', { kind: 'note' })
    expect(evidence[0]?.payload).toMatchObject({
      agentId: 'worker-agent',
      role: 'worker',
      content: 'Self-critique complete',
    })
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
