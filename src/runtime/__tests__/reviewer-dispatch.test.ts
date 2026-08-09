import { describe, it, expect } from 'vitest'
import type { Task, TaskQueue } from '@guildhall/core'
import {
  deterministicReview,
  applyDeterministicVerdict,
  recordLlmVerdict,
  extractLlmReviewerReasoning,
  shouldAdvanceToGateCheckPendingHardGates,
  shouldAdvanceToGateCheckPendingAutomatedVerification,
  SOFT_GATE_RUBRIC,
  DETERMINISTIC_PASS_THRESHOLD,
} from '../reviewer-dispatch.js'

// FR-27 unit tests — deterministic reviewer scoring, verdict application,
// and the LLM verdict recorder. Pure functions, no I/O.

function mkTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-001',
    title: 'Add ghost button',
    description: '',
    domain: 'looma',
    projectPath: '/p',
    status: 'review',
    priority: 'normal',
    acceptanceCriteria: [],
    outOfScope: [],
    dependsOn: [],
    notes: [],
    gateResults: [],
    reviewVerdicts: [],
    adjudications: [],
    escalations: [],
    agentIssues: [],
    revisionCount: 0,
    remediationAttempts: 0,
    origination: 'human',
    createdAt: '2026-04-21T00:00:00Z',
    updatedAt: '2026-04-21T00:00:00Z',
    ...overrides,
  }
}

