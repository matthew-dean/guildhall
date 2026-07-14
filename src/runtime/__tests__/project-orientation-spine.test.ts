import { describe, expect, it } from 'vitest'
import {
  buildProjectOrientationSpine,
  taskEligibleForSelectedScope,
} from '../project-orientation-spine.js'
import { buildProjectScopeProjection } from '../project-scope-projection.js'

describe('buildProjectOrientationSpine', () => {
  it('builds a scoped state-of-the-union spine from charter, release scope, work hierarchy, and proof', () => {
    const spine = buildProjectOrientationSpine({
      projectId: 'narrative-harness',
      now: '2026-06-15T12:00:00.000Z',
      charter: {
        goal: 'Build a fiction-first evaluation and reasoning harness.',
        targetAudience: 'Authors and agent builders working on long-form fiction.',
        currentReleaseTarget: 'Stage 1 docs/spec/evaluation harness.',
        successDefinition: 'Specs are indexed, sliced, and tied to proof paths.',
        nonGoals: ['Production UI'],
        source: 'owner_approved',
      },
      scope: {
        id: 'stage-1',
        label: 'Stage 1 docs/spec/evaluation harness',
        kind: 'release',
        source: 'owner_approved',
        nodeIds: ['work:task-anti-sameness'],
        deferredNodeIds: ['work:task-production-ui'],
      },
      tasks: [
        {
          id: 'task-anti-sameness',
          title: 'Anti-sameness safeguards',
          description: 'Prevent repeated scene shapes and voice flattening.',
          domain: 'story-intelligence',
          projectPath: '/tmp/narrative-harness',
          status: 'ready',
          priority: 'normal',
          workKind: 'feature_spec',
          productBrief: { approvedAt: '2026-06-10T00:00:00.000Z' },
          spec: 'Define repeated-scene and voice-flattening safeguards.',
          acceptanceCriteria: [{ id: 'AC-1', description: 'Spec indexed.', verifiedBy: 'review', met: false }],
          proofPaths: [],
          hierarchy: { childIds: ['task-finding-taxonomy'] },
        },
        {
          id: 'task-finding-taxonomy',
          title: 'Finding taxonomy',
          description: 'Document finding weights.',
          domain: 'story-intelligence',
          projectPath: '/tmp/narrative-harness',
          status: 'done',
          priority: 'normal',
          hierarchy: { parentId: 'task-anti-sameness' },
          completionHandoff: {
            summary: 'Finding taxonomy is documented.',
            whatChanged: ['Added taxonomy spec.'],
            whatCanBeDoneNow: ['Reviewer contracts can reference weighted findings.'],
            howToProveIt: ['Open docs/specs and confirm taxonomy entry.'],
            verified: ['docs build passed'],
            notVerified: ['No prototype run yet'],
            remainingRisks: ['Needs fixture proof'],
          },
        },
        {
          id: 'task-production-ui',
          title: 'Production UI',
          description: 'Hosted UI for runs.',
          domain: 'app',
          projectPath: '/tmp/narrative-harness',
          status: 'ready',
          priority: 'normal',
        },
      ],
      releaseReadiness: {
        verdict: 'blocked',
        blockers: [{ id: 'proof:anti-sameness', label: 'Anti-sameness has no prototype proof.' }],
      },
    })

    expect(spine.charter.goal).toContain('fiction-first')
    expect(spine.scope?.label).toBe('Stage 1 docs/spec/evaluation harness')
    expect(spine.summary.headline).toBe('Stage 1 docs/spec/evaluation harness is waiting on proof.')
    expect(spine.summary.progress.specced).toBe(1)
    expect(spine.summary.progress.blocked).toBe(0)
    expect(spine.summary.nextAction).toBe('Review waiting work: Anti-sameness has no prototype proof.')
    expect(spine.summary.nextAction).not.toContain('blocker')
    expect(spine.summary.progress.proven).toBe(0)
    expect(spine.summary.progress.deferred).toBe(1)
    expect(spine.roots[0]?.title).toBe('Anti-sameness safeguards')
    expect(spine.roots[0]?.maturity).toBe('proof_needed')
    expect(spine.roots[0]?.source).toMatchObject({
      kind: 'task',
      confidence: 'high',
      refs: ['task:task-anti-sameness'],
    })
    expect(spine.release.blockers[0]?.owningNodeId).toBe('work:task-anti-sameness')
    expect(spine.gaps.map(gap => gap.kind)).not.toContain('source_conflict')
  })

  it('dedupes release blockers and anchors them to the exact task before fuzzy matching', () => {
    const spine = buildProjectOrientationSpine({
      projectId: 'narrative-harness',
      now: '2026-07-05T13:30:00.000Z',
      charter: {
        goal: 'Prove the headless Narrative Harness MVP from fixture records.',
        targetAudience: 'Authors and agent builders working on long-form fiction.',
        currentReleaseTarget: 'Near-term proof scope',
        successDefinition: 'The selected scope is ready only when specs are approved and proof is attached.',
        nonGoals: ['Production UI'],
        source: 'owner_approved',
      },
      releases: [{
        id: 'near-term-proof-scope',
        label: 'Near-term proof scope',
        kind: 'release',
        state: 'active',
        source: 'inferred',
        nodeIds: ['work:dialogue', 'work:fixture'],
        deferredNodeIds: [],
      }],
      selectedReleaseId: 'near-term-proof-scope',
      tasks: [
        {
          id: 'dialogue',
          title: 'Implement dialogue-and-character-voice reviewer lane',
          projectPath: '/tmp/narrative-harness',
          status: 'spec_review',
          priority: 'normal',
          spec: 'Reviewer lane spec.',
          acceptanceCriteria: [{ id: 'AC-1', description: 'Reviewer lane is defined.', verifiedBy: 'review', met: false }],
        },
        {
          id: 'fixture',
          title: 'Shape fixture and expected-record ground truth',
          projectPath: '/tmp/narrative-harness',
          status: 'ready',
          priority: 'normal',
        },
      ],
      scopeProjection: {
        selectedScope: {
          id: 'near-term-proof-scope',
          label: 'Near-term proof scope',
          kind: 'release',
          source: 'inferred',
          nodeIds: ['work:dialogue', 'work:fixture'],
          deferredNodeIds: [],
        },
        rows: [],
        counts: {
          included: 2,
          deferred: 0,
          ready: 1,
          paused: 0,
          active: 0,
          done: 0,
          ownerBlocked: 1,
          proofBlocked: 0,
          humanBlocking: 1,
        },
        start: {
          canStart: false,
          label: 'Review',
          message: 'Review 1 spec before work can start.',
          actionHref: '/projects/narrative-harness/work',
        },
        release: {
          id: 'near-term-proof-scope',
          label: 'Near-term proof scope',
          kind: 'release',
          state: 'active',
          source: 'inferred',
          description: null,
          nodeIds: ['work:dialogue', 'work:fixture'],
          deferredNodeIds: [],
          proofStyle: 'unspecified',
          blockers: [{
            id: 'dialogue',
            label: 'Implement dialogue-and-character-voice reviewer lane: waiting for review before work can start.',
          }],
        },
      },
      startReadiness: { canStart: false },
      releaseReadiness: {
        verdict: 'blocked',
        blockers: [{
          id: 'dialogue',
          label: 'Implement dialogue-and-character-voice reviewer lane: waiting for review before work can start.',
        }],
      },
    })

    expect(spine.release.blockers).toHaveLength(1)
    expect(spine.release.blockers[0]).toMatchObject({
      id: 'dialogue',
      owningNodeId: 'work:dialogue',
    })
  })

  it('rolls active internal child work into the selected release summary', () => {
    const spine = buildProjectOrientationSpine({
      projectId: 'narrative-harness',
      now: '2026-07-04T16:30:00.000Z',
      charter: {
        goal: 'Prove the headless Narrative Harness MVP from fixture records.',
        targetAudience: 'Authors and agent builders working on long-form fiction.',
        currentReleaseTarget: 'Stage 1 fixture and evaluation harness.',
        successDefinition: 'The selected release is complete only when script proof is attached.',
        nonGoals: ['Production UI'],
        source: 'owner_approved',
      },
      releases: [{
        id: 'stage-1-fixture-and-evaluation-harness',
        label: 'Stage 1: Fixture And Evaluation Harness',
        nodeIds: ['work:parent-contracts'],
        deferredNodeIds: [],
      }],
      selectedReleaseId: 'stage-1-fixture-and-evaluation-harness',
      tasks: [
        {
          id: 'parent-contracts',
          title: 'Define fixture, expected-record, prototype-run, and evaluation schemas.',
          projectPath: '/tmp/narrative-harness',
          status: 'ready',
          priority: 'normal',
          productBrief: {
            userJob: 'Shape the headless harness.',
            whyItMattersNow: 'The first proof loop needs contracts.',
            successMetric: 'Contracts are usable by the runner.',
          },
          spec: 'Parent contract spec.',
          acceptanceCriteria: [{ id: 'AC-1', description: 'Contracts exist.', verifiedBy: 'review', met: false }],
          hierarchy: {
            childIds: ['fixture-ground-truth'],
          },
        },
        {
          id: 'fixture-ground-truth',
          title: 'Shape fixture and expected-record ground truth',
          projectPath: '/tmp/narrative-harness',
          status: 'in_progress',
          priority: 'normal',
          assignedTo: 'worker-agent',
          productBrief: {
            approvedAt: '2026-07-04T16:00:00.000Z',
            userJob: 'Define fixture ground truth.',
            whyItMattersNow: 'The worker is implementing this child.',
            successMetric: 'Fixture records are available.',
            nonGoals: ['Prototype run records'],
          },
          spec: 'Child fixture spec.',
          acceptanceCriteria: [{ id: 'AC-1', description: 'Fixture records exist.', verifiedBy: 'test', met: false }],
          hierarchy: {
            parentId: 'parent-contracts',
          },
        },
      ],
      releaseReadiness: {
        verdict: 'blocked',
        blockers: [{
          id: 'parent-contracts',
          label: 'Define fixture, expected-record, prototype-run, and evaluation schemas needs brief cleanup before approval.',
        }],
      },
      scopeProjection: {
        selectedScope: {
          id: 'stage-1-fixture-and-evaluation-harness',
          label: 'Stage 1: Fixture And Evaluation Harness',
          kind: 'release',
          source: 'release_plan',
          nodeIds: ['work:parent-contracts'],
          deferredNodeIds: [],
        },
        rows: [],
        counts: {
          included: 2,
          deferred: 0,
          ready: 1,
          paused: 1,
          active: 1,
          done: 0,
          ownerBlocked: 0,
          proofBlocked: 0,
          humanBlocking: 0,
        },
        start: {
          canStart: true,
          code: 'paused_live_work',
          label: 'Resume',
          focusTaskId: 'fixture-ground-truth',
          focusTaskTitle: 'Shape fixture and expected-record ground truth',
          focusKind: 'paused_work',
          message: '"Shape fixture and expected-record ground truth" is paused in live work. Resume continues from that pinned task.',
          actionHref: '/work?task=fixture-ground-truth',
        },
        release: {
          state: 'active',
          blockers: [],
        },
      },
      startReadiness: {
        canStart: true,
        code: 'paused_live_work',
        message: '"Shape fixture and expected-record ground truth" is paused in live work. Resume continues from that pinned task.',
        actionHref: '/work?task=fixture-ground-truth',
      },
      runStatus: 'stopped',
    })

    expect(spine.nodes['work:parent-contracts']?.maturity).toBe('active')
    expect(spine.summary.progress.total).toBe(2)
    expect(spine.summary.progress.active).toBe(1)
    expect(spine.summary.progress.ready).toBe(1)
    expect(spine.summary.headline).toBe('Stage 1: Fixture And Evaluation Harness is paused with work in progress.')
    expect(spine.summary.topBlocker).toBeNull()
    expect(spine.summary.nextAction).toBe('Resume the current work.')
    expect(spine.release).toMatchObject({
      state: 'active',
      blockers: [],
    })
    expect(spine.activePins).toEqual(expect.arrayContaining([
      expect.objectContaining({
        nodeId: 'work:fixture-ground-truth',
        label: 'Shape fixture and expected-record ground truth',
        kind: 'active_work',
      }),
    ]))
  })

  it('defaults known proposed work into current work without inventing a release', () => {
    const spine = buildProjectOrientationSpine({
      projectId: 'demo',
      now: '2026-06-15T12:00:00.000Z',
      tasks: [
        {
          id: 'feature-a',
          title: 'Feature A',
          description: 'Included by default.',
          domain: 'app',
          projectPath: '/tmp/demo',
          status: 'ready',
          priority: 'normal',
        },
        {
          id: 'feature-b',
          title: 'Feature B',
          description: 'Also included by default.',
          domain: 'app',
          projectPath: '/tmp/demo',
          status: 'spec_review',
          priority: 'normal',
          spec: 'Feature B spec.',
        },
      ],
    })

    expect(spine.selectedRelease).toBeNull()
    expect((spine as any).selectedTaskScope).toMatchObject({
      id: 'current-work',
      label: 'Current task scope',
      kind: 'proposed_feature_set',
      source: 'inferred',
      nodeIds: ['work:feature-a', 'work:feature-b'],
      deferredNodeIds: [],
    })
    expect(spine.scope).toMatchObject({
      id: 'current-work',
      label: 'Current task scope',
      kind: 'proposed_feature_set',
      source: 'inferred',
      nodeIds: ['work:feature-a', 'work:feature-b'],
      deferredNodeIds: [],
    })
    expect(spine.summary.selectedReleaseLabel).toBeNull()
    expect(spine.summary.selectedScopeLabel).toBe('Current task scope')
    expect(spine.gaps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'missing_charter' }),
    ]))
  })

  it('does not promote imported spec acceptance criteria or templates into project skeleton work', () => {
    const spine = buildProjectOrientationSpine({
      projectId: 'looma-knit',
      now: '2026-06-18T12:00:00.000Z',
      tasks: [
        {
          id: 'editor-spec',
          title: 'Editor primitives',
          description: 'Build the editor primitive spec.',
          domain: 'knit',
          projectPath: '/repo/knit',
          status: 'ready',
          priority: 'normal',
          requestIntake: { createdBy: 'workspace-importer' },
          references: ['/repo/knit/specs/v1-editor.md'],
        },
        {
          id: 'editor-ac1',
          title: 'AC1: Given an editor user, when they type bold text, then it renders bold.',
          description: 'knit/specs/v1-editor.md acceptance criteria.',
          domain: 'knit',
          projectPath: '/repo/knit',
          status: 'import_draft',
          priority: 'normal',
          requestIntake: {
            createdBy: 'workspace-importer',
            evidenceRefs: ['import:/repo/knit/specs/v1-editor.md'],
          },
          references: ['/repo/knit/specs/v1-editor.md'],
        },
        {
          id: 'template-placeholder',
          title: 'AC1: Given [context], when [action], then [outcome]',
          description: 'Spec template placeholder.',
          domain: 'knit',
          projectPath: '/repo/knit',
          status: 'import_draft',
          priority: 'normal',
          requestIntake: {
            createdBy: 'workspace-importer',
            evidenceRefs: ['import:/repo/knit/specs/_template.md'],
          },
          references: ['/repo/knit/specs/_template.md'],
        },
      ],
    })

    expect(spine.summary.includedWorkCount).toBe(1)
    expect(spine.roots.map(root => root.title)).toEqual(['Editor primitives'])
    expect(spine.nodes['work:editor-spec']?.visibility).toEqual({ kind: 'primary', countInProjectTotals: true })
    expect(spine.nodes['work:editor-ac1']?.visibility).toEqual({ kind: 'hidden', countInProjectTotals: false })
    expect(spine.nodes['work:template-placeholder']?.visibility).toEqual({ kind: 'hidden', countInProjectTotals: false })
    expect(spine.proofContracts.map(contract => contract.title)).toEqual(['Editor primitives'])
  })

  it('groups flat imported feature roots by source document instead of flooding the map', () => {
    const spine = buildProjectOrientationSpine({
      projectId: 'looma-knit',
      now: '2026-06-18T12:00:00.000Z',
      tasks: [
        {
          id: 'review-parent',
          title: 'Review release readiness',
          description: 'Structured work that should stay as its own parent tree.',
          domain: 'knit',
          projectPath: '/repo/knit',
          status: 'ready',
          priority: 'normal',
          hierarchy: { childIds: ['review-proof'] },
        },
        {
          id: 'review-proof',
          title: 'Run release proof',
          description: 'Structured child work.',
          domain: 'knit',
          projectPath: '/repo/knit',
          status: 'ready',
          priority: 'normal',
          hierarchy: { parentId: 'review-parent' },
        },
        {
          id: 'follow-pages',
          title: '"Follow" a page to get updates',
          description: 'Feature catalog item.',
          domain: 'knit',
          projectPath: '/repo/knit',
          status: 'shelved',
          priority: 'normal',
          workKind: 'feature',
          requestIntake: { createdBy: 'workspace-importer' },
          references: ['/repo/knit/docs/features.md'],
        },
        {
          id: 'ai-search',
          title: 'AI-powered search',
          description: 'Feature catalog item.',
          domain: 'knit',
          projectPath: '/repo/knit',
          status: 'shelved',
          priority: 'normal',
          workKind: 'feature',
          requestIntake: { createdBy: 'workspace-importer' },
          references: ['/repo/knit/docs/features.md'],
        },
        {
          id: 'editor-spec',
          title: 'Editor primitives',
          description: 'Build the editor primitive spec.',
          domain: 'knit',
          projectPath: '/repo/knit',
          status: 'ready',
          priority: 'normal',
          workKind: 'feature_spec',
          requestIntake: { createdBy: 'workspace-importer' },
          references: ['/repo/knit/specs/v1-editor.md'],
        },
      ],
    })

    expect(spine.roots.map(root => root.title)).toEqual(['Review release readiness', 'Features', 'V1 Editor Spec'])
    expect(spine.roots.find(root => root.title === 'Review release readiness')?.children.map(child => child.title)).toEqual([
      'Run release proof',
    ])
    expect(spine.roots.find(root => root.title === 'Features')?.children.map(child => child.title)).toEqual([
      '"Follow" a page to get updates',
      'AI-powered search',
    ])
    expect(spine.roots.find(root => root.title === 'V1 Editor Spec')?.children.map(child => child.title)).toEqual([
      'Editor primitives',
    ])
  })

  it('treats shelved tasks as deferred in the fallback current-work scope', () => {
    const spine = buildProjectOrientationSpine({
      projectId: 'narrative-harness',
      now: '2026-06-18T12:00:00.000Z',
      tasks: [
        {
          id: 'task-current',
          title: 'Current harness slice',
          description: 'Current-scope work.',
          domain: 'harness',
          projectPath: '/tmp/narrative-harness',
          status: 'import_draft',
          priority: 'normal',
        },
        {
          id: 'task-later',
          title: 'Later reviewer lane',
          description: 'Deferred reviewer work.',
          domain: 'coherence',
          projectPath: '/tmp/narrative-harness',
          status: 'shelved',
          priority: 'normal',
        },
      ],
    })

    expect(spine.scope).toMatchObject({
      id: 'current-work',
      nodeIds: ['work:task-current'],
      deferredNodeIds: ['work:task-later'],
    })
    expect(spine.summary.includedWorkCount).toBe(1)
    expect(spine.summary.deferredWorkCount).toBe(1)
    expect(spine.nodes['work:task-later']?.maturity).toBe('deferred')
  })

  it('does not let hidden or out-of-scope leftovers bloat current-scope progress totals', () => {
    const spine = buildProjectOrientationSpine({
      projectId: 'narrative-harness',
      now: '2026-06-18T12:00:00.000Z',
      scope: {
        id: 'current-work',
        label: 'Current task scope',
        kind: 'proposed_feature_set',
        source: 'inferred',
        nodeIds: ['work:task-current'],
        deferredNodeIds: [],
      },
      tasks: [
        {
          id: 'task-current',
          title: 'Current harness slice',
          description: 'Current-scope work.',
          domain: 'harness',
          projectPath: '/tmp/narrative-harness',
          status: 'import_draft',
          priority: 'normal',
        },
        {
          id: 'task-stale-shelved',
          title: 'Old deferred residue',
          description: 'Not actually part of the selected scope.',
          domain: 'harness',
          projectPath: '/tmp/narrative-harness',
          status: 'shelved',
          priority: 'normal',
        },
        {
          id: 'task-archived',
          title: 'Archived residue',
          description: 'Historical noise.',
          domain: 'harness',
          projectPath: '/tmp/narrative-harness',
          status: 'archived',
          priority: 'normal',
        },
      ],
    })

    expect(spine.summary.includedWorkCount).toBe(1)
    expect(spine.summary.deferredWorkCount).toBe(0)
    expect(spine.summary.progress).toMatchObject({
      total: 1,
      deferred: 0,
    })
  })

  it('does not count importer-generated decomposition children as scoped work in current work', () => {
    const spine = buildProjectOrientationSpine({
      projectId: 'narrative-harness',
      now: '2026-06-18T12:00:00.000Z',
      tasks: [
        {
          id: 'task-runner',
          title: 'Implement a no-UI runner that builds a packet from fixture records.',
          description: 'Current-scope runner work.',
          domain: 'harness',
          projectPath: '/tmp/narrative-harness',
          status: 'ready',
          priority: 'normal',
          requestIntake: { createdBy: 'workspace-importer' },
          hierarchy: { childIds: ['task-runner-split-load-fixture-inputs'], relation: 'contains' },
        },
        {
          id: 'task-runner-split-load-fixture-inputs',
          title: 'Load fixture inputs and canonical story records',
          description: 'Execution breakdown only.',
          domain: 'harness',
          projectPath: '/tmp/narrative-harness',
          status: 'exploring',
          priority: 'normal',
          hierarchy: { parentId: 'task-runner', relation: 'decomposes', order: 0 },
          notes: [{ agentId: 'task-sizing', role: 'coordinator', content: 'Generated split child.' }],
        },
      ],
    })

    expect(spine.scope?.nodeIds).toEqual(['work:task-runner'])
    expect(spine.summary.includedWorkCount).toBe(1)
    expect(spine.summary.progress.total).toBe(1)
    expect(spine.nodes['work:task-runner-split-load-fixture-inputs']?.visibility).toEqual({
      kind: 'internal_step',
      countInProjectTotals: false,
    })
  })

  it('uses durable task references as first-class task source refs', () => {
    const spine = buildProjectOrientationSpine({
      projectId: 'narrative-harness',
      now: '2026-06-18T12:00:00.000Z',
      tasks: [
        {
          id: 'task-imported',
          title: 'Define fixture schemas',
          description: 'Imported harness task.',
          references: ['/tmp/narrative-harness/docs/harness/implementation-roadmap.md'],
          domain: 'harness',
          status: 'import_draft',
          priority: 'high',
        },
      ],
    })

    expect(spine.nodes['work:task-imported']?.source).toMatchObject({
      kind: 'import',
      refs: ['import:/tmp/narrative-harness/docs/harness/implementation-roadmap.md'],
      inferred: false,
    })
  })

  it('uses explicit non-MVP release records as the selected release container', () => {
    const spine = buildProjectOrientationSpine({
      projectId: 'jess',
      now: '2026-06-17T12:00:00.000Z',
      selectedReleaseId: '2-0-alpha',
      releases: [{
        id: '2-0-alpha',
        label: '2.0 alpha',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        nodeIds: ['work:parser-api'],
        deferredNodeIds: ['work:theme-editor'],
        proofStyle: 'script_only',
      }],
      tasks: [
        {
          id: 'parser-api',
          title: 'Stabilize parser API',
          description: 'Lock parser API shape for alpha users.',
          domain: 'api',
          projectPath: '/tmp/jess',
          status: 'ready',
          priority: 'normal',
          releaseIds: ['2-0-alpha'],
        },
        {
          id: 'theme-editor',
          title: 'Theme editor',
          description: 'Later visual editor.',
          domain: 'ui',
          projectPath: '/tmp/jess',
          status: 'ready',
          priority: 'normal',
        },
      ],
    })

    expect(spine.selectedRelease).toMatchObject({
      id: '2-0-alpha',
      label: '2.0 alpha',
      kind: 'release',
      source: 'release_plan',
      proofStyle: 'script_only',
      nodeIds: ['work:parser-api'],
      deferredNodeIds: ['work:theme-editor'],
    })
    expect((spine as any).selectedTaskScope).toMatchObject({
      id: '2-0-alpha',
      label: '2.0 alpha',
      kind: 'release',
      source: 'release_plan',
      nodeIds: ['work:parser-api'],
      deferredNodeIds: ['work:theme-editor'],
    })
    expect(spine.summary.selectedReleaseLabel).toBe('2.0 alpha')
    expect(spine.summary.headline).toBe('2.0 alpha is being shaped.')
    expect(spine.summary.includedWorkCount).toBe(1)
    expect(spine.summary.deferredWorkCount).toBe(1)
    expect(spine.nodes['work:parser-api']?.maturity).not.toBe('deferred')
    expect(spine.nodes['work:theme-editor']?.maturity).toBe('deferred')
  })

  it('uses the scope projection so unassigned current work appears in current-scope counts', () => {
    const tasks = [
      {
        id: 'task-current',
        title: 'Recover source-backed contract surface',
        description: 'Current release work.',
        domain: 'harness',
        projectPath: '/tmp/narrative-harness',
        status: 'ready',
        priority: 'normal',
        releaseIds: ['near-term-proof-scope'],
      },
      {
        id: 'task-model-proof',
        title: 'Define MVP drafting model and physical-world review lanes',
        description: 'Select a drafting model and define physical-world continuity reviewers.',
        domain: 'product',
        projectPath: '/tmp/narrative-harness',
        status: 'exploring',
        priority: 'normal',
      },
    ] as any[]
    const scopeProjection = buildProjectScopeProjection({
      version: 1,
      lastUpdated: '2026-07-05T12:00:00.000Z',
      releases: [],
      tasks,
    }, {
      selectedScope: {
        id: 'near-term-proof-scope',
        label: 'Near Term Proof Scope',
        kind: 'proposed_feature_set',
        source: 'inferred',
        nodeIds: ['work:task-current'],
        deferredNodeIds: [],
      },
    })

    const spine = buildProjectOrientationSpine({
      projectId: 'narrative-harness',
      now: '2026-07-05T12:00:00.000Z',
      selectedReleaseId: 'near-term-proof-scope',
      releases: [{
        id: 'near-term-proof-scope',
        label: 'Near Term Proof Scope',
        kind: 'current_work',
        state: 'active',
        source: 'inferred',
        nodeIds: ['work:task-current'],
        deferredNodeIds: [],
        proofStyle: 'script_only',
      }],
      tasks,
      scopeProjection,
    })

    expect(spine.selectedRelease?.nodeIds).toEqual(['work:task-current', 'work:task-model-proof'])
    expect(spine.scope?.nodeIds).toEqual(['work:task-current', 'work:task-model-proof'])
    expect(spine.summary.includedWorkCount).toBe(2)
    expect(spine.scopeRows.find(row => row.taskId === 'task-model-proof')).toMatchObject({
      scope: 'included',
      handoffState: 'not_shaped',
    })
  })

  it('uses executable scope rows so split parents do not inflate the map ledger', () => {
    const tasks = [
      {
        id: 'task-parent',
        title: 'Define Narrative Harness MVP drafting model and physical-world review lanes',
        description: 'Parent split into concrete proof lanes.',
        domain: 'product',
        projectPath: '/tmp/narrative-harness',
        status: 'done',
        priority: 'normal',
        hierarchy: { childIds: ['task-model', 'task-world', 'task-spatial'] },
        releaseIds: [],
        spec: 'Split parent.',
        acceptanceCriteria: [{ id: 'ac-parent', description: 'Children define the lanes.', verifiedBy: 'review', met: false }],
      },
      {
        id: 'task-model',
        title: 'Select and prove DeepInfra drafting model',
        description: 'Select the drafting model.',
        domain: 'product',
        projectPath: '/tmp/narrative-harness',
        status: 'done',
        priority: 'normal',
        hierarchy: { parentId: 'task-parent', relation: 'decomposes' },
        spec: 'Model spec.',
        acceptanceCriteria: [{ id: 'ac-model', description: 'Model selected.', verifiedBy: 'review', met: true }],
      },
      {
        id: 'task-world',
        title: 'Define world-state continuity review lane',
        description: 'Define world-state reviewer.',
        domain: 'product',
        projectPath: '/tmp/narrative-harness',
        status: 'done',
        priority: 'normal',
        hierarchy: { parentId: 'task-parent', relation: 'decomposes' },
        spec: 'World-state spec.',
        acceptanceCriteria: [{ id: 'ac-world', description: 'Reviewer defined.', verifiedBy: 'review', met: true }],
      },
      {
        id: 'task-spatial',
        title: 'Define spatial/geographic continuity review lane',
        description: 'Define spatial reviewer.',
        domain: 'product',
        projectPath: '/tmp/narrative-harness',
        status: 'done',
        priority: 'normal',
        hierarchy: { parentId: 'task-parent', relation: 'decomposes' },
        spec: 'Spatial spec.',
        acceptanceCriteria: [{ id: 'ac-spatial', description: 'Reviewer defined.', verifiedBy: 'review', met: true }],
      },
    ] as any[]
    const scopeProjection = buildProjectScopeProjection({
      version: 1,
      lastUpdated: '2026-07-06T07:10:00.000Z',
      selectedReleaseId: 'stage-1-fixture-and-evaluation-harness',
      releases: [{
        id: 'stage-1-fixture-and-evaluation-harness',
        label: 'Stage 1 Fixture And Evaluation Harness',
        kind: 'release',
        state: 'active',
        source: 'inferred',
        nodeIds: ['work:task-parent'],
        deferredNodeIds: [],
        proofStyle: 'script_only',
      }],
      tasks,
    })

    const spine = buildProjectOrientationSpine({
      projectId: 'narrative-harness',
      now: '2026-07-06T07:10:00.000Z',
      selectedReleaseId: 'stage-1-fixture-and-evaluation-harness',
      releases: [{
        id: 'stage-1-fixture-and-evaluation-harness',
        label: 'Stage 1 Fixture And Evaluation Harness',
        kind: 'release',
        state: 'active',
        source: 'inferred',
        nodeIds: ['work:task-parent'],
        deferredNodeIds: [],
        proofStyle: 'script_only',
      }],
      tasks,
      scopeProjection,
    })

    expect(spine.selectedRelease?.nodeIds).toEqual([
      'work:task-model',
      'work:task-world',
      'work:task-spatial',
    ])
    expect(spine.summary.includedWorkCount).toBe(3)
    expect(spine.scopeRows.filter(row => row.scope === 'included').map(row => row.taskId)).toEqual([
      'task-model',
      'task-world',
      'task-spatial',
    ])
  })

  it('keeps documented release metadata when imported tasks already materialized membership', () => {
    const tasks = [{
      id: 'task-model-proof',
      title: 'Select and prove a DeepInfra drafting model for broad-genre and legal adult fiction chapter writing.',
      description: 'Model proof lane.',
      domain: 'harness',
      projectPath: '/tmp/narrative-harness',
      status: 'done',
      priority: 'normal',
      releaseIds: ['stage-1-headless-drafting-and-evaluation-mvp'],
      references: ['/tmp/narrative-harness/docs/product/deepinfra-drafting-model-selection.md'],
      proofPaths: [{ kind: 'command', command: 'pnpm test', status: 'passed' }],
    }] as any[]
    const scopeProjection = buildProjectScopeProjection({
      version: 1,
      lastUpdated: '2026-07-12T22:10:00.000Z',
      selectedReleaseId: 'stage-1-headless-drafting-and-evaluation-mvp',
      releases: [{
        id: 'stage-1-headless-drafting-and-evaluation-mvp',
        label: 'Stage 1 Headless Drafting And Evaluation MVP',
        kind: 'release',
        state: 'ready',
        source: 'inferred',
        nodeIds: ['work:task-model-proof'],
        deferredNodeIds: [],
        proofStyle: 'unspecified',
      }],
      tasks,
    })

    const spine = buildProjectOrientationSpine({
      projectId: 'narrative-harness',
      now: '2026-07-12T22:10:00.000Z',
      selectedReleaseId: 'stage-1-headless-drafting-and-evaluation-mvp',
      releases: [{
        id: 'stage-1-headless-drafting-and-evaluation-mvp',
        label: 'Stage 1 Headless Drafting And Evaluation MVP',
        kind: 'release',
        state: 'ready',
        source: 'inferred',
        nodeIds: ['work:task-model-proof'],
        deferredNodeIds: [],
        proofStyle: 'unspecified',
      }],
      tasks,
      scopeProjection,
      workspaceImportDraft: {
        source: {
          kind: 'workspace_import',
          refs: ['/tmp/narrative-harness/docs/harness/implementation-roadmap.md'],
          confidence: 'high',
          freshness: 'fresh',
          inferred: false,
          refreshedAt: '2026-07-12T22:10:00.000Z',
        },
        releases: [{
          id: 'stage-1-headless-drafting-and-evaluation-mvp',
          label: 'Stage 1: Headless Drafting And Evaluation MVP',
          source: 'release_plan',
          proofStyle: 'script_only',
        }],
        tasks: [],
        contexts: [],
      },
    })

    expect(spine.selectedRelease).toMatchObject({
      id: 'stage-1-headless-drafting-and-evaluation-mvp',
      label: 'Stage 1: Headless Drafting And Evaluation MVP',
      source: 'release_plan',
      proofStyle: 'script_only',
      nodeIds: ['work:task-model-proof'],
    })
    expect(spine.scope).toMatchObject({
      source: 'release_plan',
      nodeIds: ['work:task-model-proof'],
    })
    expect(spine.sourceTrail.find(row => row.label === 'Scope')).toMatchObject({
      value: 'Release Plan',
      tone: 'ok',
    })
  })

  it('uses the inferred execution boundary as the selected release proof style fallback', () => {
    const spine = buildProjectOrientationSpine({
      projectId: 'narrative-harness',
      now: '2026-07-13T05:00:00.000Z',
      charter: {
        goal: 'The first MVP is headless: script-only proofs of all systems.',
        currentReleaseTarget: 'Stage 1 headless drafting and evaluation MVP.',
        successDefinition: 'Each scoped feature has runnable command-line or script proof.',
        source: 'inferred',
      },
      selectedReleaseId: 'stage-1-headless-drafting-and-evaluation-mvp',
      releases: [{
        id: 'stage-1-headless-drafting-and-evaluation-mvp',
        label: 'Stage 1: Headless Drafting And Evaluation MVP',
        kind: 'release',
        state: 'ready',
        source: 'release_plan',
        nodeIds: ['work:task-model-proof'],
        deferredNodeIds: [],
        proofStyle: 'unspecified',
      }],
      tasks: [{
        id: 'task-model-proof',
        title: 'Select and prove a DeepInfra drafting model.',
        description: 'Run a CLI proof for broad-genre chapter drafting.',
        status: 'done',
        releaseIds: ['stage-1-headless-drafting-and-evaluation-mvp'],
      }],
    })

    expect(spine.executionBoundary.proofStyle).toBe('script_only')
    expect(spine.selectedRelease?.proofStyle).toBe('script_only')
    expect(spine.releases.find(release => release.id === 'stage-1-headless-drafting-and-evaluation-mvp')?.proofStyle).toBe('script_only')
  })

  it('flags near-duplicate work split across scopes instead of hiding richer owner requirements', () => {
    const tasks = [
      {
        id: 'task-model-current',
        title: 'Select and prove a DeepInfra drafting model for broad-genre chapter writing.',
        description: 'Imported roadmap task.',
        domain: 'harness',
        projectPath: '/tmp/narrative-harness/docs/harness',
        status: 'done',
        priority: 'normal',
        releaseIds: ['stage-1-headless-mvp'],
        references: ['/tmp/narrative-harness/docs/harness/implementation-roadmap.md'],
      },
      {
        id: 'task-model-owner',
        title: 'Select and prove a DeepInfra drafting model for broad-genre and legal adult fiction chapter writing.',
        description: 'Recovered owner requirement with the legally allowed adult-fiction boundary.',
        domain: 'product',
        projectPath: '/tmp/narrative-harness',
        status: 'done',
        priority: 'normal',
        releaseIds: ['near-term-proof-scope'],
        references: ['/tmp/narrative-harness/docs/product/deepinfra-drafting-model-selection.md'],
      },
      {
        id: 'task-world-current',
        title: 'Prove world-state continuity review over elapsed-time object and property changes.',
        description: 'Imported roadmap task.',
        domain: 'coherence',
        projectPath: '/tmp/narrative-harness/docs/coherence',
        status: 'done',
        priority: 'normal',
        releaseIds: ['stage-1-headless-mvp'],
        references: ['/tmp/narrative-harness/docs/specs/world-and-object-continuity.md'],
      },
      {
        id: 'task-world-owner',
        title: 'Define world-state continuity review lane',
        description: 'Recovered owner requirement.',
        domain: 'product',
        projectPath: '/tmp/narrative-harness/docs/product',
        status: 'done',
        priority: 'normal',
        releaseIds: ['near-term-proof-scope'],
        references: ['/tmp/narrative-harness/docs/product/mvp-physical-review-lanes.md'],
      },
    ] as any[]

    const scopeProjection = buildProjectScopeProjection({
      version: 1,
      lastUpdated: '2026-07-06T07:10:00.000Z',
      selectedReleaseId: 'stage-1-headless-mvp',
      releases: [{
        id: 'stage-1-headless-mvp',
        label: 'Stage 1 Headless MVP',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        nodeIds: ['work:task-model-current', 'work:task-world-current'],
        deferredNodeIds: [],
        proofStyle: 'script_only',
      }],
      tasks,
    })

    const spine = buildProjectOrientationSpine({
      projectId: 'narrative-harness',
      now: '2026-07-06T07:10:00.000Z',
      selectedReleaseId: 'stage-1-headless-mvp',
      releases: [{
        id: 'stage-1-headless-mvp',
        label: 'Stage 1 Headless MVP',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        nodeIds: ['work:task-model-current', 'work:task-world-current'],
        deferredNodeIds: [],
        proofStyle: 'script_only',
      }],
      tasks,
      scopeProjection,
    })

    expect(spine.gaps).toContainEqual(expect.objectContaining({
      kind: 'source_conflict',
      severity: 'warn',
      label: expect.stringContaining('legal adult fiction'),
      refs: expect.arrayContaining([
        'task:task-model-current',
        'task:task-model-owner',
        'import:/tmp/narrative-harness/docs/harness/implementation-roadmap.md',
        'import:/tmp/narrative-harness/docs/product/deepinfra-drafting-model-selection.md',
      ]),
    }))
    expect(spine.gaps).toContainEqual(expect.objectContaining({
      kind: 'source_conflict',
      severity: 'warn',
      label: expect.stringContaining('world-state continuity review'),
      refs: expect.arrayContaining([
        'task:task-world-current',
        'task:task-world-owner',
      ]),
    }))
    expect(spine.sourceHealth.conflicts).toBe(2)
    expect(spine.sourceHealth.gaps).toBe(0)
    expect(spine.summary.headline).toBe('Stage 1 Headless MVP is complete.')
    expect(spine.summary.nextAction).toBe('Review current work.')
  })

  it('does not surface a stale duplicate done row as separate proof work when richer blocked scoped work owns the capability', () => {
    const tasks = [
      {
        id: 'task-select-and-prove-deepinfra',
        title: 'Select and prove a DeepInfra drafting model for broad-genre and legal adult fiction chapter writing.',
        description: 'Recovered owner requirement with the adult-fiction drafting boundary.',
        domain: 'harness',
        projectPath: '/tmp/narrative-harness',
        status: 'blocked',
        priority: 'high',
        releaseIds: ['near-term-proof-scope', 'stage-1-headless-mvp'],
        references: ['/tmp/narrative-harness/docs/product/deepinfra-drafting-model-selection.md'],
      },
      {
        id: 'task-import-lu6waj',
        title: 'Select and prove a DeepInfra drafting model for broad-genre chapter writing.',
        description: 'Older imported roadmap row that lacks the adult-fiction requirement.',
        domain: 'harness',
        projectPath: '/tmp/narrative-harness/docs/harness',
        status: 'done',
        priority: 'normal',
        references: ['/tmp/narrative-harness/docs/harness/implementation-roadmap.md'],
        proofPaths: [{
          kind: 'command',
          command: 'pnpm nh:model-proof',
          status: 'blocked',
        }],
      },
    ] as any[]

    const release = {
      id: 'stage-1-headless-mvp',
      label: 'Stage 1 Headless MVP',
      kind: 'release' as const,
      state: 'active' as const,
      source: 'release_plan' as const,
      nodeIds: [
        'work:task-select-and-prove-deepinfra',
        'work:task-import-lu6waj',
      ],
      deferredNodeIds: [],
      proofStyle: 'script_only' as const,
    }
    const scopeProjection = buildProjectScopeProjection({
      version: 1,
      lastUpdated: '2026-07-07T09:10:00.000Z',
      selectedReleaseId: release.id,
      releases: [release],
      tasks,
    })

    const spine = buildProjectOrientationSpine({
      projectId: 'narrative-harness',
      now: '2026-07-07T09:10:00.000Z',
      selectedReleaseId: release.id,
      releases: [release],
      tasks,
      scopeProjection,
      startReadiness: {
        canStart: false,
        code: 'no_unattended_progress',
        message: '"Select and prove a DeepInfra drafting model for broad-genre and legal adult fiction chapter writing." is blocked before unattended work can run.',
      } as any,
      releaseReadiness: {
        blockers: [{
          id: 'task-select-and-prove-deepinfra',
          label: 'Select and prove a DeepInfra drafting model for broad-genre and legal adult fiction chapter writing.',
        }],
      },
    })

    expect(spine.gaps).toContainEqual(expect.objectContaining({
      kind: 'source_conflict',
      label: expect.stringContaining('legal adult fiction'),
    }))
    expect(spine.gaps).not.toContainEqual(expect.objectContaining({
      kind: 'proof_needed',
      refs: ['task:task-import-lu6waj'],
    }))
    expect(spine.activePins.map(pin => pin.label)).not.toContain('Select and prove a DeepInfra drafting model for broad-genre chapter writing.')
    expect(spine.proofContracts.find(contract => contract.nodeId === 'work:task-import-lu6waj')).toBeUndefined()
    expect(spine.summary.progress).toMatchObject({
      blocked: 1,
      done: 1,
      total: 2,
    })
    expect(spine.summary.topBlocker).toContain('legal adult fiction')
  })

  it('does not count workspace-import preview nodes once the imported task is materialized', () => {
    const spine = buildProjectOrientationSpine({
      projectId: 'looma-knit',
      now: '2026-07-06T07:20:00.000Z',
      selectedReleaseId: 'stage-1-finish-knit-primitive-replacement-wave',
      releases: [{
        id: 'stage-1-finish-knit-primitive-replacement-wave',
        label: 'Stage 1 Finish Knit Primitive Replacement Wave',
        kind: 'release',
        state: 'active',
        source: 'inferred',
        nodeIds: [
          'work:task-import-1v8sume',
          'work:workspace-import:task-import-1v8sume',
        ],
        deferredNodeIds: [],
        proofStyle: 'unspecified',
      }],
      tasks: [{
        id: 'task-import-1v8sume',
        title: 'Continue the Knit-to-Looma promotion work',
        description: 'Imported current work has a materialized task record.',
        domain: 'looma',
        projectPath: '/tmp/looma-knit',
        status: 'import_draft',
        priority: 'normal',
        releaseIds: ['stage-1-finish-knit-primitive-replacement-wave'],
      }] as any[],
    })

    expect(spine.selectedRelease?.nodeIds).toEqual(['work:task-import-1v8sume'])
    expect(spine.scope?.nodeIds).toEqual(['work:task-import-1v8sume'])
    expect(spine.summary.includedWorkCount).toBe(1)
  })

  it('matches workspace-import draft work to materialized tasks by durable id before title', () => {
    const spine = buildProjectOrientationSpine({
      projectId: 'looma-knit',
      now: '2026-07-06T07:40:00.000Z',
      tasks: [{
        id: 'task-import-1v8sume',
        title: 'Continue the Knit-to-Looma promotion work',
        description: 'Saved task title was cleaned after import.',
        domain: 'looma',
        projectPath: '/tmp/looma-knit',
        status: 'import_draft',
        priority: 'normal',
        releaseIds: ['stage-1-finish-knit-primitive-replacement-wave'],
      }] as any[],
      workspaceImportDraft: {
        source: {
          kind: 'inferred',
          refs: ['workspace-import:draft'],
          confidence: 'high',
          freshness: 'fresh',
          inferred: true,
          refreshedAt: '2026-07-06T07:40:00.000Z',
        },
        releases: [{
          id: 'stage-1-finish-knit-primitive-replacement-wave',
          label: 'Stage 1 Finish Knit Primitive Replacement Wave',
          source: 'release_plan',
          state: 'active',
        }],
        tasks: [{
          id: 'task-import-1v8sume',
          title: 'Continue the Knit-to-Looma promotion work from the now-complete first M6 queue into the next generic surfaces, while the',
          description: 'Stale imported title should not create a duplicate preview node.',
          domain: 'looma',
          scope: 'current',
          releaseIds: ['stage-1-finish-knit-primitive-replacement-wave'],
          refs: ['import:looma/PROJECT_STATE.md'],
        }],
        contexts: [],
      },
    })

    expect(spine.selectedRelease?.nodeIds).toEqual(['work:task-import-1v8sume'])
    expect(spine.scope?.nodeIds).toEqual(['work:task-import-1v8sume'])
    expect(spine.nodes['work:workspace-import:task-import-1v8sume']).toBeUndefined()
  })

  it('does not let stale workspace-import release hints override durable task release membership', () => {
    const spine = buildProjectOrientationSpine({
      projectId: 'narrative-harness',
      now: '2026-07-12T12:00:00.000Z',
      tasks: [{
        id: 'task-import-1c4eedx',
        title: 'Implement fixture-and-expected-record schemas',
        description: 'Durable task was reclassified after import.',
        domain: 'harness',
        projectPath: '/tmp/narrative-harness',
        status: 'done',
        priority: 'normal',
        releaseIds: ['near-term-proof-scope'],
        proofPaths: [{
          kind: 'command',
          command: 'pnpm test -- schema-fixtures',
          source: 'inferred',
          status: 'blocked',
          expectedEvidence: ['Fixture records prove rollback behavior.'],
        }],
      }] as any[],
      workspaceImportDraft: {
        source: {
          kind: 'inferred',
          refs: ['workspace-import:draft'],
          confidence: 'medium',
          freshness: 'fresh',
          inferred: true,
          refreshedAt: '2026-07-12T12:00:00.000Z',
        },
        releases: [{
          id: 'stage-1-headless-drafting-and-evaluation-mvp',
          label: 'Stage 1 Headless Drafting And Evaluation MVP',
          source: 'release_plan',
          state: 'active',
        }],
        tasks: [{
          id: 'task-import-1c4eedx',
          title: 'Implement fixture-and-expected-record schemas',
          description: 'Stale detector still thinks this is Stage 1.',
          domain: 'harness',
          scope: 'current',
          releaseIds: ['stage-1-headless-drafting-and-evaluation-mvp'],
          refs: ['import:docs/specs/schema-contract-roadmap.md'],
        }],
        contexts: [],
      },
    })

    expect(spine.selectedRelease?.id).toBe('near-term-proof-scope')
    expect(spine.scope?.id).toBe('near-term-proof-scope')
    expect(spine.selectedRelease?.nodeIds).toEqual(['work:task-import-1c4eedx'])
  })

  it('uses release records recovered from the workspace import draft as the visible scope', () => {
    const spine = buildProjectOrientationSpine({
      projectId: 'narrative-harness',
      now: '2026-07-03T12:00:00.000Z',
      workspaceImportDraft: {
        releases: [{
          id: 'headless-mvp',
          label: 'Headless MVP',
          source: 'release_plan',
        }],
        tasks: [
          {
            id: 'task-context-packet',
            title: 'Build the context packet runner',
            description: 'Current headless MVP work.',
            domain: 'harness',
            scope: 'current',
            releaseIds: ['headless-mvp'],
            refs: ['import:docs/harness/implementation-roadmap.md'],
          },
          {
            id: 'task-authoring-ui',
            title: 'Build the authoring UI shell',
            description: 'Later UI work.',
            domain: 'ui',
            scope: 'later',
            refs: ['import:docs/harness/implementation-roadmap.md'],
          },
        ],
        source: {
          kind: 'inferred',
          refs: ['workspace-import:draft'],
          confidence: 'high',
          freshness: 'fresh',
          inferred: true,
          refreshedAt: '2026-07-03T12:00:00.000Z',
        },
      },
    })

    expect(spine.selectedRelease).toMatchObject({
      id: 'headless-mvp',
      label: 'Headless MVP',
      source: 'release_plan',
      nodeIds: ['work:workspace-import:task-context-packet'],
      deferredNodeIds: [],
    })
    expect(spine.scope?.deferredNodeIds).toEqual(['work:workspace-import:task-authoring-ui'])
    expect(spine.summary.selectedReleaseLabel).toBe('Headless MVP')
    expect(spine.summary.selectedScopeLabel).toBe('Headless MVP')
    expect(spine.summary.includedWorkCount).toBe(1)
    expect(spine.summary.deferredWorkCount).toBe(1)
    expect(spine.nodes['work:workspace-import:task-context-packet']?.maturity).not.toBe('deferred')
    expect(spine.nodes['work:workspace-import:task-authoring-ui']?.maturity).toBe('deferred')
  })

  it('does not mutate served task objects when workspace import release hints are stale', () => {
    const tasks = [{
      id: 'task-context-packet',
      title: 'Build the context packet runner',
      description: 'Current headless MVP work.',
      domain: 'harness',
      status: 'import_draft',
      priority: 'high',
      releaseIds: ['stage-1-fixture-and-evaluation-harness'],
      references: ['docs/harness/implementation-roadmap.md'],
    }]

    buildProjectOrientationSpine({
      projectId: 'narrative-harness',
      now: '2026-07-03T12:00:00.000Z',
      tasks,
      workspaceImportDraft: {
        releases: [{
          id: 'stage-0-spec-baseline',
          label: 'Stage 0: Spec Baseline',
          source: 'release_plan',
        }],
        tasks: [{
          id: 'task-context-packet',
          title: 'Build the context packet runner',
          description: 'Stale saved import release hint.',
          domain: 'harness',
          scope: 'current',
          releaseIds: ['stage-0-spec-baseline'],
          refs: ['import:docs/harness/implementation-roadmap.md'],
        }],
        source: {
          kind: 'inferred',
          refs: ['workspace-import:approved'],
          confidence: 'high',
          freshness: 'fresh',
          inferred: false,
          refreshedAt: '2026-07-03T12:00:00.000Z',
        },
      },
    })

    expect(tasks[0]?.releaseIds).toEqual(['stage-1-fixture-and-evaluation-harness'])
    expect(tasks[0]?.references).toEqual(['docs/harness/implementation-roadmap.md'])
  })

  it('uses action-shaped labels for question-shaped task nodes', () => {
    const spine = buildProjectOrientationSpine({
      projectId: 'narrative-harness',
      now: '2026-06-16T12:00:00.000Z',
      tasks: [
        {
          id: 'task-smoke-test',
          title: 'What commands should I run to smoke test this project without changing files?',
          description: 'What commands should I run to smoke test this project without changing files?',
          domain: 'meta',
          projectPath: '/tmp/narrative-harness',
          status: 'ready',
          priority: 'normal',
        },
      ],
    })

    expect(spine.nodes['work:task-smoke-test']?.title).toBe('Define safe smoke-test commands')
    expect(spine.roots[0]?.title).toBe('Define safe smoke-test commands')
  })

  it('preserves internal work visibility on orientation nodes', () => {
    const spine = buildProjectOrientationSpine({
      projectId: 'demo',
      now: '2026-06-17T12:00:00.000Z',
      tasks: [
        {
          id: 'feature-a',
          title: 'Feature A',
          description: 'Visible feature.',
          domain: 'app',
          status: 'ready',
          hierarchy: { childIds: ['feature-a-proof'] },
          workVisibility: { kind: 'primary', countInProjectTotals: true },
        },
        {
          id: 'feature-a-proof',
          title: 'Internal proof',
          description: 'Internal proof step.',
          domain: 'app',
          status: 'ready',
          workKind: 'verification',
          hierarchy: { parentId: 'feature-a' },
          workVisibility: { kind: 'internal_step', countInProjectTotals: false },
        },
      ],
    })

    expect(spine.nodes['work:feature-a']?.visibility).toEqual({ kind: 'primary', countInProjectTotals: true })
    expect(spine.nodes['work:feature-a-proof']?.visibility).toEqual({ kind: 'internal_step', countInProjectTotals: false })
    expect(spine.proofContracts.map(contract => contract.title)).toEqual(['Feature A'])
  })

  it('does not turn completed scoped work back into proof-needed gaps', () => {
    const spine = buildProjectOrientationSpine({
      projectId: 'narrative-harness',
      now: '2026-06-17T12:00:00.000Z',
      charter: {
        goal: 'The first MVP is headless: script-only proofs of all systems.',
        targetAudience: 'Authors and agent builders.',
        source: 'owner_approved',
      },
      tasks: [
        {
          id: 'coherence-reviewer-mvp',
          title: 'Build first coherence reviewer MVP',
          description: 'Review story continuity.',
          domain: 'coherence',
          status: 'done',
          spec: 'Run the reviewer from a script and inspect output.',
          proofPaths: [{ kind: 'command', command: 'pnpm test -- coherence' }],
          gateResults: [{
            gateId: 'pnpm test -- coherence',
            command: 'pnpm test -- coherence',
            type: 'hard',
            passed: true,
          }],
        },
        {
          id: 'duplicate-split-child',
          title: 'Duplicate split child',
          description: 'Duplicate child task explicitly removed from scope.',
          domain: 'coherence',
          status: 'shelved',
          spec: 'This duplicate is not viable.',
        },
      ],
    })

    expect(spine.nodes['work:coherence-reviewer-mvp']?.maturity).toBe('proven')
    expect(spine.gaps.map(gap => gap.kind)).not.toContain('proof_needed')
    expect(spine.summary.progress.done).toBe(1)
    expect(spine.summary.headline).toBe('Current task scope is complete.')
  })

  it('lets shared start-readiness block the orientation headline before idle copy', () => {
    const spine = buildProjectOrientationSpine({
      projectId: 'narrative-harness',
      now: '2026-06-17T12:00:00.000Z',
      tasks: [{
        id: 'task-workspace-import',
        title: 'Review existing project work',
        description: 'Reserved importer task.',
        domain: '_workspace_import',
        status: 'done',
      }],
      startReadiness: {
        canStart: false,
        code: 'workspace_import_refresh_needed',
        message: 'Guildhall saved an under-scoped import.',
        actionHref: '/workspace-import',
      },
    })

    expect(spine.summary.headline).toBe('Current task scope needs import refresh.')
    expect(spine.summary.topBlocker).toBe('Workspace import is under-scoped.')
    expect(spine.summary.nextAction).toBe('Refresh the workspace import.')
  })

  it('turns source-conflict start readiness into a specific orientation next action', () => {
    const message = 'Stage 1 has source conflicts to review before it can be treated as complete.'
    const spine = buildProjectOrientationSpine({
      projectId: 'narrative-harness',
      now: '2026-07-06T12:00:00.000Z',
      selectedReleaseId: 'stage-1-headless-drafting-and-evaluation-mvp',
      releases: [{
        id: 'stage-1-headless-drafting-and-evaluation-mvp',
        label: 'Stage 1 Headless Drafting And Evaluation MVP',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        nodeIds: ['work:model-proof'],
        deferredNodeIds: [],
      }],
      tasks: [{
        id: 'model-proof',
        title: 'Select and prove a DeepInfra drafting model for broad-genre chapter writing.',
        description: 'Current scope work.',
        domain: 'harness',
        status: 'done',
        releaseIds: ['stage-1-headless-drafting-and-evaluation-mvp'],
      }],
      startReadiness: {
        canStart: false,
        code: 'scope_source_conflict',
        message,
        actionHref: '/map',
        focusKind: 'source_conflict',
      },
    })

    expect(spine.summary.headline).toBe('Stage 1 Headless Drafting And Evaluation MVP has source conflicts to review.')
    expect(spine.summary.topBlocker).toBe(message)
    expect(spine.summary.nextAction).toBe('Review source conflicts on the Project Map.')
  })

  it('keeps workspace-import refresh as the top blocker when ordinary task blockers also exist', () => {
    const spine = buildProjectOrientationSpine({
      projectId: 'looma-knit',
      now: '2026-07-06T10:30:00.000Z',
      scope: {
        id: 'stage-1-finish-knit-primitive-replacement-wave',
        label: 'Stage 1 Finish Knit Primitive Replacement Wave',
        kind: 'release',
        source: 'inferred',
        nodeIds: ['work:block-menu', 'work:link-editing'],
        deferredNodeIds: [],
      },
      tasks: [
        { id: 'block-menu', title: 'Block menu / block side menu', status: 'blocked', blockReason: 'Needs proof.' },
        { id: 'link-editing', title: 'Link editing UI', status: 'ready' },
      ],
      startReadiness: {
        canStart: false,
        code: 'workspace_import_refresh_needed',
        message: 'Saved import is under-scoped for the current project docs.',
        actionHref: '/workspace-import',
      },
      releaseReadiness: {
        verdict: 'blocked',
        blockers: [{ id: 'block-menu', label: 'Block menu / block side menu: blocked.' }],
      },
    })

    expect(spine.summary.headline).toBe('Stage 1 Finish Knit Primitive Replacement Wave needs import refresh.')
    expect(spine.summary.topBlocker).toBe('Workspace import is under-scoped.')
    expect(spine.summary.nextAction).toBe('Refresh the workspace import.')
  })

  it('extracts a headless script-only execution boundary and proof contracts for scoped work', () => {
    const spine = buildProjectOrientationSpine({
      projectId: 'narrative-harness',
      now: '2026-06-16T12:00:00.000Z',
      charter: {
        goal: 'Build a fiction-first story intelligence harness.',
        targetAudience: 'Authors and agent builders.',
        currentReleaseTarget: 'First MVP is headless: script-only proofs of all systems.',
        successDefinition: 'Every scoped feature has command-line smoke proof.',
        nonGoals: ['Production UI'],
        source: 'owner_approved',
      },
      sourceRefs: ['project-brief.md'],
      tasks: [{
        id: 'coherence-reviewer-mvp',
        title: 'Build first coherence reviewer MVP',
        description: 'Review story continuity.',
        domain: 'coherence',
        status: 'ready',
        spec: 'Run the reviewer from a script and inspect output.',
      }],
    })

    expect(spine.executionBoundary).toMatchObject({
      label: 'Headless proof',
      mode: 'headless',
      proofStyle: 'script_only',
      source: {
        refs: ['project-brief.md'],
        confidence: 'high',
        inferred: false,
      },
    })
    expect(spine.gaps.map(gap => gap.kind)).not.toContain('missing_execution_boundary')
    expect(spine.selectedRelease).toBeNull()
    expect(spine.proofContracts[0]).toMatchObject({
      nodeId: 'work:coherence-reviewer-mvp',
      title: 'Build first coherence reviewer MVP',
      required: ['Script or command proof for Build first coherence reviewer MVP.'],
    })
    expect(spine.sourceTrail).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: 'Charter',
        value: 'Owner Approved',
        tone: 'ok',
      }),
      expect.objectContaining({
        label: 'Source docs',
        value: '1 source document',
        detail: 'project-brief.md',
        tone: 'ok',
      }),
      expect.objectContaining({
        label: 'Proof mode',
        value: 'Headless proof',
        tone: 'accent',
      }),
    ]))
  })

  it('does not undercount scoped task records when work is sourced from docs', () => {
    const spine = buildProjectOrientationSpine({
      projectId: 'narrative-harness',
      now: '2026-07-12T21:30:00.000Z',
      selectedReleaseId: 'stage-1',
      releases: [{
        id: 'stage-1',
        label: 'Stage 1',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        nodeIds: ['work:task-with-task-ref', 'work:task-with-doc-ref'],
        deferredNodeIds: [],
        proofStyle: 'script_only',
      }],
      tasks: [
        {
          id: 'task-with-task-ref',
          title: 'Task-backed proof',
          description: 'Has no document source.',
          domain: 'harness',
          status: 'done',
          priority: 'normal',
          releaseIds: ['stage-1'],
        },
        {
          id: 'task-with-doc-ref',
          title: 'Document-backed proof',
          description: 'Has document source.',
          domain: 'harness',
          status: 'done',
          priority: 'normal',
          releaseIds: ['stage-1'],
          references: ['docs/harness/implementation-roadmap.md'],
        },
      ] as any[],
    })

    expect(spine.summary.includedWorkCount).toBe(2)
    expect(spine.sourceTrail).toContainEqual(expect.objectContaining({
      label: 'Work records',
      value: '2 task records',
      detail: '1 source document attached to mapped work.',
      tone: 'ok',
    }))
  })

  it('does not treat planned proof paths as already proven evidence', () => {
    const spine = buildProjectOrientationSpine({
      projectId: 'narrative-harness',
      now: '2026-06-18T12:00:00.000Z',
      tasks: [{
        id: 'task-imported',
        title: 'Imported harness task',
        description: 'Pending shaping and proof.',
        domain: 'harness',
        status: 'import_draft',
        proofPaths: [{
          kind: 'command',
          command: 'pnpm test -- imported-harness-task',
          expectedEvidence: ['Harness task proof should pass.'],
        }],
      }],
    })

    expect(spine.nodes['work:task-imported']?.proof).toMatchObject({
      state: 'needed',
      missing: ['Planned proof exists, but no proof evidence has been attached yet.'],
    })
    expect(spine.proofContracts[0]?.state).toBe('needed')
  })

  it('keeps historical approvals out of current project proof after recovery reopens a task', () => {
    const spine = buildProjectOrientationSpine({
      projectId: 'narrative-harness',
      now: '2026-07-13T23:00:00.000Z',
      scope: {
        id: 'stage-1-headless-mvp',
        label: 'Stage 1 Headless MVP',
        kind: 'release',
        source: 'release_plan',
        nodeIds: ['work:model-proof'],
        deferredNodeIds: [],
      },
      tasks: [{
        id: 'model-proof',
        title: 'Prove the drafting model',
        status: 'review',
        proofRecovery: {
          reopenedAt: '2026-07-13T22:00:00.000Z',
          reason: 'Live provider proof is missing.',
        },
        gateResults: [{
          gateId: 'pnpm-build',
          type: 'hard',
          passed: true,
          checkedAt: '2026-07-13T20:00:00.000Z',
        }],
        reviewVerdicts: [{
          verdict: 'approve',
          reviewerPath: 'llm',
          recordedAt: '2026-07-07T20:00:00.000Z',
        }],
        proofPaths: [{
          kind: 'command',
          command: 'pnpm prove:deepinfra-drafting-model',
          status: 'planned',
        }],
      }],
    })

    expect(spine.summary.progress).toMatchObject({ done: 0, proven: 0 })
    expect(spine.proofContracts[0]).toMatchObject({ state: 'needed' })
    expect(spine.proofContracts[0]?.verified).toEqual(['Gate passed: pnpm-build'])
    expect(spine.proofContracts[0]?.verified).not.toContain('Review approved: llm')
  })

  it('does not treat imported proof-path status as completed proof evidence', () => {
    const spine = buildProjectOrientationSpine({
      projectId: 'narrative-harness',
      now: '2026-07-06T12:00:00.000Z',
      scope: {
        id: 'stage-1-headless-mvp',
        label: 'Stage 1 Headless MVP',
        kind: 'release',
        source: 'release_plan',
        nodeIds: ['work:world-state-review'],
        deferredNodeIds: [],
      },
      tasks: [{
        id: 'world-state-review',
        title: 'Prove world-state continuity review over elapsed-time object and property changes.',
        status: 'done',
        acceptanceCriteria: [
          { id: 'state-transition', description: 'The reviewer catches object property changes caused by elapsed time.', met: true },
        ],
        proofPaths: [{
          kind: 'review',
          source: 'inferred',
          status: 'verified',
          expectedEvidence: [
            'The reviewer catches object property changes caused by elapsed time.',
            'The proof explains whether wet hair would dry in the story climate.',
          ],
        }],
      }],
    })

    expect(spine.summary.progress).toMatchObject({
      done: 0,
      proven: 0,
    })
    expect(spine.nodes['work:world-state-review']?.maturity).toBe('proof_needed')
    expect(spine.proofContracts[0]).toMatchObject({
      title: 'Prove world-state continuity review over elapsed-time object and property changes.',
      state: 'needed',
      missing: ['Required proof evidence has not been attached yet.'],
    })
  })

  it('surfaces latest reviewer proof text when it satisfies imported proof evidence', () => {
    const spine = buildProjectOrientationSpine({
      projectId: 'narrative-harness',
      now: '2026-07-06T12:00:00.000Z',
      scope: {
        id: 'stage-1-headless-mvp',
        label: 'Stage 1 Headless MVP',
        kind: 'release',
        source: 'release_plan',
        nodeIds: ['work:world-state-review'],
        deferredNodeIds: [],
      },
      tasks: [{
        id: 'world-state-review',
        title: 'Prove world-state continuity review over elapsed-time object and property changes.',
        status: 'done',
        acceptanceCriteria: [
          { id: 'state-transition', description: 'The reviewer catches object property changes caused by elapsed time.', met: true },
        ],
        latestReviewerSummary: [
          '**Verdict:** Approved',
          'The proof runs `node scripts/prove-world-state-continuity.mjs`.',
          'The reviewer catches object property changes caused by elapsed time.',
          'The proof explains whether wet hair would dry in the story climate.',
        ].join('\n'),
        proofPaths: [{
          kind: 'review',
          source: 'inferred',
          status: 'verified',
          expectedEvidence: [
            'The reviewer catches object property changes caused by elapsed time.',
            'The proof explains whether wet hair would dry in the story climate.',
          ],
        }],
      }],
    })

    expect(spine.summary.progress).toMatchObject({
      done: 1,
      proven: 1,
    })
    expect(spine.proofContracts[0]).toMatchObject({
      state: 'proven',
      missing: [],
    })
    expect(spine.proofContracts[0]?.verified[0]).toBe('Reviewer proof: The proof runs `node scripts/prove-world-state-continuity.mjs`.')
  })

  it('counts ready work with missing proof as ready but not proven', () => {
    const spine = buildProjectOrientationSpine({
      projectId: 'narrative-harness',
      now: '2026-06-18T12:00:00.000Z',
      scope: {
        id: 'headless-proof',
        label: 'Headless proof',
        kind: 'release',
        source: 'release_plan',
        nodeIds: ['work:ready-proof-task'],
        deferredNodeIds: [],
      },
      tasks: [{
        id: 'ready-proof-task',
        title: 'Run fixture proof',
        description: 'Ready to run, but proof has not been recorded.',
        domain: 'harness',
        status: 'ready',
        productBrief: { approvedAt: '2026-06-18T12:00:00.000Z' },
        spec: 'Run the fixture proof.',
        acceptanceCriteria: [{ id: 'proof', description: 'Proof is recorded.', verifiedBy: 'review', met: false }],
        proofPaths: [{
          kind: 'command',
          command: 'pnpm test -- fixture-proof',
          expectedEvidence: ['Fixture proof should pass.'],
        }],
      }],
    })

    expect(spine.nodes['work:ready-proof-task']?.maturity).toBe('proof_needed')
    expect(spine.summary.progress.ready).toBe(1)
    expect(spine.summary.progress.proven).toBe(0)
  })

  it('counts selected-scope work directly so summary progress matches visible rows', () => {
    const spine = buildProjectOrientationSpine({
      projectId: 'narrative-harness',
      now: '2026-07-04T10:00:00.000Z',
      scope: {
        id: 'stage-1-fixture-and-evaluation-harness',
        label: 'Stage 1: Fixture And Evaluation Harness',
        kind: 'release',
        source: 'release_plan',
        nodeIds: [
          'work:fixture-schema',
          'work:first-fixture',
          'work:runner-proof',
          'work:evaluation-output',
          'work:debug-report',
          'work:schema-narrowing',
          'work:schema-roadmap',
        ],
        deferredNodeIds: [
          'work:later-reviewer',
          'work:later-ui',
        ],
      },
      tasks: [
        { id: 'fixture-schema', title: 'Define fixture schemas.', status: 'done', spec: 'Done.', acceptanceCriteria: [{ met: true }] },
        { id: 'first-fixture', title: 'Add first fiction fixture.', status: 'done', spec: 'Done.', acceptanceCriteria: [{ met: true }] },
        { id: 'runner-proof', title: 'Implement no-UI runner.', status: 'blocked', spec: 'Blocked.', acceptanceCriteria: [{ met: false }] },
        { id: 'evaluation-output', title: 'Add deterministic evaluation output.', status: 'ready', spec: 'Ready.', acceptanceCriteria: [{ met: false }] },
        { id: 'debug-report', title: 'Generate debug report.', status: 'ready', spec: 'Ready.', acceptanceCriteria: [{ met: false }] },
        { id: 'schema-narrowing', title: 'Use first run to narrow schema.', status: 'ready', spec: 'Ready.', acceptanceCriteria: [{ met: false }] },
        { id: 'schema-roadmap', title: 'Implement fixture-and-expected-record schemas.', status: 'done', spec: 'Done.', acceptanceCriteria: [{ met: true }] },
        { id: 'later-reviewer', title: 'Later reviewer lane.', status: 'shelved', spec: 'Later.', acceptanceCriteria: [{ met: false }] },
        { id: 'later-ui', title: 'Later UI lane.', status: 'shelved', spec: 'Later.', acceptanceCriteria: [{ met: false }] },
      ],
    })

    expect(spine.summary.includedWorkCount).toBe(7)
    expect(spine.summary.deferredWorkCount).toBe(2)
    expect(spine.summary.progress).toMatchObject({
      total: 9,
      done: 3,
      blocked: 1,
      ready: 3,
      deferred: 2,
    })
  })

  it('summarizes active selected-scope work as in progress instead of still being shaped', () => {
    const spine = buildProjectOrientationSpine({
      projectId: 'narrative-harness',
      now: '2026-07-04T10:20:00.000Z',
      scope: {
        id: 'stage-1-fixture-and-evaluation-harness',
        label: 'Stage 1: Fixture And Evaluation Harness',
        kind: 'release',
        source: 'release_plan',
        nodeIds: [
          'work:fixture-schema',
          'work:first-fixture',
          'work:runner-proof',
          'work:evaluation-output',
          'work:debug-report',
          'work:schema-narrowing',
        ],
        deferredNodeIds: ['work:later-ui'],
      },
      tasks: [
        { id: 'fixture-schema', title: 'Define fixture schemas.', status: 'done', spec: 'Done.', acceptanceCriteria: [{ met: true }] },
        { id: 'first-fixture', title: 'Add first fiction fixture.', status: 'done', spec: 'Done.', acceptanceCriteria: [{ met: true }] },
        { id: 'runner-proof', title: 'Implement no-UI runner.', status: 'done', spec: 'Done.', acceptanceCriteria: [{ met: true }] },
        { id: 'evaluation-output', title: 'Add deterministic evaluation output.', status: 'in_progress', spec: 'Running.', acceptanceCriteria: [{ met: false }] },
        { id: 'debug-report', title: 'Generate debug report.', status: 'ready', spec: 'Ready.', acceptanceCriteria: [{ met: false }] },
        { id: 'schema-narrowing', title: 'Use first run to narrow schema.', status: 'ready', spec: 'Ready.', acceptanceCriteria: [{ met: false }] },
        { id: 'later-ui', title: 'Later UI lane.', status: 'shelved', spec: 'Later.', acceptanceCriteria: [{ met: false }] },
      ],
    })

    expect(spine.summary.headline).toBe('Stage 1: Fixture And Evaluation Harness is in progress.')
    expect(spine.summary.nextAction).toBe('Open the running work.')
    expect(spine.summary.progress).toMatchObject({
      done: 3,
      active: 1,
      ready: 2,
      deferred: 1,
    })
  })

  it('counts review and gate-check work as active selected-scope progress', () => {
    const spine = buildProjectOrientationSpine({
      projectId: 'narrative-harness',
      now: '2026-07-04T10:38:00.000Z',
      scope: {
        id: 'stage-1-fixture-and-evaluation-harness',
        label: 'Stage 1: Fixture And Evaluation Harness',
        kind: 'release',
        source: 'release_plan',
        nodeIds: ['work:review-task', 'work:gate-task', 'work:ready-task'],
        deferredNodeIds: [],
      },
      tasks: [
        { id: 'review-task', title: 'Review evaluation output.', status: 'review', spec: 'Review.', acceptanceCriteria: [{ met: false }] },
        { id: 'gate-task', title: 'Gate evaluation output.', status: 'gate_check', spec: 'Gate.', acceptanceCriteria: [{ met: false }] },
        { id: 'ready-task', title: 'Generate debug report.', status: 'ready', spec: 'Ready.', acceptanceCriteria: [{ met: false }] },
      ],
    })

    expect(spine.summary.headline).toBe('Stage 1: Fixture And Evaluation Harness is in progress.')
    expect(spine.summary.progress).toMatchObject({
      active: 2,
      ready: 1,
    })
  })

  it('describes completed scoped work as complete instead of blocked', () => {
    const spine = buildProjectOrientationSpine({
      projectId: 'narrative-harness',
      now: '2026-07-04T11:52:00.000Z',
      scope: {
        id: 'stage-1-fixture-and-evaluation-harness',
        label: 'Stage 1: Fixture And Evaluation Harness',
        kind: 'release',
        source: 'release_plan',
        nodeIds: ['work:fixture-schema', 'work:runner-proof'],
        deferredNodeIds: [],
      },
      tasks: [
        { id: 'fixture-schema', title: 'Define fixture schemas.', status: 'done', spec: 'Done.', acceptanceCriteria: [{ met: true }] },
        { id: 'runner-proof', title: 'Implement no-UI runner.', status: 'done', spec: 'Done.', acceptanceCriteria: [{ met: true }] },
      ],
      startReadiness: {
        canStart: false,
        code: 'all_terminal',
        message: 'Stage 1: Fixture And Evaluation Harness is complete.',
      },
    })

    expect(spine.summary.headline).toBe('Stage 1: Fixture And Evaluation Harness is complete.')
    expect(spine.summary.topBlocker).toBeNull()
    expect(spine.summary.nextAction).toBe('Review completed scope.')
  })

  it('does not call terminal scoped work complete when explicit proof is still missing', () => {
    const spine = buildProjectOrientationSpine({
      projectId: 'narrative-harness',
      now: '2026-07-04T11:52:00.000Z',
      scope: {
        id: 'stage-1-fixture-and-evaluation-harness',
        label: 'Stage 1: Fixture And Evaluation Harness',
        kind: 'release',
        source: 'release_plan',
        nodeIds: ['work:fixture-schema', 'work:runner-proof'],
        deferredNodeIds: [],
      },
      tasks: [
        {
          id: 'fixture-schema',
          title: 'Define fixture schemas.',
          status: 'done',
          spec: 'Done.',
          acceptanceCriteria: [{ met: true }],
          proofPaths: ['src/verify-fixture-schema.ts'],
        },
        {
          id: 'runner-proof',
          title: 'Implement no-UI runner.',
          status: 'done',
          spec: 'Done.',
          acceptanceCriteria: [{ met: true }],
          proofPaths: ['src/verify-runner.ts'],
        },
      ],
      startReadiness: {
        canStart: false,
        code: 'all_terminal',
        message: 'Stage 1: Fixture And Evaluation Harness is complete.',
      },
    })

    expect(spine.summary.headline).toBe('Stage 1: Fixture And Evaluation Harness is waiting on proof.')
    expect(spine.summary.topBlocker).toBe('Proof evidence has not been attached yet.')
    expect(spine.summary.nextAction).toBe('Attach proof for the completed scoped work.')
    expect(spine.summary.progress.done).toBe(0)
    expect(spine.nodes['work:fixture-schema']?.maturity).toBe('proof_needed')
    expect(spine.nodes['work:runner-proof']?.maturity).toBe('proof_needed')
    expect(spine.gaps.filter(gap => gap.kind === 'proof_needed')).toHaveLength(2)
    expect(spine.activePins.map(pin => pin.kind)).toEqual(['proof', 'proof'])
  })

  it('keeps completed imported work proven when durable completion evidence exists', () => {
    const spine = buildProjectOrientationSpine({
      projectId: 'narrative-harness',
      now: '2026-07-05T10:00:00.000Z',
      scope: {
        id: 'stage-1-fixture-and-evaluation-harness',
        label: 'Stage 1: Fixture And Evaluation Harness',
        kind: 'release',
        source: 'release_plan',
        nodeIds: ['work:fixture-schema', 'work:runner-proof'],
        deferredNodeIds: [],
      },
      tasks: [
        {
          id: 'fixture-schema',
          title: 'Define fixture schemas.',
          status: 'done',
          spec: 'Done.',
          proofPaths: ['src/verify-fixture-schema.ts'],
          doneSummaryBundle: {
            taskId: 'fixture-schema',
            status: 'done',
            completedAt: '2026-07-05T09:00:00.000Z',
            summary: {
              journey: 'Defined the fixture schema.',
              decision: 'Use JSON fixtures.',
              evidence: 'pnpm test -- fixture-schema passed.',
              learningCandidates: [],
              openResidue: 'None.',
            },
            retention: {
              transcriptPrimaryArtifact: false,
              compactedFullTranscript: true,
              fullEvidenceAvailable: true,
            },
            evidenceRefs: [],
            createdAt: '2026-07-05T09:00:00.000Z',
            createdBy: 'test',
          },
        },
        {
          id: 'runner-proof',
          title: 'Implement no-UI runner.',
          status: 'done',
          spec: 'Done.',
          gateResults: [{ gateId: 'runner-smoke', status: 'pass' }],
          reviewVerdicts: [{ reviewerPath: 'deterministic', verdict: 'approve' }],
        },
      ],
      startReadiness: {
        canStart: false,
        code: 'all_terminal',
        message: 'Stage 1: Fixture And Evaluation Harness is complete.',
      },
    })

    expect(spine.summary.headline).toBe('Stage 1: Fixture And Evaluation Harness is complete.')
    expect(spine.nodes['work:fixture-schema']?.maturity).toBe('proven')
    expect(spine.nodes['work:runner-proof']?.maturity).toBe('proven')
    expect(spine.summary.progress.proven).toBe(2)
    expect(spine.summary.progress.done).toBe(2)
    expect(spine.nodes['work:fixture-schema']?.proof.verified[0]).toContain('pnpm test -- fixture-schema passed')
    expect(spine.nodes['work:runner-proof']?.proof.verified).toEqual(expect.arrayContaining([
      'Gate passed: runner-smoke',
      'Review approved: deterministic',
    ]))
    expect(spine.gaps.filter(gap => gap.kind === 'proof_needed')).toHaveLength(0)
    expect(spine.activePins.map(pin => pin.kind)).toEqual([])
  })

  it('does not count a split parent as completed while its child work is unfinished', () => {
    const spine = buildProjectOrientationSpine({
      projectId: 'narrative-harness',
      now: '2026-07-04T12:30:00.000Z',
      scope: {
        id: 'stage-1-fixture-and-evaluation-harness',
        label: 'Stage 1: Fixture And Evaluation Harness',
        kind: 'release',
        source: 'release_plan',
        nodeIds: ['work:fixture-schema-parent'],
        deferredNodeIds: [],
      },
      tasks: [
        {
          id: 'fixture-schema-parent',
          title: 'Define fixture, expected-record, prototype-run, and evaluation schemas.',
          status: 'done',
          spec: 'Split into contract, fixture, and proof tasks.',
          proofPaths: [{ expectedEvidence: ['schema tests pass'] }],
          hierarchy: { childIds: ['fixture-contract-child'] },
        },
        {
          id: 'fixture-contract-child',
          title: 'Define the cited contracts for fixture schemas.',
          status: 'exploring',
          spec: 'Draft the concrete schema contracts.',
          hierarchy: { parentId: 'fixture-schema-parent' },
          workVisibility: { kind: 'internal_step', countInProjectTotals: false },
        },
      ],
    })

    expect(spine.nodes['work:fixture-schema-parent']?.maturity).toBe('sliced')
    expect(spine.summary.progress.total).toBe(1)
    expect(spine.summary.progress.sliced).toBe(1)
    expect(spine.summary.progress.done).toBe(0)
    expect(spine.summary.headline).toBe('Stage 1: Fixture And Evaluation Harness is being shaped.')
    expect(spine.gaps.filter(gap => gap.kind === 'proof_needed')).toHaveLength(0)
  })

  it('keeps a completed scope complete when import refresh is only follow-up work', () => {
    const spine = buildProjectOrientationSpine({
      projectId: 'narrative-harness',
      now: '2026-07-04T11:52:00.000Z',
      scope: {
        id: 'stage-1-fixture-and-evaluation-harness',
        label: 'Stage 1: Fixture And Evaluation Harness',
        kind: 'release',
        source: 'release_plan',
        nodeIds: ['work:fixture-schema', 'work:runner-proof'],
        deferredNodeIds: ['work:later-ui'],
      },
      tasks: [
        { id: 'fixture-schema', title: 'Define fixture schemas.', status: 'done', spec: 'Done.', acceptanceCriteria: [{ met: true }] },
        { id: 'runner-proof', title: 'Implement no-UI runner.', status: 'done', spec: 'Done.', acceptanceCriteria: [{ met: true }] },
        { id: 'later-ui', title: 'Later UI lane.', status: 'shelved', spec: 'Later.', acceptanceCriteria: [{ met: false }] },
      ],
      startReadiness: {
        canStart: false,
        code: 'workspace_import_refresh_needed',
        message: 'Workspace import is under-scoped for newly documented work.',
        actionHref: '/workspace-import',
      },
    })

    expect(spine.summary.headline).toBe('Stage 1: Fixture And Evaluation Harness is complete.')
    expect(spine.summary.topBlocker).toBeNull()
    expect(spine.summary.nextAction).toBe('Refresh import for newly documented work.')
  })

  it('does not let import-refresh follow-up hide release proof blockers', () => {
    const spine = buildProjectOrientationSpine({
      projectId: 'narrative-harness',
      now: '2026-07-05T10:00:00.000Z',
      scope: {
        id: 'stage-1-fixture-and-evaluation-harness',
        label: 'Stage 1: Fixture And Evaluation Harness',
        kind: 'release',
        source: 'release_plan',
        nodeIds: ['work:fixture-schema', 'work:runner-proof'],
        deferredNodeIds: ['work:later-ui'],
      },
      tasks: [
        { id: 'fixture-schema', title: 'Define fixture schemas.', status: 'done', spec: 'Done.', acceptanceCriteria: [{ met: true }] },
        { id: 'runner-proof', title: 'Implement no-UI runner.', status: 'done', spec: 'Done.', acceptanceCriteria: [{ met: true }] },
        { id: 'later-ui', title: 'Later UI lane.', status: 'shelved', spec: 'Later.', acceptanceCriteria: [{ met: false }] },
      ],
      startReadiness: {
        canStart: false,
        code: 'workspace_import_refresh_needed',
        message: 'Workspace import is under-scoped for newly documented work.',
        actionHref: '/workspace-import',
      },
      releaseReadiness: {
        verdict: 'blocked',
        blockers: [
          { id: 'fixture-schema', label: 'Define fixture schemas needs proof evidence before the release is complete.' },
          { id: 'runner-proof', label: 'Implement no-UI runner needs proof evidence before the release is complete.' },
        ],
      },
      scopeProjection: {
        selectedScope: {
          id: 'stage-1-fixture-and-evaluation-harness',
          label: 'Stage 1: Fixture And Evaluation Harness',
          kind: 'release',
          source: 'release_plan',
          nodeIds: ['work:fixture-schema', 'work:runner-proof'],
          deferredNodeIds: ['work:later-ui'],
        },
        rows: [],
        counts: {
          included: 2,
          deferred: 1,
          ready: 0,
          paused: 0,
          active: 0,
          done: 2,
          ownerBlocked: 0,
          proofBlocked: 2,
          humanBlocking: 0,
        },
        start: {
          canStart: false,
          code: 'workspace_import_refresh_needed',
          label: 'Start blocked',
          message: 'Workspace import is under-scoped for newly documented work.',
          actionHref: '/workspace-import',
        },
        release: {
          state: 'done',
          blockers: [],
        },
      },
    })

    expect(spine.summary.headline).toBe('Stage 1: Fixture And Evaluation Harness is blocked on proof.')
    expect(spine.summary.topBlocker).toBe('Define fixture schemas needs proof evidence before the release is complete.')
    expect(spine.summary.nextAction).toBe('Review blocker: Define fixture schemas needs proof evidence before the release is complete.')
    expect(spine.release.blockers.map(blocker => blocker.id)).toEqual(['fixture-schema', 'runner-proof'])
  })

  it('uses live workspace-import draft scope to surface current and deferred work before approval', () => {
    const spine = buildProjectOrientationSpine({
      projectId: 'narrative-harness',
      now: '2026-06-18T12:00:00.000Z',
      tasks: [{
        id: 'task-workspace-import',
        title: 'Import project notes and plans',
        description: 'Reserved importer task.',
        domain: '_workspace_import',
        status: 'import_draft',
      }],
      startReadiness: {
        canStart: false,
        code: 'import_drafts_waiting',
        message: 'Review imported drafts before starting.',
        actionHref: '/workspace-import',
      },
      workspaceImportDraft: {
        source: {
          kind: 'inferred',
          refs: ['workspace-import:draft'],
          confidence: 'medium',
          freshness: 'fresh',
          inferred: true,
          refreshedAt: '2026-06-18T12:00:00.000Z',
        },
        releases: [
          {
            id: 'stage-1-fixture-and-evaluation-harness',
            label: 'Stage 1: Fixture And Evaluation Harness',
            source: 'release_plan',
            state: 'active',
          },
          {
            id: 'stage-2-mastra-agent-prototype',
            label: 'Stage 2: Mastra Agent Prototype',
            source: 'release_plan',
            state: 'planned',
          },
        ],
        tasks: [
          {
            id: 'task-current',
            title: 'Define fixture schemas',
            description: 'Current MVP harness work.',
            domain: 'harness',
            scope: 'current',
            releaseIds: ['stage-1-fixture-and-evaluation-harness'],
            refs: ['import:docs/harness/implementation-roadmap.md'],
          },
          {
            id: 'task-later',
            title: 'Implement dialogue reviewer lane',
            description: 'Deferred Stage 2 reviewer work.',
            domain: 'coherence',
            scope: 'later',
            releaseIds: ['stage-2-mastra-agent-prototype'],
            refs: ['import:docs/harness/remaining-spec-decomposition-inventory.md'],
          },
        ],
        contexts: [
          {
            id: 'capability-core-loop',
            title: 'Author drafts or imports chapters.',
            description: 'Architecture core loop step.',
            domain: 'harness',
            refs: ['import:docs/harness/architecture-notes.md'],
            role: 'capability',
            scopeHint: 'later',
            releaseIds: ['stage-2-mastra-agent-prototype'],
          },
        ],
      },
    })

    expect(spine.scope).toMatchObject({
      nodeIds: ['work:workspace-import:task-current'],
      deferredNodeIds: ['work:workspace-import:task-later', 'capability:capability-core-loop'],
    })
    expect(spine.releases).toEqual([
      expect.objectContaining({
        id: 'stage-1-fixture-and-evaluation-harness',
        label: 'Stage 1: Fixture And Evaluation Harness',
        nodeIds: ['work:workspace-import:task-current'],
        deferredNodeIds: [],
      }),
      expect.objectContaining({
        id: 'stage-2-mastra-agent-prototype',
        label: 'Stage 2: Mastra Agent Prototype',
        nodeIds: [],
        deferredNodeIds: ['work:workspace-import:task-later', 'capability:capability-core-loop'],
      }),
    ])
    expect(spine.summary.includedWorkCount).toBe(1)
    expect(spine.summary.deferredWorkCount).toBe(1)
    expect(spine.nodes['work:workspace-import:task-current']?.source).toMatchObject({
      kind: 'inferred',
      refs: ['import:docs/harness/implementation-roadmap.md'],
      inferred: true,
    })
    expect(spine.nodes['work:workspace-import:task-later']?.maturity).toBe('deferred')
    expect(spine.nodes['capability:capability-core-loop']).toMatchObject({
      title: 'Author drafts or imports chapters.',
      maturity: 'deferred',
      visibility: { kind: 'supporting', countInProjectTotals: false },
      source: { refs: ['import:docs/harness/architecture-notes.md'], inferred: true },
    })
    expect(spine.roots.map(root => root.title)).toEqual([
      'Architecture Notes',
      'Implementation Roadmap',
      'Spec Decomposition Inventory',
    ])
  })

  it('lets fresher documented import scope override stale inferred release membership', () => {
    const spine = buildProjectOrientationSpine({
      projectId: 'narrative-harness',
      now: '2026-07-06T19:10:00.000Z',
      selectedReleaseId: 'near-term-proof-scope',
      releases: [{
        id: 'near-term-proof-scope',
        label: 'Near-term proof scope',
        kind: 'release',
        state: 'active',
        source: 'inferred',
        nodeIds: ['work:legacy-proof'],
        deferredNodeIds: [],
      }],
      tasks: [{
        id: 'legacy-proof',
        title: 'Recover source-backed contract surface',
        status: 'done',
        releaseIds: ['near-term-proof-scope'],
      }],
      workspaceImportDraft: {
        source: {
          kind: 'inferred',
          refs: ['workspace-import:draft'],
          confidence: 'medium',
          freshness: 'fresh',
          inferred: true,
          refreshedAt: '2026-07-06T19:10:00.000Z',
        },
        releases: [
          {
            id: 'stage-1-headless-drafting-and-evaluation-mvp',
            label: 'Stage 1: Headless Drafting And Evaluation MVP',
            source: 'release_plan',
            state: 'active',
          },
        ],
        tasks: [
          {
            id: 'stage-1-model-proof',
            title: 'Select and prove a DeepInfra drafting model for broad-genre chapter writing.',
            description: 'Current documented Stage 1 work.',
            domain: 'harness',
            scope: 'current',
            releaseIds: ['stage-1-headless-drafting-and-evaluation-mvp'],
            refs: ['import:docs/harness/implementation-roadmap.md'],
          },
        ],
      },
    })

    expect(spine.summary.selectedScopeLabel).toBe('Stage 1: Headless Drafting And Evaluation MVP')
    expect(spine.selectedRelease).toMatchObject({
      id: 'stage-1-headless-drafting-and-evaluation-mvp',
      label: 'Stage 1: Headless Drafting And Evaluation MVP',
    })
    expect(spine.scope).toMatchObject({
      id: 'stage-1-headless-drafting-and-evaluation-mvp',
      nodeIds: ['work:workspace-import:stage-1-model-proof'],
    })
  })

  it('shows only the selected release as the active run boundary', () => {
    const spine = buildProjectOrientationSpine({
      projectId: 'looma-knit',
      now: '2026-07-04T12:00:00.000Z',
      selectedReleaseId: 'stage-1-v1-release-hardening',
      releases: [
        {
          id: 'stage-1-v1-release-hardening',
          label: 'Stage 1: V1 Release Hardening',
          kind: 'release',
          state: 'active',
          source: 'release_plan',
          nodeIds: ['work:task-v1'],
          deferredNodeIds: [],
        },
        {
          id: 'stage-1-finish-knit-primitive-replacement-wave',
          label: 'Stage 1: Finish Knit Primitive Replacement Wave',
          kind: 'release',
          state: 'active',
          source: 'release_plan',
          nodeIds: ['work:task-other'],
          deferredNodeIds: [],
        },
      ],
      tasks: [
        {
          id: 'task-v1',
          title: 'V1 release hardening',
          domain: 'knit',
          status: 'ready',
          releaseIds: ['stage-1-v1-release-hardening'],
          spec: 'V1 hardening spec.',
          acceptanceCriteria: [{ id: 'AC-1', description: 'V1 proof exists.', verifiedBy: 'test', met: false }],
        },
        {
          id: 'task-other',
          title: 'Primitive replacement wave',
          domain: 'looma',
          status: 'ready',
          releaseIds: ['stage-1-finish-knit-primitive-replacement-wave'],
          spec: 'Primitive wave spec.',
          acceptanceCriteria: [{ id: 'AC-1', description: 'Primitive proof exists.', verifiedBy: 'test', met: false }],
        },
      ],
    })

    expect(spine.selectedRelease?.id).toBe('stage-1-v1-release-hardening')
    expect(spine.releases.map(release => [release.id, release.state])).toEqual([
      ['stage-1-v1-release-hardening', 'active'],
    ])
  })

  it('keeps selected release identity separate from completed release readiness', () => {
    const tasks = [
      {
        id: 'task-stage-one',
        title: 'Prove headless stage one',
        domain: 'harness',
        status: 'done',
        priority: 'normal',
        releaseIds: ['stage-1-headless-mvp'],
        completionHandoff: {
          summary: 'Stage one is proven.',
          whatChanged: ['Added CLI proof.'],
          whatCanBeDoneNow: ['Review completed scope.'],
          howToProveIt: ['pnpm test passed.'],
          verified: ['pnpm test passed.'],
          notVerified: [],
          remainingRisks: [],
        },
      },
    ] as any[]
    const releases = [{
      id: 'stage-1-headless-mvp',
      label: 'Stage 1 Headless MVP',
      kind: 'release',
      state: 'active',
      source: 'release_plan',
      nodeIds: ['work:task-stage-one'],
      deferredNodeIds: [],
      proofStyle: 'script_only',
    }] as any[]
    const scopeProjection = buildProjectScopeProjection({
      version: 1,
      lastUpdated: '2026-07-06T23:45:00.000Z',
      selectedReleaseId: 'stage-1-headless-mvp',
      releases,
      tasks,
    })

    const spine = buildProjectOrientationSpine({
      projectId: 'narrative-harness',
      now: '2026-07-06T23:45:00.000Z',
      selectedReleaseId: 'stage-1-headless-mvp',
      releases,
      tasks,
      scopeProjection,
    })

    expect(scopeProjection.release.state).toBe('ready')
    expect(spine.selectedRelease).toMatchObject({
      id: 'stage-1-headless-mvp',
      state: 'ready',
    })
    expect(spine.releases.map(release => [release.id, release.state])).toEqual([
      ['stage-1-headless-mvp', 'ready'],
    ])
    expect(spine.release.state).toBe('ready')
    expect(spine.summary.headline).toBe('Stage 1 Headless MVP is complete.')
  })

  it('carries repository follow-up blockers into the project spine release state', () => {
    const tasks = [
      {
        id: 'task-stage-one',
        title: 'Prove headless stage one',
        domain: 'harness',
        status: 'done',
        priority: 'normal',
        releaseIds: ['stage-1-headless-mvp'],
        completionHandoff: {
          summary: 'Stage one is proven.',
          whatChanged: ['Added CLI proof.'],
          whatCanBeDoneNow: ['Review completed scope.'],
          howToProveIt: ['pnpm test passed.'],
          verified: ['pnpm test passed.'],
          notVerified: [],
          remainingRisks: [],
        },
      },
    ] as any[]
    const releases = [{
      id: 'stage-1-headless-mvp',
      label: 'Stage 1 Headless MVP',
      kind: 'release',
      state: 'active',
      source: 'release_plan',
      nodeIds: ['work:task-stage-one'],
      deferredNodeIds: [],
      proofStyle: 'script_only',
    }] as any[]
    const scopeProjection = buildProjectScopeProjection({
      version: 1,
      lastUpdated: '2026-07-07T11:36:00.000Z',
      selectedReleaseId: 'stage-1-headless-mvp',
      releases,
      tasks,
    })
    const message = 'Stage 1 Headless MVP has no runnable task work left, but 1 repository follow-up is still needed, starting with: main has 1 local commit not pushed to origin/main.'

    const spine = buildProjectOrientationSpine({
      projectId: 'narrative-harness',
      now: '2026-07-07T11:36:00.000Z',
      selectedReleaseId: 'stage-1-headless-mvp',
      releases,
      tasks,
      scopeProjection,
      startReadiness: {
        canStart: false,
        code: 'repository_followup_required',
        message,
        actionHref: '/release',
      },
    })

    expect(scopeProjection.release.state).toBe('ready')
    expect(spine.summary.topBlocker).toBe(message)
    expect(spine.release).toMatchObject({
      state: 'blocked',
      blockers: [
        {
          id: 'start-readiness:repository_followup_required',
          label: message,
        },
      ],
    })
    expect(spine.release.blockers[0]).not.toHaveProperty('owningNodeId')
    expect(spine.selectedRelease).toMatchObject({
      id: 'stage-1-headless-mvp',
      state: 'blocked',
    })
    expect(spine.releases.map(release => [release.id, release.state])).toEqual([
      ['stage-1-headless-mvp', 'blocked'],
    ])
  })

  it('keeps start-readiness closure blockers when task release blockers also exist', () => {
    const tasks = [
      {
        id: 'task-unit-tests',
        title: 'Unit tests: use-collections',
        domain: 'quality',
        status: 'proposed',
        priority: 'normal',
        releaseIds: ['v1-hardening'],
      },
    ] as any[]
    const releases = [{
      id: 'v1-hardening',
      label: 'V1 Release Hardening',
      kind: 'release',
      state: 'active',
      source: 'release_plan',
      nodeIds: ['work:task-unit-tests'],
      deferredNodeIds: [],
    }] as any[]
    const scopeProjection = buildProjectScopeProjection({
      version: 1,
      lastUpdated: '2026-07-07T12:05:00.000Z',
      selectedReleaseId: 'v1-hardening',
      releases,
      tasks,
    })
    const repositoryMessage = 'V1 Release Hardening has no runnable task work left, but repository follow-up is still needed: Knit main has 28 changed files.'

    const spine = buildProjectOrientationSpine({
      projectId: 'looma-knit',
      now: '2026-07-07T12:05:00.000Z',
      selectedReleaseId: 'v1-hardening',
      releases,
      tasks,
      scopeProjection,
      startReadiness: {
        canStart: false,
        code: 'repository_followup_required',
        message: repositoryMessage,
        actionHref: '/release',
      },
    })

    expect(scopeProjection.release.blockers).toEqual([
      expect.objectContaining({
        id: 'task-unit-tests',
        label: expect.stringContaining('needs a clearer brief'),
      }),
    ])
    expect(spine.release.blockers).toEqual([
      expect.objectContaining({
        id: 'task-unit-tests',
        label: expect.stringContaining('needs a clearer brief'),
        owningNodeId: 'work:task-unit-tests',
      }),
      expect.objectContaining({
        id: 'start-readiness:repository_followup_required',
        label: repositoryMessage,
      }),
    ])
    expect(spine.release.blockers[1]).not.toHaveProperty('owningNodeId')
  })

  it('does not duplicate start-readiness repository blockers already reported by release readiness', () => {
    const repositoryLabel = 'main has 3 local commits not pushed to origin/main.'
    const startMessage = `Stage 1 Headless Drafting And Evaluation MVP has no runnable task work left, but repository follow-up is still needed: ${repositoryLabel}`

    const spine = buildProjectOrientationSpine({
      projectId: 'narrative-harness',
      now: '2026-07-07T12:30:00.000Z',
      selectedReleaseId: 'stage-1',
      releases: [{
        id: 'stage-1',
        label: 'Stage 1 Headless Drafting And Evaluation MVP',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        nodeIds: [],
        deferredNodeIds: [],
      }],
      tasks: [],
      releaseReadiness: {
        verdict: 'blocked',
        blockers: [{
          id: 'repository-followup:repo:0',
          label: repositoryLabel,
        }],
      },
      startReadiness: {
        canStart: false,
        code: 'repository_followup_required',
        message: startMessage,
        actionHref: '/release',
      },
    })

    expect(spine.release.blockers).toEqual([
      expect.objectContaining({
        id: 'repository-followup:repo:0',
        label: repositoryLabel,
      }),
    ])
  })

  it('preserves detected release buckets for later tasks that already exist in saved task state', () => {
    const spine = buildProjectOrientationSpine({
      projectId: 'narrative-harness',
      now: '2026-06-18T12:00:00.000Z',
      tasks: [
        {
          id: 'saved-stage-two',
          title: 'Mastra workflow for the prototype iteration loop',
          description: 'Saved task record imported before release buckets existed.',
          domain: 'agent-workflow',
          status: 'shelved',
        },
      ],
      workspaceImportDraft: {
        source: {
          kind: 'inferred',
          refs: ['workspace-import:draft'],
          confidence: 'medium',
          freshness: 'fresh',
          inferred: true,
          refreshedAt: '2026-06-18T12:00:00.000Z',
        },
        releases: [
          {
            id: 'stage-1-fixture-and-evaluation-harness',
            label: 'Stage 1: Fixture And Evaluation Harness',
            source: 'release_plan',
            state: 'active',
          },
          {
            id: 'stage-2-mastra-agent-prototype',
            label: 'Stage 2: Mastra Agent Prototype',
            source: 'release_plan',
            state: 'planned',
          },
        ],
        tasks: [
          {
            id: 'draft-stage-one',
            title: 'Define fixture schemas',
            description: 'Current harness work.',
            domain: 'harness',
            scope: 'current',
            releaseIds: ['stage-1-fixture-and-evaluation-harness'],
            refs: ['import:docs/harness/implementation-roadmap.md'],
          },
          {
            id: 'draft-stage-two',
            title: 'Mastra workflow for the prototype iteration loop',
            description: 'Detected deferred Stage 2 work.',
            domain: 'agent-workflow',
            scope: 'later',
            releaseIds: ['stage-2-mastra-agent-prototype'],
            refs: ['import:docs/harness/implementation-roadmap.md'],
          },
        ],
        contexts: [],
      },
    })

    expect(spine.nodes['work:saved-stage-two']?.maturity).toBe('deferred')
    expect(spine.nodes['work:saved-stage-two']?.source.refs).toEqual(['import:docs/harness/implementation-roadmap.md'])
    expect(spine.releases).toEqual([
      expect.objectContaining({
        id: 'stage-1-fixture-and-evaluation-harness',
        nodeIds: ['work:workspace-import:draft-stage-one'],
        deferredNodeIds: [],
      }),
      expect.objectContaining({
        id: 'stage-2-mastra-agent-prototype',
        nodeIds: [],
        deferredNodeIds: ['work:saved-stage-two'],
      }),
    ])
  })

  it('does not copy unassigned later imports into every release bucket', () => {
    const spine = buildProjectOrientationSpine({
      projectId: 'looma-knit',
      now: '2026-07-07T01:20:00.000Z',
      workspaceImportDraft: {
        source: {
          kind: 'inferred',
          refs: ['workspace-import:draft'],
          confidence: 'medium',
          freshness: 'fresh',
          inferred: true,
          refreshedAt: '2026-07-07T01:20:00.000Z',
        },
        releases: [
          {
            id: 'stage-1-v1-release-hardening',
            label: 'Stage 1: V1 Release Hardening',
            source: 'release_plan',
            state: 'active',
          },
          {
            id: 'stage-2-editor-integration',
            label: 'Stage 2: Editor Integration',
            source: 'release_plan',
            state: 'planned',
          },
        ],
        tasks: [
          {
            id: 'task-current-proof',
            title: 'Prove the V1 release hardening path.',
            description: 'Current work for Stage 1.',
            domain: 'knit',
            scope: 'current',
            releaseIds: ['stage-1-v1-release-hardening'],
          },
          {
            id: 'task-unassigned-later',
            title: 'Investigate a later editor polish idea.',
            description: 'A deferred import that has not been assigned to a specific release.',
            domain: 'knit',
            scope: 'later',
          },
          {
            id: 'task-stage-two-later',
            title: 'Build the Stage 2 editor integration slice.',
            description: 'Deferred work explicitly assigned to Stage 2.',
            domain: 'knit',
            scope: 'later',
            releaseIds: ['stage-2-editor-integration'],
          },
        ],
      },
    })

    const stageOne = spine.releases.find(release => release.id === 'stage-1-v1-release-hardening')
    const stageTwo = spine.releases.find(release => release.id === 'stage-2-editor-integration')
    expect(spine.scope?.deferredNodeIds).toContain('work:workspace-import:task-unassigned-later')
    expect(stageOne?.deferredNodeIds).not.toContain('work:workspace-import:task-unassigned-later')
    expect(stageTwo?.deferredNodeIds).not.toContain('work:workspace-import:task-unassigned-later')
    expect(stageTwo?.deferredNodeIds).toContain('work:workspace-import:task-stage-two-later')
  })

  it('does not let workspace-import preview nodes inflate a persisted release', () => {
    const scopeProjection = buildProjectScopeProjection({
      version: 1,
      lastUpdated: '2026-07-07T01:25:00.000Z',
      selectedReleaseId: 'stage-1-v1-release-hardening',
      releases: [{
        id: 'stage-1-v1-release-hardening',
        label: 'Stage 1: V1 Release Hardening',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        nodeIds: ['work:task-current'],
        deferredNodeIds: [],
        proofStyle: 'unspecified',
      }],
      tasks: [{
        id: 'task-current',
        title: 'Materialized release task',
        description: 'Already approved imported work.',
        domain: 'knit',
        status: 'import_draft',
        releaseIds: ['stage-1-v1-release-hardening'],
      }],
    })
    const spine = buildProjectOrientationSpine({
      projectId: 'looma-knit',
      now: '2026-07-07T01:25:00.000Z',
      selectedReleaseId: 'stage-1-v1-release-hardening',
      releases: [{
        id: 'stage-1-v1-release-hardening',
        label: 'Stage 1: V1 Release Hardening',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        nodeIds: ['work:task-current'],
        deferredNodeIds: [],
        proofStyle: 'unspecified',
      }],
      tasks: [{
        id: 'task-current',
        title: 'Materialized release task',
        description: 'Already approved imported work.',
        domain: 'knit',
        status: 'import_draft',
        releaseIds: ['stage-1-v1-release-hardening'],
      }],
      scopeProjection,
      workspaceImportDraft: {
        source: {
          kind: 'inferred',
          refs: ['workspace-import:draft'],
          confidence: 'medium',
          freshness: 'fresh',
          inferred: true,
          refreshedAt: '2026-07-07T01:25:00.000Z',
        },
        releases: [{
          id: 'stage-1-v1-release-hardening',
          label: 'Stage 1: V1 Release Hardening',
          source: 'release_plan',
          state: 'active',
        }],
        tasks: [
          {
            id: 'task-current',
            title: 'Materialized release task',
            description: 'Already approved imported work.',
            domain: 'knit',
            scope: 'current',
            releaseIds: ['stage-1-v1-release-hardening'],
          },
          {
            id: 'draft-only-current',
            title: 'Draft-only current work should not inflate the persisted release.',
            description: 'Still only a workspace-import preview.',
            domain: 'knit',
            scope: 'current',
            releaseIds: ['stage-1-v1-release-hardening'],
          },
          {
            id: 'draft-only-later',
            title: 'Draft-only later work should not inflate the projected scope.',
            description: 'Still only a workspace-import preview.',
            domain: 'knit',
            scope: 'later',
          },
        ],
      },
    })

    expect(spine.selectedRelease?.nodeIds).toEqual(['work:task-current'])
    expect(spine.scope?.nodeIds).toEqual(['work:task-current'])
    expect(spine.scope?.deferredNodeIds).toEqual([])
    expect(spine.releases.find(release => release.id === 'stage-1-v1-release-hardening')?.nodeIds).toEqual(['work:task-current'])
  })

  it('keeps selected scope node ids aligned with deferred projection rows', () => {
    const tasks = [
      {
        id: 'task-current',
        title: 'Materialized release task',
        description: 'Current Stage 1 work.',
        domain: 'knit',
        status: 'import_draft',
        releaseIds: ['stage-1-v1-release-hardening'],
      },
      {
        id: 'task-old-blocker',
        title: 'Floating toolbar',
        description: 'Deferred backlog work that is not in the selected release.',
        domain: 'knit',
        status: 'blocked',
        releaseIds: [],
        hierarchy: { childIds: ['task-demoted-child'] },
      },
      {
        id: 'task-demoted-child',
        title: 'Deferred child split',
        description: 'A child split that raw release expansion included but projection marks deferred.',
        domain: 'knit',
        status: 'done',
        releaseIds: [],
        hierarchy: { parentId: 'task-old-blocker', relation: 'decomposes' },
      },
    ] as any[]
    const releases = [{
      id: 'stage-1-v1-release-hardening',
      label: 'Stage 1: V1 Release Hardening',
      kind: 'release',
      state: 'active',
      source: 'release_plan',
      nodeIds: ['work:task-current', 'work:task-demoted-child'],
      deferredNodeIds: [],
      proofStyle: 'unspecified',
    }] as any[]
    const scopeProjection = {
      selectedScope: {
        id: 'stage-1-v1-release-hardening',
        label: 'Stage 1: V1 Release Hardening',
        kind: 'release',
        source: 'release_plan',
        nodeIds: ['work:task-current', 'work:task-demoted-child'],
        deferredNodeIds: ['work:task-old-blocker'],
      },
      rows: [
        {
          taskId: 'task-current',
          title: 'Materialized release task',
          scope: 'included',
          eligibilityReason: 'included',
          hierarchyRole: 'root',
          status: 'import_draft',
          handoffState: 'not_shaped',
          blocksStart: true,
          blocksRelease: true,
          humanBlocking: true,
          sourceRefs: [],
        },
        {
          taskId: 'task-old-blocker',
          title: 'Floating toolbar',
          scope: 'deferred',
          eligibilityReason: 'deferred',
          hierarchyRole: 'parent',
          status: 'blocked',
          handoffState: 'deferred',
          blocksStart: false,
          blocksRelease: false,
          humanBlocking: false,
          sourceRefs: [],
        },
        {
          taskId: 'task-demoted-child',
          title: 'Deferred child split',
          parentTaskId: 'task-old-blocker',
          scope: 'deferred',
          eligibilityReason: 'deferred',
          hierarchyRole: 'child',
          status: 'done',
          handoffState: 'deferred',
          blocksStart: false,
          blocksRelease: false,
          humanBlocking: false,
          sourceRefs: [],
        },
      ],
      counts: {
        included: 1,
        deferred: 1,
        ready: 0,
        paused: 0,
        active: 0,
        done: 0,
        ownerBlocked: 1,
        proofBlocked: 0,
        humanBlocking: 1,
      },
      start: {
        canStart: false,
        code: 'imported_scope_shaping',
        label: 'Review',
        focusTaskId: 'task-current',
        focusTaskTitle: 'Materialized release task',
        focusKind: 'brief_cleanup',
        count: 1,
        message: 'Current work needs shaping.',
        actionHref: '/task/task-current',
      },
      release: {
        state: 'shaping',
        blockers: [],
      },
    } as any
    const spine = buildProjectOrientationSpine({
      projectId: 'looma-knit',
      now: '2026-07-07T01:35:00.000Z',
      selectedReleaseId: 'stage-1-v1-release-hardening',
      releases,
      tasks,
      scopeProjection,
      startReadiness: scopeProjection.start,
      releaseReadiness: {
        verdict: 'blocked',
        blockers: [{
          id: 'task-current',
          label: 'Materialized release task: needs a clearer brief before unattended work can run.',
        }],
      },
    })

    expect(spine.scopeRows.filter(row => row.scope === 'deferred').map(row => row.nodeId)).toEqual(['work:task-demoted-child'])
    expect(spine.scope?.nodeIds).toEqual(['work:task-current'])
    expect(spine.scope?.deferredNodeIds).toEqual(['work:task-demoted-child'])
    expect(spine.summary.deferredWorkCount).toBe(1)
    expect(spine.summary.progress.deferred).toBe(1)
    expect(spine.summary.pinnedNow).toEqual(['Materialized release task'])
    expect(spine.summary.topBlocker).toBe('Materialized release task: needs a clearer brief before unattended work can run.')
    expect(spine.activePins[0]).toMatchObject({
      nodeId: 'work:task-current',
      label: 'Materialized release task',
      kind: 'owner_input',
      href: '/task/task-current',
    })
  })

  it('merges saved release labels with detected orientation buckets for the same release id', () => {
    const spine = buildProjectOrientationSpine({
      projectId: 'narrative-harness',
      now: '2026-06-18T12:00:00.000Z',
      releases: [
        {
          id: 'stage-2-mastra-agent-prototype',
          label: 'Stage 2: Mastra Agent Prototype',
          source: 'release_plan',
          state: 'planned',
          nodeIds: [],
          deferredNodeIds: [],
        },
      ],
      workspaceImportDraft: {
        source: {
          kind: 'inferred',
          refs: ['workspace-import:draft'],
          confidence: 'medium',
          freshness: 'fresh',
          inferred: true,
          refreshedAt: '2026-06-18T12:00:00.000Z',
        },
        releases: [
          {
            id: 'stage-2-mastra-agent-prototype',
            label: 'Stage 2: Mastra Agent Prototype',
            source: 'release_plan',
            state: 'planned',
          },
        ],
        tasks: [
          {
            id: 'draft-stage-two',
            title: 'Mastra workflow for the prototype iteration loop',
            description: 'Detected deferred Stage 2 work.',
            domain: 'agent-workflow',
            scope: 'later',
            releaseIds: ['stage-2-mastra-agent-prototype'],
            refs: ['import:docs/harness/implementation-roadmap.md'],
          },
        ],
        contexts: [],
      },
    })

    expect(spine.releases).toEqual([
      expect.objectContaining({
        id: 'stage-2-mastra-agent-prototype',
        label: 'Stage 2: Mastra Agent Prototype',
        nodeIds: [],
        deferredNodeIds: ['work:workspace-import:draft-stage-two'],
      }),
    ])
  })

  it('does not present legacy future release containers as active when they only contain later work', () => {
    const spine = buildProjectOrientationSpine({
      projectId: 'narrative-harness',
      now: '2026-06-18T12:00:00.000Z',
      selectedReleaseId: 'stage-1-fixture-and-evaluation-harness',
      releases: [
        {
          id: 'stage-1-fixture-and-evaluation-harness',
          label: 'Stage 1: Fixture And Evaluation Harness',
          source: 'release_plan',
          state: 'active',
          nodeIds: ['work:stage-one-task'],
          deferredNodeIds: [],
        },
        {
          id: 'stage-2-mastra-agent-prototype',
          label: 'Stage 2: Mastra Agent Prototype',
          source: 'release_plan',
          state: 'active',
          nodeIds: [],
          deferredNodeIds: ['work:stage-two-task'],
        },
      ],
      tasks: [
        {
          id: 'stage-one-task',
          title: 'Define fixture schemas',
          description: 'Current harness work.',
          domain: 'harness',
          status: 'ready',
          releaseIds: ['stage-1-fixture-and-evaluation-harness'],
          spec: 'Spec.',
          acceptanceCriteria: [{ met: false }],
        },
        {
          id: 'stage-two-task',
          title: 'Mastra workflow for the prototype iteration loop',
          description: 'Future workflow work.',
          domain: 'agent-workflow',
          status: 'shelved',
          releaseIds: ['stage-2-mastra-agent-prototype'],
          spec: 'Spec.',
          acceptanceCriteria: [{ met: false }],
        },
      ],
    })

    expect(spine.selectedRelease?.state).toBe('active')
    expect(spine.releases.find(release => release.id === 'stage-2-mastra-agent-prototype')?.state).toBe('planned')
  })

  it('drops archived and orphan preview task ids from owner-visible release scope', () => {
    const spine = buildProjectOrientationSpine({
      projectId: 'narrative-harness',
      now: '2026-06-18T12:00:00.000Z',
      selectedReleaseId: 'stage-1-fixture-and-evaluation-harness',
      releases: [
        {
          id: 'stage-1-fixture-and-evaluation-harness',
          label: 'Stage 1: Fixture And Evaluation Harness',
          source: 'release_plan',
          state: 'active',
          nodeIds: [
            'work:task-current',
            'work:task-archived',
            'work:workspace-import:detected-task-stage-two',
          ],
          deferredNodeIds: [],
        },
      ],
      tasks: [
        {
          id: 'task-current',
          title: 'Define fixture schemas',
          description: 'Current harness work.',
          domain: 'harness',
          status: 'ready',
          releaseIds: ['stage-1-fixture-and-evaluation-harness'],
          spec: 'Spec.',
          acceptanceCriteria: [{ met: false }],
        },
        {
          id: 'task-archived',
          title: 'Archived stale import echo',
          description: 'Old duplicate import work.',
          domain: 'harness',
          status: 'archived',
          releaseIds: ['stage-1-fixture-and-evaluation-harness'],
          spec: 'Spec.',
          acceptanceCriteria: [{ met: true }],
        },
      ],
    })

    expect(spine.selectedRelease?.nodeIds).toEqual([
      'work:task-current',
    ])
    expect(spine.scope?.nodeIds).toEqual([
      'work:task-current',
    ])
    expect(spine.nodes['work:task-archived']).toBeUndefined()
    expect(spine.nodes['work:workspace-import:detected-task-stage-two']).toBeUndefined()
  })

  it('groups imported Narrative Harness structure by document family instead of collapsing it into coarse domains', () => {
    const spine = buildProjectOrientationSpine({
      projectId: 'narrative-harness',
      now: '2026-06-18T12:00:00.000Z',
      workspaceImportDraft: {
        source: {
          kind: 'inferred',
          refs: ['workspace-import:draft'],
          confidence: 'medium',
          freshness: 'fresh',
          inferred: true,
          refreshedAt: '2026-06-18T12:00:00.000Z',
        },
        tasks: [
          {
            id: 'task-roadmap',
            title: 'Define fixture schemas',
            description: 'Current roadmap work.',
            domain: 'harness',
            scope: 'current',
            refs: [
              'import:docs/harness/implementation-roadmap.md',
              'import:docs/specs/schema-contract-roadmap.md',
            ],
          },
          {
            id: 'task-later-spec',
            title: 'Implement dialogue reviewer lane',
            description: 'Deferred decomposition inventory work.',
            domain: 'coherence',
            scope: 'later',
            refs: [
              'import:docs/harness/remaining-spec-decomposition-inventory.md',
              'import:docs/specs/dialogue-and-character-voice.md',
            ],
          },
        ],
        contexts: [
          {
            id: 'capability-architecture',
            title: 'Author drafts or imports chapters.',
            description: 'Architecture core loop step.',
            refs: ['import:docs/harness/architecture-notes.md'],
            role: 'capability',
          },
          {
            id: 'capability-spec',
            title: 'Spec: Story Intelligence Overview',
            description: 'Story intelligence framing.',
            refs: ['import:docs/specs/story-intelligence-overview.md'],
            role: 'capability',
          },
        ],
      },
    })

    expect(spine.roots.map(root => root.title)).toEqual([
      'Architecture Notes',
      'Implementation Roadmap',
      'Spec Decomposition Inventory',
      'Story Intelligence Specs',
    ])
    expect(spine.nodes['work:workspace-import:task-roadmap']?.parentId).toBe('area:implementation-roadmap')
    expect(spine.nodes['work:workspace-import:task-later-spec']?.parentId).toBe('area:spec-decomposition-inventory')
    expect(spine.nodes['capability:capability-spec']?.parentId).toBe('area:story-intelligence-specs')
  })

  it('groups flat imported work into inferred capability lanes by domain', () => {
    const spine = buildProjectOrientationSpine({
      projectId: 'narrative-harness',
      now: '2026-06-15T12:00:00.000Z',
      tasks: [
        {
          id: 'coherence-reviewer-mvp',
          title: 'Coherence reviewer MVP',
          description: 'Review story continuity.',
          domain: 'coherence',
          status: 'ready',
          spec: 'Reviewer spec.',
        },
        {
          id: 'author-voice-loop',
          title: 'Author voice loop MVP',
          description: 'Keep revision voice aligned.',
          domain: 'coherence',
          status: 'spec_review',
          spec: 'Voice loop spec.',
        },
        {
          id: 'workspace-import',
          title: 'Import existing workspace artifacts',
          description: 'Assemble existing docs and tasks.',
          domain: '_workspace_import',
          status: 'in_progress',
        },
      ],
    })

    expect(spine.roots.map(root => root.title)).toEqual(['Coherence', 'Workspace Import'])
    expect(spine.roots[0]).toMatchObject({
      kind: 'area',
      source: { kind: 'inferred', inferred: true },
      progress: { total: 2, specced: 2 },
    })
    expect(spine.roots[0]?.children.map(child => child.parentId)).toEqual(['area:coherence', 'area:coherence'])
    expect(spine.nodes['work:coherence-reviewer-mvp']?.parentId).toBe('area:coherence')
    expect(spine.sourceHealth.inferred).toBeGreaterThanOrEqual(2)
  })

  it('marks broad ready parents as needs_breakdown and exposes source conflicts', () => {
    const spine = buildProjectOrientationSpine({
      projectId: 'demo',
      now: '2026-06-15T12:00:00.000Z',
      charter: {
        goal: 'Build a demo.',
        targetAudience: null,
        currentReleaseTarget: null,
        successDefinition: null,
        nonGoals: [],
        source: 'owner_approved',
      },
      tasks: [{
        id: 'broad-ready',
        title: 'Broad ready feature',
        description: 'Too broad to run.',
        domain: 'app',
        projectPath: '/tmp/demo',
        status: 'ready',
        priority: 'normal',
        workKind: 'feature_spec',
      }],
      sourceConflicts: [{
        id: 'scope-conflict',
        summary: 'Release plan and task metadata disagree about included work.',
        refs: ['artifact:release-plan', 'task:broad-ready'],
      }],
    })

    expect(spine.roots[0]?.maturity).toBe('needs_breakdown')
    expect(spine.gaps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'source_conflict', refs: ['artifact:release-plan', 'task:broad-ready'] }),
    ]))
  })

  it('reports selected scope rows that lack source document provenance', () => {
    const tasks = [
      {
        id: 'legacy-done',
        title: 'Legacy completed work',
        description: 'Old task record with no source trail.',
        domain: 'harness',
        status: 'done' as const,
        releaseIds: ['stage-1'],
      },
      {
        id: 'doc-backed',
        title: 'Doc-backed current work',
        description: 'Imported task with source trail.',
        domain: 'harness',
        status: 'ready' as const,
        releaseIds: ['stage-1'],
        references: ['docs/harness/implementation-roadmap.md'],
      },
      {
        id: 'legacy-deferred',
        title: 'Legacy deferred work',
        description: 'Old deferred task record with no source trail.',
        domain: 'harness',
        status: 'shelved' as const,
        releaseIds: ['stage-1'],
      },
      {
        id: 'spec-cited',
        title: 'Spec-cited work',
        description: 'Old task record whose spec cites its source document.',
        domain: 'harness',
        status: 'done' as const,
        releaseIds: ['stage-1'],
        spec: 'Use `docs/specs/source-backed-work.md` as the source contract.',
      },
      {
        id: 'evidence-cited',
        title: 'Evidence-cited work',
        description: 'Old task record whose task evidence cites its source document.',
        domain: 'harness',
        status: 'done' as const,
        releaseIds: ['stage-1'],
        notes: [{ content: 'Validated against docs/harness/evidence-backed-work.md.' }],
      },
    ]
    const releases = [{
      id: 'stage-1',
      label: 'Stage 1',
      kind: 'release' as const,
      state: 'active' as const,
      source: 'release_plan' as const,
      nodeIds: ['work:legacy-done', 'work:doc-backed', 'work:spec-cited', 'work:evidence-cited'],
      deferredNodeIds: ['work:legacy-deferred'],
      proofStyle: 'script_only' as const,
    }]
    const scopeProjection = buildProjectScopeProjection({ tasks, releases, selectedReleaseId: 'stage-1' })

    const spine = buildProjectOrientationSpine({
      projectId: 'demo',
      now: '2026-07-13T03:30:00.000Z',
      selectedReleaseId: 'stage-1',
      releases,
      tasks,
      scopeProjection,
    })

    expect(spine.gaps).toContainEqual(expect.objectContaining({
      kind: 'missing_source_provenance',
      refs: ['task:legacy-done', 'task:legacy-deferred'],
    }))
    expect(spine.scopeRows.find(row => row.taskId === 'spec-cited')?.sourceRefs)
      .toContain('docs/specs/source-backed-work.md')
    expect(spine.scopeRows.find(row => row.taskId === 'evidence-cited')?.sourceRefs)
      .toContain('docs/harness/evidence-backed-work.md')
    expect(spine.gaps.length).toBeGreaterThan(spine.sourceHealth.gaps)
    expect(spine.sourceHealth.gaps).toBe(2)
  })

  it('keeps archived imported drafts out of the live spine while preserving map-only capability context', () => {
    const spine = buildProjectOrientationSpine({
      projectId: 'narrative-harness',
      now: '2026-06-18T12:00:00.000Z',
      tasks: [
        {
          id: 'task-import-old-core-loop',
          title: 'Author drafts or imports chapters.',
          description: 'Old imported draft that should disappear from live scope.',
          domain: 'core',
          status: 'archived',
        },
        {
          id: 'task-current',
          title: 'Define fixture schemas',
          description: 'Live current work.',
          domain: 'harness',
          status: 'import_draft',
        },
      ],
      workspaceImportDraft: {
        source: {
          kind: 'inferred',
          refs: ['workspace-import:draft'],
          confidence: 'medium',
          freshness: 'fresh',
          inferred: true,
          refreshedAt: '2026-06-18T12:00:00.000Z',
        },
        tasks: [
          {
            id: 'task-current',
            title: 'Define fixture schemas',
            description: 'Live current work.',
            domain: 'harness',
            scope: 'current',
          },
        ],
        contexts: [
          {
            id: 'capability-core-loop',
            title: 'Author drafts or imports chapters.',
            description: 'Architecture capability row.',
            refs: ['import:docs/harness/architecture-notes.md'],
            role: 'capability',
          },
        ],
      },
    })

    expect(spine.nodes['work:task-import-old-core-loop']).toBeUndefined()
    expect(spine.nodes['capability:capability-core-loop']).toMatchObject({
      title: 'Author drafts or imports chapters.',
    })
    expect(spine.summary.includedWorkCount).toBe(1)
  })

  it('preserves brief inputs as brief-stage supporting nodes instead of generic capability rows', () => {
    const spine = buildProjectOrientationSpine({
      projectId: 'narrative-harness',
      now: '2026-06-18T12:00:00.000Z',
      workspaceImportDraft: {
        source: {
          kind: 'inferred',
          refs: ['workspace-import:approved'],
          confidence: 'high',
          freshness: 'fresh',
          inferred: false,
          refreshedAt: '2026-06-18T12:00:00.000Z',
        },
        tasks: [],
        contexts: [
          {
            id: 'brief-core-loop',
            title: 'Author defines book intent, genre/form expectations, themes, and voice.',
            description: 'Book-brief framing.',
            refs: ['import:docs/harness/architecture-notes.md'],
            role: 'brief_input',
          },
        ],
      },
    })

    expect(spine.nodes['capability:brief-core-loop']).toMatchObject({
      title: 'Author defines book intent, genre/form expectations, themes, and voice.',
      maturity: 'brief',
      visibility: { kind: 'supporting', countInProjectTotals: false },
    })
  })

  it('keeps deferred work scheduler-ineligible unless explicitly targeted or required as a dependency', () => {
    const scope = {
      id: 'mvp',
      label: 'MVP',
      kind: 'release' as const,
      source: 'owner_approved' as const,
      nodeIds: ['work:included'],
      deferredNodeIds: ['work:later', 'work:later-prerequisite'],
    }

    expect(taskEligibleForSelectedScope({ id: 'later', dependsOn: [] }, scope)).toEqual({
      eligible: false,
      reason: 'deferred',
    })
    expect(taskEligibleForSelectedScope({ id: 'later', dependsOn: [] }, scope, { explicitTaskId: 'later' })).toEqual({
      eligible: true,
      reason: 'explicit_target',
    })
    expect(taskEligibleForSelectedScope(
      { id: 'later-prerequisite', dependsOn: [] },
      scope,
      { includedDependencyIds: new Set(['later-prerequisite']) },
    )).toEqual({
      eligible: true,
      reason: 'included_prerequisite',
    })
  })

  it('treats descendants of included tasks as in-scope without inflating explicit scope membership', () => {
    const scope = {
      id: 'mvp',
      label: 'MVP',
      kind: 'release' as const,
      source: 'owner_approved' as const,
      nodeIds: ['work:parent'],
      deferredNodeIds: [],
    }
    const tasksById = new Map([
      ['parent', { id: 'parent', hierarchy: { childIds: ['child'] } }],
      ['child', { id: 'child', hierarchy: { parentId: 'parent' } }],
    ])

    expect(taskEligibleForSelectedScope(
      { id: 'child', dependsOn: [], hierarchy: { parentId: 'parent' } },
      scope,
      { tasksById },
    )).toEqual({
      eligible: true,
      reason: 'included_ancestor',
    })
  })

  it('does not export deferred work as proof contracts for the selected scope', () => {
    const spine = buildProjectOrientationSpine({
      projectId: 'looma-knit',
      scope: {
        id: 'stage-1',
        label: 'Stage 1',
        kind: 'release',
        source: 'release_plan',
        nodeIds: ['work:current-proof'],
        deferredNodeIds: ['work:later-proof'],
      },
      tasks: [
        {
          id: 'current-proof',
          title: 'Current proof lane',
          status: 'done',
          proofPaths: ['tests/current.spec.ts'],
        },
        {
          id: 'later-proof',
          title: 'Later proof lane',
          status: 'shelved',
          proofPaths: ['tests/later.spec.ts'],
        },
      ],
    })

    expect(spine.proofContracts.map(contract => contract.title)).toEqual(['Current proof lane'])
  })

  it('does not describe active task state as running while the project run is stopping', () => {
    const spine = buildProjectOrientationSpine({
      projectId: 'narrative-harness',
      runStatus: 'stopping',
      scope: {
        id: 'stage-1',
        label: 'Stage 1',
        kind: 'release',
        source: 'owner_approved',
        nodeIds: ['work:debug-report'],
        deferredNodeIds: [],
      },
      tasks: [
        {
          id: 'debug-report',
          title: 'Generate a developer-readable debug report for each run.',
          status: 'in_progress',
          spec: 'Write the debug report script.',
          acceptanceCriteria: [{ met: false }],
        },
      ],
    })

    expect(spine.summary.headline).toBe('Stage 1 is stopping with work in progress.')
    expect(spine.summary.nextAction).toBe('Wait for Guildhall to finish stopping, then resume.')
  })

  it('hides stale inferred closed scopes from the owner-facing release roadmap', () => {
    const spine = buildProjectOrientationSpine({
      projectId: 'narrative-harness',
      selectedReleaseId: 'stage-1-headless-mvp',
      releases: [
        {
          id: 'stage-1-headless-mvp',
          label: 'Stage 1 Headless MVP',
          kind: 'release',
          state: 'active',
          source: 'inferred',
          nodeIds: ['work:author-intent'],
          deferredNodeIds: [],
        },
        {
          id: 'stage-1-old-proof-scope',
          label: 'Stage 1 Old Proof Scope',
          kind: 'release',
          state: 'planned',
          source: 'inferred',
          nodeIds: ['work:old-world-proof'],
          deferredNodeIds: [],
        },
        {
          id: 'stage-0-spec-baseline',
          label: 'Stage 0 Spec Baseline',
          kind: 'release',
          state: 'planned',
          source: 'release_plan',
          nodeIds: ['work:explicit-history'],
          deferredNodeIds: [],
        },
        {
          id: 'stage-4-authoring-shell',
          label: 'Stage 4 Authoring Shell',
          kind: 'release',
          state: 'planned',
          source: 'inferred',
          nodeIds: [],
          deferredNodeIds: ['work:future-ui'],
        },
        {
          id: 'stage-5-empty-later-marker',
          label: 'Stage 5 Empty Later Marker',
          kind: 'release',
          state: 'planned',
          source: 'release_plan',
          nodeIds: [],
          deferredNodeIds: [],
        },
      ],
      tasks: [
        {
          id: 'author-intent',
          title: 'Add author-intent inputs.',
          status: 'done',
          releaseIds: ['stage-1-headless-mvp'],
        },
        {
          id: 'old-world-proof',
          title: 'Define old world-state proof lane.',
          status: 'done',
          releaseIds: ['stage-1-old-proof-scope'],
        },
        {
          id: 'explicit-history',
          title: 'Record explicit spec baseline.',
          status: 'done',
          releaseIds: ['stage-0-spec-baseline'],
        },
        {
          id: 'future-ui',
          title: 'Build authoring shell.',
          status: 'shelved',
          releaseIds: ['stage-4-authoring-shell'],
        },
      ],
    })

    expect(spine.releases.map(release => release.id)).toEqual([
      'stage-1-headless-mvp',
      'stage-0-spec-baseline',
      'stage-4-authoring-shell',
    ])
  })
})
