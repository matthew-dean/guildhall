import { describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Task, TaskQueue } from '@guildhall/core'
import {
  appendTaskEvidence,
  getProjectSystemStatePath,
  projectStateDatabasePath,
  promoteProjectStateDatabaseAuthority,
  readTaskEvidence,
  readTaskRuntimeStore,
  upsertTaskRuntimeState,
  writeProjectStateDatabaseSnapshot,
} from '@guildhall/sessions'
import {
  repairCompletionProofCriteriaInQueue,
  repairCompletionProofCriteriaForProject,
  repairCompletionProofCriteriaForProjectWithEvidence,
  repairStaleBlockersForProject,
  repairStaleBlockersForProjectWithRuntime,
  repairStaleBlockersInQueue,
} from '../stale-blocker-repair.js'
import { readProjectTaskQueueForMutationSync, readProjectTaskQueueForRichMutation } from '../project-state-boundary.js'

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    title: 'Do the thing',
    description: 'Details',
    domain: 'frontend',
    status: 'blocked',
    priority: 'normal',
    acceptanceCriteria: [],
    outOfScope: [],
    dependsOn: [],
    projectPath: '/tmp/guildhall-test-project',
    notes: [],
    gateResults: [],
    reviewVerdicts: [],
    adjudications: [],
    escalations: [],
    agentIssues: [],
    revisionCount: 0,
    remediationAttempts: 0,
    origination: 'human',
    createdAt: '2026-05-23T00:00:00.000Z',
    updatedAt: '2026-05-23T00:00:00.000Z',
    ...overrides,
  }
}

function queue(tasks: Task[]): TaskQueue {
  return {
    version: 1,
    lastUpdated: '2026-05-23T00:00:00.000Z',
    tasks,
  }
}

