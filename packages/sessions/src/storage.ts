/**
 * Ported from openharness/src/openharness/services/session_storage.py
 * Upstream: https://github.com/HKUDS/OpenHarness (MIT)
 * Upstream SHA at port time: 559ba76f237db957a1a21453170df8500479dc7d
 *
 * Changes from upstream:
 *   - `hashlib.sha1` → `crypto.createHash('sha1')`
 *   - `pathlib.Path.resolve` → `node:path.resolve`
 *   - `model.model_dump(mode='json')` → the ported ConversationMessage is
 *     already plain JSON-safe objects; no serialization step needed
 *   - `uuid.uuid4().hex[:12]` → 12 hex chars from randomBytes
 *   - `time.time()` (seconds) → `Date.now() / 1000` to keep payload shape
 *     byte-identical to upstream so snapshots can be swapped for debugging
 *   - Export-session-markdown inlines the escaping rather than depending on
 *     upstream's more elaborate encoder.
 */

import { createHash, randomBytes } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

import {
  type ConversationMessage,
  type UsageSnapshot,
  conversationMessageSchema,
  messageText,
  messageToolUses,
  sanitizeConversationMessages,
} from '@guildhall/protocol'

import { atomicWriteText } from './atomic.js'
import { getSessionsDir } from './paths.js'

export const PERSISTED_TOOL_METADATA_KEYS = [
  'permission_mode',
  'read_file_state',
  'invoked_skills',
  'async_agent_state',
  'async_agent_tasks',
  'recent_work_log',
  'recent_verified_work',
  'task_focus_state',
  'compact_checkpoints',
  'compact_last',
] as const

function sanitizeMetadataValue(value: unknown): unknown {
  if (value === null) return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }
  if (Array.isArray(value)) return value.map(sanitizeMetadataValue)
  if (value instanceof Set) return [...value].map(sanitizeMetadataValue)
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[String(k)] = sanitizeMetadataValue(v)
    return out
  }
  return String(value)
}

function persistableToolMetadata(
  metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!metadata || typeof metadata !== 'object') return {}
  const payload: Record<string, unknown> = {}
  for (const key of PERSISTED_TOOL_METADATA_KEYS) {
    if (key in metadata) payload[key] = sanitizeMetadataValue(metadata[key])
  }
  return payload
}

export function getProjectSessionDir(cwd: string): string {
  const resolved = resolve(cwd)
  const digest = createHash('sha1').update(resolved).digest('hex').slice(0, 12)
  const name = basename(resolved) || 'root'
  const dir = join(getSessionsDir(), `${name}-${digest}`)
  return dir
}

export interface SessionSnapshot {
  session_id: string
  cwd: string
  model: string
  system_prompt: string
  messages: ConversationMessage[]
  usage: UsageSnapshot
  tool_metadata: Record<string, unknown>
  created_at: number
  summary: string
  message_count: number
}

export interface SaveSessionOptions {
  cwd: string
  model: string
  systemPrompt: string
  messages: ConversationMessage[]
  usage: UsageSnapshot
  sessionId?: string
  toolMetadata?: Record<string, unknown>
}

export function saveSessionSnapshot(opts: SaveSessionOptions): string {
  const sessionDir = getProjectSessionDir(opts.cwd)
  const sid = opts.sessionId ?? randomBytes(6).toString('hex')
  const now = Date.now() / 1000

  const sanitized = sanitizeConversationMessages(opts.messages)
  let summary = ''
  for (const msg of sanitized) {
    if (msg.role === 'user') {
      const text = messageText(msg).trim()
      if (text.length > 0) {
        summary = text.slice(0, 80)
        break
      }
    }
  }

  const payload: SessionSnapshot = {
    session_id: sid,
    cwd: resolve(opts.cwd),
    model: opts.model,
    system_prompt: opts.systemPrompt,
    messages: sanitized,
    usage: opts.usage,
    tool_metadata: persistableToolMetadata(opts.toolMetadata),
    created_at: now,
    summary,
    message_count: sanitized.length,
  }
  const data = JSON.stringify(payload, null, 2) + '\n'

  const latestPath = join(sessionDir, 'latest.json')
  atomicWriteText(latestPath, data)

  const sessionPath = join(sessionDir, `session-${sid}.json`)
  atomicWriteText(sessionPath, data)

  return latestPath
}

function reviveSnapshot(payload: Record<string, unknown>): SessionSnapshot | null {
  const rawMessages = payload.messages
  if (!Array.isArray(rawMessages)) return null
  const revived: ConversationMessage[] = []
  for (const raw of rawMessages) {
    const parse = conversationMessageSchema.safeParse(raw)
    if (parse.success) revived.push(parse.data)
  }
  const messages = sanitizeConversationMessages(revived)
  return {
    session_id: typeof payload.session_id === 'string' ? payload.session_id : 'unknown',
    cwd: typeof payload.cwd === 'string' ? payload.cwd : '',
    model: typeof payload.model === 'string' ? payload.model : '',
    system_prompt: typeof payload.system_prompt === 'string' ? payload.system_prompt : '',
    messages,
    usage:
      typeof payload.usage === 'object' && payload.usage !== null
        ? (payload.usage as UsageSnapshot)
        : { input_tokens: 0, output_tokens: 0 },
    tool_metadata:
      typeof payload.tool_metadata === 'object' && payload.tool_metadata !== null
        ? (payload.tool_metadata as Record<string, unknown>)
        : {},
    created_at: typeof payload.created_at === 'number' ? payload.created_at : 0,
    summary: typeof payload.summary === 'string' ? payload.summary : '',
    message_count: messages.length,
  }
}

