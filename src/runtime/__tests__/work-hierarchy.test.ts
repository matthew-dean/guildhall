import { describe, expect, it } from 'vitest'
import type { Task, TaskQueue } from '@guildhall/core'

import {
  buildWorkHierarchy,
  completionBoundaryStatus,
  workListGroups,
  workSubtreeIds,
} from '../work-hierarchy.js'
import { pickNextTask } from '../orchestrator-picker.js'

const now = '2026-05-28T12:00:00.000Z'

function task(overrides: Partial<Task> & { id: string }): Task {
  const { id, ...rest } = overrides
  return {
    id,
    title: overrides.title ?? id,
    description: overrides.description ?? overrides.title ?? id,
    domain: overrides.domain ?? 'product',
    projectPath: overrides.projectPath ?? '/repo/app',
    status: overrides.status ?? 'ready',
    priority: overrides.priority ?? 'normal',
    spec: overrides.spec ?? 'Spec.',
    acceptanceCriteria: overrides.acceptanceCriteria ?? [],
    outOfScope: overrides.outOfScope ?? [],
    dependsOn: overrides.dependsOn ?? [],
    notes: overrides.notes ?? [],
    gateResults: overrides.gateResults ?? [],
    reviewVerdicts: overrides.reviewVerdicts ?? [],
    adjudications: overrides.adjudications ?? [],
    escalations: overrides.escalations ?? [],
    agentIssues: overrides.agentIssues ?? [],
    revisionCount: overrides.revisionCount ?? 0,
    remediationAttempts: overrides.remediationAttempts ?? 0,
    origination: overrides.origination ?? 'human',
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    ...rest,
  }
}

function queue(tasks: Task[]): TaskQueue {
  return { version: 1, lastUpdated: now, tasks }
}

describe('work hierarchy', () => {
  it('derives arbitrary-depth hierarchy and rollups without treating dependencies as containment', () => {
    const tasks = [
      task({
        id: 'app-spec',
        status: 'parent',
        workKind: 'app_spec',
        hierarchy: { childIds: ['feature-link-editor'], order: 0 },
      }),
      task({
        id: 'feature-link-editor',
        status: 'parent',
        workKind: 'feature_spec',
        hierarchy: { parentId: 'app-spec', childIds: ['implement-link-editor', 'verify-link-editor'], order: 0 },
      }),
      task({
        id: 'implement-link-editor',
        status: 'ready',
        workKind: 'implementation',
        hierarchy: { parentId: 'feature-link-editor', childIds: [], order: 0 },
        dependsOn: ['setup-preview-token'],
      }),
      task({
        id: 'verify-link-editor',
        status: 'blocked',
        workKind: 'verification',
        hierarchy: { parentId: 'feature-link-editor', childIds: [], order: 1 },
      }),
      task({
        id: 'setup-preview-token',
        status: 'done',
        workKind: 'setup',
        hierarchy: { childIds: [], order: 2 },
      }),
    ]

    const model = buildWorkHierarchy(tasks)

    expect(workSubtreeIds(tasks, 'app-spec')).toEqual([
      'app-spec',
      'feature-link-editor',
      'implement-link-editor',
      'verify-link-editor',
    ])
    expect(model.byId.get('feature-link-editor')?.breadcrumb.map(item => item.id)).toEqual([
      'app-spec',
      'feature-link-editor',
    ])
    expect(model.byId.get('feature-link-editor')?.rollup).toMatchObject({
      totalChildren: 2,
      openChildren: 2,
      blockedChildren: 1,
      doneChildren: 0,
    })
    expect(model.byId.get('app-spec')?.rollup.totalDescendants).toBe(3)
    expect(model.byId.get('implement-link-editor')?.dependencyIds).toEqual(['setup-preview-token'])
    expect(model.byId.get('setup-preview-token')?.parentId).toBeNull()
  })

  it('maps legacy parentGoalId into containing work language', () => {
    const tasks = [
      task({ id: 'feature-shell', status: 'parent', parentGoalId: 'goal-task-feature-shell' }),
      task({ id: 'implementation-child', status: 'ready', parentGoalId: 'goal-task-feature-shell' }),
    ]

    const model = buildWorkHierarchy(tasks)

    expect(model.byId.get('feature-shell')?.isContainingWork).toBe(true)
    expect(model.byId.get('implementation-child')?.parentId).toBe('feature-shell')
    expect(model.byId.get('feature-shell')?.childIds).toEqual(['implementation-child'])
  })

  it('requires explicit completion boundaries before containing work can be complete', () => {
    const tasks = [
      task({
        id: 'feature-link-editor',
        status: 'parent',
        completionBoundary: {
          summary: 'Feature is complete when required implementation and browser proof are done.',
          requiredChildPolicy: 'selected_children_done',
          requiredChildIds: ['implement-link-editor', 'verify-link-editor'],
          proofPathRequired: true,
          handoffRequired: true,
          deferAllowed: false,
        },
      }),
      task({ id: 'implement-link-editor', status: 'done', hierarchy: { parentId: 'feature-link-editor', childIds: [], order: 0 } }),
      task({ id: 'verify-link-editor', status: 'ready', hierarchy: { parentId: 'feature-link-editor', childIds: [], order: 1 } }),
    ]

    const incomplete = completionBoundaryStatus(tasks, 'feature-link-editor')
    expect(incomplete.satisfied).toBe(false)
    expect(incomplete.missing).toContain('verify-link-editor is ready')

    const complete = completionBoundaryStatus(
      tasks.map(item => item.id === 'verify-link-editor' ? { ...item, status: 'done' } : item),
      'feature-link-editor',
    )
    expect(complete.satisfied).toBe(true)
  })

  it('groups the work list by usefulness and hides done and shelved work by default', () => {
    const groups = workListGroups([
      task({ id: 'decision', status: 'blocked', escalations: [{ id: 'esc-1', taskId: 'decision', agentId: 'spec', reason: 'decision_required', summary: 'Pick auth mode.', raisedAt: now }] }),
      task({ id: 'worker', status: 'in_progress' }),
      task({ id: 'ready', status: 'ready' }),
      task({ id: 'container', status: 'parent' }),
      task({ id: 'blocked', status: 'blocked' }),
      task({ id: 'done', status: 'done' }),
      task({ id: 'shelved', status: 'shelved' }),
    ])

    expect(groups.map(group => [group.key, group.items.map(item => item.id)])).toEqual([
      ['needs_you', ['decision']],
      ['working', ['worker']],
      ['ready', ['ready']],
      ['blocked', ['blocked']],
      ['planned', ['container']],
    ])
  })

  it('scoped task start does not dispatch unrelated ready work', () => {
    const q = queue([
      task({ id: 'container', status: 'parent', hierarchy: { childIds: ['child-blocked'], order: 0 } }),
      task({ id: 'child-blocked', status: 'blocked', hierarchy: { parentId: 'container', childIds: [], order: 0 } }),
      task({ id: 'unrelated-ready', status: 'ready' }),
    ])

    expect(pickNextTask(q, undefined, undefined, undefined, 'container')).toBeUndefined()
  })

  it('scoped task start can dispatch the next eligible child inside a containing work subtree', () => {
    const q = queue([
      task({ id: 'container', status: 'parent', hierarchy: { childIds: ['child-ready'], order: 0 } }),
      task({ id: 'child-ready', status: 'ready', hierarchy: { parentId: 'container', childIds: [], order: 0 } }),
      task({ id: 'unrelated-high', status: 'ready', priority: 'critical' }),
    ])

    expect(pickNextTask(q, undefined, undefined, undefined, 'container')?.id).toBe('child-ready')
  })
})
