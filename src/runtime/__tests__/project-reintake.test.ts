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
