import { describe, expect, it } from 'vitest'
import { taskStagePresentation } from '../task-presentation.js'

describe('taskStagePresentation', () => {
  it('does not present a spec-ready exploring task as first-time intake', () => {
    const stage = taskStagePresentation({
      id: 'task-import-1y7kmp6',
      title: 'Block menu / block side menu',
      status: 'exploring',
      spec: '## Summary\n\nBuild the block menu.',
      acceptanceCriteria: [{ description: 'The block menu can be opened.' }],
      openQuestions: [],
    }, { runStatus: 'running' })

    expect(stage).toEqual({
      label: 'Queued',
      tone: 'running',
      key: 'queued',
    })
  })

  it('uses the same queued spec revision label for thread turns and work rows', () => {
    const stage = taskStagePresentation({
      kind: 'inflight',
      taskId: 'task-import-1y7kmp6',
      taskTitle: 'Block menu / block side menu',
      status: 'active',
      taskStatus: 'exploring',
      phase: 'spec',
      importedDraft: false,
      checklist: undefined,
    }, { runStatus: 'running' })

    expect(stage.label).toBe('Queued')
    expect(stage.key).toBe('queued')
  })

  it('recognizes spec_review component turns as queued spec work', () => {
    const stage = taskStagePresentation({
      kind: 'inflight',
      taskId: 'task-import-combobox',
      taskTitle: 'Combobox',
      status: 'active',
      taskStatus: 'spec_review',
      phase: 'spec',
      importedDraft: false,
      checklist: undefined,
    }, { runStatus: 'running' })

    expect(stage.label).toBe('Queued')
    expect(stage.key).toBe('queued')
  })

  it('recognizes raw spec_review component tasks as queued spec work', () => {
    const stage = taskStagePresentation({
      id: 'task-import-combobox',
      title: 'Combobox',
      status: 'spec_review',
      spec: '## Summary\n\nBuild an accessible combobox.',
      acceptanceCriteria: [{ description: 'The combobox supports keyboard navigation.' }],
      openQuestions: [],
    }, { runStatus: 'stopped' })

    expect(stage.label).toBe('Paused')
    expect(stage.key).toBe('paused')
  })

  it('presents Guildhall-owned queued work with the agent/running tone', () => {
    const stage = taskStagePresentation({
      id: 'task-ready',
      title: 'Ready worker task',
      status: 'ready',
      spec: '## Summary\n\nBuild the task.',
      productBrief: {
        userJob: 'Use the task.',
        whyItMattersNow: 'It is queued for Guildhall.',
        successMetric: 'The task works.',
        nonGoals: ['Do not change adjacent work.'],
        approvedAt: '2026-06-03T19:00:00.000Z',
      },
      acceptanceCriteria: [{ description: 'The task works.' }],
    }, { runStatus: 'running' })

    expect(stage).toEqual({
      label: 'Queued',
      tone: 'running',
      key: 'queued',
    })
  })

  it('presents queued work with unmet blockers as blocked', () => {
    const stage = taskStagePresentation({
      id: 'task-storybook-proof',
      title: 'Storybook proof',
      status: 'ready',
      dependsOn: ['task-component-implementation'],
    }, {
      runStatus: 'running',
      tasks: [
        { id: 'task-component-implementation', status: 'ready' },
      ],
    })

    expect(stage).toEqual({
      label: 'Blocked',
      tone: 'danger',
      key: 'dependency_blocked',
    })
  })

  it('keeps genuinely early exploring work queued instead of calling it intake', () => {
    const stage = taskStagePresentation({
      id: 'task-import-1aessks',
      title: 'Floating toolbar',
      status: 'exploring',
      openQuestions: [],
    }, { runStatus: 'running' })

    expect(stage.label).toBe('Queued')
    expect(stage.key).toBe('queued')
    expect(stage.tone).toBe('running')
  })

  it('does not claim Guildhall is shaping when the project is paused', () => {
    const stage = taskStagePresentation({
      id: 'task-import-1aessks',
      title: 'Floating toolbar',
      status: 'exploring',
      openQuestions: [],
    })

    expect(stage.label).toBe('Paused')
    expect(stage.key).toBe('paused')
    expect(stage.tone).toBe('neutral')
  })

  it('does not claim Guildhall is shaping when the project is merely available but no run is active', () => {
    const stage = taskStagePresentation({
      id: 'task-import-1aessks',
      title: 'Floating toolbar',
      status: 'exploring',
      openQuestions: [],
    }, { runStatus: 'stopped', availabilityStatus: 'active' })

    expect(stage.label).toBe('Paused')
    expect(stage.key).toBe('paused')
    expect(stage.tone).toBe('neutral')
  })

  it('keeps chip labels short status words instead of mini descriptions', () => {
    const examples = [
      taskStagePresentation({ status: 'exploring', openQuestions: [] }, { runStatus: 'running' }),
      taskStagePresentation({ status: 'exploring', openQuestions: [] }, { runStatus: 'stopped' }),
      taskStagePresentation({ status: 'exploring', spec: '## Spec', acceptanceCriteria: [{ description: 'Works.' }] }, { runStatus: 'running' }),
      taskStagePresentation({ status: 'ready' }, { runStatus: 'running' }),
      taskStagePresentation({ status: 'in_progress' }, { runStatus: 'running' }),
      taskStagePresentation({ status: 'review' }),
      taskStagePresentation({ status: 'gate_check' }),
      taskStagePresentation({ status: 'done' }),
    ]

    for (const stage of examples) {
      expect(stage.label.split(/\s+/)).toHaveLength(stage.label === 'Needs you' || stage.label === 'Needs brief' || stage.label === 'Needs recovery' || stage.label === 'Pending PR' ? 2 : 1)
      expect(stage.label).not.toMatch(/Guildhall|shaping|revision|waiting|for Guildhall/i)
    }
  })
})