describe('deterministicReview', () => {
  it('approves when all ACs met and hard gates pass', () => {
    const task = mkTask({
      acceptanceCriteria: [
        { id: 'ac-1', description: 'ghost renders', verifiedBy: 'review', met: true },
        { id: 'ac-2', description: 'build passes', verifiedBy: 'automated', met: true },
      ],
      gateResults: [
        { gateId: 'typecheck', type: 'hard', passed: true, checkedAt: 'now' },
        { gateId: 'test', type: 'hard', passed: true, checkedAt: 'now' },
      ],
    })
    const v = deterministicReview(task)
    expect(v.verdict).toBe('approve')
    expect(v.score).toBeGreaterThanOrEqual(DETERMINISTIC_PASS_THRESHOLD)
    expect(v.failingSignals).toEqual([])
  })

  it('revises when ACs are not all met (even with passing gates)', () => {
    const task = mkTask({
      acceptanceCriteria: [
        { id: 'ac-1', description: 'ghost renders', verifiedBy: 'review', met: false },
      ],
      gateResults: [
        { gateId: 'typecheck', type: 'hard', passed: true, checkedAt: 'now' },
      ],
    })
    const v = deterministicReview(task)
    expect(v.verdict).toBe('revise')
    expect(v.failingSignals).toContain('acceptance-criteria-met')
  })

  it('approves into gate_check when ACs are met and hard gates have not run yet', () => {
    const task = mkTask({
      acceptanceCriteria: [
        { id: 'ac-1', description: 'ghost renders', verifiedBy: 'review', met: true },
      ],
      gateResults: [],
    })
    const v = deterministicReview(task)
    expect(v.verdict).toBe('approve')
    expect(v.failingSignals).toEqual([])
    expect(v.reason).toContain('advance to gate_check')
    expect(v.reasoning).toContain('Special-case handoff')
  })

  it('shared pending-hard-gates helper only fires when no-regressions is the lone missing signal', () => {
    const readyForGates = mkTask({
      acceptanceCriteria: [
        { id: 'ac-1', description: 'ghost renders', verifiedBy: 'review', met: true },
      ],
      gateResults: [],
    })
    expect(shouldAdvanceToGateCheckPendingHardGates(readyForGates, ['no-regressions'])).toBe(true)

    const unmetAc = mkTask({
      acceptanceCriteria: [
        { id: 'ac-1', description: 'ghost renders', verifiedBy: 'review', met: false },
      ],
      gateResults: [],
    })
    expect(shouldAdvanceToGateCheckPendingHardGates(unmetAc, ['acceptance-criteria-met', 'no-regressions'])).toBe(false)
  })

  it('treats unmet automated gate-style acceptance criteria as pending hard verification', () => {
    const task = mkTask({
      acceptanceCriteria: [
        { id: 'ac-1', description: 'workspace page opens', verifiedBy: 'review', met: true },
        {
          id: 'ac-2',
          description: 'The documented browser proof passes.',
          verifiedBy: 'automated',
          command: 'pnpm run proof:browser',
          met: false,
        },
      ],
      gateResults: [],
    })
    expect(shouldAdvanceToGateCheckPendingAutomatedVerification(task)).toBe(true)

    const verdict = deterministicReview(task)
    expect(verdict.verdict).toBe('approve')
    expect(verdict.reason).toContain('automated hard-verification steps')
    expect(verdict.reasoning).toContain('only unmet acceptance criteria are automated hard-verification checks')
  })

  it('does not treat ordinary unmet automated work as pending hard verification', () => {
    const task = mkTask({
      acceptanceCriteria: [
        {
          id: 'ac-1',
          description: 'Search index is populated for the new document',
          verifiedBy: 'automated',
          met: false,
        },
      ],
      gateResults: [],
    })
    expect(shouldAdvanceToGateCheckPendingAutomatedVerification(task)).toBe(false)
    expect(deterministicReview(task).verdict).toBe('revise')
  })

  it('does not derive acceptance criteria from rendered spec markdown', () => {
    const task = mkTask({
      acceptanceCriteria: [],
      spec: [
        '## Summary',
        'Add ghost button.',
        '',
        '## Acceptance Criteria',
        '1. Ghost button renders.',
        '2. Build passes.',
      ].join('\n'),
      gateResults: [
        { gateId: 'typecheck', type: 'hard', passed: true, checkedAt: 'now' },
      ],
    })
    const v = deterministicReview(task)
    expect(v.failingSignals).toContain('acceptance-criteria-met')
    expect(v.reasoning).toContain('no ACs defined')
  })

  it('revises when the lint hard gate failed', () => {
    const task = mkTask({
      acceptanceCriteria: [
        { id: 'ac-1', description: 'ghost renders', verifiedBy: 'review', met: true },
      ],
      gateResults: [
        { gateId: 'typecheck', type: 'hard', passed: true, checkedAt: 'now' },
        { gateId: 'lint', type: 'hard', passed: false, checkedAt: 'now' },
      ],
    })
    const v = deterministicReview(task)
    expect(v.failingSignals).toContain('no-regressions')
    expect(v.failingSignals).toContain('conventions-followed')
    expect(v.verdict).toBe('revise')
  })

  it('ignores superseded hard-gate failures from before the current lifecycle', () => {
    const task = mkTask({
      status: 'review',
      acceptanceCriteria: [
        { id: 'ac-1', description: 'desktop spike is packaged', verifiedBy: 'review', met: true },
      ],
      gateResults: [
        {
          gateId: 'package',
          type: 'hard',
          passed: false,
          checkedAt: '2026-08-08T22:38:57.670Z',
        },
      ],
      currentLifecycle: {
        reopenedAt: '2026-08-08T22:57:00.249Z',
        status: 'exploring',
        source: 'rerun_spec',
      },
    } as Partial<Task>)

    const v = deterministicReview(task)

    expect(v.verdict).toBe('approve')
    expect(v.reasoning).toContain('no hard gates have run')
  })

  it.each([
    ['task proof recovery', { proofRecovery: { reopenedAt: '2026-08-08T22:57:00.249Z' } }],
    ['runtime proof recovery', { runtime: { proofRecovery: { reopenedAt: '2026-08-08T22:57:00.249Z' } } }],
  ])('does not credit stale hard gates after %s reopens the lifecycle', (_label, recoveryState) => {
    const task = mkTask({
      acceptanceCriteria: [
        { id: 'ac-1', description: 'desktop spike is packaged', verifiedBy: 'review', met: true },
      ],
      gateResults: [{
        gateId: 'package',
        type: 'hard',
        passed: true,
        checkedAt: '2026-08-08T22:38:57.670Z',
      }],
      ...recoveryState,
    } as Partial<Task>)

    const verdict = deterministicReview(task)

    expect(verdict.reasoning).toContain('no hard gates have run')
    expect(shouldAdvanceToGateCheckPendingHardGates(task, verdict.failingSignals)).toBe(true)
  })

  it('credits no-regressions when the only failing hard gate is scoped unrelated repo-red', () => {
    const task = mkTask({
      title: 'Clean unused restore handler binding',
      projectPath: '/repo/.guildhall/worktrees/task-016',
      acceptanceCriteria: [
        { id: 'ac-1', description: 'unused binding removed', verifiedBy: 'review', met: true },
      ],
      gateResults: [
        { gateId: 'typecheck', type: 'hard', passed: true, checkedAt: 'now' },
        { gateId: 'build', type: 'hard', passed: true, checkedAt: 'now' },
        {
          gateId: 'gate-3',
          type: 'hard',
          passed: false,
          checkedAt: 'now',
          output: [
            '> web@0.0.0 test /repo/.guildhall/worktrees/task-016/web',
            'FAIL tests/unit/components/SomeOtherThing.test.ts',
          ].join('\n'),
        },
      ],
    })

    const v = deterministicReview(task, {
      projectPath: task.projectPath,
      likelyTargetFiles: ['/repo/.guildhall/worktrees/task-016/web/server/api/pages/[id]/restore.post.ts'],
      gateScopeExceptions: [],
    })

    expect(v.verdict).toBe('approve')
    expect(v.failingSignals).toEqual([])
    expect(v.reasoning).toContain('scoped unrelated repo-red')
  })

  it('rubric weights sum to the documented total', () => {
    const total = Object.values(SOFT_GATE_RUBRIC).reduce((a, b) => a + b, 0)
    expect(total).toBeCloseTo(4.1, 5)
  })
})

