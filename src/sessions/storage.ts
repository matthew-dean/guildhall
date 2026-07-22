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
  'recent_verification_results',
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

interface LatestSessionPointer {
  version: 1
  session_id: string
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

/**
 * Completed conversations are memory for the running agent, not project
 * history. Keep only a small bounded record at the persistence boundary; a
 * pending tool-result tail is the one exception because it is needed for
 * crash recovery.
 */
export const SESSION_COMPACTION_THRESHOLD = 12_000
export const SESSION_SUMMARY_MAX_CHARS = 6_000
export const SESSION_RECOVERY_TAIL_MAX_CHARS = 8_000

export interface SessionSnapshotCompactionResult {
  filesSeen: number
  filesCompacted: number
  pendingFilesPreserved: number
  bytesBefore: number
  bytesAfter: number
}

export function messageCharacterCount(messages: readonly ConversationMessage[]): number {
  return messages.reduce((total, message) => total + messageText(message).length, 0)
}

export function sessionPayloadCharacterCount(messages: readonly ConversationMessage[]): number {
  return JSON.stringify(messages).length
}

function hasPendingContinuation(messages: readonly ConversationMessage[]): boolean {
  const last = messages.at(-1)
  if (!last || last.role !== 'user') return false
  if (!last.content.some(block => block.type === 'tool_result')) return false
  for (let i = messages.length - 2; i >= 0; i -= 1) {
    const message = messages[i]
    if (message?.role !== 'assistant') continue
    return messageToolUses(message).length > 0
  }
  return false
}

function pendingContinuationStart(messages: readonly ConversationMessage[]): number | null {
  if (!hasPendingContinuation(messages)) return null
  for (let i = messages.length - 2; i >= 0; i -= 1) {
    const message = messages[i]
    if (message?.role !== 'assistant') continue
    if (messageToolUses(message).length > 0) return i
  }
  return null
}

function boundedRecoveryText(value: string): string {
  if (value.length <= SESSION_RECOVERY_TAIL_MAX_CHARS) return value
  const head = Math.floor(SESSION_RECOVERY_TAIL_MAX_CHARS / 2)
  return `${value.slice(0, head)}\n\n[recovery detail omitted]\n\n${value.slice(- (SESSION_RECOVERY_TAIL_MAX_CHARS - head))}`
}

function compactRecoveryTail(messages: readonly ConversationMessage[]): ConversationMessage[] {
  const bounded = messages.map(message => ({
    ...message,
    content: message.content.map(block => {
      if (block.type === 'tool_result') {
        return { ...block, content: boundedRecoveryText(block.content) }
      }
      if (block.type === 'tool_use') {
        const encoded = JSON.stringify(block.input)
        if (encoded.length <= SESSION_RECOVERY_TAIL_MAX_CHARS) return block
        return {
          ...block,
          input: {
            _guildhallRecoveryInput: 'tool input truncated for crash recovery',
            preview: boundedRecoveryText(encoded),
          },
        }
      }
      return block
    }),
  }))

  if (JSON.stringify(bounded).length <= SESSION_RECOVERY_TAIL_MAX_CHARS) return bounded

  // A pending tail is the only conversation detail allowed to survive a
  // restart, so its bound is global rather than per tool result. Preserve the
  // tool ids and names needed to resume, but make the payload itself a small
  // checkpoint pointer when several tools returned large output together.
  return bounded.map(message => ({
    ...message,
    content: message.content.map(block => {
      if (block.type === 'tool_result') {
        return {
          ...block,
          content: '[tool output omitted for bounded recovery; use the latest checkpoint and rerun the focused command]',
        }
      }
      if (block.type === 'tool_use') {
        return {
          ...block,
          input: {
            _guildhallRecoveryInput: 'tool input omitted for bounded recovery; use the latest checkpoint',
            tool: block.name,
          },
        }
      }
      if (block.type === 'text') {
        return { ...block, text: '[conversation detail omitted for bounded recovery; use the latest checkpoint]' }
      }
      return block
    }),
  }))
}

export function boundedSessionText(messages: readonly ConversationMessage[]): string {
  const source = messages
    .map(message => {
      const tools = messageToolUses(message).map(block => block.name)
      const text = messageText(message).trim()
      return [
        `[${message.role}]`,
        text,
        tools.length > 0 ? `tools: ${tools.join(', ')}` : '',
      ].filter(Boolean).join('\n')
    })
    .filter(Boolean)
    .join('\n\n')
  if (source.length <= SESSION_SUMMARY_MAX_CHARS * 2) return source
  return `${source.slice(0, SESSION_SUMMARY_MAX_CHARS)}\n\n[older session detail omitted]\n\n${source.slice(-SESSION_SUMMARY_MAX_CHARS)}`
}

export function compactSessionMessages(
  messages: readonly ConversationMessage[],
  summary?: string | null,
): ConversationMessage[] {
  const pendingStart = pendingContinuationStart(messages)
  if (sessionPayloadCharacterCount(messages) <= SESSION_COMPACTION_THRESHOLD && !summary) {
    return [...messages]
  }
  const prefix = pendingStart === null ? messages : messages.slice(0, pendingStart)
  const essential = (summary?.trim() || boundedSessionText(prefix.length > 0 ? prefix : messages)).slice(0, SESSION_SUMMARY_MAX_CHARS)
  const compacted: ConversationMessage[] = [{
    role: 'user',
    content: [{ type: 'text', text: `Essential session history:\n${essential}` }],
  }]
  if (pendingStart !== null) compacted.push(...compactRecoveryTail(messages.slice(pendingStart)))
  return compacted
}

export function saveSessionSnapshot(opts: SaveSessionOptions): string {
  const sessionDir = getProjectSessionDir(opts.cwd)
  const sid = opts.sessionId ?? randomBytes(6).toString('hex')
  const now = Date.now() / 1000

  const sanitized = sanitizeConversationMessages(opts.messages)
  const persistedMessages = compactSessionMessages(sanitized)
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
    // The prompt is runtime configuration, not conversation state. Persisting
    // it here duplicated tens of kilobytes across every agent snapshot. Keep
    // the field for legacy readers; new snapshots restore the caller's prompt.
    system_prompt: '',
    messages: persistedMessages,
    usage: opts.usage,
    tool_metadata: persistableToolMetadata(opts.toolMetadata),
    created_at: now,
    summary,
    message_count: persistedMessages.length,
  }
  const data = JSON.stringify(payload, null, 2) + '\n'

