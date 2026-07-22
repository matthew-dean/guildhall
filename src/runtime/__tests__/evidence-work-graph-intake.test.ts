import { describe, expect, it } from 'vitest'

import { planEvidenceWorkGraph, type EvidenceSource } from '../evidence-work-graph-intake.js'

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

const narrativeRoadmapStageTwoEvidence = [
  '# Implementation Roadmap',
  '',
  '## Stage 2: Agent Coordination',
  '',
  'Goal: connect the prototype runner to actual writer and editor flows with deterministic review contracts.',
  '',
  'Deliverables:',
  '- Mastra workflow for the prototype iteration loop',
  '- packet-builder implementation for the first writer/editor packet types',
  '- deterministic retrieval tools over structured story records',
  '- specialist editor agent calls for the first review lanes',
].join('\n')

const loomaComponentSource: EvidenceSource = {
  path: 'looma/docs/component-library-audit.md',
  content: loomaComponentEvidence,
  workShapes: { Dialog: 'ui-component', AlertDialog: 'ui-component', Drawer: 'ui-component' },
  statusHints: { Dialog: 'shipped', AlertDialog: 'missing', Drawer: 'missing' },
  producedArtifacts: { Dialog: 'ui-dialog', AlertDialog: 'ui-alert-dialog', Drawer: 'ui-drawer' },
  buildsOn: {
    AlertDialog: ['Dialog', 'Button'],
    Drawer: ['Dialog', 'overlay manager'],
  },
  consumerSurfaces: {
    AlertDialog: ['Knit destructive confirmation flow'],
    Drawer: ['Knit mobile navigation drawer'],
  },
}

const compliancePipelineSource: EvidenceSource = {
  path: 'docs/data-retention-launch-plan.md',
  content: compliancePipelineEvidence,
  workShapes: {
    'Retention policy schema': 'migration',
    'Retention worker': 'backend-api',
    'Audit export API': 'backend-api',
    'Compliance dashboard integration': 'frontend-integration',
  },
  statusHints: {
    'Retention policy schema': 'missing',
    'Retention worker': 'missing',
    'Audit export API': 'missing',
    'Compliance dashboard integration': 'missing',
  },
  producedArtifacts: {
    'Retention policy schema': 'retention-policy-schema',
    'Retention worker': 'retention-worker',
    'Audit export API': 'audit-export-api',
    'Compliance dashboard integration': 'compliance-dashboard',
  },
  buildsOn: {
    'Retention worker': ['Retention policy schema', 'audit-event cursor'],
    'Audit export API': ['audit-event query service'],
    'Compliance dashboard integration': ['Audit export API', 'Retention worker'],
  },
  consumerSurfaces: {
    'Retention worker': ['Operations runbook'],
    'Audit export API': ['Compliance dashboard'],
    'Compliance dashboard integration': ['Admin settings page'],
  },
  targetAreas: { 'Compliance dashboard integration': 'Admin settings page' },
}

const releaseMatrixSource: EvidenceSource = {
  path: 'internal/fixtures/release-proof-matrix/component-consumer/plan.md',
  content: releaseMatrixEvidence,
  workShapes: {
    'AlertDialog primitive': 'ui-component',
    'Comment endpoint': 'backend-api',
    'Inspect json output': 'cli-tool',
    'Quick start install warning': 'docs',
    'Archived at migration': 'migration',
    'Summary duplicate row bugfix': 'bugfix',
    'Settings footer copy': 'single-edit',
  },
  statusHints: {
    'AlertDialog primitive': 'missing',
    'Comment endpoint': 'missing',
    'Inspect json output': 'missing',
    'Quick start install warning': 'missing',
    'Archived at migration': 'missing',
    'Summary duplicate row bugfix': 'missing',
    'Settings footer copy': 'missing',
  },
  producedArtifacts: {
    'AlertDialog primitive': 'alert-dialog',
    'Comment endpoint': 'comment-endpoint',
    'Inspect json output': 'inspect-json',
    'Quick start install warning': 'quick-start-warning',
    'Archived at migration': 'archived-at',
    'Summary duplicate row bugfix': 'summary-duplicate-fix',
    'Settings footer copy': 'settings-footer-copy',
  },
  targetAreas: {
    'AlertDialog primitive': 'component-consumer',
    'Comment endpoint': 'backend-api',
    'Inspect json output': 'backend-api',
    'Quick start install warning': 'backend-api',
    'Archived at migration': 'backend-api',
    'Summary duplicate row bugfix': 'backend-api',
    'Settings footer copy': 'backend-api',
  },
  consumerSurfaces: { 'AlertDialog primitive': ['demo app destructive action'] },
}

