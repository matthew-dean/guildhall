import { describe, expect, it } from 'vitest'

import { deriveProjectWorkProgress } from '../work-progress.js'

describe('deriveProjectWorkProgress', () => {
  it('counts logical work separately from internal delivery steps', () => {
    const progress = deriveProjectWorkProgress([
      {
        id: 'import-review-flow',
        title: 'Import review flow',
        status: 'ready',
        hierarchy: { childIds: ['runtime-proof'] },
      },
      {
        id: 'runtime-proof',
        title: 'Runtime proof',
        status: 'blocked',
        workKind: 'verification',
        blockReason: 'Needs a target URL.',
        hierarchy: { parentId: 'import-review-flow', order: 0 },
      },
    ])

    expect(progress.counts).toMatchObject({
      visibleTotal: 1,
      visibleActive: 1,
      visibleBlocked: 0,
      deliveryTotal: 1,
      deliveryBlocked: 1,
      deliveryDone: 0,
    })
    expect(progress.byTaskId['runtime-proof']?.visibility.kind).toBe('internal_step')
    expect(progress.byTaskId['import-review-flow']?.rollup).toMatchObject({
      primaryState: 'blocked',
      visibleChildCount: 0,
      internalStepCount: 1,
      blockedStepCount: 1,
    })
    expect(progress.byTaskId['import-review-flow']?.deliverySteps[0]).toMatchObject({
      sourceTaskId: 'runtime-proof',
      kind: 'verify',
      status: 'blocked',
      blocksCompletion: true,
    })
  })

  it('treats importer-generated decomposition children as internal steps even without explicit visibility', () => {
    const progress = deriveProjectWorkProgress([
      {
        id: 'task-runner',
        title: 'Implement a no-UI runner that builds a packet from fixture records.',
        status: 'ready',
        requestIntake: { createdBy: 'workspace-importer' },
        hierarchy: { childIds: ['task-runner-split-load-fixture-inputs'], relation: 'contains' },
      },
      {
        id: 'task-runner-split-load-fixture-inputs',
        title: 'Load fixture inputs and canonical story records',
        status: 'exploring',
        hierarchy: { parentId: 'task-runner', relation: 'decomposes', order: 0 },
        notes: [{ agentId: 'task-sizing', role: 'coordinator', content: 'Generated split child.' }],
      },
    ])

    expect(progress.counts.visibleTotal).toBe(1)
    expect(progress.byTaskId['task-runner-split-load-fixture-inputs']?.visibility).toEqual({
      kind: 'internal_step',
      countInProjectTotals: false,
      label: undefined,
    })
    expect(progress.byTaskId['task-runner']?.rollup).toMatchObject({
      visibleChildCount: 0,
      internalStepCount: 1,
    })
  })

  it('keeps tool and channel details as metadata rather than closed model kinds', () => {
    const progress = deriveProjectWorkProgress([
      {
        id: 'release-note',
        title: 'Release note',
        status: 'in_progress',
        proofPaths: [
          {
            id: 'preview-proof',
            title: 'Preview proof',
            status: 'blocked',
            kind: 'browser',
          },
        ],
      },
    ])

    expect(progress.byTaskId['release-note']?.deliverySteps).toEqual([
      expect.objectContaining({
        id: 'proof:preview-proof',
        kind: 'verify',
        evidenceChannel: 'runtime_observation',
        toolLabel: 'browser',
        status: 'blocked',
      }),
    ])
  })

  it('honors explicit visibility and preserves future evidence channel values', () => {
    const progress = deriveProjectWorkProgress([
      {
        id: 'raw-step',
        title: 'Raw step',
        status: 'ready',
        workVisibility: { kind: 'internal_step', countInProjectTotals: false },
        deliverySteps: [
          {
            id: 'simulator-snapshot',
            title: 'Simulator snapshot',
            kind: 'verify',
            status: 'done',
            required: true,
            blocksCompletion: true,
            evidenceChannel: 'simulator_snapshot',
          },
        ],
      },
    ])

    expect(progress.counts.visibleTotal).toBe(0)
    expect(progress.counts.deliveryTotal).toBe(1)
    expect(progress.counts.deliveryDone).toBe(1)
    expect(progress.byTaskId['raw-step']?.deliverySteps[0]?.evidenceChannel).toBe('simulator_snapshot')
  })

  it('rolls up shelved visible tasks as shelved instead of pending', () => {
    const progress = deriveProjectWorkProgress([
      {
        id: 'duplicate-split-child',
        title: 'Duplicate split child',
        status: 'shelved',
        shelveReason: {
          code: 'not_viable',
          detail: 'Duplicate child task was explicitly shelved.',
        },
      },
    ])

    expect(progress.counts).toMatchObject({
      visibleTotal: 1,
      visibleActive: 0,
      visibleShelved: 1,
    })
    expect(progress.byTaskId['duplicate-split-child']?.rollup.primaryState).toBe('shelved')
  })

  it('hides archived tasks from visible project totals', () => {
    const progress = deriveProjectWorkProgress([
      {
        id: 'stale-shadow-import',
        title: 'typed fixture and expected-record contracts',
        status: 'archived',
        archivedEvidence: {
          retention: 'archive',
          reason: 'Shadowed by current milestone starter sequence.',
          source: 'project-reintake',
        },
      },
    ])

    expect(progress.counts).toMatchObject({
      visibleTotal: 0,
      visibleActive: 0,
      visibleShelved: 0,
    })
    expect(progress.byTaskId['stale-shadow-import']?.visibility).toEqual({
      kind: 'hidden',
      countInProjectTotals: false,
    })
  })
})
