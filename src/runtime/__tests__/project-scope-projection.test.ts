import { describe, expect, it } from 'vitest'
import type { Task, TaskQueue } from '@guildhall/core'
import { buildProjectScopeProjection, deriveReleaseContainersFromTaskMembership, projectScopeMembershipCounts, selectedProjectScopeForQueue } from '../project-scope-projection.js'

const now = '2026-07-04T12:00:00.000Z'

function task(overrides: Record<string, unknown> = {}): Task {
  return {
    id: 'task-ready',
    title: 'Ready task',
    description: 'Ready task.',
    domain: 'app',
    projectPath: '/tmp/project',
    status: 'ready',
    priority: 'normal',
    dependsOn: [],
    acceptanceCriteria: [],
    notes: [],
    gateResults: [],
    reviewVerdicts: [],
    adjudications: [],
    revisionCount: 0,
    remediationAttempts: 0,
    escalations: [],
    agentIssues: [],
    origination: 'human',
    outOfScope: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as Task
}

function queue(tasks: Task[]): TaskQueue {
  return {
    version: 1,
    lastUpdated: now,
    selectedReleaseId: 'stage-1',
    releases: [{
      id: 'stage-1',
      label: 'Stage 1',
      kind: 'release',
      state: 'active',
      source: 'release_plan',
      nodeIds: ['work:task-contracts'],
      deferredNodeIds: ['work:task-later'],
      proofStyle: 'script_only',
    }],
    tasks,
  }
}

describe('buildProjectScopeProjection', () => {
  it('focuses the runnable dependency before blocked downstream shaping', () => {
    const projection = buildProjectScopeProjection({
      version: 1,
      lastUpdated: now,
      selectedReleaseId: 'stage-2',
      releases: [{
        id: 'stage-2',
        label: 'Stage 2',
        kind: 'release',
        state: 'active',
        source: 'owner_approved',
        nodeIds: ['work:task-gate', 'work:task-ui'],
        deferredNodeIds: [],
        proofStyle: 'mixed',
      }],
      tasks: [
        task({
          id: 'task-gate',
          title: 'Prove architecture gate',
          status: 'ready',
          spec: 'One approved gate.',
          acceptanceCriteria: [{ id: 'ac-1', description: 'The gate is proven.', verifiedBy: 'review', met: false }],
          releaseIds: ['stage-2'],
        }),
        task({
          id: 'task-ui',
          title: 'Build desktop UI',
          status: 'exploring',
          dependsOn: ['task-gate'],
          releaseIds: ['stage-2'],
        }),
      ],
    })

    expect(projection.rows.find(row => row.taskId === 'task-ui')).toMatchObject({
      dependencyBlocked: true,
      dependencyTaskIds: ['task-gate'],
      blocksStart: true,
    })
    expect(projection.start).toMatchObject({
      code: 'ready_work',
      focusTaskId: 'task-gate',
    })
  })

  it('keeps public release membership totals when execution scope is compacted', () => {
    expect(projectScopeMembershipCounts({
      id: 'stage-1',
      kind: 'release',
      nodeIds: ['work:parent'],
      deferredNodeIds: ['work:execution-only-deferred'],
    }, [{
      id: 'stage-1',
      label: 'Stage 1',
      kind: 'release',
      state: 'active',
      source: 'owner_approved',
      proofStyle: 'unspecified',
      nodeIds: ['work:parent', 'work:also-included'],
      deferredNodeIds: ['work:later-a', 'work:later-b'],
    }])).toEqual({ taskCount: 2, deferredTaskCount: 2 })
  })

  it('does not manufacture a release from task membership during a current-state read', () => {
    const selected = selectedProjectScopeForQueue({
      tasks: [task({ id: 'task-unreleased', releaseIds: ['release-in-task-only'] })],
      releases: [],
    })

    expect(selected).toBeNull()
  })

  it('does not widen materialized release membership from stale task release ids', () => {
    const projection = buildProjectScopeProjection({
      version: 1,
      lastUpdated: now,
      selectedReleaseId: 'stage-1',
      releases: [{
        id: 'stage-1',
        label: 'Stage 1',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        nodeIds: ['work:task-current'],
        deferredNodeIds: [],
        proofStyle: 'script_only',
      }],
      tasks: [
        task({ id: 'task-current', title: 'Current task', status: 'done', releaseIds: ['stage-1'] }),
        task({ id: 'task-stale', title: 'Stale imported duplicate', status: 'done', releaseIds: ['stage-1'] }),
      ],
    })

    expect(projection.selectedScope?.nodeIds).toEqual(['work:task-current'])
    expect(projection.rows.find(row => row.taskId === 'task-current')).toMatchObject({ scope: 'included' })
    expect(projection.rows.find(row => row.taskId === 'task-stale')).toMatchObject({ scope: 'deferred' })
  })

  it('makes script-only proof requirements part of the shared scope projection', () => {
    const projection = buildProjectScopeProjection({
      version: 1,
      lastUpdated: now,
      selectedReleaseId: 'stage-1',
      releases: [{
        id: 'stage-1',
        label: 'Stage 1',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        nodeIds: ['work:task-complete'],
        deferredNodeIds: [],
        proofStyle: 'script_only',
      }],
      tasks: [task({
        id: 'task-complete',
        title: 'Completed without executable proof',
        status: 'done',
        releaseIds: ['stage-1'],
      })],
    })

    expect(projection.selectedScope?.proofStyle).toBe('script_only')
    expect(projection.rows).toEqual([
      expect.objectContaining({
        taskId: 'task-complete',
        proofBlocked: true,
        blocksRelease: true,
      }),
    ])
    expect(projection.counts.proofBlocked).toBe(1)
    expect(projection.release).toMatchObject({ state: 'blocked' })
    expect(projection.start).toMatchObject({ code: 'proof_evidence_missing', focusTaskId: 'task-complete' })
  })

  it('uses the current release proof child instead of a shipped proof child', () => {
    const projection = buildProjectScopeProjection({
      version: 1,
      lastUpdated: now,
      selectedReleaseId: 'stage-1-r1',
      releases: [
        {
          id: 'stage-1-shipped',
          label: 'Stage 1 shipped',
          kind: 'release',
          state: 'shipped',
          source: 'release_plan',
          proofStyle: 'script_only',
          nodeIds: ['work:task-parent'],
          deferredNodeIds: [],
        },
        {
          id: 'stage-1-r1',
          label: 'Stage 1 follow-up',
          kind: 'release',
          state: 'active',
          source: 'release_plan',
          proofStyle: 'script_only',
          nodeIds: ['work:task-parent'],
          deferredNodeIds: [],
        },
      ],
      tasks: [
        task({
          id: 'task-parent',
          title: 'Parent work',
          status: 'done',
          releaseIds: ['stage-1-shipped', 'stage-1-r1'],
          hierarchy: { childIds: ['task-parent-proof-shipped'], order: 0, relation: 'contains' },
          acceptanceCriteria: [{ id: 'ac-1', description: 'Parent proof exists.', verifiedBy: 'review', met: false }],
        }),
        task({
          id: 'task-parent-proof-shipped',
          title: 'Historical proof',
          status: 'done',
          semanticKind: 'proof_setup',
          workVisibility: { kind: 'internal_step', countInProjectTotals: false },
          proofForReleaseId: 'stage-1-shipped',
          releaseIds: [],
          hierarchy: { parentId: 'task-parent', childIds: [], order: 1, relation: 'decomposes' },
        }),
        task({
          id: 'task-parent-proof-current',
          title: 'Current release proof',
          status: 'done',
          semanticKind: 'proof_setup',
          workVisibility: { kind: 'internal_step', countInProjectTotals: false },
          proofForReleaseId: 'stage-1-r1',
          releaseIds: [],
          hierarchy: { parentId: 'task-parent', childIds: [], order: 1, relation: 'decomposes' },
          acceptanceCriteria: [{
            id: 'ac-1',
            description: 'Current proof command passes.',
            verifiedBy: 'automated',
            command: 'pnpm proof:current',
            expectedOutputIncludes: ['guildhall-proof:task-parent'],
            met: true,
          }],
          proofPaths: [{
            id: 'current-proof-command',
            kind: 'command',
            command: 'pnpm proof:current',
            status: 'verified',
            verificationRecords: [{
              evidenceId: 'ac-1',
              status: 'passed',
              command: 'pnpm proof:current',
              recordedAt: now,
            }],
          }],
        }),
      ],
    })

    expect(projection.rows.find(row => row.taskId === 'task-parent')).toMatchObject({
      proofBlocked: false,
      blocksRelease: false,
    })
    expect(projection.release).toMatchObject({ state: 'ready', blockers: [] })
  })

  it('focuses blocked work before completed items with missing proof', () => {
    const projection = buildProjectScopeProjection({
      version: 1,
      lastUpdated: now,
      selectedReleaseId: 'stage-1',
      releases: [{
        id: 'stage-1',
        label: 'Stage 1',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        nodeIds: ['work:task-proof', 'work:task-blocked'],
        deferredNodeIds: [],
        proofStyle: 'script_only',
      }],
      tasks: [
        task({
          id: 'task-proof',
          title: 'Completed without proof',
          status: 'done',
          releaseIds: ['stage-1'],
        }),
        task({
          id: 'task-blocked',
          title: 'Blocked work',
          status: 'blocked',
          releaseIds: ['stage-1'],
          blockReason: 'Needs recovery.',
        }),
      ],
    })

    expect(projection.start).toMatchObject({
      canStart: false,
      code: 'no_unattended_progress',
      focusTaskId: 'task-blocked',
      focusKind: 'blocked_work',
    })
  })

  it('lets project Start advance an exploring source-backed shaping task', () => {
    const projection = buildProjectScopeProjection({
      version: 1,
      lastUpdated: now,
      selectedReleaseId: 'stage-1',
      releases: [{
        id: 'stage-1',
        label: 'Stage 1',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        nodeIds: ['work:task-shaping', 'work:task-proof'],
        deferredNodeIds: [],
        proofStyle: 'script_only',
      }],
      tasks: [
        task({
          id: 'task-proof',
          title: 'Completed work without proof',
          status: 'done',
          releaseIds: ['stage-1'],
        }),
        task({
          id: 'task-shaping',
          title: 'Shape source-backed work',
          status: 'exploring',
          releaseIds: ['stage-1'],
        }),
      ],
    })

    expect(projection.start).toMatchObject({
      canStart: true,
      code: 'ready_work',
      focusTaskId: 'task-shaping',
      focusKind: 'ready_work',
    })
  })

  it('keeps Guildhall-owned shaping separate from owner blocking', () => {
    const projection = buildProjectScopeProjection(queue([
      task({
        id: 'task-shaping',
        title: 'Shape imported work',
        status: 'exploring',
        releaseIds: ['stage-1'],
      }),
    ]))

    expect(projection.rows.find(row => row.taskId === 'task-shaping')).toMatchObject({
      handoffState: 'not_shaped',
      blocksStart: false,
      blocksRelease: true,
      humanBlocking: false,
    })
    expect(projection.counts).toMatchObject({ ownerBlocked: 0, humanBlocking: 0 })
    expect(projection.release).toMatchObject({ state: 'shaping' })
    expect(projection.start).toMatchObject({ canStart: true, focusTaskId: 'task-shaping' })
  })

  it('makes a complete unapproved brief the only owner action ahead of dependency-blocked drafts', () => {
    const completeBrief = {
      userJob: 'Prove the packaged sidecar before desktop work begins.',
      whyItMattersNow: 'The desktop release depends on this architecture gate.',
      successMetric: 'The packaged app completes one offline fixture run.',
      nonGoals: ['Do not build the full interface yet.'],
    }
    const projection = buildProjectScopeProjection({
      version: 1,
      lastUpdated: now,
      selectedReleaseId: 'stage-2',
      releases: [{
        id: 'stage-2',
        label: 'Stage 2',
        kind: 'release',
        state: 'active',
        source: 'owner_approved',
        nodeIds: ['work:task-086', 'work:task-087', 'work:task-088'],
        deferredNodeIds: [],
        proofStyle: 'mixed',
      }],
      tasks: [
        task({
          id: 'task-086',
          title: 'Prove packaged Tauri sidecar',
          status: 'exploring',
          productBrief: completeBrief,
          releaseIds: ['stage-2'],
        }),
        task({
          id: 'task-087',
          title: 'Define typed desktop harness adapter',
          status: 'spec_review',
          dependsOn: ['task-086'],
          spec: 'Define the typed adapter.',
          acceptanceCriteria: [{ id: 'ac-1', description: 'Typed adapter exists.', verifiedBy: 'review', met: false }],
          releaseIds: ['stage-2'],
        }),
        task({
          id: 'task-088',
          title: 'Build quiet desktop shell',
          status: 'exploring',
          dependsOn: ['task-086'],
          productBrief: completeBrief,
          releaseIds: ['stage-2'],
        }),
      ],
    })

    expect(projection.rows.find(row => row.taskId === 'task-086')).toMatchObject({
      handoffState: 'brief_cleanup',
      humanBlocking: true,
      dependencyBlocked: false,
    })
    expect(projection.rows.find(row => row.taskId === 'task-087')).toMatchObject({ dependencyBlocked: true })
    expect(projection.rows.find(row => row.taskId === 'task-088')).toMatchObject({ dependencyBlocked: true })
    expect(projection.start).toMatchObject({
      canStart: false,
      code: 'owner_input_required',
      focusTaskId: 'task-086',
      focusKind: 'brief_cleanup',
      actionHref: '/thread?thread=task%3Atask-086',
    })
    expect(projection.start.message).toMatch(/drafted brief ready for review/i)
  })

  it('keeps the current spec review ahead of dependency-blocked downstream reviews', () => {
    const approvedBrief = {
      userJob: 'Prove the packaged sidecar.',
      whyItMattersNow: 'The desktop release depends on the architecture gate.',
      successMetric: 'The packaged app completes one offline fixture run.',
      nonGoals: ['Do not build the full interface.'],
      approvedAt: now,
    }
    const projection = buildProjectScopeProjection({
      version: 1,
      lastUpdated: now,
      selectedReleaseId: 'stage-2',
      releases: [{
        id: 'stage-2',
        label: 'Stage 2',
        kind: 'release',
        state: 'active',
        source: 'owner_approved',
        nodeIds: ['work:task-086', 'work:task-087'],
        deferredNodeIds: [],
        proofStyle: 'mixed',
      }],
      tasks: [
        task({
          id: 'task-086',
          title: 'Prove packaged Tauri sidecar',
          status: 'spec_review',
          productBrief: approvedBrief,
          spec: 'Prove the package.',
          acceptanceCriteria: [{ id: 'ac-1', description: 'Package proof exists.', verifiedBy: 'review', met: false }],
          releaseIds: ['stage-2'],
        }),
        task({
          id: 'task-087',
          title: 'Define typed desktop harness adapter',
          status: 'spec_review',
          dependsOn: ['task-086'],
          productBrief: approvedBrief,
          spec: 'Define the adapter.',
          acceptanceCriteria: [{ id: 'ac-1', description: 'Typed adapter exists.', verifiedBy: 'review', met: false }],
          releaseIds: ['stage-2'],
        }),
      ],
    })

    expect(projection.rows.find(row => row.taskId === 'task-087')).toMatchObject({ dependencyBlocked: true })
    expect(projection.start).toMatchObject({
      canStart: false,
      focusTaskId: 'task-086',
      focusKind: 'spec_review',
      count: 1,
      actionHref: '/thread?thread=task%3Atask-086',
    })
  })

  it('reports later work when a named release is complete', () => {
    const projection = buildProjectScopeProjection({
      version: 1,
      lastUpdated: now,
      selectedReleaseId: 'stage-1',
      releases: [{
        id: 'stage-1',
        label: 'Stage 1',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        proofStyle: 'unspecified',
        nodeIds: ['work:task-done'],
        deferredNodeIds: ['work:task-later'],
      }],
      tasks: [
        task({ id: 'task-done', status: 'done', releaseIds: ['stage-1'] }),
        task({ id: 'task-later', title: 'Later task', status: 'ready' }),
      ],
    })

    expect(projection.start).toMatchObject({
      canStart: false,
      code: 'all_terminal',
      message: 'Stage 1 has no runnable work remaining.',
    })
  })

  it('derives visible release containers from task membership and selects unfinished scoped work', () => {
    const derived = deriveReleaseContainersFromTaskMembership([
      task({
        id: 'task-stage-1',
        title: 'Completed prior stage',
        status: 'done',
        releaseIds: ['stage-1-fixture-and-evaluation-harness'],
      }),
      task({
        id: 'task-current',
        title: 'Recover source truth',
        status: 'ready',
        releaseIds: ['near-term-proof-scope'],
      }),
      task({
        id: 'task-later',
        title: 'Later shell',
        status: 'shelved',
        releaseIds: ['stage-4-local-authoring-shell'],
      }),
    ])

    expect(derived.selectedReleaseId).toBe('near-term-proof-scope')
    expect(derived.releases).toEqual([
      expect.objectContaining({
        id: 'stage-1-fixture-and-evaluation-harness',
        label: 'Stage 1 Fixture And Evaluation Harness',
        nodeIds: ['work:task-stage-1'],
        deferredNodeIds: [],
      }),
      expect.objectContaining({
        id: 'near-term-proof-scope',
        label: 'Near Term Proof Scope',
        nodeIds: ['work:task-current'],
        deferredNodeIds: [],
      }),
      expect.objectContaining({
        id: 'stage-4-local-authoring-shell',
        label: 'Stage 4 Local Authoring Shell',
        nodeIds: [],
        deferredNodeIds: ['work:task-later'],
      }),
    ])
  })

  it('projects decomposed release parents to materialized child execution units', () => {
    const derived = deriveReleaseContainersFromTaskMembership([
      task({
        id: 'task-contracts',
        title: 'Define harness contracts',
        status: 'ready',
        hierarchy: {
          childIds: ['task-model', 'task-world', 'task-internal-proof'],
          relation: 'contains',
        },
      }),
      task({
        id: 'task-model',
        title: 'Select and prove DeepInfra drafting model',
        status: 'done',
        hierarchy: { parentId: 'task-contracts', childIds: [], order: 0, relation: 'decomposes' },
      }),
      task({
        id: 'task-world',
        title: 'Define world-state continuity review lane',
        status: 'ready',
        hierarchy: { parentId: 'task-contracts', childIds: [], order: 1, relation: 'decomposes' },
      }),
      task({
        id: 'task-internal-proof',
        title: 'Run proof step',
        status: 'ready',
        workVisibility: { kind: 'internal_step', countInProjectTotals: false },
        hierarchy: { parentId: 'task-contracts', childIds: [], order: 2, relation: 'decomposes' },
      }),
    ], {
      existingReleases: [{
        id: 'stage-1',
        label: 'Stage 1',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        nodeIds: ['work:task-contracts'],
        deferredNodeIds: [],
        proofStyle: 'script_only',
      }],
    })

    expect(derived.releases[0]).toMatchObject({
      id: 'stage-1',
      nodeIds: ['work:task-model', 'work:task-world'],
      deferredNodeIds: [],
    })
  })

  it('does not leak unscoped root tasks into every selected release', () => {
    const projection = buildProjectScopeProjection({
      version: 1,
      lastUpdated: now,
      selectedReleaseId: 'near-term-proof-scope',
      releases: [{
        id: 'near-term-proof-scope',
        label: 'Near Term Proof Scope',
        kind: 'release',
        state: 'active',
        source: 'inferred',
        nodeIds: ['work:task-reviewer'],
        deferredNodeIds: [],
        proofStyle: 'script_only',
      }],
      tasks: [
        task({
          id: 'task-reviewer',
          title: 'Implement dialogue reviewer',
          status: 'done',
          releaseIds: ['near-term-proof-scope'],
        }),
        task({
          id: 'task-unscoped',
          title: 'Unassigned recovered owner request',
          status: 'done',
          releaseIds: [],
        }),
      ],
    })

    expect(projection.selectedScope?.nodeIds).toEqual(['work:task-reviewer'])
    expect(projection.rows.find(row => row.taskId === 'task-reviewer')).toMatchObject({
      scope: 'included',
    })
    expect(projection.rows.find(row => row.taskId === 'task-unscoped')).toMatchObject({
      scope: 'deferred',
      eligibilityReason: 'deferred',
    })
    expect(projection.counts.included).toBe(1)
  })

  it('keeps shelved release members inside the release as deferred scope', () => {
    const projection = buildProjectScopeProjection({
      version: 1,
      lastUpdated: now,
      selectedReleaseId: 'stage-2',
      releases: [{
        id: 'stage-2',
        label: 'Stage 2',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        nodeIds: ['work:task-now', 'work:task-later'],
        deferredNodeIds: [],
        proofStyle: 'script_only',
      }],
      tasks: [
        task({
          id: 'task-now',
          title: 'Current release work',
          status: 'ready',
          releaseIds: ['stage-2'],
        }),
        task({
          id: 'task-later',
          title: 'Deferred release work',
          status: 'shelved',
          releaseIds: ['stage-2'],
        }),
      ],
    })

    expect(projection.selectedScope?.nodeIds).toEqual(['work:task-now'])
    expect(projection.selectedScope?.deferredNodeIds).toEqual(['work:task-later'])
    expect(projection.rows.find(row => row.taskId === 'task-later')).toMatchObject({
      scope: 'deferred',
      eligibilityReason: 'deferred',
      handoffState: 'deferred',
    })
    expect(projection.counts.included).toBe(1)
    expect(projection.counts.deferred).toBe(1)
  })

  it('treats release node membership as executable scope even when tasks lack releaseIds', () => {
    const projection = buildProjectScopeProjection({
      version: 1,
      lastUpdated: now,
      selectedReleaseId: 'stage-1',
      releases: [{
        id: 'stage-1',
        label: 'Stage 1',
        kind: 'release',
        state: 'active',
        source: 'inferred',
        nodeIds: [
          'work:done-task',
          'work:blocked-task',
          'work:spec-review-task',
        ],
        deferredNodeIds: [],
        proofStyle: 'script_only',
      }],
      tasks: [
        task({
          id: 'done-task',
          title: 'Completed release work',
          status: 'done',
          releaseIds: ['stage-1'],
          proofPaths: [{ kind: 'command', command: 'pnpm test' }],
    gateResults: [{ type: 'hard', passed: true, command: 'pnpm test', checkedAt: now }],
        }),
        task({
          id: 'blocked-task',
          title: 'Blocked release work',
          status: 'blocked',
          releaseIds: [],
          blockReason: 'Needs recovery.',
        }),
        task({
          id: 'spec-review-task',
          title: 'Spec review release work',
          status: 'spec_review',
          releaseIds: [],
          spec: 'Review this spec.',
          acceptanceCriteria: [{ id: 'AC-1', description: 'Spec is reviewed.', verifiedBy: 'review', met: false }],
        }),
      ],
    })

    expect(projection.selectedScope?.nodeIds).toEqual([
      'work:done-task',
      'work:blocked-task',
      'work:spec-review-task',
    ])
    expect(projection.rows.find(row => row.taskId === 'blocked-task')).toMatchObject({
      scope: 'included',
      eligibilityReason: 'included',
      handoffState: 'blocked',
      blockerSummary: 'Needs recovery.',
      blocksRelease: true,
    })
    expect(projection.rows.find(row => row.taskId === 'spec-review-task')).toMatchObject({
      scope: 'included',
      eligibilityReason: 'included',
      handoffState: 'spec_review',
      blocksRelease: true,
    })
    expect(projection.start).toMatchObject({
      canStart: false,
      code: 'no_unattended_progress',
      focusTaskId: 'blocked-task',
      focusKind: 'blocked_work',
    })
    expect(projection.start.message).toContain('Needs recovery.')
    expect(projection.release).toMatchObject({
      state: 'blocked',
      blockers: [
        expect.objectContaining({ id: 'blocked-task' }),
        expect.objectContaining({ id: 'spec-review-task' }),
      ],
    })
  })

  it('keeps derived materialized child splits inside a release when only the parent has release membership', () => {
    const parent = task({
      id: 'release-parent',
      title: 'Build release harness',
      status: 'done',
      releaseIds: ['headless-mvp'],
      hierarchy: { childIds: ['release-parent-split-review-proof'], relation: 'contains' },
    })
    const child = task({
      id: 'release-parent-split-review-proof',
      title: 'Review proof packet',
      status: 'spec_review',
      hierarchy: { parentId: 'release-parent', childIds: [], relation: 'decomposes', order: 0 },
    })
    const derived = deriveReleaseContainersFromTaskMembership([parent, child])
    const projection = buildProjectScopeProjection({
      version: 1,
      lastUpdated: now,
      selectedReleaseId: derived.selectedReleaseId,
      releases: derived.releases,
      tasks: [parent, child],
    })

    expect(derived.releases[0]?.nodeIds).toContain('work:release-parent-split-review-proof')
    expect(projection.selectedScope?.nodeIds).toContain('work:release-parent-split-review-proof')
    expect(projection.rows.find(row => row.taskId === 'release-parent-split-review-proof')).toMatchObject({
      scope: 'included',
      status: 'spec_review',
    })
    expect(projection.start).toMatchObject({
      code: 'no_unattended_progress',
      focusTaskId: 'release-parent-split-review-proof',
    })
  })

  it('treats materialized child work under an included parent as current paused work', () => {
    const projection = buildProjectScopeProjection(queue([
      task({
        id: 'task-contracts',
        title: 'Define harness contracts',
        hierarchy: { childIds: ['task-ground-truth'], order: 0 },
        spec: 'Define the fixture contract.',
        acceptanceCriteria: [{ id: 'AC-1', description: 'Contract is defined.', verifiedBy: 'automated', met: false }],
      }),
      task({
        id: 'task-ground-truth',
        title: 'Shape fixture and expected-record ground truth',
        status: 'in_progress',
        assignedTo: 'worker-agent',
        hierarchy: { parentId: 'task-contracts', childIds: [], order: 0 },
        spec: 'Shape fixture records.',
        acceptanceCriteria: [{ id: 'AC-1', description: 'Fixture exists.', verifiedBy: 'automated', met: false }],
      }),
      task({
        id: 'task-later',
        title: 'Later UI',
        releaseIds: ['later'],
      }),
    ]))

    expect(projection.rows.find(row => row.taskId === 'task-ground-truth')).toMatchObject({
      scope: 'included',
      eligibilityReason: 'included_ancestor',
      hierarchyRole: 'child',
      handoffState: 'paused',
      blocksStart: false,
      humanBlocking: false,
    })
    expect(projection.counts.paused).toBe(1)
    expect(projection.start).toMatchObject({
      canStart: true,
      code: 'paused_live_work',
      label: 'Resume',
      focusTaskId: 'task-ground-truth',
      focusKind: 'paused_work',
    })
  })

  it('counts materialized split children as execution work instead of double-counting their parent', () => {
    const projection = buildProjectScopeProjection(queue([
      task({
        id: 'task-contracts',
        title: 'Define harness contracts',
        hierarchy: { childIds: ['task-model', 'task-world'], order: 0, relation: 'contains' },
        spec: 'Define the fixture contract.',
        acceptanceCriteria: [{ id: 'AC-1', description: 'Contract is defined.', verifiedBy: 'automated', met: false }],
      }),
      task({
        id: 'task-model',
        title: 'Select and prove DeepInfra drafting model',
        status: 'in_progress',
        assignedTo: 'worker-agent',
        hierarchy: { parentId: 'task-contracts', childIds: [], order: 0, relation: 'decomposes' },
        spec: 'Select a DeepInfra model.',
        acceptanceCriteria: [{ id: 'AC-1', description: 'Model is selected.', verifiedBy: 'automated', met: false }],
      }),
      task({
        id: 'task-world',
        title: 'Define world-state continuity review lane',
        status: 'ready',
        hierarchy: { parentId: 'task-contracts', childIds: [], order: 1, relation: 'decomposes' },
        spec: 'Define the world-state reviewer.',
        acceptanceCriteria: [{ id: 'AC-1', description: 'Reviewer lane is defined.', verifiedBy: 'automated', met: false }],
      }),
    ]))

    expect(projection.rows.find(row => row.taskId === 'task-contracts')).toMatchObject({
      hierarchyRole: 'parent',
      scope: 'included',
    })
    expect(projection.selectedScope?.nodeIds).toEqual(['work:task-model', 'work:task-world'])
    expect(projection.rows.filter(row => row.scope === 'included')).toHaveLength(3)
    expect(projection.counts.included).toBe(2)
    expect(projection.counts.paused).toBe(1)
    expect(projection.counts.ready).toBe(1)
    expect(projection.start).toMatchObject({
      canStart: true,
      label: 'Resume',
      focusTaskId: 'task-model',
      focusKind: 'paused_work',
    })
  })

  it('uses a completed linked proof child to satisfy a containing parent without a second proof obligation', () => {
    const proofCommand = 'pnpm exec node scripts/proof-broad-genre-drafting.mjs'
    const projection = buildProjectScopeProjection(queue([
      task({
        id: 'task-contracts',
        title: 'Build drafting model proof',
        status: 'done',
        hierarchy: { childIds: ['task-proof-step'], relation: 'contains' },
        spec: 'The containing proof boundary.',
        acceptanceCriteria: [{ id: 'AC-parent', description: 'The proof is complete.', met: false }],
      }),
      task({
        id: 'task-proof-step',
        title: 'Run the bounded proof',
        status: 'done',
        workVisibility: { kind: 'internal_step', countInProjectTotals: false },
        hierarchy: { parentId: 'task-contracts', childIds: [], order: 0, relation: 'decomposes' },
        acceptanceCriteria: [{
          id: 'AC-1',
          description: 'The bounded proof passes.',
          command: proofCommand,
          expectedExit: 'zero',
          verifiedBy: 'automated',
          met: true,
        }],
        proofPaths: [{
          id: 'proof-step-command',
          kind: 'command',
          command: proofCommand,
          status: 'verified',
          verificationRecords: [{
            evidenceId: 'AC-1',
            status: 'passed',
            command: proofCommand,
            recordedAt: now,
          }],
        }],
      }),
    ]))

    expect(projection.release).toMatchObject({ state: 'ready', blockers: [] })
    expect(projection.counts).toMatchObject({ included: 1, done: 1, proofBlocked: 0 })
    expect(projection.rows.find(row => row.taskId === 'task-contracts')).toMatchObject({
      proofBlocked: false,
      blocksRelease: false,
    })
  })

  it('treats spec-shaped ready work as runnable even when the imported brief is thin', () => {
    const projection = buildProjectScopeProjection(queue([
      task({
        id: 'task-contracts',
        title: 'Define fixture contracts',
        productBrief: {
          userJob: 'Shape the contract.',
          whyItMattersNow: 'Needed by the runner.',
          successMetric: 'The runner can read it.',
        },
        spec: 'Fixture contract spec.',
        acceptanceCriteria: [{ id: 'AC-1', description: 'Contract is parseable.', verifiedBy: 'automated', met: false }],
      }),
    ]))

    expect(projection.rows.find(row => row.taskId === 'task-contracts')).toMatchObject({
      handoffState: 'ready',
      blocksStart: false,
      humanBlocking: false,
    })
    expect(projection.release.blockers).toEqual([])
    expect(projection.release.state).toBe('active')
  })

  it('does not double-punctuate release blocker labels for titled work', () => {
    const projection = buildProjectScopeProjection(queue([
      task({
        id: 'task-contracts',
        title: 'Define fixture contracts.',
        status: 'spec_review',
        spec: 'Fixture contract spec.',
        acceptanceCriteria: [{ id: 'AC-1', description: 'Contract is parseable.', verifiedBy: 'automated', met: false }],
      }),
    ]))

    expect(projection.release.blockers).toEqual([
      expect.objectContaining({
        id: 'task-contracts',
        label: 'Define fixture contracts: waiting for review before work can start.',
      }),
    ])
  })

  it('treats release-linked shelved work as deferred instead of current scope', () => {
    const projection = buildProjectScopeProjection(queue([
      task({
        id: 'task-contracts',
        title: 'Current scoped task',
        spec: 'Current work spec.',
        acceptanceCriteria: [{ id: 'AC-1', description: 'Current work is verifiable.', verifiedBy: 'automated', met: false }],
      }),
      task({
        id: 'task-future',
        title: 'Future roadmap task',
        status: 'shelved',
        releaseIds: ['stage-1'],
      }),
    ]))

    expect(projection.selectedScope).toMatchObject({
      nodeIds: ['work:task-contracts'],
      deferredNodeIds: ['work:task-later', 'work:task-future'],
    })
    expect(projection.rows.find(row => row.taskId === 'task-future')).toMatchObject({
      scope: 'deferred',
      eligibilityReason: 'deferred',
      handoffState: 'deferred',
      blocksStart: false,
      blocksRelease: false,
    })
    expect(projection.counts).toMatchObject({
      included: 1,
      deferred: 1,
    })
  })

  it('does not absorb unassigned current work into a selected named release', () => {
    const projection = buildProjectScopeProjection(queue([
      task({
        id: 'task-contracts',
        title: 'Current scoped task',
        spec: 'Current work spec.',
        acceptanceCriteria: [{ id: 'AC-1', description: 'Current work is verifiable.', verifiedBy: 'automated', met: false }],
      }),
      task({
        id: 'task-model-proof',
        title: 'Define drafting model proof',
        status: 'exploring',
        description: 'Select and prove a drafting model for the current bounded scope.',
      }),
      task({
        id: 'task-future-release',
        title: 'Future release task',
        status: 'ready',
        releaseIds: ['stage-2'],
      }),
      task({
        id: 'task-shelved',
        title: 'Explicitly shelved task',
        status: 'shelved',
      }),
    ]))

    expect(projection.selectedScope).toMatchObject({
      nodeIds: ['work:task-contracts'],
      deferredNodeIds: ['work:task-later'],
    })
    expect(projection.rows.find(row => row.taskId === 'task-model-proof')).toMatchObject({
      scope: 'deferred',
      eligibilityReason: 'deferred',
    })
    expect(projection.rows.find(row => row.taskId === 'task-future-release')).toMatchObject({
      scope: 'deferred',
      eligibilityReason: 'deferred',
    })
    expect(projection.rows.find(row => row.taskId === 'task-shelved')).toMatchObject({
      scope: 'deferred',
      handoffState: 'deferred',
    })
  })

  it('normalizes supplied current scopes with unassigned current work', () => {
    const projection = buildProjectScopeProjection({
      version: 1,
      lastUpdated: now,
      releases: [],
      tasks: [
        task({
          id: 'task-current',
          title: 'Current task from provisional scope',
          spec: 'Current work spec.',
          acceptanceCriteria: [{ id: 'AC-1', description: 'Current work is verifiable.', verifiedBy: 'automated', met: false }],
        }),
        task({
          id: 'task-model-proof',
          title: 'Define drafting model proof',
          status: 'exploring',
          description: 'Select and prove a drafting model for the current bounded scope.',
        }),
        task({
          id: 'task-workspace-import',
          title: 'Import project notes and plans',
          status: 'done',
        }),
      ],
    }, {
      selectedScope: {
        id: 'near-term-proof-scope',
        label: 'Near Term Proof Scope',
        kind: 'proposed_feature_set',
        source: 'inferred',
        nodeIds: ['work:task-current', 'work:task-workspace-import'],
        deferredNodeIds: [],
      },
    })

    expect(projection.selectedScope?.nodeIds).toEqual(['work:task-current', 'work:task-model-proof'])
    expect(projection.rows.find(row => row.taskId === 'task-model-proof')).toMatchObject({
      scope: 'included',
      eligibilityReason: 'included',
    })
  })

  it('drops workspace-import preview nodes from selected scope when the imported task exists', () => {
    const projection = buildProjectScopeProjection({
      version: 1,
      lastUpdated: now,
      releases: [],
      tasks: [
        task({
          id: 'task-import-1v8sume',
          title: 'Continue the Knit-to-Looma promotion work',
          status: 'import_draft',
          releaseIds: ['stage-1-finish-knit-primitive-replacement-wave'],
        }),
      ],
    }, {
      selectedScope: {
        id: 'stage-1-finish-knit-primitive-replacement-wave',
        label: 'Stage 1 Finish Knit Primitive Replacement Wave',
        kind: 'release',
        source: 'inferred',
        nodeIds: [
          'work:task-import-1v8sume',
          'work:workspace-import:task-import-1v8sume',
        ],
        deferredNodeIds: [],
      },
    })

    expect(projection.selectedScope?.nodeIds).toEqual(['work:task-import-1v8sume'])
    expect(projection.rows.filter(row => row.scope === 'included').map(row => row.taskId)).toEqual(['task-import-1v8sume'])
  })

  it('drops orphan workspace-import preview nodes from selected execution scope', () => {
    const projection = buildProjectScopeProjection({
      version: 1,
      lastUpdated: now,
      releases: [],
      tasks: [
        task({
          id: 'task-import-1v8sume',
          title: 'Continue the Knit-to-Looma promotion work',
          status: 'import_draft',
          releaseIds: ['stage-1-finish-knit-primitive-replacement-wave'],
        }),
      ],
    }, {
      selectedScope: {
        id: 'stage-1-finish-knit-primitive-replacement-wave',
        label: 'Stage 1 Finish Knit Primitive Replacement Wave',
        kind: 'release',
        source: 'inferred',
        nodeIds: [
          'work:task-import-1v8sume',
          'work:workspace-import:detected-task-import-1v8sume',
        ],
        deferredNodeIds: [
          'work:workspace-import:detected-task-later',
        ],
      },
    })

    expect(projection.selectedScope).toMatchObject({
      nodeIds: ['work:task-import-1v8sume'],
      deferredNodeIds: [],
    })
    expect(projection.rows.filter(row => row.scope === 'included').map(row => row.taskId)).toEqual(['task-import-1v8sume'])
  })

  it('drops archived release-linked work from the selected scope', () => {
    const projection = buildProjectScopeProjection(queue([
      task({
        id: 'task-contracts',
        title: 'Current scoped task',
        spec: 'Current work spec.',
        acceptanceCriteria: [{ id: 'AC-1', description: 'Current work is verifiable.', verifiedBy: 'automated', met: false }],
      }),
      task({
        id: 'task-stale',
        title: 'Archived stale import echo',
        status: 'archived',
        releaseIds: ['stage-1'],
      }),
    ]))

    expect(projection.selectedScope).toMatchObject({
      nodeIds: ['work:task-contracts'],
      deferredNodeIds: ['work:task-later'],
    })
    expect(projection.rows.some(row => row.taskId === 'task-stale')).toBe(false)
    expect(projection.counts).toMatchObject({
      included: 1,
      deferred: 0,
    })
  })

  it('marks the release ready only after included scoped work is done', () => {
    const projection = buildProjectScopeProjection(queue([
      task({
        id: 'task-contracts',
        title: 'Done scoped task',
        status: 'done',
        completedAt: now,
        proofPaths: [{ kind: 'command', command: 'pnpm test' }],
        gateResults: [{ type: 'hard', passed: true, command: 'pnpm test', checkedAt: now }],
      }),
    ]))

    expect(projection.release).toMatchObject({
      state: 'ready',
      blockers: [],
    })
  })

  it('blocks genuinely thin ready work as brief cleanup', () => {
    const projection = buildProjectScopeProjection(queue([
      task({
        id: 'task-contracts',
        title: 'Thin ready task',
      }),
    ]))

    expect(projection.rows.find(row => row.taskId === 'task-contracts')).toMatchObject({
      handoffState: 'brief_cleanup',
      blocksStart: true,
      humanBlocking: true,
    })
    expect(projection.start).toMatchObject({
      canStart: false,
      code: 'no_unattended_progress',
      focusKind: 'brief_cleanup',
      focusTaskId: 'task-contracts',
    })
  })

  it('shows active proof-recovery reason instead of stale max-revision blocker text', () => {
    const recoveryReason =
      'Codex is acting as the owner for this calibration run. Reopen this completed task only to recover the missing release proof. Run or create the smallest command-backed proof for DeepInfra drafting-model selection, including real provider/model/API evidence when credentials are available, and do not mark the task complete until that proof is attached.'
    const projection = buildProjectScopeProjection(queue([
      task({
        id: 'task-contracts',
        title: 'Recover provider proof',
        status: 'blocked',
        blockReason: 'max_revisions_exceeded: reviewer loop hit its old cap.',
        proofRecovery: {
          kind: 'proof',
          reopenedAt: now,
          reason: recoveryReason,
        },
      }),
    ]))

    expect(projection.rows.find(row => row.taskId === 'task-contracts')).toMatchObject({
      handoffState: 'blocked',
      blockerSummary: recoveryReason,
    })
    expect(projection.start.message).toContain(recoveryReason)
    expect(projection.start.message).not.toContain('max_revisions_exceeded')
  })
})
