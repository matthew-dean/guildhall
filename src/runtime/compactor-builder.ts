/**
 * FR-19: build a `Compactor` from the `@guildhall/compaction` kit.
 *
 * The engine's `runQuery` loop calls this function in two places:
 *   - **Proactively**, with `reason='auto'`, before each model turn. We dispatch
 *     to `autoCompactIfNeeded`, which checks the context-window threshold and
 *     only compacts when the conversation has grown large enough to justify it.
 *   - **Reactively**, with `reason='prompt_too_long'`, after a turn fails with
 *     a context-window error. We force a full `compactConversation` summary so
 *     the engine can retry on a shortened history instead of surfacing the
 *     failure.
 *
 * A single compactor can be shared across every agent in the orchestrator —
 * the closure owns its own `AutoCompactState` so the consecutive-failures
 * counter persists across calls and prevents thrashing.
 *
 * Upstream parity: openharness/src/openharness/engine/query.py:472-523 creates
 * `AutoCompactState()` per `stream_run_query` call and invokes
 * `auto_compact_if_needed` directly. Our callback port gives the same behavior
 * at a slightly broader scope (one state per compactor instance instead of per
 * run), which is strictly safer.
 */

import {
  autoCompactIfNeeded,
  buildPostCompactMessages,
  compactConversation,
  createAutoCompactState,
  type AutoCompactState,
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
  /**
   * Explicit context-window override. Only relevant for the proactive
   * (`reason='auto'`) path: the threshold calculation defaults to a
   * model-specific limit but callers that talk to non-standard models can
   * pin the budget here.
   */
  contextWindowTokens?: number | null
  /**
   * Explicit proactive-compact threshold. When omitted, the library derives it
   * from `contextWindowTokens` using `AUTOCOMPACT_BUFFER_TOKENS`.
   */
  autoCompactThresholdTokens?: number | null
}

export function buildDefaultCompactor(
  opts: BuildCompactorOptions,
): Compactor {
  const state: AutoCompactState = createAutoCompactState()
  return async (messages, reason) => {
    if (reason === 'auto') {
      const { messages: next, compacted } = await autoCompactIfNeeded(messages, {
        apiClient: opts.apiClient,
        model: opts.model,
        state,
        trigger: 'auto',
        ...(opts.preserveRecent !== undefined
          ? { preserveRecent: opts.preserveRecent }
          : {}),
        ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
        ...(opts.contextWindowTokens !== undefined
          ? { contextWindowTokens: opts.contextWindowTokens }
          : {}),
        ...(opts.autoCompactThresholdTokens !== undefined
          ? { autoCompactThresholdTokens: opts.autoCompactThresholdTokens }
          : {}),
      })
      if (!compacted || next.length >= messages.length) return null
      return next
    }

    // Reactive path: the engine reports `prompt_too_long`; the compaction kit
    // classifies the same failure mode as `reactive`. Force a full summary so
    // the retry has headroom.
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
