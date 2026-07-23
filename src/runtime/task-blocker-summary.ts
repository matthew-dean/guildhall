import type { Task } from '@guildhall/core'
import { taskExecutionBlocker } from '@guildhall/shared'

type TaskLike = Pick<Task, 'blockReason'> & {
  proofRecovery?: { kind?: unknown; reason?: unknown }
  runtime?: { proofRecovery?: { kind?: unknown; reason?: unknown } }
}

export function taskBlockerSummary(task: TaskLike): string {
  return taskExecutionBlocker(task)?.reason ?? ''
}
