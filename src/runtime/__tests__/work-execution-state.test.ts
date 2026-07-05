import { describe, expect, it } from 'vitest'
import type { Task } from '@guildhall/core'
import {
  deriveProjectWorkExecutionState,
  deriveWorkExecutionState,
} from '../work-execution-state.js'

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
    ...input,
    id: input.id,
  } as Task
}

describe('work execution state', () => {
  it('derives arbitrary-depth containing work and runnable leaves without rigid task/step levels', () => {
    const tasks = [
      task({
        id: 'release',
        title: 'Current MVP',
        workKind: 'feature',
        status: 'ready',
        hierarchy: { childIds: ['feature'], order: 0 },
        workVisibility: { kind: 'primary', countInProjectTotals: true },
      }),
      task({
        id: 'feature',
        title: 'Story intelligence',
        workKind: 'feature',
        status: 'ready',
        hierarchy: { parentId: 'release', childIds: ['task'], order: 0 },
        workVisibility: { kind: 'primary', countInProjectTotals: true },
      }),
      task({
        id: 'task',
        title: 'Build packet composer',
        workKind: 'implementation',
        status: 'ready',
        hierarchy: { parentId: 'feature', childIds: ['step'], order: 0 },
        workVisibility: { kind: 'supporting', countInProjectTotals: true },
      }),
      task({
        id: 'step',
        title: 'Wire command output',
        workKind: 'implementation',
        status: 'ready',
        hierarchy: { parentId: 'task', childIds: ['substep'], order: 0 },
        workVisibility: { kind: 'supporting', countInProjectTotals: true },
      }),
      task({
        id: 'substep',
        title: 'Normalize JSON payload',
        workKind: 'implementation',
        status: 'ready',
        hierarchy: { parentId: 'step', childIds: [], order: 0 },
        workVisibility: { kind: 'supporting', countInProjectTotals: true },
      }),
    ]

    const release = deriveWorkExecutionState(tasks, 'release')
    const step = deriveWorkExecutionState(tasks, 'step')
    const substep = deriveWorkExecutionState(tasks, 'substep')

    expect(release.isContaining).toBe(true)
    expect(release.isRunnable).toBe(false)
    expect(release.visibleChildIds).toEqual(['feature', 'task', 'step', 'substep'])
    expect(release.runnableChildIds).toEqual(['substep'])
    expect(release.summaryState).toBe('ready')
    expect(step.isContaining).toBe(true)
    expect(step.runnableChildIds).toEqual(['substep'])
    expect(substep.isContaining).toBe(false)
    expect(substep.isRunnable).toBe(true)
  })

  it('keeps internal proof children out of visible counts while rolling blockers into parent execution state', () => {
    const tasks = [
      task({
        id: 'feature',
        title: 'CLI proof feature',
        status: 'ready',
        hierarchy: { childIds: ['implementation', 'proof'], order: 0 },
        workVisibility: { kind: 'primary', countInProjectTotals: true },
      }),
      task({
        id: 'implementation',
        title: 'Implement command',
        status: 'done',
        hierarchy: { parentId: 'feature', childIds: [], order: 0 },
        workVisibility: { kind: 'supporting', countInProjectTotals: true },
      }),
      task({
        id: 'proof',
        title: 'Run smoke proof',
        status: 'blocked',
        workKind: 'verification',
        hierarchy: { parentId: 'feature', childIds: [], order: 1 },
        workVisibility: { kind: 'internal_step', countInProjectTotals: false },
      }),
    ]

    const project = deriveProjectWorkExecutionState(tasks)
    const feature = project.byTaskId.feature

    expect(project.counts.visibleTotal).toBe(2)
    expect(project.counts.internalTotal).toBe(1)
    expect(feature?.visibleChildIds).toEqual(['implementation'])
    expect(feature?.internalChildIds).toEqual(['proof'])
    expect(feature?.blockedChildIds).toEqual(['proof'])
    expect(feature?.missingProofCount).toBe(1)
    expect(feature?.scopeAuthority.needsOwnerDecision).toBe(false)
    expect(feature?.summaryState).toBe('blocked')
  })

  it('keeps importer-generated decomposition children out of visible execution scope', () => {
    const tasks = [
      task({
        id: 'task-runner',
        title: 'Implement a no-UI runner that builds a packet from fixture records.',
        status: 'ready',
        requestIntake: { createdBy: 'workspace-importer' } as Task['requestIntake'],
        hierarchy: { childIds: ['task-runner-split-load-fixture-inputs'], order: 0, relation: 'contains' },
      }),
      task({
        id: 'task-runner-split-load-fixture-inputs',
        title: 'Load fixture inputs and canonical story records',
        status: 'exploring',
        hierarchy: { parentId: 'task-runner', childIds: [], order: 0, relation: 'decomposes' },
        notes: [{ agentId: 'task-sizing', role: 'coordinator', content: 'Generated split child.' }] as Task['notes'],
      }),
    ]

    const project = deriveProjectWorkExecutionState(tasks)
    const parent = project.byTaskId['task-runner']

    expect(project.counts.visibleTotal).toBe(1)
    expect(project.counts.internalTotal).toBe(1)
    expect(parent?.visibleChildIds).toEqual([])
    expect(parent?.internalChildIds).toEqual(['task-runner-split-load-fixture-inputs'])
    expect(parent?.runnableChildIds).toEqual(['task-runner-split-load-fixture-inputs'])
  })

  it('does not treat legacy split recommendations as runtime authority when hierarchy already exists', () => {
    const tasks = [
      task({
        id: 'parent',
        title: 'Broad accepted work',
        status: 'ready',
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
              reason: 'Legacy text that should not govern runtime truth.',
              dependsOn: [],
            },
          ],
          reasons: ['Legacy split required.'],
          createdAt: '2026-06-17T00:00:00.000Z',
          createdBy: 'test',
        },
      }),
      task({
        id: 'child',
        title: 'Real child work',
        status: 'ready',
        hierarchy: { parentId: 'parent', childIds: [], order: 0 },
      }),
    ]

    const state = deriveWorkExecutionState(tasks, 'parent')

    expect(state.executionPlanning.needsDecomposition).toBe(false)
    expect(state.executionPlanning.legacyRecommendationCount).toBe(1)
    expect(state.scopeAuthority.needsOwnerDecision).toBe(false)
    expect(state.runnableChildIds).toEqual(['child'])
    expect(state.summaryState).toBe('ready')
  })

  it('reports decomposition as an execution-planning need, not owner input, when broad work has no children', () => {
    const tasks = [
      task({
        id: 'broad',
        title: 'Broad accepted work',
        status: 'ready',
        sizePlan: {
          taskId: 'broad',
          score: 8,
          band: 'epic',
          action: 'split_required',
          factors: [],
          recommendedChildren: [],
          reasons: ['Too broad for one pass.'],
          createdAt: '2026-06-17T00:00:00.000Z',
          createdBy: 'test',
        },
      }),
    ]

    const state = deriveWorkExecutionState(tasks, 'broad')

    expect(state.executionPlanning.needsDecomposition).toBe(true)
    expect(state.scopeAuthority.needsOwnerDecision).toBe(false)
    expect(state.isRunnable).toBe(false)
    expect(state.summaryState).toBe('needs_decomposition')
  })

  it('runs approved bounded child contract work when stale decomposition has no children', () => {
    const tasks = [
      task({
        id: 'parent',
        title: 'Define fixture and evaluation schemas',
        status: 'ready',
        hierarchy: { childIds: ['child'], order: 0 },
      }),
      task({
        id: 'child',
        title: 'Capture prototype run and evaluation records',
        description: 'Stage 1 prototype-run and evaluation contract work.',
        status: 'ready',
        spec: [
          '## Summary',
          'Define the concrete prototype-run and evaluation record surface.',
          '',
          '## Completion Boundary',
          '- What must be split or blocked: any newly discovered product decision that changes which contracts belong in Stage 1 versus a later stage.',
        ].join('\n'),
        hierarchy: { parentId: 'parent', childIds: [], order: 1 },
        sizePlan: {
          taskId: 'child',
          score: 5,
          band: 'large',
          action: 'decompose_before_execution',
          factors: [],
          recommendedChildren: [],
          reasons: ['Stale empty decomposition flag from approved recovery spec.'],
          reviewBudgetHint: 'balanced',
          createdAt: '2026-07-04T00:00:00.000Z',
          createdBy: 'test',
        },
        taskReadiness: {
          taskKind: 'implementation',
          recommendation: 'needs_research_spike',
          summary: 'Task should run research or a spike before implementation.',
          dimensions: [],
          definitionOfDone: {
            items: ['Prototype run and evaluation records exist.'],
            evidenceRequired: ['Local proof command passes.'],
            updatedAt: '2026-07-04T00:00:00.000Z',
            createdBy: 'test',
          },
          blockerPlans: [],
          contextBudget: {
            estimatedTokens: 100,
            risk: 'low',
            fitsInOneWorkerBrief: true,
            reasons: [],
          },
          assessedAt: '2026-07-04T00:00:00.000Z',
          assessedBy: 'test',
        },
      }),
    ]

    const state = deriveWorkExecutionState(tasks, 'child')

    expect(state.executionPlanning.needsDecomposition).toBe(false)
    expect(state.isRunnable).toBe(true)
    expect(state.summaryState).toBe('ready')
  })
})
