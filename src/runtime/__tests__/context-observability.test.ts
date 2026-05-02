import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Task } from '@guildhall/core'
import {
  readContextDebugForTask,
  writeContextDebugRecord,
} from '../context-observability.js'
import type { BuiltContext } from '../context-builder.js'

let tmpDir: string
let memoryDir: string

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
    formatted: 'Full formatted context',
    ...overrides,
  }
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-context-debug-'))
  memoryDir = path.join(tmpDir, 'memory')
  await fs.mkdir(memoryDir, { recursive: true })
})

afterEach(async () => {
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
      prompt,
    })

    expect(record.agentRole).toBe('worker')
    expect(record.promptPreview.length).toBeLessThanOrEqual(1203)

    const snapshot = await fs.readFile(record.snapshotPath, 'utf8')
    expect(snapshot).toContain('[truncated')
    expect(snapshot.length).toBeLessThan(prompt.length)

    const loaded = await readContextDebugForTask(memoryDir, 'task-ctx')
    expect(loaded).toHaveLength(1)
    expect(loaded[0]?.id).toBe(record.id)
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
})
