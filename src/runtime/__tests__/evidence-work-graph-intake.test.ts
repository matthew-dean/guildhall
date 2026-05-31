import { describe, expect, it } from 'vitest'

import { planEvidenceWorkGraph } from '../evidence-work-graph-intake.js'

const loomaComponentEvidence = [
  '# Component audit',
  '',
  '| Deliverable | Need | Foundation | Consumer |',
  '| --- | --- | --- | --- |',
  '| Dialog | shipped as `ui-dialog` | native dialog + overlay manager | Knit BaseDialog already uses it |',
  '| AlertDialog | missing P0 gap | builds on Dialog and Button | Knit destructive confirmation flow |',
  '| Drawer | missing | builds on Dialog and overlay manager | Knit mobile navigation drawer |',
  '',
  '# Migration inventory',
  '',
  '- Knit delete collection confirmation needs `AlertDialog` before replacing the local BaseDialog variant.',
  '- Knit mobile navigation should use `Drawer` once the Looma primitive exists.',
].join('\n')

const compliancePipelineEvidence = [
  '# Data retention launch plan',
  '',
  '| Deliverable | Need | Foundation | Consumer |',
  '| --- | --- | --- | --- |',
  '| Retention policy schema | add tenant-configurable retention windows | database migration + policy model | Retention worker and admin API |',
  '| Retention worker | purge expired audit events nightly | retention policy schema + audit-event cursor | Operations runbook |',
  '| Audit export API | allow enterprise tenants to export retained audit events | audit-event query service | Compliance dashboard |',
  '| Compliance dashboard integration | expose export and retention status to admins | Audit export API + Retention worker status | Admin settings page |',
  '',
  'The worker must not be scheduled until the policy schema exists. The dashboard integration must wait for the export API and worker status.',
].join('\n')

