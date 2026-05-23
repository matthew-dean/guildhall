import { describe, expect, it } from 'vitest'
import type { Task, TaskQueue } from '@guildhall/core'
import { repairStaleBlockersInQueue } from '../stale-blocker-repair.js'

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    title: 'Do the thing',
    description: 'Details',
    domain: 'frontend',
    status: 'blocked',
    priority: 'normal',
    acceptanceCriteria: [],
    outOfScope: [],
    dependsOn: [],
    projectPath: '/tmp/guildhall-test-project',
    notes: [],
    gateResults: [],
    reviewVerdicts: [],
    adjudications: [],
    escalations: [],
    agentIssues: [],
    revisionCount: 0,
    remediationAttempts: 0,
    origination: 'human',
    createdAt: '2026-05-23T00:00:00.000Z',
    updatedAt: '2026-05-23T00:00:00.000Z',
    ...overrides,
  }
}

function queue(tasks: Task[]): TaskQueue {
  return {
    version: 1,
    lastUpdated: '2026-05-23T00:00:00.000Z',
    tasks,
  }
}

describe('repairStaleBlockersInQueue', () => {
  it('reopens stale cross-task guardrail blockers before they reach the UI', () => {
    const q = queue([
      task({
        id: 'task-stripe-integration',
        title: 'Stripe Connect',
        blockReason: 'scope_boundary: Blocked by cross-task guardrail forcing unrelated useAuth.ts file creation.',
        escalations: [
          {
            id: 'esc-1',
            taskId: 'task-stripe-integration',
            agentId: 'spec-agent',
            reason: 'scope_boundary',
            summary: 'Blocked by cross-task guardrail forcing unrelated useAuth.ts file creation.',
            details: 'Current task is Stripe Connect, but tooling is forcing action on frontend/app/composables/useAuth.ts.',
            raisedAt: '2026-05-22T16:30:07.240Z',
          },
        ],
      }),
    ])

    const result = repairStaleBlockersInQueue(q, '2026-05-23T12:00:00.000Z')

    expect(result.repairs).toEqual([
      {
        taskId: 'task-stripe-integration',
        previousStatus: 'blocked',
        nextStatus: 'exploring',
        reason: 'stale_internal_tooling_blocker',
      },
    ])
    expect(q.tasks[0]?.status).toBe('exploring')
    expect(q.tasks[0]?.blockReason).toBeUndefined()
    expect(q.tasks[0]?.escalations[0]?.resolvedBy).toBe('system')
    expect(q.tasks[0]?.notes.at(-1)?.role).toBe('state-repair')
  })

  it('does not repair ordinary scope questions that need a real decision', () => {
    const q = queue([
      task({
        blockReason: 'scope_boundary: The task scope is unclear.',
        escalations: [
          {
            id: 'esc-1',
            taskId: 'task-1',
            agentId: 'worker-agent',
            reason: 'scope_boundary',
            summary: 'Task scope is unclear.',
            details: 'The request conflicts with the accepted spec and needs owner input.',
            raisedAt: '2026-05-23T00:00:00.000Z',
          },
        ],
      }),
    ])

    const result = repairStaleBlockersInQueue(q, '2026-05-23T12:00:00.000Z')

    expect(result.changed).toBe(false)
    expect(q.tasks[0]?.status).toBe('blocked')
    expect(q.tasks[0]?.escalations[0]?.resolvedAt).toBeUndefined()
  })
})
