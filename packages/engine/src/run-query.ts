/**
 * Ported from openharness/src/openharness/engine/query.py
 * Upstream: https://github.com/HKUDS/OpenHarness (MIT)
 * Upstream SHA at port time: 559ba76f237db957a1a21453170df8500479dc7d
 *
 * Changes from upstream:
 *   - Python `async def ... yield` (async generator) → TS `async function*`
 *   - `asyncio.gather(..., return_exceptions=True)` → `Promise.allSettled`
 *   - Upstream yields `(StreamEvent, UsageSnapshot | None)` tuples so the outer
 *     engine can fold usage into its cost tracker; we keep that shape as an
 *     object `{ event, usage }` for TS ergonomics.
 *   - The 300+ lines of `_remember_*` tool carryover helpers live in their
 *     own `tool-carryover.ts` module so this file stays focused on the loop.
 *     They are invoked from `executeToolCall` immediately after the tool
 *     runs and before the POST_TOOL_USE hook, matching upstream's order.
 *   - Auto-compaction (`auto_compact_if_needed`) is likewise deferred. The
 *     reactive-compact "prompt too long" branch is stubbed so the control
 *     flow is visible; when we port compaction it will drop into the stub.
 *   - Coordinator-context-message injection (upstream pops a synthetic user
 *     message after the model turn) is deferred — it belongs in the
 *     coordinator layer, not the raw loop.
 */

import type {
  ConversationMessage,
  ToolResultBlock,
  ToolUseBlock,
  UsageSnapshot,
} from '@guildhall/protocol'
import {
  emptyUsage,
  isEffectivelyEmpty,
  messageText,
  messageToolUses,
  type StreamEvent,
} from '@guildhall/protocol'

import type { ApiStreamEvent, SupportsStreamingMessages } from './client.js'
import { HookEvent, type HookExecutor } from './hooks.js'
import { PermissionChecker } from './permissions.js'
import { recordToolCarryover } from './tool-carryover.js'
import type { AnyTool, ToolExecutionContext, ToolRegistry } from './tools.js'

const REACTIVE_COMPACT_STATUS_MESSAGE =
  'Prompt too long; compacting conversation memory and retrying.'

const PROMPT_TOO_LONG_SIGNATURES = [
  'prompt too long',
  'context length',
  'maximum context',
  'context window',
  'too many tokens',
  'too large for the model',
  'maximum context length',
]

export type Compactor = (
  messages: ConversationMessage[],
  reason: 'prompt_too_long',
) => Promise<ConversationMessage[] | null>

export interface QueryContext {
  apiClient: SupportsStreamingMessages
  toolRegistry: ToolRegistry
  permissionChecker: PermissionChecker
  cwd: string
  model: string
  systemPrompt: string
  maxTokens: number
  contextWindowTokens?: number | null
  autoCompactThresholdTokens?: number | null
  permissionPrompt?: (toolName: string, reason: string) => Promise<boolean>
  askUserPrompt?: (question: string) => Promise<string>
  maxTurns?: number | null
  hookExecutor?: HookExecutor
  toolMetadata?: Record<string, unknown>
  /**
   * Optional reactive-compact callback. When the model stream fails with a
   * prompt-too-long error the loop calls this with the full current message
   * history; returning a shorter array replaces the in-memory history and
   * the next turn is retried. Returning null bails to the same error path
   * as the no-compactor case.
   */
  compactor?: Compactor
}

export interface RunQueryYield {
  event: StreamEvent
  usage: UsageSnapshot | null
}

export class MaxTurnsExceededError extends Error {
  constructor(public readonly maxTurns: number) {
    super(`Exceeded maximum turn limit (${maxTurns})`)
    this.name = 'MaxTurnsExceededError'
  }
}

function isPromptTooLong(err: unknown): boolean {
  const text = String((err as { message?: string } | null)?.message ?? err ?? '').toLowerCase()
  return PROMPT_TOO_LONG_SIGNATURES.some((needle) => text.includes(needle))
}

