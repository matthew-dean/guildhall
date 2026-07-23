import { describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  writeProjectStateJsonFromMemoryDirAsync,
  writeProjectStateTextFromMemoryDirAsync,
} from '@guildhall/sessions'

import {
  applyProjectReintakeDraft,
  planProjectReintake,
  writeProjectReintakeDraft,
} from '../project-reintake.js'
import { approveSpec } from '../intake.js'
import { deriveWorkExecutionState } from '../work-execution-state.js'
import { readProjectTaskQueueForRichMutation } from '../project-state-boundary.js'

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

async function makeState(tasks: unknown[], queueExtras: Record<string, unknown> = {}) {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-reintake-'))
  const memoryDir = path.join(projectRoot, '.guildhall')
  await writeProjectStateJsonFromMemoryDirAsync(memoryDir, 'TASKS.json', {
    version: 1,
    lastUpdated: now,
    tasks,
    ...queueExtras,
  })
  await writeProjectStateTextFromMemoryDirAsync(memoryDir, 'PROGRESS.md', '# Progress\n')
  return memoryDir
}

async function readQueue(memoryDir: string): Promise<{
  tasks: Array<Record<string, any>>
  releases?: Array<Record<string, any>>
  selectedReleaseId?: string
}> {
  const queue = await readProjectTaskQueueForRichMutation(path.dirname(memoryDir))
  return queue as {
    tasks: Array<Record<string, any>>
    releases?: Array<Record<string, any>>
    selectedReleaseId?: string
  }
}

async function writeQueue(memoryDir: string, tasks: unknown[]): Promise<void> {
  await writeProjectStateJsonFromMemoryDirAsync(memoryDir, 'TASKS.json', { version: 1, lastUpdated: now, tasks })
}

const loomaAudit = [
  '# Component audit',
  '',
  '| Deliverable | Need | Foundation | Consumer |',
  '| --- | --- | --- | --- |',
  '| Dialog | shipped as `ui-dialog` | native dialog + overlay manager | Knit BaseDialog already uses it |',
  '| AlertDialog | missing P0 gap | builds on Dialog and Button | Knit destructive confirmation flow |',
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
  '## Stage 1: Headless Drafting And Evaluation MVP',
  '',
  'Deliverables:',
  '',
  '- typed fixture and expected-record contracts',
  '- DeepInfra drafting-model selection and bakeoff proof for broad fiction genres, including legal adult fiction inside the product content boundary',
  '- world-state reviewer proof for object/property state changes over elapsed time',
  '- spatial/geographic reviewer proof for place, distance, travel time, terrain, walking speed, weather, light, and map consistency',
  '',
  '## Current Next Milestone',
  '',
  'The next milestone is Stage 1: Headless Drafting And Evaluation MVP.',
  '',
  '1. Define fixture, expected-record, prototype-run, and evaluation schemas.',
  '2. Add the first tiny fiction fixture and human-authored expected records.',
  '3. Implement a no-UI runner that builds a packet from fixture records.',
  '4. Add deterministic evaluation output for missing/noisy/stale/useful context.',
  '5. Generate a developer-readable debug report for each run.',
  '6. Use the first run to narrow the MVP story-memory schema.',
  '7. Select and prove a DeepInfra drafting model for broad-genre chapter writing.',
  '8. Add author-intent inputs for voice, genre, audience, theme, synopsis, outline, characters, character voices, world-state facts, and review plan.',
  '9. Generate a CLI-first story synopsis, outline, character/voice records, and one chapter draft from the selected model.',
  '10. Prove world-state continuity review over elapsed-time object and property changes.',
  '11. Prove spatial/geographic continuity review for travel, terrain, walking speed, map consistency, weather, light, and physical plausibility.',
].join('\n')

const narrativeRoadmapSemanticKinds = {
  'Define fixture, expected-record, prototype-run, and evaluation schemas.': 'contract',
  'Add the first tiny fiction fixture and human-authored expected records.': 'fixture',
  'Implement a no-UI runner that builds a packet from fixture records.': 'runner',
  'Add deterministic evaluation output for missing/noisy/stale/useful context.': 'evaluation',
  'Generate a developer-readable debug report for each run.': 'debug_report',
  'Use the first run to narrow the MVP story-memory schema.': 'schema_prune',
  'Select and prove a DeepInfra drafting model for broad-genre chapter writing.': 'drafting_model',
  'Add author-intent inputs for voice, genre, audience, theme, synopsis, outline, characters, character voices, world-state facts, and review plan.': 'author_intent',
  'Generate a CLI-first story synopsis, outline, character/voice records, and one chapter draft from the selected model.': 'chapter_draft',
  'Prove world-state continuity review over elapsed-time object and property changes.': 'world_state_review',
  'Prove spatial/geographic continuity review for travel, terrain, walking speed, map consistency, weather, light, and physical plausibility.': 'spatial_review',
} as const

const narrativeRoadmapContractNames = {
  'Define fixture, expected-record, prototype-run, and evaluation schemas.': [
    'FixtureManifest',
    'ExpectedRecordSet',
    'ExpectedSignal',
    'PrototypeRun',
    'RunEvaluation',
    'PacketQualityScore',
  ],
} as const

const narrativeInventorySemanticKinds = {
  'Implement dialogue-and-character-voice reviewer lane': 'reviewer_lane',
  'Implement theme-and-meaning-review reviewer lane': 'reviewer_lane',
  'Build local authoring shell': 'workflow',
  'Implement author-involvement-modes contract and involvement-dial types': 'contract',
} as const

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

const narrativeNearTermProofRoadmap = [
  '# Implementation Roadmap',
  '',
  'The near-term goal is not a polished editor. The near-term goal is to prove',
  'that story memory, packet building, editor agents, writer agents, and',
  'model/provider evaluation can improve fiction drafting without flattening',
  'author voice.',
  '',
  '## Stage 1: Fixture And Evaluation Harness',
  '',
  'Deliverables:',
  '',
  '- scripts or tests that ingest a fixture, build records, run a packet, and save',
  '  the run output',
  '',
  '## Stage 2: Mastra Agent Prototype',
  '',
  'Deliverables:',
  '',
  '- specialist editor agent calls for the first review lanes',
  '',
  '## Stage 3: Model Bakeoff And Safety Policy',
  '',
  'Deliverables:',
  '',
  '- fiction bakeoff scenarios for writer, editor, reviewer, and safety lanes',
  '',
  '## Stage 4: Local Authoring Shell',
  '',
  'Deliverables:',
  '',
  '- manuscript import or simple editor shell',
  '',
  '## Current Next Milestone',
  '',
  'The next milestone is Stage 1: Fixture And Evaluation Harness.',
  '',
  '1. Implement a no-UI runner that builds a packet from fixture records.',
].join('\n')