describe('applyDeterministicVerdict', () => {
  const baseQueue = (): TaskQueue => ({
    version: 1,
    lastUpdated: 'x',
    tasks: [
      mkTask({
        acceptanceCriteria: [
          { id: 'ac-1', description: 'done', verifiedBy: 'review', met: true },
        ],
        gateResults: [
          { gateId: 'typecheck', type: 'hard', passed: true, checkedAt: 'now' },
        ],
      }),
    ],
  })

  it('transitions approve \u2192 gate_check and appends a verdict record', () => {
    const q = baseQueue()
    const v = deterministicReview(q.tasks[0]!)
    const result = applyDeterministicVerdict({
      queue: q,
      taskId: 'task-001',
      verdict: v,
      now: '2026-04-21T00:00:00Z',
    })
    expect(result.newStatus).toBe('gate_check')
    expect(q.tasks[0]!.status).toBe('gate_check')
    expect(q.tasks[0]!.assignedTo).toBe('gate-checker-agent')
    expect(q.tasks[0]!.reviewVerdicts).toHaveLength(1)
    expect(q.tasks[0]!.reviewVerdicts[0]!.reviewerPath).toBe('deterministic')
    expect(q.tasks[0]!.reviewVerdicts[0]!.verdict).toBe('approve')
    expect(q.tasks[0]!.reviewVerdicts[0]!.llmError).toBeUndefined()
  })

  it('transitions revise \u2192 in_progress and records failing signals', () => {
    const q: TaskQueue = {
      version: 1,
      lastUpdated: 'x',
      tasks: [
        mkTask({
          acceptanceCriteria: [
            { id: 'ac-1', description: 'done', verifiedBy: 'review', met: false },
          ],
        }),
      ],
    }
    const v = deterministicReview(q.tasks[0]!)
    const result = applyDeterministicVerdict({
      queue: q,
      taskId: 'task-001',
      verdict: v,
      now: '2026-04-21T00:00:00Z',
    })
    expect(result.newStatus).toBe('in_progress')
    expect(q.tasks[0]!.assignedTo).toBe('worker-agent')
    expect(q.tasks[0]!.reviewVerdicts[0]!.verdict).toBe('revise')
    expect(q.tasks[0]!.reviewVerdicts[0]!.failingSignals.length).toBeGreaterThan(0)
  })

  it('records llmError when provided (fallback path)', () => {
    const q = baseQueue()
    const v = deterministicReview(q.tasks[0]!)
    applyDeterministicVerdict({
      queue: q,
      taskId: 'task-001',
      verdict: v,
      now: '2026-04-21T00:00:00Z',
      llmError: 'connection refused',
    })
    expect(q.tasks[0]!.reviewVerdicts[0]!.llmError).toBe('connection refused')
  })

  it('throws when the taskId is not in the queue', () => {
    const q = baseQueue()
    const v = deterministicReview(q.tasks[0]!)
    expect(() =>
      applyDeterministicVerdict({
        queue: q,
        taskId: 'missing',
        verdict: v,
        now: 'now',
      }),
    ).toThrow(/not in queue/)
  })
})