describe('repairStaleBlockersInQueue', () => {
  it('returns skipped landing work with missing review approval to review', () => {
    const q = queue([
      task({
        id: 'task-missing-review',
        acceptanceCriteria: [{
          id: 'ac-review',
          description: 'A reviewer approves the saved implementation.',
          verifiedBy: 'review',
          met: false,
        }],
        mergeRecord: {
          fromBranch: 'guildhall/task-missing-review',
          toBranch: 'main',
          strategy: 'cherry_pick_local',
          result: 'skipped',
          mergedAt: '2026-08-30T14:32:16.611Z',
        },
      }),
    ])

    const result = repairStaleBlockersInQueue(q, '2026-08-30T15:00:00.000Z')

    expect(result.repairs).toEqual([{
      taskId: 'task-missing-review',
      previousStatus: 'blocked',
      nextStatus: 'review',
      reason: 'missing_review_after_skipped_landing',
    }])
    expect(q.tasks[0]).toMatchObject({ status: 'review', assignedTo: 'reviewer-agent' })
    expect(q.tasks[0]?.blockReason).toBeUndefined()
  })

  it('reopens stale cross-task guardrail blockers before they reach the UI', () => {
    const q = queue([
      task({
        id: 'task-stripe-integration',
        title: 'Stripe Connect',
        blockReason: 'scope_boundary: Blocked by cross-task guardrail forcing unrelated useAuth.ts file creation.',
        escalations: [
          {
            id: 'esc-1',
            taskId: 'task-stripe-integration',
            agentId: 'spec-agent',
            reason: 'scope_boundary',
            recoveryCode: 'tool_path_mismatch',
            summary: 'Blocked by cross-task guardrail forcing unrelated useAuth.ts file creation.',
            details: 'Current task is Stripe Connect, but tooling is forcing action on frontend/app/composables/useAuth.ts.',
            raisedAt: '2026-05-22T16:30:07.240Z',
          },
        ],
      }),
    ])

    const result = repairStaleBlockersInQueue(q, '2026-05-23T12:00:00.000Z')

    expect(result.repairs).toEqual([
      {
        taskId: 'task-stripe-integration',
        previousStatus: 'blocked',
        nextStatus: 'exploring',
        reason: 'stale_internal_tooling_blocker',
      },
    ])
    expect(q.tasks[0]?.status).toBe('exploring')
    expect(q.tasks[0]?.blockReason).toBeUndefined()
    expect(q.tasks[0]?.escalations[0]?.resolvedBy).toBe('system')
    expect(q.tasks[0]?.notes.at(-1)?.role).toBe('state-repair')
  })

  it('does not repair ordinary scope questions that need a real decision', () => {
    const q = queue([
      task({
        blockReason: 'scope_boundary: The task scope is unclear.',
        escalations: [
          {
            id: 'esc-1',
            taskId: 'task-1',
            agentId: 'worker-agent',
            reason: 'scope_boundary',
            summary: 'Task scope is unclear.',
            details: 'The request conflicts with the accepted spec and needs owner input.',
            raisedAt: '2026-05-23T00:00:00.000Z',
          },
        ],
      }),
    ])

    const result = repairStaleBlockersInQueue(q, '2026-05-23T12:00:00.000Z')

    expect(result.changed).toBe(false)
    expect(q.tasks[0]?.status).toBe('blocked')
    expect(q.tasks[0]?.escalations[0]?.resolvedAt).toBeUndefined()
  })

  it('does not classify model-shaped prose without a typed recovery fact', () => {
    const q = queue([
      task({
        id: 'task-prose-only-recovery',
        blockReason: 'human_judgment_required: Worker stopped after hitting its turn limit.',
        notes: [{
          agentId: 'coordinator',
          role: 'policy-classification',
          timestamp: '2026-05-23T00:00:00.000Z',
          content: JSON.stringify({
            class: 'model_tool_use_failure',
            needsHuman: true,
            summary: 'The model failed to produce a usable tool call.',
          }),
        }],
        escalations: [{
          id: 'esc-prose-only-recovery',
          taskId: 'task-prose-only-recovery',
          agentId: 'worker-agent',
          reason: 'human_judgment_required',
          summary: 'Worker stopped after hitting its turn limit.',
          details: 'The model failed to produce a usable tool call.',
          raisedAt: '2026-05-23T00:00:00.000Z',
        }],
      }),
    ])

    const result = repairStaleBlockersInQueue(q, '2026-05-23T12:00:00.000Z')

    expect(result.changed).toBe(false)
    expect(q.tasks[0]?.status).toBe('blocked')
    expect(q.tasks[0]?.blockReason).toContain('turn limit')
    expect(q.tasks[0]?.escalations[0]?.resolvedAt).toBeUndefined()
  })

  it('preserves typed recovery boundaries when the orchestrator owns the transition', () => {
    const q = queue([
      task({
        id: 'task-typed-recovery',
        blockReason: 'scope_boundary: The worker needs a typed recovery route.',
        recoveryCode: 'target_shape_mismatch',
        escalations: [{
          id: 'esc-typed-recovery',
          taskId: 'task-typed-recovery',
          agentId: 'worker-agent',
          reason: 'scope_boundary',
          recoveryCode: 'target_shape_mismatch',
          summary: 'The target shape needs the specialized recovery handler.',
          details: 'Do not let generic stale repair consume this state.',
          raisedAt: '2026-05-23T00:00:00.000Z',
        }],
      }),
    ])

    const result = repairStaleBlockersInQueue(q, '2026-05-23T12:00:00.000Z', {
      preserveTypedRecoveries: true,
    })

    expect(result.changed).toBe(false)
    expect(q.tasks[0]?.status).toBe('blocked')
    expect(q.tasks[0]?.recoveryCode).toBe('target_shape_mismatch')
    expect(q.tasks[0]?.escalations[0]?.resolvedAt).toBeUndefined()
  })

  it('reopens model/tool-use failures instead of preserving them as human blockers', () => {
    const q = queue([
      task({
        id: 'task-model-failure',
        blockReason: 'human_judgment_required: Spec author stopped after hitting its turn limit.',
        notes: [
          {
            agentId: 'coordinator',
            role: 'policy-classification',
            timestamp: '2026-05-23T00:00:00.000Z',
            content: JSON.stringify({
              class: 'model_tool_use_failure',
              confidence: 'medium',
              scope: 'task',
              needsHuman: true,
              humanQuestion: 'Should Guildhall retry from the checkpoint, narrow the task, or stop?',
              safePlaybooks: ['ask_concrete_human_question'],
              evidence: [],
              summary: 'The model failed to produce a usable tool call, so Guildhall should use a bounded repair prompt.',
            }),
          },
        ],
        escalations: [{
          id: 'esc-model-failure',
          taskId: 'task-model-failure',
          agentId: 'spec-agent',
          reason: 'human_judgment_required',
          recoveryCode: 'worker_turn_limit',
          summary: 'The model failed to produce a usable tool call, so Guildhall should use a bounded repair prompt.',
          raisedAt: '2026-05-23T00:00:00.000Z',
        }],
      }),
    ])

    const result = repairStaleBlockersInQueue(q, '2026-05-23T12:00:00.000Z')

    expect(result.repairs).toEqual([
      {
        taskId: 'task-model-failure',
        previousStatus: 'blocked',
        nextStatus: 'exploring',
        reason: 'model_tool_use_recovery_blocker',
      },
    ])
    expect(q.tasks[0]?.status).toBe('exploring')
    expect(q.tasks[0]?.blockReason).toBeUndefined()
    expect(q.tasks[0]?.assignedTo).toBe('spec-agent')
    expect(q.tasks[0]?.notes.at(-1)?.role).toBe('state-repair')
  })

  it('hands stale dirty worker timeout blockers to review instead of owner input', () => {
    const q = queue([
      task({
        id: 'task-dirty-worker-timeout',
        blockReason: 'human_judgment_required: Worker repeatedly hit its turn budget after saving partial work.',
        notes: [
          {
            agentId: 'coordinator',
            role: 'policy-classification',
            timestamp: '2026-05-23T00:00:00.000Z',
            content: JSON.stringify({
              class: 'model_tool_use_failure',
              confidence: 'medium',
              scope: 'task',
              needsHuman: true,
              humanQuestion: 'Should Guildhall retry from the partial diff, narrow the task, or switch provider?',
              safePlaybooks: ['ask_concrete_human_question'],
              evidence: [],
              summary: 'The model failed to produce a usable tool call, so Guildhall should use a bounded repair prompt.',
            }),
          },
        ],
        escalations: [{
          id: 'esc-dirty-worker-timeout',
          taskId: 'task-dirty-worker-timeout',
          agentId: 'worker-agent',
          reason: 'human_judgment_required',
          recoveryCode: 'worker_timeout_likely_target',
          summary: 'The model failed to produce a usable tool call, so Guildhall should use a bounded repair prompt.',
          raisedAt: '2026-05-23T00:00:00.000Z',
        }],
      }),
    ])

    const result = repairStaleBlockersInQueue(q, '2026-05-23T12:00:00.000Z')

    expect(result.repairs).toEqual([
      {
        taskId: 'task-dirty-worker-timeout',
        previousStatus: 'blocked',
        nextStatus: 'review',
        reason: 'model_tool_use_recovery_blocker',
      },
    ])
    expect(q.tasks[0]?.status).toBe('review')
    expect(q.tasks[0]?.blockReason).toBeUndefined()
    expect(q.tasks[0]?.assignedTo).toBe('reviewer-agent')
    expect(q.tasks[0]?.notes.at(-1)?.content)
      .toContain('review the saved partial diff instead of asking the owner')
  })

  it('repairs compact dirty worker timeout blockers even when runtime notes were evacuated', () => {
    const q = queue([
      task({
        id: 'task-compact-dirty-worker-timeout',
        blockReason: 'human_judgment_required: Worker repeatedly hit its turn budget after saving partial work.',
        notes: [],
        escalations: [{
          id: 'esc-compact-dirty-worker-timeout',
          taskId: 'task-compact-dirty-worker-timeout',
          agentId: 'worker-agent',
          reason: 'human_judgment_required',
          recoveryCode: 'worker_timeout_likely_target',
          summary: 'A compact runtime record requires recovery.',
          raisedAt: '2026-05-23T00:00:00.000Z',
        }],
      }),
    ])

    const result = repairStaleBlockersInQueue(q, '2026-05-23T12:00:00.000Z')

    expect(result.repairs[0]).toMatchObject({
      taskId: 'task-compact-dirty-worker-timeout',
      previousStatus: 'blocked',
      nextStatus: 'review',
      reason: 'model_tool_use_recovery_blocker',
    })
    expect(q.tasks[0]?.status).toBe('review')
    expect(q.tasks[0]?.assignedTo).toBe('reviewer-agent')
    expect(q.tasks[0]?.blockReason).toBeUndefined()
  })

  it('reconciles stale runtime and visible evidence when a repaired review task was already unblocked', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'guildhall-stale-runtime-repair-'))
    const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
    mkdirSync(dirname(tasksPath), { recursive: true })
    writeFileSync(tasksPath, JSON.stringify(queue([
      task({
        id: 'task-dirty-worker-timeout',
        status: 'review',
        assignedTo: 'reviewer-agent',
        blockReason: undefined,
        notes: [],
      }),
    ]), null, 2))
    await upsertTaskRuntimeState(projectRoot, 'task-dirty-worker-timeout', {
      assignedTo: 'worker-agent',
      openEscalationIds: [],
      updatedAt: '2026-05-23T12:00:00.000Z',
    })
    await appendTaskEvidence(projectRoot, 'task-dirty-worker-timeout', {
      id: 'stale-human-question',
      kind: 'note',
      recordedAt: '2026-05-23T12:00:00.000Z',
      payload: {
        agentId: 'coordinator',
        role: 'policy-classification',
        timestamp: '2026-05-23T12:00:00.000Z',
        content: JSON.stringify({
          class: 'model_tool_use_failure',
          needsHuman: true,
          humanQuestion: 'Should Guildhall retry from the partial diff, narrow the task, or switch provider?',
          evidence: [{ summary: 'Worker repeatedly hit its turn budget after saving partial work.' }],
        }),
      },
    })

    const result = await repairStaleBlockersForProjectWithRuntime(projectRoot)
    const runtime = await readTaskRuntimeStore(projectRoot)
    const notes = await readTaskEvidence(projectRoot, 'task-dirty-worker-timeout', { kind: 'note' })

    expect(result.changed).toBe(false)
    expect(runtime.tasks['task-dirty-worker-timeout']?.assignedTo).toBe('reviewer-agent')
    expect(notes.at(-1)?.payload).toMatchObject({
      agentId: 'system',
      role: 'state-repair',
      content: expect.stringContaining('review the saved partial diff instead of asking the owner'),
    })

    rmSync(projectRoot, { recursive: true, force: true })
  })

  it('returns promoted skipped landing work to review when its current review evidence is missing approval', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'guildhall-stale-promoted-landing-review-'))
    const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
    try {
      writeProjectStateDatabaseSnapshot(tasksPath, {
        queue: queue([
          task({
            id: 'task-promoted-landing-review',
            acceptanceCriteria: [{
              id: 'ac-review',
              description: 'A reviewer approves the saved implementation.',
              verifiedBy: 'review',
              met: true,
            }],
            proofPaths: [{
              id: 'task-promoted-landing-review-review-proof',
              kind: 'review',
              expectedEvidence: [{ id: 'ac-review', kind: 'manual', required: true }],
            }],
          }),
        ]),
        summary: { generatedAt: '2026-08-30T14:00:00.000Z', freshness: 'current' },
        projectRoot,
      })
      promoteProjectStateDatabaseAuthority(projectRoot)
      await appendTaskEvidence(projectRoot, 'task-promoted-landing-review', {
        id: 'merge-skipped',
        kind: 'merge_record',
        recordedAt: '2026-08-30T14:32:16.611Z',
        payload: {
          fromBranch: 'guildhall/task-promoted-landing-review',
          toBranch: 'main',
          strategy: 'cherry_pick_local',
          result: 'skipped',
          mergedAt: '2026-08-30T14:32:16.611Z',
        },
      })

      const result = await repairStaleBlockersForProjectWithRuntime(projectRoot)
      const current = await readProjectTaskQueueForRichMutation(projectRoot) as { tasks: Task[] }

      expect(result.repairs).toEqual([{
        taskId: 'task-promoted-landing-review',
        previousStatus: 'blocked',
        nextStatus: 'review',
        reason: 'missing_review_after_skipped_landing',
      }])
      expect(current.tasks[0]).toMatchObject({ status: 'review', assignedTo: 'reviewer-agent' })
    } finally {
      rmSync(projectRoot, { recursive: true, force: true })
    }
  })

  it('returns reopened completion after skipped landing to review despite historical approval', () => {
    const q = queue([
      task({
        id: 'task-reopened-review',
        acceptanceCriteria: [{
          id: 'ac-review',
          description: 'A reviewer approves the saved implementation.',
          verifiedBy: 'review',
          met: true,
        }],
        reviewVerdicts: [{
          verdict: 'approve',
          acceptedCriteriaIds: ['ac-review'],
          reviewerPath: 'deterministic',
          reason: 'Historical approval.',
          failingSignals: [],
          recordedAt: '2026-08-30T14:32:08.754Z',
        }],
        mergeRecord: {
          fromBranch: 'guildhall/task-reopened-review',
          toBranch: 'main',
          strategy: 'cherry_pick_local',
          result: 'skipped',
          mergedAt: '2026-08-30T14:32:16.611Z',
        },
        doneSummaryBundle: { status: 'reopened' } as Task['doneSummaryBundle'],
      }),
    ])

    const result = repairStaleBlockersInQueue(q, '2026-08-30T15:00:00.000Z')

    expect(result.repairs).toContainEqual(expect.objectContaining({
      taskId: 'task-reopened-review',
      reason: 'missing_review_after_skipped_landing',
    }))
    expect(q.tasks[0]).toMatchObject({ status: 'review', assignedTo: 'reviewer-agent' })
  })

  it('keeps repaired research-spike tasks in shaping even when stale spec text exists', () => {
    const q = queue([
      task({
        id: 'task-hollow-contract',
        spec: [
          '## What this is',
          'Repair the imported handoff.',
          '',
          '## Acceptance criteria',
          '1. The task names the concrete contract surface recovered from cited sources.',
        ].join('\n'),
        acceptanceCriteria: [{
          id: 'ac-1',
          description: 'The task names the concrete contract surface recovered from cited sources.',
          verifiedBy: 'review',
          met: false,
        }],
        taskReadiness: {
          taskKind: 'research',
          recommendation: 'needs_research_spike',
          summary: 'This task needs concrete contract names before Guildhall can hand it to a worker.',
          dimensions: [],
          definitionOfDone: {
            items: ['The concrete contract surface is named.'],
            evidenceRequired: ['Source-backed contract/type names are present.'],
            updatedAt: '2026-05-23T00:00:00.000Z',
            createdBy: 'test',
          },
          blockerPlans: [],
          contextBudget: {
            estimatedTokens: 1000,
            risk: 'medium',
            fitsInOneWorkerBrief: true,
            reasons: ['The task needs source repair before implementation context matters.'],
          },
          assessedAt: '2026-05-23T00:00:00.000Z',
          assessedBy: 'test',
        },
        blockReason: 'human_judgment_required: Spec author stopped after hitting its turn limit.',
        escalations: [{
          id: 'esc-hollow-contract',
          taskId: 'task-hollow-contract',
          agentId: 'spec-agent',
          reason: 'human_judgment_required',
          recoveryCode: 'spec_no_progress',
          summary: 'The planning lane needs another durable pass.',
          raisedAt: '2026-05-23T00:00:00.000Z',
        }],
        notes: [
          {
            agentId: 'coordinator',
            role: 'policy-classification',
            timestamp: '2026-05-23T00:00:00.000Z',
            content: JSON.stringify({
              class: 'model_tool_use_failure',
              confidence: 'medium',
              scope: 'task',
              needsHuman: true,
              safePlaybooks: ['ask_concrete_human_question'],
              evidence: [],
              summary: 'The model failed to produce a usable tool call, so Guildhall should use a bounded repair prompt.',
            }),
          },
        ],
      }),
    ])

    const result = repairStaleBlockersInQueue(q, '2026-05-23T12:00:00.000Z')

    expect(result.repairs[0]).toMatchObject({
      taskId: 'task-hollow-contract',
      previousStatus: 'blocked',
      nextStatus: 'exploring',
    })
    expect(q.tasks[0]?.status).toBe('exploring')
    expect(q.tasks[0]?.assignedTo).toBe('spec-agent')
  })

  it('moves research-spike spec_review tasks back to shaping instead of waiting for approval', () => {
    const q = queue([
      task({
        id: 'task-hollow-contract',
        status: 'spec_review',
        spec: '## What this is\nRepair the imported handoff.\n\n## Acceptance criteria\n1. Name the concrete contract surface.',
        acceptanceCriteria: [{
          id: 'ac-1',
          description: 'Name the concrete contract surface.',
          verifiedBy: 'review',
          met: false,
        }],
        taskReadiness: {
          taskKind: 'research',
          recommendation: 'needs_research_spike',
          summary: 'This task needs concrete contract names before Guildhall can hand it to a worker.',
          dimensions: [],
          definitionOfDone: {
            items: ['The concrete contract surface is named.'],
            evidenceRequired: ['Source-backed contract/type names are present.'],
            updatedAt: '2026-05-23T00:00:00.000Z',
            createdBy: 'test',
          },
          blockerPlans: [],
          contextBudget: {
            estimatedTokens: 1000,
            risk: 'medium',
            fitsInOneWorkerBrief: true,
            reasons: ['The task needs source repair before implementation context matters.'],
          },
          assessedAt: '2026-05-23T00:00:00.000Z',
          assessedBy: 'test',
        },
      }),
    ])

    const result = repairStaleBlockersInQueue(q, '2026-05-23T12:00:00.000Z')

    expect(result.repairs).toEqual([
      {
        taskId: 'task-hollow-contract',
        previousStatus: 'spec_review',
        nextStatus: 'exploring',
        reason: 'research_spike_not_approval',
      },
    ])
    expect(q.tasks[0]?.status).toBe('exploring')
    expect(q.tasks[0]?.assignedTo).toBe('spec-agent')
  })
})

