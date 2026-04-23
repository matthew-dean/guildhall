import { describe, it, expect } from 'vitest'
import {
  parseColor,
  relativeLuminance,
  contrastRatio,
  contrastRatioFromStrings,
  checkContrast,
  minimumContrast,
} from '../wcag.js'

describe('parseColor', () => {
  it('parses 6-digit hex', () => {
    expect(parseColor('#ff0000')).toEqual({ r: 255, g: 0, b: 0 })
  })
  it('parses 3-digit hex', () => {
    expect(parseColor('#f00')).toEqual({ r: 255, g: 0, b: 0 })
  })
  it('parses rgb() with commas', () => {
    expect(parseColor('rgb(10, 20, 30)')).toEqual({ r: 10, g: 20, b: 30 })
  })
  it('parses rgb() with spaces', () => {
    expect(parseColor('rgb(10 20 30)')).toEqual({ r: 10, g: 20, b: 30 })
  })
  it('parses rgba() with alpha (ignores alpha)', () => {
    expect(parseColor('rgb(10 20 30 / 0.5)')).toEqual({ r: 10, g: 20, b: 30 })
  })
  it('returns null for unknown formats', () => {
    expect(parseColor('oklch(0.5 0.1 180)')).toBeNull()
    expect(parseColor('hsl(0 50% 50%)')).toBeNull()
    expect(parseColor('goldenrod')).toBeNull()
  })
})

describe('contrast math', () => {
  it('black on white is 21:1', () => {
    const r = contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })
    expect(r).toBeCloseTo(21, 0)
  })
  it('white on white is 1:1', () => {
    const r = contrastRatio(
      { r: 255, g: 255, b: 255 },
      { r: 255, g: 255, b: 255 },
    )
    expect(r).toBeCloseTo(1, 2)
  })
  it('matches W3C example: #777 on #fff ≈ 4.48 (just misses AA normal)', () => {
    const r = contrastRatioFromStrings('#777777', '#ffffff')!
    expect(r).toBeGreaterThan(4.4)
    expect(r).toBeLessThan(4.6)
  })
  it('order-independent', () => {
    const a = contrastRatioFromStrings('#000', '#fff')!
    const b = contrastRatioFromStrings('#fff', '#000')!
    expect(a).toBeCloseTo(b, 5)
  })
  it('relative luminance: white = 1, black = 0', () => {
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 5)
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBeCloseTo(0, 5)
  })
})

describe('minimumContrast', () => {
  it('AA normal = 4.5', () => {
    expect(minimumContrast('AA', 'normal')).toBe(4.5)
  })
  it('AA large = 3.0', () => {
    expect(minimumContrast('AA', 'large')).toBe(3)
  })
  it('AAA normal = 7.0', () => {
    expect(minimumContrast('AAA', 'normal')).toBe(7)
  })
})

describe('checkContrast', () => {
  it('passes black-on-white for AA normal', () => {
    const r = checkContrast({ fg: '#000', bg: '#fff' })
    expect(r.pass).toBe(true)
    expect(r.ratio).toBeCloseTo(21, 0)
  })
  it('fails #777 on #fff for AA normal', () => {
    const r = checkContrast({ fg: '#777', bg: '#fff' })
    expect(r.pass).toBe(false)
  })
  it('passes #777 on #fff for AA large', () => {
    const r = checkContrast({ fg: '#777', bg: '#fff', size: 'large' })
    expect(r.pass).toBe(true)
  })
  it('reports unparseable colors as a failing check', () => {
    const r = checkContrast({ fg: 'oklch(0.5 0.1 180)', bg: '#fff' })
    expect(r.pass).toBe(false)
    expect(r.reason).toBe('unparseable color')
  })
})
