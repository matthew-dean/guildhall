import path from 'node:path'

import { TaskQueue, TERMINAL_TASK_STATUSES, type TaskStatus } from '@guildhall/core'
import {
  appendTaskEvidence,
  getProjectSystemStatePathFromMemoryDir,
  inferProjectRootFromMemoryDir,
  readProjectStateDatabaseCurrentAuthorityFromTasksPath,
  readProjectStateDatabaseQueue,
  readProjectStateDatabaseQueueRevision,
  readProjectStateDatabaseTaskPointWithRevision,
  readProjectStateTextFromMemoryDirAsync,
  upsertTaskRuntimeState,
} from '@guildhall/sessions'

import { reviewInProcessWorkForGuildhallImprovements } from './improvement-review.js'
import { validateSpecCompletionBoundary } from './spec-quality.js'
import { workSubtreeIds } from './work-hierarchy.js'
import {
  FORBIDDEN_PROJECT_TASK_FIELDS,
  writePromotedTaskDetailMutation,
  writeProjectTaskQueueWithSummary,
} from './project-state-boundary.js'

export type RunAutomationPolicy = 'ask_more_often' | 'ask_when_necessary' | 'fully_automated'

export interface RunAutomationResolution {
  kind: 'resolve_automation_blocker' | 'record_design_lens_review' | 'record_improvement_review'
  taskId: string
  detail: string
}

export interface RunAutomationResult {
  changed: boolean
  resolutions: RunAutomationResolution[]
}

export interface ScopedRunSummary {
  allTerminal: boolean
  statusSummary: string
}

function hasTypedAutomationRecovery(task: {
  escalations?: Array<{ resolvedAt?: unknown; recoveryCode?: unknown; handling?: unknown }>
}): boolean {
  return (task.escalations ?? []).some((escalation) =>
    !escalation.resolvedAt &&
    escalation.handling === 'guildhall_recovery' &&
    escalation.recoveryCode !== undefined,
  )
}

export async function summarizeScopedRun(input: {
  memoryDir: string
  rootTaskId?: string
}): Promise<ScopedRunSummary> {
  const queue = await readQueue(input.memoryDir)
  const scopedIds = input.rootTaskId ? new Set(workSubtreeIds(queue.tasks, input.rootTaskId)) : null
  const tasks = scopedIds ? queue.tasks.filter(task => scopedIds.has(task.id)) : queue.tasks
  const terminal = new Set<TaskStatus>(TERMINAL_TASK_STATUSES)
  const allTerminal = tasks.length > 0 && tasks.every(task => terminal.has(task.status))
  const counts = new Map<TaskStatus, number>()
  for (const task of tasks) counts.set(task.status, (counts.get(task.status) ?? 0) + 1)
  const statusSummary = [...counts.entries()]
    .map(([status, count]) => `${count} ${status}`)
    .join(', ') || 'no scoped tasks'
  return { allTerminal, statusSummary }
}

export async function applyRunAutomationPolicy(input: {
  memoryDir: string
  policy?: RunAutomationPolicy | 'supervised'
  rootTaskId?: string
  ownerIntent?: string
  actor?: string
}): Promise<RunAutomationResult> {
  if (input.policy !== 'fully_automated') return { changed: false, resolutions: [] }
  // Unattended execution is not delegated ownership. Guildhall may retry a
  // typed Guildhall-owned recovery for an explicitly selected work subtree,
  // but it cannot guess answers, approve a spec, or widen into another scope.
  if (!input.rootTaskId) return { changed: false, resolutions: [] }
  const resolutions: RunAutomationResolution[] = []
  const unblocked = await resolveScopedAutomationBlockers({ ...input, resolutions })
  return {
    changed: unblocked,
    resolutions,
  }
}

async function reviewScopedWorkForGuildhallImprovements(input: {
  memoryDir: string
  rootTaskId?: string
  resolutions: RunAutomationResolution[]
}): Promise<boolean> {
  const result = await reviewInProcessWorkForGuildhallImprovements({
    memoryDir: input.memoryDir,
    ...(input.rootTaskId ? { rootTaskId: input.rootTaskId } : {}),
  })
  for (const findingId of result.design.createdFindingIds) {
    const taskId = findingId.replace(/^design-lens-review-/, '')
    input.resolutions.push({
      kind: 'record_design_lens_review',
      taskId,
      detail: 'Recorded a design-lens recheck finding so in-process UI work benefits from the current design-system guidance.',
    })
  }
  for (const taskId of result.notedTaskIds) {
    input.resolutions.push({
      kind: 'record_improvement_review',
      taskId,
      detail: 'Recorded a conservative improvement-review note so active work can benefit from current Guildhall guidance.',
    })
  }
  return result.design.createdFindingIds.length > 0 || result.notedTaskIds.length > 0
}

