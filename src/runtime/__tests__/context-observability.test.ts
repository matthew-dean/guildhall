import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Task } from '@guildhall/core'
import {
  compactProjectContextDebug,
  readContextDebugForTask,
  writeContextDebugRecord,
} from '../context-observability.js'
import { getProjectContextDebugLedgerPath, getProjectLocalHistoryDir } from '@guildhall/sessions'
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
  it('writes a diagnostic manifest without persisting prompt or context bodies', async () => {
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
    expect(record.promptPreview).toBe('')
    expect(record.promptHash).toMatch(/^[a-f0-9]{64}$/)

    const snapshot = await fs.readFile(record.snapshotPath, 'utf8')
    expect(snapshot).toContain('Prompt and formatted context bodies are intentionally not persisted.')
    expect(snapshot).not.toContain('## Full Prompt')
    expect(snapshot).not.toContain('## Formatted Context')
    expect(snapshot.length).toBeLessThan(prompt.length)
    expect(snapshot).toContain('Temperature: 0.1')

    const loaded = await readContextDebugForTask(memoryDir, 'task-ctx')
    expect(loaded).toHaveLength(1)
    expect(loaded[0]?.id).toBe(record.id)
    expect(loaded[0]?.temperature).toBe(0.1)

    await expect(fs.stat(path.join(
      getProjectLocalHistoryDir(tmpDir),
      'persistence',
      'events',
      'context-debug',
    ))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('bounds known diagnostic lists and strips unknown legacy fields before reads', async () => {
    const record = await writeContextDebugRecord({
      memoryDir,
      workspacePath: '/repo',
      task: mkTask(),
      ctx: mkContext({
        applicableGuildSlugs: Array.from({ length: 2000 }, (_, index) => `guild-${index}-${'x'.repeat(200)}`),
        reviewerSlugs: Array.from({ length: 2000 }, (_, index) => `reviewer-${index}-${'x'.repeat(200)}`),
      }),
      agentName: 'worker-agent',
      modelId: 'qwen/test',
      prompt: 'prompt',
    })

    const ledgerPath = getProjectContextDebugLedgerPath(tmpDir)
    const ledger = await fs.readFile(ledgerPath, 'utf8')
    expect(Buffer.byteLength(ledger, 'utf8')).toBeLessThanOrEqual(32 * 1024)
    expect(record.promptPreview).toBe('')

    await fs.writeFile(ledgerPath, `${JSON.stringify({
      id: 'legacy-record',
      taskId: 'task-ctx',
      promptPreview: 'legacy prompt body '.repeat(5000),
      arbitraryPayload: 'must not cross the read boundary',
    })}\n`, 'utf8')

    const loaded = await readContextDebugForTask(memoryDir, 'task-ctx')
    expect(loaded[0]?.promptPreview).toBe('')
    expect(JSON.stringify(loaded[0])).not.toContain('must not cross the read boundary')
    expect(Buffer.byteLength(JSON.stringify(loaded[0]), 'utf8')).toBeLessThanOrEqual(32 * 1024)
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
    expect(snapshot).not.toContain('## Formatted Context')
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

  it('keeps diagnostics only for the current non-terminal task window', async () => {
    await writeContextDebugRecord({
      memoryDir,
      workspacePath: '/repo',
      task: mkTask({ id: 'task-finished', status: 'done' }),
      ctx: mkContext(),
      agentName: 'worker-agent',
      modelId: 'qwen/test',
      prompt: 'finished prompt',
    })
    await writeContextDebugRecord({
      memoryDir,
      workspacePath: '/repo',
      task: mkTask({ id: 'task-live', status: 'in_progress' }),
      ctx: mkContext(),
      agentName: 'worker-agent',
      modelId: 'qwen/test',
      prompt: 'live prompt',
    })

    await compactProjectContextDebug(tmpDir, {
      dryRun: false,
      activeTaskIds: new Set(['task-live']),
    })

    expect(await readContextDebugForTask(memoryDir, 'task-finished')).toEqual([])
    expect(await readContextDebugForTask(memoryDir, 'task-live')).toHaveLength(1)
  })

  it('keeps the diagnostic ledger under a project-wide byte budget', async () => {
    const ledgerPath = getProjectContextDebugLedgerPath(tmpDir)
    await fs.mkdir(path.dirname(ledgerPath), { recursive: true })
    const records = Array.from({ length: 120 }, (_, index) => JSON.stringify({
      id: `record-${index}`,
      taskId: `task-${index % 12}`,
      promptPreview: 'legacy prompt body '.repeat(700),
      at: `2026-07-14T00:${String(index).padStart(2, '0')}:00.000Z`,
    })).join('\n') + '\n'
    await fs.writeFile(ledgerPath, records, 'utf8')

    await compactProjectContextDebug(tmpDir, { dryRun: false })

    const compacted = await fs.readFile(ledgerPath, 'utf8')
    expect(Buffer.byteLength(compacted, 'utf8')).toBeLessThanOrEqual(512 * 1024)
    expect(compacted).not.toContain('legacy prompt body')
    expect(compacted).toContain('record-119')
  })
})
