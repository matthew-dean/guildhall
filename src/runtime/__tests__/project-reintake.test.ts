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
  '',
  '## Deliverables',
  '',
  '| Deliverable | Need | Foundation | Consumer |',
  '| --- | --- | --- | --- |',
  '| Character voice and dialogue review | Review character voice and dialogue. | Character specs | Draft review |',
].join('\n')

describe('project re-intake planner', () => {
  it('treats stale task state as evidence instead of gospel by proposing a reframe', () => {
    const draft = planProjectReintake({
      now,
      sources: [{ path: 'looma/docs/component-library-audit.md', content: loomaAudit }],
      tasks: [
        task({
          id: 'task-039',
          title: 'Build AlertDialog primitive',
          description: 'Build the Looma AlertDialog primitive.',
          status: 'blocked',
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
      sources: [{ path: 'looma/docs/component-library-audit.md', content: loomaAudit }],
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
      sources: [{ path: 'looma/docs/component-library-audit.md', content: loomaAudit }],
      tasks: [
        task({
          id: 'task-039',
          title: 'Build AlertDialog primitive',
          description: 'Build the Looma AlertDialog primitive.',
          status: 'spec_review',
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
    expect(selected).toMatchObject({
      kind: 'create',
      task: {
        releaseIds: ['stage-1-v1-release-hardening'],
      },
    })
    const created = draft.groups.flatMap(group => group.changes).find(change =>
      change.kind === 'create' && change.task.title === 'Continue the Knit primitive replacement wave',
    )
    expect(created).toMatchObject({
      kind: 'create',
      task: {
        stageAlignment: 'stage 1: finish knit primitive replacement wave',
      },
    })
    expect(created.kind === 'create' ? created.task.releaseIds : undefined).toBeUndefined()
  })

  it('lets an explicit current release scope override a stale later-stage inventory label', () => {
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
        { path: 'docs/harness/headless-mvp-release-plan.md', content: scopedNarrativeRelease },
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
    if (change.kind === 'create') {
      expect(change.task).not.toHaveProperty('productBrief')
    }
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
      sources: [{ path: 'looma/docs/component-library-audit.md', content: loomaAudit }],
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
      sources: [{ path: 'looma/docs/component-library-audit.md', content: loomaAudit }],
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

  it('archives old current-milestone deliverable imports when starter tasks now define that milestone', () => {
    const draft = planProjectReintake({
      now,
      sources: [{ path: 'docs/harness/implementation-roadmap.md', content: narrativeRoadmap }],
      tasks: [
        task({
          id: 'task-deliverable',
          title: 'typed fixture and expected-record contracts',
          description: 'docs/harness/implementation-roadmap.md: - typed fixture and expected-record contracts',
          status: 'import_draft',
        }),
        task({
          id: 'task-later',
          title: 'Mastra workflow for the prototype iteration loop',
          description: 'docs/harness/implementation-roadmap.md: - Mastra workflow for the prototype iteration loop',
          status: 'shelved',
        }),
      ],
    })

    expect(draft.groups.flatMap(group => group.changes)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'archive',
        taskId: 'task-deliverable',
        reason: expect.stringContaining('starter-task sequence'),
      }),
    ]))
    expect(draft.groups.flatMap(group => group.changes)).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'archive',
        taskId: 'task-later',
      }),
    ]))
  })

  it('merges duplicate blocked recovery cards into one survivor', () => {
    const draft = planProjectReintake({
      now,
      sources: [],
      tasks: [
        task({ id: 'task-a', title: 'Review project discovery update', status: 'blocked' }),
        task({ id: 'task-b', title: 'Review project discovery update', status: 'blocked' }),
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

  it('creates integration work when evidence names a consuming surface', () => {
    const draft = planProjectReintake({
      now,
      sources: [{ path: 'looma/docs/component-library-audit.md', content: loomaAudit }],
      tasks: [],
    })

    const changes = draft.groups.flatMap(group => group.changes)
    expect(changes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'create',
        task: expect.objectContaining({ id: 'task-alert-dialog', title: 'Build AlertDialog' }),
      }),
      expect.objectContaining({
        kind: 'create',
        task: expect.objectContaining({
          id: 'task-alert-dialog-integration',
          title: 'Integrate AlertDialog into Knit destructive confirmation flow',
          dependsOn: ['task-alert-dialog'],
        }),
      }),
    ]))
  })

  it('does not split a single bounded edit into child or integration work', () => {
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
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({
      kind: 'create',
      task: expect.objectContaining({
        title: 'Update settings footer copy',
        dependsOn: [],
      }),
    })
  })
})
