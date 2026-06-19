import { describe, expect, it } from 'vitest'
import type { TaskQueue } from '@guildhall/core'
import { pickNextTask, selectedReleaseScopeForQueue, selectedTaskScopeForQueue } from '../orchestrator-picker.js'
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

function queueWithRelease(tasks: Array<Record<string, unknown>>): TaskQueue {
  return {
    ...queue(tasks),
    selectedReleaseId: '2-0-alpha',
    releases: [{
      id: '2-0-alpha',
      label: '2.0 alpha',
      kind: 'release',
      state: 'active',
      source: 'release_plan',
      nodeIds: ['work:included'],
      deferredNodeIds: ['work:later'],
      proofStyle: 'script_only',
    }],
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
  it('does not invent a release boundary when no releases are defined', () => {
    const q = queue([
      { id: 'later', title: 'High priority work', priority: 'critical' },
      { id: 'included', title: 'Normal priority work', priority: 'normal' },
    ])

    expect(selectedReleaseScopeForQueue(q)).toBeNull()
    expect(pickNextTask(q)?.id).toBe('later')
  })

  it('bounds unattended Start to the selected release when releases are defined', () => {
    const q = queueWithRelease([
      { id: 'later', title: 'Later release feature', priority: 'critical' },
      { id: 'included', title: 'Selected release feature', priority: 'normal', releaseIds: ['2-0-alpha'] },
    ])
    const scope = selectedReleaseScopeForQueue(q)

    expect(scope).toMatchObject({
      id: '2-0-alpha',
      label: '2.0 alpha',
      nodeIds: ['work:included'],
      deferredNodeIds: ['work:later'],
    })
    expect(pickNextTask(q, undefined, undefined, undefined, undefined, { scope })?.id).toBe('included')
  })

  it('bounds unattended Start to the approved current task scope when no release is defined', () => {
    const q = queue([
      { id: 'later', title: 'Later scope feature', priority: 'critical' },
      { id: 'included', title: 'Current scope feature', priority: 'normal' },
    ])
    const scope = selectedTaskScopeForQueue(q, {
      currentTaskIds: ['included'],
      laterTaskIds: ['later'],
    })

    expect(scope).toMatchObject({
      id: 'current-work',
      label: 'Current task scope',
      nodeIds: ['work:included'],
      deferredNodeIds: ['work:later'],
    })
    expect(pickNextTask(q, undefined, undefined, undefined, undefined, { scope })?.id).toBe('included')
  })

  it('keeps selected release scope membership explicit while still allowing descendant work', () => {
    const q = queueWithRelease([
      { id: 'included', title: 'Selected release feature', priority: 'normal', hierarchy: { childIds: ['child'], order: 0 } },
      { id: 'child', title: 'Scoped child work', priority: 'normal', hierarchy: { parentId: 'included', childIds: [], order: 0 } },
    ])
    const scope = selectedReleaseScopeForQueue(q)

    expect(scope?.nodeIds).toEqual(['work:included'])
    expect(pickNextTask(q, undefined, undefined, undefined, undefined, { scope })?.id).toBe('child')
  })

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
