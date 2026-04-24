/**
 * sRGB → OKLab / OKLCH conversion. Used for perceptual distance checks in
 * the Color Theorist's palette-coherence gate. Formulas from Björn Ottosson
 * (https://bottosson.github.io/posts/oklab/) adapted to TypeScript.
 */

import { parseColor, type RGB } from '../wcag.js'

function sRgbToLinear(c: number): number {
  const s = c / 255
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
}

export interface OKLab {
  L: number
  a: number
  b: number
}

export interface OKLCH {
  L: number
  C: number
  h: number // degrees 0..360
}

export function rgbToOklab(rgb: RGB): OKLab {
  const r = sRgbToLinear(rgb.r)
  const g = sRgbToLinear(rgb.g)
  const b = sRgbToLinear(rgb.b)
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
  const l_ = Math.cbrt(l)
  const m_ = Math.cbrt(m)
  const s_ = Math.cbrt(s)
  return {
    L: 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  }
}

export function oklabToOklch(lab: OKLab): OKLCH {
  const C = Math.sqrt(lab.a * lab.a + lab.b * lab.b)
  let h = (Math.atan2(lab.b, lab.a) * 180) / Math.PI
  if (h < 0) h += 360
  return { L: lab.L, C, h }
}

export function rgbToOklch(rgb: RGB): OKLCH {
  return oklabToOklch(rgbToOklab(rgb))
}

export function colorStringToOklch(input: string): OKLCH | null {
  const rgb = parseColor(input)
  if (!rgb) return null
  return rgbToOklch(rgb)
}

/**
 * Perceptual distance in OKLab. Smaller = more similar. Roughly, values
 * under ~0.02 are indistinguishable, ~0.05 is a clear difference, ~0.1 is a
 * different role. We default the duplicate threshold at 0.04 — tight enough
 * to catch genuine duplicates, loose enough to not flag adjacent steps on a
 * carefully tuned scale.
 */
export function oklabDistance(a: OKLab, b: OKLab): number {
  const dL = a.L - b.L
  const da = a.a - b.a
  const db = a.b - b.b
  return Math.sqrt(dL * dL + da * da + db * db)
}

export interface DuplicatePair {
  a: { name: string; value: string }
  b: { name: string; value: string }
  distance: number
}

/**
 * Find color pairs in a token set that sit perceptually too close. Pairs
 * are returned sorted by ascending distance (closest first).
 */
export function findNearDuplicates(
  tokens: ReadonlyArray<{ name: string; value: string }>,
  threshold = 0.04,
): DuplicatePair[] {
  const labs: Array<{ name: string; value: string; lab: OKLab } | null> =
    tokens.map((t) => {
      const rgb = parseColor(t.value)
      return rgb ? { name: t.name, value: t.value, lab: rgbToOklab(rgb) } : null
    })
  const found: DuplicatePair[] = []
  for (let i = 0; i < labs.length; i++) {
    for (let j = i + 1; j < labs.length; j++) {
      const A = labs[i]
      const B = labs[j]
      if (!A || !B) continue
      const d = oklabDistance(A.lab, B.lab)
      if (d < threshold) {
        found.push({
          a: { name: A.name, value: A.value },
          b: { name: B.name, value: B.value },
          distance: d,
        })
      }
    }
  }
  found.sort((x, y) => x.distance - y.distance)
  return found
}