async function resolveScopedAutomationBlockers(input: {
  memoryDir: string
  rootTaskId?: string
  ownerIntent?: string
  actor?: string
  resolutions: RunAutomationResolution[]
}): Promise<boolean> {
  if (isPromotedProject(input.memoryDir)) return resolvePromotedScopedAutomationBlockers(input)
  const queueRead = await readQueueForMutation(input.memoryDir)
  const queue = queueRead.queue
  const previousQueue = structuredClone(queue)
  const scopedIds = input.rootTaskId ? new Set(workSubtreeIds(queue.tasks, input.rootTaskId)) : null
  let changed = false
  const promotedEvidence: PromotedTaskEvidence[] = []
  for (const task of queue.tasks) {
    if (scopedIds && !scopedIds.has(task.id)) continue
    if (task.status !== 'blocked' || !hasTypedAutomationRecovery(task)) {
      continue
    }
    const now = new Date().toISOString()
    task.status = 'exploring'
    task.blockReason = undefined
    task.recoveryCode = undefined
    task.updatedAt = now
    task.escalations = (task.escalations ?? []).map(escalation => escalation.resolvedAt ? escalation : {
      ...escalation,
      resolvedAt: now,
      resolvedBy: input.actor ?? 'run-automation',
      resolution: 'Fully automated run resolved this as an automation-compatible blocker and asked the task to continue from the owner intent.',
    })
    const note = {
      agentId: input.actor ?? 'run-automation',
      role: 'automation',
      content: [
        'Resolved retryable blocker under fully automated run policy.',
        'Continue from the owner intent and do not wait for human input unless an external dependency is truly unavailable.',
        ...(input.ownerIntent ? ['', `Owner intent: ${input.ownerIntent}`] : []),
      ].join('\n'),
      timestamp: now,
    }
    task.notes = [...(task.notes ?? []), note]
    promotedEvidence.push({
      taskId: task.id,
      event: {
        id: `automation-note-${task.id}-${now.replace(/[^0-9A-Za-z]/g, '')}-blocker`,
        kind: 'note',
        recordedAt: now,
        payload: note,
      },
    })
    for (const escalation of task.escalations ?? []) {
      promotedEvidence.push({
        taskId: task.id,
        event: {
          id: `automation-escalation-${task.id}-${escalation.id}-${now.replace(/[^0-9A-Za-z]/g, '')}`,
          kind: 'escalation',
          recordedAt: now,
          payload: escalation,
        },
      })
    }
    changed = true
    input.resolutions.push({
      kind: 'resolve_automation_blocker',
      taskId: task.id,
      detail: 'Reopened a human-input-style blocker so automation could continue.',
    })
  }
  if (changed) {
    queue.lastUpdated = new Date().toISOString()
    await writeQueue(input.memoryDir, previousQueue, queue, queueRead.expectedQueueRevision, promotedEvidence)
  }
  return changed
}

