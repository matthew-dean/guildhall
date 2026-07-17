import { describe, expect, it } from 'vitest'

import {
  completionProofCanSettleUnmetAcceptanceCriteria,
  hasActiveProofRecovery,
  normalizeAcceptanceCriteriaForCurrentProof,
  taskDoneButProofMissing,
} from '../proof-health.js'

function reviewedTask(criterion: Record<string, unknown>) {
  return {
    id: 'task-live-proof',
    title: 'Prove the live drafting model',
    status: 'done',
    acceptanceCriteria: [criterion],
    reviewVerdicts: [{
      verdict: 'approved',
      reasoning: 'acceptance-criteria-met: yes — all acceptance criteria are satisfied.',
      recordedAt: '2026-07-13T22:00:00.000Z',
    }],
  }
}

describe('proof health', () => {
  it('does not let review narration settle a command-backed criterion', () => {
    const task = reviewedTask({
      id: 'live-provider-proof',
      description: 'Run the DeepInfra model proof command and record the output.',
      verifiedBy: 'automated',
      met: false,
    })

    expect(completionProofCanSettleUnmetAcceptanceCriteria(task)).toBe(false)
    expect(taskDoneButProofMissing(task)).toBe(true)
  })

  it('still permits review-only criteria to settle from an approving review', () => {
    const task = reviewedTask({
      id: 'review-only-proof',
      description: 'The reviewer records the user-facing decision rationale.',
      verifiedBy: 'review',
      met: false,
    })

    expect(completionProofCanSettleUnmetAcceptanceCriteria(task)).toBe(true)
    expect(taskDoneButProofMissing(task)).toBe(false)
  })

  it('projects an unambiguous documented command onto an imported automated criterion', () => {
    const task = normalizeAcceptanceCriteriaForCurrentProof({
      id: 'task-imported-proof',
      acceptanceCriteria: [{
        id: 'deterministic-proof',
        description: 'Run the bounded proof.',
        verifiedBy: 'automated',
        source: 'documented',
        met: false,
      }],
      proofPaths: [{
        kind: 'command',
        source: 'documented',
        command: 'pnpm run validate:story',
      }],
    })

    expect(task.acceptanceCriteria).toMatchObject([{
      id: 'deterministic-proof',
      command: 'pnpm run validate:story',
    }])
  })

  it('does not guess a criterion command when proof paths are ambiguous', () => {
    const task = normalizeAcceptanceCriteriaForCurrentProof({
      id: 'task-ambiguous-proof',
      acceptanceCriteria: [{
        id: 'deterministic-proof',
        description: 'Run the bounded proof.',
        verifiedBy: 'automated',
        source: 'documented',
        met: false,
      }],
      proofPaths: [
        { kind: 'command', source: 'documented', command: 'pnpm run validate:story' },
        { kind: 'command', source: 'documented', command: 'pnpm run build' },
      ],
    })

    expect(task.acceptanceCriteria?.[0]).not.toHaveProperty('command')
  })

  it('creates an executable criterion when a documented command path has no criterion link', () => {
    const task = normalizeAcceptanceCriteriaForCurrentProof({
      id: 'task-missing-command-criterion',
      acceptanceCriteria: [{
        id: 'schema-proof-update',
        description: 'The schema proof artifacts are updated.',
        verifiedBy: 'review',
        source: 'documented',
        met: false,
      }],
      proofPaths: [{
        kind: 'command',
        source: 'documented',
        command: 'pnpm run validate:story',
      }],
    })

    expect(task.acceptanceCriteria).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'proof-command-pnpm-run-validate-story',
        verifiedBy: 'automated',
        command: 'pnpm run validate:story',
        met: false,
      }),
    ]))
  })

  it('settles a command criterion from the matching passed gate', () => {
    const task = {
      id: 'task-command-proof',
      status: 'done',
      acceptanceCriteria: [{
        id: 'command-proof',
        description: 'Run the bounded proof command.',
        verifiedBy: 'automated',
        command: 'pnpm run validate:story',
        met: false,
      }],
      proofPaths: [{
        kind: 'command',
        source: 'documented',
        command: 'pnpm run validate:story',
      }],
      gateResults: [{
        type: 'hard',
        gateId: 'proof-command-pnpm-run-validate-story',
        command: 'pnpm run validate:story',
        passed: true,
        checkedAt: '2026-07-14T07:38:00.000Z',
      }],
    }

    const normalized = normalizeAcceptanceCriteriaForCurrentProof(task)
    expect(normalized.acceptanceCriteria).toMatchObject([{ met: true, verificationSource: 'passed-command-proof' }])
    expect(completionProofCanSettleUnmetAcceptanceCriteria(task)).toBe(true)
    expect(taskDoneButProofMissing(normalized)).toBe(false)
  })

  it('keeps command proof blocked when the current hard gate is failed', () => {
    const task = {
      id: 'task-failed-current-gate',
      status: 'done',
      acceptanceCriteria: [{
        id: 'command-proof',
        description: 'Run the bounded proof command.',
        verifiedBy: 'automated',
        command: 'pnpm run validate:story',
        met: false,
      }],
      proofPaths: [{
        kind: 'command',
        source: 'documented',
        command: 'pnpm run validate:story',
      }],
      gateResults: [
        {
          type: 'hard',
          gateId: 'proof-command-pnpm-run-validate-story',
          command: 'pnpm run validate:story',
          passed: true,
          checkedAt: '2026-07-14T07:38:00.000Z',
        },
        {
          type: 'hard',
          gateId: 'proof-command-pnpm-run-validate-story',
          command: 'pnpm run validate:story',
          passed: false,
          output: 'The current proof run failed.',
          checkedAt: '2026-07-14T07:39:00.000Z',
        },
      ],
    }

    expect(completionProofCanSettleUnmetAcceptanceCriteria(task)).toBe(false)
    expect(taskDoneButProofMissing(task)).toBe(true)
    expect(normalizeAcceptanceCriteriaForCurrentProof(task).acceptanceCriteria).toMatchObject([{ met: false }])
  })

  it('ignores an older failed hard gate when the current gate pass is retained', () => {
    const task = {
      id: 'task-current-gate-pass',
      status: 'done',
      acceptanceCriteria: [{
        id: 'command-proof',
        description: 'Run the bounded proof command.',
        verifiedBy: 'automated',
        command: 'pnpm run validate:story',
        met: false,
      }],
      proofPaths: [{
        kind: 'command',
        source: 'documented',
        command: 'pnpm run validate:story',
      }],
      gateResults: [
        {
          type: 'hard',
          gateId: 'proof-command-pnpm-run-validate-story',
          command: 'pnpm run validate:story',
          passed: true,
          checkedAt: '2026-07-14T07:39:00.000Z',
        },
        {
          type: 'hard',
          gateId: 'proof-command-pnpm-run-validate-story',
          command: 'pnpm run validate:story',
          passed: false,
          checkedAt: '2026-07-14T07:38:00.000Z',
        },
      ],
    }

    expect(completionProofCanSettleUnmetAcceptanceCriteria(task)).toBe(true)
    expect(taskDoneButProofMissing(normalizeAcceptanceCriteriaForCurrentProof(task))).toBe(false)
  })

  it('retires proof recovery after newer evidence for the documented proof path', () => {
    const task = {
      id: 'task-recovered-proof',
      status: 'done',
      proofRecovery: {
        reopenedAt: '2026-07-14T06:04:21.094Z',
        reason: 'Missing release proof evidence.',
      },
      proofPaths: [{
        kind: 'command',
        source: 'documented',
        command: 'pnpm run validate:story',
      }],
      gateResults: [{
        type: 'hard',
        gateId: 'proof-command-pnpm-run-validate-story',
        command: 'pnpm run validate:story',
        passed: true,
        checkedAt: '2026-07-14T07:38:00.000Z',
      }],
    }

    expect(hasActiveProofRecovery(task)).toBe(false)
  })

  it('keeps recovery active when only pre-recovery proof is present', () => {
    const task = {
      id: 'task-old-proof',
      status: 'done',
      proofRecovery: {
        reopenedAt: '2026-07-14T06:04:21.094Z',
        reason: 'Missing release proof evidence.',
      },
      proofPaths: [{
        kind: 'command',
        source: 'documented',
        command: 'pnpm run validate:story',
      }],
      gateResults: [{
        type: 'hard',
        gateId: 'proof-command-pnpm-run-validate-story',
        command: 'pnpm run validate:story',
        passed: true,
        checkedAt: '2026-07-14T05:38:00.000Z',
      }],
    }

    expect(hasActiveProofRecovery(task)).toBe(true)
  })
})
