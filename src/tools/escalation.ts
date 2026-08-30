import { appendManagedTextFile, readManagedTextFile, readManagedTextFileSync, writeManagedTextFile } from '@guildhall/persistence'
import { defineTool } from '@guildhall/engine'
import { z } from 'zod'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  Escalation,
  EscalationHandling,
  EscalationRecoveryCode,
  EscalationReason,
  ProgressEntry,
  TaskQueue,
  TaskGateScopeException,
  type Task,
} from '@guildhall/core'
import { logProgress } from './memory-tools.js'
import { atomicWriteText, appendTaskEvidence, inferProjectRootFromSystemStatePath, readTaskEvidence, upsertTaskRuntimeState } from '@guildhall/sessions'
import { buildEffectiveTask } from '@guildhall/runtime/effective-task'
import {
  readProjectTaskQueueForMutationSync,
  writePromotedTaskDetailMutation,
  writeProjectTaskQueue,
} from '@guildhall/runtime/project-state-boundary'

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
  handling: EscalationHandling.optional(),
  recoveryCode: EscalationRecoveryCode.optional(),
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

function hasRecordedHardGateFailure(task: Task): boolean {
  return (task.gateResults ?? []).some(gate =>
    gate.type === 'hard' && gate.passed === false,
  )
}

function findMatchingOpenEscalation(escalations: Escalation[], input: RaiseEscalationInput): Escalation | null {
  return escalations.find(escalation =>
    !escalation.resolvedAt &&
    escalation.agentId === input.agentId &&
    escalation.reason === input.reason &&
    (input.recoveryCode !== undefined && escalation.recoveryCode !== undefined
      ? escalation.recoveryCode === input.recoveryCode
      : normalizeEscalationText(escalation.summary) === normalizeEscalationText(input.summary)),
  ) ?? null
}

