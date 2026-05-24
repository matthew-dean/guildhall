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
let dataDir: string

beforeEach(async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-expl-'))
  memoryDir = path.join(tmp, 'memory')
  dataDir = path.join(tmp, '.guildhall', 'data')
  process.env.GUILDHALL_DATA_DIR = dataDir
  await fs.mkdir(memoryDir, { recursive: true })
})

afterEach(async () => {
  delete process.env.GUILDHALL_DATA_DIR
  await fs.rm(path.dirname(memoryDir), { recursive: true, force: true })
})

describe('appendExploringTranscript', () => {
  it('creates a user-local exploring transcript on first write', async () => {
    const result = await appendExploringTranscript({
      memoryDir,
      taskId: 'task-001',
      role: 'user',
      content: 'I want a ghost button variant',
    })
    expect(result.success).toBe(true)
    expect(result.created).toBe(true)
    expect(result.path).toBeTruthy()
    expect(result.path).toContain(path.join(dataDir, 'projects'))

    const content = await fs.readFile(result.path!, 'utf-8')
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

    const content = await fs.readFile(second.path!, 'utf-8')
    expect(content).toContain('first message')
    expect(content).toContain('second message')
    // Header should only appear once.
    const matches = content.match(/# Exploring transcript/g) ?? []
    expect(matches).toHaveLength(1)
  })

  it('creates the local transcript subdirectory automatically', async () => {
    const result = await appendExploringTranscript({
      memoryDir,
      taskId: 'task-abc',
      role: 'user',
      content: 'hi',
    })
    expect(result.success).toBe(true)
    const stat = await fs.stat(path.dirname(result.path!))
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
    const a = (await readExploringTranscript({ memoryDir, taskId: 'task-001' })).content ?? ''
    const b = (await readExploringTranscript({ memoryDir, taskId: 'task-002' })).content ?? ''
    expect(a).toContain('alpha')
    expect(a).not.toContain('beta')
    expect(b).toContain('beta')
    expect(b).not.toContain('alpha')
  })

  it('stamps each entry with an ISO timestamp', async () => {
    const result = await appendExploringTranscript({
      memoryDir,
      taskId: 'task-001',
      role: 'user',
      content: 'x',
    })
    const content = await fs.readFile(result.path!, 'utf-8')
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
    const content = (await readExploringTranscript({ memoryDir, taskId: 'task-001' })).content ?? ''
    for (const role of roles) {
      expect(content).toContain(`msg from ${role}`)
    }
  })
})

describe('readExploringTranscript', () => {
  it('writes and reads transcripts from user-local history by default', async () => {
    const projectRoot = path.dirname(memoryDir)
    const result = await appendExploringTranscript({
      memoryDir,
      taskId: 'task-local',
      role: 'user',
      content: 'keep this out of git',
    })
    expect(result.success).toBe(true)
    expect(result.path).not.toContain(`${path.sep}memory${path.sep}exploring${path.sep}`)

    await expect(
      fs.access(path.join(memoryDir, 'exploring', 'task-local.md')),
    ).rejects.toThrow()

    const read = await readExploringTranscript({ memoryDir, taskId: 'task-local' })
    expect(read.content).toContain('keep this out of git')
    expect(read.path).toBe(result.path)
    expect(read.path).toContain(path.join('.guildhall', 'data', 'projects').replaceAll('/', path.sep))
    expect(read.path).toContain(path.basename(projectRoot))
  })

  it('falls back to the legacy project memory transcript before migration', async () => {
    const legacyPath = path.join(memoryDir, 'exploring', 'legacy-task.md')
    await fs.mkdir(path.dirname(legacyPath), { recursive: true })
    await fs.writeFile(legacyPath, '# Exploring transcript: legacy-task\n\nlegacy context\n', 'utf8')

    const result = await readExploringTranscript({ memoryDir, taskId: 'legacy-task' })

    expect(result.content).toContain('legacy context')
    expect(result.path).toBe(legacyPath)
  })

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
    expect(result.path).toContain(path.join(dataDir, 'projects'))
    expect(result.path.endsWith(path.join('transcripts', 'exploring', 'never-existed.md'))).toBe(true)
  })
})

describe('exploringTranscriptPath', () => {
  it('returns the canonical user-local transcript path', () => {
    const p = exploringTranscriptPath('/abs/memory', 'my-task')
    expect(p).toContain(path.join(dataDir, 'projects'))
    expect(p.endsWith(path.join('transcripts', 'exploring', 'my-task.md'))).toBe(true)
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
    const transcript = (await readExploringTranscript({ memoryDir, taskId: 'task-meta' })).content ?? ''
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
    const transcript = (await readExploringTranscript({ memoryDir, taskId: 'task-meta-inferred' })).content ?? ''
    expect(transcript).toContain('spec-agent')
    expect(transcript).toContain('Please pick one of the structured options.')
  })

  it('recovers transcript content from a nested stringified item payload', async () => {
    const result = await appendExploringTranscriptTool.execute(
      {
        item: JSON.stringify({
          message: 'I think the remaining question is whether Knit should expose Looma tables unchanged.',
          role: 'spec-agent',
        }),
      },
      {
        cwd: '/tmp',
        metadata: {
          memory_dir: memoryDir,
          current_task_id: 'task-meta-item',
          current_agent_id: 'spec-agent',
        },
      },
    )
    expect(result.is_error).toBe(false)
    const transcript = (await readExploringTranscript({ memoryDir, taskId: 'task-meta-item' })).content ?? ''
    expect(transcript).toContain('spec-agent')
    expect(transcript).toContain('I think the remaining question is whether Knit should expose Looma tables unchanged.')
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
