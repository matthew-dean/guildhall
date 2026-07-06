import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { bootstrapWorkspace } from '@guildhall/config'
import { TaskQueue } from '@guildhall/core'
import {
  readProjectStateJsonAsync,
  readProjectStateTextAsync,
  writeProjectStateJsonFromMemoryDirAsync,
} from '@guildhall/sessions'
import {
  createWorkspaceImportTask,
  workspaceNeedsImport,
  materializeWorkspaceImportDraft,
  approveWorkspaceImport,
  parseWorkspaceImport,
  maybeSeedWorkspaceImport,
  formatDetectedDraftAsSpec,
  mergeWorkspaceImportDraft,
  summarizeWorkspaceImportSpec,
  WORKSPACE_IMPORT_TASK_ID,
  WORKSPACE_IMPORT_DOMAIN,
  readWorkspaceGoalsState,
  parseWorkspaceGoalsState,
  workspaceGoalsNeedStructuralRefresh,
} from '../workspace-importer.js'
import { approveSpec } from '../intake.js'
import { pickNextTask } from '../orchestrator-picker.js'
import { detectWorkspaceSignals } from '../workspace-import/index.js'
import { formWorkspaceHypothesis } from '../workspace-import/hypothesis.js'
import type { WorkspaceInventory } from '../workspace-import/detect.js'
import type { WorkspaceSignal } from '../workspace-import/types.js'
import type { WorkspaceImportDraft } from '../workspace-import/index.js'

let tmpDir: string
let dataDir: string
let memoryDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-ws-import-'))
  dataDir = path.join(os.tmpdir(), `guildhall-data-${path.basename(tmpDir)}`)
  process.env.GUILDHALL_DATA_DIR = dataDir
  bootstrapWorkspace(tmpDir, { name: 'Import Test' })
  memoryDir = path.join(tmpDir, '.guildhall')
})

afterEach(async () => {
  delete process.env.GUILDHALL_DATA_DIR
  await fs.rm(tmpDir, { recursive: true, force: true })
  await fs.rm(dataDir, { recursive: true, force: true })
})

async function readQueue(): Promise<TaskQueue> {
  const parsed = await readProjectStateJsonAsync<unknown>(tmpDir, 'TASKS.json').catch((err: unknown) => {
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code?: unknown }).code === 'ENOENT'
    ) {
      return {
        version: 1,
        lastUpdated: new Date().toISOString(),
        tasks: [],
      }
    }
    throw err
  })
  if (Array.isArray(parsed)) {
    return { version: 1, lastUpdated: new Date().toISOString(), tasks: parsed }
  }
  return TaskQueue.parse(parsed)
}

async function writeQueue(queue: TaskQueue): Promise<void> {
  await writeProjectStateJsonFromMemoryDirAsync(memoryDir, 'TASKS.json', queue)
}

function invWith(signals: WorkspaceSignal[]): WorkspaceInventory {
  const bySource: Record<string, WorkspaceSignal[]> = {}
  const ran = new Set<string>()
  for (const s of signals) {
    ran.add(s.source)
    ;(bySource[s.source] ??= []).push(s)
  }
  return { signals, bySource, ran: [...ran], failed: [] }
}

const sampleInventory = (): WorkspaceInventory =>
  invWith([
    {
      source: 'readme',
      kind: 'goal',
      title: 'Ship multi-agent orchestrator',
      evidence: 'first line of README',
      confidence: 'high',
    },
    {
      source: 'roadmap',
      kind: 'open_work',
      title: 'Wire dashboard card',
      evidence: '- [ ] Wire dashboard card',
      confidence: 'high',
    },
    {
      source: 'git-log',
      kind: 'milestone',
      title: 'Ship v0.1.0',
      evidence: 'abc12345 Ship v0.1.0',
      confidence: 'high',
      references: ['abc12345'],
    },
  ])

describe('createWorkspaceImportTask', () => {
  it('seeds the reserved importer task with id + domain', async () => {
    const res = await createWorkspaceImportTask({
      memoryDir,
      projectPath: tmpDir,
      inventory: sampleInventory(),
    })
    expect(res.alreadyExists).toBe(false)
    expect(res.taskId).toBe(WORKSPACE_IMPORT_TASK_ID)

    const q = await readQueue()
    const task = q.tasks.find((t) => t.id === WORKSPACE_IMPORT_TASK_ID)
    expect(task).toBeDefined()
    expect(task!.domain).toBe(WORKSPACE_IMPORT_DOMAIN)
    expect(task!.status).toBe('exploring')
    expect(task!.origination).toBe('system')
    expect(task!.priority).toBe('high')
  })

  it('is idempotent — a second call does not create a duplicate', async () => {
    const inv = sampleInventory()
    await createWorkspaceImportTask({ memoryDir, projectPath: tmpDir, inventory: inv })
    const again = await createWorkspaceImportTask({
      memoryDir,
      projectPath: tmpDir,
      inventory: inv,
    })
    expect(again.alreadyExists).toBe(true)
    const q = await readQueue()
    const count = q.tasks.filter((t) => t.id === WORKSPACE_IMPORT_TASK_ID).length
    expect(count).toBe(1)
  })

  it('writes the inventory summary + draft into the exploring transcript', async () => {
    const res = await createWorkspaceImportTask({
      memoryDir,
      projectPath: tmpDir,
      inventory: sampleInventory(),
    })
    const content = await fs.readFile(res.transcriptPath, 'utf-8')
    expect(content).toContain('Detected inventory summary')
    expect(content).toContain('Draft goals')
    expect(content).toContain('Ship multi-agent orchestrator')
    expect(content).toContain('Current draft tasks')
    expect(content).toContain('Wire dashboard card')
    expect(content).toContain('Draft milestones')
    expect(content).toContain('Ship v0.1.0')
    // Seed includes the output-format instructions for the agent.
    expect(content).toContain('Output format')
    expect(content).toContain('goals:')
    expect(content).toContain('tasks:')
    expect(content).toContain('milestones:')
  })

  it('labels current vs deferred work and structural context roles in the exploring transcript', async () => {
    const inventory = sampleInventory()
    const res = await createWorkspaceImportTask({
      memoryDir,
      projectPath: tmpDir,
      inventory,
      draft: {
        goals: [],
        tasks: [
          {
            suggestedId: 'task-current',
            title: 'Current stage task',
            description: 'Current-scope work.',
            domain: 'harness',
            scope: 'current',
            priority: 'high',
            source: 'planning-docs',
            confidence: 'high',
            references: ['docs/harness/implementation-roadmap.md'],
          },
          {
            suggestedId: 'task-later',
            title: 'Later stage task',
            description: 'Deferred work.',
            domain: 'coherence',
            scope: 'later',
            priority: 'normal',
            source: 'planning-docs',
            confidence: 'medium',
            references: ['docs/specs/reader-knowledge-and-revelation.md'],
          },
        ],
        milestones: [],
        context: [
          {
            label: 'Author defines book intent, genre/form expectations, themes, and voice.',
            excerpt: 'Book brief input.',
            source: 'planning-docs',
            references: ['docs/harness/architecture-notes.md'],
            role: 'brief_input',
          },
          {
            label: 'The coordinator chooses reviewers based on current phase.',
            excerpt: 'Capability lane.',
            source: 'planning-docs',
            references: ['docs/harness/architecture-notes.md'],
            role: 'capability',
          },
        ],
        stats: {
          inputSignals: inventory.signals.length,
          drafted: 2,
          deduped: 0,
        },
      },
    })

    const content = await fs.readFile(res.transcriptPath, 'utf-8')
    expect(content).toContain('Current draft tasks')
    expect(content).toContain('Later / deferred draft tasks')
    expect(content).toContain('domain: harness')
    expect(content).toContain('domain: coherence')
    expect(content).toContain('Brief notes')
    expect(content).toContain('Capability context')
  })

  it('returns the computed inventory + draft to callers even when idempotent', async () => {
    const first = await createWorkspaceImportTask({
      memoryDir,
      projectPath: tmpDir,
      inventory: sampleInventory(),
    })
    expect(first.draft.tasks).toHaveLength(1)
    expect(first.draft.goals).toHaveLength(1)

    const second = await createWorkspaceImportTask({
      memoryDir,
      projectPath: tmpDir,
      inventory: sampleInventory(),
    })
    expect(second.alreadyExists).toBe(true)
    expect(second.draft.tasks).toHaveLength(1)
    expect(second.draft.goals).toHaveLength(1)
  })
})

describe('workspaceNeedsImport', () => {
  it('returns needed=true when workspace has signals and no user tasks', async () => {
    const res = await workspaceNeedsImport({
      memoryDir,
      projectPath: tmpDir,
      inventory: sampleInventory(),
    })
    expect(res.needed).toBe(true)
    expect(res.draft.tasks.length).toBeGreaterThan(0)
  })

  it('returns needed=false when the inventory is empty', async () => {
    const res = await workspaceNeedsImport({
      memoryDir,
      projectPath: tmpDir,
      inventory: invWith([]),
    })
    expect(res.needed).toBe(false)
  })

  it('returns needed=false once any user task exists', async () => {
    // Write a non-meta task directly into the queue.
    const q = await readQueue()
    const now = new Date().toISOString()
    q.tasks.push({
      id: 'user-1',
      title: 'manual task',
      description: 'x',
      domain: 'core',
      projectPath: tmpDir,
      status: 'ready',
      priority: 'normal',
      acceptanceCriteria: [],
      outOfScope: [],
      dependsOn: [],
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
    })
    await writeQueue(q)
    const res = await workspaceNeedsImport({
      memoryDir,
      projectPath: tmpDir,
      inventory: sampleInventory(),
    })
    expect(res.needed).toBe(false)
  })

  it('ignores reserved _meta and _workspace_import tasks when deciding need', async () => {
    // Seed both reserved tasks — they should NOT suppress import detection.
    await createWorkspaceImportTask({
      memoryDir,
      projectPath: tmpDir,
      inventory: sampleInventory(),
    })
    const res = await workspaceNeedsImport({
      memoryDir,
      projectPath: tmpDir,
      inventory: sampleInventory(),
    })
    // After the reserved task was created the detection signal still says
    // 'needed' because the reserved task is not a user task.
    expect(res.needed).toBe(true)
  })

  it('materializes detector drafts through the evidence graph before previewing them', async () => {
    await fs.mkdir(path.join(tmpDir, 'docs', 'harness'), { recursive: true })
    await fs.mkdir(path.join(tmpDir, 'docs', 'specs'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'harness', 'remaining-spec-decomposition-inventory.md'),
      [
        '# Remaining Spec Decomposition Inventory',
        '',
        '### 2.2 `dialogue-and-character-voice.md`',
        "- **Covers:** Defines how dialogue functions as action under social pressure, with distinct character voices that serve the book's larger voice.",
        '- **Recommended first task title:** Implement dialogue-and-character-voice reviewer lane',
        '- **Recommended domain:** coherence',
      ].join('\n'),
      'utf-8',
    )
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'specs', 'dialogue-and-character-voice.md'),
      [
        '# Dialogue And Character Voice',
        '',
        '## Avoiding Same-Voice Dialogue',
        '- Could the line be reassigned to another character without anyone noticing?',
        '',
        '## Dialect, Register, And Respect',
        '- Do not "correct" dialect into prestige grammar.',
        '',
        '## Dialogue-Agent Decision Tree',
        '1. Identify speaker, listener, and audience.',
        '2. Compare with nearby speakers for same-voice collapse.',
      ].join('\n'),
      'utf-8',
    )

    const inventory = await detectWorkspaceSignals({ projectPath: tmpDir })
    const rawDraft = formWorkspaceHypothesis(inventory)
    const materialized = await materializeWorkspaceImportDraft({
      memoryDir,
      projectPath: tmpDir,
      draft: rawDraft,
    })

    const rawTask = rawDraft.tasks.find(task => task.title === 'Implement dialogue-and-character-voice reviewer lane')
    const shapedTask = materialized.tasks.find(task => task.title === 'Implement dialogue-and-character-voice reviewer lane')

    expect(rawTask?.acceptanceCriteria).toBeUndefined()
    expect(shapedTask?.acceptanceCriteria?.map(criterion => criterion.id)).toEqual([
      'lane-scope',
      'review-prompts',
      'lane-boundary',
      'finding-shape',
      'deterministic-proof',
    ])
    expect(shapedTask?.acceptanceCriteria?.[1]?.description).toContain('Could the line be reassigned to another character without anyone noticing?')
  })

  it('derives proof paths from cited evidence instead of generic import filler', async () => {
    await fs.mkdir(path.join(tmpDir, 'docs', 'harness'), { recursive: true })
    await fs.mkdir(path.join(tmpDir, 'docs', 'specs'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'harness', 'implementation-roadmap.md'),
      [
        '# Implementation Roadmap',
        '',
        '## Current Next Milestone',
        '1. Implement a no-UI runner that builds a packet from fixture records.',
        '',
        '## Run Record Verification',
        '- Run one bounded fixture through packet assembly, trace capture, and evaluation output review.',
      ].join('\n'),
      'utf-8',
    )
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'specs', 'schema-contract-roadmap.md'),
      [
        '# Schema Contract Roadmap',
        '',
        '## Needed Contracts',
        '- `BookBrief`',
        '- `ManuscriptUnit`',
        '- `GlobalAuthorProfile`',
      ].join('\n'),
      'utf-8',
    )
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'specs', 'story-memory-schemas.md'),
      [
        '# Story Memory Schemas',
        '',
        '## Required Shapes',
        '- `AuthorProvenanceNote`',
        '- `SessionCheckIn`',
        '- `StoryFact`',
      ].join('\n'),
      'utf-8',
    )
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'specs', 'editor-writer-feedback-chain.md'),
      [
        '# Editor Writer Feedback Chain',
        '',
        '## Planning Notes',
        '- **Why not decomposed yet:** Requires the feedback-weight types and review-finding types first.',
        '',
        '## Ordered Feedback Chain',
        '- Specialists identify lens-specific evidence.',
        '- Findings receive multidimensional weight.',
        '',
        '## Verification',
        '- Replay one bounded set of findings into the weighted packet output.',
      ].join('\n'),
      'utf-8',
    )
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'harness', 'remaining-spec-decomposition-inventory.md'),
      [
        '# Remaining Spec Decomposition Inventory',
        '',
        '### 2.2 `dialogue-and-character-voice.md`',
        '- **Covers:** Defines how dialogue functions as action under social pressure.',
        '- **Recommended first task title:** Implement dialogue-and-character-voice reviewer lane',
        '',
        '### 2.10 `schema-contract-roadmap.md`',
        '- **Covers:** A roadmap document identifying contract surfaces that need explicit treatment before implementation grows.',
        '',
        '## 4. Verification of First Replacement (`packages/schemas/`)',
        '- `test -d packages/schemas` → **MISSING** (directory does not exist on disk)',
      ].join('\n'),
      'utf-8',
    )
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'specs', 'dialogue-and-character-voice.md'),
      [
        '# Dialogue And Character Voice',
        '',
        '## Reviewer Questions',
        '- Could the line be reassigned to another character without anyone noticing?',
        '',
        '## Verification',
        '- Run the reviewer lane against one bounded dialogue fixture and record structured findings.',
      ].join('\n'),
      'utf-8',
    )

    const draft = {
      goals: [],
      tasks: [
        {
          suggestedId: 'task-runner',
          title: 'Implement a no-UI runner that builds a packet from fixture records.',
          description: 'Current milestone runner proof.',
          domain: 'harness',
          scope: 'current',
          priority: 'high' as const,
          references: [
            'docs/harness/implementation-roadmap.md',
            'docs/specs/schema-contract-roadmap.md',
            'docs/specs/story-memory-schemas.md',
          ],
          source: 'workspace-importer' as const,
          confidence: 'high' as const,
          acceptanceCriteria: [
            { id: 'source-implementation', description: 'placeholder' },
          ],
          proofPaths: [
            {
              kind: 'command' as const,
              command: 'pnpm test -- implement-a-no-ui-runner-that-builds-a-packet-from-fixture-records',
              expectedEvidence: ['placeholder'],
            },
            {
              kind: 'review' as const,
              expectedEvidence: ['placeholder'],
            },
          ],
        },
        {
          suggestedId: 'task-dialogue-reviewer',
          title: 'Implement dialogue-and-character-voice reviewer lane',
          description: 'Reviewer lane proof.',
          domain: 'coherence',
          scope: 'current',
          priority: 'high' as const,
          references: [
            'docs/harness/remaining-spec-decomposition-inventory.md',
            'docs/specs/dialogue-and-character-voice.md',
            'docs/harness/implementation-roadmap.md',
          ],
          source: 'workspace-importer' as const,
          confidence: 'high' as const,
          acceptanceCriteria: [
            { id: 'source-implementation', description: 'placeholder' },
          ],
          proofPaths: [
            {
              kind: 'command' as const,
              command: 'pnpm test -- implement-dialogue-and-character-voice-reviewer-lane',
              expectedEvidence: ['placeholder'],
            },
          ],
        },
        {
          suggestedId: 'task-evaluation',
          title: 'Add deterministic evaluation output that reports missing, noisy, stale, and useful context.',
          description: 'Deterministic evaluation output for bounded fixture runs.',
          domain: 'harness',
          scope: 'current',
          priority: 'high' as const,
          references: [
            'docs/harness/implementation-roadmap.md',
          ],
          source: 'workspace-importer' as const,
          confidence: 'high' as const,
          acceptanceCriteria: [
            { id: 'source-implementation', description: 'placeholder' },
          ],
          proofPaths: [
            {
              kind: 'command' as const,
              command: 'pnpm test -- add-deterministic-evaluation-output',
              expectedEvidence: ['placeholder'],
            },
          ],
        },
        {
          suggestedId: 'task-debug-report',
          title: 'Generate a developer-readable debug report for each run.',
          description: 'Debuggability and traceability proof for bounded fixture runs.',
          domain: 'harness',
          scope: 'current',
          priority: 'high' as const,
          references: [
            'docs/harness/implementation-roadmap.md',
          ],
          source: 'workspace-importer' as const,
          confidence: 'high' as const,
          acceptanceCriteria: [
            { id: 'source-implementation', description: 'placeholder' },
          ],
          proofPaths: [
            {
              kind: 'command' as const,
              command: 'pnpm test -- generate-a-developer-readable-debug-report',
              expectedEvidence: ['placeholder'],
            },
          ],
        },
        {
          suggestedId: 'task-feedback-chain',
          title: 'Implement editor-writer feedback chain contract and weighted-feedback pipeline',
          description: 'Weighted feedback workflow.',
          domain: 'harness',
          scope: 'current',
          priority: 'high' as const,
          references: [
            'docs/harness/remaining-spec-decomposition-inventory.md',
            'docs/specs/editor-writer-feedback-chain.md',
            'docs/harness/implementation-roadmap.md',
          ],
          source: 'workspace-importer' as const,
          confidence: 'high' as const,
          acceptanceCriteria: [
            { id: 'source-implementation', description: 'placeholder' },
          ],
          proofPaths: [
            {
              kind: 'command' as const,
              command: 'pnpm test -- implement-editor-writer-feedback-chain-contract-and-weighted-feedback-pipeline',
              expectedEvidence: ['placeholder'],
            },
          ],
        },
      ],
      milestones: [],
      context: [],
      stats: { inputSignals: 1, drafted: 2, deduped: 0 },
    } satisfies WorkspaceImportDraft

    const materialized = await materializeWorkspaceImportDraft({
      memoryDir,
      projectPath: tmpDir,
      draft,
    })

    const runner = materialized.tasks.find(task => task.title === 'Implement a no-UI runner that builds a packet from fixture records.')
    const dialogue = materialized.tasks.find(task => task.title === 'Implement dialogue-and-character-voice reviewer lane')
    const evaluation = materialized.tasks.find(task => task.title === 'Add deterministic evaluation output that reports missing, noisy, stale, and useful context.')
    const debugReport = materialized.tasks.find(task => task.title === 'Generate a developer-readable debug report for each run.')
    const workflow = materialized.tasks.find(task => task.title === 'Implement editor-writer feedback chain contract and weighted-feedback pipeline')

    expect(runner?.proofPaths).toEqual([
      expect.objectContaining({
        kind: 'review',
        source: 'inferred',
        expectedEvidence: expect.arrayContaining([
          'The run stays inside the no-UI harness boundary.',
          'Saved run output is traceable back to the fixture inputs.',
        ]),
      }),
    ])
    expect(runner?.acceptanceCriteria?.map((criterion) => criterion.id)).toEqual([
      'runner-flow',
      'headless-boundary',
      'deterministic-proof',
    ])
    expect(dialogue?.proofPaths?.[0]).toEqual(expect.objectContaining({
      kind: 'review',
      source: 'inferred',
    }))
    expect(dialogue?.acceptanceCriteria?.[0]?.description).not.toContain('Recommended first task title')
    expect(dialogue?.acceptanceCriteria?.[0]?.description).not.toContain('MISSING')
    expect(dialogue?.acceptanceCriteria?.[0]?.description).not.toContain('contract surfaces')
    expect(evaluation?.acceptanceCriteria?.map((criterion) => criterion.id)).toEqual([
      'evaluation-categories',
      'stable-report-shape',
      'deterministic-proof',
    ])
    expect(evaluation?.proofPaths?.[0]).toEqual(expect.objectContaining({
      kind: 'command',
      expectedEvidence: [
        'Evaluation output classifies missing, noisy, stale, useful, schema, and model-behavior outcomes.',
      ],
    }))
    expect(debugReport?.acceptanceCriteria?.map((criterion) => criterion.id)).toEqual([
      'trace-spine',
      'context-accounting',
      'privacy-boundary',
      'deterministic-proof',
    ])
    expect(debugReport?.proofPaths?.[0]).toEqual(expect.objectContaining({
      kind: 'command',
      expectedEvidence: [
        'The debug report records the run summary, packet/context receipts, and trace spine.',
      ],
    }))
    expect(workflow?.proofPaths?.[0]).toEqual(expect.objectContaining({
      kind: 'command',
      expectedEvidence: ['Replay one bounded set of findings into the weighted packet output'],
    }))
  })

  it('shapes later-stage imported capabilities into real slices instead of one generic work unit', async () => {
    await fs.mkdir(path.join(tmpDir, 'docs', 'harness'), { recursive: true })
    await fs.mkdir(path.join(tmpDir, 'docs', 'specs'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'harness', 'implementation-roadmap.md'),
      [
        '# Implementation Roadmap',
        '',
        '## Stage 2: Mastra Agent Prototype',
        '',
        'Goal: use Mastra and TypeScript to prove the agent workflow: packet builder, specialist editors, writer instances, revision orchestration, and on-demand retrieval.',
        '',
        'Deliverables:',
        '- deterministic retrieval tools over structured story records',
        '- writer agent call that receives a constraint stack and a privacy manifest',
        '- invalidation behavior for edited sections or scenes',
        '- cost/latency/quality telemetry records',
      ].join('\n'),
      'utf-8',
    )
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'harness', 'architecture-notes.md'),
      [
        '# Architecture Notes',
        '',
        '## Retrieval Questions',
        '- answer character, scene, reader-state, and world questions from structured story records',
        '- retrieval answers should cite the records they used',
        '',
        '## Telemetry',
        '- runs should record cost, latency, quality verdicts, and cited fixture ids',
      ].join('\n'),
      'utf-8',
    )
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'specs', 'agent-context-packets-and-compaction.md'),
      [
        '# Agent Context Packets And Compaction',
        '',
        '## Chapter Writer Packet',
        '- constraint stack for the active chapter',
        '- privacy manifest for provenance eligibility',
        '',
        '## Provenance And Privacy',
        '- blocked provenance never appears in tool calls or output',
        '',
        '## Invalidation',
        '- edited sections invalidate derived scene and reader-state context',
        '- stale context is excluded from the next packet',
      ].join('\n'),
      'utf-8',
    )

    await createWorkspaceImportTask({
      memoryDir,
      projectPath: tmpDir,
      inventory: sampleInventory(),
    })

    const approved = await approveWorkspaceImport({
      memoryDir,
      projectPath: tmpDir,
      draftOverride: {
        goals: [],
        tasks: [
          {
            suggestedId: 'task-retrieval',
            title: 'deterministic retrieval tools over structured story records',
            description: 'Stage 2 retrieval deliverable.',
            domain: 'harness',
            scope: 'later',
            priority: 'normal',
            references: [
              'docs/harness/implementation-roadmap.md',
              'docs/harness/architecture-notes.md',
            ],
            source: 'planning-docs',
            confidence: 'high',
            acceptanceCriteria: [{ id: 'source-implementation', description: 'placeholder' }],
            proofPaths: [{ kind: 'command', command: 'pnpm test -- retrieval', expectedEvidence: ['placeholder'] }],
          },
          {
            suggestedId: 'task-writer-call',
            title: 'writer agent call that receives a constraint stack and a privacy manifest',
            description: 'Stage 2 writer-call deliverable.',
            domain: 'harness',
            scope: 'later',
            priority: 'normal',
            references: [
              'docs/harness/implementation-roadmap.md',
              'docs/specs/agent-context-packets-and-compaction.md',
            ],
            source: 'planning-docs',
            confidence: 'high',
            acceptanceCriteria: [{ id: 'source-implementation', description: 'placeholder' }],
            proofPaths: [{ kind: 'command', command: 'pnpm test -- writer-call', expectedEvidence: ['placeholder'] }],
          },
          {
            suggestedId: 'task-invalidation',
            title: 'invalidation behavior for edited sections or scenes',
            description: 'Stage 2 invalidation deliverable.',
            domain: 'harness',
            scope: 'later',
            priority: 'normal',
            references: [
              'docs/harness/implementation-roadmap.md',
              'docs/specs/agent-context-packets-and-compaction.md',
            ],
            source: 'planning-docs',
            confidence: 'high',
            acceptanceCriteria: [{ id: 'source-implementation', description: 'placeholder' }],
            proofPaths: [{ kind: 'command', command: 'pnpm test -- invalidation', expectedEvidence: ['placeholder'] }],
          },
          {
            suggestedId: 'task-telemetry',
            title: 'cost/latency/quality telemetry records',
            description: 'Stage 2 telemetry deliverable.',
            domain: 'harness',
            scope: 'later',
            priority: 'normal',
            references: [
              'docs/harness/implementation-roadmap.md',
              'docs/harness/architecture-notes.md',
            ],
            source: 'planning-docs',
            confidence: 'high',
            acceptanceCriteria: [{ id: 'source-implementation', description: 'placeholder' }],
            proofPaths: [{ kind: 'command', command: 'pnpm test -- telemetry', expectedEvidence: ['placeholder'] }],
          },
        ],
        milestones: [],
        context: [],
        stats: { inputSignals: 4, drafted: 4, deduped: 0 },
      },
    })
    expect(approved).toMatchObject({ success: true, tasksAdded: 4 })

    const queue = await readQueue()
    expect(queue.tasks.find(task => task.title === 'deterministic retrieval tools over structured story records')?.workUnitAnalysis?.units.map(unit => unit.title)).toEqual([
      'Define the retrieval question surface over story records',
      'Resolve deterministic answers from structured story records',
      'Prove citations and provenance boundaries for retrieval results',
    ])
    expect(queue.tasks.find(task => task.title === 'writer agent call that receives a constraint stack and a privacy manifest')?.workUnitAnalysis?.units.map(unit => unit.title)).toEqual([
      'Define the writer-call packet contract',
      'Thread the constraint stack and privacy manifest into the writer call',
      'Prove blocked provenance stays out of writer output',
    ])
    expect(queue.tasks.find(task => task.title === 'invalidation behavior for edited sections or scenes')?.workUnitAnalysis?.units.map(unit => unit.title)).toEqual([
      'Detect which derived context becomes stale after edits',
      'Invalidate packet and retrieval context for affected edits',
      'Prove reruns exclude stale context after edits',
    ])
    expect(queue.tasks.find(task => task.title === 'cost/latency/quality telemetry records')?.workUnitAnalysis?.units.map(unit => unit.title)).toEqual([
      'Define telemetry record fields for cost, latency, and quality',
      'Emit telemetry records from bounded prototype runs',
      'Prove telemetry output stays attached to run evidence',
    ])
  })
})

