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
  ContentBlock,
  ConversationMessage,
  ToolResultBlock,
  ToolUseBlock,
  UsageSnapshot,
} from '@guildhall/protocol'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import {
  emptyUsage,
  isEffectivelyEmpty,
  messageText,
  messageToolUses,
  userMessageFromText,
  type StreamEvent,
} from '@guildhall/protocol'

import type { ApiMessageRequest, ApiStreamEvent, SupportsStreamingMessages } from './client.js'
import { HookEvent, type HookExecutor } from './hooks.js'
import { PermissionChecker } from './permissions.js'
import { recordToolCarryover } from './tool-carryover.js'
import type { AnyTool, ToolExecutionContext, ToolRegistry } from './tools.js'
import { parseAuthoritativeCommands, reconcileShellCommandWithAuthority } from '@guildhall/core'
import {
  getProjectLocalHistoryDir,
  getProjectStateDir,
} from '@guildhall/sessions'

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

const PROJECT_DECISION_TOOLS = new Set([
  'log-decision',
])

const PROJECT_MEMORY_TOOLS = new Set([
  'write-checkpoint',
])

function parseObjectString(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string') return null
  try {
    const parsed = JSON.parse(value)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // Leave malformed text alone so schema validation can report the real issue.
  }
  return null
}

function currentTaskDomain(
  toolMetadata: Record<string, unknown> | undefined,
): string {
  return String(
    toolMetadata?.['current_task_domain'] ??
    toolMetadata?.['current_domain'] ??
    '',
  ).trim()
}

function normalizeLogDecisionInput(
  rawInput: Record<string, unknown>,
  toolMetadata: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const next = { ...rawInput }
  const parsedEntry = parseObjectString(next['entry'])
  if (parsedEntry) next['entry'] = parsedEntry
  const hydratedEntry = next['entry']
  if (hydratedEntry && typeof hydratedEntry === 'object' && !Array.isArray(hydratedEntry)) {
    const record = { ...(hydratedEntry as Record<string, unknown>) }
    if (typeof record['id'] !== 'string' || record['id'].trim().length === 0) {
      const taskId = currentTaskId(toolMetadata)
      const agentId = currentAgentId(toolMetadata) || 'coordinator'
      const timestamp = new Date().toISOString()
      record['id'] = taskId ? `${agentId}:${taskId}:${timestamp}` : `${agentId}:${timestamp}`
    }
    if (typeof record['timestamp'] !== 'string' || record['timestamp'].trim().length === 0) {
      record['timestamp'] = new Date().toISOString()
    }
    if (typeof record['agentId'] !== 'string' || record['agentId'].trim().length === 0) {
      const agentId = currentAgentId(toolMetadata)
      if (agentId) record['agentId'] = agentId
    }
    if (typeof record['taskId'] !== 'string' || record['taskId'].trim().length === 0) {
      const taskId = currentTaskId(toolMetadata)
      if (taskId) record['taskId'] = taskId
    }
    if (typeof record['domain'] !== 'string' || record['domain'].trim().length === 0) {
      const rawDomain = currentTaskDomain(toolMetadata)
      if (rawDomain) record['domain'] = rawDomain
    }
    if (typeof record['title'] !== 'string' || record['title'].trim().length === 0) {
      const taskTitle = String(toolMetadata?.['current_task_title'] ?? '').trim()
      if (taskTitle) record['title'] = `Coordinator decision for ${taskTitle}`
    }
    if (typeof record['context'] !== 'string' || record['context'].trim().length === 0) {
      const taskTitle = String(toolMetadata?.['current_task_title'] ?? '').trim()
      const taskId = currentTaskId(toolMetadata)
      const contextParts = [
        taskTitle ? `Task: ${taskTitle}` : '',
        taskId ? `Task id: ${taskId}` : '',
      ].filter(Boolean)
      if (contextParts.length > 0) record['context'] = contextParts.join(' | ')
    }
    next['entry'] = record
  }
  return next
}

function normalizeLogProgressInput(
  rawInput: Record<string, unknown>,
  toolMetadata: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const next = { ...rawInput }
  const parsedEntry = parseObjectString(next['entry'])
  if (parsedEntry) next['entry'] = parsedEntry
  const hydratedEntry = next['entry']
  if (hydratedEntry && typeof hydratedEntry === 'object' && !Array.isArray(hydratedEntry)) {
    const record = { ...(hydratedEntry as Record<string, unknown>) }
    if (typeof record['timestamp'] !== 'string' || record['timestamp'].trim().length === 0) {
      record['timestamp'] = new Date().toISOString()
    }
    if (typeof record['agentId'] !== 'string' || record['agentId'].trim().length === 0) {
      const agentId = currentAgentId(toolMetadata)
      if (agentId) record['agentId'] = agentId
    }
    if (typeof record['taskId'] !== 'string' || record['taskId'].trim().length === 0) {
      const taskId = currentTaskId(toolMetadata)
      if (taskId) record['taskId'] = taskId
    }
    if (typeof record['domain'] !== 'string' || record['domain'].trim().length === 0) {
      const domain = currentTaskDomain(toolMetadata)
      if (domain) record['domain'] = domain
    }
    next['entry'] = record
  }
  return next
}

function normalizeRaiseEscalationInput(
  rawInput: Record<string, unknown>,
  toolMetadata: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const next = { ...rawInput }
  if (typeof next['taskId'] !== 'string' || next['taskId'].trim().length === 0) {
    const taskId = currentTaskId(toolMetadata)
    if (taskId) next['taskId'] = taskId
  }
  if (typeof next['agentId'] !== 'string' || next['agentId'].trim().length === 0) {
    const agentId = currentAgentId(toolMetadata)
    if (agentId) next['agentId'] = agentId
  }
  if (next['details'] && typeof next['details'] !== 'string') {
    try {
      next['details'] = JSON.stringify(next['details'], null, 2)
    } catch {
      // Leave unstringifiable detail payloads alone for schema validation.
    }
  }
  return next
}

function hydrateProjectToolInput(
  toolName: string,
  cwd: string,
  rawInput: Record<string, unknown>,
  toolMetadata?: Record<string, unknown>,
): Record<string, unknown> {
  let next = { ...rawInput }
  const projectStateDir = getProjectStateDir(cwd)
  if (PROJECT_TASK_TOOLS.has(toolName)) {
    next.tasksPath = join(projectStateDir, 'TASKS.json')
  }
  if (PROJECT_PROGRESS_TOOLS.has(toolName)) {
    next.progressPath = join(projectStateDir, 'PROGRESS.md')
    if (toolName === 'log-progress') {
      next = normalizeLogProgressInput(next, toolMetadata)
    }
  }
  if (PROJECT_DECISION_TOOLS.has(toolName)) {
    next.decisionsPath = join(projectStateDir, 'DECISIONS.md')
    next = normalizeLogDecisionInput(next, toolMetadata)
  }
  if (toolName === 'raise-escalation') {
    next = normalizeRaiseEscalationInput(next, toolMetadata)
  }
  if (PROJECT_MEMORY_TOOLS.has(toolName)) {
    next.memoryDir = getProjectLocalHistoryDir(cwd)
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
  temperature?: number
  promptCacheKey?: string
  apiRequestOptions?: Pick<
    ApiMessageRequest,
    'response_format' | 'reasoning_effort' | 'reasoning' | 'tool_choice'
  >
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

function isReadOnlyToolCall(context: QueryContext, toolName: string, input: Record<string, unknown>): boolean {
  const tool = context.toolRegistry.get(toolName)
  if (!tool) return false
  try {
    return tool.isReadOnly(input)
  } catch {
    return false
  }
}

function likelyTargetFilesFromMetadata(
  toolMetadata: Record<string, unknown> | undefined,
): string[] {
  const raw = toolMetadata?.['current_task_likely_target_files']
  if (!Array.isArray(raw)) return []
  return raw.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
}

function readFileNotFoundPath(resultContent: string): string | null {
  const match = resultContent.match(/^\(file not found: (.+)\)$/)
  return match?.[1]?.trim() ?? null
}

function missingLikelyTargetFile(
  toolMetadata: Record<string, unknown> | undefined,
): string {
  return String(toolMetadata?.['current_missing_likely_target_file'] ?? '').trim()
}

function currentAgentId(
  toolMetadata: Record<string, unknown> | undefined,
): string {
  return String(toolMetadata?.['current_agent_id'] ?? '').trim()
}

function strictLikelyTargetMutationGuardsEnabled(
  toolMetadata: Record<string, unknown> | undefined,
): boolean {
  const agentId = currentAgentId(toolMetadata)
  return agentId === '' || agentId === 'worker-agent'
}

function latestCheckpointNextAction(
  toolMetadata: Record<string, unknown> | undefined,
): string {
  return String(toolMetadata?.['current_task_checkpoint_next_action'] ?? '').trim()
}

function currentTaskId(
  toolMetadata: Record<string, unknown> | undefined,
): string {
  return String(toolMetadata?.['current_task_id'] ?? '').trim()
}

function currentTaskLaneHandoffCompleted(
  toolMetadata: Record<string, unknown> | undefined,
): boolean {
  return toolMetadata?.['current_task_lane_handoff_completed'] === true
}

function hasStructuredSelfCritiqueInMetadata(
  toolMetadata: Record<string, unknown> | undefined,
): boolean {
  return toolMetadata?.['current_task_has_review_proof_packet'] === true
}

function looksLikeStructuredSelfCritiqueContent(content: string): boolean {
  const normalized = content.trim()
  if (!/\*\*self-critique:\*\*/i.test(normalized) && !/^self-critique:/im.test(normalized)) {
    return false
  }
  const hasAcceptanceCoverage =
    /for each acceptance criterion:/i.test(normalized) ||
    /(?:^|\n)\s*(?:-\s*)?(?:\[[^\]]+\]|ac-\d+)(?:\s*\([^)\n]+\))?\s*:\s*(met|not met)\b/im.test(normalized)
  const hasMinimumScope =
    /(?:^|\n)\s*(?:\*\*)?-?\s*(?:minimum|minimal|mini)-scope check:\s*(?:\*\*)?/i.test(normalized)
  const hasProofPacket =
    /(?:^|\n)\s*(?:#{2,3}\s*)?(?:\*\*)?\s*review proof packet\s*:?\s*(?:\*\*)?/i.test(normalized)
  const hasVerificationProof =
    /\bverification(?: command| commands| result| results)?\b/i.test(normalized) &&
    /\b(pass|passed|green|succeed|succeeded)\b/i.test(normalized)
  const hasDiffScope =
    /\b(?:changed files|files changed|diff scope|scope of changes)\b/i.test(normalized)
  return hasAcceptanceCoverage && hasMinimumScope && hasProofPacket && hasVerificationProof && hasDiffScope
}

function structuredSelfCritiqueFromUpdateTaskInput(
  input: Record<string, unknown>,
): string {
  const note = input['note']
  if (!note || typeof note !== 'object' || Array.isArray(note)) return ''
  const rec = note as Record<string, unknown>
  const content = typeof rec['content'] === 'string' ? rec['content'].trim() : ''
  return looksLikeStructuredSelfCritiqueContent(content) ? content : ''
}

function checkpointFilesTouched(
  toolMetadata: Record<string, unknown> | undefined,
): string[] {
  const raw = toolMetadata?.['current_task_checkpoint_files_touched']
  if (!Array.isArray(raw)) return []
  return raw.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
}

function checkpointSafeMutationSurface(
  toolMetadata: Record<string, unknown> | undefined,
): string[] {
  const raw = toolMetadata?.['current_task_checkpoint_safe_mutation_surface']
  if (!Array.isArray(raw)) return []
  return raw.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
}

type VerificationHistoryEntry = {
  command: string
  passed: boolean
  observedAt: string
  summary?: string
}

function verificationHistory(
  toolMetadata: Record<string, unknown> | undefined | null,
): VerificationHistoryEntry[] {
  if (!toolMetadata) return []
  const raw = toolMetadata['current_task_verification_history']
  if (!Array.isArray(raw)) {
    const replacement: VerificationHistoryEntry[] = []
    toolMetadata['current_task_verification_history'] = replacement
    return replacement
  }
  return raw.filter((entry): entry is VerificationHistoryEntry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false
    const rec = entry as Record<string, unknown>
    return (
      typeof rec['command'] === 'string' &&
      typeof rec['passed'] === 'boolean' &&
      typeof rec['observedAt'] === 'string'
    )
  })
}

