import { writeManagedTextFileSync } from '@guildhall/persistence'

export const FORBIDDEN_PROJECT_TASK_FIELDS = [
  'assignedTo',
  'notes',
  'reviewVerdicts',
  'adjudications',
  'gateResults',
  'escalations',
  'agentIssues',
  'worktreePath',
  'branchName',
  'baseBranch',
  'mergeRecord',
  'revisionCount',
  'retryWindow',
  'remediationAttempts',
] as const

export type ForbiddenProjectTaskField = typeof FORBIDDEN_PROJECT_TASK_FIELDS[number]

export interface ForbiddenProjectTaskFieldFinding {
  taskId: string
  field: ForbiddenProjectTaskField
  bytes: number
}

export interface SanitizedTaskResult {
  task: unknown
  removedFields: ForbiddenProjectTaskField[]
  removedEvidence: Partial<Record<ForbiddenProjectTaskField, unknown>>
  removedEvidenceBytes: number
}

export interface SanitizedTaskQueueResult {
  queue: unknown
  taskDefinitionsRewritten: number
  removedEvidenceBytes: number
  removedByTask: Array<{ taskId: string; removedFields: ForbiddenProjectTaskField[]; removedEvidence: Record<string, unknown> }>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>
}

function serializedBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8')
}

function taskId(task: unknown): string {
  return isRecord(task) && typeof task.id === 'string' && task.id.length > 0 ? task.id : 'unknown'
}

function queueTasks(queue: unknown): unknown[] {
  if (Array.isArray(queue)) return queue
  if (isRecord(queue) && Array.isArray(queue.tasks)) return queue.tasks
  return []
}

function compactOpenEscalations(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return []
  return value
    .filter(item => isRecord(item) && !isResolvedEscalation(item))
    .map(item => {
      const compact: Record<string, unknown> = {}
      for (const field of ['id', 'status', 'title', 'summary', 'question', 'createdAt', 'updatedAt'] as const) {
        if (item[field] !== undefined) compact[field] = item[field]
      }
      return compact
    })
}

function isResolvedEscalation(value: Record<string, unknown>): boolean {
  const status = typeof value.status === 'string' ? value.status.toLowerCase() : ''
  return status === 'resolved' || status === 'closed' || status === 'dismissed' || typeof value.resolvedAt === 'string'
}

export function sanitizeTaskForProjectWrite(task: unknown): SanitizedTaskResult {
  if (!isRecord(task)) {
    return { task, removedFields: [], removedEvidence: {}, removedEvidenceBytes: 0 }
  }
  const next = cloneRecord(task)
  const removedFields: ForbiddenProjectTaskField[] = []
  const removedEvidence: Partial<Record<ForbiddenProjectTaskField, unknown>> = {}

  for (const field of FORBIDDEN_PROJECT_TASK_FIELDS) {
    if (!(field in next)) continue
    removedFields.push(field)
    removedEvidence[field] = next[field]
    if (field === 'escalations') {
      const openEscalations = compactOpenEscalations(next[field])
      if (openEscalations.length > 0) next.openEscalations = openEscalations
    }
    delete next[field]
  }

  return {
    task: next,
    removedFields,
    removedEvidence,
    removedEvidenceBytes: serializedBytes(removedEvidence),
  }
}

export function sanitizeTaskQueueForProjectWrite(queue: unknown): SanitizedTaskQueueResult {
  const originalTasks = queueTasks(queue)
  const removedByTask: SanitizedTaskQueueResult['removedByTask'] = []
  let removedEvidenceBytes = 0
  let taskDefinitionsRewritten = 0
  const tasks = originalTasks.map(task => {
    const result = sanitizeTaskForProjectWrite(task)
    if (result.removedFields.length > 0) {
      taskDefinitionsRewritten += 1
      removedEvidenceBytes += result.removedEvidenceBytes
      removedByTask.push({
        taskId: taskId(task),
        removedFields: result.removedFields,
        removedEvidence: result.removedEvidence as Record<string, unknown>,
      })
    }
    return result.task
  })

  const sanitizedQueue = Array.isArray(queue)
    ? tasks
    : isRecord(queue)
      ? { ...queue, tasks }
      : queue

  return {
    queue: sanitizedQueue,
    taskDefinitionsRewritten,
    removedEvidenceBytes,
    removedByTask,
  }
}

export function findForbiddenProjectTaskFields(queue: unknown): ForbiddenProjectTaskFieldFinding[] {
  return queueTasks(queue).flatMap(task => {
    if (!isRecord(task)) return []
    return FORBIDDEN_PROJECT_TASK_FIELDS
      .filter(field => field in task)
      .map(field => ({
        taskId: taskId(task),
        field,
        bytes: serializedBytes(task[field]),
      }))
  })
}

export function writeProjectTaskQueue(tasksPath: string, queue: unknown): SanitizedTaskQueueResult {
  const result = sanitizeTaskQueueForProjectWrite(queue)
  writeManagedTextFileSync(tasksPath, `${JSON.stringify(result.queue, null, 2)}\n`)
  return result
}
