import type { DeterministicCheck, CheckInput, CheckResult } from '../types.js'
import { findNearDuplicates } from './oklch.js'

const NEAR_DUPLICATE_CHECK: DeterministicCheck = {
  id: 'color.near-duplicate-roles',
  description:
    'Flag pairs of color tokens that sit perceptually too close in OKLab space (likely duplicates).',
  run(input: CheckInput): CheckResult {
    if (!input.designSystem) {
      return {
        checkId: 'color.near-duplicate-roles',
        pass: true,
        summary: 'skipped — no design system declared',
      }
    }
    const pairs = findNearDuplicates(input.designSystem.tokens.color)
    if (pairs.length === 0) {
      return {
        checkId: 'color.near-duplicate-roles',
        pass: true,
        summary: `${input.designSystem.tokens.color.length} color tokens, no near-duplicates`,
      }
    }
    const lines = pairs.map(
      (p) =>
        `  - ${p.a.name} (${p.a.value}) ≈ ${p.b.name} (${p.b.value}) — ΔE≈${p.distance.toFixed(3)}`,
    )
    return {
      checkId: 'color.near-duplicate-roles',
      pass: false,
      summary: `${pairs.length} near-duplicate color pair(s) detected`,
      detail: lines.join('\n'),
      suggestions: [
        'Collapse near-duplicate tokens into one role, or re-tune one of the pair so they stand apart perceptually.',
        'If both are intentional (e.g. danger.bg vs danger.bg-hover), annotate their role relationship so the check can skip sibling states.',
      ],
    }
  },
}

export const COLOR_THEORIST_CHECKS: DeterministicCheck[] = [NEAR_DUPLICATE_CHECK]
