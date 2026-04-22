/**
 * Ported from openharness/src/openharness/ui/backend_host.py
 * Upstream: https://github.com/HKUDS/OpenHarness (MIT)
 * Upstream SHA at port time: 559ba76f237db957a1a21453170df8500479dc7d
 *
 * Changes from upstream:
 *   - Guildhall's backend host is the bare OHJSON transport. All command
 *     dispatch (`/provider`, `/permissions`, `/theme`, `/effort`, `/passes`,
 *     `/turns`, `/fast`, `/vim`, `/voice`, `/model`, `/output-style`,
 *     `/resume`) is deferred to a pluggable `SelectCommandHandler` the caller
 *     wires in — upstream hardcodes them all on the host class.
 *   - The host consumes a prebuilt `RuntimeBundle` from @guildhall/runtime-bundle
 *     and drives `handleLine` / `resumePending`. It no longer knows about
 *     AuthManager, themes, output_styles, mcp_manager, bridge_manager,
 *     task_manager, commands registry, or app_state snapshots.
 *   - `_status_snapshot`, `_handle_list_sessions`, `_emit_todo_update_from_output`,
 *     and `_emit_swarm_status` are not ported in this pass — they are
 *     UI-layer helpers that belong to the command adapter.
 *   - Python `asyncio.Queue` + `asyncio.to_thread(stdin.readline)` →
 *     AsyncIterable line reader accepting any `LineStream` (readable stream
 *     or test double).
 *   - Permission / question prompts are still promise-based; upstream used
 *     asyncio.Future + asyncio.wait_for. Default timeout matches upstream (300s).
 *   - `uuid4().hex` → `crypto.randomUUID().replace(/-/g, '')`.
 *   - `TodoWrite` rich-output extraction keeps upstream semantics but uses
 *     structured callbacks instead of dynamic attribute access.
 */

import { randomUUID } from 'node:crypto'

import type {
  AssistantTextDelta,
  AssistantTurnComplete,
  CompactProgressEvent,
  ErrorEvent,
  StatusEvent,
  StreamEvent,
  ToolExecutionCompleted,
  ToolExecutionStarted,
} from '@guildhall/protocol'
import {
  closeRuntime,
  handleLine,
  resumePending,
  startRuntime,
  type RuntimeBundle,
} from '@guildhall/runtime-bundle'

import {
  OHJSON_PREFIX,
  encodeBackendEvent,
  parseFrontendRequest,
  type BackendEvent,
  type FrontendRequest,
  type TranscriptItem,
} from './wire.js'

export type LineSink = (line: string) => void | Promise<void>

export interface LineStream {
  [Symbol.asyncIterator](): AsyncIterator<string>
}

export interface SelectCommandHandler {
  handleSelect(command: string): Promise<void>
  applySelect(command: string, value: string): Promise<{
    line?: string
    transcriptLine?: string
    shouldContinue?: boolean
  }>
}

export interface ListSessionsHandler {
  listSessions(): Promise<BackendEvent>
}

export interface BackendHostOptions {
  bundle: RuntimeBundle
  input: LineStream
  output: LineSink
  selectHandler?: SelectCommandHandler
  listSessionsHandler?: ListSessionsHandler
  readyCommands?: string[]
  readyState?: Record<string, unknown>
  permissionTimeoutMs?: number
  onUnknownRequest?: (request: FrontendRequest) => Promise<BackendEvent | null>
  // Hook called when a line is submitted, before handleLine runs.
  // Return false to short-circuit the line (e.g. if the caller handled it
  // as a slash command). Defaults to passthrough.
  onSubmitLine?: (
    line: string,
  ) => Promise<
    { handled: true; shouldContinue?: boolean } | { handled: false }
  >
}

type PendingPermission = {
  resolve: (value: boolean) => void
}

type PendingQuestion = {
  resolve: (value: string) => void
}

const DEFAULT_PERMISSION_TIMEOUT_MS = 300_000

// ---------------------------------------------------------------------------
// Host
// ---------------------------------------------------------------------------

