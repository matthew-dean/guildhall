import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { buildContext } from '../context-builder.js'
import type { Task } from '@guildhall/core'

// ---------------------------------------------------------------------------
// Context builder tests (AC-04)
// Verifies JIT context assembly: keyword ranking, cap enforcement, and
// correct injection of task summary, memory, progress, and decisions.
// ---------------------------------------------------------------------------

let tmpDir: string

const baseTask: Task = {
  id: 'task-001',
  title: 'Add ghost button variant',
  description: 'Add a ghost variant to ui-button in @looma/core for toolbar use',
  domain: 'looma',
  projectPath: '/projects/looma',
  status: 'in_progress',
  priority: 'normal',
  dependsOn: [],
  outOfScope: ['Knit-specific styling'],
  acceptanceCriteria: [
    { id: 'ac-1', description: 'Ghost variant renders correctly', verifiedBy: 'review', met: false },
    { id: 'ac-2', description: 'pnpm build passes', verifiedBy: 'automated', command: 'pnpm build', met: false },
  ],
  notes: [],
  gateResults: [],
  reviewVerdicts: [],
  escalations: [],
  agentIssues: [],
  revisionCount: 0,
  remediationAttempts: 0,
  origination: 'human',
  createdAt: '2026-04-11T00:00:00Z',
  updatedAt: '2026-04-11T00:00:00Z',
  spec: '## Summary\nAdd ghost button variant.\n## Acceptance Criteria\n1. Ghost variant exists.',
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-ctx-test-'))
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

async function writeMemory(content: string) {
  await fs.writeFile(path.join(tmpDir, 'MEMORY.md'), content, 'utf-8')
}
async function writeProgress(content: string) {
  await fs.writeFile(path.join(tmpDir, 'PROGRESS.md'), content, 'utf-8')
}
async function writeDecisions(content: string) {
  await fs.writeFile(path.join(tmpDir, 'DECISIONS.md'), content, 'utf-8')
}

describe('buildContext — task summary', () => {
  it('includes task id and title in output', async () => {
    const ctx = await buildContext(baseTask, tmpDir)
    expect(ctx.taskSummary).toContain('task-001')
    expect(ctx.taskSummary).toContain('Add ghost button variant')
  })

  it('includes spec when present', async () => {
    const ctx = await buildContext(baseTask, tmpDir)
    expect(ctx.taskSummary).toContain('ghost button variant')
  })

  it('includes acceptance criteria', async () => {
    const ctx = await buildContext(baseTask, tmpDir)
    expect(ctx.taskSummary).toContain('Ghost variant renders correctly')
    expect(ctx.taskSummary).toContain('pnpm build passes')
  })

  it('includes out-of-scope list', async () => {
    const ctx = await buildContext(baseTask, tmpDir)
    expect(ctx.taskSummary).toContain('Knit-specific styling')
  })

  it('includes agent notes (last 5 only)', async () => {
    const taskWithNotes: Task = {
      ...baseTask,
      notes: Array.from({ length: 7 }, (_, i) => ({
        agentId: 'worker-agent',
        role: 'worker',
        content: `Note number ${i + 1}`,
        timestamp: new Date().toISOString(),
      })),
    }
    const ctx = await buildContext(taskWithNotes, tmpDir)
    // Should include last 5 notes, not all 7
    expect(ctx.taskSummary).toContain('Note number 7')
    expect(ctx.taskSummary).toContain('Note number 3')
    expect(ctx.taskSummary).not.toContain('Note number 1')
    expect(ctx.taskSummary).not.toContain('Note number 2')
  })
})

describe('buildContext — memory extraction', () => {
  it('returns empty string when MEMORY.md does not exist', async () => {
    const ctx = await buildContext(baseTask, tmpDir)
    expect(ctx.projectMemory).toBe('')
  })

  it('extracts sections relevant to the task domain', async () => {
    await writeMemory([
      '## Looma conventions',
      'Use data-variant for button styles.',
      '',
      '## Knit routing',
      'Knit uses Nuxt 4 file-based routing.',
      '',
      '## Unrelated section',
      'Nothing to do with this task.',
    ].join('\n'))

    const ctx = await buildContext(baseTask, tmpDir)
    expect(ctx.projectMemory).toContain('Looma conventions')
    expect(ctx.projectMemory).toContain('data-variant')
  })

  it('ranks sections by keyword relevance — domain keyword scores highest', async () => {
    await writeMemory([
      '## Unrelated topic',
      'Something about databases.',
      '',
      '## Looma button API',
      'Buttons use data-variant attribute.',
      '',
      '## Ghost rendering',
      'Ghost elements have transparent backgrounds.',
    ].join('\n'))

    const ctx = await buildContext(baseTask, tmpDir)
    // Looma + button + ghost should all score — unrelated should not appear or appear last
    expect(ctx.projectMemory).toContain('Looma button API')
    expect(ctx.projectMemory).toContain('Ghost rendering')
  })

  it('caps memory injection at 4000 chars', async () => {
    // Write a very large MEMORY.md
    const hugeSection = '## Looma section\n' + 'x'.repeat(10_000)
    await writeMemory(hugeSection)

    const ctx = await buildContext(baseTask, tmpDir)
    expect(ctx.projectMemory.length).toBeLessThanOrEqual(4000)
  })

  it('excludes sections with no keyword overlap', async () => {
    await writeMemory([
      '## Completely unrelated topic',
      'This is about PostgreSQL indexing strategies.',
    ].join('\n'))

    const ctx = await buildContext(baseTask, tmpDir)
    expect(ctx.projectMemory).not.toContain('PostgreSQL')
  })
})

describe('buildContext — progress injection', () => {
  it('returns empty string when PROGRESS.md does not exist', async () => {
    const ctx = await buildContext(baseTask, tmpDir)
    expect(ctx.recentProgress).toBe('')
  })

  it('returns the last 60 lines of PROGRESS.md', async () => {
    const lines = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}`)
    await writeProgress(lines.join('\n'))

    const ctx = await buildContext(baseTask, tmpDir)
    const resultLines = ctx.recentProgress.split('\n')
    expect(resultLines.length).toBeLessThanOrEqual(60)
    expect(ctx.recentProgress).toContain('Line 100')
    expect(ctx.recentProgress).not.toContain('Line 1\n') // early lines excluded
  })

  it('handles PROGRESS.md shorter than 60 lines', async () => {
    await writeProgress('Line 1\nLine 2\nLine 3')
    const ctx = await buildContext(baseTask, tmpDir)
    expect(ctx.recentProgress).toContain('Line 1')
    expect(ctx.recentProgress).toContain('Line 3')
  })
})

describe('buildContext — decisions injection', () => {
  it('returns empty string when DECISIONS.md does not exist', async () => {
    const ctx = await buildContext(baseTask, tmpDir)
    expect(ctx.recentDecisions).toBe('')
  })

  it('includes decisions relevant to the task domain', async () => {
    await writeDecisions([
      '## ADR-001: Looma button API decision',
      'Use data-variant for all button styles.',
      '---',
      '## ADR-002: Knit routing decision',
      'Use file-based routing.',
      '---',
    ].join('\n'))

    const ctx = await buildContext(baseTask, tmpDir)
    expect(ctx.recentDecisions).toContain('Looma')
  })

  it('caps decisions injection at 2000 chars', async () => {
    const hugeDomainDecision = '## looma decision\n' + 'y'.repeat(5_000) + '\n---\n'
    await writeDecisions(hugeDomainDecision.repeat(3))

    const ctx = await buildContext(baseTask, tmpDir)
    expect(ctx.recentDecisions.length).toBeLessThanOrEqual(2000)
  })
})

describe('buildContext — formatted output', () => {
  it('produces a non-empty formatted string', async () => {
    const ctx = await buildContext(baseTask, tmpDir)
    expect(ctx.formatted.length).toBeGreaterThan(0)
  })

  it('includes forge context markers', async () => {
    const ctx = await buildContext(baseTask, tmpDir)
    expect(ctx.formatted).toContain('FORGE CONTEXT')
    expect(ctx.formatted).toContain('END FORGE CONTEXT')
  })

  it('total formatted context stays bounded even with full memory files', async () => {
    await writeMemory('## Looma\n' + 'x'.repeat(10_000))
    await writeProgress(Array.from({ length: 200 }, (_, i) => `Progress line ${i}`).join('\n'))
    await writeDecisions('## looma decision\n' + 'y'.repeat(5_000) + '\n---\n')

    const ctx = await buildContext(baseTask, tmpDir)
    // 4000 memory + 2000 decisions + task summary + progress (60 lines ~= 1000 chars) + markers
    // Total should be well under 10k chars
    expect(ctx.formatted.length).toBeLessThan(12_000)
  })
})

// ---------------------------------------------------------------------------
// FR-08 / FR-12: buildContext injects the exploring transcript tail for tasks
// in the exploring phase so the Spec Agent can resume intake.
// ---------------------------------------------------------------------------

describe('buildContext — exploring transcript', () => {
  async function writeTranscript(taskId: string, body: string): Promise<void> {
    const dir = path.join(tmpDir, 'exploring')
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, `${taskId}.md`), body, 'utf-8')
  }

  it('injects the transcript when the task is in the exploring phase', async () => {
    const exploringTask: Task = { ...baseTask, status: 'exploring' }
    await writeTranscript(
      'task-001',
      '# Exploring transcript: task-001\n\n## [2026-04-01T00:00:00Z] user\n\nthe ghost button\n\n---\n',
    )
    const ctx = await buildContext(exploringTask, tmpDir)
    expect(ctx.exploringTranscript).toContain('ghost button')
    expect(ctx.formatted).toContain('Exploring Transcript')
    expect(ctx.formatted).toContain('ghost button')
  })

  it('does not inject the transcript when the task is not exploring', async () => {
    // baseTask is in_progress
    await writeTranscript('task-001', '# old transcript content\n')
    const ctx = await buildContext(baseTask, tmpDir)
    expect(ctx.exploringTranscript).toBe('')
    expect(ctx.formatted).not.toContain('Exploring Transcript')
  })

  it('leaves transcript empty when no file exists', async () => {
    const exploringTask: Task = { ...baseTask, status: 'exploring' }
    const ctx = await buildContext(exploringTask, tmpDir)
    expect(ctx.exploringTranscript).toBe('')
  })

  it('caps a long transcript to the tail', async () => {
    const exploringTask: Task = { ...baseTask, status: 'exploring' }
    const huge = 'A'.repeat(5_000) + '\nTAIL-MARKER\n' + 'B'.repeat(3_000)
    await writeTranscript('task-001', huge)
    const ctx = await buildContext(exploringTask, tmpDir)
    expect(ctx.exploringTranscript.length).toBeLessThanOrEqual(6_000)
    // The tail marker should survive the truncation (it's near the end).
    expect(ctx.exploringTranscript).toContain('TAIL-MARKER')
  })
})


describe('buildContext — FR-23 business envelope injection', () => {
  async function writeGoals(content: string) {
    await fs.writeFile(path.join(tmpDir, 'GOALS.json'), content, 'utf-8')
  }

  it('injects goal summary when task has a parentGoalId resolving to an active goal', async () => {
    const task: Task = { ...baseTask, parentGoalId: 'g-1' }
    await writeGoals(JSON.stringify({
      version: 1,
      lastUpdated: '2026-04-20T00:00:00Z',
      goals: [{
        id: 'g-1',
        title: 'Ship v1',
        description: '',
        successCondition: 'All hard gates pass on main',
        guardrails: [
          { id: 'r1', kind: 'exclude', description: 'No database migrations', tags: [] },
        ],
        status: 'active',
        createdAt: '2026-04-20T00:00:00Z',
        updatedAt: '2026-04-20T00:00:00Z',
      }],
    }))
    const ctx = await buildContext(task, tmpDir)
    expect(ctx.envelope).toContain('g-1')
    expect(ctx.envelope).toContain('Ship v1')
    expect(ctx.envelope).toContain('All hard gates pass on main')
    expect(ctx.envelope).toContain('No database migrations')
    expect(ctx.formatted).toContain('Business Envelope (FR-23)')
  })

  it('leaves envelope empty when task has no parentGoalId', async () => {
    const ctx = await buildContext(baseTask, tmpDir)
    expect(ctx.envelope).toBe('')
    expect(ctx.formatted).not.toContain('Business Envelope')
  })

  it('leaves envelope empty when parentGoalId points at a missing goal', async () => {
    const task: Task = { ...baseTask, parentGoalId: 'g-missing' }
    await writeGoals(JSON.stringify({
      version: 1,
      lastUpdated: '2026-04-20T00:00:00Z',
      goals: [],
    }))
    const ctx = await buildContext(task, tmpDir)
    expect(ctx.envelope).toBe('')
  })

  it('renders goal with no guardrails (success condition only)', async () => {
    const task: Task = { ...baseTask, parentGoalId: 'g-1' }
    await writeGoals(JSON.stringify({
      version: 1,
      lastUpdated: '2026-04-20T00:00:00Z',
      goals: [{
        id: 'g-1',
        title: 'Minimal',
        description: '',
        successCondition: 'ship something',
        guardrails: [],
        status: 'active',
        createdAt: '2026-04-20T00:00:00Z',
        updatedAt: '2026-04-20T00:00:00Z',
      }],
    }))
    const ctx = await buildContext(task, tmpDir)
    expect(ctx.envelope).toContain('Minimal')
    expect(ctx.envelope).toContain('ship something')
    expect(ctx.envelope).not.toContain('Guardrails:')
  })
})
