import type { SoftGateRubricItem } from '@guildhall/core'

/**
 * The PM's review lens. The code-review rubric in @guildhall/core covers
 * the implementation itself; these items cover the process hygiene.
 */
export const PROJECT_MANAGER_RUBRIC: SoftGateRubricItem[] = [
  {
    id: 'pm-self-critique-present',
    question:
      'Did the worker write a structured self-critique (one line per acceptance criterion, honest partials called out) before flipping to review?',
    weight: 0.9,
  },
  {
    id: 'pm-checkpoints-written',
    question:
      'Are checkpoints written at tool boundaries so the task is crash-recoverable at its current point?',
    weight: 0.6,
  },
  {
    id: 'pm-handoff-readable-cold',
    question:
      'Can a reviewer who has not seen this task before make a verdict from the task notes alone, without re-reading the exploring transcript?',
    weight: 0.8,
  },
  {
    id: 'pm-no-silent-scope-drift',
    question:
      'Are any out-of-scope changes the worker introduced either reverted or declared in the self-critique?',
    weight: 1.0,
  },
  {
    id: 'pm-audit-trail-complete',
    question:
      'Are rejection reasons, override decisions, and remediation actions persisted (not just in chat/memory)?',
    weight: 0.7,
  },
]