  const latestPath = join(sessionDir, 'latest.json')
  const sessionPath = join(sessionDir, `session-${sid}.json`)
  atomicWriteText(sessionPath, data)
  // latest.json is an alias, not another snapshot body. Keep the named file
  // as the sole recovery payload and retain a legacy reader for old aliases.
  const latest: LatestSessionPointer = { version: 1, session_id: sid }
  atomicWriteText(latestPath, `${JSON.stringify(latest)}\n`)

  return latestPath
}

/**
 * Remove completed raw conversation payloads from existing snapshots. This
 * deliberately rewrites in place rather than archiving the raw messages: the
 * session directory is a recovery cache, not a second transcript database.
 */
export function compactProjectSessionSnapshots(
  cwd: string,
  options: { dryRun?: boolean; activeTaskIds?: ReadonlySet<string> } = {},
): SessionSnapshotCompactionResult {
  const sessionDir = getProjectSessionDir(cwd)
  const dryRun = options.dryRun ?? true
  if (!existsSync(sessionDir)) {
    return {
      filesSeen: 0,
      filesCompacted: 0,
      pendingFilesPreserved: 0,
      bytesBefore: 0,
      bytesAfter: 0,
    }
  }
  const files = readdirSync(sessionDir).filter(name => name.endsWith('.json'))
  let filesCompacted = 0
  let pendingFilesPreserved = 0
  let bytesBefore = 0
  let bytesAfter = 0

  for (const name of files) {
    const file = join(sessionDir, name)
    let before = 0
    try {
      before = statSync(file).size
    } catch {
      continue
    }
    bytesBefore += before

    if (name === 'latest.json') {
      try {
        const latest = JSON.parse(readFileSync(file, 'utf8')) as Partial<LatestSessionPointer>
        if (latest.version === 1 && typeof latest.session_id === 'string' && latest.session_id.length > 0) {
          bytesAfter += before
          continue
        }
      } catch {
        // Let the legacy full-payload path below handle malformed aliases.
      }
    }

    let payload: Record<string, unknown>
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) continue
      payload = parsed as Record<string, unknown>
    } catch {
      continue
    }
    if (!Array.isArray(payload.messages)) {
      bytesAfter += before
      continue
    }
    const revived: ConversationMessage[] = []
    for (const raw of payload.messages) {
      const parsed = conversationMessageSchema.safeParse(raw)
      if (parsed.success) revived.push(parsed.data)
    }
    if (hasPendingContinuation(revived)) {
      const taskId = snapshotTaskId(payload)
      const keepPending = options.activeTaskIds === undefined
        || taskId === null
        || options.activeTaskIds.has(taskId)
      if (keepPending) {
        pendingFilesPreserved += 1
        const compactedPending = compactSessionMessages(revived)
        const clearSystemPrompt = typeof payload.system_prompt === 'string' && payload.system_prompt.length > 0
        if (JSON.stringify(compactedPending) === JSON.stringify(revived) && !clearSystemPrompt) {
          bytesAfter += before
          continue
        }
        const next = {
          ...payload,
          messages: compactedPending,
          system_prompt: '',
          message_count: compactedPending.length,
        }
        const data = `${JSON.stringify(next, null, 2)}\n`
        filesCompacted += 1
        bytesAfter += Buffer.byteLength(data)
        if (!dryRun) atomicWriteText(file, data)
        continue
      }
    }
    const clearSystemPrompt = typeof payload.system_prompt === 'string' && payload.system_prompt.length > 0
    if (sessionPayloadCharacterCount(revived) <= SESSION_COMPACTION_THRESHOLD && !clearSystemPrompt) {
      bytesAfter += before
      continue
    }

    const compacted = compactSessionMessages(revived)
    const next = {
      ...payload,
      messages: compacted,
      system_prompt: '',
      message_count: compacted.length,
    }
    const data = `${JSON.stringify(next, null, 2)}\n`
    filesCompacted += 1
    bytesAfter += Buffer.byteLength(data)
    if (!dryRun) atomicWriteText(file, data)
  }

  return {
    filesSeen: files.length,
    filesCompacted,
    pendingFilesPreserved,
    bytesBefore,
    bytesAfter,
  }
}

