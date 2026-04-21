/**
 * Ported from openharness/src/openharness/hooks/executor.py
 * Upstream: https://github.com/HKUDS/OpenHarness (MIT)
 * Upstream SHA at port time: 559ba76f237db957a1a21453170df8500479dc7d
 *
 * Changes from upstream:
 *   - `asyncio.create_subprocess_shell` / `SandboxUnavailableError` →
 *     `child_process.spawn('sh', ['-c', ...])`. The sandbox abstraction
 *     hasn't been ported; host code can wrap the executor or swap the
 *     `spawnCommand` injection point below when the sandbox port lands.
 *   - `httpx.AsyncClient` → `fetch` with an `AbortController` for timeouts;
 *     Node 20+ has fetch built in
 *   - `fnmatch.fnmatch` → small local glob-to-regex helper (same semantics
 *     as Python's `fnmatch` for the `*`, `?`, `[abc]` subset used in hook
 *     matchers)
 *   - `shlex.quote` → local `shellEscape` that wraps in single quotes and
 *     escapes embedded single quotes (same behavior as shlex.quote on POSIX)
 *   - Errors inside the stream (e.g., provider throwing mid-stream) bubble
 *     up as failed HookResults with `success=false` — matches upstream's
 *     broad `except Exception` in `_run_http_hook` but applied uniformly
 */

import { spawn } from 'node:child_process'

import {
  type ApiMessageCompleteEvent,
  type ApiMessageRequest,
  type HookExecutionResult,
  type HookExecutor as EngineHookExecutor,
  type HookPayload,
  HookEvent,
  type SupportsStreamingMessages,
} from '@guildhall/engine'
import { userMessageFromText } from '@guildhall/protocol'

import { HookRegistry } from './registry.js'
import type {
  AgentHookDefinition,
  CommandHookDefinition,
  HookDefinition,
  HttpHookDefinition,
  PromptHookDefinition,
} from './schemas.js'
import {
  type AggregatedHookResult,
  type HookResult,
  aggregatedBlocked,
  aggregatedReason,
  makeHookResult,
} from './types.js'

export interface HookExecutionContext {
  cwd: string
  apiClient: SupportsStreamingMessages
  defaultModel: string
}

export interface SpawnResult {
  exitCode: number
  stdout: string
  stderr: string
}

/** Injection point so tests / sandboxed hosts can replace the runner. */
export type CommandRunner = (
  command: string,
  opts: { cwd: string; env: Record<string, string>; timeoutMs: number },
) => Promise<SpawnResult>

export const defaultCommandRunner: CommandRunner = async (command, opts) =>
  runShellCommand(command, opts)

export class HookExecutor implements EngineHookExecutor {
  private registry: HookRegistry
  private context: HookExecutionContext
  private readonly runCommand: CommandRunner

  constructor(
    registry: HookRegistry,
    context: HookExecutionContext,
    opts: { runCommand?: CommandRunner } = {},
  ) {
    this.registry = registry
    this.context = context
    this.runCommand = opts.runCommand ?? defaultCommandRunner
  }

  updateRegistry(registry: HookRegistry): void {
    this.registry = registry
  }

  updateContext(patch: Partial<HookExecutionContext>): void {
    this.context = { ...this.context, ...patch }
  }

  async executeAll(event: HookEvent, payload: HookPayload): Promise<AggregatedHookResult> {
    const results: HookResult[] = []
    for (const hook of this.registry.get(event)) {
      if (!matchesHook(hook, payload)) continue
      switch (hook.type) {
        case 'command':
          results.push(await this.runCommandHook(hook, event, payload))
          break
        case 'http':
          results.push(await this.runHttpHook(hook, event, payload))
          break
        case 'prompt':
          results.push(await this.runPromptLikeHook(hook, payload, false))
          break
        case 'agent':
          results.push(await this.runPromptLikeHook(hook, payload, true))
          break
      }
    }
    return { results }
  }

  async execute(event: HookEvent, payload: HookPayload): Promise<HookExecutionResult> {
    const agg = await this.executeAll(event, payload)
    const blocked = aggregatedBlocked(agg)
    if (!blocked) return { blocked: false }
    const reason = aggregatedReason(agg)
    return reason.length > 0 ? { blocked: true, reason } : { blocked: true }
  }

  private async runCommandHook(
    hook: CommandHookDefinition,
    event: HookEvent,
    payload: HookPayload,
  ): Promise<HookResult> {
    const command = injectArguments(hook.command, payload, true)
    let spawnRes: SpawnResult
    try {
      spawnRes = await this.runCommand(command, {
        cwd: this.context.cwd,
        env: {
          ...process.env as Record<string, string>,
          GUILDHALL_HOOK_EVENT: event,
          GUILDHALL_HOOK_PAYLOAD: JSON.stringify(payload),
        },
        timeoutMs: hook.timeout_seconds * 1000,
      })
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      if (reason === '__timeout__') {
        return makeHookResult({
          hook_type: hook.type,
          success: false,
          blocked: hook.block_on_failure,
          reason: `command hook timed out after ${hook.timeout_seconds}s`,
        })
      }
      return makeHookResult({
        hook_type: hook.type,
        success: false,
        blocked: hook.block_on_failure,
        reason,
      })
    }

    const output = [spawnRes.stdout.trim(), spawnRes.stderr.trim()].filter(Boolean).join('\n')
    const success = spawnRes.exitCode === 0
    return makeHookResult({
      hook_type: hook.type,
      success,
      output,
      blocked: hook.block_on_failure && !success,
      reason: output || `command hook failed with exit code ${spawnRes.exitCode}`,
      metadata: { returncode: spawnRes.exitCode },
    })
  }