describe('recordLlmVerdict', () => {
  const baseQueue = (): TaskQueue => ({
    version: 1,
    lastUpdated: 'x',
    tasks: [mkTask()],
  })

  it('records an invalid-contract revision when review has no machine result', () => {
    const q = baseQueue()
    const result = recordLlmVerdict({
      queue: q,
      taskId: 'task-001',
      beforeStatus: 'review',
      afterStatus: 'gate_check',
      now: 'now',
    })
    const record = result?.record
    expect(record?.verdict).toBe('revise')
    expect(record?.reviewerPath).toBe('llm')
    expect(record?.failureCode).toBe('invalid_review_contract')
    expect(result?.normalizedStatus).toBe('in_progress')
    expect(q.tasks[0]!.reviewVerdicts).toHaveLength(1)
  })

  it('appends a revise verdict on review \u2192 in_progress', () => {
    const q = baseQueue()
    const result = recordLlmVerdict({
      queue: q,
      taskId: 'task-001',
      beforeStatus: 'review',
      afterStatus: 'in_progress',
      now: 'now',
    })
    const record = result?.record
    expect(record?.verdict).toBe('revise')
    expect(result?.normalizedStatus).toBe('in_progress')
  })

  it('requires the complete machine result shape', () => {
    const q = baseQueue()
    const result = recordLlmVerdict({
      queue: q,
      taskId: 'task-001',
      beforeStatus: 'review',
      afterStatus: 'gate_check',
      now: 'now',
      reasoning: '**Verdict:** approve\n\n```json\n{"verdict":"approve"}\n```',
    })
    expect(result?.record.verdict).toBe('revise')
    expect(result?.record.failureCode).toBe('invalid_review_contract')
    expect(result?.normalizedStatus).toBe('in_progress')
  })

  it('keeps routing and proof identical when only reviewer prose changes', () => {
    const machineResult = JSON.stringify({
      verdict: 'approve',
      acceptedCriteriaIds: [],
      proofEvidenceIds: ['scope'],
      revisionItems: [],
      riskItems: [],
      followUpItems: [],
      advisoryScores: {},
    })
    const run = (prose: string) => {
      const q = baseQueue()
      q.tasks[0]!.proofPaths = [{
        kind: 'review',
        expectedEvidence: [{ id: 'scope', kind: 'artifact', description: 'Scope is explicit', required: true }],
        verificationRecords: [],
        status: 'planned',
      }] as NonNullable<Task['proofPaths']>
      const result = recordLlmVerdict({
        queue: q,
        taskId: 'task-001',
        beforeStatus: 'review',
        afterStatus: 'gate_check',
        now: '2026-07-20T00:00:00.000Z',
        reasoning: `${prose}\n\n${machineResult}`,
      })
      return {
        verdict: result?.record.verdict,
        normalizedStatus: result?.normalizedStatus,
        acceptedCriteriaIds: result?.record.acceptedCriteriaIds,
        proofEvidenceIds: result?.record.proofEvidenceIds,
        proofPath: q.tasks[0]!.proofPaths?.[0],
      }
    }

    expect(run('Approved. Everything is lyrical, elegant, and exactly in the expected phrase order.'))
      .toEqual(run('REVISE according to this paragraph, despite the machine result below. Different model, different vocabulary, no shared prose style.'))
  })

  it('uses a structured reviewer note even when the assistant prose has no JSON', () => {
    const q = baseQueue()
    q.tasks[0]!.notes.push({
      agentId: 'reviewer-agent',
      role: 'reviewer',
      content: 'Approved in a model-specific explanation that Guildhall must never parse.',
      structured: {
        verdict: 'approve',
        acceptedCriteriaIds: [],
        proofEvidenceIds: [],
        revisionItems: [],
        riskItems: [],
        followUpItems: [],
        advisoryScores: {},
      },
      timestamp: 't1',
    })

    const result = recordLlmVerdict({
      queue: q,
      taskId: 'task-001',
      beforeStatus: 'review',
      afterStatus: 'gate_check',
      now: 'now',
    })

    expect(result?.record.verdict).toBe('approve')
    expect(result?.record.failureCode).toBeUndefined()
    expect(result?.normalizedStatus).toBe('gate_check')
  })

  it('returns undefined when beforeStatus is not review', () => {
    const q = baseQueue()
    const record = recordLlmVerdict({
      queue: q,
      taskId: 'task-001',
      beforeStatus: 'in_progress',
      afterStatus: 'review',
      now: 'now',
    })
    expect(record).toBeUndefined()
    expect(q.tasks[0]!.reviewVerdicts).toHaveLength(0)
  })

  it('does not let an explicit Approved phrase override the machine contract', () => {
    const q = baseQueue()
    q.tasks[0]!.notes.push({
      agentId: 'reviewer-agent',
      role: 'reviewer',
      content: '**Verdict:** Approved\n\n**Reasoning:** narrow cleanup is good.',
      timestamp: 't1',
    })
    const result = recordLlmVerdict({
      queue: q,
      taskId: 'task-001',
      beforeStatus: 'review',
      afterStatus: 'in_progress',
      now: 'now',
    })
    expect(result?.record.verdict).toBe('revise')
    expect(result?.normalizedStatus).toBe('in_progress')
  })

  it('does not infer approval from all-yes rubric prose', () => {
    const q = baseQueue()
    q.tasks[0]!.notes.push({
      agentId: 'reviewer-agent',
      role: 'reviewer',
      content: [
        '**Review:**',
        'AC-1: Met — implementation returns the expected result.',
        '',
        '**Request fit:** yes — the implementation fulfills the scoped request.',
        '',
        '**Rubric**',
        '- acceptance-criteria-met: yes — all acceptance criteria are satisfied.',
        '- no-scope-creep: yes — changes are limited to the requested files.',
        '- conventions-followed: yes — code uses existing project style.',
        '- no-regressions: yes — build and tests pass.',
      ].join('\n'),
      timestamp: 't1',
    })

    const result = recordLlmVerdict({
      queue: q,
      taskId: 'task-001',
      beforeStatus: 'review',
      afterStatus: 'in_progress',
      now: 'now',
    })

    expect(result?.record.verdict).toBe('revise')
    expect(result?.normalizedStatus).toBe('in_progress')
  })

  it('does not infer approval from documentation prose', () => {
    const q = baseQueue()
    q.tasks[0]!.notes.push({
      agentId: 'reviewer-agent',
      role: 'reviewer',
      content: [
        '**Review:**',
        'ac-1: Met — the model selection is recorded in `docs/product/model-registry.json` and the proof artifact documents the chosen model, source-backed facts, and deferrals.',
        '',
        '**Request fit:** yes — the implementation fulfills the blueprint request.',
        '',
        '**Rubric**',
        'code-review:acceptance-criteria-met: yes — ac-1 is satisfied by the recorded model selection and proof.',
        'code-review:no-scope-creep: yes — changes are limited to documentation and registry entries.',
        'code-review:conventions-followed: yes — registry entry and markdown follow existing conventions.',
      ].join('\n'),
      timestamp: 't1',
    })

    const result = recordLlmVerdict({
      queue: q,
      taskId: 'task-001',
      beforeStatus: 'review',
      afterStatus: 'in_progress',
      now: 'now',
    })

    expect(result?.record.verdict).toBe('revise')
    expect(result?.normalizedStatus).toBe('in_progress')
  })

  it('does not infer approval from a compact handoff sentence', () => {
    const q = baseQueue()
    q.tasks[0]!.notes.push({
      agentId: 'reviewer-agent',
      role: 'reviewer',
      content: 'Task task-001 has been approved and transitioned to **gate_check** status.',
      timestamp: 't1',
    })

    const result = recordLlmVerdict({
      queue: q,
      taskId: 'task-001',
      beforeStatus: 'review',
      afterStatus: 'in_progress',
      now: 'now',
    })

    expect(result?.record.verdict).toBe('revise')
    expect(result?.normalizedStatus).toBe('in_progress')
  })

  it('records approved review evidence on the review proof path', () => {
    const q = baseQueue()
    q.tasks[0]!.proofPaths = [{
      kind: 'review',
      expectedEvidence: [
        { id: 'scope', kind: 'artifact', description: 'The scoped boundary is explicit', required: true },
      ],
      verificationRecords: [],
      status: 'planned',
    }] as NonNullable<Task['proofPaths']>
    q.tasks[0]!.notes.push({
      agentId: 'reviewer-agent',
      role: 'reviewer',
      content: '**Rubric**\n- acceptance-criteria-met: yes\n\n**Proof path:** no\n\n**Verdict:** Approved\n\n```json\n{"verdict":"approve","acceptedCriteriaIds":[],"proofEvidenceIds":["scope"]}\n```',
      timestamp: 't1',
    })

    recordLlmVerdict({
      queue: q,
      taskId: 'task-001',
      beforeStatus: 'review',
      afterStatus: 'gate_check',
      now: '2026-07-14T00:00:00.000Z',
    })

    expect(q.tasks[0]!.proofPaths?.[0]).toMatchObject({ id: 'review-proof-path', status: 'verified' })
    expect((q.tasks[0]!.proofPaths?.[0] as Record<string, any>).verificationRecords).toEqual([
      expect.objectContaining({ evidenceId: 'scope', status: 'passed', kind: 'manual' }),
    ])
  })

  it('does not materialize review proof for concise approval text', () => {
    const q = baseQueue()
    q.tasks[0]!.proofPaths = [{
      kind: 'review',
      expectedEvidence: [
        { id: 'boundary', kind: 'artifact', description: 'The scoped boundary is explicit', required: true },
        { id: 'runtime', kind: 'artifact', description: 'The runtime slice exists', required: true },
      ],
      verificationRecords: [],
      status: 'planned',
    }] as NonNullable<Task['proofPaths']>

    recordLlmVerdict({
      queue: q,
      taskId: 'task-001',
      beforeStatus: 'review',
      afterStatus: 'gate_check',
      now: '2026-07-14T00:00:00.000Z',
      reasoning: 'Approved. The acceptance criteria are met.',
    })

    expect(q.tasks[0]!.proofPaths?.[0]?.verificationRecords).toEqual([])
  })

  it('does not infer approval when the review body contains a revision phrase', () => {
    const q = baseQueue()
    q.tasks[0]!.notes.push({
      agentId: 'reviewer-agent',
      role: 'reviewer',
      content: [
        '**Review:**',
        'ac-1: Met — most of the work is present.',
        '',
        '**Request fit:** yes — the implementation is close.',
        '',
        '**Verdict:** Needs revision',
        '',
        '**Rubric**',
        'code-review:acceptance-criteria-met: yes — mostly satisfied.',
        'code-review:no-scope-creep: yes — changes are limited.',
      ].join('\n'),
      timestamp: 't1',
    })

    const result = recordLlmVerdict({
      queue: q,
      taskId: 'task-001',
      beforeStatus: 'review',
      afterStatus: 'in_progress',
      now: 'now',
    })

    expect(result?.record.verdict).toBe('revise')
    expect(result?.normalizedStatus).toBe('in_progress')
  })
})