const narrativeRoadmapSource: EvidenceSource = {
  path: 'docs/harness/implementation-roadmap.md',
  content: narrativeRoadmapEvidence,
  workShapes: {
    'Define fixture, expected-record, prototype-run, and evaluation schemas.': 'generic',
    'Add the first tiny fiction fixture and human-authored expected records.': 'generic',
    'Implement a no-UI runner that builds a packet from fixture records.': 'cli-tool',
    'Add deterministic evaluation output that reports missing, noisy, stale, and useful context.': 'generic',
    'Generate a developer-readable debug report for each run.': 'docs',
    'Use the first run to narrow the MVP story-memory schema.': 'generic',
  },
  statusHints: {
    'Define fixture, expected-record, prototype-run, and evaluation schemas.': 'missing',
    'Add the first tiny fiction fixture and human-authored expected records.': 'missing',
    'Implement a no-UI runner that builds a packet from fixture records.': 'missing',
    'Add deterministic evaluation output that reports missing, noisy, stale, and useful context.': 'missing',
    'Generate a developer-readable debug report for each run.': 'missing',
    'Use the first run to narrow the MVP story-memory schema.': 'missing',
  },
  buildsOn: {
    'Define fixture, expected-record, prototype-run, and evaluation schemas.': ['Stage 1'],
    'Add the first tiny fiction fixture and human-authored expected records.': ['Define fixture, expected-record, prototype-run, and evaluation schemas.'],
    'Implement a no-UI runner that builds a packet from fixture records.': ['Add the first tiny fiction fixture and human-authored expected records.'],
    'Add deterministic evaluation output that reports missing, noisy, stale, and useful context.': ['Implement a no-UI runner that builds a packet from fixture records.'],
    'Generate a developer-readable debug report for each run.': ['Add deterministic evaluation output that reports missing, noisy, stale, and useful context.'],
    'Use the first run to narrow the MVP story-memory schema.': ['Generate a developer-readable debug report for each run.'],
  },
}

