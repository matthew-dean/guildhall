import { describe, it, expect } from 'vitest'
import { BUILTIN_GUILDS } from '@guildhall/guilds'
import {
  parsePersonaOutput,
  aggregateFanout,
  personaVerdictToReviewRecord,
  buildPersonaOutputHints,
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

**Optional follow-up ideas (non-blocking):**
- (none)
`
    const v = parsePersonaOutput(componentDesigner, raw)
    expect(v.verdict).toBe('approve')
    expect(v.reasoning).toContain('Ghost variant')
    expect(v.revisionItems).toEqual([])
    expect(v.followUpItems).toEqual([])
    expect(v.guildSlug).toBe('component-designer')
  })

  it('parses a revise output with bullet revision items', () => {
    const raw = `
**Rubric:**
- a11y-contrast-ok: no — text.muted on bg.subtle only 3.8:1.
- a11y-focus-visible: yes.

**Verdict:** revise

**Reasoning:** The muted text color on the subtle surface does not meet WCAG AA. This affects the secondary label on every Card.

**If revise, recommended task-local revisions:**
- Bump color.text.muted to #5c5c5c so it clears 4.5:1 on bg.subtle.
- Add a visual regression test covering Card's secondary label contrast.

**Risk if accepted as-is:**
- Secondary labels will remain below WCAG AA on subtle surfaces.

**Advisory scoring (from your perspective):**
- Recommendation priority: high
- Expected value if taken: medium
- Risk if deferred: medium

**Optional follow-up ideas (non-blocking):**
- Consider adding a token-level contrast snapshot for the broader surface palette.
`
    const v = parsePersonaOutput(a11y, raw)
    expect(v.verdict).toBe('revise')
    expect(v.revisionItems).toHaveLength(2)
    expect(v.revisionItems[0]).toContain('color.text.muted')
    expect(v.riskItems).toEqual([
      'Secondary labels will remain below WCAG AA on subtle surfaces.',
    ])
    expect(v.recommendationPriority).toBe('high')
    expect(v.expectedValue).toBe('medium')
    expect(v.deferredRisk).toBe('medium')
    expect(v.reasoning).toContain('WCAG AA')
    expect(v.followUpItems).toEqual([
      'Consider adding a token-level contrast snapshot for the broader surface palette.',
    ])
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

  it('demotes broad standards spillover to follow-up ideas when the task already meets the functional ask', () => {
    const raw = `
**Verdict:** revise

**Reasoning:** The implementation satisfies the functional acceptance criteria but violates core API design principles and rubric requirements.

**If revise, recommended task-local revisions:**
- Add a versioned prefix to the route (e.g., /v1/...).
- Introduce an Idempotency-Key header for the POST operation.
- Add observability to the handler with trace spans and metric counters.

**Risk if accepted as-is:**
- Internal restore semantics may be harder to evolve if this route later becomes shared.

**Optional follow-up ideas (non-blocking):**
- (none)
`
    const v = parsePersonaOutput(componentDesigner, raw)
    expect(v.verdict).toBe('approve')
    expect(v.revisionItems).toEqual([])
    expect(v.followUpItems).toEqual([
      'Add a versioned prefix to the route (e.g., /v1/...).',
      'Introduce an Idempotency-Key header for the POST operation.',
      'Add observability to the handler with trace spans and metric counters.',
    ])
  })

  it('demotes broad standards spillover on narrow cleanup tasks even when the reviewer does not admit the task already passed', () => {
    const hints = buildPersonaOutputHints({
      title: 'Clean unused restore handler binding',
      description:
        'In Knit, remove the unused deleteTrashRes binding in web/server/api/pages/[id]/restore.post.ts so the lint warning goes away without changing restore behavior.',
      spec:
        '## Summary\nSingle-line cleanup with no ambiguity.\n\n## Out of Scope\n- Any changes to other files.\n- Adding tests.',
      acceptanceCriteria: [],
      outOfScope: ['Any changes to other files.', 'Adding tests.'],
    })
    const raw = `
**Verdict:** revise

**Reasoning:** The endpoint is not versioned, is not idempotent, and lacks boundary validation for the id parameter.

**If revise, recommended task-local revisions:**
- Add a versioned prefix to the route (e.g., /v1/...).
- Introduce an Idempotency-Key header for the POST operation.
- Add schema validation for the id router parameter.
- Add observability to the handler with trace spans and metric counters.

**Risk if accepted as-is:**
- Future route evolution may be harder.

**Optional follow-up ideas (non-blocking):**
- (none)
`
    const v = parsePersonaOutput(componentDesigner, raw, hints)
    expect(v.verdict).toBe('approve')
    expect(v.revisionItems).toEqual([])
    expect(v.followUpItems).toEqual([
      'Add a versioned prefix to the route (e.g., /v1/...).',
      'Introduce an Idempotency-Key header for the POST operation.',
      'Add schema validation for the id router parameter.',
      'Add observability to the handler with trace spans and metric counters.',
    ])
  })

  it('demotes boundary-validation doctrine on narrow cleanup tasks even when the task text mentions route ids', () => {
    const hints = buildPersonaOutputHints({
      title: 'Clean unused restore handler binding',
      description:
        'In Knit, remove the unused deleteTrashRes binding in web/server/api/pages/[id]/restore.post.ts so the lint warning goes away without changing restore behavior.',
      spec:
        '## Acceptance Criteria\n1. No unused-variable warning for deleteTrashRes.\n2. Promise.all behavior is unchanged.\n3. restoreRes.error handling is unchanged.\n4. success: true return is unchanged.',
      acceptanceCriteria: [],
      outOfScope: ['Any changes to other files.', 'Adding tests.'],
    })
    const raw = `
**Verdict:** revise

**Reasoning:** The handler still extracts the id router parameter without any boundary validation.

**If revise, recommended task-local revisions:**
- Add a schema validation step for the id router parameter before it is used in Supabase queries.

**Risk if accepted as-is:**
- Unvalidated input could reach the handler boundary.

**Optional follow-up ideas (non-blocking):**
- (none)
`
    const v = parsePersonaOutput(componentDesigner, raw, hints)
    expect(v.verdict).toBe('approve')
    expect(v.revisionItems).toEqual([])
    expect(v.followUpItems).toEqual([
      'Add a schema validation step for the id router parameter before it is used in Supabase queries.',
    ])
  })

  it('keeps direct task-overlap fixes blocking on narrow cleanup tasks while demoting unrelated doctrine', () => {
    const hints = buildPersonaOutputHints({
      title: 'Clean unused restore handler binding',
      description:
        'In Knit, remove the unused deleteTrashRes binding in web/server/api/pages/[id]/restore.post.ts so the lint warning goes away without changing restore behavior.',
      spec:
        '## Summary\nSingle-line cleanup with no ambiguity.\n\n## Out of Scope\n- Any changes to other files.\n- Adding tests.',
      acceptanceCriteria: [],
      outOfScope: ['Any changes to other files.', 'Adding tests.'],
    })
    const raw = `
**Verdict:** revise

**Reasoning:** The file still contains the unused deleteTrashRes binding and the route is not versioned.

**If revise, recommended task-local revisions:**
- Remove the deleteTrashRes variable from the destructuring assignment.
- Add a versioned prefix to the route (e.g., /v1/...).

**Risk if accepted as-is:**
- The lint warning remains.

**Optional follow-up ideas (non-blocking):**
- (none)
`
    const v = parsePersonaOutput(componentDesigner, raw, hints)
    expect(v.verdict).toBe('revise')
    expect(v.revisionItems).toEqual([
      'Remove the deleteTrashRes variable from the destructuring assignment.',
    ])
    expect(v.followUpItems).toEqual([
      'Add a versioned prefix to the route (e.g., /v1/...).',
    ])
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
        '**Verdict:** revise\n**Reasoning:** contrast fails.\n**If revise, recommended task-local revisions:**\n- Fix color.text.muted.\n**Risk if accepted as-is:**\n- Contrast remains below threshold.\n**Advisory scoring (from your perspective):**\n- Recommendation priority: high\n- Expected value if taken: medium\n- Risk if deferred: medium\n**Optional follow-up ideas (non-blocking):**\n- Consider auditing muted text tokens globally.',
      ),
    ])
    expect(agg.verdict).toBe('revise')
    expect(agg.dissenting).toHaveLength(1)
    expect(agg.dissenting[0]!.guildSlug).toBe('accessibility-specialist')
    expect(agg.combinedFeedback).toContain('The Accessibility Specialist')
    expect(agg.combinedFeedback).toContain('Fix color.text.muted')
    expect(agg.combinedFeedback).toContain('Advisory scoring:')
    expect(agg.combinedFeedback).toContain('Recommendation priority: high')
    expect(agg.combinedFeedback).toContain('Risk if accepted as-is')
    expect(agg.combinedFeedback).toContain('Contrast remains below threshold.')
    expect(agg.combinedFeedback).toContain('Recommended task-local revisions')
    expect(agg.combinedFeedback).toContain('Non-blocking follow-up ideas')
    expect(agg.combinedFeedback).toContain('Consider auditing muted text tokens globally')
  })

  it('includes every dissenter in combined feedback when multiple revise', () => {
    const agg = aggregateFanout([
      parsePersonaOutput(
        componentDesigner,
        '**Verdict:** revise\n**Reasoning:** margin leak.\n**If revise, recommended task-local revisions:**\n- Remove mt-4 from Button root.',
      ),
      parsePersonaOutput(
        a11y,
        '**Verdict:** revise\n**Reasoning:** no focus ring.\n**If revise, recommended task-local revisions:**\n- Add focus-visible style.',
      ),
    ])
    expect(agg.verdict).toBe('revise')
    expect(agg.dissenting).toHaveLength(2)
    expect(agg.combinedFeedback).toContain('The Component Designer')
    expect(agg.combinedFeedback).toContain('The Accessibility Specialist')
    expect(agg.combinedFeedback).toContain('mt-4')
    expect(agg.combinedFeedback).toContain('focus-visible')
  })

  it('separates reviewer availability failures from substantive revision requests', () => {
    const agg = aggregateFanout([
      parsePersonaOutput(
        componentDesigner,
        '**Verdict:** revise\n**Reasoning:** margin leak.\n**If revise, recommended task-local revisions:**\n- Remove mt-4 from Button root.',
      ),
      parsePersonaOutput(
        a11y,
        '**Verdict:** revise\n**Reasoning:** The Accessibility Specialist failed to produce a verdict (persona review timed out after 60000ms). Treating as revise per strict-all policy.',
      ),
    ])
    expect(agg.verdict).toBe('revise')
    expect(agg.dissenting).toHaveLength(1)
    expect(agg.combinedFeedback).toContain('Aggregated revisions from 1 persona')
    expect(agg.combinedFeedback).toContain('Reviewer availability notes')
    expect(agg.combinedFeedback).toContain('The Accessibility Specialist')
    expect(agg.combinedFeedback).toContain('timed out after 60000ms')
    expect(agg.combinedFeedback).toContain('Remove mt-4 from Button root')
  })

  it('approves when the only dissents are reviewer availability failures', () => {
    const agg = aggregateFanout([
      parsePersonaOutput(
        componentDesigner,
        '**Verdict:** revise\n**Reasoning:** The Component Designer failed to produce a verdict (Exceeded maximum turn limit (3)). Treating as revise per strict-all policy.',
      ),
      parsePersonaOutput(
        a11y,
        '**Verdict:** revise\n**Reasoning:** The Accessibility Specialist failed to produce a verdict (persona review timed out after 60000ms). Treating as revise per strict-all policy.',
      ),
      parsePersonaOutput(
        componentDesigner,
        '**Verdict:** approve\n**Reasoning:** Copy is clear and user-facing.',
      ),
    ])

    expect(agg.verdict).toBe('approve')
    expect(agg.dissenting).toHaveLength(0)
    expect(agg.combinedFeedback).toContain('Reviewer availability issues')
    expect(agg.combinedFeedback).toContain('The Component Designer')
    expect(agg.combinedFeedback).toContain('The Accessibility Specialist')
  })
})

describe('personaVerdictToReviewRecord', () => {
  it('tags failing signals with the guild slug on revise', () => {
    const v = parsePersonaOutput(
      a11y,
      '**Verdict:** revise\n**Reasoning:** contrast fails.\n**Optional follow-up ideas (non-blocking):**\n- Consider a shared contrast helper.',
    )
    const record = personaVerdictToReviewRecord(v, { now: '2026-04-23T00:00:00Z' })
    expect(record.verdict).toBe('revise')
    expect(record.failingSignals).toEqual(['accessibility-specialist'])
    expect(record.reason).toContain('The Accessibility Specialist')
    expect(record.reviewerPath).toBe('llm')
    expect(record.reasoning).toContain('Non-blocking follow-up ideas')
  })

  it('leaves failingSignals empty on approve', () => {
    const v = parsePersonaOutput(componentDesigner, '**Verdict:** approve\n**Reasoning:** lgtm.')
    const record = personaVerdictToReviewRecord(v, { now: '2026-04-23T00:00:00Z' })
    expect(record.verdict).toBe('approve')
    expect(record.failingSignals).toEqual([])
  })
})
