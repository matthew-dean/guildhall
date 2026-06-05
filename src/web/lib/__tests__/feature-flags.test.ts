import { describe, expect, it } from 'vitest'

import { advancedStructureEnabled } from '../feature-flags.js'

describe('feature flags', () => {
  it('keeps advanced structure disabled when no env object is available', () => {
    expect(advancedStructureEnabled(undefined)).toBe(false)
  })

  it('enables advanced structure only with an explicit flag', () => {
    expect(advancedStructureEnabled({ VITE_GUILDHALL_ADVANCED_STRUCTURE: '1' })).toBe(true)
    expect(advancedStructureEnabled({ VITE_GUILDHALL_ADVANCED_STRUCTURE: 'true' })).toBe(true)
    expect(advancedStructureEnabled({ VITE_GUILDHALL_ADVANCED_STRUCTURE: '0' })).toBe(false)
  })
})
