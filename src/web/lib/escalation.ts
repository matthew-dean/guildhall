import type { Task, Escalation } from './types'

function runtimeOpenEscalationIds(task: Task): Set<string> | null {
  const runtime = task.runtime
  if (!runtime || !Array.isArray(runtime.openEscalationIds)) return null
  return new Set(
    runtime.openEscalationIds
      .filter((id): id is string => typeof id === 'string' && id.trim().length > 0),
  )
}

export function isEscalationActive(task: Task, escalation: Escalation): boolean {
  const runtimeOpenIds = runtimeOpenEscalationIds(task)
  if (runtimeOpenIds) {
    return typeof escalation.id === 'string' && runtimeOpenIds.has(escalation.id)
  }

  if (escalation.resolvedAt) return false
  if (task.status === 'blocked') return true

  const raisedAt = Date.parse(escalation.raisedAt ?? '')
  const updatedAt = Date.parse(task.updatedAt ?? '')
  if (Number.isFinite(raisedAt) && Number.isFinite(updatedAt) && updatedAt > raisedAt) {
    return false
  }

  return true
}

export function activeEscalations(task: Task): Escalation[] {
  const runtimeOpenIds = runtimeOpenEscalationIds(task)
  if (runtimeOpenIds) {
    return (task.escalations ?? [])
      .filter((escalation) => typeof escalation.id === 'string' && runtimeOpenIds.has(escalation.id))
  }
  return (task.escalations ?? []).filter((escalation) => isEscalationActive(task, escalation))
}
