import { defineTool } from '@guildhall/engine'
import { z } from 'zod'
import { runGates } from './gate-runner.js'
import fs from 'node:fs/promises'
import path from 'node:path'
import { appendTaskEvidence, inferProjectRootFromMemoryDir } from '@guildhall/sessions'
import type { HardGate } from '@guildhall/core'
import {
  parseAuthoritativeCommands,
  reconcileRequestedGatesWithAuthority,
} from '@guildhall/core'
import { summarizeScopedHardGateDisposition } from './gate-scope-exceptions.js'

export { reconcileRequestedGatesWithAuthority } from '@guildhall/core'

function metadataStringArray(metadata: Record<string, unknown>, key: string): string[] {
  return Array.isArray(metadata[key])
    ? (metadata[key] as unknown[]).filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : []
}

function isInsideOrSame(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child))
  return relative === '' || (
    !relative.startsWith(`..${path.sep}`) &&
    relative !== '..' &&
    !path.isAbsolute(relative)
  )
}

function reconcileGateCwdWithTaskScope(
  requestedCwd: string,
  metadata: Record<string, unknown>,
): string {
  const worktreePath = typeof metadata['current_task_worktree_path'] === 'string'
    ? metadata['current_task_worktree_path'].trim()
    : ''
  if (!worktreePath) return requestedCwd
  if (isInsideOrSame(worktreePath, requestedCwd)) return path.resolve(requestedCwd)

  const projectPath = typeof metadata['current_task_project_path'] === 'string'
    ? metadata['current_task_project_path'].trim()
    : ''
  const worktreeProjectPath = typeof metadata['current_task_worktree_project_path'] === 'string'
    ? metadata['current_task_worktree_project_path'].trim()
    : ''
  if (projectPath && worktreeProjectPath && isInsideOrSame(projectPath, requestedCwd)) {
    return path.resolve(
      worktreeProjectPath,
      path.relative(path.resolve(projectPath), path.resolve(requestedCwd)),
    )
  }

  const workspaceProjectPath = typeof metadata['current_task_workspace_project_path'] === 'string'
    ? metadata['current_task_workspace_project_path'].trim()
    : ''
  if (workspaceProjectPath && isInsideOrSame(workspaceProjectPath, requestedCwd)) {
    return path.resolve(
      worktreePath,
      path.relative(path.resolve(workspaceProjectPath), path.resolve(requestedCwd)),
    )
  }

  return requestedCwd
}

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

async function persistGateResultsForCurrentTask(input: {
  metadata: Record<string, unknown>
  results: Array<{ gateId: string; type: 'hard' | 'soft'; passed: boolean; output?: string; checkedAt: string }>
}): Promise<boolean> {
  const taskId = typeof input.metadata['current_task_id'] === 'string'
    ? input.metadata['current_task_id']
    : ''
  const tasksPath = typeof input.metadata['tasks_path'] === 'string'
    ? input.metadata['tasks_path']
    : ''
  if (!taskId || !tasksPath) return false

  try {
    const raw = await fs.readFile(tasksPath, 'utf8')
    const queue = JSON.parse(raw) as {
      version: number
      lastUpdated: string
      tasks: Array<Record<string, unknown>>
    }
    const task = queue.tasks.find((candidate) => candidate['id'] === taskId)
    if (!task) return false

    const projectRoot = inferProjectRootFromMemoryDir(path.dirname(tasksPath))
    await Promise.all(input.results.map((result) =>
      appendTaskEvidence(projectRoot, taskId, {
        id: `${taskId}-gate-${result.gateId}-${result.checkedAt.replace(/[^0-9A-Za-z]/g, '')}`,
        kind: 'gate_result',
        recordedAt: result.checkedAt,
        payload: result,
      }).catch(() => undefined),
    ))
    return true
  } catch {
    return false
  }
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
    const effectiveCwd = reconcileGateCwdWithTaskScope(input.cwd, ctx.metadata)
    const summary = await runGates({
      cwd: effectiveCwd,
      gates: effective.gates,
      failFast: input.failFast ?? false,
      ...(input.maxOutputBytes !== undefined ? { maxOutputBytes: input.maxOutputBytes } : {}),
    })
    const scopeDisposition = summarizeScopedHardGateDisposition(
      {
        projectPath:
          typeof ctx.metadata['current_task_project_path'] === 'string'
            ? ctx.metadata['current_task_project_path']
            : input.cwd,
        likelyTargetFiles: metadataStringArray(ctx.metadata, 'current_task_likely_target_files'),
        resolvedDecisionTexts: metadataStringArray(ctx.metadata, 'current_task_resolved_scope_decisions'),
      },
      summary.results,
    )
    const persistedTaskGateResults = await persistGateResultsForCurrentTask({
      metadata: ctx.metadata,
      results: summary.results,
    })
    const effectiveAllPassed = scopeDisposition?.shouldPass ?? summary.allPassed

    const lines = [
      ...(effective.usedAuthority ? ['Using authoritative task-scoped hard gates.', ''] : []),
      ...(scopeDisposition?.exemptedFailures.length
        ? [
            `Scoped exception: ${scopeDisposition.exemptedFailures.map((gate) => gate.gateId).join(', ')} failed only outside the task target files and is exempt from blocking this task.`,
            '',
          ]
        : []),
      `Gates: ${effectiveAllPassed ? 'ALL PASS' : 'SOME FAIL'} (${summary.results.filter((r) => r.passed).length}/${summary.results.length} raw)`,
      ...summary.results.map(
        (r) => `- ${r.gateId}: ${r.passed ? 'pass' : 'FAIL'}${r.output ? `\n  ${r.output.split('\n').slice(0, 3).join('\n  ')}` : ''}`,
      ),
    ]

    return {
      output: lines.join('\n'),
      is_error: !effectiveAllPassed,
      metadata: {
        ...(summary as unknown as Record<string, unknown>),
        effectiveGates: effective.gates as unknown as Record<string, unknown>,
        usedAuthoritativeTaskGates: effective.usedAuthority,
        persistedTaskGateResults,
        effectiveAllPassed,
        scopeExemptFailures: scopeDisposition?.exemptedFailures as unknown as Record<string, unknown>,
      },
    }
  },
})