export class ReactBackendHost {
  private readonly bundle: RuntimeBundle
  private readonly input: LineStream
  private readonly output: LineSink
  private readonly selectHandler: SelectCommandHandler | undefined
  private readonly listSessionsHandler: ListSessionsHandler | undefined
  private readonly readyCommands: string[]
  private readonly readyState: Record<string, unknown>
  private readonly permissionTimeoutMs: number
  private readonly onUnknownRequest: BackendHostOptions['onUnknownRequest']
  private readonly onSubmitLine: BackendHostOptions['onSubmitLine']
  private readonly permissionRequests = new Map<string, PendingPermission>()
  private readonly questionRequests = new Map<string, PendingQuestion>()
  private readonly queue: FrontendRequest[] = []
  private queueWaiter: ((value: FrontendRequest | null) => void) | null = null
  private busy = false
  private running = true
  private readonly lastToolInputs = new Map<string, Record<string, unknown>>()

  constructor(options: BackendHostOptions) {
    this.bundle = options.bundle
    this.input = options.input
    this.output = options.output
    this.selectHandler = options.selectHandler
    this.listSessionsHandler = options.listSessionsHandler
    this.readyCommands = options.readyCommands ?? []
    this.readyState = options.readyState ?? {}
    this.permissionTimeoutMs = options.permissionTimeoutMs ?? DEFAULT_PERMISSION_TIMEOUT_MS
    this.onUnknownRequest = options.onUnknownRequest
    this.onSubmitLine = options.onSubmitLine
  }

  // Provide the bundle with TUI-friendly prompt callbacks. These should be
  // passed into buildRuntime() so QueryEngine can surface them through the
  // host. Callers wire them by reading host.askPermission / host.askQuestion
  // bound methods before constructing the bundle.
  readonly askPermission = async (toolName: string, reason: string): Promise<boolean> => {
    const requestId = shortId()
    const payload: BackendEvent = {
      type: 'modal_request',
      modal: {
        kind: 'permission',
        request_id: requestId,
        tool_name: toolName,
        reason,
      },
    }
    await this.emit(payload)
    return await this.awaitPermission(requestId)
  }

  readonly askQuestion = async (question: string): Promise<string> => {
    const requestId = shortId()
    const payload: BackendEvent = {
      type: 'modal_request',
      modal: {
        kind: 'question',
        request_id: requestId,
        question,
      },
    }
    await this.emit(payload)
    return await this.awaitQuestion(requestId)
  }

  async run(): Promise<number> {
    await startRuntime(this.bundle)
    await this.emit({
      type: 'ready',
      state: this.readyState,
      tasks: [],
      mcp_servers: [],
      bridge_sessions: [],
      commands: this.readyCommands,
    })

    const reader = this.readRequests()

    try {
      while (this.running) {
        const request = await this.nextRequest()
        if (request === null) break
        const shouldContinue = await this.dispatchRequest(request)
        if (!shouldContinue) {
          await this.emit({ type: 'shutdown' })
          break
        }
      }
    } finally {
      this.running = false
      this.wakeWaiter(null)
      await closeRuntime(this.bundle)
      // Don't await the reader: `for await (const line of this.input)` may be
      // suspended inside the input iterator's `next()` with no way for us to
      // cancel it from out here. The host is shutting down anyway; swallow
      // any reader-side error asynchronously.
      reader.catch(() => {})
    }
    return 0
  }

  async emit(event: BackendEvent): Promise<void> {
    await this.output(encodeBackendEvent(event))
  }

  // ---------------------------------------------------------------------
  // Request dispatch
  // ---------------------------------------------------------------------

  private async dispatchRequest(request: FrontendRequest): Promise<boolean> {
    if (request.type === 'shutdown') return false
    if (request.type === 'permission_response' || request.type === 'question_response') {
      return true
    }

    if (request.type === 'list_sessions') {
      if (this.listSessionsHandler) {
        const evt = await this.listSessionsHandler.listSessions()
        await this.emit(evt)
      } else {
        await this.emit({ type: 'error', message: '/resume is not wired into this host' })
      }
      return true
    }

    if (request.type === 'select_command') {
      if (this.selectHandler) {
        await this.selectHandler.handleSelect(request.command ?? '')
      } else {
        await this.emit({ type: 'error', message: 'select commands not wired into this host' })
      }
      return true
    }

    if (request.type === 'apply_select_command') {
      if (this.busy) {
        await this.emit({ type: 'error', message: 'Session is busy' })
        return true
      }
      if (!this.selectHandler) {
        await this.emit({ type: 'error', message: 'select commands not wired into this host' })
        return true
      }
      this.busy = true
      let outcome: { line?: string; transcriptLine?: string; shouldContinue?: boolean }
      try {
        outcome = await this.selectHandler.applySelect(
          request.command ?? '',
          request.value ?? '',
        )
      } finally {
        this.busy = false
      }
      if (outcome.shouldContinue === false) return false
      if (!outcome.line) return true
      return await this.processLine(outcome.line, outcome.transcriptLine ?? outcome.line)
    }

    if (request.type !== 'submit_line') {
      if (this.onUnknownRequest) {
        const evt = await this.onUnknownRequest(request)
        if (evt) await this.emit(evt)
      } else {
        await this.emit({
          type: 'error',
          message: `Unknown request type: ${request.type}`,
        })
      }
      return true
    }

    if (this.busy) {
      await this.emit({ type: 'error', message: 'Session is busy' })
      return true
    }

    const line = (request.line ?? '').trim()
    if (!line) return true

    this.busy = true
    try {
      return await this.processLine(line)
    } finally {
      this.busy = false
    }
  }

