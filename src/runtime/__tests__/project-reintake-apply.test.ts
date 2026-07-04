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
].join('\n')

const narrativeRemainingInventory = [
  '# Remaining Spec Decomposition Inventory',
  '',
  '### 2.2 `dialogue-and-character-voice.md`',
  '',
  '- **Recommended first task title:** Implement dialogue-and-character-voice reviewer lane',
  '- **Recommended domain:** coherence',
  '- **Stage alignment:** Stage 2 (Agent Coordination)',
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
      status: 'import_draft',
      acceptanceCriteria: expect.arrayContaining([expect.objectContaining({ id: 'source-implementation' })]),
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
    const memoryDir = await makeState([legacyTask])
    const draft = planProjectReintake({
      now,
      sources: [],
      tasks: [legacyTask],
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
      status: 'shelved',
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
      status: 'shelved',
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
      status: 'import_draft',
    })
    expect(laterTask).toMatchObject({
      status: 'shelved',
      references: ['docs/harness/remaining-spec-decomposition-inventory.md'],
      stageAlignment: 'stage 2 (agent coordination)',
    })
    expect(laterTask?.releaseIds ?? []).toEqual([])
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
    await writeProjectReintakeDraft(memoryDir, draft)

    const result = await applyProjectReintakeDraft({ memoryDir, now })
    expect(result.success).toBe(true)

    const queue = await readQueue(memoryDir)
    const refreshed = queue.tasks.find(task => task.id === 'task-import-9s8tkc')
    expect(refreshed).toMatchObject({
      title: 'Define fixture, expected-record, prototype-run, and evaluation schemas.',
      status: 'import_draft',
      references: ['docs/harness/implementation-roadmap.md', 'docs/specs/schema-contract-roadmap.md'],
    })
    expect(refreshed?.spec).toContain('`FixtureManifest`')
    expect(refreshed?.spec).toContain('`PrototypeRun`')
    expect(refreshed?.spec).not.toMatch(/coherence-reviewer-mvp|decision-trace-pipeline|author-voice-loop-mvp|context-packet-compaction-core/)
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
      status: 'import_draft',
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
