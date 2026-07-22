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

function withMachineResult(
  prose: string,
  verdict: 'approve' | 'revise',
  acceptedCriteriaIds: string[] = [],
  proofEvidenceIds: string[] = [],
  extras: {
    revisionItems?: string[]
    riskItems?: string[]
    followUpItems?: string[]
    advisoryScores?: Record<string, string>
  } = {},
): string {
  return `${prose}\n\n**Machine result:**\n\`\`\`json\n${JSON.stringify({
    verdict,
    acceptedCriteriaIds,
    proofEvidenceIds,
    revisionItems: extras.revisionItems ?? [],
    riskItems: extras.riskItems ?? [],
    followUpItems: extras.followUpItems ?? [],
    advisoryScores: extras.advisoryScores ?? {},
  })}\n\`\`\``
}

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
    const v = parsePersonaOutput(componentDesigner, withMachineResult(raw, 'approve'))
    expect(v.verdict).toBe('approve')
    expect(v.reasoning).toBe(v.rawOutput.trim())
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
    const v = parsePersonaOutput(a11y, withMachineResult(raw, 'revise', [], [], {
      revisionItems: [
        'Bump color.text.muted to #5c5c5c so it clears 4.5:1 on bg.subtle.',
        "Add a visual regression test covering Card's secondary label contrast.",
      ],
      riskItems: ['Secondary labels will remain below WCAG AA on subtle surfaces.'],
      followUpItems: ['Consider adding a token-level contrast snapshot for the broader surface palette.'],
      advisoryScores: { recommendationPriority: 'high', expectedValue: 'medium', deferredRisk: 'medium' },
    }))
    expect(v.verdict).toBe('revise')
    expect(v.revisionItems).toHaveLength(2)
    expect(v.revisionItems[0]).toContain('color.text.muted')
    expect(v.riskItems).toEqual([
      'Secondary labels will remain below WCAG AA on subtle surfaces.',
    ])
    expect(v.recommendationPriority).toBe('high')
    expect(v.expectedValue).toBe('medium')
    expect(v.deferredRisk).toBe('medium')
    expect(v.reasoning).toBe(v.rawOutput.trim())
    expect(v.followUpItems).toEqual([
      'Consider adding a token-level contrast snapshot for the broader surface palette.',
    ])
  })

  it('does not infer a decision from prose labels', () => {
    const a = parsePersonaOutput(componentDesigner, '**Verdict:** approved\n**Reasoning:** fine.')
    const b = parsePersonaOutput(componentDesigner, '**Verdict:** needs revision\n**Reasoning:** nope.')
    expect(a.verdict).toBe('revise')
    expect(a.failureCode).toBe('invalid_review_contract')
    expect(b.verdict).toBe('revise')
    expect(b.failureCode).toBe('invalid_review_contract')
  })

  it('defaults to revise when no verdict keyword is present', () => {
    const v = parsePersonaOutput(componentDesigner, 'some rambling text without the magic word')
    expect(v.verdict).toBe('revise')
    expect(v.reasoning).toBe('some rambling text without the magic word')
  })

  it('preserves raw output for audit', () => {
    const raw = '**Verdict:** approve\n**Reasoning:** ok.'
    const v = parsePersonaOutput(componentDesigner, raw)
    expect(v.rawOutput).toBe(raw)
  })

  it('uses structured data rather than model prose for the decision', () => {
    const first = parsePersonaOutput(
      componentDesigner,
      withMachineResult('**Verdict:** revise\n**Reasoning:** lyrical but unconvinced.', 'approve', ['ac-1'], ['scope']),
    )
    const second = parsePersonaOutput(
      componentDesigner,
      withMachineResult('I would approve this after a very different explanation.', 'approve', ['ac-1'], ['scope']),
    )
    expect(first.verdict).toBe('approve')
    expect(second.verdict).toBe('approve')
    expect(first.acceptedCriteriaIds).toEqual(['ac-1'])
    expect(second.proofEvidenceIds).toEqual(['scope'])
  })

  it('keeps the machine verdict authoritative when prose says the work is otherwise acceptable', () => {
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
    const v = parsePersonaOutput(componentDesigner, withMachineResult(raw, 'revise', [], [], {
      revisionItems: [
        'Add a versioned prefix to the route (e.g., /v1/...).',
        'Introduce an Idempotency-Key header for the POST operation.',
        'Add observability to the handler with trace spans and metric counters.',
      ],
    }))
    expect(v.verdict).toBe('revise')
    expect(v.revisionItems).toEqual([
      'Add a versioned prefix to the route (e.g., /v1/...).',
      'Introduce an Idempotency-Key header for the POST operation.',
      'Add observability to the handler with trace spans and metric counters.',
    ])
    expect(v.followUpItems).toEqual([])
  })

  it('does not use task-text heuristics to override a revise result', () => {
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
    const v = parsePersonaOutput(componentDesigner, withMachineResult(raw, 'revise', [], [], {
      revisionItems: [
        'Add a versioned prefix to the route (e.g., /v1/...).',
        'Introduce an Idempotency-Key header for the POST operation.',
        'Add schema validation for the id router parameter.',
        'Add observability to the handler with trace spans and metric counters.',
      ],
    }), hints)
    expect(v.verdict).toBe('revise')
    expect(v.revisionItems).toEqual([
      'Add a versioned prefix to the route (e.g., /v1/...).',
      'Introduce an Idempotency-Key header for the POST operation.',
      'Add schema validation for the id router parameter.',
      'Add observability to the handler with trace spans and metric counters.',
    ])
    expect(v.followUpItems).toEqual([])
  })

  it('does not infer task scope from prose when parsing a revise result', () => {
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
    const v = parsePersonaOutput(componentDesigner, withMachineResult(raw, 'revise', [], [], {
      revisionItems: ['Add a schema validation step for the id router parameter before it is used in Supabase queries.'],
    }), hints)
    expect(v.verdict).toBe('revise')
    expect(v.revisionItems).toEqual([
      'Add a schema validation step for the id router parameter before it is used in Supabase queries.',
    ])
    expect(v.followUpItems).toEqual([])
  })

  it('does not demote a revision because a proof command appears in prose', () => {
    const hints = buildPersonaOutputHints({
      title: 'Shape fixture and expected-record ground truth',
      description: 'Define the fixture and expected-record ground truth surface.',
      spec: [
        '## Summary',
        'Shape fixture and expected-record ground truth.',
        '',
        '## Acceptance Criteria',
        '1. Fixture manifest can express the tiny fiction fixture.',
        '2. Expected records encode source facts and expected signals.',
        '3. The existing schema files and fixture artifacts represent the data.',
        '4. Given the implementation is complete, when the local proof command runs, then Guildhall records the exact command and result against this task before the parent work is treated as satisfied.',
      ].join('\n'),
      acceptanceCriteria: [],
      outOfScope: [],
    })
    const raw = `
**Verdict:** revise

**Reasoning:** The implementation fails AC4 because the required proof command has not been executed.

**If revise, recommended task-local revisions:**
- Execute the proof command \`npx guildhall run --task=task-import-9s8tkc-split-define-fixture-expected-record-prototype-run-and-evaluat\` and capture its output.

**Risk if accepted as-is:**
- Guildhall cannot record the required command and result.

**Optional follow-up ideas (non-blocking):**
- (none)
`
    const v = parsePersonaOutput(componentDesigner, withMachineResult(raw, 'revise', [], [], {
      revisionItems: ['Execute the proof command `npx guildhall run --task=task-import-9s8tkc-split-define-fixture-expected-record-prototype-run-and-evaluat` and capture its output.'],
    }), hints)
    expect(v.verdict).toBe('revise')
    expect(v.revisionItems).toEqual([
      'Execute the proof command `npx guildhall run --task=task-import-9s8tkc-split-define-fixture-expected-record-prototype-run-and-evaluat` and capture its output.',
    ])
    expect(v.followUpItems).toEqual([])
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
    const v = parsePersonaOutput(componentDesigner, withMachineResult(raw, 'revise', [], [], {
      revisionItems: [
        'Remove the deleteTrashRes variable from the destructuring assignment.',
        'Add a versioned prefix to the route (e.g., /v1/...).',
      ],
    }), hints)
    expect(v.verdict).toBe('revise')
    expect(v.revisionItems).toEqual([
      'Remove the deleteTrashRes variable from the destructuring assignment.',
      'Add a versioned prefix to the route (e.g., /v1/...).',
    ])
    expect(v.followUpItems).toEqual([])
  })
})