  private async processLine(line: string, transcriptLine?: string): Promise<boolean> {
    await this.emitTranscript({ role: 'user', text: transcriptLine ?? line })

    if (this.onSubmitLine) {
      const hook = await this.onSubmitLine(line)
      if (hook.handled) {
        await this.emit({ type: 'line_complete' })
        return hook.shouldContinue !== false
      }
    }

    await handleLine(this.bundle, line, {
      onEvent: async (ev) => {
        await this.renderEvent(ev)
      },
    })

    await this.emit({ type: 'line_complete' })
    return true
  }

  // ---------------------------------------------------------------------
  // Stream event → BackendEvent rendering
  // ---------------------------------------------------------------------

  private async renderEvent(event: StreamEvent): Promise<void> {
    switch (event.type) {
      case 'assistant_text_delta':
        await this.renderTextDelta(event)
        return
      case 'assistant_turn_complete':
        await this.renderTurnComplete(event)
        return
      case 'tool_execution_started':
        await this.renderToolStarted(event)
        return
      case 'tool_execution_completed':
        await this.renderToolCompleted(event)
        return
      case 'compact_progress':
        await this.renderCompactProgress(event)
        return
      case 'error':
        await this.renderError(event)
        return
      case 'status':
        await this.renderStatus(event)
        return
    }
  }

  private async renderTextDelta(event: AssistantTextDelta): Promise<void> {
    await this.emit({ type: 'assistant_delta', message: event.text })
  }

  private async renderTurnComplete(event: AssistantTurnComplete): Promise<void> {
    const text = extractMessageText(event.message).trim()
    await this.emit({
      type: 'assistant_complete',
      message: text,
      item: { role: 'assistant', text },
    })
  }

  private async renderToolStarted(event: ToolExecutionStarted): Promise<void> {
    this.lastToolInputs.set(event.tool_name, event.tool_input ?? {})
    await this.emit({
      type: 'tool_started',
      tool_name: event.tool_name,
      tool_input: event.tool_input,
      item: {
        role: 'tool',
        text: `${event.tool_name} ${JSON.stringify(event.tool_input ?? {})}`,
        tool_name: event.tool_name,
        tool_input: event.tool_input,
      },
    })
  }

  private async renderToolCompleted(event: ToolExecutionCompleted): Promise<void> {
    await this.emit({
      type: 'tool_completed',
      tool_name: event.tool_name,
      output: event.output,
      is_error: event.is_error,
      item: {
        role: 'tool_result',
        text: event.output,
        tool_name: event.tool_name,
        is_error: event.is_error,
      },
    })

    if (event.tool_name === 'TodoWrite' || event.tool_name === 'todo_write') {
      const input = this.lastToolInputs.get(event.tool_name) ?? {}
      const todos = Array.isArray(input.todos)
        ? (input.todos as unknown[])
        : Array.isArray(input.content)
          ? (input.content as unknown[])
          : null
      if (todos && todos.length > 0) {
        const lines: string[] = []
        for (const item of todos) {
          if (item && typeof item === 'object') {
            const it = item as Record<string, unknown>
            const status = it.status
            const checked =
              status === 'done' ||
              status === 'completed' ||
              status === 'x' ||
              status === true
            const text = typeof it.content === 'string'
              ? it.content
              : typeof it.text === 'string'
                ? it.text
                : JSON.stringify(item)
            lines.push(`- [${checked ? 'x' : ' '}] ${text}`)
          }
        }
        if (lines.length > 0) {
          await this.emit({ type: 'todo_update', todo_markdown: lines.join('\n') })
        }
      } else {
        await this.emitTodoUpdateFromOutput(event.output)
      }
    }
  }

