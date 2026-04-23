import { describe, it, expect } from 'vitest'
import {
  findExternalMargins,
  findHardcodedDesignValues,
} from '../component-designer/index.js'

describe('findExternalMargins', () => {
  it('flags CSS margin shorthand', () => {
    const r = findExternalMargins(`.root {\n  margin: 8px;\n  padding: 4px;\n}`)
    expect(r.length).toBe(1)
    expect(r[0]!.pattern).toBe('css-margin-shorthand')
  })
  it('flags margin-top', () => {
    const r = findExternalMargins(`.root {\n  margin-top: 12px;\n}`)
    expect(r.length).toBe(1)
    expect(r[0]!.pattern).toBe('css-margin-side')
  })
  it('flags inline style marginTop', () => {
    const r = findExternalMargins(`<div style={{ marginTop: '8px' }} />`)
    expect(r.length).toBe(1)
    expect(r[0]!.pattern).toBe('inline-style-margin')
  })
  it('flags utility classes like mt-4', () => {
    const r = findExternalMargins(`<div className="mt-4 flex" />`)
    expect(r.length).toBe(1)
    expect(r[0]!.pattern).toBe('utility-class-margin')
  })
  it('does not flag padding', () => {
    const r = findExternalMargins(`.root {\n  padding: 8px;\n}`)
    expect(r.length).toBe(0)
  })
  it('does not flag `margin` inside a comment', () => {
    const r = findExternalMargins(`// margin: 8px; this is historical\n.root { padding: 0 }`)
    expect(r.length).toBe(0)
  })
})

describe('findHardcodedDesignValues', () => {
  it('flags hex color literals', () => {
    const r = findHardcodedDesignValues(`const bg = '#ff0000'`)
    expect(r.length).toBe(1)
    expect(r[0]!.kind).toBe('hex-color')
  })
  it('flags rgb() in a style', () => {
    const r = findHardcodedDesignValues(`color: rgb(255, 0, 0);`)
    expect(r.length).toBe(1)
    expect(r[0]!.kind).toBe('rgb-color')
  })
  it('flags px spacing in a style declaration', () => {
    const r = findHardcodedDesignValues(`padding: 12px;`)
    expect(r.length).toBe(1)
    expect(r[0]!.kind).toBe('px-spacing')
  })
  it('does not flag non-style occurrences of px', () => {
    const r = findHardcodedDesignValues(`// 12px is a legacy value we removed`)
    expect(r.length).toBe(0)
  })
})
