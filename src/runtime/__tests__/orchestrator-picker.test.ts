import { describe, expect, it } from 'vitest'
import type { TaskQueue } from '@guildhall/core'
import { pickNextTask } from '../orchestrator-picker.js'
import type { OrientationScope } from '../project-orientation-spine.js'

function task(overrides: Record<string, unknown> = {}) {
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
    createdAt: '2026-06-15T12:00:00.000Z',
    updatedAt: '2026-06-15T12:00:00.000Z',
    ...overrides,
  }
}

function queue(tasks: Array<Record<string, unknown>>): TaskQueue {
  return {
    version: 1,
    lastUpdated: '2026-06-15T12:00:00.000Z',
    tasks: tasks.map(item => task(item)) as TaskQueue['tasks'],
  }
}

const mvpScope: OrientationScope = {
  id: 'mvp',
  label: 'MVP',
  kind: 'release',
  source: 'owner_approved',
  nodeIds: ['work:included'],
  deferredNodeIds: ['work:later', 'work:later-prerequisite'],
}

describe('pickNextTask bounded scope eligibility', () => {
  it('does not pick deferred ready work during normal unattended current-scope work', () => {
    const q = queue([
      { id: 'later', title: 'Later feature', priority: 'critical' },
      { id: 'included', title: 'Included feature', priority: 'normal' },
    ])

    expect(pickNextTask(q, undefined, undefined, undefined, undefined, { scope: mvpScope })?.id).toBe('included')
  })

  it('allows an explicit owner-targeted deferred feature', () => {
    const q = queue([
      { id: 'later', title: 'Later feature', priority: 'critical' },
      { id: 'included', title: 'Included feature', priority: 'normal' },
    ])

    expect(pickNextTask(q, undefined, undefined, undefined, 'later', { scope: mvpScope })?.id).toBe('later')
  })

  it('allows a deferred prerequisite only when it is recorded as an included prerequisite', () => {
    const q = queue([
      { id: 'later-prerequisite', title: 'Later prerequisite', priority: 'critical' },
      { id: 'included', title: 'Included feature', priority: 'normal', dependsOn: ['later-prerequisite'] },
    ])

    expect(pickNextTask(q, undefined, undefined, undefined, undefined, { scope: mvpScope })?.id).toBeUndefined()
    expect(pickNextTask(q, undefined, undefined, undefined, undefined, {
      scope: mvpScope,
      includedDependencyIds: new Set(['later-prerequisite']),
    })?.id).toBe('later-prerequisite')
  })

  it('picks a runnable child instead of a legacy split-required parent', () => {
    const q = queue([
      {
        id: 'parent',
        title: 'Broad accepted work',
        priority: 'critical',
        hierarchy: { childIds: ['child'], order: 0 },
        sizePlan: {
          taskId: 'parent',
          score: 8,
          band: 'epic',
          action: 'split_required',
          factors: [],
          recommendedChildren: [
            {
              title: 'Stale recommendation',
              reason: 'Legacy data should not make the parent runnable.',
              dependsOn: [],
            },
          ],
          reasons: ['Too broad.'],
          createdAt: '2026-06-17T00:00:00.000Z',
          createdBy: 'test',
        },
      },
      {
        id: 'child',
        title: 'Actual runnable child',
        priority: 'normal',
        hierarchy: { parentId: 'parent', childIds: [], order: 0 },
      },
    ])

    expect(pickNextTask(q)?.id).toBe('child')
  })

  it('does not dispatch broad work that still needs decomposition', () => {
    const q = queue([
      {
        id: 'broad',
        title: 'Broad accepted work',
        priority: 'critical',
        sizePlan: {
          taskId: 'broad',
          score: 8,
          band: 'epic',
          action: 'split_required',
          factors: [],
          recommendedChildren: [],
          reasons: ['Too broad.'],
          createdAt: '2026-06-17T00:00:00.000Z',
          createdBy: 'test',
        },
      },
    ])

    expect(pickNextTask(q)).toBeUndefined()
  })

  it('selects runnable leaves through arbitrary-depth containing work', () => {
    const q = queue([
      { id: 'release', title: 'Current MVP', priority: 'critical', hierarchy: { childIds: ['feature'], order: 0 } },
      { id: 'feature', title: 'Feature package', priority: 'critical', hierarchy: { parentId: 'release', childIds: ['task'], order: 0 } },
      { id: 'task', title: 'Implementation task', priority: 'critical', hierarchy: { parentId: 'feature', childIds: ['step'], order: 0 } },
      { id: 'step', title: 'Runnable step', priority: 'normal', hierarchy: { parentId: 'task', childIds: [], order: 0 } },
    ])

    expect(pickNextTask(q)?.id).toBe('step')
  })

  it('does not pick hidden internal decomposition work as top-level runnable work', () => {
    const q = queue([
      {
        id: 'internal-proof',
        title: 'Internal proof',
        priority: 'critical',
        workVisibility: { kind: 'internal_step', countInProjectTotals: false },
      },
      {
        id: 'visible-work',
        title: 'Visible work',
        priority: 'normal',
        workVisibility: { kind: 'supporting', countInProjectTotals: true },
      },
    ])

    expect(pickNextTask(q)?.id).toBe('visible-work')
  })
})
