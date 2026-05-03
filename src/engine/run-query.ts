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
import { join } from 'node:path'
import {
  emptyUsage,
  isEffectivelyEmpty,
  messageText,
  messageToolUses,
  userMessageFromText,
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

function invalidToolInputMessage(toolName: string, error: { message: string; issues?: Array<{ path?: Array<string | number>; message?: string }> }): string {
  if (toolName === 'edit-file') {
    const missingOldString = error.issues?.some((issue) => issue.path?.includes('oldString')) ?? false
    if (missingOldString) {
      return 'Invalid input for edit-file: include filePath, oldString, and newString. oldString must be exact text copied from the current file. If you truly need to replace the whole file, use write-file instead.'
    }
  }
  if (toolName === 'log-progress') {
    return 'Invalid input for log-progress: use { entry: { timestamp, agentId, domain, taskId, summary, type } }. type must be one of heartbeat, milestone, blocked, escalation. summary is a short human-readable update.'
  }
  if (toolName === 'raise-escalation') {
    return 'Invalid input for raise-escalation: use { taskId, agentId, reason, summary, details? }. reason must be one of spec_ambiguous, max_revisions_exceeded, human_judgment_required, decision_required, gate_hard_failure, scope_boundary.'
  }
  if (toolName === 'write-checkpoint') {
    return 'Invalid input for write-checkpoint: use { taskId, agentId, intent, nextPlannedAction, filesTouched }. Guildhall fills tasksPath and memoryDir when needed.'
  }
  return `Invalid input for ${toolName}: ${error.message}`
}

const PROJECT_TASK_TOOLS = new Set([
  'read-tasks',
  'update-task',
  'add-task',
  'update-product-brief',
  'post-user-question',
  'raise-escalation',
  'resolve-escalation',
  'report-issue',
  'resolve-issue',
  'create-proposal',
  'reject-proposal',
  'write-checkpoint',
])

const PROJECT_PROGRESS_TOOLS = new Set([
  'log-progress',
  'raise-escalation',
  'resolve-escalation',
  'report-issue',
])

const PROJECT_MEMORY_TOOLS = new Set([
  'write-checkpoint',
])

function hydrateProjectToolInput(
  toolName: string,
  cwd: string,
  rawInput: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...rawInput }
  if (PROJECT_TASK_TOOLS.has(toolName)) {
    next.tasksPath = join(cwd, 'memory', 'TASKS.json')
  }
  if (PROJECT_PROGRESS_TOOLS.has(toolName)) {
    next.progressPath = join(cwd, 'memory', 'PROGRESS.md')
  }
  if (PROJECT_MEMORY_TOOLS.has(toolName)) {
    next.memoryDir = join(cwd, 'memory')
  }
  return next
}

