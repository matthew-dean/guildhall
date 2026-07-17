import { appendManagedTextFile, readManagedTextFile, readManagedTextFileSync, writeManagedTextFile } from '@guildhall/persistence'
import { defineTool } from '@guildhall/engine'
import { z } from 'zod'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  Escalation,
  EscalationReason,
  ProgressEntry,
  TaskQueue,
  type Task,
} from '@guildhall/core'
import { logProgress } from './memory-tools.js'
import { atomicWriteText, appendTaskEvidence, inferProjectRootFromMemoryDir, readTaskEvidence, upsertTaskRuntimeState } from '@guildhall/sessions'
import { buildEffectiveTask } from '@guildhall/runtime/effective-task'
import {
  readProjectTaskQueueForMutationSync,
  writePromotedTaskDetailMutation,
  writeProjectTaskQueue,
} from '@guildhall/runtime/project-state-boundary'
import { providerCommandEnv } from '../config/global-providers.js'

// ---------------------------------------------------------------------------
// FR-10 Escalation protocol
//
// Escalations are first-class events, not free-form notes. Raising an escalation:
//   1. appends a structured Escalation entry to task evidence
//   2. flips the task to status `blocked` with blockReason = escalation summary
//   3. writes a typed progress entry (type: 'escalation') to PROGRESS.md
//
// Resolving an escalation:
//   1. appends a resolved escalation snapshot to task evidence
//   2. moves the task to the requested next status (usually back to where it was)
//   3. writes a progress entry (type: 'milestone') recording the resolution
//
// The orchestrator refuses to route a task with any unresolved escalation.
// ---------------------------------------------------------------------------

const TASKS_PATH_SCHEMA = z.string().describe('Absolute path to the TASKS.json file')
const PROGRESS_PATH_SCHEMA = z
  .string()
  .describe('Absolute path to PROGRESS.md (escalation is mirrored here)')

const raiseEscalationInputSchema = z.object({
  tasksPath: TASKS_PATH_SCHEMA,
  progressPath: PROGRESS_PATH_SCHEMA.optional(),
  taskId: z.string(),
  agentId: z.string(),
  reason: EscalationReason,
  summary: z.string(),
  details: z.string().optional(),
  externalChecklist: z.array(z.object({
    id: z.string(),
    title: z.string(),
    detail: z.string().optional(),
    owner: z.enum(['user', 'guildhall', 'external']).default('user'),
    status: z.enum(['todo', 'done', 'blocked']).default('todo'),
  })).optional(),
})

export type RaiseEscalationInput = z.infer<typeof raiseEscalationInputSchema>
export interface RaiseEscalationResult {
  success: boolean
  escalationId?: string
  error?: string
}

async function readEffectiveEscalations(projectRoot: string, task: Task): Promise<Escalation[]> {
  const escalations = new Map<string, Escalation>()
  for (const escalation of Array.isArray(task.escalations) ? task.escalations : []) {
    escalations.set(escalation.id, escalation)
  }
  const evidence = await readTaskEvidence(projectRoot, task.id, { kind: 'escalation' })
  for (const event of evidence) {
    const parsed = Escalation.safeParse(event.payload)
    if (parsed.success) escalations.set(parsed.data.id, parsed.data)
  }
  return [...escalations.values()].sort((a, b) => a.raisedAt.localeCompare(b.raisedAt))
}

function nextEscalationId(task: Task, escalations: Escalation[]): string {
  const max = escalations.reduce((current, escalation) => {
    const match = new RegExp(`^esc-${task.id}-(\\d+)$`).exec(escalation.id)
    return Math.max(current, match ? Number(match[1]) : 0)
  }, 0)
  return `esc-${task.id}-${max + 1}`
}

function normalizeEscalationText(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim()
}

function findMatchingOpenEscalation(escalations: Escalation[], input: RaiseEscalationInput): Escalation | null {
  return escalations.find(escalation =>
    !escalation.resolvedAt &&
    escalation.agentId === input.agentId &&
    escalation.reason === input.reason &&
    normalizeEscalationText(escalation.summary) === normalizeEscalationText(input.summary),
  ) ?? null
}