  private async runHttpHook(
    hook: HttpHookDefinition,
    event: HookEvent,
    payload: HookPayload,
  ): Promise<HookResult> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), hook.timeout_seconds * 1000)
    try {
      const response = await fetch(hook.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...hook.headers },
        body: JSON.stringify({ event, payload }),
        signal: controller.signal,
      })
      const text = await response.text()
      const success = response.ok
      return makeHookResult({
        hook_type: hook.type,
        success,
        output: text,
        blocked: hook.block_on_failure && !success,
        reason: text || `http hook returned ${response.status}`,
        metadata: { status_code: response.status },
      })
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      return makeHookResult({
        hook_type: hook.type,
        success: false,
        blocked: hook.block_on_failure,
        reason,
      })
    } finally {
      clearTimeout(timer)
    }
  }

  private async runPromptLikeHook(
    hook: PromptHookDefinition | AgentHookDefinition,
    payload: HookPayload,
    agentMode: boolean,
  ): Promise<HookResult> {
    const prompt = injectArguments(hook.prompt, payload, false)
    let prefix =
      'You are validating whether a hook condition passes in Guildhall. ' +
      'Return strict JSON: {"ok": true} or {"ok": false, "reason": "..."}.'
    if (agentMode) prefix += ' Be more thorough and reason over the payload before deciding.'

    const request: ApiMessageRequest = {
      model: hook.model ?? this.context.defaultModel,
      messages: [userMessageFromText(prompt)],
      system_prompt: prefix,
      max_tokens: 512,
      tools: [],
    }

    const chunks: string[] = []
    let final: ApiMessageCompleteEvent | null = null
    try {
      for await (const ev of this.context.apiClient.streamMessage(request)) {
        if (ev.type === 'message_complete') final = ev
        else if (ev.type === 'text_delta') chunks.push(ev.text)
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      return makeHookResult({
        hook_type: hook.type,
        success: false,
        blocked: hook.block_on_failure,
        reason,
      })
    }

    let text = chunks.join('')
    if (final) {
      const finalText = extractMessageText(final)
      if (finalText) text = finalText
    }

    const parsed = parseHookJson(text)
    if (parsed.ok) return makeHookResult({ hook_type: hook.type, success: true, output: text })
    return makeHookResult({
      hook_type: hook.type,
      success: false,
      output: text,
      blocked: hook.block_on_failure,
      reason: parsed.reason ?? 'hook rejected the event',
    })
  }
}

function extractMessageText(event: ApiMessageCompleteEvent): string {
  const parts: string[] = []
  for (const block of event.message.content) {
    if (block.type === 'text') parts.push(block.text)
  }
  return parts.join('')
}

function matchesHook(hook: HookDefinition, payload: HookPayload): boolean {
  const matcher = hook.matcher
  if (!matcher) return true
  const subject = String(payload.tool_name ?? payload.prompt ?? payload.event ?? '')
  return fnmatch(subject, matcher)
}

function injectArguments(template: string, payload: HookPayload, shellEscapeValue: boolean): string {
  const serialized = JSON.stringify(payload)
  const value = shellEscapeValue ? shellEscape(serialized) : serialized
  return template.split('$ARGUMENTS').join(value)
}

function parseHookJson(text: string): { ok: true } | { ok: false; reason?: string } {
  try {
    const parsed = JSON.parse(text) as unknown
    if (parsed && typeof parsed === 'object' && 'ok' in parsed) {
      const okField = (parsed as { ok: unknown }).ok
      if (okField === true) return { ok: true }
      if (okField === false) {
        const reasonField = (parsed as { reason?: unknown }).reason
        const reason = typeof reasonField === 'string' ? reasonField : undefined
        return reason !== undefined ? { ok: false, reason } : { ok: false }
      }
    }
  } catch {
    // fall through
  }
  const lowered = text.trim().toLowerCase()
  if (lowered === 'ok' || lowered === 'true' || lowered === 'yes') return { ok: true }
  const trimmed = text.trim()
  return { ok: false, reason: trimmed || 'hook returned invalid JSON' }
}

export function shellEscape(arg: string): string {
  if (arg.length === 0) return "''"
  if (/^[a-zA-Z0-9@%+=:,./_-]+$/.test(arg)) return arg
  return "'" + arg.split("'").join(`'"'"'`) + "'"
}

export function fnmatch(subject: string, pattern: string): boolean {
  const regex = new RegExp('^' + globToRegex(pattern) + '$')
  return regex.test(subject)
}

function globToRegex(pattern: string): string {
  let out = ''
  let i = 0
  while (i < pattern.length) {
    const ch = pattern[i]!
    if (ch === '*') out += '.*'
    else if (ch === '?') out += '.'
    else if (ch === '[') {
      const end = pattern.indexOf(']', i + 1)
      if (end === -1) {
        out += '\\['
      } else {
        let cls = pattern.slice(i + 1, end)
        if (cls.startsWith('!')) cls = '^' + cls.slice(1)
        out += '[' + cls + ']'
        i = end
      }
    } else if (/[.+^$()|{}\\]/.test(ch)) out += '\\' + ch
    else out += ch
    i += 1
  }
  return out
}

function runShellCommand(
  command: string,
  opts: { cwd: string; env: Record<string, string>; timeoutMs: number },
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('sh', ['-c', command], { cwd: opts.cwd, env: opts.env })
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGKILL')
      reject(new Error('__timeout__'))
    }, opts.timeoutMs)

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    child.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ exitCode: code ?? 0, stdout, stderr })
    })
  })
}
