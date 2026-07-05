import { describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  readProjectStateJsonFromMemoryDirAsync,
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

async function makeState(tasks: unknown[]) {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-reintake-'))
  const memoryDir = path.join(projectRoot, '.guildhall')
  await writeProjectStateJsonFromMemoryDirAsync(memoryDir, 'TASKS.json', { version: 1, lastUpdated: now, tasks })
  await writeProjectStateTextFromMemoryDirAsync(memoryDir, 'PROGRESS.md', '# Progress\n')
  return memoryDir
}

async function readQueue(memoryDir: string): Promise<{ tasks: Array<Record<string, any>> }> {
  return readProjectStateJsonFromMemoryDirAsync<{ tasks: Array<Record<string, any>> }>(memoryDir, 'TASKS.json')
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

const narrativeRoadmap = [
  '# Implementation Roadmap',
  '',
  '## Stage 1: Fixture And Evaluation Harness',
  '',
  'Deliverables:',
  '',
  '- typed fixture and expected-record contracts',
  '',
  '## Current Next Milestone',
  '',
  'The next milestone is Stage 1: Fixture And Evaluation Harness.',
  '',
  '1. Define fixture, expected-record, prototype-run, and evaluation schemas.',
  '2. Add the first tiny fiction fixture and human-authored expected records.',
  '3. Implement a no-UI runner that builds a packet from fixture records.',
  '4. Add deterministic evaluation output for missing/noisy/stale/useful context.',
  '5. Generate a developer-readable debug report for each run.',
  '6. Use the first run to narrow the MVP story-memory schema.',
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

describe('project re-intake apply', () => {
  it('applies reframes in place and appends a re-intake note', async () => {
    const memoryDir = await makeState([
      task({ id: 'task-039', title: 'Build AlertDialog primitive', description: 'Old', status: 'blocked' }),
    ])
    const draft = planProjectReintake({
      now,
      sources: [{ path: 'looma/docs/component-library-audit.md', content: loomaAudit }],
      tasks: [task({ id: 'task-039', title: 'Build AlertDialog primitive', description: 'Old', status: 'blocked' })],
    })
    await writeProjectReintakeDraft(memoryDir, draft)

    const result = await applyProjectReintakeDraft({ memoryDir, now })
    expect(result).toMatchObject({ success: true, appliedGroups: 1 })

    const queue = await readQueue(memoryDir)
    const reframed = queue.tasks.find((candidate: { id?: string }) => candidate.id === 'task-039')
    expect(reframed).toMatchObject({
      title: 'Build AlertDialog',
      status: 'spec_review',
      acceptanceCriteria: expect.arrayContaining([expect.objectContaining({ id: 'source-implementation' })]),
      productBrief: expect.objectContaining({
        authoredBy: 'project-reintake',
        userJob: expect.stringContaining('Build AlertDialog'),
      }),
    })
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
      archivedEvidence: expect.objectContaining({
        retention: 'archive',
        reason: expect.stringContaining('weak legacy spec shape'),
        source: 'project-reintake',
      }),
    })
  })

  it('archives shadowed current-milestone deliverable imports so they stop counting as scoped work', async () => {
    const legacyTask = task({
      id: 'task-deliverable',
      title: 'typed fixture and expected-record contracts',
      description: 'docs/harness/implementation-roadmap.md: - typed fixture and expected-record contracts',
      status: 'import_draft',
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
    expect(queue.tasks.find((candidate: { id?: string }) => candidate.id === 'task-deliverable')).toMatchObject({
      status: 'archived',
      archivedEvidence: expect.objectContaining({
        reason: expect.stringContaining('starter-task sequence'),
      }),
    })
  })

  it('archives wrapped current-milestone deliverable imports when starter tasks now define that milestone', async () => {
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
    expect(queue.tasks.find((candidate: { id?: string }) => candidate.id === 'task-wrapped-deliverable')).toMatchObject({
      status: 'archived',
      archivedEvidence: expect.objectContaining({
        reason: expect.stringContaining('starter-task sequence'),
      }),
    })
  })

  it('persists current release scope, later work, and source refs when applying Narrative Harness re-intake', async () => {
    const memoryDir = await makeState([])
    const draft = planProjectReintake({
      now,
      sources: [
        { path: 'docs/harness/implementation-roadmap.md', content: narrativeRoadmap },
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
    const currentTask = queue.tasks.find(task => task.title === 'Define fixture, expected-record, prototype-run, and evaluation schemas.')
    const fixtureTask = queue.tasks.find(task => task.title === 'Add the first tiny fiction fixture and human-authored expected records.')
    const runnerTask = queue.tasks.find(task => task.title === 'Implement a no-UI runner that builds a packet from fixture records.')
    const evaluationTask = queue.tasks.find(task => task.title === 'Add deterministic evaluation output for missing/noisy/stale/useful context.')
    const debugTask = queue.tasks.find(task => task.title === 'Generate a developer-readable debug report for each run.')
    const schemaPruneTask = queue.tasks.find(task => task.title === 'Use the first run to narrow the MVP story-memory schema.')
    const laterTask = queue.tasks.find(task => task.title === 'Implement dialogue-and-character-voice reviewer lane')

    expect(queue.selectedReleaseId).toBe('stage-1-fixture-and-evaluation-harness')
    expect(queue.releases).toEqual([
      expect.objectContaining({
        id: 'stage-1-fixture-and-evaluation-harness',
        label: 'Stage 1: Fixture And Evaluation Harness',
        nodeIds: expect.arrayContaining([`work:${currentTask?.id}`]),
        deferredNodeIds: expect.arrayContaining([`work:${laterTask?.id}`]),
      }),
    ])
    expect(currentTask).toMatchObject({
      releaseIds: ['stage-1-fixture-and-evaluation-harness'],
      references: ['docs/harness/implementation-roadmap.md'],
      status: 'spec_review',
      productBrief: expect.objectContaining({
        authoredBy: 'project-reintake',
      }),
    })
    expect(fixtureTask).toMatchObject({
      releaseIds: ['stage-1-fixture-and-evaluation-harness'],
      status: 'spec_review',
      acceptanceCriteria: [
        expect.objectContaining({ id: 'fiction-fixture-source' }),
        expect.objectContaining({ id: 'human-expected-records' }),
        expect.objectContaining({ id: 'fixture-load-proof' }),
      ],
    })
    expect(runnerTask).toMatchObject({
      releaseIds: ['stage-1-fixture-and-evaluation-harness'],
      status: 'spec_review',
      acceptanceCriteria: [
        expect.objectContaining({ id: 'fixture-packet-build' }),
        expect.objectContaining({ id: 'no-ui-command' }),
        expect.objectContaining({ id: 'deterministic-run-record' }),
      ],
    })
    expect(evaluationTask).toMatchObject({
      releaseIds: ['stage-1-fixture-and-evaluation-harness'],
      status: 'spec_review',
      acceptanceCriteria: [
        expect.objectContaining({ id: 'packet-quality-categories' }),
        expect.objectContaining({ id: 'repeatable-evaluation-record' }),
        expect.objectContaining({ id: 'reviewer-readable-failures' }),
      ],
    })
    expect(debugTask).toMatchObject({
      releaseIds: ['stage-1-fixture-and-evaluation-harness'],
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
      releaseIds: ['stage-1-fixture-and-evaluation-harness'],
      status: 'spec_review',
      acceptanceCriteria: [
        expect.objectContaining({ id: 'first-run-schema-findings' }),
        expect.objectContaining({ id: 'schema-narrowing-decision' }),
        expect.objectContaining({ id: 'schema-proof-update' }),
      ],
    })
    expect(JSON.stringify(schemaPruneTask?.acceptanceCriteria ?? '')).not.toMatch(/migration|rollback/i)
    expect(laterTask).toMatchObject({
      status: 'shelved',
      references: [
        'docs/harness/remaining-spec-decomposition-inventory.md',
        'docs/specs/dialogue-and-character-voice.md',
      ],
      stageAlignment: 'stage 2 (agent coordination)',
    })
    expect(laterTask?.releaseIds ?? []).toEqual([])

    const approval = await approveSpec({
      memoryDir,
      taskId: currentTask!.id,
      approvalNote: 'Generated current-release re-intake spec is concrete enough for approval.',
    })
    expect(approval).toMatchObject({ success: true, newStatus: 'ready' })
    const approvedQueue = await readQueue(memoryDir)
    const approvedTask = approvedQueue.tasks.find(task => task.id === currentTask!.id)
    expect(approvedTask?.productBrief).toMatchObject({
      approvedBy: 'human',
      approvedAt: expect.stringMatching(/\d{4}-\d{2}-\d{2}T/),
    })
    expect(JSON.stringify(approvedTask?.productBrief ?? '')).not.toContain('Do not treat this draft as approved')
    expect(approvedTask?.sizePlan?.action).toBe('proceed_with_warning')
  })

  it('does not collapse a documented near-term proof scope into only the next milestone', async () => {
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
        { path: 'docs/harness/remaining-spec-decomposition-inventory.md', content: narrativeRemainingInventory },
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

    expect(queue.selectedReleaseId).toBe('near-term-proof-scope')
    expect(queue.releases).toEqual([
      expect.objectContaining({
        id: 'near-term-proof-scope',
        label: 'Near-term proof scope',
        source: 'inferred',
        nodeIds: expect.arrayContaining([
          `work:${runnerTask?.id}`,
          `work:${dialogueTask?.id}`,
          `work:${themeTask?.id}`,
        ]),
        deferredNodeIds: expect.arrayContaining([`work:${shellTask?.id}`]),
      }),
    ])
    expect(dialogueTask).toMatchObject({
      releaseIds: ['near-term-proof-scope'],
      status: 'spec_review',
      references: [
        'docs/harness/remaining-spec-decomposition-inventory.md',
        'docs/specs/dialogue-and-character-voice.md',
      ],
    })
    expect(dialogueTask?.spec ?? '').toContain('Could the line be reassigned to another character without anyone noticing?')
    expect(dialogueTask?.spec ?? '').not.toContain('exposes the expected public contract')
    expect(dialogueTask?.decomposition).toBeUndefined()
    expect(dialogueTask?.sizePlan).toBeUndefined()
    expect(themeTask).toMatchObject({
      releaseIds: ['near-term-proof-scope'],
      status: 'spec_review',
    })
    const approval = await approveSpec({ memoryDir, taskId: dialogueTask!.id })
    expect(approval).toMatchObject({ success: true, newStatus: 'ready' })
    const approvedQueue = await readQueue(memoryDir)
    expect(approvedQueue.tasks.find(task => task.id === dialogueTask!.id)).toMatchObject({
      status: 'ready',
    })
    expect(approvedQueue.tasks.find(task => task.id === dialogueTask!.id)?.sizePlan?.action).not.toBe('split_required')
    expect(approvedQueue.tasks.find(task => task.id === dialogueTask!.id)?.decomposition?.action).not.toBe('split')
    expect(approvedQueue.tasks.filter(task => task.hierarchy?.parentId === dialogueTask!.id)).toEqual([])
    expect(shellTask).toMatchObject({
      status: 'shelved',
    })
    expect(shellTask?.releaseIds ?? []).toEqual([])
  })

  it('replaces stale not-started task content when the regenerated source-truth task keeps the same deterministic id', async () => {
    const legacyTask = task({
      id: 'task-import-9s8tkc',
      title: 'Define fixture, expected-record, prototype-run, and evaluation schemas.',
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
        { path: 'docs/harness/implementation-roadmap.md', content: narrativeRoadmap },
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
        successMetric: expect.stringContaining('cited Stage 1 contracts'),
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
      status: 'archived',
      releaseIds: ['stage-1-fixture-and-evaluation-harness'],
      archivedEvidence: expect.objectContaining({
        retention: 'archive',
        source: 'project-reintake',
      }),
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
      status: 'import_draft',
      spec: '## Stale\nUse `coherence-reviewer-mvp`.',
    })
    const memoryDir = await makeState([legacyTask])
    const draft = planProjectReintake({
      now,
      sources: [
        { path: 'docs/harness/implementation-roadmap.md', content: narrativeRoadmap },
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
      releaseIds: ['stage-1-fixture-and-evaluation-harness'],
    })
  })

  it('archives without deleting and creates graph tasks with dependency proof fields', async () => {
    const memoryDir = await makeState([
      task({ id: 'task-old', title: 'Retry project discovery update', status: 'blocked' }),
    ])
    const existingTasks = [task({ id: 'task-old', title: 'Retry project discovery update', status: 'blocked' })]
    const draft = planProjectReintake({
      now,
      sources: [{ path: 'looma/docs/component-library-audit.md', content: loomaAudit }],
      tasks: existingTasks,
    })
    await writeProjectReintakeDraft(memoryDir, draft)

    const result = await applyProjectReintakeDraft({ memoryDir, now })
    expect(result.success).toBe(true)

    const queue = await readQueue(memoryDir)
    expect(queue.tasks.find((candidate: { id?: string }) => candidate.id === 'task-old')).toMatchObject({
      status: 'archived',
      archivedEvidence: expect.objectContaining({ retention: 'archive', source: 'project-reintake' }),
    })
    expect(queue.tasks.find((candidate: { id?: string }) => candidate.id === 'task-alert-dialog-integration')).toMatchObject({
      dependsOn: ['task-alert-dialog'],
      acceptanceCriteria: expect.arrayContaining([expect.objectContaining({ id: 'integration-regression-test' })]),
      proofPaths: expect.arrayContaining([expect.objectContaining({ kind: 'browser' })]),
    })
  })

  it('applies only selected groups', async () => {
    const memoryDir = await makeState([
      task({ id: 'task-old', title: 'Retry project discovery update', status: 'blocked' }),
    ])
    const existingTasks = [task({ id: 'task-old', title: 'Retry project discovery update', status: 'blocked' })]
    const draft = planProjectReintake({
      now,
      sources: [{ path: 'looma/docs/component-library-audit.md', content: loomaAudit }],
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