describe('aggregateFanout', () => {
  it('keeps worker feedback identical when only reviewer prose changes', () => {
    const machineFields = {
      guildSlug: 'component-designer',
      guildName: 'Component Designer',
      verdict: 'revise' as const,
      revisionItems: ['Use the shared button primitive.'],
      riskItems: ['A local variant would drift from the design system.'],
      followUpItems: ['Audit adjacent surfaces later.'],
      acceptedCriteriaIds: ['ac-1'],
      proofEvidenceIds: ['proof-1'],
      rawOutput: '',
    }

    const first = aggregateFanout([{
      ...machineFields,
      reasoning: 'The work is lyrical and elegant, but revise it.',
    }])
    const second = aggregateFanout([{
      ...machineFields,
      reasoning: 'REVISE. Different model, different vocabulary, different paragraph order.',
    }])

    expect(second.verdict).toBe(first.verdict)
    expect(second.combinedFeedback).toBe(first.combinedFeedback)
    expect(second.dissenting.map(value => value.guildSlug)).toEqual(
      first.dissenting.map(value => value.guildSlug),
    )
    expect(first.combinedFeedback).not.toContain('lyrical')
    expect(first.combinedFeedback).not.toContain('Different model')
    expect(first.combinedFeedback).toContain('Use the shared button primitive.')
    expect(first.combinedFeedback).toContain('ac-1')
    expect(first.combinedFeedback).toContain('proof-1')
  })

  it('approves when every persona approves', () => {
    const agg = aggregateFanout([
      parsePersonaOutput(componentDesigner, withMachineResult('**Reasoning:** lgtm.', 'approve')),
      parsePersonaOutput(a11y, withMachineResult('**Reasoning:** contrast fine.', 'approve')),
    ])
    expect(agg.verdict).toBe('approve')
    expect(agg.dissenting).toHaveLength(0)
    expect(agg.combinedFeedback).toBe('')
  })

  it('revises when any persona revises', () => {
    const agg = aggregateFanout([
      parsePersonaOutput(componentDesigner, withMachineResult('**Reasoning:** fine.', 'approve')),
      parsePersonaOutput(
        a11y,
        withMachineResult('**Reasoning:** contrast fails.', 'revise', [], [], {
          revisionItems: ['Fix color.text.muted.'],
          riskItems: ['Contrast remains below threshold.'],
          followUpItems: ['Consider auditing muted text tokens globally.'],
          advisoryScores: { recommendationPriority: 'high', expectedValue: 'medium', deferredRisk: 'medium' },
        }),
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
        withMachineResult('**Reasoning:** margin leak.', 'revise', [], [], {
          revisionItems: ['Remove mt-4 from Button root.'],
        }),
      ),
      parsePersonaOutput(
        a11y,
        withMachineResult('**Reasoning:** no focus ring.', 'revise', [], [], {
          revisionItems: ['Add focus-visible style.'],
        }),
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
        withMachineResult('**Reasoning:** margin leak.', 'revise', [], [], {
          revisionItems: ['Remove mt-4 from Button root.'],
        }),
      ),
      parsePersonaOutput(
        a11y,
        withMachineResult('**Reasoning:** The Accessibility Specialist failed to produce a verdict (persona review timed out after 60000ms). Treating as revise per strict-all policy.', 'revise'),
        {},
        { failureCode: 'provider_timeout' },
      ),
    ])
    expect(agg.verdict).toBe('revise')
    expect(agg.dissenting).toHaveLength(1)
    expect(agg.combinedFeedback).toContain('Aggregated revisions from 1 persona')
    expect(agg.combinedFeedback).toContain('Reviewer availability notes')
    expect(agg.combinedFeedback).toContain('The Accessibility Specialist')
    expect(agg.combinedFeedback).toContain('provider_timeout')
    expect(agg.combinedFeedback).not.toContain('timed out after 60000ms')
    expect(agg.combinedFeedback).toContain('Remove mt-4 from Button root')
  })

  it('approves when the only dissents are reviewer availability failures', () => {
    const agg = aggregateFanout([
      parsePersonaOutput(
        componentDesigner,
        withMachineResult('**Reasoning:** The Component Designer failed to produce a verdict (Exceeded maximum turn limit (3)). Treating as revise per strict-all policy.', 'revise'),
        {},
        { failureCode: 'provider_unavailable' },
      ),
      parsePersonaOutput(
        a11y,
        withMachineResult('**Reasoning:** The Accessibility Specialist failed to produce a verdict (persona review timed out after 60000ms). Treating as revise per strict-all policy.', 'revise'),
        {},
        { failureCode: 'provider_timeout' },
      ),
      parsePersonaOutput(
        componentDesigner,
        withMachineResult('**Reasoning:** Copy is clear and user-facing.', 'approve'),
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
      withMachineResult('**Reasoning:** contrast fails.', 'revise', [], [], {
        followUpItems: ['Consider a shared contrast helper.'],
      }),
    )
    const record = personaVerdictToReviewRecord(v, { now: '2026-04-23T00:00:00Z' })
    expect(record.verdict).toBe('revise')
    expect(record.failingSignals).toEqual(['accessibility-specialist'])
    expect(record.reason).toContain('The Accessibility Specialist')
    expect(record.reviewerPath).toBe('llm')
    expect(record.reasoning).toContain('Non-blocking follow-up ideas')
  })

  it('leaves failingSignals empty on approve', () => {
    const v = parsePersonaOutput(componentDesigner, withMachineResult('**Reasoning:** lgtm.', 'approve'))
    const record = personaVerdictToReviewRecord(v, { now: '2026-04-23T00:00:00Z' })
    expect(record.verdict).toBe('approve')
    expect(record.failingSignals).toEqual([])
  })

  it('does not persist a contract failure as a product finding', () => {
    const v = parsePersonaOutput(componentDesigner, 'The prose is persuasive but has no machine result.')
    const record = personaVerdictToReviewRecord(v, { now: '2026-04-23T00:00:00Z' })
    expect(record.failureCode).toBe('invalid_review_contract')
    expect(record.reason).toContain('no product finding was inferred')
    expect(record.failingSignals).toEqual([])
  })

  it('persists advisory scores as structured verdict data', () => {
    const v = parsePersonaOutput(
      a11y,
      withMachineResult('The explanation can be any prose at all.', 'revise', [], [], {
        advisoryScores: {
          recommendationPriority: 'high',
          expectedValue: 'medium',
          deferredRisk: 'low',
        },
      }),
    )
    expect(personaVerdictToReviewRecord(v, { now: '2026-04-23T00:00:00Z' })).toMatchObject({
      reviewerId: 'accessibility-specialist',
      reviewerName: 'The Accessibility Specialist',
      advisoryScores: {
        recommendationPriority: 'high',
        expectedValue: 'medium',
        deferredRisk: 'low',
      },
    })
  })
})
