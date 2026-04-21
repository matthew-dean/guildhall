import { defineTool } from '@guildhall/engine'
import { z } from 'zod'
import { execSync } from 'node:child_process'

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
}

export function runShell(input: ShellInput): ShellResult {
  const { command, cwd, timeoutMs = 120_000 } = input
  try {
    const output = execSync(command, {
      cwd,
      timeout: timeoutMs,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return { success: true, output: output.trim(), exitCode: 0 }
  } catch (err: unknown) {
    const execErr = err as { stdout?: string; stderr?: string; status?: number }
    const output = [execErr.stdout, execErr.stderr].filter(Boolean).join('\n').trim()
    return { success: false, output, exitCode: execErr.status ?? 1 }
  }
}

/**
 * Run a shell command in a given working directory.
 * Used by gate-checker and worker agents to run builds, tests, etc.
 *
 * Engine tool shape: returns { output, is_error, metadata } where metadata
 * carries the structured { success, exitCode, output } for programmatic
 * callers (orchestrator, tests). The LLM-facing `output` is the combined
 * stdout+stderr trimmed.
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
      output: result.output || (result.success ? '(no output)' : `(exit ${result.exitCode})`),
      is_error: !result.success,
      metadata: result as unknown as Record<string, unknown>,
    }
  },
})
