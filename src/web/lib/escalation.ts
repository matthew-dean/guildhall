import type { Task, Escalation } from './types'

export function isEscalationActive(task: Task, escalation: Escalation): boolean {
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
  return (task.escalations ?? []).filter((escalation) => isEscalationActive(task, escalation))
}
