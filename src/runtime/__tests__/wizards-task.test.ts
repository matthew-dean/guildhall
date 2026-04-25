/**
 * Task-scoped wizards: spec-fill derivation is pure over a TaskSnapshot,
 * same pattern as project wizards. Skip state is keyed per-task
 * (`${wizardId}:${taskId}`) so skipping the "brief" step on task A doesn't
 * silence it on task B.
 */
import { describe, it, expect } from 'vitest'
import {
  specFillWizard,
  progressForTask,
  buildTaskSnapshot,
  emptyWizardsState,
  type TaskSnapshot,
} from '../wizards.js'

function snap(overrides: Partial<TaskSnapshot> = {}): TaskSnapshot {
  return {
    id: 'task-1',
    title: '',
    description: '',
    status: 'exploring',
    spec: '',
    brief: { userJob: '', successCriteria: '', approvedAt: null },
    acceptanceCriteriaCount: 0,
    wizardState: emptyWizardsState(),
    ...overrides,
  }
}

describe('specFillWizard.progress', () => {
  it('reports all steps pending for a bare task', () => {
    const p = progressForTask(specFillWizard, snap())
    expect(p.doneCount).toBe(0)
    expect(p.activeStepId).toBe('title')
    expect(p.complete).toBe(false)
  })

  it('marks title/description done once set', () => {
    const p = progressForTask(
      specFillWizard,
      snap({ title: 'Audit auth', description: 'Look at the login flow.' }),
    )
    expect(p.steps.find(s => s.id === 'title')?.status).toBe('done')
    expect(p.steps.find(s => s.id === 'description')?.status).toBe('done')
    expect(p.activeStepId).toBe('brief')
  })

  it('rejects thin descriptions (<10 chars)', () => {
    const p = progressForTask(
      specFillWizard,
      snap({ title: 'x', description: 'short' }),
    )
    expect(p.steps.find(s => s.id === 'description')?.status).toBe('pending')
  })

  it('brief done needs BOTH userJob and successCriteria', () => {
    const half = progressForTask(
      specFillWizard,
      snap({
        title: 'x',
        description: 'Looooong enough',
        brief: { userJob: 'solo devs', successCriteria: '', approvedAt: null },
      }),
    )
    expect(half.steps.find(s => s.id === 'brief')?.status).toBe('pending')

    const full = progressForTask(
      specFillWizard,
      snap({
        title: 'x',
        description: 'Looooong enough',
        brief: { userJob: 'solo devs', successCriteria: 'ships v0.3', approvedAt: null },
      }),
    )
    expect(full.steps.find(s => s.id === 'brief')?.status).toBe('done')
  })

  it('acceptance done once count > 0', () => {
    const p = progressForTask(
      specFillWizard,
      snap({ acceptanceCriteriaCount: 2 }),
    )
    expect(p.steps.find(s => s.id === 'acceptance')?.status).toBe('done')
  })

  it('complete when all four steps are done', () => {
    const p = progressForTask(
      specFillWizard,
      snap({
        title: 'x',
        description: 'Looooong enough',
        brief: { userJob: 'u', successCriteria: 'd', approvedAt: '2026-01-01' },
        acceptanceCriteriaCount: 1,
      }),
    )
    expect(p.complete).toBe(true)
    expect(p.activeStepId).toBe(null)
  })

  it('skip is keyed per-task', () => {
    const base = snap({
      id: 'task-A',
      title: 'x',
      description: 'Looooong enough',
    })
    const skippedA = progressForTask(specFillWizard, {
      ...base,
      wizardState: {
        version: 1,
        skipped: { 'spec-fill:task-A': ['brief'] },
        completedAt: {},
      },
    })
    expect(skippedA.steps.find(s => s.id === 'brief')?.status).toBe('skipped')

    // Same state, different task id — skip shouldn't apply.
    const taskB = progressForTask(specFillWizard, {
      ...base,
      id: 'task-B',
      wizardState: {
        version: 1,
        skipped: { 'spec-fill:task-A': ['brief'] },
        completedAt: {},
      },
    })
    expect(taskB.steps.find(s => s.id === 'brief')?.status).toBe('pending')
  })

  it('skipped is sticky UNTIL underlying fact flips to done', () => {
    const withSkip: TaskSnapshot = {
      ...snap({ id: 'task-1', title: 'x', description: 'Looooong enough' }),
      wizardState: {
        version: 1,
        skipped: { 'spec-fill:task-1': ['brief'] },
        completedAt: {},
      },
    }
    expect(
      progressForTask(specFillWizard, withSkip).steps.find(s => s.id === 'brief')?.status,
    ).toBe('skipped')

    // Fill the brief — done wins.
    const filled: TaskSnapshot = {
      ...withSkip,
      brief: { userJob: 'u', successCriteria: 'd', approvedAt: null },
    }
    expect(
      progressForTask(specFillWizard, filled).steps.find(s => s.id === 'brief')?.status,
    ).toBe('done')
  })

  it('is not applicable to terminal tasks', () => {
    expect(specFillWizard.applicable(snap({ status: 'done' }))).toBe(false)
    expect(specFillWizard.applicable(snap({ status: 'cancelled' }))).toBe(false)
    expect(specFillWizard.applicable(snap({ status: 'archived' }))).toBe(false)
    expect(specFillWizard.applicable(snap({ status: 'exploring' }))).toBe(true)
    expect(specFillWizard.applicable(snap({ status: 'in_progress' }))).toBe(true)
  })
})

describe('buildTaskSnapshot', () => {
  it('accepts successMetric OR successCriteria for the brief "done-when" axis', () => {
    const viaMetric = buildTaskSnapshot({
      projectPath: '/tmp',
      task: {
        id: 't',
        title: 'x',
        description: 'Looooong enough',
        status: 'exploring',
        productBrief: { userJob: 'u', successMetric: 'ships v1' },
      },
      readWizardsState: () => emptyWizardsState(),
    })
    expect(viaMetric.brief.successCriteria).toBe('ships v1')

    const viaCriteria = buildTaskSnapshot({
      projectPath: '/tmp',
      task: {
        id: 't',
        productBrief: { successCriteria: 'passes audit' },
      },
      readWizardsState: () => emptyWizardsState(),
    })
    expect(viaCriteria.brief.successCriteria).toBe('passes audit')
  })

  it('coerces missing fields to safe defaults', () => {
    const s = buildTaskSnapshot({
      projectPath: '/tmp',
      task: { id: 't' },
      readWizardsState: () => emptyWizardsState(),
    })
    expect(s.title).toBe('')
    expect(s.description).toBe('')
    expect(s.status).toBe('')
    expect(s.brief.userJob).toBe('')
    expect(s.acceptanceCriteriaCount).toBe(0)
  })

  it('counts acceptance criteria', () => {
    const s = buildTaskSnapshot({
      projectPath: '/tmp',
      task: {
        id: 't',
        acceptanceCriteria: [{ description: 'a' }, { description: 'b' }],
      },
      readWizardsState: () => emptyWizardsState(),
    })
    expect(s.acceptanceCriteriaCount).toBe(2)
  })
})