async function resolvePromotedScopedAutomationBlockers(input: {
  memoryDir: string
  rootTaskId?: string
  ownerIntent?: string
  actor?: string
  resolutions: RunAutomationResolution[]
}): Promise<boolean> {
  const queue = await readQueue(input.memoryDir)
  const scopedIds = input.rootTaskId ? new Set(workSubtreeIds(queue.tasks, input.rootTaskId)) : null
  const projectRoot = inferProjectRootFromMemoryDir(input.memoryDir)
  const tasksPath = getProjectSystemStatePathFromMemoryDir(input.memoryDir, 'TASKS.json')
  let changed = false
  for (const indexedTask of queue.tasks) {
    if (scopedIds && !scopedIds.has(indexedTask.id)) continue
    if (indexedTask.status !== 'blocked') continue
    const task = promotedTaskDefinition(input.memoryDir, indexedTask.id)
    if (!task) continue
    if (!hasTypedAutomationRecovery(task)) continue

    const now = new Date().toISOString()
    const resolvedEscalations = (task.escalations ?? []).map((escalation: Record<string, any>) => escalation.resolvedAt ? escalation : {
      ...escalation,
      resolvedAt: now,
      resolvedBy: input.actor ?? 'run-automation',
      resolution: 'Fully automated run resolved this as an automation-compatible blocker and asked the task to continue from the owner intent.',
    })
    const promoted = writePromotedTaskDetailMutation(tasksPath, task.id, {
      projectId: path.basename(projectRoot),
      projectRoot,
      mutate: current => {
        current.status = 'exploring'
        delete current.blockReason
        delete current.recoveryCode
        if (resolvedEscalations.some((escalation: { resolvedAt?: string }) => !escalation.resolvedAt)) {
          current.openEscalations = resolvedEscalations
            .filter((escalation: { resolvedAt?: string }) => !escalation.resolvedAt)
            .map((escalation: { id: string }) => escalation.id)
        } else {
          delete current.openEscalations
        }
        current.updatedAt = now
        return current
      },
    })
    if (!promoted) throw new Error(`Promoted task ${task.id} could not resolve the automation blocker`)

    await upsertTaskRuntimeState(projectRoot, task.id, {
      openEscalationIds: resolvedEscalations
        .filter((escalation: { resolvedAt?: string }) => !escalation.resolvedAt)
        .map((escalation: { id: string }) => escalation.id),
      updatedAt: now,
    })
    for (const escalation of resolvedEscalations) {
      await appendTaskEvidence(projectRoot, task.id, {
        id: `automation-escalation-${task.id}-${escalation.id}-${now.replace(/[^0-9A-Za-z]/g, '')}`,
        kind: 'escalation',
        recordedAt: now,
        payload: escalation,
      })
    }
    const note = [
      'Resolved retryable blocker under fully automated run policy.',
      'Continue from the owner intent and do not wait for human input unless an external dependency is truly unavailable.',
      ...(input.ownerIntent ? ['', `Owner intent: ${input.ownerIntent}`] : []),
    ].join('\n')
    await appendTaskEvidence(projectRoot, task.id, {
      id: `automation-note-${task.id}-${now.replace(/[^0-9A-Za-z]/g, '')}-blocker`,
      kind: 'note',
      recordedAt: now,
      payload: {
        agentId: input.actor ?? 'run-automation',
        role: 'automation',
        content: note,
        timestamp: now,
      },
    })
    changed = true
    input.resolutions.push({
      kind: 'resolve_automation_blocker',
      taskId: task.id,
      detail: 'Reopened a human-input-style blocker through the promoted point/evidence/runtime boundaries.',
    })
  }
  return changed
}

async function readQueue(memoryDir: string): Promise<TaskQueue> {
  const tasksPath = getProjectSystemStatePathFromMemoryDir(memoryDir, 'TASKS.json')
  if (readProjectStateDatabaseCurrentAuthorityFromTasksPath(tasksPath) === 'database') {
    const queue = readProjectStateDatabaseQueue(tasksPath)
    if (!queue) throw new Error(`Current project-state index is unavailable for ${tasksPath}`)
    return queue as unknown as TaskQueue
  }
  // Bootstrap-only compatibility read. Promoted projects fail closed above.
  const raw = await readProjectStateTextFromMemoryDirAsync(memoryDir, 'TASKS.json')
  const parsed = JSON.parse(raw)
  return Array.isArray(parsed)
    ? { version: 1, lastUpdated: new Date().toISOString(), tasks: parsed }
    : TaskQueue.parse(parsed)
}

interface QueueMutationRead {
  queue: TaskQueue
  expectedQueueRevision: number | null
}

interface PromotedTaskEvidence {
  taskId: string
  event: Parameters<typeof appendTaskEvidence>[2]
}

async function readQueueForMutation(memoryDir: string): Promise<QueueMutationRead> {
  const tasksPath = getProjectSystemStatePathFromMemoryDir(memoryDir, 'TASKS.json')
  if (readProjectStateDatabaseCurrentAuthorityFromTasksPath(tasksPath) !== 'database') {
    return { queue: await readQueue(memoryDir), expectedQueueRevision: null }
  }
  const queue = readProjectStateDatabaseQueue(tasksPath)
  if (!queue) throw new Error(`Current project-state index is unavailable for ${tasksPath}`)
  return {
    queue: queue as unknown as TaskQueue,
    expectedQueueRevision: readProjectStateDatabaseQueueRevision(tasksPath),
  }
}