// ---------------------------------------------------------------------------
// Reasoning is a first-class part of validation: every persisted verdict
// must carry the "why" so a coordinator auditing reviewVerdicts alone (no
// need to trawl notes) can reconstruct the decision.
// ---------------------------------------------------------------------------

describe('deterministicReview — reasoning trace', () => {
  it('includes a signal-by-signal rubric walkthrough in the reasoning field', () => {
    const task = mkTask({
      acceptanceCriteria: [
        { id: 'ac-1', description: 'x', verifiedBy: 'review', met: true },
      ],
      gateResults: [
        { gateId: 'typecheck', type: 'hard', passed: true, checkedAt: 'now' },
        { gateId: 'lint', type: 'hard', passed: true, checkedAt: 'now' },
      ],
    })
    const v = deterministicReview(task)
    expect(v.reasoning).toContain('Rubric walkthrough')
    expect(v.reasoning).toContain('acceptance-criteria-met: +1.0')
    expect(v.reasoning).toContain('no-regressions: +1.0')
    expect(v.reasoning).toContain('conventions-followed: +0.7 (lint gate passed)')
    expect(v.reasoning).toMatch(/Total: /)
    expect(v.reasoning).toContain('APPROVE')
  })

  it('documents which ACs were unmet when ACs fail', () => {
    const task = mkTask({
      acceptanceCriteria: [
        { id: 'ac-1', description: 'x', verifiedBy: 'review', met: true },
        { id: 'ac-2', description: 'y', verifiedBy: 'review', met: false },
      ],
      gateResults: [
        { gateId: 'typecheck', type: 'hard', passed: true, checkedAt: 'now' },
      ],
    })
    const v = deterministicReview(task)
    expect(v.reasoning).toContain('unmet: ac-2')
    expect(v.reasoning).toMatch(/REVISE/)
  })

  it('explains why conventions-followed was credited when no lint gate ran', () => {
    const task = mkTask({
      acceptanceCriteria: [
        { id: 'ac-1', description: 'x', verifiedBy: 'review', met: true },
      ],
      gateResults: [
        { gateId: 'typecheck', type: 'hard', passed: true, checkedAt: 'now' },
      ],
    })
    const v = deterministicReview(task)
    expect(v.reasoning).toContain('no lint gate registered — credited')
  })
})

