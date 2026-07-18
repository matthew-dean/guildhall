import { describe, expect, it } from 'vitest'
import { validateProductBriefGrounding, validateSpecGrounding } from '../spec-quality.js'

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
})

describe('validateProductBriefGrounding', () => {
  it('rejects invented executable success metrics before they become brief state', () => {
    const result = validateProductBriefGrounding(baseTask, {
      userJob: 'Evaluate broad-genre drafting behavior.',
      whyItMattersNow: 'The MVP needs a real drafting proof.',
      successMetric: 'scripts/proof-broad-genre-drafting.mjs runs successfully.',
      nonGoals: ['Do not build a UI.'],
      antiPatterns: ['Do not build a UI.'],
    })

    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toContain('Product brief')
    expect(result.errors.join(' ')).toContain('project paths')
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