function latestFailedVerificationCommand(
  toolMetadata: Record<string, unknown> | undefined | null,
): string | null {
  const latestFailure = verificationHistory(toolMetadata)
    .filter((entry) => entry.passed === false && entry.command.trim().length > 0)
    .sort((left, right) => right.observedAt.localeCompare(left.observedAt))[0]
  return latestFailure?.command?.trim() || null
}

function rememberVerificationResult(
  toolMetadata: Record<string, unknown> | undefined,
  params: {
    shellCommand: string
    shellOutput: string
    shellSucceeded: boolean
    authoritativeCommands: readonly string[]
    usedAuthoritativeCommand: boolean
  },
): void {
  if (!toolMetadata) return
  const command = params.shellCommand.trim()
  if (!command) return
  const authoritative = Array.from(
    new Set(params.authoritativeCommands.map((value) => value.trim()).filter(Boolean)),
  )
  const shouldTrack =
    params.usedAuthoritativeCommand ||
    authoritative.some((candidate) => candidate === command)
  if (!shouldTrack) return

  const outputFirstLine = params.shellOutput.trim().split('\n')[0]?.trim() ?? ''
  const bucket = verificationHistory(toolMetadata)
  const nextEntry: VerificationHistoryEntry = {
    command,
    passed: params.shellSucceeded,
    observedAt: new Date().toISOString(),
    ...(outputFirstLine ? { summary: outputFirstLine.slice(0, 240) } : {}),
  }
  const filtered = bucket.filter((entry) => entry.command !== command)
  filtered.push(nextEntry)
  if (filtered.length > 6) filtered.splice(0, filtered.length - 6)
  toolMetadata['current_task_verification_history'] = filtered
}

function taskRootCandidates(
  toolMetadata: Record<string, unknown> | undefined,
): string[] {
  const roots = [
    String(toolMetadata?.['current_task_worktree_path'] ?? '').trim(),
    String(toolMetadata?.['current_task_project_path'] ?? '').trim(),
  ].filter((value): value is string => value.length > 0)
  return [...new Set(roots.map((root) => resolve(root)))]
}

function isCodeLikeTaskFile(filePath: string): boolean {
  return /\.(?:ts|tsx|js|jsx|vue)$/i.test(filePath)
}

function resolveTaskFilePath(
  candidate: string,
  roots: readonly string[],
): string | null {
  const trimmed = candidate.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('/')) return existsSync(trimmed) ? resolve(trimmed) : resolve(trimmed)
  for (const root of roots) {
    const rooted = resolve(root, trimmed)
    if (existsSync(rooted)) return rooted
  }
  return roots.length > 0 ? resolve(roots[0]!, trimmed) : resolve(trimmed)
}

function importCandidatesForPath(resolvedPath: string): string[] {
  const out = new Set<string>()
  out.add(resolvedPath)
  if (!/\.[A-Za-z0-9]+$/.test(resolvedPath)) {
    for (const ext of ['.ts', '.tsx', '.js', '.jsx', '.vue']) {
      out.add(`${resolvedPath}${ext}`)
    }
    for (const ext of ['.ts', '.tsx', '.js', '.jsx', '.vue']) {
      out.add(join(resolvedPath, `index${ext}`))
    }
  }
  return [...out]
}

function appAliasBaseForSourceFile(
  sourceFile: string,
  roots: readonly string[],
): string | null {
  const normalized = sourceFile.replace(/\\/g, '/')
  for (const root of roots) {
    const normalizedRoot = resolve(root).replace(/\\/g, '/')
    for (const suffix of ['/web/app/', '/app/']) {
      const prefix = `${normalizedRoot}${suffix}`
      if (normalized.startsWith(prefix)) return prefix.slice(0, -1)
    }
  }
  const webAppIdx = normalized.lastIndexOf('/web/app/')
  if (webAppIdx >= 0) return normalized.slice(0, webAppIdx + '/web/app'.length)
  const appIdx = normalized.lastIndexOf('/app/')
  if (appIdx >= 0) return normalized.slice(0, appIdx + '/app'.length)
  return null
}

function resolveLocalImportPath(
  sourceFile: string,
  importPath: string,
  roots: readonly string[],
): string | null {
  if (importPath.startsWith('./') || importPath.startsWith('../')) {
    return resolve(dirname(sourceFile), importPath)
  }
  if (importPath.startsWith('@/') || importPath.startsWith('~/')) {
    const aliasBase = appAliasBaseForSourceFile(sourceFile, roots)
    if (!aliasBase) return null
    return resolve(aliasBase, importPath.slice(2))
  }
  return null
}

interface MissingLocalImportEvidence {
  sourceFile: string
  importPath: string
  expectedPath: string
}

function missingLocalImportEvidence(
  toolMetadata: Record<string, unknown> | undefined,
): MissingLocalImportEvidence | null {
  const roots = taskRootCandidates(toolMetadata)
  const candidateFiles = [
    ...checkpointFilesTouched(toolMetadata),
    ...likelyTargetFilesFromMetadata(toolMetadata),
  ]
    .map((candidate) => resolveTaskFilePath(candidate, roots))
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .filter((value) => isCodeLikeTaskFile(value))
  const sourceFiles = [...new Set(candidateFiles)].filter((filePath) => existsSync(filePath))
  const importRe = /(?:import|export)\s+(?:[^'"]+?\s+from\s+)?["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g
  for (const sourceFile of sourceFiles) {
    let content = ''
    try {
      content = readFileSync(sourceFile, 'utf8')
    } catch {
      continue
    }
    for (const match of content.matchAll(importRe)) {
      const importPath = (match[1] ?? match[2] ?? '').trim()
      if (!importPath) continue
      const resolvedImport = resolveLocalImportPath(sourceFile, importPath, roots)
      if (!resolvedImport) continue
      const candidates = importCandidatesForPath(resolvedImport)
      if (candidates.some((candidate) => existsSync(candidate))) continue
      return {
        sourceFile,
        importPath,
        expectedPath: candidates[0]!,
      }
    }
  }
  return null
}

function ownedTaskStatusForAgent(agentId: string): string | null {
  switch (agentId) {
    case 'worker-agent':
      return 'in_progress'
    case 'reviewer-agent':
      return 'review'
    case 'gate-checker-agent':
      return 'gate_check'
    default:
      return null
  }
}

function isLaneExitStatus(agentId: string, status: string): boolean {
  const ownedStatus = ownedTaskStatusForAgent(agentId)
  return ownedStatus !== null && status.trim() !== '' && status !== ownedStatus
}

function looksExploratoryCheckpointAction(text: string): boolean {
  const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim()
  if (!normalized) return false
  if (
    [
      /\bself-critique\b/,
      /\bhandoff\b/,
      /\bset\b.*\bstatus\b.*\breview\b/,
      /\bmove .* to review\b/,
      /\btransition .* to review\b/,
      /\bstatus .* review\b/,
      /\bpersist\b.*\bnote\b/,
      /\bwrite or refresh\b.*\bself-critique\b/,
    ].some((pattern) => pattern.test(normalized))
  ) {
    return false
  }
  return [
    /\bsearch\b/,
    /\binspect\b/,
    /\breview\b/,
    /\blook for\b/,
    /\bscan\b/,
    /\btrace\b/,
    /\baudit\b/,
    /\bidentify\b/,
    /\bcheck for\b/,
    /\bconfirm\b/,
    /\bverify\b.*\bwhere\b/,
  ].some((pattern) => pattern.test(normalized))
}

function looksLikeHandoffCheckpointAction(text: string): boolean {
  const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim()
  if (!normalized) return false
  if (
    [
      /\brerun the focused verification commands\b/,
      /\brefresh focused verification\b/,
      /\bfix whatever still fails\b/,
      /\bkeep (?:the )?task in implementation\b/,
      /\bfocused checks are green\b/,
    ].some((pattern) => pattern.test(normalized))
  ) {
    return false
  }
  return [
    /\bself-critique\b/,
    /\bhandoff\b/,
    /\bset\b.*\bstatus\b.*\breview\b/,
    /\bmove .* to review\b/,
    /\btransition .* to review\b/,
    /\bstatus .* review\b/,
    /\bpersist\b.*\bnote\b/,
  ].some((pattern) => pattern.test(normalized))
}

function isCheckpointScopedReadOnlyToolCall(
  cwd: string,
  toolMetadata: Record<string, unknown> | undefined,
  toolCall: ToolUseBlock,
  checkpointTouched: readonly string[],
): boolean {
  if (toolCall.name !== 'read-file') return false
  const filePath = String((toolCall.input as Record<string, unknown>)?.filePath ?? '').trim()
  if (filePath.length === 0) return false
  const normalizedInputPath = resolve(cwd, filePath)
  const candidateBases = [
    String(toolMetadata?.['current_task_worktree_path'] ?? '').trim(),
    String(toolMetadata?.['current_task_project_path'] ?? '').trim(),
    cwd,
  ].filter((value): value is string => value.length > 0)
  const normalizedTouched = checkpointTouched.flatMap((candidate) =>
    candidateBases.map((base) => resolve(base, candidate)),
  )
  return normalizedTouched.includes(normalizedInputPath)
}

function isLikelyTargetScopedReadOnlyToolCall(
  cwd: string,
  toolCall: ToolUseBlock,
  likelyTargetFiles: readonly string[],
): boolean {
  if (toolCall.name !== 'read-file') return false
  const filePath = String((toolCall.input as Record<string, unknown>)?.filePath ?? '').trim()
  if (filePath.length === 0) return false
  const normalizedInputPath = resolve(cwd, filePath)
  const normalizedTargets = likelyTargetFiles
    .map((candidate) => candidate.trim())
    .filter(Boolean)
    .map((candidate) => resolve(cwd, candidate))
  return normalizedTargets.includes(normalizedInputPath)
}

function isVerificationEvidenceSupportReadOnlyToolCall(
  cwd: string,
  toolMetadata: Record<string, unknown> | undefined,
  toolCall: ToolUseBlock,
  likelyTargetFiles: readonly string[],
  checkpointTouched: readonly string[],
): boolean {
  if (toolCall.name !== 'read-file') return false
  const filePath = String((toolCall.input as Record<string, unknown>)?.filePath ?? '').trim()
  if (filePath.length === 0) return false
  const normalizedInputPath = resolve(cwd, filePath)

  if (isLikelyTargetScopedReadOnlyToolCall(cwd, toolCall, likelyTargetFiles)) {
    return !isCheckpointScopedReadOnlyToolCall(cwd, toolMetadata, toolCall, checkpointTouched)
  }

  const companionRoots = verificationEvidenceCompanionRoots(cwd, likelyTargetFiles)
  if (companionRoots.length === 0) return false
  if (isCheckpointScopedReadOnlyToolCall(cwd, toolMetadata, toolCall, checkpointTouched)) return false
  if (!/\.(?:[cm]?[jt]sx?|vue)$/i.test(normalizedInputPath)) return false

  return companionRoots.some((root) =>
    normalizedInputPath === root ||
    normalizedInputPath.startsWith(root.endsWith(sep) ? root : `${root}${sep}`),
  )
}

function verificationEvidenceCompanionRoots(
  cwd: string,
  likelyTargetFiles: readonly string[],
): string[] {
  const roots = new Set<string>()
  for (const candidate of likelyTargetFiles) {
    const trimmed = candidate.trim()
    if (!trimmed) continue
    const normalized = resolve(cwd, trimmed)
    const parsed = normalized.split(sep).filter(Boolean)
    const sourceBoundaryIndex = parsed.findIndex((segment) =>
      segment === 'src' || segment === 'test' || segment === 'tests',
    )
    if (sourceBoundaryIndex >= 0) {
      const prefix = `${normalized.startsWith(sep) ? sep : ''}${parsed.slice(0, sourceBoundaryIndex + 1).join(sep)}`
      roots.add(prefix)
      continue
    }
    roots.add(dirname(normalized))
  }
  return [...roots]
}

function noProgressStatusMessage(
  toolMetadata: Record<string, unknown> | undefined,
): string {
  switch (currentAgentId(toolMetadata)) {
    case 'worker-agent':
      return 'Assistant kept using non-durable steps without moving the implementation forward; asking it to mutate, verify, checkpoint, or escalate now.'
    case 'reviewer-agent':
      return 'Assistant kept exploring without recording a durable review outcome; asking it to record a verdict, checkpoint, or escalation now.'
    case 'gate-checker-agent':
      return 'Assistant kept exploring without recording a durable gate outcome; asking it to run gates, record the result, or escalate now.'
    default:
      return 'Assistant kept researching without recording durable progress; asking it to write the brief, question, spec, or escalation now.'
  }
}

interface ReadFileStateEntry {
  path?: unknown
  preview?: unknown
}

function recentReadFileHints(
  toolMetadata: Record<string, unknown> | undefined,
): Array<{ path: string; preview: string }> {
  const raw = toolMetadata?.['read_file_state']
  if (!Array.isArray(raw)) return []
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null
      const record = entry as ReadFileStateEntry
      const path = String(record.path ?? '').trim()
      const preview = String(record.preview ?? '').trim()
      if (!path) return null
      return { path, preview }
    })
    .filter((entry): entry is { path: string; preview: string } => entry !== null)
    .slice(-3)
}

