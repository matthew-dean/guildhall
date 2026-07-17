import { describe, expect, it } from 'vitest'

import {
  blockerAgreementMismatches,
  projectionStateMismatches,
  releaseProjectionMismatches,
  revisionMismatches,
  selectedReleaseMismatches,
} from './project-state-agreement-audit.mjs'

const compactRelease = {
  scopeMode: 'named_release',
  counts: { total: 7, done: 0, unfinished: 7 },
}

const selected = {
  visibleTotal: 7,
  visibleDone: 0,
  visibleShelved: 0,
}

describe('project state agreement audit', () => {
  const surfaces = {
    overview: {
      summaryFreshness: 'current',
      releaseSummary: {
        release: { id: 'release-1', label: 'Release 1', kind: 'release', source: 'release_plan' },
        blockers: [{ id: 'task-1', label: 'Task 1' }],
      },
      releaseReadiness: { releaseBlockers: [{ id: 'task-1', label: 'Task 1' }] },
      orientationSpine: {
        selectedRelease: { id: 'release-1', label: 'Release 1', kind: 'release', source: 'release_plan' },
        selectedTaskScope: { id: 'release-1', nodeIds: ['work:task-1'], deferredNodeIds: ['work:task-2'] },
      },
    },
    work: {
      summaryFreshness: 'current',
      releaseSummary: {
        release: { id: 'release-1', label: 'Release 1', kind: 'release', source: 'release_plan' },
        blockers: [{ id: 'task-1', label: 'Task 1' }],
      },
      releaseReadiness: { releaseBlockers: [{ id: 'task-1', label: 'Task 1' }] },
      orientationSpine: {
        selectedRelease: { id: 'release-1', label: 'Release 1', kind: 'release', source: 'release_plan' },
        selectedTaskScope: { id: 'release-1', nodeIds: ['work:task-1'], deferredNodeIds: ['work:task-2'] },
      },
    },
  }

  it('flags selected release membership drift while ignoring raw release-envelope shape', () => {
    const mismatches = selectedReleaseMismatches({
      projectId: 'fixture',
      surfaces,
      releaseDetail: {
        release: { id: 'release-1', label: 'Release 1', kind: 'release', source: 'release_plan', nodeIds: ['work:parent'] },
        scope: { id: 'release-1', nodeIds: ['work:task-1'], deferredNodeIds: ['work:other'] },
      },
    })

    expect(mismatches).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'selected-release-membership' }),
    ]))
    expect(mismatches).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'selected-release-identity' }),
    ]))
  })

  it('flags top-level and nested blocker identity drift', () => {
    const mismatches = blockerAgreementMismatches({
      projectId: 'fixture',
      surfaces: {
        ...surfaces,
        overview: {
          ...surfaces.overview,
          releaseReadiness: {
            releaseBlockers: [{ id: 'task-2', label: 'Task 2' }],
            diagnostics: { releaseBlockers: [{ id: 'task-1', label: 'Task 1' }] },
          },
        },
      },
      releaseDetail: {
        releaseBlockers: [{ id: 'task-1', label: 'Task 1' }],
        diagnostics: { releaseBlockers: [{ id: 'task-2', label: 'Task 2' }] },
      },
    })

    expect(mismatches).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'nested-release-blocker-ids' }),
      expect.objectContaining({ field: 'nested-diagnostic-blocker-ids' }),
    ]))
  })

  it('allows diagnostic-only repository blockers while requiring saved task blockers', () => {
    expect(blockerAgreementMismatches({
      projectId: 'fixture',
      surfaces: {
        overview: {
          releaseSummary: { blockers: [{ id: 'task-1' }] },
          releaseReadiness: {
            releaseBlockers: [{ id: 'task-1' }],
            diagnostics: { releaseBlockers: [{ id: 'task-1' }, { id: 'repo:0' }] },
          },
        },
      },
      releaseDetail: {
        releaseBlockers: [{ id: 'task-1' }],
        diagnostics: { releaseBlockers: [{ id: 'task-1' }, { id: 'repository-followup:repo:0' }] },
      },
    })).toEqual([])
  })

  it('requires saved source, project, diagnostic, and thread revisions to align', () => {
    const result = revisionMismatches({
      projectId: 'fixture',
      spine: { queueRevision: 10, projectRevision: 11 },
      releaseDetail: {
        diagnosticSourceRevision: 10,
        stateConsistency: 'stale',
      },
      thread: { sourceRevision: 12 },
    })

    expect(result.revisions).toEqual({
      source: '10',
      project: '11',
      releaseQueue: null,
      releaseProject: null,
      diagnostic: '10',
      thread: '12',
    })
    expect(result.mismatches).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'diagnostic-project-revision' }),
      expect.objectContaining({ field: 'thread-project-revision' }),
      expect.objectContaining({ field: 'state-consistency' }),
    ]))
  })

  it('reports stale and missing saved projections without asking for a refresh', () => {
    const mismatches = projectionStateMismatches({
      projectId: 'fixture',
      surfaces: {
        overview: { summaryFreshness: 'stale', requiresRefresh: true },
        work: { summaryFreshness: 'missing', requiresRefresh: false },
      },
      activity: { summaryFreshness: 'current' },
      spine: { summaryFreshness: 'stale', requiresRefresh: true },
      releaseDetail: { summaryFreshness: 'current', diagnosticFreshness: 'missing' },
      thread: { currentThreadFreshness: 'stale' },
    })

    expect(mismatches).toEqual(expect.arrayContaining([
      expect.objectContaining({ surface: 'overview', field: 'projection-freshness', actual: 'stale' }),
      expect.objectContaining({ surface: 'work', field: 'projection-requires-refresh', actual: false }),
      expect.objectContaining({ surface: 'release-detail-diagnostic', field: 'projection-freshness', actual: 'missing' }),
      expect.objectContaining({ surface: 'thread', field: 'projection-freshness', actual: 'stale' }),
    ]))
  })

  it('flags evidence-derived done status drifting between compact and rich projections', () => {
    const mismatches = releaseProjectionMismatches({
      projectId: 'narrative-harness',
      compactRelease,
      selected,
      releaseDetail: {
        scope: { nodeIds: Array.from({ length: 7 }, (_, index) => `work:task-${index + 1}`) },
        totals: { tasks: 7, done: 2, unfinishedCount: 5 },
        statusCounts: { done: 2, ready: 3, spec_review: 1, exploring: 1 },
      },
    })

    expect(mismatches).toEqual(expect.arrayContaining([
      expect.objectContaining({
        surface: 'release-detail',
        field: 'compact-rich-done',
        expected: 0,
        actual: 2,
      }),
      expect.objectContaining({
        surface: 'release-detail',
        field: 'compact-rich-unfinished',
        expected: 7,
        actual: 5,
      }),
    ]))
  })

  it('accepts a synchronized compact and rich release projection', () => {
    expect(releaseProjectionMismatches({
      projectId: 'fixture',
      compactRelease,
      selected,
      releaseDetail: {
        scope: { nodeIds: Array.from({ length: 7 }, (_, index) => `work:task-${index + 1}`) },
        totals: { tasks: 7, done: 0, unfinishedCount: 7 },
        statusCounts: { ready: 3, blocked: 4 },
      },
    })).toEqual([])
  })

  it('flags a rich payload whose status buckets do not cover its task total', () => {
    const mismatches = releaseProjectionMismatches({
      projectId: 'fixture',
      compactRelease,
      selected,
      releaseDetail: {
        scope: { nodeIds: Array.from({ length: 7 }, (_, index) => `work:task-${index + 1}`) },
        totals: { tasks: 7, done: 0, unfinishedCount: 7 },
        statusCounts: { ready: 3, blocked: 3 },
      },
    })

    expect(mismatches).toEqual(expect.arrayContaining([
      expect.objectContaining({
        field: 'status-counts-total-invariant',
        expected: 7,
        actual: 6,
      }),
    ]))
  })
})