describe('applyDeterministicVerdict — reasoning persistence', () => {
  it('carries DeterministicVerdict.reasoning through to the persisted ReviewVerdict', () => {
    const q: TaskQueue = {
      version: 1,
      lastUpdated: 'x',
      tasks: [
        mkTask({
          acceptanceCriteria: [
            { id: 'ac-1', description: 'x', verifiedBy: 'review', met: true },
          ],
          gateResults: [
            { gateId: 'typecheck', type: 'hard', passed: true, checkedAt: 'now' },
          ],
        }),
      ],
    }
    const v = deterministicReview(q.tasks[0]!)
    applyDeterministicVerdict({
      queue: q,
      taskId: 'task-001',
      verdict: v,
      now: '2026-04-21T00:00:00Z',
    })
    const record = q.tasks[0]!.reviewVerdicts[0]!
    expect(record.reasoning).toBeDefined()
    expect(record.reasoning).toContain('Rubric walkthrough')
    expect(record.reasoning).toContain('Total:')
  })
})

describe('extractLlmReviewerReasoning', () => {
  it('pulls the most recent reviewer-agent note', () => {
    const latestNote = '**Review:** criterion met\n**Verdict:** approve\n**Reasoning:** the recorded evidence is sufficient.'
    const task = mkTask({
      notes: [
        { agentId: 'worker-agent', role: 'worker', content: 'early work', timestamp: 't1' },
        {
          agentId: 'reviewer-agent',
          role: 'reviewer',
          content: latestNote,
          timestamp: 't2',
        },
      ],
    })
    const reasoning = extractLlmReviewerReasoning(task)
    expect(reasoning).toBe(latestNote)
  })

  it('prefers the last reviewer note when there are multiple passes', () => {
    const latestNote = 'The latest reviewer note uses a different vocabulary.'
    const task = mkTask({
      notes: [
        { agentId: 'reviewer-agent', role: 'reviewer', content: 'first pass — needs revision', timestamp: 't1' },
        { agentId: 'worker-agent', role: 'worker', content: 'revision', timestamp: 't2' },
        { agentId: 'reviewer-agent', role: 'reviewer', content: latestNote, timestamp: 't3' },
      ],
    })
    expect(extractLlmReviewerReasoning(task)).toBe(latestNote)
  })

  it('returns undefined when no reviewer note exists', () => {
    const task = mkTask({
      notes: [
        { agentId: 'worker-agent', role: 'worker', content: 'w', timestamp: 't' },
      ],
    })
    expect(extractLlmReviewerReasoning(task)).toBeUndefined()
  })
})