describe('repairCompletionProofCriteriaInQueue', () => {
  it('reconciles done acceptance criteria when later approving review says all criteria are met', () => {
    const q = queue([task({
        id: 'task-proof',
        status: 'done',
        acceptanceCriteria: [
          { id: 'ac1', description: 'Fixture writes an artifact.', verifiedBy: 'automated', command: 'pnpm review', met: false },
          { id: 'ac2', description: 'Reviewer taxonomy is reused.', verifiedBy: 'review', met: false },
        ],
        reviewVerdicts: [{
          verdict: 'revise',
          reviewerPath: 'llm',
          reason: 'The proof still needs revision.',
          failingSignals: [],
          recordedAt: '2026-07-04T10:07:21.557Z',
        }],
      })])
    Object.assign(q.tasks[0]!, {
      evidence: [
        {
          id: 'gate-task-proof',
          taskId: 'task-proof',
          kind: 'gate_result',
          recordedAt: '2026-07-04T10:07:20.557Z',
          payload: { command: 'pnpm review', gateId: 'pnpm review', passed: true, status: 'passed' },
        },
        {
          id: 'review-task-proof',
          taskId: 'task-proof',
          kind: 'review_verdict',
          recordedAt: '2026-07-04T10:07:21.557Z',
          payload: {
            verdict: 'approve',
            reviewerPath: 'llm',
            acceptedCriteriaIds: ['ac1', 'ac2'],
            reason: 'Reviewer approved.',
            reasoning: 'Approval explanation may use any wording.',
            failingSignals: [],
            recordedAt: '2026-07-04T10:07:21.557Z',
          },
        },
      ],
    })

    const result = repairCompletionProofCriteriaInQueue(q, '2026-07-06T18:50:00.000Z')

    expect(result).toEqual({
      changed: true,
      repairs: [{
        taskId: 'task-proof',
        reconciledCount: 2,
        reason: 'approved review recorded all acceptance criteria as met',
      }],
    })
    expect(q.tasks[0]?.acceptanceCriteria.every(criterion => criterion.met)).toBe(true)
    expect(q.tasks[0]?.notes.at(-1)?.role).toBe('evidence-repair')
  })

  it('does not reconcile done acceptance criteria without explicit all-clear review proof', () => {
    const q = queue([
      task({
        id: 'task-proof',
        status: 'done',
        acceptanceCriteria: [
          { id: 'ac1', description: 'Fixture writes an artifact.', verifiedBy: 'automated', command: 'pnpm review', met: false },
        ],
        reviewVerdicts: [{
          verdict: 'approve',
          reviewerPath: 'llm',
          acceptedCriteriaIds: ['ac1'],
          reason: 'Reviewer approved.',
          reasoning: 'Reviewed the implementation.',
          failingSignals: [],
          recordedAt: '2026-07-04T10:07:21.557Z',
        }],
      }),
    ])

    const result = repairCompletionProofCriteriaInQueue(q, '2026-07-06T18:50:00.000Z')

    expect(result.changed).toBe(false)
    expect(q.tasks[0]?.acceptanceCriteria[0]?.met).toBe(false)
  })
})

