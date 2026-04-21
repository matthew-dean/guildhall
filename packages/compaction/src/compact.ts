/**
 * Ported from openharness/src/openharness/services/compact/__init__.py
 * Upstream: https://github.com/HKUDS/OpenHarness (MIT)
 * Upstream SHA at port time: 559ba76f237db957a1a21453170df8500479dc7d
 *
 * Changes from upstream:
 *   - Microcompact / truncateHeadForPtlRetry live in microcompact.ts; this
 *     module covers the rest (thresholds, auto-compact, LLM full compaction,
 *     context collapse, session-memory compaction, attachment builders).
 *   - `CompactApiClient` is a minimal interface defined locally to avoid a
 *     cycle with @guildhall/engine. Any provider implementing the upstream
 *     `SupportsStreamingMessages` contract satisfies it.
 *   - Hook integration uses a minimal `CompactHookExecutor` shape so this
 *     module can stay free of an @guildhall/hooks dependency; engine callers
 *     can pass their real HookExecutor directly — the shape matches.
 *   - `uuid.uuid4().hex` → `crypto.randomUUID()` (no dashes)
 *   - asyncio.wait_for → Promise.race with a timer (AbortController inside)
 *   - `inspect.isawaitable` / duck-typing of async iterables is unnecessary
 *     in TS since we can type the contract precisely.
 *   - `_sanitize_metadata` drops Python-specific Path coercion; TS metadata
 *     is already JSON-safe at the call site.
 *   - Legacy helpers `summarize_messages` / `compact_messages` are not
 *     ported — nothing in Guildhall calls them.
 */

import {
  type ConversationMessage,
  type ContentBlock,
  type TextBlock,
  type ToolResultBlock,
  type ToolUseBlock,
  type CompactProgressEvent,
  type CompactProgressPhase,
  type CompactProgressTrigger,
  messageText,
  messageToolUses,
  userMessageFromText,
} from '@guildhall/protocol'

import {
  PTL_RETRY_MARKER,
  TIME_BASED_MC_CLEARED_MESSAGE,
  microcompactMessages,
  truncateHeadForPtlRetry,
} from './microcompact.js'
import { estimateMessageTokens, estimateTokens } from './token-estimation.js'

// ---------------------------------------------------------------------------
// Constants (parity with upstream)
// ---------------------------------------------------------------------------

export const AUTOCOMPACT_BUFFER_TOKENS = 13_000
export const MAX_OUTPUT_TOKENS_FOR_SUMMARY = 20_000
export const MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3
export const COMPACT_TIMEOUT_MS = 25_000
export const MAX_COMPACT_STREAMING_RETRIES = 2
export const MAX_PTL_RETRIES = 3
export const SESSION_MEMORY_KEEP_RECENT = 12
export const SESSION_MEMORY_MAX_LINES = 48
export const SESSION_MEMORY_MAX_CHARS = 4_000
export const CONTEXT_COLLAPSE_TEXT_CHAR_LIMIT = 2_400
export const CONTEXT_COLLAPSE_HEAD_CHARS = 900
export const CONTEXT_COLLAPSE_TAIL_CHARS = 500
export const MAX_COMPACT_ATTACHMENTS = 6
export const MAX_DISCOVERED_TOOLS = 12
export const DEFAULT_PRESERVE_RECENT = 6
export const DEFAULT_KEEP_RECENT = 5
export const ERROR_MESSAGE_INCOMPLETE_RESPONSE =
  'Compaction interrupted before a complete summary was returned.'
const DEFAULT_CONTEXT_WINDOW = 200_000

export type CompactTrigger = CompactProgressTrigger
export type CompactionKind = 'full' | 'session_memory'

// ---------------------------------------------------------------------------
// Types: api client, hooks, attachments, result
// ---------------------------------------------------------------------------

export interface CompactApiRequest {
  model: string
  messages: ConversationMessage[]
  system_prompt?: string
  max_tokens: number
  tools: Array<Record<string, unknown>>
}

export interface CompactApiTextDelta {
  type: 'text_delta'
  text: string
}

export interface CompactApiMessageComplete {
  type: 'message_complete'
  message: ConversationMessage
  usage: { input_tokens: number; output_tokens: number }
  stop_reason?: string | null
}

export type CompactApiStreamEvent =
  | CompactApiTextDelta
  | CompactApiMessageComplete
  | { type: 'retry'; message: string; attempt: number; max_attempts: number; delay_seconds: number }

export interface CompactApiClient {
  streamMessage(request: CompactApiRequest): AsyncIterable<CompactApiStreamEvent>
}

export interface CompactHookExecutor {
  execute(
    event: string,
    payload: Record<string, unknown>,
  ): Promise<{ blocked: boolean; reason?: string }>
}

export const COMPACT_HOOK_PRE = 'pre_compact'
export const COMPACT_HOOK_POST = 'post_compact'

export interface CompactAttachment {
  kind: string
  title: string
  body: string
  metadata: Record<string, unknown>
}

export interface CompactionResult {
  trigger: CompactTrigger
  compact_kind: CompactionKind
  boundary_marker: ConversationMessage
  summary_messages: ConversationMessage[]
  messages_to_keep: ConversationMessage[]
  attachments: CompactAttachment[]
  hook_results: CompactAttachment[]
  compact_metadata: Record<string, unknown>
}

export type CompactProgressCallback = (
  event: CompactProgressEvent,
) => Promise<void> | void

// ---------------------------------------------------------------------------
// Checkpoint / progress helpers
// ---------------------------------------------------------------------------

function sanitizeMetadata(value: unknown): unknown {
  if (value === null) return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }
  if (Array.isArray(value)) return value.map(sanitizeMetadata)
  if (value instanceof Set) return [...value].map(sanitizeMetadata)
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = sanitizeMetadata(v)
    return out
  }
  return String(value)
}