function isNetworkError(err: unknown): boolean {
  const text = String((err as { message?: string } | null)?.message ?? err ?? '').toLowerCase()
  return text.includes('connect') || text.includes('timeout') || text.includes('network')
}

/**
 * Run the conversation loop until the model stops requesting tools.
 *
 * Caller passes a mutable `messages` array — we append to it in place so the
 * outer QueryEngine can observe the final state. This matches upstream.
 */
export async function* runQuery(
  context: QueryContext,
  messages: ConversationMessage[],
): AsyncGenerator<RunQueryYield> {
  let turnCount = 0
  // Reactive-compact placeholder: this flag is kept here because the control
  // flow below references it. When compaction lands, `reactiveCompact` will
  // do the real work; for now, the branch yields an error and bails.
  let reactiveCompactAttempted = false

  while (context.maxTurns == null || turnCount < context.maxTurns) {
    turnCount += 1

    // TODO(compaction): auto-compact check before calling the model.

    let finalMessage: ConversationMessage | null = null
    let usage: UsageSnapshot = { ...emptyUsage }
    let streamError: unknown = null

    try {
      for await (const ev of context.apiClient.streamMessage({
        model: context.model,
        messages,
        system_prompt: context.systemPrompt,
        max_tokens: context.maxTokens,
        tools: context.toolRegistry.toApiSchema(),
      })) {
        const handled = handleApiEvent(ev)
        if (handled.kind === 'text_delta') {
          yield { event: { type: 'assistant_text_delta', text: handled.text }, usage: null }
        } else if (handled.kind === 'retry') {
          yield {
            event: {
              type: 'status',
              message: `Request failed; retrying in ${handled.delaySeconds.toFixed(1)}s (attempt ${
                handled.attempt + 1
              } of ${handled.maxAttempts}): ${handled.message}`,
            },
            usage: null,
          }
        } else if (handled.kind === 'complete') {
          finalMessage = handled.message
          usage = handled.usage
        }
      }
    } catch (err) {
      streamError = err
    }

    if (streamError !== null) {
      if (!reactiveCompactAttempted && isPromptTooLong(streamError)) {
        reactiveCompactAttempted = true
        yield { event: { type: 'status', message: REACTIVE_COMPACT_STATUS_MESSAGE }, usage: null }
        if (context.compactor != null) {
          const compacted = await context.compactor(messages, 'prompt_too_long')
          if (compacted !== null && compacted.length < messages.length) {
            messages.splice(0, messages.length, ...compacted)
            turnCount -= 1
            continue
          }
        }
        yield {
          event: {
            type: 'error',
            message:
              'Conversation exceeds the model context window and compaction could not reduce it further.',
            recoverable: false,
          },
          usage: null,
        }
        return
      }
      const message = (streamError as Error | null)?.message ?? String(streamError)
      yield {
        event: {
          type: 'error',
          message: isNetworkError(streamError)
            ? `Network error: ${message}. Check your internet connection and try again.`
            : `API error: ${message}`,
          recoverable: true,
        },
        usage: null,
      }
      return
    }

    if (finalMessage === null) {
      throw new Error('Model stream finished without a final message')
    }

    if (finalMessage.role === 'assistant' && isEffectivelyEmpty(finalMessage)) {
      yield {
        event: {
          type: 'error',
          message:
            'Model returned an empty assistant message. The turn was ignored to keep the session healthy.',
          recoverable: true,
        },
        usage,
      }
      return
    }

    messages.push(finalMessage)
    yield { event: { type: 'assistant_turn_complete', message: finalMessage, usage }, usage }

    const toolCalls = messageToolUses(finalMessage)
    if (toolCalls.length === 0) {
      if (context.hookExecutor != null) {
        await context.hookExecutor.execute(HookEvent.STOP, {
          event: HookEvent.STOP,
          stop_reason: 'tool_uses_empty',
        })
      }
      return
    }

    if (toolCalls.length === 1) {
      const tc = toolCalls[0]!
      yield {
        event: { type: 'tool_execution_started', tool_name: tc.name, tool_input: tc.input },
        usage: null,
      }
      const result = await executeToolCall(context, tc)
      yield {
        event: {
          type: 'tool_execution_completed',
          tool_name: tc.name,
          output: result.content,
          is_error: result.is_error,
        },
        usage: null,
      }
      messages.push({ role: 'user', content: [result] })
    } else {
      for (const tc of toolCalls) {
        yield {
          event: { type: 'tool_execution_started', tool_name: tc.name, tool_input: tc.input },
          usage: null,
        }
      }
      const results = await Promise.allSettled(toolCalls.map((tc) => executeToolCall(context, tc)))
      const toolResults: ToolResultBlock[] = []
      for (let i = 0; i < toolCalls.length; i++) {
        const tc = toolCalls[i]!
        const settled = results[i]!
        if (settled.status === 'fulfilled') {
          toolResults.push(settled.value)
        } else {
          const reason = settled.reason as Error
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tc.id,
            content: `Tool ${tc.name} failed: ${reason?.name ?? 'Error'}: ${reason?.message ?? String(reason)}`,
            is_error: true,
          })
        }
      }
      for (let i = 0; i < toolCalls.length; i++) {
        const tc = toolCalls[i]!
        const result = toolResults[i]!
        yield {
          event: {
            type: 'tool_execution_completed',
            tool_name: tc.name,
            output: result.content,
            is_error: result.is_error,
          },
          usage: null,
        }
      }
      messages.push({ role: 'user', content: toolResults })
    }
  }

  if (context.maxTurns != null) throw new MaxTurnsExceededError(context.maxTurns)
  throw new Error('Query loop exited without a max_turns limit or final response')
}

