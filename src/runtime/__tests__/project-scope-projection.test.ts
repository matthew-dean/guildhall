import { describe, expect, it } from 'vitest'
import type { Task, TaskQueue } from '@guildhall/core'
import { buildProjectScopeProjection } from '../project-scope-projection.js'

const now = '2026-07-04T12:00:00.000Z'

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-ready',
    title: 'Ready task',
    description: 'Ready task.',
    domain: 'app',
    projectPath: '/tmp/project',
    status: 'ready',
    priority: 'normal',
    dependsOn: [],
    acceptanceCriteria: [],
    notes: [],
    gateResults: [],
    reviewVerdicts: [],
    adjudications: [],
    revisionCount: 0,
    remediationAttempts: 0,
    escalations: [],
    agentIssues: [],
    origination: 'human',
    outOfScope: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as Task
}

function queue(tasks: Task[]): TaskQueue {
  return {
    version: 1,
    lastUpdated: now,
    selectedReleaseId: 'stage-1',
    releases: [{
      id: 'stage-1',
      label: 'Stage 1',
      kind: 'release',
      state: 'active',
      source: 'release_plan',
      nodeIds: ['work:task-contracts'],
      deferredNodeIds: ['work:task-later'],
      proofStyle: 'script_only',
    }],
    tasks,
  }
}

describe('buildProjectScopeProjection', () => {
  it('treats materialized child work under an included parent as current paused work', () => {
    const projection = buildProjectScopeProjection(queue([
      task({
        id: 'task-contracts',
        title: 'Define harness contracts',
        hierarchy: { childIds: ['task-ground-truth'], order: 0 },
        spec: 'Define the fixture contract.',
        acceptanceCriteria: [{ id: 'AC-1', description: 'Contract is defined.', verifiedBy: 'test', met: false }],
      }),
      task({
        id: 'task-ground-truth',
        title: 'Shape fixture and expected-record ground truth',
        status: 'in_progress',
        assignedTo: 'worker-agent',
        hierarchy: { parentId: 'task-contracts', childIds: [], order: 0 },
        spec: 'Shape fixture records.',
        acceptanceCriteria: [{ id: 'AC-1', description: 'Fixture exists.', verifiedBy: 'test', met: false }],
      }),
      task({
        id: 'task-later',
        title: 'Later UI',
        releaseIds: ['later'],
      }),
    ]))

    expect(projection.rows.find(row => row.taskId === 'task-ground-truth')).toMatchObject({
      scope: 'included',
      eligibilityReason: 'included_ancestor',
      hierarchyRole: 'child',
      handoffState: 'paused',
      blocksStart: false,
      humanBlocking: false,
    })
    expect(projection.counts.paused).toBe(1)
    expect(projection.start).toMatchObject({
      canStart: true,
      code: 'paused_live_work',
      label: 'Resume',
      focusTaskId: 'task-ground-truth',
      focusKind: 'paused_work',
    })
  })

  it('treats spec-shaped ready work as runnable even when the imported brief is thin', () => {
    const projection = buildProjectScopeProjection(queue([
      task({
        id: 'task-contracts',
        title: 'Define fixture contracts',
        productBrief: {
          userJob: 'Shape the contract.',
          whyItMattersNow: 'Needed by the runner.',
          successMetric: 'The runner can read it.',
        },
        spec: 'Fixture contract spec.',
        acceptanceCriteria: [{ id: 'AC-1', description: 'Contract is parseable.', verifiedBy: 'test', met: false }],
      }),
    ]))

    expect(projection.rows.find(row => row.taskId === 'task-contracts')).toMatchObject({
      handoffState: 'ready',
      blocksStart: false,
      humanBlocking: false,
    })
    expect(projection.release.blockers).toEqual([])
    expect(projection.release.state).toBe('active')
  })

  it('marks the release ready only after included scoped work is done', () => {
    const projection = buildProjectScopeProjection(queue([
      task({
        id: 'task-contracts',
        title: 'Done scoped task',
        status: 'done',
        completedAt: now,
      }),
    ]))

    expect(projection.release).toMatchObject({
      state: 'ready',
      blockers: [],
    })
  })

  it('blocks genuinely thin ready work as brief cleanup', () => {
    const projection = buildProjectScopeProjection(queue([
      task({
        id: 'task-contracts',
        title: 'Thin ready task',
      }),
    ]))

    expect(projection.rows.find(row => row.taskId === 'task-contracts')).toMatchObject({
      handoffState: 'brief_cleanup',
      blocksStart: true,
      humanBlocking: true,
    })
    expect(projection.start).toMatchObject({
      canStart: false,
      code: 'no_unattended_progress',
      focusKind: 'brief_cleanup',
      focusTaskId: 'task-contracts',
    })
  })
})
