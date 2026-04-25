/**
 * Task selection for the orchestrator tick loop. Pulled out of
 * `orchestrator.ts` so the fanout dispatcher (FR-24) can share the same
 * priority/status ordering when picking multiple tasks per tick.
 *
 * Two public helpers:
 *
 *   • `pickNextTask(queue, domain?, exclude?)` — the classic single-task picker
 *     used by the serial tick path. Accepts an exclusion set so the fanout
 *     picker can iterate without duplicating logic.
 *   • `needsPreRejectionPolicy(task)` — helper used by both the picker and the
 *     tick routing switch so the "pure policy decisions come first" rule has
 *     one source of truth.
 */

import { type Task, type TaskQueue, type TaskStatus } from '@guildhall/core'
import { hasOpenEscalation } from '@guildhall/tools'

/**
 * A worker-shelved task is "fresh" (needs `pre_rejection_policy` applied)
 * when its shelveReason records a worker pre-rejection the orchestrator has
 * not yet consulted the levers for.
 */
export function needsPreRejectionPolicy(task: Task): boolean {
  const r = task.shelveReason
  return (
    task.status === 'shelved' &&
    r != null &&
    r.source === 'worker_pre_rejection' &&
    !r.policyApplied
  )
}

/** Highest-priority actionable task. Status order defines the routing priority. */
export function pickNextTask(
  queue: TaskQueue,
  domain?: string,
  exclude?: ReadonlySet<string>,
): Task | undefined {
  const priority = ['critical', 'high', 'normal', 'low'] as const
  const isExcluded = exclude
    ? (t: Task) => exclude.has(t.id)
    : (_t: Task) => false

  // FR-22: worker-shelved tasks pending `pre_rejection_policy` are serviced
  // first — they're cheap (no LLM) and keeping the board clear of unresolved
  // policy decisions beats adding work before deciding whether to drop the
  // prior one.
  for (const p of priority) {
    const task = queue.tasks.find(
      (t) =>
        needsPreRejectionPolicy(t) &&
        t.priority === p &&
        (!domain || t.domain === domain) &&
        !hasOpenEscalation(t) &&
        !isExcluded(t),
    )
    if (task) return task
  }

  const statuses: TaskStatus[] = [
    // FR-21: proposals are cheapest to service (pure lever decision, no LLM)
    // so they run first — keeps the board clear of unresolved proposals
    // before exploratory or in-flight work consumes a tick.
    'proposed',
    'exploring',
    'spec_review',
    'ready',
    'in_progress',
    'review',
    'gate_check',
  ]

  for (const status of statuses) {
    for (const p of priority) {
      const task = queue.tasks.find(
        (t) =>
          t.status === status &&
          !(t.domain === '_meta' && t.status === 'spec_review' && Boolean(t.spec)) &&
          t.priority === p &&
          (!domain || t.domain === domain) &&
          // FR-10: halt any task with an unresolved escalation regardless of status
          !hasOpenEscalation(t) &&
          !isExcluded(t),
      )
      if (task) return task
    }
  }
  return undefined
}