export type Compactor = (
  messages: ConversationMessage[],
  reason: 'prompt_too_long' | 'auto',
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
  /**
   * Optional guard for roles that should not stop after an assistant turn that
   * only explains a plan. When set, a no-tool assistant response gets one or
   * more corrective user nudges and the loop continues instead of returning.
   */
  noToolTurnNudge?: string | undefined
  noToolTurnNudgeLimit?: number | undefined
  noProgressToolNames?: readonly string[] | undefined
  noProgressTurnNudge?: string | undefined
  noProgressTurnNudgeLimit?: number | undefined
  noProgressTurnThreshold?: number | undefined
  abortSignal?: AbortSignal | undefined
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

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError'
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
  let noToolTurnNudges = 0
  let noProgressTurnNudges = 0
  let noProgressToolTurns = 0
  let sawToolCall = false
  const repeatedToolCallCounts = new Map<string, number>()
  const progressToolNames = new Set(context.noProgressToolNames ?? [])

  while (context.maxTurns == null || turnCount < context.maxTurns) {
    turnCount += 1

    // Proactive auto-compact check before calling the model. Upstream
    // (query.py:519-523) creates a per-run AutoCompactState and calls
    // auto_compact_if_needed on every turn; the callback-shaped port here
    // delegates the threshold/state bookkeeping to whoever built the
    // compactor (see runtime/compactor-builder.ts). When the callback
    // returns a strictly shorter history we replace `messages` in place so
    // the next API call sees the compacted conversation.
    if (context.compactor != null) {
      const compacted = await context.compactor(messages, 'auto')
      if (compacted !== null && compacted.length < messages.length) {
        messages.splice(0, messages.length, ...compacted)
      }
    }

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
        ...(context.abortSignal ? { signal: context.abortSignal } : {}),
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
      if (context.abortSignal?.aborted || isAbortError(streamError)) {
        yield {
          event: {
            type: 'status',
            message: 'Stop requested; canceling the active model call.',
          },
          usage: null,
        }
        return
      }
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
    const assistantText = messageText(finalMessage).trim()
    if (context.toolMetadata && assistantText.length > 0) {
      context.toolMetadata['last_assistant_text'] = assistantText
    }
    yield { event: { type: 'assistant_turn_complete', message: finalMessage, usage }, usage }

    const toolCalls = messageToolUses(finalMessage)
    if (toolCalls.length === 0) {
      noProgressToolTurns = 0
      if (
        !sawToolCall &&
        context.noToolTurnNudge &&
        noToolTurnNudges < (context.noToolTurnNudgeLimit ?? 2)
      ) {
        noToolTurnNudges += 1
        messages.push(userMessageFromText(context.noToolTurnNudge))
        yield {
          event: {
            type: 'status',
            message: 'Assistant response had no tool call; asking it to take the next concrete step.',
          },
          usage: null,
        }
        continue
      }
      if (context.hookExecutor != null) {
        await context.hookExecutor.execute(HookEvent.STOP, {
          event: HookEvent.STOP,
          stop_reason: 'tool_uses_empty',
        })
      }
      return
    }
    sawToolCall = true
    const hadProgressToolCall =
      progressToolNames.size > 0 && toolCalls.some((tc) => progressToolNames.has(tc.name))
    if (hadProgressToolCall) {
      noProgressToolTurns = 0
    } else if (progressToolNames.size > 0) {
      noProgressToolTurns += 1
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
      const repeatedResultNudge = repeatedToolResultNudge(
        repeatedToolCallCounts,
        context.cwd,
        tc,
        result,
      )
      if (repeatedResultNudge) {
        messages.push(userMessageFromText(repeatedResultNudge))
        yield {
          event: {
            type: 'status',
            message: 'Repeated unproductive tool call detected; asking the agent to change approach.',
          },
          usage: null,
        }
      }
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
      const repeatedResultNudges = toolCalls
        .map((tc, i) => repeatedToolResultNudge(
          repeatedToolCallCounts,
          context.cwd,
          tc,
          toolResults[i]!,
        ))
        .filter((message): message is string => !!message)
      for (const message of repeatedResultNudges) {
        messages.push(userMessageFromText(message))
        yield {
          event: {
            type: 'status',
            message: 'Repeated unproductive tool call detected; asking the agent to change approach.',
          },
          usage: null,
        }
      }
    }

    if (
      progressToolNames.size > 0 &&
      !hadProgressToolCall &&
      context.noProgressTurnNudge &&
      noProgressToolTurns >= (context.noProgressTurnThreshold ?? 2) &&
      noProgressTurnNudges < (context.noProgressTurnNudgeLimit ?? 1)
    ) {
      noProgressTurnNudges += 1
      messages.push(userMessageFromText(context.noProgressTurnNudge))
      yield {
        event: {
          type: 'status',
          message:
            'Assistant kept researching without recording durable progress; asking it to write the brief, question, spec, or escalation now.',
        },
        usage: null,
      }
      continue
    }
  }

  if (context.maxTurns != null) throw new MaxTurnsExceededError(context.maxTurns)
  throw new Error('Query loop exited without a max_turns limit or final response')
}

function stableToolInput(input: Record<string, unknown>): string {
  return JSON.stringify(
    Object.keys(input)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = input[key]
        return acc
      }, {}),
  )
}

function repeatedToolResultNudge(
  repeatedToolCallCounts: Map<string, number>,
  cwd: string,
  toolCall: ToolUseBlock,
  result: ToolResultBlock,
): string | null {
  const hydratedInput = hydrateProjectToolInput(toolCall.name, cwd, toolCall.input)
  const signature = `${toolCall.name}:${stableToolInput(hydratedInput)}`
  const unproductive = result.is_error || /^\s*\(no matches\)\s*$/i.test(result.content)
  if (!unproductive) {
    repeatedToolCallCounts.delete(signature)
    return null
  }
  const count = (repeatedToolCallCounts.get(signature) ?? 0) + 1
  repeatedToolCallCounts.set(signature, count)
  if (count < 2) return null
  const outcome = result.is_error ? 'failed' : 'returned no useful result'
  return [
    `The ${toolCall.name} tool just ${outcome} ${count} times with the same input.`,
    'Do not repeat that exact tool call again.',
    'Use a different diagnostic, read/list/search the relevant files first, or raise an escalation if you are blocked.',
  ].join(' ')
}

function isMemoryTaskPath(path: string): boolean {
  return /(?:^|\/)memory\/TASKS\.json$/.test(path)
}

interface ReviewHandoffEvidence {
  taskId: string
  inspectedImplementationFile: boolean
  changedOrVerified: boolean
}

function isReadToolName(name: string): boolean {
  return name === 'read_file' || name === 'Read' || name === 'ReadFile' || name === 'read-file'
}

function isBashToolName(name: string): boolean {
  return name === 'bash' || name === 'Bash' || name === 'shell'
}

function isWriteToolName(name: string): boolean {
  return name === 'write-file' || name === 'Write'
}

function isEditToolName(name: string): boolean {
  return name === 'edit-file' || name === 'Edit'
}

function reviewHandoffEvidence(
  toolMetadata: Record<string, unknown> | undefined,
): ReviewHandoffEvidence | null {
  const raw = toolMetadata?.['review_handoff_evidence']
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const rec = raw as Record<string, unknown>
  const taskId = String(rec['taskId'] ?? '').trim()
  if (!taskId) return null
  return {
    taskId,
    inspectedImplementationFile: rec['inspectedImplementationFile'] === true,
    changedOrVerified: rec['changedOrVerified'] === true,
  }
}

