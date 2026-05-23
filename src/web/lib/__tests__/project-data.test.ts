import { describe, expect, it } from 'vitest'

import {
  buildProjectActivitySummary,
  buildCoordinatorsSurface,
  buildThreadPhaseGroups,
  buildWorkSurface,
} from '../project-data.js'
import type { EventEnvelope, ProjectDetail } from '../types.js'

describe('buildWorkSurface', () => {
  it('extracts work-surface state without component logic', () => {
    const detail: ProjectDetail = {
      config: { coordinators: [] },
      tasks: [
        { id: 'task-1', status: 'review', title: 'Review something' },
        { id: 'task-2', status: 'import_draft', title: 'Imported draft' },
      ],
      run: { status: 'running' },
      recentEvents: [
        { at: '2026-05-09T21:00:05.000Z' } as EventEnvelope,
        { at: '2026-05-09T21:00:01.000Z' } as EventEnvelope,
      ],
    }

    const model = buildWorkSurface(detail)
    expect(model.needsMeta).toBe(true)
    expect(model.running).toBe(true)
    expect(model.tasks).toHaveLength(1)
    expect(model.importDraftCount).toBe(1)
    expect(model.nextImportDraft?.id).toBe('task-2')
    expect(model.events.map((event) => event.at)).toEqual([
      '2026-05-09T21:00:01.000Z',
      '2026-05-09T21:00:05.000Z',
    ])
  })
})

describe('buildProjectActivitySummary', () => {
  it('preserves live event metadata on in-flight task rows', () => {
    const summary = buildProjectActivitySummary({
      running: true,
      runStatus: 'running',
      counts: { in_progress: 1 },
      inFlight: [
        {
          id: 'task-1',
          title: 'Long worker loop',
          status: 'in_progress',
          domain: 'runtime',
          lastActivityAt: '2026-05-23T18:01:00.000Z',
          lastActivityLabel: 'Failed command',
          lastActivityTone: 'danger',
        },
      ],
    })

    expect(summary.inFlight[0]).toMatchObject({
      id: 'task-1',
      lastActivityAt: '2026-05-23T18:01:00.000Z',
      lastActivityLabel: 'Failed command',
      lastActivityTone: 'danger',
    })
  })
})

describe('buildCoordinatorsSurface', () => {
  it('derives coordinator columns and selection in a pure helper', () => {
    const detail: ProjectDetail = {
      config: {
        coordinators: [
          { id: 'knit', name: 'Knit', domain: 'knit' },
          { id: 'looma', name: 'Looma', domain: 'looma' },
        ],
      },
      tasks: [
        { id: 'task-1', domain: 'knit', status: 'blocked', updatedAt: '2026-05-09T21:01:00.000Z' },
        { id: 'task-2', domain: 'knit', status: 'done', updatedAt: '2026-05-09T21:00:00.000Z' },
        { id: 'task-3', domain: 'looma', status: 'in_progress', updatedAt: '2026-05-09T21:02:00.000Z' },
      ],
    }

    const model = buildCoordinatorsSurface(detail, 'knit')
    expect(model.selectedCoordinatorId).toBe('knit')
    expect(model.coordinators).toHaveLength(1)
    expect(model.selectedColumn?.blocked).toBe(1)
    expect(model.selectedColumn?.done).toBe(1)
    expect(model.selectedColumn?.visibleTasks[0]?.id).toBe('task-1')
  })
})

describe('buildThreadPhaseGroups', () => {
  it('labels optional setup and paused inflight groups without component state', () => {
    const groups = buildThreadPhaseGroups([
      { phase: 'setup', kind: 'setup_step', skippable: true },
      { phase: 'inflight', kind: 'inflight', liveAgent: undefined },
    ])

    expect(groups).toEqual([
      {
        phase: 'setup',
        label: 'Optional',
        turns: [{ phase: 'setup', kind: 'setup_step', skippable: true }],
      },
      {
        phase: 'inflight',
        label: 'Paused',
        turns: [{ phase: 'inflight', kind: 'inflight', liveAgent: undefined }],
      },
    ])
  })
})