function recordCompactCheckpoint(
  carryover: Record<string, unknown> | null | undefined,
  args: {
    checkpoint: string
    trigger: CompactTrigger
    message_count: number
    token_count: number
    attempt?: number
    details?: Record<string, unknown>
  },
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    checkpoint: args.checkpoint,
    trigger: args.trigger,
    message_count: args.message_count,
    token_count: args.token_count,
  }
  if (args.attempt !== undefined) payload.attempt = args.attempt
  if (args.details) {
    const sanitized = sanitizeMetadata(args.details) as Record<string, unknown>
    Object.assign(payload, sanitized)
  }
  if (carryover && typeof carryover === 'object') {
    const existing = carryover.compact_checkpoints
    const list: unknown[] = Array.isArray(existing) ? existing : []
    list.push(payload)
    carryover.compact_checkpoints = list
    carryover.compact_last = payload
  }
  return payload
}

async function emitProgress(
  callback: CompactProgressCallback | undefined,
  args: {
    phase: CompactProgressPhase
    trigger: CompactTrigger
    message?: string
    attempt?: number
    checkpoint?: string
    metadata?: Record<string, unknown>
  },
): Promise<void> {
  if (!callback) return
  const event: CompactProgressEvent = {
    type: 'compact_progress',
    phase: args.phase,
    trigger: args.trigger,
    ...(args.message !== undefined ? { message: args.message } : {}),
    ...(args.attempt !== undefined ? { attempt: args.attempt } : {}),
    ...(args.checkpoint !== undefined ? { checkpoint: args.checkpoint } : {}),
    ...(args.metadata !== undefined
      ? { metadata: sanitizeMetadata(args.metadata) as Record<string, unknown> }
      : {}),
  }
  await callback(event)
}

function isPromptTooLongError(err: unknown): boolean {
  const text = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase()
  return [
    'prompt too long',
    'context length',
    'maximum context',
    'context window',
    'too many tokens',
    'too large for the model',
  ].some((needle) => text.includes(needle))
}

// ---------------------------------------------------------------------------
// Context window + threshold logic
// ---------------------------------------------------------------------------

export interface AutoCompactState {
  compacted: boolean
  turn_counter: number
  turn_id: string
  consecutive_failures: number
}

export function createAutoCompactState(): AutoCompactState {
  return { compacted: false, turn_counter: 0, turn_id: '', consecutive_failures: 0 }
}

export function getContextWindow(
  model: string,
  opts: { context_window_tokens?: number | null } = {},
): number {
  const override = opts.context_window_tokens
  if (override !== undefined && override !== null && override > 0) return Math.floor(override)
  const m = model.toLowerCase()
  if (m.includes('opus') || m.includes('sonnet') || m.includes('haiku')) return 200_000
  return DEFAULT_CONTEXT_WINDOW
}

export function getAutocompactThreshold(
  model: string,
  opts: {
    context_window_tokens?: number | null
    auto_compact_threshold_tokens?: number | null
  } = {},
): number {
  const override = opts.auto_compact_threshold_tokens
  if (override !== undefined && override !== null && override > 0) return Math.floor(override)
  const cw = getContextWindow(model, { context_window_tokens: opts.context_window_tokens ?? null })
  const reserved = Math.min(MAX_OUTPUT_TOKENS_FOR_SUMMARY, 20_000)
  const effective = cw - reserved
  return effective - AUTOCOMPACT_BUFFER_TOKENS
}

export function shouldAutocompact(
  messages: ConversationMessage[],
  model: string,
  state: AutoCompactState,
  opts: {
    context_window_tokens?: number | null
    auto_compact_threshold_tokens?: number | null
  } = {},
): boolean {
  if (state.consecutive_failures >= MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES) return false
  const tokens = estimateMessageTokens(messages)
  const threshold = getAutocompactThreshold(model, opts)
  return tokens >= threshold
}

// ---------------------------------------------------------------------------
// Context collapse
// ---------------------------------------------------------------------------

function collapseText(text: string): string {
  if (text.length <= CONTEXT_COLLAPSE_TEXT_CHAR_LIMIT) return text
  const omitted = text.length - CONTEXT_COLLAPSE_HEAD_CHARS - CONTEXT_COLLAPSE_TAIL_CHARS
  const head = text.slice(0, CONTEXT_COLLAPSE_HEAD_CHARS).trimEnd()
  const tail = text.slice(-CONTEXT_COLLAPSE_TAIL_CHARS).trimStart()
  return `${head}\n...[collapsed ${omitted} chars]...\n${tail}`
}

export function tryContextCollapse(
  messages: ConversationMessage[],
  opts: { preserveRecent: number },
): ConversationMessage[] | null {
  const { preserveRecent } = opts
  if (messages.length <= preserveRecent + 2) return null
  const older = messages.slice(0, -preserveRecent)
  const newer = messages.slice(-preserveRecent)
  let changed = false
  const collapsedOlder: ConversationMessage[] = []
  for (const msg of older) {
    const newBlocks: ContentBlock[] = []
    for (const block of msg.content) {
      if (block.type === 'text') {
        const collapsed = collapseText(block.text)
        if (collapsed !== block.text) changed = true
        newBlocks.push({ type: 'text', text: collapsed } as TextBlock)
      } else {
        newBlocks.push(block)
      }
    }
    collapsedOlder.push({ role: msg.role, content: newBlocks })
  }
  if (!changed) return null
  const result = [...collapsedOlder, ...newer]
  if (estimateMessageTokens(result) >= estimateMessageTokens(messages)) return null
  return result
}

// ---------------------------------------------------------------------------
// Attachment extraction + builders
// ---------------------------------------------------------------------------

function extractAttachmentPaths(messages: ConversationMessage[]): string[] {
  const found: string[] = []
  const seen = new Set<string>()
  const pathPattern = /path:\s*([^)\n]+)/g
  const attachmentPattern = /\[attachment:\s*([^\]]+)\]/g
  for (const msg of messages) {
    for (const block of msg.content) {
      if (block.type === 'image' && block.source_path) {
        const p = block.source_path
        if (!seen.has(p)) {
          seen.add(p)
          found.push(p)
        }
      } else if (block.type === 'text') {
        for (const match of block.text.matchAll(pathPattern)) {
          const p = match[1]!.trim()
          if (p && !seen.has(p)) {
            seen.add(p)
            found.push(p)
          }
        }
        for (const match of block.text.matchAll(attachmentPattern)) {
          const p = match[1]!.trim()
          if (p && !p.includes('download failed') && !seen.has(p)) {
            seen.add(p)
            found.push(p)
          }
        }
      }
      if (found.length >= MAX_COMPACT_ATTACHMENTS) return found
    }
  }
  return found
}

