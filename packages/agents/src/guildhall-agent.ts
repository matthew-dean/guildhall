/**
 * GuildhallAgent — the thin wrapper that gives each role a stateful,
 * tool-using conversation backed by QueryEngine.
 *
 * Each call to `.generate(prompt)` drives a single multi-turn exchange to
 * completion and returns the final assistant text. Internal state (message
 * history, tool-carryover metadata) is preserved across calls so the
 * orchestrator can feed JIT context into an already-warm agent.
 */

import {
  QueryEngine,
  PermissionChecker,
  PermissionMode,
  ToolRegistry,
  defaultPermissionSettings,
  type AnyTool,
  type Compactor,
  type HookExecutor,
} from '@guildhall/engine'
import type { ConversationMessage, StreamEvent, UsageSnapshot } from '@guildhall/protocol'
import type { SkillDefinition } from '@guildhall/skills'
import {
  loadSessionById,
  loadSessionSnapshot,
  saveSessionSnapshot,
} from '@guildhall/sessions'
export type { StreamEvent }
import type { AgentLLM } from './llm.js'

export interface GuildhallAgentOptions {
  name: string
  llm: AgentLLM
  systemPrompt: string
  tools: AnyTool[]
  cwd?: string
  maxTurns?: number | null
  maxTokens?: number
  permissionChecker?: PermissionChecker
  /**
   * FR-15: baseline permission mode. Per-task overrides may narrow this but
   * never widen it. Defaults to `full_auto` for the orchestrator's agent set
   * so that system-level actors can still move work forward.
   */
  baselinePermissionMode?: PermissionMode
  /**
   * FR-17: a list of Skill bundles to append to the system prompt. Each
   * skill's body is rendered beneath a "## Skills" divider so the agent sees
   * every skill's instructions as part of its core context.
   */
  skills?: readonly SkillDefinition[]
  /**
   * FR-18: hook executor for lifecycle events (PRE_TOOL_USE, POST_TOOL_USE,
   * USER_PROMPT_SUBMIT, STOP, NOTIFICATION). If omitted, the underlying
   * QueryEngine skips hook execution entirely.
   */
  hookExecutor?: HookExecutor
  /**
   * FR-19: reactive compactor. Invoked when the model stream fails with a
   * prompt-too-long error so the agent can retry on a compacted history
   * instead of failing the whole conversation.
   */
  compactor?: Compactor
  /**
   * FR-20: automatic session persistence. When set, a snapshot is written
   * after every successful `generate()` turn so the agent can resume from
   * disk without losing in-flight context. The `cwd` is the project root the
   * snapshot keys off of (sha1'd into the session dir name); `sessionId`
   * pins a stable filename across reruns.
   */
  sessionPersistence?: {
    cwd: string
    sessionId?: string
  }
}

export interface GenerateResult {
  text: string
  messages: ConversationMessage[]
  usage: UsageSnapshot
}

export class GuildhallAgent {
  readonly name: string
  private readonly engine: QueryEngine
  /** FR-15: the widest mode this agent is ever allowed to operate in. */
  private readonly baselineMode: PermissionMode
  private currentMode: PermissionMode
  /** FR-20: where (and under what id) to persist snapshots after each turn. */
  private readonly sessionPersistence: GuildhallAgentOptions['sessionPersistence']

  constructor(options: GuildhallAgentOptions) {
    this.name = options.name
    const registry = new ToolRegistry()
    for (const tool of options.tools) registry.register(tool)

    this.baselineMode = options.baselinePermissionMode ?? PermissionMode.FULL_AUTO;
    this.currentMode = this.baselineMode
    this.sessionPersistence = options.sessionPersistence

    const systemPrompt = options.skills && options.skills.length > 0
      ? composeSystemPromptWithSkills(options.systemPrompt, options.skills)
      : options.systemPrompt

    this.engine = new QueryEngine({
      apiClient: options.llm.apiClient,
      model: options.llm.modelId,
      systemPrompt,
      toolRegistry: registry,
      permissionChecker:
        options.permissionChecker ?? new PermissionChecker(defaultPermissionSettings(this.baselineMode)),
      cwd: options.cwd ?? process.cwd(),
      maxTurns: options.maxTurns ?? 8,
      maxTokens: options.maxTokens ?? 4096,
      ...(options.hookExecutor ? { hookExecutor: options.hookExecutor } : {}),
      ...(options.compactor ? { compactor: options.compactor } : {}),
    })
  }

  get permissionMode(): PermissionMode {
    return this.currentMode
  }

  /**
   * FR-15: swap the QueryEngine's permission checker for the next conversation
   * turn. The requested mode is clamped to the agent's baseline — per-task
   * overrides may narrow but never widen. Returns the mode actually applied.
   */
  setPermissionMode(mode: PermissionMode): PermissionMode {
    const effective = clampPermissionMode(mode, this.baselineMode)
    this.currentMode = effective
    this.engine.setPermissionChecker(
      new PermissionChecker(defaultPermissionSettings(effective)),
    )
    return effective
  }

  /**
   * Run a single user prompt to completion. Returns the final assistant text
   * (concatenation of text blocks in the final assistant message) along with
   * the full message list and usage snapshot.
   */
  async generate(prompt: string): Promise<GenerateResult> {
    for await (const _event of this.engine.submitMessage(prompt)) {
      void _event
    }
    const messages = this.engine.messages
    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')
    const text = lastAssistant ? extractText(lastAssistant) : ''
    // FR-20: persist a fresh snapshot at the turn boundary. Failures here are
    // logged but never propagate — snapshotting is best-effort; the caller
    // already has the in-memory result.
    this.persistSession()
    return {
      text,
      messages,
      usage: this.engine.totalUsage,
    }
  }