function inspectedLikelyTargetFile(
  toolMetadata: Record<string, unknown> | undefined,
): string {
  const likelyTargets = new Set(likelyTargetFilesFromMetadata(toolMetadata))
  if (likelyTargets.size === 0) return ''
  const hints = recentReadFileHints(toolMetadata)
  for (let i = hints.length - 1; i >= 0; i -= 1) {
    const candidate = hints[i]?.path ?? ''
    if (candidate && likelyTargets.has(candidate)) return candidate
  }
  return ''
}

function uninspectedLikelyTargetReadAllowed(input: {
  cwd: string
  toolMetadata: Record<string, unknown> | undefined
  toolCalls: readonly ToolUseBlock[]
  likelyTargetFiles: readonly string[]
}): boolean {
  if (input.toolCalls.length !== 1) return false
  const toolCall = input.toolCalls[0]!
  if (!isLikelyTargetScopedReadOnlyToolCall(input.cwd, toolCall, input.likelyTargetFiles)) {
    return false
  }
  const filePath = String((toolCall.input as Record<string, unknown>)?.filePath ?? '').trim()
  if (!filePath) return false
  const normalizedRequested = resolve(input.cwd, filePath)
  const inspected = new Set(
    recentReadFileHints(input.toolMetadata).map((hint) => resolve(input.cwd, hint.path)),
  )
  return !inspected.has(normalizedRequested)
}

function likelyTargetMutationDirective(input: {
  likelyTargetFiles: readonly string[]
  inspectedLikelyTarget: string
}): string {
  const distinct = Array.from(
    new Set(input.likelyTargetFiles.map((file) => file.trim()).filter(Boolean)),
  )
  const preferred = input.inspectedLikelyTarget.trim()
  if (preferred && distinct.includes(preferred)) {
    const others = distinct.filter((file) => file !== preferred)
    if (others.length > 0) {
      return `Either mutate ${preferred}, mutate another authoritative likely target file (${others.join(', ')}), or run a focused verification command tied to the file you just changed.`
    }
    return `Either mutate ${preferred} or run a focused verification command tied to the file you just changed.`
  }
  if (distinct.length > 1) {
    return `Mutate one of the authoritative likely target files (${distinct.join(', ')}), or run a focused verification command tied to the file you just changed.`
  }
  if (distinct.length === 1) {
    return `Either mutate ${distinct[0]} or run a focused verification command tied to the file you just changed.`
  }
  return 'Mutate an authoritative likely target file or run a focused verification command tied to the file you just changed.'
}

function strictMutationOrEscalationNudge(input: {
  missingLikelyTarget: string
  inspectedLikelyTarget: string
  likelyTargetFiles: readonly string[]
}): string | null {
  if (input.missingLikelyTarget.length > 0) {
    return [
      `You already know the exact target file is missing at ${input.missingLikelyTarget}.`,
      'Your very next response must be exactly one tool call and no prose.',
      `Either call write-file with { filePath: "${input.missingLikelyTarget}", content: "..." } to create it,`,
      'or call raise-escalation if you still cannot safely author the file contents.',
    ].join(' ')
  }
  if (input.inspectedLikelyTarget.length > 0) {
    return [
      `You already inspected an authoritative likely target file at ${input.inspectedLikelyTarget}.`,
      'Your very next response must be exactly one tool call and no prose.',
      likelyTargetMutationDirective(input),
      'or call raise-escalation if you still cannot proceed safely.',
    ].join(' ')
  }
  return null
}

function strictCheckpointFollowThroughNudge(input: {
  checkpointNextAction: string
  checkpointTouched: readonly string[]
}): string | null {
  const targets = input.checkpointTouched.map((file) => file.trim()).filter(Boolean)
  if (targets.length === 0) return null
  const exactTarget = targets[0]!
  const alternateTargets = targets.slice(1)
  return [
    `The latest checkpoint already told you what to do next: ${input.checkpointNextAction}.`,
    'Your very next response must be exactly one tool call and no prose.',
    `Call read-file with { filePath: "${exactTarget}" } first.`,
    alternateTargets.length > 0
      ? `If that file is no longer the right surface, use read-file on one of these checkpoint-touched files instead: ${alternateTargets.join(', ')}.`
      : '',
    'If none of those files are the right next step anymore, call raise-escalation and explain why the checkpoint is no longer valid.',
  ].filter(Boolean).join(' ')
}

function strictCheckpointHandoffNudge(input: {
  checkpointNextAction: string
  taskId: string
  hasStructuredSelfCritique: boolean
}): string | null {
  if (!input.taskId.trim()) return null
  const normalized = input.checkpointNextAction.toLowerCase().replace(/\s+/g, ' ').trim()
  if (
    /\bset\b.*\bstatus\b.*\breview\b/.test(normalized) ||
    /\btransition\b.*\breview\b/.test(normalized) ||
    /\bmove\b.*\breview\b/.test(normalized)
  ) {
    if (!input.hasStructuredSelfCritique) {
      return [
        `The latest checkpoint already told you what to do next: ${input.checkpointNextAction}.`,
        'Your very next response must be exactly one tool call and no prose.',
        `Call update-task with { taskId: "${input.taskId}", status: "review", note: { agentId: "worker-agent", role: "self-critique", content: "**Self-critique:** ..." } } now.`,
        'The note must cover each acceptance criterion and include the minimum-scope check before the review handoff.',
        'If the checkpoint is no longer valid, call raise-escalation instead.',
      ].join(' ')
    }
    return [
      `The latest checkpoint already told you what to do next: ${input.checkpointNextAction}.`,
      'Your very next response must be exactly one tool call and no prose.',
      `Call update-task with { taskId: "${input.taskId}", status: "review" } now.`,
      'Do not write another checkpoint first unless the handoff is no longer valid.',
      'If the checkpoint is no longer valid, call raise-escalation instead.',
    ].join(' ')
  }
  return [
    `The latest checkpoint already told you what to do next: ${input.checkpointNextAction}.`,
    'Your very next response must be exactly one tool call and no prose.',
    `Call update-task with { taskId: "${input.taskId}", status: "in_progress", note: { agentId: "worker-agent", role: "self-critique", content: "**Self-critique:** ..." } } to persist the self-critique note first.`,
    `After that note exists, you can transition task ${input.taskId} to review.`,
    'If the checkpoint is no longer valid, call raise-escalation instead.',
  ].join(' ')
}

function strictCheckpointMutationNudge(input: {
  checkpointNextAction: string
  checkpointTouched: readonly string[]
  checkpointSafeMutationSurface?: readonly string[]
  authoritativeVerificationCommands?: readonly string[]
  preferredVerificationCommand?: string | null
}): string | null {
  const preferredTargets = (input.checkpointSafeMutationSurface ?? [])
    .map((file) => file.trim())
    .filter(Boolean)
  const fallbackTargets = input.checkpointTouched.map((file) => file.trim()).filter(Boolean)
  const targets = preferredTargets.length > 0 ? preferredTargets : fallbackTargets
  if (targets.length === 0) return null
  const exactTarget = targets[0]!
  const alternateTargets = targets.slice(1)
  const authoritativeCommands = Array.from(
    new Set((input.authoritativeVerificationCommands ?? []).map((command) => command.trim()).filter(Boolean)),
  )
  const preferredVerificationCommand = input.preferredVerificationCommand?.trim() || null
  const checkpointStillNeedsVerificationFirst =
    /rerun the focused verification commands|refresh focused verification/i.test(input.checkpointNextAction)
  const verificationFirstDirective =
    authoritativeCommands.length > 0 && checkpointStillNeedsVerificationFirst
      ? [
          preferredVerificationCommand && authoritativeCommands.includes(preferredVerificationCommand)
            ? `If you are rerunning verification first, call shell with the last failing authoritative command first:\n- ${preferredVerificationCommand}`
            : `If you are rerunning verification first, call shell with exactly one of these authoritative commands:\n${authoritativeCommands.map((command) => `- ${command}`).join('\n')}`,
          targets.length > 0
            ? `Only if one of those commands already ran in this turn and still failed should you mutate one of these checkpoint-touched files: ${targets.join(', ')}.`
            : '',
        ].filter(Boolean)
      : []
  return [
    `The latest checkpoint already told you what to do next: ${input.checkpointNextAction}.`,
    'Your very next response must be exactly one tool call and no prose.',
    ...verificationFirstDirective,
    (authoritativeCommands.length === 0 || !checkpointStillNeedsVerificationFirst)
      ? `Call edit-file on ${exactTarget} now, or call write-file if rewriting the full file is simpler.`
      : '',
    (authoritativeCommands.length === 0 || !checkpointStillNeedsVerificationFirst) && alternateTargets.length > 0
      ? `If ${exactTarget} is no longer the right surface, mutate one of these checkpoint-touched files instead: ${alternateTargets.join(', ')}.`
      : '',
    'If none of those files are the right next step anymore, call raise-escalation and explain why the checkpoint is no longer valid.',
  ].filter(Boolean).join(' ')
}