function extractDiscoveredTools(messages: ConversationMessage[]): string[] {
  const discovered: string[] = []
  const seen = new Set<string>()
  for (const msg of messages) {
    for (const tu of messageToolUses(msg)) {
      if (tu.name && !seen.has(tu.name)) {
        seen.add(tu.name)
        discovered.push(tu.name)
      }
      if (discovered.length >= MAX_DISCOVERED_TOOLS) return discovered
    }
  }
  return discovered
}

function createAttachment(
  kind: string,
  title: string,
  lines: string[],
  metadata: Record<string, unknown> = {},
): CompactAttachment | null {
  const filtered = lines.map((l) => l.trimEnd()).filter((l) => l && l.trim().length > 0)
  if (filtered.length === 0) return null
  return {
    kind,
    title,
    body: filtered.join('\n'),
    metadata: sanitizeMetadata(metadata) as Record<string, unknown>,
  }
}

function renderCompactAttachment(a: CompactAttachment): ConversationMessage {
  const header = `[Compact attachment: ${a.kind}] ${a.title}`.trim()
  const text = `${header}\n${a.body}`.trim()
  return userMessageFromText(text)
}

export function createCompactBoundaryMessage(
  metadata: Record<string, unknown>,
): ConversationMessage {
  const lines: string[] = [
    '[Compact boundary marker]',
    'Earlier conversation was compacted. Use the summary and preserved assets below as the continuity boundary.',
  ]
  const trigger = String(metadata.trigger ?? '').trim()
  const kind = String(metadata.compact_kind ?? '').trim()
  const preMsgs = metadata.pre_compact_message_count
  const preTokens = metadata.pre_compact_token_count
  const postMsgs = metadata.post_compact_message_count
  const postTokens = metadata.post_compact_token_count
  if (trigger) lines.push(`Trigger: ${trigger}`)
  if (kind) lines.push(`Compaction kind: ${kind}`)
  if (preMsgs !== undefined || preTokens !== undefined) {
    lines.push(
      `Pre-compact footprint: messages=${preMsgs ?? 'unknown'}, tokens=${preTokens ?? 'unknown'}`,
    )
  }
  if (postMsgs !== undefined || postTokens !== undefined) {
    lines.push(
      `Post-compact footprint: messages=${postMsgs ?? 'unknown'}, tokens=${postTokens ?? 'unknown'}`,
    )
  }
  const anchor = String(metadata.preserved_segment_anchor ?? '').trim()
  if (anchor) lines.push(`Preserved segment anchor: ${anchor}`)
  return userMessageFromText(lines.join('\n'))
}

export function buildPostCompactMessages(result: CompactionResult): ConversationMessage[] {
  const attachmentMsgs = result.attachments.map(renderCompactAttachment)
  const hookMsgs = result.hook_results.map(renderCompactAttachment)
  return [
    result.boundary_marker,
    ...result.summary_messages,
    ...result.messages_to_keep,
    ...attachmentMsgs,
    ...hookMsgs,
  ]
}

// ---- specific attachment builders ----

function createRecentAttachmentsAttachmentIfNeeded(paths: string[]): CompactAttachment | null {
  if (paths.length === 0) return null
  return createAttachment(
    'recent_attachments',
    'Recent local attachments',
    ['Keep these local attachment paths in working memory:', ...paths.map((p) => `- ${p}`)],
    { paths },
  )
}

interface ReadFileEntry {
  path?: string
  span?: string
  preview?: string
  timestamp?: number
}

export function createRecentFilesAttachment(
  readFileState: unknown,
): CompactAttachment | null {
  if (!Array.isArray(readFileState) || readFileState.length === 0) return null
  const normalized: ReadFileEntry[] = readFileState
    .filter(
      (e): e is Record<string, unknown> =>
        typeof e === 'object' && e !== null && typeof (e as { path?: unknown }).path === 'string',
    )
    .map((e) => ({
      path: String(e.path),
      span: e.span !== undefined ? String(e.span) : '',
      preview: e.preview !== undefined ? String(e.preview) : '',
      timestamp: typeof e.timestamp === 'number' ? e.timestamp : 0,
    }))
  normalized.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
  const lines: string[] = ['Recently read files that may still matter:']
  const entries: ReadFileEntry[] = []
  for (const entry of normalized.slice(0, 4)) {
    const path = (entry.path ?? '').trim()
    if (!path) continue
    const span = (entry.span ?? '').trim()
    const preview = (entry.preview ?? '').trim()
    let bullet = `- ${path}`
    if (span) bullet += ` (${span})`
    lines.push(bullet)
    if (preview) lines.push(`  Preview: ${preview}`)
    entries.push({
      path,
      span,
      preview,
      ...(entry.timestamp !== undefined ? { timestamp: entry.timestamp } : {}),
    })
  }
  return createAttachment('recent_files', 'Recently read files', lines, { entries })
}

export function createTaskFocusAttachment(
  metadata: Record<string, unknown>,
): CompactAttachment | null {
  const state = metadata.task_focus_state
  if (!state || typeof state !== 'object') return null
  const s = state as Record<string, unknown>
  const goal = String(s.goal ?? '').trim()
  const recentGoals = Array.isArray(s.recent_goals)
    ? s.recent_goals.map((g) => String(g).trim()).filter(Boolean)
    : []
  const activeArtifacts = Array.isArray(s.active_artifacts)
    ? s.active_artifacts.map((g) => String(g).trim()).filter(Boolean)
    : []
  const verifiedState = Array.isArray(s.verified_state)
    ? s.verified_state.map((g) => String(g).trim()).filter(Boolean)
    : []
  const nextStep = String(s.next_step ?? '').trim()
  if (!(goal || recentGoals.length || activeArtifacts.length || verifiedState.length || nextStep)) {
    return null
  }
  const lines: string[] = ['Current working focus to preserve across compaction:']
  if (goal) lines.push(`- Goal: ${goal}`)
  if (recentGoals.length) {
    lines.push('- Recent user goals that still matter:')
    for (const g of recentGoals.slice(-3)) lines.push(`  - ${g}`)
  }
  if (activeArtifacts.length) {
    lines.push('- Active artifacts in play:')
    for (const g of activeArtifacts.slice(-5)) lines.push(`  - ${g}`)
  }
  if (verifiedState.length) {
    lines.push('- Verified state already established:')
    for (const g of verifiedState.slice(-4)) lines.push(`  - ${g}`)
  }
  if (nextStep) lines.push(`- Suggested next step: ${nextStep}`)
  return createAttachment('task_focus', 'Current working focus', lines, {
    goal,
    recent_goals: recentGoals.slice(-3),
    active_artifacts: activeArtifacts.slice(-5),
    verified_state: verifiedState.slice(-4),
    next_step: nextStep,
  })
}

