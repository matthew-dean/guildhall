/**
 * WCAG 2.x contrast math — pure functions, zero dependencies.
 *
 * Spec: https://www.w3.org/TR/WCAG22/#contrast-minimum
 * Relative luminance formula: https://www.w3.org/TR/WCAG22/#dfn-relative-luminance
 *
 * All inputs are CSS-style color strings. We accept hex (`#rgb`, `#rrggbb`)
 * and `rgb(r,g,b)` / `rgb(r g b)` / `rgb(r g b / a)`. `oklch()` / `hsl()` /
 * named colors are not parsed in this first pass — callers should resolve
 * those to hex/rgb before invoking `contrastRatio()`. A future pass will
 * cover OKLCH directly (needed for palette-distance work in color-theorist).
 */

export interface RGB {
  r: number // 0..255
  g: number // 0..255
  b: number // 0..255
}

/** Parse a CSS color string to `{r,g,b}`. Returns `null` if unparseable. */
export function parseColor(input: string): RGB | null {
  const s = input.trim().toLowerCase()
  if (s.startsWith('#')) return parseHex(s)
  if (s.startsWith('rgb')) return parseRgb(s)
  return null
}

function parseHex(s: string): RGB | null {
  const hex = s.replace('#', '')
  if (hex.length === 3) {
    const r = parseInt(hex[0]! + hex[0]!, 16)
    const g = parseInt(hex[1]! + hex[1]!, 16)
    const b = parseInt(hex[2]! + hex[2]!, 16)
    return Number.isNaN(r + g + b) ? null : { r, g, b }
  }
  if (hex.length === 6) {
    const r = parseInt(hex.slice(0, 2), 16)
    const g = parseInt(hex.slice(2, 4), 16)
    const b = parseInt(hex.slice(4, 6), 16)
    return Number.isNaN(r + g + b) ? null : { r, g, b }
  }
  return null
}

function parseRgb(s: string): RGB | null {
  // Accept "rgb(255, 0, 128)", "rgb(255 0 128)", "rgb(255 0 128 / 0.5)".
  const inner = s.replace(/^rgba?\(/, '').replace(/\)$/, '').split('/')[0]!
  const parts = inner
    .split(/[\s,]+/)
    .map((p) => p.trim())
    .filter(Boolean)
  if (parts.length < 3) return null
  const [rs, gs, bs] = parts
  const r = Number(rs)
  const g = Number(gs)
  const b = Number(bs)
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return null
  return { r, g, b }
}

/** sRGB → linear RGB channel (per WCAG 2.x). Input 0..255, output 0..1. */
function channelLuminance(c: number): number {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
}

/** WCAG 2.x relative luminance. Output 0..1. */
export function relativeLuminance(rgb: RGB): number {
  const r = channelLuminance(rgb.r)
  const g = channelLuminance(rgb.g)
  const b = channelLuminance(rgb.b)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Contrast ratio between two colors. Returns 1..21. */
export function contrastRatio(fg: RGB, bg: RGB): number {
  const l1 = relativeLuminance(fg)
  const l2 = relativeLuminance(bg)
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

/** Parse two color strings and return their contrast. `null` on parse failure. */
export function contrastRatioFromStrings(fg: string, bg: string): number | null {
  const a = parseColor(fg)
  const b = parseColor(bg)
  if (!a || !b) return null
  return contrastRatio(a, b)
}

export type WcagLevel = 'AA' | 'AAA'
export type TextSize = 'normal' | 'large' | 'non-text'

/**
 * Minimum contrast required per WCAG 2.x for a given level + text size.
 *  - AA normal: 4.5 · AA large: 3.0 · AA non-text (UI components, graphics): 3.0
 *  - AAA normal: 7.0 · AAA large: 4.5 · AAA non-text: 4.5 (widely adopted)
 */
export function minimumContrast(level: WcagLevel, size: TextSize): number {
  if (level === 'AA') {
    if (size === 'normal') return 4.5
    return 3.0
  }
  if (size === 'normal') return 7.0
  return 4.5
}

export interface ContrastCheckInput {
  fg: string
  bg: string
  level?: WcagLevel
  size?: TextSize
  /** Optional label for reporting, e.g. "text.body on bg.surface". */
  label?: string
}

export interface ContrastCheckResult {
  label: string
  fg: string
  bg: string
  ratio: number | null
  required: number
  pass: boolean
  reason?: string
}

export function checkContrast(input: ContrastCheckInput): ContrastCheckResult {
  const level = input.level ?? 'AA'
  const size = input.size ?? 'normal'
  const required = minimumContrast(level, size)
  const ratio = contrastRatioFromStrings(input.fg, input.bg)
  const label = input.label ?? `${input.fg} on ${input.bg}`
  if (ratio === null) {
    return {
      label,
      fg: input.fg,
      bg: input.bg,
      ratio: null,
      required,
      pass: false,
      reason: 'unparseable color',
    }
  }
  return {
    label,
    fg: input.fg,
    bg: input.bg,
    ratio,
    required,
    pass: ratio >= required,
  }
}