const narrativeRemainingInventory = [
  '# Remaining Spec Decomposition Inventory',
  '',
  '### 2.2 `dialogue-and-character-voice.md`',
  '',
  '- **Recommended first task title:** Implement dialogue-and-character-voice reviewer lane',
  '- **Recommended domain:** coherence',
  '- **Stage alignment:** Stage 2 (Agent Coordination)',
  '',
  '### 2.9 `theme-and-meaning-review.md`',
  '',
  '- **Recommended first task title:** Implement theme-and-meaning-review reviewer lane',
  '- **Recommended domain:** coherence',
  '- **Stage alignment:** Stage 3 (Reviewer Refinement)',
  '',
  '### 2.11 `local-authoring-shell.md`',
  '',
  '- **Recommended first task title:** Build local authoring shell',
  '- **Recommended domain:** app',
  '- **Stage alignment:** Stage 4 (Local Authoring Shell)',
].join('\n')

const narrativeSchemaRoadmap = [
  '# Schema Contract Roadmap',
  '',
  '## Fixture contracts',
  '',
  'Needed contracts:',
  '- `FixtureManifest`',
  '- `ExpectedRecordSet`',
  '- `ExpectedSignal`',
  '',
  '## Run contracts',
  '',
  'Needed contracts:',
  '- `PrototypeRun`',
  '- `RunEvaluation`',
  '- `PacketQualityScore`',
  '',
  '## Provider Registry Schema',
  '',
  'Needed contracts:',
  '- `ProviderRegistryEntry`',
  '- `ModelRegistryEntry`',
  '',
  'Purpose:',
  '- record provider privacy and retention claims',
  '',
  '## Schema Versioning And Migration',
  '',
  'Needed contracts:',
  '- `SchemaVersion`',
  '- `RecordVersion`',
  '',
  'Purpose:',
  '- migrate fixture data as schemas narrow',
  '',
  '## Import Export Schema',
  '',
  'Needed contracts:',
  '- `ImportManifest`',
  '- `ExportManifest`',
].join('\n')

const dialogueAndCharacterVoiceSpec = [
  '# Dialogue And Character Voice',
  '',
  '## Reviewer questions',
  '',
  '- Could the line be reassigned to another character without anyone noticing?',
  '- Does diction, rhythm, or register drift away from the speaker profile?',
  '',
  '## Finding contract',
  '',
  '- Return structured findings with character id, quote span, severity, and suggested revision direction.',
  '',
  '## Verification',
  '',
  '- Run the reviewer lane against one bounded dialogue fixture and record structured findings.',
].join('\n')

const authorInvolvementModesSpecWithoutContracts = [
  '# Author Involvement Modes',
  '',
  'Define how the author can choose light, normal, or heavy involvement before the harness applies editor feedback.',
  '',
  '## Behavior',
  '',
  '- The author can tune how much the system asks before applying a proposed change.',
  '- The harness records whether a decision was automatic, suggested, or owner-confirmed.',
  '',
  '## Verification',
  '',
  '- Run one bounded feedback scenario through each involvement mode.',
].join('\n')

