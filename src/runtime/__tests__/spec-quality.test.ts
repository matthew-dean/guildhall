import { describe, expect, it } from 'vitest'
import { validateSpecGrounding } from '../spec-quality.js'

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