function strictCheckpointShellNudge(input: {
  checkpointNextAction: string
  authoritativeVerificationCommands: readonly string[]
  checkpointTouched: readonly string[]
  checkpointSafeMutationSurface?: readonly string[]
  preferredVerificationCommand?: string | null
}): string | null {
  const authoritativeCommands = Array.from(
    new Set(input.authoritativeVerificationCommands.map((command) => command.trim()).filter(Boolean)),
  )
  if (authoritativeCommands.length === 0) return null
  const mutationNudge = strictCheckpointMutationNudge({
    checkpointNextAction: input.checkpointNextAction,
    checkpointTouched: input.checkpointTouched,
    checkpointSafeMutationSurface: input.checkpointSafeMutationSurface,
    authoritativeVerificationCommands: authoritativeCommands,
    preferredVerificationCommand: input.preferredVerificationCommand,
  })
  return [
    `The latest checkpoint already told you what to do next: ${input.checkpointNextAction}.`,
    'Your very next response must be exactly one tool call and no prose.',
    `If you use shell here, it must be exactly one of these authoritative verification commands:\n${authoritativeCommands.map((command) => `- ${command}`).join('\n')}`,
    'Do not invent an ad hoc reproduction or debugging shell command in this checkpointed lane.',
    mutationNudge ?? 'Otherwise mutate the focused checkpoint file now, or raise-escalation if the checkpoint is no longer valid.',
  ].filter(Boolean).join(' ')
}

function looksLikeReviewReadyHandoff(text: string): boolean {
  const lower = text.toLowerCase()
  const hasReviewLanguage =
    lower.includes('review') ||
    lower.includes('handoff') ||
    lower.includes('verified') ||
    lower.includes('what’s done') ||
    lower.includes("what's done")
  const hasCompletionShape =
    lower.includes('implemented') ||
    lower.includes('done') ||
    lower.includes('evidence') ||
    lower.includes('checkpoint') ||
    lower.includes('next turn')
  return hasReviewLanguage && hasCompletionShape
}

