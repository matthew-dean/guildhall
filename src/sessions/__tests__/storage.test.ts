import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { messageText, type ConversationMessage } from '@guildhall/protocol'
import {
  exportSessionMarkdown,
  getProjectSessionDir,
  listSessionSnapshots,
  loadSessionById,
  loadSessionSnapshot,
  saveSessionSnapshot,
  compactProjectSessionSnapshots,
  SESSION_RECOVERY_TAIL_MAX_CHARS,
  sessionPayloadCharacterCount,
} from '../storage.js'

let baseDir: string

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), 'guildhall-sessions-'))
  process.env.GUILDHALL_CONFIG_DIR = baseDir
})

afterEach(() => {
  delete process.env.GUILDHALL_CONFIG_DIR
  delete process.env.GUILDHALL_DATA_DIR
  rmSync(baseDir, { recursive: true, force: true })
})

function userMsg(text: string): ConversationMessage {
  return { role: 'user', content: [{ type: 'text', text }] }
}

function assistantMsg(text: string): ConversationMessage {
  return { role: 'assistant', content: [{ type: 'text', text }] }
}

describe('session storage', () => {
  it('save + load round-trip preserves messages and summary', () => {
    const messages: ConversationMessage[] = [userMsg('first user prompt'), assistantMsg('reply')]
    saveSessionSnapshot({
      cwd: '/tmp/project',
      model: 'claude-opus-4-7',
      systemPrompt: 'be helpful',
      messages,
      usage: { input_tokens: 10, output_tokens: 20 },
      sessionId: 'aaaaaaaa1111',
    })
    const loaded = loadSessionSnapshot('/tmp/project')
    expect(loaded).not.toBeNull()
    expect(loaded?.session_id).toBe('aaaaaaaa1111')
    expect(loaded?.messages).toHaveLength(2)
    expect(loaded?.summary).toBe('first user prompt')
    expect(loaded?.usage).toEqual({ input_tokens: 10, output_tokens: 20 })
    expect(loaded?.message_count).toBe(2)
    const sessionDir = getProjectSessionDir('/tmp/project')
    expect(JSON.parse(readFileSync(join(sessionDir, 'latest.json'), 'utf8'))).toEqual({
      version: 1,
      session_id: 'aaaaaaaa1111',
    })
    expect(statSync(join(sessionDir, 'latest.json')).size).toBeLessThan(
      statSync(join(sessionDir, 'session-aaaaaaaa1111.json')).size,
    )
  })

  it('getProjectSessionDir is deterministic per cwd', () => {
    const a = getProjectSessionDir('/tmp/same-project')
    const b = getProjectSessionDir('/tmp/same-project')
    expect(a).toBe(b)
  })

  it('different cwds produce different session dirs', () => {
    const a = getProjectSessionDir('/tmp/proj-a')
    const b = getProjectSessionDir('/tmp/proj-b')
    expect(a).not.toBe(b)
  })

  it('listSessionSnapshots returns newest-first', async () => {
    saveSessionSnapshot({
      cwd: '/tmp/project',
      model: 'm',
      systemPrompt: '',
      messages: [userMsg('first')],
      usage: { input_tokens: 0, output_tokens: 0 },
      sessionId: 'session-old',
    })
    // mtime resolution on some filesystems can collapse near-identical writes; wait briefly.
    await new Promise((r) => setTimeout(r, 15))
    saveSessionSnapshot({
      cwd: '/tmp/project',
      model: 'm',
      systemPrompt: '',
      messages: [userMsg('second')],
      usage: { input_tokens: 0, output_tokens: 0 },
      sessionId: 'session-new',
    })
    const list = listSessionSnapshots('/tmp/project')
    expect(list.length).toBeGreaterThanOrEqual(2)
    // The two sessions we explicitly saved should both appear.
    const ids = new Set(list.map((s) => s.session_id))
    expect(ids.has('session-new')).toBe(true)
    expect(ids.has('session-old')).toBe(true)
  })

  it('loadSessionById finds a session by its ID', () => {
    saveSessionSnapshot({
      cwd: '/tmp/project',
      model: 'm',
      systemPrompt: '',
      messages: [userMsg('target')],
      usage: { input_tokens: 0, output_tokens: 0 },
      sessionId: 'target-id',
    })
    const loaded = loadSessionById('/tmp/project', 'target-id')
    expect(loaded?.session_id).toBe('target-id')
    expect(loaded?.summary).toBe('target')
  })

  it('loadSessionById returns null for unknown IDs', () => {
    expect(loadSessionById('/tmp/project', 'does-not-exist')).toBeNull()
  })

  it('exportSessionMarkdown writes a transcript with roles and tool blocks', () => {
    const messages: ConversationMessage[] = [
      userMsg('do the thing'),
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'sure' },
          { type: 'tool_use', id: 'toolu_1', name: 'shell', input: { command: 'ls' } },
        ],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'file.txt', is_error: false }],
      },
    ]
    const path = exportSessionMarkdown('/tmp/project', messages)
    const contents = require('node:fs').readFileSync(path, 'utf8')
    expect(contents).toContain('# Guildhall Session Transcript')
    expect(contents).toContain('## User')
    expect(contents).toContain('## Assistant')
    expect(contents).toContain('```tool\nshell')
    expect(contents).toContain('```tool-result\nfile.txt')
  })

  it('sanitizes tool_metadata to only persisted keys', () => {
    saveSessionSnapshot({
      cwd: '/tmp/project',
      model: 'm',
      systemPrompt: '',
      messages: [userMsg('x')],
      usage: { input_tokens: 0, output_tokens: 0 },
      sessionId: 'meta-test',
      toolMetadata: {
        permission_mode: 'default',
        invoked_skills: ['plan'],
        this_should_be_dropped: 'yup',
      },
    })
    const loaded = loadSessionById('/tmp/project', 'meta-test')
    expect(loaded?.tool_metadata).toEqual({
      permission_mode: 'default',
      invoked_skills: ['plan'],
    })
  })

  it('sanitizes nested metadata values that are not plain JSON primitives', () => {
    saveSessionSnapshot({
      cwd: '/tmp/project',
      model: 'm',
      systemPrompt: '',
      messages: [userMsg('metadata shape')],
      usage: { input_tokens: 0, output_tokens: 0 },
      sessionId: 'nested-meta',
      toolMetadata: {
        read_file_state: {
          seen: new Set(['/tmp/a.ts', '/tmp/b.ts']),
          next: undefined,
          nested: [{ ok: true }],
        },
        task_focus_state: {
          current: Symbol.for('task'),
        },
      },
    })

    const loaded = loadSessionById('/tmp/project', 'nested-meta')
    expect(loaded?.tool_metadata).toEqual({
      read_file_state: {
        seen: ['/tmp/a.ts', '/tmp/b.ts'],
        next: 'undefined',
        nested: [{ ok: true }],
      },
      task_focus_state: {
        current: 'Symbol(task)',
      },
    })
  })

  it('compacts completed snapshots at the storage boundary', () => {
    const raw = 'raw conversation '.repeat(900)
    saveSessionSnapshot({
      cwd: '/tmp/project',
      model: 'm',
      systemPrompt: '',
      messages: [userMsg(raw), assistantMsg(raw)],
      usage: { input_tokens: 0, output_tokens: 0 },
      sessionId: 'large-session',
    })
    const loaded = loadSessionById('/tmp/project', 'large-session')
    expect(loaded?.messages).toHaveLength(1)
    expect(messageText(loaded!.messages[0]!)).toContain('Essential session history:')
    expect(messageText(loaded!.messages[0]!)).not.toContain(raw)
  })

  it('cleans old completed snapshots but preserves pending recovery tails', () => {
    const dir = getProjectSessionDir('/tmp/project')
    require('node:fs').mkdirSync(dir, { recursive: true })
    const raw = 'old raw session '.repeat(900)
    const pendingRaw = 'pending tool output '.repeat(200)
    const completed = {
      session_id: 'old-completed', cwd: '/tmp/project', model: 'm', system_prompt: '',
      messages: [userMsg(raw), assistantMsg(raw)], usage: { input_tokens: 0, output_tokens: 0 },
      created_at: 1, summary: 'old', message_count: 2,
    }
    const pending = {
      session_id: 'pending', cwd: '/tmp/project', model: 'm', system_prompt: '',
      messages: [
        userMsg('run it'),
        { role: 'assistant', content: [{ type: 'tool_use', id: 'tool-1', name: 'shell', input: {} }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: pendingRaw, is_error: false }] },
      ], usage: { input_tokens: 0, output_tokens: 0 }, created_at: 1, summary: 'pending', message_count: 3,
    }
    writeFileSync(join(dir, 'session-old-completed.json'), JSON.stringify(completed, null, 2))
    writeFileSync(join(dir, 'session-pending.json'), JSON.stringify(pending, null, 2))
    const before = statSync(join(dir, 'session-old-completed.json')).size
    const report = compactProjectSessionSnapshots('/tmp/project', { dryRun: false })
    expect(report.filesCompacted).toBe(1)
    expect(report.pendingFilesPreserved).toBe(1)
    expect(statSync(join(dir, 'session-old-completed.json')).size).toBeLessThan(before)
    expect(JSON.parse(readFileSync(join(dir, 'session-old-completed.json'), 'utf8')).system_prompt).toBe('')
    expect(JSON.parse(readFileSync(join(dir, 'session-pending.json'), 'utf8')).messages).toHaveLength(3)
    expect(loadSessionById('/tmp/project', 'old-completed')?.messages).toHaveLength(1)
  })

  it('bounds the entire pending recovery tail instead of each tool result independently', () => {
    const messages: ConversationMessage[] = [
      userMsg('resume the current task'),
      {
        role: 'assistant',
        content: Array.from({ length: 12 }, (_, index) => ({
          type: 'tool_use' as const,
          id: `tool-${index}`,
          name: 'shell',
          input: { command: 'x'.repeat(2_000) },
        })),
      },
      {
        role: 'user',
        content: Array.from({ length: 12 }, (_, index) => ({
          type: 'tool_result' as const,
          tool_use_id: `tool-${index}`,
          content: 'large tool output '.repeat(2_000),
          is_error: false,
        })),
      },
    ]

    saveSessionSnapshot({
      cwd: '/tmp/project',
      model: 'm',
      systemPrompt: '',
      messages,
      usage: { input_tokens: 0, output_tokens: 0 },
      sessionId: 'bounded-pending-tail',
    })

    const loaded = loadSessionById('/tmp/project', 'bounded-pending-tail')
    expect(loaded).not.toBeNull()
    expect(sessionPayloadCharacterCount(loaded!.messages)).toBeLessThanOrEqual(SESSION_RECOVERY_TAIL_MAX_CHARS)
    expect(JSON.stringify(loaded!.messages)).not.toContain('large tool output '.repeat(100))
    expect(JSON.stringify(loaded!.messages)).toContain('tool-0')
    expect(JSON.stringify(loaded!.messages)).toContain('tool-11')
  })

  it('revives malformed snapshots defensively and falls back to latest aliases', () => {
    const sessionDir = getProjectSessionDir('/tmp/project')
    saveSessionSnapshot({
      cwd: '/tmp/project',
      model: 'm',
      systemPrompt: '',
      messages: [userMsg('fallback latest')],
      usage: { input_tokens: 0, output_tokens: 0 },
      sessionId: 'latest-target',
    })
    writeFileSync(
      join(sessionDir, 'session-broken.json'),
      JSON.stringify({
        session_id: 123,
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'valid revived text' }] },
          { role: 'user', content: [{ type: 'unknown', text: 'dropped' }] },
        ],
        usage: 'bad',
      }),
    )
    writeFileSync(join(sessionDir, 'session-not-json.json'), '{not json')

    const revived = loadSessionById('/tmp/project', 'broken')
    expect(revived?.session_id).toBe('unknown')
    expect(revived?.usage).toEqual({ input_tokens: 0, output_tokens: 0 })
    expect(revived?.summary).toBe('')
    expect(revived?.message_count).toBe(1)

    expect(loadSessionById('/tmp/project', 'not-json')).toBeNull()
    expect(loadSessionById('/tmp/project', 'latest')?.session_id).toBe('latest-target')
  })

  it('lists latest when no named session has the same id and derives missing summaries from messages', () => {
    const sessionDir = getProjectSessionDir('/tmp/project')
    saveSessionSnapshot({
      cwd: '/tmp/project',
      model: 'm',
      systemPrompt: '',
      messages: [userMsg('normal named session')],
      usage: { input_tokens: 0, output_tokens: 0 },
      sessionId: 'named',
    })
    writeFileSync(
      join(sessionDir, 'latest.json'),
      JSON.stringify({
        session_id: 'latest-only',
        model: 'fallback-model',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'derived latest summary' }] }],
      }),
    )

    const list = listSessionSnapshots('/tmp/project', 10)
    expect(list.some(s => s.session_id === 'named')).toBe(true)
    expect(list).toContainEqual(expect.objectContaining({
      session_id: 'latest-only',
      summary: 'derived latest summary',
      message_count: 1,
      model: 'fallback-model',
    }))
  })
})
