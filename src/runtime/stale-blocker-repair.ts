import { appendManagedTextFile, readManagedTextFile, readManagedTextFileSync, writeManagedTextFile } from '@guildhall/persistence'
import { existsSync, readFileSync } from 'node:fs'
import { atomicWriteText, getProjectSystemStatePath } from '@guildhall/sessions'
import type { Task, TaskQueue } from '@guildhall/core'
import { TaskQueue as TaskQueueSchema } from '@guildhall/core'
import { writeProjectTaskQueue } from './project-state-boundary.js'

export interface StaleBlockerRepair {
  taskId: string
  previousStatus: string
  nextStatus: string
  reason: string
}

export interface StaleBlockerRepairResult {
  changed: boolean
  repairs: StaleBlockerRepair[]
}

const INTERNAL_TOOLING_BLOCKER =
  /tool (?:read|reads|layer|runtime|file\/write|file read\/write)|cross-task (?:tool )?guardrail|stale workspace path guardrail|tooling\/context routing|path mismatch|misrouted|intercepted|unrelated missing path|unrelated task file|different task worktree/i

const STALE_SOURCE_PATH_BLOCKER =
  /\b(?:missing|likely target|target file|stale source|source reference)\b/i

const BLUEPRINT_LANE =
  /\b(?:spec-agent|coordinator|blueprint|spec|planning lane)\b/i

const MUTATION_FORCED_ON_PLANNING =
  /\b(?:create|author|mutate|write)\b/i

function taskHasUsableBlueprint(task: Task): boolean {
  return (
    typeof task.spec === 'string' &&
    task.spec.trim().length > 0 &&
    Array.isArray(task.acceptanceCriteria) &&
    task.acceptanceCriteria.length > 0
  )
}

function activeEscalationText(task: Task): string {
  return (task.escalations ?? [])
    .filter((escalation) => !escalation.resolvedAt)
    .map((escalation) => `${escalation.agentId}\n${escalation.reason}\n${escalation.summary ?? ''}\n${escalation.details ?? ''}`)
    .join('\n')
}

function blockerText(task: Task): string {
  return [task.blockReason ?? '', activeEscalationText(task)].join('\n')
}

function isHighConfidenceInternalBlocker(task: Task): boolean {
  const text = blockerText(task)
  if (!text.trim()) return false

  if (INTERNAL_TOOLING_BLOCKER.test(text)) return true

  return (
    BLUEPRINT_LANE.test(text) &&
    STALE_SOURCE_PATH_BLOCKER.test(text) &&
    MUTATION_FORCED_ON_PLANNING.test(text)
  )
}

function unresolvedEscalationCount(task: Task): number {
  return (task.escalations ?? []).filter((escalation) => !escalation.resolvedAt).length
}

function resolveStaleEscalations(task: Task, now: string): void {
  for (const escalation of task.escalations ?? []) {
    if (escalation.resolvedAt) continue
    const text = `${escalation.agentId}\n${escalation.reason}\n${escalation.summary ?? ''}\n${escalation.details ?? ''}`
    if (
      INTERNAL_TOOLING_BLOCKER.test(text) ||
      (
        BLUEPRINT_LANE.test(text) &&
        STALE_SOURCE_PATH_BLOCKER.test(text) &&
        MUTATION_FORCED_ON_PLANNING.test(text)
      )
    ) {
      escalation.resolvedAt = now
      escalation.resolvedBy = 'system'
      escalation.resolution =
        'Auto-repaired as a stale internal/tooling blocker. Guildhall will resume from the task scope and current evidence instead of asking for a manual task-file edit.'
    }
  }
}

function nextStatusForRepairedTask(task: Task): Task['status'] {
  if (taskHasUsableBlueprint(task)) return 'spec_review'
  if (task.productBrief || task.status === 'exploring' || task.status === 'blocked') return 'exploring'
  return task.status
}

export function repairStaleBlockersInQueue(
  queue: TaskQueue,
  now = new Date().toISOString(),
): StaleBlockerRepairResult {
  const repairs: StaleBlockerRepair[] = []

  for (const task of queue.tasks) {
    if (!isHighConfidenceInternalBlocker(task)) continue
    const beforeUnresolved = unresolvedEscalationCount(task)
    const previousStatus = task.status

    resolveStaleEscalations(task, now)

    const blockReasonLooksStale =
      typeof task.blockReason === 'string' &&
      (
        INTERNAL_TOOLING_BLOCKER.test(task.blockReason) ||
        (
          BLUEPRINT_LANE.test(task.blockReason) &&
          STALE_SOURCE_PATH_BLOCKER.test(task.blockReason) &&
          MUTATION_FORCED_ON_PLANNING.test(task.blockReason)
        )
      )
    if (blockReasonLooksStale) task.blockReason = undefined

    if (beforeUnresolved > 0 && unresolvedEscalationCount(task) > 0) continue
    if (task.blockReason && task.status === 'blocked') continue

    const nextStatus = task.status === 'blocked'
      ? nextStatusForRepairedTask(task)
      : task.status

    if (task.status !== nextStatus) task.status = nextStatus
    task.assignedTo = nextStatus === 'exploring' ? 'spec-agent' : null
    task.notes = Array.isArray(task.notes) ? task.notes : []
    task.notes.push({
      agentId: 'system',
      role: 'state-repair',
      content:
        'Auto-repaired stale internal/tooling blocker. Guildhall will continue from this task’s own scope and current evidence instead of preserving an old cross-task/path guardrail as a human blocker.',
      timestamp: now,
    })
    task.updatedAt = now
    repairs.push({
      taskId: task.id,
      previousStatus,
      nextStatus: task.status,
      reason: 'stale_internal_tooling_blocker',
    })
  }

  if (repairs.length > 0) queue.lastUpdated = now
  return { changed: repairs.length > 0, repairs }
}

export function repairStaleBlockersForProject(projectPath: string): StaleBlockerRepairResult {
  const tasksPath = getProjectSystemStatePath(projectPath, 'TASKS.json')
  if (!existsSync(tasksPath)) return { changed: false, repairs: [] }

  const queue = TaskQueueSchema.parse(JSON.parse(readManagedTextFileSync(tasksPath, 'utf8')))
  const result = repairStaleBlockersInQueue(queue)
  if (result.changed) {
    writeProjectTaskQueue(tasksPath, queue)
  }
  return result
}
