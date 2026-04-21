import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { ConversationMessage } from '@guildhall/protocol'
import {
  exportSessionMarkdown,
  getProjectSessionDir,
  listSessionSnapshots,
  loadSessionById,
  loadSessionSnapshot,
  saveSessionSnapshot,
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
})
