import { describe, expect, it } from 'vitest'
import {
  buildProjectOrientationSpine,
  taskEligibleForSelectedScope,
} from '../project-orientation-spine.js'

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
    expect(spine.summary.headline).toBe('Stage 1 docs/spec/evaluation harness is blocked on proof.')
    expect(spine.summary.progress.specced).toBe(1)
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
    expect(spine.scope).toMatchObject({
      id: 'current-work',
      label: 'Current work',
      kind: 'proposed_feature_set',
      source: 'inferred',
      nodeIds: ['work:feature-a', 'work:feature-b'],
      deferredNodeIds: [],
    })
    expect(spine.summary.selectedReleaseLabel).toBeNull()
    expect(spine.summary.selectedScopeLabel).toBe('Current work')
    expect(spine.gaps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'missing_charter' }),
    ]))
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
    expect(spine.summary.selectedReleaseLabel).toBe('2.0 alpha')
    expect(spine.summary.headline).toBe('2.0 alpha is being shaped.')
    expect(spine.summary.includedWorkCount).toBe(1)
    expect(spine.summary.deferredWorkCount).toBe(1)
    expect(spine.nodes['work:parser-api']?.maturity).not.toBe('deferred')
    expect(spine.nodes['work:theme-editor']?.maturity).toBe('deferred')
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
          proofPaths: [],
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

    expect(spine.nodes['work:coherence-reviewer-mvp']?.maturity).toBe('done')
    expect(spine.gaps.map(gap => gap.kind)).not.toContain('proof_needed')
    expect(spine.summary.progress.done).toBe(1)
    expect(spine.summary.headline).toBe('Current work has no actionable work.')
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

    expect(spine.summary.headline).toBe('Current work needs import refresh.')
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
        tasks: [
          {
            id: 'task-current',
            title: 'Define fixture schemas',
            description: 'Current MVP harness work.',
            domain: 'harness',
            scope: 'current',
            refs: ['import:docs/harness/implementation-roadmap.md'],
          },
          {
            id: 'task-later',
            title: 'Implement dialogue reviewer lane',
            description: 'Deferred Stage 2 reviewer work.',
            domain: 'coherence',
            scope: 'later',
            refs: ['import:docs/harness/remaining-spec-decomposition-inventory.md'],
          },
        ],
      },
    })

    expect(spine.scope).toMatchObject({
      nodeIds: ['work:task-workspace-import', 'work:workspace-import:task-current'],
      deferredNodeIds: ['work:workspace-import:task-later'],
    })
    expect(spine.summary.includedWorkCount).toBe(2)
    expect(spine.summary.deferredWorkCount).toBe(1)
    expect(spine.nodes['work:workspace-import:task-current']?.source).toMatchObject({
      kind: 'inferred',
      refs: ['import:docs/harness/implementation-roadmap.md'],
      inferred: true,
    })
    expect(spine.nodes['work:workspace-import:task-later']?.maturity).toBe('deferred')
    expect(spine.roots.map(root => root.title)).toEqual(['Coherence', 'Harness', 'Workspace Import'])
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
})
