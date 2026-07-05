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
