import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {
  logProgress,
  logDecision,
  updateMemory,
  logProgressTool,
  logDecisionTool,
  updateMemoryTool,
} from '../memory-tools.js'

let tmpDir: string
const ctx = { cwd: '/tmp', metadata: {} }

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-memory-test-'))
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('logProgress', () => {
  it('appends a heartbeat entry to PROGRESS.md', async () => {
    const progressPath = path.join(tmpDir, 'PROGRESS.md')
    await fs.writeFile(progressPath, '# Progress\n', 'utf-8')

    await logProgress({
      progressPath,
      entry: {
        timestamp: '2026-04-11T10:00:00Z',
        agentId: 'worker-agent',
        domain: 'looma',
        taskId: 'task-001',
        summary: 'Implemented ghost button variant.',
        type: 'heartbeat',
      },
    })

    const content = await fs.readFile(progressPath, 'utf-8')
    expect(content).toContain('HEARTBEAT')
    expect(content).toContain('worker-agent')
    expect(content).toContain('Implemented ghost button variant.')
    expect(content).toContain('task-001')
  })

  it('uses correct emoji for each entry type', async () => {
    for (const [type, emoji] of [
      ['heartbeat', '💓'],
      ['milestone', '🏁'],
      ['blocked', '🚧'],
      ['escalation', '🆘'],
    ] as const) {
      const p = path.join(tmpDir, `progress-${type}.md`)
      await logProgress({
        progressPath: p,
        entry: {
          timestamp: new Date().toISOString(),
          agentId: 'test-agent',
          domain: 'test',
          summary: 'Test entry.',
          type,
        },
      })
      const content = await fs.readFile(p, 'utf-8')
      expect(content).toContain(emoji)
    }
  })

  it('creates file if it does not exist', async () => {
    const progressPath = path.join(tmpDir, 'new-progress.md')
    const result = await logProgress({
      progressPath,
      entry: {
        timestamp: new Date().toISOString(),
        agentId: 'test-agent',
        domain: 'test',
        summary: 'Auto-created.',
        type: 'heartbeat',
      },
    })
    expect(result.success).toBe(true)
    const exists = await fs
      .access(progressPath)
      .then(() => true)
      .catch(() => false)
    expect(exists).toBe(true)
  })
})

describe('logDecision', () => {
  it('appends a formatted ADR entry to DECISIONS.md', async () => {
    const decisionsPath = path.join(tmpDir, 'DECISIONS.md')
    await fs.writeFile(decisionsPath, '# Decisions\n', 'utf-8')

    await logDecision({
      decisionsPath,
      entry: {
        id: 'ADR-001',
        timestamp: '2026-04-11T10:00:00Z',
        agentId: 'coordinator-looma',
        domain: 'looma',
        taskId: 'task-001',
        title: 'Use ghost variant for toolbar buttons',
        context: 'Toolbar buttons need a low-prominence style.',
        decision: 'Use data-variant="ghost" on ui-button.',
        consequences: 'Knit toolbar buttons will need to be updated.',
      },
    })

    const content = await fs.readFile(decisionsPath, 'utf-8')
    expect(content).toContain('ADR-001')
    expect(content).toContain('Use ghost variant for toolbar buttons')
    expect(content).toContain('coordinator-looma')
    expect(content).toContain('data-variant="ghost"')
  })

  it('includes soft gate override note when present', async () => {
    const decisionsPath = path.join(tmpDir, 'DECISIONS.md')

    await logDecision({
      decisionsPath,
      entry: {
        id: 'ADR-002',
        timestamp: new Date().toISOString(),
        agentId: 'coordinator-knit',
        domain: 'knit',
        title: 'Override documentation soft gate',
        context: 'Docs will be added in a follow-up task.',
        decision: 'Accept implementation without docs for now.',
        consequences: 'Docs task must be added to queue immediately.',
        overridesSoftGate: 'documented',
      },
    })

    const content = await fs.readFile(decisionsPath, 'utf-8')
    expect(content).toContain('Overrides soft gate')
    expect(content).toContain('documented')
  })
})

describe('updateMemory', () => {
  it('appends a new section to MEMORY.md', async () => {
    const memoryPath = path.join(tmpDir, 'MEMORY.md')
    await fs.writeFile(memoryPath, '# Project Memory\n', 'utf-8')

    await updateMemory({
      memoryPath,
      section: 'Button Conventions',
      content: 'Always use data-variant for button styles. Never use class-based variants.',
    })

    const content = await fs.readFile(memoryPath, 'utf-8')
    expect(content).toContain('## Button Conventions')
    expect(content).toContain('data-variant')
  })

  it('appends multiple sections without overwriting', async () => {
    const memoryPath = path.join(tmpDir, 'MEMORY.md')

    await updateMemory({ memoryPath, section: 'Section A', content: 'Content A' })
    await updateMemory({ memoryPath, section: 'Section B', content: 'Content B' })

    const content = await fs.readFile(memoryPath, 'utf-8')
    expect(content).toContain('Section A')
    expect(content).toContain('Section B')
    expect(content).toContain('Content A')
    expect(content).toContain('Content B')
  })
})

describe('engine tool wrappers', () => {
  it('logProgressTool wraps logProgress', async () => {
    const progressPath = path.join(tmpDir, 'PROGRESS-tool.md')
    const result = await logProgressTool.execute(
      {
        progressPath,
        entry: {
          timestamp: new Date().toISOString(),
          agentId: 'x',
          domain: 'y',
          summary: 'engine wrapper',
          type: 'heartbeat',
        },
      },
      ctx,
    )
    expect(result.is_error).toBe(false)
    expect(result.metadata?.success).toBe(true)
  })

  it('logDecisionTool wraps logDecision', async () => {
    const decisionsPath = path.join(tmpDir, 'DECISIONS-tool.md')
    const result = await logDecisionTool.execute(
      {
        decisionsPath,
        entry: {
          id: 'ADR-X',
          timestamp: new Date().toISOString(),
          agentId: 'a',
          domain: 'd',
          title: 't',
          context: 'c',
          decision: 'd',
          consequences: 'c',
        },
      },
      ctx,
    )
    expect(result.is_error).toBe(false)
  })

  it('updateMemoryTool wraps updateMemory', async () => {
    const memoryPath = path.join(tmpDir, 'MEMORY-tool.md')
    const result = await updateMemoryTool.execute(
      { memoryPath, section: 'S', content: 'C' },
      ctx,
    )
    expect(result.is_error).toBe(false)
  })
})