describe('repairStaleBlockersForProject', () => {
  it('fails with a migration-required error instead of repairing legacy TASKS.json after promoted SQLite failure', () => {
    const previousConfigDir = process.env.GUILDHALL_CONFIG_DIR
    const systemDir = mkdtempSync(join(tmpdir(), 'guildhall-stale-promoted-system-'))
    const projectRoot = mkdtempSync(join(tmpdir(), 'guildhall-stale-promoted-project-'))
    process.env.GUILDHALL_CONFIG_DIR = systemDir
    try {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      mkdirSync(dirname(tasksPath), { recursive: true })
      writeProjectStateDatabaseSnapshot(tasksPath, {
        queue: {
          tasks: [task({ id: 'task-database', status: 'blocked' })],
          releases: [],
        },
        summary: { generatedAt: '2026-07-15T00:00:00.000Z', freshness: 'current' },
      })
      promoteProjectStateDatabaseAuthority(projectRoot)
      const legacyQueue = queue([task({
        id: 'task-legacy',
        blockReason: 'scope_boundary: Blocked by cross-task guardrail forcing unrelated useAuth.ts file creation.',
      })])
      writeFileSync(tasksPath, `${JSON.stringify(legacyQueue, null, 2)}\n`, 'utf8')
      const before = readFileSync(tasksPath, 'utf8')

      const database = new DatabaseSync(projectStateDatabasePath(projectRoot))
      database.exec('DELETE FROM work_item_detail; DELETE FROM queue_detail WHERE id = 1')
      database.close()

      expect(() => repairStaleBlockersForProject(projectRoot)).toThrow(/project-state migration required/i)
      expect(readFileSync(tasksPath, 'utf8')).toBe(before)
    } finally {
      if (previousConfigDir === undefined) delete process.env.GUILDHALL_CONFIG_DIR
      else process.env.GUILDHALL_CONFIG_DIR = previousConfigDir
      rmSync(projectRoot, { recursive: true, force: true })
      rmSync(systemDir, { recursive: true, force: true })
    }
  })

  it('repairs system-local task state without creating project-local Guildhall state', () => {
    const previousConfigDir = process.env.GUILDHALL_CONFIG_DIR
    const systemDir = mkdtempSync(join(tmpdir(), 'guildhall-stale-system-'))
    const projectRoot = mkdtempSync(join(tmpdir(), 'guildhall-stale-project-'))
    process.env.GUILDHALL_CONFIG_DIR = systemDir
    try {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      mkdirSync(join(tasksPath, '..'), { recursive: true })
      writeFileSync(tasksPath, `${JSON.stringify(queue([
        task({
          id: 'task-stale',
          blockReason: 'scope_boundary: Blocked by cross-task guardrail forcing unrelated useAuth.ts file creation.',
          escalations: [{
            id: 'esc-1',
            taskId: 'task-stale',
            agentId: 'spec-agent',
            reason: 'scope_boundary',
            recoveryCode: 'tool_path_mismatch',
            summary: 'Blocked by cross-task guardrail forcing unrelated useAuth.ts file creation.',
            details: 'Current task is Stripe Connect, but tooling is forcing action on frontend/app/composables/useAuth.ts.',
            raisedAt: '2026-05-22T16:30:07.240Z',
          }],
        }),
      ]), null, 2)}\n`, 'utf8')

      const result = repairStaleBlockersForProject(projectRoot)

      expect(result.changed).toBe(true)
      expect(existsSync(join(projectRoot, '.guildhall'))).toBe(false)
      const raw = JSON.parse(readFileSync(tasksPath, 'utf8')) as TaskQueue
      expect(raw.tasks[0]?.status).toBe('exploring')
      expect(raw.tasks[0]).not.toHaveProperty('notes')
      expect(raw.tasks[0]).not.toHaveProperty('escalations')
      expect(raw.tasks[0]).not.toHaveProperty('openEscalations')
    } finally {
      if (previousConfigDir === undefined) delete process.env.GUILDHALL_CONFIG_DIR
      else process.env.GUILDHALL_CONFIG_DIR = previousConfigDir
      rmSync(projectRoot, { recursive: true, force: true })
      rmSync(systemDir, { recursive: true, force: true })
    }
  })

  it('persists completed proof-criteria reconciliation in system-local task state', () => {
    const previousConfigDir = process.env.GUILDHALL_CONFIG_DIR
    const systemDir = mkdtempSync(join(tmpdir(), 'guildhall-proof-system-'))
    const projectRoot = mkdtempSync(join(tmpdir(), 'guildhall-proof-project-'))
    process.env.GUILDHALL_CONFIG_DIR = systemDir
    try {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      mkdirSync(dirname(tasksPath), { recursive: true })
      writeFileSync(tasksPath, `${JSON.stringify(queue([
        task({
          id: 'task-proof',
          status: 'done',
          acceptanceCriteria: [
            { id: 'ac1', description: 'Fixture writes an artifact.', verifiedBy: 'review', met: false },
          ],
          reviewVerdicts: [{
            verdict: 'approve',
            reviewerPath: 'llm',
            acceptedCriteriaIds: ['ac1'],
            reason: 'Reviewer approved.',
            reasoning: 'Approval explanation may use any wording.',
            failingSignals: [],
            recordedAt: '2026-07-04T10:07:21.557Z',
          }],
        }),
      ]), null, 2)}\n`, 'utf8')

      const result = repairCompletionProofCriteriaForProject(projectRoot)

      expect(result.changed).toBe(true)
      const raw = JSON.parse(readFileSync(tasksPath, 'utf8')) as TaskQueue
      expect(raw.tasks[0]?.acceptanceCriteria[0]?.met).toBe(true)
      expect(raw.tasks[0]).not.toHaveProperty('notes')
    } finally {
      if (previousConfigDir === undefined) delete process.env.GUILDHALL_CONFIG_DIR
      else process.env.GUILDHALL_CONFIG_DIR = previousConfigDir
      rmSync(projectRoot, { recursive: true, force: true })
      rmSync(systemDir, { recursive: true, force: true })
    }
  })

  it('persists completed proof-criteria reconciliation from canonical database evidence', async () => {
    const previousConfigDir = process.env.GUILDHALL_CONFIG_DIR
    const systemDir = mkdtempSync(join(tmpdir(), 'guildhall-proof-sidecar-system-'))
    const projectRoot = mkdtempSync(join(tmpdir(), 'guildhall-proof-sidecar-project-'))
    process.env.GUILDHALL_CONFIG_DIR = systemDir
    try {
      const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
      mkdirSync(dirname(tasksPath), { recursive: true })
      const initialQueue = queue([
        task({
          id: 'task-proof',
          status: 'done',
          acceptanceCriteria: [
            { id: 'ac1', description: 'Fixture writes an artifact.', verifiedBy: 'review', met: false },
          ],
          reviewVerdicts: [],
        }),
      ])
      writeProjectStateDatabaseSnapshot(tasksPath, {
        queue: initialQueue,
        summary: { generatedAt: '2026-07-04T10:07:21.557Z', freshness: 'current' },
        projectRoot,
      })
      promoteProjectStateDatabaseAuthority(projectRoot)
      await appendTaskEvidence(projectRoot, 'task-proof', {
        id: 'review-task-proof-database',
        kind: 'review_verdict',
        recordedAt: '2026-07-04T10:07:21.557Z',
        payload: {
          verdict: 'approve',
          reviewerPath: 'llm',
          acceptedCriteriaIds: ['ac1'],
          reason: 'Reviewer approved.',
          reasoning: 'Approval explanation may use any wording.',
          failingSignals: [],
          recordedAt: '2026-07-04T10:07:21.557Z',
        },
      })

      const result = await repairCompletionProofCriteriaForProjectWithEvidence(projectRoot)

      expect(result.changed).toBe(true)
      const raw = readProjectTaskQueueForMutationSync(tasksPath).queue as TaskQueue
      expect((Array.isArray(raw) ? raw[0] : raw.tasks[0])?.acceptanceCriteria?.[0]?.met).toBe(true)
      expect((Array.isArray(raw) ? raw[0] : raw.tasks[0])).not.toHaveProperty('reviewVerdicts')
      expect(await readTaskEvidence(projectRoot, 'task-proof', { kind: 'review_verdict' })).toHaveLength(1)
    } finally {
      if (previousConfigDir === undefined) delete process.env.GUILDHALL_CONFIG_DIR
      else process.env.GUILDHALL_CONFIG_DIR = previousConfigDir
      rmSync(projectRoot, { recursive: true, force: true })
      rmSync(systemDir, { recursive: true, force: true })
    }
  })
})