describe('parseWorkspaceImport', () => {
  it('returns empty buckets when spec has no fences', () => {
    expect(parseWorkspaceImport('hello world')).toEqual({
      goals: [],
      tasks: [],
      milestones: [],
    })
  })

  it('parses goals / tasks / milestones fences independently', () => {
    const spec = `
\`\`\`yaml
goals:
  - id: g1
    title: Ship orchestrator
    rationale: North star per README
\`\`\`

\`\`\`yaml
tasks:
  - id: t-wire-dashboard
    title: Wire dashboard card
    description: Render import preview + approve button
    domain: ui
    priority: high
    references:
      - ROADMAP.md
\`\`\`

\`\`\`yaml
milestones:
  - title: Ship v0.1.0
    evidence: abc12345
\`\`\`
`
    const parsed = parseWorkspaceImport(spec)
    expect(parsed.goals).toEqual([
      { id: 'g1', title: 'Ship orchestrator', rationale: 'North star per README' },
    ])
    expect(parsed.tasks).toEqual([
      {
        id: 't-wire-dashboard',
        title: 'Wire dashboard card',
        description: 'Render import preview + approve button',
        domain: 'ui',
        scope: 'current',
        priority: 'high',
        references: ['ROADMAP.md'],
      },
    ])
    expect(parsed.milestones).toEqual([
      { title: 'Ship v0.1.0', evidence: 'abc12345' },
    ])
  })

  it('falls back to normal priority and default domain on invalid values', () => {
    const parsed = parseWorkspaceImport(`
\`\`\`yaml
tasks:
  - id: t1
    title: whatever
    priority: urgent-now
\`\`\`
`)
    expect(parsed.tasks[0]!.priority).toBe('normal')
    expect(parsed.tasks[0]!.domain).toBe('core')
  })

  it('skips malformed fence entries but keeps the valid ones', () => {
    const parsed = parseWorkspaceImport(`
\`\`\`yaml
tasks:
  - title: no id
  - id: t-ok
    title: ok
\`\`\`
`)
    expect(parsed.tasks).toHaveLength(1)
    expect(parsed.tasks[0]!.id).toBe('t-ok')
  })

  it('treats a root YAML array as a task list for completed import recovery', () => {
    const parsed = parseWorkspaceImport(`
\`\`\`yaml
- id: task-auth-complete
  title: Complete authentication flow
  description: Finish registration, login, profile management, and email confirmation.
  domain: auth
  priority: high
  references:
    - docs/brief.md
- id: task-listings-basic
  title: Build basic listing submission
\`\`\`
`)

    expect(parsed.tasks).toEqual([
      {
        id: 'task-auth-complete',
        title: 'Complete authentication flow',
        description: 'Finish registration, login, profile management, and email confirmation.',
        domain: 'auth',
        scope: 'current',
        priority: 'high',
        references: ['docs/brief.md'],
      },
      {
        id: 'task-listings-basic',
        title: 'Build basic listing submission',
        description: '',
        domain: 'core',
        scope: 'current',
        priority: 'normal',
        references: [],
      },
    ])
  })
})

