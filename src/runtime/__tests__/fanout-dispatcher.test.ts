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
    merge_policy: entry('ff_only_local' as const),
    rejection_dampening: entry({ kind: 'off' as const }),
    business_envelope_strictness: entry('off' as const),
    agent_health_strictness: entry('standard' as const),
    remediation_autonomy: entry('auto' as const),
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
})