  private async emitTodoUpdateFromOutput(output: string): Promise<void> {
    const lines = output
      .split('\n')
      .map((l) => l.trimEnd())
      .filter((l) => l.trimStart().startsWith('- ['))
    if (lines.length > 0) {
      await this.emit({ type: 'todo_update', todo_markdown: lines.join('\n') })
    }
  }

  private async renderCompactProgress(event: CompactProgressEvent): Promise<void> {
    await this.emit({
      type: 'compact_progress',
      compact_phase: event.phase,
      compact_trigger: event.trigger,
      ...(event.attempt !== undefined && event.attempt !== null ? { attempt: event.attempt } : {}),
      ...(event.checkpoint ? { compact_checkpoint: event.checkpoint } : {}),
      ...(event.metadata ? { compact_metadata: event.metadata } : {}),
      ...(event.message ? { message: event.message } : {}),
    })
  }

  private async renderError(event: ErrorEvent): Promise<void> {
    await this.emit({ type: 'error', message: event.message })
    await this.emitTranscript({ role: 'system', text: event.message })
  }

  private async renderStatus(event: StatusEvent): Promise<void> {
    await this.emitTranscript({ role: 'system', text: event.message })
  }

  private async emitTranscript(item: TranscriptItem): Promise<void> {
    await this.emit({ type: 'transcript_item', item })
  }

  // ---------------------------------------------------------------------
  // Input reader + request queue
  // ---------------------------------------------------------------------

  private async readRequests(): Promise<void> {
    try {
      for await (const rawLine of this.input) {
        if (!this.running) return
        const payload = rawLine.trim()
        if (!payload) continue
        let request: FrontendRequest
        try {
          request = parseFrontendRequest(payload)
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          await this.emit({ type: 'error', message: `Invalid request: ${message}` })
          continue
        }
        if (request.type === 'permission_response' && request.request_id) {
          const pending = this.permissionRequests.get(request.request_id)
          if (pending) {
            pending.resolve(Boolean(request.allowed))
            this.permissionRequests.delete(request.request_id)
          }
          continue
        }
        if (request.type === 'question_response' && request.request_id) {
          const pending = this.questionRequests.get(request.request_id)
          if (pending) {
            pending.resolve(request.answer ?? '')
            this.questionRequests.delete(request.request_id)
          }
          continue
        }
        this.enqueue(request)
      }
    } finally {
      // EOF — enqueue an implicit shutdown.
      this.enqueue({ type: 'shutdown' })
    }
  }

  private enqueue(request: FrontendRequest): void {
    if (this.queueWaiter) {
      const waiter = this.queueWaiter
      this.queueWaiter = null
      waiter(request)
      return
    }
    this.queue.push(request)
  }

  private wakeWaiter(value: FrontendRequest | null): void {
    if (this.queueWaiter) {
      const waiter = this.queueWaiter
      this.queueWaiter = null
      waiter(value)
    }
  }

  private nextRequest(): Promise<FrontendRequest | null> {
    const next = this.queue.shift()
    if (next !== undefined) return Promise.resolve(next)
    return new Promise((resolve) => {
      this.queueWaiter = resolve
    })
  }

  // ---------------------------------------------------------------------
  // Permission / question futures
  // ---------------------------------------------------------------------

  private awaitPermission(requestId: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const pending: PendingPermission = { resolve }
      this.permissionRequests.set(requestId, pending)
      const timer = setTimeout(() => {
        if (this.permissionRequests.delete(requestId)) resolve(false)
      }, this.permissionTimeoutMs)
      const wrapResolve = pending.resolve
      pending.resolve = (value: boolean) => {
        clearTimeout(timer)
        wrapResolve(value)
      }
    })
  }

  private awaitQuestion(requestId: string): Promise<string> {
    return new Promise<string>((resolve) => {
      this.questionRequests.set(requestId, { resolve })
    })
  }

  // ---------------------------------------------------------------------
  // Resume / bundle helpers
  // ---------------------------------------------------------------------

  async resumeIfPending(): Promise<boolean> {
    return await resumePending(this.bundle, {
      onEvent: async (ev) => {
        await this.renderEvent(ev)
      },
    })
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function shortId(): string {
  return randomUUID().replace(/-/g, '')
}

function extractMessageText(message: { content: Array<{ type: string; text?: string }> }): string {
  let out = ''
  for (const block of message.content) {
    if (block.type === 'text' && typeof block.text === 'string') out += block.text
  }
  return out
}

// Also exported for callers that want the raw prefix to adapt their own
// stdin/stdout plumbing.
export { OHJSON_PREFIX }