function snapshotTaskId(payload: Record<string, unknown>): string | null {
  const metadata = payload.tool_metadata
  if (metadata !== null && typeof metadata === 'object' && !Array.isArray(metadata)) {
    const explicit = (metadata as Record<string, unknown>).current_task_id
    if (typeof explicit === 'string' && explicit.trim().length > 0) return explicit.trim()
    const focus = (metadata as Record<string, unknown>).task_focus_state
    if (focus !== null && typeof focus === 'object' && !Array.isArray(focus)) {
      const goal = (focus as Record<string, unknown>).goal
      if (typeof goal === 'string') {
        const match = goal.match(/## Current Task:\s*([^\s*]+)/)
        if (match?.[1]) return match[1].trim()
      }
    }
  }
  return null
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
  const latestPath = join(getProjectSessionDir(cwd), 'latest.json')
  if (!existsSync(latestPath)) return null
  try {
    const parsed = JSON.parse(readFileSync(latestPath, 'utf8')) as Record<string, unknown>
    if (parsed.version === 1 && typeof parsed.session_id === 'string') {
      return loadSessionById(cwd, parsed.session_id)
    }
    return reviveSnapshot(parsed)
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
      if (data.version === 1 && typeof data.session_id === 'string') return sessions.slice(0, limit)
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
      const raw = JSON.parse(readFileSync(latest, 'utf8')) as Record<string, unknown>
      if (raw.version === 1 && typeof raw.session_id === 'string') {
        if (sessionId === 'latest' || raw.session_id === sessionId) {
          const namedLatest = join(sessionDir, `session-${raw.session_id}.json`)
          if (existsSync(namedLatest)) return reviveSnapshot(JSON.parse(readFileSync(namedLatest, 'utf8')))
        }
        return null
      }
      const data = reviveSnapshot(raw)
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
