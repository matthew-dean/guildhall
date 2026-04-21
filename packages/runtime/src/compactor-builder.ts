/**
 * FR-19: build a reactive `Compactor` from the `@guildhall/compaction` kit.
 *
 * The engine's `runQuery` loop calls this function when a model turn fails
 * with a prompt-too-long error. We drive `compactConversation` to produce a
 * shortened history and convert its `CompactionResult` back into a plain
 * `ConversationMessage[]` the engine can retry against.
 *
 * A single compactor can be shared across every agent in the orchestrator —
 * it carries no per-agent state and the history it receives is always the
 * calling engine's local buffer.
 */

import {
  buildPostCompactMessages,
  compactConversation,
} from '@guildhall/compaction'
import type { Compactor, SupportsStreamingMessages } from '@guildhall/engine'

export interface BuildCompactorOptions {
  apiClient: SupportsStreamingMessages
  /** Model to use for the summary completion. */
  model: string
  /**
   * How many recent messages to preserve verbatim. Defaults to the library
   * default (`DEFAULT_PRESERVE_RECENT`) when omitted.
   */
  preserveRecent?: number
  /** Optional custom instructions appended to the compact prompt. */
  customInstructions?: string | null
  /**
   * Upper bound on the compact call — compaction under an already-pressured
   * context is time-sensitive; hanging forever is worse than bailing.
   */
  timeoutMs?: number
}

export function buildDefaultCompactor(
  opts: BuildCompactorOptions,
): Compactor {
  return async (messages, reason) => {
    // The engine reports `prompt_too_long`; the compaction kit classifies the
    // same failure mode as `reactive`. Map it once here instead of leaking
    // vocabulary across the two packages.
    void reason
    const result = await compactConversation(messages, {
      apiClient: opts.apiClient,
      model: opts.model,
      trigger: 'reactive',
      ...(opts.preserveRecent !== undefined
        ? { preserveRecent: opts.preserveRecent }
        : {}),
      ...(opts.customInstructions !== undefined
        ? { customInstructions: opts.customInstructions }
        : {}),
      ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    })
    const next = buildPostCompactMessages(result)
    // If compaction didn't actually shrink the history, return null so the
    // engine falls through to the same error path as the no-compactor case
    // instead of looping on an unchanged buffer.
    if (next.length >= messages.length) return null
    return next
  }
}
