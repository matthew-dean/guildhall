import { describe, expect, it } from 'vitest'
import { validateProductBriefGrounding, validateSpecCompletionBoundary, validateSpecGrounding } from '../spec-quality.js'

const baseTask = {
  title: 'Build broad-genre drafting model proof',
  description: 'Evaluate DeepInfra-accessible candidates for voice and genre breadth.',
  references: ['docs/harness/headless-mvp-release-plan.md'],
  sourceClaims: [{
    source: 'workspace-importer',
    title: 'Build broad-genre drafting model proof',
    evidence: 'Evaluate DeepInfra-accessible candidates for voice and genre breadth.',
    references: ['docs/harness/headless-mvp-release-plan.md'],
    confidence: 'high' as const,
    linkedTaskHints: ['Build broad-genre drafting model proof'],
  }],
  request: undefined,
  requestIntake: undefined,
  productBrief: undefined,
}

describe('validateSpecGrounding', () => {
  it('rejects plausible commands, paths, and model choices that were not visible', () => {
    const result = validateSpecGrounding({
      ...baseTask,
      spec: 'Use mixtral and write scripts/proof-broad-genre-drafting.mjs. Run pnpm proof-broad-genre-drafting.',
    })

    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toContain('executable detail')
    expect(result.errors.join(' ')).toContain('model families')
  })

  it('allows facts and exact paths that are present in the visible packet', () => {
    const result = validateSpecGrounding({
      ...baseTask,
      spec: 'Review the DeepInfra-accessible candidates named by the task and cite docs/harness/headless-mvp-release-plan.md as the source.',
    })

    expect(result).toEqual({ ok: true, errors: [] })
  })

  it('treats documented source references as grounding evidence even without source claims', () => {
    const result = validateSpecGrounding({
      ...baseTask,
      sourceClaims: [],
      spec: 'Run pnpm proof:evaluation and add src/reviewers/theme-proof.test.ts.',
    })

    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toContain('executable detail')
    expect(result.errors.join(' ')).toContain('project paths')
  })

  it('ignores model prose variation when the structured execution contract is unchanged', () => {
    const structuredSpec = {
      whatThisIs: 'A bounded contract.',
      problemContext: 'The visible task needs a proof boundary.',
      goals: ['Record the result.'],
      nonGoals: ['Do not expand scope.'],
      proposedDesign: 'Use the registered project surface.',
      keyDecisions: ['Keep the proof typed.'],
      acceptanceCriteria: [{
        scenario: 'Given the task, when the work is complete',
        expectation: 'Then the result is reviewable.',
        verificationMode: 'review' as const,
      }],
      verification: ['Review the recorded evidence.'],
      completionBoundary: {
        productOutcome: 'The result is reviewable.',
        whatGuildhallCanCompleteInCode: 'Record the result.',
        externalDependencies: 'None known.',
        ownerOnlySetup: 'None known.',
        verificationEnvironment: 'The registered project.',
        whatCountsAsDone: 'The result is recorded.',
        whatMustBeSplitOrBlocked: 'Split only for independent outcomes.',
      },
    }
    const terse = validateSpecGrounding({
      ...baseTask,
      spec: 'terse display text',
      structuredSpec,
    })
    const lyrical = validateSpecGrounding({
      ...baseTask,
      spec: 'lyrical display text with model-specific words, commands, and paths',
      structuredSpec: { ...structuredSpec, proposedDesign: 'A lyrical, ornate description with arbitrary vocabulary.' },
    })

    expect(lyrical).toEqual(terse)
    expect(lyrical).toEqual({ ok: true, errors: [] })
  })
})

describe('validateProductBriefGrounding', () => {
  it('does not treat explanatory outcome prose as an executable contract', () => {
    const result = validateProductBriefGrounding(baseTask, {
      userJob: 'Evaluate broad-genre drafting behavior.',
      whyItMattersNow: 'The MVP needs a real drafting proof.',
      successMetric: 'scripts/proof-broad-genre-drafting.mjs runs successfully.',
      nonGoals: ['Do not build a UI.'],
      antiPatterns: ['Do not build a UI.'],
    })

    expect(result).toEqual({ ok: true, errors: [] })
  })

  it('allows a source-grounded product outcome without executable guesses', () => {
    const result = validateProductBriefGrounding(baseTask, {
      userJob: 'Evaluate broad-genre drafting behavior.',
      whyItMattersNow: 'The MVP needs a real drafting proof.',
      successMetric: 'The visible evaluation boundary is shaped for provider-backed proof.',
      nonGoals: ['Do not build a UI.'],
      antiPatterns: ['Do not build a UI.'],
    })

    expect(result).toEqual({ ok: true, errors: [] })
  })
})

describe('validateSpecCompletionBoundary', () => {
  const structuredSpec = {
    whatThisIs: 'A bounded implementation contract.',
    problemContext: 'The current project needs one verifiable outcome.',
    goals: ['Implement the bounded outcome.'],
    nonGoals: ['Do not expand scope.'],
    proposedDesign: 'Use the existing project surface.',
    keyDecisions: ['Keep proof attached to the task.'],
    acceptanceCriteria: [{
      scenario: 'Given the task boundary, when the work is complete',
      expectation: 'The bounded outcome is available.',
      verificationMode: 'review' as const,
    }],
    verification: ['Review the changed surface and recorded evidence.'],
    completionBoundary: {
      productOutcome: 'The bounded outcome is available.',
      whatGuildhallCanCompleteInCode: 'Implement the bounded project work.',
      externalDependencies: 'None known.',
      ownerOnlySetup: 'None known.',
      verificationEnvironment: 'The registered local project.',
      whatCountsAsDone: 'The acceptance criterion is satisfied.',
      whatMustBeSplitOrBlocked: 'New product decisions remain separate.',
    },
  }

  it('requires the structured contract and ignores rendered Markdown wording', () => {
    const base = {
      ...baseTask,
      productBrief: {
        userJob: 'Complete the bounded project work.',
        successMetric: 'The structured acceptance contract is satisfied.',
      },
      acceptanceCriteria: [{
        id: 'ac-1',
        description: 'The bounded outcome is available.',
        verifiedBy: 'review' as const,
        met: false,
      }],
      structuredSpec,
      spec: 'A model may render this however it likes. No heading is authoritative.',
    }
    expect(validateSpecCompletionBoundary(base)).toEqual({ ok: true, errors: [] })
    expect(validateSpecCompletionBoundary({
      ...base,
      spec: 'Completely different prose, headings, ordering, and terminology.',
    })).toEqual({ ok: true, errors: [] })
  })

  it('fails closed when only a Markdown spec exists', () => {
    const result = validateSpecCompletionBoundary({
      ...baseTask,
      spec: '## Completion Boundary\n- Product outcome: Something works.',
      acceptanceCriteria: [{
        id: 'ac-1',
        description: 'Something works.',
        verifiedBy: 'review' as const,
        met: false,
      }],
      productBrief: {
        userJob: 'Complete the work.',
        successMetric: 'The work is verifiable.',
      },
      structuredSpec: undefined,
    })
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toContain('structuredSpec')
  })
})
