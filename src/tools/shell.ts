/**
 * Shell command tool.
 *
 * Ported from openharness/src/openharness/tools/bash_tool.py
 * Upstream: https://github.com/HKUDS/OpenHarness (MIT)
 * Upstream SHA at port time: 559ba76f237db957a1a21453170df8500479dc7d
 *
 * Changes from upstream:
 *   - PTY branch is dropped — our async spawn path has no PTY mode, and Guildhall
 *     has not added a PTY dependency. This is only a loss for tools that
 *     auto-detect a TTY; the non-interactive preflight below catches the
 *     most common case (scaffolding CLIs).
 *   - Sandbox/`SandboxUnavailableError` branch is deferred — Guildhall
 *     does not yet ship a Docker sandbox adapter.
 */

import { defineTool } from '@guildhall/engine'
import { z } from 'zod'
import { execSync, spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import {
  classifyGateCommand,
  parseAuthoritativeCommands,
  reconcileShellCommandWithAuthority,
} from '@guildhall/core'
import { providerCommandEnv } from '@guildhall/config/global-providers'

const OUTPUT_TRUNCATE_LIMIT = 12_000

const shellInputSchema = z.object({
  command: z.string().describe('The shell command to run'),
  cwd: z.string().optional().describe('Absolute path to the working directory. Defaults to the active project directory when omitted.'),
  timeoutMs: z.number().default(120_000).describe('Timeout in milliseconds'),
  env: z.record(z.string()).optional().describe('Optional environment variable overrides for the shell command.'),
})

export type ShellInput = z.input<typeof shellInputSchema>
export interface ShellResult {
  success: boolean
  output: string
  exitCode: number
  /** True when preflight blocked execution because the command needs a TTY. */
  interactiveRequired?: boolean
  /** True when the child was killed by the timeout watchdog. */
  timedOut?: boolean
}

function shellProcessEnv(env: Record<string, string> | undefined): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...providerCommandEnv(),
    ...(env ?? {}),
  }
}

function resolveShellCwd(inputCwd: string | undefined, fallbackCwd: string | undefined): string {
  const cwd = inputCwd?.trim() || fallbackCwd?.trim()
  if (!cwd) {
    throw new Error('Shell tool requires a working directory, but none was provided or available from runtime context.')
  }
  return cwd
}

