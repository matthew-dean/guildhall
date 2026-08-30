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

  it('presents spec_review component turns as owner review', () => {
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

    expect(stage.label).toBe('Review spec')
    expect(stage.key).toBe('spec_review')
  })

  it('presents raw spec_review tasks as owner review', () => {
    const stage = taskStagePresentation({
      id: 'task-import-combobox',
      title: 'Combobox',
      status: 'spec_review',
      spec: '## Summary\n\nBuild an accessible combobox.',
      acceptanceCriteria: [{ description: 'The combobox supports keyboard navigation.' }],
      openQuestions: [],
    }, { runStatus: 'stopped' })

    expect(stage.label).toBe('Review spec')
    expect(stage.key).toBe('spec_review')
  })

  it('presents coordinator-owned spec review as queued work instead of an owner action', () => {
    const stage = taskStagePresentation({
      id: 'task-coordinator-review',
      title: 'Coordinator review',
      status: 'spec_review',
      specReviewGate: { authority: 'coordinator' },
    }, { runStatus: 'stopped' })

    expect(stage).toEqual({
      label: 'Queued',
      tone: 'neutral',
      key: 'queued',
    })
  })

  it('presents an unlisted spec review as queued when shared owner readiness names no review', () => {
    const stage = taskStagePresentation({
      id: 'task-unlisted-review',
      title: 'Unlisted review',
      status: 'spec_review',
    }, {
      ownerReviewTaskIds: [],
    })

    expect(stage).toEqual({
      label: 'Queued',
      tone: 'neutral',
      key: 'queued',
    })
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

  it('presents API-assigned worker tasks as actively working', () => {
    const stage = taskStagePresentation({
      id: 'author-voice-loop-mvp',
      title: 'Implement author voice feedback loop MVP',
      status: 'in_progress',
      assignedTo: 'worker-agent',
    }, { runStatus: 'running' })

    expect(stage).toEqual({
      label: 'Working',
      tone: 'running',
      key: 'working',
    })
  })

  it('keeps a paused focused task paused when its old worker assignment remains saved', () => {
    const stage = taskStagePresentation({
      id: 'task-paused',
      title: 'Resume this exact work',
      status: 'in_progress',
      assignedTo: 'worker-agent',
    }, {
      runStatus: 'stopped',
      focusTaskId: 'task-paused',
      focusKind: 'paused_work',
    })

    expect(stage).toEqual({
      label: 'Paused',
      tone: 'neutral',
      key: 'paused',
    })
  })

  it('presents ready work with unmet dependencies as waiting instead of hard blocked', () => {
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
      label: 'Waiting',
      tone: 'warn',
      key: 'waiting_dependency',
    })
  })

  it('presents planning tasks as waiting while prerequisites are still being shaped', () => {
    const stage = taskStagePresentation({
      id: 'task-runner',
      title: 'Implement a no-UI runner that builds a packet from fixture records.',
      status: 'spec_review',
      dependsOn: ['task-fixture'],
      spec: '## Summary\n\nImplement the runner.',
      acceptanceCriteria: [{ description: 'The runner executes a fixture.' }],
      openQuestions: [],
    }, {
      runStatus: 'stopped',
      tasks: [
        { id: 'task-fixture', status: 'spec_review' },
      ],
    })

    expect(stage).toEqual({
      label: 'Waiting',
      tone: 'warn',
      key: 'waiting_dependency',
    })
  })

  it('presents the shared focused brief review as owner work while the coordinator is stopped', () => {
    const stage = taskStagePresentation({
      id: 'task-086',
      status: 'exploring',
      spec: '## Product brief\n\nProve the packaged sidecar.',
      openQuestions: [],
    }, {
      runStatus: 'stopped',
      focusTaskId: 'task-086',
      focusKind: 'brief_cleanup',
    })

    expect(stage).toEqual({
      label: 'Review brief',
      tone: 'warn',
      key: 'brief_review',
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
      expect(stage.label).not.toMatch(/Guildhall|shaping|revision|for Guildhall/i)
    }
  })
})
