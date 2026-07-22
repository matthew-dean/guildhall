import { describe, it, expect } from 'vitest'
import {
  aggregateFanout,
  findRecurrentDissent,
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

  it('flags adjudication when the same persona dissents two rounds in a row', () => {
    const priorRound = [
      pv('security-engineer', 'revise', [
        'Require email verification before any posting action',
      ]),
    ]
    const currentRound = [
      pv('security-engineer', 'revise', [
        'Require email verification before any posting action',
      ]),
    ]
    const agg = aggregateFanout(currentRound, {
      policy: 'coordinator_adjudicates_on_conflict',
      priorRounds: [priorRound],
    })
    expect(agg.verdict).toBe('revise')
    expect(agg.needsAdjudication).toBe(true)
    expect(agg.adjudicationTrigger).toBe('same_persona_repeat_dissent')
  })

  it('does not flag when dissenting persona changes between rounds', () => {
    const prior = [pv('a', 'revise', ['fix x'])]
    const current = [pv('b', 'revise', ['fix y'])]
    const agg = aggregateFanout(current, {
      policy: 'coordinator_adjudicates_on_conflict',
      priorRounds: [prior],
    })
    expect(agg.needsAdjudication).toBeUndefined()
  })

  it('does not depend on whether the same persona changed its prose', () => {
    const prior = [pv('a', 'revise', ['Fix the focus ring on the primary button'])]
    const current = [pv('a', 'revise', ['Update error copy for empty-state variant'])]
    const agg = aggregateFanout(current, {
      policy: 'coordinator_adjudicates_on_conflict',
      priorRounds: [prior],
    })
    expect(agg.needsAdjudication).toBe(true)
    expect(agg.adjudicationTrigger).toBe('same_persona_repeat_dissent')
  })
})

describe('findRecurrentDissent', () => {
  it('returns empty when there are no prior rounds', () => {
    expect(
      findRecurrentDissent([pv('a', 'revise', ['fix'])], []),
    ).toEqual([])
  })

  it('identifies a persona whose dissent repeats across rounds by identity', () => {
    const prior = [pv('a', 'revise', ['verify user email before post'])]
    const current = [pv('a', 'revise', ['verify the user email before posting'])]
    expect(findRecurrentDissent(current, [prior])).toEqual(['a'])
  })

  it('still identifies the persona when its wording changes', () => {
    const prior = [pv('a', 'revise', ['fix button focus ring color'])]
    const current = [
      pv('a', 'revise', ['switch from rem to px throughout stylesheet']),
    ]
    expect(findRecurrentDissent(current, [prior])).toEqual(['a'])
  })

  it('compares against the most recent prior round only', () => {
    const r1 = [pv('a', 'revise', ['verify email before posting'])]
    const r2 = [pv('a', 'approve')] // persona briefly approved
    const current = [pv('a', 'revise', ['verify email before posting'])]
    // `a` approved in r2, breaking the chain → no adjudication flag.
    expect(findRecurrentDissent(current, [r1, r2])).toEqual([])
  })
})