function looksLikeFutureStepNarration(text: string): boolean {
  const normalized = text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
  if (!normalized) return false
  const futureStepSignals = [
    /\bi['’]ll\b/,
    /\bi will\b/,
    /\bi'm going to\b/,
    /\bi am going to\b/,
    /\bnext i['’]ll\b/,
    /\bnext i will\b/,
    /\bthen i['’]ll\b/,
    /\bthen i will\b/,
    /\bonce you (?:pick|answer|confirm)\b/,
  ]
  const planningActionSignals = [
    /\bdraft\b/,
    /\bwrite\b/,
    /\bmove\b/,
    /\blog\b/,
    /\bfinish intake\b/,
    /\bturn this into\b/,
    /\bask\b/,
    /\bupdate\b/,
  ]
  return (
    futureStepSignals.some((pattern) => pattern.test(normalized)) &&
    planningActionSignals.some((pattern) => pattern.test(normalized))
  )
}

function looksLikeVerificationBackedCheckpointAction(text: string): boolean {
  const normalized = text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
  if (!normalized) return false
  if (normalized.includes('recorded verification evidence')) return true
  return (
    normalized.includes('focused verification command') ||
    normalized.includes('focused verification commands')
  ) && normalized.includes('fix whatever still fails')
}

function advanceCheckpointAfterVerification(
  toolMetadata: Record<string, unknown> | undefined,
): void {
  if (!toolMetadata) return
  const checkpointNextAction = latestCheckpointNextAction(toolMetadata)
  if (!looksLikeVerificationBackedCheckpointAction(checkpointNextAction)) return
  const authoritative = parseAuthoritativeCommands(toolMetadata) ?? []
  if (authoritative.length > 0) {
    const passed = new Set(
      verificationHistory(toolMetadata)
        .filter((entry) => entry.passed)
        .map((entry) => entry.command.trim())
        .filter(Boolean),
    )
    if (authoritative.every((command) => passed.has(command.trim()))) {
      toolMetadata['current_task_checkpoint_next_action'] =
        'All authoritative verification commands have passed. Persist the structured self-critique note, then transition the task to review.'
      return
    }
  }
  toolMetadata['current_task_checkpoint_next_action'] =
    'Inspect the checkpoint-touched files against the verification result, then fix whatever still fails before you write the structured self-critique.'
}

function reviewHandoffToolNudge(
  assistantText: string,
  toolMetadata: Record<string, unknown> | undefined,
): string | null {
  const evidence = reviewHandoffEvidence(toolMetadata)
  if (!evidence?.changedOrVerified) return null
  const taskId = evidence.taskId
  if (taskId && looksLikeStructuredSelfCritiqueContent(assistantText)) {
    return [
      'You already wrote the structured self-critique in your last response.',
      'Your very next response must be exactly one tool call and no prose.',
      `Call update-task with { taskId: "${taskId}", status: "in_progress", note: { agentId: "worker-agent", role: "self-critique", content: "..." } } and persist that exact self-critique now.`,
      'Do not write a checkpoint or transition to review until the note is durable in task state.',
    ].join(' ')
  }
  if (!looksLikeReviewReadyHandoff(assistantText)) return null
  return [
    'You already have verified implementation evidence and are describing a review handoff.',
    'Your very next response must be exactly one tool call and no prose.',
    'Use update-task to append the note and move to review if the task is ready,',
    'or use write-checkpoint / log-progress if you still need to formalize the handoff before review,',
    'or raise-escalation if a real blocker still prevents honest handoff.',
  ].join(' ')
}

function composeRepairAbortSignal(
  external: AbortSignal | undefined,
  timeoutMs: number,
): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs)
  return external ? AbortSignal.any([external, timeout]) : timeout
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
  let repeatedReadOnlyRefusals = 0
  const initialCheckpointNextAction = latestCheckpointNextAction(context.toolMetadata)
  const initialAuthoritativeVerificationCommands = context.toolMetadata
    ? (parseAuthoritativeCommands(context.toolMetadata) ?? [])
    : []
  let checkpointVerificationReadFollowThroughRemaining =
    initialCheckpointNextAction.length > 0 &&
    initialAuthoritativeVerificationCommands.length > 0 &&
    looksLikeVerificationBackedCheckpointAction(initialCheckpointNextAction)
      ? 2
      : 0
  let checkpointVerificationReadFollowThroughArmed = false
  let checkpointEditOldStringMissTarget: string | null = null
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
        ...(context.temperature !== undefined ? { temperature: context.temperature } : {}),
        ...(context.promptCacheKey !== undefined ? { prompt_cache_key: context.promptCacheKey } : {}),
        ...(context.apiRequestOptions ?? {}),
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
    const assistantReasoning = finalMessage.role === 'assistant'
      ? finalMessage.content
        .filter((b): b is Extract<ContentBlock, { type: 'reasoning' }> => b.type === 'reasoning')
        .map((b) => b.text)
        .join('')
        .trim()
      : ''
    if (context.toolMetadata && assistantReasoning.length > 0) {
      context.toolMetadata['last_assistant_reasoning'] = assistantReasoning
    }
    yield { event: { type: 'assistant_turn_complete', message: finalMessage, usage }, usage }

    const toolCalls = messageToolUses(finalMessage)
    if (toolCalls.length === 0) {
      if (currentTaskLaneHandoffCompleted(context.toolMetadata)) {
        if (context.hookExecutor != null) {
          await context.hookExecutor.execute(HookEvent.STOP, {
            event: HookEvent.STOP,
            stop_reason: 'lane_handoff_complete',
          })
        }
        return
      }
      noProgressToolTurns = 0
      const reviewReadyHandoffNudge = reviewHandoffToolNudge(assistantText, context.toolMetadata)
      const planningOnlyNudge =
        context.noToolTurnNudge && looksLikeFutureStepNarration(assistantText)
          ? context.noToolTurnNudge
          : null
      const missingLikelyTarget = missingLikelyTargetFile(context.toolMetadata)
      const inspectedLikelyTarget = inspectedLikelyTargetFile(context.toolMetadata)
      const likelyTargetFiles = likelyTargetFilesFromMetadata(context.toolMetadata)
      const checkpointNextAction = latestCheckpointNextAction(context.toolMetadata)
      const checkpointTouched = checkpointFilesTouched(context.toolMetadata)
      const checkpointSafeSurface = checkpointSafeMutationSurface(context.toolMetadata)
      const authoritativeVerificationCommands = context.toolMetadata
        ? (parseAuthoritativeCommands(context.toolMetadata) ?? [])
        : []
      const preferredVerificationCommand = latestFailedVerificationCommand(context.toolMetadata)
      const checkpointActionIsExploratory = looksExploratoryCheckpointAction(checkpointNextAction)
      const checkpointActionIsHandoff = looksLikeHandoffCheckpointAction(checkpointNextAction)
      const checkpointTaskId = currentTaskId(context.toolMetadata)
      const mutationOrEscalationNudge = strictLikelyTargetMutationGuardsEnabled(context.toolMetadata)
        ? strictMutationOrEscalationNudge({
            missingLikelyTarget,
            inspectedLikelyTarget,
            likelyTargetFiles,
          })
        : null
      const checkpointSpecificNoToolNudge =
        currentAgentId(context.toolMetadata) === 'worker-agent' &&
        checkpointNextAction.length > 0
          ? checkpointActionIsHandoff
            ? strictCheckpointHandoffNudge({
                checkpointNextAction,
                taskId: checkpointTaskId,
                hasStructuredSelfCritique: hasStructuredSelfCritiqueInMetadata(context.toolMetadata),
              })
            : !checkpointActionIsExploratory
              ? strictCheckpointMutationNudge({
                  checkpointNextAction,
                  checkpointTouched,
                  checkpointSafeMutationSurface: checkpointSafeSurface,
                  authoritativeVerificationCommands,
                  preferredVerificationCommand,
                })
              : null
          : null
      const nudge =
        reviewReadyHandoffNudge ??
        planningOnlyNudge ??
        checkpointSpecificNoToolNudge ??
        ((mutationOrEscalationNudge && noToolTurnNudges > 0)
          ? mutationOrEscalationNudge
          : (mutationOrEscalationNudge ?? (!sawToolCall ? context.noToolTurnNudge : undefined)))
      if (nudge && noToolTurnNudges < (context.noToolTurnNudgeLimit ?? 2)) {
        noToolTurnNudges += 1
        messages.push(userMessageFromText(nudge))
        yield {
          event: {
            type: 'status',
            message: reviewReadyHandoffNudge
              ? 'Assistant produced review-ready handoff prose without a task-state tool call; demanding one handoff tool call next.'
              : planningOnlyNudge
              ? 'Assistant only narrated future steps without a tool call; demanding a durable tool step next.'
              : checkpointSpecificNoToolNudge
              ? 'Assistant finished without a checkpoint-directed tool call; demanding the exact next mutation, verification, or handoff step now.'
              : mutationOrEscalationNudge
              ? 'Assistant finished without a concrete mutation; demanding one mutation-or-escalation tool call next.'
              : 'Assistant response had no tool call; asking it to take the next concrete step.',
          },
          usage: null,
        }
        continue
      }
      if (checkpointSpecificNoToolNudge) {
        yield {
          event: {
            type: 'status',
            message:
              'Assistant kept returning no tool call after checkpoint-directed nudges; ending this turn so the coordinator can treat it as no progress.',
          },
          usage: null,
        }
        if (context.hookExecutor != null) {
          await context.hookExecutor.execute(HookEvent.STOP, {
            event: HookEvent.STOP,
            stop_reason: 'checkpoint_tool_uses_empty',
          })
        }
        return
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
    const missingLikelyTarget = missingLikelyTargetFile(context.toolMetadata)
    const likelyTargetFiles = likelyTargetFilesFromMetadata(context.toolMetadata)
    const checkpointNextAction = latestCheckpointNextAction(context.toolMetadata)
    const checkpointTouched = checkpointFilesTouched(context.toolMetadata)
    const checkpointActionIsExploratory = looksExploratoryCheckpointAction(checkpointNextAction)
    const checkpointActionIsHandoff = looksLikeHandoffCheckpointAction(checkpointNextAction)
    const checkpointTaskId = currentTaskId(context.toolMetadata)
    const authoritativeVerificationCommands = context.toolMetadata
      ? (parseAuthoritativeCommands(context.toolMetadata) ?? [])
      : []
    const preferredVerificationCommand = latestFailedVerificationCommand(context.toolMetadata)
    const isWorkerCheckpointLane =
      currentAgentId(context.toolMetadata) === 'worker-agent' && checkpointNextAction.length > 0
    const shouldRefuseFurtherReadOnlyResearch =
      progressToolNames.size > 0 &&
      !hadProgressToolCall &&
      noProgressTurnNudges > 0 &&
      !isWorkerCheckpointLane &&
      toolCalls.length > 0 &&
      toolCalls.every((tc) => isReadOnlyToolCall(context, tc.name, tc.input))
    const checkpointVerificationReadFollowThroughActive =
      checkpointVerificationReadFollowThroughRemaining > 0 &&
      (
        checkpointVerificationReadFollowThroughArmed ||
        looksLikeVerificationBackedCheckpointAction(checkpointNextAction)
      )
    const verificationReadFollowThroughIsPostVerification =
      checkpointVerificationReadFollowThroughActive &&
      checkpointVerificationReadFollowThroughArmed
    const checkpointScopedReadOnlyFollowThroughAllowed =
      (checkpointActionIsExploratory || checkpointVerificationReadFollowThroughActive) &&
      checkpointTouched.length > 0 &&
      toolCalls.length > 0 &&
      (!verificationReadFollowThroughIsPostVerification || toolCalls.length === 1) &&
      toolCalls.every((tc) =>
        isCheckpointScopedReadOnlyToolCall(
          context.cwd,
          context.toolMetadata,
          tc,
          checkpointTouched,
        ),
      )
    const handoffScopedLikelyTargetReadOnlyAllowed =
      checkpointActionIsHandoff &&
      likelyTargetFiles.length > 0 &&
      noProgressToolTurns <= 1 &&
      toolCalls.length > 0 &&
      toolCalls.every((tc) =>
        isLikelyTargetScopedReadOnlyToolCall(
          context.cwd,
          tc,
          likelyTargetFiles,
        ),
      )
    const verificationEvidenceLikelyTargetReadOnlyAllowed =
      looksLikeVerificationBackedCheckpointAction(checkpointNextAction) &&
      checkpointVerificationReadFollowThroughRemaining > 0 &&
      likelyTargetFiles.length > 0 &&
      checkpointTouched.length > 0 &&
      toolCalls.length > 0 &&
      (!checkpointVerificationReadFollowThroughArmed || toolCalls.length === 1) &&
      toolCalls.every((tc) =>
        isVerificationEvidenceSupportReadOnlyToolCall(
          context.cwd,
          context.toolMetadata,
          tc,
          likelyTargetFiles,
          checkpointTouched,
        ),
      )
    const uninspectedVerificationLikelyTargetReadOnlyAllowed =
      looksLikeVerificationBackedCheckpointAction(checkpointNextAction) &&
      likelyTargetFiles.length > 1 &&
      uninspectedLikelyTargetReadAllowed({
        cwd: context.cwd,
        toolMetadata: context.toolMetadata,
        toolCalls,
        likelyTargetFiles,
      })
    const checkpointEditMissReadAllowed =
      isWorkerCheckpointLane &&
      checkpointEditOldStringMissTarget != null &&
      toolCalls.length === 1 &&
      toolCalls.every((tc) => {
        if (tc.name !== 'read-file') return false
        const filePath = String((tc.input as Record<string, unknown>)?.filePath ?? '').trim()
        if (!filePath) return false
        return resolve(context.cwd, filePath) === checkpointEditOldStringMissTarget
      })
    const shouldRefusePostVerificationCheckpointBatch =
      isWorkerCheckpointLane &&
      looksLikeVerificationBackedCheckpointAction(checkpointNextAction) &&
      checkpointVerificationReadFollowThroughArmed &&
      checkpointVerificationReadFollowThroughRemaining > 0 &&
      toolCalls.length > 1
    const shouldRefuseAfterMissingLikelyTarget =
      strictLikelyTargetMutationGuardsEnabled(context.toolMetadata) &&
      missingLikelyTarget.length > 0 &&
      toolCalls.length > 0 &&
      toolCalls.every((tc) => isReadOnlyToolCall(context, tc.name, tc.input))
    const inspectedLikelyTarget = inspectedLikelyTargetFile(context.toolMetadata)
    const shouldRefuseAfterInspectingLikelyTarget =
      strictLikelyTargetMutationGuardsEnabled(context.toolMetadata) &&
      inspectedLikelyTarget.length > 0 &&
      noProgressTurnNudges > 0 &&
      !checkpointScopedReadOnlyFollowThroughAllowed &&
      !verificationEvidenceLikelyTargetReadOnlyAllowed &&
      !uninspectedVerificationLikelyTargetReadOnlyAllowed &&
      !checkpointEditMissReadAllowed &&
      !handoffScopedLikelyTargetReadOnlyAllowed &&
      toolCalls.length > 0 &&
      toolCalls.every((tc) => isReadOnlyToolCall(context, tc.name, tc.input))
    const shouldRefuseAfterCheckpointNextAction =
      isWorkerCheckpointLane &&
      checkpointNextAction.length > 0 &&
      noProgressToolTurns >= 1 &&
      toolCalls.length > 0 &&
      toolCalls.every((tc) => isReadOnlyToolCall(context, tc.name, tc.input)) &&
      !checkpointScopedReadOnlyFollowThroughAllowed &&
      !verificationEvidenceLikelyTargetReadOnlyAllowed &&
      !uninspectedVerificationLikelyTargetReadOnlyAllowed &&
      !checkpointEditMissReadAllowed &&
      !handoffScopedLikelyTargetReadOnlyAllowed
    const shouldRefuseNonAuthoritativeCheckpointShell =
      isWorkerCheckpointLane &&
      checkpointNextAction.length > 0 &&
      !checkpointActionIsExploratory &&
      !checkpointActionIsHandoff &&
      authoritativeVerificationCommands.length > 0 &&
      noProgressTurnNudges > 0 &&
      toolCalls.length > 0 &&
      toolCalls.every((tc) => {
        if (tc.name !== 'shell') return false
        const command = String((tc.input as Record<string, unknown>)?.command ?? '').trim()
        if (!command) return true
        return !reconcileShellCommandWithAuthority(command, authoritativeVerificationCommands).usedAuthority
      })

    if (
      shouldRefuseFurtherReadOnlyResearch ||
      shouldRefuseAfterMissingLikelyTarget ||
      shouldRefuseAfterInspectingLikelyTarget ||
      shouldRefusePostVerificationCheckpointBatch ||
      shouldRefuseAfterCheckpointNextAction ||
      shouldRefuseNonAuthoritativeCheckpointShell
    ) {
      repeatedReadOnlyRefusals += 1
      const checkpointSafeSurface = checkpointSafeMutationSurface(context.toolMetadata)
      const checkpointRefusalNudge =
        shouldRefuseAfterCheckpointNextAction && !checkpointActionIsHandoff
          ? strictCheckpointMutationNudge({
              checkpointNextAction,
              checkpointTouched,
              checkpointSafeMutationSurface: checkpointSafeSurface,
              authoritativeVerificationCommands,
              preferredVerificationCommand,
            })
          : null
      const refusalMessage = shouldRefuseAfterMissingLikelyTarget
        ? `The likely target file does not exist yet at ${missingLikelyTarget}. Do not do more broad read-only exploration now. Create that file only if its parent directory exists and matches the project structure; otherwise inspect the nearest existing companion file or raise-escalation with the path mismatch.`
        : shouldRefusePostVerificationCheckpointBatch
          ? (checkpointRefusalNudge ??
            `The latest checkpoint already names your next step: ${checkpointNextAction}. Do not bundle multiple post-verification tool calls together here. Choose exactly one next step: rerun the last failing authoritative verification command, mutate one checkpoint-scoped file, or raise-escalation if the checkpoint is no longer valid.`)
        : shouldRefuseAfterCheckpointNextAction
          ? checkpointActionIsHandoff
            ? `The latest checkpoint already names your next step: ${checkpointNextAction}. Do not do more read-only exploration now. Raise-escalation if the checkpoint is no longer valid or you still cannot proceed.`
            : (checkpointRefusalNudge ??
              `The latest checkpoint already names your next step: ${checkpointNextAction}. Do not do more read-only exploration now. ${checkpointActionIsExploratory && checkpointTouched.length > 0 ? `If you must read first, only use read-file on the checkpoint-touched files (${checkpointTouched.join(', ')}) before taking the next focused verification or mutation step.` : `Run that focused verification or mutation step next${checkpointTouched.length > 0 ? ` using the checkpoint-touched files (${checkpointTouched.join(', ')}) as your authoritative scope` : ''}`}, or raise-escalation if the checkpoint is no longer valid.`)
        : shouldRefuseNonAuthoritativeCheckpointShell
          ? (strictCheckpointShellNudge({
              checkpointNextAction,
              authoritativeVerificationCommands,
              checkpointTouched,
              checkpointSafeMutationSurface: checkpointSafeSurface,
              preferredVerificationCommand,
            }) ??
            `The latest checkpoint already names your next step: ${checkpointNextAction}. If you use shell here, it must be one of the authoritative verification commands (${authoritativeVerificationCommands.join(', ')}). Otherwise mutate a checkpoint-scoped file or raise-escalation.`)
        : shouldRefuseAfterInspectingLikelyTarget
          ? `You have already inspected an authoritative likely target file at ${inspectedLikelyTarget}. Do not do more read-only exploration now. ${likelyTargetMutationDirective({ likelyTargetFiles, inspectedLikelyTarget })} Or raise-escalation if you still cannot proceed.`
          : 'Research budget exhausted for this intake turn. Do not call more read-only tools now. Use update-product-brief, post-user-question, update-task, or raise-escalation instead.'
      const toolResults: ToolResultBlock[] = toolCalls.map((tc) => ({
        type: 'tool_result',
        tool_use_id: tc.id,
        content: refusalMessage,
        is_error: true,
      }))
      for (let i = 0; i < toolCalls.length; i++) {
        const tc = toolCalls[i]!
        const result = toolResults[i]!
        yield {
          event: {
            type: 'tool_execution_started',
            tool_name: tc.name,
            tool_input: tc.input,
          },
          usage: null,
        }
        yield {
          event: {
            type: 'tool_execution_completed',
            tool_name: tc.name,
            output: result.content,
            is_error: true,
          },
          usage: null,
        }
      }
      messages.push({ role: 'user', content: toolResults })
      const strictCheckpointNudge =
        shouldRefuseAfterCheckpointNextAction && checkpointActionIsExploratory
          ? strictCheckpointFollowThroughNudge({
              checkpointNextAction,
              checkpointTouched,
            })
          : shouldRefuseAfterCheckpointNextAction && checkpointActionIsHandoff
            ? strictCheckpointHandoffNudge({
                checkpointNextAction,
                taskId: checkpointTaskId,
                hasStructuredSelfCritique: hasStructuredSelfCritiqueInMetadata(context.toolMetadata),
              })
            : shouldRefuseAfterCheckpointNextAction
              ? strictCheckpointMutationNudge({
                  checkpointNextAction,
                  checkpointTouched,
                  authoritativeVerificationCommands,
                  preferredVerificationCommand,
                })
            : null
      if (strictCheckpointNudge && repeatedReadOnlyRefusals < 2) {
        messages.push(userMessageFromText(strictCheckpointNudge))
      }
      yield {
          event: {
            type: 'status',
            message: shouldRefuseAfterMissingLikelyTarget
              ? 'Assistant confirmed a likely target file is missing; requiring parent-path validation, a concrete mutation, or escalation.'
              : shouldRefusePostVerificationCheckpointBatch
                ? 'Assistant tried to bundle multiple post-verification steps inside a mutation checkpoint; demanding exactly one next tool call.'
              : shouldRefuseAfterCheckpointNextAction
                ? checkpointActionIsExploratory
                  ? 'Assistant drifted away from an exploratory checkpoint; demanding one exact checkpoint-file read or escalation next.'
                  : checkpointActionIsHandoff
                    ? 'Assistant drifted away from a handoff checkpoint; demanding one self-critique persistence tool call or escalation next.'
                    : 'Assistant drifted away from a mutation checkpoint; demanding one exact file mutation or escalation next.'
              : shouldRefuseNonAuthoritativeCheckpointShell
                ? 'Assistant tried to use a non-authoritative shell command in a checkpointed mutation lane; demanding an authoritative verification command, a file mutation, or escalation next.'
              : shouldRefuseAfterInspectingLikelyTarget
                ? 'Assistant already inspected an authoritative likely target file; refusing further read-only exploration until it makes concrete progress or escalates.'
              : 'Assistant kept researching after an explicit durable-progress nudge; refusing more read-only tool calls for this turn.',
          },
          usage: null,
      }
      if (repeatedReadOnlyRefusals >= 2) {
        const endingMessage = shouldRefuseAfterMissingLikelyTarget
          ? 'Assistant kept retrying read-only exploration after repeated missing-target refusals; ending the turn so the orchestrator can treat this as no progress.'
          : shouldRefusePostVerificationCheckpointBatch
            ? 'Assistant kept bundling multiple post-verification steps after repeated checkpoint-directed refusals; ending the turn so the orchestrator can treat this as no progress.'
          : shouldRefuseAfterCheckpointNextAction
            ? 'Assistant kept retrying read-only exploration after repeated checkpoint-directed refusals; ending the turn so the orchestrator can treat this as no progress.'
          : shouldRefuseNonAuthoritativeCheckpointShell
            ? 'Assistant kept retrying non-authoritative shell commands after repeated checkpoint-directed refusals; ending the turn so the orchestrator can treat this as no progress.'
          : shouldRefuseAfterInspectingLikelyTarget
            ? 'Assistant kept retrying read-only exploration after repeated inspected-target refusals; ending the turn so the orchestrator can treat this as no progress.'
            : 'Assistant kept retrying read-only exploration after repeated intake-budget refusals; ending the turn so the orchestrator can treat this as no progress.'
        yield {
          event: {
            type: 'status',
            message: endingMessage,
          },
          usage: null,
        }
        return
      }
      continue
    }

    repeatedReadOnlyRefusals = 0
    const usedCheckpointVerificationReadFollowThrough =
      checkpointVerificationReadFollowThroughRemaining > 0 && (
        (
          toolCalls.length > 0 &&
          toolCalls.every((tc) =>
            isCheckpointScopedReadOnlyToolCall(
              context.cwd,
              context.toolMetadata,
              tc,
              checkpointTouched,
            ),
          )
        ) ||
        (
          looksLikeVerificationBackedCheckpointAction(checkpointNextAction) &&
          likelyTargetFiles.length > 0 &&
          checkpointTouched.length > 0 &&
          toolCalls.length > 0 &&
          toolCalls.every((tc) =>
            isVerificationEvidenceSupportReadOnlyToolCall(
              context.cwd,
              context.toolMetadata,
              tc,
              likelyTargetFiles,
              checkpointTouched,
            ),
          )
        )
      )

    if (toolCalls.length === 1) {
      const tc = toolCalls[0]!
      yield {
        event: { type: 'tool_execution_started', tool_name: tc.name, tool_input: tc.input },
        usage: null,
      }
      let result = await executeToolCall(context, tc)
      if (isMalformedWriteFileToolResult(tc.name, result)) {
        yield {
          event: {
            type: 'status',
            message: 'Malformed write-file call detected; attempting one focused write-file repair.',
          },
          usage: null,
        }
        const repaired = await attemptFocusedWriteFileRepair(context, tc, result)
        if (repaired) {
          result = repaired
        }
      }
      if (isMalformedEditFileToolResult(tc.name, result)) {
        yield {
          event: {
            type: 'status',
            message: 'Malformed edit-file call detected; attempting one focused file-edit repair.',
          },
          usage: null,
        }
        const repaired = await attemptFocusedEditFileRepair(context, tc, result)
        if (repaired) {
          result = repaired
        }
      }
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
      const oldStringMissTarget = editFileOldStringMissTarget(context.cwd, tc, result)
      if (oldStringMissTarget) {
        checkpointEditOldStringMissTarget = oldStringMissTarget
      } else if (
        checkpointEditOldStringMissTarget &&
        tc.name === 'read-file' &&
        resolve(context.cwd, String((tc.input as Record<string, unknown>)?.filePath ?? '').trim()) ===
          checkpointEditOldStringMissTarget
      ) {
        checkpointEditOldStringMissTarget = null
      }
      if (
        checkpointNextAction.length > 0 &&
        authoritativeVerificationCommands.length > 0 &&
        tc.name === 'shell'
      ) {
        checkpointVerificationReadFollowThroughArmed = true
        checkpointVerificationReadFollowThroughRemaining = 1
      } else if (usedCheckpointVerificationReadFollowThrough) {
        checkpointVerificationReadFollowThroughRemaining = Math.max(
          0,
          checkpointVerificationReadFollowThroughRemaining - 1,
        )
      }
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
      if (
        checkpointNextAction.length > 0 &&
        authoritativeVerificationCommands.length > 0 &&
        toolCalls.some((tc) => tc.name === 'shell')
      ) {
        checkpointVerificationReadFollowThroughArmed = true
        checkpointVerificationReadFollowThroughRemaining = 1
      } else if (usedCheckpointVerificationReadFollowThrough) {
        checkpointVerificationReadFollowThroughRemaining = Math.max(
          0,
          checkpointVerificationReadFollowThroughRemaining - 1,
        )
      }
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
      noProgressToolTurns >= (context.noProgressTurnThreshold ?? 2)
    ) {
      const noProgressNudgeLimit = context.noProgressTurnNudgeLimit ?? 1
      const transcriptOnlyCarryover =
        toolCalls.length === 1 && toolCalls[0]?.name === 'append-exploring-transcript'
      if (transcriptOnlyCarryover && noProgressTurnNudges > 0) {
        yield {
          event: {
            type: 'status',
            message:
              'Assistant only appended the exploring transcript after a durable-progress nudge; ending the turn so the orchestrator can treat intake as stalled.',
          },
          usage: null,
        }
        return
      }
      const checkpointNextAction = latestCheckpointNextAction(context.toolMetadata)
      const checkpointTouched = checkpointFilesTouched(context.toolMetadata)
      const checkpointSafeSurface = checkpointSafeMutationSurface(context.toolMetadata)
      const checkpointTaskId = currentTaskId(context.toolMetadata)
      const handoffCheckpointNudge =
        currentAgentId(context.toolMetadata) === 'worker-agent' &&
        looksLikeHandoffCheckpointAction(checkpointNextAction)
          ? strictCheckpointHandoffNudge({
              checkpointNextAction,
              taskId: checkpointTaskId,
              hasStructuredSelfCritique: hasStructuredSelfCritiqueInMetadata(context.toolMetadata),
            })
          : null
      const mutationCheckpointNudge =
        currentAgentId(context.toolMetadata) === 'worker-agent' &&
        checkpointNextAction.length > 0 &&
        !looksExploratoryCheckpointAction(checkpointNextAction) &&
        !looksLikeHandoffCheckpointAction(checkpointNextAction)
          ? strictCheckpointMutationNudge({
              checkpointNextAction,
              checkpointTouched,
              checkpointSafeMutationSurface: checkpointSafeSurface,
              authoritativeVerificationCommands,
              preferredVerificationCommand: latestFailedVerificationCommand(context.toolMetadata),
            })
          : null
      const checkpointSpecificNudge = handoffCheckpointNudge ?? mutationCheckpointNudge
      if (noProgressTurnNudges < noProgressNudgeLimit) {
        noProgressTurnNudges += 1
        messages.push(userMessageFromText(checkpointSpecificNudge ?? context.noProgressTurnNudge))
        yield {
          event: {
            type: 'status',
            message: handoffCheckpointNudge
              ? 'Assistant kept using non-durable steps after a handoff checkpoint; demanding the exact review-transition tool call next.'
              : mutationCheckpointNudge
                ? 'Assistant kept using non-durable steps after a mutation checkpoint; demanding the exact file mutation or escalation next.'
                : noProgressStatusMessage(context.toolMetadata),
          },
          usage: null,
        }
        continue
      }
      yield {
        event: {
          type: 'status',
          message:
            'Assistant kept using non-durable tool steps after repeated durable-progress nudges; ending the turn so the orchestrator can treat intake as stalled.',
        },
        usage: null,
      }
      return
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
  const writeFileRecovery = malformedWriteFileRecoveryNudge(toolCall, result, count)
  if (writeFileRecovery) return writeFileRecovery
  const editFileRecovery = malformedEditFileRecoveryNudge(toolCall, result, count)
  if (editFileRecovery) return editFileRecovery
  if (count < 2) return null
  const outcome = result.is_error ? 'failed' : 'returned no useful result'
  return [
    `The ${toolCall.name} tool just ${outcome} ${count} times with the same input.`,
    'Do not repeat that exact tool call again.',
    'Use a different diagnostic, read/list/search the relevant files first, or raise an escalation if you are blocked.',
  ].join(' ')
}

function malformedWriteFileRecoveryNudge(
  toolCall: ToolUseBlock,
  result: ToolResultBlock,
  count: number,
): string | null {
  if (!isMalformedWriteFileToolResult(toolCall.name, result)) return null
  const message = result.content

  const inferredPathMatch = message.match(/filePath:\s*"([^"]+)"/)
  const inferredPath = inferredPathMatch?.[1]?.trim()
  const exactPathInstruction = inferredPath
    ? `Use filePath exactly "${inferredPath}".`
    : 'Use the real target filePath for the file you are creating or replacing.'

  if (count === 1) {
    return [
      'Your previous write-file call was missing required arguments.',
      'Your very next response must be exactly one write-file tool call and no explanatory prose.',
      exactPathInstruction,
      'Include BOTH JSON keys: filePath and content.',
      'The content value must contain the complete file contents, not a summary or placeholder.',
    ].join(' ')
  }

  return [
    `The write-file tool has failed ${count} times because its arguments are incomplete.`,
    'Do not call write-file again until you can provide both filePath and the complete content payload in the same tool call.',
    exactPathInstruction,
    'If you still cannot produce the file contents, use write-checkpoint, log-progress, or raise-escalation instead of repeating write-file {}.',
  ].join(' ')
}

function isMalformedWriteFileToolResult(toolName: string, result: ToolResultBlock): boolean {
  if (toolName !== 'write-file' || !result.is_error) return false
  const message = result.content
  return (
    message.includes('Error writing file: Missing filePath') ||
    message.includes('Error writing file: Missing content')
  )
}

function malformedEditFileRecoveryNudge(
  toolCall: ToolUseBlock,
  result: ToolResultBlock,
  count: number,
): string | null {
  if (!isMalformedEditFileToolResult(toolCall.name, result)) return null

  if (count === 1) {
    return [
      'Your previous edit-file call was missing required arguments.',
      'Your very next response must be exactly one file mutation tool call and no explanatory prose.',
      'If you are making a targeted edit, use edit-file with filePath, oldString, and newString.',
      'If you are replacing the whole file, use write-file with filePath and content instead.',
      'Do not repeat edit-file {}.',
    ].join(' ')
  }

  return [
    `The edit-file tool has failed ${count} times because its arguments are incomplete.`,
    'Do not call edit-file again until you can provide filePath, oldString, and newString in the same tool call.',
    'If you cannot provide an exact oldString, switch to write-file with the complete file contents.',
    'If you still cannot safely mutate the file, use write-checkpoint, log-progress, or raise-escalation instead of repeating edit-file {}.',
  ].join(' ')
}

function isMalformedEditFileToolResult(toolName: string, result: ToolResultBlock): boolean {
  if (toolName !== 'edit-file' || !result.is_error) return false
  const message = result.content
  return message.includes('Invalid input for edit-file')
}

function editFileOldStringMissTarget(
  cwd: string,
  toolCall: ToolUseBlock,
  result: ToolResultBlock,
): string | null {
  if (toolCall.name !== 'edit-file' || !result.is_error) return null
  if (!/oldString was not found in the file/i.test(result.content)) return null
  const filePath = String((toolCall.input as Record<string, unknown>)?.filePath ?? '').trim()
  if (!filePath) return null
  return resolve(cwd, filePath)
}

async function attemptFocusedWriteFileRepair(
  context: QueryContext,
  originalToolCall: ToolUseBlock,
  originalResult: ToolResultBlock,
): Promise<ToolResultBlock | null> {
  const writeFileToolSchema = context.toolRegistry
    .toApiSchema()
    .filter((tool) => tool.name === 'write-file')
  if (writeFileToolSchema.length === 0) return null

  const taskTitle = String(context.toolMetadata?.['current_task_title'] ?? '').trim()
  const taskSpec = String(context.toolMetadata?.['current_task_spec_excerpt'] ?? '').trim()
  const taskProjectPath = String(context.toolMetadata?.['current_task_project_path'] ?? context.cwd).trim()
  const lastAssistantText = String(context.toolMetadata?.['last_assistant_text'] ?? '').trim()
  const lastAssistantReasoning = String(context.toolMetadata?.['last_assistant_reasoning'] ?? '').trim()
  const priorToolError = String(originalResult.content ?? '').trim()
  const missingTargetPath = missingLikelyTargetFile(context.toolMetadata)
  const likelyTargetFiles = likelyTargetFilesFromMetadata(context.toolMetadata)
  const readHints = recentReadFileHints(context.toolMetadata)

  const repairPrompt = [
    'Repair the malformed write-file call from the coding task.',
    taskTitle ? `Task title: ${taskTitle}` : '',
    taskProjectPath ? `Task project path: ${taskProjectPath}` : '',
    taskSpec ? `Task spec excerpt:\n${taskSpec}` : '',
    lastAssistantReasoning ? `Previous assistant reasoning:\n${lastAssistantReasoning}` : '',
    lastAssistantText ? `Previous assistant text:\n${lastAssistantText}` : '',
    priorToolError ? `Previous tool error:\n${priorToolError}` : '',
    missingTargetPath
      ? `Write the file at exactly this path:\n${missingTargetPath}`
      : '',
    !missingTargetPath && likelyTargetFiles.length > 0
      ? `Likely target file path(s):\n${likelyTargetFiles.join('\n')}`
      : '',
    readHints.length > 0
      ? `Recent file context:\n${readHints
          .map((entry) =>
            entry.preview
              ? `- ${entry.path}: ${entry.preview}`
              : `- ${entry.path}`,
          )
          .join('\n')}`
      : '',
    'Return exactly one write-file tool call.',
    'The tool call must include BOTH filePath and content.',
    'content must be the full file contents, not a summary.',
    missingTargetPath ? 'filePath must exactly match the path above.' : '',
    'Do not return explanatory prose.',
  ]
    .filter(Boolean)
    .join('\n\n')

  let repairedMessage: ConversationMessage | null = null
  try {
    for await (const ev of context.apiClient.streamMessage({
      model: context.model,
      messages: [userMessageFromText(repairPrompt)],
      system_prompt:
        'You are repairing a malformed write-file call. Return exactly one write-file tool call with complete JSON arguments.',
      max_tokens: Math.min(context.maxTokens, 1_024),
      ...(context.temperature !== undefined ? { temperature: context.temperature } : {}),
      ...(context.promptCacheKey !== undefined ? { prompt_cache_key: context.promptCacheKey } : {}),
      ...(context.apiRequestOptions ?? {}),
      tools: writeFileToolSchema,
      signal: composeRepairAbortSignal(context.abortSignal, 20_000),
    })) {
      if (ev.type === 'message_complete') repairedMessage = ev.message
    }
  } catch {
    return null
  }

  if (!repairedMessage || repairedMessage.role !== 'assistant') return null
  const repairedCalls = messageToolUses(repairedMessage)
  if (repairedCalls.length !== 1) return null
  const repairedCall = repairedCalls[0]
  if (!repairedCall || repairedCall.name !== 'write-file') return null

  const repairedResult = await executeToolCall(context, {
    ...repairedCall,
    id: originalToolCall.id,
  })
  if (isMalformedWriteFileToolResult('write-file', repairedResult)) return null
  return repairedResult
}

async function attemptFocusedEditFileRepair(
  context: QueryContext,
  originalToolCall: ToolUseBlock,
  originalResult: ToolResultBlock,
): Promise<ToolResultBlock | null> {
  const fileMutationToolSchemas = context.toolRegistry
    .toApiSchema()
    .filter((tool) => tool.name === 'edit-file' || tool.name === 'write-file')
  if (fileMutationToolSchemas.length === 0) return null

  const taskTitle = String(context.toolMetadata?.['current_task_title'] ?? '').trim()
  const taskSpec = String(context.toolMetadata?.['current_task_spec_excerpt'] ?? '').trim()
  const taskProjectPath = String(context.toolMetadata?.['current_task_project_path'] ?? context.cwd).trim()
  const lastAssistantText = String(context.toolMetadata?.['last_assistant_text'] ?? '').trim()
  const lastAssistantReasoning = String(context.toolMetadata?.['last_assistant_reasoning'] ?? '').trim()
  const priorToolError = String(originalResult.content ?? '').trim()

  const repairPrompt = [
    'Repair the malformed file-edit call from the coding task.',
    taskTitle ? `Task title: ${taskTitle}` : '',
    taskProjectPath ? `Task project path: ${taskProjectPath}` : '',
    taskSpec ? `Task spec excerpt:\n${taskSpec}` : '',
    lastAssistantReasoning ? `Previous assistant reasoning:\n${lastAssistantReasoning}` : '',
    lastAssistantText ? `Previous assistant text:\n${lastAssistantText}` : '',
    priorToolError ? `Previous tool error:\n${priorToolError}` : '',
    'Return exactly one tool call and no explanatory prose.',
    'If you are making a targeted edit, return edit-file with filePath, oldString, and newString.',
    'If you are replacing the whole file, return write-file with filePath and content.',
  ]
    .filter(Boolean)
    .join('\n\n')

  let repairedMessage: ConversationMessage | null = null
  try {
    for await (const ev of context.apiClient.streamMessage({
      model: context.model,
      messages: [userMessageFromText(repairPrompt)],
      system_prompt:
        'You are repairing a malformed file mutation call. Return exactly one tool call: either edit-file with complete arguments or write-file with complete arguments.',
      max_tokens: Math.min(context.maxTokens, 8_192),
      ...(context.temperature !== undefined ? { temperature: context.temperature } : {}),
      ...(context.promptCacheKey !== undefined ? { prompt_cache_key: context.promptCacheKey } : {}),
      ...(context.apiRequestOptions ?? {}),
      tools: fileMutationToolSchemas,
      ...(context.abortSignal ? { signal: context.abortSignal } : {}),
    })) {
      if (ev.type === 'message_complete') repairedMessage = ev.message
    }
  } catch {
    return null
  }

  if (!repairedMessage || repairedMessage.role !== 'assistant') return null
  const repairedCalls = messageToolUses(repairedMessage)
  if (repairedCalls.length !== 1) return null
  const repairedCall = repairedCalls[0]
  if (!repairedCall) return null
  if (repairedCall.name !== 'edit-file' && repairedCall.name !== 'write-file') return null

  const repairedResult = await executeToolCall(context, {
    ...repairedCall,
    id: originalToolCall.id,
  })
  if (
    isMalformedEditFileToolResult(repairedCall.name, repairedResult) ||
    isMalformedWriteFileToolResult(repairedCall.name, repairedResult)
  ) {
    return null
  }
  return repairedResult
}

function isMemoryTaskPath(path: string): boolean {
  return /(?:^|\/)memory\/TASKS\.json$/.test(path)
}

interface ReviewHandoffEvidence {
  taskId: string
  inspectedImplementationFile: boolean
  changedOrVerified: boolean
  successfulVerificationCommands: string[]
}

function currentTaskLooksLikeVerificationOnly(
  toolMetadata: Record<string, unknown> | undefined,
): boolean {
  const haystack = [
    String(toolMetadata?.['current_task_title'] ?? ''),
    String(toolMetadata?.['current_task_spec_excerpt'] ?? ''),
  ]
    .join('\n')
    .toLowerCase()

  return (
    /manual testing/.test(haystack) ||
    /real mobile devices?/.test(haystack) ||
    /real device/.test(haystack) ||
    /hands-on qa/.test(haystack) ||
    /visual\/functional correctness only/.test(haystack) ||
    /manual test/.test(haystack)
  )
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
    successfulVerificationCommands: Array.isArray(rec['successfulVerificationCommands'])
      ? rec['successfulVerificationCommands']
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
      : [],
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
    successfulVerificationCommands: [],
  })
}

function missingAuthoritativeVerificationCommands(
  toolMetadata: Record<string, unknown> | undefined,
  taskId: string,
): string[] {
  const authoritative = parseAuthoritativeCommands(toolMetadata ?? {})
  if (authoritative == null || authoritative.length === 0) return []
  const evidence = reviewHandoffEvidence(toolMetadata)
  const durableVerification = verificationHistory(toolMetadata)
    .filter((entry) => entry.passed)
    .map((entry) => entry.command.trim())
    .filter(Boolean)
  if (evidence?.taskId !== taskId) {
    const seen = new Set(durableVerification)
    return authoritative.filter((command) => !seen.has(command.trim()))
  }
  const seen = new Set([
    ...evidence.successfulVerificationCommands.map((entry) => entry.trim()),
    ...durableVerification,
  ])
  return authoritative.filter((command) => !seen.has(command.trim()))
}

function recordReviewHandoffEvidence(
  toolMetadata: Record<string, unknown> | undefined,
  toolName: string,
  filePath: string | null,
  resultMetadata?: Record<string, unknown> | null,
): void {
  const taskId = activeReviewTaskId(toolMetadata)
  if (!toolMetadata || !taskId) return
  const current = reviewHandoffEvidence(toolMetadata)
  const durableVerification = verificationHistory(toolMetadata)
    .filter((entry) => entry.passed)
    .map((entry) => entry.command.trim())
    .filter(Boolean)
  const evidence: ReviewHandoffEvidence = current?.taskId === taskId
    ? current
    : {
        taskId,
        inspectedImplementationFile: false,
        changedOrVerified: false,
        successfulVerificationCommands: durableVerification,
      }

  if (isReadToolName(toolName) && filePath && !isMemoryTaskPath(filePath)) {
    evidence.inspectedImplementationFile = true
  }
  if (isBashToolName(toolName) || isWriteToolName(toolName) || isEditToolName(toolName)) {
    evidence.changedOrVerified = true
  }
  if (isBashToolName(toolName) && resultMetadata) {
    const success = resultMetadata['success'] === true
    const usedAuthoritativeCommand = resultMetadata['usedAuthoritativeCommand'] === true
    const executedCommand = String(resultMetadata['executedCommand'] ?? '').trim()
    if (success && usedAuthoritativeCommand && executedCommand.length > 0) {
      const normalized = new Set(evidence.successfulVerificationCommands.map((entry) => entry.trim()))
      normalized.add(executedCommand)
      evidence.successfulVerificationCommands = [...normalized]
    }
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
  if (missingAuthoritativeVerificationCommands(toolMetadata, taskId).length > 0) {
    return false
  }
  const evidence = reviewHandoffEvidence(toolMetadata)
  if (evidence?.taskId !== taskId) return false
  if (evidence.inspectedImplementationFile && evidence.changedOrVerified) return true
  if (currentTaskLooksLikeVerificationOnly(toolMetadata) && evidence.changedOrVerified) return true
  if (checkpointFilesTouched(toolMetadata).length > 0 && hasStructuredSelfCritiqueInMetadata(toolMetadata)) {
    return true
  }
  return false
}

function hasImplementationEvidenceForSelfCritique(
  toolMetadata: Record<string, unknown> | undefined,
  taskId: string,
): boolean {
  if (missingAuthoritativeVerificationCommands(toolMetadata, taskId).length > 0) {
    return false
  }
  const evidence = reviewHandoffEvidence(toolMetadata)
  if (evidence?.taskId === taskId) {
    if (evidence.inspectedImplementationFile && evidence.changedOrVerified) return true
    if (currentTaskLooksLikeVerificationOnly(toolMetadata) && evidence.changedOrVerified) return true
  }
  return checkpointFilesTouched(toolMetadata).length > 0
}

function hasStructuredSelfCritiqueForReviewHandoff(
  input: Record<string, unknown>,
  toolMetadata: Record<string, unknown> | undefined,
): boolean {
  return structuredSelfCritiqueFromUpdateTaskInput(input).length > 0 || hasStructuredSelfCritiqueInMetadata(toolMetadata)
}

function reviewHandoffGuardResult(
  toolUseId: string,
  toolName: string,
  input: Record<string, unknown>,
  toolMetadata: Record<string, unknown> | undefined,
): ToolResultBlock | null {
  if (toolName !== 'update-task') return null
  const taskId = taskIdForReviewHandoff(input, toolMetadata)
  const requestedStatus = typeof input['status'] === 'string' ? input['status'].trim() : ''
  if (
    requestedStatus !== 'review' &&
    requestedStatus !== 'in_progress'
  ) {
    return null
  }
  const hasStructuredSelfCritique = hasStructuredSelfCritiqueForReviewHandoff(input, toolMetadata)
  if (
    requestedStatus === 'in_progress' &&
    hasStructuredSelfCritique &&
    taskId &&
    !hasImplementationEvidenceForSelfCritique(toolMetadata, taskId)
  ) {
    return {
      type: 'tool_result',
      tool_use_id: toolUseId,
      content: currentTaskLooksLikeVerificationOnly(toolMetadata)
        ? 'Blocked self-critique: produce a durable verification artifact or concrete verification step before writing the review self-critique. Do not claim completion from task metadata alone.'
        : 'Blocked self-critique: inspect, change, or verify implementation files before writing the review self-critique. Do not claim files or acceptance criteria are complete from task metadata alone.',
      is_error: true,
    }
  }
  if (requestedStatus !== 'review') return null
  const missingImport = missingLocalImportEvidence(toolMetadata)
  if (missingImport) {
    return {
      type: 'tool_result',
      tool_use_id: toolUseId,
      content: [
        'Blocked transition to review: Guildhall found a local import in the task-owned code that does not exist in the repo.',
        `Source file: ${missingImport.sourceFile}.`,
        `Missing import: "${missingImport.importPath}".`,
        `Expected local path: ${missingImport.expectedPath}.`,
        'Ground the implementation in the real repo surface before handoff: either use an existing local component/module path or add the missing file intentionally.',
      ].join(' '),
      is_error: true,
    }
  }
  const missingVerification = taskId ? missingAuthoritativeVerificationCommands(toolMetadata, taskId) : []
  const hasImplementationEvidence = taskId && hasReviewHandoffEvidence(toolMetadata, taskId)
  if (missingVerification.length > 0) {
    return {
      type: 'tool_result',
      tool_use_id: toolUseId,
      content: [
        'Blocked transition to review: Guildhall does not yet have durable proof that the task passed its required verification commands.',
        `Still required before handoff: ${missingVerification.map((command) => `"${command}"`).join(', ')}.`,
        'Run the authoritative verification command set successfully, then persist the structured self-critique and hand off to review.',
      ].join(' '),
      is_error: true,
    }
  }
  if (hasImplementationEvidence && hasStructuredSelfCritique) return null
  if (hasImplementationEvidence && !hasStructuredSelfCritique) {
    const taskLabel = taskId || 'the active task'
    return {
      type: 'tool_result',
      tool_use_id: toolUseId,
      content: [
        'Blocked transition to review: persist a structured self-critique note with a review proof packet via update-task first.',
        'It must cover each acceptance criterion, include the minimum-scope check, list the changed files/diff scope, and name the verification command(s) that passed before handoff.',
        `Call update-task again for ${taskLabel} with status "in_progress" and note: { agentId: "worker-agent", role: "self-critique", content: "**Self-critique:** ..." }.`,
        'After that note is durable in task state, transition to review in a separate update-task call.',
      ].join(' '),
      is_error: true,
    }
  }
  return {
    type: 'tool_result',
    tool_use_id: toolUseId,
    content: currentTaskLooksLikeVerificationOnly(toolMetadata)
      ? 'Blocked transition to review: produce a durable verification artifact or concrete verification step first, then hand off with a structured self-critique. Do not move to review from task metadata alone.'
      : 'Blocked transition to review: inspect the implementation source/test files and run or change something concrete before handoff. Do not self-critique or move to review from task metadata alone.',
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
  const toolInput = hydrateProjectToolInput(toolName, context.cwd, rawToolInput, context.toolMetadata)
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

  if (context.toolMetadata) {
    const likelyTargetFiles = new Set(likelyTargetFilesFromMetadata(context.toolMetadata))
    if (toolName === 'read-file') {
      const missingPath = readFileNotFoundPath(toolResult.content)
      if (missingPath && likelyTargetFiles.has(missingPath)) {
        context.toolMetadata['current_missing_likely_target_file'] = missingPath
      } else if (!toolResult.is_error && filePath && likelyTargetFiles.has(filePath)) {
        delete context.toolMetadata['current_missing_likely_target_file']
      }
    } else if ((toolName === 'write-file' || toolName === 'edit-file') && filePath && likelyTargetFiles.has(filePath) && !toolResult.is_error) {
      delete context.toolMetadata['current_missing_likely_target_file']
    }
  }

  if (
    context.toolMetadata &&
    !toolResult.is_error &&
    toolName === 'update-task' &&
    structuredSelfCritiqueFromUpdateTaskInput(toolInput).length > 0
  ) {
    context.toolMetadata['current_task_has_structured_self_critique'] = true
    context.toolMetadata['current_task_has_review_proof_packet'] = true
  }

  const resultMetadata = (result as { metadata?: Record<string, unknown> }).metadata ?? null
  if (context.toolMetadata && !toolResult.is_error && toolName === 'update-task') {
    const nextStatus = typeof toolInput['status'] === 'string' ? toolInput['status'].trim() : ''
    const taskId = String(resultMetadata?.['taskId'] ?? toolInput['taskId'] ?? '').trim()
    const activeTaskId = currentTaskId(context.toolMetadata)
    if (taskId.length > 0 && nextStatus.length > 0 && (activeTaskId.length === 0 || activeTaskId === taskId)) {
      if (isLaneExitStatus(currentAgentId(context.toolMetadata), nextStatus)) {
        context.toolMetadata['current_task_lane_handoff_completed'] = true
      } else {
        delete context.toolMetadata['current_task_lane_handoff_completed']
      }
    }
  }
  if (context.toolMetadata && toolName === 'shell') {
    const authoritativeVerificationCommands = parseAuthoritativeCommands(context.toolMetadata) ?? []
    const shellCommand = String(toolInput['command'] ?? '').trim()
    const executedCommand = String(resultMetadata?.['executedCommand'] ?? shellCommand).trim()
    rememberVerificationResult(context.toolMetadata, {
      shellCommand: executedCommand,
      shellOutput: String(resultMetadata?.['output'] ?? toolResult.content ?? ''),
      shellSucceeded: resultMetadata?.['success'] === true,
      authoritativeCommands: authoritativeVerificationCommands,
      usedAuthoritativeCommand: resultMetadata?.['usedAuthoritativeCommand'] === true,
    })
    if (
      latestCheckpointNextAction(context.toolMetadata).length > 0 &&
      authoritativeVerificationCommands.some((command) => command.trim() === executedCommand)
    ) {
      advanceCheckpointAfterVerification(context.toolMetadata)
    }
  }
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
    recordReviewHandoffEvidence(context.toolMetadata, toolName, filePath, resultMetadata)
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
