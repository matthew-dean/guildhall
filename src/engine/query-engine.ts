/**
 * Ported from openharness/src/openharness/engine/query_engine.py
 * Upstream: https://github.com/HKUDS/OpenHarness (MIT)
 * Upstream SHA at port time: 559ba76f237db957a1a21453170df8500479dc7d
 *
 * Changes from upstream:
 *   - Python getters/setters → plain public methods on the class
 *   - Cost tracker (UsageSnapshot accumulator) is inlined here as a small
 *     addUsage helper; upstream's full `CostTracker` with per-model cost
 *     tables is deferred.
 *   - Coordinator-context synthetic message injection is deferred to the
 *     coordinator package; see run-query.ts.
 *   - `async def ... yield` wrapping run_query → TS async generator that
 *     awaits each yielded RunQueryYield.
 */

import {
  type ConversationMessage,
  type UsageSnapshot,
  type StreamEvent,
  type ToolResultBlock,
  emptyUsage,
  messageText,
  messageToolUses,
  userMessageFromText,
} from '@guildhall/protocol'

import type { SupportsStreamingMessages } from './client.js'
import type { HookExecutor } from './hooks.js'
import { HookEvent } from './hooks.js'
import {
  PermissionChecker,
  PermissionMode,
  defaultPermissionSettings,
} from './permissions.js'
import { runQuery, type Compactor, type QueryContext } from './run-query.js'
import { rememberUserGoal } from './tool-carryover.js'
import type { ToolRegistry } from './tools.js'

export interface QueryEngineOptions {
  apiClient: SupportsStreamingMessages
  toolRegistry: ToolRegistry
  permissionChecker: PermissionChecker
  cwd: string
  model: string
  systemPrompt: string
  maxTokens?: number
  contextWindowTokens?: number | null
  autoCompactThresholdTokens?: number | null
  maxTurns?: number | null
  permissionPrompt?: (toolName: string, reason: string) => Promise<boolean>
  askUserPrompt?: (question: string) => Promise<string>
  hookExecutor?: HookExecutor
  toolMetadata?: Record<string, unknown>
  /**
   * Reactive compaction callback. Called when a turn fails with a
   * prompt-too-long error — returning a shortened message history lets the
   * loop retry the turn instead of bubbling the failure to the caller.
   */
  compactor?: Compactor
}

export class QueryEngine {
  private apiClient: SupportsStreamingMessages
  private toolRegistry: ToolRegistry
  private permissionChecker: PermissionChecker
  private readonly cwd: string
  private model: string
  private systemPrompt: string
  private readonly maxTokens: number
  private readonly contextWindowTokens: number | null | undefined
  private readonly autoCompactThresholdTokens: number | null | undefined
  private maxTurns: number | null
  private readonly permissionPrompt: QueryEngineOptions['permissionPrompt']
  private readonly askUserPrompt: QueryEngineOptions['askUserPrompt']
  private readonly hookExecutor: HookExecutor | undefined
  private readonly compactor: Compactor | undefined
  private readonly toolMetadata: Record<string, unknown>
  private messagesInternal: ConversationMessage[] = []
  private totalUsageInternal: UsageSnapshot = { ...emptyUsage }

  constructor(options: QueryEngineOptions) {
    this.apiClient = options.apiClient
    this.toolRegistry = options.toolRegistry
    this.permissionChecker = options.permissionChecker
    this.cwd = options.cwd
    this.model = options.model
    this.systemPrompt = options.systemPrompt
    this.maxTokens = options.maxTokens ?? 4096
    this.contextWindowTokens = options.contextWindowTokens
    this.autoCompactThresholdTokens = options.autoCompactThresholdTokens
    this.maxTurns = options.maxTurns ?? 8
    this.permissionPrompt = options.permissionPrompt
    this.askUserPrompt = options.askUserPrompt
    this.hookExecutor = options.hookExecutor
    this.compactor = options.compactor
    this.toolMetadata = options.toolMetadata ?? {}
    // Plan-mode tools call this callback to swap the engine's permission
    // checker. Effect is "next turn onward" — mid-turn evaluations continue
    // to use the checker captured by the current buildContext(). Matches
    // upstream's load-on-next-turn semantics.
    this.toolMetadata['set_permission_mode'] = (mode: PermissionMode): void => {
      this.permissionChecker = new PermissionChecker(defaultPermissionSettings(mode))
    }
  }

  get messages(): ConversationMessage[] {
    return [...this.messagesInternal]
  }

  get totalUsage(): UsageSnapshot {
    return { ...this.totalUsageInternal }
  }

  getModel(): string {
    return this.model
  }

  getSystemPrompt(): string {
    return this.systemPrompt
  }

  getMaxTurns(): number | null {
    return this.maxTurns
  }

  getToolMetadata(): Record<string, unknown> {
    return this.toolMetadata
  }

  setSystemPrompt(prompt: string): void {
    this.systemPrompt = prompt
  }

