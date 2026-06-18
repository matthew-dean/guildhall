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

const releaseMatrixEvidence = [
  '# 0.9 release matrix sample',
  '',
  '| Deliverable | Need | Foundation | Consumer |',
  '| --- | --- | --- | --- |',
  '| AlertDialog primitive | build reusable component primitive | Dialog foundation | demo app destructive action |',
  '| Comment endpoint | add backend API endpoint with membership checks | existing membership policy | API clients |',
  '| Inspect json output | add --json output to the inspect CLI command | existing inspect command | CLI users |',
  '| Quick start install warning | clarify docs-only install warning | quick start page | docs readers |',
  '| Archived at migration | add archived_at migration and rollback proof | current issue schema | migration runner |',
  '| Summary duplicate row bugfix | fix duplicate rows in summary output | existing summary renderer | CLI report users |',
  '| Settings footer copy | rename Host-run to Runs on host in settings footer | settings footer copy | settings footer |',
].join('\n')

const narrativeRoadmapEvidence = [
  '# Implementation Roadmap',
  '',
  '## Stage 1: Fixture And Evaluation Harness',
  '',
  'Goal: build a no-UI test harness that proves the story-memory and packet contracts against small fiction fixtures before any product UI is designed.',
  '',
  '## Current Next Milestone',
  '',
  'The next milestone is Stage 1: Fixture And Evaluation Harness.',
  '',
  '1. Define fixture, expected-record, prototype-run, and evaluation schemas.',
  '2. Add the first tiny fiction fixture and human-authored expected records.',
  '3. Implement a no-UI runner that builds a packet from fixture records.',
  '4. Add deterministic evaluation output that reports missing, noisy, stale, and',
  '   useful context.',
  '5. Generate a developer-readable debug report for each run.',
  '6. Use the first run to narrow the MVP story-memory schema.',
].join('\n')

