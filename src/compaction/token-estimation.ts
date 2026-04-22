/**
 * Ported from:
 *   openharness/src/openharness/services/token_estimation.py
 *   openharness/src/openharness/services/compact/__init__.py:estimate_message_tokens
 * Upstream: https://github.com/HKUDS/OpenHarness (MIT)
 * Upstream SHA at port time: 559ba76f237db957a1a21453170df8500479dc7d
 *
 * Changes from upstream:
 *   - Faithful port of the char/4 + 4/3 padding heuristic; numbers match
 *     so estimates agree when snapshots are swapped between ports
 *   - `str(block.input)` → `JSON.stringify(input ?? {})`. Upstream uses
 *     Python's `str()` on a dict which produces a repr that differs from
 *     JSON; estimates are rough so exact parity isn't meaningful here
 */

import type { ConversationMessage } from '@guildhall/protocol'

export const TOKEN_ESTIMATION_PADDING = 4 / 3

export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.max(1, Math.floor((text.length + 3) / 4))
}

export function estimateMessageTokens(messages: ConversationMessage[]): number {
  let total = 0
  for (const msg of messages) {
    for (const block of msg.content) {
      if (block.type === 'text') total += estimateTokens(block.text)
      else if (block.type === 'tool_result') total += estimateTokens(String(block.content ?? ''))
      else if (block.type === 'tool_use') {
        total += estimateTokens(block.name)
        total += estimateTokens(JSON.stringify(block.input ?? {}))
      }
    }
  }
  return Math.floor(total * TOKEN_ESTIMATION_PADDING)
}
