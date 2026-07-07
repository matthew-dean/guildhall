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
})
