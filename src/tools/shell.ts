/**
 * Shell command tool.
 *
 * Ported from openharness/src/openharness/tools/bash_tool.py
 * Upstream: https://github.com/HKUDS/OpenHarness (MIT)
 * Upstream SHA at port time: 559ba76f237db957a1a21453170df8500479dc7d
 *
 * Changes from upstream:
 *   - Stays synchronous via `execSync` rather than spawning an async
 *     subprocess. Upstream runs in a long-lived Python agent loop where
 *     blocking would starve other coroutines; Guildhall runs shell tools
 *     inside already-async agent executors where blocking a single worker
 *     fiber is fine, and converting `runShell` → async would cascade
 *     through `runBootstrap` and every orchestrator call site.
 *   - PTY branch is dropped — `execSync` has no PTY mode, and Guildhall
 *     has not added a PTY dependency. This is only a loss for tools that
 *     auto-detect a TTY; the non-interactive preflight below catches the
 *     most common case (scaffolding CLIs).
 *   - Sandbox/`SandboxUnavailableError` branch is deferred — Guildhall
 *     does not yet ship a Docker sandbox adapter.
 */

import { defineTool } from '@guildhall/engine'
import { z } from 'zod'
import { execSync } from 'node:child_process'

const OUTPUT_TRUNCATE_LIMIT = 12_000

const shellInputSchema = z.object({
  command: z.string().describe('The shell command to run'),
  cwd: z.string().describe('Absolute path to the working directory'),
  timeoutMs: z.number().default(120_000).describe('Timeout in milliseconds'),
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

export function runShell(input: ShellInput): ShellResult {
  const { command, cwd, timeoutMs = 120_000 } = input

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
    })
    return { success: true, output: formatOutput(output), exitCode: 0 }
  } catch (err: unknown) {
    const execErr = err as {
      stdout?: string | Buffer
      stderr?: string | Buffer
      status?: number | null
      signal?: NodeJS.Signals | null
    }
    const rawOut =
      [execErr.stdout, execErr.stderr]
        .map((b) => (typeof b === 'string' ? b : b?.toString('utf-8') ?? ''))
        .filter((s) => s.length > 0)
        .join('\n')

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
      cwd: { type: 'string', description: 'Absolute path to the working directory' },
      timeoutMs: { type: 'number', description: 'Timeout in milliseconds', default: 120_000 },
    },
    required: ['command', 'cwd'],
  },
  isReadOnly: () => false,
  execute: async (input) => {
    const result = runShell(input)
    return {
      output: result.output,
      is_error: !result.success,
      metadata: result as unknown as Record<string, unknown>,
    }
  },
})
