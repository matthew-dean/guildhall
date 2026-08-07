import { describe, it, expect } from 'vitest'
import {
  aggregateFanout,
  findTypedFindingConflicts,
  type PersonaVerdict,
} from '../reviewer-fanout.js'

// ---------------------------------------------------------------------------
// Policy-aware aggregateFanout + dissent detection. See
// docs/disagreement-and-handoff.md §1 for the design.
// ---------------------------------------------------------------------------

function pv(
  slug: string,
  verdict: 'approve' | 'revise',
  items: string[] = [],
): PersonaVerdict {
  return {
    guildSlug: slug,
    guildName: slug,
    verdict,
    reasoning: `${slug} ${verdict}`,
    revisionItems: items,
    ...(verdict === 'revise' && items.length > 0 ? {
      findings: [{
        targetKind: 'acceptance_criterion' as const,
        targetId: `ac-${slug}`,
        disposition: 'unsatisfied' as const,
        evidenceRefs: [],
        workerInstruction: items[0],
      }],
    } : {}),
    rawOutput: '',
  }
}

describe('aggregateFanout — strict (default)', () => {
  it('approves when every persona approves', () => {
    const agg = aggregateFanout([pv('a', 'approve'), pv('b', 'approve')])
    expect(agg.verdict).toBe('approve')
  })
  it('revises on any single dissent', () => {
    const agg = aggregateFanout([pv('a', 'approve'), pv('b', 'revise', ['x'])])
    expect(agg.verdict).toBe('revise')
    expect(agg.dissenting.map(d => d.guildSlug)).toEqual(['b'])
    expect(agg.approving.map(d => d.guildSlug)).toEqual(['a'])
  })
  it('combined feedback structures revisions by persona', () => {
    const agg = aggregateFanout([
      pv('a', 'revise', ['Fix the focus ring']),
      pv('b', 'revise', ['Bump the color for AA contrast']),
    ])
    expect(agg.combinedFeedback).toContain('From a')
    expect(agg.combinedFeedback).toContain('From b')
    expect(agg.combinedFeedback).toContain('Fix the focus ring')
    expect(agg.combinedFeedback).toContain('Bump the color')
  })
})

describe('aggregateFanout — advisory', () => {
  it('approves when any persona approves', () => {
    const agg = aggregateFanout(
      [pv('a', 'approve'), pv('b', 'revise', ['x'])],
      { policy: 'advisory' },
    )
    expect(agg.verdict).toBe('approve')
    // Dissent is still recorded as a note for the worker.
    expect(agg.dissenting.length).toBe(1)
    expect(agg.combinedFeedback).toContain('From b')
  })
  it('revises when nobody approves', () => {
    const agg = aggregateFanout([pv('a', 'revise', ['x'])], {
      policy: 'advisory',
    })
    expect(agg.verdict).toBe('revise')
  })
})

describe('aggregateFanout — majority', () => {
  it('approves when strict majority approves', () => {
    const agg = aggregateFanout(
      [pv('a', 'approve'), pv('b', 'approve'), pv('c', 'revise', ['x'])],
      { policy: 'majority' },
    )
    expect(agg.verdict).toBe('approve')
  })
  it('revises on tie (conservative)', () => {
    const agg = aggregateFanout(
      [pv('a', 'approve'), pv('b', 'revise', ['x'])],
      { policy: 'majority' },
    )
    expect(agg.verdict).toBe('revise')
  })
})

describe('aggregateFanout — coordinator_adjudicates_on_conflict', () => {
  it('does not flag adjudication on first round of dissent', () => {
    const agg = aggregateFanout([pv('a', 'revise', ['focus ring fix'])], {
      policy: 'coordinator_adjudicates_on_conflict',
      priorRounds: [],
    })
    expect(agg.verdict).toBe('revise')
    expect(agg.needsAdjudication).toBeUndefined()
  })

  it('does not treat repeated persona dissent as an adjudication conflict', () => {
    const agg = aggregateFanout([pv('security-engineer', 'revise', ['Require email verification'])], {
      policy: 'coordinator_adjudicates_on_conflict',
      priorRounds: [[pv('security-engineer', 'revise', ['Require email verification'])]],
    })
    expect(agg.verdict).toBe('revise')
    expect(agg.needsAdjudication).toBeUndefined()
  })

  it('flags incompatible findings on one target regardless of persona wording', () => {
    const satisfied = {
      targetKind: 'acceptance_criterion' as const,
      targetId: 'ac-identity',
      disposition: 'satisfied' as const,
      evidenceRefs: ['diff:src/auth.ts'],
    }
    const unsatisfied = {
      targetKind: 'acceptance_criterion' as const,
      targetId: 'ac-identity',
      disposition: 'unsatisfied' as const,
      evidenceRefs: ['diff:src/auth.ts'],
      workerInstruction: 'Inspect the email-verification completion path.',
    }
    const agg = aggregateFanout([
      { ...pv('security-engineer', 'revise', ['Different prose entirely']), findings: [unsatisfied] },
      { ...pv('copywriter', 'approve'), findings: [satisfied] },
    ], {
      policy: 'coordinator_adjudicates_on_conflict',
    })
    expect(agg.needsAdjudication).toBe(true)
    expect(agg.adjudicationTrigger).toBe('policy_conflict')
    expect(agg.conflicts).toEqual([{
      targetKind: 'acceptance_criterion',
      targetId: 'ac-identity',
      satisfiedBy: ['copywriter'],
      unsatisfiedBy: ['security-engineer'],
    }])
  })

  it('does not turn advisory findings into a conflict', () => {
    expect(findTypedFindingConflicts([
      { ...pv('a', 'approve'), findings: [{ targetKind: 'proof_evidence', targetId: 'proof-1', disposition: 'satisfied', evidenceRefs: [] }] },
      { ...pv('b', 'revise'), findings: [{ targetKind: 'proof_evidence', targetId: 'proof-1', disposition: 'advisory', evidenceRefs: [] }] },
    ])).toEqual([])
  })
})