export function createRecentVerifiedWorkAttachment(
  verifiedWork: unknown,
): CompactAttachment | null {
  if (!Array.isArray(verifiedWork) || verifiedWork.length === 0) return null
  const entries = verifiedWork.slice(-8).map((e) => String(e).trim()).filter(Boolean)
  if (entries.length === 0) return null
  return createAttachment(
    'recent_verified_work',
    'Recently verified work',
    [
      'These steps or conclusions were explicitly verified before compaction:',
      ...entries.map((e) => `- ${e}`),
    ],
    { entries },
  )
}

export function createPlanAttachment(
  metadata: Record<string, unknown>,
): CompactAttachment | null {
  const permissionMode = String(metadata.permission_mode ?? '').trim().toLowerCase()
  if (permissionMode !== 'plan') return null
  const lines: string[] = [
    'Plan mode is still active for this session.',
    'Do not execute mutating tools until the user explicitly exits plan mode.',
  ]
  const planSummary = String(metadata.plan_summary ?? '').trim()
  if (planSummary) lines.push(`Current plan summary: ${planSummary}`)
  return createAttachment('plan', 'Plan mode context', lines, {
    permission_mode: permissionMode,
    plan_summary: planSummary,
  })
}

export function createInvokedSkillsAttachment(
  invokedSkills: unknown,
): CompactAttachment | null {
  if (!Array.isArray(invokedSkills) || invokedSkills.length === 0) return null
  const normalized = invokedSkills.slice(-8).map((s) => String(s).trim()).filter(Boolean)
  if (normalized.length === 0) return null
  return createAttachment(
    'invoked_skills',
    'Skills used earlier in the session',
    [
      'The following skills were invoked and may still shape the next step:',
      '- ' + normalized.join(', '),
    ],
    { skills: normalized },
  )
}

export function createAsyncAgentAttachment(
  asyncAgentState: unknown,
): CompactAttachment | null {
  if (!Array.isArray(asyncAgentState) || asyncAgentState.length === 0) return null
  const entries = asyncAgentState.slice(-6).map((e) => String(e).trim()).filter(Boolean)
  if (entries.length === 0) return null
  return createAttachment(
    'async_agents',
    'Async agent and background task state',
    ['Recent async-agent/background-task activity:', ...entries.map((e) => `- ${e}`)],
    { entries },
  )
}

export function createWorkLogAttachment(
  recentWorkLog: unknown,
): CompactAttachment | null {
  if (!Array.isArray(recentWorkLog) || recentWorkLog.length === 0) return null
  const entries = recentWorkLog.slice(-8).map((e) => String(e).trim()).filter(Boolean)
  if (entries.length === 0) return null
  return createAttachment(
    'recent_work_log',
    'Recent execution checkpoints',
    ['Recent work and verification steps taken in this session:', ...entries.map((e) => `- ${e}`)],
    { entries },
  )
}

function createHookAttachments(hookNote: string | null | undefined): CompactAttachment[] {
  if (!hookNote || !hookNote.trim()) return []
  const a = createAttachment('hook_results', 'Compact hook notes', [hookNote.trim()], {
    note: hookNote.trim(),
  })
  return a ? [a] : []
}

function buildCompactAttachments(
  messages: ConversationMessage[],
  metadata: Record<string, unknown> | null | undefined,
): CompactAttachment[] {
  const meta = metadata ?? {}
  const attachmentPaths = extractAttachmentPaths(messages)
  const builders = [
    createTaskFocusAttachment(meta),
    createRecentVerifiedWorkAttachment(meta.recent_verified_work),
    createRecentAttachmentsAttachmentIfNeeded(attachmentPaths),
    createRecentFilesAttachment(meta.read_file_state),
    createPlanAttachment(meta),
    createInvokedSkillsAttachment(meta.invoked_skills),
    createAsyncAgentAttachment(meta.async_agent_state),
    createWorkLogAttachment(meta.recent_work_log),
  ]
  return builders.filter((a): a is CompactAttachment => a !== null)
}

function finalizeCompactionResult(result: CompactionResult): CompactionResult {
  const messages = buildPostCompactMessages(result)
  if (result.compact_metadata.post_compact_message_count === undefined) {
    result.compact_metadata.post_compact_message_count = messages.length
  }
  if (result.compact_metadata.post_compact_token_count === undefined) {
    result.compact_metadata.post_compact_token_count = estimateMessageTokens(messages)
  }
  result.boundary_marker = createCompactBoundaryMessage(result.compact_metadata)
  return result
}

function metadataHasCheckpoint(
  metadata: Record<string, unknown> | null | undefined,
  checkpoint: string,
): boolean {
  if (!metadata) return false
  const checkpoints = metadata.compact_checkpoints
  if (!Array.isArray(checkpoints)) return false
  return checkpoints.some(
    (e) => typeof e === 'object' && e !== null && (e as { checkpoint?: unknown }).checkpoint === checkpoint,
  )
}

function buildPassthroughResult(
  messages: ConversationMessage[],
  args: { trigger: CompactTrigger; compactKind: CompactionKind; metadata?: Record<string, unknown> },
): CompactionResult {
  const compactMetadata: Record<string, unknown> = {
    trigger: args.trigger,
    compact_kind: args.compactKind,
    pre_compact_message_count: messages.length,
    pre_compact_token_count: estimateMessageTokens(messages),
    ...(sanitizeMetadata(args.metadata ?? {}) as Record<string, unknown>),
  }
  const result: CompactionResult = {
    trigger: args.trigger,
    compact_kind: args.compactKind,
    boundary_marker: createCompactBoundaryMessage(compactMetadata),
    summary_messages: [],
    messages_to_keep: [...messages],
    attachments: [],
    hook_results: [],
    compact_metadata: compactMetadata,
  }
  return finalizeCompactionResult(result)
}

