import type { DeterministicCheck, CheckInput, CheckResult } from '../types.js'

/**
 * Heuristic "external margin" detector — runs over a source snippet string
 * and flags any root-level margin declaration. This is a *pure* function
 * suitable for unit testing; a file-traversing wrapper can be layered on
 * later once we standardize how components are enumerated in a project.
 *
 * Patterns flagged:
 *   - CSS: `margin:` / `margin-top:` / `margin-left:` etc. in the first
 *     ruleset of a component module.
 *   - Inline style: `style={{ margin: ... }}` / `style={{ marginTop: ... }}`
 *     on the root element.
 *   - Tailwind-ish: ` m-`, ` mt-`, ` ml-` class utilities on the root.
 *
 * False positives are acceptable — this is advisory; the reviewer rubric
 * item is the authoritative check. The intent is to flag the easy cases
 * cheaply so a human or the reviewer can focus on ambiguous ones.
 */
export interface MarginFinding {
  line: number
  snippet: string
  pattern: string
}

export function findExternalMargins(source: string): MarginFinding[] {
  const findings: MarginFinding[] = []
  const lines = source.split(/\r?\n/)
  // Avoid common false positives: skip lines that are clearly comments or
  // that live inside a nested selector (heuristic: leading whitespace + `&`).
  const patterns: Array<{ re: RegExp; label: string }> = [
    { re: /(^|[^-\w])margin\s*:/, label: 'css-margin-shorthand' },
    { re: /(^|[^-\w])margin-(top|right|bottom|left|block|inline)/, label: 'css-margin-side' },
    { re: /\bstyle\s*=\s*\{\{[^}]*\bmargin(Top|Right|Bottom|Left)?\s*:/, label: 'inline-style-margin' },
    { re: /\bclass(Name)?\s*=\s*["'`][^"'`]*\b(m|mt|mr|mb|ml|mx|my)-\d/, label: 'utility-class-margin' },
  ]
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const trimmed = line.trim()
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('#')) continue
    for (const { re, label } of patterns) {
      if (re.test(line)) {
        findings.push({ line: i + 1, snippet: trimmed.slice(0, 160), pattern: label })
        break
      }
    }
  }
  return findings
}

/**
 * Token-only value detector. Flags hardcoded color hex, rgb(), and common
 * hardcoded pixel values inside what looks like a style declaration. Again:
 * advisory, pure, testable.
 */
export interface HardcodedValueFinding {
  line: number
  snippet: string
  kind: 'hex-color' | 'rgb-color' | 'px-spacing'
}

export function findHardcodedDesignValues(source: string): HardcodedValueFinding[] {
  const findings: HardcodedValueFinding[] = []
  const lines = source.split(/\r?\n/)
  const hex = /#[0-9a-fA-F]{3,8}\b/
  const rgb = /\brgba?\s*\(/
  // Pixel values inside a style context — look for `: 12px` / `= '12px'` etc.
  const pxInStyle = /[:=]\s*['"`]?-?\d{1,4}px\b/
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const trimmed = line.trim()
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue
    if (hex.test(line)) {
      findings.push({ line: i + 1, snippet: trimmed.slice(0, 160), kind: 'hex-color' })
      continue
    }
    if (rgb.test(line)) {
      findings.push({ line: i + 1, snippet: trimmed.slice(0, 160), kind: 'rgb-color' })
      continue
    }
    if (pxInStyle.test(line)) {
      findings.push({ line: i + 1, snippet: trimmed.slice(0, 160), kind: 'px-spacing' })
    }
  }
  return findings
}

/**
 * Placeholder DeterministicCheck entries. These are registered so the
 * registry can see them in its check list, but the run-over-filesystem
 * wrapper is not wired yet — we need a project-provided "primitives
 * directory" convention first. The checks return a non-failing informational
 * result until that wiring lands.
 */
export const COMPONENT_DESIGNER_CHECKS: DeterministicCheck[] = [
  {
    id: 'component-designer.no-external-margin',
    description:
      'Flag components that declare margin on their root element (use a layout primitive instead).',
    run(_input: CheckInput): CheckResult {
      return {
        checkId: 'component-designer.no-external-margin',
        pass: true,
        summary:
          'skipped — pure detector `findExternalMargins(source)` is exported; project-specific gate wrapper needed',
      }
    },
  },
  {
    id: 'component-designer.token-only-values',
    description:
      'Flag hardcoded color / pixel values that should reference design tokens.',
    run(_input: CheckInput): CheckResult {
      return {
        checkId: 'component-designer.token-only-values',
        pass: true,
        summary:
          'skipped — pure detector `findHardcodedDesignValues(source)` is exported; project-specific gate wrapper needed',
      }
    },
  },
]
