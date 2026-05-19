import { describe, expect, it } from 'vitest'
import {
  appendFailureClassificationNote,
  appendRecoveryPlaybookNote,
  classifyAgentFailure,
  describeFailureClassification,
  resolveRecoveryPlan,
} from '../policy.js'
import type { ReviewVerdict, Task } from '@guildhall/core'
import {
  checkpointEvidence,
  commandEvidence,
  reviewVerdict,
  touchedFiles,
} from './policy-fixtures.js'

describe('policy failure classifier', () => {
  it('classifies failed verification in touched files as self-authored repair work', () => {
    const classification = classifyAgentFailure({
      taskId: 'task-auth-import',
      blockReason: 'gate_hard_failure: cd web && pnpm typecheck failed',
      touchedFiles: touchedFiles('web/app/composables/use-presence.ts'),
      verification: [
        commandEvidence({
          command: 'cd web && pnpm typecheck',
          passed: false,
          summary: 'web/app/composables/use-presence.ts(12,7): Cannot find name PresenceState.',
        }),
      ],
    })

    expect(classification).toMatchObject({
      class: 'self_authored_verification_failure',
      confidence: 'high',
      scope: 'task',
      needsHuman: false,
      safePlaybooks: ['repair_touched_file_failure', 'rerun_authoritative_command'],
    })
    expect(classification.evidence).toContainEqual({
      kind: 'verification',
      summary: 'Failed verification references touched file web/app/composables/use-presence.ts.',
      ref: 'cd web && pnpm typecheck',
    })
  })

  it('classifies an oldString miss against a touched file as stale context', () => {
    const classification = classifyAgentFailure({
      taskId: 'task-stale-edit',
      lastToolError: {
        toolName: 'edit-file',
        filePath: 'src/runtime/orchestrator.ts',
        message:
          'oldString was not found in the file. Re-read the file and use an exact substring from the current contents.',
      },
      touchedFiles: ['src/runtime/orchestrator.ts'],
    })

    expect(classification).toMatchObject({
      class: 'stale_context',
      confidence: 'high',
      scope: 'task',
      needsHuman: false,
      safePlaybooks: ['refresh_stale_edit_target', 'reread_focused_file'],
    })
    expect(classification.evidence).toContainEqual({
      kind: 'tool_error',
      summary: 'edit-file missed oldString in touched file src/runtime/orchestrator.ts.',
      ref: 'src/runtime/orchestrator.ts',
    })
  })

  it('classifies reviewer timeouts and provider errors as infrastructure noise', () => {
    const verdict: ReviewVerdict = reviewVerdict({
      verdict: 'revise',
      reviewerPath: 'deterministic',
      reason: 'Reviewer model timed out before producing a substantive verdict.',
      failingSignals: ['reviewer_timeout'],
      llmError: 'HTTP 429 provider throttle',
    })

    const classification = classifyAgentFailure({
      taskId: 'task-review-noise',
      reviewVerdicts: [verdict],
    })

    expect(classification).toMatchObject({
      class: 'reviewer_infrastructure_noise',
      confidence: 'medium',
      scope: 'task',
      needsHuman: false,
      safePlaybooks: ['route_to_review'],
    })
    expect(classification.evidence).toContainEqual({
      kind: 'review',
      summary: 'Reviewer verdict contains infrastructure failure evidence.',
      ref: 'Reviewer model timed out before producing a substantive verdict.',
    })
  })

  it('renders a compact user-facing classification reason', () => {
    const classification = classifyAgentFailure({
      taskId: 'task-auth-import',
      touchedFiles: touchedFiles('web/app/composables/use-presence.ts'),
      verification: [
        commandEvidence({
          command: 'cd web && pnpm typecheck',
          passed: false,
          summary: 'web/app/composables/use-presence.ts(12,7): Cannot find name PresenceState.',
        }),
      ],
    })

    expect(describeFailureClassification(classification)).toBe(
      'Verification failed in files the worker already touched; Guildhall can keep this in focused repair.',
    )
  })

  it('stores classification output in the task audit trail', () => {
    const task = {
      id: 'task-auth-import',
      notes: [],
    } as Pick<Task, 'id' | 'notes'>
    const checkpoint = checkpointEvidence({
      taskId: task.id,
      filesTouched: touchedFiles('web/app/composables/use-presence.ts'),
      verification: [
        commandEvidence({
          command: 'cd web && pnpm typecheck',
          passed: false,
          summary: 'web/app/composables/use-presence.ts(12,7): Cannot find name PresenceState.',
        }),
      ],
    })
    const classification = classifyAgentFailure({
      taskId: task.id,
      touchedFiles: checkpoint.filesTouched,
      verification: checkpoint.resumeContext?.verification,
    })

    appendFailureClassificationNote(task, classification, {
      agentId: 'coordinator-agent',
      timestamp: '2026-05-18T20:30:00.000Z',
    })

    expect(task.notes).toHaveLength(1)
    const note = task.notes[0]
    expect(note).toMatchObject({
      agentId: 'coordinator-agent',
      role: 'policy-classification',
      timestamp: '2026-05-18T20:30:00.000Z',
    })
    expect(JSON.parse(note?.content ?? '{}')).toMatchObject({
      class: 'self_authored_verification_failure',
      confidence: 'high',
      summary:
        'Verification failed in files the worker already touched; Guildhall can keep this in focused repair.',
      safePlaybooks: ['repair_touched_file_failure', 'rerun_authoritative_command'],
    })
  })

  it('resolves failed touched-file verification into a bounded repair playbook', () => {
    const classification = classifyAgentFailure({
      taskId: 'task-auth-import',
      touchedFiles: touchedFiles('web/app/composables/use-presence.ts'),
      verification: [
        commandEvidence({
          command: 'cd web && pnpm typecheck',
          passed: false,
          summary: 'web/app/composables/use-presence.ts(12,7): Cannot find name PresenceState.',
        }),
      ],
    })

    const plan = resolveRecoveryPlan({
      taskId: 'task-auth-import',
      classification,
      touchedFiles: touchedFiles('web/app/composables/use-presence.ts'),
      verification: [
        commandEvidence({
          command: 'cd web && pnpm typecheck',
          passed: false,
          summary: 'web/app/composables/use-presence.ts(12,7): Cannot find name PresenceState.',
        }),
      ],
    })

    expect(plan).toMatchObject({
      playbook: 'repair_touched_file_failure',
      command: 'cd web && pnpm typecheck',
      maxTurns: 2,
      auditRequired: true,
      allowedPaths: ['web/app/composables/use-presence.ts'],
    })
    expect(plan.allowedTools).toEqual([
      'read-file',
      'edit-file',
      'run-shell-command',
      'write-checkpoint',
      'raise-escalation',
    ])
    expect(plan.stopSignals).toContain('same_playbook_failed')
  })

  it('downgrades to a concrete human question after the same playbook fails', () => {
    const task = {
      id: 'task-auth-import',
      notes: [],
    } as Pick<Task, 'id' | 'notes'>
    const classification = classifyAgentFailure({
      taskId: task.id,
      touchedFiles: touchedFiles('web/app/composables/use-presence.ts'),
      verification: [
        commandEvidence({
          command: 'cd web && pnpm typecheck',
          passed: false,
          summary: 'web/app/composables/use-presence.ts(12,7): Cannot find name PresenceState.',
        }),
      ],
    })
    const firstPlan = resolveRecoveryPlan({
      taskId: task.id,
      classification,
      touchedFiles: touchedFiles('web/app/composables/use-presence.ts'),
    })
    appendRecoveryPlaybookNote(task, firstPlan, {
      agentId: 'coordinator-agent',
      timestamp: '2026-05-18T20:31:00.000Z',
      status: 'failed',
      summary: 'Focused repair did not clear the verification failure.',
    })

    const followUp = resolveRecoveryPlan({
      taskId: task.id,
      classification,
      touchedFiles: touchedFiles('web/app/composables/use-presence.ts'),
      notes: task.notes,
    })

    expect(followUp).toMatchObject({
      playbook: 'ask_concrete_human_question',
      maxTurns: 1,
      auditRequired: true,
    })
    expect(followUp.reason).toContain('already failed')
    expect(followUp.stopSignals).toContain('human_question_required')
  })

  it('stores recovery playbook audit entries in the task audit trail', () => {
    const task = {
      id: 'task-auth-import',
      notes: [],
    } as Pick<Task, 'id' | 'notes'>
    const plan = resolveRecoveryPlan({
      taskId: task.id,
      classification: classifyAgentFailure({
        taskId: task.id,
        touchedFiles: touchedFiles('web/app/composables/use-presence.ts'),
        verification: [
          commandEvidence({
            command: 'cd web && pnpm typecheck',
            passed: false,
            summary: 'web/app/composables/use-presence.ts(12,7): Cannot find name PresenceState.',
          }),
        ],
      }),
      touchedFiles: touchedFiles('web/app/composables/use-presence.ts'),
    })

    appendRecoveryPlaybookNote(task, plan, {
      agentId: 'coordinator-agent',
      timestamp: '2026-05-18T20:31:00.000Z',
      status: 'started',
    })

    expect(task.notes).toHaveLength(1)
    expect(task.notes[0]).toMatchObject({
      agentId: 'coordinator-agent',
      role: 'recovery-playbook',
      timestamp: '2026-05-18T20:31:00.000Z',
    })
    expect(JSON.parse(task.notes[0]?.content ?? '{}')).toMatchObject({
      status: 'started',
      playbook: 'repair_touched_file_failure',
      maxTurns: 2,
      allowedPaths: ['web/app/composables/use-presence.ts'],
    })
  })
})
