import { defineTool } from '@guildhall/engine'
import { z } from 'zod'
import { runGates } from './gate-runner.js'
import type { HardGate } from '@guildhall/core'

// ---------------------------------------------------------------------------
// run-gates engine tool — lets a gate-checker agent execute hard gates and
// receive structured pass/fail results. For deterministic callers (the
// orchestrator, tests) use runGates() directly from gate-runner.ts.
// ---------------------------------------------------------------------------

const hardGateSchema = z.object({
  id: z.string(),
  label: z.string(),
  command: z.string(),
  timeoutMs: z.number().default(120_000),
})

const runGatesInputSchema = z.object({
  cwd: z.string().describe('Absolute path to the project directory where gates run'),
  gates: z.array(hardGateSchema).describe('Hard gates to execute in order'),
  failFast: z
    .boolean()
    .default(false)
    .describe('Stop at the first failed gate rather than running all of them'),
  maxOutputBytes: z.number().optional(),
})

export type RunGatesToolInput = z.input<typeof runGatesInputSchema>

function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, ' ')
}

function classifyGateCommand(command: string): 'typecheck' | 'build' | 'test' | 'lint' | 'other' {
  const normalized = normalizeCommand(command).toLowerCase()
  if (/\b(typecheck|tsc(?:\s|$)|tsgo\b)/.test(normalized)) return 'typecheck'
  if (/\bbuild\b/.test(normalized)) return 'build'
  if (/\b(test|vitest|jest|playwright|pytest)\b/.test(normalized)) return 'test'
  if (/\blint\b/.test(normalized)) return 'lint'
  return 'other'
}

function defaultGateId(command: string, usedIds: Set<string>): string {
  const kind = classifyGateCommand(command)
  const preferred =
    kind === 'test' && /\bplaywright\b/i.test(command)
      ? 'playwright-e2e'
      : kind
  let id = preferred
  let suffix = 2
  while (usedIds.has(id)) {
    id = `${preferred}-${suffix}`
    suffix += 1
  }
  usedIds.add(id)
  return id
}

function defaultGateLabel(command: string): string {
  const kind = classifyGateCommand(command)
  if (kind === 'typecheck') return 'TypeScript typecheck'
  if (kind === 'build') return 'Build'
  if (kind === 'lint') return 'Lint'
  if (kind === 'test' && /\bplaywright\b/i.test(command)) return 'Playwright E2E test'
  if (kind === 'test') return 'Test'
  return command
}

function parseAuthoritativeCommands(metadata: Record<string, unknown>): string[] | null {
  const raw = metadata['current_task_success_gates']
  if (!Array.isArray(raw)) return null
  const commands = raw
    .filter((entry): entry is string => typeof entry === 'string')
    .map(normalizeCommand)
    .filter((entry) => entry.length > 0)
  return commands.length > 0 ? commands : []
}

export function reconcileRequestedGatesWithAuthority(
  requested: readonly HardGate[],
  authoritativeCommands: readonly string[] | null,
): { gates: HardGate[]; usedAuthority: boolean } {
  if (authoritativeCommands == null) {
    return { gates: [...requested], usedAuthority: false }
  }
  if (authoritativeCommands.length === 0) {
    return { gates: [], usedAuthority: true }
  }

  const remaining = [...requested]
  const usedIds = new Set<string>()
  const gates = authoritativeCommands.map((command) => {
    const normalized = normalizeCommand(command)
    const exactIdx = remaining.findIndex((gate) => normalizeCommand(gate.command) === normalized)
    const kind = classifyGateCommand(normalized)
    const fallbackIdx =
      exactIdx >= 0
        ? -1
        : remaining.findIndex((gate) => classifyGateCommand(gate.command) === kind)
    const match = exactIdx >= 0
      ? remaining.splice(exactIdx, 1)[0]
      : fallbackIdx >= 0
        ? remaining.splice(fallbackIdx, 1)[0]
        : undefined
    const id = match?.id && match.id.trim().length > 0
      ? match.id
      : defaultGateId(normalized, usedIds)
    usedIds.add(id)
    return {
      id,
      label: match?.label?.trim() ? match.label : defaultGateLabel(normalized),
      command: normalized,
      timeoutMs: match?.timeoutMs ?? 120_000,
    } satisfies HardGate
  })

  return { gates, usedAuthority: true }
}

export const runGatesTool = defineTool({
  name: 'run-gates',
  description:
    'Run a set of hard gates (shell commands) sequentially and report pass/fail for each. ' +
    'A task may only transition to done when every hard gate passes.',
  inputSchema: runGatesInputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      cwd: { type: 'string' },
      gates: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            label: { type: 'string' },
            command: { type: 'string' },
            timeoutMs: { type: 'number' },
          },
          required: ['id', 'label', 'command'],
        },
      },
      failFast: { type: 'boolean' },
      maxOutputBytes: { type: 'number' },
    },
    required: ['cwd', 'gates'],
  },
  isReadOnly: () => false,
  execute: async (input, ctx) => {
    const authoritativeCommands = parseAuthoritativeCommands(ctx.metadata)
    const effective = reconcileRequestedGatesWithAuthority(
      input.gates.map((g) => ({
        id: g.id,
        label: g.label,
        command: g.command,
        timeoutMs: g.timeoutMs ?? 120_000,
      })),
      authoritativeCommands,
    )
    const summary = await runGates({
      cwd: input.cwd,
      gates: effective.gates,
      failFast: input.failFast ?? false,
      ...(input.maxOutputBytes !== undefined ? { maxOutputBytes: input.maxOutputBytes } : {}),
    })

    const lines = [
      ...(effective.usedAuthority ? ['Using authoritative task-scoped hard gates.', ''] : []),
      `Gates: ${summary.allPassed ? 'ALL PASS' : 'SOME FAIL'} (${summary.results.filter((r) => r.passed).length}/${summary.results.length})`,
      ...summary.results.map(
        (r) => `- ${r.gateId}: ${r.passed ? 'pass' : 'FAIL'}${r.output ? `\n  ${r.output.split('\n').slice(0, 3).join('\n  ')}` : ''}`,
      ),
    ]

    return {
      output: lines.join('\n'),
      is_error: !summary.allPassed,
      metadata: {
        ...(summary as unknown as Record<string, unknown>),
        effectiveGates: effective.gates as unknown as Record<string, unknown>,
        usedAuthoritativeTaskGates: effective.usedAuthority,
      },
    }
  },
})