function blockTaskForEscalation(
  task: Task,
  input: Pick<RaiseEscalationInput, 'reason' | 'summary' | 'recoveryCode'>,
  now: string,
): void {
  task.status = 'blocked'
  task.assignedTo = null
  if (input.recoveryCode !== undefined) task.recoveryCode = input.recoveryCode
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
      if (input.task.recoveryCode !== undefined) definition.recoveryCode = input.task.recoveryCode
      else delete definition.recoveryCode
      if (Array.isArray((input.task as Task & { openEscalations?: unknown }).openEscalations)) {
        definition.openEscalations = (input.task as Task & { openEscalations?: unknown }).openEscalations
      } else {
        delete definition.openEscalations
      }
      // Gate scope disposition is a typed task-definition fact. Keep it in
      // the same promoted point mutation as the task status; the escalation
      // prose remains audit-only and must never be reconstructed here.
      if (Array.isArray(input.task.gateScopeExceptions)) {
        definition.gateScopeExceptions = input.task.gateScopeExceptions
      } else {
        delete definition.gateScopeExceptions
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
  return inferProjectRootFromSystemStatePath(tasksPath, task.projectPath)
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

    // A provider's explanation of a failed command is audit material, not
    // authority to halt a release. Only the typed gate ledger may establish a
    // hard-gate failure.
    if (input.reason === 'gate_hard_failure' && !hasRecordedHardGateFailure(task)) {
      return {
        success: false,
        error:
          'Cannot raise gate_hard_failure without a recorded failed hard gate. Run and persist the task\'s authoritative gates first.',
      }
    }

    if (input.handling === 'guildhall_recovery') {
      return {
        success: false,
        error:
          'This escalation is marked guildhall_recovery. Resolve it through Guildhall-owned recovery, verification, or re-dispatch instead of creating an owner blocker.',
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
      handling: input.handling ?? 'owner_required',
      ...(input.recoveryCode !== undefined ? { recoveryCode: input.recoveryCode } : {}),
      summary: input.summary,
      raisedAt: now,
      ...(input.details !== undefined ? { details: input.details } : {}),
      ...(input.externalChecklist !== undefined ? { externalChecklist: input.externalChecklist } : {}),
    }
    blockTaskForEscalation(task, input, now)
    task.escalations = [...effectiveEscalations, escalation]
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
      handling: {
        type: 'string',
        enum: ['owner_required', 'guildhall_recovery', 'external_dependency'],
        description: 'Structured routing authority. Summary/details are explanatory text and never classify the escalation.',
        default: 'owner_required',
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
  /**
   * A one-click recovery may collapse repeated copies of the same typed
   * escalation. It never uses human prose to decide which records belong
   * together.
   */
  resolveEquivalent: z.boolean().optional(),
  /**
   * Optional typed disposition for a gate failure outside this task's target
   * surface. Resolution prose alone can never create this exception.
   */
  gateScopeException: TaskGateScopeException.omit({
    id: true,
    sourceEscalationId: true,
    createdAt: true,
    createdBy: true,
  }).optional(),
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
  resolvedEscalationIds?: string[]
}

function hasSameRecoveryIdentity(left: Escalation, right: Escalation): boolean {
  return left.reason === right.reason &&
    left.agentId === right.agentId &&
    left.handling === right.handling &&
    left.recoveryCode === right.recoveryCode
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

    if (input.gateScopeException && (input.resolvedBy ?? 'human') !== 'human') {
      return {
        success: false,
        error: 'A gate scope exception is an explicit owner decision and must be recorded with resolvedBy="human".',
      }
    }

    const resolvedEscalations = input.resolveEquivalent === true && !input.gateScopeException
      ? effectiveEscalations.filter(candidate => !candidate.resolvedAt && hasSameRecoveryIdentity(candidate, esc))
      : [esc]
    const now = new Date().toISOString()
    for (const candidate of resolvedEscalations) {
      candidate.resolvedAt = now
      candidate.resolution = input.resolution
      candidate.resolvedBy = input.resolvedBy ?? 'human'
    }
    task.escalations = effectiveEscalations
    if (input.gateScopeException) {
      const exception = TaskGateScopeException.parse({
        ...input.gateScopeException,
        id: `gate-scope-${task.id}-${input.gateScopeException.gateId}`,
        sourceEscalationId: esc.id,
        createdAt: now,
        createdBy: input.resolvedBy ?? 'human',
      })
      task.gateScopeExceptions = [
        ...(task.gateScopeExceptions ?? []).filter((candidate) => candidate.id !== exception.id),
        exception,
      ]
    }

    const stillOpen = effectiveEscalations.some(e => !e.resolvedAt)
    let retryWindowPatch: Task['retryWindow'] | undefined
    if (!stillOpen) {
      normalizeAssignmentForResolvedStatus(task, input.nextStatus)
      if (resolvedEscalations.some(candidate => candidate.reason === 'max_revisions_exceeded') && supportsRetryWindow(task.status)) {
        ensureRetryWindow(task)
        retryWindowPatch = task.retryWindow ?? {
          startedAt: now,
          baseRevisionCount: task.revisionCount,
        }
        task.retryWindow = retryWindowPatch
      }
      delete task.blockReason
      delete task.recoveryCode
      delete (task as Task & { openEscalations?: unknown }).openEscalations
    }
    task.updatedAt = now
    queue.lastUpdated = now

    for (const resolved of resolvedEscalations) {
      await appendTaskEvidence(projectRoot, task.id, {
        id: `${resolved.id}-${now.replace(/[^0-9A-Za-z]/g, '')}`,
        kind: 'escalation',
        recordedAt: now,
        payload: resolved,
      })
    }
    await upsertTaskRuntimeState(projectRoot, task.id, {
      ...(task.assignedTo !== undefined ? { assignedTo: task.assignedTo } : {}),
      ...(task.revisionCount !== undefined ? { revisionCount: task.revisionCount } : {}),
      openEscalationIds: effectiveEscalations
        .filter(candidate => !candidate.resolvedAt)
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
          ? `${resolvedEscalations.length} matching escalation${resolvedEscalations.length === 1 ? '' : 's'} resolved (${effectiveEscalations.filter(e => !e.resolvedAt).length} still open): ${input.resolution}`
          : `${resolvedEscalations.length} matching escalation${resolvedEscalations.length === 1 ? '' : 's'} resolved; task returning to ${input.nextStatus}: ${input.resolution}`,
        type: 'milestone',
      }
      await logProgress({ progressPath: input.progressPath, entry })
    }

    return { success: true, resolvedEscalationIds: resolvedEscalations.map(candidate => candidate.id) }
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