// ---------------------------------------------------------------------------
// Session memory compaction (deterministic, cheap)
// ---------------------------------------------------------------------------

function summarizeMessageForMemory(msg: ConversationMessage): string {
  const text = messageText(msg).split(/\s+/).filter(Boolean).join(' ')
  if (text) return `${msg.role}: ${text.slice(0, 160)}`
  const toolUses = messageToolUses(msg).map((t) => t.name)
  if (toolUses.length) return `${msg.role}: tool calls -> ${toolUses.slice(0, 4).join(', ')}`
  if (msg.content.some((b) => b.type === 'tool_result')) {
    return `${msg.role}: tool results returned`
  }
  return `${msg.role}: [non-text content]`
}

function buildSessionMemoryMessage(
  messages: ConversationMessage[],
): ConversationMessage | null {
  const lines: string[] = []
  let totalChars = 0
  for (const msg of messages) {
    const line = summarizeMessageForMemory(msg)
    if (!line) continue
    const projected = totalChars + line.length + 1
    if (
      lines.length > 0 &&
      (lines.length >= SESSION_MEMORY_MAX_LINES || projected >= SESSION_MEMORY_MAX_CHARS)
    ) {
      lines.push('... earlier context condensed ...')
      break
    }
    lines.push(line)
    totalChars = projected
  }
  if (lines.length === 0) return null
  return userMessageFromText(
    'Session memory summary from earlier in this conversation:\n' + lines.join('\n'),
  )
}

export function trySessionMemoryCompaction(
  messages: ConversationMessage[],
  opts: {
    preserveRecent?: number
    trigger?: CompactTrigger
    metadata?: Record<string, unknown>
  } = {},
): CompactionResult | null {
  const preserveRecent = opts.preserveRecent ?? SESSION_MEMORY_KEEP_RECENT
  const trigger = opts.trigger ?? 'auto'
  if (messages.length <= preserveRecent + 4) return null
  const older = messages.slice(0, -preserveRecent)
  const newer = messages.slice(-preserveRecent)
  const summary = buildSessionMemoryMessage(older)
  if (summary === null) return null
  const provisional = [summary, ...newer]
  if (
    estimateMessageTokens(provisional) >= estimateMessageTokens(messages) &&
    provisional.length >= messages.length
  ) {
    return null
  }
  const compactMetadata: Record<string, unknown> = {
    trigger,
    compact_kind: 'session_memory',
    pre_compact_message_count: messages.length,
    pre_compact_token_count: estimateMessageTokens(messages),
    preserve_recent: preserveRecent,
    used_session_memory: true,
    pre_compact_discovered_tools: extractDiscoveredTools(older),
    attachments: extractAttachmentPaths(older),
  }
  const result: CompactionResult = {
    trigger,
    compact_kind: 'session_memory',
    boundary_marker: createCompactBoundaryMessage(compactMetadata),
    summary_messages: [summary],
    messages_to_keep: [...newer],
    attachments: buildCompactAttachments(older, opts.metadata),
    hook_results: [],
    compact_metadata: compactMetadata,
  }
  return finalizeCompactionResult(result)
}

// ---------------------------------------------------------------------------
// Summary prompt (for the LLM compact call)
// ---------------------------------------------------------------------------

const NO_TOOLS_PREAMBLE = `CRITICAL: Respond with TEXT ONLY. Do NOT call any tools.

- Do NOT use read_file, bash, grep, glob, edit_file, write_file, or ANY other tool.
- You already have all the context you need in the conversation above.
- Tool calls will be REJECTED and will waste your only turn — you will fail the task.
- Your entire response must be plain text: an <analysis> block followed by a <summary> block.

`

const BASE_COMPACT_PROMPT = `Your task is to create a detailed summary of the conversation so far. This summary will replace the earlier messages, so it must capture all important information.

First, draft your analysis inside <analysis> tags. Walk through the conversation chronologically and extract:
- Every user request and intent (explicit and implicit)
- The approach taken and technical decisions made
- Specific code, files, and configurations discussed (with paths and line numbers where available)
- All errors encountered and how they were fixed
- Any user feedback or corrections

Then, produce a structured summary inside <summary> tags with these sections:

1. **Primary Request and Intent**: All user requests in full detail, including nuances and constraints.
2. **Key Technical Concepts**: Technologies, frameworks, patterns, and conventions discussed.
3. **Files and Code Sections**: Every file examined or modified, with specific code snippets and line numbers.
4. **Errors and Fixes**: Every error encountered, its cause, and how it was resolved.
5. **Problem Solving**: Problems solved and approaches that worked vs. didn't work.
6. **All User Messages**: Non-tool-result user messages (preserve exact wording for context).
7. **Pending Tasks**: Explicitly requested work that hasn't been completed yet.
8. **Current Work**: Detailed description of the last task being worked on before compaction.
9. **Optional Next Step**: The single most logical next step, directly aligned with the user's recent request.
`

const NO_TOOLS_TRAILER = `
REMINDER: Do NOT call any tools. Respond with plain text only — an <analysis> block followed by a <summary> block. Tool calls will be rejected and you will fail the task.`

export function getCompactPrompt(customInstructions?: string | null): string {
  let prompt = NO_TOOLS_PREAMBLE + BASE_COMPACT_PROMPT
  if (customInstructions && customInstructions.trim()) {
    prompt += `\n\nAdditional Instructions:\n${customInstructions}`
  }
  prompt += NO_TOOLS_TRAILER
  return prompt
}

export function formatCompactSummary(rawSummary: string): string {
  let text = rawSummary.replace(/<analysis>[\s\S]*?<\/analysis>/g, '')
  const m = text.match(/<summary>([\s\S]*?)<\/summary>/)
  if (m) {
    text = text.replace(m[0], `Summary:\n${m[1]!.trim()}`)
  }
  text = text.replace(/\n\n+/g, '\n\n')
  return text.trim()
}

