import { describe, expect, it } from 'vitest'

import { humanizeProjectName } from '../project-name.js'

describe('humanizeProjectName', () => {
  it('humanizes slug-like folder names into sentence case', () => {
    expect(humanizeProjectName('fair-labor-license')).toBe('Fair labor license')
    expect(humanizeProjectName('looma_knit')).toBe('Looma knit')
  })

  it('strips package scopes before humanizing generated names', () => {
    expect(humanizeProjectName('@knit-app/mobile-shell')).toBe('Mobile shell')
  })

  it('leaves intentional mixed-case names alone', () => {
    expect(humanizeProjectName('Looma + Knit')).toBe('Looma + Knit')
    expect(humanizeProjectName('Guildhall')).toBe('Guildhall')
  })
})
