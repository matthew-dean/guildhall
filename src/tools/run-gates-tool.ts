import { appendManagedTextFile, readManagedTextFile, readManagedTextFileSync } from '@guildhall/persistence'
import { defineTool } from '@guildhall/engine'
import { z } from 'zod'
import { runGates } from './gate-runner.js'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  appendTaskEvidence,
  flushTaskEvidenceOutboxForTasksPath,
  readProjectStateDatabaseCurrentAuthorityFromTasksPath,
  readProjectStateDatabaseTaskEvidenceAuthorityFromTasksPath,
} from '@guildhall/sessions'
import type { HardGate } from '@guildhall/core'
import {
  parseAuthoritativeCommands,
  reconcileRequestedGatesWithAuthority,
  TaskGateScopeException,
} from '@guildhall/core'
import { summarizeScopedHardGateDisposition } from './gate-scope-exceptions.js'
import { commandResultSatisfiesProofContract, recordCommandProofPathResults } from '@guildhall/runtime/proof-paths'
import {
  readProjectTaskQueueForMutationSync,
  writePromotedTaskDetailMutation,
  writeProjectTaskQueueWithSummary,
} from '@guildhall/runtime/project-state-boundary'

export { reconcileRequestedGatesWithAuthority } from '@guildhall/core'

function metadataStringArray(metadata: Record<string, unknown>, key: string): string[] {
  return Array.isArray(metadata[key])
    ? (metadata[key] as unknown[]).filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : []
}

function metadataGateScopeExceptions(metadata: Record<string, unknown>): TaskGateScopeException[] {
  const parsed = TaskGateScopeException.array().safeParse(metadata['current_task_gate_scope_exceptions'])
  return parsed.success ? parsed.data : []
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
  cwd: string
  metadata: Record<string, unknown>
  gates: Array<{ id: string; command: string }>
  results: Array<{ gateId: string; command?: string; type: 'hard' | 'soft'; passed: boolean; output?: string; checkedAt: string }>
}): Promise<{ persisted: boolean; proofContractFailureIds: string[] }> {
  const taskId = typeof input.metadata['current_task_id'] === 'string'
    ? input.metadata['current_task_id']
    : ''
  const tasksPath = typeof input.metadata['tasks_path'] === 'string'
    ? input.metadata['tasks_path']
    : ''
  if (!taskId || !tasksPath) return { persisted: false, proofContractFailureIds: [] }

  try {
    const queueRead = readProjectTaskQueueForMutationSync(tasksPath)
    const queue = queueRead.queue as {
      version: number
      lastUpdated: string
      tasks: Array<Record<string, unknown>>
    }
    const task = queue.tasks.find((candidate) => candidate['id'] === taskId)
    if (!task) return { persisted: false, proofContractFailureIds: [] }

    const projectRoot = typeof input.metadata['current_task_project_path'] === 'string'
      ? input.metadata['current_task_project_path']
      : typeof input.metadata['current_task_workspace_project_path'] === 'string'
        ? input.metadata['current_task_workspace_project_path']
        : input.cwd
    const databaseAuthority = readProjectStateDatabaseCurrentAuthorityFromTasksPath(tasksPath) === 'database'
    const nextTask = structuredClone(task)
    const events = input.results.map((result) => ({
      id: `${taskId}-gate-${result.gateId}-${result.checkedAt.replace(/[^0-9A-Za-z]/g, '')}`,
      taskId,
      kind: 'gate_result' as const,
      recordedAt: result.checkedAt,
      payload: result,
    }))
    if (!databaseAuthority) {
      const resultIds = new Set(input.results.map((result) => result.gateId))
      const existingGateResults = Array.isArray(nextTask['gateResults'])
        ? nextTask['gateResults'].filter((result) =>
            result &&
            typeof result === 'object' &&
            !(
              (result as Record<string, unknown>)['type'] === 'hard' &&
              resultIds.has(String((result as Record<string, unknown>)['gateId'] ?? ''))
            ),
        )
        : []
      nextTask['gateResults'] = [...existingGateResults, ...input.results]
      recordCommandProofPathResults(nextTask, input.gates, input.results)
    }
    const proofContractFailureIds = input.results
      .filter((result) => !commandResultSatisfiesProofContract(nextTask, input.gates, result))
      .map((result) => result.gateId)
    const now = new Date().toISOString()
    nextTask['updatedAt'] = now
    if (databaseAuthority) {
      const evidenceAuthority = readProjectStateDatabaseTaskEvidenceAuthorityFromTasksPath(tasksPath)
      const pointMutation = writePromotedTaskDetailMutation(tasksPath, taskId, {
        projectId: path.basename(projectRoot),
        projectRoot,
        mutate: (current) => ({ ...current, updatedAt: now }),
        evidence: events.map((event) => ({
          event,
          retention: { maxRecords: 32, maxBytes: 64 * 1024 },
          ...(evidenceAuthority === 'compressed' ? { history: 'outbox' as const } : {}),
        })),
      })
      if (!pointMutation) throw new Error(`Could not persist promoted gate evidence for task ${taskId}`)
      if (evidenceAuthority === 'compressed') {
        await flushTaskEvidenceOutboxForTasksPath(tasksPath, taskId)
      }
    } else {
      queue.tasks[queue.tasks.findIndex((candidate) => candidate['id'] === taskId)] = nextTask
      queue.lastUpdated = now
      writeProjectTaskQueueWithSummary(tasksPath, queue, {
        ...(queueRead.expectedQueueRevision !== null
          ? { expectedQueueRevision: queueRead.expectedQueueRevision }
          : {}),
      })
    }

    if (!databaseAuthority) {
      await Promise.all(events.map((event) => appendTaskEvidence(projectRoot, taskId, event)))
    }
    return { persisted: true, proofContractFailureIds }
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error))
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
        gateScopeExceptions: metadataGateScopeExceptions(ctx.metadata),
      },
      summary.results,
    )
    const persistedTaskGateResults = await persistGateResultsForCurrentTask({
      cwd: input.cwd,
      metadata: ctx.metadata,
      gates: effective.gates,
      results: summary.results,
    })
    const effectiveAllPassed = persistedTaskGateResults.proofContractFailureIds.length === 0 &&
      (scopeDisposition?.shouldPass ?? summary.allPassed)

    const lines = [
      ...(effective.usedAuthority ? ['Using authoritative task-scoped hard gates.', ''] : []),
      ...(scopeDisposition?.exemptedFailures.length
        ? [
            `Scoped exception: ${scopeDisposition.exemptedFailures.map((gate) => gate.gateId).join(', ')} failed only outside the task target files and is exempt from blocking this task.`,
            '',
          ]
        : []),
      `Gates: ${effectiveAllPassed ? 'ALL PASS' : 'SOME FAIL'} (${summary.results.filter((r) => r.passed).length}/${summary.results.length} raw)`,
      ...(persistedTaskGateResults.proofContractFailureIds.length > 0
        ? [`Proof contract failed for: ${persistedTaskGateResults.proofContractFailureIds.join(', ')}. Command output did not satisfy the structured evidence contract.`]
        : []),
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
        persistedTaskGateResults: persistedTaskGateResults.persisted,
        proofContractFailureIds: persistedTaskGateResults.proofContractFailureIds,
        effectiveAllPassed,
        scopeExemptFailures: scopeDisposition?.exemptedFailures as unknown as Record<string, unknown>,
      },
    }
  },
})
