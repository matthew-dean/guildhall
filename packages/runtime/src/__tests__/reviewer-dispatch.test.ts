import { describe, it, expect } from 'vitest'
import type { Task, TaskQueue } from '@guildhall/core'
import {
  deterministicReview,
  applyDeterministicVerdict,
  recordLlmVerdict,
  extractLlmReviewerReasoning,
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

  it('revises when no hard gates have run (can\u2019t confirm no regressions)', () => {
    const task = mkTask({
      acceptanceCriteria: [
        { id: 'ac-1', description: 'ghost renders', verifiedBy: 'review', met: true },
      ],
      gateResults: [],
    })
    const v = deterministicReview(task)
    expect(v.failingSignals).toContain('no-regressions')
    // ACs met (1.0) + conventions (0.7, no lint gate \u2192 credit) + scope (0.8) + docs (0.6) = 3.1 / 4.1 \u2248 0.76
    expect(v.verdict).toBe('revise')
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

  it('appends an approve verdict with reviewerPath=llm on review \u2192 gate_check', () => {
    const q = baseQueue()
    const record = recordLlmVerdict({
      queue: q,
      taskId: 'task-001',
      beforeStatus: 'review',
      afterStatus: 'gate_check',
      now: 'now',
    })
    expect(record?.verdict).toBe('approve')
    expect(record?.reviewerPath).toBe('llm')
    expect(q.tasks[0]!.reviewVerdicts).toHaveLength(1)
  })

  it('appends a revise verdict on review \u2192 in_progress', () => {
    const q = baseQueue()
    const record = recordLlmVerdict({
      queue: q,
      taskId: 'task-001',
      beforeStatus: 'review',
      afterStatus: 'in_progress',
      now: 'now',
    })
    expect(record?.verdict).toBe('revise')
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
    const task = mkTask({
      notes: [
        { agentId: 'worker-agent', role: 'worker', content: 'early work', timestamp: 't1' },
        {
          agentId: 'reviewer-agent',
          role: 'reviewer',
          content: '**Review:** ac-1: Met\n**Verdict:** Approved\n**Reasoning:** AC demonstrably met by new tests at foo.test.ts:42',
          timestamp: 't2',
        },
      ],
    })
    const reasoning = extractLlmReviewerReasoning(task)
    expect(reasoning).toContain('**Verdict:** Approved')
    expect(reasoning).toContain('foo.test.ts:42')
  })

  it('prefers the last reviewer note when there are multiple passes', () => {
    const task = mkTask({
      notes: [
        { agentId: 'reviewer-agent', role: 'reviewer', content: 'first pass — needs revision', timestamp: 't1' },
        { agentId: 'worker-agent', role: 'worker', content: 'revision', timestamp: 't2' },
        { agentId: 'reviewer-agent', role: 'reviewer', content: 'second pass — approved', timestamp: 't3' },
      ],
    })
    expect(extractLlmReviewerReasoning(task)).toBe('second pass — approved')
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
    const q: TaskQueue = {
      version: 1,
      lastUpdated: 'x',
      tasks: [
        mkTask({
          notes: [
            {
              agentId: 'reviewer-agent',
              role: 'reviewer',
              content: '**Review:** ac-1: Met — ghost variant renders per criterion.\n**Verdict:** Approved\n**Reasoning:** Button.tsx:23 adds the variant; snapshot test covers it.',
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
    expect(record?.reasoning).toContain('ghost variant renders')
    expect(record?.reasoning).toContain('Button.tsx:23')
    expect(q.tasks[0]!.reviewVerdicts[0]!.reasoning).toBe(record?.reasoning)
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
    expect(record?.reasoning).toBe('explicit trace from structured LLM output')
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
    expect(record?.reasoning).toBeUndefined()
  })
})
