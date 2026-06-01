import { describe, expect, it } from 'vitest'

import {
  applyTaskTransition,
  taskLifecycleMachine,
  transitionTaskStatus,
  type TaskTransitionEvent,
} from '../task-transition.js'
import { transitionTable } from '../state-machine.js'

const now = '2026-06-01T12:00:00.000Z'

describe('task transitions', () => {
  it('applies legal ready to in_progress transition', () => {
    const result = applyTaskTransition({
      task: { id: 'task-1', status: 'ready' },
      event: 'start_worker',
      actor: 'orchestrator',
      now,
      evidenceRefs: ['task:start-worker'],
    })

    expect(result).toMatchObject({
      kind: 'applied',
      nextState: 'in_progress',
      receipt: { from: 'ready', to: 'in_progress', event: 'start_worker' },
    })
  })

  it('rejects worker start for containing work that still needs split children', () => {
    const result = applyTaskTransition({
      task: {
        id: 'feature',
        status: 'ready',
        hierarchy: { childIds: ['child-a'] },
        taskReadiness: { recommendation: 'split' },
      },
      event: 'start_worker',
      actor: 'orchestrator',
      now,
      evidenceRefs: ['task:start-worker'],
    })

    expect(result).toMatchObject({ kind: 'rejected', reason: 'containing_work_not_runnable' })
  })

  it('allows worker start for containing work after readiness is explicitly ready', () => {
    const task = {
      id: 'feature',
      status: 'ready' as const,
      hierarchy: { childIds: ['child-a'] },
      taskReadiness: { recommendation: 'ready' },
    }

    const receipt = transitionTaskStatus({
      task,
      event: 'start_worker',
      actor: 'orchestrator',
      now,
      evidenceRefs: ['task:start-worker'],
    })

    expect(task.status).toBe('in_progress')
    expect(receipt).toMatchObject({
      machineId: 'task-lifecycle',
      from: 'ready',
      to: 'in_progress',
      event: 'start_worker',
    })
  })

  it('rejects illegal worker start from intake states', () => {
    const result = applyTaskTransition({
      task: { id: 'task-1', status: 'exploring' },
      event: 'start_worker',
      actor: 'orchestrator',
      now,
      evidenceRefs: ['task:start-worker'],
    })

    expect(result).toMatchObject({ kind: 'rejected', currentState: 'exploring', reason: 'event_not_allowed' })
  })

  it('requires completion evidence before terminal done transitions', () => {
    const rejected = applyTaskTransition({
      task: { id: 'task-1', status: 'gate_check' },
      event: 'complete',
      actor: 'gate-checker',
      now,
      evidenceRefs: ['task:gates'],
    })
    const applied = applyTaskTransition({
      task: { id: 'task-1', status: 'gate_check' },
      event: 'complete',
      actor: 'gate-checker',
      now,
      evidenceRefs: ['task:gates'],
      requiredEvidencePresent: true,
    })

    expect(rejected).toMatchObject({ kind: 'rejected', reason: 'required_evidence_missing' })
    expect(applied).toMatchObject({ kind: 'applied', nextState: 'done' })
  })

  it('normalizes imported drafts through explicit intake events', () => {
    const draft = transitionTaskStatus({
      task: { id: 'task-1', status: 'exploring' },
      event: 'mark_import_draft',
      actor: 'workspace-importer',
      now,
      evidenceRefs: ['task:workspace-import'],
    })
    const resumed = applyTaskTransition({
      task: { id: 'task-1', status: 'import_draft' },
      event: 'start_intake',
      actor: 'human',
      now,
      evidenceRefs: ['task:shape-import-draft'],
    })

    expect(draft).toMatchObject({ from: 'exploring', to: 'import_draft' })
    expect(resumed).toMatchObject({ kind: 'applied', nextState: 'exploring' })
  })

  it('keeps hold and resume out of the task lifecycle table', () => {
    const events = new Set(transitionTable(taskLifecycleMachine).map((row) => row.event))

    expect(events.has('hold' as TaskTransitionEvent)).toBe(false)
    expect(events.has('resume' as TaskTransitionEvent)).toBe(false)
  })
})