export function buildCompactSummaryMessage(
  summary: string,
  opts: { suppressFollowUp?: boolean; recentPreserved?: boolean } = {},
): string {
  const formatted = formatCompactSummary(summary)
  let text =
    'This session is being continued from a previous conversation that ran out of context. ' +
    'The summary below covers the earlier portion of the conversation.\n\n' +
    formatted
  if (opts.recentPreserved) text += '\n\nRecent messages are preserved verbatim.'
  if (opts.suppressFollowUp) {
    text +=
      '\nContinue the conversation from where it left off without asking the user any further questions. ' +
      'Resume directly — do not acknowledge the summary, do not recap what was happening, do not preface with ' +
      '"I\'ll continue" or similar. Pick up the last task as if the break never happened.'
  }
  return text
}

// ---------------------------------------------------------------------------
// Full LLM-driven compaction
// ---------------------------------------------------------------------------

async function collectSummary(
  apiClient: CompactApiClient,
  request: CompactApiRequest,
  timeoutMs: number,
): Promise<string> {
  let collected = ''
  const iterator = apiClient.streamMessage(request)
  let timer: NodeJS.Timeout | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Compaction timed out.')), timeoutMs)
  })
  try {
    for await (const event of await Promise.race([iterator, timeoutPromise])) {
      if (event.type === 'message_complete') collected = messageText(event.message)
    }
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
  if (!collected.trim()) throw new Error(ERROR_MESSAGE_INCOMPLETE_RESPONSE)
  return collected
}

export interface CompactConversationOptions {
  apiClient: CompactApiClient
  model: string
  systemPrompt?: string
  preserveRecent?: number
  customInstructions?: string | null
  suppressFollowUp?: boolean
  trigger?: CompactTrigger
  progressCallback?: CompactProgressCallback
  emitHooksStart?: boolean
  hookExecutor?: CompactHookExecutor
  carryoverMetadata?: Record<string, unknown>
  timeoutMs?: number
}

