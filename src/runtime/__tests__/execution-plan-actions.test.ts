import { describe, expect, it } from 'vitest'
import type { ExecutionPlanAction, Task, TaskQueue } from '@guildhall/core'
import { applyExecutionPlanAction } from '../execution-plan-actions.js'

function task(input: Partial<Task> & { id: string }): Task {
  return {
    title: input.title ?? input.id,
    description: input.description ?? input.title ?? input.id,
    domain: input.domain ?? 'test',
    projectPath: input.projectPath ?? '/tmp/project',
    status: input.status ?? 'ready',
    priority: input.priority ?? 'normal',
    acceptanceCriteria: input.acceptanceCriteria ?? [],
    outOfScope: input.outOfScope ?? [],
    dependsOn: input.dependsOn ?? [],
    notes: input.notes ?? [],
    gateResults: input.gateResults ?? [],
    reviewVerdicts: input.reviewVerdicts ?? [],
    adjudications: input.adjudications ?? [],
    escalations: input.escalations ?? [],
    agentIssues: input.agentIssues ?? [],
    origination: input.origination ?? 'human',
    revisionCount: input.revisionCount ?? 0,
    remediationAttempts: input.remediationAttempts ?? 0,
    createdAt: input.createdAt ?? '2026-06-17T00:00:00.000Z',
    updatedAt: input.updatedAt ?? '2026-06-17T00:00:00.000Z',
    ...input,
    id: input.id,
  } as Task
}

function splitAction(input: Partial<ExecutionPlanAction> & { id: string; targetWorkId: string }): ExecutionPlanAction {
  return {
    type: 'split_work',
    status: input.status ?? 'planned',
    authority: 'execution_planning',
    rationale: input.rationale ?? 'The work is too broad for one execution pass.',
    createdChildIds: input.createdChildIds ?? [],
    createdAt: input.createdAt ?? '2026-06-17T00:00:00.000Z',
    createdBy: input.createdBy ?? 'test',
    ...input,
    id: input.id,
    targetWorkId: input.targetWorkId,
  } as ExecutionPlanAction
}

function queue(input: { tasks: Task[]; actions: ExecutionPlanAction[] }): TaskQueue {
  return {
    version: 1,
    lastUpdated: '2026-06-17T00:00:00.000Z',
    tasks: input.tasks,
    executionPlanActions: input.actions,
  }
}

describe('execution plan actions', () => {
  it('applies split_work by creating child work and recording child ids as audit output', () => {
    const q = queue({
      tasks: [task({ id: 'parent', hierarchy: { childIds: [], order: 0 } })],
      actions: [splitAction({ id: 'action-1', targetWorkId: 'parent' })],
    })

    const result = applyExecutionPlanAction(q, 'action-1', {
      now: '2026-06-17T01:00:00.000Z',
      actor: 'coordinator',
      childWork: [
        { id: 'child-a', title: 'First child', description: 'First child.' },
        { id: 'child-b', title: 'Second child', description: 'Second child.', dependsOn: ['child-a'] },
      ],
    })

    expect(result.status).toBe('applied')
    expect(q.tasks.map(item => item.id)).toEqual(['parent', 'child-a', 'child-b'])
    expect(q.tasks.find(item => item.id === 'parent')?.hierarchy?.childIds).toEqual(['child-a', 'child-b'])
    expect(q.tasks.find(item => item.id === 'child-a')?.hierarchy).toEqual({
      parentId: 'parent',
      childIds: [],
      order: 0,
      relation: 'decomposes',
    })
    expect(q.tasks.find(item => item.id === 'child-b')?.dependsOn).toEqual(['child-a'])
    expect(q.executionPlanActions?.[0]?.status).toBe('applied')
    expect(q.executionPlanActions?.[0]?.createdChildIds).toEqual(['child-a', 'child-b'])
    expect(q.executionPlanActions?.[0]?.appliedBy).toBe('coordinator')
  })

  it('does not partially mutate hierarchy when split child ids conflict', () => {
    const q = queue({
      tasks: [
        task({ id: 'parent', hierarchy: { childIds: [], order: 0 } }),
        task({ id: 'existing' }),
      ],
      actions: [splitAction({ id: 'action-1', targetWorkId: 'parent' })],
    })

    const result = applyExecutionPlanAction(q, 'action-1', {
      now: '2026-06-17T01:00:00.000Z',
      actor: 'coordinator',
      childWork: [
        { id: 'child-a', title: 'First child', description: 'First child.' },
        { id: 'existing', title: 'Conflicting child', description: 'Conflicting child.' },
      ],
    })

    expect(result.status).toBe('failed')
    expect(q.tasks.map(item => item.id)).toEqual(['parent', 'existing'])
    expect(q.tasks.find(item => item.id === 'parent')?.hierarchy?.childIds).toEqual([])
    expect(q.executionPlanActions?.[0]?.status).toBe('failed')
    expect(q.executionPlanActions?.[0]?.failureReason).toContain('already exists')
  })
})
