/**
 * Ported from openharness/src/openharness/ui/runtime.py
 * Upstream: https://github.com/HKUDS/OpenHarness (MIT)
 * Upstream SHA at port time: 559ba76f237db957a1a21453170df8500479dc7d
 *
 * Changes from upstream:
 *   - Guildhall RuntimeBundle is a much thinner wrapper than upstream. We
 *     drop: copilot, bridge manager, plugin system, Docker sandbox,
 *     keybindings, vim/voice mode, theme, app-state store, slash-command
 *     registry. Those concerns either do not exist yet or live in other
 *     packages and will be plugged back in behind this bundle later.
 *   - Provider selection (`_resolve_api_client_from_settings`) is deferred:
 *     callers build the concrete `@guildhall/providers` client and pass it in.
 *   - `build_runtime_system_prompt` (which assembles CLAUDE.md, skills, plugin
 *     system-prompts, etc.) is deferred; callers pass a pre-rendered prompt.
 *   - `MaxTurnsExceeded` is a concern of `runQuery`; we surface it to callers
 *     unchanged rather than catching/printing inside `handleLine`.
 *   - `load_hook_registry` is deferred — callers build a HookExecutor and
 *     pass it in. Upstream re-reads hooks on every line; we trust the
 *     executor to own its own live-reload policy.
 *   - `ask_user_prompt`/`permission_prompt` are threaded straight into the
 *     engine without any TUI wrapping.
 *   - Session persistence uses `@guildhall/sessions.saveSessionSnapshot`
 *     directly; the upstream SessionBackend abstraction (needed for future
 *     non-filesystem backends) is deferred.
 */

import { randomBytes } from 'node:crypto'

import {
  HookEvent,
  QueryEngine,
  type HookExecutor,
  type PermissionChecker,
  type SupportsStreamingMessages,
  type ToolRegistry,
} from '@guildhall/engine'
import type { ConversationMessage, StreamEvent } from '@guildhall/protocol'
import { loadSessionById, saveSessionSnapshot } from '@guildhall/sessions'

export interface BuildRuntimeOptions {
  apiClient: SupportsStreamingMessages
  cwd: string
  model: string
  systemPrompt: string
  toolRegistry: ToolRegistry
  permissionChecker: PermissionChecker
  hookExecutor?: HookExecutor
  maxTokens?: number
  contextWindowTokens?: number | null
  autoCompactThresholdTokens?: number | null
  maxTurns?: number | null
  toolMetadata?: Record<string, unknown>
  sessionId?: string
  restoreSessionId?: string
  restoreMessages?: ConversationMessage[]
  restoreToolMetadata?: Record<string, unknown>
  permissionPrompt?: (toolName: string, reason: string) => Promise<boolean>
  askUserPrompt?: (question: string) => Promise<string>
}

export interface RuntimeBundle {
  apiClient: SupportsStreamingMessages
  cwd: string
  model: string
  systemPrompt: string
  toolRegistry: ToolRegistry
  permissionChecker: PermissionChecker
  hookExecutor: HookExecutor | undefined
  engine: QueryEngine
  sessionId: string
  restored: boolean
}

export interface HandleLineCallbacks {
  onEvent?: (event: StreamEvent) => Promise<void> | void
}

function newSessionId(): string {
  return randomBytes(6).toString('hex')
}

export async function buildRuntime(options: BuildRuntimeOptions): Promise<RuntimeBundle> {
  let restored = false
  let messages: ConversationMessage[] = []
  let sessionId = options.sessionId ?? newSessionId()
  let model = options.model
  let systemPrompt = options.systemPrompt
  let toolMetadata: Record<string, unknown> = { ...(options.toolMetadata ?? {}) }

  if (options.restoreSessionId) {
    const snap = loadSessionById(options.cwd, options.restoreSessionId)
    if (snap) {
      restored = true
      sessionId = snap.session_id
      messages = [...snap.messages]
      if (snap.model) model = snap.model
      if (snap.system_prompt) systemPrompt = snap.system_prompt
      toolMetadata = { ...snap.tool_metadata, ...toolMetadata }
    }
  }

  if (options.restoreMessages && options.restoreMessages.length > 0) {
    restored = true
    messages = [...options.restoreMessages]
  }

  if (options.restoreToolMetadata) {
    toolMetadata = { ...toolMetadata, ...options.restoreToolMetadata }
  }

  const engine = new QueryEngine({
    apiClient: options.apiClient,
    toolRegistry: options.toolRegistry,
    permissionChecker: options.permissionChecker,
    cwd: options.cwd,
    model,
    systemPrompt,
    ...(options.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
    ...(options.contextWindowTokens !== undefined
      ? { contextWindowTokens: options.contextWindowTokens }
      : {}),
    ...(options.autoCompactThresholdTokens !== undefined
      ? { autoCompactThresholdTokens: options.autoCompactThresholdTokens }
      : {}),
    ...(options.maxTurns !== undefined ? { maxTurns: options.maxTurns } : {}),
    ...(options.permissionPrompt ? { permissionPrompt: options.permissionPrompt } : {}),
    ...(options.askUserPrompt ? { askUserPrompt: options.askUserPrompt } : {}),
    ...(options.hookExecutor ? { hookExecutor: options.hookExecutor } : {}),
    toolMetadata,
  })
  if (messages.length > 0) engine.loadMessages(messages)

  return {
    apiClient: options.apiClient,
    cwd: options.cwd,
    model,
    systemPrompt,
    toolRegistry: options.toolRegistry,
    permissionChecker: options.permissionChecker,
    hookExecutor: options.hookExecutor,
    engine,
    sessionId,
    restored,
  }
}

export async function startRuntime(bundle: RuntimeBundle): Promise<void> {
  if (!bundle.hookExecutor) return
  await bundle.hookExecutor.execute(HookEvent.SESSION_START, {
    event: HookEvent.SESSION_START,
    cwd: bundle.cwd,
  })
}

export async function closeRuntime(bundle: RuntimeBundle): Promise<void> {
  if (!bundle.hookExecutor) return
  await bundle.hookExecutor.execute(HookEvent.SESSION_END, {
    event: HookEvent.SESSION_END,
    cwd: bundle.cwd,
  })
}

function persistSnapshot(bundle: RuntimeBundle): void {
  saveSessionSnapshot({
    cwd: bundle.cwd,
    model: bundle.engine.getModel(),
    systemPrompt: bundle.engine.getSystemPrompt(),
    messages: bundle.engine.messages,
    usage: bundle.engine.totalUsage,
    sessionId: bundle.sessionId,
    toolMetadata: bundle.engine.getToolMetadata(),
  })
}

export async function handleLine(
  bundle: RuntimeBundle,
  line: string,
  callbacks: HandleLineCallbacks = {},
): Promise<void> {
  try {
    for await (const event of bundle.engine.submitMessage(line)) {
      if (callbacks.onEvent) await callbacks.onEvent(event)
    }
  } finally {
    persistSnapshot(bundle)
  }
}

export async function resumePending(
  bundle: RuntimeBundle,
  callbacks: HandleLineCallbacks = {},
): Promise<boolean> {
  if (!bundle.engine.hasPendingContinuation()) return false
  try {
    for await (const event of bundle.engine.continuePending()) {
      if (callbacks.onEvent) await callbacks.onEvent(event)
    }
  } finally {
    persistSnapshot(bundle)
  }
  return true
}