const narrativeRemainingInventoryEvidence = [
  '# Remaining Spec Decomposition Inventory',
  '',
  '### 2.2 `dialogue-and-character-voice.md`',
  '',
  '- **Recommended first task title:** Implement dialogue-and-character-voice reviewer lane',
  '- **Recommended domain:** coherence',
  '- **Stage alignment:** Stage 2 (Agent Coordination)',
  '',
  '### 2.7 `scene-and-chapter-intelligence.md`',
  '',
  '- **Recommended first task title:** Implement scene-and-chapter-intelligence reviewer lane',
  '- **Recommended domain:** coherence',
  '- **Stage alignment:** Stage 2 (Agent Coordination)',
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
      targetArea: 'Knit destructive confirmation flow',
      consumerSurface: 'Knit destructive confirmation flow',
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
      consumerSurface: 'Admin settings page',
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

  it('keeps reusable component work split from consumer integration with dependency proof', () => {
    const plan = planEvidenceWorkGraph({
      sources: [{ path: 'internal/fixtures/release-proof-matrix/component-consumer/plan.md', content: releaseMatrixEvidence }],
      existingTasks: [],
    })

    const component = plan.tasks.find(task => task.deliverableName === 'AlertDialog primitive' && task.kind === 'implementation')
    const integration = plan.tasks.find(task => task.deliverableName === 'AlertDialog primitive' && task.kind === 'integration')

    expect(component).toMatchObject({
      targetArea: 'component-consumer',
      proofPaths: expect.arrayContaining([
        expect.objectContaining({ kind: 'command', expectedEvidence: expect.arrayContaining([expect.stringMatching(/component/i)]) }),
      ]),
    })
    expect(integration).toMatchObject({
      targetArea: 'demo app destructive action',
      consumerSurface: 'demo app destructive action',
      dependsOn: [component?.id],
      proofPaths: expect.arrayContaining([
        expect.objectContaining({ kind: 'browser', expectedEvidence: expect.arrayContaining([expect.stringMatching(/demo app destructive action/)]) }),
      ]),
    })
  })

  it('shapes backend/API, CLI/tooling, docs-only, migration/data, bugfix, and single-edit scenarios without UI assumptions', () => {
    const plan = planEvidenceWorkGraph({
      sources: [{ path: 'internal/fixtures/release-proof-matrix/backend-api/plan.md', content: releaseMatrixEvidence }],
      existingTasks: [],
    })

    const byName = (name: string) => plan.tasks.filter(task => task.deliverableName === name)
    expect(byName('Comment endpoint')).toHaveLength(1)
    expect(byName('Inspect json output')).toHaveLength(1)
    expect(byName('Quick start install warning')).toHaveLength(1)
    expect(byName('Archived at migration')).toHaveLength(1)
    expect(byName('Summary duplicate row bugfix')).toHaveLength(1)
    expect(byName('Settings footer copy')).toHaveLength(1)

    const apiTask = byName('Comment endpoint')[0]!
    const cliTask = byName('Inspect json output')[0]!
    const docsTask = byName('Quick start install warning')[0]!
    const migrationTask = byName('Archived at migration')[0]!
    const bugfixTask = byName('Summary duplicate row bugfix')[0]!
    const singleEditTask = byName('Settings footer copy')[0]!

    expect(apiTask.proofPaths).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'command', command: expect.stringMatching(/integration/i) }),
    ]))
    expect(cliTask.proofPaths).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'command', command: expect.stringMatching(/inspect.*json|json.*inspect/i) }),
    ]))
    expect(docsTask.proofPaths).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'command', command: expect.stringMatching(/docs/) }),
    ]))
    expect(migrationTask.proofPaths).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'command', expectedEvidence: expect.arrayContaining([expect.stringMatching(/rollback/i)]) }),
    ]))
    expect(bugfixTask.acceptanceCriteria).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'regression-reproduction' }),
    ]))
    expect(singleEditTask.dependsOn).toEqual([])

    for (const task of [apiTask, cliTask, docsTask, migrationTask, bugfixTask, singleEditTask]) {
      expect(task.kind).toBe('implementation')
      expect(task.proofPaths.map(proof => proof.kind)).not.toContain('browser')
      expect(JSON.stringify(task)).not.toMatch(/\b(component|design-system|look-and-feel|renders|visual|browser)\b/i)
    }
  })

  it('extracts current milestone task chains from prose roadmap docs instead of requiring deliverable tables', () => {
    const plan = planEvidenceWorkGraph({
      sources: [{ path: 'docs/harness/implementation-roadmap.md', content: narrativeRoadmapEvidence }],
      existingTasks: [],
    })

    expect(plan.tasks.filter(task => task.kind === 'implementation').map(task => task.title)).toEqual([
      'Define fixture, expected-record, prototype-run, and evaluation schemas.',
      'Add the first tiny fiction fixture and human-authored expected records.',
      'Implement a no-UI runner that builds a packet from fixture records.',
      'Add deterministic evaluation output that reports missing, noisy, stale, and useful context.',
      'Generate a developer-readable debug report for each run.',
      'Use the first run to narrow the MVP story-memory schema.',
    ])
    const firstTask = plan.tasks.find(task => task.title === 'Define fixture, expected-record, prototype-run, and evaluation schemas.')
    expect(firstTask?.buildsOn).toEqual(['Stage 1'])
    expect(plan.tasks.every(task => task.kind === 'implementation')).toBe(true)
  })

  it('extracts recommended implementation tasks from decomposition inventories instead of treating spec docs as inert context', () => {
    const plan = planEvidenceWorkGraph({
      sources: [{ path: 'docs/harness/remaining-spec-decomposition-inventory.md', content: narrativeRemainingInventoryEvidence }],
      existingTasks: [],
    })

    expect(plan.tasks.filter(task => task.kind === 'implementation')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: 'Implement dialogue-and-character-voice reviewer lane',
          targetArea: 'coherence',
        }),
        expect.objectContaining({
          title: 'Implement scene-and-chapter-intelligence reviewer lane',
          targetArea: 'coherence',
        }),
      ]),
    )
  })

  it('keeps later-stage inventory recommendations out of the current task graph when a roadmap names the active milestone stage', () => {
    const plan = planEvidenceWorkGraph({
      sources: [
        { path: 'docs/harness/implementation-roadmap.md', content: narrativeRoadmapEvidence },
        { path: 'docs/harness/remaining-spec-decomposition-inventory.md', content: narrativeRemainingInventoryEvidence },
      ],
      existingTasks: [],
    })

    expect(plan.tasks.map(task => task.title)).not.toEqual(
      expect.arrayContaining([
        'Implement dialogue-and-character-voice reviewer lane',
        'Implement scene-and-chapter-intelligence reviewer lane',
      ]),
    )
  })
})