// -----------------------------------------------------------------------------
// API event normalization
// -----------------------------------------------------------------------------

type HandledEvent =
  | { kind: 'text_delta'; text: string }
  | { kind: 'retry'; message: string; attempt: number; maxAttempts: number; delaySeconds: number }
  | { kind: 'complete'; message: ConversationMessage; usage: UsageSnapshot }

function handleApiEvent(ev: ApiStreamEvent): HandledEvent {
  switch (ev.type) {
    case 'text_delta':
      return { kind: 'text_delta', text: ev.text }
    case 'retry':
      return {
        kind: 'retry',
        message: ev.message,
        attempt: ev.attempt,
        maxAttempts: ev.max_attempts,
        delaySeconds: ev.delay_seconds,
      }
    case 'message_complete':
      return { kind: 'complete', message: ev.message, usage: ev.usage }
  }
}

// -----------------------------------------------------------------------------
// Tool execution
// -----------------------------------------------------------------------------

async function executeToolCall(
  context: QueryContext,
  toolCall: ToolUseBlock,
): Promise<ToolResultBlock> {
  const { name: toolName, id: toolUseId, input: toolInput } = toolCall

  if (context.hookExecutor != null) {
    const pre = await context.hookExecutor.execute(HookEvent.PRE_TOOL_USE, {
      event: HookEvent.PRE_TOOL_USE,
      tool_name: toolName,
      tool_input: toolInput,
    })
    if (pre.blocked) {
      return {
        type: 'tool_result',
        tool_use_id: toolUseId,
        content: pre.reason ?? `pre_tool_use hook blocked ${toolName}`,
        is_error: true,
      }
    }
  }

  const tool: AnyTool | undefined = context.toolRegistry.get(toolName)
  if (!tool) {
    return {
      type: 'tool_result',
      tool_use_id: toolUseId,
      content: `Unknown tool: ${toolName}`,
      is_error: true,
    }
  }

  const parse = tool.inputSchema.safeParse(toolInput)
  if (!parse.success) {
    return {
      type: 'tool_result',
      tool_use_id: toolUseId,
      content: `Invalid input for ${toolName}: ${parse.error.message}`,
      is_error: true,
    }
  }

  const parsedInput = parse.data
  const filePath = resolvePermissionFilePath(context.cwd, toolInput, parsedInput)
  const command = extractPermissionCommand(toolInput, parsedInput)

  const decision = context.permissionChecker.evaluate(toolName, {
    isReadOnly: tool.isReadOnly(parsedInput),
    filePath,
    command,
  })

  if (!decision.allowed) {
    if (decision.requiresConfirmation && context.permissionPrompt != null) {
      if (context.hookExecutor != null) {
        await context.hookExecutor.execute(HookEvent.NOTIFICATION, {
          event: HookEvent.NOTIFICATION,
          notification_type: 'permission_prompt',
          tool_name: toolName,
          reason: decision.reason,
        })
      }
      const confirmed = await context.permissionPrompt(toolName, decision.reason)
      if (!confirmed) {
        return {
          type: 'tool_result',
          tool_use_id: toolUseId,
          content: decision.reason || `Permission denied for ${toolName}`,
          is_error: true,
        }
      }
    } else {
      return {
        type: 'tool_result',
        tool_use_id: toolUseId,
        content: decision.reason || `Permission denied for ${toolName}`,
        is_error: true,
      }
    }
  }

  const execContext: ToolExecutionContext = {
    cwd: context.cwd,
    metadata: {
      tool_registry: context.toolRegistry,
      ask_user_prompt: context.askUserPrompt,
      ...(context.toolMetadata ?? {}),
    },
    ...(context.hookExecutor != null ? { hookExecutor: context.hookExecutor } : {}),
  }

  const result = await tool.execute(parsedInput, execContext)

  const toolResult: ToolResultBlock = {
    type: 'tool_result',
    tool_use_id: toolUseId,
    content: result.output,
    is_error: result.is_error,
  }

  recordToolCarryover({
    toolMetadata: context.toolMetadata ?? null,
    toolName,
    toolInput,
    toolOutput: toolResult.content,
    toolResultMetadata: (result as { metadata?: Record<string, unknown> }).metadata ?? null,
    isError: toolResult.is_error,
    resolvedFilePath: filePath,
  })

  if (context.hookExecutor != null) {
    await context.hookExecutor.execute(HookEvent.POST_TOOL_USE, {
      event: HookEvent.POST_TOOL_USE,
      tool_name: toolName,
      tool_input: toolInput,
      tool_output: toolResult.content,
      tool_is_error: toolResult.is_error,
    })
  }

  return toolResult
}

