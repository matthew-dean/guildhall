/**
 * Ported from openharness/src/openharness/hooks/events.py and the
 * HookExecutor contract used across the engine.
 * Upstream: https://github.com/HKUDS/OpenHarness (MIT)
 * Upstream SHA at port time: 559ba76f237db957a1a21453170df8500479dc7d
 *
 * Changes from upstream:
 *   - Python `Enum` → TS enum
 *   - Full hook executor implementation (subprocess / HTTP / sub-agent fanout)
 *     lives in @guildhall/hooks; this file only defines the contract the engine
 *     depends on
 */

export enum HookEvent {
  SESSION_START = 'session_start',
  SESSION_END = 'session_end',
  PRE_COMPACT = 'pre_compact',
  POST_COMPACT = 'post_compact',
  PRE_TOOL_USE = 'pre_tool_use',
  POST_TOOL_USE = 'post_tool_use',
  USER_PROMPT_SUBMIT = 'user_prompt_submit',
  NOTIFICATION = 'notification',
  STOP = 'stop',
  SUBAGENT_STOP = 'subagent_stop',
}

export interface HookPayload {
  event: string
  [key: string]: unknown
}

export interface HookExecutionResult {
  blocked: boolean
  reason?: string
}

export interface HookExecutor {
  execute(event: HookEvent, payload: HookPayload): Promise<HookExecutionResult>
}

export const noopHookExecutor: HookExecutor = {
  async execute() {
    return { blocked: false }
  },
}