function stripShellCdQuotes(value: string): string {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function cwdFromLeadingCdChain(command: string, baseCwd: string): string | null {
  let rest = command.trim()
  let cwd = path.resolve(baseCwd)
  let moved = false
  const cdPrefix = /^cd\s+("[^"]+"|'[^']+'|[^&;]+?)\s*&&\s*/i
  while (true) {
    const match = cdPrefix.exec(rest)
    if (!match) break
    const target = stripShellCdQuotes(match[1] ?? '')
    if (!target) break
    cwd = path.resolve(cwd, target)
    rest = rest.slice(match[0].length).trimStart()
    moved = true
  }
  return moved ? cwd : null
}

function reconcileShellCwdWithTaskScope(
  requestedCwd: string,
  metadata: Record<string, unknown> | undefined,
): string {
  const worktreePath = String(metadata?.['current_task_worktree_path'] ?? '').trim()
  if (!worktreePath) return requestedCwd

  const normalizedWorktree = path.resolve(worktreePath)
  const normalizedRequested = path.resolve(requestedCwd)
  const relativeToWorktree = path.relative(normalizedWorktree, normalizedRequested)
  if (
    relativeToWorktree === '' ||
    (!relativeToWorktree.startsWith(`..${path.sep}`) &&
      relativeToWorktree !== '..' &&
      !path.isAbsolute(relativeToWorktree))
  ) {
    return normalizedRequested
  }

  const projectPath = String(metadata?.['current_task_project_path'] ?? '').trim()
  const worktreeProjectPath = String(metadata?.['current_task_worktree_project_path'] ?? '').trim()
  const workspaceProjectPath = String(metadata?.['current_task_workspace_project_path'] ?? '').trim()

  if (projectPath && worktreeProjectPath) {
    const normalizedProject = path.resolve(projectPath)
    const normalizedWorktreeProject = path.resolve(worktreeProjectPath)
    const relativeToProject = path.relative(normalizedProject, normalizedRequested)
    if (
      relativeToProject === '' ||
      (!relativeToProject.startsWith(`..${path.sep}`) &&
        relativeToProject !== '..' &&
        !path.isAbsolute(relativeToProject))
    ) {
      return path.resolve(normalizedWorktreeProject, relativeToProject)
    }
  }

  if (workspaceProjectPath) {
    const normalizedWorkspace = path.resolve(workspaceProjectPath)
    const relativeToWorkspace = path.relative(normalizedWorkspace, normalizedRequested)
    if (
      relativeToWorkspace === '' ||
      (!relativeToWorkspace.startsWith(`..${path.sep}`) &&
        relativeToWorkspace !== '..' &&
        !path.isAbsolute(relativeToWorkspace))
    ) {
      return path.resolve(normalizedWorktree, relativeToWorkspace)
    }
  }

  if (!projectPath) return normalizedWorktree

  const normalizedProject = path.resolve(projectPath)
  const relativeToProject = path.relative(normalizedProject, normalizedRequested)
  if (
    relativeToProject === '' ||
    (!relativeToProject.startsWith(`..${path.sep}`) &&
      relativeToProject !== '..' &&
      !path.isAbsolute(relativeToProject))
  ) {
    return path.resolve(normalizedWorktree, relativeToProject)
  }

  return normalizedRequested
}

const SCAFFOLD_MARKERS = [
  'create-next-app',
  'npm create ',
  'pnpm create ',
  'yarn create ',
  'bun create ',
  'pnpm dlx ',
  'npm init ',
  'pnpm init ',
  'yarn init ',
  'bunx create-',
  'npx create-',
] as const

const NON_INTERACTIVE_MARKERS = [
  '--yes',
  ' -y',
  '--skip-install',
  '--defaults',
  '--non-interactive',
  '--ci',
] as const

const PROMPT_MARKERS = [
  'would you like',
  'ok to proceed',
  'select an option',
  'which',
  'press enter to continue',
  '?',
] as const

function looksLikeInteractiveScaffold(lowered: string): boolean {
  const hasScaffold = SCAFFOLD_MARKERS.some((m) => lowered.includes(m))
  if (!hasScaffold) return false
  const hasNonInteractive = NON_INTERACTIVE_MARKERS.some((m) => lowered.includes(m))
  return !hasNonInteractive
}

function looksLikePrompt(output: string): boolean {
  if (!output) return false
  const lowered = output.toLowerCase()
  return PROMPT_MARKERS.some((m) => lowered.includes(m))
}

function preflightInteractive(command: string): string | null {
  if (!looksLikeInteractiveScaffold(command.toLowerCase())) return null
  return (
    'This command appears to require interactive input before it can continue. ' +
    'The shell tool is non-interactive, so it cannot answer installer/scaffold prompts live. ' +
    'Prefer non-interactive flags (for example --yes, -y, --skip-install, --defaults, --non-interactive), ' +
    'or run the scaffolding step once in an external terminal before asking the agent to continue.'
  )
}

function metadataStringArray(metadata: Record<string, unknown> | undefined, key: string): string[] {
  const raw = metadata?.[key]
  return Array.isArray(raw)
    ? raw.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : []
}

function pnpmFilterPackage(command: string): string | null {
  const match = /\bpnpm\s+(?:--filter|-F)\s+(@?[\w./-]+)/i.exec(command)
  return match?.[1]?.trim() ?? null
}

function packageDirectoryFromFilter(filter: string): string | null {
  const normalized = filter.replace(/^['"]|['"]$/g, '').replace(/^\.\//, '')
  if (normalized.includes('/')) {
    const last = normalized.split('/').filter(Boolean).at(-1)
    return last ? `packages/${last}/` : null
  }
  return normalized ? `packages/${normalized}/` : null
}

function allowsFocusedSupplementalVerification(
  command: string,
  metadata: Record<string, unknown> | undefined,
): boolean {
  const lowered = command.toLowerCase()
  if (/\b(e2e|browser|playwright)\b/.test(lowered)) return true
  if (!/\b(test|vitest)\b/.test(lowered)) return false

  const filter = pnpmFilterPackage(command)
  const packageDir = filter ? packageDirectoryFromFilter(filter) : null
  if (!packageDir) return false

  const likelyTargets = metadataStringArray(metadata, 'current_task_likely_target_files')
  return likelyTargets.some((target) => target.replaceAll(path.sep, '/').includes(packageDir))
}

function interactiveHint(command: string, output: string): string | null {
  if (looksLikeInteractiveScaffold(command.toLowerCase()) || looksLikePrompt(output)) {
    return (
      'This command appears to require interactive input. ' +
      'The shell tool is non-interactive, so prefer non-interactive flags ' +
      '(for example --yes, -y, --skip-install, or similar) or run the ' +
      'scaffolding step once in an external terminal before continuing.'
    )
  }
  return null
}

function formatOutput(raw: string): string {
  const normalized = raw.replace(/\r\n/g, '\n').trim()
  if (!normalized) return '(no output)'
  if (normalized.length > OUTPUT_TRUNCATE_LIMIT) {
    return `${normalized.slice(0, OUTPUT_TRUNCATE_LIMIT)}\n...[truncated]...`
  }
  return normalized
}

function formatTimeoutOutput(raw: string, command: string, timeoutMs: number): string {
  const text = formatOutput(raw)
  const seconds = Math.round(timeoutMs / 1000)
  const parts: string[] = [`Command timed out after ${seconds} seconds.`]
  if (text !== '(no output)') parts.push('', 'Partial output:', text)
  const hint = interactiveHint(command, text)
  if (hint) parts.push('', hint)
  return parts.join('\n')
}

function hasTaskScopedFileMutationGuard(metadata: Record<string, unknown> | undefined): boolean {
  if (!metadata) return false
  const worktreePath = String(metadata['current_task_worktree_path'] ?? '').trim()
  if (worktreePath) return true
  const missingTarget = String(metadata['current_missing_likely_target_file'] ?? '').trim()
  if (missingTarget) return true
  const likelyTargets = metadata['current_task_likely_target_files']
  return Array.isArray(likelyTargets)
    && likelyTargets.some((value) => typeof value === 'string' && value.trim().length > 0)
}

function looksLikeDirectFileWrite(command: string): boolean {
  const hasStdoutRedirect = /(^|[^0-9])>>?/.test(command)
  const hasHereDoc = /<<[-~]?['"]?[A-Za-z0-9_]+['"]?/.test(command)
  const hasTee = /\btee\b/.test(command)
  return hasStdoutRedirect || hasHereDoc || hasTee
}

function shellWriteTargets(command: string, cwd: string): string[] {
  const targets: string[] = []
  const addTarget = (raw: string | undefined) => {
    const value = raw?.trim()
    if (!value || value.startsWith('&') || value.startsWith('(')) return
    targets.push(path.resolve(cwd, stripShellCdQuotes(value)))
  }
  const redirectPattern = /(^|[^0-9])>>?\s*("[^"]+"|'[^']+'|[^\s;&|]+)/g
  for (const match of command.matchAll(redirectPattern)) {
    addTarget(match[2])
  }
  const teePattern = /\btee(?:\s+-a)?\s+("[^"]+"|'[^']+'|[^\s;&|]+)/g
  for (const match of command.matchAll(teePattern)) {
    addTarget(match[1])
  }
  return targets
}

function shellWriteTouchesTaskScope(command: string, cwd: string, metadata: Record<string, unknown> | undefined): boolean {
  const targets = shellWriteTargets(command, cwd)
  if (targets.length === 0) return true
  const protectedRoots = [
    String(metadata?.['current_task_project_path'] ?? '').trim(),
    String(metadata?.['current_task_worktree_path'] ?? '').trim(),
  ].filter(Boolean).map(root => path.resolve(root))
  if (protectedRoots.length === 0) return true
  return targets.some(target => protectedRoots.some(root => target === root || target.startsWith(`${root}${path.sep}`)))
}

function directFileWriteGuardMessage(metadata: Record<string, unknown> | undefined): string {
  const missingTarget = String(metadata?.['current_missing_likely_target_file'] ?? '').trim()
  const likelyTargets = Array.isArray(metadata?.['current_task_likely_target_files'])
    ? (metadata?.['current_task_likely_target_files'] as unknown[])
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : []
  const preferredTarget = missingTarget || likelyTargets[0] || ''
  const targetHint = preferredTarget
    ? ` Use write-file or edit-file for ${preferredTarget} instead.`
    : ' Use write-file or edit-file instead.'
  return (
    'Shell-based file writes are blocked for active coding tasks. '
    + 'Use shell for builds, tests, lint, and focused verification only.'
    + targetHint
  )
}

function normalizePnpmScopedScriptCommand(command: string): string {
  return command.replace(
    /^pnpm\s+(--dir|-C)\s+(\S+)\s+(test)(\s.*)?$/i,
    (_match, flag: string, dir: string, script: string, rest: string | undefined) =>
      `pnpm ${flag} ${dir} run ${script}${rest ?? ''}`,
  )
}

function normalizeShellCommand(command: string): string {
  return command.trim().replace(/\s+/g, ' ')
}

function isSelfReferentialGuildhallTaskCommand(command: string): boolean {
  const normalized = normalizeShellCommand(command)
  return /\b(?:npx\s+)?guildhall\s+run\b/i.test(normalized) && /\s--task(?:=|\s)/i.test(normalized)
}

function readPackageScriptBody(cwd: string, scriptName: string): string | null {
  const packageJsonPath = path.join(cwd, 'package.json')
  if (!existsSync(packageJsonPath)) return null
  try {
    const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      scripts?: Record<string, unknown>
    }
    const body = parsed.scripts?.[scriptName]
    return typeof body === 'string' ? body : null
  } catch {
    return null
  }
}

function shellCommandScriptTarget(command: string, cwd: string): { scriptName: string; cwd: string } | null {
  const normalized = normalizeShellCommand(command)
  const dirMatch = /^pnpm\s+(?:--dir|-C)\s+(\S+)\s+(?:run\s+)?([a-z0-9:_-]+)(?:\s|$)/i.exec(normalized)
  if (dirMatch) {
    return { cwd: path.resolve(cwd, dirMatch[1]!), scriptName: dirMatch[2]! }
  }
  const pnpmMatch = /^pnpm\s+(?:run\s+)?([a-z0-9:_-]+)(?:\s|$)/i.exec(normalized)
  if (pnpmMatch) return { cwd, scriptName: pnpmMatch[1]! }
  const npmMatch = /^npm\s+run\s+([a-z0-9:_-]+)(?:\s|$)/i.exec(normalized)
  if (npmMatch) return { cwd, scriptName: npmMatch[1]! }
  const yarnMatch = /^yarn\s+([a-z0-9:_-]+)(?:\s|$)/i.exec(normalized)
  if (yarnMatch) return { cwd, scriptName: yarnMatch[1]! }
  return null
}

function blockedGuildhallTaskProofMessage(command: string): string {
  return (
    `Blocked \`${command}\` as task proof because it delegates back to Guildhall orchestration. ` +
    'A project proof command must exercise the project itself, such as a typecheck, build, test, fixture runner, or explicit validation script.'
  )
}

function selfReferentialGuildhallTaskProofBlock(command: string, cwd: string): string | null {
  if (isSelfReferentialGuildhallTaskCommand(command)) {
    return blockedGuildhallTaskProofMessage(command)
  }
  const target = shellCommandScriptTarget(command, cwd)
  if (!target) return null
  const scriptBody = readPackageScriptBody(target.cwd, target.scriptName)
  if (!scriptBody || !isSelfReferentialGuildhallTaskCommand(scriptBody)) return null
  return blockedGuildhallTaskProofMessage(`${command} (${target.scriptName}: ${scriptBody})`)
}

function normalizeExecErrorOutput(err: {
  stdout?: string | Buffer
  stderr?: string | Buffer
}): string {
  return [err.stdout, err.stderr]
    .map((b) => (typeof b === 'string' ? b : b?.toString('utf-8') ?? ''))
    .filter((s) => s.length > 0)
    .join('\n')
}

function killProcessTree(child: ReturnType<typeof spawn>, signal: NodeJS.Signals): void {
  if (!child.pid) return
  try {
    if (process.platform === 'win32') {
      child.kill(signal)
    } else {
      process.kill(-child.pid, signal)
    }
  } catch {
    try {
      child.kill(signal)
    } catch {
      // process may already be gone
    }
  }
}

export function runShellSync(input: ShellInput): ShellResult {
  const { command, timeoutMs = 120_000, env } = input
  const cwd = resolveShellCwd(input.cwd, undefined)

  const blocked = preflightInteractive(command)
  if (blocked) {
    return {
      success: false,
      output: blocked,
      exitCode: -1,
      interactiveRequired: true,
    }
  }

  try {
    const output = execSync(command, {
      cwd,
      timeout: timeoutMs,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: shellProcessEnv(env),
    })
    return { success: true, output: formatOutput(output), exitCode: 0 }
  } catch (err: unknown) {
    const execErr = err as {
      stdout?: string | Buffer
      stderr?: string | Buffer
      status?: number | null
      signal?: NodeJS.Signals | null
    }
    const rawOut = normalizeExecErrorOutput(execErr)

    // Node's execSync signals timeout via signal=SIGTERM + status=null.
    const timedOut = execErr.signal === 'SIGTERM' && execErr.status == null
    if (timedOut) {
      return {
        success: false,
        output: formatTimeoutOutput(rawOut, command, timeoutMs),
        exitCode: -1,
        timedOut: true,
      }
    }

    return {
      success: false,
      output: formatOutput(rawOut),
      exitCode: execErr.status ?? 1,
    }
  }
}

export async function runShell(input: ShellInput): Promise<ShellResult> {
  const { command, timeoutMs = 120_000, env } = input
  const cwd = resolveShellCwd(input.cwd, undefined)

  const blocked = preflightInteractive(command)
  if (blocked) {
    return {
      success: false,
      output: blocked,
      exitCode: -1,
      interactiveRequired: true,
    }
  }

  return await new Promise<ShellResult>((resolve) => {
    const child = spawn('sh', ['-c', command], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: shellProcessEnv(env),
      detached: process.platform !== 'win32',
    })

    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false

    const settle = (result: ShellResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }

    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => { stdout += chunk })
    child.stderr?.on('data', (chunk: string) => { stderr += chunk })

    child.on('error', (err) => {
      settle({
        success: false,
        output: formatOutput(String(err)),
        exitCode: 1,
      })
    })

    child.on('close', (code, signal) => {
      const rawOut = [stdout, stderr].filter(Boolean).join('\n')
      if (timedOut || (signal === 'SIGTERM' && timedOut)) {
        settle({
          success: false,
          output: formatTimeoutOutput(rawOut, command, timeoutMs),
          exitCode: -1,
          timedOut: true,
        })
        return
      }
      settle({
        success: code === 0,
        output: formatOutput(rawOut),
        exitCode: code ?? 1,
      })
    })

    const timer = setTimeout(() => {
      timedOut = true
      killProcessTree(child, 'SIGTERM')
      setTimeout(() => killProcessTree(child, 'SIGKILL'), 1000).unref()
    }, timeoutMs)
    timer.unref()
  })
}

/**
 * Run a shell command in a given working directory.
 * Used by gate-checker and worker agents to run builds, tests, etc.
 *
 * Engine tool shape: returns { output, is_error, metadata } where metadata
 * carries the structured { success, exitCode, output } for programmatic
 * callers (orchestrator, tests). The LLM-facing `output` is the combined
 * stdout+stderr trimmed, truncated at 12000 chars so a runaway `npm install`
 * can't blow out the agent's context window.
 */
export const shellTool = defineTool({
  name: 'shell',
  description:
    'Run a shell command in a project directory. Returns output and success status. Use for builds, typechecks, tests, and lint.',
  inputSchema: shellInputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The shell command to run' },
      cwd: { type: 'string', description: 'Absolute path to the working directory. Defaults to the active project directory when omitted.' },
      timeoutMs: { type: 'number', description: 'Timeout in milliseconds', default: 120_000 },
    },
    required: ['command'],
  },
  isReadOnly: () => false,
  execute: async (input, ctx) => {
    const authoritativeCommands = parseAuthoritativeCommands(ctx.metadata)
    const requestedCwd = resolveShellCwd(input.cwd, ctx.cwd)
    const verificationCwd = String(ctx.metadata?.['current_task_verification_cwd'] ?? '').trim()
    const authorityPreferredCwd =
      !input.cwd && verificationCwd && authoritativeCommands && authoritativeCommands.length > 0
        ? verificationCwd
        : requestedCwd
    const worktreePath = String(ctx.metadata?.['current_task_worktree_path'] ?? '').trim()
    const cdBaseCwd =
      authoritativeCommands && authoritativeCommands.length > 0 && worktreePath
        ? worktreePath
        : authorityPreferredCwd
    const cdAdjustedCwd = cwdFromLeadingCdChain(input.command, cdBaseCwd) ?? authorityPreferredCwd
    const reconciled = reconcileShellCommandWithAuthority(input.command, authoritativeCommands)
    const requestedKind = classifyGateCommand(input.command)
    const executableCommand = normalizePnpmScopedScriptCommand(reconciled.command)
    if (
      authoritativeCommands &&
      authoritativeCommands.length > 0 &&
      requestedKind !== 'other' &&
      !reconciled.usedAuthority &&
      !allowsFocusedSupplementalVerification(input.command, ctx.metadata)
    ) {
      return {
        output:
          `This task already has authoritative verification commands. ` +
          `Do not invent a different ${requestedKind} command here.\n\n` +
          `Use one of:\n${authoritativeCommands.map((command) => `- ${command}`).join('\n')}`,
        is_error: true,
        metadata: {
          success: false,
          exitCode: 2,
          requestedCommand: input.command,
          executedCommand: reconciled.command,
          usedAuthoritativeCommand: false,
          blockedUnauthorizedVerificationCommand: true,
          authoritativeCommands,
        } as unknown as Record<string, unknown>,
      }
    }
    const effectiveCwd = reconcileShellCwdWithTaskScope(cdAdjustedCwd, ctx.metadata)
    const selfReferentialProofBlock = selfReferentialGuildhallTaskProofBlock(executableCommand, effectiveCwd)
    if (selfReferentialProofBlock) {
      return {
        output: selfReferentialProofBlock,
        is_error: true,
        metadata: {
          success: false,
          exitCode: 2,
          requestedCommand: input.command,
          executedCommand: executableCommand,
          usedAuthoritativeCommand: reconciled.usedAuthority,
          blockedSelfReferentialGuildhallTaskProof: true,
        } as unknown as Record<string, unknown>,
      }
    }
    if (
      hasTaskScopedFileMutationGuard(ctx.metadata) &&
      looksLikeDirectFileWrite(executableCommand) &&
      shellWriteTouchesTaskScope(executableCommand, effectiveCwd, ctx.metadata)
    ) {
      return {
        output: directFileWriteGuardMessage(ctx.metadata),
        is_error: true,
        metadata: {
          success: false,
          exitCode: 2,
          requestedCommand: input.command,
          executedCommand: executableCommand,
          usedAuthoritativeCommand: reconciled.usedAuthority,
          blockedDirectFileWrite: true,
        } as unknown as Record<string, unknown>,
      }
    }
    const normalizedInput: ShellInput = {
      ...input,
      command: executableCommand,
      cwd: effectiveCwd,
      env: {
        ...(input.env ?? {}),
        ...(ctx.metadata?.['current_task_project_path'] || ctx.metadata?.['current_task_worktree_path']
          ? { CI: input.env?.CI ?? 'true' }
          : {}),
      },
    }
    const result = await runShell(normalizedInput)
    const orientationLine = `Working directory: ${effectiveCwd}`
    const statusLine = result.success
      ? `Shell command succeeded (exit ${result.exitCode}). Treat this command as PASSED; if it was required verification, record it and continue the handoff. Do not edit warning-only output unless the task explicitly requires warning-free output.`
      : result.timedOut
        ? `Shell command timed out (exit ${result.exitCode}).`
        : `Shell command failed (exit ${result.exitCode}).`
    return {
      output: result.output.trim().length > 0
        ? `${statusLine}\n${orientationLine}\n${result.output}`
        : `${statusLine}\n${orientationLine}`,
      is_error: !result.success,
      metadata: {
        ...result,
        requestedCommand: input.command,
        executedCommand: executableCommand,
        usedAuthoritativeCommand: reconciled.usedAuthority,
        requestedCwd,
        cdAdjustedCwd,
        executedCwd: effectiveCwd,
      } as unknown as Record<string, unknown>,
    }
  },
})