describe('evidence-to-work-graph intake', () => {
  it('extracts deliverable units from source evidence instead of flattening them into one vague task', () => {
    const plan = planEvidenceWorkGraph({
      sources: [{ path: 'looma/docs/component-library-audit.md', content: loomaComponentEvidence }],
      existingTasks: [],
    })

    expect(plan.units.map(unit => unit.name)).toEqual(['Dialog', 'AlertDialog', 'Drawer'])
    expect(plan.tasks.filter(task => task.kind === 'implementation').map(task => task.deliverableName)).toEqual([
      'AlertDialog',
      'Drawer',
    ])
    expect(plan.tasks.some(task => task.title === 'looma/docs/component-library-audit.md: AlertDialog')).toBe(false)
  })

  it('preserves foundation, shared primitive, and dependency relationships for a UI component-library fixture', () => {
    const plan = planEvidenceWorkGraph({
      sources: [{ path: 'looma/docs/component-library-audit.md', content: loomaComponentEvidence }],
      existingTasks: [
        {
          id: 'task-dialog-foundation',
          title: 'Build Dialog primitive',
          status: 'in_progress',
          deliverableName: 'Dialog',
          producedArtifact: 'ui-dialog',
        },
      ],
    })

    const alertDialog = plan.tasks.find(task => task.deliverableName === 'AlertDialog' && task.kind === 'implementation')
    expect(alertDialog).toMatchObject({
      producedArtifact: 'ui-alert-dialog',
      targetArea: 'looma',
      buildsOn: ['Dialog', 'Button'],
      sharedFoundations: ['ui-dialog', 'ui-button'],
      dependsOn: ['task-dialog-foundation'],
      relatedTasks: [
        expect.objectContaining({
          taskId: 'task-dialog-foundation',
          relationship: 'blocks',
          reason: expect.stringContaining('Dialog'),
        }),
      ],
    })
  })

  it('splits reusable deliverables from consuming-product integration work', () => {
    const plan = planEvidenceWorkGraph({
      sources: [{ path: 'looma/docs/component-library-audit.md', content: loomaComponentEvidence }],
      existingTasks: [],
    })

    const componentTask = plan.tasks.find(task => task.deliverableName === 'AlertDialog' && task.kind === 'implementation')
    const integrationTask = plan.tasks.find(task => task.deliverableName === 'AlertDialog' && task.kind === 'integration')

    expect(integrationTask).toMatchObject({
      title: 'Integrate AlertDialog into Knit destructive confirmation flow',
      targetArea: 'knit',
      consumerSurface: 'destructive confirmation flow',
      dependsOn: [componentTask?.id],
    })
  })

  it('generates proof contracts appropriate to implementation and integration work', () => {
    const plan = planEvidenceWorkGraph({
      sources: [{ path: 'looma/docs/component-library-audit.md', content: loomaComponentEvidence }],
      existingTasks: [],
    })

    const componentTask = plan.tasks.find(task => task.deliverableName === 'AlertDialog' && task.kind === 'implementation')
    const integrationTask = plan.tasks.find(task => task.deliverableName === 'AlertDialog' && task.kind === 'integration')

    expect(componentTask?.acceptanceCriteria.map(criterion => criterion.id)).toEqual([
      'source-implementation',
      'public-contract',
      'foundation-reuse',
      'design-system-conformance',
      'accessibility-contract',
      'automated-proof',
    ])
    expect(integrationTask?.acceptanceCriteria.map(criterion => criterion.id)).toEqual([
      'public-consumer-import',
      'consumer-flow-renders',
      'runtime-proof',
      'look-and-feel-proof',
      'integration-regression-test',
    ])
  })

  it('applies the same graph behavior to a backend/data-compliance launch plan', () => {
    const plan = planEvidenceWorkGraph({
      sources: [{ path: 'docs/data-retention-launch-plan.md', content: compliancePipelineEvidence }],
      existingTasks: [],
    })

    expect(plan.units.map(unit => unit.name)).toEqual([
      'Retention policy schema',
      'Retention worker',
      'Audit export API',
      'Compliance dashboard integration',
    ])

    const worker = plan.tasks.find(task => task.deliverableName === 'Retention worker' && task.kind === 'implementation')
    const exportApi = plan.tasks.find(task => task.deliverableName === 'Audit export API' && task.kind === 'implementation')
    const dashboard = plan.tasks.find(task => task.deliverableName === 'Compliance dashboard integration' && task.kind === 'integration')

    expect(worker).toMatchObject({
      buildsOn: ['Retention policy schema', 'audit-event cursor'],
      dependsOn: [expect.stringMatching(/retention-policy-schema/)],
    })
    expect(dashboard).toMatchObject({
      targetArea: 'Admin settings page',
      dependsOn: expect.arrayContaining([worker?.id, exportApi?.id]),
      consumerSurface: 'Compliance dashboard',
    })
  })

  it('reconciles duplicate vague tasks into the structured graph instead of creating competing work', () => {
    const plan = planEvidenceWorkGraph({
      sources: [{ path: 'looma/docs/component-library-audit.md', content: loomaComponentEvidence }],
      existingTasks: [
        {
          id: 'task-039',
          title: 'Build AlertDialog primitive',
          description: 'Build the Looma AlertDialog primitive as a concrete UI-library component.',
          status: 'blocked',
          acceptanceCriteria: [],
          dependsOn: [],
        },
      ],
    })

    const alertDialogTasks = plan.tasks.filter(task => task.deliverableName === 'AlertDialog' && task.kind === 'implementation')
    expect(alertDialogTasks).toHaveLength(1)
    expect(alertDialogTasks[0]).toMatchObject({
      id: 'task-039',
      status: 'spec_review',
      supersedesVagueIntake: true,
      acceptanceCriteria: expect.arrayContaining([
        expect.objectContaining({ id: 'source-implementation' }),
        expect.objectContaining({ id: 'automated-proof' }),
      ]),
    })
    expect(plan.reconciliations).toEqual([
      expect.objectContaining({
        existingTaskId: 'task-039',
        action: 'reframed_existing_task',
        reason: expect.stringContaining('AlertDialog'),
      }),
    ])
  })
})