describe('project re-intake apply', () => {
  it('keeps a thin source row in intake and appends a re-intake note', async () => {
    const existingTask = task({
      id: 'task-039',
      title: 'Build AlertDialog primitive',
      description: 'Old',
      status: 'blocked',
      deliverableName: 'AlertDialog',
      taskKind: 'research',
      sizePlan: { score: 5, recommendation: 'split' },
      taskReadiness: { recommendation: 'needs_research_spike' },
    })
    const memoryDir = await makeState([
      existingTask,
    ])
    const draft = planProjectReintake({
      now,
      sources: [loomaAuditSource],
      tasks: [existingTask],
    })
    await writeProjectReintakeDraft(memoryDir, draft)

    const result = await applyProjectReintakeDraft({ memoryDir, now })
    expect(result).toMatchObject({ success: true, appliedGroups: 1 })

    const queue = await readQueue(memoryDir)
    const reframed = queue.tasks.find((candidate: { id?: string }) => candidate.id === 'task-039')
    expect(reframed).toMatchObject({
      title: 'Build AlertDialog',
      status: 'import_draft',
      acceptanceCriteria: [],
    })
    expect(reframed).not.toHaveProperty('structuredSpec')
    expect(reframed).not.toHaveProperty('acceptanceCriteriaProofState')
    expect(reframed).not.toHaveProperty('taskKind')
    expect(reframed).not.toHaveProperty('sizePlan')
    expect(reframed).not.toHaveProperty('taskReadiness')
    expect(reframed!.notes.some((note: { content?: string }) => note.content?.includes('Re-intake reframed this task'))).toBe(true)
  })

  it('archives stale weak pre-implementation specs instead of carrying them forward', async () => {
    const legacyTask = task({
      id: 'task-tooltip',
      title: 'Build Tooltip primitive',
      status: 'ready',
      productBrief: {
        userJob: 'Ship Tooltip.',
        successMetric: 'Tooltip is reviewable.',
      },
      spec: '## Summary\nBuild Tooltip.\n\n## Acceptance Criteria\n- The feature is reviewable.',
      acceptanceCriteria: [{ id: 'legacy', description: 'Feature is reviewable.', verifiedBy: 'review', met: false }],
    })
    const staleChild = task({
      id: 'stale-child',
      title: 'Stale split child',
      status: 'archived',
      dependsOn: ['stale-dependency'],
      hierarchy: {
        parentId: 'task-import-9s8tkc',
        childIds: [],
        order: 0,
        relation: 'decomposes',
      },
      archivedEvidence: {
        retention: 'archive',
        archivedAt: now,
        reason: 'Old child archive marker.',
        source: 'project-reintake',
      },
    })
    const memoryDir = await makeState([legacyTask, staleChild])
    const draft = planProjectReintake({
      now,
      sources: [],
      tasks: [legacyTask, staleChild],
    })
    await writeProjectReintakeDraft(memoryDir, draft)

    const result = await applyProjectReintakeDraft({ memoryDir, now })
    expect(result.success).toBe(true)

    const queue = await readQueue(memoryDir)
    expect(queue.tasks.find((candidate: { id?: string }) => candidate.id === 'task-tooltip')).toMatchObject({
      status: 'archived',
    })
  })

  it('does not archive explicitly shaped work because a roadmap also has starter tasks', async () => {
    const legacyTask = task({
      id: 'task-deliverable',
      title: 'typed fixture and expected-record contracts',
      description: 'docs/harness/implementation-roadmap.md: - typed fixture and expected-record contracts',
      status: 'import_draft',
      spec: '## Summary\nKeep the typed fixture contract visible.\n\n## Acceptance Criteria\n1. The typed fixture contract is reviewable.',
      acceptanceCriteria: [{ id: 'typed-fixture', description: 'The typed fixture contract is reviewable.', verifiedBy: 'review' }],
      productBrief: { userJob: 'Keep the typed fixture contract visible.', successMetric: 'The typed fixture contract is reviewable.' },
      structuredSpec: { kind: 'implementation', boundary: 'typed fixture contract' },
    })
    const memoryDir = await makeState([legacyTask])
    const draft = planProjectReintake({
      now,
      sources: [{ path: 'docs/harness/implementation-roadmap.md', content: narrativeRoadmap }],
      tasks: [legacyTask],
    })
    await writeProjectReintakeDraft(memoryDir, draft)

    const result = await applyProjectReintakeDraft({ memoryDir, now })
    expect(result.success).toBe(true)

    const queue = await readQueue(memoryDir)
    expect(queue.tasks.find((candidate: { id?: string }) => candidate.id === 'task-deliverable')).not.toMatchObject({
      status: 'archived',
    })
  })

  it('does not archive wrapped explicitly shaped work because a roadmap also has starter tasks', async () => {
    const wrappedRoadmap = [
      '# Implementation Roadmap',
      '',
      '## Stage 1: Fixture And Evaluation Harness',
      '',
      'Deliverables:',
      '',
      '- scripts or tests that ingest a fixture, build records, run a packet, and save',
      '  the run output',
      '',
      '## Current Next Milestone',
      '',
      'The next milestone is Stage 1: Fixture And Evaluation Harness.',
      '',
      '1. Implement a no-UI runner that builds a packet from fixture records.',
    ].join('\n')
    const legacyTask = task({
      id: 'task-wrapped-deliverable',
      title: 'scripts or tests that ingest a fixture, build records, run a packet, and save the run output',
      description: 'docs/harness/implementation-roadmap.md: - scripts or tests that ingest a fixture, build records, run a packet, and save the run output',
      status: 'import_draft',
      spec: '## Summary\nKeep the run output contract visible.\n\n## Acceptance Criteria\n1. The run output contract is reviewable.',
      acceptanceCriteria: [{ id: 'run-output', description: 'The run output contract is reviewable.', verifiedBy: 'review' }],
      productBrief: { userJob: 'Keep the run output contract visible.', successMetric: 'The run output contract is reviewable.' },
      structuredSpec: { kind: 'implementation', boundary: 'run output contract' },
    })
    const memoryDir = await makeState([legacyTask])
    const draft = planProjectReintake({
      now,
      sources: [{ path: 'docs/harness/implementation-roadmap.md', content: wrappedRoadmap }],
      tasks: [legacyTask],
    })
    await writeProjectReintakeDraft(memoryDir, draft)

    const result = await applyProjectReintakeDraft({ memoryDir, now })
    expect(result.success).toBe(true)

    const queue = await readQueue(memoryDir)
    expect(queue.tasks.find((candidate: { id?: string }) => candidate.id === 'task-wrapped-deliverable')).not.toMatchObject({
      status: 'archived',
    })
  })

  it('persists current release scope, later work, and source refs when applying Narrative Harness re-intake', async () => {
    const memoryDir = await makeState([])
    const projectPath = path.dirname(memoryDir)
    await fs.mkdir(path.join(projectPath, 'docs', 'harness'), { recursive: true })
    await fs.writeFile(path.join(projectPath, 'docs', 'harness', 'implementation-roadmap.md'), narrativeRoadmap, 'utf8')
    await fs.writeFile(path.join(projectPath, 'docs', 'harness', 'remaining-spec-decomposition-inventory.md'), narrativeRemainingInventory, 'utf8')
    const draft = planProjectReintake({
      now,
      projectPath,
      sources: [
        {
          path: 'docs/harness/implementation-roadmap.md',
          content: narrativeRoadmap,
          semanticKinds: narrativeRoadmapSemanticKinds,
          contractNames: narrativeRoadmapContractNames,
        },
        { path: 'docs/harness/remaining-spec-decomposition-inventory.md', content: narrativeRemainingInventory },
      ],
      tasks: [],
    })
    await writeProjectReintakeDraft(memoryDir, draft)

    const result = await applyProjectReintakeDraft({ memoryDir, now })
    expect(result.success).toBe(true)

    const queue = await readQueue(memoryDir) as {
      selectedReleaseId?: string
      releases?: Array<{ id: string; label: string; nodeIds?: string[]; deferredNodeIds?: string[] }>
      tasks: Array<Record<string, any>>
    }
    const taskByTitle = (title: string) => queue.tasks.find(task =>
      String(task.title ?? '').replace(/\.$/, '') === title.replace(/\.$/, ''),
    )
    const currentTask = taskByTitle('Define fixture, expected-record, prototype-run, and evaluation schemas.')
      ?? queue.tasks.find(task => String(task.id ?? '').includes('define-fixture-expected-record-prototype-run-and-evaluation'))
    const fixtureTask = taskByTitle('Add the first tiny fiction fixture and human-authored expected records.')
    const runnerTask = taskByTitle('Implement a no-UI runner that builds a packet from fixture records.')
    const evaluationTask = taskByTitle('Add deterministic evaluation output for missing/noisy/stale/useful context.')
    const debugTask = taskByTitle('Generate a developer-readable debug report for each run.')
    const schemaPruneTask = taskByTitle('Use the first run to narrow the MVP story-memory schema.')
    const deepinfraTask = taskByTitle('Select and prove a DeepInfra drafting model for broad-genre chapter writing.')
    const authorIntentTask = taskByTitle('Add author-intent inputs for voice, genre, audience, theme, synopsis, outline, characters, character voices, world-state facts, and review plan.')
    const chapterDraftTask = taskByTitle('Generate a CLI-first story synopsis, outline, character/voice records, and one chapter draft from the selected model.')
    const worldStateTask = taskByTitle('Prove world-state continuity review over elapsed-time object and property changes.')
    const spatialTask = taskByTitle('Prove spatial/geographic continuity review for travel, terrain, walking speed, map consistency, weather, light, and physical plausibility.')
    const laterTask = queue.tasks.find(task => task.title === 'Implement dialogue-and-character-voice reviewer lane')

    expect(queue.selectedReleaseId).toBe('stage-1-headless-drafting-and-evaluation-mvp')
    expect(queue.releases).toEqual([
      expect.objectContaining({
        id: 'stage-1-headless-drafting-and-evaluation-mvp',
        label: 'Stage 1: Headless Drafting And Evaluation MVP',
        nodeIds: expect.arrayContaining([
          `work:${deepinfraTask?.id}`,
          `work:${worldStateTask?.id}`,
          `work:${spatialTask?.id}`,
        ]),
        deferredNodeIds: [],
      }),
    ])
    expect(currentTask).toMatchObject({
      releaseIds: ['stage-1-headless-drafting-and-evaluation-mvp'],
      references: ['docs/harness/implementation-roadmap.md'],
    })
    expect(fixtureTask).toMatchObject({
      releaseIds: ['stage-1-headless-drafting-and-evaluation-mvp'],
      status: 'spec_review',
      acceptanceCriteria: [
        expect.objectContaining({ id: 'fiction-fixture-source' }),
        expect.objectContaining({ id: 'human-expected-records' }),
        expect.objectContaining({ id: 'fixture-load-proof' }),
      ],
    })
    expect(runnerTask).toMatchObject({
      releaseIds: ['stage-1-headless-drafting-and-evaluation-mvp'],
      status: 'spec_review',
      acceptanceCriteria: [
        expect.objectContaining({ id: 'fixture-packet-build' }),
        expect.objectContaining({ id: 'no-ui-command' }),
        expect.objectContaining({ id: 'deterministic-run-record' }),
      ],
    })
    expect(evaluationTask).toMatchObject({
      releaseIds: ['stage-1-headless-drafting-and-evaluation-mvp'],
      status: 'spec_review',
      acceptanceCriteria: [
        expect.objectContaining({ id: 'packet-quality-categories' }),
        expect.objectContaining({ id: 'repeatable-evaluation-record' }),
        expect.objectContaining({ id: 'reviewer-readable-failures' }),
      ],
    })
    expect(debugTask).toMatchObject({
      releaseIds: ['stage-1-headless-drafting-and-evaluation-mvp'],
      status: 'spec_review',
      acceptanceCriteria: [
        expect.objectContaining({ id: 'debug-report-inputs' }),
        expect.objectContaining({ id: 'debug-report-traceability' }),
        expect.objectContaining({ id: 'debug-report-local-artifact' }),
      ],
    })
    expect(JSON.stringify(debugTask?.acceptanceCriteria ?? '')).not.toMatch(/accessibility|design-system|target-area conventions/i)
    for (const task of [fixtureTask, runnerTask, evaluationTask, debugTask]) {
      expect(task?.spec ?? '').not.toContain('Define and use the concrete contracts named in the cited docs')
    }
    expect(schemaPruneTask).toMatchObject({
      releaseIds: ['stage-1-headless-drafting-and-evaluation-mvp'],
      status: 'spec_review',
      acceptanceCriteria: [
        expect.objectContaining({ id: 'first-run-schema-findings' }),
        expect.objectContaining({ id: 'schema-narrowing-decision' }),
        expect.objectContaining({ id: 'schema-proof-update' }),
      ],
    })
    expect(JSON.stringify(schemaPruneTask?.acceptanceCriteria ?? '')).not.toMatch(/migration|rollback/i)
    expect(deepinfraTask).toMatchObject({
      releaseIds: ['stage-1-headless-drafting-and-evaluation-mvp'],
      status: 'spec_review',
      acceptanceCriteria: [
        expect.objectContaining({ id: 'deepinfra-model-candidate' }),
        expect.objectContaining({ id: 'broad-genre-drafting-proof' }),
        expect.objectContaining({ id: 'drafting-failure-telemetry' }),
      ],
    })
    expect(authorIntentTask).toMatchObject({
      releaseIds: ['stage-1-headless-drafting-and-evaluation-mvp'],
      status: 'spec_review',
      acceptanceCriteria: [
        expect.objectContaining({ id: 'author-intent-records' }),
        expect.objectContaining({ id: 'intent-to-packet-proof' }),
        expect.objectContaining({ id: 'content-boundary-input' }),
      ],
    })
    expect(chapterDraftTask).toMatchObject({
      releaseIds: ['stage-1-headless-drafting-and-evaluation-mvp'],
      status: 'spec_review',
      acceptanceCriteria: [
        expect.objectContaining({ id: 'synopsis-to-outline-chain' }),
        expect.objectContaining({ id: 'chapter-draft-command' }),
        expect.objectContaining({ id: 'author-voice-preservation' }),
      ],
    })
    expect(worldStateTask).toMatchObject({
      releaseIds: ['stage-1-headless-drafting-and-evaluation-mvp'],
      status: 'spec_review',
      acceptanceCriteria: [
        expect.objectContaining({ id: 'elapsed-time-state-transitions' }),
        expect.objectContaining({ id: 'world-state-finding-shape' }),
        expect.objectContaining({ id: 'world-rule-exceptions' }),
      ],
    })
    expect(spatialTask).toMatchObject({
      releaseIds: ['stage-1-headless-drafting-and-evaluation-mvp'],
      status: 'spec_review',
      acceptanceCriteria: [
        expect.objectContaining({ id: 'travel-plausibility-proof' }),
        expect.objectContaining({ id: 'genre-aware-geography' }),
        expect.objectContaining({ id: 'spatial-finding-shape' }),
      ],
    })
    expect(laterTask).toBeUndefined()

    const approval = await approveSpec({
      memoryDir,
      taskId: deepinfraTask!.id,
      approvalNote: 'Generated current-release re-intake spec is concrete enough for approval.',
    })
    expect(approval).toMatchObject({ success: true, newStatus: 'ready' })
    const approvedQueue = await readQueue(memoryDir)
    const approvedTask = approvedQueue.tasks.find(task => task.id === deepinfraTask!.id)
    expect(approvedTask?.productBrief).toMatchObject({
      approvedBy: 'human',
      approvedAt: expect.stringMatching(/\d{4}-\d{2}-\d{2}T/),
    })
    expect(JSON.stringify(approvedTask?.productBrief ?? '')).not.toContain('Do not treat this draft as approved')
    expect(approvedTask?.sizePlan?.action).toBe('proceed_with_warning')
  })

  it('treats an explicit release table as the complete membership boundary', async () => {
    const memoryDir = await makeState([
      task({
        id: 'task-in-scope',
        title: 'Build Character voice and dialogue review',
        status: 'spec_review',
        releaseIds: ['stage-1-headless-drafting-and-evaluation-mvp'],
        sourceIdentity: 'docs/harness/headless-mvp-release-plan.md#unit:1',
        deliverableName: 'Character voice and dialogue review',
      }),
      task({
        id: 'task-out-of-scope',
        title: 'Run unrelated smoke test',
        status: 'spec_review',
        releaseIds: [],
      }),
    ])
    const draft = planProjectReintake({
      now,
      sources: [{
        path: 'docs/harness/headless-mvp-release-plan.md',
        content: scopedNarrativeRelease,
        semanticKinds: { 'Character voice and dialogue review': 'reviewer_lane' },
      }],
      tasks: await readQueue(memoryDir).then(queue => queue.tasks),
    })
    expect(draft.releases?.[0]?.nodeIds).toEqual(['work:task-in-scope'])

    await writeProjectReintakeDraft(memoryDir, draft)
    const result = await applyProjectReintakeDraft({ memoryDir, now })
    expect(result.success).toBe(true)

    const queue = await readQueue(memoryDir)
    expect(queue.tasks.find(candidate => candidate.id === 'task-in-scope')?.releaseIds).toEqual([
      'stage-1-headless-drafting-and-evaluation-mvp',
    ])
    expect(queue.tasks.find(candidate => candidate.id === 'task-out-of-scope')?.releaseIds ?? []).toEqual([])
    expect((queue as any).releases).toEqual([
      expect.objectContaining({
        id: 'stage-1-headless-drafting-and-evaluation-mvp',
        nodeIds: ['work:task-in-scope'],
        deferredNodeIds: [],
      }),
    ])
  })

  it('preserves a shipped release while applying a repaired release envelope', async () => {
    const planningInstruction = 'You are repairing the project plan from current workspace evidence. First, repair the selected release and create a fresh release boundary. Use only source-backed evidence. Do not wait for approval, manufacture capabilities, or mark a release shipped without proof. The selected release must include author intent and voice input, synopsis generation, story records, context planning, broad-genre drafting model proof, chapter drafting, and review lenses. After repairing the plan, run the selected work and make the release state readable through Guildhall.'
    const oldReleaseId = 'stage-1-headless-drafting-and-evaluation-mvp'
    const memoryDir = await makeState([
      task({
        id: 'task-real-member',
        title: 'Build Character voice and dialogue review',
        status: 'spec_review',
        releaseIds: [oldReleaseId],
        sourceIdentity: 'docs/harness/headless-mvp-release-plan.md#unit:1',
        deliverableName: 'Character voice and dialogue review',
      }),
      task({
        id: 'task-planning-instruction',
        title: planningInstruction,
        status: 'spec_review',
        semanticKind: 'planning_instruction',
        releaseIds: [oldReleaseId],
      }),
    ], {
      selectedReleaseId: oldReleaseId,
      releases: [{
        id: oldReleaseId,
        label: 'Stage 1: Headless Drafting And Evaluation MVP',
        kind: 'release',
        state: 'shipped',
        source: 'release_plan',
        nodeIds: ['work:task-real-member', 'work:task-planning-instruction'],
        deferredNodeIds: [],
        proofStyle: 'script_only',
      }],
    })
    const draft = planProjectReintake({
      now,
      sources: [{
        path: 'docs/harness/headless-mvp-release-plan.md',
        content: scopedNarrativeRelease,
        unitIdentities: { 'Character voice and dialogue review': 'docs/harness/headless-mvp-release-plan.md#unit:1' },
        semanticKinds: { 'Character voice and dialogue review': 'reviewer_lane' },
        workShapes: { 'Character voice and dialogue review': 'generic' },
        statusHints: { 'Character voice and dialogue review': 'missing' },
        targetAreas: { 'Character voice and dialogue review': 'harness' },
        producedArtifacts: { 'Character voice and dialogue review': 'artifact:character-voice-dialogue-review' },
      }],
      releases: [{
        id: oldReleaseId,
        label: 'Stage 1: Headless Drafting And Evaluation MVP',
        state: 'shipped',
        nodeIds: ['work:task-real-member', 'work:task-planning-instruction'],
        deferredNodeIds: [],
      }],
      tasks: [
        task({
          id: 'task-real-member',
          title: 'Build Character voice and dialogue review',
          status: 'spec_review',
          releaseIds: [oldReleaseId],
          sourceIdentity: 'docs/harness/headless-mvp-release-plan.md#unit:1',
          deliverableName: 'Character voice and dialogue review',
        }),
        task({
          id: 'task-planning-instruction',
          title: planningInstruction,
          status: 'spec_review',
          semanticKind: 'planning_instruction',
          releaseIds: [oldReleaseId],
        }),
      ],
    })
    expect(draft.selectedReleaseId).toBe(`${oldReleaseId}-r1`)
    await writeProjectReintakeDraft(memoryDir, draft)

    const result = await applyProjectReintakeDraft({ memoryDir, now })
    expect(result).toMatchObject({ success: true })

    const queue = await readQueue(memoryDir)
    expect(queue.selectedReleaseId).toBe(`${oldReleaseId}-r1`)
    expect(queue.releases).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: oldReleaseId,
        state: 'shipped',
        nodeIds: ['work:task-real-member', 'work:task-planning-instruction'],
      }),
      expect.objectContaining({
        id: `${oldReleaseId}-r1`,
        state: 'active',
        supersedesReleaseId: oldReleaseId,
        nodeIds: ['work:task-real-member'],
      }),
    ]))
    expect(queue.tasks.find(candidate => candidate.id === 'task-real-member')?.releaseIds).toEqual([
      oldReleaseId,
      `${oldReleaseId}-r1`,
    ])
    expect(queue.tasks.find(candidate => candidate.id === 'task-planning-instruction')).toMatchObject({
      status: 'archived',
      releaseIds: [oldReleaseId],
    })
  })

  it('respects an explicit current release despite broad near-term proof prose', async () => {
    const memoryDir = await makeState([])
    const projectPath = path.dirname(memoryDir)
    await fs.mkdir(path.join(projectPath, 'docs', 'harness'), { recursive: true })
    await fs.mkdir(path.join(projectPath, 'docs', 'specs'), { recursive: true })
    await fs.writeFile(path.join(projectPath, 'docs', 'harness', 'implementation-roadmap.md'), narrativeNearTermProofRoadmap, 'utf8')
    await fs.writeFile(path.join(projectPath, 'docs', 'harness', 'remaining-spec-decomposition-inventory.md'), narrativeRemainingInventory, 'utf8')
    await fs.writeFile(path.join(projectPath, 'docs', 'specs', 'dialogue-and-character-voice.md'), dialogueAndCharacterVoiceSpec, 'utf8')
    const draft = planProjectReintake({
      now,
      projectPath,
      sources: [
        { path: 'docs/harness/implementation-roadmap.md', content: narrativeNearTermProofRoadmap },
        {
          path: 'docs/harness/remaining-spec-decomposition-inventory.md',
          content: narrativeRemainingInventory,
          semanticKinds: narrativeInventorySemanticKinds,
        },
        { path: 'docs/specs/dialogue-and-character-voice.md', content: dialogueAndCharacterVoiceSpec },
      ],
      tasks: [],
    })
    await writeProjectReintakeDraft(memoryDir, draft)

    const result = await applyProjectReintakeDraft({ memoryDir, now })
    expect(result.success).toBe(true)

    const queue = await readQueue(memoryDir) as {
      selectedReleaseId?: string
      releases?: Array<{ id: string; label: string; nodeIds?: string[]; deferredNodeIds?: string[] }>
      tasks: Array<Record<string, any>>
    }
    const runnerTask = queue.tasks.find(task => task.title === 'Implement a no-UI runner that builds a packet from fixture records.')
    const dialogueTask = queue.tasks.find(task => task.title === 'Implement dialogue-and-character-voice reviewer lane')
    const themeTask = queue.tasks.find(task => task.title === 'Implement theme-and-meaning-review reviewer lane')
    const shellTask = queue.tasks.find(task => task.title === 'Build local authoring shell')

    expect(queue.selectedReleaseId).toBe('stage-1-fixture-and-evaluation-harness')
    expect(queue.releases).toEqual([
      expect.objectContaining({
        id: 'stage-1-fixture-and-evaluation-harness',
        label: 'Stage 1: Fixture And Evaluation Harness',
        source: 'release_plan',
        nodeIds: expect.arrayContaining([
          `work:${runnerTask?.id}`,
        ]),
        deferredNodeIds: [],
      }),
    ])
    expect(dialogueTask).toBeUndefined()
    expect(themeTask).toBeUndefined()
    expect(shellTask).toBeUndefined()
  })

  it('keeps source-backed contract tasks in draft when the cited specs do not name concrete contracts', async () => {
    const memoryDir = await makeState([])
    const projectPath = path.dirname(memoryDir)
    const inventory = [
      '# Remaining Spec Decomposition Inventory',
      '',
      '### 2.6 `author-involvement-modes.md`',
      '',
      '- **Recommended first task title:** Implement author-involvement-modes contract and involvement-dial types',
      '- **Recommended domain:** workflow',
      '- **Stage alignment:** Stage 2 (Agent Coordination)',
    ].join('\n')
    const draft = planProjectReintake({
      now,
      projectPath,
      sources: [
        { path: 'docs/harness/implementation-roadmap.md', content: narrativeNearTermProofRoadmap },
        {
          path: 'docs/harness/remaining-spec-decomposition-inventory.md',
          content: inventory,
          semanticKinds: { 'Implement author-involvement-modes contract and involvement-dial types': 'contract' },
        },
        { path: 'docs/specs/author-involvement-modes.md', content: authorInvolvementModesSpecWithoutContracts },
      ],
      tasks: [],
    })
    await writeProjectReintakeDraft(memoryDir, draft)

    const result = await applyProjectReintakeDraft({ memoryDir, now })
    expect(result.success).toBe(true)

    const queue = await readQueue(memoryDir)
    const task = queue.tasks.find(task =>
      task.title === 'Implement author-involvement-modes contract and involvement-dial types',
    )
    expect(task).toBeUndefined()
  })

  it('archives stale resolved contract recovery tasks instead of keeping them as current blockers', async () => {
    const staleResolvedTitle = 'Recover source-backed contract surface for ~~Implement editor-writer feedback chain contract and weighted-feedback pipeline~~ **DONE** — contract surface recovered as src/harness/editor-writer-feedback-chain.ts'
    const memoryDir = await makeState([
      task({
        id: 'task-resolved-recovery',
        title: staleResolvedTitle,
        description: 'Original imported title: ~~Implement editor-writer feedback chain contract and weighted-feedback pipeline~~ **DONE** — contract surface recovered as src/harness/editor-writer-feedback-chain.ts',
        status: 'import_draft',
        references: ['docs/harness/remaining-spec-decomposition-inventory.md'],
        releaseIds: ['near-term-proof-scope'],
        spec: '## Verification\n- Define contracts named in the cited docs: .',
        doneSummaryBundle: {
          taskId: 'task-resolved-recovery',
          status: 'done',
          completedAt: now,
          summary: { journey: 'Recovered the contract surface.', decision: 'Keep the recovered artifact.', evidence: 'typed completion record', learningCandidates: [], openResidue: '' },
          retention: { transcriptPrimaryArtifact: false, compactedFullTranscript: true, fullEvidenceAvailable: true },
          evidenceRefs: [],
          createdAt: now,
          createdBy: 'test',
        },
      }),
    ])
    const projectPath = path.dirname(memoryDir)
    const draft = planProjectReintake({
      now,
      projectPath,
      sources: [
        { path: 'docs/harness/implementation-roadmap.md', content: narrativeNearTermProofRoadmap },
      ],
      tasks: [
        task({
          id: 'task-resolved-recovery',
          title: staleResolvedTitle,
          description: 'Original imported title: ~~Implement editor-writer feedback chain contract and weighted-feedback pipeline~~ **DONE** — contract surface recovered as src/harness/editor-writer-feedback-chain.ts',
          status: 'import_draft',
          references: ['docs/harness/remaining-spec-decomposition-inventory.md'],
          releaseIds: ['near-term-proof-scope'],
          spec: '## Verification\n- Define contracts named in the cited docs: .',
          doneSummaryBundle: {
            taskId: 'task-resolved-recovery',
            status: 'done',
            completedAt: now,
            summary: { journey: 'Recovered the contract surface.', decision: 'Keep the recovered artifact.', evidence: 'typed completion record', learningCandidates: [], openResidue: '' },
            retention: { transcriptPrimaryArtifact: false, compactedFullTranscript: true, fullEvidenceAvailable: true },
            evidenceRefs: [],
            createdAt: now,
            createdBy: 'test',
          },
        }),
      ],
    })
    await writeProjectReintakeDraft(memoryDir, draft)

    const result = await applyProjectReintakeDraft({ memoryDir, now })
    expect(result.success).toBe(true)

    const queue = await readQueue(memoryDir)
    expect(queue.tasks.find(task => task.id === 'task-resolved-recovery')).toMatchObject({
      status: 'archived',
    })
  })

  it('repairs stale imported task project paths back to the project root', async () => {
    const memoryDir = await makeState([
      task({
        id: 'task-hollow-contract',
        title: 'Implement author-involvement-modes contract and involvement-dial types',
        semanticKind: 'contract',
        description: 'Imported from Narrative Harness docs.',
        projectPath: '/workspace/docs/harness',
        status: 'spec_review',
        references: ['docs/harness/remaining-spec-decomposition-inventory.md'],
        spec: '## Verification\n- Define contracts named in the cited docs: .',
      }),
    ])
    const projectPath = path.dirname(memoryDir)
    const draft = planProjectReintake({
      now,
      projectPath,
      sources: [],
      tasks: [
        task({
          id: 'task-hollow-contract',
          title: 'Implement author-involvement-modes contract and involvement-dial types',
          semanticKind: 'contract',
          description: 'Imported from Narrative Harness docs.',
          projectPath: '/workspace/docs/harness',
          status: 'spec_review',
          references: ['docs/harness/remaining-spec-decomposition-inventory.md'],
          spec: '## Verification\n- Define contracts named in the cited docs: .',
        }),
      ],
    })
    await writeProjectReintakeDraft(memoryDir, draft)

    const result = await applyProjectReintakeDraft({ memoryDir, now })
    expect(result.success).toBe(true)

    const queue = await readQueue(memoryDir)
    expect(queue.tasks.find(task => task.id === 'task-hollow-contract')).toMatchObject({
      status: 'import_draft',
      projectPath,
      taskReadiness: expect.objectContaining({ recommendation: 'needs_research_spike' }),
    })
  })

  it('replaces stale not-started task content when the regenerated source-truth task keeps the same deterministic id', async () => {
    const legacyTask = task({
      id: 'task-import-9s8tkc',
      title: 'Define fixture, expected-record, prototype-run, and evaluation schemas.',
      sourceIdentity: 'docs/harness/implementation-roadmap.md#unit:1',
      deliverableName: 'Define fixture, expected-record, prototype-run, and evaluation schemas.',
      semanticKind: 'contract',
      status: 'spec_review',
      spec: [
        '## What this is',
        'Define fixture, expected-record, prototype-run, and evaluation schemas.',
        '',
        '## Goals',
        '- Define and use stale historical ids: `coherence-reviewer-mvp`, `decision-trace-pipeline`, `done`.',
      ].join('\n'),
      acceptanceCriteria: [{
        id: 'stale-contracts',
        description: 'Use `coherence-reviewer-mvp`, `decision-trace-pipeline`, and `done`.',
        verifiedBy: 'review',
        met: false,
      }],
      definitionOfDone: {
        items: ['Define `coherence-reviewer-mvp`, `decision-trace-pipeline`, and `done`.'],
        evidenceRequired: ['Old proof requirement.'],
      },
      workUnitAnalysis: {
        summary: 'Old split model',
        units: [{
          id: 'old-contracts',
          title: 'Define old historical contract ids',
          deliverable: 'Code defines `coherence-reviewer-mvp` and `decision-trace-pipeline`.',
        }],
      },
      taskReadiness: {
        recommendation: 'needs_one_question',
        summary: 'Old readiness',
        definitionOfDone: {
          items: ['`coherence-reviewer-mvp` is done.'],
          evidenceRequired: [],
        },
      },
      decomposition: {
        action: 'ask_one_question',
        reasons: [{ code: 'old', detail: 'Old split required.' }],
      },
      hierarchy: {
        childIds: ['stale-child'],
        order: 0,
        relation: 'contains',
      },
      archivedEvidence: {
        retention: 'archive',
        archivedAt: now,
        reason: 'Old archive marker.',
        source: 'project-reintake',
      },
    })
    const staleChild = task({
      id: 'stale-child',
      title: 'Define old historical contract ids',
      status: 'exploring',
      releaseIds: ['stage-1-fixture-and-evaluation-harness'],
      hierarchy: {
        parentId: 'task-import-9s8tkc',
        order: 0,
        relation: 'part_of',
      },
    })
    const memoryDir = await makeState([legacyTask, staleChild])
    const draft = planProjectReintake({
      now,
      sources: [
        {
          path: 'docs/harness/implementation-roadmap.md',
          content: narrativeRoadmap,
          semanticKinds: narrativeRoadmapSemanticKinds,
          contractNames: narrativeRoadmapContractNames,
        },
        { path: 'docs/specs/schema-contract-roadmap.md', content: narrativeSchemaRoadmap },
      ],
      tasks: [legacyTask, staleChild],
    })
    await writeProjectReintakeDraft(memoryDir, draft)

    const result = await applyProjectReintakeDraft({ memoryDir, now })
    expect(result.success).toBe(true)

    const queue = await readQueue(memoryDir)
    const refreshed = queue.tasks.find(task => task.id === 'task-import-9s8tkc')
    expect(refreshed).toMatchObject({
      title: 'Define fixture, expected-record, prototype-run, and evaluation schemas.',
      status: 'spec_review',
      references: ['docs/harness/implementation-roadmap.md', 'docs/specs/schema-contract-roadmap.md'],
      productBrief: expect.objectContaining({
        authoredBy: 'project-reintake',
        successMetric: expect.stringContaining('cited local contracts'),
      }),
    })
    expect(refreshed?.acceptanceCriteria?.map((criterion: { id?: string }) => criterion.id)).toEqual([
      'contracts-defined',
      'fixture-ground-truth-shape',
      'run-evaluation-shape',
      'deterministic-proof',
    ])
    expect(refreshed?.spec).toContain('`FixtureManifest`')
    expect(refreshed?.spec).toContain('`PrototypeRun`')
    expect(refreshed?.spec).not.toContain('`ProviderRegistryEntry`')
    expect(refreshed?.spec).not.toContain('`ImportManifest`')
    expect(refreshed?.spec).not.toContain('`SchemaVersion`')
    expect(refreshed?.spec).not.toMatch(/coherence-reviewer-mvp|decision-trace-pipeline|author-voice-loop-mvp|context-packet-compaction-core/)
    expect(JSON.stringify(refreshed?.definitionOfDone ?? '')).not.toMatch(/coherence-reviewer-mvp|decision-trace-pipeline|done/)
    expect(JSON.stringify(refreshed?.workUnitAnalysis ?? '')).not.toMatch(/coherence-reviewer-mvp|decision-trace-pipeline|done/)
    expect(JSON.stringify(refreshed?.taskReadiness ?? '')).not.toMatch(/coherence-reviewer-mvp|decision-trace-pipeline|done/)
    expect(refreshed?.decomposition).toBeUndefined()
    expect(refreshed?.hierarchy).toBeUndefined()
    expect(refreshed?.dependsOn).toEqual([])
    expect(refreshed?.archivedEvidence).toBeUndefined()
    expect(queue.tasks.find(task => task.id === 'stale-child')).toMatchObject({
      status: 'import_draft',
      releaseIds: ['stage-1-headless-drafting-and-evaluation-mvp'],
    })
    expect(queue.tasks.find(task => task.id === 'stale-child')?.hierarchy).toBeUndefined()
    expect(deriveWorkExecutionState(queue.tasks as any, 'task-import-9s8tkc')).toMatchObject({
      isContaining: false,
      isRunnable: true,
    })
    expect(refreshed?.notes.some((note: { content?: string }) => note.content?.includes('Re-intake'))).toBe(true)
  })

  it('does not archive a task refreshed by the same re-intake apply', async () => {
    const legacyTask = task({
      id: 'task-import-9s8tkc',
      title: 'Define fixture, expected-record, prototype-run, and evaluation schemas.',
      sourceIdentity: 'docs/harness/implementation-roadmap.md#unit:1',
      deliverableName: 'Define fixture, expected-record, prototype-run, and evaluation schemas.',
      semanticKind: 'contract',
      status: 'import_draft',
      spec: '## Stale\nUse `coherence-reviewer-mvp`.',
    })
    const memoryDir = await makeState([legacyTask])
    const draft = planProjectReintake({
      now,
      sources: [
        {
          path: 'docs/harness/implementation-roadmap.md',
          content: narrativeRoadmap,
          semanticKinds: narrativeRoadmapSemanticKinds,
          contractNames: narrativeRoadmapContractNames,
        },
        { path: 'docs/specs/schema-contract-roadmap.md', content: narrativeSchemaRoadmap },
      ],
      tasks: [legacyTask],
    })
    draft.groups.push({
      id: 'archive-stale-collision',
      title: 'Archive stale collision',
      rationale: 'Regression fixture for stale cleanup colliding with current source-truth work.',
      changes: [{
        kind: 'archive',
        taskId: 'task-import-9s8tkc',
        reason: 'This stale cleanup must not override refreshed source-truth work.',
      }],
    })
    await writeProjectReintakeDraft(memoryDir, draft)

    const result = await applyProjectReintakeDraft({ memoryDir, now })
    expect(result.success).toBe(true)

    const queue = await readQueue(memoryDir)
    expect(queue.tasks.find(task => task.id === 'task-import-9s8tkc')).toMatchObject({
      status: 'spec_review',
      releaseIds: ['stage-1-headless-drafting-and-evaluation-mvp'],
    })
  })

  it('archives without deleting and keeps thin integration work in intake', async () => {
    const memoryDir = await makeState([
      task({ id: 'task-old', title: 'Retry project discovery update', status: 'blocked' }),
    ])
    const existingTasks = [task({ id: 'task-old', title: 'Retry project discovery update', status: 'blocked' })]
    const draft = planProjectReintake({
      now,
      sources: [loomaAuditSource],
      tasks: existingTasks,
    })
    await writeProjectReintakeDraft(memoryDir, draft)

    const result = await applyProjectReintakeDraft({ memoryDir, now })
    expect(result.success).toBe(true)

    const queue = await readQueue(memoryDir)
    expect(queue.tasks.find((candidate: { id?: string }) => candidate.id === 'task-old')).toMatchObject({
      status: 'archived',
    })
    expect(queue.tasks.find((candidate: { title?: string }) => candidate.title === 'Integrate AlertDialog into Knit destructive confirmation flow')).toMatchObject({
      sourceIdentity: 'looma/component/alert-dialog:integration',
      dependsOn: [expect.stringMatching(/^task-/)],
      status: 'import_draft',
      acceptanceCriteria: [],
      proofPaths: [],
    })
  })

  it('applies only selected groups', async () => {
    const memoryDir = await makeState([
      task({ id: 'task-old', title: 'Retry project discovery update', status: 'blocked' }),
    ])
    const existingTasks = [task({ id: 'task-old', title: 'Retry project discovery update', status: 'blocked' })]
    const draft = planProjectReintake({
      now,
      sources: [loomaAuditSource],
      tasks: existingTasks,
    })
    await writeProjectReintakeDraft(memoryDir, draft)

    const result = await applyProjectReintakeDraft({ memoryDir, selectedGroupIds: ['archive-unsupported'], now })
    expect(result).toMatchObject({ success: true, appliedGroups: 1 })

    const queue = await readQueue(memoryDir)
    expect(queue.tasks.some((candidate: { id?: string }) => candidate.id === 'task-alert-dialog')).toBe(false)
    expect(queue.tasks.find((candidate: { id?: string }) => candidate.id === 'task-old')?.status).toBe('archived')
  })

  it('rejects apply when TASKS changed since draft creation', async () => {
    const memoryDir = await makeState([])
    const draft = planProjectReintake({
      now,
      sources: [{ path: 'internal/notes/settings-copy.md', content: 'The settings footer says "Host-run" but should say "Runs on host" in src/web/surfaces/project/SettingsTab.svelte.' }],
      tasks: [],
    })
    await writeProjectReintakeDraft(memoryDir, draft)
    await writeQueue(memoryDir, [task({ id: 'new-task' })])

    const result = await applyProjectReintakeDraft({ memoryDir, now })
    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining('changed since the re-intake draft'),
    })
  })
})
