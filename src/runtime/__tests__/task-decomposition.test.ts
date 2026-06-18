import { describe, expect, it } from 'vitest'
import type { Task } from '@guildhall/core'

import {
  applyTaskShaping,
  decomposeTaskForFinishability,
  suggestCoordinatorReflection,
} from '../task-decomposition.js'

const now = '2026-05-28T12:00:00.000Z'

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: overrides.id ?? 'task-1',
    title: overrides.title ?? 'Build checkout feature',
    description: overrides.description ?? 'Build checkout.',
    domain: overrides.domain ?? 'product',
    projectPath: overrides.projectPath ?? '/repo/app',
    status: overrides.status ?? 'spec_review',
    priority: overrides.priority ?? 'normal',
    spec: overrides.spec,
    acceptanceCriteria: overrides.acceptanceCriteria ?? [],
    outOfScope: overrides.outOfScope ?? [],
    dependsOn: overrides.dependsOn ?? [],
    notes: overrides.notes ?? [],
    gateResults: overrides.gateResults ?? [],
    reviewVerdicts: overrides.reviewVerdicts ?? [],
    adjudications: overrides.adjudications ?? [],
    escalations: overrides.escalations ?? [],
    agentIssues: overrides.agentIssues ?? [],
    revisionCount: overrides.revisionCount ?? 0,
    remediationAttempts: overrides.remediationAttempts ?? 0,
    origination: overrides.origination ?? 'human',
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    ...overrides,
  }
}