function blockTaskForEscalation(task: Task, input: Pick<RaiseEscalationInput, 'reason' | 'summary'>, now: string): void {
  task.status = 'blocked'
  task.assignedTo = null
  task.blockReason = `${input.reason}: ${input.summary}`
  task.updatedAt = now
}

function persistEscalationTaskState(input: {
  tasksPath: string
  projectRoot: string
  task: Task
  queue: z.infer<typeof TaskQueue>
  expectedQueueRevision: number | null
}): void {
  const promotedMutation = writePromotedTaskDetailMutation(input.tasksPath, input.task.id, {
    projectId: path.basename(input.projectRoot),
    projectRoot: input.projectRoot,
    mutate: (definition) => {
      definition.status = input.task.status
      if (typeof input.task.blockReason === 'string') definition.blockReason = input.task.blockReason
      else delete definition.blockReason
      if (Array.isArray((input.task as Task & { openEscalations?: unknown }).openEscalations)) {
        definition.openEscalations = (input.task as Task & { openEscalations?: unknown }).openEscalations
      } else {
        delete definition.openEscalations
      }
      definition.updatedAt = input.task.updatedAt
      return definition
    },
  })
  if (!promotedMutation) {
    writeProjectTaskQueue(input.tasksPath, input.queue, {
      ...(input.expectedQueueRevision !== null
        ? { expectedQueueRevision: input.expectedQueueRevision }
        : {}),
    })
  }
}

function projectRootForTaskState(tasksPath: string, task: Task): string {
  const stateDir = path.dirname(tasksPath)
  if (path.basename(stateDir) === 'project-state' && path.isAbsolute(task.projectPath)) {
    return task.projectPath
  }
  return inferProjectRootFromMemoryDir(stateDir)
}

function looksLikeRoutineVerificationEscalation(input: RaiseEscalationInput): boolean {
  const text = `${input.reason}\n${input.summary}\n${input.details ?? ''}`
  return (
    /\bAC[- ]?\d+\b/i.test(text) &&
    /\b(?:evidence|verification|test result|gate|proof)\b/i.test(text) &&
    /\b(?:pnpm|npm|yarn|bun|vitest|test|typecheck|build)\b/i.test(text)
  )
}

function looksLikeSelfReferentialProofEscalation(input: RaiseEscalationInput): boolean {
  const text = `${input.reason}\n${input.summary}\n${input.details ?? ''}`
  return (
    /\b(?:npx\s+)?guildhall\s+run\b/i.test(text) &&
    /\s--task(?:=|\s)/i.test(text) &&
    /\b(?:proof|verification|AC[- ]?\d+|acceptance criterion)\b/i.test(text)
  )
}

function looksLikeWorkerImplementationRecovery(input: RaiseEscalationInput): boolean {
  if (input.agentId !== 'worker-agent') return false
  const text = `${input.reason}\n${input.summary}\n${input.details ?? ''}`
  const brittleEditFailure =
    /\b(?:exact string|search string|string (?:was )?not found|template syntax mismatch|whitespace|formatting mismatch|failed to edit|attempts? to edit|replace failed|patch failed)\b/i.test(text)
  const localImplementationEvidence =
    /\b(?:component exists|correctly imported|current file|template|props?|composable|import|dashboard\.vue|\.vue|\.svelte|\.tsx?|\.jsx?)\b/i.test(text)
  const asksForOwnerToResolveImplementation =
    /\b(?:need clarification|needs clarification|how to properly apply|how to apply|how to edit|how to wire|how to import)\b/i.test(text)
  return brittleEditFailure && (localImplementationEvidence || asksForOwnerToResolveImplementation)
}

function configuredProviderEnvBlocksCredentialEscalation(input: RaiseEscalationInput): boolean {
  const text = `${input.reason}\n${input.summary}\n${input.details ?? ''}\n${JSON.stringify(input.externalChecklist ?? [])}`
  const mentionsProviderToken =
    /\bDEEPINFRA_API_TOKEN\b/.test(text) ||
    /\bOPENAI_API_KEY\b/.test(text) ||
    /\bOPENAI_BASE_URL\b/.test(text)
  if (!mentionsProviderToken) return false
  let env: Record<string, string>
  try {
    env = providerCommandEnv()
  } catch {
    return false
  }
  return Boolean(
    (/\bDEEPINFRA_API_TOKEN\b/.test(text) && env.DEEPINFRA_API_TOKEN) ||
    (/\bOPENAI_API_KEY\b/.test(text) && env.OPENAI_API_KEY) ||
    (/\bOPENAI_BASE_URL\b/.test(text) && env.OPENAI_BASE_URL),
  )
}