export function loadSessionSnapshot(cwd: string): SessionSnapshot | null {
  const path = join(getProjectSessionDir(cwd), 'latest.json')
  if (!existsSync(path)) return null
  try {
    return reviveSnapshot(JSON.parse(readFileSync(path, 'utf8')))
  } catch {
    return null
  }
}

export interface SessionSummary {
  session_id: string
  summary: string
  message_count: number
  model: string
  created_at: number
}

function extractSummary(data: Record<string, unknown>): string {
  const existing = typeof data.summary === 'string' ? data.summary : ''
  if (existing.length > 0) return existing
  const msgs = Array.isArray(data.messages) ? data.messages : []
  for (const raw of msgs) {
    if (raw !== null && typeof raw === 'object' && (raw as Record<string, unknown>).role === 'user') {
      const content = (raw as Record<string, unknown>).content
      if (Array.isArray(content)) {
        const texts: string[] = []
        for (const block of content) {
          if (block !== null && typeof block === 'object') {
            const b = block as Record<string, unknown>
            if (b.type === 'text' && typeof b.text === 'string') texts.push(b.text)
          }
        }
        const joined = texts.join(' ').trim().slice(0, 80)
        if (joined.length > 0) return joined
      }
    }
  }
  return ''
}

export function listSessionSnapshots(cwd: string, limit = 20): SessionSummary[] {
  const sessionDir = getProjectSessionDir(cwd)
  if (!existsSync(sessionDir)) return []

  const all = readdirSync(sessionDir)
    .filter((n) => n.startsWith('session-') && n.endsWith('.json'))
    .map((n) => {
      const full = join(sessionDir, n)
      const mtime = statSync(full).mtimeMs / 1000
      return { name: n, path: full, mtime }
    })
    .sort((a, b) => b.mtime - a.mtime)

  const sessions: SessionSummary[] = []
  const seen = new Set<string>()

  for (const entry of all) {
    try {
      const data = JSON.parse(readFileSync(entry.path, 'utf8')) as Record<string, unknown>
      const sid =
        typeof data.session_id === 'string'
          ? data.session_id
          : entry.name.replace(/^session-/, '').replace(/\.json$/, '')
      seen.add(sid)
      const messageCount =
        typeof data.message_count === 'number'
          ? data.message_count
          : Array.isArray(data.messages)
            ? data.messages.length
            : 0
      sessions.push({
        session_id: sid,
        summary: extractSummary(data),
        message_count: messageCount,
        model: typeof data.model === 'string' ? data.model : '',
        created_at: typeof data.created_at === 'number' ? data.created_at : entry.mtime,
      })
    } catch {
      continue
    }
    if (sessions.length >= limit) break
  }

  const latestPath = join(sessionDir, 'latest.json')
  if (existsSync(latestPath) && sessions.length < limit) {
    try {
      const data = JSON.parse(readFileSync(latestPath, 'utf8')) as Record<string, unknown>
      const sid = typeof data.session_id === 'string' ? data.session_id : 'latest'
      if (!seen.has(sid)) {
        const mtime = statSync(latestPath).mtimeMs / 1000
        const messageCount =
          typeof data.message_count === 'number'
            ? data.message_count
            : Array.isArray(data.messages)
              ? data.messages.length
              : 0
        sessions.push({
          session_id: sid,
          summary: extractSummary(data) || '(latest session)',
          message_count: messageCount,
          model: typeof data.model === 'string' ? data.model : '',
          created_at: typeof data.created_at === 'number' ? data.created_at : mtime,
        })
      }
    } catch {
      // ignore malformed latest.json
    }
  }

  sessions.sort((a, b) => b.created_at - a.created_at)
  return sessions.slice(0, limit)
}

export function loadSessionById(cwd: string, sessionId: string): SessionSnapshot | null {
  const sessionDir = getProjectSessionDir(cwd)
  const named = join(sessionDir, `session-${sessionId}.json`)
  if (existsSync(named)) {
    try {
      return reviveSnapshot(JSON.parse(readFileSync(named, 'utf8')))
    } catch {
      return null
    }
  }
  const latest = join(sessionDir, 'latest.json')
  if (existsSync(latest)) {
    try {
      const data = reviveSnapshot(JSON.parse(readFileSync(latest, 'utf8')))
      if (data && (data.session_id === sessionId || sessionId === 'latest')) return data
    } catch {
      return null
    }
  }
  return null
}

export function exportSessionMarkdown(cwd: string, messages: ConversationMessage[]): string {
  const sessionDir = getProjectSessionDir(cwd)
  const path = join(sessionDir, 'transcript.md')
  const parts: string[] = ['# Guildhall Session Transcript']
  for (const message of messages) {
    const roleLabel = message.role.charAt(0).toUpperCase() + message.role.slice(1)
    parts.push(`\n## ${roleLabel}\n`)
    const text = messageText(message).trim()
    if (text.length > 0) parts.push(text)
    for (const block of messageToolUses(message)) {
      parts.push(`\n\`\`\`tool\n${block.name} ${JSON.stringify(block.input)}\n\`\`\``)
    }
    for (const block of message.content) {
      if (block.type === 'tool_result') {
        parts.push(`\n\`\`\`tool-result\n${block.content}\n\`\`\``)
      }
    }
  }
  atomicWriteText(path, parts.join('\n').trim() + '\n')
  return path
}