function setReviewHandoffEvidence(
  toolMetadata: Record<string, unknown> | undefined,
  evidence: ReviewHandoffEvidence,
): void {
  if (!toolMetadata) return
  toolMetadata['review_handoff_evidence'] = evidence
}

function activeReviewTaskId(toolMetadata: Record<string, unknown> | undefined): string {
  return String(
    toolMetadata?.['active_review_handoff_task_id'] ??
    toolMetadata?.['current_task_id'] ??
    '',
  ).trim()
}

function resetReviewHandoffEvidence(
  toolMetadata: Record<string, unknown> | undefined,
  taskId: string,
): void {
  if (!toolMetadata || !taskId) return
  toolMetadata['active_review_handoff_task_id'] = taskId
  toolMetadata['current_task_id'] = taskId
  setReviewHandoffEvidence(toolMetadata, {
    taskId,
    inspectedImplementationFile: false,
    changedOrVerified: false,
  })
}

function recordReviewHandoffEvidence(
  toolMetadata: Record<string, unknown> | undefined,
  toolName: string,
  filePath: string | null,
): void {
  const taskId = activeReviewTaskId(toolMetadata)
  if (!toolMetadata || !taskId) return
  const current = reviewHandoffEvidence(toolMetadata)
  const evidence: ReviewHandoffEvidence = current?.taskId === taskId
    ? current
    : { taskId, inspectedImplementationFile: false, changedOrVerified: false }

  if (isReadToolName(toolName) && filePath && !isMemoryTaskPath(filePath)) {
    evidence.inspectedImplementationFile = true
  }
  if (isBashToolName(toolName) || isWriteToolName(toolName) || isEditToolName(toolName)) {
    evidence.changedOrVerified = true
  }

  setReviewHandoffEvidence(toolMetadata, evidence)
}

function taskIdForReviewHandoff(
  input: Record<string, unknown>,
  toolMetadata: Record<string, unknown> | undefined,
): string {
  return String(input['taskId'] ?? activeReviewTaskId(toolMetadata)).trim()
}

function hasReviewHandoffEvidence(
  toolMetadata: Record<string, unknown> | undefined,
  taskId: string,
): boolean {
  const evidence = reviewHandoffEvidence(toolMetadata)
  return evidence?.taskId === taskId &&
    evidence.inspectedImplementationFile &&
    evidence.changedOrVerified
}

function reviewHandoffGuardResult(
  toolUseId: string,
  toolName: string,
  input: Record<string, unknown>,
  toolMetadata: Record<string, unknown> | undefined,
): ToolResultBlock | null {
  if (toolName !== 'update-task' || input['status'] !== 'review') return null
  const taskId = taskIdForReviewHandoff(input, toolMetadata)
  if (taskId && hasReviewHandoffEvidence(toolMetadata, taskId)) return null
  return {
    type: 'tool_result',
    tool_use_id: toolUseId,
    content:
      'Blocked transition to review: inspect the implementation source/test files and run or change something concrete before handoff. Do not self-critique or move to review from task metadata alone.',
    is_error: true,
  }
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
  const { name: toolName, id: toolUseId, input: rawToolInput } = toolCall
  const toolInput = hydrateProjectToolInput(toolName, context.cwd, rawToolInput)
  const guarded = reviewHandoffGuardResult(
    toolUseId,
    toolName,
    toolInput,
    context.toolMetadata,
  )
  if (guarded) return guarded

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
      content: invalidToolInputMessage(toolName, parse.error),
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

  const resultMetadata = (result as { metadata?: Record<string, unknown> }).metadata ?? null
  if (!toolResult.is_error && toolName === 'update-task' && toolInput['status'] === 'in_progress') {
    const taskId = String(resultMetadata?.['taskId'] ?? toolInput['taskId'] ?? '').trim()
    const currentTaskId = activeReviewTaskId(context.toolMetadata)
    const currentEvidence = reviewHandoffEvidence(context.toolMetadata)
    const shouldReset =
      taskId.length > 0 &&
      (
        currentTaskId !== taskId ||
        currentEvidence?.taskId !== taskId ||
        (currentEvidence.inspectedImplementationFile !== true &&
          currentEvidence.changedOrVerified !== true)
      )
    if (shouldReset) resetReviewHandoffEvidence(context.toolMetadata, taskId)
  } else if (!toolResult.is_error) {
    recordReviewHandoffEvidence(context.toolMetadata, toolName, filePath)
  }

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
  for (const key of ['filePath', 'file_path', 'path', 'root']) {
    const value = rawInput[key]
    if (typeof value === 'string' && value.trim().length > 0) return absolutize(cwd, value)
  }
  if (parsedInput !== null && typeof parsedInput === 'object') {
    const rec = parsedInput as Record<string, unknown>
    for (const key of ['filePath', 'file_path', 'path', 'root']) {
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