async function writeQueue(
  memoryDir: string,
  previousQueue: TaskQueue,
  queue: TaskQueue,
  expectedQueueRevision: number | null,
  promotedEvidence: readonly PromotedTaskEvidence[] = [],
): Promise<void> {
  const tasksPath = getProjectSystemStatePathFromMemoryDir(memoryDir, 'TASKS.json')
  if (readProjectStateDatabaseCurrentAuthorityFromTasksPath(tasksPath) === 'database') {
    if (await writePromotedSingleTaskMutation(tasksPath, previousQueue, queue, expectedQueueRevision, memoryDir, promotedEvidence)) return
    throw new Error(`Promoted automation update for ${tasksPath} did not match a normalized task/evidence mutation`)
  }
  // Bootstrap-only queue persistence. Imports/migrations own any later full-state writes.
  writeProjectTaskQueueWithSummary(tasksPath, queue, {
    projectId: path.basename(inferProjectRootFromMemoryDir(memoryDir)),
    expectedQueueRevision,
  })
}

async function writePromotedSingleTaskMutation(
  tasksPath: string,
  previousQueue: TaskQueue,
  queue: TaskQueue,
  expectedQueueRevision: number | null,
  memoryDir: string,
  promotedEvidence: readonly PromotedTaskEvidence[],
): Promise<boolean> {
  if (!Number.isInteger(expectedQueueRevision) || expectedQueueRevision! < 0) return false
  if (previousQueue.tasks.length !== queue.tasks.length) return false

  const previousById = new Map(previousQueue.tasks.map(task => [task.id, task]))
  const nextById = new Map(queue.tasks.map(task => [task.id, task]))
  if (previousById.size !== nextById.size || [...previousById.keys()].some(id => !nextById.has(id))) return false

  const changedTaskIds = [...previousById.keys()].filter(id => !sameJson(previousById.get(id), nextById.get(id)))
  if (changedTaskIds.length !== 1) return false
  const taskId = changedTaskIds[0]
  if (!taskId) return false

  const previousTask = previousById.get(taskId) as unknown as Record<string, unknown>
  const nextTask = nextById.get(taskId) as unknown as Record<string, unknown>
  const changedFields = [...new Set([...Object.keys(previousTask), ...Object.keys(nextTask)])]
    .filter(field => !sameJson(previousTask[field], nextTask[field]))
  const forbiddenChanged = changedFields.filter(field => FORBIDDEN_PROJECT_TASK_FIELDS.includes(field as typeof FORBIDDEN_PROJECT_TASK_FIELDS[number]))
  if (forbiddenChanged.length > 0 && promotedEvidence.length === 0) {
    return false
  }
  const mutableFields = changedFields.filter(field => !FORBIDDEN_PROJECT_TASK_FIELDS.includes(field as typeof FORBIDDEN_PROJECT_TASK_FIELDS[number]))
  if (mutableFields.length === 0) {
    return appendPromotedTaskEvidence(
      inferProjectRootFromMemoryDir(memoryDir),
      promotedEvidence.filter(entry => entry.taskId === taskId),
    )
  }

  const projectRoot = inferProjectRootFromMemoryDir(memoryDir)
  const committed = writePromotedTaskDetailMutation(tasksPath, taskId, {
    projectId: path.basename(projectRoot),
    projectRoot,
    mutate: current => {
      const next = { ...current }
      for (const field of mutableFields) {
        if (Object.prototype.hasOwnProperty.call(nextTask, field)) next[field] = nextTask[field]
        else delete next[field]
      }
      return next
    },
  })
  if (!committed) return false
  return appendPromotedTaskEvidence(projectRoot, promotedEvidence.filter(entry => entry.taskId === taskId))
}

function isPromotedProject(memoryDir: string): boolean {
  return readProjectStateDatabaseCurrentAuthorityFromTasksPath(
    getProjectSystemStatePathFromMemoryDir(memoryDir, 'TASKS.json'),
  ) === 'database'
}

function promotedTaskDefinition(memoryDir: string, taskId: string): Record<string, any> | null {
  const point = readProjectStateDatabaseTaskPointWithRevision(
    getProjectSystemStatePathFromMemoryDir(memoryDir, 'TASKS.json'),
    taskId,
  )
  return point?.task.definition as Record<string, any> | null
}

async function appendPromotedTaskEvidence(
  projectRoot: string,
  evidence: readonly PromotedTaskEvidence[],
): Promise<boolean> {
  for (const entry of evidence) {
    await appendTaskEvidence(projectRoot, entry.taskId, entry.event)
  }
  return true
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}
