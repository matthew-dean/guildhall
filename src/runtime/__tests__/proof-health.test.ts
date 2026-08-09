import { describe, expect, it } from 'vitest'

import {
  completionProofCanSettleUnmetAcceptanceCriteria,
  hasActiveProofRecovery,
  normalizeAcceptanceCriteriaForCurrentProof,
  reconcileAcceptanceCriteriaFromApprovedReview,
  reviewAcceptanceCriteriaMissingApprovalIds,
  reviewProofMissingApprovalIds,
  reviewVerdictLooksNonSubstantive,
  taskHasScriptProofPath,
  taskDoneButReviewConflict,
  taskDoneButProofMissing,
  taskDoneButProofMissingForScope,
} from '../proof-health.js'
import {
  ensureCommandProofPathsFromAcceptanceCriteria,
  isConcreteProjectProofCommand,
  recordCommandProofPathResults,
} from '../proof-paths.js'

function reviewedTask(criterion: Record<string, unknown>) {
  return {
    id: 'task-live-proof',
    title: 'Prove the live drafting model',
    status: 'done',
    acceptanceCriteria: [criterion],
    reviewVerdicts: [{
      verdict: 'approved',
      reviewerPath: 'llm',
      reason: 'Approved',
      reasoning: 'acceptance-criteria-met: yes — all acceptance criteria are satisfied.',
      recordedAt: '2026-07-13T22:00:00.000Z',
      acceptedCriteriaIds: [criterion.id],
    }],
  }
}