export async function raiseEscalation(
  input: RaiseEscalationInput,
): Promise<RaiseEscalationResult> {
  try {
    const queueRead = readProjectTaskQueueForMutationSync(input.tasksPath)
    const queue = TaskQueue.parse(queueRead.queue)
    const task = queue.tasks.find((t) => t.id === input.taskId)
    if (!task) return { success: false, error: `Task ${input.taskId} not found` }
    const projectRoot = projectRootForTaskState(input.tasksPath, task)
    const effectiveTask = await buildEffectiveTask(projectRoot, task) as unknown as Task
    Object.assign(task, effectiveTask)
    const effectiveEscalations = await readEffectiveEscalations(projectRoot, task)

    if (looksLikeSelfReferentialProofEscalation(input)) {
      return {
        success: false,
        error:
          'Do not raise a human escalation to decide whether `guildhall run --task=...` counts as project proof. It does not: that command delegates back to Guildhall orchestration. Use the project-local proof command, save its result in the task proof packet or checkpoint, and continue.',
      }
    }

    if (looksLikeRoutineVerificationEscalation(input)) {
      return {
        success: false,
        error:
          'Do not raise a human escalation for routine verification evidence. Run the focused check, save the result in the task proof packet or checkpoint, and continue. Escalate only if an external credential, environment outage, or product decision prevents Guildhall from running the check.',
      }
    }

    if (looksLikeWorkerImplementationRecovery(input)) {
      return {
        success: false,
        error:
          'This is implementation recovery, not an owner decision: do not ask the owner to resolve failed exact-string edits, whitespace mismatches, local template syntax, imports, or component props. Re-read the current file and component API, apply a smaller structural edit, or record a checkpoint and retry with the existing spec.',
      }
    }

    if (configuredProviderEnvBlocksCredentialEscalation(input)) {
      return {
        success: false,
        error:
          'Do not raise a human escalation for provider credentials that Guildhall already has configured. Run the focused proof command through Guildhall shell/runtime execution, which supplies the configured provider environment, then record the real proof result or command failure.',
      }
    }

    const existing = findMatchingOpenEscalation(effectiveEscalations, input)
    if (existing) {
      const now = new Date().toISOString()
      blockTaskForEscalation(task, input, now)
      queue.lastUpdated = now
      await upsertTaskRuntimeState(projectRoot, task.id, {
        assignedTo: null,
        ...(task.revisionCount !== undefined ? { revisionCount: task.revisionCount } : {}),
        ...(task.retryWindow ? { retryWindow: task.retryWindow } : {}),
        ...(task.remediationAttempts !== undefined ? { remediationAttempts: task.remediationAttempts } : {}),
        openEscalationIds: effectiveEscalations
          .filter((candidate) => !candidate.resolvedAt)
          .map((candidate) => candidate.id),
        updatedAt: now,
      })
      persistEscalationTaskState({
        tasksPath: input.tasksPath,
        projectRoot,
        task,
        queue,
        expectedQueueRevision: queueRead.expectedQueueRevision,
      })
      return { success: true, escalationId: existing.id }
    }

    const now = new Date().toISOString()
    const escalation: Escalation = {
      id: nextEscalationId(task, effectiveEscalations),
      taskId: task.id,
      agentId: input.agentId,
      reason: input.reason,
      summary: input.summary,
      raisedAt: now,
      ...(input.details !== undefined ? { details: input.details } : {}),
      ...(input.externalChecklist !== undefined ? { externalChecklist: input.externalChecklist } : {}),
    }
    blockTaskForEscalation(task, input, now)
    queue.lastUpdated = now

    await appendTaskEvidence(projectRoot, task.id, {
      id: escalation.id,
      kind: 'escalation',
      recordedAt: now,
      payload: escalation,
    })
    await upsertTaskRuntimeState(projectRoot, task.id, {
      ...(task.assignedTo !== undefined ? { assignedTo: task.assignedTo } : {}),
      ...(task.revisionCount !== undefined ? { revisionCount: task.revisionCount } : {}),
      ...(task.retryWindow ? { retryWindow: task.retryWindow } : {}),
      ...(task.remediationAttempts !== undefined ? { remediationAttempts: task.remediationAttempts } : {}),
      openEscalationIds: [...effectiveEscalations, escalation]
        .filter((candidate) => !candidate.resolvedAt)
        .map((candidate) => candidate.id),
      updatedAt: now,
    })
    persistEscalationTaskState({
      tasksPath: input.tasksPath,
      projectRoot,
      task,
      queue,
      expectedQueueRevision: queueRead.expectedQueueRevision,
    })

    if (input.progressPath) {
      const entry: ProgressEntry = {
        timestamp: now,
        agentId: input.agentId,
        domain: task.domain,
        taskId: task.id,
        summary: `ESCALATION [${input.reason}]: ${input.summary}`,
        type: 'escalation',
      }
      await logProgress({ progressPath: input.progressPath, entry })
    }

    return { success: true, escalationId: escalation.id }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export const raiseEscalationTool = defineTool({
  name: 'raise-escalation',
  description:
    "Raise a structured escalation on a task. This halts the task (sets status='blocked') and records a typed event to PROGRESS.md. Use this — not a plain note — only when the task truly needs the owner or an external system. Do not use it for routine verification, missing proof packets, acceptance-criteria evidence, test reruns, or internal gate bookkeeping that Guildhall can do itself.",
  inputSchema: raiseEscalationInputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      tasksPath: { type: 'string', description: 'Absolute path to TASKS.json' },
      progressPath: { type: 'string', description: 'Absolute path to PROGRESS.md' },
      taskId: { type: 'string' },
      agentId: { type: 'string' },
      reason: {
        type: 'string',
        enum: [
          'spec_ambiguous',
          'max_revisions_exceeded',
          'human_judgment_required',
          'decision_required',
          'gate_hard_failure',
          'scope_boundary',
        ],
      },
      summary: { type: 'string' },
      details: { type: 'string' },
      externalChecklist: {
        type: 'array',
        description: 'Owner-facing setup steps for blockers that require action outside Guildhall.',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            detail: { type: 'string' },
            owner: { type: 'string', enum: ['user', 'guildhall', 'external'] },
            status: { type: 'string', enum: ['todo', 'done', 'blocked'] },
          },
          required: ['id', 'title'],
        },
      },
    },
    required: ['taskId', 'agentId', 'reason', 'summary'],
  },
  isReadOnly: () => false,
  execute: async (input) => {
    const parsed = raiseEscalationInputSchema.parse(input)
    const result = await raiseEscalation(parsed)
    return {
      output: result.success
        ? `Raised escalation ${result.escalationId} on ${parsed.taskId}`
        : `Error raising escalation on ${parsed.taskId}: ${result.error ?? 'unknown'}`,
      is_error: !result.success,
      metadata: result as unknown as Record<string, unknown>,
    }
  },
})