describe('approveWorkspaceImport', () => {
  async function seedImporterWithSpec(spec: string) {
    await createWorkspaceImportTask({
      memoryDir,
      projectPath: tmpDir,
      inventory: sampleInventory(),
    })
    const q = await readQueue()
    const task = q.tasks.find((t) => t.id === WORKSPACE_IMPORT_TASK_ID)!
    task.spec = spec
    await writeQueue(q)
  }

  it('errors when the importer task is missing', async () => {
    const res = await approveWorkspaceImport({
      memoryDir,
      projectPath: tmpDir,
    })
    expect(res.success).toBe(false)
    expect(res.error).toContain('No workspace-import task')
  })

  it('errors when the spec has no parseable fences', async () => {
    await seedImporterWithSpec('just free text, no yaml fences')
    const res = await approveWorkspaceImport({
      memoryDir,
      projectPath: tmpDir,
    })
    expect(res.success).toBe(false)
    expect(res.error).toContain('Could not find')
  })

  it('rejects malformed YAML fences instead of marking a partial import done', async () => {
    await seedImporterWithSpec(`
\`\`\`yaml
goals:
  - id: g1
    title: Ship orchestrator
\`\`\`

\`\`\`yaml
tasks:
  - id: t-wire-dashboard
    title: Wire dashboard card
    description: do the thing
    domain: ui
    priority: high
    references:
      - ROADMAP.md
     - bad-indent.md
\`\`\`

\`\`\`yaml
milestones:
  - title: Ship v0.1.0
\`\`\`
`)
    const res = await approveWorkspaceImport({
      memoryDir,
      projectPath: tmpDir,
    })
    expect(res.success).toBe(false)
    expect(res.error).toContain('Invalid workspace-import YAML')

    const q = await readQueue()
    const importerTask = q.tasks.find((t) => t.id === WORKSPACE_IMPORT_TASK_ID)!
    expect(importerTask.status).not.toBe('done')
    expect(q.tasks.some((t) => t.id === 't-wire-dashboard')).toBe(false)
  })

  it('inserts tasks as import drafts + origination=human, records goals + milestones', async () => {
    await seedImporterWithSpec(`
\`\`\`yaml
goals:
  - id: g1
    title: Ship orchestrator
    rationale: README
\`\`\`

\`\`\`yaml
tasks:
  - id: t-wire-dashboard
    title: Wire dashboard card
    description: do the thing
    domain: ui
    priority: high
    references:
      - ROADMAP.md
\`\`\`

\`\`\`yaml
milestones:
  - title: Ship v0.1.0
    evidence: abc12345
\`\`\`
`)
    const res = await approveWorkspaceImport({
      memoryDir,
      projectPath: tmpDir,
    })
    expect(res).toMatchObject({
      success: true,
      tasksAdded: 1,
      goalsRecorded: 1,
      milestonesLogged: 1,
    })

    const q = await readQueue()
    const importerTask = q.tasks.find((t) => t.id === WORKSPACE_IMPORT_TASK_ID)!
    expect(importerTask.status).toBe('done')
    expect(importerTask.completedAt).toBeTypeOf('string')

    const newTask = q.tasks.find((t) => t.id === 't-wire-dashboard')!
    expect(newTask.status).toBe('import_draft')
    expect(newTask.origination).toBe('human')
    expect(newTask.domain).toBe('ui')
    expect(newTask.priority).toBe('high')
    expect(newTask.references).toEqual([path.join(tmpDir, 'ROADMAP.md')])
    expect(newTask.notes[0]!.content).toContain('ROADMAP.md')
    expect(newTask.requestIntake).toMatchObject({
      intent: 'spec_only',
      recommendedNextAction: 'draft_spec',
      evidenceRefs: [expect.stringContaining('import:')],
      pressureTestSummary: {
        degree: 'guided',
      },
    })

    const goals = await readProjectStateJsonAsync<{ goals: Array<{ id: string; title: string }> }>(tmpDir, 'workspace-goals.json')
    expect(goals.goals[0]).toMatchObject({
      id: 'g1',
      title: 'Ship orchestrator',
    })

    const progress = await readProjectStateTextAsync(tmpDir, 'PROGRESS.md')
    expect(progress).toContain('Ship v0.1.0')
    expect(progress).toContain('abc12345')
    expect(progress).toContain('MILESTONE')
  })

  it('preserves explicit release scope on approved imported tasks', async () => {
    await seedImporterWithSpec(`
\`\`\`yaml
tasks:
  - id: task-headless-schema
    title: Define fixture, expected-record, prototype-run, and evaluation schemas.
    description: First headless proof task for the documented MVP release.
    domain: harness
    priority: high
    releaseIds:
      - nh-headless-mvp
    references:
      - docs/harness/implementation-roadmap.md
  - id: task-authoring-shell
    title: Build the local authoring shell
    description: Later product shell after headless proof.
    domain: ui
    scope: later
    priority: normal
    references:
      - docs/harness/implementation-roadmap.md
\`\`\`
`)

    const res = await approveWorkspaceImport({
      memoryDir,
      projectPath: tmpDir,
    })
    expect(res, res.success ? undefined : res.error).toMatchObject({ success: true, tasksAdded: 2 })

    const q = await readQueue()
    expect(q.tasks.find((t) => t.id === 'task-headless-schema')).toMatchObject({
      status: 'import_draft',
      releaseIds: ['nh-headless-mvp'],
    })
    expect(q.tasks.find((t) => t.id === 'task-authoring-shell')).toMatchObject({
      status: 'shelved',
      releaseIds: [],
    })
    expect(q.selectedReleaseId).toBe('nh-headless-mvp')
    expect(q.releases).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'nh-headless-mvp',
        label: 'NH Headless MVP',
        state: 'active',
        source: 'inferred',
      }),
    ]))
  })

  it('reopens stale imported done status when refreshed current work still lacks acceptance and proof evidence', async () => {
    const spec = `
\`\`\`yaml
tasks:
  - id: task-headless-schema
    title: Define fixture, expected-record, prototype-run, and evaluation schemas.
    description: First headless proof task for the documented MVP release.
    domain: harness
    priority: high
    releaseIds:
      - nh-headless-mvp
    references:
      - docs/harness/implementation-roadmap.md
    acceptanceCriteria:
      - id: contracts-defined
        description: Fixture and run contracts are defined.
        verifiedBy: review
        source: documented
    proofPaths:
      - kind: review
        source: inferred
        expectedEvidence:
          - Fixture and run contracts are visible in code or docs.
\`\`\`
`
    await seedImporterWithSpec(spec)
    const first = await approveWorkspaceImport({
      memoryDir,
      projectPath: tmpDir,
    })
    expect(first).toMatchObject({ success: true, tasksAdded: 1 })

    const q = await readQueue()
    const importedTask = q.tasks.find((t) => t.id === 'task-headless-schema')!
    importedTask.status = 'done'
    importedTask.completedAt = '2026-07-04T00:00:00.000Z'
    importedTask.acceptanceCriteria = importedTask.acceptanceCriteria.map((criterion) => ({
      ...criterion,
      met: false,
    }))
    await writeQueue(q)

    await seedImporterWithSpec(spec)
    const refreshed = await approveWorkspaceImport({
      memoryDir,
      projectPath: tmpDir,
      replacePreviouslyImportedTasks: true,
    })
    expect(refreshed).toMatchObject({ success: true })

    const refreshedQueue = await readQueue()
    expect(refreshedQueue.tasks.find((t) => t.id === 'task-headless-schema')).toMatchObject({
      status: 'spec_review',
      releaseIds: ['nh-headless-mvp'],
      acceptanceCriteria: [
        expect.objectContaining({
          id: 'contracts-defined',
          met: false,
        }),
      ],
    })
    expect(refreshedQueue.tasks.find((t) => t.id === 'task-headless-schema')?.completedAt).toBeUndefined()
  })

  it('repairs cropped saved imported titles from matching source-backed imports', async () => {
    const croppedTitle = 'Keep ui-top-bar, ui-search-shell, and ui-search-result-row as recipe-level primitives rather than forcing them into lowe'
    const fullTitle = 'Keep ui-top-bar, ui-search-shell, and ui-search-result-row as recipe-level primitives rather than forcing them into lower-level generic atoms'
    await seedImporterWithSpec(`
\`\`\`yaml
tasks:
  - id: task-recipe-primitives
    title: >-
      ${fullTitle}
    description: >-
      looma/docs/component-roadmap.md: - ${fullTitle}
    domain: looma
    priority: normal
    references:
      - looma/docs/component-roadmap.md
\`\`\`
`)
    const q = await readQueue()
    q.tasks.push({
      id: 'task-import-2h8fxk',
      title: croppedTitle,
      description: `looma/docs/component-roadmap.md: - ${fullTitle}`,
      domain: 'looma',
      projectPath: path.join(tmpDir, 'looma'),
      status: 'ready',
      priority: 'normal',
      dependsOn: [],
      outOfScope: [],
      acceptanceCriteria: [],
      references: [],
      notes: [],
      gateResults: [],
      reviewVerdicts: [],
      adjudications: [],
      escalations: [],
      agentIssues: [],
      revisionCount: 0,
      remediationAttempts: 0,
      origination: 'human',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    q.tasks.push({
      id: 'task-import-8y19xf',
      title: 'Auto-embed pages on save — whenever a page is created or edited, its content is automatically chunked and converted into',
      description: 'knit/docs/features.md: - [ ] **Auto-embed pages on save** — whenever a page is created or edited, its content is automatically chunked and converted into vector embeddings; this is what enables semantic search and AI-powered features',
      domain: 'knit',
      projectPath: path.join(tmpDir, 'knit'),
      status: 'archived',
      priority: 'normal',
      dependsOn: [],
      outOfScope: [],
      acceptanceCriteria: [],
      references: [path.join(tmpDir, 'knit/docs/features.md')],
      notes: [],
      gateResults: [],
      reviewVerdicts: [],
      adjudications: [],
      escalations: [],
      agentIssues: [],
      revisionCount: 0,
      remediationAttempts: 0,
      origination: 'human',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    await writeQueue(q)

    const refreshed = await approveWorkspaceImport({
      memoryDir,
      projectPath: tmpDir,
      replacePreviouslyImportedTasks: true,
    })
    expect(refreshed, refreshed.success ? undefined : refreshed.error).toMatchObject({ success: true, tasksAdded: 0 })

    const refreshedQueue = await readQueue()
    const repaired = refreshedQueue.tasks.find((t) => t.id === 'task-import-2h8fxk')
    expect(repaired?.title).toBe(fullTitle)
    expect(repaired?.description).toContain(fullTitle)
    expect(refreshedQueue.tasks.filter((t) => t.title === fullTitle)).toHaveLength(1)
    expect(refreshedQueue.tasks.find((t) => t.id === 'task-import-8y19xf')?.title).toBe(
      'Auto-embed pages on save — whenever a page is created or edited, its content is automatically chunked and converted into vector embeddings; this is what enables semantic search and AI-powered features',
    )
  })

  it('keeps refreshed current work done when durable completion evidence survived status drift', async () => {
    const spec = `
\`\`\`yaml
tasks:
  - id: task-headless-schema
    title: Define fixture, expected-record, prototype-run, and evaluation schemas.
    description: First headless proof task for the documented MVP release.
    domain: harness
    priority: high
    releaseIds:
      - nh-headless-mvp
    references:
      - docs/harness/implementation-roadmap.md
    acceptanceCriteria:
      - id: contracts-defined
        description: Fixture and run contracts are defined.
        verifiedBy: review
        source: documented
    proofPaths:
      - kind: review
        source: inferred
        expectedEvidence:
          - Fixture and run contracts are visible in code or docs.
\`\`\`
`
    await seedImporterWithSpec(spec)
    await approveWorkspaceImport({
      memoryDir,
      projectPath: tmpDir,
    })

    const q = await readQueue()
    const importedTask = q.tasks.find((t) => t.id === 'task-headless-schema')!
    importedTask.status = 'spec_review'
    importedTask.completedAt = undefined
    importedTask.mergeRecord = {
      fromBranch: 'guildhall/task-task-headless-schema',
      toBranch: 'main',
      strategy: 'cherry_pick_local',
      result: 'merged',
      mergedAt: '2026-07-04T00:20:00.000Z',
      commitSha: 'abc123',
    }
    importedTask.doneSummaryBundle = {
      taskId: importedTask.id,
      status: 'done',
      completedAt: '2026-07-04T00:10:00.000Z',
      summary: {
        journey: 'Worker completed the schema task.',
        decision: 'Task finished as done.',
        evidence: 'build passed.',
        learningCandidates: [],
        openResidue: 'No open residue recorded.',
      },
      retention: {
        transcriptPrimaryArtifact: false,
        compactedFullTranscript: false,
        fullEvidenceAvailable: true,
      },
      evidenceRefs: [],
      createdAt: '2026-07-04T00:10:00.000Z',
      createdBy: 'orchestrator',
    }
    importedTask.notes.push({
      agentId: 'landing-reconciliation',
      role: 'git-story',
      content: 'Marked task done from durable merge evidence after canonical status drifted back to active work.',
      timestamp: '2026-07-04T00:20:00.000Z',
    })
    await writeQueue(q)

    await seedImporterWithSpec(spec)
    const refreshed = await approveWorkspaceImport({
      memoryDir,
      projectPath: tmpDir,
      replacePreviouslyImportedTasks: true,
    })
    expect(refreshed).toMatchObject({ success: true })

    const refreshedTask = (await readQueue()).tasks.find((t) => t.id === 'task-headless-schema')
    expect(refreshedTask).toMatchObject({
      status: 'done',
      completedAt: '2026-07-04T00:10:00.000Z',
      releaseIds: ['nh-headless-mvp'],
    })
    expect(refreshedTask?.notes.some(note => note.content.includes('durable merge evidence'))).toBe(true)
  })

  it('archives dropped imported done work during a full scope refresh', async () => {
    await seedImporterWithSpec(`
\`\`\`yaml
tasks:
  - id: task-current-schema
    title: Define fixture, expected-record, prototype-run, and evaluation schemas.
    description: Current Stage 1 schema task.
    domain: harness
    releaseIds:
      - stage-1-fixture-and-evaluation-harness
    references:
      - docs/harness/implementation-roadmap.md
  - id: task-stale-schema-echo
    title: Implement fixture-and-expected-record schemas (from schema-contract-roadmap)
    description: Old standalone schema echo.
    domain: harness
    releaseIds:
      - stage-1-fixture-and-evaluation-harness
    references:
      - docs/specs/schema-contract-roadmap.md
\`\`\`
`)
    const first = await approveWorkspaceImport({
      memoryDir,
      projectPath: tmpDir,
    })
    expect(first).toMatchObject({ success: true, tasksAdded: 2 })

    const q = await readQueue()
    const stale = q.tasks.find((t) => t.id === 'task-stale-schema-echo')!
    stale.status = 'done'
    stale.completedAt = '2026-07-04T00:00:00.000Z'
    await writeQueue(q)

    await seedImporterWithSpec(`
\`\`\`yaml
tasks:
  - id: task-current-schema
    title: Define fixture, expected-record, prototype-run, and evaluation schemas.
    description: Corrected current Stage 1 schema task.
    domain: harness
    releaseIds:
      - stage-1-fixture-and-evaluation-harness
    references:
      - docs/harness/implementation-roadmap.md
\`\`\`
`)
    const refreshed = await approveWorkspaceImport({
      memoryDir,
      projectPath: tmpDir,
      replacePreviouslyImportedTasks: true,
    })
    expect(refreshed).toMatchObject({ success: true })

    const refreshedQueue = await readQueue()
    expect(refreshedQueue.tasks.find((t) => t.id === 'task-current-schema')).toMatchObject({
      status: 'import_draft',
      releaseIds: ['stage-1-fixture-and-evaluation-harness'],
    })
    expect(refreshedQueue.tasks.find((t) => t.id === 'task-stale-schema-echo')).toMatchObject({
      status: 'archived',
      releaseIds: ['stage-1-fixture-and-evaluation-harness'],
    })
    expect(refreshedQueue.releases?.find(release => release.id === 'stage-1-fixture-and-evaluation-harness')).toMatchObject({
      nodeIds: ['work:task-current-schema'],
    })
  })

  it('preserves exact imported release labels instead of deriving labels from ids', async () => {
    await seedImporterWithSpec(`
\`\`\`yaml
releases:
  - id: 2-0-alpha
    label: 2.0 alpha
    source: release_plan
tasks:
  - id: task-alpha-dry-run
    title: Prove package migration dry run
    description: First task in the documented alpha release.
    domain: packaging
    priority: high
    releaseIds:
      - 2-0-alpha
    references:
      - docs/release-plan.md
\`\`\`
`)

    const res = await approveWorkspaceImport({
      memoryDir,
      projectPath: tmpDir,
    })
    expect(res).toMatchObject({ success: true, tasksAdded: 1 })

    const q = await readQueue()
    expect(q.selectedReleaseId).toBe('2-0-alpha')
    expect(q.releases).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: '2-0-alpha',
        label: '2.0 alpha',
        source: 'release_plan',
      }),
    ]))
    expect(q.releases).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: '2-0-alpha',
        label: '2 0 Alpha',
      }),
    ]))
  })

  it('preserves imported future release state instead of marking every release active', async () => {
    await seedImporterWithSpec(`
\`\`\`yaml
releases:
  - id: stage-1-headless-proof
    label: "Stage 1: Headless Proof"
    source: release_plan
    state: active
  - id: stage-2-authoring-shell
    label: "Stage 2: Authoring Shell"
    source: release_plan
    state: planned
tasks:
  - id: task-headless-runner
    title: Implement headless runner
    description: Current scoped work.
    domain: harness
    releaseIds:
      - stage-1-headless-proof
  - id: task-authoring-shell
    title: Build authoring shell
    description: Later scoped work.
    domain: app
    scope: later
    releaseIds:
      - stage-2-authoring-shell
\`\`\`
`)

    const res = await approveWorkspaceImport({
      memoryDir,
      projectPath: tmpDir,
    })
    expect(res, res.success ? undefined : res.error).toMatchObject({ success: true, tasksAdded: 2 })

    const q = await readQueue()
    expect(q.selectedReleaseId).toBe('stage-1-headless-proof')
    expect(q.releases).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'stage-1-headless-proof',
        state: 'active',
        nodeIds: ['work:task-headless-runner'],
        deferredNodeIds: [],
      }),
      expect.objectContaining({
        id: 'stage-2-authoring-shell',
        state: 'planned',
        nodeIds: [],
        deferredNodeIds: ['work:task-authoring-shell'],
      }),
    ]))
  })

  it('selects the first imported release that actually contains current work', async () => {
    await seedImporterWithSpec(`
\`\`\`yaml
releases:
  - id: stage-0-spec-baseline
    label: "Stage 0: Spec Baseline"
    source: release_plan
    state: active
  - id: stage-1-fixture-and-evaluation-harness
    label: "Stage 1: Fixture And Evaluation Harness"
    source: release_plan
    state: active
  - id: stage-4-local-authoring-shell
    label: "Stage 4: Local Authoring Shell"
    source: release_plan
    state: planned
tasks:
  - id: task-headless-runner
    title: Implement no-UI runner
    description: Current Stage 1 work.
    domain: harness
    releaseIds:
      - stage-1-fixture-and-evaluation-harness
  - id: task-authoring-shell
    title: Build authoring shell
    description: Later UI work.
    domain: app
    scope: later
    releaseIds:
      - stage-4-local-authoring-shell
\`\`\`
`)

    const res = await approveWorkspaceImport({
      memoryDir,
      projectPath: tmpDir,
    })
    expect(res, res.success ? undefined : res.error).toMatchObject({ success: true, tasksAdded: 2 })

    const q = await readQueue()
    expect(q.selectedReleaseId).toBe('stage-1-fixture-and-evaluation-harness')
    expect(q.releases).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'stage-0-spec-baseline',
        nodeIds: [],
      }),
      expect.objectContaining({
        id: 'stage-1-fixture-and-evaluation-harness',
        nodeIds: ['work:task-headless-runner'],
      }),
      expect.objectContaining({
        id: 'stage-4-local-authoring-shell',
        nodeIds: [],
        deferredNodeIds: ['work:task-authoring-shell'],
      }),
    ]))
  })

  it('moves selection off a stale release when imported current work lands in another release', async () => {
    await writeQueue({
      version: 1,
      lastUpdated: '2026-04-01T00:00:00Z',
      selectedReleaseId: 'near-term-proof-scope',
      releases: [{
        id: 'near-term-proof-scope',
        label: 'Near-term proof scope',
        kind: 'current_work',
        state: 'active',
        source: 'inferred',
        proofStyle: 'unspecified',
        nodeIds: ['work:task-old-proof'],
        deferredNodeIds: [],
      }],
      tasks: [TaskQueue.shape.tasks.element.parse({
        id: 'task-old-proof',
        title: 'Finished old proof',
        description: 'Already complete.',
        domain: 'harness',
        projectPath: tmpDir,
        status: 'done',
        priority: 'normal',
        releaseIds: ['near-term-proof-scope'],
        origination: 'human',
        createdAt: '2026-04-01T00:00:00Z',
        updatedAt: '2026-04-01T00:00:00Z',
      })],
    })
    await seedImporterWithSpec(`
\`\`\`yaml
releases:
  - id: stage-1-headless-drafting-and-evaluation-mvp
    label: "Stage 1: Headless Drafting And Evaluation MVP"
    source: release_plan
    state: active
tasks:
  - id: task-deepinfra-model
    title: Select DeepInfra drafting model
    description: Current MVP work.
    domain: harness
    priority: normal
    releaseIds:
      - stage-1-headless-drafting-and-evaluation-mvp
\`\`\`
`)

    const approved = await approveWorkspaceImport({
      memoryDir,
      projectPath: tmpDir,
    })
    expect(approved, approved.success ? undefined : approved.error).toMatchObject({ success: true, tasksAdded: 1 })

    const q = await readQueue()
    expect(q.selectedReleaseId).toBe('stage-1-headless-drafting-and-evaluation-mvp')
  })

  it('normalizes imported evidence paths after narrowing a task to a subproject', async () => {
    const knitPath = path.join(tmpDir, 'knit')
    await fs.mkdir(knitPath, { recursive: true })
    await seedImporterWithSpec(`
\`\`\`yaml
tasks:
  - id: t-invite-flow
    title: Proper invite flow
    description: "knit/PROJECT_STATE.md: - [ ] Proper invite flow"
    domain: knit
    references:
      - knit/PROJECT_STATE.md
\`\`\`
`)

    const res = await approveWorkspaceImport({
      memoryDir,
      projectPath: tmpDir,
      coordinatorProjectPaths: { knit: knitPath },
    })
    expect(res.success).toBe(true)

    const q = await readQueue()
    const newTask = q.tasks.find((t) => t.id === 't-invite-flow')!
    expect(newTask.projectPath).toBe(knitPath)
    expect(newTask.description).toBe('PROJECT_STATE.md: - [ ] Proper invite flow')
    expect(newTask.references).toEqual([path.join(knitPath, 'PROJECT_STATE.md')])
    expect(newTask.notes[0]!.content).toBe(`Imported from: ${path.join(knitPath, 'PROJECT_STATE.md')}`)
  })

  it('maybeSeedWorkspaceImport respects lever=off', async () => {
    const res = await maybeSeedWorkspaceImport({
      memoryDir,
      projectPath: tmpDir,
      inventory: sampleInventory(),
      leverPosition: 'off',
    })
    expect(res.seeded).toBe(false)
    expect(res.outcome).toBe('off')
    const q = await readQueue()
    expect(q.tasks.find((t) => t.id === WORKSPACE_IMPORT_TASK_ID)).toBeUndefined()
  })

  it('maybeSeedWorkspaceImport seeds the reserved task on lever=suggest', async () => {
    const res = await maybeSeedWorkspaceImport({
      memoryDir,
      projectPath: tmpDir,
      inventory: sampleInventory(),
      leverPosition: 'suggest',
    })
    expect(res.seeded).toBe(true)
    expect(res.outcome).toBe('seeded')
    const q = await readQueue()
    expect(q.tasks.find((t) => t.id === WORKSPACE_IMPORT_TASK_ID)).toBeDefined()
  })

  it('maybeSeedWorkspaceImport skips when no signals are found', async () => {
    const res = await maybeSeedWorkspaceImport({
      memoryDir,
      projectPath: tmpDir,
      inventory: invWith([]),
      leverPosition: 'suggest',
    })
    expect(res.seeded).toBe(false)
    expect(res.outcome).toBe('not-needed')
  })

  it('maybeSeedWorkspaceImport reports already-seeded on the second run', async () => {
    const opts = {
      memoryDir,
      projectPath: tmpDir,
      inventory: sampleInventory(),
      leverPosition: 'suggest' as const,
    }
    await maybeSeedWorkspaceImport(opts)
    const second = await maybeSeedWorkspaceImport(opts)
    expect(second.outcome).toBe('already-seeded')
    expect(second.seeded).toBe(true)
  })

  // ---------------------------------------------------------------------
  // FR-34 full pipeline: real files on disk → detect → seed → approve →
  // TASKS.json populated. Every earlier test in this file mocks the
  // inventory; this one runs the real source loaders against fixture files
  // to prove the end-to-end path works on a realistic repo shape.
  // ---------------------------------------------------------------------
  it('FR-34 e2e: fixture files → detect → seed → approve populates TASKS.json', async () => {
    // Lay down a realistic "existing project" on disk.
    await fs.writeFile(
      path.join(tmpDir, 'README.md'),
      [
        '# Acme Widget',
        '',
        'A widget platform for acme-flavored orchestration.',
        '',
        '## Goals',
        '',
        '- Ship the dashboard',
        '- Cut latency in half',
        '',
      ].join('\n'),
      'utf-8',
    )
    await fs.writeFile(
      path.join(tmpDir, 'ROADMAP.md'),
      [
        '# Roadmap',
        '',
        '- [ ] Wire the auth flow',
        '- [ ] Add metric exporter',
        '- [x] Initial scaffold',
        '',
      ].join('\n'),
      'utf-8',
    )
    await fs.writeFile(
      path.join(tmpDir, 'AGENTS.md'),
      '# Agents\n\nConventions: run pnpm test before every commit.\n',
      'utf-8',
    )

    // Run the full pipeline: detect happens inside maybeSeedWorkspaceImport.
    const seeded = await import('../workspace-importer.js').then((m) =>
      m.maybeSeedWorkspaceImport({
        memoryDir,
        projectPath: tmpDir,
        leverPosition: 'suggest',
      }),
    )
    expect(seeded.outcome).toBe('seeded')
    expect(seeded.seeded).toBe(true)

    // Real sources produced real signals.
    const sources = new Set(seeded.inventory.signals.map((s) => s.source))
    expect(sources.has('readme')).toBe(true)
    expect(sources.has('roadmap')).toBe(true)

    // Draft carries the ROADMAP open items as tasks and the README goal.
    expect(seeded.draft.tasks.length).toBeGreaterThan(0)
    expect(seeded.draft.goals.length).toBeGreaterThan(0)
    expect(seeded.draft.milestones.length).toBeGreaterThan(0) // `[x] Initial scaffold`

    // Importer task exists in `exploring` with origination=system.
    const qAfterSeed = await readQueue()
    const importer = qAfterSeed.tasks.find(
      (t) => t.id === WORKSPACE_IMPORT_TASK_ID,
    )!
    expect(importer.status).toBe('exploring')
    expect(importer.origination).toBe('system')

    // Simulate the importer agent promoting the draft into the YAML-fence
    // output format by building fences directly from the real draft. Using
    // the draft (rather than hand-rolled fences) is what makes this an
    // actual end-to-end proof: the data that reaches approve() is what the
    // detector + hypothesis formed from the real files.
    const yamlTaskBlock = seeded.draft.tasks
      .map((t) => {
        const lines = [
          `  - id: ${t.suggestedId}`,
          `    title: ${JSON.stringify(t.title)}`,
          `    description: ${JSON.stringify(t.description)}`,
          `    domain: ${t.domain}`,
          `    priority: ${t.priority}`,
        ]
        const refs = t.references ?? []
        if (refs.length) {
          lines.push('    references:')
          for (const ref of refs) lines.push(`      - ${JSON.stringify(ref)}`)
        }
        return lines.join('\n')
      })
      .join('\n')
    const yamlGoalBlock = seeded.draft.goals
      .map(
        (g) =>
          `  - id: ${g.id}\n    title: ${JSON.stringify(g.title)}\n    rationale: ${JSON.stringify(g.rationale)}`,
      )
      .join('\n')
    const yamlMilestoneBlock = seeded.draft.milestones
      .map(
        (m) =>
          `  - title: ${JSON.stringify(m.title)}\n    evidence: ${JSON.stringify(m.evidence)}`,
      )
      .join('\n')
    importer.spec = [
      '```yaml',
      'goals:',
      yamlGoalBlock,
      '```',
      '',
      '```yaml',
      'tasks:',
      yamlTaskBlock,
      '```',
      '',
      '```yaml',
      'milestones:',
      yamlMilestoneBlock,
      '```',
    ].join('\n')
    await writeQueue(qAfterSeed)

    // Approve → tasks merged, goals persisted, milestones logged.
    const approved = await approveWorkspaceImport({ memoryDir, projectPath: tmpDir })
    expect(approved.success).toBe(true)
    expect(approved.tasksAdded).toBe(seeded.draft.tasks.length)
    expect(approved.goalsRecorded).toBe(seeded.draft.goals.length)
    expect(approved.milestonesLogged).toBe(seeded.draft.milestones.length)

    const qFinal = await readQueue()

    // Importer task is done.
    expect(
      qFinal.tasks.find((t) => t.id === WORKSPACE_IMPORT_TASK_ID)?.status,
    ).toBe('done')

    // Every drafted task landed in intake + origination=human. The approve
    // click imports candidates; the spec agent still has to shape them.
    for (const t of seeded.draft.tasks) {
      const landed = qFinal.tasks.find((x) => x.id === t.suggestedId)
      expect(landed, `task ${t.suggestedId}`).toBeDefined()
      expect(landed!.status).toBe('import_draft')
      expect(landed!.origination).toBe('human')
      expect(landed!.references).toEqual(t.references ?? [])
    }

    // workspace-goals.json persisted with every goal.
    const goalsPersisted = await readProjectStateJsonAsync<{
      version: number
      goals: unknown[]
      tasks: unknown[]
      milestones: unknown[]
      approved: {
        taskCount: number
        currentTaskCount: number
        laterTaskCount: number
        currentTaskIds: string[]
        laterTaskIds: string[]
      }
      detected: {
        taskCount: number
        currentTaskCount: number
        laterTaskCount: number
        currentTaskIds: string[]
        laterTaskIds: string[]
      } | null
    }>(tmpDir, 'workspace-goals.json')
    expect(goalsPersisted.version).toBe(3)
    expect(goalsPersisted.goals).toHaveLength(seeded.draft.goals.length)
    expect(goalsPersisted.tasks).toHaveLength(seeded.draft.tasks.length)
    expect(goalsPersisted.milestones).toHaveLength(seeded.draft.milestones.length)
    expect(goalsPersisted.approved.taskCount).toBe(seeded.draft.tasks.length)
    expect(goalsPersisted.approved.currentTaskCount + goalsPersisted.approved.laterTaskCount).toBe(seeded.draft.tasks.length)
    expect(goalsPersisted.approved.currentTaskIds).toEqual(
      seeded.draft.tasks.filter(task => task.scope !== 'later').map(task => task.suggestedId),
    )
    expect(goalsPersisted.approved.laterTaskIds).toEqual(
      seeded.draft.tasks.filter(task => task.scope === 'later').map(task => task.suggestedId),
    )
    expect(goalsPersisted.detected?.taskCount ?? 0).toBe(seeded.draft.tasks.length)

    // PROGRESS.md logs every completed milestone (e.g. "Initial scaffold").
    const progress = await readProjectStateTextAsync(tmpDir, 'PROGRESS.md')
    for (const m of seeded.draft.milestones) {
      expect(progress).toContain(m.title)
    }
  })

  it('detects schema-surface gaps before importing a mature Supabase project', async () => {
    await fs.mkdir(path.join(tmpDir, 'supabase/migrations'), { recursive: true })
    await fs.mkdir(path.join(tmpDir, 'frontend/supabase/migrations'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'supabase/migrations/001_initial.sql'),
      [
        'CREATE TABLE software (id uuid primary key);',
        'CREATE TABLE transactions (id uuid primary key, software_id uuid references software(id));',
        'CREATE TABLE eligibility_checks (id uuid primary key, software_id uuid references software(id));',
        'CREATE OR REPLACE FUNCTION check_user_eligibility(p_user_id uuid, p_software_id uuid)',
        'RETURNS TABLE (is_eligible boolean, reason text) AS $$ BEGIN END; $$ LANGUAGE plpgsql;',
      ].join('\n'),
      'utf-8',
    )
    await fs.writeFile(
      path.join(tmpDir, 'frontend/supabase/migrations/001_payments.sql'),
      [
        'CREATE TABLE projects (id uuid primary key);',
        'CREATE TABLE payments (id uuid primary key, project_id uuid references projects(id));',
        'CREATE TABLE stripe_accounts (id uuid primary key, stripe_account_id text unique);',
      ].join('\n'),
      'utf-8',
    )

    const inventory = await detectWorkspaceSignals({ projectPath: tmpDir })
    const draft = formWorkspaceHypothesis(inventory)

    expect(inventory.ran).toContain('schema-surface')
    expect(draft.context.some((c) => c.label.includes('Database schema surface'))).toBe(true)
    expect(draft.tasks.map((t) => t.title)).toEqual(
      expect.arrayContaining([
        'Resolve software/projects schema naming split',
        'Resolve transactions/payments schema split',
        'Wire eligibility checks through the application flow',
      ]),
    )
  })

  it('backfills current-vs-later task membership when reading a legacy workspace goals snapshot', () => {
    const state = parseWorkspaceGoalsState({
      version: 3,
      recordedAt: '2026-06-18T12:00:00.000Z',
      goals: [],
      tasks: [
        {
          id: 'task-current',
          title: 'Current task',
          description: 'Current task.',
          domain: 'harness',
          priority: 'high',
          references: ['docs/harness/implementation-roadmap.md'],
        },
        {
          id: 'task-later',
          title: 'Later task',
          description: 'Later task.',
          domain: 'coherence',
          priority: 'normal',
          references: ['docs/harness/remaining-spec-decomposition-inventory.md'],
          scope: 'later',
        },
      ],
      milestones: [],
      context: [],
      approved: {
        goalCount: 0,
        taskCount: 2,
        milestoneCount: 0,
        currentTaskCount: 1,
        laterTaskCount: 1,
        taskIds: ['task-current', 'task-later'],
      },
      detected: null,
    })

    expect(state?.approved.currentTaskIds).toEqual(['task-current'])
    expect(state?.approved.laterTaskIds).toEqual(['task-later'])
    expect(state?.approved.currentTaskCount).toBe(1)
    expect(state?.approved.laterTaskCount).toBe(1)
  })

  it('requires structural refresh when a versioned goals snapshot still lacks durable task-scope membership', () => {
    const state = parseWorkspaceGoalsState({
      version: 3,
      recordedAt: '2026-06-18T12:00:00.000Z',
      goals: [],
      tasks: [
        {
          id: 'task-current',
          title: 'Current task',
          description: 'Current task.',
          domain: 'harness',
          priority: 'high',
          references: ['docs/harness/implementation-roadmap.md'],
        },
      ],
      milestones: [],
      context: [
        {
          label: 'Stage 1: Fixture And Evaluation Harness',
          excerpt: 'Current milestone.',
          source: 'planning-docs',
          role: 'capability',
          structure: 'record',
          scopeHint: 'current',
        },
      ],
      approved: {
        goalCount: 0,
        taskCount: 1,
        milestoneCount: 0,
        currentTaskCount: 1,
        laterTaskCount: 0,
        taskIds: ['task-current'],
      },
      detected: null,
    })

    expect(workspaceGoalsNeedStructuralRefresh(state)).toBe(true)
  })

  it('does not require structural refresh for fresh capability notes with explicit task-scope membership', () => {
    const state = parseWorkspaceGoalsState({
      version: 3,
      recordedAt: '2026-06-18T12:00:00.000Z',
      goals: [],
      tasks: [],
      milestones: [],
      context: [
        {
          label: 'Mastra workflow for the prototype iteration loop',
          excerpt: 'Future-stage capability note.',
          source: 'planning-docs',
          role: 'capability',
          scopeHint: 'later',
        },
      ],
      approved: {
        goalCount: 0,
        taskCount: 2,
        milestoneCount: 0,
        currentTaskCount: 1,
        laterTaskCount: 1,
        taskIds: ['task-current', 'task-later'],
        currentTaskIds: ['task-current'],
        laterTaskIds: ['task-later'],
      },
      detected: null,
    })

    expect(state?.scopeMembershipHydrated).toBeUndefined()
    expect(workspaceGoalsNeedStructuralRefresh(state)).toBe(false)
  })

  it('preserves current-vs-later task ids when summarizing an importer spec', () => {
    const summary = summarizeWorkspaceImportSpec([
      '```yaml',
      'tasks:',
      '  - id: task-current',
      '    title: "Current task"',
      '    description: "Current task."',
      '    domain: "harness"',
      '    priority: high',
      '  - id: task-later',
      '    title: "Later task"',
      '    description: "Later task."',
      '    domain: "coherence"',
      '    scope: later',
      '    priority: normal',
      '```',
    ].join('\n'))

    expect(summary).toMatchObject({
      taskIds: ['task-current', 'task-later'],
      currentTaskIds: ['task-current'],
      laterTaskIds: ['task-later'],
      currentTaskCount: 1,
      laterTaskCount: 1,
    })
  })

  it('detects stage deliverables, current milestone tasks, and decomposition inventory recommendations from prose docs', async () => {
    await fs.mkdir(path.join(tmpDir, 'docs/harness'), { recursive: true })
    await fs.mkdir(path.join(tmpDir, 'docs/specs'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'docs/harness/implementation-roadmap.md'),
      [
        '# Implementation Roadmap',
        '',
        '## Stage 1: Fixture And Evaluation Harness',
        '',
        'Goal: build a no-UI test harness that proves story-memory and packet contracts against small fiction fixtures before any product UI is designed.',
        '',
        'Deliverables:',
        '',
        '- fixture directory shape for at least one small story fixture',
        '- typed fixture and expected-record contracts',
        '',
        '## Current Next Milestone',
        '',
        'The next milestone is Stage 1: Fixture And Evaluation Harness.',
        '',
        'The first Guildhall starter tasks should be:',
        '',
        '1. Define fixture, expected-record, prototype-run, and evaluation schemas.',
        '2. Add the first tiny fiction fixture and human-authored',
        '   expected records.',
      ].join('\n'),
      'utf-8',
    )
    await fs.writeFile(
      path.join(tmpDir, 'docs/harness/remaining-spec-decomposition-inventory.md'),
      [
        '# Remaining Spec Decomposition Inventory',
        '',
        '### 2.2 `dialogue-and-character-voice.md`',
        '',
        '- **Recommended first task title:** Implement dialogue-and-character-voice reviewer lane',
        '- **Recommended domain:** coherence',
        '- **Stage alignment:** Stage 2 (Agent Coordination)',
      ].join('\n'),
      'utf-8',
    )
    await fs.writeFile(
      path.join(tmpDir, 'docs/specs/dialogue-and-character-voice.md'),
      [
        '# Dialogue And Character Voice',
        '',
        'Protect distinct speaking patterns while preserving the author voice envelope.',
      ].join('\n'),
      'utf-8',
    )

    const inventory = await detectWorkspaceSignals({ projectPath: tmpDir })
    const draft = formWorkspaceHypothesis(inventory)

    expect(draft.tasks.map((task) => task.title)).toEqual(
      expect.arrayContaining([
        'Define fixture, expected-record, prototype-run, and evaluation schemas.',
        'Add the first tiny fiction fixture and human-authored expected records.',
      ]),
    )
    expect(draft.tasks.map(task => task.title)).not.toEqual(
      expect.arrayContaining([
        'fixture directory shape for at least one small story fixture',
        'typed fixture and expected-record contracts',
      ]),
    )
    expect(draft.context).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: 'fixture directory shape for at least one small story fixture',
        role: 'capability',
      }),
      expect.objectContaining({
        label: 'typed fixture and expected-record contracts',
        role: 'capability',
      }),
    ]))
    expect(draft.tasks.find((task) => task.title === 'Implement dialogue-and-character-voice reviewer lane')).toBeUndefined()
    expect(draft.context).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: 'Spec: Dialogue And Character Voice',
        role: 'capability',
        domain: 'coherence',
        scopeHint: 'later',
        references: expect.arrayContaining([
          expect.stringContaining('docs/specs/dialogue-and-character-voice.md'),
          expect.stringContaining('docs/harness/remaining-spec-decomposition-inventory.md'),
        ]),
      }),
    ]))
  })

  it('imports later-scope workspace tasks as shelved instead of current intake drafts', async () => {
    await seedImporterWithSpec(`
\`\`\`yaml
tasks:
  - id: task-current
    title: Build current packet runner
    description: Build the current-scope packet runner.
    domain: harness
    priority: high
  - id: task-later
    title: Implement dialogue-and-character-voice reviewer lane
    description: Implement the later reviewer lane after the current harness loop is proven.
    domain: coherence
    scope: later
    priority: normal
    references:
      - docs/harness/remaining-spec-decomposition-inventory.md
\`\`\`
`)

    const res = await approveWorkspaceImport({
      memoryDir,
      projectPath: tmpDir,
    })
    expect(res.tasksAdded).toBe(2)

    const q = await readQueue()
    expect(q.tasks.find((t) => t.id === 'task-current')?.status).toBe('import_draft')
    expect(q.tasks.find((t) => t.id === 'task-later')).toMatchObject({
      status: 'shelved',
      origination: 'human',
    })
    expect(q.tasks.find((t) => t.id === 'task-later')?.notes?.[0]?.content ?? '').toContain('Scope: later/deferred')
  })

  it('persists the approved effective draft as the importer spec when approval uses a draft override', async () => {
    await fs.mkdir(path.join(tmpDir, 'docs/harness'), { recursive: true })
    await fs.mkdir(path.join(tmpDir, 'docs/specs'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'docs/harness/implementation-roadmap.md'),
      [
        '# Implementation Roadmap',
        '',
        '## Stage 1: Fixture And Evaluation Harness',
        '',
        'Goal: build a no-UI test harness that proves story-memory and packet contracts against small fiction fixtures before any product UI is designed.',
        '',
        '## Current Next Milestone',
        '',
        'The next milestone is Stage 1: Fixture And Evaluation Harness.',
        '',
        '1. Define fixture, expected-record, prototype-run, and evaluation schemas.',
      ].join('\n'),
      'utf-8',
    )
    await fs.writeFile(
      path.join(tmpDir, 'docs/specs/schema-contract-roadmap.md'),
      '# Schema Contract Roadmap\n\nFixture contracts should stay typed.\n',
      'utf-8',
    )
    await seedImporterWithSpec(`
\`\`\`yaml
tasks:
  - id: task-stale
    title: stale imported bullet
    description: stale imported bullet
    domain: core
\`\`\`
`)

    const draftOverride: WorkspaceImportDraft = {
      goals: [
        {
          id: 'goal-story-intelligence',
          title: 'Build first headless story-intelligence MVP',
          rationale: 'The current release is the first headless proof of the fiction workflow.',
          source: 'workspace-importer',
          confidence: 'high',
        },
      ],
      tasks: [
        {
          suggestedId: 'task-import-schema',
          title: 'Define fixture, expected-record, prototype-run, and evaluation schemas.',
          description: '1. Define fixture, expected-record, prototype-run, and evaluation schemas.',
          whyThisMayMatter: 'This is the first bounded Stage 1 proof task.',
          domain: 'harness',
          scope: 'current',
          priority: 'high',
          assumptions: ['The roadmap still defines the current milestone.'],
          missingInformation: ['Success proof still needs to be attached after shaping.'],
          references: ['docs/harness/implementation-roadmap.md', 'docs/specs/schema-contract-roadmap.md'],
          source: 'workspace-importer',
          confidence: 'high',
        },
      ],
      milestones: [
        {
          title: 'Stage 1: Fixture And Evaluation Harness',
          evidence: 'docs/harness/implementation-roadmap.md: The next milestone is Stage 1: Fixture And Evaluation Harness.',
          source: 'workspace-importer',
          confidence: 'high',
        },
      ],
      context: [],
      stats: {
        inputSignals: 2,
        drafted: 1,
        deduped: 0,
      },
    }

    const approved = await approveWorkspaceImport({
      memoryDir,
      projectPath: tmpDir,
      draftOverride,
    })
    expect(approved).toMatchObject({ success: true, tasksAdded: 1 })

    const q = await readQueue()
    const importerTask = q.tasks.find(task => task.id === WORKSPACE_IMPORT_TASK_ID)
    expect(importerTask?.spec).not.toBe(formatDetectedDraftAsSpec(draftOverride))

    const reparsed = parseWorkspaceImport(importerTask?.spec ?? '')
    expect(reparsed.goals).toMatchObject([
      {
        id: 'goal-story-intelligence',
        title: 'Build first headless story-intelligence MVP',
      },
    ])
    expect(reparsed.tasks).toMatchObject([
      {
        id: 'task-import-schema',
        title: 'Define fixture, expected-record, prototype-run, and evaluation schemas.',
        references: [
          'docs/harness/implementation-roadmap.md',
          'docs/specs/schema-contract-roadmap.md',
        ],
        acceptanceCriteria: expect.arrayContaining([
          expect.objectContaining({ id: 'contracts-defined' }),
          expect.objectContaining({ id: 'deterministic-proof' }),
        ]),
        proofPaths: [
          expect.objectContaining({ kind: 'review', source: 'inferred' }),
        ],
      },
    ])
    expect(reparsed.tasks[0]?.missingInformation ?? []).not.toContain(
      'Guildhall still needs to confirm scope, current relevance, and success criteria during shaping.',
    )
    expect((reparsed.tasks[0]?.references ?? []).every(reference => !path.isAbsolute(reference))).toBe(true)
  })

  it('archives stale importer-generated draft residue during a full scope replacement refresh', async () => {
    await writeQueue({
      version: 1,
      lastUpdated: new Date().toISOString(),
      tasks: [
        {
          id: WORKSPACE_IMPORT_TASK_ID,
          title: 'Review existing project work',
          description: 'Reserved importer',
          domain: WORKSPACE_IMPORT_DOMAIN,
          projectPath: tmpDir,
          status: 'spec_review',
          priority: 'high',
          spec: '',
          acceptanceCriteria: [],
          dependsOn: [],
          outOfScope: [],
          notes: [],
          gateResults: [],
          reviewVerdicts: [],
          adjudications: [],
          escalations: [],
          agentIssues: [],
          revisionCount: 0,
          remediationAttempts: 0,
          origination: 'system',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'task-stale-import',
          title: '*(none — umbrella doc, covered by child specs)*',
          description: 'Old importer residue.',
          domain: 'core',
          projectPath: tmpDir,
          status: 'import_draft',
          priority: 'normal',
          acceptanceCriteria: [],
          dependsOn: [],
          outOfScope: [],
          notes: [],
          gateResults: [],
          reviewVerdicts: [],
          adjudications: [],
          escalations: [],
          agentIssues: [],
          revisionCount: 0,
          remediationAttempts: 0,
          origination: 'human',
          requestIntake: {
            intent: 'spec_only',
            recommendedNextAction: 'draft_spec',
            componentStack: [],
            assumptions: [],
            missingInformation: [],
            evidenceRefs: [],
            pressureTestSummary: {
              systemOwned: true,
              degree: 'guided',
              qualityBar: 'Treat imported drafts as candidate work that must be reshaped against current evidence before implementation starts.',
              ownerQuestionPolicy: 'Only ask when the imported evidence is no longer enough to choose a trustworthy task boundary or success condition.',
              checks: [],
            },
            clarifyingQuestions: [],
            createdAt: new Date().toISOString(),
            createdBy: 'workspace-importer',
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        } as Task,
        {
          id: 'task-stale-spec-review',
          title: 'Mastra workflow for the prototype iteration loop',
          description: 'Old importer residue that already advanced to spec review.',
          domain: 'harness',
          projectPath: tmpDir,
          status: 'spec_review',
          priority: 'high',
          acceptanceCriteria: [],
          dependsOn: [],
          outOfScope: [],
          notes: [],
          gateResults: [],
          reviewVerdicts: [],
          adjudications: [],
          escalations: [],
          agentIssues: [],
          revisionCount: 0,
          remediationAttempts: 0,
          origination: 'human',
          requestIntake: {
            intent: 'implementation',
            recommendedNextAction: 'proceed_to_implementation_spec',
            componentStack: [],
            assumptions: [],
            missingInformation: [],
            evidenceRefs: [],
            pressureTestSummary: {
              systemOwned: true,
              degree: 'guided',
              qualityBar: 'Carry imported project evidence forward into a reviewable implementation blueprint before execution starts.',
              ownerQuestionPolicy: 'Only ask when the cited evidence conflicts strongly enough to change product intent or the active task scope.',
              checks: [],
            },
            clarifyingQuestions: [],
            createdAt: new Date().toISOString(),
            createdBy: 'workspace-importer',
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        } as Task,
      ],
    })

    const draftOverride: WorkspaceImportDraft = {
      goals: [],
      tasks: [
        {
          suggestedId: 'task-import-schema',
          title: 'Define fixture, expected-record, prototype-run, and evaluation schemas.',
          description: '1. Define fixture, expected-record, prototype-run, and evaluation schemas.',
          domain: 'harness',
          scope: 'current',
          priority: 'high',
          references: ['docs/harness/implementation-roadmap.md'],
          source: 'workspace-importer',
          confidence: 'high',
        },
      ],
      milestones: [],
      context: [],
      stats: {
        inputSignals: 1,
        drafted: 1,
        deduped: 0,
      },
    }

    const approved = await approveWorkspaceImport({
      memoryDir,
      projectPath: tmpDir,
      draftOverride,
      replacePreviouslyImportedTasks: true,
    })
    expect(approved).toMatchObject({ success: true, tasksAdded: 1 })

    const q = await readQueue()
    expect(q.tasks.find(task => task.id === 'task-stale-import')).toMatchObject({
      status: 'archived',
    })
    expect(q.tasks.find(task => task.id === 'task-stale-spec-review')).toMatchObject({
      status: 'archived',
    })
    expect(q.tasks.find(task => task.id === 'task-stale-import')?.notes?.at(-1)?.content ?? '').toContain(
      'no longer part of the approved import scope',
    )
  })

  it('does not let evidence-graph expansion revive umbrella placeholders during approval', async () => {
    await fs.mkdir(path.join(tmpDir, 'docs/harness'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'docs/harness/remaining-spec-decomposition-inventory.md'),
      [
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
      'utf8',
    )

    await writeQueue({
      version: 1,
      lastUpdated: new Date().toISOString(),
      tasks: [
        {
          id: WORKSPACE_IMPORT_TASK_ID,
          title: 'Review existing project work',
          description: 'Reserved importer',
          domain: WORKSPACE_IMPORT_DOMAIN,
          projectPath: tmpDir,
          status: 'spec_review',
          priority: 'high',
          spec: '',
          acceptanceCriteria: [],
          dependsOn: [],
          outOfScope: [],
          notes: [],
          gateResults: [],
          reviewVerdicts: [],
          adjudications: [],
          escalations: [],
          agentIssues: [],
          revisionCount: 0,
          remediationAttempts: 0,
          origination: 'system',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'task-stale-import',
          title: '*(none — umbrella doc, covered by child specs)*',
          description: 'Old umbrella residue.',
          domain: 'core',
          projectPath: tmpDir,
          status: 'import_draft',
          priority: 'normal',
          acceptanceCriteria: [],
          dependsOn: [],
          outOfScope: [],
          notes: [],
          gateResults: [],
          reviewVerdicts: [],
          adjudications: [],
          escalations: [],
          agentIssues: [],
          revisionCount: 0,
          remediationAttempts: 0,
          origination: 'human',
          requestIntake: {
            intent: 'spec_only',
            recommendedNextAction: 'draft_spec',
            componentStack: [],
            assumptions: [],
            missingInformation: [],
            evidenceRefs: [],
            pressureTestSummary: {
              systemOwned: true,
              degree: 'guided',
              qualityBar: 'Treat imported drafts as candidate work that must be reshaped against current evidence before implementation starts.',
              ownerQuestionPolicy: 'Only ask when the imported evidence is no longer enough to choose a trustworthy task boundary or success condition.',
              checks: [],
            },
            clarifyingQuestions: [],
            createdAt: new Date().toISOString(),
            createdBy: 'workspace-importer',
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        } as Task,
      ],
    })

    const approved = await approveWorkspaceImport({
      memoryDir,
      projectPath: tmpDir,
      draftOverride: {
        goals: [],
        tasks: [
          {
            suggestedId: 'task-dialogue-lane',
            title: 'Implement dialogue-and-character-voice reviewer lane',
            description: 'Build the first reviewer lane from the decomposition inventory.',
            domain: 'coherence',
            scope: 'current',
            priority: 'high',
            references: ['docs/harness/remaining-spec-decomposition-inventory.md'],
            source: 'planning-docs',
            confidence: 'high',
          },
        ],
        milestones: [],
        context: [],
        stats: {
          inputSignals: 1,
          drafted: 1,
          deduped: 0,
        },
      },
      replacePreviouslyImportedTasks: true,
    })

    expect(approved).toMatchObject({ success: true, tasksAdded: 1 })

    const q = await readQueue()
    expect(q.tasks.find(task => task.id === 'task-stale-import')).toMatchObject({
      status: 'archived',
    })
    expect(
      q.tasks
        .filter(task => task.status !== 'archived')
        .map(task => task.title),
    ).not.toContain('*(none — umbrella doc, covered by child specs)*')
    expect(q.tasks.find(task => task.id === 'task-dialogue-lane')).toMatchObject({
      status: 'spec_review',
    })
  })

  it('archives previously imported work that is no longer part of the approved import set', async () => {
    await writeQueue({
      version: 1,
      lastUpdated: new Date().toISOString(),
      tasks: [
        {
          id: WORKSPACE_IMPORT_TASK_ID,
          title: 'Review existing project work',
          description: 'Reserved importer',
          domain: WORKSPACE_IMPORT_DOMAIN,
          projectPath: tmpDir,
          status: 'spec_review',
          priority: 'high',
          spec: '',
          acceptanceCriteria: [],
          dependsOn: [],
          outOfScope: [],
          notes: [],
          gateResults: [],
          reviewVerdicts: [],
          adjudications: [],
          escalations: [],
          agentIssues: [],
          revisionCount: 0,
          remediationAttempts: 0,
          origination: 'system',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'task-import-stage-two',
          title: 'Mastra workflow for the prototype iteration loop',
          description: 'Imported once from Stage 2 roadmap work.',
          domain: 'harness',
          projectPath: tmpDir,
          status: 'spec_review',
          priority: 'normal',
          acceptanceCriteria: [],
          dependsOn: [],
          outOfScope: [],
          notes: [],
          gateResults: [],
          reviewVerdicts: [],
          adjudications: [],
          escalations: [],
          agentIssues: [],
          revisionCount: 0,
          remediationAttempts: 0,
          origination: 'human',
          requestIntake: {
            intent: 'spec_only',
            recommendedNextAction: 'draft_spec',
            componentStack: [],
            assumptions: [],
            missingInformation: [],
            evidenceRefs: ['import:/repo/docs/harness/implementation-roadmap.md'],
            pressureTestSummary: {
              systemOwned: true,
              degree: 'guided',
              qualityBar: 'Imported work should stay structurally visible until it truly leaves the docs.',
              ownerQuestionPolicy: 'Only ask when scope intent actually changes.',
              checks: [],
            },
            clarifyingQuestions: [],
            createdAt: new Date().toISOString(),
            createdBy: 'workspace-importer',
          },
          references: ['/repo/docs/harness/implementation-roadmap.md'],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        } as Task,
        {
          id: 'task-import-legacy-stage-two',
          title: 'Implement dialogue-and-character-voice reviewer lane',
          description: 'Imported before workspace-import requestIntake metadata existed.',
          domain: 'harness',
          projectPath: tmpDir,
          status: 'shelved',
          priority: 'normal',
          acceptanceCriteria: [],
          dependsOn: [],
          outOfScope: [],
          notes: [],
          gateResults: [],
          reviewVerdicts: [],
          adjudications: [],
          escalations: [],
          agentIssues: [],
          revisionCount: 0,
          remediationAttempts: 0,
          origination: 'human',
          references: ['/repo/docs/harness/remaining-spec-decomposition-inventory.md'],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        } as Task,
      ],
    })

    const approved = await approveWorkspaceImport({
      memoryDir,
      projectPath: tmpDir,
      draftOverride: {
        goals: [],
        tasks: [
          {
            suggestedId: 'task-import-schema',
            title: 'Define fixture, expected-record, prototype-run, and evaluation schemas.',
            description: 'Current Stage 1 slice.',
            domain: 'harness',
            scope: 'current',
            priority: 'high',
            references: ['/repo/docs/harness/implementation-roadmap.md'],
            source: 'planning-docs',
            confidence: 'high',
          },
        ],
        milestones: [],
        context: [],
        stats: {
          inputSignals: 1,
          drafted: 1,
          deduped: 0,
        },
      },
      detectedDraftSnapshot: {
        goals: [],
        tasks: [
          {
            suggestedId: 'task-import-schema',
            title: 'Define fixture, expected-record, prototype-run, and evaluation schemas.',
            description: 'Current Stage 1 slice.',
            domain: 'harness',
            scope: 'current',
            priority: 'high',
            references: ['/repo/docs/harness/implementation-roadmap.md'],
            source: 'planning-docs',
            confidence: 'high',
          },
        ],
        milestones: [],
        context: [],
        stats: {
          inputSignals: 2,
          drafted: 2,
          deduped: 0,
        },
      },
      replacePreviouslyImportedTasks: true,
    })

    expect(approved).toMatchObject({ success: true, tasksAdded: 1 })

    const q = await readQueue()
    expect(q.tasks.find(task => task.id === 'task-import-stage-two')).toMatchObject({
      status: 'archived',
    })
    expect(q.tasks.find(task => task.id === 'task-import-stage-two')?.notes?.at(-1)?.content ?? '').toContain(
      'no longer part of the approved import scope',
    )
    expect(q.tasks.find(task => task.id === 'task-import-legacy-stage-two')).toMatchObject({
      status: 'archived',
    })
  })

  it('archives generated split descendants when an imported parent is removed from the approved import scope', async () => {
    const now = new Date().toISOString()
    await writeQueue({
      version: 1,
      lastUpdated: now,
      tasks: [
        {
          id: WORKSPACE_IMPORT_TASK_ID,
          title: 'Review existing project work',
          description: 'Reserved importer',
          domain: WORKSPACE_IMPORT_DOMAIN,
          projectPath: tmpDir,
          status: 'spec_review',
          priority: 'high',
          spec: '',
          acceptanceCriteria: [],
          dependsOn: [],
          outOfScope: [],
          notes: [],
          gateResults: [],
          reviewVerdicts: [],
          adjudications: [],
          escalations: [],
          agentIssues: [],
          revisionCount: 0,
          remediationAttempts: 0,
          origination: 'system',
          createdAt: now,
          updatedAt: now,
        },
        {
          id: 'task-old-parent',
          title: 'Mastra workflow for the prototype iteration loop',
          description: 'Old imported later-stage task.',
          domain: 'harness',
          projectPath: tmpDir,
          status: 'shelved',
          priority: 'normal',
          acceptanceCriteria: [],
          dependsOn: [],
          outOfScope: [],
          notes: [],
          gateResults: [],
          reviewVerdicts: [],
          adjudications: [],
          escalations: [],
          agentIssues: [],
          revisionCount: 0,
          remediationAttempts: 0,
          origination: 'human',
          requestIntake: {
            intent: 'implementation',
            recommendedNextAction: 'proceed_to_implementation_spec',
            componentStack: [],
            assumptions: [],
            missingInformation: [],
            evidenceRefs: ['import:/repo/docs/harness/implementation-roadmap.md'],
            pressureTestSummary: {
              systemOwned: true,
              degree: 'guided',
              qualityBar: 'Imported work must stay aligned with the current roadmap slice.',
              ownerQuestionPolicy: 'Only ask when the docs still leave the scope boundary ambiguous.',
              checks: [],
            },
            clarifyingQuestions: [],
            createdAt: now,
            createdBy: 'workspace-importer',
          },
          hierarchy: {
            childIds: ['task-old-parent-split-a'],
            relation: 'contains',
            order: 0,
          },
          createdAt: now,
          updatedAt: now,
        } as Task,
        {
          id: 'task-old-parent-split-a',
          title: 'Run the bounded reviewer and writer loop headlessly',
          description: 'Generated child from the old imported parent.',
          domain: 'harness',
          projectPath: tmpDir,
          status: 'exploring',
          priority: 'normal',
          acceptanceCriteria: [],
          dependsOn: [],
          outOfScope: [],
          notes: [{ agentId: 'task-sizing', role: 'system', timestamp: now, content: 'Generated split child.' }],
          gateResults: [],
          reviewVerdicts: [],
          adjudications: [],
          escalations: [],
          agentIssues: [],
          revisionCount: 0,
          remediationAttempts: 0,
          origination: 'system',
          hierarchy: {
            parentId: 'task-old-parent',
            relation: 'contains',
            order: 0,
          },
          createdAt: now,
          updatedAt: now,
        } as Task,
      ],
    })

    const approved = await approveWorkspaceImport({
      memoryDir,
      projectPath: tmpDir,
      draftOverride: {
        goals: [],
        tasks: [
          {
            suggestedId: 'task-import-schema',
            title: 'Define fixture, expected-record, prototype-run, and evaluation schemas.',
            description: 'Current Stage 1 slice.',
            domain: 'harness',
            scope: 'current',
            priority: 'high',
            references: ['/repo/docs/harness/implementation-roadmap.md'],
            source: 'planning-docs',
            confidence: 'high',
          },
        ],
        milestones: [],
        context: [],
        stats: {
          inputSignals: 1,
          drafted: 1,
          deduped: 0,
        },
      },
      detectedDraftSnapshot: {
        goals: [],
        tasks: [
          {
            suggestedId: 'task-import-schema',
            title: 'Define fixture, expected-record, prototype-run, and evaluation schemas.',
            description: 'Current Stage 1 slice.',
            domain: 'harness',
            scope: 'current',
            priority: 'high',
            references: ['/repo/docs/harness/implementation-roadmap.md'],
            source: 'planning-docs',
            confidence: 'high',
          },
        ],
        milestones: [],
        context: [],
        stats: {
          inputSignals: 1,
          drafted: 1,
          deduped: 0,
        },
      },
      replacePreviouslyImportedTasks: true,
    })

    expect(approved).toMatchObject({ success: true, tasksAdded: 1 })

    const q = await readQueue()
    expect(q.tasks.find(task => task.id === 'task-old-parent')).toMatchObject({
      status: 'archived',
    })
    expect(q.tasks.find(task => task.id === 'task-old-parent-split-a')).toMatchObject({
      status: 'archived',
    })
    expect(q.tasks.find(task => task.id === 'task-old-parent-split-a')?.hierarchy?.parentId).toBeUndefined()
    expect(q.tasks.find(task => task.id === 'task-old-parent-split-a')?.notes?.at(-1)?.content ?? '').toContain(
      'superseded because its imported parent left the approved import scope',
    )
  })

  it('archives previously imported tasks when the detected snapshot only preserves them as context', async () => {
    await writeQueue({
      version: 1,
      lastUpdated: new Date().toISOString(),
      tasks: [
        {
          id: WORKSPACE_IMPORT_TASK_ID,
          title: 'Review existing project work',
          description: 'Reserved importer',
          domain: WORKSPACE_IMPORT_DOMAIN,
          projectPath: tmpDir,
          status: 'spec_review',
          priority: 'high',
          spec: '',
          acceptanceCriteria: [],
          dependsOn: [],
          outOfScope: [],
          notes: [],
          gateResults: [],
          reviewVerdicts: [],
          adjudications: [],
          escalations: [],
          agentIssues: [],
          revisionCount: 0,
          remediationAttempts: 0,
          origination: 'system',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'task-capability-ghost',
          title: 'Author defines book intent, genre/form expectations, themes, and voice.',
          description: 'Old bad import turned architecture prose into runnable work.',
          domain: 'harness',
          projectPath: tmpDir,
          status: 'spec_review',
          priority: 'normal',
          acceptanceCriteria: [],
          dependsOn: [],
          outOfScope: [],
          notes: [],
          gateResults: [],
          reviewVerdicts: [],
          adjudications: [],
          escalations: [],
          agentIssues: [],
          revisionCount: 0,
          remediationAttempts: 0,
          origination: 'human',
          requestIntake: {
            intent: 'spec_only',
            recommendedNextAction: 'draft_spec',
            componentStack: [],
            assumptions: [],
            missingInformation: [],
            evidenceRefs: ['import:/repo/docs/harness/architecture-notes.md'],
            pressureTestSummary: {
              systemOwned: true,
              degree: 'guided',
              qualityBar: 'Capability-map prose should not survive as runnable backlog work.',
              ownerQuestionPolicy: 'Do not keep architecture prose alive as deferred task work.',
              checks: [],
            },
            clarifyingQuestions: [],
            createdAt: new Date().toISOString(),
            createdBy: 'workspace-importer',
          },
          references: ['/repo/docs/harness/architecture-notes.md'],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        } as Task,
      ],
    })

    const approved = await approveWorkspaceImport({
      memoryDir,
      projectPath: tmpDir,
      draftOverride: {
        goals: [],
        tasks: [
          {
            suggestedId: 'task-import-schema',
            title: 'Define fixture, expected-record, prototype-run, and evaluation schemas.',
            description: 'Current Stage 1 slice.',
            domain: 'harness',
            scope: 'current',
            priority: 'high',
            references: ['/repo/docs/harness/implementation-roadmap.md'],
            source: 'planning-docs',
            confidence: 'high',
          },
        ],
        milestones: [],
        context: [],
        stats: {
          inputSignals: 1,
          drafted: 1,
          deduped: 0,
        },
      },
      detectedDraftSnapshot: {
        goals: [],
        tasks: [
          {
            suggestedId: 'task-import-schema',
            title: 'Define fixture, expected-record, prototype-run, and evaluation schemas.',
            description: 'Current Stage 1 slice.',
            domain: 'harness',
            scope: 'current',
            priority: 'high',
            references: ['/repo/docs/harness/implementation-roadmap.md'],
            source: 'planning-docs',
            confidence: 'high',
          },
        ],
        milestones: [],
        context: [
          {
            label: 'Author defines book intent, genre/form expectations, themes, and voice.',
            excerpt: 'Capability-map prose, not runnable work.',
            source: 'planning-docs',
            references: ['/repo/docs/harness/architecture-notes.md'],
            role: 'capability',
          },
        ],
        stats: {
          inputSignals: 2,
          drafted: 2,
          deduped: 0,
        },
      },
      replacePreviouslyImportedTasks: true,
    })

    expect(approved).toMatchObject({ success: true, tasksAdded: 1 })

    const q = await readQueue()
    expect(q.tasks.find(task => task.id === 'task-capability-ghost')).toMatchObject({
      status: 'archived',
    })
    expect(q.tasks.find(task => task.id === 'task-capability-ghost')?.notes?.at(-1)?.content ?? '').toContain(
      'no longer part of the approved import scope',
    )
  })

  it('does not revive archived imported ghosts when the live docs only keep them as context or brief input', async () => {
    await writeQueue({
      version: 1,
      lastUpdated: new Date().toISOString(),
      tasks: [
        {
          id: WORKSPACE_IMPORT_TASK_ID,
          title: 'Review existing project work',
          description: 'Reserved importer',
          domain: WORKSPACE_IMPORT_DOMAIN,
          projectPath: tmpDir,
          status: 'spec_review',
          priority: 'high',
          spec: '',
          acceptanceCriteria: [],
          dependsOn: [],
          outOfScope: [],
          notes: [],
          gateResults: [],
          reviewVerdicts: [],
          adjudications: [],
          escalations: [],
          agentIssues: [],
          revisionCount: 0,
          remediationAttempts: 0,
          origination: 'system',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'task-capability-ghost-archived',
          title: 'Author defines book intent, genre/form expectations, themes, and voice.',
          description: 'Old bad import turned architecture prose into runnable work.',
          domain: 'harness',
          projectPath: tmpDir,
          status: 'archived',
          priority: 'normal',
          acceptanceCriteria: [],
          dependsOn: [],
          outOfScope: [],
          notes: [],
          gateResults: [],
          reviewVerdicts: [],
          adjudications: [],
          escalations: [],
          agentIssues: [],
          revisionCount: 0,
          remediationAttempts: 0,
          origination: 'human',
          requestIntake: {
            intent: 'spec_only',
            recommendedNextAction: 'draft_spec',
            componentStack: [],
            assumptions: [],
            missingInformation: [],
            evidenceRefs: ['import:/repo/docs/harness/architecture-notes.md'],
            pressureTestSummary: {
              systemOwned: true,
              degree: 'guided',
              qualityBar: 'Capability-map prose should not come back as deferred task work.',
              ownerQuestionPolicy: 'Do not revive architecture prose as runnable backlog work.',
              checks: [],
            },
            clarifyingQuestions: [],
            createdAt: new Date().toISOString(),
            createdBy: 'workspace-importer',
          },
          references: ['/repo/docs/harness/architecture-notes.md'],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        } as Task,
      ],
    })

    const approved = await approveWorkspaceImport({
      memoryDir,
      projectPath: tmpDir,
      draftOverride: {
        goals: [],
        tasks: [
          {
            suggestedId: 'task-import-schema',
            title: 'Define fixture, expected-record, prototype-run, and evaluation schemas.',
            description: 'Current Stage 1 slice.',
            domain: 'harness',
            scope: 'current',
            priority: 'high',
            references: ['/repo/docs/harness/implementation-roadmap.md'],
            source: 'planning-docs',
            confidence: 'high',
          },
        ],
        milestones: [],
        context: [],
        stats: {
          inputSignals: 1,
          drafted: 1,
          deduped: 0,
        },
      },
      detectedDraftSnapshot: {
        goals: [],
        tasks: [
          {
            suggestedId: 'task-import-schema',
            title: 'Define fixture, expected-record, prototype-run, and evaluation schemas.',
            description: 'Current Stage 1 slice.',
            domain: 'harness',
            scope: 'current',
            priority: 'high',
            references: ['/repo/docs/harness/implementation-roadmap.md'],
            source: 'planning-docs',
            confidence: 'high',
          },
        ],
        milestones: [],
        context: [
          {
            label: 'Author defines book intent, genre/form expectations, themes, and voice.',
            excerpt: 'Capability-map prose, not runnable work.',
            source: 'planning-docs',
            references: ['/repo/docs/harness/architecture-notes.md'],
            role: 'brief_input',
          },
        ],
        stats: {
          inputSignals: 2,
          drafted: 2,
          deduped: 0,
        },
      },
      replacePreviouslyImportedTasks: true,
    })

    expect(approved).toMatchObject({ success: true, tasksAdded: 1 })

    const q = await readQueue()
    expect(q.tasks.find(task => task.id === 'task-capability-ghost-archived')).toMatchObject({
      status: 'archived',
    })
  })

  it('persists approved import context alongside goals, tasks, and milestones', async () => {
    await writeQueue({
      version: 1,
      lastUpdated: new Date().toISOString(),
      tasks: [
        {
          id: WORKSPACE_IMPORT_TASK_ID,
          title: 'Review existing project work',
          description: 'Reserved importer',
          domain: WORKSPACE_IMPORT_DOMAIN,
          projectPath: tmpDir,
          status: 'spec_review',
          priority: 'high',
          acceptanceCriteria: [],
          dependsOn: [],
          outOfScope: [],
          notes: [],
          gateResults: [],
          reviewVerdicts: [],
          adjudications: [],
          escalations: [],
          agentIssues: [],
          origination: 'system',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    })

    const approved = await approveWorkspaceImport({
      memoryDir,
      projectPath: tmpDir,
      draftOverride: {
        goals: [],
        tasks: [
          {
            suggestedId: 'task-import-schema',
            title: 'Define fixture schemas',
            description: 'Current Stage 1 slice.',
            domain: 'harness',
            scope: 'current',
            priority: 'high',
            references: ['/repo/docs/harness/implementation-roadmap.md'],
            source: 'planning-docs',
            confidence: 'high',
          },
        ],
        milestones: [],
        context: [
          {
            label: 'Author defines book intent, genre/form expectations, themes, and voice.',
            excerpt: 'Book-brief framing.',
            source: 'planning-docs',
            references: ['/repo/docs/harness/architecture-notes.md'],
            role: 'brief_input',
          },
          {
            label: 'The coordinator chooses reviewers based on current phase.',
            excerpt: 'Capability map row.',
            source: 'planning-docs',
            references: ['/repo/docs/harness/architecture-notes.md'],
            role: 'capability',
          },
        ],
        stats: {
          inputSignals: 3,
          drafted: 3,
          deduped: 0,
        },
      },
      detectedDraftSnapshot: {
        goals: [],
        tasks: [
          {
            suggestedId: 'task-import-schema',
            title: 'Define fixture schemas',
            description: 'Current Stage 1 slice.',
            domain: 'harness',
            scope: 'current',
            priority: 'high',
            references: ['/repo/docs/harness/implementation-roadmap.md'],
            source: 'planning-docs',
            confidence: 'high',
          },
        ],
        milestones: [],
        context: [
          {
            label: 'Author defines book intent, genre/form expectations, themes, and voice.',
            excerpt: 'Book-brief framing.',
            source: 'planning-docs',
            references: ['/repo/docs/harness/architecture-notes.md'],
            role: 'brief_input',
          },
          {
            label: 'The coordinator chooses reviewers based on current phase.',
            excerpt: 'Capability map row.',
            source: 'planning-docs',
            references: ['/repo/docs/harness/architecture-notes.md'],
            role: 'capability',
          },
        ],
        stats: {
          inputSignals: 3,
          drafted: 3,
          deduped: 0,
        },
      },
      replacePreviouslyImportedTasks: true,
    })

    expect(approved).toMatchObject({ success: true, tasksAdded: 1 })

    const goalsState = await readWorkspaceGoalsState(memoryDir)
    expect(goalsState?.context).toEqual([
      expect.objectContaining({
        label: 'Author defines book intent, genre/form expectations, themes, and voice.',
        role: 'brief_input',
      }),
      expect.objectContaining({
        label: 'The coordinator chooses reviewers based on current phase.',
        role: 'capability',
      }),
    ])
  })

  it('keeps previously archived imported work archived when the docs only mention it outside the approved import set', async () => {
    await writeQueue({
      version: 1,
      lastUpdated: new Date().toISOString(),
      tasks: [
        {
          id: WORKSPACE_IMPORT_TASK_ID,
          title: 'Review existing project work',
          description: 'Reserved importer',
          domain: WORKSPACE_IMPORT_DOMAIN,
          projectPath: tmpDir,
          status: 'spec_review',
          priority: 'high',
          spec: '',
          acceptanceCriteria: [],
          dependsOn: [],
          outOfScope: [],
          notes: [],
          gateResults: [],
          reviewVerdicts: [],
          adjudications: [],
          escalations: [],
          agentIssues: [],
          revisionCount: 0,
          remediationAttempts: 0,
          origination: 'system',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'task-import-stage-two-archived',
          title: 'Mastra workflow for the prototype iteration loop',
          description: 'Collapsed by an older bad import refresh.',
          domain: 'harness',
          projectPath: tmpDir,
          status: 'archived',
          priority: 'normal',
          acceptanceCriteria: [],
          dependsOn: [],
          outOfScope: [],
          notes: [],
          gateResults: [],
          reviewVerdicts: [],
          adjudications: [],
          escalations: [],
          agentIssues: [],
          revisionCount: 0,
          remediationAttempts: 0,
          origination: 'human',
          requestIntake: {
            intent: 'spec_only',
            recommendedNextAction: 'draft_spec',
            componentStack: [],
            assumptions: [],
            missingInformation: [],
            evidenceRefs: ['import:/repo/docs/harness/implementation-roadmap.md'],
            pressureTestSummary: {
              systemOwned: true,
              degree: 'guided',
              qualityBar: 'Imported work should remain recoverable while the docs still support it.',
              ownerQuestionPolicy: 'Only ask when scope intent actually changes.',
              checks: [],
            },
            clarifyingQuestions: [],
            createdAt: new Date().toISOString(),
            createdBy: 'workspace-importer',
          },
          references: ['/repo/docs/harness/implementation-roadmap.md'],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        } as Task,
      ],
    })

    const approved = await approveWorkspaceImport({
      memoryDir,
      projectPath: tmpDir,
      draftOverride: {
        goals: [],
        tasks: [
          {
            suggestedId: 'task-import-schema',
            title: 'Define fixture, expected-record, prototype-run, and evaluation schemas.',
            description: 'Current Stage 1 slice.',
            domain: 'harness',
            scope: 'current',
            priority: 'high',
            references: ['/repo/docs/harness/implementation-roadmap.md'],
            source: 'planning-docs',
            confidence: 'high',
          },
        ],
        milestones: [],
        context: [],
        stats: {
          inputSignals: 1,
          drafted: 1,
          deduped: 0,
        },
      },
      detectedDraftSnapshot: {
        goals: [],
        tasks: [
          {
            suggestedId: 'task-import-schema',
            title: 'Define fixture, expected-record, prototype-run, and evaluation schemas.',
            description: 'Current Stage 1 slice.',
            domain: 'harness',
            scope: 'current',
            priority: 'high',
            references: ['/repo/docs/harness/implementation-roadmap.md'],
            source: 'planning-docs',
            confidence: 'high',
          },
        ],
        milestones: [],
        context: [],
        stats: {
          inputSignals: 2,
          drafted: 2,
          deduped: 0,
        },
      },
      replacePreviouslyImportedTasks: true,
    })

    expect(approved).toMatchObject({ success: true, tasksAdded: 1 })

    const q = await readQueue()
    expect(q.tasks.find(task => task.id === 'task-import-stage-two-archived')).toMatchObject({
      status: 'archived',
    })
  })

  it('does not duplicate already-imported tasks when a refreshed import includes the same title again', async () => {
    await writeQueue({
      version: 1,
      lastUpdated: new Date().toISOString(),
      tasks: [
        {
          id: WORKSPACE_IMPORT_TASK_ID,
          title: 'Review existing project work',
          description: 'Reserved importer',
          domain: WORKSPACE_IMPORT_DOMAIN,
          projectPath: tmpDir,
          status: 'spec_review',
          priority: 'high',
          spec: '',
          acceptanceCriteria: [],
          dependsOn: [],
          outOfScope: [],
          notes: [],
          gateResults: [],
          reviewVerdicts: [],
          adjudications: [],
          escalations: [],
          agentIssues: [],
          revisionCount: 0,
          remediationAttempts: 0,
          origination: 'system',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'task-import-existing',
          title: 'Define fixture, expected-record, prototype-run, and evaluation schemas.',
          description: 'Already imported once.',
          domain: 'harness',
          projectPath: tmpDir,
          status: 'exploring',
          priority: 'normal',
          acceptanceCriteria: [],
          dependsOn: [],
          outOfScope: [],
          notes: [],
          gateResults: [],
          reviewVerdicts: [],
          adjudications: [],
          escalations: [],
          agentIssues: [],
          revisionCount: 0,
          remediationAttempts: 0,
          origination: 'human',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    })
    await seedImporterWithSpec(`
\`\`\`yaml
tasks:
  - id: task-import-existing
    title: Define fixture, expected-record, prototype-run, and evaluation schemas.
    description: Keep the existing Stage 1 schema task.
    domain: harness
    priority: normal
    references:
      - docs/harness/implementation-roadmap.md
      - docs/specs/schema-contract-roadmap.md
  - id: task-later
    title: Implement dialogue-and-character-voice reviewer lane
    description: Import the later reviewer lane too.
    domain: coherence
    scope: later
    priority: normal
\`\`\`
`)

    const res = await approveWorkspaceImport({
      memoryDir,
      projectPath: tmpDir,
    })
    expect(res.tasksAdded).toBe(1)

    const q = await readQueue()
    const existing = q.tasks.find(task => task.id === 'task-import-existing')
    expect(q.tasks.filter(task => task.title === 'Define fixture, expected-record, prototype-run, and evaluation schemas.')).toHaveLength(1)
    expect(existing).toMatchObject({
      description: 'Keep the existing Stage 1 schema task.',
      domain: 'harness',
      status: 'exploring',
      references: [
        path.join(tmpDir, 'docs/harness/implementation-roadmap.md'),
        path.join(tmpDir, 'docs/specs/schema-contract-roadmap.md'),
      ],
    })
    expect(q.tasks.find(task => task.id === 'task-later')?.status).toBe('shelved')
  })

  it('reactivates previously shelved current-scope imported tasks during refresh', async () => {
    await writeQueue({
      version: 1,
      lastUpdated: new Date().toISOString(),
      tasks: [
        {
          id: WORKSPACE_IMPORT_TASK_ID,
          title: 'Review existing project work',
          description: 'Reserved importer',
          domain: WORKSPACE_IMPORT_DOMAIN,
          projectPath: tmpDir,
          status: 'spec_review',
          priority: 'high',
          spec: '',
          acceptanceCriteria: [],
          dependsOn: [],
          outOfScope: [],
          notes: [],
          gateResults: [],
          reviewVerdicts: [],
          adjudications: [],
          escalations: [],
          agentIssues: [],
          revisionCount: 0,
          remediationAttempts: 0,
          origination: 'system',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'task-import-existing',
          title: 'Mastra workflow for the prototype iteration loop',
          description: 'Previously deferred.',
          domain: 'harness',
          projectPath: tmpDir,
          status: 'shelved',
          priority: 'normal',
          acceptanceCriteria: [],
          dependsOn: [],
          outOfScope: [],
          notes: [],
          gateResults: [],
          reviewVerdicts: [],
          adjudications: [],
          escalations: [],
          agentIssues: [],
          revisionCount: 0,
          remediationAttempts: 0,
          origination: 'human',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    })
    await seedImporterWithSpec(`
\`\`\`yaml
tasks:
  - id: task-import-existing
    title: Mastra workflow for the prototype iteration loop
    description: Keep this inside the current headless MVP.
    domain: harness
    priority: high
\`\`\`
`)

    const res = await approveWorkspaceImport({
      memoryDir,
      projectPath: tmpDir,
    })
    expect(res.tasksAdded).toBe(0)

    const q = await readQueue()
    expect(q.tasks.filter(task => task.title === 'Mastra workflow for the prototype iteration loop')).toHaveLength(1)
    expect(q.tasks.find(task => task.id === 'task-import-existing')).toMatchObject({
      status: 'import_draft',
      description: 'Keep this inside the current headless MVP.',
      priority: 'high',
    })
  })

  it('suffixes conflicting task ids rather than overwriting', async () => {
    await seedImporterWithSpec(`
\`\`\`yaml
tasks:
  - id: t-wire-dashboard
    title: v1
    domain: ui
  - id: t-wire-dashboard
    title: v2
    domain: ui
\`\`\`
`)
    const res = await approveWorkspaceImport({
      memoryDir,
      projectPath: tmpDir,
    })
    expect(res.tasksAdded).toBe(2)
    const q = await readQueue()
    expect(q.tasks.find((t) => t.id === 't-wire-dashboard')?.title).toBe('v1')
    expect(q.tasks.find((t) => t.id === 't-wire-dashboard-2')?.title).toBe('v2')
  })

  it('assigns imported tasks to the matching coordinator project path when provided', async () => {
    await seedImporterWithSpec(`
\`\`\`yaml
tasks:
  - id: task-knit-auth
    title: Redirect auth callback
    description: Route signed-in users to the right Knit workspace.
    domain: knit
\`\`\`
`)
    const res = await approveWorkspaceImport({
      memoryDir,
      projectPath: tmpDir,
      coordinatorProjectPaths: {
        knit: path.join(tmpDir, 'knit'),
      },
    })
    expect(res.success).toBe(true)
    const q = await readQueue()
    expect(q.tasks.find((t) => t.id === 'task-knit-auth')?.projectPath).toBe(
      path.join(tmpDir, 'knit'),
    )
  })

  it('routes an imported task with an invalid domain by its source trail', async () => {
    const productPath = path.join(tmpDir, 'docs', 'product')
    await fs.mkdir(productPath, { recursive: true })
    await fs.writeFile(
      path.join(productPath, 'deepinfra-model-selection.md'),
      '# DeepInfra model selection\n\nPick the drafting model for broad-genre writing.\n',
      'utf-8',
    )
    await seedImporterWithSpec(`
\`\`\`yaml
tasks:
  - id: task-deepinfra-model
    title: Select DeepInfra drafting model
    description: Pick the drafting model for broad-genre writing.
    domain: core
    references:
      - docs/product/deepinfra-model-selection.md
\`\`\`
`)
    const res = await approveWorkspaceImport({
      memoryDir,
      projectPath: tmpDir,
      coordinatorProjectPaths: {
        product: productPath,
        harness: path.join(tmpDir, 'docs', 'harness'),
      },
    })
    expect(res.success).toBe(true)
    const q = await readQueue()
    const task = q.tasks.find((t) => t.id === 'task-deepinfra-model')!
    expect(task.domain).toBe('product')
    expect(task.projectPath).toBe(productPath)
  })

  it('materializes referenced evidence as a dependency-aware work graph that scheduling respects', async () => {
    await fs.mkdir(path.join(tmpDir, 'looma/docs'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'looma/docs/component-library-audit.md'),
      [
        '# Component audit',
        '',
        '| Deliverable | Need | Foundation | Consumer |',
        '| --- | --- | --- | --- |',
        '| Dialog | shipped as `ui-dialog` | native dialog + overlay manager | Knit BaseDialog already uses it |',
        '| AlertDialog | missing P0 gap | builds on Dialog and Button | Knit destructive confirmation flow |',
        '| Drawer | missing | builds on Dialog and overlay manager | Knit mobile navigation drawer |',
        '',
        '- Knit delete collection confirmation needs `AlertDialog` before replacing the local BaseDialog variant.',
      ].join('\n'),
      'utf-8',
    )
    await seedImporterWithSpec(`
\`\`\`yaml
tasks:
  - id: task-039
    title: Build AlertDialog primitive
    description: Build the Looma AlertDialog primitive as a concrete UI-library component.
    domain: looma
    priority: high
    references:
      - looma/docs/component-library-audit.md
\`\`\`
`)

    const approved = await approveWorkspaceImport({
      memoryDir,
      projectPath: tmpDir,
      coordinatorProjectPaths: {
        looma: path.join(tmpDir, 'looma'),
        knit: path.join(tmpDir, 'knit'),
      },
    })
    expect(approved).toMatchObject({ success: true, tasksAdded: 4 })

    const q = await readQueue()
    const alertDialog = q.tasks.find((task) => task.id === 'task-039')!
    const alertDialogIntegration = q.tasks.find((task) => task.id === 'task-alert-dialog-integration')!
    const drawer = q.tasks.find((task) => task.id === 'task-drawer')!
    const drawerIntegration = q.tasks.find((task) => task.id === 'task-drawer-integration')!

    expect(alertDialog).toMatchObject({
      title: 'Build AlertDialog',
      domain: 'looma',
      projectPath: path.join(tmpDir, 'looma'),
      status: 'spec_review',
      dependsOn: [],
    })
    expect(alertDialog.acceptanceCriteria.map((criterion) => criterion.id)).toEqual(
      expect.arrayContaining([
        'task-boundary',
        'runtime-slice',
        'deterministic-proof',
      ]),
    )
    expect(alertDialog.proofPaths).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'command', source: 'inferred' }),
    ]))

    expect(alertDialogIntegration).toMatchObject({
      title: 'Integrate AlertDialog into Knit destructive confirmation flow',
      domain: 'knit',
      projectPath: path.join(tmpDir, 'knit'),
      dependsOn: ['task-039'],
    })
    expect(alertDialog.requestIntake).toMatchObject({
      intent: 'implementation',
      recommendedNextAction: 'proceed_to_implementation_spec',
    })
    expect(alertDialog.spec).toContain('## Completion Boundary')
    expect(alertDialog.spec).toContain('Verification environment:')
    expect(alertDialog.spec).not.toContain('Proof target:')
    expect(alertDialog.productBrief).toMatchObject({
      authoredBy: 'workspace-importer',
    })
    expect(alertDialogIntegration.acceptanceCriteria.map((criterion) => criterion.id)).toEqual([
      'public-consumer-import',
      'consumer-flow-renders',
      'runtime-proof',
      'look-and-feel-proof',
      'integration-regression-test',
    ])
    expect(drawer).toMatchObject({ domain: 'looma' })
    expect(drawerIntegration).toMatchObject({ domain: 'knit', dependsOn: ['task-drawer'] })
    expect(q.tasks.some((task) => task.title === 'looma/docs/component-library-audit.md: AlertDialog')).toBe(false)

    await expect(approveSpec({
      memoryDir,
      taskId: 'task-039',
      approvalNote: 'Generated workspace-import spec should satisfy the same approval contract the UI uses.',
    })).resolves.toMatchObject({ success: true, newStatus: 'ready' })
  })

  it('preserves richer parsed references when the evidence graph reframes an existing survivor task', async () => {
    await fs.mkdir(path.join(tmpDir, 'docs', 'harness'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'harness', 'implementation-roadmap.md'),
      [
        '# Implementation Roadmap',
        '',
        '## Stage 1: Fixture And Evaluation Harness',
        '',
        '## Current Next Milestone',
        '',
        'The next milestone is Stage 1: Fixture And Evaluation Harness.',
        '',
        '1. Define fixture, expected-record, prototype-run, and evaluation schemas.',
      ].join('\n'),
      'utf-8',
    )
    await writeQueue({
      version: 1,
      lastUpdated: new Date().toISOString(),
      tasks: [
        {
          id: WORKSPACE_IMPORT_TASK_ID,
          title: 'Workspace import',
          description: 'Importer task',
          domain: WORKSPACE_IMPORT_DOMAIN,
          projectPath: tmpDir,
          status: 'exploring',
          priority: 'high',
          acceptanceCriteria: [],
          dependsOn: [],
          outOfScope: [],
          notes: [],
          gateResults: [],
          reviewVerdicts: [],
          adjudications: [],
          escalations: [],
          agentIssues: [],
          revisionCount: 0,
          remediationAttempts: 0,
          origination: 'system',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'task-existing-schema',
          title: 'Define fixture, expected-record, prototype-run, and evaluation schemas.',
          description: 'Old vague draft.',
          domain: 'harness',
          projectPath: tmpDir,
          status: 'blocked',
          priority: 'normal',
          acceptanceCriteria: [],
          dependsOn: [],
          outOfScope: [],
          notes: [],
          gateResults: [],
          reviewVerdicts: [],
          adjudications: [],
          escalations: [],
          agentIssues: [],
          revisionCount: 0,
          remediationAttempts: 0,
          origination: 'human',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    })
    await seedImporterWithSpec(`
\`\`\`yaml
tasks:
  - id: task-import-schema
    title: Define fixture, expected-record, prototype-run, and evaluation schemas.
    description: "docs/harness/implementation-roadmap.md: 1. Define fixture, expected-record, prototype-run, and evaluation schemas."
    whyThisMayMatter: "docs/harness/implementation-roadmap.md: 1. Define fixture, expected-record, prototype-run, and evaluation schemas."
    domain: harness
    priority: normal
    references:
      - docs/harness/implementation-roadmap.md
      - ${path.join(tmpDir, 'docs/harness/implementation-roadmap.md')}
      - docs/specs/schema-contract-roadmap.md
    assumptions:
      - This item still reflects current project intent and has not already been completed or superseded elsewhere.
    missingInformation:
      - "Guildhall still needs to confirm scope, current relevance, and success criteria during shaping."
\`\`\`
`)

    const approved = await approveWorkspaceImport({
      memoryDir,
      projectPath: tmpDir,
    })
    expect(approved).toMatchObject({ success: true, tasksAdded: 0 })

    const q = await readQueue()
    const imported = q.tasks.find(task => task.id === 'task-existing-schema')
    expect(imported).toMatchObject({
      title: 'Define fixture, expected-record, prototype-run, and evaluation schemas.',
      description: '1. Define fixture, expected-record, prototype-run, and evaluation schemas.',
      domain: 'harness',
      status: 'blocked',
      references: [
        path.join(tmpDir, 'docs/harness/implementation-roadmap.md'),
        path.join(tmpDir, 'docs/specs/schema-contract-roadmap.md'),
      ],
    })
    expect(imported?.acceptanceCriteria?.map(criterion => criterion.id)).toEqual(
      expect.arrayContaining([
        'contracts-defined',
        'deterministic-proof',
      ]),
    )
    expect(imported?.proofPaths).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'review',
        source: 'inferred',
      }),
    ]))
    expect(imported?.requestIntake?.assumptions).toEqual([
      'The referenced documentation still represents intended project direction.',
    ])
  })

  it('materializes numbered starter tasks from a current-milestone roadmap instead of cloning adjacent deliverable bullets into the queue', async () => {
    await fs.mkdir(path.join(tmpDir, 'docs', 'harness'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'harness', 'implementation-roadmap.md'),
      [
        '# Implementation Roadmap',
        '',
        '## Current Next Milestone',
        '',
        'The next milestone is Stage 1.',
        '',
        '1. Define fixture, expected-record, prototype-run, and evaluation schemas.',
        '2. Add the first tiny fiction fixture and human-authored expected records.',
        '',
        '## Stage 1: Harness foundation',
        '',
        'Deliverables:',
        '- fixture directory shape for at least one small story fixture',
        '- typed fixture and expected-record contracts',
      ].join('\n'),
      'utf-8',
    )
    await seedImporterWithSpec(`
\`\`\`yaml
tasks:
  - id: task-fixture-shape
    title: fixture directory shape for at least one small story fixture
    description: "docs/harness/implementation-roadmap.md: - fixture directory shape for at least one small story fixture"
    domain: harness
    priority: normal
    references:
      - docs/harness/implementation-roadmap.md
  - id: task-contracts
    title: typed fixture and expected-record contracts
    description: "docs/harness/implementation-roadmap.md: - typed fixture and expected-record contracts"
    domain: harness
    priority: normal
    references:
      - docs/harness/implementation-roadmap.md
\`\`\`
`)

    const approved = await approveWorkspaceImport({
      memoryDir,
      projectPath: tmpDir,
    })
    expect(approved).toMatchObject({ success: true, tasksAdded: 2 })

    const q = await readQueue()
    expect(q.tasks
      .filter(task => task.id !== WORKSPACE_IMPORT_TASK_ID && !task.hierarchy?.parentId)
      .map(task => task.title)).toEqual([
      'Define fixture, expected-record, prototype-run, and evaluation schemas.',
      'Add the first tiny fiction fixture and human-authored expected records.',
    ])
  })

  it('keeps later roadmap stages as deferred release-scoped work when a current milestone bounds active work', async () => {
    await fs.mkdir(path.join(tmpDir, 'docs', 'harness'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'harness', 'implementation-roadmap.md'),
      [
        '# Implementation Roadmap',
        '',
        '## Stage 1: Fixture And Evaluation Harness',
        '',
        'Deliverables:',
        '- fixture directory shape for at least one small story fixture',
        '- typed fixture and expected-record contracts',
        '',
        '## Stage 2: Mastra Agent Prototype',
        '',
        'Deliverables:',
        '- Mastra workflow for the prototype iteration loop',
        '- specialist editor agent calls for the first review lanes',
        '',
        '## Current Next Milestone',
        '',
        'The next milestone is Stage 1: Fixture And Evaluation Harness.',
        '',
        '1. Define fixture, expected-record, prototype-run, and evaluation schemas.',
        '2. Add the first tiny fiction fixture and human-authored expected records.',
      ].join('\n'),
      'utf-8',
    )

    const inventory = await detectWorkspaceSignals({ projectPath: tmpDir })
    const draft = formWorkspaceHypothesis(inventory)

    expect(draft.tasks.map(task => task.title)).toEqual(expect.arrayContaining([
      'Define fixture, expected-record, prototype-run, and evaluation schemas.',
      'Add the first tiny fiction fixture and human-authored expected records.',
      'Mastra workflow for the prototype iteration loop',
      'specialist editor agent calls for the first review lanes',
    ]))
    expect(draft.tasks.find(task => task.title === 'Define fixture, expected-record, prototype-run, and evaluation schemas.')?.scope).toBe('current')
    expect(draft.tasks.find(task => task.title === 'Mastra workflow for the prototype iteration loop')).toMatchObject({
      scope: 'later',
      releaseIds: ['stage-2-mastra-agent-prototype'],
    })
    expect(draft.tasks.find(task => task.title === 'specialist editor agent calls for the first review lanes')).toMatchObject({
      scope: 'later',
      releaseIds: ['stage-2-mastra-agent-prototype'],
    })
    expect(draft.context).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: 'fixture directory shape for at least one small story fixture',
        role: 'capability',
      }),
      expect.objectContaining({
        label: 'typed fixture and expected-record contracts',
        role: 'capability',
      }),
    ]))

    await createWorkspaceImportTask({
      memoryDir,
      projectPath: tmpDir,
      inventory,
      draft,
    })

    const approved = await approveWorkspaceImport({
      memoryDir,
      projectPath: tmpDir,
      draftOverride: draft,
    })
    expect(approved).toMatchObject({ success: true })

    const q = await readQueue()
    expect(q.tasks.find(task => task.title === 'Mastra workflow for the prototype iteration loop')).toMatchObject({
      status: 'shelved',
      releaseIds: ['stage-2-mastra-agent-prototype'],
    })
    expect(q.tasks.find(task => task.title === 'specialist editor agent calls for the first review lanes')).toMatchObject({
      status: 'shelved',
      releaseIds: ['stage-2-mastra-agent-prototype'],
    })
  })

  it('prefers decomposed spec tasks over coarse later-stage roadmap deliverables when a current milestone and inventory both exist', async () => {
    await fs.mkdir(path.join(tmpDir, 'docs', 'harness'), { recursive: true })
    await fs.mkdir(path.join(tmpDir, 'docs', 'specs'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'harness', 'implementation-roadmap.md'),
      [
        '# Implementation Roadmap',
        '',
        '## Stage 1: Fixture And Evaluation Harness',
        '',
        'Goal: build a no-UI test harness that proves the story-memory and packet contracts against small fiction fixtures before any product UI is designed.',
        '',
        '## Stage 2: Mastra Agent Prototype',
        '',
        'Goal: use Mastra and TypeScript to prove the agent workflow: packet builder, specialist editors, writer instances, revision orchestration, and on-demand retrieval.',
        '',
        'Deliverables:',
        '- Mastra workflow for the prototype iteration loop',
        '- packet-builder implementation for the first writer/editor packet types',
        '- deterministic retrieval tools over structured story records',
        '- specialist editor agent calls for the first review lanes',
        '',
        '## Current Next Milestone',
        '',
        'The next milestone is Stage 1: Fixture And Evaluation Harness.',
        '',
        '1. Define fixture, expected-record, prototype-run, and evaluation schemas.',
      ].join('\n'),
      'utf-8',
    )
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'harness', 'remaining-spec-decomposition-inventory.md'),
      [
        '# Remaining Spec Decomposition Inventory',
        '',
        '### 2.2 `dialogue-and-character-voice.md`',
        '',
        '- **Recommended first task title:** Implement dialogue-and-character-voice reviewer lane',
        '- **Recommended domain:** coherence',
        '- **Stage alignment:** Stage 2 (Agent Coordination)',
        '',
        '### 2.3 `editor-writer-feedback-chain.md`',
        '',
        '- **Recommended first task title:** Implement editor-writer feedback chain contract and weighted-feedback pipeline',
        '- **Recommended domain:** harness',
        '- **Stage alignment:** Stage 2 (Agent Coordination)',
      ].join('\n'),
      'utf-8',
    )
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'specs', 'dialogue-and-character-voice.md'),
      [
        '# Dialogue And Character Voice',
        '',
        'Dialogue is action under social pressure.',
      ].join('\n'),
      'utf-8',
    )
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'specs', 'editor-writer-feedback-chain.md'),
      [
        '# Editor Writer Feedback Chain',
        '',
        'Findings should be weighted before they reach the writer.',
      ].join('\n'),
      'utf-8',
    )

    const inventory = await detectWorkspaceSignals({ projectPath: tmpDir })
    const draft = formWorkspaceHypothesis(inventory)
    const materialized = await materializeWorkspaceImportDraft({
      memoryDir,
      projectPath: tmpDir,
      draft,
    })

    expect(materialized.tasks.map(task => task.title)).toEqual(expect.arrayContaining([
      'Define fixture, expected-record, prototype-run, and evaluation schemas.',
    ]))
    expect(materialized.tasks.map(task => task.title)).not.toEqual(expect.arrayContaining([
      'Implement dialogue-and-character-voice reviewer lane',
      'Implement editor-writer feedback chain contract and weighted-feedback pipeline',
      'Mastra workflow for the prototype iteration loop',
      'packet-builder implementation for the first writer/editor packet types',
      'deterministic retrieval tools over structured story records',
      'specialist editor agent calls for the first review lanes',
    ]))
    const milestoneTerminal = materialized.tasks.find(task => task.title === 'Define fixture, expected-record, prototype-run, and evaluation schemas.')
    const laterDialogue = materialized.tasks.find(task => task.title === 'Implement dialogue-and-character-voice reviewer lane')
    const laterWorkflow = materialized.tasks.find(task => task.title === 'Implement editor-writer feedback chain contract and weighted-feedback pipeline')
    expect(laterDialogue).toBeUndefined()
    expect(laterWorkflow).toBeUndefined()
    expect(draft.context).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: 'Spec: Dialogue And Character Voice',
        scopeHint: 'later',
      }),
      expect.objectContaining({
        label: 'Spec: Editor Writer Feedback Chain',
        scopeHint: 'later',
      }),
    ]))
    expect(milestoneTerminal?.scope).toBe('current')
  })

  it('keeps later-stage roadmap deliverables as deferred release work when only one intermediate stage has decomposed replacements', async () => {
    await fs.mkdir(path.join(tmpDir, 'docs', 'harness'), { recursive: true })
    await fs.mkdir(path.join(tmpDir, 'docs', 'specs'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'harness', 'implementation-roadmap.md'),
      [
        '# Implementation Roadmap',
        '',
        '## Stage 1: Fixture And Evaluation Harness',
        '',
        'Goal: build a no-UI harness.',
        '',
        '## Stage 2: Mastra Agent Prototype',
        '',
        'Deliverables:',
        '- Mastra workflow for the prototype iteration loop',
        '- specialist editor agent calls for the first review lanes',
        '',
        '## Stage 3: Model Bakeoff And Safety Policy',
        '',
        'Deliverables:',
        '- provider/model registry schema',
        '- fiction bakeoff scenarios for writer, editor, reviewer, and safety lanes',
        '',
        '## Stage 4: Local Authoring Shell',
        '',
        'Deliverables:',
        '- manuscript import or simple editor shell',
        '- project brief and author-provenance capture',
        '',
        '## Current Next Milestone',
        '',
        'The next milestone is Stage 1: Fixture And Evaluation Harness.',
        '',
        '1. Define fixture, expected-record, prototype-run, and evaluation schemas.',
      ].join('\n'),
      'utf-8',
    )
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'harness', 'remaining-spec-decomposition-inventory.md'),
      [
        '# Remaining Spec Decomposition Inventory',
        '',
        '### 2.2 `dialogue-and-character-voice.md`',
        '',
        '- **Recommended first task title:** Implement dialogue-and-character-voice reviewer lane',
        '- **Recommended domain:** coherence',
        '- **Stage alignment:** Stage 2 (Agent Coordination)',
      ].join('\n'),
      'utf-8',
    )
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'specs', 'dialogue-and-character-voice.md'),
      '# Dialogue And Character Voice\n',
      'utf-8',
    )

    const inventory = await detectWorkspaceSignals({ projectPath: tmpDir })
    const draft = formWorkspaceHypothesis(inventory)
    expect(draft.tasks.map(task => task.title)).toEqual(expect.arrayContaining([
      'provider/model registry schema',
      'fiction bakeoff scenarios for writer, editor, reviewer, and safety lanes',
      'manuscript import or simple editor shell',
      'project brief and author-provenance capture',
    ]))
    expect(draft.tasks.find(task => task.title === 'provider/model registry schema')).toMatchObject({
      scope: 'later',
      releaseIds: ['stage-3-model-bakeoff-and-safety-policy'],
    })
    expect(draft.tasks.find(task => task.title === 'manuscript import or simple editor shell')).toMatchObject({
      scope: 'later',
      releaseIds: ['stage-4-local-authoring-shell'],
    })
    const materialized = await materializeWorkspaceImportDraft({
      memoryDir,
      projectPath: tmpDir,
      draft,
    })

    expect(materialized.tasks.map(task => task.title)).toEqual(expect.arrayContaining([
      'Define fixture, expected-record, prototype-run, and evaluation schemas.',
    ]))
    expect(materialized.tasks.find(task => task.title === 'Implement dialogue-and-character-voice reviewer lane')).toBeUndefined()
    expect(materialized.tasks.filter(task => [
      'provider/model registry schema',
      'fiction bakeoff scenarios for writer, editor, reviewer, and safety lanes',
      'manuscript import or simple editor shell',
      'project brief and author-provenance capture',
      'Mastra workflow for the prototype iteration loop',
      'specialist editor agent calls for the first review lanes',
    ].includes(task.title)).map(task => ({
      title: task.title,
      scope: task.scope,
      releaseIds: task.releaseIds,
    }))).toEqual(expect.arrayContaining([
      {
        title: 'provider/model registry schema',
        scope: 'later',
        releaseIds: ['stage-3-model-bakeoff-and-safety-policy'],
      },
      {
        title: 'manuscript import or simple editor shell',
        scope: 'later',
        releaseIds: ['stage-4-local-authoring-shell'],
      },
    ]))
    expect(materialized.tasks.find(task => task.title === 'Implement dialogue-and-character-voice reviewer lane')).toBeUndefined()
    expect(materialized.context).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: 'Spec: Dialogue And Character Voice',
        role: 'capability',
        scopeHint: 'later',
      }),
    ]))
  })

  it('re-expands import scope from detected planning evidence even when the approved starter draft cites only one roadmap doc', async () => {
    await fs.mkdir(path.join(tmpDir, 'docs', 'harness'), { recursive: true })
    await fs.mkdir(path.join(tmpDir, 'docs', 'specs'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'harness', 'implementation-roadmap.md'),
      [
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
      ].join('\n'),
      'utf-8',
    )
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'harness', 'remaining-spec-decomposition-inventory.md'),
      [
        '# Remaining Spec Decomposition Inventory',
        '',
        '### 2.2 `dialogue-and-character-voice.md`',
        '',
        '- **Recommended first task title:** Implement dialogue-and-character-voice reviewer lane',
        '- **Recommended domain:** coherence',
        '- **Stage alignment:** Stage 2 (Agent Coordination)',
      ].join('\n'),
      'utf-8',
    )
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'specs', 'dialogue-and-character-voice.md'),
      [
        '# Dialogue And Character Voice',
        '',
        'Protect distinct speaking patterns while preserving the author voice envelope.',
      ].join('\n'),
      'utf-8',
    )

    await seedImporterWithSpec(`
\`\`\`yaml
tasks:
  - id: task-import-schema
    title: Define fixture, expected-record, prototype-run, and evaluation schemas.
    description: Define fixture, expected-record, prototype-run, and evaluation schemas.
    domain: harness
    priority: high
    references:
      - docs/harness/implementation-roadmap.md
\`\`\`
`)

    const approved = await approveWorkspaceImport({
      memoryDir,
      projectPath: tmpDir,
    })
    expect(approved).toMatchObject({ success: true })

    const q = await readQueue()
    expect(q.tasks.find(task => task.title === 'Define fixture, expected-record, prototype-run, and evaluation schemas.')).toMatchObject({
      status: 'spec_review',
      domain: 'harness',
    })
    expect(q.tasks.find(task => task.title === 'Implement dialogue-and-character-voice reviewer lane')).toBeUndefined()
    const goalsState = await readWorkspaceGoalsState(memoryDir)
    expect(goalsState?.context).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: 'Spec: Dialogue And Character Voice',
        role: 'capability',
        domain: 'coherence',
        scopeHint: 'later',
        references: expect.arrayContaining([
          path.join(tmpDir, 'docs/specs/dialogue-and-character-voice.md'),
          path.join(tmpDir, 'docs/harness/remaining-spec-decomposition-inventory.md'),
        ]),
      }),
    ]))
  })

  it('derives reviewer-lane and workflow contracts from cited fiction specs instead of generic convention filler', async () => {
    await fs.mkdir(path.join(tmpDir, 'docs', 'harness'), { recursive: true })
    await fs.mkdir(path.join(tmpDir, 'docs', 'specs'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'harness', 'remaining-spec-decomposition-inventory.md'),
      [
        '# Remaining Spec Decomposition Inventory',
        '',
        '### 2.2 `dialogue-and-character-voice.md`',
        "- **Covers:** Defines how dialogue functions as action under social pressure, with distinct character voices that serve the book's larger voice.",
        '- **Recommended first task title:** Implement dialogue-and-character-voice reviewer lane',
        '- **Recommended domain:** coherence',
        '',
        '### 2.3 `editor-writer-feedback-chain.md`',
        '- **Covers:** Defines how weighted editor feedback moves through the harness and how the system protects distinctive fiction from generic smoothing.',
        '- **Recommended first task title:** Implement editor-writer feedback chain contract and weighted-feedback pipeline',
        '- **Recommended domain:** harness',
      ].join('\n'),
      'utf-8',
    )
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'specs', 'dialogue-and-character-voice.md'),
      [
        '# Dialogue And Character Voice',
        '',
        '## Avoiding Same-Voice Dialogue',
        '- Could the line be reassigned to another character without anyone noticing?',
        '- Does the line reveal their social strategy?',
        '',
        '## Dialect, Register, And Respect',
        '- Do not "correct" dialect into prestige grammar.',
        '- Distinguish education from intelligence.',
        '',
        '## Dialogue-Agent Decision Tree',
        '1. Identify speaker, listener, and audience.',
        '2. Identify what the speaker wants in the exchange.',
        '3. Compare with nearby speakers for same-voice collapse.',
      ].join('\n'),
      'utf-8',
    )
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'specs', 'editor-writer-feedback-chain.md'),
      [
        '# Editor Writer Feedback Chain',
        '',
        '## Core Claim',
        '1. Specialists identify lens-specific evidence.',
        '2. Findings receive multidimensional weight.',
        '3. The writer receives a distilled constraint stack.',
        '',
        '## Feedback Weight Dimensions',
        '| Dimension | Meaning |',
        '| --- | --- |',
        '| Severity | How damaging the issue is if ignored |',
        '| Confidence | How sure the editor is |',
        "| Voice risk | Whether fixing it may flatten the book's style |",
        '',
        '## Severity Levels',
        '| Level | Meaning |',
        '| --- | --- |',
        '| Break | Essential story failure |',
        '| Protect | Something that should not be smoothed away |',
        '',
        '## Fiction-First Boundary',
        '- It should not optimize by default for universal clarity.',
        '- Fiction often needs friction.',
      ].join('\n'),
      'utf-8',
    )

    await seedImporterWithSpec(`
\`\`\`yaml
tasks:
  - id: task-dialogue
    title: Implement dialogue-and-character-voice reviewer lane
    description: Implement dialogue-and-character-voice reviewer lane.
    domain: coherence
    priority: high
    references:
      - docs/harness/remaining-spec-decomposition-inventory.md
      - docs/specs/dialogue-and-character-voice.md
  - id: task-feedback
    title: Implement editor-writer feedback chain contract and weighted-feedback pipeline
    description: Implement editor-writer feedback chain contract and weighted-feedback pipeline.
    domain: harness
    priority: high
    references:
      - docs/harness/remaining-spec-decomposition-inventory.md
      - docs/specs/editor-writer-feedback-chain.md
\`\`\`
`)

    const approved = await approveWorkspaceImport({
      memoryDir,
      projectPath: tmpDir,
    })
    expect(approved).toMatchObject({ success: true, tasksAdded: 2 })

    const q = await readQueue()
    const dialogue = q.tasks.find(task => task.id === 'task-dialogue')
    const feedback = q.tasks.find(task => task.id === 'task-feedback')

    expect(dialogue?.acceptanceCriteria?.map(criterion => criterion.id)).toEqual([
      'lane-scope',
      'review-prompts',
      'lane-boundary',
      'finding-shape',
      'deterministic-proof',
    ])
    expect(dialogue?.workUnitAnalysis?.units.map(unit => unit.title)).toEqual([
      'Define the craft lens for Implement dialogue-and-character-voice reviewer lane',
      'Encode the spec-native review prompts',
      'Protect the lane boundary and voice rules',
      'Shape actionable finding output',
    ])
    expect(dialogue?.sizePlan?.action).toBe('proceed_with_warning')
    expect(dialogue?.taskReadiness?.recommendation).toBe('ready')
    expect(dialogue?.hierarchy?.childIds).toHaveLength(4)
    expect(dialogue?.acceptanceCriteria?.[1]?.description).toContain('Could the line be reassigned to another character without anyone noticing?')
    expect(dialogue?.proofPaths?.[0]?.expectedEvidence?.join(' ')).toContain('Recorded findings answer prompts')
    expect(dialogue?.spec).not.toContain('follows target-area conventions')

    expect(feedback?.acceptanceCriteria?.map(criterion => criterion.id)).toEqual([
      'workflow-order',
      'weight-profile',
      'severity-contract',
      'fiction-boundary',
      'deterministic-proof',
    ])
    expect(feedback?.workUnitAnalysis?.units.map(unit => unit.title)).toEqual([
      'Preserve the workflow order for Implement editor-writer feedback chain contract and weighted-feedback pipeline',
      'Model multidimensional finding weights',
      'Preserve severity and fiction-first boundaries',
    ])
    expect(feedback?.sizePlan?.action).toBe('proceed_with_warning')
    expect(feedback?.taskReadiness?.recommendation).toBe('ready')
    expect(feedback?.hierarchy?.childIds).toHaveLength(3)
    expect(feedback?.acceptanceCriteria?.[1]?.description).toContain('Severity, Confidence, Voice risk')
    expect(feedback?.acceptanceCriteria?.[2]?.description).toContain('Protect')
    expect(feedback?.spec).not.toContain('exposes the expected public contract')
  })

  it('builds import specs from cited evidence strongly enough to pass approval without boilerplate gaps', async () => {
    await fs.mkdir(path.join(tmpDir, 'docs', 'harness'), { recursive: true })
    await fs.mkdir(path.join(tmpDir, 'docs', 'specs'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'harness', 'implementation-roadmap.md'),
      [
        '# Implementation Roadmap',
        '',
        '## Stage 1: Fixture And Evaluation Harness',
        '',
        'Goal: build a no-UI test harness that proves story-memory and packet contracts against small fiction fixtures before any product UI is designed.',
        '',
        '## Current Next Milestone',
        '',
        'The next milestone is Stage 1: Fixture And Evaluation Harness.',
        '',
        '1. Define fixture, expected-record, prototype-run, and evaluation schemas.',
      ].join('\n'),
      'utf-8',
    )
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'specs', 'schema-contract-roadmap.md'),
      [
        '# Schema Contract Roadmap',
        '',
        '## Fixture And Expected-Record Schema',
        '',
        'Needed contracts:',
        '- `FixtureManifest`',
        '- `ExpectedRecordSet`',
        '- `ExpectedSignal`',
        '',
        'Purpose:',
        '- compare generated traces to human-authored ground truth',
        '- avoid using private real manuscripts in early evals',
        '',
        '## Prototype Run And Evaluation Schema',
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
      ].join('\n'),
      'utf-8',
    )
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'harness', 'prototype-iteration-workflow.md'),
      [
        '# Prototype Iteration Workflow',
        '',
        '## Fixture Shape',
        '',
        'Minimum fixture:',
        '- 2-3 short scenes',
        '- one reader-knowledge issue',
        '',
        '## Iteration Round',
        '',
        '1. Ingest fixture manuscript and metadata.',
        '2. Produce or load schema records.',
        '3. Evaluate outcome against rubric.',
      ].join('\n'),
      'utf-8',
    )
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'harness', 'remaining-spec-decomposition-inventory.md'),
      [
        '# Remaining Spec Decomposition Inventory',
        '',
        '## Already-Decomposed Specs',
        '',
        '| Spec File | Matching Task(s) | Notes |',
        '|-----------|------------------|-------|',
        '| `story-memory-schemas.md` | `coherence-reviewer-mvp`, `decision-trace-pipeline`, `author-voice-loop-mvp`, `context-packet-compaction-core`, `done`, `expansion-task-full-decomposition-split-verify-and-update-the-migration-record` | Historical task references, not schema contracts. |',
        '',
        '## 2.10 `schema-contract-roadmap.md`',
        '',
        '- **Covers:** A roadmap document identifying contract surfaces that need explicit treatment before implementation grows.',
        '- **Recommended first task title:** Implement fixture-and-expected-record schemas (from schema-contract-roadmap)',
        '- **Stage alignment:** Stage 1 (Fixture And Evaluation Harness)',
      ].join('\n'),
      'utf-8',
    )

    await seedImporterWithSpec(`
\`\`\`yaml
tasks:
  - id: task-schemas
    title: Define fixture, expected-record, prototype-run, and evaluation schemas.
    description: Define fixture, expected-record, prototype-run, and evaluation schemas.
    domain: harness
    priority: high
    references:
      - docs/harness/implementation-roadmap.md
      - docs/specs/schema-contract-roadmap.md
      - docs/harness/prototype-iteration-workflow.md
      - docs/harness/remaining-spec-decomposition-inventory.md
    acceptanceCriteria:
      - id: source-implementation
        description: Define fixture, expected-record, prototype-run, and evaluation schemas. is implemented in harness.
        verifiedBy: review
    proofPaths:
      - kind: review
        expectedEvidence:
          - compare generated traces to human-authored ground truth
\`\`\`
`)

    const approved = await approveWorkspaceImport({
      memoryDir,
      projectPath: tmpDir,
    })
    expect(approved).toMatchObject({ success: true, tasksAdded: 1 })

    const q = await readQueue()
    const task = q.tasks.find(candidate => candidate.id === 'task-schemas')
    const childTasks = q.tasks.filter(candidate => candidate.hierarchy?.parentId === 'task-schemas')
    expect(task?.acceptanceCriteria?.map(criterion => criterion.id)).toEqual([
      'contracts-defined',
      'fixture-ground-truth-shape',
      'run-evaluation-shape',
      'deterministic-proof',
    ])
    expect(task?.workUnitAnalysis?.units.map(unit => unit.title)).toEqual([
      'Define fixture, expected-record, prototype-run, and evaluation contracts',
      'Shape fixture and expected-record ground truth',
      'Capture prototype run and evaluation records',
    ])
    expect(task?.sizePlan?.action).toBe('proceed_with_warning')
    expect(task?.spec).toContain('`FixtureManifest`')
    expect(task?.spec).toContain('`ExpectedRecordSet`')
    expect(task?.spec).toContain('`PrototypeRun`')
    expect(task?.spec).not.toContain('`ProviderRegistryEntry`')
    expect(task?.spec).not.toContain('`ImportManifest`')
    expect(task?.spec).not.toContain('`SchemaVersion`')
    expect(task?.spec).not.toContain('`coherence-reviewer-mvp`')
    expect(task?.spec).not.toContain('`decision-trace-pipeline`')
    expect(task?.spec).not.toContain('`author-voice-loop-mvp`')
    expect(task?.spec).not.toContain('`context-packet-compaction-core`')
    expect(task?.spec).not.toContain('`done`')
    expect(task?.spec).not.toContain('`expansion-task-full-decomposition-split-verify-and-update-the-migration-record`')
    expect(task?.spec).toContain('build a no-UI test harness that proves story-memory and packet contracts against small fiction fixtures before any product UI is designed.')
    expect(task?.spec).toContain('Verification environment: Local filesystem and repo-local tooling already available in the execution environment')
    expect(task?.spec).not.toContain('Proof target:')
    expect(task?.spec).not.toContain('pnpm test -- define-fixture-expected-record-prototype-run-and-evaluation-schemas')
    expect(task?.proofPaths?.some(path => path.kind === 'command')).toBe(false)
    expect(task?.acceptanceCriteria?.find(criterion => criterion.id === 'deterministic-proof')).toMatchObject({
      verifiedBy: 'review',
      source: 'inferred',
    })
    expect(task?.spec).not.toContain('Split or pause only if these imported gaps still change the implementation boundary')
    expect(task?.spec).not.toContain('Guildhall still needs to confirm')
    expect(task?.spec).not.toContain('Add the first tiny fiction fixture')
    expect(task?.productBrief?.nonGoals ?? []).not.toContain('Guildhall still needs to confirm scope, current relevance, and success criteria during shaping.')
    expect(task?.hierarchy?.childIds).toHaveLength(3)
    expect(task?.taskReadiness?.recommendation).toBe('ready')
    expect(task?.taskReadiness?.summary).toContain('continue through the child tasks')
    expect(childTasks.map(candidate => candidate.title)).toEqual([
      'Define fixture, expected-record, prototype-run, and evaluation contracts',
      'Shape fixture and expected-record ground truth',
      'Capture prototype run and evaluation records',
    ])
    expect(childTasks.map(candidate => candidate.status)).toEqual([
      'exploring',
      'exploring',
      'exploring',
    ])
    expect(childTasks[1]?.dependsOn).toEqual([
      childTasks[0]?.id,
    ])
    expect(childTasks[2]?.dependsOn).toEqual([
      childTasks[1]?.id,
    ])

    expect(task?.status).toBe('ready')
  })

  it('shapes the no-ui runner around the documented packet, privacy, and invalidation loop instead of a generic runner stub', async () => {
    await fs.mkdir(path.join(tmpDir, 'docs', 'harness'), { recursive: true })
    await fs.mkdir(path.join(tmpDir, 'docs', 'specs'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'harness', 'implementation-roadmap.md'),
      [
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
        '3. Implement a no-UI runner that builds a packet from fixture records.',
      ].join('\n'),
      'utf-8',
    )
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'harness', 'prototype-iteration-workflow.md'),
      [
        '# Prototype Iteration Workflow',
        '',
        '## Test Rounds',
        '',
        '### Round 1: Reader-State And Character Packet',
        '- writer packet names what the character believes',
        '- writer packet names what the reader knows',
        '',
        '### Round 4: Author Provenance Scope',
        '- privacy manifest says what was included',
        '- blocked provenance never appears in tool calls or output',
        '',
        '### Round 5: Edit Invalidation',
        '- affected records become stale',
        '- packet builder excludes or flags stale context',
      ].join('\n'),
      'utf-8',
    )
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'harness', 'architecture-notes.md'),
      [
        '# Architecture Notes',
        '',
        '## Core Loop',
        '1. Author defines book intent, genre/form expectations, themes, and voice.',
        '2. Author builds a house: premise, world, cast, outline, chapter goals, review standards.',
        '3. Author drafts or imports chapters.',
        '4. The coordinator chooses reviewers based on current phase.',
        '5. Reviewers produce evidence-backed findings.',
        '6. The coordinator summarizes conflicts and turns them into author decisions.',
        '7. Accepted decisions update the story bible, outline, and manuscript tasks.',
        '',
        '## System Records',
        '| Record | Purpose |',
        '| --- | --- |',
        '| Book brief | author voice, premise, genre, themes, constraints |',
        '| Outline | acts, chapters, scene goals, thread movement |',
        '| Character trace | goals, beliefs, choices, consequences |',
        '| Reader-state trace | what the reader can know at each point |',
      ].join('\n'),
      'utf-8',
    )
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'specs', 'agent-context-packets-and-compaction.md'),
      [
        '# Agent Context Packets And Compaction',
        '',
        '## Chapter Writer Packet',
        '- author voice constraints',
        '- outline position and chapter goal',
        '- cast state at chapter start',
        '- world/story bible constraints',
        '',
        '## Provenance And Privacy',
        '- packet names whether provenance material is included',
        '- private/global/session notes appear only when allowed',
        '',
        '## Invalidation',
        '- scene edits invalidate scene inventory, character state, reader state',
        '- outline edits invalidate future-obligation summaries and writer packets',
      ].join('\n'),
      'utf-8',
    )

    await seedImporterWithSpec(`
\`\`\`yaml
tasks:
  - id: task-runner
    title: Implement a no-UI runner that builds a packet from fixture records.
    description: Implement a no-UI runner that builds a packet from fixture records.
    domain: harness
    priority: high
    dependsOn:
      - task-runner-split-execute-the-packet-run-without-ui-help
    references:
      - docs/harness/implementation-roadmap.md
      - docs/harness/prototype-iteration-workflow.md
      - docs/harness/architecture-notes.md
      - docs/specs/agent-context-packets-and-compaction.md
\`\`\`
`)

    const approved = await approveWorkspaceImport({
      memoryDir,
      projectPath: tmpDir,
    })
    expect(approved).toMatchObject({ success: true, tasksAdded: 1 })

    const q = await readQueue()
    const task = q.tasks.find(candidate => candidate.id === 'task-runner')

    expect(task?.acceptanceCriteria?.map(criterion => criterion.id)).toEqual([
      'runner-flow',
      'headless-boundary',
      'packet-boundary',
      'privacy-manifest',
      'invalidation-boundary',
      'deterministic-proof',
    ])
    expect(task?.workUnitAnalysis?.units.map(unit => unit.title)).toEqual([
      'Load fixture inputs and canonical story records',
      'Build the bounded writer packet instead of rereading the manuscript',
      'Run the bounded reviewer and writer loop headlessly',
      'Prove provenance/privacy scope in packet output',
      'Invalidate stale packet context after source edits',
    ])
    expect(task?.acceptanceCriteria?.find(criterion => criterion.id === 'packet-boundary')?.description).toContain('writer packet names what the character believes')
    expect(task?.acceptanceCriteria?.find(criterion => criterion.id === 'privacy-manifest')?.description).toContain('privacy manifest says what was included')
    expect(task?.acceptanceCriteria?.find(criterion => criterion.id === 'invalidation-boundary')?.description).toContain('affected records become stale')
    expect(task?.spec).toContain('Book brief')
    expect(task?.spec).toContain('Character trace')
    expect(task?.spec).toContain('author voice constraints')
    expect(task?.hierarchy?.childIds).toHaveLength(5)
  })

  it('replaces stale imported split children when a refresh reshapes the same parent task', async () => {
    await fs.mkdir(path.join(tmpDir, 'docs', 'harness'), { recursive: true })
    await fs.mkdir(path.join(tmpDir, 'docs', 'specs'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'harness', 'implementation-roadmap.md'),
      [
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
        '3. Implement a no-UI runner that builds a packet from fixture records.',
      ].join('\n'),
      'utf-8',
    )
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'harness', 'prototype-iteration-workflow.md'),
      [
        '# Prototype Iteration Workflow',
        '',
        '## Test Rounds',
        '',
        '### Round 1: Reader-State And Character Packet',
        '- writer packet names what the character believes',
        '- writer packet names what the reader knows',
        '',
        '### Round 4: Author Provenance Scope',
        '- privacy manifest says what was included',
        '',
        '### Round 5: Edit Invalidation',
        '- affected records become stale',
        '- packet builder excludes or flags stale context',
      ].join('\n'),
      'utf-8',
    )
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'specs', 'agent-context-packets-and-compaction.md'),
      [
        '# Agent Context Packets And Compaction',
        '',
        '## Chapter Writer Packet',
        '- author voice constraints',
        '- outline position and chapter goal',
        '- cast state at chapter start',
        '',
        '## Provenance And Privacy',
        '- packet names whether provenance material is included',
        '',
        '## Invalidation',
        '- scene edits invalidate scene inventory, character state, reader state',
      ].join('\n'),
      'utf-8',
    )

    const now = new Date().toISOString()
    await writeQueue(TaskQueue.parse({
      version: 1,
      lastUpdated: now,
      tasks: [
        {
          id: WORKSPACE_IMPORT_TASK_ID,
          title: 'Inspect workspace and draft import',
          description: 'reserved importer',
          domain: '_workspace_import',
          projectPath: tmpDir,
          status: 'done',
          priority: 'normal',
          acceptanceCriteria: [],
          outOfScope: [],
          dependsOn: [],
          notes: [],
          gateResults: [],
          reviewVerdicts: [],
          adjudications: [],
          escalations: [],
          agentIssues: [],
          revisionCount: 0,
          remediationAttempts: 0,
          origination: 'system',
          requestIntake: {
            intent: 'spec_only',
            recommendedNextAction: 'draft_spec',
            componentStack: [],
            assumptions: [],
            missingInformation: [],
            evidenceRefs: [],
            pressureTestSummary: {
              systemOwned: true,
              degree: 'guided',
              qualityBar: 'Refresh imported work.',
              ownerQuestionPolicy: 'Ask only if the docs are ambiguous.',
              checks: [],
            },
            clarifyingQuestions: [],
            createdAt: now,
            createdBy: 'workspace-importer',
          },
          spec: '',
          createdAt: now,
          updatedAt: now,
        },
        {
          id: 'task-runner',
          title: 'Implement a no-UI runner that builds a packet from fixture records.',
          description: 'Old runner shape.',
          domain: 'harness',
          projectPath: tmpDir,
          status: 'spec_review',
          priority: 'high',
          acceptanceCriteria: [],
          outOfScope: [],
          dependsOn: ['task-runner-split-execute-the-packet-run-without-ui-help'],
          notes: [],
          gateResults: [],
          reviewVerdicts: [],
          adjudications: [],
          escalations: [],
          agentIssues: [],
          revisionCount: 0,
          remediationAttempts: 0,
          origination: 'human',
          requestIntake: {
            intent: 'implementation',
            recommendedNextAction: 'proceed_to_implementation_spec',
            componentStack: [],
            assumptions: [],
            missingInformation: [],
            evidenceRefs: [],
            pressureTestSummary: {
              systemOwned: true,
              degree: 'guided',
              qualityBar: 'Imported work must stay aligned with the current roadmap slice.',
              ownerQuestionPolicy: 'Only ask when the docs still leave the scope boundary ambiguous.',
              checks: [],
            },
            clarifyingQuestions: [],
            createdAt: now,
            createdBy: 'workspace-importer',
          },
          hierarchy: {
            childIds: [
              'task-runner-split-load-fixture-inputs-and-shared-records',
              'task-runner-split-execute-the-packet-run-without-ui-help',
              'task-runner-split-prove-the-runner-over-a-bounded-fixture',
            ],
            order: 0,
            relation: 'contains',
          },
          createdAt: now,
          updatedAt: now,
        },
        ...[
          'Load fixture inputs and shared records',
          'Execute the packet run without UI help',
          'Prove the runner over a bounded fixture',
        ].map((title, index) => ({
          id: [
            'task-runner-split-load-fixture-inputs-and-shared-records',
            'task-runner-split-execute-the-packet-run-without-ui-help',
            'task-runner-split-prove-the-runner-over-a-bounded-fixture',
          ][index]!,
          title,
          description: `Old split child ${index + 1}.`,
          domain: 'harness',
          projectPath: tmpDir,
          status: 'exploring' as const,
          priority: 'high' as const,
          acceptanceCriteria: [],
          outOfScope: [],
          dependsOn: [],
          notes: [],
          gateResults: [],
          reviewVerdicts: [],
          adjudications: [],
          escalations: [],
          agentIssues: [],
          revisionCount: 0,
          remediationAttempts: 0,
          origination: 'human' as const,
          requestIntake: {
            intent: 'implementation' as const,
            recommendedNextAction: 'proceed_to_implementation_spec' as const,
            componentStack: [],
            assumptions: [],
            missingInformation: [],
            evidenceRefs: [],
            pressureTestSummary: {
              systemOwned: true,
              degree: 'guided' as const,
              qualityBar: 'Old split child.',
              ownerQuestionPolicy: 'Ask only if required.',
              checks: [],
            },
            clarifyingQuestions: [],
            createdAt: now,
            createdBy: 'workspace-importer' as const,
          },
          hierarchy: {
            parentId: 'task-runner',
            childIds: [],
            order: index,
            relation: 'decomposes' as const,
          },
          createdAt: now,
          updatedAt: now,
        })),
      ],
    }))

    await seedImporterWithSpec(`
\`\`\`yaml
tasks:
  - id: task-runner
    title: Implement a no-UI runner that builds a packet from fixture records.
    description: Implement a no-UI runner that builds a packet from fixture records.
    domain: harness
    priority: high
    references:
      - docs/harness/implementation-roadmap.md
      - docs/harness/prototype-iteration-workflow.md
      - docs/specs/agent-context-packets-and-compaction.md
    releaseIds:
      - stage-1-fixture-and-evaluation-harness
\`\`\`
`)

    const approved = await approveWorkspaceImport({
      memoryDir,
      projectPath: tmpDir,
    })
    expect(approved).toMatchObject({ success: true, tasksAdded: 0 })

    const q = await readQueue()
    const task = q.tasks.find(candidate => candidate.id === 'task-runner')
    expect(task?.hierarchy?.childIds).toEqual([
      'task-runner-split-load-fixture-inputs-and-canonical-story-records',
      'task-runner-split-build-the-bounded-writer-packet-instead-of-rereading-the',
      'task-runner-split-run-the-bounded-reviewer-and-writer-loop-headlessly',
      'task-runner-split-prove-provenance-privacy-scope-in-packet-output',
      'task-runner-split-invalidate-stale-packet-context-after-source-edits',
    ])
    expect(q.tasks.find(candidate => candidate.id === 'task-runner-split-load-fixture-inputs-and-shared-records')).toMatchObject({
      status: 'archived',
    })
    expect(q.tasks.find(candidate => candidate.id === 'task-runner-split-load-fixture-inputs-and-canonical-story-records'))
      .toMatchObject({
        releaseIds: ['stage-1-fixture-and-evaluation-harness'],
        references: expect.arrayContaining([
          path.join(tmpDir, 'docs', 'harness', 'implementation-roadmap.md'),
          path.join(tmpDir, 'docs', 'harness', 'prototype-iteration-workflow.md'),
          path.join(tmpDir, 'docs', 'specs', 'agent-context-packets-and-compaction.md'),
        ]),
        hierarchy: {
          parentId: 'task-runner',
          relation: 'decomposes',
        },
        workVisibility: {
          kind: 'internal_step',
          countInProjectTotals: false,
        },
      })
    expect(q.tasks.find(candidate => candidate.id === 'task-runner-split-execute-the-packet-run-without-ui-help')?.hierarchy?.parentId).toBeUndefined()
    expect(q.tasks.find(candidate => candidate.id === 'task-runner-split-prove-the-runner-over-a-bounded-fixture')?.hierarchy?.parentId).toBeUndefined()
    expect(q.tasks
      .filter(candidate => candidate.status !== 'archived')
      .some(candidate => candidate.dependsOn.includes('task-runner-split-execute-the-packet-run-without-ui-help')))
      .toBe(false)
  })

  it('materializes current milestone starter work without cloning a narrower spec echo beside it', async () => {
    await fs.mkdir(path.join(tmpDir, 'docs', 'harness'), { recursive: true })
    await fs.mkdir(path.join(tmpDir, 'docs', 'specs'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'harness', 'implementation-roadmap.md'),
      [
        '# Implementation Roadmap',
        '',
        '## Stage 1: Fixture And Evaluation Harness',
        '',
        'Goal: build a no-UI test harness that proves story-memory and packet contracts against small fiction fixtures before any product UI is designed.',
        '',
        '## Current Next Milestone',
        '',
        'The next milestone is Stage 1: Fixture And Evaluation Harness.',
        '',
        '1. Define fixture, expected-record, prototype-run, and evaluation schemas.',
        '2. Add the first tiny fiction fixture and human-authored expected records.',
      ].join('\n'),
      'utf-8',
    )
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'specs', 'schema-contract-roadmap.md'),
      [
        '# Schema Contract Roadmap',
        '',
        '## Fixture And Expected-Record Schema',
        '',
        'Needed contracts:',
        '- `FixtureManifest`',
        '- `ExpectedRecordSet`',
        '',
        '## Prototype Run And Evaluation Schema',
        '',
        'Needed contracts:',
        '- `PrototypeRun`',
        '- `RunEvaluation`',
      ].join('\n'),
      'utf-8',
    )

    const inventory = await detectWorkspaceSignals({ projectPath: tmpDir })
    const draft = formWorkspaceHypothesis(inventory)
    const materialized = await materializeWorkspaceImportDraft({
      memoryDir,
      projectPath: tmpDir,
      draft,
    })

    expect(materialized.tasks.filter(task => task.scope !== 'later').map(task => task.title)).toEqual([
      'Define fixture, expected-record, prototype-run, and evaluation schemas.',
      'Add the first tiny fiction fixture and human-authored expected records.',
    ])
    expect(
      (materialized.tasks.find(task =>
        task.title === 'Define fixture, expected-record, prototype-run, and evaluation schemas.',
      )?.references ?? []).map(reference => reference.replaceAll('\\', '/')),
    ).toEqual(expect.arrayContaining([
      expect.stringContaining('docs/harness/implementation-roadmap.md'),
      expect.stringContaining('docs/specs/schema-contract-roadmap.md'),
    ]))
    expect(materialized.tasks.find(task =>
      task.title === 'Implement fixture-and-expected-record schemas (from schema-contract-roadmap)',
    )).toBeUndefined()
  })

  it('materializes Narrative Harness MVP drafting and continuity tasks with specific proof criteria', async () => {
    await fs.mkdir(path.join(tmpDir, 'docs', 'harness'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'harness', 'implementation-roadmap.md'),
      [
        '# Implementation Roadmap',
        '',
        '## Stage 1: Headless Drafting And Evaluation MVP',
        '',
        'Goal: build a no-UI or CLI-first proof that Narrative Harness can shape fiction intent, choose a viable drafting model, generate a bounded draft, and review the draft through story-memory and continuity lenses before any product UI is designed.',
        '',
        'Deliverables:',
        '',
        '- DeepInfra drafting-model selection and bakeoff proof for broad fiction genres, including legal adult fiction inside the product content boundary',
        '- author voice, genre, audience, theme, synopsis, outline, character, character voice, world-state, and review-plan input records',
        '- chapter-drafting proof from synopsis, outline, author voice, character voices, world-state facts, and review plan',
        '- world-state reviewer proof for object/property state changes over elapsed time',
        '- spatial/geographic reviewer proof for place, distance, travel time, terrain, walking speed, weather, light, and map consistency',
        '',
        '## Stage 2: Mastra Agent Prototype',
        '',
        'Deliverables:',
        '',
        '- specialist editor agent calls for the first review lanes',
        '',
        '## Current Next Milestone',
        '',
        'The next milestone is Stage 1: Headless Drafting And Evaluation MVP.',
        '',
        '1. Select and prove a DeepInfra drafting model for broad-genre chapter writing.',
        '2. Add author-intent inputs for voice, genre, audience, theme, synopsis, outline, characters, character voices, world-state facts, and review plan.',
        '3. Generate a CLI-first story synopsis, outline, character/voice records, and one chapter draft from the selected model.',
        '4. Prove world-state continuity review over elapsed-time object and property changes.',
        '5. Prove spatial/geographic continuity review for travel, terrain, walking speed, map consistency, weather, light, and physical plausibility.',
      ].join('\n'),
      'utf-8',
    )

    const inventory = await detectWorkspaceSignals({ projectPath: tmpDir })
    const draft = formWorkspaceHypothesis(inventory)
    const materialized = await materializeWorkspaceImportDraft({
      memoryDir,
      projectPath: tmpDir,
      draft,
    })

    const criteriaFor = (title: string) =>
      materialized.tasks.find(task => task.title === title)?.acceptanceCriteria?.map(criterion => criterion.id)

    expect(criteriaFor('Select and prove a DeepInfra drafting model for broad-genre chapter writing.')).toEqual([
      'deepinfra-model-candidate',
      'broad-genre-drafting-proof',
      'drafting-failure-telemetry',
      'deterministic-proof',
    ])
    expect(criteriaFor('Add author-intent inputs for voice, genre, audience, theme, synopsis, outline, characters, character voices, world-state facts, and review plan.')).toEqual([
      'author-intent-records',
      'intent-to-packet-proof',
      'content-boundary-input',
      'deterministic-proof',
    ])
    expect(criteriaFor('Generate a CLI-first story synopsis, outline, character/voice records, and one chapter draft from the selected model.')).toEqual([
      'synopsis-to-outline-chain',
      'chapter-draft-command',
      'author-voice-preservation',
      'deterministic-proof',
    ])
    expect(criteriaFor('Prove world-state continuity review over elapsed-time object and property changes.')).toEqual([
      'elapsed-time-state-transitions',
      'world-state-finding-shape',
      'world-rule-exceptions',
      'deterministic-proof',
    ])
    expect(criteriaFor('Prove spatial/geographic continuity review for travel, terrain, walking speed, map consistency, weather, light, and physical plausibility.')).toEqual([
      'travel-plausibility-proof',
      'genre-aware-geography',
      'spatial-finding-shape',
      'deterministic-proof',
    ])

    await createWorkspaceImportTask({ memoryDir, projectPath: tmpDir, inventory })
    await approveWorkspaceImport({
      memoryDir,
      projectPath: tmpDir,
      draftOverride: materialized,
      detectedDraftSnapshot: materialized,
    })
    const importedQueue = await readQueue()
    const deepInfraTask = importedQueue.tasks.find(
      task => task.title === 'Select and prove a DeepInfra drafting model for broad-genre chapter writing.',
    )
    expect(deepInfraTask?.productBrief?.successMetric).toContain('DeepInfra-hosted drafting model candidate')
    expect(deepInfraTask?.productBrief?.successMetric).not.toContain('no-UI or CLI-first proof')
    expect(deepInfraTask?.spec).toContain('## Proposed design\n1. The task records a DeepInfra-hosted drafting model candidate')
    expect(deepInfraTask?.spec).not.toContain('typed fixture and expected-record contracts')
    expect(deepInfraTask?.proofPaths).toEqual([
      expect.objectContaining({
        kind: 'review',
        source: 'inferred',
        expectedEvidence: expect.arrayContaining([
          expect.stringContaining('DeepInfra-hosted drafting model candidate'),
          expect.stringContaining('legal adult fiction'),
        ]),
      }),
    ])
    expect(deepInfraTask?.taskReadiness?.recommendation).toBe('ready')
  })

  it('does not resurrect stale imported queue work when materializing a parsed current slice', async () => {
    await fs.mkdir(path.join(tmpDir, 'docs', 'harness'), { recursive: true })
    await fs.mkdir(path.join(tmpDir, 'docs', 'specs'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'harness', 'implementation-roadmap.md'),
      [
        '# Implementation Roadmap',
        '',
        '## Stage 1: Fixture And Evaluation Harness',
        '',
        'Goal: build a no-UI test harness that proves story-memory and packet contracts against small fiction fixtures before any product UI is designed.',
        '',
        '## Current Next Milestone',
        '',
        'The next milestone is Stage 1: Fixture And Evaluation Harness.',
        '',
        '1. Define fixture, expected-record, prototype-run, and evaluation schemas.',
        '2. Add the first tiny fiction fixture and human-authored expected records.',
      ].join('\n'),
      'utf-8',
    )
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'specs', 'schema-contract-roadmap.md'),
      [
        '# Schema Contract Roadmap',
        '',
        '## Fixture And Expected-Record Schema',
        '',
        'Needed contracts:',
        '- `FixtureManifest`',
        '- `ExpectedRecordSet`',
        '',
        '## Prototype Run And Evaluation Schema',
        '',
        'Needed contracts:',
        '- `PrototypeRun`',
        '- `RunEvaluation`',
      ].join('\n'),
      'utf-8',
    )

    const now = new Date().toISOString()
    await writeQueue(TaskQueue.parse({
      version: 1,
      lastUpdated: now,
      tasks: [
        {
          id: 'task-stale-schema-echo',
          title: 'Implement fixture-and-expected-record schemas (from schema-contract-roadmap)',
          description: 'Stale imported echo from an older workspace-import approval.',
          domain: 'harness',
          projectPath: tmpDir,
          status: 'ready',
          priority: 'high',
          acceptanceCriteria: [],
          outOfScope: [],
          dependsOn: [],
          notes: [],
          gateResults: [],
          reviewVerdicts: [],
          adjudications: [],
          escalations: [],
          agentIssues: [],
          revisionCount: 0,
          remediationAttempts: 0,
          origination: 'human',
          requestIntake: {
            intent: 'spec_only',
            recommendedNextAction: 'draft_spec',
            componentStack: [],
            assumptions: [],
            missingInformation: [],
            evidenceRefs: [],
            pressureTestSummary: {
              systemOwned: true,
              degree: 'guided',
              qualityBar: 'Imported work must stay aligned with the current roadmap slice.',
              ownerQuestionPolicy: 'Only ask when the docs still leave the scope boundary ambiguous.',
              checks: [],
            },
            clarifyingQuestions: [],
            createdAt: now,
            createdBy: 'workspace-importer',
          },
          createdAt: now,
          updatedAt: now,
        },
      ],
    }))

    const inventory = await detectWorkspaceSignals({ projectPath: tmpDir })
    const draft = formWorkspaceHypothesis(inventory)
    const materialized = await materializeWorkspaceImportDraft({
      memoryDir,
      projectPath: tmpDir,
      draft,
    })

    expect(materialized.tasks.filter(task => task.scope !== 'later').map(task => task.title)).toEqual([
      'Define fixture, expected-record, prototype-run, and evaluation schemas.',
      'Add the first tiny fiction fixture and human-authored expected records.',
    ])
    expect(materialized.tasks.find(task =>
      task.title === 'Implement fixture-and-expected-record schemas (from schema-contract-roadmap)',
    )).toBeUndefined()
  })

})

