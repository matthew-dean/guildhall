/**
 * Ported from the microcompact helpers in
 *   openharness/src/openharness/services/compact/__init__.py
 * Upstream: https://github.com/HKUDS/OpenHarness (MIT)
 * Upstream SHA at port time: 559ba76f237db957a1a21453170df8500479dc7d
 *
 * Changes from upstream:
 *   - Port only the deterministic content-clearing path (upstream's
 *     `microcompact`). The LLM-summarizing `full_compact` is not ported
 *     yet; when it lands it will live alongside this in @guildhall/compaction
 *   - `COMPACTABLE_TOOLS` matches upstream verbatim
 *   - Signature takes a plain ConversationMessage array so run-query can
 *     call it without threading attachment/hook state
 */

import {
  type ContentBlock,
  type ConversationMessage,
  messageText,
} from '@guildhall/protocol'

export const TIME_BASED_MC_CLEARED_MESSAGE = '[Old tool result content cleared]'

export const COMPACTABLE_TOOLS: ReadonlySet<string> = new Set([
  'read_file',
  'bash',
  'grep',
  'glob',
  'web_search',
  'web_fetch',
  'edit_file',
  'write_file',
])

export const PTL_RETRY_MARKER = '[earlier conversation truncated for compaction retry]'

export interface MicrocompactOptions {
  keepRecent?: number
}

/**
 * Clear tool_result content for older tool calls of known-heavy tools,
 * preserving the most recent `keepRecent` messages untouched.
 */
export function microcompactMessages(
  messages: ConversationMessage[],
  opts: MicrocompactOptions = {},
): ConversationMessage[] {
  const keepRecent = opts.keepRecent ?? 5
  if (messages.length <= keepRecent + 1) return messages

  const cutoff = messages.length - keepRecent
  const toolNamesById = collectCompactableToolUses(messages)
  const out: ConversationMessage[] = []
  for (let i = 0; i < messages.length; i += 1) {
    const msg = messages[i]!
    if (i >= cutoff) {
      out.push(msg)
      continue
    }
    const rewritten = rewriteToolResults(msg, toolNamesById)
    out.push(rewritten)
  }
  return out
}

function collectCompactableToolUses(messages: ConversationMessage[]): Map<string, string> {
  const byId = new Map<string, string>()
  for (const msg of messages) {
    for (const block of msg.content) {
      if (block.type === 'tool_use' && COMPACTABLE_TOOLS.has(block.name)) {
        byId.set(block.id, block.name)
      }
    }
  }
  return byId
}

function rewriteToolResults(
  msg: ConversationMessage,
  compactableById: Map<string, string>,
): ConversationMessage {
  let changed = false
  const newContent: ContentBlock[] = []
  for (const block of msg.content) {
    if (block.type === 'tool_result' && compactableById.has(block.tool_use_id)) {
      changed = true
      newContent.push({ ...block, content: TIME_BASED_MC_CLEARED_MESSAGE })
    } else {
      newContent.push(block)
    }
  }
  if (!changed) return msg
  return { ...msg, content: newContent }
}

/**
 * Drop the oldest prompt rounds when the message list is still too large
 * after microcompaction — used as a last-resort fallback before we have
 * real LLM-driven summarization.
 */
export function truncateHeadForPtlRetry(
  messages: ConversationMessage[],
): ConversationMessage[] | null {
  const groups = groupMessagesByPromptRound(messages)
  if (groups.length < 2) return null

  let dropCount = Math.max(1, Math.floor(groups.length / 5))
  dropCount = Math.min(dropCount, groups.length - 1)
  const retained = groups.slice(dropCount).flat()
  if (retained.length === 0) return null
  if (retained[0]?.role === 'assistant') {
    const marker: ConversationMessage = {
      role: 'user',
      content: [{ type: 'text', text: PTL_RETRY_MARKER }],
    }
    return [marker, ...retained]
  }
  return retained
}

function groupMessagesByPromptRound(
  messages: ConversationMessage[],
): ConversationMessage[][] {
  const groups: ConversationMessage[][] = []
  let current: ConversationMessage[] = []
  for (const msg of messages) {
    const hasToolResult = msg.content.some((b) => b.type === 'tool_result')
    const startsNewRound =
      msg.role === 'user' && !hasToolResult && messageText(msg).trim().length > 0
    if (startsNewRound && current.length > 0) {
      groups.push(current)
      current = []
    }
    current.push(msg)
  }
  if (current.length > 0) groups.push(current)
  return groups
}