  /**
   * FR-20: explicit snapshot. Callers that stream events themselves (bypassing
   * `generate`) can still force a save at safe boundaries, e.g. after an
   * `assistant_turn_complete` event observed from `stream()`.
   */
  saveSession(overrides?: { cwd?: string; sessionId?: string }): string | null {
    const cfg = overrides?.cwd
      ? { cwd: overrides.cwd, sessionId: overrides.sessionId }
      : this.sessionPersistence
    if (!cfg) return null
    try {
      return saveSessionSnapshot({
        cwd: cfg.cwd,
        model: this.engine.getModel(),
        systemPrompt: this.engine.getSystemPrompt(),
        messages: this.engine.messages,
        usage: this.engine.totalUsage,
        toolMetadata: this.engine.getToolMetadata(),
        ...(cfg.sessionId ? { sessionId: cfg.sessionId } : {}),
      })
    } catch {
      return null
    }
  }

  /**
   * FR-20: rehydrate from a saved snapshot. If `sessionId` is supplied we
   * load that specific file, otherwise we take `latest.json`. Returns true
   * when a snapshot was found and applied. Never throws — an absent snapshot
   * is a normal "fresh session" state.
   */
  loadSession(opts: { cwd: string; sessionId?: string }): boolean {
    const snapshot = opts.sessionId
      ? loadSessionById(opts.cwd, opts.sessionId)
      : loadSessionSnapshot(opts.cwd)
    if (!snapshot) return false
    this.engine.loadMessages(snapshot.messages)
    this.engine.loadUsage(snapshot.usage)
    this.engine.loadToolMetadata(snapshot.tool_metadata)
    return true
  }

  /**
   * FR-20: does the underlying engine end on a pending tool-result tail? If so
   * the caller should drive `continuePending()` (exposed via `continue()`)
   * rather than waiting for a fresh user prompt.
   */
  hasPendingContinuation(): boolean {
    return this.engine.hasPendingContinuation()
  }

  /**
   * FR-20: finish a mid-turn resume. Drives the QueryEngine against the
   * already-loaded history without appending a new user message, then
   * persists again if session-persistence is wired up.
   */
  async continue(): Promise<GenerateResult> {
    for await (const _event of this.engine.continuePending()) void _event
    this.persistSession()
    const messages = this.engine.messages
    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')
    const text = lastAssistant ? extractText(lastAssistant) : ''
    return { text, messages, usage: this.engine.totalUsage }
  }

  private persistSession(): void {
    if (!this.sessionPersistence) return
    try {
      saveSessionSnapshot({
        cwd: this.sessionPersistence.cwd,
        model: this.engine.getModel(),
        systemPrompt: this.engine.getSystemPrompt(),
        messages: this.engine.messages,
        usage: this.engine.totalUsage,
        toolMetadata: this.engine.getToolMetadata(),
        ...(this.sessionPersistence.sessionId
          ? { sessionId: this.sessionPersistence.sessionId }
          : {}),
      })
    } catch {
      // Snapshot IO failure is non-fatal. The conversation is still in memory.
    }
  }

  /**
   * Stream raw events for consumers that want UI-level observability
   * (progress spinners, tool-call chips, etc.).
   */
  stream(prompt: string): AsyncGenerator<StreamEvent> {
    return this.engine.submitMessage(prompt)
  }

  get messages(): ConversationMessage[] {
    return this.engine.messages
  }

  get totalUsage(): UsageSnapshot {
    return this.engine.totalUsage
  }
}

/**
 * FR-17: append skill bundles to a base system prompt under a divider.
 * Each skill's full `content` is included verbatim (minus its YAML
 * frontmatter, which the loader has already stripped via `parseSkillFrontmatter`).
 * Skills are separated by a horizontal rule so the agent can visually treat
 * each as an independent capability description.
 */
export function composeSystemPromptWithSkills(
  basePrompt: string,
  skills: readonly SkillDefinition[],
): string {
  if (skills.length === 0) return basePrompt
  const blocks: string[] = [basePrompt.trimEnd(), '', '## Skills', '']
  for (const skill of skills) {
    blocks.push(`### ${skill.name} — ${skill.description}`)
    blocks.push('')
    blocks.push(skill.content.trim())
    blocks.push('')
    blocks.push('---')
    blocks.push('')
  }
  // Drop the trailing separator for a clean end-of-prompt.
  while (blocks.length > 0 && (blocks[blocks.length - 1] === '---' || blocks[blocks.length - 1] === '')) {
    blocks.pop()
  }
  return blocks.join('\n')
}

/**
 * Narrow-but-not-widen ordering for PermissionMode (FR-15).
 *   plan (narrowest) < default < full_auto (widest)
 * Returns whichever of `requested` / `baseline` is narrower.
 */
export function clampPermissionMode(
  requested: PermissionMode,
  baseline: PermissionMode,
): PermissionMode {
  const rank: Record<PermissionMode, number> = {
    [PermissionMode.PLAN]: 0,
    [PermissionMode.DEFAULT]: 1,
    [PermissionMode.FULL_AUTO]: 2,
  }
  return rank[requested] < rank[baseline] ? requested : baseline
}

function extractText(message: ConversationMessage): string {
  if (typeof message.content === 'string') return message.content
  if (!Array.isArray(message.content)) return ''
  const parts: string[] = []
  for (const block of message.content) {
    if (block && typeof block === 'object' && 'type' in block && block.type === 'text') {
      const text = (block as { text?: unknown }).text
      if (typeof text === 'string') parts.push(text)
    }
  }
  return parts.join('')
}
