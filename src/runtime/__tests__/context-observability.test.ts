import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Task } from '@guildhall/core'
import { FileBackedGuildhallPersistence } from '@guildhall/persistence'
import {
  readContextDebugForTask,
  writeContextDebugRecord,
} from '../context-observability.js'
import type { BuiltContext } from '../context-builder.js'

let tmpDir: string
let memoryDir: string
let priorDataDir: string | undefined

function mkTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-ctx',
    title: 'Inspect context',
    description: 'Debug a prompt',
    domain: 'guildhall',
    projectPath: '/repo/project',
    status: 'in_progress',
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
    createdAt: '2026-05-02T00:00:00.000Z',
    updatedAt: '2026-05-02T00:00:00.000Z',
    ...overrides,
  }
}

function mkContext(overrides: Partial<BuiltContext> = {}): BuiltContext {
  return {
    taskSummary: 'Task summary',
    projectMemory: 'Relevant memory',
    recentProgress: 'Recent progress',
    recentDecisions: 'Recent decisions',
    exploringTranscript: '',
    personaPrompt: 'Role guidance',
    applicableGuildSlugs: ['typescript-engineer'],
    primaryEngineerSlug: 'typescript-engineer',
    reviewerSlugs: ['typescript-engineer'],
    envelope: 'Goal envelope',
    designSystem: '',
    reviewRubrics: 'Review rubric',
    corpusMap: '',
    formatted: 'Full formatted context',
    ...overrides,
  }
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-context-debug-'))
  priorDataDir = process.env.GUILDHALL_DATA_DIR
  process.env.GUILDHALL_DATA_DIR = path.join(tmpDir, 'data')
  memoryDir = path.join(tmpDir, 'memory')
  await fs.mkdir(memoryDir, { recursive: true })
})

afterEach(async () => {
  if (priorDataDir === undefined) delete process.env.GUILDHALL_DATA_DIR
  else process.env.GUILDHALL_DATA_DIR = priorDataDir
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('writeContextDebugRecord', () => {
  it('writes a bounded snapshot and records the manifest', async () => {
    const prompt = `# Prompt\n\n${'A'.repeat(18_000)}`
    const record = await writeContextDebugRecord({
      memoryDir,
      workspacePath: '/repo',
      activeWorktreePath: '/repo/.wt/task-ctx',
      task: mkTask(),
      ctx: mkContext(),
      agentName: 'worker-agent',
      modelId: 'qwen/test',
      temperature: 0.1,
      prompt,
    })

    expect(record.agentRole).toBe('worker')
    expect(record.promptPreview.length).toBeLessThanOrEqual(1203)

    const snapshot = await fs.readFile(record.snapshotPath, 'utf8')
    expect(snapshot).toContain('[truncated')
    expect(snapshot.length).toBeLessThan(prompt.length)
    expect(snapshot).toContain('Temperature: 0.1')

    const loaded = await readContextDebugForTask(memoryDir, 'task-ctx')
    expect(loaded).toHaveLength(1)
    expect(loaded[0]?.id).toBe(record.id)
    expect(loaded[0]?.temperature).toBe(0.1)

    const persistence = new FileBackedGuildhallPersistence()
    const events = await persistence.listEvents({
      projectRoot: tmpDir,
      placement: {
        scope: 'local_history',
        retention: 'debug',
        visibility: 'internal_audit',
        commitPolicy: 'ignored',
      },
      collection: 'context-debug',
      streamId: 'task-ctx',
    })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      schema: { name: 'context-debug-record', version: 1 },
      recordedBy: 'context-observability',
      payload: {
        id: record.id,
        taskId: 'task-ctx',
        snapshotPath: record.snapshotPath,
      },
    })
  })

  it('persists structural omitted-context handles for on-demand retrieval', async () => {
    const record = await writeContextDebugRecord({
      memoryDir,
      workspacePath: '/repo',
      task: mkTask(),
      ctx: mkContext({
        structuralMapContext: '## Structural Map Slice\nOmitted: package://fixture/docs (unrelated_to_task_domain)',
        structuralMapOmitted: [
          {
            handle: 'package://fixture/docs',
            reason: 'unrelated_to_task_domain',
            confidence: 'high',
          },
        ],
      }),
      agentName: 'worker-agent',
      modelId: 'qwen/test',
      prompt: 'prompt',
    })

    expect(record.structuralMap).toEqual(expect.objectContaining({
      included: true,
      omitted: [
        {
          handle: 'package://fixture/docs',
          reason: 'unrelated_to_task_domain',
          confidence: 'high',
          retrievalHint: 'Resolve package://fixture/docs through the structural map before reading deferred context.',
        },
      ],
    }))
    const snapshot = await fs.readFile(record.snapshotPath, 'utf8')
    expect(snapshot).toContain('package://fixture/docs')
  })

  it('warns when a subproject task is mismatched to the active worktree', async () => {
    const record = await writeContextDebugRecord({
      memoryDir,
      workspacePath: '/repo',
      activeWorktreePath: '/repo/.wt/other-task',
      task: mkTask({ projectPath: '/repo/subproject' }),
      ctx: mkContext(),
      agentName: 'worker-agent',
      modelId: 'qwen/test',
      prompt: 'short prompt',
    })

    expect(record.health.some((warning) => warning.code === 'subproject_scope_mismatch')).toBe(true)
  })

  it('does not warn when a subproject task runs in its isolated task worktree', async () => {
    const record = await writeContextDebugRecord({
      memoryDir,
      workspacePath: '/repo',
      activeWorktreePath: '/Users/me/.guildhall/worktrees/workspace/task-ctx',
      task: mkTask({ projectPath: '/repo/subproject' }),
      ctx: mkContext(),
      agentName: 'worker-agent',
      modelId: 'qwen/test',
      prompt: 'short prompt',
    })

    expect(record.health.some((warning) => warning.code === 'subproject_scope_mismatch')).toBe(false)
  })

  it('records corpus map guidance as first-class injected context', async () => {
    const record = await writeContextDebugRecord({
      memoryDir,
      workspacePath: '/repo',
      activeWorktreePath: '/repo/.wt/task-ctx',
      task: mkTask(),
      ctx: mkContext({
        corpusMap: [
          '## Corpus Map',
          '',
          'Read next:',
          '- src/web/lib/Button.svelte: canonical command button',
          '',
          'Corpus fit required: reuse the existing button primitive.',
        ].join('\n'),
      }),
      agentName: 'worker-agent',
      modelId: 'qwen/test',
      prompt: 'short prompt',
    })

    expect(record.sections.find((section) => section.key === 'corpusMap')).toMatchObject({
      label: 'Corpus map',
      included: true,
    })
    expect(record.corpusMap).toMatchObject({
      included: true,
      readNext: ['src/web/lib/Button.svelte'],
    })
    expect(record.reasons).toContain('Corpus map guidance was injected.')

    const snapshot = await fs.readFile(record.snapshotPath, 'utf8')
    expect(snapshot).toContain('- Corpus map:')
  })
})
