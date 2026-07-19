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

  it('keeps selected-scope counts separate from global deferred work', () => {
    const progress = deriveProjectWorkProgress([
      {
        id: 'current-proof',
        title: 'Current proof',
        status: 'done',
        proofPaths: [{ id: 'proof', title: 'Proof', status: 'done' }],
      },
      {
        id: 'later-proof',
        title: 'Later proof',
        status: 'blocked',
        proofPaths: [{ id: 'proof', title: 'Proof', status: 'blocked' }],
      },
    ], { selectedTaskIds: ['current-proof'] })

    expect(progress.counts).toMatchObject({
      visibleTotal: 2,
      visibleBlocked: 1,
      deliveryRequired: 2,
      deliveryBlocked: 1,
    })
    expect(progress.selectedCounts).toMatchObject({
      visibleTotal: 1,
      visibleDone: 1,
      deliveryRequired: 1,
      deliveryDone: 1,
      deliveryBlocked: 0,
    })
  })

  it('counts selected-scope readiness blockers as blocked visible work', () => {
    const progress = deriveProjectWorkProgress([
      {
        id: 'current-shaping',
        title: 'Current shaping',
        status: 'ready',
      },
      {
        id: 'later-proof',
        title: 'Later proof',
        status: 'blocked',
      },
    ], {
      selectedTaskIds: ['current-shaping'],
      blockerTaskIds: ['current-shaping'],
    })

    expect(progress.counts).toMatchObject({
      visibleTotal: 2,
      visibleBlocked: 2,
    })
    expect(progress.selectedCounts).toMatchObject({
      visibleTotal: 1,
      visibleBlocked: 1,
      visibleActive: 0,
    })
    expect(progress.byTaskId['current-shaping']).toMatchObject({
      blocksSelectedScope: true,
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

  it('settles proof-path delivery steps when completion proof is recorded', () => {
    const progress = deriveProjectWorkProgress([
      {
        id: 'world-state-proof',
        title: 'Prove world-state continuity review',
        status: 'done',
        proofPaths: [
          {
            id: 'review-proof',
            title: 'Reviewer proof',
            kind: 'review',
            expectedEvidence: ['world-state-reviewer'],
          },
        ],
        reviewVerdicts: [
          {
            verdict: 'approved',
            reviewerPath: 'world-state-reviewer',
            recordedAt: '2026-07-06T13:35:47.512Z',
          },
        ],
      },
    ])

    expect(progress.byTaskId['world-state-proof']?.deliverySteps[0]).toMatchObject({
      id: 'proof:review-proof',
      status: 'done',
    })
    expect(progress.byTaskId['world-state-proof']?.rollup).toMatchObject({
      primaryState: 'done',
      doneStepCount: 1,
      requiredStepCount: 1,
    })
  })

  it('labels untitled proof delivery steps from expected evidence', () => {
    const progress = deriveProjectWorkProgress([
      {
        id: 'runner-proof',
        title: 'Run the headless fixture proof',
        status: 'done',
        proofPaths: [{ kind: 'review', expectedEvidence: ['pnpm-test-headless-fixture'] }],
        gateResults: [{
          gateId: 'pnpm-test-headless-fixture',
          status: 'passed',
          checkedAt: '2026-07-12T12:00:00.000Z',
        }],
      },
    ])

    expect(progress.byTaskId['runner-proof']?.deliverySteps).toEqual([
      expect.objectContaining({
        id: 'proof:1',
        title: 'Expected proof: pnpm-test-headless-fixture',
        status: 'done',
      }),
    ])
  })

  it('does not label proof steps from imported checklist or filler evidence', () => {
    const progress = deriveProjectWorkProgress([
      {
        id: 'db-types',
        title: 'Generate proper Supabase types',
        status: 'import_draft',
        proofPaths: [{
          kind: 'review',
          source: 'inferred',
          expectedEvidence: ['[ ] Unit tests: use-collections, use-presence, subdomain utils'],
        }],
      },
      {
        id: 'deepinfra',
        title: 'Select and prove a DeepInfra drafting model',
        status: 'done',
        proofPaths: [{
          kind: 'review',
          source: 'inferred',
          expectedEvidence: ['Select and prove a DeepInfra drafting model has a bounded proof plan for harness.'],
        }],
        gateResults: [{
          gateId: 'pnpm-build',
          status: 'passed',
          checkedAt: '2026-07-12T12:00:00.000Z',
        }],
      },
    ])

    expect(progress.byTaskId['db-types']?.deliverySteps[0]).toMatchObject({
      title: 'Proof needs shaping',
      status: 'todo',
    })
    expect(progress.byTaskId['deepinfra']?.deliverySteps[0]).toMatchObject({
      title: 'Gate passed: pnpm-build',
    })
  })

  it('does not keep parent proof paths as blockers after materialized child work exists', () => {
    const progress = deriveProjectWorkProgress([
      {
        id: 'parent-task',
        title: 'Build the headless story evaluator',
        status: 'done',
        proofPaths: [
          {
            id: 'proof-1',
            title: 'Proof 1',
            kind: 'review',
          },
        ],
        hierarchy: {
          childIds: ['child-task'],
        },
      },
      {
        id: 'child-task',
        title: 'Run the story evaluator fixture',
        status: 'done',
        hierarchy: {
          parentId: 'parent-task',
        },
      },
    ])

    expect(progress.byTaskId['parent-task']?.deliverySteps).toEqual([])
    expect(progress.byTaskId['parent-task']?.rollup).toMatchObject({
      primaryState: 'done',
      visibleChildCount: 1,
      visibleChildDoneCount: 1,
      requiredStepCount: 0,
    })
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

  it('omits archived tasks from active project progress state', () => {
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
    expect(progress.byTaskId['stale-shadow-import']).toBeUndefined()
  })

  it('hides workspace-imported spec criteria fragments from visible project totals', () => {
    const progress = deriveProjectWorkProgress([
      {
        id: 'editor-spec',
        title: 'Editor primitives',
        status: 'ready',
        requestIntake: { createdBy: 'workspace-importer' },
        references: ['/repo/knit/specs/v1-editor.md'],
      },
      {
        id: 'editor-ac1',
        title: 'AC1: Given an editor user, when they type bold text, then it renders bold.',
        status: 'import_draft',
        requestIntake: {
          createdBy: 'workspace-importer',
          evidenceRefs: ['import:/repo/knit/specs/v1-editor.md'],
        },
        references: ['/repo/knit/specs/v1-editor.md'],
      },
      {
        id: 'template-placeholder',
        title: 'Migration: [describe]',
        status: 'import_draft',
        requestIntake: {
          createdBy: 'workspace-importer',
          evidenceRefs: ['import:/repo/knit/specs/_template.md'],
        },
        references: ['/repo/knit/specs/_template.md'],
      },
    ])

    expect(progress.counts.visibleTotal).toBe(1)
    expect(progress.byTaskId['editor-spec']?.visibility.kind).toBe('primary')
    expect(progress.byTaskId['editor-ac1']?.visibility).toEqual({
      kind: 'hidden',
      countInProjectTotals: false,
      label: undefined,
    })
    expect(progress.byTaskId['template-placeholder']?.visibility).toEqual({
      kind: 'hidden',
      countInProjectTotals: false,
      label: undefined,
    })
  })
})
