import { describe, expect, it } from 'vitest'

import { userFacingText } from '../user-facing-text.js'

describe('userFacingText', () => {
  it('rewrites empty model reply errors for user-facing activity', () => {
    expect(userFacingText('ERROR: Model returned an empty assistant message. The turn was ignored to keep the session healthy.'))
      .toContain('empty reply')
  })

  it('rewrites the stable idle-limit status without classifying model narration', () => {
    expect(userFacingText('stopped (Idle Limit)')).toContain('idle limit')
    expect(userFacingText("OK, I've hit the research budget for this turn."))
      .toBe("OK, I've hit the research budget for this turn.")
  })

  it('removes escalation code prefixes without losing the useful detail', () => {
    expect(userFacingText('ERROR: spec_ambiguous: Missing payment schema source of truth.'))
      .toBe('Missing payment schema source of truth.')
    expect(userFacingText('spec_ambiguous'))
      .toContain('missing a decision')
  })
})