describe('mergeWorkspaceImportDraft', () => {
  it('applies importer refinements on top of detector findings without dropping detector-only tasks', () => {
    const detected = formWorkspaceHypothesis(invWith([
      {
        source: 'planning-docs',
        kind: 'open_work',
        title: 'Build packet runner',
        evidence: 'Stage 1 harness deliverable.',
        confidence: 'high',
        references: ['docs/harness/implementation-roadmap.md'],
      },
      {
        source: 'planning-docs',
        kind: 'open_work',
        title: 'Implement reviewer lane',
        evidence: 'Stage 2 reviewer lane.',
        confidence: 'high',
        scopeHint: 'later',
        references: ['docs/harness/implementation-roadmap.md'],
      },
    ]))
    const parsed = parseWorkspaceImport(`
\`\`\`yaml
tasks:
  - id: task-runner
    title: Build packet runner
    description: Refined runner scope.
    domain: harness
    priority: high
  - id: task-cli
    title: Add CLI wrapper
    description: Human-added CLI entrypoint.
    domain: harness
    priority: normal
    references:
      - docs/harness/prototype-iteration-workflow.md
\`\`\`
`)

    const merged = mergeWorkspaceImportDraft(detected, parsed)

    expect(merged.tasks.find(task => task.title === 'Build packet runner')).toMatchObject({
      suggestedId: 'task-runner',
      description: 'Refined runner scope.',
      references: ['docs/harness/implementation-roadmap.md'],
      source: 'planning-docs',
    })
    expect(merged.tasks.find(task => task.title === 'Implement reviewer lane')).toMatchObject({
      scope: 'later',
      source: 'planning-docs',
    })
    expect(merged.tasks.find(task => task.title === 'Add CLI wrapper')).toMatchObject({
      suggestedId: 'task-cli',
      description: 'Human-added CLI entrypoint.',
      source: 'workspace-importer',
      confidence: 'medium',
      references: ['docs/harness/prototype-iteration-workflow.md'],
    })
  })

  it('does not inherit stale parsed dependencies when fresh detected scope has none', () => {
    const detected = formWorkspaceHypothesis(invWith([
      {
        source: 'planning-docs',
        kind: 'open_work',
        title: 'Build packet runner',
        evidence: 'Stage 1 harness deliverable.',
        confidence: 'high',
        references: ['docs/harness/implementation-roadmap.md'],
      },
    ]))
    const parsed = parseWorkspaceImport(`
\`\`\`yaml
tasks:
  - id: task-runner
    title: Build packet runner
    description: Old approved runner scope.
    domain: harness
    priority: high
    dependsOn:
      - task-runner-split-execute-the-packet-run-without-ui-help
\`\`\`
`)

    const merged = mergeWorkspaceImportDraft(detected, parsed, {
      preserveDetectedScope: true,
    })

    expect(merged.tasks.find(task => task.title === 'Build packet runner')).toMatchObject({
      suggestedId: 'task-runner',
      source: 'planning-docs',
    })
    expect(merged.tasks.find(task => task.title === 'Build packet runner')?.dependsOn).toEqual([])
  })

  it('suppresses parsed current-milestone deliverable echoes when the same roadmap also names a numbered current-task sequence', () => {
    const detected = formWorkspaceHypothesis(invWith([
      {
        source: 'planning-docs',
        kind: 'open_work',
        title: 'Define fixture, expected-record, prototype-run, and evaluation schemas.',
        evidence: 'docs/harness/implementation-roadmap.md: 1. Define fixture, expected-record, prototype-run, and evaluation schemas.',
        confidence: 'high',
        references: ['docs/harness/implementation-roadmap.md'],
      },
      {
        source: 'planning-docs',
        kind: 'open_work',
        title: 'Add the first tiny fiction fixture and human-authored expected records.',
        evidence: 'docs/harness/implementation-roadmap.md: 2. Add the first tiny fiction fixture and human-authored expected records.',
        confidence: 'high',
        references: ['docs/harness/implementation-roadmap.md'],
      },
    ]))
    const parsed = parseWorkspaceImport(`
\`\`\`yaml
tasks:
  - id: task-fixture-shape
    title: fixture directory shape for at least one small story fixture
    description: docs/harness/implementation-roadmap.md: - fixture directory shape for at least one small story fixture
    domain: harness
    priority: normal
  - id: task-contracts
    title: typed fixture and expected-record contracts
    description: docs/harness/implementation-roadmap.md: - typed fixture and expected-record contracts
    domain: harness
    priority: normal
  - id: task-schema
    title: Define fixture, expected-record, prototype-run, and evaluation schemas.
    description: docs/harness/implementation-roadmap.md: 1. Define fixture, expected-record, prototype-run, and evaluation schemas.
    domain: harness
    priority: high
  - id: task-records
    title: Add the first tiny fiction fixture and human-authored expected records.
    description: docs/harness/implementation-roadmap.md: 2. Add the first tiny fiction fixture and human-authored expected records.
    domain: harness
    priority: high
\`\`\`
`)

    const merged = mergeWorkspaceImportDraft(detected, parsed)
    expect(merged.tasks.map(task => task.title)).toEqual([
      'Define fixture, expected-record, prototype-run, and evaluation schemas.',
      'Add the first tiny fiction fixture and human-authored expected records.',
    ])
    expect(merged.tasks.find(task => task.title === 'Define fixture, expected-record, prototype-run, and evaluation schemas.')).toMatchObject({
      source: 'planning-docs',
      description: 'docs/harness/implementation-roadmap.md: 1. Define fixture, expected-record, prototype-run, and evaluation schemas.',
    })
    expect(merged.tasks.find(task => task.title === 'fixture directory shape for at least one small story fixture')).toBeUndefined()
  })

  it('folds graph-shaped spec implementation echoes back into the current roadmap starter task', () => {
    const detected = formWorkspaceHypothesis(invWith([
      {
        source: 'planning-docs',
        kind: 'open_work',
        title: 'Define fixture, expected-record, prototype-run, and evaluation schemas.',
        evidence: 'docs/harness/implementation-roadmap.md: 1. Define fixture, expected-record, prototype-run, and evaluation schemas.',
        confidence: 'high',
        domainHint: 'harness',
        references: [
          'docs/harness/implementation-roadmap.md',
        ],
      },
    ]))
    const parsed = parseWorkspaceImport(`
\`\`\`yaml
tasks:
  - id: task-schema-graph
    title: Implement fixture-and-expected-record schemas (from schema-contract-roadmap)
    description: Recommended first implementation task for Fixture And Expected-Record Schema.
    domain: harness
    priority: normal
    references:
      - docs/specs/schema-contract-roadmap.md
    acceptanceCriteria:
      - id: contracts-defined
        description: The cited contracts are defined and proven.
\`\`\`
`)

    const merged = mergeWorkspaceImportDraft(detected, parsed)

    expect(merged.tasks).toHaveLength(1)
    expect(merged.tasks[0]).toMatchObject({
      title: 'Define fixture, expected-record, prototype-run, and evaluation schemas.',
      suggestedId: expect.stringMatching(/^task-import-/),
      acceptanceCriteria: [
        {
          id: 'contracts-defined',
          description: 'The cited contracts are defined and proven.',
        },
      ],
    })
    expect(merged.tasks[0]?.references).toEqual([
      'docs/harness/implementation-roadmap.md',
      'docs/specs/schema-contract-roadmap.md',
    ])
  })

  it('can ignore parsed-only stale tasks during a full refresh merge', () => {
    const detected = formWorkspaceHypothesis(invWith([
      {
        source: 'planning-docs',
        kind: 'open_work',
        title: 'Build packet runner',
        evidence: 'current task',
        confidence: 'high',
        references: ['docs/harness/implementation-roadmap.md'],
      },
    ]))
    const parsed = parseWorkspaceImport(`
\`\`\`yaml
tasks:
  - id: task-runner
    title: Build packet runner
    description: Refined runner scope.
    domain: harness
    priority: high
  - id: task-stale
    title: *(none — umbrella doc, covered by child specs)*
    description: stale umbrella residue
    domain: harness
    priority: normal
\`\`\`
`)

    const merged = mergeWorkspaceImportDraft(detected, parsed, {
      retainParsedOnlyTasks: false,
    })

    expect(merged.tasks.map(task => task.title)).toEqual(['Build packet runner'])
  })

  it('preserves detector scope during automatic refresh merges so stale importer specs cannot keep shrinking MVP scope', () => {
    const detected = formWorkspaceHypothesis(invWith([
      {
        source: 'planning-docs',
        kind: 'open_work',
        title: 'Implement reviewer lane',
        evidence: 'Stage 2 reviewer lane.',
        scopeHint: 'later',
        confidence: 'high',
        references: ['docs/harness/implementation-roadmap.md'],
      },
    ]))
    const parsed = parseWorkspaceImport(`
\`\`\`yaml
tasks:
  - id: task-reviewer
    title: Implement reviewer lane
    description: Old importer spec still says later.
    domain: harness
    scope: later
    priority: normal
\`\`\`
`)

    const merged = mergeWorkspaceImportDraft(detected, parsed, {
      preserveDetectedScope: true,
    })

    expect(merged.tasks.find(task => task.title === 'Implement reviewer lane')).toMatchObject({
      scope: 'later',
      description: 'Stage 2 reviewer lane.',
    })
  })

  it('drops stale parsed goal fragments when detected goals now contain the full wrapped sentence', () => {
    const detected = formWorkspaceHypothesis(invWith([
      {
        source: 'planning-docs',
        kind: 'goal',
        title: 'build a no-UI test harness that proves the story-memory and packet contracts against small fiction fixtures before any product UI is designed.',
        evidence: 'full goal',
        confidence: 'high',
        references: ['docs/harness/implementation-roadmap.md'],
      },
    ]))
    const parsed = parseWorkspaceImport(`
\`\`\`yaml
goals:
  - id: goal-old
    title: build a no-UI test harness that proves the story-memory and packet
    rationale: old wrapped fragment
\`\`\`
`)

    const merged = mergeWorkspaceImportDraft(detected, parsed)

    expect(merged.goals).toEqual([
      expect.objectContaining({
        title: 'build a no-UI test harness that proves the story-memory and packet contracts against small fiction fixtures before any product UI is designed.',
        source: 'planning-docs',
      }),
    ])
  })
})