describe('evidence-to-work-graph intake', () => {
  it('keeps graph identity and routing stable when source prose is rewritten', () => {
    const first = planEvidenceWorkGraph({
      sources: [{
        path: 'docs/harness/release-plan.md',
        content: '| Deliverable | Need | Foundation | Consumer |\n| --- | --- | --- | --- |\n| Writer packet | Build the bounded packet. | Story records | Draft runner |',
        unitIdentities: { 'Writer packet': 'nh/release/writer-packet' },
        workShapes: { 'Writer packet': 'generic' },
        statusHints: { 'Writer packet': 'missing' },
        producedArtifacts: { 'Writer packet': 'writer-packet' },
        consumerSurfaces: { 'Writer packet': ['Draft runner'] },
      }],
    })
    const rewritten = planEvidenceWorkGraph({
      sources: [{
        path: 'docs/harness/release-plan.md',
        content: '| Deliverable | Need | Foundation | Consumer |\n| --- | --- | --- | --- |\n| Constrained context envelope | Assemble the context envelope. | Story records | Draft runner |',
        unitIdentities: { 'Constrained context envelope': 'nh/release/writer-packet' },
        workShapes: { 'Constrained context envelope': 'generic' },
        statusHints: { 'Constrained context envelope': 'missing' },
        producedArtifacts: { 'Constrained context envelope': 'writer-packet' },
        consumerSurfaces: { 'Constrained context envelope': ['Draft runner'] },
      }],
    })
    const durable = (plan: ReturnType<typeof planEvidenceWorkGraph>) => plan.tasks.map(task => ({
      id: task.id,
      sourceIdentity: task.sourceIdentity,
      kind: task.kind,
      workShape: task.workShape,
      statusHint: task.statusHint,
      targetArea: task.targetArea,
      producedArtifact: task.producedArtifact,
      buildsOn: task.buildsOn,
      dependsOn: task.dependsOn,
      consumerSurface: task.consumerSurface,
    }))

    expect(durable(rewritten)).toEqual(durable(first))
    expect(rewritten.tasks.map(task => task.title)).not.toEqual(first.tasks.map(task => task.title))
  })

  it('extracts deliverable units from source evidence instead of flattening them into one vague task', () => {
    const plan = planEvidenceWorkGraph({
      sources: [loomaComponentSource],
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
      sources: [loomaComponentSource],
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

  it('does not turn archived or shelved history into a live prerequisite', () => {
    const plan = planEvidenceWorkGraph({
      sources: [loomaComponentSource],
      existingTasks: [
        {
          id: 'task-dialog-foundation',
          title: 'Build Dialog primitive',
          status: 'archived',
          deliverableName: 'Dialog',
          producedArtifact: 'ui-dialog',
        },
      ],
    })

    const alertDialog = plan.tasks.find(task => task.deliverableName === 'AlertDialog' && task.kind === 'implementation')
    expect(alertDialog?.dependsOn).toEqual([])
  })

  it('never creates a self-dependency when foundation wording matches the current task', () => {
    const plan = planEvidenceWorkGraph({
      sources: [{
        path: 'docs/harness/synopsis-expansion.md',
        content: [
          '# Story records',
          '',
          '| Deliverable | Need | Foundation | Consumer |',
          '| --- | --- | --- | --- |',
          '| Synopsis expansion into story records | missing | Synopsis expansion into story records | headless runner |',
        ].join('\n'),
      }],
      existingTasks: [{
        id: 'task-synopsis-expansion',
        sourceIdentity: 'docs/harness/synopsis-expansion.md#unit:1',
        title: 'Expand synopsis into story records',
        description: 'Synopsis expansion into story records.',
        status: 'import_draft',
      }],
    })

    const task = plan.tasks.find(candidate => candidate.id === 'task-synopsis-expansion')
    expect(task?.dependsOn).toEqual([])
    expect(task?.relatedTasks).toEqual([])
  })

  it('splits reusable deliverables from consuming-product integration work', () => {
    const plan = planEvidenceWorkGraph({
      sources: [loomaComponentSource],
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
      sources: [loomaComponentSource],
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
      sources: [compliancePipelineSource],
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
    const policySchema = plan.tasks.find(task => task.deliverableName === 'Retention policy schema' && task.kind === 'implementation')

    expect(worker).toMatchObject({
      buildsOn: ['Retention policy schema', 'audit-event cursor'],
      dependsOn: [policySchema?.id],
    })
    expect(dashboard).toMatchObject({
      targetArea: 'Admin settings page',
      dependsOn: expect.arrayContaining([worker?.id, exportApi?.id]),
      consumerSurface: 'Admin settings page',
    })
  })

  it('reconciles duplicate vague tasks into the structured graph instead of creating competing work', () => {
    const plan = planEvidenceWorkGraph({
      sources: [loomaComponentSource],
      existingTasks: [
        {
          id: 'task-039',
          deliverableName: 'AlertDialog',
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
      sources: [releaseMatrixSource],
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
      sources: [{ ...releaseMatrixSource, path: 'internal/fixtures/release-proof-matrix/backend-api/plan.md' }],
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
      sources: [narrativeRoadmapSource],
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
    const secondTask = plan.tasks.find(task => task.title === 'Add the first tiny fiction fixture and human-authored expected records.')
    const thirdTask = plan.tasks.find(task => task.title === 'Implement a no-UI runner that builds a packet from fixture records.')
    const sixthTask = plan.tasks.find(task => task.title === 'Use the first run to narrow the MVP story-memory schema.')
    expect(firstTask?.buildsOn).toEqual(['Stage 1'])
    expect(firstTask?.dependsOn).toEqual([])
    expect(secondTask?.dependsOn).toEqual([firstTask?.id])
    expect(thirdTask?.dependsOn).toEqual([secondTask?.id])
    expect(sixthTask?.dependsOn).toHaveLength(1)
    expect(sixthTask?.relatedTasks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        relationship: 'blocks',
        reason: expect.stringContaining('builds on'),
      }),
    ]))
    expect(plan.tasks.every(task => task.kind === 'implementation')).toBe(true)
  })

  it('does not fold indented completion annotations into current milestone task titles', () => {
    const plan = planEvidenceWorkGraph({
      sources: [{
        path: 'docs/harness/implementation-roadmap.md',
        content: [
          '# Implementation Roadmap',
          '',
          '## Stage 1: Fixture And Evaluation Harness',
          '',
          '## Current Next Milestone',
          '',
          'The next milestone is Stage 1: Fixture And Evaluation Harness.',
          '',
          '1. Use the first run to narrow the MVP story-memory schema.',
          '   ✓ Completed — see [mvp-story-memory-schema-narrowing.md](../specs/mvp-story-memory-schema-narrowing.md)',
          '     and the updated [schema-contract-roadmap.md](../specs/schema-contract-roadmap.md#mvp-contract-boundary).',
        ].join('\n'),
      }],
      existingTasks: [],
    })

    expect(plan.tasks.filter(task => task.kind === 'implementation').map(task => task.title)).toEqual([
      'Use the first run to narrow the MVP story-memory schema.',
    ])
    expect(JSON.stringify(plan.tasks)).not.toContain('Completed')
  })

  it('keeps decomposition recommendations out of executable work', () => {
    const plan = planEvidenceWorkGraph({
      sources: [{ path: 'docs/harness/remaining-spec-decomposition-inventory.md', content: narrativeRemainingInventoryEvidence }],
      existingTasks: [],
    })

    expect(plan.tasks).toEqual([])
  })

  it('does not turn roadmap-stage deliverables into implementation work without an explicit starter-task or recommendation layer', () => {
    const plan = planEvidenceWorkGraph({
      sources: [{ path: 'docs/harness/implementation-roadmap.md', content: narrativeRoadmapStageTwoEvidence }],
      existingTasks: [],
    })

    expect(plan.units).toEqual([])
    expect(plan.tasks).toEqual([])
    expect(plan.suppressedTaskTitles).toEqual([
      'Mastra workflow for the prototype iteration loop',
      'packet-builder implementation for the first writer/editor packet types',
      'deterministic retrieval tools over structured story records',
      'specialist editor agent calls for the first review lanes',
    ])
  })

  it('does not turn markdown-decorated recommendations into work', () => {
    const plan = planEvidenceWorkGraph({
      sources: [{
        path: 'docs/harness/remaining-spec-decomposition-inventory.md',
        content: [
          '# Remaining Spec Decomposition Inventory',
          '',
          '### 2.8 `story-intelligence-overview.md`',
          '',
          '- **Recommended first task title:** *(none — umbrella doc, covered by child specs)*',
          '- **Recommended domain:** *(none)*',
          '- **Stage alignment:** Stage 2 (Agent Coordination)',
          '',
          '### 2.9 `dialogue-and-character-voice.md`',
          '',
          '- **Recommended first task title:** Implement dialogue-and-character-voice reviewer lane',
          '- **Recommended domain:** coherence',
          '- **Stage alignment:** Stage 2 (Agent Coordination)',
        ].join('\n'),
      }],
      existingTasks: [],
    })

    expect(plan.tasks).toEqual([])
  })

  it('does not recreate resolved or unresolved inventory recommendations as current work', () => {
    const plan = planEvidenceWorkGraph({
      sources: [{
        path: 'docs/harness/remaining-spec-decomposition-inventory.md',
        content: [
          '# Remaining Spec Decomposition Inventory',
          '',
          '### 2.3 `editor-writer-feedback-chain.md`',
          '',
          '- **Why not decomposed yet:** ~~Requires feedback-weight types first.~~ **RESOLVED** — Source-backed contract surface implemented at `src/harness/editor-writer-feedback-chain.ts`.',
          '- **Recommended first task title:** ~~Implement editor-writer feedback chain contract and weighted-feedback pipeline~~ **DONE** — contract surface recovered as `src/harness/editor-writer-feedback-chain.ts`',
          '- **Recommended domain:** harness',
          '- **Stage alignment:** Stage 2 (Agent Coordination)',
          '',
          '### 2.7 `scene-and-chapter-intelligence.md`',
          '',
          '- **Recommended first task title:** Implement scene-and-chapter-intelligence reviewer lane',
          '- **Recommended domain:** coherence',
          '- **Stage alignment:** Stage 2 (Agent Coordination)',
        ].join('\n'),
      }],
      existingTasks: [],
    })

    expect(plan.tasks).toEqual([])
    expect(JSON.stringify(plan.tasks)).not.toContain('contract surface recovered')
  })

  it('does not use recommendation prose to recreate ready source-backed tasks', () => {
    const plan = planEvidenceWorkGraph({
      sources: [{ path: 'docs/harness/remaining-spec-decomposition-inventory.md', content: narrativeRemainingInventoryEvidence }],
      existingTasks: [{
        id: 'task-import-lho60m',
        deliverableName: 'Implement dialogue-and-character-voice reviewer lane',
        title: 'Implement dialogue-and-character-voice reviewer lane',
        status: 'ready',
        description: 'Implement the source-backed reviewer lane.',
        references: ['docs/harness/remaining-spec-decomposition-inventory.md', 'docs/specs/dialogue-and-character-voice.md'],
        acceptanceCriteria: [{ id: 'source-implementation', description: 'The lane is implemented.', verifiedBy: 'review' }],
        productBrief: {
          userJob: 'Prove the dialogue reviewer lane from docs.',
          whyItMattersNow: 'The current scope needs source-backed reviewer proof.',
          successMetric: 'The reviewer lane follows the cited spec.',
        },
        spec: '## What this is\nA source-backed implementation spec.',
        proofPaths: [{ kind: 'review', expectedEvidence: ['Spec evidence is attached.'] }],
      }],
    })

    expect(plan.tasks.map(task => task.title)).not.toContain('Implement dialogue-and-character-voice reviewer lane')
    expect(plan.reconciliations).toEqual([])
    expect(plan.tasks).toEqual([])
  })

  it('generates proof evidence expectations about completed work, not proof-planning meta-work', () => {
    const plan = planEvidenceWorkGraph({
      sources: [{ path: 'docs/harness/remaining-spec-decomposition-inventory.md', content: narrativeRemainingInventoryEvidence }],
      existingTasks: [],
    })

    const evidenceText = plan.tasks
      .flatMap(task => task.proofPaths.flatMap(path => path.expectedEvidence ?? []))
      .join('\n')

    expect(evidenceText).not.toMatch(/\bproof plan\b/i)
    expect(evidenceText).not.toMatch(/\breuses\b/i)
    expect(evidenceText).toBe('')
  })

  it('keeps later-stage inventory recommendations out of the MVP task graph', () => {
    const plan = planEvidenceWorkGraph({
      sources: [
        narrativeRoadmapSource,
        { path: 'docs/harness/remaining-spec-decomposition-inventory.md', content: narrativeRemainingInventoryEvidence },
      ],
      existingTasks: [],
    })

    expect(plan.tasks.map(task => task.title)).not.toEqual(expect.arrayContaining([
      'Implement dialogue-and-character-voice reviewer lane',
      'Implement scene-and-chapter-intelligence reviewer lane',
    ]))
    const milestoneTerminal = plan.tasks.find(task => task.title === 'Use the first run to narrow the MVP story-memory schema.')
    const dialogue = plan.tasks.find(task => task.title === 'Implement dialogue-and-character-voice reviewer lane')
    expect(milestoneTerminal).toBeDefined()
    expect(dialogue).toBeUndefined()
  })

  it('suppresses coarse later-stage roadmap deliverable bullets when a current milestone already has decomposed spec tasks', () => {
    const plan = planEvidenceWorkGraph({
      sources: [
        narrativeRoadmapSource,
        { path: 'docs/harness/stage-two-roadmap.md', content: narrativeRoadmapStageTwoEvidence },
        { path: 'docs/harness/remaining-spec-decomposition-inventory.md', content: narrativeRemainingInventoryEvidence },
      ],
      existingTasks: [],
    })

    expect(plan.tasks.map(task => task.title)).toEqual(expect.arrayContaining([
      'Define fixture, expected-record, prototype-run, and evaluation schemas.',
    ]))
    expect(plan.tasks.map(task => task.title)).not.toEqual(expect.arrayContaining([
      'Implement dialogue-and-character-voice reviewer lane',
      'Implement scene-and-chapter-intelligence reviewer lane',
    ]))
    expect(plan.tasks.map(task => task.title)).not.toEqual(expect.arrayContaining([
      'Mastra workflow for the prototype iteration loop',
      'packet-builder implementation for the first writer/editor packet types',
      'deterministic retrieval tools over structured story records',
      'specialist editor agent calls for the first review lanes',
    ]))
  })
})
