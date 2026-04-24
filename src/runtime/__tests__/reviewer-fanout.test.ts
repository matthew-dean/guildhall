import { describe, it, expect } from 'vitest'
import { BUILTIN_GUILDS } from '@guildhall/guilds'
import {
  parsePersonaOutput,
  aggregateFanout,
  personaVerdictToReviewRecord,
} from '../reviewer-fanout.js'

const componentDesigner = BUILTIN_GUILDS.find((g) => g.slug === 'component-designer')!
const a11y = BUILTIN_GUILDS.find((g) => g.slug === 'accessibility-specialist')!

describe('parsePersonaOutput', () => {
  it('parses a clean approve output', () => {
    const raw = `
**Rubric:**
- component-no-external-margin: yes — Button has no margin on root.
- component-token-only-values: yes — uses color.primary.

**Verdict:** approve

**Reasoning:** Ghost variant matches spec; prop API consistent with existing variants.
`
    const v = parsePersonaOutput(componentDesigner, raw)
    expect(v.verdict).toBe('approve')
    expect(v.reasoning).toContain('Ghost variant')
    expect(v.revisionItems).toEqual([])
    expect(v.guildSlug).toBe('component-designer')
  })

  it('parses a revise output with bullet revision items', () => {
    const raw = `
**Rubric:**
- a11y-contrast-ok: no — text.muted on bg.subtle only 3.8:1.
- a11y-focus-visible: yes.

**Verdict:** revise

**Reasoning:** The muted text color on the subtle surface does not meet WCAG AA. This affects the secondary label on every Card.

**If revise, what must change (your lane only):**
- Bump color.text.muted to #5c5c5c so it clears 4.5:1 on bg.subtle.
- Add a visual regression test covering Card's secondary label contrast.
`
    const v = parsePersonaOutput(a11y, raw)
    expect(v.verdict).toBe('revise')
    expect(v.revisionItems).toHaveLength(2)
    expect(v.revisionItems[0]).toContain('color.text.muted')
    expect(v.reasoning).toContain('WCAG AA')
  })

  it('accepts "Approved" as approve and "Needs revision" as revise', () => {
    const a = parsePersonaOutput(componentDesigner, '**Verdict:** approved\n**Reasoning:** fine.')
    const b = parsePersonaOutput(componentDesigner, '**Verdict:** needs revision\n**Reasoning:** nope.')
    expect(a.verdict).toBe('approve')
    expect(b.verdict).toBe('revise')
  })

  it('defaults to revise when no verdict keyword is present', () => {
    const v = parsePersonaOutput(componentDesigner, 'some rambling text without the magic word')
    expect(v.verdict).toBe('revise')
    expect(v.reasoning).toContain('no **Reasoning:** block')
  })

  it('preserves raw output for audit', () => {
    const raw = '**Verdict:** approve\n**Reasoning:** ok.'
    const v = parsePersonaOutput(componentDesigner, raw)
    expect(v.rawOutput).toBe(raw)
  })
})

describe('aggregateFanout', () => {
  it('approves when every persona approves', () => {
    const agg = aggregateFanout([
      parsePersonaOutput(componentDesigner, '**Verdict:** approve\n**Reasoning:** lgtm.'),
      parsePersonaOutput(a11y, '**Verdict:** approve\n**Reasoning:** contrast fine.'),
    ])
    expect(agg.verdict).toBe('approve')
    expect(agg.dissenting).toHaveLength(0)
    expect(agg.combinedFeedback).toBe('')
  })

  it('revises when any persona revises', () => {
    const agg = aggregateFanout([
      parsePersonaOutput(componentDesigner, '**Verdict:** approve\n**Reasoning:** fine.'),
      parsePersonaOutput(
        a11y,
        '**Verdict:** revise\n**Reasoning:** contrast fails.\n**If revise, what must change:**\n- Fix color.text.muted.',
      ),
    ])
    expect(agg.verdict).toBe('revise')
    expect(agg.dissenting).toHaveLength(1)
    expect(agg.dissenting[0]!.guildSlug).toBe('accessibility-specialist')
    expect(agg.combinedFeedback).toContain('The Accessibility Specialist')
    expect(agg.combinedFeedback).toContain('Fix color.text.muted')
  })

  it('includes every dissenter in combined feedback when multiple revise', () => {
    const agg = aggregateFanout([
      parsePersonaOutput(
        componentDesigner,
        '**Verdict:** revise\n**Reasoning:** margin leak.\n**If revise, what must change:**\n- Remove mt-4 from Button root.',
      ),
      parsePersonaOutput(
        a11y,
        '**Verdict:** revise\n**Reasoning:** no focus ring.\n**If revise, what must change:**\n- Add focus-visible style.',
      ),
    ])
    expect(agg.verdict).toBe('revise')
    expect(agg.dissenting).toHaveLength(2)
    expect(agg.combinedFeedback).toContain('The Component Designer')
    expect(agg.combinedFeedback).toContain('The Accessibility Specialist')
    expect(agg.combinedFeedback).toContain('mt-4')
    expect(agg.combinedFeedback).toContain('focus-visible')
  })
})

describe('personaVerdictToReviewRecord', () => {
  it('tags failing signals with the guild slug on revise', () => {
    const v = parsePersonaOutput(
      a11y,
      '**Verdict:** revise\n**Reasoning:** contrast fails.',
    )
    const record = personaVerdictToReviewRecord(v, { now: '2026-04-23T00:00:00Z' })
    expect(record.verdict).toBe('revise')
    expect(record.failingSignals).toEqual(['accessibility-specialist'])
    expect(record.reason).toContain('The Accessibility Specialist')
    expect(record.reviewerPath).toBe('llm')
  })

  it('leaves failingSignals empty on approve', () => {
    const v = parsePersonaOutput(componentDesigner, '**Verdict:** approve\n**Reasoning:** lgtm.')
    const record = personaVerdictToReviewRecord(v, { now: '2026-04-23T00:00:00Z' })
    expect(record.verdict).toBe('approve')
    expect(record.failingSignals).toEqual([])
  })
})
