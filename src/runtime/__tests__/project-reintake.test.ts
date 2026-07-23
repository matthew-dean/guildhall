import { describe, expect, it } from 'vitest'

import { planProjectReintake } from '../project-reintake.js'

const now = '2026-05-30T20:00:00.000Z'

function task(overrides: Record<string, unknown>) {
  return {
    id: 'task-1',
    title: 'Task',
    description: '',
    domain: 'core',
    projectPath: '/workspace',
    status: 'import_draft',
    priority: 'normal',
    dependsOn: [],
    outOfScope: [],
    acceptanceCriteria: [],
    notes: [],
    gateResults: [],
    reviewVerdicts: [],
    adjudications: [],
    escalations: [],
    agentIssues: [],
    revisionCount: 0,
    remediationAttempts: 0,
    origination: 'human',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

const loomaAudit = [
  '# Component audit',
  '',
  '| Deliverable | Need | Foundation | Consumer |',
  '| --- | --- | --- | --- |',
  '| Dialog | shipped as `ui-dialog` | native dialog + overlay manager | Knit BaseDialog already uses it |',
  '| AlertDialog | missing P0 gap | builds on Dialog and Button | Knit destructive confirmation flow |',
  '',
].join('\n')

const loomaAuditSource = {
  path: 'looma/docs/component-library-audit.md',
  content: loomaAudit,
  unitIdentities: {
    Dialog: 'looma/component/dialog',
    AlertDialog: 'looma/component/alert-dialog',
  },
  statusHints: { Dialog: 'shipped' as const, AlertDialog: 'missing' as const },
  workShapes: { Dialog: 'ui-component' as const, AlertDialog: 'ui-component' as const },
  targetAreas: { Dialog: 'looma', AlertDialog: 'looma' },
  buildsOn: { AlertDialog: ['Dialog'] },
  consumerSurfaces: { AlertDialog: ['Knit destructive confirmation flow'] },
}

const narrativeRoadmap = [
  '# Implementation Roadmap',
  '',
  '## Stage 1: Fixture And Evaluation Harness',
  '',
  'Deliverables:',
  '',
  '- typed fixture and expected-record contracts',
  '- prototype run record contract',
  '',
  '## Stage 2: Mastra Agent Prototype',
  '',
  'Deliverables:',
  '',
  '- Mastra workflow for the prototype iteration loop',
  '',
  '## Current Next Milestone',
  '',
  'The next milestone is Stage 1: Fixture And Evaluation Harness.',
  '',
  '1. Define fixture, expected-record, prototype-run, and evaluation schemas.',
  '2. Add the first tiny fiction fixture and human-authored expected records.',
].join('\n')

const knitSelectedReleaseSource = [
  '# Knit Release Plan',
  '',
  '## Stage 1: V1 Release Hardening',
  '',
  'Goal: make the current V1 feature set releasable.',
  'Proof style: script-only',
  '',
  '## Current Next Milestone',
  '',
  'The next milestone is Stage 1: V1 Release Hardening.',
].join('\n')

const knitReleasePlanWithoutCurrentMarker = [
  '# Knit Release Plan',
  '',
  'This is the current staged execution plan for Knit.',
  '',
  '## Stage 1: V1 Release Hardening',
  '',
  'Goal: make the current V1 feature set releasable.',
  '',
  '## Stage 2: Looma Primitive Convergence',
  '',
  'Goal: finish the practical replacement wave.',
].join('\n')

const scopedNarrativeRelease = [
  '# Narrative Harness release plan',
  '',
  '## Current Next Milestone',
  '',
  'The next milestone is Stage 1: Headless Drafting And Evaluation MVP.',
  'Proof style: script-only',
  '',
  '## Deliverables',
  '',
  '| Deliverable | Need | Foundation | Consumer |',
  '| --- | --- | --- | --- |',
  '| Character voice and dialogue review | Review character voice and dialogue. | Character specs | Draft review |',
].join('\n')

describe('project re-intake planner', () => {
  it('does not turn visible Markdown evidence into executable work on the catalog-backed route', () => {
    const draft = planProjectReintake({
      now,
      sources: [loomaAuditSource],
      sourceCapabilities: [],
      tasks: [],
    })

    expect(draft.intakeStatus).toBe('needs_structured_capability_intake')
    expect(draft.groups).toEqual([])
  })

  it('creates only intake-scoped planning work from a typed catalog capability', () => {
    const draft = planProjectReintake({
      now,
      sources: [loomaAuditSource],
      sourceCapabilities: [{
        id: 'looma:alert-dialog',
        adapterId: 'component-audit',
        adapterSchemaVersion: 1,
        sourceRevision: 'audit:v1',
        label: 'Alert dialog capability',
        state: 'planned',
        releaseIds: ['release-v1'],
        dependsOnCapabilityIds: [],
        evidenceRefs: ['artifact:component-audit'],
      }],
      tasks: [],
    })

    expect(draft.intakeStatus).toBe('catalog_ready')
    expect(draft.groups[0]?.changes).toEqual([expect.objectContaining({
      kind: 'create',
      task: expect.objectContaining({
        status: 'import_draft',
        capabilityBindings: [{ capabilityId: 'looma:alert-dialog', relation: 'plans' }],
      }),
    })])
  })

  it('treats stale task state as evidence instead of gospel by proposing a reframe', () => {
    const draft = planProjectReintake({
      now,
      sources: [loomaAuditSource],
      tasks: [
        task({
          id: 'task-039',
          title: 'Build AlertDialog primitive',
          description: 'Build the Looma AlertDialog primitive.',
          status: 'blocked',
          deliverableName: 'AlertDialog',
        }),
      ],
    })

    const reframe = draft.groups.flatMap(group => group.changes).find(change => change.kind === 'reframe')
    expect(reframe).toMatchObject({
      kind: 'reframe',
      taskId: 'task-039',
      after: expect.objectContaining({
        title: 'Build AlertDialog',
        dependsOn: [],
      }),
      reason: expect.stringContaining('current evidence'),
    })
    expect(draft.summary.reframed).toBe(1)
  })

  it('repairs archived prerequisites without rewriting the current task', () => {
    const draft = planProjectReintake({
      now,
      sources: [loomaAuditSource],
      tasks: [
        task({
          id: 'task-dialog-history',
          title: 'Build Dialog primitive',
          status: 'archived',
          deliverableName: 'Dialog',
        }),
        task({
          id: 'task-alert-current',
          title: 'Build AlertDialog',
          status: 'ready',
          dependsOn: ['task-dialog-history'],
          deliverableName: 'AlertDialog',
        }),
      ],
    })

    expect(draft.groups.flatMap(group => group.changes)).toContainEqual(expect.objectContaining({
      kind: 'repair_dependencies',
      taskId: 'task-alert-current',
      beforeDependsOn: ['task-dialog-history'],
      afterDependsOn: [],
    }))
    expect(draft.summary.repairedDependencies).toBe(1)
  })

  it('reframes weak legacy pre-implementation specs when current evidence still supports the task', () => {
    const draft = planProjectReintake({
      now,
      sources: [loomaAuditSource],
      tasks: [
        task({
          id: 'task-039',
          title: 'Build AlertDialog primitive',
          description: 'Build the Looma AlertDialog primitive.',
          status: 'spec_review',
          deliverableName: 'AlertDialog',
          productBrief: {
            userJob: 'Ship AlertDialog.',
            successMetric: 'The task has a reviewable spec and acceptance criteria.',
          },
          spec: '## Summary\nBuild the AlertDialog primitive.\n\n## Acceptance Criteria\n- The feature is reviewable.',
          acceptanceCriteria: [{ id: 'legacy', description: 'Feature is reviewable.', verifiedBy: 'review', met: false }],
        }),
      ],
    })

    expect(draft.groups.flatMap(group => group.changes)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'reframe',
        taskId: 'task-039',
        reason: expect.stringContaining('current evidence'),
      }),
    ]))
  })

  it('preserves the real existing status when re-intake proposes a reframe', () => {
    const draft = planProjectReintake({
      now,
      sources: [{ path: 'docs/harness/implementation-roadmap.md', content: narrativeRoadmap }],
      tasks: [
        task({
          id: 'task-import-9s8tkc',
          title: 'Define fixture, expected-record, prototype-run, and evaluation schemas.',
          description: '1. Define fixture, expected-record, prototype-run, and evaluation schemas.',
          sourceIdentity: 'docs/harness/implementation-roadmap.md#unit:1',
          deliverableName: 'Define fixture, expected-record, prototype-run, and evaluation schemas.',
          status: 'import_draft',
        }),
      ],
    })

    const reframe = draft.groups.flatMap(group => group.changes).find(change =>
      change.kind === 'reframe' && change.taskId === 'task-import-9s8tkc',
    )
    expect(reframe).toMatchObject({
      kind: 'reframe',
      taskId: 'task-import-9s8tkc',
      before: {
        id: 'task-import-9s8tkc',
        title: 'Define fixture, expected-record, prototype-run, and evaluation schemas.',
        status: 'import_draft',
      },
    })
  })

  it('does not assign differently named same-number stages to the selected release', () => {
    const draft = planProjectReintake({
      now,
      sources: [
        {
          path: 'knit/docs/release-plan.md',
          content: [
            knitSelectedReleaseSource,
            '',
            '### V1 gate',
            '',
            '- **Stage alignment:** Stage 1: V1 Release Hardening',
            '- **Recommended domain:** knit',
            '- **Recommended first task title:** Run the V1 release hardening gate',
          ].join('\n'),
        },
        {
          path: 'looma/docs/milestones.md',
          content: [
            '# Milestone Plan',
            '',
            '### Primitive replacement wave',
            '',
            '- **Stage alignment:** Stage 1: Finish Knit Primitive Replacement Wave',
            '- **Recommended domain:** looma',
            '- **Recommended first task title:** Continue the Knit primitive replacement wave',
          ].join('\n'),
        },
      ],
      tasks: [],
    })

    expect(draft.selectedReleaseId).toBe('stage-1-v1-release-hardening')
    const selected = draft.groups.flatMap(group => group.changes).find(change =>
      change.kind === 'create' && change.task.title === 'Run the V1 release hardening gate',
    )
    expect(selected).toBeUndefined()
    const created = draft.groups.flatMap(group => group.changes).find(change =>
      change.kind === 'create' && change.task.title === 'Continue the Knit primitive replacement wave',
    )
    expect(created).toBeUndefined()
  })

  it('keeps explicit current release membership separate from later inventory work', () => {
    const inventory = [
      '# Remaining Spec Decomposition Inventory',
      '',
      '### `dialogue-and-character-voice.md`',
      '',
      '- **Recommended first task title:** Implement dialogue-and-character-voice reviewer lane',
      '- **Recommended domain:** coherence',
      '- **Stage alignment:** Stage 2 (Agent Coordination)',
    ].join('\n')
    const draft = planProjectReintake({
      now,
      sources: [
        {
          path: 'docs/harness/headless-mvp-release-plan.md',
          content: scopedNarrativeRelease,
          semanticKinds: { 'Character voice and dialogue review': 'reviewer_lane' },
        },
        { path: 'docs/harness/remaining-spec-decomposition-inventory.md', content: inventory },
      ],
      tasks: [],
    })

    const changes = draft.groups.flatMap(group => group.changes)
    const change = changes.find(change =>
      change.kind === 'create' && change.task.title === 'Build Character voice and dialogue review',
    )
    expect(change).toMatchObject({
      kind: 'create',
      task: {
        releaseIds: ['stage-1-headless-drafting-and-evaluation-mvp'],
        status: 'spec_review',
      },
    })
    expect(changes).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'create',
        task: expect.objectContaining({ title: 'Implement dialogue-and-character-voice reviewer lane' }),
      }),
    ]))
    const later = changes.find(change =>
      change.kind === 'create' && change.task.title === 'Implement dialogue-and-character-voice reviewer lane',
    )
    expect(later).toBeUndefined()
  })

  it('does not let a long planning instruction claim release scope by repeating deliverable vocabulary', () => {
    const planningInstruction = [
      'You are repairing the project plan from current workspace evidence. First, repair the selected release and create a fresh release boundary.',
      'Use only source-backed evidence. Do not wait for approval, manufacture capabilities, or mark a release shipped without proof.',
      'The selected release must include author intent and voice input, synopsis generation, story records, context planning, broad-genre drafting model proof, chapter drafting, and review lenses.',
      'After repairing the plan, run the selected work and make the release state readable through Guildhall.',
    ].join(' ')
    const draft = planProjectReintake({
      now,
      sources: [{ path: 'docs/harness/headless-mvp-release-plan.md', content: scopedNarrativeRelease }],
      tasks: [task({
        id: 'task-instruction-shaped-like-work',
        title: planningInstruction,
        status: 'spec_review',
        semanticKind: 'planning_instruction',
        releaseIds: ['stage-1-headless-drafting-and-evaluation-mvp'],
      })],
    })

    const changes = draft.groups.flatMap(group => group.changes)
    expect(changes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'archive',
        taskId: 'task-instruction-shaped-like-work',
      }),
    ]))
    expect(draft.releases?.[0]?.nodeIds).not.toContain('work:task-instruction-shaped-like-work')
  })

  it('supersedes a shipped release with a deterministic reconciled release when current work remains', () => {
    const draft = planProjectReintake({
      now,
      sources: [{ path: 'docs/harness/headless-mvp-release-plan.md', content: scopedNarrativeRelease }],
      releases: [{
        id: 'stage-1-headless-drafting-and-evaluation-mvp',
        label: 'Stage 1: Headless Drafting And Evaluation MVP',
        state: 'shipped',
        nodeIds: ['work:task-instruction-shaped-like-work'],
        deferredNodeIds: [],
      }],
      tasks: [task({
        id: 'task-instruction-shaped-like-work',
        title: 'You are repairing the project plan from current workspace evidence. First, repair the selected release and create a fresh release boundary. Use only source-backed evidence. Do not wait for approval, manufacture capabilities, or mark a release shipped without proof. The selected release must include author intent and voice input, synopsis generation, story records, context planning, broad-genre drafting model proof, chapter drafting, and review lenses. After repairing the plan, run the selected work and make the release state readable through Guildhall.',
        status: 'spec_review',
        semanticKind: 'planning_instruction',
        releaseIds: ['stage-1-headless-drafting-and-evaluation-mvp'],
      })],
    })

    expect(draft.selectedReleaseId).toBe('stage-1-headless-drafting-and-evaluation-mvp-r1')
    expect(draft.releases?.[0]).toMatchObject({
      id: 'stage-1-headless-drafting-and-evaluation-mvp-r1',
      label: 'Stage 1: Headless Drafting And Evaluation MVP (reconciled plan)',
      supersedesReleaseId: 'stage-1-headless-drafting-and-evaluation-mvp',
      nodeIds: expect.not.arrayContaining(['work:task-instruction-shaped-like-work']),
    })
  })

  it('keeps a broad release-table row in shaping until it has concrete proof evidence', () => {
    const draft = planProjectReintake({
      now,
      projectPath: '/workspace',
      sources: [{
        path: 'docs/harness/headless-mvp-release-plan.md',
        content: [
          '# Narrative Harness release plan',
          '',
          '## Current Next Milestone',
          '',
          'The next milestone is Stage 1: Headless Drafting And Evaluation MVP.',
          '',
          '## Deliverables',
          '',
          '| Deliverable | Need | Foundation | Consumer |',
          '| --- | --- | --- | --- |',
          '| Synopsis expansion into story records | Expand synopsis into outline, characters, voices, world facts, and constraints. | Story-memory specs | Draft context |',
        ].join('\n'),
      }],
      tasks: [],
    })

    const change = draft.groups.flatMap(group => group.changes).find(candidate =>
      candidate.kind === 'create' && candidate.task.title === 'Build Synopsis expansion into story records',
    )
    expect(change).toMatchObject({
      kind: 'create',
      task: {
        domain: 'harness',
        status: 'import_draft',
        proofPaths: [],
      },
    })
    if (!change || change.kind !== 'create') throw new Error('Expected a create change for synopsis expansion')
    expect(change.task).not.toHaveProperty('productBrief')
  })

  it('does not plan the same source-backed task for creation and archival', () => {
    const source = {
      path: 'docs/harness/headless-mvp-release-plan.md',
      content: [
        '# Narrative Harness release plan',
        '',
        '## Current Next Milestone',
        '',
        'The next milestone is Stage 1: Headless Drafting And Evaluation MVP.',
        '',
        '## Deliverables',
        '',
        '| Deliverable | Need | Foundation | Consumer |',
        '| --- | --- | --- | --- |',
        '| Broad-genre drafting model proof | Evaluate a DeepInfra-accessible model across genres. | Provider direction | Chapter drafting |',
      ].join('\n'),
    }
    const firstDraft = planProjectReintake({
      now,
      sources: [source],
      tasks: [],
    })
    const created = firstDraft.groups.flatMap(group => group.changes).find(change => (
      change.kind === 'create' && change.task.title === 'Build Broad-genre drafting model proof'
    ))
    expect(created?.kind).toBe('create')
    if (created?.kind !== 'create') return

    const draft = planProjectReintake({
      now,
      sources: [source],
      tasks: [task({
        id: created.task.id,
        title: created.task.title,
        status: 'blocked',
      })],
    })

    const changes = draft.groups.flatMap(group => group.changes)
    expect(changes.filter(change => (
      (change.kind === 'create' && change.task.id === created.task.id) ||
      (change.kind === 'reframe' && change.taskId === created.task.id) ||
      (change.kind === 'archive' && change.taskId === created.task.id)
    ))).toHaveLength(1)
    expect(changes).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'archive', taskId: created.task.id }),
    ]))
  })

  it('moves open work from a renamed same-stage release instead of archiving it', () => {
    const draft = planProjectReintake({
      now,
      sources: [{ path: 'docs/harness/headless-mvp-release-plan.md', content: scopedNarrativeRelease }],
      tasks: [
        task({
          id: 'task-old-stage-one',
          title: 'Shape fixture and expected-record ground truth',
          status: 'exploring',
          releaseIds: ['stage-1-fixture-and-evaluation-harness'],
          spec: '## What this is\nShape the fixture and expected records.',
        }),
      ],
    })

    const changes = draft.groups.flatMap(group => group.changes)
    expect(changes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'reframe',
        taskId: 'task-old-stage-one',
        after: expect.objectContaining({
          releaseIds: ['stage-1-headless-drafting-and-evaluation-mvp'],
          stageAlignment: 'Stage 1: Headless Drafting And Evaluation MVP',
        }),
      }),
    ]))
    expect(changes).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'archive', taskId: 'task-old-stage-one' }),
    ]))
    expect(draft.releases).toEqual([
      expect.objectContaining({
        id: 'stage-1-headless-drafting-and-evaluation-mvp',
        proofStyle: 'script_only',
      }),
    ])
  })

  it('keeps selected-release import drafts out of stale weak-spec archival', () => {
    const draft = planProjectReintake({
      now,
      sources: [{ path: 'knit/docs/release-plan.md', content: knitSelectedReleaseSource }],
      tasks: [
        task({
          id: 'task-import-unit-tests',
          title: 'Unit tests: use-collections, use-presence, subdomain utils',
          status: 'import_draft',
          releaseIds: ['stage-1-v1-release-hardening'],
          spec: '## Summary\nImported draft awaiting shaping.',
        }),
      ],
    })

    const archive = draft.groups.flatMap(group => group.changes).find(change =>
      change.kind === 'archive' && change.taskId === 'task-import-unit-tests',
    )
    expect(archive).toBeUndefined()
  })

  it('uses the first documented release-plan stage as the selected boundary when no current marker exists', () => {
    const draft = planProjectReintake({
      now,
      sources: [{ path: 'knit/docs/release-plan.md', content: knitReleasePlanWithoutCurrentMarker }],
      tasks: [
        task({
          id: 'task-import-unit-tests',
          title: 'Unit tests: use-collections, use-presence, subdomain utils',
          status: 'archived',
          releaseIds: ['stage-1-v1-release-hardening'],
          archivedEvidence: {
            source: 'project-reintake',
            code: 'unsupported_weak_preimplementation',
            reason: 'Pre-implementation task is unsupported by current evidence and still uses a weak legacy spec shape.',
          },
          spec: '## Summary\nImported draft awaiting shaping.',
        }),
      ],
    })

    expect(draft.selectedReleaseId).toBe('stage-1-v1-release-hardening')
    const restore = draft.groups.flatMap(group => group.changes).find(change =>
      change.kind === 'reframe' && change.taskId === 'task-import-unit-tests',
    )
    expect(restore).toMatchObject({
      kind: 'reframe',
      taskId: 'task-import-unit-tests',
      after: {
        status: 'import_draft',
        releaseIds: ['stage-1-v1-release-hardening'],
      },
    })
  })

  it('does not restore an archived task from a prose-only archive reason', () => {
    const draft = planProjectReintake({
      now,
      sources: [{ path: 'knit/docs/release-plan.md', content: knitReleasePlanWithoutCurrentMarker }],
      tasks: [
        task({
          id: 'task-import-unit-tests',
          title: 'Unit tests: use-collections, use-presence, subdomain utils',
          status: 'archived',
          releaseIds: ['stage-1-v1-release-hardening'],
          archivedEvidence: {
            source: 'project-reintake',
            reason: 'Pre-implementation task is unsupported by current evidence and still uses a weak legacy spec shape.',
          },
          spec: '## Summary\nImported draft awaiting shaping.',
        }),
      ],
    })

    const restore = draft.groups.flatMap(group => group.changes).find(change =>
      change.kind === 'reframe' && change.taskId === 'task-import-unit-tests',
    )
    expect(restore).toBeUndefined()
  })

  it('repairs imported tasks that were assigned to both selected and later release boundaries', () => {
    const draft = planProjectReintake({
      now,
      sources: [{ path: 'knit/docs/release-plan.md', content: knitSelectedReleaseSource }],
      tasks: [
        task({
          id: 'task-import-looma-wave',
          title: 'Finish the Knit primitive replacement wave',
          status: 'import_draft',
          releaseIds: [
            'stage-1-v1-release-hardening',
            'stage-1-finish-knit-primitive-replacement-wave',
          ],
          spec: '## Summary\nImported draft awaiting shaping.',
        }),
      ],
    })

    const reframe = draft.groups.flatMap(group => group.changes).find(change =>
      change.kind === 'reframe' && change.taskId === 'task-import-looma-wave',
    )
    expect(reframe).toMatchObject({
      kind: 'reframe',
      taskId: 'task-import-looma-wave',
      after: {
        releaseIds: ['stage-1-finish-knit-primitive-replacement-wave'],
      },
    })
  })

  it('preserves completed work as progress evidence instead of recreating it', () => {
    const draft = planProjectReintake({
      now,
      sources: [loomaAuditSource],
      tasks: [
        task({
          id: 'task-dialog',
          title: 'Build Dialog primitive',
          deliverableName: 'Dialog',
          producedArtifact: 'ui-dialog',
          status: 'done',
          notes: [{ agentId: 'gate', role: 'gate', content: 'pnpm test passed', timestamp: now }],
        }),
      ],
    })

    const changes = draft.groups.flatMap(group => group.changes)
    expect(changes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'preserve_progress',
        taskId: 'task-dialog',
        reason: expect.stringContaining('completed'),
      }),
      expect.objectContaining({
        kind: 'create',
        task: expect.objectContaining({
          title: 'Build AlertDialog',
          dependsOn: [],
        }),
      }),
    ]))
    expect(changes.some(change => change.kind === 'create' && change.task.title === 'Build Dialog')).toBe(false)
  })

  it('preserves started implementation work instead of reframing it during re-intake', () => {
    const draft = planProjectReintake({
      now,
      sources: [loomaAuditSource],
      tasks: [
        task({
          id: 'task-drawer',
          title: 'Build Drawer primitive',
          description: 'Worker already started this implementation.',
          status: 'in_progress',
          spec: '## Summary\nBuild Drawer.\n\n## Acceptance Criteria\n- Ship Drawer.',
          acceptanceCriteria: [],
        }),
      ],
    })

    const taskChanges = draft.groups.flatMap(group => group.changes).filter(change =>
      ('taskId' in change && change.taskId === 'task-drawer')
      || (change.kind === 'create' && change.task.id === 'task-drawer'),
    )
    expect(taskChanges).toEqual([])
  })

  it('does not preserve started imported contract work when the handoff is structurally hollow', () => {
    const inventory = [
      '# Remaining Spec Decomposition Inventory',
      '',
      '### 2.6 `author-involvement-modes.md`',
      '',
      '- **Recommended first task title:** Implement author-involvement-modes contract and involvement-dial types',
      '- **Recommended domain:** workflow',
      '- **Stage alignment:** Stage 2 (Agent Coordination)',
    ].join('\n')
    const specWithoutContracts = [
      '# Author Involvement Modes',
      '',
      'Define how the author can choose light, normal, or heavy involvement before the harness applies editor feedback.',
      '',
      '## Verification',
      '',
      '- Run one bounded feedback scenario through each involvement mode.',
    ].join('\n')
    const draft = planProjectReintake({
      now,
      projectPath: '/workspace',
      sources: [
        { path: 'docs/harness/implementation-roadmap.md', content: narrativeRoadmap },
        { path: 'docs/harness/remaining-spec-decomposition-inventory.md', content: inventory },
        { path: 'docs/specs/author-involvement-modes.md', content: specWithoutContracts },
      ],
      tasks: [
        task({
          id: 'task-import-author-involvement',
          title: 'Implement author-involvement-modes contract and involvement-dial types',
          semanticKind: 'contract',
          description: 'Source-backed task from remaining spec inventory.',
          status: 'in_progress',
          references: [
            'docs/harness/remaining-spec-decomposition-inventory.md',
            'docs/specs/author-involvement-modes.md',
          ],
          requestIntake: {
            createdBy: 'workspace-importer',
          },
          spec: [
            '## What this is',
            'Implement author-involvement-modes contract and involvement-dial types',
            '',
            '## Acceptance criteria',
            '1. The cited contracts are explicitly defined and usable in code: .',
          ].join('\n'),
          acceptanceCriteria: [{
            id: 'contracts-defined',
            description: 'The cited contracts are explicitly defined and usable in code: .',
            verifiedBy: 'review',
            met: false,
          }],
          definitionOfDone: {
            items: ['The cited contracts are explicitly defined and usable in code: .'],
            evidenceRequired: [],
          },
        }),
        task({
          id: 'task-import-archived-contract-noise',
          title: 'Define fixture and evaluation contracts',
          description: 'Old duplicate imported work.',
          status: 'archived',
          references: [
            'docs/harness/remaining-spec-decomposition-inventory.md',
            'docs/specs/author-involvement-modes.md',
          ],
          acceptanceCriteria: [{
            id: 'contracts-defined',
            description: 'The cited contracts are explicitly defined and usable in code: .',
            verifiedBy: 'review',
            met: false,
          }],
        }),
      ],
    })

    const changes = draft.groups.flatMap(group => group.changes)
    expect(changes).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'preserve_progress',
        taskId: 'task-import-author-involvement',
      }),
    ]))
    expect(changes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'reframe',
        taskId: 'task-import-author-involvement',
        after: expect.objectContaining({
          title: 'Recover source-backed contract surface for author-involvement-modes contract and involvement-dial types',
          semanticKind: 'contract',
          status: 'shelved',
        }),
      }),
    ]))
    expect(changes).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'reframe',
        taskId: 'task-import-archived-contract-noise',
      }),
    ]))
  })

  it('archives unsupported blocked task noise without deleting it', () => {
    const draft = planProjectReintake({
      now,
      sources: [],
      tasks: [
        task({
          id: 'task-old',
          title: 'Retry project discovery update',
          status: 'blocked',
          notes: [],
        }),
      ],
    })

    expect(draft.groups.flatMap(group => group.changes)).toEqual([
      expect.objectContaining({
        kind: 'archive',
        taskId: 'task-old',
        reason: expect.stringContaining('no current source evidence'),
      }),
    ])
  })

  it('archives stale weak pre-implementation specs that current evidence no longer supports', () => {
    const draft = planProjectReintake({
      now,
      sources: [],
      tasks: [
        task({
          id: 'task-tooltip',
          title: 'Build Tooltip primitive',
          status: 'ready',
          productBrief: {
            userJob: 'Ship Tooltip.',
            successMetric: 'Tooltip is reviewable.',
          },
          spec: '## Summary\nBuild Tooltip.\n\n## Acceptance Criteria\n- The feature is reviewable.',
          acceptanceCriteria: [{ id: 'legacy', description: 'Feature is reviewable.', verifiedBy: 'review', met: false }],
        }),
      ],
    })

    expect(draft.groups.flatMap(group => group.changes)).toEqual([
      expect.objectContaining({
        kind: 'archive',
        taskId: 'task-tooltip',
        reason: expect.stringContaining('weak legacy spec shape'),
      }),
    ])
  })

  it('does not archive an explicitly shaped task because a roadmap also has starter tasks', () => {
    const draft = planProjectReintake({
      now,
      sources: [{ path: 'docs/harness/implementation-roadmap.md', content: narrativeRoadmap }],
      tasks: [
      task({
          id: 'task-deliverable',
          title: 'typed fixture and expected-record contracts',
          description: 'docs/harness/implementation-roadmap.md: - typed fixture and expected-record contracts',
        status: 'import_draft',
        spec: '## Summary\nKeep the typed fixture contract visible.\n\n## Acceptance Criteria\n1. The typed fixture contract is reviewable.',
        acceptanceCriteria: [{ id: 'typed-fixture', description: 'The typed fixture contract is reviewable.', verifiedBy: 'review' }],
        productBrief: { userJob: 'Keep the typed fixture contract visible.', successMetric: 'The typed fixture contract is reviewable.' },
        structuredSpec: { kind: 'implementation', boundary: 'typed fixture contract' },
        }),
        task({
          id: 'task-later',
          title: 'Mastra workflow for the prototype iteration loop',
          description: 'docs/harness/implementation-roadmap.md: - Mastra workflow for the prototype iteration loop',
          status: 'shelved',
        }),
      ],
    })

    expect(draft.groups.flatMap(group => group.changes)).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'archive', taskId: 'task-deliverable' }),
    ]))
    expect(draft.groups.flatMap(group => group.changes)).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'archive',
        taskId: 'task-later',
      }),
    ]))
  })

  it('merges duplicate blocked recovery cards only with explicit identity', () => {
    const draft = planProjectReintake({
      now,
      sources: [],
      tasks: [
        task({ id: 'task-a', title: 'Review project discovery update', sourceIdentity: 'docs/discovery/review', status: 'blocked' }),
        task({ id: 'task-b', title: 'A differently worded discovery review', sourceIdentity: 'docs/discovery/review', status: 'blocked' }),
      ],
    })

    expect(draft.groups.flatMap(group => group.changes)).toEqual([
      expect.objectContaining({
        kind: 'merge',
        survivorTaskId: 'task-a',
        mergedTaskIds: ['task-b'],
      }),
    ])
  })

  it('creates integration work from explicit consuming-surface metadata', () => {
    const draft = planProjectReintake({
      now,
      sources: [loomaAuditSource],
      tasks: [],
    })

    const changes = draft.groups.flatMap(group => group.changes)
    const implementation = changes.find(change => change.kind === 'create' && change.task.title === 'Build AlertDialog')
    const integration = changes.find(change => change.kind === 'create' && change.task.title === 'Integrate AlertDialog into Knit destructive confirmation flow')
    expect(implementation).toMatchObject({ kind: 'create', task: { sourceIdentity: 'looma/component/alert-dialog' } })
    expect(integration).toMatchObject({
      kind: 'create',
      task: {
        sourceIdentity: 'looma/component/alert-dialog:integration',
        dependsOn: [implementation && implementation.kind === 'create' ? implementation.task.id : 'missing'],
      },
    })
  })

  it('does not manufacture a task from an untyped prose bug note', () => {
    const draft = planProjectReintake({
      now,
      sources: [{
        path: 'internal/notes/settings-copy.md',
        content: [
          '# Bug note',
          '',
          'The settings footer says "Host-run" but should say "Runs on host" in src/web/surfaces/project/SettingsTab.svelte.',
        ].join('\n'),
      }],
      tasks: [],
    })

    const changes = draft.groups.flatMap(group => group.changes)
    expect(changes).toEqual([])
  })
})
