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
    expect(model.importDrafts.map(task => task.id)).toEqual(['task-2'])
    expect(model.importDraftCount).toBe(1)
    expect(model.nextImportDraft?.id).toBe('task-2')
    expect(model.events.map((event) => event.at)).toEqual([
      '2026-05-09T21:00:01.000Z',
      '2026-05-09T21:00:05.000Z',
    ])
  })

  it('keeps internal delivery steps out of the default work surface', () => {
    const detail: ProjectDetail = {
      tasks: [
        { id: 'task-1', status: 'ready', title: 'Import review flow' },
        { id: 'task-1-proof', status: 'blocked', title: 'Runtime proof' },
        { id: 'task-2', status: 'import_draft', title: 'Imported draft' },
      ],
      workProgress: {
        counts: {
          visibleTotal: 1,
          visibleActive: 1,
          visibleBlocked: 0,
          visibleDone: 0,
          visibleShelved: 0,
          deliveryTotal: 1,
          deliveryRequired: 1,
          deliveryDone: 0,
          deliveryBlocked: 1,
        },
        byTaskId: {
          'task-1': { visibility: { kind: 'primary', countInProjectTotals: true } },
          'task-1-proof': { visibility: { kind: 'internal_step', countInProjectTotals: false } },
        },
      },
    }

    const model = buildWorkSurface(detail)
    expect(model.tasks.map(task => task.id)).toEqual(['task-1'])
    expect(model.importDrafts.map(task => task.id)).toEqual(['task-2'])
    expect(model.importDraftCount).toBe(1)
  })

  it('keeps decision-backed owner reviews visible even when they are internal proof steps', () => {
    const detail: ProjectDetail = {
      tasks: [
        { id: 'task-primary', status: 'ready', title: 'Current implementation task' },
        { id: 'task-proof-review', status: 'spec_review', title: 'Review the selected proof' },
        { id: 'task-hidden-proof', status: 'spec_review', title: 'Unselected internal proof' },
      ],
      startReadiness: {
        canStart: false,
        code: 'owner_review_required',
        reviewTaskIds: ['task-proof-review'],
      },
      workProgress: {
        counts: {
          visibleTotal: 1,
          visibleActive: 1,
          visibleBlocked: 0,
          visibleDone: 0,
          visibleShelved: 0,
          deliveryTotal: 1,
          deliveryRequired: 1,
          deliveryDone: 0,
          deliveryBlocked: 0,
        },
        byTaskId: {
          'task-primary': { visibility: { kind: 'primary', countInProjectTotals: true } },
          'task-proof-review': { visibility: { kind: 'internal_step', countInProjectTotals: false } },
          'task-hidden-proof': { visibility: { kind: 'internal_step', countInProjectTotals: false } },
        },
      },
    }

    expect(buildWorkSurface(detail).tasks.map(task => task.id)).toEqual([
      'task-primary',
      'task-proof-review',
    ])
  })

  it('keeps non-total supporting work out of ordinary work surfaces', () => {
    const detail: ProjectDetail = {
      tasks: [
        { id: 'task-primary', status: 'ready', title: 'Current implementation task' },
        { id: 'task-supporting', status: 'ready', title: 'Later supporting idea' },
      ],
      workProgress: {
        counts: {
          visibleTotal: 1,
          visibleActive: 1,
          visibleBlocked: 0,
          visibleDone: 0,
          visibleShelved: 0,
          deliveryTotal: 1,
          deliveryRequired: 1,
          deliveryDone: 0,
          deliveryBlocked: 0,
        },
        byTaskId: {
          'task-primary': { visibility: { kind: 'primary', countInProjectTotals: true } },
          'task-supporting': { visibility: { kind: 'supporting', countInProjectTotals: false } },
        },
      },
    }

    const model = buildWorkSurface(detail)
    expect(model.tasks.map(task => task.id)).toEqual(['task-primary'])
  })

  it('derives work areas from accepted structural map paths before source-path fallback', () => {
    const detail: ProjectDetail = {
      structuralMapReview: {
        state: 'accepted',
        domains: [
          { id: 'domain:auth', label: 'OAuth 2.1 / PKCE', path: 'service/auth/pkce' },
          { id: 'domain:billing', label: 'Billing', path: 'app/billing' },
        ],
      },
      tasks: [
        {
          id: 'task-auth',
          status: 'ready',
          title: 'Refresh token flow',
          domain: 'platform',
          description: 'service/auth/pkce/routes.py: update callback handling',
        },
      ],
    }

    const model = buildWorkSurface(detail)
    expect(model.workAreasByTaskId['task-auth']).toMatchObject({
      id: 'domain:auth',
      label: 'OAuth 2.1 / PKCE',
      kind: 'structural_domain',
      source: 'structural_map',
      confidence: 'accepted',
      path: 'service/auth/pkce',
    })
    expect(model.workAreaOptions).toEqual([
      expect.objectContaining({ id: 'domain:auth', label: 'OAuth 2.1 / PKCE' }),
    ])
  })

  it('uses task routing context and task domain before parsing description paths', () => {
    const detail: ProjectDetail = {
      config: {
        coordinators: [
          { id: 'payments', name: 'Payments', domain: 'payments' },
        ],
      },
      taskRoutingContexts: {
        'task-payments': {
          taskId: 'task-payments',
          likelyArea: { id: 'domain:checkout', label: 'Checkout', path: 'apps/shop/checkout' },
        },
      },
      tasks: [
        {
          id: 'task-payments',
          status: 'ready',
          title: 'Checkout tax handling',
          domain: 'payments',
          description: 'docs/roadmap.md: add checkout tax rules',
        },
        {
          id: 'task-domain',
          status: 'ready',
          title: 'Payments retry',
          domain: 'payments',
        },
      ],
    }

    const model = buildWorkSurface(detail)
    expect(model.workAreasByTaskId['task-payments']).toMatchObject({
      id: 'domain:checkout',
      label: 'Checkout',
      source: 'routing_context',
      confidence: 'inferred',
    })
    expect(model.workAreasByTaskId['task-domain']).toMatchObject({
      id: 'task-domain:payments',
      label: 'Payments',
      source: 'task',
      confidence: 'inferred',
    })
  })

  it('falls back to imported source paths when no structural area is known', () => {
    const detail: ProjectDetail = {
      tasks: [
        {
          id: 'task-knit-draft',
          status: 'import_draft',
          title: 'Templates',
          domain: 'workspace-import',
          notes: [
            {
              agentId: 'workspace-importer',
              role: 'importer',
              content: [
                'Imported from: /repo/knit/docs/features.md',
              ].join('\n'),
            },
          ],
        },
      ],
    }

    const model = buildWorkSurface(detail)
    expect(model.workAreasByTaskId['task-knit-draft']).toMatchObject({
      id: 'source-root:knit',
      label: 'Knit',
      source: 'source_ref',
      confidence: 'fallback',
      path: 'knit/docs/features.md',
    })
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

  it('keeps internal delivery steps out of coordinator task cards', () => {
    const model = buildCoordinatorsSurface({
      config: { coordinators: [{ id: 'knit', name: 'Knit', domain: 'knit' }] },
      tasks: [
        { id: 'task-1', domain: 'knit', status: 'ready', updatedAt: '2026-05-09T21:01:00.000Z' },
        { id: 'task-1-proof', domain: 'knit', status: 'blocked', updatedAt: '2026-05-09T21:02:00.000Z' },
      ],
      workProgress: {
        counts: {
          visibleTotal: 1,
          visibleActive: 1,
          visibleBlocked: 0,
          visibleDone: 0,
          visibleShelved: 0,
          deliveryTotal: 1,
          deliveryRequired: 1,
          deliveryDone: 0,
          deliveryBlocked: 1,
        },
        byTaskId: {
          'task-1': { visibility: { kind: 'primary', countInProjectTotals: true } },
          'task-1-proof': { visibility: { kind: 'internal_step', countInProjectTotals: false } },
        },
      },
    }, null)

    expect(model.columns[0]?.domainTasks.map(task => task.id)).toEqual(['task-1'])
    expect(model.columns[0]?.blocked).toBe(0)
  })
})

describe('buildThreadPhaseGroups', () => {
  it('labels optional setup while keeping task state out of phase labels', () => {
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
        label: 'Work',
        turns: [{ phase: 'inflight', kind: 'inflight', liveAgent: undefined }],
      },
    ])
  })

  it('uses typed activity state instead of activity wording for recovery', () => {
    const groups = buildThreadPhaseGroups([
      {
        phase: 'inflight',
        kind: 'inflight',
        taskStatus: 'in_progress',
        activity: [
          { label: 'A completely different failure explanation', tone: 'danger', kind: 'failure' },
          { label: 'A completely different progress explanation', tone: 'ok', kind: 'durable_progress' },
        ],
      },
    ])

    expect(groups[0]?.label).toBe('Needs recovery')
  })
})