const resolveEscalationInputSchema = z.object({
  tasksPath: TASKS_PATH_SCHEMA,
  progressPath: PROGRESS_PATH_SCHEMA.optional(),
  taskId: z.string(),
  escalationId: z.string(),
  resolution: z.string(),
  resolvedBy: z.string().default('human'),
  nextStatus: z
    .enum([
      'exploring',
      'spec_review',
      'ready',
      'in_progress',
      'review',
      'gate_check',
    ])
    .describe('Status to return the task to once unblocked'),
})

export type ResolveEscalationInput = z.input<typeof resolveEscalationInputSchema>
export interface ResolveEscalationResult {
  success: boolean
  error?: string
}

function normalizeAssignmentForResolvedStatus(task: Task, nextStatus: z.infer<typeof resolveEscalationInputSchema>['nextStatus']): void {
  task.status = nextStatus
  switch (nextStatus) {
    case 'in_progress':
      task.assignedTo = 'worker-agent'
      return
    case 'review':
      task.assignedTo = 'reviewer-agent'
      return
    case 'gate_check':
      task.assignedTo = 'gate-checker-agent'
      return
    case 'exploring':
    case 'spec_review':
    case 'ready':
      delete task.assignedTo
      return
  }
}

function supportsRetryWindow(status: Task['status']): boolean {
  return status === 'in_progress' || status === 'review' || status === 'gate_check'
}