  setModel(model: string): void {
    this.model = model
  }

  setApiClient(client: SupportsStreamingMessages): void {
    this.apiClient = client
  }

  setMaxTurns(maxTurns: number | null): void {
    this.maxTurns = maxTurns == null ? null : Math.max(1, Math.floor(maxTurns))
  }

  setPermissionChecker(checker: PermissionChecker): void {
    this.permissionChecker = checker
  }

  loadMessages(messages: ConversationMessage[]): void {
    this.messagesInternal = [...messages]
  }

  /**
   * FR-20: rehydrate the running-usage counters from a saved snapshot so a
   * resumed session continues to report cumulative token spend instead of
   * resetting to zero on load.
   */
  loadUsage(usage: UsageSnapshot): void {
    this.totalUsageInternal = { ...usage }
  }

  /**
   * FR-20: rehydrate tool-carryover metadata (permission_mode, read_file_state,
   * recent_work_log, etc.) from a saved snapshot. Callers should filter to the
   * sessions-package `PERSISTED_TOOL_METADATA_KEYS` before passing in.
   */
  loadToolMetadata(metadata: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(metadata)) {
      this.toolMetadata[key] = value
    }
  }

  clear(): void {
    this.messagesInternal = []
    this.totalUsageInternal = { ...emptyUsage }
  }

  /**
   * Return true when the conversation ends with tool results that await a
   * follow-up assistant turn. Used by session resume to decide whether to
   * call continuePending rather than waiting for fresh user input.
   */
  hasPendingContinuation(): boolean {
    if (this.messagesInternal.length === 0) return false
    const last = this.messagesInternal[this.messagesInternal.length - 1]!
    if (last.role !== 'user') return false
    const hasToolResult = last.content.some(
      (b): b is ToolResultBlock => b.type === 'tool_result',
    )
    if (!hasToolResult) return false
    for (let i = this.messagesInternal.length - 2; i >= 0; i--) {
      const msg = this.messagesInternal[i]!
      if (msg.role !== 'assistant') continue
      return messageToolUses(msg).length > 0
    }
    return false
  }

  async *submitMessage(
    prompt: string | ConversationMessage,
  ): AsyncGenerator<StreamEvent> {
    const userMessage: ConversationMessage =
      typeof prompt === 'string' ? userMessageFromText(prompt) : prompt

    this.messagesInternal.push(userMessage)

    rememberUserGoal(this.toolMetadata, messageText(userMessage))

    if (this.hookExecutor != null) {
      await this.hookExecutor.execute(HookEvent.USER_PROMPT_SUBMIT, {
        event: HookEvent.USER_PROMPT_SUBMIT,
        prompt: messageText(userMessage),
      })
    }

    const context = this.buildContext(this.maxTurns)
    const queryMessages = [...this.messagesInternal]

    for await (const { event, usage } of runQuery(context, queryMessages)) {
      if (event.type === 'assistant_turn_complete') {
        this.messagesInternal = [...queryMessages]
      }
      if (usage !== null) this.addUsage(usage)
      yield event
    }
  }

  async *continuePending(opts?: {
    maxTurns?: number | null
  }): AsyncGenerator<StreamEvent> {
    const effectiveMaxTurns =
      opts?.maxTurns !== undefined ? opts.maxTurns : this.maxTurns
    const context = this.buildContext(effectiveMaxTurns)
    for await (const { event, usage } of runQuery(context, this.messagesInternal)) {
      if (usage !== null) this.addUsage(usage)
      yield event
    }
  }

  private buildContext(maxTurns: number | null): QueryContext {
    return {
      apiClient: this.apiClient,
      toolRegistry: this.toolRegistry,
      permissionChecker: this.permissionChecker,
      cwd: this.cwd,
      model: this.model,
      systemPrompt: this.systemPrompt,
      maxTokens: this.maxTokens,
      ...(this.contextWindowTokens !== undefined
        ? { contextWindowTokens: this.contextWindowTokens }
        : {}),
      ...(this.autoCompactThresholdTokens !== undefined
        ? { autoCompactThresholdTokens: this.autoCompactThresholdTokens }
        : {}),
      maxTurns,
      ...(this.permissionPrompt != null ? { permissionPrompt: this.permissionPrompt } : {}),
      ...(this.askUserPrompt != null ? { askUserPrompt: this.askUserPrompt } : {}),
      ...(this.hookExecutor != null ? { hookExecutor: this.hookExecutor } : {}),
      ...(this.compactor != null ? { compactor: this.compactor } : {}),
      toolMetadata: this.toolMetadata,
    }
  }

  private addUsage(u: UsageSnapshot): void {
    this.totalUsageInternal = {
      input_tokens: this.totalUsageInternal.input_tokens + u.input_tokens,
      output_tokens: this.totalUsageInternal.output_tokens + u.output_tokens,
    }
  }
}
