/**
 * FR-22: apply the `pre_rejection_policy` lever (domain) and the
 * `rejection_dampening` lever (project) to a worker-originated `shelved`
 * task. Pure function — no I/O. Returns a structured decision the
 * orchestrator translates into TASKS.json mutations and a PROGRESS entry.
 *
 * Domain `pre_rejection_policy` positions:
 *   - terminal_shelved          → keep shelved, mark policyApplied
 *   - requeue_lower_priority    → flip to ready, priority steps down one notch
 *   - requeue_with_dampening    → requeue unless `rejection_dampening` says
 *                                 this task has been re-rejected too many
 *                                 times; then either floor priority to `low`
 *                                 (soft_penalty) or keep shelved (hard_suppress)
 *
 * Project `rejection_dampening` only participates when the domain lever is
 * `requeue_with_dampening`. Other positions ignore dampening.
 */

import type { TaskPriority } from '@guildhall/core'
import type { DomainLevers, ProjectLevers } from '@guildhall/levers'

export type PreRejectionAction =
  /** No-op: keep the task shelved; just mark policy as applied. */
  | { kind: 'keep_shelved'; reason: string }
  /** Resurrect: flip status back to `ready` with the given priority. */
  | { kind: 'requeue'; newPriority: TaskPriority; reason: string }

export interface PreRejectionDecision {
  action: PreRejectionAction
  /** How many times this task has now been shelved (inclusive of this event). */
  requeueCount: number
  domainLeverPosition: DomainLevers['pre_rejection_policy']['position']
  projectLeverPosition: ProjectLevers['rejection_dampening']['position']
}

export interface EvaluatePreRejectionInput {
  /** Current task-recorded requeue count before this decision. */
  currentRequeueCount: number
  /** Priority the task had before shelving. */
  currentPriority: TaskPriority
  domain: Pick<DomainLevers, 'pre_rejection_policy'>
  project: Pick<ProjectLevers, 'rejection_dampening'>
}

const PRIORITY_ORDER: TaskPriority[] = ['critical', 'high', 'normal', 'low']

function stepDown(priority: TaskPriority): TaskPriority {
  const idx = PRIORITY_ORDER.indexOf(priority)
  if (idx === -1 || idx === PRIORITY_ORDER.length - 1) return 'low'
  return PRIORITY_ORDER[idx + 1]!
}

export function evaluatePreRejection(
  input: EvaluatePreRejectionInput,
): PreRejectionDecision {
  const domainPos = input.domain.pre_rejection_policy.position
  const dampening = input.project.rejection_dampening.position
  // Each policy decision counts the current shelve event, so the task's
  // stored requeueCount reflects total-times-shelved after this tick.
  const nextCount = input.currentRequeueCount + 1

  switch (domainPos) {
    case 'terminal_shelved':
      return {
        action: {
          kind: 'keep_shelved',
          reason: 'pre_rejection_policy=terminal_shelved: shelved is final',
        },
        requeueCount: nextCount,
        domainLeverPosition: domainPos,
        projectLeverPosition: dampening,
      }

    case 'requeue_lower_priority':
      return {
        action: {
          kind: 'requeue',
          newPriority: stepDown(input.currentPriority),
          reason:
            'pre_rejection_policy=requeue_lower_priority: requeue one priority notch lower',
        },
        requeueCount: nextCount,
        domainLeverPosition: domainPos,
        projectLeverPosition: dampening,
      }

    case 'requeue_with_dampening': {
      if (dampening.kind === 'off') {
        return {
          action: {
            kind: 'requeue',
            newPriority: stepDown(input.currentPriority),
            reason:
              'pre_rejection_policy=requeue_with_dampening, rejection_dampening=off: requeue one priority notch lower',
          },
          requeueCount: nextCount,
          domainLeverPosition: domainPos,
          projectLeverPosition: dampening,
        }
      }
      if (dampening.kind === 'soft_penalty') {
        // After the threshold, floor to `low` but still requeue.
        const newPriority: TaskPriority =
          nextCount >= dampening.after ? 'low' : stepDown(input.currentPriority)
        return {
          action: {
            kind: 'requeue',
            newPriority,
            reason:
              `pre_rejection_policy=requeue_with_dampening, rejection_dampening=soft_penalty(after=${dampening.after}): ` +
              (nextCount >= dampening.after
                ? 'threshold crossed, priority floored to low'
                : 'below threshold, one notch down'),
          },
          requeueCount: nextCount,
          domainLeverPosition: domainPos,
          projectLeverPosition: dampening,
        }
      }
      // hard_suppress: below threshold requeue one notch down; at/above
      // threshold stay shelved as truly suppressed.
      if (nextCount >= dampening.after) {
        return {
          action: {
            kind: 'keep_shelved',
            reason:
              `pre_rejection_policy=requeue_with_dampening, rejection_dampening=hard_suppress(after=${dampening.after}): ` +
              'threshold reached, task suppressed',
          },
          requeueCount: nextCount,
          domainLeverPosition: domainPos,
          projectLeverPosition: dampening,
        }
      }
      return {
        action: {
          kind: 'requeue',
          newPriority: stepDown(input.currentPriority),
          reason:
            `pre_rejection_policy=requeue_with_dampening, rejection_dampening=hard_suppress(after=${dampening.after}): ` +
            'below threshold, requeue one notch down',
        },
        requeueCount: nextCount,
        domainLeverPosition: domainPos,
        projectLeverPosition: dampening,
      }
    }

    default: {
      // Exhaustiveness sentinel — new positions must be handled above.
      const _exhaustive: never = domainPos
      throw new Error(`Unhandled pre_rejection_policy position: ${String(_exhaustive)}`)
    }
  }
}
