import { describe, expect, it } from 'vitest'
import {
  appendFailureClassificationNote,
  appendRecoveryPlaybookNote,
  buildAgentDecisionPacket,
  classifyAgentFailure,
  describeFailureClassification,
  failureClassificationFromNote,
  latestFailureClassificationFromNotes,
  renderAgentDecisionPacket,
  resolveRecoveryPlan,
} from '../policy.js'
import type { FailureClassification, RecoveryPlaybookId } from '../policy.js'
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
          files: ['web/app/composables/use-presence.ts'],
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
      failureCode: 'provider_timeout',
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
      ref: 'provider_timeout',
    })
  })

  it('ignores infrastructure-looking reviewer prose without the machine failure code', () => {
    const verdict = reviewVerdict({
      verdict: 'revise',
      reason: 'The reviewer describes a provider timeout, but this is a substantive revision.',
      reasoning: 'The word provider appears here only as part of the model explanation.',
      failingSignals: ['substantive-review-finding'],
      llmError: 'The model mentioned a timeout in its explanation.',
    })

    expect(classifyAgentFailure({
      taskId: 'task-review-prose',
      reviewVerdicts: [verdict],
    }).class).toBe('human_product_decision')
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
          files: ['web/app/composables/use-presence.ts'],
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
          files: ['web/app/composables/use-presence.ts'],
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
          files: ['web/app/composables/use-presence.ts'],
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
          files: ['web/app/composables/use-presence.ts'],
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
          files: ['web/app/composables/use-presence.ts'],
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
            files: ['web/app/composables/use-presence.ts'],
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

  it('revives policy notes into a compact decision packet for the next agent', () => {
    const task = {
      id: 'task-stale-edit',
      notes: [
        { agentId: 'worker-agent', role: 'progress', timestamp: '2026-05-18T20:00:00.000Z', content: 'old context' },
        { agentId: 'coordinator-agent', role: 'policy-classification', timestamp: '2026-05-18T20:01:00.000Z', content: '{bad json' },
      ],
    } as Pick<Task, 'id' | 'notes'>
    const classification = classifyAgentFailure({
      taskId: task.id,
      lastToolError: {
        toolName: 'edit-file',
        filePath: 'src/runtime/policy.ts',
        message: 'oldString was not found in the file.',
      },
      touchedFiles: ['src/runtime/policy.ts'],
    })
    appendFailureClassificationNote(task, classification, {
      agentId: 'coordinator-agent',
      timestamp: '2026-05-18T20:02:00.000Z',
    })

    expect(failureClassificationFromNote(task.notes[0]!)).toBeNull()
    expect(failureClassificationFromNote(task.notes[1]!)).toBeNull()
    expect(latestFailureClassificationFromNotes(task.notes)).toMatchObject({
      class: 'stale_context',
      summary:
        'The agent tried to edit stale file contents; Guildhall should refresh the exact target before another mutation.',
    })

    const packet = buildAgentDecisionPacket({
      taskId: task.id,
      role: 'worker',
      notes: task.notes,
      touchedFiles: ['src/runtime/policy.ts'],
      lastCommand: commandEvidence({
        command: 'pnpm typecheck',
        passed: false,
        summary: 'stale edit target',
      }),
    })

    expect(packet).toMatchObject({
      taskId: task.id,
      role: 'worker',
      needsHuman: false,
      nextAction: 'Use policy playbook(s): refresh_stale_edit_target, reread_focused_file.',
      touchedFiles: ['src/runtime/policy.ts'],
    })
    expect(renderAgentDecisionPacket(packet)).toEqual(
      expect.arrayContaining([
        '- Class: stale_context',
        '- Confidence: high',
        '- Safe playbooks: refresh_stale_edit_target, reread_focused_file',
        '  - tool_error: edit-file missed oldString in touched file src/runtime/policy.ts. (src/runtime/policy.ts)',
      ]),
    )
  })

  it('falls back to an explicit human decision packet when no classification exists', () => {
    const packet = buildAgentDecisionPacket({
      taskId: 'task-no-policy',
      role: 'coordinator',
    })

    expect(packet.nextAction).toBe('Continue from the current task state.')
    expect(packet.needsHuman).toBe(false)
    expect(renderAgentDecisionPacket(packet)).toEqual(['- No policy classification recorded.'])
  })

  it('keeps every recovery playbook bounded and explainable', () => {
    const baseClassification: FailureClassification = {
      class: 'environment_unavailable',
      confidence: 'medium',
      evidence: [],
      scope: 'task',
      safePlaybooks: ['rebootstrap_project'],
      needsHuman: false,
    }
    const planFor = (playbook: RecoveryPlaybookId) =>
      resolveRecoveryPlan({
        taskId: 'task-policy',
        classification: {
          ...baseClassification,
          safePlaybooks: [playbook],
        },
        touchedFiles: ['web/package.json'],
        verification: [
          commandEvidence({
            command: 'cd web && pnpm install',
            passed: false,
            summary: 'dependency install failed',
          }),
        ],
      })

    expect(planFor('reread_focused_file')).toMatchObject({
      allowedTools: ['read-file', 'write-checkpoint', 'raise-escalation'],
      maxTurns: 1,
      stopSignals: ['same_playbook_failed', 'broad_exploration_attempted'],
    })
    expect(planFor('resume_from_checkpoint')).toMatchObject({
      command: 'cd web && pnpm install',
      maxTurns: 2,
      stopSignals: ['same_playbook_failed', 'checkpoint_invalid'],
    })
    expect(planFor('retry_current_task_context')).toMatchObject({
      reason: 'Retry from the current task brief/spec because no durable checkpoint exists yet.',
      allowedTools: ['list-files', 'read-file', 'edit-file', 'write-file', 'run-shell-command', 'write-checkpoint', 'log-progress', 'update-task', 'raise-escalation'],
      command: 'cd web && pnpm install',
      maxTurns: 1,
      successSignals: ['visible_progress_or_checkpoint_written'],
      stopSignals: ['same_playbook_failed', 'no_visible_progress_after_retry'],
    })
    expect(planFor('rebootstrap_project')).toMatchObject({
      command: 'cd web && pnpm install',
      successSignals: ['checkpoint_next_action_completed'],
    })
    expect(planFor('package_owned_dirty_work')).toMatchObject({
      allowedTools: ['run-shell-command', 'write-checkpoint', 'raise-escalation'],
      successSignals: ['owned_dirty_work_packaged'],
    })
    expect(planFor('stop_with_external_setup_action')).toMatchObject({
      allowedTools: ['raise-escalation'],
      successSignals: ['external_setup_action_recorded'],
    })
    expect(planFor('rerun_authoritative_command')).toMatchObject({
      command: 'cd web && pnpm install',
      successSignals: ['authoritative_command_reran'],
    })
    expect(planFor('route_to_review')).toMatchObject({
      allowedTools: ['write-checkpoint', 'raise-escalation'],
      successSignals: ['review_rerouted'],
    })
    expect(planFor('route_to_gate_check')).toMatchObject({
      allowedTools: ['write-checkpoint', 'raise-escalation'],
      successSignals: ['gate_check_rerouted'],
    })
    expect(planFor('ask_concrete_human_question')).toMatchObject({
      allowedTools: ['raise-escalation'],
      stopSignals: ['human_question_required'],
    })
    expect(
      resolveRecoveryPlan({
        taskId: 'task-policy',
        classification: { ...baseClassification, safePlaybooks: [] },
      }),
    ).toMatchObject({
      playbook: 'ask_concrete_human_question',
      reason: 'No safe recovery playbook was available for this blocker.',
    })
  })

  it('describes policy classes in user-facing language', () => {
    const summarize = (failureClass: FailureClassification['class']) =>
      describeFailureClassification({
        class: failureClass,
        confidence: 'low',
        evidence: [],
        scope: 'task',
        safePlaybooks: ['ask_concrete_human_question'],
        needsHuman: true,
      })

    expect(summarize('dirty_checkout_owned')).toContain('owns the dirty checkout')
    expect(summarize('dirty_checkout_external')).toContain('external changes')
    expect(summarize('environment_unavailable')).toContain('environment is unavailable')
    expect(summarize('provider_unavailable')).toContain('model provider is unavailable')
    expect(summarize('missing_target_evidence')).toContain('target-file evidence')
    expect(summarize('authoritative_command_unknown')).toContain('authoritative verification command')
    expect(summarize('scope_boundary_unclear')).toContain('scope is unclear')
    expect(summarize('model_tool_use_failure')).toContain('usable tool call')
    expect(summarize('review_packet_insufficient')).toContain('review handoff packet')
    expect(summarize('human_product_decision')).toContain('concrete human decision')
  })
})