// The Workspace Import tab needs to let users approve the detector's
// deterministic findings directly, without waiting on an agent round-trip
// to emit YAML fences. formatDetectedDraftAsSpec serializes the detector
// output into the same fence format the parser expects, so
// approveWorkspaceImport can consume it.
describe('formatDetectedDraftAsSpec', () => {
  it('round-trips through parseWorkspaceImport into tasks/goals/milestones', () => {
    const inventory = sampleInventory()
    const draft = formWorkspaceHypothesis(inventory)
    const spec = formatDetectedDraftAsSpec(draft)
    const parsed = parseWorkspaceImport(spec)
    expect(parsed.goals.length).toBeGreaterThan(0)
    expect(parsed.tasks.length).toBeGreaterThan(0)
    expect(parsed.milestones.length).toBeGreaterThan(0)
    // Titles survive the round-trip verbatim.
    expect(parsed.goals.map((g) => g.title)).toContain(
      'Ship multi-agent orchestrator',
    )
    expect(parsed.tasks.map((t) => t.title)).toContain('Wire dashboard card')
    expect(parsed.milestones.map((m) => m.title)).toContain('Ship v0.1.0')
  })

  it('returns empty string for empty draft (no fences to emit)', () => {
    const empty = formWorkspaceHypothesis({
      signals: [],
      bySource: {},
      ran: [],
      failed: [],
    })
    expect(formatDetectedDraftAsSpec(empty)).toBe('')
  })

  it('escapes quotes in titles/descriptions so YAML stays valid', () => {
    const inventory = invWith([
      {
        source: 'readme',
        kind: 'goal',
        title: 'Add "dark" mode',
        evidence: 'Supports toggle between light/dark themes',
        confidence: 'high',
      },
    ])
    const draft = formWorkspaceHypothesis(inventory)
    const spec = formatDetectedDraftAsSpec(draft)
    const parsed = parseWorkspaceImport(spec)
    expect(parsed.goals[0]?.title).toBe('Add "dark" mode')
  })

  it('round-trips richer import-draft shaping fields', () => {
    const inventory = invWith([
      {
        source: 'planning-docs',
        kind: 'open_work',
        title: 'Implement dialogue reviewer lane',
        evidence: 'later-stage recommendation',
        confidence: 'high',
        scopeHint: 'later',
      },
      {
        source: 'roadmap',
        kind: 'open_work',
        title: 'Ship invite flow',
        evidence: 'Complete the missing invite redirect and success state.',
        confidence: 'medium',
        references: ['ROADMAP.md'],
      },
    ])
    const draft = formWorkspaceHypothesis(inventory)
    const spec = formatDetectedDraftAsSpec(draft)
    const parsed = parseWorkspaceImport(spec)
    expect(parsed.tasks.find((task) => task.title === 'Ship invite flow')).toMatchObject({
      title: 'Ship invite flow',
      whyThisMayMatter: 'Complete the missing invite redirect and success state.',
      assumptions: expect.any(Array),
      missingInformation: expect.any(Array),
      scope: 'current',
    })
    expect(parsed.tasks.find((task) => task.title === 'Implement dialogue reviewer lane')).toMatchObject({
      scope: 'later',
    })
  })

  it('round-trips release roadmap state from detected current and later scopes', () => {
    const spec = formatDetectedDraftAsSpec({
      goals: [],
      releases: [
        {
          id: 'stage-1-headless-proof',
          label: 'Stage 1: Headless Proof',
          source: 'planning-docs',
          scope: 'current',
          confidence: 'high',
        },
        {
          id: 'stage-2-authoring-shell',
          label: 'Stage 2: Authoring Shell',
          source: 'planning-docs',
          scope: 'later',
          confidence: 'high',
        },
      ],
      tasks: [],
      milestones: [],
      context: [],
      stats: { inputSignals: 2, drafted: 2, deduped: 0 },
    })

    const parsed = parseWorkspaceImport(spec)
    expect(parsed.releases).toEqual([
      expect.objectContaining({
        id: 'stage-1-headless-proof',
        label: 'Stage 1: Headless Proof',
        state: 'active',
      }),
      expect.objectContaining({
        id: 'stage-2-authoring-shell',
        label: 'Stage 2: Authoring Shell',
        state: 'planned',
      }),
    ])
  })

  it('round-trips structured execution fields instead of dropping them from the import contract', () => {
    const spec = formatDetectedDraftAsSpec({
      goals: [],
      tasks: [
        {
          suggestedId: 'task-runner',
          title: 'Implement a no-UI runner that builds a packet from fixture records.',
          description: 'Current milestone starter task.',
          domain: 'harness',
          scope: 'current',
          priority: 'high',
          acceptanceCriteria: [
            { id: 'runner-contract', description: 'The runner builds a packet from fixture records.' },
            { id: 'runner-proof', description: 'The runner has deterministic proof output.', verifiedBy: 'automated' },
          ],
          dependsOn: ['task-schema'],
          releaseIds: ['nh-headless-mvp'],
          proofPaths: [
            {
              kind: 'command',
              command: 'pnpm test -- packet-runner',
              expectedEvidence: ['Packet runner regression passes.'],
            },
          ],
          references: ['docs/harness/implementation-roadmap.md'],
          source: 'planning-docs',
          confidence: 'high',
        },
      ],
      milestones: [],
      context: [],
      stats: { inputSignals: 1, drafted: 1, deduped: 0 },
    })

    const parsed = parseWorkspaceImport(spec)
    expect(parsed.tasks).toEqual([
      expect.objectContaining({
        id: 'task-runner',
        title: 'Implement a no-UI runner that builds a packet from fixture records.',
        dependsOn: ['task-schema'],
        releaseIds: ['nh-headless-mvp'],
        acceptanceCriteria: [
          { id: 'runner-contract', description: 'The runner builds a packet from fixture records.' },
          { id: 'runner-proof', description: 'The runner has deterministic proof output.', verifiedBy: 'automated' },
        ],
        proofPaths: [
          expect.objectContaining({
            kind: 'command',
            command: 'pnpm test -- packet-runner',
            expectedEvidence: ['Packet runner regression passes.'],
          }),
        ],
      }),
    ])
  })
})
