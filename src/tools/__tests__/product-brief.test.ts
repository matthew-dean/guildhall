import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { TaskQueue, type Task } from '@guildhall/core'
import {
  getProjectSystemStatePath,
  promoteProjectStateDatabaseAuthority,
  readProjectStateDatabaseAuthorityFromTasksPath,
  readProjectStateDatabaseQueueRevision,
  readProjectStateDatabaseTask,
} from '@guildhall/sessions'
import { updateProductBrief, updateProductBriefTool } from '../product-brief.js'
import { writeProjectTaskQueue } from '../../runtime/project-state-boundary.js'

let tmpDir: string
let tasksPath: string

const baseTask: Task = {
  id: 'task-1',
  title: 'Build the onboarding screen',
  description: 'First-time user journey',
  domain: 'looma',
  projectPath: '/tmp/test-project',
  status: 'exploring',
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
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-brief-'))
  tasksPath = path.join(tmpDir, 'TASKS.json')
  const queue: TaskQueue = {
    version: 1,
    lastUpdated: new Date().toISOString(),
    tasks: [baseTask],
  }
  await fs.writeFile(tasksPath, JSON.stringify(queue, null, 2), 'utf-8')
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('updateProductBrief', () => {
  it('writes through a bootstrap projection without treating its revision as a CAS token', async () => {
    const queue = TaskQueue.parse(JSON.parse(await fs.readFile(tasksPath, 'utf-8')))
    writeProjectTaskQueue(tasksPath, queue, { projectRoot: tmpDir })

    expect(readProjectStateDatabaseAuthorityFromTasksPath(tasksPath)).toBe('legacy')
    expect(readProjectStateDatabaseQueueRevision(tasksPath)).not.toBeNull()

    const result = await updateProductBrief({
      tasksPath,
      taskId: 'task-1',
      userJob: 'As a new user I want to set up the project quickly',
      successMetric: '90% of new users reach first task in <5 minutes',
      antiPatterns: ['no jargon in first three screens'],
      authoredBy: 'agent:spec-agent',
    })

    expect(result.success).toBe(true)
    expect(readProjectStateDatabaseTask(tasksPath, 'task-1')?.definition).toMatchObject({
      productBrief: { userJob: expect.stringMatching(/new user/) },
    })
  })

  it('uses the promoted point writer for a brief update', async () => {
    const queue = TaskQueue.parse(JSON.parse(await fs.readFile(tasksPath, 'utf-8')))
    const promotedTasksPath = getProjectSystemStatePath(tmpDir, 'TASKS.json')
    await fs.mkdir(path.dirname(promotedTasksPath), { recursive: true })
    await fs.writeFile(promotedTasksPath, '{}', 'utf-8')
    writeProjectTaskQueue(promotedTasksPath, queue, { projectRoot: tmpDir })
    promoteProjectStateDatabaseAuthority(tmpDir)
    const before = readProjectStateDatabaseQueueRevision(promotedTasksPath)

    const result = await updateProductBrief({
      tasksPath: promotedTasksPath,
      taskId: 'task-1',
      userJob: 'As a new user I want to set up the project quickly',
      successMetric: '90% of new users reach first task in <5 minutes',
      antiPatterns: ['no jargon in first three screens'],
      authoredBy: 'agent:spec-agent',
    })

    expect(result.success).toBe(true)
    expect(readProjectStateDatabaseQueueRevision(promotedTasksPath)).toBeGreaterThan(before!)
    expect(readProjectStateDatabaseTask(promotedTasksPath, 'task-1')?.definition).toMatchObject({
      productBrief: { userJob: 'As a new user I want to set up the project quickly' },
    })
  })

  it('authors a new brief on a task that has none', async () => {
    const result = await updateProductBrief({
      tasksPath,
      taskId: 'task-1',
      userJob: 'As a new user I want to set up the project quickly',
      successMetric: '90% of new users reach first task in <5 minutes',
      antiPatterns: ['no jargon in first three screens'],
      authoredBy: 'agent:spec-agent',
    })
    expect(result.success).toBe(true)
    const q = TaskQueue.parse(JSON.parse(await fs.readFile(tasksPath, 'utf-8')))
    expect(q.tasks[0]?.productBrief?.userJob).toMatch(/new user/)
    expect(q.tasks[0]?.productBrief?.authoredBy).toBe('agent:spec-agent')
    expect(q.tasks[0]?.productBrief?.approvedAt).toBeUndefined()
  })

  it('drops a prior approval when the brief body is materially changed', async () => {
    // Seed an already-approved brief.
    const q = TaskQueue.parse(JSON.parse(await fs.readFile(tasksPath, 'utf-8')))
    q.tasks[0]!.productBrief = {
      userJob: 'old job',
      successMetric: 'old metric',
      antiPatterns: [],
      authoredBy: 'agent:spec-agent',
      authoredAt: new Date().toISOString(),
      approvedBy: 'human',
      approvedAt: new Date().toISOString(),
    }
    await fs.writeFile(tasksPath, JSON.stringify(q, null, 2), 'utf-8')

    await updateProductBrief({
      tasksPath,
      taskId: 'task-1',
      userJob: 'brand new job — different from before',
      successMetric: 'brand new metric',
      antiPatterns: [],
      authoredBy: 'agent:spec-agent',
    })
    const updated = TaskQueue.parse(JSON.parse(await fs.readFile(tasksPath, 'utf-8')))
    expect(updated.tasks[0]?.productBrief?.approvedAt).toBeUndefined()
    expect(updated.tasks[0]?.productBrief?.approvedBy).toBeUndefined()
  })

  it('preserves an existing approval when re-authoring leaves userJob + successMetric unchanged', async () => {
    const q = TaskQueue.parse(JSON.parse(await fs.readFile(tasksPath, 'utf-8')))
    const approvedAt = new Date().toISOString()
    q.tasks[0]!.productBrief = {
      userJob: 'stable job',
      successMetric: 'stable metric',
      antiPatterns: ['original prohibition'],
      authoredBy: 'agent:spec-agent',
      authoredAt: approvedAt,
      approvedBy: 'human',
      approvedAt,
    }
    await fs.writeFile(tasksPath, JSON.stringify(q, null, 2), 'utf-8')

    // Same userJob + successMetric — only the anti-patterns change. The
    // approval should survive.
    await updateProductBrief({
      tasksPath,
      taskId: 'task-1',
      userJob: 'stable job',
      successMetric: 'stable metric',
      antiPatterns: ['revised prohibition 1', 'revised prohibition 2'],
      authoredBy: 'agent:spec-agent',
    })
    const updated = TaskQueue.parse(JSON.parse(await fs.readFile(tasksPath, 'utf-8')))
    expect(updated.tasks[0]?.productBrief?.approvedAt).toBe(approvedAt)
    expect(updated.tasks[0]?.productBrief?.antiPatterns).toEqual(['revised prohibition 1', 'revised prohibition 2'])
  })

  it('drops approval when the accepted capability scope changes', async () => {
    const q = TaskQueue.parse(JSON.parse(await fs.readFile(tasksPath, 'utf-8')))
    const approvedAt = new Date().toISOString()
    q.tasks[0]!.capabilityBindings = [
      { capabilityId: 'cap:world-state', relation: 'plans' },
      { capabilityId: 'cap:spatial-state', relation: 'plans' },
    ]
    q.tasks[0]!.productBrief = {
      userJob: 'stable job',
      successMetric: 'stable metric',
      antiPatterns: [],
      sourceCapabilityIds: ['cap:world-state'],
      authoredBy: 'agent:spec-agent',
      authoredAt: approvedAt,
      approvedBy: 'human',
      approvedAt,
    }
    await fs.writeFile(tasksPath, JSON.stringify(q, null, 2), 'utf-8')

    await updateProductBrief({
      tasksPath,
      taskId: 'task-1',
      userJob: 'stable job',
      successMetric: 'stable metric',
      antiPatterns: [],
      sourceCapabilityIds: ['cap:world-state', 'cap:spatial-state'],
      authoredBy: 'agent:spec-agent',
    })
    const updated = TaskQueue.parse(JSON.parse(await fs.readFile(tasksPath, 'utf-8')))
    expect(updated.tasks[0]?.productBrief?.approvedAt).toBeUndefined()
  })

  it('returns an error when the task does not exist', async () => {
    const result = await updateProductBrief({
      tasksPath,
      taskId: 'task-missing',
      userJob: 'x',
      successMetric: 'y',
      antiPatterns: [],
      authoredBy: 'agent:spec-agent',
    })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/not found/i)
  })

  it('rejects an empty brief call instead of inferring durable state from assistant prose', async () => {
    const result = await updateProductBriefTool.execute(
      {},
      {
        cwd: '/tmp',
        metadata: {
          tasks_path: tasksPath,
          current_task_id: 'task-1',
          current_agent_id: 'spec-agent',
          last_assistant_text: [
            'Great.',
            '',
            '### My best guess for task-1',
            'You want to make the setup flow easier for first-time users so they can reach useful work faster.',
            '',
            "Don't add marketing copy.",
          ].join('\n'),
        },
      },
    )
    expect(result.is_error).toBe(true)
    expect(result.output).toMatch(/does not infer durable product briefs from assistant prose/i)

    const q = TaskQueue.parse(JSON.parse(await fs.readFile(tasksPath, 'utf-8')))
    expect(q.tasks[0]?.productBrief).toBeUndefined()
  })

  it('tool execute recovers a nested serialized productBrief payload from a near-miss model call', async () => {
    const result = await updateProductBriefTool.execute(
      {
        productBrief: JSON.stringify({
          userJob: 'You want the editor table primitives available in Knit without forking Looma behavior.',
          successMetric: 'A developer can render and edit shared table primitives in Knit using the Looma-backed implementation.',
          antiPatterns: ['Do not copy the editor implementation into a Knit-only fork.'],
        }),
      },
      {
        cwd: '/tmp',
        metadata: {
          tasks_path: tasksPath,
          current_task_id: 'task-1',
          current_agent_id: 'spec-agent',
        },
      },
    )
    expect(result.is_error).toBe(false)

    const q = TaskQueue.parse(JSON.parse(await fs.readFile(tasksPath, 'utf-8')))
    expect(q.tasks[0]?.productBrief).toMatchObject({
      userJob: 'You want the editor table primitives available in Knit without forking Looma behavior.',
      successMetric: 'A developer can render and edit shared table primitives in Knit using the Looma-backed implementation.',
      antiPatterns: ['Do not copy the editor implementation into a Knit-only fork.'],
      authoredBy: 'spec-agent',
    })
  })

  it('tool execute recovers string antiPatterns into a normalized array', async () => {
    const result = await updateProductBriefTool.execute(
      {
        userJob: 'You want generated database types wired into the smallest useful Knit surfaces.',
        successMetric: 'The generated Database types are used in the intended Knit consumer without widening the migration.',
        antiPatterns: [
          '- Do not widen this into a full-schema migration.',
          '- Do not change the generation command or output path.',
        ].join('\n'),
      },
      {
        cwd: '/tmp',
        metadata: {
          tasks_path: tasksPath,
          current_task_id: 'task-1',
          current_agent_id: 'spec-agent',
        },
      },
    )
    expect(result.is_error).toBe(false)

    const q = TaskQueue.parse(JSON.parse(await fs.readFile(tasksPath, 'utf-8')))
    expect(q.tasks[0]?.productBrief).toMatchObject({
      antiPatterns: [
        'Do not widen this into a full-schema migration.',
        'Do not change the generation command or output path.',
      ],
    })
  })

  it('decodes JSON-encoded list values instead of persisting nested strings', async () => {
    const result = await updateProductBriefTool.execute(
      {
        userJob: 'You want a bounded narrative review contract.',
        successMetric: 'The review contract is stored with readable boundaries.',
        nonGoals: '["Do not add a UI.", "Do not widen the release."]',
      },
      {
        cwd: '/tmp',
        metadata: {
          tasks_path: tasksPath,
          current_task_id: 'task-1',
          current_agent_id: 'spec-agent',
        },
      },
    )
    expect(result.is_error).toBe(false)

    const q = TaskQueue.parse(JSON.parse(await fs.readFile(tasksPath, 'utf-8')))
    expect(q.tasks[0]?.productBrief?.nonGoals).toEqual([
      'Do not add a UI.',
      'Do not widen the release.',
    ])
  })

  it('stores product language without classifying the model prose style', async () => {
    const result = await updateProductBriefTool.execute(
      {
        userJob: 'Let me explore the Knit codebase to understand the current auth and member management setup before drafting the spec.',
        successMetric: 'Thread shows a drafted brief and actionable next step for "Proper invite flow (Supabase Auth invite by email)".',
      },
      {
        cwd: '/tmp',
        metadata: {
          tasks_path: tasksPath,
          current_task_id: 'task-1',
          current_agent_id: 'spec-agent',
        },
      },
    )

    expect(result.is_error).toBe(false)

    const q = TaskQueue.parse(JSON.parse(await fs.readFile(tasksPath, 'utf-8')))
    expect(q.tasks[0]?.productBrief?.userJob).toContain('Let me explore')
  })

  it('stores boundary prose without keyword-based recovery classification', async () => {
    const result = await updateProductBriefTool.execute(
      {
        userJob: 'I want the current story record slice implemented.',
        successMetric: 'The local proof passes.',
        nonGoals: ['Target directory structure does not match expected paths.'],
      },
      {
        cwd: '/tmp',
        metadata: {
          tasks_path: tasksPath,
          current_task_id: 'task-1',
          current_agent_id: 'spec-agent',
        },
      },
    )

    expect(result.is_error).toBe(false)
    const q = TaskQueue.parse(JSON.parse(await fs.readFile(tasksPath, 'utf-8')))
    expect(q.tasks[0]?.productBrief?.nonGoals).toContain('Target directory structure does not match expected paths.')
  })

  it('stores concise and process-shaped prose when the structured fields are present', async () => {
    const result = await updateProductBriefTool.execute(
      {
        userJob: 'I have enough context from the project state and prior task history to draft a best-guess brief and ask the right questions. Let me do that now.',
        successMetric: 'The remaining work for "Proper invite flow (Supabase Auth invite by email)" is described clearly enough to approve or narrow with one focused question.',
      },
      {
        cwd: '/tmp',
        metadata: {
          tasks_path: tasksPath,
          current_task_id: 'task-1',
          current_agent_id: 'spec-agent',
        },
      },
    )

    expect(result.is_error).toBe(false)

    const q = TaskQueue.parse(JSON.parse(await fs.readFile(tasksPath, 'utf-8')))
    expect(q.tasks[0]?.productBrief?.successMetric).toContain('described clearly enough')
  })

  it('does not reject a brief because it contains first-person or decision language', async () => {
    const result = await updateProductBriefTool.execute(
      {
        userJob: 'Good — the user confirmed auto-add to workspace. I still need two more decisions before I can write the spec. Let me post those now.',
        successMetric: 'The remaining work for "Proper invite flow (Supabase Auth invite by email)" is described clearly enough to approve or narrow with one focused question.',
      },
      {
        cwd: '/tmp',
        metadata: {
          tasks_path: tasksPath,
          current_task_id: 'task-1',
          current_agent_id: 'spec-agent',
        },
      },
    )

    expect(result.is_error).toBe(false)

    const q = TaskQueue.parse(JSON.parse(await fs.readFile(tasksPath, 'utf-8')))
    expect(q.tasks[0]?.productBrief?.userJob).toContain('user confirmed')
  })

  it('does not reject a brief because its wording mentions drafting', async () => {
    const result = await updateProductBriefTool.execute(
      {
        userJob: 'Now I have a clear picture. Let me write the product brief and spec.',
        successMetric: 'The remaining work for "Proper invite flow (Supabase Auth invite by email)" is described clearly enough to approve or narrow with one focused question.',
      },
      {
        cwd: '/tmp',
        metadata: {
          tasks_path: tasksPath,
          current_task_id: 'task-1',
          current_agent_id: 'spec-agent',
        },
      },
    )

    expect(result.is_error).toBe(false)

    const q = TaskQueue.parse(JSON.parse(await fs.readFile(tasksPath, 'utf-8')))
    expect(q.tasks[0]?.productBrief?.userJob).toContain('clear picture')
  })

  it('does not infer a fallback brief that only proves Guildhall showed another brief card', async () => {
    const result = await updateProductBriefTool.execute(
      {},
      {
        cwd: '/tmp',
        metadata: {
          tasks_path: tasksPath,
          current_task_id: 'task-1',
          current_agent_id: 'spec-agent',
          last_assistant_text: [
            'Let me explore the Knit codebase to understand the current auth setup before drafting the spec.',
            '',
            'I will write the brief after I inspect more files.',
          ].join('\n'),
        },
      },
    )

    expect(result.is_error).toBe(true)
    expect(result.output).toMatch(/does not infer durable product briefs from assistant prose/i)

    const q = TaskQueue.parse(JSON.parse(await fs.readFile(tasksPath, 'utf-8')))
    expect(q.tasks[0]?.productBrief).toBeUndefined()
  })

  it('rejects evidence-preamble prose as a durable brief', async () => {
    const result = await updateProductBriefTool.execute(
      {},
      {
        cwd: '/tmp',
        metadata: {
          tasks_path: tasksPath,
          current_task_id: 'task-1',
          current_agent_id: 'spec-agent',
          last_assistant_text: [
            'Based on the grep results and the evidence from previous tasks, I have sufficient evidence to proceed.',
            '',
            'The grep clearly shows:',
            '1. Knit imports the shared table primitives.',
            '',
            'The integration appears complete. Let me write the product brief and spec for task-1.',
          ].join('\n'),
        },
      },
    )
    expect(result.is_error).toBe(true)
    expect(result.output).toMatch(/does not infer durable product briefs from assistant prose/i)

    const q = TaskQueue.parse(JSON.parse(await fs.readFile(tasksPath, 'utf-8')))
    expect(q.tasks[0]?.productBrief).toBeUndefined()
  })
})