export async function compactConversation(
  messages: ConversationMessage[],
  options: CompactConversationOptions,
): Promise<CompactionResult> {
  const preserveRecent = options.preserveRecent ?? DEFAULT_PRESERVE_RECENT
  const trigger = options.trigger ?? 'manual'
  const emitHooksStart = options.emitHooksStart ?? true
  const suppressFollowUp = options.suppressFollowUp ?? true
  const timeoutMs = options.timeoutMs ?? COMPACT_TIMEOUT_MS
  const carryover = options.carryoverMetadata

  if (messages.length <= preserveRecent) {
    return buildPassthroughResult(messages, {
      trigger,
      compactKind: 'full',
      metadata: { reason: 'conversation already within preserve_recent window' },
    })
  }

  // Step 1: microcompact
  const microcompacted = microcompactMessages(messages, { keepRecent: DEFAULT_KEEP_RECENT })
  const preCompactTokens = estimateMessageTokens(microcompacted)

  // Step 2: split
  const older = microcompacted.slice(0, -preserveRecent)
  const newer = microcompacted.slice(-preserveRecent)

  // Step 3: build request + hook payload
  const compactPrompt = getCompactPrompt(options.customInstructions ?? null)
  const compactRequestMessages: ConversationMessage[] = [
    ...older,
    userMessageFromText(compactPrompt),
  ]
  const attachmentPaths = extractAttachmentPaths(older)
  const discoveredTools = extractDiscoveredTools(older)
  const hookPayload: Record<string, unknown> = {
    event: COMPACT_HOOK_PRE,
    trigger,
    model: options.model,
    message_count: microcompacted.length,
    token_count: preCompactTokens,
    preserve_recent: preserveRecent,
    attachments: attachmentPaths,
    discovered_tools: discoveredTools,
    ...(carryover ?? {}),
  }

  const startCheckpoint = recordCompactCheckpoint(carryover, {
    checkpoint: 'compact_prepare',
    trigger,
    message_count: microcompacted.length,
    token_count: preCompactTokens,
    details: {
      preserve_recent: preserveRecent,
      attachments: attachmentPaths,
      discovered_tools: discoveredTools,
    },
  })

  if (emitHooksStart) {
    await emitProgress(options.progressCallback, {
      phase: 'hooks_start',
      trigger,
      message: 'Preparing conversation compaction.',
      checkpoint: 'compact_hooks_start',
      metadata: startCheckpoint,
    })
  }

  if (options.hookExecutor) {
    const hookResult = await options.hookExecutor.execute(COMPACT_HOOK_PRE, hookPayload)
    if (hookResult.blocked) {
      const reason = hookResult.reason ?? 'pre-compact hook blocked compaction'
      const failed = recordCompactCheckpoint(carryover, {
        checkpoint: 'compact_failed',
        trigger,
        message_count: microcompacted.length,
        token_count: preCompactTokens,
        details: { reason },
      })
      await emitProgress(options.progressCallback, {
        phase: 'compact_failed',
        trigger,
        message: reason,
        checkpoint: 'compact_failed',
        metadata: failed,
      })
      return buildPassthroughResult(microcompacted, {
        trigger,
        compactKind: 'full',
        metadata: { reason },
      })
    }
  }

  const compactStartCheckpoint = recordCompactCheckpoint(carryover, {
    checkpoint: 'compact_start',
    trigger,
    message_count: microcompacted.length,
    token_count: preCompactTokens,
    details: { preserve_recent: preserveRecent },
  })
  await emitProgress(options.progressCallback, {
    phase: 'compact_start',
    trigger,
    message: 'Compacting conversation memory.',
    checkpoint: 'compact_start',
    metadata: compactStartCheckpoint,
  })

  let summaryText = ''
  let retryMessages = compactRequestMessages
  let ptlRetries = 0
  let attempt = 0
  const maxAttempts = MAX_COMPACT_STREAMING_RETRIES + 2
  let lastError: unknown = null

  for (attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      summaryText = await collectSummary(
        options.apiClient,
        {
          model: options.model,
          messages: retryMessages,
          system_prompt: options.systemPrompt || 'You are a conversation summarizer.',
          max_tokens: MAX_OUTPUT_TOKENS_FOR_SUMMARY,
          tools: [],
        },
        timeoutMs,
      )
      break
    } catch (err) {
      lastError = err
      if (isPromptTooLongError(err) && ptlRetries < MAX_PTL_RETRIES) {
        const head = retryMessages.slice(0, -1)
        const truncated = truncateHeadForPtlRetry(head)
        if (truncated && truncated.length > 0) {
          ptlRetries += 1
          retryMessages = [...truncated, retryMessages[retryMessages.length - 1]!]
          await emitProgress(options.progressCallback, {
            phase: 'compact_retry',
            trigger,
            message:
              'Compaction prompt was too large; retrying with older context trimmed.',
            attempt: ptlRetries,
            checkpoint: 'compact_retry_prompt_too_long',
            metadata: recordCompactCheckpoint(carryover, {
              checkpoint: 'compact_retry_prompt_too_long',
              trigger,
              message_count: retryMessages.length,
              token_count: estimateMessageTokens(retryMessages),
              attempt: ptlRetries,
              details: { ptl_retries: ptlRetries },
            }),
          })
          continue
        }
      }
      if (attempt > MAX_COMPACT_STREAMING_RETRIES) {
        await emitProgress(options.progressCallback, {
          phase: 'compact_failed',
          trigger,
          message: err instanceof Error ? err.message : String(err),
          attempt,
          checkpoint: 'compact_failed',
          metadata: recordCompactCheckpoint(carryover, {
            checkpoint: 'compact_failed',
            trigger,
            message_count: retryMessages.length,
            token_count: estimateMessageTokens(retryMessages),
            attempt,
            details: { reason: err instanceof Error ? err.message : String(err) },
          }),
        })
        throw err
      }
      await emitProgress(options.progressCallback, {
        phase: 'compact_retry',
        trigger,
        message: err instanceof Error ? err.message : String(err),
        attempt,
        checkpoint: 'compact_retry',
        metadata: recordCompactCheckpoint(carryover, {
          checkpoint: 'compact_retry',
          trigger,
          message_count: retryMessages.length,
          token_count: estimateMessageTokens(retryMessages),
          attempt,
          details: { reason: err instanceof Error ? err.message : String(err) },
        }),
      })
    }
  }

  if (!summaryText) {
    await emitProgress(options.progressCallback, {
      phase: 'compact_failed',
      trigger,
      message: ERROR_MESSAGE_INCOMPLETE_RESPONSE,
      checkpoint: 'compact_failed',
      metadata: recordCompactCheckpoint(carryover, {
        checkpoint: 'compact_failed',
        trigger,
        message_count: microcompacted.length,
        token_count: preCompactTokens,
        details: { reason: lastError ? String(lastError) : ERROR_MESSAGE_INCOMPLETE_RESPONSE },
      }),
    })
    return buildPassthroughResult(microcompacted, {
      trigger,
      compactKind: 'full',
      metadata: { reason: ERROR_MESSAGE_INCOMPLETE_RESPONSE },
    })
  }

  const summaryContent = buildCompactSummaryMessage(summaryText, {
    suppressFollowUp,
    recentPreserved: newer.length > 0,
  })
  const summaryMsg = userMessageFromText(summaryContent)
  const initialPostCompactTokens = estimateMessageTokens([summaryMsg, ...newer])

  let hookAttachments: CompactAttachment[] = []
  if (options.hookExecutor) {
    const postHookResult = await options.hookExecutor.execute(COMPACT_HOOK_POST, {
      event: COMPACT_HOOK_POST,
      trigger,
      model: options.model,
      pre_compact_message_count: microcompacted.length,
      post_compact_message_count: newer.length + 1,
      pre_compact_tokens: preCompactTokens,
      post_compact_tokens: initialPostCompactTokens,
      attachments: attachmentPaths,
      discovered_tools: discoveredTools,
      ...(carryover ?? {}),
    })
    hookAttachments = createHookAttachments(postHookResult.reason ?? null)
  }

  const compactMetadata: Record<string, unknown> = {
    trigger,
    compact_kind: 'full',
    pre_compact_message_count: microcompacted.length,
    pre_compact_token_count: preCompactTokens,
    preserve_recent: preserveRecent,
    pre_compact_discovered_tools: discoveredTools,
    used_head_truncation_retry: ptlRetries > 0,
    used_context_collapse: metadataHasCheckpoint(carryover, 'query_context_collapse_end'),
    used_session_memory: false,
    retry_attempts: Math.max(0, attempt - 1),
    attachments: attachmentPaths,
  }
  if (carryover) {
    const checkpoints = carryover.compact_checkpoints
    if (Array.isArray(checkpoints)) compactMetadata.compact_checkpoints = checkpoints
    const last = carryover.compact_last
    if (last && typeof last === 'object') compactMetadata.compact_last = last
  }

  let result: CompactionResult = {
    trigger,
    compact_kind: 'full',
    boundary_marker: createCompactBoundaryMessage(compactMetadata),
    summary_messages: [summaryMsg],
    messages_to_keep: [...newer],
    attachments: buildCompactAttachments(older, carryover ?? null),
    hook_results: hookAttachments,
    compact_metadata: compactMetadata,
  }
  result = finalizeCompactionResult(result)
  const postMessages = buildPostCompactMessages(result)
  const postTokens = estimateMessageTokens(postMessages)
  result.compact_metadata.post_compact_message_count = postMessages.length
  result.compact_metadata.post_compact_token_count = postTokens
  result.boundary_marker = createCompactBoundaryMessage(result.compact_metadata)

  await emitProgress(options.progressCallback, {
    phase: 'compact_end',
    trigger,
    message: 'Conversation compaction complete.',
    checkpoint: 'compact_end',
    metadata: recordCompactCheckpoint(carryover, {
      checkpoint: 'compact_end',
      trigger,
      message_count: postMessages.length,
      token_count: postTokens,
      details: {
        pre_compact_message_count: microcompacted.length,
        post_compact_message_count: postMessages.length,
        pre_compact_tokens: preCompactTokens,
        post_compact_tokens: postTokens,
        tokens_saved: preCompactTokens - postTokens,
        attachments: attachmentPaths,
        discovered_tools: discoveredTools,
      },
    }),
  })

  return result
}

// ---------------------------------------------------------------------------
// Auto-compact integration
// ---------------------------------------------------------------------------

