import type {
  DeterministicCheck,
  CheckInput,
  CheckResult,
} from '../types.js'
import type { DesignSystem } from '@guildhall/core'
import {
  checkContrast,
  type ContrastCheckResult,
  type TextSize,
  type WcagLevel,
} from '../wcag.js'

/**
 * Derive the set of (fg, bg) token pairs to check. Without explicit pairing
 * metadata on tokens, we use a safe heuristic:
 *   - any color token whose name starts with `text.` / `fg.` / `on-` / `content.`
 *     is treated as a foreground.
 *   - any color token whose name starts with `bg.` / `surface.` / `background.`
 *     is treated as a background.
 * We then build the cross product. Projects that have explicit pairs can add
 * a `pairs` field to the design system later — the built-in detector is a
 * floor, not a ceiling.
 */
export interface PairCandidate {
  label: string
  fg: string
  bg: string
  fgName: string
  bgName: string
}

const FG_PREFIXES = ['text.', 'fg.', 'on-', 'on.', 'content.']
const BG_PREFIXES = ['bg.', 'surface.', 'background.']

function hasPrefix(name: string, prefixes: string[]): boolean {
  return prefixes.some((p) => name.startsWith(p))
}

export function derivePairsFromDesignSystem(
  ds: DesignSystem,
): PairCandidate[] {
  const fgs = ds.tokens.color.filter((t) => hasPrefix(t.name, FG_PREFIXES))
  const bgs = ds.tokens.color.filter((t) => hasPrefix(t.name, BG_PREFIXES))
  const pairs: PairCandidate[] = []
  for (const fg of fgs) {
    for (const bg of bgs) {
      pairs.push({
        label: `color.${fg.name} on color.${bg.name}`,
        fg: fg.value,
        bg: bg.value,
        fgName: fg.name,
        bgName: bg.name,
      })
    }
  }
  return pairs
}

export interface ContrastMatrixSummary {
  checked: number
  passed: number
  failed: ContrastCheckResult[]
  unparseable: ContrastCheckResult[]
}

export function runContrastMatrix(
  ds: DesignSystem,
  opts: { level?: WcagLevel; size?: TextSize } = {},
): ContrastMatrixSummary {
  const pairs = derivePairsFromDesignSystem(ds)
  const results = pairs.map((p) =>
    checkContrast({
      fg: p.fg,
      bg: p.bg,
      label: p.label,
      ...(opts.level ? { level: opts.level } : {}),
      ...(opts.size ? { size: opts.size } : {}),
    }),
  )
  const failed: ContrastCheckResult[] = []
  const unparseable: ContrastCheckResult[] = []
  let passed = 0
  for (const r of results) {
    if (r.ratio === null) {
      unparseable.push(r)
      continue
    }
    if (r.pass) passed++
    else failed.push(r)
  }
  return { checked: results.length, passed, failed, unparseable }
}

const CONTRAST_CHECK: DeterministicCheck = {
  id: 'a11y.contrast-matrix',
  description:
    'Verify every plausible fg/bg token pair meets WCAG 2.2 AA contrast (4.5:1 normal text).',
  run(input: CheckInput): CheckResult {
    if (!input.designSystem) {
      return {
        checkId: 'a11y.contrast-matrix',
        pass: true,
        summary: 'skipped — no design system declared',
      }
    }
    const summary = runContrastMatrix(input.designSystem)
    if (summary.checked === 0) {
      return {
        checkId: 'a11y.contrast-matrix',
        pass: true,
        summary:
          'skipped — no fg/bg token pairs derivable (prefix with text./bg. to enable)',
      }
    }
    const pass = summary.failed.length === 0 && summary.unparseable.length === 0
    const detailLines: string[] = []
    if (summary.failed.length > 0) {
      detailLines.push('Failed pairs:')
      for (const f of summary.failed) {
        detailLines.push(
          `  - ${f.label}: ${f.ratio?.toFixed(2) ?? '?'} < ${f.required}`,
        )
      }
    }
    if (summary.unparseable.length > 0) {
      detailLines.push('Unparseable pairs (hex / rgb only in v1):')
      for (const u of summary.unparseable) {
        detailLines.push(`  - ${u.label}: fg=${u.fg} bg=${u.bg}`)
      }
    }
    return {
      checkId: 'a11y.contrast-matrix',
      pass,
      summary: `${summary.passed}/${summary.checked} pairs pass WCAG AA`,
      ...(detailLines.length > 0 ? { detail: detailLines.join('\n') } : {}),
      ...(pass
        ? {}
        : {
            suggestions: [
              'Adjust failing fg/bg tokens so the ratio is ≥4.5 (normal text) or ≥3.0 (large text / UI).',
              'If a pair is decorative-only and never carries text, annotate it in memory/design-system.yaml and re-scope this check.',
            ],
          }),
    }
  },
}

export const ACCESSIBILITY_CHECKS: DeterministicCheck[] = [CONTRAST_CHECK]