describe('recordLlmVerdict — reasoning persistence', () => {
  it('pulls reasoning from the most recent reviewer-agent note when not explicitly passed', () => {
    const latestNote = 'The reviewer supplied an arbitrary audit explanation.'
    const q: TaskQueue = {
      version: 1,
      lastUpdated: 'x',
      tasks: [
        mkTask({
          notes: [
            {
              agentId: 'reviewer-agent',
              role: 'reviewer',
              content: latestNote,
              timestamp: 't1',
            },
          ],
        }),
      ],
    }
    const record = recordLlmVerdict({
      queue: q,
      taskId: 'task-001',
      beforeStatus: 'review',
      afterStatus: 'gate_check',
      now: 'now',
    })
    expect(record?.record.reasoning).toBe(latestNote)
    expect(q.tasks[0]!.reviewVerdicts[0]!.reasoning).toBe(record?.record.reasoning)
  })

  it('explicit reasoning argument wins over note extraction', () => {
    const q: TaskQueue = {
      version: 1,
      lastUpdated: 'x',
      tasks: [
        mkTask({
          notes: [
            {
              agentId: 'reviewer-agent',
              role: 'reviewer',
              content: 'stale note content',
              timestamp: 't1',
            },
          ],
        }),
      ],
    }
    const record = recordLlmVerdict({
      queue: q,
      taskId: 'task-001',
      beforeStatus: 'review',
      afterStatus: 'gate_check',
      now: 'now',
      reasoning: 'explicit trace from structured LLM output',
    })
    expect(record?.record.reasoning).toBe('explicit trace from structured LLM output')
  })

  it('leaves reasoning undefined when the reviewer produced no note', () => {
    const q: TaskQueue = {
      version: 1,
      lastUpdated: 'x',
      tasks: [mkTask()],
    }
    const record = recordLlmVerdict({
      queue: q,
      taskId: 'task-001',
      beforeStatus: 'review',
      afterStatus: 'gate_check',
      now: 'now',
    })
    expect(record?.record.reasoning).toBeUndefined()
  })
})