function resolvePermissionFilePath(
  cwd: string,
  rawInput: Record<string, unknown>,
  parsedInput: unknown,
): string | null {
  for (const key of ['file_path', 'path', 'root']) {
    const value = rawInput[key]
    if (typeof value === 'string' && value.trim().length > 0) return absolutize(cwd, value)
  }
  if (parsedInput !== null && typeof parsedInput === 'object') {
    const rec = parsedInput as Record<string, unknown>
    for (const key of ['file_path', 'path', 'root']) {
      const value = rec[key]
      if (typeof value === 'string' && value.trim().length > 0) return absolutize(cwd, value)
    }
  }
  return null
}

function extractPermissionCommand(
  rawInput: Record<string, unknown>,
  parsedInput: unknown,
): string | null {
  const raw = rawInput.command
  if (typeof raw === 'string' && raw.trim().length > 0) return raw
  if (parsedInput !== null && typeof parsedInput === 'object') {
    const cmd = (parsedInput as Record<string, unknown>).command
    if (typeof cmd === 'string' && cmd.trim().length > 0) return cmd
  }
  return null
}

function absolutize(cwd: string, p: string): string {
  const expanded = p.startsWith('~/') ? (process.env.HOME ?? '') + p.slice(1) : p
  if (expanded.startsWith('/')) return expanded
  // Mirror Python's Path.resolve() behavior enough for permission matching:
  // just prepend cwd and collapse `.` / `..` segments.
  const joined = `${cwd.replace(/\/+$/, '')}/${expanded}`
  const parts: string[] = []
  for (const seg of joined.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  return '/' + parts.join('/')
}

// Unused-import suppressor for the ConversationMessage types we reference only in JSDoc.
// (keeps eslint/tsc from complaining if neither `messageText` nor these helpers are re-exported.)
void messageText
