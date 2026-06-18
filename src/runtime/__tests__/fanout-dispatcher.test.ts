import { describe, it, expect } from 'vitest'
import type { ProjectLevers } from '@guildhall/levers'
import type { Task, TaskQueue } from '@guildhall/core'
import {
  resolveFanoutCapacity,
  pickNextTasks,
} from '../fanout-dispatcher.js'

function entry<V>(position: V) {
  return {
    position,
    rationale: 't',
    setAt: '2026-04-22T00:00:00.000Z',
    setBy: 'system-default' as const,
  }
}

function makeProject(
  dispatch: { kind: 'serial' } | { kind: 'fanout'; n: number },
): ProjectLevers {
  return {
    concurrent_task_dispatch: entry(dispatch),
    worktree_isolation: entry('none' as const),
    landing_strategy: entry('cherry_pick_local' as const),
    rejection_dampening: entry({ kind: 'off' as const }),
    business_envelope_strictness: entry('off' as const),
    agent_health_strictness: entry('standard' as const),
    remediation_autonomy: entry('auto' as const),
    run_automation: entry('supervised' as const),
    runtime_isolation: entry('none' as const),
    workspace_import_autonomy: entry('suggest' as const),
  }
}

function task(overrides: Partial<Task> = {}): Task {
  const now = '2026-04-22T00:00:00.000Z'
  return {
    id: 't',
    title: 'x',
    description: '',
    domain: 'core',
    projectPath: '/repo',
    status: 'ready',
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
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

describe('resolveFanoutCapacity', () => {
  it("returns 1 for 'serial'", () => {
    expect(resolveFanoutCapacity(makeProject({ kind: 'serial' }))).toBe(1)
  })

  it('returns N for fanout_N', () => {
    expect(resolveFanoutCapacity(makeProject({ kind: 'fanout', n: 4 }))).toBe(4)
  })
})

describe('pickNextTasks', () => {
  function queue(tasks: Task[]): TaskQueue {
    return { version: 1, lastUpdated: '2026-04-22T00:00:00.000Z', tasks }
  }

  it('returns empty list when no actionable task is available', () => {
    const q = queue([
      task({ id: 't1', status: 'done' }),
      task({ id: 't2', status: 'shelved' }),
    ])
    expect(pickNextTasks({ queue: q, capacity: 3 })).toEqual([])
  })

  it('returns a single task in serial (capacity=1)', () => {
    const q = queue([
      task({ id: 't1', status: 'ready', priority: 'high' }),
      task({ id: 't2', status: 'ready', priority: 'normal' }),
    ])
    const picks = pickNextTasks({ queue: q, capacity: 1 })
    expect(picks.map((t) => t.id)).toEqual(['t1'])
  })

  it('returns up to N distinct tasks at capacity=N', () => {
    const q = queue([
      task({ id: 't1', status: 'ready', priority: 'high' }),
      task({ id: 't2', status: 'ready', priority: 'normal' }),
      task({ id: 't3', status: 'ready', priority: 'normal' }),
      task({ id: 't4', status: 'ready', priority: 'low' }),
    ])
    const picks = pickNextTasks({ queue: q, capacity: 3 })
    // priority order: high, normal(findIndex first), normal, low
    expect(picks.map((t) => t.id)).toEqual(['t1', 't2', 't3'])
  })

  it('fills fanout capacity from active work before ready work', () => {
    const q = queue([
      task({ id: 't-ready-critical', status: 'ready', priority: 'critical' }),
      task({ id: 't-review-low', status: 'review', priority: 'low' }),
      task({ id: 't-progress-normal', status: 'in_progress', priority: 'normal' }),
    ])
    const picks = pickNextTasks({ queue: q, capacity: 2 })
    expect(picks.map((t) => t.id)).toEqual(['t-review-low', 't-progress-normal'])
  })

  it('does not fill fanout capacity with dependency-blocked work', () => {
    const q = queue([
      task({ id: 'foundation', status: 'ready', priority: 'normal' }),
      task({
        id: 'dependent',
        status: 'ready',
        priority: 'critical',
        dependsOn: ['foundation'],
      }),
      task({ id: 'independent', status: 'ready', priority: 'low' }),
    ])
    const picks = pickNextTasks({ queue: q, capacity: 3 })
    expect(picks.map((t) => t.id)).toEqual(['foundation', 'independent'])
  })

  it('honors excludeIds so a task already in flight is not re-picked', () => {
    const q = queue([
      task({ id: 't1', status: 'ready', priority: 'high' }),
      task({ id: 't2', status: 'ready', priority: 'normal' }),
    ])
    const picks = pickNextTasks({
      queue: q,
      capacity: 3,
      excludeIds: new Set(['t1']),
    })
    expect(picks.map((t) => t.id)).toEqual(['t2'])
  })

  it('stops early when the queue cannot supply capacity', () => {
    const q = queue([task({ id: 't1', status: 'ready' })])
    const picks = pickNextTasks({ queue: q, capacity: 5 })
    expect(picks.map((t) => t.id)).toEqual(['t1'])
  })

  it('filters by domain', () => {
    const q = queue([
      task({ id: 't1', status: 'ready', domain: 'ui' }),
      task({ id: 't2', status: 'ready', domain: 'core' }),
    ])
    const picks = pickNextTasks({ queue: q, capacity: 5, domainFilter: 'core' })
    expect(picks.map((t) => t.id)).toEqual(['t2'])
  })

  it('prefers an explicitly requested task when it is actionable', () => {
    const q = queue([
      task({ id: 't-active', status: 'review', priority: 'normal' }),
      task({ id: 't-requested', status: 'ready', priority: 'low' }),
    ])
    const picks = pickNextTasks({
      queue: q,
      capacity: 1,
      preferredTaskId: 't-requested',
    })
    expect(picks.map((t) => t.id)).toEqual(['t-requested'])
  })

  it('dispatches a ready task with complete worker handoff even when stale readiness says to research first', () => {
    const q = queue([
      task({
        id: 't-stale-readiness',
        title: 'Implement author voice feedback loop MVP',
        status: 'ready',
        taskKind: 'research',
        taskReadiness: {
          taskKind: 'research',
          recommendation: 'needs_research_spike',
          summary: 'Task should run research or a spike before implementation.',
          dimensions: [],
          definitionOfDone: {
            items: ['Implementation satisfies acceptance criteria.'],
            evidenceRequired: ['Acceptance criteria are checked.'],
            updatedAt: '2026-06-16T00:00:00.000Z',
            createdBy: 'test',
          },
          blockerPlans: [],
          contextBudget: {
            estimatedTokens: 100,
            risk: 'low',
            fitsInOneWorkerBrief: true,
            reasons: [],
          },
          assessedAt: '2026-06-16T00:00:00.000Z',
          assessedBy: 'test',
        },
        productBrief: {
          userJob: 'Run a headless feedback pass.',
          whyItMattersNow: 'The MVP needs a no-UI proof.',
          successMetric: 'Structured findings are returned.',
          nonGoals: ['No UI.'],
          antiPatterns: ['No UI.'],
          approvedAt: '2026-06-16T00:00:00.000Z',
        },
        spec: '## Summary\nImplement the no-UI runtime MVP.',
        acceptanceCriteria: [{
          id: 'AC-1',
          description: 'Returns structured findings.',
          verifiedBy: 'automated',
          met: false,
        }],
      }),
    ])

    const picks = pickNextTasks({
      queue: q,
      capacity: 1,
      preferredTaskId: 't-stale-readiness',
    })

    expect(picks.map((t) => t.id)).toEqual(['t-stale-readiness'])
  })

  it('uses lane capacities to keep spec intake moving alongside worker progress', () => {
    const q = queue([
      task({ id: 't-progress', status: 'in_progress', priority: 'high' }),
      task({ id: 't-ready', status: 'ready', priority: 'normal' }),
      task({ id: 't-exploring', status: 'exploring', priority: 'critical' }),
    ])
    const picks = pickNextTasks({
      queue: q,
      capacity: 2,
      laneCapacities: {
        worker: 1,
        spec: 1,
      },
    })
    expect(picks.map((t) => t.id)).toEqual(['t-progress', 't-exploring'])
  })

  it('round-robins across bounded lanes in priority lane order', () => {
    const q = queue([
      task({ id: 't-gate', status: 'gate_check', priority: 'low' }),
      task({ id: 't-review', status: 'review', priority: 'normal' }),
      task({ id: 't-progress', status: 'in_progress', priority: 'normal' }),
      task({ id: 't-ready', status: 'ready', priority: 'high' }),
      task({ id: 't-proposed', status: 'proposed', priority: 'critical' }),
      task({ id: 't-exploring', status: 'exploring', priority: 'critical' }),
    ])
    const picks = pickNextTasks({
      queue: q,
      capacity: 4,
      laneCapacities: {
        review: 1,
        worker: 1,
        coordinator: 1,
        spec: 1,
      },
    })
    expect(picks.map((t) => t.id)).toEqual([
      't-gate',
      't-progress',
      't-proposed',
      't-exploring',
    ])
  })
})
