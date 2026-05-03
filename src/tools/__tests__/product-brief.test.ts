import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { TaskQueue, type Task } from '@guildhall/core'
import { updateProductBrief, updateProductBriefTool } from '../product-brief.js'

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

  it('tool execute infers a best-effort brief from metadata.last_assistant_text when called with {}', async () => {
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
    expect(result.is_error).toBe(false)

    const q = TaskQueue.parse(JSON.parse(await fs.readFile(tasksPath, 'utf-8')))
    expect(q.tasks[0]?.productBrief).toMatchObject({
      userJob: 'You want to make the setup flow easier for first-time users so they can reach useful work faster.',
      successMetric: 'Thread shows a drafted brief and actionable next step for "Build the onboarding screen".',
      antiPatterns: ["Don't add marketing copy."],
      authoredBy: 'spec-agent',
    })
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

  it('skips evidence-preamble prose when inferring a fallback brief from assistant text', async () => {
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
    expect(result.is_error).toBe(false)

    const q = TaskQueue.parse(JSON.parse(await fs.readFile(tasksPath, 'utf-8')))
    expect(q.tasks[0]?.productBrief).toMatchObject({
      userJob: 'I want to verify whether Build the onboarding screen is already done and, if not, capture only the remaining delta.',
      authoredBy: 'spec-agent',
    })
  })
})
