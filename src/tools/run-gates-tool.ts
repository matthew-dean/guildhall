import { defineTool } from '@guildhall/engine'
import { z } from 'zod'
import { runGates } from './gate-runner.js'

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
  execute: async (input) => {
    const summary = await runGates({
      cwd: input.cwd,
      gates: input.gates.map((g) => ({
        id: g.id,
        label: g.label,
        command: g.command,
        timeoutMs: g.timeoutMs ?? 120_000,
      })),
      failFast: input.failFast ?? false,
      ...(input.maxOutputBytes !== undefined ? { maxOutputBytes: input.maxOutputBytes } : {}),
    })

    const lines = [
      `Gates: ${summary.allPassed ? 'ALL PASS' : 'SOME FAIL'} (${summary.results.filter((r) => r.passed).length}/${summary.results.length})`,
      ...summary.results.map(
        (r) => `- ${r.gateId}: ${r.passed ? 'pass' : 'FAIL'}${r.output ? `\n  ${r.output.split('\n').slice(0, 3).join('\n  ')}` : ''}`,
      ),
    ]

    return {
      output: lines.join('\n'),
      is_error: !summary.allPassed,
      metadata: summary as unknown as Record<string, unknown>,
    }
  },
})
