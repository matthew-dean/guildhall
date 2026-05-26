import { describe, expect, it } from 'vitest'

import { isInternalAgentNarration, userFacingText } from '../user-facing-text.js'

describe('userFacingText', () => {
  it('rewrites empty model reply errors for user-facing activity', () => {
    expect(userFacingText('ERROR: Model returned an empty assistant message. The turn was ignored to keep the session healthy.'))
      .toContain('empty model reply')
  })

  it('rewrites idle-limit and internal research-budget narration', () => {
    expect(userFacingText('stopped (Idle Limit)')).toContain('idle limit')
    expect(userFacingText("OK, I've hit the research budget for this turn."))
      .toContain('paused after gathering enough context')
  })

  it('removes escalation code prefixes without losing the useful detail', () => {
    expect(userFacingText('ERROR: spec_ambiguous: Missing payment schema source of truth.'))
      .toBe('Missing payment schema source of truth.')
    expect(userFacingText('spec_ambiguous'))
      .toContain('missing a decision')
  })
})

describe('isInternalAgentNarration', () => {
  it('recognizes operational receipts that should not become user questions', () => {
    expect(isInternalAgentNarration('No problem - I already have the question posted and will wait for the user answer.')).toBe(true)
    expect(isInternalAgentNarration('Which schema should payments use?')).toBe(false)
  })
})