export interface AutoCompactOptions {
  apiClient: CompactApiClient
  model: string
  systemPrompt?: string
  state: AutoCompactState
  preserveRecent?: number
  progressCallback?: CompactProgressCallback
  force?: boolean
  trigger?: CompactTrigger
  hookExecutor?: CompactHookExecutor
  carryoverMetadata?: Record<string, unknown>
  contextWindowTokens?: number | null
  autoCompactThresholdTokens?: number | null
  timeoutMs?: number
}

export async function autoCompactIfNeeded(
  messages: ConversationMessage[],
  options: AutoCompactOptions,
): Promise<{ messages: ConversationMessage[]; compacted: boolean }> {
  const trigger = options.trigger ?? 'auto'
  const preserveRecent = options.preserveRecent ?? DEFAULT_PRESERVE_RECENT
  const thresholdOpts = {
    context_window_tokens: options.contextWindowTokens ?? null,
    auto_compact_threshold_tokens: options.autoCompactThresholdTokens ?? null,
  }

  if (!options.force && !shouldAutocompact(messages, options.model, options.state, thresholdOpts)) {
    return { messages, compacted: false }
  }

  recordCompactCheckpoint(options.carryoverMetadata, {
    checkpoint: `query_${trigger}_triggered`,
    trigger,
    message_count: messages.length,
    token_count: estimateMessageTokens(messages),
    details: { consecutive_failures: options.state.consecutive_failures },
  })

  let current = microcompactMessages(messages, { keepRecent: DEFAULT_KEEP_RECENT })
  const beforeTokens = estimateMessageTokens(messages)
  const afterMicroTokens = estimateMessageTokens(current)
  const tokensFreed = beforeTokens - afterMicroTokens
  recordCompactCheckpoint(options.carryoverMetadata, {
    checkpoint: 'query_microcompact_end',
    trigger,
    message_count: current.length,
    token_count: afterMicroTokens,
    details: { tokens_freed: tokensFreed },
  })
  if (
    tokensFreed > 0 &&
    !shouldAutocompact(current, options.model, options.state, thresholdOpts)
  ) {
    return { messages: current, compacted: true }
  }

  const collapsed = tryContextCollapse(current, { preserveRecent })
  if (collapsed !== null) {
    await emitProgress(options.progressCallback, {
      phase: 'context_collapse_start',
      trigger,
      message: 'Collapsing oversized context before full compaction.',
      checkpoint: 'query_context_collapse_start',
      metadata: recordCompactCheckpoint(options.carryoverMetadata, {
        checkpoint: 'query_context_collapse_start',
        trigger,
        message_count: current.length,
        token_count: estimateMessageTokens(current),
      }),
    })
    current = collapsed
    await emitProgress(options.progressCallback, {
      phase: 'context_collapse_end',
      trigger,
      message: 'Context collapse complete.',
      checkpoint: 'query_context_collapse_end',
      metadata: recordCompactCheckpoint(options.carryoverMetadata, {
        checkpoint: 'query_context_collapse_end',
        trigger,
        message_count: current.length,
        token_count: estimateMessageTokens(current),
      }),
    })
    if (!options.force && !shouldAutocompact(current, options.model, options.state, thresholdOpts)) {
      return { messages: current, compacted: true }
    }
  }

  const sessionMemory = trySessionMemoryCompaction(current, {
    preserveRecent: Math.max(preserveRecent, SESSION_MEMORY_KEEP_RECENT),
    trigger,
    ...(options.carryoverMetadata ? { metadata: options.carryoverMetadata } : {}),
  })
  if (sessionMemory !== null) {
    await emitProgress(options.progressCallback, {
      phase: 'session_memory_start',
      trigger,
      message: 'Condensing earlier conversation into session memory.',
      checkpoint: 'query_session_memory_start',
      metadata: recordCompactCheckpoint(options.carryoverMetadata, {
        checkpoint: 'query_session_memory_start',
        trigger,
        message_count: current.length,
        token_count: estimateMessageTokens(current),
      }),
    })
    const postSession = buildPostCompactMessages(sessionMemory)
    await emitProgress(options.progressCallback, {
      phase: 'session_memory_end',
      trigger,
      message: 'Session memory condensation complete.',
      checkpoint: 'query_session_memory_end',
      metadata: recordCompactCheckpoint(options.carryoverMetadata, {
        checkpoint: 'query_session_memory_end',
        trigger,
        message_count: postSession.length,
        token_count: estimateMessageTokens(postSession),
      }),
    })
    options.state.compacted = true
    options.state.turn_counter += 1
    options.state.turn_id = crypto.randomUUID().replace(/-/g, '').slice(0, 12)
    options.state.consecutive_failures = 0
    return { messages: postSession, compacted: true }
  }

  try {
    const result = await compactConversation(current, {
      apiClient: options.apiClient,
      model: options.model,
      ...(options.systemPrompt !== undefined ? { systemPrompt: options.systemPrompt } : {}),
      preserveRecent,
      suppressFollowUp: true,
      trigger,
      ...(options.progressCallback ? { progressCallback: options.progressCallback } : {}),
      ...(options.hookExecutor ? { hookExecutor: options.hookExecutor } : {}),
      ...(options.carryoverMetadata ? { carryoverMetadata: options.carryoverMetadata } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    })
    options.state.compacted = true
    options.state.turn_counter += 1
    options.state.turn_id = crypto.randomUUID().replace(/-/g, '').slice(0, 12)
    options.state.consecutive_failures = 0
    return { messages: buildPostCompactMessages(result), compacted: true }
  } catch (err) {
    options.state.consecutive_failures += 1
    recordCompactCheckpoint(options.carryoverMetadata, {
      checkpoint: `query_${trigger}_failed`,
      trigger,
      message_count: current.length,
      token_count: estimateMessageTokens(current),
      details: {
        reason: err instanceof Error ? err.message : String(err),
        consecutive_failures: options.state.consecutive_failures,
      },
    })
    return { messages: current, compacted: false }
  }
}

// Re-export constants used by tests
export {
  PTL_RETRY_MARKER,
  TIME_BASED_MC_CLEARED_MESSAGE,
  microcompactMessages,
  truncateHeadForPtlRetry,
  estimateMessageTokens,
  estimateTokens,
}

// Typed guards for consumers who want to narrow content blocks by shape
export type CompactContent = ContentBlock | TextBlock | ToolResultBlock | ToolUseBlock
