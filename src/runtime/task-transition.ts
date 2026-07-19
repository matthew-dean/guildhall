import type { TaskStatus } from '@guildhall/core'

import {
  defineStateMachine,
  transition,
  type StateMachineStates,
  type TransitionReceipt,
  type TransitionResult,
} from './state-machine.js'

export type TaskTransitionEvent =
  | 'mark_import_draft'
  | 'start_intake'
  | 'mark_spec_review'
  | 'mark_ready'
  | 'start_worker'
  | 'request_review'
  | 'restart_review'
  | 'start_gate_check'
  | 'revise'
  | 'complete'
  | 'await_pull_request'
  | 'landing_failed'
  | 'recover_to_exploring'
  | 'recover_to_spec_review'
  | 'recover_to_ready'
  | 'recover_to_in_progress'
  | 'recover_to_review'
  | 'block'
  | 'shelve'

export type TaskTransitionState = TaskStatus

export type TaskTransitionReceipt = TransitionReceipt<TaskTransitionState, TaskTransitionEvent> & {
  machineId: 'task-lifecycle'
}

export interface TaskTransitionContext {
  task: {
    id: string
    status: TaskTransitionState
    hierarchy?: { childIds?: string[] }
    taskReadiness?: { recommendation?: string }
  }
  requiredEvidencePresent?: boolean
}

const requireRunnableWork = (context: TaskTransitionContext) => {
  const childIds = context.task.hierarchy?.childIds ?? []
  if (childIds.length > 0 && context.task.taskReadiness?.recommendation !== 'ready') {
    return { ok: false as const, reason: 'containing_work_not_runnable' }
  }
  return { ok: true as const }
}

const requireCompletionEvidence = (context: TaskTransitionContext) => {
  if (!context.requiredEvidencePresent) {
    return { ok: false as const, reason: 'required_evidence_missing' }
  }
  return { ok: true as const }
}

const block = { to: 'blocked' as const }

const taskLifecycleStates: StateMachineStates<TaskTransitionState, TaskTransitionEvent, TaskTransitionContext> = {
  proposed: {
    on: {
      mark_spec_review: { to: 'spec_review' },
      mark_ready: { to: 'ready' },
      block,
      shelve: { to: 'shelved' },
    },
  },
  import_draft: {
    on: {
      start_intake: { to: 'exploring' },
      mark_spec_review: { to: 'spec_review' },
      mark_ready: { to: 'ready' },
      block,
    },
  },
  exploring: {
    on: {
      mark_import_draft: { to: 'import_draft' },
      mark_spec_review: { to: 'spec_review' },
      mark_ready: { to: 'ready' },
      block,
      shelve: { to: 'shelved' },
    },
  },
  spec_review: {
    on: {
      recover_to_exploring: { to: 'exploring' },
      mark_spec_review: { to: 'spec_review' },
      mark_ready: { to: 'ready' },
      block,
      shelve: { to: 'shelved' },
    },
  },
  ready: {
    on: {
      start_worker: { to: 'in_progress', guard: requireRunnableWork },
      recover_to_exploring: { to: 'exploring' },
      block,
      shelve: { to: 'shelved' },
    },
  },
  in_progress: {
    on: {
      request_review: { to: 'review' },
      recover_to_exploring: { to: 'exploring' },
      block,
      shelve: { to: 'shelved' },
    },
  },
  review: {
    on: {
      restart_review: { to: 'review' },
      recover_to_exploring: { to: 'exploring' },
      revise: { to: 'in_progress' },
      start_gate_check: { to: 'gate_check' },
      complete: { to: 'done', guard: requireCompletionEvidence },
      block,
    },
  },
  gate_check: {
    on: {
      restart_review: { to: 'review' },
      recover_to_exploring: { to: 'exploring' },
      revise: { to: 'in_progress' },
      complete: { to: 'done', guard: requireCompletionEvidence },
      block,
    },
  },
  pending_pr: {
    on: {
      complete: { to: 'done', guard: requireCompletionEvidence },
      block,
    },
  },
  blocked: {
    on: {
      recover_to_exploring: { to: 'exploring' },
      recover_to_spec_review: { to: 'spec_review' },
      recover_to_ready: { to: 'ready' },
      recover_to_in_progress: { to: 'in_progress' },
      recover_to_review: { to: 'review' },
    },
  },
  archived: { on: {} },
  cancelled: { on: {} },
  shelved: { on: {} },
  done: {
    on: {
      await_pull_request: { to: 'pending_pr' },
      landing_failed: { to: 'blocked' },
    },
  },
}

export const taskLifecycleMachine = defineStateMachine<TaskTransitionState, TaskTransitionEvent, TaskTransitionContext>({
  id: 'task-lifecycle',
  version: 1,
  initial: 'proposed',
  terminal: ['shelved'],
  states: taskLifecycleStates,
})

export function applyTaskTransition(input: {
  task: TaskTransitionContext['task']
  event: TaskTransitionEvent
  actor: string
  evidenceRefs?: string[]
  now: string
  requiredEvidencePresent?: boolean
}): TransitionResult<TaskTransitionState, TaskTransitionEvent> {
  return transition(taskLifecycleMachine, {
    entityId: input.task.id,
    currentState: input.task.status,
    event: input.event,
    context: {
      task: input.task,
      requiredEvidencePresent: input.requiredEvidencePresent,
    },
    actor: input.actor,
    evidenceRefs: input.evidenceRefs ?? [],
    now: input.now,
  })
}

export function transitionTaskStatus(input: {
  task: TaskTransitionContext['task']
  event: TaskTransitionEvent
  actor: string
  evidenceRefs?: string[]
  now: string
  requiredEvidencePresent?: boolean
}): TaskTransitionReceipt {
  const result = applyTaskTransition(input)
  if (result.kind === 'rejected') {
    throw new Error(
      `Task ${input.task.id} cannot ${input.event.replaceAll('_', ' ')} from ${input.task.status}: ${result.reason}`,
    )
  }
  input.task.status = result.nextState
  return {
    ...result.receipt,
    machineId: 'task-lifecycle',
  }
}
