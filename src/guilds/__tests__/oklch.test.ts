import { describe, it, expect } from 'vitest'
import {
  rgbToOklab,
  rgbToOklch,
  oklabDistance,
  findNearDuplicates,
} from '../color-theorist/index.js'

describe('rgbToOklab', () => {
  it('pure white has L≈1, a≈0, b≈0', () => {
    const lab = rgbToOklab({ r: 255, g: 255, b: 255 })
    expect(lab.L).toBeCloseTo(1, 2)
    expect(Math.abs(lab.a)).toBeLessThan(0.01)
    expect(Math.abs(lab.b)).toBeLessThan(0.01)
  })
  it('pure black has L≈0', () => {
    const lab = rgbToOklab({ r: 0, g: 0, b: 0 })
    expect(lab.L).toBeCloseTo(0, 2)
  })
})

describe('rgbToOklch', () => {
  it('achromatic colors have C≈0', () => {
    const grey = rgbToOklch({ r: 128, g: 128, b: 128 })
    expect(grey.C).toBeLessThan(0.01)
  })
  it('red has hue around 30° in OKLCH', () => {
    const red = rgbToOklch({ r: 255, g: 0, b: 0 })
    expect(red.h).toBeGreaterThan(20)
    expect(red.h).toBeLessThan(40)
  })
})

describe('oklabDistance', () => {
  it('zero for identical colors', () => {
    const a = rgbToOklab({ r: 100, g: 50, b: 200 })
    expect(oklabDistance(a, a)).toBeCloseTo(0, 6)
  })
  it('symmetric', () => {
    const a = rgbToOklab({ r: 10, g: 20, b: 30 })
    const b = rgbToOklab({ r: 200, g: 100, b: 50 })
    expect(oklabDistance(a, b)).toBeCloseTo(oklabDistance(b, a), 6)
  })
})

describe('findNearDuplicates', () => {
  it('finds identical tokens', () => {
    const dups = findNearDuplicates([
      { name: 'a', value: '#777777' },
      { name: 'b', value: '#777777' },
    ])
    expect(dups.length).toBe(1)
    expect(dups[0]!.distance).toBeCloseTo(0, 3)
  })
  it('does not flag distinct colors', () => {
    const dups = findNearDuplicates([
      { name: 'red', value: '#ff0000' },
      { name: 'blue', value: '#0000ff' },
      { name: 'green', value: '#00aa00' },
    ])
    expect(dups.length).toBe(0)
  })
  it('skips unparseable values rather than crashing', () => {
    const dups = findNearDuplicates([
      { name: 'ok', value: '#ffffff' },
      { name: 'weird', value: 'oklch(0.5 0.1 180)' },
    ])
    expect(dups.length).toBe(0)
  })
})
