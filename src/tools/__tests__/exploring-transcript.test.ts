import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {
  appendExploringTranscript,
  readExploringTranscript,
  appendExploringTranscriptTool,
  readExploringTranscriptTool,
  exploringTranscriptPath,
} from '../exploring-transcript.js'

// ---------------------------------------------------------------------------
// FR-08 / FR-12: exploring transcript persistence tests.
// ---------------------------------------------------------------------------

let memoryDir: string

beforeEach(async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-expl-'))
  memoryDir = path.join(tmp, 'memory')
  await fs.mkdir(memoryDir, { recursive: true })
})

afterEach(async () => {
  await fs.rm(path.dirname(memoryDir), { recursive: true, force: true })
})

describe('appendExploringTranscript', () => {
  it('creates memory/exploring/<task-id>.md on first write', async () => {
    const result = await appendExploringTranscript({
      memoryDir,
      taskId: 'task-001',
      role: 'user',
      content: 'I want a ghost button variant',
    })
    expect(result.success).toBe(true)
    expect(result.created).toBe(true)
    const expected = path.join(memoryDir, 'exploring', 'task-001.md')
    expect(result.path).toBe(expected)

    const content = await fs.readFile(expected, 'utf-8')
    expect(content).toContain('# Exploring transcript: task-001')
    expect(content).toContain('## [')
    expect(content).toContain('user')
    expect(content).toContain('I want a ghost button variant')
  })

  it('appends subsequent messages without recreating the file', async () => {
    await appendExploringTranscript({
      memoryDir,
      taskId: 'task-001',
      role: 'user',
      content: 'first message',
    })
    const second = await appendExploringTranscript({
      memoryDir,
      taskId: 'task-001',
      role: 'spec-agent',
      content: 'second message',
    })
    expect(second.success).toBe(true)
    expect(second.created).toBe(false)

    const content = await fs.readFile(
      path.join(memoryDir, 'exploring', 'task-001.md'),
      'utf-8',
    )
    expect(content).toContain('first message')
    expect(content).toContain('second message')
    // Header should only appear once.
    const matches = content.match(/# Exploring transcript/g) ?? []
    expect(matches).toHaveLength(1)
  })

  it('creates the exploring subdirectory automatically', async () => {
    // Fresh memoryDir without a pre-existing exploring/ folder.
    const result = await appendExploringTranscript({
      memoryDir,
      taskId: 'task-abc',
      role: 'user',
      content: 'hi',
    })
    expect(result.success).toBe(true)
    const stat = await fs.stat(path.join(memoryDir, 'exploring'))
    expect(stat.isDirectory()).toBe(true)
  })

  it('separates transcripts by task id', async () => {
    await appendExploringTranscript({
      memoryDir,
      taskId: 'task-001',
      role: 'user',
      content: 'alpha',
    })
    await appendExploringTranscript({
      memoryDir,
      taskId: 'task-002',
      role: 'user',
      content: 'beta',
    })
    const a = await fs.readFile(
      path.join(memoryDir, 'exploring', 'task-001.md'),
      'utf-8',
    )
    const b = await fs.readFile(
      path.join(memoryDir, 'exploring', 'task-002.md'),
      'utf-8',
    )
    expect(a).toContain('alpha')
    expect(a).not.toContain('beta')
    expect(b).toContain('beta')
    expect(b).not.toContain('alpha')
  })

  it('stamps each entry with an ISO timestamp', async () => {
    await appendExploringTranscript({
      memoryDir,
      taskId: 'task-001',
      role: 'user',
      content: 'x',
    })
    const content = await fs.readFile(
      path.join(memoryDir, 'exploring', 'task-001.md'),
      'utf-8',
    )
    // ISO-8601 timestamp inside brackets
    expect(content).toMatch(/## \[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })

  it('accepts spec-agent, user, and system roles', async () => {
    const roles = ['user', 'spec-agent', 'system'] as const
    for (const role of roles) {
      const r = await appendExploringTranscript({
        memoryDir,
        taskId: 'task-001',
        role,
        content: `msg from ${role}`,
      })
      expect(r.success).toBe(true)
    }
    const content = await fs.readFile(
      path.join(memoryDir, 'exploring', 'task-001.md'),
      'utf-8',
    )
    for (const role of roles) {
      expect(content).toContain(`msg from ${role}`)
    }
  })
})

describe('readExploringTranscript', () => {
  it('returns content of an existing transcript', async () => {
    await appendExploringTranscript({
      memoryDir,
      taskId: 'task-001',
      role: 'user',
      content: 'hello',
    })
    const result = await readExploringTranscript({ memoryDir, taskId: 'task-001' })
    expect(result.content).toContain('hello')
  })

  it('returns null content (not an error) for a missing transcript', async () => {
    const result = await readExploringTranscript({
      memoryDir,
      taskId: 'never-existed',
    })
    expect(result.content).toBeNull()
    expect(result.error).toBeUndefined()
    expect(result.path).toBe(
      path.join(memoryDir, 'exploring', 'never-existed.md'),
    )
  })
})

describe('exploringTranscriptPath', () => {
  it('returns the canonical <memory>/exploring/<task-id>.md path', () => {
    const p = exploringTranscriptPath('/abs/memory', 'my-task')
    expect(p).toBe(path.join('/abs/memory', 'exploring', 'my-task.md'))
  })
})

describe('engine tool wrappers', () => {
  const ctx = { cwd: '/tmp', metadata: {} }

  it('appendExploringTranscriptTool reports success', async () => {
    const result = await appendExploringTranscriptTool.execute(
      {
        memoryDir,
        taskId: 'task-001',
        role: 'user',
        content: 'first',
      },
      ctx,
    )
    expect(result.is_error).toBe(false)
    expect(result.output).toContain('Appended user message')
    expect(result.output).toContain('(new transcript)')
  })

  it('readExploringTranscriptTool returns placeholder for missing transcript', async () => {
    const result = await readExploringTranscriptTool.execute(
      { memoryDir, taskId: 'no-such-task' },
      ctx,
    )
    expect(result.is_error).toBe(false)
    expect(result.output).toContain('(no transcript yet at')
  })

  it('defaults appendExploringTranscriptTool task context from metadata', async () => {
    const result = await appendExploringTranscriptTool.execute(
      {
        role: 'spec-agent',
        content: 'hello from metadata defaults',
      },
      {
        cwd: '/tmp',
        metadata: {
          memory_dir: memoryDir,
          current_task_id: 'task-meta',
        },
      },
    )
    expect(result.is_error).toBe(false)
    const transcript = await fs.readFile(
      path.join(memoryDir, 'exploring', 'task-meta.md'),
      'utf-8',
    )
    expect(transcript).toContain('hello from metadata defaults')
  })

  it('infers transcript role/content from metadata when the model calls it with {}', async () => {
    const result = await appendExploringTranscriptTool.execute(
      {},
      {
        cwd: '/tmp',
        metadata: {
          memory_dir: memoryDir,
          current_task_id: 'task-meta-inferred',
          current_agent_id: 'spec-agent',
          last_assistant_text: 'Please pick one of the structured options.',
        },
      },
    )
    expect(result.is_error).toBe(false)
    const transcript = await fs.readFile(
      path.join(memoryDir, 'exploring', 'task-meta-inferred.md'),
      'utf-8',
    )
    expect(transcript).toContain('spec-agent')
    expect(transcript).toContain('Please pick one of the structured options.')
  })

  it('defaults readExploringTranscriptTool task context from metadata', async () => {
    await appendExploringTranscript({
      memoryDir,
      taskId: 'task-meta-read',
      role: 'user',
      content: 'persisted through metadata',
    })
    const result = await readExploringTranscriptTool.execute(
      {},
      {
        cwd: '/tmp',
        metadata: {
          memory_dir: memoryDir,
          current_task_id: 'task-meta-read',
        },
      },
    )
    expect(result.is_error).toBe(false)
    expect(result.output).toContain('persisted through metadata')
  })
})
