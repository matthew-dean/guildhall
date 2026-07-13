import { describe, expect, it } from 'vitest'
import { applySourceConflictReconciliation } from '../source-conflict-reconciliation.js'
import type { TaskQueue } from '@guildhall/core'

describe('applySourceConflictReconciliation', () => {
  it('keeps the selected canonical task in current scope and archives the duplicate', () => {
    const queue: TaskQueue = {
      version: 1,
      lastUpdated: '2026-07-06T00:00:00.000Z',
      selectedReleaseId: 'stage-1',
      releases: [{
        id: 'stage-1',
        label: 'Stage 1',
        kind: 'release',
        state: 'active',
        source: 'inferred',
        proofStyle: 'unspecified',
        nodeIds: ['work:task-narrow'],
        deferredNodeIds: [],
      }, {
        id: 'near-term-proof-scope',
        label: 'Near-term proof scope',
        kind: 'current_work',
        state: 'active',
        source: 'inferred',
        proofStyle: 'unspecified',
        nodeIds: ['work:task-rich'],
        deferredNodeIds: [],
      }],
      tasks: [{
        id: 'task-rich',
        title: 'Select and prove a DeepInfra drafting model for broad-genre and legal adult fiction chapter writing.',
        description: 'Richer source-backed task.',
        status: 'done',
        domain: 'harness',
        projectPath: '.',
        priority: 'normal',
        releaseIds: ['near-term-proof-scope'],
        notes: [],
        gateResults: [],
        reviewVerdicts: [],
        adjudications: [],
        acceptanceCriteria: [],
        outOfScope: [],
        dependsOn: [],
        escalations: [],
        agentIssues: [],
        createdAt: '2026-07-06T00:00:00.000Z',
        updatedAt: '2026-07-06T00:00:00.000Z',
      }, {
        id: 'task-narrow',
        title: 'Select and prove a DeepInfra drafting model for broad-genre chapter writing.',
        description: 'Narrow duplicate.',
        status: 'done',
        domain: 'harness',
        projectPath: '.',
        priority: 'normal',
        releaseIds: ['stage-1'],
        notes: [],
        gateResults: [],
        reviewVerdicts: [],
        adjudications: [],
        acceptanceCriteria: [],
        outOfScope: [],
        dependsOn: [],
        escalations: [],
        agentIssues: [],
        createdAt: '2026-07-06T00:00:00.000Z',
        updatedAt: '2026-07-06T00:00:00.000Z',
      }],
    }

    const result = applySourceConflictReconciliation({
      queue,
      selectedReleaseId: 'stage-1',
      keepTaskId: 'task-rich',
      archiveTaskId: 'task-narrow',
      now: '2026-07-06T12:00:00.000Z',
      actor: 'codex-as-owner',
    })

    expect(result.keepTask.releaseIds).toEqual(['near-term-proof-scope', 'stage-1'])
    expect(result.keepTask.status).toBe('done')
    expect(result.archivedTask.status).toBe('archived')
    expect(result.archivedTask.releaseIds).toEqual([])
    expect(result.releases.find(release => release.id === 'stage-1')).toMatchObject({
      nodeIds: ['work:task-rich'],
      deferredNodeIds: [],
    })
    expect(result.releases.find(release => release.id === 'near-term-proof-scope')).toMatchObject({
      nodeIds: ['work:task-rich'],
      deferredNodeIds: [],
    })
    expect(result.keepTask.notes.at(-1)?.content).toContain('kept as the source of truth')
    expect(result.archivedTask.notes.at(-1)?.content).toContain('Archived as a superseded duplicate')
  })

  it('archives a done split parent after the final child is superseded', () => {
    const base = {
      description: 'Task.',
      status: 'done' as const,
      domain: 'harness',
      projectPath: '.',
      priority: 'normal' as const,
      notes: [],
      gateResults: [],
      reviewVerdicts: [],
      adjudications: [],
      acceptanceCriteria: [],
      outOfScope: [],
      dependsOn: [],
      escalations: [],
      agentIssues: [],
      createdAt: '2026-07-06T00:00:00.000Z',
      updatedAt: '2026-07-06T00:00:00.000Z',
    }
    const queue: TaskQueue = {
      version: 1,
      lastUpdated: '2026-07-06T00:00:00.000Z',
      selectedReleaseId: 'stage-1',
      releases: [{
        id: 'stage-1',
        label: 'Stage 1',
        kind: 'release',
        state: 'active',
        source: 'inferred',
        proofStyle: 'unspecified',
        nodeIds: ['work:canonical-world'],
        deferredNodeIds: ['work:owner-parent'],
      }],
      tasks: [
        {
          ...base,
          id: 'canonical-world',
          title: 'Prove world-state continuity review over elapsed-time object and property changes.',
          releaseIds: ['stage-1'],
        },
        {
          ...base,
          id: 'owner-parent',
          title: 'Define Narrative Harness MVP drafting model and physical-world review lanes',
          releaseIds: ['old-scope'],
          hierarchy: { childIds: ['old-model', 'old-world'], relation: 'contains' },
        },
        {
          ...base,
          id: 'old-model',
          title: 'Select and prove DeepInfra drafting model',
          status: 'archived',
          releaseIds: [],
          hierarchy: { parentId: 'owner-parent', childIds: [], relation: 'decomposes', order: 0 },
        },
        {
          ...base,
          id: 'old-world',
          title: 'Define world-state continuity review lane',
          releaseIds: ['old-scope'],
          hierarchy: { parentId: 'owner-parent', childIds: [], relation: 'decomposes', order: 1 },
        },
      ],
    }

    const result = applySourceConflictReconciliation({
      queue,
      selectedReleaseId: 'stage-1',
      keepTaskId: 'canonical-world',
      archiveTaskId: 'old-world',
      now: '2026-07-06T12:00:00.000Z',
      actor: 'codex-as-owner',
    })

    expect(result.tasks.find(task => task.id === 'old-world')?.status).toBe('archived')
    expect(result.tasks.find(task => task.id === 'owner-parent')).toMatchObject({
      status: 'archived',
      releaseIds: [],
    })
    expect(result.tasks.find(task => task.id === 'owner-parent')?.notes.at(-1)?.content).toContain('all split children were superseded')
    expect(result.releases.find(release => release.id === 'stage-1')).toMatchObject({
      nodeIds: ['work:canonical-world'],
      deferredNodeIds: [],
    })
  })

  it('does not promote later-scope conflicts into the selected current release', () => {
    const base = {
      description: 'Task.',
      status: 'shelved' as const,
      domain: 'looma',
      projectPath: '.',
      priority: 'normal' as const,
      notes: [],
      gateResults: [],
      reviewVerdicts: [],
      adjudications: [],
      acceptanceCriteria: [],
      outOfScope: [],
      dependsOn: [],
      escalations: [],
      agentIssues: [],
      createdAt: '2026-07-06T00:00:00.000Z',
      updatedAt: '2026-07-06T00:00:00.000Z',
    }
    const queue: TaskQueue = {
      version: 1,
      lastUpdated: '2026-07-06T00:00:00.000Z',
      selectedReleaseId: 'stage-1',
      releases: [{
        id: 'stage-1',
        label: 'Stage 1',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        proofStyle: 'unspecified',
        nodeIds: ['work:e2e-tests'],
        deferredNodeIds: [],
      }, {
        id: 'stage-2',
        label: 'Stage 2',
        kind: 'release',
        state: 'planned',
        source: 'release_plan',
        proofStyle: 'unspecified',
        nodeIds: [],
        deferredNodeIds: ['work:looma-task'],
      }, {
        id: 'stage-3',
        label: 'Stage 3',
        kind: 'release',
        state: 'planned',
        source: 'release_plan',
        proofStyle: 'unspecified',
        nodeIds: [],
        deferredNodeIds: ['work:knit-task'],
      }],
      tasks: [
        {
          ...base,
          id: 'e2e-tests',
          title: 'E2E tests: login create page edit search flow',
          status: 'import_draft',
          releaseIds: ['stage-1'],
        },
        {
          ...base,
          id: 'looma-task',
          title: 'Register Looma extension helpers from @looma/editor/extensions in Knit.',
          releaseIds: ['stage-2'],
        },
        {
          ...base,
          id: 'knit-task',
          title: 'Use Looma extension helpers in Knit.',
          releaseIds: ['stage-3'],
        },
      ],
    }

    const result = applySourceConflictReconciliation({
      queue,
      selectedReleaseId: 'stage-1',
      keepTaskId: 'looma-task',
      archiveTaskId: 'knit-task',
      now: '2026-07-06T12:00:00.000Z',
      actor: 'codex-as-owner',
    })

    expect(result.keepTask.releaseIds).toEqual(['stage-2'])
    expect(result.archivedTask.releaseIds).toEqual([])
    expect(result.releases.find(release => release.id === 'stage-1')).toMatchObject({
      nodeIds: ['work:e2e-tests'],
      deferredNodeIds: [],
    })
    expect(result.releases.find(release => release.id === 'stage-2')).toMatchObject({
      deferredNodeIds: ['work:looma-task'],
    })
    expect(result.releases.find(release => release.id === 'stage-3')).toMatchObject({
      deferredNodeIds: [],
    })
  })
})