export function ensureRetryWindow(task: Task): boolean {
  const latestResolvedRetry = latestResolvedRetryEscalationAt(task)
  if (!latestResolvedRetry) return false
  if (!supportsRetryWindow(task.status)) return false

  if (task.retryWindow?.startedAt === latestResolvedRetry) return false
  task.retryWindow = {
    startedAt: latestResolvedRetry,
    baseRevisionCount: task.revisionCount,
  }
  return true
}

export function currentRevisionCycleCount(task: Pick<Task, 'status' | 'revisionCount' | 'retryWindow' | 'escalations'>): number {
  const latestResolvedRetry = latestResolvedRetryEscalationAt(task as Task)
  if (!latestResolvedRetry || !supportsRetryWindow(task.status as Task['status'])) {
    return task.revisionCount
  }
  if (task.retryWindow?.startedAt === latestResolvedRetry) {
    return Math.max(0, task.revisionCount - task.retryWindow.baseRevisionCount)
  }
  // Legacy self-heal: once a retry was explicitly approved by a human, do not
  // let historical revision debt immediately re-block the task before we have
  // established a fresh retry window in persisted task state.
  return 0
}

export async function resolveEscalation(
  input: ResolveEscalationInput,
): Promise<ResolveEscalationResult> {
  try {
    const queueRead = readProjectTaskQueueForMutationSync(input.tasksPath)
    const queue = TaskQueue.parse(queueRead.queue)
    const task = queue.tasks.find((t) => t.id === input.taskId)
    if (!task) return { success: false, error: `Task ${input.taskId} not found` }
    const projectRoot = projectRootForTaskState(input.tasksPath, task)
    const effectiveTask = await buildEffectiveTask(projectRoot, task) as unknown as Task
    Object.assign(task, effectiveTask)
    const effectiveEscalations = await readEffectiveEscalations(projectRoot, task)

    const esc = effectiveEscalations.find((e) => e.id === input.escalationId)
    if (!esc) {
      return {
        success: false,
        error: `Escalation ${input.escalationId} not found on ${input.taskId}`,
      }
    }
    if (esc.resolvedAt) {
      return {
        success: false,
        error: `Escalation ${input.escalationId} already resolved at ${esc.resolvedAt}`,
      }
    }

    const now = new Date().toISOString()
    esc.resolvedAt = now
    esc.resolution = input.resolution
    esc.resolvedBy = input.resolvedBy ?? 'human'
    task.escalations = effectiveEscalations

    const stillOpen = effectiveEscalations.some((e) => e.id !== esc.id && !e.resolvedAt)
    let retryWindowPatch: Task['retryWindow'] | undefined
    if (!stillOpen) {
      normalizeAssignmentForResolvedStatus(task, input.nextStatus)
      if (esc.reason === 'max_revisions_exceeded' && supportsRetryWindow(task.status)) {
        ensureRetryWindow(task)
        retryWindowPatch = task.retryWindow ?? {
          startedAt: now,
          baseRevisionCount: task.revisionCount,
        }
        task.retryWindow = retryWindowPatch
      }
      delete task.blockReason
      delete (task as Task & { openEscalations?: unknown }).openEscalations
    }
    task.updatedAt = now
    queue.lastUpdated = now

    await appendTaskEvidence(projectRoot, task.id, {
      id: `${esc.id}-${now.replace(/[^0-9A-Za-z]/g, '')}`,
      kind: 'escalation',
      recordedAt: now,
      payload: esc,
    })
    await upsertTaskRuntimeState(projectRoot, task.id, {
      ...(task.assignedTo !== undefined ? { assignedTo: task.assignedTo } : {}),
      ...(task.revisionCount !== undefined ? { revisionCount: task.revisionCount } : {}),
      openEscalationIds: effectiveEscalations
        .filter((candidate) => candidate.id !== esc.id && !candidate.resolvedAt)
        .map((candidate) => candidate.id),
      ...(retryWindowPatch ?? task.retryWindow ? { retryWindow: retryWindowPatch ?? task.retryWindow } : {}),
      updatedAt: now,
    })
    persistEscalationTaskState({
      tasksPath: input.tasksPath,
      projectRoot,
      task,
      queue,
      expectedQueueRevision: queueRead.expectedQueueRevision,
    })

    if (input.progressPath) {
      const entry: ProgressEntry = {
        timestamp: now,
        agentId: input.resolvedBy ?? 'human',
        domain: task.domain,
        taskId: task.id,
        summary: stillOpen
          ? `Escalation ${esc.id} resolved (${effectiveEscalations.filter((e) => e.id !== esc.id && !e.resolvedAt).length} still open): ${input.resolution}`
          : `Escalation ${esc.id} resolved; task returning to ${input.nextStatus}: ${input.resolution}`,
        type: 'milestone',
      }
      await logProgress({ progressPath: input.progressPath, entry })
    }

    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export const resolveEscalationTool = defineTool({
  name: 'resolve-escalation',
  description:
    'Resolve an open escalation and unblock the task. If no escalations remain open on the task, its status is set to `nextStatus`. Typically invoked by a human or an orchestrator-level resolver.',
  inputSchema: resolveEscalationInputSchema,
  jsonSchema: { type: 'object' },
  isReadOnly: () => false,
  execute: async (input) => {
    const result = await resolveEscalation(input)
    return {
      output: result.success
        ? `Resolved escalation ${input.escalationId}`
        : `Error resolving escalation ${input.escalationId}: ${result.error ?? 'unknown'}`,
      is_error: !result.success,
      metadata: result as unknown as Record<string, unknown>,
    }
  },
})

type TaskEscalation = Task['escalations'][number]

export function isEscalationActive(task: Task, escalation: TaskEscalation): boolean {
  if (escalation.resolvedAt) return false
  if (task.status === 'blocked') return true

  const raisedAt = Date.parse(escalation.raisedAt)
  const updatedAt = Date.parse(task.updatedAt)
  if (Number.isFinite(raisedAt) && Number.isFinite(updatedAt) && updatedAt > raisedAt) {
    return false
  }

  return true
}

export function activeEscalations(task: Task): TaskEscalation[] {
  const escalations = Array.isArray(task.escalations) ? task.escalations : []
  return escalations.filter((escalation) => isEscalationActive(task, escalation))
}

export function resolveSupersededEscalations(
  task: Task,
  opts: {
    now?: string
    resolvedBy?: string
    resolution?: string
  } = {},
): string[] {
  const now = opts.now ?? task.updatedAt
  const resolvedBy = opts.resolvedBy ?? 'system'
  const resolution =
    opts.resolution ??
    `Superseded after task continued in ${task.status}.`

  const resolvedIds: string[] = []
  for (const escalation of Array.isArray(task.escalations) ? task.escalations : []) {
    if (escalation.resolvedAt) continue
    if (isEscalationActive(task, escalation)) continue
    escalation.resolvedAt = now
    escalation.resolvedBy = resolvedBy
    escalation.resolution = resolution
    resolvedIds.push(escalation.id)
  }

  if (resolvedIds.length > 0 && activeEscalations(task).length === 0) {
    delete task.blockReason
  }

  return resolvedIds
}

export function latestResolvedRetryEscalationAt(task: Task): string | null {
  const resolved = (Array.isArray(task.escalations) ? task.escalations : [])
    .filter(
      (escalation) =>
        escalation.reason === 'max_revisions_exceeded' &&
        typeof escalation.resolvedAt === 'string' &&
        escalation.resolvedAt.trim().length > 0,
    )
    .sort((a, b) => Date.parse(b.resolvedAt ?? '') - Date.parse(a.resolvedAt ?? ''))
  return resolved[0]?.resolvedAt ?? null
}

/**
 * Returns true if the task has at least one unresolved escalation. Used by the
 * orchestrator to halt routing regardless of surface status.
 */
export function hasOpenEscalation(task: Task): boolean {
  return activeEscalations(task).length > 0
}