describe('decomposeTaskForFinishability', () => {
  it('persists reasons and does not invent generic split children when the task lacks explicit work units', () => {
    const broadTask = task({
      title: 'Build checkout UI, API, migration, release docs, verification, and provider setup',
      description: 'Build checkout UI, API, migration, release docs, verification, provider setup, and rollback.',
      spec: 'Build checkout UI, API, migration, release docs, verification, provider setup, and rollback.',
      acceptanceCriteria: [{ id: 'AC-1', description: 'Checkout ships.', verifiedBy: 'review', met: false }],
    })

    const decomposition = decomposeTaskForFinishability(broadTask)

    expect(decomposition.action).toBe('split')
    expect(decomposition.reasons.map(reason => reason.code)).toContain('too_broad')
    expect(decomposition.reasons.map(reason => reason.code)).toContain('too_much_context')
    expect(decomposition.childDrafts).toEqual([])
  })

  it('does not invent a generic research child when research and implementation are mixed', () => {
    const mixedTask = task({
      title: 'Research and implement a better search engine',
      description: 'Compare Fuse, MiniSearch, and hosted search, then implement the best choice.',
      spec: 'Research options, decide, and implement.',
      acceptanceCriteria: [{ id: 'AC-1', description: 'Search works.', verifiedBy: 'automated', command: 'pnpm test', met: false }],
    })

    const decomposition = decomposeTaskForFinishability(mixedTask)

    expect(decomposition.action).toBe('research_first')
    expect(decomposition.reasons.map(reason => reason.code)).toContain('mixed_research_and_implementation')
    expect(decomposition.childDrafts).toEqual([])
  })

  it('stores readiness, definition of done, blocker plans, context budget, and decomposition on the task', () => {
    const target = task({
      workKind: 'implementation',
      spec: [
        '## Summary',
        'Add a checkout button.',
        '## Completion Boundary',
        '- Product outcome: Buyer can start checkout.',
        '- What Guildhall can complete in code: Button and API call.',
        '- External dependencies: None.',
        '- Owner-only setup: None.',
        '- Verification environment: local browser.',
        '- What counts as done: Browser proof shows checkout opens.',
        '- What must be split or blocked: None.',
      ].join('\n'),
      acceptanceCriteria: [{ id: 'AC-1', description: 'Checkout opens.', verifiedBy: 'review', met: false }],
      proofPaths: [{ id: 'checkout-proof' }],
    })

    const result = applyTaskShaping(target, { now })

    expect(result.taskReadiness?.recommendation).toBe('ready')
    expect(result.definitionOfDone?.items).toContain('Browser proof shows checkout opens.')
    expect(result.blockerPlans?.length).toBeGreaterThan(0)
    expect(result.contextBudget?.fitsInOneWorkerBrief).toBe(true)
    expect(result.decomposition?.action).toBe('keep')
    expect(result.notes.at(-1)?.content).toContain('Task readiness action: ready')
  })

  it('does not draft split children for one bounded deliverable with multiple proof bullets', () => {
    const target = task({
      title: 'policy note patch',
      description: 'Append one sentence to STATUS_NOTE.md and do not edit any other file.',
      spec: [
        '## Summary',
        'Append one sentence to STATUS_NOTE.md.',
        '## Acceptance Criteria',
        '1. STATUS_NOTE.md contains the requested sentence.',
        '2. Existing content remains unchanged.',
        '3. No other files change.',
        '## Completion Boundary',
        '- Product outcome: STATUS_NOTE.md contains the requested sentence.',
        '- What Guildhall can complete in code: Append one sentence to STATUS_NOTE.md.',
        '- External dependencies: None.',
        '- Owner-only setup: None.',
        '- Verification environment: Local filesystem.',
        '- What counts as done:',
        '  1. grep exits 0 for the sentence.',
        '  2. git diff shows only STATUS_NOTE.md changed.',
        '  3. Original lines remain untouched.',
        '- What must be split or blocked: Nothing.',
      ].join('\n'),
      acceptanceCriteria: [
        { id: 'AC-1', description: 'STATUS_NOTE.md contains the requested sentence.', verifiedBy: 'automated', met: false },
        { id: 'AC-2', description: 'Existing content remains unchanged.', verifiedBy: 'automated', met: false },
        { id: 'AC-3', description: 'No other files change.', verifiedBy: 'automated', met: false },
      ],
      sizePlan: {
        taskId: 'task-1',
        score: 1,
        band: 'tiny',
        action: 'proceed',
        factors: [],
        recommendedChildren: [],
        reviewBudgetHint: 'lean',
        reasons: ['One bounded deliverable.'],
        createdAt: now,
        createdBy: 'test',
      },
    })

    const decomposition = decomposeTaskForFinishability(target)

    expect(decomposition.action).toBe('keep')
    expect(decomposition.childDrafts).toEqual([])
  })

  it('reuses semantic work-unit analysis when explicit split structure exists', () => {
    const target = task({
      title: 'Build fixture harness and review loop',
      description: 'Implement the Stage 1 harness slice.',
      workUnitAnalysis: {
        summary: 'Three independently shippable work units.',
        units: [
          {
            id: 'schemas',
            title: 'Define fixture and evaluation schemas',
            deliverable: 'Fixture and evaluation schemas exist.',
            rationale: 'Schemas unblock every later harness proof.',
            suggestedDomain: 'harness',
            dependsOn: [],
          },
          {
            id: 'runner',
            title: 'Implement the no-UI packet runner',
            deliverable: 'A script-only runner builds packets from fixture records.',
            rationale: 'The runner is the first executable proof surface.',
            suggestedDomain: 'harness',
            dependsOn: ['schemas'],
          },
          {
            id: 'report',
            title: 'Generate debug reports for each run',
            deliverable: 'Each run writes a developer-readable debug report.',
            rationale: 'Debug reports prove why packet context was included or dropped.',
            suggestedDomain: 'harness',
            dependsOn: ['runner'],
          },
        ],
        proofOnlyItems: [],
        createdAt: now,
        createdBy: 'test',
      },
      sizePlan: {
        taskId: 'task-1',
        score: 8,
        band: 'epic',
        action: 'decompose_before_execution',
        factors: [],
        recommendedChildren: [],
        reviewBudgetHint: 'balanced',
        reasons: ['Multiple independently verifiable work units.'],
        createdAt: now,
        createdBy: 'test',
      },
      acceptanceCriteria: [{ id: 'AC-1', description: 'Stage 1 harness is runnable.', verifiedBy: 'review', met: false }],
    })

    const decomposition = decomposeTaskForFinishability(target)

    expect(decomposition.action).toBe('split')
    expect(decomposition.childDrafts.map(child => child.title)).toEqual([
      'Define fixture and evaluation schemas',
      'Implement the no-UI packet runner',
      'Generate debug reports for each run',
    ])
    expect(decomposition.childDrafts[1]).toMatchObject({
      dependsOn: ['schemas'],
      kind: 'implementation',
    })
  })
})

describe('suggestCoordinatorReflection', () => {
  it('suggests but does not activate practice or preference candidates', () => {
    const tasks = [
      task({ id: 'a', title: 'Huge task A', status: 'blocked', sizePlan: { taskId: 'a', score: 8, band: 'epic', action: 'split_required', factors: [], recommendedChildren: [], reasons: ['too large'], reviewBudgetHint: 'release_critical', createdAt: now, createdBy: 'test' } }),
      task({ id: 'b', title: 'Huge task B', status: 'blocked', sizePlan: { taskId: 'b', score: 8, band: 'large', action: 'split_recommended', factors: [], recommendedChildren: [], reasons: ['too large'], reviewBudgetHint: 'balanced', createdAt: now, createdBy: 'test' } }),
      task({ id: 'c', title: 'Question task', status: 'exploring', openQuestions: [{ id: 'q1', kind: 'text', prompt: 'Which product behavior?', askedBy: 'coordinator', askedAt: now }] }),
    ]

    const reflection = suggestCoordinatorReflection(tasks, { now })

    expect(reflection.candidates.length).toBeGreaterThanOrEqual(2)
    expect(reflection.candidates.every(candidate => candidate.status === 'proposed')).toBe(true)
    expect(reflection.summary).toContain('suggested')
  })
})