describe('proof health', () => {
  it('requires an exact approving review ID for every review-owned criterion', () => {
    const task = {
      status: 'gate_check',
      acceptanceCriteria: [
        { id: 'ac-command', verifiedBy: 'automated', command: 'pnpm test', met: true },
        { id: 'ac-visual', verifiedBy: 'review', met: true },
      ],
      reviewVerdicts: [{
        verdict: 'approve',
        acceptedCriteriaIds: ['ac-other'],
        recordedAt: '2026-08-09T10:00:00.000Z',
      }],
    }

    expect(reviewAcceptanceCriteriaMissingApprovalIds(task)).toEqual(['ac-visual'])
  })

  it('uses an exact criterion approval for a review path projected from that same criterion', () => {
    const task = {
      proofPaths: [{
        id: 'visual-review-path',
        kind: 'review',
        expectedEvidence: [{ id: 'ac-visual', required: true }],
      }],
      reviewVerdicts: [{
        verdict: 'approve',
        acceptedCriteriaIds: ['ac-visual'],
        proofEvidenceIds: [],
        recordedAt: '2026-08-09T10:00:00.000Z',
      }],
    }

    expect(reviewProofMissingApprovalIds(task)).toEqual([])
  })

  it('still requires explicit proof approval when a review path uses a distinct evidence ID', () => {
    const task = {
      proofPaths: [{
        id: 'visual-review-path',
        kind: 'review',
        expectedEvidence: [{ id: 'visual-screenshot-proof', required: true }],
      }],
      reviewVerdicts: [{
        verdict: 'approve',
        acceptedCriteriaIds: ['ac-visual'],
        proofEvidenceIds: [],
        recordedAt: '2026-08-09T10:00:00.000Z',
      }],
    }

    expect(reviewProofMissingApprovalIds(task)).toEqual(['visual-screenshot-proof'])
  })

  it('classifies target findings without typed worker instructions as non-substantive', () => {
    expect(reviewVerdictLooksNonSubstantive({
      verdict: 'revise',
      findings: [{
        targetKind: 'acceptance_criterion',
        targetId: 'ac-visual',
        disposition: 'unsatisfied',
        evidenceRefs: [],
      }],
    })).toBe(true)
    expect(reviewVerdictLooksNonSubstantive({
      verdict: 'revise',
      findings: [{
        targetKind: 'acceptance_criterion',
        targetId: 'ac-visual',
        disposition: 'unsatisfied',
        evidenceRefs: ['screenshot:wide'],
        workerInstruction: 'Increase the review heading contrast to meet the recorded token threshold.',
      }],
    })).toBe(false)
  })

  it('reconciles only review-owned criteria named by the latest approval', () => {
    const task = {
      id: 'task-review-authority',
      title: 'Review the packaged UI',
      status: 'gate_check',
      acceptanceCriteria: [
        { id: 'ac-command', description: 'Tests pass.', verifiedBy: 'automated', command: 'pnpm test', met: false },
        { id: 'ac-visual', description: 'The packaged UI is readable.', verifiedBy: 'review', met: false },
      ],
      reviewVerdicts: [],
      notes: [],
    } as unknown as import('@guildhall/core').Task
    const authority = {
      ...task,
      reviewVerdicts: [{
        verdict: 'approve',
        acceptedCriteriaIds: ['ac-visual', 'ac-command'],
        recordedAt: '2026-08-09T10:00:00.000Z',
      }],
    }

    expect(reconcileAcceptanceCriteriaFromApprovedReview(task, authority)).toBe(1)
    expect(task.acceptanceCriteria).toEqual([
      expect.objectContaining({ id: 'ac-command', met: false }),
      expect.objectContaining({ id: 'ac-visual', met: true }),
    ])
  })

  it('uses the shared current-proof rule for acceptance-linked command paths', () => {
    const task = {
      status: 'done',
      acceptanceCriteria: [{ id: 'AC-1', met: true }],
      proofPaths: [{
        kind: 'command',
        title: 'Run AC-1',
        command: 'pnpm test -- current',
        expectedEvidence: [{ id: 'evidence-1', required: true }],
        verificationRecords: [],
      }],
      gateResults: [{ gateId: 'AC-1', command: 'pnpm test -- current', type: 'hard', passed: true }],
    }

    expect(taskDoneButProofMissing(task)).toBe(false)
  })

  it('treats compact proof-setup rows as unproven instead of crashing', () => {
    const compactTask = {
      id: 'task-proof-setup',
      semanticKind: 'proof_setup',
      status: 'done',
      hierarchy: { parentId: 'task-parent' },
      proofPaths: [],
    }

    expect(taskDoneButProofMissing(compactTask)).toBe(true)
  })

  it('materializes one command expectation per explicit acceptance command without storing results on the path', () => {
    const task = {
      id: 'task-command-proof',
      title: 'Run the focused proof',
      acceptanceCriteria: [{
        id: 'AC-1',
        description: 'The focused proof passes.',
        verifiedBy: 'automated',
        command: 'pnpm test',
        met: false,
      }],
      proofPaths: [{
        id: 'existing-review-path',
        kind: 'review',
        title: 'Review the result',
        summary: 'Review evidence.',
      }],
    } as any

    task.proofPaths = ensureCommandProofPathsFromAcceptanceCriteria(task, '2026-07-18T04:00:00.000Z')
    expect(task.proofPaths).toHaveLength(2)
    expect(task.proofPaths?.[1]).toMatchObject({
      kind: 'command',
      command: 'pnpm test',
      source: 'documented',
      status: 'planned',
      expectedEvidence: [{ id: 'AC-1', kind: 'automated' }],
    })

    recordCommandProofPathResults(task, [{ id: 'AC-1', command: 'pnpm test' }], [{
      gateId: 'AC-1',
      type: 'hard',
      passed: true,
      checkedAt: '2026-07-18T04:01:00.000Z',
    }], 'acceptance-command-gates')
    expect(task.proofPaths?.[1]).toMatchObject({
      status: 'planned',
      verificationRecords: [],
    })

    task.status = 'done'
    task.gateResults = [{
      gateId: 'AC-1',
      type: 'hard',
      passed: true,
      checkedAt: '2026-07-18T04:01:00.000Z',
    }]
    expect(taskDoneButProofMissing(task)).toBe(false)
  })

  it('treats a completed task without a runnable path as incomplete in a script-only release', () => {
    const task = {
      id: 'task-script-proof',
      title: 'Run the script proof',
      status: 'done',
    }

    expect(taskDoneButProofMissingForScope(task, 'script_only')).toBe(true)
    expect(taskDoneButProofMissingForScope(task, 'manual')).toBe(false)
  })

  it('does not call an inferred blocked-until-setup path executable', () => {
    const task = {
      status: 'done',
      proofPaths: [{
        kind: 'command',
        source: 'inferred',
        launchSteps: [{
          kind: 'blocked_until_setup',
          setupRequirement: 'Name the command first.',
        }],
      }],
    }

    expect(taskHasScriptProofPath(task)).toBe(false)
  })

  it('never lets a proof-setup checkbox settle missing command evidence', () => {
    const task = {
      id: 'task-proof-setup',
      title: 'Establish concrete proof',
      semanticKind: 'proof_setup',
      status: 'done',
      hierarchy: { parentId: 'task-parent' },
      acceptanceCriteria: [{ id: 'ac-1', met: true }],
    }

    expect(taskDoneButProofMissing(task)).toBe(true)
  })

  it('keeps proof-setup completion tied to the exact command identity', () => {
    const task = {
      id: 'task-proof-setup',
      title: 'Establish concrete proof',
      semanticKind: 'proof_setup',
      status: 'done',
      hierarchy: { parentId: 'task-parent' },
      acceptanceCriteria: [{
        id: 'ac-1',
        command: 'pnpm run proof:task-parent',
        expectedOutputIncludes: ['guildhall-proof:task-parent'],
        met: true,
      }],
      proofPaths: [{
        kind: 'command',
        source: 'documented',
        command: 'pnpm run proof:task-parent',
        expectedEvidence: [{ id: 'ac-1', required: true }],
        verificationRecords: [{
          evidenceId: 'ac-1',
          command: 'pnpm run proof:task-parent',
          status: 'passed',
        }],
      }],
      evidence: [{
        id: 'gate-ac-1',
        taskId: 'task-proof-setup',
        kind: 'gate_result',
        recordedAt: '2026-07-18T04:00:00.000Z',
        payload: {
          gateId: 'ac-1',
          command: 'pnpm run proof:task-parent',
          passed: true,
          checkedAt: '2026-07-18T04:00:00.000Z',
        },
      }],
    }

    expect(taskDoneButProofMissing(task)).toBe(false)
    task.acceptanceCriteria[0]!.expectedOutputIncludes = ['guildhall-proof:some-other-task']
    expect(taskDoneButProofMissing(task)).toBe(true)
  })

  it('accepts a typed marker emitted by the command and a passing criterion gate without prose parsing', () => {
    const task = {
      id: 'task-proof-setup',
      title: 'Establish concrete proof',
      semanticKind: 'proof_setup',
      status: 'done',
      hierarchy: { parentId: 'task-parent' },
      acceptanceCriteria: [{
        id: 'ac-1',
        command: 'node scripts/proof.mjs && printf guildhall-proof:task-parent',
        met: false,
      }],
      proofPaths: [{
        kind: 'command',
        command: 'node scripts/proof.mjs && printf guildhall-proof:task-parent',
        expectedEvidence: [{ id: 'ac-1', required: true }],
        verificationRecords: [],
      }],
      gateResults: [{ gateId: 'ac-1', type: 'hard', passed: true }],
    }

    expect(taskDoneButProofMissing(task)).toBe(false)
  })

  it('does not treat a bare workspace convention as task-specific proof during recovery', () => {
    expect(isConcreteProjectProofCommand('pnpm test')).toBe(false)
    expect(isConcreteProjectProofCommand('pnpm proof:context')).toBe(false)
    expect(isConcreteProjectProofCommand('pnpm proof:world-object-state')).toBe(true)
    expect(isConcreteProjectProofCommand('pnpm run proof:story-records')).toBe(true)
    expect(isConcreteProjectProofCommand('pnpm test -- story-records')).toBe(true)
  })

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

  it('permits review-only criteria to settle from an approving review with criterion IDs', () => {
    const task = reviewedTask({
      id: 'review-only-proof',
      description: 'The reviewer records the user-facing decision rationale.',
      verifiedBy: 'review',
      met: false,
    })

    expect(completionProofCanSettleUnmetAcceptanceCriteria(task)).toBe(true)
    expect(taskDoneButProofMissing(task)).toBe(false)
  })

  it('does not let reviewer prose settle a review-only criterion', () => {
    const task = reviewedTask({
      id: 'review-only-prose',
      description: 'The reviewer records the user-facing decision rationale.',
      verifiedBy: 'review',
      met: false,
    })
    task.reviewVerdicts[0]!.acceptedCriteriaIds = []

    expect(completionProofCanSettleUnmetAcceptanceCriteria(task)).toBe(false)
    expect(taskDoneButProofMissing(task)).toBe(true)
  })

  it('does not let free-form completion handoff prose settle a task', () => {
    const task = {
      id: 'handoff-prose-only',
      status: 'done',
      acceptanceCriteria: [{
        id: 'proof',
        description: 'The bounded proof runs successfully.',
        verifiedBy: 'automated',
        met: false,
      }],
      completionHandoff: {
        verified: ['The proof passed and the task is complete.'],
        evidenceRefs: ['proof:claimed-by-worker'],
      },
    }

    expect(completionProofCanSettleUnmetAcceptanceCriteria(task)).toBe(false)
    expect(taskDoneButProofMissing(task)).toBe(true)
  })

  it('accepts structured completion handoff verification records', () => {
    const task = {
      id: 'handoff-structured-proof',
      status: 'done',
      completionHandoff: {
        verified: ['The prose is irrelevant.'],
        notVerified: ['A current proof record is still required.'],
        automatedProof: [{
          id: 'proof-record',
          kind: 'automated',
          status: 'passed',
          summary: 'Proof record',
          recordedAt: '2026-07-20T00:00:00.000Z',
          recordedBy: 'gate-checker-agent',
          evidenceRefs: [],
        }],
      },
    }

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

    expect((task.acceptanceCriteria as Array<Record<string, unknown>> | undefined)?.[0]).not.toHaveProperty('command')
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

  it('keeps a new command criterion unmet when the matching command gate predates its proof path', () => {
    const task = {
      id: 'task-command-proof',
      status: 'spec_review',
      acceptanceCriteria: [{
        id: 'ac-4',
        description: 'The current typecheck passes.',
        verifiedBy: 'automated',
        command: 'pnpm typecheck',
        met: false,
      }],
      proofPaths: [{
        kind: 'command',
        source: 'documented',
        command: 'pnpm typecheck',
        createdAt: '2026-08-08T21:06:42.486Z',
        updatedAt: '2026-08-08T21:06:42.486Z',
        expectedEvidence: [{ id: 'ac-4', required: true }],
        verificationRecords: [],
      }],
      gateResults: [{
        type: 'hard',
        gateId: 'ac-5',
        command: 'pnpm typecheck',
        passed: true,
        checkedAt: '2026-08-08T18:38:56.714Z',
      }],
    }

    const normalized = normalizeAcceptanceCriteriaForCurrentProof(task)
    expect(normalized.acceptanceCriteria).toMatchObject([{ met: false }])
    expect(normalized.acceptanceCriteriaProofState).toMatchObject({ state: 'blocked' })
  })

  it('does not treat gate names or output prose as command proof', () => {
    const task = {
      id: 'task-prose-proof-trap',
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
        gateId: 'unrelated-gate',
        name: 'The pnpm run validate:story proof passed',
        output: 'A reviewer said pnpm run validate:story passed, but this gate did not run it.',
        passed: true,
        checkedAt: '2026-07-14T07:38:00.000Z',
      }],
    }

    expect(completionProofCanSettleUnmetAcceptanceCriteria(task)).toBe(false)
    expect(taskDoneButProofMissing(task)).toBe(true)
  })

  it('does not let an older command gate satisfy a newer criterion without a proof path', () => {
    const task = {
      id: 'task-new-contract-old-gate',
      status: 'done',
      acceptanceCriteria: [{
        id: 'current-command-proof',
        description: 'Run the current desktop sidecar proof.',
        verifiedBy: 'automated',
        command: 'pnpm test:desktop-sidecar',
        createdAt: '2026-08-08T12:00:00.000Z',
        met: false,
      }],
      gateResults: [{
        type: 'hard',
        gateId: 'legacy-sidecar-proof',
        command: 'pnpm test:desktop-sidecar',
        passed: true,
        checkedAt: '2026-08-08T11:00:00.000Z',
      }],
    }

    expect(completionProofCanSettleUnmetAcceptanceCriteria(task)).toBe(false)
    expect(normalizeAcceptanceCriteriaForCurrentProof(task).acceptanceCriteria)
      .toMatchObject([{ met: false }])
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

  it('ignores older failed legacy gate ids after a newer documented command proof passes', () => {
    const task = {
      id: 'task-current-command-proof-pass',
      status: 'done',
      acceptanceCriteria: [{
        id: 'ac-1',
        description: 'Run the current release proof command.',
        verifiedBy: 'automated',
        command: 'pnpm proof:broad-genre-drafting-model',
        met: false,
      }],
      proofPaths: [{
        id: 'task-current-command-proof-pass-ac-1-command-proof',
        kind: 'command',
        source: 'documented',
        command: 'pnpm proof:broad-genre-drafting-model',
        expectedEvidence: [{ id: 'ac-1', required: true }],
        verificationRecords: [{
          evidenceId: 'ac-1',
          command: 'pnpm proof:broad-genre-drafting-model',
          status: 'passed',
          recordedAt: '2026-08-07T19:45:58.980Z',
        }],
      }],
      gateResults: [
        {
          type: 'hard',
          gateId: 'ac-3',
          passed: false,
          output: 'The previous broad-genre proof command failed.',
          checkedAt: '2026-07-18T16:10:33.292Z',
        },
        {
          type: 'hard',
          gateId: 'broad-genre-drafting-model-proof',
          command: 'pnpm proof:broad-genre-drafting-model',
          passed: true,
          checkedAt: '2026-08-07T19:45:58.980Z',
        },
      ],
    }

    const normalized = normalizeAcceptanceCriteriaForCurrentProof(task)
    expect(normalized.acceptanceCriteria).toMatchObject([{ met: true, verificationState: 'verified' }])
    expect(completionProofCanSettleUnmetAcceptanceCriteria(task)).toBe(true)
    expect(taskDoneButProofMissing(normalized)).toBe(false)
  })

  it('clears stale criterion state when the current gate pass is authoritative', () => {
    const normalized = normalizeAcceptanceCriteriaForCurrentProof({
      id: 'task-clears-stale-proof',
      status: 'done',
      acceptanceCriteria: [{
        id: 'command-proof',
        description: 'Run the bounded proof command.',
        verifiedBy: 'automated',
        command: 'pnpm run validate:story',
        met: true,
        persistedMet: true,
        verificationState: 'stale',
        staleReason: 'The previous proof run failed.',
        staleGateId: 'command-proof',
      }],
      acceptanceCriteriaProofState: {
        state: 'blocked',
        reason: 'The previous proof run failed.',
        gateId: 'command-proof',
        checkedAt: '2026-07-14T07:38:00.000Z',
        staleMetCount: 1,
      },
      proofPaths: [{
        kind: 'command',
        source: 'documented',
        command: 'pnpm run validate:story',
      }],
      gateResults: [{
        type: 'hard',
        gateId: 'command-proof',
        command: 'pnpm run validate:story',
        passed: true,
        checkedAt: '2026-07-14T07:39:00.000Z',
      }],
    })

    expect(normalized.acceptanceCriteria).toEqual([expect.objectContaining({
      met: true,
      verificationState: 'verified',
    })])
    const firstCriterion = (normalized.acceptanceCriteria as Array<Record<string, unknown>> | undefined)?.[0]
    expect(firstCriterion).not.toHaveProperty('persistedMet')
    expect(firstCriterion).not.toHaveProperty('staleReason')
    expect(firstCriterion).not.toHaveProperty('staleGateId')
    expect(normalized.acceptanceCriteriaProofState).toEqual({ state: 'verified' })
  })

  it('clears stale diagnostics even when persisted state already says verified', () => {
    const normalized = normalizeAcceptanceCriteriaForCurrentProof({
      id: 'task-clears-verified-diagnostics',
      status: 'done',
      acceptanceCriteria: [{
        id: 'command-proof',
        description: 'Run the bounded proof command.',
        verifiedBy: 'automated',
        command: 'pnpm run validate:story',
        met: true,
        verificationState: 'verified',
      }],
      acceptanceCriteriaProofState: {
        state: 'verified',
        reason: 'Current typed proof was missing; historical completion evidence cannot settle the active lifecycle.',
        gateId: 'command-proof',
        checkedAt: '2026-07-14T07:38:00.000Z',
        staleMetCount: 0,
      },
      proofPaths: [{
        kind: 'command',
        source: 'documented',
        command: 'pnpm run validate:story',
      }],
      gateResults: [{
        type: 'hard',
        gateId: 'command-proof',
        command: 'pnpm run validate:story',
        passed: true,
        checkedAt: '2026-07-14T07:39:00.000Z',
      }],
    })

    expect(normalized.acceptanceCriteriaProofState).toEqual({ state: 'verified' })
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

  it('retires proof recovery from the stable evidence id when the gate omits command prose', () => {
    const task = {
      id: 'task-recovered-proof-by-id',
      status: 'done',
      proofRecovery: {
        reopenedAt: '2026-07-14T06:04:21.094Z',
        reason: 'Missing release proof evidence.',
      },
      proofPaths: [{
        kind: 'command',
        source: 'documented',
        command: 'pnpm run validate:story',
        expectedEvidence: [{ id: 'ac-1', required: true }],
      }],
      gateResults: [{
        type: 'hard',
        gateId: 'ac-1',
        passed: true,
        output: 'Provider chose an arbitrary successful explanation.',
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

  it('keeps recovery active when an unrelated proof path passes', () => {
    const task = {
      status: 'spec_review',
      runtime: {
        proofRecovery: {
          reopenedAt: '2026-07-18T10:00:00.000Z',
        },
      },
      proofPaths: [
        {
          kind: 'review',
          status: 'verified',
          expectedEvidence: [{ id: 'review', required: true }],
          verificationRecords: [{
            evidenceId: 'review',
            status: 'passed',
            recordedAt: '2026-07-18T11:00:00.000Z',
          }],
        },
        {
          kind: 'command',
          source: 'documented',
          command: 'pnpm run proof:release',
          expectedEvidence: [{ id: 'release', required: true }],
          verificationRecords: [],
        },
      ],
    }

    expect(hasActiveProofRecovery(task)).toBe(true)
  })

  it('prefers a newer normalized recovery marker over a stale task-shaped copy', () => {
    const task = {
      proofRecovery: {
        reopenedAt: '2026-07-18T10:00:00.000Z',
        reason: 'stale recovery',
      },
      runtime: {
        proofRecovery: {
          reopenedAt: '2026-07-18T12:00:00.000Z',
          reason: 'current recovery',
        },
      },
      proofPaths: [{
        kind: 'command',
        source: 'documented',
        command: 'pnpm run proof:release',
        expectedEvidence: [{ id: 'release', required: true }],
        verificationRecords: [{
          evidenceId: 'release',
          status: 'passed',
          recordedAt: '2026-07-18T11:00:00.000Z',
        }],
      }],
    }

    expect(hasActiveProofRecovery(task)).toBe(true)
  })

  it('treats a timeout fallback after substantive review feedback as an incomplete done task', () => {
    const task = {
      status: 'done',
      reviewVerdicts: [
        {
          verdict: 'approve',
          reviewerPath: 'deterministic',
          reasoning: 'Acceptance criteria are met.',
          llmError: 'reviewer-agent timed out after 60000ms of inactivity',
          recordedAt: '2026-07-18T04:28:59.233Z',
        },
        {
          verdict: 'revise',
          reviewerPath: 'llm',
          reasoning: 'The implementation has a syntax error and emits findings with an empty character.',
          recordedAt: '2026-07-18T04:20:54.206Z',
        },
        {
          verdict: 'approve',
          reviewerPath: 'llm',
          reasoning: 'The initial pass was clear.',
          recordedAt: '2026-07-18T04:17:58.507Z',
        },
      ],
    }

    expect(taskDoneButReviewConflict(task)).toBe(true)
  })
})
